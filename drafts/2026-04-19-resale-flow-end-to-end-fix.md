# 2026-04-19 리셀 플로우 end-to-end 버그 연쇄 수정

사용자의 리셀 등록/취소 시나리오에서 발견된 5단계 연쇄 버그를 수정한 전 과정 기록.
선행: `2026-04-19-resale-listings-400-investigation.md` (해결 미정 상태로 종료).

---

## TL;DR

| # | 증상 | 근본 원인 | 수정 | 커밋 |
|---|------|-----------|------|------|
| 1 | `POST /resales/listings` → `LISTING_ALREADY_CLOSED` | outbox `EnrichForTicket` 이 `tickets.game_date` 를 zero time(`0001-01-01`) 으로 저장. 신규 발급 티켓 **전부** 리셀 게이팅 발동 | orders + game_schedules JOIN 으로 실제 `start_at` 채움 + 기존 15행 backfill | `b1bc854` |
| 2 | `GET /listings/orders/undefined` | `GetSalesHistory` 가 JSON 태그 없는 `ResaleListingOrder` entity 직접 반환 → 필드가 PascalCase (`ID`) 로 나감 | 기존 `ToListingOrderSummary` DTO 변환 적용 | `7a08fe8` |
| 3 | `RE_LISTING_LIMIT_EXCEEDED` — 3장 중 1장 등록 후 나머지 2장 등록 불가 | `validateReListingLimit` 가 user 전역 6h block 으로 구현됨 (이름/의도/UX 모두와 불일치) | 해당 함수 제거 + restriction.last_sell_at NULL reset | `9a57d5e` |
| 4 | 만료된 listing UI 노출 + 조작된 PATCH 허용 | `resale_listings` 에 경기 시작 시각 없음 → 서버측 만료 판정 불가 | `game_date` 컬럼 추가 + backfill + 마켓 필터 + Cancel 시간 검증 + 응답에 `gameDate`/`isExpired` | `d980221` |
| 5 | `LISTING_NOT_FOUND` — UI 의 stale listing 취소 시 404 | FE `mergeResaleListings` 가 localStorage stale 을 BE 응답과 merge → BE 에 없는 listingId 가 남아 cancel 요청 | BE 응답을 단독 source of truth, localStorage 는 BE 실패 fallback 전용 | FE `1594722` |

---

## 1. tickets.game_date placeholder (Goti-go)

### 증상
`POST /api/v1/resales/listings` → 400 `{"code":"LISTING_ALREADY_CLOSED"}` — 4/22 경기 티켓인데도 발동.

### 추적
`listing_service.go:111`:
```go
if time.Until(ticketInfo.GameDate) < time.Hour {
    return apperrors.New(apperrors.ErrListingAlreadyClosed)
}
```
`ticketInfo` 는 ticketing service 의 `GET /internal/tickets/{id}` 응답. 그 응답은 `tickets.game_date` 컬럼 그대로.

`ticket_repo.go` EnrichForTicket (outbox TICKET_ISSUED 처리 시 호출):
```go
func (r *TicketRepository) EnrichForTicket(...) (*TicketEnrichment, error) {
    var en TicketEnrichment
    err := q.QueryRow(ctx, `SELECT id FROM order_items WHERE ...`).Scan(&en.OrderItemID)
    if err != nil { return nil, err }
    en.GameTitle = "Game"
    return &en, nil  // ← en.GameDate 는 time.Time{} = 0001-01-01
}
```

주석에 "game_date 는 placeholder (Redis ticket:{id} 에서 UI 조회)" 라고 명시되어 있었으나, **리셀 서비스가 이 컬럼을 실제 게이팅에 사용**하고 있음을 놓침 (선행 커밋 F6 에서 cross-schema 권한 문제 피하려 축소했던 부작용).

### 수정
`ticketing_service.orders` + `ticketing_service.game_schedules` 는 같은 스키마라 JOIN 가능:
```go
SELECT oi.id, gs.start_at
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
JOIN game_schedules gs ON gs.id = o.game_schedule_id
WHERE oi.order_id = $1 AND oi.seat_id = $2
LIMIT 1
```

