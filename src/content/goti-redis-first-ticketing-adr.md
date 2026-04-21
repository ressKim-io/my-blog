---
title: "Redis 우선 티켓팅 — SoT 전환을 결정한 배경"
excerpt: "3000 VU 부하테스트에서 RDS read/lock 경합으로 ticket_success가 13~16%까지 떨어졌습니다. 티켓팅 핵심 path를 Redis-first로 전환하고 RDS는 영속 저장소로만 사용하는 아키텍처 결정 과정을 기록합니다."
category: challenge
tags:
  - go-ti
  - Redis
  - Ticketing
  - Architecture Decision Record
  - PostgreSQL
  - LoadTest
series:
  name: "goti-redis-sot"
  order: 1
date: "2026-04-14"
---

## 한 줄 요약

> 3000 VU 부하테스트에서 티켓 성공률이 13~16%까지 떨어지는 것을 확인했습니다. 병목은 RDS의 read 부하와 UNIQUE 제약 경합이었습니다. 티켓팅 핵심 path를 Redis-first로 전환하고 정합성은 dirty set + sync worker + reconciliation job으로 보장하기로 결정했습니다.

---

## 배경: 부하테스트에서 드러난 RDS 병목

3000 VU 부하테스트를 돌렸을 때, `ticket_success` 지표가 13~16%에 머물렀습니다.
좌석을 잡는 데 성공하는 사용자가 전체의 6분의 1도 되지 않았다는 의미입니다.

프로파일링 결과 두 가지 병목이 드러났습니다.

첫 번째는 **RDS read 부하**입니다.
좌석 상태와 메타 데이터(seat-sections, pricing-policies)를 매 요청마다 RDS에서 직접 조회하고 있었습니다.
동시 접속자가 늘어나면 RDS 커넥션과 I/O가 포화되었습니다.

두 번째는 **UNIQUE 제약 race**입니다.
좌석 hold와 reservation을 RDS의 UNIQUE 제약으로만 보호하고 있었는데, 동일 좌석에 대해 여러 요청이 동시에 들어오면 대부분이 duplicate key 에러로 실패했습니다.
race 자체는 DB가 막아주지만, 실패한 요청의 retry 비용과 사용자 경험이 문제였습니다.

RDS 스펙을 올려도 경합 구조 자체는 해소되지 않았습니다.
근본 원인은 **뜨거운 path를 RDS에서 처리하는 구조**였습니다.

---

## 선택지 비교

이 상황에서 현실적으로 놓여 있는 선택지를 정리했습니다.

| 방향 | 설명 | 장점 | 단점 |
|---|---|---|---|
| RDS 스펙 상향 | 인스턴스 타입 업그레이드, read replica 증설 | 구현 변경 최소 | 경합 구조 그대로, 비용 선형 증가 |
| 파티셔닝 / 샤딩 | 게임 ID 기준 파티션 | RDS 부하 분산 | 운영 복잡도 급증, 결제 트랜잭션 설계 재작업 |
| **Redis-first 전환** | 핵심 hot path를 Redis로, RDS는 영속 SoT | RDS 부하를 메모리로 흡수 | Redis 장애 영향 범위 확대, 정합성 설계 필요 |

이 표에서 핵심은 **부하를 어디서 흡수하는가**입니다.

RDS 스펙 상향은 가장 빠르게 적용할 수 있지만, 경합 구조가 그대로 남습니다.
인스턴스 타입을 올려도 UNIQUE 제약 위에서 벌어지는 race는 사라지지 않습니다.
비용도 트래픽에 비례해 선형으로 증가합니다.

파티셔닝은 장기적으로 확장성을 제공하지만, 단기간에 적용하기에는 부담이 컸습니다.
결제 트랜잭션과 좌석 hold가 동일 샤드에 묶이도록 재설계해야 하고, 운영 중인 데이터를 옮기는 마이그레이션도 필요합니다.

Redis-first 전환은 구현 작업이 가장 많지만, **경합 자체를 메모리로 끌어올려서 해소**합니다.
`SETNX`로 race를 메모리에서 끝내고, cache-aside로 read를 흡수합니다.
단, Redis 장애 시 영향 범위가 커지기 때문에 multi-AZ 구성과 정합성 보장 패턴이 필수입니다.

---

## 결정: Redis-first 전환 + RDS를 영속 SoT로

부하의 핵심 path를 Redis-first로 전환하고, RDS는 **영속 소스 오브 트루스**로만 사용하기로 결정했습니다.
정합성은 다음 세 가지 패턴의 조합으로 보장합니다.

- **Dirty set + Sync worker**: Redis 변경 시 dirty 셋에 추가하고, worker가 RDS로 batch flush합니다.
- **Reconciliation job**: 매 N분 주기로 Redis와 RDS의 카운트를 비교해 drift를 감지하고 알림/자동 복구합니다.
- **TTL Self-healing**: Redis-only 캐시는 TTL 만료로 자가 회복합니다.

