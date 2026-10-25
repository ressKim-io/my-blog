---
title: "관리자 네트워크 정책 — 허용·거부와 다음 계층으로의 위임"
excerpt: "ANP와 BANP가 나누던 관리자 제한과 기본 정책을 ClusterNetworkPolicy의 Admin·Baseline tier로 연결합니다. Pass의 의미, 방향별 NetworkPolicy 판정, CRD 채널과 실제 집행 지원의 경계를 살펴봅니다"
category: "kubernetes"
tags: ["Kubernetes", "NetworkPolicy", "ClusterNetworkPolicy", "Security", "concept"]
series:
  name: "k8s-theory-network"
  order: 8
date: "2026-10-14"
---

NetworkPolicy의 허용 규칙보다 먼저 적용할 관리자 거부 규칙은 어디에 둘 수 있을까요?
반대로 네임스페이스의 정책이 결정하지 않은 방향에 클러스터 기본 정책을 적용하려면 무엇이 필요할까요?

코어 NetworkPolicy는 네임스페이스의 허용 규칙을 합치므로 이 두 역할을 직접 표현하지 않습니다
별도 Network Policy API는 관리자 정책을 NetworkPolicy의 앞과 뒤에서 평가하도록 정의합니다
관리자가 최종 판정을 내리는 것과 네임스페이스 정책에 결정을 넘기는 것을 액션으로 구분합니다

> **근거**: Network Policy API 최신 릴리스 v0.2.0 `a17adecd0316b8ff1c3f83939ec0441d68cd6cce`의 `v1alpha2`를 기준으로 설명합니다
> 구형 ANP/BANP는 v0.1.7 `0638d394d89ddb61dded975b502391a122fc762c`, 프로젝트 현행 안내는 `730bd5474d82a2cf82be8b0c6c2a5515598cc44e`와 구분합니다
> Kubernetes 공식 문서 저장본은 `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`입니다
> API·소스 기반 해설이며 CRD 설치나 클러스터의 허용·차단을 재현한 기록은 포함하지 않습니다

## 한 방향의 정책 판정을 끝까지 따라갑니다

먼저 현재 API인 **ClusterNetworkPolicy**의 평가 흐름을 봅니다
이 리소스는 `policy.networking.k8s.io/v1alpha2` 그룹·버전의 클러스터 범위 CRD입니다
`tier`는 정책을 평가하는 계층이며, 이 리소스의 `spec.tier`에는 `Admin`과 `Baseline`을 지정할 수 있습니다

이 프로젝트의 API 그룹은 `policy.networking.k8s.io`입니다
이름에 `k8s.io`가 들어가도 Kubernetes 코어 내장 API는 아니며 CRD와 이를 집행하는 구현이 필요합니다

가운데 NetworkPolicy 계층은 기존 `networking.k8s.io/v1 NetworkPolicy`가 채웁니다
따라서 ClusterNetworkPolicy의 tier 값에 `NetworkPolicy`를 넣는 구조는 아닙니다

subject는 정책을 적용할 Pod를 고릅니다
`namespaces`는 네임스페이스 라벨로 그 안의 Pod를, `pods`는 네임스페이스 선택자와 Pod 선택자를 함께 만족하는 Pod를 고릅니다
subject에는 둘 중 정확히 하나를 지정합니다

peer는 그 Pod와 통신할 상대입니다
ingress의 `from`에는 출발지가, egress의 `to`에는 목적지가 들어갑니다
한 peer에도 선택 형식 하나만 지정하며, 여러 peer 중 하나가 매치하면 해당 규칙의 상대 조건을 만족합니다

![ingress 또는 egress 한 방향에서 Admin과 NetworkPolicy와 Baseline을 차례로 평가하며 Accept와 Deny는 최종 판정하고 Pass는 현재 tier의 남은 규칙을 건너뛰는 흐름|xtall](/diagrams/k8s-theory-admin-network-policy-1.svg)

그림은 **ingress 또는 egress 한 방향**의 판정입니다
Admin이 한 Pod의 해당 방향을 허용해도 상대 Pod에서 필요한 허용까지 대신하지는 않습니다
또한 네트워크 정책의 허용이 방화벽이나 서비스 메시 등 다른 경로의 차단까지 없애는 것은 아닙니다

