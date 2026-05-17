---
title: "pglogical — WAL 논리 디코딩부터 시퀀스 복제까지"
excerpt: "PostgreSQL 논리 복제 확장 pglogical이 WAL을 행 단위 변경으로 변환하는 과정, 복제 슬롯이 WAL을 보존하는 방법, publication/subscription 모델의 동작 원리를 설명합니다"
category: challenge
tags:
  - go-ti
  - pglogical
  - PostgreSQL
  - logical-replication
  - WAL
  - replication-slot
  - concept
series:
  name: "goti-deepdive-database"
  order: 4
date: "2026-04-18"
---

## 한 줄 요약

> pglogical은 PostgreSQL의 논리 디코딩(logical decoding) 인프라 위에서 동작하는 복제 확장으로, WAL에 기록된 물리 변경을 행 단위 이벤트로 변환하여 다른 PostgreSQL 인스턴스로 스트리밍합니다

---

## 🤔 무엇을 푸는 기술인가

PostgreSQL에는 복제 방식이 두 가지 있습니다 **물리 복제(physical / streaming replication)**는 WAL 바이트를 그대로 복사합니다 대상 인스턴스는 동일한 블록 레이아웃, 동일한 PostgreSQL 버전, 동일한 플랫폼을 요구합니다 읽기 전용 standby를 빠르게 만드는 데는 최적이지만, 크로스 버전 마이그레이션이나 테이블 단위 선택적 복제는 불가능합니다

**논리 복제(logical replication)**는 그 한계를 넘기 위해 등장했습니다 WAL의 저수준 블록 변화를 "어떤 테이블의 어떤 행이 어떻게 바뀌었다"는 의미 단위로 변환하여 전달합니다 대상 인스턴스는 다른 버전일 수 있고, 다른 스키마를 가질 수도 있으며, 특정 테이블만 구독할 수도 있습니다

PostgreSQL 10부터 내장된 기본 논리 복제(`CREATE PUBLICATION / CREATE SUBSCRIPTION`)가 있지만, 다음 두 기능을 제공하지 않습니다

- **시퀀스 복제**: `SEQUENCE` 객체의 현재 값이 subscriber에 전파되지 않습니다 Failover/Failback 시 PK 중복 발행 위험이 있습니다
- **DDL 복제**: `ALTER TABLE`, `CREATE INDEX` 같은 스키마 변경이 복제 스트림에 포함되지 않습니다

pglogical은 이 두 기능을 추가 지원하는 확장입니다 2ndQuadrant(현 EDB)가 개발했으며, PostgreSQL 논리 디코딩 API를 직접 활용합니다

---

## 🔧 동작 원리

### WAL과 논리 디코딩

PostgreSQL은 모든 변경을 WAL(Write-Ahead Log)에 먼저 기록합니다 WAL은 트랜잭션 내구성을 위한 핵심 구조지만, 그 포맷은 내부 블록 수준의 표현입니다 예를 들어 `UPDATE orders SET status = 'paid' WHERE id = 42`를 실행하면, WAL에는 "heap 파일 blkno 17에서 offset 384의 튜플을 이렇게 바꿨다"와 같은 저수준 기록이 남습니다

**논리 디코딩(logical decoding)**은 이 저수준 WAL 레코드를 의미 있는 행 변경 이벤트로 변환하는 프레임워크입니다 PostgreSQL 9.4에서 도입되었습니다 논리 디코딩 플러그인은 WAL 레코드를 읽으면서 트랜잭션 경계(`BEGIN` / `COMMIT`)와 행 수정(`INSERT` / `UPDATE` / `DELETE`)을 추출합니다 pglogical은 `pglogical_output`이라는 논리 디코딩 플러그인을 자체 내장합니다

![pglogical 논리 복제 파이프라인](/diagrams/goti-deepdive-pglogical-logical-replication-1.svg)

위 다이어그램은 pglogical 복제 파이프라인의 전체 흐름입니다 왼쪽 Publisher 영역에서 WAL이 생성되고, 논리 디코딩 플러그인이 이를 해석하여 행 이벤트로 변환합니다 변환된 이벤트는 복제 슬롯에 큐잉된 뒤 복제 프로토콜(TLS)로 Subscriber 영역에 전달됩니다 Subscriber의 apply worker가 이벤트를 수신하고 대상 DB에 재실행합니다 Subscriber는 처리 완료 후 LSN을 Publisher에 ACK로 돌려보냅니다

