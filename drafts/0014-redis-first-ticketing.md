# ADR 0014 — 티켓팅 도메인 Redis-first 전환

- **Status**: Accepted (2026-04-14, partial implementation)
- **Context**: 3000 VU 부하 결과 RDS read/lock 경합으로 ticket_success 13~16%.
  좌석 상태/메타 데이터의 RDS 직접 조회·UNIQUE 제약 race 가 병목 증명됨.
- **Decision**: 부하 핵심 path 를 Redis-first 로 전환하고 RDS 는 영속/소스
  오브 트루스로만 사용. 정합성은 dirty set + sync worker + reconciliation job 으로 보장.

## 적용 후보 (우선순위)

| # | 항목 | 패턴 | 임팩트 | 복잡도 |
|---|---|---|---|---|
| 0 | seat-statuses cache | cache-aside (TTL 2s) | 매우 큼 | 낮음 (적용 완료) |
| 1 | seat hold | `SETNX seat:held:{gameID}:{seatID} userID EX=600` | 매우 큼 — race + duplicate key 해소 | 중 |
| 2 | reservation lock | `SETNX reserve:{gameID}:{seatID} userID NX EX=300` | 큼 — 결제 race | 중 |
| 3 | seat-sections / pricing-policies 메타 캐시 | cache-aside (TTL 5m) | 큼 — read 흡수 | 낮음 |
| 4 | 사용자별 active hold count | Redis Hash | 중 | 낮음 |
| 5 | payment status polling → pub/sub | pub/sub | 중 | 높음 |

## 정합성 체크 패턴

| 패턴 | 설명 | 적용처 |
|---|---|---|
| Dirty Set + Sync Worker | Redis 변경 시 dirty 셋 추가, worker 가 RDS batch flush | hold/reservation, inventory(기존) |
| Reconciliation Job | 매 N분 Redis vs RDS count 비교 + drift 알림 + 자동 복구 | inventory, seat counts |
| Outbox Pattern | RDS write 시 outbox 테이블 → poller 가 Redis 동기화 | order/payment 이벤트 |
| TTL Self-healing | Redis-only 캐시는 TTL 만료로 자가 회복 | seat-statuses (적용) |
| Single Source of Truth 명시 | 데이터별로 Redis vs RDS 중 진실 명확화 | 도메인 문서 |

## 단계별 롤아웃

### Phase A (이번 부하 전 — 적용)
- [x] #0 seat-statuses cache-aside (TTL 2s) — Goti-go e4f651e
- [x] #1 seat hold (이미 distLock + Redis 인벤토리)
- [x] #2 reservation lock Redis SETNX — Goti-go 0d6f7b4 (order create race 흡수)
- [x] #3 sections/pricing 메타 캐시 (TTL 5m) — Goti-go 7c70162

### Phase A 보강 (적용 완료)
- [x] HoldSeat 후 seat-status section 캐시 invalidation — Goti-go a754533
- [x] payment-order Redis prewarm + cache (payment cascade fix) — Goti-go eea4818
- [x] PgBouncer ticketing pool 100→150, ticketing replicas 6→8, payment 2→4 — Goti-k8s 411936b

### Phase B (SDD 작성 완료, 별도 PR)
- 정합성 reconciliation worker (Redis vs RDS, every 5m)
- 사용자별 active hold count (Redis HINCRBY)
- inventory dirty set 패턴을 hold/reservation 까지 확장
- 설계: `docs/dx/0001-payment-outbox-and-reconciliation-sdd.md`

### Phase C (SDD 작성 완료, 별도 PR — 가장 큰 임팩트)
- payment Outbox 비동기 (order create 60s timeout 의 진짜 fix)
- payment status polling/SSE → pub/sub 전환
- 보상 트랜잭션 (payment 실패 시 좌석 자동 해제)
- 설계: `docs/dx/0001-payment-outbox-and-reconciliation-sdd.md`

## Trade-offs

| 항목 | 장점 | 단점/리스크 |
|---|---|---|
| Redis-first | RDS 부하 1/100, latency ms 단위 | Redis 장애 시 영향 큼 → multi-AZ + sentinel/cluster 필수 |
| TTL cache | 단순, 자가 회복 | stale window (2s~5m) — 좌석 1초 안에 두 번 잡힐 가능 |
| SETNX lock | race 자체를 메모리에서 끝냄 | TTL 이내 결제 못 끝내면 lock 만료 → 동일 race 재현 가능. TTL 충분히 |

## 관련 기록
- `docs/load-test/2026-04-14-3000vu-queue-oneshot.md` (1차 부하)
- `docs/load-test/2026-04-14-3000vu-2nd-and-next-checklist.md` (2차 + 다음 체크리스트)
- `docs/dev-logs/2026-04-14-pgbouncer-rollout-and-load-test.md`
