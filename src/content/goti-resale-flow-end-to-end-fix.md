---
title: "리셀 플로우 E2E 버그 5연쇄 수정 — game_date placeholder부터 FE stale merge까지"
excerpt: "리셀 등록/취소 시나리오에서 발견된 5단계 연쇄 버그의 원인과 수정 전 과정입니다. tickets.game_date placeholder, DTO 직렬화 불일치, user-wide rate limit 오설계, 서버측 만료 검증 부재, FE localStorage stale merge까지 각 버그를 추적했습니다."
category: challenge
tags:
  - go-ti
  - Resale
  - E2E
  - Contract
  - troubleshooting
series:
  name: "goti-resale"
  order: 5
date: "2026-04-19"
---

## 한 줄 요약

> 리셀 등록/취소 시나리오에서 `LISTING_ALREADY_CLOSED`, `undefined` 필드 오류, `RE_LISTING_LIMIT_EXCEEDED`, 만료 listing 노출, `LISTING_NOT_FOUND` 5개 버그가 연쇄 발생했습니다. 각 버그는 독립적인 원인을 가졌고, 커밋 4개(BE) + 커밋 1개(FE) + K8s Job 3개로 순차 수정했습니다.

## 개요

| # | 증상 | 근본 원인 | 커밋 |
|---|------|-----------|------|
| 1 | `POST /resales/listings` → `LISTING_ALREADY_CLOSED` | `EnrichForTicket`이 `tickets.game_date`를 zero time으로 저장 → 모든 티켓이 만료 판정 | `b1bc854` |
| 2 | `GET /listings/orders/undefined` | `GetSalesHistory` entity 직접 반환 → PascalCase 직렬화, FE `orderId` 불일치 | `7a08fe8` |
| 3 | `RE_LISTING_LIMIT_EXCEEDED` — 3장 중 1장만 등록 가능 | `validateReListingLimit`이 user 전역 6시간 block으로 구현됨 (이름·의도 불일치) | `9a57d5e` |
| 4 | 만료 listing UI 노출 + 조작된 PATCH 허용 | `resale_listings`에 경기 시작 시각 없어 서버측 만료 판정 불가 | `d980221` |
| 5 | `LISTING_NOT_FOUND` — stale listing 취소 시 404 | FE `mergeResaleListings`가 localStorage stale을 BE 응답과 merge | FE `1594722` |

이 글의 선행 조사는 `2026-04-19-resale-listings-400-investigation.md`(해결 미정 기록)와 `2026-04-19-resale-fe-be-contract-audit.md`(FE↔BE 계약 감사)에서 확보됐습니다.

---

## 🔥 Bug 1: `LISTING_ALREADY_CLOSED` — 유효한 티켓이 만료 판정

### 증상

4/22 경기 티켓을 대상으로 `POST /api/v1/resales/listings`를 호출하면 400 `{"code":"LISTING_ALREADY_CLOSED"}`가 반환됐습니다. 경기가 3일 이상 남았음에도 발동했습니다.

### 🤔 원인

`listing_service.go`의 게이팅 로직은 다음과 같습니다.

```go
// listing_service.go:111
if time.Until(ticketInfo.GameDate) < time.Hour {
    return apperrors.New(apperrors.ErrListingAlreadyClosed)
}
```

`ticketInfo`는 ticketing 서비스의 `GET /internal/tickets/\{id\}` 응답이며, 이 응답은 `tickets.game_date` 컬럼을 그대로 사용합니다.

문제는 outbox TICKET_ISSUED 처리 시 호출되는 `EnrichForTicket`이 `game_date`를 채우지 않았다는 점입니다.

```go
// ticket_repo.go — EnrichForTicket
func (r *TicketRepository) EnrichForTicket(...) (*TicketEnrichment, error) {
    var en TicketEnrichment
    err := q.QueryRow(ctx, `SELECT id FROM order_items WHERE ...`).Scan(&en.OrderItemID)
    if err != nil { return nil, err }
    en.GameTitle = "Game"
    return &en, nil  // en.GameDate = time.Time{} → 0001-01-01
}
```

