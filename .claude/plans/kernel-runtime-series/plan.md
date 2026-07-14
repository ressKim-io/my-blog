# 커널·런타임 시리즈 변환 계획 (kernel-runtime-tradeoffs)

> **세션 재개용 문서**. 새 세션에서 이 작업을 이어갈 때는 이 파일을 먼저 통독한 뒤,
> §6 상태 표에서 첫 미완료(☐) 편부터 §7 절차대로 진행합니다.
> 마지막 갱신: 2026-07-14 (**5부 5편 전량 발행 완료 — 1~5부 22편 소진**.
> **5부는 도커 컨테이너 실측을 도입한 첫 부** — colima로 리눅스 VM(커널 6.8·cgroup v2)을 띄워
> 진짜 cgroup을 잼. 로컬 macOS로는 cgroup이 없어 불가능했음(§11.2).
> **draft 통념 4건이 실측으로 무너짐**: 힙 산정 256MiB 경계 · ZGC 고정 3% ·
> `MALLOC_ARENA_MAX=2` 만능성 · 시작 구간 RSS 스파이크. draft에 없던 실측 다수 추가.
> **자기 교정 1건**: 19편이 NMT committed로 "ZGC 통념이 뒤집혔다"고 썼다가, 정작 파드를
> 죽이는 `memory.current`로는 ZGC가 가장 크다는 걸 20편 작업 중 발견해 19편을 다시 씀
> (committed ≠ 접촉. ZGC 힙은 `memfd`라 `shmem`에 잡힘).
> **5부 배치 리뷰 실행 완료(2026-07-14) — 거짓 복선 0건.** P0 1건(22편 SVG 번호 순서)·
> P1 2건(3편 링크 누락·native-image 수치 뭉뚱그림)·P2 1건(CRIU 미전개) 수정 반영.
> 리뷰어가 7·9·17편 계약 이행과 22편 19행 표의 편간 수치 일치를 전부 확인.
> **다음: 6부 draft 도착 대기** — 도착 시 §6 표에 23번부터 행 추가.
> 6부 주제는 22편이 예고함: "Go의 한계를 다 가진 Go로 쓰인 K8s는 어떻게 도는가")
> ★ 2026-07-10 SVG 글자 최소화 원칙 확정 — §4.2 하단 참조. **기존 26개 소급 적용 완료(R1~R4)**.
> 발행된 34개 SVG 전부 폰트 13px 이상

---

## 1. 목적

`drafts/`의 학습 정리(1~3부, 12편)를 블로그 글(`src/content/essays/runtime/`)로 변환합니다.
원본은 Claude.ai 채팅에서 작성한 **reference-level draft**(레퍼런스급 심화 정리)로,
깊이는 이미 충분하지만 블로그 양식(격식체·ASCII 금지·시리즈 소개문)에 맞지 않습니다.

**변환의 2대 원칙 (사용자 명시 요구):**
1. **깊이 유지** — draft의 심화 내용을 축약하지 않음. 밀도 ≠ 축약, 깊되 풀어서
2. **자연스러운 한글** — 번역투 제거("~라는 점" 반복, 대시 남발, 영어 직역 구조 금지).
   읽고 소리 내 읽어도 어색하지 않은 문장으로

4~7부는 아직 draft 미집필 상태입니다. 도착하면 §6 표에 행을 추가해 같은 규칙으로 진행합니다.

## 2. 확정 결정 사항 (2026-07-10 사용자 승인)

| 항목 | 결정 |
|------|------|
| 트랙 | `essays` (다듬은 개념 글) |
| 카테고리 | **`runtime` 신설**, 표시명 `언어 & 런타임` (사용자: "주제에 맞게 신설, 표시명 길어도 됨") |
| 시리즈 슬러그 | `kernel-runtime-tradeoffs` |
| 시리즈 표시명 | **커널과 런타임으로 톺아보는 Rust · Go · Java** |
| series.order | 1부터 연속 (1.1=1 … 3.5=12, 4부 이후 13번부터 이어붙임) |
| date | **2026-06-26 기준 편당 하루씩 순차** (2026-07-10 사용자 확정). `date = 06-25 + order` — 1편 06-26, 4편 06-29, 5편 06-30 … 12편 07-07. 실제 변환 작업일과 무관하게 order로 계산 |
| 제목 스타일 | rust-cs-layer 관례를 따름 — 질문형 후킹 + 부제 (예: "왜 X일까 — Y") |

카테고리 표시명을 바꾸고 싶으면 4개 파일의 `categoryLabelMap`만 수정:
`src/app/page.tsx`, `src/app/essays/page.tsx`, `src/components/PostCard.tsx`,
`src/components/HomeCategoryFeed.tsx`

## 3. 원본 자료

- **draft 본문**: `drafts/{1,2,3}부_*.md` 12편 (각 17~33KB)
- **브리핑 3종** (`drafts/00_이어가기_브리핑_*.md`): 시리즈 전체 구조·집필 규칙·복선 지도.
  **`00_이어가기_브리핑_4부.md`가 가장 최신**이며 기준 버전·사실 교정 목록(§5)을 담고 있음
- 각 draft는 8단 구조: ①학습 목표 → ②개념/실체 → ③비용 해부 → ④회피 전략 →
  ⑤3언어(Rust/Go/Java) 수렴 비교 → ⑥트레이드오프 소결 → ⑦DevOps 심화 질문 → ⑧다음 절 연결
- `drafts/2026-03-23-netpol-kube-api-dnat.md`는 **이 시리즈와 무관** (별도 보관분, 건드리지 않음)

## 4. 변환 규칙 (시리즈 특화 — CLAUDE.md 절대 규칙에 추가로)

### 4.1 문체·구조 (★1.1 파일럿 피드백으로 확정, 2026-07-10 / 마침표 규칙 2차 확정)
- **격식체(-습니다체) + 마침표 최대한 생략 + 짧은 단락** (2026-07-10 2차 사용자 확정):
  - 한 단락 = 한 생각(1~2문장). 엔터(단락 분리)로 흐름을 만들고 단락·불릿 끝 마침표 생략
  - `?` `!`·URL/버전/약어 예외. 부득이 한 단락에 문장이 여럿이면 중간 경계에만 마침표
  - 리듬용 "~죠"·의문형 "~까요?"는 가끔 허용
  - **예외: 1.1은 마침표 유지 상태로 발행됨** (규칙 확정 전 파일럿, 사용자 승인으로 소급
    수정 안 함). 1.2부터 새 규칙 적용
- **섹션 헤더에 이모지 금지 (사용자 확정)** — rust-cs-layer의 이모지 헤더 관례를 따르지
  않음. 헤더는 텍스트만, 질문형/서술형 + 필요시 "— 부제"
- **번역투 금지 (사용자 1차 피드백: "단순 번역 톤이 난다")**:
  - 본문에서 대시(—) 삽입구·연결 남발 금지. 문장을 끊고 자연 연결어(그래서, 이때,
    반대로, 결국, 문제는)로
  - "~라는 점" 반복, "A는 B이다 — C이기 때문이다" 직역 구조 금지
  - 영어 관용 표현 직역 대신 한국어 서술로 재작성. 쓰고 나서 소리 내 읽었을 때
    어색하면 실패
- **★ 직역 은유 렉시콘 (2026-07-11 사용자 피드백: "한글에선 존재하지 않는 말투")**:
  "뜨거운 메서드"(hot)·"기어간다"(crawl)·"마비"(paralyze)·"훔쳐 간다"(steal)·"먹인다"(feed)
  금지 — 목록·대체어는 draft-to-post 스킬 표, 자동 검사는 `npm run lint:post -- <파일>`.
  **draft 원문에 있어도 따라 쓰지 않음** (보존 대상은 수치·사실·기전이지 표현이 아님).
  발행 7편(1.1~2.4) 소급 교정 완료(2026-07-11, 29곳 — `~세요` 해요체 3곳 포함)
- **자립성 = 풀어쓰기 (사용자 1차 피드백: "다른 데 찾아보고 와야 할 것 같다")**:
  용어 첫 등장 시 반드시 정의부터 (예: MSR·RIP·TLB·페이지 테이블·파이프라인·vDSO).
  그 문단만 읽어도 검색 없이 이해되게. 밀도 ≠ 축약, 깊되 풀어서
- draft 맨 앞의 "**이 문서의 성격**" 블록쿼트는 **삭제**하고 시리즈 소개 블록쿼트로 교체:
  ```markdown
  > **시리즈 "커널과 런타임으로 톺아보는 Rust · Go · Java"의 N편**
  > (이전 편에서 이어지는 맥락 1~2문장 + 이번 편 후킹 1~2문장)
  ```
- draft의 "0. 이 절을 읽고 나면 이해하게 되는 범위" 목록은 서두 산문 또는 소개 블록쿼트에
  녹이고 섹션으로 남기지 않음
- 8단 구조를 기계적으로 옮기지 말고 글 흐름에 맞게 재편. 단, **⑤3언어 수렴 비교는
  시리즈의 척추**이므로 반드시 독립 섹션으로 유지
