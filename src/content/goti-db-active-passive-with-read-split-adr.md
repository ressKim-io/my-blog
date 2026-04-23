---
title: "Active-Passive + Read Split 설계 — 쓰기 위치에 읽기 엔드포인트를 대칭 배치한 이유"
excerpt: "GCP에 쓰기가 있으니 GCP에 읽기도 있어야 한다는 요구를 출발점으로, PgBouncer를 RW/RO 두 Deployment로 쪼개 Multi-Cloud DB 경로를 설계했습니다. AWS RDS는 subscriber로서 강제 read-only, GCP는 primary + standby 구조입니다."
category: kubernetes
tags:
  - go-ti
  - PostgreSQL
  - Multi-Cloud
  - Active-Passive
  - ReadSplit
  - ADR
series:
  name: "goti-multicloud-db"
  order: 3
date: "2026-04-18"
---

## 한 줄 요약

> pglogical 기반 복제 토폴로지를 확정한 뒤, 각 CSP 내부에서 쓰기와 읽기가 어떻게 배치될지 결정해야 했습니다. PgBouncer를 RW/RO 두 Deployment로 분리하고, AWS RDS는 파라미터 그룹 수준에서 read-only를 강제하는 Active-Passive 구조를 채택했습니다.

---

## 배경

ADR 0018에서 GCE VM + pglogical 2.x 조합으로 Multi-Cloud 복제 기술을 확정했습니다.
다음 결정은 토폴로지 위에 **쓰기·읽기를 어떻게 배치할 것인가**였습니다.

사용자의 요구사항은 간결했습니다.

> "쓰기 DB가 있는 곳은 읽기 DB도 있어야 합니다. 지금 GCP가 메인이면 GCP에 쓰기+읽기, AWS에 읽기."

즉 **각 CSP 내부에서 쓰기/읽기가 분리되어야 하고**, 동시에 cross-cloud로 읽기 복제본이 유지되어야 했습니다.

### 실제 관측된 상태

- GCP Cloud SQL은 앱 트래픽을 100% 흡수 중이었습니다. 읽기/쓰기 구분 없이 단일 인스턴스를 쓰고 있었습니다.
- PgBouncer는 `pool_mode=session`으로 connection fan-out만 담당하고 있었습니다(ADR 0013).
- AWS RDS는 EKS를 내리면서 트래픽이 0이 되었지만, RDS 자체는 가동 중이라 하루 약 5달러씩 비용이 발생하고 있었습니다.
- 서비스 스키마 분리는 이미 PgBouncer configmap에서 `search_path`로 라우팅하고 있었습니다. `user_service`, `ticketing_service`, `payment_service`, `resale_service`, `stadium_service`, `queue_service` 6개 스키마가 있었습니다.
- Cloud SQL에는 이미 서비스별 RO 사용자 5개가 생성되어 있었습니다(`goti_user_ro` 등).

읽기 분리 인프라는 앱 쪽에서 URL만 교체하면 즉시 쓸 수 있는 상태였다는 점이 중요했습니다.

### 기존 결정의 한계

ADR 0012는 AWS RDS의 Read Replica만 다뤘고, GCP 쪽 구조는 정의되어 있지 않았습니다.
PgBouncer configmap은 현재 `DB_HOST_PLACEHOLDER`라는 단일 host로 렌더링되어 있어, RW/RO 분리 엔드포인트를 지원할 구조가 아니었습니다.

---

## 고려한 대안

| # | 대안 | 기각 사유 |
|---|---|---|
| A | 쓰기·읽기 분리 없이 단일 primary만 운영 | 사용자 요구사항 불충족. 읽기 부하가 primary에 누적되면 티켓팅 hot path에서 쓰기 지연이 발생합니다. |
| B | Pgpool / HAProxy로 앱 투명 read/write split | 추가 오버레이 + 학습 비용. PgBouncer는 read/write split을 지원하지 않아 이중 프록시가 필요합니다. 1주 시연 범위를 초과합니다. |
| C | 애플리케이션 계층에서 RW/RO 커넥션 풀 직접 관리 | sqlc 기반 Go 코드 전면 리팩터링이 필요합니다. 시간 부족과 회귀 리스크가 큽니다. |
| D | PgBouncer 인스턴스 2벌(RW/RO 각각) + Helm values에서 엔드포인트만 2개 주입 | 구현이 단순하고 기존 코드 변경이 최소입니다. **채택 후보**입니다. |

