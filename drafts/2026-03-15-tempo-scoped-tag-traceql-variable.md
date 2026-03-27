---
date: 2026-03-15
category: troubleshoot
project: Goti-monitoring, Goti-k8s
tags: [tempo, grafana, traceql, tracesToLogsV2, scoped-tag, 400-error, multi-value-variable]
---

# Tempo v2 scoped tag 400 에러 + TraceQL Grafana multi-value 변수 호환 문제

## Context

Developer 대시보드 고도화 작업 후 Grafana에서 대시보드를 확인하는 중 두 가지 문제가 동시에 발생.

1. **분산 추적 대시보드**: TraceQL 검색 결과, API Endpoint 에러 트레이스 패널이 400 에러
2. **Tempo datasource**: tracesToLogsV2/tracesToMetrics/tracesToProfiles의 tags 설정이 Tempo v2 API와 호환되지 않아 400 에러

환경: Kind 클러스터, Grafana + Tempo (kube-prometheus-stack Helm chart 기반)

## Issue

### 문제 1: TraceQL에서 Grafana multi-value 변수 regex 호환 안 됨

```
TraceQL query:
{resource.service.name="$svc" && duration > $min_duration && span.http.route=~"$http_route"}

→ Tempo 400 Bad Request
```

Grafana의 multi-value 변수 (`includeAll: true, multi: true`)가 "All" 선택 시 변수 interpolation 결과가 TraceQL regex 문법과 호환되지 않음. PromQL의 `=~` regex는 Grafana 변수와 정상 동작하지만, TraceQL의 `=~`는 다르게 처리됨.

재현 조건: `$http_route` 변수가 "All" 선택된 상태에서 Tempo 패널 로드

### 문제 2: Tempo v2 API에서 unscoped tag name 400 에러

```
GET /api/v2/search/tag/service.name/values → 400
GET /api/v2/search/tag/resource.service.name/values → 200 ✅
```

Grafana Tempo datasource의 `tracesToLogsV2.tags` 설정에서 `key: "service.name"` (unscoped)을 사용하면, Grafana가 Tempo v2 tag API를 호출할 때 scoped prefix 없이 호출하여 400 발생.

Grafana 공식 문서 기본값이 `service.name` (unscoped)이지만, Tempo v2 API 문서에는 **"Unscoped attributes aren't supported for filtered tag values"** 라고 명시되어 있음. 문서 간 불일치.

## Action

### 문제 1 진단

1. 가설: TraceQL 쿼리 문법 자체 오류 → 결과: 기존 쿼리(`{resource.service.name="$svc" && duration > $min_duration}`)는 정상 동작. `span.http.route=~"$http_route"` 추가 부분이 문제
2. 가설: Grafana multi-value 변수의 interpolation이 TraceQL regex와 비호환 → 결과: **맞음**. PromQL `=~`는 Grafana가 pipe-separated (`val1|val2`)로 변환해주지만, TraceQL은 이 변환을 지원하지 않음

근본 원인: **TraceQL의 `=~` 연산자는 Grafana의 multi-value 변수 interpolation과 호환되지 않음**. PromQL과 달리 TraceQL은 Grafana datasource plugin에서 변수 치환 방식이 다름.

수정:
- `distributed-tracing.json` id:1, id:20 — `&& span.http.route=~"$http_route"` 제거
- `error-analysis.json` id:9 — `&& span.http.route=~"$http_route"` 제거
- `select(span.http.route, ...)` 유지하여 결과 테이블에서 route 컬럼은 표시

### 문제 2 진단

1. 가설: kps values의 Tempo datasource tags key가 unscoped → 결과: **맞음**. `key: "service.name"` 사용 중
2. Tempo v2 API 문서 확인: "Unscoped attributes aren't supported for filtered tag values" 명시
3. v1 API (`/api/search/tag/service.name/values`)는 동작하지만 v2 API는 scoped 필수

근본 원인: **Tempo v2 API는 scoped tag name을 요구하지만, Grafana 공식 문서 기본값은 unscoped `service.name`을 안내 — 문서 간 불일치**

수정:
- kps values Tempo datasource: `tracesToLogsV2.tags`, `tracesToMetrics.tags`, `tracesToProfiles.tags`에서 `key: "service.name"` → `key: "resource.service.name"` 변경
- `tracesToLogsV2.query` 내 `${__span.tags["service.name"]}` → 그대로 유지 (span 내부 참조, API 호출 아님)

## Result

- 문제 1: TraceQL 패널 정상 동작 확인 (400 → 데이터 표시)
- 문제 2: kps values 수정 후 ArgoCD sync 필요 (수정 적용 대기)
- 회귀 테스트: `Goti-k8s/scripts/validate/validate.sh` 실행으로 전체 쿼리 검증 가능
- 재발 방지:
  - TraceQL에서 Grafana 변수 사용 시 `=~` regex 대신 `select()`로 결과 표시만 하고, 필터는 피할 것
  - Tempo datasource tags 설정 시 반드시 scoped tag name 사용 (`resource.service.name`, `span.http.route` 등)

## Related Files

- `Goti-monitoring/grafana/dashboards/developer/distributed-tracing.json`
- `Goti-monitoring/grafana/dashboards/developer/error-analysis.json`
- `Goti-monitoring/charts/goti-monitoring/dashboards/developer/distributed-tracing.json`
- `Goti-monitoring/charts/goti-monitoring/dashboards/developer/error-analysis.json`
- kps values 파일 (Tempo datasource 설정)
