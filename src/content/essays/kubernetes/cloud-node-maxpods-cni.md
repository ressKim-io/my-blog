---
title: "고밀도 노드의 물리 — VPC CNI와 MaxPods"
excerpt: "클라우드 인프라 물리학 시리즈 3편. VPC CNI(amazon-vpc-cni-k8s)의 2차 IP 모드와 접두사 위임(Prefix Delegation) 산식, 리눅스 커널 ENA 드라이버의 MSI-X 큐 파편화를 소스 수준에서 규명하고, 노드당 파드 250개 안착 시 Kubelet PLEG가 겪는 물리적 병목을 증명합니다"
category: "kubernetes"
tags: ["kubernetes", "eks", "vpc-cni", "maxpods", "kubelet", "pleg", "ebpf", "cloud-optimization"]
series:
  name: "kernel-runtime-tradeoffs-7"
  order: 2
date: "2026-07-20"
---

> **근거 구성 및 분석 한계 명시**: 이 글은 AWS VPC CNI(`aws/amazon-vpc-cni-k8s` commit `f3a3374`)의 ENI 및 IP 한도 산출 소스 코드(`scripts/gen_vpc_ip_limits.go`, `pkg/ipamd/ipamd.go`)와 리눅스 커널 ENA 드라이버(`amzn/amzn-drivers` commit `acddbf2`)의 `ena_netdev.c` 소스를 직접 클론하여 검증한 **소스 확정** 등급 수치와, AWS Nitro 시스템 및 Kubelet PLEG 부하 메커니즘을 인용한 **문헌** 및 6부 실측 데이터를 바탕으로 작성되었습니다
>
> **⚠️ EKS 내부 물리 실측 부재에 따른 오차 고지**: 본문의 MSI-X 인터럽트 파편화 및 Kubelet 고밀도 부하 분석은 오픈소스 커널 드라이버와 VPC CNI 로직을 바탕으로 도출한 정밀한 물리적 인과율이지만, **실제 AWS EKS 클러스터(EC2 Nitro 하드웨어 인스턴스) 내부에서 직접 고밀도 파드를 생성하여 측정한 물리 실측 데이터가 아닙니다**
> AWS Nitro 시스템의 독점적인 하드웨어 오프로딩(ENI 인터럽트 가상화 제어, 하이퍼바이저 큐 최적화)이나 EKS 관리형 컨트롤 플레인의 내부 릴리즈 변경, CNI 데몬셋의 비동기 IPAM 처리 방식에 따라 **실제 AWS 운영 환경에서는 본문의 이론적 오버헤드 수치와 일정 부분 오차가 존재하거나 예기치 않은 예외 동작이 발생할 수 있음**을 투명하게 명시합니다

우리는 지난 2편에서 EKS가 워커 노드의 메모리를 징수할 때 물리 RAM 크기가 아닌 파드 허용 최대 개수(`maxPods`)에 11 MiB를 곱하는 인두세(Poll Tax) 방식을 취한다는 사실을 확인했습니다
그렇다면 단순히 Kubelet의 설정 파일에서 `maxPods` 값을 줄이거나 늘리면 모든 자원 최적화 문제가 해결될까요

실무에서 노드당 파드 밀도를 조정하는 일은 단순한 숫자 바꾸기가 아닙니다
클라우드 관리형 쿠버네티스의 워커 노드 위에는 가상 네트워크 카드(ENI)와 2차 IP 할당 로직, 리눅스 커널의 하드웨어 인터럽트 처리 메커니즘, 그리고 1초마다 컨테이너 상태를 감시하는 Kubelet의 생체 주기 엔진이 촘촘하게 얽혀 있습니다

이 글에서는 AWS VPC CNI와 리눅스 커널 ENA 드라이버 소스 코드를 직접 해부하여, 노드당 파드 밀도를 29개에서 250개 이상으로 극대화할 때 인프라 내부에 어떤 물리적 충돌과 대가가 발생하는지 소스 수준의 구조적 인과율을 규명합니다

## VPC CNI의 IP 할당 모드와 MaxPods 산식

