---
date: 2026-04-10
type: session
tags: [resale, phase4, testing, go, migration]
---

# Phase 4 Resale — Step 10 테스트 작성 완료

## Context

Goti-go Phase 4 Resale 마이그레이션의 마지막 단계(Step 10). SDD에 정의된 테스트 전략에 따라 단위 + 통합 테스트를 작성.

## 작업 내용

### 테스트 파일 (4개, 82건)

| 파일 | 유형 | 테스트 수 | 커버리지 |
|------|------|-----------|----------|
| `domain/price_policy_test.go` | Unit | 8 | CalculateFee 정확도, ValidatePriceRange 경계값 |
| `domain/entity_test.go` | Unit | 17 | 6개 엔티티 상태 전이, IsPurchasable/IsCancelable, mapper |
| `service/restriction_test.go` | Unit | 34 | validate/handleAfter/resetDaily + 복합 시나리오 |
| `repository/resale_repo_test.go` | Integration | 23 | 6개 repo CRUD, optimistic lock, JSONB |

### 코드 리뷰 피드백 반영

| ID | Severity | 내용 | 조치 |
|----|----------|------|------|
| CR-001 | Critical | `entity.go` MinPrice/MaxPrice 매직넘버 → `price_policy.go` 상수와 불일치 위험 | 함수 위임으로 수정 |
| CR-002 | Major | TestMain silent skip → CI에서 테스트 누락 감지 불가 | 로그 출력 + `os.Exit` |
| CR-005 | Major | ExactBoundary 테스트가 실제 경계가 아님 | 정확한 6시간 + JustBefore 추가 |
| CR-007 | Minor | ListingOrder upsert 직접 검증 부재 | 상태변경 upsert 테스트 추가 |

### 추가 발견: .gitignore 버그

`.gitignore`의 `resale` 패턴이 `internal/resale/` 디렉토리 전체를 무시하고 있었음.
`/resale`로 수정하여 루트 바이너리만 제외하도록 변경. 기존 코드는 `git add -f`로 강제 추가되어 tracked 상태였으므로 소스 누락은 없었음.

## 커밋

| 해시 | 내용 |
|------|------|
| `159fac2` | `fix(build)`: .gitignore 서비스 바이너리 패턴 루트 한정 수정 |
| `62b65de` | `test(resale)`: Step 10 단위 + 통합 테스트 작성 |

## Phase 4 완료 상태

- Step 1~9: 구현 완료 (이전 세션)
- Step 10: 테스트 완료 (본 세션)
- SDD 체크리스트: 전항목 체크
- overview.md: Phase 4 상태 → **완료**

## Related Files

- `Goti-go/internal/resale/domain/price_policy_test.go`
- `Goti-go/internal/resale/domain/entity_test.go`
- `Goti-go/internal/resale/service/restriction_test.go`
- `Goti-go/internal/resale/repository/resale_repo_test.go`
- `Goti-go/internal/resale/domain/entity.go` (MinPrice/MaxPrice 수정)
- `Goti-go/.gitignore` (패턴 수정)
