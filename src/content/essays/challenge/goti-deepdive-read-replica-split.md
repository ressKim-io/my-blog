---
title: "Read Replica — 읽기 부하를 수평으로 분산하는 원리"
excerpt: "Primary 하나가 감당하던 읽기 트래픽을 Replica로 분산하는 방법, 비동기 복제가 만드는 복제 지연과 read-your-write 일관성 문제, 그리고 쿼리 종류별 라우팅 규칙을 설명합니다"
category: challenge
tags:
  - go-ti
  - read-replica
  - replication-lag
  - read-your-write
  - query-routing
  - PostgreSQL
  - concept
series:
  name: "goti-deepdive-database"
  order: 1
date: "2026-04-14"
---

## 한 줄 요약

> Read Replica는 Primary의 데이터를 비동기로 복제한 읽기 전용 인스턴스입니다 읽기 트래픽을 Replica로 분산하면 Primary의 연결 경합을 줄이고 읽기 TPS를 수평으로 확장할 수 있습니다

---

## 🤔 무엇을 푸는 기술인가

단일 데이터베이스 인스턴스는 쓰기와 읽기를 동시에 처리합니다 서비스 규모가 커지면 읽기 트래픽이 쓰기보다 훨씬 많아지는 경향이 있습니다 티켓 예매 서비스를 예로 들면, 좌석 등급·경기 일정·주문 내역을 조회하는 요청이 실제 예매(INSERT) 요청보다 수십 배 많습니다

이 모든 트래픽을 단일 인스턴스가 담당하면 두 가지 문제가 생깁니다

- **연결 풀 경합**: 읽기 연결이 쓰기 연결과 같은 max_connections를 두고 경쟁합니다 읽기가 몰리면 중요한 쓰기 트랜잭션이 연결을 얻지 못해 타임아웃됩니다
- **CPU/IO 병목**: 읽기가 많을수록 Primary의 CPU와 디스크 IO가 소진되어 쓰기 지연까지 악화됩니다

Read Replica는 이 두 문제를 한 번에 해결합니다 읽기 전용 복제 인스턴스를 추가해 읽기 트래픽을 Primary에서 분리합니다 Primary는 쓰기에 집중하고, Replica는 읽기를 흡수합니다 Replica를 한 대 더 추가하면 읽기 TPS가 그만큼 선형으로 늘어납니다 이것이 수직 확장(인스턴스 업그레이드)과 다른 수평 확장 경로입니다

---

## 🔧 동작 원리

### Primary → Replica 비동기 스트리밍 복제

Read Replica는 Primary의 WAL(Write-Ahead Log)을 수신해 동일한 데이터 상태를 유지합니다 PostgreSQL의 물리 스트리밍 복제 또는 논리 복제 중 하나를 사용하며, AWS RDS Read Replica는 물리 스트리밍 복제를 기반으로 합니다

복제 흐름은 다음 순서로 진행됩니다

1. 클라이언트가 Primary에 쓰기를 커밋합니다
2. Primary가 WAL 레코드를 생성합니다
3. Replica의 WAL receiver가 Primary로부터 WAL 스트림을 수신합니다
4. Replica가 수신한 WAL을 재실행(replay)해 로컬 데이터에 반영합니다
5. Replica가 처리 완료된 LSN(Log Sequence Number)을 ACK로 Primary에 반환합니다

이 복제는 **비동기**입니다 Primary는 Replica가 WAL을 반영했는지 확인하지 않고 즉시 클라이언트에게 커밋 성공을 응답합니다 Replica는 뒤에서 따라옵니다

비동기 복제를 선택하는 이유는 쓰기 지연입니다 동기 복제(synchronous_commit = remote_apply)는 Replica가 WAL을 반영할 때까지 Primary의 커밋이 대기합니다 네트워크 지연이 수십ms라면 쓰기 트랜잭션마다 그 지연이 더해집니다 티켓팅처럼 쓰기 지연이 직결되는 도메인에서는 비동기가 기본 선택입니다

### 복제 지연(Replication Lag)이 생기는 이유

비동기 복제의 필연적 결과가 **복제 지연(replication lag)**입니다 Primary에 쓰기가 커밋된 시점과 Replica에 그 변경이 반영되는 시점 사이에 시간 차가 있습니다 정상 운영 환경에서 이 지연은 수십ms~수초 수준입니다

복제 지연을 키우는 요인은 세 가지입니다

