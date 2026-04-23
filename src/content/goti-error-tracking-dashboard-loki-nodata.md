---
title: "error-tracking 대시보드 전 패널 No data — native OTLP에서 | json 파싱 함정"
excerpt: "Loki 패널 4개와 Tempo 패널 모두 No data였습니다. Loki native OTLP 환경에서 | json 파이프가 plain text 로그를 전량 drop하고, 존재하지 않는 error_class 필드를 참조한 것이 원인이었습니다."
category: monitoring
tags:
  - go-ti
  - Observability
  - Loki
  - LogQL
  - Tempo
  - TraceQL
  - Grafana
series:
  name: "goti-observability-ops"
  order: 11
date: "2026-03-23"
---

## 한 줄 요약

> error-tracking 대시보드의 Loki 패널 4개와 Tempo 패널 2개가 모두 No data였습니다. Loki native OTLP 모드에서 `| json` 파이프가 plain text log body를 파싱 실패로 전량 drop하고, OTel Java agent가 생성하지 않는 `error_class` 필드를 참조한 것이 원인이었습니다.

## Impact

- **영향 범위**: Grafana `goti-error-tracking` 대시보드 전체 (Loki 4개 + Tempo 2개 패널)
- **증상**: 모든 주요 패널 No data, 같은 환경의 log-explorer는 정상
- **환경**: Kind dev 클러스터, Loki native OTLP 모드
- **발생일**: 2026-03-23

---

## 🔥 문제: 대시보드 전체가 비어있는데 log-explorer는 정상

error-tracking 대시보드(`goti-error-tracking`)를 열었습니다.
모든 패널이 No data였습니다.

문제가 된 패널은 다음과 같습니다.

- **Top Error** (stat) — `| json | error_class != ""`
- **예외 클래스 Top-5** (barchart) — `| json | error_class != ""`
- **에러 로그** (logs) — `| json | http_route=~"$http_route"`
- **에러 로그 추이** (timeseries) — `| json | error_class != ""`
- **최근 에러 트레이스** (table) — `queryType: "traceqlSearch"`

이상한 점은 **같은 Loki, 같은 환경을 쓰는 log-explorer 대시보드는 정상**이라는 것입니다.
log-explorer에서는 ERROR 레벨 로그가 시간별 추이와 함께 잘 표시됐습니다.

두 대시보드를 비교하면서 차이를 정리했습니다.

| 항목 | log-explorer (동작) | error-tracking (No data) |
|---|---|---|
| `\| json` 파이프 | 없음 | 있음 |
| `error_class` 필드 | 참조 안 함 | 참조함 |
| 변수 소스 | Loki `label_values(service_name)` | Prometheus job → regex 추출 |
| Tempo queryType | - | `traceqlSearch` (잘못됨) |

차이가 명확히 보였습니다.
error-tracking은 `| json`을 쓰고 있었고, 존재하지 않는 필드를 조건에 걸고 있었습니다.
Tempo 패널은 queryType 자체가 틀려 있었습니다.

세 가지 독립 원인을 하나씩 검증했습니다.

---

## 🤔 원인: native OTLP에서는 log body가 plain text

### 원인 1. Loki `| json` 파이프가 plain text를 drop

Loki native OTLP 모드에서 log body는 **JSON이 아닙니다**.
Spring Boot 애플리케이션이 보내는 기본 로그는 사람이 읽는 plain text 메시지입니다.

예를 들어 log body는 다음과 같은 형태로 저장됩니다.

```text
2026-03-23 10:15:32.441 ERROR [ticketing,abc123] c.g.TicketingController - Failed to reserve seat: SeatAlreadyTaken
```

여기에 `| json` 파이프를 걸면 Loki는 body를 JSON으로 파싱하려 시도합니다.
plain text이므로 파싱이 실패하고, **해당 log line이 결과에서 전량 drop**됩니다.
모든 에러 로그가 drop되니 패널은 비어 있을 수밖에 없었습니다.

