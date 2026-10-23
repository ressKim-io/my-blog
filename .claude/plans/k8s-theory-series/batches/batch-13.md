# Batch 13 인계 — 2026-10-23

3편 검수 완료, SVG 6장. 콘텐츠 커밋 `a999ddc`
이번 요청 누적 21/30편, 전체 시리즈 누적 47편

## 원본·결과 대응

원본 루트: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/`
읽기 전용으로 사용했으며 작업 전후 hash 일치를 검증했다
작성 기준일은 2026-10-23이며 학습일·배포일을 뜻하지 않는다

| 좌표 | 원본 파일 | 줄 수 | SHA-256 | slug | series / order |
|---|---|---:|---|---|---|
| 3-2.2 | `Phase 3-2.2 · overlay 와 native routing (2) · 노드를 넘는 순간 k8s 는 말이 없다.md` | 371 | `aa6378c09ba9961c2801eb5008389df756142adba3a1fe3123575208103c89bd` | `k8s-theory-overlay-native-routing` | `k8s-theory-network` / 3 |
| 3-3 | `Phase 3-3 · Service 와 kube-proxy · 주소가 아니라 규칙이다.md` | 666 | `3f8b1d1440a24c7cb84158a546ee3df0e2bd26bf85cd3ad1f5baa19612870615` | `k8s-theory-service-kube-proxy` | `k8s-theory-network` / 4 |
| 3-4 | `Phase 3-4 · DNS 와 ndots · 이름 하나에 패킷 여덟 개.md` | 494 | `7ad634e62b3d486c5f3ac4c14f7bfb7086bd05acd75a5313b9bd1bb0a16a8661` | `k8s-theory-dns-ndots` | `k8s-theory-network` / 5 |

글 경로는 `src/content/essays/kubernetes/{slug}.md`, SVG는 `public/diagrams/{slug}-{n}.svg`다

## 작성자의 근거 대조·편집 기록

아래는 작성 단계의 기록이다. 이후 보완·정정은 별도 검수와 지적 반영 기록을 우선한다

# Batch 13 · 3-4 DNS와 ndots 인계

- 상태: 작성·개별 검증 통과, 별도 reviewer와 배치 lint·build·정적 출력 검증 대기
- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 3-4 · DNS 와 ndots · 이름 하나에 패킷 여덟 개.md` 전문 494줄
- SHA-256: `7ad634e62b3d486c5f3ac4c14f7bfb7086bd05acd75a5313b9bd1bb0a16a8661` 최종 재확인 일치
- 출력: `src/content/essays/kubernetes/k8s-theory-dns-ndots.md`, 같은 slug SVG 2개
- 등록: `k8s-theory-network` order 5 / date `2026-10-23` / 첫 태그 `Kubernetes`
- 최신 progress/source-map·plan·source-format 및 공통 draft-to-post·writing-voice·SVG 규칙 적용, 공통 파일 수정 없음

## 확인한 근거와 정정

