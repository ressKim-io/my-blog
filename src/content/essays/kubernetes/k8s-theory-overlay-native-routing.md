---
title: "Overlay와 native routing — 노드 간 경로와 주소 공급을 구분하기"
excerpt: "다른 노드의 Pod로 가는 패킷을 캡슐화할지, Pod IP로 직접 라우팅할지 비교합니다. nodeipam·Cilium IPAM의 역할과 ENI 주소 한도, underlay 주소군별 MTU·큰 패킷 실패 조건을 구분합니다"
category: "kubernetes"
tags: ["Kubernetes", "CNI", "Routing", "Cilium", "IPAM", "MTU", "concept"]
series:
  name: "k8s-theory-network"
  order: 3
date: "2026-10-05"
---

다른 노드의 Pod로 패킷을 보내려면 Pod 안의 인터페이스만 준비해서는 부족합니다
출발 노드에서 목적지 노드와 Pod까지 이어지는 전달 경로가 필요합니다

**Overlay**는 원래 Pod 패킷을 노드 간 패킷 안에 넣어 보냅니다
**Native routing**은 캡슐화하지 않고 Pod 주소로 경로를 찾습니다
한편 그 Pod 주소를 어디서 할당받는지는 별도의 IPAM 선택입니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> Kubernetes ref: `f78e722310e50bcaca9276be22276d9e91d91308`, website 저장본: `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 외부 구현 예시는 Cilium v1.20.3, ref `bf1aba7b34ab6d9c711315d78d8eefbea81962d1`로 고정했습니다
> 패킷 형식은 RFC 7348·8926·8200을 확인했으며, 실제 클러스터의 설치 버전·패킷 캡처·성능 실측은 포함하지 않습니다

## Kubernetes의 통신 요구와 구현의 전달 방식을 구분합니다

[Kubernetes 네트워크 모델](https://kubernetes.io/docs/concepts/services-networking/)은 의도적인 네트워크 격리 등을 제외하면 Pod들이 노드 경계를 넘어 직접 통신할 수 있어야 한다고 요구합니다
이 통신을 VXLAN으로 구현할지 하부 네트워크의 라우팅으로 구현할지는 정하지 않습니다

하부 네트워크인 **underlay**는 노드들을 실제로 연결하는 네트워크입니다
Overlay를 사용하면 그 위에 터널을 구성하고, native routing을 사용하면 그 네트워크의 라우팅 기능을 활용합니다

Pod IP의 할당·관리를 뜻하는 **IPAM**은 패킷 전달 방식과 구분해야 합니다
노드별 CIDR을 받아 주소를 나눌 수도 있고, 네트워크 구현의 주소 풀이나 클라우드 VPC 주소를 사용할 수도 있습니다

따라서 VPC 주소를 Pod에 직접 주는 것을 overlay·native routing과 나란한 세 번째 전달 방식으로 분류하면 관계가 흐려집니다
Cilium의 AWS ENI는 VPC 주소 공급과 native routing을 결합하는 사례입니다

![Overlay는 Pod 패킷에 노드 주소의 바깥 헤더를 붙이고 native routing은 Pod 주소 그대로 전달하므로 하부 네트워크에 필요한 경로가 달라지는 비교|tall](/diagrams/k8s-theory-overlay-native-routing-1.svg)

## Overlay는 노드 주소로 원래 패킷을 운반합니다

출발 노드는 원래 Pod 패킷에 바깥 헤더를 붙여 목적지 노드로 보냅니다
목적지 노드는 이를 제거하고 원래 목적지 Pod로 전달합니다

하부 네트워크가 라우팅에 사용하는 주소는 바깥쪽 노드 IP입니다
따라서 하부 네트워크가 Pod 주소 범위의 경로까지 알 필요는 없습니다
네트워크 구현은 목적지 Pod가 어느 노드에 있는지 알고 적절한 터널 종단을 선택해야 합니다

Cilium은 노드 간 UDP 기반 터널 메시를 구성하며, 새 노드의 정보를 받아 터널에 편입합니다
새 노드가 자동으로 편입되려면 노드끼리 통신할 수 있고 방화벽도 터널 패킷을 허용해야 합니다

Cilium v1.20.3의 기본 터널 프로토콜은 VXLAN이며 기본 포트는 `8472/UDP`입니다
Geneve를 선택하면 기본 포트는 `6081/UDP`입니다
이 포트는 해당 Cilium 설정의 기본값이며 모든 VXLAN 구현의 고정 포트라는 뜻은 아닙니다

설정의 `tunnel-protocol`·`tunnel-port`와 주소군을 고르는 `underlay-protocol`은 각각 별도 항목입니다
`underlay-protocol: auto`는 활성화한 주소군에 따라 선택하며, IPv4·IPv6를 모두 켰을 때 IPv4를 우선합니다
Pod IP의 주소군만 보고 바깥 터널 헤더의 주소군을 결정할 수는 없습니다

이 동작과 기본값은 [Cilium routing 설명](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/network/concepts/routing.rst)을 기준으로 확인했습니다

## Native routing은 Pod 경로가 하부 네트워크에 연결돼야 합니다

Native routing은 터널 캡슐화 대신 Linux 커널의 라우팅을 활용합니다
노드에는 목적지 Pod로 가는 다음 홉이 필요하고, 하부 네트워크도 그 Pod 주소를 전달할 수 있어야 합니다

각 노드가 모든 Pod의 개별 경로를 가져야만 하는 것은 아닙니다
모든 Pod로 가는 경로를 아는 라우터가 있다면 노드가 그 라우터를 향하는 기본 경로를 사용할 수도 있습니다
반대로 노드별 Pod CIDR 경로를 각 노드에 설치하는 구성도 가능합니다

같은 L2 네트워크의 노드에서는 Cilium의 `auto-direct-node-routes: true`로 직접 경로를 설치할 수 있습니다
L2는 같은 링크 계층 네트워크를 뜻하며, 이 설정만으로 서로 다른 모든 네트워크의 라우터 경로가 만들어지는 것은 아닙니다
다른 토폴로지에서는 라우터 설정이나 BGP 같은 경로 배포 수단이 필요할 수 있습니다

설정 형식도 구분해야 합니다
ConfigMap의 `routing-mode: native`와 `auto-direct-node-routes: true`는 Helm values에서 각각 `routingMode: native`와 `autoDirectNodeRoutes: true`에 대응합니다
이름이 비슷해도 서로 다른 설정 형식의 키를 섞어 쓰면 안 됩니다

### 두 전달 방식의 선택 기준은 경로 요구와 헤더 비용입니다

| 방식 | 하부 네트워크에 요구하는 것 | 함께 감당할 조건 |
|---|---|---|
| Overlay | 노드 IP로 터널 패킷 전달 | 터널 종단 관리·UDP 허용·캡슐화에 필요한 MTU 공간 |
| Native routing | Pod 주소로 전달할 수 있는 경로 | 노드·라우터·클라우드의 경로 일치와 배포 |

Overlay는 하부 네트워크에 Pod 경로를 배포하는 부담을 줄입니다
Native routing은 하부 네트워크에 Pod 주소를 전달할 경로가 필요한 대신 터널 캡슐화 헤더를 더하지 않습니다

이 차이만으로 실제 처리량이나 지연의 우위를 확정할 수는 없습니다
NIC의 offload, 암호화, 경로 길이와 패킷 크기 등 구현·환경 조건을 함께 봐야 합니다
여기서는 실측 성능 순위가 아니라 패킷 형식과 경로의 전제를 비교합니다

## MTU의 50바이트 계산에는 바깥 주소군 조건이 있습니다

MTU는 해당 링크에서 전달할 수 있는 IP 패킷 크기의 상한입니다
캡슐화된 패킷도 경로가 허용하는 크기 안에 들어가야 하므로, 바깥 헤더가 차지한 만큼 원래 패킷의 공간이 줄어듭니다

Cilium의 [`pkg/mtu`](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/pkg/mtu/mtu.go)는 VXLAN 터널 오버헤드를 바깥 IPv4에서 50바이트, IPv6에서 70바이트로 나눕니다
IPv4의 50바이트는 바깥 IP 20, UDP 8, VXLAN 8, 안쪽 Ethernet 헤더 14의 합입니다
바깥 Ethernet 헤더는 IP MTU 예산에 더하지 않습니다

다음은 underlay MTU 1500, 추가 암호화·IP 옵션이 없다는 조건의 계산 예시입니다
패킷 캡처나 처리량 측정값은 아닙니다

| 바깥 주소군 | VXLAN 추가 공간 | 내부 IP 패킷에 남는 예산 |
|---|---|---|
| IPv4 | 50바이트 | 1450바이트 |
| IPv6 | 70바이트 | 1430바이트 |

내부 IP 패킷 예산은 TCP 애플리케이션 데이터 크기와도 다릅니다
그 안에서 다시 내부 IP와 TCP 등의 헤더 공간을 사용합니다
암호화나 추가 헤더가 있으면 해당 공간도 별도로 계산해야 합니다

![underlay IP MTU 1500에서 VXLAN 바깥 IPv4 헤더 묶음 50바이트와 IPv6 헤더 묶음 70바이트를 제외해 내부 IP 예산 1450·1430을 구분한 단면|tall](/diagrams/k8s-theory-overlay-native-routing-2.svg)

### 인터페이스 MTU와 경로 MTU가 같은 값일 필요는 없습니다

위 식에서 1450이 나왔다고 모든 Pod의 `eth0` MTU가 반드시 1450이라고 단정하면 안 됩니다
Cilium의 `Configuration.Calculate`는 `DeviceMTU`와 `RouteMTU`를 따로 계산합니다
확인한 구현은 장치 쪽 기본 MTU를 유지하면서 경로 쪽 값에서 터널 오버헤드를 차감할 수 있습니다

따라서 Pod 인터페이스와 노드 인터페이스의 MTU가 같다는 사실만으로 캡슐화가 없다고 판단할 수 없습니다
실제 경로의 MTU와 터널 설정도 확인해야 합니다
네트워크 구현이 이 값을 적용하는 것이며, Node에 Pod CIDR을 기록하는 작업과는 다른 단계입니다

Geneve에는 또 다른 조건이 있습니다
[RFC 8926](https://www.rfc-editor.org/rfc/rfc8926.html#section-3.1)은 Geneve 헤더 자체가 기본 8바이트에서 옵션을 포함한 최대 260바이트까지 달라질 수 있다고 설명합니다
이 수치는 IP·UDP 등 바깥 헤더를 전부 합한 값이 아닙니다

같은 RFC의 [터널 MTU 규칙](https://www.rfc-editor.org/rfc/rfc8926.html#section-4.4.1)은 패킷마다 옵션 길이가 달라질 수 있어 최대 옵션 길이를 가정하도록 요구합니다
실제 사용하는 옵션과 추가 헤더를 확인하지 않은 채 VXLAN 예시의 50바이트를 모든 터널에 적용할 수는 없습니다

## 작은 패킷만 통과하는 실패는 경로 MTU에서 찾을 수 있습니다

노드 간 연결이 되더라도 큰 패킷만 전달되지 않을 수 있습니다
경로의 MTU를 넘는 패킷에 대한 크기 조정 신호가 돌아오지 않거나, 조각난 패킷이 버려지는 경우입니다

[RFC 7348](https://www.rfc-editor.org/rfc/rfc7348.html#section-4.3)은 VXLAN 터널 종단이 VXLAN 패킷을 조각내면 안 된다고 규정합니다
중간 라우터의 조각내기 가능성과 목적지 종단의 조각 폐기 가능성도 함께 설명합니다
이 IPv4식 중간 조각내기 설명을 IPv6 라우터로 일반화해서는 안 됩니다

[RFC 8200](https://www.rfc-editor.org/rfc/rfc8200.html#section-4.5)에서 IPv6 조각내기는 송신 측이 수행하며 중간 라우터가 수행하지 않습니다
Path MTU Discovery는 경로가 수용할 크기를 알아내는 기전이며, IPv6에서는 `Packet Too Big` 같은 신호가 그 과정에 쓰입니다

그래서 작은 TCP 핸드셰이크나 헬스체크는 통과한 뒤, 큰 응답을 전송하는 단계에서 타임아웃이 생길 수 있습니다
이것은 가능한 실패 조건을 설명한 것이며 작은 요청의 성공만으로 MTU 문제가 확정되는 것도 아닙니다

Pod의 `Running` phase나 준비 조건은 모든 목적지 경로의 MTU 검사를 통과했다는 뜻이 아닙니다
API에 보이는 실행 상태와 실제 전달 경로를 구분하고, 노드 간 경로·캡슐화·경로 MTU를 함께 확인해야 합니다

## Pod 주소를 공급하는 주체를 구분합니다

패킷이 노드를 넘어가는 경로와 크기 조건을 살펴봤습니다
그 경로에서 사용할 Pod 주소의 공급 방식은 별도로 선택합니다

네트워크 구현이 Kubernetes Node의 Pod CIDR을 사용하는지도 별도로 확인해야 합니다
Cilium의 대표적인 IPAM 관계는 다음과 같습니다

| IPAM 모드 | 주소 범위의 주체 | 전달 방식과의 관계 |
|---|---|---|
| Kubernetes Host Scope | Kubernetes Node의 Pod CIDR | 터널·직접 라우팅 모두 지원 |
| Cluster Scope | Cilium operator가 `CiliumNode.spec.ipam.podCIDRs` 관리 | 터널·직접 라우팅 모두 지원 |
| AWS ENI | AWS VPC의 ENI 주소·접두사 | native routing과 결합 |

확인한 [Helm values](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/install/kubernetes/cilium/values.yaml)의 기본 `ipam.mode`는 `cluster-pool`입니다
이 모드는 Kubernetes가 Node에 Pod CIDR을 배분해 줄 필요 없이 Cilium의 CRD로 관리합니다
Node의 `spec.podCIDR`이 비었다는 사실만으로 Pod 주소를 할당할 수 없다고 판단하면 안 됩니다

[Kubernetes Host Scope](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/network/concepts/ipam/kubernetes.rst)는 반대로 Node의 `spec.podCIDRs`·`spec.podCIDR`을 사용하는 모드입니다
이 구현에는 annotation으로 범위를 받는 방식도 있으므로, 실제 범위의 출처를 설정과 함께 봐야 합니다

두 축이 별도라는 말이 모든 조합을 사용할 수 있다는 뜻은 아닙니다
[Cilium IPAM 지원 표](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/network/concepts/ipam/index.rst)처럼 모드마다 가능한 전달 방식이 다릅니다

## nodeipam은 노드별 주소 범위를 기록합니다

kube-controller-manager의 nodeipam controller는 클러스터 주소 범위를 노드별로 나눠 `Node.spec.podCIDRs`에 기록할 수 있습니다
CIDR은 주소 범위를 접두사 길이로 표현하는 방식이며, IPv4 `/24`에는 256개 주소가 들어 있습니다
그 전부를 Pod에 줄 수 있는지는 플러그인의 예약 방식 등에 달려 있습니다

[`newNodeIpamController`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kube-controller-manager/app/core.go)는 `--allocate-node-cidrs`가 꺼져 있으면 controller를 생성하지 않습니다
이 조건은 **nodeipam이** 범위를 할당하지 않는다는 뜻입니다
다른 주체가 Node 필드를 쓰거나 플러그인이 자체 주소를 공급하는 경우까지 막지는 않습니다

노드별 할당을 사용하려면 유효한 `--cluster-cidr`도 필요합니다
범위를 나누는 [`RangeAllocator`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/nodeipam/ipam/range_allocator.go)는 노드의 CIDR을 할당하고 API에 반영합니다
이 코드가 개별 Pod IP를 정하거나 노드 간 데이터 경로까지 설치하는 것은 아닙니다

기본 노드 마스크는 IPv4 `/24`, IPv6 `/64`입니다
다만 dual-stack 클러스터에서는 `--node-cidr-mask-size`를 사용할 수 없고, `--node-cidr-mask-size-ipv4`·`--node-cidr-mask-size-ipv6` 또는 각 기본값을 사용합니다
단일 주소군에서도 공통 플래그와 주소군별 플래그를 동시에 지정하는 조합은 거부합니다

현행 KCM이 클라우드 주소 할당까지 내부에서 처리한다고 해석해서도 안 됩니다
확인한 버전은 cloud provider를 `nil`로 전달하고 `CloudAllocator` 선택을 거부합니다
클라우드 네트워크 구현의 주소 공급은 별도의 구현·구성으로 확인해야 합니다

플래그 조합은 [`setNodeCIDRMaskSizes`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kube-controller-manager/app/core.go), 클러스터 CIDR 요구는 [`NewNodeIpamController`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/nodeipam/node_ipam_controller.go)를 기준으로 확인했습니다

## 범위가 기록돼도 플러그인이 반드시 쓰지는 않습니다

kubelet은 Node의 CIDR을 보고 런타임 설정으로 전달하는 경로를 갖고 있습니다
[`updatePodCIDR`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kubelet_network.go)가 이를 전달하며, kubelet이 이 함수에서 Pod별 주소를 할당하지는 않습니다

CRI의 [`NetworkConfig.pod_cidr`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cri-api/pkg/apis/runtime/v1/api.proto)는 문자열 필드입니다
kubelet은 복수 `spec.podCIDRs`를 [쉼표로 연결해 전달](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kubelet_node_status.go)하며, CRI 주석은 비어 있으면 런타임이 생략하도록 설명합니다
필드가 문자열 하나라고 해서 dual-stack의 CIDR도 하나만 전달한다고 읽으면 안 됩니다

## VPC 주소를 사용하면 ENI와 서브넷 한도를 함께 봅니다

Cilium AWS ENI 모드에서는 VPC에서 직접 라우팅할 수 있는 주소를 Pod에 줍니다
그렇더라도 노드의 Pod별 경로와 ENI별 라우팅 테이블이 VPC 경로와 맞아야 합니다
주소가 VPC에서 나왔다는 이유만으로 노드 내부 전달 경로가 불필요해지는 것은 아닙니다

ENI는 EC2 인스턴스에 연결하는 네트워크 인터페이스입니다
일반적인 secondary IPv4 주소 할당에서는 인스턴스별 ENI 수와 ENI별 주소 수, 인터페이스 자체의 주소·예약분이 사용 가능한 Pod 주소 수를 제한합니다
서브넷에 남은 주소와 할당 정책도 함께 영향을 줍니다

이 관계를 모든 구성에 `ENI 수 × 주소 수`라는 Pod 수 공식으로 적용해서는 안 됩니다
개별 주소 대신 접두사를 할당하는 prefix delegation이나 주소군별 동작에서는 계산 조건이 달라집니다
Cilium의 현재 ENI 문서는 IPv6 지원을 beta로 구분하며 IPv6 접두사 기반 할당을 설명합니다

[AWS의 prefix 할당 설명](https://docs.aws.amazon.com/eks/latest/userguide/cni-increase-ip-addresses.html)도 CPU·메모리가 남아도 IP가 없어 Pod를 더 수용하지 못할 수 있음을 다룹니다
이 문서는 Amazon VPC CNI의 동작 범위이며, 그 구성 절차를 Cilium의 설정으로 그대로 옮겨 쓰는 근거는 아닙니다
Cilium의 구체적인 할당과 ENI별 경로는 [자체 ENI 문서](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/network/concepts/ipam/eni.rst)와 routing 설명을 확인해야 합니다

kubelet의 [`maxPods` 기본값](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/apis/config/v1beta1/defaults.go)은 110입니다
이 Pod 개수 상한이 실제 IPAM의 남은 주소 수를 뜻하지는 않습니다
확인한 nodeipam의 CIDR 할당 경로에도 `maxPods`와 주소 수를 대조하는 검사는 없습니다

CPU·메모리의 배치 검사를 통과했어도 노드에서 주소 할당에 실패할 수 있습니다
`ContainerCreating`에 머무는 상태는 IP 고갈만의 증상은 아니므로, 주소 공급자의 오류와 sandbox 생성 결과를 함께 봐야 합니다

## 실패 지점을 주소 공급과 패킷 전달로 나눕니다

| 현상 | 먼저 확인할 경계 |
|---|---|
| Node의 `spec.podCIDR`이 비어 있음 | nodeipam을 켰는지와 실제 IPAM이 Node CIDR을 사용하는지 구분 |
| 노드별 CIDR 할당을 켠 뒤 KCM 시작 실패 | cluster CIDR·주소군·노드 마스크 플래그 조합 확인 |
| Node CIDR과 실제 Pod 주소가 다름 | CiliumNode·클라우드 주소 등 다른 IPAM 출처인지 확인 |
| CPU·메모리는 남았는데 주소 할당 실패 | IPAM 풀·서브넷·ENI 한도와 `maxPods`를 별도로 확인 |
| 같은 노드에서는 되지만 노드를 넘으면 실패 | 터널 패킷 허용 또는 native의 Pod 경로 배포 확인 |
| 새 노드의 Pod만 통신 실패 | 노드 편입 정보와 해당 노드의 터널·경로 준비 확인 |
| 작은 요청은 되지만 큰 응답에서 멈춤 | underlay 주소군·추가 헤더·경로 MTU와 크기 조정 신호 확인 |
| Pod·노드 인터페이스 MTU가 같은데 터널 사용 | 장치 MTU 외에 route MTU와 네트워크 구현의 계산 확인 |

## 확인한 문서와 소스

- [Kubernetes 네트워크 모델](https://kubernetes.io/docs/concepts/services-networking/)과 [nodeipam 구현](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kube-controller-manager/app/core.go): 통신 요구와 노드별 CIDR 기록의 경계
- [Cilium v1.20.3 routing](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/network/concepts/routing.rst), [IPAM](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/network/concepts/ipam/index.rst), [Cluster Scope](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/network/concepts/ipam/cluster-pool.rst): 전달 방식·주소 공급 조합과 구현 조건
- [Cilium MTU 계산](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/pkg/mtu/mtu.go)과 [Helm values](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/install/kubernetes/cilium/values.yaml): underlay 주소군·장치/경로 MTU·설정 형식. 실제 설치값을 뜻하지 않습니다
- [RFC 7348](https://www.rfc-editor.org/rfc/rfc7348.html), [RFC 8926](https://www.rfc-editor.org/rfc/rfc8926.html), [RFC 8200](https://www.rfc-editor.org/rfc/rfc8200.html): 캡슐화·옵션·주소군별 조각내기와 MTU 경계
