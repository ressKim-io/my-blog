---
date: 2026-03-23
category: troubleshoot
project: Goti-monitoring
tags: [logql, traceql, grafana, loki, tempo, dashboard]
---

# Error Tracking 대시보드 LogQL/TraceQL 쿼리 3건 수정

## Context
Goti-monitoring에 Error Tracking & Investigation 대시보드(`error-tracking.json`)를 신규 추가한 직후, Grafana에서 3개 패널에서 에러 발생.

## Issue

### 에러 1: LogQL `count_over_time` 그루핑

```
topk(5, count_over_time({service_name=~"$svc"} | detected_level="ERROR" | json [$__auto]) by (error_class))

parse error : grouping not allowed for count_over_time aggregation
```

### 에러 2: Loki empty-compatible matcher

```
topk(1, count_over_time({service_name=~"$svc"} | detected_level="ERROR" | json | error_class != "" [$__auto]))

parse error : queries require at least one regexp or equality matcher that does not have an empty-compatible value.
For instance, app=~".*" does not meet this requirement, but app=~".+" will
```

### 에러 3: Tempo 검색 400 Bad Request

```
최근 에러 트레이스 패널 — status: 400 Bad Request
```

## Action

### 에러 1 진단
1. 가설: LogQL `count_over_time`이 `by` 그루핑을 지원할 것 → 결과: **기각**. LogQL에서 `count_over_time`은 unwrap 없는 range aggregation이라 `by` 절 미지원
2. 근본 원인: PromQL의 `by` 문법을 LogQL에 그대로 적용한 실수
3. 수정: `sum by (error_class)(count_over_time(...))` 형태로 metric query로 감싸기

### 에러 2 진단
1. 가설: `$svc` 변수가 "All" 선택 시 `.*`로 치환되어 empty-compatible → 결과: **채택**
2. 기존 대시보드(`distributed-tracing.json`, `api-red-metrics.json`) 확인 → `{service_name=~"$svc", service_name=~".+"}` 패턴으로 보호 매처 사용 중
3. 수정: 모든 Loki 쿼리(4곳)에 `service_name=~".+"` 추가

### 에러 3 진단
1. 가설: `traceqlSearch` queryType에 `filters` 배열 구조가 잘못됨 → 결과: **채택**
2. 기존 `distributed-tracing.json` 확인 → `traceqlSearch`는 `filters` 배열이 아닌 `query` 필드에 TraceQL 문자열을 직접 사용
3. 수정: `filters` 배열 → `query` 문자열 방식으로 변경 + traceID 클릭 internal link 추가

## Result

- lint-dashboards.sh: **82 PASS, 0 FAIL**
- JSON 유효성: 통과
- monitoring.md 규칙 업데이트: Loki 서비스 필터에 `service_name=~".+"` 필수 명시 추가
- 재발 방지:
  - monitoring.md에 empty-compatible matcher 보호 패턴 문서화
  - lint-dashboards.sh가 `detected_level`, datasource UID, TraceQL scoped 등은 검증하지만 LogQL `count_over_time by` 패턴은 미검증 → 향후 lint 규칙 추가 고려

## Related Files
- `Goti-monitoring/grafana/dashboards/developer/error-tracking.json`
- `Goti-monitoring/charts/goti-monitoring/dashboards/developer/error-tracking.json`
- `goti-team-controller/.claude/rules/monitoring.md`
- `goti-team-controller/goti-backend-monitoring/10-error-tracking.md`
