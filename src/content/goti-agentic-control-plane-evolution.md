---
title: "Agentic Control Plane 진화 설계 — passive memory에서 active hypothesizer로"
excerpt: "이미 보유한 Anthropic Harness 6 component 위에 Agentic DevOps / AI SRE 다음 레이어를 도입하기로 결정. 시장 동향·도구 성숙도·인덱스 표준 점검과 함께 Phase 1 Repo Index Layer를 1차 개선으로 착수합니다"
type: troubleshooting
category: "challenge"
tags:
  - go-ti
  - "Agentic AI"
  - "AI SRE"
  - "Claude Code"
  - "harness engineering"
  - concept
  - troubleshooting
series:
  name: "goti-portfolio-meta"
  order: 4
date: "2026-04-29"
---

## 한 줄 요약

> controller가 이미 Harness 6 component를 모두 갖췄으므로, passive memory 단계에서 active hypothesizer(가설 수립 → 증거 쿼리 → 패치 제안) 단계로 진화하는 로드맵을 확정하고 Phase 1 Repo Index Layer를 착수합니다

---

## 🔥 배경: controller 현 단계와 다음 목표

현재 `goti-team-controller`는 **passive memory + 명령형 슬래시 커맨드** 단계까지 도달했습니다.

수동 트리거에만 반응하는 구조로는 누락되는 사각지대가 생깁니다.

- 매일 `/morning-briefing`을 직접 입력해야 합니다
- 로그/메트릭에서 패턴이 쌓여도 시스템이 먼저 알아채지 못합니다
- 해결책 후보를 사람이 직접 찾아야 합니다

다음 목표는 **"능동 에이전트 (sense → think → plan → act → verify)"** 패턴입니다.

2026-02 Anthropic이 "Harness Engineering" framework로 명명한 6 component — Tools / Context / Guardrails / Workflow / Sensors / Self-correcting — 위에, 2026년 들어 빅테크들이 **"Agentic DevOps / AI SRE"**라는 다음 레이어를 본격 구축 중입니다.

controller는 이 6 component를 이미 모두 보유하고 있습니다.

따라서 외부 재구축 없이 **위 레이어로 자연 진화**가 가능합니다.

---

## 🤔 외부 동향: AIOps에서 AI SRE로

### 시장 규모 및 채택률 (2026-04 기준)

Gartner에 따르면 2029년까지 **70%** 기업이 agentic AI 인프라 운영을 채택할 전망입니다(2025년 5% 미만 → 14배 성장).

도입 기업의 평균 성과는 다음과 같습니다.

- MTTR **3배 단축**
- SRE 인건비 **30% 절감**
- ROI **171%**

단, 72~79%의 기업이 테스트/배포를 시도 중이지만 **프로덕션 운영은 9분의 1 수준**입니다. 아직 초기 단계이므로 선점 가치가 있습니다.

### 주요 제품 비교 (2026 상반기 출시)

| 제품 | 출시 | 핵심 패턴 |
|------|------|----------|
| **Azure SRE Agent** | 2026-03-10 GA | latency 탐지 → noisy neighbor 식별 → 노드 drain/cordon → 안정화 검증 → Slack postmortem |
| **New Relic SRE Agent** | 2026 초 | 인시던트 라이프사이클 전체 자율 처리 |
| **GitHub Copilot Coding Agent** | 2026 | sandbox에서 레포 clone → fix 구현 → draft PR 생성 |
| **AWS DevOps Agent** | 2026-04 | 인시던트 자율 대응 |

네 제품 모두 "감지 → 가설 → 패치 → 검증"의 루프를 공통으로 지향합니다.

### 결정적 차이: AIOps vs AI SRE

> "AIOps는 **무엇이** 이상한지 알려줍니다. AI SRE는 **왜** 그런지 알려주고, 점점 **고치기까지** 합니다."

진단 기준은 단순합니다.

