---
title: Service Mesh 완벽 이해 Part 3 - Gateway와 JWT 인증의 진짜 장점
excerpt: 왜 모든 서비스에 JWT 검증 코드를 넣지 않고 Gateway에서만 할까? 20개 서비스 코드 수정 vs 설정 1줄 변경의 차이
category: kubernetes
tags:
  - istio
  - jwt
  - authentication
  - gateway
  - api-gateway
  - security
  - kubernetes
date: '2025-10-23'
series:
  name: istio
  order: 3
---

## 🎯 이전 글 요약

**Part 1**: Istio 개념, Istio만으로도 API Gateway 역할 가능

**Part 2**: Control Plane (Istiod), Data Plane (Envoy), mTLS 자동화

Part 3에서는 **Istio Gateway에서 JWT 인증을 하는 게 왜 좋은지** 실제 사례로 비교해보겠습니다.

---

## 💡 학습 동기

Part 2에서 Istio 아키텍처를 이해했지만, "그래서 실무에서 어떻게 쓰는데?"가 궁금했다.

특히 JWT 인증 관련해서:
- 모든 서비스에 JWT 검증 코드 넣는 게 맞나?
- Gateway에서 한 번만 검증하면 안 되나?
- Istio가 JWT를 어떻게 처리하는지?

**Gateway 레벨 인증**이 훨씬 합리적이었다.

---

## 🤔 문제 상황: 20개 서비스에 JWT 검증?

마이크로서비스 환경을 상상해보자.

```
User Service
Order Service
Payment Service
Product Service
Cart Service
Notification Service
Review Service
...
(총 20개 서비스)
```

모든 서비스가 외부 요청을 받는다면, JWT를 어디서 검증해야 할까?

### 방법 1: 각 서비스에서 검증 (Before)

```
모든 서비스 코드에 JWT 검증 로직 추가:

user-service (Python)
order-service (Node.js)
payment-service (Go)
product-service (Java)
...
```

**문제점:**

```
❌ 20개 서비스 × 50줄 코드 = 1,000줄 중복
❌ 언어마다 다른 JWT 라이브러리
❌ Auth Provider 변경 시 20개 서비스 모두 수정
❌ 보안 패치 시 20개 서비스 재배포
❌ 신규 서비스마다 JWT 로직 다시 작성
```

### 방법 2: Gateway에서 검증 (After)

```
Internet → Istio Gateway (JWT 검증) → Services

Gateway에서 한 번만 검증
서비스는 이미 검증된 요청만 받음
```

**장점:**

```
✅ Gateway 설정 10줄만 추가
✅ 서비스 코드 수정 불필요
✅ Auth Provider 변경 시 설정만 수정
✅ 보안 패치 즉시 적용
✅ 신규 서비스 자동으로 보호됨
```

---

## 🏗️ Before: 각 서비스에서 JWT 검증

먼저 기존 방식이 얼마나 복잡한지 보자.

### 각 서비스에 필요한 것

**Python 서비스:**
- JWT 라이브러리 설치 (jose, PyJWT 등)
- JWKS URL 설정
- Signature 검증 로직 (약 50줄)
- Issuer/Audience 확인
- 에러 핸들링

**Node.js 서비스:**
- JWT 라이브러리 설치 (jsonwebtoken, jwks-rsa)
- 똑같은 검증 로직 (약 40줄)
- 다른 문법으로 다시 작성

**Go, Java 서비스:**
- 또 다른 라이브러리
- 또 다른 문법
- 같은 로직 반복

**핵심 문제:**
```
20개 서비스 × 50줄 코드 = 1,000줄 중복
언어마다 다른 라이브러리/문법
모든 서비스에 같은 로직 반복
```

### 최악의 시나리오: Auth Provider 변경

```
시나리오: Auth0 → Keycloak 전환

변경 사항:
- Issuer URL 변경
- JWKS URL 변경
- Audience 변경

영향받는 파일:
❌ user-service/auth.py
❌ order-service/auth.js
❌ payment-service/auth.go
❌ product-service/auth.java
... (20개 서비스)

작업:
- 20개 서비스 코드 수정
- 20개 서비스 테스트
- 20개 서비스 재배포
- 롤백 시 20개 다시 배포

소요 시간: 3-5일 😱
```

