---
date: 2026-03-17
category: troubleshoot
project: Goti-monitoring
tags: [grafana, tempo, service-map, promql, traceql, node-graph, mimir]
---

# Grafana serviceMap 쿼리 PromQL 파싱 에러 — TraceQL→PromQL 문법 수정

## Context

MSA 전환 후 'Goti - 분산 추적 상세' 대시보드의 '서비스 의존성 그래프' (nodeGraph) 패널에서 에러 발생. MSA 전환 전부터 에러가 있었으나 해당 섹션이 MSA 대비용이라 무시하고 있었음. MSA 전환 완료 후 확인.

환경: Grafana 12.4.0, Tempo (single binary), Mimir 3.0.1, Kind 7노드

## Issue

```
Error (bad_data: invalid parameter "query": 1:81: parse error: unexpected character inside braces: '!')
```

대시보드의 서비스 의존성 그래프 (nodeGraph, queryType: "serviceMap") 패널에서 PromQL 파싱 에러.

재현: 대시보드 로드 시 항상 발생.

## Action

### 1. 메트릭 존재 확인

Mimir에 `traces_service_graph_request_total` 메트릭 존재 확인 (17개 시리즈):

```
{client="goti-user", server="172.20.0.1"}
{client="goti-payment", server="172.20.0.1:6379"}
{client="user", server="goti-user"}
...
```

→ Tempo `metricsGenerator` + `service_graphs` processor 정상 동작. 메트릭 부재 아님.

### 2. 대시보드 패널 확인

```json
{
  "queryType": "serviceMap",
  "serviceMapQuery": "{resource.service.name=\"$svc\"}",
  "limit": 20
}
```

### 3. 외부 조사 — serviceMapQuery 문법 확인

**가설**: `serviceMapQuery`가 TraceQL 문법을 기대할 것이다 → **기각**

**조사 결과** (Grafana 소스코드 + Grafonnet SDK 문서 + GitHub issues):

- `serviceMapQuery`는 **PromQL 레이블 매처** 문법이다. TraceQL이 아님.
- Grafana Tempo 플러그인이 이 값을 메트릭명 뒤에 **직접 연결**:

```typescript
// datasource.ts line ~1304
`sum by (client, server) (rate(${metric}${serviceMapQuery || ''}[$__range]))`
```

- 따라서 `{resource.service.name="$svc"}`가 PromQL에 들어가면:

```
rate(traces_service_graph_request_total{resource.service.name="goti-user"}[$__range])
```

- PromQL 레이블명에 점(`.`)은 허용되지 않음 → 파싱 에러
- 사용 가능한 레이블: `client`, `server`, `connection_type` (Tempo metrics_generator가 생성)

### 근본 원인 (Root Cause)

`serviceMapQuery`에 TraceQL 문법(`resource.service.name`)을 사용했으나, 이 필드는 PromQL 레이블 매처만 허용. Grafana 플러그인이 이 값을 `traces_service_graph_*` 메트릭의 PromQL 쿼리에 직접 연결하므로, 점이 포함된 레이블명이 PromQL 파서에서 거부됨.

### 적용한 수정

```json
// Before (TraceQL 문법, 잘못됨)
"serviceMapQuery": "{resource.service.name=\"$svc\"}"

// After (PromQL array — client/server 양방향 필터)
"serviceMapQuery": ["{client=\"$svc\"}", "{server=\"$svc\"}"]
```

array 형태로 지정하면 Grafana가 두 쿼리를 OR로 결합하여 선택된 서비스가 caller든 callee든 관련 edge를 모두 표시.

## Result

### 수정 후 상태

- PromQL 파싱 에러 해소
- `$svc` 변수(예: `goti-user`)로 선택된 서비스의 양방향 의존성 그래프 표시
- MSA 6개 서비스 토폴로지 정상 시각화

### 재발 방지

1. **monitoring-pitfalls.md 업데이트**: serviceMap 쿼리 섹션을 TraceQL→PromQL로 수정, 올바른 문법 예시 추가
2. **rules/monitoring.md 업데이트**: Quick Reference에 serviceMap PromQL 규칙 추가, 절대 금지 항목에 `serviceMapQuery에 TraceQL 문법 사용` 추가
3. **핵심 원칙 문서화**: `serviceMapQuery` 레이블 키에 `[\w_]+`만 허용 (점, 하이픈 불가)

## Related Files

### Goti-monitoring
- `grafana/dashboards/developer/distributed-tracing.json` — SSOT, serviceMapQuery 수정
- `charts/goti-monitoring/dashboards/developer/distributed-tracing.json` — chart 복사본 동기화

### goti-team-controller
- `docs/monitoring-pitfalls.md` — serviceMap 문법 섹션 수정 + MSA recording rule 현행화
- `.claude/rules/monitoring.md` — Quick Reference + 절대 금지 항목 업데이트
