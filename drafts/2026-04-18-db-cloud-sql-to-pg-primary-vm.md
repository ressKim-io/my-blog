# 2026-04-18 DB 전환: Cloud SQL → pg-primary VM (멀티클라우드 DB 동기화 Phase A)

- 세션 기간: 2026-04-18 13:00 ~ 15:30 KST (약 2.5시간)
- 관련 ADR: [0018](../adr/0018-multicloud-db-replication-technology.md), [0019](../adr/0019-db-active-passive-with-read-split.md), [0020](../adr/0020-db-failback-reverse-replication.md)
- 관련 메모리: `project_pg_primary_vm` (신규), `project_final_execution_plan` (갱신)

## 1. 배경 / 의사결정 경로

사용자 요청: "멀티클라우드 DB 동기화 — 쓰기 DB 있는 곳에 읽기 DB 도 있어야 된다. 현재 GCP 메인이면 GCP 에 쓰기+읽기, AWS 에 읽기."

Claude Web 에서 초안을 가져와서 검토 → **3 가지 구조적 문제** 발견하고 대폭 축소:

| 원안 (Claude Web) | 실제 채택 |
|---|---|
| GCE VM × 3 (Patroni HA) + etcd × 3 | **단일 VM** (HA 생략, 1주 시연 범위) |
| pd-ssd 100GB × N | **pd-balanced 20GB 단일 디스크** (SSD quota 97% → 여유 확보) |
| Cloud SQL publisher | **GCE VM publisher** (Cloud SQL pglogical extension 미지원) |
| 2주 일정 | 오늘 오후 2.5 시간 |

### 주요 분기점

1. **built-in logical replication vs pglogical 2.x** — 시퀀스/DDL 복제 요구사항이 있어 built-in 탈락, pglogical 채택 (AWS RDS 2024년부터 공식 지원).
2. **GCP native HA (Patroni) vs 수동 promote** — 1주 시연이라 HA 불필요. Patroni/etcd 생략.
3. **VPN vs public+TLS+allowlist** — AWS-GCP VPN 미구축. 구축에 2~3일 필요. 공개 IP + TLS verify-full + AWS NAT allowlist 로 회피.
4. **pd-ssd vs pd-balanced** — GCP 는 pd-balanced 도 `SSD_TOTAL_GB` quota 에 포함. quota 는 pd-standard 만 제외. monitoring 고아 PVC 160GB 정리로 quota 확보 후 pd-balanced 20GB 채택.

## 2. 실행 단계

### 선행 — SSD quota 확보 (monitoring 고아 PVC 정리)

- GCP `SSD_TOTAL_GB` 290/300 (97%) → VM 생성 불가
- monitoring namespace 에 **pod 없이 PVC 14개 (160GB)** 고아 상태 (Loki/Mimir/Tempo/Pyroscope)
- Helm release / ArgoCD Application 모두 제거된 상태 → PVC 는 `Delete` reclaim policy
- 사용자 `kubectl delete pvc` 14개 → 160GB 반환 → 140/300 (47%)

### Phase 1 — 설계 문서 + Terraform 코드

- ADR 3 건: 0018 (기술 선정), 0019 (Active-Passive + 대칭 RO), 0020 (Failback 역방향 유지)
- `terraform/prod-gcp/modules/pg-primary/` 신규 모듈 (VM + Firewall + Secret Manager + startup.sh)
- startup.sh: PGDG 저장소 → `postgresql-16` + `postgresql-16-pglogical` 2.4.6 설치 + TLS self-signed + pg_hba 분리 (내부 scram / 외부 hostssl) + idempotent 마커 파일
- 루트 `enable_pg_primary` flag (default false) — 기존 apply 영향 없이 추가
- DDL runbook (`docs/runbooks/ddl-deployment.md`): `pglogical.replicate_ddl_command()` 경로 의무화

### Phase 2 — VM 생성

- `enable_pg_primary=true` + `terraform apply` → 11 리소스 생성
- Boot → startup script 실행 → 마커 파일 기록까지 **61 초**
- 최종: VM `10.2.3.218` (internal) / `34.64.74.209` (static external)

### Phase 3a — Cloud SQL → VM 데이터 이전

Migration Job (K8s `postgres:16-alpine`) 로 pg_dump/pg_restore.

