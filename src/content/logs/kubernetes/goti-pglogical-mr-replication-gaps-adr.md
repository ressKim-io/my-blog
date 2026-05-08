---
title: "pglogical Multi-Region 복제의 알려진 한계 — 리스크 레지스터로 남기기"
excerpt: "1주 시연 범위를 전제로 채택한 GCE VM + pglogical 2.4.6 구성의 한계를 카테고리별로 명시적으로 기록했습니다. HA·백업·Split-brain·관측 공백을 Tier 1~3 로드맵으로 분류해 런칭 전 필수 과제와 의도적 미도입 항목을 구분했습니다"
category: kubernetes
tags:
  - go-ti
  - PostgreSQL
  - pglogical
  - Multi-Region
  - Replication
  - ADR
series:
  name: "goti-multicloud-db"
  order: 5
date: "2026-04-19"
---

## 한 줄 요약

> GCE VM 위에 pglogical 2.4.6으로 구성한 Multi-Cloud 복제는 HA, PITR, Split-brain 탐지가 모두 빠져 있습니다. 이 ADR은 "알고 있으나 의도적으로 미도입"과 "모르고 놓친 것"을 구분하기 위한 리스크 레지스터입니다

---

## 배경

ADR-0018에서 **1주 시연 범위**(종료 예정 2026-04-24)를 전제로 GCE VM + pglogical 2.4.6 기반 멀티클라우드 복제를 채택했습니다.
이 결정은 다음 tradeoff를 수용한 선택입니다.

- HA(Patroni/etcd) 생략
- Cloud VPN HA 구축 생략 → Public IP + IP allowlist + TLS(self-signed)
- plaintext password 기반 DSN(IAM/cert 인증 미도입)

이 ADR은 해당 결정의 **알려진 한계**를 명시적으로 기록합니다. 목적은 세 가지입니다.

1. 멘토 심사 또는 프로덕션 런칭 전 점검 시 질문 범위를 예측 가능하게 만들기
2. 시연 종료 후 장기 운영으로 복귀할 때 우선순위 로드맵으로 활용하기
3. "알고 있으나 시간·비용 절충으로 의도적으로 생략한 것"과 "모르고 놓친 것"을 구분하기

관련 ADR: ADR-0018(기술 선정), ADR-0019(Active-Passive + Read Split), ADR-0020(역방향 복제 Failback).

---

## 상태 및 결정 정보

- **상태**: Accepted (as risk register)
- **결정일**: 2026-04-19
- **영향 레포**: Goti-Terraform, Goti-k8s, goti-team-controller

이 ADR은 보통의 "기술 채택" 결정이 아니라 **리스크 레지스터**로 Accept했습니다. 새 구성을 도입하자는 결정이 아니라, 현재 구성이 어디가 얇고 어떤 위험을 안고 있는지 팀이 같은 언어로 이해하도록 만드는 문서입니다.

---

## 심사자가 물을 가능성이 높은 질문

카테고리별로 예상 질문과 현 상태를 정리했습니다.
위험도는 🔴(상) / 🟠(중) / 🟡(하)로 표시합니다.

### A. 보안 — Transport / Auth / Network

| # | 질문 | 현 상태 | 위험도 |
|---|------|---------|-------|
| A1 | TLS가 self-signed인데 MITM 방어는? | `sslmode=require`만 적용. CA 검증 없음 | 🟠 중 |
| A2 | Subscription DSN에 plaintext password가 있다. 유출되면? | 2026-04-18 Phase B Job 에러 로그에 실제 노출 이력 있음. 이후 rotation 완료 | 🟠 중 |
| A3 | Public IP + `/32` allowlist만 의존한다. AWS NAT IP가 바뀌면? | NAT gateway 재생성 시 IP 변경 → allowlist 수동 업데이트 필요. 자동화 없음 | 🟡 하 |
| A4 | `pglogical_repl` 계정의 `pg_read_all_data` 권한이 너무 넓다 | 모든 테이블 SELECT. replication에 필요한 최소 권한을 넘어섬 | 🟡 하 |
| A5 | Subscription 자체 암호화(at rest)는? | PostgreSQL 자체 at-rest 암호화 없음. GCP 디스크 레벨 암호화만 의존 | 🟡 하 |
| A6 | AWS 쪽 `default_transaction_read_only=on`을 세션 레벨에서 우회 가능한데 | `SET LOCAL default_transaction_read_only=off`로 우회 가능. app 수준 role 차단 없음 | 🟠 중 |

