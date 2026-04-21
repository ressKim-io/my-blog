# 2026-04-18 — Redis SoT D5a / D5b / D6 / D5c·D7 연속 rollout

## TL;DR

- D5a `goti-outbox-worker` 신규 Go 서비스 추가 (XREADGROUP consumer, ORDER_CREATED handler 우선 구현)
- D5b `payment_confirm.lua` — 결제 확정을 Redis atomic 1 회로 통합 (order CONFIRMED + 좌석 H→S + ticket 발급)
- D6 tickets ZSET + HASH — `/tickets/myinfo` OwnedTicketCount 를 ZCARD 로 전환 (PG COUNT(*) → O(1))
- D5c/D7 부분 정리 — Phase A `seatStatusCache` 생성 제거 (결정 규칙 5), order_cancel 은 TODO
- **다음 세션 즉시 착수 대상 3개**: outbox worker 추가 handler / Goti-k8s Helm chart / order_cancel Redis 전환

## 커밋 히스토리 (Goti-go, 2026-04-17 ~ 04-18)

| 커밋 | D | 주요 변경 |
|---|---|---|
| `e1bc2f3` | D1 | seat-statuses SoT read (handler 재배선 + flag on) |
| `b8466a0` | D2 | seat_holds Lua atomic + PG write 제거 + ZSET zombie expiry |
| `0159918` | D3 | inventory 1분 reconcile + drift metric |
| `2fa267a` | D4 | orders Redis SoT + order_create.lua |
| `58fdbe0` | **D5a** | **goti-outbox-worker 신규 서비스 + ORDER_CREATED handler** |
| `c3042ba` | **D5b** | **payment_confirm.lua + OrderConfirmService 재작성** |
| `1c4ed27` | **D6** | **tickets Redis ZSET + HASH (/tickets/myinfo ZCARD)** |
| `6bb7d64` | D5c/D7 | Phase A seatStatusCache 생성 제거 + cancel TODO |

## 구조 요약 (2026-04-18 현 시점)

### Redis 자료구조 전체 목록

| Key 패턴 | 타입 | 용도 | 발행 주체 |
|---|---|---|---|
| `seat:{game}:{section}` | HASH | seat 상태 (A/H:oid:uid/S:oid:uid) | D2 seat_hold.lua / D5b payment_confirm.lua |
| `hold:{game}:{seat}` | STRING TTL | 좌석 점유 (user:order 값) | D2 seat_hold.lua |
| `user:holds:{game}:{user}` | SET TTL | user 당 hold cap (4) | D2 seat_hold.lua |
| `hold:expiry:{game}` | ZSET | score=expire_unix, member=section:seat (zombie) | D2 seat_hold.lua |
| `hold:id:{hold_id}` | STRING TTL | hold_id → game:section:seat:user 역참조 | D2 SeatHoldService |
| `inv:{game}:{section}` | HASH | available/held/sold HINCRBY | D2 Lua / D3 reconcile |
| `inventory:{game}` (legacy Phase A) | HASH | grade 단위 counter (기존) | InventoryRedisRepository |
| `seat:status:section:{game}:{section}` (Phase A) | STRING | cache-aside TTL 2s | **D7 에서 생성 제거됨** |
| `order:{order_id}` | HASH | order PENDING/CONFIRMED | D4 order_create.lua / D5b payment_confirm.lua |
| `order:items:{order_id}` | LIST | "seat:section:hold:grade:price" × N | D4 order_create.lua |
| `user:orders:{user}` | ZSET | score=created_ms, member=order_id | D4 order_create.lua |
| `user:tickets:{user}` | ZSET | score=issued_ms, member=ticket_id | D5b payment_confirm.lua |
| `game:tickets:{game}` | SET | ticket_id (정산용) | D5b payment_confirm.lua |
| `ticket:{ticket_id}` | HASH TTL 90d | ticket 상세 | D5b payment_confirm.lua |
| `payment:idem:{pg_tx_id}` | STRING TTL 24h | 결제 멱등 키 | D5b payment_confirm.lua |
| `outbox:stream` | STREAM | 이벤트 큐 (MAXLEN ~1M) | 모든 Lua XADD |
| `outbox:dedup:{idem}` | STRING TTL 24h | EventBus.Publish dedup | pkg/eventbus |

### 발행되는 outbox 이벤트 타입

- `SEAT_HELD` / `SEAT_RELEASED` / `SEAT_HOLD_EXPIRED` (D2)
- `ORDER_CREATED` (D4) — **D5a handler 구현됨**
- `TICKET_ISSUED` (D5b) — per seat
- `ORDER_PAID` (D5b) — per order

### goti-outbox-worker 현 상태

