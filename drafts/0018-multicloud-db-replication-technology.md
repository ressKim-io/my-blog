# ADR 0018 — 멀티클라우드 DB 복제 기술 선정 (GCE VM + pglogical 2.x)

- 상태: Accepted
- 결정일: 2026-04-18
- 관련 ADR: `0012-read-replica-split.md` (GCP 내 읽기 분리 방향 승격), `0015-jwt-issuer-sot-in-k8s-values.md` (cross-cloud 세션 호환)
- 영향 레포: Goti-Terraform, Goti-k8s, goti-team-controller

## 컨텍스트

### 목표

멀티클라우드 환경(GCP 메인 + AWS 보조)에서 DB 동기화를 구성한다. 요구사항:

1. **쓰기 DB 가 있는 곳에 읽기 DB 도 대칭 배치** — 현재 GCP 가 primary 이므로 GCP 에 쓰기+읽기, AWS 에 읽기. Failover 후 방향 전환 시에도 대칭 유지.
2. **시퀀스/PK 정합성 보장** — 티켓팅 도메인 특성상 `ticket_id`, `order_id` 등의 중복 발행은 치명적. Failover/Failback 구간에서 시퀀스 드리프트 발생 금지.
3. **DDL 재현 가능** — 스키마 변경 시 양쪽이 동일 상태로 유지되어야 함.
4. **Cross-cloud 네트워크로 동작** — VPN 없이도 TLS + IP allowlist 로 cross-cloud 복제 가능해야 함 (VPN 구축은 비용·시간상 1주 시연 범위 초과).

### 실관측 (Terraform / GCP quota)

- GCP 현재 DB: Cloud SQL `db-custom-2-3840` (ZONAL, POSTGRES_16, private IP `10.5.0.2`) — **extensions allowlist 에 pglogical 없음**
- GCP `SSD_TOTAL_GB` quota **97%** 사용 (290/300GB, pd-balanced 포함). 고용량 VM/디스크 증설 불가
- AWS 현재 DB: RDS `db.r6g.large` (PG 16) — `shared_preload_libraries` 조정 가능, pglogical 2.x 지원
- AWS ↔ GCP 간 **VPN 미구축** (기존 Terraform 확인 결과)
- 프로젝트 운영 기간: ~2026-04-24 (1주 시연 범위)

### 기존 결정 한계

- **ADR-0012** (read replica split): AWS RDS native Read Replica 구현만 다룸. Cross-cloud 복제 범위 외.
- Multi-cloud 계획 메모: "pglogical 기반 Active-Passive (RDS↔Cloud SQL)" 로만 기술. Cloud SQL 이 pglogical extension 을 수용 못하는 현실 제약은 고려 안 됨.

## 고려한 대안

| # | 대안 | 기각 사유 |
|---|---|---|
| A | Cloud SQL publisher + built-in logical replication | **시퀀스 복제 불가**. Failback 시 PK 점프/중복 발생. DDL 복제 없음. 양방향·충돌해결 기능 없음. 티켓팅 도메인 요구사항 불충족. |
| B | Cloud SQL + Cloud SQL Read Replica (GCP 내) + AWS external replica | Cloud SQL external replica 경로가 **AWS RDS 를 subscriber 로 지원하지 않음** (GCE VM 에 외부 replica 설치만 공식). 결국 중간 VM 필요 → 경로만 길어짐. |
| C | AlloyDB publisher + AWS RDS subscriber | AlloyDB 시간당 $1+ (1주 $168). 1 주 시연 대비 과투자. pglogical 공식 지원 확정 안 됨. |
| D | GCE VM PostgreSQL + Patroni HA + etcd 3-node + pglogical | 정석 HA 경로. 그러나 VM 3 + etcd 3 = 6대 × e2-standard-2 ≈ 월 $400+. Patroni 학습·운영 오버헤드 1주 시연 대비 과대. HA 요구사항 없음 (사용자 확인: 1주 시연). |
| E | AWS DMS / GCP Datastream | 벤더 락인, source/target 제약 많음, 시퀀스·DDL 커버 제한적, cross-cloud subscriber 지원 한계. |
| F | Bucardo / Debezium+Kafka | Bucardo 트리거 오버헤드 / Debezium Kafka 인프라 의존. Strimzi 는 현재 goti-k8s에서 제거 방향 (`kafka-decision` 메모리). 학습·운영 비용 높음. |

