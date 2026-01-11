---
title: "Istio Traffic Part 4: Retry와 Timeout으로 복원력 높이기"
excerpt: "VirtualService의 retry와 timeout 설정으로 안정적인 서비스 만들기"
category: istio
tags: ["istio", "retry", "timeout", "resilience", "virtualservice", "kubernetes"]
series:
  name: "istio-traffic"
  order: 4
date: "2025-12-16"
---

## 🎯 시작하며

Part 3에서 Circuit Breaker로 장애 격리를 배웠습니다. 이번에는 일시적인 실패를 극복하는 **Retry**와 무한 대기를 방지하는 **Timeout**을 다룹니다.

![Retry and Timeout Role](/images/istio-traffic/retry-timeout-role.svg)

| 상황 | 문제 |
|------|------|
| **Timeout 없음** | 무한 대기 → 리소스 점유 → 연쇄 장애 |
| **Retry 없음** | 일시적 오류에도 바로 실패 |
| **Retry + Timeout** | 재시도로 일시적 오류 극복 + 타임아웃으로 무한 대기 방지 |

학습하면서 궁금했던 것들입니다:
- 어떤 상황에서 Retry를 해야 할까?
- Timeout은 얼마로 설정해야 할까?
- Retry Storm은 어떻게 방지할까?

---

## ⏱️ Timeout 설정

### 기본 Timeout

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: my-service
spec:
  hosts:
  - my-service
  http:
  - route:
    - destination:
        host: my-service
    timeout: 5s                    # 전체 요청 타임아웃
```

### Timeout 동작

![Timeout Operation](/images/istio-traffic/timeout-operation.svg)

### 경로별 Timeout

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: my-service
spec:
  hosts:
  - my-service
  http:
  # 빠른 응답 필요한 API
  - match:
    - uri:
        prefix: /api/health
    route:
    - destination:
        host: my-service
    timeout: 1s

  # 오래 걸리는 API
  - match:
    - uri:
        prefix: /api/reports
    route:
    - destination:
        host: my-service
    timeout: 30s

  # 기본
  - route:
    - destination:
        host: my-service
    timeout: 5s
```

---

## 🔄 Retry 설정

### 기본 Retry

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: my-service
spec:
  hosts:
  - my-service
  http:
  - route:
    - destination:
        host: my-service
    retries:
      attempts: 3                  # 최대 3번 재시도
      perTryTimeout: 2s            # 각 시도당 2초 타임아웃
```

### retryOn 조건

```yaml
retries:
  attempts: 3
  perTryTimeout: 2s
  retryOn: "5xx,reset,connect-failure,retriable-4xx"
```

| retryOn 값 | 설명 |
|------------|------|
| `5xx` | 5xx 응답 코드 |
| `gateway-error` | 502, 503, 504 |
| `reset` | 연결 리셋 |
| `connect-failure` | 연결 실패 |
| `retriable-4xx` | 재시도 가능한 4xx (409 등) |
| `refused-stream` | REFUSED_STREAM 에러 |
| `cancelled` | gRPC CANCELLED |
| `deadline-exceeded` | gRPC DEADLINE_EXCEEDED |
| `resource-exhausted` | gRPC RESOURCE_EXHAUSTED |
| `unavailable` | gRPC UNAVAILABLE |

### HTTP 상태 코드별 Retry

```yaml
retries:
  attempts: 3
  perTryTimeout: 2s
  retryOn: "retriable-status-codes"
  retriableStatusCodes:
  - 503
  - 504
```

---

## ⚖️ Timeout vs perTryTimeout

![Timeout vs perTryTimeout](/images/istio-traffic/timeout-vs-pertry.svg)

**핵심**: `perTryTimeout × attempts ≤ timeout` 이어야 모든 재시도가 가능합니다.

---

## ⚠️ Retry Storm 방지

### Retry Storm이란?

![Retry Storm](/images/istio-traffic/retry-storm.svg)

### 방지 방법 1: Circuit Breaker와 함께 사용

```yaml
# VirtualService - Retry
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: my-service
spec:
  hosts:
  - my-service
  http:
  - route:
    - destination:
        host: my-service
    retries:
      attempts: 3
      perTryTimeout: 2s
