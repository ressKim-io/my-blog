---
title: "고밀도 노드의 물리 — VPC CNI와 MaxPods"
excerpt: "노드당 파드 수는 어디서 정해지는가를 VPC CNI 소스에서 확정합니다. maxPods는 ENI와 IP 한도에서 계산된 값이며, 접두사 위임이 해결하는 것은 IP 개수만이 아니라 예비 IP 낭비와 파드 기동 지연입니다"
category: "kubernetes"
tags: ["kubernetes", "eks", "vpc-cni", "maxpods", "eni", "prefix-delegation", "kubelet", "concept"]
series:
  name: "kernel-runtime-tradeoffs-7"
  order: 2
date: "2026-07-20"
---

> **근거**: `aws/amazon-vpc-cni-k8s`(`f3a3374`), `amzn/amzn-drivers`(`acddbf2`), `awslabs/amazon-eks-ami`(`b4fffb7`) 고정 커밋 소스와 각 레포의 공식 문서에 앵커를 겁니다
> **한계**: Nitro 카드가 ENI를 어떻게 만들어 내는지는 벤더 자산이라 읽을 수 없습니다. 이 편이 다루는 것은 **게스트 커널과 CNI가 보는 경계까지**이며, 그 너머는 쓰지 않습니다

1편에서 EKS가 메모리를 `11 × maxPods + 255` MiB로 예약한다는 것을 확인했습니다

세금이 `maxPods`에 붙는다면, 그 값을 줄이면 그만인 것처럼 보입니다

그런데 `maxPods`는 자유롭게 고르는 숫자가 아닙니다
ENI가 붙일 수 있는 IP 수에서 **계산되어 나오는 값**입니다

이 편에서는 그 계산을 소스에서 확정합니다

## maxPods는 IP 한도에서 계산됩니다

VPC CNI는 파드에게 VPC의 실제 사설 IP를 직접 줍니다
그래서 노드가 받을 수 있는 파드 수는 그 노드에 붙는 IP 수의 문제가 됩니다

산식은 표를 생성하는 스크립트에 있습니다

```go
// aws/amazon-vpc-cni-k8s (f3a3374)
// scripts/gen_vpc_ip_limits.go:43
func printPodLimit(instanceType string, l vpc.InstanceTypeLimits) string {
	maxPods := l.ENILimit*(l.IPv4Limit-1) + 2
	return fmt.Sprintf("%s %d", instanceType, maxPods)
}
```

각 항의 의미는 같은 파일이 생성하는 표 머리말에 그대로 적혀 있습니다

```text
# aws/amazon-vpc-cni-k8s (f3a3374) — scripts/gen_vpc_ip_limits.go:571
# Mapping is calculated from AWS EC2 API using the following formula:
# * First IP on each ENI is not used for pods
# * +2 for the pods that use host-networking (AWS CNI and kube-proxy)
#
#   # of ENI * (# of IPv4 per ENI - 1) + 2
```

ENI마다 첫 IP는 노드 자신이 쓰므로 빠지고, 호스트 네트워크로 도는 파드 둘(`aws-node`와 `kube-proxy`)은 ENI의 2차 IP를 소모하지 않으므로 더해집니다

결과는 레포에 표로 고정돼 있습니다

```text
# aws/amazon-vpc-cni-k8s (f3a3374) — misc/eni-max-pods.txt
m5.large    29
m5.4xlarge  234
```

`m5.large`는 ENI 3개 × (IP 10개 − 1) + 2 = 29입니다
`m5.4xlarge`는 ENI 8개 × (IP 30개 − 1) + 2 = 234입니다

![VPC CNI의 IP 할당 모드 비교](/diagrams/cloud-node-maxpods-cni-1.svg)

1편의 인두세 산식에 이 값이 그대로 들어갑니다
**네트워크 한도가 메모리 예약을 정하는 구조**입니다

인스턴스 정보를 못 읽으면 `nodeadm`은 보수적인 기본값으로 물러섭니다

```go
// awslabs/amazon-eks-ami (b4fffb7)
// nodeadm/internal/kubelet/eni_max_pods.go:28
const defaultMaxPods = 110
```

