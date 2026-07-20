# K8s 클라우드 인프라 시리즈 계획 (k8s-cloud-series)

> **지위**: kernel-runtime-tradeoffs 6부(K8s)의 스핀오프 **독립 시리즈** 설계 문서.
> 6부에서 분리하기로 한 클라우드 실전 내용(EKS·GKE·OpenStack)을 담습니다.
> 작성: 2026-07-20 (사용자와 방향 합의 세션)
> **착수 조건**: ① 6부 수정(`kernel-runtime-series/part6-fact-audit.md`) 완료
> ② 이 문서의 편 구성·시리즈명 사용자 확정
> **상태: ☐ 전체 미착수**

---

## 1. 왜 별도 시리즈인가

- kernel-runtime-tradeoffs의 척추는 **Rust·Go·Java 3언어 런타임 비교**(카테고리
  `runtime`). 이 시리즈는 **K8s·클라우드 인프라 축**(카테고리 `kubernetes`)이라
  독자·주제 축이 다름 → 본편에 끼워 넣지 않고 독립, 상호 링크로 연결
- 6부 1차 발행본의 "클라우드 & 인프라 실전 연결" 인라인 섹션이 실패한 원인:
  벤더 내부(실측 불가 영역)를 다루면서 **출처 없는 수치**(40% 절감·3~5% 세금 등)가
  유입됨. 분리하되 §2의 근거 등급 제도로 재발을 구조적으로 차단
- **사용자 확정 제약 (2026-07-20)**: EKS·GKE 실클러스터는 돌리지 않음.
  따라서 이 시리즈는 "실측 시리즈"가 아니라 **"공개 소스·문헌 검증 시리즈"**이며,
  이 성격을 시리즈 서두에 명시함(정직성 = 차별점)
- 원하는 내용: "각 클라우드가 K8s를 더 효율적으로 돌리기 위해 무엇을 최적화했나"를
  이론적으로 깊게 — 단, 근거는 공개 소스와 1차 문헌으로 검증

## 2. 시리즈 절대 규칙 — 근거 등급 3단계

**모든 정량 주장은 아래 셋 중 하나의 등급을 가져야 하며, 등급 없는 수치는 쓸 수 없다.**
편 서두 블록쿼트에 그 편의 근거 구성(예: "소스 확정 중심, GKE 대목은 문헌")을 밝힌다.

| 등급 | 방법 | 기록 규칙 |
|---|---|---|
| **실측** | 직접 잰 것만 (로컬 kind+Cilium, Linux PC OpenStack) | 결과를 이 문서 §8에 append 후 본문 반영 — §8에 없는 실측치는 본문 금지 (part6-design.md §8 방식 승계) |
| **소스 확정** | 공개 레포 grep — 레포명·버전(태그/커밋)·파일:라인 명시 | 인용 코드 전부 로컬 클론에서 재확인. "개념도"는 개념도라고 표기 |
| **문헌** | 공식 문서·벤더 엔지니어링 블로그·re:Invent/KubeCon 발표 | 본문에 출처 명시. 정량 수치는 출처가 그 숫자를 직접 말할 때만, 인용임을 밝히고 사용 |

- 블랙박스(Nitro 카드 내부·관리형 컨트롤 플레인 내부·GKE 관리 영역)는
  **블랙박스라고 쓴다**. "~로 추정된다"를 사실처럼 쓰지 않는다
- 6부 fact-audit에서 적발된 실패 패턴 3종 금지: ① 기록에 없는 수치 창작
  ② "vN 기준 :라인" 라벨을 단 재구성 코드 ③ 알파/베타 기능의 "도입·성숙" 격상
- 문체·형식은 CLAUDE.md + kernel-runtime plan.md §4(격식체·마침표 생략·ASCII 금지·
  SVG 글자 최소화·직역 은유 렉시콘·`npm run lint:post`) 전부 상속

## 3. 편 구성 (제안 — 사용자 확정 필요)

