# ADR 0021 — Multi-Cloud pglogical 복제: 알려진 한계와 개선 로드맵

- 상태: Accepted (as risk register)
- 결정일: 2026-04-19
- 관련 ADR: [0018](0018-multicloud-db-replication-technology.md), [0019](0019-db-active-passive-with-read-split.md), [0020](0020-db-failback-reverse-replication.md)
- 영향 레포: Goti-Terraform, Goti-k8s, goti-team-controller

## 배경

ADR-0018 에서 **1주 시연 범위** (종료 예정 2026-04-24) 를 전제로 GCE VM + pglogical 2.4.6 기반 멀티클라우드 복제를 채택했다. 이 결정은 다음 tradeoff 를 수용한다:

- HA (Patroni/etcd) 생략
- Cloud VPN HA 구축 생략 → Public IP + IP allowlist + TLS (self-signed)
- plaintext password 기반 DSN (IAM/cert 인증 미도입)

이 ADR 은 해당 결정의 **알려진 한계** 를 명시적으로 기록하여:

1. 멘토 심사 / 프로덕션 런칭 전 점검 시 질문 범위를 예측 가능하게 함
2. 시연 종료 후 장기 운영 복귀 시 우선순위 로드맵으로 사용
3. "알고 있으나 시간·비용상 의도적으로 생략" 과 "모르고 놓친 것" 을 구분

## 심사자가 물을 가능성이 높은 질문 (카테고리별)

### A. 보안 (Transport / Auth / Network)

| # | 질문 | 현 상태 | 위험도 |
|---|------|---------|-------|
| A1 | TLS 가 self-signed 인데 MITM 방어는? | `sslmode=require` 만 적용. CA 검증 없음 | 🟠 중 |
| A2 | Subscription DSN 에 plaintext password 가 있다. 유출되면? | 2026-04-18 Phase B Job 에러 로그에 실제 노출 이력 있음. 이후 rotation 완료 | 🟠 중 |
| A3 | Public IP + `/32` allowlist 만 의존한다. AWS NAT IP 가 바뀌면? | NAT gateway 재생성 시 IP 변경 → allowlist 수동 업데이트 필요. 자동화 없음 | 🟡 하 |
| A4 | `pglogical_repl` 계정의 `pg_read_all_data` 권한이 너무 넓다 | 모든 테이블 SELECT. replication 에 필요한 최소 권한 넘음 | 🟡 하 |
| A5 | Subscription 자체 암호화 (at rest) 는? | PostgreSQL 자체 at-rest 암호화 없음. GCP 디스크 레벨 암호화만 의존 | 🟡 하 |
| A6 | AWS 쪽 `default_transaction_read_only=on` 을 세션 레벨에서 우회 가능한데 | `SET LOCAL default_transaction_read_only=off` 로 우회 가능. app 수준 role 차단 없음 | 🟠 중 |

### B. 신뢰성 / HA

| # | 질문 | 현 상태 | 위험도 |
|---|------|---------|-------|
| B1 | VM 단일 장애 시 쓰기 중단 시간은? | Patroni 없음. 수동 복구 RTO 30분+ | 🔴 상 |
| B2 | 백업은? PITR 가능한가? | `gcloud compute disks snapshot` 수동 / 자동 스케줄 없음. WAL archive 없음 | 🔴 상 |
| B3 | Replication lag 모니터링/알림은? | postgres_exporter 가 있지만 `pg_replication_slots` metric 알림 미설정 | 🟠 중 |
| B4 | AWS RDS failover 시 subscription 재연결 자동? | pglogical 자체 reconnect 는 있음. 그러나 `default_transaction_read_only=on` 을 off 로 바꾸는 절차 수동 | 🟠 중 |
| B5 | Initial sync 중 publisher CPU / WAL 폭발 검증? | 실 데이터 ~5GB 이라 이론상 여유. **부하 테스트로 검증 안 됨** | 🟡 하 |
| B6 | pglogical 2.4.6 커뮤니티 활성도? EOL? | 2ndQuadrant 인수 후 PostgreSQL 커뮤니티 이관. 공식 LTS 없음. 버그 fix 의존 불명 | 🟠 중 |

