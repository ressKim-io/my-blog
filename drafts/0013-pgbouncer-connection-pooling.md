# ADR 0013: PgBouncer 도입 — Connection Multiplexing

- **Status**: Proposed
- **Date**: 2026-04-14
- **Deciders**: ressKim
- **Related**: ADR 0012 (Read Replica Split), SDD stadium-go-performance S4

## PgBouncer란?

**한 줄 요약**: PostgreSQL 앞에 놓이는 **연결 중개 프록시**. 앱의 수많은 논리적 연결을 소수의 실제 DB 연결로 다중화(multiplexing).

### 왜 필요한가

Go pgx 같은 드라이버는 연결을 세션 단위로 점유한다. 하지만 실제로 **연결이 활발히 쿼리 중인 시간 비율**은 낮다 (대부분 idle). PostgreSQL 입장에서 각 연결은 프로세스/메모리 (~10MB) 비용이 있어 `max_connections` 한계가 낮게 잡혀 있다.

**예시**:
- 앱 pod 10개 × 각각 pool 18개 = 180 논리 연결
- 실제 동시 쿼리 실행 중인 것은 평균 30개
- PgBouncer로 "pool 1000 → DB 50" 다중화 → PostgreSQL 측 연결 수 극적 감소

### 작동 방식 (3 가지 모드)

| 모드 | 연결 할당 단위 | 장점 | 제약 |
|------|--------------|------|------|
| **session** | 앱 연결 전체 | 100% 호환 | 다중화 효과 거의 없음 |
| **transaction** | 트랜잭션 종료마다 반환 | 적정 효과 | prepared statement 공유 불가, `LISTEN/NOTIFY` 불가 |
| **statement** | 쿼리마다 반환 | 최대 효과 | 트랜잭션 불가 (사실상 운영 X) |

Goti는 **transaction mode**가 현실적 선택.

## Context

### 현재 상황 (2026-04-14 기준)

- RDS t3.large, `max_connections=300`
- 6 Go 서비스 × HPA × per-pod pool = 논리적 peak 250+ 연결
- **한계**: 더 이상 pool 올리면 `max_connections` 초과, 수직 확장도 300~500이 현실선
- ADR 0012에서 read replica 도입으로 primary 절반 완화 예정이나, **쓰기 요청이 늘어나면 여전히 한계**

### PgBouncer가 보완하는 지점

| 시나리오 | 효과 |
|----------|------|
| 트래픽 급증 시 앱 pod 스케일아웃 | 앱 pool 몇 개 늘어도 실제 DB conn은 증가 안 함 |
| 앱 idle connection 다수 보유 | PgBouncer가 자동 회수해 다른 활성 요청에 재배정 |
| DB 재시작 시 대량 재연결 폭주 | PgBouncer가 완충, DB는 순차 접수 |
| 멀티 서비스 공유 DB | 서비스별 pool 합이 DB max_connections 넘어도 동작 |

### ADR 0012와의 관계

- **독립**: 0012 없이 PgBouncer만 써도 효과 있음
- **상호보완**: 두 기법을 조합하면 **primary 쓰기 경합 + 총 connection 수** 양쪽 해결
- **순서**: 0012(read replica) 먼저 → 재측정 → 병목 남으면 0013(PgBouncer) 도입

## Decision

**Phase 분리 도입**:
1. Phase 1: ADR 0012 read replica 우선 도입 (구조적 해결)
2. Phase 2: 재측정 후 primary conn 경합 여전하면 PgBouncer 도입
3. Phase 3: 안정화 후 prepared statement 대응 결정

### 선택 근거

PgBouncer를 지금 당장 도입 안 하는 이유:
- Read replica (0012) 만으로 병목 상당 해소 예상 (읽기 70% 분리)
- PgBouncer는 **단일 장애점 추가** — HA 구성 시 운영 복잡도 상승
- Go pgx **prepared statement 캐싱과 충돌** → 광범위 코드 영향

**조건부 도입 트리거**:
- 0012 도입 후 재측정에서 `primary_write_pool_usage > 80%`가 sustained
- 또는 RDS `max_connections` 500 도달하고도 모자람
- 또는 앱 pod 스케일아웃이 DB 연결 한계에 막힘

