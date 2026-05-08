---
title: "Cloud SQL → pg-primary VM 전환 — pglogical을 쓰기 위해 GCE로 내려간 이유"
excerpt: "Cloud SQL은 pglogical extension을 지원하지 않습니다. Multi-Cloud DB 복제의 publisher 역할을 맡기려고 Cloud SQL을 해지하고 GCE VM 단일 인스턴스로 PostgreSQL 16을 직접 운영하기까지의 2.5시간 기록입니다"
category: kubernetes
tags:
  - go-ti
  - PostgreSQL
  - CloudSQL
  - GCP
  - Migration
  - troubleshooting
series:
  name: "goti-multicloud-db"
  order: 6
date: "2026-04-18"
---

## 한 줄 요약

> Multi-Cloud DB 복제의 publisher로 Cloud SQL을 쓸 수 없어서, GCE VM에 PostgreSQL 16 + pglogical 2.4.6을 직접 올리고 Cloud SQL을 해지했습니다. 단일 VM, pd-balanced 20GB, 공개 IP + TLS + allowlist 조합으로 1주 시연 범위에 맞춰 구성을 최소화했습니다

---

## 🔥 배경: "쓰기 DB가 있는 곳에 읽기 DB도 있어야 한다"

사용자 요청은 간단했습니다.

> "멀티클라우드 DB 동기화 — 쓰기 DB 있는 곳에 읽기 DB도 있어야 된다. 현재 GCP 메인이면 GCP에 쓰기+읽기, AWS에 읽기."

이 요구사항을 만족하려면 GCP를 publisher로, AWS RDS를 subscriber로 두는 logical replication 구성이 필요합니다.
하지만 publisher 쪽에 **치명적인 제약**이 하나 숨어 있었습니다.

**Cloud SQL은 pglogical extension을 설치할 수 없습니다.**

GCP의 Cloud SQL은 extension allowlist로 등록된 확장만 허용합니다.
pglogical은 이 목록에 없으며, 로드맵에도 없습니다.
built-in logical replication으로 대체하자니 **시퀀스와 DDL 복제**가 누락됩니다.
티켓팅 도메인은 `ORDER_ID` 시퀀스가 양쪽에서 충돌하면 안 되고, `ALTER TABLE`을 자주 치기 때문에 built-in으로는 부족했습니다.

결론적으로 Cloud SQL을 포기하고 **GCE VM에 PostgreSQL을 직접 올리는** 경로로 내려갔습니다.

---

## 🤔 의사결정: 원안 4개 항목을 전부 축소

Claude Web에서 가져온 초안을 검토하다가 **3가지 구조적 문제**를 발견했습니다.
원안은 엔터프라이즈 HA 레퍼런스를 따라가고 있었는데, 이번 작업은 1주 시연 범위였습니다.

| 항목 | 원안 (Claude Web) | 실제 채택 |
|---|---|---|
| 구성 | GCE VM × 3 (Patroni HA) + etcd × 3 | **단일 VM** (HA 생략) |
| 디스크 | pd-ssd 100GB × N | **pd-balanced 20GB 단일** |
| Publisher | Cloud SQL | **GCE VM publisher** (필연) |
| 일정 | 2주 | **오후 2.5시간** |

이 표의 각 줄은 단순 비용 절감이 아니라 **이번 범위에 맞는 축소**입니다.

**단일 VM 선택**은 1주 시연 동안 장애를 수동 promote로 버티겠다는 전제입니다.
Patroni + etcd 3노드 HA는 운영 가치가 있지만, 시연 기간에 그 복잡도를 감당할 사람이 없었습니다.
HA가 필요해지는 시점에 다시 세우는 쪽이 합리적입니다.

**pd-balanced 선택**은 GCP quota의 함정과 관련이 있었습니다.
GCP `SSD_TOTAL_GB` quota는 pd-ssd뿐 아니라 **pd-balanced도 포함**합니다.
제외되는 건 pd-standard뿐입니다.
시작 시점에 quota가 290/300 (97%)으로 꽉 차 있어서 VM을 띄울 수 없는 상태였습니다.

