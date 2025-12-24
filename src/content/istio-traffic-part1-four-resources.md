---
title: "Istio Traffic Part 1: 트래픽 관리 4대 리소스 총정리"
excerpt: "Gateway, VirtualService, DestinationRule, ServiceEntry - Istio 트래픽 관리의 핵심 리소스를 이해하기"
category: "kubernetes"
tags: ["istio", "traffic-management", "virtualservice", "destinationrule", "gateway", "kubernetes"]
series:
  name: "istio-traffic"
  order: 1
date: "2024-12-24"
---

## 🎯 시작하며

istio-intro와 istio-security 시리즈에서 Istio의 기본 개념과 보안을 다뤘습니다. 이제 Istio의 가장 강력한 기능인 **트래픽 관리**를 살펴보겠습니다.

Istio 트래픽 관리는 4가지 핵심 리소스로 구성됩니다:

```
┌─────────────────────────────────────────────────────────────────┐
│                  Istio 트래픽 관리 4대 리소스                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────┐   ┌─────────────┐   ┌─────────────────┐       │
│   │   Gateway   │   │ Virtual     │   │ Destination     │       │
│   │             │   │ Service     │   │ Rule            │       │
│   │  외부 진입점 │   │  라우팅     │   │  목적지 정책    │       │
│   └─────────────┘   └─────────────┘   └─────────────────┘       │
│                                                                 │
│                     ┌─────────────────┐                         │
│                     │  Service Entry  │                         │
│                     │                 │                         │
│                     │  외부 서비스    │                         │
│                     └─────────────────┘                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

학습하면서 궁금했던 것들입니다:
- VirtualService와 DestinationRule의 차이는?
- Gateway는 언제 필요할까?
- 외부 API 호출은 어떻게 관리할까?

---

## 📊 전체 구조 이해하기

4가지 리소스가 어떻게 함께 동작하는지 먼저 보겠습니다:

```
┌─────────────────────────────────────────────────────────────────┐
│                      트래픽 흐름 전체 그림                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   외부 사용자                                                   │
│       │                                                         │
│       ▼                                                         │
│   ┌─────────────────────────────────────────────┐               │
│   │              Gateway                         │               │
│   │  "어떤 호스트/포트로 들어오는 트래픽을 허용?" │               │
│   │  예: api.example.com:443                     │               │
│   └───────────────────┬─────────────────────────┘               │
│                       │                                         │
│                       ▼                                         │
│   ┌─────────────────────────────────────────────┐               │
│   │           VirtualService                     │               │
│   │  "들어온 트래픽을 어디로 보낼까?"             │               │
│   │  예: /api/v1/* → service-a                   │               │
│   │      /api/v2/* → service-b                   │               │
│   └───────────────────┬─────────────────────────┘               │
│                       │                                         │
│           ┌───────────┴───────────┐                             │
│           ▼                       ▼                             │
│   ┌───────────────┐       ┌───────────────┐                     │
│   │ DestinationRule│       │DestinationRule│                     │
│   │ "어떻게 연결?" │       │"어떻게 연결?" │                     │
│   │ - 버전별 subset│       │- Connection   │                     │
│   │ - Load Balance│       │  Pool         │                     │
│   └───────┬───────┘       └───────┬───────┘                     │
│           │                       │                             │
│           ▼                       ▼                             │
│   ┌───────────────┐       ┌───────────────┐                     │
│   │  service-a    │       │  service-b    │                     │
│   │   v1    v2    │       │   v1    v2    │                     │
│   └───────────────┘       └───────────────┘                     │
│                                                                 │
│   ┌─────────────────────────────────────────────┐               │
│   │           ServiceEntry                       │               │
│   │  "메시 외부의 서비스도 관리 가능하게"         │               │
│   │  예: external-api.com을 메시에 등록          │               │
│   └─────────────────────────────────────────────┘               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1️⃣ Gateway: 외부 트래픽의 진입점

### Gateway란?

클러스터 외부에서 들어오는 트래픽을 받아들이는 진입점입니다.

```yaml
apiVersion: networking.istio.io/v1
kind: Gateway
metadata:
  name: my-gateway
  namespace: default
spec:
  selector:
    istio: ingressgateway   # Gateway Pod 선택
  servers:
  - port:
      number: 80
      name: http
      protocol: HTTP
    hosts:
    - "api.example.com"     # 이 호스트로 들어오는 요청만 허용
```

### HTTPS Gateway

```yaml
apiVersion: networking.istio.io/v1
kind: Gateway
metadata:
  name: https-gateway
spec:
  selector:
    istio: ingressgateway
  servers:
  - port:
      number: 443
      name: https
      protocol: HTTPS
    tls:
      mode: SIMPLE                          # TLS 종료
      credentialName: my-tls-secret         # TLS 인증서 Secret
    hosts:
    - "api.example.com"
```

### TLS 모드 비교

| 모드 | 설명 | 사용 케이스 |
|------|------|------------|
| `SIMPLE` | Gateway에서 TLS 종료 | 일반적인 HTTPS |
| `PASSTHROUGH` | TLS 그대로 백엔드 전달 | 백엔드에서 TLS 처리 |
| `MUTUAL` | mTLS (클라이언트 인증서 필요) | B2B, 높은 보안 |

### Gateway vs Kubernetes Ingress

```
┌─────────────────────────────────────────────────────────────────┐
│               Gateway vs Kubernetes Ingress                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Kubernetes Ingress           Istio Gateway                    │
│   ══════════════════           ════════════════                 │
│                                                                 │
│   - 진입점 + 라우팅 통합       - 진입점만 담당                  │
│   - L7 라우팅 기본 제공        - VirtualService와 분리          │
│   - 간단한 설정                - 세밀한 제어 가능               │
│   - 컨트롤러마다 다름          - Istio 표준                     │
│                                                                 │
│   apiVersion: networking.k8s.io/v1                              │
│   kind: Ingress                apiVersion: networking.istio.io  │
│   spec:                        kind: Gateway                    │
│     rules:                     spec:                            │
│     - host: api.example.com      selector: ...                  │
│       http:                      servers:                       │
│         paths:                   - port: ...                    │
│         - path: /api               hosts: ...                   │
│           backend: ...                                          │
│                                (라우팅은 VirtualService에서)    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Gateway는 "문"만 열어두고, 어디로 보낼지는 VirtualService가 결정합니다.

---

## 2️⃣ VirtualService: 트래픽 라우팅

### VirtualService란?

트래픽을 어디로 보낼지 결정하는 라우팅 규칙입니다.

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: my-virtualservice
spec:
  hosts:
  - "api.example.com"       # 적용할 호스트
  gateways:
  - my-gateway              # Gateway와 연결 (외부 트래픽)
  http:
  - match:
    - uri:
        prefix: /api/v1
    route:
    - destination:
        host: service-a
        port:
          number: 80
  - match:
    - uri:
        prefix: /api/v2
    route:
    - destination:
        host: service-b
        port:
          number: 80
```

### 라우팅 조건들

```yaml
http:
- match:
  # URI 매칭
  - uri:
      exact: "/api/users"         # 정확히 일치
      prefix: "/api/"             # 접두사 일치
      regex: "/api/v[0-9]+/.*"    # 정규식 일치

  # 헤더 매칭
  - headers:
      x-version:
        exact: "v2"
      cookie:
        regex: ".*user=admin.*"

  # 쿼리 파라미터 매칭
  - queryParams:
      debug:
        exact: "true"

  # 메소드 매칭
  - method:
      exact: "POST"

  # Source 매칭
  - sourceLabels:
      app: frontend
```

### 트래픽 분배 (Weight-based Routing)

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: reviews
spec:
  hosts:
  - reviews
  http:
  - route:
    - destination:
        host: reviews
        subset: v1            # DestinationRule에서 정의
      weight: 90              # 90% 트래픽
    - destination:
        host: reviews
        subset: v2
      weight: 10              # 10% 트래픽
```

### 헤더 기반 라우팅

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: reviews
spec:
  hosts:
  - reviews
  http:
  # 테스터만 v2로
  - match:
    - headers:
        x-user-type:
          exact: "tester"
    route:
    - destination:
        host: reviews
        subset: v2
  # 나머지는 v1로
  - route:
    - destination:
        host: reviews
        subset: v1
```

### 헤더/응답 조작

```yaml
http:
- route:
  - destination:
      host: service-a
  headers:
    request:
      add:
        x-request-id: "abc123"      # 요청에 헤더 추가
      remove:
      - x-internal-token            # 요청에서 헤더 제거
    response:
      add:
        x-served-by: "istio"        # 응답에 헤더 추가
```

### Timeout과 Retry

```yaml
http:
- route:
  - destination:
      host: service-a
  timeout: 5s                       # 5초 타임아웃
  retries:
    attempts: 3                     # 최대 3번 재시도
    perTryTimeout: 2s               # 각 시도당 2초
    retryOn: 5xx,reset,connect-failure
```

---

## 3️⃣ DestinationRule: 목적지 정책

### DestinationRule이란?

트래픽이 목적지에 **어떻게 연결되는지** 정의합니다.

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: reviews-destination
spec:
  host: reviews                     # 적용할 서비스
  trafficPolicy:                    # 전체 정책
    connectionPool:
      tcp:
        maxConnections: 100
      http:
        h2UpgradePolicy: UPGRADE
  subsets:                          # 버전별 subset 정의
  - name: v1
    labels:
      version: v1
  - name: v2
    labels:
      version: v2
```

### VirtualService vs DestinationRule

```
┌─────────────────────────────────────────────────────────────────┐
│            VirtualService vs DestinationRule                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   VirtualService                 DestinationRule                │
│   ══════════════                 ════════════════               │
│                                                                 │
│   "어디로 보낼까?"               "어떻게 연결할까?"             │
│                                                                 │
│   - 라우팅 규칙                  - 연결 정책                    │
│   - 매칭 조건                    - 로드밸런싱                   │
│   - 가중치 분배                  - Circuit Breaker              │
│   - Timeout, Retry               - Connection Pool              │
│                                  - TLS 설정                     │
│                                  - Subset 정의                  │
│                                                                 │
│   ┌────────────────────┐         ┌────────────────────┐         │
│   │    VirtualService  │         │  DestinationRule   │         │
│   │                    │         │                    │         │
│   │  reviews → v1: 90% │ ──────▶ │  v1: labels        │         │
│   │           v2: 10% │         │      version=v1    │         │
│   │                    │         │  v2: labels        │         │
│   │                    │         │      version=v2    │         │
│   └────────────────────┘         └────────────────────┘         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Subset 정의

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: reviews
spec:
  host: reviews
  subsets:
  - name: v1
    labels:
      version: v1
    trafficPolicy:                  # subset별 정책도 가능
      loadBalancer:
        simple: ROUND_ROBIN
  - name: v2
    labels:
      version: v2
    trafficPolicy:
      loadBalancer:
        simple: LEAST_REQUEST
  - name: v3
    labels:
      version: v3
```

### 로드밸런싱 정책

```yaml
trafficPolicy:
  loadBalancer:
    simple: ROUND_ROBIN            # 순차 분배 (기본값)
    # simple: LEAST_REQUEST        # 연결 수가 적은 곳으로
    # simple: RANDOM               # 무작위
    # simple: PASSTHROUGH          # 원래 목적지 유지
```

### 세션 친화성 (Sticky Session)

```yaml
trafficPolicy:
  loadBalancer:
    consistentHash:
      httpHeaderName: x-user-id     # 헤더 기반
      # httpCookie:                 # 쿠키 기반
      #   name: session-id
      #   ttl: 3600s
      # useSourceIp: true           # IP 기반
```

### Connection Pool 설정

```yaml
trafficPolicy:
  connectionPool:
    tcp:
      maxConnections: 100           # 최대 TCP 연결 수
      connectTimeout: 10s           # 연결 타임아웃
    http:
      h2UpgradePolicy: UPGRADE      # HTTP/2 업그레이드
      http1MaxPendingRequests: 100  # 대기 요청 수
      http2MaxRequests: 1000        # 최대 동시 요청 수
      maxRequestsPerConnection: 10  # 연결당 요청 수
      maxRetries: 3                 # 최대 재시도 횟수
```

### Circuit Breaker (Outlier Detection)

```yaml
trafficPolicy:
  outlierDetection:
    consecutive5xxErrors: 5         # 5xx 5번 연속이면
    interval: 10s                   # 10초 간격으로 체크
    baseEjectionTime: 30s           # 30초 동안 제외
    maxEjectionPercent: 50          # 최대 50%까지 제외
```

---

## 4️⃣ ServiceEntry: 외부 서비스 등록

### ServiceEntry란?

메시 외부의 서비스를 Istio 서비스 레지스트리에 등록합니다.

```yaml
apiVersion: networking.istio.io/v1
kind: ServiceEntry
metadata:
  name: external-api
spec:
  hosts:
  - api.external.com              # 외부 호스트명
  location: MESH_EXTERNAL         # 메시 외부
  ports:
  - number: 443
    name: https
    protocol: HTTPS
  resolution: DNS                 # DNS로 해석
```

### 왜 ServiceEntry가 필요할까?

```
┌─────────────────────────────────────────────────────────────────┐
│                   ServiceEntry가 필요한 이유                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   기본 설정 (outboundTrafficPolicy: REGISTRY_ONLY)              │
│   ════════════════════════════════════════════════              │
│                                                                 │
│   서비스 A ──→ api.external.com                                 │
│              ❌ 차단됨!                                         │
│                                                                 │
│   Istio는 기본적으로 등록되지 않은 외부 서비스 차단             │
│                                                                 │
│   해결 방법 1: ServiceEntry로 등록                              │
│   ────────────────────────────────                              │
│   서비스 A ──→ ServiceEntry ──→ api.external.com                │
│              ✅ 허용됨!                                         │
│                                                                 │
│   해결 방법 2: ALLOW_ANY로 설정 변경                            │
│   ────────────────────────────────                              │
│   모든 외부 트래픽 허용 (보안 약화)                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### resolution 옵션

| 값 | 설명 | 사용 케이스 |
|------|------|------------|
| `NONE` | 원래 IP 그대로 사용 | IP 직접 지정 |
| `STATIC` | endpoints에 지정된 IP | 고정 IP |
| `DNS` | DNS 조회 | 일반적인 외부 서비스 |
| `DNS_ROUND_ROBIN` | DNS + 라운드로빈 | 여러 IP 반환 시 |

### 외부 서비스에 VirtualService/DestinationRule 적용

```yaml
# 1. ServiceEntry로 등록
apiVersion: networking.istio.io/v1
kind: ServiceEntry
metadata:
  name: external-api
spec:
  hosts:
  - api.external.com
  location: MESH_EXTERNAL
  ports:
  - number: 443
    name: https
    protocol: HTTPS
  resolution: DNS
---
# 2. VirtualService로 타임아웃 설정
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: external-api-vs
spec:
  hosts:
  - api.external.com
  http:
  - timeout: 3s
    route:
    - destination:
        host: api.external.com
        port:
          number: 443
---
# 3. DestinationRule로 TLS 설정
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: external-api-dr
spec:
  host: api.external.com
  trafficPolicy:
    tls:
      mode: SIMPLE               # TLS로 연결
    connectionPool:
      tcp:
        maxConnections: 10
```

### 내부 서비스를 다른 이름으로 노출

```yaml
apiVersion: networking.istio.io/v1
kind: ServiceEntry
metadata:
  name: internal-alias
spec:
  hosts:
  - "database"                   # 내부에서 사용할 이름
  location: MESH_INTERNAL
  ports:
  - number: 3306
    name: mysql
    protocol: TCP
  resolution: STATIC
  endpoints:
  - address: 10.0.0.100          # 실제 IP
```

---

## 🔄 4대 리소스 조합 예시

### 완전한 예시: 마이크로서비스 트래픽 관리

```yaml
# 1. Gateway: 외부 진입점
apiVersion: networking.istio.io/v1
kind: Gateway
metadata:
  name: api-gateway
spec:
  selector:
    istio: ingressgateway
  servers:
  - port:
      number: 443
      name: https
      protocol: HTTPS
    tls:
      mode: SIMPLE
      credentialName: api-tls
    hosts:
    - "api.example.com"
---
# 2. VirtualService: 라우팅 규칙
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: api-routing
spec:
  hosts:
  - "api.example.com"
  gateways:
  - api-gateway
  http:
  # Canary: 10% → v2
  - match:
    - uri:
        prefix: /api/products
    route:
    - destination:
        host: product-service
        subset: v1
      weight: 90
    - destination:
        host: product-service
        subset: v2
      weight: 10
    timeout: 5s
    retries:
      attempts: 3
      perTryTimeout: 2s

  # A/B Test: 헤더로 분기
  - match:
    - uri:
        prefix: /api/checkout
      headers:
        x-test-group:
          exact: "B"
    route:
    - destination:
        host: checkout-service
        subset: experimental
  - match:
    - uri:
        prefix: /api/checkout
    route:
    - destination:
        host: checkout-service
        subset: stable
---
# 3. DestinationRule: 연결 정책
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: product-service
spec:
  host: product-service
  trafficPolicy:
    connectionPool:
      http:
        http2MaxRequests: 100
    outlierDetection:
      consecutive5xxErrors: 3
      interval: 10s
      baseEjectionTime: 30s
  subsets:
  - name: v1
    labels:
      version: v1
  - name: v2
    labels:
      version: v2
---
# 4. DestinationRule: checkout-service
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: checkout-service
spec:
  host: checkout-service
  subsets:
  - name: stable
    labels:
      version: stable
  - name: experimental
    labels:
      version: experimental
---
# 5. ServiceEntry: 외부 결제 API
apiVersion: networking.istio.io/v1
kind: ServiceEntry
metadata:
  name: payment-api
spec:
  hosts:
  - api.payment-provider.com
  location: MESH_EXTERNAL
  ports:
  - number: 443
    name: https
    protocol: HTTPS
  resolution: DNS
---
# 6. VirtualService: 외부 API 정책
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: payment-api-vs
spec:
  hosts:
  - api.payment-provider.com
  http:
  - timeout: 10s
    retries:
      attempts: 2
      perTryTimeout: 5s
    route:
    - destination:
        host: api.payment-provider.com
        port:
          number: 443
```

---

## 📊 4대 리소스 비교 정리

```
┌─────────────────────────────────────────────────────────────────┐
│                    4대 리소스 비교표                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   리소스            역할              주요 설정                 │
│   ═══════════════   ═══════════════   ═══════════════════       │
│                                                                 │
│   Gateway           외부 진입점       - port/protocol           │
│                     "문 열기"         - hosts                   │
│                                       - TLS mode                │
│                                                                 │
│   VirtualService    라우팅 규칙       - match 조건              │
│                     "어디로?"         - route 목적지            │
│                                       - weight 분배             │
│                                       - timeout, retry          │
│                                                                 │
│   DestinationRule   연결 정책         - subsets                 │
│                     "어떻게?"         - loadBalancer            │
│                                       - connectionPool          │
│                                       - outlierDetection        │
│                                                                 │
│   ServiceEntry      외부 서비스       - hosts                   │
│                     "등록"            - location                │
│                                       - resolution              │
│                                       - endpoints               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🎯 핵심 정리

| 리소스 | 한 줄 설명 | 필수 조합 |
|--------|-----------|----------|
| **Gateway** | 외부 트래픽 진입점 정의 | VirtualService와 함께 |
| **VirtualService** | 트래픽 라우팅 규칙 | 단독 또는 Gateway와 |
| **DestinationRule** | 목적지 연결 정책 | VirtualService의 subset용 |
| **ServiceEntry** | 외부 서비스 등록 | 외부 API 호출 시 |

### 언제 무엇을 쓸까?

- **외부에서 들어오는 트래픽**: Gateway + VirtualService
- **서비스 간 라우팅**: VirtualService
- **카나리 배포**: VirtualService (weight) + DestinationRule (subset)
- **Circuit Breaker**: DestinationRule (outlierDetection)
- **외부 API 호출 관리**: ServiceEntry + VirtualService/DestinationRule

---

## 🔗 다음 편 예고

Part 2에서는 **Canary 배포와 A/B Testing**을 실전 예시와 함께 다룹니다:
- 단계별 Canary 배포 전략
- 헤더/쿠키 기반 A/B Testing
- 롤백 시나리오

---

## 🔗 참고 자료

- [Istio VirtualService](https://istio.io/latest/docs/reference/config/networking/virtual-service/)
- [Istio DestinationRule](https://istio.io/latest/docs/reference/config/networking/destination-rule/)
- [Istio Gateway](https://istio.io/latest/docs/reference/config/networking/gateway/)
- [Istio ServiceEntry](https://istio.io/latest/docs/reference/config/networking/service-entry/)