보안 카테고리는 전송 계층, 인증, 네트워크 격리 세 축으로 나뉩니다.

가장 먼저 드러나는 취약점은 **A1 + A2 조합**입니다.
TLS는 걸려 있지만 self-signed 인증서를 검증 없이 신뢰하는 방식이고, DSN에는 plaintext password가 들어갑니다.
두 조건이 동시에 걸리면 중간자 공격자가 인증서를 바꿔치기하여 자격증명을 탈취할 수 있습니다.
실제로 2026-04-18 Phase B Job 에러 로그에 password가 노출된 이력이 있어 rotation을 수행했지만, 근본 해결은 IAM 또는 cert 기반 인증으로의 전환입니다.

**A6**은 논리적 방어의 얇음을 드러냅니다.
AWS 쪽 RDS에 `default_transaction_read_only=on`을 걸어 write를 막고 있지만, 세션에서 `SET LOCAL`로 우회할 수 있습니다.
app 수준에서 role을 분리해 write 권한 자체를 주지 않는 방식이 정석입니다.

### B. 신뢰성 / HA

| # | 질문 | 현 상태 | 위험도 |
|---|------|---------|-------|
| B1 | VM 단일 장애 시 쓰기 중단 시간은? | Patroni 없음. 수동 복구 RTO 30분+ | 🔴 상 |
| B2 | 백업은? PITR 가능한가? | `gcloud compute disks snapshot` 수동. 자동 스케줄 없음. WAL archive 없음 | 🔴 상 |
| B3 | Replication lag 모니터링/알림은? | postgres_exporter는 있지만 `pg_replication_slots` metric 알림 미설정 | 🟠 중 |
| B4 | AWS RDS failover 시 subscription 재연결 자동? | pglogical 자체 reconnect는 있음. 그러나 `default_transaction_read_only=on`을 off로 바꾸는 절차 수동 | 🟠 중 |
| B5 | Initial sync 중 publisher CPU / WAL 폭발 검증? | 실 데이터 약 5GB 수준이라 이론상 여유. **부하 테스트로 검증 안 됨** | 🟡 하 |
| B6 | pglogical 2.4.6 커뮤니티 활성도? EOL? | 2ndQuadrant 인수 후 PostgreSQL 커뮤니티 이관. 공식 LTS 없음. 버그 fix 의존 불명 | 🟠 중 |

신뢰성 영역에 🔴(상)이 두 건 몰려 있습니다.

**B1의 수동 복구 RTO 30분+**는 VM 한 대가 내려앉으면 쓰기가 30분 이상 중단된다는 뜻입니다.
Patroni/etcd 기반 자동 failover가 없고, 백업 VM도 없습니다.
Multi-Cloud 설계에서 역방향 failback(ADR-0020)으로 대응 가능한 시나리오이지만, 그 절차 자체가 수 분 이상 걸리는 수동 작업입니다.

**B2의 백업 공백**은 더 심각합니다.
현재는 `gcloud compute disks snapshot`을 수동으로 찍는 방식이고 자동 스케줄이 없습니다.
WAL archive도 구성되어 있지 않아 PITR(Point-In-Time Recovery)이 불가능합니다.
데이터 손실 발생 시 복구 지점은 마지막 수동 스냅샷 시점입니다.

### C. 데이터 정합성 / Failover

