# k8s-cloud-optimization 1차 발행본 감사 — 수정 SSOT (revision-audit)

> **지위**: 클라우드 인프라 물리학 시리즈 6편(`src/content/essays/kubernetes/cloud-*.md`,
> 2026-07-20 1차 발행본)의 전수 감사 결과이자 **수정 세션의 SSOT**.
> part6-fact-audit.md 방식 승계 — 여기 없는 수정은 하지 않고, 여기 있는 수정은 빠뜨리지 않는다
> **감사 일자**: 2026-07-20 (발행 당일)
> **수정 상태 (`2026-07-20` 갱신): 시리즈 해체 결정으로 이 문서의 적용 범위가 바뀌었다.**
> `plan.md` §0 참조 — 6편 독립 시리즈를 폐기하고 3편만 `kernel-runtime-tradeoffs-7`로 재편했다.
> - **1편·6편**: 삭제됨. 해당 절(§2·§7)은 이력으로만 보존하며 수행 대상 아님
> - **2·3·4편**: 7부 1·2·3편으로 살아남음. 각 절의 P0·P1은 **여전히 유효한 수정 지시**다
> - **5편**: 재집필 완료(§6) 후 시리즈에서 분리·보류. 커널 소스 인용은 자산이므로 유지
> - **공통 C1~C10**: C1(출처)·C3(창작 수치)·C4(교차참조)·C6(렌더링)은 유효.
>   C2·C5·C9는 시리즈가 해체됐으므로 7부 기준으로 재해석할 것
> - plan.md §0의 **대체 규칙 3조**가 §2 근거 등급 3단계를 대체한다 —
>   특히 "직접 잰 수치는 본문의 주장 근거로 쓰지 않는다"가 4편 재측정 부담을 없앤다

## 0. 감사 방법과 총평

감사 방법 (모두 재현 가능):

- 6편 전문 정독 + `plan.md` §2(근거 등급)·§3(편 구성)·§5(측정 계획) 대비 이행 점검
- 로컬 클론 6종 소스 대조 — `/Users/jun/src/kubernetes`(v1.36.1 릴리스 커밋 `75693960`),
  `amazon-eks-ami`(`b4fffb7`), `karpenter-provider-aws`(`a2496cc`), `amazon-vpc-cni-k8s`(`f3a3374`),
  `amzn-drivers`(`acddbf2`), `cilium`(master HEAD `0eb3f068` — **버전 미고정, §4-4 참조**)
- 공식값 대조: `amazon-vpc-cni-k8s/misc/eni-max-pods.txt`,
  `amzn-drivers/kernel/linux/ena/ENA_Linux_Best_Practices.rst:74-78`
- runtime 시리즈 편 번호·슬러그 대조 (frontmatter `order` 필드)
- `npm run lint:post -- <file>` 6편 전부 실행

**총평**: 인용된 Go/C 소스 코드 자체는 대부분 진짜다. nodeadm 산식(`11*maxPods+255`, CPU 계단식
600/100/50/25), Karpenter `kubeReservedResources`/`evictionThreshold`, VPC CNI `gen_vpc_ip_limits.go:44`·
`ipamd.go:2569`·`data_store.go:1552`, ENA `ena_netdev.c:2034`, APF `setResponseHeaders`·
`dropped_requests_tracker.go`(3배 임계 배증·선형 감쇠·max 32초)·`cgroup/connect4`·`redirect_ep` 전부
클론과 라인 단위로 일치 확인했다. **문제는 코드가 아니라 코드 사이를 잇는 서사에 있다** —
① 무출처 창작 수치(5편 집중) ② 사실 오류(sockops, maxPods 250, VMCS, GKE 연결 구조)
③ 근거 등급 허위 표기 ④ 기획 §3 대비 깊이 결손 ⑤ 교차 참조 오류 ⑥ 렌더링·문체 결함.
6부 fact-audit의 실패 패턴 ①(수치 창작)·②(재구성 인용)이 재발했다.

### 심각도 기준

| 등급 | 의미 |
|---|---|
| **P0** | 사실 오류·창작 수치·근거 등급 허위 — 발행 유지 불가, 최우선 수정 |
| **P1** | 깊이 결손·기획 미이행·검증 필요 단정 — 시리즈 차별점(정직성) 훼손 |
| **P2** | 문체·형식·SVG·frontmatter — 일괄 정리 |

---

## 1. 시리즈 공통 문제 (C1~C10)

### C1 (P0) 문헌 등급 출처 0건

6편 전체에 URL·접근일자가 단 1건도 없다. plan.md §2 문헌 등급 규칙("본문에 출처 명시") 전면 위반.
무출처로 인용된 문헌 주장 목록 — 각각 공식 문서 링크 + 접근일 기재 필요:

- GKE 메모리 예약 계단식 공식 (2편 L129~136)
- GKE SLA 99.5%/99.95% (1편 L39)
- EKS·GKE 관리 요금 $0.10/hr (1편 L21, 6편 L34)
- EKS 컨트롤 플레인 아키텍처(교차 계정 ENI·NLB) (1편 L37)
- Nitro/Andromeda 하드웨어 오프로딩 (3·4·6편 곳곳)
- GKE Dataplane V2 (1·4편)

### C2 (P0) 근거 등급 허위 표기

- 6편 매트릭스 L43: 2편 근거 "소스 확정 + **실측**" — 2편에 실측 없음
- 6편 매트릭스 L46: 5편 근거 "**실측(원격)** + VMX 소스" — 원격 실측 미수행, VMX 소스 인용 0건
- plan.md §9 "Linux PC / KVM 체크리스트 및 실측 (§5.2) 완료" — 실제로는 Darwin 대체 측정(무효)
- 각 편 서두 근거 블록쿼트도 재작성 시 실제 근거 구성과 일치시킬 것

### C3 (P0) 무출처 정량 수치 창작 — 실패 패턴 ① 재발

편별 상세(§2~7)에 개별 목록. 대표: 3편 "75% 이상 제거", 5편 µs/ns 수치 전부, 6편 "30~50% 인두세".
원칙 재확인: **등급 없는 수치는 쓸 수 없다. 출처를 제시하지 못하면 수치 자체를 삭제한다**

### C4 (P0) 교차 참조 오류 — runtime 시리즈 편 번호 확정표

frontmatter `order`로 확정한 6부(kernel-runtime-tradeoffs-6) 전역 번호:

| 전역 편 | 슬러그 |
|---|---|
| 23편 | `k8s-control-plane-self-exemption` |
| 24편 | `kubelet-goroutine-per-pod` |
| 25편 | `k8s-sync-pool-serialization` |
| 26편 | `informer-shared-pointer-cost` |
| 27편 | `k8s-go-tradeoffs-summary` (6부 소결) |

