---
title: "PgBouncer 도입 결정 — pool_mode와 배포 방식을 고른 이유"
excerpt: "3000 VU 부하테스트에서 DB 연결 폭증이 주 병목으로 지목됐습니다. PgBouncer를 K8s StatefulSet으로 배포하고 session 모드를 채택한 결정 과정을 정리합니다."
category: challenge
tags:
  - go-ti
  - PgBouncer
  - PostgreSQL
  - ConnectionPool
  - Architecture Decision Record
  - adr
series:
  name: "goti-pgbouncer"
  order: 1
date: "2026-03-15"
---

## 한 줄 요약

> 3000 VU 부하테스트에서 `ticket_success 15.6%`, `order_creation p95 60s timeout`이 나왔습니다. DB 연결 폭증이 주 병목 후보로 지목됐고, PgBouncer를 K8s StatefulSet으로 배포해 connection multiplexing을 적용하기로 결정했습니다.

---

## 배경

### 부하테스트에서 드러난 한계

3000 VU 부하테스트 결과는 심각했습니다.

- `ticket_success`: **15.6%** (목표 90%+)
- `order_creation` p95: **60초 타임아웃**

로그와 메트릭을 추적하니 DB 연결 수 폭증이 가장 강한 신호였습니다.

RDS t3.large의 `max_connections=300`인 상황에서, 6개 Go 서비스가 각각 HPA로 스케일아웃하면 per-pod pool 합산이 순식간에 한계를 넘어섭니다

1. **6 Go 서비스 × HPA × per-pod pool** = 논리적 peak 250+ 연결
2. `max_connections=300`에 빠르게 도달
3. 이후 연결 요청은 대기 또는 거부

### PgBouncer가 해결하는 구조적 문제

PostgreSQL은 연결을 프로세스 단위로 처리합니다.

각 연결이 약 10MB 메모리를 점유하기 때문에 `max_connections`를 무한정 늘릴 수 없습니다. 반면 Go pgx 같은 드라이버는 연결을 세션 단위로 점유하는데, **실제로 쿼리를 실행 중인 시간 비율은 낮습니다.**

이 gap을 메우는 것이 PgBouncer의 역할입니다.

예를 들어 앱 pod 10개가 각각 pool 18개를 보유하면 논리 연결은 180개이지만, 실제 동시 쿼리 실행 중인 것은 평균 30개 수준입니다. PgBouncer는 이 180개의 논리 연결을 실제 DB 연결 30~50개로 다중화(multiplexing)합니다.

### ADR 0012와의 관계

이 ADR은 Read Replica Split(ADR 0012)과 독립적으로 작동합니다.

두 기법의 역할이 다릅니다.

- **ADR 0012 (Read Replica)**: primary의 읽기 부하 분산
- **ADR 0013 (PgBouncer)**: 전체 연결 수 절감 + connection storm 방어

두 기법을 함께 쓰면 `primary 쓰기 경합`과 `총 connection 수` 양쪽을 동시에 해결합니다. 도입 순서는 ADR 0012 → 재측정 → 병목 남으면 ADR 0013으로 잡았습니다.

---

## 🧭 선택지 비교

### Pool Mode — session / transaction / statement

PgBouncer가 제공하는 3가지 pool_mode 중 어느 것을 쓸지가 이 ADR의 핵심입니다.

| 모드 | 연결 반환 단위 | 다중화 효과 | 주요 제약 |
|------|--------------|------------|---------|
| **session** | 앱 연결 종료 시 | 낮음 | 사실상 없음, 100% 호환 |
| **transaction** | 트랜잭션 종료마다 | 중~높음 | prepared statement 공유 불가, `LISTEN/NOTIFY` 불가 |
| **statement** | 쿼리마다 | 최대 | 트랜잭션 불가 (운영 불가) |

각 모드를 구체적으로 살펴보겠습니다.

**session 모드**: 앱이 연결을 끊을 때 DB 연결을 반환합니다. Go pgx의 기본 동작과 완전히 호환됩니다. 다중화 효과가 낮지만, prepared statement·Advisory lock·`SET SESSION` 등 세션 스코프 기능을 제약 없이 사용할 수 있습니다.