| # | 질문 | 현 상태 | 위험도 |
|---|------|---------|-------|
| C1 | Failover 후 시퀀스 드리프트 방지는? | runbook에 "+1000 margin"으로 기재. 자동 보정 스크립트 있음 | 🟢 완화 |
| C2 | Split-brain 탐지 및 복구? | 없음. 양쪽 쓰기 가능 상태 방지를 `default_transaction_read_only`에만 의존 | 🔴 상 |
| C3 | orders/payments PK 충돌 skip된 11,859/11,440 row 복구는? | AWS 쪽 잔재 삭제 후 `alter_subscription_resynchronize_table` 예정. 미수행 | 🟠 중 |
| C4 | DDL 변경 자동 복제? Flyway/Liquibase 연동? | `pglogical.replicate_ddl_command()`로 수동 수행. migration tool과 연동 안 됨 | 🟠 중 |
| C5 | Partial commit / Exactly-once 보장? | pglogical은 at-least-once. 멱등 설계 필수. 현재 orders/payments가 UUID PK라 자연 멱등 | 🟢 완화 |
| C6 | 양방향 복제(bidirectional)는? | ADR-0020 failback에서 역방향 publication 전환. 자동 충돌해결 없음. pglogical 2는 공식 bidirectional 미지원 | 🟠 중 |

**C2의 Split-brain**이 이 카테고리의 최대 위험입니다.
양쪽에서 동시에 쓰기가 발생하지 않도록 하는 장치가 AWS 쪽 `default_transaction_read_only=on` 파라미터 하나뿐입니다.
A6에서 언급한 세션 레벨 우회가 가능하고, 파라미터 변경을 깜빡하는 인적 실수도 언제든 일어날 수 있습니다.
탐지 메커니즘(두 cluster의 쓰기 상태 비교)이 없어, Split-brain이 일어나도 일정 시간 이후에야 발견됩니다.

**C3의 skip된 row 복구**는 Phase B 시험에서 누적된 구체적 부채입니다.
AWS 쪽 잔재를 truncate하고 `alter_subscription_resynchronize_table`로 재sync해야 합니다.
현재 미수행 상태이며, 실제 데이터 사용 전에 반드시 끝내야 할 작업입니다.

### D. 운영 / 관측

| # | 질문 | 현 상태 | 위험도 |
|---|------|---------|-------|
| D1 | Replication lag 대시보드? | 없음. 추가 TODO | 🟠 중 |
| D2 | Subscription status change 알림(disconnect/error)? | 없음 | 🟠 중 |
| D3 | AWS 쪽 RDS 접근 로그 / audit? | CloudTrail 기본. pgaudit 미활성 | 🟡 하 |
| D4 | Runbook 검증은? 실제 수행해봤는가? | `docs/runbooks/db-failover-failback.md` 작성. 실제 failover drill **미수행** | 🟠 중 |
| D5 | Infrastructure as Code 전량 포함? | Publisher는 Terraform `module.pg_primary`. Subscription 생성은 K8s Job(`infra/ops/phase-b-pglogical/`) | 🟢 완화 |

관측 공백의 핵심은 **D1 + D2 + D4**입니다.
Replication lag를 볼 대시보드가 없고, subscription 상태 변화(disconnect/error) 알림도 없으며, runbook은 작성만 되어 있고 실제 drill이 수행된 적이 없습니다.
따라서 문제가 발생했을 때 "무엇이 잘못되었는지"를 알아차리는 수단과 "어떻게 복구할지"를 실제로 해본 경험이 모두 빈약합니다.

### E. 비용 / 성능

| # | 질문 | 현 상태 | 위험도 |
|---|------|---------|-------|
| E1 | Cross-cloud egress 비용 예측? | ADR-0018에서 월 $3 추정. 실트래픽 측정 없음 | 🟡 하 |
| E2 | Publisher VM(e2-standard-2) IOPS 한계? | pd-balanced 20GB → baseline 약 2400 IOPS. 티켓팅 peak 부하 재측정 안 함 | 🟠 중 |
| E3 | pd-balanced 20GB가 WAL retention 고려해서 충분? | `max_slot_wal_keep_size=5GB` 적용. 실제 retention 관찰 없음 | 🟠 중 |

