---
title: "SSM 수동 등록의 함정: 비밀번호 1바이트 실수부터 DB 인증 실패까지"
excerpt: "SSM Parameter Store 수동 등록으로 발생한 2건의 장애 — Token Encryptor 31바이트 오류와 Observer DB 인증 실패, 그리고 최소 권한 원칙 적용기"
category: kubernetes
tags:
  - go-ti
  - SSM
  - Parameter-Store
  - Troubleshooting
  - RDS
  - PostgreSQL
  - Least-Privilege
  - Terraform
  - ExternalSecret
date: "2026-02-18"
---

## 🎯 한 줄 요약

> SSM Parameter Store에 값을 **수동 등록**하면서 2건의 장애가 발생했습니다.
> 1바이트 부족한 암호화 키, 복붙한 잘못된 비밀번호 — 결국 **IaC 미관리**가 근본 원인이었습니다.

---

## 📊 Impact

| 장애 | 서비스 | 영향 | 지속 시간 |
|------|--------|------|-----------|
| Token Encryptor 31바이트 | goti-payment-sungjeon-prod | CrashLoopBackOff, Pod 기동 불가 | EKS rolling update 후 ~ 수동 수정까지 |
| Observer DB 인증 실패 | goti-load-observer | Grafana 비즈니스 메트릭 수집 불가 | 배포 후 ~ 전용 유저 생성까지 |

두 장애 모두 **SSM Parameter Store에 값을 수동으로 등록**하면서 발생했습니다.
Terraform으로 관리했다면 코드 리뷰에서 잡혔을 실수들입니다.

더 심각한 점은, observer가 **master DB 유저**로 접속을 시도하고 있었다는 것입니다.
비밀번호 오류가 아니었다면, observer가 모든 테이블에 읽기/쓰기 권한을 가진 채 동작했을 것입니다.

---

## 🔥 장애 1: CrashLoopBackOff — 31바이트의 비밀

### 증상

EKS rolling update 후 서비스를 복구하는 과정에서, **goti-payment-sungjeon-prod만** CrashLoopBackOff가 지속되었습니다.

다른 14개 Pod는 모두 정상인데, 이 Pod만 계속 죽었습니다.

```bash
$ kubectl get pods -n goti | grep payment-sungjeon
goti-payment-sungjeon-prod-7b8d9f-abc12   0/1   CrashLoopBackOff   5   3m
```

로그를 확인했습니다.

```java
Caused by: java.lang.IllegalArgumentException: AES-256 Secret Key는 반드시 32바이트여야 합니다.
    at com.goti.global.utils.TokenEncryptor.<init>(TokenEncryptor.java:37)
```

Spring Boot 기동 단계에서 `TokenEncryptor` Bean 생성이 실패하면서 앱 자체가 시작되지 않았습니다.

### 원인: AES-256은 정확히 32바이트

AES-256 암호화의 핵심 제약을 살펴보겠습니다.

| 알고리즘 | 키 길이 | 바이트 |
|----------|---------|--------|
| AES-128 | 128bit | 16바이트 |
| AES-192 | 192bit | 24바이트 |
| **AES-256** | **256bit** | **32바이트** |

AES-256은 **정확히** 32바이트를 요구합니다.
31바이트도 안 되고, 33바이트도 안 됩니다.

SSM Parameter Store에 등록된 값을 확인했습니다.

```
goti-prod-2026-queue-token-32ch    ← 31바이트 ❌
goti-prod-2026-queue-token-32chr   ← 32바이트 ✅
```

끝에 `r` 한 글자가 빠져있었습니다.
수동으로 SSM에 입력하면서 **1바이트가 누락**된 겁니다.

### 왜 발견이 늦었는가

이 문제가 바로 발견되지 않은 이유가 있습니다.

`TokenEncryptor`는 **POC 브랜치에만 존재**하는 클래스입니다.
메인 배포 브랜치(`deploy/prod`)에는 이 코드가 없습니다.

```
deploy/prod (메인 배포)        → TokenEncryptor 없음 → 영향 없음
poc/queue-sungjeon-loadtest   → TokenEncryptor 있음 → CrashLoop!
poc/queue-waiting-sungjeon    → TokenEncryptor 있음 → CrashLoop!
```

