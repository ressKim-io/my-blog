# 2026-04-14 Cutover 잔여 버그 4건 + Smoke 7/7 달성

## 배경

2026-04-13 Java→Go cutover 후 smoke 실행 결과 `checks_succeeded=33.33%` (1/3 pass). 부하테스트 시작 선행 조건으로 smoke 전 항목 통과 필요. 본 세션에서 원인 추적 및 수정 4건 진행.

## 타임라인

### Step 1: TestUser 엔드포인트 포팅 (Go 서비스 신규)

smoke 호출: `POST /api/v1/test/users` → **404**. Java baseline(`TestUserController`, `@ConditionalOnProperty("goti.test-user.enabled")`)이 Go로 포팅 안 됨.

구조적 중요성: 부하테스트는 OAuth/SMS 우회하여 mobile 식별자로 JWT 발급받아야 함. 이 endpoint 없으면 인증 필요한 모든 API 테스트 불가.

Go 구현 (4 파일 신규/수정):
- `internal/user/domain/dto.go` — DTOs 기존 선언분 사용 (부분 포팅 흔적 있었음)
- `internal/user/service/test_user_service.go` — NEW. `findOrCreateMember`에서 pgx `pgconn.PgError.Code == "23505"` (unique_violation) 재조회 패턴으로 Java의 `DataIntegrityViolationException` 재현
- `internal/user/handler/test_user_handler.go` — NEW. 3 endpoint (create/bulk/login)
- `cmd/user/main.go` — `cfg.TestUser.Enabled` flag 기반 조건부 라우팅
- `pkg/config/config.go` — `TestUserConfig` 추가

커밋 Goti-go `0e318ee`. Goti-k8s `USER_TEST_USER_ENABLED=true` env (`0f22245`).

### Step 2: deploy 경로 차이로 CI 미실행

main push 후 CI 미실행 확인. 구조 파악:
- `ci-user.yml` → `pull_request` 트리거만 (main push 대상 아님)
- `cd-prod.yml` → `deploy/prod` 브랜치 push 또는 workflow_dispatch
- 해결: `main` → `deploy/prod` fast-forward merge

**교훈**: Goti-go CI/CD는 **브랜치 분리 기반**. main push만으로는 배포 파이프라인 안 돎.

### Step 3: values.yaml 중복 env로 ArgoCD sync 실패

prod 이미지 태그 PR 머지 후 ArgoCD sync 실패:
```
failed to create typed patch object: .spec.template.spec.containers[name="goti-server"].env:
  duplicate entries for key [name="USER_TEST_USER_ENABLED"]
```

원인: 내가 values.yaml L186에 추가했는데, 실제로 다른 PR이 이미 L125에 동일 env를 넣어둔 상태였음. Helm은 env 리스트 concat에서 중복 검사 안 함 → apply 단계에서 SSA가 거부.

또 **이전 실패한 sync operation이 retry loop에 갇혀** 새 sync가 반영 안 되는 문제도 발생. `argocd-application-controller` 재시작 + `operation: null` 패치로 breakage.

수정: 중복 env 제거 (`1321dd8`).

### Step 4: games/schedules `week` 파라미터 400

사용자 제보: `GET /api/v1/games/schedules?teamId=...&week=2` → `INVALID_FORMAT / week 형식 오류`.

Java baseline: `Integer week` (해당 월 N번째 주, 1-indexed, 7일 chunk):
```java
LocalDateTime startOfWeek = startOfMonth.plusWeeks(condition.week() - 1);
```

Go 포팅: `Week *bool`. 프론트가 `week=2` 보내면 bool 파싱 실패.

수정 (3 파일):
- `dto_game.go`: `Week *bool` → `*int`
- `game_handler.go`: `optionalQueryBool` → `optionalQueryInt`
- `game_repo.go`: `now() ± 7일` 로직 삭제, `startOfMonth.AddDate(0, 0, (*req.Week-1)*7)` 패턴으로 Java 동등 구현

커밋 `2b5157e`.

### Step 5: orders/internal 500 — pgx interval 인코딩

smoke 재실행 결과 6/7 pass. 남은 실패: `GET /api/v1/orders/internal` 500:
```
unable to encode 3 into text format for text (OID 25): cannot find encode plan
```