비용과 성능은 현재는 이론상 여유가 있으나 **실측 기반이 없다**는 공통점이 있습니다.
ADR-0018에서 egress 비용을 월 $3로 추정했지만 실트래픽 측정이 없고, IOPS도 pd-balanced baseline 계산값만 있을 뿐 peak 부하 재측정이 안 되었습니다.
WAL retention도 파라미터만 걸어둔 상태로 실제 사용량 관찰이 없습니다.

---

## 현재 구현된 완화책

이미 도입되어 있는 장치들입니다.

1. **TLS 전송 암호화**: `sslmode=require`
2. **IP allowlist**: GCP firewall `goti-prod-pg-primary-allow-external`이 AWS NAT `/32`만 허용
3. **Password rotation**: pglogical_repl v2 적용 완료(Secret Manager v1 destroyed)
4. **Replication 권한 최소화**: `pglogical_repl`은 REPLICATION + pg_read_all_data + pglogical schema USAGE만
5. **AWS 쪽 write 차단**: RDS parameter `default_transaction_read_only=on`
6. **Terraform flag 기반 제어**: `enable_pg_primary` / `enable_pg_primary_takeover`로 on/off
7. **Runbook 문서화**: `docs/runbooks/db-failover-failback.md` + ADR 0018/0019/0020
8. **시퀀스 드리프트 방지**: failback runbook에 +1000 margin 수동 보정 절차
9. **UUID PK**: orders/payments 등 핵심 테이블이 자연 멱등

---

## 개선 로드맵

시간·비용 제약으로 덜 된 항목을 Tier로 구분합니다.

### Tier 1 — 런칭 전 반드시(추정 1~2주)

1. **Cloud VPN HA 도입**(A1, A3, B4)
   - GCP Cloud VPN HA + AWS Site-to-Site VPN
   - Public IP + allowlist 제거, 암호화는 IPSec
   - 비용: GCP VPN 약 $36/월, AWS VPN 약 $36/월, cross-cloud egress 별도

2. **자동 백업 + PITR**(B2)
   - `wal-g` 또는 Barman → GCS/S3 off-site
   - 일일 full backup + 분 단위 WAL archive
   - Restore drill 분기 1회

3. **Split-brain 탐지**(C2)
   - 간이: subscription 양쪽 health check → 불일치 감지 시 alert
   - 정석: pg_stat_replication + app 수준 writable check

4. **orders/payments 재sync**(C3)
   - AWS 쪽 truncate + `alter_subscription_resynchronize_table`

5. **Replication lag monitoring + alert**(B3, D1, D2)
   - Prometheus: `pg_replication_lag_seconds` 알림(> 30s warn / > 5min crit)
   - Grafana dashboard: lag / slot status / bytes transferred

6. **Failover drill 실행**(D4)
   - Runbook을 실제로 따라해보고 공백 보강

Tier 1은 프로덕션 런칭 전에 반드시 끝내야 할 6개 항목입니다.
두 명의 개발자 기준으로 1~2주 분량이며, 여기를 건너뛰면 첫 incident에서 곧바로 장애 대응 수단이 없는 상황에 놓입니다.

### Tier 2 — 프로덕션 안정화(1~3개월)

7. **Patroni HA + etcd**(B1)
   - VM 3개 + etcd 3개 구성, 월 $400 이상
   - 자동 failover, STONITH, synchronous replication
   - Split-brain 방어의 정석

8. **IAM / cert 기반 DB 인증**(A2)
   - GCP: Cloud SQL IAM auth가 정석이지만 VM은 직접 설정 필요
   - `clientcert=verify-full` + pg_hba.conf cert 인증으로 plaintext password 제거

9. **공인 인증서**(A1)
   - Let's Encrypt + cert-manager 체인
   - subscription DSN에 `sslmode=verify-full` 활성

10. **pgaudit 도입**(D3)
    - AWS + GCP 양쪽 pgaudit extension 활성
    - audit log → CloudWatch / GCP Cloud Logging

11. **DDL 자동화**(C4)
    - Flyway/Liquibase + `pglogical.replicate_ddl_command()` 훅
    - migration 실행 시 자동으로 publication 전파

