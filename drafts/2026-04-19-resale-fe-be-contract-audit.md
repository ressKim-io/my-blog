# 리셀(Resale) FE↔BE API 계약 감사 — 2026-04-19

## 목적

Goti-front (React) ↔ Goti-go resale/payment 서비스 간 API 계약을 엔드포인트/요청 본문/응답 본문/enum/타임 포맷 단위로 전수 대조해 **잠재 버그 지점**을 식별한다. 분석 전용. 코드 수정 없음.

## 조사 대상 파일

### 프론트엔드
- `Goti-front/src/entities/resale/api/resaleApi.ts` (496줄)
- `Goti-front/src/pages/tickets/api/paymentApi.ts` (609줄, 리셀 결제 플로우)
- `Goti-front/src/entities/payment/api/paymentApi.ts` (180줄)
- `Goti-front/src/shared/config/runtime.ts` (`isResaleBookingMockEnabled`, `isResaleDemoEnabled`)
- `Goti-front/src/shared/lib/demo/resaleDemo*` (mock 경로)

### 백엔드 (Go)
- `Goti-go/cmd/resale/main.go` (라우트 등록)
- `Goti-go/internal/resale/handler/{listing_handler.go, transaction_handler.go}`
- `Goti-go/internal/resale/domain/{dto.go, entity.go}`
- `Goti-go/internal/payment/handler/resale_handler.go`
- `Goti-go/internal/payment/domain/dto.go` (ResalePaymentRequest 등)

---

## 1. 라우트 매핑 표

| # | 프론트 호출 | 메서드 | 경로 | 백엔드 핸들러 | 인증 | 상태 |
|---|---|---|---|---|---|---|
| 1 | `resaleApi.ts:144 createResaleListings` | POST | `/api/v1/resales/listings` | `listing_handler.go:25 CreateListings` | JWT | ✅ |
| 2 | `resaleApi.ts:208 cancelResaleListing` | PATCH | `/api/v1/resales/listings/cancel` | `listing_handler.go:44 CancelListing` | JWT | ✅ |
| 3 | *(없음)* | PATCH | `/api/v1/resales/listings/orders/:orderId/cancel` | `listing_handler.go:63 CancelListingOrder` | JWT | ⚠️ BE-only |
| 4 | `resaleApi.ts:478 fetchMyResaleListingOrders` | GET | `/api/v1/resales/listings/orders` | `listing_handler.go:80 GetSalesHistory` | JWT | ✅ |
| 5 | `resaleApi.ts:490 fetchResaleListingOrderDetails` | GET | `/api/v1/resales/listings/orders/:orderId` | `listing_handler.go:101 GetListingOrderDetail` | JWT | ⚠️ **P0 응답 구조 불일치** |
| 6 | `resaleApi.ts:203 fetchResaleListingDetail` | GET | `/api/v1/resales/listings/:listingId` | `listing_handler.go:119 GetListing` | JWT | ✅ |
| 7 | `resaleApi.ts:322 fetchMarketResaleListings` | GET | `/api/v1/resales/listings` | **❌ 미구현** | 공개 기대 | 🔴 **P0 라우트 없음** |
| 8 | `resaleApi.ts:335 fetchMyResaleListingSummary` | GET | `/api/v1/resales/listings/count` | `listing_handler.go:133 GetListingsCount` | 공개 | ✅ |
| 9 | `resaleApi.ts:381 fetchResaleHistoryGraph` | GET | `/api/v1/resales/histories/games/:gameId/grade/:gradeId/ranges/:range/graph` | `listing_handler.go:147 GetPriceHistory` | 공개 | ✅ |
| 10 | `resaleApi.ts:232 fetchResaleListingCountByGame` | GET | `/api/v1/resales/games/:gameId/count` | `listing_handler.go:166 GetGameResaleCount` | 공개 | ✅ |
| 11 | `resaleApi.ts:271 fetchResaleListingCountByGameAndGrade` | GET | `/api/v1/resales/games/:gameId/grade/:gradeId/count` | `listing_handler.go:180 GetGameGradeResaleCount` | 공개 | ✅ |
| 12 | `resaleApi.ts:343 fetchResaleGameStatusByGame` | GET | `/api/v1/resales/games/:gameId/status` | `listing_handler.go:198 GetGameResaleStatus` | 공개 | ✅ |
| 13 | `paymentApi.ts:256 createResaleHold` | POST | `/api/v1/resales/holds` | `transaction_handler.go:24 HoldResale` | JWT | ✅ |
| 14 | `paymentApi.ts:266 releaseResaleHold` | PATCH | `/api/v1/resales/holds/:holdId/release` | `transaction_handler.go:43 ReleaseHold` | JWT | ⚠️ **P1 keepalive 인증 누락** |
| 15 | `paymentApi.ts:301 createResaleOrder` | POST | `/api/v1/resales/orders` | `transaction_handler.go:61 CreateOrder` | JWT | ✅ |
| 16 | `paymentApi.ts:384 completeResaleOrder` | PATCH | `/api/v1/resales/orders/:orderId/complete?paymentId=` | `transaction_handler.go:80 CompleteOrder` (path: `:resaleOrderId`) | **공개** | ⚠️ **P1 인증/외부노출** |
| 17 | *(없음 — 내부용)* | PATCH | `/api/v1/resales/orders/:resaleOrderId/settled` | `transaction_handler.go:98 SettleOrder` | 공개 | ⚠️ BE-only |
| 18 | `paymentApi.ts:328 getResaleTransactions` | GET | `/api/v1/resales/orders/:orderId/transactions` | `transaction_handler.go:111 GetTransactions` (path: `:resaleOrderId`) | **공개** | ✅ |
| 19 | *(없음 — buyerId 쿼리 기반)* | GET | `/api/v1/resales/orders/purchases?buyerId=&months=` | `transaction_handler.go:125 GetPurchases` | 공개 | ⚠️ BE-only |
| 20 | `paymentApi.ts:358 createResalePayment` | POST | `/api/v1/payments/resales` | `payment/handler/resale_handler.go:22 CreateResalePayment` | (payment 서비스) | ✅ |
| 21 | `resaleApi.ts:419 fetchResaleLedgers` | GET | `/api/v1/payments/resales/ledgers` | `payment/handler/resale_handler.go:67 GetLedgers` | (payment 서비스) | ✅ |
| 22 | `resaleApi.ts:431 fetchResaleLedgerByOrderId` | GET | `/api/v1/payments/resales/ledgers/orders/:orderId` | `payment/handler/resale_handler.go:78 GetLedgerByOrderID` | (payment 서비스) | ✅ |

