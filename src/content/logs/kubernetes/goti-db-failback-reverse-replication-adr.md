---
title: "Failback을 위한 역방향 복제 — 원복하지 않고 그대로 운영하기 (ADR)"
excerpt: "AWS가 승격된 뒤 GCP가 복구되면 다시 원복할지, 역방향 복제로 그대로 둘지가 쟁점이었습니다. 두 번째 다운타임을 피하기 위해 역방향 유지를 공식 채택한 의사결정 기록입니다"
type: troubleshooting
category: kubernetes
tags:
  - go-ti
  - PostgreSQL
  - pglogical
  - Failback
  - Replication
  - ADR
series:
  name: "goti-multicloud-db"
  order: 4
date: "2026-04-18"
---

## 한 줄 요약

> GCP primary → AWS subscriber 구조에서 AWS가 승격된 뒤 GCP가 복구되면, 다시 GCP로 원복하지 않고 AWS를 publisher로 유지한 채 GCP를 subscriber로 역전환합니다. 두 번째 다운타임을 제거하기 위한 결정입니다

---

## 메타

- **상태**: Accepted
- **결정일**: 2026-04-18
- **관련 ADR**: `goti-multicloud-db-replication-technology-adr`, `goti-db-active-passive-read-split-adr`, `goti-multicloud-circuit-breaker-hpa-adr`
- **영향 레포**: Terraform, Kubernetes manifests, runbooks 저장소

---

## 배경

이전 ADR 두 건(복제 기술 선정, Active-Passive + Read Split 설계)을 통해 GCP primary → AWS subscriber의 비대칭 Active-Passive 구조가 확정되었습니다.
여기서 남아 있는 질문은 하나였습니다.

**"AWS로 승격된 이후 원래 GCP가 복구되면 어떻게 할 것인가?"**

즉 Failback 시나리오를 공식 문서로 정의해야 했습니다.

### 대칭성 관찰

ADR-0018/0019 설계는 다음 성질을 가집니다.

- GCP와 AWS 양쪽 모두 PostgreSQL 16 + pglogical 2.x
- 한쪽이 publisher, 반대쪽이 subscriber라는 점만 다르고 나머지는 대칭
- pglogical은 역방향 복제도 동일 방식으로 설정 가능 (`CREATE SUBSCRIPTION`을 반대쪽 VM에서 실행)

즉 "쓰기 위치"라는 상태 하나만 바꾸면 구조 자체는 뒤집을 수 있습니다.
이 대칭성이 본 ADR의 전제입니다.

### Failover/Failback 타임라인

| 시점 | 상태 |
|---|---|
| T0 (정상) | GCP publisher, AWS subscriber (read-only) |
| T1 (GCP 장애) | Cloudflare Worker가 AWS로 트래픽 전환. AWS는 아직 read-only → 쓰기 실패 중 |
| T2 (AWS 승격) | 운영자가 AWS PostgreSQL `default_transaction_read_only=off` → 쓰기 가능. GCP→AWS subscription은 중단 상태 |
| T3 (GCP 복구) | GCP primary 살아남. 데이터는 T1 시점 기준 stale |
| T4 (Failback 선택지) | **A안: 원복** — AWS 쓰기 중단 → GCP로 트래픽 되돌림 → AWS를 subscriber로 재구성 |
| | **B안: 역방향 유지** — AWS publisher, GCP를 subscriber로 재구성. 운영자 개입 최소화 |

표의 핵심은 T4 분기입니다.

T3 시점까지는 운영자가 선택할 여지가 없습니다.
장애가 발생했고, AWS가 승격했고, 그 사이 원래 primary였던 GCP가 다시 살아났을 뿐입니다.
이 상태에서 어디에 쓸 것인가를 결정하는 것이 T4이며, A안과 B안은 사용자 경험과 운영 부담에서 큰 차이를 만듭니다.

### 기존 문서의 방향성

`final-goal.md §7`에는 이미 다음과 같은 기술이 있었습니다.

> "AWS 복구 후 AWS RDS를 Cloud SQL의 Replica로 재구성(역방향 복제). 역할이 뒤바뀐 상태로 그대로 운영(불필요한 재전환 방지)"

실제로는 GCP/AWS의 역할을 다시 한 번 생각해보면 방향이 반대입니다.
AWS가 승격된 뒤 GCP가 복구되므로, **GCP를 AWS의 subscriber로 재구성**하는 것이 실제 흐름입니다.
어느 쪽이든 "불필요한 재전환 방지"라는 원칙은 동일하며, 본 ADR로 이 방향을 공식 채택합니다.

