# Phase 8 P0 — 예매 플로우 Java→Go 계약 포팅 구현

날짜: 2026-04-13 (cutover smoke 재시도 직전)
환경: AWS prod (EKS goti ns)
상태: Goti-go 구현 + push 완료. Harbor CD prod-13 이미지 빌드 대기 중.

관련:
- SDD: `docs/migration/java-to-go/phase8-seat-booking-contract-port-sdd.md`
- 선행 smoke 5건: `docs/dev-logs/2026-04-13-java-to-go-cutover-smoke-trouble.md`
- 부수 발견: `docs/dev-logs/2026-04-13-session-2-additional-findings.md`
- seed 정리: `docs/dev-logs/2026-04-13-orphan-stadium-cleanup.md`

---

## 배경

smoke 1차에서 로그인/schedules 까지는 복구했으나 예매 플로우(좌석 선택 → hold) 8개 API 계약이 Java ↔ Go 간 런타임 400 수준으로 불일치. Phase 8 SDD 의 P0 6개 항목을 구현해 smoke 1 사이클 통과를 목표로 함.

P0#5 (queue admit 게이트) 는 smoke 진행 우선 원칙에 따라 skip, P1 로 이연.
P0#6 (seed 검증) 은 고아 stadium 5건 삭제로 `future_games = games_with_inventory = 605` 달성 (별도 dev-log).

---

## 변경 요약 (6 파일, 3 커밋)

| 커밋 | 파일 | 내용 |
|---|---|---|
| `e151009` | `service/session_service.go`, `service/seat_hold_service.go` | SessionService.GetOrCreate 에 forceNew bool 인자 추가, Redis key 를 `RESERVATION_SESSION:{memberId}:{gameId}` (Java 계약) 로 통일, SeatHoldService.ReleaseAllByUserAndGame 공개 메서드 추가 |
| `e35d03a` | `domain/dto_seat.go`, `service/seat_service.go` | SeatGradeResponse 재정의 (seatGradeId / stadiumId / availableSeatCount), SeatGradeSearchResultResponse envelope 신설, SeatResponse.available 추가. SeatService 에 gameRepo/inventoryRepo/statusRepo 주입 후 GetGradesByGameID / GetSeatsBySectionForGame 신규 |
| `8eed861` | `handler/stadium_seat_handler.go`, `cmd/ticketing/main.go` | GetGradesByGame 재작성 (stadiumId query 제거, forceNewSession 처리, sessionId envelope), 좌석 조회를 `/api/v1/seats/seat-sections/{sectionId}/seats` 로 이동, 기존 stadium-seats 경로 제거. wiring 갱신 |

---

## API별 상세

### API 1 — `GET /api/v1/stadium-seats/games/{gameId}/seat-grades`

**Before (Go)**:
- `stadiumId` query 필수
- 응답: `SeatGradeResponse[]` 평탄
- seatGrade 필드 3개만 (`gradeId`, `name`, `displayColorHex`)
- forceNewSession 파라미터 무시
- queue admit / session 발급 없음

**After**:
- `stadiumId` query 제거 → `gameRepo.FindByID(gameID).StadiumID` 로 자동 조회
- JWT 에서 userID 추출 (`mustUserID`)
- `forceNewSession=true` → `SeatHoldService.ReleaseAllByUserAndGame(userID, gameID)` 선행 + `SessionService.GetOrCreate(..., forceNew=true)`
- `forceNewSession!=true` → `GetOrCreate(..., forceNew=false)` — 미만료 세션 있으면 재사용
- 응답: `SeatGradeSearchResultResponse{sessionId, sessionExpiresAt, seatGrades[]}`
- 각 seatGrade 에 `seatGradeId, stadiumId, name, displayColorHex, availableSeatCount` (availableSeatCount 는 `game_seat_inventories` 에서 enrich)

### API 3 — `GET /api/v1/seats/seat-sections/{sectionId}/seats?gameId=...`

