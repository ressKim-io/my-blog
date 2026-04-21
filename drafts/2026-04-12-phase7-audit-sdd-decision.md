---
date: 2026-04-12
category: decision
project: goti-team-controller
tags: [phase-7, sdd, java-to-go, audit, gate, cutover]
---

# Phase 7 Go Readiness Audit SDD — 8게이트 + Audit-only 범위 채택

## Context

Java→Go 마이그레이션 Phase 1~6 (stadium/user/queue/resale/payment/ticketing) 구현이 완료된 상태. 곧 컷오버를 앞두고 있으나 "Java는 되는데 Go로 바꾸자마자 안 되면 안 된다"가 핵심 우려. Phase 7 자리에는 기존에 "Cleanup"이 잡혀 있었으나, 컷오버 전 검증이 먼저 필요하다는 판단.

검증 작업의 형태(문서/계획)와 게이트 구조를 결정해야 했다.

## Issue

### Option A: 풀 SDD (Phase 6 ticketing-deploy 956줄 형태)
- 장점: 정합성·완전성 높음, 다른 Phase와 형식 통일
- 단점: 신규 구현 SDD 템플릿이 audit 성격에 안 맞음, 비대해짐

### Option B: SDD-lite (검증 중심 축소형)
- 장점: 게이트·체크리스트 위주로 audit 성격에 적합, phase-workflow.md PWG1~5 만족
- 단점: 기존 템플릿과 다른 구조 — 처음 보는 사람이 적응 필요

### Option C: dev-logs 한 장짜리 audit 노트
- 장점: 가장 가벼움
- 단점: 게이트 추적/매트릭스 관리 불가, phase-workflow Gate 미만족

### 게이트 구조: 6게이트 vs 8게이트
- 1차 리뷰에서 G7(데이터 정합성)·G8(보안 동등성) 누락이 P0 지적
- 부하(G4)에 묶으면 좌석 이중선점/JWT/AuthZ 같은 독립 검증축이 묻힘

### 컷오버 범위: prod 100% 포함 vs Audit-only
- 1차 SDD가 "staging/prod 대상"으로 모호 → 2차 리뷰 P1 지적
- §1.2 "Java 코드 제거 제외"와 prod 100% 컷오버가 충돌

## Action

**Option B (SDD-lite) + 8게이트 + Audit-only 채택**

핵심 결정 8가지:
1. Phase 7 = "Go Readiness Audit" 신설, 기존 Cleanup → Phase 8로 이동
2. SDD-lite 형태 (검증 중심)
3. Acceptance Gate 8개: G1 API계약 / G2 E2E / G3 정적분석 / G4 부하 / G5 관측성 / G6 운영 / **G7 데이터 정합성** / **G8 보안 동등성**
4. G7/G8을 G4에서 분리 — 검증축이 다름
5. SDD 범위: audit + staging 컷오버 리허설 + **prod 10% 드라이런까지**. prod 100%는 별도 운영 체인지 티켓
6. G4 부하 합격: `max(Java p95 × 1.2, SLO 상한)` — 기준선 회귀 케이스 처리
7. G5 라벨 정책: 필수 누락 0 + 추가 허용(cardinality ≤ 10K/메트릭) + 삭제·이름변경 금지
8. 11단계 Step (S0~S11), 갭 수정 PR은 서비스별 분리 (`feedback_smaller_commits`)

근거:
- code-reviewer 1차/2차 리뷰로 P0/P1 모두 클로즈
- "Java가 SLO 위반이면 Go도 통과" 위험을 max() 공식으로 차단
- weighted routing 50:50 시 공유 락(DB UNIQUE/Redis SETNX) 동등성을 G7에서 별도 검증

## Result

- 산출물: `docs/migration/java-to-go/phase7-go-readiness-audit-sdd.md`
- PWG1(SDD 작성), PWG2(리뷰 1·2차) 클로즈
- 다음: `overview.md` + `final-execution-plan.md` Phase 번호 정합성 업데이트 → S0(API 비교 도구 결정 + 부하 도구·시드 합의) 진입
- 산출물 위치: `controller/docs/migration/java-to-go/phase7/audit/` (S0 시작 시 생성)
- 제약: prod 100% 컷오버는 본 SDD 범위 밖 — 별도 체인지 티켓 필요

## Related Files

- `docs/migration/java-to-go/phase7-go-readiness-audit-sdd.md` (신규)
- `docs/migration/java-to-go/overview.md` (Phase 표 업데이트 필요)
- `docs/project/final-execution-plan.md` (Phase 번호 정합성 필요)
- `docs/migration/java-to-go/sdd-template.md` (참조 — 본 SDD는 변형)
- `.claude/rules/phase-workflow.md` (PWG1~5 준수)
