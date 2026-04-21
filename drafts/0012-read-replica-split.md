# ADR 0012: Read/Write DB 분리 (Read Replica 도입)

- **Status**: Partially Superseded (2026-04-18)
- **Date**: 2026-04-14
- **Deciders**: ressKim
- **Related**: ADR 0011 (Prometheus Agent Mode), SDD stadium-go-performance S4 (DB pool), project_multi_cloud_plan
- **Supersession Note (2026-04-18)**:
  - **GCP 측**: Cloud SQL Read Replica 계획은 ADR-0018 에 의해 **폐기** (Cloud SQL 자체 삭제, GCE VM `goti-prod-pg-primary` 단일 Primary 로 대체). 읽기 부하 분산 필요 시 향후 streaming replication standby 검토.
  - **AWS 측**: `aws_db_instance.replica` 모듈 코드 및 `enable_read_replica` flag 는 유지. 현재 Phase B 에서 AWS RDS 는 pglogical subscriber 역할 겸용.
  - **PgBouncer RW/RO 분리**: ADR-0019 의 "쓰기 위치 대칭 읽기 Replica" 로 범위 이동됨. 구현은 Phase B 이후 고려.

## Context

### 현재 병목

2026-04-14 queue-oneshot 3000 VU 부하테스트에서 확인된 연결 풀 경합:

```
"begin tx: context canceled"     210건
"check duplicate seats: context canceled"  69건
"del session: context canceled"   36건
"find grades: context canceled"   33건
```

원인 체인:
1. 6 Go 서비스가 단일 RDS `goti-prod-postgres` 공유 (t3.large, max_connections=300)
2. SDD S4 계산: 6서비스 × HPA replicas × per-pod pool = 45 pods × 3 conns = 135 → 보수 설계
3. 부하 튜닝으로 ticketing pool 3→12→18, stadium 3→8, RDS max_connections 200→300 까지 상향
4. **RDS 수직 확장은 한계** — t3.xlarge로 올려도 max_connections 500 수준. PgBouncer 도입 없이 수평 확장 경로 막힘

### 트래픽 특성 분석

ticketing/stadium 도메인 SQL 호출 분포 (대략):

| 패턴 | 비중 | Primary 필요? | 대표 쿼리 |
|------|------|---------------|-----------|
| 좌석 등급/섹션/가격 조회 | 40% | 아니오 | `SELECT FROM seat_grades`, `pricing_policies` |
| 경기 일정/게임 메타 조회 | 15% | 아니오 | `SELECT FROM game_schedules` |
| 주문 내역 조회 (mypage) | 10% | 약한 일관성 OK | `SELECT FROM orders WHERE member_id=$1` |
| 좌석 현재 상태 (lock 없음) | 10% | 약한 일관성 OK | `SELECT status FROM seat_statuses` |
| **좌석 HOLD (FOR UPDATE)** | 10% | **Primary 필수** | `SELECT ... FOR UPDATE`, `UPDATE seat_statuses` |
| **주문 생성 트랜잭션** | 8% | **Primary 필수** | `INSERT orders, order_items, seat_statuses` |
| 결제 확정 (UPDATE) | 5% | Primary 필수 | `UPDATE orders`, inventory adjust |
| 스케줄러 (hold expiry, inventory sync) | 2% | Primary 필수 | 백그라운드 쓰기 |

**읽기 전용 분리 가능 비중: ~70%** (상위 4행 합)

### GCP 확장 맥락

`project_multi_cloud_plan.md`: AWS(삼성) + GCP(두산) Multi-Cloud 전환 예정. GCP CloudSQL도 동일 구조로 확장 필요. AWS 도입 시 GCP 호환 설계 선반영 필요.

## Decision

**AWS RDS Read Replica + 애플리케이션 레벨 read/write 분리** 도입.

### 선택 근거

| 대안 | 장점 | 단점 | 선택 |
|------|------|------|------|
| A. RDS Read Replica + 앱 분리 | 영구 해결, 수평 확장 경로, replica 수 추가만으로 증설, GCP CloudSQL 동일 전략 | 앱 repository 전수 태깅 필요, 복제 지연 (0~수초) | **✅ 선택** |
| B. PgBouncer | connection multiplexing으로 적은 DB 연결로 다수 앱 수용 | 단일 장애점 추가, HA 구성 필요, transaction mode 제약 (prepared stmt, advisory lock) | 추후 보완 |
| C. RDS 수직 확장 | 즉시 적용 | 선형 비용 증가, 단일 노드 CPU/IO bottleneck | 임시 조치만 |
| D. A + B 조합 | 최대 효과 | 복잡도 높음 | Phase 3에서 재검토 |

