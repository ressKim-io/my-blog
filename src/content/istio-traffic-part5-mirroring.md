---
title: "Istio Traffic Part 5: Traffic Mirroring으로 안전하게 테스트하기"
excerpt: "실제 트래픽을 복제해서 새 버전을 검증하는 Shadow Testing 구현"
category: istio
tags: ["istio", "traffic-mirroring", "shadow-testing", "virtualservice", "kubernetes", concept]
series:
  name: "istio-traffic"
  order: 5
date: "2025-12-17"
---

## 🎯 시작하며

지금까지 Canary 배포, Circuit Breaker, Retry/Timeout을 배웠습니다. 이번에는 **사용자에게 영향 없이** 새 버전을 실제 트래픽으로 테스트하는 **Traffic Mirroring**을 다룹니다.

![Canary vs Mirroring|tall](/images/istio-traffic/canary-vs-mirroring.svg)

| 구분 | Canary | Traffic Mirroring |
|------|--------|-------------------|
| 트래픽 배분 | 실 트래픽 10%를 v2로 | 실 트래픽 100% 복제 |
| 응답 처리 | 사용자에게 전달 | 응답 버림 |
| 사용자 영향 | 일부 영향 | 영향 없음 |

학습하면서 궁금했던 것들입니다:
- Mirroring은 언제 사용할까?
- 복제된 요청의 응답은 어떻게 처리될까?
- 성능 영향은 없을까?

---

## 💡 Traffic Mirroring이란?

### 개념

Traffic Mirroring(또는 Shadow Testing)은 실제 트래픽을 **복제**해서 새 버전으로 보내는 방식입니다. 복제된 요청의 응답은 **무시**됩니다.

![Traffic Mirroring Operation](/images/istio-traffic/mirroring-operation.svg)

| 단계 | 설명 |
|------|------|
| 원본 요청 | v1 (Primary)로 전송, 응답은 사용자에게 전달 |
| 복제 요청 | v2 (Mirror)로 비동기 전송, 응답은 무시됨 |

### 사용 케이스

1. **새 버전 성능 테스트**: 실제 트래픽 패턴으로 성능 측정
2. **에러 감지**: 새 버전에서 발생하는 에러 사전 발견
3. **데이터 정합성 검증**: v1과 v2 응답 비교
4. **부하 테스트**: 실제 트래픽 패턴으로 부하 테스트

---

## 🔧 기본 설정

### VirtualService Mirror 설정

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
        subset: v1              # 실제 트래픽
    mirror:
      host: my-service
      subset: v2                # 복제 트래픽
    mirrorPercentage:
      value: 100.0              # 100% 복제
```

### DestinationRule (Subset 정의)

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: my-service
spec:
  host: my-service
  subsets:
  - name: v1
    labels:
      version: v1
  - name: v2
    labels:
      version: v2
```

---

## 📊 mirrorPercentage 활용

### 점진적 미러링

```yaml
# Phase 1: 10% 미러링
mirrorPercentage:
  value: 10.0

# Phase 2: 50% 미러링 (문제 없으면)
mirrorPercentage:
  value: 50.0

# Phase 3: 100% 미러링
mirrorPercentage:
  value: 100.0
```

### 왜 점진적으로?

![Gradual Mirroring](/images/istio-traffic/gradual-mirroring.svg)

| 상황 | 설명 |
|------|------|
| 문제 | v1: 10 Pod (1000 req/s) 처리 중, v2: 2 Pod (테스트용) |
| 100% 미러링 시 | v2에 1000 req/s 복제 → 감당 불가 → 장애 |
| 해결 | 10% 미러링 → v2에 100 req/s → 2 Pod로 충분히 처리 가능 |

---

## 🔍 Mirror 트래픽 특성

### 요청 헤더 변경

미러링된 요청은 특별한 헤더가 추가됩니다:

```
# 원본 요청
Host: my-service

# 미러 요청
Host: my-service-shadow       # "-shadow" 접미사 추가
```