> 시스템이 **가설을 세우고 증거를 쿼리해서 검증**하는가, 아니면 모니터링이 이미 보여준 것을 재포장만 하는가?

현재 controller는 **passive memory** — 지난 사실을 기록하고 사람이 조회하는 수준입니다.

다음 controller는 **active hypothesizer** — 로그/메트릭을 읽고 가설을 세운 뒤 패치를 제안하는 수준입니다.

### 인덱스 및 컨텍스트 패턴

LLM이 대규모 코드베이스를 탐색하는 표준이 이미 정착 중입니다.

| 표준 | 형태 | 적용처 |
|------|------|--------|
| **`llms.txt`** | 1문장 요약 + URL 리스트 형식의 markdown | Mintlify, Anthropic, Google 등 채택 |
| **Code Knowledge Graph** | 심볼/참조/의존성을 그래프로 표현 (벡터 검색보다 정확) | Sourcegraph Amp, Augment Code |
| **Enterprise Knowledge Graph** | 회사 전체 컨텍스트를 그래프로 LLM에 주입 | Glean (ChatGPT 대비 약 2배 선호도) |
| **Memory tool** (Anthropic) | 파일 기반 외부 메모리, 컨텍스트 윈도우 외부 보존 | Claude API 2026 beta |
| **Subagent compaction** | 서브에이전트가 자기 컨텍스트에서 읽고 요약만 반환 | Claude Code 기본 |
| **Dream memory consolidation** | 주기적 메모리 압축/프루닝 | Claude Code 시스템 프롬프트 |

이 표준들이 공통으로 가리키는 방향은 **"LLM이 새 세션에서 어디를 파야 하는지 즉시 알 수 있는 인덱스"**입니다.

---

## ✅ controller 현황 진단 + 진화 로드맵

### 이미 보유한 Harness 6 component

| Component | 현황 |
|-----------|------|
| **Tools** | 46 agents |
| **Context** | 209 skills (17 도메인) + MEMORY 100+ 항목 |
| **Guardrails** | 15 rules (path-scoped + global) |
| **Workflow** | 44 commands + 6 workflows |
| **Sensors** | `/log-trouble`, `/log-feedback`, Discord 알림 |
| **Self-correcting** | 주간 사이클 (트러블 + Gemini 갭 → rules/skills) |

6 component가 모두 존재한다는 의미는, **다음 레이어를 추가하는 데 필요한 인프라가 이미 갖춰졌다**는 뜻입니다.

### 비어있는 레이어 (진화 대상)

현재 controller에는 네 가지 레이어가 빠져 있습니다.

첫째, **공개 인덱스**입니다. `llms.txt` / `INDEX.md` / repo-cards 형식의 인덱스가 없어, 새 세션을 시작할 때마다 `find/grep`으로 컨텍스트를 수집해야 합니다. 8개 레포 분리 구조에서 토큰 낭비가 큽니다.

둘째, **이벤트 드리븐 트리거**입니다. cron 기반 morning briefing이 없어 사람이 매일 슬래시 커맨드를 직접 실행해야 합니다. `ScheduleWakeup` / `CronCreate` 도구는 이미 환경에 있지만 미활용 상태입니다.

셋째, **자율 PR 루프**입니다. 가설을 세우고 → 패치를 제안하고 → 사용자 승인 후 draft PR을 생성하는 흐름이 없습니다.

넷째, **Code Knowledge Graph**입니다. 심볼/의존성 수준의 인덱스가 없어 서비스 간 영향 분석이 느립니다.

### 진화 로드맵 (4 Phase)

**Phase 1 — Repo Index Layer (1~2일)**

목적은 LLM이 새 세션에서 "어디를 파야 하는지"를 즉시 알게 하는 것입니다.