코드 주석에 "game_date는 placeholder (Redis ticket:\{id\}에서 UI 조회)"라고 명시되어 있었습니다. 그러나 **리셀 서비스가 이 컬럼을 실제 게이팅에 사용**하고 있었습니다. 선행 커밋에서 cross-schema 권한 문제를 피하려 `EnrichForTicket`을 축소했던 것이 이 부작용을 만들었습니다.

결과적으로 `game_date = 0001-01-01`인 모든 티켓이 `time.Until(0001-01-01) < time.Hour` 조건을 충족해 리셀 게이팅이 전량 발동했습니다.

### ✅ 해결

`ticketing_service.orders`와 `ticketing_service.game_schedules`는 같은 스키마 내에 있어 JOIN이 가능합니다.

```go
// EnrichForTicket — 수정 후
SELECT oi.id, gs.start_at
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
JOIN game_schedules gs ON gs.id = o.game_schedule_id
WHERE oi.order_id = $1 AND oi.seat_id = $2
LIMIT 1
```

기존 15행(`0001-01-01`)은 K8s Job `backfill-ticket-game-date-2026-04-19`로 실제 `start_at`으로 복구했습니다.

### 배포 함정

detect-changes가 `internal/ticketing/` 변경 시 `ticketing` 서비스만 빌드합니다. outbox-worker도 `ticket_repo`를 호출하지만 `internal/outbox/` 하위 변경이 아니라 빌드 대상에서 누락됐습니다. `workflow_dispatch`로 추가 실행이 필요했으며, `pkg/` 외의 공유 모듈 변경 시 detect-changes 로직 재검토가 필요합니다.

---

## 🔥 Bug 2: `GET /listings/orders/undefined` — DTO 누락으로 PascalCase 직렬화

### 증상

리셀 등록 직후 마이페이지를 로딩하면 `GET /resales/listings/orders/undefined` 400 오류가 발생했습니다.

### 🤔 원인

FE는 `fetchMyResaleListingOrders`(`GET /resales/listings/orders`) 응답의 `order.orderId`로 상세 API를 호출합니다. 그런데 `order.orderId === undefined`였습니다.

BE 핸들러를 확인했습니다.

```go
orders, total, err := h.listingSvc.GetSalesHistory(...)  // []*domain.ResaleListingOrder
response.Page(c, orders, total, totalPages)              // entity 직접 반환
```

`ResaleListingOrder` entity에는 **JSON 태그가 없습니다**. Go 기본 직렬화는 필드명 그대로 PascalCase를 사용합니다.

```json
{"ID": "...", "OrderNumber": "...", ...}
```

FE가 기대하는 `orderId`와 일치하지 않았습니다.

### ✅ 해결

이미 정의되어 있던 `ToListingOrderSummary` DTO 변환을 적용했습니다.

```go
summaries := make([]domain.ResaleListingOrderSummaryResponse, 0, len(orders))
for _, o := range orders {
    summaries = append(summaries, domain.ToListingOrderSummary(o))
}
response.Page(c, summaries, total, totalPages)
```

entity를 외부 응답에 직접 노출하면 JSON 태그 부재·필드명 변경이 즉시 계약 불일치로 이어집니다. 모든 핸들러에서 DTO 변환을 거치는지 audit이 필요합니다.

---

## 🔥 Bug 3: `RE_LISTING_LIMIT_EXCEEDED` — 설계 의도와 다른 user-wide block

### 증상

티켓 3장을 보유한 사용자가 1장 리셀 등록 성공 후 나머지 2장을 등록하면 `RE_LISTING_LIMIT_EXCEEDED` "재등록은 6시간 이후 가능"이 반환됐습니다.

### 🤔 원인

```go
func validateReListingLimit(r *domain.ResaleRestriction) error {
    if r.LastSellAt == nil { return nil }
    if time.Since(*r.LastSellAt).Hours() < reListingMinHours {
        return apperrors.New(apperrors.ErrReListingLimit)
    }
}
```

