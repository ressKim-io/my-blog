---
title: "Redis SoT 롤아웃 D5~D7 마무리 — 결제 확정 Lua와 tickets ZSET 전환"
excerpt: "outbox-worker 신규 서비스 투입, payment_confirm.lua로 결제 확정을 원자화, /tickets/myinfo를 ZCARD O(1)로 전환한 마지막 롤아웃 단계입니다."
category: challenge
tags:
  - go-ti
  - Redis
  - Ticketing
  - SoT
  - Rollout
  - Production
  - Lua
  - Outbox
series:
  name: "goti-redis-sot"
  order: 7
date: "2026-04-18"
---

## 한 줄 요약

> D5~D7 단계에서 `goti-outbox-worker`를 신규 서비스로 띄우고, 결제 확정 경로를 `payment_confirm.lua` 하나로 원자화했으며, 티켓 수 조회를 Redis ZSET ZCARD로 전환했습니다. 이것으로 Redis SoT 롤아웃 D0~D7이 마무리됐습니다.

## Impact

- **영향 범위**: 결제 확정 경로, `/tickets/myinfo` API, 주문/티켓 RDS 영속
- **변경 범위**: Goti-go 신규 서비스 1개(`goti-outbox-worker`), Lua 스크립트 2개, 기존 서비스 1개 재작성
- **기간**: 2026-04-17 ~ 2026-04-18 (커밋 4건)
- **롤아웃 단계**: D5a / D5b / D6 / D5c·D7

---

## 🔥 배경: D0~D4에서 남은 것들

D0~D4까지는 seat, hold, inventory, order 생성 경로를 Redis SoT로 전환했습니다. D4 시점에서 `order_create.lua`가 주문 생성을 원자적으로 처리하고 `outbox:stream`에 `ORDER_CREATED` 이벤트를 발행하고 있었습니다.

그러나 남은 과제가 있었습니다.

**첫째, outbox stream에 이벤트가 쌓이기만 했습니다.** D4 이전까지는 consumer가 없었습니다. Redis에 저장된 order는 PG에 반영되지 않아 정산·환불·조회 경로가 모두 막혀 있었습니다.

**둘째, 결제 확정 경로가 여러 조각으로 나뉘어 있었습니다.** 기존 `OrderConfirmService`는 order status 업데이트, 좌석 상태 H→S 전환, ticket 발급을 개별 Redis 호출과 PG write로 분리해 처리했습니다. 중간 실패 시 정합성이 깨질 가능성이 있었습니다.

**셋째, `/tickets/myinfo`의 OwnedTicketCount가 PG의 `SELECT COUNT(*) FROM tickets WHERE user_id=?`였습니다.** 사용자당 티켓이 늘어날수록 조회 비용이 커졌습니다.

**넷째, Phase A에서 만들던 `seat:status:section:{game}:{section}` cache-aside 키가 이제 의미가 없었습니다.** SoT가 Redis section HASH로 옮겨간 이상 2초 TTL 캐시를 생성할 이유가 없었습니다.

---

## 🤔 D5~D7에서 풀어야 할 것

| 단계 | 대상 | 해결할 문제 |
|---|---|---|
| D5a | `goti-outbox-worker` 신규 서비스 | Redis stream 이벤트를 RDS에 영속 |
| D5b | `payment_confirm.lua` + OrderConfirmService 재작성 | 결제 확정을 Redis atomic 1회로 통합 |
| D6 | tickets ZSET + HASH | `/tickets/myinfo`의 OwnedTicketCount를 ZCARD로 O(1) 전환 |
| D5c/D7 | Phase A seatStatusCache 제거 | SoT 이원화 흔적 정리 |

각 단계는 독립적으로 배포 가능하도록 구성했습니다. D5a가 먼저 떠 있어야 D5b·D6에서 발행한 이벤트가 RDS로 흘러갑니다.

---

## ✅ D5a: goti-outbox-worker 신규 서비스

### 구성