A안은 요구사항 자체를 충족하지 못해 즉시 기각했습니다.
B안의 Pgpool/HAProxy는 read/write 쿼리를 자동으로 분배한다는 점에서 매력적이지만, PgBouncer 앞에 다시 한 레이어가 들어가는 이중 프록시 구조가 됩니다.
각 프록시마다 커넥션 풀이 쌓이므로 관측·디버깅이 복잡해지고, 1주 시연 일정에 맞추기 어려웠습니다.

C안은 애플리케이션 계층에서 가장 깔끔한 해법이지만, 현재 Go 코드는 sqlc로 생성된 쿼리 함수가 단일 DB 커넥션을 전제로 작성되어 있었습니다.
RW/RO 분리를 위해서는 각 쿼리가 RW인지 RO인지를 타입 수준에서 표현해야 하는데, 이는 코드 생성기 설정과 상위 호출부까지 함께 고쳐야 하는 변경이었습니다.
회귀 리스크가 시연 일정 대비 너무 컸습니다.

---

## 결정

**D안을 채택했습니다.**
PgBouncer를 RW/RO 2개 Deployment로 띄우고, Helm values에서 엔드포인트 2개를 주입하는 방식입니다.

### 전체 구조

```text
[정상 상태 — GCP primary]

  ┌──────────────────────────────────────────────────────────┐
  │  GCP  (asia-northeast3)                                  │
  │                                                           │
  │   goti-* Go 서비스                                         │
  │     ├─▶ PgBouncer-RW (deployment, rw endpoint)           │
  │     │     └─▶ goti-pg-primary (GCE VM, PG16+pglogical)   │
  │     │                                                     │
  │     └─▶ PgBouncer-RO (deployment, ro endpoint)           │
  │           ├─▶ goti-pg-primary (읽기 허용)                   │
  │           └─▶ goti-pg-standby (streaming replica, PhaseB) │
  │                                                           │
  │   goti-pg-primary ─(pglogical publication)──┐             │
  └───────────────────────────────────────────────┼─────────┘
                                                   │ TLS verify-full
                                                   │ public IP + allowlist
                                                   ▼
  ┌────────────────────────────────────────────────────────┐
  │  AWS  (ap-northeast-2)                                 │
  │                                                         │
  │   goti-* Go 서비스 (EKS, Phase B 시연일)                 │
  │     └─▶ PgBouncer-RO only                               │
  │           └─▶ AWS RDS (pglogical subscriber, read_only) │
  │                                                         │
  │   AWS RDS: default_transaction_read_only = on           │
  │            (Failover 시점에 off 전환)                     │
  └────────────────────────────────────────────────────────┘
```

이 다이어그램에는 네 가지 결정이 녹아 있습니다.

첫째, **GCP에서는 RW와 RO가 각각 별개 PgBouncer Deployment**입니다.
단일 인스턴스에서 사용자별 권한으로만 나누면 풀이 섞여 RO 쿼리가 RW 풀 슬롯을 점유할 위험이 있습니다.
Deployment를 나누면 커넥션 풀 자체가 분리되어 상호 간섭이 없습니다.

둘째, **AWS에는 PgBouncer-RO만 존재**합니다.
subscriber 역할인 AWS RDS는 쓰기 트래픽을 절대 받지 않아야 하므로, RW 엔드포인트 자체를 만들지 않습니다.
추가로 RDS 파라미터 그룹에서 `default_transaction_read_only=on`을 강제해 이중 안전장치를 둡니다.

셋째, **GCP standby VM은 Phase B에서만 활성화**됩니다.
Phase A 단계에서는 primary VM 하나만 운영하고, PgBouncer-RO도 primary를 바라봅니다.
이 단계에서는 "읽기 전용 접근점"이라는 인터페이스만 먼저 만들어 두고, 실제 읽기 부하 분산은 standby 합류 후 자연스럽게 얻는 구조입니다.

