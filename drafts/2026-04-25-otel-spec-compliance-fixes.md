# 2026-04-25 OTel client instrumentation 보정 — spec 준수 + 표준 attribute

## 배경

직전 작업 [`2026-04-25-otel-client-instrumentation-complete.md`](./2026-04-25-otel-client-instrumentation-complete.md)에서
redis/http/pgxpool client OTel instrumentation을 대량 추가 (commit `Goti-go@98e8ab0`, `dff3c77`).

사용자가 "OTel-답지 못한 부분이 있는지 외부 검색 + review로 확인" 요청.
**code-reviewer agent + OTel 공식 spec WebFetch + WebSearch** 종합 검증 결과 다음 문제 발견:

| 등급 | 항목 | 영향 |
|------|------|------|
| **Critical** | 단위 `ms` (millisecond) + `time.Since(...).Milliseconds()` int64 truncation | sub-ms (수십 µs) 값이 모두 0 bucket 압축 → **p95 use_time 패널 거짓 정보** |
| Major | 표준 attribute 누락 (`server.address`, `server.port`, `db.namespace`) | multi-host/replica 추가 시 host 분리 불가 |
| Major | `measuredRow.Scan` 미호출 시 connection leak 가능성 | godoc 미명시 |
| Major | `otelpgx.RecordStats` 표준 라이브러리 미활용 (재발명) | 별도 task로 spike |
| Minor | `otelhttp` span name "HTTP GET"만 → endpoint별 분리 안됨 | dashboard 외부 호출 panel UX |
| Minor | `MeasuredPool.Pool()` 데드코드 | 호출자 0건 |
| Minor | `Querier.Begin` godoc 경고 부재 | nested savepoint 위험 |

## OTel 공식 spec 핵심 ([db semconv](https://opentelemetry.io/docs/specs/semconv/database/database-metrics/))

- **단위**: time-based metric은 `s` (seconds, Float). `ms`는 incubating 잔재
- **메트릭 이름**: stable name은 단수형 `db.client.connection.*` (현재 우리는 복수형 — Phase D 별도 검토)
- **권장 attribute**: `db.system` (=postgresql), `db.client.connection.pool.name`, 선택적으로 `server.address`/`server.port`/`db.namespace`

## Plan ([jaunty-hugging-tower.md](../../../../.claude/plans/jaunty-hugging-tower.md))

3 Phase로 분리, 1 build cycle로 통합 진행.

## Phase A — Critical: 단위 ms→s

### `pkg/database/measured_pool.go`
- `metric.WithUnit("ms")` → `"s"` (2건)
- `time.Since(...).Milliseconds()` → `.Seconds()` (8건). `int64` cast 제거 → `float64` 그대로
- 변수명 `waitMs/useMs` → `waitS/useS`
- doc comment: `_milliseconds_` → `_seconds_`

### `charts/goti-monitoring/dashboards/developer/db-health.json` + grafana sync
- `db_client_connections_{wait,use}_time_milliseconds_bucket` → `_seconds_bucket`
- panel `unit: "ms"` → `"s"` (Grafana가 적절 단위 자동 표시)

## Phase B — Major: 표준 attribute + 데드코드 제거 + godoc

### `pkg/database/measured_pool.go`
```go
cc := pool.Config().ConnConfig
attrs: metric.WithAttributes(
    attribute.String("db.client.connection.pool.name", poolName),  // pool.name → spec stable
    attribute.String("db.system", "postgresql"),
    attribute.String("server.address", cc.Host),
    attribute.Int("server.port", int(cc.Port)),
    attribute.String("db.namespace", cc.Database),
),
```
- `MeasuredPool.Pool()` 메서드 **제거** (호출자 0건, escape hatch는 instrumentation 우회 야기)
- `measuredRow` godoc: "Scan 미호출 시 connection 누수" 명시. Go finalizer는 GC 타이밍 의존이라 미사용 결정.
- `measuredTx` godoc: "Commit/Rollback 필수" + "WithTx helper 사용 권장"

### `pkg/database/otel_metrics.go`
- 동일 5개 attribute로 `poolAttrs` 확장

### `pkg/database/tx.go`
- `Querier.Begin` godoc: "외부 코드 직접 호출 금지. WithTx만 사용. pgx.Tx의 Begin은 nested savepoint."