- `cmd/outbox-worker/main.go` — 엔트리포인트
- `configs/outbox-worker.yaml` — DB, Redis, OTel 설정
- Consumer group: `ticketing-persister`
- Router: `internal/outbox/worker/router.go`
- HTTP: `:9090` (`/metrics`, `/healthz`, `/readyz`)

### 동작

```go
// Redis XREADGROUP 으로 outbox:stream 소비
// event.type 별로 handler dispatch
// 처리 성공 시 XACK
```

Stream key는 `outbox:stream`, consumer group은 `ticketing-persister`입니다. D2 이후의 모든 Lua 스크립트가 이 stream에 XADD로 이벤트를 발행합니다.

### 첫 handler: ORDER_CREATED

D5a 시점에 구현한 handler는 `ORDER_CREATED` 하나입니다.

- 파일: `internal/outbox/handler/order_created.go`
- 처리: `orders`, `orderers`, `order_items` 테이블 UPSERT
- 멱등성: 동일 order_id로 재처리해도 안전

다른 이벤트 타입(`ORDER_PAID`, `TICKET_ISSUED`, `SEAT_HELD`, `SEAT_RELEASED`, `SEAT_HOLD_EXPIRED`)은 router에서 "unknown" 처리 후 ACK + log only로 넘어갑니다. D5a의 목적은 **파이프라인의 동작 증명**이기 때문입니다.

### 메트릭

```text
goti_outbox_handled_total{type,result}
goti_outbox_handle_duration_seconds{type}
goti_outbox_lag_seconds
```

이 세 메트릭이 있어야 Prometheus에서 outbox 파이프라인 지연과 처리량을 볼 수 있습니다. `goti_outbox_lag_seconds`는 stream의 가장 오래된 pending 엔트리와 현재 시각의 차이입니다.

---

## ✅ D5b: payment_confirm.lua로 결제 확정 원자화

### 기존 경로의 문제

기존 `OrderConfirmService`는 결제 확정을 다음 순서로 처리했습니다.

1. order HASH를 읽어 PENDING 확인
2. order_items LIST를 읽어 좌석 목록 확보
3. 각 좌석 section HASH에서 H→S 전환
4. 각 좌석에 대해 ticket 발급 후 Redis HASH 저장
5. user:tickets ZADD, game:tickets SADD
6. order HASH status를 CONFIRMED로 업데이트
7. outbox에 ORDER_PAID, TICKET_ISSUED 발행

개별 호출이 7단계를 넘어가고, 중간 실패가 발생하면 일부 좌석만 SOLD로 남거나 ticket이 누락될 수 있었습니다.

### Lua로 통합

`lua/payment_confirm.lua` 하나로 다음을 한 번에 처리합니다.

- 결제 멱등키 `payment:idem:{pg_tx_id}` 검사 (SETNX TTL 24h)
- 모든 좌석 section HASH에서 H→S 전환
- ticket_id 별로 `ticket:{ticket_id}` HASH 저장 (TTL 90d)
- `user:tickets:{user}` ZADD (score=issued_ms)
- `game:tickets:{game}` SADD
- `order:{order_id}` HASH status CONFIRMED
- `outbox:stream`에 `TICKET_ISSUED` (좌석당), `ORDER_PAID` (주문당) XADD

Lua 실행 중에는 Redis가 단일 스레드로 돌기 때문에 중간 상태가 외부에 노출되지 않습니다. 실패 시 스크립트 전체가 실패하므로 부분 반영도 없습니다.

### OrderConfirmService 재작성

Go 쪽은 Lua에 넘길 파라미터를 준비하고 `EVALSHA`로 한 번 호출하는 구조로 단순화됐습니다. 기존 PG direct write는 **모두 제거**했습니다. PG 영속은 outbox worker가 담당합니다.

### 멱등 설계

결제 시스템 특성상 동일 PG 트랜잭션이 재요청될 수 있습니다. `payment:idem:{pg_tx_id}`에 SETNX로 24시간 TTL 키를 심고, 이미 존재하면 즉시 성공 응답을 돌려줍니다. Lua 안에서 처리하므로 race condition이 없습니다.

---

