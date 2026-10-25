---
title: "NetworkPolicy — Pod와 방향을 고르고 허용 규칙을 합칩니다"
excerpt: "NetworkPolicy의 격리를 Pod별·방향별로 판단합니다. policyTypes 기본값, 빈 목록과 빈 규칙, selector의 AND·OR를 구분하고 API 저장과 네트워크 구현의 실제 집행 사이의 경계를 살펴봅니다"
category: "kubernetes"
tags: ["Kubernetes", "NetworkPolicy", "CNI", "Security", "Networking", "concept"]
series:
  name: "k8s-theory-network"
  order: 7
date: "2026-10-12"
---

NetworkPolicy를 하나 만들었다고 namespace 전체의 모든 통신이 제한되는 것은 아닙니다
정책이 선택한 Pod와 방향부터 확인해야 합니다

API 서버에 저장된 정책과 패킷에 적용된 제한도 구분해야 합니다
[CNI 계약](/essays/k8s-theory-cni-contract)에서 네트워크 요구와 구현을 나눴듯, NetworkPolicy도 API 의미와 실제 집행을 나눠 봅니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> Kubernetes ref: `f78e722310e50bcaca9276be22276d9e91d91308`, 공식 문서 저장본: `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> Cilium 구현 예시는 v1.20.3의 공식 문서와 대조했습니다
> 실제 클러스터의 정책 적용·통신 차단이나 성능을 재현한 기록은 포함하지 않습니다

## 오브젝트 저장과 트래픽 제한은 다른 작업입니다

표준 **NetworkPolicy**는 `networking.k8s.io/v1`의 내장 API입니다
플러그인의 확장 CRD를 설치해야 생기는 리소스가 아닙니다
다만 이 정책을 읽고 실제 트래픽을 제한하는 일은 NetworkPolicy를 지원하는 네트워크 구현이 맡습니다

[공식 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/services-networking/network-policies.md)는 집행하는 controller 없이 리소스를 만들면 효과가 없다고 설명합니다
따라서 생성 성공만으로 설치된 플러그인의 지원 여부를 판정할 수 없습니다

## 격리는 Pod별·방향별로 판단합니다

**격리(isolation)**는 해당 방향에서 연결을 제한하고 허용 규칙으로 범위를 정하는 상태입니다
모든 통신이 무조건 끊긴다는 뜻은 아닙니다

표준 NetworkPolicy만 놓고 보면 해당 방향으로 자신을 선택한 정책이 없는 Pod는 미격리 상태입니다
들어오는 **ingress**와 나가는 **egress**는 각각 판단합니다
관리자 정책 등 별도 정책 계층과 실제 네트워크 도달성은 이 설명의 범위 밖입니다

`spec.podSelector`가 정책 자신의 namespace에서 적용할 Pod를 고릅니다
그 Pod를 선택한 정책의 `policyTypes`에 `Ingress`가 하나라도 있으면 ingress 방향이 격리됩니다
`Egress`가 있는 정책이 그 Pod를 선택하면 egress 방향이 격리됩니다

예를 들어 Pod X의 ingress만 선택한 정책은 X의 egress나 선택하지 않은 Pod Y의 방향까지 바꾸지 않습니다
`spec.podSelector: {}`는 정책 namespace의 모든 Pod를 선택하며, 이 최상위 필드를 생략해도 현재 타입 정의상 빈 selector로 처리합니다

### 같은 방향의 허용은 합집합이고 양쪽 끝은 모두 허용해야 합니다

같은 Pod의 같은 방향에 적용되는 표준 정책은 허용 범위를 더합니다
정책 A가 상대 X를 허용하고 B가 Y를 허용하면 X와 Y가 모두 허용됩니다
평가 순서나 우선순위로 앞의 허용을 뒤집는 모델이 아닙니다

![출발지 Pod의 egress 허용 합집합과 목적지 Pod의 ingress 허용 합집합이 모두 연결을 허용해야 함을 보이는 개념도|tall](/diagrams/k8s-theory-network-policy-1.svg)

Pod 사이 새 연결에는 **출발지 egress와 목적지 ingress가 모두 허용**돼야 합니다
한쪽의 넓은 허용이 반대쪽의 격리를 해제하지는 않습니다
허용된 연결의 응답 트래픽은 암묵적으로 허용되므로 응답을 위한 별도 반대 방향의 새 연결 규칙과 혼동하면 안 됩니다

허용 규칙 없이 특정 방향을 격리하는 정책을 보통 **default-deny**라고 부릅니다
이 API에 직접적인 Deny 동작을 추가하는 것은 아닙니다
다른 적용 정책의 허용과 정해진 예외까지 취소하지 않으므로, 이미 넓게 허용한 방향을 좁은 정책 하나로 다시 줄일 수는 없습니다

## selector는 적용 대상과 허용 상대를 구분해서 읽습니다

최상위 `spec.podSelector`는 제한받을 Pod를 고릅니다
규칙 안의 **peer**는 허용할 출발지 또는 목적지를 고릅니다
같은 `podSelector`라는 이름이어도 놓인 위치가 다릅니다

peer의 `podSelector`만 쓰면 정책 자신의 namespace 안에서 Pod를 고릅니다
`namespaceSelector`만 쓰면 그 namespace들의 모든 Pod를 고릅니다

둘을 **같은 peer 항목에** 넣으면 선택한 namespace 안에서 Pod 라벨까지 맞아야 합니다
아래는 `Ingress` 방향을 명시한 정책에서 규칙의 `from` 부분만 떼어 낸 개념 예시입니다
정책의 최상위 selector가 고른 Pod로 들어오는 연결에서, 이 상대 조건과 같은 규칙의 포트 조건을 함께 만족해야 합니다

```yaml
from:
  - namespaceSelector:
      matchLabels:
        team: blue
    podSelector:
      matchLabels:
        app: client
