---
title: "Java→Go Cutover 잔존 버그 4건 해결 — Smoke 7/7 완결편"
excerpt: "Cutover 직후 33% 통과에서 출발해 TestUser 포팅, ArgoCD duplicate env, pgx interval 인코딩, smoke 경로 오정렬을 순서대로 잡아 100% 통과에 도달한 과정을 정리합니다."
category: challenge
tags:
  - go-ti
  - Go
  - Migration
  - Cutover
  - Smoke-Test
  - troubleshooting
series:
  name: "goti-java-to-go"
  order: 6
date: "2026-04-14"
---

## 한 줄 요약

> Cutover 다음 날, smoke 33% 통과 상태에서 4건의 잔존 버그를 순서대로 해결하고 7/7 전 항목 통과를 달성했습니다. 다만 이 완결편을 기록하는 시점(04-21)에도 Java→Go cutover는 미완료 상태로 프로젝트가 종료됐습니다.

---

## 배경 — 왜 이 마이그레이션을 시작했는가

go-ti 프로젝트의 목표는 동시 접속 50만, API p99 200ms 이하입니다.

문제는 JVM이었습니다. 서비스 6개가 모두 Spring Boot로 구성된 상황에서, 각 pod가 상시 점유하는 메모리가 컨테이너 리소스 예산을 잠식했습니다. Kind 5노드 환경(dev)에서는 이미 리소스 압박이 현실이었고, EKS 8노드(prod)에서도 스케일아웃 여유가 충분하지 않았습니다.

결정적 근거는 ticketing-go PoC에서 나왔습니다. 동일 부하 조건에서 **메모리 6x 절감을 실측**했습니다. 이 수치를 바탕으로 6개 서비스 전량(user/ticketing/payment/resale/stadium/queue)을 Go로 전환하는 Step 4b를 확정했습니다.

Go 스택은 Go 1.26.1, Gin v1.12, pgx v5, go-redis v9, raw SQL(ORM 미사용)로 구성했습니다.

2026-04-09 시작해 Phase 0~6 구현을 04-11에 완료했고, Phase 7 audit(04-12) 후 cutover를 진행했습니다.

---

## 이 글의 시작점 — Smoke 33%

2026-04-13 cutover 직후 smoke를 실행한 결과는 `checks_succeeded=33.33%`(1/3 pass)였습니다.

부하테스트 시작의 선행 조건은 **smoke 전 항목 통과**입니다. 4건의 버그를 순서대로 추적하고 수정했습니다.

---

## 🔥 문제 1: TestUser 엔드포인트 누락 → smoke `POST /api/v1/test/users` 404

### 발견한 문제

smoke 첫 호출에서 `POST /api/v1/test/users`가 404를 반환했습니다.

Java baseline에는 `TestUserController`가 존재합니다. `@ConditionalOnProperty("goti.test-user.enabled")` 플래그로 조건부 활성화되는 구조였는데, Go 포팅 시 이 endpoint가 통째로 누락됐습니다.

구조적으로 심각한 문제입니다. 부하테스트는 OAuth/SMS 인증을 우회하고 mobile 식별자로 JWT를 직접 발급받아야 합니다. 이 endpoint가 없으면 인증이 필요한 **모든 API 테스트가 불가능**합니다.

## 🤔 원인 1: 부분 포팅 흔적은 있었으나 service/handler 미구현

`internal/user/domain/dto.go`에 DTO 선언이 일부 남아 있었습니다. 포팅을 시작했다가 완료하지 않은 흔적이었습니다. service와 handler가 없으니 라우팅 자체가 존재하지 않았습니다.

## ✅ 해결 1: TestUser service + handler 신규 구현

4개 파일을 신규/수정했습니다.

```text
internal/user/domain/dto.go         — 기존 DTO 선언 재사용
internal/user/service/test_user_service.go  — NEW
internal/user/handler/test_user_handler.go  — NEW (3 endpoint: create/bulk/login)
cmd/user/main.go                    — cfg.TestUser.Enabled 플래그 기반 조건부 라우팅
pkg/config/config.go                — TestUserConfig 추가
```

