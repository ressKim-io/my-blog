---
title: "Java→Go Cutover 잔존 이슈 4건 — DB 컬럼 불일치·쿠키 계약 위반"
excerpt: "Phase 8 P0 배포 직후 smoke 중 발견된 4건 추가 트러블. DB 컬럼명·DTO 필드·refresh cookie 속성이 Java 계약과 어긋나 런타임에서야 표면화됐습니다."
category: challenge
tags:
  - go-ti
  - Go
  - Migration
  - Cutover
  - troubleshooting
series:
  name: goti-java-to-go
  order: 4
date: "2026-04-13"
---

## 한 줄 요약

> Phase 8 P0 배포(prod-13) 직후 smoke 재시도 중 4건의 추가 트러블이 발생했습니다. 모두 Java→Go 포팅 시 누락된 계약(DB 컬럼명, DTO 필드, cookie 속성)이 원인이었고, 런타임 호출 전에는 모두 silent한 유형이었습니다.

---

## 배경: 왜 하루 안에 여러 차례 수정이 필요했는가

Java→Go 마이그레이션(S4 시리즈)은 JVM 콜드스타트·메모리 압박을 해소하고 50만 동시 접속 목표에 대응하기 위해 시작됐습니다.

ticketing-go PoC에서 **메모리 6x 절감**을 실측한 뒤 전량 전환을 결정했고, 2026-04-09 부터 Phase 0~6 구현, Phase 6.5 인프라 신설, Phase 7 audit을 거쳐 **Phase 8 P0 컷오버**에 진입했습니다.

문제는 Go 코드가 Java 원본과 계약을 정확히 맞추지 못한 부분이 곳곳에 숨어 있었다는 점입니다. 컴파일 시점에는 전혀 드러나지 않고, 실제 prod 트래픽이 해당 경로를 처음 호출하는 순간 500이나 401로 표면화됩니다. 그 결과 prod-14 → prod-15 → prod-16 → prod-17, 하루에 4번의 이미지 빌드와 ArgoCD sync가 반복됐습니다.

이 글은 선행 5건(같은 날 발생한 컷오버 1차 트러블)에 이어, smoke 재시도 중 발견된 **잔존 4건**의 원인과 수정을 기록합니다.

---

## 🔥 문제: prod smoke 4건 연속 실패

Phase 8 P0 배포(prod-13) 직후 진행한 smoke 재시도에서 4건이 연속으로 실패했습니다.

| # | 엔드포인트 | 증상 |
|---|-----------|------|
| 1 | `GET /seat-grades` | 500 SQLSTATE 42703 |
| 2 | `GET /seat-statuses` | 응답 정규화 실패 → hold `400 INVALID_FORMAT` |
| 3 | `GET /seat-statuses` | 500 SQLSTATE 42703 |
| 4 | `POST /auth/reissue` | 401 다발, "로그인이 너무 자주 풀린다" |

SQLSTATE 42703은 PostgreSQL의 "column does not exist" 오류입니다. 세 건이 DB 계약 불일치였고, 한 건이 cookie 속성 계약 위반이었습니다.

---

## 🤔 원인: 포팅 시 누락된 Java 계약 4종

### 1. seat_grades.display_color → display_color_hex

`seat_grades` 테이블의 실제 컬럼명은 `display_color_hex`이지만, Go repo에서 1건의 INSERT와 3건의 SELECT 모두 `display_color`로 잘못 작성됐습니다.

`GetGradesByStadium` 호출 경로는 프론트에서 직접 호출하지 않아 잠재 버그로 잠들어 있었습니다. Phase 8 P0에서 `GetGradesByGameID`가 새로 도입되면서 해당 경로가 활성화됐고 즉시 표면화됐습니다.

### 2. seat-statuses DTO 필드 누락 → 프론트 정규화 실패

프론트(`bookingApi.ts`)는 `seatStatus.seatId / seatStatus.rowName / seatStatus.seatNum`이 모두 있어야 좌석 정규화를 통과합니다.

Go의 `GameSeatHandler.GetSeatStatuses`는 `SeatID + Status`만 채우고 있었습니다. 나머지 필드가 zero value(`sectionId="00..."`, `rowName=""`, `seatNum=0`)로 직렬화되자 정규화에 실패했고, 프론트가 fallback으로 seatCode(`k5-106-4-15` 형태)를 hold API path에 그대로 전송했습니다. hold API는 seatId를 UUID로 파싱하려다 400 INVALID_FORMAT을 반환했습니다.

