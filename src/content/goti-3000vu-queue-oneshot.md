---
title: "3000VU Oneshot 부하테스트 — 대기열은 통과, 결제가 무너졌다"
excerpt: "3000VU Oneshot 시나리오에서 대기열 통과율 100%였지만 실제 결제 성공률은 15.6%에 그쳤습니다. 병목이 큐가 아니라 결제 path에 있다는 사실이 드러난 검증 결과입니다."
category: challenge
tags:
  - go-ti
  - Queue
  - LoadTest
  - k6
  - 3000VU
  - Oneshot
series:
  name: "goti-queue-poc"
  order: 10
date: "2026-04-14"
---

## 한 줄 요약

> 3000VU Oneshot 부하테스트에서 `queue_pass_rate`는 100%를 기록했지만 `goti_ticket_success_rate`는 15.60%(468/3000)에 머물렀습니다. 병목은 대기열이 아니라 결제 path에 있었고, order create가 60초 timeout에 걸리면서 hold 만료 → 좌석 탈취 race가 연쇄적으로 발생했습니다.

## Impact

- **대상 환경**: prod (AWS EKS, RDS PostgreSQL 16, ElastiCache Redis)
- **테스트 게임**: 2026-04-16 KIA 홈 경기, `gameId=acfe6b0f-fb0f-4c0a-8d19-9063e5025428`
- **큐 max_capacity**: 1000
- **핵심 지표**: `goti_ticket_success_rate` 15.60%, `http_req_duration p95` 2.88s, `goti_order_creation_ms p95` 60s timeout

---

## 🔥 문제: 대기열은 뚫렸는데 결제가 막혔다

### 테스트 시나리오

`queue-oneshot` 시나리오는 1 VU가 1 iteration을 실행하는 대규모 동시 진입 패턴입니다. 3000명이 한꺼번에 몰리는 오픈전 상황을 재현합니다.

- **도구**: k6 0.56.0 on EC2 (i-0f5fcae00e8d06a77)
- **VU**: 3000 / 30분 max
- **실행 시간**: 3분 44초
- **완료 iterations**: 3000 / 3000 (100%)

### 사전 변경 사항

이번 테스트 직전에 두 가지 주요 변경이 적용됐습니다.

첫째, PgBouncer를 최초로 도입했습니다. session 모드, `default_pool_size=80`, `max_client_conn=5000` 설정으로 6개 v2 서비스를 모두 PgBouncer 경유로 전환했습니다. 각 서비스는 `dbname=goti_{svc}` 형식으로 DB를 분리했습니다.

둘째, ticketing 서비스에 `seat_holds`와 `grades` 대상 TTL cache(30s in-memory)를 붙였습니다. 좌석 잠금과 등급 정보 조회를 인메모리에서 먼저 확인해 DB 부하를 줄이는 목적이었습니다.

### 측정된 결과

| 지표 | 값 | 임계 |
|---|---|---|
| 완료 iterations | 3000 / 3000 | 100% |
| 실행 시간 | 3분 44초 | — |
| **goti_ticket_success_rate** | **15.60% (468/3000)** | 실패 |
| http_req_failed | 4.40% (3980/90415) | — |
| http_req_duration p95 | 2.88s | 실패 (목표 < 1s) |
| **goti_order_creation_ms p95** | **60s** | 실패 (timeout) |
| goti_payment_ms p95 | 10.53s | 실패 |
| goti_seat_selection_ms p95 | 9.86s | 실패 |
| queue_pass_rate | 100% | 통과 |
| queue_enter_ms p95 | 1.87s | 통과 |
| queue_wait_duration_ms p95 | 1m38s | — |
| queue_immediate_pass_rate | 37.12% (998/2688) | — |
| queue_seat_enter_ms p95 | 2.36s | 통과 |
| queue_status_ms p95 | 73ms | 통과 |
| iteration_duration p95 | 2m48s | — |
| queue_e2e_duration_ms p95 | 2m48s | — |
| http_reqs | 90,415 (402 RPS) | — |
| data_received | 234 MB (1.0 MB/s) | — |

이 표에서 주목할 지점을 하나씩 풀어보겠습니다.