- cmd: `cmd/outbox-worker/main.go`
- config: `configs/outbox-worker.yaml` (DB + Redis + OTel)
- consumer group: `ticketing-persister`
- Router: `internal/outbox/worker/router.go`
- Handler: `internal/outbox/handler/order_created.go` — orders/orderers/order_items UPSERT
- Metrics: goti_outbox_handled_total{type,result}, goti_outbox_handle_duration_seconds{type}, goti_outbox_lag_seconds
- HTTP :9090: /metrics, /healthz, /readyz
- **미구현 handler**: ORDER_PAID / TICKET_ISSUED / SEAT_HELD / SEAT_RELEASED / SEAT_HOLD_EXPIRED / SEAT_SOLD — 전부 router 에서 "unknown" 으로 ACK + log only

## 다음 세션 즉시 착수 대상 (순서)

### 1. outbox worker handler 확장 (우선순위 HIGH)

ORDER_PAID 처리 안 되면 결제 완료 주문이 RDS 에 CONFIRMED 로 반영 안 됨. 정산 / 환불 불가. TICKET_ISSUED 도 동일.

**구현 범위**:
- `internal/outbox/handler/order_paid.go` (신규)
  - Event payload: order_id, user_id, game_id, paid_at, item_count
  - 처리:
    1. Redis `order:{order_id}` HGETALL 로 order 전체 로드 (OrderSoTRepo.Get)
    2. PG orders.status = 'CONFIRMED' UPDATE (orderRepo.ConfirmOrder or 신규 SetPaidStatus)
    3. items 도 status=PAID 로 UPDATE (orderItemRepo.BatchUpdateStatus — 기존 메서드 재활용)
    4. seat_statuses 도 SOLD 로 UPSERT (statusRepo.BatchUpdateStatus)
  - 멱등성: order.status 가 이미 CONFIRMED 면 skip
- `internal/outbox/handler/ticket_issued.go` (신규)
  - Event payload: ticket_id, order_id, user_id, game_id, seat_id, price
  - 처리:
    1. Redis `ticket:{ticket_id}` HGETALL (TicketSoTRepo.Get 재활용)
    2. PG tickets INSERT ON CONFLICT DO NOTHING (ticketRepo 신규 SaveIdempotent 추가)
    3. game/game_title/game_date 는 Redis HASH 에 없으니 gameRepo.FindByID (static)
  - 주의: ticket 의 유일키 (order_item_id, seat_id) 고려
- `internal/outbox/handler/seat_hold_audit.go` (신규, 낮은 우선순위)
  - SEAT_HELD / SEAT_RELEASED / SEAT_HOLD_EXPIRED → seat_hold_audit 테이블 INSERT
  - 테이블 없으면 SQL migration 필요 (또는 기존 seat_holds 재활용 — 주의: D2 에서 write 0 이지만 row 존재)
- `cmd/outbox-worker/main.go`: router.Register(...) 추가 호출
- 기존 repository 에 필요한 idempotent 메서드 추가:
  - `TicketRepository.SaveIdempotent(ctx, q, *Ticket) error`
  - `OrderRepository.SetConfirmedIdempotent(ctx, q, orderID)` or `UpdateStatusIdempotent`
  - `SeatStatusRepository.BatchUpsert` (or 기존 BatchUpdateStatus 로 충분한지 확인)

**테스트**: miniredis + pg 통합 테스트 신규 (가능하면)

### 2. Goti-k8s 에 `goti-outbox-worker` 배포 매니페스트 (우선순위 HIGH)

outbox worker 가 실제 prod 에 떠 있어야 D4/D5b 의 RDS 영속이 동작. 미배포 상태면 stream 에 이벤트 쌓이기만.

**구현 범위**:
- `charts/goti-outbox-worker/` Helm chart 신규:
  - Chart.yaml, values.yaml
  - templates/deployment.yaml (replicas 3, HPA max 10 기준, PDB maxUnavailable=1)
  - templates/service.yaml (port 9090, ClusterIP)
  - templates/servicemonitor.yaml (Prometheus scrape)
  - templates/hpa.yaml (CPU 60% or custom metric outbox_lag_seconds)
  - templates/networkpolicy.yaml (egress DB/Redis만)
  - templates/externalsecret.yaml (DB / Redis credentials)
- 또는 기존 `goti-common` library chart 활용 (Goti-k8s 에 이미 있음 확인 필요)
- `environments/prod-gcp/goti-outbox-worker/values.yaml`:
  - image.repository: asia-northeast3-docker.pkg.dev/.../goti-outbox-worker-go
  - image.tag: (최초 배포 시 수동, 이후 CD 자동)
  - env: DATABASE_URL / REDIS_URL / OTEL_EXPORTER 등
- `applicationsets/goti-apps.yaml` (또는 equivalent) 에 outbox-worker 추가 — ArgoCD ApplicationSet generator 에 name 추가
- Goti-go `.github/workflows/cd-gcp.yml` 의 SERVICES 목록에 `outbox-worker` 추가 (현재: user stadium ticketing payment resale queue)
- Goti-monitoring:
  - alert rule: `goti_outbox_lag_seconds > 30` for 5m
  - alert rule: `goti_outbox_handled_total{result="error"}` rate 증가
  - Grafana 대시보드 panel 추가 (outbox throughput, lag, handler duration)