Tier 2는 운영이 안정된 뒤 1~3개월에 걸쳐 진행할 개선입니다.
Patroni와 IAM 인증이 가장 크고, 나머지는 상대적으로 독립적으로 추가 가능한 항목입니다.

### Tier 3 — 장기 개선(선택)

12. **GCP 내 Read Replica VM**(ADR-0019 Phase B 후속)
13. **양방향 복제 또는 Active-Active 검토**(C6)
    - pglogical 3(상용) 또는 EDB Bidirectional Replication(BDR) 검토
    - Active-Active는 conflict resolution 정책 확정이 선행 필요
14. **NAT IP 변경 자동 대응**(A3)
    - CloudWatch event → Lambda → GCP firewall API
15. **AWS 쪽 write 차단 강화**(A6)
    - DB-level role로 `CONNECT` 거부 + `default_transaction_read_only` 이중화
    - app 접속 user는 `SET` 권한 revoke

Tier 3는 비즈니스 의사결정이 선행되어야 하거나, 현재 규모에서는 과투자가 되는 항목입니다.
필요해지는 시점(트래픽 증가, 멀티 리전 쓰기 요구 등)에 다시 꺼내어 평가합니다.

---

## 의도적 미도입 항목 (WON'T-FIX within 1 week)

시연 범위 안에서는 명시적으로 제외하는 항목입니다.

- **Active-Active 양방향 복제**: 티켓팅 도메인에서 conflict 해결 정책이 비즈니스 의사결정 영역입니다. 시연 범위를 넘어서는 주제입니다.
- **CDC 기반 AWS DMS / Debezium**: ADR-0018에서 기각한 선택지입니다. 벤더 락인과 시퀀스/DDL 커버 제약이 명확합니다.
- **zero-downtime schema migration**: pg_online_schema_change 등. MVP에서 불필요합니다.

---

## 결과 / Consequences

- **멘토 심사 시**: 이 ADR을 "알고 있으나 의도적으로 미도입"의 근거로 제시합니다. "몰랐다"와 "시간·비용 절충의 결과"를 구분하는 것이 핵심입니다.
- **런칭 전 반드시 Tier 1 완료**: 6개 항목, 2인 개발자 기준 1~2주.
- **리스크 시각화**: 🔴(상) 2건 / 🟠(중) 12건 / 🟡(하) 5건.

리스크를 카테고리와 위험도로 분류하니, 어디를 먼저 손봐야 하는지가 명확해집니다.
🔴(상) 두 건(B1 수동 복구 RTO, B2 백업 공백, C2 Split-brain)은 런칭 전 반드시 해소합니다.
🟠(중) 12건은 Tier 1~2에 분산 배치하여 순차 처리합니다.

---

## 재검토 트리거

다음 조건이 충족되면 이 ADR을 다시 엽니다.

- 프로젝트 재개 시(시연 종료 후 의사결정 모임)
- Tier 1 항목 중 하나라도 incident 발생 시(즉시 상위 Tier로 이관)
- pglogical 2.x EOL 공지(→ pglogical 3 또는 대체 기술 검토)

---

## 📚 배운 점

- **리스크 레지스터도 ADR입니다** — "어떤 기술을 채택한다"만 ADR이 아니라, "어디가 비어 있는지 안다"도 팀 합의로 남길 가치가 있습니다
- **"알고 있으나 의도적으로 미도입"과 "모르고 놓친 것"을 구분**하면 심사·회고 때 방어 논리가 선명해집니다. 시간·비용 절충의 결과라는 점을 기록해두면 재검토도 쉬워집니다
- **Tier 구분은 의사결정 도구입니다** — Tier 1(런칭 전)·Tier 2(안정화)·Tier 3(선택)으로 나누면 "지금 뭐부터 할까"가 자동으로 풀립니다
- **1주 시연 범위라는 전제 자체를 명시**하면, 리뷰어가 "왜 이것이 없는가"라고 묻기 전에 이미 답이 준비되어 있습니다
- **위험도 아이콘(🔴🟠🟡)은 표를 읽는 속도를 크게 높입니다** — 숫자나 High/Medium보다 시각적 무게가 즉시 전달됩니다
