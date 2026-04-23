---
title: "Error Tracking 대시보드 — LogQL/TraceQL 쿼리 3건 수정"
excerpt: "신규 Error Tracking & Investigation 대시보드에서 LogQL 그루핑, Loki empty-compatible matcher, Tempo traceqlSearch 구조 문제 3건을 한 번에 잡은 기록입니다."
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

> 신규 Error Tracking 대시보드에서 Grafana 에러 3건이 발생했고, LogQL `count_over_time` 그루핑·Loki empty-compatible matcher·Tempo `traceqlSearch` 구조를 각각 수정해 해결했습니다.

---

## 🔥 문제: 신규 대시보드 패널 3개가 파싱·400 에러로 깨짐

### 기존 아키텍처 / 기대 동작

Goti 관측성 스택에 Error Tracking & Investigation 대시보드(`error-tracking.json`)를 신규 추가했습니다. 이 대시보드는 다음 세 가지를 한 화면에서 보여주는 용도입니다.

- 서비스별 에러 레벨 로그 Top-K (Loki)
- 에러 클래스별 최근 로그 건수 (Loki)
- 최근 에러 트레이스 목록 (Tempo)

기존의 `distributed-tracing.json`, `api-red-metrics.json`과 동일한 데이터소스를 사용하므로 큰 이슈 없이 렌더링될 것으로 예상했습니다.

### 발견한 문제

대시보드를 올리자 세 개의 패널에서 연달아 에러가 떴습니다.

**에러 1 — LogQL `count_over_time` 그루핑 파싱 에러**

```logql
topk(5, count_over_time({service_name=~"$svc"} | detected_level="ERROR" | json [$__auto]) by (error_class))
```

Grafana가 반환한 에러는 다음과 같았습니다.

```text
parse error : grouping not allowed for count_over_time aggregation
```

**에러 2 — Loki empty-compatible matcher 거절**

```logql
topk(1, count_over_time({service_name=~"$svc"} | detected_level="ERROR" | json | error_class != "" [$__auto]))
```

이쪽은 쿼리 구조는 맞았지만 Loki가 매처 자체를 거절했습니다.

```text
parse error : queries require at least one regexp or equality matcher that does not have an empty-compatible value.
For instance, app=~".*" does not meet this requirement, but app=~".+" will
```

**에러 3 — Tempo `traceqlSearch` 400 Bad Request**

```text
최근 에러 트레이스 패널 — status: 400 Bad Request
```

Tempo 쪽은 에러 메시지만 봐서는 원인을 좁히기 어려웠습니다. Grafana의 queryType 명세와 기존 대시보드 JSON을 비교해야 했습니다.

---

## 🤔 원인: LogQL 문법 오해 + Loki 매처 규칙 + Grafana queryType 구조

세 문제의 원인을 하나씩 정리하겠습니다.

### 원인 1 — LogQL `count_over_time`은 `by` 그루핑을 지원하지 않음

PromQL에서는 `count_over_time(metric[5m])` 뒤에 `by (label)`을 붙여도 문제없습니다. 그 감각을 그대로 LogQL에 가져온 것이 실수였습니다.

LogQL에서 `count_over_time`은 unwrap 없는 range aggregation이기 때문에 쿼리 내부에서 라벨 그루핑을 받지 않습니다. 라벨별 집계가 필요하면 바깥쪽에서 `sum by (label)(...)` 같은 metric aggregation으로 감싸야 합니다.

### 원인 2 — `$svc`가 "All"일 때 `.*`로 치환되어 empty-compatible

Grafana의 dashboard variable `$svc`는 "All" 선택 시 `.*`로 치환됩니다. Loki는 이 매처를 그 자체로는 받지 않습니다. `.*`은 빈 문자열과도 매칭되기 때문에 "모든 로그 스트림"을 의미해 인덱스 스캔을 강요하기 때문입니다.

기존 대시보드(`distributed-tracing.json`, `api-red-metrics.json`)를 확인한 결과, 이미 모든 Loki 쿼리에 **보호 매처**가 들어가 있었습니다.

```logql
{service_name=~"$svc", service_name=~".+"}
```

`.+`는 최소 한 글자를 요구하므로 empty-compatible이 아닙니다. 신규 대시보드는 이 관행을 따르지 않았던 것이 원인이었습니다.

