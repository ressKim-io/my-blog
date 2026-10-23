---
title: "Netfilter와 conntrack — Service의 주소 변환을 기억하는 곳"
excerpt: "패킷의 수신·전달·로컬 송신 경로에서 DNAT이 일어나는 지점과 conntrack의 양방향 키를 살펴봅니다. 첫 NAT 바인딩의 선택, 후속 패킷의 재사용, 용량·timeout과 kube-proxy의 UDP 정리 조건을 구분합니다"
category: "kubernetes"
tags: ["kubernetes", "linux", "netfilter", "conntrack", "nat", "concept"]
series:
  name: "k8s-theory-kernel"
  order: 2
date: "2026-11-11"
---

[Service와 kube-proxy](/essays/k8s-theory-service-kube-proxy)에서는 노드의 규칙이 Service 주소를 백엔드 주소로 바꾼다는 흐름을 살펴봤습니다
이번에는 커널의 어느 지점에서 목적지가 바뀌고, 응답을 되돌릴 정보가 어디에 남는지 따라갑니다

> **근거**: Linux v6.18.58 LTS와 Kubernetes v1.37.1의 고정 소스·공식 문서를 대조한 이론 설명입니다
> Linux ref: `2926d88bb7fc4608fd942453d929c39e4e5ec006`, Kubernetes ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 패킷 예시는 Linux kube-proxy iptables 모드의 일반적인 IPv4 ClusterIP 경로입니다
> 실제 노드의 커널·sysctl·규칙 카운터나 지연을 측정한 기록은 포함하지 않습니다

## 다섯 hook은 모든 패킷이 차례로 지나는 다섯 단계가 아닙니다

**Netfilter hook**은 네트워크 처리 경로에 검사·변환 함수를 연결하는 지점입니다
여기서는 일반적인 IP 경로의 `PREROUTING`, `INPUT`, `FORWARD`, `OUTPUT`, `POSTROUTING`을 다룹니다

![수신·전달·로컬 송신을 나누고 라우팅과 다섯 주요 netfilter hook의 위치를 표시한 IPv4 경로|tall](/diagrams/k8s-theory-netfilter-conntrack-1.svg)

수신 패킷은 `PREROUTING`을 거친 뒤 라우팅 판단을 받습니다
이 호스트가 받는 패킷은 `INPUT`으로, 다른 곳으로 전달할 패킷은 `FORWARD`와 `POSTROUTING`으로 진행합니다

로컬 프로세스가 만든 패킷은 초기 라우팅 뒤 `OUTPUT`과 `POSTROUTING`을 지납니다
`INPUT`으로 받은 동일 패킷이 자동으로 `OUTPUT`으로 이어지는 것은 아닙니다. 로컬 프로세스가 만드는 응답은 새 송신입니다

이 다섯 이름이 Netfilter의 모든 hook을 뜻하지도 않습니다
인터페이스에 연결하는 ingress·egress 등도 있으며, 이 글의 그림은 일반 IP 경로에 필요한 부분으로 한정합니다

### Hook과 table, chain은 구분해야 합니다

Hook은 커널 처리 위치이고, table과 chain은 그 위치에서 실행할 규칙을 구성하는 단위입니다
iptables의 `nat`·`filter` 테이블은 서로 다른 규칙 묶음이며 같은 `OUTPUT` 이름의 체인도 어느 테이블에 속하는지 구분해야 합니다

사용자 정의 체인인 `KUBE-SERVICES`가 새로운 커널 hook을 만드는 것은 아닙니다
기본 체인에 설치한 점프 규칙으로 그 체인의 규칙을 실행합니다

nftables도 같은 Netfilter 기반을 사용하지만 기본 체인을 자동으로 모두 만들지는 않습니다
base chain을 만들 때 hook과 priority 등을 지정하며, table 이름을 `nat`로 지었다는 사실만으로 NAT 처리 위치가 정해지지는 않습니다

같은 hook에 여러 함수가 등록되면 숫자가 작은 priority부터 실행합니다
Linux v6.18.58의 대표적인 IPv4 우선순위는 다음과 같습니다

| 처리 | Priority | 관계 |
|---|---:|---|
| 조각 재조립 | `-400` | conntrack보다 앞선 처리 |
| 전통적인 raw | `-300` | 추적 여부를 정하는 규칙 등을 conntrack보다 먼저 처리 |
| conntrack | `-200` | 패킷을 연결 기록과 대응 |
| mangle | `-150` | DNAT보다 앞선 패킷 처리 |
| 목적지 NAT | `-100` | `PREROUTING`·`OUTPUT`의 DNAT 처리 |
| filter | `0` | 해당 hook에 등록한 필터 처리 |
| 출발지 NAT | `100` | `POSTROUTING`·`INPUT`의 SNAT 처리 |

