---
title: "Resale FE↔BE API 계약 전수 점검 — 22개 엔드포인트에서 P0 2건·P1 7건 발견"
excerpt: "Goti-front React와 Goti-go resale/payment 서비스 간 API 계약을 라우트·요청·응답·enum·타임포맷 단위로 전수 대조했습니다. Mock 플래그에 가려진 P0 2건과 판매자 플로우를 즉시 파손하는 P1 7건을 식별했습니다."
category: challenge
tags:
  - go-ti
  - Resale
  - Contract
  - FE-BE
  - Audit
  - troubleshooting
series:
  name: goti-resale
  order: 4
date: "2026-04-19"
---

## 한 줄 요약

> Resale FE↔BE 계약을 22개 엔드포인트 전수 대조한 결과, Mock 플래그 하나가 P0 2건(라우트 미구현·응답 shape 불일치)을 숨기고 있었고, Mock을 거치지 않는 판매자 플로우에서는 P0 1건이 이미 운영 중에 유효한 버그였습니다.

---

## 🔥 문제: Mock 플래그 하나가 리셀 버그 전체를 가리고 있음

### 배경

go-ti 프로젝트의 Resale(티켓 재판매) 기능은 복수의 API 계층에 걸쳐 있습니다.

- **프론트엔드**: `resaleApi.ts` (496줄) + `paymentApi.ts` (609줄)
- **백엔드(Go)**: resale 서비스의 `listing_handler`, `transaction_handler` + payment 서비스의 `resale_handler`

Java→Go 컷오버 이후 Resale 통합 테스트 이전에 API 계약 수준의 불일치를 식별하는 검토가 필요했습니다.

### 발견한 상황

`src/shared/config/runtime.ts`에 다음 플래그가 하드코딩되어 있었습니다.

```typescript
export const isResaleBookingMockEnabled = true;  // 하드코딩
```

이 플래그가 `true`인 동안, `createResaleHold` / `releaseResaleHold` / `fetchMarketResaleListings` / `createResaleOrder` / `createResalePayment` / `completeResaleOrder` 등 **13개 핵심 API 경로가 전부 mock 데이터로 치환**됩니다.

결과적으로 실서버 계약 불일치가 운영 중에 드러나지 않고 있었습니다.

단, Mock 경로에 포함되지 않은 엔드포인트도 있습니다. 다음 API들은 현재도 실서버를 호출합니다.

- `createResaleListings` (리셀 등록)
- `cancelResaleListing` (리셀 취소)
- `fetchResaleListingDetail` (리셀 상세)
- `fetchMyResaleListingSummary` (내 리셀 요약)
- `fetchMyResaleListingOrders` (내 판매 목록)
- `fetchResaleListingOrderDetails` (내 판매 그룹 상세)
- `fetchResaleLedgers` / `fetchResaleLedgerByOrderId` (정산 원장)

**판매자 플로우 전체가 Mock을 거치지 않는다는 의미**입니다. 이 경로에서 발견된 계약 불일치는 이미 운영 중인 버그입니다.

---

## 🤔 원인: 라우트 미구현, 응답 shape 불일치, enum 누락이 누적

### 라우트 매핑 전수 (22개)

22개 엔드포인트를 프론트 호출 코드와 백엔드 핸들러 등록부(`cmd/resale/main.go`) 기준으로 전수 대조했습니다. 주요 이슈만 표로 정리합니다.

| # | 프론트 호출 | 경로 | 상태 |
|---|---|---|---|
| 5 | `fetchResaleListingOrderDetails` | `GET /api/v1/resales/listings/orders/:orderId` | 🔴 **P0 응답 shape 불일치** |
| 7 | `fetchMarketResaleListings` | `GET /api/v1/resales/listings` | 🔴 **P0 라우트 없음** |
| 14 | `releaseResaleHold` (keepalive) | `PATCH /api/v1/resales/holds/:holdId/release` | 🟠 P1 인증 누락 |
| 16 | `completeResaleOrder` | `PATCH /api/v1/resales/orders/:orderId/complete` | 🟠 P1 인증 미적용 (공개 엔드포인트) |

전체 22개 중 정상(✅)은 17개, 백엔드 전용(BE-only, FE 미사용)은 3개, 이슈 있음은 5개입니다.