> path param 이름 차이 (`:orderId` vs `:resaleOrderId`) 는 Gin 라우팅은 위치 기반이라 동작에는 영향 없음. 다만 유지보수/문서화 혼선 유발 → P2.

---

## 2. Request / Response 필드 단위 대조

### 2-1. POST `/api/v1/resales/listings` (리셀 등록)

**Request** — 일치 ✅
| 프론트 필드 | JS 타입 | 백엔드 필드 | Go 타입 | 비고 |
|---|---|---|---|---|
| `listings[].ticketId` | string | `Listings[].TicketID` | `uuid.UUID` | UUID 문자열 bind, validate |
| `listings[].listingPrice` | number | `Listings[].ListingPrice` | `int` | `binding:"min=0"` |

**Response** — ⚠️ 부분 불일치
- 백엔드: `ResaleListingOrderCreateResponse{ orders: [...], listings: [...] }`
- 프론트 수신 코드 `createResaleListings()` 는 `'listings' in payload` 분기로 **두 가지 shape 모두 수용**. 표준 응답(orders+listings) 과 단일 listing 객체 둘 다 대응하는 방어 로직이 있음.
- 의도/이유 불명. 과거 버전 응답 shape 대응 잔재로 보임. **P2**: 불필요 복잡도.

### 2-2. PATCH `/api/v1/resales/listings/cancel`

**Request** ✅
| 프론트 | 백엔드 |
|---|---|
| `{ listingId: string }` | `ResaleListingCancelRequest{ ListingID uuid.UUID }` |

**Response** — 프론트는 `void` 로 무시. 백엔드는 `result` 반환 (어떤 값인지 서비스 메서드 확인 필요). 호환 문제 없음.

### 2-3. GET `/api/v1/resales/listings/orders/:orderId` 🔴 **P0 응답 구조 불일치**

**프론트 기대** (`resaleApi.ts:490`):
```ts
const response = await apiClient.get<ApiEnvelope<ResaleListingItem[]>>(...);
return response.data.data;  // → ResaleListingItem[] (배열)
```

