---
title: "AWS 재기동에서 Harbor 폐기 — ECR로 이미지 레지스트리 갈아끼우기"
excerpt: "AWS 전체 재기동 중 Harbor PVC가 빈 볼륨으로 복구된 것을 발견하고, 재빌드 대신 ECR로 완전 전환했습니다. Terraform state import, SSM lifecycle, JWT 키 보존까지 2.5시간의 기록입니다."
category: kubernetes
tags:
  - go-ti
  - Multi-Cloud
  - AWS
  - ECR
  - Harbor
  - ImageRegistry
  - troubleshooting
series:
  name: "goti-multicloud"
  order: 9
date: "2026-04-19"
---

## 한 줄 요약

> AWS 측 인프라를 전체 재기동하던 중 Harbor PVC가 빈 볼륨으로 복구되어 이미지가 전부 사라졌습니다. 재빌드 대신 **ECR로 영구 전환**을 선택했고, 그 과정에서 Terraform state import, SSM 파라미터 lifecycle, JWT 키 보존까지 한꺼번에 정리했습니다.

## Impact

- **영향 범위**: AWS prod EKS 전체 (6개 v2 Go 서비스), 이미지 레지스트리 플랫폼
- **소요 시간**: 약 2.5시간 (2026-04-19 08:00 ~ 10:30 KST)
- **범위**: AWS prod 인프라 `terraform apply` (RDS 제외), Harbor 폐기 → ECR 전환
- **제약**: RDS `goti-prod-postgres` 보존, JWT 서명 키 cross-cloud 세션 호환 유지

---

## 🔥 문제: 비용 절감 후 재기동에서 만난 연속 장애

### 배경

2026-04-15 비용 절감을 위해 AWS 측 EKS 노드그룹 ASG를 0으로 내리고 ALB도 삭제한 상태였습니다. 시연이 1주일 남은 시점에 멀티클라우드 시연 목적으로 AWS 전체를 다시 띄워야 했습니다.

사전 조건이 까다로웠습니다.

- RDS `goti-prod-postgres`는 **보존**해야 합니다. Phase B pglogical subscription을 유지해야 하기 때문입니다.
- JWT 서명 키는 **AWS ↔ GCP 간 cross-cloud 세션 호환**을 위해 반드시 유지해야 합니다.
- 시연 범위라 운영 부담은 최소화합니다.

세션 중간에 **Harbor DB/이미지가 전량 초기화된 상태**를 발견했습니다. 이미지를 다시 push하기를 기다리는 대신 방향을 바꿔 **ECR로 전환**했습니다.

### Terraform state에서 시작된 연쇄

RDS는 destroy 이전에 보존했지만 `terraform.tfstate`에는 없었습니다. 그대로 `terraform apply`를 돌리면 create 충돌이 날 상태였습니다.

Import 대상은 5개였습니다.

- `module.rds.aws_db_instance.this` → `goti-prod-postgres`
- `module.rds.aws_db_parameter_group.this` → `goti-prod-pg16`
- `module.rds.aws_security_group.this` → `sg-0d0dde54608adeaed`
- `module.rds.aws_secretsmanager_secret.db` → ARN
- `module.rds.aws_secretsmanager_secret_version.db` → secret+version

Import 후 plan에서 3가지 치명적 drift를 확인했습니다.

1. `random_password.db`가 새로 생성되어 **RDS master password를 reset하려 시도**했습니다. 앱 연결이 깨질 수 있었습니다.
2. `engine_version`이 `"16"` → `"16.10"`으로 downgrade되려 했습니다.
3. `enable_pglogical_subscriber` 변수가 미선언되어 pglogical 파라미터가 제거될 뻔했습니다. Phase B subscription이 파괴될 수 있었습니다.

---

## 🤔 원인: destroy가 끝까지 지워주지 않았다

### destroy 루틴의 사각지대

세션 중 확인한 결과, `destroy.sh`가 완전하지 않았습니다. 실제로 남아있던 리소스는 다음과 같습니다.

