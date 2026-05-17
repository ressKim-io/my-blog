---
title: "Active-Passive 복제 토폴로지 — 단일 쓰기 지점이 충돌을 없애는 원리"
excerpt: "Active-Passive 토폴로지가 어떻게 비대칭 역할 구조를 구성하는지, 단일 쓰기 지점이 쓰기 충돌을 원천 차단하는 방법, subscriber를 물리적으로 읽기 전용으로 강제하는 방법을 설명합니다"
category: challenge
tags:
  - go-ti
  - active-passive
  - replication-topology
  - single-writer
  - read-replica
  - PostgreSQL
  - concept
series:
  name: "goti-deepdive-database"
  order: 6
date: "2026-04-18"
---

## 한 줄 요약

> Active-Passive 토폴로지는 한 노드에만 쓰기를 허용하고 나머지를 읽기 전용으로 운영하는 비대칭 복제 구조입니다 쓰기 경로가 단 하나이므로 동시 쓰기 충돌이 구조적으로 발생할 수 없습니다

---

## 🤔 무엇을 푸는 기술인가

여러 데이터베이스 인스턴스를 운영할 때 가장 큰 문제는 **동시 쓰기 충돌**입니다 두 노드가 각자 동일한 행을 수정하면, 어느 쪽의 값을 최종 상태로 삼을지 결정해야 합니다 충돌 해소 정책(last-write-wins, vector clock, CRDT 등)은 모두 이 문제를 처리하기 위한 복잡한 메커니즘입니다

Active-Passive 토폴로지는 이 문제를 **애초에 발생시키지 않는** 방식으로 접근합니다 한 노드(Active)만 쓰기를 받고, 다른 노드(Passive)는 복제본을 유지하되 쓰기를 아예 거부합니다 쓰기 경로가 단 하나이므로 동시 수정 경쟁이 생길 수 없습니다

이 구조가 해결하는 문제를 구체적으로 정리하면 다음과 같습니다

- **쓰기 충돌 제거**: 단일 쓰기 지점으로 인해 동시 수정이 물리적으로 불가능합니다
- **읽기 부하 분산**: Passive 노드가 읽기 트래픽을 흡수하여 Active의 읽기 부하를 줄입니다
- **장애 대비(HA)**: Active 장애 시 Passive를 Active로 승격하여 서비스를 이어갑니다
- **지역 분산**: Passive를 다른 CSP나 리전에 두면 Active와 가까운 쪽에서 읽기를 처리합니다

---

## 🔧 동작 원리

### 비대칭 역할 구조

Active-Passive 토폴로지의 핵심은 두 노드가 **비대칭 역할**을 갖는다는 점입니다

- **Active 노드**: 쓰기와 읽기를 모두 처리합니다 모든 INSERT/UPDATE/DELETE는 반드시 이 노드를 거칩니다
- **Passive 노드**: 읽기만 처리합니다 Active로부터 복제된 데이터를 갖고 있지만, 직접 쓰기는 거부합니다

이 구분이 **단일 쓰기 지점(single-writer)**을 만듭니다 어느 시점에서든 변경을 기록하는 노드는 오직 Active 하나입니다 복제는 Active에서 Passive 방향으로만 흐릅니다

![Active-Passive 비대칭 복제 구조도|tall](/diagrams/goti-deepdive-active-passive-topology-1.svg)

위 다이어그램은 Active-Passive 복제 구조의 전체 배치입니다 왼쪽 GCP 영역이 Active, 오른쪽 AWS 영역이 Passive 역할을 맡습니다

GCP(Active) 영역의 구조를 살펴보면, 애플리케이션은 두 경로로 데이터베이스에 접근합니다 PgBouncer-RW 경로는 pg-primary VM에 연결되며 쓰기와 읽기를 모두 처리합니다 PgBouncer-RO 경로는 읽기 전용 경로로, pg-primary에서도 읽기를 허용하며 향후 Phase B에서 추가될 pg-standby로도 분산시킬 수 있습니다 pg-primary는 pglogical publication을 통해 변경 스트림을 외부로 발행합니다

AWS(Passive) 영역에는 PgBouncer-RO만 존재하며 RDS subscriber로 연결됩니다 앱이 AWS 측에 쓰기를 시도하면 PgBouncer를 통과하더라도 RDS에서 즉시 오류가 납니다 복제 스트림은 GCP에서 AWS 방향으로 단방향으로만 흐르며, subscriber는 LSN ACK만 역방향으로 반환합니다

각 구성요소의 역할을 정리합니다

