---
title: "Phase B pglogical 시험 + 정리 — spot taint 연쇄와 RDS outbound 차단"
excerpt: "GCP pg-primary → AWS RDS pglogical subscription을 구성하는 과정에서 Spot taint 연쇄 장애, Istio webhook label 누락, RDS subnet outbound 차단, 평문 DSN 노출까지 11개의 장애물을 하나씩 풀어낸 Phase B 실행 기록입니다"
type: troubleshooting
category: challenge
tags:
  - go-ti
  - PostgreSQL
  - pglogical
  - Multi-Cloud
  - Replication
  - Troubleshooting
series:
  name: "goti-multicloud-db"
  order: 7
date: "2026-04-18"
---

## 한 줄 요약

> Phase A에서 구축한 GCP pg-primary VM을 provider로 삼아 AWS RDS에 pglogical subscription을 연결했습니다. Spot taint 연쇄, Istio webhook label 누락, RDS subnet outbound 차단, DSN 평문 노출 등 11개의 장애물을 거친 끝에 v10에서 subscription 생성에 성공했고, 작업 후 임시 변경을 모두 원복했습니다

## Impact

- **작업 시간**: 약 2시간 10분 (15:10~17:20 KST)
- **대상**: GCP pg-primary VM → AWS RDS (goti-prod-pg16) pglogical 복제
- **AWS 추가 비용**: 약 $3~5 (EKS 10 node × t3.large × 40분 + EC2 잔존 인스턴스)
- **발생일**: 2026-04-18

---

## 🔥 목표: Phase B pglogical subscriber 구성

Phase A를 마무리하면서 GCP pg-primary VM(10.2.3.218)이 운영 상태로 올라갔고, Cloud SQL은 해지됐습니다.
같은 날 오후, Phase B의 핵심 작업인 **AWS RDS subscription 구성**을 진행했습니다.

ADR-0018의 Phase B는 다음 구조입니다.

- **Publisher**: GCP pg-primary (`goti_gcp_primary`)
- **Subscriber**: AWS RDS `goti-prod-pg16` (`goti_aws_subscriber`)
- **Replication set**: `default` — 6 schema, 41 tables, 0 sequences (UUID PK 기반)

AWS 쪽은 비용 절감을 위해 EKS ASG=0으로 내려가 있었고, 저녁에 다시 기동할 예정이었습니다.
사용자 요청은 "AWS 기동은 저녁이지만 지금 할 수 있는 부분까지 해보자"였고, 중간에 "결국 수평 통째로 시도" 방향으로 확대됐습니다.

### 사전 준비 (AWS 없이 완료된 코드)

AWS가 내려가 있는 동안 다음 4가지를 선행해두었습니다.

- **P1 publisher 설정 Job**: `infra/ops/phase-b-pglogical/01-publisher-setup-job.yaml` — `pglogical.create_node(goti_gcp_primary)` + `replication_set_add_all_tables` (6 schema, 41 tables)
- **P2 RDS parameter group Terraform**: `prod-aws/modules/rds/`에 `enable_pglogical_subscriber` flag 추가, `shared_preload_libraries=pglogical`, `rds.logical_replication=1`, `default_transaction_read_only=on`
- **P3 subscriber Job**: `02-aws-subscriber-setup-job.yaml` — `CREATE EXTENSION pglogical` + `create_node` + `create_subscription`
- **P4 failover/failback runbook**: `docs/runbooks/db-failover-failback.md` 작성

P1은 GCP 쪽에 먼저 실행해 성공했습니다. Replication set `default`에 41 테이블 등록, 0 sequences(UUID PK라 정상).

---

## 🤔 실 실행에서 마주친 11개의 장애물

Publisher 등록까지는 깔끔했지만, AWS 기동 이후 subscription 생성은 한 번에 되지 않았습니다.
시간 순으로 11개의 장애물을 풀었습니다.

### 1. AWS NAT egress IP 허용

```bash
$ aws ec2 describe-nat-gateways --query '...PublicIp'
15.164.8.237
```

