---
title: "트레이스에서 메트릭 자동 생성: OpenTelemetry Connectors 활용"
excerpt: "OTEL Collector의 spanmetrics, servicegraph connector로 분산 트레이싱과 메트릭을 통합하는 방법"
category: monitoring
tags:
  - OpenTelemetry
  - Observability
  - Prometheus
  - Tempo
  - Grafana
  - Monitoring
  - concept
series:
  name: "observability"
  order: 1
date: '2026-01-05'
---

## 한 줄 요약

> 트레이스 데이터에서 RED 메트릭(Rate, Error, Duration)을 자동 생성합니다. OTEL Collector의 spanmetrics connector가 핵심입니다.

## Impact

- **목표**: 코드 수정 없이 모든 서비스의 메트릭 자동 수집
- **결과**: Trace → Metrics 자동 변환
- **소요 시간**: 약 6시간
- **발생일**: 2026-01-05

---

## 아키텍처

### OTEL Collector Gateway 패턴

```
┌─────────────────┐      ┌─────────────────────────────────────┐
│   Go Services   │─────▶│         OTEL Collector              │
│ (OTLP Exporter) │      │  ┌───────────────────────────────┐  │
└─────────────────┘      │  │ Receivers: otlp               │  │
                         │  └───────────────────────────────┘  │
                         │  ┌───────────────────────────────┐  │
                         │  │ Connectors:                   │  │
                         │  │   - spanmetrics               │  │
                         │  │   - servicegraph              │  │
                         │  └───────────────────────────────┘  │
                         │  ┌───────────────────────────────┐  │
                         │  │ Exporters:                    │  │
                         │  │   - otlp/tempo                │  │
                         │  │   - prometheusremotewrite     │  │
                         │  └───────────────────────────────┘  │
                         └─────────────────────────────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
        ┌──────────┐           ┌──────────┐           ┌──────────┐
        │  Tempo   │           │Prometheus│           │ Grafana  │
        │ (Traces) │           │(Metrics) │           │(Dashboard│
        └──────────┘           └──────────┘           └──────────┘
```

### 핵심 컴포넌트

| Component | Version | 역할 |
|-----------|---------|------|
| OTEL Collector | v0.114.0 | Gateway 패턴 수집기 |
| Tempo | v2.9.0 | 분산 트레이싱 백엔드 |
| Prometheus | v2.47.0+ | 메트릭 저장소 |
| Grafana | v10.x | 시각화 |

---

## 🔥 문제 1: Span Metrics가 생성되지 않습니다

### 증상

```bash
$ curl "http://prometheus:9090/api/v1/query?query=traces_spanmetrics_calls_total"
{"status":"success","data":{"resultType":"vector","result":[]}}
```

spanmetrics connector를 설정했는데 메트릭이 없습니다.

### 원인 1: Prometheus Remote Write 비활성화

```bash
$ kubectl get deploy prometheus -n wealist-prod -o yaml | grep -A5 args
```

Prometheus에 `--web.enable-remote-write-receiver` 플래그가 없었습니다.

### 해결 1: Remote Write 활성화

```yaml
# prometheus/deployment.yaml
spec:
  containers:
    - args:
        - --web.enable-remote-write-receiver  # 추가
        - --config.file=/etc/prometheus/prometheus.yml
```

### 원인 2: 파이프라인 연결 누락

OTEL Collector 로그를 확인해봤습니다:

```bash
$ kubectl logs deploy/otel-collector -n wealist-prod | grep -i error
```

traces 파이프라인에서 spanmetrics exporter로 연결이 안 되어 있었습니다.

### 해결 2: 파이프라인 연결

```yaml
# otel-collector-config.yaml
service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [otlp/tempo, spanmetrics]  # spanmetrics 추가!
    metrics/spanmetrics:
      receivers: [spanmetrics]
      exporters: [prometheusremotewrite]
```

**핵심**: `spanmetrics`는 exporter가 아니라 **connector**입니다. traces 파이프라인의 출력이 metrics 파이프라인의 입력이 됩니다.

