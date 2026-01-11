---
title: Service Mesh 완벽 이해 Part 4 - 트래픽 제어의 마법
excerpt: >-
  코드 수정 없이 카나리 배포, A/B 테스팅, Circuit Breaker 구현하기. VirtualService와
  DestinationRule로 트래픽을 자유자재로
category: istio
tags:
  - istio
  - virtualservice
  - destinationrule
  - canary-deployment
  - ab-testing
  - circuit-breaker
  - kubernetes
date: '2025-10-23'
series:
  name: istio
  order: 4
---

> ⚠️ **이 글은 초기 학습 기록입니다.** 트래픽 관리에 대한 더 체계적인 내용은 [istio-traffic 시리즈](/posts/istio-traffic-part1-four-resources)를 참고하세요.

## 🎯 이전 글 요약

**Part 1**: Istio 개념, Kong 없이도 가능

**Part 2**: Control Plane/Data Plane, mTLS 자동화

**Part 3**: Gateway에서 JWT 검증 (3-5일 → 5분)

Part 4에서는 **코드 수정 없이 트래픽을 제어**하는 Istio의 진짜 강력한 기능을 보겠습니다.

---

## 💡 학습 동기

Part 3까지는 "인증/보안"에 집중했다면, Istio의 또 다른 핵심 가치는 **트래픽 제어**입니다.

**궁금했던 것:**
- 신버전 배포 시 일부 트래픽만 보내는 카나리 배포를 어떻게?
- 특정 사용자 그룹만 신기능 테스트하는 A/B 테스팅은?
- 서비스가 장애나면 호출 중단하는 Circuit Breaker는?

k3d로 직접 테스트하면서 "아, 이래서 Istio를 쓰는구나" 실감했습니다.

---

## 🎭 핵심 리소스 2가지

Istio의 트래픽 제어는 두 개의 리소스로 이루어 집니다.

```
VirtualService: "어디로 보낼까?" (라우팅)
DestinationRule: "어떻게 보낼까?" (동작)
```

### VirtualService - 교통 경찰

```
역할: 트래픽 라우팅 결정

예시:
- Header가 "version: v2"면 → v2로
- 90% → v1, 10% → v2 (카나리)
- 경로가 /api/admin이면 → admin 서비스로
```

교통 경찰이 "이 차는 왼쪽, 저 차는 오른쪽"하는 것과 비슷합니다.

### DestinationRule - 주행 규칙

```
역할: 서비스 동작 방식 정의

예시:
- Load Balancing: ROUND_ROBIN, LEAST_CONN
- Circuit Breaker: 5번 실패하면 차단
- Connection Pool: 최대 연결 수 100개
```

목적지에 도착하는 "방법"을 정의 합니다.

---

## 🚀 카나리 배포 (Canary Deployment)

가장 실용적인 기능이다. 신버전을 조심스럽게 배포하는 방법.

### 시나리오

![Canary Deployment](/images/istio/canary-deployment.svg)

| 버전 | 트래픽 비율 | 역할 |
|------|-----------|------|
| **v1 (3 replicas)** | 90% | 안정 버전 - 대부분의 트래픽 처리 |
| **v2 (1 replica)** | 10% | 신기능 테스트 - 점진적으로 비율 증가 |

### 1. Pod에 버전 라벨 추가

```yaml
# Pod 라벨만 추가
labels:
  app: order
  version: v1  # 또는 v2
```

**중요:** 같은 `app` 라벨, 다른 `version`.

### 2. DestinationRule로 서브셋 정의

```yaml
# 핵심만
subsets:
- name: v1
  labels:
    version: v1
- name: v2
  labels:
    version: v2
```

**서브셋(Subset)**: "v1 Pod들", "v2 Pod들"처럼 그룹을 나눈다.

### 3. VirtualService로 트래픽 분할

```yaml
# 핵심만
route:
- destination:
    subset: v1
  weight: 90  # ← 90%
- destination:
    subset: v2
  weight: 10  # ← 10%
```