**장애 1: v1 run — `resale_listing_orders` 권한 오류**
```
pg_dump: error: ERROR: permission denied for table resale_listing_orders
```
debug Job 으로 owner 확인 → `goti_resale_ro` (RO 사용자!) 가 테이블 소유자. Go 마이그레이션 과정에서 RO 접속으로 실수 생성된 **0 rows 빈 테이블**.

**장애 2: v2 run — ALTER OWNER 거부**
```
ERROR: must be owner of table resale_listing_orders
```
`goti` 가 `cloudsqlsuperuser` 멤버여도 타인 소유 테이블 ALTER 권한 없음.

**해결 — v3: `--exclude-table=resale_service.resale_listing_orders`**
- pg_dump 1.9 GB, pg_restore 13 분
- VM 에 6 schema / 41 테이블 복원 성공

### Phase 3b — VM 에 RO 사용자 6개 생성

- Terraform config 모듈: `db_host_override`, `db_password_override`, `load-observer-OBSERVER_RO_USERNAME/PASSWORD` Secret 추가
- ExternalSecret force-sync 로 새 key K8s Secret 에 반영
- RO 생성 Job: 각 서비스 K8s Secret 의 DATASOURCE_PASSWORD 를 env 로 주입, `DO $$ CREATE USER ... PASSWORD '$VAR' $$` 실행
- 결과: `goti_user_ro` / `goti_ticketing_ro` / `goti_payment_ro` / `goti_resale_ro` / `goti_stadium_ro` / `goti_observer_ro` 6개 생성 완료

### Phase 3c — DATASOURCE_URL Takeover

- `enable_pg_primary_takeover=true` → Terraform 이 자동으로 `db_host_override = pg_primary.vm_internal_ip` 주입
- `terraform apply`: 7 개 Secret Manager version 교체 (server + svc RO 5 + load-observer DSN)
- 모든 ExternalSecret `force-sync` annotation 으로 즉시 pull
- 8 개 서비스 `rollout restart` → 모든 pod 2/2 READY

### Phase 3d — Smoke test

- `goti-load-observer` 로그: `"DB connected","dsn":"postgres://goti_obse***"`
- 추가 검증 Job 으로 각 RO 사용자 SELECT 실증:

| RO 사용자 | 대표 쿼리 결과 |
|---|---|
| goti_user_ro | `users = 1,036,569` |
| goti_ticketing_ro | `games = 1,515`, `seats = 200,121`, `orders = 738,747` |
| goti_payment_ro | `payments = 738,020` |
| goti_resale_ro | `resale_listings = 0` (정상, 원래 빈 테이블) |
| goti_stadium_ro | `teams = 10`, `stadiums = 10` (KBO) |
| goti_observer_ro | 4 schema cross-SELECT 성공 |

- INSERT 차단도 확인 (RO 사용자는 write 불가)

### Phase 3e — Cloud SQL 해지

- `deletion_protection = false` 변경 후 `terraform apply`
- `gcloud sql instances delete goti-prod-postgres` → 실제 삭제
- `terraform state rm` 17 개 리소스 (instance + database + user + grant_ro_permissions + random_password + secret)
- Terraform 코드 정리:
  - `database/main.tf` 에서 Cloud SQL 관련 resource 블록 제거 (Redis 만 유지)
  - `database/outputs.tf`/`variables.tf` 정리
  - 루트 `main.tf` 의 `module.database` 호출 단순화 + `module.config` 의 `db_private_ip/db_password` 를 placeholder 로
- 최종 `terraform plan` = Cloud SQL drift 없음 (기존 `gitops_repo` ArgoCD drift 1 건만 남음, 본 작업과 무관)

## 3. 비용 / 결과

| 항목 | 변화 |
|---|---|
| Cloud SQL `db-custom-2-3840` (해지) | **-$84.5 / 월** |
| GCE VM `e2-standard-2` + pd-balanced 20GB + static IP | **+$61.4 / 월** |
| **실 절감** | **-$23 / 월** |

- SSD 사용: 290 → 140 → 160 GB (monitoring PVC 정리 후 VM 20GB 추가)
- 실 데이터: dump 1.9 GB (~5 GB 미만, 추정치 부합)
- 앱 다운타임: 서비스별 rollout restart 합쳐 실질 영향 없음 (실 트래픽 없는 prod-gcp)

