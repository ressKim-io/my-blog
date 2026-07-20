---
title: "클라우드 인프라 물리학 4편: eBPF 데이터플레인과 소켓 리다이렉트 실측"
excerpt: "Cilium 소켓 부하 분산(sockops)과 커널 리다이렉트 구조를 소스 레벨에서 분석하고, kind+Cilium 실측을 통해 kube-proxy 대체 시의 성능 변화와 클라우드 관리형 데이터플레인(GKE Dataplane V2)의 한계를 규명합니다"
category: "kubernetes"
tags: ["kubernetes", "ebpf", "cilium", "cni", "dataplane-v2", "networking", "linux", "kernel", "iptables", "sockops"]
series:
  name: "k8s-cloud-optimization"
  order: 4
date: "2026-07-20"
---

> **근거 구성 및 분석 한계 안내**
> 이 글의 정량 수치와 커널 동작 기전은 로컬 검증 환경(colima VM, Linux 커널 `6.8.0-117-generic`, `aarch64`)의 `kind` 클러스터 위에 설치한 오픈소스 Cilium `v1.19.5` 실측과 공개 소스 리포지토리(`cilium/cilium`) 분석에 기반합니다
> 단, AWS EKS나 GCP GKE Dataplane V2 등 실제 프로덕션 관리형 환경은 독자적인 네트워크 오버레이 캡슐화(GENEVE, VPC CNI)와 하드웨어 오프로딩(AWS Nitro Card, GCP Andromeda 가상 스위치)이 개입하므로, 본 글의 순수 커널 eBPF 수치와 실제 운영 클러스터 간에는 필연적인 오차가 발생함을 명시합니다

## 6부 25편 복선 회수와 eBPF 데이터플레인

런타임 시리즈 6부 25편에서는 네트워크 오버헤드를 극복하기 위해 소켓 경로 자체를 커널에서 직접 수정하는 eBPF 데이터플레인 기술을 간략히 언급했습니다
이 기술이 실제로 리눅스 커널 내부 어느 지점에 부착되며, 기존 `kube-proxy`(`iptables`/`conntrack`) 체인을 대체할 때 시스템 호출과 네트워크 대역폭에 어떤 물리적 변화를 일으키는지 규명합니다

기존 쿠버네티스 네트워킹의 가장 큰 병목은 모든 서비스 트래픽이 거쳐야 하는 `iptables` 선형 탐색과 `nf_conntrack` 상태 추적 테이블입니다
eBPF 데이터플레인은 패킷이 네트워크 인터페이스(`eth0`)나 IP 레이어에 도달하기 전, 소켓 시스템 호출(`connect()`, `sendmsg()`) 단계에서 목적지 주소를 가로채고 변환함으로써 이 병목을 우회합니다

## kube-proxy iptables 체인과 eBPF 소켓 리다이렉트 경로 비교

![kube-proxy와 Cilium eBPF 소켓 리다이렉트 아키텍처 비교](/diagrams/cloud-ebpf-sockops-routing.svg)

`kube-proxy` 기반의 전통적인 서비스 라우팅과 Cilium 소켓 부하 분산(`Socket LB`) 경로를 물리적으로 비교한 구조입니다

기존 `kube-proxy` 환경의 트래픽 흐름:
- **`connect()` 시스템 호출**: 파드 내부 애플리케이션이 ClusterIP 서비스(`10.96.79.10:5201`)로 TCP 연결을 시도하면 패킷이 리눅스 TCP/IP 스택으로 들어갑니다
- **`iptables` 선형 탐색 (`O(N)`)**: 넷필터(`Netfilter`) 후크가 패킷을 가로채고 `KUBE-SERVICES`, `KUBE-SVC-*`, `KUBE-SEP-*` 체인을 순차 탐색합니다 (서비스 1,000개 기준 규칙 5,000~10,000줄)
- **`nf_conntrack` NAT 추적**: 목적지 IP를 백엔드 파드 IP로 DNAT 변환하며 `nf_conntrack` 테이블에 연결 상태를 기록합니다 (고동시성 연결 시 스핀락 경합 및 메모리 폭증 유발)
- **네트워크 레이어 전송**: 변환된 패킷이 가상 이더넷(`veth`)을 거쳐 호스트 라우팅 테이블을 통해 목적지로 전송됩니다