`110`은 권장 상한이 아니라 **조회 실패 시의 폴백**입니다

## 접두사 위임 — 슬롯 하나에 IP 16개

2차 IP 모드에서는 ENI의 2차 IP 슬롯 하나가 IP 하나입니다

접두사 위임을 켜면 그 슬롯이 `/28` 블록 하나로 바뀝니다

```go
// aws/amazon-vpc-cni-k8s (f3a3374)
// pkg/ipamd/ipamd.go:2569
func (c *IPAMContext) GetIPv4Limit() (int, int, error) {
	var maxIPsPerENI, maxPrefixesPerENI, maxIpsPerPrefix int
	if !c.enablePrefixDelegation {
		maxIPsPerENI = c.awsClient.GetENIIPv4Limit()
		maxPrefixesPerENI = 0
	} else if c.enablePrefixDelegation {
		_, maxIpsPerPrefix, _ = datastore.GetPrefixDelegationDefaults()
		maxPrefixesPerENI = c.awsClient.GetENIIPv4Limit()
		maxIPsPerENI = maxPrefixesPerENI * maxIpsPerPrefix
	}
	return maxIPsPerENI, maxPrefixesPerENI, nil
}
```

블록 크기는 상수입니다

```go
// aws/amazon-vpc-cni-k8s (f3a3374)
// pkg/ipamd/datastore/data_store.go:1552
func GetPrefixDelegationDefaults() (int, int, int) {
	numPrefixesPerENI := 1
	numIPsPerPrefix := 16
	supportedPrefixLen := 28

	return numPrefixesPerENI, numIPsPerPrefix, supportedPrefixLen
}
```

ENI당 IP 한도가 `(IPv4Limit − 1) × 16`이 됩니다
`m5.large`라면 ENI 하나로 `9 × 16 = 144`개입니다

여기서 자주 혼동되는 지점을 짚어 두겠습니다

세 ENI를 다 쓰면 산술적으로는 `3 × 9 × 16 + 2 = 434`개가 나옵니다
그러나 이 값은 **IP 주소 공간의 크기**일 뿐 권장 `maxPods`가 아닙니다

IP가 있다고 파드가 도는 것은 아닙니다
뒤에서 볼 kubelet 부하가 별개의 상한을 만듭니다

## 접두사 위임이 실제로 해결하는 문제

IP 개수만 보면 접두사 위임은 그저 "더 많은 IP"입니다

소스와 문서를 보면 동기가 하나 더 있습니다 — **예비 IP를 유지하는 비용**입니다

VPC CNI의 `ipamd`는 파드가 요청하기 전에 IP를 미리 확보해 둡니다
그 양을 정하는 환경변수가 셋입니다

```go
// aws/amazon-vpc-cni-k8s (f3a3374) — pkg/ipamd/ipamd.go:79, 90, 107
envWarmIPTarget    = "WARM_IP_TARGET"
envMinimumIPTarget = "MINIMUM_IP_TARGET"
envWarmENITarget   = "WARM_ENI_TARGET"
```

기본값이 문제를 만듭니다

> The default setting, `WARM_ENI_TARGET=1` means that `ipamd` should keep "a full ENI" of available IPs around
>
> — `aws/amazon-vpc-cni-k8s` (`f3a3374`), `docs/eni-and-ip-target.md`

**ENI 한 장 분량의 IP를 늘 놀려 둔다**는 뜻입니다

같은 문서의 예시 표가 그 크기를 보여 줍니다
`p3dn.24xlarge`는 ENI당 2차 IP가 49개인데, 파드 3개만 돌려도 ENI 2장에 IP 98개가 붙고 그중 **95개가 유휴**입니다

작은 서브넷에서는 이것이 곧 IP 고갈입니다

접두사 위임 문서는 다른 비용도 밝힙니다

> The pod startup latency becomes even more pronounced if IPAMD needs to allocate and attach a new ENI (and wait for IMDS sync) before assigning IPs to new pods
>
> — `aws/amazon-vpc-cni-k8s` (`f3a3374`), `docs/prefix-and-ip-target.md`

