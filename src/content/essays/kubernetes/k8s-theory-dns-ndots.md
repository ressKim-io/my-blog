---
title: "DNS와 ndots — 이름 하나가 여러 질의로 이어지는 조건"
excerpt: "kubelet의 DNS 설정과 resolver의 search·ndots 처리를 따라갑니다. glibc와 musl의 조회·재시도 차이, CoreDNS의 응답과 캐시, NodeLocal DNSCache의 경로를 나눠 질의 수와 지연의 근거를 확인합니다"
category: "kubernetes"
tags: ["Kubernetes", "DNS", "CoreDNS", "ndots", "Resolver", "concept"]
series:
  name: "k8s-theory-network"
  order: 5
date: "2026-10-09"
---

애플리케이션이 이름 하나를 넘겨도 DNS 서버에는 여러 질의가 갈 수 있습니다
resolver가 search 접미사로 후보 이름을 만들고, 같은 후보에 IPv4와 IPv6 주소를 각각 물을 수 있기 때문입니다

추가 질의가 생기는 것과 응답을 잃고 타임아웃까지 기다리는 것은 다른 문제입니다
조회 순서, resolver의 재시도, DNS 서버와 캐시가 있는 위치를 나눠 봐야 지연의 원인을 구분할 수 있습니다

> **근거**: Kubernetes v1.37.1 `f78e722310e50bcaca9276be22276d9e91d91308`과 공식 문서 저장본 `7fde177e22dc98390a6d55d215dd0301b5f6d0bb` 기준입니다
> resolver 예시는 glibc 2.44·musl 1.2.6, CoreDNS 구현 예시는 확인한 v1.15.0 소스를 사용합니다
> 확인한 kubeadm v1.37.1의 CoreDNS 기본 버전은 v1.14.6이며, 구현 예시와 실제 설치 버전을 구분합니다
> 아래 질의 개수는 조건을 둔 계산 예시이며 패킷 캡처나 DNS 지연을 측정한 기록은 포함하지 않습니다

## kubelet은 설정을 계산하고 resolver는 후보를 만듭니다

resolver는 애플리케이션의 이름 조회를 처리하는 라이브러리나 구현입니다
`/etc/resolv.conf`를 사용하는 Linux DNS 경로에서는 `nameserver`가 질의할 서버를, `search`가 후보 이름에 붙일 접미사를, `options`가 조회 방식을 정합니다

kubelet의 `GetPodDNS`는 Pod 정책과 노드 설정으로 CRI에 넘길 DNSConfig를 계산합니다
컨테이너 안의 resolver가 이 설정으로 질의를 보내며, 일반적인 클러스터 DNS 구성에서는 CoreDNS가 응답합니다
kubelet이 애플리케이션의 질의마다 search를 실행하는 것은 아닙니다

클러스터 DNS 주소가 설정된 ClusterFirst 경로는 그 주소를 nameserver로 사용하고 기본 옵션으로 `ndots:5`를 넣습니다
cluster domain이 `cluster.local`인 **예시**에서 search는 다음 순서입니다

| 순서 | 접미사 | 찾는 범위 |
|---|---|---|
| 1 | `<namespace>.svc.cluster.local` | 같은 namespace의 Service |
| 2 | `svc.cluster.local` | 클러스터의 Service 영역 |
| 3 | `cluster.local` | cluster domain |
| 그 뒤 | 노드 resolver 설정에 있던 search | 클러스터 접미사 뒤에 추가, 중복 제거 |

이 때문에 같은 namespace의 Service는 `my-svc` 같은 짧은 이름으로 찾을 수 있습니다
정상적인 Service 이름은 `my-svc.my-ns.svc.cluster.local`처럼 Service·namespace·cluster domain을 포함합니다

설정을 만드는 실제 구현은 [`GetPodDNS`·`generateSearchesForDNSClusterFirst`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/network/dns/dns.go)에 있습니다

### dnsPolicy와 hostNetwork를 함께 확인합니다

