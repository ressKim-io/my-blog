---
title: "dev-logs Tier 정책 — Storage Tiering + AI Memory Hierarchy 차용한 4-Tier"
excerpt: "151개 dev-logs Tier 미정 상태에서 시간 기반 demote는 부적합한 컨텍스트. 산업 표준 Storage Tiering + 학계 OS memory hierarchy를 차용해 4-Tier + frontmatter 표준 + 자동 커맨드를 설계했습니다"
type: troubleshooting
category: challenge
tags:
  - go-ti
  - dev-logs
  - Tier Policy
  - Memory Hierarchy
  - Information Lifecycle
  - adr
  - troubleshooting
series:
  name: goti-portfolio-meta
  order: 5
date: "2026-04-29"
---

## 한 줄 요약

> 151개 dev-logs의 Tier 분류 정책이 미정인 상황에서, 시간 기반 demote가 부적합하다는 판단 아래 산업 표준 Storage Tiering과 학계 AI Memory Hierarchy를 차용해 4-Tier 정책 + frontmatter 표준 + 3개 자동화 커맨드를 설계했습니다

---

## 🔥 문제: 151개 dev-logs, Tier 미정

Phase 1.5(메모리 다이어트 + `/consolidate-memory` + `/where` + `/related` 추가, `AGENTS.md` + symlink 정비)가 완료된 시점에서 **151개 dev-logs의 Tier 분류 정책이 여전히 미정**이었습니다.

현황을 측정해 보면 다음과 같습니다.

| 지표 | 값 |
|------|-----|
| dev-logs 총량 | 150개 파일 |
| 시간 분포 | 2026-03 (70건) + 2026-04 (80건), 2개월 집중 |
| 가장 오래된 파일 | 47일 경과 |
| 동일 주제 클러스터 | redis(3), otel(3), sot(4), istio(2), ecr(2), db(2), dashboard(2), crashloop(2), ticketing(2), label(2) 등 |

가장 오래된 파일이 47일이기 때문에, "60일 stale" 같은 단순 시간 기반 규칙을 적용하면 아직 아무것도 demote되지 않습니다.

시간 분포도 문제입니다. 전체 기간이 약 2개월에 집중되어 있어, 날짜만으로는 중요도를 판단할 수 없습니다. 3월 로그와 4월 로그의 맥락 가치가 날짜만으로 결정되지 않기 때문입니다.

---

## 🤔 원인: 시간 기반 demote가 우리 컨텍스트에 맞지 않는 이유

시간 기반 정책이 일반적으로 쓰이는 이유는 간단합니다. 구현이 쉽고, 대부분의 프로덕션 로그는 시간이 지나면 실제로 접근 빈도가 낮아지기 때문입니다.

그러나 우리 컨텍스트는 다음 세 가지 이유에서 시간 기반 demote가 맞지 않습니다.

첫째, **프로젝트가 종료됐습니다.** 새 dev-log가 거의 생성되지 않으므로 "최근성"이 중요도와 무관합니다. 3월에 작성된 ADR 결정 기록이 4월 트러블슈팅 로그보다 훨씬 중요할 수 있습니다.

둘째, **2개월 집중 분포**입니다. 전체 기간이 47일에 불과하므로 Hot/Warm/Cold 3단계 모두 임계값(7일/45일/90일)이 현실에 맞지 않습니다.

셋째, **클러스터 가치**가 중요합니다. 같은 주제의 로그가 3~4건씩 묶여 있으면, 낱개 파일의 날짜보다 주제 묶음의 패턴 가치가 더 큽니다. 예: `sot(4)` 클러스터는 Source of Truth 설계 진화를 보여주는 연속 기록입니다.

---

## 🧭 선택지 비교

### 고려한 옵션

| 옵션 | 핵심 아이디어 | 장점 | 한계 |
|------|---------------|------|------|
| A. 시간 기반 demote | 7일/45일/90일 임계값으로 Hot→Warm→Cold 자동 이동 | 구현 단순, 운영 자동화 쉬움 | 프로젝트 종료 + 2개월 집중 분포에서 의미 없음 |
| B. 상태 + 중요도 + 클러스터 기반 4-Tier | `status`/`importance` frontmatter + 클러스터(3건+) 통합 검토 | 맥락 가치 반영, 프로젝트 종료 후에도 유효 | frontmatter 백필 필요, 초기 구축 비용 있음 |

### 기각 이유

**A 탈락**: 가장 오래된 파일이 47일로, 60일 임계값 기준을 아직 넘지 않았습니다. 임계값을 낮춰도 시간 = 중요도라는 전제 자체가 성립하지 않으므로 근본적으로 부적합합니다.

### 결정 기준과 최종 선택

**B를 채택했습니다.**

