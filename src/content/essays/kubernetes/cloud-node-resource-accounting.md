---
title: "워커 노드의 회계 — 예약 공식과 인두세"
excerpt: "클라우드 인프라 물리학 시리즈 2편. EKS AMI(nodeadm)와 GKE 공식 문서의 kube-reserved 산식을 대조하고, Karpenter가 노드 부팅 전 가상 용량을 계산할 때 Kubelet과 1바이트 오차 없이 회계를 일치시키는 기전을 소스 수준에서 규명합니다"
category: "kubernetes"
tags: ["kubernetes", "eks", "gke", "karpenter", "kubelet", "cloud-optimization", "troubleshooting"]
series:
  name: "kernel-runtime-tradeoffs-7"
  order: 1
date: "2026-07-20"
---

> **근거 구성**: 이 글은 AWS EKS 공식 AMI(`awslabs/amazon-eks-ami` commit `b4fffb7`)의 `nodeadm` 소스 코드와 Karpenter(`kubernetes-sigs/karpenter` commit `a0d5370`, `aws/karpenter-provider-aws` commit `a2496cc`)의 용량 산출 소스를 직접 클론하여 검증한 **소스 확정** 등급 수치와, Google Cloud GKE 공식 문서의 노드 자원 예약 기준을 인용한 **문헌** 등급 데이터를 바탕으로 작성되었습니다

쿠버네티스 클러스터에서 워커 노드가 새로 부팅되었을 때 사용자가 배포하는 파드가 실제로 사용할 수 있는 자원의 총량은 물리 서버나 가상 머신의 스펙과 결코 같지 않습니다

호스트 운영체제와 쿠버네티스 핵심 에이전트인 Kubelet, 컨테이너 런타임이 안정적으로 동작하려면 일정량의 CPU와 메모리를 반드시 미리 떼어놓아야 하기 때문입니다
이 세금 계산표가 조금이라도 불명확하거나 스케줄러가 알고 있는 용량과 노드가 보고하는 용량이 어긋날 경우, 클러스터에는 파드 스케줄링 거부와 갑작스러운 OOM(Out Of Memory) 종료가 반복해서 발생합니다

이 글에서는 AWS EKS의 노드 초기화 소스 코드와 Google Cloud GKE의 예약 공식을 해부하여 클라우드 관리형 쿠버네티스가 워커 노드의 회계 장부를 작성하는 원리를 증명합니다

## 노드 자원의 3중 분할 구조

워커 노드의 물리적 하드웨어 용량은 쿠버네티스 제어 평면을 거치면서 크게 세 겹의 경계선으로 분할됩니다

![노드 자원의 3중 분할 구조](/diagrams/cloud-node-resource-accounting-1.svg)

위 도식에서 나타나는 세부 청구 항목과 회계 공식은 다음과 같이 정의됩니다

1. **Capacity (물리적 총량)**
   EC2 인스턴스나 GCE 가상 머신이 제공하는 하드웨어 원본 스펙입니다
   `/proc/cpuinfo`와 `/proc/meminfo`에서 조회되는 물리적 vCPU 코어 수와 총 메모리 바이트 수가 여기에 해당합니다

2. **System Taxes (시스템 공제 항목)**
   - **`kube-reserved`**: Kubelet 데몬 자체와 Containerd(또는 CRI-O) 컨테이너 런타임이 안정적으로 실행되기 위해 예약하는 자원입니다
   - **`system-reserved`**: SSH, Systemd, 네트워크 스택 등 Linux 호스트 커널과 OS 기본 데몬을 위해 남겨두는 자원입니다
   - **`eviction-hard`**: 노드의 전체 메모리나 디스크가 고갈되어 커널 패닉에 빠지는 현상을 막기 위해 Kubelet이 강제 파드 퇴거(Eviction)를 발동하는 최저 마지노선 버퍼입니다

3. **Allocatable (스케줄링 가능 총량)**
   물리적 총량에서 공제 항목을 모두 뺀 최종 잔액입니다
   쿠버네티스 스케줄러는 노드의 `Capacity`가 아닌 **`Allocatable`만을 기준으로 파드의 요청(`requests`)을 심사**합니다