- **SSM 파라미터 90+개**: `/prod/*` 경로 전체가 destroy되지 않고 그대로 남아있었습니다.
- **S3 버킷 4개**: `loki_chunks`와 `log_archive` payment/audit/error 버킷이 보존되어 있었습니다.
- **RDS SG ingress rule 2개**: AWS 상에 이미 존재했습니다.

이 상태에서 `terraform apply`를 돌리면 "already exists" 에러가 터지거나, state에만 없는 리소스 때문에 잘못된 drift가 잡혔습니다.

### Harbor PVC가 빈 볼륨으로 복구된 이유

Harbor를 재기동한 뒤 접속했을 때의 증상이었습니다.

- `admin` 로그인은 OK였고, healthy 응답도 정상이었습니다.
- `GET /api/v2.0/projects` 호출 결과 **`library`만 존재**했습니다. `prod` 프로젝트가 소실된 상태였습니다.
- `prod/goti-user` 등 이미지 repo가 전량 사라졌습니다.

원인은 Harbor PVC가 재생성 과정에서 빈 EBS 볼륨으로 바인딩된 것으로 추정됩니다. 2026-04-17 EBS 고아 121개 정리 때 볼륨이 함께 날아갔을 가능성이 높습니다.

### provider dependency가 만든 Phase 장벽

Kubernetes/helm provider가 EKS endpoint를 dependency로 잡고 있어서 **EKS가 없으면 `terraform plan` 자체가 실패**했습니다. 닭과 달걀 문제였습니다.

### JWT 키가 매 apply마다 새로 생성되던 구조

`tls_private_key.jwt_rsa`가 매 apply마다 새로 생성되는 구조였습니다. SSM에 새 값이 덮어쓰이면 cross-cloud 세션 호환이 깨집니다. GCP 측 토큰이 AWS 측 공개키로 검증되지 않는 상황이 발생합니다.

---

## ✅ 해결: lifecycle ignore_changes + Harbor 폐기 + ECR 전환

### Phase 0: RDS state import + lifecycle

3개 파일을 수정했습니다.

```hcl
# variables.tf
variable "rds_enable_pglogical_subscriber" {
  type    = bool
  default = true
}
```

```hcl
# main.tf (rds 모듈 호출)
module "rds" {
  # ...
  enable_pglogical_subscriber = var.rds_enable_pglogical_subscriber
}
```

```hcl
# modules/rds/main.tf
resource "aws_db_instance" "this" {
  # ...
  lifecycle {
    ignore_changes = [password, engine_version]
  }
}

resource "aws_secretsmanager_secret_version" "db" {
  # ...
  lifecycle {
    ignore_changes = [secret_string]
  }
}
```

`ignore_changes`를 걸어두면 state에는 새 값이 들어가도 AWS 실값은 보존됩니다. 이 패턴이 가장 깔끔합니다.

### Phase 1~4: provider stub으로 돌파

Kubernetes/helm provider 문제는 다음과 같이 해결했습니다.

1. `main.tf`의 provider 블록을 `https://localhost` stub으로 임시 치환합니다.
2. Phase 1~3을 진행합니다.
3. Phase 4 진입 전에 원래 provider 설정을 복원합니다.

Phase 2~3 중 추가로 발견한 리소스도 import했습니다.

- **S3 버킷 4개** (`loki_chunks` + `log_archive` payment/audit/error): state가 비어있어서 `terraform import`로 state에 연결했습니다.
- **RDS SG ingress rule 2개**: AWS에 이미 있어서 import했습니다.

### Phase 5: SSM 파라미터 lifecycle

90+개 파라미터가 남아있는 상황에서 첫 apply는 대부분 성공했지만 `pgbouncer_db_user_password`에서 `ParameterAlreadyExists` 에러가 발생했습니다.

실제 동작을 확인했습니다.

- 값 자체는 **AWS API가 overwrite를 거부해서 기존 값이 유지**되고 있었습니다. JWT 키 PEM diff를 떠서 `SAME`으로 확인했습니다.
- 단, Terraform state에는 93개 resource가 "created"로 등록되었습니다.

JWT 키를 반드시 보존해야 하므로 `modules/config/main.tf`에 lifecycle을 추가했습니다.

