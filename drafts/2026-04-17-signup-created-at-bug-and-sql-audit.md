# 2026-04-17 — Signup 500 (created_at NULL) 버그 + SQL 감사 스크립트

- **환경**: prod-gcp (GKE), AWS ASG=0 상태
- **증상**: 팀원이 GCP 신규 회원가입 시 최종 "완료" 버튼에서 30초 지연 후 CF 504 페이지
- **근본 원인**: Go INSERT 문에 `created_at`/`updated_at` 컬럼 누락 (복수 repo)
- **해결**: 패턴 전수 스캔 + 3커밋 + 재배포 + 감사 스크립트 저장

---

## 타임라인

### 11:53 — SMS env 수정 배포 후 첫 신고
- PR #265(SMS env 추가) merge/sync 완료
- SMS 수신은 정상 동작 시작

### 12:04~12:10 — 팀원 회원가입 시도
```
02:04:48 POST /sms/send → 200 ✅ (SMS 실제 발송)
02:05:08 POST /signup → 500 ❌ users.created_at NOT NULL 위반
02:06:39 POST /signup → 401 (SMS 코드 재시도 과정)
02:07:10 POST /signup → 401
```

### 12:15~12:30 — 1차 수정
- `MemberRepository.Create`에 `created_at, updated_at NOW()` 추가
- Cloud Build 경로 → Docker Desktop → CD workflow(WIF) 순으로 시도
- **메모리 오인 정정**: `project_gcp_ci_wif_todo.md` 3일 전 상태 기준 "WIF 미설정"이었으나, 실제로는 2026-04-15에 통합 CD 구축 완료됨

### 12:30~12:40 — CD 자동 빌드 체인 확인
```
gh workflow run cd-gcp.yml --ref=main -f services=user
→ Cloud Build (WIF 인증)
→ Artifact Registry push (gcp-2-362b0e1)
→ Goti-k8s auto-PR #266 (peter-evans/create-pull-request)
→ squash merge
→ ArgoCD sync
→ rollout
```

### 12:41 — 팀원 재테스트, 다시 504
```
02:41:23 POST /signup → 500 ❌ social_providers.created_at NOT NULL 위반
02:41:33 UTC — CF 504 (Worker failover → AWS 빈 origin → timeout)
```
Signup flow는 `member create` 다음에 `social_provider create`. 같은 패턴 버그가 **다음 repo로 전파**되어있었음.

### 12:42~12:50 — 전수 스캔 접근 전환
사용자 피드백:
> "같은 패턴이면 이런거 좀 넓게 다 서칭해볼 수 있어??
> 다 겪고 바꾸는거보다 미리 서칭해서 찾을 수 있으면 좋겠어."

Python regex로 `internal/` 전수 스캔 → **6개 파일 추가 발견**:

| 도메인 | 파일 | 테이블 |
|--------|------|-------|
| user | social_provider_repo.go | social_providers |
| user | account_repo.go | accounts |
| user | address_repo.go | addresses |
| stadium | team_repo.go | baseball_teams |
| stadium | stadium_repo.go | stadiums |
| stadium | home_stadium_repo.go | home_stadiums |

### 12:50~13:00 — 일괄 수정 + 재빌드
- `ba1cad1` (user 3 repo), `a47c425` (stadium 3 repo) 커밋
- CD 재트리거 `-f services=user,stadium`
- Auto-PR #267 merge → rollout 완료
- 이미지 `gcp-3-a47c425` 배포

### 13:05 — 감사 스크립트 저장
`Goti-go/scripts/audit-sql-timestamps.py` (150줄) — 재사용 가능한 패턴 스캐너.

---

## 근본 원인 분석

### Java baseline에선 왜 발생 안 했는가
JPA `@CreationTimestamp` / `@UpdateTimestamp` 어노테이션이 Hibernate 레벨에서 자동 set. Java 개발자는 DB NOT NULL + DEFAULT 없이도 정상 동작.

### Go 포팅 시 누락된 이유
Go는 명시적 SQL. Java의 @CreationTimestamp 자동 마법이 Go 코드로 이식되지 않음. `member_repo.go`는 RETURNING에 `created_at`을 포함(읽어서 domain struct에 담음)하지만 INSERT 컬럼에는 빠짐 → **"Scan해서 기대하지만 Insert는 안 함"**.

### Silent 실패 (failover 유혹)
Cloudflare Worker가 GCP 500 → AWS failover를 수행. AWS가 비어있어 30초 timeout → CF 504. 사용자가 보기에는 "AWS 에러"처럼 보이지만 **진짜 원인은 GCP 앱 500**. x-goti-route-failover 헤더로 판별 가능.

---

## 해결책 + 재발 방지

### 즉각 조치 (완료)
- INSERT 문에 `created_at, updated_at NOW(), NOW()` 명시
- 전체 INSERT 전수 스캔 결과 0건 확인