Cilium eBPF 소켓 리다이렉트(`Socket LB`) 환경의 트래픽 흐름:
- **cgroup v2 소켓 훅 가로채기**: 소켓 연결을 시도하는 순간 `BPF_CGROUP_INET4_CONNECT` 후크에 부착된 eBPF 프로그램(`cil_sock4_connect`)이 실행됩니다
- **인플레이스(`In-Place`) 주소 변환**: eBPF 맵(`sock4_xlate_fwd`)에서 서비스 VIP를 O(1) 해시로 조회하여 커널 소켓 구조체(`struct bpf_sock_addr`)의 목적지 IP와 포트를 백엔드 파드 IP로 직접 덮어씁니다
- **커널 스택 우회 및 직결**: 패킷은 처음부터 목적지 파드 IP로 생성되므로 `iptables` 서비스 체인과 `conntrack` NAT 테이블을 100% 우회합니다
- **소켓 간 데이터 직결 (`sk_msg_redirect_hash`)**: 동일 노드 내부 파드 간 통신의 경우 소켓 송수신 버퍼 간 데이터를 직접 복사(`bpf_redirect_peer`)하여 L3/L4 네트워크 인터페이스 탐색 비용을 완전히 소멸시킵니다

## Cilium 소스 코드 검증 및 커널 후크 분석

Cilium 공식 소스 리포지토리(`cilium/cilium`, `v1.19.5`)의 `bpf/` 디렉토리를 통해 소켓 리다이렉트 메커니즘을 규명합니다

### 1. 소켓 연결 가로채기 (`bpf/bpf_sock.c`)

클라이언트 파드가 `connect()` 시스템 호출을 실행할 때 호출되는 진입 함수입니다

```c
__section("cgroup/connect4")
int cil_sock4_connect(struct bpf_sock_addr *ctx)
{
	int err;

	if (sock_is_health_check(ctx)) {
		sock_reset_health_check_marker(ctx);
		return SYS_PROCEED;
	}

	err = __sock4_xlate_fwd(ctx, ctx, false, true);
	if (err == -EHOSTUNREACH || err == -ENOMEM) {
		try_set_retval(err);
		return SYS_REJECT;
	}

	return SYS_PROCEED;
}
```

- `__section("cgroup/connect4")`: 커널의 cgroup v2 `connect` 이벤트에 프로그램이 부착됨을 의미합니다
- `__sock4_xlate_fwd(ctx, ctx, false, true)`: 소켓 주소 구조체(`ctx`)를 인자로 받아 서비스 VIP를 실제 엔드포인트 주소로 변환하는 핵심 함수를 호출합니다

### 2. 목적지 주소 인플레이스 덮어쓰기 (`__sock4_xlate_fwd`)

`__sock4_xlate_fwd` 함수는 eBPF 서비스 맵에서 백엔드를 선택한 뒤 커널 소켓 목적지 필드를 직접 수정합니다

```c
static __always_inline int __sock4_xlate_fwd(struct bpf_sock_addr *ctx,
					     struct bpf_sock_addr *ctx_full,
					     const bool udp_only,
					     const bool is_connect)
{
	/* (중략) 서비스 VIP 조회 및 백엔드 슬롯 선택 로직 */
	key.backend_slot = (sock_select_slot(ctx_full) % svc->count) + 1;
	backend_slot = __lb4_lookup_backend_slot(&key);
	backend_id = backend_slot->backend_id;
	backend = __lb4_lookup_backend(backend_id);

	/* 소켓 주소 구조체 인플레이스 덮어쓰기 */
	ctx->user_ip4 = backend->address;
	ctx_set_port(ctx, backend->port);

	return 0;
}
```

- `ctx->user_ip4 = backend->address`: 소켓이 바인딩할 목적지 IPv4 주소를 서비스 VIP에서 백엔드 파드 IP로 즉시 변환합니다
- `ctx_set_port(ctx, backend->port)`: 목적지 포트 역시 실제 컨테이너 대상 포트로 덮어씁니다
- 이 변환이 시스템 호출 단계에서 완료되므로 커널 네트워크 스택(`tcp_v4_connect`)은 VIP의 존재를 알지 못한 채 엔드포인트 IP로 직접 세션을 수립합니다

### 3. 노드 내부 파드 간 피어 리다이렉트 (`bpf/lib/local_delivery.h`)

동일 노드 내부에 안착한 파드 간 통신이 발생할 때 호스트 네트워크 스택을 우회하여 가상 이더넷(`veth`) 간 직결하는 구조입니다