- **대량 쓰기 부하**: Primary에 대량 DML이 몰리면 WAL 생성 속도가 Replica의 처리 속도를 초과합니다
- **네트워크 대역폭**: WAL 스트림이 네트워크를 통과하므로 대역폭 부족이나 레이턴시 증가가 지연을 늘립니다
- **Replica 성능**: Replica의 CPU·디스크 성능이 부족하면 WAL replay 속도가 느려집니다

복제 지연은 `pg_stat_replication` 뷰로 모니터링합니다

```sql
-- Primary에서 확인
SELECT application_name,
       write_lag,
       flush_lag,
       replay_lag
FROM   pg_stat_replication;
```

`replay_lag`이 핵심 지표입니다 WAL이 Replica에서 실제로 반영된 시점까지의 지연을 나타냅니다 이 값이 수초를 넘기 시작하면 읽기 일관성에 실질적인 영향이 생깁니다

### Replica는 읽기 전용

Replica 인스턴스에 직접 쓰기(INSERT/UPDATE/DELETE)를 시도하면 오류가 반환됩니다 PostgreSQL의 스트리밍 복제 Standby는 `hot_standby` 모드에서 읽기를 허용하되 쓰기는 거부합니다 AWS RDS Read Replica 역시 엔드포인트 수준에서 쓰기를 차단합니다

이 읽기 전용 보장은 중요한 안전망입니다 애플리케이션 코드가 실수로 읽기 엔드포인트에 쓰기를 보내더라도 데이터베이스가 거부하므로, 데이터 불일치 없이 오류만 반환됩니다

### read-your-write 일관성 문제

Read Replica를 도입하면 반드시 마주치는 문제가 **read-your-write 일관성** 위반입니다

시나리오는 다음과 같습니다

1. 사용자가 주문을 생성합니다 (Primary에 INSERT 커밋)
2. 즉시 마이페이지를 열어 방금 만든 주문을 조회합니다
3. 조회 요청이 Replica로 라우팅됩니다
4. Replica에 아직 복제가 반영되지 않아 방금 만든 주문이 보이지 않습니다

사용자 관점에서는 저장했는데 안 보이는 버그처럼 느껴집니다

![read-your-write 일관성 문제와 회피|tall](/diagrams/goti-deepdive-read-replica-split-1.svg)

위 타임라인은 두 시나리오를 나란히 비교합니다 왼쪽은 INSERT 직후 Replica에서 SELECT를 시도하는 문제 상황입니다 Primary가 커밋을 완료했더라도 Replica에 복제가 반영되기까지 시간 차가 있어, Replica는 이전 상태를 반환합니다 그 결과 방금 저장한 주문이 마이페이지에 나타나지 않습니다

오른쪽은 해결 방법입니다 쓰기 직후 즉시 읽어야 하는 경우에는 Replica 대신 Primary에서 읽습니다 Primary에는 방금 커밋된 데이터가 그대로 있으므로, 복제 지연과 무관하게 최신 값을 즉시 반환합니다 Go 코드에서는 `writePool`(Primary endpoint)을 명시적으로 지정해 이 경로를 선택합니다

read-your-write 일관성이 필요한 상황은 구체적으로 세 가지입니다

- 쓰기 트랜잭션 직후 해당 행을 다시 읽어야 할 때
- 락을 건 후(FOR UPDATE) 상태를 확인해야 할 때
- 결제 확정 후 주문 상태를 즉시 응답해야 할 때

이 세 경우는 모두 Primary에서 읽어야 합니다

### 쿼리 종류별 라우팅 규칙

Read Replica를 도입하면 애플리케이션이 쿼리마다 **어떤 풀로 보낼지 선택**해야 합니다 선택 기준은 명확합니다

**Primary(writePool) 필수**:
- INSERT, UPDATE, DELETE — 쓰기 자체
- SELECT ... FOR UPDATE, SELECT ... FOR NO KEY UPDATE — 락을 수반하는 읽기
- BEGIN으로 시작하는 트랜잭션 전체 — 트랜잭션 내 SELECT도 포함
- 쓰기 직후 즉시 읽기 — read-your-write 일관성 필요