**이게 끝이다.** 코드 수정 없이 트래픽 분할.

### 4. 점진적 증가

```yaml
# Week 1: 10% 테스트
weight: v1=90, v2=10

# Week 2: 문제없으면 30%
weight: v1=70, v2=30

# Week 3: 50%
weight: v1=50, v2=50

# Week 4: 100% 전환
weight: v1=0, v2=100
```

**YAML 수정만으로 조절 가능.**

### 테스트 확인

```bash
# 100번 요청해보기
for i in {1..100}; do
  curl http://order-service/api/orders | grep version
done

# 결과:
# v1: 90개
# v2: 10개
```

테스트해보니 정확히 90:10 비율로 분산됐다.

---

## 🎯 A/B 테스팅

사용자 그룹별로 다른 버전을 보여주는 방법.

### 시나리오

```
Beta 사용자 → v2 (새 추천 알고리즘)
일반 사용자 → v1 (기존 버전)

목표: 변환율 비교
```

### Header 기반 라우팅

```yaml
# 핵심만
- match:
  - headers:
      user-group:
        exact: beta
  route:
  - destination:
      subset: v2  # Beta 유저 → v2

- route:  # 기본
  - destination:
      subset: v1  # 일반 유저 → v1
```

**동작:**

![A/B Testing](/images/istio/ab-testing.svg)

| 조건 | 라우팅 대상 | 사용 사례 |
|------|-----------|----------|
| `user-group: beta` 헤더 | v2 (신기능) | Beta 사용자 대상 신기능 테스트 |
| 헤더 없음 (기본) | v1 (안정) | 일반 사용자 - 검증된 버전 |

다양한 조건으로 라우팅 가능:
- 지역별 (region: asia, europe)
- 사용자 타입 (user-type: premium, free)
- 경로별 (/api/v1, /api/v2)
- 쿼리 파라미터 (?debug=true)

---

## 🛡️ Circuit Breaker

서비스가 장애나면 호출을 중단해서 장애 전파를 막는다.

### 문제 상황 vs 해결책

![Circuit Breaker](/images/istio/circuit-breaker.svg)

| 구분 | Without Circuit Breaker | With Circuit Breaker |
|------|------------------------|---------------------|
| **장애 시** | User → Order → Payment 모두 느려짐 | 실패한 Pod만 격리 |
| **결과** | 전체 시스템 마비 (Cascading Failure) | 정상 Pod으로 트래픽 라우팅 |
| **복구** | 수동 개입 필요 | 자동 복구 (30초 후 재시도) |

### DestinationRule로 Circuit Breaker

```yaml
# 핵심만
outlierDetection:
  consecutiveGatewayErrors: 5  # 5번 연속 실패하면
  baseEjectionTime: 30s        # 30초간 차단
  maxEjectionPercent: 50       # 최대 50%만 차단
```

**동작:**
```
1. Payment Service Pod 하나가 5번 연속 실패
2. Istio가 해당 Pod을 30초간 제외
3. 다른 정상 Pod으로만 트래픽 전송
4. 30초 후 다시 시도
```

### 테스트

실제로 Payment Service를 일부러 죽여보자.

```bash
# Payment Pod 하나 죽이기
kubectl delete pod payment-v1-abc123

# Order Service에서 호출
curl http://order-service/api/orders

# 결과:
# 처음 5번: 느리게 응답 (실패하는 Pod으로 가서)
# 6번째부터: 빠르게 응답 (차단되어서 정상 Pod만)
```

자동으로 차단되는것을 확인 할 수 있습니다

---

## ⏱️ Retry & Timeout

네트워크는 불안정합니다. 재시도와 타임아웃은 필수로 구성해야 됩니다.

### Retry 정책

```yaml
# 핵심만
retries:
  attempts: 3  # 3번 재시도
  perTryTimeout: 2s
  retryOn: gateway-error,connect-failure
```

**동작:** 실패 → 재시도 → 재시도 → 성공

