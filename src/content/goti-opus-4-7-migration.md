---
title: "Claude Opus 4.7 마이그레이션 — token-budget rule + skill 추가, AI skills 4.7 대응"
excerpt: "Opus 4.7 GA 이후 Claude Code 기본 모델이 4.6 → 4.7로 바뀌었습니다. Literal instruction following, Subagent 덜 spawn, Tokenizer 변경 등 7가지 동작·API 변경을 정리해 rules·skills에 반영했습니다"
category: challenge
tags:
  - go-ti
  - Meta
  - Claude
  - Opus-4.7
  - Rules
  - Skill
  - Prompt-Engineering
  - retrospective
series:
  name: "goti-meta"
  order: 10
date: "2026-04-19"
---

## 한 줄 요약

> 2026-04-16 Anthropic이 Claude Opus 4.7을 GA 릴리스했고 Claude Code 기본 모델이 4.6 → 4.7로 업그레이드됐습니다. 4.7의 behavioral/API 변경이 기존 프롬프트 패턴과 충돌하는 지점들을 공식 문서로 검증해 `.claude/rules/token-budget.md` (rule, 68줄) + `.claude/skills/dx/token-budget.md` (skill, 436줄)을 신규 작성하고 AI skills 3개를 4.7 대응으로 수정했습니다

---

## 🔥 문제: 4.7 behavioral change가 기존 프롬프트와 충돌했다

