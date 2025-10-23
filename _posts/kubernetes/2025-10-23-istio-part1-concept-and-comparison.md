---
title: "[Istio] Service Mesh 완벽 이해 Part 1 - Kong과 뭐가 다를까?"
excerpt: "마이크로서비스가 복잡해지면서 Istio가 필요한 이유. Kong API Gateway와의 차이점부터 언제 무엇을 써야 하는지까지"
categories:
  - kubernetes
  - devops
  - service-mesh
tags:
  - istio
  - kong
  - api-gateway
  - microservices
  - service-mesh
  - kubernetes
series: "istio-service-mesh-guide"
toc: true
toc_sticky: true
date: 2025-10-23 10:00:00 +0900
last_modified_at: 2025-10-23 10:00:00 +0900
---

## 🎯 시작하며

부트캠프에서 마이크로서비스 아키텍처를 배우면서 API Gateway로 Kong을 공부했다. 그런데 실무 아키텍처 자료를 보다 보니 Istio라는 게 자꾸 나왔다. "API Gateway는 Kong 쓰면 되는 거 아닌가?" 싶었는데, 알고 보니 둘이 해결하는 문제가 달랐다.

이번 시리즈에서는 Istio Service Mesh가 뭔지, Kong과 어떻게 다른지, 언제 써야 하는지 정리해봤습니다.

---

## 💡 왜 Istio를 배우게 됐나?

### 마이크로서비스의 복잡도 폭발

모놀리식 시절에는 단순했다.

```
[Client] ──── HTTP ──── [Single App] ──── [Database]
```

모든 게 하나의 애플리케이션 안에 있으니 네트워크 호출도 최소화되고, 디버깅도 쉬웠다. 하지만 확장성에 한계가 있다.

마이크로서비스로 전환하면?

```
[Client] ──── ? ──── [User Service]
                     [Order Service]
                     [Payment Service]
                     [Product Service]
                     [Notification Service]
                     ...
```

갑자기 복잡도가 폭발한다.

**문제점들:**
1. 클라이언트가 어느 서비스로 가야 하나?
2. 모든 서비스마다 인증 로직을 넣어야 하나?
3. 서비스 A → B → C 호출 체인이 복잡해지면?
4. 로깅, 모니터링, 보안을 모든 곳에 중복으로?
5. 하나가 죽으면 전체가 죽는 장애 전파는?

처음 이 문제들을 봤을 때 "이거 어떻게 관리하지?"라는 생각이 들었다.

---

## 🤔 Kong vs Istio - 뭐가 다를까?

Kong을 공부하면서 "API Gateway로 다 해결되는 거 아닌가?"라고 생각했다. 근데 Istio 자료를 보니 해결하는 문제가 달랐다.

### Kong이 해결하는 문제 (North-South Traffic)

```
          외부 → 내부 (North-South)

                Internet
                    │
                    ↓
        ┌───────────────────────┐
        │   Kong API Gateway    │
        │  - 인증/인가           │
        │  - Rate Limiting      │
        │  - API 변환           │
        └───────────────────────┘
                    │
        ┌───────────┼───────────┐
        │           │           │
        ↓           ↓           ↓
  ┌─────────┐ ┌─────────┐ ┌──────────┐
  │  User   │ │ Order   │ │ Payment  │
  │ Service │ │ Service │ │ Service  │
  └─────────┘ └─────────┘ └──────────┘
```

Kong은 **외부 트래픽이 내부로 들어올 때**를 관리한다.

**Kong의 강점:**
- 외부 API 관리 (API 키, Rate Limiting)
- 인증/인가 (OAuth, JWT 검증)
- 요청/응답 변환
- API 문서화, 수익화

한마디로, **외부 세계와 내부 시스템의 경계**를 지키는 역할이다.

### Istio가 해결하는 문제 (East-West Traffic)