**백엔드 실제** (`listing_handler.go:115`):
```go
response.Success(c, gin.H{"order": order, "listings": listings})
// → { "order": {...}, "listings": [...] } (객체)
```

**영향**: `fetchResaleListingOrderDetails()` 호출 시 `.flat()` (resaleApi.ts:318) 이 객체에 적용되면 `Object.prototype.flat is not a function` 또는 빈 배열.
- `fetchResaleListings()` 가 내부적으로 `fetchResaleListingOrderDetails` 를 호출 → **내 리셀 판매 내역 조회 전체 파손**.
- Mock 플래그 on 상태라 현재 가려져 있음.

### 2-4. GET `/api/v1/resales/listings/:listingId`

**Response** ⚠️ 필드 집합 차이
| 프론트 `ResaleListingDetail` | 백엔드 `ResaleListingResponse` | 비고 |
|---|---|---|
| listingId | listingId | ✅ |
| orderId? | orderId | 백엔드는 항상 반환 |
| ticketId | ticketId | ✅ |
| **ticketNumber?** | **없음** | 🟠 **P1** 프론트가 기대하는 필드 백엔드 미제공 |
| seatInfo | seatInfo | ✅ |
| listingPrice | listingPrice | ✅ |
| listingStatus | listingStatus | ⚠️ enum 불일치 (§5 참조) |
| listedAt | listedAt (`LocalDateTimeSeoul`) | 포맷 주의 (§6) |
| canceledAt? | canceledAt? | ✅ |
| **gameTitle** | **없음** | 🟠 **P1** 필수 필드 미제공 |
| **gameDate** | **없음** | 🟠 **P1** |
| **stadiumName** | **없음** | 🟠 **P1** |
| isCancelable | isCancelable | ✅ |
| — | dailyBasePrice | BE-only, 프론트 미사용 |
| — | sellerId/gameId/seatId/gradeId | BE-only |
| — | availableStatus, lastTransactionPrice, minPrice, maxPrice, isPurchasable | BE-only |

**영향**: 상세 화면에 `gameTitle`, `gameDate`, `stadiumName` 렌더 시 **undefined**. 구매자 리셀 상세 페이지 정보 공백.

### 2-5. POST `/api/v1/resales/holds`

**Request** ✅ 일치
```ts
{ listingId: string, queueTokenJti: string }
```
```go
{ ListingID uuid.UUID `json:"listingId"`, QueueTokenJti string `json:"queueTokenJti"` }
```

**Response** ✅
```ts
{ holdId: string }  // ResaleHoldResponse
```
```go
{ HoldID uuid.UUID `json:"holdId"` }
```

### 2-6. PATCH `/api/v1/resales/holds/:holdId/release` ⚠️ **P1**

**프론트** (`paymentApi.ts:283`):
```ts
fetch(url, {
   method: 'PATCH',
   headers: { 'Content-Type': 'application/json' },
   credentials: 'omit',    // ← 쿠키 없음
   keepalive: true,
});
// Authorization 헤더 없음
```

**백엔드**:
```go
resales.PATCH("/holds/:holdId/release", jwtMiddleware, transactionH.ReleaseHold)
// JWT 미들웨어 적용
```

**분석**: `apiClient.patch` 경로(resaleApi.ts:83, paymentApi.ts:266) 는 axios interceptor 를 통해 Authorization 헤더 자동 첨부. **keepalive fetch 경로만 401 예상**. 단, keepalive 는 언마운트/탭 닫힘 순간에만 호출되는 **cleanup 경로**라 실제 서버에서 이미 hold TTL 로 자동 해제되면 UX 영향 없음. 그러나 서버 로그엔 401 이 쌓임.

### 2-7. POST `/api/v1/resales/orders`

**Request** ✅ 필드명/json tag 일치
| FE key | BE struct tag | validate |
|---|---|---|
| holdIds | holdIds `[]uuid.UUID` | required,min=1 |
| buyerNickname | buyerNickname | required |
| buyerEmail | buyerEmail | required |
| buyerPhone | buyerPhone | required |

**버그 주의**: 백엔드 `BuyerEmail binding:"required"` 이지만 email 형식 검증 없음. 프론트가 공백 제출 가능. P2.