**transaction 모드**: 트랜잭션이 끝나면 즉시 DB 연결을 반환해 다른 앱 요청에 재배정합니다. 다중화 효율이 가장 높지만, Go pgx의 기본 동작인 **named prepared statement 캐싱과 충돌**합니다. 연결이 공유될 때 프리페어드 이름이 다른 세션에서 충돌할 수 있습니다. 이를 해소하려면 `QueryExecModeSimpleProtocol`로 전환해야 하고, 이는 6개 서비스 전체에 코드 변경을 요구합니다.

**statement 모드**: 쿼리 단위로 반환합니다. 트랜잭션을 쓸 수 없어 사실상 운영이 불가능합니다.

### 배포 방식 — Sidecar / 중앙 StatefulSet / DaemonSet

| 방식 | 장점 | 한계 |
|------|------|------|
| **Sidecar** (app pod마다 PgBouncer 포함) | 네트워크 hop 없음, 장애 격리 | pod 당 bouncer 1개라 multiplexing 효과 제한 |
| **중앙 StatefulSet** (별도 네임스페이스) | 연결 집중, 효율적 multiplexing | 네트워크 hop 추가, HA 구성 필요 |
| **DaemonSet** (노드당 1개) | 앱과 로컬 통신 가능 | 노드 수 = bouncer 수, 확장 어려움 |

Sidecar는 각 pod에 bouncer가 붙으면 pool이 분산됩니다. 예를 들어 pod 10개면 bouncer도 10개인데, 각 bouncer는 자기 pod의 요청만 처리하므로 전체 연결 수 감소 효과가 제한적입니다.

중앙 StatefulSet은 모든 서비스 요청이 하나의 bouncer 클러스터로 모이기 때문에 multiplexing 효율이 가장 높습니다. 네트워크 hop이 추가되지만, Istio ambient mesh가 이미 깔려 있어 mTLS는 그대로 유지됩니다.

### 호스팅 옵션 — 자체 K8s / RDS Proxy / CloudSQL Proxy

| 옵션 | 장점 | 한계 |
|------|------|------|
| **자체 K8s StatefulSet** | 유연, 커스터마이징 가능, transaction 모드 지원 | 직접 운영 |
| **AWS RDS Proxy** | Managed, IAM 인증 지원, Multi-AZ 자동 | session pinning 발생 (transaction 모드 아님), 비용 ~$150/mo |
| **CloudSQL Proxy (GCP)** | Managed | 인증 프록시 성격, PgBouncer와 역할 다름 |

RDS Proxy는 Managed 편의성이 있지만, **session pinning** 문제가 있습니다. prepared statement나 트랜잭션 특성에 따라 연결이 고정되어 실제 multiplexing 효과가 PgBouncer transaction 모드보다 낮습니다. 비용도 자체 운영 대비 5배 이상 높습니다.

### 결정 기준과 최종 선택

**session 모드 + 중앙 StatefulSet + 자체 K8s**를 채택했습니다.

결정 기준은 다음 우선순위입니다.

1. **코드 변경 최소화**: 6개 서비스 전체가 pgx 기본 동작을 사용 중입니다. transaction 모드는 `QueryExecModeSimpleProtocol` 전환을 요구해 광범위한 코드 영향이 생깁니다
2. **즉시 적용 가능성**: session 모드는 앱 코드 변경 없이 config URL만 바꾸면 됩니다
3. **비용 및 유연성**: 자체 StatefulSet은 월 ~$30, RDS Proxy 대비 비용이 대폭 낮고 pool_mode 제어권도 유지됩니다

transaction 모드와 pgx 호환 대응(Phase C)은 별도 PR로 유예했습니다. 먼저 session 모드로 connection storm 방어 효과를 확인한 뒤 추후 전환 여부를 결정합니다.

---

## 결정: Phase 분리 도입

### 도입 단계

ADR 0012 Read Replica를 먼저 도입하고 재측정합니다.

1. **Phase 1**: ADR 0012 read replica 우선 도입 (읽기 70% 분리로 primary 부하 완화)
2. **Phase 2**: 재측정 후 primary conn 경합이 여전하면 PgBouncer 도입
3. **Phase 3**: 안정화 후 transaction 모드 전환 여부 별도 결정

Phase 2 조건부 도입 트리거:
- ADR 0012 도입 후 `primary_write_pool_usage > 80%`가 지속될 때
- RDS `max_connections` 500을 도달하고도 부족할 때
- 앱 pod 스케일아웃이 DB 연결 한계에 막힐 때

