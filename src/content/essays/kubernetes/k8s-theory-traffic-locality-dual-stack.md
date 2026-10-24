---
title: "트래픽 지역성과 dual-stack — 후보 제한과 선호, 주소군별 경로"
excerpt: "Local 정책과 trafficDistribution 힌트가 후보를 고르는 방식을 구분합니다. Ready·종료 중 후보의 fallback, REJECT·DROP, IPv4/IPv6별 Service·EndpointSlice와 primary 주소의 호환 규칙을 살펴봅니다"
category: "kubernetes"
tags: ["Kubernetes", "Service", "EndpointSlice", "TrafficPolicy", "DualStack", "concept"]
series:
  name: "k8s-theory-network"
  order: 10
date: "2026-10-18"
---

Service에 백엔드가 있어도 이 노드에서 사용할 후보가 없을 수 있습니다
다른 노드로 보내면 되는지는 Service의 정책에 달려 있습니다

[Service와 kube-proxy](/essays/k8s-theory-service-kube-proxy)에서 주소를 실제 백엔드로 바꾸는 규칙을 봤습니다
여기서는 그 규칙을 만들 때 후보를 어디까지 고를지 살펴봅니다
IPv4·IPv6를 함께 사용하는 dual-stack에서는 같은 Service의 후보도 주소군별로 나눠야 합니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> Kubernetes ref: `f78e722310e50bcaca9276be22276d9e91d91308`, 공식 문서 저장본: `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> Linux kube-proxy의 iptables·nftables 후보 판정과 규칙을 대조했습니다
> 실제 클러스터의 통신 결과·주소 선택·지연·비용을 측정한 기록은 포함하지 않습니다

## 어느 주소로 들어왔는지에 따라 정책을 고릅니다

| 필드 | 기본 적용 접점 | 값 |
|---|---|---|
| `internalTrafficPolicy` | ClusterIP | `Cluster` 기본값 또는 `Local` |
| `externalTrafficPolicy` | NodePort·ExternalIP·LoadBalancer IP | `Cluster` 기본값 또는 `Local` |

[`ServiceSpec`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/core/v1/types.go)은 두 필드를 구분합니다
한 Service에 둘 다 설정할 수 있으므로 ClusterIP에서 사용할 후보와 외부 진입 경로에서 사용할 후보가 달라질 수 있습니다

다만 목적지 주소만 보고 출발지의 특수 처리까지 모두 같다고 판단하면 안 됩니다
iptables의 [`syncProxyRules`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/iptables/proxier.go)는 클러스터 Pod가 Service의 외부 주소로 보내는 트래픽과 호스트에서 시작한 트래픽을 별도 처리합니다
아래 Local의 외부 경로 설명은 이런 예외와 일반적인 외부 유입을 구분해서 읽어야 합니다

### 두 Local이 출발지 주소에 주는 효과는 다릅니다

`externalTrafficPolicy: Cluster`의 일반 외부 유입 경로는 다른 노드의 백엔드로도 보낼 수 있습니다
iptables는 이 경로에 masquerade를 걸어 응답이 연결 변환 상태가 있는 유입 노드로 돌아오도록 합니다
**SNAT**는 이처럼 출발지 주소를 바꾸는 처리입니다

외부 정책의 `Local`은 유입 노드의 백엔드만 사용해 이 전달 과정의 출발지 변환을 피합니다
단, 호스트에서 시작한 특수 경로까지 출발지를 무조건 보존하는 것은 아니며 앞단 로드밸런서가 이미 바꾼 원래 주소를 복원하는 기능도 아닙니다

일반적인 Pod의 ClusterIP 호출은 외부 유입과 같은 masquerade를 항상 요구하지 않습니다
그래서 `internalTrafficPolicy: Local`의 주된 목적은 출발지 복원보다 노드를 넘는 경로를 피하는 데 있습니다
iptables의 `masqueradeAll` 설정이나 클러스터 밖 출발지가 ClusterIP로 들어오는 처리 등은 별도로 남으므로 내부 통신은 절대 SNAT되지 않는다고 일반화하면 안 됩니다

로컬 전달은 경로·지연·네트워크 비용을 줄이는 데 도움이 될 수 있습니다
그러나 노드마다 백엔드 수와 요청량이 다르면 부하가 쏠릴 수 있으며, 실제 효과는 배치와 네트워크 구성으로 확인해야 합니다

## Local은 원격 후보로 돌아가지 않는 제약입니다

`Local`은 같은 노드에서 사용할 후보를 고릅니다
로컬 후보가 비었다고 다른 노드로 보내면 이 제약을 지킬 수 없으므로 원격 후보로 fallback하지 않습니다

![kube-proxy가 Local의 로컬 후보 제한과 Cluster의 PreferSameNode 힌트 fallback을 별도로 판정하는 흐름|tall](/diagrams/k8s-theory-traffic-locality-dual-stack-1.svg)

현재 [`CategorizeEndpoints`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/topology.go)는 Cluster 정책용 집합과 Local 정책용 집합을 따로 만듭니다
판정 범위는 **해당 노드·Service 포트·주소군**입니다
Service의 전체 백엔드 주소 수만으로 이 노드가 사용할 후보를 알 수는 없습니다

### 전체 후보 부재와 로컬 후보 부재는 다른 규칙입니다

| 후보 상태 | Linux iptables·nftables의 처리 |
|---|---|
| 클러스터 전체에 사용할 후보가 없음 | `REJECT` 또는 reject chain |
| 원격 후보는 있지만 Local 정책의 로컬 후보가 없음 | 해당 Local 경로를 `DROP` |

iptables는 규칙 주석도 `has no endpoints`와 `has no local endpoints`로 구분합니다
[nftables 구현](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/nftables/proxier.go)도 같은 부재 판정을 `goto reject-chain`과 `drop`으로 나눕니다

REJECT에서는 즉시 오류를 받을 수 있고 DROP에서는 응답 없이 기다릴 수 있습니다
하지만 구체적인 오류 문구·timeout·재시도는 프로토콜과 클라이언트에 달려 있습니다
다른 Service 프록시까지 같은 오류 형태를 보장하는 설명은 아닙니다

로컬 후보 부재를 나타내는 `kubeproxy_sync_proxy_rules_no_local_endpoints_total`도 확인할 근거입니다
이름에 `_total`이 있지만 현재 [`metrics.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/metrics/metrics.go)는 **GaugeVec**으로 선언합니다

