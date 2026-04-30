---
title: "Multi-Cloud DB 복제 기술 선정 — GCE VM + pglogical 2.x를 택한 이유"
excerpt: "Cloud SQL은 pglogical extension을 허용하지 않고, Patroni/AlloyDB는 1주 시연 대비 과투자였습니다. GCE VM PostgreSQL 16 + pglogical 2.x로 cross-cloud 복제를 구성한 결정 과정입니다."
category: kubernetes
tags:
  - go-ti
  - PostgreSQL
  - pglogical
  - Multi-Cloud
  - Replication
  - ADR
series:
  name: "goti-multicloud-db"
  order: 2
date: "2026-04-18"
---

## 한 줄 요약

> GCP Primary + AWS Subscriber 구조의 Multi-Cloud DB 복제를 구성해야 했습니다. Cloud SQL은 pglogical을 허용하지 않고, Patroni/AlloyDB는 1주 시연 대비 과투자였습니다. GCE VM PostgreSQL 16 + pglogical 2.x로 시퀀스·DDL까지 복제 가능한 경로를 선택했습니다.

---

## 배경

### 목표

Multi-Cloud 환경(GCP 메인 + AWS 보조)에서 DB 동기화를 구성해야 했습니다. 요구사항은 네 가지입니다.

첫째, **쓰기 DB가 있는 곳에 읽기 DB도 대칭으로 배치**합니다. 현재 GCP가 primary이므로 GCP에 쓰기+읽기를 두고, AWS에는 읽기만 둡니다. Failover 후 방향이 전환되어도 대칭이 유지되어야 합니다.

둘째, **시퀀스와 PK 정합성 보장**입니다. 티켓팅 도메인 특성상 `ticket_id`, `order_id` 같은 식별자의 중복 발행은 치명적입니다. Failover/Failback 구간에서 시퀀스 드리프트가 발생해서는 안 됩니다.

셋째, **DDL 재현 가능성**입니다. 스키마 변경 시 양쪽이 동일 상태로 유지되어야 합니다.

넷째, **Cross-cloud 네트워크로 동작**해야 합니다. VPN 없이도 TLS + IP allowlist로 cross-cloud 복제가 가능해야 합니다. VPN 구축은 비용과 시간상 1주 시연 범위를 초과합니다.

### 실관측 제약 (Terraform / GCP quota)

실제 환경에서 확인된 제약은 다음과 같습니다.

- GCP 현재 DB: Cloud SQL `db-custom-2-3840` (ZONAL, POSTGRES_16, private IP `10.5.0.2`). **extensions allowlist에 pglogical이 없습니다.**
- GCP `SSD_TOTAL_GB` quota **97%** 사용 (290/300GB, pd-balanced 포함). 고용량 VM/디스크 증설이 불가합니다.
- AWS 현재 DB: RDS `db.r6g.large` (PG 16). `shared_preload_libraries` 조정이 가능하고 pglogical 2.x를 지원합니다.
- AWS ↔ GCP 간 **VPN 미구축** (기존 Terraform 확인 결과).
- 프로젝트 운영 기간: 약 2026-04-24까지 (1주 시연 범위).

이 중 가장 결정적인 제약은 **Cloud SQL이 pglogical extension을 수용하지 않는다**는 점입니다. Google Cloud의 managed PostgreSQL은 extensions allowlist를 엄격히 관리하며, pglogical은 이 목록에 없습니다. 사용자가 `CREATE EXTENSION pglogical`을 실행할 수 없고, `shared_preload_libraries` 파라미터도 직접 건드릴 수 없습니다.

### 기존 결정의 한계

ADR-0012 (Read Replica 분리)는 AWS RDS native Read Replica 구현만 다뤘습니다. Cross-cloud 복제는 범위 밖이었습니다.

Multi-Cloud 계획 메모에는 "pglogical 기반 Active-Passive (RDS↔Cloud SQL)"라고만 기술되어 있었습니다. Cloud SQL이 pglogical extension을 수용하지 못하는 현실 제약은 계획 단계에서 고려되지 않았습니다.

---

## 고려한 대안

여섯 가지 대안을 검토했습니다. 각 대안별 기각 사유는 다음과 같습니다.

### A. Cloud SQL publisher + built-in logical replication

Cloud SQL이 기본 제공하는 logical replication을 쓰는 방식입니다.