### C. 데이터 정합성 / Failover

| # | 질문 | 현 상태 | 위험도 |
|---|------|---------|-------|
| C1 | Failover 후 시퀀스 드리프트 방지는? | runbook 에 "+1000 margin" 으로 기재. 자동 보정 스크립트 있음 | 🟢 완화 |
| C2 | Split-brain 탐지 및 복구? | 없음. 양쪽 쓰기 가능 상태 방지를 `default_transaction_read_only` 파라미터에만 의존 | 🔴 상 |
| C3 | orders/payments PK 충돌 skip 된 11,859/11,440 row 복구는? | AWS 쪽 잔재 삭제 후 `alter_subscription_resynchronize_table` 예정. 미수행 | 🟠 중 |
| C4 | DDL 변경 자동 복제? Flyway/Liquibase 연동? | `pglogical.replicate_ddl_command()` 로 수동 수행. migration tool 과 연동 안 됨 | 🟠 중 |
| C5 | Partial commit / Exactly-once 보장? | pglogical 은 at-least-once. 멱등 설계 필수. 현재 orders/payments 가 UUID PK 라 자연 멱등 | 🟢 완화 |
| C6 | 양방향 복제 (bidirectional) 는? | ADR-0020 failback 에서 역방향 publication 전환. 자동 충돌해결 없음. pglogical 2 는 공식 bidirectional 미지원 | 🟠 중 |

### D. 운영 / 관측

| # | 질문 | 현 상태 | 위험도 |
|---|------|---------|-------|
| D1 | Replication lag 대시보드? | 없음. 추가 TODO | 🟠 중 |
| D2 | Subscription status change 알림 (disconnect/error)? | 없음 | 🟠 중 |
| D3 | AWS 쪽 RDS 접근 로그 / audit? | CloudTrail 기본. pgaudit 미활성 | 🟡 하 |
| D4 | Runbook 검증은? 실제 수행해봤는가? | `docs/runbooks/db-failover-failback.md` 작성. 실제 failover drill **미수행** | 🟠 중 |
| D5 | Infrastructure as Code 전량 포함? | Publisher 는 Terraform `module.pg_primary`. Subscription 생성은 K8s Job (`infra/ops/phase-b-pglogical/`) | 🟢 완화 |

### E. 비용 / 성능

| # | 질문 | 현 상태 | 위험도 |
|---|------|---------|-------|
| E1 | Cross-cloud egress 비용 예측? | ADR-0018 에서 월 $3 추정. 실트래픽 측정 없음 | 🟡 하 |
| E2 | Publisher VM (e2-standard-2) IOPS 한계? | pd-balanced 20GB → baseline ~2400 IOPS. 티켓팅 peak 부하 재측정 안 함 | 🟠 중 |
| E3 | pd-balanced 20GB 가 WAL retention 고려해서 충분? | `max_slot_wal_keep_size=5GB` 적용. 실제 retention 관찰 없음 | 🟠 중 |

## 현재 구현된 완화책 (이미 있는 것)

1. **TLS 전송 암호화**: `sslmode=require`
2. **IP allowlist**: GCP firewall `goti-prod-pg-primary-allow-external` = AWS NAT `/32` only
3. **Password rotation**: pglogical_repl v2 적용 완료 (Secret Manager v1 destroyed)
4. **Replication 권한 최소화**: `pglogical_repl` 은 REPLICATION + pg_read_all_data + pglogical schema USAGE 만
5. **AWS 쪽 write 차단**: RDS parameter `default_transaction_read_only=on`
6. **Terraform flag 기반 제어**: `enable_pg_primary` / `enable_pg_primary_takeover` 로 on/off
7. **Runbook 문서화**: `docs/runbooks/db-failover-failback.md` + ADR 0018/0019/0020
8. **시퀀스 드리프트 방지**: failback runbook 에 +1000 margin 수동 보정 절차
9. **UUID PK**: orders/payments 등 핵심 테이블이 자연 멱등

## 시간·비용 부족으로 덜 된 것 (우선순위 로드맵)

### Tier 1 — 런칭 전 반드시 (추정 1~2주)