Terraform tfvars의 `pg_primary_allowed_ingress_cidrs`를 `["15.164.8.237/32"]`로 업데이트했습니다.
`terraform apply -target=module.pg_primary`로 GCP firewall rule 1개가 추가됐습니다.

### 2. RDS parameter group 적용 — Terraform drift 회피

`terraform plan -target=module.rds`를 돌리니 **foundation/eks/kms 등 기존 drift**가 함께 포함됐습니다.
`-target` semantics의 제약 때문에 의도하지 않은 변경이 섞일 위험이 있었습니다.

**결정**: Terraform 대신 `aws rds modify-db-parameter-group`으로 직접 수정하고, tfvars는 `rds_enable_pglogical_subscriber=true`로 기록해 다음 전체 apply 때 state가 동기화되도록 했습니다.

- **교훈**: 대규모 drift가 있는 환경에서 `-target`은 불완전합니다. CLI 수동 + tfvars 동기화가 현실적입니다.

### 3. RDS 재시작 승인 프로세스

```bash
$ aws rds reboot-db-instance --db-instance-identifier goti-prod-pg16
```

cloud-cli-safety hook이 "prod DB reboot은 명시 승인 필요"로 1차 차단했습니다.
사용자 확인 후 재실행, **44초** 만에 완료됐습니다.

- **교훈**: RDS reboot도 파괴적 action으로 분류되어 매번 개별 승인이 필요합니다.

### 4. master credential K8s Secret 준비

AWS EKS의 `goti-db-master-cred` Secret이 존재하지 않았습니다(이름이 `goti-postgresql-auth`였습니다).
Terraform이 만든 AWS Secrets Manager의 `goti-prod/rds/master-password`에서 stdin pipe로 K8s Secret `rds-master-cred`를 생성했습니다.

password가 transcript에 노출되지 않도록 `--from-literal` 대신 `--from-file=/dev/stdin`을 사용했습니다.

### 5. Spot nodegroup 선택 — 역효과의 시작

비용을 아끼려고 Spot nodegroup 1 node만 scale up했습니다.
Hook이 "prod scale change 건별 승인"으로 차단, 사용자 승인 후 node join 성공.

문제는 Spot node에 `node-role=spot:NoSchedule` **taint**가 걸려 있었다는 점입니다.
이 단 하나의 taint가 이후 5단계 cascade를 만들어냈습니다.

### 6. Cascade 1 — Kyverno admission-controller Pending

```text
failed calling webhook "validate.kyverno.svc-fail"
```

Kyverno admission-controller가 기본적으로 toleration이 없어 spot taint에 schedule 불가, Pending 상태에 멈췄습니다.
Kyverno webhook이 안 뜨니 **다른 Job apply도 전부 실패**했습니다.

사용자가 직접 `kubectl patch deployment kyverno-admission-controller`로 spot toleration을 추가해 admission을 Running으로 끌어올렸습니다.

### 7. Cascade 2 — Istio sidecar-injector webhook

```text
failed calling webhook "namespace.sidecar-injector.istio.io":
no endpoints available for service istiod
```

Job apply에 또 실패했습니다. 원인은 더 미묘했습니다.

`sidecar.istio.io/inject: "false"`를 **annotation**에만 넣어두었는데, Istio `objectSelector`는 **label** 기준으로 필터링합니다.
annotation만으로는 webhook 우회가 되지 않았습니다.

Job template의 `metadata.labels`에도 `sidecar.istio.io/inject: "false"`를 추가했습니다(v3).

- **교훈**: Istio webhook의 `objectSelector`는 annotation이 아닌 label로 매칭합니다. 두 곳 모두 지정해야 안전합니다.

### 8. Cascade 3 — Kyverno validate-probes 정책 위반

```text
resource Pod blocked due to policies require-pod-probes
```

Job pod에 `livenessProbe`/`readinessProbe`가 없어 Kyverno 정책에 걸렸습니다.
각 container에 `pg_isready` 기반 probe를 추가했습니다(v4).

### 9. Cascade 4 — Pod가 spot taint를 tolerate 안 함

v4까지 오자 이번엔 우리 Job 자신이 spot node에 schedule되지 않았습니다.
Job template에도 spot `tolerations`를 추가했습니다(v5).