```
          서비스 간 통신 (East-West)

┌──────────┐      mTLS      ┌──────────┐
│ Service  │ ←────────────→ │ Service  │
│    A     │                │    B     │
└──────────┘                └──────────┘
     │                           │
     │ mTLS                      │ mTLS
     ↓                           ↓
┌──────────┐                ┌──────────┐
│ Service  │ ←────────────→ │ Service  │
│    C     │      mTLS      │    D     │
└──────────┘                └──────────┘
      ↘                      ↙
       ↘      mTLS          ↙
        ↘                  ↙
         ↓                ↓
        ┌──────────────────┐
        │    Service E     │
        └──────────────────┘
```

Istio는 **서비스들끼리 통신할 때**를 관리한다.

**Istio의 강점:**
- 서비스 간 통신 자동 암호화 (mTLS)
- 트래픽 라우팅 (카나리 배포, A/B 테스팅)
- 서비스 간 접근 제어
- 분산 추적, 메트릭 수집
- Circuit Breaker, Retry 정책

한마디로, **서비스 메시 내부의 통신**을 관리한다.

### 핵심 차이점

```
Kong:  외부 트래픽 관리 전문
Istio: 서비스 간 통신 관리 전문
```

그렇다면 둘 다 써야 할까?

### Istio만 써도 될까? (중요!)

결론부터 말하면: **대부분의 경우 Istio만으로도 충분하다.**

Istio Gateway로 외부 트래픽도 처리할 수 있다. 실제로 많은 기업들이 Kong 없이 Istio만 쓴다.

**Istio Gateway로 할 수 있는 것:**
- ✅ SSL/TLS 종료
- ✅ 도메인/경로 기반 라우팅
- ✅ JWT 검증 (Part 3에서 다룰 예정)
- ✅ Rate Limiting
- ✅ CORS 설정
- ✅ 트래픽 분할 (카나리, A/B 테스팅)

**실무 패턴 :**

```
패턴 1: Istio만 사용 (30-40%)
┌──────────┐     ┌──────────────┐     ┌─────────────┐
│ Internet │ ──→ │Istio Gateway │ ──→ │Service Mesh │
└──────────┘     └──────────────┘     └─────────────┘
→ 클라우드 네이티브 스타트업
→ 내부 서비스 중심 (B2B SaaS)
→ 비용 절감 (Kong Enterprise 비쌈)

패턴 2: Nginx + Istio (40-50%)
┌──────────┐   ┌────────┐   ┌──────────────┐   ┌──────────┐
│ Internet │──→│ Nginx  │──→│Istio Gateway │──→│ Services │
└──────────┘   └────────┘   └──────────────┘   └──────────┘
               (SSL 종료)   (라우팅/보안)
→ 가장 흔한 패턴
→ Nginx는 단순 SSL 종료만
→ Istio는 내부 라우팅/보안

패턴 3: Kong + Istio (10-20%)
┌──────────┐   ┌──────┐   ┌──────────────┐   ┌──────────┐
│ Internet │──→│ Kong │──→│Istio Gateway │──→│ Services │
└──────────┘   └──────┘   └──────────────┘   └──────────┘
             (API 관리)    (서비스 메시)
→ 외부 API 비즈니스 중요
→ API 수익화, 파트너 연동
```

**Kong이 진짜 필요한 경우:**

❗ **API 수익화** (사용량 과금, 플랜별 제한)
❗ **API 개발자 포털** (문서 자동화, API Key 관리)
❗ **복잡한 프로토콜 변환** (REST ↔ SOAP)
❗ **200개 이상의 플러그인 생태계** 활용

이런 게 아니면 Istio만으로 충분하다.

**나의 선택:**

부트캠프 프로젝트나 초기 스타트업은 **Istio만으로 시작**하는 게 낫다. Kong은 외부 API 비즈니스가 중요해지면 그때 추가해도 늦지 않다.

Kong Enterprise 라이선스 비용도 만만치 않다고 한다.

---

## 🏗️ Service Mesh란 뭔가?

Istio를 이해하려면 먼저 Service Mesh 개념을 알아야 한다.

### 기존 방식의 문제

```
┌─────────────────────────────┐
│      Application            │
│  ┌──────────┐  ┌──────────┐ │
│  │ 비즈니스 │  │ 네트워크 │ │
│  │ 로직     │  │ 로직     │ │
│  │          │  │          │ │
│  │- 주문처리│  │- HTTP    │ │
│  │- 결제검증│  │- 재시도  │ │
│  │- 재고확인│  │- 타임아웃│ │
│  └──────────┘  └──────────┘ │
└─────────────────────────────┘
```