```text
goti-team-controller/
├── INDEX.md                        # 컨트롤러 자체 llms.txt
├── docs/repo-cards/
│   ├── README.md                   # 카드 인덱스
│   ├── _template.md                # 표준 카드 템플릿
│   ├── goti-team-controller.md     # self-card
│   ├── goti-server.md
│   ├── goti-front.md
│   ├── goti-k8s.md
│   ├── goti-monitoring.md
│   ├── Goti-Terraform.md
│   ├── Goti-guardrail-server.md
│   ├── Goti-ai.md
│   └── Goti-go.md
└── docs/system-map.yaml            # 서비스 의존 그래프
```

각 repo-card는 frontmatter + 본문으로 구성됩니다.

```yaml
---
repo: goti-server
language: java/go
owner: ress
slo:
  availability: 99.9%
  p95_latency: 200ms
critical_paths: [auth, payment, ticketing]
recent_incidents:
  - 2026-04-19-session-dropout
  - 2026-04-13-go-cutover
last_updated_summary: 2026-04-21
---
# 1줄: 무엇을 하는 서비스
# 핵심 진입점 (라우터/컨트롤러)
# 자주 깨지는 곳 (incident hotspot)
```

**Phase 2 — Morning Briefing Agent (3~5일)**

```text
07:00 cron → metrics-collector skill 실행
  ├─ Loki: 지난 24h 5xx 로그 group-by(service, error_type)
  ├─ Tempo: p95 latency anomaly (baseline 비교)
  ├─ ArgoCD: drift / OutOfSync apps
  └─ GitHub: 24h 내 머지된 PR
       │
       ▼
  Claude (incident-responder agent)
  가설 수립: "어떤 PR이 어떤 에러와 시간적으로 상관?"
       │
       ▼
  Discord 알림: "오늘의 우선순위 3건"
       │
       ▼ (사용자 승인 시)
  Phase 3 트리거
```

필요한 도구(`mcp__kubernetes__*`, `WebFetch`, Discord webhook, `CronCreate`)는 이미 환경에 갖춰져 있습니다.

**Phase 3 — Approval-Gated Auto-Patch (7~10일)**

이슈 감지 후 사람이 Discord에서 승인하면 Claude가 feature 브랜치 + draft PR을 자동 생성합니다. 외부 작업(`gh pr create`, `git push`)은 명시적 승인 이후에만 실행됩니다.

**Phase 4 — Self-Healing (선택, 저위험만)**

K8s drift / 인증서 만료 / HPA 경계처럼 **저위험 + 가역적** 항목만 자율 수정합니다. 컴퓨트 스케일은 영원히 사람 승인이 필요합니다.

### 1차 개선 착수 현황 (2026-04-29)

| 작업 | 파일 | 상태 |
|------|------|------|
| INDEX.md 시드 | `INDEX.md` (루트) | 진행 |
| repo-cards 디렉토리 | `docs/repo-cards/` | 진행 |
| 표준 템플릿 | `docs/repo-cards/_template.md` | 진행 |
| 8개 레포 시드 카드 | `docs/repo-cards/*.md` | 진행 (구조만, 내용은 추후 채움) |
| 슬라이드 05-ai-harness 업데이트 | `slides/pages/05-ai-harness.html` | 진행 |
| MEMORY 인덱스 추가 | `memory/MEMORY.md` + `memory/project_agentic_control_plane.md` | 진행 |

---

## 🧭 선택지 비교

### D1. 인덱싱 도구 선정

| 옵션 | 핵심 아이디어 | 장점 | 한계 |
|------|--------------|------|------|
| A. Sourcegraph (self-hosted) | 강력한 code graph search | 심볼/의존성 정밀 검색 | 유지보수 비용, K8s 추가 부담 |
| B. Glean SaaS | 즉시 사용 가능 | 엔터프라이즈 Knowledge Graph | 비용 발생, 사적 코드 외부 전송 |
| **C. markdown 기반 repo-cards** | 무료, controller 내 자체 보존 | LLM 친화, 비용 $0 | 자동 동기화가 수동 |