### 백필
K8s Job 으로 ticketing_service.tickets 15 행 `0001-01-01` → 실제 `start_at` 복구.

### 배포 함정
detect-changes 가 `internal/ticketing/` 변경 시 `ticketing` 만 build. outbox-worker 도 ticket_repo 를 호출하지만 `internal/outbox/` 변경이 아니라 누락. workflow_dispatch 로 추가 실행 필요 → 향후 `pkg/` 외에 공용 모듈 변경 시 detect-changes 로직 재검토 필요.

---

## 2. GetSalesHistory DTO 누락 (Goti-go)

### 증상
리셀 등록 직후 마이페이지 로딩 → `GET /resales/listings/orders/undefined` 400.

### 추적
FE `fetchResaleListings` → `fetchMyResaleListingOrders` (`GET /resales/listings/orders`) → `order.orderId` 로 상세 API 호출. 그런데 `order.orderId === undefined`.

BE 핸들러:
```go
orders, total, err := h.listingSvc.GetSalesHistory(...)  // []*domain.ResaleListingOrder
response.Page(c, orders, total, totalPages)              // entity 직접 노출
```

`ResaleListingOrder` entity 에는 **JSON 태그가 없음** → Go 기본값 PascalCase 직렬화:
```json
{"ID": "...", "OrderNumber": "...", ...}
```
FE 기대 `orderId` 와 불일치.

### 수정
이미 있는 `ToListingOrderSummary` DTO 변환 적용:
```go
summaries := make([]domain.ResaleListingOrderSummaryResponse, 0, len(orders))
for _, o := range orders {
    summaries = append(summaries, domain.ToListingOrderSummary(o))
}
response.Page(c, summaries, total, totalPages)
```

### 교훈
entity → 외부 응답 직접 노출은 **계약 불일치** 유발. 모든 핸들러에서 DTO 변환을 거치는지 audit 필요.

---

## 3. validateReListingLimit user-wide 6h block (Goti-go)

### 증상
티켓 3장 소유자가 1장 리셀 등록 성공 후 나머지 2장 등록 시도 → `RE_LISTING_LIMIT_EXCEEDED` "재등록은 6시간 이후 가능".

### 분석
```go
func validateReListingLimit(r *domain.ResaleRestriction) error {
    if r.LastSellAt == nil { return nil }
    if time.Since(*r.LastSellAt).Hours() < reListingMinHours {
        return apperrors.New(apperrors.ErrReListingLimit)
    }
}
```

변수명 `LastSellAt`, 에러 이름 `ReListing`, 메시지 "재등록" — 이름은 "취소 후 같은 티켓 재등록" 을 의미하는 것처럼 보이나 **구현은 user 전역 rate limit**. FE 안내문구 "등록 후 1시간 이후 해지 시 해지 시점부터 6시간 동안 **해당 티켓의** 기능들이 제한됩니다" 와도 불일치.

기존 남용 방지는 이미 작동 중:
- `DailySellCount` ≤ 10, `GameSellCounts[gameID]` ≤ 5
- `ExistsByTicketAndActiveStatus` (같은 ticket 활성 listing 중복 차단)

`validateReListingLimit` 는 죽은 로직이면서 UX 파괴 요소.

### 수정
- `CreateListingOrder` 진입부의 `validateReListingLimit` 호출 제거
- `restriction.go` 의 함수 + 관련 단위 테스트 5개 제거
- `LastSellAt` 필드 자체는 `resetDailyIfNeeded` 에서 daily 카운트 리셋용으로 쓰이므로 유지

사용자 restriction `last_sell_at = NULL` K8s Job 으로 즉시 reset.

### 남은 과제
FE 안내문 의도 대로 **"같은 ticket 을 취소한 지 6시간 내 재등록" block** 을 구현하려면 별도 로직 필요 (ticket-scoped cancel cooldown). 현재는 구현 안 됨.

---

## 4. resale_listings.game_date 도입 + 서버측 만료 방어 (Goti-go)

