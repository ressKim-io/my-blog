---
title: "eBPF 데이터플레인 — 커널 서비스 경로를 대체한다는 것"
excerpt: "Cilium이 kube-proxy를 대체할 때 실제로 무엇을 바꾸는지 v1.19.5 소스에서 확정합니다. 핵심은 connect() 시점의 주소 변환이며, 싼 이유는 맵이 빨라서가 아니라 연결마다 상태를 쓰지 않기 때문입니다"
category: "kubernetes"
tags: ["kubernetes", "ebpf", "cilium", "cni", "socket-lb", "dataplane-v2", "conntrack", "kernel", "concept"]
series:
  name: "kernel-runtime-tradeoffs-7"
  order: 3
date: "2026-07-20"
---

> **근거**: `cilium/cilium` **v1.19.5**(`20eaccf`) 소스와 GKE 공식 문서에 앵커를 겁니다
> **한계**: 관리형 데이터플레인의 벤더 영역(Nitro 카드, Andromeda 내부)은 읽을 수 없으므로 쓰지 않습니다. 이 편에는 **성능 수치가 없습니다** — 대조군을 갖춘 측정을 하지 않았고, 근거 없는 숫자를 싣지 않기로 한 부의 규칙을 따릅니다

런타임 시리즈 6부 25편에서 소켓 경로 자체를 커널에서 바꾸는 eBPF 데이터플레인을 예고했습니다

이 편에서 그 기전을 소스로 확정합니다

먼저 대체당하는 쪽을 봅니다

## kube-proxy가 하는 일

파드가 ClusterIP로 연결하면 패킷은 리눅스 네트워크 스택에 들어갑니다

거기서 두 가지가 일어납니다

- **Netfilter 체인 탐색** — `KUBE-SERVICES`에서 시작해 `KUBE-SVC-*`, `KUBE-SEP-*`를 훑으며 목적지를 고릅니다. 서비스와 엔드포인트가 늘면 규칙도 함께 늘어납니다
- **conntrack 항목 생성** — DNAT가 결정되면 커널이 `struct nf_conn`을 만들어 전역 해시에 등록합니다. **연결 하나마다 공유 자료구조에 쓰기가 발생합니다**

두 번째가 더 중요합니다

읽기는 여러 코어가 동시에 해도 서로를 방해하지 않지만, 쓰기는 그렇지 않습니다
연결이 쏟아질수록 공유 테이블에 상태를 기록하는 비용이 늘어납니다

## Socket LB — connect() 시점에 주소를 바꿉니다

Cilium은 이 경로를 우회하지 않습니다
**애초에 그 경로로 들어가지 않게** 만듭니다

진입점은 cgroup v2의 connect 훅입니다

```c
// cilium/cilium v1.19.5 — bpf/bpf_sock.c:434
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

`__sock4_xlate_fwd`가 서비스 맵에서 백엔드를 고르고, 소켓 주소 구조체의 목적지를 **그 자리에서 덮어씁니다**

![kube-proxy 서비스 경로와 Cilium Socket LB 경로](/diagrams/cloud-ebpf-socketlb-routing.svg)

결과가 중요합니다

애플리케이션은 ClusterIP로 연결했다고 믿지만, 커널 TCP 스택이 보는 목적지는 처음부터 백엔드 파드 IP입니다

VIP가 스택에 도달한 적이 없으므로 **DNAT가 필요 없고, 따라서 conntrack 항목도 만들어지지 않습니다**

`iptables` 서비스 체인을 빠르게 통과하는 것이 아니라 그 체인이 아예 관여하지 않습니다

## 왜 싼가 — 맵이 빨라서가 아닙니다

여기서 흔한 설명 하나를 바로잡아야 합니다

"Cilium은 Per-CPU BPF 맵을 써서 코어 간 락 경합이 0이다"라는 서술을 종종 봅니다
v1.19.5 소스는 그렇게 말하지 않습니다

```c
// cilium/cilium v1.19.5 — bpf/lib/lb.h:262
struct {
	__uint(type, BPF_MAP_TYPE_HASH);
	__type(key, struct lb4_key);
	__type(value, struct lb4_service);
	...
} cilium_lb4_services_v2 __section_maps_btf;