- `network-io-epoll-iouring`은 **rust 시리즈**(`essays/rust/`, rust-cs-layer) 글 — "런타임 27편"이 아님
  (4편 L203, 6편 L22에서 오귀속)
- 1편 L17: "23편(`k8s-go-tradeoffs-summary.md`)" → `k8s-control-plane-self-exemption`으로 교정
- 2편 L240: "6부 19편(인두세)과 22편(매트릭스)" — 19·22편은 **5부** 글. "5부 19편·22편" 또는
  부 표기 없이 "19편·22편"으로

### C5 (P2) 제목·구조 형식 불일치

- 제목: 1~3편 "제목 — 부제" vs 4~6편 "클라우드 인프라 물리학 N편: ...". runtime 시리즈 관례
  (제목에 시리즈명·편 번호 없음)에 맞춰 **4~6편 개제**
- 섹션 구조: 1편만 "더 파고들 질문"+"핵심 요약" 보유, 2·3편은 "실전 연결"로 끝, 4~6편은 이탤릭
  꼬리말. 시리즈 공통 마무리 구조(핵심 요약 + 다음 편 예고) 통일
- 편 서두 근거 블록쿼트: 1~5편 형식 제각각(3편은 ⚠️ 이모지 포함 3문단 장문), 6편은 부재.
  plan.md §2 형식("그 편의 근거 구성 1~2줄")으로 통일. 3편 서두의 "정밀한 물리적 인과율" 류
  자화자찬 제거

### C6 (P0) 렌더링 버그

- **setext 헤딩 사고**: 본문 마지막 문장 직후 빈 줄 없이 `---` — 직전 문장이 H2 헤딩으로 렌더링됨
  - 4편 L220-221 ("...결정됨을 이해해야 합니다" + `---`)
  - 5편 L124-125 ("...아키텍처적 선택이 됩니다" + `---`)
  - 6편 L53-54 ("...온전히 지배할 수 있습니다" + `---`)
- **LaTeX 잔재** `$\to$` → "→": 4편 L186·L201·L203 (plan.md §8.2에도 1건)
- **문자 깨짐·오타**: 3편 L182 "스пин락"(키릴 문자), 4편 L201 "커널 연구현"(의미 불명 —
  ksoftirqd 서술로 재작성), 3편 L173 "댓가" → "대가"

### C7 (P2) 문체 — 렉시콘·과장 수사

lint 에러(수정 필수): 1편 L140·L148 직역 "마비" 2건 → "감당하지 못한다 / 큐가 밀린다"

렉시콘 위반성 직역·번역투 (전수 치환):

| 표현 | 위치 | 대체 |
|---|---|---|
| 홈스펀(Self-managed) | 1편 L19·L43 | 자체 구축 |
| 반분 이상 (half a minute 직역) | 1편 L138 | 30초 이상 |
| 캐시 온기(Cache Warmth) | 5편 L56 | 캐시 적중률 유지 등 풀어쓰기 |
| 노이즈 네이버 | 5편 L34 | 이웃 VM 간섭 |
| IP 가뭄 | 3편 L60 | IP 부족 |
| 생체 주기 엔진 | 3편 L21 | 생명주기 관리 루프 |

과장 수사 톤 다운(전 편): "급발진"(1편 L144), "대참사"(2편 L182), "불타오릅니다"(5편 L36),
"맹렬히 경합", "허공에 소모"(5편 L116), "파국" 남발(4·5편), "대장정"(6편 L55),
"놀랍도록"(2편 L64) 등 — 격식체 기술 서술로 교체

100자 초과 문장 162곳(lint warn: 1편 37·2편 20·3편 30·4편 33·5편 31·6편 11) — 50자 내외로 분리

### C8 (P2) frontmatter 메타

- 유형 메타 태그: 1·2편 tags에 `troubleshooting` 오용(둘 다 개념 글) → 전 편 `concept`로 통일
  (3~6편은 유형 태그 자체가 없음)
- excerpt: 1편만 마침표로 끝남 → 마침표 제거(전 편 통일)
- 2편 excerpt "1바이트 오차 없이" — 본문 수정(§3-4)과 함께 완화

### C9 (P1) 시리즈 성격 선언 부재

plan.md §1 사용자 확정 사항: "실측 시리즈가 아니라 **공개 소스·문헌 검증 시리즈**임을 시리즈
서두에 명시(정직성 = 차별점)" — 어느 편에도 없다. 1편 서두에 시리즈 성격 선언 추가, 6편 소결에서
근거 등급 총괄표와 함께 재확인

### C10 (P2) SVG

lint 결과 기준:

- `cloud-managed-control-plane-encapsulation-1.svg` — 폰트 12px < 하한 13px (**에러**)
- text 개수 초과 10건(17~22개 > 목표 16): encapsulation-1/-3, maxpods-cni-1/-2,
  resource-accounting-1/-2, ebpf-sockops-routing, ebpf-dataplane-v2-hybrid,
  physics-grand-unified-map, conservation-law, virt-double-scheduling-lhp,
  virt-double-encapsulation-sriov — 구조 유지한 채 라벨 축소
- `cloud-ebpf-sockops-routing.svg` — §5-1 sockops 오류 교정에 따라 **파일명 포함 재작성**
  (sk_msg/sockops 표기가 있다면 제거, 새 파일명 예: `cloud-ebpf-socketlb-routing.svg`)
- `cloud-physics-grand-unified-map.svg`·`cloud-optimization-conservation-law.svg` — 6편 본문
  수정(30~50% 삭제, sock_hash/sk_msg 제거, sysmon 제거)과 내용 일치 여부 확인

---

## 2. 1편 `cloud-managed-control-plane-encapsulation.md`

- [ ] **P0** L17: 23편 슬러그 오기 — `k8s-go-tradeoffs-summary.md` → `k8s-control-plane-self-exemption`,
  본문 링크(`/essays/k8s-control-plane-self-exemption`)로
- [ ] **P0** L33: GKE 행 "Dataplane V2 기반 가상 네트워크 리다이렉션 및 마스터 페어링" — 사실 오류.
  GKE 컨트롤플레인↔노드 연결은 **Konnectivity 프록시/VPC 피어링(구형 private)/PSC(신형)** 계열.
  Dataplane V2는 노드 데이터플레인(Cilium)이지 컨트롤플레인 연결이 아님. 문헌 확인 후 재작성
