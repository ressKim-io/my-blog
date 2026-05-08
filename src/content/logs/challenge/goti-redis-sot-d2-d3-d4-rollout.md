---
title: "Redis SoT D2~D4 롤아웃 — Lua 원자화와 PG 쓰기 경로 제거"
excerpt: "1주 시연 범위가 D0+D1에서 D0~D7 전체로 격상된 상황에서, seat_holds·inventory reconcile·orders의 SoT 전환을 하루 만에 순차 commit한 롤아웃 기록입니다"
type: troubleshooting
category: challenge
tags:
  - go-ti
  - Redis
  - SoT
  - Rollout
  - Production
  - Lua
  - PostgreSQL
  - adr
series:
  name: "goti-redis-sot"
  order: 6
date: "2026-04-17"
---

## 한 줄 요약

> 1주 시연의 부하 목표가 50만 VU까지 올라가면서 D0+D1만으로는 PG 쓰기 경로를 감당할 수 없게 됐습니다. 하루 동안 D2(seat_holds), D3(inventory reconcile), D4(orders)를 순차 commit해 PG INSERT/UPDATE QPS를 0으로 만들고, D5a outbox worker 착수로 이어갔습니다

## Impact

- **변경 범위**: hold/release 경로, inventory drift 감지, order create 경로
- **커밋 수**: 3개 (`b8466a0`, `0159918`, `2fa267a`)
- **후속 즉시 착수**: D5a outbox worker (RDS 영속 복원 필수)
- **발생일**: 2026-04-17

---

## 배경 전환: D0+D1에서 D0~D7 전체로

이전 세션에서는 1주 시연 범위를 "D0+D1만"으로 축소했습니다. 그런데 사용자가 다음 부하 목표를 제시했습니다.

> "10만 트래픽까지 가볼 거고, 버티면 50만까지 순차적으로 올려볼 거야."

즉 시연의 성격이 단순 UI 데모가 아니라 **프로덕션급 부하 검증**으로 바뀌었습니다.

D1까지 완료해도 seat-statuses read만 Redis로 빠져 있을 뿐, hold/order/payment/ticket의 PG 쓰기 경로는 그대로였습니다. 수십만 TPS를 PG가 흡수하기 어려운 구조입니다. SDD-0005에 정의된 D0~D7 전체 롤아웃이 필수 전제로 승격됐습니다.

정리하면 이번 세션의 목표는 다음과 같습니다.

- D2~D4를 하루 안에 순차 commit해 hold/inventory/order의 PG 쓰기를 제거합니다.
- D4 이후 RDS 영속 경로가 비어있으므로, D5a outbox worker를 즉시 착수합니다.
- 인프라 스케일업은 코드 완료 후 부하테스트 중 병목이 발생하는 시점에 순차 확장합니다.

---

## 🔥 문제: D1만으로는 50만 VU를 감당할 수 없다

### D1까지의 상태

| 경로 | 읽기 | 쓰기 |
|------|------|------|
| seat-statuses | Redis (D1 완료) | PG |
| seat_holds | PG | PG INSERT/UPDATE |
| inventory | Redis HGETALL | PG snapshot 동기화 |
| orders | PG | PG TX 7쿼리 |
| payment / ticket | PG | PG |

읽기 경로는 대부분 Redis로 옮겨졌지만, 쓰기 경로는 PG에 묶여 있었습니다. 50만 VU 부하에서는 hold/order INSERT만으로 pglogical 복제 병목과 PG lock contention이 예상됐습니다.

### 필요한 것

- seat_holds INSERT/UPDATE를 0으로 (Lua 원자 연산으로 대체)
- inventory drift를 주기적으로 감지·보정 (PG snapshot 신뢰도 확보)
- orders TX 7쿼리를 Lua 1회로 (create latency p95 대폭 축소)

---

## ✅ D2 — seat_holds Redis SoT (commit `b8466a0`)

### 변경 개요

hold/release 경로를 Redis Lua 원자 호출로 전면 전환했습니다. PG `seat_holds` INSERT/UPDATE를 완전히 제거하고, distLock도 함께 제거했습니다. Lua EVALSHA가 atomic을 보장하기 때문에 분산 락이 더 이상 필요하지 않습니다.

### Lua 스크립트 보강

`lua/seat_hold.lua`에 zombie 만료 후보 등록 로직을 추가했습니다.

```lua
-- KEYS[5]: hold:expiry:{game_id} (ZSET)
-- ARGV[7]: expire_at_unix
-- ARGV[8]: zombie_member (section_id:seat_id)
redis.call('ZADD', KEYS[5], ARGV[7], ARGV[8])
```

성공 시 ZSET에 만료 후보를 등록해두면, 이후 주기 작업에서 `ZRANGEBYSCORE`로 만료 대상만 골라 release할 수 있습니다.

