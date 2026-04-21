# ADR 0019 — Active-Passive + 쓰기 위치 대칭 읽기 Replica

- 상태: Accepted
- 결정일: 2026-04-18
- 관련 ADR: `0018-multicloud-db-replication-technology.md` (기술 선정), `0020-db-failback-reverse-replication.md` (Failback)
- 영향 레포: Goti-Terraform, Goti-k8s, Goti-go

## 컨텍스트

ADR-0018 에서 GCE VM + pglogical 2.x 를 확정. 다음 결정: **어떤 구조로 쓰기·읽기를 배치할 것인가.**

사용자 요구사항:

> "쓰기 DB 가 있는 곳은 읽기 DB 도 있어야 된다. 지금 GCP 가 메인이면 GCP 에 쓰기+읽기, AWS 에 읽기."

즉 **각 CSP 내부에서 쓰기/읽기가 분리되어야 하고**, cross-cloud 로도 읽기 복제본이 유지되어야 한다.

### 실관측

- GCP Cloud SQL 은 앱 트래픽을 100% 흡수 중. 읽기·쓰기 구분 없이 단일 인스턴스 사용. PgBouncer 는 `pool_mode=session` 으로 connection fan-out 만 담당 (ADR-0013).
- AWS RDS 는 현재 꺼진 EKS 로 인해 트래픽 0. 단 RDS 자체는 가동 중 ($5/day 과금).
- 서비스 스키마 분리: PgBouncer configmap 에 `user_service`, `ticketing_service`, `payment_service`, `resale_service`, `stadium_service`, `queue_service` 6개 schema 를 `search_path` 로 라우팅.
- Cloud SQL 에 이미 서비스별 RO 사용자 5개 존재 (`goti_user_ro` 등). 읽기 분리 인프라는 앱 쪽에서 URL 만 교체하면 즉시 활용 가능.

### 기존 결정 한계

- ADR-0012: AWS RDS Read Replica 만 다룸. GCP 쪽 구조 미정의.
- PgBouncer configmap: 현재 host 가 단일 `DB_HOST_PLACEHOLDER` 로 렌더링. RW/RO 분리 엔드포인트 지원 구조 아님.

## 고려한 대안

| # | 대안 | 기각 사유 |
|---|---|---|
| A | 쓰기·읽기 분리 없이 단일 primary 만 운영 | 사용자 요구사항 불충족. 읽기 부하가 primary 에 누적되면 티켓팅 hot path 에서 쓰기 지연 발생. |
| B | Pgpool / HAProxy 로 앱 투명 read/write split | 추가 오버레이 + 학습 비용. PgBouncer 는 read/write split 미지원이라 이중 프록시 필요. 1주 시연 범위 초과. |
| C | 애플리케이션 계층에서 RW/RO 커넥션 풀 직접 관리 | sqlc 기반 Go 코드 전면 리팩터링 필요. 시간 부족 + 회귀 리스크. |
| D | PgBouncer 인스턴스 2벌 (RW/RO 각각) + Helm values 에서 엔드포인트만 2개 주입 | 구현 단순, 기존 코드 변경 최소. **채택 후보**. |

## 결정

**D안 채택. PgBouncer 를 RW/RO 2개 Deployment 로 띄우고 Helm values 에서 엔드포인트 2개를 주입한다.**

### 전체 구조

