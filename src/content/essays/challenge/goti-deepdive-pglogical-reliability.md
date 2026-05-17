---
title: "pglogical 복제의 신뢰성 한계 — HA 부재·PITR·WAL archiving"
excerpt: "단일 VM에서 pglogical을 운영할 때 비는 가용성·내구성 공백을 설명합니다. 수동 promote의 RTO 문제, Patroni 자동 failover의 동작 원리, WAL archiving이 없을 때 PITR이 불가능한 이유를 다룹니다"
category: challenge
tags:
  - go-ti
  - pglogical
  - PostgreSQL
  - high-availability
  - Patroni
  - PITR
  - WAL-archiving
  - concept
series:
  name: "goti-deepdive-database"
  order: 9
date: "2026-04-19"
---

## 한 줄 요약

> pglogical 논리 복제만으로는 HA(고가용성)와 PITR(시점 복구)을 보장할 수 없습니다 이 글은 단일 VM 운영에서 비는 두 가지 공백이 왜 발생하며, Patroni + etcd와 WAL archiving이 각각 어떻게 그 공백을 채우는지를 설명합니다

---

## 🤔 무엇을 푸는 기술인가

pglogical 논리 복제가 "무엇을 어떻게 전달하는가"는 [이전 글](/essays/goti-deepdive-pglogical-logical-replication)에서 다뤘습니다 이 글은 그 다음 질문인 "pglogical만 있으면 운영 등급 데이터베이스라 할 수 있는가"에 답합니다

결론부터 말하면, **pglogical은 데이터 전달 메커니즘일 뿐**입니다 그 자체로는 다음 두 가지를 제공하지 않습니다

- **HA(High Availability)**: Publisher VM이 죽을 때 자동으로 다른 노드가 승격되는 메커니즘
- **PITR(Point-in-Time Recovery)**: 장애 직전 임의 시점으로 복구하는 메커니즘

이 두 공백은 PostgreSQL 생태계에서 각각 별도의 도구가 채웁니다 **Patroni + etcd**가 HA를, **wal-g 또는 Barman**이 PITR을 담당합니다

---

## 🔧 동작 원리

### 수동 promote의 RTO 문제

pglogical publisher가 올라가 있는 VM이 다운되면 어떤 일이 벌어지는지부터 짚겠습니다

Patroni 같은 HA 도구가 없을 때의 복구 흐름은 전적으로 수동입니다

1. PagerDuty 또는 모니터링 알림 수신 (수 분 소요)
2. 운영자 Slack 확인 및 SSH 접속 시도
3. VM 상태 진단 (GCP 콘솔 또는 `gcloud compute instances describe`)
4. Standby가 있다면 `pg_ctl promote` 또는 `pg_promote()` 실행
5. 애플리케이션 DSN을 새 Primary 주소로 변경하고 재시작
6. pglogical subscription 재구성 (subscriber DSN 업데이트)

이 흐름에서 RTO는 "알림이 울린 시각부터 애플리케이션이 쓰기를 재개할 때까지"입니다 야간이나 주말이면 알림 수신 자체가 지연됩니다 ADR-0021에서는 이를 **수동 복구 RTO 30분 이상**으로 명시했습니다

복잡한 수식이 필요 없습니다 인간이 개입하는 모든 단계마다 지연이 누적되고, "30분"은 낙관적 추정입니다

### Patroni + etcd 자동 failover

![수동 복구 vs Patroni 자동 failover — RTO 비교|tall](/diagrams/goti-deepdive-pglogical-reliability-1.svg)

위 다이어그램은 동일한 VM 장애 시나리오에서 수동 복구(왼쪽)와 Patroni 자동 failover(오른쪽)의 RTO 차이를 비교합니다 왼쪽 경로는 알림 → 운영자 대응 → 수동 promote → DSN 변경의 4단계를 거칩니다 오른쪽 경로는 etcd 합의와 STONITH(펜싱)을 자동으로 수행하고 HAProxy 엔드포인트를 갱신합니다

Patroni는 PostgreSQL용 고가용성 관리 도구입니다 각 노드에서 `patroni` 프로세스가 실행되어 etcd(또는 Consul, ZooKeeper)에 주기적으로 리더십 리스를 갱신합니다 Primary 노드가 리스를 갱신하지 못하면 etcd는 리스를 만료시키고, Standby 노드가 경쟁하여 새 리더를 선출합니다