변수명 `LastSellAt`, 에러 이름 `ReListing`, 메시지 "재등록"은 "취소 후 같은 티켓 재등록"을 제한하는 기능처럼 보입니다. 그러나 **구현은 user 전역 rate limit**이었습니다.

FE 안내문구 "등록 후 1시간 이후 해지 시 해지 시점부터 6시간 동안 **해당 티켓의** 기능들이 제한됩니다"와도 불일치합니다.

기존의 남용 방지 체계는 별도로 작동 중이었습니다.

- `DailySellCount` ≤ 10, `GameSellCounts[gameID]` ≤ 5
- `ExistsByTicketAndActiveStatus` (같은 ticket 활성 listing 중복 차단)

`validateReListingLimit`은 남용 방지 기능을 하지 못하면서 UX를 파괴하는 dead code였습니다.

### ✅ 해결

- `CreateListingOrder` 진입부의 `validateReListingLimit` 호출 제거
- `restriction.go`의 함수 + 관련 단위 테스트 5개 제거
- `LastSellAt` 필드는 `resetDailyIfNeeded`에서 daily 카운트 리셋용으로 사용 중이므로 유지

영향받은 사용자의 restriction `last_sell_at`은 K8s Job `reset-user-restriction-2026-04-19`로 즉시 NULL 초기화했습니다.

### 남은 과제

FE 안내문 의도대로 "같은 ticket을 취소한 지 6시간 내 재등록"을 차단하려면 ticket-scoped cancel cooldown 별도 구현이 필요합니다. `resale_listings.canceled_at` + `ticket_id` 기반 체크를 등록 경로에 추가하는 방식입니다. 현재는 미구현 상태입니다.

---

## 🔥 Bug 4: 만료 listing 노출 + 서버측 만료 검증 부재

### 증상

- 경기 시작 직전까지 UI에 활성 상태 listing이 표시됨
- FE를 우회한 `PATCH /listings/cancel`이 서버에서 거부되지 않음
- 마켓 조회에 만료된 listing이 포함됨

### 🤔 원인

`resale_listings` 테이블에 경기 시작 시각 컬럼이 없었습니다. 서버가 만료 여부를 직접 판단할 수 없었고, FE가 전달하는 `isCancelable` 플래그를 신뢰하는 구조였습니다.

## 🧭 선택지 비교 — 만료 판정용 경기 시각 확보 방법

매 요청마다 `ticketing_service.game_schedules`를 JOIN해서 경기 시각을 가져오거나, `resale_listings`에 snapshot 컬럼을 추가하는 두 가지 경로를 검토했습니다.

| 옵션 | 핵심 아이디어 | 장점 | 한계 |
|------|---------------|------|------|
| A. 매 요청 cross-schema JOIN | SELECT 시마다 `ticketing_service.game_schedules` JOIN | 항상 최신 경기 시각 조회 가능 | resale DB user는 ticketing_service 스키마 DDL 불가(SELECT 전용) → 권한 문제, 쿼리마다 cross-schema 비용 발생 |
| B. snapshot 컬럼 추가 | `resale_listings.game_date` 컬럼에 리셀 등록 시점 경기 시각 저장 | resale 스키마 내에서 만료 판정 자급, 쿼리 단순 | ALTER TABLE 시 master SUPERUSER 권한 필요, backfill 필요 |

### 기각 이유

**옵션 A 탈락**: resale 서비스 DB user는 `ticketing_service` 스키마에 SELECT만 허용됩니다. 즉흥적인 cross-schema JOIN을 추가하면 운영 DDL 권한 문제가 다시 발생하고, 매 LIST/CANCEL 요청마다 타 스키마 의존성이 늘어납니다. Bug 1의 원인이기도 한 "cross-schema 경계 침범"을 반복하는 방식입니다.

### 결정 기준과 최종 선택

