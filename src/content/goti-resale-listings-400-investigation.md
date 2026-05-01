---
title: "POST /api/v1/resales/listings 400 Bad Request — 서버 로그로 좁힌 원인 후보 목록"
excerpt: "리셀 등록 요청이 400으로 거절되는 증상을 서버 로그와 핸들러 코드로 추적했습니다. ErrorHandler가 AppError를 로그에 남기지 않아 원인 확정이 늦어진 점, response body의 code 값을 직접 확인하는 절차, 관측성 보강 방향을 정리했습니다"
category: challenge
tags:
  - go-ti
  - Resale
  - Debug
  - HTTP
  - troubleshooting
series:
  name: goti-resale
  order: 3
date: "2026-04-19"
---

## 한 줄 요약

> `POST /api/v1/resales/listings`가 400을 반환하는 증상을 서버 로그와 핸들러 코드로 추적했습니다. latency 14~41ms로 DB에 닿기 전 단계에서 거절되는 양상이 보입니다. ErrorHandler가 AppError를 로그에 남기지 않아 response body의 `code` 값을 직접 확인해야 원인 확정이 가능한 상태입니다

---

## 🔥 문제: 리셀 등록 요청이 400으로 거절됨

### 증상

```text
URL     : https://gcp-api.go-ti.shop/api/v1/resales/listings
Method  : POST
Status  : 400 Bad Request
Content-Length: 111
Remote  : 34.22.80.226:443 (GCP LB)
```

CORS 헤더(`access-control-allow-origin: https://go-ti.shop`, `credentials=true`)는 정상이었습니다. 400이 발생하기 전에 preflight가 막힌 상황은 아니었습니다.

### 직전 배포와의 관계

증상을 발견한 직전, 리셀 FE↔BE 계약 분석 결과를 반영한 커밋들을 GCP prod에 배포한 직후였습니다.

- **Goti-go**: `3369476, 8bcc803, 10a0976` (image `gcp-15-10a0976`)
- **Goti-front**: `1e3b9fb, c307062, f2b7f0a`

이 커밋들의 변경 범위는 다음과 같습니다.

- `GET /listings` 공개 경로 신규 추가 (market 리스팅 조회)
- `GetListingOrderDetail` 응답 배열화
- `CompleteOrder.items.TicketID` 필드 추가
- `complete/settled/purchases` → `/internal` 경로 이전

**`POST /api/v1/resales/listings` 핸들러와 서비스 로직은 이번 커밋에서 변경되지 않았습니다.** 이슈가 배포 전부터 잠재해 있었거나, 특정 데이터 상태에서만 드러나는 것으로 추정됩니다

---

## 🤔 원인: ErrorHandler가 AppError를 로그에 남기지 않음

### 서버 로그

Pod `goti-resale-prod-gcp-89cb6866-*`에서 확인한 로그입니다.

```text
{"time":"2026-04-19T07:54:38.518Z","level":"WARN","msg":"request","method":"POST","path":"/api/v1/resales/listings","status":400,"latency_ms":41,"client_ip":"10.2.3.211"}
{"time":"2026-04-19T07:54:51.477Z","level":"WARN","msg":"request","method":"POST","path":"/api/v1/resales/listings","status":400,"latency_ms":14,"client_ip":"10.2.3.211"}
```

latency가 14~41ms로 매우 짧습니다. DB 쿼리가 포함됐다면 이 범위를 벗어날 가능성이 큽니다. 따라서 **DB에 닿기 전 단계 — validation 또는 ticket client 호출 직후 — 에서 거절되는 흐름**으로 판단할 수 있습니다

문제는 세부 사유 로그가 없다는 점입니다. `Goti-go/pkg/middleware/error_handler.go:33-38`의 ErrorHandler는 `AppError`에 대해 JSON 응답만 반환하고 로그를 남기지 않습니다. 서버 로그만으로는 어떤 error code가 돌아갔는지 알 수 없습니다

### 가능한 400 코드 목록

`listing_handler.go:25`와 `listing_service.go`에서 400을 발생시킬 수 있는 경로는 다음과 같습니다.

