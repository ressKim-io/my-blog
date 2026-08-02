---
title: "Istio `*` glob은 한 세그먼트만 매칭한다 — 라우팅 누락과 403의 원인"
excerpt: "CloudFront가 가리고 있던 진짜 라우팅 오류가 드러났습니다. VirtualService prefix 누락, MSA 내부 통신 URL의 localhost 기본값, AuthorizationPolicy glob 매칭 범위 오해가 겹쳐 404·403·401이 동시에 발생한 기록입니다"
category: istio
tags:
  - go-ti
  - Istio
  - VirtualService
  - AuthorizationPolicy
  - MSA
  - Troubleshooting
series:
  name: "goti-istio-ops"
  order: 4
date: "2026-03-24"
---

## 한 줄 요약

> API 도메인을 분리하자 그동안 HTML 200에 가려져 있던 라우팅 오류가 드러났습니다. VirtualService prefix 누락, `TICKETING_BASE_URL` 미설정으로 인한 localhost 자기호출, 그리고 Istio `*` glob이 단일 경로 세그먼트만 매칭한다는 사실을 몰라 생긴 403까지 세 가지가 겹쳐 있었습니다

---

## 🔥 문제: 세 가지 상태 코드가 동시에 등장

### 증상

API 도메인을 분리하고 다시 E2E를 돌리자 이번에는 진짜 라우팅 이슈가 드러났습니다

```text
# 1) game-seats 경로 누락 → Istio 404
GET /api/v1/game-seats/{gameId}/sections/{sectionId}/seat-statuses → 404

# 2) payment→ticketing 통신 차단 → 403
GET http://goti-ticketing-dev:8080/api/v1/orders/{id}/payment-order → 403

# 3) payment→ticketing 통신 URL이 localhost → 401
GET http://localhost:8080/api/v1/orders/{id}/payment-order → 401
```

앞선 [CloudFront Custom Error Response 문제](/logs/goti-cloudfront-custom-error-response-api-404/)를 해결하기 전까지 이 세 건은 전부 `200 OK` HTML로 위장돼 보이지 않았습니다

---

## 🤔 원인: 세 가지가 겹친 상황

**첫째, game-seats 경로 누락입니다.** 새로 추가된 엔드포인트가 ticketing VirtualService의 prefix 목록에 들어가지 않아 Istio Gateway가 404를 반환하고 있었습니다

**둘째, payment→ticketing 내부 통신 URL이 localhost로 고정된 상태였습니다.** `TICKETING_BASE_URL` 환경변수가 설정되지 않아 Spring 애플리케이션이 기본값 `localhost:8080`을 사용했습니다. MSA 구조에서 localhost는 자기 자신을 가리키므로, payment 서비스가 자기 자신의 `/api/v1/orders/{id}/payment-order`를 호출해 401이 반환된 것입니다

**셋째, AuthorizationPolicy의 경로 매칭을 잘못 이해하고 있었습니다.** Istio의 `*` glob은 **단일 경로 세그먼트만 매칭**합니다. `/api/v1/orders/*`는 `/api/v1/orders/{id}`까지는 잡지만, `/api/v1/orders/{id}/payment-order`는 하위 세그먼트가 더 있어 매칭되지 않습니다. deny-all 기반 정책에서 매칭 실패는 곧 거부이므로 403이 됩니다

---

## ✅ 해결

세 가지를 각각 수정했습니다

**1. ticketing VirtualService에 `/api/v1/game-seats` prefix 추가**

**2. 서비스 간 통신 URL을 K8s 서비스 DNS로 명시**

```yaml
# goti-payment/values.yaml
env:
  TICKETING_BASE_URL: http://goti-ticketing-dev.goti.svc.cluster.local:8080

# goti-ticketing/values.yaml
env:
  STADIUM_API_URL: http://goti-stadium-dev.goti.svc.cluster.local:8080
```

**3. AuthorizationPolicy paths에 하위 경로 패턴 추가**

```yaml
rules:
  - to:
      - operation:
          methods: ["GET", "POST"]   # 기존 POST만 → GET 추가
          paths:
            - /api/v1/orders/*
            - /api/v1/orders/*/payment-order   # 하위 세그먼트 별도 패턴
```

---

## 📚 재발 방지

**새 API 엔드포인트를 추가할 때 VirtualService prefix와 AuthorizationPolicy paths를 한 PR에서 동시에 수정합니다.** 둘 중 하나만 반영되면 404 또는 403이 나는데, 증상만 보면 애플리케이션 버그와 구분되지 않습니다

**MSA 서비스 간 통신에는 `*_BASE_URL` 환경변수가 필수입니다.** 기본값 `localhost:8080`은 단일 프로세스 시절의 유산이며 MSA에서는 항상 실패합니다. 게다가 자기 자신을 호출하므로 연결 에러가 아니라 401 같은 그럴듯한 응답이 돌아와 오진을 유발합니다

**Istio `*` glob은 단일 세그먼트 매칭입니다.** 하위 경로까지 허용하려면 별도 패턴을 명시해야 합니다. deny-all 정책 아래에서는 매칭 누락이 곧 차단이므로, 경로 패턴을 추가할 때마다 하위 세그먼트 유무를 함께 확인해야 합니다
