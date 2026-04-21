---
date: 2026-04-09
type: troubleshoot
tags: [istio, authorizationpolicy, msa, rbac]
severity: high
resolution: fixed
---

# ticketing→resale 내부 호출 시 Istio RBAC 403 차단

## 증상

- `GET /api/v1/tickets/myinfo` → 500 (프론트에서 마이페이지 진입 시)
- goti-ticketing 로그: `403 Forbidden: "RBAC: access denied"`
- `TicketResaleApiClient.getMySales()` → resale `/api/v1/resales/listings/count` 호출 차단

## 호출 흐름

```
프론트 → GET /api/v1/tickets/myinfo → goti-ticketing
                                         ↓ (내부 RestClient 호출)
                                    goti-resale GET /api/v1/resales/listings/count
                                         ↑ Istio RBAC 403 차단
```

## 원인 (2단계)

### 1단계: AuthorizationPolicy ALLOW 누락

goti-resale의 `authorizationPolicy.allowFrom`에 `goti-ticketing` ServiceAccount가 없었음.
기존에는 `from-payment`(goti-payment)만 허용되어 있었음.

### 2단계: require-jwt DENY 정책 우선 평가

`from-ticketing` ALLOW 정책을 추가했지만 여전히 403 발생.

**근본 원인**: Istio AuthorizationPolicy 평가 순서
```
CUSTOM → DENY → ALLOW
```

`goti-resale-dev-require-jwt` 정책이 **DENY action**으로 설정되어 있어,
ALLOW 정책보다 먼저 평가됨. 서비스 간 내부 호출에는 사용자 JWT가 없으므로
`notRequestPrincipals: ["*"]` 조건에 매칭 → DENY.

`/api/v1/resales/listings/count`가 `notPaths`(JWT 제외 경로)에 없었기 때문에 차단됨.

## 수정

### Goti-k8s (dev + prod)

**파일**: `environments/{dev,prod}/goti-resale/values.yaml`

1. `authorizationPolicy.allowFrom`에 `from-ticketing` 규칙 추가:
```yaml
- name: from-ticketing
  rules:
    - from:
        - source:
            principals: ["cluster.local/ns/goti/sa/goti-ticketing-{env}"]
      to:
        - operation:
            paths: ["/api/v1/resales/listings/count"]
            methods: ["GET"]
```

2. `jwtAuthorizationPolicy.excludePaths`에 내부 호출 경로 추가:
```yaml
excludePaths:
  - "/api/v1/resales/histories"
  - "/api/v1/resales/histories/*"
  - "/api/v1/resales/listings/count"   # ← 추가
```

## 교훈

1. **Istio DENY > ALLOW**: DENY 정책이 항상 먼저 평가됨. 서비스 간 내부 호출 경로를 추가할 때 ALLOW만 추가하면 안 되고, JWT DENY 제외 경로도 함께 추가해야 함.
2. **"RBAC: access denied"는 DB 권한이 아님**: Istio Envoy sidecar가 반환하는 HTTP 403. 스택트레이스에서 `HttpClientErrorException.Forbidden`으로 나타남.
3. **MSA 서비스 간 통신 체크리스트**:
   - [ ] application.yml에 대상 서비스 endpoint 설정
   - [ ] K8s values에 환경변수 (BASE_URL) 추가
   - [ ] AuthorizationPolicy ALLOW 규칙 추가
   - [ ] JWT DENY 정책 excludePaths에 내부 호출 경로 추가

## 관련

- 이전 세션: application.yml resale endpoint 누락 → "URI with undefined scheme" ([2026-04-09-session-1](sessions/2026-04-09-session-1.md))
- Goti-server branch: `fix/msa-api-config-errors`
