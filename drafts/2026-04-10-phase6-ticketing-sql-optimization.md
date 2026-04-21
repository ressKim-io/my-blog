# Phase 6: Ticketing SQL/DB 최적화 + 동시성 분석

날짜: 2026-04-10 ~ 04-11
레포: Goti-go (`internal/ticketing/`)

## 요약

1. OrderConfirmService N+1 제거 (70→9 DB 호출) + ticketing 복합 인덱스 5개
2. 35M seats 규모 동시성 분석 — P0 3건 발견 (deadlock, row contention, 이중 잠금)
3. Phase 1 deadlock 수정 완료, Phase 2 Redis Inventory 전환 Plan 수립

## Before / After

### DB 호출 수 (10좌석 주문 확정 기준)

| 항목 | Before | After | 감소율 |
|------|--------|-------|--------|
| SELECT | 20회 (hold x10 + seat x10) | 2회 (배치 2) | -90% |
| UPDATE | 30회 (status x10 + hold x10 + item x10) | 3회 (배치 3) | -90% |
| INSERT | 10회 (ticket x10) | 1회 (배치 1) | -90% |
| Inventory | 10회 | ~M회 (등급 수, 보통 2-3) | -70~80% |
| **합계** | **~70회** | **~9회** | **-87%** |

### 아키텍처 변경

```
Before: for item in items { SELECT + UPDATE x4 + INSERT }
After:  Phase A (batch SELECT 2) → Phase B (in-memory validate) → Phase C (batch write 5+M)
```

## 변경 파일

### 커밋 1: `perf(ticketing): 배치 Repository 메서드 추가`
| 파일 | 변경 |
|------|------|
| `repository/seat_hold_repo.go` | `BatchUpdateStatus()` 추가 |
| `repository/seat_repo.go` | `FindByIDs()` 추가 |
| `repository/ticket_repo.go` | `BatchSave()` + `fmt` import |
| `repository/seat_status_repo.go` | `BatchUpdateStatus()` 반환 `(int64, error)` |

### 커밋 2: `perf(ticketing): OrderConfirmService N+1 제거`
| 파일 | 변경 |
|------|------|
| `service/order_confirm_service.go` | 루프 → 3-Phase 배치 리팩터링 |
| `service/order_cancel_service.go` | BatchUpdateStatus 시그니처 대응 |
| `repository/repo_test.go` | 동일 시그니처 대응 |

### 커밋 3: `perf(ticketing): ticketing 복합 인덱스 5개 추가`
| 인덱스 | 대상 쿼리 |
|--------|----------|
| `idx_tickets_user_game_status` (partial) | CountByUserAndGame |
| `idx_tickets_user_status` | CountOwnedByUser |
| `idx_ticket_prices_lookup` (4-col) | FindPrice 5조건 JOIN |
| `idx_seat_holds_user_game_active` (partial) | FindActiveByUserAndGame |
| `idx_orders_member_created` | FindByMemberID + ORDER BY |

제외 (기존 UNIQUE 커버):
- `seat_statuses(game_schedule_id, seat_id)` — UNIQUE constraint
- `game_seat_inventories(game_id, seat_grade_id)` — UNIQUE constraint

### 커밋 4: `fix(ticketing): 리뷰 P0/P1 수정`
| ID | Severity | 내용 |
|----|----------|------|
| P0-001 | P0 | gradeMap lookup 미스 시 inventory drift 방지 (guard 추가) |
| P1-001 | P1 | hold 미발견 시 `apperrors.ErrSeatHoldNotFound` 사용 |
| P1-002 | P1 | batch seat status 불일치 시 `slog.Warn` 디버깅 로그 |

## 리뷰 결과 (P2 — 잔여)

| ID | 내용 | 조치 |
|----|------|------|
| P2-001 | BatchSave 동적 VALUES PG 파라미터 65535 제한 | 주문당 최대 10석이므로 현재 무관 |
| P2-002 | inventory AdjustCounts만 grade별 루프 | grade 2-5개로 영향 미미 |
| P2-003 | 마이그레이션 스키마 prefix vs 테스트 DDL | `ticketing_service` 스키마 확인 완료 |

## 세션 2: 동시성 분석 + Deadlock 수정

### 커밋 5: `fix(ticketing): inventory 루프 deadlock 방지 — gradeID 정렬`
| 파일 | 변경 |
|------|------|
| `service/order_confirm_service.go` | gradeDeltas map → sorted slice (bytes.Compare) |
| `service/order_cancel_service.go` | 동일 패턴 적용 |

### 동시성 분석 결과 (P0 3건)

| ID | 문제 | 상태 |
|----|------|------|
| P0-1 | inventory 루프 deadlock (Go map 비결정적 순회) | **수정 완료** |
| P0-2 | game_seat_inventories row 경합 (grade당 600 concurrent UPDATE) | **Plan 수립** |
| P0-3 | Redis+DB 이중 잠금 → 커넥션 풀 고갈 | **Plan 수립** (P0-2 해결 시 대부분 해소) |

### 해결 Plan (Phase 2-3)

- **Phase 2**: Redis HINCRBY 기반 inventory counter 전환 (신규 파일 2 + 서비스 4 수정)
  - hot path에서 DB inventory UPDATE 완전 제거
  - Background worker가 Redis→DB 5초 동기화
  - 예상: 12 TPS → 200+ TPS
- **Phase 3**: 설정 튜닝 (lock wait 1s→0.3s, DB pool 30→40, Redis pool 15→30)
- Plan 파일: `.claude/plans/vectorized-beaming-rose.md`

### 팀 공유 문서

- `docs/architecture/ticketing-concurrency-analysis.md` — 외부 레퍼런스 12개 포함

## 검증

- `go build ./...` 통과
- `go test ./internal/ticketing/... -short` 전체 통과 (domain, repository, service)