### 10. Cascade 5 — CoreDNS Pending, DNS 해석 실패

CoreDNS도 spot toleration이 없어 Pending.
Subscriber Job이 `goti-prod-postgres.cjqcoy2ce8go.ap-northeast-2.rds.amazonaws.com`을 해석하지 못해 error.

**cascade의 끝이 안 보이는** 상황이었습니다.
여기서 Spot 전략을 포기하고 **Core nodegroup 전환**을 결정했습니다.

### 11. Core nodegroup 1 node로는 부족 (CPU 103%)

Core t3.large 1 node에 ArgoCD 관리 goti-* app과 system pod 45개가 전부 몰렸습니다.
CPU 요청 103%, Kyverno admission의 100m 요청이 들어갈 공간이 없어 다시 Pending.

- **최종 조치**: 사용자 지시 "그냥 원래 10개 전부 다 올려"에 따라 core=5, spot=5로 10 node 풀 스케일.
- system pod들이 자동 분산되면서 Kyverno/Istiod/CoreDNS가 정상화됐습니다.

### 정리 — Spot 전략이 실패한 이유

Spot node 자체가 문제가 아니라, **toleration 없는 system pod들이 spot node에 schedule되지 않는 구조적 충돌**이 문제였습니다.
cascade를 하나씩 풀 때마다 다음 cascade가 이어져 나왔고, 결국 Core로 전환해 10 node 풀 스케일이 더 빨랐습니다.

---

## 🔥 subscription 생성 — 3개의 추가 장애물

10 node 환경이 정상화된 뒤에도 subscription 생성은 바로 되지 않았습니다.

### 12. `default_transaction_read_only=on`이 CREATE EXTENSION도 막음

```text
ERROR: cannot execute CREATE EXTENSION in a read-only transaction
```

Phase B의 subscriber 쪽 RDS에는 `default_transaction_read_only=on`을 걸어 둔 상태였습니다.
`CREATE EXTENSION`조차 read-only 트랜잭션에서는 실행되지 않았습니다.

Subscriber Job SQL 앞에 세션 레벨 `SET default_transaction_read_only = off;`를 추가했습니다(v8).

### 13. RDS subnet default route 부재 — 가장 까다로운 네트워크 이슈

v8에서 subscription 생성을 시도하자 이번엔 timeout이 났습니다.

```text
connection to server at "34.64.74.209", port 5432 failed:
timeout expired
```

디버그 결과가 당혹스러웠습니다.

- AWS EKS pod에서 `nc -vz 34.64.74.209 5432` → **성공**
- AWS RDS에서 pglogical subscription → **timeout**

즉, **RDS 자체가 outbound 불가** 상태였습니다.
RDS subnet 3개(`subnet-049bb00ab01f77a3b`, `subnet-022a9ad3513aaca2f`, `subnet-0a77f5c8b064e4d94`)의 route table에 `0.0.0.0/0`이 없었고, VPC 내부(10.1.0.0/16)만 라우팅하도록 구성되어 있었습니다.

이것은 **AWS 기본 설계**입니다. RDS private subnet은 외부 outbound를 의도적으로 차단해 보안을 확보합니다.
하지만 pglogical subscriber는 반드시 provider에 outbound connection을 걸어야 합니다.

사용자 결정: "임시 해제하고 진행 + 끝나면 되돌리기."

```bash
$ aws ec2 create-route \
    --route-table-id rtb-xxx \
    --destination-cidr-block 0.0.0.0/0 \
    --nat-gateway-id nat-079325a73e2de77fc
```

3개 route table에 NAT route를 추가했습니다. **Cleanup 때 반드시 삭제해야 하는 변경**이라 Task-21로 관리했습니다.

- **교훈**: RDS private subnet의 외부 outbound 차단은 기본 설계 의도입니다. 장기 운영에서는 Cloud VPN HA 같은 공식 경로가 필요합니다.

### 14. pglogical schema 권한 부재

v9에서는 connection이 성공했지만 다른 에러가 떴습니다.

```text
permission denied for schema pglogical
```

