---
title: "Grafana serviceMap 쿼리 PromQL 파싱 에러 — TraceQL 문법을 PromQL 레이블 매처로 수정"
excerpt: "Grafana nodeGraph 패널의 serviceMapQuery에 TraceQL 문법을 썼다가 PromQL 파서가 거부한 사건입니다. 점이 포함된 레이블명이 원인이었고, client·server 양방향 매처 배열로 전환해 해결했습니다"
category: monitoring
tags:
  - go-ti
  - Prometheus
  - PromQL
  - ServiceMap
  - Troubleshooting
date: "2026-02-26"
---

## 한 줄 요약

> Grafana 분산 추적 대시보드의 `nodeGraph` 패널이 `serviceMapQuery`에 TraceQL 문법을 써서 PromQL 파싱 에러를 내고 있었습니다. 원인은 이 필드가 PromQL 레이블 매처로 그대로 이어붙는다는 점이었고, `{client="$svc"}`와 `{server="$svc"}` 배열로 바꿔 해결했습니다

---

## 🔥 문제: nodeGraph 패널에서 PromQL 파싱 에러

### 기존 아키텍처 / 기대 동작

MSA 전환 이후 분산 추적 대시보드를 다시 정비하는 과정이었습니다.

환경은 다음과 같습니다.

- Grafana 12.4.0
- Tempo (single binary)
- Mimir 3.0.1
- Kind 7노드 클러스터

'Goti - 분산 추적 상세' 대시보드에는 '서비스 의존성 그래프' 패널이 있습니다.
Grafana Tempo 데이터소스의 `nodeGraph` 패널 타입을 사용하며, `queryType: "serviceMap"`으로 설정되어 있습니다.
선택된 서비스(`$svc` 변수)와 연결된 호출 관계를 노드-엣지 그래프로 시각화하는 것이 목표였습니다.

MSA 전환 전부터 에러가 있었으나, 해당 섹션이 MSA 대비용이라 잠시 보류하고 있었습니다.
MSA 전환이 끝나면서 우선순위가 올라와 다시 열어봤습니다.

### 발견한 문제

대시보드를 로드하자마자 패널에 다음 에러가 떴습니다.

```text
Error (bad_data: invalid parameter "query": 1:81: parse error: unexpected character inside braces: '!')
```

재현은 간단했습니다. 대시보드 로드 시 **항상** 발생했습니다.
에러 메시지는 PromQL 파서가 중괄호 안에서 허용하지 않는 문자를 만났다는 내용이었습니다.
`serviceMap` 타입인데 왜 PromQL 파서가 등장하는지가 첫 단서였습니다.

---

## 🤔 원인: serviceMapQuery는 TraceQL이 아니라 PromQL 레이블 매처

### 1단계: 메트릭 존재 확인

먼저 Mimir에 원본 메트릭이 실제로 쌓이고 있는지 확인했습니다.

```promql
traces_service_graph_request_total
```

결과는 17개 시리즈가 정상적으로 올라와 있었습니다.

```text
{client="goti-user", server="172.20.0.1"}
{client="goti-payment", server="172.20.0.1:6379"}
{client="user", server="goti-user"}
...
```

Tempo의 `metricsGenerator` + `service_graphs` processor는 정상 동작 중이었습니다.
메트릭 자체가 없어서 생긴 문제가 아니라는 뜻입니다.

### 2단계: 대시보드 패널 JSON 확인

다음은 패널의 `targets` 설정이었습니다.

```json
{
  "queryType": "serviceMap",
  "serviceMapQuery": "{resource.service.name=\"$svc\"}",
  "limit": 20
}
```

`resource.service.name`은 OTel 스펙의 리소스 속성이고, TraceQL에서 흔히 쓰는 형태입니다.
`serviceMap` 타입이니 당연히 TraceQL 문법이 올 것이라고 가정한 설정이었습니다.

### 3단계: Grafana Tempo 플러그인 소스 확인

가설은 "`serviceMapQuery`가 TraceQL 문법을 기대할 것이다"였습니다.
이 가설을 확인하려고 Grafana 소스코드와 Grafonnet SDK 문서, 관련 GitHub 이슈를 함께 조사했습니다.

조사 결과는 가설과 반대였습니다.
`serviceMapQuery`는 **PromQL 레이블 매처** 문법을 기대합니다. TraceQL이 아닙니다.

이유는 플러그인이 이 값을 메트릭 이름 뒤에 **문자열로 그대로 이어붙이기** 때문입니다.
Grafana Tempo 데이터소스 내부 코드는 대략 다음처럼 생겼습니다.

```typescript
// datasource.ts line ~1304
`sum by (client, server) (rate(${metric}${serviceMapQuery || ''}[$__range]))`
```

여기서 `${metric}`은 `traces_service_graph_request_total`이고, `${serviceMapQuery}`는 우리가 넣은 `{resource.service.name="goti-user"}`입니다.
두 값이 붙으면 최종 PromQL은 이렇게 됩니다.

```promql
rate(traces_service_graph_request_total{resource.service.name="goti-user"}[$__range])
```

