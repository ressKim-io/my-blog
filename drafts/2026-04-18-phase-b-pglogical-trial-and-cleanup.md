# 2026-04-18 Phase B pglogical subscriber 시도 + 전체 cleanup

- 세션 기간: 2026-04-18 15:10 ~ 17:20 KST (약 2시간 10분)
- 목표: ADR-0018 Phase B — GCP pg-primary → AWS RDS pglogical subscription 구성
- 관련 ADR: [0018](../adr/0018-multicloud-db-replication-technology.md), [0019](../adr/0019-db-active-passive-with-read-split.md), [0020](../adr/0020-db-failback-reverse-replication.md)
- 선행 dev-log: [2026-04-18-db-cloud-sql-to-pg-primary-vm.md](2026-04-18-db-cloud-sql-to-pg-primary-vm.md) (Phase A, 같은 날 오전)

## 1. 초기 상황 / 전제

- Phase A 완료 상태: GCP pg-primary VM (10.2.3.218) 운영 중, Cloud SQL 해지됨
- AWS EKS ASG=0 (비용 절감 목적 팀원이 전에 scale down), RDS/EKS control plane/NAT gateway 등 나머지는 가동 중
- 사용자 요청: "AWS 기동 저녁 예정이지만, 미리 할 수 있는 부분까지 해보자 → 결국 수평 통째로 시도" 로 진행

## 2. 사전 준비 (AWS 없이 완료된 코드)

### 2.1 P1: publisher 설정 Job
- `infra/ops/phase-b-pglogical/01-publisher-setup-job.yaml` 작성
- GCP 쪽 pg-primary 에 `pglogical.create_node(goti_gcp_primary)` + `replication_set_add_all_tables` (6 schema, 41 tables) + sequences
- **실행 결과**: 성공. Replication set `default` 에 41 테이블 등록 + 0 sequences (UUID PK 기반이라 정상)

### 2.2 P2: AWS RDS parameter group Terraform
- `prod-aws/modules/rds/` 에 `enable_pglogical_subscriber` flag 추가 (dynamic block)
- `shared_preload_libraries=pglogical` (pending-reboot), `rds.logical_replication=1` (pending-reboot), `default_transaction_read_only=on` (immediate)
- 루트 `variables.tf` 에 `rds_enable_pglogical_subscriber` 변수 추가

### 2.3 P3: AWS subscription Job
- `02-aws-subscriber-setup-job.yaml`: `CREATE EXTENSION pglogical` + `create_node` + `create_subscription`
- DSN 에 GCP 외부 IP (34.64.74.209) 직결, TLS `sslmode=require`
- master / GCP replication password 를 K8s Secret 에서 env 주입

### 2.4 P4: Failover/Failback runbook
- `docs/runbooks/db-failover-failback.md` 작성
- 수동 promote 절차, 시퀀스 드리프트 보정 (+1000 margin), split-brain 방어 가이드

## 3. 실 실행에서 만난 장애물 11개 (시간 순)

### 3.1 AWS NAT egress IP 확인
- `aws ec2 describe-nat-gateways` → `15.164.8.237`
- Terraform `tfvars` 의 `pg_primary_allowed_ingress_cidrs` 를 `["15.164.8.237/32"]` 로 업데이트 → `terraform apply -target=module.pg_primary`
- 1 firewall rule 추가 성공 (`google_compute_firewall.pg_external[0]`)

### 3.2 AWS RDS parameter group 적용 — Terraform drift 회피
- `terraform plan -target=module.rds` 에 **foundation/eks/kms 등 기존 drift** 도 함께 포함됨 (-target semantics 제약)
- 무관 변경과 섞이는 위험 → **Terraform 대신 `aws rds modify-db-parameter-group` 으로 직접 수정**
- Terraform tfvars 는 `rds_enable_pglogical_subscriber=true` 로 기록 (다음 전체 apply 시 state 동기화 예정)
- **교훈**: 대규모 drift 가 있는 환경에서 `-target` 은 불완전. CLI 수동 + tfvars 동기화가 현실적

### 3.3 RDS 재시작 승인 프로세스
- `aws rds reboot-db-instance` — hook 이 "prod DB reboot 은 명시 승인 필요" 로 1차 차단
- 사용자 "응 재시작 하자" → 재실행 → 44초 완료
- **교훈**: cloud-cli-safety 규칙상 RDS reboot 도 파괴적 action 으로 분류. 매번 개별 승인