### Timeout 설정

```yaml
timeout: 5s  # 5초 안에 응답 없으면 실패
```

**Before (코드):** 모든 서비스에 timeout/retry 로직
**After (Istio):** YAML로 중앙 관리, 언어 무관

---

## 🎨 고급 라우팅 패턴

다양한 조건으로 라우팅 가능:

**경로 기반:**
```yaml
- match:
  - uri:
      prefix: /api/v1/
  route:
  - destination:
      host: api-v1-service
```

**기타 가능한 조건:**
- 쿼리 파라미터 (?debug=true)
- Header + 경로 조합
- 정규식 매칭

---

## 💭 배우면서 이해한 핵심

### 1. 코드 수정이 필요 없다

```
카나리 배포 구현:

Before (코드):
- Feature Flag 시스템 구축
- 배포 스크립트 작성
- 모니터링 대시보드
- 롤백 자동화

After (Istio):
- YAML weight 조정
- 끝
```

**설정만으로 해결됩니다.**

### 2. 언어/프레임워크 무관

```
Python 서비스
Node.js 서비스
Go 서비스
Java 서비스

모두 동일한 방식으로 제어됨
```

어떤 언어로 작성됐든 Istio가 트래픽을 제어 할 수 있습니다.

### 3. 실시간 변경 가능

```bash
# 10% → 50%로 변경
kubectl edit virtualservice order-routing

# 즉시 적용 (재배포 없음)
```

수정 후 2-3초 내에 반영됩니다.

### 4. Circuit Breaker가 생명줄

```
Before:
Payment 장애 → Order 느려짐 → User 느려짐 → 전체 마비

After:
Payment 장애 → Circuit 차단 → Order/User 정상
```

장애 전파를 막는 게 핵심.

---

## 🎓 실전 팁

### 1. 카나리 배포 체크리스트

```
✅ 메트릭 확인 (에러율, 응답시간)
✅ 로그 모니터링
✅ 10% → 30% → 50% 단계적 증가
✅ 각 단계마다 2-3일 관찰
✅ 문제 발견 시 즉시 롤백 (weight=0)
```

### 2. Circuit Breaker 설정값

```yaml
# 보수적 (안정성 우선)
consecutiveGatewayErrors: 3  # 적게
baseEjectionTime: 60s        # 길게

# 공격적 (성능 우선)
consecutiveGatewayErrors: 10  # 많게
baseEjectionTime: 10s         # 짧게
```

상황에 맞게 조절.

### 3. 디버깅

```bash
# VirtualService 확인
kubectl get virtualservice order-routing -o yaml

# 실제 라우팅 확인
kubectl exec -it order-pod -c istio-proxy -- \
  curl localhost:15000/config_dump | grep order-service

# 메트릭 확인
kubectl exec -it order-pod -c istio-proxy -- \
  curl localhost:15000/stats | grep retry
```

---

## 🔗 다음 편 예고

Part 4에서는 트래픽 제어를 배웠습니다.

**Part 5에서는:**

- Istio 도입 전 체크리스트

- 단계적 도입 전략 (권장 패턴)

- 흔한 문제와 해결법 (학습 중 겪은 것)

- 트러블슈팅 (로컬 환경 기준)

- 운영 팁

실무에서 Istio를 도입할 때 참고할 수 있는 가이드를 만들어 정리해보겠습니다.

---

## 📚 참고 자료

- [Istio VirtualService 공식 문서](https://istio.io/latest/docs/reference/config/networking/virtual-service/)
- [Istio DestinationRule 공식 문서](https://istio.io/latest/docs/reference/config/networking/destination-rule/)
- [Circuit Breaker Pattern - Martin Fowler](https://martinfowler.com/bliki/CircuitBreaker.html)

---

**작성일**: 2025-10-23
**학습 환경**: k3d 로컬 클러스터
**이전 글**: Part 3 - Gateway와 JWT 인증 실전
**다음 글**: Part 5 - 실무 도입 전략
