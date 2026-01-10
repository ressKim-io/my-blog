# Production 트러블슈팅 V8 - OTEL Monitoring V3 (2026-01-05)

## 개요

이 문서는 OpenTelemetry 기반 Monitoring V3 구축 과정에서 발생하는 문제와 해결 방법을 다룹니다.

---

## 1. OTEL Collector 아키텍처

### 1.1 현재 구조

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
        │ (Traces) │           │(Metrics) │           │(Dashboards)│
        └──────────┘           └──────────┘           └──────────┘
```

### 1.2 핵심 컴포넌트 버전

| Component | Version | 역할 |
|-----------|---------|------|
| OTEL Collector | v0.114.0 | Gateway 패턴 수집기 |
| Tempo | v2.9.0 | 분산 트레이싱 백엔드 |
| Prometheus | v2.47.0+ | 메트릭 저장소 |
| Grafana | v10.x | 시각화 |

---

## 2. Span Metrics Connector 문제 해결

### 2.1 메트릭이 생성되지 않음

**증상**:
```bash
# 쿼리 결과 없음
curl "http://localhost:8080/api/monitoring/prometheus/api/v1/query?query=traces_spanmetrics_calls_total"
# {"status":"success","data":{"resultType":"vector","result":[]}}
```

**원인 1**: Prometheus Remote Write 비활성화

```bash
# 확인
kubectl get deploy prometheus -n wealist-prod -o yaml | grep -A5 args
```

**해결**:
```yaml
# k8s/helm/charts/wealist-monitoring/templates/prometheus/deployment.yaml
spec:
  containers:
    - args:
        - --web.enable-remote-write-receiver  # 추가
```

**원인 2**: OTEL Collector 파이프라인 설정 오류

```bash
# OTEL Collector 로그 확인
kubectl logs deploy/otel-collector -n wealist-prod --tail=100 | grep -i error
```

**해결**: ConfigMap에 파이프라인 연결 확인

```yaml
service:
  pipelines:
    traces:
      exporters: [otlp/tempo, spanmetrics]  # spanmetrics 추가
    metrics/spanmetrics:
      receivers: [spanmetrics]
      exporters: [prometheusremotewrite]
```

### 2.2 Histogram 단위 불일치

**증상**: Grafana에서 지연 시간이 비정상적으로 크게 표시

**원인**: 기본 단위가 `ms`이지만 Grafana는 `s`를 기대

**해결**:
```yaml
connectors:
  spanmetrics:
    histogram:
      unit: s  # ms → s 변경
```

### 2.3 Dimension 누락

**증상**: 서비스별로 그룹화가 안 됨

**원인**: `dimensions` 설정 누락

**해결**:
```yaml
connectors:
  spanmetrics:
    dimensions:
      - name: service.name        # 필수
      - name: http.method
      - name: http.status_code
      - name: http.route          # 엔드포인트별 분석용
```

---

## 3. Service Graph Connector 문제 해결

### 3.1 서비스 그래프가 비어 있음

**증상**: `traces_service_graph_request_total` 메트릭 없음

**원인**: parent-child span 관계가 없음

**확인**:
```bash
# Tempo에서 트레이스 확인
curl "http://localhost:8080/api/monitoring/tempo/api/search?q={}" | jq
```

**해결**: Go 서비스에서 span context 전파 확인

```go
// 올바른 HTTP 클라이언트 계측
import "go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"

client := &http.Client{
    Transport: otelhttp.NewTransport(http.DefaultTransport),
}
```

### 3.2 Store TTL 초과

**증상**: 서비스 그래프가 간헐적으로 나타남

**원인**: `store.ttl`이 너무 짧음

**해결**:
```yaml
connectors:
  servicegraph:
    store:
      ttl: 5m        # 2m → 5m
      max_items: 50000  # 10000 → 50000
```

---

## 4. Prometheus Remote Write 문제 해결

### 4.1 연결 거부

**증상**:
```
Error exporting items, retrying...
connection refused to prometheus:9090/api/v1/write
```

**원인**: Prometheus URL 오류 또는 Remote Write 비활성화

**확인**:
```bash
# Prometheus 서비스 확인
kubectl get svc prometheus -n wealist-prod

# Remote Write 엔드포인트 테스트
kubectl exec deploy/otel-collector -n wealist-prod -- \
  curl -v http://prometheus:9090/api/v1/write
```

**해결**:
```yaml
# OTEL Collector ConfigMap
exporters:
  prometheusremotewrite:
    endpoint: http://prometheus:9090/api/v1/write
    # 또는 서비스 FQDN 사용
    # endpoint: http://prometheus.wealist-prod.svc.cluster.local:9090/api/v1/write
```

### 4.2 인증 오류 (Production)

**증상**:
```
status code: 401, response: Unauthorized
```

**원인**: AWS Managed Prometheus 사용 시 SigV4 인증 필요

**해결**:
```yaml
exporters:
  prometheusremotewrite:
    endpoint: https://aps-workspaces.{region}.amazonaws.com/workspaces/{workspace_id}/api/v1/remote_write
    auth:
      authenticator: sigv4auth
