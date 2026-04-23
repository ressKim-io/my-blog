---
title: "Error Tracking 대시보드 — 파싱 에러 3건 수정 후에도 전 패널 No data였던 이유"
excerpt: "신규 Error Tracking 대시보드를 올리자 LogQL/TraceQL 파싱 에러 3건이 먼저 터졌고, 쿼리를 고치고 나서야 진짜 문제인 native OTLP에서 `| json`이 plain text 로그를 전량 drop하는 상황이 드러났습니다. 같은 날 두 차례에 걸쳐 6개 문제를 순차적으로 해결한 기록입니다."
category: monitoring
tags:
  - go-ti
  - Observability
  - LogQL
  - TraceQL
  - Loki
  - Tempo
  - Grafana
series:
  name: "goti-observability-ops"
  order: 10
date: "2026-03-23"
---

## 한 줄 요약

> 신규 Error Tracking 대시보드에서 같은 날 두 차례 문제가 터졌습니다. 1차로 LogQL `count_over_time` 그루핑 파싱 + Loki empty-compatible matcher 거절 + Tempo `traceqlSearch` 400 에러 3건을 잡고 나자, 패널은 로드되지만 **전 패널 No data**로 바뀌었습니다. 2차 원인은 native OTLP에서 `| json`이 plain text 로그를 전량 drop한 것, 애초에 존재하지 않는 `error_class` 필드를 참조한 것, 그리고 `traceqlSearch` queryType 자체가 Grafana 12.x에서 무효한 것이었습니다.

## Impact

- **영향 범위**: Grafana `goti-error-tracking` 대시보드 전체 (Loki 4개 + Tempo 2개 패널)
- **증상 1 (파싱·400 에러)**: 로드 시 3개 패널에서 연달아 에러
- **증상 2 (No data)**: 1차 수정 후 전 패널이 비어있음, 같은 환경 log-explorer는 정상
- **환경**: Kind dev 클러스터, Loki native OTLP 모드
- **발생일**: 2026-03-23

---

## 🔥 1차 문제 — 로드 시 파싱·400 에러 3건

### 기존 아키텍처 / 기대 동작

Goti 관측성 스택에 Error Tracking & Investigation 대시보드(`error-tracking.json`)를 신규 추가했습니다. 세 가지를 한 화면에서 보여주는 용도입니다.

- 서비스별 에러 레벨 로그 Top-K (Loki)
- 에러 클래스별 최근 로그 건수 (Loki)
- 최근 에러 트레이스 목록 (Tempo)

기존 대시보드(`distributed-tracing.json`, `api-red-metrics.json`)와 동일 데이터소스라 큰 이슈 없이 렌더링될 것으로 예상했습니다.

### 발견한 에러 3건

대시보드를 올리자 세 개의 패널에서 연달아 에러가 떴습니다.

**에러 1 — LogQL `count_over_time` 그루핑 파싱 에러**

```logql
topk(5, count_over_time({service_name=~"$svc"} | detected_level="ERROR" | json [$__auto]) by (error_class))
```

```text
parse error : grouping not allowed for count_over_time aggregation
```

**에러 2 — Loki empty-compatible matcher 거절**

```logql
topk(1, count_over_time({service_name=~"$svc"} | detected_level="ERROR" | json | error_class != "" [$__auto]))
```

```text
parse error : queries require at least one regexp or equality matcher that does not have an empty-compatible value.
For instance, app=~".*" does not meet this requirement, but app=~".+" will
```

**에러 3 — Tempo `traceqlSearch` 400 Bad Request**

```text
최근 에러 트레이스 패널 — status: 400 Bad Request
```

---

## 🤔 1차 원인 — LogQL 문법 오해 + Loki 매처 규칙 + Tempo queryType 구조

### 원인 1 — LogQL `count_over_time`은 `by` 그루핑을 지원하지 않음

PromQL에서는 `count_over_time(metric[5m])` 뒤에 `by (label)`을 붙여도 문제없지만, LogQL의 `count_over_time`은 unwrap 없는 range aggregation이라 쿼리 내부에서 라벨 그루핑을 받지 않습니다. 라벨별 집계가 필요하면 바깥쪽에서 `sum by (label)(...)`로 감싸야 합니다.

### 원인 2 — `$svc`가 "All"일 때 `.*`로 치환되어 empty-compatible

Grafana dashboard variable `$svc`는 "All" 선택 시 `.*`로 치환됩니다. Loki는 이 매처를 그 자체로는 받지 않습니다. `.*`은 빈 문자열과도 매칭되어 인덱스 스캔을 강요하기 때문입니다.

기존 대시보드를 확인한 결과, 이미 모든 Loki 쿼리에 **보호 매처**가 들어가 있었습니다.

```logql
{service_name=~"$svc", service_name=~".+"}
```

`.+`는 최소 한 글자를 요구하므로 empty-compatible이 아닙니다. 신규 대시보드는 이 관행을 따르지 않았던 것이 원인이었습니다.

### 원인 3 — `traceqlSearch`는 `filters` 배열이 아닌 `query` 문자열을 사용 (이때의 이해)