이 표는 모든 행이 모든 hook에서 실행된다는 뜻이 아닙니다
실제 등록 위치와 우선순위를 함께 봐야 합니다. 예를 들어 conntrack의 초기 조회는 `PREROUTING`·`OUTPUT`에서 DNAT보다 먼저 실행됩니다

또한 한 함수의 `ACCEPT`가 이후 모든 hook까지 면제하는 것은 아닙니다
커널의 `nf_hook_slow`는 `NF_ACCEPT`를 받으면 다음 등록 함수를 계속 실행합니다

## 목적지가 바뀌면 라우팅 판단도 달라집니다

**DNAT(Destination NAT)**는 목적지 주소·포트를 바꾸는 처리입니다
수신 패킷을 `PREROUTING`에서 DNAT하면 바뀐 목적지로 다음 라우팅을 판단할 수 있습니다

iptables ClusterIP 경로에서는 Service 주소를 보통 인터페이스에 바인딩하지 않고 규칙의 매치 대상으로 사용합니다
DNAT이 없을 때 반드시 “라우트가 없다”고 단정할 수는 없으며, 실제 전달·실패 형태는 노드의 라우팅에 달려 있습니다

로컬에서 만든 패킷은 `PREROUTING`을 지나지 않으므로 `OUTPUT`에서도 DNAT이 가능합니다
v6.18.58의 `nf_nat_ipv4_local_fn`은 목적지 주소의 변환을 확인하면 `ip_route_me_harder`로 경로를 다시 계산합니다

출발지 주소·포트를 바꾸는 **SNAT(Source NAT)**도 구분해야 합니다
kube-proxy의 masquerade는 표시된 트래픽을 `POSTROUTING`에서 처리하지만, 일반 Netfilter의 모든 SNAT이 이 위치에만 한정되는 것은 아닙니다

확인한 커널은 `PREROUTING`·`OUTPUT`에 목적지 변환을, `POSTROUTING`·`INPUT`에 출발지 변환을 등록합니다
Masquerade는 송신 인터페이스 주소를 사용하는 SNAT 방식이며 모든 ClusterIP 요청에 무조건 적용되는 것은 아닙니다

## ClusterIP의 DNAT은 endpoint 체인의 규칙에서 일어납니다

![nat PREROUTING과 OUTPUT이 KUBE-SERVICES로 합류하고 KUBE-SEP의 DNAT 규칙에서 실제 목적지를 바꾸는 경로|tall](/diagrams/k8s-theory-netfilter-conntrack-2.svg)

kube-proxy iptables 모드의 `iptablesJumpChains`는 `nat/PREROUTING`과 `nat/OUTPUT`을 `KUBE-SERVICES`에 연결합니다
일반적인 ClusterIP의 새 바인딩은 Service별 `KUBE-SVC-…`를 거쳐 선택한 endpoint의 `KUBE-SEP-…`로 진행합니다

실제 목적지를 바꾸는 규칙은 `KUBE-SEP-…`의 `-j DNAT --to-destination <backend IP>:<port>`입니다
Service를 찾는 단계, 백엔드를 선택하는 단계, 패킷의 목적지를 바꾸는 단계를 나누어 볼 수 있습니다

진입점이 둘이므로 노드 프로세스와 `hostNetwork` Pod의 로컬 송신도 Service를 사용할 수 있습니다
반면 일반 Pod에서 나와 노드 네트워크 경로로 들어온 패킷은 노드의 수신 경로를 따릅니다

`nat/POSTROUTING`은 `KUBE-POSTROUTING`으로 연결됩니다
앞에서 masquerade 대상으로 표시한 트래픽의 출발지를 바꾸며, DNAT을 했다는 사실만으로 모든 요청이 SNAT 대상이 되는 것은 아닙니다

`filter` 쪽 일부 진입 규칙은 `-m conntrack --ctstate NEW`로 연결 상태를 읽습니다
그렇다고 모든 filter 점프에 같은 조건이 있는 것은 아닙니다. `KUBE-FORWARD`와 health-check용 `KUBE-NODEPORTS` 점프에는 이 조건이 없습니다

이 체인 이름과 점프 구성을 IPVS·nftables 모드나 kube-proxy 대체 구현까지 그대로 적용해서는 안 됩니다
iptables 모드라는 선택과 그 명령이 사용하는 백엔드 역시 실제 노드에서 확인할 사항입니다