---

## 🔥 문제 2: Histogram 단위가 이상합니다

### 증상

Grafana에서 지연 시간이 비정상적으로 크게 표시됩니다. 1초 걸리는 요청이 1000으로 표시됩니다.

### 원인

spanmetrics의 기본 단위가 `ms`이지만, Grafana의 표준 단위는 `s`입니다.

### 해결

```yaml
connectors:
  spanmetrics:
    histogram:
      unit: s  # ms → s 변경
      explicit:
        buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
```

---

## 🔥 문제 3: Service Graph가 비어 있습니다

### 증상

`traces_service_graph_request_total` 메트릭이 없습니다. 서비스 의존성 그래프를 그릴 수 없습니다.

### 원인

Service Graph는 **parent-child span 관계**가 있어야 생성됩니다. 서비스 간 호출에서 span context가 전파되지 않으면 그래프가 만들어지지 않습니다.

### 확인

```bash
# Tempo에서 트레이스 확인
$ curl "http://tempo:3200/api/search?q={}" | jq

# 트레이스에 parent span이 있는지 확인
```

### 해결: Go HTTP 클라이언트 계측

```go
import "go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"

// 올바른 HTTP 클라이언트 계측
client := &http.Client{
    Transport: otelhttp.NewTransport(http.DefaultTransport),
}

// 또는 Request에 context 전파
req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
```

`otelhttp.NewTransport`를 사용하면 HTTP 요청 시 자동으로 trace context가 전파됩니다.

---

## OTEL Collector 전체 설정

### connectors 섹션

```yaml
connectors:
  spanmetrics:
    namespace: traces
    histogram:
      unit: s
      explicit:
        buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
    dimensions:
      - name: service.name
      - name: http.method
      - name: http.status_code
      - name: http.route
    exemplars:
      enabled: true

  servicegraph:
    latency_histogram_buckets: [0.01, 0.05, 0.1, 0.5, 1, 5]
    dimensions:
      - service.name
    store:
      ttl: 5m
      max_items: 50000
```

### exporters 섹션

```yaml
exporters:
  otlp/tempo:
    endpoint: tempo:4317
    tls:
      insecure: true

  prometheusremotewrite:
    endpoint: http://prometheus:9090/api/v1/write
    resource_to_telemetry_conversion:
      enabled: true
```

### service 섹션

```yaml
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp/tempo, spanmetrics, servicegraph]

    metrics/spanmetrics:
      receivers: [spanmetrics]
      exporters: [prometheusremotewrite]

    metrics/servicegraph:
      receivers: [servicegraph]
      exporters: [prometheusremotewrite]
```

---

## PromQL 쿼리 예시

### RED 메트릭 (Rate, Error, Duration)

```promql
# 서비스별 요청 수 (Rate)
sum(rate(traces_spanmetrics_calls_total[5m])) by (service_name)

# 서비스별 에러율
sum(rate(traces_spanmetrics_calls_total{status_code="STATUS_CODE_ERROR"}[5m])) by (service_name)
/ sum(rate(traces_spanmetrics_calls_total[5m])) by (service_name)

# P95 지연 시간
histogram_quantile(0.95,
  sum(rate(traces_spanmetrics_duration_seconds_bucket[5m])) by (service_name, le)
)
```

### Service Graph 쿼리

```promql
# 서비스 간 요청 수
sum(rate(traces_service_graph_request_total[5m])) by (client, server)

# 서비스 간 에러율
sum(rate(traces_service_graph_request_failed_total[5m])) by (client, server)
/ sum(rate(traces_service_graph_request_total[5m])) by (client, server)
```

### SLO 쿼리

```promql
# 가용성 SLO (99.9%)
(1 - (
  sum(rate(traces_spanmetrics_calls_total{status_code="STATUS_CODE_ERROR"}[1h]))
  / sum(rate(traces_spanmetrics_calls_total[1h]))
)) * 100

# P99 지연 SLO (< 500ms)
histogram_quantile(0.99,
  sum(rate(traces_spanmetrics_duration_seconds_bucket[1h])) by (le)
) < 0.5
```

