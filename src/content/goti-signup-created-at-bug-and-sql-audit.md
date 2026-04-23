---
title: "Signup 500 (created_at NULL) — 같은 패턴 6건 전수 스캔 + 감사 스크립트 저장"
excerpt: "팀원 회원가입 시 30초 지연 후 CF 504. Go INSERT에 created_at·updated_at 누락이 원인이었고, 같은 패턴을 Python regex로 internal/ 전수 스캔해 6개 파일을 일괄 수정한 뒤 재사용 가능한 감사 스크립트로 저장했습니다."
category: challenge
tags:
  - go-ti
  - PostgreSQL
  - SQL
  - JPA
  - Migration
  - Cloudflare
series:
  name: "goti-auth"
  order: 5
date: "2026-04-17"
---

## 한 줄 요약

> prod-gcp에서 팀원 회원가입 시 30초 지연 후 Cloudflare 504가 반환됐습니다. Go INSERT 문에 `created_at`·`updated_at` 컬럼이 누락되어 NOT NULL 위반 500이 발생했고, Worker failover가 이를 504로 마스킹하고 있었습니다. 같은 패턴을 Python regex로 전수 스캔해 **6개 추가 파일을 발견**한 뒤 일괄 수정하고 감사 스크립트로 저장했습니다. 후속으로 JPA `@Inheritance(JOINED)` 포팅 누락도 발견되어 함께 처리했습니다

---

## 🔥 문제: 회원가입 최종 버튼에서 30초 지연 → CF 504

### 환경

- prod-gcp (GKE), AWS ASG=0 상태
- 팀원 GCP 신규 회원가입 시 최종 "완료" 버튼에서 30초 지연 후 Cloudflare 504 페이지

### 로그

```text
02:04:48 POST /sms/send → 200  (SMS 실제 발송)
02:05:08 POST /signup   → 500  users.created_at NOT NULL 위반
02:06:39 POST /signup   → 401  (SMS 코드 재시도 과정)
02:07:10 POST /signup   → 401
```

1차 수정으로 `MemberRepository.Create`에 `created_at, updated_at NOW()`를 추가했습니다
그러나 팀원 재테스트에서 다시 504가 발생했습니다

```text
02:41:23 POST /signup → 500  social_providers.created_at NOT NULL 위반
02:41:33 UTC — CF 504 (Worker failover → AWS 빈 origin → timeout)
```

Signup flow는 `member create` 다음에 `social_provider create`. **같은 패턴 버그가 다음 repo로 전파되어 있었습니다.**

---

## 🤔 원인: JPA 마법의 명시적 SQL 누락 + CF failover 마스킹

### Java baseline에선 왜 발생 안 했는가

JPA `@CreationTimestamp`·`@UpdateTimestamp` 어노테이션이 Hibernate 레벨에서 자동으로 set해줍니다
Java 개발자는 DB NOT NULL + DEFAULT 없이도 정상 동작을 보게 됩니다

### Go 포팅 시 누락된 이유

Go는 명시적 SQL입니다
Java의 `@CreationTimestamp` 자동 마법이 Go 코드로 이식되지 않았습니다

특히 `member_repo.go`는 RETURNING에 `created_at`을 포함(읽어서 domain struct에 담음)하지만 INSERT 컬럼에는 빠져 있었습니다
즉, **"Scan해서 기대하지만 Insert는 안 한다"**는 기묘한 상태였습니다

### Silent 실패 (failover 유혹)

Cloudflare Worker가 GCP 500 → AWS failover를 수행했습니다
AWS가 비어 있어 30초 timeout → CF 504로 마스킹

사용자가 보기에는 "AWS 에러"처럼 보였지만 **진짜 원인은 GCP 앱 500**이었습니다
`x-goti-route-failover` 헤더로 판별 가능합니다

---

## ✅ 해결: "한 개 고치면 끝" 금지, 전수 스캔 전환

### 팀원 피드백이 방향을 전환시켰다

한 개 고친 뒤 같은 패턴이 재발하자 팀원이 다음과 같이 제안했습니다

> "같은 패턴이면 이런거 좀 넓게 다 서칭해볼 수 있어? 다 겪고 바꾸는거보다 미리 서칭해서 찾을 수 있으면 좋겠어."

이 피드백을 받아 접근을 **"한 건씩 수정"에서 "전수 스캔"**으로 전환했습니다

