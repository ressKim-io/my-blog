---
title: "Signup 500 재발 — JPA JOINED + @DiscriminatorColumn 부재의 dtype 가정 오류"
excerpt: "선행 수정(JPA JOINED 포팅)에서 dtype 컬럼을 가정했지만 실제 prod DB에는 해당 컬럼이 없었습니다. JPA @Inheritance(JOINED)는 @DiscriminatorColumn 명시가 없으면 discriminator 컬럼을 생성하지 않는다는 Hibernate 사양을 놓친 것이 원인이었습니다."
category: challenge
tags:
  - go-ti
  - JPA
  - Hibernate
  - PostgreSQL
  - Migration
  - Cloudflare
series:
  name: "goti-auth"
  order: 6
date: "2026-04-17"
---

## 한 줄 요약

> 선행 dev-log(created_at bug + JPA JOINED 포팅)의 수정 배포 후 팀원 회원가입이 또 500 → Cloudflare 502로 실패했습니다. `SQLSTATE 42703 column "dtype" of relation "users" does not exist`. JPA `@Inheritance(JOINED)`는 `@DiscriminatorColumn` 선언이 없으면 **discriminator 컬럼을 생성하지 않는다**는 Hibernate 6.x 사양을 놓치고 SINGLE_TABLE 동작으로 착각한 것이 원인이었습니다

---

## 🔥 문제: Signup 500 재발, 24분 복구

### 환경

- prod-gcp (GKE `asia-northeast3`), AWS ASG=0, CF Worker failover 활성
- 증상: 팀원 회원가입 500 → Cloudflare 502
- 실패 유형 태그: `context-missing`, `wrong-layer`

### 타임라인 (UTC)

| 시각 | 이벤트 |
|------|-------|
| 06:16:12 | `POST /api/v1/auth/signup` 500 (최초 재발 로그, 이전 배포 `gcp-6-977130c`) |
| 06:17:09 | 동일 client IP 재시도 500 (팀원 1차 신고 시점) |
| 06:19:07 | goti-user 로그 조사 시작, `SQLSTATE 42703` 확인 |
| 06:22~24 | Java `UserEntity`·`MemberEntity` 재검증 → `@DiscriminatorColumn` 부재 확인 |
| 06:25:51 | Goti-go `39cbf37` push + `cd-gcp.yml` 트리거 |
| 06:28:55 | Goti-k8s auto-PR #272 생성 (`gcp-7-39cbf37`) |
| 06:31:31 | PR #272 squash merge |
| 06:32~40 | ArgoCD sync → goti-user Deployment rollout 3/3 |
| 06:40:58 | **`POST /api/v1/auth/signup` 200 OK (30ms)** — 검증 완료 |

총 소요 시간: 신고 → 복구 약 **24분**

### 증상 로그

```json
{
  "time":"2026-04-17T06:17:09.546503241Z",
  "level":"ERROR",
  "msg":"unhandled error",
  "error":"creating member (users): ERROR: column \"dtype\" of relation \"users\" does not exist (SQLSTATE 42703)",
  "path":"/api/v1/auth/signup",
  "method":"POST"
}
```

Cloudflare 응답 헤더:

```text
status: 500
x-envoy-upstream-service-time: 12
x-goti-route-assigned: gcp
x-goti-route-circuit: open
x-goti-route-failover: true
x-goti-route-primary-error: AbortError
x-goti-route-origin: https://gcp-api.go-ti.shop/
```

AWS origin이 ASG=0이라 AbortError → Worker가 GCP로 failover → GCP 앱 500이 발생한 것입니다

---

## 🤔 원인: JPA JOINED + @DiscriminatorColumn 부재

### Java baseline 재검증

```java
// UserEntity.java
@Entity
@Table(name = "users", ...)
@Inheritance(strategy = InheritanceType.JOINED)  // @DiscriminatorColumn 선언 없음
public class UserEntity extends ModificationTimestampEntity { ... }

// MemberEntity.java
@Entity
@Table(name = "members")
@DiscriminatorValue("MEMBER")  // 상위에 @DiscriminatorColumn 없으면 무시됨
public class MemberEntity extends UserEntity { ... }
```

`@DiscriminatorColumn` 선언이 **없습니다**. 이것이 핵심이었습니다

### JPA/Hibernate 6.x 사양 (전략별 차이)

| 전략 | `@DiscriminatorColumn` 생략 시 |
|------|-------------------------------|
| `SINGLE_TABLE` | `DTYPE VARCHAR(31)` **자동 생성** (모든 서브타입을 하나의 테이블에 저장하므로 판별 컬럼 필수) |
| **`JOINED`** | **discriminator 컬럼 생성 안 함** (서브타입은 서브테이블 JOIN 존재 여부로 판별) |
| `TABLE_PER_CLASS` | discriminator 개념 없음 |

선행 이슈 수정(`3a6560c`)에서 **SINGLE_TABLE 동작을 JOINED에 오적용**했습니다
`INSERT INTO users (..., dtype) VALUES (..., 'MEMBER')`를 추가했지만, 실제 prod DB의 `users` 테이블에 `dtype` 컬럼이 **처음부터 존재하지 않았습니다**
그래서 `SQLSTATE 42703 column "dtype" ... does not exist`가 8ms 만에 발생했습니다