애플리케이션에서 이를 활용할 수 있습니다:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    if strings.HasSuffix(r.Host, "-shadow") {
        // 미러 트래픽: 로깅만 하고 부작용 없이 처리
        log.Println("Shadow request received")
    }
    // 정상 처리
}
```

### Fire-and-Forget

![Mirror는 Fire-and-Forget — 원본 흐름과 미러 흐름 비교](/diagrams/istio-traffic-part5-mirroring-1.svg)

---

## 📈 결과 모니터링

### Prometheus 메트릭 비교

```promql
# v1 에러율
sum(rate(istio_requests_total{
  destination_service="my-service",
  destination_version="v1",
  response_code=~"5.."
}[5m]))
/
sum(rate(istio_requests_total{
  destination_service="my-service",
  destination_version="v1"
}[5m]))

# v2 에러율 (미러)
sum(rate(istio_requests_total{
  destination_service="my-service",
  destination_version="v2",
  response_code=~"5.."
}[5m]))
/
sum(rate(istio_requests_total{
  destination_service="my-service",
  destination_version="v2"
}[5m]))
```

### 응답 시간 비교

```promql
# v1 P99 응답 시간
histogram_quantile(0.99,
  sum(rate(istio_request_duration_milliseconds_bucket{
    destination_version="v1"
  }[5m])) by (le)
)

# v2 P99 응답 시간
histogram_quantile(0.99,
  sum(rate(istio_request_duration_milliseconds_bucket{
    destination_version="v2"
  }[5m])) by (le)
)
```

### Grafana 대시보드

![Shadow Testing 대시보드 — v1 vs v2 비교](/diagrams/istio-traffic-part5-mirroring-2.svg)

---

## 🛠️ 실전 예시

### 예시 1: 새 버전 성능 검증

```yaml
# 1. v2 Deployment (적은 수로 시작)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-service-v2
spec:
  replicas: 2                    # 테스트용 2개
  selector:
    matchLabels:
      app: my-service
      version: v2
  template:
    metadata:
      labels:
        app: my-service
        version: v2
    spec:
      containers:
      - name: my-service
        image: my-service:v2
---
# 2. VirtualService (미러링)
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
        subset: v1
    mirror:
      host: my-service
      subset: v2
    mirrorPercentage:
      value: 10.0               # 10%만 미러링 (v2 Pod 수 고려)
```

### 예시 2: 데이터베이스 마이그레이션 검증

```yaml
# 새 DB를 사용하는 v2로 미러링
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: user-service
spec:
  hosts:
  - user-service
  http:
  # 읽기 요청만 미러링 (안전)
  - match:
    - method:
        exact: GET
    route:
    - destination:
        host: user-service
        subset: v1-old-db
    mirror:
      host: user-service
      subset: v2-new-db
    mirrorPercentage:
      value: 100.0

  # 쓰기 요청은 미러링 안 함 (데이터 중복 방지)
  - route:
    - destination:
        host: user-service
        subset: v1-old-db
```

### 예시 3: 외부 서비스 교체 테스트

```yaml
# 결제 API 교체 검증
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: payment-gateway
spec:
  hosts:
  - payment-gateway
  http:
  - route:
    - destination:
        host: payment-gateway
        subset: old-provider
    mirror:
      host: payment-gateway
      subset: new-provider
    mirrorPercentage:
      value: 100.0
---
# 두 provider 정의
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: payment-gateway
spec:
  host: payment-gateway
  subsets:
  - name: old-provider
    labels:
      provider: old
  - name: new-provider
    labels:
      provider: new
```

---

## ⚠️ 주의사항

### 1. 부작용 있는 요청 주의

```yaml
# ❌ 위험: POST 요청 미러링
# - 결제 API 미러링 → 이중 결제!
# - 이메일 발송 → 이중 발송!

http:
- match:
  - method:
      exact: POST
  route:
  - destination:
      host: my-service
      subset: v1
  # mirror: ...   ← POST는 미러링 안 함!

# ✅ 안전: GET 요청만 미러링
- match:
  - method:
      exact: GET
  route:
  - destination:
      host: my-service
      subset: v1
  mirror:
    host: my-service
    subset: v2