## Conntrack은 같은 연결을 양방향 키로 찾습니다

**Conntrack**은 패킷의 흐름을 연결 기록과 대응시키고 상태를 추적하는 커널 기능입니다
패킷 자체를 나타내는 `skb`와 달리 연결 기록은 여러 패킷이 함께 참조하는 상태입니다

TCP·UDP에서는 출발지와 목적지 주소·포트, 프로토콜이 연결 조회에 쓰입니다
주소군과 network namespace, conntrack zone도 구분하므로 주소·포트 네 개만 같다고 항상 같은 연결은 아닙니다

연결 하나는 original 방향과 reply 방향의 키로 해시 테이블에 각각 등록됩니다
연결 객체 두 개를 별도로 만든다는 뜻은 아닙니다

다음은 원본의 주소를 사용한 가정 예시입니다
같은 프로토콜을 사용하고 추가 SNAT은 없다고 가정합니다

| 같은 연결을 찾는 키 | 주소·포트 튜플 |
|---|---|
| Original | `10.244.1.5:33445 → 10.96.0.10:80` |
| Reply | `10.244.2.9:8080 → 10.244.1.5:33445` |

클라이언트는 Service `10.96.0.10:80`으로 보냈지만 실제 백엔드는 `10.244.2.9:8080`입니다
백엔드의 응답을 reply 키로 찾으면 같은 연결 객체의 NAT 상태와 반대 방향 정보를 이용해 출발지를 Service 주소·포트로 되돌릴 수 있습니다

두 키를 단순히 주소를 맞바꾼 사본으로 생각하면 이 차이를 놓칩니다
NAT 설정의 `nf_nat_setup_info`는 실제 변환을 반영해 reply 튜플을 수정합니다

### 연결 상태는 TCP 소켓 상태와 같은 분류가 아닙니다

conntrack의 `NEW`는 반드시 “테이블에 없는 패킷”을 뜻하지 않습니다
아직 응답을 보지 못한 기존 기록의 original 방향 패킷도 `NEW`일 수 있습니다

반대 방향을 조회하면 `ESTABLISHED_REPLY`로 분류하고, 응답을 본 original 방향은 `ESTABLISHED`로 분류합니다
기존 연결과 관련된 `RELATED`도 별도 상태입니다. UDP에도 이 연결 추적 분류를 적용할 수 있습니다

따라서 “`--ctstate NEW`니까 반드시 NAT 백엔드를 새로 선택한다”고 연결해서는 안 됩니다
NAT 바인딩의 초기화 여부와 패킷의 연결 상태 분류를 함께 봐야 합니다

### Namespace는 조회를 구분하지만 자원을 전부 분리하지는 않습니다

커널 조회는 튜플뿐 아니라 namespace와 zone의 일치도 검사합니다
호스트 네트워크의 규칙·연결 상태와 Pod의 네트워크 문맥을 구분해야 하는 이유입니다

다만 확인한 커널의 conntrack 해시 저장소는 공유되며, 연결 객체에 namespace 정보가 함께 있습니다
각 Pod가 독립적인 해시 메모리와 노드 자원 한도를 자동으로 얻는다고 해석할 수는 없습니다

## 후속 패킷은 유지 중인 NAT 바인딩을 재사용합니다

새 흐름의 첫 패킷은 NAT 규칙을 조회해 바인딩을 만들며 그 패킷도 변환합니다
바인딩이 유지되는 후속 패킷은 같은 규칙으로 백엔드를 매번 다시 고르지 않습니다

`nf_nat_inet_fn`은 연결과 해당 변환 방향의 초기화 상태를 확인합니다
초기화하지 않았다면 규칙 조회를 수행하고, 이미 설정됐다면 기존 상태를 이용해 `nf_nat_packet`으로 변환합니다

이 재사용이 생략하는 것은 **NAT 바인딩을 새로 선택하는 규칙 조회**입니다
연결 조회와 상태 처리, 필요한 주소 변환, 다른 filter 규칙 처리까지 모두 없어지는 것은 아닙니다

iptables의 Service 순차 검색 비용도 새 NAT 바인딩을 선택하는 경로와 연결해 봐야 합니다
기존 연결이 검색을 반복하지 않더라도 노드 부하나 해시 충돌 등의 영향을 전혀 받지 않는다고 보장할 수는 없습니다

엔트리가 만료·삭제되거나 추적을 제외한 패킷에는 같은 바인딩이 유지된다는 전제를 적용할 수 없습니다
정확한 응답 역변환을 위한 상태가 후속 패킷의 선택 결과를 재사용하는 데도 쓰이는 구조입니다