extensions:
  sigv4auth:
    region: ap-northeast-2
    service: aps
```

---

## 5. Tempo 트레이스 문제 해결

### 5.1 트레이스가 저장되지 않음

**증상**: Grafana Explore에서 트레이스 검색 결과 없음

**확인**:
```bash
# Tempo 로그 확인
kubectl logs deploy/tempo -n wealist-prod --tail=100

# OTEL Collector → Tempo 연결 확인
kubectl exec deploy/otel-collector -n wealist-prod -- \
  wget -q -O - http://tempo:4317
```

**원인 1**: OTLP 포트 불일치

| Protocol | Port |
|----------|------|
| gRPC | 4317 |
| HTTP | 4318 |

**해결**:
```yaml
exporters:
  otlp/tempo:
    endpoint: tempo:4317  # gRPC
    tls:
      insecure: true
```

**원인 2**: Tempo 스토리지 용량 초과

```bash
# PVC 사용량 확인
kubectl exec deploy/tempo -n wealist-prod -- df -h /var/tempo
```

### 5.2 Metrics Generator 메트릭 없음

**증상**: Tempo Metrics Generator가 활성화되어 있지만 메트릭 없음

**원인**: remote_write URL 설정 오류

**확인**:
```bash
kubectl get configmap tempo -n wealist-prod -o yaml | grep -A10 metrics_generator
```

**해결**:
```yaml
# Tempo ConfigMap
metrics_generator:
  enabled: true
  storage:
    path: /var/tempo/generator
  remote_write:
    - url: http://prometheus:9090/api/v1/write
  processor:
    span_metrics:
      enable_target_info: true
    service_graphs:
      enabled: true
```

---

## 6. Grafana 대시보드 문제 해결

### 6.1 데이터소스 연결 실패

**증상**: "Error: Data source is not configured correctly"

**확인**:
```bash
# 데이터소스 목록
kubectl exec deploy/grafana -n wealist-prod -- \
  curl -s http://localhost:3000/api/datasources | jq
```

**해결**: ConfigMap에서 데이터소스 URL 확인

```yaml
# Grafana provisioning
datasources:
  - name: Prometheus
    type: prometheus
    url: http://prometheus:9090
    access: proxy
  - name: Tempo
    type: tempo
    url: http://tempo:3200
    access: proxy
  - name: Loki
    type: loki
    url: http://loki:3100
    access: proxy
```

### 6.2 대시보드 프로비저닝 실패

**증상**: 대시보드가 Grafana에 나타나지 않음

**확인**:
```bash
# Grafana 로그
kubectl logs deploy/grafana -n wealist-prod | grep -i provision
```

**원인**: 대시보드 JSON 문법 오류

**해결**: JSON 검증
```bash
# 대시보드 JSON 검증
cat dashboard.json | jq empty
```

### 6.3 Variable 쿼리 실패

**증상**: 대시보드 드롭다운이 비어 있음

**원인**: Label 쿼리 문법 오류

**해결**:
```
# 올바른 label_values 쿼리
label_values(traces_spanmetrics_calls_total, service_name)

# 잘못된 예
label_values(service_name)  # 메트릭 이름 누락
```

---

## 7. Go 서비스 OTEL 계측 문제

### 7.1 트레이스가 생성되지 않음

**증상**: 서비스 호출해도 Tempo에 트레이스 없음

**확인**:
```bash
# 환경변수 확인
kubectl exec deploy/user-service -n wealist-prod -- env | grep OTEL

# 로그에서 OTEL 초기화 확인
kubectl logs deploy/user-service -n wealist-prod | grep -i otel
```

**원인**: OTEL SDK 초기화 안 됨

**해결**: `main.go`에서 초기화 확인

```go
import (
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
)

func initTracer() (*sdktrace.TracerProvider, error) {
    exporter, err := otlptracegrpc.New(ctx,
        otlptracegrpc.WithEndpoint("otel-collector:4317"),
        otlptracegrpc.WithInsecure(),
    )
    // ...
}
```

### 7.2 Span Context 전파 안 됨

**증상**: 서비스 간 트레이스가 연결되지 않음

**원인**: HTTP 클라이언트에서 context 전파 누락

**해결**:
```go
// Request에 span context 전파
req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)

// 또는 otelhttp 사용
import "go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"

client := &http.Client{
    Transport: otelhttp.NewTransport(http.DefaultTransport),
}
```

### 7.3 GORM/Redis 스팬 없음

**증상**: DB/Redis 호출이 트레이스에 안 보임

**해결**: 계측 라이브러리 추가

```go
// GORM 계측
import "github.com/uptrace/opentelemetry-go-extra/otelgorm"

db.Use(otelgorm.NewPlugin())

// Redis 계측
import "github.com/redis/go-redis/extra/redisotel/v9"