## ✅ D6: tickets Redis ZSET + HASH 전환

### 기존 쿼리의 문제

`/tickets/myinfo` 응답의 `OwnedTicketCount`는 다음 SQL로 계산했습니다.

```sql
SELECT COUNT(*) FROM tickets WHERE user_id = ?;
```

사용자 티켓이 늘어날수록 조회 비용이 커지고, 대규모 티켓팅 이벤트 직후에는 이 쿼리가 자주 발생합니다. 인덱스가 있어도 COUNT(*)는 `seq scan` 회피가 어렵습니다.

### ZCARD 전환

D5b에서 이미 `user:tickets:{user}` ZSET에 티켓을 쌓고 있었기 때문에 Go 쪽 조회를 ZCARD로 바꾸기만 하면 됐습니다.

```text
Before: SELECT COUNT(*) FROM tickets WHERE user_id=?   (O(N) 성향)
After:  ZCARD user:tickets:{user}                      (O(1))
```

ZCARD는 Redis에서 O(1)입니다. 티켓 목록을 페이지 단위로 가져올 때는 ZREVRANGEBYSCORE로 이어 읽습니다. score가 issued_ms이므로 최신순 정렬도 무료로 얻습니다.

### ticket 상세

각 티켓의 상세는 `ticket:{ticket_id}` HASH(TTL 90d)에 있습니다. ZSET은 id 목록만, 상세는 HASH로 분리해 스키마를 단순하게 유지했습니다. game_title/game_date 같은 정적 데이터는 Redis가 아닌 PG의 `games` 테이블에 남겨뒀습니다. outbox worker가 나중에 ticket INSERT 시 JOIN하는 식으로 연결합니다.

---

## ✅ D5c/D7: Phase A 흔적 정리

### seatStatusCache 생성 제거

Phase A에서는 `seat:status:section:{game}:{section}` STRING 키에 좌석 상태를 2초 TTL로 캐시했습니다. SoT가 PG였고, Redis는 cache-aside 역할이었습니다.

D1에서 `seat-statuses` SoT read를 section HASH로 전환한 뒤에는 이 키가 필요 없었지만, 쓰기 경로가 남아 있어서 매번 section HASH 갱신과 함께 이 캐시도 갱신되고 있었습니다.

D7에서는 **이 캐시 생성 자체를 제거**했습니다. 결정 규칙 5("SoT 이원화 흔적은 남기지 않는다")에 따른 정리 작업입니다.

### order_cancel은 TODO

주문 취소 경로는 이번 세션에서 Redis SoT로 전환하지 못했습니다. 현재 `order_cancel_service.go`는 PG를 direct write합니다.

- `statusRepo.BatchUpdateStatus`
- `holdRepo.BatchUpdateStatus`
- `orderItemRepo.BatchUpdateStatus`
- `ticketRepo.BatchInvalidate`
- `orderRepo.UpdateOrderStatus`

다음 세션에서 `lua/order_cancel.lua` 신규 작성, `order_sot_repo.go`에 `Cancel` 메서드 추가, outbox worker에 `ORDER_CANCELED`/`TICKET_CANCELED` handler 추가 순서로 진행할 계획입니다.

---

## Redis 자료구조 최종 목록

D7 시점에서 Redis가 보유한 키 구조를 정리하면 다음과 같습니다.