## Phase C — Minor: otelhttp endpoint span + redis godoc

### `pkg/httpclient`, `internal/user/service/{oauth_client,sms_provider}.go`
```go
otelhttp.NewTransport(
    transport,
    otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
        return r.Method + " " + r.URL.Host + r.URL.Path
    }),
)
```
- 효과: span name이 `HTTP GET` → `GET coolsms.co.kr/messages/v4/send` 등 endpoint별 분리
- PII 안전 검증: OAuth `code`, SMS `to`/`code`는 path에 안 들어감 (POST body) — 안전

### `pkg/redis/client.go`
- godoc 추가: redisotel가 동일 메트릭 이름 export하므로 dashboard에 항상 `db_system="postgresql"|"redis"` 명시 필터 필수

## 검증 (mimir 직접 query)

```
$ count(db_client_connections_wait_time_seconds_count)
  → 7 series (모든 service)

$ db_client_connections_max{db_system="postgresql", service_name="goti-ticketing-go"}
  series labels:
    db_client_connection_pool_name = primary
    db_namespace = goti
    server_address = goti-postgres.goti.svc.cluster.local
    server_port = 5432
    db_system = postgresql

$ count(db_client_connections_wait_time_milliseconds_count)
  → 7 series (옛 stale, 곧 expire)
```

verify script:
| 항목 | 직전 | 현재 | Δ |
|------|------|------|---|
| OK | 269 | 270 | +1 |
| LABEL_MISMATCH | 95 | 94 | -1 |
| ERROR | 0 | 0 | — |

OK 카운트 변화는 작지만, **정확도 (sub-ms 해상도) 회복 + spec 준수 + 향후 multi-host 확장 시 dashboard 분리 가능**이 핵심 가치.

## 결정 보류 — 별도 task

### Phase D: 메트릭 이름 단/복수
- spec stable name은 **단수형** `db.client.connection.*`
- 현재 우리(+ redisotel ecosystem)는 복수형 `db.client.connections.*`
- 변경 시 dashboard 모든 panel 영향 + redisotel 호환성 재검증 필요
- → 별도 task로 분리 (spec ecosystem 호환성 충분히 확인 후)

### Phase E: `otelpgx.RecordStats`로 RegisterPoolMetrics 대체
- `RecordStats(pool, ...)` 표준 함수 존재 ([github.com/exaring/otelpgx](https://pkg.go.dev/github.com/exaring/otelpgx))
- 우리 ~100라인 코드 폐기 + 표준 라이브러리 자동 추적
- 검토 항목: 메트릭 이름 (단/복수), wait_time/use_time histogram 미지원이면 MeasuredPool 유지
- → spike 별도 task

## Commit

| repo | hash | 영향 |
|------|------|------|
| Goti-go | `72351ec` | 7 파일 / +89 / -43 (Phase A+B+C 통합) |
| Goti-monitoring | `04a1251` | 2 파일 (dashboard 단위 동기) |
| goti-team-controller | (이 dev-log) | — |

## 실패 유형 태그

| 항목 | 태그 |
|------|------|
| 단위 ms 사용 (incubating 잔재) | `context-missing` (spec stable 변경을 추적 못 함) |
| `Milliseconds()` int64 truncation | `wrong-layer` (Go API choice가 metric 정확도와 trade-off) |
| 표준 attribute 누락 | `dependency-unknown` (spec 권장 attribute 카탈로그 미참조) |
| `otelpgx.RecordStats` 미활용 | `wrong-layer` (custom 코드를 우선 작성) |

## 교훈

1. **OTel SDK는 incubating ↔ stable 라이프사이클 추적이 까다로움**. 새 코드 작성 시 항상 [spec 페이지](https://opentelemetry.io/docs/specs/semconv/) 직접 확인 + AI agent에게 "spec 준수 검증" 요청 패턴 정착.
2. **Histogram 단위는 항상 base unit (s for time)**. `WithUnit("ms")`는 spec 위반이면서 동시에 `Milliseconds()` API와 결합 시 정밀도 손실.
3. **표준 라이브러리 우선 (otelpgx, otelhttp 등)**. 직접 instrumentation 짜기 전에 ecosystem 표준 함수 검색.