---

## 고려한 대안

| # | 대안 | 기각 사유 |
|---|---|---|
| A | 원복 (AWS 쓰기 중단 → GCP로 복귀) | **두 번째 다운타임 발생**. 장애 복구 직후 또 전환하면 사용자 경험이 악화됩니다. "GCP가 원래 primary"라는 관성만 유지할 뿐 실익이 없습니다. |
| B | **역방향 유지 (AWS publisher, GCP subscriber)** | 대칭 구조라 가능합니다. 두 번째 다운타임을 회피할 수 있고, 운영자 1회 개입으로 끝납니다. **채택**. |
| C | Active-Active (양쪽 모두 publisher, conflict resolution) | pglogical 양방향이 가능하지만 충돌 해결 규칙이 복잡합니다. 티켓팅 도메인 특성상 동시 쓰기 충돌은 곧 **중복 판매**를 의미합니다. 범위를 초과합니다. |

세 대안을 하나씩 풀어보겠습니다.

**A안(원복)**은 직관적입니다.
"원래 primary였던 GCP로 돌려놓자"라는 사고방식이며, 아키텍처 다이어그램이 T0 상태와 동일해진다는 심리적 만족감이 있습니다.
문제는 현실적인 비용입니다.
AWS 승격 직후 GCP가 복구됐다면, 사용자는 이미 한 번 장애를 겪은 직후입니다.
여기서 다시 쓰기 위치를 AWS→GCP로 옮기면, 같은 장애가 24시간 안에 두 번 발생한 것과 같은 체감이 됩니다.
원복의 유일한 근거가 "원래 그랬으니까"라면 그 근거는 약합니다.

**B안(역방향 유지)**은 pglogical의 대칭 구조 덕분에 성립합니다.
publisher/subscriber 역할만 뒤바꾸면 나머지 스키마·사용자·TLS 설정은 동일하게 재사용됩니다.
운영자가 한 번의 failback 절차를 수행한 뒤에는 AWS가 publisher, GCP가 subscriber로 그대로 돌아갑니다.
사용자 입장에서는 T2(AWS 승격) 이후 더 이상의 전환이 없습니다.

**C안(Active-Active)**은 pglogical이 지원하므로 기술적으로는 가능합니다.
다만 티켓팅 도메인에서 동시 쓰기를 허용하면 같은 좌석을 양쪽에서 팔 수 있고, 이것은 곧 중복 판매입니다.
충돌 해결(last-write-wins, custom handler)을 설계할 수도 있지만, "좌석은 단일 소유권을 가진다"라는 도메인 제약을 복제 레이어에서 풀어야 한다면 애초에 Active-Active가 잘못된 선택입니다.
1주 시연 범위에서는 명확히 범위 초과로 판단합니다.

---

## 결정

**B안 채택. Failback은 역방향 복제 재구성으로 정의합니다.**

### Failback 절차 (high-level)

```text
[T3] GCP 복구 (VM 재기동, PostgreSQL 서비스 up)
  │
  ├─▶ (1) GCP 쪽 subscription (죽어 있는 것) 정리
  │      SELECT pglogical.drop_subscription('sub_from_gcp');
  │
  ├─▶ (2) GCP primary를 subscriber로 역전환
  │      - replication_set 정리 (publisher 역할 해제)
  │      - AWS RDS를 provider로 등록
  │      - subscription 생성 (initial sync 또는 스냅샷 기반)
  │
  ├─▶ (3) GCP primary에 default_transaction_read_only=on
  │      - PgBouncer-RW는 AWS를 가리키도록 Helm values 변경
  │      - PgBouncer-RO는 양쪽 모두 활용
  │
  ├─▶ (4) pglogical 복제 ready 확인 (lag < 5s)
  │
  └─▶ (5) 트래픽 분배 조정 (Cloudflare Worker는 AWS 주도 유지)
```

절차의 핵심은 5단계입니다.

(1)에서 GCP가 publisher였을 때 생성했던 subscription 메타데이터를 정리합니다.
T1~T3 사이에 멈춘 상태로 남아 있는 슬롯을 방치하면 이후 역방향 subscription 생성 시 충돌합니다.

(2)는 역할 전환의 본체입니다.
GCP 쪽에서 publisher 구성(replication_set)을 해제하고, AWS를 provider로 등록해 subscription을 만듭니다.
데이터 동기화 방식은 두 가지입니다.
`copy_data=true`로 초기 sync를 pglogical이 수행하게 하거나, 스냅샷 기반 restore 후 `copy_data=false`로 증분만 따라붙게 할 수 있습니다.
운영자는 데이터 크기와 네트워크 egress 비용을 기준으로 runbook에서 선택합니다.

