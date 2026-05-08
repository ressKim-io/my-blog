---
title: "모니터링 수집 파이프라인 우선순위 6건 일괄 수정 — Istio·OTel·k6·pgxpool"
excerpt: "EMPTY 411건 중 metric 자체 미수집 289건을 우선순위 6건으로 분리해 순차 처리. Istio bucket regex·OTel service_name·spanmetricsconnector·k6 remote_write·pgxpool 통계까지 한 세션에 처리한 기록입니다"
type: troubleshooting
category: monitoring
tags:
  - go-ti
  - OpenTelemetry
  - Istio
  - Mimir
  - dashboard
  - verify script
  - troubleshooting
series:
  name: "goti-otel-instrumentation"
  order: 1
date: "2026-04-25"
---

## 한 줄 요약

> verify 스크립트가 EMPTY 411건을 보고한 시점에서 metric 자체 미수집(289건)만 우선순위 6건으로 분리하고, Istio ServiceMonitor 라벨·bucket regex 수정부터 pgxpool OTel export 구현까지 순차 처리해 OK 191 → 216(+13%)을 달성한 세션 기록입니다.

---

## 🔥 문제: verify 스크립트 EMPTY 411건 — 어디서부터 손댈 것인가

대시보드 검증 세션에서 verify 스크립트를 실행하자 결과가 아래와 같이 나왔습니다.

```text
OK: 191
EMPTY (metric 미수집 + 라벨 불일치 합계): 411
ERROR: 23
```

문제는 분류가 없다는 점이었습니다. 411건이 모두 같은 `EMPTY` 버킷에 묶여 있어, 실제로 **metric 자체가 Mimir에 들어오지 않는 건지(수집 파이프라인 문제)** 아니면 **metric은 있는데 dashboard selector가 잘못된 건지(라벨 불일치)** 구분이 안 됐습니다.

파이프라인 문제를 먼저 해결해야 dashboard 정리가 의미 있으므로, 먼저 분류 기준을 정해 우선순위를 정리했습니다.

---

## 🤔 원인: 분류 없는 EMPTY가 문제 범위를 가렸음 + 6가지 파이프라인 결함

### verify 스크립트 v2로 3분류 분리

우선 스크립트 자체를 개선했습니다. EMPTY를 세 가지로 쪼갠 결과가 아래 표입니다.

| 분류 | 의미 | 건수 |
|---|---|---|
| `MISSING` | Mimir에 metric 자체 없음 | 289 |
| `LABEL_MISMATCH` | metric은 있으나 dashboard selector 불일치 | 88 |
| `EMPTY` | metric도 있고 라벨도 맞는데 값이 비어있음 | 34 |

289건 `MISSING`이 **수집 파이프라인을 먼저 고쳐야 할 대상**이었습니다.

### 파이프라인 결함 6가지

분류 적용 후 원인을 하나씩 추적한 결과, 아래 표의 6가지 결함이 나왔습니다.

| # | 항목 | 실제 원인 | 영향 범위 |
|---|---|---|---|
| 1 | Istio ServiceMonitor 라벨 불일치 | `release: kube-prometheus-stack-dev`로 적혀 있으나 실제 release name은 `kps` → scrape pool 미생성 | envoy sidecar metric 0건 |
| 2 | PodMonitor bucket regex `_seconds_` 가정 | Istio 1.29 기본 단위가 `_milliseconds_`로 변경됨 → duration metric 전부 drop | istio_request_duration_* 0건 |
| 3 | spanmetricsconnector 미설정 | OTel collector config에 connector 블록 없음 | span_metrics_* 0건 |
| 4 | k6 synthetic traffic chart에 prometheus output 옵션 없음 | Helm values에 `output.prometheus` 미지정 → Mimir remote_write 미연결 | k6_* 0건 |
| 5 | Go `pkg/database` OTel pool stats export 미구현 | pgxpool instrumentation 코드 없음 | db_client_connections_* 0건 |
| 6 | Tempo metricsGenerator K8s deployment 비활성 | runtime config에서는 활성이지만 top-level deployment 플래그 false | service_graph metric 0건 (P6.5 후속) |