```
[정상 상태 — GCP primary]

  ┌──────────────────────────────────────────────────────────┐
  │  GCP  (asia-northeast3)                                  │
  │                                                           │
  │   goti-* Go 서비스                                         │
  │     ├─▶ PgBouncer-RW (deployment, rw endpoint)           │
  │     │     └─▶ goti-pg-primary (GCE VM, PG16+pglogical)   │
  │     │                                                     │
  │     └─▶ PgBouncer-RO (deployment, ro endpoint)           │
  │           ├─▶ goti-pg-primary (읽기 허용, 쓰기 없는 경로)    │
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

### PgBouncer 분리 스펙

| 구분 | 대상 | pool_mode | 비고 |
|------|------|-----------|------|
| pgbouncer-rw | `primary-vm:5432` 단독 | session | 쓰기·읽기 모두. hot path 는 이쪽 |
| pgbouncer-ro | `primary-vm, standby-vm` 라운드로빈 | session | load-observer, 리포팅, 비hot path 읽기 |

- Deployment replica 2개씩. Service 는 `goti-pgbouncer-rw`, `goti-pgbouncer-ro` 로 분리.
- Helm values 에 `database.url_rw`, `database.url_ro` 2개 주입.
- 기존 `DATABASE_URL` 호환을 위해 `url_rw` 를 default 로 유지하고, RO 를 쓰는 서비스만 `url_ro` 참조.

### 읽기 라우팅 1주 범위 (최소)

- hot path (ticketing, payment, queue): **전부 RW** 사용. 읽기 분리 시도는 스코프 외. Redis SoT 가 주 경로이므로 PG 자체가 핫패스 아님.
- goti-load-observer: **RO** 강제. 이미 `goti_observer_ro` 사용자로 동작 중이므로 `url_ro` 로 변경만.
- reporting / audit 경로 (추후): RO 사용 가능. 1주 시연 내 도입 여부는 필요 시 결정.

### Cross-cloud 쓰기 정책

- **AWS RDS 는 subscriber 로서 `default_transaction_read_only = on`.** 앱이 실수로 AWS 에 쓰면 즉시 실패.
- **GCP 에서 INSERT 한 row 가 AWS 에 반영되는 것만 허용.** 반대 경로는 Failover 이후에만 활성.
- **pglogical replication_set 구성:**
  - `default` set: 모든 서비스 스키마 테이블 (INSERT/UPDATE/DELETE)
  - `default_insert_only` set: audit 로그 성격 테이블 (있다면)
  - `ddl_sql` set: pglogical 자체의 DDL 복제 큐
- **시퀀스 복제**: `pglogical.replication_set_add_all_sequences()` 로 모든 sequence 를 default set 에 포함. Failback 시 AWS → GCP 방향에서도 동일 원칙.

### 결정 규칙 (불변)

1. **AWS RDS 직접 쓰기 금지** (Failover 전까지). `default_transaction_read_only=on` 은 Terraform parameter group 로 강제.
2. **PgBouncer-RO 로 hot path 라우팅 금지** (1주 시연 범위). 이후 reporting 확장 시 별도 검토.
3. **GCP standby 는 Phase B 에서만 활성**. Phase A 단계는 primary VM 단일 운영.
4. **pglogical replication_set 에 sequence 누락 금지** — 시퀀스 누락 시 PK 중복 → 티켓 중복 판매 위험.
5. **goti_*_ro 사용자는 Phase A 이전에 GCE VM 에도 동일하게 재생성**. Cloud SQL 해지 후 사라지지 않도록.

## 결과

### 목표 지표

- GCP 내 RW/RO 엔드포인트 분리 완료 (PgBouncer Deployment 2벌)
- `goti-load-observer` 트래픽이 `pgbouncer-ro` 경로로 100% 전환
- AWS RDS subscriber 가 `default_transaction_read_only=on` 상태 확인 (시연 시 `SELECT` OK, `INSERT` 실패 증명)
- pglogical replication_set 에 모든 테이블 + 모든 sequence 포함

### 비용

- PgBouncer-RO Deployment 추가 = pod 2대 × `resources.requests.cpu=100m, memory=128Mi`. GKE core 노드 여유 내 흡수. 신규 VM 불필요.
- Phase B 에서 GCE VM standby 추가 시점에 +$55/월 + pd-balanced 20GB $2/월.

### 리스크

- **RW/RO 잘못 매핑** — 서비스가 `url_rw` 써야 하는데 `url_ro` 쓰면 쓰기 실패. Helm values 에 서비스별 명시 + 배포 후 smoke test 필수.
- **pglogical replication lag 누적** — Phase B 에서 AWS subscriber 가 따라오지 못하면 primary WAL slot 팽창. `max_slot_wal_keep_size=5GB` 설정으로 catastrophic 방어. 모니터링은 Phase B 에서 PrometheusRule 로 감시.
- **시퀀스 중복 발행 위험** — pglogical 은 sequence 복제 지원하지만 "마지막 값" 기준이라 Failover 직후 구간에서 gap 발생 가능. Failover runbook 에 `ALTER SEQUENCE ... RESTART WITH pg_sequence_last_value(...) + 1000` 안전 margin 반영.

### Reversibility

- PgBouncer 분리 롤백: Helm values 에서 `url_ro` 를 `url_rw` 와 동일 값으로 교체. 즉시 단일 엔드포인트로 복귀.
- 쓰기 정책 롤백: AWS RDS parameter group 에서 `default_transaction_read_only` 해제. 단 이는 Failover 경로의 일부이므로 "롤백" 이 아니라 "Failover 진행" 으로 간주.

## 후속

1. PgBouncer Helm chart 에 RW/RO 2 Deployment 패턴 추가 (Phase A)
2. `goti-load-observer` values 에서 `url_ro` 사용 전환 (Phase A 마무리)
3. AWS RDS parameter group 에 `default_transaction_read_only=on` 추가 (Phase B)
4. pglogical replication_set 구성 스크립트 (`feature/db-sync-phase-b` 브랜치)

## 진행 상태 (2026-04-18)

| 작업 | 상태 | 비고 |
|---|---|---|
| pg-primary VM 운영 + 단일 Primary | ✅ 완료 | ADR-0018 Phase A |
| svc RO 사용자 6개 VM 생성 | ✅ 완료 | Migration Job 완료 |
| DATASOURCE_URL Takeover (host 교체) | ✅ 완료 | `enable_pg_primary_takeover=true` |
| PgBouncer RW/RO Deployment 분리 | ⏳ 미착수 | hot path 가 Redis SoT 라 우선순위 낮음 |
| AWS RDS `default_transaction_read_only=on` | ✅ 완료 | parameter group immediate apply |
| AWS RDS subscription 생성 | ✅ 완료 | `sub_from_gcp_primary` |
| RO 사용자 활용 쿼리 분리 (load-observer 등) | 🟡 설정만 반영 | hot path 쓰기는 여전히 master |
| 시퀀스 전체 replication_set 포함 | ✅ 완료 | `replication_set_add_all_sequences` |
| orders/payments 재sync | ❌ 미완 | AWS 기존 잔재로 PK 충돌. `alter_subscription_resynchronize_table` 필요 |

**본 ADR 의 결정 규칙 1~5 는 모두 반영 유지 중**. 규칙 4 (시퀀스 누락 금지) 는 publisher 쪽 구성 완료. subscriber 쪽 데이터 정합성만 별도 복구 필요.
