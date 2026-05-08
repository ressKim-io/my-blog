---
title: "OTel spec 준수 보정 — 단위 ms→s + 표준 attribute 보강"
excerpt: "계측 완료 직후 외부 검증에서 발견된 Critical: Milliseconds() int64 truncation으로 sub-ms 값이 모두 0 bucket에 압축. 단위를 s로 교정하고 server.address/db.namespace 표준 attribute를 일괄 보강했습니다"
type: troubleshooting
category: monitoring
tags:
  - go-ti
  - OpenTelemetry
  - OTel spec
  - histogram
  - code review
  - troubleshooting
series:
  name: "goti-otel-instrumentation"
  order: 3
date: "2026-04-25"
---

## 한 줄 요약

> redis/http/pgxpool OTel 계측 완료 직후 외부 검증(code-reviewer agent + OTel 공식 spec)을 통해 `Milliseconds()` int64 truncation이 p95 패널 값을 거짓으로 만들고 있음을 발견했습니다. 단위를 `ms`→`s`로 교정하고, 표준 attribute를 일괄 보강했습니다

---

## 🔥 문제: sub-ms DB 대기 시간이 모두 0으로 압축

### 직전 작업 배경

직전 작업에서 redis/http/pgxpool 클라이언트에 OTel 계측을 대량 추가했습니다 (커밋 `Goti-go@98e8ab0`, `dff3c77`).

계측 자체는 정상 동작하는 것으로 보였습니다. 그러나 팀 내에서 "OTel 스펙에 맞지 않는 부분이 있는지 외부 검토로 확인"을 요청했습니다.

### 발견된 문제 목록

code-reviewer agent와 OTel 공식 spec WebFetch/WebSearch를 종합한 결과 다음 항목이 식별됐습니다.

| 등급 | 항목 | 영향 |
|------|------|------|
| **Critical** | 단위 `ms` + `Milliseconds()` int64 truncation | sub-ms (수십 µs) 값이 모두 0 bucket 압축 → p95 use_time 패널 거짓 정보 |
| Major | 표준 attribute 누락 (`server.address`, `server.port`, `db.namespace`) | multi-host/replica 추가 시 host 분리 불가 |
| Major | `measuredRow.Scan` 미호출 시 connection leak 가능성 | godoc 미명시 |
| Major | `otelpgx.RecordStats` 표준 라이브러리 미활용 | 별도 task로 spike 예정 |
| Minor | `otelhttp` span name `"HTTP GET"`만 → endpoint별 분리 안됨 | 외부 호출 dashboard panel UX |
| Minor | `MeasuredPool.Pool()` 데드코드 | 호출자 0건 |
| Minor | `Querier.Begin` godoc 경고 부재 | nested savepoint 위험 |

---

## 🤔 원인: OTel spec에서 time metric 단위는 s(float64)

### OTel 공식 spec 핵심