넷째, **pglogical 복제는 GCP → AWS 단방향**입니다.
AWS에서 GCP로 거슬러 올라가는 경로는 ADR 0020(Failback)에서 다룹니다.

### PgBouncer 분리 스펙

| 구분 | 대상 | pool_mode | 비고 |
|------|------|-----------|------|
| pgbouncer-rw | `primary-vm:5432` 단독 | session | 쓰기·읽기 모두. hot path는 이쪽 |
| pgbouncer-ro | `primary-vm, standby-vm` 라운드로빈 | session | load-observer, 리포팅, 비 hot path 읽기 |

각 Deployment는 replica 2개씩 띄우고, Service는 `goti-pgbouncer-rw`, `goti-pgbouncer-ro`로 분리했습니다.
Helm values에는 `database.url_rw`와 `database.url_ro` 두 개를 주입합니다.

기존 `DATABASE_URL`과의 호환을 위해 `url_rw`를 default 값으로 유지하고, RO를 사용하는 서비스만 `url_ro`를 명시적으로 참조하도록 했습니다.
이 방식이라면 RO 라우팅이 필요 없는 서비스는 values 파일을 건드릴 필요 없이 기존처럼 동작합니다.

### 읽기 라우팅 1주 범위

시연 일정이 짧아 읽기 분리를 전면 적용할 수는 없었습니다.
범위를 다음과 같이 최소화했습니다.

- **hot path**(ticketing, payment, queue)는 **전부 RW를 사용**합니다. 읽기 분리 시도는 스코프 외로 두었습니다. Redis가 이미 SoT 역할을 하고 있어 PG 자체가 hot path가 아니기 때문에, 굳이 읽기만 분리할 실익이 작았습니다.
- **goti-load-observer**는 **RO를 강제**합니다. 이미 `goti_observer_ro` 사용자로 동작 중이라 values에서 `url_ro` 참조로 바꾸는 것만으로 전환이 끝납니다.
- **리포팅/audit 경로**는 향후 RO로 옮길 수 있지만, 1주 시연 내 도입은 필요에 따라 결정합니다.

### Cross-cloud 쓰기 정책

Cross-cloud 구조에서 가장 위험한 상황은 **양쪽에 쓰기가 동시에 들어가는 split-brain**입니다.
pglogical 2.x는 이 상황을 자동으로 해소하지 못하므로, 쓰기 방향을 정책 수준에서 강제해야 합니다.

- **AWS RDS는 subscriber로서 `default_transaction_read_only = on`** 입니다. 앱이 실수로 AWS에 쓰면 즉시 실패합니다.
- **GCP에서 INSERT한 row가 AWS에 반영되는 것만 허용**합니다. 반대 경로는 Failover 이후에만 활성화됩니다.
- **pglogical replication_set 구성**은 세 가지 set으로 나눕니다.
  - `default` set: 모든 서비스 스키마 테이블 (INSERT/UPDATE/DELETE)
  - `default_insert_only` set: audit 로그 성격 테이블 (있다면)
  - `ddl_sql` set: pglogical 자체의 DDL 복제 큐
- **시퀀스 복제**는 `pglogical.replication_set_add_all_sequences()`로 모든 sequence를 default set에 포함시킵니다. Failback 시 AWS → GCP 방향에서도 동일한 원칙을 적용합니다.

### 결정 규칙 (불변)

본 ADR이 만드는 다섯 개 불변 규칙입니다.

1. **AWS RDS 직접 쓰기 금지**(Failover 전까지). `default_transaction_read_only=on`을 Terraform parameter group으로 강제합니다.
2. **PgBouncer-RO로 hot path를 라우팅하지 않습니다**(1주 시연 범위). 이후 리포팅 확장 시 별도 검토합니다.
3. **GCP standby는 Phase B에서만 활성화**합니다. Phase A 단계는 primary VM 단일 운영입니다.
4. **pglogical replication_set에 sequence 누락 금지**. 시퀀스가 누락되면 PK 중복이 일어나 티켓 중복 판매 위험이 생깁니다.
5. **`goti_*_ro` 사용자는 Phase A 이전에 GCE VM에도 동일하게 재생성**합니다. Cloud SQL이 해지되면서 함께 사라지지 않도록 마이그레이션 Job으로 먼저 옮깁니다.

