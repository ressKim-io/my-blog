---
title: "Istio Traffic Part 2: Canary 배포와 A/B Testing 완전 가이드"
excerpt: "VirtualService의 weight와 match를 활용한 점진적 배포와 A/B Testing 구현"
category: istio
tags: ["istio", "canary", "ab-testing", "deployment", "traffic-management", "kubernetes", concept]
series:
  name: "istio-traffic"
  order: 2
date: "2025-12-14"
---

## 🎯 시작하며

Part 1에서 Istio 트래픽 관리 4대 리소스를 배웠습니다. 이제 가장 실용적인 활용법인 **Canary 배포**와 **A/B Testing**을 다뤄보겠습니다.

![Deployment Strategy Comparison|tall](/images/istio-traffic/deployment-strategy-comparison.svg)

| 전략 | 방식 | 도구 |
|------|------|------|
| **Rolling Update** | v1 → v2 순차 교체 | Kubernetes 기본 |
| **Canary** | v1 90% + v2 10%, 점진적 증가 | Istio VirtualService weight |
| **A/B Testing** | 조건별 분기 (헤더, 쿠키 등) | Istio VirtualService match |

학습하면서 궁금했던 것들입니다:
- Kubernetes Rolling Update와 Canary의 차이는?
- 트래픽 비율은 어떻게 조절할까?
- A/B Testing은 어떤 조건으로 분기할까?

---

## 📊 Kubernetes Rolling Update의 한계

### Rolling Update 동작 방식

```yaml
# Kubernetes Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 1
```

![Rolling Update Problem](/images/istio-traffic/rolling-update-problem.svg)

### Istio Canary의 장점

![Istio Canary Control](/images/istio-traffic/istio-canary-control.svg)

---

## 🐤 Canary 배포 구현

### Step 1: Deployment 준비

```yaml
# v1 Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app-v1
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-app
      version: v1
  template:
    metadata:
      labels:
        app: my-app
        version: v1
    spec:
      containers:
      - name: my-app
        image: my-app:v1
---
# v2 Deployment (Canary)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app-v2
spec:
  replicas: 1                   # 적은 수로 시작
  selector:
    matchLabels:
      app: my-app
      version: v2
  template:
    metadata:
      labels:
        app: my-app
        version: v2
    spec:
      containers:
      - name: my-app
        image: my-app:v2
---
# Service (버전 무관하게 app=my-app 선택)
apiVersion: v1
kind: Service
metadata:
  name: my-app
spec:
  selector:
    app: my-app                 # version label 없음!
  ports:
  - port: 80
    targetPort: 8080
```

### Step 2: DestinationRule로 Subset 정의

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: my-app-destination
spec:
  host: my-app
  subsets:
  - name: v1
    labels:
      version: v1
  - name: v2
    labels:
      version: v2
```

### Step 3: VirtualService로 트래픽 분배

```yaml
# Phase 1: 5% Canary
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: my-app-routing
spec:
  hosts:
  - my-app
  http:
  - route:
    - destination:
        host: my-app
        subset: v1
      weight: 95
    - destination:
        host: my-app
        subset: v2
      weight: 5
```

### Step 4: 점진적 증가

```yaml
# Phase 2: 25% Canary (모니터링 후)
- destination:
    host: my-app
    subset: v1
  weight: 75
- destination:
    host: my-app
    subset: v2
  weight: 25

# Phase 3: 50% Canary
- destination:
    host: my-app
    subset: v1
  weight: 50
- destination:
    host: my-app
    subset: v2
  weight: 50

# Phase 4: 100% v2 (완료)
- destination:
    host: my-app
    subset: v2
  weight: 100
```

### 롤백

문제가 발생하면 즉시 롤백:

```yaml
# 롤백: 100% v1
- destination:
    host: my-app
    subset: v1
  weight: 100
```

---

## 🔄 Canary 배포 자동화

### Flagger를 이용한 자동 Canary

```yaml
apiVersion: flagger.app/v1beta1
kind: Canary
metadata:
  name: my-app
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  service:
    port: 80
  analysis:
    interval: 1m                # 1분마다 분석
    threshold: 5                # 5번 실패 시 롤백
    maxWeight: 50               # 최대 50%까지
    stepWeight: 10              # 10%씩 증가
    metrics:
    - name: request-success-rate
      thresholdRange:
        min: 99                 # 성공률 99% 이상
      interval: 1m
    - name: request-duration
      thresholdRange:
        max: 500                # 응답시간 500ms 이하
      interval: 1m
