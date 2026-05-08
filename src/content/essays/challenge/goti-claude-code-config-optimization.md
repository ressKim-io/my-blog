---
title: "Claude Code 설정 최적화 — 시작 시 컨텍스트 토큰 48% 절감"
excerpt: "Rules 2,501줄 자동 로드, MEMORY.md 200줄 초과 잘림, CLAUDE.md 중복 인벤토리 문제를 path-scoping + 토픽 분리 + skill 분리로 정리했습니다"
category: challenge
tags:
  - go-ti
  - Meta
  - Claude
  - Rules
  - Memory
  - Context-Window
  - AI-Workflow
  - retrospective
series:
  name: "goti-meta"
  order: 6
date: "2026-03-31"
---

## 한 줄 요약

> Claude Code가 skills/agents/rules/memory를 제대로 읽지 못하는 현상을 추적한 결과, 시작 시 자동 로드 토큰이 ~40,000에 달했습니다. Rules path-scoping, MEMORY.md 토픽 분리, `documentation.md`의 skill 분리, `CLAUDE.md` 축약으로 **시작 시 토큰을 ~48% 절감(40K → 20.6K)**했습니다

---

## 🔥 문제: 시작 시 토큰이 너무 커서 리소스들이 잘려 나갔다

Claude Code 세션을 시작할 때 여러 증상이 있었습니다

- **Rules 15개(2,501줄)가 전부 시작 시 로드**되어 약 20K 토큰을 소모했습니다. 특히 `documentation.md`가 785줄로 템플릿 모음집이었습니다
- **MEMORY.md가 200줄 제한을 초과**(257줄)해 최근 57줄이 잘려 나갔습니다. 활성 프로젝트 정보가 누락되는 경우가 있었습니다
- **controller `CLAUDE.md`가 103줄**이었는데 `.claude/` 인벤토리를 중복 나열하고 있었습니다(파일시스템에서 어차피 발견 가능합니다)
- **Skill description 250자 초과 1건**(잘림 발생)이 있었습니다

증상은 "Claude가 특정 규칙을 따르지 않는다"였지만, 근본 원인은 컨텍스트 윈도 과소모였습니다

---

## 🤔 원인: "전부 로드"와 "무제한 인라인" 설계

Rules는 설계상 **매 대화에 자동 주입**되는 구조입니다
그런데 `documentation.md`처럼 트리거(언제 적용할지)와 상세 템플릿이 한 파일에 섞여 있으면, 트리거만 필요한 대화에도 템플릿 785줄이 전부 주입됩니다

MEMORY.md는 인덱스여야 하는데 상세를 인라인으로 가지고 있어 200줄 한도를 넘겼습니다
OTel 설명 17줄, PR 규칙 29줄 등이 인덱스에 통째로 들어가 있었습니다

`CLAUDE.md`는 "에이전트 1, 스킬 2, 커맨드 3"을 목록으로 나열해, 파일시스템 조회로 대체 가능한 정보를 시작 토큰에 포함했습니다

---

## ✅ 해결: 4단계 최적화

### Phase 1: MEMORY.md 정리 (257 → 101줄)

- 인라인 상세 전부를 토픽 파일로 분리
- 항목당 1줄 인덱스 방식으로 전면 재작성
- 신규 토픽 파일 6개 생성
  - `project_otel_monitoring.md`
  - `project_e2e_test_status.md`
  - `project_image_tag_update.md`
  - `decision_pii_masking.md`
  - `project_repos_and_deploy.md`
  - `project_k8s_architecture.md`

인덱스는 "어디에 뭐가 있는지"만 알려주고, 상세는 **필요할 때** 개별 파일을 읽는 구조로 바꿨습니다

### Phase 2: Rules 경량화 (시작 시 2,501 → 566줄, -77%)

핵심 변화 세 가지였습니다

**① `documentation.md` 분리 (785줄 → rule 47줄 + skill 155줄)**

- 트리거(언제 로드할지)만 rule에 남김
- 상세 템플릿은 `dx/documentation-templates.md` skill로 이동
- 평소에는 47줄만 로드, 필요할 때 155줄 skill 호출

**② Path-scoped 전환 7개**

- `monitoring` → `**/monitoring/**`
- `testing` → `**/*test*`
- `code-review` → `**/.github/**`
- `debugging` → `**/debug*`
- `java`/`spring`/`go` → 기존 유지

파일 패턴에 해당 컨텍스트가 있을 때만 로드되므로, 관련 없는 세션에선 아예 로드되지 않습니다

**③ 기타 압축**

- `git.md`: 196 → 50줄 (이슈 생성 예시 등 중복 제거)
- `cloud-cli-safety.md`: 202 → 10줄 (HTML 주석이 202줄 중 대부분이어서 핵심 원칙만 남김)

### Phase 3: Skill description 점검

209개 skill 중 250자 초과 1건(`observability-reviewer` 259자)을 199자로 수정했습니다

### Phase 4: CLAUDE.md 축약 (103 → 31줄)

에이전트·스킬·커맨드 전체 목록 제거, 요약 테이블로 대체했습니다
전체 목록은 `.claude/` 조회로 항상 확인 가능하므로 중복이었습니다

---

## Result 수치

| 구성요소 | Before | After | 변화 |
|----------|--------|-------|------|
| MEMORY.md | 257줄 (57줄 잘림) | 101줄 (전부 로드) | -61% |
| Rules (시작 시 로드) | 2,501줄 | 566줄 | -77% |
| CLAUDE.md (controller) | 103줄 | 31줄 | -70% |
| 시작 시 토큰 합계 | ~40,000 | ~20,600 | **-48%** |
| Skill desc >250자 | 1건 | 0건 | 수정 |

핵심 효과는 세 가지였습니다

- **시작 시 컨텍스트 토큰 48% 절감** — 같은 대화를 더 길게 이어갈 수 있습니다
- **MEMORY.md 잘림 문제 해소** — 200줄 한도 안으로 들어와 전부 로드됩니다
- **Path-scoped rules로 불필요한 규칙 로딩 방지** — 프론트엔드 작업에 모니터링 규칙이 섞이지 않습니다

---

## 📚 배운 점

- **"자동 로드"되는 리소스는 두 번 의심합니다.** Rules처럼 매 대화에 주입되는 리소스는 줄수가 토큰 비용으로 직결됩니다. 템플릿·예시는 skill로 빼고 트리거만 남깁니다
- **MEMORY.md는 인덱스입니다.** 상세를 넣으면 200줄 한도에서 잘리고 최근 정보가 사라집니다. 인덱스 1줄 + 토픽 파일 분리가 기본 패턴입니다
- **Path-scoped rules는 큰 수익을 냅니다.** 모든 세션에서 모든 규칙이 필요하지는 않습니다. `paths` frontmatter로 범위를 지정하면 관련 없는 대화에서 아예 로드를 건너뜁니다
- **중복 인벤토리는 제거합니다.** `CLAUDE.md`에 에이전트·스킬·커맨드 목록을 수동으로 나열할 필요가 없습니다. 파일시스템에서 항상 최신을 조회할 수 있습니다
- **수치 측정이 설득력을 만듭니다.** "최적화했다"가 아니라 "시작 시 토큰 48% 절감"이라는 수치가 있어야 다음 세션에서도 같은 원칙을 지키게 됩니다