### 목표 아키텍처

![PgBouncer 도입 후 목표 연결 풀 아키텍처](/diagrams/goti-pgbouncer-connection-pooling-adr-1.svg)

모든 Go 서비스가 단일 PgBouncer endpoint로 연결하면, PgBouncer가 내부적으로 write/read 트래픽을 Primary와 Replica로 각각 분산합니다.

앱은 두 개의 DB endpoint를 직접 관리할 필요가 없습니다. PgBouncer config에서 `goti_write`와 `goti_read` 두 가지 논리 DB 이름을 제공하면 됩니다.

TLS 처리도 분담됩니다. 앱 ↔ PgBouncer 구간은 Istio ambient mTLS가 담당하고, PgBouncer ↔ RDS 구간은 `server_tls_sslmode=require`로 별도 보호합니다.

---

## 구현 계획

### Phase A — K8s PgBouncer 배포

```yaml
# infrastructure/prod/pgbouncer/values.yaml
replicaCount: 2
image:
  repository: edoburu/pgbouncer
  tag: 1.23.1
service:
  type: ClusterIP
  port: 6432
config:
  pool_mode: session
  default_pool_size: 25
  max_client_conn: 2000
  min_pool_size: 5
  reserve_pool_size: 5
  reserve_pool_timeout: 3
  server_idle_timeout: 300
  server_lifetime: 3600
  server_reset_query: "DISCARD ALL"  # 세션 state 초기화
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

HA는 2 replicas + ClusterIP Service로 구성합니다. 앱은 endpoint 하나만 알면 됩니다.

### Phase B — 앱 Config 전환

앱 코드는 변경하지 않습니다. values.yaml의 DB URL만 바꿉니다.

```yaml
# Before
TICKETING_DATABASE_WRITE_URL: "postgres://.../goti@rds-primary:5432/goti"