이 과정에서 **STONITH(Shoot The Other Node In The Head)**가 핵심 역할을 합니다 구 Primary가 실제로 종료되었는지 네트워크 파티션으로 고립된 것인지 구분하기 어렵기 때문에, 새 Primary가 승격되기 전에 구 Primary를 강제 종료(fencing)합니다 이 펜싱 없이는 양쪽이 모두 Primary라고 판단하는 split-brain 상태가 발생할 수 있습니다

Patroni 기반 클러스터의 전형적인 구성은 다음과 같습니다

![Patroni 클러스터 최소 구성 — VM 3대 + etcd 3노드 + HAProxy](/diagrams/goti-deepdive-pglogical-reliability-3.svg)

위 다이어그램은 Patroni 클러스터의 최소 구성 요소와 연결 관계를 보여줍니다 왼쪽 HAProxy는 VIP 엔드포인트를 제공하며 현재 Primary VM으로 요청을 포워딩합니다 Primary VM과 Standby VM 2대는 각각 `patroni` 프로세스를 실행하고, 점선 화살표로 표시된 리스 갱신 요청을 etcd 클러스터에 주기적으로 전송합니다 오른쪽 etcd 3노드 클러스터는 과반(2/3) 동의를 기반으로 리더십 리스를 관리하며, Primary가 리스를 갱신하지 못하면 failover를 트리거합니다 Primary에서 양쪽 Standby로의 실선은 WAL 스트리밍 경로입니다

각 구성 요소의 역할을 정리합니다

- **HAProxy**: 애플리케이션이 연결하는 단일 VIP를 제공합니다 Patroni가 Primary 교체를 완료하면 HAProxy 설정을 자동 갱신하여 애플리케이션 재시작 없이 연결을 전환합니다
- **patroni 프로세스**: 각 VM에서 PostgreSQL 프로세스를 감시하고 etcd에 리스를 갱신합니다 Primary는 `TTL` 주기(기본 30초)마다 갱신하고, 이를 놓치면 Standby 중 하나가 리더로 승격됩니다
- **etcd 3노드 quorum**: 과반 동의 없이는 Primary 선출이 불가능합니다 etcd 1노드 장애까지 클러스터가 유지됩니다 etcd 자체가 단일 장애점이 되지 않도록 반드시 홀수 3대 이상으로 구성합니다

`patroni.yml`에서 `synchronous_mode: true`를 설정하면 **synchronous replication**을 강제할 수 있습니다 Primary는 지정된 수의 Standby가 WAL을 수신·확인해야 커밋을 승인합니다 이 설정은 failover 시 데이터 유실(RPO = 0) 보장을 목표로 하지만, 모든 Standby가 느리거나 다운되면 Primary 쓰기도 차단되는 가용성 트레이드오프가 있습니다

asynchronous replication(기본값)은 Primary가 커밋을 즉시 승인하고 WAL을 비동기로 전달합니다 failover 시 아직 Standby에 전달되지 않은 WAL이 있다면 그만큼의 데이터가 유실됩니다 이 유실 가능 분량이 **RPO(Recovery Point Objective)**입니다

| 항목 | asynchronous | synchronous |
|---|---|---|
| 커밋 응답 속도 | 빠름 | Standby 확인 후 응답 (느림) |
| failover 시 RPO | 미전달 WAL 유실 가능 | RPO ≈ 0 |
| Standby 장애 영향 | Primary 계속 가동 | Primary 쓰기 차단 가능 |
| 적합 환경 | 지연 허용, 쓰기 처리량 우선 | 금융·결제 등 유실 0 요구 |

### PITR과 WAL archiving

HA는 "Primary가 살아있는 상태를 유지"하는 문제입니다 하지만 HA가 있어도 해결되지 않는 상황이 있습니다

- 운영자 실수로 `DELETE FROM orders;` 실행 — Primary에서 발생한 삭제이므로 Standby에도 즉시 복제됨
- 논리 오류로 인한 데이터 오염 — Patroni가 failover를 수행해도 오염된 데이터가 승격됨
- 랜섬웨어로 DB 파일 암호화