### 3.4 AWS EKS 접근 시 master credential 준비
- AWS 쪽 `goti-db-master-cred` K8s Secret 없음 (이름 다름, `goti-postgresql-auth` 등)
- Terraform 이 만든 `goti-prod/rds/master-password` (AWS Secrets Manager) 에서 stdin pipe 로 K8s Secret `rds-master-cred` 생성 (transcript 노출 없이)
- **기록**: password 는 프로세스 간 stdin 파이프만 이용. `--from-literal` 대신 `--from-file=/dev/stdin` 사용

### 3.5 EKS ASG scale up 경로 (Spot 선택 → 역효과)
- 초기 Spot nodegroup 1 node 만 scale up 시도 — 비용 절약 목적
- Hook 이 "prod scale change 건별 승인" 으로 차단 → 사용자 명시 승인
- Node join 성공. 그러나 **Spot node 에 `node-role=spot:NoSchedule` taint** 있었음

### 3.6 Cascade 1: Kyverno admission-controller Pending (taint)
- Kyverno 가 기본적으로 toleration 없어 spot taint 에 schedule 불가
- Kyverno webhook 이 없어서 Job apply 도 실패 (`failed calling webhook "validate.kyverno.svc-fail"`)
- 사용자가 직접 `kubectl patch deployment kyverno-admission-controller` 로 spot toleration 추가 → admission Running

### 3.7 Cascade 2: Istio sidecar-injector webhook (label 요구)
- Job apply 시도 → `failed calling webhook "namespace.sidecar-injector.istio.io": no endpoints available for service istiod`
- 원인: `sidecar.istio.io/inject: "false"` 를 **annotation** 에만 넣었음 → `objectSelector` 는 **label** 기준
- Job template `metadata.labels` 에 `sidecar.istio.io/inject: "false"` 추가 (v3)
- **교훈**: Istio webhook 은 annotation 이 아닌 label 로 필터링. 두 곳 모두 지정 필수

### 3.8 Cascade 3: Kyverno validate-probes 정책 위반
- Job pod 에 `livenessProbe` / `readinessProbe` 없음 → `resource Pod blocked due to policies require-pod-probes`
- 각 container 에 `pg_isready` 기반 probe 추가 (v4)

### 3.9 Cascade 4: Pod 가 spot taint tolerate 안 함
- 우리 Job 도 `tolerations` 빠져있어서 spot node 에 schedule 안 됨 (v4→v5 에서 추가)

### 3.10 Cascade 5: CoreDNS 도 Pending → DNS resolution 실패
- CoreDNS 도 spot toleration 없음 → spot 에 스케줄 안 됨
- Subscriber Job 이 `goti-prod-postgres.cjqcoy2ce8go.ap-northeast-2.rds.amazonaws.com` 해석 불가 → error
- **Cascade 끝이 안 보임** 판단 → Spot 포기, Core nodegroup 전환

### 3.11 Core nodegroup scale up → 1 node 로는 부족 (CPU 103%)
- Core t3.large 1 node 에 ArgoCD 관리 goti-* app + system pod 45개 몰림
- Kyverno admission (100m 요청) 들어갈 공간 없음 → 재 Pending
- **해결**: 사용자 지시 "그냥 원래 10개 전부 다 올려" → core=5, spot=5 (10 node)
- system pod 들 자동 분산 → Kyverno/Istiod/CoreDNS 정상화

### 3.12 `default_transaction_read_only=on` 이 CREATE EXTENSION 도 막음
- `ERROR: cannot execute CREATE EXTENSION in a read-only transaction`
- Subscriber Job SQL 에 세션 레벨 `SET default_transaction_read_only = off;` 추가 (v8)

### 3.13 RDS subnet default route 부재 (핵심 네트워크 이슈)
- v8 subscription 생성 시 `connection to server at "34.64.74.209", port 5432 failed: timeout expired`
- 디버그: AWS EKS pod 에서 `nc` 테스트 성공 → **AWS RDS 가 outbound 불가**
- 원인 확인: RDS subnet 3개 (`subnet-049bb00ab01f77a3b`, `subnet-022a9ad3513aaca2f`, `subnet-0a77f5c8b064e4d94`) route table 에 `0.0.0.0/0` 없음. VPC 내부 (10.1.0.0/16) 만 라우팅
- **AWS 기본 설계**: RDS private subnet 은 외부 outbound 를 의도적으로 차단 (보안)
- 사용자 결정: "임시 해제하고 진행 + 끝나면 되돌리기"
- 3개 route table 에 `aws ec2 create-route --destination-cidr-block 0.0.0.0/0 --nat-gateway-id nat-079325a73e2de77fc` 추가
- **Cleanup 때 반드시 삭제 필요** (Task-21 으로 관리)