### Python regex로 `internal/` 전수 스캔 — 6개 추가 발견

| 도메인 | 파일 | 테이블 |
|--------|------|-------|
| user | `social_provider_repo.go` | `social_providers` |
| user | `account_repo.go` | `accounts` |
| user | `address_repo.go` | `addresses` |
| stadium | `team_repo.go` | `baseball_teams` |
| stadium | `stadium_repo.go` | `stadiums` |
| stadium | `home_stadium_repo.go` | `home_stadiums` |

6개 파일 전부에 동일한 누락 패턴이 존재했습니다
한 건씩 겪으며 수정했다면 최소 6번의 장애 재현이 필요했을 것입니다

### 일괄 수정 + 감사 스크립트 저장

- 커밋 `ba1cad1` (user 3 repo), `a47c425` (stadium 3 repo)
- CD 재트리거 `-f services=user,stadium`
- Auto-PR 머지 → rollout 완료 (이미지 `gcp-3-a47c425`)
- `Goti-go/scripts/audit-sql-timestamps.py` (150줄) — 재사용 가능한 패턴 스캐너 저장

### 감사 스크립트 감사 대상

1. **INSERT 치명**: RETURNING에 `created_at`/`updated_at`은 있는데 컬럼 리스트/VALUES에 없음 → 런타임 500
2. **UPDATE 의심**: SET절에 `updated_at`이 없음 → 정당할 수도 있어 수동 확인

```bash
# 기본 (internal/ 디렉토리)
python3 scripts/audit-sql-timestamps.py

# 특정 디렉토리
python3 scripts/audit-sql-timestamps.py internal/user

# CI 블로킹
python3 scripts/audit-sql-timestamps.py --strict
```

---

## 🔁 후속 이슈 — JPA `@Inheritance(JOINED)` 포팅 누락

`created_at` fix 배포 후에도 signup이 500 → 504를 내고 있었습니다
로그 재확인 결과 다른 패턴이 드러났습니다

```text
ERROR: insert or update on table "social_providers" violates foreign key constraint
"fk5o97euua555tpg13r9qbpqv3p" (SQLSTATE 23503)
```

### 근본 원인

Java baseline이 JPA `@Inheritance(strategy=JOINED)`을 사용하고 있었습니다

- `UserEntity @Table("users") @Inheritance(JOINED)` (부모)
- `MemberEntity @Table("members") extends UserEntity @DiscriminatorValue("MEMBER")` (자식)
- JPA가 자동으로 **양쪽 테이블에 INSERT**
- `social_providers.member_id` FK → `members.id`를 참조

**Go 포팅은 `users` INSERT만 수행**하고 `members` 테이블을 미처리했습니다
FK 위반이 발생한 이유였습니다

### JPA 전수 감사

팀원의 추가 제안("버전도 달라졌는데 pull 받아서 비교")을 받아 JPA 기능 전수 감사를 진행했습니다

| JPA 기능 | 발견 | Go 상태 |
|----------|------|---------|
| `@Inheritance(JOINED)` | 1건 (UserEntity) | 이번에 fix |
| `@DiscriminatorValue` | 1건 (MemberEntity) | 동일 fix |
| `@Version` | 1건 (ResaleRestriction) | 이미 구현됨 |
| `@EmbeddedId` | 1건 (QueueEntrySnapshot) | N/A (Redis 전용) |
| `@Embedded`·`@PrePersist`·Cascade·SoftDelete | 0건 | — |

결론은 **JPA magic 주요 항목은 JOINED 하나가 유일한 critical 누락**이었습니다

### 1차 수정 (`3a6560c`, 후속 재수정 필요)

트랜잭션으로 `users` + `members` 양쪽에 INSERT하는 구조로 변경했습니다

```go
func (r *MemberRepository) Create(...) (*domain.Member, error) {
    tx, _ := r.db.Begin(ctx)
    defer tx.Rollback(ctx)

    tx.QueryRow(ctx, `INSERT INTO users (..., dtype, ...) VALUES (..., 'MEMBER', ...) RETURNING ...`)
    tx.Exec(ctx, `INSERT INTO members (id) VALUES ($1)`, id)

    tx.Commit(ctx)
}
```

