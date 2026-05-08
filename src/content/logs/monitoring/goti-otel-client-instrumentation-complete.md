---
title: "OTel client 계측 갭 메우기 — Redis / HTTP / pgxpool histogram"
excerpt: "dashboard PromQL은 OTel 표준으로 작성됐는데 SDK instrumentation이 빠져 있어 panel이 비어 있던 4건. Redis InstrumentMetrics + otelhttp + MeasuredPool wrapper 도입으로 5개 panel 전부 라이브"
type: troubleshooting
category: monitoring
tags:
  - go-ti
  - OpenTelemetry
  - Go
  - Redis
  - pgxpool
  - histogram
  - troubleshooting
series:
  name: "goti-otel-instrumentation"
  order: 2
date: "2026-04-25"
---

## 한 줄 요약

> monitoring pipeline fixes(P1~P5) 완료 직후 dashboard 추가 검증에서 client-side OTel 계측 누락 4건을 발견했습니다. Redis InstrumentMetrics, otelhttp transport wrap, pgxpool MeasuredPool wrapper를 순차 도입해 5개 panel을 모두 라이브 상태로 만들었습니다

---

## 🔥 문제: dashboard panel 4건 데이터 없음

### 발견 경위

monitoring pipeline P1~P5 수정 직후 dashboard를 추가 검증하던 중, 아래 5개 panel이 No Data 또는 거짓 값을 반환하고 있음을 확인했습니다.

| panel | 미계측 메트릭 | 책임 레이어 |
|-------|---------------|-------------|
| Connection Wait Time p95 | `db_client_connections_wait_time_milliseconds_bucket` | pkg/database |
| Connection Usage Time p95 | `db_client_connections_use_time_milliseconds_bucket` | 동일 |
| Pool Saturation | `usage{state="used"} / max` (트래픽 적을 때 빈 series) | 동일 |
| Redis Span p95 | `span_metrics_*{span_name=~".*[Rr]edis.*"}` | pkg/redis |
| 외부 호출 p95 | `span_metrics_*{span_kind="SPAN_KIND_CLIENT"}` (DB span만 잡혀 거짓 값) | HTTP clients |

---

## 🤔 원인: dashboard는 정상, SDK 계측이 누락

세 건 모두 **원인이 동일**했습니다.

dashboard의 PromQL은 OTel semantic convention 표준 메트릭과 라벨로 작성되어 있었습니다. 그런데 Go SDK 측에서 해당 메트릭을 export하는 instrumentation 코드가 아예 없었습니다.

dashboard가 잘못된 것이 아닙니다. SDK 쪽이 채워져 있지 않아서 메트릭 자체가 존재하지 않았던 것입니다.

각 누락 항목의 root cause를 정리하면 다음과 같습니다.

| 항목 | root cause |
|------|-----------|
| Redis Span p95 | `redisotel.InstrumentTracing` / `InstrumentMetrics` 미호출 |
| 외부 호출 p95 | HTTP client transport에 `otelhttp.NewTransport` 미적용 |
| Connection Wait/Usage Time p95 | `pkg/database/otel_metrics.go`에 gauge 5종만 export, histogram 2종 미구현 |

---

## ✅ 해결: 3단계 점진적 계측 추가

### Step 1 — Redis OTel instrumentation

`pkg/redis/client.go`에서 Redis 클라이언트 생성 직후 아래 두 함수를 호출했습니다.

```go
// Client와 ClusterClient 둘 다 적용
if err := redisotel.InstrumentTracing(client); err != nil {
    return nil, err
}
if err := redisotel.InstrumentMetrics(client); err != nil {
    return nil, err
}
```

이렇게 하면 `redis.dial`, `redis.pipeline client`, `redis.cmd <CMD>` 형태의 span이 자동 생성됩니다. spanmetricsconnector가 이 span을 수집해 `span_metrics_*` 메트릭으로 변환하므로, Redis Span p95 panel이 활성화됩니다.

### Step 2 — HTTP client otelhttp transport wrap

outbound HTTP 호출에 client span을 부여하려면, `http.Client`의 transport를 `otelhttp.NewTransport`로 감싸야 합니다.

```go
// pkg/httpclient/client.go
client := &http.Client{
    Transport: otelhttp.NewTransport(&http.Transport{
        // 기존 transport 설정 그대로
    }),
}
```

