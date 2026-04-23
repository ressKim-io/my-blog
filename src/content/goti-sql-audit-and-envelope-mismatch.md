---
title: "SQL 전수 audit + 응답 envelope 불일치 — cutover 후속 5건"
excerpt: "Java→Go cutover 후 마이페이지 500 다발 — SQL 컬럼/테이블/JOIN/envelope 5건을 잡고 29개 repository 전수 audit을 돌려 근본 개선 우선순위를 재정리했습니다."
category: challenge
tags:
  - go-ti
  - SQL
  - Audit
  - Contract
  - Migration
  - PostgreSQL
  - troubleshooting
date: "2026-04-13"
---

## 한 줄 요약

> Java→Go cutover 이후 마이페이지 진입 시 500이 다발했고, SQL 컬럼명·JOIN alias·응답 envelope 불일치 5건과 누락 테이블 2건을 수정한 뒤 29개 repository 파일을 전수 audit했습니다.

---

## 🔥 문제: 마이페이지 진입마다 500이 다발

### 기대 동작

마이페이지는 purchases, listings, orders 3종 경로를 호출합니다. 모두 200으로 데이터를 내려줘야 합니다.

### 발견한 문제

prod-12(cutover 직후)부터 prod-28까지 8 사이클 동안 같은 패턴의 500이 누적됐습니다.

증상은 두 종류입니다.

- **DB schema mismatch**: Go 코드가 SELECT/INSERT하는 컬럼명이 실제 테이블 컬럼과 다릅니다.
- **응답 envelope 불일치**: 내부 서비스 간 호출에서 client가 기대한 JSON 구조가 서버 응답과 달라 unmarshal이 실패합니다.

이전 cycle(`cutover smoke trail fixes`, `go cutover residual fixes`)에서 잔존 4건을 이미 처리했지만, 같은 클래스의 결함이 계속 나왔습니다. 사용자 요청으로 SQL 컬럼/테이블 전수 audit을 병행하기로 했습니다.

---

## 🤔 원인: JPA가 자동으로 해주던 일을 Go에서 수동 선언

### 추가 발견 5건

이번 사이클에서 새로 잡은 건들입니다.

| # | 파일 | 잘못 | 정정 | prod 이미지 |
|---|---|---|---|---|
| 8 | `ticketing/handler/order_handler.go` (memberId bind) | gin form binding이 `uuid.UUID`의 TextUnmarshaler를 호출하지 않아 zero UUID → required reject로 400 | `mustQueryUUID`로 명시 parse 후 req 주입 | prod-25 |
| 9 | `ticketing/repository/ticket_repo.go::FindByOrderIDs` | `LEFT JOIN seat_grades sg ON sg.id = s.seat_grade_id` — seats에 `seat_grade_id` 컬럼이 없음 | `seat_sections sec` 중간 JOIN 후 `sg.id = sec.grade_id`로 교정 | prod-26 |
| 10 | `ticketing/repository/game_repo.go::SaveStatus` | INSERT에서 컬럼명을 `status`로 썼으나 실제 컬럼은 `game_status`. SELECT 쪽은 이미 `game_status`였고 INSERT만 누락 | `status` → `game_status` | prod-27 |
| 11 | `ticketing/repository/ticket_freeze_repo.go::FindActiveByTicketID` | SELECT `reason`을 호출하나 실제 컬럼은 `freeze_reason` | `reason` → `freeze_reason` | prod-27 |
| 12 | `payment/infra/resale_client.go::GetPurchases` | resale 응답이 `{list, totalCount, totalPages}` 래퍼인데 client가 `[]ResalePurchaseListItem`으로 unmarshal → object를 array로 디코딩 실패 | paged 임시 struct로 받아 `List`만 반환 | prod-28 |

### 표가 보여주는 패턴

이 5건을 하나하나 보면 서로 다른 실수처럼 보이지만, **공통점은 "Java 시절 JPA/Jackson이 자동으로 처리하던 것을 Go에서 수동으로 다시 쓰면서 누락됐다"**는 점입니다.