애플리케이션 코드에 비즈니스 로직과 네트워크 로직이 섞여 있다.

**문제점:**
- 모든 서비스에 네트워크 로직 중복
- 언어마다 다른 라이브러리 사용
- 정책 변경 시 모든 서비스 재배포

### Service Mesh의 해법

```
┌─────────────────────────────────────────┐
│              POD                        │
│  ┌──────────────┐    ┌──────────────┐   │
│  │ Application  │    │ Envoy Proxy  │   │
│  │              │    │ (Sidecar)    │   │
│  │ ┌──────────┐ │    │ ┌──────────┐ │   │
│  │ │비즈니스  │ │◄──►│ │네트워크  │ │   │
│  │ │로직만!   │ │    │ │기능 전담 │ │   │
│  │ │          │ │    │ │          │ │   │
│  │ │- 주문처리│ │    │ │- mTLS    │ │   │
│  │ │- 결제검증│ │    │ │- 재시도  │ │   │
│  │ │- 재고확인│ │    │ │- 메트릭  │ │   │
│  │ └──────────┘ │    │ └──────────┘ │   │
│  └──────────────┘    └──────────────┘   │
└─────────────────────────────────────────┘
```

**Service Mesh는 네트워크 로직을 분리한다.**

모든 Pod 옆에 **Envoy Proxy(Sidecar)**가 붙어서 네트워크 관련 일을 대신 처리한다. 애플리케이션은 localhost로만 통신하면 되고, 실제 네트워크 처리는 Envoy가 담당한다.

**장점:**
- 관심사 분리 (비즈니스 vs 네트워크)
- 언어 무관 (Python, Go, Java 상관없음)
- 중앙에서 정책 관리
- 코드 수정 없이 기능 추가

---

## 📊 언제 뭘 써야 할까?

학습하면서 가장 궁금했던 부분이다. "그래서 나는 뭘 써야 하는데?"

### 기업 규모별 선택 가이드

실무 자료들을 찾아보니 규모에 따라 선택이 다르다고 한다.

**소규모 (서비스 1-10개)**
```
Internet → Nginx Ingress → Services
또는
Internet → Istio Gateway → Services
```

- Nginx나 Istio Gateway 중 하나만
- 빠른 구축, 낮은 학습 비용
- Service Mesh까지는 불필요

**중규모 (서비스 10-50개)**
```
Internet → Istio Gateway → Service Mesh (전체)
또는
Internet → Nginx → Istio Gateway → Service Mesh
```

- Istio Gateway로 외부/내부 모두 관리
- 또는 Nginx는 단순 SSL만 담당
- Kong은 아직 불필요

**대규모 (서비스 50개 이상)**
```
Internet → Istio Gateway → Service Mesh
+ (필요시) Kong for API 비즈니스
```

- Istio는 기본
- API 수익화 필요하면 Kong 추가
- 하지만 Kong 없이도 가능

### 나의 상황은?

부트캠프 프로젝트 수준에서는:
- 서비스 개수: 5개 이하
- 복잡도: 낮음
- **결론: Nginx Ingress면 충분**

하지만 Istio를 배우는 이유는:
1. Service Mesh 개념 자체가 중요
2. 마이크로서비스가 늘어날 때를 대비
3. 실무에서 많이 쓰이니 미리 학습
4. Kong 없이도 API Gateway 역할 가능

---

## 🎯 Istio를 써야 하는 경우

학습한 내용을 정리하면 이런 경우에 Istio가 필요하다.

### ✅ Istio가 적합한 경우

**1. 마이크로서비스가 많다 (20개 이상)**
- 서비스 간 통신이 복잡
- 수동 관리 불가능

**2. 보안이 중요하다**
- 서비스 간 통신 암호화 필수 (mTLS)
- 세밀한 접근 제어 필요
- 금융, 헬스케어 등