기존 레포(`ress-claude-agents`)는 4.7 변경 사항을 아직 반영하지 못한 상태였습니다. 공식 문서(What's new in Claude Opus 4.7, Migration guide, Task budgets, Effort parameter, Prompt caching, Best Practices for Claude Code, Best practices with Opus 4.7 in Claude Code)를 조회해 다음 충돌 포인트를 확인했습니다

1. **Literal instruction following** — 4.7은 느슨한 해석을 하지 않습니다. 한 항목에 대한 지시를 다른 항목에 자동 일반화하지 않습니다
2. **Subagent 덜 spawn** — 기본적으로 delegation을 줄입니다. 병렬 fan-out이 필요하면 **명시 지시**가 필요합니다
3. **Tool call 감소, reasoning 증가** — 도구 더 사용을 원하면 effort 상향 또는 명시 지시가 필요합니다
4. **자체 검증 내장** — `"double-check before returning"` 같은 scaffolding이 불필요해졌습니다
5. **Progress update 내장** — `"N개마다 요약"` 강제 지시가 중복입니다
6. **Tokenizer 변경** — 같은 텍스트가 1.0~1.35x 토큰을 사용합니다. 4.6 prompt cache가 **전부 무효화**됩니다
7. **API breaking change** — `temperature`, `top_p`, `top_k`, `budget_tokens` 설정 시 400 에러가 발생합니다

### 추가 마찰: 운영 원칙이 문서화되어 있지 않았다

**토큰·컨텍스트·effort 운영 원칙**이 레포 rules에 명문화되어 있지 않아, 매 대화에서 같은 가이드를 반복해서 설명해야 하는 부담이 있었습니다. 기존 `skills/dx/token-efficiency.md`는 Claude Code 세션 안에서 도구 사용 효율에 특화되어 있었고, Opus 4.7 API 측면(effort, task budget, prompt caching)은 별도 문서가 필요했습니다

---

## 🤔 원인: rule/skill 분리가 필요한 크기의 변경이었다

Opus 4.7 관련 가이드는 두 축으로 나뉘었습니다

- **매 대화에 자동 주입되어야 할 핵심 원칙** (짧고, 항상 참조 가능해야 함) → **rule**
- **API 코드 작성 시 참조해야 할 상세 가이드** (길고, on-demand 호출) → **skill**

`clean-code.md` (75줄 rule) + `/clean-code` (474줄 skill) 분리 선례를 그대로 적용했습니다
Rules는 매 대화 자동 로딩되므로 짧게 유지하고, 상세는 on-demand skill에서 호출하는 구조입니다

Rules의 적절한 길이 기준은 레포 실측으로 도출했습니다

- 기존 13개 rules 평균 **128줄**
- Sweet spot **100~150줄**
- 200줄 이상은 skill 분리 검토

이 기준에 맞춰 token-budget rule은 68줄로 작성해 `clean-code.md` (75줄)와 유사한 크기를 유지했습니다

---

## ✅ 해결: 신규 2파일 + 수정 3파일

### 신규 파일 2개

**1. `.claude/rules/token-budget.md` (68줄, auto-load)**

매 대화에 자동 주입되는 핵심 원칙만 담았습니다

- Context Window 관리: 80% 경고, `/clear`, `/compact`
- Subagent를 context 절약 도구로 활용 — 10+ 파일 탐색은 위임
- Effort Level 테이블 (xhigh가 코딩·agentic 기본)
- Tokenizer 변경 대응 (35% headroom)
- Adaptive Thinking (Claude Code는 자동 / API는 명시 지정)
- 5가지 실패 패턴 (Kitchen sink, Over-correction 등)

**2. `.claude/skills/dx/token-budget.md` (436줄, on-demand `/token-budget`)**

상세 가이드·API 코드 예시·비용 계산을 담았습니다

- Effort Level 코드 예시 (Python SDK)
- Task Budget API 사용법 (beta, `task-budgets-2026-03-13` 헤더)
- Prompt Caching 구조 규칙 (정적 → 동적 순서, 불변 블록에 `cache_control`)
- Adaptive Thinking 마이그레이션 (`budget_tokens` → `effort`)
- 비용 계산 시나리오 (cache 적용 전후 **46% 절감**)
- Writer/Reviewer subagent 패턴

### 수정 파일 3개

- `skills/ai/agentic-coding.md` — "Opus 4.7 Behavior Changes" 섹션 추가 (+14줄, 298 → 312줄)
- `skills/ai/prompt-engineering.md` — "Opus 4.7 프롬프팅 주의사항" 섹션 추가 (+14줄, 435 → 449줄)
- `skills/ai/langchain-langgraph.md` — `claude-sonnet-4-20250514` → `claude-sonnet-4-6` (1줄)

### 메모리 업데이트

- `MEMORY.md` v4.3 섹션 추가 (Opus 4.7 Behavioral Changes 8개 항목 포함)
- `inventory.yml` 자동 재생성 (215 → 216 skills)

---

## Result

- **컨벤션 자동 적용** — `rules/token-budget.md`가 매 대화 주입되어 context 80% 경고, subagent 명시 spawn, effort 레벨 선택이 자동 참조됩니다. 같은 가이드를 반복 설명할 필요가 없어졌습니다
- **API 작업 시 깊이 있는 참조** — Claude API 코드 작성 시 `/token-budget`으로 436줄 상세 가이드를 호출할 수 있습니다
- **Opus 4.7 behavioral change 대응** — AI skills(agentic-coding, prompt-engineering)에 4.7 특화 주의사항이 반영됐습니다
- **모델 ID 최신화** — langchain 예시가 4.0 시대 ID에서 4.6으로 업데이트돼 copy-paste 혼란이 제거됐습니다

### 품질 지표

- Rules sweet spot 준수: **68줄** (target 100~150, hard limit 200)
- Skill 500줄 한도 준수: **436줄**
- 하드코딩된 4.6 참조 **0건** (grep 확인)
- Rules ↔ Skill cross-reference 유효

### Phase C 검증 (수정 불필요 확인)

초기 grep에서 `double-check`, `매 N회` 등 scaffolding 패턴이 3개 파일에서 매칭됐으나, 전수 검토 결과 모두 false positive였습니다

- `cicd/gitops-argocd.md`: "중간 상태가 배포" (GitOps batch merge 도메인 용어)
- `messaging/kafka-streams.md`: "매 5분 매출" (tumbling window 예시)
- `msa/msa-saga.md`: "PENDING/PROCESSING 중간 상태" (Saga 상태 도메인)

Opus 4.7 scaffolding과 무관한 레거시 도메인 용어로 확인되어 수정하지 않았습니다

---

## 📚 배운 점

- **모델 업그레이드는 "rule 1건 + skill 1건 + AI skills 수정 2~3건"이 기본 패턴입니다** — 핵심 원칙은 rule, 상세 API 코드는 skill, 기존 AI skills는 동작 변경 섹션 추가로 대응합니다
- **Rules는 레포 실측으로 길이 기준을 정합니다** — "평균 128줄, sweet spot 100~150줄, hard limit 200줄"처럼 레포 실제 분포에서 끌어낸 기준이라야 다른 팀원·세션에도 설득력을 갖습니다
- **`clean-code.md` + `/clean-code` 같은 rule/skill 분리 선례를 재사용합니다** — 일관된 구조는 유지보수 비용을 낮춥니다
- **Phase C 검증으로 false positive를 걸러냅니다** — grep 패턴이 매칭되었다고 곧바로 수정에 들어가지 말고 **전수 검토**로 도메인 용어와 scaffolding을 구분해야, 의미 없는 수정이 커밋에 섞이지 않습니다
- **공식 문서 URL 목록을 저장합니다** — 이번 작업처럼 7개 공식 문서를 한 번에 참조한 기록이 남아 있어야 다음 마이너 업데이트(4.7.x)에서도 같은 체크리스트로 재점검할 수 있습니다