**시퀀스 복제가 불가능**합니다. Failback 시 PK 점프나 중복이 발생할 수 있습니다. DDL 복제도 없고, 양방향·충돌 해결 기능도 제공되지 않습니다. 티켓팅 도메인 요구사항을 만족하지 못해 기각했습니다.

### B. Cloud SQL + Cloud SQL Read Replica (GCP 내) + AWS external replica

Cloud SQL의 external replica 기능을 활용하는 방식입니다.

Cloud SQL external replica 경로가 **AWS RDS를 subscriber로 지원하지 않습니다**. 공식적으로는 GCE VM에 외부 replica를 설치하는 것만 지원합니다. 결국 중간 VM이 필요하므로 경로만 길어지고 이점이 사라져 기각했습니다.

### C. AlloyDB publisher + AWS RDS subscriber

AlloyDB를 primary로 쓰고 AWS RDS를 subscriber로 연결하는 방식입니다.

AlloyDB는 시간당 $1이 넘습니다. 1주 시연으로 환산하면 $168입니다. 시연 규모 대비 과투자입니다. 또한 AlloyDB의 pglogical 공식 지원이 확정되지 않았습니다. 비용과 불확실성이 동시에 걸려 기각했습니다.

### D. GCE VM PostgreSQL + Patroni HA + etcd 3-node + pglogical

정석 HA 경로입니다. VM 3대 + etcd 3대 = 총 6대가 필요합니다.

`e2-standard-2` 기준 월 $400이 넘습니다. Patroni와 etcd의 학습·운영 오버헤드도 1주 시연 대비 과대합니다. 사용자 확인 결과 1주 시연 범위에서는 HA 요구사항 자체가 없어 기각했습니다.

### E. AWS DMS / GCP Datastream

클라우드 벤더의 managed 마이그레이션 서비스입니다.

벤더 락인이 강하고, source/target 제약이 많습니다. 시퀀스와 DDL 커버리지도 제한적이며, cross-cloud subscriber 지원에도 한계가 있습니다. 티켓팅 요구사항을 충족시키기 어려워 기각했습니다.

### F. Bucardo / Debezium+Kafka

오픈소스 복제 도구 조합입니다.

Bucardo는 트리거 오버헤드가 큽니다. Debezium+Kafka는 Kafka 인프라 의존이 필요한데, 현재 goti-k8s에서는 Strimzi를 제거하는 방향입니다. 학습과 운영 비용이 모두 높아 기각했습니다.

---

## 결정

**GCE VM PostgreSQL 16 + pglogical 2.x를 채택합니다. Patroni/etcd는 생략합니다.**

### 구조

```text
[GCP — Primary]
  GCE VM (e2-standard-2, pd-balanced 20GB)
    ├─ PostgreSQL 16
    ├─ pglogical 2.x extension
    ├─ postgres_exporter (:9187, 모니터링은 Phase B에서 활성)
    ├─ systemd 관리 (pg-primary.service)
    └─ Public IP (static) + Firewall allowlist + TLS (verify-full)
       │
       ├─(streaming replication)─▶ [Phase B] GCE VM standby (읽기 전용)
       │
       └─(pglogical publication) ─▶ [Phase B] AWS RDS (pglogical subscriber)
```

GCP에는 단일 GCE VM에 PostgreSQL과 pglogical을 올립니다. 같은 GCP 리전 내 읽기 분산은 streaming replication(physical)으로 standby를 붙이고, cross-cloud 복제는 pglogical publication/subscription을 이용해 AWS RDS로 보냅니다.

### 핵심 기술 선택

| 항목 | 선택 | 사유 |
|------|------|------|
| Publisher | GCE VM + pglogical 2.x | Cloud SQL pglogical 미지원. pglogical 2.x는 시퀀스·DDL 지원 |
| Subscriber (AWS) | AWS RDS + pglogical 2.x | RDS parameter group에 `shared_preload_libraries=pglogical`, `rds.logical_replication=1` 설정. AWS 공식 지원 |
| Subscriber (GCP 내 읽기) | streaming replication (physical) | pglogical보다 단순·빠름. 같은 PG 인스턴스에서 바로 붙음 |
| HA | 없음 (수동 promote) | 1주 시연, HA 불필요. Patroni/etcd 회피 |
| 네트워크 | Public IP + IP allowlist + TLS verify-full | VPN 구축 시간·비용 회피. AWS NAT IP만 allowlist |
| 비밀번호 | `random_password` + `google_secret_manager_secret` | 기존 database 모듈 패턴과 동일 |
| 디스크 | pd-balanced 20GB (단일) | pd-ssd quota 여유 없음. 실 데이터 ~5GB, 4배 여유 |
| 장기 보존 | Terraform 코드 전량 주석화 금지 | 프로젝트 재개 시 재활용 가능하도록 flag(`enable_pg_primary`)로만 제어 |

