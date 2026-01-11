---
title: "AuthorizationPolicy 완전 정복"
excerpt: "from, to, when 조건 상세 설명, ALLOW vs DENY 평가 순서, 서비스 간 접근 제어 실전 시나리오"
category: istio
tags:
  - istio
  - authorization
  - authorizationpolicy
  - rbac
  - security
  - kubernetes
series:
  name: "istio-security"
  order: 3
date: "2025-12-11"
---

## 🎯 이전 글 요약

**Part 1**: Zero Trust, mTLS, PeerAuthentication

**Part 2**: SPIFFE ID, 인증서 발급/갱신, ServiceAccount

Part 3에서는 **AuthorizationPolicy**를 파헤쳐보겠습니다. "누가 무엇을 할 수 있는지" 제어하는 인가(Authorization) 정책입니다.

---

## 🔐 인증 vs 인가

먼저 개념을 명확히 합시다.

![Authentication vs Authorization](/images/istio-security/authn-vs-authz.svg)

| 구분 | 질문 | 방법 | Istio 리소스 |
|------|------|------|-------------|
| **인증 (Authentication)** | "너 누구야?" | mTLS, JWT | PeerAuthentication, RequestAuthentication |
| **인가 (Authorization)** | "이거 할 수 있어?" | 정책 검사 | AuthorizationPolicy |

**요청 흐름**: 요청 → [인증] → 신원 확인 → [인가] → 접근 허용/거부

---

## 📋 AuthorizationPolicy 구조

```yaml
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: my-policy
  namespace: default
spec:
  selector:           # 어떤 워크로드에 적용?
    matchLabels:
      app: my-service
  action: ALLOW       # ALLOW, DENY, CUSTOM, AUDIT
  rules:              # 규칙 목록
  - from:             # 누가? (source)
    - source:
        principals: ["cluster.local/ns/default/sa/client-sa"]
    to:               # 뭘? (destination)
    - operation:
        methods: ["GET"]
        paths: ["/api/*"]
    when:             # 언제? (조건)
    - key: request.headers[x-token]
      values: ["valid"]
```

### 구조 시각화

![AuthorizationPolicy Structure](/images/istio-security/authz-policy-structure.svg)

| 섹션 | 역할 | 주요 필드 |
|------|------|----------|
| **selector** | 정책 적용 대상 | matchLabels: app: my-service |
| **action** | 매칭 시 동작 | ALLOW, DENY, CUSTOM, AUDIT |
| **from** | 요청자 조건 | principals (SPIFFE ID), namespaces, ipBlocks |
| **to** | 요청 내용 조건 | methods, paths, ports, hosts |
| **when** | 추가 조건 | request.headers, request.auth.claims |

---

## 📌 from 조건 상세

요청의 **출처(Source)**를 기반으로 필터링합니다.

```yaml
from:
- source:
    # SPIFFE ID (가장 권장)
    principals: ["cluster.local/ns/production/sa/order-service"]

    # Namespace
    namespaces: ["production", "staging"]

    # IP 대역
    ipBlocks: ["10.0.0.0/8"]

    # 부정 조건 (not)
    notPrincipals: ["cluster.local/ns/default/sa/untrusted"]
    notNamespaces: ["development"]
    notIpBlocks: ["192.168.1.0/24"]
```

### principals 패턴

| 패턴 | 예시 | 설명 |
|------|------|------|
| **정확히 일치** | `cluster.local/ns/prod/sa/order-sa` | 특정 SA만 |
| **NS 내 모든 SA** | `cluster.local/ns/prod/sa/*` | prod NS의 모든 SA |
| **모든 NS의 특정 SA** | `cluster.local/ns/*/sa/admin-sa` | admin-sa만 |
| **접두사 매칭** | `cluster.local/ns/prod/*` | prod NS 전체 |
| **여러 principals** | 배열로 나열 | OR 조건 |

---

## 📌 to 조건 상세

요청의 **대상(Operation)**을 기반으로 필터링합니다.

```yaml
to:
- operation:
    # HTTP 메서드
    methods: ["GET", "POST"]
    notMethods: ["DELETE"]

    # URL 경로
    paths: ["/api/v1/*", "/health"]
    notPaths: ["/admin/*"]

    # 포트
    ports: ["8080", "8443"]

    # 호스트
    hosts: ["api.example.com"]
```

### paths 패턴

| 패턴 | 예시 | 매칭 |
|------|------|------|
| **정확히 일치** | `/api/users` | /api/users만 |
| **접두사 와일드카드** | `/api/*` | /api/users, /api/orders 등 |
| **접미사 와일드카드** | `*/admin` | /api/admin, /v1/admin 등 |
| **⚠️ 중간 와일드카드** | `/api/*/users` | 지원 안됨! |

---

## 📌 when 조건 상세

**추가 조건**을 체크합니다. 헤더, JWT 클레임 등을 확인할 수 있습니다.

```yaml
when:
- key: request.headers[x-custom-header]
  values: ["allowed-value"]

- key: request.auth.claims[iss]
  values: ["https://accounts.google.com"]

- key: request.auth.claims[groups]
  values: ["admin", "developer"]

- key: source.namespace
  values: ["production"]
```

### 사용 가능한 key