payment-prod, payment-junsang-prod 등 다른 payment 서비스는 `deploy/prod` 브랜치 기반이라 전혀 영향이 없었습니다.
B님의 POC 브랜치에서만 사용하는 대기열 토큰 암호화 기능이었기 때문에, 다른 서비스가 정상이니 문제를 인지하기까지 시간이 걸렸습니다.

### 해결

SSM Parameter Store에서 값을 32바이트로 수정한 뒤, Secret을 재생성하고 Pod를 재시작했습니다.

```bash
# 1. SSM 값 수정 (AWS 콘솔에서 32바이트로 변경)
# goti-prod-2026-queue-token-32ch → goti-prod-2026-queue-token-32chr

# 2. 기존 Secret 삭제 (ExternalSecret이 재생성)
$ kubectl delete secret goti-payment-sungjeon-prod-secrets -n goti
secret "goti-payment-sungjeon-prod-secrets" deleted

# 3. Deployment 재시작
$ kubectl rollout restart deploy goti-payment-sungjeon-prod -n goti
deployment.apps/goti-payment-sungjeon-prod restarted
```

결과를 확인합니다.

```bash
$ kubectl get pods -n goti | grep payment-sungjeon
goti-payment-sungjeon-prod-8c9e0f-def34   1/1   Running   0   45s
```

정상 기동을 확인했습니다.
HikariPool 연결 성공, Redisson 시작까지 로그에서 확인했습니다.

기존에 발급된 토큰은 키 변경으로 무효화되지만, POC 환경이라 영향 없었습니다.

---

## 🔥 장애 2: Observer DB 인증 실패 — 복붙의 대가

### 증상

prod EKS 환경에서 goti-load-observer가 RDS 접속 시 **매분 3개 poll 쿼리**(seats/orders/matches)가 전부 실패했습니다.

```json
{"level":"ERROR","msg":"db poll seats failed","error":"failed to connect to `user=goti database=goti`: FATAL: password authentication failed for user \"goti\" (SQLSTATE 28P01)"}
```

```json
{"level":"ERROR","msg":"db poll orders failed","error":"failed to connect to `user=goti database=goti`: FATAL: password authentication failed for user \"goti\" (SQLSTATE 28P01)"}
```

```json
{"level":"ERROR","msg":"db poll matches failed","error":"failed to connect to `user=goti database=goti`: FATAL: password authentication failed for user \"goti\" (SQLSTATE 28P01)"}
```

DB 폴링이 안 되면서 **Grafana 대시보드가 텅 빈 상태**가 되었습니다.
k6-load-test, load-test-command-center 대시보드의 비즈니스 메트릭(좌석 현황, 주문 수, 경기 상태)이 수집 불가했습니다.

부하 테스트 중에 실시간 메트릭을 볼 수 없다는 건, **눈 감고 운전하는 것**과 같습니다.

### 원인: Payment 비밀번호를 Observer에 등록

SSM Parameter `/prod/load-observer/LOAD_OBSERVER_DB_DSN`의 값을 확인했습니다.

```
postgres://goti:PaymentSvc2026prodGoti@goti-prod-rds.xxxxx.ap-northeast-2.rds.amazonaws.com:5432/goti
```

`PaymentSvc2026prodGoti`는 **payment 서비스의 비밀번호**입니다.
observer용 DSN을 수동 등록할 때, payment 서비스의 비밀번호를 복붙한 겁니다.

### 더 큰 문제: master 유저 공유

비밀번호 오류보다 더 큰 문제가 있었습니다.

DSN을 보면 `user=goti`로 접속하고 있습니다.
`goti`는 RDS의 **master 유저**입니다.

기존 DB 유저 구조를 확인해보겠습니다.

| 유저 | 용도 | 권한 |
|------|------|------|
| `goti` (master) | RDS 관리자 | 모든 스키마 읽기/쓰기/DDL |
| `goti_user_svc` | user-service | user_service 스키마 |
| `goti_ticketing_svc` | ticketing-service | ticketing_service 스키마 |
| `goti_stadium_svc` | stadium-service | stadium_service 스키마 |
| `goti_payment_svc` | payment-service | payment_service 스키마 |
| observer 전용 | ❌ 없음 | - |

서비스별로 DB 유저를 분리해뒀는데, **observer만 전용 유저가 없었습니다**.
그래서 master 유저를 공유하는 구조였습니다.

이것이 왜 위험한지 생각해보겠습니다.