rdb := redis.NewClient(&redis.Options{...})
redisotel.InstrumentTracing(rdb)
```

---

## 8. 일반적인 PromQL 쿼리

### 8.1 Span Metrics 쿼리

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

# 엔드포인트별 요청 수
sum(rate(traces_spanmetrics_calls_total[5m])) by (http_route, http_method)
```

### 8.2 Service Graph 쿼리

```promql
# 서비스 간 요청 수
sum(rate(traces_service_graph_request_total[5m])) by (client, server)

# 서비스 간 에러율
sum(rate(traces_service_graph_request_failed_total[5m])) by (client, server)
/ sum(rate(traces_service_graph_request_total[5m])) by (client, server)

# 서비스 간 평균 지연
rate(traces_service_graph_request_duration_seconds_sum[5m])
/ rate(traces_service_graph_request_duration_seconds_count[5m])
```

### 8.3 SLO 쿼리

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

## 9. 디버깅 명령어 모음

### 9.1 OTEL Collector

```bash
# 로그 실시간 확인
kubectl logs -f deploy/otel-collector -n wealist-prod

# ConfigMap 확인
kubectl get configmap otel-collector-config -n wealist-prod -o yaml

# 파이프라인 상태 (내부 메트릭)
kubectl exec deploy/otel-collector -n wealist-prod -- \
  curl http://localhost:8888/metrics | grep otelcol_processor

# Exporter 성공/실패 카운트
kubectl exec deploy/otel-collector -n wealist-prod -- \
  curl http://localhost:8888/metrics | grep otelcol_exporter
```

### 9.2 Tempo

```bash
# 트레이스 검색
curl "http://localhost:8080/api/monitoring/tempo/api/search?q={}"

# 특정 트레이스 조회
curl "http://localhost:8080/api/monitoring/tempo/api/traces/{traceID}"

# Tempo 상태
kubectl exec deploy/tempo -n wealist-prod -- curl http://localhost:3200/ready
```

### 9.3 Prometheus

```bash
# 메트릭 이름 목록
curl "http://localhost:8080/api/monitoring/prometheus/api/v1/label/__name__/values" | jq -r '.data[]' | grep traces

# 특정 메트릭 쿼리
curl "http://localhost:8080/api/monitoring/prometheus/api/v1/query?query=traces_spanmetrics_calls_total" | jq

# Remote Write 수신 상태
curl "http://localhost:8080/api/monitoring/prometheus/api/v1/status/runtimeinfo" | jq
```

---

## 10. V3 대시보드 구조

### 10.1 디렉토리 레이아웃

```
k8s/helm/charts/wealist-monitoring/dashboards-v3/
├── otel-native/                    # OTEL Collector 메트릭
│   ├── otel-overview.json          # Collector 상태
│   ├── otel-traces.json            # 트레이스 분석
│   ├── otel-span-metrics.json      # RED 메트릭
│   └── otel-service-graph.json     # 서비스 의존성
├── application/                    # 애플리케이션 관측성
│   ├── app-red-metrics.json        # Request/Error/Duration
│   ├── app-golden-signals.json     # Golden Signals
│   ├── app-endpoint-analysis.json  # 엔드포인트별
│   └── app-database-tracing.json   # DB/Redis 스팬
├── logs/                           # 로그
│   ├── logs-explorer.json          # Loki 로그 탐색
│   ├── logs-service-view.json      # 서비스별 로그
│   └── traces-logs-correlation.json # 트레이스↔로그
└── slo/                            # SLO
    ├── slo-overview.json           # Error Budget
    ├── slo-burndown.json           # Burn Rate
    └── slo-endpoint-sli.json       # 엔드포인트별 SLI
```

### 10.2 대시보드 프로비저닝

```yaml
# k8s/helm/charts/wealist-monitoring/templates/grafana/configmap.yaml
data:
  dashboards.yaml: |
    apiVersion: 1
    providers:
      - name: 'v3-otel-native'
        folder: 'OTEL Native'
        type: file
        options:
          path: /var/lib/grafana/dashboards/v3/otel-native
      - name: 'v3-application'
        folder: 'Application'
        type: file
        options:
          path: /var/lib/grafana/dashboards/v3/application
```

---

## 요약

| 문제 유형 | 주요 원인 | 해결 방법 |
|----------|----------|----------|
| Span Metrics 없음 | Remote Write 비활성화 | `--web.enable-remote-write-receiver` |
| Service Graph 없음 | Span context 전파 누락 | `otelhttp.NewTransport` 사용 |
| Remote Write 실패 | 잘못된 URL 또는 인증 | 서비스 URL 및 SigV4 확인 |
| 트레이스 없음 | OTEL SDK 미초기화 | `initTracer()` 호출 확인 |
| 대시보드 없음 | JSON 문법 오류 | `jq empty`로 검증 |
| Variable 빈 값 | label_values 문법 | 메트릭 이름 포함 필수 |