1. **Cloud VPN HA 도입** (A1, A3, B4)
   - GCP Cloud VPN HA + AWS Site-to-Site VPN
   - Public IP + allowlist 제거, 암호화는 IPSec
   - 비용: GCP VPN $36/월, AWS VPN $36/월, cross-cloud egress 별도
2. **자동 백업 + PITR** (B2)
   - `wal-g` 또는 Barman → GCS/S3 off-site
   - 일일 full backup + 분 단위 WAL archive
   - Restore drill 분기 1회
3. **Split-brain 탐지** (C2)
   - 간이: subscription 양쪽 health check → 불일치 감지 시 alert
   - 정석: pg_stat_replication + app 수준 writable check
4. **orders/payments 재sync** (C3)
   - AWS 쪽 truncate + `alter_subscription_resynchronize_table`
5. **Replication lag monitoring + alert** (B3, D1, D2)
   - Prometheus: `pg_replication_lag_seconds` 알림 (> 30s warn / > 5min crit)
   - Grafana dashboard: lag / slot status / bytes transferred
6. **Failover drill 실행** (D4)
   - Runbook 을 실제로 따라해보고 공백 보강

### Tier 2 — 프로덕션 안정화 (1~3개월)

7. **Patroni HA + etcd** (B1)
   - VM 3 + etcd 3 = 월 $400+
   - 자동 failover, STONITH, synchronous replication
   - Split-brain 방어의 정석
8. **IAM / cert 기반 DB 인증** (A2)
   - GCP: Cloud SQL IAM auth 가 정석이지만 VM 은 직접 설정
   - `clientcert=verify-full` + pg_hba.conf cert 인증으로 plaintext password 제거
9. **공인 인증서** (A1)
   - Let's Encrypt + cert-manager / snakeoil 이 아닌 chain
   - subscription DSN 에 `sslmode=verify-full` 활성
10. **pgaudit 도입** (D3)
    - AWS + GCP 양쪽 pgaudit extension 활성
    - audit log → CloudWatch / GCP Cloud Logging
11. **DDL 자동화** (C4)
    - Flyway/Liquibase + `pglogical.replicate_ddl_command()` 훅
    - migration 실행 시 자동으로 publication 전파

### Tier 3 — 장기 개선 (선택)

12. **GCP 내 Read Replica VM** (ADR-0019 의 Phase B 후속)
13. **양방향 복제 또는 Active-Active 검토** (C6)
    - pglogical 3 (상용) 또는 EDB Bidirectional Replication (BDR) 검토
    - Active-Active 는 conflict resolution 정책 확정 선행 필요
14. **NAT IP 변경 자동 대응** (A3)
    - CloudWatch event → Lambda → GCP firewall API
15. **AWS 쪽 write 차단 강화** (A6)
    - DB-level role 로 `CONNECT` 거부 + `default_transaction_read_only` 이중화
    - app 접속 user 는 `SET` 권한 revoke

## 의도적 미도입 항목 (WON'T-FIX within 1 week)

- **Active-Active 양방향 복제**: 티켓팅 도메인에서 conflict 해결 정책이 비즈니스 의사결정. 시연 범위 초과.
- **CDC 기반 AWS DMS / Debezium**: ADR-0018 에서 기각. 벤더 락인 + 시퀀스/DDL 커버 제약.
- **zero-downtime schema migration**: pg_online_schema_change 등. MVP 에서 불필요.

## 결과 / Consequences

- **멘토 심사 시**: 이 ADR 을 "알고 있으나 의도적으로 미도입" 의 근거로 제시. "몰랐다" 와 "시간·비용 절충의 결과" 를 구분.
- **런칭 전 반드시 Tier 1 완료**: 6 항목. 2인 개발자 기준 1~2주.
- **리스크 시각화**: 🔴(상) 2건 / 🟠(중) 12건 / 🟡(하) 5건.

## 재검토 트리거

- 프로젝트 재개 시 (시연 종료 후 의사결정 모임)
- Tier 1 항목 중 하나라도 incident 발생 시 (즉시 이관)
- pglogical 2.x EOL 공지 (→ pglogical 3 또는 대체 기술 검토)