**Response** ✅
| FE | BE |
|---|---|
| orderId | orderId (UUID→string) |
| orderNumber | orderNumber |
| orderStatus | orderStatus (`ResaleOrderStatus` enum) |
| totalQuantity | totalQuantity |
| totalAmount | totalAmount |

### 2-8. PATCH `/api/v1/resales/orders/:orderId/complete?paymentId=` ⚠️ **P1 인증**

**경로**: 프론트는 `:orderId`, 백엔드는 `:resaleOrderId`. Gin 위치 기반 라우팅이라 동작은 OK. 문서/유지보수만 혼동.

**인증**: 백엔드 라우트 등록부(cmd/resale/main.go:166)에 `jwtMiddleware` 없음. **공개 엔드포인트**. 주석은 "Transaction — internal (no auth)" 라고 되어 있으나 path 자체는 `/api/v1/resales/...` 로 외부 노출됨. 누구나 `orderId` + `paymentId` 만 알면 완료 처리 가능.
- **P1 보안**: 내부 호출이라면 path prefix `/internal/` 이나 `mTLS`/service token 으로 보호 필요.
- 프론트가 `apiClient.patch` 로 공개 호출 → 악의적 사용자가 타인 주문 complete 트리거 가능성.

**Request body**: 없음. `paymentId` 는 query param.

**Response** ✅
| FE `CompleteResaleOrderResponse` | BE `ResaleOrderCompleteResponse` |
|---|---|
| orderId | orderId |
| orderNumber | orderNumber |
| buyerId | buyerId |
| totalAmount | totalAmount |
| orderStatus | orderStatus |
| items[].transactionId | items[].transactionId |
| items[].listingId | items[].listingId |
| items[].ticketId? | **없음** (BE 는 ticketId 미제공) 🟠 |
| items[].seatInfo | items[].seatInfo |
| items[].price | items[].price |

**영향**: 프론트 `completeResult.items[0]?.ticketId` (paymentApi.ts:591) → 항상 undefined. 결제 완료 후 티켓 상세 이동/표시에 사용된다면 UI 깨짐. **P1**.

### 2-9. GET `/api/v1/resales/orders/:orderId/transactions` ✅

**Response** — 프론트가 두 가지 shape 모두 수용(배열 or `{transactionIds:[]}`). 백엔드는 `ResaleOrderListResponse{ TransactionIDs []uuid.UUID }` 반환. 정상.

### 2-10. POST `/api/v1/payments/resales` ✅

**Request 필드 대조**
| FE `ResalePaymentRequest` | BE `ResalePaymentRequest` | 타입 | validate |
|---|---|---|---|
| orderId | OrderID | UUID | required |
| buyerId | BuyerID | UUID | required |
| totalAmount | TotalAmount | int | required,gt=0 |
| totalBuyerFee | TotalBuyerFee | int | min=0 |
| totalSellerFee | TotalSellerFee | int | min=0 |
| items[].transactionId | Items[].TransactionID | UUID | required |
| items[].sellerId | Items[].SellerID | UUID | required |
| items[].settlementAmount | Items[].SettlementAmount | **int64** | required,gt=0 |
| paymentMethod | PaymentMethod (enum) | string | required |
| idempotencyKey | IdempotencyKey | string | required |

**주의**: `settlementAmount` 이 BE 에서 `int64`. JS 는 `number` (double). 2^53 이상은 정밀도 손실. 티켓 정산 금액이 그 범위 넘을 일 없으니 실무상 OK.

**Response**: `OrderPaymentResponse` (프론트). 백엔드 `PaymentResponse` 와 대체로 일치. `paidAt` 은 BE 가 `LocalDateTimeSeoul` wrapper → JSON 시리얼라이즈 포맷 확인 필요(§6).

### 2-11. GET `/api/v1/payments/resales/ledgers` — 페이지네이션 포맷

**프론트 `ResaleLedgerPageResponse`**: content, totalElements, totalPages, number, size, empty (Spring Data 스타일)
**백엔드 `response.Page()`** (pkg/response): 구조 확인 필요 — 기존 `fetchMyResaleListingOrders` 는 `{list, totalCount, totalPages}` 기대하는 반면, `fetchResaleLedgers` 는 Spring 스타일을 기대 → **프론트 내에서도 페이지 응답 컨벤션 불일치**. **P1**: 둘 중 하나는 실제 응답과 안 맞을 확률 높음. (백엔드 `response.Page` 의 실제 출력 키 확인 필요)