[OTel Database Semconv](https://opentelemetry.io/docs/specs/semconv/database/database-metrics/)에 따르면:

- **단위**: time-based metric은 `s` (seconds, **float64**). `ms`는 incubating 잔재
- **메트릭 이름**: stable name은 단수형 `db.client.connection.*`
- **권장 attribute**: `db.system`, `db.client.connection.pool.name`, 선택적으로 `server.address`/`server.port`/`db.namespace`

### Critical 상세: `Milliseconds()` int64 truncation

Go의 `time.Duration.Milliseconds()`는 `int64`를 반환합니다.

DB 커넥션 wait/use time은 대부분 수십 microsecond 수준입니다. 이를 `Milliseconds()`로 변환하면 `0`이 됩니다.

```go
// Before — int64 truncation 발생
waitMs := time.Since(start).Milliseconds()  // µs 단위 대기 → 0
metric.WithUnit("ms")
```

OTel histogram bucket에서 0 bucket에 모든 값이 쌓이므로, p95 패널은 `0ms`를 정상 응답으로 표시합니다. **실제 대기 시간이 측정되지 않는 상태**였습니다.

올바른 접근은 `Seconds()`를 사용해 `float64`로 유지하는 것입니다.

```go
// After — float64, sub-ms 정밀도 유지
waitS := time.Since(start).Seconds()  // µs → 0.000023 등 float64 유지
metric.WithUnit("s")
```

---

## ✅ 해결: Phase A / B / C 3단계 일괄 적용

3개 Phase로 분리해 1 build cycle 내에서 통합 진행했습니다.

### Phase A — Critical: 단위 ms→s

#### `pkg/database/measured_pool.go`

- `metric.WithUnit("ms")` → `"s"` (2건)
- `time.Since(...).Milliseconds()` → `.Seconds()` (8건). `int64` cast 제거, `float64` 그대로 유지
- 변수명 `waitMs`/`useMs` → `waitS`/`useS`
- doc comment: `_milliseconds_` → `_seconds_`

#### Grafana 대시보드 + Mimir 동기화

`charts/goti-monitoring/dashboards/developer/db-health.json` 수정:

- `db_client_connections_wait_time_milliseconds_bucket` → `_seconds_bucket`
- panel `unit: "ms"` → `"s"` (Grafana가 적절 단위 자동 표시)

### Phase B — Major: 표준 attribute 보강 + 데드코드 제거

#### `pkg/database/measured_pool.go`

```go
cc := pool.Config().ConnConfig
attrs: metric.WithAttributes(
    // spec stable attribute 보강
    attribute.String("db.client.connection.pool.name", poolName),
    attribute.String("db.system", "postgresql"),
    attribute.String("server.address", cc.Host),
    attribute.Int("server.port", int(cc.Port)),
    attribute.String("db.namespace", cc.Database),
),
```

`MeasuredPool.Pool()` 메서드를 제거했습니다. 호출자가 0건인 데드코드였고, instrumentation 우회 경로가 될 위험이 있었습니다.

`measuredRow` godoc에 "Scan 미호출 시 connection 누수" 경고를 명시했습니다. Go finalizer는 GC 타이밍에 의존하므로 미사용 결정.

`measuredTx` godoc에 "Commit/Rollback 필수" + "WithTx helper 사용 권장"을 추가했습니다.

#### `pkg/database/otel_metrics.go`

동일 5개 attribute로 `poolAttrs`를 확장했습니다.

#### `pkg/database/tx.go`

`Querier.Begin` godoc에 "외부 코드 직접 호출 금지. WithTx만 사용. pgx.Tx의 Begin은 nested savepoint"를 명시했습니다.

### Phase C — Minor: otelhttp endpoint span + redis godoc

`pkg/httpclient` 및 관련 서비스 파일에 span name formatter를 적용했습니다.

```go
otelhttp.NewTransport(
    transport,
    otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
        return r.Method + " " + r.URL.Host + r.URL.Path
    }),
)
```

적용 효과: span name이 `HTTP GET` → `GET coolsms.co.kr/messages/v4/send` 처럼 endpoint별로 분리됩니다.

PII 안전성을 검증했습니다. OAuth `code`, SMS `to`/`code`는 path가 아닌 POST body에 담기므로 span name에 노출되지 않습니다.

`pkg/redis/client.go`에 godoc을 추가했습니다. redisotel이 동일 메트릭 이름을 export하므로 dashboard에서 항상 `db_system="postgresql"|"redis"` 명시 필터가 필수라는 내용입니다.

---

## 검증 결과

Mimir에 직접 쿼리해 교정된 메트릭을 확인했습니다.

```text
$ count(db_client_connections_wait_time_seconds_count)
  → 7 series (모든 service)

$ db_client_connections_max{db_system="postgresql", service_name="goti-ticketing-go"}
  labels:
    db_client_connection_pool_name = primary
    db_namespace                   = goti
    server_address                 = goti-postgres.goti.svc.cluster.local
    server_port                    = 5432
    db_system                      = postgresql

$ count(db_client_connections_wait_time_milliseconds_count)
  → 7 series (구 stale, 곧 expire 예정)
```

구 `_milliseconds_*` 시리즈가 7건 남아있으나 retention 이후 자동 소멸됩니다.

테스트 결과 변화:

| 항목 | 직전 | 현재 | 변화 |
|------|------|------|------|
| OK | 269 | 270 | +1 |
| LABEL_MISMATCH | 95 | 94 | -1 |
| ERROR | 0 | 0 | — |

OK 카운트 변화는 작지만, 핵심 가치는 **sub-ms 해상도 회복 + spec 준수 + 향후 multi-host 확장 시 dashboard host별 분리 가능**입니다.

### 결정 보류 — Phase D / E

**Phase D (메트릭 이름 단/복수)**: OTel spec stable name은 단수형 `db.client.connection.*`이지만 현재 구현 및 redisotel 생태계는 복수형 `db.client.connections.*`을 사용합니다. 변경 시 dashboard 전 panel 영향 및 redisotel 호환성 재검증이 필요해 별도 task로 분리했습니다.

**Phase E (`otelpgx.RecordStats` 도입)**: `RecordStats(pool, ...)` 표준 함수로 현재 약 100줄의 커스텀 코드를 대체할 수 있습니다. 단, wait_time/use_time histogram 지원 여부를 먼저 확인해야 합니다. spike 별도 task로 분리했습니다.

---

## 커밋 요약

| 저장소 | 해시 | 변경 |
|--------|------|------|
| Goti-go | `72351ec` | 7 파일 / +89 / -43 (Phase A+B+C 통합) |
| Goti-monitoring | `04a1251` | 2 파일 (dashboard 단위 동기화) |

---

## 📚 배운 점

**1. Histogram 단위는 항상 base unit**

`WithUnit("ms")`는 spec 위반이면서 동시에 `Milliseconds()` API와 결합 시 정밀도를 손실시킵니다. time metric은 항상 `s` + `Seconds()` float64 조합을 씁니다.

정밀도 문제는 대부분 값이 `0`으로 보여 바로 눈에 띄지 않습니다. 정상처럼 보이는 `0ms` 값이 실은 측정 자체가 안 되고 있는 상태일 수 있습니다.

**2. OTel SDK incubating ↔ stable 라이프사이클 추적**

OTel spec은 `experimental` → `incubating` → `stable` 단계를 거칩니다. incubating 단계 문서를 참조해 작성한 코드는 stable 전환 시 단위/이름이 바뀔 수 있습니다. 새 계측 코드 작성 시 [OTel semconv spec 페이지](https://opentelemetry.io/docs/specs/semconv/)를 직접 확인하고, "spec 준수 검증" 검토를 패턴화하는 것이 필요합니다.

**3. 표준 라이브러리 우선 탐색**

직접 instrumentation 코드를 작성하기 전에 생태계 표준 함수(`otelpgx`, `otelhttp` 등)를 먼저 탐색합니다. 재발명은 spec 변경을 놓칠 위험을 높입니다.

**4. 실패 패턴 분류**

이번 이슈를 실패 유형으로 정리하면 다음과 같습니다.

| 항목 | 유형 | 설명 |
|------|------|------|
| 단위 ms 사용 | context-missing | spec stable 변경을 추적하지 못함 |
| `Milliseconds()` int64 truncation | wrong-layer | Go API 선택이 metric 정확도와 trade-off |
| 표준 attribute 누락 | dependency-unknown | spec 권장 attribute 카탈로그 미참조 |
| `otelpgx.RecordStats` 미활용 | wrong-layer | 표준 라이브러리 탐색 전 커스텀 코드 우선 작성 |
