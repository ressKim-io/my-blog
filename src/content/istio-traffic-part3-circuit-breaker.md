---
title: "Istio Traffic Part 3: Circuit Breaker로 장애 격리하기"
excerpt: "DestinationRule의 outlierDetection과 connectionPool로 장애 전파를 막는 방법"
category: "kubernetes"
tags: ["istio", "circuit-breaker", "outlier-detection", "resilience", "kubernetes"]
series:
  name: "istio-traffic"
  order: 3
date: "2024-12-24"
---

## 🎯 시작하며

Part 2에서 Canary 배포와 A/B Testing을 배웠습니다. 이번에는 서비스 장애가 전체 시스템으로 퍼지는 것을 막는 **Circuit Breaker**를 다룹니다.

![Failure Propagation](/images/istio-traffic/failure-propagation.svg)

| 상황 | 결과 |
|------|------|
| **Circuit Breaker 없음** | C 장애 → B 대기 → A 대기 → 전체 시스템 연쇄 장애 |
| **Circuit Breaker 있음** | C 장애 → Circuit Open → 빠른 실패 반환 → A, B 정상 동작 |

학습하면서 궁금했던 것들입니다:
- Circuit Breaker는 어떻게 동작할까?
- Istio에서는 어떻게 설정할까?
- Connection Pool과 Outlier Detection의 차이는?

---

## 💡 Circuit Breaker 패턴 이해

### 전기 회로 차단기와 비유

![Circuit Breaker States](/images/istio-traffic/circuit-breaker-states.svg)

| 상태 | 설명 | 동작 |
|------|------|------|
| **CLOSED** | 정상 상태 | 모든 요청 통과 |
| **OPEN** | 차단 상태 | 모든 요청 즉시 실패 |
| **HALF-OPEN** | 테스트 상태 | 일부 요청만 통과, 성공 시 CLOSED, 실패 시 OPEN |

---

## 🔧 Istio의 Circuit Breaker

Istio에서는 **DestinationRule**로 Circuit Breaker를 설정합니다. 두 가지 방식이 있습니다:

### 1. Connection Pool: 사전 제한

요청이 과부하되기 전에 미리 제한합니다.

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: my-service-circuit-breaker
spec:
  host: my-service
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 100           # 최대 TCP 연결 수
        connectTimeout: 5s            # 연결 타임아웃
      http:
        http1MaxPendingRequests: 100  # 대기 중 최대 요청 수
        http2MaxRequests: 1000        # 최대 동시 요청 수
        maxRequestsPerConnection: 10  # 연결당 최대 요청 수
        maxRetries: 3                 # 최대 재시도 횟수
```

![Connection Pool Operation](/images/istio-traffic/connection-pool-operation.svg)

### 2. Outlier Detection: 사후 제거

실패하는 인스턴스를 감지하고 풀에서 제거합니다.

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: my-service-outlier
spec:
  host: my-service
  trafficPolicy:
    outlierDetection:
      consecutive5xxErrors: 5        # 연속 5xx 5번이면
      interval: 10s                  # 10초마다 체크
      baseEjectionTime: 30s          # 30초 동안 제외
      maxEjectionPercent: 50         # 최대 50%까지 제외
```

![Outlier Detection Operation](/images/istio-traffic/outlier-detection-operation.svg)

---

## 📊 설정 상세 가이드

### Connection Pool 설정

#### TCP 설정

```yaml
connectionPool:
  tcp:
    maxConnections: 100       # 서비스로의 최대 TCP 연결
    connectTimeout: 5s        # TCP 연결 타임아웃
    tcpKeepalive:             # TCP Keepalive 설정
      time: 7200s             # Keepalive 시작까지 대기
      interval: 75s           # Keepalive 프로브 간격
```

#### HTTP 설정

```yaml
connectionPool:
  http:
    http1MaxPendingRequests: 100   # HTTP/1.1 대기열 크기
    http2MaxRequests: 1000         # HTTP/2 최대 동시 요청
    maxRequestsPerConnection: 10   # 연결당 요청 수 (0=무제한)
    maxRetries: 3                  # 클러스터 전체 재시도 상한
    idleTimeout: 1h               # 유휴 연결 타임아웃
    h2UpgradePolicy: UPGRADE      # HTTP/2 업그레이드 정책
```

#### h2UpgradePolicy 옵션

| 값 | 설명 |
|------|------|
| `DEFAULT` | 프로토콜에 따라 자동 결정 |
| `DO_NOT_UPGRADE` | HTTP/1.1 유지 |
| `UPGRADE` | HTTP/2로 업그레이드 |

### Outlier Detection 설정

