---
title: "Read Replica 분리 결정 — RDS 수직 확장의 벽을 피하는 수평 확장 경로"
excerpt: "3000 VU 부하테스트에서 단일 RDS의 커넥션 풀 경합이 드러났습니다. AWS RDS Read Replica + 애플리케이션 레벨 read/write 분리를 택해 읽기 70%를 replica로 흡수하도록 설계했습니다."
category: kubernetes
tags:
  - go-ti
  - PostgreSQL
  - ReadReplica
  - Architecture Decision Record
  - ADR
  - Multi-Cloud
series:
  name: "goti-multicloud-db"
  order: 1
date: "2026-04-14"
---

## 한 줄 요약

> 단일 RDS에 6개 Go 서비스가 몰려 `begin tx: context canceled`가 30분 동안 210건씩 발생했습니다. RDS Read Replica + 앱 레벨 read/write 분리로 읽기 70%를 replica로 옮기고, GCP CloudSQL에도 동일 패턴을 이식할 수 있는 수평 확장 경로를 확보했습니다.

---

## 배경

### 현재 병목

2026-04-14 queue-oneshot 3000 VU 부하테스트에서 커넥션 풀 경합이 명확하게 드러났습니다.

```text
"begin tx: context canceled"              210건
"check duplicate seats: context canceled"  69건
"del session: context canceled"            36건
"find grades: context canceled"            33건
```

이 숫자들은 단일 RDS 인스턴스에 요청이 몰리면서 커넥션 획득 단계에서 컨텍스트가 취소된 빈도입니다.
단순 조회든 트랜잭션이든 풀에서 커넥션을 받지 못하면 쿼리가 시작조차 하지 못합니다.

원인 체인은 네 단계로 이어집니다.

1. 6개 Go 서비스(ticketing, stadium, user, payment, resale, queue)가 단일 RDS 인스턴스 `goti-prod-postgres`를 공유합니다. 인스턴스 스펙은 t3.large, `max_connections`는 300입니다.
2. SDD S4 계산에 따르면 6 서비스 × HPA replicas × per-pod pool = 45 pods × 3 conns = 135 커넥션이 필요하다고 보수적으로 산정했습니다.
3. 부하 튜닝 과정에서 ticketing 풀 크기를 3 → 12 → 18로, stadium을 3 → 8로, RDS `max_connections`를 200 → 300까지 상향했습니다.
4. **RDS 수직 확장은 한계**가 분명했습니다. t3.xlarge로 올려도 `max_connections` 500 수준이며, PgBouncer 없이는 수평 확장 경로가 막혀 있습니다.

### 트래픽 특성 분석

읽기와 쓰기의 비중을 정확히 알아야 분리 전략이 의미를 갖습니다.
ticketing과 stadium 도메인의 SQL 호출 분포를 대략적으로 정리하면 다음과 같습니다.

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

**읽기 전용으로 분리 가능한 비중은 약 70%**(상위 4행 합산)입니다.

이 비중은 분리 설계의 타당성을 뒷받침합니다.
트래픽의 7할이 replica로 갈 수 있다면 Primary의 커넥션 경합은 즉각적으로 완화됩니다.
반대로 쓰기 비중이 높은 도메인이라면 replica 도입 효과가 제한적이었겠지만, 티켓팅 워크로드는 구조적으로 읽기가 많습니다.

### GCP 확장 맥락

`project_multi_cloud_plan.md`에 따라 AWS + GCP Multi-Cloud 전환이 예정되어 있습니다.
GCP CloudSQL도 동일한 확장 구조가 필요하고, AWS에서 먼저 검증한 패턴을 GCP에 그대로 이식할 수 있어야 합니다.
앱 레벨의 read/write 분리는 벤더 중립적이므로 이 요구에 잘 맞습니다.

---

## 고려한 대안

### A. RDS Read Replica + 앱 레벨 분리

RDS에 Read Replica를 추가하고, 앱 코드에서 읽기/쓰기 풀을 명시적으로 선택하는 방식입니다.