---

## 근거

### 왜 D안(PgBouncer 2벌)인가

이 결정의 핵심은 "기존 자산을 최대한 활용해 1주 안에 끝낼 수 있는가"였습니다.

B안(Pgpool/HAProxy)은 자동 read/write split이라는 매력이 있지만, 현재 PgBouncer가 그대로 남아 있는 상태에서 앞에 한 레이어가 더 붙는 구조입니다.
프록시 2단을 거치면 커넥션 상태 디버깅이 복잡해지고, 장애 시 "어느 레이어가 원인인지"를 가리는 비용이 커집니다.

C안(앱 레벨 분리)은 이상적이지만, sqlc로 생성된 쿼리 함수가 모두 단일 DB 커넥션을 전제로 작성되어 있어 전면 리팩터링이 필요합니다.
hot path까지 함께 건드려야 하는 작업이라 시연 일정 대비 회귀 리스크가 너무 컸습니다.

D안은 **기존 PgBouncer Helm chart를 거의 그대로 두 벌 띄우는 수준**의 변경으로 요구사항을 충족합니다.
앱 코드는 `url_rw` 또는 `url_ro` 중 하나를 참조하기만 하면 되고, 실제로 RO로 옮기는 서비스는 `goti-load-observer` 하나뿐이라 회귀 영향이 제한적입니다.

### 왜 subscriber 쪽에 read-only를 강제하는가

pglogical 2.x에서 subscriber는 기본적으로 쓰기 가능한 상태입니다.
애플리케이션 수준에서 "AWS에는 쓰지 말아야 한다"는 규칙만 믿기에는 실수 여지가 큽니다.
예를 들어 마이그레이션 스크립트가 잘못된 엔드포인트를 참조하거나, 수동 DBA 작업이 AWS에 잘못 들어가면 양방향 쓰기가 발생합니다.

pglogical은 충돌을 감지하더라도 `last_update_wins` 같은 규칙으로 조용히 덮어쓸 수 있어, 티켓팅처럼 금액·상태가 중요한 데이터에서는 디버깅이 매우 어려워집니다.

그래서 **파라미터 그룹 수준에서 `default_transaction_read_only=on`을 강제**합니다.
이러면 사용자가 아무리 실수해도 AWS에서는 트랜잭션이 열리는 순간 실패합니다.
pglogical 내부의 복제 적용은 별도 세션으로 동작하므로 이 설정의 영향을 받지 않습니다.

### 왜 시퀀스 누락이 가장 큰 위험인가

결정 규칙 4번(시퀀스 누락 금지)이 이 설계에서 가장 크리티컬한 규칙입니다.

pglogical은 기본 설정에서 테이블의 데이터는 복제하지만, **시퀀스는 명시적으로 추가하지 않으면 복제하지 않습니다**.
시퀀스가 복제되지 않으면 Failover 직후 AWS에서 새 INSERT를 할 때, AWS의 시퀀스 값이 GCP에서 이미 사용된 값과 겹칠 수 있습니다.

티켓팅 도메인에서는 `order_id`, `payment_id` 같은 PK가 시퀀스 기반입니다.
PK 중복이 일어나면 INSERT가 실패하는 수준이 아니라, **이미 다른 사용자의 주문에 할당된 PK를 새 주문이 받아 UPDATE하는** 참혹한 시나리오가 가능합니다.

이 위험을 막기 위해 `pglogical.replication_set_add_all_sequences()`를 반드시 실행합니다.
이 호출은 현재 스키마에 있는 모든 시퀀스를 default set에 포함시키며, Failback 시점에도 양방향으로 동일 원칙을 적용합니다.

---

## 결과

### 목표 지표