observer는 **SELECT 3개만 실행**하는 읽기 전용 서비스입니다.
그런데 master 유저로 접속하면:

- 모든 테이블에 INSERT/UPDATE/DELETE 가능
- DDL(CREATE/DROP TABLE) 실행 가능
- PII(개인정보) 테이블도 자유롭게 조회 가능

코드 버그 하나로 데이터가 변경되거나, 개인정보가 노출될 수 있는 구조였습니다.
이것은 **최소 권한 원칙의 명백한 위반**입니다.

---

## ✅ 해결: 읽기 전용 DB 유저 생성과 최소 권한 적용

### Step 1: goti_observer 유저 생성

임시 psql Pod를 생성해서 RDS에 접속했습니다.
hostNetwork을 사용하고, Kyverno 정책을 준수하는 Pod입니다.

```sql
-- 1. 읽기 전용 유저 생성
CREATE USER goti_observer WITH PASSWORD 'ObserverReadOnly2026prodGoti';

-- 2. 5개 스키마 전체에 USAGE + SELECT 부여
GRANT USAGE ON SCHEMA user_service TO goti_observer;
GRANT USAGE ON SCHEMA ticketing_service TO goti_observer;
GRANT USAGE ON SCHEMA stadium_service TO goti_observer;
GRANT USAGE ON SCHEMA payment_service TO goti_observer;
GRANT USAGE ON SCHEMA matching_service TO goti_observer;

GRANT SELECT ON ALL TABLES IN SCHEMA user_service TO goti_observer;
GRANT SELECT ON ALL TABLES IN SCHEMA ticketing_service TO goti_observer;
GRANT SELECT ON ALL TABLES IN SCHEMA stadium_service TO goti_observer;
GRANT SELECT ON ALL TABLES IN SCHEMA payment_service TO goti_observer;
GRANT SELECT ON ALL TABLES IN SCHEMA matching_service TO goti_observer;
```

여기서 끝이 아닙니다.
observer가 볼 필요 없는 **PII(개인정보) 테이블의 접근을 차단**해야 합니다.

```sql
-- 3. PII 테이블 SELECT 권한 회수
REVOKE SELECT ON user_service.users FROM goti_observer;
REVOKE SELECT ON user_service.members FROM goti_observer;
REVOKE SELECT ON user_service.accounts FROM goti_observer;
REVOKE SELECT ON user_service.social_providers FROM goti_observer;
REVOKE SELECT ON ticketing_service.tickets FROM goti_observer;
```

왜 이 5개 테이블을 REVOKE했는지 살펴보겠습니다.

| 테이블 | PII 데이터 | observer 필요 여부 |
|--------|-----------|-------------------|
| `user_service.users` | 이메일, 이름 | ❌ 불필요 |
| `user_service.members` | 팀 멤버 개인정보 | ❌ 불필요 |
| `user_service.accounts` | 계정 인증 정보 | ❌ 불필요 |
| `user_service.social_providers` | 소셜 로그인 토큰 | ❌ 불필요 |
| `ticketing_service.tickets` | 구매자 정보 포함 | ❌ 불필요 |

observer는 `seat_statuses`, `orders`, `baseball_teams` 같은 **집계용 테이블만 조회**합니다.
개인정보가 담긴 테이블에 접근할 이유가 전혀 없습니다.

마지막으로, **향후 생성되는 테이블에도 자동 적용**되도록 DEFAULT PRIVILEGES를 설정합니다.

```sql
-- 4. 향후 테이블에 대한 기본 권한 설정
ALTER DEFAULT PRIVILEGES IN SCHEMA user_service
    GRANT SELECT ON TABLES TO goti_observer;
ALTER DEFAULT PRIVILEGES IN SCHEMA ticketing_service
    GRANT SELECT ON TABLES TO goti_observer;
ALTER DEFAULT PRIVILEGES IN SCHEMA stadium_service
    GRANT SELECT ON TABLES TO goti_observer;
ALTER DEFAULT PRIVILEGES IN SCHEMA payment_service
    GRANT SELECT ON TABLES TO goti_observer;
ALTER DEFAULT PRIVILEGES IN SCHEMA matching_service
    GRANT SELECT ON TABLES TO goti_observer;
```

이렇게 하면 새로운 테이블이 추가될 때마다 수동으로 GRANT를 실행할 필요가 없습니다.
물론, 새 PII 테이블이 추가되면 별도로 REVOKE해야 합니다.