각 구성요소의 역할을 정리합니다

- **WAL**: 모든 데이터 변경이 저장되는 추가 전용 로그 파일입니다 물리 블록 단위로 기록되므로 그 자체로는 "어떤 테이블의 어떤 행이 바뀌었는지" 알 수 없습니다
- **논리 디코딩 플러그인(pglogical_output)**: WAL 레코드를 읽어 시스템 카탈로그와 대조하고, 물리 표현을 테이블·행·컬럼 단위의 의미 이벤트로 변환합니다 `wal_level = logical` 설정이 선행되어야 합니다
- **복제 슬롯**: subscriber가 아직 수신하지 못한 WAL 세그먼트를 publisher가 삭제하지 않도록 잠금을 걸어두는 커서입니다 LSN 위치를 추적하며, subscriber 재접속 시 이 지점부터 재전송이 이루어집니다
- **walsender / walreceiver**: publisher 측 백그라운드 프로세스(walsender)가 복제 스트림을 내보내고, subscriber 측 프로세스(walreceiver)가 수신합니다 논리 복제에서도 이 프로세스 쌍이 연결 채널을 담당합니다
- **apply worker**: subscriber 측에서 수신한 행 이벤트를 실제 로컬 DB에 실행합니다 INSERT/UPDATE/DELETE를 순서대로 재실행하며, 충돌이 발생하면 설정된 충돌 해소 정책에 따라 처리합니다

### 복제 슬롯과 WAL 보존

논리 복제에서 중요한 개념 하나가 **복제 슬롯(replication slot)**입니다 복제 슬롯은 publisher가 WAL 세그먼트를 조기에 삭제하지 않도록 "잠금"을 거는 장치입니다

subscriber가 일시적으로 연결이 끊어져도 복제 슬롯이 살아있는 한 publisher는 아직 전달하지 못한 WAL 세그먼트를 보존합니다 subscriber가 재접속하면 마지막으로 확인한 LSN(Log Sequence Number)부터 이어서 받을 수 있습니다

```text
[publisher WAL 세그먼트]
  000000010000000000000001  ← 슬롯 위치 (subscriber가 아직 못 받은 지점)
  000000010000000000000002  ← 새 WAL (계속 쌓임)
  000000010000000000000003
  ...
  슬롯 이전 세그먼트는 삭제 불가
```

이 특성은 양날의 검입니다 subscriber가 오랫동안 연결되지 않으면 WAL이 무한히 쌓여 publisher 디스크가 꽉 찰 수 있습니다 운영 시 `max_slot_wal_keep_size` 파라미터로 WAL 보존 상한을 지정해야 합니다

### publication / subscription 모델

pglogical은 **publication(node)**과 **subscription**이라는 두 개념으로 복제 범위를 구성합니다 이는 PostgreSQL 10의 내장 논리 복제 명명과 유사하지만, 내부 구현은 별개입니다

**provider node(publisher)**:

```sql
-- pglogical extension 활성화
CREATE EXTENSION pglogical;

-- 노드 생성 (이 인스턴스가 복제 원본임을 선언)
SELECT pglogical.create_node(
  node_name := 'provider',
  dsn       := 'host=34.64.74.209 port=5432 dbname=gotidb'
);

-- replication set 생성 및 테이블 등록
SELECT pglogical.create_replication_set('default');
SELECT pglogical.replication_set_add_all_tables('default', ARRAY['public']);

-- 시퀀스도 명시적으로 포함
SELECT pglogical.replication_set_add_all_sequences('default', ARRAY['public']);
```

**subscriber node**:

```sql
CREATE EXTENSION pglogical;

SELECT pglogical.create_node(
  node_name := 'subscriber',
  dsn       := 'host=rds-endpoint port=5432 dbname=gotidb'
);

-- provider에 구독 생성
SELECT pglogical.create_subscription(
  subscription_name := 'sub_from_gcp_primary',
  provider_dsn      := 'host=34.64.74.209 port=5432 dbname=gotidb user=pglogical_repl',
  replication_sets  := ARRAY['default'],
  synchronize_data  := true   -- initial sync 포함
);
```

`create_subscription`을 실행하는 순간 pglogical은 두 단계를 수행합니다

1. **Initial sync**: `copy_data=true`(또는 `synchronize_data=true`)면 publisher에서 `COPY` 명령으로 기존 데이터를 bulk 전송합니다 이 시점에 publisher에 COPY 부하가 발생합니다
2. **Ongoing replication**: Initial sync 완료 후 논리 디코딩 스트림으로 변경분을 실시간 전달합니다

