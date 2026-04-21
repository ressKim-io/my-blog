---
date: 2026-04-19
category: meta
project: ress-claude-agents
tags: [rule, skill, opus-4-7, migration, token-budget, anthropic, prompt-engineering]
---

# Claude Opus 4.7 마이그레이션: token-budget rule + skill 추가, AI skills 4.7 대응

## Context

Anthropic이 2026-04-16 Claude Opus 4.7을 GA 릴리스하면서 Claude Code 기본 모델이 4.6 → 4.7로 업그레이드되었다. 기존 레포(`ress-claude-agents`)에 4.7의 behavioral/API 변경사항이 미반영 상태였고, 사용자가 "어떤 방향으로 개선됐는지 외부 검색해서 필요하면 개선해달라"고 요청했다.

외부 검색·공식 문서 조회로 다음 근거를 확보했다:

- [What's new in Claude Opus 4.7](https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-7)
- [Migration guide](https://platform.claude.com/docs/en/about-claude/models/migration-guide)
- [Task budgets](https://platform.claude.com/docs/en/build-with-claude/task-budgets)
- [Effort parameter](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Best Practices for Claude Code](https://code.claude.com/docs/en/best-practices)
- [Best practices with Opus 4.7 in Claude Code](https://claude.com/blog/best-practices-for-using-claude-opus-4-7-with-claude-code)

## Issue

4.7의 behavioral change 중 기존 프롬프트 패턴과 충돌하는 포인트가 다수 발견되었다.

1. **Literal instruction following** — 4.7은 느슨한 해석을 하지 않음. 한 항목에 대한 지시를 다른 항목에 자동 일반화하지 않음
2. **Subagent 덜 spawn** — 기본적으로 delegation을 줄임. 병렬 fan-out이 필요하면 명시 지시 필요
3. **Tool call 감소, reasoning 증가** — 도구 더 사용을 원하면 effort 상향 또는 명시
4. **자체 검증 내장** — `"double-check before returning"` 같은 scaffolding이 불필요해짐
5. **Progress update 내장** — `"N개마다 요약"` 강제 지시가 중복
6. **Tokenizer 변경** — 같은 텍스트 1.0~1.35x 토큰 사용, 4.6 prompt cache 전부 무효화
7. **API breaking change** — `temperature`, `top_p`, `top_k`, `budget_tokens` 설정 시 400 에러

또한 **토큰·컨텍스트·effort 운영 원칙**이 레포 rules에 명문화되지 않아 매 대화에서 같은 가이드를 반복하는 마찰이 있었다. 기존 `skills/dx/token-efficiency.md`는 Claude Code 세션 내 도구 사용 효율에 특화되어 있어, Opus 4.7 API 측면(effort, task budget, prompt caching)은 별도 문서화가 필요했다.

## Action

### 신규 파일 2개

**1. `.claude/rules/token-budget.md` (68줄, auto-load)**

매 대화에 자동 주입되는 핵심 원칙만 수록.

- Context Window 관리: 80% 경고, `/clear`, `/compact`
- Subagent를 context 절약 도구로 — 10+ 파일 탐색은 위임
- Effort Level 테이블 (xhigh가 코딩·agentic 기본)
- Tokenizer 변경 대응 (35% headroom)
- Adaptive Thinking (Claude Code 자동 / API 명시)
- 5가지 실패 패턴 (Kitchen sink, Over-correction 등)

Rules 적절한 길이 기준을 레포 실측으로 도출: 기존 13개 rules 평균 128줄, sweet spot 100~150줄, 200줄 이상은 skill 분리 검토. 68줄로 `clean-code.md` (75줄)와 유사한 크기 유지.

**2. `.claude/skills/dx/token-budget.md` (436줄, on-demand `/token-budget`)**

상세 가이드·API 코드 예시·비용 계산.

- Effort Level 코드 예시 (Python SDK)
- Task Budget API 사용법 (beta, `task-budgets-2026-03-13` 헤더)
- Prompt Caching 구조 규칙 (정적 → 동적 순서, 불변 블록에 `cache_control`)
- Adaptive Thinking 마이그레이션 (`budget_tokens` → `effort`)
- 비용 계산 시나리오 (cache 적용 전후 46% 절감)
- Writer/Reviewer subagent 패턴

### 수정 파일 3개

- `skills/ai/agentic-coding.md` — "Opus 4.7 Behavior Changes" 섹션 추가 (+14줄, 298 → 312줄)
- `skills/ai/prompt-engineering.md` — "Opus 4.7 프롬프팅 주의사항" 섹션 추가 (+14줄, 435 → 449줄)
- `skills/ai/langchain-langgraph.md` — `claude-sonnet-4-20250514` → `claude-sonnet-4-6` (1줄)

### 메모리 업데이트

- `MEMORY.md` v4.3 섹션 추가 (Opus 4.7 Behavioral Changes 8개 항목 포함)
- `inventory.yml` 자동 재생성 (215 → 216 skills)

### 설계 원칙

`clean-code.md` (75줄 rule) + `/clean-code` (474줄 skill) 분리 선례를 그대로 적용. Rules는 매 대화 자동 로딩되므로 짧게 유지, 상세는 on-demand skill에서. clean-code 패턴의 재사용으로 일관성 확보.

## Result

1. **컨벤션 자동 적용** — `rules/token-budget.md`가 매 대화 주입되어 context 80% 경고, subagent 명시 spawn, effort 레벨 선택 등이 자동 참조됨. 같은 가이드 반복 설명 불필요
2. **API 작업 시 깊이 있는 참조** — Claude API 코드 작성 시 `/token-budget`으로 436줄 상세 가이드 호출 가능 (task budget 코드 예시, prompt caching 구조 규칙 등)
3. **Opus 4.7 behavioral change 대응** — AI skills (agentic-coding, prompt-engineering)에 4.7 특화 주의사항 반영. 기존 사용자도 업데이트 사항 인지 가능
4. **모델 ID 최신화** — langchain 예시가 4.0 시대 ID에서 4.6으로 업데이트되어 copy-paste 시 혼란 제거
5. **메모리 일관성** — MEMORY.md에 v4.3 섹션과 Opus 4.7 Behavioral Changes (8항목) 추가로 향후 세션에도 자동 상기

### 품질 지표

- Rules sweet spot 준수: 68줄 (target 100~150, hard limit 200)
- Skill 500줄 한도 준수: 436줄
- 하드코딩된 4.6 참조 0건 (grep 확인)
- Rules ↔ Skill cross-reference 유효

### Phase C 검증 (수정 불필요 확인)

초기 grep에서 `double-check`, `매 N회` 등 scaffolding 패턴이 3개 파일에서 매칭되었으나 전수 검토 결과 모두 false positive였다.

- `cicd/gitops-argocd.md`: "중간 상태가 배포" (GitOps batch merge 도메인 용어)
- `messaging/kafka-streams.md`: "매 5분 매출" (tumbling window 예시)
- `msa/msa-saga.md`: "PENDING/PROCESSING 중간 상태" (Saga 상태 도메인)

Opus 4.7 scaffolding과 무관한 레거시 도메인 용어로 확인되어 수정하지 않음.

## Related Files

### 신규
- `.claude/rules/token-budget.md` (68줄)
- `.claude/skills/dx/token-budget.md` (436줄)

### 수정
- `.claude/skills/ai/agentic-coding.md` (298 → 312줄)
- `.claude/skills/ai/prompt-engineering.md` (435 → 449줄)
- `.claude/skills/ai/langchain-langgraph.md` (모델 ID 1줄)
- `.claude/inventory.yml` (자동 재생성)

### 메모리
- `~/.claude/projects/-Users-ress-my-file-ress-claude-agents/memory/MEMORY.md` (v4.3 섹션 + Opus 4.7 Behavioral Changes)

### Commit
`ed2ba9e feat(rules,skills): add token-budget for Opus 4.7 migration` — origin/main 반영 완료