**VPN 대신 공개 IP + TLS + allowlist** 선택은 일정 문제입니다.
AWS-GCP VPN은 2~3일 구축 기간이 필요합니다.
이번 범위에서는 `hostssl` + `verify-full` + AWS NAT egress IP allowlist로 보안 요구를 만족시켰습니다.

### 분기점 요약

1. **built-in logical replication vs pglogical 2.x**: 시퀀스/DDL 복제 요구로 pglogical 채택. AWS RDS는 2024년부터 공식 지원합니다.
2. **GCP Patroni HA vs 수동 promote**: 1주 시연이므로 HA 생략.
3. **VPN vs public + TLS + allowlist**: 일정상 후자.
4. **pd-ssd vs pd-balanced**: quota 재사용을 위한 pd-balanced.

---

## ✅ 실행: 5단계 Phase 분리

각 단계를 **되돌릴 수 있는 단위**로 쪼갠 것이 이번 작업의 핵심이었습니다.
3e(Cloud SQL 해지)만 비가역이었고, 그 전까지는 모두 롤백 가능한 상태였습니다.

### 선행 단계 — SSD quota 확보

VM을 생성하기 전에 quota부터 해결해야 했습니다.

```bash
$ gcloud compute project-info describe --format="value(quotas[].usage,quotas[].limit)" \
  | grep -A1 SSD_TOTAL_GB
# SSD_TOTAL_GB: 290 / 300  (97%)
```

`monitoring` namespace를 확인해보니 Pod 없이 PVC만 14개 남아 있었습니다.
Loki / Mimir / Tempo / Pyroscope의 옛 PVC들로, 총 160GB를 차지하고 있었습니다.

```bash
$ kubectl -n monitoring get pvc --no-headers | wc -l
14

$ kubectl -n monitoring get pvc --no-headers \
  | awk '{sum+=$4} END {print sum" GB"}'
# 160 GB
```

Helm release와 ArgoCD Application이 모두 제거된 상태였고, reclaim policy는 `Delete`였습니다.
사용자가 직접 `kubectl delete pvc`로 14개를 정리하자 quota가 **290 → 140 (47%)** 로 떨어졌습니다.

### Phase 1 — 설계 문서 + Terraform 코드

먼저 ADR 3건을 남겼습니다.

- **ADR 0018**: pglogical vs built-in logical replication 기술 선정
- **ADR 0019**: Active-Passive + 대칭 RO 구조
- **ADR 0020**: Failback을 위한 역방향 복제 유지

그다음 `terraform/prod-gcp/modules/pg-primary/`에 신규 모듈을 만들었습니다.
VM + Firewall + Secret Manager + startup.sh 구성입니다.

`startup.sh`에서는 아래 순서로 초기화합니다.

```bash
# PGDG 저장소 등록
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add -
echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list

# PostgreSQL 16 + pglogical 2.4.6 설치
apt-get install -y postgresql-16 postgresql-16-pglogical

# TLS self-signed 생성
openssl req -new -x509 -days 365 -nodes \
  -out /etc/postgresql/16/main/server.crt \
  -keyout /etc/postgresql/16/main/server.key

# pg_hba: 내부 scram / 외부 hostssl 분리
# ... (생략)

# idempotent 마커 파일
touch /var/lib/postgresql/.bootstrap-done
```

루트 Terraform에 `enable_pg_primary` flag(default false)를 추가해서 기존 apply에 영향을 주지 않도록 했습니다.

DDL runbook (`docs/runbooks/ddl-deployment.md`)에는 **모든 DDL은 `pglogical.replicate_ddl_command()`를 경유한다**는 규칙을 의무화했습니다.
일반 `ALTER TABLE`을 치면 replication이 어긋납니다.

