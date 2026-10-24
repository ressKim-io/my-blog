---
title: "Service와 kube-proxy — 고정 주소 뒤의 목록·규칙·연결 상태"
excerpt: "EndpointSlice 갱신이 노드별 전달 규칙으로 바뀌는 흐름을 따라갑니다. iptables·IPVS·nftables의 조회와 분배, conntrack, NodePort·Local 정책과 Cilium 소켓 경로의 차이를 구분합니다"
category: "kubernetes"
tags: ["Kubernetes", "Service", "kube-proxy", "EndpointSlice", "conntrack", "concept"]
series:
  name: "k8s-theory-network"
  order: 4
date: "2026-10-07"
---

Pod가 교체되면 주소도 바뀔 수 있습니다
Service의 ClusterIP는 그 백엔드 변경과 별도로 유지할 수 있는 접점을 제공합니다

그렇다면 Service 주소로 보낸 패킷은 누가 실제 백엔드로 전달할까요?
kube-proxy를 사용하는 Linux 구성에서는 각 노드의 kube-proxy가 규칙을 만들고 노드 커널이 패킷을 처리합니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> Kubernetes ref: `f78e722310e50bcaca9276be22276d9e91d91308`, 공식 문서 저장본: `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> NAT 기전은 Linux v6.12 소스, kube-proxy 대체 예시는 Cilium v1.20.3 공식 문서와 대조했습니다
> 실제 노드의 프록시 모드·플러그인·sysctl이나 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## 백엔드 목록과 패킷 전달은 다른 흐름입니다

**EndpointSlice**는 Service 뒤에 있는 주소·포트와 상태를 나눠 담는 오브젝트입니다
Service에는 선택 기준인 selector가 있고, EndpointSlice에는 실제 백엔드 목록이 있습니다

[`EndpointSlice controller`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/endpointslice/endpointslice_controller.go)는 selector가 있는 Service와 같은 namespace의 Pod를 찾아 목록을 갱신합니다
각 노드의 kube-proxy는 Service·EndpointSlice를 관찰하고 자기 노드의 전달 규칙에 반영합니다

![EndpointSlice controller의 목록 갱신과 kube-proxy의 규칙 설정, 노드 커널의 패킷 전달을 구분한 iptables 대표 경로|tall](/diagrams/k8s-theory-service-kube-proxy-1.svg)

패킷마다 controller나 API 서버가 백엔드를 골라 주는 구조는 아닙니다
규칙이 준비된 뒤에는 노드 커널이 자신을 통과하는 패킷을 처리합니다
kube-proxy의 [`ServiceConfig`·`EndpointSliceConfig` 등록](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kube-proxy/app/server.go)과 각 proxier의 규칙 동기화가 이 두 흐름을 연결합니다

모든 노드가 같은 오브젝트를 보더라도 규칙이 바이트 단위로 같지는 않습니다
노드 이름과 로컬 백엔드, 트래픽 정책에 따라 각자 사용할 후보가 달라집니다

### 주소 목록을 나눠 변경된 조각을 전달합니다

목록 전체를 하나의 오브젝트로 관리하면 주소 하나의 변경도 큰 목록의 재전송으로 이어집니다
EndpointSlice는 목록을 나눠 변경된 조각을 전달하도록 합니다

기본 상한은 조각당 100개이며 `--max-endpoints-per-slice`로 바꿀 수 있고 설정 상한은 1000입니다
[공식 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/services-networking/endpoint-slices.md)와 [플래그·검증 코드](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kube-controller-manager/app/options/endpointslicecontroller.go)가 같은 조건을 설명합니다

조각을 크게 하면 오브젝트 수는 줄지만 변경 시 전달하는 오브젝트가 커집니다
작게 하면 변경 단위는 작아지는 대신 전체 목록을 이루는 오브젝트 수가 늘어납니다
모든 조각이 항상 상한까지 채워진다는 뜻도 아닙니다

기존 `Endpoints` API는 v1.33부터 deprecated입니다
현재 [`types.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/core/v1/types.go)도 모든 Service 기능을 담지 못하는 레거시 API라고 설명합니다

