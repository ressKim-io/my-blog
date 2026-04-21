# Phase 6: Ticketing Go 구현 세션 기록

날짜: 2026-04-10

## 요약

Java→Go 마이그레이션 Phase 6 Ticketing 서비스 구현 + 코드 리뷰 + P0/P1 수정 + 테스트 완료.
33개 API, 18 DB 테이블, Redis 세션/분산 락, 스케줄러 2개를 Go로 재작성.

## 구현 결과

| 레이어 | 파일 수 | 핵심 내용 |
|--------|---------|----------|
| Domain Entity | 5 | Game/Seat/Order/Ticket/Pricing 엔티티 + Enum |
| Domain DTO | 5 | Request/Response DTO (SDD §2.3~2.4 100% 대응) |
| Domain Logic | 1 | RefundPolicy — 환불 계산 순수 함수 |
| Repository | 11 | pgx raw SQL, database.Querier 패턴 |
| Infra Client | 2 | StadiumClient, PaymentClient (httpclient 기반) |
| Service Domain | 7 | Session/Game/Seat/SeatStatus/Order/Ticket/Pricing |
| Service App | 8 | 검색/홀드/만료/주문생성/결제확인/취소/티켓정보/리셀 |
| Handler | 9 | common + 8개 핸들러 (33개 API 라우팅) |
| Scheduler | 2 | 홀드 만료(1초), 티켓팅 상태 전환(1분) |
| Config | 1 | configs/ticketing.yaml |
| Bootstrap | 1 | cmd/ticketing/main.go |
| **단위 테스트** | 3 | refund_policy 9케이스, entity 7케이스, DayType 7케이스 |
| **통합 테스트** | 1 | testcontainers 7 suites + E2E 주문→결제→발권→취소 |

**총 56파일, 커밋 17개**

## 핵심 성능 개선

### game_seat_inventories 활용 (~300배)

| | Java | Go |
|---|---|---|
| 잔여석 조회 대상 | seat_statuses (30만+ row) | game_seat_inventories (900 row) |
| 방식 | IN절 + COUNT + GROUP BY | ANY($1) + SUM + GROUP BY |

### 추가 개선
- N+1 제거: GameSearchService 배치 조회 (FindStatusesByGameIDs)
- 좌석 중복 주문 검사: N+1 → 배열 기반 일괄 조회
- 취소 루프: 개별 UPDATE → 배치 UPDATE
- BulkCreate: 단건 INSERT 루프 → batch VALUES INSERT
- 가격 조회: grade별 캐싱 (동일 grade 중복 쿼리 제거)

## 코드 리뷰 + 수정

go-expert 에이전트로 리뷰 실행. P0 5건 + P1 7건 즉시 수정.

### P0 수정 (5/5)
1. **SQL Injection**: `timeField` allowlist 검증 추가
2. **QR 시크릿 하드코딩**: config 주입으로 변경
3. **Payment 환불 실패**: `REFUNDING` 상태 분리 → 성공 시 `COMPLETED` 전환
4. **ConfirmPayment race**: `UpdateStatusFrom` 낙관적 HELD→SOLD 검증
5. **OrderCreate hold 검증**: TX 안으로 이동 (만료 race 방지)

### P1 수정 (7/9)
1. N+1 제거 → 배치 조회 메서드 추가
2. BulkCreate → batch VALUES INSERT
3. gradeInfos/seat/ticket 에러 체인 보강
4. ticket 조회 → `pgx.ErrNoRows` vs DB 에러 구분
5. TicketingStatusScheduler → 분산 락 추가
6. 가격 조회 → grade별 캐싱
7. OrderCancelRepository.UpdateStatus 메서드 추가

### P1 미수정 (2/9)
- Internal API / Admin API 인증: 전체 서비스 일괄 적용 대상 (Java도 미구현, Istio mTLS 보호)

## 테스트

### 단위 테스트 (20/20 PASS)
- `refund_policy_test.go`: 당일/익일/경기취소/우천취소/deadline 경계/수수료 floor/0건
- `entity_test.go`: Hold.Release, SeatHold.IsExpired, Order.Confirm, OrderItem.Pay/Cancel, Ticket.Invalidate/MarkResale, TicketFreeze.IsActive
- `pricing_service_test.go`: DayTypeFromDate 월~일 전수 검증

### 통합 테스트 (testcontainers PostgreSQL)
- GameRepo: Save/Find + 중복 검사
- InventoryRepo: AdjustCounts 원자적 증감 + RemainingSeats 배치 조회
- SeatHoldRepo: 만료 홀드 배치 조회
- OrderItemRepo: 중복 좌석 검사
- TicketRepo: BatchInvalidate
- **E2E**: Hold→Order→Confirm(SOLD)→Ticket발권→Cancel(AVAILABLE 복원) 전체 흐름 검증

## 설계 결정

| 항목 | 결정 | 근거 |
|------|------|------|
| 인벤토리 동기화 | 동일 TX 내 원자적 | 별도 이벤트보다 정합성 보장 |
| 환불 정책 | 순수 함수 분리 | 테스트 용이, 부수효과 없음 |
| 서비스 레이어 | Application + Domain 2계층 | Java 구조 유지 |
| 큐 토큰 | queue/token.Parse 재사용 | Phase 3와 동일 포맷 |
| 예매수수료 | config 외부화 (기본 1000) | Java 하드코딩 개선 |
| Payment 환불 | REFUNDING→COMPLETED 상태 분리 | 환불 실패 시 추적 가능 |

## 다음 단계

- Phase 7: Cleanup + prod 환경 배포
- Dockerfile + K8s manifest (Helm values)
- ECR + CI/CD 파이프라인