## 결정

**GCE VM PostgreSQL 16 + pglogical 2.x 채택. Patroni/etcd 생략.**

### 구조

```
[GCP — Primary]
  GCE VM (e2-standard-2, pd-balanced 20GB)
    ├─ PostgreSQL 16
    ├─ pglogical 2.x extension
    ├─ postgres_exporter (:9187, 모니터링은 Phase B 에서 활성)
    ├─ systemd 관리 (pg-primary.service)
    └─ Public IP (static) + Firewall allowlist + TLS (verify-full)
       │
       ├─(streaming replication)─▶ [Phase B] GCE VM standby (읽기 전용)
       │
       └─(pglogical publication) ─▶ [Phase B] AWS RDS (pglogical subscriber)
```

### 핵심 기술 선택

| 항목 | 선택 | 사유 |
|------|------|------|
| Publisher | GCE VM + pglogical 2.x | Cloud SQL pglogical 미지원. pglogical 2.x 는 시퀀스·DDL 지원 |
| Subscriber (AWS) | AWS RDS + pglogical 2.x | RDS parameter group 에 `shared_preload_libraries=pglogical`, `rds.logical_replication=1` 설정. AWS 공식 지원 |
| Subscriber (GCP 내 읽기) | streaming replication (physical) | pglogical 보다 단순·빠름. 같은 PG 인스턴스에서 바로 붙음 |
| HA | 없음 (수동 promote) | 1주 시연, HA 불필요. Patroni/etcd 회피 |
| 네트워크 | Public IP + IP allowlist + TLS verify-full | VPN 구축 시간·비용 회피. AWS NAT IP 만 allowlist |
| 비밀번호 | random_password + google_secret_manager_secret | 기존 database 모듈 패턴과 동일 |
| 디스크 | pd-balanced 20GB (단일) | pd-ssd quota 여유 없음. 실 데이터 ~5GB, 4배 여유 |
| 장기 보존 | Terraform 코드 전량 주석화 금지 | 프로젝트 재개 시 재활용 가능하도록 flag (`enable_pg_primary`) 로만 제어 |

### 결정 규칙 (불변)

1. **Cloud SQL 을 pglogical publisher 로 전환 금지** — extension allowlist 제약은 Google Cloud 구조적 한계. Cloud SQL 잔존은 pg-primary 이전 완료 후 삭제.
2. **시퀀스/DDL 자동 동기화 경로 준수** — pglogical 2.x 의 `replication_set` 에 sequence 포함. DDL 은 `pglogical.replicate_ddl_command()` 사용. runbook 에 명시.
3. **AWS RDS subscriber 는 `default_transaction_read_only=on`** — 앱이 AWS 에 SELECT 만 가능. Failover 전까지 쓰기 차단.
4. **Failover 는 수동 promote** — 자동 promote 는 split-brain 위험 + HA 미도입으로 불가. runbook 으로 수동 수행.

### Phase 구분 (main vs feature 브랜치)

| Phase | 브랜치 | 포함 |
|------|--------|------|
| **Phase A** (지금) | `main` | ADR 3건, pg-primary 모듈, 데이터 이전, DATABASE_URL 전환 |
| **Phase B** (시연일) | `feature/db-sync-phase-b` | GCE VM standby, AWS RDS parameter group, pglogical subscription, 모니터링 스택 |

Phase B 코드는 `main` 으로 merge 후 Terraform apply 시점에 전체 활성.

## 결과

### 목표 지표

- GCP primary 쓰기/읽기 p99 Cloud SQL 대비 회귀 없음 (동일 스펙 VM)
- GCP→AWS cross-cloud replication lag < 5s (WAL 전파 기준)
- 시퀀스 정합성: Failback 후 PK 중복 0 건
- 디스크 SSD 순증가 0GB (Cloud SQL 20GB 반환 + VM 20GB 추가)

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

Phase B 활성 시 추가: GCE VM standby $55/월, cross-cloud egress ~$3/월.

### 리스크

