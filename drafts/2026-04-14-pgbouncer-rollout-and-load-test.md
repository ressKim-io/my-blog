# 2026-04-14 PgBouncer 도입 + 1차 부하테스트 (3000 VU)

## 컨텍스트
- 목표: ADR 0013 PgBouncer transaction pooling 도입 + 3000 VU 부하테스트 수행
- 게임: 2026-04-16 KIA 홈경기 (`acfe6b0f-fb0f-4c0a-8d19-9063e5025428`)
- 결과: 부하 완주, 단 ticket_success 15.6% — 후속 fix 필요

---

## 트러블슈팅 체인 (시간순)

### 1. PgBouncer ConfigMap 문법 오류
- **증상**: `unrecognized connection parameter: options` → FATAL cannot load config
- **원인**: pgbouncer 1.23 의 `[databases]` 섹션은 `options=` 키를 **지원하지 않는다**.
  공식 지원 키: `dbname, host, port, user, password, auth_user, pool_size,
  pool_mode, connect_query, client_encoding, datestyle, timezone` 등
- **Fix**: `connect_query='SET search_path TO {svc}_service'` 사용
- **부수 fix**: `server_reset_query = DISCARD ALL` 은 search_path 까지 리셋 →
  `DISCARD PLANS` 로 약화 (SimpleProtocol 사용 중이라 prepared 잔류 위험 없음)

### 2. ArgoCD sync stuck (commit 5fdf49b)
- **증상**: Git push 했는데 ArgoCD 가 옛 revision 에 멈춰있고 `Already attempted
  sync` 로그 반복. Deployment 가 OutOfSync 인데 sync task 에서 빠짐
- **원인**: `argocd-application-controller` 의 in-memory cache 가 stale
- **Fix**: `kubectl delete pod argocd-application-controller-0` 후 hard refresh
- **교훈**: repo-server 만 재시작해도 controller cache 가 따로라 안 풀린다.
  controller pod 도 같이 재시작 필요.

### 3. Pgbouncer-exporter 셋업 (3-단계)
1. **이미지 v0.10.4 존재 X** → docker hub 검색 후 v0.12.0 으로 교체
2. **DB 비번 특수문자(`|`,`%`,`^`,`#`)로 DSN URL parse 실패**
   → `postgres://goti:-bh\|\|...` parse error
   → **Fix**: `urlencode` 적용한 사본을 `/prod/pgbouncer/db-user-password-urlenc`
     SSM 파라미터로 별도 보관, ExternalSecret 가 자동 fetch
   → Terraform 도 `urlencode(var.pgbouncer_rds_password)` 로 동기화
3. **Prometheus → 9127 scrape 403 → 503 → 200 단계적 해소**
   - 처음: `excludeInboundPorts: "5432,9127"` → ambient mode prom 의 ztunnel mTLS
     vs sidecar 우회 plain 9127 충돌로 503
   - **9127 만 sidecar 통과로 변경** (mTLS 받게) → 403
   - `allow-prometheus-scrape` AuthorizationPolicy 에 9127 추가 → 200

### 4. PgBouncerCompat 코드 누락 — 4단 진화
- **증상**: `prepared statement "stmtcache_xxx" already exists / does not exist`
- **원인**: 모든 v2 서비스 `cmd/*/main.go` 가 옛 `database.NewPool` 호출.
  `NewPools(replica용)` 에만 `PgBouncerCompat` 처리 코드가 있고 `NewPool` 에는
  누락. env 는 정상 주입돼 있었음.
- **진화 1**: `NewPool` 에 `QueryExecModeSimpleProtocol` 추가
  → `[]uuid.UUID` array encode 실패 (`cannot find encode plan, OID 0`)
- **진화 2**: `Exec` 모드로 변경 → 같은 OID 0 에러 (custom type 인코딩 못함)
- **진화 3**: `DescribeExec` 모드 → `bind message supplies 1 parameters,
  but prepared statement requires 2` (sqlc generated query 와 충돌)
- **진화 4 (현재)**: PgBouncer `pool_mode = transaction → session` 으로 회귀.
  코드 변경 없이 prepared statement / array / sqlc 모두 양립.
  대신 client ↔ server conn 1:1 매핑이라 pool_size 충분히 키워야 함.
- **결정**: transaction mode + Go pgx 호환은 추후 별도 PR 로 정리

### 5. Mimir ingester OOM (이슈는 별개로 이어짐)
- ingester-0 OOMKilled (WAL replay) → ring `too many unhealthy instances`
  → Grafana query 500