---

## 🚀 After: Istio Gateway에서 JWT 검증

Istio를 사용하면 **Gateway에서 한 번만 검증**하고, 서비스는 비즈니스 로직만 집중한다.

### 1. Istio 설정 (핵심만)

```yaml
jwtRules:
- issuer: "https://auth.company.com"
  jwksUri: "https://auth.company.com/.well-known/jwks.json"
  outputPayloadToHeader: "x-jwt-payload"  # ← 핵심!
```

**이게 끝이다.** Gateway에 이 설정만 추가.

### 2. 서비스 코드 (핵심만)

```python
# JWT 검증 코드 없음! ✅
claims = json.loads(base64.decode(request.headers['x-jwt-payload']))
user_id = claims['sub']
```

**JWT 검증 코드가 없다.** Header 읽기만 한다.

### 어떻게 동작하나?

```
Step 1: Client가 JWT와 함께 요청
┌─────────────┐
│   Client    │
│             │
│ GET /users  │
│ Authorization: Bearer eyJhbG... (JWT)
└─────────────┘
      │
      ↓

Step 2: Istio Gateway에서 검증
┌─────────────────────────────────────┐
│       Istio Gateway                 │
│                                     │
│  RequestAuthentication 적용:        │
│  1. JWT Signature 검증 (JWKS)       │
│  2. Issuer 확인                     │
│  3. Audience 확인                   │
│  4. Expiration 확인                 │
│  5. Claims 추출 → Header 추가       │
│                                     │
│  ✅ 검증 성공!                      │
│  x-jwt-payload: eyJ1c2VyX2lkI...    │
└─────────────────────────────────────┘
      │
      ↓ (검증된 요청 + JWT Claims)

Step 3: User Service는 Header만 읽기
┌──────────────────────────────────────┐
│       User Service (Python)          │
│                                      │
│  # JWT 검증 안 함!                   │
│  claims = get_claims(request)        │
│  user_id = claims['sub']             │
│                                      │
│  # 바로 비즈니스 로직                │
│  return get_user_from_db(user_id)    │
└──────────────────────────────────────┘
```

**핵심:** Gateway가 검증하고, Claims를 Header에 담아서 전달한다.

---

## 💡 핵심 원리: outputPayloadToHeader

가장 중요한 부분이다.

```yaml
jwtRules:
- issuer: "https://auth.company.com"
  jwksUri: "https://auth.company.com/.well-known/jwks.json"
  outputPayloadToHeader: "x-jwt-payload"  # ← 이게 마법!
```

**동작:**

1. Gateway가 JWT를 검증
2. **JWT의 Payload를 추출**
3. **Base64로 인코딩해서 Header에 추가**
4. 서비스로 전달

**서비스는:**
- Header에서 읽기만
- Base64 디코딩 (단순)
- JWT 라이브러리 불필요
- Signature 검증 불필요 (이미 Gateway가 함)

---

## 🎯 Auth Provider 변경 시나리오 비교

동일한 상황: Auth0 → Keycloak 전환

### Before (서비스 코드 수정)

```
😰 20개 서비스 모두 수정 필요:
- user-service/auth.py: Issuer URL 변경
- order-service/auth.js: Issuer URL 변경
- payment-service/auth.go: Issuer URL 변경
... (20번 반복)

배포:
- 20개 서비스 재빌드
- 20개 서비스 재배포
- 20개 서비스 테스트

소요 시간: 3-5일
롤백: 다시 20개 배포
```

### After (Istio 설정만 수정)

```yaml
# ✅ 설정만 변경
jwtRules:
- issuer: "https://keycloak.company.com/realms/myapp"  # 이것만!
```

```
끝! (서비스 재배포 없음)

소요 시간: 5분
롤백: 설정 다시 변경 (5분)
```

**3-5일 vs 5분.**

---

## 🔒 권한 제어: AuthorizationPolicy

JWT 검증 후 권한 제어도 Gateway에서 가능하다.

