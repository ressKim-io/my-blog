---
title: "대시보드는 초록불인데 p95가 거짓이었다 — 단위 ms와 int64 절삭"
excerpt: "패널은 정상으로 보였지만 표시되는 p95 값 자체가 틀려 있었습니다. Milliseconds() int64 절삭으로 수십 마이크로초 단위 값이 전부 0 bucket에 압축된 것을 OTel 공식 spec과 대조해 찾아내고 단위를 교정한 기록입니다"
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

> 데이터가 끊긴 것도, 패널이 빈 것도 아니었습니다. 값은 들어오는데 그 값이 틀렸습니다. `Milliseconds()`가 int64를 돌려주는 바람에 마이크로초 단위 대기 시간이 전부 0으로 뭉개졌고, p95 패널은 그 0을 정상 응답으로 보여 주고 있었습니다

---

## 🔥 문제: 마이크로초 단위 DB 대기 시간이 전부 0으로

### 직전 작업 배경

바로 앞 작업에서 redis와 http, pgxpool 클라이언트에 OTel 계측을 대량으로 넣었습니다 (커밋 `Goti-go@98e8ab0`, `dff3c77`)

계측은 겉보기에 잘 도는 것 같았습니다. 그래도 스펙에 어긋난 부분이 있는지 외부 검토를 한 번 받아 보기로 했습니다

### 나온 문제 목록

code-reviewer agent와 OTel 공식 spec을 대조한 결과입니다

| 등급 | 항목 | 영향 |
|------|------|------|
| **Critical** | 단위 `ms` + `Milliseconds()` int64 절삭 | 수십 µs 값이 전부 0 bucket에 압축 → p95 use_time 패널이 거짓값 표시 |
| Major | 표준 attribute 누락 (`server.address`, `server.port`, `db.namespace`) | multi-host·replica 추가 시 host 구분 불가 |
| Major | `measuredRow.Scan` 미호출 시 connection 누수 가능 | godoc에 경고 없음 |
| Major | `otelpgx.RecordStats` 표준 함수 미사용 | 별도 task로 분리 |
| Minor | `otelhttp` span name이 `"HTTP GET"`뿐 | endpoint별 구분 불가 |
| Minor | `MeasuredPool.Pool()` 데드코드 | 호출자 0건 |
| Minor | `Querier.Begin` godoc 경고 부재 | nested savepoint 위험 |

가장 위 항목이 이번 글의 핵심입니다. 나머지는 불편함이지만 이건 **틀린 숫자를 보여 주고 있던** 문제입니다

---

## 🤔 원인: spec에서 시간 메트릭 단위는 초(float64)

### OTel 공식 spec

