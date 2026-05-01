# 블로그 다이어그램 시각화 베스트 프랙티스

> ASCII keep 105블록 → SVG 다이어그램 변환 작업의 설계 기준
> 1.0 외부 검색 정리(2026-05-01) — 출처는 문서 하단
> 1.1 실작업 패턴 반영(2026-05-01, 51편/49 SVG 변환 완료)

라이트 테마 기본 블로그(v2 개편 완료)에 맞는 SVG 다이어그램 작성 규칙을 정리합니다. 작업 시 이 문서를 참조해 일관성을 유지합니다.

---

## 1. 색상·대비 (Color & Contrast)

### 원칙
- **C4 모델은 색상을 강제하지 않습니다** — 자유로 두되 **글 안·시리즈 안에서 일관**되어야 합니다
- 색에만 의존하지 않습니다 (색맹·흑백 인쇄 대응) — 모양, 라벨, 패턴을 함께 사용합니다
- WCAG 대비비 충족: 본문 텍스트 4.5:1, 큰 텍스트 3:1 (다이어그램 라벨도 동일 기준)

### 우리 블로그 디자인 토큰 (라이트)

```
배경       #FAFAFA  (거의 흰색)
텍스트     #0A0A0A
보조 텍스트 #27272A
보더       #E4E4E7  (얇음) / #D4D4D8 (강함)
액센트     #7C3AED  (보라)
액센트 배경 #F5F3FF  (연한 보라)
코드 배경  #18181B
```

### 의미론적 색상 매핑 (Cocoon 6색 → 우리 톤)

C4 모델 + Cocoon 스킬의 **의미론적 색상 코딩**을 차용하되, 라이트 배경에서 충분한 대비를 갖도록 **채도를 낮춰** 사용합니다. 블로그 액센트(`#7C3AED`)와 충돌하지 않게 톤다운된 팔레트를 권장합니다.

| 의미 | 카테고리 | Stroke (선/테두리) | Fill (배경) | Text |
|---|---|---|---|---|
| **Frontend** | UI, Browser, Client | `#0891B2` (cyan-600) | `#ECFEFF` (cyan-50) | `#0E7490` |
| **Backend** | API, Service, App | `#059669` (emerald-600) | `#ECFDF5` (emerald-50) | `#047857` |
| **Database/Storage** | DB, Cache, Volume | `#7C3AED` (violet-600 / 액센트) | `#F5F3FF` (violet-50) | `#6D28D9` |
| **Cloud/Infra** | AWS, GCP, K8s | `#D97706` (amber-600) | `#FFFBEB` (amber-50) | `#B45309` |
| **Security/Auth** | mTLS, JWT, IAM | `#E11D48` (rose-600) | `#FFF1F2` (rose-50) | `#BE123C` |
| **External/Other** | 외부 시스템, 사용자 | `#475569` (slate-600) | `#F8FAFC` (slate-50) | `#334155` |

**6색 모두를 한 다이어그램에서 쓰지 않습니다.** 글 1편당 2~4색 선에서 끝냅니다 (인지 부담 감소). 색이 부족하면 모양/굵기/패턴(점선·실선)을 추가합니다.

### 화살표·선
- 본 흐름: 실선 + 화살표 (`stroke-width: 1.5`, 색상 `#0A0A0A` 또는 `currentColor`)
- 비동기/이벤트: 점선 (`stroke-dasharray: 4 2`)
- 약한 연결: 보더 색(`#D4D4D8`)
- 강조 흐름: 액센트(`#7C3AED`) + `stroke-width: 2`

---

## 2. 타이포그래피

### 폰트
- **Pretendard** (블로그 본문 폰트) — 한글 라벨에 사용
- **Geist Mono** (블로그 코드 폰트) — 코드/식별자 라벨에 사용
- SVG `<text>`에서 `font-family: var(--font-sans)` 또는 `var(--font-mono)`로 상속 받습니다 (인라인 SVG 한정)
- 외부 SVG 파일 사용 시 `font-family: 'Pretendard', system-ui, sans-serif` 직접 지정

