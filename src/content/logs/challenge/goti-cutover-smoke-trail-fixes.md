---
title: "Cutover 스모크 트레일 수정 3건 — queueTokenJti·trailing slash·inventory drift"
excerpt: "Java→Go 전환 첫 스모크 이후 연속 발견된 결함 3건을 순차 처리한 기록. JSON 키 alias 불일치, gin trailing slash 308 → 502, inventory cache drift를 잡아냈습니다"
category: challenge
tags:
  - go-ti
  - Go
  - Migration
  - Cutover
  - troubleshooting
series:
  name: goti-java-to-go
  order: 3
date: "2026-04-13"
---

## 한 줄 요약

> Phase 8 P0 수정 배포(order 2 글) 이후 스모크를 재시도하면서 추가로 3건의 결함을 발견했습니다. hold 400, order 502, 좌석 수 drift를 순서대로 수정한 trail fix 기록입니다

---

## 배경: Java→Go 전환과 이 글의 위치

go-ti 프로젝트는 JVM 메모리·콜드스타트 부담과 50만 동시 트래픽 목표 사이의 간극을 해소하기 위해 Java 서비스 6개를 Go로 전량 전환했습니다.
ticketing-go PoC 단계에서 메모리 6배 절감이 실측되면서 전환 근거가 확정됐고, Phase 0~6 구현 완료 이후 Phase 7 감사·Phase 8 정리로 이어졌습니다.

이 글은 **order 2 글(Phase 8 P0 Seat Booking 포팅)에서 발견한 첫 스모크 이슈들을 수정한 직후**, 같은 세션에서 연속으로 발견된 후속 결함들의 기록입니다.
배포 이미지 흐름은 다음과 같습니다.

| 이미지 | 변경 내용 | 비고 |
|---|---|---|
| prod-13 | P0 Seat Booking 포팅 | 직전 글 시작점 |
| prod-14 | `display_color_hex` 추가 | |
| prod-15 | `seat-statuses` 응답 보정 | |
| prod-16 | `is_available` 추가 | |
| prod-17 | refresh cookie + reissue 분기 로깅 | |
| **prod-18** | `queueTokenJti` alias | **이 글: 수정 #5** |
| **prod-19** | trailing slash route 보정 | **이 글: 수정 #6** |

수정 #7(inventory drift)은 코드 변경 없이 데이터 재정비로 처리했습니다.

이번 세션까지 누적 수정 건수는 11건으로, 패턴을 정리하면 다음과 같습니다.

| 카테고리 | 건수 | 대표 사례 |
|---|---|---|
| Java↔Go 계약 불일치 (필드명/포맷) | 5 | OAuth env, JSON field 명, JWT issuer, queueTokenJti alias, datetime |
| Java↔Go DB schema mismatch | 2 | display_color_hex, is_available |
| Java↔Go 인프라 설정 (cookie/route) | 2 | SameSite=Strict, trailing slash redirect |
| viper config 누락 | 2 | RSA key SetDefault, scheduler env |
| 데이터 정합성 (seed 잔재 / cache drift) | 2 | orphan stadium 5건, inventory cache rebuild |

절반은 "환경 diff 점검"으로는 잡아낼 수 없는 **코드 자체의 계약 불일치**였습니다.

---

## 🔥 수정 #5 — hold 400 BadRequest (빈 좌석 클릭)

### 발견한 문제

빈 좌석을 클릭하면 hold 요청에서 `400 BadRequest`가 반환됐습니다.
프론트엔드 코드를 확인하니 요청 페이로드가 아래 형태로 전송되고 있었습니다.

```typescript
// useSeatHoldActions.ts:150
{ queueTokenJti: bookingEntryState.queueTokenJti }
```

프론트는 `queueTokenJti` 키를 전송하지만, Go DTO는 `queueToken`만 바인딩하도록 태그가 지정되어 있었습니다.
JSON 키 불일치로 인해 `binding:"required"` 조건이 충족되지 않아 400이 반환된 것입니다.

---

## 🤔 원인: Java의 @JsonAlias와 Go의 단일 JSON 태그

Java `HoldSeatRequest`는 `@JsonAlias`로 두 키를 모두 수용했습니다.

```java
// HoldSeatRequest.java
@JsonAlias("queueTokenJti")
String queueToken
```

Go에는 `@JsonAlias`에 해당하는 표준 기능이 없습니다.
Go의 `json` 태그는 단일 키만 지정할 수 있기 때문에, Java처럼 두 이름을 동시에 수용하려면 태그 자체를 프론트가 실제로 보내는 키에 맞춰야 합니다.

---

## ✅ 해결: Go DTO JSON 태그 변경

Go DTO의 JSON 태그를 프론트가 전송하는 키 이름으로 변경했습니다.

```go
// 변경 전
QueueToken string `json:"queueToken" binding:"required"`

// 변경 후 — 프론트가 실제 전송하는 키명으로 맞춤
QueueToken string `json:"queueTokenJti" binding:"required"`
```