**결정 기준 1순위는 "비용 $0 유지"**였습니다. 프로젝트 종료 단계라 신규 인프라 비용을 추가하지 않는 것이 제약 조건이었습니다. markdown repo-cards는 Phase 2에서 cron 기반 자동 동기화를 추가할 수 있으므로 한계도 해소 가능합니다.

### D2. morning briefing 트리거 방식

기존 `/morning-briefing` 슬래시 커맨드 방식 대비 cron 기반 능동 트리거를 선택했습니다.

cron 방식의 이점은 세 가지입니다.

- 사람이 매일 09:00에 깜빡 잊어도 실행됩니다
- 누적 시계열로 anomaly 비교가 가능합니다
- `ScheduleWakeup` / `CronCreate` 도구가 이미 환경에 있습니다

### D3. Phase 1부터 순차 시작 (동시 착수 아닌 이유)

INDEX/repo-cards 없이 morning-briefing을 먼저 만들면 매 실행마다 `find/grep`으로 컨텍스트를 수집해야 합니다. 토큰이 폭증합니다.

인덱스를 먼저 깔면 Phase 2~3의 컨텍스트 수집 비용이 1/N로 줄어듭니다. 따라서 **Phase 1이 Phase 2~3의 부트스트랩 조건**입니다.

---

## 📚 배운 점

- **Harness 6 component가 모두 있다면 "Agentic" 전환은 레이어 추가**입니다. 재구축이 아닙니다. 무엇이 없는지 진단하는 것이 먼저입니다
- **AIOps와 AI SRE의 분기점은 "가설 수립"**입니다. 모니터링 데이터를 요약하는지, 가설을 세우고 증거를 쿼리해서 검증하는지가 핵심입니다
- **인덱스가 없으면 능동 에이전트는 토큰 낭비 기계**입니다. 매 세션마다 `find/grep`으로 컨텍스트를 수집하면 Phase 2~3의 비용이 기하급수적으로 증가합니다. Phase 1이 선행 투자입니다
- **`llms.txt` / repo-cards 패턴은 이미 업계 표준으로 수렴 중**입니다. Mintlify, Anthropic, Google이 채택한 포맷을 따르면 향후 도구 호환성이 높습니다
- **Phase 4(Self-Healing)의 범위는 "저위험 + 가역적"에만 한정**합니다. 컴퓨트 스케일처럼 비용이 유발되거나 되돌리기 어려운 작업은 영구적으로 사람 승인이 필요합니다

## 참고 자료

- [AI SRE 2026 Complete Guide (DEV Community)](https://dev.to/siddharth_singh_409bd5267/ai-sre-the-complete-guide-for-engineering-teams-in-2026-51ba)
- [Top 14 AI SRE Tools 2026 (sherlocks.ai)](https://www.sherlocks.ai/blog/top-ai-sre-tools-in-2026)
- [Agentic DevOps Definitive Guide 2026](https://unanimoustech.com/agentic-devops-trends-2026/)
- [Self-Healing Software Lifecycle (Azure SRE Agent)](https://blog.mikehacker.net/p/agentic-devops-building-a-self-healing-software-lifecycle-with-github-copilot-and-azure-sre-agent/)
- [AWS DevOps Agent for Autonomous Incident Response](https://noise.getoto.net/2026/04/01/leverage-agentic-ai-for-autonomous-incident-response-with-aws-devops-agent/)
- [Anthropic — Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic Memory Tool Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- [Claude Code Advanced Patterns: Subagents/MCP/Scaling](https://resources.anthropic.com/hubfs/Claude%20Code%20Advanced%20Patterns_%20Subagents,%20MCP,%20and%20Scaling%20to%20Real%20Codebases.pdf)
- [llms.txt Complete Guide (gracker.ai)](https://gracker.ai/blog/llms-txt-the-complete-guide-to-making-your-site-ai-readable)
- [Real llms.txt examples (Mintlify)](https://www.mintlify.com/blog/real-llms-txt-examples)
