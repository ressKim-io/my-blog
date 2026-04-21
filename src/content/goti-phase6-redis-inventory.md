---
title: "Phase6 Redis 재고 모델 설계 — Hot Path에서 DB UPDATE를 들어내다"
excerpt: "grade당 1 row에 수백 명이 동시에 UPDATE를 쏟아붓는 구조를 Redis HINCRBY + Lua script로 옮기고, OrderCreate의 N+1 INSERT까지 BatchSave로 정리한 Phase 6-2 설계 기록입니다."
category: challenge
tags:
  - go-ti
  - Redis
  - Ticketing
  - Inventory
  - Phase6
  - PostgreSQL
  - Lua
series:
  name: "goti-redis-sot"
  order: 3
date: "2026-04-11"
---

## 한 줄 요약

> Hot path의 DB inventory UPDATE를 Redis HINCRBY로 옮기고, OrderCreate의 N+1 INSERT를 BatchSave로 정리했습니다. 좌석 정합성은 여전히 `seat_statuses`의 UNIQUE 제약이 담당하고, `game_seat_inventories`는 5초 주기로 Redis에서 DB로 비동기 동기화하는 파생 집계로 재정의했습니다.

---

## 🔥 문제: 동일 row에 수백 UPDATE가 쏟아지는 구조

Phase 6-1까지의 아키텍처는 다음과 같습니다.

```text
Redis Lock → DB TX { status + hold + ★inventory★ } → Unlock
```

`game_seat_inventories`가 grade당 1 row만 존재합니다. 한 경기에서 같은 등급을 고르는 사용자는 전부 이 한 row에 `UPDATE ... SET available_count = available_count - 1`을 수행합니다. 트래픽이 몰리면 해당 row가 **서비스 전체의 직렬화 지점**이 됩니다.

수연 구현체의 1000VU/3000VU 부하테스트를 전수 분석하는 과정에서 기존에 알고 있던 P0 3건 외에 추가 병목 2건을 발견했습니다. 아래는 실측된 스케일링 수치입니다.

| 경로 | 1000VU p95 | 3000VU p95 | 배수 | 원인 |
|------|-----------|-----------|------|------|
| seat_selection | 75ms | 919ms | 12.2x | P0-2 inventory row contention |
| order_creation | 147ms | 2.01s | 13.7x | NEW-1, NEW-2, NEW-3 |
| payment | 240ms | 1.03s | 4.3x | P0-2 |

VU를 3배 늘렸는데 지연은 12~13배 증가하는 구간이 두 군데 나왔습니다. 선형이 아니라 지수적으로 악화되고 있다는 신호입니다. 특히 seat_selection과 order_creation이 나란히 10배 이상 튀어오르는 것은 이들이 공통된 자원(동일 inventory row, 동일 DB connection pool)을 놓고 경쟁하고 있기 때문입니다.

order_creation의 2초대 p95는 티켓팅 도메인에서는 **실질적으로 실패**입니다. 사용자가 좌석을 선택한 뒤 결제창까지 도달하지 못하고 타임아웃을 보게 됩니다.

### 병목 정리 (5건)

| 병목 | 원인 | 해결 | 예상 효과 |
|------|------|------|----------|
| P0-2 inventory row contention | grade당 1 row에 수백 명이 UPDATE | Redis HINCRBY | 600ms → 0ms |
| P0-3 이중 잠금 + pool 고갈 | TX 안에 inventory UPDATE 포함 | TX 범위 축소 | TX 5-10ms → 2-3ms |
| NEW-1 pool cascading (victim) | P0-2, P0-3의 파생 효과 | 간접 해소 | order p95 2s → <200ms |
| NEW-2 OrderItem N+1 INSERT | 좌석마다 개별 INSERT | BatchSave | 10 round-trip → 1 |
| NEW-3 FindDuplicateSeats 인덱스 | JOIN 시 full scan | 인덱스 2개 | 데이터 증가에도 안정 |

P0-2와 P0-3은 서로 독립 문제처럼 보이지만 실제로는 연결되어 있습니다. inventory UPDATE가 DB TX 안에 있기 때문에 row contention이 발생하면 TX 자체가 길어지고, TX가 길어지면 connection이 오래 점유되고, connection이 점유되면 대기열이 쌓여 다른 경로(NEW-1)까지 영향을 받습니다.

그래서 둘을 같이 푸는 것이 중요합니다. inventory를 Redis로 옮기면 row contention이 사라지고, TX 범위도 자연스럽게 축소됩니다.

---

## 🤔 원인: inventory UPDATE는 TX 안에 있을 필요가 없었다

`game_seat_inventories`의 역할을 다시 들여다봤습니다. 실제 좌석 판매의 정합성은 어디서 보장되고 있었을까요.