- 단기 fix: memory 2Gi → 4Gi
- 근본 원인: 카디널리티 폭증 가능성 (k6 metric, envoy_*, per-pod 라벨).
  추후 `prometheus_tsdb_head_series` / `cortex_ingester_memory_series` 측정 후
  high-cardinality drop rule + active_series limit 설정 필요.

### 6. Loki 로그 미수집 — DaemonSet 부재
- **증상**: Grafana 에서 로그 안 보임. Loki labels = `service_name` 1개뿐.
- **원인**: otel-collector 3개 (back/front/s3) 모두 Deployment 모드.
  노드의 `/var/log/pods` 를 읽는 DaemonSet 이 없어서 kubelet stdout 로그가
  Loki 로 안 들어왔다.
- **Fix (배포 중)**: `otel-collector-logs` DaemonSet 추가 (presets.logsCollection
  = filelog receiver + hostPath 마운트 + RBAC), `otlphttp/loki` exporter

---

## 1차 부하테스트 결과 (3000 VU, 3분 44초)

### 핵심 지표
| 지표 | 값 | 평가 |
|---|---|---|
| queue_pass_rate | 100% | ✅ 대기열 자체는 OK |
| **ticket_success_rate** | **15.6%** | ❌ 핵심 문제 |
| order_creation p95 | 60s (timeout) | ❌ |
| payment p95 | 10.5s | 느림 |
| seat_selection p95 | 9.86s | 느림 |
| http_req_failed | 4.40% | 3980 / 90415 |

### 분석 (3가설 동시 검증)
| 가설 | 판정 | 근거 |
|---|---|---|
| A) Seat hold TTL 짧음 | ❌ 무관 | TTL 600s, 시나리오 90초라 충분 |
| B) PgBouncer pool 부족 | △ 부분 | peak 35/80 사용, waiting peak 10 (잠깐 burst) |
| C) Slow query / Order tx | ✅ **진짜 병목** | seat-grades 9건 5초+, order POST 60s timeout |

### EXPLAIN 결과 — Plan 자체는 OK
- `seat_statuses` 7.5GB 거대 테이블이지만 `idx_game_seat (game_schedule_id, seat_id)`
  + `idx_seats_section_id` 로 nested loop 1ms 완료
- 인덱스 / plan 은 정상

### 진짜 원인 — 통계 부재 + connection wait
- **모든 hot table 의 `n_live_tup = 0`** → ANALYZE 미실행
- 7.5GB seat_statuses 등 통계 없이 planner 가 다른 쿼리에서 잘못된 plan 선택 가능
- PgBouncer session 모드에서 ticketing 만 dominant pool 점유 → 일부 burst 에서 wait

### 즉시 적용한 fix
1. `ANALYZE` 9개 hot table 수행 (seats, seat_statuses, seat_holds,
   game_seat_inventories, seat_sections, seat_grades, tickets, orders, order_items)
2. `TICKETING_DATABASE_MAX_CONNS 18 → 10` (6 replica × 10 = 60 client)
3. PgBouncer `goti_ticketing pool_size=100` per-db override (다른 DB 80 유지)

### 부수 발견
- `ORDER_SEAT_ALREADY_EXISTS` (409) — 첫 사용자 결제가 60s timeout 으로 실패
  → seat hold 만료 → 다른 사용자 잡음 → 첫 사용자 재시도 시 409.
  → 결제 자체 latency 문제. 근본 fix 는 payment 호출 / order tx 단축
- `duplicate key violates unique constraint` — seat reservation race condition.
  insert 충돌 시 retry/backoff 없음

---

## 다음 부하테스트 전 체크리스트
- [x] ANALYZE 완료
- [x] ticketing MaxConns 10, pool_size 100 적용
- [ ] Redis flush (queue 잔여 키 제거) — 직전에 수행
- [ ] PgBouncer 메트릭 dashboard (Infra - PgBouncer) 실시간 관측
- [ ] order POST p95, payment p95 추이 비교

## 미해결 / 후속 작업
- PgBouncer transaction pool 모드 + Go pgx 호환 (별도 PR — 옵션: pgx custom
  type registry + DescribeExec 조합 또는 pgx 를 Exec + 명시 oid 매핑)
- pgbouncer-exporter ServiceMonitor target 자동 발견 (현재 manual ServiceMonitor)
- Mimir 카디널리티 측정 + drop rule + active_series limit
- order create / payment latency 분석 (Tempo trace 분포)
- seat reservation race 시 retry/backoff (현재 즉시 409 반환)
