# 2026-04-25 OTel client instrumentation 완성 — Redis / HTTP / pgxpool histogram

## 배경

`docs/dev-logs/2026-04-25-monitoring-pipeline-fixes.md`(P1~P5) 직후 dashboard 추가 검증 결과, **client-side OTel 계측 누락 4건** 확인:

| panel | 미계측 메트릭 | 책임 레이어 |
|-------|---------------|-------------|
| Connection Wait Time p95 | `db_client_connections_wait_time_milliseconds_bucket` | Goti-go pkg/database |
| Connection Usage Time p95 | `db_client_connections_use_time_milliseconds_bucket` | 동일 |
| Pool Saturation | `usage{state="used"} / max` (메트릭은 있으나 트래픽 적을 때 빈 series) | 동일 |
| Redis Span p95 | `span_metrics_*{span_name=~".*[Rr]edis.*"}` | Goti-go pkg/redis |
| 외부 호출 p95 | `span_metrics_*{span_kind="SPAN_KIND_CLIENT"}` (DB만 잡혀 N/A 또는 거짓 값) | Goti-go HTTP clients |

원인은 모두 같음: **dashboard PromQL은 OTel 표준 메트릭/라벨로 작성되어 있는데 SDK 측 instrumentation이 빠져있음**. dashboard는 잘못 없음.

## 작업 정리 (Option A — 점진)

### Step 1: Redis OTel instrumentation
- `Goti-go/pkg/redis/client.go` — `redisotel.InstrumentTracing(client)` + `InstrumentMetrics(client)` (Client + ClusterClient 둘 다)
- 효과: `redis.dial`, `redis.pipeline client`, `redis.cmd <CMD>` span 자동 생성 → spanmetricsconnector가 picking → `span_metrics_*` 메트릭으로 변환

### Step 2: HTTP client otelhttp wrap
- `Goti-go/pkg/httpclient/client.go` — `&http.Client{Transport: otelhttp.NewTransport(&http.Transport{...})}`
- `Goti-go/internal/user/service/oauth_client.go` — 동일
- `Goti-go/internal/user/service/sms_provider.go` — 동일 (`otelhttp.NewTransport(http.DefaultTransport)`)
- 효과: outbound HTTP에 client span 부여 (`span_kind=SPAN_KIND_CLIENT`)

### Step 3: pgxpool wait_time/use_time histogram (정공법)
- `Goti-go/pkg/database/measured_pool.go` (신규) — `MeasuredPool` 타입 정의
  - `*pgxpool.Pool`을 wrap하고 `Querier` 인터페이스 구현
  - `Exec/Query/QueryRow/Begin` 모두 직접 `Acquire` → 시간 측정 → `Release` 패턴으로 재구현
  - histogram 2종 등록: `db.client.connections.wait_time` (ms), `db.client.connections.use_time` (ms)
  - `measuredRows`, `measuredRow`, `measuredTx` wrapper로 Close/Scan/Commit/Rollback 시점에 use_time 기록
- `Goti-go/pkg/database/tx.go` — `Querier` 인터페이스에 `Begin` 추가, `WithTx(ctx, q Querier, fn)` 시그니처 변경
- 36개 repo/service/handler 파일: `db *pgxpool.Pool` → `db database.Querier` (sed 일괄)
- 7개 main.go: `db, err := database.NewPool(...)` → `rawPool, err := database.NewPool(...); db, err := database.NewMeasuredPool(rawPool, "primary")` 패턴
- `middleware.NewHealthHandler(db, ...)` → `middleware.NewHealthHandler(rawPool, ...)` (ping용은 raw 유지)
- `outbox-worker /readyz`의 `db.Ping(ctx)` → `rawPool.Ping(ctx)` (동일 이유)

영향: **Goti-go 변경 59 파일 / +264 / -204**.

## 검증 (mimir 직접 쿼리)

배포 직후 약 5분 트래픽 후:

| query | 결과 |
|-------|------|
| `count(db_client_connections_wait_time_milliseconds_count)` | 6 series (ticketing 114건/55건 등) |
| `count(db_client_connections_use_time_milliseconds_count)` | 70 series |
| `count(span_metrics_calls_total{span_name=~".*[Rr]edis.*"})` | 42 series (redis.dial, redis.pipeline client 등 7개 service) |
| `count(span_metrics_*{span_kind="SPAN_KIND_CLIENT"})` | 3555 series |

**5개 panel 모두 라이브** — Connection Wait/Usage Time p95, Pool Saturation, Redis Span p95, 외부 호출 p95.

## 핵심 설계 결정

### 왜 Querier 인터페이스 마이그레이션을 선택했나?

