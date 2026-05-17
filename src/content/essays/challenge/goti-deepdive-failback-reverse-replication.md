---
title: "Failback — 역방향 복제로 원복하지 않는 전략"
excerpt: "Failover 후 원래 노드로 되돌아가지 않고 복제 방향만 뒤집어 대칭 구조를 유지하는 방법, 그리고 이것이 가능한 근본 이유를 설명합니다"
category: challenge
tags:
  - go-ti
  - failback
  - failover
  - pglogical
  - reverse-replication
  - PostgreSQL
  - concept
series:
  name: "goti-deepdive-database"
  order: 8
date: "2026-04-18"
---

## 한 줄 요약

> Failback은 "원래 노드로 복귀"가 아니라 "복제 방향을 뒤집는 것"입니다 대칭 설계에서 역할과 read-only 플래그만 토글하면 인프라를 그대로 둔 채 쓰기 위치를 전환할 수 있습니다

---

## 🤔 무엇을 푸는 기술인가

Active-Passive 복제에서 Active 노드 장애가 발생하면 Passive를 Active로 승격하는 **Failover** 가 일어납니다 서비스는 복구되지만, 시간이 지나 구 Active가 살아나면 새로운 질문이 생깁니다

> 원래 노드로 되돌아가야 하는가?

이를 **Failback** 이라고 부릅니다 가장 직관적인 답은 "원복"입니다 즉, 지금의 Active(구 Passive)를 다시 Passive로 내리고, 복구된 구 Active를 다시 Active로 올리는 것입니다 그런데 이 직관에는 숨겨진 비용이 있습니다 — **두 번째 다운타임**입니다

Failback이 해결해야 하는 문제는 따라서 두 가지입니다

- 장애 복구 후 **두 번째 서비스 중단 없이** 안정 상태로 진입하기
- "원래 Primary가 어느 쪽" 이라는 **고정 역할 가정**을 코드와 운영에서 제거하기

역방향 복제 전략은 이 두 가지를 동시에 해결합니다 원복 대신 복제 방향을 뒤집어, 구 Active를 새로운 Passive(subscriber)로 바로 편입시킵니다

---

## 🔧 동작 원리

### T0~T4 상태 전이

Failover와 Failback을 다섯 단계로 분해하면 각 단계에서 무엇이 바뀌는지가 명확해집니다

![Failover / Failback 상태 전이 T0~T4|tall](/diagrams/goti-deepdive-failback-reverse-replication-1.svg)

**T0 — 정상 상태**: GCP pg-primary가 publisher(쓰기), AWS RDS가 subscriber(읽기 전용)입니다 복제 스트림은 GCP → AWS 단방향으로 흐릅니다

**T1 — GCP 장애**: GCP 응답이 없어지고 복제 스트림이 단절됩니다 Cloudflare Worker가 health check 실패를 감지하고 트래픽을 AWS로 전환합니다 그런데 AWS RDS는 아직 `read_only = on` 상태입니다 이 시점에 AWS 쪽에 쓰기가 도달하면 오류가 납니다

**T2 — AWS 승격**: 운영자가 AWS RDS의 `default_transaction_read_only` 파라미터를 `off`로 전환합니다 AWS가 쓰기를 받을 수 있게 됩니다 GCP→AWS subscription은 이미 중단 상태이므로 AWS는 독립적으로 동작합니다 이 시점부터 AWS가 사실상 새로운 publisher입니다

**T3 — GCP 복구**: GCP VM이 재기동되고 PostgreSQL 서비스가 올라옵니다 그러나 데이터는 T1 기준 **stale** 상태입니다 T1 이후 AWS에서 발생한 쓰기가 GCP에 없습니다 이 상태에서 GCP를 다시 Active로 올리려면 또 다운타임이 필요합니다 — 이것이 원복 전략의 핵심 문제입니다

**T4 — 역방향 복제**: 원복하지 않습니다 대신 GCP를 **AWS의 subscriber**로 재구성합니다 AWS에서 CREATE SUBSCRIPTION을 통해 GCP로 복제 스트림을 보냅니다 GCP는 stale 데이터를 initial sync 또는 스냅샷으로 따라잡고 `read_only = on`을 유지합니다 두 번째 다운타임 없이 대칭 구조가 복원됩니다

### 역방향 복제 재구성 절차

T3에서 T4로 넘어가는 핵심 조작은 세 단계입니다

첫째, GCP 쪽에서 기존 구독(죽어 있는 것)을 정리합니다

```sql
-- GCP에서 실행: 구 subscription 제거
SELECT pglogical.drop_subscription('sub_from_gcp');
```

둘째, GCP를 publisher 역할에서 해제하고, AWS를 provider로 등록한 뒤 subscription을 생성합니다