`lua/seat_release.lua`는 expire 분기를 추가했습니다. hold_key가 부재이면서 section_hash에 `H:...` 잔존값이 있는 경우를 zombie로 판정해 복원합니다. 이 경로로 release된 hold는 `'EXPIRED'` reason을 반환하고, ZSET에서 member를 `ZREM`하며 `SEAT_HOLD_EXPIRED` outbox 이벤트를 발행합니다.

### Repository / Service 재작성

`seat_hold_sot_repo.go`에는 zombie_key/zombie_member 주입 로직과 함께 신규 메서드 두 개를 추가했습니다.

- `FetchExpired`: `ZRANGEBYSCORE hold:expiry:{game_id} -inf <now>`로 만료 대상을 가져옵니다.
- `ListActiveGames`: `SCAN hold:expiry:{*}`로 활성 게임 목록을 열거합니다.

`seat_hold_service.go`는 전면 재작성했습니다. distLock / PG TX / statusRepo.UpdateStatus / holdRepo.Save를 전부 제거했습니다. ReleaseSeat API에서 hold_id로 역참조할 수 있도록 STRING 키 `hold:id:{id}`를 추가했고, `ReleaseAllByUserAndGame`은 `user:holds` SMEMBERS 기반으로 동작하도록 바꿨습니다.

`seat_hold_expiry_service.go`도 ZSET zombie 기반으로 재작성했습니다. 각 game별로 `ZRANGEBYSCORE`를 돌려 만료 후보를 뽑고, Release Lua의 expire 분기를 호출해 정리합니다. 이 과정에서 grade 기반 inventory counter도 함께 보정됩니다.

### 효과

- PG `seat_holds` INSERT/UPDATE QPS가 **0**으로 떨어지면서 pglogical 부하가 급감합니다.
- hold/release latency가 수십 ms에서 5ms 미만으로 줄어들 것으로 예상됩니다. 단일 Lua EVALSHA 한 번으로 처리되기 때문입니다.
- 사용자당 hold cap(4장) 검증도 Lua 내부에서 1 RTT로 끝납니다.

### 미해결 / 후속

PG `seat_holds` 테이블 자체는 남아 있습니다. 기존 row도 그대로 유지되며, D7 정리 단계에서 archive/drop 여부를 다시 검토할 예정입니다.

감사 이벤트(`SEAT_HELD`, `SEAT_RELEASED`, `SEAT_HOLD_EXPIRED`)는 `outbox:stream`으로 발행되고 있지만, consumer(D5a)가 아직 없습니다. 현재 stream에 누적되는 중이고, D5a가 완료되면 소비가 시작됩니다.

---

## ✅ D3 — inventory reconcile + drift metric (commit `0159918`)

### 변경 개요

`inventory_sync_service.go`에 rdb(UniversalClient)를 주입하고, 신규 `ReconcileInvDrift` 메서드를 추가했습니다.

동작 흐름은 다음과 같습니다.

1. `SCAN inv:{*}:*`로 inventory 키 목록을 가져옵니다.
2. 해당 section의 seat HASH를 `HVALS`로 집계합니다.
3. inventory 카운터를 `HGETALL`로 읽어 비교합니다.
4. drift ratio가 0.001(0.1%)을 넘으면 `HSET`으로 overwrite합니다. seat HASH가 정답이라는 전제입니다.

### Prometheus 메트릭 추가

관측을 위해 두 개의 메트릭을 추가했습니다.

- `goti_inventory_drift_ratio` (Histogram, per section): drift 비율 분포
- `goti_inventory_reconcile_total{result=ok|drift|overwrite}`: 주기별 결과 카운트

`result="overwrite"`가 증가하면 실제로 drift가 발생해 보정된 것입니다. 이 지표가 알럿의 핵심 신호가 됩니다.

### 스케줄러 변경

`inventory_sync_scheduler.go`는 기존 `SyncDirtyGames`(grade-level PG snapshot)를 호출한 뒤 `ReconcileInvDrift`를 이어서 호출하도록 순서를 조정했습니다.

설정값도 함께 조정했습니다.

```yaml
inventory_sync_interval_ms: 60000  # 5000 → 60000
```

5초 주기였던 sync를 60초 주기로 완화했습니다. reconcile이 추가되면서 과도한 빈도가 불필요해졌기 때문입니다.

### 관측 전제

Grafana 대시보드와 알럿 룰은 `goti-monitoring` PR에서 별도로 추가할 예정입니다. `reconcile_total{result="overwrite"}` 증가가 drift 실제 발생 경고로 사용됩니다.

---

## ✅ D4 — orders Redis SoT + order_create.lua (commit `2fa267a`)

### 변경 개요