(3)은 앱이 실수로 GCP에 쓰지 못하도록 차단하는 안전장치입니다.
`default_transaction_read_only=on`은 PostgreSQL 레벨의 강제이므로, 앱이 잘못된 endpoint를 잡고 있어도 쓰기는 실패합니다.
PgBouncer-RW의 backend를 AWS로 바꾸는 Helm values 변경이 공식 경로이며, Pod rollout restart로 반영합니다.

(4)는 Failback 완료 판정 기준입니다.
lag < 5s는 단순한 숫자가 아니라, 이후 Failover가 발생해도 복구 가능한 범위라는 의미입니다.
더 자세한 SQL과 kubectl 절차는 `docs/runbooks/db-failover-failback.md`에 두고 ADR에는 개괄만 남깁니다.

### 결정 규칙 (불변)

1. **복구된 GCP를 자동 promote 금지** — primary 역할이 GCP로 돌아가는 유일한 경로는 "AWS 장애 발생 + 운영자 수동 failback"입니다. Cloudflare Worker의 health check만으로 트래픽을 되돌리지 않습니다.
2. **시퀀스 정합성 검증 필수** — T3 시점에 GCP는 T1 기준 stale 상태입니다. 역방향 subscription 전에 AWS의 sequence last value + 1000 margin으로 GCP sequence를 강제 조정합니다. runbook에 SQL을 명시합니다.
3. **앱 레벨 read-only 감지 없음** — 앱은 primary 변경을 자동으로 감지하지 않습니다. PgBouncer endpoint 교체 + Pod rollout restart가 공식 경로입니다.
4. **재전환 금지** — Failback 이후 또 AWS 장애가 발생하면 기준선은 T0가 아니라 T4입니다. "원래 GCP가 주인"이라는 가정을 코드나 문서 어디에도 두지 않습니다.

네 가지 규칙은 모두 "관성을 제거한다"는 하나의 원칙에서 나옵니다.

운영자가 가장 실수하기 쉬운 지점은 "원래 GCP가 primary였으니 거기로 돌려야 한다"라는 자동 반응입니다.
이 관성이 코드, runbook, 대시보드, 알람 어느 한 곳에라도 남아 있으면, T4 상태에서 누군가가 반사적으로 원복을 시도할 수 있습니다.
네 가지 불변 규칙은 그 반사를 차단하기 위한 장치입니다.

### 대칭 설계 불변식

| 항목 | GCP | AWS |
|---|---|---|
| 엔진 | PostgreSQL 16 + pglogical 2.x | PostgreSQL 16 + pglogical 2.x |
| 스키마 | 동일 | 동일 (DDL runbook으로 동기 유지) |
| 사용자 | `goti`, `goti_*_ro`, `pglogical_repl` | 동일 |
| TLS | sslmode=verify-full | sslmode=verify-full |
| read-only 기본값 | subscriber 역할일 때 on | subscriber 역할일 때 on |

표가 말하는 바는 단순합니다.

**역할(publisher/subscriber)과 read-only 플래그만 토글 가능한 구조**를 유지한다는 것입니다.
다른 모든 축(엔진 버전, 스키마, 사용자, TLS 모드)은 양쪽이 같아야 하며, 이 대칭이 한 번이라도 깨지면 Failback이 실패합니다.
따라서 한쪽에 마이너 버전 업그레이드나 확장 추가가 발생하면, 반드시 DDL runbook을 통해 반대쪽에도 반영해야 합니다.

---

## 결과

### 목표 지표

- Failback 완료까지 운영자 개입 시간 < 30분 (시연 기준)
- Failback 후 시퀀스 중복 발행 0건
- PgBouncer endpoint 교체 → 앱 Pod rollout restart → 정상 쓰기까지 < 5분

세 지표 모두 "자동화 없음"을 전제로 한 수동 작업 시간입니다.
30분 이내에 끝나야 한다는 것은 runbook이 그 시간 안에 완결될 수 있게 씌어 있어야 한다는 요구사항이기도 합니다.

### 비용

- 추가 인프라 없음. pglogical은 역방향 subscription을 동일 기반에서 지원합니다.
- Failback 중 GCP는 subscriber 역할이므로 디스크 사용량·VM 스펙이 동일합니다.

### 리스크

