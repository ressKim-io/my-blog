---
title: "ticketing → resale 내부 호출 시 Istio RBAC 403 — DENY 정책 우선 평가 함정"
excerpt: "goti-ticketing이 goti-resale을 내부 호출할 때 Istio AuthorizationPolicy DENY 정책이 ALLOW보다 먼저 평가되어 403이 발생한 원인과 해결 방법을 정리합니다"
category: istio
tags:
  - go-ti
  - Resale
  - Istio
  - AuthorizationPolicy
  - RBAC
  - troubleshooting
series:
  name: goti-resale
  order: 1
date: "2026-04-09"
---

## 한 줄 요약

> goti-resale의 JWT DENY 정책이 ALLOW 정책보다 먼저 평가되어, `goti-ticketing` 내부 호출 경로가 ALLOW 규칙 추가만으로는 풀리지 않았습니다. excludePaths에 내부 호출 경로를 함께 추가해 해결했습니다

---

## 🔥 문제: 마이페이지 진입 시 500 에러

프론트엔드에서 마이페이지에 진입하면 `GET /api/v1/tickets/myinfo`가 500을 반환했습니다

goti-ticketing 로그를 확인하면 다음 에러가 나타났습니다

```text
403 Forbidden: "RBAC: access denied"
```

호출 흐름을 따라가보겠습니다

```text
프론트 → GET /api/v1/tickets/myinfo → goti-ticketing
                                         ↓ (내부 RestClient 호출)
                                    goti-resale GET /api/v1/resales/listings/count
                                         ↑ Istio RBAC 403 차단
```

`TicketResaleApiClient.getMySales()`가 goti-resale의 `/api/v1/resales/listings/count`를 호출하는 순간 Istio Envoy 사이드카가 요청을 차단했습니다

처음에는 DB 권한 오류로 오해하기 쉽지만, 이 403은 Istio Envoy 사이드카가 반환하는 HTTP 응답입니다. Spring 스택트레이스에서는 `HttpClientErrorException.Forbidden`으로 나타납니다

---

## 🤔 원인: DENY 정책이 ALLOW보다 먼저 평가됨

원인은 두 단계로 나눠서 살펴볼 수 있습니다

### 1단계: AuthorizationPolicy ALLOW 누락

goti-resale의 `authorizationPolicy.allowFrom`에 `goti-ticketing` ServiceAccount가 등록되어 있지 않았습니다. 기존에는 `from-payment`(goti-payment)만 허용된 상태였습니다

이 문제를 발견하고 `from-ticketing` ALLOW 정책을 추가했지만, 여전히 403이 발생했습니다

### 2단계: require-jwt DENY 정책 우선 평가

Istio AuthorizationPolicy 평가 순서는 다음과 같습니다

```text
CUSTOM → DENY → ALLOW
```

`goti-resale-dev-require-jwt` 정책이 **DENY action**으로 설정되어 있었습니다. DENY 정책은 ALLOW 정책보다 항상 먼저 평가됩니다

서비스 간 내부 호출에는 사용자 JWT가 없습니다. 이 때문에 `notRequestPrincipals: ["*"]` 조건에 매칭되어 DENY가 먼저 적용됐습니다

`/api/v1/resales/listings/count` 경로가 `notPaths`(JWT 검증 제외 경로) 목록에 없었기 때문에 차단된 것입니다

---

## ✅ 해결: ALLOW 규칙 추가 + excludePaths 등록

`environments/{dev,prod}/goti-resale/values.yaml`을 두 가지 방향으로 수정했습니다

**1. `authorizationPolicy.allowFrom`에 `from-ticketing` 규칙 추가**

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

**2. `jwtAuthorizationPolicy.excludePaths`에 내부 호출 경로 추가**

```yaml
excludePaths:
  - "/api/v1/resales/histories"
  - "/api/v1/resales/histories/*"
  - "/api/v1/resales/listings/count"   # ← 이번에 추가
```

DENY 정책이 먼저 평가되므로, ALLOW 규칙만 추가해서는 부족합니다. JWT DENY 정책의 `excludePaths`에도 해당 경로를 명시해야 DENY 단계를 통과한 뒤 ALLOW 규칙을 적용받을 수 있습니다

---

## 📚 배운 점

- **Istio DENY > ALLOW**: DENY 정책은 항상 ALLOW보다 먼저 평가됩니다. 새로운 서비스 간 통신 경로를 열 때는 ALLOW 규칙 추가와 함께 JWT DENY 정책의 `excludePaths`도 확인해야 합니다
- **"RBAC: access denied"는 DB 권한이 아닙니다**: Istio Envoy 사이드카가 반환하는 HTTP 403입니다. Spring 코드에서는 `HttpClientErrorException.Forbidden`으로 나타나므로, 로그를 보고 Istio 정책 설정 쪽을 먼저 점검해야 합니다
- **MSA 서비스 간 통신 추가 체크리스트**:
  - `application.yml`에 대상 서비스 엔드포인트 설정 여부
  - K8s values에 환경변수(`BASE_URL`) 추가 여부
  - `AuthorizationPolicy` ALLOW 규칙 추가 여부
  - JWT DENY 정책 `excludePaths`에 내부 호출 경로 추가 여부
