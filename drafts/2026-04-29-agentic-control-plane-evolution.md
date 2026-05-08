# 2026-04-29 — Agentic Control Plane 진화 설계: controller 1차 개선 착수

## 배경

현재 `goti-team-controller`는 **passive memory + 명령형 슬래시 커맨드** 단계까지 도달.
다음 단계로 **"능동 에이전트 (sense → think → plan → act → verify)"** 패턴 도입을 결정.

근거: 2026-02 Anthropic이 "Harness Engineering" framework로 명명한 6 component (Tools / Context / Guardrails / Workflow / Sensors / Self-correcting) 위에, **2026 들어 빅테크들이 "Agentic DevOps / AI SRE" 라는 다음 레이어**를 본격 구축 중. controller는 이미 6 component를 모두 보유하고 있으므로 **다음 레이어로 자연 진화 가능**.

## 외부 동향 (2026-04 기준 검증 완료)

### 시장 규모 / 채택률

- Gartner: 2029년까지 **70%** 기업이 agentic AI 인프라 운영 (2025년 5% 미만 → 14배 성장)
- 도입 기업 평균 MTTR **3배 단축**, SRE 인건비 **30% 절감**, ROI **171%**
- 단, 72-79% 기업이 테스트/배포 시도 중이지만 **9분의 1만 프로덕션 운영** — 아직 초기 단계, 선점 가치 있음

### 주요 제품 (모두 2026 상반기 출시)

| 제품 | 출시 | 핵심 패턴 |
|------|------|----------|
| **Azure SRE Agent** | 2026-03-10 GA | latency 탐지 → noisy neighbor 식별 → 노드 drain/cordon → 안정화 검증 → Slack postmortem |
| **New Relic SRE Agent** | 2026 초 | 인시던트 라이프사이클 전체 자율 |
| **GitHub Copilot Coding Agent** | 2026 | sandbox에서 레포 clone → fix 구현 → draft PR (사용자 비전과 거의 일치) |
| **AWS DevOps Agent** | 2026-04 | 인시던트 자율 대응 |

### 결정적 차이: AIOps vs AI SRE

> "AIOps는 **무엇이** 이상한지 알려준다. AI SRE는 **왜** 그런지 알려주고, 점점 **고치기까지** 한다."
> 진단 기준: 시스템이 **가설을 세우고 증거를 쿼리해서 검증**하는가? 아니면 모니터링이 이미 보여준 걸 재포장만 하는가?

현재 controller = passive memory (지난 사실 기록).
다음 controller = active hypothesizer (로그/메트릭 → 가설 → 패치 제안).

### 인덱스/컨텍스트 패턴 (사용자가 직감한 그 개념)

표준이 이미 정착 중:

| 표준 | 형태 | 적용처 |
|------|------|--------|
| **`llms.txt`** | 1문장 요약 + URL 리스트의 markdown | Mintlify, Anthropic, Google 등 채택 |
| **Code Knowledge Graph** | 심볼/참조/의존성을 그래프로 (벡터 검색보다 정확) | Sourcegraph Amp, Augment Code |
| **Enterprise Knowledge Graph** | 회사 전체 컨텍스트를 그래프로 LLM 주입 | Glean (ChatGPT 대비 ~2배 선호도) |
| **Memory tool** (Anthropic) | 파일 기반 외부 메모리, 컨텍스트 윈도우 외부 보존 | Claude API 2026 beta |
| **Subagent compaction** | 서브에이전트가 자기 컨텍스트에서 읽고 요약만 반환 | Claude Code 기본 |
| **Dream memory consolidation** | 주기적 메모리 압축/프루닝 | Claude Code 시스템 프롬프트 |

## controller 현황 진단

### 이미 보유 (Harness 6 component)
- Tools: 46 agents
- Context: 209 skills (17 도메인) + MEMORY 100+ 항목
- Guardrails: 15 rules (path-scoped + global)
- Workflow stamps: 44 commands + 6 workflows
- Sensors: `/log-trouble`, `/log-feedback`, Discord 알림
- Self-correcting: weekly cycle (트러블 + Gemini 갭 → rules/skills)

