# Java→Go cutover 잔여 수정 4건 (Phase 8 P0 후 발생)

날짜: 2026-04-13 (Phase 8 P0 배포 직후 ~ smoke 재시도)
환경: AWS prod (EKS goti ns)
관련:
- Phase 8 P0 구현 dev-log: `docs/dev-logs/2026-04-13-phase8-p0-seat-booking-port.md`
- 선행 5건 트러블: `docs/dev-logs/2026-04-13-java-to-go-cutover-smoke-trouble.md`

---

## 요약

Phase 8 P0 배포(prod-13) 후 smoke 진행 중 4건 추가 트러블. 모두 **Java → Go 포팅 시 누락된 계약** (DB 컬럼명, cookie 속성). 패턴은 선행 5건과 동일: 런타임 호출 전에는 silent.

| # | 증상 | 근본 원인 | 수정 |
|---|---|---|---|
| 1 | `seat-grades` 500 SQLSTATE 42703 | seat_grades.display_color → 실 컬럼 `display_color_hex` | seat_repo.go SELECT/INSERT |
| 2 | `seat-statuses` 응답 sectionId="00..." → 프론트 정규화 실패 → seatCode fallback → hold 400 INVALID_FORMAT | game_seat_handler.GetSeatStatuses 가 SeatID/Status 만 채움 | SeatService.GetSeatsBySectionForGame 으로 위임, status 도 채움 |
| 3 | `seat-statuses` 500 SQLSTATE 42703 | seats.available → 실 컬럼 `is_available` | seat_repo / inventory_repo / seat_status_repo SQL 4곳 |
| 4 | reissue 401 다발 → 로그인 자주 풀림 | refresh cookie SameSite=Strict + path=/ (Java baseline 은 Lax + /api/v1/auth/reissue) | auth_handler.setRefreshCookie + ReissueToken 분기 로깅 |

---

## 1. seat_grades.display_color → display_color_hex

기존 코드 5줄 (1 INSERT, 3 SELECT, 1 join 미사용) 모두 컬럼 잘못. `GetGradesByStadium` 경로는 프론트 호출이 없어 잠재 버그로 남아있었음. P0#1 의 `GetGradesByGameID` 도입으로 호출 활성화 → 표면화.

커밋: `0615087`

## 2. seat-statuses 응답 normalization 실패

프론트 (`bookingApi.ts`) 가 `seatStatus.seatId / seatStatus.rowName / seatStatus.seatNum` 이 모두 있어야 정규화. Go 응답이 SeatID + Status 만 채워서 sectionId zero/rowName empty/seatNum 0 으로 직렬화 → 실패 → fallback 으로 seatCode("k5-106-4-15") 가 hold API path 로 전송 → seatId UUID parse 실패 → 400 INVALID_FORMAT.

해결: `GameSeatHandler.GetSeatStatuses` 를 `SeatService.GetSeatsBySectionForGame` 호출로 위임. 응답에 `available + status + sectionId + rowName + seatNum` 모두 채움. 별도 DTO 만들지 않고 `SeatResponse` 를 양 핸들러가 공유.

커밋: `e787280`

## 3. seats.available → is_available

`step0-kbo-base.sql` / `step2a-remaining-stadiums.sql` 모두 `is_available` 사용 확인. Go repo 4곳 (seat_repo INSERT/SELECT 5번, inventory_repo Initialize, seat_status_repo BulkInitialize, repo_test schema) 모두 `available` 로 잘못 작성됨.

P0 도입으로 `GetSeatsBySectionForGame` 호출 경로가 활성화되며 500 으로 표면화. 1번 (display_color_hex) 과 동일 패턴.

커밋: `7861821`

## 4. refresh cookie SameSite=Strict + path=/

증상: prod user-go 로그에 5분 사이 `POST /api/v1/auth/reissue 401` 수십 건. 사용자가 화면에서 "로그인이 너무 자주 풀린다" 보고.

Java baseline 비교 (`Goti-server/user/src/main/java/com/goti/user/util/CookieProvider.java` + `RefreshCookieProperties`):
| 항목 | Java | Go (이전) | 정렬 후 |
|---|---|---|---|
| sameSite | Lax (`COOKIE_SAME_SITE:Lax`) | Strict (hardcoded) | Lax |
| path | `/api/v1/auth/reissue` (`REFRESH_REISSUE_PATH`) | `/` (hardcoded) | `/api/v1/auth/reissue` |
| name | refreshToken | refreshToken | refreshToken |
| secure / httpOnly | true / true | true / true | 같음 |

Strict 는 동일 origin XHR 에서도 일부 navigation 컨텍스트(특히 popup/iframe/cross-context redirect) 에서 cookie 누락 가능. 또 path=/ 는 모든 API 응답에 cookie 노출하는 부작용.

로깅 보강: `AuthService.ReissueToken` 의 401 분기를 5가지로 명시적 로깅 — parse 실패 / sub 누락 / Redis lookup 실패 / **jti mismatch (token rotation race)** / member 없음. 향후 동일 증상 디버깅 시 사유 즉시 확인 가능.

커밋: `c5f5d1d`

### 추가 의심 (관찰 후 조치)

- **동시 reissue race**: 동시에 여러 401 응답이 와서 axios interceptor 가 N개 reissue 호출 → 첫 번째가 jti 회전 → 두 번째 이후는 stale cookie 로 jti mismatch → 401 → 로그아웃
- 현재 front (`apiClient.interceptors.response`) 는 `_retry` 플래그로 단일 요청 retry 만 막음. 동시 다른 요청들은 각각 reissue 시도 가능
- 대안: front 측에서 reissue 호출을 single-flight (mutex) 로 직렬화 — 별도 PR
- 또는 backend 측에서 jti rotation 시 grace period (이전 jti 도 짧은 시간 유효) 도입

P1/P2 후속.

---

## 빌드/배포

- 4건 모두 `go build ./... + go vet ./...` exit 0
- Goti-go: prod-14 (커밋 1) → prod-15 (1+2) → prod-16 (3) → prod-17 (4) 순으로 이미지 빌드
- Goti-k8s 자동 image bump PR 머지 후 ArgoCD sync 로 반영

---

## 회고 포인트 (선행 dev-log 보강)

선행 dev-log 의 회고 1번에서 "prod 가 prod-gcp 보다 뒤처짐" 지적했는데, 본건 (3, 1번 컬럼 mismatch) 은 **양쪽 환경 모두 표면화 안 됨** — Go 코드 자체가 잘못. 즉 환경 diff 로는 못 잡는 클래스의 버그. 회고 3번 (계약 차이가 런타임에서만 드러남) 의 강한 사례.

자동화 후보 (재정리, P2):
1. **DB schema → Go 모델 정합성 CI** — go-migrate / sqlc / atlas 같은 도구로 컴파일 시점 검증
2. **Java DTO ↔ Go DTO contract test** — Java 응답 샘플 fixture 를 Go test 가 unmarshal 시도. 필드 누락 즉시 catch.
3. **Java config (cookie/CORS/JWT) ↔ Go config baseline diff CI** — 본건 4번 같은 인프라 계약 불일치 catch.
