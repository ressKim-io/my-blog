---
title: "PostgreSQL 물리 복제 vs 논리 복제 — WAL 스트리밍과 선택 기준"
excerpt: "PostgreSQL streaming replication이 WAL을 블록 단위로 전송하는 방법, physical replication slot이 hot standby를 만드는 과정, 그리고 물리 복제와 논리 복제 중 언제 무엇을 고르는지를 설명합니다"
category: challenge
tags:
  - go-ti
  - PostgreSQL
  - streaming-replication
  - WAL
  - physical-replication
  - replication-slot
  - concept
series:
  name: "goti-deepdive-database"
  order: 5
date: "2026-04-18"
---

## 한 줄 요약

> PostgreSQL 물리 복제(streaming replication)는 WAL을 블록 바이트 그대로 standby에 전달하며, 동일 버전·동일 플랫폼 제약 대신 단순성과 낮은 지연을 얻습니다 논리 복제가 행 이벤트 변환의 유연성을 제공하는 반면, 물리 복제는 같은 클러스터 내 읽기 분산에 최적입니다

---

## 🤔 무엇을 푸는 기술인가

데이터베이스 복제의 근본 목적은 두 가지입니다 — 첫째는 **고가용성(HA)**: primary 장애 시 standby로 빠르게 전환, 둘째는 **읽기 분산**: 조회 쿼리를 여러 인스턴스에 나누어 처리

PostgreSQL은 이 두 목적을 위해 두 가지 복제 경로를 제공합니다

- **물리 복제(streaming replication)**: WAL 파일의 바이트를 그대로 standby로 전달. standby는 primary의 정확한 블록 복사본이 됩니다
- **논리 복제(logical replication / pglogical)**: WAL을 행 단위 이벤트로 해석하여 전달. 대상 인스턴스가 다른 버전이어도 되고, 특정 테이블만 구독할 수도 있습니다

두 방식의 출발점은 같습니다 — 모두 WAL을 원본으로 사용합니다 WAL을 어떤 형태로 전달하는가에서 갈립니다

**물리 복제는 언제 쓰는가**:
- 같은 PostgreSQL 클러스터 안에서 읽기 전용 replica가 필요할 때
- 장애 시 자동 또는 반자동 failover를 위한 hot standby 구성
- 구성이 단순해야 하고, 복제 지연을 최소화해야 할 때

**논리 복제는 언제 쓰는가**:
- 클러스터가 다른 버전이거나 다른 클라우드에 있을 때
- 특정 테이블만 선택적으로 복제하거나, 시퀀스·DDL 전파가 필요할 때
- 크로스 버전 마이그레이션 구간에서 점진적 전환이 필요할 때

논리 복제 내부(pglogical의 pub/sub 모델, 슬롯 WAL 보존, DDL 복제 메커니즘)는 이 시리즈의 다른 글([pglogical — WAL 논리 디코딩부터 시퀀스 복제까지](/essays/goti-deepdive-pglogical-logical-replication))에서 깊이 다루고 있습니다 이 글은 **물리 복제의 동작 원리**와 **두 방식의 비교·선택 기준**에 집중합니다

---

## 🔧 동작 원리

### WAL이란 무엇인가

PostgreSQL은 모든 데이터 변경을 실제 heap 파일에 쓰기 전에 먼저 **WAL(Write-Ahead Log)**에 기록합니다 WAL은 추가 전용(append-only) 로그 파일로, `pg_wal/` 디렉토리에 16MB 단위 세그먼트로 저장됩니다

WAL 레코드는 "blkno(블록 번호) X의 offset Y를 이렇게 변경했다"는 저수준 표현입니다 예를 들어 `UPDATE orders SET status = 'paid' WHERE id = 42`를 실행하면:

```text
WAL 레코드 (물리 표현):
  relation: public.orders (oid=16384)
  blkno: 17
  offset: 384
  before: tuple header + old bytes
  after:  tuple header + new bytes (status field)
```

이 포맷은 PostgreSQL 내부 heap 구조와 1:1로 대응됩니다 **물리 복제는 이 WAL 레코드 자체를 standby로 전달**합니다

### Streaming Replication — 블록 단위 전송

물리 복제의 공식 명칭은 **streaming replication**입니다 WAL 세그먼트가 디스크에 쌓이기를 기다리지 않고, 생성되는 즉시 네트워크를 통해 standby로 스트리밍합니다

동작 흐름:

1. primary에서 트랜잭션이 커밋되면 WAL 레코드가 `pg_wal/`에 flush됩니다
2. **walsender** 프로세스(primary 측)가 WAL 레코드를 읽어 복제 프로토콜로 전송합니다
3. **walreceiver** 프로세스(standby 측)가 수신하여 standby의 `pg_wal/`에 씁니다
4. standby의 **startup process**가 WAL을 replay하며 heap 파일에 적용합니다
5. standby가 수신·적용한 WAL의 LSN(Log Sequence Number)을 primary에 ACK로 돌려보냅니다

standby는 WAL replay가 진행 중인 동안에도 **hot standby** 모드에서 읽기 쿼리를 처리할 수 있습니다 `hot_standby = on` 설정이 기본값입니다

