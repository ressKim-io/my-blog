---
title: "Istio Observability Part 1: 코드 수정 없이 메트릭 수집하기"
excerpt: "Istio가 자동으로 수집하는 메트릭과 Prometheus, Grafana를 활용한 모니터링"
category: "kubernetes"
tags: ["istio", "observability", "metrics", "prometheus", "grafana", "kubernetes"]
series:
  name: "istio-observability"
  order: 1
date: "2024-12-24"
---

## 🎯 시작하며

istio-traffic 시리즈에서 트래픽 관리를 배웠습니다. 이제 **관측성(Observability)** 시리즈를 시작합니다. Istio의 가장 강력한 장점 중 하나는 **코드 수정 없이** 메트릭, 트레이싱, 로그를 자동으로 수집한다는 것입니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                   Observability의 3가지 축                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   1. Metrics (메트릭)        이번 Part에서 다룸                 │
│      "무엇이 일어나고 있는가?"                                  │
│      - 요청 수, 에러율, 응답시간                                │
│      - Prometheus + Grafana                                     │
│                                                                 │
│   2. Tracing (트레이싱)      Part 2에서 다룸                    │
│      "요청이 어디를 거쳐갔는가?"                                │
│      - 분산 추적, Span                                          │
│      - Jaeger, Zipkin                                           │
│                                                                 │
│   3. Logging (로깅)          Part 3에서 다룸                    │
│      "무슨 일이 있었는가?"                                      │
│      - Access Log, 상세 기록                                    │
│      - Envoy Access Log                                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

학습하면서 궁금했던 것들입니다:
- Istio는 어떤 메트릭을 자동으로 수집할까?
- Golden Signals가 뭘까?
- Prometheus와 Grafana는 어떻게 연동할까?

---

## 💡 Istio 메트릭 자동 수집

### 코드 수정 없이 메트릭이 수집되는 원리

```
┌─────────────────────────────────────────────────────────────────┐
│                 Istio 메트릭 수집 원리                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   기존 방식 (애플리케이션에서 직접)                             │
│   ════════════════════════════════                              │
│                                                                 │
│   ┌─────────────────────────────────┐                           │
│   │        Application              │                           │
│   │  ┌───────────────────────────┐  │                           │
│   │  │   비즈니스 로직           │  │                           │
│   │  │   + 메트릭 코드 추가!     │  │  ← 코드 수정 필요        │
│   │  │   metrics.inc("request")  │  │                           │
│   │  └───────────────────────────┘  │                           │
│   └─────────────────────────────────┘                           │
│                                                                 │
│   Istio 방식 (Sidecar에서 자동)                                 │
│   ═════════════════════════════                                 │
│                                                                 │
│   ┌─────────────────────────────────┐                           │
│   │           Pod                   │                           │
│   │  ┌───────────────────────────┐  │                           │
│   │  │   Application             │  │  ← 코드 수정 없음!       │
│   │  │   (비즈니스 로직만)       │  │                           │
│   │  └─────────────┬─────────────┘  │                           │
│   │                │                │                           │
│   │  ┌─────────────▼─────────────┐  │                           │
│   │  │   Envoy Sidecar           │  │  ← 메트릭 자동 수집      │
│   │  │   - 요청/응답 가로채기    │  │                           │
│   │  │   - 메트릭 생성           │  │                           │
│   │  └───────────────────────────┘  │                           │
│   └─────────────────────────────────┘                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📊 Istio 기본 메트릭

### 주요 메트릭 목록

| 메트릭 | 설명 | 타입 |
|--------|------|------|
| `istio_requests_total` | 총 요청 수 | Counter |
| `istio_request_duration_milliseconds` | 요청 처리 시간 | Histogram |
| `istio_request_bytes` | 요청 바이트 크기 | Histogram |
| `istio_response_bytes` | 응답 바이트 크기 | Histogram |
| `istio_tcp_connections_opened_total` | 열린 TCP 연결 수 | Counter |
| `istio_tcp_connections_closed_total` | 닫힌 TCP 연결 수 | Counter |
| `istio_tcp_sent_bytes_total` | 전송된 TCP 바이트 | Counter |
| `istio_tcp_received_bytes_total` | 수신된 TCP 바이트 | Counter |

### istio_requests_total 레이블

```
istio_requests_total{
  # 소스 정보
  source_workload="frontend",
  source_workload_namespace="default",
  source_principal="spiffe://cluster.local/ns/default/sa/frontend",

  # 목적지 정보
  destination_workload="backend",
  destination_workload_namespace="default",
  destination_service="backend.default.svc.cluster.local",
  destination_version="v1",

  # 요청 정보
  request_protocol="http",
  response_code="200",
  response_flags="-",
  connection_security_policy="mutual_tls"
}
```

### response_flags 값들

| 플래그 | 의미 | 원인 |
|--------|------|------|
| `-` | 정상 | 에러 없음 |
| `UO` | Upstream Overflow | Connection Pool 초과 |
| `UF` | Upstream Failure | 연결 실패 |
| `URX` | Upstream Retry | 재시도 초과 |
| `NR` | No Route | 라우트 없음 |
| `RL` | Rate Limited | 속도 제한 |
| `DC` | Downstream Connection | 클라이언트 연결 끊김 |
| `UC` | Upstream Connection | 서버 연결 끊김 |

---

## 📈 Golden Signals

Google SRE 책에서 정의한 4가지 핵심 지표입니다. Istio 메트릭으로 모두 측정 가능합니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Golden Signals                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   1. Latency (지연시간)                                         │
│      ════════════════                                           │
│      "요청이 얼마나 빨리 처리되는가?"                           │
│                                                                 │
│      istio_request_duration_milliseconds                        │
│                                                                 │
│   2. Traffic (트래픽)                                           │
│      ═══════════════                                            │
│      "얼마나 많은 요청이 들어오는가?"                           │
│                                                                 │
│      rate(istio_requests_total[5m])                             │
│                                                                 │
│   3. Errors (에러)                                              │
│      ════════════                                               │
│      "얼마나 많은 요청이 실패하는가?"                           │
│                                                                 │
│      rate(istio_requests_total{response_code=~"5.."}[5m])       │
│                                                                 │
│   4. Saturation (포화도)                                        │
│      ═══════════════════                                        │
│      "시스템이 얼마나 가득 찼는가?"                             │
│                                                                 │
│      CPU, Memory, Connection Pool 사용량                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔧 Prometheus 연동

### Prometheus 설치

```bash
# Istio 애드온으로 설치
$ kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.20/samples/addons/prometheus.yaml