참고로 path param 이름 차이(`:orderId` vs `:resaleOrderId`)가 일부 엔드포인트에 있지만, Gin은 위치 기반 라우팅이라 동작에는 영향이 없습니다. 유지보수·문서화 혼선 정도의 P2 문제입니다.

### P0-1: `GET /api/v1/resales/listings` 라우트 미구현

프론트엔드 `fetchMarketResaleListings()` (`resaleApi.ts:322`)는 리셀 마켓 탭과 좌석 선택 인사이트(`/resell-books`) 두 곳에서 호출됩니다.

백엔드 `cmd/resale/main.go:144-170`의 `/api/v1/resales` 라우트 그룹에 해당 경로가 없습니다. `listing_handler`에 `GetMarketListings` 핸들러도 존재하지 않습니다.

현재 Mock 플래그 덕분에 호출 자체가 발생하지 않습니다. 플래그를 끄는 순간 **리셀 마켓 화면 전체가 404로 파손**됩니다.

### P0-2: `GET /listings/orders/:orderId` 응답 shape 불일치

프론트 `fetchResaleListingOrderDetails()` (`resaleApi.ts:490`)는 배열(`ResaleListingItem[]`)을 기대합니다.

```typescript
// 프론트 기대
const response = await apiClient.get<ApiEnvelope<ResaleListingItem[]>>(...);
return response.data.data;  // 배열로 취급
```

백엔드는 객체를 반환합니다.

```go
// 백엔드 실제 응답
response.Success(c, gin.H{"order": order, "listings": listings})
// → { "order": {...}, "listings": [...] }
```

프론트가 이 객체에 `.flat()`을 적용하면(`resaleApi.ts:318`) `Object.prototype.flat is not a function` 또는 빈 배열이 됩니다. `fetchResaleListings()`가 내부적으로 이 함수를 호출하기 때문에 **내 리셀 판매 내역 조회 전체가 파손**됩니다.

이 엔드포인트는 Mock 경로에 없어 **현재도 실서버를 호출하는 버그**입니다.

### P1: 응답 필드 누락 (`GET /listings/:listingId`)

프론트 `ResaleListingDetail` 타입이 기대하는 필드 중 백엔드 `ResaleListingResponse`가 제공하지 않는 필드가 4개입니다.

| 프론트 기대 필드 | 백엔드 응답 | 영향 |
|---|---|---|
| `ticketNumber?` | 없음 | 상세 화면 공백 |
| `gameTitle` | 없음 | 구매자 상세 페이지 정보 공백 |
| `gameDate` | 없음 | 구매자 상세 페이지 정보 공백 |
| `stadiumName` | 없음 | 구매자 상세 페이지 정보 공백 |

`gameTitle`, `gameDate`, `stadiumName`은 구매자가 리셀 상세 페이지를 열 때 렌더링에 사용하는 필드입니다. 백엔드가 제공하지 않으면 undefined가 그대로 화면에 표시됩니다. 현재 Mock 없이 실서버를 호출하기 때문에 이 문제도 이미 유효합니다.

### P1: `completeResaleOrder` 인증 미적용

`PATCH /api/v1/resales/orders/:orderId/complete` 엔드포인트는 라우트 등록부(`cmd/resale/main.go:166`)에 `jwtMiddleware`가 없습니다. 공개 엔드포인트입니다.

```go
// cmd/resale/main.go — jwtMiddleware 없음
resales.PATCH("/orders/:resaleOrderId/complete", transactionH.CompleteOrder)
```

주석에 "Transaction — internal (no auth)"라고 적혀 있지만, 경로가 `/api/v1/resales/...`로 외부에 노출되어 있습니다. `orderId`와 `paymentId` 쿼리 파라미터만 알면 누구든 타인 주문을 완료 처리할 수 있습니다.

### P1: keepalive 경로 401 예상

`releaseResaleHold`는 두 가지 호출 경로가 있습니다.

- `apiClient.patch()` 경로: axios interceptor를 통해 Authorization 헤더 자동 첨부 → 정상
- `fetch(url, { keepalive: true })` 경로: 탭 닫힘·언마운트 시 사용, Authorization 헤더 없음

백엔드에는 `jwtMiddleware`가 적용되어 있어 **keepalive 경로에서 401**이 예상됩니다. 실제 서버에서 hold TTL 자동 만료로 UX 영향은 작지만, 서버 로그에 401이 누적됩니다.

