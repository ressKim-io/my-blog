---
title: "Istio Ambient Part 5: JWT 인증 구현과 HS512→RSA 전환기"
excerpt: "Ambient Mode에서 JWT 인증을 구현하며 겪은 HS512에서 RSA로의 전환 과정"
category: istio
tags: ["istio", "ambient-mesh", "jwt", "rsa", "authentication", "kubernetes", concept]
series:
  name: "istio-ambient"
  order: 5
date: "2025-12-25"
---

## 🎯 시작하며

Part 4에서 Wealist를 Ambient로 마이그레이션했습니다. 이번에는 **JWT 인증을 구현하면서 겪은 실제 문제**를 공유합니다.

### 문제 상황

| 단계 | 상황 | 결과 |
|------|------|------|
| 기존 설정 | HS512 (대칭키), Secret Key로 서명 & 검증 | 애플리케이션에서 정상 동작 |
| Istio 설정 시도 | RequestAuthentication에 jwksUri 설정, JWKS 엔드포인트 구현 | ❌ **실패** |
| 문제 원인 | JWKS는 Public Key만 노출, HS512는 Secret Key 노출 필요 | 보안 위험 |
| 해결 | ✅ RSA(비대칭키)로 전환 | 성공 |

Wealist에서는 원래 HS512 알고리즘으로 JWT를 발급하고 있었습니다. 애플리케이션 레벨에서는 문제없이 동작했습니다. 하지만 Istio에서 JWT 검증을 하려면 JWKS(JSON Web Key Set) 엔드포인트를 통해 검증 키를 제공해야 합니다.

문제는 HS512가 대칭키 알고리즘이라는 점입니다. 서명과 검증에 같은 Secret Key를 사용하므로, Istio에 검증 키를 제공하려면 Secret Key 자체를 노출해야 합니다. Secret Key가 노출되면 누구나 유효한 JWT를 위조할 수 있어 심각한 보안 위협이 됩니다.

해결책은 RS256(RSA) 같은 비대칭키 알고리즘으로 전환하는 것입니다. Private Key로 서명하고, Public Key로 검증하므로 JWKS에는 Public Key만 노출하면 됩니다.

---

## 💡 HS512 vs RS256: 왜 전환해야 했나

### 대칭키 vs 비대칭키

![JWT Key Comparison](/images/istio-ambient/jwt-key-comparison.svg)

| 항목 | HS512 (대칭키) | RS256 (비대칭키) |
|------|----------------|------------------|
| 서명 키 | Secret Key | Private Key |
| 검증 키 | Secret Key (동일) | Public Key (다름) |
| Istio 제공 | ⚠️ Secret Key 노출 | ✅ Public Key만 노출 |
| 위조 위험 | ❌ 높음 (키 노출시) | ✅ 낮음 |

대칭키(HS512)와 비대칭키(RS256)의 핵심 차이는 서명과 검증에 사용하는 키가 같은지 다른지입니다.

HS512에서는 Auth Server와 검증자(Istio)가 동일한 Secret Key를 공유합니다. 이 키로 서명도 하고 검증도 합니다. 문제는 Istio에 Secret Key를 제공하면, 그 키를 알고 있는 누구나 유효한 JWT를 만들 수 있다는 점입니다.

RS256에서는 Auth Server만 Private Key를 갖고 있고, 이 키로 서명합니다. Istio는 Public Key만 알면 되고, 이 키로는 검증만 가능합니다. Public Key가 노출되어도 Private Key 없이는 JWT를 위조할 수 없습니다.

### JWKS의 동작 방식

![JWKS Flow|tall](/images/istio-ambient/jwks-flow.svg)

| 단계 | 동작 | 설명 |
|:----:|------|------|
| 1 | Istio → Auth Server | `GET /.well-known/jwks.json` 요청 |
| 2 | Auth Server → Istio | Public Keys 목록 반환 |
| 3 | Client → Istio | JWT 토큰과 함께 API 요청 |
| 4 | Istio | JWT 헤더의 `kid`로 해당 Public Key 찾아 검증 |

JWKS(JSON Web Key Set)는 검증에 사용할 Public Key들을 JSON 형식으로 제공하는 표준입니다. Istio는 `jwksUri`에 설정된 URL에서 JWKS를 가져와 캐싱합니다.

JWKS 응답 예시:
```json
{
  "keys": [{
    "kty": "RSA",         // 키 타입
    "alg": "RS256",       // 알고리즘
    "kid": "key-1",       // 키 ID (중요!)
    "n": "0vx7ago...",    // RSA modulus
    "e": "AQAB"           // RSA exponent
  }]
}
```

JWT를 검증할 때 Istio는 토큰 헤더의 `kid`(Key ID)를 확인하고, JWKS에서 해당 ID의 키를 찾아 서명을 검증합니다. 이 방식으로 여러 키를 동시에 지원할 수 있어 키 로테이션이 가능합니다.

