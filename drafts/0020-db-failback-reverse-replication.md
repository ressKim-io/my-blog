# ADR 0020 — DB Failback 전략: 역방향 유지 (원복하지 않음)

- 상태: Accepted
- 결정일: 2026-04-18
- 관련 ADR: `0018-multicloud-db-replication-technology.md`, `0019-db-active-passive-with-read-split.md`, `0016-multicloud-circuit-breaker-and-hpa.md`
- 영향 레포: Goti-Terraform, Goti-k8s, goti-team-controller (runbooks)

## 컨텍스트

ADR-0018/0019 로 GCP primary → AWS subscriber 의 비대칭 Active-Passive 구조가 확정됐다. 여기서 "AWS 장애 발생 후 승격 → 이후 원래 GCP 가 복구되면 어떻게 할 것인가" 즉 **Failback 시나리오** 를 정의해야 한다.

### 대칭성 관찰

ADR-0018/0019 설계는 아래 성질을 가진다:

- GCP/AWS 양쪽 모두 PostgreSQL 16 + pglogical 2.x
- 한 쪽이 publisher, 반대 쪽이 subscriber 라는 점만 다르고 나머지는 대칭
- pglogical 은 역방향 복제도 동일 방식으로 설정 가능 (`CREATE SUBSCRIPTION` 을 반대 쪽 VM 에서 실행)

즉 "쓰기 위치" 라는 상태만 바꾸면 구조 자체는 뒤집을 수 있다.

### Failover/Failback 현실

| 시점 | 상태 |
|---|---|
| T0 (정상) | GCP publisher, AWS subscriber (read-only) |
| T1 (GCP 장애) | Cloudflare Worker 가 AWS 로 트래픽 전환. AWS 는 아직 read-only → 쓰기 실패 중 |
| T2 (AWS 승격) | 운영자가 AWS RDS `default_transaction_read_only=off` → 쓰기 가능. GCP→AWS subscription 은 중단 상태 |
| T3 (GCP 복구) | GCP primary 살아남. 데이터는 T1 시점 기준 stale |
| T4 (Failback 선택지) | **A안: 원복** — AWS 쓰기 중단 → GCP 로 트래픽 되돌림 → AWS 를 subscriber 로 재구성 |
| | **B안: 역방향 유지** — AWS publisher, GCP 를 subscriber 로 재구성. 운영자 개입 최소화 |

### 기존 문서 (final-goal.md §7)

> "[AWS 복구 후] AWS RDS 를 Cloud SQL 의 Replica 로 재구성 (역방향 복제). 역할이 뒤바뀐 상태로 그대로 운영 (불필요한 재전환 방지)"

이미 `B안` 방향이 암묵적으로 표기됨. 본 ADR 로 **공식 채택**.

## 고려한 대안

| # | 대안 | 기각 사유 |
|---|---|---|
| A | 원복 (AWS 쓰기 중단 → GCP 로 복귀) | **두 번째 다운타임 발생**. 장애 복구 직후 또 전환하면 사용자 경험 악화. "GCP 가 원래 primary" 라는 관성만 유지할 뿐 실익 없음. |
| B | **역방향 유지 (AWS publisher, GCP subscriber)** | 대칭 구조라 가능. 두 번째 다운타임 회피. 운영자 1회 개입으로 끝. **채택**. |
| C | Active-Active (양쪽 모두 publisher, conflict resolution) | pglogical 양방향 가능하나 충돌 해결 규칙 복잡. 티켓팅 도메인 특성상 동시 쓰기 충돌 = 중복 판매. 범위 초과. |

## 결정

**B안 채택. Failback = 역방향 복제 재구성.**

### Failback 절차 (high-level)

```
[T3] GCP 복구 (VM 재기동, PG 서비스 up)
  │
  ├─▶ (1) GCP 쪽 subscription (죽어 있는 것) 정리
  │      SELECT pglogical.drop_subscription('sub_from_gcp');
  │
  ├─▶ (2) GCP primary 를 subscriber 로 역전환
  │      - replication_set 정리 (publisher 역할 해제)
  │      - AWS RDS 를 provider 로 등록
  │      - subscription 생성 (initial sync OR 스냅샷 기반)
  │
  ├─▶ (3) GCP primary 에 default_transaction_read_only=on
  │      - PgBouncer-RW 는 AWS 를 가리키도록 Helm values 변경
  │      - PgBouncer-RO 는 양쪽 모두 활용
  │
  ├─▶ (4) pglogical 복제 ready 확인 (lag < 5s)
  │
  └─▶ (5) 트래픽 분배 조정 (Cloudflare Worker 는 AWS 주도 유지)
```