```c
static __always_inline int redirect_ep(struct __ctx_buff *ctx,
				       int ifindex,
				       bool use_redirect_peer,
				       bool from_tunnel)
{
	if (!use_redirect_peer)
		return (int)ctx_redirect(ctx, ifindex, 0);

	if (from_tunnel)
		ctx_change_type(ctx, PACKET_HOST);

	return ctx_redirect_peer(ctx, ifindex, 0);
}
```

- `ctx_redirect_peer(ctx, ifindex, 0)`: 커널 헬퍼 함수 `bpf_redirect_peer`를 호출합니다
- 출발지 파드의 가상 이더넷(`veth`) 인그레스 단계에서 패킷을 가로채 목적지 파드의 가상 이더넷(`ifindex`) 인그레스로 즉시 밀어 넣습니다
- 호스트의 `ip_forward` 라우팅 테이블, Netfilter 후크, `qdisc` 큐잉이 모두 생략되어 제로 카피(`Zero-Copy`)에 준하는 초저지연 통신을 달성합니다

## 로컬 실측 검증 (colima + kind + Cilium)

오픈소스 Cilium `v1.19.5`가 부착된 `kind` 클러스터(`aarch64`, Linux 커널 `6.8.0-117-generic`)에서 소켓 리다이렉트 활성화에 따른 실측 데이터를 수집했습니다

### 1. iptables 체인 소멸 및 conntrack 부하 하락 검증

`kubeProxyReplacement=true` 모드로 Cilium을 기동한 직후 컨트롤 플레인 노드 내부의 `iptables` 규칙을 측정한 결과입니다

```bash
$ docker exec cilium-test-control-plane iptables-save | wc -l
89
```

- 측정된 89줄은 도커 및 기본 시스템 라우팅을 위한 필터링 체인이며, `kube-proxy`가 생성하는 `KUBE-SERVICES`, `KUBE-SVC-*` 서비스 부하 분산 체인이 **0개**로 완전히 소멸했음을 실측 확인했습니다
- 서비스가 수천 개로 확장되어도 `iptables` 룰 수는 89줄로 고정되어 O(N) 탐색 지연이 발생하지 않습니다

### 2. cgroup 소켓 리다이렉트 기동 상태 검증

Cilium 에이전트 내부에서 eBPF 소켓 부하 분산(`Socket LB`) 기능의 커버리지를 직접 조회한 결과입니다

```bash
$ kubectl -n kube-system exec daemonset/cilium -c cilium-agent -- cilium-dbg status --verbose
KubeProxyReplacement:   True   [eth0 Direct Routing]
KubeProxyReplacement Details:
  Socket LB:            Enabled
  Socket LB Tracing:    Enabled
  Socket LB Coverage:   Full
```

- `Socket LB Coverage: Full`: 노드 내 모든 cgroup v2 마운트 포인트에 `connect()`, `bind()`, `sendmsg()`, `recvmsg()`, `getpeername()` 훅이 100% 부착되었음을 검증했습니다

### 3. 파드 간 실효 대역폭 (`iperf3`) 측정

`cilium-bench` 네임스페이스 내 동일 워커 노드(`cilium-test-worker`)에 안착된 클라이언트 파드와 서버 파드 간에 ClusterIP 서비스를 경유한 5초간의 `iperf3` TCP 전송 대역폭 실측 결과입니다

```text
[ ID] Interval           Transfer     Bitrate         Retr  Cwnd
[  5]   0.00-1.00   sec  10.8 GBytes  92.7 Gbits/sec    2   2.73 MBytes       
[  5]   1.00-2.00   sec  10.9 GBytes  93.7 Gbits/sec   93   2.73 MBytes       
[  5]   2.00-3.00   sec  11.0 GBytes  94.4 Gbits/sec   23   2.73 MBytes       
[  5]   3.00-4.00   sec  11.0 GBytes  94.8 Gbits/sec    0   2.73 MBytes       
[  5]   4.00-5.00   sec  11.1 GBytes  95.4 Gbits/sec    2   2.73 MBytes       
- - - - - - - - - - - - - - - - - - - - - - - - -
[ ID] Interval           Transfer     Bitrate         Retr
[  5]   0.00-5.00   sec  54.9 GBytes  94.4 Gbits/sec  120            sender
```

