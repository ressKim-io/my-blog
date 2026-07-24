---
title: "워커 노드의 회계 — 예약 공식과 인두세"
excerpt: "EKS AMI의 nodeadm과 Karpenter 소스를 고정 커밋으로 읽어 워커 노드의 예약 산식을 확정합니다. EKS는 파드 수에, GKE는 메모리 크기에 세금을 매기며, Karpenter는 그 공식을 거울처럼 복제하면서도 용량 자체는 7.5%로 추정합니다"
category: "kubernetes"
tags: ["kubernetes", "eks", "gke", "karpenter", "kubelet", "allocatable", "concept"]
series:
  name: "kernel-runtime-tradeoffs-7"
  order: 1
date: "2026-07-20"
---

> **이 부(7부)가 답하는 범위**: "클라우드가 무엇을 최적화했나"가 아니라 **"클라우드가 쓰는 오픈소스가 무엇을 하는가"**까지입니다. Nitro 카드 내부나 관리형 컨트롤 플레인은 벤더 자산이라 읽을 수 없고, 읽을 수 없는 것은 쓰지 않습니다
> **근거**: 모든 기전은 고정 커밋 소스에 앵커를 겁니다 — `awslabs/amazon-eks-ami`(`b4fffb7`), `kubernetes-sigs/karpenter`(`a0d5370`), `aws/karpenter-provider-aws`(`a2496cc`), `aws/amazon-vpc-cni-k8s`(`f3a3374`). 수치는 소스가 말하는 상수이거나 공식 문서가 직접 말하는 값만 씁니다

노드를 새로 띄우면 파드가 실제로 쓸 수 있는 자원은 인스턴스 스펙보다 항상 적습니다

kubelet과 컨테이너 런타임, 호스트 OS가 먼저 몫을 떼기 때문입니다

이 계산표가 스케줄러가 아는 값과 어긋나면 파드가 노드에 안착하지 못합니다
그래서 예약 산식은 취향 문제가 아니라 **회계 규칙**입니다

이 편에서는 그 규칙을 소스에서 확정합니다

## 노드 자원의 3중 분할

![노드 자원의 3중 분할 구조](/diagrams/cloud-node-resource-accounting-1.svg)

노드 용량은 세 겹으로 나뉩니다

- **Capacity** — 인스턴스가 광고하는 하드웨어 총량
- **예약분** — `kube-reserved`(kubelet·런타임), `system-reserved`(OS·systemd), `eviction-hard`(퇴거 발동 버퍼)
- **Allocatable** — 남은 잔액이며, 스케줄러가 파드 `requests`를 심사할 때 보는 **유일한** 값

식으로 쓰면 이렇습니다

```text
Allocatable = Capacity - (kube-reserved + system-reserved + eviction-hard)
```

## EKS는 파드 머릿수에 세금을 매깁니다

AL2023 AMI부터 EKS는 기존 `bootstrap.sh` 대신 Go로 작성된 `nodeadm`을 씁니다

메모리 예약 산식은 이것뿐입니다

```go
// awslabs/amazon-eks-ami (b4fffb7)
// nodeadm/internal/kubelet/config.go:442
func getMemoryMebibytesToReserve(maxPods int32) int32 {
	return 11*maxPods + 255
}
```

**물리 메모리 크기가 식에 들어가지 않습니다**

노드가 8 GiB든 256 GiB든 상관없이, 그 인스턴스가 받을 수 있는 파드 최대 개수(`maxPods`)에만 비례합니다

kubelet이 쓰는 메모리의 상당 부분이 파드별 상태 구조체와 동기화 루프에서 나오므로, 파드 수에 연동하는 설계는 합리적입니다

다만 **`11 MiB`가 측정으로 수렴한 값이라는 근거는 소스에 없습니다**