공식으로 표현하면 노드의 회계 장부는 다음 식을 엄격하게 따릅니다

```text
Allocatable = Capacity - (kube-reserved + system-reserved + eviction-hard)
```

이 산식이 어긋나면 어떤 일이 일어나는지 구체적인 코드로 확인해보겠습니다

## EKS의 인두세(Poll Tax) 공식 해부

AWS EKS는 Amazon Linux 2023 AMI부터 기존의 Bash 쉘 스크립트(`bootstrap.sh`)를 버리고 Go 언어로 작성된 전용 노드 관리자 **`nodeadm`**을 도입했습니다
`awslabs/amazon-eks-ami` 레포지토리의 `nodeadm/internal/kubelet/config.go`를 조회하면 EKS가 `kube-reserved`를 산출하는 정확한 소스 코드를 확인할 수 있습니다

```go
// awslabs/amazon-eks-ami (commit b4fffb7)
// nodeadm/internal/kubelet/config.go:442-444

func getMemoryMebibytesToReserve(maxPods int32) int32 {
	return 11*maxPods + 255
}
```

소스 코드가 명시하는 EKS의 메모리 예약 공식은 놀랍도록 단순합니다

```text
Memory KubeReserved = (11 MiB × maxPods) + 255 MiB
```

이 공식이 의미하는 엔지니어링 철학을 짚어보겠습니다

대부분의 엔지니어는 노드의 메모리가 크면 클수록 쿠버네티스 시스템이 더 많은 메모리를 예약할 것이라 막연하게 추측합니다
하지만 EKS는 노드의 물리적 메모리가 16 GiB이든 256 GiB이든 **물리 RAM 용량 자체는 공식에 반영하지 않습니다**
오직 해당 인스턴스가 가질 수 있는 파드의 최대 개수(`maxPods`)에 11 MiB를 곱하고, 기본 OS 및 Kubelet 베이스라인으로 255 MiB를 더할 뿐입니다

왜 물리적 메모리 대신 파드 수에 종속되는 공식을 선택했을까요

Kubelet이 소비하는 메모리의 상당 부분은 파드와 컨테이너를 관리하기 위한 인메모리 상태 구조체, cgroup 디렉토리 트리 감시, PLEG(Pod Lifecycle Event Generator) 고루틴 루프에서 발생합니다
파드 1개가 추가될 때마다 Kubelet 내부 캐시와 상태 동기화 루프가 늘어나며, 이에 필요한 평균 오버헤드가 정확히 약 11 MiB에 수렴합니다
즉 EKS는 자산의 크기에 세금을 매기는 것이 아니라, **노드에 탑승하는 파드의 머릿수(`maxPods`)에 정확히 비례하여 인두세(Poll Tax)를 부과**합니다

한편 CPU 예약 공식은 메모리와 달리 코어 구간별 계단식 감쇠 비율을 적용합니다
동일한 파일의 코드를 살펴보겠습니다