위 표에는 제약 조건과 대응이 압축되어 있습니다.

GCE VM을 publisher로 올린 이유는 Cloud SQL이 pglogical을 받아주지 않기 때문입니다. AWS RDS는 반대로 `shared_preload_libraries`에 pglogical을 명시할 수 있고, `rds.logical_replication=1` 파라미터가 공식 문서에 등재되어 있어 subscriber 역할이 가능합니다.

GCP 내부 읽기 replica는 pglogical 대신 streaming replication을 선택했습니다. 동일 인스턴스·동일 버전·동일 extension 세트를 공유하는 환경에서는 physical replication이 설정이 단순하고 lag도 가장 작기 때문입니다.

디스크는 pd-balanced 20GB를 사용합니다. SSD quota가 97%에 도달해 pd-ssd를 추가 할당할 여유가 없습니다. 실 데이터는 약 5GB 수준이라 4배 여유를 두는 20GB면 충분합니다.

### 결정 규칙 (불변)

운영 중 번복되지 않아야 할 네 가지 규칙을 고정했습니다.

1. **Cloud SQL을 pglogical publisher로 전환 금지.** extension allowlist 제약은 Google Cloud의 구조적 한계입니다. Cloud SQL 잔존은 pg-primary 이전 완료 후 삭제합니다.
2. **시퀀스/DDL 자동 동기화 경로 준수.** pglogical 2.x의 `replication_set`에 sequence를 포함시키고, DDL은 `pglogical.replicate_ddl_command()`를 사용합니다. runbook에 명시합니다.
3. **AWS RDS subscriber는 `default_transaction_read_only=on`.** 애플리케이션이 AWS에 대해 SELECT만 가능하도록 제한합니다. Failover 전까지 쓰기를 차단합니다.
4. **Failover는 수동 promote.** 자동 promote는 split-brain 위험이 있고, HA를 도입하지 않았으므로 불가합니다. runbook으로 수동 수행합니다.

### Phase 구분 (main vs feature 브랜치)

시연 범위와 브랜치 전략을 맞추기 위해 두 Phase로 나눴습니다.

| Phase | 브랜치 | 포함 |
|------|--------|------|
| **Phase A** (지금) | `main` | ADR 3건, pg-primary 모듈, 데이터 이전, `DATABASE_URL` 전환 |
| **Phase B** (시연일) | `feature/db-sync-phase-b` | GCE VM standby, AWS RDS parameter group, pglogical subscription, 모니터링 스택 |

Phase B 코드는 `main`으로 merge 후 Terraform apply 시점에 전체 활성화합니다. 이렇게 나눈 이유는 Phase A만으로도 Cloud SQL을 GCE VM으로 이전하여 비용을 줄이고, Phase B는 시연 당일 한 번에 켜서 롤백 면적을 줄이기 위함입니다.

---

## 근거

### 왜 pglogical 2.x인가

pglogical 2.x는 PostgreSQL의 logical decoding 위에서 동작하지만, built-in logical replication이 하지 못하는 세 가지를 제공합니다.

**시퀀스 복제**를 지원합니다. `replication_set`에 sequence를 포함시키면 `pglogical.synchronize_sequence()`로 subscriber의 시퀀스 값을 primary와 맞출 수 있습니다. 티켓팅의 `ticket_id`, `order_id`가 Failback 후에도 중복되지 않는 근거입니다.

**DDL 복제**를 지원합니다. `pglogical.replicate_ddl_command()`로 실행한 DDL은 subscription을 따라 전파됩니다. built-in replication은 DDL을 아예 복제하지 않아 스키마 마이그레이션 때마다 양쪽에서 따로 실행해야 합니다.