같은 패턴을 아래 파일에도 동일하게 적용했습니다.

- `internal/user/service/oauth_client.go`
- `internal/user/service/sms_provider.go` — `otelhttp.NewTransport(http.DefaultTransport)`

이로써 `span_kind=SPAN_KIND_CLIENT` span이 DB 외의 외부 HTTP 호출에도 생성되어, 외부 호출 p95 panel이 올바른 값을 반환하게 됩니다.

### Step 3 — pgxpool wait_time / use_time histogram (MeasuredPool)

Connection Wait Time과 Usage Time p95는 pgxpool에서 직접 hook을 제공하지 않아 단순 instrumentation으로는 해결이 불가능했습니다.

**왜 기존 방식으로는 안 되는가**를 먼저 살펴보겠습니다.

pgxpool의 `BeforeAcquire` callback은 실제로는 acquire **후**에 호출됩니다. 즉, 커넥션 대기 시간을 측정할 수 있는 지점이 없습니다. `Pool.Stat().AcquireDuration() / AcquireCount()`로 차분 평균을 구하는 방법도 있지만, 이는 평균값만 구할 수 있어 p95 histogram을 만들 수 없습니다.

**해결책은 `Pool.Acquire(ctx)` 호출 자체를 wrap하는 것**입니다.

`pkg/database/measured_pool.go`를 신규 파일로 작성해 `MeasuredPool` 타입을 정의했습니다.

```go
// pkg/database/measured_pool.go (신규)
type MeasuredPool struct {
    pool     *pgxpool.Pool
    attrs    metric.MeasurementOption  // pre-compute로 hot path overhead 최소화
    waitHist metric.Float64Histogram
    useHist  metric.Float64Histogram
}

// Querier 인터페이스 구현 — Exec/Query/QueryRow/Begin 모두
func (m *MeasuredPool) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
    start := time.Now()
    conn, err := m.pool.Acquire(ctx)
    waitMs := float64(time.Since(start).Microseconds()) / 1000.0
    m.waitHist.Record(ctx, waitMs, m.attrs)  // wait_time 기록

    if err != nil {
        return nil, err
    }
    // measuredRows wrapper로 Close 시점에 use_time 기록
    return newMeasuredRows(conn, m.useHist, m.attrs), nil
}
```

histogram 2종을 등록했습니다.

- `db.client.connections.wait_time` (ms) — `Acquire()` 호출부터 커넥션 확보까지
- `db.client.connections.use_time` (ms) — 커넥션 확보부터 반환(`Release`)까지

`measuredRows`, `measuredRow`, `measuredTx` wrapper를 추가해 각각 `Close`, `Scan`, `Commit`, `Rollback` 시점에 use_time을 기록합니다.

**영향 범위**: Goti-go 변경 59 파일 / +264 / -204

주요 변경 내용은 다음과 같습니다.

1. `pkg/database/tx.go` — `Querier` 인터페이스에 `Begin` 추가, `WithTx(ctx, q Querier, fn)` 시그니처 변경
2. 36개 repo/service/handler 파일 — `db *pgxpool.Pool` → `db database.Querier` (일괄 변경)
3. 7개 main.go — raw pool 생성 후 MeasuredPool로 감싸는 패턴으로 변경

```go
// main.go 변경 패턴
rawPool, err := database.NewPool(ctx, cfg.DatabaseURL)
if err != nil {
    log.Fatal(err)
}
db, err := database.NewMeasuredPool(rawPool, "primary")
if err != nil {
    log.Fatal(err)
}

// health check용은 raw pool 유지 (Ping이 필요)
middleware.NewHealthHandler(rawPool, ...)
```

**MeasuredPool의 성능 overhead** — per-query `Acquire()` 시간 측정은 `time.Now() × 2` + `histogram.Record() × 2` 수준으로 약 수 µs입니다. pgx 쿼리 latency가 보통 sub-ms ~ ms 단위이므로 측정 overhead는 1% 미만입니다.

### 검증 (Mimir 직접 쿼리)

배포 직후 약 5분 트래픽 후 Mimir에 직접 쿼리해 확인했습니다.