**Replica(readPool) 허용**:
- 참조성 조회 (좌석 등급, 경기 일정, 상품 정보) — 복제 지연이 허용됨
- 마이페이지 주문 내역, 쇼핑 내역 — 수초 지연이 UX에 영향 없음
- 통계성 집계, 리포트 — 정확한 실시간 값이 불필요
- 좌석 현재 상태 조회(락 없음) — 약한 일관성(eventual consistency)으로 충분

![Primary → Replica 비동기 복제 구조와 쿼리 라우팅|tall](/diagrams/goti-deepdive-read-replica-split-2.svg)

위 구조도는 Go 서비스 내 두 풀(`writePool`, `readPool`)이 각각 어느 엔드포인트로 연결되는지 보여줍니다 `writePool`은 Primary(Writer) 엔드포인트로 연결되어 쓰기·락·즉시 읽기 쿼리를 처리합니다 `readPool`은 Replica(Reader) 엔드포인트로 연결되어 일반 SELECT를 처리합니다 Primary에서 Replica로는 비동기 WAL 스트림이 단방향으로 흐릅니다

오른쪽 라우팅 규칙 패널이 실무 선택 기준입니다 Primary 필수 항목(쓰기·락·즉시 읽기)은 트래픽의 약 25%를 차지하고, 나머지 약 75%는 Replica로 분리할 수 있습니다 이 비율이 Read Replica 도입으로 Primary 연결 경합이 줄어드는 핵심 이유입니다

---

## 📐 세부 동작과 옵션

### 연결 풀 재설계

Read Replica를 도입하면 연결 풀을 두 개로 나눕니다 서비스당 하나였던 풀이 `writePool`과 `readPool`로 분리됩니다

```go
type Pools struct {
    Write *pgxpool.Pool
    Read  *pgxpool.Pool  // nil이면 Write로 fallback (개발/로컬)
}
```

이 분리가 Primary 연결 경합을 줄이는 직접적인 메커니즘입니다 기존에는 모든 쿼리가 Primary의 max_connections를 소비했지만, 분리 후에는 쓰기·중요 읽기만 Primary 연결을 씁니다

```go
// 쓰기 — Primary 필수
err := pgx.BeginFunc(ctx, s.pools.Write, func(tx pgx.Tx) error {
    // INSERT, UPDATE, SELECT FOR UPDATE 모두 tx(Write) 사용
    return nil
})

// 일반 읽기 — Replica
orders, err := s.orderRepo.FindByMemberID(ctx, s.pools.Read, memberID)

// 쓰기 직후 즉시 읽기 — Primary
order, err := s.orderRepo.FindByID(ctx, s.pools.Write, orderID)
```

`readPool`의 사이즈는 `writePool`보다 크게 설정할 수 있습니다 읽기 트래픽이 더 많기 때문입니다 Replica의 max_connections 용량 내에서 readPool을 넉넉히 늘리면 읽기 TPS 상한이 올라갑니다

### 단일 DB 호환(fallback)

로컬 개발 환경이나 Replica를 아직 설정하지 않은 서비스에서는 readPool을 writePool로 대체합니다 환경 변수 `DATABASE_READ_URL`이 없거나 `DATABASE_WRITE_URL`과 같으면 자동으로 단일 DB 모드로 동작합니다

```go
if cfg.ReadURL == "" || cfg.ReadURL == cfg.WriteURL {
    return &Pools{Write: writePool, Read: writePool}, nil
}
```

이 설계 덕분에 Replica 없이도 코드가 동작하고, Replica 추가 시 환경 변수만 주입하면 자동 분리됩니다

### 복제 지연 모니터링과 알림

복제 지연은 운영 지표로 관리해야 합니다 지연이 임계치를 넘으면 Replica에서 읽어야 하는 쿼리를 일시적으로 Primary로 전환하거나, Replica를 읽기 대상에서 제외하는 판단이 필요합니다

| 지표 | 정상 | 경고 | 위험 |
|---|---|---|---|
| `replay_lag` | 1초 미만 | 5초 초과 | 30초 초과 |
| Write pool 사용률 | 60% 미만 | 80% 초과 | 95% 초과 |
| Read pool 사용률 | 70% 미만 | 85% 초과 | — |

`replay_lag > 30s` 상황은 Replica가 Primary를 따라가지 못한다는 신호입니다 이때 Replica에서 읽으면 실질적으로 낡은 데이터를 반환하므로, 해당 Replica를 읽기 대상에서 일시 제외하는 자동화가 권장됩니다