이 문자열이 Mimir의 PromQL 파서로 넘어가는 순간 문제가 드러납니다.
PromQL 레이블명 규칙은 `[a-zA-Z_][a-zA-Z0-9_]*`로, **점(`.`)이나 하이픈을 허용하지 않습니다**.
`resource.service.name`은 문법적으로 레이블명이 될 수 없습니다.

에러 메시지에서 `'!'`가 등장한 이유도 설명이 됩니다.
PromQL 파서는 `resource` 다음에 점을 만나면 레이블명이 끝난 것으로 간주하고, 다음 토큰을 기대합니다.
이때 나타난 `.service`를 해석하지 못해서 파서가 중괄호 안의 예외 문자(`!=` 패턴의 일부 등)로 판단한 것입니다.

### 근본 원인

`serviceMapQuery`에 TraceQL 문법(`resource.service.name`)을 사용했으나, 이 필드는 PromQL 레이블 매처만 허용합니다.
Grafana 플러그인이 이 값을 `traces_service_graph_*` 메트릭의 PromQL 쿼리에 문자열로 직접 연결하므로, 점이 포함된 레이블명이 PromQL 파서에서 거부됩니다.

사용 가능한 레이블은 Tempo `metrics_generator`가 만들어주는 세 가지입니다.

- `client`
- `server`
- `connection_type`

---

## ✅ 해결: client/server 양방향 매처 배열로 교체

`serviceMapQuery`를 PromQL 레이블 매처 문법으로 바꾸면 됩니다.
단, 하나의 매처만 쓰면 선택된 서비스가 caller인 edge 또는 callee인 edge 중 한쪽만 보이게 됩니다.
양방향을 모두 보려면 Grafana가 지원하는 **배열 형태**를 사용합니다.

```json
// Before (TraceQL 문법, 잘못됨)
"serviceMapQuery": "{resource.service.name=\"$svc\"}"

// After (PromQL 배열 — client/server 양방향 필터)
"serviceMapQuery": ["{client=\"$svc\"}", "{server=\"$svc\"}"]
```

배열로 지정하면 Grafana가 두 쿼리를 내부적으로 OR로 결합합니다.
선택된 서비스가 호출자든 피호출자든 관련 edge가 모두 노드 그래프에 표시됩니다.

### 수정 후 상태

- PromQL 파싱 에러가 해소되었습니다.
- `$svc` 변수(예: `goti-user`)로 선택한 서비스의 양방향 의존성 그래프가 정상 표시됩니다.
- MSA 6개 서비스 토폴로지가 노드 그래프로 시각화됩니다.

### 재발 방지 조치

같은 실수를 다시 하지 않도록 내부 문서 세 곳을 업데이트했습니다.

- `monitoring-pitfalls.md`의 serviceMap 쿼리 섹션을 TraceQL → PromQL로 수정하고 올바른 문법 예시를 추가했습니다.
- `rules/monitoring.md`의 Quick Reference에 serviceMap PromQL 규칙을 추가했고, 절대 금지 항목에 "serviceMapQuery에 TraceQL 문법 사용"을 명시했습니다.
- 핵심 원칙으로 "`serviceMapQuery` 레이블 키는 `[\w_]+`만 허용(점·하이픈 불가)"을 문서화했습니다.

---

## 📚 배운 점

- **필드 이름이 Tempo처럼 생겼다고 TraceQL 문법이 통하는 것은 아닙니다.** `queryType: "serviceMap"`이어도 `serviceMapQuery`는 PromQL 레이블 매처로 해석됩니다. 플러그인 구현을 따라가 보면 문자열을 PromQL 쿼리에 그대로 이어붙이는 구조이기 때문입니다.
- **데이터소스 필드는 문서보다 소스코드가 빠릅니다.** Grafana datasource.ts에서 `rate(${metric}${serviceMapQuery}[$__range])` 한 줄을 확인한 것만으로 원인이 즉시 드러났습니다. 필드 의미가 애매할 때는 플러그인 코드를 직접 보는 편이 빠릅니다.
- **PromQL 레이블명은 `[a-zA-Z_][a-zA-Z0-9_]*`만 허용합니다.** OTel의 `resource.service.name`처럼 점이 섞인 속성은 메트릭으로 내려올 때 이미 변환되어 있습니다. Tempo `metrics_generator`가 만드는 `traces_service_graph_*`의 경우 `client`, `server`, `connection_type` 세 개만 쓸 수 있습니다.
- **양방향 그래프는 배열로 OR**. Grafana `serviceMapQuery`는 문자열 하나 대신 배열을 받을 수 있고, 여러 매처를 내부적으로 OR로 합칩니다. caller/callee를 한 변수로 필터링할 때 유용한 패턴입니다.
- **"MSA 전까지 보류"한 에러는 반드시 쌓입니다.** 대시보드 에러를 잠시 무시하는 것은 자주 있는 선택이지만, 전환이 끝날 즈음이면 누적 부담이 됩니다. 전환 전에 한 번 훑어두는 편이 좋습니다.