```go
// awslabs/amazon-eks-ami (commit b4fffb7)
// nodeadm/internal/kubelet/config.go:410-428

func getCPUMillicoresToReserve(resources system.Resources) int {
	totalCPUMillicores, err := resources.GetMilliNumCores()
	if err != nil {
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

`cpuPercentageReservedForRanges`가 배열로 정의한 `600, 100, 50, 25`는 10000 분율 기준 수치입니다
이를 백분율로 환산하면 다음과 같은 계단식 공제율이 도출됩니다

- **첫 1코어 (`0 ~ 1000m`)**: 6% (`60m`)
- **두 번째 코어 (`1000m ~ 2000m`)**: 1% (`10m`)
- **세 번째~네 번째 코어 (`2000m ~ 4000m`)**: 0.5% (`10m`)
- **4코어 초과 구간 (`4000m+`)**: 0.25%

코어 수가 늘어날수록 OS 루프와 Kubelet 데몬이 소비하는 CPU 비율은 급격히 감소하므로 대형 인스턴스일수록 더 많은 CPU 비율을 사용자 파드에 넘겨주는 구조입니다

여기서 한 가지 중요한 회계적 특징이 발견됩니다
`nodeadm`은 `kubeReserved`에 메모리와 CPU를 설정하지만, `systemReserved` 항목은 별도로 값을 입력하지 않고 비워둡니다
AL2023 AMI는 OS 커널과 시스템 데몬이 사용하는 자원을 `kubeReserved`의 `11 × maxPods + 255` 산식 안에 통합하여 한 번에 징수하기 때문입니다

## EKS와 GKE의 메모리 예약 공식 비교

그렇다면 경쟁사인 Google Cloud GKE는 워커 노드의 회계를 어떻게 처리할까요
EKS의 인두세 공식과 GKE 문서에 공시된 계단식 공제 산식을 직접 비교해보겠습니다

![EKS와 GKE의 메모리 예약 공식 비교](/diagrams/cloud-node-resource-accounting-2.svg)

GKE 공식 문서가 명시하는 메모리 예약(`kube-reserved` + `system-reserved` 합산) 규칙은 EKS와 정반대로 **파드 수와 무관하게 물리적 RAM 총량에 비례하는 계단식 누진세(Property Tax)** 구조를 취합니다

- **1 GB 미만**: 255 MiB 고정 예약
- **첫 4 GB (`0 ~ 4 GiB`)**: 25% (`1,024 MiB`)
- **다음 4 GB (`4 ~ 8 GiB`)**: 20% (`819.2 MiB`)
- **다음 8 GB (`8 ~ 16 GiB`)**: 10% (`819.2 MiB`)
- **다음 112 GB (`16 ~ 128 GiB`)**: 6% (`6,717.4 MiB` 최대)
- **128 GB 초과 구간 (`128 GiB+`)**: 2%

이 두 클라우드의 산식 차이가 실제 물리 인스턴스에서 얼마나 큰 용량 격차를 만들어내는지 정량적으로 계산해보겠습니다

물리 RAM이 **64 GiB**인 16코어 노드(`m5.4xlarge` 및 `e2-standard-16` 급)를 기준으로 대조합니다
AWS `m5.4xlarge`의 기본 `maxPods`는 ENI IP 할당 한계에 의해 **250개**로 설정됩니다

| 회계 항목 | AWS EKS (`nodeadm` / `m5.4xlarge`) | Google Cloud GKE (`e2-standard-16` / 64 GB) | 비교 분석 |
|---|---|---|---|
| **물리적 총 용량 (`Capacity`)** | 65,536 MiB (`64.0 GiB`) | 65,536 MiB (`64.0 GiB`) | 동일 물리 스펙 |
| **메모리 공제 산식** | `(11 MiB × 250) + 255 MiB` | `4G×25% + 4G×20% + 8G×10% + 48G×6%` | 인두세 vs 누진세 |
| **예약 메모리 (`Reserved`)** | **3,005 MiB (`≈ 2.93 GiB`)** | **5,611.5 MiB (`≈ 5.48 GiB`)** | GKE가 약 **1.86배** 더 징수 |
| **강제 퇴거 버퍼 (`eviction-hard`)** | 100 MiB | 100 MiB | 공통 쿠버네티스 기본값 |
| **최종 스케줄링 가능 (`Allocatable`)** | **62,431 MiB (`≈ 60.97 GiB`)** | **59,824.5 MiB (`≈ 58.42 GiB`)** | EKS 파드가 약 **2.55 GiB** 더 사용 가능 |

이 숫자가 의미하는 실무적 시사점은 매우 명확합니다

동일한 64 GiB 노드를 구매하더라도 EKS는 파드 최대 허용 수에 맞춘 2.93 GiB만을 공제하므로 사용자 애플리케이션이 61 GiB 가까운 메모리를 자유롭게 사용할 수 있습니다
반면 GKE는 물리 메모리 크기에 비례하여 5.48 GiB라는 막대한 메모리를 안전 버퍼로 미리 떼어갑니다

어느 쪽이 무조건 더 낫다고 단정할 수는 없습니다
EKS는 자원 효율성을 극대화하여 사용자에게 더 많은 용량을 돌려주지만, 노드에서 Kubelet 이외의 무거운 커스텀 에이전트(예: 타사 보안 도구, 무거운 로깅 데몬)를 Host Network/Host Pid로 돌릴 경우 메모리 부족 위험이 커집니다
GKE는 5.5 GiB에 달하는 여유분을 확보하므로 커널 버퍼 캐시 급증이나 시스템 데몬의 메모리 스파이크가 발생해도 호스트 노드가 멈추는 커널 패닉을 강력하게 방어합니다

## Karpenter의 듀얼 회계 일치(Dual-Accounting Parity) 기전

이러한 노드 회계 공식은 단지 Kubelet이 노드 부팅 시 설정 파일로 읽는 데서 끝나지 않습니다
최근 AWS 생태계의 표준 오토스케일러로 자리 잡은 **Karpenter**의 소스 코드를 열어보면 이 산식이 스케줄러 내부 깊숙한 곳에 그대로 복제되어 있음을 알 수 있습니다

왜 Karpenter는 Kubelet의 회계 공식을 자신 안에 100% 동일하게 구현해야 했을까요

![Karpenter의 듀얼 회계 일치 구조](/diagrams/cloud-node-resource-accounting-3.svg)

Karpenter의 동작 메커니즘을 따라가보겠습니다

Karpenter는 클러스터 내에 대기 중인 파드(`Pending Pods`)들의 자원 요청량(`requests`)을 수집한 뒤, EC2 인스턴스 카탈로그에서 이 파드들을 가장 저렴하게 담을 수 있는 최적의 인스턴스 타입을 골라냅니다(Bin-Packing)
이때 인스턴스는 아직 물리적으로 생성되기도 전이므로 Kubelet이 실행되어 API 서버에 `Allocatable`을 보고할 수가 없습니다

만약 Karpenter가 가상의 인스턴스 용량을 시뮬레이션할 때 EKS AMI의 공식을 쓰지 않고 단순 추정치(예: 고정 1 GiB 공제)를 적용하면 치명적인 결함이 발생합니다

예를 들어 물리 메모리 16 GiB 인스턴스에서 Karpenter가 공제 항목을 1 GiB로 계산하여 **15 GiB의 파드 집합을 스케줄링하기로 결정**하고 EC2 노드를 생성했다고 가정하겠습니다
잠시 후 EC2 인스턴스가 부팅되고 AL2023 `nodeadm`이 실행되면서 Kubelet은 `11 × 110 + 255 = 1,465 MiB(약 1.43 GiB)`를 공제한 뒤, API 서버에 실제 `Allocatable`을 **14.57 GiB**로 보고합니다

스케줄러는 15 GiB 파드를 넣으려고 준비했으나 노드의 실용량은 14.57 GiB에 불과하므로, 파드는 노드에 안착하지 못하고 **Out Of memory 스케줄링 거부**를 당합니다
Karpenter는 파드가 여전히 대기 중인 것을 보고 또 다른 노드를 생성하는 **무한 프로비저닝 루프(Infinite Provisioning Loop)** 장애에 빠지게 됩니다

이 대참사를 원천 차단하기 위해 Karpenter AWS 프로바이더(`aws/karpenter-provider-aws`)는 `nodeadm`의 소스 코드를 문자 그대로 복제하고 있습니다
`pkg/providers/instancetype/types.go`의 실제 구현을 확인해보겠습니다

```go
// aws/karpenter-provider-aws (commit a2496cc)
// pkg/providers/instancetype/types.go:523-553