## Architecture

### 목표 구성 (두 replica 이미 있다고 가정)

```
┌──────────┐   ┌──────────┐   ┌──────────┐
│ ticketing│   │ stadium  │   │  user    │   (Go services)
└─────┬────┘   └─────┬────┘   └─────┬────┘
      │              │              │
      └──────────────┼──────────────┘
                     ▼
            ┌─────────────────┐
            │  PgBouncer      │  (StatefulSet, 2 replicas, Istio service mesh)
            │  transaction    │  pool_mode = transaction
            │  pool           │  default_pool_size = 25 per user+db
            └───┬─────────┬───┘  max_client_conn = 2000
         writes│         │reads
                ▼         ▼
        ┌──────────┐  ┌──────────┐
        │ Primary  │  │ Replica  │
        │ RDS      │  │ RDS      │
        └──────────┘  └──────────┘
```

또는 "PgBouncer per-tier" 배치:

```
앱 → PgBouncer-write → Primary
앱 → PgBouncer-read  → Replica
```

**장점**: read/write 라우팅이 PgBouncer config에서 결정 → 앱은 단일 endpoint만 알면 됨
**단점**: PgBouncer 인스턴스 2배

### 배포 방식 비교

| 방식 | 장단 | 선택 |
|------|------|------|
| **Sidecar** (각 app pod에 PgBouncer 포함) | 앱-bouncer 간 네트워크 hop 제로, failure 격리 | pod 당 bouncer 1개라 multiplex 효과 제한, 메모리 낭비 |
| **중앙 StatefulSet** (별도 네임스페이스) | 연결 집중, 효율적 multiplex | 네트워크 hop 추가, HA 필요 | **✅ 선택** |
| **DaemonSet** (노드당 1개) | 앱-bouncer 로컬 통신 | 노드 수 = bouncer 수 (제한적) | - |

### 호스팅 옵션

| 옵션 | 장단 |
|------|------|
| **자체 K8s StatefulSet** | 유연, 커스터마이징 가능, 운영 부담 | **추천 (1순위)** |
| **AWS RDS Proxy** | Managed, IAM 인증 지원 | transaction pooling 아님 (session pinning), 비용 높음 |
| **CloudSQL Proxy (GCP)** | Managed | PgBouncer와 성격 다름 (인증 프록시) |

**결정**: K8s PgBouncer StatefulSet (2 replicas, HA).

## Implementation Plan

### Phase A — K8s PgBouncer 배포 (1일)

```yaml
# infrastructure/prod/pgbouncer/values.yaml (Bitnami 또는 custom chart)
replicaCount: 2
image:
  repository: edoburu/pgbouncer
  tag: 1.23.1
service:
  type: ClusterIP
  port: 6432
config:
  pool_mode: transaction
  default_pool_size: 25        # per (db, user) pair
  max_client_conn: 2000        # total client connections
  min_pool_size: 5
  reserve_pool_size: 5
  reserve_pool_timeout: 3
  server_idle_timeout: 300
  server_lifetime: 3600
  server_reset_query: "DISCARD ALL"  # 세션 state 초기화 (transaction mode 필수)
  # read/write 라우팅 (pgbouncer.ini 여러 db 섹션)
  databases:
    goti_write:
      host: goti-prod-postgres.xxx.rds.amazonaws.com
      port: 5432
      dbname: goti
      pool_size: 20
    goti_read:
      host: goti-prod-postgres-ro-1.xxx.rds.amazonaws.com
      port: 5432
      dbname: goti
      pool_size: 50
auth:
  authFile: /etc/pgbouncer/userlist.txt  # secret mount
```

**HA**: 2 replicas + Service ClusterIP. 앱은 endpoint 1개만 알면 됨.

**TLS**:
- 앱 → PgBouncer: Istio mTLS (기존 ambient mesh 활용)
- PgBouncer → RDS: `server_tls_sslmode=require`

### Phase B — 앱 Config 전환 (0.5일)