**B(PgBouncer) 배제 이유**: Go pgx v5의 prepared statement 캐싱이 PgBouncer transaction pooling과 충돌. 별도 세팅 필요. A가 구조적으로 더 깔끔.

## Architecture

### 목표 구성

```
                                       ┌─────────────────┐
                                       │  RDS Primary    │ (t3.large, max_conn=300)
                              writes   │  goti-prod-pg   │
┌──────────────┐  tx=true ─────────────▶│  Writer         │
│ Go Service   │                        └─────────────────┘
│ (ticketing,  │                                 │ async replication
│  stadium,    │                                 ▼
│  user, etc)  │                        ┌─────────────────┐
│              │  reads   ──────────────▶│  RDS Replica   │ (t3.large, max_conn=300)
└──────────────┘ tx=false               │  goti-prod-pg   │
                                        │  Reader         │
                                        └─────────────────┘
```

**연결 풀 구조 (서비스 당)**:
- `writePool` → Primary endpoint (writer)
- `readPool` → Replica endpoint (reader) — 더 큰 size 가능 (읽기 분리 효과)

**풀 사이즈 재설계** (ticketing 예):
- Before: 1 pool × 18 conns × 10 pods = 180 (all Primary)
- After: write pool × 6 + read pool × 18 = 24 × 10 pods = 60 write + 180 read
  - Primary: 60 (경쟁 완화)
  - Replica: 180 (읽기 충분)

## Implementation Plan

### Phase 1 — 인프라 (Terraform, 1~2일)

**AWS RDS Read Replica 추가**

```hcl
# Goti-Terraform/modules/rds/main.tf
resource "aws_db_instance" "goti_prod_postgres_replica" {
  identifier             = "goti-prod-postgres-ro-1"
  replicate_source_db    = aws_db_instance.goti_prod_postgres.identifier
  instance_class         = "db.t3.large"
  publicly_accessible    = false
  skip_final_snapshot    = true
  parameter_group_name   = aws_db_parameter_group.goti_prod_pg16.name
  backup_retention_period = 0  # replica는 backup 불필요 (primary 백업 사용)
  tags = { role = "reader" }
}

output "replica_endpoint" {
  value = aws_db_instance.goti_prod_postgres_replica.endpoint
}
```

**ExternalSecret로 DB URL 주입**:
- 기존 `TICKETING_DATABASE_URL` → `TICKETING_DATABASE_WRITE_URL` (이름 변경)
- 신규 `TICKETING_DATABASE_READ_URL` (replica endpoint)
- AWS SSM Parameter Store에 신규 파라미터 추가

**GCP 동등 구성**:
```hcl
# Goti-Terraform/modules/cloudsql/main.tf
resource "google_sql_database_instance" "goti_prod_postgres_replica" {
  name                 = "goti-prod-postgres-ro-1"
  master_instance_name = google_sql_database_instance.goti_prod_postgres.name
  database_version     = "POSTGRES_16"
  region               = "asia-northeast3"
  replica_configuration {
    failover_target = false
  }
  settings { tier = "db-custom-2-7680" }
}
```

### Phase 2 — Go 애플리케이션 (2~3일)

**pkg/database/pool.go — 이중 풀**

```go
type Pools struct {
    Write *pgxpool.Pool
    Read  *pgxpool.Pool  // nil 이면 Write 로 fallback (dev/local 환경)
}

func NewPools(ctx context.Context, cfg Config) (*Pools, error) {
    writePool, err := pgxpool.NewWithConfig(ctx, cfg.WriteConfig())
    if err != nil { return nil, err }

    if cfg.ReadURL == "" || cfg.ReadURL == cfg.WriteURL {
        return &Pools{Write: writePool, Read: writePool}, nil // single DB
    }
    readPool, err := pgxpool.NewWithConfig(ctx, cfg.ReadConfig())
    if err != nil { writePool.Close(); return nil, err }
    return &Pools{Write: writePool, Read: readPool}, nil
}

// Querier 인터페이스는 기존대로 유지 (pgxpool.Pool, pgx.Tx 모두 구현)
// Repository 메서드는 Querier 파라미터 받음 → 호출측이 Write/Read 선택
```

**Repository 호출 규칙 (convention, not enforced)**:

```go
// Service 레이어에서 호출할 때 명시적 선택
// 읽기 전용 (mypage, browsing)
orders, err := s.orderRepo.FindByMemberID(ctx, s.pools.Read, memberID)

// 트랜잭션 (주문 생성)
err := pgx.BeginFunc(ctx, s.pools.Write, func(tx pgx.Tx) error {
    // ... FOR UPDATE, INSERT, UPDATE 모두 tx(Write) 사용
})

// 읽기 일관성 필요 (결제 완료 직후 주문 상세 조회)
order, err := s.orderRepo.FindByID(ctx, s.pools.Write, orderID)
```

**선택 가이드 (Go 코드 주석/lint 규칙)**:
- `Begin`, `Exec`, `CopyFrom`, `INSERT/UPDATE/DELETE` → **반드시 Write**
- `SELECT ... FOR UPDATE`, `SELECT ... FOR NO KEY UPDATE` → **반드시 Write**
- `SELECT` 중 read-your-write 필요 → **Write**
- 그 외 `SELECT` → **Read** (replica)

### Phase 3 — 서비스별 Repository 태깅 (3~5일)

6개 서비스 repository 순회:
1. ticketing — order_repo, seat_repo, game_repo, inventory_repo, hold_repo
2. stadium — seat_repo, grade_repo
3. user — member_repo, social_repo, account_repo
4. payment — payment_repo, ledger_repo
5. resale — listing_repo, transaction_repo
6. queue — (DB 사용 거의 없음, Redis 중심)

각 메서드에 주석 태그 추가:
```go
// READ-ONLY: replica 안전
func (r *SeatRepo) FindGradesByStadiumID(ctx context.Context, q database.Querier, stadiumID uuid.UUID) (...)

// WRITE / TX: primary 필수
func (r *SeatRepo) HoldSeat(ctx context.Context, tx pgx.Tx, ...) (...)
```

Service 레이어에서 적절한 pool 전달.

### Phase 4 — Helm/Config 업데이트 (1일)

**values.yaml 예**:
```yaml
env:
  - name: TICKETING_DATABASE_WRITE_URL
    valueFrom:
      secretKeyRef: { name: goti-ticketing-v2-prod-secrets, key: DATABASE_WRITE_URL }
  - name: TICKETING_DATABASE_READ_URL
    valueFrom:
      secretKeyRef: { name: goti-ticketing-v2-prod-secrets, key: DATABASE_READ_URL }
  - name: TICKETING_DATABASE_WRITE_MAX_CONNS
    value: "6"   # 쓰기 풀 축소
  - name: TICKETING_DATABASE_READ_MAX_CONNS
    value: "18"  # 읽기 풀 확장
```

**Config 호환성 레이어**:
- 기존 `TICKETING_DATABASE_URL` 단일 세팅도 동작 유지 (dev/local)
- `TICKETING_DATABASE_READ_URL` 없으면 `WRITE_URL` 재사용 → single DB 모드로 동작

### Phase 5 — Observability (0.5일)

**메트릭**:
- `pg_stat_replication` (primary에서): WAL lag, sent/flush/replay LSN
- pgx 메트릭: `pgx_pool_acquired_connections{pool="read|write"}`
- Grafana 대시보드: read pool vs write pool 사용률 비교

**알림**:
- Replica lag > 5s → Warning
- Replica lag > 30s → Critical (replica 일시 제외 운영 검토)
- Write pool usage > 80% → Warning

## Migration Plan

### 단계별 롤아웃

1. **Infra 선행**: Terraform apply로 replica 생성. 복제 완료까지 ~30min.
2. **Config 선행**: AWS SSM에 READ URL 추가. 앱 배포 시 읽음.
3. **앱 배포 (canary)**: 1개 서비스(stadium) 먼저. READ_URL 설정 + pool 분리 배포.
4. **모니터링 (24h)**: replica lag, read pool usage, 에러율 확인.
5. **전파 (순차 배포)**: user → payment → resale → ticketing (핵심). Queue는 DB 거의 안 써서 최후.
6. **부하테스트 재검증**: queue-oneshot 3000 VU. 목표: ticket_success_rate > 85%, order_creation p95 < 10s.

### 롤백 전략

- Config 레벨: `TICKETING_DATABASE_READ_URL` env 제거 → single DB 모드 자동 fallback
- 코드 레벨: 롤백 필요 없음 (코드는 항상 pools.Read 경로 허용, 다만 동일 endpoint 사용)
- Infra: replica는 살려두고 아무도 안 쓰면 됨 (비용만 발생)