- `seat_statuses` 테이블의 UNIQUE 제약이 **double-sell 방지의 진짜 guard**입니다. 같은 좌석을 두 사람이 동시에 잡으면 UNIQUE 위반으로 한 쪽이 반드시 실패합니다.
- `game_seat_inventories.available_count`는 **"남은 좌석 수를 빠르게 보여주기 위한 파생 집계"**입니다. UI에 "300석 남음"을 표시하는 용도이지, 판매 가부를 결정하는 근거가 아닙니다.

즉 파생 집계를 hot path의 DB TX 안에서 UPDATE할 필요가 없었습니다. TX에 넣어두면 다음 비용을 모두 부담합니다.

1. row-level lock 대기로 TX 길이가 늘어남
2. 대기 중 connection 점유 → pool 고갈 전이
3. 동일 grade를 고르는 모든 사용자가 줄을 섬

seat_statuses라는 진짜 guard가 이미 정합성을 보장하고 있다면, inventory는 **eventual consistency로 충분**합니다. 5초 이내에만 DB와 맞아떨어지면 사용자 경험에 차이가 없습니다.

### 왜 Lua Script인가

Redis HINCRBY 하나로는 부족했습니다. "남은 수량이 0보다 크면 감소, 아니면 거절"이라는 **check-then-decrement** 로직이 필요한데, HINCRBY 단독으로는 TOCTOU race가 발생합니다.

```text
Client A: HGET inventory:g1 grade_vip  → 1
Client B: HGET inventory:g1 grade_vip  → 1
Client A: HINCRBY inventory:g1 grade_vip -1  → 0
Client B: HINCRBY inventory:g1 grade_vip -1  → -1 (음수 발생)
```

Lua script로 EXISTS → HGET 비교 → HINCRBY → SADD dirty를 한 덩어리로 묶어야 이 경쟁 조건이 사라집니다. Redis는 Lua script를 단일 명령으로 취급하므로 중간에 다른 클라이언트가 끼어들 수 없습니다. 같은 프로젝트의 queue 서비스도 동일 패턴을 쓰고 있어 구현 표준이 맞았습니다.

---

## ✅ 해결: 3겹의 분리 — Hot Path, Background Sync, Lazy Init

### Before / After 아키텍처

```text
Before: Redis Lock → DB TX { status + hold + ★inventory★ } → Unlock
After:  Redis Lock → DB TX { status + hold } → Unlock → Redis HINCRBY
        Background: Redis → DB sync (5초)
```

핵심 변화는 두 가지입니다. inventory가 DB TX 밖으로 나갔고, Redis가 hot path의 source of truth가 되었습니다. DB는 파생 집계의 영속화 대상으로 역할이 바뀝니다.

### 커밋 단위로 나눈 구현

변경 범위는 16파일, +540/-166 라인입니다. 5개 커밋으로 쪼개서 리뷰/롤백이 쉬운 단위로 만들었습니다.

**커밋 1: `feat(ticketing): Redis inventory repository`**

| 파일 | 변경 |
|------|------|
| `pkg/errors/errors.go` | `ErrInsufficientInventory`, `ErrInventoryNotInitialized` |
| `pkg/config/config.go` | `InventorySyncIntervalMs` + helper |
| `configs/ticketing.yaml` | `inventory_sync_interval_ms: 5000` |
| `repository/inventory_redis_repo.go` | **신규** — Lua script 기반 6 메서드 |

이 커밋만 머지해도 런타임 동작은 변하지 않습니다. 저장소 계층과 에러 타입, 설정만 준비합니다.

**커밋 2: `perf(ticketing): hot path inventory → Redis 전환`**

| 파일 | 변경 |
|------|------|
| `service/seat_hold_service.go` | grade 조회를 TX 밖으로, inventory를 Redis로 |
| `service/seat_hold_expiry_service.go` | `shouldAdjust` 캡처 후 TX 밖에서 Redis 호출 |
| `service/order_confirm_service.go` | `gradeDeltas`를 TX 밖에서 선언, `TotalAvailable`는 Redis |
| `service/order_cancel_service.go` | inventory 루프를 TX 밖 Redis로 |

여기서 실제 p95 감소가 일어납니다. `seat_hold_service.go`가 가장 민감한 경로여서 제일 먼저 검증했습니다.

**커밋 3: `feat(ticketing): inventory background sync`**

| 파일 | 변경 |
|------|------|
| `repository/inventory_repo.go` | `SetCounts()` 추가 |
| `service/inventory_sync_service.go` | **신규** — `SyncDirtyGames`, `RebuildFromDB` |
| `scheduler/inventory_sync_scheduler.go` | **신규** — 분산 락 기반 5초 스케줄러 |

Redis의 dirty set(`SADD dirty_games`)을 5초마다 훑어 변경된 게임만 DB에 반영합니다. 분산 락을 스케줄러 앞단에 둬서 여러 Pod가 동시에 돌려도 한 번만 실행됩니다.

**커밋 4: `feat(ticketing): DI 조립 + 초기화`**

