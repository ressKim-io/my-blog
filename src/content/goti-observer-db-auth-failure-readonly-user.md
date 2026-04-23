---
title: "RDS 인증 실패 — observer 전용 읽기 전용 DB 유저 생성"
excerpt: "goti-load-observer가 잘못된 비밀번호로 RDS 접속에 실패했고, 근본적으로 master 유저를 공유하는 구조가 문제였습니다. observer 전용 읽기 전용 유저를 만들고 PII 테이블을 REVOKE해 최소 권한 원칙을 적용했습니다."
category: kubernetes
tags:
  - go-ti
  - PostgreSQL
  - RDS
  - Security
  - Troubleshooting
date: "2026-04-01"
---

## 한 줄 요약

> goti-load-observer가 RDS poll 쿼리에서 SQLSTATE 28P01로 전부 실패. SSM에 저장된 DSN의 비밀번호가 잘못됐고 그나마도 master 유저를 공유하고 있었습니다. observer 전용 읽기 전용 유저를 만들고 PII 테이블을 REVOKE한 뒤 Terraform으로 SSM 파라미터를 관리하도록 정리했습니다.

---

## 🔥 문제: observer의 모든 DB poll 쿼리가 인증 실패

prod EKS에 떠 있는 `goti-load-observer`가 매 분마다 3개 poll 쿼리(seats/orders/matches)를 실행합니다. 이 쿼리들이 **전부 실패**하고 있었습니다.

로그는 다음과 같이 떨어졌습니다.

```json
{
  "level": "ERROR",
  "msg": "db poll seats failed",
  "error": "failed to connect to `user=goti database=goti`: FATAL: password authentication failed for user \"goti\" (SQLSTATE 28P01)"
}
```

observer가 DB를 못 찌르니 Grafana 대시보드의 비즈니스 메트릭이 전부 수집 불가 상태였습니다. 영향 받은 대시보드는 두 개입니다.

- `k6-load-test` — 부하테스트 중 실제 DB 지표 확인용
- `load-test-command-center` — 프로덕션 트래픽을 보는 통합 뷰

메트릭 파이프라인 자체는 정상이었고, **observer가 소스에서 데이터를 못 가져오는 것**이 유일한 원인이었습니다.

---

## 🤔 원인: SSM의 잘못된 비밀번호 + master 유저 공유 구조

### 1차 원인: SSM DSN에 payment 서비스 비밀번호가 들어감

observer는 SSM Parameter Store의 `/prod/load-observer/LOAD_OBSERVER_DB_DSN`에서 DSN을 읽습니다. 실제 값을 확인해보니 비밀번호가 `PaymentSvc2026prodGoti`로 되어 있었습니다.

이것은 **payment 서비스의 비밀번호**입니다. observer용 DSN을 수동으로 SSM에 등록하는 과정에서 다른 서비스의 비밀번호를 그대로 복사해 넣은 것이 원인이었습니다.

### 근본 원인: observer 전용 유저 자체가 없었음

비밀번호 오타를 고치면 당장은 붙습니다. 하지만 RDS의 유저 목록을 확인해보면 더 심각한 구조 문제가 드러납니다.

```sql
\du
-- goti             (master)
-- goti_user_svc
-- goti_ticketing_svc
-- goti_stadium_svc
-- ...
-- (observer 전용 유저 없음)
```

다른 서비스는 전부 서비스별로 격리된 유저를 쓰고 있는데, observer만 **master 유저(`goti`)를 공유**하는 구조였습니다. observer는 단순히 3개 SELECT 쿼리만 돌리는 읽기 전용 클라이언트인데, 모든 스키마와 모든 테이블에 쓰기 권한까지 가진 master 유저를 들고 있었던 것입니다.

최소 권한 원칙(Least Privilege) 위반이며, observer 코드에 버그가 있어 INSERT/DELETE가 새어 나가도 RDS는 막아주지 못합니다. 그리고 observer는 로그/메트릭 수집 특성상 쿼리 범위에 PII 테이블(`users`, `members`, `accounts`, `social_providers`, `tickets`)이 노출되면 안 됩니다.

observer 코드를 분석해보면 실제로 접근하는 스키마는 `ticketing_service`와 `stadium_service` 두 개뿐입니다. 이 범위를 넘는 권한은 전부 불필요한 공격 표면이었습니다.

---

## ✅ 해결: 전용 유저 + Terraform 관리 + drift 정리 (3단계)

### Step 1: RDS에 `goti_observer` 유저 생성

RDS는 프라이빗 서브넷에 있어서 로컬에서 psql로 직접 붙을 수 없습니다. 임시 psql Pod를 `hostNetwork`로 띄우고(Kyverno 정책을 만족시키면서 RDS에 도달하기 위한 설정) 접속했습니다.

유저를 만들고 다음 순서로 권한을 부여했습니다.

```sql
-- 1. 유저 생성
CREATE USER goti_observer WITH PASSWORD '<redacted>';

-- 2. 5개 스키마 전체에 SELECT 부여
GRANT USAGE ON SCHEMA ticketing_service, stadium_service,
  user_service, payment_service, resale_service TO goti_observer;
GRANT SELECT ON ALL TABLES IN SCHEMA ticketing_service, stadium_service,
  user_service, payment_service, resale_service TO goti_observer;

-- 3. PII 5개 테이블은 REVOKE
REVOKE SELECT ON user_service.users FROM goti_observer;
REVOKE SELECT ON user_service.members FROM goti_observer;
REVOKE SELECT ON user_service.accounts FROM goti_observer;
REVOKE SELECT ON user_service.social_providers FROM goti_observer;
REVOKE SELECT ON ticketing_service.tickets FROM goti_observer;

-- 4. 향후 추가되는 테이블도 동일하게 적용
ALTER DEFAULT PRIVILEGES IN SCHEMA ticketing_service, stadium_service
  GRANT SELECT ON TABLES TO goti_observer;
```