- ⑦DevOps 심화 질문(5~6개)은 **유지** — 말미에 "더 파고들 질문" 섹션으로.
  블로그 톤에 맞게 다듬되 삭제 금지 (시리즈 차별점)
- 마지막의 "다음 절 연결"은 다음 편 예고 1~2문장으로 압축
- 마무리는 "핵심 요약" bullet + "[다음 편 예고]" (rust-cs-layer 패턴)

### 4.2 다이어그램 (이 시리즈 최대 작업량, ★1.1 피드백 반영)
draft는 "그림 전부 ASCII" 규칙으로 작성돼 편당 5~10개의 ASCII가 있음. CLAUDE.md 우선순위대로:
1. 행/열 데이터(레지스터 규약, 비교 매트릭스, 수치표) → **markdown 표**
2. 공간·구조·흐름(커널 진입 계단, 메모리 레이아웃, GMP, 삼각형) → **SVG**
   (`public/diagrams/{slug}-{n}.svg`, `.claude/plans/diagram-conversion/best-practices.md` 준수)
3. 1~2줄 흐름 → 인라인 코드 또는 산문
4. 정보량이 본문과 중복되는 장식성 ASCII → 삭제. SVG가 대신하게 된 표도 삭제(중복 금지)
- **ASCII 유무와 무관하게 섹션마다 시각화 필요성을 능동 판단할 것 (사용자 요청)**:
  이론 밀집 구간 + 공간·구조·대응 관계·상태 전이가 있으면 draft에 그림이 없어도 SVG 신규
  작성. 변환 마지막에 **전 섹션 재감사**를 한 번 더 돌 것 (1.1에서 사용자가 재점검 요청해
  3개 추가된 전례: 재예열 곡선·KPTI 분리·crossing 패턴)
- 판단 기준: 그림 = 공간·구조·대응·전이·시간 축 개념 / 표 = 수치·나열 비교 / 산문 = 서사·인과
- 1.1 최종 사례(SVG 7개): 링/EL 사다리, syscall 명령 레지스터 이동, 진입 계단, 간접 비용
  재예열 곡선, KPTI 전후 분리, crossing 절감 4패턴, 3언어 read() 경로
- 편당 SVG 4~10개 실적 (1.1=7 · 1.2=6 · 1.3=5 · 2.1=8 · 2.2=8 · 2.3=9 · 2.4=4 · 3.1=8 · 3.2=9 · 3.3=9 · 3.4=10 · 3.5=5).
  SVG 라벨은 기존 관례대로 **영문**, 상세 설명은 본문 한글로
- SVG 번호는 문서 등장 순서와 일치시킬 것 (중간 삽입 시 뒤 번호 재정렬)
- 재감사 실행 방법은 §7 편당 절차 5단계 참조

#### ★ SVG 글자 최소화 원칙 (2026-07-10 사용자 피드백 — 2.2에서 확정)

사용자 지적: "이미지에 글자가 많아지니 무슨 단어인지 모르게 작아지고 서로 겹친다.
이미지에서는 글을 최소한으로 하고, 하단 본문에서 용어를 전부 풀어쓰며 설명하라"

**그림은 구조만, 설명은 전부 바로 아래 산문으로.**

- **폰트 하한 13px** (박스 타이틀 15px, 강조 숫자 17px+). 10~11px 금지
- 박스 안 텍스트는 **1~3단어 라벨**. 완결된 문장·부연 설명 금지
- 다이어그램 하단 요약 캡션 텍스트 금지 (본문이 그 역할)
- 텍스트 요소 **다이어그램당 15개 이하**를 목표
- 박스 간격 넉넉히 — 텍스트 줄 간격 22px 이상, 겹침 0
- 그림에서 뺀 문장(수치·출처·조건·예외)은 **반드시 이미지 직후 본문에 풀어쓸 것**.
  그림의 짧은 영문 라벨은 아래 산문에서 한글로 정의해 준다
- 이미지 직후 첫 문단은 "그림 왼쪽/가운데를 보면…" 식으로 그림을 읽는 법을 안내

### 4.3 깊이·정확성
- **축약 금지**: draft의 수치(사이클 수, 임계값, 기본값)·자료구조·기전 설명을 그대로 보존.
  오히려 정의가 생략된 용어가 보이면 한 문장 정의를 보강
- **부정확한 실무 사례 창작 절대 금지** (메모리 규칙). draft에 없는 "제가 겪은" 식 각색 금지
- 버전 민감 사실은 §5 기준 버전 표와 대조. **1~2부 draft는 구버전 기준으로 작성됨**
  (Go 1.25·Linux 6.x 표기) — 3부·4부 브리핑에서 갱신된 사실로 통일할 것
- 복선 상호참조(예: 2.2의 Mark Assist 복선 → 4.2 회수)는 발행된 편이 있으면
  실제 글 링크(`/essays/{slug}`)로, 미발행이면 "시리즈 후반에서 다룹니다"로

### 4.4 front matter 틀
```yaml
---
title: "(질문형 후킹 제목)"
excerpt: "(2~3문장, 후킹 + 다루는 범위)"
category: runtime
tags: ["rust", "go", "java", "(주제 태그 2~3개)"]
series:
  name: "kernel-runtime-tradeoffs"
  order: N
date: "2026-06-25 + order 일"   # order=5 → "2026-06-30", order=12 → "2026-07-07"
---
```
- tags[0]부터 언어 태그를 넣되 그 편의 주인공 언어를 앞에 (2.1이면 rust 먼저, 2.3이면 java 먼저)
- type 메타는 `concept`

## 5. 기준 버전·사실 교정 (변환 시 반드시 대조)

**기준 버전 (2026-07, 4부 브리핑 §2-G에서 확정):**
- JDK 25 (LTS). G1 기본. Generational ZGC는 JDK 23부터 ZGC 기본(JEP 474).
  compact object headers JEP 519(JDK 25 정식, opt-in) → JEP 534(JDK 27 기본값 목표).
  **Valhalla JEP 401은 프리뷰가 아님** — Submitted·메인라인 밖, JDK 28 목표 (6·11편 확정)
- Go 1.26 (Green Tea GC 기본, 비이동식 유지). 컨테이너 인식 GOMAXPROCS는 1.25+.
  GOMEMLIMIT은 cgroup 자동 아님(수동)
- Linux 7.x (MM 내부는 6.x와 동일, EEVDF 스케줄러)
- Rust: 제로코스트, 기본 System 할당자 = libc malloc 위임(1.32+)