selector가 없는 Service에는 기본 controller가 EndpointSlice를 자동으로 만들지 않습니다
다른 관리 주체가 목록을 제공할 수 있으며 그 주소가 반드시 Pod일 필요도 없습니다

## ClusterIP 할당과 백엔드 선택은 별도 작업입니다

ClusterIP는 API 서버의 Service 주소 할당 경로가 선택해 오브젝트에 기록합니다
[CNI 계약](/essays/k8s-theory-cni-contract)에서 본 Pod 주소 할당과 주체·대역·용도가 다릅니다

이 주소가 반드시 어떤 인터페이스에도 붙지 않는다고 일반화하면 안 됩니다
iptables·nftables 모드는 일반적으로 주소를 규칙의 매치 대상으로 사용하지만, IPVS는 ClusterIP를 `kube-ipvs0` dummy interface에 바인딩합니다
현재 [`syncService`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/ipvs/proxier.go)와 ClusterIP 처리 분기에서 이 예외를 확인할 수 있습니다

어느 모드든 주소를 할당하는 것만으로 백엔드에 패킷을 전달할 수 있는 것은 아닙니다
그 주소를 어떻게 처리할지 데이터 평면의 규칙과 구현이 필요합니다

### Service 타입은 접근점을 구분합니다

| 타입 | 제공하는 접점 |
|---|---|
| `ClusterIP` | 클러스터 내부의 Service IP |
| `NodePort` | ClusterIP에 노드 포트를 추가 |
| `LoadBalancer` | 일반적으로 ClusterIP·NodePort에 외부 로드밸런서를 추가 |
| `ExternalName` | 다른 이름을 가리키는 DNS CNAME |

NodePort의 기본 할당 범위는 30000~32767이며 API 서버의 `--service-node-port-range`로 설정합니다
[Service 공식 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/services-networking/service.md)는 이 범위와 타입별 동작을 설명합니다

LoadBalancer의 `spec.allocateLoadBalancerNodePorts`는 기본 true입니다
Pod로 직접 전달하는 로드밸런서 구현 등에서는 false로 두어 NodePort 자동 할당을 끌 수 있습니다
이미 할당된 nodePort는 이 필드를 false로 바꿔도 자동으로 해제되지 않으며 각 포트의 기존 값을 별도로 제거해야 합니다

ExternalName은 이 주소·포트 계층에 포함되지 않습니다
DNS로 다른 이름을 알려 줄 뿐 그 이름을 향한 Pod 트래픽을 kube-proxy가 대신 프록시하지는 않습니다

### headless는 Service 주소를 거치는 단계를 생략합니다

`spec.clusterIP: None`인 headless Service에는 ClusterIP를 할당하지 않습니다
해당 가상 주소를 처리하는 kube-proxy 규칙도 만들지 않습니다
[`ShouldSkipService`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/util/utils.go)는 이런 Service와 ExternalName을 프록시 대상에서 제외합니다

selector가 있으면 DNS는 ClusterIP 대신 EndpointSlice의 백엔드 주소를 제공합니다
클라이언트는 그중 하나를 고르거나 특정 백엔드를 직접 지목합니다
백엔드 선택과 연결 유지의 책임도 클라이언트 쪽으로 이동합니다

이 Service에 대한 ClusterIP DNAT가 없다는 설명입니다
실제 백엔드 주소로 보내는 일반 패킷의 conntrack까지 사라진다는 뜻은 아닙니다

## iptables는 Service를 찾은 뒤 확률로 백엔드를 고릅니다

iptables 모드에서 `KUBE-SERVICES`는 패킷의 목적지에 맞는 Service를 찾습니다
해당 `KUBE-SVC-…` 체인으로 들어가 백엔드를 선택하고 `KUBE-SEP-…`에서 실제 목적지로 변환합니다

**DNAT(Destination NAT)**는 패킷의 목적지 주소·포트를 바꾸는 처리입니다
여기서는 클라이언트가 사용한 Service IP·포트를 실제 백엔드 IP·포트로 바꿉니다

[`portProtoHash`와 관련 함수](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/iptables/proxier.go)는 ServicePortName과 프로토콜을 해시해 체인 이름 뒤의 16자를 만듭니다
백엔드 체인의 해시에는 endpoint도 포함되므로 같은 Service 안에서도 이름이 나뉩니다