같은 문서가 새 ENI를 붙일 때 필요한 접두사를 한 번에 확보하는 이유를 "여분의 EC2 호출을 피하기 위해"라고 적고 있습니다

정리하면 접두사 위임의 동기는 셋입니다

- ENI 한 장에 담기는 IP가 16배가 되어 **같은 밀도를 더 적은 ENI로** 달성합니다
- 예비 IP를 블록 단위로 잡으므로 **EC2 API 호출이 줄어듭니다**
- 새 ENI를 붙이고 IMDS 동기화를 기다리는 경로를 덜 타므로 **파드 기동 지연이 줄어듭니다**

## ENI를 여러 장 붙이면 무엇이 늘어나는가

ENI 하나는 게스트 커널에게 독립된 PCI 네트워크 장치입니다
그러므로 ENI를 늘리면 인터럽트 벡터도 늘어납니다

얼마나 늘어나는지는 드라이버 상수로 확정됩니다

```c
// amzn/amzn-drivers (acddbf2)
// kernel/linux/ena/ena_netdev.h:56
#define ENA_ADMIN_MSIX_VEC		1
#define ENA_MAX_MSIX_VEC(io_queues)	(ENA_ADMIN_MSIX_VEC + (io_queues))
```

ENI 한 장이 요구하는 벡터 수는 **입출력 큐 수 + 관리용 1개**입니다

```c
// amzn/amzn-drivers (acddbf2)
// kernel/linux/ena/ena_netdev.c:2033
	/* Reserved the max msix vectors we might need */
	msix_vecs = ENA_MAX_MSIX_VEC(adapter->max_num_io_queues);
	...
	irq_cnt = pci_alloc_irq_vectors(adapter->pdev, ENA_MIN_MSIX_VEC,
					msix_vecs, PCI_IRQ_MSIX);
```

큐 수는 드라이버 문서가 공시합니다

> Usually the number of queues exposed per ENI is calculated as `MIN(MAX_NUM_QUEUES_PER_ENI, NUM_OF_VCPUS)`
> MAX_NUM_QUEUES_PER_ENI is 8 for most of the instance types and up to 32 for network accelerated instances
>
> — `amzn/amzn-drivers` (`acddbf2`), `kernel/linux/ena/ENA_Linux_Best_Practices.rst`

IRQ 배분은 같은 문서의 다른 항목에 있습니다

> For each ENI the driver allocates 1 IRQ for management (Admin CQ, AENQ) and one IRQ for each ENA queue
> Please note ENA queue an IRQ is shared between Tx and Rx Completion rings of the same queue
>
> — 같은 문서

`m5.4xlarge`(16 vCPU)에 대입하면 ENI당 큐는 `MIN(8, 16) = 8`개입니다

2차 IP 모드로 234개 파드를 받으려면 ENI 8장이 필요하므로, 벡터는 `8 × (8 + 1) = 72`개가 됩니다
접두사 위임이면 ENI 2장으로 충분하므로 `2 × 9 = 18`개입니다

![ENI 개수와 MSI-X 벡터 수](/diagrams/cloud-node-maxpods-cni-2.svg)

여기서 멈추겠습니다

ENI를 늘리면 netdev과 인터럽트 벡터가 선형으로 는다는 것까지가 소스가 말해 주는 전부입니다
그것이 실제 워크로드에서 얼마나 손해인지는 **재지 않았으므로 쓰지 않습니다**

큐마다 독립된 NAPI 컨텍스트와 독립된 IRQ를 갖는다는 것이 위 문서의 서술이므로, 큐 사이에 공유 스핀락이 있다고 볼 근거도 이 소스에는 없습니다

## 밀도가 kubelet에 부과하는 것

IP를 확보했다고 파드 250개가 편안히 도는 것은 아닙니다

런타임 시리즈 24편([파드 하나에 고루틴 하나](/essays/kubelet-goroutine-per-pod))에서 kind 클러스터로 잰 값이 있습니다

