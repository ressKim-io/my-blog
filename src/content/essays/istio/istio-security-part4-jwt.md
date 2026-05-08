---
title: "Istio Security Part 4: JWT 인증으로 API 보호하기"
excerpt: "RequestAuthentication과 AuthorizationPolicy를 조합해 JWT 기반 API 인증을 구현하는 방법"
category: istio
tags: ["istio", "jwt", "authentication", "security", "kubernetes", "requestauthentication", concept]
series:
  name: "istio-security"
  order: 4
date: "2025-12-12"
---

## 🎯 시작하며

Part 3에서 AuthorizationPolicy로 **서비스 간 접근 제어**를 배웠습니다. 하지만 실제 서비스에서는 **사용자 인증**도 필요합니다.

| 인증 유형 | 방법 | 설명 |
|----------|------|------|
| **서비스 간 통신** | mTLS + AuthorizationPolicy | Part 1~3에서 배운 서비스 '신원' 확인 |
| **사용자 → 서비스** | JWT 토큰 | 이번 Part 4의 주제! |

학습하면서 궁금했던 것들입니다:
- Istio에서 JWT 검증은 어떻게 동작할까?
- 애플리케이션 코드 수정 없이 JWT 인증이 가능할까?
- JWT 클레임 기반으로 세밀한 인가 정책을 어떻게 만들까?

---

## 💡 JWT 기본 복습

### JWT(JSON Web Token)란?

JWT는 사용자 정보를 담은 토큰입니다. 세 부분으로 구성됩니다:

![JWT Structure](/images/istio-security/jwt-structure.svg)

| 부분 | 내용 | 설명 |
|------|------|------|
| **Header** | `{alg: RS256, typ: JWT}` | 알고리즘, 타입 정보 |
| **Payload** | `{sub: user123, iss: ..., roles: [...]}` | 사용자 정보 (클레임) |
| **Signature** | 서명 | 검증용 서명 |

### 서명 알고리즘: HS256 vs RS256

![Symmetric vs Asymmetric](/images/istio-security/symmetric-vs-asymmetric.svg)

| 알고리즘 | 키 방식 | Auth Server | Istio | 보안 |
|---------|--------|------------|-------|------|
| **HS256** | 대칭키 | Secret Key | Secret Key (동일) | ❌ 유출 시 위조 가능 |
| **RS256** | 비대칭키 | Private Key (서명) | Public Key (검증) | ✅ Public Key 노출 OK |

**Istio에서는 RS256(비대칭키)을 권장합니다.**

이유는 간단합니다. HS256을 쓰면 Istio가 검증하려면 Secret Key가 필요한데, 이걸 Istio에 넣으면 유출 위험이 있습니다. RS256은 Public Key만 있으면 검증 가능하므로 안전합니다.

---

## 🔧 RequestAuthentication 이해하기

### RequestAuthentication이란?

Istio에서 JWT를 검증하는 리소스입니다.

```yaml
apiVersion: security.istio.io/v1
kind: RequestAuthentication
metadata:
  name: jwt-auth
  namespace: default
spec:
  selector:
    matchLabels:
      app: api-server
  jwtRules:
  - issuer: "https://auth.example.com"
    jwksUri: "https://auth.example.com/.well-known/jwks.json"
```

### JWKS(JSON Web Key Set)란?

Public Key를 JSON 형식으로 제공하는 표준입니다.

![JWKS Flow|tall](/images/istio-security/jwks-flow.svg)

| 단계 | 동작 |
|------|------|
| **1** | Istio가 jwksUri에서 Public Key 가져오기 (GET .well-known/jwks.json) |
| **2** | JWKS 응답: keys 배열에 kty, alg, kid, n, e 포함 |
| **3** | JWT 검증 시 kid로 올바른 키 선택하여 검증 |

### RequestAuthentication 상세 설정

```yaml
apiVersion: security.istio.io/v1
kind: RequestAuthentication
metadata:
  name: jwt-auth
  namespace: default
spec:
  selector:
    matchLabels:
      app: api-server
  jwtRules:
  - issuer: "https://auth.example.com"              # JWT의 iss 클레임과 일치해야 함
    jwksUri: "https://auth.example.com/.well-known/jwks.json"
    audiences:                                       # 선택: aud 클레임 검증
    - "api.example.com"
    forwardOriginalToken: true                       # 원본 토큰을 백엔드로 전달
    outputPayloadToHeader: "x-jwt-payload"           # 디코딩된 payload를 헤더로 전달
    fromHeaders:                                     # JWT를 찾을 헤더 (기본: Authorization)
    - name: Authorization
      prefix: "Bearer "
```

### 주요 필드 설명