AWS EKS 환경에서 파드의 네트워크 주소는 노드가 속한 VPC의 실제 사설 IP 주소 공간에서 직접 할당됩니다
이 작업을 전담하는 데몬셋이 바로 `amazon-vpc-cni-k8s`입니다

VPC CNI가 노드 인스턴스 타입별로 허용하는 기본 파드 수(`maxPods`) 산식은 `scripts/gen_vpc_ip_limits.go`에 Go 코드로 명확하게 코딩되어 있습니다

```go
// aws/amazon-vpc-cni-k8s (commit f3a3374)
// scripts/gen_vpc_ip_limits.go:42-46

// Helper to calculate the --max-pods to match the ENIs and IPs on the instance
func printPodLimit(instanceType string, l vpc.InstanceTypeLimits) string {
	maxPods := l.ENILimit*(l.IPv4Limit-1) + 2
	return fmt.Sprintf("%s %d", instanceType, maxPods)
}
```

소스 코드가 보여주는 기본 `maxPods` 산식은 다음과 같습니다

```text
Standard MaxPods = ENILimit × (IPv4Limit - 1) + 2
```

이 산식의 각 변수가 가지는 네트워크 구조적 의미를 짚어보겠습니다

- **`ENILimit`**: 해당 EC2 인스턴스가 물리적으로 부착할 수 있는 가상 네트워크 인터페이스(ENI)의 최대 개수입니다
- **`IPv4Limit - 1`**: ENI 1개당 할당 가능한 사설 IPv4 주소 수에서 기본 1차 IP(Primary IP) 1개를 제외한 숫자입니다. 1차 IP는 노드의 호스트 운영체제 자신이 통신하기 위해 사용하므로 파드에게 줄 수 없습니다
- **`+ 2`**: 노드의 HostNetwork 모드로 실행되는 호스트 필수 에이전트(`aws-node` VPC CNI 데몬셋 자체 및 `kube-proxy` 등)를 위해 더해주는 2개의 고정 보정치입니다. 이들은 ENI의 2차 IP 슬롯을 소모하지 않기 때문입니다

![VPC CNI의 IP 할당 모드 비교](/diagrams/cloud-node-maxpods-cni-1.svg)

위 도식에서 볼 수 있듯, 2차 IP 모드(Secondary IP Mode)에서 3개의 ENI와 ENI당 10개의 IP를 지원하는 `m5.large` 인스턴스는 `3 × (10 - 1) + 2 = 29`라는 엄격한 파드 한계를 가집니다
8개의 ENI와 30개의 IP를 지원하는 대형 인스턴스 `m5.4xlarge` 역시 이 공식에 따르면 `8 × (30 - 1) + 2 = 234`개의 파드만 탑승할 수 있습니다

이 고질적인 IP 가뭄을 단번에 해소하기 위해 도입된 기능이 바로 **접두사 위임(Prefix Delegation)** 모드입니다
VPC CNI 환경 변수 `ENABLE_PREFIX_DELEGATION=true`를 활성화할 때 CNI 내부 IPAM 컨트롤러가 어떻게 한도를 변경하는지 `pkg/ipamd/ipamd.go` 소스 코드에서 확인해보겠습니다

```go
// aws/amazon-vpc-cni-k8s (commit f3a3374)
// pkg/ipamd/ipamd.go:2569-2583

func (c *IPAMContext) GetIPv4Limit() (int, int, error) {
	var maxIPsPerENI, maxPrefixesPerENI, maxIpsPerPrefix int
	if !c.enablePrefixDelegation {
		maxIPsPerENI = c.awsClient.GetENIIPv4Limit()
		maxPrefixesPerENI = 0
	} else if c.enablePrefixDelegation {
		// Single PD - allocate one prefix per ENI and new add will be new ENI + prefix
		// Multi - allocate one prefix per ENI and new add will be new prefix or new ENI + prefix
		_, maxIpsPerPrefix, _ = datastore.GetPrefixDelegationDefaults()
		maxPrefixesPerENI = c.awsClient.GetENIIPv4Limit()
		maxIPsPerENI = maxPrefixesPerENI * maxIpsPerPrefix
		log.Debugf("max prefix %d max ips %d", maxPrefixesPerENI, maxIPsPerENI)
	}
	return maxIPsPerENI, maxPrefixesPerENI, nil
}
```

