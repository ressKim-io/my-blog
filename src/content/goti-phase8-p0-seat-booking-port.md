---
title: "Phase 8 P0 — Java 계약에 맞춰 좌석 예매 플로우를 Go로 포팅하다"
excerpt: "Phase 7이 PAUSED 상태에서도 좌석 예매 8개 API의 계약 불일치를 먼저 해소해야 했습니다. 세션 forceNew, Redis key 통일, 좌석 등급 응답 envelope 신설 등 3커밋 6파일 변경의 구현 기록입니다."
category: challenge
tags:
  - go-ti
  - Ticketing
  - Phase8
  - Go
  - Port
  - troubleshooting
series:
  name: "goti-ticketing-phase"
  order: 5
date: "2026-04-13"
---

## 한 줄 요약

> Phase 8은 cutover 후에만 진입하는 Java deprecation 단계지만, Phase 7이 PAUSED된 상황에서 좌석 예매 hotpath의 API 계약 불일치가 smoke를 막고 있었습니다. P0 6개 항목 중 구현 가능한 것부터 3커밋으로 먼저 해소했습니다.

---

## 배경

go-ti 프로젝트의 3대 목표 중 하나는 **좌석 정합성 100%**입니다. 좌석 선택 → hold → 결제로 이어지는 예매 hotpath는 티켓팅의 핵심 경로로, 계약이 1건이라도 틀리면 프론트엔드가 데이터를 파싱하지 못하고 예매 자체가 불가능해집니다.

Phase 8은 원래 **Java deprecation + 최종 cleanup** 단계입니다. 설계상 Step 4 cutover가 완료된 이후에만 진입할 수 있습니다. Java가 살아있는 동안 Go 코드를 Java 기준으로 정리하면 서비스 운영에 영향을 주기 때문입니다.

그런데 당시 상황은 달랐습니다.

- Phase 7 Readiness Audit은 Go prod 인프라 갭(Go pod 하나도 prod에 없음) 때문에 PAUSED 상태
- Phase 6.5(Go 5서비스 prod 인프라 신설) 작업이 진행 중
- cutover smoke 1차에서 로그인/schedules까지는 복구했으나, **예매 플로우 8개 API가 Java ↔ Go 간 런타임 400 수준으로 불일치**

Phase 7이 재개되더라도, smoke에서 예매 플로우가 통과하지 못하면 Readiness Audit 자체가 의미 없습니다. Phase 8 P0 항목을 먼저 구현해 smoke 1 사이클 통과를 목표로 삼았습니다.

---

## 🔥 문제: 예매 플로우 8개 API의 Java ↔ Go 계약 불일치

### 기존 Go 구현의 계약 갭

smoke 1차 결과에서 예매 플로우 진입 시점에 400 에러가 반복됐습니다. 원인을 추적하니 두 API에서 계약 불일치가 집중됐습니다.

**API 1 — `GET /api/v1/stadium-seats/games/{gameId}/seat-grades`**

기존 Go 구현:
- `stadiumId` query 파라미터 필수 (프론트는 stadiumId를 별도로 갖고 있지 않음)
- 응답이 `SeatGradeResponse[]` 평탄 배열 (sessionId 없음)
- seatGrade 필드 3개만 (`gradeId`, `name`, `displayColorHex`)
- `forceNewSession` 파라미터를 받지만 무시
- queue admit 및 세션 발급 없음

Java 계약 기대:
- `stadiumId` query 불필요 (`gameId`로 자동 조회)
- 응답: `SeatGradeSearchResultResponse{sessionId, sessionExpiresAt, seatGrades[]}`
- 각 seatGrade에 `availableSeatCount`까지 포함
- `forceNewSession=true` 시 기존 hold 해제 + 새 세션 발급

**API 3 — `GET /api/v1/seats/seat-sections/{sectionId}/seats?gameId=...`**

기존 Go 구현:
- 경로: `/api/v1/stadium-seats/seat-sections/{sectionId}/seats` (Java 경로와 다름)
- 응답에 `available` 필드 없음, `status` enum만 반환