### 비어있는 레이어
- **공개 인덱스** (`llms.txt` / `INDEX.md` / repo-cards) — 부재
- **이벤트 드리븐 트리거** (cron 기반 morning briefing) — `ScheduleWakeup` / `CronCreate` 도구는 있으나 미활용
- **자율 PR 루프** (가설 → 패치 → 사용자 승인 → PR draft) — 부재
- **Code Knowledge Graph** (심볼/의존성) — 부재 (8개 레포 분리 구조라 더 필요)

## 진화 로드맵 (4 Phase)

### Phase 1 — Repo Index Layer (오늘 착수, 1~2일)

목적: LLM이 새 세션에서 **"어디를 파야할지"** 즉시 알게.

```
goti-team-controller/
├── INDEX.md                          # 컨트롤러 자체 llms.txt
├── docs/repo-cards/
│   ├── README.md                     # 카드 인덱스
│   ├── _template.md                  # 표준 카드 템플릿
│   ├── goti-team-controller.md       # self-card
│   ├── goti-server.md
│   ├── goti-front.md
│   ├── goti-k8s.md
│   ├── goti-monitoring.md
│   ├── Goti-Terraform.md
│   ├── Goti-guardrail-server.md
│   ├── Goti-ai.md
│   └── Goti-go.md
└── docs/system-map.yaml              # 서비스 의존 그래프 (mermaid 자동 렌더용)
```

각 카드는 frontmatter + 본문:
```yaml
---
repo: goti-server
language: java/go
owner: ress
slo: { availability: 99.9%, p95_latency: 200ms }
critical_paths: [auth, payment, ticketing]
recent_incidents: [2026-04-19-session-dropout, 2026-04-13-go-cutover]
last_updated_summary: 2026-04-21
---
# 1줄: 무엇을 하는 서비스
# 핵심 진입점 (라우터/컨트롤러)
# 자주 깨지는 곳 (incident hotspot)
```

### Phase 2 — Morning Briefing Agent (3~5일)

```
07:00 cron → metrics-collector skill 실행
  ├─ Loki: 지난 24h 5xx 로그 group-by(service, error_type)
  ├─ Tempo: p95 latency anomaly (baseline 비교)
  ├─ ArgoCD: drift / OutOfSync apps
  └─ GitHub: 24h 내 머지된 PR
       │
       ▼
  Claude (incident-responder agent)
       │ 가설: "어떤 PR이 어떤 에러와 시간적으로 상관?"
       ▼
  Discord 알림: "오늘의 우선순위 3건"
       │
       ▼ (사용자 👍 반응 시)
  Phase 3 트리거
```

도구는 이미 다 있음: `mcp__kubernetes__*`, `WebFetch`, Discord webhook, `CronCreate`.

### Phase 3 — Approval-Gated Auto-Patch (7~10일)

```
이슈 감지 → 패치 제안서 (diff + risk + rollback)
  → 사용자 Discord에서 "/approve goti-server PR-fix-498"
  → Claude가 feature 브랜치 + draft PR + /review-pr 자동 호출
  → 사용자 최종 머지
```

`user-approval.md` 룰과 자연 결합. 외부 작업(`gh pr create`, `git push`)은 사용자 명시 승인 후만.

### Phase 4 — Self-Healing (선택, 저위험만)

K8s drift / 인증서 만료 / HPA 경계 같은 **저위험 + 가역적** 항목만 자율 수정.
컴퓨트 스케일은 영원히 사람 승인 (2026-04-13 사고 교훈, `cloud-cli-safety.md`).

## 1차 개선 착수 (오늘 — 2026-04-29)

| 작업 | 파일 | 상태 |
|------|------|------|
| INDEX.md 시드 | `INDEX.md` (루트) | 진행 |
| repo-cards 디렉토리 | `docs/repo-cards/` | 진행 |
| 표준 템플릿 | `docs/repo-cards/_template.md` | 진행 |
| 8개 레포 시드 카드 | `docs/repo-cards/*.md` | 진행 (구조만, 내용은 추후 채움) |
| 슬라이드 05-ai-harness 업데이트 | `slides/pages/05-ai-harness.html` | 진행 |
| MEMORY.md 인덱스 추가 | `memory/MEMORY.md` + `memory/project_agentic_control_plane.md` | 진행 |

## 의사결정 로그

### D1. 왜 별도 indexing 도구(Sourcegraph 등) 도입 안 함