그리고 `datastore.GetPrefixDelegationDefaults()`가 반환하는 기본 상수는 `pkg/ipamd/datastore/data_store.go`에 명시되어 있습니다

```go
// aws/amazon-vpc-cni-k8s (commit f3a3374)
// pkg/ipamd/datastore/data_store.go:1552-1558

func GetPrefixDelegationDefaults() (int, int, int) {
	numPrefixesPerENI := 1
	numIPsPerPrefix := 16
	supportedPrefixLen := 28

	return numPrefixesPerENI, numIPsPerPrefix, supportedPrefixLen
}
```

접두사 위임 모드가 켜지면 ENI의 2차 IP 슬롯 하나하나가 개별 IP 주소 1개가 아닌, **`/28` CIDR 블록(16개의 IP 주소)** 전체로 교체됩니다
즉 ENI당 가용 IP 한도가 `(IPv4Limit - 1) × 16`으로 폭증합니다

`m5.large` 인스턴스는 단 1개의 ENI만으로도 `9 × 16 = 144`개의 IP를 확보하며, 인스턴스 전체로는 이론상 `3 × 9 × 16 + 2 = 434`개의 IP 공간을 가지게 됩니다
이로써 클라우드 네트워크의 사설 주소 고갈 문제는 완전히 해결된 것처럼 보입니다
하지만 이 네트워킹 모드의 변경은 리눅스 커널의 네트워크 장치 드라이버 영역에 엄청난 나비효과를 일으킵니다

## ENA 드라이버의 PCI 큐와 MSI-X 인터럽트 파편화

왜 접두사 위임 모드를 쓰지 않고 기존 2차 IP 모드에서 파드 234개를 띄우기 위해 8개의 물리 ENI(`eth0`부터 `eth7`까지)를 노드에 모두 부착하면 안 될까요
AWS의 공식 리눅스 커널 ENA(Elastic Network Adapter) 드라이버 소스 코드를 통해 가상 네트워크 카드가 호스트 커널에 미치는 물리적 오버헤드를 추적해보겠습니다

![ENA 드라이버의 PCI 큐와 MSI-X 파편화 물리](/diagrams/cloud-node-maxpods-cni-2.svg)

EC2 인스턴스에 ENI가 부착되면 리눅스 커널은 이를 독립된 PCI 네트워크 디바이스로 인식하고 `amzn/amzn-drivers` 레포지토리의 `kernel/linux/ena/ena_netdev.c` 드라이버를 로드합니다
드라이버 초기화 루틴에서 가장 핵심적인 부분은 하드웨어 인터럽트 벡터(MSI-X)를 할당하는 코드입니다

```c
// amzn/amzn-drivers (commit acddbf2)
// kernel/linux/ena/ena_netdev.c:2034-2045

	msix_vecs = ENA_MAX_MSIX_VEC(adapter->max_num_io_queues);
	netif_dbg(adapter, ifup, adapter->netdev,
		  "Trying to enable MSI-X, vectors %d\n", msix_vecs);

	adapter->msix_entries = vzalloc(msix_vecs * sizeof(struct msix_entry));
	if (!adapter->msix_entries)
		return -ENOMEM;

	for (i = 0; i < msix_vecs; i++)
		adapter->msix_entries[i].entry = i;
```

`ENA_MAX_MSIX_VEC`는 드라이버의 입출력 큐 개수(`max_num_io_queues`)에 관리용 인터럽트 1개를 더한 값을 도출합니다
그리고 ENA 드라이버 공식 문서인 `ENA_Linux_Best_Practices.rst`는 각 ENI가 생성하는 입출력 큐 개수를 다음과 같이 공시하고 있습니다

