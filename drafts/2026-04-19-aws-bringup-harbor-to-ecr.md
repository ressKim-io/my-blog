# 2026-04-19 AWS 전체 재기동 + Harbor → ECR 마이그레이션

- 세션 기간: 2026-04-19 08:00 ~ 10:30 KST (약 2.5시간)
- 범위: AWS prod 인프라 Terraform apply (RDS 제외), Harbor 이미지 레지스트리 폐기 → ECR 전환
- 관련 메모리: `project_aws_cost_freeze_gcp_only` (해제), `feedback_no_cost_action_without_approval`
- 관련 PR:
  - Goti-go [#8](https://github.com/ressKim-io/Goti-go/pull/8) — CI Harbor → ECR
  - Goti-k8s [#285](https://github.com/Team-Ikujo/Goti-k8s/pull/285) — v2 values repository 전환
  - Goti-k8s [#286](https://github.com/Team-Ikujo/Goti-k8s/pull/286) — 자동 이미지 태그 업데이트
  - Goti-k8s [#287](https://github.com/Team-Ikujo/Goti-k8s/pull/287) — ticketing-v2 AWS 리소스 축소
  - Goti-Terraform (TBD) — RDS import lifecycle + JWT 보존

## 1. 배경

2026-04-15 비용 절감을 위해 AWS 측 EKS 노드그룹 ASG 0 / ALB 삭제 상태. 시연 1주일 남았고 멀티클라우드 시연 목적으로 AWS 전체 재기동 필요.

사전 조건:
- RDS `goti-prod-postgres` 는 **보존** (Phase B pglogical subscription 유지 필요)
- JWT 서명 키는 **AWS ↔ GCP 간 cross-cloud 세션 호환**을 위해 유지 필수
- 시연 범위라 운영 부담 최소화

세션 중간에 **Harbor DB/image 전량 초기화** 발견 → 이미지 재push 대기 대신 **ECR 전환**으로 방향 변경.

## 2. Phase 별 진행

### Phase 0: RDS state import + lifecycle

RDS 는 destroy 이전에 보존했으나 `terraform.tfstate` 에는 없음. `terraform apply` 시 create 충돌 위험.

Import 대상 5개:
- `module.rds.aws_db_instance.this` → `goti-prod-postgres`
- `module.rds.aws_db_parameter_group.this` → `goti-prod-pg16`
- `module.rds.aws_security_group.this` → `sg-0d0dde54608adeaed`
- `module.rds.aws_secretsmanager_secret.db` → ARN
- `module.rds.aws_secretsmanager_secret_version.db` → secret+version

Import 후 plan 에 3 가지 치명적 drift 확인:
1. `random_password.db` 새로 생성 → **RDS master password reset 시도** (앱 연결 깨짐)
2. `engine_version "16" → "16.10"` downgrade 시도
3. `enable_pglogical_subscriber` variable 미선언 → pglogical 파라미터 제거 시도 (Phase B subscription 파괴)

대응 (3 파일):
- `variables.tf`: `rds_enable_pglogical_subscriber` 변수 추가
- `main.tf`: rds 모듈 호출에 pass-through
- `modules/rds/main.tf`: `aws_db_instance.this` 에 `lifecycle { ignore_changes = [password, engine_version] }`, `aws_secretsmanager_secret_version.db` 에 `ignore_changes = [secret_string]`

### Phase 1~4: Foundation → EKS → Compute → Bootstrap

Kubernetes / helm provider 가 EKS endpoint 를 dependency 로 잡아 **EKS 없이는 terraform plan 자체 실패**. 해결: `main.tf` 의 provider 블록을 `https://localhost` stub 으로 임시 치환 → Phase 1~3 진행 → Phase 4 전 복원.

Phase 2~3 중 발견:
- **S3 버킷 4개 (loki_chunks + log_archive payment/audit/error) 기존 보존** — terraform state 비어있음. `terraform import` 로 state 연결.
- **RDS SG ingress rule 2개** 이미 AWS 에 존재 → import.

### Phase 5: Config (SSM 파라미터)

SSM `/prod/*` 경로에 **90+ 파라미터 destroy 되지 않은 채 남아있음**. 첫 apply 는 대부분 성공했지만 `pgbouncer_db_user_password` 에서 `ParameterAlreadyExists` 에러.

상세 확인:
- 실제 값은 **AWS API 가 overwrite 거부해서 기존 값 유지** (JWT 키 PEM diff → `SAME` 확인). 단 terraform state 에는 93개 resource 가 "created" 로 등록됨.
- **JWT RSA key pair** 는 `tls_private_key.jwt_rsa` 가 매 apply 마다 새로 생성됨 → SSM 에 새 값이 덮어쓰이면 cross-cloud 세션 호환 깨짐. 대응: `modules/config/main.tf` 의 `aws_ssm_parameter.user_jwt_private_key` 및 `aws_ssm_parameter.server_secure` for_each 에 `lifecycle { ignore_changes = [value] }` 추가.

나머지 pgbouncer 파라미터 4개 import → full apply 성공.

### Harbor 방향 전환

Harbor 재기동 후 접속 시:
- `admin` 로그인 OK, `healthy` 응답
- `GET /api/v2.0/projects` → **`library` 만 존재**. `prod` 프로젝트 소실
- `prod/goti-user` 등 이미지 repo 전량 사라짐

원인 추정: Harbor PVC 가 재생성 과정에서 빈 EBS 볼륨으로 bind. 2026-04-17 EBS 고아 121개 정리 때 날아갔을 가능성.

선택지:
- A. Harbor 재빌드 + 이미지 재push (6개 서비스 × Goti-go CI): 20~30분
- B. **Harbor 폐기, ECR 전환**: 20~30분 + 영구적 플랫폼 단순화

사용자 결정: **B**.

### Harbor → ECR 전환

1. ECR repo 6개 생성 (`goti-{user,ticketing,payment,resale,stadium,queue}-go`)
2. 기존 `goti-dev-github-actions-role` IAM trust 에 `ressKim-io/Goti-go` 레포 추가 (OIDC)
3. Goti-go workflow 수정 (cd-prod.yml, cd-ticketing-prod.yml):
   - Harbor login → `aws-actions/configure-aws-credentials` + `aws-actions/amazon-ecr-login`
   - imagePullSecrets 제거 로직 (ECR 은 EKS node IAM 으로 인증)
4. Goti-k8s values 6개 수정 (PR #285): repository → ECR URL, imagePullSecrets 제거
5. Goti-go deploy/prod 브랜치 push → 6개 서비스 병렬 빌드 3분 → ECR push → 자동 tag 업데이트 PR #286

### v2 Secret 구조 복구

v2 Go 앱이 기대하는 SSM 경로 `/prod/{svc}-go/*` 가 **전체 서비스에서 없음**. Java v1 구조 (`/prod/server/*`, `/prod/{svc}/*`) 만 존재.

수동 생성 28개 SSM 파라미터:
- `USER_REDIS_URL` / `TICKETING_REDIS_URL` / ... = `rediss://default:{auth}@{host}:6379/0`
- `*_JWT_PUBLIC_KEY_PEM` = `/prod/server/JWT_RSA_PUBLIC_KEY` 복사
- `USER_JWT_PRIVATE_KEY_PEM` = `/prod/user/JWT_RSA_PRIVATE_KEY` 복사
- OAUTH/SMS = `/prod/server/*` 복사
- `TICKETING_QUEUE_TOKEN_SECRET` = `/prod/server/QUEUE_TOKEN_SECRET_KEY`
- `TICKETING_TICKETING_QR_SECRET` = tfvars 상수

**TODO**: 이 28개는 수동 생성 상태. 다음 destroy-apply 때 또 날아감 → Terraform `modules/config/main.tf` 에 v2 secret path 선언 필요 (또는 chart 의 `overridePath` 활용해서 `/prod/server` + `/prod/{svc}` 조합으로 통합).

### pgbouncer ↔ RDS password 불일치

v2 앱 재기동 직후 `FATAL: password authentication failed for user "goti"`.

원인:
- RDS master password 는 **ignore_changes 로 원본 유지** → `-bh||A%Qe0x^kK#,B*mvV7QM[E(K4FrR`
- pgbouncer SSM `/prod/pgbouncer/db-user-password` 는 apply 때 새 `random_password` 로 덮임 → `N<tvz9I|e2APMNtUc}Zxv(GKq-Go,N5]`

복구: RDS master 값을 SSM 에 역주입, `pgbouncer-secret` ExternalSecret force-sync, pgbouncer Deployment rollout restart.

### ticketing-v2 Pending

10 노드 전부 `Insufficient cpu` (ticketing base values: `requests.cpu: 1000m × 2 replicas`). Goti-k8s PR #287 로 AWS 전용 축소 — replicaCount: 1, cpu: 300m.

## 3. 최종 상태

| 카테고리 | 상태 |
|---|---|
| EKS (`goti-prod`, 1.34, 10 노드) | Ready |
| ALB `goti-prod-alb` | active |
| RDS `goti-prod-postgres` | available (JWT 키 보존 확인) |
| ElastiCache `goti-prod-redis` | available |
| SSM Parameters (97개 + 수동 28개) | 동기화 완료 |
| ArgoCD / Istio / ESO / cert-manager | Healthy |
| Harbor | 폐기 (registry 로 미사용) |
| v2 Go 6서비스 | 전부 2/2 Running (user/ticketing/payment/resale/stadium/queue) |

**사용자 확인**: v1 Java 앱 등 Unhealthy 남은 앱들 (guardrail/queue-gate/load-observer/mouse-macro/security-dashboard/v1 Java/opencost) 은 **이번 시연 범위 밖**이라 무시 OK.

## 4. 남은 작업 (TODO)

1. **Terraform 반영 commit/PR** — 이 세션에서 수정한 4개 파일을 PR 로 정리
2. **v2 SSM path IaC 반영** — 28개 파라미터를 `modules/config/main.tf` 에 선언 (또는 `overridePath` 로 `/prod/server` + `/prod/{svc}` 통합)
3. **AWS 메트릭 수집 확인** — Grafana Multi-Cloud Compare 대시보드에 AWS 쪽 데이터 수집되는지 검증
4. **TEMP override 파일 복원** — `.claude/rules/_TEMPORARY-OVERRIDE-aws-bringup.md` 삭제 (전체 검증 완료 후)

## 5. 교훈

- **destroy.sh 가 완전하지 않다** — SSM 90개, S3 4개, RDS SG rule 2개가 실제로 삭제 안 되고 남아있었음. destroy 루틴에 강제 삭제 추가 필요.
- **Harbor PVC 보존 실패** — PV/PVC 재바인딩이 예상대로 안 됨. Harbor 자체가 운영 부담이라 ECR 같은 클라우드 native 서비스가 더 안전.
- **tls_private_key + ignore_changes 조합이 가장 깔끔** — state 에는 매번 새 키가 들어가지만 AWS 실값은 보존. 다음부터 개별 rotation 스크립트 고려.
- **v1/v2 SSM 네이밍 파편화** — Java 네이밍 (`DATASOURCE_*`) 과 Go 네이밍 (`USER_*`) 의 이중 구조는 chart `overridePath` 패턴으로 수렴 필요.