values.yaml 변경:
```yaml
# Before
TICKETING_DATABASE_WRITE_URL: "postgres://.../goti@rds-primary:5432/goti"

# After
TICKETING_DATABASE_WRITE_URL: "postgres://.../goti@pgbouncer.goti.svc:6432/goti_write"
TICKETING_DATABASE_READ_URL:  "postgres://.../goti@pgbouncer.goti.svc:6432/goti_read"
```

앱 코드 변경 **없음** (config만 바뀜).

### Phase C — Prepared Statement 대응 (1일)

Go pgx의 기본 동작:
- `*pgxpool.Pool.Exec/Query` → connection obtain → named prepared statement 자동 캐싱
- transaction mode PgBouncer에선 **연결 공유** → 프리페어드 이름 충돌 가능

**해결책 3가지**:

1. **Simple protocol 사용** (성능 소폭 저하):
   ```go
   config, _ := pgxpool.ParseConfig(dsn)
   config.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
   ```
   장점: 즉시 호환. 단점: 바인딩 오버헤드 +10%, SQL 인젝션 방어는 pgx가 여전히 에스케이프.

2. **Unnamed prepared statement만 사용**:
   ```go
   config.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec
   ```

3. **Statement cache 비활성**:
   ```go
   config.ConnConfig.StatementCacheCapacity = 0
   config.ConnConfig.DescriptionCacheCapacity = 0
   ```

**추천**: Phase C에서 **환경변수로 스위치** 제공, 기본은 Simple Protocol로 운영 시작. 성능 저하가 측정되면 unnamed statement 모드로 전환.

```go
// pkg/database/pool.go
func NewPool(ctx context.Context, cfg Config) (*pgxpool.Pool, error) {
    poolCfg, err := pgxpool.ParseConfig(cfg.URL)
    if err != nil { return nil, err }

    if cfg.PgBouncerCompat {
        poolCfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
        poolCfg.ConnConfig.StatementCacheCapacity = 0
    }
    return pgxpool.NewWithConfig(ctx, poolCfg)
}
```

env: `TICKETING_DATABASE_PGBOUNCER_COMPAT=true` (PgBouncer 경유 시만 켬)

### Phase D — 관측 (0.5일)

**PgBouncer 메트릭**:
- `pgbouncer_stats_total_query_count` (쿼리 처리량)
- `pgbouncer_stats_avg_wait_time_us` (클라이언트 wait 시간)
- `pgbouncer_pools_cl_waiting` (대기 중 클라이언트 수) — ⚠️ alert
- `pgbouncer_pools_sv_active` (활성 server connection 수)
- `pgbouncer_databases_current_connections`

**Prometheus exporter**: `prometheuscommunity/pgbouncer-exporter` sidecar

**Grafana 대시보드 추가**:
- pool saturation (cl_waiting / max_client_conn)
- DB connection 효율 (sv_active / pool_size)
- 쿼리 wait time 분포

## 제약 및 리스크

### 기술 제약 (transaction mode)

| 제약 | 영향 | 대응 |
|------|------|------|
| Named prepared statements 공유 안 됨 | 쿼리 성능 -5~10% | Simple protocol + 자주 쓰는 쿼리만 explicit prepare |
| `LISTEN/NOTIFY` 작동 안 함 | pg_notify 기반 이벤트 불가 | Redis pub/sub로 대체 (이미 사용 중) |
| `SET SESSION`, `RESET` 효과 연결 경계 넘어 안 유지 | 세션 변수 불가 | `server_reset_query=DISCARD ALL` 기본 동작 |
| Advisory lock (session scope) 불가 | 애플리케이션 레벨 cross-connection lock 깨짐 | Redis distributed lock 사용 (이미 사용 중) |
| 서버측 커서 (cursor WITHOUT HOLD) 불가 | - | 현재 사용 사례 없음 (전수 grep 필요) |

### 운영 리스크

| 리스크 | 대응 |
|--------|------|
| PgBouncer 단일 장애점 | 2 replicas + PodDisruptionBudget + anti-affinity |
| PgBouncer pool 고갈 (cl_waiting 폭증) | `max_client_conn` 충분히 크게 + alert |
| RDS failover 시 PgBouncer 재연결 지연 | `server_reset_query` + health check + retry |
| Prepared statement 불일치 → 쿼리 실패 | Phase C에서 Simple Protocol로 방어. 모드 전환 canary 배포 |