### 중장기 (권장)
1. **DB 레벨 DEFAULT 추가** — 모든 `created_at/updated_at` 컬럼에 `DEFAULT NOW()` + `ON UPDATE`
   - 현재는 Java baseline이 앱 레벨 처리라 DB에 DEFAULT 없음
   - Go 도입으로 DB DEFAULT가 안전망이 되어야 함
2. **CI에 감사 스크립트 통합** — `audit-sql-timestamps.py --strict` 블로킹 테스트
3. **Go repo 코드 생성기 검토** — sqlc / bob 등으로 repeat 줄이기 (`project_sql_validation_todo.md` 참조)

---

## 도구: audit-sql-timestamps.py

저장 위치: `Goti-go/scripts/audit-sql-timestamps.py`

감사 대상 패턴:
1. **INSERT 치명**: RETURNING에 `created_at`/`updated_at` 있는데 컬럼 리스트/VALUES에 없음 → 런타임 500
2. **UPDATE 의심**: SET절에 `updated_at` 없음 → 정당할 수도 있어 수동 확인

사용:
```bash
# 기본 (internal/ 디렉토리)
python3 scripts/audit-sql-timestamps.py

# 특정 디렉토리
python3 scripts/audit-sql-timestamps.py internal/user

# CI 블로킹
python3 scripts/audit-sql-timestamps.py --strict
```

패턴 확장 지점:
- `deleted_at` 소프트 삭제 누락 탐지 추가 가능
- `ON CONFLICT DO UPDATE SET ... updated_at` 강제 검증 추가 가능
- UPDATE 화이트리스트 (정당한 non-updated_at UPDATE) 확장

---

## 관련 아티팩트

- Goti-go 커밋: `362b0e1`, `ba1cad1`, `a47c425`, `5d4ecce`
- Goti-k8s PR: #266 (user 첫 fix), #267 (user+stadium fix)
- 이미지 태그: `gcp-2-362b0e1` → `gcp-3-a47c425`
- Plan 파일: `/Users/ress/.claude/plans/sequential-roaming-sky.md` (JWT 플랜, 본 이슈는 연장선)

---

## Lessons

1. **한 개 고치면 끝 금지** — 버그가 같은 패턴으로 반복될 가능성을 먼저 가정하고 전수 스캔
2. **CF failover는 근본 원인 마스킹** — AWS 504만 보고 판단하면 GCP 앱 500 놓침. Worker 로그 + 원본 pod 로그 둘 다 필수
3. **메모리는 point-in-time** — 3일 전 "WIF 미설정" 메모리 때문에 수동 빌드 시도했음. 항상 `git log`로 최신 상태 verify
4. **재사용 가능한 감사 도구 저장** — 개별 수정 → 전수 스캔 → 스크립트 저장 3단계가 정석 루틴

---

## 후속 이슈 — JPA JOINED Inheritance 포팅 누락 (같은 날)

### 증상 재발
`created_at` fix 배포 후에도 signup이 500 → 504. 로그 분석:
```
ERROR: insert or update on table "social_providers" violates foreign key constraint
"fk5o97euua555tpg13r9qbpqv3p" (SQLSTATE 23503)
```

### 근본 원인
Java baseline이 JPA **`@Inheritance(strategy=JOINED)`** 사용:
- `UserEntity @Table("users")` + `@Inheritance(JOINED)` (부모)
- `MemberEntity @Table("members") extends UserEntity @DiscriminatorValue("MEMBER")` (자식)
- JPA가 자동으로 양쪽 테이블에 INSERT
- `social_providers.member_id` FK → **`members.id`** 참조

Go 포팅은 `users` INSERT만 수행, `members` 테이블 미처리 → FK 위반.

### JPA 전수 감사 (사용자 제안: "버전도 달라졌는데 pull 받아서 비교")
| JPA 기능 | 발견 | Go 상태 |
|----------|------|---------|
| `@Inheritance(JOINED)` | 1건 (UserEntity) | ❌ 이번에 fix |
| `@DiscriminatorValue` | 1건 (MemberEntity) | 동일 fix |
| `@Version` | 1건 (ResaleRestriction) | ✅ 이미 구현 |
| `@EmbeddedId` | 1건 (QueueEntrySnapshot) | N/A (Redis 전용, TODO kafka) |
| `@Embedded` / `@PrePersist` / Cascade / SoftDelete | 0건 | — |

결론: JPA magic 주요 항목은 JOINED 하나가 유일한 critical 누락.