# 확인
$ kubectl get pods -n istio-system -l app=prometheus
```

### Prometheus가 메트릭을 수집하는 방식

```
┌─────────────────────────────────────────────────────────────────┐
│                 Prometheus 메트릭 수집                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────┐                                               │
│   │ Prometheus  │                                               │
│   │             │                                               │
│   │  scrape:    │                                               │
│   │  - targets  │                                               │
│   └──────┬──────┘                                               │
│          │                                                      │
│          │  GET /stats/prometheus (15초마다)                    │
│          │                                                      │
│   ┌──────┼───────────────────────────────────────┐              │
│   │      ▼                                       │              │
│   │  ┌─────────────────────────────────────┐     │              │
│   │  │          Envoy Sidecar              │     │              │
│   │  │  :15090/stats/prometheus            │     │  Pod         │
│   │  │                                     │     │              │
│   │  │  istio_requests_total{...} 1234    │     │              │
│   │  │  istio_request_duration_ms{...}    │     │              │
│   │  └─────────────────────────────────────┘     │              │
│   │                                              │              │
│   │  ┌─────────────────────────────────────┐     │              │
│   │  │          Application                │     │              │
│   │  └─────────────────────────────────────┘     │              │
│   └──────────────────────────────────────────────┘              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 주요 PromQL 쿼리

#### 1. 요청량 (QPS)

```promql
# 전체 요청량
sum(rate(istio_requests_total[5m]))

# 서비스별 요청량
sum(rate(istio_requests_total[5m])) by (destination_service)

# 버전별 요청량
sum(rate(istio_requests_total[5m])) by (destination_version)
```

#### 2. 에러율

```promql
# 전체 5xx 에러율
sum(rate(istio_requests_total{response_code=~"5.."}[5m]))
/
sum(rate(istio_requests_total[5m]))

# 서비스별 에러율
sum(rate(istio_requests_total{response_code=~"5.."}[5m])) by (destination_service)
/
sum(rate(istio_requests_total[5m])) by (destination_service)
```

#### 3. 응답 시간 (Latency)

```promql
# P50 (중앙값)
histogram_quantile(0.50,
  sum(rate(istio_request_duration_milliseconds_bucket[5m])) by (le, destination_service)
)

# P90
histogram_quantile(0.90,
  sum(rate(istio_request_duration_milliseconds_bucket[5m])) by (le, destination_service)
)

# P99
histogram_quantile(0.99,
  sum(rate(istio_request_duration_milliseconds_bucket[5m])) by (le, destination_service)
)
```

#### 4. 성공률

```promql
# 성공률 (2xx)
sum(rate(istio_requests_total{response_code=~"2.."}[5m])) by (destination_service)
/
sum(rate(istio_requests_total[5m])) by (destination_service)
```

---

## 📊 Grafana 연동

### Grafana 설치