```

![Flagger Auto Canary](/images/istio-traffic/flagger-auto-canary.svg)

---

## 🧪 A/B Testing 구현

### A/B Testing이란?

특정 조건에 따라 사용자를 그룹으로 나누어 다른 버전을 보여주는 방식입니다.

![Canary vs A/B Testing|tall](/images/istio-traffic/canary-vs-abtest.svg)

| 항목 | Canary | A/B Testing |
|------|--------|-------------|
| **분배 방식** | 무작위 트래픽 분배 | 조건 기반 분배 |
| **목적** | 점진적 배포, 안정성 검증 | 기능 비교, UX/전환율 측정 |
| **사용자 경험** | 같은 사용자가 v1/v2 왔다갔다 | 같은 사용자는 항상 같은 버전 |

### 헤더 기반 A/B Testing

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: my-app-ab
spec:
  hosts:
  - my-app
  http:
  # Group B: 실험 그룹
  - match:
    - headers:
        x-user-group:
          exact: "B"
    route:
    - destination:
        host: my-app
        subset: v2

  # Group A: 대조 그룹 (기본)
  - route:
    - destination:
        host: my-app
        subset: v1
```

### 쿠키 기반 A/B Testing

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: my-app-ab
spec:
  hosts:
  - my-app
  http:
  # 쿠키로 실험 그룹 분기
  - match:
    - headers:
        cookie:
          regex: ".*ab-test=variant-b.*"
    route:
    - destination:
        host: my-app
        subset: v2

  # 기본 그룹
  - route:
    - destination:
        host: my-app
        subset: v1
```

### 사용자 ID 기반 (일관된 경험)

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: my-app-ab
spec:
  hosts:
  - my-app
  http:
  # 특정 사용자 ID (해시 기반)
  - match:
    - headers:
        x-user-id:
          regex: ".*[0-4]$"     # ID 끝자리 0-4: v2
    route:
    - destination:
        host: my-app
        subset: v2

  # 나머지 (ID 끝자리 5-9): v1
  - route:
    - destination:
        host: my-app
        subset: v1
```

### 지역/국가 기반

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: my-app-geo
spec:
  hosts:
  - my-app
  http:
  # 한국 사용자
  - match:
    - headers:
        x-country:
          exact: "KR"
    route:
    - destination:
        host: my-app
        subset: v2-kr

  # 미국 사용자
  - match:
    - headers:
        x-country:
          exact: "US"
    route:
    - destination:
        host: my-app
        subset: v2-us

  # 기본
  - route:
    - destination:
        host: my-app
        subset: v1
```

---

## 🔀 Dark Launch (Shadow Testing)

### Dark Launch란?

실제 사용자에게 영향 없이 새 버전을 테스트하는 방식입니다.

![Dark Launch Flow](/images/istio-traffic/dark-launch-flow.svg)

### Mirror 설정

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: my-app-mirror
spec:
  hosts:
  - my-app
  http:
  - route:
    - destination:
        host: my-app
        subset: v1
    mirror:
      host: my-app
      subset: v2
    mirrorPercentage:
      value: 100.0              # 100% 미러링
```

v2에서 발생하는 에러, 응답시간 등을 모니터링하고, 문제없으면 실제 배포로 전환합니다.

---

## 📊 실전 시나리오

### 시나리오 1: 단계별 Canary + 자동 롤백

```yaml
# Step 1: 5% Canary 시작
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: payment-service
  annotations:
    description: "Phase 1 - 5% Canary"
spec:
  hosts:
  - payment-service
  http:
  - route:
    - destination:
        host: payment-service
        subset: v1
      weight: 95
    - destination:
        host: payment-service
        subset: v2
      weight: 5
    retries:
      attempts: 3
      perTryTimeout: 2s
      retryOn: 5xx,reset
```

모니터링 체크리스트:
```bash
# 에러율 확인
$ kubectl exec -it deploy/prometheus -- \
    promql 'sum(rate(istio_requests_total{destination_service="payment-service",response_code=~"5.."}[5m])) / sum(rate(istio_requests_total{destination_service="payment-service"}[5m]))'

# 응답시간 확인
$ kubectl exec -it deploy/prometheus -- \
    promql 'histogram_quantile(0.99, sum(rate(istio_request_duration_milliseconds_bucket{destination_service="payment-service"}[5m])) by (le))'
```

### 시나리오 2: 내부 테스터만 새 버전

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: feature-preview
spec:
  hosts:
  - frontend
  http:
  # 내부 테스터 (헤더로 구분)
  - match:
    - headers:
        x-internal-tester:
          exact: "true"
    route:
    - destination:
        host: frontend
        subset: preview
    headers:
      response:
        add:
          x-version: "preview"

  # 일반 사용자
  - route:
    - destination:
        host: frontend
        subset: stable
    headers:
      response:
        add:
          x-version: "stable"