결함 #1~#2는 chart 작성 시점에 release name과 metric 단위를 머릿속에서 가정하고 코드에 명시하지 않았기 때문입니다. 선행 지식이 암묵적으로 흘러가 검증 없이 배포된 전형적인 `context-missing` 패턴이었습니다.

결함 #3·#5는 dashboard에서 가정한 metric source가 실제로 파이프라인에 없는 `dependency-unknown` 패턴이고, 결함 #5는 여기에 더해 SDK 레이어까지 직접 구현해야 하는 `wrong-layer` 패턴이었습니다.

---

## ✅ 해결: 우선순위 순서대로 6건 처리

### P1 — Istio bucket regex + ServiceMonitor 라벨 수정

`release` 라벨을 `kps`로 교정하고, PodMonitor의 keep regex를 `_milliseconds_` 단위로 맞췄습니다.

```yaml
# ServiceMonitor 라벨 수정 (before → after)
labels:
  release: kps   # kube-prometheus-stack-dev → kps
```

처리 결과: `istio_request_duration_milliseconds_*`, `istio_request_bytes_*`, `istio_response_bytes_*` 등 12종 Mimir 수집 확인.

### P2 — Istio metric에 OTel 표준 service_name 라벨 부여

reporter 방향별 workload를 `service_name`으로 매핑하는 레이블링 규칙을 추가했습니다.

```yaml
# MetricRelabelConfig 예시 (reporter=source 방향)
- sourceLabels: [source_workload]
  targetLabel: service_name
  regex: "goti-(.*)-dev"
  replacement: "goti-${1}-go"
```

이로써 `goti-XXX-dev` workload 이름이 `goti-XXX-go` 형태의 OTel 표준 `service_name`으로 정규화됩니다. dashboard 쿼리가 Istio metric과 OTel trace metric 양쪽에서 동일한 `service_name`으로 조인할 수 있게 됩니다.

### P2.5 — verify 스크립트 v2 (false positive 제거 + 3분류)

`MISSING / LABEL_MISMATCH / EMPTY` 3분류를 적용하고 false positive를 제거했습니다. 이 시점부터 숫자가 비로소 신뢰할 수 있는 상태가 됐습니다.

### P3 — OTel spanmetricsconnector 활성화

`otel-collector-back/dev` values에 connector 블록을 추가했습니다.

```yaml
# OTel Collector config
connectors:
  spanmetrics:
    histogram:
      explicit:
        buckets: [2ms, 4ms, 6ms, 8ms, 10ms, 50ms, 100ms, 200ms, 400ms, 800ms, 1s, 1400ms, 2s, 5s, 10s, 15s]
    dimensions:
      - name: http.method
      - name: http.status_code
      - name: service.name
```

처리 결과: `span_metrics_calls_total`, `span_metrics_duration_seconds_{bucket,count,sum}` 4종 수집 확인.

### P4 — k6 synthetic traffic Mimir remote_write 연결

k6 Helm chart values에 prometheus output 옵션을 추가했습니다.

```yaml
# synthetic-traffic chart values
testConfig:
  output:
    prometheus:
      enabled: true
      address: "http://mimir-nginx.monitoring:80/api/v1/push"
```

처리 결과: `k6_http_reqs`, `k6_http_req_duration_p95`, `k6_http_req_duration_p99` 등 k6 계열 63종 수집 확인.

### P5 — Go pgxpool OTel metric export 구현

`pkg/database`에 pgxpool stats를 OTel MeterProvider로 export하는 코드를 추가했습니다.

처리 결과: `db_client_connections_usage`, `db_client_connections_max`, `db_client_connections_pending_requests`, `db_client_connections_idle_max`, `db_client_connections_idle_min` 5종 수집 확인.

### P6 — dashboard 일괄 OTel 표준 정리 (부분 완료)