```hcl
resource "aws_ssm_parameter" "user_jwt_private_key" {
  # ...
  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "server_secure" {
  for_each = var.server_secure
  # ...
  lifecycle {
    ignore_changes = [value]
  }
}
```

나머지 pgbouncer 파라미터 4개를 import하고 full apply를 성공시켰습니다.

### Harbor → ECR 전환 (사용자 결정: B안)

선택지를 비교했습니다.

| 선택지 | 소요 시간 | 운영 부담 |
|---|---|---|
| A. Harbor 재빌드 + 이미지 재push (6개 서비스 × Goti-go CI) | 20~30분 | Harbor 자체 운영 부담 유지 |
| **B. Harbor 폐기, ECR 전환** | 20~30분 | 클라우드 네이티브 서비스로 영구 단순화 |

B를 선택했습니다. 같은 시간을 쓸 거라면 플랫폼 단순화까지 얻는 편이 낫다는 판단이었습니다.

전환 절차는 5단계였습니다.

1. ECR repo 6개를 생성합니다 (`goti-{user,ticketing,payment,resale,stadium,queue}-go`).
2. 기존 `goti-dev-github-actions-role` IAM trust에 `ressKim-io/Goti-go` 레포를 추가합니다 (OIDC).
3. Goti-go workflow를 수정합니다 (`cd-prod.yml`, `cd-ticketing-prod.yml`).
   - Harbor login을 `aws-actions/configure-aws-credentials` + `aws-actions/amazon-ecr-login`으로 교체합니다.
   - imagePullSecrets 제거 로직을 추가합니다. ECR은 EKS node IAM으로 인증되기 때문입니다.