- #8 gin binding: JPA `@RequestParam UUID`는 변환 실패 시 명시적 400을 던졌지만, Go gin은 zero UUID를 만들고 뒤이은 `binding:"required"`가 reject합니다. 에러 메시지가 "uuid 파싱 실패"가 아닌 "required field missing"으로 나와 원인 추적이 어려웠습니다.
- #9 JOIN: JPA에서는 `@ManyToOne` 관계를 그래프 탐색으로 따라갑니다. Go에서 raw SQL로 재작성하면서 중간 테이블 `seat_sections`가 빠지고 alias만 복사했습니다.
- #10, #11 컬럼명: Entity 필드명(`status`, `reason`)과 `@Column` 매핑을 JPA가 자동 연결합니다. Go에서는 struct 태그나 쿼리 문자열에 실 컬럼명을 직접 써야 합니다.
- #12 envelope: Jackson이 Jackson 쪽 DTO와 response body를 자동 매칭했지만, Go는 `json.Unmarshal`이 기대 타입과 실제 타입(object vs array)의 차이를 그대로 실패시킵니다.

### 누락 테이블 2건

Java entity는 정의되어 있지만 prod 마이그레이션이 적용되지 않은 테이블이 2개 있었습니다.

| 테이블 | 영향 endpoint | 적용 시점 |
|---|---|---|
| `resale_service.resale_listing_orders` | `/api/v1/resales/listings/orders` | 14:0x UTC |
| `user_service.addresses` | 마이페이지 주소 조회/저장 | 14:1x UTC |

원인은 JPA `ddl-auto=none` 또는 `validate` 설정 추정입니다. Java 시절에도 entity는 있었지만, prod 기동 시 DDL을 자동 생성하지 않고 기존 스키마만 검증하는 모드로 돌았기 때문에 누락이 덮여 있었습니다. Go로 넘어오면서 조회가 실패해야 비로소 드러났습니다.

DDL은 master role(`goti`)로 적용하고, 서비스 role(`goti_resale_svc`, `goti_user_svc`)에 GRANT를 따로 걸었습니다.

Java entity 기준 스키마입니다.

```sql
-- resale_service.resale_listing_orders
CREATE TABLE resale_service.resale_listing_orders (
  id            BIGSERIAL PRIMARY KEY,
  order_number  VARCHAR NOT NULL UNIQUE,
  seller_id     UUID    NOT NULL,
  grade_id      BIGINT  NOT NULL,
  order_status  VARCHAR NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- user_service.addresses
CREATE TABLE user_service.addresses (
  id              BIGSERIAL PRIMARY KEY,
  member_id       UUID    NOT NULL UNIQUE,
  zip_code        VARCHAR NOT NULL,
  base_address    VARCHAR NOT NULL,
  detail_address  VARCHAR NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## ✅ 해결: 5건 수정 + 2건 DDL + 29개 repository 전수 audit

### 컬럼명 교정 (#10, #11)

`game_repo.go::SaveStatus`는 INSERT 컬럼명만 `status` → `game_status`로 바꾸면 끝이었습니다.

```sql
-- Before
INSERT INTO game_statuses (game_id, status, updated_at) VALUES ($1, $2, now());

-- After
INSERT INTO game_statuses (game_id, game_status, updated_at) VALUES ($1, $2, now());
```

`ticket_freeze_repo.go::FindActiveByTicketID`도 동일하게 SELECT 컬럼만 교체했습니다.

```sql
-- Before
SELECT id, ticket_id, reason, active FROM ticket_freezes WHERE ticket_id = $1 AND active = true;