func kubeReservedResources(cpus, pods *resource.Quantity, kubeReserved map[string]string) corev1.ResourceList {
	resources := corev1.ResourceList{
		corev1.ResourceMemory:           resource.MustParse(fmt.Sprintf("%dMi", (11*pods.Value())+255)),
		corev1.ResourceEphemeralStorage: resource.MustParse("1Gi"), // default kube-reserved ephemeral-storage
	}
	// kube-reserved Computed from
	// https://github.com/bottlerocket-os/bottlerocket/pull/1388/files#diff-bba9e4e3e46203be2b12f22e0d654ebd270f0b478dd34f40c31d7aa695620f2fR611
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
		if cpu := cpus.MilliValue(); cpu >= cpuRange.start {
			r := float64(cpuRange.end - cpuRange.start)
			if cpu < cpuRange.end {
				r = float64(cpu - cpuRange.start)
			}
			cpuOverhead := resources.Cpu()
			cpuOverhead.Add(*resource.NewMilliQuantity(int64(r*cpuRange.percentage), resource.DecimalSI))
			resources[corev1.ResourceCPU] = *cpuOverhead
		}
	}
	return lo.Assign(resources, lo.MapEntries(kubeReserved, func(k string, v string) (corev1.ResourceName, resource.Quantity) {
		return corev1.ResourceName(k), resource.MustParse(v)
	}))
}
```

Karpenter의 소스 코드는 앞서 살펴본 `nodeadm`의 `getMemoryMebibytesToReserve` 및 `getCPUMillicoresToReserve` 함수와 1바이트 오차 없이 **완벽히 동일한 `(11 * pods) + 255` 산식과 `0.06 / 0.01 / 0.005 / 0.0025` 계단식 CPU 공제율을 수학적으로 거울 복제**하고 있습니다
또한 퇴거 임계치(`evictionThreshold`) 역시 100 MiB를 정확하게 감산합니다

```go
// aws/karpenter-provider-aws (commit a2496cc)
// pkg/providers/instancetype/types.go:555-559