복제 지연이 길어지면 Primary의 복제 슬롯이 WAL을 계속 보관해 Primary 디스크 소진 위험이 있습니다 `max_slot_wal_keep_size` 파라미터로 상한을 설정해 방어합니다

```sql
ALTER SYSTEM SET max_slot_wal_keep_size = '5GB';
SELECT pg_reload_conf();
```

### eventual consistency — 어디서 수용 가능한가

복제 지연으로 인한 일관성 완화를 **eventual consistency**라고 부릅니다 "언젠가는 Primary와 같아진다"는 보장입니다 수초 이내에 수렴하므로 대부분의 읽기 전용 조회에서는 문제가 되지 않습니다

eventual consistency로 충분한 케이스와 불충분한 케이스를 구분하는 실무 기준은 다음과 같습니다

| 케이스 | eventual consistency | 이유 |
|---|---|---|
| 좌석 등급·가격 조회 | 수용 가능 | 수초 지연이 사용자에게 무영향 |
| 경기 일정 조회 | 수용 가능 | 변경 빈도 낮음 |
| 마이페이지 주문 내역 (과거) | 수용 가능 | 수초 지연이 UX에 무영향 |
| 방금 만든 주문 즉시 조회 | 수용 불가 | read-your-write 필요 |
| 좌석 HOLD (FOR UPDATE) | 수용 불가 | 동시성 제어 필요 |
| 결제 확정 후 상태 확인 | 수용 불가 | 정합성이 직결됨 |

---

## 🧩 go-ti에서는

go-ti에서 Read Replica 도입을 결정한 직접적인 계기는 3000 VU 부하테스트에서 확인된 연결 풀 경합이었습니다 6개 Go 서비스가 단일 RDS `goti-prod-postgres`(t3.large, max_connections=300)를 공유한 상태에서, ticketing·stadium 도메인의 읽기 쿼리가 Primary 연결을 잡아먹어 핵심 쓰기 트랜잭션이 타임아웃됐습니다

ADR에서 분석한 트래픽 패턴에서 좌석 등급·경기 일정·주문 내역 조회가 전체 SQL 호출의 약 75%를 차지했습니다 이 트래픽을 Replica로 분리하면 Primary 연결 사용량이 크게 줄 것으로 판단했습니다 실제로 ticketing 서비스의 writePool은 18개에서 6개로 축소하고, readPool을 18개로 따로 구성해 Primary 연결 경합을 완화했습니다

Go 코드에서는 `pkg/database/Pools` 구조체로 두 풀을 관리하고, Repository 메서드가 `database.Querier` 인터페이스를 파라미터로 받아 호출측(Service 레이어)이 Write/Read를 명시적으로 선택하는 컨벤션을 채택했습니다 SELECT FOR UPDATE·INSERT가 포함된 트랜잭션은 반드시 `pools.Write`, 참조성 조회는 `pools.Read`를 전달하도록 주석 태그를 달아 규칙을 코드에 기록했습니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [Read/Write DB 분리 — RDS Read Replica 도입 결정](/logs/goti-read-replica-split-adr)에 정리했습니다

---

## 📚 핵심 정리

- Read Replica는 Primary의 WAL을 비동기로 수신해 동일한 데이터를 유지하는 읽기 전용 인스턴스입니다 읽기 트래픽을 Replica로 분산하면 Primary 연결 경합을 줄이고 읽기 TPS를 수평으로 늘릴 수 있습니다
- 비동기 복제는 필연적으로 복제 지연(replication lag)을 만듭니다 정상 운영에서는 수십ms~수초 수준이지만, 부하가 몰리면 늘어납니다 `pg_stat_replication.replay_lag`으로 지속 모니터링해야 합니다
- 쓰기 직후 즉시 읽는 경우(read-your-write)는 Replica가 아닌 Primary에서 읽어야 합니다 복제가 반영되기 전에 Replica를 읽으면 방금 저장한 값이 보이지 않습니다
- 쿼리 라우팅 규칙이 핵심입니다 INSERT/UPDATE/DELETE, SELECT FOR UPDATE, 트랜잭션 내 SELECT는 반드시 Primary 풀로 보냅니다 참조성 조회·이력 조회·통계는 Replica 풀로 보낼 수 있습니다
- Replica를 한 대 더 추가하면 읽기 TPS가 선형으로 늘어납니다 수직 확장(인스턴스 업그레이드)과 달리 비용 효율적인 수평 확장 경로를 확보합니다