-- After
SELECT id, ticket_id, freeze_reason, active FROM ticket_freezes WHERE ticket_id = $1 AND active = true;
```

### JOIN alias 교정 (#9)

`seats`에는 grade 컬럼이 직접 없고, 중간 테이블 `seat_sections`를 거쳐야 grade_id에 접근할 수 있습니다. `FindByOrderIDs`의 JOIN을 다음과 같이 수정했습니다.

```sql
-- Before: seats에 seat_grade_id가 없어 LEFT JOIN 결과가 항상 NULL
SELECT t.*, sg.name AS grade_name
FROM tickets t
JOIN seats s ON s.id = t.seat_id
LEFT JOIN seat_grades sg ON sg.id = s.seat_grade_id
WHERE t.order_id = ANY($1);

-- After: seat_sections 중간 JOIN
SELECT t.*, sg.name AS grade_name
FROM tickets t
JOIN seats s          ON s.id  = t.seat_id
JOIN seat_sections sec ON sec.id = s.section_id
LEFT JOIN seat_grades sg ON sg.id = sec.grade_id
WHERE t.order_id = ANY($1);
```

### gin binding 수정 (#8)

`uuid.UUID` 타입에 `form` 태그 + `binding:"required"`를 달면 gin이 TextUnmarshaler를 호출하지 않고 zero UUID로 채운 뒤 required 검사에 실패합니다. handler 내부에서 쿼리스트링을 명시 parse하도록 바꿨습니다.

```go
// Before — zero UUID로 변환된 뒤 required reject
type GetOrdersReq struct {
    MemberID uuid.UUID `form:"memberId" binding:"required"`
}

// After — handler에서 명시 parse
memberID, err := mustQueryUUID(c, "memberId")
if err != nil {
    c.AbortWithStatusJSON(http.StatusBadRequest, response.Error("invalid memberId"))
    return
}
req.MemberID = memberID
```

`mustQueryUUID`는 파싱 실패 시 명확한 에러 메시지를 반환하는 헬퍼입니다.

### 응답 envelope 수정 (#12)

resale 서비스는 목록 API를 `{list, totalCount, totalPages}` 형태로 내려주지만, payment의 resale client는 곧장 array로 unmarshal하고 있었습니다. paged 임시 struct를 끼워넣어 응답을 정확히 받은 뒤 필요한 필드만 추출했습니다.

```go
// After
type pagedResalePurchases struct {
    List        []ResalePurchaseListItem `json:"list"`
    TotalCount  int64                    `json:"totalCount"`
    TotalPages  int                      `json:"totalPages"`
}

