---
title: "Phase 6 Ticketing 구현 — 58 Go 파일, N+1 제거, Redis Lua 재고 스크립트"
excerpt: "Java Ticketing 서비스를 Go로 전면 재작성한 Phase 6 포팅 기록입니다. 33개 API, 18 DB 테이블, Redis 분산 락, 스케줄러 2개를 56파일·17커밋으로 구현하고 P0 5건·P1 7건을 즉시 수정했습니다."
category: challenge
tags:
  - go-ti
  - Ticketing
  - Phase6
  - Go
  - Redis-Lua
  - troubleshooting
series:
  name: "goti-ticketing-phase"
  order: 1
date: "2026-04-10"
---

## 한 줄 요약

> Java Ticketing 서비스를 Go로 완전 재작성했습니다. `game_seat_inventories` 집계 테이블 활용으로 잔여석 조회 대상을 30만 행에서 900행으로 줄이고, N+1 쿼리 5곳을 배치 조회로 전환했습니다.

---

## Phase 6/6.5/7/8 전체 흐름

이 글은 Java→Go 마이그레이션의 **Phase 6 구현 본체**입니다. 전체 흐름을 먼저 정리합니다.

| Phase | 내용 |
|-------|------|
| Phase 6 | Ticketing 포팅 본체 — 58 Go 파일, Redis Lua inventory script, N+1 제거 |
| Phase 6.5 | Go prod 인프라 신설 — Helm values / SSM ExternalSecret / KEDA. "values가 Java 기준이라 Go pod 하나도 prod에 없음" 갭 해소 |
| Phase 7 | Go Readiness Audit — API 계약·E2E·정적분석·부하·관측성·운영준비·데이터정합성·보안 8게이트 |
| Phase 8 | Cleanup — Java deprecation. Phase 7 풀세트 + 컷오버 완료 후에만 진입 |

Go 전환 배경을 한 줄로 정리하면 다음과 같습니다. ticketing-go PoC에서 **메모리 6x 절감을 실측**했고, 50만 동시 접속 목표에 JVM 콜드스타트와 메모리 오버헤드가 장벽이 되면서 6개 서비스 전량 전환으로 결정했습니다.

---

## 🔥 문제: 33개 API, 18 DB 테이블을 Java에서 Go로 옮겨야 한다

Ticketing 서비스는 go-ti 프로젝트에서 가장 복잡한 도메인입니다. 좌석 홀드·만료·주문 생성·결제 확인·취소·리셀까지 흐름이 이어지고, 각 단계가 DB 트랜잭션·Redis 분산 락·외부 Payment 서비스와 맞물립니다.

Java 구현체를 그대로 읽어가며 옮기면 설계 오류나 N+1을 함께 이식하게 됩니다. 재작성 시점에 알려진 성능 이슈까지 같이 정리하는 것이 목표였습니다.

### 구현 대상 전체

| 레이어 | 파일 수 | 핵심 내용 |
|--------|---------|----------|
| Domain Entity | 5 | Game / Seat / Order / Ticket / Pricing 엔티티 + Enum |
| Domain DTO | 5 | Request/Response DTO (SDD §2.3~2.4 100% 대응) |
| Domain Logic | 1 | RefundPolicy — 환불 계산 순수 함수 |
| Repository | 11 | pgx raw SQL, database.Querier 패턴 |
| Infra Client | 2 | StadiumClient, PaymentClient (httpclient 기반) |
| Service Domain | 7 | Session / Game / Seat / SeatStatus / Order / Ticket / Pricing |
| Service App | 8 | 검색 / 홀드 / 만료 / 주문생성 / 결제확인 / 취소 / 티켓정보 / 리셀 |
| Handler | 9 | common + 8개 핸들러 (33개 API 라우팅) |
| Scheduler | 2 | 홀드 만료(1초), 티켓팅 상태 전환(1분) |
| Config | 1 | configs/ticketing.yaml |
| Bootstrap | 1 | cmd/ticketing/main.go |
| 단위 테스트 | 3 | refund_policy 9케이스 / entity 7케이스 / DayType 7케이스 |
| 통합 테스트 | 1 | testcontainers 7 suites + E2E 주문→결제→발권→취소 |

**총 56파일, 커밋 17개**로 완료했습니다.

---

## 🤔 원인: Java 구현체의 두 가지 성능 부채

포팅 과정에서 Java 구현체에서 이식하면 안 되는 패턴 두 가지를 확인했습니다.

### 부채 1 — 잔여석 조회가 seat_statuses(30만+ 행)를 전체 스캔