```

### 시나리오 3: 점진적 Canary + 특정 사용자 강제

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: hybrid-deployment
spec:
  hosts:
  - my-app
  http:
  # 우선순위 1: 강제 v2 (베타 테스터)
  - match:
    - headers:
        x-beta-user:
          exact: "true"
    route:
    - destination:
        host: my-app
        subset: v2

  # 우선순위 2: 강제 v1 (문제 발생 사용자)
  - match:
    - headers:
        x-force-stable:
          exact: "true"
    route:
    - destination:
        host: my-app
        subset: v1

  # 우선순위 3: Canary (나머지)
  - route:
    - destination:
        host: my-app
        subset: v1
      weight: 80
    - destination:
        host: my-app
        subset: v2
      weight: 20
```

---

## ⚠️ 주의사항

### 1. Subset 없이 weight 사용 불가

```yaml
# ❌ 잘못된 예
- route:
  - destination:
      host: my-app
    weight: 90
  - destination:
      host: my-app
    weight: 10

# ✅ 올바른 예 - subset 필요
- route:
  - destination:
      host: my-app
      subset: v1          # subset 명시
    weight: 90
  - destination:
      host: my-app
      subset: v2          # subset 명시
    weight: 10
```

### 2. DestinationRule 먼저 적용

```yaml
# 순서: DestinationRule → VirtualService
# VirtualService가 참조하는 subset이 먼저 존재해야 함

# 1. 먼저 적용
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: my-app
spec:
  host: my-app
  subsets:
  - name: v1
    labels:
      version: v1
  - name: v2
    labels:
      version: v2
---
# 2. 그 다음 적용
apiVersion: networking.istio.io/v1
kind: VirtualService
...
```

### 3. Weight 합계는 100

```yaml
# ❌ 합계가 100이 아님
- destination:
    host: my-app
    subset: v1
  weight: 80
- destination:
    host: my-app
    subset: v2
  weight: 30              # 합계 110!

# ✅ 합계 100
- destination:
    host: my-app
    subset: v1
  weight: 70
- destination:
    host: my-app
    subset: v2
  weight: 30              # 합계 100
```

### 4. Match 순서 중요

```yaml
http:
# 구체적인 조건 먼저
- match:
  - uri:
      exact: "/api/v2/admin"     # 더 구체적
  route:
  - destination:
      host: admin-service

# 일반적인 조건 나중에
- match:
  - uri:
      prefix: "/api/v2"          # 덜 구체적
  route:
  - destination:
      host: api-service

# 기본 라우트 마지막
- route:
  - destination:
      host: default-service
```

---

## 🛠️ 디버깅

### 트래픽 분배 확인

```bash
# 여러 번 요청하여 분배 확인
$ for i in $(seq 1 100); do
    curl -s http://my-app/version | grep -o "v[0-9]"
  done | sort | uniq -c

# 예상 출력 (90:10 설정 시)
#  90 v1
#  10 v2
```

### VirtualService 상태 확인

```bash
$ kubectl get virtualservice my-app -o yaml

# Envoy 설정 확인
$ istioctl proxy-config routes deploy/my-app -o json | jq '.[] | select(.name=="80")'
```

### 분배가 안 될 때

```bash
# 1. DestinationRule 확인
$ kubectl get destinationrule my-app -o yaml

# 2. Subset에 맞는 Pod 확인
$ kubectl get pods -l version=v2

# 3. Service selector 확인 (version 없어야 함)
$ kubectl get svc my-app -o yaml
```

---

## 📚 정리

![Deployment Strategy Guide](/images/istio-traffic/deployment-strategy-guide.svg)

---

## 🎯 핵심 정리

| 전략 | VirtualService 설정 | 사용 케이스 |
|------|---------------------|-------------|
| **Canary** | `weight` 비율 조절 | 점진적 배포, 리스크 최소화 |
| **A/B Testing** | `match` 조건 분기 | 기능 비교, UX 테스트 |
| **Dark Launch** | `mirror` 트래픽 복제 | 사전 검증, 성능 테스트 |
| **Feature Flag** | `match` + `weight` 조합 | 베타 테스트 + 점진적 배포 |

---

## 🔗 다음 편 예고

Part 3에서는 **Circuit Breaker**를 다룹니다:
- DestinationRule의 outlierDetection
- Connection Pool 설정
- 장애 전파 방지

---

## 🔗 참고 자료

- [Istio Traffic Shifting](https://istio.io/latest/docs/tasks/traffic-management/traffic-shifting/)
- [Istio Request Routing](https://istio.io/latest/docs/tasks/traffic-management/request-routing/)
- [Istio Mirroring](https://istio.io/latest/docs/tasks/traffic-management/mirroring/)
- [Flagger - Progressive Delivery](https://flagger.app/)
