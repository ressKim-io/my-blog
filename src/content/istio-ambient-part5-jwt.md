---
title: "Istio Ambient Part 5: JWT 인증 구현과 HS512→RSA 전환기"
excerpt: "Ambient Mode에서 JWT 인증을 구현하며 겪은 HS512에서 RSA로의 전환 과정"
category: "kubernetes"
tags: ["istio", "ambient-mesh", "jwt", "rsa", "authentication", "kubernetes"]
series:
  name: "istio-ambient"
  order: 5
date: "2024-12-24"
---

## 🎯 시작하며

Part 4에서 Wealist를 Ambient로 마이그레이션했습니다. 이번에는 **JWT 인증을 구현하면서 겪은 실제 문제**를 공유합니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                    문제 상황                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   기존 JWT 설정:                                                │
│   - 알고리즘: HS512 (대칭키)                                    │
│   - Secret Key로 서명 & 검증                                    │
│   - 애플리케이션에서 잘 동작                                    │
│                                                                 │
│   Istio JWT 설정 시도:                                          │
│   - RequestAuthentication에 jwksUri 설정                        │
│   - JWKS 엔드포인트 구현                                        │
│                                                                 │
│   ❌ 문제: HS512는 JWKS로 제공 불가!                            │
│                                                                 │
│   이유:                                                         │
│   - JWKS는 Public Key만 노출                                    │
│   - HS512는 대칭키 → Secret Key 노출 필요                       │
│   - Secret Key 노출 = 보안 위험                                 │
│                                                                 │
│   ✅ 해결: RSA(비대칭키)로 전환                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 💡 HS512 vs RS256: 왜 전환해야 했나

### 대칭키 vs 비대칭키

```
┌─────────────────────────────────────────────────────────────────┐
│              HS512 (대칭키) vs RS256 (비대칭키)                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   HS512 (HMAC-SHA512)             RS256 (RSA-SHA256)            │
│   ═══════════════════             ══════════════════            │
│                                                                 │
│   같은 Secret Key로              Private Key: 서명              │
│   서명 + 검증                    Public Key: 검증               │
│                                                                 │
│   ┌─────────────────┐            ┌─────────────────┐            │
│   │  Auth Server    │            │  Auth Server    │            │
│   │ ┌─────────────┐ │            │ ┌─────────────┐ │            │
│   │ │ Secret Key  │ │            │ │ Private Key │ │  서명      │
│   │ │ (서명용)    │ │            │ │ (비밀)      │ │            │
│   │ └─────────────┘ │            │ └─────────────┘ │            │
│   └─────────────────┘            └─────────────────┘            │
│                                                                 │
│   ┌─────────────────┐            ┌─────────────────┐            │
│   │  Istio/검증자  │            │  Istio/검증자  │            │
│   │ ┌─────────────┐ │            │ ┌─────────────┐ │            │
│   │ │ Secret Key  │ │ ← 같은 키! │ │ Public Key  │ │  검증만    │
│   │ │ (검증용)    │ │            │ │ (공개 OK)   │ │            │
│   │ └─────────────┘ │            │ └─────────────┘ │            │
│   └─────────────────┘            └─────────────────┘            │
│                                                                 │
│   ⚠️ Istio에 Secret Key 노출     ✅ Public Key만 노출           │
│   → 위조 가능!                   → 위조 불가!                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### JWKS의 동작 방식

```
┌─────────────────────────────────────────────────────────────────┐
│                    JWKS 동작 원리                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   1. Istio가 jwksUri에서 Public Key 가져오기                    │
│                                                                 │
│      Istio ──GET──▶ https://auth.wealist.io/.well-known/jwks.json
│                                                                 │
│   2. JWKS 응답                                                  │
│                                                                 │
│      {                                                          │
│        "keys": [{                                               │
│          "kty": "RSA",           ← 키 타입                      │
│          "alg": "RS256",         ← 알고리즘                     │
│          "kid": "key-1",         ← 키 ID                        │
│          "n": "0vx7ago...",      ← RSA modulus (Public)         │
│          "e": "AQAB"             ← RSA exponent (Public)        │
│        }]                                                       │
│      }                                                          │
│                                                                 │
│   3. JWT 검증                                                   │
│                                                                 │
│      JWT Header: { "alg": "RS256", "kid": "key-1" }             │
│      → JWKS에서 kid="key-1"인 키 찾아서 검증                    │
│                                                                 │
│   ⚠️ HS512는 JWKS로 제공 불가 (Secret Key 노출됨)               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔧 RSA 키 생성

### 키 페어 생성

```bash
# RSA 2048bit 키 생성
$ openssl genrsa -out private.pem 2048

# Public Key 추출
$ openssl rsa -in private.pem -pubout -out public.pem

# 확인
$ cat private.pem
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA...
-----END RSA PRIVATE KEY-----

$ cat public.pem
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9...
-----END PUBLIC KEY-----
```

