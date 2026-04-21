---
date: 2026-03-23
category: troubleshoot
project: Goti-monitoring
tags: [grafana, loki, native-otlp, json-parse, error-tracking, detected_level, traceql]
---

# error-tracking 대시보드 Loki/Tempo 패널 전부 No data

## Context

Kind dev 환경. Grafana error-tracking 대시보드(`goti-error-tracking`)에서 Loki 기반 에러 로그 패널 4개와 Tempo 트레이스 패널 2개가 모두 No data. 같은 환경의 log-explorer 대시보드에서는 ERROR 로그가 정상 표시됨.

## Issue

error-tracking 대시보드의 Loki 패널 4개, Tempo 패널 1개가 No data:
- "Top Error" (stat) — `| json | error_class != ""`
- "예외 클래스 Top-5" (barchart) — `| json | error_class != ""`
- "에러 로그" (logs) — `| json | http_route=~"$http_route"`
- "에러 로그 추이" (timeseries) — `| json | error_class != ""`
- "최근 에러 트레이스" (table) — `queryType: "traceqlSearch"`

동작하는 log-explorer 대시보드와 비교:

| | log-explorer (동작) | error-tracking (No data) |
|---|---|---|
| `| json` | 없음 | 있음 |
| `error_class` 필드 | 없음 | 참조함 |
| 변수 소스 | Loki `label_values(service_name)` | Prometheus job → regex 추출 |
| Tempo queryType | - | `traceqlSearch` (잘못됨) |

## Action

### 1. 가설: Loki `| json` 파싱 실패 → 결과: 확인 (근본 원인 1)

Loki native OTLP 모드에서 log body는 plain text (Spring Boot 로그 메시지). `| json` 파이프가 body를 JSON 파싱 시도 → 실패 → 해당 라인 전체 drop → No data.

log-explorer는 `| json` 없이 `| detected_level=~"ERROR|WARN"`만 사용하여 정상 동작.

### 2. 가설: `error_class` 필드 부재 → 결과: 확인 (근본 원인 2)

OTel Java agent는 예외 정보를 span event에 기록하지, log attribute에 `error_class` 필드를 추가하지 않음. `| json | error_class != ""` 조건은 항상 빈 결과.

### 3. 가설: Tempo queryType 오류 → 결과: 확인 (근본 원인 3)

에러 트레이스 table 패널의 `queryType: "traceqlSearch"`는 Grafana 12.x에서 지원하지 않는 값. `"traceql"`로 변경 필요. (외부 세션에서 발견)

### 적용한 수정

**Loki 쿼리 4개:**
- `| json` 제거 — native OTLP에서 불필요
- `error_class` 참조 제거 — 존재하지 않는 필드
- `http_route` post-filter 제거 — log attribute가 아닌 span attribute

**Tempo 패널:**
- table: `queryType: "traceqlSearch"` → `"traceql"` + `tableType: "traces"` 추가
- waterfall: `$traceId` 변수 기반 드릴다운 플로우 구현

**추가 개선:**
- 에러 로그 5xx(ERROR) / 4xx(WARN) 분리
- Total 4xx stat 추가
- ERROR vs WARN 추이 차트 추가

## Result

- Loki 에러 로그 패널 정상 표시 (ingester 정상화 후 확인)
- Tempo 트레이스 table + waterfall 드릴다운 동작
- 5xx/4xx 로그 분리로 원인 식별 용이

### 재발 방지

- Loki native OTLP 환경에서는 `| json` 사용 금지 (monitoring.md 규칙에 이미 반영)
- OTel Java agent의 log attribute에 없는 필드(`error_class`, `http_route`) 참조 금지
- Tempo queryType은 반드시 `"traceql"` 사용

## Related Files

- `Goti-monitoring/grafana/dashboards/developer/error-tracking.json`
- `Goti-monitoring/charts/goti-monitoring/dashboards/developer/error-tracking.json`