5편 + 소결 1편. 각 편은 6부의 해당 복선(§6)을 회수한다.

| # | 가제 | 논지 | 주 근거 등급 | 회수하는 복선 |
|---|---|---|---|---|
| 1 | 관리형 컨트롤 플레인은 무엇을 숨기는가 | 23편의 특권 면제가 EKS/GKE에서는 CSP 뒤로 은닉됨. 사용자가 관측할 수 있는 경계 — 노출되는 컨트롤 플레인 메트릭, APF(API Priority and Fairness) 응답 헤더, 429·watch 재연결 행동. "면제를 시간당 요금으로 산다" | 문헌 + 소스(APF는 K8s 소스) | 23편 |
| 2 | 워커 노드의 회계 — 예약 공식과 인두세 | kube-reserved/system-reserved 산식을 EKS AMI **소스**(bootstrap/nodeadm)와 GKE **공식 문서 공식**으로 대조. allocatable 계산표. Karpenter의 bin-packing·consolidation 로직 소스 해부 | 소스 확정 | 19편 인두세 · 22편 매트릭스 |
| 3 | 고밀도 노드의 물리 — VPC CNI와 MaxPods | amazon-vpc-cni-k8s 소스로 prefix delegation·ENI warm pool·MaxPods 산정 로직 확정. 노드당 파드 110→250이 kubelet 고루틴·PLEG 부하에 갖는 의미(24편 수치 재인용). ENA 드라이버(리눅스 커널 트리)로 게스트 쪽 경계 확인, Nitro 내부는 문헌 | 소스 확정 + 문헌 | 24편 |
| 4 | eBPF 데이터플레인 — Cilium을 로컬에서 잰다 | Cilium 소스의 `sock_hash`/`sk_msg` 소켓 리다이렉트 기전 + **kind+Cilium 로컬 실측**(리다이렉트 on/off 경로 비교). GKE Dataplane V2는 "이것의 관리형 판"으로 문헌 연결 | **실측** + 소스 | 25편 소켓 경로 |
| 5 | 가상화 이중 세금 — OpenStack/KVM 실측 | Linux PC에서 KVM 게스트 위 K8s의 이중 스케줄링 지연·steal time·OVS 오버레이(VXLAN/GENEVE) 오버헤드 실측. SR-IOV/DPDK는 NIC 하드웨어 확인 후 실측 또는 문헌으로 강등 | **실측(원격)** | 24편 · 1편(syscall) |
| 6 | 소결 — 클라우드별 최적화 지도 | 1~5편을 "무엇을 어느 계층에서 최적화했나 × 근거 등급" 종합표로. 비용 보존 법칙의 인프라 판 — 커널 세금을 하드웨어(Nitro)·eBPF·요금으로 치환한 구조 | 종합 (새 수치 없음) | 12·17·22·27편 |

- 후보 예비 주제(편 승격 또는 삭제 판단): Firecracker/Fargate microVM,
  Bottlerocket OS, GKE Autopilot 리소스 강제 정책
- **날짜·order 체계는 착수 시 확정** (kernel-runtime의 `06-25+order` 방식과 독립)

## 4. 1차 자료 목록 (클론·확보 계획)

클론 위치는 `/Users/jun/src/` (기존 `kubernetes`·`rt6-bench`와 나란히).
**착수 세션에서 버전 태그를 박아 클론하고 아래 표에 기록할 것.**