**3. 카나리 배포, A/B 테스팅이 필요하다**
- 트래픽을 세밀하게 제어
- 코드 변경 없이 라우팅 조정

**4. 관측성이 중요하다**
- 서비스 간 호출 추적
- 어디서 병목이 생기는지 확인
- 장애 원인 빠르게 파악

**5. Zero Trust 네트워크를 구축한다**
- 내부 통신도 신뢰하지 않음
- 모든 통신 암호화 + 인증

### ❌ Istio가 부적합한 경우

**1. 서비스가 적다 (10개 미만)**
- 오히려 복잡도만 증가
- 관리 오버헤드

**2. 팀의 학습 시간이 부족하다**
- Kubernetes도 어려운데 Istio까지?
- 최소 2-3개월 학습 필요

**3. 레거시 시스템이 대부분이다**
- 컨테이너화도 안 된 상태
- 단계적으로 모던화 먼저

**4. 즉시 결과가 필요하다**
- Istio는 초기 설정이 복잡
- 빠른 프로토타입에는 부적합

---

## 💭 배우면서 이해한 핵심

### 1. Istio만으로도 API Gateway 역할이 가능하다

처음엔 "외부 트래픽은 Kong, 내부는 Istio"라고 생각했다. 하지만 **Istio Gateway로 외부 트래픽도 처리할 수 있다.**

```
기존 오해: Kong(외부) + Istio(내부) 필수
현실:     Istio만으로도 충분 (대부분 경우)

Kong이 필요한 경우:
- API 수익화 비즈니스
- 복잡한 플러그인 생태계 필요
- API 개발자 포털 필요

이런 게 아니면 Istio만 써도 됨
```

실제로 30-40%의 기업이 Istio만 사용한다고 한다.

### 2. Service Mesh = 네트워크 로직 분리

가장 중요한 개념이다. 애플리케이션 코드에서 네트워크 관련 로직을 완전히 분리한다.

```
Before: 앱 코드에 HTTP 클라이언트, 재시도, 타임아웃 로직
After:  앱은 localhost만 보고, Sidecar가 나머지 처리
```

이게 가능한 이유는 **Sidecar Pattern** 때문이다. 모든 Pod에 Envoy Proxy가 붙어서 모든 네트워크를 대신 처리한다.

### 3. 규모에 맞는 선택이 중요하다

모든 프로젝트에 Istio가 필요한 건 아니다.

```
서비스 5개: Istio 불필요
서비스 20개: Istio 검토 시작
서비스 50개: Istio 거의 필수
```

내 프로젝트 규모를 먼저 파악하고, 현재는 Kong만 써도 충분한지 판단해야 한다.

### 4. 학습 곡선이 높다

Kubernetes를 어느 정도 이해해야 Istio를 배울 수 있다.

```
학습 순서:
1. Kubernetes 기초 (Pod, Service, Deployment)
2. Kubernetes 네트워킹 (Ingress, DNS)
3. Istio 개념 (Service Mesh, Sidecar)
4. Istio 리소스 (Gateway, VirtualService)
```

나도 K8s를 먼저 공부하고 나서야 Istio가 이해되기 시작했다.

---

## 🔗 다음 편 예고

Part 1에서는 Istio가 뭔지, Kong과 어떻게 다른지, 언제 써야 하는지 개념을 잡았다.

**Part 2에서는:**
- Istio 아키텍처 (Control Plane, Data Plane)
- Sidecar가 정확히 어떻게 동작하는지
- 요청이 실제로 어떤 경로로 흐르는지
- mTLS 자동화의 원리

실제로 Pod A에서 Pod B로 요청을 보낼 때 내부에서 무슨 일이 일어나는지 파헤쳐 보겠습니다.

---

## 📚 참고 자료

- [Istio 공식 문서](https://istio.io/latest/docs/)
- [Kong vs Istio - 아키텍처 비교](https://www.cncf.io/blog/)
- [Service Mesh 개념 - Martin Fowler](https://martinfowler.com/articles/microservices.html)

---

**작성일**: 2025-10-23
**학습 환경**: k3d 로컬 클러스터
**다음 글**: Part 2 - Istio 아키텍처와 동작 원리