**주의**: 이 커밋은 `dtype` 컬럼 존재를 가정하는 오류를 포함했습니다. JPA `@Inheritance(JOINED)` + `@DiscriminatorColumn` 생략 시 Hibernate는 discriminator 컬럼을 생성하지 않습니다(서브테이블 JOIN으로 판별). 이 가정 오류로 다시 재발이 일어났고, 별도 글에서 다룹니다

---

## 🧹 Orphan 잔류 데이터 — signup 재시도 경로 호환

### 증상

수정 배포 후에도 팀원 signup이 실패했습니다
이전 시도로 `users` 테이블에 row가 남아 있었고, 재시도 시 `FindByMobile`이 orphan을 리턴해 `Create`가 스킵되는 경로였습니다
`socialRepo.Create`가 `members`가 없어 FK 재실패했습니다

### 수정 (idempotent 보정)

`MemberRepository.EnsureMembersRow(id)`:

```sql
INSERT INTO members (id) VALUES ($1) ON CONFLICT (id) DO NOTHING
```

`AuthService.Signup`의 기존 member 재사용 경로에서 호출합니다

```go
if member == nil {
    member, err = s.memberRepo.Create(...)   // 새로 생성
} else {
    s.memberRepo.EnsureMembersRow(ctx, member.ID)  // orphan 복구
}
```

### 프로덕션 orphan 정리

프로덕션 DB에서 미해결 orphan을 직접 삭제했습니다(대상 UUID는 로그에서 특정)

```sql
DELETE FROM user_service.users
WHERE id = '<orphan-uuid>'
RETURNING id, mobile, name;
-- DELETE 1
```

Cloud SQL은 private IP라 로컬 proxy가 불가능해, K8s Job(`postgres:15-alpine`) + VPC 내부 psql로 실행했습니다
Kyverno 정책 6가지를 전부 통과시켜야 했습니다

- `securityContext.allowPrivilegeEscalation: false`
- labels `app`, `version`
- `resources.limits` CPU/메모리
- `livenessProbe` + `readinessProbe`
- `capabilities.drop: [ALL]`
- `seccompProfile.type: RuntimeDefault`

DB 자격증명은 K8s Secret에서 env로 주입해 plaintext 노출을 피했습니다

---

## 최종 배포 이력

| 커밋 | 내용 | 이미지 |
|------|------|--------|
| `362b0e1` | `users.created_at` 명시 | `gcp-2-362b0e1` |
| `ba1cad1` | 5개 테이블 INSERT timestamps | — |
| `a47c425` | stadium 3개 repo timestamps | `gcp-3-a47c425` |
| `5d4ecce` | `audit-sql-timestamps.py` 추가 | — |
| `3a6560c` | JPA JOINED members 포팅 (dtype 가정 오류 포함) | `gcp-4-3a6560c` |
| `be21c58` | orphan 호환 `EnsureMembersRow` | `gcp-5-be21c58` |

---

## 📚 배운 점

- **한 개 고치면 끝 금지.** 버그가 같은 패턴으로 반복될 가능성을 먼저 가정하고 전수 스캔합니다. 팀원 피드백이 접근 방식을 "한 건씩 수정"에서 "전수 스캔"으로 전환시켰습니다
- **CF failover는 근본 원인 마스킹입니다.** AWS 504만 보고 판단하면 GCP 앱 500을 놓칩니다. Worker 로그 + origin pod 로그 둘 다 필수로 확인합니다
- **메모리는 point-in-time 스냅샷입니다.** 3일 전 "WIF 미설정" 메모리 때문에 수동 빌드를 시도하는 오류를 범했습니다. 항상 `git log`로 최신 상태를 verify합니다
- **재사용 가능한 감사 도구를 저장합니다.** 개별 수정 → 전수 스캔 → 스크립트 저장 3단계가 정석 루틴입니다. 다음 세션의 사람(또는 AI)이 같은 실수를 반복하지 않습니다
- **JPA 어노테이션 → Go 포팅은 명시적 SQL이 필요합니다.** `@CreationTimestamp`, `@Inheritance`, `@Version` 같은 ORM 마법은 Go로 1:1 이식되지 않습니다. Entity 클래스를 하나씩 읽어서 SQL 관점으로 변환합니다
- **targeted UUID DELETE를 우선합니다.** 1M+ row 테이블에서 `NOT IN (subquery)`는 느립니다. 대상 UUID를 확인한 뒤 `WHERE id = '...'`로 직접 삭제합니다