| 후보 | 장점 | 단점 | 결정 |
|------|------|------|------|
| Sourcegraph (self-hosted) | 강력한 graph search | 유지보수 비용, K8s 추가 부담 | **기각** — 8 레포 규모에 과도 |
| Glean SaaS | 즉시 사용 | 비용, 사적 코드 외부 전송 | **기각** |
| **markdown 기반 repo-cards** | 무료, controller에 자체 보존, LLM 친화 | 자동 동기화 수동 | **채택** — Phase 2에서 cron sync 추가 가능 |

근거: 프로젝트 종료 단계 + 비용 $0 유지 메모리(`feedback_no_cost_action_without_approval`).

### D2. 왜 cron 기반 능동 에이전트인가

기존 `/morning-briefing` 슬래시 커맨드 방식 대비:
- 사람이 매일 09:00에 깜빡 잊지 않음
- 누적 시계열로 anomaly 비교 가능
- ScheduleWakeup / CronCreate 도구가 이미 환경에 있음

### D3. 왜 Phase 1부터 시작 (모두 동시 X)

부트스트랩 비용. INDEX/cards 없이 morning-briefing을 만들면 매번 `find/grep`으로 컨텍스트 수집 → 토큰 폭증. 인덱스 먼저 깔면 Phase 2~3 비용이 1/N로 떨어짐.

## 다음 액션

- [ ] INDEX.md 시드 작성
- [ ] repo-cards 8장 골격 (frontmatter + section heading만)
- [ ] system-map.yaml 의존 그래프 1차 작성
- [ ] 슬라이드 05-ai-harness 업데이트 (timeline NEXT → NOW)
- [ ] MEMORY 인덱스 갱신
- [ ] Phase 2 morning-briefing skill 설계는 별도 SDD로 분리

## 외부 검색 출처

- [AI SRE 2026 Complete Guide (DEV Community)](https://dev.to/siddharth_singh_409bd5267/ai-sre-the-complete-guide-for-engineering-teams-in-2026-51ba)
- [Top 14 AI SRE Tools 2026 (sherlocks.ai)](https://www.sherlocks.ai/blog/top-ai-sre-tools-in-2026)
- [Agentic DevOps Definitive Guide 2026](https://unanimoustech.com/agentic-devops-trends-2026/)
- [Self-Healing Software Lifecycle (Azure SRE Agent)](https://blog.mikehacker.net/p/agentic-devops-building-a-self-healing-software-lifecycle-with-github-copilot-and-azure-sre-agent/)
- [AWS DevOps Agent for Autonomous Incident Response](https://noise.getoto.net/2026/04/01/leverage-agentic-ai-for-autonomous-incident-response-with-aws-devops-agent/)
- [Sourcegraph Code Graph](https://sourcegraph.com/)
- [Glean Knowledge Graph as Agentic Engine](https://www.glean.com/blog/knowledge-graph-agentic-engine)
- [Repository Intelligence in AI Coding Tools 2026](https://www.buildmvpfast.com/blog/repository-intelligence-ai-coding-codebase-understanding-2026)
- [Anthropic — Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic Memory Tool Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- [Claude Code Advanced Patterns: Subagents/MCP/Scaling](https://resources.anthropic.com/hubfs/Claude%20Code%20Advanced%20Patterns_%20Subagents,%20MCP,%20and%20Scaling%20to%20Real%20Codebases.pdf)
- [llms.txt Complete Guide (gracker.ai)](https://gracker.ai/blog/llms-txt-the-complete-guide-to-making-your-site-ai-readable)
- [Real llms.txt examples (Mintlify)](https://www.mintlify.com/blog/real-llms-txt-examples)
- [Debugging Production Issues with AI Agents (OpenHands + Datadog)](https://openhands.dev/blog/debugging-production-issues-with-ai-agents-automating-datadog-error-analysis)

## 관련 메모리

- `feedback_no_cost_action_without_approval.md` — 비용 유발 액션 사전 승인
- `feedback_portfolio_self_pitch.md` — 자기 어필 원칙 (포트폴리오 슬라이드 업데이트에 적용)
- `feedback_smaller_commits.md` — 커밋 단위 4~5 파일
- `project_timeline_end_next_week.md` — 프로젝트 종료 단계 → 신규 인프라 비용 0 유지