---

## Go 서비스 계측 체크리스트

### 필수 계측

```go
// 1. OTEL SDK 초기화
func initTracer() (*sdktrace.TracerProvider, error) {
    exporter, err := otlptracegrpc.New(ctx,
        otlptracegrpc.WithEndpoint("otel-collector:4317"),
        otlptracegrpc.WithInsecure(),
    )
    // ...
}

// 2. HTTP 서버 계측
handler := otelhttp.NewHandler(router, "server")

// 3. HTTP 클라이언트 계측
client := &http.Client{
    Transport: otelhttp.NewTransport(http.DefaultTransport),
}
```

### DB/Redis 계측

```go
// GORM 계측
import "github.com/uptrace/opentelemetry-go-extra/otelgorm"
db.Use(otelgorm.NewPlugin())

// Redis 계측
import "github.com/redis/go-redis/extra/redisotel/v9"
redisotel.InstrumentTracing(rdb)
```

---

## 디버깅 명령어

### OTEL Collector

```bash
# 로그 실시간 확인
kubectl logs -f deploy/otel-collector -n wealist-prod

# Exporter 성공/실패 카운트
kubectl exec deploy/otel-collector -n wealist-prod -- \
  curl http://localhost:8888/metrics | grep otelcol_exporter
```

### Prometheus

```bash
# spanmetrics 메트릭 확인
curl "http://prometheus:9090/api/v1/label/__name__/values" | jq -r '.data[]' | grep traces

# 특정 메트릭 쿼리
curl "http://prometheus:9090/api/v1/query?query=traces_spanmetrics_calls_total" | jq
```

### Tempo

```bash
# 트레이스 검색
curl "http://tempo:3200/api/search?q={}"

# 특정 트레이스 조회
curl "http://tempo:3200/api/traces/{traceID}"
```

---

## 📚 배운 점

### Connector vs Exporter

OTEL Collector에서 spanmetrics와 servicegraph는 **connector**입니다. Exporter가 아닙니다.

- **Exporter**: 데이터를 외부로 내보냄 (Prometheus, Tempo 등)
- **Connector**: 파이프라인 간 데이터를 변환 (traces → metrics)

따라서 spanmetrics는 `traces pipeline → spanmetrics connector → metrics pipeline → prometheusremotewrite` 흐름으로 연결됩니다.

### Span Context 전파의 중요성

Service Graph가 작동하려면 서비스 간 호출에서 **trace context가 전파**되어야 합니다. HTTP 클라이언트에 `otelhttp.NewTransport`를 사용해야 합니다.

### Remote Write 활성화 필수

Prometheus에서 OTEL Collector의 메트릭을 받으려면 `--web.enable-remote-write-receiver` 플래그가 필요합니다.

---

## 요약

| 문제 | 원인 | 해결 |
|------|------|------|
| Span Metrics 없음 | Remote Write 비활성화 | `--web.enable-remote-write-receiver` |
| 파이프라인 연결 안 됨 | spanmetrics exporter 누락 | traces → spanmetrics 연결 |
| Histogram 단위 이상 | 기본값 ms | `unit: s` 설정 |
| Service Graph 없음 | Context 전파 누락 | `otelhttp.NewTransport` 사용 |

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `k8s/helm/charts/wealist-monitoring/templates/otel-collector/configmap.yaml` | OTEL Collector 설정 |
| `k8s/helm/charts/wealist-monitoring/templates/prometheus/deployment.yaml` | Prometheus 배포 |
| `packages/wealist-advanced-go-pkg/otel/otel.go` | Go OTEL 초기화 |

---

## 참고

- [OpenTelemetry Collector Contrib - spanmetrics](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/connector/spanmetricsconnector)
- [OpenTelemetry Collector Contrib - servicegraph](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/connector/servicegraphconnector)
- [Prometheus Remote Write](https://prometheus.io/docs/prometheus/latest/configuration/configuration/#remote_write)