장점은 구조적 해결이라는 점입니다.
replica 수를 추가하는 것만으로 읽기 처리량을 선형으로 늘릴 수 있고, GCP CloudSQL에도 동일한 전략이 먹힙니다.
단점은 앱 repository에 전수 태깅 작업이 필요하고, 복제 지연(0에서 수 초)이 존재한다는 점입니다.

### B. PgBouncer

커넥션 멀티플렉싱으로 적은 DB 연결을 다수 앱 인스턴스가 공유하는 방식입니다.

효과는 크지만 **단일 장애점**이 추가되고 HA 구성이 필요합니다.
더 큰 문제는 transaction pooling 모드의 제약입니다.
Go pgx v5는 기본적으로 prepared statement 캐싱을 사용하는데, 이 기능이 PgBouncer transaction pooling과 정면으로 충돌합니다.
`LISTEN/NOTIFY`, advisory lock의 session scope 유지도 불가능합니다.

### C. RDS 수직 확장

t3.large에서 t3.xlarge로 올리면 `max_connections` 기본값이 약 856까지 증가합니다.

즉시 적용 가능하다는 장점이 있지만 **근본 해결이 아닙니다**.
운영비가 선형으로 증가하고, 단일 노드의 CPU/IO 병목은 그대로 남습니다.
부하테스트 중간 브리지 이상으로는 사용하기 어렵습니다.

### D. A + B 조합

Read Replica와 PgBouncer를 함께 쓰면 효과는 최대가 됩니다.
다만 복잡도가 높아 Phase 3에서 재검토 대상으로 미뤘습니다.

---

## 결정

대안 A(**AWS RDS Read Replica + 애플리케이션 레벨 read/write 분리**)를 채택합니다.

B(PgBouncer)를 배제한 결정적 이유는 Go pgx v5의 prepared statement 캐싱 때문입니다.
PgBouncer transaction pooling과 함께 쓰려면 캐싱을 꺼야 하는데, 이는 쿼리 플래너 캐시 이점을 모두 포기하는 선택입니다.
A 방식이 구조적으로 더 깔끔하고 GCP 이식성도 높습니다.

### 목표 구성

```text
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

아키텍처의 핵심은 **서비스 당 두 개의 커넥션 풀**입니다.

- `writePool`은 Primary endpoint에 연결하며 트랜잭션과 쓰기 전용입니다.
- `readPool`은 Replica endpoint에 연결하며 순수 읽기만 수행합니다. 경합이 적으므로 풀 크기를 더 크게 잡을 수 있습니다.

ticketing 서비스를 예로 들면 풀 크기는 다음과 같이 재설계됩니다.

- Before: 단일 풀 × 18 conns × 10 pods = 180 커넥션이 모두 Primary로 향했습니다.
- After: write 풀 × 6 + read 풀 × 18 = 24 conns × 10 pods = Primary 60 + Replica 180입니다.

Primary 커넥션이 180에서 60으로 줄어드니 경합이 근본적으로 완화됩니다.
동시에 읽기 용량은 Primary + Replica 통합으로 오히려 증가합니다.

---

## 근거

### 왜 앱 레벨 분리인가

Read Replica를 띄우는 것 자체는 어렵지 않지만, **어느 쿼리가 replica로 가야 하는지**는 애플리케이션만 알 수 있습니다.
proxy 레벨에서 자동 라우팅(예: `SELECT`는 replica로)을 시도하면 `SELECT ... FOR UPDATE`나 read-your-write 요구 쿼리를 잘못 보낼 위험이 있습니다.

앱 레벨에서 명시적으로 풀을 선택하면 다음과 같은 장점이 있습니다.

- 개발자가 쿼리 의도를 코드에 드러낼 수 있습니다.
- 트랜잭션 내 읽기는 자연스럽게 Primary로 가게 됩니다(이미 `tx` 객체를 통과하므로).
- 결제 직후 주문 상세 조회처럼 강한 일관성이 필요한 지점을 선별적으로 Primary로 보낼 수 있습니다.

### 왜 PgBouncer가 아닌가

앞서 언급했듯 Go pgx v5의 prepared statement 캐싱이 전제입니다.
`prepared_statement_cache_queries` 기본값이 활성이며, 이를 끄면 쿼리 플래너가 매 호출마다 파싱/플랜을 다시 수행합니다.
티켓팅처럼 동일 쿼리가 초당 수천 번 실행되는 워크로드에서는 파싱 비용이 누적되어 오히려 지연이 커집니다.

PgBouncer의 session pooling 모드로 가면 caching은 유지되지만, 그 경우 PgBouncer의 핵심 가치(한 커넥션을 여러 트랜잭션이 공유)가 사라집니다.
사실상 단순 TCP proxy가 되어 도입 의미가 줄어듭니다.

### 왜 Multi-Cloud 호환 설계인가

GCP 확장이 로드맵에 있는 이상, AWS에서 굳어지는 패턴이 GCP에도 바로 적용될 수 있어야 합니다.
Read Replica는 AWS RDS와 GCP CloudSQL 모두 동일한 1차 시민 기능으로 제공되며, 앱 코드는 **환경변수로 endpoint만 바꾸면** 양쪽에서 그대로 동작합니다.

반면 PgBouncer를 도입하면 클라우드마다 Helm 차트, HA 구성, 네트워크 정책을 별도로 관리해야 합니다.
Multi-Cloud 초기 단계에서 감당하기에는 운영 복잡도가 큽니다.

---

## 구현 개요

실제 구현은 다섯 단계로 나뉩니다.

### Phase 1: 인프라 (1~2일)

Terraform으로 AWS RDS Read Replica를 추가합니다.

```hcl
resource "aws_db_instance" "goti_prod_postgres_replica" {
  identifier              = "goti-prod-postgres-ro-1"
  replicate_source_db     = aws_db_instance.goti_prod_postgres.identifier
  instance_class          = "db.t3.large"
  publicly_accessible     = false
  skip_final_snapshot     = true
  parameter_group_name    = aws_db_parameter_group.goti_prod_pg16.name
  backup_retention_period = 0
  tags = { role = "reader" }
}

