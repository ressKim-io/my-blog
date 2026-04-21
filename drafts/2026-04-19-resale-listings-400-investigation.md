# POST /api/v1/resales/listings 400 Bad Request — 조사 중 (2026-04-19)

## 증상
- URL: `https://gcp-api.go-ti.shop/api/v1/resales/listings`
- Method: `POST`
- Status: `400 Bad Request`
- Response Content-Length: `111`
- Remote: `34.22.80.226:443` (GCP LB)
- CORS 헤더 정상 (`access-control-allow-origin: https://go-ti.shop`, credentials=true)
- 사용자 판단: "원래 가능해야 하는 요청"

## 최근 변경과의 관계
직전에 reshal FE↔BE 계약 감사로 다음 커밋 배포:
- Goti-go: `3369476, 8bcc803, 10a0976` (GCP prod 반영 완료, image `gcp-15-10a0976`)
- Goti-front: `1e3b9fb, c307062, f2b7f0a`

**이 커밋들은 `POST /api/v1/resales/listings` 핸들러/서비스를 건드리지 않음.** 변경 범위는:
- `GET /listings` 공개 경로 신규 (market 리스팅 조회)
- `GetListingOrderDetail` 응답 배열화
- `CompleteOrder.items.TicketID` 추가
- `complete/settled/purchases` → `/internal` 이전

→ POST 핸들러 로직에는 **직접 영향 없음**. 이슈는 이전부터 있었거나 데이터 상태 문제로 추정.

## 서버 로그 (Pod `goti-resale-prod-gcp-89cb6866-*`)
```
{"time":"2026-04-19T07:54:38.518Z","level":"WARN","msg":"request","method":"POST","path":"/api/v1/resales/listings","status":400,"latency_ms":41,"client_ip":"10.2.3.211"}
{"time":"2026-04-19T07:54:51.477Z","level":"WARN","msg":"request","method":"POST","path":"/api/v1/resales/listings","status":400,"latency_ms":14,"client_ip":"10.2.3.211"}
```

- latency 14~41ms → DB 진입 전 단계에서 거절 (validation / ticket client 호출 직후로 추정)
- **세부 사유 로그 없음** — `Goti-go/pkg/middleware/error_handler.go:33-38` 의 ErrorHandler 가 `AppError` 에 대해 로그를 찍지 않고 JSON 응답만 반환

## 가능한 400 코드 (listing_handler.go:25 + listing_service.go)

| code | trigger | 위치 |
|---|---|---|
| `BAD_REQUEST` | `ShouldBindJSON` 실패 (body 형식/필드 누락) | `listing_handler.go:31-34` |
| `LISTING_ALREADY_CLOSED` | 경기 시작 1시간 이내 | `listing_service.go:111` |
| `ALREADY_LISTED` | 이미 리셀 등록된 티켓 | `:119` |
| `INVALID_PRICE_RANGE` | 가격 정책 위반 | `domain.ValidatePriceRange` |
| `INVALID_BASE_PRICE` | 기준가 문제 | 동일 |
| `DAILY_SELL_LIMIT_EXCEEDED` | 일일 판매 한도 초과 | restriction |
| `GAME_SELL_LIMIT_EXCEEDED` | 경기별 판매 한도 | restriction |
| `RE_LISTING_LIMIT_EXCEEDED` | 취소 후 6시간 미만 재등록 | restriction |
| `RESALE_BLOCKED` | 차단 상태 (403 — 해당 아님) | |

## 확정 필요한 것 (사용자 요청 중)
1. **Chrome DevTools Network 탭 → Response 의 `code` 값**
   - 위 표 중 어느 것인지 확정
2. **Request Payload (body)**
   - `ticketId`, `listingPrice` 의 실제 값
   - ticketId 가 올바른 UUID 인지, listingPrice 가 합리적 범위인지

## 조사 우선순위

### 1순위 — response body `code` 확인
사용자 응답 받는 즉시 원인 확정.

### 2순위 — 관측성 개선 (재발 대비)
`pkg/middleware/error_handler.go` 의 ErrorHandler 에 AppError 도 로그로 남기도록 보강:
```go
if errors.As(err, &appErr) {
    logger.Warn("app error",
        "code", appErr.Code,
        "status", appErr.Status,
        "path", c.Request.URL.Path,
        "method", c.Request.Method,
    )
    c.JSON(...)
}
```
다만 status 4xx 는 client 측 실수도 많아 로그 레벨 선택 신중.

### 3순위 — 사용자 상태 조회
`code=ALREADY_LISTED` 로 확정되면 DB 에서 해당 ticketId 의 기존 리셀 이력 확인:
```sql
SELECT * FROM resale_listings
 WHERE ticket_id = '<ticketId>'
 ORDER BY created_at DESC LIMIT 5;
```

## 미해결 상태
- 이슈 원인 미확정
- 사용자 응답 대기 중

---

## 새 세션에서 이어갈 체크리스트

- [ ] 사용자로부터 response `code` + request payload 수집
- [ ] 해당 code 에 대응하는 서비스 로직 재확인
- [ ] 필요 시 ErrorHandler 에 AppError 로깅 추가 (관측성)
- [ ] 재현 시나리오 문서화

---

작성: Claude (Opus 4.7) / 조사 중 세션 종료 시점 기록.
관련: `docs/dev-logs/2026-04-19-resale-fe-be-contract-audit.md` (동일 도메인 선행 감사)