| dnsPolicy | kubelet이 선택하는 기본 설정 |
|---|---|
| `ClusterFirst` | 클러스터 DNS, 단 hostNetwork면 노드 설정 경로로 전환 |
| `ClusterFirstWithHostNet` | hostNetwork에서도 클러스터 DNS 사용 |
| `Default` | kubelet이 읽는 노드 resolver 설정 사용 |
| `None` | 빈 설정에서 시작해 Pod의 dnsConfig로 구성 |

노드 설정의 원본 경로는 kubelet 설정에 따라 달라질 수 있으므로 무조건 노드의 `/etc/resolv.conf`라고 단정하지 않습니다
Pod의 `dnsConfig`는 선택한 기본 설정에 합쳐지며 같은 이름의 option은 Pod 값으로 덮어쓸 수 있습니다

`hostNetwork: true`에서 dnsPolicy를 생략하면 기본값은 ClusterFirst지만, 실제 분기는 Default 방식으로 바뀝니다
이 전환 자체는 Event나 경고를 남기지 않습니다
노드 DNS가 클러스터 이름을 처리하지 못하는 구성이라면 이 Pod도 Service 이름을 찾지 못할 수 있습니다

이는 hostNetwork에서 클러스터 DNS Service 주소에 접근할 수 없다는 뜻은 아닙니다
네트워크 접근 가능성과 kubelet이 고른 DNS 설정은 다른 조건입니다
공식 문서는 Linux hostNetwork Pod에 `ClusterFirstWithHostNet`을 명시하도록 안내하며 Windows는 이를 지원하지 않습니다

클러스터 DNS 주소 자체가 kubelet에 없다면 별도 `MissingClusterDNS` 경고와 노드 설정 fallback이 있습니다
hostNetwork 정책 전환과 이 설정 누락을 같은 실패로 묶으면 안 됩니다

### 합쳐진 설정의 상한과 API 검증은 다릅니다

kubelet은 최종 search를 32개·공백 포함 2048자, nameserver를 3개로 제한합니다
합쳐진 설정이 상한을 넘으면 일부를 잘라내고 `DNSConfigForming` Event를 남깁니다
255자를 넘는 개별 search 항목도 제외합니다

반면 Pod의 dnsConfig 자체에 상한을 넘는 목록을 직접 보내면 API validation에서 거절될 수 있습니다
API가 허용한 Pod 값과 노드 search를 합친 결과가 넘치는 경우의 잘림과 구분해야 합니다
근거는 [DNS 설정 구성 함수](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/network/dns/dns.go)와 [Pod DNSConfig 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go)에 있습니다

## ndots는 이름의 성공 여부보다 조회 순서를 정합니다

glibc의 ndots 기본값은 1이고 앞 절의 ClusterFirst 기본 옵션은 5입니다
glibc는 이름에 든 점이 기준 이상이면 입력 이름 자체를 먼저 질의하고, 적으면 search 후보부터 시도합니다
이름 끝의 점은 search를 거치지 않는 절대 조회를 명시합니다

`my-svc.my-ns`의 점은 1개입니다
ndots가 1이면 그 이름 자체를 먼저 묻고, ndots가 5이면 search를 먼저 적용합니다
glibc에서는 앞의 절대 조회가 실패해도 조건에 따라 search를 이어갈 수 있으므로, 낮은 ndots가 두 조각 Service 이름을 항상 실패시키는 것은 아닙니다

다만 이 규칙을 모든 resolver에 그대로 적용할 수는 없습니다
확인한 musl은 점 개수가 ndots 이상이면 search 목록을 비우고 입력 이름 자체만 질의합니다
이 조건에서는 glibc처럼 절대 조회 실패 뒤 search로 돌아가지 않습니다