### P1: 페이지 응답 포맷 혼재

프론트 내에서 두 가지 페이지 응답 포맷을 혼용합니다.

```typescript
// fetchMyResaleListingOrders 기대
{ list: [...], totalCount: number, totalPages: number }

// fetchResaleLedgers 기대 (Spring Data 스타일)
{ content: [...], totalElements: number, totalPages: number, number: number, size: number }
```

백엔드 `response.Page()` 유틸이 실제로 어떤 키를 내려주는지에 따라 **둘 중 하나는 운영 중 crash를 일으킬 수 있습니다**. `list`가 undefined인 상태에서 `.length` 접근 시 런타임 에러가 납니다.

### Enum 불일치

`ResaleListingStatus`에서 프론트가 `CANCEL_REQUESTED` 상태를 정의했으나, 백엔드는 이 값을 반환하지 않습니다.

| 프론트 | 백엔드 |
|---|---|
| `LISTING` | `ListingStatusListing` ✅ |
| `HOLD` | `ListingStatusHold` ✅ |
| `SOLD` | `ListingStatusSold` ✅ |
| `SETTLED` | `ListingStatusSettled` ✅ |
| `CANCEL_REQUESTED` | **없음** |
| `CANCELED` | `ListingStatusCanceled` ✅ |

`CANCEL_REQUESTED`를 처리하는 프론트 분기 코드는 dead path입니다. 기능 오류는 아니지만, 타입 불일치를 방치하면 향후 혼선이 생길 수 있습니다.

### 시간 포맷 영향도

백엔드 응답의 timestamp 필드 다수가 `response.LocalDateTimeSeoul` wrapper를 사용해 KST로 직렬화됩니다. 영향 받는 필드는 다음과 같습니다.

- `listedAt`, `soldAt`, `canceledAt` (ResaleListingResponse)
- `createdAt` (ResaleListingOrderSummaryResponse)
- `orderedAt` (ResalePurchaseListResponse)
- `paidAt` (PaymentResponse)
- `confirmedAt` (ResalePriceHistoryResponse)

프론트가 이 값을 `string`으로 받아 그대로 표시하면 문제 없습니다. 그러나 UTC로 파싱한 뒤 `Intl.DateTimeFormat`으로 KST 변환하면 **중복 타임존 변환**이 발생합니다. 실제 렌더링 코드 점검이 별도로 필요합니다.

`gameDate` 필드는 `response.LocalDateTime` (Seoul 아님)을 사용해 혼선 여지가 있습니다.

---

## ✅ 해결: 우선순위별 권장 액션

분석 결과를 우선순위별로 정리하면 다음과 같습니다.

### P0 — 즉시 차단 해제 필요

**1. `GET /api/v1/resales/listings` 공개 엔드포인트 추가**

listing repository에 `FindAllListing()` 쿼리를 추가하고 핸들러를 등록합니다. 마켓 마이페이지와 좌석 선택 인사이트 두 화면이 이 엔드포인트에 의존합니다.

**2. `GetListingOrderDetail` 응답 shape 수정**

다음 두 가지 방향 중 하나를 선택합니다.

- 백엔드 `GetListingOrderDetail`의 응답을 `listings` 배열만 반환하도록 수정
- 프론트 `fetchResaleListingOrderDetails`가 `.listings`를 추출하도록 수정

어느 쪽이든 단일 팀 내 합의 후 적용합니다.

```go
// 백엔드 수정 방향 예시
// Before
response.Success(c, gin.H{"order": order, "listings": listings})

// After — 배열만 반환
response.Success(c, listings)
```

### P1 — 기능 및 보안 개선

**3. `/complete`, `/settled`, `/transactions` 내부 엔드포인트 격리**

`/api/v1/resales/orders/:resaleOrderId/complete` 경로를 `/internal/resales/` prefix로 이전하거나, payment 서비스→resale 서비스 호출 경로에 service token 또는 mTLS를 적용합니다. 현재는 누구나 `orderId`+`paymentId`로 완료 처리를 트리거할 수 있습니다.

**4. `GetListing` 응답에 게임 정보 필드 추가**

`gameTitle`, `gameDate`, `stadiumName`, `ticketNumber`를 응답에 포함합니다. ticket 서비스나 game 서비스 조회가 필요하면 handler 레벨에서 join 호출을 추가합니다.