두 proxier는 Service 포트·프로토콜 항목을 순회하며 로컬 후보 부재를 집계한 뒤 `Set`합니다
라벨은 `traffic_policy`와 `ip_family`이며 internal·external을 나눕니다
누적 차단 패킷 수나 실패 연결 수로 읽으면 안 됩니다

## Ready와 종료 중 후보의 fallback을 구분합니다

EndpointSlice의 조건은 Pod가 존재하는지보다 더 구체적인 상태를 전달합니다

| 조건 | 의미·생략 시 해석 |
|---|---|
| `ready` | 트래픽 수신 준비 여부, nil은 true로 해석 |
| `serving` | 종료 상태와 별개로 계속 수신 가능한지, nil은 true로 해석 |
| `terminating` | 종료 중인지, nil은 false로 해석 |

현재 [`podToEndpoint`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/endpointslice/utils.go)는 serving을 Pod Ready에서, terminating을 deletionTimestamp에서 얻습니다
기본 ready는 `serving && !terminating`이며 `publishNotReadyAddresses`가 true이면 이 ready 조건을 덮어씁니다
따라서 Ready 후보라는 말이 모든 Service에서 종료 중이지 않은 건강한 Pod만을 뜻하지는 않습니다

Cluster 집합은 Ready 후보를 먼저 사용합니다
전체에 Ready가 없으면 `serving && terminating` 후보를 사용하며, 이 fallback에서는 지역성 힌트로 다시 좁히지 않습니다