Java 계약 기대:
- 경로: `/api/v1/seats/seat-sections/{sectionId}/seats`
- `available = (status == 'AVAILABLE')` 필드 포함

**세션 key 불일치**

Redis 세션 키 형식도 달랐습니다.

```text
Go (기존):   session:{memberId}:{gameId}
Java (계약): RESERVATION_SESSION:{memberId}:{gameId}
```

---

## ✅ 해결: 3커밋 6파일, P0 구현

### 변경 범위

| 커밋 | 파일 | 핵심 변경 |
|------|------|----------|
| `e151009` | `service/session_service.go`, `service/seat_hold_service.go` | SessionService.GetOrCreate에 `forceNew bool` 인자 추가, Redis key를 Java 계약으로 통일, ReleaseAllByUserAndGame 공개 메서드 추출 |
| `e35d03a` | `domain/dto_seat.go`, `service/seat_service.go` | SeatGradeResponse 재정의, SeatGradeSearchResultResponse envelope 신설, SeatResponse.available 추가, SeatService에 gameRepo/inventoryRepo/statusRepo 주입 |
| `8eed861` | `handler/stadium_seat_handler.go`, `cmd/ticketing/main.go` | GetGradesByGame 핸들러 재작성, 좌석 조회 경로 이동, stadium-seats 구 경로 제거, wiring 갱신 |

### API 1 재구현

`GetGradesByGame` 핸들러를 다음 흐름으로 재작성했습니다.

1. 경로 파라미터 `gameId`에서 `gameRepo.FindByID(gameID).StadiumID`를 조회합니다 → `stadiumId` query 파라미터 제거
2. JWT에서 `userID`를 추출합니다 (`mustUserID`)
3. `forceNewSession=true`이면:
   - `SeatHoldService.ReleaseAllByUserAndGame(userID, gameID)` 선행 실행 (기존 hold 일괄 해제)
   - `SessionService.GetOrCreate(..., forceNew=true)` 호출 → 기존 세션 DEL 후 새 UUID 발급
4. `forceNewSession`이 `true`가 아니면:
   - `GetOrCreate(..., forceNew=false)` 호출 → 미만료 세션 있으면 재사용
5. 응답: `SeatGradeSearchResultResponse{sessionId, sessionExpiresAt, seatGrades[]}`
   - 각 seatGrade에 `seatGradeId, stadiumId, name, displayColorHex, availableSeatCount` 포함
   - `availableSeatCount`는 `game_seat_inventories`에서 enrich

### API 3 경로 이동

좌석 조회 경로를 Java 계약에 맞게 변경했습니다.

```text
Before: /api/v1/stadium-seats/seat-sections/{sectionId}/seats
After:  /api/v1/seats/seat-sections/{sectionId}/seats
```

`seat_statuses`와 join하여 `available = (status == 'AVAILABLE')` 필드를 추가했습니다. 기존 `status` 필드는 `omitempty`로 유지해 하위호환을 보장합니다.

### 세션 lifecycle 정리

```text
# Redis key 통일
Before: session:{memberId}:{gameId}
After:  RESERVATION_SESSION:{memberId}:{gameId}
```

TTL은 기존 `cfg.Ticketing.SessionTTL()` 그대로 유지합니다. 전날 FLUSHALL로 잔존 세션이 초기화된 상태였기 때문에 key rename으로 인한 호환성 문제는 없었습니다.

HoldSeat 내부의 `GetOrCreate(ctx, userID, gameID)` 호출부는 `forceNew=false`로 고정해 기존 동작을 유지합니다.

### ReleaseAllByUserAndGame 추출

기존 `HoldSeat` 내부에 inline으로 있던 로직(`FindActiveByUserAndGame` → `releaseHoldInternal` 루프)을 public 메서드로 추출했습니다. `forceNewSession=true` 경로에서 재사용하기 위해서입니다.

에러가 발생해도 로깅만 하고 요청을 실패시키지 않습니다(best-effort cleanup). hold 해제 실패가 세션 발급 자체를 막아서는 안 됩니다.