---

## 적용 후보와 우선순위

전환 대상 후보를 임팩트와 복잡도로 정리했습니다.

| # | 항목 | 패턴 | 임팩트 | 복잡도 |
|---|---|---|---|---|
| 0 | seat-statuses cache | cache-aside (TTL 2s) | 매우 큼 | 낮음 |
| 1 | seat hold | `SETNX seat:held:{gameID}:{seatID} userID EX=600` | 매우 큼 | 중 |
| 2 | reservation lock | `SETNX reserve:{gameID}:{seatID} userID NX EX=300` | 큼 | 중 |
| 3 | seat-sections / pricing-policies 메타 캐시 | cache-aside (TTL 5m) | 큼 | 낮음 |
| 4 | 사용자별 active hold count | Redis Hash | 중 | 낮음 |
| 5 | payment status polling → pub/sub | pub/sub | 중 | 높음 |

이 표는 **어떤 순서로 착수할지**를 결정하는 기준입니다.

`#0 seat-statuses cache`는 임팩트가 매우 크면서 구현 복잡도가 낮습니다.
기존 read 쿼리 앞단에 Redis cache-aside만 끼워 넣으면 되기 때문에, 가장 먼저 적용하기로 했습니다.
TTL 2초는 stale window를 최소화하면서도 read 부하를 크게 줄이는 선택입니다.

`#1 seat hold`와 `#2 reservation lock`은 race를 메모리에서 끝내는 핵심 변경입니다.
`SETNX` 한 번으로 동일 좌석에 대한 동시 요청 중 하나만 성공시키고, 나머지는 즉시 실패를 반환합니다.
RDS의 UNIQUE 제약에 의존할 때와 달리, 실패 응답이 ms 단위로 돌아옵니다.

`#3 메타 캐시`는 자주 바뀌지 않는 seat-sections와 pricing-policies를 TTL 5분으로 캐싱합니다.
메타 데이터 조회가 전체 read의 상당 비율을 차지하기 때문에, 단순한 cache-aside로도 부하 감소 효과가 큽니다.

`#5 payment status polling`은 임팩트는 중간이지만 pub/sub 도입과 결제 플로우 변경이 필요해 복잡도가 가장 높습니다.
선행 단계 적용 후 별도 Phase로 다루기로 했습니다.

---

## 정합성 체크 패턴

Redis-first로 전환하면 RDS와의 정합성을 별도로 보장해야 합니다.
사용할 패턴을 도메인별로 정리했습니다.

| 패턴 | 설명 | 적용처 |
|---|---|---|
| Dirty Set + Sync Worker | Redis 변경 시 dirty 셋 추가, worker가 RDS batch flush | hold/reservation, inventory |
| Reconciliation Job | 매 N분 Redis vs RDS count 비교 + drift 알림 + 자동 복구 | inventory, seat counts |
| Outbox Pattern | RDS write 시 outbox 테이블 → poller가 Redis 동기화 | order/payment 이벤트 |
| TTL Self-healing | Redis-only 캐시는 TTL 만료로 자가 회복 | seat-statuses |
| Single Source of Truth 명시 | 데이터별로 Redis vs RDS 중 진실 명확화 | 도메인 문서 |

이 패턴들은 **어떤 데이터의 진실이 어디에 있는가**를 명시하는 것에서 출발합니다.

`Dirty Set + Sync Worker`는 Redis에서 write가 일어난 키를 별도 셋에 기록하고, 백그라운드 worker가 주기적으로 RDS에 반영하는 방식입니다.
사용자 요청은 Redis에만 쓰고 즉시 응답하므로 지연이 ms 단위로 유지됩니다.
RDS 반영은 batch로 묶여서 write 부하가 급격히 줄어듭니다.

`Reconciliation Job`은 이중쓰기 구조에서 불가피하게 발생하는 drift를 주기적으로 검증합니다.
Redis 카운트와 RDS 카운트를 비교해 차이가 나면 알림을 보내고, 기준이 명확한 항목은 자동 복구합니다.

`Outbox Pattern`은 결제/주문처럼 RDS가 SoT인 이벤트를 Redis에 안전하게 반영할 때 사용합니다.
RDS 트랜잭션 안에서 outbox 테이블에 이벤트를 쓰면, poller가 이를 읽어 Redis에 반영하고 마킹합니다.
RDS write와 Redis 반영이 같은 트랜잭션 경계 안에 들어가지 않아도 최종 일관성이 보장됩니다.

`TTL Self-healing`은 Redis-only 캐시(예: seat-statuses)에만 적용합니다.
RDS가 원본이 아니더라도 TTL이 만료되면 다음 요청이 새로 채우므로 자가 회복이 가능합니다.