| 필드 | 설명 | 기본값 |
|------|------|--------|
| `issuer` | JWT의 `iss` 클레임과 일치해야 함 | 필수 |
| `jwksUri` | Public Key를 가져올 URL | 필수 (또는 jwks) |
| `jwks` | 인라인 JWKS (jwksUri 대신 사용) | 선택 |
| `audiences` | 허용할 `aud` 클레임 목록 | 모든 aud 허용 |
| `forwardOriginalToken` | 백엔드에 원본 JWT 전달 | false |
| `outputPayloadToHeader` | 디코딩된 payload를 헤더로 전달 | - |

---

## 🔐 RequestAuthentication + AuthorizationPolicy 조합

**중요한 개념**: RequestAuthentication만으로는 인증이 **강제되지 않습니다**.

| 요청 | RequestAuthentication만 있을 때 |
|------|-------------------------------|
| JWT 없음 | ✅ 통과! (JWT 없는 요청도 허용) |
| 유효한 JWT | ✅ 통과! (JWT 검증 성공) |
| 잘못된 JWT | ❌ 거부! (JWT 검증 실패 = 401) |

⚠️ **JWT가 없으면 그냥 통과시킴!**

JWT를 **필수로** 만들려면 AuthorizationPolicy와 함께 사용해야 합니다.

### 기본 패턴: JWT 필수 + 유효한 Principal

```yaml
# 1단계: JWT 검증 규칙 정의
apiVersion: security.istio.io/v1
kind: RequestAuthentication
metadata:
  name: jwt-auth
  namespace: default
spec:
  selector:
    matchLabels:
      app: api-server
  jwtRules:
  - issuer: "https://auth.example.com"
    jwksUri: "https://auth.example.com/.well-known/jwks.json"
---
# 2단계: JWT가 있는 요청만 허용
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: require-jwt
  namespace: default
spec:
  selector:
    matchLabels:
      app: api-server
  action: ALLOW
  rules:
  - from:
    - source:
        requestPrincipals: ["*"]  # JWT가 있는 모든 요청 허용
```

### 동작 흐름

![JWT Auth Flow](/images/istio-security/jwt-auth-flow.svg)

| Case | RequestAuthentication | AuthorizationPolicy | 결과 |
|------|----------------------|--------------------|----- |
| **JWT 없음** | principal = "" | requestPrincipals 미매칭 | 403 Forbidden |
| **잘못된 JWT** | JWT 검증 실패 | - | 401 Unauthorized |
| **유효한 JWT** | JWT 검증 성공, principal 설정 | requestPrincipals ["*"] 매칭 | 200 OK |

`requestPrincipals: ["*"]`는 "JWT가 있는 모든 요청"을 의미합니다. JWT가 없으면 principal이 설정되지 않아 매칭되지 않습니다.

---

## 📋 실전 시나리오별 설정

### 시나리오 1: 특정 issuer의 JWT만 허용

```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: require-jwt-from-issuer
spec:
  selector:
    matchLabels:
      app: api-server
  action: ALLOW
  rules:
  - from:
    - source:
        # issuer/subject 형식
        requestPrincipals: ["https://auth.example.com/*"]
```

`requestPrincipals`는 `{issuer}/{subject}` 형식입니다.

### 시나리오 2: 특정 사용자만 허용

```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: allow-specific-user
spec:
  selector:
    matchLabels:
      app: api-server
  action: ALLOW
  rules:
  - from:
    - source:
        requestPrincipals: ["https://auth.example.com/user123"]
```

### 시나리오 3: JWT 클레임 기반 인가

JWT의 커스텀 클레임으로 접근 제어를 할 수 있습니다.

```yaml
# JWT Payload 예시
# {
#   "sub": "user123",
#   "iss": "https://auth.example.com",
#   "roles": ["admin", "developer"],
#   "department": "engineering"
# }

apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: admin-only
spec:
  selector:
    matchLabels:
      app: admin-panel
  action: ALLOW
  rules:
  - from:
    - source:
        requestPrincipals: ["*"]
    when:
    - key: request.auth.claims[roles]
      values: ["admin"]
```

### 시나리오 4: 여러 조건 조합

```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: complex-policy
spec:
  selector:
    matchLabels:
      app: api-server
  action: ALLOW
  rules:
  # 규칙 1: admin은 모든 접근 허용
  - from:
    - source:
        requestPrincipals: ["*"]
    when:
    - key: request.auth.claims[roles]
      values: ["admin"]

  # 규칙 2: developer는 GET만 허용
  - from:
    - source:
        requestPrincipals: ["*"]
    to:
    - operation:
        methods: ["GET"]
    when:
    - key: request.auth.claims[roles]
      values: ["developer"]
```