Service를 찾는 단계와 그 Service의 백엔드를 고르는 단계는 다른 검색입니다
기본 백엔드 선택은 부하나 응답 시간을 측정하지 않고 확률적 매치로 처리합니다

![세 백엔드의 첫 규칙은 1/3, 다음 규칙은 남은 요청의 1/2, 마지막 규칙은 나머지를 선택하는 iptables 개념 예](/diagrams/k8s-theory-service-kube-proxy-2.svg)

N개 백엔드에 대해 첫 규칙은 `1/N`, 다음은 남은 요청에 `1/(N-1)`을 적용합니다
마지막 규칙에는 확률 조건을 넣지 않아 남은 요청이 매치하도록 합니다
각 백엔드의 기대 선택 비율이 같아지는 방식이며 실제 요청 수나 처리 부하가 언제나 같다는 보장은 아닙니다

`sessionAffinity: ClientIP`를 사용하면 같은 출발지가 이전에 고른 백엔드로 가도록 기억할 수 있습니다
이 역시 부하를 측정해 더 한가한 서버를 고르는 기능은 아닙니다

## conntrack은 변환을 기억해 재사용하고 응답을 되돌립니다

**conntrack**은 커널이 연결의 흐름과 NAT 상태를 추적하는 기능입니다
Service로 보낸 패킷을 백엔드로 바꿨다면 응답에서도 그 변환과 대응되는 처리가 필요합니다
클라이언트에는 응답의 출발지가 자신이 사용한 Service 주소로 보이도록 되돌립니다