Karpenter가 같은 상수를 복제하면서 남긴 주석이 출처를 밝히고 있는데, Bottlerocket의 예약값 논의(`bottlerocket-os/bottlerocket` PR #1388)를 가리킵니다
즉 이 값은 자연 상수가 아니라 **벤더가 정한 휴리스틱**입니다 — GKE의 `255 MiB` 기본값과 같은 성격입니다

CPU는 다르게 계산합니다

```go
// awslabs/amazon-eks-ami (b4fffb7)
// nodeadm/internal/kubelet/config.go:410
func getCPUMillicoresToReserve(resources system.Resources) int {
	totalCPUMillicores, err := resources.GetMilliNumCores()
	if err != nil {
		/* 로그 생략 */
		return 0
	}
	cpuRanges := []int{0, 1000, 2000, 4000, totalCPUMillicores}
	cpuPercentageReservedForRanges := []int{600, 100, 50, 25}
	cpuToReserve := 0

	for i, percentageToReserveForRange := range cpuPercentageReservedForRanges {
		startRange := cpuRanges[i]
		endRange := cpuRanges[i+1]
		cpuToReserve += getResourceToReserveInRange(totalCPUMillicores, startRange, endRange, percentageToReserveForRange)
	}

	return cpuToReserve
}
```

`600, 100, 50, 25`는 만분율입니다

| 구간 | 공제율 |
|---|---|
| 첫 1코어 (`0~1000m`) | 6% |
| 두 번째 코어 (`1000~2000m`) | 1% |
| 3~4번째 코어 (`2000~4000m`) | 0.5% |
| 4코어 초과 | 0.25% |

16 vCPU면 `60 + 10 + 10 + 30 = 110m`입니다
코어가 늘수록 한계 공제율이 떨어지므로 큰 인스턴스일수록 비율상 유리합니다

여기에 회계상 특징이 하나 있습니다

`nodeadm`의 kubelet 설정 구조체에는 `KubeReserved` 필드는 있지만 **`SystemReserved` 필드 자체가 없습니다**
설정하는 것은 cgroup 경로뿐입니다

```go
// awslabs/amazon-eks-ami (b4fffb7)
// nodeadm/internal/kubelet/config.go:273
func (ksc *kubeletConfig) withDefaultReservedResources(cfg *api.NodeConfig, resources system.Resources) {
	ksc.SystemReservedCgroup = ptr.String("/system")
	ksc.KubeReservedCgroup = ptr.String("/runtime")
```

즉 OS 몫을 따로 걷지 않고 `11 × maxPods + 255` 안에 함께 징수합니다

## maxPods가 세금을 정합니다

`maxPods`는 ENI가 붙일 수 있는 보조 IP 수에서 나오며, VPC CNI 레포에 표로 고정돼 있습니다

```text
# aws/amazon-vpc-cni-k8s (f3a3374) — misc/eni-max-pods.txt
m5.large    29
m5.4xlarge  234
```

이 값을 산식에 넣으면 인두세의 성격이 드러납니다

| 인스턴스 | 메모리 | maxPods | kube-reserved | 비중 |
|---|---|---|---|---|
| `m5.large` | 8 GiB | 29 | `11×29+255` = **574 MiB** | 7.0% |
| `m5.4xlarge` | 64 GiB | 234 | `11×234+255` = **2,829 MiB** | 4.3% |

메모리가 8배인데 예약은 4.9배만 늘어납니다
**세금이 자산이 아니라 정원에 붙기 때문**입니다

## GKE는 반대로 매깁니다

GKE는 파드 수를 보지 않고 메모리 총량에 계단식으로 매깁니다

> - 255 MiB of memory for machines with less than 1 GiB of memory
> - 25% of the first 4 GiB of memory
> - 20% of the next 4 GiB of memory (up to 8 GiB)
> - 10% of the next 8 GiB of memory (up to 16 GiB)
> - 6% of the next 112 GiB of memory (up to 128 GiB)
> - 2% of any memory above 128 GiB
>
> — [About node sizes in GKE](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/plan-node-sizes) (접근 2026-07-20)

같은 문서가 퇴거용으로 노드마다 100 MiB를 추가 예약한다고 밝힙니다

64 GiB 노드로 맞대 보겠습니다

![EKS와 GKE의 메모리 예약 공식 비교](/diagrams/cloud-node-resource-accounting-2.svg)

| 항목 | EKS (`m5.4xlarge`) | GKE (64 GiB 노드) |
|---|---|---|
| Capacity | 65,536 MiB | 65,536 MiB |
| 산식 | `11×234 + 255` | `4G×25% + 4G×20% + 8G×10% + 48G×6%` |
| 예약 | **2,829 MiB** | **5,611.5 MiB** |
| eviction | 100 MiB | 100 MiB |
| Allocatable | **62,607 MiB** | **59,824.5 MiB** |

GKE가 약 **1.98배** 더 걷고, 파드가 쓸 수 있는 양은 약 **2.72 GiB** 차이 납니다

어느 쪽이 낫다고 단정할 일은 아닙니다

EKS는 더 많이 돌려주지만, 노드에 무거운 에이전트를 얹으면 여유가 얇습니다
GKE는 많이 떼는 대신 커널 버퍼나 데몬 스파이크에 견딥니다

설계 철학의 차이이지 우열이 아닙니다

## Karpenter는 이 공식을 복제합니다 — 그리고 어디서 포기했는가

노드가 아직 없는데 스케줄링을 결정해야 하는 쪽이 있습니다

Karpenter는 대기 중인 파드를 담을 인스턴스 타입을 고르는데, 이때 인스턴스는 아직 부팅되지 않았습니다
kubelet이 `Allocatable`을 보고할 수가 없습니다

![Karpenter의 회계 복제와 그 한계](/diagrams/cloud-node-resource-accounting-3.svg)

그래서 Karpenter는 `nodeadm`의 산식을 그대로 옮겨 심었습니다

```go
// aws/karpenter-provider-aws (a2496cc)
// pkg/providers/instancetype/types.go:523
func kubeReservedResources(cpus, pods *resource.Quantity, kubeReserved map[string]string) corev1.ResourceList {
	resources := corev1.ResourceList{
		corev1.ResourceMemory:           resource.MustParse(fmt.Sprintf("%dMi", (11*pods.Value())+255)),
		corev1.ResourceEphemeralStorage: resource.MustParse("1Gi"),
	}
	// kube-reserved Computed from
	// https://github.com/bottlerocket-os/bottlerocket/pull/1388/...
	for _, cpuRange := range []struct {
		start      int64
		end        int64
		percentage float64
	}{
		{start: 0, end: 1000, percentage: 0.06},
		{start: 1000, end: 2000, percentage: 0.01},
		{start: 2000, end: 4000, percentage: 0.005},
		{start: 4000, end: 1 << 31, percentage: 0.0025},
	} {
```

`(11 * pods) + 255`와 `0.06 / 0.01 / 0.005 / 0.0025`가 `nodeadm`과 정확히 같습니다
퇴거 임계치도 마찬가지입니다

```go
// aws/karpenter-provider-aws (a2496cc)
// pkg/providers/instancetype/types.go:555
func evictionThreshold(memory *resource.Quantity, storage *resource.Quantity, evictionHard map[string]string) corev1.ResourceList {
	overhead := corev1.ResourceList{
		corev1.ResourceMemory:           resource.MustParse("100Mi"),
```

여기까지만 보면 완전한 일치처럼 보입니다

그런데 **산식을 적용할 대상인 Capacity 자체가 추정값**입니다

```go
// aws/karpenter-provider-aws (a2496cc)
// pkg/providers/instancetype/types.go:357
func memory(ctx context.Context, info ec2types.InstanceTypeInfo) *resource.Quantity {
	sizeInMib := *info.MemoryInfo.SizeInMiB
	// Gravitons have an extra 64 MiB of cma reserved memory that we can't use
	if len(info.ProcessorInfo.SupportedArchitectures) > 0 && info.ProcessorInfo.SupportedArchitectures[0] == "arm64" {
		sizeInMib -= 64
	}
	mem := resources.Quantity(fmt.Sprintf("%dMi", sizeInMib))
	// Account for VM overhead in calculation
	mem.Sub(resource.MustParse(fmt.Sprintf("%dMi", int64(math.Ceil(float64(mem.Value())*options.FromContext(ctx).VMMemoryOverheadPercent/1024/1024)))))
	return mem
}
```

EC2 API가 광고하는 메모리에서 **일괄 7.5%를 먼저 깎습니다**

```go
// aws/karpenter-provider-aws (a2496cc)
// pkg/operator/options/options.go:58
fs.Float64Var(&o.VMMemoryOverheadPercent, "vm-memory-overhead-percent",
	utils.WithDefaultFloat64("VM_MEMORY_OVERHEAD_PERCENT", 0.075), ...)
```

이유는 분명합니다
하이퍼바이저와 펌웨어가 가져가는 몫이 있어 게스트 OS가 보는 `MemTotal`은 광고값보다 늘 작습니다

kubelet은 그 값을 **측정**하고, Karpenter는 부팅 전이라 **추정**할 수밖에 없습니다

64 GiB 인스턴스라면 7.5%는 약 4.9 GiB입니다
`kube-reserved`(2,829 MiB)보다 큽니다

그러므로 정확한 서술은 이렇습니다

**Karpenter가 거울처럼 복제한 것은 예약 *산식*이지 최종 *결과*가 아닙니다**

일치는 공식에서 성립하고, 오차는 용량에서 생깁니다
`VM_MEMORY_OVERHEAD_PERCENT`가 사용자 조정 가능한 플래그로 열려 있다는 사실 자체가, 이 값이 맞아떨어지는 상수가 아님을 말해 줍니다

arm64에서 CMA용 64 MiB를 따로 빼는 예외 처리도 같은 성격입니다 — 일반 공식으로는 안 맞는 부분을 손으로 보정한 것입니다

## bin-packing — 두 번째 인두세

Karpenter가 인스턴스 타입을 고를 때 파드 요청만 보는 게 아닙니다

```go
// kubernetes-sigs/karpenter (a0d5370)
// pkg/controllers/provisioning/scheduling/nodeclaim.go:562
for _, group := range daemonOverheadGroups {
	...
	if len(group.DaemonOverhead) != 0 {
		err.trackDaemonOverhead(group.DaemonOverhead)
		totalRequestsForInstanceType = resources.MergeInto(totalRequestsForInstanceType, totalRequests)
		totalRequestsForInstanceType = resources.MergeInto(totalRequestsForInstanceType, group.DaemonOverhead)
	}
```

DaemonSet이 요구하는 자원을 파드 요청 합계에 **더한 뒤** 인스턴스에 들어가는지 봅니다

그 판정은 `Allocatable` 기준입니다

```go
// kubernetes-sigs/karpenter (a0d5370)
// pkg/controllers/provisioning/scheduling/nodeclaim.go:624
func fits(instanceType *cloudprovider.InstanceType, requests corev1.ResourceList, requirements scheduling.Requirements) (itFits bool, hasOffering bool) {
	for _, group := range instanceType.AllocatableOfferingsList() {
		resourceFit := resources.Fits(requests, group.Allocatable)
```

여기서 노드 회계의 실제 무게가 드러납니다

노드 한 대가 늘 때마다 `kube-reserved`만 붙는 게 아니라 **DaemonSet 세트가 통째로 한 벌씩 더 붙습니다**
로그 수집기, 메트릭 익스포터, CNI, 보안 에이전트가 모든 노드에 상주합니다

작은 노드를 여러 대 쓰면 이 고정비가 대수만큼 곱해집니다
"노드를 잘게 쪼개면 유연하다"는 직관이 자주 깨지는 이유입니다

## consolidation — 더 싼 조합이 있으면 바꿉니다

Karpenter는 노드를 만들기만 하는 게 아니라 되돌립니다

```go
// kubernetes-sigs/karpenter (a0d5370)
// pkg/controllers/disruption/consolidation.go:159
func (c *consolidation) computeConsolidation(ctx context.Context, candidates ...*Candidate) (Command, error) {
	results, err := SimulateScheduling(ctx, c.kubeClient, c.cluster, c.provisioner, c.clock, c.recorder,
		[]pscheduling.Options{pscheduling.IsConsolidationSimulation}, candidates...)
```

먼저 후보 노드를 없앤다고 가정하고 **스케줄링을 다시 시뮬레이션합니다**

파드가 전부 다른 곳에 들어가면 그 노드는 그냥 없앱니다
새 노드가 필요하다면 가격을 비교합니다

```go
// kubernetes-sigs/karpenter (a0d5370)
// pkg/controllers/disruption/consolidation.go:216
results.NewNodeClaims[0], err = results.NewNodeClaims[0].RemoveInstanceTypeOptionsByPriceAndMinValues(
	results.NewNodeClaims[0].Requirements, candidatePrice)
```

현재 노드보다 싼 후보만 남기고, 하나도 안 남으면 포기합니다
이때 이벤트로 남기는 문구가 `Can't replace with a cheaper node`입니다

정리하면 consolidation은 "빈 노드 치우기"가 아니라 **같은 파드 집합을 더 싸게 담는 조합 탐색**입니다

그리고 그 탐색이 쓰는 용량 값이 앞 절의 추정 `Allocatable`입니다
회계가 틀리면 스케줄링만 어긋나는 게 아니라 **비용 최적화 판단도 함께 어긋납니다**

## 실무에서 무엇을 보아야 하는가

- **`maxPods`를 실제 밀도에 맞춥니다** — `m5.4xlarge`에서 파드를 평균 30개만 돌린다면 쓰지 않을 200여 개분의 인두세가 메모리에 묶입니다. `maxPods`는 조정 가능한 값입니다
- **노드를 잘게 쪼갤 때 DaemonSet 고정비를 함께 셉니다** — 노드 대수만큼 곱해집니다. 큰 노드 소수가 유리한 경우가 흔합니다
- **Karpenter 용량 오차는 `VM_MEMORY_OVERHEAD_PERCENT`로 조정합니다** — 기본 7.5%가 실제와 어긋나 스케줄링이 반복 실패한다면, 이 값이 원인일 수 있습니다
- **`Capacity`가 아니라 `Allocatable`을 봅니다** — `kubectl describe node`의 두 값 차이가 그 노드가 내는 세금 전액입니다

## 핵심 요약

- EKS(`nodeadm`)의 메모리 예약은 `11 × maxPods + 255` MiB이며 **물리 메모리 크기가 식에 들어가지 않습니다**. 세금이 자산이 아니라 정원에 붙습니다
- `11 MiB`는 측정으로 수렴한 값이 아니라 Bottlerocket 논의에서 온 **벤더 휴리스틱**입니다
- GKE는 반대로 메모리 총량에 계단식(25/20/10/6/2%)으로 매깁니다. 64 GiB 노드에서 GKE가 약 1.98배 더 걷고 파드 가용량이 약 2.72 GiB 적습니다
- Karpenter는 `nodeadm`의 예약 **산식**을 정확히 복제하지만, 산식을 적용할 **Capacity는 일괄 7.5%로 추정**합니다. 일치는 공식에서 성립하고 오차는 용량에서 생깁니다
- bin-packing은 파드 요청에 **DaemonSet 오버헤드를 더해** `Allocatable`과 비교합니다. 노드를 늘릴 때마다 이 고정비가 한 벌씩 붙습니다
- consolidation은 노드를 지운다고 가정하고 스케줄링을 재시뮬레이션한 뒤 **더 싼 조합이 있을 때만** 교체합니다

*다음 편에서는 이 산식의 입력값인 `maxPods`가 어디서 오는지 — VPC CNI와 ENI 접두사 위임을 소스에서 확인합니다*