이런 상황에서 필요한 것이 **PITR(Point-in-Time Recovery)**입니다 "사고가 발생하기 직전 특정 시각으로 DB를 복원"하는 기능입니다

PITR은 두 가지 요소가 필요합니다

1. **베이스 백업**: 특정 시점의 DB 전체 스냅샷
2. **WAL 아카이브**: 베이스 백업 이후의 모든 WAL 세그먼트

복구는 "베이스 백업을 복원한 뒤, WAL 아카이브를 원하는 시점까지 재실행"하는 방식입니다 WAL은 모든 변경의 기록이므로, WAL을 연속으로 재실행하면 DB를 임의 시점으로 되돌릴 수 있습니다

**WAL archiving**은 PostgreSQL이 WAL 세그먼트 파일을 완성할 때마다 지정한 명령을 실행하는 기능입니다

```bash
# postgresql.conf
archive_mode = on
archive_command = 'wal-g wal-push %p'
```

`archive_command`에 `wal-g wal-push`를 지정하면, WAL 세그먼트가 완성될 때마다 wal-g가 GCS 또는 S3에 업로드합니다 이 아카이브가 있어야 나중에 복구 시 WAL을 순서대로 재실행할 수 있습니다

![WAL archive 유무에 따른 PITR 복구 가능 시점|tall](/diagrams/goti-deepdive-pglogical-reliability-2.svg)

위 다이어그램은 WAL archive 없는 환경(위)과 있는 환경(아래)의 복구 가능 시점을 비교합니다 위쪽에서는 T0 시점의 스냅샷 이후에 쌓인 WAL이 로컬에만 존재합니다 VM이 장애(T2)로 소실되면 T0 이후의 모든 변경이 유실되고, 복구는 T0 시점으로만 가능합니다 아래쪽에서는 T0 이후의 WAL 세그먼트가 wal-g 또는 Barman을 통해 GCS·S3에 지속 업로드됩니다 VM이 소실되어도 오브젝트 스토리지의 WAL이 남아 있으므로 T0~T2 사이의 임의 시점으로 복구할 수 있습니다

아래쪽 박스에 표시된 wal-g / Barman의 역할을 구체적으로 정리합니다

- **archive_command**: WAL 세그먼트 완성 즉시 오브젝트 스토리지에 업로드합니다 이 명령이 0 이외의 종료 코드를 반환하면 PostgreSQL은 해당 세그먼트를 삭제하지 않고 재시도합니다
- **restore_command**: 복구 시 PostgreSQL이 WAL 세그먼트가 필요할 때마다 호출합니다 오브젝트 스토리지에서 순서대로 다운로드하여 재실행을 이어갑니다
- **Restore drill**: archive와 restore 명령이 실제로 동작하는지 정기적으로 검증해야 합니다 "archive 명령이 있다" ≠ "복구가 된다"입니다

### 복제 슬롯과 디스크 압박

WAL archiving을 다루는 맥락에서 pglogical **복제 슬롯**의 디스크 압박 문제를 짚어두겠습니다 이 메커니즘은 [이전 글](/essays/goti-deepdive-pglogical-logical-replication)에서 기초를 설명했으므로 여기서는 신뢰성 관점만 추가합니다

복제 슬롯은 subscriber가 아직 수신하지 못한 WAL을 publisher가 삭제하지 못하게 잠금을 겁니다 subscriber가 장기간 단절되면 이 보존 의무 때문에 WAL이 무한히 쌓입니다 WAL archiving이 동시에 활성화되어 있다면 archive와 복제 슬롯이 별개로 WAL을 보존하므로 디스크 소진 속도가 더 빨라질 수 있습니다

`max_slot_wal_keep_size`를 설정하면 슬롯이 보존하는 WAL 상한을 제한합니다 상한을 초과하면 슬롯이 무효화되고 subscriber는 다음 연결 시 초기 동기화(initial sync)부터 다시 시작해야 합니다 디스크 보호를 위해 슬롯을 무효화하는 것이 PostgreSQL의 의도적 설계입니다

---

## 📐 세부 동작과 옵션

### RTO / RPO 목표와 구성 선택

실제 운영에서는 RTO·RPO 목표에 따라 구성 복잡도가 달라집니다

