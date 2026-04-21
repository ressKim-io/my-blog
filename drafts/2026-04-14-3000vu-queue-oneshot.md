# 2026-04-14 부하테스트 — 3000 VU queue-oneshot

## 환경
- 대상: prod (AWS EKS, RDS PostgreSQL 16, ElastiCache Redis)
- 게임: 2026-04-16 KIA 홈, gameId=`acfe6b0f-fb0f-4c0a-8d19-9063e5025428`
- 큐 max_capacity: 1000
- 시나리오: `queue-oneshot` (1 VU 1 iteration, 대규모 동시 진입)
- VU: 3000 / 30분 max
- 도구: k6 0.56.0 on EC2 (i-0f5fcae00e8d06a77)

## 사전 변경
- PgBouncer 최초 도입 (session 모드, default_pool_size 80, max_client_conn 5000)
- 6 v2 서비스 모두 PgBouncer 경유로 전환 (`dbname=goti_{svc}`)
- ticketing seat_holds + grades TTL cache (30s in-memory)

## 결과 요약
| 지표 | 값 | 임계 |
|---|---|---|
| 완료 iterations | 3000 / 3000 | 100% |
| 실행 시간 | 3분 44초 | — |
| **goti_ticket_success_rate** | **15.60% (468/3000)** | ❌ |
| http_req_failed | 4.40% (3980/90415) | — |
| http_req_duration p95 | 2.88s | ❌ (목표 < 1s) |
| **goti_order_creation_ms p95** | **60s** | ❌ timeout |
| goti_payment_ms p95 | 10.53s | ❌ |
| goti_seat_selection_ms p95 | 9.86s | ❌ |
| queue_pass_rate | 100% | ✅ |
| queue_enter_ms p95 | 1.87s | ✅ |
| queue_wait_duration_ms p95 | 1m38s | — |
| queue_immediate_pass_rate | 37.12% (998/2688) | — |
| queue_seat_enter_ms p95 | 2.36s | ✅ |
| queue_status_ms p95 | 73ms | ✅ |
| iteration_duration p95 | 2m48s | — |
| queue_e2e_duration_ms p95 | 2m48s | — |
| http_reqs | 90,415 (402 RPS) | — |
| data_received | 234 MB (1.0 MB/s) | — |

## 핵심 패턴
1. **대기열 통과는 100%**, 실제 결제 완료는 15.6% — 병목은 **결제 path** 에 있다
2. order create 60s timeout 다수 → 트랜잭션 내부 호출 지연 누적
3. `ORDER_SEAT_ALREADY_EXISTS` (409) 반복 — 결제 시간 초과로 hold 만료 → 좌석 탈취 race
4. `duplicate key violates unique constraint` — seat reservation 동시 insert 충돌
5. PgBouncer pool 활용율 (peak): ticketing 35/80 active + 10 waiting,
   다른 서비스는 모두 한산

## EXPLAIN 검증 (sample query)
```sql
SET search_path TO ticketing_service;
EXPLAIN (ANALYZE, BUFFERS) 
SELECT s.id, COALESCE(ss.status::text,'AVAILABLE')
FROM seats s
LEFT JOIN seat_statuses ss
  ON ss.seat_id=s.id AND ss.game_schedule_id='acfe6b0f-...'
WHERE s.section_id='b0010001-...'
LIMIT 200;
-- Execution Time: 1.022 ms (Index Scan + Nested Loop)
```
인덱스/plan 자체는 정상. 실행 시간 5~10s 는 connection wait + 가능한 cold
buffer cache + Istio sidecar 오버헤드 등 외부 요인.

## DB 통계 부재 발견
모든 hot table 의 `pg_stat_user_tables.n_live_tup = 0` (ANALYZE 미실행 흔적).
seat_statuses 는 7.5GB / 0 live tup 으로 표기됨.
→ 부하 직후 `ANALYZE` 9개 테이블 수행

## 부하 후 적용 fix
- `ANALYZE` 9 hot tables (seats, seat_statuses, seat_holds, ...)
- `TICKETING_DATABASE_MAX_CONNS 18 → 10`
- PgBouncer `goti_ticketing pool_size=100` per-db override

## 다음 부하 가설
- order create p95 < 5s, ticket_success > 60% 목표
- 여전히 낮으면 → payment 호출 / order tx 코드 path 추적 (Tempo trace)

## 관련 문서
- `docs/dev-logs/2026-04-14-pgbouncer-rollout-and-load-test.md` (트러블슈팅 체인)
- `docs/adr/0013-pgbouncer-connection-pooling.md`