```yaml
# 핵심만
rules:
- from:
  - source:
      requestPrincipals: ["*"]  # JWT 필수
  when:
  - key: request.auth.claims[role]
    values: ["user", "admin"]  # role 확인
```

**동작:**
```
JWT 없음 → 403 Forbidden
role 없음 → 403 Forbidden
role: user → ✅ 통과
```

서비스 코드 수정 없이 권한 제어 가능.

---

## 💭 배우면서 이해한 핵심

### 1. Gateway 레벨 인증 = 관심사 분리

```
Gateway의 역할:
- 인증 (누구냐?)
- 인가 (권한 있냐?)
- Rate Limiting
- CORS

서비스의 역할:
- 비즈니스 로직만!
- Header에서 user_id 읽기
- DB 조회, 처리
```

**역할이 명확하게 나뉜다.**

Gateway는 보안, 서비스는 비즈니스. 코드가 깔끔해진다.

### 2. 유지보수 시간 90% 단축

```
Before:
Auth Provider 변경 → 3-5일
보안 패치 → 20개 서비스 재배포
신규 서비스 → JWT 코드 다시 작성

After:
Auth Provider 변경 → 5분 (설정만)
보안 패치 → 설정 업데이트
신규 서비스 → 자동으로 보호됨
```

설정 변경이 즉시 반영된다.

### 3. 언어 무관

```
Python 서비스: Header 읽기
Node.js 서비스: Header 읽기
Go 서비스: Header 읽기
Java 서비스: Header 읽기

모두 동일한 방식!
```

JWT 라이브러리가 언어마다 다른 게 문제였는데, Header 읽기는 모든 언어에서 동일하다.

### 4. 테스트가 쉬워짐

```
Before:
서비스 테스트 시 JWT 발급 필요
Mock JWKS 서버 구성
복잡한 테스트 환경

After:
Header에 Claims만 넣으면 됨
{
  "x-jwt-payload": "eyJ1c2VyX2lkIjoxMjN9"
}
간단한 통합 테스트
```

개발 환경에서 테스트하기가 훨씬 쉬워졌다.

---

## 🎓 실전 팁

### 1. JWT 검증 실패 디버깅

```bash
# Istio Gateway 로그 확인
kubectl logs -n istio-system \
  -l app=istio-ingressgateway \
  --tail=100 | grep jwt

# 출력 예시:
# Jwks doesn't have key to match kid
# → JWKS URL이 틀렸거나 kid가 안 맞음

# Token is expired
# → JWT 만료됨
```

### 2. 개발 환경에서 JWT 우회

```yaml
# 개발 환경에서는 JWT 검증 비활성화
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: dev-mode
  namespace: dev
spec:
  mtls:
    mode: PERMISSIVE  # 개발 편의
```

실제 운영에서는 STRICT로 설정.

### 3. 여러 Auth Provider 지원

```yaml
jwtRules:
- issuer: "https://auth0.company.com"
  jwksUri: "https://auth0.company.com/.well-known/jwks.json"
- issuer: "https://keycloak.company.com/realms/app"
  jwksUri: "https://keycloak.company.com/realms/app/protocol/openid-connect/certs"
```

두 개 이상도 가능. 둘 중 하나만 검증되면 통과.

---

## 🔗 다음 편 예고

Part 3에서는 Gateway 레벨 JWT 인증의 장점을 봤다.

**Part 4에서는:**

- VirtualService로 트래픽 라우팅

- 카나리 배포 실전 (v1: 90%, v2: 10%)

- A/B 테스팅 구현

- Circuit Breaker로 장애 전파 방지

- DestinationRule 활용

코드 변경 없이 트래픽을 세밀하게 제어하는 방법을 보겠습니다.

---

## 📚 참고 자료

- [Istio RequestAuthentication 공식 문서](https://istio.io/latest/docs/reference/config/security/request_authentication/)
- [JWT.io - JWT 디버거](https://jwt.io/)
- [Istio Security Best Practices](https://istio.io/latest/docs/ops/best-practices/security/)

---

**작성일**: 2025-10-23
**학습 환경**: k3d 로컬 클러스터
**이전 글**: Part 2 - Istio 아키텍처와 동작 원리
**다음 글**: Part 4 - VirtualService와 트래픽 제어