### 수정 (`3a6560c`) — ⚠️ 잘못된 가정 포함, 후속 재수정 필요 (아래 "재발" 섹션 참조)
```go
func (r *MemberRepository) Create(...) (*domain.Member, error) {
    tx, _ := r.db.Begin(ctx)
    defer tx.Rollback(ctx)

    // 1. users + dtype (Hibernate 기본 discriminator 컬럼) ← 잘못된 가정
    tx.QueryRow(ctx, `INSERT INTO users (..., dtype, ...) VALUES (..., 'MEMBER', ...) RETURNING ...`)

    // 2. members (PK = users.id)
    tx.Exec(ctx, `INSERT INTO members (id) VALUES ($1)`, id)

    tx.Commit(ctx)
}
```

**잘못된 가정**: "dtype 컬럼은 Hibernate 기본값으로 생성됨"으로 적었지만 이는 `@Inheritance(SINGLE_TABLE)`의 동작이다. `@Inheritance(JOINED)` 전략에서는 `@DiscriminatorColumn`을 **명시적으로 선언해야만** discriminator 컬럼이 생성된다. `UserEntity`에 `@DiscriminatorColumn` 선언이 없으므로 실제 GCP prod DB의 `users` 테이블에 `dtype` 컬럼은 **처음부터 존재하지 않음**. Hibernate 6.x 기본 동작: JOINED + `@DiscriminatorColumn` 생략 시 서브타입 판별은 서브테이블 JOIN으로만 수행.

12:40 KST "성공" 기록은 실제 signup까지 도달하지 않았거나 검증이 불완전했던 것으로 추정 (재현 테스트 시 동일 에러 확인).

---

## Orphan 잔류 데이터 — signup 재시도 경로 호환 (`be21c58`)

### 증상
수정 배포 후에도 팀원 signup 실패. 로그 재확인:
- 이전 시도로 `users`에 row 남음 (created_at bug 이전 JOINED bug로 INSERT 자체는 성공)
- 재시도 시 `FindByMobile` → orphan 리턴 → `Create` 스킵
- `socialRepo.Create` → members 없어서 FK 재실패

### 수정 (idempotent 보정)
`MemberRepository.EnsureMembersRow(id)`:
```sql
INSERT INTO members (id) VALUES ($1) ON CONFLICT (id) DO NOTHING
```

`AuthService.Signup`의 기존 member 재사용 경로에서 호출:
```go
if member == nil {
    member, err = s.memberRepo.Create(...)  // 새로 생성
} else {
    s.memberRepo.EnsureMembersRow(ctx, member.ID)  // orphan 복구
}
```

### Orphan 정리 (사용자 요청: "깨끗하고 정확하게 test 되어야")
프로덕션 DB에서 미해결 orphan 직접 삭제:
```sql
DELETE FROM user_service.users
WHERE id = '6fce45b8-91a5-400e-992f-fb287271b888'
RETURNING id, mobile, name;
-- DELETE 1 | 김현희 / 01067812640
```

### 실행 방법 (재현 가능)
- Cloud SQL private IP → 로컬 proxy 불가
- K8s Job(postgres:15-alpine) + VPC 내부 psql → Kyverno 정책 6번 거쳐 통과:
  1. `securityContext.allowPrivilegeEscalation: false`
  2. labels `app`, `version`
  3. `resources.limits` CPU/메모리
  4. `livenessProbe` + `readinessProbe`
  5. `capabilities.drop: [ALL]`
  6. `seccompProfile.type: RuntimeDefault`
- DB 자격증명은 K8s Secret(`goti-user-prod-gcp-secrets`)에서 env로 주입 (plaintext 노출 없음)

---

## 최종 배포 이력 (2026-04-17 세션)

| 커밋 | 내용 | 이미지 |
|------|------|--------|
| `362b0e1` | users.created_at 명시 | `gcp-2-362b0e1` |
| `ba1cad1` | 5개 table INSERT timestamps | — |
| `a47c425` | stadium 3개 repo timestamps | `gcp-3-a47c425` |
| `5d4ecce` | audit-sql-timestamps.py 추가 | — |
| `3a6560c` | JPA JOINED members 포팅 | `gcp-4-3a6560c` |
| `be21c58` | orphan 호환 EnsureMembersRow | `gcp-5-be21c58` |

Goti-k8s PR: #266, #267, #268, #269 전부 squash merge

**최종 검증**: 팀원 회원가입 성공 (2026-04-17 12:40 KST 이후)

---

## Lessons (추가)

5. **JPA annotation → Go 포팅은 명시적 SQL 필요** — `@CreationTimestamp`, `@Inheritance`, `@Version` 등 ORM 마법은 Go로 1:1 이식 안 됨. Entity class를 **하나씩 읽어서 SQL 관점으로 변환** 필요
6. **프로덕션 orphan 정리는 K8s Job + Kyverno 호환 템플릿** — Cloud SQL private IP 환경에서는 VPC 내부 실행이 유일한 경로. 6개 정책 통과 템플릿 패턴 재사용 가능
7. **targeted UUID DELETE 우선** — 1M+ row 테이블에서 `NOT IN (subquery)`는 느림. 대상 UUID 확인 후 `WHERE id = '...'`로 직접 삭제