### Physical Replication Slot

streaming replication에는 두 가지 동기화 방식이 있습니다:

- **슬롯 없는 방식**: standby가 일시적으로 연결을 잃으면, 그 사이 primary가 오래된 WAL 세그먼트를 삭제(`wal_keep_size` 초과)할 수 있습니다 재접속 시 필요한 WAL이 없으면 full resync가 필요합니다
- **physical replication slot 사용**: primary가 standby가 아직 수신하지 못한 WAL 세그먼트를 삭제하지 않도록 잠금을 겁니다

physical replication slot 생성:

```sql
-- primary에서 슬롯 생성
SELECT pg_create_physical_replication_slot('standby_slot');

-- 슬롯 상태 확인
SELECT slot_name, restart_lsn, active FROM pg_replication_slots;
```

standby는 `recovery.conf`(또는 `postgresql.conf`) + `standby.signal` 파일로 슬롯을 참조합니다:

```text
# postgresql.conf (standby)
primary_conninfo = 'host=34.64.74.209 port=5432 user=replicator sslmode=verify-full'
primary_slot_name = 'standby_slot'
```

physical slot도 논리 슬롯처럼 standby가 오래 연결되지 않으면 WAL이 무한히 쌓입니다 `max_slot_wal_keep_size` 파라미터로 상한을 설정하는 것이 안전합니다

### 복제 지연 — Sync vs Async

primary → standby 복제는 **동기** 또는 **비동기** 중 하나로 운영합니다

| 모드 | 동작 | 장단점 |
|---|---|---|
| 비동기 (기본) | primary가 standby ACK를 기다리지 않고 커밋 완료 | 지연 최소화, 장애 시 데이터 소량 유실 가능 |
| 동기 (`synchronous_standby_names`) | standby가 WAL을 수신·flush 완료해야 primary 커밋 확정 | 데이터 유실 0, 커밋 지연 증가 |

대부분의 읽기 분산 구성은 비동기 복제를 씁니다 동기 복제는 금융·결제처럼 RPO=0이 필수인 경우에 사용합니다

### 물리 복제의 핵심 제약 — 동일 버전·동일 플랫폼

물리 복제의 가장 중요한 제약은 **primary와 standby가 동일한 PostgreSQL major 버전, 동일한 OS 아키텍처를 공유해야 한다**는 점입니다

이유는 WAL 포맷에 있습니다 WAL 레코드는 PostgreSQL 내부 heap 블록 구조를 직접 기술합니다 버전이 다르면 heap 블록의 tuple header 형식이 다를 수 있고, arm64와 x86_64는 정수 endianness가 같지만 컴파일러 패딩이 달라질 수 있습니다 standby가 잘못된 해석으로 데이터를 덮어쓰면 데이터 손상이 발생합니다

```text
제약 목록:
  ✓ PostgreSQL major version — 동일해야 함 (14.x → 14.x는 OK, 14 → 15는 불가)
  ✓ OS CPU 아키텍처 — x86_64 ↔ arm64 혼용 불가
  ✓ data_checksums 설정 — primary와 동일해야 함
  ✗ minor version (14.5 ↔ 14.9) — 다를 수 있음 (호환성 유지)
```

이 제약 때문에 물리 복제는 같은 환경 안(같은 클러스터, 같은 버전)에서 standby를 만드는 용도에 적합하고, 크로스 클라우드나 크로스 버전 복제에는 부적합합니다

---

## 📐 세부 동작과 옵션

### 물리 복제 vs 논리 복제 — 비교 표

![물리 복제 vs 논리 복제 복제 단위 비교|tall](/diagrams/goti-deepdive-physical-vs-logical-replication-1.svg)

위 다이어그램은 두 복제 방식이 WAL에서 시작하여 어떻게 다른 경로로 전달되는지 나란히 보여줍니다 왼쪽 물리 복제에서는 WAL 세그먼트의 블록 바이트(`blkno 42 offset 128`)가 walsender→walreceiver 경로로 그대로 전달됩니다 오른쪽 논리 복제에서는 WAL이 논리 디코딩을 거쳐 `INSERT orders (id=42, status='paid')` 같은 행 이벤트로 변환된 뒤 replication slot을 경유하여 apply worker로 전달됩니다

두 방식의 차이를 항목별로 정리합니다

| 항목 | 물리 복제 | 논리 복제(pglogical) |
|---|---|---|
| 전달 단위 | WAL 블록 바이트 | 행 이벤트 (INSERT/UPDATE/DELETE) |
| 버전 제약 | 동일 major version 필수 | 다른 버전 가능 (PG 10+) |
| OS 아키텍처 | 동일 플랫폼 필수 | 무관 |
| 복제 대상 | 전체 DB (선택 불가) | 테이블 단위 선택 가능 |
| standby 상태 | 읽기 전용 (hot standby) | 읽기+쓰기 가능 (독립 인스턴스) |
| 시퀀스 복제 | 자동 포함 (블록 복사) | pglogical: 명시 동기화 필요 |
| DDL 복제 | 자동 포함 | pglogical: `replicate_ddl_command()` 필요 |
| 지연 | 낮음 (블록 그대로 전달) | 약간 높음 (논리 디코딩 오버헤드) |
| 크로스 클라우드 | 불가 (VPN+동일 환경 필요) | 가능 (TLS + IP allowlist) |
| 구성 복잡도 | 낮음 | 높음 |