값 자체는 full JWT이며, `tokenProvider.Parse`로 디코딩해 사용합니다.
"Jti"라는 이름이 붙어 있지만 jti(JWT ID) 클레임만 담은 것이 아니라는 점에 주의가 필요합니다.
변수 명명은 P2 단계에서 명확화할 예정입니다.

---

## 🔥 수정 #6 — order 502 Bad Gateway (POST trailing slash 308 redirect)

### 발견한 문제

`POST /api/v1/orders` 호출 시 Cloudflare에서 502와 함께 아래 메시지가 반환됐습니다.

```text
A request with a one-time-use body... encountered a redirect requiring the body to be retransmitted.
```

---

## 🤔 원인: gin Group + POST("/") 패턴이 만드는 trailing slash 강제

원인 연쇄를 따라가보겠습니다.

1. gin 라우터를 `Group("/api/v1/orders")` + `POST("/", ...)` 형태로 등록하면, 실제 라우트는 `/api/v1/orders/`(trailing slash 포함)로 등록됩니다
2. 클라이언트(axios)는 trailing slash 없이 `POST /api/v1/orders`로 호출합니다
3. gin의 기본값 `RedirectTrailingSlash=true`가 활성화되어 있어 308 Permanent Redirect 응답이 반환됩니다
4. axios/fetch는 `ReadableStream`으로 한 번 소비된 request body를 redirect 시 재전송할 수 없습니다
5. Cloudflare/프록시 레이어가 이를 502로 변환합니다

Spring Boot의 `@RequestMapping("/api/v1/orders") + @PostMapping("/")` 조합은 trailing slash 없이 정식 경로에 매핑되는 반면, gin의 Group + POST("/") 패턴은 다르게 동작합니다.
CDN이나 리버스 프록시 환경에서는 이 차이가 502로 직결됩니다.

영향 범위는 5곳이었습니다.

| 파일 | 영향 라우트 |
|---|---|
| `cmd/ticketing/main.go` | orders POST, games POST, pricing POST, pricing GET |
| `cmd/payment/main.go` | payments/resales POST |

---

## ✅ 해결: POST("") / GET("") 변경

Group root에 직접 매핑되도록 빈 문자열 경로로 수정했습니다.

```go
// 변경 전 — trailing slash 강제 발생
router.Group("/api/v1/orders").POST("/", handler.CreateOrder)

// 변경 후 — group base 자체에 매핑, trailing slash 없음
router.Group("/api/v1/orders").POST("", handler.CreateOrder)
```

이 패턴을 코드베이스 전체에 적용해 5곳 모두 수정했습니다.
Go 서비스 작성 기준으로 **group root 경로는 항상 `POST("")`를 사용한다**는 lint 규칙화도 검토 중입니다.

---

## 🔥 수정 #7 — seat-grades의 availableSeatCount drift

### 발견한 문제

특정 게임(a5cdd8)의 등급별 좌석 수를 확인하니 inventory 캐시와 실제 좌석 수 사이에 큰 차이가 있었습니다.

| grade | inv_avail (캐시) | real_avail (COUNT) | drift |
|---|---|---|---|
| 응원특별석 | 3,000 | 1,064 | +1,936 |
| K5석 | 2,520 | 655 | +1,865 |
| 훼미리석 | 1,800 | 247 | +1,553 |
| ... | ... | ... | ... |
| 합계 | **24,020** | **8,395** | **+15,625** |

캐시가 실제보다 15,625석 많이 잡혀 있었습니다.
이 상태에서는 sold-out 좌석이 available로 노출될 수 있어 P0 수준의 데이터 정합성 문제입니다.

---

## 🤔 원인: seed 실행 순서 + 외부 SQL이 sync를 우회

두 가지 원인이 겹쳐 발생했습니다.

**원인 1 — seed 단계 순서 오류**

seed 파이프라인의 실행 순서를 따라가보겠습니다.

1. step4: 모든 좌석을 AVAILABLE로 채웁니다
2. step5: **이 시점 기준으로** inventory cache를 채웁니다
3. step2b: 좌석의 80%를 SOLD로 덮어씁니다
4. step5는 step2b 이후 다시 실행되지 않습니다

결과적으로 inventory cache는 "step2b 적용 전" 기준값을 그대로 유지하게 됩니다.

**원인 2 — 외부 SQL이 InventorySyncService를 우회**

운영 코드(hold/order_confirm/order_cancel)는 Redis dirty flag를 마킹하고, `InventorySyncService.SyncDirtyGames`가 5초 간격으로 Redis → PG를 동기화합니다.
그러나 seed나 red team 시뮬레이션처럼 **외부 SQL로 직접 수정하는 경우**는 Redis dirty flag를 마킹하지 않습니다.
따라서 외부 SQL 변경은 영구적으로 drift 상태가 됩니다.

---

## ✅ 해결: step5 SQL 재실행으로 inventory 재계산

코드 변경 없이 step5 SQL 본체만 추출해 재실행했습니다.