Local 집합은 **로컬 Ready**를 먼저 사용합니다
그게 없고 로컬에 serving이면서 terminating인 후보가 있으면 그 후보를 사용합니다
다른 노드에 Ready 후보가 있어도 Local 집합의 이 판정은 독립적입니다

이것은 Local 제약을 풀어 원격 후보로 돌아가는 동작과 다릅니다
종료 중이지만 아직 serving인 로컬 후보로 전달하는 동작입니다

외부 로드밸런서는 다음 상태 검사 전까지 종료가 진행 중인 노드로 요청을 보낼 수 있습니다
이때 로컬 종료 후보로 전달하는 경로는 연결을 정리하는 **draining**을 돕습니다
로드밸런서의 상태 검사·앱의 종료 처리가 함께 맞아야 하며 무손실 종료를 보장하지는 않습니다

[공식 문서](https://kubernetes.io/docs/reference/networking/virtual-ips/#traffic-to-terminating-endpoints)에는 `ProxyTerminatingEndpoints` 게이트를 언급하는 설명이 남아 있습니다
확인한 v1.37.1의 `CategorizeEndpoints`는 별도 게이트 분기 없이 위의 Ready·Serving-Terminating 순서를 적용합니다

## trafficDistribution은 선호 조건이 맞지 않으면 범위를 넓힙니다

`trafficDistribution`은 Local 같은 제약보다 약한 선호입니다
현재 유효한 값은 다음 세 가지입니다

- `PreferSameZone`: 같은 zone의 후보를 선호하고, 그 모드가 성립하지 않으면 클러스터 범위로 돌아갑니다
- `PreferSameNode`: 같은 노드를 먼저 보고, 성립하지 않으면 같은 zone, 그다음 클러스터 범위로 돌아갑니다
- `PreferClose`: `PreferSameZone`과 같은 의미인 옛 이름이며 deprecated입니다

[`ServiceTrafficDistribution` 상수들](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/core/v1/types.go)은 세 값을 설명합니다
같은 파일의 필드 주석은 아직 PreferClose만 적지만, 현재 검증 함수와 공식 문서는 셋을 다룹니다

`PreferSameTrafficDistribution`은 v1.35부터 GA·기본 true·잠김이며 v1.37.1에도 등록돼 있습니다
옛 `ServiceTrafficDistribution` 게이트 키는 현재 [`kube_features.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go)에 없습니다
과거 게이트 활성화 절차를 현재 설정 방법으로 옮기면 안 됩니다

### 컨트롤러는 힌트를 쓰고 kube-proxy는 모드를 정합니다

EndpointSlice 컨트롤러의 [`trafficdist`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/endpointslice/trafficdist/trafficdist.go)는 Ready endpoint에 자기 zone의 `hints.forZones`를 적습니다
PreferSameNode이면 자기 노드 이름의 `hints.forNodes`도 적습니다
zone·노드 정보가 없으면 해당 힌트를 만들 수 없습니다

kube-proxy는 Ready 후보를 대상으로 모드를 결정합니다
노드 모드는 모든 Ready 후보가 노드 힌트를 갖고, 그중 적어도 하나가 자기 노드를 가리킬 때 성립합니다
노드 모드가 성립하지 않아도 모든 Ready 후보에 zone 힌트가 있고 자기 zone을 가리키는 후보가 있으면 zone 모드를 쓸 수 있습니다

zone 조건도 성립하지 않으면 지역성을 적용하지 않고 전체 Ready 후보를 사용합니다
즉 노드 힌트 하나가 빠졌다고 항상 클러스터 범위로 곧장 돌아가는 것은 아닙니다
완전한 zone 힌트가 있으면 중간 단계가 남습니다

fallback은 엔드포인트 하나를 처리하다 실패할 때마다 일어나는 것이 아닙니다
[`topologyModeFromHints`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/topology.go)에서 그 노드의 모드를 먼저 정하고 `availableForTopology`가 그 결정에 맞춰 후보를 거릅니다
모드 적용 단계에는 별도 fallback이 없습니다

### Auto 힌트와 현재 필드의 계산을 섞지 않습니다

옛 `service.kubernetes.io/topology-mode: Auto`는 zone별 allocatable CPU 비율로 후보 할당량을 계산합니다
[`topologycache`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/endpointslice/topologycache/topologycache.go)의 `overloadThreshold = 0.2`는 이 추정 계산의 기준입니다
실제 트래픽을 재서 얻은 과부하 수치가 아닙니다

계산 대상 노드의 zone·CPU 정보가 부족하거나 후보 배분 조건을 만족하지 못하면 Auto는 힌트를 만들지 않을 수 있습니다
반면 trafficDistribution의 힌트 생성은 Ready endpoint의 실제 zone·노드를 적으며 같은 CPU 비율 계산을 하지 않습니다
둘 다 실제 요청 부하를 측정해 균등하게 만드는 장치는 아닙니다

Auto 어노테이션이 설정돼 있으면 현재 [`Reconciler`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/endpointslice/reconciler.go)는 이를 trafficDistribution보다 우선합니다
그리고 어느 힌트를 만들든 Local 후보 집합에는 적용하지 않습니다
internalTrafficPolicy가 Local이면 ClusterIP는 로컬 집합을 사용하지만, 같은 Service의 외부 정책이 Cluster라면 그 경로는 힌트를 적용한 Cluster 집합을 사용할 수 있습니다

선호를 적용한 뒤에는 같은 노드·zone의 후보 수와 그곳에서 발생하는 요청량을 함께 봐야 합니다
전체 후보를 대상으로 분배해도 실제 요청 수·응답 시간·부하의 균등까지 보장되지는 않습니다

## dual-stack은 주소 할당과 주소군별 후보를 나눕니다

**dual-stack**은 IPv4와 IPv6를 함께 사용하는 구성입니다
Service에 값을 적는 것만으로 노드의 두 주소군 경로나 CNI 지원이 생기지는 않습니다
dual-stack을 지원하는 네트워크 구현과 노드 경로, Service 할당 설정이 필요하며 외부 로드밸런서의 두 주소군 지원도 별도입니다

새로 만드는 일반적인 **VIP를 가진 Service**의 `ipFamilyPolicy`는 다음과 같습니다

| 값 | Service 주소 할당 요구 |
|---|---|
| `SingleStack` 기본값 | 한 주소군만 사용 |
| `PreferDualStack` | 지원되는 dual-stack Service 구성에서는 두 주소군, 아니면 단일 주소군 |
| `RequireDualStack` | 두 주소군을 요구하며 Service 할당 구성이 single-stack이면 생성 실패 |

현재 [`alloc.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/service/storage/alloc.go)는 두 주소군 allocator가 없는 구성에서 RequireDualStack 요청을 거부합니다
PreferDualStack이 단일 주소군으로 생성되는 것은 그 자체로 오류가 아닙니다
하지만 지원하지 않는 주소군을 직접 요구하거나 필드 조합이 잘못된 요청까지 성공한다는 뜻은 아닙니다

`ipFamilies`는 IPv4·IPv6의 순서를 정하고 `clusterIPs`는 그 순서에 대응하는 VIP를 담습니다
최대 두 주소이며 주소군별로 하나씩입니다
IPv6 VIP를 받았다는 사실과 IPv6 백엔드·라우팅이 모두 준비됐다는 사실도 구분해야 합니다

![하나의 dual-stack VIP Service가 IPv4·IPv6 주소와 각각의 EndpointSlice 집합 및 후보로 나뉘며 clusterIP가 첫 주소를 가리키는 구조|tall](/diagrams/k8s-theory-traffic-locality-dual-stack-2.svg)

### EndpointSlice는 한 주소군만 담습니다

EndpointSlice의 `addressType`은 IPv4 또는 IPv6를 구분하며 생성 후 바꿀 수 없습니다
[`EndpointSliceUpdate`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/endpointschangetracker.go)는 자기 프록시 주소군과 다른 Slice를 제외합니다
IPv4 Service 트래픽이 IPv6 후보 목록을 그대로 쓰는 구조는 아닙니다

컨트롤러가 selector를 관리하는 경로에서는 주소군별로 Slice 집합을 만듭니다
각 집합 안에서도 포트 조합과 엔드포인트 수, 기존 Slice 재사용 이력에 따라 조각 수가 달라집니다
따라서 VIP 두 개가 있다고 EndpointSlice도 정확히 두 개라고 계산할 수는 없습니다

관리 대상 주소군에 남길 Slice가 없으면 Reconciler가 빈 placeholder Slice를 만들기도 합니다
Slice 오브젝트가 있다는 사실만으로 사용할 백엔드가 있다고 판단해서는 안 됩니다
`FQDN` addressType은 deprecated이며 현재 기본 컨트롤러·kube-proxy의 IP 처리와 같은 의미로 정의돼 있지 않습니다

### primary의 불변 규칙은 VIP Service 범위로 읽습니다

일반 VIP Service에서 `clusterIPs[0]`은 기존 단수 필드 `clusterIP`와 같아야 합니다
그 주소에 대응하는 `ipFamilies[0]`이 primary 주소군입니다
둘째 주소군을 추가하거나 SingleStack으로 바꿔 제거할 수 있어도 기존 primary를 뒤집을 수는 없습니다

[`ValidateServiceClusterIPsRelatedFields`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go)는 단수·복수 필드의 일치를 검사합니다
업데이트 검증도 일반 VIP Service의 primary 주소와 주소군 변경을 막습니다
ExternalName 전환 등 타입별 처리까지 무시한 모든 Service의 절대 불변 규칙으로 넓히면 안 됩니다

다른 타입도 단수 필드가 복수 필드의 첫 값을 가리키는 형태로 호환성을 유지합니다

| 단수 필드 | 대응하는 첫 항목 |
|---|---|
| Service `spec.clusterIP` | `spec.clusterIPs[0]` |
| Node `spec.podCIDR` | `spec.podCIDRs[0]` |
| Pod `status.podIP` | `status.podIPs[0].ip` |
| Pod `status.hostIP` | `status.hostIPs[0].ip` |

옛 단수 필드를 읽는 클라이언트는 첫 값만 봅니다
[KEP-563](https://github.com/kubernetes/enhancements/blob/0c8d11e9a13e12d2ef75d2d78af5ac00d8189046/keps/sig-network/563-dual-stack/README.md)도 기존 primary ClusterIP의 변경 금지와 클러스터 전환 시 첫 Service CIDR 주소군 유지 조건을 설명합니다
이 KEP의 과거 설계 설명과 현재 서버 검증은 별도 근거입니다

### headless와 selectorless에는 별도 조건이 있습니다

headless Service는 `clusterIP: None`이며 두 VIP를 할당하는 대상이 아닙니다
현재 업데이트 검증은 headless의 주소군 변경을 일반 VIP Service와 다르게 취급합니다
따라서 VIP의 primary 불변 설명을 headless에 그대로 적용할 수는 없습니다

특히 **headless이면서 selector가 없는 Service를 새로 만들 때**는 ipFamilyPolicy를 생략하면 기본값으로 RequireDualStack을 넣습니다
alloc.go는 이 경로를 일반 allocator 검사보다 먼저 처리하며 single-stack Service 할당 구성에서도 복수 주소군을 허용합니다
VIP를 할당하지 않는 특수 경로이므로 일반 VIP Service의 RequireDualStack 실패 조건과 구분해야 합니다

selector가 없는 Service의 EndpointSlice는 기본 컨트롤러가 자동으로 만들지 않습니다
실제 백엔드를 제공하는 별도 관리 주체와 그 주소군·경로가 필요합니다
headless 여부와 selector 유무를 하나의 조건으로 합쳐 판단해서는 안 됩니다

### primary는 DNS와 클라이언트의 주소 선택을 고정하지 않습니다

일반 Service의 DNS A·AAAA 레코드는 해당 Service의 주소군에 대응합니다
headless는 VIP 대신 백엔드 주소를 응답하므로 경로가 다릅니다
[DNS 공식 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/services-networking/dns-pod-service.md)가 두 형태를 구분합니다

IPv4가 primary라는 이유만으로 클라이언트가 항상 IPv4를 선택하거나 IPv6 호출이 실패한다고 결론 낼 수는 없습니다
전체 clusterIPs, A·AAAA 응답, 클라이언트의 주소 선택과 실제 백엔드 경로를 각각 확인해야 합니다

## 후보 부재와 주소군 실패를 따로 확인합니다

다음은 실측 장애 기록이 아니라 코드의 분기와 필드 조건에 따른 확인 기준입니다

| 상황 | 구분할 근거 |
|---|---|
| 다른 노드에는 백엔드가 있지만 ClusterIP가 응답하지 않음 | internalTrafficPolicy, 그 노드·포트·주소군의 로컬 Ready·Serving-Terminating 후보 |
| 외부에서 특정 노드로 들어온 요청만 실패 | externalTrafficPolicy, 로컬 후보와 외부 유입·로드밸런서 경로 |
| Service가 즉시 거절되는 것처럼 보임 | 전체 usable 후보 부재의 REJECT인지, 다른 프록시·앱 오류인지 |
| PreferSameNode인데 같은 노드로만 가지 않음 | 전체 Ready 후보의 노드 힌트 완전성·자기 노드 매치, 이후 zone 조건 |
| PreferSameZone인데 클러스터 범위로 퍼짐 | Ready 후보의 zone 힌트 완전성, 이 노드 zone 라벨과 매치 |
| 필드가 있어도 지역성이 적용되지 않음 | 대응 방향 Local 여부, Auto 어노테이션 우선, 실제 프록시 지원·힌트 |
| PreferDualStack인데 VIP가 하나뿐임 | 실제 Service 할당 주소군 구성과 저장된 ipFamilies·ipFamilyPolicy |
| IPv6 클라이언트만 실패 | IPv6 VIP·Slice·후보 조건·경로, DNS 응답과 클라이언트 주소 선택 |
| 주소군 순서를 바꾸는 업데이트가 거절됨 | VIP/headless 구분과 primary 변경 금지·필드 정합성 |

전체 Service에 주소가 있다는 사실과 이 노드의 이 주소군에서 사용할 후보가 있다는 사실은 다릅니다
Local의 원격 fallback 금지, 힌트 모드의 범위 확장, Ready에서 종료 후보로 내려가는 판단을 구분해야 어느 단계에서 후보가 사라졌는지 알 수 있습니다

## 확인한 근거

- [Virtual IPs·트래픽 정책·분배](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/networking/virtual-ips.md), [내부 정책](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/services-networking/service-traffic-policy.md), [Auto 방식](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/services-networking/topology-aware-routing.md) — 제약·선호·draining과 힌트 조건
- [후보 분류·모드 선택](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/topology.go), [iptables](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/iptables/proxier.go), [nftables](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/nftables/proxier.go) — Cluster/Local 독립 분류·fallback·NAT·REJECT/DROP
- [dual-stack 공식 저장본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/services-networking/dual-stack.md), [Service 할당](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/service/storage/alloc.go), [현재 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go) — VIP·주소군·headless 특수 경로·primary 규칙
- [EndpointSlice 타입](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/discovery/v1/types.go), [Reconciler](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/endpointslice/reconciler.go) — 주소군·준비/종료 조건·힌트 우선순위·빈 placeholder
