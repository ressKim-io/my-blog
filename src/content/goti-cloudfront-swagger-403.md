---
title: "Swagger UI가 S3로 빠진다: CloudFront Behavior 누락 트러블슈팅"
excerpt: "CloudFront에서 Swagger UI 접근 시 403 AccessDenied가 발생한 원인과 해결 과정"
category: cicd
tags:
  - CloudFront
  - ALB
  - Swagger
  - S3
  - Troubleshooting
series:
  name: "goti-cloudfront-alb"
  order: 1
date: '2026-03-06'
---

## 한 줄 요약

> `dev.go-ti.shop/swagger-ui/index.html` 접근 시 403 AccessDenied. CloudFront에 `/swagger-ui/*` behavior가 없어서 S3로 폴백된 것이 원인이다.

## Impact

- **영향 범위**: Swagger UI 전체
- **증상**: 403 AccessDenied (S3 응답)
- **소요 시간**: 약 30분
- **발생일**: 2026-03-06

---

## 🔥 증상: Swagger UI에서 403 에러

### 에러 메시지

`https://dev.go-ti.shop/swagger-ui/index.html`에 접근하면 XML 에러가 반환되었습니다:

```xml
<Error>
  <Code>AccessDenied</Code>
  <Message>Access Denied</Message>
</Error>
```

S3에서 반환하는 전형적인 403 응답이에요.
백엔드 API(`/api/*`)는 정상 동작하고, Swagger UI만 접근이 안 되는 상황이었습니다.

---

## 🤔 원인: CloudFront Behavior 누락

### 인프라 구조 파악

먼저 요청 흐름을 정리해봅시다.

`dev.go-ti.shop`은 Route53에서 CloudFront를 가리키고 있어요.
CloudFront는 경로 패턴에 따라 요청을 S3(프론트엔드) 또는 ALB(백엔드)로 분기합니다.

당시 CloudFront behavior 구성은 이랬습니다:

```
/api/*          → ALB (goti-dev-alb)
/monitoring/*   → ALB (goti-dev-alb)
/* (default)    → S3 (프론트엔드)
```

### 문제 발견

`/swagger-ui/*` 경로가 어디에도 매칭되지 않습니다.
CloudFront는 매칭되는 behavior가 없으면 **default behavior**로 폴백해요.
default는 S3를 가리키고 있으니, S3에서 `/swagger-ui/index.html` 파일을 찾게 됩니다.

당연히 S3에 그런 파일은 없어요. 결과는 403 AccessDenied.

흐름을 정리하면:

1. 브라우저가 `dev.go-ti.shop/swagger-ui/index.html` 요청
2. CloudFront가 `/swagger-ui/*` 패턴에 매칭되는 behavior를 찾음
3. 매칭되는 behavior 없음 → default behavior(S3) 적용
4. S3에 해당 파일 없음 → 403 AccessDenied 반환

**Swagger UI는 Spring Boot 서버(ALB 뒤)에서 제공하는 건데, CloudFront가 S3로 보내버린 것이 근본 원인이다.**

---

## ✅ 해결: CloudFront Behavior 추가

### 추가한 Behavior

두 가지 경로를 ALB로 라우팅하도록 behavior를 추가했습니다:

- `/swagger-ui/*` → ALB (goti-dev-alb)
- `/v3/*` → ALB (goti-dev-alb)

`/v3/*`도 추가한 이유가 있어요.
Swagger UI는 내부적으로 `/v3/api-docs`를 호출해서 API 스펙을 가져옵니다.
이 경로도 ALB로 라우팅되어야 Swagger UI가 정상 동작합니다.

### Path Pattern 주의사항

처음에 `/v3/api-docs/*` 패턴으로 추가했는데, `/v3/api-docs` (trailing slash 없는 정확 경로)에 매칭되지 않았어요.
CloudFront의 `/*` 패턴은 **하위 경로만** 매칭하고, 정확한 경로 자체는 매칭하지 않습니다.
그래서 `/v3/*`로 넓혀서 해결했습니다.

### 최종 CloudFront Behavior 구성

```
/api/*          → ALB → goti-server:8080
/swagger-ui/*   → ALB → goti-server:8080
/v3/*           → ALB → goti-server:8080
/monitoring/*   → ALB → Grafana:3000
/* (default)    → S3 (프론트엔드)
```

수정 후 `https://dev.go-ti.shop/swagger-ui/index.html` 정상 접근을 확인했습니다.

---

## 📚 배운 점

### CloudFront Behavior는 명시적으로 추가해야 한다

CloudFront의 default behavior는 "나머지 전부"를 의미해요.
새로운 서버 경로를 노출할 때는 항상 CloudFront behavior 추가 여부를 확인해야 합니다.

특히 Spring Boot의 Swagger UI처럼 **서버가 직접 제공하는 정적 리소스 경로**는 놓치기 쉬워요.
API 경로(`/api/*`)만 생각하고, Swagger 같은 부가 경로를 빠뜨리는 실수가 흔합니다.

### Path Pattern 매칭 규칙

CloudFront path pattern에서 주의할 점:

| 패턴 | 매칭 대상 | 비매칭 대상 |
|------|----------|------------|
| `/v3/api-docs/*` | `/v3/api-docs/something` | `/v3/api-docs` (정확 경로) |
| `/v3/*` | `/v3/api-docs`, `/v3/anything` | `/v3` (자체) |

정확한 경로까지 매칭하려면 패턴을 한 단계 위로 넓히거나, 별도의 정확 매칭 패턴을 추가해야 합니다.

---

## 요약

| 항목 | 내용 |
|------|------|
| **문제** | Swagger UI 접근 시 403 AccessDenied |
| **원인** | CloudFront에 `/swagger-ui/*`, `/v3/*` behavior 누락 → S3로 폴백 |
| **해결** | CloudFront behavior 추가: 두 경로를 ALB로 라우팅 |
| **교훈** | 새 서버 경로 노출 시 CloudFront behavior 추가 여부 반드시 확인 |
