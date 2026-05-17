---
title: "Istio JWT 검증 — RequestAuthentication·JWKS·STRICT mTLS 충돌 원리"
excerpt: "Envoy sidecar가 RequestAuthentication으로 JWT를 검증하는 방식, istiod가 JWKS를 가져오는 경로, 그리고 STRICT mTLS mesh에서 내부 jwksUri가 구조적으로 동작하지 않는 이유를 설명합니다"
category: istio
tags:
  - go-ti
  - istio
  - jwt
  - jwks
  - RequestAuthentication
  - mTLS
  - concept
series:
  name: "goti-deepdive-istio"
  order: 3
date: "2026-04-12"
---

## 한 줄 요약

> Istio의 JWT 검증은 Envoy sidecar가 RequestAuthentication에 내장된 JWKS를 로컬에서 참조해 수행하며, istiod의 JWKS fetch 경로는 Envoy를 우회하기 때문에 STRICT mTLS mesh 내부에 jwksUri를 두면 구조적으로 동작하지 않습니다

---

## 🤔 무엇을 푸는 기술인가

서비스 메시에서 JWT 기반 인증을 도입하면 두 가지 문제가 연결됩니다

첫째, **누가 JWT를 검증하는가** — 애플리케이션 코드에서 직접 검증하면 언어·프레임워크마다 라이브러리가 달라지고 인증 로직이 분산됩니다 Istio는 이 검증을 Envoy sidecar 레이어로 끌어올려 애플리케이션 코드를 건드리지 않고 정책으로 제어할 수 있게 합니다

둘째, **공개키(JWKS)를 어디에 두는가** — JWT를 서명한 비밀키의 쌍인 공개키는 검증자가 접근할 수 있어야 합니다 OIDC 표준은 `/.well-known/jwks.json` 엔드포인트로 공개키를 게시하도록 정의합니다 그런데 Istio의 컨트롤 플레인(istiod)이 이 엔드포인트를 어떻게 호출하느냐에 따라 STRICT mTLS 환경에서 충돌이 생깁니다

이 두 문제의 교차점을 이해하면 Istio 환경에서 JWT 검증을 안정적으로 운영하는 방법을 설계할 수 있습니다

---

## 🔧 동작 원리

### JWT와 JWKS의 구조

JWT(JSON Web Token)는 세 부분으로 구성됩니다 — Header, Payload, Signature 각각은 Base64URL로 인코딩되어 점(`.`)으로 구분됩니다

```text
eyJhbGciOiJSUzI1NiIsImtpZCI6ImdvdGktand0LWtleS0xIn0  ← Header
.eyJpc3MiOiJnb3RpLXVzZXItc2VydmljZSIsInN1YiI6IjEyMyJ9 ← Payload
.SIGNATURE                                               ← RSA 서명
```

Header에는 서명 알고리즘(`alg: RS256`)과 키 식별자(`kid: goti-jwt-key-1`)가 들어갑니다 검증자는 `kid`를 보고 JWKS에서 일치하는 공개키를 찾아 Signature를 검증합니다

**JWKS(JSON Web Key Set)**는 공개키를 JSON으로 표현한 집합입니다 하나의 JWKS에 여러 키를 담을 수 있어 키 회전(rotation) 중 구키와 신키를 동시에 유효 상태로 유지할 수 있습니다

```json
{
  "keys": [
    {
      "kty": "RSA",
      "alg": "RS256",
      "kid": "goti-jwt-key-1",
      "e": "AQAB",
      "n": "tXlfi..."
    }
  ]
}
```

`kty`는 키 타입(RSA), `e`와 `n`은 RSA 공개키 파라미터입니다 검증자는 이 값으로 RSA 서명 검증 연산을 수행합니다

### RequestAuthentication — Envoy가 JWT를 검증하는 방식

Istio에서 JWT 검증은 `RequestAuthentication` CRD로 정의합니다

```yaml
apiVersion: security.istio.io/v1beta1
kind: RequestAuthentication
metadata:
  name: goti-jwt
  namespace: goti
spec:
  selector:
    matchLabels:
      app: goti-stadium-go
  jwtRules:
    - issuer: "goti-user-service"
      jwks: '{"keys":[{"alg":"RS256","kty":"RSA","kid":"goti-jwt-key-1","e":"AQAB","n":"tXlfi..."}]}'
```

