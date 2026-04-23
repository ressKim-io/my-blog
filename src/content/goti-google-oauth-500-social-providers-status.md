---
title: "Google OAuth 500 — social_providers.status 컬럼 누락 (prod RDS)"
excerpt: "prod 환경 Google 소셜 로그인에서 500 에러. 원인은 Entity에 추가된 status 컬럼을 Hibernate ddl-auto가 추가하려 했지만 앱 유저가 테이블 owner가 아니라 ALTER 권한이 없었던 것. owner 계정으로 직접 DDL 실행해 해결했습니다."
category: challenge
tags:
  - go-ti
  - OAuth
  - Google
  - PostgreSQL
  - Hibernate
  - RDS
  - Kyverno
  - troubleshooting
series:
  name: "goti-auth"
  order: 3
date: "2026-04-07"
---

## 한 줄 요약

> EKS prod에서 Google 소셜 로그인 시 500 에러가 발생했습니다. 원인은 `social_providers.status` 컬럼이 Entity에는 있지만 prod RDS에는 없었고, Hibernate `ddl-auto: update`가 ALTER를 시도했지만 앱 유저가 테이블 owner가 아니라 실패한 것이었습니다. owner 계정으로 직접 DDL을 실행해 해결했습니다

---

## 🔥 문제: Google OAuth 콜백에서 500

EKS prod 환경(`goti` namespace)에서 Google 소셜 로그인 시 500 서버 에러가 발생했습니다

- 대상 서비스: `goti-user-prod` (Spring Boot, Hibernate `ddl-auto: update`)
- 테이블 owner: `goti` 유저 / 앱 접속 유저: `goti_user_svc`
- 재현 조건: prod에서 Google 소셜 로그인 시도 시 100% 재현. dev에서는 정상(dev DB에는 컬럼 존재)

### 에러 로그

```text
Caused by: org.postgresql.util.PSQLException:
ERROR: column spe1_0.status does not exist

SQL: SELECT ... spe1_0.status ... FROM user_service.social_providers spe1_0 ...
```

Hibernate DDL auto가 컬럼 추가를 시도하지만 권한 부족으로 실패했습니다

```text
Error executing DDL "alter table if exists user_service.social_providers
add column status varchar(255) not null check (status in ('ACTIVE','INACTIVE'))"
via JDBC [ERROR: must be owner of table social_providers]

Caused by: org.postgresql.util.PSQLException:
ERROR: must be owner of table social_providers
```

참고로 `SocialAccessTokenResponse`에서 `expires_in` 역직렬화 에러도 있었지만, 이는 별도 PR에서 `@JsonIgnoreProperties(ignoreUnknown = true)`를 추가해 선행 수정했습니다

---

## 🤔 원인: Hibernate DDL auto가 prod에서 실패하는 구조적 문제

두 가지 가설을 순차적으로 확인했습니다

1. **코드 버전 차이** — prod 이미지(`prod-49-4bbdc87`)가 `@JsonIgnoreProperties` 추가 전 버전. 확인 결과 수정 커밋이 prod 이미지 빌드 이후였음. 맞지만 500 자체는 해결되지 않았습니다
2. **DB 스키마 불일치** — `social_providers` 테이블에 `status` 컬럼이 prod DB에 없음. 로그에서 `column spe1_0.status does not exist` 확인

### 근본 원인

- 코드에서 `social_providers.status` 컬럼이 Entity에 추가되었습니다
- dev는 Hibernate DDL auto로 자동 생성에 성공했습니다(owner 권한 보유)
- prod RDS는 **테이블 owner가 `goti`, 앱 유저가 `goti_user_svc`**라 DDL 권한이 없습니다
- 결국 **Hibernate DDL auto에 의존하는 스키마 변경이 prod에서 실패하는 구조적 문제**입니다

dev 환경에서는 편의상 같은 유저가 owner까지 겸해서 ddl-auto가 잘 동작합니다
prod 환경에서는 최소 권한 원칙으로 앱 유저와 owner 유저를 분리했기 때문에 ALTER가 막힙니다. 이 차이가 "dev에서는 됐는데 prod에서 안 된다"의 원인이었습니다

---

## ✅ 해결: owner 계정으로 직접 DDL 실행

### 임시 psql pod 생성 (Kyverno 정책 준수)

prod RDS는 VPC 내부에서만 접근 가능하므로 K8s 내 임시 psql pod에서 접속했습니다
Kyverno 정책을 통과하기 위해 pod spec에 다음 항목을 모두 맞춰야 했습니다

- `labels`: `app`, `version` 필수
- `resources.limits` 필수
- `securityContext`: `allowPrivilegeEscalation: false`, `runAsNonRoot: true`, `runAsUser: 70`
- `livenessProbe`, `readinessProbe` 필수
- DB 비밀번호는 `secretKeyRef`로 전달 (특수문자 URL 인코딩 문제 회피)

### owner 계정으로 DDL 실행

```sql
ALTER TABLE user_service.social_providers
ADD COLUMN status VARCHAR(255) NOT NULL DEFAULT 'ACTIVE'
CHECK (status IN ('ACTIVE', 'INACTIVE'));
```

`goti` owner 계정으로 RDS에 접속해 컬럼을 추가했습니다. `DEFAULT 'ACTIVE'`를 넣어 기존 row도 자동 채움

### pod 재시작

```bash
kubectl rollout restart deploy goti-user-prod -n goti
```

---

## Result

- DDL 실행 성공 (`ALTER TABLE` 출력 확인)
- pod 재시작 후 `column does not exist` 에러 로그 소멸
- Google OAuth 로그인 정상 동작

---

## 📚 배운 점 — 재발 방지책

- **prod에서 Hibernate `ddl-auto: update` 의존을 끊습니다.** Flyway/Liquibase 같은 명시적 마이그레이션 도구 도입이 권장됩니다. Entity 변경 → DDL이 자동이라는 가정은 dev에서만 성립합니다
- **Entity 컬럼 추가 시 prod DDL 실행을 별도 체크리스트로 관리합니다.** PR 템플릿에 "Entity 컬럼/테이블 변경 여부" 체크박스를 추가하고, 체크 시 마이그레이션 스크립트 작성을 강제합니다
- **또는 앱 유저에게 대상 테이블의 ALTER 권한을 부여합니다.** 최소 권한 원칙과 trade-off가 있으니 팀에서 합의한 뒤 결정합니다
- **Kyverno 정책 준수 pod 템플릿을 재사용 가능하게 저장해둡니다.** labels, resources, securityContext, probes까지 맞춘 템플릿을 매번 새로 작성하는 것은 비효율적입니다. 임시 DB 접속 pod 템플릿을 팀 공유 저장소에 둡니다
- **dev/prod 권한 구조 차이를 문서화합니다.** "dev는 owner=앱유저이지만 prod는 분리되어 있다"는 제약 조건이 Entity 변경 시 영향을 주는데, 문서화되지 않으면 반복해서 같은 트러블에 걸립니다