여기서 핵심은 **DEFAULT PRIVILEGES** 설정입니다. 나중에 `ticketing_service` 스키마에 새 테이블이 추가되어도 자동으로 `goti_observer`에게 SELECT가 부여됩니다. 수동으로 GRANT를 다시 돌리지 않아도 됩니다.

이 SQL은 재사용 가능하도록 `scripts/sql/create-observer-readonly-user.sql`로 저장했습니다.

### Step 2: Terraform으로 SSM 파라미터 관리

기존에는 SSM 파라미터를 손으로 만들고 값을 손으로 입력했기 때문에 이번 같은 오타가 발생했습니다. 이것을 Terraform 코드로 옮겼습니다.

```hcl
# modules/config/main.tf
resource "aws_ssm_parameter" "load_observer_db_dsn" {
  name  = "/prod/load-observer/LOAD_OBSERVER_DB_DSN"
  type  = "SecureString"
  value = var.load_observer_db_dsn
}

resource "aws_ssm_parameter" "load_observer_redis_addr" {
  name  = "/prod/load-observer/LOAD_OBSERVER_REDIS_ADDR"
  type  = "String"
  value = var.load_observer_redis_addr
}
```

기존 SSM 파라미터가 수동으로 이미 생성되어 있었기 때문에 `terraform import`로 상태에 흡수시킨 뒤 Terraform 관리로 넘겼습니다.

```bash
$ terraform import \
  module.config.aws_ssm_parameter.load_observer_db_dsn \
  /prod/load-observer/LOAD_OBSERVER_DB_DSN
```

이제 DSN 값은 `terraform.tfvars`에서 관리되고, 변경 이력이 git에 남습니다.

### Step 3: 인접 Terraform drift 정리 (부수 작업)

이 작업을 하다 보니 RDS/ElastiCache 모듈에 누적된 drift가 눈에 들어왔고, 같은 PR에서 정리했습니다.

- `RDS max_connections=200` — 콘솔에서 손으로 올려둔 파라미터를 코드화.
- **RDS/ElastiCache SG inline ingress 통합** — 별도 `aws_security_group_rule` 리소스를 `aws_security_group`의 inline `ingress`로 병합. 순환 참조 위험을 줄이고 변경 영향을 한 파일에 모았습니다.
- **EKS CloudWatch log group 이중 관리 해소** — EKS 모듈이 만든 로그 그룹과 별도 `aws_cloudwatch_log_group` 리소스가 같은 이름을 두고 충돌하던 것을 하나로 통일.

### 검증

새 유저로 실제 쿼리와 금지 쿼리를 모두 돌려봤습니다.

```sql
-- observer가 사용해야 하는 쿼리: 성공
SELECT count(*) FROM ticketing_service.seat_statuses;
--  34731639

SELECT count(*) FROM stadium_service.baseball_teams;
--  10

SELECT count(*) FROM ticketing_service.orders;
--  720000
```

```sql
-- PII: permission denied
SELECT * FROM user_service.users;
-- ERROR:  permission denied for table users

SELECT * FROM ticketing_service.tickets;
-- ERROR:  permission denied for table tickets

-- 쓰기: permission denied
INSERT INTO ticketing_service.seat_statuses VALUES (...);
-- ERROR:  permission denied for table seat_statuses
```

허용해야 하는 쿼리는 전부 성공했고, 금지해야 하는 쿼리는 전부 DB 레벨에서 막혔습니다.

ExternalSecret이 갱신된 뒤 observer Pod 재시작은 **VPC CNI IP 소진** 문제로 지연되어 별도 대응이 필요했습니다(max-pods 확장 작업 참조).

---

## 📚 배운 점

- **DB credential은 Terraform으로만 관리합니다.** 수동 SSM 등록은 이번처럼 오타를 섞어 넣기 쉽고, 누가 언제 바꿨는지 추적도 안 됩니다. 모든 서비스 DSN은 `aws_ssm_parameter` 리소스로 코드화합니다.
- **읽기 전용 서비스는 읽기 전용 유저로 분리합니다.** observer는 SELECT 3개만 돌리는데 master 유저를 쓰던 구조는, 코드 버그 한 번이면 프로덕션 테이블에 쓰기가 들어갈 수 있는 상태였습니다. 서비스 성격에 맞는 유저를 만드는 것이 기본입니다.
- **PII 테이블은 명시적 REVOKE로 막습니다.** "observer가 알아서 안 읽으면 된다"는 것은 보호책이 아닙니다. 스키마에 SELECT를 부여할 때 PII 테이블만 골라내서 REVOKE하면 DB가 강제로 막아줍니다.
- **DEFAULT PRIVILEGES를 반드시 설정합니다.** 새 테이블이 생길 때마다 GRANT를 다시 돌리는 운영은 오래 못 갑니다. `ALTER DEFAULT PRIVILEGES`로 미래 테이블까지 자동 반영되게 둡니다.
- **1차 원인을 고치면서 근본 구조도 함께 고칩니다.** "SSM에 비밀번호 오타"만 고치면 10분이면 끝나지만, 그 밑에 있던 "master 유저 공유" 문제는 그대로 남습니다. 재발 방지는 오타 수정이 아니라 구조 변경입니다.