Subscriber는 provider의 `pglogical.node`, `replication_set` 메타데이터를 조회해야 합니다.
GCP pg-primary VM에서 `pglogical_repl` 사용자에게 추가 GRANT를 수행했습니다.

```sql
GRANT USAGE ON SCHEMA pglogical TO pglogical_repl;
GRANT SELECT ON ALL TABLES IN SCHEMA pglogical TO pglogical_repl;
ALTER DEFAULT PRIVILEGES IN SCHEMA pglogical
  GRANT SELECT ON TABLES TO pglogical_repl;
GRANT pg_read_all_data TO pglogical_repl;
```

수행 Job: `pglogical-repl-grants-20260418` (GCP context).
재시도 친화성을 위해 P1 publisher Job manifest에도 GRANT를 추가했습니다.

### 15. 평문 password DSN 노출 — 보안 이슈

v8~v10의 `create_subscription` 에러 메시지에 DSN 전체가 그대로 출력되고 있었습니다.

```text
host=... user=pglogical_repl
password=6S3Nhf93eYGiPeroCbGzJCN38lfmJNGW
sslmode=require
```

PostgreSQL은 connection 실패 시 DSN 전체를 에러 메시지에 포함하는 기본 동작을 합니다.
`goti-prod-pg-primary-replication-password` Secret Manager에서 새 version 생성, VM `ALTER USER pglogical_repl WITH PASSWORD`, AWS K8s Secret 업데이트까지 **password rotation**이 필요했습니다(저녁에 완료).

Subscriber Job manifest에도 DSN 노출 방지 개선을 적용했습니다(VERBOSITY=terse + stderr sed mask, pre-flight `pg_isready` 추가).

---

## ✅ v10 subscription 생성 성공

모든 장애물을 풀고 나니 v10에서 드디어 성공했습니다.

```text
NOTICE: subscription created — initial sync started
=== nodes ===
 goti_aws_subscriber
 goti_gcp_primary
=== replication sets received ===
 sub_from_gcp_primary | {default}
```

### Initial sync 결과 (monitor v2, 20분 loop)

**복제 성공 테이블**:

| 테이블 | GCP baseline | AWS 최종 | 판정 |
|---|---|---|---|
| stadium_service.baseball_teams | 10 | 10 | 완벽 |
| ticketing_service.seats | 200,121 | 200,121 | 완벽 |
| user_service.users | 1,036,569 | 1,036,530 | 99.996% (39 row gap) |

대부분의 테이블은 정상 sync됐습니다. `user_service.users`의 39 row gap은 initial snapshot과 실시간 변경 사이의 경계 틈으로 보이며, WAL replay가 따라잡으면 해소될 수준입니다.

**정합성 문제 테이블** (Phase B 범위 외 운영 이슈):

| 테이블 | GCP baseline | AWS 최종 | 차이 |
|---|---|---|---|
| ticketing_service.orders | 738,747 | 750,606 | +11,859 (AWS 초과) |
| payment_service.payments | 738,020 | 749,460 | +11,440 (AWS 초과) |

**원인 추정**: AWS RDS에 Cloud SQL 시대 이전의 과거 prod 데이터가 남아 있었습니다.
pglogical initial sync가 PK 충돌을 만나 해당 테이블을 skip했거나 unique violation으로 멈춘 것으로 보입니다.

**후속 조치**:

1. AWS 쪽 `orders`/`payments` truncate
2. `SELECT pglogical.alter_subscription_resynchronize_table('sub_from_gcp_primary', 'ticketing_service.orders');`로 재동기화
3. 또는 subscription drop + create (synchronize_data=true로 전체 재sync)

## Cleanup 실행 — "끝나면 되돌려"

사용자 지시대로 임시 변경을 원복했습니다.

**완료된 cleanup**:

- RDS subnet 3개 임시 NAT route 삭제 → 보안 원복 완료
- AWS EKS core nodegroup `minSize=0,desiredSize=0,maxSize=1`로 축소
- AWS EKS spot nodegroup `minSize=0,desiredSize=0,maxSize=1`로 축소
- `phase-b-critical` PriorityClass 삭제
- 임시 Job 10여 개 삭제 (AWS + GCP 양쪽)

**자연 정리 확인**:

- EC2 instance `i-059ab868bec6b0b61`이 잔존했지만, ASG desired=0 전환 후 유휴 인스턴스를 ASG가 자동 terminate한 것으로 확인됐습니다.

**후속 필요**:

- `orders`/`payments` 정합성 복구 (truncate + resync)
- Kyverno admission-controller의 spot toleration patch는 ArgoCD sync로 자동 원복 예정

### 남은 수동 변경 기록 (Terraform state 밖)

| 변경 | 위치 | 원복 여부 |
|---|---|---|
| RDS parameter group 3-param 추가 | AWS RDS | tfvars 동기화됨, 다음 apply로 합류 |
| RDS subnet NAT route 추가 | AWS VPC | 원복 완료 |
| Kyverno admission-controller spot toleration | AWS EKS | ArgoCD sync 자동 원복 예정 |
| `gcp-pglogical-repl-cred` Secret | AWS EKS goti ns | 유지 (재시도 시 재사용) |
| `rds-master-cred` Secret | AWS EKS goti ns | 유지 |
| GCP pg-primary pglogical schema GRANT | GCP VM | 유지 (subscription 의존) |
| AWS pglogical subscription + local node | AWS RDS | 미정 (정합성 복구 시 drop + create) |

Terraform state와 실제 클라우드 자원의 차이는 다음 전체 apply에서 수렴하도록 tfvars 쪽에 기록을 남겼습니다.

---

## 📚 배운 점

1. **Spot taint cascade의 위험성**: Kyverno/Istio/CoreDNS 등 system pod가 toleration 없으면 spot 노드에 뜨지 않습니다. cascade를 하나씩 풀기보다 Core nodegroup으로 전환해 풀 스케일 올리는 편이 훨씬 빠릅니다.
2. **`-target` Terraform의 한계**: 기존 drift가 있는 환경에서는 의도하지 않은 변경이 섞여 들어옵니다. CLI 수동 수정 + tfvars 동기화가 현실적입니다.
3. **RDS 외부 outbound는 기본 차단**: VPC private subnet의 명시적 default route가 없으면 RDS는 외부로 나갈 수 없습니다. pglogical처럼 outbound가 필수인 경우 Cloud VPN HA 같은 공식 경로 구축을 고려해야 합니다.
4. **Istio webhook `objectSelector`는 label 기준**: annotation만으로는 매칭되지 않습니다. webhook 우회가 필요한 Job은 labels에도 반드시 같은 키를 지정해야 합니다.
5. **PostgreSQL connection 실패 시 DSN 노출**: password가 에러 메시지에 그대로 포함되어 로그 유출의 원인이 됩니다. `postgres://` URL 대신 passfile이나 세션 SET 분리 같은 방식을 검토할 가치가 있습니다.
6. **RDS 잔재 데이터 이슈**: Cloud SQL 시대 이전 데이터가 `orders`/`payments`에 남아 있었습니다. Phase B 재시도 전 truncate가 선결 조건입니다.
7. **PDB는 scale-to-zero를 차단**: coredns/ebs-csi-controller가 PDB `minAvailable=1`이라 마지막 node terminate가 막힙니다. 강제 terminate 절차를 Runbook에 명시해두는 편이 좋습니다.

## 후속 작업 체크리스트

- EC2 instance `i-059ab868bec6b0b61` 강제 terminate — ASG desired=0 전환 후 자연 정리됨
- `pglogical_repl` password rotation — 04-18 저녁 완료, Secret Manager v2 enabled, v1 destroyed, SHA256 match 검증
- `orders`/`payments` AWS 쪽 과거 데이터 truncate + resync — 다음 세션 운영 작업
- `01-publisher-setup-job.yaml`에 `pglogical_repl` GRANT 추가 — 완료 (재시도 친화적)
- Subscriber Job manifest DSN password 노출 방지 개선 — 완료 (VERBOSITY=terse + stderr sed mask)
- Cloud VPN HA 구축 검토 — RDS subnet route 임시 해제 없이 진행 가능하도록
- Kyverno admission-controller의 정식 spot toleration 반영 — Goti-k8s values에 영구화