| Key 패턴 | 타입 | 용도 | 발행 주체 |
|---|---|---|---|
| `seat:{game}:{section}` | HASH | 좌석 상태 (A/H:oid:uid/S:oid:uid) | D2 seat_hold.lua / D5b payment_confirm.lua |
| `hold:{game}:{seat}` | STRING TTL | 좌석 점유 (user:order 값) | D2 seat_hold.lua |
| `user:holds:{game}:{user}` | SET TTL | user 당 hold cap (4) | D2 seat_hold.lua |
| `hold:expiry:{game}` | ZSET | score=expire_unix, member=section:seat | D2 seat_hold.lua |
| `hold:id:{hold_id}` | STRING TTL | hold_id 역참조 | D2 SeatHoldService |
| `inv:{game}:{section}` | HASH | available/held/sold HINCRBY | D2 Lua / D3 reconcile |
| `order:{order_id}` | HASH | order PENDING/CONFIRMED | D4 order_create.lua / D5b payment_confirm.lua |
| `order:items:{order_id}` | LIST | 좌석 목록 | D4 order_create.lua |
| `user:orders:{user}` | ZSET | score=created_ms, member=order_id | D4 order_create.lua |
| `user:tickets:{user}` | ZSET | score=issued_ms, member=ticket_id | D5b payment_confirm.lua |
| `game:tickets:{game}` | SET | ticket_id (정산용) | D5b payment_confirm.lua |
| `ticket:{ticket_id}` | HASH TTL 90d | ticket 상세 | D5b payment_confirm.lua |
| `payment:idem:{pg_tx_id}` | STRING TTL 24h | 결제 멱등 키 | D5b payment_confirm.lua |
| `outbox:stream` | STREAM | 이벤트 큐 (MAXLEN ~1M) | 모든 Lua XADD |
| `outbox:dedup:{idem}` | STRING TTL 24h | EventBus.Publish dedup | pkg/eventbus |

D7 기준으로 Phase A의 `seat:status:section:{game}:{section}` 캐시 키는 **생성되지 않습니다**. `inventory:{game}` HASH는 Phase A legacy 용도로 남아 있지만 읽기/쓰기 경로에서 사용하지 않습니다.

---

## outbox 이벤트 타입 현황

| 이벤트 | 발행 시점 | handler 상태 |
|---|---|---|
| `SEAT_HELD` | D2 seat_hold.lua | 미구현 (log only) |
| `SEAT_RELEASED` | D2 seat_hold.lua | 미구현 (log only) |
| `SEAT_HOLD_EXPIRED` | D2 expiry 처리 | 미구현 (log only) |
| `ORDER_CREATED` | D4 order_create.lua | **D5a 구현됨** |
| `TICKET_ISSUED` | D5b payment_confirm.lua | 미구현 (log only) |
| `ORDER_PAID` | D5b payment_confirm.lua | 미구현 (log only) |

**중요한 운영 리스크**: `ORDER_PAID`, `TICKET_ISSUED` handler가 미구현 상태이기 때문에, 결제 완료 주문이 RDS에 `CONFIRMED`로 반영되지 않습니다. 정산·환불·조회 경로가 영향을 받습니다. 다음 세션에서 최우선으로 구현할 항목입니다.

---

## 다음 세션 즉시 착수 대상

### 1. outbox worker handler 확장 (HIGH)

- `order_paid.go`: Redis에서 order HGETALL → PG `orders.status=CONFIRMED` UPDATE → `order_items.status=PAID` UPDATE → `seat_statuses`를 SOLD로 UPSERT
- `ticket_issued.go`: Redis `ticket:{ticket_id}` HGETALL → PG `tickets` INSERT ON CONFLICT DO NOTHING
- `seat_hold_audit.go`: SEAT_HELD/RELEASED/HOLD_EXPIRED를 `seat_hold_audit` 테이블로 INSERT (낮은 우선순위)

기존 repository에 멱등 메서드를 추가해야 합니다.

- `TicketRepository.SaveIdempotent(ctx, q, *Ticket) error`
- `OrderRepository.SetConfirmedIdempotent(ctx, q, orderID)` (또는 `UpdateStatusIdempotent`)
- `SeatStatusRepository.BatchUpsert` (기존 `BatchUpdateStatus`로 충분한지 확인)

### 2. Goti-k8s `goti-outbox-worker` 배포 (HIGH)

- `charts/goti-outbox-worker/` 신규 Helm chart (deployment, service, servicemonitor, hpa, networkpolicy, externalsecret)
- `environments/prod-gcp/goti-outbox-worker/values.yaml`
- `applicationsets/goti-apps.yaml`에 outbox-worker 추가
- Goti-go `.github/workflows/cd-gcp.yml`의 `SERVICES` 목록에 `outbox-worker` 추가
- Goti-monitoring: alert rule `goti_outbox_lag_seconds > 30 for 5m`, Grafana panel 추가