### 논리 디코딩이 WAL을 행 변경으로 변환하는 과정

![WAL → 행 이벤트 변환 흐름](/diagrams/goti-deepdive-pglogical-logical-replication-2.svg)

위 다이어그램은 WAL 블록이 행 단위 이벤트로 변환되는 과정을 단계별로 보여줍니다

단계별로 설명합니다

1. **트랜잭션 시작**: 클라이언트가 `BEGIN`을 실행하면 WAL에 트랜잭션 ID(XID)가 기록됩니다
2. **DML 실행**: `INSERT` / `UPDATE` / `DELETE`가 실행될 때마다 heap 페이지 변경이 WAL에 기록됩니다 이 시점에서의 WAL 형식은 "페이지 X의 오프셋 Y를 이렇게 수정"이라는 물리 표현입니다
3. **COMMIT**: 트랜잭션이 커밋되면 WAL에 COMMIT 레코드가 기록됩니다
4. **논리 디코딩 플러그인 처리**: `pglogical_output` 플러그인은 WAL을 순서대로 읽으면서 `BEGIN`~`COMMIT` 사이의 레코드를 추적합니다 heap 변경 레코드를 시스템 카탈로그(`pg_attribute`, `pg_class` 등)와 대조하여 테이블 이름·컬럼 이름·값으로 변환합니다
5. **변경 이벤트 직렬화**: 변환된 이벤트를 binary 포맷으로 직렬화합니다 어떤 테이블의 어떤 행이 어떤 값으로 바뀌었는지가 담겨 있습니다
6. **subscriber apply**: subscriber의 apply worker가 이벤트를 수신하고 로컬 DB에 재실행합니다 이 과정은 walsender(publisher)와 walreceiver(subscriber)의 연결로 이루어집니다

논리 디코딩이 물리 WAL에서 의미 정보를 추출하려면 커밋 시점의 스키마 정보가 필요합니다 PostgreSQL은 이를 위해 `wal_level = logical`로 설정된 경우 WAL에 스키마 정보 힌트를 포함시킵니다

---

## 📐 세부 동작과 옵션

### 시퀀스 복제

PostgreSQL 내장 논리 복제와 가장 차별화되는 기능입니다 pglogical은 `SEQUENCE` 객체의 현재 값을 별도 경로로 동기화합니다

```sql
-- subscriber에서 시퀀스 값 강제 동기화
SELECT pglogical.synchronize_sequence(
  relation := 'public.orders_id_seq'
);
```

내부적으로 provider의 시퀀스 현재 값을 읽어 subscriber에 `setval()`을 실행합니다 이 연산은 논리 디코딩 스트림 밖에서 별도로 수행됩니다 DDL로 시퀀스를 변경하거나 `nextval()`을 수백만 번 호출해도 자동으로 뒤따라가지는 않으므로, Failover 직전에 `synchronize_sequence()`를 수동 또는 자동화로 실행하는 절차가 중요합니다

### DDL 복제

pglogical은 DDL을 일반 DML 스트림에 포함시키는 방식으로 처리합니다

```sql
-- DDL을 복제 스트림에 포함하여 실행
SELECT pglogical.replicate_ddl_command(
  command := 'ALTER TABLE public.orders ADD COLUMN paid_at TIMESTAMPTZ;',
  replication_sets := ARRAY['default']
);
```

이 함수는 지정된 `replication_sets`를 구독 중인 모든 subscriber에 DDL을 전달합니다 일반 `ALTER TABLE`을 직접 실행하면 subscriber에는 전파되지 않습니다 DDL 운영 runbook에 이 함수 사용을 의무화해야 합니다

| 특성 | pglogical DDL 복제 | 내장 논리 복제 |
|---|---|---|
| DDL 자동 전파 | `replicate_ddl_command()`로 명시 실행 시 전파 | 미지원 (양쪽 수동 실행) |
| 복잡한 DDL | 제한적 (TRUNCATE, 일부 ALTER) | 미지원 |
| 스키마 drift 위험 | 명시 실행 규율로 방지 | 수동 관리 필요 |

핵심은 "명시 실행 규율"입니다 pglogical도 일반 `ALTER TABLE`을 직접 치면 subscriber에 전파되지 않습니다 `replicate_ddl_command()`를 경유해야 한다는 규칙을 runbook에 강제하지 않으면 내장 논리 복제와 다를 바 없이 스키마 drift가 쌓입니다