### Phase 2 — VM 생성

flag를 켜고 apply했습니다.

```bash
$ terraform apply -var="enable_pg_primary=true"
# 11 resources created
```

부팅부터 startup script 완료(마커 파일 기록)까지 **61초**가 걸렸습니다.
최종 주소는 다음과 같습니다.

- internal: `10.2.3.218`
- static external: `34.64.74.209`

### Phase 3a — Cloud SQL → VM 데이터 이전

Migration Job을 K8s의 `postgres:16-alpine` 이미지로 띄워 pg_dump/pg_restore를 실행했습니다.

**장애 1: v1 run — `resale_listing_orders` 권한 오류**

```text
pg_dump: error: ERROR: permission denied for table resale_listing_orders
```

debug Job으로 owner를 확인하자 원인이 드러났습니다.

```sql
SELECT schemaname, tablename, tableowner
FROM pg_tables
WHERE tablename = 'resale_listing_orders';
--  schemaname     | tablename              | tableowner
-- ----------------+------------------------+------------------
--  resale_service | resale_listing_orders  | goti_resale_ro
```

**테이블 소유자가 RO(Read-Only) 사용자**였습니다.
Go 마이그레이션 과정에서 실수로 RO 계정으로 접속해 테이블을 생성한 흔적이었고, 내용은 0 rows였습니다.

**장애 2: v2 run — ALTER OWNER 거부**

pg_dump가 `ALTER TABLE ... OWNER TO goti` 구문을 넣었는데 거부됐습니다.

```text
ERROR: must be owner of table resale_listing_orders
```

`goti` 계정이 `cloudsqlsuperuser` 멤버여도 **타인 소유 테이블의 owner 변경 권한은 없습니다**.

**해결 — v3**: 문제 테이블을 제외합니다.

```bash
pg_dump --exclude-table=resale_service.resale_listing_orders \
  "postgresql://goti:...@CLOUDSQL_IP:5432/goti" \
  > /tmp/dump.sql
```

최종 결과는 다음과 같습니다.

- pg_dump 결과: 1.9 GB
- pg_restore 소요: 13분
- VM 복원: 6 schema / 41 테이블

### Phase 3b — VM에 RO 사용자 6개 생성

Terraform config 모듈에 override 3건을 추가했습니다.

- `db_host_override`
- `db_password_override`
- `load-observer-OBSERVER_RO_USERNAME` / `OBSERVER_RO_PASSWORD` Secret 신규

ExternalSecret을 `force-sync`하면 새 key가 K8s Secret에 즉시 반영됩니다.

RO 생성 Job은 각 서비스의 K8s Secret에서 `DATASOURCE_PASSWORD`를 env로 주입받고, `DO $$ ... $$` 블록에서 CREATE USER를 실행했습니다.

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'goti_user_ro') THEN
    EXECUTE format('CREATE USER goti_user_ro PASSWORD %L', :'var_password');
  END IF;
