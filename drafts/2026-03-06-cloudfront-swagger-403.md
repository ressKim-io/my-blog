---
date: 2026-03-06
category: troubleshoot
project: Goti-Terraform
tags: [cloudfront, swagger, s3, alb, routing]
---

# CloudFront에서 Swagger UI 접근 시 403 AccessDenied

## Context
`dev.go-ti.shop`에서 Swagger UI(`/swagger-ui.html`) 접근 시도.
CloudFront → S3(프론트엔드) / ALB(백엔드) 분기 구조.

## Issue

```xml
<Error>
  <Code>AccessDenied</Code>
  <Message>Access Denied</Message>
</Error>
```

`https://dev.go-ti.shop/swagger-ui/index.html` 접근 시 S3에서 403 반환.

## Action

1. Route53 레코드 확인: `dev.go-ti.shop` → CloudFront, `api.go-ti.shop` → ALB 확인.
2. CloudFront behavior 확인: `/api/*`, `/monitoring/*` → ALB, `/*` (default) → S3.
3. `/swagger-ui/*`가 default behavior에 매칭되어 S3로 라우팅됨 → S3에 해당 파일 없음 → 403.

**근본 원인 (Root Cause):**
CloudFront에 `/swagger-ui/*`와 `/v3/api-docs` 경로에 대한 behavior가 없어서 S3로 폴백됨.

**적용한 수정:**
- CloudFront behavior 추가: `/swagger-ui/*` → ALB (goti-dev-alb)
- CloudFront behavior 추가: `/v3/*` → ALB (Swagger UI가 내부적으로 `/v3/api-docs`를 호출하므로 필요)
- 처음 `/v3/api-docs/*` 패턴으로 추가했으나 `/v3/api-docs` (trailing slash 없음) 매칭 실패 → `/v3/*`로 수정

## Result

`https://dev.go-ti.shop/swagger-ui/index.html` 정상 접근 확인.

최종 CloudFront behavior 구성:
```
/api/*          → ALB → goti-server:8080
/swagger-ui/*   → ALB → goti-server:8080
/v3/*           → ALB → goti-server:8080
/monitoring/*   → ALB → Grafana:3000
/* (default)    → S3 (프론트엔드)
```

재발 방지:
- 새 서버 경로 노출 시 CloudFront behavior 추가 필요 여부 확인
- CloudFront path pattern에서 `/*`는 하위 경로만 매칭, 정확 경로는 별도 패턴 필요

## Related Files
- CloudFront Distribution: EOLI11PF51LX9
- Route53 Hosted Zone: Z07003782ABOJTESFVDGQ