원인 쿼리: `NOW() - ($N || ' months')::interval`. `||` 연산자는 `$N`을 text로 기대하지만 pgx가 int→text 암시적 인코딩 불가.

수정: `make_interval(months => $N)` (int 직접 받음). 2곳.

커밋 `d96914d`.

### Step 6: smoke.js 실제 프론트 흐름 정렬

사용자 피드백: "홈페이지에서는 에러없이 끝났는데 front api 랑 load-test 다른 거 아냐?"

실제 프론트 `PurchaseDetailPage` 호출 추적:
```
Browser → GET /api/v1/payments/purchases  (payment-go 서비스)
          └─→ GET /api/v1/orders/internal (ticketing-go 서비스 내부 호출)
```

smoke.js는 middle-layer(`/orders/internal`)를 직접 호출해 payment aggregation 스킵. 수정: `/payments/purchases` 호출로 변경 → 사용자 실 경로 검증.

로컬만 수정 (Goti-load-test는 팀 레포, 사용자 수행).

결과: **smoke 7/7 통과** (100% success).

## 최종 smoke 결과

```
✓ schedules            200
✓ signup (TestUser)    200
✓ signup returned token
✓ pricing policy       200
✓ team detail          200
✓ purchases            200   ← payment → ticketing 체인 E2E
✓ today games          200
```

## 교훈

1. **`/internal` 엔드포인트를 부하테스트에 직접 호출하는 건 나쁜 smoke**. 구조 리팩터링으로 언제든 사라질 수 있고, 실 사용자 경로와 다른 레이턴시/에러를 관측. 프론트가 실제 치는 공개 endpoint로 써야 cascade failure까지 잡힘.
2. **GitOps drift-safe 절차**: Helm values에서 env 추가 시 중복 검사. `yq '.env | group_by(.name) | map(select(length > 1))'` 같은 pre-commit 체크 가치 있음.
3. **pgx type 호환**: Postgres `||` 연산자가 받는 타입 기대와 Go 타입 간 gap은 `make_interval()` / `::text` 캐스팅 / string 변환 중 선택. 간결성은 `make_interval`.
4. **CI/CD 브랜치 구조 각 레포마다 다름**. `main` 머지만으로 배포되는 건 인프라 레포(Goti-k8s, Goti-monitoring), `deploy/prod`가 별도인 건 Goti-go. 반복 헷갈리면 문서화 필요.
5. **Java 포팅 시 `Integer`→`int`, `Boolean`→`bool`, `String`→`string` 1:1 매핑이 안전한 기본값**. 타입 전환(int→bool 등)은 스펙 위반 가능성 사전 확인.

## Follow-up

- [ ] **프론트 `GET /api/v1/orders` 잔존 호출 제거** — Java/Go 둘 다 미지원. `PurchaseDetailPage`에서 `fetchMyOrders` 제거 또는 `fetchPurchaseHistory`로 교체 권장 (프론트 팀 작업)
- [ ] `TestUser` endpoint가 Istio AuthorizationPolicy `allowFrom` 규칙에 포함되어 있는지 확인 (현재는 Gateway 경로로 통과하나, 내부 보호가 필요하면 policy 추가)
- [ ] smoke.js 변경 커밋 (Goti-load-test 팀 레포) — 사용자 수행
- [ ] Goti-go CI에 env duplicate key 검증 추가 검토 (values.yaml 포함 repo가 외부라 협업 필요)

## 관련 커밋

- Goti-go `0e318ee` — feat(user): port TestUser endpoints
- Goti-k8s `0f22245` — enable USER_TEST_USER_ENABLED
- Goti-go `2b5157e` — fix(ticketing): week `*bool`→`*int`
- Goti-go `d96914d` — fix(ticketing): orders/internal pgx interval
- Goti-k8s `1321dd8` — remove duplicate env
- Goti-k8s `08556da` (#241), `42e8675` (#242), `#243` — image tag bumps

## 관련 문서

- [2026-04-13 Java→Go Cutover Smoke Trouble](2026-04-13-java-to-go-cutover-smoke-trouble.md) — 원 smoke 실패 맥락
- [2026-04-14 Prometheus Agent Mode Cascade](2026-04-14-prometheus-agent-mode-and-monitoring-cascade.md) — 동일 세션 모니터링 작업