- **VM 단일 장애 = 쓰기 중단** — HA 없음. Cloud SQL ZONAL 대비 SLA 하락. 1주 시연 범위라 수용. 장기 운영 재개 시 Patroni/Cloud SQL 복귀 ADR 별도.
- **Public IP + allowlist 보안 모델** — VPN 대비 약함. TLS verify-full + 강력 replication password + AWS NAT IP 만 허용으로 완화. Phase B merge 시 방화벽 규칙 감사 필수.
- **Initial sync WAL 폭발** — pglogical `copy_data=true` 시 publisher 에 COPY 부하. 실 데이터 ~5GB 로 작아 영향 제한적. `max_slot_wal_keep_size=5GB` 방어.
- **pglogical 2.x 버전 호환** — publisher/subscriber 동일 버전 강제. Ubuntu 22.04 + PostgreSQL 16 공식 apt 패키지 사용.

### Reversibility

- Phase A 롤백: DATABASE_URL 을 Cloud SQL private IP (`10.5.0.2`) 로 되돌림. Cloud SQL `deletion_protection=true` 유지 필수 (Phase A 커밋에서 변경 금지).
- Phase B 롤백: `feature/db-sync-phase-b` revert → `terraform apply` → subscription drop → VM 삭제.
- Phase A 완료 + Cloud SQL 삭제 이후는 비가역. 백업 기반 복구만 가능 (Cloud SQL PITR 7일).

## 후속

1. ADR-0019 작성: Active-Passive + 읽기 Replica 분리 구조 상세
2. ADR-0020 작성: Failback 역방향 유지 전략
3. Terraform `prod-gcp/modules/pg-primary/` 모듈 구현 (Phase A)
4. `feature/db-sync-phase-b` 브랜치 준비 (Phase B)
5. DDL runbook 작성 (`docs/runbooks/ddl-deployment.md`)
6. `docs/architecture/network-paths.md` 에 cross-cloud replication 경로 추가

## 실행 기록 (2026-04-18)

| Phase | 상태 | 비고 |
|-------|------|------|
| Phase A (Cloud SQL → VM 이전) | ✅ 완료 | 1.9GB dump → restore 13분. 41 테이블 복원. `resale_listing_orders` (goti_resale_ro 소유 0 rows 고아) 제외 |
| Phase 3e (Cloud SQL 해지) | ✅ 완료 | `gcloud sql instances delete goti-prod-postgres` + terraform state rm 17개 + code cleanup |
| Phase B (pglogical subscription) | 🟡 부분 성공 | subscription 생성됨 (`sub_from_gcp_primary`). seats/teams 완벽 복제. users 99.996%. orders/payments AWS 기존 잔재 (+11K) PK 충돌 |

실 VM 스펙 (본 ADR Decision 에서 결정한 값 그대로):
- `10.2.3.218` (internal) / `34.64.74.209` (external static)
- e2-standard-2 + pd-balanced 20GB
- PostgreSQL 16.13 + pglogical 2.4.6 (PGDG apt)
- Cross-cloud: AWS NAT IP `15.164.8.237/32` 를 `pg_primary_allowed_ingress_cidrs` 에 등록 (Phase B 실행 시 추가)

실 비용 (한 달 환산):
- GCE VM + pd-balanced + static IP: **$61/월**
- Cloud SQL db-custom-2-3840 해지: **-$85/월**
- 순 절감: **$23/월** (ADR Decision 예상치 일치)

Phase B 실행 중 발견된 추가 필수 작업 (ADR Decision 엔 없음, 후속 ADR 또는 runbook 에 반영):
- `pglogical_repl` 사용자에 `pglogical` schema USAGE/SELECT + `pg_read_all_data` GRANT (수동)
- RDS subnet 3 개 default route 임시 추가 (AWS 기본 차단 회피, 완료 후 삭제 원복)
- AWS RDS parameter group 의 `shared_preload_libraries=pglogical` 는 재시작 필요
- Subscriber Job 은 Kyverno/Istio webhook 통과를 위해 `sidecar.istio.io/inject: "false"` **라벨** (annotation 아님) 필수

상세 트러블슈팅: `docs/dev-logs/2026-04-18-phase-b-pglogical-trial-and-cleanup.md` §3 (11 개 장애물)