**운영자 수동 개입 전제 위험**
1주 시연 범위이므로 자동화는 구현하지 않았습니다.
장기 운영으로 재개될 경우에는 orchestrator(GCP Cloud Function + AWS Lambda 조합)를 도입하는 별도 ADR이 필요합니다.
지금 단계에서는 "runbook을 따라 손으로 실행한다"가 공식 경로입니다.

**Initial sync 재시작 비용**
Failback 시 AWS → GCP로 `copy_data=true`를 수행하면 WAL과 네트워크 egress가 폭증합니다.
이 비용을 피하기 위한 대안은 스냅샷 기반 restore 후 `copy_data=false` subscription을 만드는 방식입니다.
두 방식의 장단점을 runbook에 모두 기술하고, 데이터 크기에 따라 선택하게 했습니다.

**대칭성 붕괴 리스크**
한쪽 PostgreSQL 버전, 확장, 스키마가 drift되면 Failback이 실패합니다.
DDL runbook 준수를 강제하고 있으며, CI에 schema diff 검사를 도입하는 작업은 장기 과제로 남겨 두었습니다.
장기 운영 단계에서는 이 자동 검사가 없으면 drift를 실시간으로 잡을 방법이 없습니다.

### Reversibility

- Failback 자체가 "되돌리지 않는다"는 결정이므로 ADR 수정 없이는 A안(원복)으로 전환할 수 없습니다.
- 예외: 시연 중 문제 발생 시 수동으로 Cloudflare Worker를 GCP로 돌려도 DB 쓰기는 AWS로 향합니다. 이 상태에서는 일관성이 깨집니다. 이런 비정상 상태를 방지하기 위해 **"트래픽 라우팅 ≠ DB 쓰기 위치"**를 분리해서 다룹니다.

마지막 예외 항목은 운영 중 가장 위험한 시나리오입니다.
Cloudflare Worker의 라우팅과 DB primary의 위치가 일치해야 한다고 생각하기 쉽지만, 실제로는 각자 독립적으로 관리됩니다.
Worker를 GCP로 되돌려도 DB 쓰기는 AWS로 가야 하며, 이 분리 원칙을 지키지 않으면 GCP의 read-only PostgreSQL에 쓰기가 시도되어 5xx가 발생합니다.

---

## 후속 작업

1. `docs/runbooks/db-failover-failback.md` 작성 (Phase B 브랜치에 포함)
2. Terraform parameter에 `aws_rds_default_read_only` 플래그 추가 (Phase B)
3. PgBouncer Helm values에 `database.url_rw_override` 파라미터 추가 (Failover 시 수동 교체용)
4. 시연 시나리오 문서: `docs/load-test/YYYY-MM-DD-multicloud-failover-demo.md` (시연 후 결과 기록)

---

## 진행 상태 (2026-04-18 기준)

- **설계 완료, 실행 미수행.** 본 ADR은 Failback 전략 문서로만 존재합니다.
- Runbook `docs/runbooks/db-failover-failback.md`는 작성 완료 (Step 1~7 + 위험 패턴 표).
- 실제 Failover/Failback 훈련 조건은 다음과 같습니다.
  1. Phase B orders/payments 정합성 복구 완료 후
  2. `pglogical_repl` password rotation 후
  3. AWS EKS 재기동 후 (현재 ASG 0)
  4. 양쪽 replication lag < 5s 확인 후
- 1주 시연(2026-04-24 종료) 내 실 Failover 훈련 여부는 Phase B orders/payments 복구 소요 시간에 따라 결정합니다.

---

## 📚 배운 점

- **"원래대로 돌려놓기"는 가장 비싼 기본값입니다.** 두 번째 다운타임을 감수할 이유가 있을 때만 원복을 선택합니다.
- **대칭 설계는 Failback의 전제입니다.** publisher/subscriber만 토글 가능한 구조가 아니라면 역방향 복제는 성립하지 않습니다.
- **관성은 코드가 아니라 사람에게 있습니다.** "원래 GCP가 primary"라는 자동 반응을 차단하는 불변 규칙이 없으면 운영자가 반사적으로 원복을 시도합니다.
- **트래픽 라우팅과 DB 쓰기 위치는 분리해서 관리합니다.** Cloudflare Worker를 돌려도 PgBouncer endpoint는 따라 움직이지 않습니다.
- **자동 promote는 금지해도 괜찮습니다.** 수동 개입 30분과 자동화 구현·검증 비용을 비교하면, 1주 시연 범위에서는 수동이 훨씬 싼 선택입니다.