| 쿼리 | 결과 |
|------|------|
| `count(db_client_connections_wait_time_milliseconds_count)` | 6 series (ticketing 114건/55건 등) |
| `count(db_client_connections_use_time_milliseconds_count)` | 70 series |
| `count(span_metrics_calls_total{span_name=~".*[Rr]edis.*"})` | 42 series (redis.dial, redis.pipeline client 등 7개 service) |
| `count(span_metrics_*{span_kind="SPAN_KIND_CLIENT"})` | 3555 series |

5개 panel 모두 라이브 상태로 전환되었습니다.

---

## 후속 발견 — db_client_connections_* 메트릭 source 충돌

배포 직후 dashboard 검증 중 **Pool Saturation panel이 No Data**로 나타났습니다. Mimir에 직접 쿼리해보니 예상치 못한 상황을 발견했습니다.

```text
db_client_connections_usage{state="used"}의 라벨 set:
  db_system: redis
  otel_scope_name: github.com/redis/go-redis/extra/redisotel
  service_name: goti-ticketing-go
  pool_name: goti-redis.goti.svc.cluster.local:6379
  state: used
```

`redisotel.InstrumentMetrics()`도 OTel spec의 `db.client.connections.*` 메트릭을 export합니다. MeasuredPool이 export하는 메트릭과 이름이 같아서, 라벨 set이 서로 다른 두 source의 series가 섞여 들어왔습니다.

영향은 세 가지였습니다.

1. Pool Saturation의 `usage{state="used"} / max` division — 두 source의 series 라벨 매칭이 실패해 result count = 0 → No data
2. Connection Pool 상태 패널 — redis pool과 pgxpool이 한 panel에 섞여 의미 모호
3. Connection Wait/Usage Time p95 — pgxpool만 export하므로 영향 없음

### 즉시 수정

네 가지를 함께 수정했습니다.

1. `db-health.json`의 모든 `db_client_connections_*{...}` 쿼리에 `db_system="postgresql"` 필터 추가 (10건)
2. Pool Saturation 쿼리를 명시적 그룹화로 변경

```promql
# 수정 전
usage{state="used"} / max

# 수정 후 — 분모/분자 라벨 명시 그룹화
sum by (service_name) (db_client_connections_usage{state="used", db_system="postgresql"})
/ sum by (service_name) (db_client_connections_max{db_system="postgresql"})
```

3. `pkg/database/otel_metrics.go`와 `measured_pool.go`의 모든 record/observe 호출에 `attribute.String("db.system", "postgresql")` 추가 — `MeasuredPool`에 `attrs metric.MeasurementOption` 필드로 pre-compute해 hot path overhead 0
4. `recordWaitUse` 데드코드 제거

---

## 📚 배운 점

- **계층 책임 확인이 먼저입니다** — dashboard가 No Data를 보여줄 때 쿼리 문법보다 SDK 계측 여부를 먼저 점검해야 합니다. dashboard PromQL이 표준 spec을 따른다면 SDK 누락일 가능성이 높습니다

- **pgxpool wait_time은 wrap이 유일한 방법입니다** — `BeforeAcquire`는 acquire 후에 호출되고, `Stat()`은 평균만 제공합니다. p95 histogram이 필요하다면 `Acquire()` 호출 자체를 감싸는 `MeasuredPool` 패턴이 정공법입니다

- **Querier 인터페이스 추상화는 미래 확장에도 유리합니다** — 36개 파일을 `database.Querier`로 교체하고 나면 read replica 추가, query proxy 도입, 테스트용 mock 구현 등을 동일 인터페이스로 호환할 수 있습니다

- **OTel semantic convention 메트릭 이름은 cross-library 표준입니다** — 같은 spec을 따르는 라이브러리들이 동일한 메트릭 이름에 export하는 것이 의도된 설계입니다. `db.system`, `messaging_system`, `rpc_system` 같은 source-discriminating 라벨을 dashboard 쿼리에 항상 명시해야 합니다. 그렇지 않으면 sub-system이 추가될 때마다 결과가 조용히 깨집니다

- **배포 직후 Mimir 직접 쿼리로 검증하는 습관이 필요합니다** — Grafana panel이 No Data여도 Mimir에 series가 실제로 들어오고 있는지 확인하면 dashboard 버그와 계측 누락을 빠르게 구분할 수 있습니다