### JWKS 형식으로 변환

```bash
# node.js 스크립트로 변환
$ cat > generate-jwks.js << 'EOF'
const crypto = require('crypto');
const fs = require('fs');

const publicKey = fs.readFileSync('public.pem', 'utf8');
const key = crypto.createPublicKey(publicKey);
const jwk = key.export({ format: 'jwk' });

const jwks = {
  keys: [{
    kty: 'RSA',
    alg: 'RS256',
    use: 'sig',
    kid: 'wealist-key-1',
    n: jwk.n,
    e: jwk.e
  }]
};

console.log(JSON.stringify(jwks, null, 2));
EOF

$ node generate-jwks.js > jwks.json

$ cat jwks.json
{
  "keys": [{
    "kty": "RSA",
    "alg": "RS256",
    "use": "sig",
    "kid": "wealist-key-1",
    "n": "0vx7agoebGcQ...",
    "e": "AQAB"
  }]
}
```

---

## 🛠️ 애플리케이션 수정

### Before: HS512

```go
// 기존 코드 (HS512)
func GenerateToken(userID string) (string, error) {
    claims := jwt.MapClaims{
        "sub": userID,
        "iss": "wealist",
        "exp": time.Now().Add(time.Hour * 24).Unix(),
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS512, claims)

    // ❌ Secret Key로 서명
    return token.SignedString([]byte(os.Getenv("JWT_SECRET")))
}
```

### After: RS256

```go
// 수정된 코드 (RS256)
var privateKey *rsa.PrivateKey

func init() {
    // Private Key 로드
    keyData, _ := os.ReadFile("/secrets/private.pem")
    block, _ := pem.Decode(keyData)
    privateKey, _ = x509.ParsePKCS1PrivateKey(block.Bytes)
}

func GenerateToken(userID string) (string, error) {
    claims := jwt.MapClaims{
        "sub": userID,
        "iss": "https://auth.wealist.io",  // URL 형식 권장
        "aud": "wealist-api",
        "exp": time.Now().Add(time.Hour * 24).Unix(),
    }

    token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
    token.Header["kid"] = "wealist-key-1"  // Key ID 추가

    // ✅ Private Key로 서명
    return token.SignedString(privateKey)
}
```

### JWKS 엔드포인트

```go
// JWKS 엔드포인트 추가
func JWKSHandler(w http.ResponseWriter, r *http.Request) {
    jwks, _ := os.ReadFile("/config/jwks.json")
    w.Header().Set("Content-Type", "application/json")
    w.Write(jwks)
}

// 라우터 등록
router.HandleFunc("/.well-known/jwks.json", JWKSHandler)
```

---

## 🔐 Istio 설정

### RequestAuthentication

```yaml
apiVersion: security.istio.io/v1
kind: RequestAuthentication
metadata:
  name: jwt-auth
  namespace: default
spec:
  selector:
    matchLabels:
      app: api-gateway
  jwtRules:
  - issuer: "https://auth.wealist.io"
    jwksUri: "https://auth.wealist.io/.well-known/jwks.json"
    audiences:
    - "wealist-api"
    forwardOriginalToken: true
```

### AuthorizationPolicy

```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: require-jwt
  namespace: default
spec:
  selector:
    matchLabels:
      app: api-gateway
  action: ALLOW
  rules:
  # JWT 필수 API
  - from:
    - source:
        requestPrincipals: ["https://auth.wealist.io/*"]
    to:
    - operation:
        paths: ["/api/*"]
        notPaths: ["/api/health", "/api/public/*"]

  # 공개 API
  - to:
    - operation:
        paths: ["/api/health", "/api/public/*", "/.well-known/*"]
```

### waypoint 적용

```bash
# JWT 검증은 L7 기능 → waypoint 필요
$ istioctl waypoint apply --namespace default

# 확인
$ kubectl get gateway -n default
NAME       CLASS            ADDRESS        PROGRAMMED
waypoint   istio-waypoint   10.96.xx.xx    True
```

---

## 🧪 테스트

### JWT 생성 테스트

```bash
# 토큰 생성
$ TOKEN=$(curl -X POST https://auth.wealist.io/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"password"}' \
    | jq -r '.token')

# 토큰 디코딩
$ echo $TOKEN | cut -d. -f2 | base64 -d | jq .
{
  "sub": "user123",
  "iss": "https://auth.wealist.io",
  "aud": "wealist-api",
  "exp": 1735084800
}
```

### Istio 검증 테스트

```bash
# JWT 없이 요청 → 403
$ curl -i http://api-gateway/api/users
HTTP/1.1 403 Forbidden
RBAC: access denied

# 유효한 JWT로 요청 → 200
$ curl -i http://api-gateway/api/users \
    -H "Authorization: Bearer $TOKEN"
HTTP/1.1 200 OK

# 만료된 JWT → 401
$ curl -i http://api-gateway/api/users \
    -H "Authorization: Bearer $EXPIRED_TOKEN"
HTTP/1.1 401 Unauthorized
Jwt is expired
```