`lua/order_create.lua`를 신규 작성했습니다. 하나의 Lua 안에서 다음을 원자적으로 수행합니다.

- `HSET` order 생성
- `RPUSH` order_items 적재
- `ZADD user:orders` 인덱싱
- `XADD ORDER_CREATED` outbox 이벤트 발행

`lua/embed.go`에 OrderCreate 엔트리를 추가하고, 신규 `repository/order_sot_repo.go`에 `OrderSoTRepository` 인터페이스를 정의했습니다. 메서드는 `Create`, `Get`, `GetItems`, `MarkPaid` 네 개이며, 파라미터 타입으로 `OrderCreateParams`, `OrderItemRaw`를 함께 도입했습니다.

### Service 재작성

`service/order_create_service.go`는 전면 재작성했습니다. 변경 전후를 비교하면 다음과 같습니다.

| 항목 | Before (PG TX) | After (Redis Lua) |
|------|---------------|------------------|
| orders INSERT | 1회 | Lua 내부 HSET |
| orderer INSERT | 1회 | Lua 내부 HSET |
| orderItem BatchSave | 1회 (N건) | Lua 내부 RPUSH |
| duplicate 검사 | `FindDuplicateSeats` | reserveLock + D2 Lua TAKEN 분기 |
| grade lookup | 1회 | Lua 인자로 전달 |
| hold 조회 | PG `FindByIDs` | `MGET hold:id:{holdID}` |
| 합계 | **PG TX 7쿼리** | **Lua EVALSHA 1회** |

TX 7쿼리를 Lua 한 번으로 압축했습니다. duplicate 검사는 reserveLock과 D2 Lua의 TAKEN 분기가 race를 이미 차단하므로 별도 쿼리가 필요하지 않습니다.

### 설정 및 주입

```yaml
redis_sot:
  orders: true  # false → true
```

`main.go`에서는 OrderSoTRepo를 주입하고, OrderCreateService의 시그니처를 그에 맞게 변경했습니다.

### 효과 (예상)

- order create p95가 약 900ms에서 5~20ms로 떨어질 것으로 예상합니다.
- PG orders/order_items INSERT QPS가 **0**으로 떨어집니다.
- 50만 TPS 목표에서 orders 테이블 write 병목이 제거됩니다.

### 치명적 전제

여기서 반드시 짚고 넘어가야 할 점이 있습니다.

**D4 완료 후에는 RDS에 주문 기록이 전혀 남지 않는 상태**입니다. D5a outbox worker가 없으면 다음 문제가 누적됩니다.

- 정산 / 감사 / 환불 근거 누락
- Multi-cloud DB failover 시 GCP Redis 데이터가 AWS로 전파되지 않음
- 법적 / 세무 / PG 사와의 대조 불가

따라서 **D5a를 최우선 후속 작업으로 즉시 착수**하는 것이 전제조건입니다. 아래 섹션에서 착수 범위를 정리합니다.

---

## D5a — goti-outbox-worker 착수 (진행 중)

### 목표

`outbox:stream`을 `XREADGROUP`으로 소비해 RDS에 idempotent UPSERT하는 신규 Go 서비스를 만듭니다. Redis가 SoT인 상태에서 RDS는 **감사·정산·failover용 영속 계층**으로 위치합니다.

### 예상 범위

- `cmd/outbox-worker/main.go` (신규)
- `internal/outbox/handler/*.go` — 이벤트 타입별 handler:
  - `SEAT_HELD` / `SEAT_RELEASED` / `SEAT_HOLD_EXPIRED` → `seat_hold_audit` UPSERT
  - `ORDER_CREATED` → `orders` + `order_items` + `orderers` UPSERT
  - `ORDER_PAID` (D5b에서 발행) → `orders.status` UPDATE + `tickets` INSERT + `seat_sold_audit` INSERT
  - `TICKET_ISSUED` → tickets UPSERT
  - `INVENTORY_SNAPSHOT` → `game_seat_inventories` UPSERT
- `internal/outbox/repository/*.go` — ON CONFLICT 기반 UPSERT 함수
- `deployments/Dockerfile`에 SERVICE=outbox-worker 빌드 분기
- Goti-k8s Helm chart + prod-gcp values + ArgoCD Application
- Goti-monitoring 알럿 룰 (outbox_lag_seconds, XPENDING)

### 운영 지표

- `outbox_lag_seconds` p99 < 5s
- `outbox_pending_count` (XPENDING) < 10k
- `outbox_handler_error_total` 증가 시 알럿

---

## 커밋 요약