상세 SQL / kubectl 절차는 `docs/runbooks/db-failover-failback.md` (Phase B 에서 작성).

### 결정 규칙 (불변)

1. **복구된 GCP 를 자동 promote 금지** — primary 역할이 GCP 로 돌아가는 유일한 경로는 "AWS 장애 발생 + 운영자 수동 failback". Cloudflare Worker 의 health check 만으로 트래픽을 되돌리지 않는다.
2. **시퀀스 정합성 검증 필수** — T3 시점에 GCP 는 T1 기준 stale. 역방향 subscription 전에 AWS 의 sequence last value + 1000 margin 으로 GCP sequence 를 강제 조정. runbook 에 SQL 명시.
3. **앱 레벨 read-only 감지** — 앱이 primary 변경을 자동 감지하지 않음. PgBouncer endpoint 교체 + pod rollout restart 가 공식 경로.
4. **재전환 금지** — Failback 후 또 AWS 장애가 나면 T0 상태가 아닌 T4 상태 기준으로 failover. "원래 GCP 가 주인" 이라는 가정을 코드·문서 어디에도 두지 않는다.

### 대칭 설계 불변식

| 항목 | GCP | AWS |
|---|---|---|
| 엔진 | PostgreSQL 16 + pglogical 2.x | PostgreSQL 16 + pglogical 2.x |
| 스키마 | 동일 | 동일 (DDL runbook 으로 동기 유지) |
| 사용자 | `goti`, `goti_*_ro`, `pglogical_repl` | 동일 |
| TLS | sslmode=verify-full | sslmode=verify-full |
| read-only 기본값 | subscriber 역할일 때 on | subscriber 역할일 때 on |

즉 **역할(publisher/subscriber) 과 read-only 플래그만 토글** 가능한 구조.

## 결과

### 목표 지표

- Failback 완료까지 운영자 개입 시간 < 30분 (시연 기준)
- Failback 후 시퀀스 중복 발행 0 건
- PgBouncer endpoint 교체 → 앱 pod rollout restart → 정상 쓰기까지 < 5분

### 비용

- 추가 인프라 없음. pglogical 은 역방향 subscription 을 동일 기반에서 지원.
- Failback 중 GCP 는 subscriber 역할이므로 디스크 사용량·VM 스펙 동일.

### 리스크

- **운영자 수동 개입 전제 위험** — 1주 시연 범위라 자동화 미구현. 장기 운영 재개 시 orchestrator (자체 Cloud Function + AWS Lambda) 도입 ADR 별도.
- **Initial sync 재시작 비용** — Failback 시 AWS → GCP 로 `copy_data=true` 수행하면 WAL/네트워크 egress 폭증. 대안: 스냅샷 기반 restore 후 `copy_data=false` subscription. runbook 에 양 방식 모두 기술.
- **대칭성 붕괴 리스크** — 한쪽 PG 버전/확장/스키마가 drift 되면 Failback 실패. DDL runbook 준수 강제. CI 에 schema diff 검사 도입은 장기 과제.

### Reversibility

- Failback 자체가 "되돌리지 않는다" 는 결정이므로 ADR 수정 없이는 A안(원복)으로 전환 불가.
- 예외: 시연 중 문제 발생 시 수동으로 Cloudflare Worker 를 GCP 로 돌려도 DB 쓰기는 AWS 로 향함 → 일관성 깨짐. 이런 비정상 상태 방지를 위해 "트래픽 라우팅 ≠ DB 쓰기 위치" 를 분리해 다룸.

## 후속

1. `docs/runbooks/db-failover-failback.md` 작성 (Phase B 브랜치에 포함)
2. Terraform parameter 에 `aws_rds_default_read_only` 플래그 추가 (Phase B)
3. PgBouncer Helm values 에 `database.url_rw_override` 파라미터 추가 (Failover 시 수동 교체용)
4. 시연 시나리오 문서: `docs/load-test/YYYY-MM-DD-multicloud-failover-demo.md` (시연 후 결과 기록)

## 진행 상태 (2026-04-18)

- **설계 완료, 실행 미수행.** 본 ADR 은 Failback 전략 문서로만 존재.
- Runbook `docs/runbooks/db-failover-failback.md` 작성 완료 (Step 1~7 + 위험 패턴 표)
- 실제 Failover/Failback 훈련 조건:
  1. Phase B orders/payments 정합성 복구 완료 후
  2. `pglogical_repl` password rotation 후
  3. AWS EKS 재기동 후 (현재 ASG 0)
  4. 양쪽 replication lag < 5s 확인 후
- 1주 시연 (2026-04-24 종료) 내 실 Failover 훈련 여부는 Phase B orders/payments 복구 소요 시간에 따라 결정