### 사이즈
- 박스 타이틀: **14px** (가독성 최소 기준)
- 본문 라벨: **12~13px**
- 부가 메타(타입·프로토콜): **11px**, `fill: #27272A`
- 화살표 라벨: **11px**, 배경 `#FAFAFA` 사각형으로 라인 가리기

### 줄임 금지
- 박스 안 텍스트가 길면 줄바꿈(`<tspan x="..." dy="1.2em">`)으로 처리 — 자르지 않습니다
- 약어는 풀어 쓰거나 첫 등장 시 정의 (e.g. `mTLS (mutual TLS)`)

---

## 3. 레이아웃·간격

### viewBox·반응형
- 기본 `viewBox="0 0 800 480"` (16:9 근접) — 작은 화면에서 가로 스크롤 없이 자연 축소
- `width="100%"` `height="auto"` (CSS) — `max-width` 컨테이너에 맞춰 줄어듭니다
- 박스 최소 크기: **너비 120 × 높이 60** (12px 텍스트 2~3줄 수용)
- 박스 간격 최소 **40px** (화살표 + 라벨 공간)

### 정렬·격자
- 모든 박스는 **8px 그리드**에 스냅 (좌표가 8의 배수)
- 같은 계층의 박스는 같은 Y 좌표 — 수평 정렬로 시선 흐름 명확화

### Z-order
- 화살표를 먼저 그리고, 박스를 위에 얹습니다 (Cocoon 패턴) — 화살표가 박스 안으로 파고들지 않도록

---

## 4. 접근성 (A11y)

### 필수 요소
```svg
<svg role="img" aria-labelledby="title-1 desc-1" viewBox="...">
  <title id="title-1">Istio Ambient 트래픽 흐름도</title>
  <desc id="desc-1">Pod A에서 Pod B로 가는 요청이 ztunnel을 거쳐 mTLS 암호화되는 5단계</desc>
  ...
</svg>
```

- `<title>` — 한 줄 요약 (스크린리더가 가장 먼저 읽음)
- `<desc>` — 흐름·관계 설명 (1~2문장)
- 의사결정 트리·시퀀스는 ARIA list/table 시맨틱을 추가 고려

### 대안 텍스트
- SVG 옆에 본문으로 다이어그램 내용을 풀어 씁니다 — 검색 엔진과 보조 기술이 모두 인덱싱
- 이는 우리 블로그의 "표/다이어그램 설명 원칙"과도 정합 (CLAUDE.md)

---

## 5. 다크/라이트 모드 대응

블로그는 라이트가 기본이지만 다크 토글이 있습니다 (data-theme). 다이어그램도 두 모드에서 자연스럽게 보여야 합니다.

### 권장 패턴 — `currentColor` + CSS 변수

```svg
<!-- 외부 .svg 파일 -->
<svg style="color: currentColor;">
  <rect stroke="currentColor" fill="none"/>
  <text fill="currentColor">label</text>
</svg>
```

- 단색 다이어그램(흐름도·시퀀스)은 `currentColor` 100%로 처리 — 다크에서 자동 반전
- 다색 다이어그램은 인라인 SVG로 임베드해 `var(--accent)` 등 CSS 변수 직접 참조

### 미디어 쿼리 인라인 패턴
```svg
<svg>
  <style>
    .box { fill: #ECFDF5; stroke: #059669; }
    [data-theme="dark"] .box { fill: #064E3B; stroke: #34D399; }
  </style>
</svg>
```

- 인라인 SVG일 때만 동작 (`<img src=...>`로 박으면 `data-theme` 상속 안 됨)

### 결정
- **단색 흐름도**: `.svg` 파일 + `currentColor` (가장 단순)
- **다색 아키텍처**: MDX에 인라인 SVG (CSS 변수 활용)
- **복잡 + 인터랙션**: 별도 React 컴포넌트 (드물게)