### 시나리오 5: 일부 경로는 공개

```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: mixed-auth
spec:
  selector:
    matchLabels:
      app: api-server
  action: ALLOW
  rules:
  # 규칙 1: /health, /metrics는 JWT 없이 허용
  - to:
    - operation:
        paths: ["/health", "/metrics"]

  # 규칙 2: 그 외는 JWT 필수
  - from:
    - source:
        requestPrincipals: ["*"]
    to:
    - operation:
        notPaths: ["/health", "/metrics"]
```

---

## 🔍 JWT 관련 헤더와 변수

### request.auth.* 변수들

AuthorizationPolicy의 `when` 조건에서 사용할 수 있는 변수들입니다:

| 변수 | 설명 | 예시 |
|------|------|------|
| `request.auth.principal` | issuer/subject | `https://auth.example.com/user123` |
| `request.auth.audiences` | aud 클레임 | `["api.example.com"]` |
| `request.auth.presenter` | azp 클레임 (있으면) | `client-app` |
| `request.auth.claims[name]` | 커스텀 클레임 | `["admin", "dev"]` |

### 클레임 접근 예시

```yaml
# JWT Payload
# {
#   "sub": "user123",
#   "iss": "https://auth.example.com",
#   "groups": ["team-a", "team-b"],
#   "metadata": {
#     "region": "asia"
#   }
# }

when:
# 단순 클레임
- key: request.auth.claims[groups]
  values: ["team-a"]

# 중첩 클레임
- key: request.auth.claims[metadata][region]
  values: ["asia"]
```

---

## 🛠️ 실습: 전체 구성 예시

### 아키텍처

![JWT Practice Architecture](/images/istio-security/jwt-practice-architecture.svg)

| 구성 요소 | 역할 |
|----------|------|
| **Client** | Auth Server에서 JWT 발급 후 API 요청 |
| **Auth Server** | JWT 발급, JWKS 제공 |
| **Istio Gateway** | RequestAuthentication + AuthorizationPolicy로 JWT 검증 |
| **Public API** | JWT 불필요 |
| **User API** | JWT 필수 |
| **Admin API** | admin role 필수 |

### 전체 설정

```yaml
# 1. Gateway에서 JWT 검증
apiVersion: security.istio.io/v1
kind: RequestAuthentication
metadata:
  name: jwt-auth
  namespace: istio-system
spec:
  selector:
    matchLabels:
      istio: ingressgateway
  jwtRules:
  - issuer: "https://auth.example.com"
    jwksUri: "https://auth.example.com/.well-known/jwks.json"
    forwardOriginalToken: true
---
# 2. Public API - 모든 접근 허용
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: public-api-policy
  namespace: default
spec:
  selector:
    matchLabels:
      app: public-api
  action: ALLOW
  rules:
  - {}  # 모든 요청 허용
---
# 3. User API - JWT 필수
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: user-api-policy
  namespace: default
spec:
  selector:
    matchLabels:
      app: user-api
  action: ALLOW
  rules:
  - from:
    - source:
        requestPrincipals: ["https://auth.example.com/*"]
---
# 4. Admin API - admin role 필수
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: admin-api-policy
  namespace: default
spec:
  selector:
    matchLabels:
      app: admin-api
  action: ALLOW
  rules:
  - from:
    - source:
        requestPrincipals: ["https://auth.example.com/*"]
    when:
    - key: request.auth.claims[roles]
      values: ["admin"]
```

---

## 🔧 트러블슈팅

### 문제 1: 401 Unauthorized

JWT 검증 실패입니다.

```bash
# 원인 확인
$ istioctl proxy-config log deploy/api-server --level=debug

# 흔한 원인들
# 1. issuer 불일치
#    - JWT의 iss 클레임과 RequestAuthentication의 issuer가 다름
#    - 슬래시 유무 주의: "https://auth.example.com" vs "https://auth.example.com/"

# 2. 토큰 만료
#    - exp 클레임 확인

# 3. audience 불일치
#    - audiences 설정 시, JWT의 aud 클레임이 포함되어야 함

# 4. jwksUri 접근 불가
#    - Istio가 JWKS URL에 접근할 수 있는지 확인
```

### 문제 2: 403 Forbidden

AuthorizationPolicy에서 거부됩니다.

```bash
# JWT는 유효하지만 정책에 매칭 안 됨
# requestPrincipals나 when 조건 확인

# principal 형식 확인
$ kubectl exec deploy/api-server -c istio-proxy -- \
    pilot-agent request GET /debug/authz

# JWT 디코딩해서 클레임 확인
$ echo "eyJhbGciOiJS..." | cut -d. -f2 | base64 -d | jq .
```

