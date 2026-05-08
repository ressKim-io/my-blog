---
title: "Resale Phase 4 Step 10 — 82건 테스트 작성과 코드 리뷰 피드백 반영"
excerpt: "Goti-go Resale 마이그레이션의 마지막 단계로 단위·통합 테스트 82건을 작성했습니다. 코드 리뷰에서 매직넘버 불일치·CI 누락 가능 패턴·경계값 오류·.gitignore 버그 4건을 찾아 수정했습니다"
category: challenge
tags:
  - go-ti
  - Resale
  - Test
  - Phase4
  - troubleshooting
series:
  name: goti-resale
  order: 2
date: "2026-04-10"
---

## 한 줄 요약

> Resale Phase 4의 마지막 Step(10)으로 단위·통합 테스트 4개 파일 82건을 완성했습니다. 코드 리뷰 Critical 1건·Major 2건·Minor 1건을 반영했고, `.gitignore` 패턴 오류로 서비스 디렉토리 전체가 git에서 무시될 뻔한 버그도 함께 잡아냈습니다

---

## 🔥 문제: 테스트 누락과 코드 리뷰에서 드러난 4가지 결함

### 배경

Goti-go Resale 마이그레이션은 Step 1~9에서 구현을 완료했고, Step 10이 마지막 테스트 작성 단계입니다. SDD(Software Design Document)에 정의된 테스트 전략에 따라 단위·통합 테스트 커버리지를 채워야 했습니다.

### 발견한 문제들

코드 리뷰 과정에서 다음 4가지 결함이 식별됐습니다.

**CR-001 (Critical)** — `entity.go`에 `MinPrice`/`MaxPrice` 매직넘버가 하드코딩되어 있었고, `price_policy.go`의 상수와 중복 정의됩니다. 두 값이 따로 관리되면 불일치가 발생할 위험이 있었습니다.

**CR-002 (Major)** — `TestMain`이 DB 연결 실패 시 조용히 skip하는 구조였습니다. CI에서 DB가 없으면 테스트가 그냥 "통과"로 보이고 실제 검증이 누락됩니다.

**CR-005 (Major)** — `ExactBoundary` 테스트가 실제 6시간 경계를 테스트하지 않았습니다. 경계 직전(JustBefore) 케이스도 빠져 있어 경계값 검증이 불완전했습니다.

**CR-007 (Minor)** — `ListingOrder` upsert 동작을 직접 검증하는 테스트가 없었습니다. 상태 변경 시 upsert가 올바르게 동작하는지 확인할 수단이 없었습니다.

### 추가 발견: .gitignore 버그

`.gitignore`에 `resale` 패턴이 등록되어 있었는데, 이 패턴이 루트 바이너리뿐 아니라 `internal/resale/` 디렉토리 전체를 무시하고 있었습니다. 다행히 기존 소스는 `git add -f`로 강제 추가되어 tracked 상태였기 때문에 실제 소스 누락은 발생하지 않았습니다. 그러나 이후 새로 추가되는 파일은 자동으로 untracked 상태가 될 위험이 있었습니다.

---

## 🤔 원인: 각 결함의 근본 원인

**매직넘버 중복(CR-001)**: 엔티티 레이어와 정책 레이어가 각자 같은 값을 선언했습니다. Go에서 패키지 간 상수를 공유하려면 명시적 import가 필요한데, 이를 생략하고 직접 숫자를 입력한 것이 원인입니다.

**Silent skip(CR-002)**: `TestMain`에서 DB 연결 오류를 `m.Run()`을 건너뛰는 방식으로 처리했습니다. `testing.M.Run()`을 호출하지 않으면 모든 테스트가 실행되지 않지만, 결과는 exit code 0으로 리포팅되어 CI가 정상으로 판단합니다.

**경계값 오류(CR-005)**: 테스트 이름만 `ExactBoundary`로 붙였을 뿐, 실제로 6시간 정각 시점과 그 직전 1초를 각각 검증하는 케이스가 빠져 있었습니다. 이름과 실제 검증 범위가 불일치하는 상태였습니다.

**upsert 미검증(CR-007)**: `ListingOrder` 조회 테스트는 있었지만 상태 변경 후 upsert 경로를 별도로 확인하는 케이스가 없었습니다.

**gitignore 패턴 오류**: Git의 패턴 매칭은 경로 구분자(`/`)가 없으면 어느 깊이의 디렉토리에도 매칭됩니다. `resale`만 작성하면 `internal/resale/`도 해당되므로, 루트 바이너리만 제외하려면 `/resale`처럼 슬래시를 앞에 붙여야 합니다.

---

## ✅ 해결: 테스트 82건 작성 + 4건 수정

### 테스트 파일 구성

SDD 테스트 전략에 따라 4개 파일, 총 82건의 테스트를 작성했습니다.