**프론트 `ResaleListingOrderPageResponse` (fetchMyResaleListingOrders)**:
```ts
{ list: [...], totalCount: number, totalPages: number }
```

→ 백엔드가 Spring 스타일(`content/totalElements`) 반환하면 `list` 가 undefined 되어 `.length` 접근 시 crash.

---

## 3. 누락 엔드포인트 🔴 **P0**

### 3-1. `GET /api/v1/resales/listings` (마켓 전체 리스팅)

프론트 `fetchMarketResaleListings()` (`resaleApi.ts:322`) 가 호출. 사용처:
- `useResaleListingMarket.ts:18` — 마이페이지 리셀 마켓 탭
- `useResellZoneInsights.ts` — `/resell-books` 좌석 선택 인사이트

**백엔드**: `cmd/resale/main.go:144-170` 의 `/api/v1/resales` 그룹 내 해당 경로 없음. listing_handler 에 `GetMarketListings` 핸들러도 부재.

**현재 상황**:
```ts
const shouldUseResaleBookingMock = isResaleDemoEnabled || isResaleBookingMockEnabled;
// runtime.ts 에서 isResaleBookingMockEnabled = true 하드코딩 상태라
// 실제 API 경로 차단, mock 데이터 반환
```

Mock 플래그 꺼지는 순간 **리셀 마켓 전체 화면이 404 로 깨짐**.

### 3-2. `GET /api/v1/resales/orders/purchases` (내 리셀 구매 내역)

백엔드 `transaction_handler.go:125 GetPurchases` 존재하지만 프론트 호출 부재. 
- `fetchMyResalePurchases` 같은 함수 없음
- 마이페이지 "내 리셀 구매 내역" 탭이 있다면 기능 공백

### 3-3. `PATCH /api/v1/resales/listings/orders/:orderId/cancel` (주문 단위 판매 취소)

백엔드 구현 있음(`listing_handler.go:63`). 프론트는 `cancelResaleListing(listingId)` (단일 리스팅) 만 사용. 주문 그룹 통째 취소 UX 부재.

---

## 4. 응답 envelope 컨벤션

- 공통: `ApiEnvelope<T> = { data: T, ... }` (프론트) ↔ `response.Success(c, payload)` (백엔드 pkg/response)
- `response.Success`, `response.Created`, `response.SuccessEmpty`, `response.Page` 간 envelope 구조는 백엔드 공통 유틸에 위임됨. 프론트 `unwrapApiData` 는 `.data.data` 패턴 사용 → 모든 엔드포인트에서 동일하게 깊이 추론. OK 가정.

---

## 5. Enum 대조

### 5-1. `ResaleListingStatus` 🟠 **P1**
| 프론트 | 백엔드 |
|---|---|
| LISTING | ListingStatusListing ✅ |
| HOLD | ListingStatusHold ✅ |
| SOLD | ListingStatusSold ✅ |
| SETTLED | ListingStatusSettled ✅ |
| **CANCEL_REQUESTED** | **없음** 🟠 |
| CANCELED | ListingStatusCanceled ✅ |

- 프론트가 `'CANCEL_REQUESTED'` 를 상태값으로 수신/표시할 수 있다고 가정 → BE 가 절대 반환하지 않음. 분기 코드 dead path.

### 5-2. `ResaleListingOrderStatus` ✅ 일치
`LISTING / PARTIAL / SOLD / SETTLED / CANCELED`

### 5-3. `ResaleGameStatus` ✅ 일치
`SCHEDULED / AVAILABLE / UNAVAILABLE`

### 5-4. `ResaleOrderStatus` 🟠 **P2**
| 프론트 (paymentApi.ts) | 백엔드 |
|---|---|
| string (typing 없음) | `PENDING / COMPLETED` |

프론트 타입이 `string` 으로 느슨 → 런타임 방어 필요 없음. 하지만 타입 안전성 저하.

### 5-5. `ResaleListingOrderSearchStatus`
| 프론트 쿼리 파라미터 | 백엔드 validation |
|---|---|
| `ALL / LISTING / PENDING / SETTLED / CANCELED` | `ResaleOrderSearchStatus` 로 동일 집합 |