이미 NAT가 설정된 흐름은 같은 변환을 재사용합니다
백엔드 선택 규칙을 모든 후속 패킷에서 처음부터 다시 평가하지는 않습니다
[Linux v6.12의 `nf_nat_inet_fn`](https://github.com/torvalds/linux/blob/adc218676eef25575469234709c2d87185ca223a/net/netfilter/nf_nat_core.c)은 NAT 초기화 여부에 따라 설정 경로와 기존 변환 적용 경로를 나눕니다

따라서 iptables의 Service 순차 검색 비용은 **새 NAT 연결을 설정하는 경로**와 연결해서 봐야 합니다
기존 흐름에서도 conntrack 조회나 필터링 비용은 남으므로 기존 연결의 처리 비용이 0이 되는 것은 아닙니다

### UDP의 낡은 변환과 표 포화는 다른 문제입니다

백엔드 목록에서 주소를 지워도 이미 남은 연결 상태가 그 주소를 가리킬 수 있습니다
[`CleanStaleEntries`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/conntrack/cleanup.go)는 UDP Service의 기존 흐름을 현재 serving endpoint 목록과 대조해 낡은 엔트리를 정리합니다

이 경로는 원래 목적지의 Service 주소·포트와 응답 방향의 백엔드 주소·포트를 구분합니다
TCP도 실패와 timeout이 있지만 이 정리 루틴이 겨냥하는 것은 UDP입니다
특히 단방향 UDP가 계속 엔트리를 갱신하면 사라진 백엔드로 트래픽을 보낼 수 있다고 주석이 설명합니다

모든 UDP 엔트리를 무조건 정리하는 것도 아닙니다
현재 코드는 serving endpoint가 없는 Service의 **NodePort만을 기준으로 한 삭제**는 다른 호스트의 같은 포트 흐름까지 지울 수 있어 생략합니다
Service IP·포트 기준의 정리와 NodePort 기준의 정리 조건이 다릅니다

conntrack 표가 가득 차는 것은 별도의 용량 문제입니다
원래 백엔드와 어긋난 상태가 남는 문제와 같은 원인으로 묶으면 안 됩니다

| kube-proxy 설정·플래그 | 기본값 | 역할 |
|---|---:|---|
| `--conntrack-max-per-core` | `32768` | CPU 수에 따른 엔트리 수 계산 |
| `--conntrack-min` | `131072` | 계산 시 비교할 최소값 |
| `--conntrack-tcp-timeout-established` | `24h` | established TCP 흐름의 idle timeout |

기본값은 [`SetDefaults_KubeProxyConfiguration`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/apis/config/v1alpha1/defaults.go)에 있습니다
현재 [`getConntrackMax`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/conntrack/sysctls.go)는 `MaxPerCore × CPU 수`가 1,048,576을 넘으면 먼저 그 값으로 제한합니다
그 외에는 계산값과 Min 중 큰 값을 사용합니다

CPU 수는 노드의 online CPU 수를 읽고 실패하면 `runtime.NumCPU()`로 대체합니다
MaxPerCore를 0으로 두면 이 경로에서 용량을 변경하지 않습니다
이 설정값을 확인한 것과 실제 노드의 `nf_conntrack_max`·사용량을 측정한 것은 별도입니다

## 프록시 모드는 조회 구조와 분배 방식을 함께 봐야 합니다

확인한 v1.37.1의 Linux 기본 모드는 여전히 `iptables`입니다
[`platformApplyDefaults`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kube-proxy/app/server_linux.go)가 모드를 생략했을 때 이 값을 넣습니다

| 모드 | Service 조회·주소 처리 | 기본 백엔드 선택·현재 상태 |
|---|---|---|
| `iptables` | Service 규칙 순차 대조 | 확률적 선택, 현재 기본 모드 |
| `ipvs` | 해시 기반 조회, ClusterIP를 `kube-ipvs0`에 바인딩 | 기본 scheduler `rr`, v1.35부터 deprecated |
| `nftables` | 주소·프로토콜·포트 키의 verdict map | 기본 무작위 선택, v1.33 GA이며 현재 기본 모드는 아님 |

nftables의 **verdict map**은 키를 조회해 실행할 체인 등의 동작을 얻는 표입니다
[`service-ips`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/nftables/proxier.go)는 목적지 주소·프로토콜·포트로 Service 처리를 찾습니다
그 뒤 백엔드 선택에는 `numgen random mod …`를 사용하므로 map 조회를 round robin 분배와 혼동하면 안 됩니다

IPVS는 지정한 scheduler로 백엔드를 고릅니다
별도 설정이 없으면 소스의 `defaultScheduler: rr`을 사용하며 iptables의 확률 규칙과 같은 알고리즘이 아닙니다

[공식 nftables 블로그](https://kubernetes.io/blog/2025/02/28/nftables-kube-proxy/)는 iptables의 Service 조회를 Service 수에 대해 `O(n)`, nftables map 조회를 대략 `O(1)`로 설명합니다
이는 새 연결의 Service 탐색 구조에 대한 비교이며 전체 패킷 처리 시간이나 모든 기능의 비용이 상수라는 뜻은 아닙니다

규칙 조회와 규칙 갱신도 구분해야 합니다
조회는 새 NAT 연결을 만들 때, 갱신은 Service·EndpointSlice 변경을 커널에 반영할 때 발생합니다
nftables의 map과 증분 갱신은 이 두 비용을 줄이는 데 쓰이지만 어느 모드가 얼마나 빠른지는 실제 규모와 설정으로 측정해야 합니다

### GA, 기본 선택, 폐기는 서로 다른 상태입니다

[`NFTablesProxyMode`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go)는 GA·기본 on·잠김입니다
기능 게이트가 켜져 있어도 프록시 모드는 별도로 선택합니다
`mode: nftables` 설정이나 `--proxy-mode=nftables`가 이 선택입니다

IPVS 모드는 deprecated됐지만 이 고정본에서 제거되지는 않았습니다
`KubeProxyIPVS` 게이트는 Deprecated·기본 true이며 끌 수 있습니다
빠른 조회 자료구조를 쓴다는 사실만으로 Service의 모든 경계 동작을 정확하게 구현했다는 뜻은 아니라는 점도 [현재 공식 문서](https://kubernetes.io/docs/reference/networking/virtual-ips/#proxy-mode-ipvs)가 설명합니다

nftables 모드는 Linux kernel 5.13 이상과 `nft` 1.0.1 이상을 요구합니다
[`supported.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/nftables/supported.go)의 검사와 공식 지원 조건을 함께 확인해야 합니다
v1.37의 `NFTablesNetlink`는 Beta·기본 on이지만 일부 List 경로를 netlink로 바꾸는 기능이며 `nft` 요구를 없애지 않습니다

### NodePort에서 받아들이는 주소도 모드에 따라 다릅니다

iptables·IPVS의 기본 `nodePortAddresses`는 모든 로컬 주소를 대상으로 합니다
nftables 모드는 기본값을 `primary`로 넣어 노드의 주 IPv4·IPv6 주소로 제한합니다
따라서 모드만 바꿔도 NodePort에 접속할 수 있는 주소가 달라질 수 있습니다

localhost도 같은 동작으로 가정하면 안 됩니다
iptables는 IPv4에서 loopback 주소가 허용 범위에 들고 `iptables.localhostNodePorts`가 켜져 있어야 하며 이 경우 `route_localnet`을 설정합니다

nftables의 localhost NodePort는 `KubeProxyNFTablesLocalhostNodePorts`가 Alpha·기본 off입니다
이를 켜고 `nodePortAddresses`에 `localhost`처럼 loopback을 명시적으로 포함해야 합니다
확인한 구현의 보조 userspace 프록시는 **TCP만** 처리하므로 UDP까지 같은 지원으로 일반화하면 안 됩니다

근거는 [`--nodeport-addresses` 설명](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kube-proxy/app/options.go)과 [nftables의 localhost 처리](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/nftables/proxier.go)입니다

## externalTrafficPolicy Local은 후보를 줄여 출발지 보존을 돕습니다

외부에서 들어오는 트래픽의 기본 `externalTrafficPolicy`는 `Cluster`입니다
클러스터 전체의 사용 가능한 백엔드를 선택할 수 있어 다른 노드로도 전달할 수 있습니다
이 경로의 masquerade는 응답을 변환 상태가 있는 유입 노드로 돌아오게 합니다

`Local`은 해당 노드의 백엔드만 사용합니다
다른 노드로 보내는 전달을 피하므로 출발지 주소를 보존하기 쉽지만 로컬 후보가 없으면 외부 트래픽을 전달할 곳이 없습니다

iptables 구현은 전체 백엔드의 `KUBE-SVC-…`, 로컬 백엔드의 `KUBE-SVL-…`, 출발지에 따라 분기하는 `KUBE-EXT-…` 체인을 구분합니다
[`syncProxyRules`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/iptables/proxier.go) 주석도 Local에서 출발지를 보존할 수 있는 범위를 대부분의 경우로 한정합니다
호스트에서 시작한 트래픽이나 Pod에서 Service의 외부 주소로 보내는 트래픽까지 모두 같은 규칙으로 묶으면 안 됩니다

백엔드가 있는지도 단순히 주소 목록 길이만으로 판단하지 않습니다
현재 [`CategorizeEndpoints`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/topology.go)는 기본적으로 Ready 후보를 쓰며 해당 범위에 Ready가 없으면 serving·terminating 후보로 fallback할 수 있습니다
이 판단은 Cluster와 Local 후보에 각각 적용되므로 로컬 백엔드의 준비·종료 조건도 함께 봐야 합니다

전체 클러스터에서 사용할 백엔드가 없으면 iptables는 Service 트래픽에 REJECT 규칙을 만듭니다
전체 후보는 있지만 Local 정책에 맞는 로컬 후보가 없으면 해당 경로에 DROP을 사용합니다
즉시 거절과 무응답을 모두 같은 백엔드 부재로 확정해서는 안 됩니다

Local은 백엔드별 부하 균등도 보장하지 않습니다
외부 로드밸런서가 노드를 얼마나 자주 고르는지와 각 노드가 가진 백엔드 수가 함께 영향을 줍니다

## Cilium 소켓 경로는 Service를 조회하는 위치를 옮깁니다

kube-proxy를 대체하는 모든 구현이 같은 위치에서 주소를 바꾸는 것은 아닙니다
[Cilium v1.20.3 문서](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/network/kubernetes/kubeproxy-free.rst)는 소켓 레벨 로드밸런싱 경로를 설명합니다

![TCP connect의 kube-proxy 패킷 변환과 Cilium socket hook의 목적지 변경을 비교하고 TC 우회 경로를 표시한 그림|tall](/diagrams/k8s-theory-service-kube-proxy-3.svg)

TCP와 connected UDP는 `connect`, unconnected UDP는 `sendmsg`·`recvmsg` 경로를 구분합니다
소켓 hook에서 Service 주소를 확인해 백엔드를 고르면 앱에는 Service에 연결한 것처럼 보이지만 커널 소켓의 실제 목적지는 백엔드 주소가 됩니다
소켓 단계에서 목적지를 바꿨으므로, 이 경로의 패킷은 이후 전달 단계에서 Service NAT를 추가로 거칠 필요가 없습니다

`socketLB.hostNamespaceOnly=true`로 Pod namespace에서 소켓 단계의 주소 변환을 우회하면 veth의 TC 프로그램에서 Service 조회가 다시 일어날 수 있습니다
따라서 소켓 경로의 특징을 모든 eBPF 구현에 적용하거나 conntrack 일반이 사라진다고 해석하면 안 됩니다
`KUBE-SVC-…`가 없다는 사실만으로 Service가 구현되지 않았다고 판단할 수도 없습니다

CNI가 네트워크 attachment를 붙이는 계약과 Service 처리의 구현 선택은 별개입니다
실제 설치 버전·활성 경로와 커널 지원을 확인해야 하며 여기서는 플러그인을 전환하거나 연결의 성능을 측정하지 않았습니다

## 실패 지점은 할당·목록·규칙·연결 상태로 나눕니다

다음은 소스의 오류 문구와 조건을 정리한 것으로 실제 장애 기록은 아닙니다

| 증상·문구 | 구분할 근거 |
|---|---|
| `range is full` | Service 주소 할당 대역의 잔여 공간, Pod 주소 대역과 구분 |
| `provided IP is already allocated` | 지정한 ClusterIP의 기존 할당 |
| Service 접속 거절·무응답 | EndpointSlice 조건, 전체 후보와 정책에 맞는 로컬 후보, REJECT·DROP 경로 |
| 주소 목록은 있지만 연결되지 않음 | 백엔드의 실제 수신 포트와 Service targetPort, Pod 네트워크 경로 |
| 삭제한 백엔드로 UDP가 계속 향함 | 현재 serving 목록과 낡은 conntrack 변환, 정리 조건 |
| `nf_conntrack: table full` 계열 로그 | 노드의 실제 conntrack 용량과 사용량 |
| 새 연결이 느리거나 변경 반영이 늦음 | 규칙 조회 비용과 규칙 동기화 비용을 분리 |
| Local에서 특정 노드로만 연결 실패 | 해당 노드의 사용 가능한 로컬 백엔드와 외부 유입 경로 |
| iptables Service 체인이 없는데 통신됨 | 실제 proxy mode와 kube-proxy 대체 데이터 경로 |

주소가 할당됐는지, 사용할 백엔드가 있는지, 노드 규칙이 반영됐는지, 기존 변환 상태가 무엇을 가리키는지는 각각 다른 질문입니다
새 연결과 이미 유지 중인 흐름을 구분하면 목록을 바꾼 뒤에도 이전 목적지로 향하는 이유를 더 정확하게 확인할 수 있습니다

## 확인한 근거

- [Service 공식 저장본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/services-networking/service.md), [EndpointSlice](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/services-networking/endpoint-slices.md), [Virtual IPs](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/networking/virtual-ips.md) — 타입·목록·프록시와 정책 조건
- [iptables proxier](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/iptables/proxier.go), [IPVS proxier](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/ipvs/proxier.go), [nftables proxier](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/nftables/proxier.go) — 모드별 조회·분배·주소·정책 구현
- [conntrack 정리](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/conntrack/cleanup.go), [용량·sysctl 설정](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/conntrack/sysctls.go) — UDP stale entry와 현재 용량 계산
- [Linux v6.12 NAT 기전](https://github.com/torvalds/linux/blob/adc218676eef25575469234709c2d87185ca223a/net/netfilter/nf_nat_core.c), [Cilium v1.20.3의 소켓 LB·TC 우회](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/network/kubernetes/kubeproxy-free.rst) — 별도 버전 근거이며 실제 설치 상태는 확인하지 않음