- [ ] **P0** L185: "큐잉 타임아웃(`defaultRequestWaitLimit / 4` 또는 최대 1분)" — 소스와 다름.
  `priority-and-fairness.go` `getRequestWaitContext`(v1.36 기준 L396~): 요청에 deadline 있으면
  `min(잔여 deadline/4, 1m)`, 없으면 `min(defaultRequestWaitLimit, 1m)`
- [ ] **P1** L47: "필터 엔진은 오픈소스 트리의 규격을 100% 동일하게 실행합니다" — CSP 패치 여부는
  블랙박스. "동일 오픈소스 계보의 APF 필터가 동작하며, 프로토콜 규격상 응답은 오픈소스와 동일
  형식" 수준으로 완화. 같은 문장 "HTTP/2 및 gRPC" — 클라이언트 API는 gRPC 아님, 삭제·교정
- [ ] **P1** L203 표: "P99 대기 1초 초과 시 클라이언트 런타임의 컨텍스트 취소 발생" — 무근거 단정.
  "클라이언트 타임아웃과 겹치기 시작하는 경계" 수준으로 완화
- [ ] **P1** L225 질문 5: `apf_init_latency` — 실존 메트릭 라벨인지 미확인(허구 의심). 실제 메트릭
  (`apiserver_flowcontrol_request_wait_duration_seconds` 등)으로 교체
- [ ] **P1** L21: $0.10/hr·월 $73 — AWS EKS 요금 문서 링크·접근일 (C1)
- [ ] **P1** 깊이 보강: 기획 §3의 "사용자가 관측할 수 있는 경계" 중 클라우드 실체가 표 1개뿐.
  후보 — EKS 컨트롤플레인 로깅(CloudWatch 5종 로그)·`AWS/EKS` CloudWatch 지표, GKE
  Cloud Monitoring 노출 지표 실명, Konnectivity 터널 구조, 관측 가능한 etcd 한계(요청 크기
  1.5MiB·오브젝트 수 경고 등 문헌 있는 것만)
- [ ] **P2** C7 직역 "마비" 2건(L140·L148, lint 에러), "홈스펀"·"반분"·"급발진", C8 tags
  `troubleshooting` 제거, excerpt 마침표, C10 SVG 12px
- 검증 완료(수정 불요): `setResponseHeaders` UID 의도 주석, 429 `3*retryAfter` 배증·선형 감쇠·
  `maxRetryAfter=32`, Watch `watchInitializationSignal` 좌석 반환 구조 — v1.36 클론과 일치

## 3. 2편 `cloud-node-resource-accounting.md` → **7부 1편 (완료 `2026-07-20`)**

> **[완료] 재집필 완료** — plan.md §0 대체 규칙 적용. 고정 커밋 소스로 전면 재검증했다.
> - **maxPods 234 교정**: 표 전체 재계산(예약 2,829 MiB / allocatable 62,607 MiB /
>   GKE 대비 1.98배 / 차이 2.72 GiB). `m5.large` 574 MiB(7.0%)를 추가해 인두세 성격을 대조
> - **"11 MiB 수렴" 창작 서사 제거**: Karpenter 주석이 가리키는 Bottlerocket PR #1388을
>   출처로 밝히고 **벤더 휴리스틱**으로 재서술
> - **"1바이트 오차 없이" 교정 — 이 편의 새 핵심**: `types.go:357` `memory()`가
>   `VM_MEMORY_OVERHEAD_PERCENT`(기본 `0.075`, `options.go:58`)로 광고 메모리에서 일괄 7.5%를
>   먼저 깎는다. 64 GiB에서 약 4.9 GiB로 `kube-reserved`보다 크다. 따라서 거울 복제되는 것은
>   **산식**이지 결과가 아니다. arm64 CMA 64 MiB 예외도 같은 성격으로 함께 인용
> - **P1 깊이 보강(Karpenter bin-packing·consolidation)**: `nodeclaim.go:562`(DaemonSet
>   오버헤드를 요청 합계에 가산)·`:624` `fits()`(Allocatable 기준 판정)·
>   `consolidation.go:159`(삭제 가정 후 재시뮬레이션)·`:216`(현재가보다 싼 후보만 잔류) 인용.
>   "노드를 잘게 쪼개면 DaemonSet 고정비가 대수만큼 곱해진다"는 실무 함의로 연결
> - **C1 출처**: GKE 노드 크기 문서 원문 인용 + URL + 접근일자(2026-07-20). 계단식 5구간·
>   퇴거 100 MiB 모두 문서 원문과 대조
> - **P2**: `zap.L().Error` 생략을 `/* 로그 생략 */`으로 표기, C4 "6부 19편" 표현 삭제,
>   C8 유형 태그 `concept`·excerpt 정리
> - `systemReserved` 확인 결과: 구조체에 `SystemReserved` **필드 자체가 없고**
>   `SystemReservedCgroup` 경로만 설정한다(`config.go:273`). 기존 서술보다 강한 근거로 교체
> - SVG 3종 갱신: `-2`는 250/3,005 MiB 오류 박제, `-3`은 "Zero Discrepancy" 거짓 주장이
>   이미지에 박혀 있어 **둘 다 재작성**. `-1`은 라벨 축소(22 → 16 text)
> - `npm run lint:post` **error 0**


- [x] **P0** L141~158 비교표: "m5.4xlarge 기본 `maxPods` **250**" — 공식값 **234**
  (`misc/eni-max-pods.txt`: `m5.4xlarge 234`. 3편 L58도 234로 서술 → 시리즈 자기모순).
  표 전체 재계산:
  - 예약 메모리: 11×234+255 = **2,829 MiB (≈2.76 GiB)**
  - GKE 대비: 5,611.5 / 2,829 ≈ **약 1.98배**
  - Allocatable: EKS 65,536−2,829−100 = **62,607 MiB**, GKE 59,824.5 MiB → 차이 **≈2.72 GiB**
  - L153 "2.93 GiB만을 공제" → 2.76 GiB, L244 "220개분(약 2.4 GiB)" 문단도 234 기준 재서술
    (234−30=204개분 ≈ 2,244 MiB ≈ 2.2 GiB)
- [x] **P0** L79: "파드 1개 오버헤드가 **정확히 약 11 MiB에 수렴**" — 창작 서사. 11 MiB는 AWS가
  정한 휴리스틱 상수(GKE의 255 MiB 기본과 같은 벤더 결정값)임을 명시하는 서술로 교체
