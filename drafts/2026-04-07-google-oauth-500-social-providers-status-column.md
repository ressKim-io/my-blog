---
date: 2026-04-07
category: troubleshoot
project: Goti-server (goti-user-prod)
tags: [google-oauth, hibernate-ddl, rds-permission, schema-migration, social-login]
---

# Google OAuth 500 에러 — social_providers.status 컬럼 누락 (prod RDS)

## Context
- EKS prod 환경 (`goti` namespace)에서 Google 소셜 로그인 시 500 에러 발생
- goti-user-prod 서비스 (Spring Boot, Hibernate `ddl-auto: update`)
- RDS: `goti-prod-postgres.cjqcoy2ce8go.ap-northeast-2.rds.amazonaws.com`
- 테이블 owner: `goti` 유저, 앱 접속 유저: `goti_user_svc`

## Issue

Google OAuth 콜백(`/auth/google/callback`) 호출 시 500 서버 에러.

```
Caused by: org.postgresql.util.PSQLException: ERROR: column spe1_0.status does not exist

SQL: SELECT ... spe1_0.status ... FROM user_service.social_providers spe1_0 ...
```

Hibernate DDL auto가 컬럼 추가를 시도하지만 권한 부족으로 실패:

```
Error executing DDL "alter table if exists user_service.social_providers 
add column status varchar(255) not null check (status in ('ACTIVE','INACTIVE'))" 
via JDBC [ERROR: must be owner of table social_providers]

Caused by: org.postgresql.util.PSQLException: ERROR: must be owner of table social_providers
```

추가로 `SocialAccessTokenResponse`에서 `expires_in` 역직렬화 에러도 있었으나, 이는 별도 PR(`80800ee`)로 `@JsonIgnoreProperties(ignoreUnknown = true)` 추가하여 수정 완료.

재현 조건: prod 환경에서 Google 소셜 로그인 시도 시 100% 재현. dev에서는 정상 (dev DB에는 컬럼 존재).

## Action

1. **가설: 코드 버전 차이** — prod 이미지(`prod-49-4bbdc87`)가 `@JsonIgnoreProperties` 추가 전 버전
   - 결과: 맞음. 수정 커밋 `80800ee`(4/7 02:40)이 prod 이미지(4/6 11:08)보다 이후
   - 하지만 이것만으로는 500 해결 안 됨

2. **가설: DB 스키마 불일치** — `social_providers` 테이블에 `status` 컬럼이 prod DB에 없음
   - 결과: `kubectl logs`에서 `column spe1_0.status does not exist` 확인
   - Hibernate `ddl-auto: update`가 ALTER TABLE 시도하나, 앱 유저(`goti_user_svc`)가 테이블 owner(`goti`)가 아니라 실패

**근본 원인 (Root Cause)**:
- 코드에 `social_providers.status` 컬럼이 Entity에 추가됨
- dev는 Hibernate DDL auto로 자동 생성 성공 (owner 권한 있음)
- prod RDS는 테이블 owner가 `goti`이고 앱 유저가 `goti_user_svc`라 DDL 권한 없음
- **Hibernate DDL auto에 의존하는 스키마 변경이 prod에서 실패하는 구조적 문제**

**적용한 수정**:
- Kyverno 정책 준수하는 임시 psql pod 생성 (labels, resources, securityContext, probes 필수)
- `goti` owner 계정으로 RDS 접속하여 직접 DDL 실행:

```sql
ALTER TABLE user_service.social_providers 
ADD COLUMN status VARCHAR(255) NOT NULL DEFAULT 'ACTIVE' 
CHECK (status IN ('ACTIVE', 'INACTIVE'));
```

- `kubectl rollout restart deploy goti-user-prod -n goti`로 pod 재시작

## Result

- DDL 실행 성공 (`ALTER TABLE` 출력 확인)
- pod 재시작 후 `column does not exist` 에러 로그 사라짐
- Google OAuth 로그인 정상 동작 확인 필요 (사용자 테스트 대기)

**재발 방지책**:
- prod에서 Hibernate `ddl-auto: update` 의존하지 않기 — Flyway/Liquibase 마이그레이션 도입 권장
- Entity에 컬럼 추가 시 prod DDL을 별도로 실행하는 체크리스트 필요
- 또는 앱 유저(`goti_user_svc`)에게 `social_providers` 테이블 ALTER 권한 부여

**Kyverno 임시 pod 생성 시 필수 사항 (참고)**:
- `labels: app, version` 필수
- `resources.limits` 필수
- `securityContext: allowPrivilegeEscalation: false, runAsNonRoot: true, runAsUser: 70`
- `livenessProbe`, `readinessProbe` 필수
- 비밀번호는 `secretKeyRef`로 전달 (특수문자 URL 인코딩 문제 회피)

## Related Files
- `Goti-server/integration/src/main/java/com/goti/infra/api/dto/response/common/SocialAccessTokenResponse.java` — @JsonIgnoreProperties 추가 (PR 80800ee)
- `Goti-server/user/src/main/java/.../domain/entity/SocialProviderEntity.java` — status 컬럼 추가 (원인)
- RDS: `goti-prod-postgres` / 스키마 `user_service` / 테이블 `social_providers`