### 3.14 pglogical schema 권한 부재
- v9 에서 connection 성공했지만 `permission denied for schema pglogical`
- Subscriber 가 provider 의 `pglogical.node` / `replication_set` 조회 필요
- GCP pg-primary VM 에서 추가 GRANT:
  - `GRANT USAGE ON SCHEMA pglogical TO pglogical_repl`
  - `GRANT SELECT ON ALL TABLES IN SCHEMA pglogical TO pglogical_repl`
  - `ALTER DEFAULT PRIVILEGES IN SCHEMA pglogical GRANT SELECT ON TABLES TO pglogical_repl`
  - `GRANT pg_read_all_data TO pglogical_repl`
- 수행 Job: `pglogical-repl-grants-20260418` (GCP context)
- **향후 재적용**: `infra/ops/phase-b-pglogical/01-publisher-setup-job.yaml` 에 GRANT 추가 필요 (다음 세션 PR)

### 3.15 Password plaintext 노출 (보안 이슈)
- v8~v10 의 `create_subscription` 에러 메시지에 DSN 전체 출력됨
- `host=... user=pglogical_repl password=6S3Nhf93eYGiPeroCbGzJCN38lfmJNGW sslmode=require`
- PostgreSQL connection 실패 시 DSN 을 에러 메시지에 포함하는 기본 동작
- **사후 조치 필요**: `goti-prod-pg-primary-replication-password` Secret Manager 에서 새 version 생성 + VM `ALTER USER pglogical_repl WITH PASSWORD` + AWS K8s Secret 업데이트
- Loki 로 archive 됐는지 확인 필요 (현재 AWS monitoring 재기동 직후라 미확인)

## 4. 최종 v10 Subscription 성공

```
NOTICE: subscription created — initial sync started
=== nodes ===
 goti_aws_subscriber
 goti_gcp_primary
=== replication sets received ===
 sub_from_gcp_primary | {default}
```

## 5. Initial sync 결과 (monitor v2, 20분 loop)

### 5.1 복제 성공 테이블

| 테이블 | GCP baseline | AWS 최종 | 판정 |
|---|---|---|---|
| stadium_service.baseball_teams | 10 | 10 | ✅ 완벽 |
| ticketing_service.seats | 200,121 | 200,121 | ✅ 완벽 |
| user_service.users | 1,036,569 | 1,036,530 | 🟡 99.996% (39 row gap) |

### 5.2 정합성 문제 (Phase B 범위 외 운영 이슈)

| 테이블 | GCP baseline | AWS 최종 | 차이 |
|---|---|---|---|
| ticketing_service.orders | 738,747 | 750,606 | **+11,859 (AWS 초과)** |
| payment_service.payments | 738,020 | 749,460 | **+11,440 (AWS 초과)** |

**원인 추정**: AWS RDS 에 Cloud SQL 시대 이전의 과거 prod 데이터 잔재. pglogical initial sync 가 PK 충돌로 해당 테이블 skip 또는 unique violation 로 멈춤.

**후속 조치 (운영 작업)**:
1. AWS 쪽 orders/payments truncate
2. `SELECT pglogical.alter_subscription_resynchronize_table('sub_from_gcp_primary', 'ticketing_service.orders');` 같은 재동기화
3. 또는 subscription drop + create (synchronize_data=true, 전체 재sync)

## 6. Cleanup 실행 (사용자 지시 "끝나면 되돌려")

### 6.1 완료된 cleanup
- RDS subnet 3개 임시 NAT route 삭제 (`aws ec2 delete-route`) → 보안 원복 완료
- AWS EKS core nodegroup `minSize=0,desiredSize=0,maxSize=1` 축소
- AWS EKS spot nodegroup `minSize=0,desiredSize=0,maxSize=1` 축소
- `phase-b-critical` PriorityClass 삭제
- 임시 Job 10+ 개 삭제 (AWS + GCP)

### 6.2 미완료 (후속 필요)
- ~~**EC2 instance 1개 잔존**: `i-059ab868bec6b0b61`~~ → **2026-04-18 저녁 자연 정리 확인**. ASG desired=0 으로 축소된 뒤 ASG 가 유휴 인스턴스를 자동 terminate 한 것으로 추정. `describe-instances` 결과 Reservations=[].
- **pglogical_repl password rotation**: v8~v10 에러 로그 노출. 사용자 결정 후 진행
- **orders/payments 정합성 복구**: 다음 세션 운영 작업
- **Kyverno admission-controller spot toleration patch**: 사용자가 수동 추가한 patch. ArgoCD sync 로 원복될 것 (지금은 AWS down 상태라 미확인)