**옵션 B를 채택했습니다.**

결정 기준 우선순위는 다음과 같습니다.

1. **운영 권한 경계 준수**: 스키마별 DB user 권한을 유지하는 것이 1순위입니다. cross-schema 의존성을 늘리면 향후 DDL 권한 오류가 반복됩니다
2. **만료 판정 자급**: resale 서비스가 외부 스키마에 의존하지 않고 자체적으로 만료를 판단할 수 있어야 합니다
3. **쿼리 성능**: 파셜 인덱스(`WHERE listing_status = 'LISTING'`)로 마켓 조회 성능을 확보할 수 있습니다

snapshot 컬럼은 "한 번 저장된 경기 시각이 변경될 일이 거의 없다"는 도메인 특성과도 맞습니다.

### ✅ 해결

#### 스키마 마이그레이션

resale user로 첫 Job을 실행하면 `must be owner of table resale_listings` 오류가 발생합니다. `goti-pg-primary-master-cred`(master SUPERUSER)로 재실행해 성공했습니다.

```sql
-- K8s Job: migrate-resale-game-date-2026-04-19
ALTER TABLE resale_service.resale_listings
   ADD COLUMN IF NOT EXISTS game_date TIMESTAMP WITHOUT TIME ZONE;

-- backfill: ticketing_service 스키마는 SUPERUSER로 접근
UPDATE resale_service.resale_listings rl
   SET game_date = gs.start_at, updated_at = NOW()
  FROM ticketing_service.game_schedules gs
 WHERE gs.id = rl.game_id AND rl.game_date IS NULL;

-- 마켓 조회 최적화용 파셜 인덱스
CREATE INDEX IF NOT EXISTS idx_resale_listings_game_date
   ON resale_service.resale_listings (game_date)
   WHERE listing_status = 'LISTING';
```

backfill 2행 완료됐습니다.

#### Domain 변경

