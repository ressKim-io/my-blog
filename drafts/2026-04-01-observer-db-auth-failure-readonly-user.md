---
date: 2026-04-01
category: troubleshoot
project: goti-load-observer, Goti-Terraform
tags: [rds, postgresql, authentication, readonly-user, pii, ssm, externalsecret, least-privilege]
---

# goti-load-observer RDS 인증 실패 → 전용 읽기 전용 DB 유저 생성

## Context
prod EKS 환경 goti-load-observer가 RDS 접속 시 매 분마다 3개 poll 쿼리(seats/orders/matches) 전부 실패.
DB 폴링이 안 되면서 Grafana 대시보드(k6-load-test, load-test-command-center)의 비즈니스 메트릭이 수집 불가.

## Issue

```json
{"level":"ERROR","msg":"db poll seats failed","error":"failed to connect to `user=goti database=goti`: FATAL: password authentication failed for user \"goti\" (SQLSTATE 28P01)"}
```

- SSM Parameter `/prod/load-observer/LOAD_OBSERVER_DB_DSN`에 잘못된 비밀번호(`PaymentSvc2026prodGoti`, payment 서비스 비밀번호) 등록
- observer가 `goti` master 유저로 접속 시도 — 최소 권한 원칙 위반

## Action

1. SSM 저장 DSN 확인 → 비밀번호가 payment 서비스 것으로 잘못 등록
2. 기존 DB 유저 목록 확인 → 서비스별 격리(goti_user_svc, goti_ticketing_svc 등)는 있으나 observer 전용 없음
3. observer 코드 분석 → 3개 SELECT 쿼리만 사용, ticketing_service + stadium_service 스키마 접근

**Root Cause**: observer용 DSN을 수동으로 SSM에 등록할 때 잘못된 비밀번호 입력.
근본적으로 observer 전용 DB 유저가 없어서 master 유저를 공유하는 구조가 문제.

**수정 (3단계)**:

### Step 1: RDS에 goti_observer 유저 생성
- 임시 psql pod(hostNetwork, Kyverno 정책 준수)로 RDS 접속
- 5개 스키마 전체 SELECT 부여
- PII 5개 테이블 REVOKE (users, members, accounts, social_providers, tickets)
- DEFAULT PRIVILEGES 설정 (향후 테이블 자동 적용)

### Step 2: Terraform SSM 파라미터 등록
- `modules/config/main.tf`에 observer 전용 SSM 리소스 추가
- `/prod/load-observer/LOAD_OBSERVER_DB_DSN` (SecureString)
- `/prod/load-observer/LOAD_OBSERVER_REDIS_ADDR` (String)
- 기존 SSM 파라미터가 수동 생성되어 있어 `terraform import` 필요했음

### Step 3: Terraform drift 수정 (부수 작업)
- RDS `max_connections=200` 파라미터 코드화
- RDS/ElastiCache SG inline ingress 통합 (별도 aws_security_group_rule 제거)
- EKS CloudWatch log group 이중 관리 해소

## Result

검증 (goti_observer로 접속):
- ✅ `SELECT count(*) FROM ticketing_service.seat_statuses` → 34,731,639
- ✅ `SELECT count(*) FROM stadium_service.baseball_teams` → 10
- ✅ `SELECT count(*) FROM ticketing_service.orders` → 720,000
- ❌ `SELECT * FROM user_service.users` → permission denied
- ❌ `SELECT * FROM ticketing_service.tickets` → permission denied
- ❌ `INSERT INTO ticketing_service.seat_statuses` → permission denied

ExternalSecret 갱신 후 observer pod 재시작은 VPC CNI IP 소진 문제로 별도 대응 필요 (→ max-pods 확장 작업 참조).

재발 방지:
- 모든 서비스 DB credential을 Terraform으로 관리 (수동 SSM 등록 금지)
- observer는 읽기 전용 유저로 최소 권한 원칙 적용
- SQL 스크립트 `scripts/sql/create-observer-readonly-user.sql`로 문서화

## Related Files
- `goti-team-controller/scripts/sql/create-observer-readonly-user.sql`
- `Goti-Terraform/terraform/prod-aws/modules/config/main.tf`
- `Goti-Terraform/terraform/prod-aws/modules/config/variables.tf`
- `Goti-Terraform/terraform/prod-aws/variables.tf`
- `Goti-Terraform/terraform/prod-aws/main.tf`
- `Goti-Terraform/terraform/prod-aws/terraform.tfvars`
- `Goti-Terraform/terraform/prod-aws/modules/rds/main.tf` (max_connections, SG 통합)
- `Goti-Terraform/terraform/prod-aws/modules/elasticache/main.tf` (SG 통합)
- `Goti-Terraform/terraform/prod-aws/modules/eks/main.tf` (CloudWatch 이중 관리 해소)
