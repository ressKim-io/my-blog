---
date: 2026-04-29
category: decision
project: goti-team-controller
tags: [agentic-control-plane, dev-logs, lifecycle, tier-policy, memory-consolidation]
tier: 1
importance: major
status: open
related:
  - dev-logs/2026-04-29-agentic-control-plane-evolution.md
  - memory/project_agentic_control_plane.md
  - memory/project_devlog_tier_policy.md
---

# dev-logs Tier 정책 — Agentic Control Plane Phase 1.6 SDD

## Context

Phase 1.5 (`/consolidate-memory` + `/where` + `/related` 추가, AGENTS.md + symlink, MEMORY.md 다이어트) 완료 후, **151개 dev-logs의 Tier 분류 정책**이 미정. 단순 시간 기반 demote는 우리 컨텍스트에 부적합 (프로젝트 종료, 시간 분포 2개월에 집중).

학계/업계 패턴을 외부 검색으로 조사 후 4-Tier 정책 + frontmatter 표준 + 자동화 커맨드 설계.

## 외부 검색 결과 (2026-04 기준)

### 산업 표준 — Storage Tiering
- Hot → Warm: 7~14일 / Warm → Cold: 45~90일 / Cold → Delete: 보존 만료
- 모든 archived asset은 **searchable metadata 유지**
- 출처: Atlan / Cloudian / Microsoft Purview

### 학계 — AI Agent Memory (2026)
| 패턴 | 의미 |
|------|------|
| **OS memory hierarchy 모방** | main context = RAM, external = disk, agent가 swap 제어 |
| **FadeMem (LML + SML)** | 중요도 기반 2-tier — Long-term decay 느림, Short-term decay 빠름 |
| **Importance Score** | LLM이 incoming info에 점수 매김 → tenuring 결정 |
| **Sleep-time computation** | 유휴 시간 메모리 정리 (cron-based) — `/consolidate-*` 패턴과 동형 |
| **Episodic → Semantic** | dev-log(episodic) → ADR/skill(semantic) 승격 |

### Engineering ILM 5단계
Creation → Storage → Usage → **Archival** → Deletion. 엔지니어링 firm 사례: 프로젝트 종료 1년 후 자동 archival, 메타데이터 검색 유지.

## 우리 컨텍스트 분석 (2026-04-29 측정)

| 지표 | 값 |
|------|-----|
| dev-logs 총량 | 150 files |
| 시간 분포 | 2026-03 (70) + 2026-04 (80), 2개월 집중 |
| 가장 오래된 | 47일 (60일 stale 룰 적용 무력) |
| 클러스터 (같은 주제 2~3건) | redis(3), otel(3), sot(4), istio(2), ecr(2), db(2), dashboard(2), crashloop(2), ticketing(2), label(2) 등 |

→ 시간 기반 demote는 의미 약함. **상태 + 중요도 + 클러스터 기반** 으로 재설계.

## 4-Tier 정책

### Tier 1 — Active (검색 우선, Hot)
- 조건: `status: open` OR active 메모리/카드와 연결
- 인덱스: `docs/dev-logs/INDEX-active.md` (10건 이내 유지)
- `/where`, `/related` 결과 상단

### Tier 2 — Reference (Warm, 패턴/교훈 가치)
- 조건: `status: resolved` + (`importance: critical|major` OR ADR/카드에서 인용)
- 인덱스: `docs/dev-logs/INDEX-by-topic.md` (incident/decision/migration 카테고리별)
- 클러스터 3건+ 같은 주제는 통합 dev-log로 승격 검토

### Tier 3 — Historical (Cold, 가끔 참조)
- 조건: `status: resolved` + 60일+ 미참조 + `importance: minor`
- 메타데이터만 인덱스 (title + date + tags), 본문은 grep으로만 발견

### Tier 4 — Superseded (완전 대체, Archive)
- 조건: `status: superseded`, `replaced_by` 명시
- `docs/dev-logs/_archive/` 이동
- 인덱스 제거, 단 `replaced_by` forward link는 새 자료에 보존

## Frontmatter 표준

```yaml
---
date: YYYY-MM-DD
category: troubleshoot | decision | migration | meta
tier: 1 | 2 | 3 | 4
importance: critical | major | minor
status: open | resolved | superseded
tags: [tag1, tag2]
related:
  - dev-logs/YYYY-MM-DD-...md
  - adr/NNNN-...md
  - memory/...md
replaced_by: dev-logs/YYYY-MM-DD-...md   # superseded 만
---
```

기존 dev-logs는 frontmatter 일부만 보유. **점진 backfill** — 신규 작성/수정 시 보강.