이 시점에서는 `traceqlSearch` 자체는 유효한 queryType이고, 다만 `filters` 배열 대신 `query` 문자열을 채워야 한다고 판단했습니다. 기존 `distributed-tracing.json`에서도 `traceqlSearch`가 그렇게 쓰이고 있었습니다.

→ 이 판단은 **절반만 맞았습니다**. 2차 문제에서 drill down됩니다.

---

## ✅ 1차 해결 — 쿼리 감싸기 + 보호 매처 + query 문자열

### 해결 1 — metric query로 감싸 라벨 집계

`by`를 inner aggregation에서 outer로 옮겼습니다.

```logql
topk(5,
  sum by (error_class)(
    count_over_time({service_name=~"$svc", service_name=~".+"} | detected_level="ERROR" | json [$__auto])
  )
)
```

### 해결 2 — 모든 Loki 쿼리에 `service_name=~".+"` 추가

대시보드 내 Loki 쿼리 4곳 전부에 보호 매처를 추가했습니다.

```logql
{service_name=~"$svc", service_name=~".+"} | detected_level="ERROR" | json
```

### 해결 3 — `filters` 배열을 `query` 문자열로 교체

패널 JSON에서 `traceqlSearch`의 `filters` 배열을 제거하고, `query` 필드에 TraceQL을 직접 채웠습니다.

```text
{ resource.service.name=~"$svc" && status=error }
```

파싱 에러·400 에러는 모두 사라졌습니다. 1차는 종료. lint 결과도 82 PASS, 0 FAIL.

---

## 🔥 2차 문제 — 1차 수정 후 전 패널 No data

패널이 로드는 되는데 열어보니 **모든 주요 패널이 No data**였습니다.

- **Top Error** (stat) — `| json | error_class != ""`
- **예외 클래스 Top-5** (barchart) — `| json | error_class != ""`
- **에러 로그** (logs) — `| json | http_route=~"$http_route"`
- **에러 로그 추이** (timeseries) — `| json | error_class != ""`
- **최근 에러 트레이스** (table) — `queryType: "traceqlSearch"`

이상한 점은 **같은 Loki를 쓰는 log-explorer 대시보드는 정상**이라는 것이었습니다. 두 대시보드를 비교하면서 차이를 정리했습니다.

| 항목 | log-explorer (동작) | error-tracking (No data) |
|---|---|---|
| `\| json` 파이프 | 없음 | 있음 |
| `error_class` 필드 | 참조 안 함 | 참조함 |
| Tempo queryType | - | `traceqlSearch` |

차이가 명확히 보였고, 세 가지 독립 원인을 하나씩 검증했습니다.

---

## 🤔 2차 원인 — native OTLP에서는 log body가 plain text

### 원인 1 — Loki `| json` 파이프가 plain text를 drop

Loki native OTLP 모드에서 log body는 **JSON이 아닙니다**. Spring Boot 애플리케이션이 보내는 기본 로그는 사람이 읽는 plain text 메시지입니다.

예를 들어 log body는 다음과 같은 형태로 저장됩니다.

```text
2026-03-23 10:15:32.441 ERROR [ticketing,abc123] c.g.TicketingController - Failed to reserve seat: SeatAlreadyTaken
```

여기에 `| json` 파이프를 걸면 Loki는 body를 JSON으로 파싱 시도하고, 실패하면 **해당 log line을 결과에서 전량 drop**합니다. 모든 에러 로그가 drop되니 패널은 비어 있을 수밖에 없었습니다.

log-explorer 대시보드는 `| json` 없이 `| detected_level=~"ERROR|WARN"`만 사용해서 같은 환경에서 동작했습니다. detected_level은 Loki가 자동 추출한 레이블이라 파이프 없이도 필터가 됩니다.

### 원인 2 — `error_class` 필드가 애초에 없음

OTel Java agent는 예외 정보를 **span event**에 기록합니다. `exception.type`, `exception.message`, `exception.stacktrace` 같은 이름으로 trace 쪽에 남습니다. **log attribute에 `error_class` 필드를 별도로 추가하지 않습니다**.

즉, `| error_class != ""` 조건은 항상 빈 결과를 만들어냅니다. `| json` 문제를 고쳐도 이 조건이 남아있으면 여전히 No data가 나옵니다.

### 원인 3 — Tempo `traceqlSearch` queryType 자체가 Grafana 12.x에서 무효

1차 해결에서 `query` 문자열로 고친 형태조차 데이터가 안 돌아왔습니다. 다시 확인해보니 `queryType: "traceqlSearch"` 자체가 **Grafana 12.x에서 더 이상 지원되지 않는 값**이었습니다. 현재 유효한 값은 `"traceql"`뿐입니다.

queryType이 유효하지 않으면 Grafana는 Tempo에 쿼리를 아예 보내지 않습니다. 1차 수정 때는 이 지점이 가려져 있었습니다 — filters를 query로 바꿔 에러는 사라졌지만, 쿼리 자체가 전송되지 않아서 에러도 데이터도 없는 상태가 된 것이었습니다. "에러 없음 ≠ 정상 동작"을 뼈저리게 느낀 케이스입니다.