```sql
-- GCP에서 실행: AWS RDS를 provider로 등록
SELECT pglogical.create_node(
  node_name := 'gcp_subscriber',
  dsn := 'host=<gcp_host> port=5432 dbname=gotidb'
);

SELECT pglogical.create_subscription(
  subscription_name := 'sub_from_aws',
  provider_dsn := 'host=<aws_rds_endpoint> port=5432 dbname=gotidb
                   user=pglogical_repl sslmode=verify-full',
  replication_sets := ARRAY['default'],
  synchronize_data := true   -- initial sync: T1 이후 누락분 동기화
);
```

셋째, GCP에 `read_only = on`을 적용하고, PgBouncer-RW가 AWS를 가리키도록 Helm values를 교체합니다

```yaml
# PgBouncer Helm values 변경
database:
  url_rw: "postgres://goti:<pw>@<aws_rds_endpoint>:5432/gotidb"
  url_ro: "postgres://goti_ro:<pw>@<gcp_host>:5432/gotidb"
```

이후 앱 Pod를 rollout restart하면 새 엔드포인트가 반영됩니다

### 대칭 설계가 역방향 복제를 가능하게 하는 이유

역방향 복제가 가능한 것은 구조 자체가 대칭이기 때문입니다 아래 비교를 보면 T0 정상과 T4 역방향 복제의 차이가 얼마나 작은지 확인할 수 있습니다

![T0 정상 vs T4 역방향 복제 대칭 구조 비교|tall](/diagrams/goti-deepdive-failback-reverse-replication-2.svg)

왼쪽 T0 상태에서는 GCP가 publisher이고 AWS가 subscriber입니다 PgBouncer-RW는 GCP primary를 향합니다 오른쪽 T4 상태에서는 AWS가 publisher이고 GCP가 subscriber입니다 PgBouncer-RW는 AWS RDS를 향합니다

두 상태를 비교하면 변하는 것과 변하지 않는 것이 명확히 나뉩니다

**바뀌는 것(토글)**:
- publisher / subscriber 역할 배정
- `default_transaction_read_only` 플래그 (on ↔ off)
- PgBouncer-RW가 가리키는 엔드포인트

**바뀌지 않는 것(인프라 그대로)**:
- PostgreSQL 16 + pglogical 2.x 엔진(양쪽 동일)
- 스키마, 사용자 계정, TLS 설정
- GCE VM과 AWS RDS 인스턴스 자체

pglogical은 `CREATE SUBSCRIPTION` 명령을 publisher가 아닌 **subscriber 쪽에서** 실행합니다 즉, 어느 노드든 상대방을 provider로 등록하면 그쪽으로부터 복제를 받을 수 있습니다 T0에서는 AWS가 GCP를 provider로 등록했고, T4에서는 GCP가 AWS를 provider로 등록합니다 pglogical의 이 비대칭 구독 모델이 역방향 전환을 가능하게 합니다

### stale 데이터 동기화

T3에서 GCP가 복구되면 T1 이후의 쓰기가 없는 stale 상태입니다 역방향 subscription을 생성할 때 이 누락분을 어떻게 따라잡느냐가 운영 선택지입니다

**initial sync (`synchronize_data = true`)**: subscription 생성 시 publisher(AWS)의 현재 스냅샷을 subscriber(GCP)에 복사합니다 데이터 완결성이 보장되지만, 테이블 크기에 따라 WAL 및 네트워크 egress가 폭증할 수 있습니다

**스냅샷 restore 후 `synchronize_data = false`**: AWS RDS 스냅샷을 GCP에 restore하여 베이스라인을 맞추고, 이후 증분 복제만 subscription으로 받습니다 egress가 적지만 스냅샷 restore 절차가 추가됩니다

두 방식 모두 subscription이 stable 상태가 되기 전에 **sequence 값 조정**이 필요합니다 T1 이후 AWS에서 발행한 ID가 GCP의 sequence current_value보다 클 수 있으므로, AWS의 `sequence last value + 1000 margin`으로 GCP sequence를 강제 조정합니다

```sql
-- GCP에서 실행: sequence 강제 조정 예시
SELECT setval('tickets_id_seq',
  (SELECT last_value FROM aws_sequence_snapshot) + 1000);
```

이 단계를 건너뛰면 GCP가 다시 publisher가 될 경우 중복 ID 발행 위험이 있습니다

### 트래픽 라우팅 ≠ DB 쓰기 위치

한 가지 중요한 구분이 있습니다 Cloudflare Worker가 트래픽을 AWS로 보내도, **DB 쓰기는 반드시 현재 publisher(=read_only=off인 노드)로 가야** 합니다 이 두 가지는 독립적으로 제어됩니다

가령 T1 직후 Cloudflare가 트래픽을 AWS로 전환했지만, AWS RDS가 아직 `read_only = on` 상태라면 쓰기가 실패합니다 — 트래픽은 AWS에 도달했지만 DB 쓰기 위치는 아직 GCP입니다 이 불일치 구간이 T1→T2 사이의 위험 구간이며, 운영 runbook이 반드시 이 순서를 명시해야 합니다