### JWKS 캐싱 확인

```bash
# waypoint 로그에서 JWKS 캐싱 확인
$ kubectl logs -n default -l gateway.istio.io/managed | grep jwks

# JWKS 갱신 시 자동으로 캐시 업데이트
```

---

## 📊 키 로테이션

### 여러 키 지원

```json
{
  "keys": [
    {
      "kty": "RSA",
      "alg": "RS256",
      "kid": "wealist-key-2",
      "n": "new-key-modulus...",
      "e": "AQAB"
    },
    {
      "kty": "RSA",
      "alg": "RS256",
      "kid": "wealist-key-1",
      "n": "old-key-modulus...",
      "e": "AQAB"
    }
  ]
}
```

### 로테이션 절차

```
┌─────────────────────────────────────────────────────────────────┐
│                    키 로테이션 절차                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   1. 새 키 페어 생성                                            │
│      $ openssl genrsa -out private-v2.pem 2048                  │
│                                                                 │
│   2. JWKS에 새 키 추가 (기존 키 유지)                           │
│      - kid: "wealist-key-2" 추가                                │
│      - kid: "wealist-key-1" 유지                                │
│                                                                 │
│   3. 새 키로 서명 시작                                          │
│      - 신규 JWT는 kid: "wealist-key-2" 사용                     │
│      - 기존 JWT는 여전히 유효                                   │
│                                                                 │
│   4. 충분한 시간 후 기존 키 제거                                │
│      - 기존 JWT 만료 대기 (예: 24시간)                          │
│      - JWKS에서 kid: "wealist-key-1" 제거                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## ⚠️ 트러블슈팅

### 401 Unauthorized

```bash
# 원인 확인
$ kubectl logs -n default -l gateway.istio.io/managed | grep -i jwt

# 흔한 원인
# 1. issuer 불일치
#    JWT: "iss": "wealist"
#    Istio: issuer: "https://auth.wealist.io"
#    → 정확히 일치해야 함!

# 2. audience 불일치
#    JWT에 aud 없거나 다름

# 3. JWKS 접근 불가
#    Istio가 jwksUri에 접근할 수 있는지 확인
```

### JWKS 접근 문제

```yaml
# ServiceEntry로 외부 JWKS 허용 (필요시)
apiVersion: networking.istio.io/v1
kind: ServiceEntry
metadata:
  name: jwks-endpoint
spec:
  hosts:
  - auth.wealist.io
  location: MESH_EXTERNAL
  ports:
  - number: 443
    name: https
    protocol: HTTPS
  resolution: DNS
```

### kid 누락

```go
// JWT 헤더에 kid 추가 필수!
token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
token.Header["kid"] = "wealist-key-1"  // ← 이거 필요!
```

---

## 📚 정리

```
┌─────────────────────────────────────────────────────────────────┐
│                    HS512 → RS256 전환 요약                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   왜 전환?                                                      │
│   ═══════                                                       │
│   • Istio는 JWKS로 Public Key 가져옴                            │
│   • HS512는 Secret Key = 노출 위험                              │
│   • RS256은 Public Key만 노출 = 안전                            │
│                                                                 │
│   전환 작업                                                     │
│   ═══════                                                       │
│   1. RSA 키 페어 생성                                           │
│   2. JWKS 엔드포인트 구현                                       │
│   3. 서명 코드 RS256으로 변경                                   │
│   4. JWT 헤더에 kid 추가                                        │
│   5. Istio RequestAuthentication 설정                           │
│                                                                 │
│   주의사항                                                      │
│   ═══════                                                       │
│   • issuer 정확히 일치                                          │
│   • kid 필수                                                    │
│   • waypoint 필요 (L7 기능)                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🎯 핵심 정리

| 항목 | HS512 | RS256 |
|------|-------|-------|
| **키 타입** | 대칭키 | 비대칭키 |
| **서명** | Secret Key | Private Key |
| **검증** | Secret Key | Public Key |
| **JWKS** | ❌ 불가 | ✅ 가능 |
| **Istio 호환** | ❌ | ✅ |

---

## 🔗 다음 편 예고

Part 6에서는 **Ambient의 한계: 코드단 Rate Limiting 구현**을 다룹니다:
- EnvoyFilter 미지원 대안
- Redis 기반 Sliding Window
- Go/Gin 미들웨어 구현

---

## 🔗 참고 자료

- [JWT.io](https://jwt.io/)
- [JWKS 표준](https://datatracker.ietf.org/doc/html/rfc7517)
- [Istio JWT](https://istio.io/latest/docs/tasks/security/authorization/authz-jwt/)
- [RSA vs HMAC](https://auth0.com/blog/rs256-vs-hs256-whats-the-difference/)