---

## ✅ 2차 해결 — `| json` 제거 + 없는 필드 제거 + queryType 재교정

### Loki 쿼리 4개 수정

**변경 전:**

```text
{service_name="ticketing"} | json | error_class != ""
{service_name="ticketing"} | json | http_route=~"$http_route"
```

**변경 후:**

```text
{service_name="ticketing"} | detected_level=~"ERROR|WARN"
```

수정 포인트는 세 가지입니다.

- `| json` 제거 — native OTLP에서 불필요하고 오히려 전량 drop을 유발합니다.
- `error_class` 참조 제거 — 존재하지 않는 필드이므로 조건이 항상 거짓입니다.
- `http_route` post-filter 제거 — log attribute가 아니라 span attribute이므로 Loki 쿼리에 쓸 수 없습니다.

### Tempo 패널 수정

table 패널은 queryType을 최종 교정하고 `tableType`을 명시했습니다.

```json
{
  "queryType": "traceql",
  "tableType": "traces"
}
```

waterfall 패널은 `$traceId` 변수를 받아서 드릴다운하는 플로우로 바꿨습니다. table에서 trace를 고르면 waterfall이 자동으로 해당 trace를 그립니다.

### 대시보드 구조 개선

쿼리만 고치는 김에 레이아웃도 정리했습니다.

- **에러 로그 분리**: 5xx (ERROR) / 4xx (WARN) 두 패널로 나눠 원인 식별이 쉬워졌습니다.
- **Total 4xx stat 추가**: 4xx 누계를 한눈에 볼 수 있게 했습니다.
- **ERROR vs WARN 추이 차트 추가**: 두 레벨의 시간별 비교로 장애 확산 여부를 판단합니다.

### 재현 확인

- `lint-dashboards.sh`: **82 PASS, 0 FAIL**
- Loki 에러 로그 패널 4개 모두 데이터 표시 확인
- Tempo table → waterfall 드릴다운 동작 확인
- 5xx/4xx 분리 표시로 에러 분포 확인

---

## 📚 배운 점

- **LogQL ≠ PromQL**: `count_over_time`에 `by` 그루핑을 붙이지 않습니다. 라벨 집계가 필요하면 바깥을 `sum by (label)(...)`로 감쌉니다
- **Loki 매처에 empty-compatible 금지**: 변수 치환으로 `.*`이 나올 가능성이 있으면 `service_name=~".+"` 같은 보호 매처를 함께 둡니다. `$svc`가 "All"로 치환되는 상황을 반드시 가정합니다
- **Loki native OTLP에서는 `| json` 파이프를 쓰지 않습니다**: log body는 plain text이고, `| json`은 파싱 실패 시 해당 라인을 drop합니다. 레벨 필터는 `detected_level` 레이블로 충분합니다
- **OTel Java agent의 exception 정보는 span event에 있습니다**: log attribute에서 `error_class`, `exception.type`을 기대하면 안 됩니다. 에러 클래스 통계가 필요하면 Tempo 쪽에서 집계해야 합니다
- **span attribute(`http_route`)는 log 쿼리에 쓸 수 없습니다**: log와 trace는 저장 위치와 attribute 스키마가 다릅니다. 섞어 쓰면 조건이 항상 거짓이 됩니다
- **Tempo queryType은 `"traceql"`만 사용합니다**: `"traceqlSearch"`는 Grafana 12.x 이상에서 유효하지 않습니다. 1차 수정에서 `filters → query` 전환만으로 해결된 것처럼 보여도, queryType 값 자체가 무효라면 쿼리가 아예 전송되지 않아 "에러도 데이터도 없는" 상태가 됩니다
- **"No data"는 쿼리 실패와 구분하기 어렵습니다**: 동작하는 유사 대시보드(log-explorer 등)와 쿼리를 나란히 비교하는 것이 가장 빠른 원인 추적 방법이었습니다
- **lint 규칙 확장 여지**: 현재 `lint-dashboards.sh`는 `detected_level`, datasource UID, TraceQL scoped 여부 등을 검증하지만, 아래 패턴들을 추가할 수 있습니다
  - `count_over_time(... ) by (` 문자열 패턴 금지
  - Loki 쿼리에 `.+` 보호 매처가 하나 이상 있는지 확인
  - Tempo `traceqlSearch` queryType 사용 금지 (`traceql`만 허용)
  - `| json` 파이프 사용 경고 (native OTLP 환경)
- **대시보드 규칙 문서에 명시**: `monitoring.md` 규칙에 "Loki 서비스 필터는 `service_name=~".+"`를 병기해야 한다"와 "native OTLP에서는 `| json`을 쓰지 않는다" 문구를 추가했습니다

## Related Files

- `Goti-monitoring/grafana/dashboards/developer/error-tracking.json`
- `Goti-monitoring/charts/goti-monitoring/dashboards/developer/error-tracking.json`