---

## 재발 — dtype 컬럼 가정 오류 (같은 날 15:17 KST)

### 증상
팀원 재시도 → signup 500 재발, CF 502 반환.
```
{"level":"ERROR","msg":"unhandled error",
 "error":"creating member (users): ERROR: column \"dtype\" of relation \"users\" does not exist (SQLSTATE 42703)",
 "path":"/api/v1/auth/signup","method":"POST"}
```
배포된 이미지: `gcp-6-977130c` (be21c58 포함). Cloudflare 경로: `x-goti-route-failover: true` (AWS AbortError → GCP).

### 근본 원인 — 상위 Java 코드 재검증
```java
// UserEntity.java
@Entity
@Table(name = "users", ...)
@Inheritance(strategy = InheritanceType.JOINED)  // @DiscriminatorColumn 선언 없음
public class UserEntity extends ModificationTimestampEntity { ... }

// MemberEntity.java
@Entity
@Table(name = "members")
@DiscriminatorValue("MEMBER")  // discriminator 컬럼 없으면 무시됨
public class MemberEntity extends UserEntity { ... }
```

**JPA/Hibernate 6.x 사양**:
- `@Inheritance(SINGLE_TABLE)`: `@DiscriminatorColumn` 생략 시 `DTYPE VARCHAR(31)` **자동 생성**
- `@Inheritance(JOINED)`: `@DiscriminatorColumn` 생략 시 discriminator 컬럼 **생성 안 함** (서브타입 판별은 서브테이블 JOIN)
- `@Inheritance(TABLE_PER_CLASS)`: discriminator 컬럼 없음

**`3a6560c` 커밋은 SINGLE_TABLE 동작을 JOINED에 오적용**. 실제 prod DB의 `users` 테이블에 `dtype` 컬럼이 애초에 없었으므로 `INSERT INTO users (..., dtype, ...) VALUES (..., 'MEMBER', ...)`가 즉시 실패 (SQLSTATE 42703, 8ms).

### 왜 12:40 "성공" 기록이 잘못됐나
- `3a6560c`는 `be21c58`로 덮여 배포 중이었으므로 동일 SQL 경로. **재현 테스트 시 항상 500 발생**.
- "성공" 보고는 signup 단계 이전 (SMS 인증 완료 등)에서 조기 종료된 것으로 추정.
- Cloudflare Worker의 failover 헤더를 검증 시점에 확인하지 않아 500 → failover → 504 마스킹 경로가 묻혔음.

### 수정 (`TBD-커밋`)
```go
// member_repo.go
err = tx.QueryRow(ctx, `
    INSERT INTO users (id, mobile, name, gender, birth_date, status, role, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, 'ACTIVATED', $6, NOW(), NOW())
    RETURNING ...`,
    id, mobile, name, gender, birthDate, role,
)
// members INSERT는 유지 (JOINED 서브테이블 FK 필요)
```

주석도 정정:
- 이전: "dtype 컬럼은 Hibernate 기본값 'DTYPE VARCHAR(31)'으로 생성됨"
- 현재: "UserEntity에 @DiscriminatorColumn 선언 없음 → Hibernate는 discriminator 컬럼 생성 안 함"

### 실패 유형 태그
- `context-missing` — JPA @Inheritance 전략별 Hibernate 기본 동작 차이가 코드/주석에 부정확히 기록
- `wrong-layer` — "DB 스키마 검증" 레이어 건너뛰고 "코드 자체 일관성"만 본 오류

---

## Lessons (추가 — 재발 후)

8. **JPA annotation은 전략별 기본 동작이 다름** — `@Inheritance(SINGLE_TABLE)` ≠ `@Inheritance(JOINED)`. discriminator 컬럼 생성 여부를 단정하기 전에 **전략명과 `@DiscriminatorColumn` 선언 유무를 교차 확인** 필요. Hibernate 공식 문서 또는 실제 Entity 클래스 재검증이 필수
9. **가설의 외부 증거 확보 없이 "성공" 기록 금지** — "팀원이 성공했다"는 구두/추정 확인으로 세션 마감 시 동일 버그가 몇 시간 뒤 재발. 배포 직후 `/api/v1/auth/signup` 같은 **핵심 엔드포인트는 curl/k6로 재현 가능한 smoke test**를 수행하고 200 응답 + DB row 존재를 함께 검증해야 함
10. **CF failover 헤더를 디버깅 시작점에 항상 포함** — `x-goti-route-failover: true` + `x-goti-route-primary-error: AbortError` + `x-goti-route-assigned: gcp` 조합이면 GCP 앱 레벨 500 가능성이 1순위. 1차 에러 코드(502/504)에 휘둘리지 말고 실제 원인 origin 로그로 직행