**행 필터링과 컬럼 필터링**을 지원합니다. 현재 요구사항에는 필요하지 않지만, 이후 읽기 워크로드 분할 단계에서 특정 테이블만 subscribe하는 구성이 가능합니다.

### 왜 Patroni/etcd를 생략했는가

정석 구성으로는 Patroni + etcd로 자동 failover HA를 구성합니다. 이번에는 의도적으로 생략했습니다.

1주 시연 범위에서 **HA가 요구사항이 아닙니다**. 자동 failover 시나리오 없이도 시연은 성립합니다. Patroni + etcd를 올리면 VM 6대(Primary/Standby 각 1 + etcd 3)가 추가되고, 월 비용이 $400 이상 증가합니다.

또한 Patroni 운영은 **학습 곡선이 가파릅니다**. DCS(etcd) 장애 시나리오, witness 노드 구성, failover 정책 튜닝 등 숙지해야 할 항목이 많습니다. 1주 시연 일정에서 이 학습 비용을 지불할 가치가 낮습니다.

장기 운영이 재개되면 Patroni 복귀 또는 Cloud SQL 복귀를 **별도 ADR로 재평가**합니다. 이번 결정은 명시적으로 "1주 시연용"이라는 제약 아래에서만 유효합니다.

### 왜 VPN 대신 Public IP + IP allowlist + TLS인가

VPN이 더 안전한 경로입니다. 다만 AWS와 GCP 간 VPN 구성은 다음 작업을 요구합니다.

- GCP HA VPN gateway + AWS VPN Gateway 생성
- Customer Gateway, BGP peering 설정
- 양쪽 VPC 라우팅 테이블 수정
- VPN 통신 비용(시간당 과금 + 트래픽 과금)

1주 시연 범위에서 이 전부를 구축하고 검증하는 시간·비용을 감당하기 어렵습니다.

대신 다음 세 가지를 모두 적용해 보안 모델을 방어적으로 구성합니다.

- **Static external IP + Firewall allowlist**: AWS NAT IP(`15.164.8.237/32`)만 inbound 허용.
- **TLS verify-full**: 인증서 CN 검증까지 강제.
- **강력한 replication password**: `random_password` + Secret Manager로 저장, 로컬 평문 금지.

VPN 대비 약한 모델임은 ADR에 명시하고, 장기 운영 재개 시 VPN 전환을 별도 ADR로 다룹니다.

---

## 결과

### 목표 지표

결정의 성공 여부를 판단할 지표는 다음과 같습니다.

- GCP primary 쓰기/읽기 p99가 Cloud SQL 대비 회귀 없음 (동일 스펙 VM).
- GCP→AWS cross-cloud replication lag < 5s (WAL 전파 기준).
- 시퀀스 정합성: Failback 후 PK 중복 0건.
- 디스크 SSD 순 증가량 0GB (Cloud SQL 20GB 반환 + VM 20GB 추가).

### 비용 (asia-northeast3 기준)

| 항목 | 월 | 1주 |
|---|---|---|
| GCE VM primary (e2-standard-2) | $55.0 | $12.9 |
| pd-balanced 20GB | $2.0 | $0.5 |
| Snapshot backup | $0.8 | $0.2 |
| Static external IP | $3.6 | $0.9 |
| 신규 소계 | **$61.4** | **$14.5** |
| Cloud SQL 해지 | -$84.5 | -$19.7 |
| **실 변화** | **-$23 (절감)** | **-$5 (절감)** |

Cloud SQL `db-custom-2-3840`을 해지하고 GCE VM으로 이전하면 월 $23가 오히려 절감됩니다. Phase B가 활성화되면 GCE VM standby $55/월, cross-cloud egress 약 $3/월이 추가로 발생합니다.

### 리스크

ADR에서 인지하고 기록한 리스크는 네 가지입니다.