### at-least-once 전송과 충돌 해소

pglogical은 **at-least-once** 전달 보장을 합니다 네트워크 중단이나 subscriber 재시작이 있어도 publisher는 마지막 확인된 LSN 이후를 재전송합니다 이는 subscriber가 이미 처리한 변경을 중복 수신할 수 있다는 뜻입니다

충돌이 발생하는 대표적 상황:

- subscriber에 이미 동일한 PK를 가진 행이 존재하는데 INSERT 이벤트가 도달
- subscriber에서 독립적으로 데이터가 수정된 후 동일 행에 UPDATE가 도달

pglogical의 기본 충돌 해소 정책은 `apply_changes`입니다 충돌이 나면 해당 트랜잭션을 건너뜁니다 정책은 `pglogical.alter_subscription_set_conflict_resolution()`으로 변경할 수 있습니다

| 충돌 해소 정책 | 동작 |
|---|---|
| `error` | 에러를 내고 복제 중단 |
| `apply_changes` | 충돌 무시, 이후 변경만 적용 (기본) |
| `skip_transaction` | 충돌이 있는 트랜잭션 전체 skip |
| `last_update_wins` | 타임스탬프 기준 최신 값 우선 |

subscriber를 읽기 전용으로 운영하면(`default_transaction_read_only=on`) 충돌 자체가 발생하지 않습니다 가장 단순하고 안전한 운영 방식입니다

### replication set로 복제 범위 제어

pglogical에서 무엇을 복제할지는 `replication_set`으로 정의합니다

```sql
-- 특정 테이블만 포함하는 set 생성
SELECT pglogical.create_replication_set('orders_only');
SELECT pglogical.replication_set_add_table(
  set_name  := 'orders_only',
  relation  := 'public.orders',
  row_filter := '$.status = ''paid'''  -- 행 필터링도 가능
);
```

subscriber는 여러 replication set을 동시에 구독할 수 있습니다 `default` set는 자동 생성되며 `replication_set_add_all_tables()`로 모든 테이블을 한 번에 등록할 수 있습니다

---

## 🧩 go-ti에서는

go-ti에서는 Cloud SQL이 pglogical extension을 허용하지 않아 GCE VM(e2-standard-2, `34.64.74.209`)에 PostgreSQL 16.13과 pglogical 2.4.6을 올리고 publisher로 구성했습니다 AWS RDS(`db.r6g.large`, PostgreSQL 16)를 subscriber로 연결하여 GCP→AWS cross-cloud 복제를 구성합니다 subscriber는 `default_transaction_read_only=on`으로 읽기 전용 운영합니다

Initial sync 시 실 데이터 약 5GB를 복제했으며, publisher 측에서는 `max_slot_wal_keep_size=5GB`를 설정해 subscriber 장기 단절 시 WAL 폭증을 방어했습니다 orders/payments 테이블은 AWS 기존 잔재 데이터로 인한 PK 충돌이 발생하여 별도 처리가 필요했습니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [Multi-Cloud DB 복제 기술 선정 — GCE VM + pglogical 2.x를 택한 이유](/logs/goti-multicloud-db-replication-technology-adr)에 정리했습니다

---

## 📚 핵심 정리

- WAL은 물리 블록 수준 기록이고, 논리 디코딩은 이를 행 이벤트로 변환하는 프레임워크입니다 pglogical은 `pglogical_output` 플러그인으로 이 API를 활용합니다
- 복제 슬롯은 subscriber가 아직 수신하지 못한 WAL을 보존합니다 subscriber 장기 단절 시 디스크 소진 위험이 있으므로 `max_slot_wal_keep_size` 설정이 필수입니다
- pglogical이 내장 논리 복제와 구분되는 핵심은 **시퀀스 복제**와 **DDL 복제**입니다 PK 정합성이 중요한 도메인에서 Failover/Failback 절차에 `synchronize_sequence()` 호출을 반드시 포함해야 합니다
- DDL은 `pglogical.replicate_ddl_command()`를 통해서만 subscriber에 전파됩니다 이를 강제하는 runbook 없이는 스키마 drift가 발생합니다
- at-least-once 보장 특성상 subscriber 재시작 후 중복 이벤트를 수신할 수 있습니다 subscriber를 읽기 전용으로 운영하면 충돌 문제를 원천 차단합니다