대기열 지표는 전부 녹색입니다. `queue_pass_rate=100%`이고 `queue_enter_ms p95=1.87s`, `queue_status_ms p95=73ms`로 큐 자체는 3000VU를 감당했습니다. `queue_immediate_pass_rate=37.12%`는 대기 없이 바로 통과한 비율로, 큐가 버퍼 역할을 충분히 수행한 흔적입니다.

반면 결제 path 쪽 지표는 모두 붉은색입니다. `goti_ticket_success_rate=15.60%`는 최종 결제에 성공한 VU가 전체의 1/6에 불과했다는 뜻입니다. `goti_order_creation_ms p95=60s`는 절반 이상의 주문이 60초 timeout에 걸렸다는 의미로, 가장 심각한 신호입니다.

---

## 🤔 원인: 결제 path의 트랜잭션 지연과 좌석 탈취 race

### 핵심 패턴

테스트 도중 관측된 패턴은 다섯 가지로 요약됩니다.

1. 대기열 통과는 100%인데 실제 결제 완료는 15.6%로, 병목은 **결제 path**에 있습니다.
2. order create 60s timeout이 다수 발생했습니다. 트랜잭션 내부의 호출 지연이 누적된 결과입니다.
3. `ORDER_SEAT_ALREADY_EXISTS` (409) 응답이 반복됐습니다. 결제 시간이 초과되어 hold가 만료되면서 다른 VU가 해당 좌석을 탈취하는 race가 생겼습니다.
4. `duplicate key violates unique constraint` 오류가 발생했습니다. seat reservation을 동시 insert하면서 유니크 제약에 충돌했습니다.
5. PgBouncer pool 활용율을 보면 ticketing만 peak에 active 35/80 + waiting 10이었고, 다른 서비스는 모두 한산했습니다.

### PgBouncer 활용율이 알려준 사실

다른 서비스는 pool이 거의 비어있었는데 ticketing만 pool 대기가 발생했습니다. 이는 병목이 DB 커넥션 고갈 자체가 아니라 **ticketing 트랜잭션 내부의 긴 작업**에 있다는 뜻입니다. 커넥션을 빨리 반환하지 못해 풀이 쌓여가는 상태였습니다.

### EXPLAIN으로 확인한 plan 자체는 정상

의심 가는 쿼리를 직접 분석했습니다.

```sql
SET search_path TO ticketing_service;
EXPLAIN (ANALYZE, BUFFERS)
SELECT s.id, COALESCE(ss.status::text,'AVAILABLE')
FROM seats s
LEFT JOIN seat_statuses ss
  ON ss.seat_id=s.id AND ss.game_schedule_id='acfe6b0f-...'
WHERE s.section_id='b0010001-...'
LIMIT 200;
-- Execution Time: 1.022 ms (Index Scan + Nested Loop)
```

단일 실행 시 1.022ms입니다. Index Scan + Nested Loop로 plan 자체는 완전히 정상입니다.

그런데 부하 시에는 같은 쿼리 패턴이 5~10초씩 걸렸습니다. 원인은 쿼리 자체가 아니라 외부 요인들입니다. PgBouncer에서 커넥션을 받기까지의 대기, 부하 직후의 cold buffer cache, Istio sidecar의 오버헤드 등이 합쳐져 전체 지연을 만들었습니다.

### DB 통계 부재 발견

테스트 도중 더 심각한 사실을 발견했습니다. 모든 hot table의 `pg_stat_user_tables.n_live_tup`이 0이었습니다. ANALYZE가 한 번도 실행되지 않았다는 흔적입니다.

가장 충격적이었던 것은 `seat_statuses` 테이블입니다. 실제 크기는 7.5GB인데 통계상으로는 live tup이 0으로 표기됐습니다. 플래너가 이 테이블을 비어있는 것으로 판단하고 plan을 짜면, 실제 데이터량과 맞지 않는 비효율 plan이 나올 수 있습니다.

---

## ✅ 해결: ANALYZE + 커넥션 재분배

부하 테스트 직후 세 가지 조치를 적용했습니다.

### 1. 9개 hot table ANALYZE 수행

```sql
ANALYZE ticketing_service.seats;
ANALYZE ticketing_service.seat_statuses;
ANALYZE ticketing_service.seat_holds;
-- ... 총 9개 테이블
```