결정 기준은 다음 우선순위입니다.

1. **프로젝트 종료 후에도 맥락 가치를 보존할 수 있는가**: 시간 기반은 이 조건을 충족하지 못합니다
2. **클러스터(같은 주제 2~3건)를 패턴으로 승격할 수 있는가**: `sot(4)`, `otel(3)` 같은 연속 기록은 개별 파일보다 묶음 가치가 큽니다
3. **점진적 백필이 가능한가**: 151건 전체를 한 번에 분류하지 않고, 신규 작성·수정 시 점진 보강할 수 있어야 합니다

---

## ✅ 해결: 4-Tier 정책 + frontmatter 표준 + 자동화 커맨드

### 외부 검색 결과 (2026-04 기준)

정책 설계 전 산업 표준과 학계 패턴을 조사했습니다.

**산업 표준 — Storage Tiering** (출처: Atlan / Cloudian / Microsoft Purview)

- Hot → Warm: 7~14일 / Warm → Cold: 45~90일 / Cold → Delete: 보존 만료
- 모든 archived asset은 **searchable metadata 유지**

**학계 — AI Agent Memory (2026)**

| 패턴 | 의미 |
|------|------|
| OS memory hierarchy 모방 | main context = RAM, external = disk, agent가 swap 제어 |
| FadeMem (LML + SML) | 중요도 기반 2-tier — Long-term decay 느림, Short-term decay 빠름 |
| Importance Score | LLM이 incoming info에 점수 매김 → tenuring 결정 |
| Sleep-time computation | 유휴 시간 메모리 정리 (cron 기반) — `/consolidate-*` 패턴과 동형 |
| Episodic → Semantic | dev-log(episodic) → ADR/skill(semantic) 승격 |

학계의 FadeMem 패턴이 우리 정책과 정확히 대응됩니다. Tier 1+2는 LML(Long-term Memory Layer, decay 느림), Tier 3+4는 SML(Short-term Memory Layer, demote 빠름)입니다.

**Engineering ILM 5단계**: Creation → Storage → Usage → **Archival** → Deletion. 프로젝트 종료 1년 후 자동 archival, 메타데이터 검색 유지가 업계 통례입니다.

---

### 4-Tier 정책

#### Tier 1 — Active (검색 우선, Hot)

- **조건**: `status: open` OR active 메모리/카드와 연결
- **인덱스**: `docs/dev-logs/INDEX-active.md` (10건 이내 유지)
- **효과**: `/where`, `/related` 결과 상단에 노출

10건 상한을 두는 이유는 OS memory hierarchy에서 RAM 용량 제한과 같습니다. Active 목록이 무한정 늘어나면 검색 우선순위 자체가 의미 없어집니다.

#### Tier 2 — Reference (Warm, 패턴/교훈 가치)

- **조건**: `status: resolved` + (`importance: critical|major` OR ADR/카드에서 인용)
- **인덱스**: `docs/dev-logs/INDEX-by-topic.md` (incident/decision/migration 카테고리별)
- **승격 트리거**: 클러스터 3건 이상 같은 주제는 통합 dev-log로 승격 검토

Tier 2가 실질적으로 가장 중요한 레이어입니다. 해결된 건이지만 팀 지식으로 남을 가치가 있는 것들이 여기에 모입니다.

#### Tier 3 — Historical (Cold, 가끔 참조)

- **조건**: `status: resolved` + 60일 이상 미참조 + `importance: minor`
- **인덱스**: 메타데이터만 (title + date + tags), 본문은 grep으로만 발견

메타데이터 인덱스는 유지하되 본문 검색 대상에서 제외합니다. 필요 시 grep으로 찾을 수 있으므로 정보는 잃지 않습니다.

#### Tier 4 — Superseded (완전 대체, Archive)

- **조건**: `status: superseded`, `replaced_by` 명시
- **이동**: `docs/dev-logs/_archive/`
- **forward link**: `replaced_by` 링크는 새 자료에 보존 (역추적 가능하게)

완전 대체된 파일이더라도 삭제하지 않습니다. "이 결정이 왜 바뀌었는가"를 설명하는 맥락이 남아 있기 때문입니다.

---