✅ 일치. 단 BE 가 query 에 대한 bind 만 하고 실제 필터 구현이 service 레이어에 있으므로 `PARTIAL / SOLD` 같은 미포함 값 전달 시 어떻게 처리되는지는 service 코드 확인 필요. (공백 처리 fallback 추정)

---

## 6. 시간 포맷 (LocalDateTimeSeoul)

백엔드 응답의 다수 timestamp 필드는 `response.LocalDateTimeSeoul` wrapper 사용. 최근 이슈:

- 2026-04-19 `docs/dev-logs/2026-04-19-game-time-utc-json-contract-fix.md` — 경기 시간 UTC 표시 이슈 근본 수정. `LocalDateTimeSeoul` 은 KST 로 직렬화.
- 관련 memory: `reference_jackson_format_to_go_json.md`

**resale 영향도**:
- `listedAt`, `soldAt`, `canceledAt` (ResaleListingResponse)
- `createdAt` (ResaleListingOrderSummaryResponse)
- `orderedAt` (ResalePurchaseListResponse)
- `paidAt` (PaymentResponse)
- `confirmedAt` (ResalePriceHistoryResponse)

프론트는 `string` 으로 받아 그대로 표시. KST 가정으로 표시한다면 OK. UTC 로 파싱해서 Intl.DateTimeFormat 로 다시 KST 변환하면 **중복 타임존 변환** 위험. 실제 렌더링 코드 점검 필요.

단 `gameDate` (ResalePurchaseListResponse) 는 `response.LocalDateTime` (Seoul 아님). 프론트 표시 맥락에 따라 오해 가능. **P2 확인 필요**.

---

## 7. Mock 플래그 영향

`src/shared/config/runtime.ts`:
```ts
export const isResaleBookingMockEnabled = true;  // 추정, 하드코딩
```

이 값이 true 인 동안:
- `holdResaleListing`, `releaseResaleListingHold`, `fetchResaleListingCountByGame`, `fetchResaleListingCountByGameAndGrade`, `fetchMarketResaleListings`, `fetchResaleGameStatusByGame`, `fetchResaleHistoryGraph`, `createResaleHold`, `createResaleOrder`, `createResalePayment`, `completeResaleOrder`, `getResaleTransactions`, `releaseResaleHold` → **모두 mock 로 치환**.

**의미**:
- 실서버 리셀 API 는 현재 호출되지 않음. 위 P0/P1 이슈 전부 **잠복 버그**.
- Mock off 시:
  - 3-1 의 `GET /api/v1/resales/listings` → 404
  - 2-3 의 `GET /api/v1/resales/listings/orders/:orderId` → 응답 구조 불일치로 flat() 실패
  - 5-1 의 `CANCEL_REQUESTED` dead path → 노출은 없음 (BE 가 반환 안 하므로)

**일부 엔드포인트는 mock 미경로**:
- `createResaleListings` (리셀 등록) — mock 없음, 항상 실서버 호출. 바로 작동해야 함.
- `cancelResaleListing` — mock 없음
- `fetchResaleListingDetail` — mock 없음
- `fetchMyResaleListingSummary` — mock 없음
- `fetchMyResaleListingOrders` — mock 없음 ← **P1 페이지 응답 포맷 불일치 즉시 유효**
- `fetchResaleListingOrderDetails` — mock 없음 ← **P0 응답 shape 불일치 즉시 유효**
- `fetchResaleLedgers`, `fetchResaleLedgerByOrderId` — mock 없음

→ 결론: **판매자 플로우(등록, 내 판매 조회, 정산 원장)** 는 mock 안 거치고 실서버 호출. 이들 중 2-3 와 2-11 는 현재 운영 중인 코드에서도 버그일 가능성 있음.

---

## 8. 우선순위 정리

### P0 (기능 파손)
1. **`GET /api/v1/resales/listings` 미구현** — 마켓 마이페이지/좌석 인사이트 파손. Mock 꺼지면 즉시 404. (§3-1)
2. **`GET /api/v1/resales/listings/orders/:orderId` 응답 shape 불일치** — 내 판매 그룹 상세 조회 전면 파손 (§2-3). Mock 무관 실서버 호출 경로.

