---
title: "Phase 6 Ticketing — N+1 제거로 DB 호출 87% 감소, 동시성 P0 3건 발견"
excerpt: "OrderConfirmService의 루프 방식 쿼리를 3-Phase 배치로 전환해 DB 호출을 70회→9회로 줄이고, 35M seats 규모 동시성 분석에서 deadlock·row 경합·이중 잠금 P0 3건을 발견·처리했습니다"
category: challenge
tags:
  - go-ti
  - Ticketing
  - SQL
  - Phase6
  - Performance
  - troubleshooting
series:
  name: "goti-ticketing-phase"
  order: 2
date: "2026-04-10"
---

## 한 줄 요약

> Java에서 Go로 포팅한 Ticketing 서비스의 OrderConfirmService를 3-Phase 배치 구조로 리팩터링해 DB 호출을 87% 줄였고, 동시성 분석에서 P0 3건을 찾아냈습니다. P0-1(deadlock)은 즉시 수정했고, P0-2·P0-3은 Phase 2(Redis Inventory 전환)로 해결 계획을 세웠습니다

---

## 배경: Phase 6가 무엇인가

이 글은 **S6. goti-ticketing-phase** 시리즈의 일부입니다

go-ti 프로젝트(대규모 야구 티켓팅, 동시 접속 50만 목표)는 2026-04-09부터 Java 서비스 전체를 Go로 전환하는 작업을 시작했습니다. Phase 6는 포팅의 본체로, 58개 Go 파일, Redis Lua inventory script, N+1 제거가 주요 내용입니다

Phase 6 이후 흐름은 다음과 같습니다:
- **Phase 6**: Ticketing 구현 (이 글)
- **Phase 6.5**: Go prod 인프라 신설 — Java 기준 values가 남아 있어 Go pod가 prod에 없음을 발견 후 추가된 Phase
- **Phase 7**: Go Readiness Audit (API 계약/E2E/정적분석/부하/관측성 등 8게이트 검증)
- **Phase 8**: Java deprecation + 컷오버

이 글은 그중 Phase 6 구현의 핵심 두 축인 **SQL 최적화**와 **동시성 분석**을 다룹니다

---

## 🔥 문제: 10좌석 주문 확정에 DB 호출 70회

### 기존 구조

포팅 직후 `OrderConfirmService`는 아이템 하나씩 루프를 돌며 DB를 호출하는 방식이었습니다

```text
Before: for item in items { SELECT + UPDATE x4 + INSERT }
```

10좌석 주문을 확정할 때 발생하는 DB 호출은 다음과 같았습니다

| 항목 | Before | 방식 |
|------|--------|------|
| SELECT | 20회 | hold x10 + seat x10 (개별 조회) |
| UPDATE | 30회 | status x10 + hold x10 + item x10 |
| INSERT | 10회 | ticket x10 (개별 저장) |
| Inventory | 10회 | 등급별 개별 호출 |
| **합계** | **~70회** | 모두 단건 루프 |

10좌석이라는 작은 주문에서도 70번의 DB 왕복이 발생했습니다. 실제 부하 환경(35M seats 규모, 600 concurrent)에서는 이 구조가 병목으로 직결됩니다

---

## 🤔 원인: N+1 패턴과 인덱스 부재

### N+1 패턴

루프 안에서 개별 `SELECT`를 반복하는 N+1 패턴이 핵심 원인이었습니다. Java ORM 시절 JPA/Hibernate가 지연 로딩으로 만들어내는 패턴을 Go 포팅 시 그대로 옮겼기 때문입니다. Go는 ORM을 쓰지 않는(raw SQL) 구조였지만, 서비스 로직의 루프 패턴은 그대로 이식됐습니다

### 인덱스 부재

N+1 외에도 복합 인덱스가 전혀 없어, 쿼리 플랜이 Full Scan 또는 불필요한 JOIN을 타는 경우가 여러 곳이었습니다

특히 다음 쿼리들이 인덱스 없이 수행되고 있었습니다:
- `CountByUserAndGame` — user + game + status 3조건 필터
- `FindPrice` — 5조건 JOIN이 포함된 가격 조회
- `FindActiveByUserAndGame` — partial index가 필요한 활성 hold 조회
- `FindByMemberID + ORDER BY` — 정렬 포함 주문 조회

---

## ✅ 해결: 3-Phase 배치 리팩터링 + 복합 인덱스 5개

### 세션 1: N+1 제거 (커밋 1~4)

#### 커밋 1 — 배치 Repository 메서드 추가

