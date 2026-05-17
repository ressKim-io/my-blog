---
title: "pglogical replication set — 복제 범위 제어와 시퀀스 드리프트"
excerpt: "pglogical의 replication set이 테이블을 어떻게 그룹화해 복제 범위를 제어하는지, 시퀀스가 last-value 기반으로 복제되어 Failover 직후 PK 중복 위험이 생기는 메커니즘을 설명합니다"
category: challenge
tags:
  - go-ti
  - pglogical
  - PostgreSQL
  - replication-set
  - sequence
  - failover
  - concept
series:
  name: "goti-deepdive-database"
  order: 7
date: "2026-04-18"
---

## 한 줄 요약

> pglogical replication set은 복제 대상 테이블을 그룹으로 묶는 단위이며, 시퀀스는 논리 디코딩 스트림이 아닌 "마지막 값(last-value)" 스냅샷으로 별도 전파되기 때문에 Failover 직후 publisher의 미전파 구간만큼 PK 중복 위험이 발생합니다

> 논리 복제 기초(WAL·복제 슬롯·publication/subscription 모델)는 [pglogical — WAL 논리 디코딩부터 시퀀스 복제까지](/essays/goti-deepdive-pglogical-logical-replication)에서 다룹니다

---

## 🤔 무엇을 푸는 기술인가

단일 pglogical 구독에서 모든 테이블을 같은 방식으로 복제하면 두 가지 문제가 생깁니다

첫째, 테이블마다 변경 유형이 다릅니다 주문 테이블은 INSERT·UPDATE·DELETE가 모두 발생하지만, 감사 로그 테이블은 INSERT만 발생합니다 DELETE가 발생하지 않는 테이블에 DELETE 이벤트를 복제하면 subscriber에서 불필요한 오류가 생길 수 있습니다

둘째, 시퀀스는 행 데이터가 아닙니다 `SEQUENCE` 객체는 WAL 스트림에 행 이벤트로 기록되지 않으므로, pglogical의 논리 디코딩 파이프라인만으로는 subscriber의 시퀀스 값이 업데이트되지 않습니다 Failover로 subscriber가 new primary가 되면 publisher가 이미 사용한 PK 범위와 충돌할 수 있습니다

**replication set**은 두 문제를 동시에 해결하는 구조입니다 테이블을 역할별로 그룹화해 복제 방식을 제어하고, 시퀀스를 set에 명시적으로 포함시켜 subscriber로 전파합니다

---

## 🔧 동작 원리

### replication set의 구조

replication set은 publisher 측에 생성하는 **복제 대상 그룹**입니다 테이블과 시퀀스를 담을 수 있으며, set 단위로 복제 이벤트 유형(INSERT/UPDATE/DELETE)을 제어합니다

pglogical은 생성 시 세 가지 기본 set을 제공합니다

```text
default        — INSERT·UPDATE·DELETE 모두 복제 (일반 서비스 테이블)
insert_only    — INSERT만 복제 (append-only 테이블)
ddl_sql        — replicate_ddl_command()로 전달된 DDL 큐
```

`default`와 `insert_only`는 테이블용 set이고, `ddl_sql`은 pglogical 내부에서 DDL 전파에 사용하는 특수 set입니다 직접 테이블을 추가하는 set은 아닙니다

![pglogical replication set 3종 분류 구조](/diagrams/goti-deepdive-pglogical-replication-set-1.svg)

위 다이어그램은 publisher와 subscriber 사이에 세 replication set이 각각 어떤 이벤트를 전달하는지 보여줍니다

**default set**은 서비스 스키마의 테이블 전체를 포함합니다 INSERT·UPDATE·DELETE가 모두 복제 스트림에 실려 subscriber에 재실행됩니다 go-ti에서는 6개 서비스 스키마의 모든 테이블이 여기에 들어갑니다

**insert_only set**은 INSERT 이벤트만 전달합니다 subscriber에서 독립적으로 DELETE가 발생해도 publisher의 복제 스트림과 충돌하지 않습니다 감사 로그, 이벤트 히스토리처럼 한 번 쓰이면 수정·삭제가 없는 테이블에 적합합니다

**ddl_sql set**은 `pglogical.replicate_ddl_command()` 함수를 경유한 DDL을 subscriber에 전달합니다 일반 `ALTER TABLE`을 직접 실행하면 이 set을 거치지 않아 subscriber에는 전파되지 않습니다

subscriber는 구독 생성 시 어떤 set을 구독할지 명시합니다

```sql
SELECT pglogical.create_subscription(
  subscription_name := 'sub_from_gcp_primary',
  provider_dsn      := 'host=34.64.74.209 port=5432 dbname=gotidb user=pglogical_repl',
  replication_sets  := ARRAY['default', 'ddl_sql'],
  synchronize_data  := true
);
```

`replication_sets` 배열에 나열한 set만 구독합니다 insert_only를 넣지 않으면 해당 set에 등록된 테이블의 이벤트는 subscriber에 전달되지 않습니다

### 테이블과 시퀀스를 set에 등록하는 방법