| 항목 | 단일 VM (HA 없음) | Patroni + etcd | Patroni + synchronous |
|---|---|---|---|
| RTO | 30분+ (수동) | 수십 초 (자동) | 수십 초 (자동) |
| RPO | 마지막 백업 시점 | 미전달 WAL 소량 | ≈ 0 |
| 운영 복잡도 | 낮음 | 중간 (VM 3+, etcd 3) | 높음 (쓰기 지연 감수) |
| 월 비용 추정 | $50 미만 | $400+ | $400+ |

비용 항목은 VM 3대(primary + standby 2) + etcd 3노드 기준 GCP e2-standard-2 추정입니다 실 환경에 따라 달라집니다

### wal-g vs Barman

두 도구는 목적이 같지만 운영 모델이 다릅니다

| 항목 | wal-g | Barman |
|---|---|---|
| 설치 위치 | DB VM 내 바이너리 | 별도 백업 서버 |
| 아키텍처 | Push 방식 (DB→스토리지) | Pull 방식 (Barman 서버→DB 폴링) |
| 압축 | 기본 lz4 / zstd 지원 | gzip / bzip2 |
| 주 스토리지 대상 | S3 / GCS / Azure Blob | 로컬 또는 NFS (스토리지 플러그인) |
| 운영 단순성 | DB VM만 있으면 됨 | 별도 서버 관리 필요 |
| 엔터프라이즈 지원 | 커뮤니티 | 2ndQuadrant(EDB) 공식 |

go-ti처럼 VM 한 대로 구성된 환경에서는 별도 백업 서버가 없으므로 wal-g가 구성이 단순합니다 반대로 DBA팀이 있고 중앙 백업 서버를 운영하는 조직이라면 Barman이 적합합니다

### Replication lag 모니터링

HA·PITR과 함께 언급할 신뢰성 지표가 **복제 지연(replication lag)**입니다 subscriber가 얼마나 뒤처져 있는지를 지속 감시해야 합니다

```sql
-- publisher에서 복제 지연 확인
SELECT slot_name,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal,
       active,
       wal_status
FROM pg_replication_slots;
```

`postgres_exporter`를 사용한다면 `pg_replication_lag_seconds`와 `pg_replication_slots` 메트릭으로 Prometheus alert를 설정할 수 있습니다 운영 기준으로 30초 초과 시 경고, 5분 초과 시 심각 알림이 일반적입니다

---

## 🧩 go-ti에서는

go-ti에서는 ADR-0021(알려진 한계와 로드맵)에서 B1(VM 단일 장애)과 B2(백업·PITR 부재)를 위험도 상(🔴)으로 명시했습니다 Patroni + etcd는 프로덕션 런칭 전 Tier 2 항목(VM 3대 + etcd 3노드, 월 $400+ 추가)으로, WAL archiving은 Tier 1 항목(wal-g → GCS, 일일 풀 백업 + 분 단위 WAL archive)으로 분류했습니다 1주 시연 범위에서는 두 항목 모두 의도적으로 생략했으며, `max_slot_wal_keep_size=5GB`로 복제 슬롯의 WAL 폭증만 방어한 상태로 운영했습니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [pglogical 복제 알려진 한계와 개선 로드맵 — ADR](/logs/goti-pglogical-mr-replication-gaps-adr)에 정리했습니다

---

## 📚 핵심 정리

- pglogical은 데이터 전달 메커니즘입니다 HA와 PITR은 각각 별도 도구(Patroni + etcd, wal-g / Barman)가 담당합니다
- Patroni는 etcd 리더십 리스 만료를 감지하여 자동 failover를 수행합니다 STONITH(펜싱)으로 구 Primary를 강제 종료해 split-brain을 차단합니다
- synchronous replication은 RPO ≈ 0을 보장하지만 모든 Standby 장애 시 Primary 쓰기가 차단되는 가용성 트레이드오프가 있습니다
- WAL archiving 없이는 베이스 백업 이전 시점으로만 복구 가능합니다 wal-g 또는 Barman으로 WAL을 오브젝트 스토리지에 연속 보관해야 PITR이 성립합니다
- archive_command만 설정했다고 복구가 된다고 가정하면 안 됩니다 restore_command 검증과 Restore drill(분기 1회 실제 복구 수행)이 필요합니다