### Step 2: Terraform SSM 파라미터 등록 (수동 → IaC)

수동으로 생성했던 SSM 파라미터를 Terraform으로 가져왔습니다.

기존에 수동 생성된 파라미터가 있어서 `terraform import`가 필요했습니다.

```bash
$ terraform import \
    'module.config.aws_ssm_parameter.load_observer_db_dsn' \
    '/prod/load-observer/LOAD_OBSERVER_DB_DSN'

$ terraform import \
    'module.config.aws_ssm_parameter.load_observer_redis_addr' \
    '/prod/load-observer/LOAD_OBSERVER_REDIS_ADDR'
```

Terraform 코드로 관리하면 이런 장점이 있습니다.

```hcl
# modules/config/main.tf

resource "aws_ssm_parameter" "load_observer_db_dsn" {
  name  = "/prod/load-observer/LOAD_OBSERVER_DB_DSN"
  type  = "SecureString"
  value = "postgres://goti_observer:${var.observer_db_password}@${var.rds_endpoint}:5432/goti"

  tags = {
    Service = "load-observer"
    Managed = "terraform"
  }
}

resource "aws_ssm_parameter" "load_observer_redis_addr" {
  name  = "/prod/load-observer/LOAD_OBSERVER_REDIS_ADDR"
  type  = "String"
  value = var.redis_endpoint

  tags = {
    Service = "load-observer"
    Managed = "terraform"
  }
}
```

이제 비밀번호를 변경하려면 **코드를 수정하고, PR을 올리고, 리뷰를 받아야** 합니다.
복붙 실수가 코드 리뷰에서 걸리게 되는 구조입니다.

### Step 3: Terraform drift 수정 (부수 작업)

Terraform import를 하면서 기존 인프라와 코드 간의 drift를 발견했습니다.
이 기회에 함께 정리했습니다.

| 항목 | Before | After |
|------|--------|-------|
| RDS max_connections | 콘솔에서 수동 설정 | Terraform 파라미터 그룹으로 코드화 (`max_connections=200`) |
| RDS/ElastiCache SG | inline ingress + 별도 `aws_security_group_rule` 혼용 | inline ingress로 통합 |
| EKS CloudWatch log group | Terraform + EKS 자체 생성으로 이중 관리 | Terraform 단일 관리 |

이런 drift는 시간이 지나면 **"인프라 코드가 실제 인프라를 반영하지 않는" 상태**가 됩니다.
`terraform plan`에서 예상치 못한 변경이 나타나고, 결국 아무도 `terraform apply`를 신뢰하지 못하게 됩니다.

### 수정 전/후 DB 접근 구조

{/* TODO: Draw.io로 교체 */}

```
수정 전:
┌─────────────────┐     user=goti (master)     ┌──────────┐
│  payment-prod   │──────────────────────────→ │          │
├─────────────────┤     user=goti (master)     │          │
│  observer       │──────────────────────────→ │   RDS    │
├─────────────────┤     user=goti (master)     │  (goti)  │
│  다른 서비스들    │──────────────────────────→ │          │
└─────────────────┘                            └──────────┘
                    ↑ 모든 서비스가 master 유저 공유
                    ↑ observer도 INSERT/DELETE 가능
                    ↑ PII 테이블 무제한 접근

수정 후:
┌─────────────────┐  user=goti_payment_svc     ┌──────────┐
│  payment-prod   │──────────────────────────→ │          │
├─────────────────┤  user=goti_observer        │          │
│  observer       │──────────────────────────→ │   RDS    │
│  (SELECT only)  │  (SELECT only, PII 차단)   │  (goti)  │
├─────────────────┤  user=goti_*_svc           │          │
│  다른 서비스들    │──────────────────────────→ │          │
└─────────────────┘                            └──────────┘
                    ↑ 서비스별 전용 유저
                    ↑ observer는 읽기만 가능
                    ↑ PII 5개 테이블 접근 차단
```

### 검증 결과

goti_observer 유저로 접속해서 권한을 검증했습니다.

**허용된 쿼리 (SELECT on 비-PII 테이블):**

```sql
SELECT count(*) FROM ticketing_service.seat_statuses;
-- 결과: 34,731,639 ✅

SELECT count(*) FROM stadium_service.baseball_teams;
-- 결과: 10 ✅

SELECT count(*) FROM ticketing_service.orders;
-- 결과: 720,000 ✅
```