### 스코프 외 (의도적 이연)

다음 항목은 이번 커밋에서 제외했습니다.

- **P0#5 — queue admit 가드(queueAccessReader)**: smoke 진행 우선 원칙에 따라 P1으로 이연. smoke가 통과한 뒤 도입합니다
- **P0#6 — seed 검증**: 고아 stadium 5건 삭제로 `future_games = games_with_inventory = 605` 달성 (별도 cleanup 기록)
- **주문/결제/취소 플로우 계약 감사**: Phase 9 별건

---

## 검증

```bash
$ go build ./...
# exit 0

$ go vet ./...
# exit 0

$ go test ./internal/ticketing/...
# domain/repository/service 3 패키지 PASS
```

로컬 단위 테스트는 통과했습니다. 실제 E2E smoke는 배포 후 진행합니다.

### 배포 흐름

```text
main 푸시
  → cd-prod-aws.yml / cd-prod-gcp.yml 트리거
  → deploy/prod 푸시 → Harbor 이미지 prod-13 빌드
  → goti-k8s 자동 image bump PR 생성
  → 사용자 머지 후 ArgoCD sync
```

ticketing-go만 변경했으므로 다른 5개 서비스는 이미지 tag bump가 발생하지 않을 수 있습니다.

### 롤백 방안

```bash
# 방안 1: deploy/prod를 prod-12 base로 되돌리기
$ git reset --hard c96e1d8
$ git push --force origin deploy/prod

# 방안 2: Goti-k8s에서 image tag revert PR
# environments/prod/goti-ticketing-go/values.yaml
# image.tag: prod-12 로 변경
```

Redis key rename에 따른 잔존 세션 영향은 없습니다 (smoke 초기 상태, 전날 FLUSHALL 완료).

---

## 후속 P1/P2 항목

smoke 통과 후 처리할 항목입니다.

**P1 — 다음 smoke 전 필요:**
- hold API에 세션 유효성 검증 통합
- datetime JSON 포맷 결정 (`yyyy-MM-dd HH:mm` vs ISO 8601) — 프론트와 정합성
- API 5 응답 body 통일 (`{holdId}` vs 204)

**P2 — 부하 테스트 전 필요:**
- Java OpenAPI → Go DTO diff CI job
- 필드명 전수 감사 (`homeTeamDisplayName` 등)
- queueAccessReader 도입
- 인증 미들웨어 전수 재검토

---

## 📚 배운 점

- **Phase 순서는 목표가 있을 때 유연하게 조정합니다.** Phase 8은 cutover 후 진입이 원칙이지만, smoke를 막고 있는 계약 불일치가 Phase 7 재개 자체를 방해하는 상황이었습니다. P0 항목을 먼저 해소하는 것이 전체 일정을 앞당기는 선택이었습니다
- **좌석 정합성 100% 목표는 API 계약에서 시작합니다.** hold → 결제로 이어지는 hotpath에서 sessionId가 없거나, availableSeatCount가 없거나, 경로가 다르면 프론트가 다음 단계로 진입하지 못합니다. 계약의 모든 필드가 일치해야만 정합성 목표가 유효합니다
- **scope를 명확히 잘라야 작업이 끝납니다.** P0#5(queue admit)를 이번에 함께 구현하려 했다면 smoke가 더 늦어졌을 것입니다. "smoke 우선" 원칙에 따라 P1으로 이연한 것이 맞는 판단이었습니다
- **best-effort cleanup은 실패를 격리합니다.** ReleaseAllByUserAndGame에서 에러가 나도 요청을 실패시키지 않는 설계는, hold 해제 실패가 세션 발급 경로를 막지 않도록 격리합니다. cleanup 실패가 핵심 플로우에 전파되지 않아야 합니다
- **forceNew 분기는 상태를 명시적으로 통제합니다.** `forceNew=true`와 `forceNew=false`를 인자로 분리하면, 호출 위치마다 의도가 코드에 드러납니다. 기존 HoldSeat 경로는 `forceNew=false`로 고정해 동작 변경 없이 재사용했습니다
