# Phase 6-2: Redis Inventory Counter 전환 + OrderCreate N+1 제거

날짜: 2026-04-11
레포: Goti-go (`internal/ticketing/`)

## 요약

1. 수연 구현체 부하테스트(1000/3000VU) 전수 분석 — 기존 P0 3건 외 추가 병목 2건 발견
2. hot path DB inventory UPDATE → Redis HINCRBY 전환 (Lua script, negative 방지)
3. Background sync (Redis→DB 5초) + lazy init + crash 복구
4. OrderCreate N+1 INSERT → BatchSave + 인덱스 2개

## Before / After

### 아키텍처

```
Before: Redis Lock → DB TX { status + hold + ★inventory★ } → Unlock
After:  Redis Lock → DB TX { status + hold } → Unlock → Redis HINCRBY
        Background: Redis → DB sync (5초)
```

### 병목 대응 (5건)

| 병목 | 원인 | 해결 | 예상 효과 |
|------|------|------|----------|
| P0-2 inventory row contention | grade당 1row에 수백명 UPDATE | Redis HINCRBY | 600ms → 0ms |
| P0-3 이중 잠금 pool 고갈 | TX 안에 inventory | TX 범위 축소 | TX 5-10ms → 2-3ms |
| NEW-1 pool cascading (victim) | P0-2,3 파생 | 간접 해소 | order p95 2s → <200ms |
| NEW-2 OrderItem N+1 INSERT | 좌석마다 개별 INSERT | BatchSave | 10 round-trip → 1 |
| NEW-3 FindDuplicateSeats 인덱스 | JOIN 시 full scan | 인덱스 2개 | 데이터 증가 안정 |

### 수연 부하테스트 스케일링 (해결 대상)

| 경로 | 1000VU p95 | 3000VU p95 | 배수 | 원인 |
|------|-----------|-----------|------|------|
| seat_selection | 75ms | 919ms | 12.2x | P0-2 |
| order_creation | 147ms | 2.01s | 13.7x | NEW-1,2,3 |
| payment | 240ms | 1.03s | 4.3x | P0-2 |

## 변경 파일 (16파일, +540/-166)

### 커밋 1: `feat(ticketing): Redis inventory repository`
| 파일 | 변경 |
|------|------|
| `pkg/errors/errors.go` | ErrInsufficientInventory, ErrInventoryNotInitialized |
| `pkg/config/config.go` | InventorySyncIntervalMs + helper |
| `configs/ticketing.yaml` | inventory_sync_interval_ms: 5000 |
| `repository/inventory_redis_repo.go` | **신규** Lua script 기반 6 메서드 |

### 커밋 2: `perf(ticketing): hot path inventory → Redis 전환`
| 파일 | 변경 |
|------|------|
| `service/seat_hold_service.go` | grade 조회 TX 밖, inventory Redis |
| `service/seat_hold_expiry_service.go` | shouldAdjust 캡처 → TX 밖 Redis |
| `service/order_confirm_service.go` | gradeDeltas TX 밖 선언, TotalAvailable Redis |
| `service/order_cancel_service.go` | inventory 루프 TX 밖 Redis |

### 커밋 3: `feat(ticketing): inventory background sync`
| 파일 | 변경 |
|------|------|
| `repository/inventory_repo.go` | SetCounts() 추가 |
| `service/inventory_sync_service.go` | **신규** SyncDirtyGames, RebuildFromDB |
| `scheduler/inventory_sync_scheduler.go` | **신규** 분산 락 5초 스케줄러 |

### 커밋 4: `feat(ticketing): DI 조립 + 초기화`
| 파일 | 변경 |
|------|------|
| `service/seat_status_service.go` | InitInventory DB+Redis 동시 초기화 |
| `cmd/ticketing/main.go` | inventoryRedisRepo DI + sync scheduler |

### 커밋 5: `perf(ticketing): OrderCreate N+1 제거 + 인덱스`
| 파일 | 변경 |
|------|------|
| `repository/order_item_repo.go` | BatchSave() 추가 |
| `service/order_create_service.go` | 루프 → BatchSave |
| `migrations/002_order_performance_indexes.sql` | **신규** 인덱스 2개 |

## 설계 근거

### Lua Script 채택 (HINCRBY 단독 불가)
- HINCRBY만으로는 check-then-decrement 원자성 미보장 (TOCTOU race)
- Lua script로 EXISTS + HGET 비교 + HINCRBY + SADD dirty를 단일 원자 연산
- Queue 서비스도 동일 Lua script 패턴 사용 중

### Eventual Consistency 허용 근거
- `seat_statuses` UNIQUE 제약이 좌석 정합성(double-sell 방지)의 실제 guard
- `game_seat_inventories`는 파생 집계 (남은 좌석 수 표시 용도)
- 5초 이내 sync로 사용자 체감 차이 없음

### 에러 불전파 전략
- Redis 실패 시 로깅만, 에러 전파 안 함
- seat_statuses가 source of truth, sync worker가 복구
- Redis key 미존재 시 lazy init (ErrInventoryNotInitialized → RebuildFromDB)

## 검증

- `go build ./...` 통과
- `go test ./internal/ticketing/... -short` 전체 통과 (domain, repository, service)
- 부하테스트 Before/After 비교: 내일 예정

## 외부 조사 출처

- [Alibaba Cloud: Redis Snap-Up System](https://www.alibabacloud.com/blog/high-concurrency-practices-of-redis-snap-up-system_597858)
- [배달의민족: 선물하기 재고 관리](https://techblog.woowahan.com/2709/)
- [Redis: Real-Time Inventory Solution](https://redis.io/solutions/real-time-inventory/)
- [DEV: Fixing Race Conditions in Redis Counters with Lua](https://dev.to/silentwatcher_95/fixing-race-conditions-in-redis-counters-why-lua-scripting-is-the-key-to-atomicity-and-reliability-38a4)