```bash
# Istio 애드온으로 설치
$ kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.20/samples/addons/grafana.yaml

# 접속
$ kubectl port-forward -n istio-system svc/grafana 3000:3000

# 브라우저에서 http://localhost:3000 접속
```

### 기본 제공 대시보드

Istio는 여러 대시보드를 기본 제공합니다:

| 대시보드 | 설명 |
|----------|------|
| Istio Mesh Dashboard | 전체 메시 개요 |
| Istio Service Dashboard | 서비스별 상세 |
| Istio Workload Dashboard | 워크로드별 상세 |
| Istio Performance Dashboard | 성능 메트릭 |
| Istio Control Plane Dashboard | Istiod 상태 |

### Istio Service Dashboard

```
┌─────────────────────────────────────────────────────────────────┐
│                Istio Service Dashboard                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Service: [reviews.default.svc.cluster.local ▼]                │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  Request Rate                     Error Rate            │   │
│   │  ┌───────────────────┐           ┌───────────────────┐  │   │
│   │  │    📈 150 req/s   │           │    📉 0.5%        │  │   │
│   │  └───────────────────┘           └───────────────────┘  │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  Request Duration                                        │   │
│   │  ┌─────────────────────────────────────────────────────┐│   │
│   │  │        P50: 15ms                                    ││   │
│   │  │        P90: 45ms                                    ││   │
│   │  │        P99: 120ms                                   ││   │
│   │  └─────────────────────────────────────────────────────┘│   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  Incoming Requests by Source                             │   │
│   │  ┌─────────────────────────────────────────────────────┐│   │
│   │  │ frontend     ████████████████████████ 80%           ││   │
│   │  │ productpage  ████████ 15%                           ││   │
│   │  │ other        ██ 5%                                  ││   │
│   │  └─────────────────────────────────────────────────────┘│   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ 커스텀 메트릭 설정

### 기본 메트릭 레벨

```yaml
# meshConfig에서 설정
apiVersion: install.istio.io/v1alpha1
kind: IstioOperator
spec:
  meshConfig:
    defaultConfig:
      proxyStatsMatcher:
        inclusionPrefixes:
        - "cluster.outbound"
        - "cluster.inbound"
```

### 메트릭 커스터마이징 (Telemetry API)

```yaml
apiVersion: telemetry.istio.io/v1alpha1
kind: Telemetry
metadata:
  name: custom-metrics
  namespace: istio-system
spec:
  metrics:
  - providers:
    - name: prometheus
    overrides:
    - match:
        metric: REQUEST_COUNT
        mode: CLIENT_AND_SERVER
      tagOverrides:
        request_host:
          operation: UPSERT
          value: request.host
```

### 특정 메트릭 비활성화

```yaml
apiVersion: telemetry.istio.io/v1alpha1
kind: Telemetry
metadata:
  name: disable-metrics
  namespace: default
spec:
  metrics:
  - providers:
    - name: prometheus
    overrides:
    - match:
        metric: REQUEST_BYTES
      disabled: true
    - match:
        metric: RESPONSE_BYTES
      disabled: true
```

---

## 📈 실전 모니터링 시나리오

### 시나리오 1: 서비스 SLO 모니터링

```promql
# SLO: 99.9% 가용성 (에러율 < 0.1%)
1 - (
  sum(rate(istio_requests_total{
    destination_service="payment-service.default.svc.cluster.local",
    response_code=~"5.."
  }[5m]))
  /
  sum(rate(istio_requests_total{
    destination_service="payment-service.default.svc.cluster.local"
  }[5m]))
)

# SLO: P99 응답시간 < 500ms
histogram_quantile(0.99,
  sum(rate(istio_request_duration_milliseconds_bucket{
    destination_service="payment-service.default.svc.cluster.local"
  }[5m])) by (le)
) < 500
```

### 시나리오 2: Canary 배포 모니터링

```promql
# v1 vs v2 에러율 비교
# v1 에러율
sum(rate(istio_requests_total{destination_version="v1", response_code=~"5.."}[5m]))
/
sum(rate(istio_requests_total{destination_version="v1"}[5m]))

# v2 에러율
sum(rate(istio_requests_total{destination_version="v2", response_code=~"5.."}[5m]))
/
sum(rate(istio_requests_total{destination_version="v2"}[5m]))

# v1 vs v2 응답시간 비교
histogram_quantile(0.99,
  sum(rate(istio_request_duration_milliseconds_bucket{destination_version="v1"}[5m])) by (le)
)

histogram_quantile(0.99,
  sum(rate(istio_request_duration_milliseconds_bucket{destination_version="v2"}[5m])) by (le)
)
```

### 시나리오 3: Circuit Breaker 동작 감지

```promql
# response_flags로 Circuit Breaker 감지
# UO = Upstream Overflow (Connection Pool 초과)
sum(rate(istio_requests_total{response_flags="UO"}[5m])) by (destination_service)

