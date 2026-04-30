---
title: "Tempo v2 scoped tag 400 에러 — TraceQL과 Grafana 변수의 불일치"
excerpt: "TraceQL의 =~ 연산자가 Grafana multi-value 변수와 호환되지 않고, Tempo v2 API는 scoped tag name을 요구하는데 Grafana 문서는 unscoped를 안내하는 두 가지 함정"
type: troubleshooting
category: monitoring
tags:
  - go-ti
  - Tempo
  - Grafana
  - TraceQL
  - Troubleshooting
date: "2026-02-23"
---

## 한 줄 요약

> TraceQL의 `=~` 연산자는 Grafana multi-value 변수와 호환되지 않고, Tempo v2 API는 `resource.service.name` 같은 scoped tag을 요구하는데 Grafana 문서 기본값은 unscoped `service.name`을 안내합니다. 두 가지 문서 불일치 함정.

## Impact

- **영향 범위**: 분산 추적 대시보드, 에러 분석 대시보드
- **증상**: TraceQL 패널 400 Bad Request, tag values API 400
- **발생일**: 2026-03-15

---

## 🔥 문제 1: TraceQL에서 Grafana multi-value 변수가 안 된다

대시보드에 TraceQL 쿼리를 추가했습니다:

```
{resource.service.name="$svc" && duration > $min_duration && span.http.route=~"$http_route"}
```

`$http_route` 변수에서 "All"을 선택하면 **400 Bad Request**가 반환됩니다.

### 원인

PromQL에서는 Grafana가 multi-value 변수를 pipe-separated 형태(`val1|val2|val3`)로 변환해서 `=~` regex에 넣어주는데, **TraceQL에서는 이 변환이 지원되지 않습니다**.

| 쿼리 언어 | 예시 | Grafana 변환 |
|---|---|---|
| PromQL | `{__name__=~"val1\|val2\|val3"}` | 변환됨 |
| TraceQL | `{span.http.route=~"val1\|val2\|val3"}` | 미지원 → 400 Bad Request |

PromQL과 TraceQL의 `=~` 연산자가 같은 것처럼 보이지만, Grafana datasource plugin의 변수 치환 방식이 다릅니다.

### 해결

TraceQL에서 multi-value 변수와 `=~`를 조합하는 것은 현재 불가능합니다.
`span.http.route=~"$http_route"` 필터를 제거하고, 대신 `select(span.http.route, ...)`로 결과 테이블에 route 컬럼만 표시하도록 바꿨습니다.

```
# Before — 400 에러
{resource.service.name="$svc" && span.http.route=~"$http_route"}

# After — 필터 대신 select로 표시만
{resource.service.name="$svc" && duration > $min_duration}
  | select(span.http.route, span.http.response.status_code)
```

---

## 🔥 문제 2: Tempo v2 API가 scoped tag을 요구한다

Grafana의 Tempo datasource 설정에서 tag를 `service.name`(unscoped)으로 지정하면 400이 나옵니다.

```bash
# ❌ unscoped — 400 Bad Request
GET /api/v2/search/tag/service.name/values

# ✅ scoped — 200 OK
GET /api/v2/search/tag/resource.service.name/values
```

### 원인

Tempo v2 API 문서에 **"Unscoped attributes aren't supported for filtered tag values"**라고 명시되어 있습니다.
v1 API에서는 unscoped가 동작했지만, v2에서는 `resource.` 또는 `span.` prefix가 필수입니다.

문제는 **Grafana 공식 문서의 기본값이 unscoped `service.name`**이라는 것입니다.
Grafana 문서와 Tempo v2 API 문서가 서로 불일치합니다.

### 해결

kube-prometheus-stack values에서 Tempo datasource의 tag key를 scoped로 변경했습니다:

```yaml
# Before
tracesToLogsV2:
  tags:
    - key: "service.name"

# After
tracesToLogsV2:
  tags:
    - key: "resource.service.name"
```

`tracesToLogsV2`, `tracesToMetrics`, `tracesToProfiles` 세 곳 모두 동일하게 변경했습니다.

> 참고: `tracesToLogsV2.query` 안의 `${__span.tags["service.name"]}`은 변경하지 않습니다. 이것은 span 내부 참조이지 API 호출이 아닙니다.

---

## 📚 배운 점

### TraceQL은 PromQL이 아니다

문법이 비슷해서 같은 패턴이 통할 거라고 생각하기 쉽습니다.
하지만 Grafana의 변수 interpolation 처리가 datasource마다 다릅니다.

PromQL에서 잘 되는 `=~"$multi_var"` 패턴이 TraceQL에서는 안 됩니다.
TraceQL에서 multi-value 필터가 필요하면 현재로선 다른 접근(개별 쿼리, 또는 `select`로 표시만)이 필요합니다.

### Tempo v2 마이그레이션 시 tag scope 확인 필수

Tempo v1 → v2로 업그레이드하면 tag API가 scoped를 요구합니다.
기존에 `service.name`으로 설정된 곳을 `resource.service.name`으로 전부 변경해야 합니다.
Grafana 공식 문서의 예제가 아직 unscoped를 보여주는 경우가 있으니 주의하세요.