output "replica_endpoint" {
  value = aws_db_instance.goti_prod_postgres_replica.endpoint
}
```

`backup_retention_period = 0`은 replica 자체 백업을 끄는 설정입니다.
Primary 백업이 이미 존재하므로 replica 백업은 비용 낭비입니다.

GCP CloudSQL도 동일 구조로 구성합니다.

```hcl
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

ExternalSecret으로 앱에 DB URL을 주입합니다.
기존 `TICKETING_DATABASE_URL`은 `TICKETING_DATABASE_WRITE_URL`로 이름을 변경하고, 신규 `TICKETING_DATABASE_READ_URL`을 추가합니다.

### Phase 2: Go 애플리케이션 (2~3일)

`pkg/database/pool.go`에 이중 풀 구조를 도입합니다.

```go
type Pools struct {
    Write *pgxpool.Pool
    Read  *pgxpool.Pool
}

func NewPools(ctx context.Context, cfg Config) (*Pools, error) {
    writePool, err := pgxpool.NewWithConfig(ctx, cfg.WriteConfig())
    if err != nil {
        return nil, err
    }

    if cfg.ReadURL == "" || cfg.ReadURL == cfg.WriteURL {
        return &Pools{Write: writePool, Read: writePool}, nil
    }
    readPool, err := pgxpool.NewWithConfig(ctx, cfg.ReadConfig())
    if err != nil {
        writePool.Close()
        return nil, err
    }
    return &Pools{Write: writePool, Read: readPool}, nil
}
```

`ReadURL`이 비어 있거나 `WriteURL`과 동일하면 Read 포인터를 Write 풀로 가리키게 합니다.
이렇게 해 두면 dev/local 환경에서는 단일 DB로 동작하고, 프로덕션에서는 자동으로 이중 풀로 전환됩니다.

`Querier` 인터페이스는 유지합니다(`pgxpool.Pool`과 `pgx.Tx` 모두 이를 구현하므로 Repository 메서드 시그니처는 변경 없이 호출측이 풀을 선택하기만 하면 됩니다).

### Phase 3: Repository 태깅 (3~5일)

6개 서비스의 repository를 순회하며 메서드에 주석 태그를 붙입니다.