```yaml
outlierDetection:
  # 에러 감지 조건
  consecutive5xxErrors: 5           # 연속 5xx 에러 횟수
  consecutiveGatewayErrors: 5       # 연속 502, 503, 504 횟수
  consecutiveLocalOriginFailures: 5 # 로컬 오리진 실패 횟수

  # 체크 주기
  interval: 10s                     # 분석 간격

  # 제외 정책
  baseEjectionTime: 30s             # 기본 제외 시간
  maxEjectionPercent: 50            # 최대 제외 비율 (%)
  minHealthPercent: 30              # 최소 정상 비율 (%)

  # 성공 조건
  splitExternalLocalOriginErrors: false  # 외부/로컬 에러 분리
```

#### 제외 시간 계산

```
실제 제외 시간 = baseEjectionTime × (제외 횟수)

예: baseEjectionTime: 30s
- 1번째 제외: 30초
- 2번째 제외: 60초
- 3번째 제외: 90초
...
```

#### maxEjectionPercent 주의사항

```yaml
# Pod가 2개일 때 maxEjectionPercent: 50
# → 최대 1개만 제외 가능 (50%)
# → 나머지 1개가 문제여도 제외 불가

# Pod가 4개일 때 maxEjectionPercent: 50
# → 최대 2개까지 제외 가능
```

---

## 🛠️ 실전 설정 예시

### 예시 1: 기본 Circuit Breaker

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: productpage-circuit-breaker
spec:
  host: productpage
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 100
      http:
        http1MaxPendingRequests: 100
        http2MaxRequests: 1000
    outlierDetection:
      consecutive5xxErrors: 3
      interval: 30s
      baseEjectionTime: 30s
      maxEjectionPercent: 100
```

### 예시 2: 보수적인 설정 (안정성 우선)

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: payment-service
spec:
  host: payment-service
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 50            # 낮은 연결 수
        connectTimeout: 3s            # 짧은 타임아웃
      http:
        http1MaxPendingRequests: 20   # 적은 대기열
        http2MaxRequests: 100         # 적은 동시 요청
        maxRequestsPerConnection: 5
    outlierDetection:
      consecutive5xxErrors: 2         # 2번만 실패해도 제외
      interval: 5s                    # 빠른 체크
      baseEjectionTime: 60s           # 긴 제외 시간
      maxEjectionPercent: 50
```

### 예시 3: Subset별 다른 정책

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: reviews
spec:
  host: reviews
  trafficPolicy:                      # 기본 정책
    connectionPool:
      tcp:
        maxConnections: 100
    outlierDetection:
      consecutive5xxErrors: 5
      baseEjectionTime: 30s
  subsets:
  - name: v1
    labels:
      version: v1
    # v1은 기본 정책 사용

  - name: v2
    labels:
      version: v2
    trafficPolicy:                    # v2 전용 정책
      connectionPool:
        tcp:
          maxConnections: 50          # 새 버전은 보수적으로
      outlierDetection:
        consecutive5xxErrors: 3       # 더 민감하게
        baseEjectionTime: 60s         # 더 오래 제외
```

### 예시 4: 외부 서비스 Circuit Breaker

```yaml
# ServiceEntry로 외부 서비스 등록
apiVersion: networking.istio.io/v1
kind: ServiceEntry
metadata:
  name: external-payment-api
spec:
  hosts:
  - api.payment.com
  location: MESH_EXTERNAL
  ports:
  - number: 443
    name: https
    protocol: HTTPS
  resolution: DNS
---
# Circuit Breaker 적용
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: external-payment-circuit-breaker
spec:
  host: api.payment.com
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 20            # 외부 API는 제한적으로
      http:
        http2MaxRequests: 50
        maxRequestsPerConnection: 5
    outlierDetection:
      consecutive5xxErrors: 3
      interval: 30s
      baseEjectionTime: 60s
      maxEjectionPercent: 100
    tls:
      mode: SIMPLE
```

---

## 🔍 Circuit Breaker 동작 확인

### 테스트 설정

```yaml
# 극단적인 설정으로 테스트
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: httpbin-circuit-breaker
spec:
  host: httpbin
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 1             # 1개 연결만!
      http:
        http1MaxPendingRequests: 1    # 대기 1개만!
        http2MaxRequests: 1           # 동시 1개만!
    outlierDetection:
      consecutive5xxErrors: 1         # 1번 실패면 제외
      interval: 1s
      baseEjectionTime: 3m
      maxEjectionPercent: 100
```

### 부하 테스트

```bash
# fortio로 동시 요청
$ kubectl exec deploy/fortio -- \
    fortio load -c 3 -qps 0 -n 20 -loglevel Warning \
    http://httpbin:8000/get