**Before (Go)**:
- 경로: `/api/v1/stadium-seats/seat-sections/{sectionId}/seats` (프론트 기대와 다름)
- `gameId` 선택
- 응답에 `available` 없음, `status` enum 만

**After**:
- 경로: `/api/v1/seats/seat-sections/{sectionId}/seats` (Java 계약)
- `gameId` 필수
- `seat_statuses` 와 join: `available = (status == 'AVAILABLE')`
- 응답 필드: `seatId, sectionId, rowName, seatNum, available` + 하위호환용 `status` (omitempty)

### 세션 lifecycle

- Key: `session:{memberId}:{gameId}` → `RESERVATION_SESSION:{memberId}:{gameId}`
- TTL: 기존 `cfg.Ticketing.SessionTTL()` 그대로
- forceNew=true 시: `DEL key` 후 새 UUID 발급
- HoldSeat 내부의 `GetOrCreate(ctx, userID, gameID)` 호출부는 `forceNew=false` 로 호환 유지 (기존 동작 변경 없음)

### ReleaseAllByUserAndGame

기존 `HoldSeat` 내부 inline 로직(`FindActiveByUserAndGame` → `releaseHoldInternal` 루프) 을 public 메서드로 추출. 세션 교체 경로에서 재사용. 에러는 로깅만 하고 요청은 실패시키지 않음 (best-effort cleanup).

---

## 스코프 외 (의도)

- queue admit 가드(queueAccessReader): SDD 위험 3항에 따라 skip (smoke 우선, P1 로)
- Redis 잔존 세션: 어제 FLUSHALL 로 초기화된 상태라 key rename 호환성 문제 없음
- 주문/결제/취소 플로우 계약 감사: Phase 9 별건
- 필드 전수 diff 자동화: P2

---

## 검증

- `go build ./...` exit 0
- `go vet ./...` exit 0
- `go test ./internal/ticketing/...` — domain/repository/service 3 패키지 PASS
- 로컬 unit 수준 통과. 실제 E2E smoke 는 배포 후

---

## 배포

- `main` 푸시 → CD 워크플로우 (`cd-prod-aws.yml` / `cd-prod-gcp.yml`) 트리거
- `deploy/prod` 푸시 → Harbor 이미지 prod-13 빌드 예상 (6 서비스 중 ticketing-go 만 변경, 다른 서비스는 이미지 tag bump 발생하지 않을 수도)
- Goti-k8s 에 자동 image bump PR 생성 → 사용자 머지 후 ArgoCD sync

## 롤백

- Goti-go `deploy/prod` 를 `c96e1d8` (prod-12 base) 로 reset + push --force
  또는 Goti-k8s `environments/prod/goti-ticketing-go/values.yaml` 의 image tag 를 prod-12 로 되돌리는 revert PR
- Redis key naming 변경에 따른 잔존 세션 영향 없음 (smoke 초기 상태)

---

## 커밋 로그

```
8eed861 feat(ticketing): seat-grades 핸들러를 Java 계약에 맞추고 좌석 조회 경로 이동
e35d03a feat(ticketing): 좌석 등급/좌석 응답을 Java 계약으로 재구성
e151009 feat(ticketing): 예매 세션 forceNew 옵션 및 사용자별 hold 일괄 해제
```

---

## 후속 TODO (smoke 통과 후)

P1 항목 (SDD):
- hold API 에 세션 유효성 검증 통합
- datetime JSON 포맷 결정 (`yyyy-MM-dd HH:mm` vs ISO 8601) — 프론트와 정합성
- API 5 응답 body 통일 (`{holdId}` vs 204)

P2 항목 (SDD):
- Java OpenAPI → Go DTO diff CI job
- 필드명 전수 감사 (`homeTeamDisplayName` 등)
- queueAccessReader 도입
- 인증 미들웨어 전수 재검토

부하 테스트 시작 전 복원 필요 항목 (session-2-additional-findings):
- Kyverno admission-controller replicas=1 복원 (승인 필요)
- Prometheus memory 2Gi 커밋 (Helm values 이미 수정됨)
- Redis FLUSHALL 재실행