struct {
	__uint(type, BPF_MAP_TYPE_HASH);
	__type(key, __u32);
	__type(value, struct lb4_backend);
	...
} cilium_lb4_backends_v3 __section_maps_btf;
```

서비스 맵과 백엔드 맵 **둘 다 일반 `BPF_MAP_TYPE_HASH`입니다**
Per-CPU 맵이 아닙니다

Cilium이 Per-CPU 맵을 쓰는 곳은 따로 있습니다 — 메트릭 집계(`bpf/lib/metrics.h`), NAT 스크래치 공간(`bpf/lib/nat.h`) 같은 자리입니다

그러면 차이는 어디서 오는가

**접근의 성격이 다릅니다**

| | conntrack | Socket LB 맵 |
|---|---|---|
| 무엇을 하는가 | 연결마다 상태를 **쓴다** | 서비스·백엔드 표를 **읽는다** |
| 자료구조 증가 | 연결 수에 비례 | 서비스·엔드포인트 수에 비례 |
| 갱신 주체 | 데이터 경로(패킷마다) | 컨트롤 플레인(엔드포인트 변경 시) |

conntrack은 트래픽이 늘면 테이블이 커지고 쓰기가 늘어납니다
Socket LB의 맵은 트래픽과 무관하게 클러스터 구성이 바뀔 때만 갱신됩니다

읽기 위주의 자료구조라서 싼 것이지 Per-CPU라서 싼 것이 아닙니다

그 차이가 실제 워크로드에서 얼마인지는 **이 편에서 재지 않았으므로 쓰지 않습니다**

## 같은 노드의 파드끼리

서비스 주소를 바꾸는 것과 별개로, 같은 노드에 있는 파드 사이에는 지름길이 하나 더 있습니다

```c
// cilium/cilium v1.19.5 — bpf/lib/local_delivery.h:82
static __always_inline int redirect_ep(struct __ctx_buff *ctx,
				       int ifindex,
				       bool use_fast_redirect,
				       bool from_tunnel)
{
	if (!use_fast_redirect)
		return (int)ctx_redirect(ctx, ifindex, 0);

	/* When coming from overlay, we need to set packet type
	 * to HOST as otherwise we might get dropped in IP layer.
	 */
	if (from_tunnel)
		ctx_change_type(ctx, PACKET_HOST);

	return ctx_redirect_peer(ctx, ifindex, 0);
}
```

`ctx_redirect_peer`는 커널 헬퍼 `bpf_redirect_peer`를 부릅니다

출발지 veth의 인그레스에서 패킷을 잡아 목적지 파드 veth의 인그레스로 바로 넘깁니다
호스트의 라우팅 조회와 Netfilter 훅을 지나지 않습니다

이 기전은 rust 시리즈의 [epoll과 io_uring 편](/essays/network-io-epoll-iouring)에서 다룬 것과 성격이 같습니다 — 데이터를 옮기는 대신 **소유권을 넘기는** 방식입니다

다만 이것을 "제로 카피"라고 단정하지는 않겠습니다
`bpf_redirect_peer`가 없애는 것은 호스트 스택 통과이지 모든 복사가 아니며, 이 편은 그 경로의 비용을 재지 않았습니다

## 관리형 판 — GKE Dataplane V2

같은 기술의 관리형 버전이 GKE에 있습니다

> GKE Dataplane V2 is implemented using eBPF
> GKE Dataplane V2 is implemented using Cilium
> GKE Dataplane V2 uses cilium instead of kube-proxy to implement Kubernetes Services
>
> — [GKE Dataplane V2](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/dataplane-v2) (접근 2026-07-20)

![오픈소스 Cilium과 관리형 데이터플레인의 경계](/diagrams/cloud-ebpf-dataplane-v2-hybrid.svg)

관리형이 되면서 생기는 한계도 같은 문서가 밝히고 있습니다

> new features for Services are more likely to be implemented in kube-proxy before they are implemented in cilium for GKE Dataplane V2
>
> — 같은 문서

이것이 관리형 데이터플레인의 실질적인 대가입니다
쿠버네티스 Service의 새 기능이 나와도 그것이 Cilium 구현으로 내려오기까지 시차가 있습니다

노드 경계를 넘는 트래픽이 클라우드의 가상 스위치와 하드웨어 계층을 지난다는 것은 사실이지만, 그 계층의 구현은 벤더 자산입니다
GKE 문서는 캡슐화 방식을 밝히지 않으므로 **여기서는 무엇을 쓰는지 단정하지 않습니다**

## 실무에서 무엇을 보아야 하는가

- **효과의 범위를 구분합니다** — Socket LB는 노드 안에서 나가는 연결의 주소 변환입니다. `bpf_redirect_peer`는 같은 노드의 파드 사이에만 듭니다. 노드를 넘는 트래픽은 여전히 클러스터 네트워크와 클라우드 인프라를 지납니다
- **conntrack 압박이 있다면 특히 유효합니다** — 연결이 짧고 많은 워크로드에서 얻는 것이 큽니다. 반대로 장기 연결 소수라면 대체 이득이 작습니다
- **관리형에서는 기능 시차를 확인합니다** — GKE 문서가 명시한 대로 새 Service 기능은 kube-proxy에 먼저 들어갑니다. 최신 기능에 의존한다면 확인이 필요합니다
- **직접 재려면 대조군을 만듭니다** — kube-proxy 모드와 Cilium 모드를 같은 스펙·같은 부하로 나란히 재야 의미가 있습니다. 한쪽만 잰 숫자는 아무것도 말해 주지 않습니다

## 핵심 요약

- Cilium의 서비스 부하 분산은 `sockops`나 `sk_msg`가 아니라 **cgroup v2의 connect 훅**(`bpf/bpf_sock.c:434`)에서 이루어집니다. v1.19.5의 `bpf/` 코드에 `sk_msg`·`sock_hash` 사용은 없습니다
- 핵심은 우회가 아니라 **회피**입니다. `connect()` 시점에 목적지를 백엔드 주소로 덮어쓰므로 VIP가 커널 스택에 도달하지 않고, DNAT도 conntrack 항목도 생기지 않습니다
- 서비스·백엔드 맵은 **일반 `BPF_MAP_TYPE_HASH`이며 Per-CPU가 아닙니다**. 이득의 근거는 "Per-CPU라 락프리"가 아니라 **연결마다 쓰지 않고 읽기만 한다**는 접근 성격의 차이입니다
- 같은 노드의 파드 사이에는 `bpf_redirect_peer`가 호스트 스택 통과를 생략합니다. 노드를 넘는 경로에는 해당하지 않습니다
- GKE Dataplane V2는 같은 기술의 관리형 판이며, 문서가 밝히는 대가는 **Service 새 기능의 반영 시차**입니다

*이 편으로 7부를 마칩니다. 1편에서 노드가 내는 세금을, 2편에서 그 세금을 정하는 네트워크 한도를, 3편에서 그 한도 위를 흐르는 트래픽의 경로를 각각 소스에서 확인했습니다*