### 문제 3: JWKS 캐싱 문제

```yaml
# jwksUri 대신 jwks를 인라인으로 지정 (테스트용)
jwtRules:
- issuer: "https://auth.example.com"
  jwks: |
    {
      "keys": [{
        "kty": "RSA",
        "alg": "RS256",
        "kid": "key-1",
        "n": "...",
        "e": "AQAB"
      }]
    }
```

### 디버깅 명령어

```bash
# 1. RequestAuthentication 확인
$ kubectl get requestauthentication -A

# 2. AuthorizationPolicy 확인
$ kubectl get authorizationpolicy -A

# 3. Envoy 설정 확인
$ istioctl proxy-config listener deploy/api-server -o json | \
    grep -A 50 "jwt_authn"

# 4. 실시간 로그
$ kubectl logs deploy/api-server -c istio-proxy -f | grep -i jwt
```

---

## 💡 모범 사례

### 1. Gateway 레벨에서 검증

```yaml
# Gateway에서 한 번만 검증하면 됨
apiVersion: security.istio.io/v1
kind: RequestAuthentication
metadata:
  name: jwt-auth
  namespace: istio-system    # Gateway namespace
spec:
  selector:
    matchLabels:
      istio: ingressgateway  # Gateway에 적용
```

### 2. RS256 사용 (비대칭키)

```yaml
# HS256 (대칭키) - 권장하지 않음
# Secret Key가 Istio에 노출됨

# RS256 (비대칭키) - 권장
# Public Key만 노출, 위조 불가
jwtRules:
- issuer: "https://auth.example.com"
  jwksUri: "https://auth.example.com/.well-known/jwks.json"
```

### 3. forwardOriginalToken 활용

```yaml
jwtRules:
- issuer: "https://auth.example.com"
  jwksUri: "https://auth.example.com/.well-known/jwks.json"
  forwardOriginalToken: true  # 백엔드에서도 JWT 활용 가능
```

### 4. 기본 거부 정책

```yaml
# 기본적으로 모든 요청 거부
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: deny-all
  namespace: default
spec:
  {}  # 빈 spec = 모든 요청 거부
---
# 허용할 것만 명시적으로 ALLOW
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: allow-with-jwt
  namespace: default
spec:
  action: ALLOW
  rules:
  - from:
    - source:
        requestPrincipals: ["*"]
```

---

## 📚 정리: JWT 인증 플로우

| 단계 | 동작 | 실패 시 |
|------|------|--------|
| **1** | 사용자가 Auth Server에서 JWT 발급 | - |
| **2** | JWT와 함께 API 요청 (Authorization: Bearer ...) | - |
| **3** | RequestAuthentication: issuer, 서명, exp, aud 검증 | 401 Unauthorized |
| **4** | AuthorizationPolicy: requestPrincipals, claims 검사 | 403 Forbidden |
| **5** | 애플리케이션에 요청 전달 (forwardOriginalToken: true면 JWT 함께) | - |

---

## 🎯 핵심 정리

| 개념 | 설명 |
|------|------|
| **RequestAuthentication** | JWT 검증 규칙 정의, 그 자체로 인증 강제 안 함 |
| **jwksUri** | Public Key를 가져올 JWKS 엔드포인트 |
| **requestPrincipals** | `issuer/subject` 형식, JWT 있는 요청 매칭 |
| **request.auth.claims** | JWT 클레임 기반 조건 설정 |
| **forwardOriginalToken** | 백엔드에 원본 JWT 전달 |
| **RS256 권장** | 비대칭키로 Public Key만 노출, 안전함 |

---

## 🔗 다음 편 예고

istio-security 시리즈를 마쳤습니다!

| Part | 내용 | 상태 |
|------|------|------|
| Part 1 | mTLS와 Zero Trust | ✅ |
| Part 2 | SPIFFE 서비스 신원 | ✅ |
| Part 3 | AuthorizationPolicy | ✅ |
| Part 4 | JWT 인증 | ✅ |

다음 시리즈 **istio-traffic**에서는 트래픽 관리를 다룹니다:
- VirtualService, DestinationRule 4대 리소스
- Canary 배포와 A/B Testing
- Circuit Breaker로 장애 격리
- Retry, Timeout 설정

---

## 🔗 참고 자료

- [Istio RequestAuthentication](https://istio.io/latest/docs/reference/config/security/request_authentication/)
- [Istio JWT](https://istio.io/latest/docs/tasks/security/authorization/authz-jwt/)
- [JWKS 표준](https://datatracker.ietf.org/doc/html/rfc7517)
- [jwt.io - JWT 디버거](https://jwt.io/)
