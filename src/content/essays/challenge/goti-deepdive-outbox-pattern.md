---
title: "Outbox 패턴 — 두 저장소를 가로지르는 쓰기의 정합성을 보장하는 원리"
excerpt: "DB 트랜잭션 경계 안에 이벤트를 함께 기록해 dual-write의 원자성 문제를 해소하는 Outbox 패턴의 동작 원리를 설명하고, go-ti가 방향을 뒤집어 두 번 적용한 사례를 비교합니다"
category: challenge
tags:
  - go-ti
  - Redis
  - outbox-pattern
  - dual-write
  - at-least-once
  - eventual-consistency
  - concept
series:
  name: "goti-deepdive-redis"
  order: 5
date: "2026-04-14"
---

## 한 줄 요약

> 두 저장소에 독립적으로 쓰는 대신, 하나의 트랜잭션 경계 안에 "나중에 전달해야 할 이벤트"를 함께 기록하면 정합성을 보장할 수 있습니다 — 그것이 Outbox 패턴의 핵심입니다

---

## 🤔 무엇을 푸는 기술인가

### Dual-write의 원자성 문제

두 개의 저장소를 함께 쓰는 시스템에서 흔히 마주치는 문제가 있습니다 예를 들어 주문 데이터를 RDS에 저장하고, 동시에 Redis 캐시에도 반영해야 하는 경우입니다

코드를 단순하게 작성하면 이렇게 됩니다

```text
1. RDS INSERT INTO orders ... → 성공
2. Redis SET order:{id} ... → 실패 (네트워크 단절, OOM, 재시작)
```

2단계에서 실패하면 RDS에는 데이터가 있지만 Redis에는 없는 상태가 됩니다 반대로 순서를 바꿔 Redis를 먼저 쓰면 Redis에는 있지만 RDS에는 없는 상태가 됩니다 어느 쪽이든 두 저장소 사이에 **불일치**가 발생합니다

이것이 **dual-write** 문제입니다 두 쓰기 연산을 하나의 원자적 단위로 묶을 수 없기 때문에 발생합니다 각 저장소는 자신의 트랜잭션만 보장할 뿐, 두 저장소에 걸친 원자성은 보장하지 않습니다

### 분산 트랜잭션의 대안

이 문제를 해결하는 고전적 방법은 **2PC(Two-Phase Commit)** 같은 분산 트랜잭션 프로토콜입니다 그러나 2PC는 코디네이터 장애 시 양쪽이 블로킹되는 문제가 있고, 대부분의 캐시 시스템(Redis 포함)이 2PC를 지원하지 않습니다

**Outbox 패턴**은 분산 트랜잭션 없이 동일한 문제를 해결합니다 핵심 아이디어는 단순합니다

> 두 저장소에 동시에 쓰는 대신, 첫 번째 저장소의 트랜잭션 안에서 "두 번째 저장소에 전달할 이벤트"를 함께 기록합니다 별도 프로세스가 이 기록을 읽어 두 번째 저장소에 반영합니다

"첫 번째 저장소에 쓰기 + 이벤트 기록"이 하나의 트랜잭션이므로 둘 다 성공하거나 둘 다 실패합니다 이벤트가 기록됐다면 나중에 반드시 전달됩니다 — **at-least-once 전달**이 보장됩니다

---

## 🔧 동작 원리

### Outbox 테이블과 트랜잭션 경계

전통적인 Outbox 패턴에서 "이벤트 기록"은 **Outbox 테이블**에 저장됩니다 비즈니스 데이터와 같은 DB 인스턴스 안에 있으며, 같은 트랜잭션으로 묶입니다

```sql
BEGIN;
  INSERT INTO orders (id, user_id, total) VALUES (...);
  INSERT INTO outbox (event_type, payload, processed)
    VALUES ('ORDER_CREATED', '{"order_id":...}', false);
COMMIT;
```

이 두 INSERT는 하나의 트랜잭션 안에 있습니다 커밋이 성공하면 orders와 outbox 모두 존재합니다 커밋이 실패하면 둘 다 롤백됩니다 **두 저장소 사이의 원자성 문제가 동일 DB 내 트랜잭션으로 완전히 해소**됩니다

### Poller: 미처리 이벤트를 목적지로 전달

Outbox 테이블에 쌓인 이벤트는 별도의 **Poller 프로세스**가 꺼내 목적지에 전달합니다

```text
1. SELECT * FROM outbox WHERE processed = false ORDER BY id LIMIT 100
2. 각 행의 payload를 목적지(Redis, Kafka, 다른 서비스)에 전달
3. 전달 성공 시 UPDATE outbox SET processed = true WHERE id = ?
4. N초 대기 후 1로 반복
```

Poller가 재시작하거나 2단계에서 실패해도 `processed = false` 행이 남아있기 때문에 다음 폴링 주기에 재시도합니다 이것이 at-least-once 전달을 구현하는 방식입니다

같은 이벤트가 두 번 이상 전달될 수 있으므로, 목적지에서의 처리는 **멱등**해야 합니다 동일 이벤트를 두 번 처리해도 결과가 달라지지 않아야 합니다

