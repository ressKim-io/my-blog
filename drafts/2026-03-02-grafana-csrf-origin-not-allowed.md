---
date: 2026-03-02
category: troubleshoot
project: Goti-monitoring, Goti-Terraform
tags: [grafana, csrf, origin, alb, https, reverse-proxy]
---

# Grafana 대시보드 "origin not allowed" — CSRF trusted origins 설정 누락

## Context
EC2에 배포된 Grafana(`https://dev.go-ti.shop/monitoring/`)에서 대시보드 패널에 빨간 삼각형 + "origin not allowed" 에러 발생. 모든 대시보드 패널이 데이터를 표시하지 못함.

## Issue

```
origin not allowed
```

모든 Grafana 대시보드 패널에서 발생. 마우스 오버 시 "origin not allowed" 표시.

재현 조건: ALB(HTTPS) → Grafana(HTTP) 구성에서 `GF_SECURITY_CSRF_TRUSTED_ORIGINS` 미설정 시 항상 발생.

## Action

1. 가설: ALB가 Prometheus 포트를 안 열어서 데이터소스 접근 불가 → 결과: 아님. Grafana datasource는 `access: proxy` 모드로 Docker 내부 네트워크에서 직접 통신하므로 ALB 노출 불필요
2. 가설: ALB(HTTPS) → Grafana(HTTP) 변환 시 Origin 헤더 불일치로 CSRF 검증 실패 → 결과: **정확함**

근본 원인 (Root Cause):
- 브라우저가 `https://dev.go-ti.shop`을 Origin 헤더로 전송
- ALB가 HTTPS → HTTP로 변환하여 Grafana에 전달
- Grafana는 내부적으로 HTTP로 동작하므로 브라우저의 HTTPS Origin과 불일치
- CSRF 보호 로직이 Origin 검증에 실패 → 모든 데이터소스 프록시 요청 차단

적용 수정:
- SSM 파라미터 추가: `/dev/monitoring/GF_SECURITY_CSRF_TRUSTED_ORIGINS=dev.go-ti.shop`
- `docker-compose.yml`에 `GF_SECURITY_CSRF_TRUSTED_ORIGINS` 환경변수 추가
- `deploy.sh`에 SSM에서 해당 파라미터 로드 추가
- Terraform(`config/main.tf`, `config/variables.tf`, 루트 `main.tf`, 루트 `variables.tf`)에 변수 선언 및 모듈 전달 추가

추가 이슈: Terraform 적용 시 루트 모듈에 variable 선언 누락 → "undeclared variable" 경고 발생. 루트 모듈 `variables.tf` + `main.tf`에도 변수 추가하여 해결.

## Result
- PR #37 merge 후 Monitoring CD 성공 → Grafana 대시보드 정상 표시 확인
- Terraform import로 CLI 생성 SSM 파라미터를 state에 반영 + apply로 IaC 동기화 완료
- 재발 방지: 새 도메인 추가 시 `GF_SECURITY_CSRF_TRUSTED_ORIGINS`에 도메인 추가 필요 (tfvars에서 관리)

## Related Files
- Goti-monitoring/docker/docker-compose.yml
- Goti-monitoring/scripts/deploy.sh
- Goti-Terraform/terraform/dev/config/main.tf
- Goti-Terraform/terraform/dev/config/variables.tf
- Goti-Terraform/terraform/dev/main.tf
- Goti-Terraform/terraform/dev/variables.tf