현재 glibc의 분기는 [`res_query.c`](https://sourceware.org/cgit/glibc/tree/resolv/res_query.c?id=c3a3a9808ad3ab4a3336836833f83288b672ccbf), musl의 분기는 [`name_from_dns_search`](https://git.musl-libc.org/cgit/musl/tree/src/network/lookup_name.c?id=9fa28ece75d8a2191de7c5bb53bed224c5947417)에 있습니다
ndots를 낮출 때는 사용 중인 resolver와 짧은 클러스터 이름의 처리도 함께 확인해야 합니다

### 네 후보와 두 주소 유형을 구분해서 셉니다

다음은 glibc가 DNS를 사용하는 경로에서 `api.example.com`을 조회한다는 가정입니다
search는 앞의 클러스터 접미사 세 개뿐이고, 캐시 적중·재시도·추가 search가 없으며 각 후보에 A와 AAAA를 모두 보낸다고 가정합니다

A는 IPv4 주소, AAAA는 IPv6 주소를 요청하는 서로 다른 레코드 유형입니다
이 예시의 앞 세 후보는 NXDOMAIN, 즉 그 이름이 없다는 응답을 받고 마지막 후보에서 필요한 주소 응답을 얻습니다

![glibc의 ndots 5와 search 세 개를 가정했을 때 api.example.com에 접미사를 붙인 세 후보 뒤 절대 이름을 조회하고 각 후보에 A와 AAAA를 묻는 조건부 예시|tall](/diagrams/k8s-theory-dns-ndots-1.svg)

이 조건에서 세는 것은 **후보 이름 4개 × 레코드 유형 2개 = DNS 질의 8개**입니다
요청과 응답을 합친 전체 네트워크 패킷 수를 뜻하지 않습니다
관측 지점, 전송 프로토콜, 응답·재전송, 캐시, 요청한 주소 계열에 따라 실제 패킷 수는 달라집니다

search 도중 주소 응답을 얻으면 뒤 후보를 모두 묻지 않을 수 있습니다
오류 응답의 종류도 중단 여부에 영향을 주므로, NXDOMAIN과 이름은 있지만 해당 유형의 주소가 없는 NODATA, 서버 실패인 SERVFAIL을 같은 응답으로 계산해서는 안 됩니다

`api.example.com.`처럼 끝에 점을 붙이면 이 예시의 search 후보는 건너뜁니다
그러나 A·AAAA 두 주소 유형까지 하나로 합쳐지는 것은 아닙니다
레코드와 오류의 의미는 [RFC 1035의 A](https://www.rfc-editor.org/rfc/rfc1035.html#section-3.4.1), [RFC 3596의 AAAA](https://www.rfc-editor.org/rfc/rfc3596.html#section-2.1), [RFC 2308의 NXDOMAIN·NODATA](https://www.rfc-editor.org/rfc/rfc2308.html#section-2.1)에 근거합니다

## CoreDNS는 이름 종류와 설정에 따라 답합니다

| 조회하는 이름 | 응답의 의미와 조건 |
|---|---|
| 일반 Service의 `<service>.<namespace>.svc.<domain>` | Service의 ClusterIP |
| headless Service 이름 | 연결 대상 endpoint의 주소 목록, 주소 선택은 클라이언트 몫 |
| ExternalName Service 이름 | 다른 이름을 가리키는 CNAME |
| `172-17-0-3.default.pod.cluster.local` 같은 주소형 Pod 이름 | CoreDNS pods 모드에 따라 응답 여부 결정 |
| `<hostname>.<subdomain>.<namespace>.svc.<domain>` | 해당 Pod가 연결된 headless Service와 endpoint 조건 필요 |

주소형 Pod 이름은 이미 IP를 알아야 만들 수 있는 이름입니다
CoreDNS kubernetes 플러그인의 기본 pods 모드는 `disabled`이며, `insecure` 또는 `verified` 설정으로 동작을 바꿉니다
verified는 같은 namespace에 해당 IP의 Pod가 존재하는지 확인하기 위해 Pod 정보도 관찰합니다

hostname·subdomain으로 만든 이름이 풀리려면 같은 namespace에 subdomain과 같은 이름의 headless Service가 있고 그 Pod가 endpoint에 포함되어야 합니다
기본적으로 Pod가 Ready여야 하며 Service의 `publishNotReadyAddresses: true`로 이 조건이 달라집니다
Pod 안에서 FQDN이 보인다는 사실만으로 DNS 레코드의 존재까지 보장하지는 않습니다

이름 규칙과 조건은 [Service·Pod DNS 공식 문서](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/)에서 확인할 수 있습니다

### API 관찰과 DNS 응답 캐시는 다른 상태입니다

CoreDNS의 kubernetes 플러그인은 Service와 EndpointSlice 등의 API를 list/watch해 로컬 상태를 유지합니다
클러스터 DNS 질의마다 API 서버에서 오브젝트를 새로 가져오는 구조는 아닙니다
endpoint 주소는 EndpointSlice에서 얻으며 주소형 Pod 조회의 Pod watch 여부는 pods 모드에 따라 달라집니다

기동 시 API 동기화를 기다리는 기본 시간은 5초이며 `startup_timeout`으로 조정할 수 있습니다
시간 안에 동기화하지 못하면 서버를 시작하고, 아직 동기화되지 않아 판정할 수 없는 이름에는 SERVFAIL을 반환할 수 있습니다
항상 5초 안에 모든 변경이 DNS 응답에 반영된다는 보장은 아닙니다

별도의 cache 플러그인을 사용하면 성공 응답뿐 아니라 NXDOMAIN 같은 부정 응답도 설정에 따라 보관합니다
API의 새 상태를 봤더라도 앞서 보관한 부정 응답이 TTL 동안 조회에 영향을 줄 수 있습니다

캐시의 위치에 따라 줄어드는 질의도 다릅니다
앱이나 로컬 캐시에서 끝나면 그 뒤 서버로 보낼 요청이 줄지만, CoreDNS에서 적중한 요청은 이미 Pod와 CoreDNS 사이를 지나온 요청입니다
후자의 적중은 상위 DNS나 후단 처리의 요청을 줄이며 Pod에서 DNS 서버로 보낸 질의 자체를 없애지는 않습니다

구현 근거는 [CoreDNS controller](https://github.com/coredns/coredns/blob/a6fde3fe339c6ec848447e11cc9796be8c97b4e0/plugin/kubernetes/controller.go), [기동 동기화](https://github.com/coredns/coredns/blob/a6fde3fe339c6ec848447e11cc9796be8c97b4e0/plugin/kubernetes/kubernetes.go), [응답 처리](https://github.com/coredns/coredns/blob/a6fde3fe339c6ec848447e11cc9796be8c97b4e0/plugin/kubernetes/handler.go), [cache 문서](https://github.com/coredns/coredns/blob/a6fde3fe339c6ec848447e11cc9796be8c97b4e0/plugin/cache/README.md)에 있습니다

### 외부 이름과 fallthrough는 구분합니다

클러스터 영역 밖의 이름은 Corefile 구성에 따라 forward 같은 플러그인이 상위 DNS로 전달합니다
반면 kubernetes 플러그인이 담당하는 영역의 이름이 없으면 기본적으로 NXDOMAIN을 응답합니다

`fallthrough`는 설정한 영역의 미발견 질의를 다음 플러그인으로 넘기는 옵션입니다
이는 외부 이름을 전달하는 것과 다르며, 클러스터 이름이 없다고 항상 상위 DNS로 넘기는 것은 아닙니다
관련 조건은 [kubernetes 플러그인 문서](https://github.com/coredns/coredns/blob/a6fde3fe339c6ec848447e11cc9796be8c97b4e0/plugin/kubernetes/README.md)에 있습니다

## 5초와 재시도 횟수는 resolver의 조건입니다

glibc의 기본 timeout은 5초, attempts는 2입니다
이 값은 kubelet의 ndots 기본값이나 CoreDNS의 기동 대기 시간과 별도입니다
같은 숫자 5가 나와도 기다리는 주체와 대상이 다릅니다

glibc는 nameserver 순회와 내부 복구 재시도를 수행합니다
UDP 대기 시간도 기본 timeout에 nameserver 인덱스와 개수를 반영해 계산하므로, attempts 2를 전체 이름 조회의 총 패킷 두 개나 항상 같은 총 지연으로 읽을 수는 없습니다

확인한 musl도 기본 timeout 5초·attempts 2지만 의미가 다릅니다
`res_msend`는 한 후보의 UDP 질의 묶음 처리에 timeout 예산을 두고 `timeout / attempts`를 재전송 간격으로 사용합니다
기본값으로 계산한 간격은 2.5초이며, 이것이 전체 search 조회의 실측 지연이나 모든 유실의 대기 시간이라는 뜻은 아닙니다

glibc의 상수와 실제 루프는 [`resolv.h`](https://sourceware.org/cgit/glibc/tree/resolv/resolv.h?id=c3a3a9808ad3ab4a3336836833f83288b672ccbf)·[`res_send.c`](https://sourceware.org/cgit/glibc/tree/resolv/res_send.c?id=c3a3a9808ad3ab4a3336836833f83288b672ccbf), musl의 기본값과 UDP 처리는 [`resolvconf.c`](https://git.musl-libc.org/cgit/musl/tree/src/network/resolvconf.c?id=9fa28ece75d8a2191de7c5bb53bed224c5947417)·[`res_msend.c`](https://git.musl-libc.org/cgit/musl/tree/src/network/res_msend.c?id=9fa28ece75d8a2191de7c5bb53bed224c5947417)에 있습니다

### 응답 유실과 후보 이름 증가는 다른 문제입니다

glibc가 A·AAAA를 같은 UDP 소켓으로 보내는 경로에서는 같은 출발지 포트의 질의가 거의 함께 나갈 수 있습니다
DNS Service의 iptables DNAT·conntrack 경로에서 발생할 수 있는 경합은 이 요청의 유실과 대기를 설명하는 원인 후보입니다
하지만 몇 초 지연됐다는 사실만으로 그 경합을 확정할 수는 없습니다

`single-request-reopen`은 같은 소켓에서 보낸 두 요청 중 두 번째 응답을 제대로 처리하지 못하는 서버나 경로를 위한 glibc 옵션입니다
관련 경로에서 소켓을 다시 열도록 하며, 모든 DNS 지연이나 네트워크 오류를 해결하는 옵션은 아닙니다
현재 구현에는 한쪽 응답만 받은 뒤 직렬 요청·소켓 재개방으로 재시도하는 내부 복구 분기도 있습니다

이 동작과 설정 범위는 [resolv.conf 매뉴얼](https://man7.org/linux/man-pages/man5/resolv.conf.5.html)과 앞의 glibc 전송 소스에서 확인할 수 있습니다

> **재시도 수의 확인 범위**: NodeLocal DNSCache 문서에는 30초를 설명하며 3 retries와 10초를 적은 문장이 남아 있습니다
> [KEP-1024의 고정 원문](https://github.com/kubernetes/enhancements/blob/0c8d11e9a13e12d2ef75d2d78af5ac00d8189046/keps/sig-network/1024-nodelocal-cache-dns/README.md)은 이를 A·AAAA의 5초씩과 재시도 3회로 표현하지만, 그 3회의 환경·산출 근거는 밝히지 않습니다
> glibc의 기본 attempts 2와 이 숫자가 왜 다른지는 확인하지 못했습니다
> 내부 재시도 분기가 있다는 사실만으로 KEP의 3회를 입증할 수도 없으므로, 이 표현을 현재 환경의 기본 횟수나 총 지연으로 사용하지 않습니다

## NodeLocal DNSCache는 로컬 구간의 경로를 바꿉니다

일반적인 DNS Service 경로에서는 Pod가 보낸 UDP 질의가 Service의 DNAT과 conntrack을 거쳐 CoreDNS에 도달합니다
NodeLocal DNSCache는 노드마다 캐시 에이전트를 두어 Pod와 로컬 캐시 사이에서 이 구간을 피하도록 구성합니다

![일반 DNS Service 경로는 DNAT과 conntrack을 거치고 NodeLocal DNSCache 경로는 로컬 캐시에 먼저 질의하며 상위 DNS 구간을 TCP로 선택할 수 있는 비교|tall](/diagrams/k8s-theory-dns-ndots-2.svg)

효과는 세 가지로 나눌 수 있습니다
Pod와 로컬 캐시 사이의 경로 변경, 캐시 적중에 따른 후단 질의 감소, 로컬 캐시에서 상위 DNS로 가는 구간의 TCP 사용입니다
상위 구간을 포함한 모든 NAT·conntrack을 제거한다는 뜻은 아닙니다

TCP가 연결 종료 신호를 갖는다는 사실과 conntrack 엔트리가 즉시 삭제된다는 주장도 구분해야 합니다
Linux conntrack은 FIN 등으로 상태를 바꾸고 상태별 timeout을 적용합니다
애플리케이션이 소켓을 닫는 순간 모든 추적 상태가 사라진다고 단정할 수는 없습니다

구성 목적은 [NodeLocal DNSCache 공식 문서](https://kubernetes.io/docs/tasks/administer-cluster/nodelocaldns/), TCP 추적 수명의 조건은 [Linux v6.12 conntrack 문서](https://github.com/torvalds/linux/blob/adc218676eef25575469234709c2d87185ca223a/Documentation/networking/nf_conntrack-sysctl.rst)와 [TCP 상태 처리](https://github.com/torvalds/linux/blob/adc218676eef25575469234709c2d87185ca223a/net/netfilter/nf_conntrack_proto_tcp.c)에 근거합니다
실제 노드의 커널 버전·sysctl이나 지연 시간은 확인하지 않았습니다

## 지연과 실패를 관측한 위치부터 나눕니다

| 증상 | 구분할 조건 |
|---|---|
| 외부 이름 앞에 search 후보가 나감 | 실제 search·ndots·resolver, 앞 후보의 응답과 주소 유형 |
| timeout 근처의 간헐적인 대기 | resolver 재시도와 요청·응답 유실, Service 전달 경로 |
| 부하와 함께 CoreDNS 응답이 느려짐 | 질의 부하·자원·복제 수·후단 DNS 응답을 함께 확인 |
| hostNetwork Pod만 Service 이름을 못 찾음 | 실제 dnsPolicy 분기와 노드 resolver 설정 |
| `DNSConfigForming` Event | 합쳐진 nameserver/search에서 생략된 항목 |
| 새 Service 이름이 잠시 안 풀림 | API 동기화 상태와 이전 부정 응답 캐시를 구분 |
| hostname·subdomain 이름이 안 풀림 | headless Service·endpoint 포함 여부·Ready·publishNotReadyAddresses |
| 클러스터 이름은 되고 외부 이름만 실패 | forward 영역·상위 서버·그 구간의 네트워크와 응답 |

후보 이름 수, Pod가 보낸 DNS 질의, CoreDNS의 상위 질의, 패킷 캡처의 요청·응답 수는 서로 다른 관측값입니다
이 값들을 섞지 않아야 ndots로 늘어난 작업과 유실 뒤 기다린 시간, 서버 처리 지연을 구분할 수 있습니다

## 참고 자료

- [glibc 공식 현재 릴리스](https://sourceware.org/glibc/), [glibc 2.44 고정 소스](https://sourceware.org/cgit/glibc/tree/?id=c3a3a9808ad3ab4a3336836833f83288b672ccbf)
- [musl 1.2.6 고정 소스](https://git.musl-libc.org/cgit/musl/tree/?id=9fa28ece75d8a2191de7c5bb53bed224c5947417)
- [CoreDNS v1.15.0](https://github.com/coredns/coredns/releases/tag/v1.15.0), [의존 버전](https://github.com/coredns/coredns/blob/a6fde3fe339c6ec848447e11cc9796be8c97b4e0/go.mod), [kubeadm의 CoreDNS 기본 버전](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kubeadm/app/constants/constants.go)