- GCP 내 RW/RO 엔드포인트 분리 완료(PgBouncer Deployment 2벌)
- `goti-load-observer` 트래픽이 `pgbouncer-ro` 경로로 100% 전환
- AWS RDS subscriber가 `default_transaction_read_only=on` 상태 확인(시연 시 `SELECT` OK, `INSERT` 실패 증명)
- pglogical replication_set에 모든 테이블과 모든 sequence 포함

### 비용

PgBouncer-RO Deployment 추가는 Pod 2대 × `resources.requests.cpu=100m, memory=128Mi` 수준입니다.
GKE core 노드 여유 안에서 흡수되므로 신규 VM은 필요하지 않습니다.

Phase B에서 GCE VM standby를 추가하는 시점에 +55달러/월 + pd-balanced 20GB 약 2달러/월이 추가됩니다.

### 리스크와 완화

- **RW/RO 잘못 매핑**: 서비스가 `url_rw`를 써야 하는데 `url_ro`를 쓰면 쓰기가 실패합니다. Helm values에 서비스별로 명시하고, 배포 후 smoke test로 `INSERT` 한 번을 확인합니다.
- **pglogical replication lag 누적**: Phase B에서 AWS subscriber가 따라오지 못하면 primary WAL slot이 팽창합니다. `max_slot_wal_keep_size=5GB` 설정으로 치명적 팽창은 방어합니다. 모니터링은 Phase B 시점에 PrometheusRule로 별도 감시합니다.
- **시퀀스 중복 발행**: pglogical은 시퀀스 복제를 지원하지만 "마지막 값" 기준이라 Failover 직후 구간에서 gap이 생길 수 있습니다. Failover runbook에 `ALTER SEQUENCE ... RESTART WITH pg_sequence_last_value(...) + 1000` 안전 margin을 반영합니다.

### Reversibility

PgBouncer 분리 롤백은 Helm values에서 `url_ro`를 `url_rw`와 동일한 값으로 교체하면 됩니다.
즉시 단일 엔드포인트 구조로 복귀하므로, 읽기 분리가 문제를 일으켰을 때 수 분 내로 되돌릴 수 있습니다.

쓰기 정책 롤백은 AWS RDS parameter group에서 `default_transaction_read_only`를 해제하는 것이지만, 이는 사실상 Failover 절차의 일부입니다.
"롤백"이 아니라 "Failover 진행"으로 분류하여 별도 runbook으로 관리합니다.

---

## 후속 작업

1. PgBouncer Helm chart에 RW/RO 2 Deployment 패턴 추가(Phase A)
2. `goti-load-observer` values에서 `url_ro` 사용 전환(Phase A 마무리)
3. AWS RDS parameter group에 `default_transaction_read_only=on` 추가(Phase B)
4. pglogical replication_set 구성 스크립트(`feature/db-sync-phase-b` 브랜치)

---

## 진행 상태 (2026-04-18 기준)

| 작업 | 상태 | 비고 |
|---|---|---|
| pg-primary VM 운영 + 단일 Primary | 완료 | ADR 0018 Phase A |
| 서비스별 RO 사용자 6개 VM 생성 | 완료 | Migration Job 완료 |
| DATASOURCE_URL Takeover (host 교체) | 완료 | `enable_pg_primary_takeover=true` |
| PgBouncer RW/RO Deployment 분리 | 미착수 | hot path가 Redis SoT라 우선순위 낮음 |
| AWS RDS `default_transaction_read_only=on` | 완료 | parameter group immediate apply |
| AWS RDS subscription 생성 | 완료 | `sub_from_gcp_primary` |
| RO 사용자 활용 쿼리 분리(load-observer 등) | 설정만 반영 | hot path 쓰기는 여전히 master |
| 시퀀스 전체 replication_set 포함 | 완료 | `replication_set_add_all_sequences` |
| orders/payments 재sync | 미완 | AWS 기존 잔재로 PK 충돌. `alter_subscription_resynchronize_table` 필요 |

**본 ADR의 결정 규칙 1~5는 모두 반영을 유지하고 있습니다**.
규칙 4(시퀀스 누락 금지)는 publisher 쪽 구성이 완료되었고, subscriber 쪽 데이터 정합성만 별도 복구가 필요한 상태입니다.