부하 직후 즉시 ANALYZE를 돌려 플래너에게 올바른 통계를 제공했습니다. 이제 플래너는 `seat_statuses`가 7.5GB라는 사실을 인식합니다.

### 2. 서비스별 max conns 하향

```yaml
TICKETING_DATABASE_MAX_CONNS: 10  # 18 → 10
```

ticketing 서비스의 애플리케이션 단 커넥션 수를 18에서 10으로 줄였습니다. PgBouncer가 앞단에 있으므로 애플리케이션이 커넥션을 많이 쥘 이유가 없습니다. 오히려 PgBouncer 레벨에서 관리하는 편이 효율적입니다.

### 3. PgBouncer per-db pool override

```ini
[databases]
goti_ticketing = pool_size=100
```

ticketing DB에만 pool_size를 100으로 override했습니다. peak 시 active 35 + waiting 10 상황을 고려하면 default 80으로는 여유가 부족합니다. 다른 서비스는 default 80을 그대로 두고 ticketing만 용량을 늘렸습니다.

---

## 📚 배운 점

### 큐 통과율과 결제 성공률은 독립적인 지표다

대기열 설계가 완벽해도 결제 path가 막히면 최종 지표는 무너집니다. 이번 테스트에서 `queue_pass_rate=100%`였지만 `goti_ticket_success_rate`는 15.60%였습니다. 대기열은 트래픽 조절의 도구일 뿐이고, 실제 비즈니스 완료율은 결제/DB/트랜잭션의 복합 결과입니다.

부하테스트 지표를 볼 때는 **입구(enter) 지표와 출구(success) 지표를 분리**해 평가해야 합니다. 입구만 보면 시스템이 잘 돌아간다고 착각할 수 있습니다.

### 60초 timeout은 hold 만료 race를 유발한다

order create가 60초 timeout에 걸리면 이미 잡혀있던 `seat_hold`도 만료 시간이 지납니다. 그 사이 다른 VU가 해당 좌석에 접근하면 `ORDER_SEAT_ALREADY_EXISTS` (409)가 반환되거나 unique constraint 위반이 생깁니다.

즉 주문 지연은 단순히 UX 문제가 아니라 **race condition의 원인**입니다. order creation의 p95를 5초 이하로 낮춰야 이 경로가 안정화됩니다.

### plan이 정상이어도 부하 시 지연은 별도로 본다

EXPLAIN ANALYZE에서 1ms로 나오는 쿼리가 부하 중에는 5~10초씩 걸릴 수 있습니다. 부하 시 지연의 원인은 쿼리 자체가 아니라 커넥션 대기, cold cache, sidecar 오버헤드 같은 환경 요인입니다.

성능 분석 시 `EXPLAIN ANALYZE의 단일 실행 시간 = 부하 시 쿼리 지연`이라는 등식을 만들지 않아야 합니다. 두 지표는 완전히 다른 것을 측정합니다.

### ANALYZE는 초기 세팅 단계에서 반드시 확인한다

`pg_stat_user_tables.n_live_tup=0`이면 통계가 없는 것입니다. 7.5GB 테이블이 0 live tup으로 표기되면 플래너의 판단이 어긋납니다. 프로덕션 부하테스트 전 체크리스트에 **ANALYZE 실행 여부 확인**을 포함해야 합니다.

### PgBouncer 도입 시 애플리케이션 max conns를 재조정한다

PgBouncer가 앞단에 들어오면 애플리케이션은 많은 커넥션을 쥘 필요가 없습니다. 오히려 풀이 이중으로 존재하면 리소스만 낭비됩니다. PgBouncer 기준으로 pool_size를 조절하고, 애플리케이션 쪽 max conns는 하향하는 방향이 맞습니다.

---

## 다음 테스트 가설

- **목표 1**: `goti_order_creation_ms p95 < 5s`
- **목표 2**: `goti_ticket_success_rate > 60%`
- **계획**: 위 두 지표가 여전히 낮으면 payment 호출과 order tx 코드 path를 Tempo trace로 추적합니다. EXPLAIN 레벨에서 쿼리는 이미 정상이므로, 다음 단계는 애플리케이션 코드 내부의 동기 호출과 대기 구간을 가시화하는 것입니다.