## 자동화 커맨드 (Sleep-time Consolidation)

| 커맨드 | 효과 | 빈도 |
|--------|------|------|
| `/consolidate-devlogs` (신규) | frontmatter 기반 tier 자동 산출, 클러스터 발견, superseded 식별 | 주 1회 |
| `/promote-devlog <slug>` (신규) | Tier 2 → ADR/skill 승격 (semantic 정착) | 패턴 발견 시 |
| `/archive-devlog <slug>` (신규) | Tier 4 이동, replaced_by 링크 보존 | superseded 발견 시 |
| `/where`, `/related` (기존) | tier 우선순위 반영 (Tier 1 > 2 > 3) | 매 검색 |

**향후**: weekly cron으로 `/consolidate-devlogs` → Discord 알림 (Phase 2 Morning Briefing에 통합 가능)

## 적용 Round (단계별, 메모리 룰 `feedback_smaller_commits` 적용)

| Round | 작업 | 파일 수 | 위험 |
|-------|------|---------|------|
| **R1** | `.claude/rules/devlog-lifecycle.md` 신규 (정책 명시) + frontmatter 표준 | 1 | 0 |
| **R2** | `/consolidate-devlogs`, `/promote-devlog`, `/archive-devlog` 작성 | 3 | 0 |
| **R3** | 진행 중 dev-log 5건 frontmatter 백필 (시범) | 5 | 0 |
| **R4** | `/consolidate-devlogs` 실행, 발견 클러스터 통합 (3건+) | 변동 | 사용자 승인 |
| **R5** | `_archive/` 디렉토리 + superseded 5건 이동 | 변동 | 사용자 승인 |

**다음 세션 시작점**: R1부터. 사용자 추천은 R1+R2 묶어서 한 커밋 (4 파일, 30분~1시간).

## 학계 패턴과 우리 정책 매핑 (검증)

| 학계 패턴 | 우리 정책 |
|-----------|----------|
| FadeMem LML | Tier 1+2 (보존) |
| FadeMem SML | Tier 3+4 (빠른 demote) |
| Importance Score | frontmatter `importance` |
| Episodic → Semantic | `/promote-devlog` |
| Sleep-time computation | weekly `/consolidate-devlogs` |
| OS memory hierarchy | Tier 1 (RAM) / Tier 2-3 (disk) / Tier 4 (cold) |
| Searchable metadata 유지 | frontmatter + INDEX-by-topic |

→ 직관으로 도출한 정책이 학계 합의와 일치. 안전 베팅.

## 결정 (Action)

**채택**: 4-Tier 정책 + frontmatter 표준 + 3 신규 커맨드. **다음 세션에서 R1+R2부터 시작.**

## 외부 검색 출처

- [Memory in the Age of AI Agents Survey (arxiv 2603.07670)](https://arxiv.org/html/2603.07670v1)
- [State of AI Agent Memory 2026 (mem0)](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
- [Architecture and Orchestration of Memory Systems in AI Agents (2026-04)](https://www.analyticsvidhya.com/blog/2026/04/memory-systems-in-ai-agents/)
- [Mem0 production-ready agents (arxiv 2504.19413)](https://arxiv.org/pdf/2504.19413)
- [Document Lifecycle Management 2026](https://technicalwriterhq.com/documentation/document-lifecycle-management/)
- [Information Lifecycle Management 2026 Guide (Concentric)](https://concentric.ai/2025-guide-to-modern-information-lifecycle-management/)
- [Data Archival Best Practices 2026 (Atlan)](https://atlan.com/know/data-archival-best-practices/)
- [Hot-Warm-Cold Data Tiers MongoDB (2026-03)](https://oneuptime.com/blog/post/2026-03-31-mongodb-implement-hot-warm-cold-data-tiers/view)
- [Log Retention Policies (groundcover)](https://www.groundcover.com/learn/logging/log-retention-policies)

## 다음 세션 진입 명령

```bash
# 1. 이 dev-log + 메모리 진입점 다시 확인
cat docs/dev-logs/2026-04-29-devlog-tier-policy.md
cat ~/.claude/projects/.../memory/project_devlog_tier_policy.md

# 2. R1 시작: .claude/rules/devlog-lifecycle.md 신규 작성
#    + frontmatter 표준 + Tier 4 정의 명시

# 3. R2 진행: 3개 커맨드 (.claude/commands/) 작성
#    - consolidate-devlogs.md
#    - promote-devlog.md
#    - archive-devlog.md

# 4. 커밋 단위: R1+R2 묶어서 1커밋 (4 파일)
#    "feat(controller): add dev-log lifecycle policy + commands"
```