- Kubernetes v1.37.1 `f78e722310e50bcaca9276be22276d9e91d91308`, website `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
  - [dns.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/network/dns/dns.go): `GetPodDNS`, 정책 분기, cluster search 3개+host search·중복 제거, `ndots:5`, Pod options 덮어쓰기, 32개/2048자/3서버·개별 255자, `DNSConfigForming`
  - [validation.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go): Pod dnsConfig 자체의 API 거절과 합쳐진 설정의 kubelet 잘림 구분
  - [공식 Service·Pod DNS](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/): Service/Pod 이름, headless·endpoint·Ready·publishNotReadyAddresses, hostNetwork 정책 및 Windows 제외
- glibc 현재 공식 릴리스 2.44 `c3a3a9808ad3ab4a3336836833f83288b672ccbf`
  - [공식 릴리스](https://sourceware.org/glibc/)·고정 tag commit을 실제 확인, GitHub mirror tags 응답의 2.42를 최신으로 사용하지 않음
  - [res_query.c](https://sourceware.org/cgit/glibc/tree/resolv/res_query.c?id=c3a3a9808ad3ab4a3336836833f83288b672ccbf): ndots 이상이면 먼저 원래 이름, 실패 뒤 조건부 search, 끝 점이면 search 생략, 오류별 중단/계속
  - [resolv.h](https://sourceware.org/cgit/glibc/tree/resolv/resolv.h?id=c3a3a9808ad3ab4a3336836833f83288b672ccbf)·[res_send.c](https://sourceware.org/cgit/glibc/tree/resolv/res_send.c?id=c3a3a9808ad3ab4a3336836833f83288b672ccbf): timeout 5·attempts 2, nameserver별 대기 계산, 같은 UDP 소켓의 A/AAAA 및 한쪽 응답 뒤 직렬화·reopen 재시도
  - [resolv.conf 매뉴얼](https://man7.org/linux/man-pages/man5/resolv.conf.5.html): ndots·timeout·attempts와 single-request-reopen 의미 대조
- musl 1.2.6 `9fa28ece75d8a2191de7c5bb53bed224c5947417`, 공식 tag/commit 확인
  - [lookup_name.c](https://git.musl-libc.org/cgit/musl/tree/src/network/lookup_name.c?id=9fa28ece75d8a2191de7c5bb53bed224c5947417): 점 개수가 ndots 이상이면 search 목록을 비움. glibc의 원래 이름 실패 후 search 복귀를 일반화하지 않음
  - [resolvconf.c](https://git.musl-libc.org/cgit/musl/tree/src/network/resolvconf.c?id=9fa28ece75d8a2191de7c5bb53bed224c5947417)·[res_msend.c](https://git.musl-libc.org/cgit/musl/tree/src/network/res_msend.c?id=9fa28ece75d8a2191de7c5bb53bed224c5947417): 기본 5/2, 한 후보 UDP 묶음의 timeout 예산과 timeout/attempts 간격. 전체 search 조회 총 지연으로 쓰지 않음
- CoreDNS v1.15.0 `a6fde3fe339c6ec848447e11cc9796be8c97b4e0`: [공식 릴리스](https://github.com/coredns/coredns/releases/tag/v1.15.0)·go.mod 실제 확인
  - [kubernetes 구현·문서](https://github.com/coredns/coredns/tree/a6fde3fe339c6ec848447e11cc9796be8c97b4e0/plugin/kubernetes): EndpointSlice list/watch, pods 기본 disabled/verified watch, startup_timeout 기본 5초·미동기화 SERVFAIL, 영역별 fallthrough
  - [cache](https://github.com/coredns/coredns/blob/a6fde3fe339c6ec848447e11cc9796be8c97b4e0/plugin/cache/README.md): 성공/부정 응답 캐시와 API 로컬 상태를 구분. CoreDNS 적중이 Pod→CoreDNS 요청까지 제거한다고 쓰지 않음
  - [kubeadm 상수](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kubeadm/app/constants/constants.go)의 기본 v1.14.6과 구현 예시 v1.15.0·실제 설치 미확인을 구분
- 8개는 search 3개+절대 이름, A·AAAA 모두 전송, 앞 후보 NXDOMAIN, 캐시·재시도 없음이라는 조건의 DNS 질의 계산. 네트워크 패킷 실측·총지연으로 옮기지 않음
  - [RFC 1035 A](https://www.rfc-editor.org/rfc/rfc1035.html#section-3.4.1), [RFC 3596 AAAA](https://www.rfc-editor.org/rfc/rfc3596.html#section-2.1), [RFC 2308 오류](https://www.rfc-editor.org/rfc/rfc2308.html#section-2.1) 실제 대조
- [NodeLocal 공식 문서](https://kubernetes.io/docs/tasks/administer-cluster/nodelocaldns/): Pod↔로컬 캐시 구간의 DNAT/conntrack 우회 및 상위 TCP 가능. 모든 구간의 NAT·추적 제거로 확대하지 않음
  - [Linux v6.12 TCP conntrack](https://github.com/torvalds/linux/blob/adc218676eef25575469234709c2d87185ca223a/net/netfilter/nf_conntrack_proto_tcp.c)·같은 ref sysctl 문서: 연결 종료 뒤 상태별 timeout, 즉시 엔트리 삭제 보장 아님

## 검증·잔여 한계

- SVG 2개 XML parse·접근성 title/desc 통과, sharp 600px/375px PNG 네 장 렌더. 모두 직접 육안 검사해 겹침/잘림 없음, 375px 최소 글자 13.125px
- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-dns-ndots.md`: 실제 실행 error 0 / warn 1(100자 초과 줄 19곳). URL·표·조건 서술 문맥 검토, 강제 개행으로 뜻을 나누지 않음
- 원본 hash 재확인 및 성공한 공식 파일 30개 SHA 검증. 파일별 URL/hash·실패 내역은 `manifest*.json`, 요약은 `verification.json`
- fetch 실패는 숨기지 않음: 존재하지 않는 CoreDNS records.go(실제 records 로직은 kubernetes.go), glibc 2.44 res_init.c의 429/미러 비소스 응답. 필요한 기본값은 현행 header·매뉴얼과 전송 소스에서 확인. res_query.c는 같은 commit의 GNU GitLab mirror로 보완함
- 원본의 미실행 LAB 10개는 경험/실행 결과로 옮기지 않음. 실제 DNS 설치 버전·Pod resolver·search·커널/sysctl·패킷/지연은 측정하지 않음
- 미확인 유지 1건: [KEP-1024 고정 원문](https://github.com/kubernetes/enhancements/blob/0c8d11e9a13e12d2ef75d2d78af5ac00d8189046/keps/sig-network/1024-nodelocal-cache-dns/README.md)의 `3 retries x (5s timeout for A + 5s timeout for AAAA)`는 환경/3회 산출 근거가 없음. glibc 기본 attempts 2와의 차이는 확인 불가. 내부 복구 분기로 역사적 3회를 추정하지 않았고 본문에 유보, 보편적 30초 단정 없음
- 이 역사적 수치를 현재 기전의 근거로 사용하지 않아 글 자체의 핵심 근거 보류 사유는 없음. 배치 build·정적 출력·독립 검수·커밋은 parent 담당이며 이 보고서의 개별 검사와 구분함
- 대표 문장: 원본 `따라서 낮은 ndots가 이 이름을 무조건 실패시키는 것은 아니다. 차이는 조회 순서다` → `glibc에서는 앞의 절대 조회가 실패해도 조건에 따라 search를 이어갈 수 있으므로, 낮은 ndots가 두 조각 Service 이름을 항상 실패시키는 것은 아닙니다` (resolver 범위를 명시)
- 문체·원본 대조: 격식체/단락 끝 마침표 생략, 경험 창작·수치 과장·표 재낭독 없음. 선택지 비교 섹션 미포함(원본에 설계 대안 선택 서사 없음)


# Batch 13 · Phase 3-3 작성 인계

- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 3-3 · Service 와 kube-proxy · 주소가 아니라 규칙이다.md`
- 2026-10-23 최신 666줄 전문 읽음. SHA-256 `3f8b1d1440a24c7cb84158a546ee3df0e2bd26bf85cd3ad1f5baa19612870615`, sources.json과 실제 파일 일치
- 최신 progress·source-map Phase 3의 3-3 본절·현행 후속·v1.37 대조 확인. progress SHA `c3081510322928d79907275e31e02c0f4708ec606644bed7581006645d1d16f5`, source-map SHA `0458c79aa9dd7996a03d7babffc63068c5c3b5a7b16bc6906fc690b920f651bd`
- 글: `src/content/essays/kubernetes/k8s-theory-service-kube-proxy.md`, 288줄. series `k8s-theory-network` / order 4 / date 2026-10-23
- tags: Kubernetes, Service, kube-proxy, EndpointSlice, conntrack, concept
- SVG 3개: `-1.svg`는 목록·규칙 갱신과 실제 패킷 흐름, `-2.svg`는 세 백엔드의 조건부 확률, `-3.svg`는 TCP connect의 패킷 변환과 Cilium 소켓 변환. 원본의 흐름·확률·소켓 ASCII를 통합·재구성했으며 별도 신규 주제 그림 0개. 표 4개
- draft-to-post 진입점·공동 절차·voice·plan/source-format·SVG 기준 및 같은 series의 CNI 글 참조. 공통 문서·타인 파일 수정, commit/build/push 실행 안 함

## 실제 대조한 버전과 근거

| 대상 | 버전·ref |
|---|---|
| Kubernetes | v1.37.1 · `f78e722310e50bcaca9276be22276d9e91d91308` |
| website | 공식 저장본 · `7fde177e22dc98390a6d55d215dd0301b5f6d0bb` |
| Linux | v6.12 · `adc218676eef25575469234709c2d87185ca223a` |
| Cilium | 최신 release API·tag를 직접 확인한 v1.20.3 · `bf1aba7b34ab6d9c711315d78d8eefbea81962d1` |

공식 자료 33파일을 확보한 뒤 본문에 해당하는 절·심볼을 실제 읽고 대조했다. `manifest.json`·`manifest-extra.json`에 URL/hash, `external-refs.json`·`cilium-release.json`에 외부 버전 근거를 보존했다. 최종 33/33 hash 일치. nftables 블로그의 최초 추정 저장소 경로 1건은 404였으며 공식 저장소 목록에서 실제 `content/en/blog/_posts/2025/nftables-kube-proxy/index.md`를 찾아 성공했다. 실패 경로는 본문 출처로 사용하지 않았다

- https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/networking/virtual-ips.md — Linux 모드·deprecated·NodePort 기본 주소·localhost 조건·Local 정책. Service·EndpointSlice·kernel-version-requirements 저장본도 대조
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/endpointslice/endpointslice_controller.go — selector 없는 Service·ExternalName 제외, 같은 namespace의 Pod 목록. `cmd/kube-proxy/app/server.go`의 ServiceConfig·EndpointSliceConfig 등록, EndpointSlice defaults/플래그 검증의 기본 100·범위 1~1000
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/iptables/proxier.go — 체인 해시, writeServiceToEndpointRules의 조건부 확률·ClientIP affinity, syncProxyRules의 Cluster/Local·masquerade·REJECT/DROP·localhost 분기
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/ipvs/proxier.go — syncService의 ClusterIP bindAddr와 `kube-ipvs0`, scheduler 미설정 시 rr. NodePort의 nodeIP 바인딩 경로와 혼동하지 않음
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/nftables/proxier.go — service-ips의 주소·프로토콜·포트→verdict와 `numgen random mod` 분리. localhost 게이트·명시 loopback·TCP userspace helper 조건
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/conntrack/cleanup.go — CleanStaleEntries의 UDP·serving endpoint와 원래 목적지/응답 백엔드 비교, serving 목록이 비었을 때 NodePort-only 정리 생략
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/conntrack/sysctls.go — getConntrackMax의 현재 경로·CPU 계산·1,048,576 상한 우선 분기·MaxPerCore 0. config defaults와 실제 플래그 이름은 defaults.go·options.go에서 별도 확인
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go — NFTablesProxyMode GA true 잠김, KubeProxyIPVS Deprecated true·잠김 아님, NFTablesNetlink Beta true, KubeProxyNFTablesLocalhostNodePorts Alpha false. server_linux.go·config validation에서 실제 선택·허용 조건도 대조
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/nftables/supported.go — kernel 5.13 검사. vendored knftables/nftables.go에서 nft 1.0.1 요구와 일부 List에 한정한 netlink 경로 확인
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/core/v1/types.go — Endpoints v1.33 deprecated, AllocateLoadBalancerNodePorts·정책 필드. core/v1/defaults.go·Service 문서에서 true 기본값과 기존 포트 해제 조건 대조. util/utils.go의 headless/ExternalName 제외, ipallocator/interfaces.go의 오류 원문도 확인
- https://kubernetes.io/blog/2025/02/28/nftables-kube-proxy/ — Service 조회 복잡도와 규칙 변경 비용을 분리해 사용. 실제 고정 저장본도 읽음
- https://github.com/torvalds/linux/blob/adc218676eef25575469234709c2d87185ca223a/net/netfilter/nf_nat_core.c — nf_nat_inet_fn의 초기화 여부·새 연결 설정과 nf_nat_packet 재사용, 응답 방향 변환. nf_nat_proto.c의 호출 연결도 대조
- https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/network/kubernetes/kubeproxy-free.rst — connect(TCP/connected UDP)·UDP sendmsg/recvmsg, 커널 소켓 백엔드 목적지와 하위 Service NAT 생략, hostNamespaceOnly 설정 시 TC 재조회

## 원본 대비 정정·한정

1. 원본의 release-1.35·release-1.37·Cilium v1.20.2 혼합을 현재 고정본과 Cilium v1.20.3으로 대조했다. IPVS의 인터페이스 바인딩, GA와 기본 모드 차이는 원본에 이미 있는 예외이며 그대로 보존했다
2. 원본의 `cmd/kube-proxy/app/server_linux.go :: getConntrackMax` 경로와 `max(MaxPerCore×CPU, Min)` 설명을 현재 `pkg/proxy/conntrack/sysctls.go`로 갱신했다. scaled가 1,048,576보다 크면 Min 비교 전에 상한을 반환하는 분기, 0일 때 미변경, online CPU 판정을 명시했다
3. UDP stale 정리를 모든 연결·모든 NodePort 엔트리의 삭제로 일반화하지 않았다. 현재 serving 목록이 비었을 때 NodePort-only 정리를 생략하는 구체 조건을 추가했다. 기존 흐름에 트래픽 정책·topology 필터를 다시 적용하는 설명도 하지 않음
4. nftables의 localhost NodePort는 게이트와 loopback 명시 외에 TCP helper 한정이라는 현재 구현 조건을 보충했다. NFTablesNetlink 기본 on이 nft 실행 파일 불필요를 뜻하지 않음도 보존했다
5. 모드별 Service 조회와 백엔드 분배를 분리했다. iptables 확률, IPVS 기본 rr, nftables numgen random을 구분하고 O(n)/O(1)을 새 NAT 연결의 Service 탐색 비교로 한정했다
6. Local 정책의 출발지 보존을 모든 유입 경로의 보장으로 쓰지 않았다. Ready 우선·Serving+Terminating fallback과 전체 후보 부재 REJECT/Local 후보 부재 DROP을 현재 topology.go·iptables 구현으로 확인했다
7. headless·ExternalName 제외가 일반 conntrack 제거를 뜻하지 않으며 Cilium의 소켓 경로 역시 모든 eBPF NAT/conntrack 제거로 바꾸지 않았다. v1.20.3의 Pod 소켓 번역 우회와 TC 재조회 조건을 보존했다
8. 원본의 버전별 proxier 줄 수는 현재 성능 근거로 사용하지 않았다. 기존 연결이 반드시 느려지지 않는다는 미실행 LAB의 기대를 관측 사실로 바꾸지 않았고, 자기평가·용어 사전의 중복·편집 경위는 본문에서 제외했다

## 대표 문장

원문: “`cmd/kube-proxy/app/server_linux.go :: getConntrackMax` / `MaxPerCore * CPU 수`와 `Min` 중 큰 쪽”

변환: “현재 getConntrackMax는 MaxPerCore × CPU 수가 1,048,576을 넘으면 먼저 그 값으로 제한합니다 / 그 외에는 계산값과 Min 중 큰 값을 사용합니다”

이유: 기존 책임 구분과 계산 설명을 유지하면서 현재 파일 경로와 상한 분기 순서를 실제 구현에 맞췄다

## 검증·남은 문제

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-service-kube-proxy.md` 실제 실행 exit 0, error 0 / warn 1. 긴 줄 30곳은 주로 고정 출처 URL과 조건 설명이며 문맥 검토 후 보존. 최종 로그 `lint-post.log`
- SVG 3개 XML 파싱·title/desc·참조 실존 확인. 최소 20px / 560폭으로 375폭 명목 최소 13.39px. sharp로 원본·375폭 PNG 6개 렌더 후 모두 육안 검사, 글자 잘림·박스 겹침 없음. text 개수 16/14/10
- 전 섹션 시각화 재검토: 상태 흐름/확률/소켓 위치는 SVG, 타입/설정/모드/실패 근거는 표, 책임·조건은 산문으로 정리했다. 조회 구조 비교는 모드 표와 산문으로 충분해 원본의 유사 ASCII를 별도 SVG로 늘리지 않음
- 원본·문체·기전·과장·가상 경험·끝마침표 문맥 검토. 내부 링크 1개·이미지 3개 대상 실존, 문단 끝 마침표 0. `output-checks.json`에 글·SVG hash와 소스 33파일 hash 점검 기록
- Decision section 미포함: 개인 선택·대안 검토 경험이 없는 동작 해설
- 핵심 근거 부족 보류 없음. 실제 설치 proxy mode·Cilium 설정·노드 sysctl·패킷/성능 실측은 검증하지 않았고 본문도 보장하지 않음
- 전체 lint·build·정적 출력·별도 reviewer 실행 안 함. 독립 검수와 부모의 통합 검증 대기이며 작성 결과를 먼저 완료 편수에 포함하면 안 됨


# Batch13 · 3-2.2 Overlay와 native routing 작성 보고

- 글: `src/content/essays/kubernetes/k8s-theory-overlay-native-routing.md`
- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 3-2.2 · overlay 와 native routing (2) · 노드를 넘는 순간 k8s 는 말이 없다.md`
- 원본 371줄 전문 확인, SHA `aa6378c09ba9961c2801eb5008389df756142adba3a1fe3123575208103c89bd`
- `k8s-theory-network` / order 3 / date 2026-10-23, essays/kubernetes
- 최종 글 244줄, SHA `e094ea9bce6d58fd2336717dfd21bdd1513a39d2de010f25c47fbef45f529228`
- SVG 1개 / 표 4개. 원본의 overlay/native 비교를 선택 기준 소절·표로 포함. 개인 선택·성능 순위·새 대안 창작 없음
- draft-to-post 진입점·공동 절차·decision-tradeoff, docs/writing-voice.md, plan/source-format, SVG 기준 적용. 같은 network 시리즈 sandbox-pause 글을 읽고 연결 확인

## 최신 원본 맥락

- progress 1122줄, SHA `c3081510322928d79907275e31e02c0f4708ec606644bed7581006645d1d16f5`
- source-map 123줄, SHA `36cadfdf517ab7a33708be8e867f8b4d303d762e873ddd3c31564b8c77e704ae`
- source-map Phase 3 1265줄, SHA `0458c79aa9dd7996a03d7babffc63068c5c3b5a7b16bc6906fc690b920f651bd`
- 기존 v1.35와 현재 v1.37 연결을 구분. source-map의 Cilium v1.20.2는 과거 확인 버전이며 이번 stable/release 조회는 v1.20.3으로 갱신
- 원본·산출물·context 해시와 SVG XML 정보는 `source.json`, 수집 URL/hash는 `manifest*.json`

## 실제 확인한 근거

- Kubernetes v1.37.1 `f78e722310e50bcaca9276be22276d9e91d91308`, website `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
- Cilium stable 문서·release API의 현재 버전 **v1.20.3**(2026-10-15 공개), commit API로 실제 ref **`bf1aba7b34ab6d9c711315d78d8eefbea81962d1`** 확인. `cilium-current/`에 고정 원문 저장
- 먼저 읽은 v1.20.2 ref `e0dc92bd...`는 `cilium/cilium/`에 별도 보존. 본문 Cilium 주장은 v1.20.3 자료로 대조
- Cilium go.mod도 읽음: Go 1.26.0, CNI 모듈 v1.3.0, netlink `v1.3.2-0.20260624190457-bab08b3566fc`. 실제 설치 버전으로 추정하지 않음
- RFC 7348·8926 원문, RFC 8200 공식 본문의 IPv6 fragmentation/MTU를 웹에서 확인. AWS 현재 공식 prefix 문서는 별도 공급자 자료로 구분

| 핵심 주장 | 실제 대조한 URL·소스 |
|---|---|
| Kubernetes 요구와 네트워크 구현 분리 | [네트워크 모델](https://kubernetes.io/docs/concepts/services-networking/) 및 고정 website `_index.md`. 의도적 격리 등의 예외와 노드 간 Pod 직접 통신 요구, 외부 pod network 구현 분리 |
| nodeipam 생성·CIDR·마스크 | [`newNodeIpamController/setNodeCIDRMaskSizes`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kube-controller-manager/app/core.go), [`NewNodeIpamController`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/nodeipam/node_ipam_controller.go), [`RangeAllocator`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/nodeipam/ipam/range_allocator.go). allocate=false nil, valid cluster CIDR, /24·/64, dual-stack 공통 mask 금지, Node PodCIDRs patch, 범위 기록과 개별 IP·경로 설치 분리 |
| 현행 cloud 경계 | 같은 KCM 생성부가 cloud=nil을 전달하며 CloudAllocator를 명시 거부. cidr_allocator.go에 상수 넷이 남는 것과 현재 실행 가능한 경로를 혼동하지 않음. 다른 legacy allocator 전부의 세부 실행을 인증한 주장은 안 함 |
| CIDR 전달과 복수 주소군 | [`kubelet_network.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kubelet_network.go), [`kubelet_node_status.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kubelet_node_status.go)의 strings.Join(PodCIDRs, comma), [`CRI NetworkConfig`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cri-api/pkg/apis/runtime/v1/api.proto). string 하나와 CIDR 하나를 동일시하지 않음 |
| IPAM·routing의 별도 축과 지원 조합 | [Cilium IPAM 표](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/network/concepts/ipam/index.rst), [Kubernetes Host Scope](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/network/concepts/ipam/kubernetes.rst), [Cluster Scope](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/network/concepts/ipam/cluster-pool.rst). Node field/annotation와 CiliumNode.spec.ipam.podCIDRs, cluster-pool 기본, ENI tunnel 불가/direct 가능 |
| Overlay·native·설정 | [Cilium v1.20.3 routing](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/network/concepts/routing.rst), [values](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/install/kubernetes/cilium/values.yaml), [ConfigMap template](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/install/kubernetes/cilium/templates/cilium-configmap.yaml). node-IP underlay/터널포트, native의 라우터 default route 또는 per-node CIDR route, 같은 L2 auto-direct-node-routes. Helm camelCase와 ConfigMap kebab-case 실제 매핑 확인 |
| ENI·주소군·예약·prefix | [Cilium ENI](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/network/concepts/ipam/eni.rst), routing의 ENI별 테이블·Pod별 경로, [AWS prefix 문서](https://docs.aws.amazon.com/eks/latest/userguide/cni-increase-ip-addresses.html). secondary IPv4 계산과 prefix delegation·IPv6 beta를 구분. AWS VPC CNI 절차를 Cilium 설정으로 인용하지 않음 |
| maxPods 한도 | [`defaults.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/apis/config/v1beta1/defaults.go) 기본110과 위 range allocator의 자원 범위. 모든 Kubernetes 코드 전역 부재를 인증하지 않고 확인한 nodeipam 할당 경로에 maxPods 대조가 없다는 범위로 한정 |
| MTU·주소군·Device/Route 구분 | [Cilium pkg/mtu/mtu.go](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/pkg/mtu/mtu.go)의 TunnelOverheadIPv4=50, IPv6=70, Calculate/getRouteMTU/getDeviceMTU. 바깥 Ethernet MTU 제외, 내부 Ethernet14 포함. underlay1500·추가 암호화/IP옵션 없음에서 내부 IP 예산1450/1430. TCP payload와 구분 |
| Geneve·fragmentation | [RFC8926 §3.1/§4.4.1](https://www.rfc-editor.org/rfc/rfc8926.html): 헤더8~260과 최대옵션 가정. [RFC7348 §4.3](https://www.rfc-editor.org/rfc/rfc7348.html): VTEP fragmentation 금지·조각 폐기·경로MTU. [RFC8200 §4.5/§5](https://www.rfc-editor.org/rfc/rfc8200.html): IPv6 송신 측 분할·중간라우터 분할 금지·Packet Too Big/최소MTU 조건 |

## 정정·보존

1. 원본의 전달 방식·주소 공급을 별도 축으로 읽는 구조 보존. 모든 조합 가능이라는 뜻은 아니며 실제 IPAM 표의 지원 조합 제시
2. 원본의 IPv4 VXLAN 50B·1500→1450은 조건을 명시한 계산으로 한정. IPv6 underlay70B·1430을 실제 구현으로 대조. Pod 주소군과 underlay 주소군을 구분
3. **DeviceMTU와 RouteMTU를 구분**. Pod eth0가 반드시1450이라는 설명을 만들지 않음. 추가 암호화/옵션·TCP헤더도 별도
4. 현행 KCM CloudAllocator 거부를 설명. 원본의 cloud provider 선택에 따른 내부 할당 계열을 현행 정상 구성으로 단정하지 않음
5. 단일 --node-cidr-mask-size만 설명하지 않고 dual-stack의 주소군별 플래그 조건 보완. CRI string 하나가 복수CIDR 전달을 막는다는 오해 수정
6. ENI 수×IP 수를 모든 구성의 Pod 수 공식으로 확대하지 않음. secondary IPv4 예시·예약·prefix·현재IPv6 beta 차이를 명시
7. ‘MTU 코드 전역0건’ 같은 과거 검색을 현행 전수 판정으로 복사하지 않음. 네트워크 구현의 실제 MTU 계산을 제시하고 API 상태를 경로MTU 검증 완료로 읽지 않음
8. Cloud/cluster CIDR 생성 실패의 원본 특정 메시지를 현행 전체 시작 경로의 유일한 오류로 약속하지 않음. 상위 parse·플래그 검증도 있으므로 실패표는 실제 조건으로 설명
9. LAB·종료 판정·내부 메타 제외. 문서 기반 가능한 증상과 실측을 구분. 기술 이름만으로 성능 우위·환경 선택 경험을 창작하지 않음

## 실행한 검증

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-overlay-native-routing.md` → **error 0 / warn 1**, 100자 초과26줄 검토. 기술식별자·긴 근거 링크 조건 유지
- SVG XML parse 통과, role/title/desc 있음, text15개, 최소font21px, 한글 라벨
- `sharp` 800×978·375×458 PNG 생성, 두 파일을 `view_image`로 열어 최종 육안 확인. 한글 정상·레이블/선 겹침이나 잘림 없음
- 전 섹션 시각화 재검토: 노드 간 내부/바깥 주소와 두 경로는 SVG, IPAM·선택 기준·MTU 수치·실패 판별은 표. 중복 ASCII 없음
- 원본371줄과 최종본문·근거 대조, voice의 근거·자립성·조건·반복 검토
- `git diff --check` 통과
- **전체 lint·build·정적 출력·독립 reviewer·commit 실행 안 함**, 부모 배치 검증으로 인계

## 대표 문장 대조

원본: “전달 방식은 패킷을 어떻게 보내는지 정하고, 주소 공급 방식은 Pod IP를 어디서 가져오는지 정한다”

변환: “Pod IP의 할당·관리를 뜻하는 IPAM은 패킷 전달 방식과 구분해야 합니다”

용어를 풀면서 전달/할당의 원본 경계를 보존했습니다

## 남은 문제

- 핵심 근거의 미확인·보류 사항 없음. 실제 클러스터·Cilium 설치값·MTU 적용·패킷 크기별 실패·처리량은 실행하지 않았고 본문도 실측으로 표현하지 않음
- 원본이 남긴 코어 전역 MTU 설정 부재·maxPods 교차검증 전수 부재를 이번 작업에서 인증하지 않음. 본문은 확인한 경로와 API/실제 전달의 의미를 구분하는 범위
- 독립 reviewer 및 배치 전체 lint/build/export 통과 후 부모가 완료 편수 확정
- 공통plan/README·타인 글·기존SVG·Vault 원본 수정 없음. commit/build 실행 없음


## 별도 blog-reviewer 검수

# Review: Batch 13 · 글 3개 / SVG 6개

- 적용: `docs/writing-voice.md`, draft-to-post 진입점·공동 절차, 시리즈 plan/source-format, SVG 가이드
- 대상: `src/content/essays/kubernetes/k8s-theory-{overlay-native-routing,service-kube-proxy,dns-ndots}.md`와 해당 SVG 1·3·2개
- 원본: `sources.json`의 정확한 Vault 원본 371·666·494줄 전문 대조, 실제 SHA-256 3/3 일치
- 콘텐츠·SVG·공통 문서 수정, build·commit·push 실행 안 함

## P0 위반 / 필수 수정

없음

## P1 확인 필요

없음

## P1 권장

없음

## 실제 검증

완료된 파일부터 먼저 `npm run lint:post -- <대상 파일>`을 실행했다. 최종 저장본 세 편을 모은 동일 명령도 실제 exit 0이다

```text
k8s-theory-overlay-native-routing.md  error 0 · warn 1 (100자 초과 26곳)
k8s-theory-service-kube-proxy.md      error 0 · warn 1 (100자 초과 30곳)
k8s-theory-dns-ndots.md               error 0 · warn 1 (100자 초과 19곳)
전체: error 0 · warn 3 (파일 3개)
```

- 긴 줄은 고정 URL·조건 설명을 포함해 문맥 검토했다. 기계적 분리를 추가 요구하지 않았다
- category/디렉터리·slug·network order 3·4·5가 plan과 일치한다. slug 중복 및 시리즈 트랙 분리 없음
- SVG 6개를 reviewer가 sharp로 800/375px 재렌더링해 PNG 12개 전부 실제 육안 확인했다. XML·title/desc·한글, 잘림·겹침·화살표 및 본문/원본의 의미를 확인했다
- 원본 3개와 manifest의 유효 근거 캐시 93건 해시 일치, 최종 SVG와 렌더 입력도 일치한다. 실패 조회 5건은 근거 수에 포함하지 않았다
- 상세 기록: `reviewer-evidence-checks.json`, 렌더: `reviewer-render/`, 검토 최종 입력 9개: `review-hashes.json`
- 전체 프로젝트 lint·build·정적 출력은 root의 별도 통합 검증 단계이며 reviewer는 실행하지 않았다

## 원본·기술 대조

- **Routing**: KCM의 allocate-node-cidrs/CloudAllocator 거부, dual-stack 마스크 조합, Node CIDR 기록과 개별 IP/경로 설정의 분리를 확인했다. 복수 PodCIDRs의 쉼표 전달, Cilium의 IPAM별 지원 조합과 현재 cluster-pool 기본, native의 라우터 기본 경로/노드별 경로 조건이 정확하다. v1.20.3의 underlay IPv4 우선·터널 포트, ENI·prefix·IPv6 beta 조건을 대조했다. MTU 1450/1430은 underlay1500·추가 암호화/옵션 없음의 내부 IP 예산이며 DeviceMTU/RouteMTU·TCP 데이터 크기와 구분한다. Geneve 최대 옵션과 IPv6 중간 라우터 fragmentation 금지도 실제 근거에 부합한다
- **Service/proxy**: selector/namespace 기반 EndpointSlice 관리와 노드별 규칙·커널 전달을 구분한다. 주소 할당·IPVS의 kube-ipvs0 바인딩, 타입·headless·ExternalName 예외, iptables 조건부 확률·nftables map/numgen·IPVS rr, 새 NAT/기존 변환 재사용과 조회/갱신 비용을 대조했다. 현재 conntrack 계산의 1,048,576 우선 상한·online CPU·0일 때 미변경, UDP serving 비교와 empty endpoint NodePort-only 삭제 생략을 확인했다. GA와 기본 모드·IPVS deprecated 존재, nft/netlink 요구, NodePort 주소와 localhost TCP 전용 조건, Local/Ready·ServingTerminating fallback·REJECT/DROP 및 Cilium 소켓/TC 경계를 보존한다
- **DNS**: kubelet 정책·search·ndots 구성과 resolver 실행을 분리한다. API DNSConfig 검증과 합산 후 잘림, hostNetwork fallback과 MissingClusterDNS가 다르다. glibc의 조건부 search 복귀와 musl의 ndots 이상 search 제거를 실제 확인했다. 8개는 조건부 DNS 질의 계산으로 패킷 수·실측이 아니다. 성공/NXDOMAIN/NODATA/SERVFAIL·캐시 위치를 구분한다. CoreDNS pods/EndpointSlice watch·startup/부정 캐시·fallthrough, glibc timeout/attempts·내부 reopen과 musl의 한 후보 UDP 예산, NodeLocal 로컬 구간과 TCP 추적 상태를 확인했다. 구현 예시 CoreDNS1.15.0과 kubeadm 기본1.14.6을 섞지 않는다
- 원본의 미실행 LAB·자가 판정·내부 식별자는 본문에 옮기지 않았다. 원본에 없는 개인 경험·실측·성능 순위나 숫자 창작 없음. 설명할 조건과 선택 이유를 보존했으며 표 재낭독·고정 문단/SVG 개수 요구 없음

## 대표 공식 근거

실제 고정 캐시는 `/tmp/k8s-batch13/{routing,proxy,dns}/` 아래 프로젝트별 폴더에서 읽었으며 URL/hash는 각 manifest에 있다

- [KCM nodeipam 생성·마스크](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kube-controller-manager/app/core.go), [Cilium v1.20.3 routing](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/network/concepts/routing.rst), [IPAM](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/Documentation/network/concepts/ipam/index.rst), [MTU 구현](https://github.com/cilium/cilium/blob/bf1aba7b34ab6d9c711315d78d8eefbea81962d1/pkg/mtu/mtu.go)
- [iptables](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/iptables/proxier.go), [nftables](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/nftables/proxier.go), [conntrack 용량](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/conntrack/sysctls.go), [UDP 정리](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/conntrack/cleanup.go), [Linux NAT 초기화/재사용](https://github.com/torvalds/linux/blob/adc218676eef25575469234709c2d87185ca223a/net/netfilter/nf_nat_core.c)
- [kubelet DNS](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/network/dns/dns.go), [glibc2.44 res_query](https://sourceware.org/cgit/glibc/tree/resolv/res_query.c?id=c3a3a9808ad3ab4a3336836833f83288b672ccbf), [musl1.2.6 lookup](https://git.musl-libc.org/cgit/musl/tree/src/network/lookup_name.c?id=9fa28ece75d8a2191de7c5bb53bed224c5947417), [CoreDNS1.15.0 응답 처리](https://github.com/coredns/coredns/blob/a6fde3fe339c6ec848447e11cc9796be8c97b4e0/plugin/kubernetes/handler.go)
- 현재 공식 웹도 직접 대조: [Cilium routing](https://docs.cilium.io/en/stable/network/concepts/routing/), [프록시·localhost 조건](https://kubernetes.io/docs/reference/networking/virtual-ips/), [resolv.conf](https://man7.org/linux/man-pages/man5/resolv.conf.5.html), [CoreDNS 플러그인](https://coredns.io/plugins/kubernetes/), [glibc 현재 릴리스](https://sourceware.org/glibc/), [CoreDNS 현재 릴리스](https://github.com/coredns/coredns/releases/tag/v1.15.0), [Geneve 규격](https://www.rfc-editor.org/rfc/rfc8926.html), [IPv6 fragmentation](https://www.rfc-editor.org/rfc/rfc8200.html)

## 확인 한계와 요약

- KEP-1024의 역사적 `3 retries` 산출 근거는 여전히 확인되지 않는다. 글이 그 한계를 명시하고 현재 기본 횟수·총 지연의 근거로 사용하지 않아 추가 수정/글 보류 사유는 아니다
- 최초 추정 nftables 블로그·CoreDNS records.go 경로의 404, glibc2.44 res_init.c/query.c의 일부 429·미러 비소스 응답은 기록에 남겨 제외했다. query.c는 동일 commit의 GNU GitLab mirror로 확보됐고, 필요한 기본값과 루프는 현행 header·send 소스·공식 매뉴얼에서 확인했다
- 최종 미해결 필수 수정 0 / 확인 필요 0 / 권장 0. 글 3편·SVG 6개 독립 검수 통과, 완료 편수 확정은 root의 통합 검증 후에만 가능하다


## 실제 최종 검증

- `npm run lint:post -- <이 배치 3편>`: exit 0, error 0 / warn 3
- `npm run lint`: exit 0, error 0 / warn 1 (기존 `src/app/layout.tsx:80` custom font 경고)
- `npm run build`: exit 0, TypeScript·정적 생성·postbuild 성공, 622 pages
- 원본 SHA-256·검수 후 글/SVG와 빌드 입력 hash 일치
- slug 유일성·시리즈 order 연속성·내부 링크·이미지 실존·SVG XML/접근성 메타 검사 통과
- `getAllPosts`·`getEssaysList`·`getSearchIndex` 실제 실행: 3편 모두 essays로 등록, 목록·검색 객체에 content 없음
- HTML 3개·SVG 6개 실제 export 및 `/my-blog/diagrams/` 참조·SVG 바이트 일치
- sitemap·llms 3편 반영, RSS는 기존 최신 20편 정책과 실제 출력 일치
- `git diff --check` 통과
- prebuild의 이번 CLAUDE.md 자동 통계 변경만 복원, Vault 원본 변경 없음
- build의 Node `DEP0205 module.register()` 및 로컬 TS 직접 import의 `MODULE_TYPELESS_PACKAGE_JSON` 경고는 남아 있으며 애플리케이션 설정을 범위 밖에서 바꾸지 않았다
- 클러스터 실습·통합 테스트·성능 실측·push·배포·시리즈 카드 등록: 실행 안 함

원시 로그·임시 근거 저장본: `/tmp/k8s-batch13/`
영구 재확인 경로는 위 글과 작성 기록의 공식 소스 URL이다

## 다음 대상

- `Phase 3-5 · Ingress 와 Gateway API · 한 오브젝트에 세 사람이 있었다.md` → `k8s-theory-ingress-gateway-api` (`k8s-theory-network` / 6)
- `Phase 3-6 · NetworkPolicy · 기본값을 뒤집는 스위치.md` → `k8s-theory-network-policy` (`k8s-theory-network` / 7)
- `Phase 3-7 · ANP 와 BANP · 정하지 않겠다고 적는 칸이 필요했다.md` → `k8s-theory-admin-network-policy` (`k8s-theory-network` / 8)