- **pg-primary (GCE VM)**: 유일한 쓰기 수신 노드입니다 pglogical publisher로 동작하며 변경 이벤트를 subscriber에 전달합니다
- **PgBouncer-RW**: Active 노드의 쓰기 경로 전담 프록시입니다 hot path(ticketing, payment, queue)가 이 경로를 사용합니다
- **PgBouncer-RO**: 읽기 전용 경로 프록시입니다 GCP 내에서는 primary와 standby로 읽기를 분산하고, AWS에서는 RDS subscriber로 연결합니다
- **AWS RDS subscriber**: Passive 노드입니다 GCP에서 복제된 데이터를 갖지만 직접 쓰기는 거부합니다
- **복제 스트림(pglogical)**: Active에서 Passive로 단방향으로 흐릅니다 TLS로 암호화되며 public IP allowlist로 접근을 제한합니다

### 단일 쓰기 지점이 충돌을 없애는 원리

Active-Active와 비교하면 이 원리가 더 명확해집니다

![Active-Passive vs Active-Active 쓰기 경로 비교](/diagrams/goti-deepdive-active-passive-topology-2.svg)

왼쪽의 Active-Passive 구조에서 클라이언트는 Active 노드 하나에만 쓰기를 보냅니다 Passive는 복제로만 데이터를 받고 직접 쓰기 요청은 받지 않습니다 Passive에 쓰기가 도달하면 데이터베이스 수준에서 오류를 반환합니다 따라서 두 노드가 동일한 행을 동시에 수정하는 상황 자체가 발생하지 않습니다

오른쪽의 Active-Active 구조에서는 두 노드가 모두 쓰기를 받습니다 클라이언트 A가 노드 A에 특정 행을 수정하는 동안 클라이언트 B가 노드 B에 동일한 행을 수정할 수 있습니다 양방향 복제가 이 두 변경을 서로에게 전달하면, 어느 쪽 값을 최종 상태로 삼을지 결정해야 하는 충돌이 발생합니다 이를 해결하려면 last-write-wins, 벡터 클럭, CRDT 같은 추가 메커니즘이 필요합니다

Active-Passive는 이 복잡도를 역할 비대칭으로 차단합니다 충돌 해소 로직을 구현하는 대신, 충돌이 일어날 수 있는 구조 자체를 만들지 않습니다

### subscriber 읽기 전용 강제 방법

Passive 노드를 물리적으로 읽기 전용으로 만드는 방법은 두 가지입니다

**PostgreSQL 파라미터로 강제 (권장)**:

```sql
-- parameter group 또는 postgresql.conf에서 설정
ALTER SYSTEM SET default_transaction_read_only = on;
SELECT pg_reload_conf();
```

`default_transaction_read_only=on`을 설정하면 해당 인스턴스에 연결한 모든 세션의 트랜잭션이 기본적으로 읽기 전용으로 시작됩니다 쓰기를 시도하면 다음과 같은 오류가 즉시 반환됩니다

```text
ERROR:  cannot execute INSERT in a read-only transaction
```

이 설정은 DB 인스턴스 수준에서 적용되므로, 애플리케이션 코드가 실수로 잘못된 엔드포인트에 쓰기를 보내더라도 DB가 거부합니다 애플리케이션 레이어의 실수를 DB 레이어에서 이중으로 방어합니다

**AWS RDS의 경우 Terraform으로 강제**:

```hcl
resource "aws_db_parameter_group" "goti_pg_passive" {
  name   = "goti-pg-passive"
  family = "postgres16"

  parameter {
    name         = "default_transaction_read_only"
    value        = "on"
    apply_method = "immediate"
  }
}
```

`apply_method = "immediate"`를 지정하면 인스턴스 재시작 없이 즉시 적용됩니다 Failover 시에는 이 파라미터를 `off`로 전환하여 Passive가 Active로 역할을 승격합니다

**`hot_standby`와의 차이**: PostgreSQL의 streaming replication standby도 기본적으로 읽기 전용입니다 그러나 이는 `hot_standby=on` 설정에 의한 것으로, standby가 복제를 수신하는 중이라는 상태에 따른 제약입니다 pglogical subscriber처럼 독립적으로 운영되는 인스턴스에서는 `default_transaction_read_only=on`을 명시적으로 설정해야 합니다

### 쓰기 위치 대칭으로 읽기 배치

Active-Passive 토폴로지에서 읽기를 어디서 처리할지는 **쓰기 위치 대칭** 원칙으로 결정합니다 쓰기가 일어나는 Active 노드 근처에 읽기 경로도 함께 배치합니다 이 원칙이 중요한 이유는 복제 지연(replication lag) 때문입니다

Active에서 쓰기가 발생하고 Passive에 복제가 완료되기까지 약간의 시간이 걸립니다 이 구간에 Passive에서 해당 행을 읽으면 방금 쓴 값이 아닌 이전 값이 반환될 수 있습니다 이를 **읽기 후 쓰기 일관성(read-your-writes consistency) 위반**이라고 합니다

해결 방법은 단순합니다 **쓰기와 같은 CSP·리전에서 읽기도 처리합니다** Active가 GCP에 있으면 GCP 내에서도 읽기를 처리하고, AWS Passive에는 지연에 덜 민감한 읽기만 보냅니다 go-ti에서는 hot path(쓰기 직후 즉시 읽기)를 모두 PgBouncer-RW(GCP, Active)로 라우팅하고, 복제 지연에 덜 민감한 load-observer 같은 비중요 읽기만 PgBouncer-RO로 분리했습니다