N+1을 끊으려면 먼저 배치 처리 인터페이스가 필요했습니다

| 파일 | 추가 내용 |
|------|-----------|
| `repository/seat_hold_repo.go` | `BatchUpdateStatus()` |
| `repository/seat_repo.go` | `FindByIDs()` |
| `repository/ticket_repo.go` | `BatchSave()` |
| `repository/seat_status_repo.go` | `BatchUpdateStatus()` — 반환 타입 `(int64, error)` |

#### 커밋 2 — OrderConfirmService 3-Phase 리팩터링

서비스 로직을 다음 3단계로 분리했습니다

```text
Phase A: 배치 SELECT 2회 (hold 전체 + seat 전체)
Phase B: in-memory validate (DB 호출 없음)
Phase C: 배치 write 5+M회 (status/hold/ticket/inventory)
```

루프를 없애고 모든 조회를 Phase A에서 한 번에, 검증을 메모리에서, 쓰기를 Phase C에서 배치로 처리합니다

**Before/After 비교:**

| 항목 | Before | After | 감소율 |
|------|--------|-------|--------|
| SELECT | 20회 | 2회 (배치 2) | -90% |
| UPDATE | 30회 | 3회 (배치 3) | -90% |
| INSERT | 10회 | 1회 (배치 1) | -90% |
| Inventory | 10회 | ~M회 (등급 수, 보통 2~3) | -70~80% |
| **합계** | **~70회** | **~9회** | **-87%** |

10좌석 주문 확정 기준으로 DB 호출이 70회에서 9회로 줄었습니다. Inventory 항목은 등급 수(M)에 비례하지만, 실제 운용 환경에서 등급은 2~5개이므로 큰 폭의 절감이 유지됩니다

#### 커밋 3 — 복합 인덱스 5개 추가

| 인덱스 | 대상 쿼리 | 특이사항 |
|--------|----------|----------|
| `idx_tickets_user_game_status` | `CountByUserAndGame` | partial index |
| `idx_tickets_user_status` | `CountOwnedByUser` | |
| `idx_ticket_prices_lookup` | `FindPrice` 5조건 JOIN | 4-col 복합 |
| `idx_seat_holds_user_game_active` | `FindActiveByUserAndGame` | partial index |
| `idx_orders_member_created` | `FindByMemberID + ORDER BY` | |

기존 UNIQUE constraint가 이미 인덱스 역할을 하는 두 컬럼(`seat_statuses`, `game_seat_inventories`)은 중복 추가에서 제외했습니다

#### 커밋 4 — 리뷰 P0/P1 수정

| ID | Severity | 내용 |
|----|----------|------|
| P0-001 | P0 | `gradeMap` lookup 미스 시 inventory drift 방지 — guard 추가 |
| P1-001 | P1 | hold 미발견 시 `apperrors.ErrSeatHoldNotFound` 사용 |
| P1-002 | P1 | batch seat status 불일치 시 `slog.Warn` 디버깅 로그 |

`gradeMap` guard는 별도로 중요한 수정입니다. grade를 못 찾으면 inventory 카운트가 틀어지는 drift 문제로 직결되기 때문에 P0로 분류됐습니다

잔여 P2 리뷰 항목은 다음과 같습니다:

| ID | 내용 | 조치 |
|----|------|------|
| P2-001 | `BatchSave` 동적 VALUES PG 파라미터 65535 제한 | 주문당 최대 10석이므로 현재 무관 |
| P2-002 | `AdjustCounts` grade별 루프 잔존 | grade 2~5개로 영향 미미 |
| P2-003 | 마이그레이션 스키마 prefix vs 테스트 DDL 불일치 | `ticketing_service` 스키마 확인 완료 |

---

### 세션 2: 동시성 분석 + Deadlock 수정 (커밋 5)

배치 리팩터링 완료 후 35M seats 규모를 가정한 동시성 분석을 수행했습니다. P0 3건이 발견됐습니다

| ID | 문제 | 상태 |
|----|------|------|
| P0-1 | inventory 루프 deadlock — Go map 비결정적 순회 | **즉시 수정** |
| P0-2 | `game_seat_inventories` row 경합 — grade당 600 concurrent UPDATE | **Plan 수립** |
| P0-3 | Redis + DB 이중 잠금 → 커넥션 풀 고갈 | **Plan 수립** |

---

## 🧭 선택지 비교: P0-1 즉시 수정 vs P0-2/3 다음 Phase

P0 3건의 처리 방향이 달라졌습니다. 왜 P0-1만 즉시 수정하고 P0-2/3는 다음 Phase로 미뤘는지를 정리합니다

