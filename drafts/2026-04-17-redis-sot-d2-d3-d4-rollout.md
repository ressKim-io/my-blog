# 2026-04-17 — Redis SoT D2 / D3 / D4 연속 rollout + D5a 착수

## TL;DR

- 10만 ~ 50만 VU 부하 목표 확정 후 1주 시연 범위를 "D0+D1" 에서 "D0~D7 전체" 로 격상
- D2 (seat_holds Redis SoT + Lua), D3 (inventory 1분 reconcile + drift metric), D4 (orders Lua + PENDING Redis SoT) 를 순차 구현·commit 완료
- D5a (goti-outbox-worker 신규 서비스) 착수 — D4 이후 RDS orders/order_items 영속 경로가 비어있어 우선순위 최상위
- 인프라 스케일업 (Memorystore STANDARD_HA / Cluster) 은 코드 완료 후 부하테스트 중 병목 발생 시점에 순차 확장하기로 확정 (점진적 기록 축적)

## 배경 전환

이전 세션 (`2026-04-17-redis-sot-d0-d1-rollout.md`) 은 "1주 시연 = D0+D1 만" 으로 축소했으나, 사용자가 다음 부하 목표를 제시:

> "10만 트래픽까지 가볼꺼고, 버티면 50만까지 순차적으로 올려볼꺼야."

즉 시연이 단순 UI 데모가 아니라 **프로덕션급 부하 검증**. D1 (seat-statuses read) 만으로는 PG 쓰기 경로 (hold/order/payment/ticket) 가 그대로라 수십만 TPS 흡수 불가. SDD-0005 D0~D7 전체 롤아웃이 필수 전제로 승격.

SDD-0005 § 6 의 Start 범위와 ADR-0017 § D0 인프라 Start 표기는 본 rollout 과 별도로 갱신 예정 (§ 관련 문서 참조).

## D2 — seat_holds Redis SoT (commit `b8466a0`)

### 변경

hold/release 경로를 Redis Lua 원자 호출로 전면 전환. PG `seat_holds` INSERT/UPDATE 완전 제거. distLock 도 함께 제거 (Lua EVALSHA 가 atomic 보장).

### Lua 보강
- `lua/seat_hold.lua`:
  - KEYS[5] `hold:expiry:{game_id}` (ZSET zombie) 추가
  - ARGV[7] expire_at_unix, ARGV[8] zombie_member (`section_id:seat_id`)
  - 성공 시 ZADD hold:expiry 로 만료 후보 등록
- `lua/seat_release.lua`:
  - hold_key 부재 + section_hash 'H:...' 잔존 조건 시 **expire 분기** 로 복원
  - 'EXPIRED' reason 반환, zombie ZREM + `SEAT_HOLD_EXPIRED` outbox 이벤트

### Repository / Service
- `seat_hold_sot_repo.go`:
  - Hold/Release 에 zombie_key / zombie_member 주입
  - 신규 `FetchExpired` (ZRANGEBYSCORE), `ListActiveGames` (SCAN `hold:expiry:{*}`)
- `seat_hold_service.go`: 전면 재작성
  - distLock / PG TX / statusRepo.UpdateStatus / holdRepo.Save 모두 제거
  - hold_id 역참조 STRING `hold:id:{id}` 추가 (ReleaseSeat API 용)
  - `ReleaseAllByUserAndGame`: user:holds SMEMBERS 기반
- `seat_hold_expiry_service.go`: ZSET zombie 기반으로 재작성
  - 각 game 별 ZRANGEBYSCORE → Release Lua expire 분기로 정리
  - grade 기반 inv counter 보정

### 효과
- PG `seat_holds` INSERT/UPDATE QPS **0** (pglogical 부하 급감)
- hold/release latency 수십 ms → 예상 < 5ms (단일 Lua EVALSHA)
- user 당 hold cap (4) 검증도 Lua 내부 1 RTT

### 미해결 / 후속
- PG `seat_holds` 테이블 자체는 존재. 기존 row 는 유지 (neutral). D7 정리 단계에서 archive/drop 검토.
- 감사 이벤트 (`SEAT_HELD`, `SEAT_RELEASED`, `SEAT_HOLD_EXPIRED`) 는 `outbox:stream` 로 발행되지만 consumer (D5a) 미구축 → 현재 stream 에 누적 중. D5a 완료 시 소비 시작.

## D3 — inventory reconcile + drift metric (commit `0159918`)

### 변경
- `inventory_sync_service.go`:
  - rdb (UniversalClient) 주입
  - 신규 `ReconcileInvDrift`: SCAN `inv:{*}:*` → HVALS section seat 집계 → HGETALL inv 비교
  - drift ratio > 0.001 (0.1%) 시 `HSET` overwrite (seat HASH 가 정답)
  - Prometheus metric:
    - `goti_inventory_drift_ratio` (Histogram, per section)
    - `goti_inventory_reconcile_total{result=ok|drift|overwrite}`
- `inventory_sync_scheduler.go`:
  - 기존 `SyncDirtyGames` (grade-level PG snapshot) 후 `ReconcileInvDrift` 순서 호출
- config: `inventory_sync_interval_ms 5000 → 60000`