Java의 `DataIntegrityViolationException` 재현이 핵심이었습니다. pgx에서는 `pgconn.PgError.Code == "23505"` (unique_violation)를 잡은 뒤 재조회하는 패턴으로 동등하게 구현했습니다.

```go
// test_user_service.go — unique_violation 재조회 패턴
if pgErr, ok := err.(*pgconn.PgError); ok && pgErr.Code == "23505" {
    // 이미 존재하는 레코드 재조회
    return s.repo.FindByMobile(ctx, mobile)
}
```

Goti-k8s에 `USER_TEST_USER_ENABLED=true` env를 추가했습니다.

- Goti-go 커밋 `0e318ee` — feat(user): port TestUser endpoints
- Goti-k8s 커밋 `0f22245` — enable USER_TEST_USER_ENABLED

---

## 🔥 문제 2: main push 후 CI 미실행

### 발견한 문제

`0e318ee`를 main에 push했는데 CI가 실행되지 않았습니다.

## 🤔 원인 2: CI/CD 브랜치 구조 — main push는 배포 트리거 아님

Goti-go의 CI/CD 구조를 파악하면 이유가 명확합니다.

```text
ci-user.yml  → pull_request 트리거만 (main push 대상 아님)
cd-prod.yml  → deploy/prod 브랜치 push 또는 workflow_dispatch
```

main push만으로는 배포 파이프라인이 작동하지 않는 구조입니다.

## ✅ 해결 2: main → deploy/prod fast-forward merge

```bash
$ git checkout deploy/prod
$ git merge --ff-only main
$ git push origin deploy/prod
```

Goti-go와 Goti-k8s의 배포 트리거가 다릅니다. 인프라 레포(Goti-k8s, Goti-monitoring)는 main merge로 배포되지만, **Goti-go는 `deploy/prod` 브랜치 push가 별도로 필요합니다**

---

## 🔥 문제 3: values.yaml 중복 env → ArgoCD sync 실패

### 발견한 문제

`deploy/prod` push 후 prod 이미지 태그 PR을 머지했는데 ArgoCD sync가 실패했습니다.

```text
failed to create typed patch object:
  .spec.template.spec.containers[name="goti-server"].env:
  duplicate entries for key [name="USER_TEST_USER_ENABLED"]
```

추가로, **이전에 실패한 sync operation이 retry loop에 갇혀** 새 sync가 반영되지 않는 문제도 함께 발생했습니다.

## 🤔 원인 3: 두 PR이 동일 env를 독립적으로 추가

`values.yaml` L186에 `USER_TEST_USER_ENABLED`를 추가했는데, 다른 PR이 이미 L125에 동일 env를 넣어둔 상태였습니다.

Helm은 env 리스트를 concat할 때 중복 검사를 하지 않습니다. apply 단계에서 Kubernetes SSA(Server-Side Apply)가 중복 key를 거부합니다.

## ✅ 해결 3: 중복 env 제거 + ArgoCD operation 수동 초기화

중복 env를 제거했습니다.

```bash
# Goti-k8s 커밋 1321dd8
# values.yaml L186의 USER_TEST_USER_ENABLED 제거 (L125가 선행 정의)
```

stuck된 sync operation은 두 단계로 해제했습니다.

```bash
# 1. argocd-application-controller 재시작
$ kubectl rollout restart deployment argocd-application-controller -n argocd

# 2. stuck operation 강제 초기화
$ kubectl patch application goti-server -n argocd \
    --type=json \
    -p='[{"op":"remove","path":"/status/operationState"}]'
```

---

## 🔥 문제 4: `GET /api/v1/games/schedules?week=2` → 400 INVALID_FORMAT

### 발견한 문제

`week=2`로 요청하면 `INVALID_FORMAT / week 형식 오류`가 발생했습니다.