```text
Java: seat_statuses(30만+ row) → IN절 + COUNT + GROUP BY
Go:   game_seat_inventories(900 row) → ANY($1) + SUM + GROUP BY
```

`game_seat_inventories`는 grade당 집계 row가 존재합니다. 한 경기에 등급이 10개라면 900행짜리 집계 테이블이 되는데, Java 구현은 이 테이블을 활용하지 않고 `seat_statuses` 원본을 매번 GROUP BY했습니다.

조회 대상 규모 차이만으로 약 300배 차이가 납니다. 트래픽이 없을 때는 체감이 안 되지만, 동시 요청이 몰리면 이 풀스캔이 DB CPU를 잠식합니다.

### 부채 2 — N+1 패턴 5곳

포팅 대상 코드에서 배치 조회 없이 루프 안에서 단건 조회를 반복하는 패턴을 5곳 발견했습니다.

| 위치 | 기존 패턴 | 개선 |
|------|----------|------|
| GameSearchService | 게임 목록 조회 후 각 게임별 상태 조회 루프 | FindStatusesByGameIDs 배치 |
| 좌석 중복 주문 검사 | 좌석 1개씩 DB 조회 | 배열 기반 일괄 조회 |
| 취소 루프 | 좌석 개별 UPDATE | 배치 UPDATE |
| OrderItem Insert | 좌석마다 단건 INSERT | batch VALUES INSERT (BulkCreate) |
| 가격 조회 | 동일 grade 중복 쿼리 | grade별 캐싱 |

단건 루프는 좌석이 적을 때는 문제가 되지 않습니다. 10석·20석을 한 번에 잡는 요청에서 INSERT가 10~20번 날아가고 DB 왕복 비용이 선형으로 증가합니다.

---

## ✅ 해결: 재작성 + P0/P1 즉시 수정

### 핵심 성능 개선 적용

잔여석 조회는 `game_seat_inventories` 집계 테이블로 전환했습니다.

```sql
-- Before: seat_statuses 전체에서 COUNT + GROUP BY
SELECT grade_id, COUNT(*) AS available_count
FROM seat_statuses
WHERE game_id = $1 AND status = 'AVAILABLE'
GROUP BY grade_id;

-- After: game_seat_inventories 900 row에서 SUM
SELECT grade_id, SUM(available_count) AS available_count
FROM game_seat_inventories
WHERE game_id = ANY($1)
GROUP BY grade_id;
```

N+1 제거는 각 서비스 레이어에 배치 메서드를 추가하는 방식으로 적용했습니다.

```go
// Before: 게임 목록 조회 후 루프
for _, game := range games {
    status, _ := repo.FindStatusByGameID(game.ID)
    // ...
}

// After: 배치 조회 한 번
statuses, _ := repo.FindStatusesByGameIDs(gameIDs)
```

### go-expert 코드 리뷰 — P0 5건 수정

구현 완료 후 코드 리뷰를 실행했습니다. P0(즉시 수정 필수) 5건, P1(중요) 9건이 나왔습니다.

**P0 수정 (5/5)**

| 번호 | 이슈 | 수정 내용 |
|------|------|----------|
| 1 | SQL Injection | `timeField` allowlist 검증 추가 |
| 2 | QR 시크릿 하드코딩 | config 주입으로 변경 |
| 3 | Payment 환불 실패 | `REFUNDING` 상태 분리 → 성공 시 `COMPLETED` 전환 |
| 4 | ConfirmPayment race | `UpdateStatusFrom` 낙관적 HELD→SOLD 검증 |
| 5 | OrderCreate hold 검증 | TX 안으로 이동 (만료 race 방지) |

P0 중 가장 중요한 것은 4번과 5번입니다. ConfirmPayment에서 HELD→SOLD 전환 시 낙관적 검증이 없으면 만료된 홀드로 결제가 확정될 수 있습니다. OrderCreate의 hold 검증을 TX 밖에 두면 검증 후 만료가 끼어드는 race가 열립니다.

**P1 수정 (7/9)**

| 번호 | 이슈 | 수정 |
|------|------|------|
| 1 | N+1 제거 | 배치 조회 메서드 추가 |
| 2 | BulkCreate | batch VALUES INSERT |
| 3 | 에러 체인 | gradeInfos / seat / ticket 에러 체인 보강 |
| 4 | ticket 조회 | `pgx.ErrNoRows` vs DB 에러 구분 |
| 5 | TicketingStatusScheduler | 분산 락 추가 |
| 6 | 가격 조회 | grade별 캐싱 |
| 7 | OrderCancelRepository | `UpdateStatus` 메서드 추가 |