배포 전까지는 outbox stream에 이벤트가 쌓이기만 하므로, 이 작업이 선행돼야 D4·D5b의 RDS 영속이 실제로 동작합니다.

### 3. order_cancel Redis SoT 전환 (MID)

- `lua/order_cancel.lua` 신규 작성
- `order_sot_repo.go`에 `Cancel(ctx, params)` 메서드 추가
- `service/order_cancel_service.go` 재작성 (PG write 제거)
- outbox worker에 `ORDER_CANCELED`/`TICKET_CANCELED` handler 추가

payment 환불 로직은 별도 도메인이므로 cancel 경로에서는 다루지 않습니다. `cancel_fee_rate`, `cancel_deadline_hours`는 static config에서 계산을 유지합니다.

---

## 📚 배운 점

### 신규 consumer 서비스는 "파이프라인 증명"부터

D5a에서 `goti-outbox-worker`를 띄울 때, 모든 이벤트 타입의 handler를 구현하려 하지 않았습니다. `ORDER_CREATED` 하나만 구현하고 나머지는 router에서 log only로 넘기도록 했습니다.

이것이 합리적이었던 이유는 **consumer group 설정, stream 소비, XACK, metric 노출 같은 공통 기반이 먼저 검증돼야 하기 때문**입니다. handler 구현은 기반이 돌아가는 것을 확인한 뒤에 하나씩 덧붙이면 됩니다.

### Lua atomic은 결제처럼 복잡한 경로에서 진가가 드러난다

D2의 `seat_hold.lua`는 비교적 단순했습니다. 좌석 상태 전환과 user cap 검사 정도였습니다.

D5b의 `payment_confirm.lua`는 달랐습니다. 여러 section HASH에 걸친 H→S 전환, ticket 발급, ZADD, SADD, outbox XADD를 한 번에 처리해야 했습니다. 이것을 Go에서 파이프라인으로 엮으면 중간 실패 처리가 복잡해지지만, Lua 스크립트 하나로 묶으면 `단일 실패 원칙`이 성립합니다.

결제는 실패 시 정합성이 깨지면 안 되는 대표적인 경로이기 때문에, Lua atomic의 비용(디버깅 난이도, 스크립트 관리)을 감수할 가치가 있습니다.

### ZCARD는 O(1), COUNT(*)는 그렇지 않다

`/tickets/myinfo`의 OwnedTicketCount처럼 **단순 카운트만 필요한 경로**는 Redis ZSET으로 옮기는 것이 거의 항상 이득입니다. 페이지네이션이 필요하면 ZRANGE로 얻고, 카운트만 필요하면 ZCARD로 얻습니다.

PostgreSQL의 COUNT(*)는 인덱스 only scan이 가능해도 실제로는 heap 접근이 필요한 경우가 많습니다. Redis ZCARD는 내부 카운터를 읽는 것이라 O(1)이 보장됩니다.

### SoT 이원화 흔적은 반드시 정리한다

D7에서 `seatStatusCache` 생성을 제거한 것은 기능적으로는 아무것도 바꾸지 않는 작업이었습니다. 그러나 남겨두면 **장애 조사 시 "어느 쪽이 맞는지" 헷갈리는 원인**이 됩니다.

SoT 전환이 끝나면 cache-aside든 legacy HASH든 쓰이지 않는 키는 코드에서 제거해야 합니다. 운영 중 데이터는 TTL로 자연히 만료되도록 두면 됩니다.

---

## 📎 관련 문서

- ADR-0017: `docs/adr/0017-redis-as-source-of-truth-adoption.md`
- SDD-0005 (§ 6 Rollout, § 12 Audit): `docs/dx/0005-redis-source-of-truth-sdd.md`
- 이전 롤아웃: `docs/dev-logs/2026-04-17-redis-sot-d0-d1-rollout.md`, `docs/dev-logs/2026-04-17-redis-sot-d2-d3-d4-rollout.md`