---

## 6. 자기 충족성 (Self-describing)

### 범례 (Legend)
- 의미론적 색상을 쓰는 다이어그램은 **하단 또는 우측에 작은 범례** 박스 배치
- 글 안에서 처음 등장하는 다이어그램에만 범례, 같은 시리즈 내 후속은 생략 가능

### 타이틀
- 다이어그램에 자체 타이틀(`<text>` 또는 `<title>`)을 넣습니다 — 본문 캡션과 별개
- 형식: `[유형] 주제` 예: `흐름도 — 게시글 게시 시 카테고리 적용`

### 라벨 명확성
- 화살표에는 **동작**(reads, sends, authenticates)을 라벨로
- 박스에는 **컴포넌트 이름** + **타입**(예: `argocd-server [Pod]`, `Postgres [RDS]`)
- C4 권장: 관계에 기술/프로토콜 명시 (HTTP, gRPC, Kafka 등)

---

## 7. 모바일·반응형

### 가로 스크롤 금지
- 모바일 기본 폭 **375px**에서 가독 가능해야 합니다
- 박스 6개 이상 + 가로 길이 큰 다이어그램은 **세로 흐름**으로 재구성 (위→아래 화살표)

### 라벨 우선순위
- 작아지면 가장 먼저 사라져도 되는 정보(메타·프로토콜)는 별도 그룹으로 묶어 `display: none` 가능하게 마크업

---

## 8. 파일 구조

### 저장 경로
```
public/diagrams/{slug}-{n}.svg
```
- `n`은 글 안 다이어그램 순번 (1부터)
- 예: `public/diagrams/istio-ambient-part2-traffic-flow-1.svg`

### 본문 사용
```markdown
![Ambient 트래픽 흐름](/diagrams/istio-ambient-part2-traffic-flow-1.svg)
```
- 기존 `![](/.../n.png)` 패턴과 동일 — MDX 컴포넌트 추가 부담 없음
- 이미지 사이즈 힌트 활용 가능 (`![|short](...)` 등)

### 인라인 SVG가 필요한 경우
- MDX 안에 직접 `<svg>...</svg>` 삽입
- 또는 `src/components/diagrams/{slug}-{n}.tsx` React 컴포넌트로 분리 후 `<DiagramFoo />` 호출

---

## 9. 작성 워크플로

1. **원본 ASCII 블록 의미 파싱** — 박스·화살표·라벨을 의미 단위로 추출
2. **C4 레벨 결정** — Context / Container / Component / Code 중 어디에 해당하는지
3. **유형 분류** — 아키텍처(architecture) / 흐름도(flow-diagram) / 트리(tree) / 시퀀스(sequence)
4. **색상 매핑** — 본 문서 §1.3 표 참조, 2~4색 선에서 끝
5. **레이아웃** — 8px 그리드, 박스 정렬, 화살표 우선 그리기
6. **접근성 메타** — title/desc 추가, 본문 보강 설명 유지
7. **검수** — 모바일 375px 폭, 라이트/다크 토글, 색맹 시뮬레이션 (Stark, Sim Daltonism)

---

## 10. 안티 패턴 (피할 것)

- ❌ 색상만으로 구분 (예: 빨강=실패, 초록=성공) — 아이콘·텍스트 동반 필수
- ❌ 폰트 9px 이하 라벨
- ❌ 박스 30개+ 한 다이어그램에 몰아넣기 — 분할 (관심사 분리)
- ❌ 화살표 교차 5개+ — 레이아웃 재배치
- ❌ 외부 폰트 CDN 의존 (오프라인/속도) — 시스템 폰트 폴백 필수
- ❌ 비표준 약어 (예: `mtls`, `pgbr`) — 풀어 쓰기
- ❌ 다이어그램만 두고 본문 설명 생략 — CLAUDE.md "표/다이어그램 설명 원칙" 위배