| 파일 | 유형 | 테스트 수 | 커버 범위 |
|------|------|-----------|-----------|
| `domain/price_policy_test.go` | Unit | 8 | `CalculateFee` 정확도, `ValidatePriceRange` 경계값 |
| `domain/entity_test.go` | Unit | 17 | 6개 엔티티 상태 전이, `IsPurchasable`/`IsCancelable`, mapper |
| `service/restriction_test.go` | Unit | 34 | `validate`/`handleAfter`/`resetDaily` + 복합 시나리오 |
| `repository/resale_repo_test.go` | Integration | 23 | 6개 repo CRUD, optimistic lock, JSONB |

단위 테스트(59건)는 외부 의존성 없이 순수 로직만 검증합니다. 통합 테스트(23건)는 실제 PostgreSQL 연결이 필요하며 JSONB 직렬화와 optimistic lock 충돌 시나리오까지 포함했습니다.

### CR-001: 매직넘버 → 함수 위임

`entity.go`의 가격 범위 검증을 `price_policy.go`의 함수에 위임하도록 수정했습니다.

```go
// Before: entity.go에 직접 하드코딩
if price < 1000 || price > 10_000_000 {
    return ErrInvalidPrice
}

// After: price_policy.go 함수에 위임
if err := ValidatePriceRange(price); err != nil {
    return err
}
```

이제 가격 정책이 변경되면 `price_policy.go` 한 곳만 수정하면 됩니다.

### CR-002: TestMain silent skip → 로그 출력 + os.Exit

```go
// Before: 조용히 리턴 (CI에서 통과로 보임)
func TestMain(m *testing.M) {
    db, err := setupTestDB()
    if err != nil {
        return // ← 문제: exit code 0, 테스트 미실행
    }
    // ...
}

// After: 명시적 로그 + os.Exit(1)
func TestMain(m *testing.M) {
    db, err := setupTestDB()
    if err != nil {
        log.Printf("integration test skipped: DB not available: %v", err)
        os.Exit(1) // ← CI에서 실패로 감지
    }
    // ...
}
```

DB가 없는 환경에서는 빌드가 실패하므로 테스트 누락이 명확히 드러납니다.

### CR-005: 경계값 테스트 보강

```go
// 기존: 경계 근처 임의 값만 테스트
{"ExactBoundary", 6*time.Hour - 30*time.Minute, false},

// 수정: 정확한 6시간 + JustBefore 추가
{"ExactBoundary", 6 * time.Hour, false},         // 정각 = 허용
{"JustBefore", 6*time.Hour - time.Second, true},  // 직전 1초 = 제한
```

### CR-007: ListingOrder upsert 직접 검증

상태 변경(PENDING → ACTIVE) 후 `ListingOrder`가 올바르게 upsert되는지 확인하는 테스트를 추가했습니다.

```go
func TestListingOrder_Upsert_OnStatusChange(t *testing.T) {
    // 초기 INSERT
    order := createTestListingOrder(t, db, StatusPending)

    // 상태 변경 → upsert 트리거
    err := repo.UpsertListingOrder(ctx, order.WithStatus(StatusActive))
    require.NoError(t, err)

    // DB에서 직접 조회하여 상태 확인
    got, err := repo.GetListingOrder(ctx, order.ID)
    require.NoError(t, err)
    assert.Equal(t, StatusActive, got.Status)
}
```

### .gitignore 패턴 수정

```text
# Before: internal/resale/ 전체 무시
resale

# After: 루트 바이너리만 제외
/resale
```

기존 소스 파일은 이미 tracked 상태였으므로 `git add -f` 없이도 정상 추적됩니다. 이후 새로 추가되는 파일도 자동으로 tracked됩니다.

### 커밋

```text
159fac2  fix(build): .gitignore 서비스 바이너리 패턴 루트 한정 수정
62b65de  test(resale): Step 10 단위 + 통합 테스트 작성
```

---

## 📚 배운 점

- **Go TestMain의 exit code**: `m.Run()`을 호출하지 않으면 테스트가 실행되지 않지만 CI는 성공으로 판단합니다. DB 연결 실패 시 반드시 `os.Exit(1)`로 명시적 실패 처리가 필요합니다
- **gitignore 경로 앵커**: 슬래시 없는 패턴은 하위 모든 경로에 매칭됩니다. 루트 바이너리만 제외하려면 `/패턴`으로 앵커를 걸어야 합니다
- **테스트 이름 = 검증 범위**: `ExactBoundary`라는 이름을 붙였다면 정확한 경계값을 검증해야 합니다. 이름과 검증 범위가 다르면 리뷰에서 신뢰를 잃습니다
- **상수 중앙화**: 같은 값이 두 곳 이상에 등장하면 불일치 위험이 생깁니다. 정책 레이어(price_policy)에 상수를 두고 나머지는 함수 위임으로 참조해야 합니다
- **통합 테스트 범위**: CRUD 외에 optimistic lock 충돌과 JSONB 직렬화를 통합 테스트에 포함하면 운영 중 발생할 동시성 버그를 조기에 잡을 수 있습니다