### Frontmatter 표준

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
replaced_by: dev-logs/YYYY-MM-DD-...md   # superseded인 경우만
---
```

기존 dev-logs 150건은 frontmatter 일부만 보유하고 있습니다. 한 번에 백필하지 않고 **신규 작성 또는 수정 시점에 점진적으로 보강**합니다. `/consolidate-devlogs` 커맨드가 frontmatter 미완성 파일을 식별해 줍니다.

---

### 자동화 커맨드 (Sleep-time Consolidation)

| 커맨드 | 효과 | 권장 빈도 |
|--------|------|-----------|
| `/consolidate-devlogs` (신규) | frontmatter 기반 tier 자동 산출, 클러스터 발견, superseded 식별 | 주 1회 |
| `/promote-devlog <slug>` (신규) | Tier 2 → ADR/skill 승격 (episodic → semantic 정착) | 패턴 발견 시 |
| `/archive-devlog <slug>` (신규) | Tier 4 이동, `replaced_by` 링크 보존 | superseded 발견 시 |
| `/where`, `/related` (기존) | tier 우선순위 반영 (Tier 1 > 2 > 3) | 매 검색 |

`/consolidate-devlogs`는 AI Agent Memory 연구의 "Sleep-time computation" 패턴과 동형입니다. 에이전트가 유휴 시간(cron 기반)에 메모리를 정리하듯, 주 1회 실행으로 Tier 상태를 자동 갱신합니다.

**향후 계획**: Phase 2 Morning Briefing에 weekly cron + Discord 알림 통합을 검토 중입니다.

---

### 적용 Round (단계별)

| Round | 작업 | 파일 수 | 위험 |
|-------|------|---------|------|
| R1 | `.claude/rules/devlog-lifecycle.md` 신규 (정책 명시) + frontmatter 표준 | 1 | 없음 |
| R2 | `/consolidate-devlogs`, `/promote-devlog`, `/archive-devlog` 작성 | 3 | 없음 |
| R3 | 진행 중 dev-log 5건 frontmatter 백필 (시범) | 5 | 없음 |
| R4 | `/consolidate-devlogs` 실행, 발견 클러스터 통합 (3건+) | 변동 | 사용자 승인 필요 |
| R5 | `_archive/` 디렉토리 + superseded 5건 이동 | 변동 | 사용자 승인 필요 |

R1+R2를 첫 번째 커밋으로 묶는 것을 권장합니다. 파일 4개, 소요 시간 30분~1시간 예상입니다.

---

## 📚 배운 점

**학계 패턴과 설계 매핑**

직관으로 도출한 정책이 학계 합의와 대부분 일치했습니다.

| 학계 패턴 | 우리 정책 |
|-----------|----------|
| FadeMem LML | Tier 1+2 (보존) |
| FadeMem SML | Tier 3+4 (빠른 demote) |
| Importance Score | frontmatter `importance` |
| Episodic → Semantic | `/promote-devlog` |
| Sleep-time computation | weekly `/consolidate-devlogs` |
| OS memory hierarchy | Tier 1 (RAM) / Tier 2-3 (disk) / Tier 4 (cold) |
| Searchable metadata 유지 | frontmatter + INDEX-by-topic |

---

- **시간 기반 demote는 "시간 = 중요도"가 성립할 때만 유효합니다.** 프로젝트 종료 상태처럼 새 로그가 생성되지 않는 환경에서는 상태(`status`)와 중요도(`importance`)가 더 신뢰할 수 있는 기준입니다
- **클러스터(3건 이상 같은 주제)는 낱개보다 가치가 높습니다.** 개별 파일이 아니라 패턴으로 묶어 ADR/skill로 승격하는 것이 지식 자산을 오래 유지하는 방법입니다
- **점진 백필 전략이 현실적입니다.** 150건을 한 번에 분류하려 하면 실행이 막히고, 신규/수정 시 보강하면 자연스럽게 중요한 파일부터 frontmatter가 완성됩니다
- **Archive는 삭제가 아닙니다.** Tier 4로 이동한 파일도 `replaced_by` forward link를 통해 역추적할 수 있어야 합니다. "왜 이 결정이 바뀌었는가"가 미래 컨텍스트가 됩니다

---

## 참고 출처

- [Memory in the Age of AI Agents Survey (arxiv 2603.07670)](https://arxiv.org/html/2603.07670v1)
- [State of AI Agent Memory 2026 (mem0)](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
- [Architecture and Orchestration of Memory Systems in AI Agents (2026-04)](https://www.analyticsvidhya.com/blog/2026/04/memory-systems-in-ai-agents/)
- [Mem0 production-ready agents (arxiv 2504.19413)](https://arxiv.org/pdf/2504.19413)
- [Information Lifecycle Management 2026 Guide (Concentric)](https://concentric.ai/2025-guide-to-modern-information-lifecycle-management/)
- [Data Archival Best Practices 2026 (Atlan)](https://atlan.com/know/data-archival-best-practices/)
- [Hot-Warm-Cold Data Tiers MongoDB (2026-03)](https://oneuptime.com/blog/post/2026-03-31-mongodb-implement-hot-warm-cold-data-tiers/view)
- [Log Retention Policies (groundcover)](https://www.groundcover.com/learn/logging/log-retention-policies)