| code | trigger | 위치 |
|---|---|---|
| `BAD_REQUEST` | `ShouldBindJSON` 실패 (body 형식·필드 누락) | `listing_handler.go:31-34` |
| `LISTING_ALREADY_CLOSED` | 경기 시작 1시간 이내 | `listing_service.go:111` |
| `ALREADY_LISTED` | 이미 리셀 등록된 티켓 | `:119` |
| `INVALID_PRICE_RANGE` | 가격 정책 위반 | `domain.ValidatePriceRange` |
| `INVALID_BASE_PRICE` | 기준가 문제 | 동일 |
| `DAILY_SELL_LIMIT_EXCEEDED` | 일일 판매 한도 초과 | restriction |
| `GAME_SELL_LIMIT_EXCEEDED` | 경기별 판매 한도 | restriction |
| `RE_LISTING_LIMIT_EXCEEDED` | 취소 후 6시간 미만 재등록 | restriction |

`RESALE_BLOCKED`(차단 상태)는 403을 반환하므로 이번 사례에는 해당하지 않습니다

latency 패턴을 보면 `ALREADY_LISTED`나 `RE_LISTING_LIMIT_EXCEEDED`처럼 DB 조회를 선행하지만 빠르게 끝나는 restriction 체크, 또는 `ShouldBindJSON` 실패가 유력한 후보입니다

---

## ✅ 해결: response body `code` 확인 후 원인 확정 예정

### 1순위 — response body `code` 직접 확인

Chrome DevTools Network 탭에서 해당 요청의 Response를 열면 다음과 같은 형태의 JSON이 있습니다.

```text
{ "code": "ALREADY_LISTED", "message": "..." }
```

이 `code` 값을 위 표와 대조하면 원인을 즉시 확정할 수 있습니다. Request Payload(`ticketId`, `listingPrice`)도 함께 수집하면 입력값 문제인지도 한 번에 확인할 수 있습니다

### 2순위 — 관측성 보강 (재발 대비)

근본 문제는 `ErrorHandler`가 `AppError`를 로그에 남기지 않는다는 점입니다. 다음처럼 보강하면 서버 로그만으로 원인을 확정할 수 있습니다

```go
if errors.As(err, &appErr) {
    // 4xx는 클라이언트 실수도 많으므로 Warn 레벨로 기록
    logger.Warn("app error",
        "code",   appErr.Code,
        "status", appErr.Status,
        "path",   c.Request.URL.Path,
        "method", c.Request.Method,
    )
    c.JSON(appErr.Status, appErr)
}
```

4xx 전체를 로그에 남기면 노이즈가 늘어날 수 있어, 레벨(`Warn` vs `Info`)은 팀 운영 정책에 맞춰 선택합니다

### 3순위 — 사용자 상태 직접 조회

`code=ALREADY_LISTED`로 확정된다면, 해당 `ticketId`의 기존 리셀 이력을 DB에서 확인합니다.

```sql
SELECT *
FROM   resale_listings
WHERE  ticket_id = '<ticketId>'
ORDER  BY created_at DESC
LIMIT  5;
```

---

## 📚 배운 점

- **latency로 단계를 좁힐 수 있음**: 14~41ms라는 짧은 응답 시간은 "DB 진입 전 거절"이라는 단서였습니다. 로그가 부족해도 latency 분포는 디버깅의 첫 번째 단서가 됩니다
- **AppError 로깅 부재는 운영 부채**: 클라이언트 에러(4xx)라도 도메인 error code를 서버 로그에 남기지 않으면, 동일 증상 재현 시마다 클라이언트에게 DevTools를 열어달라고 요청해야 합니다. 관측성 보강은 기능 구현만큼 중요합니다
- **핸들러 코드 사전 목록화의 가치**: `listing_handler.go`와 `listing_service.go`의 400 코드를 미리 표로 정리해두니, 로그 없이도 가능한 원인을 빠르게 좁힐 수 있었습니다. 에러 코드 목록은 팀 위키나 코드 주석에 관리할 것을 권장합니다
- **배포와의 관계를 먼저 확인**: 증상 발견 시 직전 커밋의 변경 범위를 확인하는 것이 우선순위입니다. 이번에는 해당 핸들러가 변경되지 않았음을 확인함으로써 "데이터 상태 문제"로 탐색 방향을 좁힐 수 있었습니다