dashboard JSON의 라벨 selector를 OTel 표준으로 정리하기 시작했습니다. Tempo metrics-generator deployment도 활성화 시도를 포함했습니다. 다만 panel별 컨텍스트가 제각각이라 JSON 라벨 정리 전체는 별도 PR로 분리했습니다.

P6.5(`distributor → metrics-generator forwarding`) 디버깅에서 generator pod는 기동됐으나 `service_graph` metric이 미생성 상태입니다. ring config 또는 distributor forwarding flag 문제로 추정되며 후속 작업이 필요합니다.

---

## verify 스크립트 추이

| 단계 | OK | MISSING | LABEL_MISMATCH | EMPTY | ERROR |
|---|---|---|---|---|---|
| 시작 | 191 | (411 합계) | — | — | 23 |
| P1 후 | 191 | 411 (구버전 EMPTY) | — | — | 23 |
| P2.5 후 (3분류 적용) | 191 | 289 | 88 | 34 | 23 |
| P2 후 | 191 | 289 | 88 | 34 | 23 |
| P3 후 | 199 | 255 | 114 | 34 | 23 |
| P4 후 | 206 | 229 | 133 | 34 | 23 |
| P5 후 | 216 | 218 | 134 | 34 | 23 |

**OK 191 → 216 (+25, +13%) / MISSING 289 → 218 (-71, -25%)**

P3~P5 이후로 `LABEL_MISMATCH`가 오히려 늘어난 이유가 있습니다. 신규 metric이 Mimir에 들어오기 시작하면서 이전에는 `MISSING`으로 분류되던 항목들이 `LABEL_MISMATCH`로 재분류된 것입니다. 숫자가 늘어난 게 아니라 분류가 정교해진 것이므로 정상적인 흐름입니다.

---

## 후속 과제

### P6 잔여

`LABEL_MISMATCH` 134건은 dashboard JSON의 라벨 selector를 panel별로 정리해야 합니다. 주요 대상은 아래와 같습니다.

- `istio` dashboard의 `destination_service`/`destination_workload` selector → OTel 표준 `service_name`으로 통일 (PoC 1개 후 일괄)
- `jvm_*`, `HikariCP_*`, `cloudflare_*` 등 영구 사라진 panel 처리

### P6.5 (Tempo metrics-generator forwarding)

distributor → metrics-generator forwarding이 안 됩니다. generator pod는 기동됐지만 trace를 받지 못하는 상태입니다. ring config와 distributor forwarding flag 양쪽을 확인해야 합니다.

### P7 (release 라벨 전수 수정)

현재 `release: kube-prometheus-stack-dev`로 잘못 작성된 ServiceMonitor/PodMonitor가 미설치 chart들에 여전히 남아 있습니다. 설치 시 동일 문제가 재발하므로 일괄 수정이 필요합니다.

---

## 📚 배운 점

| 패턴 | 빈도 | 대응 |
|---|---|---|
| chart values에서 release name·단위를 암묵적으로 가정 (`context-missing`) | 3건 | Helm install 직후 verify 스크립트로 cross-check |
| dashboard 작성 시 수집 파이프라인을 가정하고 코드에 반영 안 함 (`dependency-unknown`) | 2건 | dashboard 작성 전 expected metric 카탈로그를 spec으로 먼저 작성 |
| dashboard에 OTel 표준 metric이 있는데 SDK export가 없음 (`wrong-layer`) | 1건 | 부하 도구 chart는 dev 환경에서 metric output 옵션 default enable |

세 가지 패턴을 요약하면 하나의 공통 원인으로 귀결됩니다. **"dashboard가 가정하는 것을 코드·chart·SDK가 실제로 해주고 있는지 검증하는 루프"가 없었습니다.** verify 스크립트가 이 루프의 첫 번째 체계적인 장치가 됩니다.

`MISSING → LABEL_MISMATCH → EMPTY` 3분류 구조는 앞으로도 "지금 무엇을 고쳐야 하는가"를 빠르게 결정하는 데 유용하게 쓰일 것입니다.