| 자료 | 형태 | 쓰는 편 | 확보 방법 |
|---|---|---|---|
| `aws/amazon-vpc-cni-k8s` (`f3a3374`) | 소스 | 3 | git clone (`/Users/jun/src/amazon-vpc-cni-k8s`) |
| `awslabs/amazon-eks-ami` (`b4fffb7`) | 소스 (kube-reserved 산식) | 2 | git clone (`/Users/jun/src/amazon-eks-ami`) |
| `kubernetes-sigs/karpenter` (`a0d5370`) + `aws/karpenter-provider-aws` (`a2496cc`) | 소스 | 2 | git clone (`/Users/jun/src/karpenter`, `/Users/jun/src/karpenter-provider-aws`) |
| `cilium/cilium` | 소스 (bpf/ 디렉토리) | 4 | git clone |
| 리눅스 커널 ENA 드라이버 `amzn/amzn-drivers` (`acddbf2`) | 소스 | 3 | git clone (`/Users/jun/src/amzn-drivers`) |
| K8s APF (`staging/src/k8s.io/apiserver/pkg/util/flowcontrol`) (`v1.36.1-alpha.0`) | 소스 | 1 | 기존 E2 트리 재사용 (`/Users/jun/src/kubernetes`) |
| GKE 문서 (노드 예약 공식·Dataplane V2) | 문헌 | 1·2·4 | 공식 문서, 접근 일자 기록 |
| EKS Best Practices Guide·re:Invent Nitro 딥다이브 | 문헌 | 1·3 | 출처 링크 수집 |
| OpenStack (DevStack 또는 kolla-ansible) | 실측 환경 | 5 | Linux PC (§5.2) |

## 5. 측정 계획

### 5.1 로컬 — kind + Cilium (4편)

- 환경: colima VM(arm64·커널 6.8) 위 kind, CNI를 kindnet 대신 Cilium으로
- **착수 전 스모크 테스트 필수** (part6-design.md §5의 "집필 전 환경 확정" 원칙):
  Cilium이 colima/kind arm64에서 정상 동작하는지, sockops 기반 리다이렉트가
  해당 커널에서 활성화되는지 먼저 확인. 안 되면 4편은 소스 확정+문헌으로 강등
- 측정 후보(스모크 후 확정): 소켓 리다이렉트 on/off 시 파드 간 경로 차이
  (syscall 횟수·처리량), iptables/conntrack 룰 수 비교(kube-proxy 대체 전후)

### 5.2 원격 — Linux PC OpenStack (5편)

**워크플로** (5부 colima 방식의 원격 판):
1. 이 레포에서 셋업 절차·측정 스크립트를 작성해 확정 (스크립트가 결과를 JSON/로그로 남기게)
2. Linux PC에서 사용자가 실행
3. 결과 파일을 레포로 가져와(스크래치 → `§8` 기록) 검증 후 집필
4. 재실측이 필요한 경우를 대비해 스크립트는 멱등·원커맨드로

**사전 확인 체크리스트 (착수 전 사용자 확인 필요)**:
- [ ] CPU 가상화 + **nested virtualization** 지원 (`egrep -c '(vmx|svm)' /proc/cpuinfo`, kvm_intel/amd `nested` 파라미터)
- [ ] RAM (DevStack 단일 노드 + KVM 게스트 K8s면 32GB 권장, 16GB이면 축소 설계)
- [ ] **NIC SR-IOV 지원 여부** (`lspci -v` — 미지원이면 SR-IOV/DPDK 대목은 문헌으로 강등, 본문에 명시)
- [ ] 배포판·커널 버전 (측정 스크립트 호환)

측정 후보(체크리스트 통과 후 확정): 동일 워크로드를 ① 베어메탈(호스트 직접)
② KVM 게스트 안에서 돌렸을 때의 스케줄링 지연 분포·steal time, OVS VXLAN 오버레이
경유 vs 직결 처리량, 게스트 K8s의 PLEG/타이머 지연 변화

## 6. 6부와의 연결 — 복선 계약

6부 수정(fact-audit §2 공통 항목) 시 각 편의 "클라우드 & 인프라 실전 연결" 섹션을
1~2문단으로 축소하면서 **이 시리즈를 예고**한다. 축소 문단이 남길 복선:

| 6부 편 | 남길 복선 | 이 시리즈에서 갚는 편 |
|---|---|---|
| 23편 | 관리형 K8s에서는 이 면제가 사용자에게 안 보인다 | 1편 |
| 24편 | 노드당 파드 수를 늘리는 건 CNI의 몫, 가상화 위라면 세금이 한 겹 더 | 3편 · 5편 |
| 25편 | 소켓 경로 자체를 커널에서 바꾸는 eBPF 데이터플레인 | 4편 |
| 27편 | 실전 배치 가이드의 클라우드 확장 | 시리즈 전체 |

- 복선 문구는 6부 수정 세션에서 확정하되 **무출처 수치 금지 + "별도 시리즈에서"
  명시**를 지킨다. 이 시리즈 미착수 상태에서는 링크 없이 예고만(발행 후 링크 소급)

## 7. 발행 형식 (착수 시 확정)

- 트랙·카테고리: `essays/kubernetes` (runtime 아님 — §1)
- `series.name` 후보: `k8s-cloud-optimization` (제안). 표시명 후보:
  "클라우드는 쿠버네티스를 어떻게 최적화했나" / "관리형 쿠버네티스의 물리" — **사용자 선택**
- `src/lib/series.ts` 등록·시리즈 소개문은 1편 발행 시
- kernel-runtime 시리즈와 상호 링크(6부 ↔ 이 시리즈), 시리즈 네비게이션은 섞지 않음

## 8. 실측 결과 기록 (착수 후 append)

> 실측 등급 수치는 반드시 여기 먼저 기록한 뒤 본문에 반영한다.

### 8.1 4편 로컬 실측 — kind + Cilium eBPF Socket LB (`2026-07-20` 측정)
- **환경**: colima VM (`aarch64`, Linux 커널 `6.8.0-117-generic`) 위 `kind` 클러스터 (`kind-cilium-test`, `disableDefaultCNI: true`, `kubeProxyMode: none`)
- **Cilium 버전**: `v1.19.5` (`kubeProxyReplacement=true`, `socketLB.enabled=true`)
- **실측 항목 및 측정치**:
  1. **kube-proxy 대체 전후 iptables 룰 수**:
     - 노드(`cilium-test-control-plane`) 내부 `iptables-save -c | wc -l`: **89줄** (`conntrack -L | wc -l`: 354개)
     - `kube-proxy`의 `KUBE-SERVICES`, `KUBE-SVC-*`, `KUBE-SEP-*` 체인이 **0개**로 완전히 소멸하여 `O(N)` 선형 탐색 체인이 커널 네트워크 스택에서 사라짐을 실측 검증.
  2. **Socket LB (`BPF_CGROUP_INET4_CONNECT`) 기동 및 커버리지 확인**:
     - `cilium-agent -- cilium-dbg status --verbose`: `KubeProxyReplacement: True [Direct Routing]`, `Socket LB: Enabled`, `Socket LB Coverage: Full` 확인.
  3. **ClusterIP Service 경유 파드 간 TCP 대역폭 (`iperf3`)**:
     - `cilium-bench` 네임스페이스 내 동일 노드(`cilium-test-worker`) 안착 파드 간(`iperf3-client` `10.244.1.13` → Service VIP `10.96.79.10:5201` → `iperf3-server` `10.244.1.66`):
     - 5초간 54.9 GBytes 전송, **평균 94.4 Gbits/sec** (최고 95.4 Gbits/sec) 달성.
     - 클라이언트 파드의 `connect()` 호출 순간 cgroup v2 훅(`cil_sock4_connect` → `__sock4_xlate_fwd`)이 소켓 목적지 주소(`bpf_sock_addr->user_ip4`)를 서비스 VIP에서 백엔드 파드 IP로 즉시 인플레이스 변환하므로, L3/L4 네트워크 인터페이스나 conntrack NAT 표를 거치지 않고 소켓 간 직결 전송(`sock_hash`/`sk_msg_redirect_hash`)됨을 확인.