| 카테고리 | Key | 설명 |
|----------|-----|------|
| **요청 속성** | `request.headers[name]` | HTTP 헤더 |
| | `request.auth.principal` | 인증된 principal |
| | `request.auth.claims[claim]` | JWT 클레임 |
| **출처 속성** | `source.ip` | 클라이언트 IP |
| | `source.namespace` | 클라이언트 Namespace |
| | `source.principal` | 클라이언트 SPIFFE ID |
| **목적지 속성** | `destination.ip` | 서버 IP |
| | `destination.port` | 서버 Port |

---

## ⚖️ ALLOW vs DENY 평가 순서

여러 정책이 있을 때 평가 순서가 중요합니다.

![Policy Evaluation Order](/images/istio-security/policy-evaluation-order.svg)

| 순서 | 조건 | 결과 |
|------|------|------|
| **1** | CUSTOM 정책 있음 | 외부 서버에 위임 |
| **2** | DENY 정책 매칭 | 거부 (403) |
| **3** | ALLOW 정책 없음 | 허용 (기본) |
| **4** | ALLOW 정책 매칭 | 허용 |
| **5** | 아무 ALLOW도 미매칭 | 거부 (403) |

**핵심**: DENY가 먼저, ALLOW는 화이트리스트 방식

### 예시로 이해하기

```yaml
# 정책 1: /admin 경로 거부
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: deny-admin
spec:
  selector:
    matchLabels:
      app: my-service
  action: DENY
  rules:
  - to:
    - operation:
        paths: ["/admin/*"]

---
# 정책 2: production namespace에서만 허용
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: allow-production
spec:
  selector:
    matchLabels:
      app: my-service
  action: ALLOW
  rules:
  - from:
    - source:
        namespaces: ["production"]
```

| 요청 | 결과 | 이유 |
|------|------|------|
| production ns → /api/users | ✅ 허용 | ALLOW 매칭 |
| production ns → /admin/users | ❌ 거부 | DENY 먼저 매칭 |
| staging ns → /api/users | ❌ 거부 | ALLOW 없음 |
| staging ns → /admin/users | ❌ 거부 | DENY 매칭 |

---

## 🎯 실전 시나리오

### 시나리오 1: 서비스 간 접근 제어

```yaml
# Payment Service는 Order Service에서만 호출 가능
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: payment-policy
  namespace: production
spec:
  selector:
    matchLabels:
      app: payment-service
  action: ALLOW
  rules:
  - from:
    - source:
        principals: ["cluster.local/ns/production/sa/order-sa"]
    to:
    - operation:
        methods: ["POST"]
        paths: ["/api/payments/*"]
```

### 시나리오 2: 관리자 전용 API

```yaml
# /admin/* 은 admin 그룹만
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: admin-only
spec:
  selector:
    matchLabels:
      app: my-service
  action: ALLOW
  rules:
  - to:
    - operation:
        paths: ["/admin/*"]
    when:
    - key: request.auth.claims[groups]
      values: ["admin"]
```

### 시나리오 3: 기본 거부 + 화이트리스트

```yaml
# 먼저: 기본 거부 (빈 rules)
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: deny-all
  namespace: production
spec:
  {}  # selector 없음 = 전체, rules 없음 = 모두 거부

---
# 그 다음: 필요한 것만 허용
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: allow-internal
  namespace: production
spec:
  action: ALLOW
  rules:
  - from:
    - source:
        namespaces: ["production"]
```

---

## 🔍 디버깅

### 정책 확인

```bash
# 적용된 정책 확인
$ kubectl get authorizationpolicy -n production

# 정책 상세
$ kubectl describe authorizationpolicy payment-policy -n production

# 워크로드에 적용된 정책 분석
$ istioctl x authz check my-pod-xxx -n production
```

### 로그로 확인

```yaml
# AUDIT 정책으로 로그만 남기기
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: audit-all
spec:
  action: AUDIT
  rules:
  - {}  # 모든 요청 로깅
```

```bash
# Envoy 로그 확인
$ kubectl logs my-pod -c istio-proxy | grep "authz"
```

---

## 📚 배운 점

### AuthorizationPolicy 구조
- **selector**: 적용 대상 워크로드
- **action**: ALLOW, DENY, CUSTOM, AUDIT
- **rules**: from + to + when 조건

### from, to, when
- **from**: 요청자 (principals, namespaces, ipBlocks)
- **to**: 요청 내용 (methods, paths, ports)
- **when**: 추가 조건 (headers, JWT claims)

### 평가 순서
1. CUSTOM → 외부 서버
2. DENY 매칭 → 거부
3. ALLOW 없음 → 허용
4. ALLOW 매칭 → 허용
5. ALLOW 미매칭 → 거부

### 실전 팁
- SPIFFE ID(principals) 기반 제어 권장
- 기본 거부 + 화이트리스트 패턴
- AUDIT으로 먼저 테스트

---

## 🔗 다음 편 예고

Part 4에서는 JWT 인증을 다룹니다:
- RequestAuthentication 설정
- JWKS 연동
- JWT 클레임 기반 인가
- AuthorizationPolicy와 연동

---

## 📖 참고 자료

- [AuthorizationPolicy 공식 문서](https://istio.io/latest/docs/reference/config/security/authorization-policy/)
- [Authorization 개념](https://istio.io/latest/docs/concepts/security/#authorization)