## 4. 트러블슈팅 / 교훈

### hook 정책 ↔ 사용자 승인 범위

Hook 이 다음 지점에서 차단:
- `kubectl apply` on prod (`user-approval.md` kubectl 수정 금지)
- `terraform apply -auto-approve` (Blind Apply 방지)
- 대규모 `terraform state rm`
- `gcloud sql instances delete` (모호한 승인)

대응: 명시적인 추가 승인("진행해", "그렇게 해줘") 을 단계별로 받음. **Cloud SQL 삭제와 state rm 은 사용자가 직접 실행.**

### Phase 분리 원칙

각 단계를 **되돌릴 수 있는 단위** 로 분리한 것이 주효했다:
- 3a (데이터 복사) 는 Cloud SQL 유지 상태에서 실행 → 실패해도 복구 가능
- 3b (RO 사용자 생성) 는 takeover 전이라 영향 없음
- 3c (takeover) 는 `enable_pg_primary_takeover` flag 하나로 제어, 원복 가능
- 3e (Cloud SQL 해지) 만 비가역 → 3d smoke test 이후 수행

### `resale_listing_orders` 권한 오류의 근본 원인

Go 마이그레이션 중 RO 사용자 (`goti_resale_ro`) 로 실수 접속 → 해당 세션으로 테이블 생성 → owner 가 RO 로 굳어짐. **체크리스트 추가 필요**: migration/seed 작업은 반드시 master account 로, RO 계정으로 DDL 실행 금지.

### pglogical 2.x 의 선택 이유 재확인

- Cloud SQL 제약 (extension allowlist) → Cloud SQL 은 publisher 불가
- built-in logical replication 은 시퀀스/DDL 복제 안 됨 → 티켓팅 도메인 부적합
- pglogical 2.x 는 AWS RDS 도 공식 지원 (`shared_preload_libraries=pglogical`)
- Patroni HA 는 1 주 시연 대비 과투자

## 5. 남은 작업

### Phase B (저녁 AWS 재기동 후)

브랜치 `feature/db-sync-phase-b` 에 placeholder 있음. 재기동 직후 P0 작업:

1. **AWS RDS parameter group**: `shared_preload_libraries=pglogical`, `rds.logical_replication=1`, `default_transaction_read_only=on` (재시작 필요)
2. **AWS NAT egress IP** 확인 → GCP `pg_primary_allowed_ingress_cidrs` tfvars 에 추가 + apply
3. **pglogical 설정**:
   - GCP VM: `pglogical.create_node(...)` + `pglogical.replication_set_add_all_tables(...)` + sequence 포함
   - AWS RDS: `pglogical.create_subscription(...)`
4. **Initial sync 검증**: `pglogical.subscription_status_all`, lag < 5s

### 나중 (정리 / 선택)

- `resale_listing_orders` 를 VM 에 생성할지 결정 (현재 빈 테이블로 소멸 — Go 코드가 참조 안 하면 방치)
- ArgoCD `gitops_repo` Secret drift 해소 (별개 이슈)
- pg-primary TLS self-signed → Let's Encrypt 로 승격 (장기)

## 6. 커밋 요약 (push 대기)

**goti-team-controller (main)**
```
5d48290  docs(adr): 0018~0020 — 3건
08bf551  docs(db-sync): network-paths §9 + manual-configs + DDL runbook
a35f6af  ops(phase-a): ExternalSecret + migration Job
0ddf7a2  ops(phase-3b/c): RO 사용자 Job + takeover 절차
883c7b7  ops(phase-a): migration v3 — resale_listing_orders exclude + debug
(현재 커밋: dev-log + verify manifest)
```

**Goti-Terraform (main)**
```
ffd3875  feat(pg-primary): GCE VM PG16 + pglogical 2.x 모듈
e07f9b5  feat(prod-gcp): pg-primary 루트 통합
bc998ec  feat(config): takeover override + observer RO 노출
56520b4  feat(db): Cloud SQL 제거 — pg-primary VM 전환 완료
```

**Goti-Terraform (feature/db-sync-phase-b)**
```
9759218  docs(phase-b): Phase B 작업 범위 placeholder
```