1. pgxpool에는 wait_time을 측정할 hook이 없음 (`BeforeAcquire`는 acquire **후** 호출). `Pool.Acquire(ctx)` 호출 자체를 wrap해야 함.
2. `Pool.Stat().AcquireDuration() / AcquireCount()` 차분 평균은 **p95를 못 만듦** (개별 sample이 없음).
3. `*pgxpool.Pool` 직접 받는 36개 repo signature를 모두 `database.Querier`로 바꾸면, MeasuredPool / pgxpool.Pool / pgx.Tx 어느 것이든 호환 가능한 추상화가 됨. 미래에 read replica 추가, query proxy 도입 시도 그대로 호환.

### MeasuredPool wrapper의 inner-loop 비용

- per-query `Acquire()` 시간 측정: `time.Now()` × 2 + histogram.Record × 2 ≈ ~수 µs
- pgx 쿼리 latency가 보통 sub-ms ~ ms 단위라 측정 overhead < 1%
- 핫 패스가 아니라면 무시 가능

## 함께 정리한 chart 버그

| 버그 | 영향 | 수정 |
|------|------|------|
| `Goti-go/pkg/redis/client.go`에서 `redisotel.InstrumentTracing/Metrics` 미적용 | Redis Span p95 N/A | 본 작업에서 수정 |
| `Goti-go/pkg/httpclient/client.go`, `oauth_client.go`, `sms_provider.go`에서 `otelhttp.NewTransport` 미적용 | 외부 호출 p95가 DB span만 잡혀서 거짓 값 | 동일 |
| `pkg/database/otel_metrics.go`에 gauge 5종만 export, histogram 2종 미구현 | Connection Wait/Usage Time p95 No data | 정공법으로 재설계 |

## 후속 발견 — db_client_connections_* 메트릭 source 충돌 (P10)

배포 직후 dashboard 검증 중 **Pool Saturation panel이 No data**로 나타나서 mimir에 직접 query.

```
db_client_connections_usage{state="used"}의 라벨 set:
  db_system: redis
  otel_scope_name: github.com/redis/go-redis/extra/redisotel
  service_name: goti-ticketing-go
  pool_name: goti-redis.goti.svc.cluster.local:6379
  state: used
  ...
```

→ **redisotel.InstrumentMetrics()도 OTel spec의 `db.client.connections.*` 메트릭을 export**한다. 우리가 만든 pgxpool gauge와 같은 메트릭 이름을 공유하면서 라벨 set이 섞여서 들어옴.

영향:
1. Pool Saturation의 `usage{state="used"} / max` division이 두 source의 series 라벨 매칭 실패로 result count = 0 → No data
2. Connection Pool 상태 패널은 timeseries라 단일 series 출력이라 OK였으나, redis pool과 pgxpool이 한 panel에 섞여서 의미 모호
3. Connection Wait/Usage Time p95는 pgxpool만 export하므로 OK (redisotel은 wait_time/use_time histogram 미export)

### 즉시 fix
1. dashboard `db-health.json`의 모든 `db_client_connections_*{...}` 쿼리에 `db_system="postgresql"` 필터 추가 (10건)
2. Pool Saturation 쿼리: `usage / max` → `sum by (service_name) (usage) / sum by (service_name) (max)` (분모/분자 라벨 명시 그룹화)
3. `Goti-go/pkg/database/otel_metrics.go` + `measured_pool.go`의 모든 record/observe 호출에 `attribute.String("db.system", "postgresql")` 추가
   - MeasuredPool에 `attrs metric.MeasurementOption` 필드로 pre-compute해서 hot path overhead 0
4. `recordWaitUse` 데드코드 제거

### 교훈
- **OTel semantic convention**의 메트릭 이름은 의도적으로 cross-language/cross-driver 표준화되어 있어, 같은 spec을 따르는 라이브러리들이 같은 메트릭에 export하는 것이 정상이다 (`db.system` 라벨로 source 구분 의도).
- dashboard 작성 시 항상 `db_system`, `messaging_system`, `rpc_system` 등 source-discriminating 라벨을 명시 필터에 포함해야 한다. 그렇지 않으면 sub-system이 추가될 때마다 silently 결과가 깨진다.

## 후속 과제

- **P6.5** (open): tempo distributor → metrics-generator forwarding — service_graph 메트릭 별개
- **P7** (open): dashboard SoT 통합 (`grafana/dashboards/` vs `charts/goti-monitoring/dashboards/`)
- LABEL_MISMATCH 134건 정리 (이전 dev-log 참조)
- 다른 dashboard에 `db.client.connections.*` 사용처가 있다면 동일하게 `db_system="postgresql"` 필터 추가 (다음 검증 시 grep)

## 실패 유형 태그

| 항목 | 태그 |
|------|------|
| dashboard 쿼리는 OTel 표준인데 SDK 미계측 | `wrong-layer` (3건 모두) |
| Querier 인터페이스 정의는 있었으나 사용 안 됨 | `context-missing` (실제 사용 패턴이 코드와 다름) |
