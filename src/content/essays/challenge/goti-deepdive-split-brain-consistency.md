---
title: "split-brain과 복제 정합성 — 양쪽 쓰기를 막고 멱등으로 중복을 흡수하는 원리"
excerpt: "네트워크 분단이 복제 환경에서 split-brain을 만드는 방식, at-least-once 전송이 왜 중복을 부르는지, UUID PK가 멱등으로 중복을 흡수하는 원리, 그리고 양방향 복제에서의 충돌 해소를 설명합니다"
category: challenge
tags:
  - go-ti
  - pglogical
  - split-brain
  - idempotency
  - conflict-resolution
  - concept
series:
  name: "goti-deepdive-database"
  order: 10
date: "2026-04-19"
---

## 한 줄 요약

> 복제 환경에서 split-brain은 네트워크 분단 시 양쪽이 독립적으로 쓰기를 받으면서 발생하고, at-least-once 재전송이 만들어내는 중복은 멱등(idempotency) 설계로 흡수합니다

---

## 🤔 무엇을 푸는 기술인가

단일 DB 인스턴스에는 없지만 복제 환경에서 반드시 마주치는 두 가지 문제가 있습니다

첫 번째는 **split-brain**입니다 Publisher와 Subscriber 사이 네트워크가 끊어졌을 때, Subscriber를 읽기 전용에서 읽기-쓰기로 전환하면 두 인스턴스 모두 독립적으로 쓰기를 받게 됩니다 네트워크가 회복되면 같은 PK로 서로 다른 데이터가 쌓여 있는 상황이 됩니다

두 번째는 **at-least-once 중복**입니다 pglogical을 포함한 대부분의 논리 복제 엔진은 exactly-once가 아니라 at-least-once를 보장합니다 Subscriber가 이벤트를 수신하고 ACK를 보내기 전에 연결이 끊어지면 Publisher는 동일 이벤트를 다시 보냅니다 중복 이벤트가 Subscriber에 두 번 적용되면 데이터 오염이 생깁니다

이 두 문제는 모두 **정합성(consistency)** 문제의 변형입니다 split-brain은 충돌 예방, at-least-once는 멱등 설계로 각각 접근합니다

> 이 글은 복제 메커니즘 자체(WAL 논리 디코딩, 복제 슬롯, publication/subscription)는 이미 `goti-deepdive-pglogical-logical-replication`에서 다뤘으므로 반복하지 않습니다 시퀀스 드리프트 상세도 동일 시리즈의 별도 글에서 다루며, 이 글은 split-brain과 정합성·멱등에 집중합니다

---

## 🔧 동작 원리

### split-brain이 발생하는 메커니즘

단방향 복제 구성에서 Subscriber는 보통 `default_transaction_read_only=on`으로 설정하여 쓰기를 원천 차단합니다 이 설정 하나가 split-brain 예방의 핵심입니다

문제는 Failover 절차에서 발생합니다 Publisher에 장애가 생기면 운영자는 Subscriber를 새 Primary로 승격시켜야 합니다 `default_transaction_read_only=off`로 변경하거나 세션 레벨에서 `SET default_transaction_read_only = off`를 실행하면 Subscriber는 쓰기를 받기 시작합니다

이 시점에서 **기존 Publisher도 살아있다면** 두 인스턴스가 동시에 쓰기를 받는 split-brain 상태가 됩니다 TCP/IP 연결이 끊어진 것이지 Publisher가 죽은 것이 아닐 수 있기 때문입니다 네트워크 분단(network partition)이 가장 위험한 이유가 여기 있습니다

![split-brain 발생 시퀀스](/diagrams/goti-deepdive-split-brain-consistency-1.svg)

위 다이어그램은 split-brain이 발생하고 재합류 시 충돌로 이어지는 4단계 흐름입니다

**① 정상 상태**에서 GCP VM(Publisher)은 쓰기를 받고 AWS RDS(Subscriber)로 단방향 복제 스트림을 흘립니다 Subscriber는 읽기 전용으로 운영 중이라 직접 쓰기가 들어오지 않습니다

**② 네트워크 분단** 단계에서 두 인스턴스 사이 연결이 끊어집니다 Publisher는 새 쓰기를 계속 받고, 운영자가 Subscriber의 `read_only`를 수동으로 해제하면 Subscriber도 독립적으로 쓰기를 받기 시작합니다