**주의**:
- GCP Artifact Registry 는 이미 `goti-prod-registry` 레포지토리 사용 중. 새 이미지 이름만 추가.
- ExternalSecret 은 기존 goti-ticketing 의 DB/Redis secret 경로 재활용 가능.

### 3. order_cancel_service Redis SoT 전환 (우선순위 MID)

현재 `order_cancel_service.go` 가 PG direct write (statusRepo.BatchUpdateStatus / holdRepo.BatchUpdateStatus / orderItemRepo.BatchUpdateStatus / ticketRepo.BatchInvalidate / orderRepo.UpdateOrderStatus).

**구현 범위**:
- `lua/order_cancel.lua` (신규):
  - 각 seat S → A 복원 (section_hash HSET), inv sold→available
  - ticket HDEL 또는 status=CANCELED
  - order status CANCELED
  - user:tickets ZREM, game:tickets SREM
  - XADD SEAT_CANCELED / ORDER_CANCELED / TICKET_CANCELED
- `repository/order_sot_repo.go` 에 `Cancel(ctx, params)` 메서드
- `service/order_cancel_service.go` 재작성 (PG write 제거, Lua 경로)
- outbox worker 에 ORDER_CANCELED / TICKET_CANCELED handler 추가:
  - orders.status / order_items.status / tickets.status UPDATE
  - seat_statuses SOLD → AVAILABLE UPDATE (or audit only)
  - cancel_fee / refund 계산은 별도 (payment 서비스 역할)

**주의**:
- payment 환불 로직은 별도 도메인 (payment service). Order cancel 은 Redis / outbox 만.
- cancel_fee_rate / cancel_deadline_hours 는 여전히 service 에서 계산 (static config).

## 이후 로드맵 (clear 후에도 유지)

| 항목 | 상태 | 우선순위 |
|---|---|---|
| outbox worker handler 확장 (ORDER_PAID / TICKET_ISSUED / SEAT_AUDIT) | ⏳ | **HIGH** |
| Goti-k8s goti-outbox-worker chart + values + ApplicationSet | ⏳ | **HIGH** |
| order_cancel Redis SoT 전환 + seat_cancel.lua | ⏳ | MID |
| pglogical 양방향 DB 동기화 (AWS RDS ↔ GCP Cloud SQL) | ⏳ | MID |
| AWS EKS 재기동 (**비용 발생 — 사용자 승인 필수**) | ⏳ | 대기 |
| 양 클라우드 동시 운영 검증 | ⏳ | 대기 |
| K6 10만/30만/50만 단계별 부하 | ⏳ | 대기 |
| 부하 단계별 Redis 인프라 순차 확장 (BASIC→STANDARD_HA→Cluster) | ⏳ | 부하 의존 |
| GCP shutdown → AWS failover 시연 | ⏳ | 최종 |
| DR 시연 dev-log + 프로젝트 마무리 문서 | ⏳ | 최종 |

## 인프라 전제 (현 시점)

- GCP Memorystore BASIC 1GB 단일 노드, `maxmemory-policy: noeviction` 적용 완료 (Terraform `9761dd2`)
- GCP Cloud SQL PostgreSQL (기존) — outbox worker 가 UPSERT 대상
- AWS EKS cost freeze 중 (노드 0)
- Cloudflare Worker `goti-prod-proxy` — Smart Placement 활성 (사용자 Dashboard 수동)
- Goti-front, Goti-server 변경 없음 (응답 schema 무변경)

## 비용 유발 action 주의 (Auto mode 무시 금지)

`memory/feedback_no_cost_action_without_approval.md` 규칙 준수. 다음은 자동 실행 금지:
- AWS EKS 노드 scale up (0 → N)
- AWS RDS/ElastiCache start-instance
- GCP Memorystore STANDARD_HA/Cluster 전환
- Cloudflare 유료 plan / Argo / Load Balancing

코드 작업 (Goti-go, Goti-k8s values, 문서) 은 비용 없음 — 계속 자동 진행 OK.

## 관련 문서 (clear 후 참조)

- ADR-0017: `docs/adr/0017-redis-as-source-of-truth-adoption.md`
- SDD-0005 (§ 6 Rollout, § 12 Audit): `docs/dx/0005-redis-source-of-truth-sdd.md`
- 이전 rollout 기록:
  - `docs/dev-logs/2026-04-17-redis-sot-d0-d1-rollout.md`
  - `docs/dev-logs/2026-04-17-redis-sot-d2-d3-d4-rollout.md`
- Cloudflare LAX 이슈: `docs/dev-logs/2026-04-17-cloudflare-worker-lax-latency-investigation.md`
- 메모:
  - `memory/project_redis_sot_rollout_status.md` — 진행 상태 + 다음 작업 체크리스트 (본 세션 신규)
  - `memory/project_timeline_end_next_week.md` — 프로젝트 종료 ~2026-04-24
  - `memory/feedback_no_cost_action_without_approval.md` — 비용 action 승인 규칙
  - `memory/feedback_goti_go_autonomy.md` — Goti-go commit/push 자율 권한