## 7. 남은 수동 변경 기록 (Terraform state 밖)

| 변경 | 위치 | 원복 필요 여부 |
|---|---|---|
| RDS parameter group `goti-prod-pg16` 의 pglogical 3-param 추가 | AWS RDS | Terraform `rds_enable_pglogical_subscriber=true` tfvars 로 코드 동기화됨. 다음 apply 시 합치됨 |
| RDS subnet 3개 route table 에 NAT route 추가 → 삭제 완료 | AWS VPC | ✅ 이미 원복 |
| Kyverno admission-controller spot toleration patch | AWS EKS | ArgoCD sync 자동 원복 예정 |
| `gcp-pglogical-repl-cred` K8s Secret (AWS) | AWS EKS goti ns | Phase B 재시도 시 재사용. 유지 OK |
| `rds-master-cred` K8s Secret (AWS) | AWS EKS goti ns | Phase B 재시도 시 재사용. 유지 OK |
| GCP pg-primary `pglogical_repl` 사용자에 `pglogical schema USAGE/SELECT + pg_read_all_data` GRANT | GCP pg-primary VM | 유지 (subscription 이 의존). 재시도 시 필요 |
| AWS pglogical subscription `sub_from_gcp_primary` + local node `goti_aws_subscriber` | AWS RDS | 미정 (Phase B 정합성 복구 시 drop + create) |

## 8. 비용 / 시간

- 작업 시간: 약 2시간 10분 (15:10~17:20 KST)
- AWS 추가 비용: EKS 10 node × t3.large × 약 40분 + EC2 1 node 잔존 (정리 중)
- 추정 합계: **$3~5**
- GCP 추가 비용: 0 (기존 VM 만 사용)

## 9. 교훈

1. **spot taint cascade 의 위험성**: Kyverno/Istio/CoreDNS 등 system pod 가 toleration 없으면 spot 에 안 뜸. cascade 해결 대신 core 로 전환이 빠름
2. **-target Terraform 의 한계**: 기존 drift 환경에서는 unwanted 변경이 섞임. CLI 수동 수정 + tfvars 동기화가 더 안전
3. **RDS 외부 outbound 는 기본 차단**: VPC private subnet 의 명시적 default route 필요. 보안 설계 의도
4. **Istio webhook objectSelector 는 label 기준**: annotation 만으로는 매칭 안 됨
5. **PostgreSQL connection 실패 시 DSN 노출**: 에러 메시지에 password 포함되어 로그 유출. DSN 을 `postgres://` URL 외 다른 방식 (passfile, SET 분리) 으로 구성 고려
6. **AWS RDS 잔재 데이터 이슈**: Cloud SQL 시대 이전 데이터가 `orders/payments` 에 남아있었음. Phase B 재시도 전 truncate 필요
7. **PDB 는 scale-to-zero 차단**: coredns/ebs-csi-controller 가 PDB minAvailable=1 이라 마지막 node terminate 안 됨. 강제 terminate 필요

## 10. 후속 작업 체크리스트

- [x] EC2 instance `i-059ab868bec6b0b61` 강제 terminate ← ASG desired=0 전환 후 자연 정리됨 (04-18 저녁)
- [x] `pglogical_repl` password rotation (보안) ← 04-18 저녁 완료. Secret Manager v2 enabled, v1 destroyed. pg-primary VM `ALTER USER` + 새 비밀번호 로그인 검증 성공. `infra/ops/phase-b-pglogical/03-rotate-pglogical-repl-password-job.yaml` 추가. AWS K8s Secret `gcp-pglogical-repl-cred` 도 v2 값으로 갱신 완료 (SHA256 match). **AWS 재기동 당일 남은 TODO**: subscription drop + recreate (새 비밀번호 주입) + orders/payments resync.
- [ ] `orders / payments` AWS 쪽 과거 데이터 truncate + resync
- [x] `01-publisher-setup-job.yaml` 에 pglogical_repl GRANT 추가 (재시도 친화적) ← 04-18 완료
- [x] Subscriber Job manifest 에 DSN password 노출 방지 개선 ← 04-18 완료 (VERBOSITY=terse + stderr sed mask, pre-flight pg_isready 추가)
- [ ] 장기 Phase B 운영 전 Cloud VPN HA 구축 검토 (RDS subnet route 임시 해제 없이 진행 가능)
- [ ] Phase B 운영 시작 시 Kyverno admission 의 정식 toleration (Goti-k8s values 에 영구 반영)