### P0-1 — 즉시 수정 가능했던 이유

`inventory` 루프의 deadlock 원인은 **Go map의 비결정적 순회 순서**였습니다. 두 트랜잭션이 각자 다른 순서로 grade row에 잠금을 요청하면 교차 대기가 발생합니다

해결책은 단순명확했습니다. gradeDeltas를 map에서 sorted slice로 바꾸면 모든 트랜잭션이 동일한 순서로 잠금을 요청합니다

```go
// Before: map 비결정적 순회 → deadlock 위험
for grade, delta := range gradeDeltas { ... }

// After: gradeID 오름차순 정렬 후 순회 → 잠금 순서 일관
sort.Slice(grades, func(i, j int) bool {
    return bytes.Compare(grades[i], grades[j]) < 0
})
for _, grade := range grades { ... }
```

코드 변경 범위가 `order_confirm_service.go`, `order_cancel_service.go` 두 파일로 한정되고, 별도 인프라 변경 없이 순서 보장만으로 해결됩니다. **즉시 수정**이 적절했습니다

### P0-2/3 — 다음 Phase로 미룬 이유

P0-2(`game_seat_inventories` row 경합)는 성격이 다릅니다. grade당 600개 concurrent UPDATE가 동일 row를 잡는 구조적 문제입니다. 이를 해결하려면:

| 옵션 | 핵심 아이디어 | 즉시 적용 가능? |
|------|---------------|----------------|
| A. DB row 잠금 튜닝 | lock_wait_timeout 단축, pool 조정 | 가능하나 근본 해결 아님 |
| B. Redis HINCRBY 전환 | hot path에서 DB inventory UPDATE 완전 제거 | Phase 2 신규 파일 2 + 서비스 4 수정 필요 |

옵션 A는 lock wait를 1s→0.3s로 줄이는 등 설정 조정이지만, row 경합 자체를 없애지 않습니다. 600 concurrent가 여전히 동일 row를 잡으면 timeout 오류만 빨리 날 뿐입니다

옵션 B(Redis HINCRBY)는 hot path에서 DB inventory UPDATE를 완전히 제거하고 Background worker가 Redis→DB를 5초 주기로 동기화하는 구조로, 예상 처리량이 12 TPS → 200+ TPS입니다. 다만 신규 파일 2개 + 서비스 4개 수정이 필요해 Phase 6 범위를 넘습니다

**결정**: P0-2는 **Phase 2에서 Redis HINCRBY 전환으로 해결**, Phase 3에서 설정 튜닝(lock wait, DB pool, Redis pool)을 보완합니다. P0-3(이중 잠금)은 P0-2 해결 시 대부분 해소됩니다

---

## ✅ 최종 상태 및 검증

### Phase 2~3 해결 계획 요약

- **Phase 2**: Redis HINCRBY 기반 inventory counter 전환 — hot path DB inventory UPDATE 완전 제거, Background worker Redis→DB 5초 동기화
- **Phase 3**: 설정 튜닝 — lock wait 1s→0.3s, DB pool 30→40, Redis pool 15→30

### 검증

```bash
# 빌드 및 단위 테스트 모두 통과
$ go build ./...
$ go test ./internal/ticketing/... -short
```

domain, repository, service 세 레이어 전체 통과를 확인했습니다

---

## 📚 배운 점

- **N+1은 Go로 포팅해도 그대로 이식됩니다**: ORM이 없어도 N+1이 자동으로 사라지지 않습니다. 포팅 시 서비스 로직의 루프 패턴을 반드시 검토해야 합니다
- **배치 처리의 3-Phase 분리**: 조회(Phase A) → 메모리 검증(Phase B) → 쓰기(Phase C)로 분리하면 DB 왕복 수를 예측 가능하게 줄일 수 있습니다
- **Go map 순회는 비결정적**: 잠금 순서가 중요한 경우 map을 그대로 순회하면 안 됩니다. sorted slice로 전환해 순서를 고정해야 deadlock을 예방합니다
- **P0 분류 기준**: "즉시 수정 가능하고 범위가 작은 것"(P0-1)과 "근본 해결에 인프라 변경이 필요한 것"(P0-2/3)을 분리하면 Phase 경계를 지키면서 긴급 리스크를 해소할 수 있습니다
- **partial index 적극 활용**: 활성 hold처럼 전체 행 중 일부만 자주 조회되는 패턴에는 partial index가 일반 인덱스보다 효율적입니다