---
# DestinationRule - Circuit Breaker
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: my-service
spec:
  host: my-service
  trafficPolicy:
    connectionPool:
      http:
        http2MaxRequests: 100        # 동시 요청 제한
        maxRetries: 3                # 클러스터 전체 재시도 제한!
    outlierDetection:
      consecutive5xxErrors: 5
      baseEjectionTime: 30s
```

`maxRetries`는 **클러스터 전체**에서 동시에 진행되는 재시도 수를 제한합니다.

### 방지 방법 2: 재시도 조건 세밀하게

```yaml
retries:
  attempts: 3
  perTryTimeout: 2s
  retryOn: "connect-failure,refused-stream,unavailable"  # 네트워크 문제만
  # retryOn: "5xx"  ← 모든 5xx 재시도는 위험!
```

### 방지 방법 3: 멱등성 있는 요청만 Retry

```yaml
http:
# GET, HEAD는 재시도 안전
- match:
  - method:
      exact: GET
  route:
  - destination:
      host: my-service
  retries:
    attempts: 3
    perTryTimeout: 2s

# POST, PUT, DELETE는 재시도 주의
- match:
  - method:
      regex: "POST|PUT|DELETE"
  route:
  - destination:
      host: my-service
  retries:
    attempts: 1                    # 재시도 제한 또는 없음
    retryOn: "connect-failure"     # 연결 실패만
```

### 방지 방법 4: Retry Budget

```yaml
# DestinationRule의 maxRetries로 전체 재시도 예산 설정
trafficPolicy:
  connectionPool:
    http:
      maxRetries: 10               # 전체 동시 재시도 10개로 제한
```

---

## 🛠️ 실전 설정 예시

### 예시 1: 일반적인 API 서비스

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: api-service
spec:
  hosts:
  - api-service
  http:
  - route:
    - destination:
        host: api-service
    timeout: 10s
    retries:
      attempts: 3
      perTryTimeout: 3s
      retryOn: "gateway-error,connect-failure,refused-stream"
```

### 예시 2: 결제 서비스 (보수적)

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: payment-service
spec:
  hosts:
  - payment-service
  http:
  # 결제 확인 (조회) - 재시도 OK
  - match:
    - uri:
        prefix: /payment/status
      method:
        exact: GET
    route:
    - destination:
        host: payment-service
    timeout: 5s
    retries:
      attempts: 3
      perTryTimeout: 2s

  # 결제 생성 (변경) - 재시도 제한
  - match:
    - uri:
        prefix: /payment
      method:
        exact: POST
    route:
    - destination:
        host: payment-service
    timeout: 30s
    retries:
      attempts: 1                  # 1번만 시도
      retryOn: "connect-failure"   # 연결 실패만
```

### 예시 3: 외부 API 호출

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: external-api
spec:
  hosts:
  - api.external.com
  http:
  - route:
    - destination:
        host: api.external.com
        port:
          number: 443
    timeout: 15s
    retries:
      attempts: 2
      perTryTimeout: 5s
      retryOn: "5xx,reset,connect-failure"
```

### 예시 4: gRPC 서비스

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: grpc-service
spec:
  hosts:
  - grpc-service
  http:
  - route:
    - destination:
        host: grpc-service
    timeout: 10s
    retries:
      attempts: 3
      perTryTimeout: 3s
      retryOn: "cancelled,deadline-exceeded,unavailable,resource-exhausted"
```

---

## 🔍 디버깅

### Retry 동작 확인

```bash
# Envoy 통계에서 재시도 확인
$ kubectl exec deploy/my-app -c istio-proxy -- \
    pilot-agent request GET stats | grep retry

# 결과 예시
cluster.outbound|80||my-service.default.svc.cluster.local.upstream_rq_retry: 15
cluster.outbound|80||my-service.default.svc.cluster.local.upstream_rq_retry_success: 12
cluster.outbound|80||my-service.default.svc.cluster.local.upstream_rq_retry_overflow: 3
```

| 메트릭 | 의미 |
|--------|------|
| `upstream_rq_retry` | 재시도 횟수 |
| `upstream_rq_retry_success` | 재시도 성공 |
| `upstream_rq_retry_overflow` | maxRetries 초과로 재시도 거부 |

### Timeout 확인

```bash
# 응답 헤더에서 확인
$ curl -v http://my-service/api