| 파일 | 변경 |
|------|------|
| `service/seat_status_service.go` | `InitInventory`에서 DB와 Redis를 동시 초기화 |
| `cmd/ticketing/main.go` | `inventoryRedisRepo` DI + sync scheduler 기동 |

경기 오픈 시점에 Redis가 비어있으면 안 됩니다. DB 초기값을 그대로 Redis HSET으로 밀어넣는 lazy init 경로를 준비합니다.

**커밋 5: `perf(ticketing): OrderCreate N+1 제거 + 인덱스`**

| 파일 | 변경 |
|------|------|
| `repository/order_item_repo.go` | `BatchSave()` 추가 |
| `service/order_create_service.go` | 루프 대신 BatchSave 1회 호출 |
| `migrations/002_order_performance_indexes.sql` | **신규** — 인덱스 2개 |

OrderItem N+1은 inventory와 별개 문제지만 같은 Phase 안에서 해결합니다. 10석을 잡으면 INSERT가 10번 날아가던 것을 1번으로 줄이고, `FindDuplicateSeats`가 참조하는 컬럼에 인덱스 2개를 추가해 데이터가 늘어나도 full scan으로 떨어지지 않게 합니다.

### Eventual Consistency를 선택한 근거

설계상 가장 큰 결정은 "inventory는 eventual consistent여도 괜찮다"는 판단이었습니다. 근거는 세 가지입니다.

1. **실제 정합성 guard가 분리되어 있음** — `seat_statuses` UNIQUE가 double-sell을 물리적으로 차단합니다. inventory 숫자는 판매 가부를 결정하지 않습니다.
2. **파생 집계의 본질** — "남은 좌석 수"는 UI에 보여주는 근사치입니다. 5초 전 값이든 지금 값이든 사용자는 구분하지 못합니다.
3. **복구 경로 존재** — Redis가 통째로 날아가도 `RebuildFromDB`로 재계산할 수 있습니다. Redis는 가속 레이어이지 유일 원본이 아닙니다.

### 에러 불전파 전략

Redis 호출이 실패했을 때 요청을 실패시키지 않습니다.

- Redis 실패 시 로깅만 하고 에러를 전파하지 않습니다.
- `seat_statuses`가 source of truth이므로 사용자 주문 자체는 이미 성공한 상태입니다.
- sync worker가 다음 주기에 DB에서 재계산해 Redis를 덮어씁니다.
- Redis key가 존재하지 않으면 `ErrInventoryNotInitialized`를 내고, 호출 측에서 `RebuildFromDB`로 lazy init합니다.

이 전략은 "Redis 장애가 곧 티켓팅 장애"가 되는 것을 막습니다. Redis가 일시적으로 내려가도 좌석 판매는 계속됩니다. 다만 화면에 표시되는 잔여 수량이 최대 5초 정도 어긋날 수 있습니다.

### 검증

이 단계까지의 검증은 단위/통합 테스트 수준입니다.

- `go build ./...` 통과
- `go test ./internal/ticketing/... -short` domain/repository/service 전체 통과
- 부하테스트 Before/After 비교는 다음 날 진행 예정

실제 3000VU에서 p95가 떨어지는지 확인하는 작업은 롤아웃 편(D0~D7)에서 이어집니다.

---

## 📚 배운 점

- **Hot path의 DB UPDATE는 그것이 정말 TX에 필요한지 먼저 확인합니다.** `game_seat_inventories`처럼 파생 집계인데 TX에 끼어 있는 경우, 옮기기만 해도 contention이 사라집니다. 정합성 guard가 별도로 존재하는지 확인하는 것이 선행 조건입니다.
- **HINCRBY 단독은 원자성을 주지 않습니다.** check-then-decrement가 필요한 모든 카운터는 Lua script로 감싸야 합니다. HINCRBY만 믿다가는 음수 값이 나오고 나서야 알아차립니다.
- **Redis를 hot path SoT로 올리면 에러 전파 전략을 같이 설계합니다.** Redis 장애 = 서비스 장애로 연결되지 않도록 로깅만 하고 넘기는 경로, sync worker의 재계산 경로, lazy init 경로를 묶어서 봐야 합니다.
- **성능 문제는 대체로 묶여 있습니다.** P0-2(row contention)와 P0-3(pool 고갈)은 각각 독립 문제처럼 보였지만 TX 범위라는 공통 원인으로 묶여 있었습니다. 하나만 풀려고 하면 다른 쪽이 남고, 같이 풀어야 NEW-1(victim 경로)까지 사라집니다.
- **커밋 단위로 위험을 잘게 나눕니다.** 저장소 추가 → hot path 전환 → background sync → DI → N+1 제거 순서로 나눠두면 문제가 생겼을 때 어느 커밋에서 유발됐는지 추적이 쉽습니다. 단일 커밋 540라인으로 말아 올리면 되돌리기도 어렵고 리뷰도 안 됩니다.