Admin의 `Accept`와 `Deny`는 최종 판정이므로 아래 계층의 정책을 더 평가하지 않습니다
관리자의 거부뿐 아니라 명시적인 허용도 네임스페이스 NetworkPolicy로 뒤집을 수 없습니다

NetworkPolicy가 해당 방향을 격리했다면, 허용 규칙의 합집합으로 그 방향의 허용·거부가 결정됩니다
**허용 규칙에 매치하지 않았다고 Baseline으로 내려가는 것은 아닙니다**
이때의 암묵적 거부도 NetworkPolicy의 최종 판정입니다

해당 방향을 격리하는 NetworkPolicy가 없을 때 Baseline을 평가합니다
예를 들어 ingress만 격리하는 NetworkPolicy가 있어도 egress에 대한 Baseline 판정은 남을 수 있습니다
어느 계층에서도 그 방향을 확정하지 않으면 정책 모델의 기본 허용으로 이어집니다

계층의 평가 순서와 판정이 끝나는 조건은 [ClusterNetworkPolicySpec](https://github.com/kubernetes-sigs/network-policy-api/blob/a17adecd0316b8ff1c3f83939ec0441d68cd6cce/apis/v1alpha2/clusternetworkpolicy_types.go), 방향별 격리는 [코어 NetworkPolicy 문서](https://kubernetes.io/docs/concepts/services-networking/network-policies/)에 근거합니다

## Pass는 허용이 아니라 현재 계층의 평가를 끝냅니다

`Pass`에 매치하면 **현재 tier의 남은 모든 규칙**을 건너뛰고 다음 계층에서 판정을 이어갑니다
Admin에서 Pass하면 먼저 NetworkPolicy 차례가 되며, Baseline의 Pass는 남은 Baseline 규칙을 건너뛰어 기본값으로 이어집니다

이는 단순한 규칙 불일치와 다릅니다
아무 규칙도 매치하지 않았다면 같은 tier의 다음 규칙을 계속 확인하지만, Pass는 그 나머지를 평가하지 않습니다
다음 계층이 거부할 수 있으므로 Pass 자체가 통신을 허용하지도 않습니다

예를 들어 egress의 `networks: 0.0.0.0/0`에 Deny를 두면 클러스터 내부의 IPv4 Pod 주소도 포함됩니다
`networks`를 외부 주소 전용이라고 읽으면 Pod 간 통신까지 막는 범위를 놓칩니다

API 주석은 이 경우 넓은 CIDR 거부보다 먼저 Pod 트래픽을 Pass하는 규칙을 두는 방법을 설명합니다
Pod 트래픽은 뒤의 관리자 CIDR 규칙을 건너뛰지만, NetworkPolicy와 Baseline이 그 통신을 허용할지는 별도입니다
예외를 두는 용도로 사용해도 Pass의 의미는 다음 계층으로의 위임입니다

ClusterNetworkPolicy는 subject로 Pod를 선택했다는 사실만으로 암묵적인 기본 거부를 만들지 않습니다
해당 방향의 규칙이 없으면 그 방향에 영향을 주지 않으며, 규칙이 있는 경우에도 액션과 평가 순서를 그대로 적용합니다
이 부분은 선택한 방향을 격리하는 코어 NetworkPolicy의 모델과 다릅니다

액션과 CIDR의 조건은 [규칙·peer 타입](https://github.com/kubernetes-sigs/network-policy-api/blob/a17adecd0316b8ff1c3f83939ec0441d68cd6cce/apis/v1alpha2/clusternetworkpolicy_types.go), 암묵적 격리의 부재는 [프로젝트 API 개요](https://network-policy-api.sigs.k8s.io/api-overview/)에서 확인할 수 있습니다

## priority와 규칙 목록 순서는 서로 다른 범위에서 적용됩니다

`priority`는 같은 tier 안에서 정책을 평가하는 순서를 정하는 0~1000의 정수입니다
**숫자가 작을수록 먼저** 평가합니다
Admin과 Baseline은 tier 순서가 먼저이므로 두 계층의 priority 숫자를 서로 비교해 순서를 뒤집지 않습니다

한 오브젝트 안의 규칙은 priority를 공유하므로 목록에 적힌 순서로 평가합니다
구형 ANP(AdminNetworkPolicy)는 방향별 최대 100개 규칙을, 현재 ClusterNetworkPolicy는 ingress·egress 각각 최대 25개 규칙을 허용합니다
현재 API의 한 규칙에서 peer 목록과 protocols 목록도 각각 최대 25개입니다

같은 tier에서 같은 priority의 두 정책이 같은 연결에 매치할 수 있다면, API는 어느 정책이 먼저 적용될지 고정하지 않습니다
우연히 한 구현에서 일정한 순서를 관찰하더라도 이를 공통 API의 보장으로 사용할 수 없습니다

같은 priority라는 이유만으로 API 서버가 요청을 거절하지는 않습니다
오브젝트 하나의 값 범위를 검사하는 것과 다른 오브젝트까지 조회해 유일성을 강제하는 것은 다른 검증입니다
또 같은 숫자를 써도 대상 Pod가 겹치지 않으면 같은 연결에 대한 충돌은 생기지 않습니다

따라서 겹치는 정책에서 판정 순서의 모호함을 허용할 수 없다면 priority가 중복되지 않도록 설계해야 합니다
이 조건은 구형 [AdminNetworkPolicySpec](https://github.com/kubernetes-sigs/network-policy-api/blob/0638d394d89ddb61dded975b502391a122fc762c/apis/v1alpha1/adminnetworkpolicy_types.go)과 현재 ClusterNetworkPolicySpec에 모두 명시돼 있습니다

## 선택자와 포트는 방향·채널 조건을 함께 봅니다

| peer 형식 | 방향 | v0.2.0 배포 채널 | 의미 |
|---|---|---|---|
| `namespaces` | ingress·egress | standard·experimental | 선택한 네임스페이스의 Pod |
| `pods` | ingress·egress | standard·experimental | 네임스페이스와 Pod 선택자의 AND |
| `networks` | egress | standard·experimental | IPv4·IPv6 CIDR, 클러스터 내부 주소도 매치 가능 |
| `nodes` | egress | experimental | 노드 라벨로 선택한 `node.status.addresses`의 IP |
| `domainNames` | egress | experimental | 도메인 이름, Accept 규칙 전용 |

hostNetwork Pod는 subject와 Pod를 고르는 `namespaces`·`pods` peer에 포함되지 않습니다
이를 nodes·networks를 포함한 모든 주소 선택 방식의 보편적인 제외로 확대해서는 안 됩니다

`domainNames`의 와일드카드는 `*.` 접두로 하나 이상의 전체 라벨을 매치합니다
`*.kubernetes.io`는 하위 도메인을 매치하지만 `kubernetes.io` 자체나 라벨 일부를 매치하지 않습니다
허용 도메인을 Accept한 뒤 우선순위가 낮은 egress 거부를 두어 허용 목록을 구성하는 용도이며, Accept 전용으로 제한한 설계 이유는 확인하지 못했습니다

`protocols`는 TCP·UDP·SCTP와 목적지 포트를 제한합니다
TCP·UDP·SCTP의 숫자 목적지 포트는 `destinationPort.number` 또는 `destinationPort.range`의 `start`·`end`로 표현합니다
숫자는 1~65535이고 range는 양 끝을 포함하되 start가 end보다 작아야 합니다
별도 `destinationNamedPort`는 Pod의 `ContainerPort` 이름으로 목적지 포트를 선택합니다
API 계약은 이름 있는 포트가 없는 상대를 같은 규칙에서 선택하지 못하도록 제한합니다
experimental CRD는 `networks`·`nodes`·`domainNames` peer와 `destinationNamedPort`를 같은 egress 규칙에 쓰면 CEL 검증식으로 거부합니다
standard 배포본에는 이 조합 검증식이 없으므로, API의 사용 제한과 저장 시 검증 범위를 구분해야 합니다

## standard와 experimental은 저장 스키마가 다릅니다

두 채널은 같은 Kind의 서로 다른 CRD 배포본입니다
v0.2.0 standard 스키마에는 `nodes`와 `domainNames`가 없고 experimental에만 있습니다
코어 API에서 feature gate로 필드를 켜고 끄는 것과 달리, 여기서는 설치한 CRD 배포본에 따라 사용할 필드가 달라집니다

standard CRD에 없는 필드를 보내면 요청의 `fieldValidation` 모드가 결과에 영향을 줍니다
Strict는 알 수 없는 필드를 거절하고, 기본 Warn은 경고와 함께 필드를 제거한 뒤 나머지 오브젝트를 검증합니다
Ignore는 경고 없이 제거합니다

필드가 제거되었다고 나머지가 반드시 저장되는 것은 아닙니다
예를 들어 peer가 비면 `minProperties: 1` 검증에 실패할 수 있습니다
`kubectl --validate=true`의 기본 설정은 strict이므로 서버의 기본 Warn과 클라이언트가 선택한 모드도 구분해야 합니다

이 조건은 직접 대조한 [standard CRD](https://github.com/kubernetes-sigs/network-policy-api/blob/a17adecd0316b8ff1c3f83939ec0441d68cd6cce/config/crd/standard/policy.networking.k8s.io_clusternetworkpolicies.yaml)·[experimental CRD](https://github.com/kubernetes-sigs/network-policy-api/blob/a17adecd0316b8ff1c3f83939ec0441d68cd6cce/config/crd/experimental/policy.networking.k8s.io_clusternetworkpolicies.yaml)와 [API field validation 문서](https://kubernetes.io/docs/reference/using-api/api-concepts/#setting-the-field-validation-level)에 근거합니다

### 저장된 peer를 구현이 모르면 fail closed로 처리합니다

스키마가 필드를 저장해도 실제 정책 구현이 그 형식을 이해하지 못할 수 있습니다
peer에서 아는 필드가 하나도 보이지 않는다면 호환되지 않는 CRD 버전의 필드일 수 있으며, 타입 계약은 트래픽을 의도치 않게 열지 않도록 처리하게 합니다
이를 fail closed라고 합니다

| 해석하지 못한 peer가 있는 규칙의 액션 | 계약상 처리 |
|---|---|
| 구형 `Allow` / 현재 `Accept` | 아무 트래픽도 매치하지 않는 규칙으로 처리 |
| `Deny` / `Pass` | 모든 트래픽을 거부하는 규칙으로 처리 |

허용 조건을 모르는데 트래픽을 열거나, 위임 조건을 모르는데 다음 계층으로 넘기지 않도록 액션별 처리가 다릅니다
이것은 저장 전에 API 서버가 알 수 없는 필드를 거절·제거하는 것과 다른 단계입니다

## ANP와 BANP의 역할이 한 Kind의 tier가 됐습니다

| API 모델 | 리소스와 버전 | 관리자 정책의 표현 |
|---|---|---|
| v0.1.7 | `AdminNetworkPolicy`, `v1alpha1` | NetworkPolicy보다 앞에서 평가, `Allow`·`Deny`·`Pass` |
| v0.1.7 | `BaselineAdminNetworkPolicy`, `v1alpha1` | NetworkPolicy 뒤의 기본 정책, `Allow`·`Deny` |
| v0.2.0 | `ClusterNetworkPolicy`, `v1alpha2` | `tier: Admin` 또는 `Baseline`, `Accept`·`Deny`·`Pass` |

이하 ANP는 구형 AdminNetworkPolicy, BANP는 구형 BaselineAdminNetworkPolicy를 뜻합니다
현재 ClusterNetworkPolicy는 두 Kind의 역할을 tier 필드로 합쳤고, 허용 액션의 이름도 `Allow`에서 `Accept`로 바꿨습니다
허용 액션의 이름을 바꾼 이유는 확인한 발표 글과 설계 문서에서 찾지 못했습니다

공식 프로젝트는 ClusterNetworkPolicy를 현재 개발하는 API로, ANP/BANP를 이전 API로 분류합니다
다만 구형 API가 사라졌거나 유지보수가 모두 끝났다는 뜻은 아닙니다
[시작 안내](https://network-policy-api.sigs.k8s.io/getting-started/)는 구형 최신 릴리스 v0.1.7을 별도로 안내하고 `release-0.1` 유지 및 잠재적인 버그 수정을 설명합니다

v0.2.0 설치용 standard·experimental CRD에는 ClusterNetworkPolicy가 있고 ANP/BANP CRD는 없습니다
저장소에 구형 Go 타입이 남아 있는 것과 그 릴리스가 설치용 CRD를 제공하는 것은 구분해야 합니다
API 버전은 여전히 `v1alpha2`이며, `standard` 채널을 사용한다고 안정 API인 `v1`이 되는 것은 아닙니다

이 글의 ClusterNetworkPolicy는 Cilium의 `CiliumNetworkPolicy`와도 다릅니다
두 이름 모두 CNP로 줄이기도 하지만, Cilium 확장 리소스의 API 그룹은 `cilium.io`입니다
Kind와 API 그룹을 함께 확인해야 서로 다른 정책을 같은 오브젝트로 읽지 않습니다

## 계층을 합치면서 구형 BANP의 제약도 바뀌었습니다

구형 BANP는 클러스터에 하나만 둘 수 있고 priority와 Pass가 없었습니다
개수를 세는 컨트롤러가 아니라 CRD의 CEL 검증이 `metadata.name == 'default'`를 강제했습니다
클러스터 범위에서 같은 이름의 오브젝트를 여러 개 만들 수 없으므로 이 이름 제약이 singleton을 만듭니다

현재 ClusterNetworkPolicy는 Baseline에도 priority와 Pass를 허용하므로 여러 기본 정책을 평가할 수 있습니다
experimental의 domainNames도 Admin과 Baseline 양쪽에서 사용할 수 있습니다

이 변화의 배경은 [NPEP-285](https://github.com/kubernetes-sigs/network-policy-api/blob/a17adecd0316b8ff1c3f83939ec0441d68cd6cce/npeps/npep-285-combine-crds.md)에 있습니다
처음 BANP를 하나로 제한한 이유는 여러 개가 필요한 사례가 없었기 때문이며, 처음부터 여러 개를 허용한 뒤 제한을 강화하는 것보다 나중에 완화하는 쪽을 택했습니다
이후 서로 다른 네임스페이스 집합에 다른 기본 정책을 두려는 요구를 반영했습니다

구형 BANP에 도메인 선택자를 두지 않았던 이유도 이 문서가 설명합니다
NetworkPolicy에는 같은 도메인 선택자를 재현할 방법이 없다는 우려가 있었습니다
그러나 NetworkPolicy가 해당 방향을 격리해 최종 판정하면 Baseline 자체를 평가하지 않으므로, 동일한 선택자를 다시 쓰지 않아도 기본 허용을 거부로 바꿀 수 있습니다

### 선택지 비교: priority 하나로 계층까지 표현할 것인가

NPEP-285는 tier 필드를 추가하는 대신 NetworkPolicy의 순위를 0으로 두고 음수·양수로 관리자 정책의 앞뒤를 나누는 안도 검토했습니다
기각 이유는 숫자 범위와 Pass의 계층 전환을 함께 설명하기 어렵다는 것이었습니다
tier를 분리하면 Pass는 현재 tier의 나머지를 건너뛰고 다음 계층으로 이동한다는 동작으로 표현할 수 있습니다

다만 설계 문서의 숫자 대안 설명과 뒤의 Pass 예시는 부호가 서로 엇갈립니다
그 예시의 부호를 현재 API의 검사 순서로 사용하거나 어느 쪽이 작성자의 의도인지 단정하지 않습니다
현재 계약은 실제 타입의 `Admin`·NetworkPolicy·`Baseline` 순서와 같은 tier의 작은 priority 우선입니다

KEP-2091의 예정 일정도 현재 API의 안정성을 입증하지 않습니다
확인한 [kep.yaml](https://github.com/kubernetes/enhancements/blob/0c8d11e9a13e12d2ef75d2d78af5ac00d8189046/keps/sig-network/2091-admin-network-policy/kep.yaml)에는 과거 beta·stable 목표가 남아 있지만 stage는 alpha, latest-milestone은 v1.24입니다
실제 배포 API와 CRD, 구현의 지원 상태를 별도로 확인해야 합니다

## API 설치와 패킷 집행 지원을 따로 확인합니다

CRD를 설치하면 API 서버가 오브젝트를 저장할 수 있습니다
그 정책을 실제 패킷에 적용하려면 해당 API 버전과 필드를 지원하는 네트워크 정책 구현이 필요합니다
공통 API를 사용해도 집행 코드는 Kubernetes 코어 밖에 있습니다

확인한 [공식 구현 목록](https://network-policy-api.sigs.k8s.io/implementations/)은 2026-04-21 갱신 표시를 유지하고 있습니다
ClusterNetworkPolicy에는 kube-network-policies, Kube-OVN의 experimental 지원, Calico v3.32의 standard 지원이 기재돼 있습니다
구형 ANP/BANP 목록은 별도로 있으며 OVN-Kubernetes·Antrea·Kube-OVN·Calico 등의 지원 필드도 구분합니다
구형 API 지원이 현재 ClusterNetworkPolicy 지원을 자동으로 뜻하지는 않습니다

이 목록의 Cilium tracking issue 표기만으로 현재 미지원이라고 단정할 수 없습니다
별도로 확인한 **Cilium v1.20.3**의 [Helm values](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/install/kubernetes/cilium/values.yaml)에는 `k8sClusterNetworkPolicy.enabled`가 있고 기본값은 false입니다
[go.mod](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/go.mod)는 `sigs.k8s.io/network-policy-api v0.2.0`을 요구합니다
이는 `policy.networking.k8s.io`의 ClusterNetworkPolicy를 위한 설정이며 `cilium.io`의 CiliumNetworkPolicy와 구분합니다

모든 적합성 조건을 충족하는지, 실제 설치에서 활성화됐는지는 옵션과 의존성만으로 알 수 없습니다
프로젝트가 공개한 kube-network-policies의 [conformance 보고서](https://github.com/kubernetes-sigs/network-policy-api/blob/730bd5474d82a2cf82be8b0c6c2a5515598cc44e/conformance/reports/v0.2.0/kube-network-policies.yaml)도 구현 버전·API 릴리스·시험한 standard/experimental 기능 범위를 함께 기록합니다
이 공개 결과는 이 글에서 테스트를 실행했다는 뜻이 아닙니다

## 실패한 위치에 따라 확인할 대상이 달라집니다

| 증상 | 구분할 조건 |
|---|---|
| API 서버가 Kind를 찾지 못함 | 설치한 CRD와 제공 버전, ANP/BANP와 ClusterNetworkPolicy 구분 |
| domainNames가 unknown field로 보고됨 | 배포 채널과 fieldValidation, 제거 뒤 peer 검증 |
| 구형 BANP에 다른 이름을 쓸 수 없음 | v1alpha1의 default 이름 CEL 제약 |
| 정책이 저장됐지만 기대한 집행이 없음 | 구현의 API·필드 지원과 활성화, 실제 datapath 확인 |
| Deny보다 허용이 먼저 결정됨 | 같은 tier의 더 작은 priority, 규칙 목록 순서, priority 중복 |
| Baseline이 한 방향에서만 적용됨 | 그 방향을 격리한 NetworkPolicy의 존재와 policyTypes |
| 넓은 CIDR 거부가 Pod 통신까지 막음 | networks의 포함 범위와 앞선 Pass 이후의 판정 |
| 차단 로그를 찾을 수 없음 | API 액션과 구현의 관측 기능은 별개, 표준 Log 액션은 없음 |

오브젝트를 만들 권한과 저장 스키마, 규칙의 판정 순서, 실제 집행·관측은 서로 다른 조건입니다
실제 설치 환경의 CRD·정책 구현 버전과 활성화 여부, 패킷 판정은 이 글에서 확인하지 않았습니다

## 참고 자료

- [Network Policy API v0.2.0 릴리스](https://github.com/kubernetes-sigs/network-policy-api/releases/tag/v0.2.0)와 [v1alpha2 API 타입](https://github.com/kubernetes-sigs/network-policy-api/blob/a17adecd0316b8ff1c3f83939ec0441d68cd6cce/apis/v1alpha2/clusternetworkpolicy_types.go)
- [구형 v0.1.7 API 타입](https://github.com/kubernetes-sigs/network-policy-api/tree/0638d394d89ddb61dded975b502391a122fc762c/apis/v1alpha1)과 [BANP CRD](https://github.com/kubernetes-sigs/network-policy-api/blob/0638d394d89ddb61dded975b502391a122fc762c/config/crd/standard/policy.networking.k8s.io_baselineadminnetworkpolicies.yaml)
- [현재·이전 API 분류](https://github.com/kubernetes-sigs/network-policy-api/blob/730bd5474d82a2cf82be8b0c6c2a5515598cc44e/site-src/index.md)와 [유지 경로 안내](https://github.com/kubernetes-sigs/network-policy-api/blob/730bd5474d82a2cf82be8b0c6c2a5515598cc44e/site-src/getting-started.md)