```

반대로 두 peer로 나누면 `team=blue` namespace의 모든 Pod **또는** 정책 namespace의 `app=client` Pod를 허용합니다

```yaml
from:
  - namespaceSelector:
      matchLabels:
        team: blue
  - podSelector:
      matchLabels:
        app: client
```

![같은 peer 안의 namespace·Pod selector는 교집합이고 별도 peer로 나누면 선택 namespace 전체와 정책 namespace의 선택 Pod를 합치는 비교|tall](/diagrams/k8s-theory-network-policy-2.svg)

그림은 정책 namespace가 `team=blue`에 속하지 않는 가정입니다
두 YAML 모두 문법상 유효하므로 API 서버가 어느 쪽을 의도했는지 추론하지는 않습니다

peer의 빈 `podSelector: {}`는 해당 namespace 범위의 모든 Pod를 고릅니다
빈 `namespaceSelector: {}`는 모든 namespace를 고르므로 둘을 함께 쓰면 모든 namespace의 모든 Pod가 대상입니다
peer 전체가 빈 `{}`인 경우와는 다릅니다

## 포트 조건과 구현 지원을 함께 확인합니다

표준 규칙의 포트 조건은 TCP·UDP·SCTP를 표현합니다
`NetworkPolicyPort.protocol`을 생략하면 [`SetDefaults_NetworkPolicyPort`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/networking/v1/defaults.go)가 **TCP**를 넣습니다

`port`는 숫자나 Pod의 포트 이름으로 지정할 수 있습니다
포트 항목에서 `port`를 생략하면 그 항목의 프로토콜에 대해 포트 번호를 제한하지 않습니다
반면 `ports` 목록 전체를 생략하면 규칙 자체에 포트 조건이 없습니다

`port`부터 `endPort`까지의 범위에는 양 끝 포트가 모두 포함됩니다
숫자 `port`가 있어야 하며 이름 포트와 함께 쓸 수 없고 `endPort >= port`여야 합니다
[`ValidateNetworkPolicyPort`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/networking/validation/validation.go)가 이 조합과 유효한 포트 형식을 검사합니다

API가 필드를 받아들이는 것과 플러그인이 이를 구현하는 것은 다릅니다
SCTP는 해당 프로토콜 정책을 지원하는 플러그인이 필요하며 `endPort` 지원도 확인해야 합니다
공식 문서는 `endPort`를 지원하지 않는 구현에서는 단일 `port`만 적용될 수 있다고 설명합니다

## policyTypes를 생략하면 ingress가 기본으로 들어갑니다

[`SetDefaults_NetworkPolicy`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/networking/v1/defaults.go)는 방향 목록이 비어 있으면 먼저 `Ingress`를 넣습니다
`Egress`는 `len(spec.egress) != 0`일 때 추가합니다

| 방향을 생략한 정책의 egress 규칙 | 채워지는 policyTypes |
|---|---|
| 없거나 `egress: []` | `[Ingress]` |
| 규칙 한 개 이상, `egress: [{}]`도 포함 | `[Ingress, Egress]` |

egress 규칙만 적었다고 egress 전용 정책이 되지는 않습니다
ingress 허용 목록 없이 기본 `Ingress`까지 들어가면 이 정책은 선택한 Pod의 ingress도 격리합니다
다른 ingress 정책의 허용과 노드·자기 자신 예외는 별도로 남습니다

egress만 격리하려면 방향을 명시합니다
다음은 필드 의미를 보여 주는 `spec` 조각이며, 이 정책 자체에는 egress 허용 규칙이 없습니다

```yaml
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress: []
```

이 조각은 namespace 전체 Pod의 egress를 격리하지만 ingress 격리 여부를 바꾸지 않습니다
실제 egress 허용 범위는 같은 Pod에 적용되는 다른 egress 정책과 예외까지 합쳐 판단합니다

### 빈 규칙 목록과 빈 규칙 한 개는 반대 결과를 냅니다

| 표현 | 이 정책·규칙의 의미 |
|---|---|
| `ingress: []` | 이 정책이 허용하는 ingress 규칙 없음 |
| `ingress: [{}]` | 상대·포트 조건이 없는 ingress 규칙 하나 |
| 규칙의 `from: []` 또는 from 생략 | 그 규칙에서 출발지 제한 없음 |
| 규칙의 `ports: []` 또는 ports 생략 | 그 규칙에서 포트 제한 없음 |
| 규칙의 `from: [{}]` | selector·ipBlock이 없는 peer이므로 검증 오류 |

egress의 `to`에도 같은 목록 의미가 적용됩니다
`egress: []`는 규칙이 0개이지만 `egress: [{}]`는 목적지·포트 제한 없는 규칙이 1개입니다
후자는 방향을 생략했을 때 `Egress` 기본값도 추가한다는 점까지 함께 봐야 합니다

한 규칙 안에서는 **상대 조건과 포트 조건을 모두 만족**해야 합니다
`from`·`to` 목록의 여러 peer는 OR이고 `ports` 목록의 여러 항목도 OR입니다
빈 목록이 무엇을 뜻하는지는 해당 필드가 규칙 목록인지, 규칙 안의 조건 목록인지에 따라 달라집니다

## ipBlock의 except는 그 규칙에서 뺄 주소 범위입니다

`ipBlock`은 CIDR 주소 범위와 제외할 `except`를 지정합니다
같은 peer에 `ipBlock`과 selector를 함께 넣을 수 없으며, 각 `except`는 `cidr`의 진부분집합이어야 합니다

[`ValidateIPBlock`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/networking/validation/validation.go)은 범위가 맞지 않으면 ``must be a strict subset of `cidr` `` 오류를 만듭니다
여기서 제외한 주소를 다른 적용 정책이 허용하면 합집합에 다시 포함될 수 있습니다
`except`도 모든 정책보다 우선하는 거부 규칙은 아닙니다

Pod를 라벨로 지정할 수 있는 상황에서 `ipBlock`을 Pod 신원처럼 취급해서도 안 됩니다
Pod IP는 교체될 수 있고, 실제 정책이 관찰하는 주소에는 NAT 적용 순서도 영향을 줍니다

## 노드 통신 예외와 구현별 동작을 구분합니다

Pod 자신을 향한 통신과 **그 Pod가 실행 중인 노드와의 양방향 트래픽**은 표준 NetworkPolicy로 막을 수 없습니다
다른 모든 노드와의 통신까지 예외라는 뜻은 아닙니다
API의 ingress 주석에만 로컬 노드가 적혀 있어도, 공식 문서가 정한 양방향 예외를 반대로 해석하면 안 됩니다

kubelet의 로컬 노드 probe를 볼 때도 이 예외를 고려해야 합니다
정책 생성 직후 Ready가 바뀌었다는 시점만으로 NetworkPolicy가 probe를 막았다고 확정할 수는 없습니다
실제 probe 방식과 통신 경로, 집행 구현을 확인해야 합니다

### NAT 이후의 주소와 이미 열린 연결은 구현에 달려 있습니다

[Service와 kube-proxy](/essays/k8s-theory-service-kube-proxy)에서 본 NAT는 패킷 주소를 바꿉니다
이 변환이 NetworkPolicy 판정보다 앞인지 뒤인지는 플러그인·클라우드·Service 구현 조합에 따라 달라질 수 있습니다

ingress의 `ipBlock`이 원래 클라이언트 주소 대신 로드밸런서나 노드 주소를 볼 수 있습니다
egress에서도 Service IP가 외부 IP로 변환될 때 어느 주소로 정책을 판단하는지 확인해야 합니다

정책이나 Pod·namespace 라벨을 바꾸면 이미 열린 연결에 적용되는 정책 집합도 달라질 수 있습니다
그 변경이 기존 연결을 즉시 끊는지는 구현이 정합니다
새 연결이 거부되는 것과 기존 연결도 종료되는 것을 같은 보장으로 읽으면 안 됩니다

### hostNetwork와 ICMP는 일반 Pod의 TCP 규칙으로 추정하지 않습니다

`hostNetwork` Pod에 대한 동작은 표준에서 단일하게 정하지 않습니다
구현이 Pod별 트래픽을 구별해 정책을 적용할 수도 있고, selector 매칭에서 제외하고 노드 IP의 트래픽으로 다룰 수도 있습니다
정책의 적용 대상과 peer 양쪽에서 이 차이를 확인해야 합니다

TCP·UDP·SCTP 이외 프로토콜도 동작이 정의되지 않은 범위가 있습니다
ICMP나 ARP를 포함해 모두 차단된다고 가정할 수 없으므로 `ping` 한 번만으로 TCP 허용·차단을 판정할 수는 없습니다

DNS 역시 egress 통신입니다
DNS가 필요한 Pod라면 실제 resolver 목적지·프로토콜·포트에 대한 허용을 확인해야 합니다
Service 주소의 변환과 노드 로컬 DNS 경로가 있을 수 있으므로 이름 조회 실패를 애플리케이션 목적지의 차단과 구분합니다

## 저장 상태만으로 집행 완료를 알 수는 없습니다

코어의 [`storage.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/networking/networkpolicy/storage/storage.go)는 저장소를 만들고 검증 strategy를 연결합니다
[`strategy.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/networking/networkpolicy/strategy.go)는 생성·갱신 검증과 CIDR 표기 경고 등을 처리합니다
이 경로가 패킷의 허용·차단 완료를 보고하는 것은 아닙니다

현재 [`NetworkPolicy` 타입](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/networking/v1/types.go)에는 적용 완료를 나타내는 `status` 필드가 없습니다
`kubectl get networkpolicy`로 존재를 확인해도 집행 완료 시각까지 알 수는 없습니다
외부 구현이 제공하는 Event·로그·관측 도구는 별도로 확인해야 하며, 코어 경고가 항상 없다고 단정해서도 안 됩니다

## 패킷 판정 위치와 확장 API는 구현이 정합니다

[Cilium v1.20.3의 eBPF 설명](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/network/ebpf/intro.rst)은 veth의 호스트 쪽 TC hook에서 컨테이너의 송신 트래픽에 정책을 집행하는 구성을 보여 줍니다
패킷의 신원에 맞는 L3·L4 정책을 적용하는 경로입니다
모든 플러그인이 veth나 같은 hook을 사용한다는 뜻은 아닙니다

overlay 패킷의 바깥쪽 노드 IP만으로는 원래 Pod의 라벨을 알 수 없습니다
구현에는 원래 Pod와 정책을 대응시킬 정보가 필요합니다
[Cilium encapsulation](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/network/concepts/routing.rst)은 출발지 security identity를 메타데이터로 함께 전달해 수신 노드의 신원 조회를 줄입니다

Cilium은 표준 NetworkPolicy 외에 namespace 범위의 `CiliumNetworkPolicy`와 클러스터 범위의 `CiliumClusterwideNetworkPolicy`를 제공합니다
이들은 별도 CRD이며 [정책 문서](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/security/policy/index.rst)는 L7·DNS 기반·Deny·호스트 정책 같은 확장 기능을 다룹니다
각 기능의 타입·설정·결합 규칙은 해당 구현에서 확인해야 합니다

표준 정책의 허용 규칙을 합치는 방식이 확장 Deny에도 그대로 적용된다고 볼 수는 없습니다
확장 CRD의 스키마가 등록됐거나 오브젝트가 생성됐다는 사실도 해당 데이터 경로의 집행 완료를 보장하지 않습니다

## 실패를 지원·대상·방향·집행으로 나눕니다

다음은 실제 장애 결과가 아니라 API 의미와 구현 경계에 따른 확인 기준입니다

| 상황 | 구분할 근거 |
|---|---|
| 정책은 존재하는데 통신이 제한되지 않음 | 플러그인의 NetworkPolicy 지원·집행 설정, 적용 방향, 다른 정책의 넓은 허용 |
| 의도한 Pod가 격리되지 않음 | 최상위 podSelector와 실제 라벨·정책 namespace |
| egress만 의도했는데 ingress도 달라짐 | 저장된 policyTypes, 생략 시 기본 Ingress, 전체 ingress 허용 합집합 |
| 다른 namespace를 허용했는데 기대와 다름 | 한 peer의 AND인지 여러 peer의 OR인지, peer Pod selector의 namespace 범위 |
| 정책을 좁혔는데 기존 통신이 유지됨 | 다른 넓은 허용 규칙, 기존 연결에 대한 구현의 변경 적용 방식 |
| 이름 조회만 실패함 | 실제 DNS 경로의 egress 허용과 resolver 목적지 |
| Ready가 정책 변경 시점에 떨어짐 | 로컬 노드 예외, 실제 probe와 통신 경로, 플러그인 관측 정보 |
| 노드 사이에서만 결과가 다름 | 원래 Pod 신원 매핑·전달, NAT 판정 순서, 정책 동기화 상태 |

API 서버는 selector 형식과 CIDR·peer·포트 조합을 검증할 수 있습니다
그 selector가 의도한 Pod를 고르는지와 언제 실제 집행됐는지까지 검증하는 것은 아닙니다
지원 여부, 적용 Pod, 방향, 허용 합집합, 실제 데이터 경로를 차례로 구분해야 생성 성공과 통신 결과의 차이를 설명할 수 있습니다

## 확인한 근거

- [NetworkPolicy 공식 저장본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/services-networking/network-policies.md) — 격리·합집합·양끝 허용·노드/자기 자신 예외·NAT/기존 연결/hostNetwork/프로토콜 조건
- [NetworkPolicy API 타입](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/networking/v1/types.go), [기본값](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/networking/v1/defaults.go), [검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/networking/validation/validation.go) — 빈 selector·목록·규칙, 방향·프로토콜 기본값과 필드 조합
- [저장 strategy](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/networking/networkpolicy/strategy.go) — namespace 범위·생성/갱신 검증·CIDR 경고와 실제 집행의 구분
- [Cilium의 namespace·cluster 정책](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/security/policy/kubernetes.rst), [데이터 경로](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/network/ebpf/intro.rst), [encapsulation의 신원 전달](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/network/concepts/routing.rst) — 별도 버전의 구현 예시이며 설치 상태는 확인하지 않음