| 파드 수 | `go_goroutines` | 유저 스택 총합 |
|---|---|---|
| 0개 | 251개 | 3.78 MiB |
| 30개 | 382개 | 6.01 MiB |
| 50개 | 471개 | 7.44 MiB |

파드 하나가 늘 때마다 kubelet 고루틴이 **약 4.4개** 늘고, 고루틴 하나의 실효 스택은 **약 15.8 KB**입니다

그리고 상태 감시 루프가 있습니다

Generic PLEG는 1초마다 노드의 전체 컨테이너 목록을 다시 읽습니다
그 주기가 `genericPlegRelistThreshold`(3분)를 넘으면 노드가 `NotReady`로 전환됩니다

`NotReady`가 되면 그 노드의 파드는 서비스 엔드포인트에서 빠집니다
**노드의 트래픽이 차단되는 것이 아니라 새 트래픽이 그 노드로 라우팅되지 않는 것**입니다

이 폴링 비용을 없애려는 것이 Evented PLEG인데, v1.26에 도입된 뒤 v1.36.1까지도 기본 비활성 알파입니다

기전과 실측은 24편에 있으므로 여기서는 결론만 씁니다 — **`maxPods`의 실질 상한은 IP가 아니라 kubelet이 정합니다**

1편의 인두세가 `maxPods`에 비례하는 이유도 여기 있습니다
파드마다 붙는 고루틴과 캐시를 지탱할 메모리를 미리 잡아 두는 것입니다

## 실무에서 무엇을 보아야 하는가

- **`maxPods`를 실제 밀도에 맞춥니다** — `m5.4xlarge`에서 파드 30개만 돌린다면 IP 한도가 234라는 이유로 234를 그대로 둘 필요가 없습니다. 1편의 산식대로 쓰지 않을 파드분의 메모리가 묶입니다
- **고밀도라면 접두사 위임을 켭니다** — ENI 장수를 줄이는 효과보다, 예비 IP 낭비와 ENI 부착 지연이 줄어드는 효과가 실무에서 더 자주 체감됩니다
- **작은 서브넷에서는 `WARM_ENI_TARGET` 기본값을 의심합니다** — ENI 한 장 분량을 늘 놀리는 기본 동작이 서브넷 IP를 잠식합니다. `WARM_IP_TARGET`·`MINIMUM_IP_TARGET`으로 바꾸는 선택지가 문서에 있습니다
- **IP 여유와 파드 밀도를 분리해서 봅니다** — 접두사 위임으로 IP를 434개 확보해도 kubelet이 그만큼을 감당한다는 뜻은 아닙니다

## 핵심 요약

- `maxPods`는 고르는 값이 아니라 `ENI 수 × (ENI당 IP − 1) + 2`로 **계산되는 값**입니다. `+2`는 호스트 네트워크로 도는 `aws-node`와 `kube-proxy` 몫이며 소스 주석에 명시돼 있습니다
- `nodeadm`의 `110`은 권장 상한이 아니라 인스턴스 정보 조회 실패 시의 폴백입니다
- 접두사 위임은 2차 IP 슬롯 하나를 `/28`(IP 16개)로 바꿉니다. 다만 동기는 IP 개수만이 아니라 **예비 IP 낭비와 파드 기동 지연**이며, 문서가 두 비용을 모두 밝히고 있습니다
- ENI 한 장이 요구하는 MSI-X 벡터는 `입출력 큐 수 + 1`입니다. `m5.4xlarge`에서 ENI 8장이면 72개, 2장이면 18개입니다. 그 차이가 실제로 얼마나 손해인지는 재지 않았으므로 쓰지 않습니다
- `maxPods`의 실질 상한은 IP가 아니라 kubelet입니다. 파드당 고루틴 약 4.4개가 늘고, PLEG relist가 3분을 넘기면 노드가 `NotReady`가 되어 서비스 엔드포인트에서 빠집니다

*다음 편에서는 파드가 늘수록 커널 서비스 경로가 지는 비용과, eBPF 데이터플레인이 그 경로를 어떻게 대체하는지를 Cilium 소스에서 확인합니다*