### 3. seats.available → is_available

스키마 파일(`step0-kbo-base.sql`, `step2a-remaining-stadiums.sql`) 모두 `is_available`을 사용하지만, Go repo 4곳(`seat_repo` INSERT/SELECT 5번, `inventory_repo` Initialize, `seat_status_repo` BulkInitialize, repo_test schema)이 전부 `available`로 잘못 작성됐습니다.

이 역시 1번 케이스와 동일 패턴입니다. Phase 8 P0에서 `GetSeatsBySectionForGame` 호출 경로가 활성화되며 처음으로 500이 발생했습니다.

### 4. refresh cookie SameSite=Strict + path=/ (Java baseline과 불일치)

prod `user-go` 로그에서 5분 사이 `POST /api/v1/auth/reissue 401`이 수십 건 발생했습니다. 사용자 보고는 "로그인이 너무 자주 풀린다"였습니다.

Java baseline(`CookieProvider.java` + `RefreshCookieProperties`)과 비교하면 두 속성이 어긋났습니다.

| 항목 | Java (baseline) | Go (수정 전) | 정렬 후 |
|------|----------------|-------------|--------|
| sameSite | `Lax` | `Strict` (하드코딩) | `Lax` |
| path | `/api/v1/auth/reissue` | `/` (하드코딩) | `/api/v1/auth/reissue` |
| name | `refreshToken` | `refreshToken` | 동일 |
| secure / httpOnly | `true / true` | `true / true` | 동일 |

`SameSite=Strict`는 동일 origin XHR에서도 popup/iframe/cross-context redirect 컨텍스트에서 쿠키가 누락될 수 있습니다. 또한 `path=/`는 모든 API 응답에 쿠키를 노출하는 부작용이 있습니다.

추가로 관찰된 패턴은 **동시 reissue race**였습니다. 여러 API 호출이 동시에 401을 받으면, axios interceptor가 각각 reissue를 시도합니다. 첫 번째 reissue가 jti를 회전시키면, 뒤이어 도착한 요청들은 stale 쿠키로 jti mismatch → 401 → 로그아웃으로 이어집니다. 프론트의 `_retry` 플래그는 단일 요청의 재시도만 막을 뿐, 동시에 날아가는 다른 요청들까지는 제어하지 못합니다.

---

## 🧭 선택지 비교 (reissue race 대응)

cookie 속성 수정 후에도 동시 reissue race가 관찰됐습니다. 후속 대응 방향으로 두 안을 검토했습니다.

**옵션 A — 프론트 single-flight(mutex)**

axios interceptor에서 reissue 호출 자체를 직렬화합니다. 첫 번째 요청이 reissue 중이면 나머지는 대기했다가 결과를 공유합니다.

장점은 서버 부하 제거와 race 완전 차단입니다. 단점은 별도 PR이 필요하고, 모든 API 클라이언트가 동일한 대기 메커니즘을 사용해야 합니다.

**옵션 B — 백엔드 jti grace period**

토큰 회전 시 이전 jti도 짧은 시간(예: 2~5초) 동안 유효하게 유지합니다. 이 window 내에 들어온 race 요청도 401 없이 통과합니다.

장점은 클라이언트 변경 없이 서버 단에서 흡수된다는 점입니다. 단점은 grace period 동안 구 토큰이 유효하게 남아 보안 여유가 좁아집니다.

**결정**: 두 안 모두 P1/P2 후속으로 유예했습니다. 이번 수정의 즉각 목표는 Java baseline과 cookie 속성을 정렬하는 것이었고, 그것만으로도 401 빈도가 현저히 줄어들었기 때문입니다. race 완전 해소는 별도 PR로 진행합니다.

---

## ✅ 해결

### 1. display_color_hex 컬럼명 수정 (커밋 `0615087`)

`seat_repo.go`의 SELECT/INSERT 5곳을 `display_color` → `display_color_hex`로 수정했습니다.

```go
// seat_repo.go — 수정 전
const insertSeatGrade = `
  INSERT INTO seat_grades (display_color, ...) VALUES ($1, ...)
`

// 수정 후
const insertSeatGrade = `
  INSERT INTO seat_grades (display_color_hex, ...) VALUES ($1, ...)
`
```

### 2. DTO 위임으로 응답 필드 완전 채움 (커밋 `e787280`)