# 504 Gateway Timeout 시
< HTTP/1.1 504 Gateway Timeout
< x-envoy-upstream-service-time: 5001
```

### Envoy 설정 확인

```bash
# VirtualService 라우트 설정
$ istioctl proxy-config routes deploy/my-app -o json | \
    jq '.[] | select(.name=="80") | .virtualHosts[].routes[].route'

# 예상 출력
{
  "timeout": "10s",
  "retryPolicy": {
    "retryOn": "connect-failure,refused-stream,unavailable,cancelled",
    "numRetries": 3,
    "perTryTimeout": "3s"
  }
}
```

---

## 📊 설정 권장값

### Timeout

| 서비스 유형 | 권장 timeout | 이유 |
|-------------|--------------|------|
| Health Check | 1-2s | 빠른 응답 필요 |
| 일반 API | 3-10s | 대부분의 요청 |
| 조회 API (대량 데이터) | 10-30s | 처리 시간 필요 |
| 파일 업로드 | 60s+ | 대용량 처리 |
| 비동기 처리 시작 | 3-5s | 시작만 확인 |

### Retry

| 상황 | attempts | perTryTimeout | retryOn |
|------|----------|---------------|---------|
| 일반 GET | 3 | 2-3s | `5xx,reset,connect-failure` |
| 중요 GET | 5 | 2s | `gateway-error,reset` |
| POST (멱등) | 2-3 | 3s | `connect-failure` |
| POST (비멱등) | 1 | - | `connect-failure`만 |
| 외부 API | 2 | 5s | `5xx,reset` |

---

## ⚡ 고급 설정

### Retry 백오프 (Envoy 기본 동작)

Istio/Envoy는 자동으로 지수 백오프를 적용합니다:

```
1차 재시도: 25ms 대기
2차 재시도: 50ms 대기
3차 재시도: 100ms 대기
...
최대: 250ms
```

### 조건부 Timeout Override

```yaml
http:
- match:
  - headers:
      x-timeout-override:
        exact: "long"
  route:
  - destination:
      host: my-service
  timeout: 60s

- route:
  - destination:
      host: my-service
  timeout: 10s
```

---

## 📚 정리

```
┌─────────────────────────────────────────────────────────────────┐
│              Retry & Timeout 체크리스트                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ✅ Timeout 설정                                               │
│      □ 모든 서비스에 timeout 설정                               │
│      □ 경로별 적절한 값 (빠른 API vs 느린 API)                  │
│      □ 외부 서비스는 여유있게                                   │
│                                                                 │
│   ✅ Retry 설정                                                 │
│      □ 멱등성 확인 (GET vs POST)                                │
│      □ retryOn 조건 세밀하게                                    │
│      □ perTryTimeout × attempts ≤ timeout 확인                  │
│                                                                 │
│   ✅ Retry Storm 방지                                           │
│      □ Circuit Breaker와 함께 사용                              │
│      □ DestinationRule의 maxRetries 설정                        │
│      □ 비멱등 요청은 재시도 제한                                │
│                                                                 │
│   ✅ 모니터링                                                   │
│      □ upstream_rq_retry 메트릭 확인                            │
│      □ 504 Timeout 에러 추적                                    │
│      □ 재시도 성공률 확인                                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🎯 핵심 정리

| 설정 | 설명 | 주의사항 |
|------|------|----------|
| **timeout** | 전체 요청 제한 시간 | 너무 짧으면 정상 요청도 실패 |
| **retries.attempts** | 최대 재시도 횟수 | Retry Storm 주의 |
| **retries.perTryTimeout** | 시도당 타임아웃 | × attempts ≤ timeout |
| **retries.retryOn** | 재시도 조건 | 구체적으로 설정 |
| **maxRetries** (DR) | 클러스터 재시도 예산 | Storm 방지 |

---

## 🔗 다음 편 예고

Part 5에서는 **Traffic Mirroring**을 다룹니다:
- 실제 트래픽을 복제해서 새 버전 테스트
- Shadow Testing 패턴
- 결과 비교 분석

---

## 🔗 참고 자료

- [Istio Request Timeouts](https://istio.io/latest/docs/tasks/traffic-management/request-timeouts/)
- [Istio VirtualService Retries](https://istio.io/latest/docs/reference/config/networking/virtual-service/#HTTPRetry)
- [Envoy Retry Policy](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/router_filter#x-envoy-retry-on)