```text
number of queues exposed per ENI is calculated as : MIN(MAX_NUM_QUEUES_PER_ENI, NUM_OF_VCPUS)
MAX_NUM_QUEUES_PER_ENI is 8 for most of the instance types (and up to 32 on larger instances)
and one IRQ for each ENA queue.
```

이 물리적 메커니즘을 16코어 인스턴스(`m5.4xlarge`)에 대입해보겠습니다

만약 접두사 위임 없이 2차 IP 모드로 234개 파드를 수용하기 위해 **8개의 ENI(`eth0` ~ `eth7`)를 모두 부착**한다면 어떻게 될까요
각 ENI는 vCPU 수에 맞춰 최대 8개의 입출력 큐를 생성하므로, 8개 ENI × 8개 큐 = **총 64개의 TX/RX 링 버퍼와 64개의 MSI-X 하드웨어 인터럽트 라인**이 리눅스 커널에 등록됩니다

네트워크 트래픽이 유입될 때 커널 NAPI(New API) 폴링 함수 `ena_napi_poll()`은 64개에 달하는 개별 큐를 순회하며 패킷을 수확해야 합니다
이 과정에서 여러 vCPU가 서로 다른 ENI 큐의 스핀락을 획득하려고 경쟁하면서 `native_queued_spin_lock_slowpath()` 커널 함수 호출이 급증하고, 호스트 CPU의 `ksoftirqd` 소프트 인터럽트 오버헤드(`si`)가 폭증합니다

반면 **접두사 위임 모드**를 사용하면 상황이 완전히 달라집니다
`eth0`과 `eth1` 단 2개의 ENI만으로 288개 이상의 IP를 확보하므로, PCI 디바이스는 단 2개만 로드되고 MSI-X 인터럽트 벡터는 **16개로 압축 집중**됩니다
결과적으로 다중 ENI 부착으로 인한 커널 스핀락 경합과 소프트 인터럽트 세금을 75% 이상 제거할 수 있습니다

## 고밀도 노드(MaxPods=250)와 Kubelet PLEG 병목

접두사 위임을 통해 ENI 파편화 없이 IP 주소를 확보했으므로, 이제 노드당 파드 허용 수(`maxPods`)를 250개로 설정하여 고밀도 배포를 달성할 수 있습니다
하지만 파드 250개가 물리 노드 1대에 동시에 탑승할 때 우리는 쿠버네티스 아키텍처의 또 다른 한계 벽인 **Kubelet 런타임 병목**과 마주치게 됩니다

![고밀도 노드 250 파드 안착 시 Kubelet의 물리적 병목](/diagrams/cloud-node-maxpods-cni-3.svg)

우리가 6부 24편에서 실측 및 분석했던 Kubelet 고루틴 증식 및 PLEG 메커니즘을 복기하면, 고밀도 노드가 겪는 물리적 부하는 다음 두 가지 현상으로 귀결됩니다

1. **cgroup 트리 순회 및 가상 마운트 스캔 부하**
   파드 1개는 평균적으로 애플리케이션 컨테이너 1~2개와 pause 컨테이너 1개로 구성됩니다
   노드에 파드 250개가 안착하면 Kubelet과 컨테이너 런타임이 관리해야 할 개별 컨테이너 수는 약 **750개**에 달합니다
   리눅스 커널 `/sys/fs/cgroup/cpu` 및 `/sys/fs/cgroup/memory` 계층에 1,500개 이상의 서브 디렉토리 트리가 생성되며, 매 파드 마운트마다 `/proc/mounts` 항목이 늘어납니다
   Kubelet의 상태 동기화 고루틴(`statusManager`, `volumeManager`)이 주기적으로 이 거대한 인메모리 트리와 마운트 테이블을 읽고 정렬하는 동안 CPU 바인드 지연이 지속해서 발생합니다