---

## 11. 실작업에서 도출된 추가 패턴 (1.1)

51편 / 49 SVG 변환 후 정리한 실용 패턴입니다.

### 11.1 사이클/루프 다이어그램

OOM 악순환, retry 증폭, 데드락 같은 **닫힘 화살표**는 다음 규칙으로 표현합니다.

- 닫힘 화살표는 `stroke-dasharray: 5 3` + `#BE123C` (rose) — "비정상 반복" 시그널
- 일반 흐름은 검정 실선 — 정상 진행
- 사이클을 만드는 마지막 화살표 옆에 "사이클 반복", "loop", "force 잔류" 같은 짧은 라벨

검증된 사례: argocd-otel-crashloop(retry 증폭), argocd-ssa-sync-pitfalls(force loop), goti-adr-loki-tempo-stability-tuning(OOM 사이클).

### 11.2 데드락/순환 의존성

두 박스 사이 양방향 점선 화살표로 "서로의 해소 조건을 막는" 상태를 시각화합니다.

- 양쪽 박스는 동일 색(security/rose 권장)
- 화살표 라벨은 인과 관계 한 줄(예: "drain 불가", "IP 반환 안 됨")
- 결과 박스(slate)를 아래에 두고 "데드락 — 무한 루프" 명시

검증된 사례: eks-troubleshooting-part9(서브넷 IP 소진 데드락).

### 11.3 워터폴 다이어그램 (분산 트레이싱)

Trace 워터폴은 시간축과 가로 바 길이로 비례 표현합니다.

- 시간축 라벨(`0ms`, 중간값, `Total`) 상단 배치
- 가로 바 길이 = 소요 시간 / 전체 시간 비율
- 들여쓰기 = 호출 관계 (자식 Span은 X 좌표를 부모보다 +24 안쪽으로)
- 병목 단계만 rose(`#E11D48`)로 강조, 일반 단계는 의미별 색
- 바 안에 `<text fill="#FAFAFA">`로 시간 표시 (배경과 대비)

검증된 사례: istio-observability-part2-tracing(Trace abc123 워터폴).

### 11.4 UI 모킹 처리 정책

UI 모킹 ASCII 박스(Grafana 대시보드, Jaeger UI, Kiali UI 등)는 다음 기준으로 분류합니다.

| 케이스 | 처리 |
|---|---|
| **수치/메트릭이 핵심** (예: P50/P90/P99, Error 0.5%, 80% 비율) | SVG 차트화 — 막대·숫자·색상으로 정보 가치 유지 |
| **테이블 형태** (예: Trace ID 목록, Workloads 목록, Inbound/Outbound 표) | markdown 표로 평탄화 — 정보량은 동일, 비용은 0 |
| **PNG가 인접** | ASCII 삭제, PNG 유지 |
| **체크리스트 박스** | markdown 굵은 헤더 + `- [ ]` 평탄화 |

검증된 사례: istio-observability-part1-metrics(Service Dashboard SVG화), part2-tracing(Jaeger 검색 표 SVG화 + 워터폴 SVG), istio-observability-part4-kiali(9개 UI 모킹 → markdown 표).

### 11.5 ADR Before/After 다이어그램

두 다이어그램이 서로 짝을 이루는 ADR/POC 글에서는 다음 패턴을 적용합니다.

- 두 다이어그램이 **본질적으로 다르면** 각각 SVG 작성
- 두 다이어그램이 **거의 같으면** 한쪽만 SVG로, 다른 쪽은 "위 다이어그램 참조 — 핵심 차이는 X" 텍스트 안내
- After 다이어그램은 **개선점만 강조**(rose → emerald 색 전환, 추가 박스만 채움)

검증된 사례: goti-adr-alloy-to-otel-collector(Before/After 통합), eks-security-jwt-rsa-mismatch(문제/해결 분리).

### 11.6 카테고리/시리즈 중복 처리