반대로 T4 이후 GCP가 복구됐다고 해서 Cloudflare가 자동으로 GCP로 트래픽을 복귀시켜서는 안 됩니다 GCP는 subscriber이므로 쓰기를 받을 수 없습니다 **트래픽 라우팅 결정은 health check 자동화가 아닌 운영자의 명시적 판단**에 따릅니다

---

## 📐 세부 동작과 옵션

### 원복 vs 역방향 유지 비교

| 항목 | A안 — 원복 | B안 — 역방향 유지 |
|---|---|---|
| 두 번째 다운타임 | 발생 (다시 전환 필요) | 없음 |
| 운영 개입 횟수 | 2회 (Failover + Failback) | 1회 (Failover만) |
| "원래 Primary" 가정 | 코드·문서에 고정됨 | 제거됨 |
| 구성 변경 범위 | subscription 양쪽 재조립 | 한쪽만 재조립 |
| 다음 Failover 기준 | T0 (GCP가 원래 주인) | T4 현재 상태 기준 |

원복은 "GCP가 원래 Primary"라는 관성에서 비롯됩니다 하지만 대칭 설계에서 이 관성은 이점이 없습니다 오히려 다음 장애가 발생했을 때 "지금 Primary가 어느 쪽인지"를 코드와 문서에서 추적해야 하는 복잡도로 이어집니다

역방향 유지는 현재 상태를 정답으로 삼고 다음 Failover도 그 기준에서 시작합니다 다시 AWS에 장애가 나면 T4 상태 기준으로 Failover를 수행합니다 — T0로 돌아가는 것이 아닙니다

### 재전환 금지 원칙

Failback 이후 GCP가 복구됐다는 사실만으로 Cloudflare Worker가 트래픽을 GCP로 되돌려서는 안 됩니다 이를 **재전환 금지** 원칙이라고 합니다

이유는 단순합니다 T4에서 GCP는 subscriber이므로 쓰기를 받을 수 없습니다 Cloudflare가 임의로 GCP로 트래픽을 복귀시키면 쓰기 실패가 발생합니다 앱이 Primary 변경을 자동 감지하지 않으므로, **PgBouncer endpoint 교체 + pod rollout restart**가 공식 전환 경로입니다 health check 자동화와 DB 쓰기 위치는 항상 동기화된 상태에서만 Cloudflare 라우팅을 변경해야 합니다

### 대칭성 붕괴 리스크

역방향 복제가 작동하려면 양쪽 노드의 **스키마·PG 버전·pglogical 버전이 동일**해야 합니다 한쪽에서만 DDL 변경이 적용됐거나, 버전 drift가 발생했다면 subscription이 실패하거나 데이터 불일치가 생깁니다

이 상태를 **대칭성 붕괴**라고 합니다 방지하려면 DDL 변경을 양쪽에 동시 적용하는 runbook이 필요하며, 장기적으로는 CI에 schema diff 검사를 추가하는 것이 권장됩니다

---

## 🧩 go-ti에서는

go-ti는 ADR-0018/0019에서 GCP(publisher) → AWS(subscriber) Active-Passive 구조를 확정했습니다 이 구조의 설계 원칙 중 하나가 **양쪽 모두 PostgreSQL 16 + pglogical 2.x, 동일 스키마, 동일 사용자 계정**이었습니다 역방향 복제는 이 대칭성의 직접적 결과물입니다

ADR-0020에서는 B안(역방향 유지)을 공식 채택했습니다 설계 완료 시점 기준으로 실제 Failover/Failback 훈련은 미수행 상태이며, AWS EKS 재기동 이후 양쪽 replication lag < 5s 조건이 충족되면 시연 범위에서 검증할 계획입니다 시퀀스 중복 발행 0건, Failback 완료 운영자 개입 시간 30분 미만이 목표 지표입니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [DB Failback 전략 — 역방향 유지 결정](/logs/goti-db-failback-reverse-replication-adr)에 정리했습니다

---

## 📚 핵심 정리

- Failback은 원복이 아닌 역방향 복제 재구성입니다 구 Active를 새로운 subscriber로 편입하면 두 번째 다운타임 없이 안정 상태로 진입합니다
- 역방향 복제가 가능한 이유는 대칭 설계입니다 양쪽에 동일한 PG 버전·pglogical·스키마를 유지하면 publisher/subscriber 역할과 read_only 플래그만 토글해 방향을 바꿀 수 있습니다
- pglogical subscription은 subscriber 쪽에서 생성합니다 어느 노드든 상대방을 provider로 등록하면 그 방향으로 복제를 받을 수 있으므로, 역방향 전환이 추가 인프라 없이 가능합니다
- stale 동기화는 initial sync와 스냅샷 restore 두 가지 방식이 있습니다 어느 방식이든 sequence 값 조정을 선행해야 중복 ID 발행을 막을 수 있습니다
- 트래픽 라우팅과 DB 쓰기 위치는 독립적으로 제어합니다 health check 자동화가 DB publisher 전환을 대체할 수 없으며, endpoint 교체는 운영자 명시적 판단과 pod rollout restart가 공식 경로입니다