```sql
-- 스키마 전체 테이블을 default set에 한 번에 등록
SELECT pglogical.replication_set_add_all_tables(
  set_name   := 'default',
  schema_names := ARRAY['user_service', 'ticketing_service',
                         'payment_service', 'resale_service',
                         'stadium_service', 'queue_service']
);

-- 특정 테이블만 등록 (행 필터 적용 가능)
SELECT pglogical.replication_set_add_table(
  set_name   := 'insert_only',
  relation   := 'public.audit_log',
  synchronize_data := false
);

-- 시퀀스 전체 등록 (중요: 누락 시 Failover 후 PK 중복)
SELECT pglogical.replication_set_add_all_sequences(
  set_name     := 'default',
  schema_names := ARRAY['user_service', 'ticketing_service',
                         'payment_service', 'resale_service',
                         'stadium_service', 'queue_service']
);
```

`replication_set_add_all_sequences()`를 호출하지 않으면 시퀀스 객체가 set에 포함되지 않습니다 이 경우 subscriber의 시퀀스 값은 Initial sync 이후 업데이트되지 않습니다

### 시퀀스가 last-value로 복제되는 이유

행 데이터(INSERT/UPDATE/DELETE)는 트랜잭션이 커밋될 때마다 WAL에 기록되고, 논리 디코딩이 이를 이벤트로 변환해 실시간으로 subscriber에 전달합니다

시퀀스는 다릅니다 `nextval()`을 호출할 때마다 시퀀스 카운터가 올라가지만, 이 증가 자체가 행 이벤트로 기록되지는 않습니다 PostgreSQL 내부적으로 시퀀스는 heap 페이지에 저장되며, 성능을 위해 `cache` 개수만큼 미리 올려두고 메모리에서 소비합니다 WAL에는 cache 단위로 기록되므로, 행 이벤트처럼 1씩 스트리밍되지 않습니다

pglogical은 이 한계를 돌아가기 위해 시퀀스 복제를 별도 경로로 처리합니다 set에 시퀀스가 등록되어 있으면 pglogical이 **주기적으로** publisher의 `pg_sequences` 뷰를 읽어 `last_value`를 가져온 뒤, subscriber에서 `setval()`을 실행합니다

```sql
-- subscriber에서 수동으로 시퀀스 동기화
SELECT pglogical.synchronize_sequence(
  relation := 'ticketing_service.tickets_id_seq'
);

-- 내부적으로 publisher에서 읽어 subscriber에 실행되는 것
-- setval('ticketing_service.tickets_id_seq', <publisher_last_value>)
```

"주기적으로" 전파된다는 것이 핵심입니다 행 이벤트처럼 변경 즉시 전달되지 않습니다 publisher에서 시퀀스가 1000에서 1850으로 올라간 사이에 subscriber로 전파된 마지막 값이 1600이라면, 1601~1850 구간은 subscriber가 모릅니다

### Failover 직후 gap 발생 메커니즘

![Failover 직후 시퀀스 드리프트와 PK 중복 위험 타임라인](/diagrams/goti-deepdive-pglogical-replication-set-2.svg)

위 타임라인은 정상 운영 구간(T0~T2)과 Failover 직후 구간(T2~T4)에서 publisher·subscriber 양쪽의 시퀀스 상태 변화를 보여줍니다

단계별로 설명합니다

**T0~T2 정상 운영**: publisher에서 시퀀스가 1000에서 1850으로 증가합니다 pglogical이 주기적으로 last_value를 subscriber에 전파하지만, 이번 주기에서는 1600까지만 전파되었습니다 subscriber는 `read_only=on` 상태이므로 `nextval()`을 호출하지 않으며, last_value=1600을 그대로 유지합니다

**T2 Failover**: publisher가 다운됩니다 복제 스트림이 끊기면서 publisher의 현재 last_value=1850은 subscriber에 전달되지 못했습니다

**T2~T4 new primary 운영**: subscriber가 new primary로 승격됩니다 `read_only=off`로 전환되고 앱이 쓰기를 시작합니다 이 시점 subscriber의 시퀀스 last_value는 1600입니다 `nextval()`을 호출하면 1601, 1602 ... 순서로 발행합니다 그런데 publisher가 T2 이전에 이미 1601~1850 범위를 사용했다면, new primary에서 발행한 PK와 기존 데이터의 PK가 겹칩니다

이 PK 중복은 INSERT 시점에 `duplicate key value violates unique constraint` 오류로 표면화됩니다 티켓팅 도메인에서 이 오류는 티켓 중복 판매로 직결됩니다

---

## 📐 세부 동작과 옵션

### replication set 3종 비교

| set | 복제 이벤트 | 적합한 테이블 유형 | 주의사항 |
|---|---|---|---|
| `default` | INSERT·UPDATE·DELETE | 일반 서비스 테이블 | subscriber를 read_only로 운영해야 충돌 최소화 |
| `insert_only` | INSERT만 | 감사 로그·이벤트 히스토리 | subscriber 로컬 DELETE와 무관, 단 UPDATE도 전파 안 됨 |
| `ddl_sql` | DDL (replicate_ddl_command 경유) | 스키마 변경 | 직접 ALTER TABLE은 이 set를 거치지 않음 |