`Single Source of Truth 명시`는 코드 외적으로 도메인 문서에서 각 데이터의 SoT를 선언하는 규칙입니다.
"좌석 재고는 Redis", "결제 이력은 RDS" 같은 명시가 없으면, 시간이 흐를수록 이중쓰기의 방향이 뒤섞입니다.

---

## 단계별 롤아웃

한 번에 전부 바꾸면 리스크가 크기 때문에 Phase로 쪼갰습니다.

### Phase A (이번 부하 전 — 적용 완료)

- `#0 seat-statuses cache-aside` (TTL 2s)
- `#1 seat hold` (기존 distLock + Redis 인벤토리 활용)
- `#2 reservation lock` Redis `SETNX` (order create race 흡수)
- `#3 sections/pricing 메타 캐시` (TTL 5m)

Phase A는 구현 복잡도가 낮으면서 임팩트가 큰 항목만 모아서 먼저 적용했습니다.
부하테스트 재실행 전에 반영해, 변경 효과를 같은 시나리오로 측정할 수 있게 했습니다.

### Phase A 보강 (적용 완료)

- HoldSeat 후 seat-status / section 캐시 invalidation
- payment-order Redis prewarm + cache (payment cascade fix)
- PgBouncer ticketing pool 100→150, ticketing replicas 6→8, payment 2→4

Phase A를 적용하면서 드러난 부수 이슈를 보강한 항목입니다.
캐시 invalidation 누락, payment 경로의 prewarm 필요성, pool/replica 수치 조정이 포함됩니다.

### Phase B (SDD 작성 완료, 별도 PR)

- 정합성 reconciliation worker (Redis vs RDS, 5분 주기)
- 사용자별 active hold count (Redis `HINCRBY`)
- inventory dirty set 패턴을 hold/reservation까지 확장

Phase B는 정합성 보장 인프라를 본격적으로 갖추는 단계입니다.
Phase A에서는 TTL과 SETNX만으로 대부분의 경합을 흡수했지만, 장기적으로는 reconciliation worker 없이 운영할 수 없습니다.

### Phase C (SDD 작성 완료, 별도 PR)

- payment Outbox 비동기 (order create 60s timeout의 진짜 fix)
- payment status polling/SSE → pub/sub 전환
- 보상 트랜잭션 (payment 실패 시 좌석 자동 해제)

Phase C는 가장 큰 임팩트와 가장 높은 복잡도를 가진 단계입니다.
결제 플로우 자체를 비동기로 재설계하기 때문에, 별도 PR로 분리해 점진 전환합니다.

---

## Trade-offs

이번 결정이 안고 가는 트레이드오프를 명시합니다.

| 항목 | 장점 | 단점/리스크 |
|---|---|---|
| Redis-first | RDS 부하 1/100, latency ms 단위 | Redis 장애 시 영향 범위 큼 → multi-AZ + sentinel/cluster 필수 |
| TTL cache | 단순, 자가 회복 | stale window (2s~5m) — 좌석이 1초 안에 두 번 잡힐 가능 존재 |
| SETNX lock | race를 메모리에서 끝냄 | TTL 이내 결제 완료 못 하면 lock 만료 → 동일 race 재현 가능, TTL을 충분히 잡아야 함 |

**Redis-first**는 장점이 명확한 만큼 Redis 장애의 blast radius가 커집니다.
multi-AZ 구성과 sentinel/cluster 운영이 선택이 아니라 필수가 됩니다.
Redis 복구 절차와 장애 drill이 정기적으로 필요합니다.

**TTL cache**는 stale window 동안 가능한 이상 상태를 허용해야 합니다.
TTL 2초 기준이면 이론적으로 한 좌석을 2초 안에 두 번 hold할 수 있습니다.
이 가능성을 실무적으로 허용 가능한 수준으로 좁히기 위해 SETNX와 결합해 사용합니다.

**SETNX lock**의 TTL은 결제 완료 예상 시간보다 충분히 길어야 합니다.
TTL 만료 후 lock이 풀린 상태에서 결제가 도착하면 동일 좌석이 중복 판매될 수 있기 때문입니다.
reservation lock TTL을 300초로 잡은 것은 일반적인 결제 완료 시간에 여유를 더한 값입니다.

---

## 관련 기록

- `docs/load-test/2026-04-14-3000vu-queue-oneshot.md` (1차 부하)
- `docs/load-test/2026-04-14-3000vu-2nd-and-next-checklist.md` (2차 + 다음 체크리스트)
- `docs/dev-logs/2026-04-14-pgbouncer-rollout-and-load-test.md`
- `docs/dx/0001-payment-outbox-and-reconciliation-sdd.md`

---

## 다음 글 예고

이 글에서는 "왜 Redis-first로 전환하는가"라는 의사결정을 다뤘습니다.
다음 글에서는 Redis를 **Source of Truth로 채택한 이유**를 ADR 관점에서 더 깊이 다룹니다.