| 커밋 | 범위 | 주요 효과 |
|---|---|---|
| `e1bc2f3` | D1 seat-statuses SoT read | GET p95 900ms → 5-20ms |
| `b8466a0` | D2 seat_holds Lua + PG write 제거 | hold/release Redis-only, PG INSERT 0 |
| `0159918` | D3 inventory reconcile | drift metric + 자동 정정 |
| `2fa267a` | D4 orders Redis SoT + Lua | order create PG TX 7쿼리 → Lua 1회 |
| (예정) | D5a outbox worker | RDS 영속 복원 |

D1은 이전 세션에서 이미 commit된 상태이고, 본 세션에서 D2·D3·D4 세 건을 추가했습니다.

---

## 남은 로드맵

| D | 예상 공수 | 비고 |
|---|---|---|
| D5a outbox worker | 1~1.5일 | 진행 중. RDS 영속 복원 필수 |
| D5b payment_confirm.lua | 0.5일 | Lua atomic CAS + 티켓 발급 + XADD ORDER_PAID |
| D5c dual-write off | 0.3일 | order_confirm / order_cancel 등 PG direct write 제거 |
| D6 tickets Redis | 0.2일 | `/tickets/myinfo` ZSET + HASH |
| D7 정리 | 0.5일 | Phase A cache 제거 + flag 일괄 제거 + 통합 테스트 |
| pglogical + AWS 재기동 | 1~1.5일 | 의존: D5 완료 |
| K6 10만/30만/50만 단계별 | 1.5~2일 | 각 단계 병목 시 Redis 확장 + dev-log |
| DR 시연 + 마무리 | 0.5일 | |

---

## 인프라 확장 기록 전략 (점진적)

Redis를 처음부터 대규모로 띄우지 않고, BASIC 1GB부터 시작해 **부하 단계별로 병목이 나타날 때 확장**하는 방식을 택했습니다. 확장 자체가 시연 스토리의 일부이기 때문입니다.

- **10만 VU 병목 시**: BASIC 1GB → STANDARD_HA 5GB (in-place 불가, force-replace)
- **30만 VU 병목 시**: STANDARD_HA → Cluster 3 shard × 1 replica
- **50만 VU 병목 시**: shard 추가 또는 outbox worker HPA

각 단계의 **실측 병목 지표 → 확장 결정 → 후속 효과**를 별도 dev-log로 기록할 계획입니다. 이 흐름이 시연 자료의 핵심 스토리라인이 됩니다.

---

## 📚 배운 점

### Lua EVALSHA는 distLock의 상위 호환이다

D2에서 distLock을 제거할 수 있었던 이유는 Lua가 atomic을 이미 보장하기 때문입니다. 기존에는 hold/release가 여러 키를 건드린다는 이유로 분산 락을 돌렸지만, 같은 작업을 Lua 한 스크립트로 묶으면 락 자체가 불필요합니다. 대신 Lua 내부 로직이 조건 분기(TAKEN, EXPIRED, OK)를 스스로 관리해야 합니다.

### Silent fail을 피하려면 drift를 스스로 감지해야 한다

D3의 reconcile은 "PG와 Redis가 언젠가는 어긋난다"는 전제에서 출발합니다. 어긋남 자체를 없애기보다, **주기적으로 감지해 보정하고 그 빈도를 메트릭으로 노출**하는 방향이 훨씬 안전합니다. `reconcile_total{result="overwrite"}` 증가 = 실제 drift 발생이라는 신호를 만들어두면, 운영 중 "데이터가 맞을까?"라는 질문을 메트릭으로 답할 수 있습니다.

### Redis SoT 전환은 outbox 없이 완성되지 않는다

D4까지만 적용하고 멈추면 RDS에 주문 기록이 남지 않습니다. SoT 전환은 **Redis 원자 연산(쓰기) + outbox worker(영속)** 가 한 쌍입니다. 한쪽만 배포된 구간은 "시연은 가능하지만 운영은 불가능한" 상태이므로, D4와 D5a는 같은 배포 단위로 묶여야 합니다.

### 부하 목표가 바뀌면 롤아웃 범위도 재평가한다

1주 시연 범위를 D0+D1로 축소했다가, 10만~50만 VU 목표가 나오자 D0~D7 전체로 되돌린 것은 "작게 시작하기"보다 "목표를 먼저 확정하기"가 우선이라는 것을 보여줍니다. 목표가 흐릿하면 범위 축소가 쉽게 뒤집힙니다.

---

## 📎 참고 자료

- ADR-0017 `docs/adr/0017-redis-as-source-of-truth-adoption.md` — Redis SoT 전면 채택
- SDD-0005 `docs/dx/0005-redis-source-of-truth-sdd.md` § 6 Rollout (D2~D7 PR 체크리스트), § 12 Current Code Audit
- 이전 rollout: `docs/dev-logs/2026-04-17-redis-sot-d0-d1-rollout.md`
- CF Worker LAX 이슈: `docs/dev-logs/2026-04-17-cloudflare-worker-lax-latency-investigation.md`