**5. `CompleteOrder` 응답에 `ticketId` 포함**

`items[].ticketId`가 없으면 결제 완료 후 티켓 상세 이동에 사용되는 `paymentApi.ts:591`의 `completeResult.items[0]?.ticketId`가 항상 undefined가 됩니다.

**6. 페이지 응답 포맷 통일**

`fetchMyResaleListingOrders`와 `fetchResaleLedgers` 중 어느 한쪽이 실제 백엔드 응답과 맞지 않습니다. `response.Page()`의 실제 출력 키를 확인하고 프론트 타입을 일치시킵니다.

**7. keepalive fetch 경로 401 처리**

keepalive fetch에 Authorization 헤더를 포함하는 방법을 검토합니다. 또는 서버 hold TTL 자동 만료에 의존하고 클라이언트에서 401을 무시하도록 에러 처리를 추가합니다.

### P2 — 품질/일관성

- `CANCEL_REQUESTED` enum 제거 또는 백엔드 추가
- `createResaleListings` 방어 로직(dual shape 수용) 단순화
- `ResaleOrderStatus` 프론트 타입을 `string`에서 union type으로 강화
- `BuyerEmail` 형식 검증 추가 (현재 `binding:"required"`만 있고 email format 미검증)
- path param 이름 통일 (`:orderId` vs `:resaleOrderId`)

### Mock 플래그 제거 계획

`isResaleBookingMockEnabled`를 환경 변수 기반 dynamic flag로 전환하고, P0/P1 수정 후 단계적으로 off합니다. 위 이슈들이 해결되지 않은 상태에서 플래그를 끄면 리셀 마켓 화면이 즉시 404가 됩니다.

---

## 📚 배운 점

### Mock 플래그는 버그 탐지 차단기이기도 합니다

Mock 플래그는 BE 구현 전에 FE 개발을 선행할 때 유용하지만, 장기간 유지되면 **계약 불일치를 런타임에서 발견하지 못하는 상태**가 누적됩니다. 이번 분석에서 확인한 P0 2건은 Mock 플래그가 없었다면 훨씬 일찍 표면화됐을 것입니다.

Mock 플래그 도입 시 다음 기준을 명확히 해야 합니다.

- **off 조건**: 백엔드 엔드포인트 구현 완료 + 계약 대조 통과
- **on 기간 최대값**: 스프린트 단위 상한 설정

### 응답 shape 불일치는 타입만 봐서는 안 잡힙니다

프론트 `ApiEnvelope<T>` 제네릭은 외형상 안전해 보이지만, T가 배열이냐 객체냐는 컴파일 타임에 확인이 안 됩니다. `fetchResaleListingOrderDetails`의 P0 불일치도 TypeScript 타입 레벨에서는 조용히 통과합니다. contract test나 스키마 기반 validation 없이는 런타임에 `.flat()` 호출 실패로만 드러납니다.

### 인증 경계는 라우트 등록부에서 명시적으로 확인해야 합니다

"내부 호출이니 auth 없음"이라는 주석은 라우트 prefix가 `/internal/`이 아니라면 보안 보장이 아닙니다. `completeResaleOrder`처럼 `/api/v1/` 아래 공개 경로에 있는 "내부용" 엔드포인트는 공격 벡터가 됩니다. 내부 전용 API는 path prefix나 미들웨어로 경계를 코드 레벨에서 강제해야 합니다.

### 검토 커버리지 요약

| 섹션 | 대상 | 결과 |
|---|---|---|
| 라우트 매핑 | 22개 엔드포인트 | P0 1건·P1 4건·BE-only 3건 |
| Request 필드 | POST/PATCH 7개 DTO | 대체로 일치, P2 1건 |
| Response 필드 | 12개 응답 DTO | P0 1건·P1 3건 |
| Enum 대조 | 5개 타입 | P1 1건·P2 1건 |
| 인증 경계 | JWT 미들웨어 vs FE 호출 | P1 2건 |
| Mock 플래그 분기 | resaleApi.ts / paymentApi.ts | 잠복 P0 2건 확인 |
| LocalDateTime 포맷 | 6개 필드 | 목록화 완료, 렌더링 코드 별도 점검 필요 |

이 검토는 코드 수정 없이 **분석 전용**으로 수행했습니다. 실제 수정은 `resale-flow-end-to-end-fix` 편에서 다룹니다.