### 시퀀스 gap 보정: ALTER SEQUENCE RESTART

Failover runbook에서 new primary 승격 직후 반드시 수행할 보정 절차입니다

```sql
-- 1. publisher의 마지막 시퀀스 값 확인
--    (publisher 접속 가능할 때, 또는 Failover 전 백업 값 활용)
SELECT last_value FROM ticketing_service.tickets_id_seq;
-- → 예: 1850

-- 2. subscriber에서 안전 마진을 더해 RESTART
ALTER SEQUENCE ticketing_service.tickets_id_seq
  RESTART WITH 2850;   -- 1850 + 1000 (안전 마진)

-- 또는 pg_sequence_last_value()로 동적 계산
SELECT setval(
  'ticketing_service.tickets_id_seq',
  pg_sequence_last_value('ticketing_service.tickets_id_seq') + 1000
);
```

안전 마진(+1000)은 publisher 다운 직전까지 발행된 미전파 값과 new primary가 승격 직후 발행할 수 있는 burst를 흡수합니다 시퀀스 PK는 단조 증가이므로 값을 크게 올리는 것에는 실용적 비용이 없습니다

### replication set 누락 확인

운영 중 어떤 테이블·시퀀스가 set에 포함되었는지 확인하는 쿼리입니다

```sql
-- set에 등록된 테이블 목록
SELECT set_name, nspname, relname
FROM pglogical.replication_set_table rst
JOIN pglogical.replication_set rs ON rs.set_id = rst.set_id
JOIN pg_class c ON c.oid = rst.set_reloid
JOIN pg_namespace n ON n.oid = c.relnamespace
ORDER BY set_name, nspname, relname;

-- set에 등록된 시퀀스 목록
SELECT set_name, nspname, relname
FROM pglogical.replication_set_seq rss
JOIN pglogical.replication_set rs ON rs.set_id = rss.set_id
JOIN pg_class c ON c.oid = rss.set_seqoid
JOIN pg_namespace n ON n.oid = c.relnamespace
ORDER BY set_name, nspname, relname;
```

신규 테이블을 추가하면 `replication_set_add_table()`을 명시적으로 호출해야 합니다 `replication_set_add_all_tables()`는 호출 시점 기준 스냅샷이므로, 이후 생성된 테이블은 포함되지 않습니다

---

## 🧩 go-ti에서는

go-ti에서 pglogical replication set 구성 스크립트는 `feature/db-sync-phase-b` 브랜치에서 관리합니다 6개 서비스 스키마(`user_service`, `ticketing_service`, `payment_service`, `resale_service`, `stadium_service`, `queue_service`)의 테이블 전체와 시퀀스 전체를 `default` set에 등록합니다 감사 로그 성격 테이블은 `insert_only` set 후보로 식별되어 있으나 1주 시연 범위에서는 `default` 단일 set으로 운영합니다

시퀀스 누락 방지를 결정 규칙 4번으로 명시했습니다 "시퀀스 누락 시 PK 중복 → 티켓 중복 판매 위험"으로 인해 `replication_set_add_all_sequences()` 완료 여부를 배포 체크리스트에 포함합니다 Failover runbook에는 `ALTER SEQUENCE RESTART WITH (publisher_last_value + 1000)` 절차가 반영되어 있습니다 orders/payments 테이블은 AWS 기존 잔재 데이터로 인한 PK 충돌이 이미 발생하여 `alter_subscription_resynchronize_table()`로 별도 처리 중입니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [Active-Passive + 읽기 분리 — PgBouncer 2벌과 Cross-cloud 쓰기 정책](/logs/goti-db-active-passive-with-read-split-adr)에 정리했습니다

---

## 📚 핵심 정리

- replication set은 테이블을 복제 이벤트 유형별로 그룹화하는 단위입니다 `default`(전체), `insert_only`(INSERT만), `ddl_sql`(DDL 큐) 세 종류가 있으며 subscriber는 구독 시 set 배열을 명시합니다
- 시퀀스는 WAL 행 이벤트로 기록되지 않기 때문에 논리 디코딩 스트림에 포함되지 않습니다 pglogical은 `last_value` 스냅샷을 **주기적으로** 별도 전파합니다
- Failover 직후에는 "마지막 전파된 last_value"와 "publisher가 실제로 사용한 마지막 값" 사이에 gap이 생깁니다 new primary가 이 구간 값을 재발행하면 PK 중복이 발생합니다
- 보정은 `ALTER SEQUENCE RESTART WITH (publisher_last_value + 안전_마진)`으로 수행합니다 안전 마진은 미전파 구간 + 승격 직후 burst를 흡수하기 위한 여유입니다
- `replication_set_add_all_tables()`와 `replication_set_add_all_sequences()`는 호출 시점 스냅샷입니다 이후 추가된 테이블·시퀀스는 수동으로 등록해야 합니다