### CDC — 폴링 없이 변경 이벤트 캡처

Poller 방식의 단점은 DB에 주기적으로 쿼리를 날린다는 점입니다 **CDC(Change Data Capture)**는 DB의 복제 로그(WAL, binlog)를 직접 읽어 이벤트를 추출합니다 Debezium 같은 도구가 이 방식을 구현합니다

CDC는 outbox 테이블을 추가 INSERT하는 대신 기존 테이블의 변경을 자동으로 캡처합니다 그러나 복제 로그 접근 권한, CDC 도구 운영 복잡도 등 설정 비용이 높습니다 Poller 방식이 충분한 규모에서는 단순한 폴링이 더 실용적입니다

### Redis Stream을 Outbox로 쓰는 패턴

Redis가 SoT(Source of Truth)인 시스템에서는 **Redis Stream**이 Outbox 역할을 합니다 RDS의 outbox 테이블 대신 Redis의 `outbox:stream`에 이벤트를 XADD로 기록합니다

```text
Lua EVALSHA (원자적):
  HSET seat:{game_id}:{section_id} ...  # 비즈니스 데이터 갱신
  XADD outbox:stream * event ORDER_CREATED payload {...}  # 이벤트 기록
```

Lua 스크립트는 Redis 서버 안에서 원자적으로 실행됩니다 비즈니스 데이터 갱신과 이벤트 기록이 분리될 수 없습니다

Consumer Group을 사용하는 `XREADGROUP`으로 이벤트를 소비하고, 처리 완료 후 `XACK`으로 확인합니다 Consumer가 재시작하면 ACK되지 않은 이벤트를 자동으로 재전달합니다 RDS outbox 테이블의 `processed` 컬럼 역할을 XACK + Consumer Group이 담당하는 셈입니다

### 두 저장소, 두 방향 — 흐름 비교

![Dual-write 실패 vs Outbox 경유 흐름 비교|tall](/diagrams/goti-deepdive-outbox-pattern-1.svg)

왼쪽은 dual-write의 실패 시나리오입니다 RDS 쓰기가 성공한 뒤 Redis 쓰기에서 크래시가 발생하면 두 저장소 사이의 불일치가 영속됩니다 재시도를 해도 RDS에 중복 INSERT 가능성이 있어 멱등성을 별도로 확보해야 합니다

오른쪽이 Outbox 패턴입니다 RDS의 단일 트랜잭션 안에 비즈니스 데이터와 Outbox 행을 함께 삽입합니다 Poller가 미처리 행을 읽어 Redis에 반영하고, 성공 시 `processed = true`로 마킹합니다 크래시 후 재시작해도 `processed = false` 행이 남아 재시도가 자동으로 이뤄집니다 **at-least-once 전달이 구조적으로 보장**됩니다

### Outbox와 Write-Behind의 차이

이전 글에서 다룬 **write-behind + dirty set** 패턴과 혼동하기 쉽습니다 두 패턴의 목적이 다릅니다

| 패턴 | 목적 | 트리거 | at-least-once |
|---|---|---|---|
| Write-Behind | DB I/O를 쓰기 경로에서 제거 (latency 감소) | dirty set 키 목록 | 별도 보장 필요 (멱등 UPSERT + reconciliation) |
| Outbox | 두 저장소 간 정합성 보장 | outbox 테이블 / Stream 행 | 구조적으로 보장 (미처리 행 재시도) |

write-behind는 "언제 DB에 쓸 것인가"를 지연시키는 패턴입니다 Outbox는 "두 저장소를 어떻게 일관되게 유지할 것인가"를 해결하는 패턴입니다 둘은 함께 쓸 수 있으며, go-ti에서도 도메인에 따라 두 패턴이 별도로 또는 조합해서 사용됩니다

---

## 📐 세부 동작과 옵션

### go-ti에서 방향이 뒤집힌 이유

go-ti에서 Outbox 패턴은 두 ADR에서 등장하는데, 흐름 방향이 정반대입니다

![go-ti Outbox 방향 대비 — RDS→Redis(ADR 0014) vs Redis→RDS(ADR 0017)|tall](/diagrams/goti-deepdive-outbox-pattern-2.svg)

**ADR 0014 (RDS → Redis 방향)**: RDS가 SoT이던 시기입니다 order/payment 이벤트를 RDS 트랜잭션으로 처리하고, 동일 트랜잭션 안에서 outbox 테이블에 이벤트를 삽입합니다 Poller가 주기적으로 미처리 행을 읽어 Redis 캐시에 반영합니다 캐시 정합성 보장이 목적입니다

**ADR 0017 (Redis → RDS 방향)**: Redis가 SoT로 전환된 이후입니다 Lua 스크립트 안에서 Redis 비즈니스 데이터를 갱신하고, 동일 Lua 실행 안에서 `outbox:stream`에 XADD합니다 `goti-outbox-worker`가 XREADGROUP으로 이벤트를 소비해 RDS에 idempotent UPSERT합니다 RDS 영속화 보장이 목적입니다