`RequestAuthentication`이 적용된 파드로 요청이 들어오면 Envoy sidecar가 다음 순서로 검증합니다

1. `Authorization: Bearer <token>` 헤더에서 JWT를 추출합니다
2. Header의 `kid`를 읽고 `jwks`(또는 `jwksUri`)에서 일치하는 공개키를 찾습니다
3. RS256 알고리즘으로 Signature를 검증합니다
4. Payload의 `iss`가 `issuer`와 일치하는지, `exp`가 만료되지 않았는지 확인합니다

검증이 실패하면 Envoy는 요청을 즉시 **401 Unauthorized**로 반환합니다 검증에 성공하면 Envoy는 JWT Payload의 클레임을 요청 헤더에 주입하고 다음 단계(`AuthorizationPolicy`)로 넘깁니다

**중요한 점**: `RequestAuthentication` 단독으로는 JWT가 없는 요청을 막지 않습니다 JWT가 존재하면 검증하고, 없으면 그냥 통과합니다 JWT가 없는 요청을 차단하려면 `AuthorizationPolicy`에서 `requestPrincipal`을 필수 조건으로 걸어야 합니다

```yaml
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: require-jwt
  namespace: goti
spec:
  selector:
    matchLabels:
      app: goti-stadium-go
  action: ALLOW
  rules:
    - from:
        - source:
            requestPrincipals: ["goti-user-service/*"]
```

이 두 리소스가 함께 동작해야 실질적인 JWT 강제가 이루어집니다

### JWT 검증 흐름 전체

![Istio JWT 검증 흐름도|tall](/diagrams/goti-deepdive-istio-jwt-jwks-1.svg)

위 다이어그램은 JWT 발급부터 검증까지의 전체 경로를 보여줍니다 왼쪽에서 user-service가 RS256 private key로 JWT를 서명해 클라이언트에게 발급합니다 클라이언트는 이 JWT를 `Authorization: Bearer` 헤더에 담아 다른 서비스로 요청을 보냅니다

대상 서비스의 Envoy sidecar는 요청을 인터셉트합니다 Envoy는 메모리에 올려둔 inline JWKS에서 JWT의 `kid`와 일치하는 공개키를 찾아 서명을 검증합니다 검증이 성공하면 `Authorization Policy`를 거쳐 업스트림 애플리케이션으로 전달됩니다 서명 불일치·만료·kid 없음 등 검증 실패 조건에 해당하면 Envoy가 즉시 **401 Unauthorized**를 반환합니다

핵심은 **Envoy가 검증에 필요한 JWKS를 로컬 메모리에 이미 보유하고 있다**는 점입니다 istiod가 xDS(Envoy Discovery Service)를 통해 `RequestAuthentication` 설정 전체를 Envoy에 배포할 때 `jwks` 값도 함께 전달합니다 그 결과 검증 시점에 네트워크 호출이 전혀 발생하지 않습니다

### istiod의 jwksUri fetch 경로 — Envoy를 우회한다

`jwks` 대신 `jwksUri`를 사용하면 istiod가 JWKS를 외부에서 가져옵니다

```yaml
jwtRules:
  - issuer: "goti-user-service"
    jwksUri: "http://goti-user-prod.goti.svc.cluster.local:8080/.well-known/jwks.json"
```

여기서 핵심적인 아키텍처 사실이 있습니다 **istiod의 JWKS fetch는 pilot-discovery 컨테이너가 표준 Go HTTP 클라이언트로 직접 수행합니다** istiod 파드에는 Envoy sidecar가 없거나, 있더라도 JWKS fetch 경로는 이를 경유하지 않도록 구현되어 있습니다

결과적으로 istiod가 발신하는 JWKS 요청에는 mTLS 클라이언트 인증서가 없습니다 Istio mesh 내부에서 파드간 통신은 각 Envoy sidecar가 mTLS 인증서를 관리하고 자동 교환합니다 그러나 istiod는 이 체계 밖에서 plain HTTP로 호출하므로 mTLS 핸드셰이크를 수행할 수 없습니다

### STRICT mTLS와 mesh 내부 jwksUri 충돌