```

### 2. 미러 버전에서 부작용 방지

```go
// 애플리케이션에서 Shadow 요청 감지
func handler(w http.ResponseWriter, r *http.Request) {
    isShadow := strings.HasSuffix(r.Host, "-shadow")

    if isShadow {
        // 부작용 있는 작업 건너뛰기
        // - DB 쓰기 ❌
        // - 외부 API 호출 ❌
        // - 이메일 발송 ❌
        return dryRun(r)
    }

    return processNormal(r)
}
```

### 3. 리소스 계획

```
미러링 = 추가 부하!

원본: 1000 req/s
미러링 100%: +1000 req/s
총 부하: 2000 req/s

v2 리소스 계획 필요:
- CPU, Memory 충분히 할당
- Pod 수 적절히 설정
- 또는 mirrorPercentage 낮추기
```

### 4. 네트워크 비용

```
클라우드 환경에서:
- 미러링 = 네트워크 트래픽 2배
- 특히 AZ 간 미러링 시 비용 증가

권장:
- 같은 AZ 내에서 미러링
- 또는 mirrorPercentage 조절
```

---

## 🔄 Shadow Testing 워크플로우

![Shadow Testing Workflow](/images/istio-traffic/shadow-testing-workflow.svg)

| 단계 | 작업 |
|------|------|
| 1 | v2 배포 (replicas: 2) |
| 2 | 10% 미러링 시작 |
| 3 | 메트릭 모니터링 (에러율, 응답시간, 로그) |
| 4 | 문제 있으면 → v2 수정 후 3번으로 |
| 5 | 문제 없으면 → 100% 미러링 |
| 6 | 100% 미러링 최종 검증 |
| 7 | Canary 배포 전환 (mirror 제거, weight 90:10) |
| 8 | Canary 성공 → 100% v2 |

---

## 📚 정리

### Traffic Mirroring 체크리스트

**배포 전**
- [ ] 미러 버전 리소스 계획 (Pod 수, CPU, Memory)
- [ ] 부작용 있는 요청 확인 (POST, PUT, DELETE)
- [ ] 모니터링 대시보드 준비

**미러링 설정**
- [ ] 읽기 요청만 미러링 (안전하게)
- [ ] 적은 비율로 시작 (10%)
- [ ] `-shadow` 헤더 처리 (필요시)

**모니터링**
- [ ] 에러율 비교 (v1 vs v2)
- [ ] 응답시간 비교
- [ ] 로그 분석

**다음 단계**
- [ ] 검증 완료 후 미러링 제거
- [ ] Canary 배포로 전환

---

## 🎯 핵심 정리

| 항목 | 설명 |
|------|------|
| **mirror** | 트래픽을 복제할 대상 지정 |
| **mirrorPercentage** | 복제 비율 (0-100%) |
| **응답 처리** | 미러 응답은 무시됨 (Fire-and-Forget) |
| **호스트 헤더** | `-shadow` 접미사 추가됨 |
| **사용 케이스** | 성능 테스트, 에러 감지, 마이그레이션 검증 |

### Canary vs Mirroring

| | Canary | Mirroring |
|---|--------|-----------|
| 사용자 영향 | 있음 (일부) | 없음 |
| 응답 | 사용자에게 전달 | 무시됨 |
| 목적 | 점진적 배포 | 사전 검증 |
| 순서 | Mirroring → Canary → 전체 배포 |

---

## 🔗 시리즈 마무리

istio-traffic 시리즈를 마쳤습니다!

| Part | 내용 | 상태 |
|------|------|------|
| Part 1 | 4대 리소스 총정리 | ✅ |
| Part 2 | Canary, A/B Testing | ✅ |
| Part 3 | Circuit Breaker | ✅ |
| Part 4 | Retry, Timeout | ✅ |
| Part 5 | Traffic Mirroring | ✅ |

다음 시리즈 **istio-observability**에서는 관측성을 다룹니다:
- 메트릭 수집 (Prometheus + Grafana)
- 분산 트레이싱 (Jaeger)
- Access Log 분석
- Kiali로 시각화

---

## 🔗 참고 자료

- [Istio Traffic Mirroring](https://istio.io/latest/docs/tasks/traffic-management/mirroring/)
- [Istio VirtualService Mirror](https://istio.io/latest/docs/reference/config/networking/virtual-service/#HTTPMirrorPolicy)
- [Shadow Testing Best Practices](https://martinfowler.com/bliki/DarkLaunching.html)