```go
// READ-ONLY: replica 안전
func (r *SeatRepo) FindGradesByStadiumID(ctx context.Context, q database.Querier, stadiumID uuid.UUID) (...)

// WRITE / TX: primary 필수
func (r *SeatRepo) HoldSeat(ctx context.Context, tx pgx.Tx, ...) (...)
```

호출 규칙은 다음과 같이 정리합니다.

- `Begin`, `Exec`, `CopyFrom`, `INSERT/UPDATE/DELETE`는 **반드시 Write**
- `SELECT ... FOR UPDATE`, `SELECT ... FOR NO KEY UPDATE`는 **반드시 Write**
- read-your-write가 필요한 `SELECT`는 **Write**
- 그 외 `SELECT`는 **Read** (replica)

이 규칙은 강제되지 않는 컨벤션이지만, 주석 태그 덕분에 리뷰 시 눈에 들어옵니다.

### Phase 4: Helm/Config (1일)

Helm values에 두 개의 DB URL과 풀 크기를 나누어 정의합니다.

```yaml
env:
  - name: TICKETING_DATABASE_WRITE_URL
    valueFrom:
      secretKeyRef:
        name: goti-ticketing-v2-prod-secrets
        key: DATABASE_WRITE_URL
  - name: TICKETING_DATABASE_READ_URL
    valueFrom:
      secretKeyRef:
        name: goti-ticketing-v2-prod-secrets
        key: DATABASE_READ_URL
  - name: TICKETING_DATABASE_WRITE_MAX_CONNS
    value: "6"
  - name: TICKETING_DATABASE_READ_MAX_CONNS
    value: "18"
```

쓰기 풀은 6, 읽기 풀은 18로 비대칭 설정을 사용합니다.
`TICKETING_DATABASE_READ_URL`이 없으면 `WRITE_URL`을 재사용하도록 하여 single DB 모드 호환성을 유지합니다.

### Phase 5: Observability (0.5일)

다음 메트릭을 Grafana에 노출합니다.

- `pg_stat_replication` (Primary 기준): WAL lag, sent/flush/replay LSN
- pgx 풀 메트릭: `pgx_pool_acquired_connections{pool="read|write"}`
- read pool과 write pool 사용률 비교 대시보드

알림 임계값은 다음과 같이 설정합니다.

- Replica lag > 5s: Warning
- Replica lag > 30s: Critical (replica 일시 제외 운영 검토)
- Write pool 사용률 > 80%: Warning

---

## 마이그레이션 계획

롤아웃은 단계별로 진행합니다.

1. **Infra 선행**: Terraform apply로 replica 생성. 초기 복제 완료까지 약 30분입니다.
2. **Config 선행**: AWS SSM에 READ URL 추가. 앱은 배포 시점에 이 값을 읽습니다.
3. **앱 배포 (canary)**: stadium 서비스부터 적용합니다. 트래픽 영향이 상대적으로 제한적이기 때문입니다.
4. **모니터링 (24시간)**: replica lag, read pool 사용률, 에러율을 확인합니다.
5. **전파 (순차 배포)**: user → payment → resale → ticketing 순으로 배포합니다. queue는 DB 사용이 거의 없어 최후로 미룹니다.
6. **부하테스트 재검증**: queue-oneshot 3000 VU로 재측정합니다. 목표는 `ticket_success_rate > 85%`, `order_creation p95 < 10s`입니다.

### 롤백 전략

롤백은 세 수준에서 가능합니다.

- Config 레벨: `TICKETING_DATABASE_READ_URL` 환경변수를 제거하면 single DB 모드로 자동 fallback됩니다.
- 코드 레벨: 롤백이 필요 없습니다. 코드는 항상 `pools.Read` 경로를 허용하되, 동일 endpoint면 동일 풀을 가리킵니다.
- Infra 레벨: replica는 그대로 두고 아무도 참조하지 않으면 됩니다. 비용만 남습니다.

이 다층 롤백 구조 덕분에 코드 배포와 인프라 변경이 독립적으로 되돌려질 수 있습니다.

---

## 결과

결정에 따른 결과를 항목별로 정리합니다.

### 긍정적 효과