같은 패턴이지만 SoT의 위치가 바뀌면서 "어디에 outbox를 두는가"와 "무엇을 전달하는가"가 모두 반전됩니다 패턴의 핵심 구조(트랜잭션 경계 + 이벤트 기록 + 비동기 소비)는 동일합니다

하단 비교표에서 두 방향의 차이를 한눈에 볼 수 있습니다 SoT, outbox 저장소, 소비자, 동기화 방향, 원자성 보장 수단이 모두 대칭적으로 반전됩니다

### at-least-once와 멱등 처리

Outbox 패턴은 at-least-once를 보장합니다 — 같은 이벤트가 두 번 이상 전달될 수 있다는 의미입니다 이를 안전하게 처리하려면 소비자 쪽에서 **멱등 처리**가 필수입니다

PostgreSQL에서 RDS 영속화를 할 때는 `INSERT ... ON CONFLICT DO UPDATE`(UPSERT) 패턴으로 중복 이벤트를 안전하게 흡수합니다

```sql
INSERT INTO orders (id, user_id, total, status)
VALUES ($1, $2, $3, $4)
ON CONFLICT (id) DO UPDATE
  SET status = EXCLUDED.status,
      updated_at = NOW();
```

Redis에서 캐시를 반영할 때는 `SET key value NX`보다 `SET key value` (무조건 덮어쓰기)를 씁니다 같은 이벤트를 두 번 처리해도 결과가 동일합니다

### 처리 보장 수준별 선택

| 보장 수준 | 구현 | 특성 |
|---|---|---|
| at-most-once | 이벤트 전달 후 즉시 삭제 | 전달 실패 시 유실, 구현 단순 |
| at-least-once | 처리 확인 후 삭제(Outbox 패턴) | 중복 가능, 멱등 처리 필요 |
| exactly-once | 분산 트랜잭션 또는 idempotency key 조합 | 구현 복잡, 높은 오버헤드 |

대부분의 실무 시스템은 **at-least-once + 멱등 처리**로 effectively-once를 구현합니다 완전한 exactly-once는 구현 비용이 높고 성능 트레이드오프가 큽니다

### Outbox 행 정리 (Pruning)

Outbox 테이블은 지속적으로 쌓입니다 `processed = true` 행을 주기적으로 삭제하지 않으면 테이블이 무한 증가합니다

```sql
DELETE FROM outbox
WHERE processed = true
  AND created_at < NOW() - INTERVAL '7 days';
```

삭제 주기는 재시도 가능 창(최근 N일 이벤트 재생 필요 시간)을 고려해 결정합니다 Redis Stream에서는 `XTRIM outbox:stream MAXLEN ~ 10000`으로 오래된 항목을 자동 정리합니다

---

## 🧩 go-ti에서는

go-ti 티켓팅 플랫폼은 3000 VU 부하에서 seat_statuses hot path가 500~967ms를 기록했습니다 ADR 0014는 병목 완화를 위해 Redis-first 전환을 결정하면서, order/payment 이벤트의 RDS→Redis 동기화 경로에 Outbox 패턴을 적용하는 Phase C를 설계했습니다

ADR 0017에서는 Redis를 SoT로 완전 전환하면서 방향이 바뀌었습니다 Lua EVALSHA 안에서 비즈니스 데이터 갱신과 `XADD outbox:stream`을 원자적으로 실행합니다 `goti-outbox-worker`가 XREADGROUP으로 이벤트를 소비해 RDS에 UPSERT합니다 D4(orders Redis SoT) 완료 후 D5a(outbox-worker)가 미구현 상태라 RDS orders 영속이 비어있는 구간이 발생했고, outbox-worker 구현이 최우선 후속 과제가 되었습니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [Redis as Source of Truth 전면 채택 (ADR)](/logs/goti-redis-sot-adoption-adr)에 정리했습니다

---

## 📚 핵심 정리

- Outbox 패턴은 dual-write의 원자성 문제를 분산 트랜잭션 없이 해결합니다 하나의 트랜잭션 안에 비즈니스 데이터와 이벤트를 함께 기록해 "전달이 필요한 이벤트가 기록됐다면 반드시 전달된다"를 구조적으로 보장합니다
- Poller는 outbox 미처리 행을 주기적으로 읽어 목적지에 전달합니다 `processed` 마킹 후 재시작해도 미처리 행이 남아있어 at-least-once 전달이 자동으로 재개됩니다
- Redis Stream을 Outbox로 쓰면 Redis SoT 시스템에서 Lua 스크립트로 데이터 갱신과 이벤트 기록을 원자적으로 묶을 수 있습니다 XREADGROUP + XACK이 처리 보장을 담당합니다
- at-least-once 전달은 소비자 쪽의 멱등 처리(UPSERT, SET 덮어쓰기)와 짝을 이룹니다 중복 이벤트가 와도 결과가 동일하면 effectively-once 동작이 됩니다
- write-behind + dirty set(이전 글)은 쓰기 latency 감소가 목적이고, Outbox 패턴은 두 저장소 간 정합성 보장이 목적입니다 둘은 역할이 다르며 함께 쓸 수 있습니다