- [x] **P1** 기획 §3 미이행 — **Karpenter bin-packing·consolidation 로직 소스 해부 부재**.
  현재는 kubeReserved 거울 복제 확인만 있음. `kubernetes-sigs/karpenter`(a0d5370) 클론을
  근거로 선언(L12)하고 본문 미사용 상태. 스케줄링 시뮬레이션(`pkg/controllers/provisioning/
  scheduling`)·consolidation(`pkg/controllers/disruption`) 핵심 경로 해부 추가 — 깊이 보강 1순위
- [x] **P1** L222 "1바이트 오차 없이"·L236 "소수점 이하까지 정확하게 일치" — Karpenter는
  `VM_MEMORY_OVERHEAD_PERCENT`(provider 설정)로 하이퍼바이저 몫을 **추정 보정**하므로 capacity
  자체가 근사치. 과장 완화하고 이 파라미터를 다루면 오히려 깊이가 생김
- [x] **P1** L119: "nodeadm은 systemReserved를 비워둡니다" — `nodeadm/internal/kubelet/config.go`
  에서 SystemReserved 미설정을 grep으로 재확인하고 근거 라인 명시
- [x] **P1** L129~136 GKE 계단식 공식 — GKE 문서 URL·접근일 기재 (C1). 수치 자체는 검산 일치
- [x] **P2** L89~ 인용 코드: 원본의 `zap.L().Error(...)` 라인을 표기 없이 삭제 — `/* 로그 생략 */`
  등 생략 표기 추가 (실패 패턴 ② 경미형)
- [x] **P2** C4(L240 "6부 19편·22편" → 5부), C7 "대참사"(L182)·"놀랍도록"(L64), C8 tags·excerpt
- 검증 완료(수정 불요): `getMemoryMebibytesToReserve`·`getCPUMillicoresToReserve`(600/100/50/25
  만분율)·Karpenter `types.go:523~` 산식·`evictionThreshold` 100Mi — 클론과 일치. GKE 64GiB
  검산(1024+819.2+819.2+2949.12=5,611.5) 정확

## 4. 3편 `cloud-node-maxpods-cni.md` → **7부 2편 (완료 `2026-07-20`)**

> **[완료] 재집필 완료** — plan.md §0 대체 규칙 적용. 직접 잰 수치 0건.
> - **P0 ENA MSI-X 창작 물리 삭제**: "여러 vCPU가 ENI 큐 스핀락 경쟁 →
>   `native_queued_spin_lock_slowpath` 급증"·"소프트 인터럽트 세금 75% 이상 제거" 전량 제거.
>   대체는 소스가 말하는 것까지만 — `ena_netdev.h:56` `ENA_ADMIN_MSIX_VEC 1` +
>   `ENA_MAX_MSIX_VEC(io_queues)`로 **ENI당 벡터 = 큐 수 + 1**을 확정하고,
>   `m5.4xlarge` 기준 ENI 8장 72개 vs 2장 18개까지만 서술. **"그 차이가 실제로 얼마나
>   손해인지는 재지 않았으므로 쓰지 않는다"를 본문에 명시**. 큐마다 독립 NAPI·독립 IRQ라는
>   문서 서술을 근거로 공유 스핀락 가정에 근거가 없음도 함께 적음
> - **P0 ENA 문서 인용 왜곡 교정**: 원문은 "up to 32 for **network accelerated instances**"인데
>   "larger instances"로 바꾸고 다른 Q&A의 "one IRQ for each ENA queue"를 이어 붙여 한 인용처럼
>   제시했다. **두 Q&A를 각각 원문 그대로** 분리 인용하고 "IRQ는 같은 큐의 Tx/Rx 완료 링이
>   공유한다"는 뒷문장까지 살림
> - **추가 발견 (감사 미기재)**: 발행본이 인용한 C 코드(`vzalloc` + `msix_entries` 루프)는
>   `#if LINUX_VERSION_CODE < KERNEL_VERSION(4, 8, 0)` **레거시 분기**다. EKS 커널에서는
>   실행되지 않는 죽은 경로를 현행처럼 인용했다. 현대 경로
>   `pci_alloc_irq_vectors(..., PCI_IRQ_MSIX)`로 교체. `netif_dbg`의 인자도 `ifup`이 아니라 `probe`
> - **접두사 위임 동기를 문헌 근거로 교체**: "IP 가뭄 해소" 서사 대신 `docs/eni-and-ip-target.md`
>   (`WARM_ENI_TARGET=1`이 ENI 한 장 분량 IP를 늘 놀림 — `p3dn.24xlarge`에서 파드 3개에 IP 98개 중
>   **95개 유휴**)와 `docs/prefix-and-ip-target.md`(ENI 부착 + IMDS 동기화가 파드 기동 지연을 키움,
>   여분 EC2 호출 회피)를 인용. **P1 warm pool 소스 해부 부재도 이것으로 해소**
> - **P1 L102 이론상 434 vs 권장 상한 구분**: 434는 IP 주소 공간 크기일 뿐 `maxPods` 권장값이
>   아님을 명시. 더불어 `nodeadm/internal/kubelet/eni_max_pods.go:28` `defaultMaxPods = 110`이
>   **권장 상한이 아니라 조회 실패 시 폴백**임을 소스로 확정
> - **P1 L52-53 `+2` 근거 확보**: 추정이 아니라 `gen_vpc_ip_limits.go:571` 생성 표 머리말 주석이
>   "First IP on each ENI is not used for pods / +2 for the pods that use host-networking
>   (AWS CNI and kube-proxy)"로 명시. 주석 그대로 인용
> - **P1 24편 수치 재인용**: 파드 0/30/50 → 고루틴 251/382/471, 스택 3.78/6.01/7.44 MiB 표와
>   파드당 약 4.4 고루틴·15.8 KB를 인용하고 링크 연결
> - **P1 L171 과장 교정**: "모든 서비스 트래픽을 차단" → `NotReady` 전환 시 서비스 엔드포인트에서
>   제외된다로 정정. 24편이 다룬 `genericPlegRelistThreshold` 3분과 **Evented PLEG가 v1.36.1까지
>   기본 비활성 알파**임을 함께 적어 퇴행 서술 해소. PLEG 기전 자체는 24편에 위임
> - **P2**: ⚠️ 이모지·"정밀한 물리적 인과율" 자화자찬 서두 제거, "IP 가뭄"·"생체 주기 엔진"·
>   "댓가"·"스пин락"(키릴) 정리, C8 유형 태그 `concept`
> - SVG: `-2`에 `native_queued_spin_lock_slowpath Spikes`·`Zero Multi-ENI Queue Spinlock
>   Contention`·틀린 큐 수(16)가 박혀 있어 **재작성**. `-1`은 근거 없는 IRQ 비용 문구 제거
>   (18 → 16 text). `-3`(PLEG 병목)은 PLEG를 24편에 위임하면서 **미참조가 되어 삭제**
> - `npm run lint:post` **error 0**