`inventory.json`은 같은 글을 카테고리(`cat:challenge`)와 시리즈(`series:goti-pgbouncer`) 양쪽에 등록합니다. 이 경우 **글 단위로 처리**해 그룹 commit 충돌을 회피합니다.

- 카테고리 그룹을 처리하면서 그 안의 시리즈 글도 함께 변환
- state.md 체크박스는 시리즈 그룹도 "글 단위 통합 처리 완료"로 마킹
- 글 1개에 두 그룹이 모두 의존하는 경우, decisions.md에 명시

검증된 사례: G6+G16+G17+G18(challenge), G8+G9+G14+G15+G21(monitoring).

### 11.7 트리 블록 처리 정책 명문화

다음은 모두 ` ```text` lang 명시로 보존(SVG 변환 비용 대비 가치 낮음):

- 디렉토리 트리(`├── └──`)
- 의존성 체인 트리 (예: `gopter → goconvey → cobra`)
- 다단계 절차 트리 ([T3] → (1)/(2)/(3))
- 짧은 인라인 흐름 (6~8줄, 박스 없음)

이미 `lang=bash`나 `lang=hcl` 등으로 명시된 코드/설정은 박스 문자가 없는 한 그대로 유지.

### 11.8 SVG 작성 시 주의 사항

실작업에서 발견한 실수 패턴:

- **`<svg>` 속성 중복** — 두 번째 SVG 작성 시 `preserveAspectRatio` 등 속성 중복 주의 (자동완성 실수)
- **CDATA 닫기 괄호** — `]]></style>` (정확히 3개) 외 `]]))]]>` 같은 오타 반복 금지
- **viewBox 비율** — 16:9 근처 권장(`800x480`, `760x420`), 세로 길이 다이어그램은 `800x720` 까지

### 11.9 평탄화 우선순위 가이드 (1.0 보강)

원본 ASCII 블록 → 결정 트리:

1. **PNG/SVG가 본문에 인접** → ASCII 삭제 (자산 중복)
2. **표 형태 (행/열 의미가 명확)** → markdown 표
3. **체크리스트** → 굵은 헤더 + `- [ ]`
4. **인라인 흐름 (1~2줄)** → 본문 인라인 코드 또는 lang=text
5. **사이클/루프/데드락** → SVG (가치 큼)
6. **다단계 흐름 (3개 이상 박스 + 분기)** → SVG (가치 큼)
7. **단순 박스 1~2개** → 굵은 글씨 또는 인라인 코드

---

## 출처

- [C4 model — Notation](https://c4model.com/diagrams/notation)
- [C4 model — Diagrams](https://c4model.com/diagrams)
- [Implementing Accessible SVG Elements (A11Y Collective)](https://www.a11y-collective.com/blog/svg-accessibility/)
- [SVG Accessibility (SVG AI)](https://www.svgai.org/blog/svg-accessibility-inclusive-design)
- [How to make diagrams more accessible (JointJS)](https://www.jointjs.com/blog/diagram-accessibility)
- [Making single-color SVG icons work in dark mode (Hidde)](https://hidde.blog/making-single-color-svg-icons-work-in-dark-mode/)
- [Light/dark style support for SVGs (Cassidy James)](https://cassidyjames.com/blog/prefers-color-scheme-svg-light-dark/)
- [SVGs in dark mode (Jeremy Keith)](https://adactio.medium.com/svgs-in-dark-mode-565ec64004db)
- [Inlining SVGs for Dark Mode (ahelwer)](https://ahelwer.ca/post/2023-04-06-dark-mode/)
- [Adaptive SVG logos (Publii)](https://getpublii.com/docs/prepare-svg-for-light-dark-mode.html)
- [Architecture Diagram Generator (Cocoon-AI)](https://github.com/Cocoon-AI/architecture-diagram-generator/blob/main/README.md)
- [Readability in UX Design (IxDF)](https://ixdf.org/literature/topics/readability-in-ux-design)