# 결과 예시
Code 200 : 10 (50.0 %)
Code 503 : 10 (50.0 %)    # Circuit Breaker에 의해 거부됨
```

### 메트릭 확인

```bash
# Envoy 통계
$ kubectl exec deploy/httpbin -c istio-proxy -- \
    pilot-agent request GET stats | grep httpbin | grep pending

# upstream_rq_pending_overflow: Circuit Breaker로 거부된 요청 수
cluster.outbound|8000||httpbin.default.svc.cluster.local.upstream_rq_pending_overflow: 10
```

### Kiali에서 확인

```
Kiali UI → Graph → httpbin 서비스 클릭
→ "Traffic" 탭에서 Circuit Breaker 상태 확인
```

---

## ⚠️ 주의사항

### 1. 너무 민감한 설정 주의

```yaml
# ❌ 너무 민감함 - 잦은 오탐
outlierDetection:
  consecutive5xxErrors: 1         # 1번 실패로 제외?
  interval: 1s                    # 너무 자주 체크

# ✅ 적절한 설정
outlierDetection:
  consecutive5xxErrors: 5         # 연속 5번 실패
  interval: 10s                   # 10초마다 체크
```

### 2. maxEjectionPercent와 Pod 수

```yaml
# Pod 2개 + maxEjectionPercent: 50
# → 1개만 제외 가능
# → 남은 1개가 문제여도 트래픽 계속 감

# 해결: 충분한 Pod 수 확보 또는 maxEjectionPercent 조절
```

### 3. Retry와 Circuit Breaker 조합

```yaml
# VirtualService의 retry
http:
- route:
  - destination:
      host: my-service
  retries:
    attempts: 3
    perTryTimeout: 2s

# DestinationRule의 Circuit Breaker
trafficPolicy:
  outlierDetection:
    consecutive5xxErrors: 5

# 주의: retry 3번 × 여러 요청 = 빠르게 5xx 누적
# → Circuit Breaker 빨리 열림
```

### 4. Connection Pool 오버플로우 에러

```
# 503 에러 메시지
"upstream connect error or disconnect/reset before headers.
 reset reason: overflow"

# 원인: http1MaxPendingRequests 초과
# 해결: 값을 늘리거나 요청 속도 조절
```

---

## 📊 Connection Pool vs Outlier Detection 비교

![Connection Pool vs Outlier Detection](/images/istio-traffic/connection-pool-vs-outlier.svg)

**권장**: 둘 다 함께 사용하세요!

```yaml
trafficPolicy:
  connectionPool:           # 과부하 방지
    tcp:
      maxConnections: 100
    http:
      http2MaxRequests: 1000
  outlierDetection:         # 장애 Pod 격리
    consecutive5xxErrors: 5
    baseEjectionTime: 30s
```

---

## 📚 정리

```
┌─────────────────────────────────────────────────────────────────┐
│               Circuit Breaker 설정 체크리스트                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ✅ Connection Pool                                            │
│      □ maxConnections: 서비스 처리량에 맞게                     │
│      □ http2MaxRequests: 동시 요청 수 고려                      │
│      □ http1MaxPendingRequests: 대기열 크기                     │
│                                                                 │
│   ✅ Outlier Detection                                          │
│      □ consecutive5xxErrors: 3~7 사이 권장                      │
│      □ interval: 10~30s 사이 권장                               │
│      □ baseEjectionTime: 30s~60s 권장                           │
│      □ maxEjectionPercent: Pod 수 고려                          │
│                                                                 │
│   ✅ 모니터링                                                   │
│      □ upstream_rq_pending_overflow 메트릭 확인                 │
│      □ Kiali에서 Circuit Breaker 상태 확인                      │
│      □ 5xx 에러율 대시보드 구성                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🎯 핵심 정리

| 설정 | 역할 | 권장값 |
|------|------|--------|
| **maxConnections** | 최대 TCP 연결 | 서비스 처리량 기준 |
| **http2MaxRequests** | 최대 동시 요청 | 서비스 처리량 × 2 |
| **consecutive5xxErrors** | 제외 기준 에러 수 | 3~7 |
| **interval** | 체크 주기 | 10~30s |
| **baseEjectionTime** | 기본 제외 시간 | 30~60s |
| **maxEjectionPercent** | 최대 제외 비율 | Pod 수에 따라 |

---

## 🔗 다음 편 예고

Part 4에서는 **Retry와 Timeout**을 다룹니다:
- VirtualService의 retries 설정
- timeout 설정 베스트 프랙티스
- Retry Storm 방지

---

## 🔗 참고 자료

- [Istio Circuit Breaking](https://istio.io/latest/docs/tasks/traffic-management/circuit-breaking/)
- [Istio DestinationRule](https://istio.io/latest/docs/reference/config/networking/destination-rule/)
- [Envoy Circuit Breaker](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/circuit_breaking)