END $$;
```

결과적으로 6개 RO 사용자가 생성됐습니다.

- `goti_user_ro`
- `goti_ticketing_ro`
- `goti_payment_ro`
- `goti_resale_ro`
- `goti_stadium_ro`
- `goti_observer_ro`

### Phase 3c — DATASOURCE_URL Takeover

별도 flag `enable_pg_primary_takeover=true`로 제어합니다.
이 flag가 켜지면 Terraform이 자동으로 `db_host_override = pg_primary.vm_internal_ip`를 주입합니다.

```bash
$ terraform apply -var="enable_pg_primary_takeover=true"
# Secret Manager 7 versions replaced:
# - server DATASOURCE_URL
# - svc RO × 5
# - load-observer DSN
```

모든 ExternalSecret에 `force-sync` annotation을 찍어 즉시 pull을 강제했고, 8개 서비스를 `rollout restart`했습니다.
모든 Pod가 2/2 READY로 수렴했습니다.

### Phase 3d — Smoke test

`goti-load-observer` 로그에서 새 DSN이 찍히는지 먼저 확인했습니다.

```text
{"level":"info","msg":"DB connected","dsn":"postgres://goti_obse***"}
```

그다음 검증 Job으로 각 RO 사용자의 SELECT를 실증했습니다.

| RO 사용자 | 대표 쿼리 결과 |
|---|---|
| goti_user_ro | `users = 1,036,569` |
| goti_ticketing_ro | `games = 1,515`, `seats = 200,121`, `orders = 738,747` |
| goti_payment_ro | `payments = 738,020` |
| goti_resale_ro | `resale_listings = 0` (정상, 원래 빈 테이블) |
| goti_stadium_ro | `teams = 10`, `stadiums = 10` (KBO) |
| goti_observer_ro | 4 schema cross-SELECT 성공 |

이 표는 단순한 row count 확인이 아닙니다.
각 서비스가 **자기 스키마만 읽을 수 있고, 다른 스키마는 읽지 못한다**는 권한 분리까지 함께 검증한 결과입니다.
`goti_observer_ro`만 예외적으로 4개 스키마에 cross-SELECT 권한을 가지도록 설계했습니다.

INSERT는 당연히 거부되어야 합니다.

```sql
-- goti_user_ro로 접속
INSERT INTO users (email) VALUES ('test@example.com');
-- ERROR: permission denied for table users
```

### Phase 3e — Cloud SQL 해지 (비가역)

smoke test가 끝난 뒤에만 이 단계로 넘어갑니다.

```bash
# 1. deletion_protection 해제
$ terraform apply  # deletion_protection = false 반영