## 연결 기록에는 용량과 만료 조건이 있습니다

`nf_conntrack_max`는 허용할 연결 기록 수의 상한이고 `nf_conntrack_buckets`는 해시 버킷 수입니다
두 방향의 해시 등록 수와 연결 객체 수를 같은 값으로 세면 안 됩니다

v6.18.58의 자동 초기화는 기본적으로 max를 버킷 수와 같게 둡니다
명시적으로 hashsize를 준 초기화 경로는 max를 버킷 수의 8배로 잡으므로 모든 구성에서 둘이 같지는 않습니다

공식 문서는 자동 버킷 수를 메모리 용량을 16384로 나눈 값으로 요약합니다
같은 고정 소스는 여기에 `sizeof(struct hlist_head)`를 추가로 나누고, 메모리 구간별 분기도 적용합니다

소스에는 1GiB 초과의 65536, 64비트에서 4GiB 초과의 262144와 최소 1024 조건이 있습니다
문서의 요약식만으로 실제 노드의 버킷 수를 계산해 확정해서는 안 됩니다

### kube-proxy는 커널 초기값을 다시 조정할 수 있습니다

v1.37.1의 `getConntrackMax`는 기본 `MaxPerCore=32768`, `Min=131072`를 사용합니다
CPU 수는 노드의 online CPU를 읽고, 실패하면 `runtime.NumCPU()`를 사용합니다

먼저 `MaxPerCore × CPU 수`가 1,048,576을 넘으면 그 상한을 반환합니다
넘지 않으면 계산값과 Min 중 큰 값을 사용합니다. 이 순서이므로 임의로 큰 Min을 지정했을 때까지 단순한 마지막 상한식으로 바꿔 설명하면 맞지 않습니다

`MaxPerCore=0`이면 이 용량 조정을 생략합니다
Max를 적용한 뒤에는 hashsize가 `max/4`보다 작을 때만 그 값으로 올립니다

버킷이 정확히 `max/4`이고 연결이 max까지 찬 가정에서 평균 해시 등록 수는 버킷당 8개입니다
한 연결에 두 등록이 있으므로 `2 × max / (max/4) = 8`로 계산합니다. 실제 측정값이나 고정된 탐색 횟수는 아닙니다

설정을 읽었다는 사실과 노드에 적용됐다는 사실은 구분해야 합니다
현재 `SetSysctls`는 sysctl이나 hashsize 쓰기 등의 오류를 호출자에게 반환합니다

### 표가 찼다고 모든 기존 연결이 그대로 안전한 것은 아닙니다

새 엔트리를 할당할 때 상한을 넘으면 커널은 회수를 시도합니다
그래도 자리를 얻지 못하면 할당이 실패하고 패킷을 버릴 수 있습니다

초기 network namespace에서는 `nf_conntrack: table full, dropping packet`을 기록합니다
다른 namespace에서는 해당 namespace 번호를 포함한 메시지를 사용합니다

이미 존재하는 기록을 찾은 패킷은 이 새 할당 경로를 피합니다
그러나 회수 가능한 기존 기록이 제거될 수도 있으므로 표 포화가 모든 기존 연결에 무영향이라고 보장할 수는 없습니다

## Timeout은 생성 시각부터 고정된 수명이 아닙니다

| 항목 | 확인한 기본값 | 기준 |
|---|---:|---|
| TCP established | 432000초, 5일 | Linux v6.18.58 |
| TCP TIME_WAIT | 120초 | Linux v6.18.58 |
| UDP 일반 timeout | 30초 | Linux v6.18.58 |
| UDP stream timeout | 120초 | Linux v6.18.58 |
| kube-proxy TCP established 설정 | 24시간 | Kubernetes v1.37.1 |

TCP의 만료 시간은 conntrack이 추적하는 상태에 따라 달라집니다
FIN을 봤다고 엔트리를 즉시 제거하는 것은 아니며, 이 표의 TIME_WAIT도 TCP 소켓의 모든 설정을 대신하는 값은 아닙니다

UDP에는 TCP 같은 종료 handshake가 없지만 양방향 흐름은 추적합니다
확인한 UDP 코드는 응답을 보았는지와 초기 2초 이후에도 활동하는지 등을 보고 stream timeout 적용을 판단합니다

유효한 패킷을 처리하면서 만료 시각을 갱신할 수 있습니다
그래서 일반 UDP의 30초를 생성 후 정확히 30초에 지워지는 고정 수명으로 읽으면 안 됩니다