## 🤔 원인 4: Java `Integer` → Go `*bool` 타입 오변환

Java baseline은 `Integer week`(해당 월 N번째 주, 1-indexed, 7일 chunk)입니다.

```java
// Java baseline
LocalDateTime startOfWeek = startOfMonth.plusWeeks(condition.week() - 1);
```

Go 포팅 시 `Week *bool`로 잘못 매핑됐습니다. 프론트가 `week=2`를 보내면 bool 파싱이 실패합니다.

## ✅ 해결 4: `*bool` → `*int` + 로직 재구현

3개 파일을 수정했습니다.

```go
// dto_game.go
// Before
Week *bool
// After
Week *int

// game_handler.go
// Before: optionalQueryBool
// After: optionalQueryInt

// game_repo.go — now() ± 7일 로직 삭제, Java 동등 구현
startOfWeek := startOfMonth.AddDate(0, 0, (*req.Week-1)*7)
```

커밋 `2b5157e` — fix(ticketing): week `*bool`→`*int`

---

## 🔥 문제 5: `GET /api/v1/orders/internal` 500 — pgx interval 인코딩

smoke 재실행 결과 6/7로 진전했습니다. 마지막 실패는 다음 에러였습니다.

```text
unable to encode 3 into text format for text (OID 25):
cannot find encode plan
```

## 🤔 원인 5: pgx의 int→text 암시적 인코딩 불가

문제가 된 쿼리입니다.

```sql
NOW() - ($N || ' months')::interval
```

`||` 연산자는 `$N`을 text 타입으로 기대합니다. 그러나 pgx는 Go `int`를 PostgreSQL `text`로 암시적으로 인코딩하지 않습니다.

## ✅ 해결 5: `make_interval()` 함수로 int 직접 수신

```sql
-- Before
NOW() - ($N || ' months')::interval

-- After
NOW() - make_interval(months => $N)
```

`make_interval(months => $N)`은 int를 직접 받기 때문에 암시적 타입 변환이 필요 없습니다. 동일 패턴이 있던 2곳을 모두 수정했습니다.

커밋 `d96914d` — fix(ticketing): orders/internal pgx interval

---

## 🔥 문제 6: smoke.js 경로가 실제 프론트 흐름과 불일치

6/7까지 도달한 시점에 팀원으로부터 피드백이 왔습니다.

> "홈페이지에서는 에러없이 끝났는데 front api랑 load-test 다른 거 아냐?"

## 🤔 원인 6: smoke가 내부 중간 레이어를 직접 호출

실제 프론트 `PurchaseDetailPage`의 호출 체인을 추적했습니다.

```text
Browser → GET /api/v1/payments/purchases  (payment-go 서비스)
              └─→ GET /api/v1/orders/internal  (ticketing-go 내부 호출)
```

smoke.js는 `/orders/internal`을 직접 호출하고 있었습니다. payment 집계 레이어 전체를 스킵하는 구조였습니다.

## ✅ 해결 6: `/payments/purchases` 경로로 smoke 수정

```javascript
// smoke.js — Before
const res = http.get(`${BASE_URL}/api/v1/orders/internal`);

// smoke.js — After
const res = http.get(`${BASE_URL}/api/v1/payments/purchases`);
```

이 수정으로 payment→ticketing 체인 E2E가 실제 사용자 경로 그대로 검증됩니다.

---

## ✅ 최종 smoke 결과 — 7/7 통과

```text
✓ schedules            200
✓ signup (TestUser)    200
✓ signup returned token
✓ pricing policy       200
✓ team detail          200
✓ purchases            200   ← payment → ticketing 체인 E2E
✓ today games          200
```

`checks_succeeded=100%` 달성. 부하테스트 선행 조건을 모두 충족했습니다.

---

## 📚 배운 점

**1. `/internal` 엔드포인트를 smoke에 직접 쓰면 안 됩니다**