# 2. Cloud SQL 인스턴스 삭제
$ gcloud sql instances delete goti-prod-postgres
```

그다음 Terraform state에서 17개 리소스를 `state rm`으로 제거했습니다.
instance, database, user, grant_ro_permissions, random_password, secret이 모두 포함됩니다.

코드 정리도 함께 진행했습니다.

- `database/main.tf`에서 Cloud SQL 관련 resource 블록을 제거(Redis만 유지)
- `database/outputs.tf` / `variables.tf` 정리
- 루트 `main.tf`의 `module.database` 호출을 단순화
- `module.config`의 `db_private_ip`/`db_password`를 placeholder로

마지막으로 `terraform plan`을 돌려 Cloud SQL drift가 없는지 확인했습니다.
기존 `gitops_repo` ArgoCD drift 1건만 남았고, 이 작업과는 무관한 이슈였습니다.

---

## 📊 비용 / 결과

| 항목 | 변화 |
|---|---|
| Cloud SQL `db-custom-2-3840` 해지 | **-$84.5 / 월** |
| GCE VM `e2-standard-2` + pd-balanced 20GB + static IP | **+$61.4 / 월** |
| **실 절감** | **-$23 / 월** |

절대 금액은 작습니다.
하지만 이 전환의 핵심은 비용이 아니라 **pglogical을 쓸 수 있게 됐다는 사실**입니다.
Cloud SQL을 유지했다면 Multi-Cloud DB 복제 자체가 불가능했습니다.

그 외 수치는 다음과 같습니다.

- SSD 사용: 290 → 140 → 160 GB (monitoring PVC 정리 후 VM 20GB 추가)
- 실 데이터: dump 1.9 GB (사전 추정 5 GB 미만에 부합)
- 앱 다운타임: 서비스별 rollout restart 합쳐 실질 영향 없음 (실 트래픽 없는 prod-gcp)

---

## 📚 배운 점

### Phase 분리가 비가역 단계를 보호합니다

이번 작업은 3a → 3b → 3c → 3d → 3e 순서로 진행했고, **3e만 비가역**이었습니다.

- **3a (데이터 복사)**: Cloud SQL 유지 상태에서 실행. 실패해도 복구 가능.
- **3b (RO 사용자 생성)**: takeover 전이라 서비스 영향 없음.
- **3c (takeover)**: flag 하나로 원복 가능.
- **3d (smoke test)**: 비가역 단계 진입 전 마지막 게이트.
- **3e (Cloud SQL 해지)**: 3d를 통과한 뒤에만 진행.

3d 없이 3e로 직행했다면 RO 사용자 권한 버그를 발견하지 못한 채로 publisher를 잃었을 것입니다.

### RO 계정으로 DDL을 치면 안 됩니다

`resale_listing_orders`는 "RO 사용자가 테이블 소유자가 된" 비정상 상태였습니다.
원인은 Go 마이그레이션 중 **RO 계정으로 실수 접속 → CREATE TABLE 실행** 경로였습니다.

이후 마이그레이션에서는 owner 변경이 불가능해 pg_dump가 깨지는 2차 피해가 발생했습니다.

체크리스트에 다음 규칙을 추가했습니다.

- migration / seed 작업은 반드시 master account로
- RO 계정으로 DDL 실행 금지
- DDL runbook은 `pglogical.replicate_ddl_command()` 경로만 사용

### Managed DB의 extension allowlist는 아키텍처 결정을 뒤집을 수 있습니다

Cloud SQL을 선택할 때는 "managed 편의성"만 보고 있었지만, pglogical 미지원은 **Multi-Cloud 구성 자체를 불가능하게 만드는** 제약이었습니다.
Managed DB 선택 시점에 **향후 필요한 extension 목록**을 먼저 확인했어야 합니다.

AWS RDS는 2024년부터 pglogical을 공식 지원합니다.
동등한 managed 레벨에서도 벤더마다 allowlist가 다르다는 점을 잊지 말아야 합니다.

### Hook 승인 정책은 비가역 단계의 안전판입니다

이번 작업에서 hook은 다음 지점을 차단했습니다.

- prod `kubectl apply` (user-approval.md 규칙)
- `terraform apply -auto-approve` (Blind Apply 방지)
- 대규모 `terraform state rm`
- `gcloud sql instances delete`

각 지점마다 명시적 추가 승인("진행해", "그렇게 해줘")을 단계별로 받았습니다.
특히 Cloud SQL 삭제와 state rm은 사용자가 직접 실행했습니다.
**비가역 명령을 AI가 자동 실행하지 않도록 하는 설계**가 중요했습니다.

### 1주 시연에는 1주 시연에 맞는 구성이 필요합니다

원안의 Patroni HA + etcd 3노드 + pd-ssd 100GB는 Production-grade 레퍼런스였지만, 이번 범위에는 **과투자**였습니다.
단일 VM + pd-balanced 20GB로 축소해도 시연 목적에는 충분했고, 실제로 2.5시간 안에 끝났습니다.

"이상적인 구성"과 "이번 범위에 맞는 구성"은 다릅니다.
레퍼런스를 그대로 복사하지 않고, 제약 조건(일정, quota, HA 필요성)에 맞춰 축소하는 판단이 2주 일정을 2.5시간으로 압축했습니다.

---

## 남은 작업 — Phase B (pglogical 설정)

이 글은 Phase A(publisher 준비)까지의 기록입니다.
Phase B에서는 실제 replication을 구성합니다.

1. **AWS RDS parameter group**: `shared_preload_libraries=pglogical`, `rds.logical_replication=1`, `default_transaction_read_only=on` (재시작 필요)
2. **AWS NAT egress IP** 확인 → GCP `pg_primary_allowed_ingress_cidrs` tfvars에 추가 후 apply
3. **pglogical 설정**:
   - GCP VM: `pglogical.create_node(...)` + `pglogical.replication_set_add_all_tables(...)` + sequence 포함
   - AWS RDS: `pglogical.create_subscription(...)`
4. **Initial sync 검증**: `pglogical.subscription_status_all`, lag < 5s