**첫 번째 시도 — 실패**

```bash
$ psql -v ON_ERROR_STOP=1 -f step5.sql
```

마지막 검증 SELECT가 `JOIN stadium_service.stadiums`에서 cross-schema 권한 부족으로 실패했습니다.
`ON_ERROR_STOP=1` 옵션 때문에 전체 트랜잭션이 ROLLBACK됐습니다.

**두 번째 시도 — 성공**

```bash
$ head -137 step5.sql | psql
# 검증 섹션(cross-schema JOIN) 제거, DROP TABLE ... COMMIT 명시 포함
UPDATE 13182
COMMIT
# 소요: 32초
```

**검증 결과**

```sql
-- a5cdd8 게임 grade별 drift 확인
SELECT grade, inv_avail, real_avail, inv_avail - real_avail AS drift
FROM inventory_check
WHERE game_id = 'a5cdd8b5';
-- drift = 0 (모든 grade)

-- 전체 inventory 합산 비교
SELECT SUM(available_count) FROM inventory;        -- 21,174,595
SELECT COUNT(*) FROM seat_statuses WHERE status = 'AVAILABLE';  -- 21,174,595
-- 완벽 일치
```

---

## "한 번 맞추면 계속 정확한가?" — 조건부 Yes

운영 코드 경로는 안전합니다.
hold → order_confirm → order_cancel → seat_hold_expiry 모두 Redis 업데이트 + dirty 마킹을 수행하고, `SyncDirtyGames`가 5초 간격으로 Redis → PG를 동기화합니다.
따라서 운영 코드로 발생하는 좌석 상태 변화는 자동으로 inventory에 반영됩니다.

단, **외부 SQL이나 seed를 직접 수정하는 경우**는 sync를 우회하므로 이번처럼 수동 재계산이 필요합니다.

또한 **Redis FLUSHALL 후 주의**가 필요합니다.
Redis cache가 비어있는 상태에서 첫 hold가 increment/decrement를 수행하면 0에서 감산되어 음수가 될 수 있습니다.
부하 테스트 시작 전 Redis inventory 초기 로드 메커니즘을 별도로 확인해야 합니다(현재 미확인, 후속 TODO).

---

## 빌드 / 배포 요약

| 커밋 | 내용 | 이미지 |
|---|---|---|
| `82733e7` | queueTokenJti JSON 태그 변경 | prod-18 |
| `a3ab08b` | trailing slash 5곳 수정 | prod-19 |

두 커밋 모두 `go build ./... && go vet ./...` exit 0 확인 후, goti-k8s 자동 PR 머지 → ArgoCD sync(`kubectl annotate refresh=hard`) 순서로 배포했습니다.
수정 #7(inventory drift)은 코드 변경이 없어 별도 배포 없이 처리됐습니다.

---

## 근본 개선 TODO (P1/P2)

이번 수정은 증상 해소에 가깝습니다. 재발 방지를 위한 구조 개선 항목은 다음과 같습니다.

- **read 경로를 Redis 1차로 변경**: PG는 sync target / cold storage로만. drift 자체를 무력화 (메모리 C3)
- **Redis 초기 로드 보장**: FLUSHALL 후 첫 호출 시 PG에서 reload하거나 명시적 init endpoint 추가
- **seed 파이프라인 순서 보정**: step5는 step2b 이후 실행하거나 별도 step7로 분리
- **inventory drift CI check**: 부하 테스트 시작 전 sanity check 자동화 (drift > N% → block)

---

## 📚 배운 점

- **Go에는 @JsonAlias가 없다**: Java의 `@JsonAlias`로 두 키를 수용하던 DTO는 Go 전환 시 프론트가 실제 전송하는 키로 태그를 고정해야 합니다. 계약서(API 스펙)가 없으면 프론트 코드를 직접 확인하는 것이 가장 확실합니다
- **gin Group + POST("/")는 trailing slash를 강제한다**: `POST("")`로 작성해야 trailing slash 없는 경로에 매핑됩니다. CDN·리버스 프록시 환경에서 308 → 502로 증폭되므로 lint rule로 고정하는 것이 효율적입니다
- **seed 파이프라인의 실행 순서가 데이터 정합성을 결정한다**: inventory cache 재계산(step5)은 반드시 실제 상태를 덮어쓰는 단계(step2b) 이후에 실행해야 합니다
- **외부 SQL은 sync를 우회한다**: InventorySyncService처럼 Redis dirty flag 기반의 동기화 구조는 운영 코드 밖의 직접 SQL 변경에 대응하지 못합니다. seed·ad-hoc 수정 후에는 항상 재계산을 수행해야 합니다
- **계약 불일치는 smoke 없이 발견하기 어렵다**: 환경 diff 점검(env 변수, schema 비교)으로는 JSON 키 이름 불일치처럼 코드 내부에 숨어 있는 계약 문제를 잡을 수 없습니다. contract test 또는 schema validation CI 도입이 P2 우선순위입니다