### 이전 "성공" 검증이 놓친 경로

선행 dev-log에 "12:40 KST 팀원 회원가입 성공" 기록이 있었지만, `3a6560c` 배포 후 경로에서는 항상 500이 나야 정상입니다

원인은 다음과 같이 추정됩니다

- 검증이 SMS 인증 통과 시점까지만 이루어지고 최종 `POST /signup`에는 도달하지 않은 채 "성공"으로 보고됨
- Cloudflare Worker의 502/504 마스킹(failover 헤더 확인 누락)도 오진에 일조

**구두 확인만으로 세션을 마감하는 것은 검증이 아니었습니다.**

---

## ✅ 해결: Goti-go `39cbf37` — dtype 컬럼 참조 제거

```diff
- // dtype 컬럼은 Hibernate 기본값 'DTYPE VARCHAR(31)'으로 생성됨 ("MEMBER" 값 필수).
+ // UserEntity에 @DiscriminatorColumn 선언 없음 → Hibernate는 discriminator 컬럼 생성 안 함
+ // (JOINED 전략 + @DiscriminatorColumn 생략 시 Hibernate 6.x 기본 동작).
+ // 따라서 users 테이블에 dtype 컬럼 없음. 서브타입 판별은 members 서브테이블 JOIN으로 수행.

- INSERT INTO users (id, mobile, name, gender, birth_date, status, role, dtype, created_at, updated_at)
- VALUES ($1, $2, $3, $4, $5, 'ACTIVATED', $6, 'MEMBER', NOW(), NOW())
+ INSERT INTO users (id, mobile, name, gender, birth_date, status, role, created_at, updated_at)
+ VALUES ($1, $2, $3, $4, $5, 'ACTIVATED', $6, NOW(), NOW())
```

- `members` 서브테이블 INSERT는 유지 (JOINED FK 무결성 필요)
- `EnsureMembersRow` (orphan idempotent 보정)도 그대로 유지

### 검증

배포 후 동일 client IP 재시도:

```text
06:40:44 POST /api/v1/auth/signup/sms/send → 200 (256ms)
06:40:58 POST /api/v1/auth/signup          → 200 (30ms)
```

goti-user 전체 pod(3/3)이 `gcp-7-39cbf37` 이미지로 전환되었고, dtype/SQLSTATE 에러 재발이 없음을 관측했습니다

---

## 실패 유형 태그

- **`context-missing`** — JPA `@Inheritance` 전략별 Hibernate 기본 동작 차이가 코드·주석에 부정확히 기록. 선행 수정자는 SINGLE_TABLE 맥락을 JOINED에 일반화했습니다
- **`wrong-layer`** — 선행 수정 시 "DB 스키마 검증"(psql로 `\d users`) 레이어를 건너뛰고 "코드 자체 일관성"만 확인했습니다. Hibernate 동작 추론이 실제 DB 스키마와 괴리된 것이 원인입니다

---

## 📚 배운 점

- **JPA `@Inheritance` 전략별 동작은 명시적으로 확인합니다.**
  - `SINGLE_TABLE` ≠ `JOINED` ≠ `TABLE_PER_CLASS`
  - `@DiscriminatorColumn` 명시 여부가 discriminator 컬럼 생성을 결정합니다 (JOINED의 경우)
  - Entity 클래스를 Go로 포팅할 때는 Hibernate 공식 레퍼런스 또는 **실제 DB 스키마**를 1차 소스로 확인합니다

- **"성공 검증"은 경로 끝까지 수행합니다.**
  - "팀원이 성공했다"는 구두 확인은 검증이 아닙니다
  - 배포 직후 핵심 엔드포인트(`/auth/signup` 등)는 응답 코드 + DB row 존재 확인까지 포함한 smoke test가 필수입니다
  - 가능하면 스크립트(k6·curl)로 재현 가능한 형태로 수행합니다

- **CF failover 헤더는 디버깅 시작점입니다.**
  - `x-goti-route-failover: true` + `x-goti-route-primary-error: AbortError` + `x-goti-route-assigned: gcp` 조합이면 GCP 앱 500 가능성이 1순위입니다
  - 1차 응답 코드(502/504)에 휘둘리지 말고 실제 origin pod 로그로 직행합니다

- **코드 주석은 근거의 앵커입니다.**
  - "Hibernate 기본값으로 생성됨" 같은 단정형 주석은 소스 검증 없이 답습되기 쉽습니다
  - 근거 문서 링크 또는 사양 참조(예: JPA 2.2 §11.1.11)를 남기면 후속 수정자가 재검증할 수 있습니다

- **"DB 스키마 검증" 레이어를 건너뛰지 않습니다.** 코드 일관성만 검토하면 "이론상 맞는 SQL"이 실제 DB에서는 실패합니다. 수정 전에 `psql \d <table>`로 스키마를 확인하는 단계를 명시적으로 포함합니다