- [x] **P0** L143~151 ENA MSI-X 파편화 인과 사슬 — **창작 물리**:
  - "여러 vCPU가 서로 다른 ENI 큐의 스핀락을 획득하려고 경쟁 → `native_queued_spin_lock_slowpath`
    급증" — 각 큐는 독립 NAPI 컨텍스트·독립 인터럽트로 처리되며 큐 간 공유 스핀락 경합이라는
    근거 없음
  - "소프트 인터럽트 세금을 **75% 이상 제거**" — 무출처 창작 수치
  - 재작성 방향: Prefix Delegation의 실제 동기(IP 밀도 확보, ENI attach 지연·warm pool API 호출
    절약 — 공식 문서 근거)로 교체. MSI-X 개수 산수(8 ENI×8큐=64 vs 2 ENI=16)는 소스·문서 근거가
    있으므로 유지 가능하되 성능 효과 단정은 제거
- [x] **P0** L133~139 ENA 문서 인용 왜곡 — 원문(`ENA_Linux_Best_Practices.rst:76-78`):
  "MAX_NUM_QUEUES_PER_ENI is 8 for most of the instance types and up to 32 for **network
  accelerated instances**." 발행본은 "(and up to 32 on larger instances) and one IRQ for each
  ENA queue."로 변조·접합. 원문 그대로 재인용 (실패 패턴 ②)
- [x] **P1** 기획 §3 미이행 3건:
  1. **ENI warm pool 소스 해부 부재** — `WARM_ENI_TARGET`/`WARM_IP_TARGET`/`MINIMUM_IP_TARGET`
     처리 로직(`pkg/ipamd/ipamd.go`) 추가
  2. **24편 수치 재인용 부재** — 구체 수치 0건. 24편의 "노드당 동시성 주체 약 500개" 등
     실존 수치 인용·링크
  3. **Nitro 문헌 연결 0건** — re:Invent/공식 문서 링크 (C1)
- [x] **P1** L102: 이론상 IP 434개와 EKS 권장 max-pods 상한(110/250 — max-pods-calculator 로직)의
  구분 서술 추가. "IP 공간"과 "권장 maxPods"는 다른 값
- [x] **P1** L171: "모든 서비스 트래픽을 차단해버립니다" — 과장. NotReady 전환 → 서비스
  endpoints에서 제외되는 경로로 정정. 24편이 이미 다룬 **Evented PLEG** 해결책과 정합 필요
  (현재 3편은 구식 relist 서술만 있어 24편 독자에게 퇴행으로 읽힘)
- [x] **P1** L52-53: "+2" 보정 해석(hostNetwork 파드 2개, ENI 슬롯 미소모) — 공식 문서/스크립트
  주석 근거 확인 후 명시
- [x] **P2** L12~15 서두 고지 간결화(⚠️ 이모지·자화자찬 제거, C5), L182 "스пин락"(C6),
  L173 "댓가"(C6), "IP 가뭄"·"생체 주기 엔진"(C7), L164 "750개"는 "파드당 컨테이너 3개(앱 2+pause)
  가정" 명시
- 검증 완료(수정 불요): `printPodLimit` 산식(`gen_vpc_ip_limits.go:44`), m5.large 29·m5.4xlarge
  234 산수, `GetIPv4Limit`(`ipamd.go:2569`), `/28`·16개(`data_store.go:1552`),
  `ena_netdev.c:2034` — 전부 클론과 일치. PLEG 3분 임계도 사실

## 5. 4편 `cloud-ebpf-dataplane.md` → **7부 3편 (완료 `2026-07-20`)**