### 비용

- PgBouncer StatefulSet 2 replicas × 500m CPU / 256Mi mem = ~$30/mo on EKS
- RDS Proxy 대안이면 ~$150/mo (가장 저렴 등급 기준)

## Consequences

### Positive

- **연결 수 급감**: 앱 논리 pool 수와 무관하게 DB 연결 고정 가능
- **스케일아웃 해방**: 앱 pod 10개 → 100개로 스케일해도 DB 영향 미미
- **RDS 재시작/failover 완충**: 클라이언트는 bouncer에 붙어있고 bouncer가 재연결
- **Connection storm 방지**: 앱 대량 재기동 시 bouncer가 순차 접수
- **read/write 라우팅 단일화**: 앱에서 2개 endpoint 관리 → bouncer config 1개에 통합 가능

### Negative

- **복잡도 추가**: 네트워크 hop 1 증가, 운영 대상 +1
- **Prepared statement 비호환**: pgx 디폴트 동작 바뀜 (일회성 쿼리 성능 ~5% 저하)
- **Pooling mode 제약**: session-scoped 기능 사용 불가 (현재 사용 중 없음 확인 필요)
- **디버깅 어려움**: "어떤 DB connection이 어떤 앱 요청이었나" 매핑 간접화 (trace 연결 필요)

### Neutral

- **DB 스키마**: 변경 없음
- **앱 비즈니스 로직**: 변경 없음 (pgx 설정만)

## Alternatives

### AWS RDS Proxy

| 항목 | PgBouncer | RDS Proxy |
|------|-----------|-----------|
| Pooling mode | session/transaction/statement | **session-like with pinning** (완전 transaction 아님) |
| 비용 | $30/mo (self-host) | $150~400/mo |
| 운영 | 직접 | Managed |
| IAM 인증 | 별도 | **지원** |
| PostgreSQL 호환성 | 높음 | prepared statement 문제 여전 (pinning 발생) |
| Multi-AZ HA | 수동 구성 | 자동 |

**판단**: 자체 운영이 압도적 비용 + 유연성 이점. 장애 대응 노하우 축적도 전략적.

### 앱 레벨 connection 재사용 강화

- Go `pgxpool` `MaxConnLifetime` 축소
- `MaxConnIdleTime` 축소
- HTTP keep-alive 최적화

**한계**: DB 측 `max_connections` 증가는 못 막음. 본질적 해결 아님.

## Validation Criteria

PgBouncer 도입 후 부하 재측정 (0012 + 0013 조합):

| 지표 | 현재 (2026-04-14) | 0012 단독 예상 | 0012 + 0013 예상 |
|------|-----|-----|-----|
| `ticket_success_rate` | 70% | 85% | **90%+** |
| `order_creation_ms` p95 | 60s | 10s | **< 5s** |
| RDS active connections (primary) | 173/300 | ~100 | **~30** |
| 앱 pool scale 여유 | 낮음 (300 - 실제사용 173) | 중 | **매우 큼** (pool 3배 늘려도 OK) |
| `pgbouncer_cl_waiting` (peak) | n/a | n/a | **< 50** |

## Implementation Order Summary

1. **ADR 0012 Phase 1~4 완료** → 재측정
2. **2026-05-01 ~ 03**: Phase A (K8s PgBouncer 배포) + Phase D (관측)
3. **2026-05-04**: Phase C (pgx Simple Protocol 스위치) — canary (stadium)
4. **2026-05-05 ~ 07**: Phase B (앱 config 순차 전환) — user → payment → resale → ticketing → queue
5. **2026-05-08**: 부하테스트 재측정

## 관련 문서

- ADR 0012: Read Replica Split (전제)
- SDD: stadium-go-performance-sdd.md S4 (pool 설계 원본)
- Memory: project_multi_cloud_plan.md (GCP 확장)

## 후속 ADR 후보

- **ADR 0014**: PgBouncer HA + disaster recovery plan
- **ADR 0015**: pgx prepared statement 정책 (use case 별 분리)