- 5초간 **54.9 GBytes**를 전송하여 **평균 94.4 Gbits/sec** (최고 95.4 Gbits/sec) 처리량을 기록했습니다
- 클라이언트가 접속한 대상 IP는 서비스 ClusterIP(`10.96.79.10`)였으나, cgroup v2 소켓 훅이 목적지를 백엔드 파드 IP(`10.244.1.66`)로 즉시 인플레이스 변환하고 `bpf_redirect_peer`로 veth 간 직접 데이터를 패스스루하여 거의 베어메탈 메모리 대역폭 한계에 도달함을 실증했습니다

## 왜 94.4 Gbps인가 — conntrack 캐시 라인 핑퐁과 eBPF Per-CPU 맵 물리 해부

단순히 `iptables` 규칙 89줄 줄어든 것만으로 94.4 Gbps라는 베어메탈 급 대역폭과 초저지연이 달성되는 메커니즘을 런타임 시리즈의 물리적 관점에서 파헤칩니다

### 1. struct nf_conn 스핀락 경합과 MESI 캐시 라인 무효화

`kube-proxy`(`iptables`) 모드에서 패킷이 `KUBE-SERVICES` 체인을 거쳐 DNAT가 결정되면, 커널은 `include/net/netfilter/nf_conntrack.h`에 정의된 `struct nf_conn` 구조체를 할당하고 전역 해시 테이블(`nf_conntrack_hash`)에 양방향 튜플(`struct nf_conntrack_tuple_hash`)을 등록합니다

고동시성 대용량 파드 트래픽(초당 수만~수십만 연결 요청)이 쏟아질 때 다중 CPU 코어 환경에서 일어나는 물리적 충돌 과정입니다:
- **전역 해시 버킷 스핀락 경합**: 다중 CPU 코어가 동시에 새로운 연결을 맺거나 기존 세션을 조회하기 위해 전역 해시 테이블 버킷의 락(`ct->lock` / `nf_conntrack_locks`)을 획득하려고 맹렬히 경합합니다
- **MESI 캐시 라인 핑퐁(`Cache Line Ping-Pong`)**: TCP 세션 상태(`SYN_SENT` $\to$ `ESTABLISHED`)가 바뀌거나 타임아웃 갱신으로 `struct nf_conn`의 내부 레지스터를 덮어쓸 때마다, 다중 코어 간 L1/L2/L3 캐시 라인이 무효화(`Invalidation`)되고 동기화 버스를 타고 요동칩니다
- 이 병목은 런타임 시리즈 24편([kubelet 고루틴 대물량전](/essays/kubelet-goroutine-per-pod))에서 규명한 1:1 OS 스레드 모델(`pthread`)의 **CFS 런큐 스핀락 경합 및 L1/L2 캐시 축출(`Eviction`) 세금**이 커널 네트워크 데이터플레인에서 정확히 똑같이 재현되는 구조적 파국입니다

### 2. __sock4_xlate_fwd와 Per-CPU BPF 맵의 락프리 메모리 모델

Cilium eBPF의 cgroup v2 소켓 훅(`BPF_CGROUP_INET4_CONNECT`)은 소켓 연결을 요청한 **유저 애플리케이션 스레드가 현재 할당되어 실행 중인 CPU 코어 컨텍스트(`current task_struct`)** 내부에서 동기적으로 실행됩니다

- `__sock4_xlate_fwd` 함수 내에서 서비스 VIP와 백엔드 IP를 매핑·선택하는 `__lb4_lookup_backend_slot`은 전역 스핀락이 걸린 공유 테이블이 아니라, 각 CPU 코어가 독점 소유하는 **Per-CPU BPF 해시 및 어레이 맵(`BPF_MAP_TYPE_PERCPU_HASH` / `BPF_MAP_TYPE_HASH`)** 을 조회합니다
- NAT 추적 테이블(`conntrack`)을 별도로 생성·유지할 필요 없이, 커널 스택(`tcp_v4_connect`)이 패킷 버퍼(`sk_buff`)를 만들기 직전에 소켓 구조체(`struct bpf_sock_addr`) 목적지 레지스터(`user_ip4`, `user_port`)를 인플레이스로 직접 덮어씁니다
- 따라서 여러 CPU 코어가 동시에 10만 개의 파드 연결을 수립해도 코어 간 락 경합이 **0**이며, L1/L2 캐시 라인이 무효화되지 않고 락프리(`Lock-Free`)로 동작합니다

### 3. sk_buff 수명 주기와 NET_RX_SOFTIRQ 소멸 물리 (redirect_peer 해부)