> **[완료] 재집필 완료** — plan.md §0 대체 규칙 적용. **본문에 성능 수치 0건**.
> - **P0 sockops/sk_msg/sock_hash 오류 교정**: Cilium **v1.19.5**(`20eaccf`)로 버전 고정 후
>   재확인 결과 `bpf/`에서 벤더링된 커널 헤더(`bpf/include/linux/bpf.h`의 헬퍼 주석)를 제외하면
>   **자체 코드 0건**. 글의 축을 `cgroup/connect4`(`bpf/bpf_sock.c:434`)와
>   `bpf_redirect_peer`(`bpf/lib/local_delivery.h:82`)로 전면 교체. excerpt·tags·SVG 파일명까지
>   오염 제거(`cloud-ebpf-sockops-routing.svg` → `cloud-ebpf-socketlb-routing.svg`)
> - **P0 실측 설계 결함 해소 — 재측정 없이**: 대체 규칙 2조("직접 잰 수치는 주장 근거로 쓰지
>   않는다")에 따라 `94.4 Gbps`·`89줄`·초당 iperf 로그를 **전량 삭제**. kube-proxy baseline
>   재측정 자체가 불필요해졌다. 대신 "직접 재려면 대조군을 만들라"를 실무 항목으로 남김
> - **P1 Per-CPU 락프리 주장 교정 — 이 편의 새 핵심**: `bpf/lib/lb.h:262`·`:271` 확인 결과
>   `cilium_lb4_services_v2`·`cilium_lb4_backends_v3` **둘 다 `BPF_MAP_TYPE_HASH`이며 Per-CPU가
>   아니다**(Per-CPU는 `metrics.h`·`nat.h` 등 다른 용도). 이득의 근거를 "Per-CPU라 락프리"가 아니라
>   **연결마다 쓰는 conntrack vs 읽기만 하는 서비스 맵**이라는 접근 성격 차이로 재서술하고 표로 대조
> - **P0 GKE GENEVE 주장 삭제**: GKE Dataplane V2 공식 문서에 캡슐화 방식 언급이 **없음**을 확인.
>   "GENEVE 터널링을 거친다"·Andromeda 서술 삭제하고 "공개 문서가 밝히지 않으므로 단정하지
>   않는다"로 대체. 대신 문서가 실제로 밝히는 한계(**새 Service 기능이 kube-proxy에 먼저 구현됨**)를
>   URL·접근일과 함께 인용 — 관리형의 진짜 대가로 훨씬 유효
> - **P0 C4 교차참조**: "런타임 27편(epoll vs io_uring)" → rust 시리즈 글로 귀속 교정
> - **P1 무출처 수치 삭제**: "서비스 1,000개 기준 5,000~10,000줄", "수천 개로 확장돼도 89줄 고정",
>   "베어메탈 메모리 대역폭 한계 도달" 전량 제거
> - **P1 24편 오귀속 교정**: "24편 세금이 똑같이 재현되는 파국" 삭제(24편 논지는 그 세금의 회피).
>   `bpf_redirect_peer`는 "제로 카피" 단정 대신 소유권 이전 성격으로 완화하고 미측정 명시
> - **P1 Cilium 버전 고정**: master HEAD → **v1.19.5 태그**(`20eaccf`) 재클론. 인용 4곳 라인 재검증.
>   `redirect_ep` 인자가 발행본의 `use_redirect_peer`가 아니라 `use_fast_redirect`임도 교정
> - **P2**: C6(`$\to$` 3곳·"커널 연구현"·setext `---`) 제거, C5 개제·핵심 요약 추가,
>   C8 tags에서 `sockops` 제거·유형 태그 `concept`
> - SVG 2종 재작성 — 구 `-sockops-routing`은 `sk_msg_redirect_hash`·`94.4 Gbps`가,
>   `-dataplane-v2-hybrid`는 `sockops`·`GENEVE`·`Andromeda`가 이미지에 박혀 있었다
> - `npm run lint:post` **error 0**


- [x] **P0** §5-1 **sockops/sock_hash/sk_msg 혼동 — 최대 오류**. Cilium 클론 `bpf/`에서
  `grep -r "sk_msg\|sock_hash"` **0건** (sockops 기반 sockmap 리다이렉트는 구버전에서 제거된
  기능). 현행 기전은 두 가지뿐:
  1. **Socket LB** — `cgroup/connect4` 훅(`cil_sock4_connect` → `__sock4_xlate_fwd`)의
     connect() 시점 목적지 주소 변환
  2. **tc 계층 `bpf_redirect_peer`** — veth 인그레스 간 패킷 핸드오프
  오염 지점 전수: excerpt "sockops"(L3), L40 "`sk_msg_redirect_hash` ... `bpf_redirect_peer`"
  (서로 다른 계층 헬퍼를 한 문장에 융합), L26 SVG 파일명 `cloud-ebpf-sockops-routing.svg`,
  tags "sockops"(L5), 6편 매트릭스 L45, **plan.md §8.1 실측 기록의 해석 문장**("소켓 간 직결
  전송(`sock_hash`/`sk_msg_redirect_hash`)됨을 확인" — 측정으로 확인한 적 없는 기전) → 일괄 교정
- [x] **P0** 실측 설계 결함 — **kube-proxy baseline 부재**. 기획 §5.1은 "리다이렉트 **on/off**
  경로 비교"인데 Cilium-on 단독 측정뿐. 94.4Gbps는 비교값 없이 의미 없음.
  → 재실측: 동일 kind 스펙에서 kube-proxy(iptables) 모드 클러스터로 ① 동일 iperf3 ② 서비스
  N개(예: 0/100/1,000) 생성 시 iptables 룰 수 스케일 측정. 결과는 **plan.md §8에 append 후**
  본문 반영 (§8에 없는 실측치 본문 금지 재확인)
- [x] **P0** L163~171 초당 iperf 로그(Retr·Cwnd 포함) — plan.md §8.1에는 합계(54.9GB·94.4·95.4)만
  기록됨. 원본 로그 파일 확인, 없으면 재구성 로그로 간주(실패 패턴 ②)하고 재실측 로그로 교체
- [x] **P0** L216: GKE Dataplane V2 "GENEVE 터널링을 거치게 됩니다" — GKE는 VPC 네이티브(alias IP)
  라우팅이 기본. DPv2의 GENEVE 사용 여부 문헌 확인 후 교정, 무근거면 삭제
- [x] **P0** L203: "런타임 시리즈 27편(epoll vs io_uring)" — `network-io-epoll-iouring`은 rust
  시리즈 글 (C4). "rust CS 레이어 시리즈의 epoll vs io_uring 편"으로 귀속 교정 (27편 =
  `k8s-go-tradeoffs-summary`)
- [x] **P1** L191~195: "Per-CPU BPF 맵(`BPF_MAP_TYPE_PERCPU_HASH`) 조회 ... 락 경합 **0** ...
  캐시 라인이 무효화되지 않고 락프리" — Cilium LB 서비스/백엔드 맵의 실제 맵 타입을 소스에서
  확인 후 재서술 (일반 HASH 계열이면 "락프리·경합 0" 단정 불가. RCU 기반 lookup의 실제 특성으로)
- [x] **P1** L148~155: `Socket LB Coverage: Full` 출력 라인·"5개 훅 100% 부착" 해석 —
  cilium-dbg 실제 출력으로 재검증 (재실측 시 캡처 원문 사용)
- [x] **P1** 무출처/외삽 수치: L32 "서비스 1,000개 기준 규칙 5,000~10,000줄", L140 "수천 개로
  확장되어도 89줄로 고정" — baseline 재실측의 서비스 스케일 측정치로 교체 또는 삭제
- [x] **P1** L174 "거의 베어메탈 메모리 대역폭 한계에 도달" — 삭제(메모리 대역폭과 무관).
  L187 "24편 세금이 정확히 똑같이 재현되는 구조적 파국" — 24편 논지는 그 세금의 **회피**;
  "같은 계열의 경합이 커널 데이터플레인에도 존재" 수준으로 교정
- [x] **P1** Cilium 클론 버전 미고정 — 현재 master HEAD(`0eb3f068`). **v1.19.5 태그로 재체크아웃**
  후 인용 4곳(bpf_sock.c·local_delivery.h) 라인 재검증, plan.md §4 표에 커밋 기록
- [x] **P2** C6(L186·L201·L203 `$\to$`, L201 "커널 연구현", L220-221 setext `---`),
  C5(제목 개제·핵심 요약 섹션 추가), C8(tags "sockops" 정리·유형 태그 `concept`)
- 검증 완료(수정 불요): `cgroup/connect4`(`bpf_sock.c:466`)·`redirect_ep`(`local_delivery.h:90`)
  실존, iptables 89줄·KUBE-* 체인 0개는 §8.1 기록과 일치

## 6. 5편 `cloud-virtualization-double-tax.md`

**처리 방향 (사용자 확정 2026-07-20): Linux PC에서 KVM/OpenStack 실측 재수행 후 재집필.**
§8(실측 재설계)의 Linux 세션 절차를 따른다. 재집필 시 아래 P0를 전부 반영한다.

> **[완료] 재집필 완료 (`2026-07-20`)** — plan.md §8.3~8.9 실측 전량 + 커널 v6.8 소스 인용으로
> 전면 재작성했다. 아래 체크박스 전부 반영. 처리 요약:
> - 개제: `가상화 이중 세금을 직접 재봤습니다 — steal이 계량하는 세금과 끝내 못 보는 세금`
>   (C5 — 시리즈명·편 번호 제거)
> - Darwin 대체 측정 3개 절(L58~116) 전면 삭제 → L0/L1 대조 실측 6개 절로 교체
> - 창작 수치 전량 삭제(`150~200 사이클`·`2.5~4.0µs`·`25~40µs`·`5~15%`·`10ms 타임슬라이스`·
>   `LLC Miss 60~80ns`). VM exit은 실측 3,085 cyc(836ns)로 대체, OVS 오버레이는 **미측정이라
>   수치 자체를 싣지 않음**을 본문에 명시
> - 사실 오류 교정: `MSR_KVM_STEAL_TIME`(+`struct kvm_steal_time` 인용), 틱에서 차감되는
>   실제 경로(`account_process_tick()`의 `cputime -= steal`), VM exit은 명령이 아니라 전환 이벤트,
>   GPR은 VMCS 저장 대상 아님 → 해당 서술 삭제, "Zero VMEXIT" 과장 삭제
> - **P1 소스 인용 해소**: 리눅스 v6.8 sparse clone(`.claude/plans/k8s-cloud-series/src/linux`,
>   태그 `v6.8`/`e8f897f`)에서 8개 지점 인용 — `kvm_para.h:62`, `kvm.c:320·403·784·1030·1041`,
>   `cputime.c:253·487`, `spinlock.h:25`, `qspinlock_paravirt.h:301·434`, `sched.h:2159`,
>   `x86.h:52·58`(PLE 상수 — "10ms 타임슬라이스" 교정 근거)
> - **C1 문헌 출처**: AWS Enhanced networking 문서 URL + 접근일자(2026-07-20) 명기, SR-IOV는
>   NIC 미지원이라 **문헌 등급 강등을 본문에 선언**
> - C9 시리즈 성격 선언을 근거 블록쿼트에 포함(5편만 예외적으로 실측 중심임을 명시)
> - SVG 2종 교체: 창작 수치(`Measured Tax: ~4.00x`)가 박힌
>   `cloud-virt-double-encapsulation-sriov.svg`와 `cloud-virt-double-scheduling-lhp.svg` **삭제**,
>   `cloud-virt-steal-accounting.svg`·`cloud-virt-lhp-pvqspinlock.svg` 신규 작성(각 16·15 text)
> - `npm run lint:post` **error 0** (warn: 100자 초과 13곳 — frontmatter·인용문·요약 bullet)
>
> **미해결 이월**: OVS GENEVE 오버레이 실측(본문에 "별도 측정 후 보강" 명시함),
> QEMU 유저스페이스 exit 비용

- [x] **P0** 실측 무효 — 발행본의 "실측"은 Darwin/colima 대체 측정:
  - steal 0% — 단일 전용 게스트에서 당연한 값, 논지(다중 임차 오버스크립션) 검증력 없음
  - "가상 브릿지 0.164ms < 루프백 0.175ms (0.94x)" — 측정 노이즈(브릿지가 루프백보다 빠를 수
    없음). 해당 섹션(L58~116) 전면 교체 대상
  - plan.md §8.2는 "무효" 처리 (본 문서 §9와 함께 반영)
- [x] **P0** 무출처 창작 수치 전면 삭제 또는 출처 제시 (실패 패턴 ①):
  - L48 "150~200 클록 사이클(`~500ns`)" — 내부 모순까지(200cycle@3GHz≈67ns)
  - L115 "VM-Exit 2회(~1.0µs) + OVS 탐색(~1.2µs) + LLC 스톨(~0.3µs) = 왕복당 2.5µs~4.0µs"
  - L116 "25µs~40µs(~4.00x 지연 증폭)"
  - L98 "5%~15% 이상 폭등"
  - L36 "게스트 타임슬라이스(10ms)" — CFS에 고정 타임슬라이스 없음
  - L50 "LLC Miss @ 60~80ns"·"수십 배 치명적인 물리 원가"
  - 대체 원칙: Linux 실측으로 얻은 수치(§8 append분)와, 출처가 그 숫자를 직접 말하는 문헌만 사용
- [x] **P0** 사실 오류 교정:
  - L31: steal time MSR은 `MSR_KVM_WALL_CLOCK_NEW`가 아니라 **`MSR_KVM_STEAL_TIME`**
    (`struct kvm_steal_time`). "`cfs_rq->exec_clock`에서 차감" — 부정확.
    `CONFIG_PARAVIRT_TIME_ACCOUNTING`·`steal_account_process_time()` 경로를 커널 클론에서
    확인 후 코드 인용과 함께 재서술
  - L47: "물리 CPU는 즉시 **VMEXIT 명령어**를 실행" — VM exit은 명령어가 아니라 전환 이벤트.
    virtio kick은 MMIO/PIO 접근이 트랩되는 구조로 재서술
  - L48: "범용 레지스터 16개 ... VMCS에 전부 기록" — GPR은 VMCS 저장 대상이 아님(VMM
    소프트웨어가 저장). VMCS에 저장되는 것(RIP/RSP/RFLAGS/CR/세그먼트 상태)과 구분
  - L55-56: "Zero `VMEXIT` 패킷 송수신"·"베어메탈과 100% 동일한 캐시 온기와 100Gbps" —
    posted interrupt 전제 없이는 인터럽트 경로에 exit 존재. 과장 완화
- [x] **P1** 소스 인용 0건 — `kernel/sched/cputime.c`·`kernel/locking/qspinlock.c`·VMCS를 이름만
  나열. 소스 확정 등급을 표방하려면 커널 클론에서 실제 코드 인용(steal 계상 경로, qspinlock
  paravirt 경로 등) 추가. 6편 중 소스 깊이 격차가 가장 큰 편
- [x] **P2** C6(L124-125 setext `---`), C7("불타오릅니다"·"캐시 온기"·"노이즈 네이버"·"파국"),
  C5(제목 개제·근거 블록쿼트 형식), C8(유형 태그)
- 유지 가능한 골격: 이중 스케줄링·LHP·PLE 개념 서술 방향 자체는 타당. steal time 관측법,
  SR-IOV/IOMMU 구조 설명도 소스·문헌 보강 전제로 유지

## 7. 6편 `cloud-optimization-map.md`

- [ ] **P0** L20·L43: "m5.large 기준 **30~50% 메모리 인두세**" — 창작 + 자기모순.
  m5.large(8GiB, maxPods 29)의 EKS 예약 = 11×29+255 = 574 MiB ≈ **7%** (2편 자체 수치와 충돌).
  기획 §3 "6편은 새 수치 없음" 위반. 1~5편 확정 수치로만 재작성
- [ ] **P0** 근거 등급 허위(C2): L43 2편 "+실측" 삭제, L46 5편 등급을 실제(5편 재실측 결과)와
  일치시킴, L45 "sock_hash/sk_msg" → Socket LB(cgroup 훅)·bpf_redirect_peer로
- [ ] **P0** L21·L44: "PLEG의 1초 주기 **sysmon** 동시성 루프"·"kubelet sysmon 고루틴" —
  sysmon은 Go 런타임 모니터 스레드로 PLEG와 무관. 용어 분리 교정
- [ ] **P0** L19: "블랙박스 APF(**CRD** 429 에러 제어)" — APF는 CRD가 아니라 내장 API 그룹
  (`flowcontrol.apiserver.k8s.io`). L22 "런타임 27편 epoll vs io_uring" — C4 교정
- [ ] **P1** L20: "런타임 12편과 17편 ... cgroups v2 계층 구조와 페이지 캐시 직접 회수(kswapd)" —
  12편(3부 5번째)·17편(4부 5번째)의 실제 제목·주제와 대조 후 교정 (후보:
  `container-memory-accounting-cgroup`·`kernel-lazy-allocation-page-fault` 등 — 수정 세션에서
  frontmatter로 확정)
- [ ] **P1** L42 "etcd Watcher OOM" — 1편에서 다루지 않은 주장. 매트릭스에서 삭제하거나 1편 보강과
  연동
- [ ] **P1** 분량·깊이 — 55줄은 소결로 부족(runtime 27편 소결 대비). 증보 방향: ① C9 시리즈 성격
  선언(공개 소스·문헌 검증 시리즈, 실측은 로컬 한정) ② 1~5편 수정 반영한 종합표 재작성(근거
  등급 정직 표기) ③ 비용 보존 법칙 서사를 1~5편의 실제 확정 수치로 뒷받침 ④ 근거 구성 블록쿼트
  추가
- [ ] **P2** C6(L53-54 setext `---`), C5(제목 개제), C8(유형 태그), C10(SVG 2종 내용 정합)

---

## 8. 실측 재설계

### 8.1 4편 — kube-proxy baseline (로컬, 즉시 가능)

1. 동일 colima/kind 스펙으로 kube-proxy(iptables) 모드 클러스터 생성 (Cilium 없이 kindnet 또는
   Cilium을 `kubeProxyReplacement=false`로)
2. 측정: ① 동일 노드 파드 간 ClusterIP 경유 iperf3(5초, 동일 조건) ② `iptables-save | wc -l` +
   `KUBE-*` 체인 수 — 서비스 0/100/1,000개 스케일 ③ (여력 시) `conntrack -L | wc -l` 대조
3. 결과를 **plan.md §8에 append** 후 4편 본문에 on/off 비교표로 반영. 재구성 로그 금지 —
   캡처 원문만 사용

### 8.2 5편 — Linux PC KVM/OpenStack 재실측 (사용자 확정)

**Linux 세션 착수 절차** (Claude Code로 진행):

1. 클론: `git clone git@github.com:ressKim-io/my-blog.git`
   (HTTPS: `https://github.com/ressKim-io/my-blog.git`) — 이 문서와 plan.md §5.2가 작업 지시서
2. plan.md §5.2 사전 체크리스트부터 수행·기록:
   - nested virtualization (`egrep -c '(vmx|svm)' /proc/cpuinfo`, kvm 모듈 `nested` 파라미터)
   - RAM (32GB 권장, 16GB이면 축소 설계)
   - NIC SR-IOV (`lspci -v` — 미지원이면 SR-IOV/DPDK 대목은 문헌 강등을 본문에 명시)
   - 배포판·커널 버전
3. 측정 스크립트는 멱등·원커맨드로 작성, 결과를 JSON/로그 파일로 저장해 레포에 회수
4. 측정 후보 (체크리스트 통과 후 확정):
   - 동일 워크로드 베어메탈(호스트 직접) vs KVM 게스트: 스케줄링 지연 분포(`schedstat`/`perf`),
     steal time (오버스크립션 시나리오: vCPU 총합 > pCPU로 게스트 2개 이상 경합시켜 %st 유발)
   - OVS VXLAN/GENEVE 오버레이 경유 vs 직결 처리량·지연
   - 게스트 K8s(또는 최소 kind)의 PLEG/타이머 지연 변화
5. 결과를 plan.md §8에 append → 검증 → 5편 재집필 (§6의 P0 교정 동시 반영)

**주의**: §8에 append되지 않은 수치는 본문에 쓸 수 없다. 측정 실패 항목은 실패로 기록하고
본문에서 문헌 강등을 명시한다 (Darwin 사태 재발 방지)

## 9. plan.md 정정 사항

- [x] §8.2 표제에 "**무효**" 표기 — Darwin 대체 측정은 논지 검증력 없음, Linux 재실측으로 대체
  (이 감사와 함께 반영됨)
- [x] §8.1 말미에 sockops 해석 오류 주석 추가 (측정 사실 자체는 유효: 89줄·KUBE-* 0개·94.4Gbps)
- [x] §9 상태표 정정: "§5.2 실측 완료" → 무효, "1~6편 집필 완료" → 1차 발행본, 감사 행 추가
- [ ] §4 표: cilium 행에 v1.19.5 태그 커밋 기록 (4편 재검증 시)

## 10. 수정 작업 순서 (수정 세션 가이드)

1. **P0 일괄** — 편별 사실 오류·창작 수치 제거/교정 (§2~7의 P0 체크박스)
2. **실측 보완** — 4편 baseline(로컬), 5편 Linux 재실측(§8.2) → plan.md §8 append → 본문 반영
3. **P1 깊이 보강** — 2편 Karpenter consolidation, 3편 warm pool + 24편 수치 재인용,
   5편 커널 소스 인용, 6편 증보, C1 출처 링크 일괄
4. **P2 정리** — C5 제목·구조, C6 렌더링, C7 문체, C8 frontmatter, C10 SVG
5. **검증**:
   - `npm run lint:post -- src/content/essays/kubernetes/cloud-*.md` — error 0
   - `npm run build` 통과
   - 교차 링크 슬러그 실존 확인 (C4 확정표와 대조)
   - 재계산 표 검산 (2편 234 기준, 6편 새 수치 0건)
   - blog-reviewer 에이전트 QA
   - 이 문서의 체크박스 전부 [x] 후 §0 상태를 "완료"로