func evictionThreshold(memory *resource.Quantity, storage *resource.Quantity, evictionHard map[string]string) corev1.ResourceList {
	overhead := corev1.ResourceList{
		corev1.ResourceMemory:           resource.MustParse("100Mi"),
		corev1.ResourceEphemeralStorage: resource.MustParse(fmt.Sprint(math.Ceil(float64(storage.Value()) / 100 * 10))),
	}
```

이 **듀얼 회계 일치(Dual-Accounting Parity)** 구조 덕분에 Karpenter가 프로비저닝 단계에서 계산한 인스턴스의 가상 `Allocatable`과, 2분 뒤 인스턴스가 부팅되어 Kubelet이 보고하는 실제 `Allocatable`은 소수점 이하까지 정확하게 일치하게 됩니다

## 클라우드 & 인프라 실전 연결

우리는 앞서 6부 19편(인두세)과 22편(매트릭스)에서 파드 1개가 추가될 때마다 Kubelet 내부 고루틴과 상태 동기화 루프에 가해지는 부담이 어떻게 늘어나는지 분석했습니다
이번 2편을 통해 그 메모리 오버헤드가 단지 추상적인 개념이 아니라, 실제 EKS와 Karpenter 소스 코드에서 **`11 MiB * maxPods + 255 MiB`라는 엄격한 인두세 공식으로 징수**되고 있음을 소스 수준에서 규명했습니다

워커 노드의 회계 장부를 정확히 이해하는 것은 클러스터 운영 비용 절감과 직결됩니다
만약 노드에 탑승하는 파드 수가 평균 30개에 불과한데도 인스턴스의 `maxPods`가 250개로 설정되어 있다면, EKS는 쓰지도 않을 가상 파드 220개분의 인두세(약 2.4 GiB)를 메모리에서 불필요하게 묶어두게 됩니다

하지만 노드당 파드 허용 수를 함부로 늘리거나 줄이는 작업에는 또 다른 클라우드 인프라의 물리적 한계가 얽혀 있습니다
AWS EC2는 가상 네트워크 인터페이스(ENI)마다 할당할 수 있는 보조 IPv4 주소 수가 하드웨어 스펙으로 제한되어 있기 때문입니다

다음 3편 **"고밀도 노드의 물리 — VPC CNI와 MaxPods"**에서는 `aws/amazon-vpc-cni-k8s` 소스 코드와 리눅스 커널 ENA 드라이버를 직접 해부하여, 노드당 파드 밀도를 110개에서 250개 이상으로 극대화할 때 VPC CNI가 겪는 ENI 접두사 위임(Prefix Delegation) 메커니즘과 네트워크 회계의 비밀을 파헤칩니다