**draft에 남아 있을 수 있는 낡은/부정확 표현 (발견 시 교정):**
1. "Go PGO 부재" → 틀림. Go 1.21+ 정식. "정적이라 런타임 재최적화 불가" 각도가 맞음
2. "Go=M:N vs Java=1:1" 이분법 → Java 가상스레드(Loom, JDK 21 GA + JEP 491) 반영
3. "Rust가 brk/mmap 직접 호출" → 부정확. libc malloc 위임 (3.2에서 정정 완료된 서사)
4. "Java가 CPU 효율 역전" → **조건부**(peak throughput 한정, tail latency·메모리·웜업 열세)
5. 고루틴 초기 스택 8KB → **2KB** (Go 1.4+ 연속 스택)
6. Linux 6.x 표기 → 7.x
7. "tokio는 cgroup CFS quota를 못 본다"(1.2 draft) → 낡음. num_cpus·std `available_parallelism`
   모두 cgroup quota 파싱 (2026-07-10 웹 검증, rust-lang/rust#92697). 단 명시 설정 권장은 유지

## 6. 편별 매핑·진행 상태

상태: ☐ 미착수 / ◐ 변환 중 / ✅ 발행(검증 완료). **한 편 끝날 때마다 이 표를 갱신할 것.**

| # | draft | slug (제안) | order | 상태 |
|---|-------|-------------|-------|------|
| 1.1 | `1부_1.1_유저모드_커널모드_syscall비용.md` | `syscall-mode-switch-cost` | 1 | ✅ 발행 (2026-06-26, 파일럿 — 피드백 2라운드 반영, SVG 7개) |
| 1.2 | `1부_1.2_스레드모델_1대1_vs_유저레벨스케줄링.md` | `thread-models-kernel-vs-user` | 2 | ✅ 발행 (2026-06-27, 새 문체 첫 적용·SVG 6개·tokio cgroup 사실 교정) |
| 1.3 | `1부_1.3_런타임의_무게_ZeroCost_vs_FatRuntime.md` | `runtime-weight-zero-cost-vs-fat` | 3 | ✅ 발행 (2026-06-28, SVG 5개·Go 1.26 기준 교정·리뷰어 P0 0건 — 1부 완결) |
| 2.1 | `2부_2.1_Rust_AOT_컴파일러엄격함과_하드웨어직거래.md` | `rust-aot-zero-cost-codegen` | 4 | ✅ 발행 (2026-06-29, SVG 8개 — 2부 시작, Opus 4.8 첫 변환·리뷰어 P0 0건) |
| 2.2 | `2부_2.2_Go_AOT_빠른빌드의대가와_정적기계어의한계.md` | `go-aot-fast-build-tradeoff` | 5 | ✅ 발행 (2026-06-30, SVG 8개 — 글자 최소화 원칙 첫 적용, itab·simd 사실 교정, 리뷰어 P0 0건) |
| 2.3 | `2부_2.3_Java_JIT_웜업의반전과_C2런타임최적화.md` | `java-jit-c2-runtime-optimization` | 6 | ✅ 발행 (2026-07-01, SVG 9개 — 복선 8건 전부 회수, 재감사로 스칼라 치환 SVG 추가, JEP 401·코드캐시 사실 교정, 리뷰어 P0 1건 수정) |
| 2.4 | `2부_2.4_소결_롱런서버에서_Java가_CPU효율을_역전하는_조건.md` | `java-jit-inversion-conditions` | 7 | ✅ 발행 (2026-07-02, SVG 4개 — 2부 완결. 소결이라 표 위주 draft를 표3+SVG4로 평탄화. 역전 4조건/3열세축/스펙트럼/두세계, GraalNN·Go1.25 GOMAXPROCS 웹 검증, JEP401 6편과 정정 통일) |
| 3.1 | `3부_3.1_커널의메모리_게으른할당과_페이지폴트.md` | `kernel-lazy-allocation-page-fault` | 8 | ✅ 발행 (2026-07-03, SVG 8개 — 3부 시작. 재감사로 zero page COW SVG 추가. 사실 교정: Go madvise 1.16 기본 DONTNEED 회귀, M1 dTLB 160. 새 파이프라인 첫 적용: 편당 lint:post만, 리뷰어는 3부 완결 후) |
| 3.2 | `3부_3.2_유저공간할당자_ptmalloc과_Rust의malloc위임.md` | `ptmalloc-rust-malloc-delegation` | 9 | ✅ 발행 (2026-07-04, SVG 9개 — 2부 복선("Rust가 brk/mmap 직접 호출") 물리적 완전 회수. 재감사로 표 2개 추가(비트 플래그 예시·cgroup 인식 대응표). 사실 교정: jemalloc 2025-06 아카이브 → 2026-03 Meta 인수·5.3.1 릴리스(draft에 없음), RFC 1183→1974 경위, mallopt 동적조정 해제 조건 4종. 새 발견: glibc arena 상한은 cfs quota를 못 봄(호스트 코어 수) — Go GOMAXPROCS·Rust available_parallelism와 대비해 2편 연결) |
| 3.3 | `3부_3.3_Go자체할당자_P별캐시와_연속스택.md` | `go-allocator-mcache-contiguous-stack` | 10 | ✅ 발행 (2026-07-05, SVG 9개 — 5편 이스케이프 분석 복선 회수(스택 vs span 슬롯 착지), 2편 GMP의 P → mcache 무락 근거. **로컬 Go 1.26.5 툴체인 소스로 상수 직접 확정**(heapArenaBytes 64MB·PageShift 13·MaxSmallSize 32768·NumSizeClasses 68·TinySize 16·stackMin 2048). 사실 교정: 크기 클래스 낭비는 반올림·페이지쪼개기 **2원천**(각 12.5%, 곱하면 최악 26.6%, 512B 경계로 한쪽만 작동 — draft의 "대체로 12%"는 뭉뚱그림), 심화Q5 `madvdontneed=1`은 1.16 이후 무의미 → `=0`이 MADV_FREE 복원(3.1과 통일). 재감사로 GOMAXPROCS(cgroup 읽음)↔GOMEMLIMIT(안 읽음) 표 추가 — 9편 계층 어긋남의 확장) |
| 3.4 | `3부_3.4_JVM의TLAB_포인터만미는할당과_힙밖지형.md` | `jvm-tlab-bump-pointer-offheap` | 11 | ✅ 발행 (2026-07-06, SVG 10개 — 7편 "힙은 60%인데 OOMKilled" 복선 물리적 회수. **로컬 JDK 25.0.3으로 전 수치 실측**(PrintFlagsFinal + 실제 -Xlog:gc+tlab 로그). 교정 4건: ① draft의 "샌드박스 JDK 11 기본 1MB" region → 힙÷2048 파생(실측표) ② JEP 401 "프리뷰" → 6편 정정 유지(Submitted·메인라인 밖) ③ `-XX:+PrintTLAB`는 JDK 25에 없음 → `-Xlog:gc+tlab=trace` ④ target refills 공식 `100÷(2×TLABWasteTargetPercent)`. draft에 없던 추가: JEP 534(JDK 27 헤더 기본값화), MaxRAMPercentage 기본 25%, ZGC 비세대 모드 JDK 24 제거. 재감사로 헤더 궤적 SVG 추가(7번 삽입 → 8~10 재정렬) |
| 3.5 | `3부_3.5_소결_수렴하는할당과_왜GC가필연인가.md` | `allocation-convergence-why-gc` | 12 | ✅ 발행 (2026-07-07, SVG 5개 — **3부 완결**. 소결이라 표3+SVG5. 하드웨어가 강제한 수렴, 회계의 보존 법칙(4행선지), GC 필연의 3조건 벤(Rust가 반례), 트레이드오프 삼각형(4부 뼈대), 객체 모델 지역성. 교정: ① draft의 "2.2에서 예고한 디스코드 사례" → 5편에 0건, 삭제 ② draft가 참조계수 순환누수에 Python을 묶었으나 CPython은 순환 수집기 있음 → Swift ARC·Rust Rc만 ③ draft의 "3.4에서 예고한 sub-ms STW·allocation stall" → 11편에 0건, 실제 11편 예고 문구로 교체) |
| 4.1 | `4부_4.1_GC기본원리_삼색마킹과_쓰기배리어.md` | `gc-tricolor-marking-write-barrier` | 13 | ✅ 발행 (2026-07-08, SVG 10개 — **4부 시작**. 5편 Mark Assist 복선 확인·다음 편 예고로 연결. **웹 검증 2건**: ① proposal 17503 원문 확인 — 하이브리드 배리어의 목적이 "STW 스택 재스캔 제거"이고 예비 실험 최악 STW **50µs 미만**(draft의 "100µs 미만"보다 정확한 1차 출처) ② draft가 각주만 달았던 arxiv 2210.17175(LXR)를 원문 대조 — **"로드 배리어는 리멤버링 배리어의 약 5배"** 확인, 추가로 **필드 로드 64.3/µs vs 스토어 4.3/µs(약 15배 빈도차)** 수치를 draft에 없던 근거로 확보. 재감사로 SVG 1개 추가(#8 배리어 총세금 = 빈도 × 단가 면적 논증 — 읽기 배리어 섹션이 이 편의 결론인데 그림이 없었음 → 8 삽입, 뒤 번호 재정렬). 로드 배리어 fast/slow path 흐름은 16편(ZGC)과 중복이라 의도적으로 안 그림) |
| 4.2 | `4부_4.2_GoGC_MarkAssist와_왜_tail이_튀는가.md` | `go-gc-mark-assist-tail-latency` | 14 | ✅ 발행 (2026-07-09, SVG 9개 — **거짓 복선 교정**: draft의 "2.2에서 예고한 디스코드 사례 회수" → 5편에 0건이라 삭제하고, 실재하는 5편 `:240·242·513`의 **Mark Assist·25% 백그라운드** 복선으로 회수 대상 교체(디스코드는 새로 소개하는 외부 사례로). **로컬 Go 1.26.5 실측**: gctrace를 직접 뽑아 draft의 "기록된 형식 주해"(=실측 아님)를 교체 — **Go 1.26 출력에 `MB stacks`·`MB globals` 필드가 추가**돼 draft 형식과 다름. 실측 라인에서 assist 19ms / 백그라운드 33ms, 두 STW 0.13ms·0.02ms, 라이브 193MB에 목표 387MB(= GOGC 100의 2배 공식 실증). `forcegcperiod = 2*60*1e9`(proc.go:6476)·`gcBackgroundUtilization = 0.25`(mgcpacer.go:39) 소스 확인. **디스코드 원문 대조**: draft의 "10~40ms 스파이크"는 **출처 없음** — 원문에 p99 수치가 없고 그래프만 있음 → 수치를 쓰지 않고 "2분 주기"와 원인만 서술(부정확한 사례 창작 금지 규칙). **Green Tea 웹 검증**: 1.26 기본·10~40% 감소·`nogreenteagc`는 1.27 제거 예정 확인, 추가 발견 — **벡터 명령 가속은 amd64(Ice Lake·Zen 4+) 한정이라 ARM/Graviton은 이 보너스 없음**(draft에 없던 사실, 심화Q5에 반영). 재감사로 SVG 1개 추가(#1 이스케이프 분석이 세대별의 일감을 먼저 가로챈다 — "왜 비세대인가"가 이 편의 근본인데 그림이 없었음 → 1 삽입, 전 번호 재정렬)) |
| 4.3 | `4부_4.3_JavaG1_region과_왜_가끔_크게_멈추나.md` | `java-g1-region-full-gc-cliff` | 15 | ✅ 발행 (2026-07-10, SVG 7개 — **이 편이 4부 최대 사실 교정**. draft가 기본값을 OpenJDK 11로 뽑고 "JDK 25도 동일"이라 단언한 것을 **로컬 JDK 25.0.3으로 전량 재실측**. 교정 5건: ① **`G1EagerReclaimHumongousObjects` 플래그가 JDK 25에 없음**(Unrecognized VM option) — draft는 "기본 on, 실측 확인"이라 썼음 ② `ParallelGCThreads`/`ConcGCThreads`는 코어 수 파생(8코어 → 8/2), draft의 고정값 "4/1"은 그 샌드박스 값일 뿐 ③ `G1MixedGCLiveThresholdPercent` 85는 맞지만 **experimental 플래그**(UnlockExperimentalVMOptions 필요) ④ **JDK 25의 로그 문자열이 바뀜** — draft가 알람으로 걸라던 `to-space exhausted`가 아니라 **`Evacuation Failure: Allocation`**, Full GC는 **`Pause Full (G1 Compaction Pause)`**(draft의 `Pause Full (Allocation Failure)`도 아님) ⑤ region 에르고노믹을 1g~128g로 실측해 표 작성(힙÷2048, 1~32MB clamp, 대부분 2048개 유지). **새 실험(draft에 없음)**: 같은 2MB humongous를 `byte[]` vs `Object[]`로 3000회 할당 비교 → **byte[]는 동시마킹 0·FullGC 0·919MB→4MB, Object[]는 동시마킹 4·FullGC 2·2043MB→2043MB.** eager reclaim에 **타입 제약**이 있음을 실측으로 확정(JDK 26 JDK-8048180에서 전 타입 확장 예정) → 11편의 "humongous는 이사 대상에서 빠진다"와의 충돌도 이걸로 정리(복사만 안 할 뿐 회수 경로는 별도). GC 원인 문자열 `G1 Humongous Allocation` + `Concurrent Start`로 **11편 복선(humongous → 동시 마킹 트리거) 실측 회수**. Full GC 절벽도 직접 재현(256m→1ms · 1g→4ms · 2g→10ms, 힙 비례) + **이사 실패가 수십 번 나도 Full GC는 안 남**(런타임이 실패를 값싸게 처리 → Preventive GC가 JDK 20에서 제거된 맥락과 일치, 플래그 부재로 확인). 재감사로 SVG 1개 추가(#5 eager reclaim 두 갈래 — 표만으로는 기전이 안 보임). SVG1은 lint의 텍스트 상한(16) 초과로 격자 축소 + 범례를 본문으로 이동) |
| 4.4 | `4부_4.4_GenerationalZGC_colored포인터와_allocation_stall.md` | `generational-zgc-colored-pointer-stall` | 16 | ✅ 발행 (2026-07-11, SVG 8개 — **거짓 복선 교정**: draft의 "3.4·2.4에서 allocation stall 예고"는 11편·7편 모두 0건 → **이번 편이 처음 꺼내는 개념**으로 서술. 실재하는 복선(11편 "이사를 백그라운드로", 12편 "barrier가 처리량에 상시로 붙는 세금")만 회수. **로컬 JDK 25.0.3 실측이 이 편의 척추**: ① **같은 5초 실행에서 STW 23,031건·누적 23.8ms·최악 0.019ms vs Allocation Stall 1,305건·누적 136.5ms·최악 1.31ms** — 뮤테이터가 멈춤 총합의 **5.7배**를 할당 대기로 날렸고 그게 pause 지표엔 0건. draft의 "pause 지표에 안 잡힌다"를 숫자로 증명(`ConcGCThreads=1`로 회수를 굶겨 재현, 로그의 `Allocation Stall (main)`이 애플리케이션 스레드임을 보여 줌) ② **처리량 세금 직접 측정** — draft의 "G1 대비 5~10%↓"는 출처 없음이라 삭제하고, 포인터 추적 전용 마이크로 벤치마크(100만 노드 트리 8초 순회)를 3회씩 A/B: G1 5,363~5,453 vs ZGC 4,604~4,703 → **약 14% 손해**. "로드 배리어 최악 조건"임을 본문에 명시하고 수치를 그대로 옮기지 말라고 경고 ③ **`UseCompressedOops = false`(ZGC) vs `true`(G1)** 실측 — 11편의 32GB 절벽이 ZGC엔 없다는 사실을 플래그로 증명 ④ `-XX:-ZGenerational` → "support was removed in 24.0" ⑤ ZPage: draft의 "Medium 32MB 고정"은 낡음 — JDK 25는 `ZUseMediumPageSizeRange` 기본 활성(크기 범위). **웹 검증**: JEP 439의 double-buffered 리멤버드 셋(region마다 비트맵 2장, young 수집마다 원자적 교대 → 양쪽이 서로 안 기다림), 세대별 ZGC가 멀티매핑을 버리고 배리어에 명시적 코드를 넣음, store 배리어의 act-once + 중간 경로 버퍼(`ZBufferStoreBarriers` 로컬 확인)) |
| 4.5 | `4부_4.5_소결_은탄환은없다_비용보존과_세GC의삼각형.md` | `gc-cost-conservation-no-silver-bullet` | 17 | ✅ 발행 (2026-07-12, SVG 5개 — **4부 완결**. 소결이라 표4+SVG5. **13~16편의 실측치를 한 표로 모은 "4부가 직접 잰 숫자들" 섹션이 이 시리즈의 차별점** — draft에 없던 구성. draft 교정: ① draft의 "ZGC O(1) sub-ms(0.1~0.5ms)" → 16편 실측 **최악 0.019ms**로 교체 ② draft의 "ZGC 처리량 G1 대비 5~10%↓"(출처 없음) → 16편 직접 측정 **약 14%**(포인터 추적 최악 조건임을 명시) ③ draft의 "G1 Full GC 수 초" → 15편 실측(256MB→1ms·1GB→4ms·2GB→10ms, 낙관적 하한임을 밝힘)으로 대체. **draft에 없던 실무 섹션 추가**: "대시보드를 GC별로 다르게 봐야 한다"(Go=assist / G1=멈춤 분포 꼬리+Evacuation Failure / ZGC=Allocation Stall+처리량을 멈춤과 같은 화면에) — 4부 실측에서 자연히 도출된 귀결. **12편이 4부에 남긴 계약 4건 전부 이행 확인**: Mark Assist(14편)·Full GC STW(15편)·ZGC barrier 처리량 세금(16편)·삼각형이 뼈대(전편). 5부로 다리(빈패킹·콜드스타트·off-heap OOMKilled — 3·7·11편 복선 수렴)) |

| 5.1 | `5부_5.1_컨테이너속_메모리회계_cgroup합산과_UseContainerSupport.md` | `container-memory-accounting-cgroup` | 18 | ✅ 발행 (2026-07-13, SVG 6개 — **5부 시작. 도커 컨테이너 실측 도입**(colima·커널 6.8·cgroup v2). **draft 최대 교정: JVM 힙 산정 "256MiB 경계" 규칙이 틀림** — draft 표가 4g/2g/1g/512m/200m/128m만 샘플링해 250~512MiB 구간을 통째로 건너뜀. 촘촘히 재면 **그 구간 힙이 전부 128MiB 고정**(에르고노믹 기본 MaxHeapSize ≈96M×1.3=124.8MiB가 바닥). 300MiB 파드 힙 = 25%가 아니라 **42.6%**. `MaxRAMPercentage=75`로 바닥 탈출(300m→232MiB) 확인. **척추 실측: Go OOMKill 재현** — 라이브 300MiB → GC 다음 목표 **562MiB > 한도 512MiB** → GC가 돌기 전에 exit 137·OOMKilled=true. `GOMEMLIMIT=450MiB` 넣으면 생존하되 **GC 7회→435회, CPU 0%→6%**(비용 보존의 컨테이너 판). **Go 소스 결정적 증거**: 1.26.5 `runtime/cgroup_linux.go`에 GOMAXPROCS 함수만, 런타임 전체 `memory.max` **0건**, godebug에 `containermaxprocs`(1.25)만·`cgroupmemlimit` 없음. 제안 #75164는 **Open**(90%·최소 100MB 휴리스틱). GOMEMLIMIT 기본=MaxInt64 실측. **cgroup 회계 실측**: 유휴 컨테이너에서 `anon` 120KiB vs `kernel` 1.08MiB(9배). OOM 실측: exit 137·`memory.events` oom_kill 1. **게으른 할당 함정 발견**: 첫 데모가 힙 8300MiB에도 안 죽음 — Go가 fresh mmap의 memset을 건너뛰어 페이지를 안 만짐 → 8편 연결, 20편 reserved/committed 복선) |
| 5.2 | `5부_5.2_빈패킹의_경제학_GC헤드룸이_노드밀도가_되는_방식.md` | `gc-headroom-bin-packing-density` | 19 | ✅ 발행 (2026-07-14, SVG 4개 — **draft의 "ZGC 고정 오버헤드 ~3%" 삭제**(출처 불명. 17편에서 이미 무출처 ZGC 수치 "처리량 5~10%↓"를 삭제한 전례 반복). **실측이 통념을 뒤집음**: 컨테이너 안 NMT로 GC별 힙 밖 committed = Serial 24.3 / Parallel 44.4 / **G1 65.0** / **ZGC 26.4** MiB — ZGC가 G1보다 **적게** 커밋. ZGC의 공포스러운 숫자는 **reserved 9.35GiB**(-Xmx512m의 18배)인데 **커널은 예약을 안 셈** → VSZ 착시. ZGC의 진짜 메모리 비용은 compressed oops 미지원(16편 실측)으로 힙 **안** 참조가 8바이트인 것. OpenJDK 공식 입장은 "헤드룸은 할당률·라이브셋 의존, peak working set 대비 15~25%". **draft에 없던 핵심 논거: 힙 밖 고정비가 힙 크기와 무관**(-Xmx 256m→72.6MiB, 4g→73.5MiB, 16배 키워도 1MiB 안 늚) → **프로세스마다 내는 인두세** → **파드를 쪼갤 때마다 곱해진다**(10파드 = 650MiB가 런타임 살림에만). 밀도를 높이려는 행위가 밀도를 갉아먹는 반전. 스케줄러 기본이 `LeastAllocated`(분산)이라 빈패킹은 `MostAllocated` 명시가 필요하다는 점도 유지) |

| 5.3 | `5부_5.3_offheap_OOMKilled의물리_GC로그는깨끗한데_파드가죽는다.md` | `offheap-oomkilled-nmt` | 20 | ✅ 발행 (2026-07-15, SVG 5개 — **7편 `:118` 계약("off-heap OOMKilled의 정밀 해부는 5부에서") 이행**. **척추 = 제목의 A/B 재현**: 같은 코드·같은 힙에 `MaxDirectMemorySize`만 바꿈 → 기본값(=`-Xmx`)이면 `OutOfMemoryError` + 스택 트레이스 + **exit 1**(진단 가능), 컨테이너 한도 위(`=2g`)로 올리면 **GC 로그 0건 · 힙 사용률 1% · exit 137**. "캡을 씌워 커널의 죽음을 런타임의 죽음으로"를 실측으로 증명. **draft 교정: `MALLOC_ARENA_MAX=2` 만능론이 뒤집힘** — 16스레드×256×64KiB를 전부 free 후 기본은 3MiB 잔류인데 **`ARENA_MAX=2`가 96~113MiB 잔류**(thread arena는 mmap 구획을 통째 반납 가능, 2개로 묶으면 스레드 할당이 뒤섞여 불가). `malloc_trim(0)`이 즉시 1MiB로 → 누수 아님. 단서: 특정 패턴 결과임을 명시. **9편 `:101` arena 복선 회수**. **Go cgo 사각지대 재현**: `GOMEMLIMIT=700MiB`인데 C 힙 960MiB → exit 137, 그동안 **Go 힙 0 MiB · GC 0회**. NMT reserved 1.65GiB vs committed 334MiB. 11편 중복 회피(11편이 이미 지형도를 그림 → 여기선 두 죽음·reserved/committed·cgo로 차별화)) |
| 5.4 | `5부_5.4_콜드스타트와_웜업의청구서_시작구간의물리와_AOT처방.md` | `cold-start-warmup-aot-remedies` | 21 | ✅ 발행 (2026-07-16, SVG 5개 — **웜업 계단 실측**: 인터프리터 **5578ns** → C1 ~1550ns → 정착 **830ns** = **6.7배**. `PrintCompilation`으로 티어3 → **티어4 OSR(`%`, 백엣지 `@6`)** → 티어4 → 옛 코드 `made not entrant`(역최적화) 관찰. **정착이 1200~1400회** — "C2는 5000회"라는 요약이 루프 있는 메서드엔 안 맞음을 실증(6편 `i+b` 규칙). **컨테이너 고리**: CPU 한도가 `CICompilerCount`를 정함(4코어→3, 2코어→2). 호출 횟수 임계값은 안 변하지만 컴파일 큐가 늦게 빠지고 컴파일러 스레드가 앱과 같은 쿼터를 나눠 씀 → 작은 파드일수록 웜업이 비쌈. **draft 교정 ①: "시작 시 RSS 스파이크"를 관찰 못 함** — 1초 만에 282MiB까지 오른 뒤 일을 멈춰도 **안 내려옴**(피크가 곧 상주 비용). draft의 "튀었다 내려온다" 서술 폐기. **draft 교정 ②: native-image 피크 열세**를 PGO가 만회 — 오라클 벤치 13,075 vs C2 12,488 req/s(벤더 수치임을 명시). "AOT는 무조건 피크가 낮다" 도식 폐기, 7편 역전 명제의 경계가 흐려짐을 언급. **draft 교정 ③: SnapStart "94%↓"는 근거 못 찾음** → AWS 공식 표현 "최대 10배"만 사용. **Leyden AOT 캐시 실측**(JDK 25에 실재): 훈련 실행 1회로 기동 **42ms → 35ms(17%)**, 캐시 11.8MB. **정직 단서: 기준선도 이미 기본 CDS로 958개 중 931개를 shared file에서 읽고 있었고, 장난감 앱이라 실제 프레임워크에 17%를 대입하면 안 됨**) |
| 5.5 | `5부_5.5_소결_클라우드경제_네축과_의사결정매트릭스.md` | `cloud-economics-decision-matrix` | 22 | ✅ 발행 (2026-07-17, SVG 4개 — **5부 완결**. 소결이라 표3+SVG4. **"5부가 직접 잰 숫자들" 19행 표가 이 편의 차별점**(17편의 "4부가 직접 잰 숫자들"과 같은 역할, draft엔 없는 구성). 그 표에서 **원본 정리의 통념 4건이 실측으로 무너졌음을 명시**: 힙 산정 256MiB 경계 · ZGC 고정 3% · `MALLOC_ARENA_MAX=2` 만능성 · 시작 구간 스파이크. 비용 보존 표를 클라우드 축까지 확장(유휴 고정비 행 추가). 의사결정 매트릭스에 **사이드카 행 신설**(19편 인두세 실측의 귀결 — Java 41.2 vs Go 4.8 MiB). **draft에 없던 "대시보드를 런타임별로 다르게" 섹션**: Go=GC CPU 병행 / G1=`memory.current`−NMT 격차 / ZGC=`anon` 말고 **`shmem`** / 웜업 파드=readiness를 "데워졌다"에. 6부로 다리 — Go의 한계를 다 가진 Go로 쓰인 K8s의 역설) |

- slug는 제안값 — 변환 착수 시점에 확정 (SVG 파일명이 slug에 묶이므로 착수 후 변경 금지)

### ★ 2.3(6편) 착수 메모 — 갚아야 할 복선

발행된 편에서 6편으로 미뤄 둔 약속입니다. 2.3을 쓸 때 **반드시 회수**할 것:

| 어디서 | 무엇을 |
|---|---|
| 1.3(3편) | "가장 무거운 JVM이 왜 롱런 정점 처리량에서 앞서는가" — 시리즈 최대 복선 |
| 2.1(4편) `:33` | Rust `.text` 불변성의 대척점 = "실행마다 달라지는 JVM 코드 캐시" |
| 2.1(4편) `:197` | vtable · `itab` · **Java megamorphic 호출**을 나란히 놓기 (다형성 가격표 3부작 완결) |
| 2.1(4편) `:375` | "AOT의 약점은 정적이라 재최적화를 못 하는 것" → JIT의 연속 적응과 대비 |
| 2.1(4편) `:400` | Java만 실행 CPU를 보고 그 아키텍처 기계어를 뽑는다 (AVX-512/SVE2 런타임 감지) |
| 2.2(5편) `:322` | Java 자동 벡터화 = **C2 SuperWord** (2.2에서 무정의로 남겨 둠) |
| 2.2(5편) `:340` | Valhalla JEP 401 배열 평탄화 "다음 편에서 다시" |
| 2.2(5편) `:526` | 다음 편 예고 = 웜업의 대가, 롱런 시 CPU 효율 역전 |

- 2.2의 Mark Assist·`gcBackgroundUtilization` 복선은 **4부(GC)** 행선지. 2.3에서 갚지 말 것
- 2.4(7편)가 "역전 조건"을 맡으므로, 2.3은 **기전**(C1/C2 계층형, 프로파일, 역최적화)에 집중
- 비교표 헤더는 관례대로 주인공 먼저: `| 항목 | Java (6편) | Rust (4편) | Go (5편) |`
- tags[0]은 `java`, date는 `2026-07-01`(= 06-25 + order 6)

- 4~7부 draft가 도착하면 여기 행 추가 (4부: GC / 5부: 클라우드 경제학 / 6부: K8s / 7부: 결론)

## 7. 진행 절차

### 배치 계획
- **배치 0 (사전 작업)**: 카테고리 신설 — §8 체크리스트
- **배치 1 (파일럿)**: 1.1 한 편만 변환 → **사용자에게 깊이·한글 자연스러움 확인** →
  피드백을 이 문서 §4에 규칙으로 반영
- **배치 2~4**: 부 단위로 진행 (1부 잔여 2편 → 2부 4편 → 3부 5편).
  한 세션에 1~3편이 현실적 (편당 본문 변환 + SVG 3~6개)

### 편당 절차
1. draft 정독 + §5 사실 교정 대조 (버전 민감 사실은 웹 검색 확인)
2. ASCII 인벤토리 작성 → 표/SVG/삭제 분류 (§4.2)
3. 본문 변환 (`src/content/essays/runtime/{slug}.md`). front matter `date` = `2026-06-25 + order`
4. SVG 작성 (`public/diagrams/{slug}-{n}.svg`)
5. **전 섹션 재감사 (건너뛰기 쉬움 — 2.1에서 실제로 누락함)**
   - `grep -n '^##\|^!\[' {글}`로 **그림 없는 본문 섹션**을 목록화한다
   - 각 섹션에 §4.2 판단 기준 적용: 공간·구조·대응·전이·시간 축이 있으면 SVG 신규 작성
   - 특히 **그 편의 핵심 개념 섹션에 그림이 없으면 의심할 것**. 2.1의 단형화 섹션은
     어셈블리 코드블록만 있어 "1개 제네릭 → N개 인스턴스 증식 → 두 대가" 구조가 산문에만
     남아 있었음 (사용자 지적 후 SVG 추가)
   - 반대로 인접 코드블록·표·다음 SVG가 이미 커버하면 추가하지 않는다 (2.1의 SIGILL 경로,
     PGO 파이프라인이 그런 사례). 중간 삽입 시 **뒤 번호 재정렬 필수**
6. `npm run lint:post -- <파일>` 통과(error 0) + `npm run build` 통과.
   **blog-reviewer는 편당 실행하지 않는다** — 부(배치) 단위로 1회만, 그때도
   "lint 커버 항목 재검사 금지 + 웹·로컬 사실 재검증 금지(변환 시 검증된 사실 목록 전달),
   판단 항목만(자연스러움 스팟리딩·draft 축약 대조·복선 회수)"를 프롬프트에 명시
   (2026-07-11 토큰 효율화 — 이전엔 편당 130~180K 토큰 소모)
7. **이 문서 §6 상태 갱신** + 커밋 (`docs(content): runtime 시리즈 N편 — {제목}`) + push

### 세션이 끊겼을 때
새 세션에서: 이 파일 통독 → `git log --oneline -5`와 §6 표로 현재 위치 파악 →
◐(변환 중) 편이 있으면 해당 파일과 draft를 diff 감각으로 대조해 이어서, 없으면 다음 ☐부터

## 8. 사전 작업 체크리스트 (배치 0)

- [x] 카테고리 표시명 맵 4곳에 `runtime: '언어 & 런타임'` 추가 (2026-07-10 완료)
- [x] CLAUDE.md 카테고리 목록에 runtime 추가 (2026-07-10 완료)
- [ ] `src/content/essays/runtime/` 디렉토리 — 파일럿 첫 글 작성 시 자연 생성
- [ ] 첫 발행 후 홈/에세이 페이지에서 '언어 & 런타임' 탭 노출 확인

## 9. 기존 SVG 재작성 (글자 최소화 원칙 소급 적용)

2026-07-10 §4.2에 SVG 글자 최소화 원칙을 확정했으나, 1.1~2.1의 SVG 26개는 그 이전에
작성돼 **전부 위반** 상태였습니다 (계측: 26/26이 13px 미만 텍스트 보유, 라벨 최대 103자).

**2026-07-10 R1~R4 전부 완료.** 발행된 34개 SVG가 모두 폰트 13px 이상이고 텍스트 요소
≤19개입니다. 앞으로 새 편은 §4.2 원칙대로 처음부터 작성하면 됩니다.

**배치는 편 단위**로 끊습니다. 그림에서 뺀 문장을 본문 산문으로 옮겨야 하므로
SVG와 글을 함께 봐야 하고, 한 세션에 전부 하면 컨텍스트가 모자랍니다.

| 배치 | 글 | SVG | 심각도 (texts / minFont / maxLabelChars) | 상태 |
|---|---|---|---|---|
| R1 | `rust-aot-zero-cost-codegen` (2.1) | 8 | 최악 — 34 / 9px / 97자 | ✅ 완료 (texts ≤15 · minFont 13 · maxLabel 34자. SVG7의 Graviton 파이프는 본문 표와 중복이라 삭제, 본문 왼쪽/오른쪽 → 위쪽/아래쪽 1곳 수정) |
| R2 | `syscall-mode-switch-cost` (1.1) | 7 | 높음 — 30 / 9.5px / 91자 | ✅ 완료 (texts ≤16 · minFont 13 · maxLabel 28자. 본문 앵커 유지: SVG2 번호 배지 1~4·rsp 라벨, SVG3 빨간 박스 양방향, SVG4 곡선·점선·붉은 구간, SVG1/5 좌우 배치) |
| R3 | `thread-models-kernel-vs-user` (1.2) | 6 | 중간 — 23 / 10px / 103자 | ✅ 완료 (texts ≤18 · minFont 13 · maxLabel 39자. 앵커 유지: SVG2 가운데 층, SVG3 Go 좌상단·2축, SVG5 좌우 handoff, SVG6 1·2·3 순환) |
| R4 | `runtime-weight-zero-cost-vs-fat` (1.3) | 5 | 중간 — 30 / 9.5px / 90자 | ✅ 완료 (texts ≤19 · minFont 13. 앵커 유지: SVG2 위/아래 두 화살표, SVG3·5 좌우 배치, SVG1 가운데 층) |

### 배치별 절차
1. 대상 글 + 그 글의 SVG 전부 정독
2. 각 SVG를 §4.2 원칙으로 재작성 (박스 1~3단어 라벨, 폰트 13px 하한, 캡션 텍스트 삭제)
3. **그림에서 뺀 문장(수치·조건·예외·출처)이 본문에 이미 있는지 확인**.
   없으면 이미지 직후 문단에 추가. 있으면 중복 추가하지 않음
4. 본문이 `그림 오른쪽에 적힌 …` 식으로 **삭제된 SVG 텍스트를 지목**하고 있지 않은지 점검.
   지목하고 있으면 문장을 고칠 것 (재작성 후 그림에 그 라벨이 없을 수 있음)
5. XML 파싱 검증 + `npm run build` + 폰트 하한 계측 → 편 단위 커밋

### 계측 명령
```bash
for f in public/diagrams/{slug}-*.svg; do
  echo "$(grep -c '<text' $f) texts, minFont $(grep -oh 'font-size="[0-9.]*"' $f | grep -o '[0-9.]*' | sort -n | head -1)  $(basename $f)"
done
```

---

## 10. 4부(GC) 착수 메모 — draft 분석 결과 (2026-07-13)

draft 5편(4.1~4.5, 총 134KB)과 `drafts/00_이어가기_브리핑_4부.md`를 통독하고,
발행된 12편 및 로컬 툴체인(Go 1.26.5 · JDK 25.0.3)과 대조한 결과입니다.

### 10.1 복선 검증 — draft의 4개 주장 중 2개가 거짓

3부에서 반복된 패턴(draft가 "N절에서 예고했다"고 쓰지만 실제 발행 글에는 없음)이 또 나왔습니다.
**변환 전에 반드시 아래대로 교정할 것.**

| draft의 주장 | 실제 발행 글 | 조치 |
|---|---|---|
| 4.2: "2.2에서 예고한 **디스코드 사례**를 회수합니다" | ❌ 5편에 디스코드 **0건** (12편 변환 때 이미 같은 거짓을 발견해 삭제한 이력) | 디스코드는 "예고했던 사례"가 아니라 **새로 소개하는 외부 사례**로 서술 |
| 4.2: (같은 문단) | ✅ 5편 `:240` `:242` `:513`에 **Mark Assist·`gcBackgroundUtilization` 25%** 복선 실재 | 회수 대상을 **Mark Assist로 교체**. "5편에서 이름만 던져 둔 Mark Assist를 여기서 해부한다" |
| 4.2: "3.3에서 Green Tea GC를 4부로 미뤄 뒀다" | ✅ 10편 `:426` "자세한 이야기는 4부에서 하겠습니다" 실재 | 그대로 회수 |
| 4.3: "3.4에서 humongous → 동시 마킹을 예고" | ✅ 11편 `:179~203` `:538` 실재 | 그대로 회수. **단 §10.3의 충돌 주의** |
| 4.4: "3.4·2.4에서 **allocation stall**을 예고" | ❌ 11편·7편 모두 `allocation stall` **0건** | allocation stall은 **4.4가 처음 꺼내는 개념**으로 서술 |
| 4.4: (같은 문단) | ✅ 11편 `:133~147` "이사를 백그라운드로 옮겼다" + 12편 `:318` "barrier가 처리량에 상시로 붙는 세금" 실재 | **처리량 세금만** 복선 회수 |

### 10.2 12편(3.5)이 4부에 남긴 계약 — 반드시 이행

`allocation-convergence-why-gc.md :315~319`의 다음 편 예고가 4부의 계약서입니다.

1. Go **Mark Assist**가 고루틴을 GC 노동에 차출하는 순간 + 백그라운드 25% → **4.2**
2. G1의 **Full GC** STW → **4.3**
3. 11편이 "빚이 사라진 게 아니라 청구서의 모양이 바뀐 것"이라며 미뤄 둔
   **Generational ZGC의 진짜 값** = 이사를 백그라운드로 옮긴 대가로 barrier가 처리량에 붙는 세금 → **4.4**
4. **트레이드오프 삼각형**(단편화 ↔ 이동 비용 ↔ 컴파일러·사람)이 4부의 뼈대 → **전 편**

### 10.3 사실 교정 — 로컬 실측으로 확인·반박한 것

**✅ 확인(그대로 씀)**
- `forcegcperiod = 2 * 60 * 1e9` — Go 1.26.5 `runtime/proc.go:6476`. draft의 "2분" 정확
- `gcBackgroundUtilization = 0.25` — `runtime/mgcpacer.go:39`
- JDK 25.0.3 G1 기본값(`-Xmx2g` 실측): region 1MB · `MaxGCPauseMillis` 200 ·
  IHOP 45 · `G1UseAdaptiveIHOP` true · `G1MixedGCCountTarget` 8 ·
  `G1HeapWastePercent` 5 · `G1ReservePercent` 10 · `ParallelRefProcEnabled` true
- **Preventive GC는 JDK 25에 없음** — `-XX:+G1UsePreventiveGC` → `Unrecognized VM option`.
  draft의 "JDK 20에서 제거" 주장이 실측으로 확인됨

**❌/⚠️ 교정 필요**
1. **draft 4.3 서두의 "샌드박스 OpenJDK 11로 실측, JDK 25도 동일"** → 그 문장 자체를 삭제하고
   **로컬 JDK 25.0.3으로 전량 재실측**해 표를 다시 뽑을 것 (11편이 세운 관례)
2. **draft 4.3 `ParallelGCThreads`/`ConcGCThreads` = "4 / 1"** → 코어 수 파생 에르고노믹.
   JDK 25·8코어 머신에서 **8 / 2**. 고정 수치로 쓰지 말고 "코어 수에서 파생, 동시:병렬 ≈ 1:4"로 서술
3. **draft 4.3 `G1MixedGCLiveThresholdPercent` 85** → 값은 맞지만 **experimental 플래그**.
   `-XX:+UnlockExperimentalVMOptions` 없이는 못 바꿈. "실측 기본값" 표에 그냥 얹으면 오해를 부름
4. **draft 4.3 "`G1EagerReclaimHumongousObjects`, 기본 on, 실측 확인"** → **JDK 25에 그 플래그가 없음**.
   남은 것은 `G1EagerReclaimRemSetThreshold`(experimental, 기본 10)뿐.
   eager reclaim **동작**은 남았지만 on/off 스위치는 제거됨 → 문장 재작성
5. **draft 4.2의 `gctrace` 출력** — "문서에 기록된 형식을 그대로 주해"라고 draft가 자백함(= 실측 아님).
   **로컬 Go 1.26.5로 실제 프로그램을 돌려 gctrace를 뽑아 교체**할 것
6. **11편과의 충돌 정리** — 11편은 "humongous는 **이사(evacuation) 대상에서 빠진다**"고 썼고,
   4.3 draft는 "eager reclaim으로 young GC마다 통째 반납"이라 함. 둘 다 사실이나 독자에겐 모순으로 보임.
   4.3에서 **명시적으로 이어 붙일 것**: 복사를 안 할 뿐 회수 경로는 따로 있다

**웹 검증 대상 (변환 시 편별로)**
- 디스코드 Read States 사례의 실제 수치(2분 주기·지연 폭) — 원문 대조 필수. 부정확한 각색 금지
- load 배리어 ≈ store 배리어의 5배 (draft 인용: arxiv 2210.17175)
- ZGC가 G1보다 처리량 5~10%↓ / generational이 비세대보다 ~10%↑ / 작은 힙 배리어 오버헤드 ~15%
- Green Tea GC 1.26 기본 · `GOEXPERIMENT=nogreenteagc`가 1.27에서 제거 예정인지
- G1 region 상한 512MB(JDK 18, JDK-8276929) / Preventive GC 제거(JDK-8297639)
- ZPage Small 2MB · Medium 32MB · Large N×2MB
- ARM64 **TBI**(Top Byte Ignore)와 colored pointer의 관계

### 10.4 ASCII 인벤토리 — 총 29블록 (전부 언어 미지정 코드펜스)

| 편 | ASCII | 이미 markdown 표 | 주요 ASCII 소재 |
|---|---|---|---|
| 4.1 | 7 | 3 | 근사 질문 전환 · 도달성 그래프 · 삼색 파면 · STW vs 동시 타임라인 · lost object 사고 · 배리어 3종 의사코드 · 삼각형 |
| 4.2 | 9 | 2 | GC 4국면 · 힙 목표 공식 · 톱니 그래프 · P별 25% 점유 · Mark Assist 크레딧 · 디스코드 2분 타임라인 · gctrace 주해 · Green Tea span 큐 · 삼각형 |
| 4.3 | 6 | 2 | region 모델(연속 vs 흩어짐) · G1 사이클 흐름 · evacuation 전후 · humongous 2종 · 지연 절벽 그래프 · 삼각형 |
| 4.4 | 5 | 2 | 64비트 colored pointer 배치 · load 배리어 분기 · 동시 이사 3단계 · allocation stall · 삼각형 |
| 4.5 | 2 | 2 | 삼각형 종합(4방식) · 할당→회수 인과의 사슬 |

- **삼각형 ASCII가 5편 전부에 반복 등장** — 12편에서 이미 SVG로 만든 자산이 있음.
  4부는 "그 삼각형 위에 각 GC를 얹는" 변주이므로 **편마다 다른 SVG로 새로 그림**(같은 그림 재탕 금지)
- 4.2의 `gctrace` 주해는 ASCII 박스가 아니라 **필드 라벨링** — 실측 로그 ` ```text` + 본문 표로 평탄화
- 4.1의 배리어 3종 의사코드는 **코드**이므로 ` ```go`/` ```text`로 살리되 박스는 제거

### 10.5 편당 SVG 예상 — 총 37개

4.1=8 · 4.2=9 · 4.3=8 · 4.4=7 · 4.5=5. 1~3부 실적(편당 4~10)과 같은 밀도입니다.
§4.2의 **글자 최소화 원칙**(폰트 13px 하한 · 박스 라벨 1~3단어 · 텍스트 15개 이하)을
처음부터 지켜 작성하고, §7 편당 절차 5단계의 **전 섹션 재감사**를 빠뜨리지 말 것.

### 10.6 문체 — 4부 draft의 특이 위험

- draft가 **대시(—) 삽입구를 1~3부보다 더 많이** 씁니다. 문장을 끊고 연결어로 바꿀 것
- "**은탄환**"(silver bullet)은 §4.1 직역 은유 렉시콘의 경계에 있지만,
  브룩스 이래 정착된 번역어이고 **4부의 주제어**이므로 유지합니다. `lint:post`가 잡으면 예외 처리
- draft의 "청구서·환전·징집" 비유는 시리즈 고유 어휘로 이미 12편까지 정착 → 유지
- "**뮤테이터(mutator)**"는 첫 등장 시 정의부터 (draft 4.1 `:132`에 정의 있음, 살릴 것)

---

## 11. 5부(클라우드 경제학) 착수 메모 (2026-07-14)

draft 5편(5.1~5.5)을 통독하고 발행 17편·로컬 툴체인·**도커 컨테이너**와 대조한 결과입니다.

### 11.1 복선 검증 — 4부와 달리 **거짓 복선 0건**

draft가 `[복선 확인 필요]`로 남긴 4곳을 전부 대조했고 모두 실재합니다.

| draft 표시 | 실제 발행 글 | 조치 |
|---|---|---|
| 1.3(3편) Direct Memory | ✅ `:217` `:224` `:352` — `MaxDirectMemorySize` 기본이 `-Xmx`와 같다까지 | 회수 |
| 2.4(7편) cgroup 합산 | ✅ `:110` `:114` + **`:118` "off-heap OOMKilled의 정밀 해부는 5부에서 다룹니다"** = 명시적 계약 | **20편이 반드시 이행** |
| 3.2(9편) arena | ✅ `:101` "arena 상한 코어×8 … **이 숫자가 뒤에서 컨테이너 RSS 문제로 돌아옵니다**" | 20편에서 회수 |
| 3.4(11편) 힙 밖 지형 | ✅ `:335~388` `:543~544` — 표까지 그림 | 20편에서 회수 |
| 4.5(17편) → 5부 | ✅ `:228` 빈패킹·콜드스타트·off-heap OOMKilled 3종 예고 | 18·19·20편이 각각 이행 |

### 11.2 로컬 환경 — **도커 컨테이너 실측 도입** (5부의 새 관례)

로컬은 macOS라 cgroup이 없습니다. 4부까지의 "로컬 툴체인 실측"으로는 5부를 쓸 수 없습니다.

**해결: colima로 리눅스 VM을 띄우고 그 안 도커에서 잽니다.**

```bash
brew install colima docker
colima start --cpu 4 --memory 6     # 커널 6.8 · cgroup v2
docker run --rm --memory=512m alpine cat /sys/fs/cgroup/memory.max
```

- 이걸로 **memory.max·memory.stat·memory.events·OOMKilled·JVM 컨테이너 감지 로그**를 전부 실측함
- macOS에서 `-XX:MaxRAM` 스윕으로 잰 힙 곡선이 **컨테이너 경로와 정확히 일치**함을 교차 확인
  (512m 컨테이너 → `MaxHeapSize = 134217728` = 128MiB, 스윕 예측과 동일)
- 세션이 끊겼으면 `colima start`부터. `colima status`로 확인

### 11.3 사실 교정 — draft가 틀린 것

1. **JVM 힙 산정 "256MiB 경계" 규칙이 틀림** (18편에서 교정 완료).
   draft 표의 샘플링 구멍 때문. 실측 곡선은 §6 18편 행 참조
2. **ZGC "고정 오버헤드 ~3%" 출처 불명 → 삭제** (19편에서 교정 완료).
   17편에서 이미 같은 종류(무출처 ZGC 수치)를 삭제한 전례가 **반복됨**.
   → **5.3~5.5의 ZGC·native-image·SnapStart 수치도 같은 의심으로 볼 것**
3. **draft 전편이 OpenJDK 11.0.31 샌드박스 실측** → JDK 25.0.3으로 전량 교체 (4부와 동일 문제)

### 11.4 중복 위험 — draft에 경고 없음, 반드시 회피

- **11편이 이미 힙 밖 지형을 표까지 그려 다뤘습니다** (Metaspace 무제한·코드캐시 240MB·
  다이렉트≈`-Xmx`·`MALLOC_ARENA_MAX`·NMT 사용법). **5.3을 draft대로 옮기면 11편 재탕**.
  → 20편은 **11편이 안 한 것**으로 차별화: ① 두 죽음의 구분(OOME vs SIGKILL) ②
  **reserved vs committed** ③ NMT 실제 출력 해부 ④ **cgo가 GOMEMLIMIT 밖**이라는 Go 쪽 대칭
- **6편이 이미 티어드 임계값을 백엣지(`i + b`) 규칙·동적 스케일링까지 다뤘습니다**.
  5.4가 "C2는 5000회"만 반복하면 6편 축약. → 21편은 **웜업 곡선 실측 + 세 처방**에 집중

### 11.5 5.3~5.5용 확보 실측 (재측정 불필요)

**JDK 25.0.3 기본값 (macOS·컨테이너 양쪽 확인)**
- `MaxRAMPercentage=25` · `MinRAMPercentage=50` · `InitialRAMPercentage=1.5625`
- `MaxMetaspaceSize = 18446744073709551615`(2^64−1, 사실상 무제한) · `CompressedClassSpaceSize = 1GiB`
- `MaxDirectMemorySize = 0` (0 = "상한을 `-Xmx`에 맞춤") · `ThreadStackSize = 2048`(KB)
- `ReservedCodeCacheSize = 251674624` (≈240MB, JDK 25는 `{ergonomic}`)
- `G1ReservePercent = 10`
- 티어드: `Tier3InvocationThreshold=200` · `Tier4InvocationThreshold=5000` ·
  `Tier4CompileThreshold=15000` · `Tier3CompileThreshold=2000` · `CompileThreshold=10000`

**NMT (JDK 25, `-Xmx256m`, 유휴 JVM, macOS)** — 20편 척추
| 범주 | committed | reserved |
|---|---|---|
| Java Heap | 256 MiB | 256 MiB |
| **GC** | **53.4 MiB** | 53.4 MiB |
| Shared class space (CDS) | 13.6 MiB | 16 MiB |
| Code | 7.5 MiB | **244 MiB** |
| Class | 0.19 MiB | **1.02 GiB** |
| Thread | 0.46 MiB | 26 MiB |
| Metaspace | 0.20 MiB | 64 MiB |
- **Total: committed 334 MiB vs reserved 1.65 GiB (5배)** — reserved/committed 대비의 교재
- **힙 밖 committed ≈ 78 MiB** 중 **GC가 53 MiB로 최대** ("GC가 GC 아닌 메모리를 쓴다")

**GC별 힙 밖 고정비 (리눅스 컨테이너, `-Xmx512m -Xms16m`)** — 19편에서 사용
Serial 24.3 / Parallel 44.4 / G1 65.0 / ZGC 26.4 MiB · reserved는 ZGC만 9.35 GiB
**단서**: 기동 직후·유휴 힙 기준. 부하 중 총량 아님 — 20편에서 부하 중 증가를 볼 것

**힙 밖 고정비의 힙 무관성 (macOS)**: `-Xmx` 256m→72.6 / 512m→72.8 / 1g→73.0 / 2g→73.4 / 4g→73.5 MiB

**웜업 계단 (JDK 25, 기본 티어드)** — 21편 척추
- 인터프리터 **4791 ns** → C1 정착 **~1300 ns** → 최종 **~830 ns** (**5.8배**)
- `-XX:+PrintCompilation`: `3 Warmup::work` → **`9 % 4 Warmup::work @ 6`(Tier4 OSR, 백엣지)**
  → `99 4 Warmup::work` → `8 3 ... made not entrant`(역최적화)
- **승급이 5000회 훨씬 전에 일어남** — 6편의 `i + b` 규칙 실증. "5000회"를 단순 반복하지 말 것

**Leyden AOT 캐시 (JDK 25.0.3에 실재)** — 21편 척추
- 플래그 확인: `AOTCache` · `AOTCacheOutput` · `AOTMode` · `AOTConfiguration` · `AOTClassLinking`
- 훈련 실행 1회(`-XX:AOTCacheOutput=app.aot`) → 캐시 **11.5 MB**
- 기동 중앙값 **77 ms → 68 ms (약 12%↓)**. 단, 클래스 수백 개짜리 장난감 앱이라
  **실제 프레임워크보다 이득이 과소평가됨**을 반드시 명시할 것

**Go 1.26.5**
- `GOMEMLIMIT` 기본 = `math.MaxInt64` (9223372036854775807) · `GOGC` = 100
- `runtime/cgroup_linux.go` = GOMAXPROCS 함수만 · 런타임 전체 `memory.max` **0건**
- godebug: `containermaxprocs`(Changed: 25)만. `cgroupmemlimit` **없음**
- 제안 #75164 **Open** (미채택. 한도의 90%·최소 100MB 휴리스틱 논의 중)

**cgroup v2 (컨테이너 실측)**
- `--memory=512m` → `memory.max = 536870912` · `memory.high = max`(K8s 미사용)
- 유휴 알파인: `anon` 120KiB vs `kernel` 1.08MiB (**9배**) · slab 344KiB · pagetables 88KiB
- OOM: `ExitCode=137` · `OOMKilled=true` · `memory.events`에 `max 35 / oom 1 / oom_kill 1`
- **파이썬이 `MemoryError`를 못 던짐** — SIGKILL이라 런타임에 기회가 없음 (20편 "두 죽음"의 실증)

**웹 검증 완료**
- JDK-8348566 (커널 6.12 cgroup 컨트롤러 이동으로 JVM이 한도를 못 읽던 버그) → **JDK 25에서 수정**
- ZGC 헤드룸 공식 입장: "할당률·라이브셋에 따라 크게 다름", peak working set 대비 **15~25%**

### 11.6 5.3~5.5 남은 실측 과제

- **20편**: 부하를 걸어 Metaspace·코드캐시·다이렉트가 실제로 자라는 것 관측 →
  **GC 로그는 깨끗한데 exit 137** 재현 (이 편의 제목 그 자체).
  `MALLOC_ARENA_MAX` 유무에 따른 RSS 차이 실측 (9편 복선 회수).
  Go `cgo`가 `GOMEMLIMIT` 밖이라 OOMKilled 되는 것도 재현 가능하면 할 것
- **21편**: 컨테이너 안에서 시작 구간 RSS 스파이크 관측(정상 상태보다 높은지).
  native-image·CRaC/SnapStart 수치는 **draft 인용값이 무출처일 수 있으니** 원문 대조 필수
  (§11.3 교훈). Leyden만 로컬 실측이 있음
- **22편**: 새 수치 도입 없음(draft 자체가 그렇게 선언). 18~21편 실측을 한 표로 모으는 것이
  4부 소결(17편)의 "4부가 직접 잰 숫자들" 섹션과 같은 역할 — **5부의 차별점이 될 것**