log-explorer 대시보드는 `| json` 없이 `| detected_level=~"ERROR|WARN"`만 사용했습니다.
detected_level은 Loki가 자동 추출한 레이블이라 파이프 없이도 필터가 됩니다.
같은 환경에서 이쪽만 동작한 이유입니다.

### 원인 2. `error_class` 필드가 애초에 없음

두 번째 가설은 `error_class` 필드 부재였습니다.

OTel Java agent는 예외 정보를 **span event**에 기록합니다.
`exception.type`, `exception.message`, `exception.stacktrace` 같은 이름으로 trace 쪽에 남습니다.

**log attribute에 `error_class`라는 필드를 별도로 추가하지 않습니다**.
즉, `| error_class != ""` 조건은 항상 빈 결과를 만들어냅니다.
`| json` 문제를 고쳐도 이 조건이 남아있으면 여전히 No data가 나옵니다.

### 원인 3. Tempo queryType 값이 잘못됨

에러 트레이스 table 패널의 패널 JSON에는 `queryType: "traceqlSearch"`가 적혀 있었습니다.
이 값은 **Grafana 12.x에서 지원하지 않는 값**입니다.
외부 세션에서 확인한 결과, 현재 지원되는 값은 `"traceql"`이었습니다.

queryType이 유효하지 않으면 Grafana는 Tempo에 쿼리를 아예 보내지 않습니다.
패널이 No data가 되는 것은 당연한 결과입니다.

---

## ✅ 해결: `| json` 제거 + 없는 필드 제거 + queryType 교정

세 원인을 한꺼번에 고쳤습니다.

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

table 패널은 queryType을 교정하고 `tableType`을 명시했습니다.

```json
{
  "queryType": "traceql",
  "tableType": "traces"
}
```

waterfall 패널은 `$traceId` 변수를 받아서 드릴다운하는 플로우로 바꿨습니다.
table에서 trace를 고르면 waterfall이 자동으로 해당 trace를 그립니다.

### 대시보드 구조 개선

쿼리만 고치는 김에 레이아웃도 정리했습니다.

- **에러 로그 분리**: 5xx (ERROR) / 4xx (WARN) 두 패널로 나눴습니다. 원인 식별이 쉬워졌습니다.
- **Total 4xx stat 추가**: 4xx 누계를 한눈에 볼 수 있게 했습니다.
- **ERROR vs WARN 추이 차트 추가**: 두 레벨의 시간별 비교로 장애 확산 여부를 판단합니다.

### 재현 확인

Loki ingester 정상화 후 대시보드를 다시 열었습니다.

- Loki 에러 로그 패널 4개 모두 데이터 표시 확인
- Tempo table → waterfall 드릴다운 동작 확인
- 5xx/4xx 분리 표시로 에러 분포 확인

---

## 📚 배운 점

- **Loki native OTLP에서는 `| json` 파이프를 쓰지 않습니다**. log body는 plain text이고, `| json`은 파싱 실패 시 해당 라인을 drop합니다. 레벨 필터는 `detected_level` 레이블로 충분합니다.
- **OTel Java agent의 exception 정보는 span event에 있습니다**. log attribute에서 `error_class`, `exception.type` 같은 필드를 기대하면 안 됩니다. 에러 클래스 통계가 필요하면 Tempo 쪽에서 집계해야 합니다.
- **span attribute(`http_route`)는 log 쿼리에 쓸 수 없습니다**. log와 trace는 저장 위치와 attribute 스키마가 다릅니다. 섞어 쓰면 조건이 항상 거짓이 됩니다.
- **Tempo queryType은 `"traceql"`만 사용합니다**. `"traceqlSearch"`는 Grafana 12.x 이상에서 유효하지 않습니다.
- **"No data"는 쿼리 실패와 구분하기 어렵습니다**. 동작하는 유사 대시보드(log-explorer 등)와 쿼리를 나란히 비교하는 것이 가장 빠른 원인 추적 방법이었습니다.

## Related Files

- `Goti-monitoring/grafana/dashboards/developer/error-tracking.json`
- `Goti-monitoring/charts/goti-monitoring/dashboards/developer/error-tracking.json`