### 관측 전제
Grafana 대시보드 / alert rule 은 본 rollout 후 `goti-monitoring` PR 에서 추가 예정. reconcile_total{result="overwrite"} 증가 = drift 실제 발생 경고.

## D4 — orders Redis SoT + order_create.lua (commit `2fa267a`)

### 변경
- `lua/order_create.lua` (신규): HSET order + RPUSH items + ZADD user:orders + XADD ORDER_CREATED
- `lua/embed.go`: OrderCreate 추가
- `repository/order_sot_repo.go` (신규): OrderSoTRepository (Create/Get/GetItems/MarkPaid), OrderCreateParams, OrderItemRaw
- `service/order_create_service.go`: 전면 재작성
  - PG TX 7 쿼리 (orders INSERT + orderer INSERT + orderItem BatchSave + duplicate 검사 + grade lookup) → Lua EVALSHA 1 회
  - holdRepo.FindByIDs (PG) → Redis MGET `hold:id:{holdID}`
  - orderItemRepo.FindDuplicateSeats 제거 (reserveLock + D2 Lua TAKEN 분기가 race 차단)
- configs: `redis_sot.orders: false → true`
- main.go: OrderSoTRepo 주입 + OrderCreateService 시그니처 변경

### 효과 (예상)
- order create p95 ~900ms → 5~20ms
- PG orders/order_items INSERT QPS **0**
- 50만 TPS 목표에서 orders 테이블 write 병목 제거

### 치명적 전제
**D4 완료 후 RDS 에 주문 기록이 전혀 남지 않는 상태**. D5a outbox worker 가 없으면:
- 정산 / 감사 / 환불 근거 누락
- Multi-cloud DB failover 시 GCP Redis 데이터 AWS 로 전파 불가
- 법적 / 세무 / PG 사 대조 불가

따라서 **D5a 를 최우선 후속 작업으로 즉시 착수**. 본 dev-log 의 § 다음 단계.

## D5a — goti-outbox-worker 착수 (진행 중)

### 목표
`outbox:stream` 을 XREADGROUP 으로 소비해 RDS 에 idempotent UPSERT 하는 신규 Go 서비스.

### 예상 범위
- `cmd/outbox-worker/main.go` (신규)
- `internal/outbox/handler/*.go` 이벤트 타입별 handler:
  - `SEAT_HELD` / `SEAT_RELEASED` / `SEAT_HOLD_EXPIRED` → `seat_hold_audit` UPSERT
  - `ORDER_CREATED` → `orders` + `order_items` + `orderers` UPSERT
  - `ORDER_PAID` (D5b 에서 발행) → `orders.status` UPDATE + `tickets` INSERT + `seat_sold_audit` INSERT
  - `TICKET_ISSUED` → tickets UPSERT
  - `INVENTORY_SNAPSHOT` → `game_seat_inventories` UPSERT
- `internal/outbox/repository/*.go` ON CONFLICT UPSERT 함수
- `deployments/Dockerfile` SERVICE=outbox-worker 빌드 분기
- Goti-k8s Helm chart + prod-gcp values + ArgoCD Application
- Goti-monitoring alert rule (outbox_lag_seconds, XPENDING)

### 운영 지표
- `outbox_lag_seconds` p99 < 5s
- `outbox_pending_count` (XPENDING) < 10k
- `outbox_handler_error_total` 증가 시 alert

## 커밋 요약 (Goti-go, 2026-04-17 기준)

| 커밋 | 범위 | 주요 효과 |
|---|---|---|
| `e1bc2f3` | D1 seat-statuses SoT read | GET p95 900ms → 5-20ms |
| `b8466a0` | D2 seat_holds Lua + PG write 제거 | hold/release Redis-only, PG INSERT 0 |
| `0159918` | D3 inventory reconcile | drift metric + 자동 정정 |
| `2fa267a` | D4 orders Redis SoT + Lua | order create PG TX 7쿼리 → Lua 1회 |
| (예정) | D5a outbox worker | RDS 영속 복원 |

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

## 인프라 확장 기록 전략 (점진적)

Redis BASIC 1GB 부터 시작. 부하 단계별로 병목 발견 시 확장 + dev-log:

- **10만 VU** 병목 시: BASIC 1GB → STANDARD_HA 5GB (in-place 불가, force-replace)
- **30만 VU** 병목 시: STANDARD_HA → Cluster 3 shard × 1 replica
- **50만 VU** 병목 시: shard 추가 or outbox worker HPA

각 단계의 **실측 병목 지표 → 확장 결정 → 후속 효과** 를 별도 dev-log 로 기록. 시연 자료 핵심 스토리라인.

## 관련

- ADR-0017 `docs/adr/0017-redis-as-source-of-truth-adoption.md` — Redis SoT 전면 채택
- SDD-0005 `docs/dx/0005-redis-source-of-truth-sdd.md` § 6 Rollout (D2~D7 PR 체크리스트), § 12 Current Code Audit
- 이전 rollout: `docs/dev-logs/2026-04-17-redis-sot-d0-d1-rollout.md`
- CF Worker LAX 이슈: `docs/dev-logs/2026-04-17-cloudflare-worker-lax-latency-investigation.md`
- Memory: `project_timeline_end_next_week.md`, `feedback_goti_go_autonomy.md`