func (c *ResaleClient) GetPurchases(ctx context.Context, ...) ([]ResalePurchaseListItem, error) {
    var body pagedResalePurchases
    if err := c.do(ctx, req, &body); err != nil {
        return nil, err
    }
    return body.List, nil
}
```

### 29개 repository 전수 audit 결과

`Explore` agent로 모든 repository 파일을 훑어 SQL 컬럼명과 테이블명을 대조했습니다.

| Service | Mismatch | 비고 |
|---|---|---|
| ticketing | 2건 | game_statuses INSERT, ticket_freezes SELECT (위 #10, #11) |
| resale | 0건 | listing_orders 테이블 부재는 별건(DDL 적용) |
| payment | 0건 | resale envelope mismatch는 별건(위 #12) |
| stadium | 0건 | clean |
| user | 1건 | addresses 테이블 부재(DDL 적용) |
| queue | 해당 없음 | Redis 기반 |

SQL 컬럼 mismatch는 ticketing 서비스에 집중됐습니다. 이번 세션에서 잡은 두 건이 전부였고, 다른 서비스는 깨끗했습니다.

### audit이 못 잡은 클래스

전수 audit만으로는 잡히지 않는 결함 유형을 구분했습니다.

- **응답 envelope 불일치(#12)**: 단일 서비스 SQL 검사로는 보이지 않고, 서비스 간 계약 비교가 필요합니다. contract test로만 잡힙니다.
- **gin binding 한계(#8)**: DTO 필드 타입과 태그 조합이 런타임에 zero value로 reject되는 문제로, 정적 분석으로 잡기 어렵습니다. 패턴 차원에서 `mustQueryUUID`/`mustPathUUID` 같은 명시 parse를 강제하는 lint rule이 필요합니다.
- **JOIN alias 오류(#9)**: `seats`에 `seat_grade_id`가 없지만 alias만 보면 그럴듯해 보입니다. 자동 검사는 어렵고, 스키마를 읽고 사람이 판단해야 했습니다.

---

## 📚 배운 점

### 누적 통계로 본 결함 분포

이번 세션 전체(prod-12~prod-28)에서 잡은 23건의 분포입니다.

| 카테고리 | 건수 | 대표 사례 |
|---|---|---|
| Java↔Go 계약(필드명/포맷/엔벨롭) | 6 | OAuth env, JSON field, JWT issuer, queueTokenJti alias, datetime, resale paged envelope |
| Java↔Go DB schema(컬럼명/JOIN) | 7 | display_color_hex, is_available, orderers.mobile, tickets.issued_at, ticket_repo JOIN, game_statuses, ticket_freezes |
| Java↔Go DB schema(테이블 부재) | 2 | resale_listing_orders, addresses |
| Java↔Go 인프라(cookie/route) | 2 | SameSite=Strict, trailing slash redirect |
| viper config 누락 | 2 | RSA key SetDefault, scheduler env |
| 데이터 정합성(seed/cache) | 2 | orphan stadium 5건, inventory cache rebuild |
| 인프라(Redis lazy init) | 1 | NOT_INITIALIZED 자동 복구 |
| 성능 hotpath | 2 | seat-statuses LEFT JOIN, sectionId 제거 |
| 핸들러 binding | 1 | memberId mustQueryUUID |

23건 중 **Java↔Go 계약·스키마 관련이 15건(약 65%)**입니다. JPA와 Jackson이 자동으로 해주던 일을 Go로 직접 쓰면서 생긴 누락이 cutover 시점에 한꺼번에 터졌습니다.

### 근본 개선 우선순위

같은 클래스의 결함이 반복되지 않도록 P1 SDD 후보를 ROI 순으로 정리했습니다.

1. **Java OpenAPI → Go DTO contract test CI**: 계약 6건 + envelope 1건, 총 7건을 모두 잡을 수 있습니다. 가장 ROI가 높습니다.
2. **DB schema → Go SQL static check**: atlas/sqlc 또는 migration validation으로 컬럼 mismatch 7건을 catch합니다.
3. **DB migration prod 일관성 검증**: Java entity vs prod schema diff CI로 테이블 부재 2건을 사전에 잡습니다.
4. **신규 테이블 GRANT 자동화**: 서비스별 DB role 권한 분리 자체는 잘 돼 있지만, DDL 적용 시 master role로 따로 GRANT해야 하는 점이 반복 작업이라 자동화 대상입니다.
5. **gin binding lint rule**: `uuid.UUID` + form binding 패턴 금지, `mustQueryUUID` 강제화.
6. **client 별 응답 envelope contract test**: handler `response.Page` vs `response.Success` 차이를 client side에서 보장합니다.

### 핵심 교훈

이번 세션 23건 fix 중 대부분이 **JPA와 Jackson이 자동 처리하던 것을 Go로 수동 재작성하면서 누락**된 케이스였습니다.

Java 시절에는 entity와 DTO 정의만으로 컬럼명, SQL, 응답 envelope이 모두 처리됐습니다. Go는 SQL과 JSON 양쪽 모두 명시적으로 써야 하고, 이 차이가 cutover 시점에 표면화됐습니다.

다음 서비스를 Go로 포팅할 때는 **entity 추출 + 컬럼/응답 contract 자동 비교 도구**를 prepare phase에 먼저 도입해야 합니다. 수동 audit로 잡아내기 전에 CI에서 걸리도록 하는 것이 훨씬 싸게 먹힙니다.