# URX = Upstream Retry Limit Exceeded
sum(rate(istio_requests_total{response_flags="URX"}[5m])) by (destination_service)
```

---

## 🔔 알림 설정

### Prometheus AlertManager 규칙

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: istio-alerts
  namespace: istio-system
spec:
  groups:
  - name: istio
    rules:
    # 5xx 에러율 > 5%
    - alert: HighErrorRate
      expr: |
        sum(rate(istio_requests_total{response_code=~"5.."}[5m])) by (destination_service)
        /
        sum(rate(istio_requests_total[5m])) by (destination_service)
        > 0.05
      for: 5m
      labels:
        severity: critical
      annotations:
        summary: "High error rate on {{ $labels.destination_service }}"
        description: "Error rate is {{ $value | humanizePercentage }}"

    # P99 응답시간 > 1초
    - alert: HighLatency
      expr: |
        histogram_quantile(0.99,
          sum(rate(istio_request_duration_milliseconds_bucket[5m])) by (le, destination_service)
        ) > 1000
      for: 5m
      labels:
        severity: warning
      annotations:
        summary: "High latency on {{ $labels.destination_service }}"
        description: "P99 latency is {{ $value }}ms"

    # 요청량 급증
    - alert: TrafficSpike
      expr: |
        sum(rate(istio_requests_total[5m])) by (destination_service)
        >
        2 * sum(rate(istio_requests_total[1h] offset 1h)) by (destination_service)
      for: 10m
      labels:
        severity: warning
      annotations:
        summary: "Traffic spike on {{ $labels.destination_service }}"
```

---

## 🔍 디버깅

### 메트릭이 수집되지 않을 때

```bash
# 1. Sidecar 상태 확인
$ kubectl get pods -l app=my-app -o jsonpath='{.items[*].spec.containers[*].name}'
# istio-proxy가 있어야 함

# 2. Prometheus 타겟 확인
$ kubectl port-forward -n istio-system svc/prometheus 9090:9090
# http://localhost:9090/targets 에서 확인

# 3. Envoy 메트릭 직접 확인
$ kubectl exec deploy/my-app -c istio-proxy -- \
    pilot-agent request GET /stats/prometheus | grep istio_requests_total
```

### 특정 레이블이 없을 때

```bash
# destination_version 레이블이 없으면
# Pod에 version 레이블 확인
$ kubectl get pods -l app=my-app --show-labels

# version 레이블 추가 필요
```

---

## 📚 정리

```
┌─────────────────────────────────────────────────────────────────┐
│                 Istio 메트릭 체크리스트                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ✅ 기본 설정                                                  │
│      □ Prometheus 설치                                          │
│      □ Grafana 설치                                             │
│      □ Istio 대시보드 확인                                      │
│                                                                 │
│   ✅ 핵심 메트릭 (Golden Signals)                               │
│      □ Latency: istio_request_duration_milliseconds             │
│      □ Traffic: istio_requests_total                            │
│      □ Errors: response_code=~"5.."                             │
│      □ Saturation: Connection Pool, CPU, Memory                 │
│                                                                 │
│   ✅ 알림 설정                                                  │
│      □ 에러율 임계값                                            │
│      □ 응답시간 임계값                                          │
│      □ 트래픽 이상 감지                                         │
│                                                                 │
│   ✅ 디버깅                                                     │
│      □ response_flags 모니터링                                  │
│      □ Sidecar 상태 확인                                        │
│      □ Prometheus targets 확인                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🎯 핵심 정리

| 메트릭 | 용도 | PromQL 예시 |
|--------|------|-------------|
| `istio_requests_total` | 요청량, 에러율 | `rate(istio_requests_total[5m])` |
| `istio_request_duration_milliseconds` | 응답시간 | `histogram_quantile(0.99, ...)` |
| `response_code` | HTTP 상태 | `{response_code=~"5.."}` |
| `response_flags` | 에러 원인 | `{response_flags="UO"}` |
| `destination_version` | 버전별 비교 | Canary 모니터링 |

---

## 🔗 다음 편 예고

Part 2에서는 **분산 트레이싱**을 다룹니다:
- Trace와 Span 개념
- Jaeger 연동
- 헤더 전파 주의사항

---

## 🔗 참고 자료

- [Istio Observability](https://istio.io/latest/docs/concepts/observability/)
- [Istio Standard Metrics](https://istio.io/latest/docs/reference/config/metrics/)
- [Prometheus Querying](https://prometheus.io/docs/prometheus/latest/querying/basics/)
- [Google SRE - Golden Signals](https://sre.google/sre-book/monitoring-distributed-systems/)
