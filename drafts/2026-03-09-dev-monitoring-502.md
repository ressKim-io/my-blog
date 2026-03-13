---
date: 2026-03-09
category: troubleshoot
project: Goti-monitoring, Goti-Terraform
tags: [502, alb-healthcheck, docker-port-binding, grafana, spring-security]
---

# dev.go-ti.shop 502 — Grafana 포트 바인딩 + ALB 헬스체크 경로 오류

## Context
- `dev.go-ti.shop/monitoring` (Grafana) 및 API 전체가 502 발생
- 모니터링 스택 리뷰 기반 일괄 개선 (#52) 배포 직후 발생
- 인프라 경로: CloudFront → ALB (goti-dev-alb) → EC2 (Docker containers)

## Issue
```
ALB Target Group: goti-dev-grafana-tg → unhealthy (Health checks failed)
ALB Target Group: goti-dev-tg → unhealthy (Health checks failed with codes: [401])
```

- `dev.go-ti.shop/monitoring/*` 접근 시 502 Bad Gateway
- `dev.go-ti.shop/api/*` 접근 시에도 502 Bad Gateway
- 두 타겟 그룹 모두 unhealthy → ALB가 트래픽 전달 거부

## Action

### 진단 과정

1. **가설 1: CloudFront 설정 문제** → CloudFront behaviors 확인, `/monitoring/*` → ALB Origin 라우팅 정상. ALB 리스너에 `/monitoring/*` → grafana-tg 룰도 존재. → 기각

2. **가설 2: ALB 타겟 헬스 문제** → `aws elbv2 describe-target-health` 확인 → 두 타겟 모두 unhealthy 확인. → 수용

3. **가설 3 (Grafana): Docker 포트 바인딩 문제** → `docker ps` 확인 → `127.0.0.1:3000->3000/tcp`으로 localhost만 바인딩. ALB가 EC2:3000에 접근 불가. → 수용
   - `git diff 7d1ed0a 7708a90 -- docker/docker-compose.yml`로 확인: 커밋 7708a90 (#52 리뷰 개선)에서 `"3000:3000"` → `"127.0.0.1:3000:3000"`으로 변경된 것이 원인

4. **가설 4 (Server): ALB 헬스체크 경로 문제** → Terraform `alb.tf` 확인 → 헬스체크 경로가 `"/"`. Spring Security가 `/`에 인증 요구 → 401 반환 → unhealthy 판정. → 수용

### 근본 원인 (Root Cause)

**원인 1**: Grafana Docker 포트 바인딩이 `127.0.0.1:3000`으로 변경되어 ALB에서 접근 불가
- #52 리뷰 개선에서 보안 강화 목적으로 localhost 바인딩 적용했으나, ALB가 EC2:3000으로 직접 접근하는 구조를 고려하지 않음

**원인 2**: ALB 서버 타겟 그룹 헬스체크 경로가 `/`로 설정
- Spring Security가 `/`에 인증을 요구하여 401 반환 → unhealthy 판정
- 헬스체크 경로가 `/actuator/health`여야 함

### 적용한 수정
- **[Goti-monitoring]** `docker/docker-compose.yml:206`: `"127.0.0.1:3000:3000"` → `"3000:3000"`
- **[Goti-Terraform]** `terraform/dev/billing/alb.tf:30`: `path = "/"` → `path = "/actuator/health"`

## Result
- Grafana 재시작 후 `goti-dev-grafana-tg` → **healthy** 전환 확인
- Terraform apply 후 `goti-dev-tg` → **healthy** 전환 확인
- `dev.go-ti.shop/monitoring`, `dev.go-ti.shop/api/*` 정상 접근 복원

### 재발 방지책
- Docker 포트 바인딩 변경 시 ALB/외부 접근 경로 영향 반드시 확인
- 네트워크 접근 제한은 Docker 포트 바인딩이 아닌 Security Group에서 처리
- ALB 헬스체크 경로는 인증이 불필요한 엔드포인트 사용 (Spring Boot: `/actuator/health`)
- 모니터링 배포 후 `aws elbv2 describe-target-health`로 타겟 상태 검증 루틴 추가 권장

## Related Files
- `Goti-monitoring/docker/docker-compose.yml` (포트 바인딩)
- `Goti-Terraform/terraform/dev/billing/alb.tf` (헬스체크 경로)