**③ split-brain** 상태에서는 양쪽 인스턴스에 동일한 PK 값(예: order #501)으로 서로 다른 트랜잭션이 기록됩니다 GCP VM의 LSN 컨텍스트와 AWS RDS의 로컬 변경이 완전히 독립적으로 진행됩니다

**④ 재합류** 시 Publisher는 분단 동안 쌓인 복제 스트림을 Subscriber에게 밀어 넣으려 하지만, Subscriber에는 이미 같은 PK를 가진 행이 존재합니다 충돌 해소 정책이 트리거되고, 정책에 따라 어느 한쪽 데이터가 손실될 수 있습니다

### split-brain 탐지의 어려움

split-brain이 까다로운 이유는 **탐지가 어렵다**는 점입니다 각 인스턴스 입장에서는 자신이 유일한 Primary인지 Standby가 일시적으로 연결을 잃은 상태인지 알 방법이 없습니다

실용적인 탐지 방법은 두 가지입니다

**앱 수준 writable check**: 각 인스턴스에 하트비트 쿼리를 주기적으로 실행하고, 두 인스턴스 모두 쓰기 가능 상태라면 알림을 보냅니다 구현이 단순하지만 하트비트 주기만큼 감지 지연이 발생합니다

**pg_stat_replication 모니터링**: Publisher의 `pg_stat_replication` 뷰에서 Subscriber 연결 상태를 확인합니다 슬롯이 inactive 상태인데 Subscriber가 쓰기를 받고 있다면 split-brain 의심 신호입니다

```sql
-- Publisher에서 복제 슬롯 상태 확인
SELECT slot_name, active, restart_lsn, confirmed_flush_lsn
FROM pg_replication_slots;

-- active = false + 상당한 WAL 보존량이 쌓여 있으면 경보
```

Patroni 같은 HA 클러스터 도구는 STONITH(Shoot The Other Node In The Head) 메커니즘으로 split-brain을 원천 방지합니다 네트워크 분단 시 한쪽을 강제로 셧다운시켜 두 Primary가 동시에 존재하는 상태를 막습니다 pglogical 단독 구성에서는 이 레이어가 없어 운영 절차와 모니터링에 의존해야 합니다

### at-least-once 전송이 왜 중복을 만드는가

pglogical은 at-least-once 전달을 보장합니다 이는 정확히 **"손실은 없다, 하지만 중복은 있을 수 있다"**는 뜻입니다

동작 원리는 다음과 같습니다 Publisher는 복제 슬롯이 추적하는 LSN(Log Sequence Number)을 기준으로 이벤트를 보냅니다 Subscriber는 이벤트를 적용한 후 ACK 메시지로 자신이 처리한 LSN을 Publisher에게 돌려보냅니다 Publisher는 ACK를 받은 LSN까지는 전송 완료로 간주하고 해당 WAL 세그먼트 보존 의무에서 해방됩니다

문제는 **ACK가 Publisher에 도달하기 전에 연결이 끊어지는 경우**입니다

```text
[정상 흐름]
Publisher → LSN=100 이벤트 전송 → Subscriber 적용 → ACK(LSN=100) 반환
Publisher: "LSN=100 확인됨, 다음부터 전송"

[중단 흐름]
Publisher → LSN=100 이벤트 전송 → Subscriber 적용 → 연결 끊김
Publisher: "ACK 없음, LSN=99부터 재전송"
→ Subscriber: LSN=100 이벤트를 두 번 수신
```

Subscriber는 이미 적용된 이벤트를 다시 받습니다 이것이 at-least-once의 본질이고, 왜 멱등 설계가 필수인지의 이유입니다

### UUID PK가 자연 멱등인 이유

![at-least-once 재전송과 UUID PK 멱등 흡수](/diagrams/goti-deepdive-split-brain-consistency-2.svg)

위 다이어그램은 네트워크 중단 후 동일 INSERT 이벤트가 두 번 전송될 때 UUID PK가 중복을 흡수하는 과정을 5단계로 보여줍니다

**① Publisher가 INSERT 이벤트를 생성**합니다 orders 테이블에 `id=UUID-abc, status='paid'` 행을 삽입하는 트랜잭션이 WAL에 기록됩니다

**② Subscriber가 이벤트를 적용**하고 ACK(LSN=100)를 전송합니다 Subscriber의 orders 테이블에 UUID-abc 행이 삽입됩니다

**③ 네트워크 중단**으로 ACK가 Publisher에 도달하지 못합니다 Publisher의 슬롯은 여전히 LSN=99 이전을 가리킵니다

**④ Publisher가 재연결 후 동일 INSERT를 재전송**합니다 이미 적용된 것과 완전히 동일한 이벤트입니다

**⑤ Subscriber에서 PK 충돌이 감지**됩니다 `id=UUID-abc` 행이 이미 존재하기 때문입니다 여기서 충돌 해소 정책이 결과를 결정합니다

핵심은 UUID PK의 특성입니다 UUID는 전 세계적으로 유일한 128비트 식별자로, 동일한 트랜잭션은 항상 동일한 UUID를 가집니다 중복 이벤트가 도달해도 **"같은 행을 또 넣으려 한다"**는 사실이 명확해져서 충돌 해소 정책이 `apply_changes`(기본값) 또는 `skip_transaction`으로 조용히 건너뛸 수 있습니다

정수 SEQUENCE PK라면 상황이 달라집니다 Publisher의 `nextval()`이 이미 101을 반환한 상황에서 Subscriber가 재전송된 INSERT를 받으면, Subscriber의 PK 시퀀스 위치에 따라 충돌이 발생하거나 발생하지 않을 수 있습니다 충돌이 발생하지 않는 경우 더 위험합니다 같은 내용의 행이 다른 PK로 두 번 삽입될 수 있기 때문입니다

이 속성을 **자연 멱등(natural idempotency)**이라고 부릅니다 UUID PK를 가진 테이블은 별도의 중복 제거 로직 없이도, pglogical의 충돌 해소 정책이 at-least-once 중복을 흡수해줍니다 결과적으로 at-least-once + 멱등 PK 조합은 "exactly-once와 동일한 의미론"을 달성합니다

### 양방향 복제에서의 충돌 해소

단방향 복제에서 Subscriber를 읽기 전용으로 유지하면 충돌 문제를 근본적으로 회피할 수 있습니다 하지만 Failback 시나리오에서는 상황이 달라집니다 ADR-0020의 역방향 복제 전환 과정처럼, 일시적으로 양방향 복제(bidirectional replication) 상태가 됩니다

양방향 복제에서는 Publisher → Subscriber 방향과 Subscriber → Publisher 방향 모두 이벤트가 흐릅니다 이때 **무한 루프** 문제가 발생합니다 A의 변경이 B에 복제되고, B에서 적용된 변경이 다시 A로 복제되는 사이클입니다

pglogical은 각 이벤트에 **origin 정보**를 붙여 이 루프를 차단합니다 B에서 A로 넘어온 이벤트에는 "이 이벤트의 원천은 A다"라는 표시가 있고, A의 apply worker는 자신이 origin인 이벤트를 재적용하지 않습니다

그러나 pglogical 2.x는 **공식 양방향 복제를 미지원**합니다 `origin` 필터링이 동작하더라도 양쪽에서 동시에 같은 행을 수정하는 진짜 충돌 시나리오에서는 명시적인 충돌 해소 정책이 없습니다 pglogical 3(상용) 또는 EDB BDR(Bi-Directional Replication)이 이 시나리오를 정식 지원합니다

pglogical 2.x에서 일시적 양방향이 불가피할 때의 실용적 접근은 다음과 같습니다

| 시나리오 | 권장 접근 |
|---|---|
| Failback 중 일시적 양방향 | 쓰기 트래픽을 한쪽으로만 라우팅, 다른 쪽은 새 이벤트 발생 최소화 |
| 충돌 발생 시 | `last_update_wins` 정책 + 타임스탬프 컬럼으로 최신 값 우선 |
| 충돌 허용 불가 도메인 | 트랜잭션 완료 전 advisory lock 또는 앱 레벨 분산 락 |

충돌 해소 정책을 선택할 때는 도메인의 비즈니스 규칙을 먼저 확인해야 합니다 payments, orders처럼 **한 번만 실행**되어야 하는 도메인에서 `last_update_wins`는 위험합니다 같은 결제 행이 타임스탬프 차이로 잘못된 상태로 덮어써질 수 있기 때문입니다

---

## 📐 세부 동작과 옵션

### 충돌 해소 정책 비교

pglogical의 충돌 해소 정책은 `pglogical.alter_subscription_set_conflict_resolution()`으로 지정합니다

| 정책 | 동작 | 적합한 경우 |
|---|---|---|
| `error` | 에러를 내고 복제 중단 | 충돌을 허용해서는 안 되는 도메인 |
| `apply_changes` | 충돌 무시, 들어온 변경 적용 (기본값) | 단방향에서 Subscriber가 독립 쓰기 없는 경우 |
| `skip_transaction` | 충돌이 있는 트랜잭션 전체 skip | 멱등 PK 환경에서 at-least-once 중복 흡수 |
| `last_update_wins` | `updated_at` 컬럼 기준 최신 값 우선 | 마지막 상태만 중요한 상태 테이블 |

UUID PK 환경에서 재전송 중복 흡수를 목적으로 할 때는 `skip_transaction`이 의미론적으로 가장 정확합니다 `apply_changes`는 "충돌하는 변경을 덮어쓴다"는 의미라서 at-least-once 중복과 의미적으로 맞지 않습니다

### read_only 제어의 한계

`default_transaction_read_only=on`은 split-brain 예방의 핵심 파라미터지만 완벽하지 않습니다

```sql
-- DB 레벨 read_only는 세션에서 우회 가능
SET LOCAL default_transaction_read_only = off;

-- 이 이후의 DML은 실행됨
INSERT INTO orders (id, status) VALUES (gen_random_uuid(), 'paid');
```

`SET LOCAL`은 현재 트랜잭션 안에서만 유효하지만, 이를 허용하면 앱 또는 악의적 세션이 read_only를 우회할 수 있습니다 보완 방법은 **DB 레벨 role에서 `SET` 권한을 revoke**하거나, Subscriber 접속 user에 `ALTER USER ... NO SET` 제약을 두는 것입니다

### `pg_replication_slots`로 split-brain 조기 감지

복제 슬롯 모니터링은 split-brain 탐지의 보조 신호가 됩니다

```sql
-- Subscriber의 마지막 확인 LSN과 현재 WAL 위치 차이
SELECT
  slot_name,
  active,
  pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn) AS lag_bytes
FROM pg_replication_slots;
```

슬롯이 `active = false`이면서 `lag_bytes`가 수백 MB 이상 쌓인다면 Subscriber가 연결을 잃고 복제가 멈춘 것입니다 이 상태에서 Subscriber가 쓰기를 받기 시작하면 split-brain의 전제 조건이 갖춰집니다 `lag_bytes > 임계값 AND active = false` 조건에 알림을 걸면 조기 경보가 가능합니다

---

## 🧩 go-ti에서는

go-ti에서는 AWS RDS(Subscriber)의 `default_transaction_read_only=on`을 split-brain 예방의 주요 수단으로 사용했습니다 단, ADR-0021이 C2 항목으로 명시했듯 세션 레벨 우회(SET LOCAL)를 앱 수준에서 막는 role 제한은 도입되지 않았고, split-brain 탐지·알림 자동화도 Tier 1 미이행 항목으로 남아 있습니다

정합성 측면에서 긍정적인 부분은 orders/payments 핵심 테이블이 UUID PK를 사용한다는 점입니다 pglogical이 at-least-once로 이벤트를 재전송해도, UUID PK와 `apply_changes` 충돌 정책의 조합이 중복 이벤트를 자연 흡수합니다 ADR-0021 C5 항목이 이를 "완화(🟢)" 상태로 분류한 근거입니다

양방향 복제는 ADR-0020의 Failback 절차에서 역방향 subscription을 임시로 생성하는 방식으로만 사용하며, 정상 운영 중 양쪽 동시 쓰기 시나리오는 의도적으로 회피합니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [Multi-Cloud pglogical 복제 알려진 한계와 개선 로드맵](/logs/goti-pglogical-mr-replication-gaps-adr)에 정리했습니다

---

## 📚 핵심 정리

- split-brain은 네트워크 분단 시 양쪽 인스턴스가 동시에 쓰기를 받으면 발생합니다 Subscriber를 `default_transaction_read_only=on`으로 유지하는 것이 가장 단순한 예방책이지만, 세션 레벨 우회가 가능해 앱 수준 role 제한을 병행해야 합니다
- pglogical의 at-least-once 보장은 ACK 유실 시 이벤트를 재전송합니다 중복 이벤트가 두 번 적용되면 데이터 오염이 생기므로, Subscriber 측 테이블에 멱등 설계가 필수입니다
- UUID PK는 동일 트랜잭션의 재전송이 항상 동일 PK로 충돌하도록 만들어 충돌 해소 정책이 중복을 조용히 흡수하게 합니다 at-least-once + UUID PK 조합은 effectively exactly-once 의미론을 달성합니다
- 양방향 복제(Failback 시나리오 포함)에서 pglogical은 origin 필터링으로 무한 루프를 막지만, 진짜 동시 충돌 해소는 공식 미지원입니다 충돌 허용 불가 도메인에서는 양방향 동시 쓰기 자체를 회피하는 아키텍처가 더 안전합니다
- split-brain 탐지의 실용적 방법은 `pg_replication_slots` 슬롯 비활성 + lag 증가를 모니터링하고 알림을 거는 것입니다 Patroni/STONITH가 없는 환경에서는 이 모니터링이 최후 방어선이 됩니다