- **Primary 커넥션 경합의 대폭 완화**: 읽기 70%가 replica로 이동하므로 write pool이 작아도 여유가 생깁니다.
- **수평 확장 경로 확보**: replica를 추가하면 읽기 TPS를 2배, 3배 선형으로 증가시킬 수 있습니다.
- **쓰기 지연 개선**: Primary CPU/IO가 쓰기에만 집중되어 쓰기 처리량도 함께 개선됩니다.
- **Multi-Cloud 확장 용이**: AWS에서 검증된 패턴이 GCP에 그대로 이식됩니다.
- **Blast radius 축소**: replica 1대가 죽어도 Primary에는 영향이 없습니다.

### 부정적 효과

- **비동기 복제 지연**: 기본 0에서 수 초. 읽기 직후 쓰기 미반영 가능성이 있으므로, 명시적으로 Write 풀을 경유해야 하는 지점을 식별해야 합니다.
- **코드 복잡도 증가**: `Querier` 인자 관리, Repository 태깅, 호출측 선택이 늘어납니다.
- **비용**: replica 1대가 약 $90/월(t3.large) 추가됩니다. DB 비용이 2배가 됩니다.
- **운영 복잡도**: 인스턴스 2개 모니터링, 복제 끊김 감지, failover 플랜이 필요합니다.

### 중립적 사항

- **`max_connections`**: Primary 300, Replica 300으로 총 600 capacity가 됩니다.
- **스키마**: 변경이 없습니다. replica가 자동 복제합니다.
- **트랜잭션 경계**: 기존 그대로 유지됩니다.

---

## 검증 기준

Phase 2~3 배포 완료 후 부하테스트 재측정 기준을 다음과 같이 설정합니다.

| 지표 | 현재 | 목표 |
|------|------|------|
| `ticket_success_rate` | 70% | **> 85%** |
| `order_creation_ms` p95 | 60s | **< 10s** |
| `begin tx: context canceled` 건수 | 210/30m | **< 10/30m** |
| primary pool 사용률 (peak) | ~100% | **< 60%** |
| replica lag | n/a | **< 3s (p95)** |
| read pool 사용률 (peak) | n/a | 40~70% (여유 있음) |

이 지표들은 "경합 해소"와 "replica 여유 확보"라는 두 축을 같이 잡도록 설계되었습니다.
Primary 풀 사용률이 60% 이하로 떨어지면 경합이 해소된 것이고, read pool 사용률이 40~70% 범위면 replica 역시 여유가 있는 동시에 충분히 활용되고 있다는 뜻입니다.

---

## 상태 업데이트 (2026-04-18)

이 ADR은 **부분 폐기(Partially Superseded)** 상태로 전환되었습니다.

- **GCP 측**: Cloud SQL Read Replica 계획은 후속 ADR에 의해 폐기되었습니다. Cloud SQL 자체를 삭제하고 GCE VM `goti-prod-pg-primary` 단일 Primary로 대체했습니다. 읽기 부하 분산이 필요해지면 향후 streaming replication standby를 검토합니다.
- **AWS 측**: `aws_db_instance.replica` 모듈 코드와 `enable_read_replica` flag는 유지됩니다. 현재 Phase B에서 AWS RDS는 pglogical subscriber 역할을 겸하고 있습니다.
- **PgBouncer RW/RO 분리**: 후속 ADR의 "쓰기 위치 대칭 읽기 Replica"로 범위가 이동되었습니다. 구현은 Phase B 이후로 미룹니다.

이 변경은 Multi-Cloud 전략 자체가 "AWS + GCP 동시 서빙"에서 "GCP 단일 + AWS 백업"으로 재정렬되면서 발생했습니다.
단순 Read Replica 분리만으로는 cross-region 복제와 failback 요구를 만족시킬 수 없었고, pglogical 기반 논리 복제로 노선을 변경한 것이 근본적인 원인입니다.

---

## 후속 ADR 후보

- **PgBouncer 조건부 도입**: replica 도입 후에도 Primary 커넥션 경합이 남으면 재검토합니다.
- **Cross-region Replica**: GCP 멀티리전 재해복구 설계 시 별도 ADR로 분리합니다.