```go
type ResaleListing struct {
    // ...
    GameDate time.Time
}

const listingMinLeadTime = time.Hour

func (l *ResaleListing) IsExpired(now time.Time) bool {
    if l.GameDate.IsZero() { return false }  // backfill 실패 row 관대 처리
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

`IsExpired`는 `GameDate`가 zero인 row에 대해 `false`를 반환합니다. backfill이 누락된 row가 있더라도 서비스가 중단되지 않도록 관대하게 처리했습니다.

#### Repository

- 모든 SELECT에 `COALESCE(game_date, '0001-01-01'::timestamp)` 추가
- `SaveListing` INSERT에 컬럼/파라미터 추가
- `FindAllActiveListings`(마켓 GET)에 `WHERE game_date IS NULL OR game_date > NOW() + INTERVAL '1 hour'` 추가

#### Service — 서버측 이중 방어

```go
// CancelListing
if listing.SellerID != sellerID {
    return nil, apperrors.New(apperrors.ErrPermissionDenied)  // 소유자 검증
}
now := time.Now()
if listing.IsExpired(now) {
    return nil, apperrors.New(apperrors.ErrListingAlreadyClosed)  // 만료 검증
}
if !listing.IsCancelable(now) {
    return nil, apperrors.New(apperrors.ErrNotMatchStatus)
}
```

FE `isCancelable` 플래그에만 의존하지 않고, 서버가 동일한 기준으로 재검증합니다.

#### DTO 응답 확장

```go
type ResaleListingResponse struct {
    // ...
    GameDate      response.LocalDateTime `json:"gameDate"`
    IsExpired     bool                   `json:"isExpired"`
    IsCancelable  bool                   `json:"isCancelable"`
    IsPurchasable bool                   `json:"isPurchasable"`
}
```

FE가 `gameDate`·`isExpired`를 직접 받아 UI를 렌더링할 수 있게 됐습니다.

---

## 🔥 Bug 5: `LISTING_NOT_FOUND` — FE localStorage stale merge

### 증상

BE 수정 이후에도 마이페이지에 이미 존재하지 않는 listing이 "취소 가능" 상태로 표시됐습니다. 사용자가 클릭하면 `PATCH /cancel` → 404 `LISTING_NOT_FOUND`가 반환됐습니다.

### 🤔 원인

```ts
// useMypageData.ts: mergeResaleListings
for (const listing of storedListings) merged.set(listing.listingId, listing); // stale 포함
for (const listing of apiListings)    merged.set(listing.listingId, listing); // 덮어쓰기만
```

BE에 없는 `listingId`는 localStorage에 영원히 남습니다. 과거 세션의 listing이 UI에 stale하게 표시됐습니다.

### ✅ 해결

BE 응답을 단독 source of truth로 변경했습니다.

```ts
const mergeResaleListings = (apiListings, _storedListings) => {
    return apiListings.slice().sort(...);  // BE 응답만 사용
};
```

localStorage는 `useQuery`의 catch 블록(BE 실패 fallback)에서만 사용되도록 유지했습니다.

배포는 Cloudflare Pages git integration(`deploy/prod` push 자동 빌드+배포)으로 진행됐습니다.

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

### K8s Job (master SUPERUSER 사용)

- `backfill-ticket-game-date-2026-04-19` (15 rows)
- `reset-user-restriction-2026-04-19` (1 row)
- `migrate-resale-game-date-2026-04-19` (ALTER + 2 rows backfill + index)

---

## 미완 / 후속 과제

- **ticket-scoped cancel cooldown**: FE 안내문 "등록 후 1시간 이후 해지 시 해당 티켓 6시간 제한"을 실제 구현해야 합니다. `resale_listings.canceled_at` + `ticket_id` 기반 체크를 등록 경로에 추가하는 방식입니다
- **CD detect-changes 재검토**: `internal/ticketing/repository/` 변경 시 outbox-worker도 재빌드되도록 매핑을 개선해야 합니다. `pkg/` 외의 공유 모듈 변경을 놓치지 않도록 로직을 보강해야 합니다
- **entity → 응답 직접 노출 audit**: `GetSalesHistory` 패턴이 다른 핸들러에도 존재하는지 확인해야 합니다. 모든 response handler에서 DTO 변환이 강제되는지 점검이 필요합니다
- **seatId / gradeId zero UUID**: 응답에 `00000000-...`이 내려오는 현상의 원인 파악이 필요합니다
- **CANCELED listing 노출 정책**: 마이페이지 "내 판매"에 CANCELED 상태를 계속 노출할지 UX 결정이 필요합니다

---

## 📚 배운 점

1. **내부 응답용 필드도 외부 도메인에서 silent하게 사용될 수 있습니다** — `tickets.game_date`를 placeholder로 두기로 한 결정이 리셀 서비스 게이팅을 깨뜨렸습니다. 주석에 "사용 금지"만 적어두면 호출자가 읽지 못합니다. 타입이나 컬럼명으로 보호하거나 실제로 값을 채워두는 쪽이 안전합니다

2. **시간 게이팅은 반드시 서버측에 있어야 합니다** — FE의 `isCancelable` 플래그만 신뢰하면 조작된 요청에 무력합니다. 서버가 동일한 기준으로 재검증해야 합니다

3. **localStorage는 optimistic UI 전용입니다** — source of truth로 merge하면 stale이 누적됩니다. BE 응답이 단독 source of truth이고, localStorage는 BE 장애 시 fallback 역할만 해야 합니다

4. **ticket-scoped cooldown과 user-wide cooldown은 전혀 다른 기능입니다** — 이름·에러 코드·안내 문구가 같아도 구현이 다르면 의미가 없습니다. 함수명과 구현이 일치하는지 정기적으로 확인해야 합니다

5. **cross-schema 제약은 설계 기준선입니다** — "이 스키마는 읽을 수 있으니까"로 즉흥 JOIN을 추가하는 것보다 snapshot 컬럼이 운영 권한·DDL 경계·쿼리 성능 모두에서 유리합니다