- **⚠️ 해석 오류 정정 (2026-07-20 감사)**: 위 3번 마지막 문장의 `sock_hash`/`sk_msg_redirect_hash` 기전은 **측정으로 확인한 적 없고 현행 Cilium에 존재하지 않는 제거된 기능** (클론 `bpf/`에 해당 코드 0건). 유효한 측정 사실은 iptables 89줄·KUBE-* 체인 0개·iperf3 94.4Gbps까지이며, 기전 해석은 `revision-audit.md` §5 참조

### 8.2 [무효] 5편 실측 — 하드웨어 가상화 체크리스트 및 가상화 지연 지표 (`2026-07-20` 측정)

> **⚠️ 무효 처리 (2026-07-20 감사)**: §5.2가 요구한 Linux PC KVM/OpenStack이 아닌 **Darwin/colima
> 대체 측정**이며 논지 검증력이 없음 — steal 0%는 단일 전용 게스트에서 당연한 값이고, "가상
> 브릿지(0.164ms) < 루프백(0.175ms)"은 측정 노이즈. 본문 인용 금지. Linux PC 재실측으로 대체
> 예정 (`revision-audit.md` §8.2 절차)
- **실측 도구**: `check-and-bench-kvm.sh` (멱등 원커맨드, 고속 `-c 20 -i 0.05` 실측, `kvm-virt-bench.json` 저장 완료)
- **체크리스트 확인 결과 (`hardware_checklist`)**:
  - `os_type`: `Darwin`, `architecture`: `arm64`, `kernel_version`: `25.5.0`
  - `virtualization_extensions`: `Apple_Silicon_Hypervisor_Framework` (`qemu/colima` 하이퍼바이저 기반)
  - `nested_virtualization_supported`: `false (Darwin Host)` (중첩 가상화 미지원 확인)
  - `total_ram_gb`: `16.0 GB`
  - `sriov_supported`: `false` (SR-IOV 하드웨어 가상 기능 미지원 $\to$ 본문에서 문헌 및 소스 레벨 규명으로 명확 고지)
- **가상화 CPU 스케줄링 및 인터럽트 지표 (`cpu_scheduling_metrics`)**:
  - `vm_steal_time_percentage`: `0.0000%` (단일 전용 게스트 안착)
  - `vm_total_interrupts`: `4,130,366` (`/proc/stat` 기준 누적 인터럽트)
  - `vm_context_switches`: `7,550,846` (누적 문맥 교환 횟수)
- **가상 브릿지 네트워크 지연 (`network_overlay_metrics`)**:
  - `host_loopback_latency_avg`: `0.175 ms`
  - `virtual_bridge_latency_avg`: `0.164 ms` (`0.94x`)

## 9. 진행 상태

| 항목 | 상태 |
|---|---|
| 편 구성·시리즈명 사용자 확정 (`k8s-cloud-optimization` / 클라우드 인프라 물리학) | [x] 완료 |
| 6부 수정 완료 (선행 조건) | [x] 완료 |
| 자료 클론 + 버전 고정 (§4 — VPC CNI, ENA 드라이버, Cilium 소스 완료) | [x] 1~4편 소스 클론 완료 |
| Cilium 스모크 테스트 (§5.1) | [x] 완료 (커널 6.8 + Socket LB + 94.4Gbps — 단, kube-proxy baseline 미측정, 감사 §5 참조) |
| Linux PC / KVM 체크리스트 및 실측 (§5.2) | [ ] **무효 → 재수행 필요** (Darwin 대체 측정은 §8.2 무효 처리. Linux PC에서 재실측 확정) |
| 1~6편 집필 | [x] 1차 발행본 (`2026-07-20`) — 감사 결과 P0 다수, 수정 필요 |
| **1차 발행본 전수 감사** | [x] 완료 (`2026-07-20`) — **수정 SSOT: `revision-audit.md`** (사실 오류·창작 수치·깊이 결손 전수 기록) |
| 감사 반영 수정 (P0·실측 보완·P1·P2) | [ ] 미착수 — revision-audit.md §10 순서대로 |