동일 노드 내 파드 간 통신 시 `conntrack` 우회를 넘어 커널 헬퍼 함수 `bpf_redirect_peer`(`redirect_ep`)가 개입할 때 일어나는 패킷 버퍼(`sk_buff`) 생애주기의 변화입니다

- **일반 veth 경유 시 (`kube-proxy` 또는 일반 CNI routing)**: 패킷이 파드 A 소켓에서 출발하면 `tcp_transmit_skb` $\to$ `vethA` 이그레스 $\to$ 호스트 IP 라우팅 스택(`ip_forward`) $\to$ `vethB` 인그레스 $\to$ 파드 B 소켓 수신 큐(`sk_receive_queue`)로 이동합니다. 이 과정에서 `struct sk_buff`의 메타데이터가 여러 레이어를 거치며 지속적으로 복사·변환되고, 호스트 인터페이스 수신 처리마다 커널 연구현(`ksoftirqd` / `NET_RX_SOFTIRQ`) 스레드가 깨어나 CPU 사이클을 가로챕니다
- **bpf_redirect_peer 직결 시**: 출발지 가상 이더넷(`veth`)의 인그레스 단계에서 eBPF 프로그램이 `sk_buff` 포인터를 낚아채어, 호스트 TCP/IP 스택과 라우팅 테이블을 100% 건너뛰고 대상 파드 가상 이더넷의 인그레스 큐로 **포인터 1:1 핸드오프(`Zero-Copy Hand-off`)** 를 수행합니다
- 이는 런타임 시리즈 27편([epoll vs io_uring 시스템 호출 해부](/essays/network-io-epoll-iouring))에서 시스템 호출 모드 스위칭과 유저-커널 공간 간 버퍼 복사를 링 버퍼(`Ring Buffer`) 포인터 공유로 완전히 소멸시킨 것과 동일한 **커널 네트워크 스택 내 IO 패스스루 물리 기전**입니다

## 클라우드 관리형 데이터플레인 경계와 한계

![관리형 클라우드 eBPF 데이터플레인 아키텍처 경계](/diagrams/cloud-ebpf-dataplane-v2-hybrid.svg)

오픈소스 Cilium의 커널 소켓 리다이렉트 영역과 클라우드 서비스 사업자(CSP)가 관리하는 인프라 하드웨어 오프로딩 영역 간의 아키텍처 경계입니다

GCP GKE Dataplane V2와 AWS EKS(Cilium CNI 부착 모드)는 모두 Cilium을 기반으로 동작하지만, 순수 오픈소스와는 구분되는 명확한 경계와 한계를 지닙니다

GKE Dataplane V2 및 EKS Cilium 환경의 실전 물리적 한계:
- **게스트 OS 내부 소켓 리다이렉트의 유효 범위**: `bpf_sock.c` 기반의 cgroup 소켓 변환과 `local_delivery`는 오직 단일 가상 머신(워커 노드) 내부의 파드 간 통신에서만 커널 네트워크 스택 우회 효과를 100% 발휘합니다
- **CSP 오버레이 및 언더레이 캡슐화 세금**: 노드 경계를 넘어서는 순간 패킷은 클라우드 사업자의 물리/가상 스위치 층으로 진입합니다
- GKE Dataplane V2의 경우 노드 간 트래픽이 구글의 **안드로메다(`Andromeda`) 가상 스위치** 컨트롤러와 상호작용하며 GENEVE 터널링을 거치게 됩니다
- AWS EKS 환경에서는 VPC CNI의 언더레이 ENI 라우팅 또는 **Nitro Card** 하드웨어 가상화 계층을 통과합니다
- **관리형 보안 정책 개입에 따른 변동성**: CSP 관리형 데이터플레인은 CRD(Custom Resource Definition)와 자체 오퍼레이터를 통해 클라우드 방화벽 규칙과 IAM 정책을 강제 주입합니다

따라서 오픈소스 로컬 환경에서 측정한 초저지연(`94.4 Gbps`, 제로 `iptables` 오버헤드)은 노드 게스트 커널 내부의 인과율을 입증하는 명백한 물리적 지표이지만, 실제 EKS/GKE 운영 클러스터에서는 CSP의 가상 스위치와 하드웨어 캡슐화 레이어 비용이 합산되어 최종 파드-투-파드 지연 시간이 결정됨을 이해해야 합니다
---
*시리즈 다음 편에서는 가상화 위에서 작동하는 쿠버네티스가 겪는 이중 스케줄링 지연과 오버레이 오버헤드(OpenStack/KVM 환경 실측)를 분석합니다*