### P1 (버그지만 UX 제한적)
3. `PATCH /api/v1/resales/orders/:orderId/complete` 인증 미적용 — 외부 공격 벡터 (§2-8)
4. `releaseResaleHold keepalive` 401 예상 (§2-6) — 서버 로그 스팸, 기능 영향 작음
5. `ResaleListingDetail.{gameTitle,gameDate,stadiumName,ticketNumber}` 백엔드 미제공 (§2-4)
6. `CompleteResaleOrderResponse.items[].ticketId` 백엔드 미제공 (§2-8)
7. `ResaleListingStatus.CANCEL_REQUESTED` enum 불일치 (§5-1)
8. `fetchResaleLedgers` 페이지 응답 포맷 혼재 (Spring vs 커스텀) (§2-11)
9. `GetPurchases` BE 구현을 FE 가 쓰지 않음 — 기능 공백 (§3-2)

### P2 (품질/일관성)
10. path param 이름 혼재 (`:orderId` vs `:resaleOrderId`)
11. `createResaleListings` 응답 shape 방어로직 (§2-1)
12. `ResaleOrderStatus` 프론트 타입이 string — 타입 안전성 저하
13. `LocalDateTimeSeoul` vs `LocalDateTime` 혼재로 tz 오해 여지 (§6)
14. `BuyerEmail` binding 형식 검증 없음

---

## 9. 의문점 (사용자 확인 필요)

- **Mock 플래그 제거 스케줄**: 프로젝트 종료(~2026-04-24) 전까지 실서버 전환 계획이 있는지? 있다면 P0 둘은 차단 요인.
- **`/orders/:resaleOrderId/complete` 의 공개 경로 의도**: payment 서비스에서 resale 서비스로 호출하는 internal 인데 왜 `/api/v1/` prefix? `/internal/` 로 이미 일부 엔드포인트 분리되어 있으므로 옮기는 게 일관적.
- **`isPurchasable` / `availableStatus`**: BE 는 제공하지만 프론트가 UI 에 반영하는지 확인 필요. 좌석 disabled 처리 누락 가능성.
- **`minPrice` / `maxPrice`**: BE 응답에 있지만 프론트 `ResaleListingItem.maxPrice` 만 수신하고 `minPrice` 는 ledger 화면에만 쓰임.

---

## 10. 권장 다음 액션

1. **즉시**: §3-1 백엔드 `GET /listings` 공개 엔드포인트 추가. listing repo 에 `FindAllListing()` 같은 쿼리 있으면 wrap. 없으면 추가.
2. **즉시**: §2-3 `GetListingOrderDetail` 의 응답을 `listings` 배열만 반환하도록 수정하거나, 프론트 `fetchResaleListingOrderDetails` 가 `.listings` 추출하도록 수정. 둘 중 하나.
3. **보안**: §2-8 `/orders/:resaleOrderId/complete` 와 `/settled`, `/transactions` 를 `/internal/resales/` 로 이전 + payment 서비스 → resale 서비스 호출 경로 재확인. 프론트 직접 호출 제거(있다면).
4. **정합성**: §2-4 `GetListing` 응답에 `gameTitle/gameDate/stadiumName/ticketNumber` 추가 (ticket 서비스 조회 포함).
5. **정합성**: §2-8 `CompleteOrder` 응답에 `ticketId` 포함 (ticket 발급 연동 결과).
6. **Enum 정리**: §5-1 프론트 `CANCEL_REQUESTED` 제거 또는 BE 추가.
7. **Mock 제거 계획**: runtime.ts 의 `isResaleBookingMockEnabled` 동적 flag 화 + 단계적 off.

---

## 부록: 감사 커버리지

| 섹션 | 대상 | 상태 |
|---|---|---|
| 라우트 매핑 | 22개 엔드포인트 | 전수 |
| Request 필드 | POST/PATCH 7개 DTO | 전수 |
| Response 필드 | 12개 응답 DTO | 전수 |
| Enum 대조 | 5개 타입 | 전수 |
| 인증 경계 | JWT 미들웨어 vs FE 호출 | 전수 |
| Mock 플래그 분기 | resaleApi.ts / paymentApi.ts | 전수 |
| LocalDateTime 포맷 | 6개 필드 | 목록화만 (실제 렌더는 미확인) |

감사 수행: Claude (Opus 4.7) / 이슈 기록 파일 경로: `docs/dev-logs/2026-04-19-resale-fe-be-contract-audit.md`
