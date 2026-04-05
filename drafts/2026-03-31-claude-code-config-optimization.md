---
date: 2026-03-31
category: meta
project: goti-team-controller
tags: [rule, skill, memory, optimization, context-window]
---

# Claude Code 설정 최적화 — Rules path-scoping + MEMORY 압축 + documentation 분리

## Context
Claude Code가 skills, agents, rules, memory를 제대로 읽지 못하는 현상 발생. 세션 시작 시 context window 소모량 조사 후 전체 설정 최적화 수행.

## Issue
- **Rules 15개(2,501줄)가 전부 시작 시 로드** → ~20K 토큰 소모. 특히 `documentation.md`가 785줄(템플릿 모음집)
- **MEMORY.md 200줄 제한 초과**(257줄) → 최근 57줄 잘려서 활성 프로젝트 정보 누락
- **controller CLAUDE.md**가 103줄로 `.claude/` 인벤토리를 중복 나열 (파일시스템에서 발견 가능)
- Skill description 250자 초과 1건 (잘림 발생)

## Action

### Phase 1: MEMORY.md 정리 (257→101줄)
- 인라인 상세(OTel 17줄, PR 규칙 29줄 등)를 전부 토픽 파일로 분리
- 항목당 1줄 인덱스 방식으로 전면 재작성
- 신규 토픽 파일 6개 생성: `project_otel_monitoring.md`, `project_e2e_test_status.md`, `project_image_tag_update.md`, `decision_pii_masking.md`, `project_repos_and_deploy.md`, `project_k8s_architecture.md`

### Phase 2: Rules 경량화 (시작 시 2,501→566줄, -77%)
- **documentation.md 분리**: 785줄 → 47줄 rule(트리거만) + 155줄 skill(`dx/documentation-templates.md`)
- **Path-scoped 전환 7개**: monitoring(`**/monitoring/**`), testing(`**/*test*`), code-review(`**/.github/**`), debugging(`**/debug*`), java/spring/go(기존)
- **git.md 압축**: 196→50줄 (이슈 생성 예시 등 중복 제거)
- **cloud-cli-safety.md 압축**: 202→10줄 (전부 HTML 주석이었으므로 핵심 원칙만)

### Phase 3: Skill description 점검
- 209개 skill 중 250자 초과 1건 수정: `observability-reviewer` 259→199자

### Phase 4: CLAUDE.md 최적화
- controller CLAUDE.md: 103→31줄 (에이전트/스킬/커맨드 전체 목록 제거, 요약 테이블로 대체)

## Result

| 구성요소 | Before | After | 변화 |
|----------|--------|-------|------|
| MEMORY.md | 257줄 (57줄 잘림) | 101줄 (전부 로드) | -61% |
| Rules (시작 시 로드) | 2,501줄 | 566줄 | -77% |
| CLAUDE.md (controller) | 103줄 | 31줄 | -70% |
| 시작 시 토큰 합계 | ~40,000 | ~20,600 | -48% |
| Skill desc >250자 | 1건 | 0건 | 수정 |

핵심 효과: **시작 시 context window 토큰 48% 절감**, memory 잘림 문제 해소, path-scoped rules로 불필요한 규칙 로딩 방지.

## Related Files
- `.claude/rules/documentation.md` — 785→47줄 (트리거만 남김)
- `.claude/skills/dx/documentation-templates.md` — 신규 (템플릿 이동)
- `.claude/rules/monitoring.md` — paths frontmatter 추가
- `.claude/rules/testing.md` — paths frontmatter 추가
- `.claude/rules/code-review.md` — paths frontmatter 추가
- `.claude/rules/debugging.md` — paths frontmatter 추가
- `.claude/rules/git.md` — 196→50줄 압축
- `.claude/rules/cloud-cli-safety.md` — 202→10줄 압축
- `.claude/agents/observability-reviewer.md` — description 259→199자
- `CLAUDE.md` (controller) — 103→31줄 축약
- `memory/MEMORY.md` — 전면 재작성 (257→101줄)
- `memory/project_otel_monitoring.md` — 신규 토픽 파일
- `memory/project_e2e_test_status.md` — 신규 토픽 파일
- `memory/project_image_tag_update.md` — 신규 토픽 파일
- `memory/decision_pii_masking.md` — 신규 토픽 파일
- `memory/project_repos_and_deploy.md` — 신규 토픽 파일
- `memory/project_k8s_architecture.md` — 신규 토픽 파일