2. **PLEG(Pod Lifecycle Event Generator) 지연 임계 초과**
   Kubelet의 심장인 PLEG 루프는 주기적으로 컨테이너 런타임(`containerd`)의 gRPC 소켓을 호출하여 노드 내 모든 컨테이너의 상태(`Running`, `Exited` 등)를 확인합니다
   파드 250개(컨테이너 750개)가 배치된 노드에서는 단 1번의 CRI 목록 조회 질의(`ListContainers`)만으로도 거대한 JSON/Proto 응답 메시지를 직렬화 및 역직렬화해야 합니다
   이 부하로 인해 PLEG의 1회 주기 실행 시간(`relistDuration`)이 기본 임계치인 3분을 넘기게 되면, Kubelet은 스스로를 장애 상태로 간주하고 API 서버에 **`NodeNotReady (PLEG is not healthy)`** 이벤트를 보고하며 모든 서비스 트래픽을 차단해버립니다

결국 2편에서 살펴본 EKS의 메모리 인두세 공식 `11 * maxPods + 255 MiB`가 `maxPods = 250`일 때 약 3.0 GiB의 RAM을 미리 떼어가는 이유는, 이 750개 컨테이너를 통제하는 거대한 고루틴 군단과 인메모리 캐시를 지탱하기 위한 최소한의 물리적 생존 댓가였던 것입니다

## 클라우드 & 인프라 실전 연결

이번 3편을 통해 우리는 클라우드 노드의 네트워킹 밀도와 가상화 커널 사이의 물리적 인과율을 소스 수준에서 규명했습니다

실무 엔지니어링 관점에서 도출되는 최적화 전략은 매우 명쾌합니다

- **중소형 인스턴스 또는 저밀도 워크로드 (`maxPods ≤ 30`)**: 무리하게 접두사 위임이나 `maxPods`를 250개로 올릴 필요가 없습니다. 오히려 2편의 인두세 산식에 의해 쓰지도 않을 파드 220개분의 메모리(약 2.4 GiB)를 낭비하게 됩니다
- **대형 인스턴스 및 고밀도 마이크로서비스 (`maxPods > 100`)**: 반드시 `ENABLE_PREFIX_DELEGATION=true`를 적용하여 물리 ENI 부착 개수를 1~2개로 제한해야 합니다. 이를 통해 ENA 드라이버의 MSI-X 인터럽트 분산을 막고 호스트 CPU의 커널 스пин락 경합(`ksoftirqd`)을 제거할 수 있습니다
- **극단적 고밀도 한계 (`maxPods = 250`) 설정 시 주의점**: IP 주소가 충분하더라도 Kubelet PLEG 부하와 cgroup 순회 비용을 감당하기 위해 충분한 CPU 및 메모리 여유분(`Allocatable`)이 보장되어야 합니다
- **AWS EKS 실제 환경 도입 시 검증 필수성 (분석 한계 대조)**: 본문의 MSI-X 파편화 완화 및 PLEG 지연 메커니즘은 오픈소스 소스 코드(`ena_netdev.c`, `amazon-vpc-cni-k8s`)와 Kubelet 아키텍처에 기반한 구조적 인과율입니다. 실제 AWS EKS 프로덕션 클러스터는 Nitro 하드웨어 오프로딩 카드와 관리형 컨트롤 플레인의 독점적 가상화 제어가 개입하므로, 고밀도 설정을 적용하기 전에는 반드시 자사 인스턴스 타입과 실제 워크로드 트래픽 하에서 실측 스트레스 테스트(NAPI 인터럽트 및 PLEG 지연 모니터링)를 거쳐 오차와 안정성을 직접 검증해야 합니다

그러나 VPC CNI와 iptables/nftables 기반의 통상적인 데이터플레인은 파드 수가 늘어날수록 커널 연결 추적(conntrack) 테이블과 라우팅 룰을 순회하는 데 또 다른 세금을 지불합니다

다음 4편 **"eBPF 데이터플레인 — Cilium을 로컬에서 잰다"**에서는 리눅스 커널 소켓 수준에서 트래픽을 단축시키는 eBPF `sock_hash` 및 `sk_msg` 리다이렉트 소스 코드를 해부하고, 로컬 실측을 통해 호스트 네트워킹 스택을 건너뛸 때 얻을 수 있는 데이터플레인의 물리적 이득과 Google Cloud GKE Dataplane V2의 연결고리를 파헤칩니다