**차단된 쿼리 (PII 테이블 + 쓰기 작업):**

```sql
SELECT * FROM user_service.users;
-- ERROR: permission denied for table users ❌

SELECT * FROM ticketing_service.tickets;
-- ERROR: permission denied for table tickets ❌

INSERT INTO ticketing_service.seat_statuses (id, status) VALUES (1, 'test');
-- ERROR: permission denied for table seat_statuses ❌
```

3,400만 건의 좌석 데이터를 정상 조회하면서도, 개인정보 테이블과 쓰기 작업은 완벽히 차단됩니다.
이것이 최소 권한 원칙이 적용된 상태입니다.

---

## 🤔 근본 원인: SSM 수동 등록이 위험한 이유

두 장애의 직접적인 원인은 달랐지만, **근본 원인은 동일**합니다.

> SSM Parameter Store에 값을 **수동으로 등록**했습니다.

수동 등록이 왜 위험한지 정리해보겠습니다.

| 문제 | 수동 등록 | Terraform 관리 |
|------|----------|---------------|
| **검증** | 없음 (복붙만 가능) | `terraform plan`으로 변경 사전 확인 |
| **코드 리뷰** | 불가능 | PR 리뷰에서 실수 발견 가능 |
| **감사 추적** | CloudTrail만 (누가 무슨 값을?) | Git 히스토리 + PR 기록 |
| **재현성** | "그때 콘솔에서 뭘 입력했더라..." | 코드로 100% 재현 가능 |
| **Drift 감지** | 불가능 | `terraform plan`에서 감지 |

장애 1에서는 31바이트 문자열을 입력한 것을 **아무도 검증하지 않았습니다**.
Terraform이었다면 `length(var.token_secret_key) == 32` 같은 validation으로 잡을 수 있었습니다.

```hcl
variable "token_secret_key" {
  type      = string
  sensitive = true

  validation {
    condition     = length(var.token_secret_key) == 32
    error_message = "AES-256 Secret Key는 반드시 32바이트여야 합니다."
  }
}
```

장애 2에서는 payment 비밀번호를 observer에 복붙한 것을 **아무도 리뷰하지 않았습니다**.
코드로 관리했다면 `var.observer_db_password`와 `var.payment_db_password`가 다른 변수라는 게 PR에서 명확히 보였을 겁니다.

결국 두 장애 모두 **"사람의 실수를 시스템이 잡지 못한 것"**이 근본 원인입니다.

### 권장: 모든 시크릿을 IaC로

```
[MUST]  모든 SSM Parameter는 Terraform으로 관리
[MUST]  수동 SSM 등록 금지 (긴급 상황 제외)
[SHOULD] 긴급 수동 등록 시, 즉시 Terraform import + PR
[SHOULD] 키 길이, 포맷 등 validation rule 추가
[SHOULD] 서비스별 DB 유저 분리 + 최소 권한 원칙
```

---

## 📚 핵심 포인트

### 1. SSM 수동 등록은 사고를 부른다

두 장애 모두 **수동으로 값을 입력**하면서 발생했습니다.
1바이트 부족, 잘못된 비밀번호 복붙 — 사람은 반드시 실수합니다.
IaC로 관리하면 코드 리뷰, validation, 감사 추적이 자동으로 따라옵니다.

### 2. AES-256은 정확히 32바이트

31바이트도 안 되고, 33바이트도 안 됩니다.
암호화 키를 수동으로 관리한다면, **길이 검증은 필수**입니다.
Terraform variable validation이나 애플리케이션 startup check에서 잡아야 합니다.

### 3. 최소 권한 원칙은 선택이 아니다

observer처럼 SELECT만 필요한 서비스에 master 유저를 공유하면:
- 코드 버그로 데이터 변경 가능
- PII 무제한 접근으로 개인정보 유출 위험
- 장애 시 blast radius가 전체 DB로 확대

**서비스별 전용 유저 + 필요한 권한만 부여**가 원칙입니다.

### 4. Terraform drift는 발견 즉시 수정

콘솔에서 수동 변경한 설정이 쌓이면, Terraform 코드가 실제 인프라를 반영하지 못합니다.
`terraform plan`을 신뢰할 수 없게 되면, IaC의 의미가 사라집니다.
drift를 발견하면 **그 자리에서 바로 코드화**하는 습관이 중요합니다.