### 목표
- 경기 시작 직전까지 UI 에 활성 상태로 보이던 listing 을 만료 판정
- FE 우회한 PATCH `/listings/cancel` 을 서버가 거부
- 마켓 조회에서 만료 listing 자동 제외

### 제약
`resale` 서비스 DB user 는 `ticketing_service` 스키마 DDL 불가 (SELECT 만 허용). 따라서 매 조회 시 cross-schema JOIN 대신 **`resale_listings` 에 snapshot 컬럼 추가** 방식 선택.

### 스키마 마이그레이션 (K8s Job, `goti` master SUPERUSER 로 실행)
```sql
ALTER TABLE resale_service.resale_listings
   ADD COLUMN IF NOT EXISTS game_date TIMESTAMP WITHOUT TIME ZONE;

UPDATE resale_service.resale_listings rl
   SET game_date = gs.start_at, updated_at = NOW()
  FROM ticketing_service.game_schedules gs
 WHERE gs.id = rl.game_id AND rl.game_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_resale_listings_game_date
   ON resale_service.resale_listings (game_date)
   WHERE listing_status = 'LISTING';
```
첫 Job 은 resale user 로 실행 → `must be owner of table resale_listings` 실패. `goti-pg-primary-master-cred` (master SUPERUSER) 로 재실행 성공. backfill 2행 complete.

### Domain 변경
```go
type ResaleListing struct {
    // ...
    GameDate time.Time
}

const listingMinLeadTime = time.Hour

func (l *ResaleListing) IsExpired(now time.Time) bool {
    if l.GameDate.IsZero() { return false }  // 백필 실패 row 관대 처리
    return !l.GameDate.After(now.Add(listingMinLeadTime))
}
func (l *ResaleListing) IsPurchasable(now time.Time) bool {
    return l.ListingStatus == ListingStatusListing &&
        l.AvailableStatus == AvailableEnabled &&
        !l.IsExpired(now)
}
func (l *ResaleListing) IsCancelable(now time.Time) bool {
    return l.ListingStatus == ListingStatusListing && !l.IsExpired(now)
}
```

### Repository
- 모든 SELECT 에 `COALESCE(game_date, '0001-01-01'::timestamp)` 추가
- `SaveListing` INSERT 에 컬럼/파라미터 추가
- `FindAllActiveListings` (마켓 GET) 에 `WHERE game_date IS NULL OR game_date > NOW() + INTERVAL '1 hour'`

### Service — 서버측 이중 방어
```go
// CancelListing
if listing.SellerID != sellerID {
    return nil, apperrors.New(apperrors.ErrPermissionDenied)  // 소유자 체크
}
now := time.Now()
if listing.IsExpired(now) {
    return nil, apperrors.New(apperrors.ErrListingAlreadyClosed)  // 시간 체크
}
if !listing.IsCancelable(now) {
    return nil, apperrors.New(apperrors.ErrNotMatchStatus)
}
```

### DTO 응답 확장
```go
type ResaleListingResponse struct {
    // ...
    GameDate     response.LocalDateTime `json:"gameDate"`
    IsExpired    bool                   `json:"isExpired"`
    IsCancelable bool                   `json:"isCancelable"`
    IsPurchasable bool                  `json:"isPurchasable"`
}
```

---

## 5. FE mergeResaleListings stale (Goti-front)

### 증상
BE 수정 후에도 마이페이지에 이미 존재하지 않는 listing 이 "취소 가능" 으로 노출되고, 사용자가 클릭 시 `PATCH /cancel` → 404 `LISTING_NOT_FOUND`.

### 추적
```ts
// useMypageData.ts: mergeResaleListings
for (const listing of storedListings) merged.set(listing.listingId, listing);  // stale 포함
for (const listing of apiListings)    merged.set(listing.listingId, listing);  // 덮어쓰기만
```
BE 에 없는 listingId 는 localStorage 에서 영원히 남음 → 누적된 과거 세션 listing 이 UI 에 stale 하게 표시.

### 수정
```ts
const mergeResaleListings = (apiListings, _storedListings) => {
   return apiListings.slice().sort(...);  // BE 응답 단독 source of truth
};
```
localStorage 는 `useQuery` 의 catch 블록 (BE 실패 fallback) 에서만 사용되도록 유지.