4. Goti-k8s values 6개를 수정합니다 (PR #285). repository를 ECR URL로 변경하고 imagePullSecrets를 제거합니다.
5. Goti-go `deploy/prod` 브랜치에 push합니다. 6개 서비스가 병렬 빌드되어 3분 만에 ECR push를 마치고, 자동 태그 업데이트 PR(#286)이 올라옵니다.

### v2 Secret 구조 복구 (수동 28개)

v2 Go 앱이 기대하는 SSM 경로 `/prod/{svc}-go/*`가 **전체 서비스에서 없는 상태**였습니다. Java v1 구조(`/prod/server/*`, `/prod/{svc}/*`)만 존재했습니다.

수동으로 28개 SSM 파라미터를 생성했습니다.

```bash
USER_REDIS_URL / TICKETING_REDIS_URL / ...
  = rediss://default:{auth}@{host}:6379/0

*_JWT_PUBLIC_KEY_PEM
  = /prod/server/JWT_RSA_PUBLIC_KEY 복사

USER_JWT_PRIVATE_KEY_PEM
  = /prod/user/JWT_RSA_PRIVATE_KEY 복사

OAUTH / SMS = /prod/server/* 복사

TICKETING_QUEUE_TOKEN_SECRET
  = /prod/server/QUEUE_TOKEN_SECRET_KEY

TICKETING_TICKETING_QR_SECRET
  = tfvars 상수
```

이 28개는 수동 생성 상태라 다음 destroy-apply 때 또 날아갑니다. Terraform `modules/config/main.tf`에 v2 secret path를 선언하거나, chart의 `overridePath`를 활용해 `/prod/server` + `/prod/{svc}` 조합으로 통합해야 합니다.

### pgbouncer ↔ RDS password 불일치 복구

v2 앱 재기동 직후 다음 에러가 발생했습니다.

```
FATAL: password authentication failed for user "goti"
```

원인을 따라가봤습니다.

- RDS master password는 **`ignore_changes`로 원본이 유지**되어 있었습니다. 값은 `-bh||A%Qe0x^kK#,B*mvV7QM[E(K4FrR`였습니다.
- pgbouncer SSM `/prod/pgbouncer/db-user-password`는 apply 때 새 `random_password`로 덮어쓰여 있었습니다. 값은 `N<tvz9I|e2APMNtUc}Zxv(GKq-Go,N5]`였습니다.

복구 절차는 다음과 같습니다.

1. RDS master 값을 SSM에 역주입합니다.
2. `pgbouncer-secret` ExternalSecret을 force-sync합니다.
3. pgbouncer Deployment를 rollout restart합니다.

### ticketing-v2 Pending 해결

10 노드 전부에 `Insufficient cpu`가 찍혔습니다. ticketing base values의 `requests.cpu: 1000m × 2 replicas`가 원인이었습니다. Goti-k8s PR #287로 AWS 전용 축소를 반영했습니다. `replicaCount: 1`, `cpu: 300m`으로 내렸습니다.

---

## 🔍 최종 상태

| 카테고리 | 상태 |
|---|---|
| EKS (`goti-prod`, 1.34, 10 노드) | Ready |
| ALB `goti-prod-alb` | active |
| RDS `goti-prod-postgres` | available (JWT 키 보존 확인) |
| ElastiCache `goti-prod-redis` | available |
| SSM Parameters (97개 + 수동 28개) | 동기화 완료 |
| ArgoCD / Istio / ESO / cert-manager | Healthy |
| Harbor | 폐기 (registry로 미사용) |
| v2 Go 6서비스 | 전부 2/2 Running (user/ticketing/payment/resale/stadium/queue) |

v1 Java 앱 등 Unhealthy로 남은 앱들(guardrail/queue-gate/load-observer/mouse-macro/security-dashboard/v1 Java/opencost)은 이번 시연 범위 밖이라 사용자 확인 하에 무시했습니다.

---

## 📚 배운 점

### destroy.sh를 끝까지 믿지 않는다

이번 세션에서 **destroy가 완전하지 않다**는 사실을 실측으로 확인했습니다. SSM 90개, S3 4개, RDS SG rule 2개가 실제로 삭제되지 않고 남아있었습니다.

이 상태에서 apply를 돌리면 두 가지 문제가 생깁니다. 첫째, "already exists" 에러가 터집니다. 둘째, state에만 없는 리소스가 잘못된 drift로 잡혀 엉뚱한 변경이 일어납니다.

destroy 루틴에 강제 삭제를 추가하거나, 재기동 시 import를 루틴화해야 합니다.

### Harbor 자체의 운영 부담

Harbor PVC가 예상대로 보존되지 않은 사건은 플랫폼 선택 자체를 돌아보게 만들었습니다. PV/PVC 재바인딩이 원하는 대로 동작하지 않았고, Harbor는 그 자체로 운영 대상이었습니다.

ECR 같은 클라우드 네이티브 서비스는 backup/restore, 접근 제어, 가용성을 AWS가 책임집니다. 시연 목적 환경에서 운영 부담을 하나라도 줄이는 쪽이 합리적이었습니다.

### `tls_private_key` + `ignore_changes` 조합

JWT 키처럼 한 번 생성되면 영구 보존해야 하는 값은 **`tls_private_key` + `ignore_changes` 조합**이 가장 깔끔합니다.

- State에는 매 apply마다 새 키가 들어갑니다.
- AWS 실값은 `ignore_changes`로 보존됩니다.
- 앱은 기존 키로 계속 토큰을 검증할 수 있습니다.

다음부터는 개별 rotation 스크립트로 의도적으로 갱신하는 설계를 고려하고 있습니다.

### v1/v2 SSM 네이밍 파편화

Java 네이밍(`DATASOURCE_*`)과 Go 네이밍(`USER_*`)의 이중 구조가 이번 장애의 뿌리 중 하나였습니다. chart의 `overridePath` 패턴으로 `/prod/server`와 `/prod/{svc}`를 합성해 수렴시켜야 합니다.

### 남은 작업 (TODO)

- Terraform에서 이번 세션에 수정한 4개 파일을 PR로 정리합니다.
- v2 SSM path 28개를 `modules/config/main.tf`에 선언하거나 `overridePath`로 통합합니다.
- Grafana Multi-Cloud Compare 대시보드에 AWS 쪽 메트릭이 들어오는지 검증합니다.
- 전체 검증이 끝나면 `.claude/rules/_TEMPORARY-OVERRIDE-aws-bringup.md`를 삭제합니다.
