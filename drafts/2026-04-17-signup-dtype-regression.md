# 2026-04-17 — Signup 500 재발 (dtype 컬럼 가정 오류)

- **환경**: prod-gcp (GKE `asia-northeast3`), AWS ASG=0 상태, CF Worker failover 활성
- **증상**: 팀원 회원가입 500 → Cloudflare 502
- **근본 원인**: Go INSERT 쿼리가 `dtype` 컬럼을 참조하나 GCP prod DB `users` 테이블에 해당 컬럼이 존재하지 않음
- **해결**: Go 코드에서 dtype/discriminator 참조 제거 후 재배포
- **실패 유형 태그**: `context-missing`, `wrong-layer`

> 선행 이슈 기록: [2026-04-17-signup-created-at-bug-and-sql-audit.md](2026-04-17-signup-created-at-bug-and-sql-audit.md)
> 본 문서는 해당 dev-log의 "재발" 섹션을 독립 기록으로 분리한 것.

---

## 타임라인 (UTC)

| 시각 | 이벤트 |
|------|--------|
| `06:16:12` | POST `/api/v1/auth/signup` 500 (최초 재발 로그, 이전 배포 `gcp-6-977130c`) |
| `06:17:09` | 동일 client_ip(58.235.174.53) 재시도 500 (팀원 1차 신고 시점) |
| `06:19:07` | 담당자 goti-user 로그 조사 시작, `SQLSTATE 42703` 확인 |
| `06:22~24` | Java `UserEntity` / `MemberEntity` 재검증 → `@DiscriminatorColumn` 부재 확인 |
| `06:25:51` | Goti-go `39cbf37` push + `cd-gcp.yml` 트리거 (run #24551183335) |
| `06:28:55` | Goti-k8s auto-PR #272 생성 (`gcp-7-39cbf37`) |
| `06:31:31` | PR #272 squash merge (commit `bd963e0`) |
| `06:32~40` | ArgoCD sync → goti-user Deployment rollout 3/3 |
| `06:40:44` | SMS send 200 (동일 client_ip 재시도) |
| `06:40:58` | **POST /api/v1/auth/signup 200 OK (30ms) — 검증 완료** |

총 소요: 신고 → 복구 약 **24분**.

---

## 증상 로그 (Before)

```json
{
  "time":"2026-04-17T06:17:09.546503241Z",
  "level":"ERROR",
  "msg":"unhandled error",
  "error":"creating member (users): ERROR: column \"dtype\" of relation \"users\" does not exist (SQLSTATE 42703)",
  "path":"/api/v1/auth/signup",
  "method":"POST"
}
{
  "time":"2026-04-17T06:17:09.546753925Z",
  "level":"ERROR",
  "msg":"request","method":"POST","path":"/api/v1/auth/signup",
  "status":500,"latency_ms":8,"client_ip":"58.235.174.53"
}
```

Cloudflare 응답 헤더:
```
status: 500
x-envoy-upstream-service-time: 12
x-goti-route-assigned: gcp
x-goti-route-circuit: open
x-goti-route-failover: true
x-goti-route-primary-error: AbortError
x-goti-route-origin: https://gcp-api.go-ti.shop/
```
AWS origin이 ASG=0이라 AbortError → Worker가 GCP로 failover → GCP 앱 500.

---

## 근본 원인

### Java baseline 재검증

```java
// UserEntity.java
@Entity
@Table(name = "users", uniqueConstraints = {
    @UniqueConstraint(name = "uk_users_mobile", columnNames = "mobile")
})
@Inheritance(strategy = InheritanceType.JOINED)  // @DiscriminatorColumn 선언 없음
public class UserEntity extends ModificationTimestampEntity { ... }

// MemberEntity.java
@Entity
@Table(name = "members")
@DiscriminatorValue("MEMBER")  // 상위에 @DiscriminatorColumn 없으면 무시
public class MemberEntity extends UserEntity { ... }
```

### JPA/Hibernate 6.x 사양 (전략별 차이)

| 전략 | `@DiscriminatorColumn` 생략 시 |
|------|-------------------------------|
| `SINGLE_TABLE` | `DTYPE VARCHAR(31)` **자동 생성** (모든 서브타입을 하나의 테이블에 저장하므로 판별 컬럼 필수) |
| **`JOINED`** | **discriminator 컬럼 생성 안 함** (서브타입은 서브테이블 JOIN 존재 여부로 판별) |
| `TABLE_PER_CLASS` | discriminator 개념 없음 |

선행 이슈 수정(`3a6560c`)에서 SINGLE_TABLE 동작을 JOINED에 오적용하여 `INSERT INTO users (..., dtype) VALUES (..., 'MEMBER')` 추가. 실제 prod DB의 `users` 테이블에 `dtype` 컬럼은 **처음부터 존재하지 않음** → SQLSTATE 42703(column does not exist), 8ms 만에 실패.

### 이전 "성공" 검증이 놓친 경로

- 선행 dev-log에 "12:40 KST 팀원 회원가입 성공" 기록이 있으나 `3a6560c` 배포 후 경로에서는 항상 500이 나야 함.
- 추정: 검증이 SMS 인증 통과 시점까지만 이루어지고 최종 `POST /signup`에는 도달하지 않은 채 "성공"으로 보고됨.
- Cloudflare Worker의 502/504 마스킹(failover 헤더 확인 누락)도 오진에 일조.

---

## 수정

### Goti-go `39cbf37`

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

### 관련 커밋/PR

| 레포 | 변경 | 비고 |
|------|------|------|
| Goti-go | `39cbf37` fix(user): users INSERT에서 dtype 컬럼 제거 | main push |
| Goti-k8s | `bd963e0` PR #272 squash merge | tag `gcp-6-977130c` → `gcp-7-39cbf37` |
| goti-team-controller | `54a2cf4` docs(dev-logs): 선행 dev-log 가정 정정 | 본 문서 별도 분리 |

---

## 검증 (After)

배포 후 동일 client_ip 재시도:
```
06:40:44Z POST /api/v1/auth/signup/sms/send → 200 (256ms)
06:40:58Z POST /api/v1/auth/signup         → 200 (30ms)
```

goti-user 전체 pod(3/3)이 `gcp-7-39cbf37` 이미지, dtype/SQLSTATE 에러 재발 없음 관측.

---

## 실패 유형 태그

- **`context-missing`** — JPA `@Inheritance` 전략별 Hibernate 기본 동작 차이가 코드/주석에 부정확히 기록. 선행 수정자는 SINGLE_TABLE 맥락을 JOINED에 일반화.
- **`wrong-layer`** — 선행 수정 시 "DB 스키마 검증"(psql로 `\d users`) 레이어를 건너뛰고 "코드 자체 일관성"만 확인. Hibernate 동작 추론이 실제 DB 스키마와 괴리.

---

## Lessons

1. **JPA `@Inheritance` 전략별 동작은 명시적으로 확인 필요**
   - SINGLE_TABLE ≠ JOINED ≠ TABLE_PER_CLASS
   - `@DiscriminatorColumn` **명시 여부**가 discriminator 컬럼 생성을 결정 (JOINED의 경우)
   - Entity 클래스를 Go로 포팅할 때는 Hibernate 공식 레퍼런스 또는 **실제 DB 스키마**를 1차 소스로 확인

2. **"성공 검증"은 경로 끝까지**
   - "팀원이 성공했다"는 구두 확인은 검증이 아님
   - 배포 직후 핵심 엔드포인트(`/auth/signup` 등)는 응답 코드 + DB row 존재 확인까지 포함한 smoke test 필수
   - 가능하면 스크립트(k6/curl)로 재현 가능한 형태로 수행

3. **CF failover 헤더는 디버깅 시작점**
   - `x-goti-route-failover: true` + `x-goti-route-primary-error: AbortError` + `x-goti-route-assigned: gcp` 조합이면 GCP 앱 500 가능성이 1순위
   - 1차 응답 코드(502/504)에 휘둘리지 말고 실제 origin pod 로그로 직행
   - 본 사건도 Cloudflare 500이 드러나게 도달했지만(Worker가 500 그대로 전달), failover 헤더가 방향 제시에 핵심 역할

4. **코드 주석은 근거의 앵커**
   - "Hibernate 기본값으로 생성됨"처럼 단정형 주석은 소스 검증 없이 답습되기 쉬움
   - 근거 문서 링크 또는 사양 참조(예: JPA 2.2 §11.1.11)를 남기면 후속 수정자가 재검증 가능

---

## 관련 아티팩트

- 선행 dev-log: [`2026-04-17-signup-created-at-bug-and-sql-audit.md`](2026-04-17-signup-created-at-bug-and-sql-audit.md)
- 오류 수정 커밋: `39cbf37` (Goti-go)
- 배포 이미지: `gcp-7-39cbf37` (Artifact Registry: `asia-northeast3-docker.pkg.dev/project-7b8317dd-9b4d-4f5f-ba2/goti-prod-registry/goti-user-go`)
- CD run: [Goti-go Actions #24551183335](https://github.com/ressKim-io/Goti-go/actions/runs/24551183335)
- Auto-PR: [Goti-k8s #272](https://github.com/Team-Ikujo/Goti-k8s/pull/272)