- **VM 단일 장애 = 쓰기 중단**: HA가 없으므로 Cloud SQL ZONAL 대비 SLA가 하락합니다. 1주 시연 범위라 수용합니다. 장기 운영 재개 시 Patroni 또는 Cloud SQL 복귀를 별도 ADR로 다룹니다.
- **Public IP + allowlist 보안 모델**: VPN 대비 약합니다. TLS verify-full + 강력 replication password + AWS NAT IP 한정 허용으로 완화합니다. Phase B merge 시 방화벽 규칙 점검를 필수로 진행합니다.
- **Initial sync WAL 폭발**: pglogical `copy_data=true` 시 publisher에 COPY 부하가 발생합니다. 실 데이터가 약 5GB로 작아 영향은 제한적입니다. `max_slot_wal_keep_size=5GB`로 방어합니다.
- **pglogical 2.x 버전 호환**: publisher와 subscriber가 동일 버전을 써야 합니다. Ubuntu 22.04 + PostgreSQL 16 공식 apt 패키지로 통일합니다.

### Reversibility

Phase A 롤백은 `DATABASE_URL`을 Cloud SQL private IP(`10.5.0.2`)로 되돌리는 것으로 끝납니다. 단, Cloud SQL `deletion_protection=true`는 반드시 유지해야 합니다(Phase A 커밋에서 변경 금지).

Phase B 롤백은 `feature/db-sync-phase-b`를 revert하고 `terraform apply`로 subscription drop + VM 삭제를 실행합니다.

Phase A 완료 후 Cloud SQL을 삭제한 시점부터는 비가역입니다. 이후에는 백업 기반 복구만 가능합니다(Cloud SQL PITR은 7일 보존).

---

## 후속

결정 이후 작성해야 할 문서와 구현 항목입니다.

1. ADR-0019: Active-Passive + 읽기 Replica 분리 구조 상세.
2. ADR-0020: Failback 역방향 유지 전략.
3. Terraform `prod-gcp/modules/pg-primary/` 모듈 구현 (Phase A).
4. `feature/db-sync-phase-b` 브랜치 준비 (Phase B).
5. DDL runbook 작성 (`docs/runbooks/ddl-deployment.md`).
6. `docs/architecture/network-paths.md`에 cross-cloud replication 경로 추가.

---

## 실행 기록 (2026-04-18)

ADR 결정 이후 실제 실행 결과를 함께 기록합니다.

| Phase | 상태 | 비고 |
|-------|------|------|
| Phase A (Cloud SQL → VM 이전) | 완료 | 1.9GB dump → restore 13분. 41 테이블 복원. `resale_listing_orders`(고아 테이블 0 rows)는 제외 |
| Phase 3e (Cloud SQL 해지) | 완료 | `gcloud sql instances delete goti-prod-postgres` + `terraform state rm` 17개 + code cleanup |
| Phase B (pglogical subscription) | 부분 성공 | subscription 생성됨(`sub_from_gcp_primary`). seats/teams 완벽 복제. users 99.996%. orders/payments는 AWS 기존 잔재(+11K)로 PK 충돌 |

실제 적용된 VM 스펙은 ADR Decision에서 결정한 값 그대로입니다.

- `10.2.3.218` (internal) / `34.64.74.209` (external static)
- `e2-standard-2` + pd-balanced 20GB
- PostgreSQL 16.13 + pglogical 2.4.6 (PGDG apt)
- Cross-cloud: AWS NAT IP `15.164.8.237/32`를 `pg_primary_allowed_ingress_cidrs`에 등록 (Phase B 실행 시 추가)

실 비용(한 달 환산)도 Decision의 예상치와 일치했습니다.

- GCE VM + pd-balanced + static IP: **$61/월**
- Cloud SQL `db-custom-2-3840` 해지: **-$85/월**
- 순 절감: **$23/월** (ADR Decision 예상치와 일치)

### Phase B 실행 중 발견된 추가 필수 작업

ADR Decision에는 없었으나 실제 실행에서 필요했던 작업입니다. 후속 ADR 또는 runbook에 반영합니다.

- `pglogical_repl` 사용자에 `pglogical` schema USAGE/SELECT + `pg_read_all_data` GRANT (수동).
- RDS subnet 3개에 default route 임시 추가(AWS 기본 차단 회피, 완료 후 삭제 원복).
- AWS RDS parameter group의 `shared_preload_libraries=pglogical`은 인스턴스 재시작 필요.
- Subscriber Job은 Kyverno/Istio webhook 통과를 위해 `sidecar.istio.io/inject: "false"` **라벨**(annotation 아님) 필수.

상세 트러블슈팅 기록은 `docs/dev-logs/2026-04-18-phase-b-pglogical-trial-and-cleanup.md` §3 (11개 장애물)에 정리되어 있습니다.