미수정 2건(Internal API / Admin API 인증)은 전체 서비스에 일괄 적용할 대상입니다. Java 구현체도 동일하게 미구현 상태이고, Istio mTLS가 서비스 간 통신을 보호하고 있어 다음 Phase로 유예했습니다.

### 주요 설계 결정

| 항목 | 결정 | 근거 |
|------|------|------|
| 인벤토리 동기화 | 동일 TX 내 원자적 | 별도 이벤트보다 정합성 보장 |
| 환불 정책 | 순수 함수 분리 | 테스트 용이, 부수효과 없음 |
| 서비스 레이어 | Application + Domain 2계층 | Java 구조 유지 |
| 큐 토큰 | queue/token.Parse 재사용 | Phase 3와 동일 포맷 |
| 예매수수료 | config 외부화 (기본 1000) | Java 하드코딩 개선 |
| Payment 환불 | REFUNDING→COMPLETED 상태 분리 | 환불 실패 시 추적 가능 |

`RefundPolicy`를 순수 함수로 분리한 결정이 테스트 측면에서 가장 효과적이었습니다. 부수효과가 없는 계산 로직이므로 DB 없이 9케이스 전부를 단위 테스트로 검증할 수 있었습니다.

### 테스트 결과

**단위 테스트 (20/20 PASS)**

```text
- refund_policy_test.go:  당일 / 익일 / 경기취소 / 우천취소 / deadline 경계 / 수수료 floor / 0건 (9케이스)
- entity_test.go:         Hold.Release / SeatHold.IsExpired / Order.Confirm / OrderItem.Pay+Cancel /
                          Ticket.Invalidate+MarkResale / TicketFreeze.IsActive (7케이스)
- pricing_service_test.go: DayTypeFromDate 월~일 전수 검증 (7케이스)
```

**통합 테스트 (testcontainers PostgreSQL)**

```text
- GameRepo:       Save / Find + 중복 검사
- InventoryRepo:  AdjustCounts 원자적 증감 + RemainingSeats 배치 조회
- SeatHoldRepo:   만료 홀드 배치 조회
- OrderItemRepo:  중복 좌석 검사
- TicketRepo:     BatchInvalidate
- E2E:            Hold → Order → Confirm(SOLD) → Ticket발권 → Cancel(AVAILABLE 복원)
```

E2E 흐름은 전체 상태 전환을 한 시퀀스로 커버합니다. Hold가 만료되기 전에 Order가 생성되고, Confirm 시 SOLD로 전환되며, Cancel 시 AVAILABLE로 복원되는 흐름 전체를 실제 PostgreSQL 컨테이너에서 검증했습니다.

---

## 📚 배운 점

- **포팅은 설계 부채를 같이 해소할 기회입니다.** Java→Go 재작성 시 코드를 그대로 옮기면 N+1, 집계 테이블 미활용 같은 기존 패턴이 함께 이식됩니다. 재작성 시점에 알려진 병목을 같이 정리하면 이후 성능 검증 단계에서 기준선이 이미 개선된 상태로 시작할 수 있습니다
- **race condition은 TX 경계로 막습니다.** hold 검증을 TX 안으로 이동하는 것만으로 만료 race가 닫힙니다. 검증과 상태 변경을 같은 TX에 묶는 원칙을 지키면 TOCTOU를 원천 차단합니다
- **P0 보안 이슈는 구현 완료 즉시 수정합니다.** QR 시크릿 하드코딩과 SQL Injection 취약점은 구현 완료 시점에 리뷰로 발견했고 즉시 수정했습니다. 운영 전 발견이었기에 다행이었지만, 리뷰 시점을 PR 단위로 당기면 더 일찍 잡을 수 있습니다
- **환불 정책 같은 순수 계산 로직은 별도 모듈로 분리합니다.** 부수효과가 없어야 유닛 테스트가 간단해지고, 정책 변경 시 영향 범위가 명확해집니다. 비즈니스 규칙이 복잡할수록 이 분리의 이점이 커집니다
- **상태 전이에는 명시적 중간 상태를 둡니다.** Payment 환불에서 REFUNDING 상태를 분리한 결과, 환불 실패 시 COMPLETED로 잘못 전환되지 않고 REFUNDING에 머물러 추적할 수 있게 되었습니다. 상태 기계를 단순하게 유지하려다 실패 케이스를 구분 못 하는 경우가 많습니다