### 배포
Cloudflare Pages git integration (`deploy/prod` push 자동 빌드+배포). wrangler 수동 금지.

---

## 배포 요약

### Goti-go
| SHA | 내용 |
|-----|------|
| `b1bc854` | EnrichForTicket game_date JOIN |
| `7a08fe8` | GetSalesHistory DTO 변환 |
| `9a57d5e` | validateReListingLimit 제거 |
| `d980221` | resale_listings.game_date + 만료 검증 |

### Goti-k8s PR
| PR | 내용 |
|----|------|
| #298 | gcp-16 ticketing |
| #299 | gcp-17 outbox-worker |
| #300 | gcp-17 resale (GetSalesHistory DTO) |
| #301 | gcp-17 resale (validateReListingLimit 제거) |
| #302 | gcp-18 resale (game_date) |

### Goti-front
| SHA | 내용 |
|-----|------|
| `1594722` | mergeResaleListings stale 제거 |

### K8s Job (goti master cred 사용)
- `backfill-ticket-game-date-2026-04-19` (15 rows)
- `reset-user-restriction-2026-04-19` (1 row)
- `migrate-resale-game-date-2026-04-19` (ALTER + 2 rows backfill + index)

---

## 미완 / 후속 과제

- [ ] **ticket-scoped cancel cooldown**: FE 안내문 "등록 후 1시간 이후 해지 시 해당 티켓 6시간 제한" 실제 구현. `resale_listings.canceled_at` + ticket_id 기반 체크를 등록 경로에 추가.
- [ ] **CD detect-changes 재검토**: `internal/ticketing/repository/` 변경 시 outbox-worker 도 재빌드되도록 매핑 개선. (pkg/ 아닌 공유 모듈 변경을 놓치지 않도록)
- [ ] **entity → 응답 직접 노출 audit**: `GetSalesHistory` 패턴이 다른 핸들러에도 있는지 grep. 모든 response handler 에서 DTO 변환 강제.
- [ ] **seatId / gradeId zero UUID**: 응답에 `00000000-...` 내려옴. 원인 파악 필요.
- [ ] **CANCELED listing 노출 정책**: 마이페이지 "내 판매" 에 CANCELED 를 계속 보일지 UX 결정.
- [ ] **로그인 세션 수시 만료** (2026-04-19-session-dropout-root-cause-audit.md) — 별건, 아직 미해결.

---

## 교훈

1. **내부 응답용 필드도 외부 도메인에서 silent 하게 사용될 수 있다.** tickets.game_date 를 "placeholder" 로 두기로 한 결정이 리셀 서비스의 게이팅 로직을 깨뜨렸다. 주석에 "사용 금지" 만 적어두면 호출자가 못 읽음 — 타입이나 이름으로 보호하거나, 실제로 채워 두는 쪽이 안전.
2. **시간 게이팅은 반드시 서버측에 있어야.** FE 의 `isCancelable` 플래그만 믿으면 조작된 요청에 무력. 서버가 같은 기준으로 재검증.
3. **localStorage 는 optimistic UI 전용.** source of truth 로 merge 하면 stale 누적.
4. **ticket_scoped cooldown vs user_wide cooldown 은 전혀 다른 기능.** 이름 / 에러 코드 / 안내 문구가 모두 같아도 구현이 다르면 의미 없음.
5. **cross-schema 제약은 설계 기준선.** "이 스키마는 읽을 수 있으니까" 로 즉흥 JOIN 하는 것보다 snapshot 컬럼이 운영/DDL 권한/성능 모두 유리.

---

## 관련 문서

- `2026-04-19-resale-listings-400-investigation.md` — 최초 조사 (해결 미정 기록)
- `2026-04-19-resale-fe-be-contract-audit.md` — 선행 FE↔BE 계약 감사 (이 수정의 기반)
- `2026-04-19-game-time-utc-json-contract-fix.md` — 동일일 다른 건, 경기 시간 UTC 표시 근본 수정
- `2026-04-19-session-dropout-root-cause-audit.md` — 별건 미해결