물리 복제는 구성이 단순하고 지연이 낮지만, 버전·플랫폼 동일성 제약이 있어 적용 범위가 같은 클러스터 내부로 한정됩니다 논리 복제는 그 제약을 넘기 위해 디코딩 오버헤드와 운영 복잡도를 감수하는 선택입니다

### 복제 모니터링

물리 복제 상태는 `pg_stat_replication` 뷰로 확인합니다:

```sql
SELECT
  application_name,
  state,
  sent_lsn,
  write_lsn,
  flush_lsn,
  replay_lsn,
  (sent_lsn - replay_lsn) AS lag_bytes
FROM pg_stat_replication;
```

`lag_bytes`가 0에 가까우면 복제가 거의 실시간으로 따라가고 있다는 의미입니다 지속적으로 수백 MB 이상이면 standby가 replay를 따라가지 못하는 것이므로 원인을 분석해야 합니다

standby에서는 `pg_stat_wal_receiver`로 수신 상태를 봅니다:

```sql
SELECT
  status,
  received_lsn,
  last_msg_receipt_time,
  latest_end_lsn
FROM pg_stat_wal_receiver;
```

### Failover — 수동 promote

primary에 장애가 발생하면 standby를 새 primary로 승격합니다:

```bash
# standby를 읽기-쓰기 primary로 전환
pg_ctl promote -D /var/lib/postgresql/16/main
```

또는 `SIGUSR1` 시그널로 트리거합니다 승격 완료 후 `standby.signal` 파일이 삭제되고 standby가 일반 primary처럼 동작합니다

**자동 failover**는 Patroni + etcd/Consul 같은 HA 도구가 담당합니다 Patroni는 DCS(Distributed Consensus Store)를 통해 primary 선출과 자동 promote를 관리합니다 단, Patroni 없이 수동 promote만 사용하면 split-brain(두 인스턴스가 동시에 primary로 동작) 위험이 있으므로 old primary를 먼저 완전히 격리해야 합니다

---

## 🧩 go-ti에서는

go-ti는 멀티클라우드 DB 복제 구조에서 물리 복제와 논리 복제를 **역할을 나눠 함께** 사용합니다

![go-ti 복제 배치 — GCP Streaming vs Cross-cloud pglogical|tall](/diagrams/goti-deepdive-physical-vs-logical-replication-2.svg)

GCE VM(e2-standard-2, PostgreSQL 16.13)이 primary입니다 GCP 내부의 standby로는 **streaming replication(물리 복제)** 을 사용합니다 — 같은 버전·같은 플랫폼이고, 설정이 단순하며, 지연이 낮기 때문입니다 AWS RDS(db.r6g.large, PostgreSQL 16) subscriber로는 **pglogical(논리 복제)** 을 사용합니다 — VPN 없이 퍼블릭 IP + TLS로 크로스 클라우드 복제가 가능하고, 시퀀스·DDL 동기화가 지원되기 때문입니다

두 경로 모두 WAL에서 출발하지만, GCP 내부 경로는 WAL 블록을 그대로 보내고 크로스 클라우드 경로는 WAL을 논리 디코딩하여 행 이벤트로 변환합니다 AWS RDS는 `default_transaction_read_only=on`으로 쓰기를 차단하여 복제 충돌을 원천 방지합니다 GCE Standby는 Phase B에서 활성화 예정입니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [Multi-Cloud DB 복제 기술 선정 — GCE VM + pglogical 2.x를 택한 이유](/logs/goti-multicloud-db-replication-technology-adr)에 정리했습니다

---

## 📚 핵심 정리

- WAL은 PostgreSQL의 모든 변경을 블록 수준으로 기록하는 추가 전용 로그입니다 물리 복제는 이 WAL 바이트를 standby에 그대로 전달하며, standby는 동일한 블록 레이아웃을 재현합니다
- streaming replication에서 walsender(primary)와 walreceiver(standby)는 WAL 생성 즉시 스트리밍합니다 physical replication slot을 사용하면 standby 단절 구간에도 WAL이 보존됩니다
- hot standby는 WAL replay 중에도 읽기 쿼리를 처리합니다 비동기 복제가 기본이며, RPO=0이 필요한 경우 `synchronous_standby_names`로 동기 복제를 활성화합니다
- 물리 복제의 핵심 제약은 **동일 major version + 동일 OS 아키텍처**입니다 이 제약이 같은 클러스터 내부용으로만 쓰는 이유입니다
- 크로스 버전·크로스 클라우드 복제에는 논리 복제(pglogical)가 적합합니다 두 방식은 상호 배타적이지 않으며, go-ti처럼 내부 경로는 물리 복제, 외부 경로는 논리 복제로 역할을 분리하여 함께 운영할 수 있습니다