구조 리팩터링으로 언제든 사라질 수 있는 내부 레이어입니다. 실 사용자 경로와 다른 레이턴시·에러를 관측하게 됩니다. 프론트가 실제 호출하는 **공개 endpoint를 smoke 기준점**으로 삼아야 cascade failure까지 잡힙니다

**2. Helm values env 추가 시 중복 검사가 필수입니다**

Helm은 env 리스트 concat에서 중복 key를 검사하지 않습니다. SSA apply 단계에 가서야 거부됩니다. 협업 환경에서 다음과 같은 pre-commit 체크가 효과적입니다.

```bash
# values.yaml 내 중복 env key 검출
$ yq '.env | group_by(.name) | map(select(length > 1))' values.yaml
```

**3. pgx type 호환 — Postgres 연산자의 타입 기대를 확인해야 합니다**

`||` 문자열 연결 연산자는 피연산자를 text로 기대합니다. pgx는 Go int를 PostgreSQL text로 암시적 변환하지 않습니다. `make_interval(months => $N)` 같이 **int를 직접 받는 함수**를 선택하면 캐스팅 없이 해결됩니다

**4. Goti-go의 CI/CD 브랜치 구조를 다시 명확히 했습니다**

```text
인프라 레포 (Goti-k8s, Goti-monitoring) — main push → 배포
애플리케이션 레포 (Goti-go)            — deploy/prod push → 배포
```

레포마다 배포 트리거가 다릅니다. main merge로 끝났다고 착각하기 쉬운 구조입니다

**5. Java→Go 타입 포팅 기본값은 1:1 매핑입니다**

`Integer→int`, `Boolean→bool`, `String→string`이 안전한 기본값입니다. `Integer→bool`처럼 의미를 바꾸는 변환은 스펙 위반 가능성을 사전에 확인해야 합니다

---

## 프로젝트 종료 시점의 현실

Smoke 7/7을 달성한 이 시점이 Java→Go cutover 시리즈의 완결편입니다.

그러나 프로젝트 현실도 기록해 둡니다. **2026-04-21 전체 destroy로 go-ti 프로젝트가 운영 종료됐을 때, Java→Go cutover는 미완료 상태였습니다.** Phase 7 audit(04-12)에서 발견된 잔여 게이트들, 멀티클라우드 전환, Redis SoT 롤아웃 등 병렬로 진행된 굵직한 작업들이 우선순위를 가져갔습니다.

smoke를 통과했다는 것은 **Go 서비스가 검증 가능한 수준에 도달했음**을 의미합니다. 실제 트래픽을 Go로 전환하는 cutover 자체는 팀 일정 안에서 실행되지 못했습니다.

메모리 6x 절감 PoC에서 출발해 6개 서비스 포팅, smoke 7/7까지 도달한 기술적 경로는 유효합니다. 다만 운영 환경에서 Java를 Go로 교체하는 마지막 스위치는 켜지지 않았습니다.

---

## Follow-up (미완료 항목)

- 프론트 `GET /api/v1/orders` 잔존 호출 제거 — Java/Go 둘 다 미지원. `PurchaseDetailPage`에서 `fetchMyOrders` 제거 또는 `fetchPurchaseHistory`로 교체 필요
- `TestUser` endpoint Istio AuthorizationPolicy `allowFrom` 규칙 포함 여부 확인
- smoke.js 변경 커밋 (Goti-load-test 팀 레포)
- Goti-go CI에 env duplicate key 검증 추가 검토

---

## 관련 커밋

```text
Goti-go  0e318ee — feat(user): port TestUser endpoints
Goti-k8s 0f22245 — enable USER_TEST_USER_ENABLED
Goti-go  2b5157e — fix(ticketing): week *bool→*int
Goti-go  d96914d — fix(ticketing): orders/internal pgx interval
Goti-k8s 1321dd8 — remove duplicate env
Goti-k8s 08556da, 42e8675, #243 — image tag bumps
```