# After
TICKETING_DATABASE_WRITE_URL: "postgres://.../goti@pgbouncer.goti.svc:6432/goti_write"
TICKETING_DATABASE_READ_URL:  "postgres://.../goti@pgbouncer.goti.svc:6432/goti_read"
```

전환 순서는 user → payment → resale → ticketing → queue 순으로 서비스별 canary 배포합니다.

### Phase C — Prepared Statement 대응 (유예)

session 모드에서는 prepared statement 충돌이 발생하지 않습니다. 추후 transaction 모드로 전환할 경우에만 필요한 작업입니다.

Go pgx 기준 3가지 대응 방안을 검토했습니다.

**방안 1 — Simple Protocol**: 성능 소폭 저하(~10%)이지만 즉시 호환

```go
config.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
```

**방안 2 — Unnamed prepared statement**:

```go
config.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec
```

**방안 3 — Statement cache 비활성**:

```go
config.ConnConfig.StatementCacheCapacity = 0
config.ConnConfig.DescriptionCacheCapacity = 0
```

환경변수로 스위치를 제공하고, 기본은 Simple Protocol로 운영합니다.

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

```text
env: TICKETING_DATABASE_PGBOUNCER_COMPAT=true
```

### Phase D — 관측

PgBouncer 메트릭을 Prometheus exporter로 수집합니다.

핵심 지표:
- `pgbouncer_pools_cl_waiting`: 대기 중 클라이언트 수 — 이 값이 급등하면 pool 고갈 신호
- `pgbouncer_pools_sv_active`: 활성 server connection 수
- `pgbouncer_stats_avg_wait_time_us`: 클라이언트 평균 대기 시간
- `pgbouncer_databases_current_connections`: DB별 실제 연결 수

`prometheuscommunity/pgbouncer-exporter`를 sidecar로 붙이고, Grafana에 pool saturation 대시보드를 추가합니다.

---

## 제약과 리스크

### 기술 제약

| 제약 | 영향 | 대응 |
|------|------|------|
| `LISTEN/NOTIFY` 불가 (transaction 모드 한정) | pg_notify 기반 이벤트 사용 불가 | Redis pub/sub으로 대체 (이미 사용 중) |
| Advisory lock (session scope) | cross-connection lock 깨짐 (transaction 모드 한정) | Redis distributed lock 사용 (이미 사용 중) |
| session 모드는 다중화 효과 제한 | pool 절감 효과가 transaction 모드보다 낮음 | connection storm 방어는 여전히 유효 |

session 모드에서는 prepared statement 충돌이 없고, `LISTEN/NOTIFY`와 Advisory lock도 정상 동작합니다.

transaction 모드의 제약들이 session 모드에서는 대부분 사라집니다. 현재 Redis를 이미 사용하고 있어 `LISTEN/NOTIFY` 의존성도 없습니다.

### 운영 리스크

| 리스크 | 대응 |
|--------|------|
| PgBouncer 단일 장애점 | 2 replicas + PodDisruptionBudget + anti-affinity |
| pool 고갈 (`cl_waiting` 폭증) | `max_client_conn` 충분히 크게 설정 + alert |
| RDS failover 시 재연결 지연 | `server_reset_query` + health check + retry |

PgBouncer가 단일 장애점이 된다는 우려가 있었습니다. 2 replicas로 구성하고 anti-affinity로 노드를 분리합니다. 한 replica가 내려가도 나머지 replica가 서비스를 유지합니다.

### 비용

- PgBouncer StatefulSet 2 replicas × 500m CPU / 256Mi mem ≈ **$30/월**
- RDS Proxy 대안이면 ≈ **$150~400/월**

자체 운영 비용이 압도적으로 낮고, pool_mode와 설정 파라미터에 대한 제어권도 유지됩니다.

---

## 기대 효과

PgBouncer 도입 후 ADR 0012와 함께 재측정했을 때의 예상 수치입니다.

| 지표 | 현재 | ADR 0012 단독 예상 | ADR 0012 + ADR 0013 예상 |
|------|------|-------------------|--------------------------|
| `ticket_success_rate` | 70% | 85% | **90%+** |
| `order_creation_ms` p95 | 60s | 10s | **5s 미만** |
| RDS active connections (primary) | 173/300 | ~100 | **~30** |
| `pgbouncer_cl_waiting` (peak) | n/a | n/a | **50 미만** |

앱 pod 스케일아웃 시에도 DB 연결 수가 고정됩니다. 예를 들어 pod를 10개에서 100개로 늘려도 PgBouncer가 DB 측 연결 수를 일정하게 유지합니다.

RDS 재시작이나 failover 발생 시에도 앱은 PgBouncer에 연결된 상태를 유지하고, PgBouncer가 DB 재연결을 순차적으로 처리합니다. 대량 재연결 폭주(connection storm)를 원천 차단합니다.

---

## 📚 배운 점

- **pool_mode 선택은 코드 영향도로 결정한다**: transaction 모드는 multiplexing 효율이 높지만, Go pgx 기본 동작과 충돌해 6개 서비스 전체 코드 변경을 요구합니다. session 모드로 먼저 연결 수 문제를 잡고, 필요하면 단계적으로 전환하는 것이 현실적입니다
- **중앙 StatefulSet이 Sidecar보다 multiplexing 효율이 높다**: Sidecar는 pod별로 bouncer가 분산되어 pool이 조각납니다. 연결 집중 효과를 얻으려면 중앙 배치가 필수입니다
- **RDS Proxy는 session pinning 문제가 있다**: Managed 편의성보다 connection pool 제어권과 비용이 더 중요한 상황에서는 자체 StatefulSet이 우월합니다
- **PgBouncer 도입만으로 connection storm을 방어할 수 있다**: 앱이 대량으로 재기동할 때 PgBouncer가 완충재 역할을 합니다. 앱은 bouncer에 붙고, bouncer가 DB에 순차적으로 재연결합니다
- **관측이 먼저다**: `pgbouncer_pools_cl_waiting` alert를 PgBouncer 배포와 동시에 설정합니다. 이 값이 급등하면 pool 고갈이 임박했다는 신호입니다

---

## 다음 글 예고

이 글에서는 "왜 session 모드를 채택했고, 어떤 구조로 PgBouncer를 배포할 것인가"라는 결정을 다뤘습니다.

다음 글에서는 **실제 롤아웃 과정에서 만난 문제들** — session 모드 회귀, 특수문자 비밀번호 URL encoding, ANALYZE 누락으로 hot table이 `n_live_tup=0`을 보인 사건 — 을 자세히 다룹니다.