## Consequences

### Positive

- **Primary conn 경합 대폭 완화**: 읽기 70% replica 이동 → write pool 적게 써도 충분
- **수평 확장 경로 확보**: replica 추가로 읽기 TPS 2배, 3배 선형 증가 가능
- **읽기 TPS 상한 해제**: primary CPU/IO가 쓰기만 담당 → 쓰기 지연 개선
- **GCP/Multi-Cloud 확장 용이**: AWS에서 검증된 패턴 그대로 이식
- **Blast radius 축소**: replica 1대 장애 시 primary는 영향 없음

### Negative

- **복제 지연 (async)**: 기본 0~수초. 읽기 직후 쓰기 미반영 가능성 → 명시적으로 read pool 우회 필요한 지점 식별
- **코드 복잡도 증가**: Querier 인자 관리, Repository 태깅, 호출측 선택
- **비용**: replica 1대 ~$90/mo (t3.large). 2배.
- **운영 복잡도**: 2개 인스턴스 모니터링, 복제 끊김 감지, failover 플랜

### Neutral

- **RDS max_connections**: Primary는 그대로 300, replica 별도 300 → 총 600 capacity
- **DB 스키마**: 변경 없음 (replica 자동 복제)
- **트랜잭션 경계**: 기존 그대로 유지

## Alternatives 상세 검토

### B. PgBouncer (추후 보완)

조건부 도입:
- read replica 도입 후에도 primary conn 경합이 남으면
- 또는 prepared statement 캐싱을 포기 가능한 도메인 (e.g. 단순 lookup 서비스)

Transaction pooling 모드 사용 시 제약:
- `prepared_statement_cache_queries` 무효
- `LISTEN/NOTIFY` 불가
- advisory lock session scope 유지 안 됨

**판단**: 현재 Go pgx 코드가 prepared statement 디폴트 활성 → 광범위하게 쓰기 어려움.

### C. RDS 수직 확장 (임시 대응)

당장 부하테스트용:
- t3.large (8GB) → t3.xlarge (16GB) 전환 시 max_connections 기본값 ~856 까지 가능
- 다만 운영비 2배, 근본 해결 아님
- 리소스 한계 여전 (단일 노드 CPU/IO)

**판단**: Phase 1 Terraform 진행 중 중간 브리지로만 사용.

## Validation Criteria

Phase 2~3 배포 완료 후 부하테스트 재측정 기준:

| 지표 | 현재 | 목표 |
|------|------|------|
| `ticket_success_rate` | 70% | **> 85%** |
| `order_creation_ms` p95 | 60s | **< 10s** |
| `begin tx: context canceled` 건수 | 210/30m | **< 10/30m** |
| primary pool 사용률 (peak) | ~100% | **< 60%** |
| replica lag | n/a | **< 3s (p95)** |
| read pool 사용률 (peak) | n/a | 40~70% (여유 있음) |

## GCP 확장 호환성

- CloudSQL `replica_configuration` 동일 사용
- 앱 config 동일 (`*_DATABASE_READ_URL`)
- Multi-region: GCP는 같은 region 내 replica 우선, cross-region은 별도 ADR

## Implementation Order Summary

1. **Phase 1 (Infra)**: 2026-04-17 ~ 18 — Terraform replica 생성, ExternalSecret 추가
2. **Phase 2 (App)**: 2026-04-19 ~ 21 — pkg/database Pools 도입, Querier 인터페이스 유지
3. **Phase 3 (Repo 태깅)**: 2026-04-21 ~ 25 — 서비스 순차 배포 (stadium → user → ... → ticketing)
4. **Phase 4 (Helm)**: 2026-04-25 — values.yaml 업데이트
5. **Phase 5 (Observability)**: 2026-04-26 — 대시보드 + 알림
6. **Validation**: 2026-04-27 — 부하테스트 재측정

## 관련 문서

- SDD: `docs/migration/java-to-go/stadium-go-performance-sdd.md` (S4: pool 설계)
- Memory: `project_multi_cloud_plan.md` (GCP 확장 계획)
- Dev log: `docs/dev-logs/2026-04-14-cutover-residual-bugs-and-smoke-7of7.md` (부하 병목 분석)

## 후속 ADR 후보

- **ADR 0013**: PgBouncer 도입 조건부 결정 (replica 도입 후 재측정 결과 기반)
- **ADR 0014**: Cross-region replica (GCP 멀티리전 재해복구 설계 시)