---

## 📐 세부 동작과 옵션

### Active-Passive vs Active-Active 비교

| 항목 | Active-Passive | Active-Active |
|---|---|---|
| 쓰기 경로 | 단일 (Active만) | 다중 (양쪽 모두) |
| 쓰기 충돌 | 구조적으로 없음 | 충돌 해소 로직 필요 |
| 읽기 확장 | Passive에서 읽기 분산 | 양쪽에서 분산 가능 |
| Failover | Active 승격 필요 (수초~수분) | 즉시 전환 가능 |
| 운영 복잡도 | 낮음 | 높음 (충돌 모니터링 포함) |
| 적합 사례 | 일관성 우선, 단순 HA | 지연 최소화, 멀티리전 쓰기 |

충돌이 없다는 단순함이 Active-Passive의 핵심 장점입니다 티켓팅처럼 데이터 정합성이 최우선인 도메인에서는 Active-Active의 복잡도를 감수할 필요가 없습니다

### Failover 시 역할 전환

Failover는 Passive를 Active로 승격하는 과정입니다 주요 단계는 다음과 같습니다

```text
1. Active 노드 장애 감지
2. Passive에서 default_transaction_read_only = off 전환
3. 애플리케이션 엔드포인트를 Passive 주소로 변경
4. (복구 후) 구 Active가 새 Passive로 역할 전환
```

`default_transaction_read_only=on`은 Failover 진입 지점이기도 합니다 이 값을 Terraform parameter group으로 관리하면 Failover runbook 자동화에 포함시킬 수 있습니다

### 복제 지연과 읽기 일관성

pglogical 복제는 비동기이므로 Active와 Passive 사이에 항상 약간의 지연이 있습니다 지연 상태는 다음 쿼리로 확인합니다

```sql
-- subscriber에서 확인
SELECT application_name,
       write_lag, flush_lag, replay_lag
FROM   pg_stat_replication;
```

지연이 크면 복제 슬롯이 WAL을 계속 쌓아 Active 디스크를 압박합니다 `max_slot_wal_keep_size` 파라미터로 상한을 지정해 catastrophic한 디스크 소진을 방어합니다

```sql
-- postgresql.conf 또는 ALTER SYSTEM
ALTER SYSTEM SET max_slot_wal_keep_size = '5GB';
```

---

## 🧩 go-ti에서는

go-ti에서는 GCP Cloud SQL이 pglogical extension을 허용하지 않아 GCE VM(`pg-primary`)을 Active 노드로 구성했습니다 AWS RDS를 Passive subscriber로 연결하여 GCP→AWS cross-cloud Active-Passive 토폴로지를 구성합니다 AWS RDS는 Terraform parameter group으로 `default_transaction_read_only=on`을 즉시 적용하여 쓰기를 원천 차단했고, 시연 환경에서 `SELECT` OK / `INSERT` 실패를 직접 확인했습니다

쓰기 위치 대칭 원칙에 따라 GCP 내 PgBouncer를 RW/RO 2개 Deployment로 분리하고 Helm values에 `database.url_rw` / `database.url_ro` 두 엔드포인트를 주입했습니다 hot path(ticketing, payment, queue)는 모두 RW, load-observer는 RO로 강제 라우팅합니다 Redis SoT가 hot path의 주 경로이므로 PG 자체의 읽기 부하는 크지 않았지만, 엔드포인트 분리 자체는 Phase B 이후 읽기 확장의 기반이 됩니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [Active-Passive 복제 토폴로지 도입 — PgBouncer RW/RO 분리 결정](/logs/goti-db-active-passive-with-read-split-adr)에 정리했습니다

---

## 📚 핵심 정리

- Active-Passive는 한 노드(Active)만 쓰기를 받고 나머지(Passive)는 읽기 전용으로 운영하는 비대칭 복제 구조입니다 단일 쓰기 지점이 동시 쓰기 충돌을 구조적으로 차단합니다
- `default_transaction_read_only=on`은 Passive 노드를 DB 수준에서 읽기 전용으로 강제합니다 애플리케이션 실수로 잘못된 엔드포인트에 쓰기가 도달해도 DB가 거부하는 이중 방어입니다
- 쓰기 위치 대칭 원칙에 따라 읽기를 배치합니다 Active와 같은 리전에서 읽기도 처리하면 복제 지연으로 인한 읽기 일관성 문제를 피할 수 있습니다
- Active-Active 대비 Failover 시 역할 전환이 필요하다는 단점이 있지만, 충돌 해소 로직이 불필요한 운영 단순함이 trade-off로 성립합니다
- Failover는 Passive의 `default_transaction_read_only=off` 전환으로 시작합니다 Terraform으로 parameter group을 관리하면 runbook 자동화에 자연스럽게 포함됩니다