### 원인 3 — `traceqlSearch` queryType은 `filters` 배열이 아닌 `query` 문자열을 사용

Grafana Tempo 데이터소스에는 여러 queryType이 있습니다. `traceql`, `traceqlSearch`, `nativeSearch` 등인데, 각 queryType이 기대하는 필드 구조가 다릅니다. 신규 대시보드는 `traceqlSearch`를 쓰면서 `filters` 배열을 채워 보냈고, Tempo가 이를 400으로 거절했습니다.

기존 `distributed-tracing.json`을 확인하니 `traceqlSearch`는 `query` 필드에 TraceQL 문자열을 그대로 넣는 구조였습니다.

---

## ✅ 해결: 쿼리 감싸기 + 보호 매처 + queryType 구조 교체

### 해결 1 — metric query로 감싸 라벨 집계

`by`를 inner aggregation에서 outer로 옮겼습니다.

```logql
topk(5,
  sum by (error_class)(
    count_over_time({service_name=~"$svc", service_name=~".+"} | detected_level="ERROR" | json [$__auto])
  )
)
```

`count_over_time`은 그루핑 없이 그대로 두고, 바깥의 `sum by (error_class)`가 라벨 축약을 담당합니다. 이 형태가 LogQL 표준 패턴입니다.

### 해결 2 — 모든 Loki 쿼리에 `service_name=~".+"` 추가

대시보드 내 Loki 쿼리 4곳 전부에 보호 매처를 추가했습니다.

```logql
{service_name=~"$svc", service_name=~".+"} | detected_level="ERROR" | json
```

이렇게 하면 `$svc`가 "All"로 확장되어 `.*`가 되어도 `.+` 매처가 빈 문자열을 걸러내므로 Loki가 쿼리를 받아줍니다.

### 해결 3 — `filters` 배열을 `query` 문자열로 교체 + traceID 링크 추가

패널 JSON에서 `traceqlSearch`의 `filters` 배열을 제거하고, `query` 필드에 TraceQL을 직접 채워 넣었습니다.

```text
{ resource.service.name=~"$svc" && status=error }
```

동시에 traceID 클릭 시 tracing 대시보드로 점프하도록 internal link를 추가했습니다. 이 부분은 기존 `distributed-tracing.json`의 link 설정을 그대로 이식했습니다.

### 재현 확인

로컬에서 다음 항목을 확인했습니다.

- `lint-dashboards.sh` 결과: **82 PASS, 0 FAIL**
- 대시보드 JSON 유효성 검증 통과
- Grafana 패널 3개 모두 에러 없이 렌더링

---

## 📚 배운 점

- **LogQL ≠ PromQL**: `count_over_time`에 `by` 그루핑을 붙이지 않습니다. 라벨 집계가 필요하면 바깥을 `sum by (label)(...)`로 감쌉니다.
- **Loki 매처에 empty-compatible 금지**: 변수 치환으로 `.*`이 나올 가능성이 있으면 `service_name=~".+"` 같은 보호 매처를 함께 둡니다. `$svc`가 "All"로 치환되는 상황을 반드시 가정합니다.
- **Grafana queryType별 필드 구조가 다름**: `traceqlSearch`는 `query` 문자열을 받고, `filters` 배열은 다른 queryType의 몫입니다. 신규 패널을 만들 때는 기존 작동 중인 대시보드 JSON을 복제 기반으로 시작합니다.
- **lint 규칙 확장 여지**: 현재 `lint-dashboards.sh`는 `detected_level`, datasource UID, TraceQL scoped 여부 등을 검증하지만, LogQL `count_over_time by` 패턴은 미검증입니다. 재발 방지를 위해 다음 항목을 lint에 추가할 후보로 남겼습니다.
  - `count_over_time(... ) by (`  문자열 패턴 금지
  - Loki 쿼리에 `.+` 보호 매처가 하나 이상 있는지 확인
  - Tempo `traceqlSearch`에 `filters` 필드가 없는지 확인
- **대시보드 규칙 문서에 명시**: 재발 방지 차원에서 내부 `monitoring.md` 규칙에 "Loki 서비스 필터는 `service_name=~".+"`를 병기해야 한다"는 문구를 추가했습니다.