> ⚠️ **주의**: HS512는 JWKS로 제공할 수 없습니다. 검증에 Secret Key가 필요한데, 이를 JWKS로 노출하면 보안 위험이 됩니다.

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

| 단계 | 작업 | 상태 |
|:----:|------|------|
| 1 | 새 키 페어 생성 | `openssl genrsa -out private-v2.pem 2048` |
| 2 | JWKS에 새 키 추가 | key-1 유지 + key-2 추가 |
| 3 | 새 키로 서명 시작 | 신규 JWT는 key-2, 기존 JWT는 key-1로 여전히 유효 |
| 4 | 기존 키 제거 | 기존 JWT 만료 대기 후 key-1 제거 |

키 로테이션은 보안을 위해 정기적으로 수행해야 합니다. JWKS가 여러 키를 지원하기 때문에 무중단 로테이션이 가능합니다.

1. **새 키 생성**: 먼저 새로운 RSA 키 페어를 생성합니다.
2. **JWKS 업데이트**: 새 키를 JWKS에 추가합니다. 이때 기존 키는 그대로 유지합니다. Istio는 JWKS를 주기적으로 갱신하므로 자동으로 새 키를 인식합니다.
3. **새 키 사용 시작**: Auth Server가 새 키로 JWT를 발급하기 시작합니다. 이전에 발급된 JWT도 기존 키로 여전히 검증됩니다.
4. **기존 키 제거**: 기존 JWT가 모두 만료될 때까지 대기한 후(보통 JWT 유효기간 + 여유 시간), JWKS에서 기존 키를 제거합니다.

이 과정을 통해 서비스 중단 없이 키를 교체할 수 있습니다.

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

### 왜 전환했나?

| 문제 | HS512 | RS256 |
|------|-------|-------|
| JWKS 호환 | ❌ Secret Key 노출 필요 | ✅ Public Key만 노출 |
| 보안 | ⚠️ 키 노출 시 위조 가능 | ✅ Public Key로는 위조 불가 |
| Istio 지원 | ❌ 미지원 | ✅ 지원 |

### 전환 작업 체크리스트

| 순서 | 작업 | 완료 확인 |
|:----:|------|-----------|
| 1 | RSA 키 페어 생성 | `private.pem`, `public.pem` 생성 |
| 2 | JWKS 엔드포인트 구현 | `/.well-known/jwks.json` 응답 확인 |
| 3 | 서명 코드 RS256으로 변경 | JWT 헤더에 `"alg": "RS256"` |
| 4 | JWT 헤더에 kid 추가 | `"kid": "wealist-key-1"` |
| 5 | Istio RequestAuthentication 설정 | `jwksUri` 설정 완료 |

### 주의사항

| 항목 | 설명 | 예시 |
|------|------|------|
| issuer 일치 | JWT의 `iss`와 Istio 설정이 정확히 일치해야 함 | `https://auth.wealist.io` |
| kid 필수 | JWT 헤더에 `kid` 포함 필수 | `"kid": "wealist-key-1"` |
| waypoint 필요 | JWT 검증은 L7 기능 → waypoint 배포 필수 | `istioctl waypoint apply` |

전환 과정에서 가장 많이 겪는 문제는 `issuer` 불일치입니다. JWT의 `iss` 클레임과 Istio RequestAuthentication의 `issuer` 필드가 글자 하나까지 정확히 일치해야 합니다. `wealist`와 `https://auth.wealist.io`는 다른 값으로 취급됩니다.

---

## 🎯 핵심 정리

| 항목 | HS512 | RS256 |
|------|-------|-------|
| **키 타입** | 대칭키 | 비대칭키 |
| **서명** | Secret Key | Private Key |
| **검증** | Secret Key | Public Key |
| **JWKS** | ❌ 불가 | ✅ 가능 |
| **Istio 호환** | ❌ | ✅ |

Istio에서 JWT 인증을 사용하려면 RS256(비대칭키) 방식이 필수입니다. HS512(대칭키)를 사용 중이라면 전환이 필요합니다.

전환 과정은 크게 세 단계입니다. 먼저 RSA 키 페어를 생성하고, Auth Server가 Private Key로 서명하도록 수정합니다. 그 다음 JWKS 엔드포인트를 구현해 Public Key를 제공합니다. 마지막으로 Istio에 RequestAuthentication과 AuthorizationPolicy를 설정합니다.

주의할 점은 JWT의 `issuer`, `audience`가 Istio 설정과 정확히 일치해야 한다는 것입니다. 또한 JWT 헤더에 `kid`(Key ID)를 포함해야 Istio가 JWKS에서 올바른 키를 찾을 수 있습니다.

키 로테이션은 JWKS가 여러 키를 지원하기 때문에 무중단으로 진행할 수 있습니다. 새 키를 JWKS에 추가하고, 새 키로 서명을 시작한 후, 기존 JWT가 만료되면 이전 키를 제거하면 됩니다.

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