[OTel Database Semconv](https://opentelemetry.io/docs/specs/semconv/database/database-metrics/)는 이렇게 정합니다

- **단위**: 시간 기반 메트릭은 `s`(초, **float64**). `ms`는 incubating 시절 잔재
- **메트릭 이름**: stable name은 단수형 `db.client.connection.*`
- **권장 attribute**: `db.system`, `db.client.connection.pool.name`, 선택적으로 `server.address`·`server.port`·`db.namespace`

### int64 절삭이 만든 거짓 p95

Go의 `time.Duration.Milliseconds()`는 `int64`를 돌려줍니다

DB 커넥션의 wait·use time은 대개 수십 마이크로초입니다. 이걸 `Milliseconds()`로 바꾸면 그냥 `0`이 됩니다

```go
// Before — int64 절삭 발생
waitMs := time.Since(start).Milliseconds()  // µs 단위 대기 → 0
metric.WithUnit("ms")
```

histogram의 모든 값이 0 bucket에 쌓이니 p95 패널은 `0ms`를 띄웁니다

여기가 이 문제의 고약한 점입니다. 패널이 비어 있으면 누구나 이상하다고 여기지만, `0ms`는 **아주 빠른 정상 상태처럼 보입니다**. 측정이 안 되고 있다는 사실을 숫자만 봐서는 알 수 없습니다

`Seconds()`를 써서 `float64`를 유지하면 해결됩니다

```go
// After — float64, sub-ms 정밀도 유지
waitS := time.Since(start).Seconds()  // µs → 0.000023 등 float64 유지
metric.WithUnit("s")
```

---

## ✅ 해결: Phase A / B / C 일괄 적용

세 단계로 나눠 한 번의 빌드 주기 안에서 처리했습니다

### Phase A — Critical: 단위 ms→s

`pkg/database/measured_pool.go`에서 이렇게 고쳤습니다

- `metric.WithUnit("ms")` → `"s"` (2건)
- `time.Since(...).Milliseconds()` → `.Seconds()` (8건). `int64` 캐스팅을 없애고 `float64`를 그대로 둡니다
- 변수명 `waitMs`·`useMs` → `waitS`·`useS`
- doc comment의 `_milliseconds_` → `_seconds_`

Grafana 쪽도 같이 맞췄습니다. `charts/goti-monitoring/dashboards/developer/db-health.json`에서 `db_client_connections_wait_time_milliseconds_bucket`을 `_seconds_bucket`으로 바꾸고, panel의 `unit`도 `"ms"`에서 `"s"`로 옮겼습니다. 단위를 `s`로 두면 Grafana가 크기에 맞춰 알아서 표시해 줍니다

### Phase B — Major: 표준 attribute 보강 + 데드코드 제거

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

`MeasuredPool.Pool()`은 지웠습니다. 호출자가 하나도 없는 데드코드였고, 남겨 두면 계측을 우회하는 통로가 될 수 있었습니다

`measuredRow` godoc에는 Scan을 부르지 않으면 connection이 샐 수 있다는 경고를 넣었습니다. Go finalizer는 GC 타이밍에 기대야 해서 쓰지 않기로 했습니다

`measuredTx` godoc에는 Commit이나 Rollback이 필수이고 `WithTx` helper를 쓰는 편이 낫다는 안내를 넣었습니다

`pkg/database/otel_metrics.go`의 `poolAttrs`도 같은 5개 attribute로 넓혔고, `pkg/database/tx.go`의 `Querier.Begin` godoc에는 외부에서 직접 부르지 말고 `WithTx`만 쓰라는 문구를 명시했습니다. pgx.Tx의 Begin은 nested savepoint를 만들기 때문입니다

### Phase C — Minor: otelhttp endpoint span + redis godoc

`pkg/httpclient`와 관련 서비스에 span name formatter를 붙였습니다

```go
otelhttp.NewTransport(
    transport,
    otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
        return r.Method + " " + r.URL.Host + r.URL.Path
    }),
)
```

span name이 `HTTP GET` 하나로 뭉쳐 있던 것이 `GET coolsms.co.kr/messages/v4/send`처럼 endpoint별로 갈라집니다

PII가 새지 않는지도 확인했습니다. OAuth의 `code`와 SMS의 `to`·`code`는 path가 아니라 POST body에 담기므로 span name에 드러나지 않습니다

`pkg/redis/client.go`에는 godoc을 하나 추가했습니다. redisotel이 같은 이름의 메트릭을 내보내기 때문에, 대시보드에서 `db_system="postgresql"|"redis"` 필터를 항상 명시해야 한다는 내용입니다

---

## 검증 결과

Mimir에 직접 쿼리해서 교정된 메트릭을 확인했습니다

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

옛 `_milliseconds_*` 시리즈가 7건 남아 있지만 retention이 지나면 알아서 사라집니다

검증 스크립트 결과는 이렇게 움직였습니다

| 항목 | 직전 | 현재 | 변화 |
|------|------|------|------|
| OK | 269 | 270 | +1 |
| LABEL_MISMATCH | 95 | 94 | -1 |
| ERROR | 0 | 0 | — |

숫자만 보면 초라합니다. 그런데 이번 작업의 값어치는 통과 건수가 아니라 **원래 통과로 잡히던 패널의 값이 이제 맞다**는 데 있습니다

검증기는 쿼리가 데이터를 돌려주는지만 봅니다. 돌아온 값이 진짜인지는 보지 않습니다. 이번 문제가 정확히 그 사각지대에 있었습니다

### 보류한 항목

**Phase D (메트릭 이름 단수·복수)**: spec의 stable name은 단수형 `db.client.connection.*`인데, 현재 구현과 redisotel 생태계는 복수형 `db.client.connections.*`을 씁니다. 바꾸면 대시보드 전 패널이 영향을 받고 redisotel 호환성도 다시 봐야 해서 별도 task로 뺐습니다

**Phase E (`otelpgx.RecordStats` 도입)**: 표준 함수로 지금의 커스텀 코드 약 100줄을 대체할 수 있습니다. 다만 wait_time과 use_time histogram을 지원하는지 먼저 확인해야 해서 따로 잡았습니다

---

## 커밋 요약

| 저장소 | 해시 | 변경 |
|--------|------|------|
| Goti-go | `72351ec` | 7 파일 / +89 / -43 (Phase A+B+C 통합) |
| Goti-monitoring | `04a1251` | 2 파일 (dashboard 단위 동기화) |

---

## 📚 배운 점

**1. 시간 메트릭 단위는 언제나 base unit으로**

`WithUnit("ms")`는 spec 위반인 동시에 `Milliseconds()` API와 만나면 정밀도를 잃습니다. 시간 메트릭은 `s`와 `Seconds()` float64 조합으로 고정합니다

이 유형이 위험한 이유는 결과가 `0`으로 나온다는 데 있습니다. 비어 있는 게 아니라 아주 빠른 것처럼 보이니 아무도 의심하지 않습니다

**2. incubating과 stable 사이를 계속 추적한다**

OTel spec은 experimental에서 incubating을 거쳐 stable로 갑니다. incubating 문서를 보고 쓴 코드는 stable로 넘어갈 때 단위나 이름이 바뀔 수 있습니다

새 계측을 넣을 때는 [semconv spec 페이지](https://opentelemetry.io/docs/specs/semconv/)를 직접 확인하고, spec 준수 검토를 절차로 만들어 두는 편이 낫습니다

**3. 표준 라이브러리를 먼저 뒤진다**

계측 코드를 직접 쓰기 전에 `otelpgx`나 `otelhttp` 같은 생태계 표준 함수가 있는지 먼저 봅니다. 직접 만들면 spec이 바뀔 때 그 변화를 놓치기 쉽습니다

**4. 실패 유형으로 정리하면**

| 항목 | 유형 | 설명 |
|------|------|------|
| 단위 ms 사용 | context-missing | spec stable 변경을 추적하지 못함 |
| `Milliseconds()` int64 절삭 | wrong-layer | Go API 선택이 메트릭 정확도와 맞바꿔짐 |
| 표준 attribute 누락 | dependency-unknown | spec 권장 attribute 목록을 참조하지 않음 |
| `otelpgx.RecordStats` 미사용 | wrong-layer | 표준 함수를 찾기 전에 커스텀 코드를 먼저 씀 |