![istiod JWKS fetch와 STRICT mTLS 충돌 구조도|tall](/diagrams/goti-deepdive-istio-jwt-jwks-2.svg)

위 다이어그램은 충돌이 발생하는 구조를 보여줍니다 istiod의 pilot-discovery 컨테이너가 plain HTTP로 user-service의 jwks 엔드포인트를 호출합니다 user-service 파드 앞의 Envoy sidecar는 `PeerAuthentication: STRICT` 정책에 따라 모든 인바운드 연결에 mTLS를 요구합니다

istiod에서 오는 요청은 mTLS 인증서가 없으므로 Envoy는 이 연결을 거부합니다 구체적으로는 두 가지 형태로 나타납니다

- **RBAC 403**: `AuthorizationPolicy`가 `requestPrincipal`을 요구하는데 istiod 요청에는 workload identity가 없어서 principal을 식별할 수 없음
- **연결 거부**: STRICT 모드에서 non-mTLS 연결 자체를 Envoy가 거부

이 제약은 Istio 아키텍처의 설계에서 비롯됩니다 istiod는 컨트롤 플레인이지 데이터 플레인 파드가 아니므로 일반 워크로드처럼 Istio가 자동으로 클라이언트 인증서를 부여하지 않습니다 Istio GitHub에서도 2026년 4월 기준으로 이 문제는 미해결 상태(Issue #40553, #26984, #45138)입니다

다이어그램 오른쪽 하단의 비교 영역이 핵심을 정리합니다 **jwksUri(mesh 내부)** 방식은 istiod가 Envoy를 거치지 않고 직접 호출하기 때문에 STRICT mTLS 환경에서 구조적으로 실패합니다 반면 **inline jwks** 방식은 istiod가 xDS로 Envoy에 JWKS를 배포할 때 네트워크 호출이 완전히 없습니다 mTLS 제약이 개입할 여지 자체가 없는 경로입니다

### jwks_fetch_interval 캐싱

`jwksUri`를 사용하는 경우(mesh 외부 호스팅 포함), istiod는 JWKS를 주기적으로 갱신합니다 기본 갱신 주기는 `jwks_fetch_interval`로 제어하며, Istio 기본값은 **20분**입니다

```yaml
jwtRules:
  - issuer: "https://accounts.google.com"
    jwksUri: "https://www.googleapis.com/oauth2/v3/certs"
    # jwks_fetch_interval은 글로벌 istiod 설정으로 제어
```

이 캐시는 istiod 메모리에 유지됩니다 istiod가 갱신한 JWKS는 xDS를 통해 클러스터 내 모든 Envoy에 배포됩니다 따라서 키를 회전하면 최대 `jwks_fetch_interval` 이후에 모든 Envoy가 새 공개키를 사용하기 시작합니다

inline jwks의 경우 캐싱 개념이 없습니다 `RequestAuthentication` 설정 자체를 변경해야만 JWKS가 바뀝니다 키 회전 시 매번 설정 변경이 필요하다는 단점이 있지만, STRICT mTLS 환경에서는 이 방식이 유일하게 안정적으로 동작하는 경로입니다

---

## 📐 세부 동작과 옵션

### inline jwks vs jwksUri 비교

| 항목 | inline jwks | jwksUri (외부) | jwksUri (mesh 내부) |
|---|---|---|---|
| 네트워크 호출 | 없음 (xDS 배포) | istiod → 외부 URL | istiod → mesh 내부 파드 |
| STRICT mTLS 환경 | 정상 동작 | 정상 동작 | **구조적 실패** |
| 키 회전 방법 | RequestAuthentication 재배포 | 자동 폴링 (jwks_fetch_interval) | 해당 없음 (동작 안 함) |
| 캐시 | Envoy 메모리 (설정 변경 시 갱신) | istiod 캐시 (기본 20분 TTL) | — |
| 가용성 | user-service 무관 | 외부 URL 가용성 의존 | — |
| 표준 준수 | 비표준 (OIDC 표준은 URI 참조) | OIDC 표준 | OIDC 표준 |

mesh 내부 `jwksUri`가 작동하는 유일한 우회 방법들은 모두 보안 트레이드오프를 수반합니다

- **PERMISSIVE 모드로 완화**: STRICT mTLS를 포기해야 함
- **mesh 외부 별도 네임스페이스**: istio-injection 비활성화 네임스페이스에 JWKS 전용 파드 운영, 가용성·관측성 부담
- **공개 도메인 노출**: JWKS 엔드포인트를 인터넷에 노출, 불필요한 공격 면 확대
- **IP 기반 AuthorizationPolicy**: istiod IP를 allowlist에 추가, 동적 IP 환경에서 관리 어려움

### kid 기반 멀티 키 JWKS — 롤아웃 중 401 방지

키 회전 중에 구키로 서명된 JWT와 신키로 서명된 JWT가 동시에 유통될 수 있습니다 JWKS에 두 키를 모두 포함하면 Envoy가 `kid`를 보고 각각의 공개키로 올바르게 검증합니다

```json
{
  "keys": [
    {
      "kid": "goti-jwt-key-1",
      "kty": "RSA",
      "alg": "RS256",
      "e": "AQAB",
      "n": "tXlfi_old..."
    },
    {
      "kid": "goti-jwt-key-2",
      "kty": "RSA",
      "alg": "RS256",
      "e": "AQAB",
      "n": "tXlfi_new..."
    }
  ]
}
```

`kid`가 없는 JWT는 JWKS의 모든 키를 순서대로 시도합니다 `kid`를 명시하면 매칭 키를 즉시 찾아 불필요한 검증 시도를 줄일 수 있습니다

### RequestAuthentication 설정 전파 지연

`RequestAuthentication`을 생성하거나 변경하면 istiod가 변경 내용을 xDS로 클러스터 내 모든 관련 Envoy에 배포합니다 이 전파에는 수 초에서 수십 초가 걸릴 수 있습니다 배포 직후에는 일부 파드에서 아직 구설정을 가지고 있을 수 있습니다

JWKS 업데이트 자체보다 `RequestAuthentication` 리소스 변경이 잦으면 전파 지연으로 인한 일시적 401이 발생할 수 있으니, 키 회전 절차에 안정화 대기 시간을 포함하는 것이 좋습니다

---

## 🧩 go-ti에서는

go-ti의 전체 mesh는 `PeerAuthentication: STRICT`로 운영했습니다 초기 설계에서 user-service에 `/.well-known/jwks.json` 엔드포인트를 구현하고 `jwksUri`로 참조하는 방안(Option A)을 검토했으나, 위에서 설명한 istiod의 JWKS fetch가 Envoy를 우회하는 구조적 제약을 확인하고 기각했습니다

결과적으로 각 Go 서비스 Helm values에 JWKS를 inline으로 하드코딩하는 방식으로 운영했습니다 Phase 6.5에서 stadium-go가 추가되며 하드코딩 지점이 6개로 늘어났고, 이 운영 부담을 줄이기 위해 GitHub Actions 자동화로 키 회전 시 values.yaml을 일괄 업데이트하는 워크플로를 구성했습니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [JWKS 배포 자동화 — inline 하드코딩 제거를 위한 GitHub Actions 도입](/logs/goti-jwks-distribution-automation-adr)에 정리했습니다

---

## 📚 핵심 정리

- Istio JWT 검증은 **Envoy sidecar**가 수행합니다 `RequestAuthentication`이 Envoy에 배포되면 Envoy는 인바운드 요청의 JWT를 로컬 JWKS로 즉시 검증합니다
- `RequestAuthentication` 단독으로는 JWT 없는 요청을 차단하지 않습니다 차단이 필요하면 `AuthorizationPolicy`에서 `requestPrincipal`을 필수 조건으로 추가해야 합니다
- istiod의 JWKS fetch는 **Envoy를 우회**합니다 pilot-discovery 컨테이너가 표준 HTTP 클라이언트로 직접 호출하므로 mTLS 인증서가 없습니다 STRICT mTLS mesh에서 내부 `jwksUri`는 구조적으로 동작하지 않습니다
- **inline jwks**는 네트워크 호출이 없어 STRICT mTLS 환경에서 유일하게 안정적인 방식입니다 단, 키 회전 시 설정 재배포가 필요하므로 자동화 파이프라인을 함께 구성해야 합니다
- 키 회전 중 롤아웃 401을 방지하려면 JWKS에 **구키·신키를 동시 포함**하고 `kid`로 구분합니다