kube-proxy의 TCP established 설정은 Linux 자체 기본 5일과 다릅니다
`SetSysctls`는 TCP·UDP timeout 설정이 양수일 때 해당 sysctl을 변경하므로, 모든 노드가 언제나 24시간을 사용한다고 단정할 수 없습니다

### 사라진 UDP 백엔드를 정리하는 조건도 나뉩니다

백엔드가 사라져도 기존 NAT 바인딩이 옛 주소를 가리킬 수 있습니다
특히 단방향 UDP가 계속 만료 시각을 갱신하면 기존 변환을 오래 유지할 수 있습니다

v1.37.1의 `CleanStaleEntries`는 UDP 흐름의 original 목적지와 reply 출발지를 현재 serving endpoint 집합과 대조합니다
트래픽 정책·topology·terminating 상태만 바뀌었다고 아직 serving인 endpoint의 기존 흐름을 제거하지는 않습니다

Service IP·포트 기준의 정리는 serving endpoint가 없는 경우도 포함합니다
집합이 비어 있으면 그 Service의 frontend로 향하는 기존 엔트리들이 정리 대상이 됩니다

반면 NodePort 기준의 정리는 serving endpoint가 있을 때만 수행합니다
목적지 포트만으로 찾는 현재 방식에서 집합이 비면 무관한 원격 호스트의 같은 포트 흐름까지 삭제할 수 있기 때문입니다

정리 코드는 오류나 일부 조회 결과도 처리하므로 백엔드 삭제 직후 모든 낡은 엔트리가 즉시 사라진다고 보장할 수는 없습니다
표 포화와 낡은 NAT 바인딩도 서로 다른 문제로 나누어 봐야 합니다

## 같은 Netfilter 기반과 같은 패킷 경로는 다릅니다

nftables는 Netfilter hook·conntrack·NAT 기반을 공유하지만 Service 조회 규칙의 구성과 자료구조는 iptables와 다릅니다
그래서 `KUBE-SVC-…` 체인이 없다는 이유만으로 Service가 구현되지 않았다고 판단할 수 없습니다

`notrack`으로 추적을 제외한 패킷이나 별도 데이터 경로에는 앞의 일반적인 stateful NAT 설명을 그대로 적용할 수 없습니다
eBPF 기반 Service 구현도 처리 위치와 상태 관리 방식을 구현별로 확인해야 합니다

커널의 Netfilter flowtable도 명시적으로 설정한 흐름을 빠른 전달 경로로 보낼 수 있습니다
Flowtable에 적중한 패킷은 기존 IP forwarding 경로의 ingress 이후 hook들을 우회하며, 그 흐름의 NAT 정보도 별도로 재사용합니다

이 동작이 모든 nftables 구성에서 자동으로 켜지는 것은 아닙니다
어떤 규칙·hook을 검사할지는 실제 데이터 경로와 활성화한 기능을 먼저 구분해야 합니다

## 확인한 근거

- [현재 커널 릴리스 목록](https://www.kernel.org/)과 [Linux v6.18.58 고정 소스](https://github.com/gregkh/linux/tree/2926d88bb7fc4608fd942453d929c39e4e5ec006)
- [Netfilter hook·우선순위](https://wiki.nftables.org/wiki-nftables/index.php/Netfilter_hooks), [NAT 최초 패킷과 후속 처리](https://wiki.nftables.org/wiki-nftables/index.php/Performing_Network_Address_Translation_(NAT))
- [IPv4 우선순위 상수](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/include/uapi/linux/netfilter_ipv4.h), [hook 실행](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/net/netfilter/core.c), [NAT hook·재라우팅](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/net/netfilter/nf_nat_proto.c)
- [NAT 바인딩과 재사용](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/net/netfilter/nf_nat_core.c), [연결 조회·양방향 등록·초기값·할당 실패](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/net/netfilter/nf_conntrack_core.c)
- [고정 conntrack sysctl 문서](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/Documentation/networking/nf_conntrack-sysctl.rst), [TCP timeout](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/net/netfilter/nf_conntrack_proto_tcp.c), [UDP timeout·갱신](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/net/netfilter/nf_conntrack_proto_udp.c)
- [iptables 규칙 생성](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/iptables/proxier.go), [현재 conntrack 설정 적용](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/conntrack/sysctls.go), [UDP 정리 조건](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/conntrack/cleanup.go)
- [Flowtable의 forwarding 우회와 NAT 상태](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/Documentation/networking/nf_flowtable.rst)