`GameSeatHandler.GetSeatStatuses`를 `SeatService.GetSeatsBySectionForGame`으로 위임했습니다. 응답에 `available`, `status`, `sectionId`, `rowName`, `seatNum`을 모두 채웁니다. 별도 DTO 없이 `SeatResponse`를 양 핸들러가 공유합니다.

### 3. is_available 컬럼명 일괄 수정 (커밋 `7861821`)

`seat_repo`, `inventory_repo`, `seat_status_repo`, repo_test schema 4곳에서 `available` → `is_available`로 수정했습니다.

```sql
-- 수정 전
SELECT id, available FROM seats WHERE ...

-- 수정 후
SELECT id, is_available FROM seats WHERE ...
```

### 4. refresh cookie Java baseline 정렬 + 401 분기 로깅 (커밋 `c5f5d1d`)

`auth_handler.setRefreshCookie`에서 SameSite와 path를 Java baseline과 동일하게 수정했습니다.

```go
// auth_handler.go — 수정 전
http.SetCookie(c.Writer, &http.Cookie{
    Name:     "refreshToken",
    SameSite: http.SameSiteStrictMode, // Strict (하드코딩)
    Path:     "/",                      // 전체 경로
    HttpOnly: true,
    Secure:   true,
})

// 수정 후
http.SetCookie(c.Writer, &http.Cookie{
    Name:     "refreshToken",
    SameSite: http.SameSiteLaxMode,           // Lax (Java baseline)
    Path:     "/api/v1/auth/reissue",          // Java baseline
    HttpOnly: true,
    Secure:   true,
})
```

`AuthService.ReissueToken`의 401 분기를 5가지로 명시적으로 로깅했습니다.

```go
// 401 분기 로깅 — 사유 즉시 파악 가능
case parseErr != nil:
    log.Error("reissue: token parse failed", ...)
case sub == "":
    log.Error("reissue: empty sub claim", ...)
case redisErr != nil:
    log.Error("reissue: redis lookup failed", ...)
case jtiMismatch:
    log.Error("reissue: jti mismatch (token rotation race)", ...) // 핵심
case memberNotFound:
    log.Error("reissue: member not found", ...)
```

### 배포 순서

```text
prod-14: 커밋 0615087 (display_color_hex)
prod-15: 커밋 0615087 + e787280 (DTO 위임)
prod-16: 커밋 7861821 (is_available)
prod-17: 커밋 c5f5d1d (cookie baseline)

각 이미지 빌드 후 Goti-k8s auto bump PR 머지 → ArgoCD sync
```

---

## 📚 배운 점

- **컴파일러가 잡지 못하는 계약 위반**: DB 컬럼명과 DTO 필드 불일치는 `go build` / `go vet` exit 0이어도 런타임에서야 드러납니다. Java→Go 포팅에서 가장 위험한 클래스의 버그입니다

- **호출 경로 활성화가 버그 트리거**: `GetGradesByStadium`처럼 프론트가 직접 호출하지 않던 경로는 잠재 버그를 숨깁니다. Phase 8 P0처럼 새 핸들러가 해당 경로를 호출하면 비로소 표면화됩니다. 경로 활성화 자체가 smoke scope에 포함돼야 합니다

- **Java 인프라 계약은 코드 안에도 있다**: cookie SameSite·path·CORS·JWT 설정은 Java 코드에 박혀 있습니다. 동작이 기대와 다를 때 Java 원본을 직접 비교해야 합니다. `CookieProvider.java`, `RefreshCookieProperties` 같은 클래스가 대조 포인트입니다

- **환경 diff로는 못 잡는 버그가 존재**: "prod가 prod-gcp보다 뒤처진다"는 환경 gap과 달리, 1번·3번 컬럼 불일치는 양쪽 환경 모두에 동일하게 존재했습니다. 환경 비교가 아니라 스키마와 코드의 직접 비교가 필요합니다

- **자동화 후보 (P2)**: 재발 방지를 위한 CI 강화 목록입니다
  - DB schema → Go 모델 정합성 CI — sqlc/atlas로 컴파일 시점 컬럼명 검증
  - Java DTO ↔ Go DTO contract test — Java 응답 fixture를 Go test가 unmarshal 시도, 필드 누락 즉시 catch
  - Java config (cookie/CORS/JWT) ↔ Go config baseline diff CI — 인프라 계약 불일치 catch
