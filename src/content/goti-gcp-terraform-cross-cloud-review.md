---
title: "GCP Terraform 코드 리뷰: CRITICAL 보안 이슈부터 Cross-Cloud 호환성까지"
excerpt: "팀원의 GCP Terraform PR을 리뷰하며 발견한 GKE Master API 전체 개방, PGPASSWORD 버그, 그리고 K8s manifest AWS 하드코딩 문제"
category: kubernetes
tags:
  - go-ti
  - Terraform
  - GCP
  - GKE
  - Cross-Cloud
  - Code-Review
  - Security
  - Infrastructure-as-Code
date: "2026-04-04"
---

## 🎯 한 줄 요약

> GCP Terraform PR에서 **GKE Master API 전체 개방**, **PGPASSWORD 인증 버그**, **비밀번호 평문 노출** 등 CRITICAL 3건을 포함해 총 9건을 수정했고, K8s manifest가 AWS 전용으로 하드코딩되어 있어 GCP 배포에는 추가 작업이 필요합니다.

---

## 📊 리뷰 대상 개요

팀원(xaczxzz)의 GCP Terraform PR을 리뷰했습니다.
대상 커밋은 `2a7277c`, 브랜치는 `fix/gcp-terraform-hardening`입니다.

AWS에서 운영 중인 go-ti 인프라를 GCP에도 구축하기 위한 Terraform 코드입니다.
총 9개 모듈로 구성되어 있습니다.

| 모듈 | 역할 |
|------|------|
| `network` | VPC, 서브넷, Cloud NAT, PSA |
| `gke` | GKE 클러스터, Workload Identity SA |
| `compute` | Core/Spot 노드 풀 |
| `database` | Cloud SQL PostgreSQL 16 + Memorystore Redis 7 |
| `kms` | Cloud KMS KeyRing + CryptoKey |
| `storage` | GCS 버킷 (Mimir, Loki) |
| `registry` | Artifact Registry (Docker) |
| `config` | GCP Secret Manager |
| `bootstrap` | Istio + ESO + ArgoCD (Helm) |

모듈 구조 자체는 AWS Terraform과 일관성 있게 잘 분리되어 있었습니다.
네트워크, 컴퓨팅, 데이터베이스, 보안, 부트스트랩으로 레이어가 명확하게 나뉘어 있습니다.

문제는 **세부 설정**에 있었습니다.

---

## 🔴 CRITICAL: 이건 prod에 올라가면 안 된다

CRITICAL 이슈 3건을 발견했습니다.
모두 **보안에 직접적인 영향**을 주는 문제입니다.

### 1. GKE Master API가 전 세계에 열려 있다

리뷰하다가 `master_authorized_networks_config`를 보고 멈췄습니다.

**Before:**

```hcl
master_authorized_networks_config {
  cidr_blocks {
    cidr_block   = "0.0.0.0/0"
    display_name = "All"
  }
}
```

`0.0.0.0/0`이면 **인터넷의 모든 IP**에서 GKE Master API에 접근할 수 있다는 뜻입니다.

이것이 왜 위험한지 생각해보겠습니다.
GKE Master API는 `kubectl` 명령이 도달하는 엔드포인트입니다.
여기에 접근할 수 있으면 클러스터의 모든 리소스를 조회하고, 수정하고, 삭제할 수 있습니다.
물론 RBAC 인증이 있지만, **공격 표면 자체를 줄이는 것이 첫 번째 방어선**입니다.

GKE는 EKS와 달리 Master API가 Public IP로 노출되는 것이 기본입니다.
그래서 `master_authorized_networks_config`로 접근 가능한 IP를 제한하는 것이 **필수**입니다.

**After:**

```hcl
variable "master_authorized_networks" {
  description = "GKE Master API에 접근 가능한 CIDR 목록"
  type = list(object({
    cidr_block   = string
    display_name = string
  }))
}

master_authorized_networks_config {
  dynamic "cidr_blocks" {
    for_each = var.master_authorized_networks
    content {
      cidr_block   = cidr_blocks.value.cidr_block
      display_name = cidr_blocks.value.display_name
    }
  }
}
```

`dynamic` 블록으로 변경하고, CIDR 목록을 변수로 뺐습니다.
환경별 `tfvars`에서 허용할 IP 대역만 명시적으로 지정하면 됩니다.

```hcl
# prod.tfvars
master_authorized_networks = [
  {
    cidr_block   = "10.0.0.0/8"
    display_name = "Internal VPC"
  },
  {
    cidr_block   = "203.0.113.50/32"
    display_name = "Office VPN"
  }
]
```

이렇게 하면 VPC 내부와 사무실 VPN에서만 `kubectl`을 실행할 수 있습니다.

---

### 2. PGPASSWORD 버그: 엉뚱한 비밀번호로 인증한다

데이터베이스 모듈에서 `local-exec`으로 PostgreSQL 초기 설정을 하는 부분이 있었습니다.
여기서 **인증 비밀번호가 잘못 매핑**되어 있었습니다.

**Before:**

```hcl
provisioner "local-exec" {
  command = <<-EOT
    PGPASSWORD="${random_password.db_user.result}" \
    psql -h ${google_sql_database_instance.main.public_ip_address} \
         -U admin \
         -d goti \
         -c "CREATE USER readonly WITH PASSWORD '${random_password.db_user.result}';"
  EOT
}
```

이 코드의 인증 흐름을 따라가보겠습니다.

1. `PGPASSWORD`에 `random_password.db_user.result` (readonly 유저의 비밀번호)를 설정
2. `-U admin`으로 admin 유저로 접속 시도
3. **admin 비밀번호가 아닌 readonly 비밀번호로 인증** → 실패

뭐지? `admin`으로 접속하면서 왜 `db_user`의 비밀번호를 쓰고 있는 거지?

`random_password.db.result`가 admin 비밀번호이고, `random_password.db_user.result`가 readonly 비밀번호입니다.
변수 이름이 비슷해서 발생한 실수입니다.

이 버그가 무서운 이유가 있습니다.
`terraform apply`가 **실패하지 않을 수도 있습니다**.
Cloud SQL이 SSL을 강제하지 않는 설정이면, psql 접속 자체가 타임아웃으로 끝날 수 있고, `local-exec`은 기본적으로 실패해도 `terraform apply` 전체를 중단하지 않는 경우가 있습니다.

결과적으로 readonly 유저가 생성되지 않은 상태로 인프라가 프로비저닝될 수 있습니다.

**After:**

```hcl
provisioner "local-exec" {
  command = <<-EOT
    psql -h ${google_sql_database_instance.main.public_ip_address} \
         -U admin \
         -d goti \
         -c "CREATE USER readonly WITH PASSWORD :'userpass';"
  EOT

  environment = {
    PGPASSWORD = random_password.db.result      # admin 비밀번호
    userpass   = random_password.db_user.result  # readonly 비밀번호
  }
}
```

`PGPASSWORD`를 `random_password.db.result` (admin 비밀번호)로 수정했습니다.
이제 admin 인증이 정상적으로 동작합니다.

---

### 3. CREATE USER 비밀번호가 평문으로 노출된다

2번 이슈를 수정하면서 동시에 발견한 문제입니다.

**Before:**

```hcl
command = <<-EOT
  psql ... -c "CREATE USER readonly WITH PASSWORD '${random_password.db_user.result}';"
EOT
```

`${random_password.db_user.result}`가 **command 문자열에 직접 삽입**되고 있습니다.
이러면 두 가지 경로로 비밀번호가 노출됩니다.

1. **Terraform state**: `local-exec`의 command는 state 파일에 그대로 저장됩니다. state를 열면 비밀번호가 보입니다.
2. **프로세스 목록**: `ps aux` 명령으로 실행 중인 프로세스를 보면, command에 비밀번호가 포함되어 있습니다.
3. **CI/CD 로그**: Terraform 실행 로그에 command가 출력될 수 있습니다.

**After:**

```hcl
provisioner "local-exec" {
  command = <<-EOT
    psql -h ${google_sql_database_instance.main.public_ip_address} \
         -U admin \
         -d goti \
         -c "CREATE USER readonly WITH PASSWORD :'userpass';"
  EOT

  environment = {
    PGPASSWORD = random_password.db.result
    userpass   = random_password.db_user.result
  }
}
```

`environment` 블록으로 비밀번호를 분리했습니다.
환경 변수는 **Terraform state에 저장되지 않고**, 프로세스 목록에도 노출되지 않습니다.

psql에서 `:'userpass'`는 psql의 변수 참조 문법입니다.
환경 변수 `userpass`의 값을 쿼리에 안전하게 바인딩해줍니다.

이 패턴은 `local-exec`에서 비밀번호를 다룰 때 항상 사용해야 하는 기본 패턴입니다.

---

## 🟡 HIGH: 보호 장치가 빠져있다

CRITICAL만큼 즉각적인 위험은 아니지만, **운영 사고를 예방하는 장치**가 빠져 있었습니다.

### 1. GKE deletion_protection이 꺼져 있다

**Before:**

```hcl
resource "google_container_cluster" "primary" {
  name                = "goti-prod-cluster"
  deletion_protection = false  # 위험
  # ...
}
```

`deletion_protection = false`면 `terraform destroy`나 실수로 `terraform apply`에서 클러스터가 재생성될 때 **아무 확인 없이 삭제**됩니다.

prod 환경에서 클러스터가 삭제되면 복구가 불가능합니다.
모든 워크로드, PV, ConfigMap이 사라집니다.

"개발 중이니까 false로 해놨겠지" 하고 넘어갈 수 있지만, 이런 설정이 **그대로 prod에 올라가는 사고가 실제로 발생합니다**.

**After:**

```hcl
variable "deletion_protection" {
  description = "GKE 클러스터 삭제 보호"
  type        = bool
  default     = true  # 기본값을 true로
}

resource "google_container_cluster" "primary" {
  name                = "goti-prod-cluster"
  deletion_protection = var.deletion_protection
  # ...
}
```

변수화하되 **기본값을 `true`**로 설정했습니다.
개발 환경에서만 명시적으로 `false`를 전달하면 됩니다.

```hcl
# dev.tfvars
deletion_protection = false

# prod.tfvars
# deletion_protection = true  (기본값이므로 생략 가능)
```

---

### 2. Artifact Registry immutable_tags가 꺼져 있다

**Before:**

```hcl
resource "google_artifact_registry_repository" "docker" {
  repository_id = "goti-prod-registry"
  format        = "DOCKER"
  # immutable_tags 미설정 (기본 false)
}
```

`immutable_tags = false`면 **같은 태그로 다른 이미지를 덮어쓸 수 있습니다**.

이것이 왜 위험한지 시나리오를 보겠습니다.

1. `v1.2.3` 태그로 이미지를 push
2. prod에 `v1.2.3`으로 배포
3. 누군가 실수로 다른 이미지를 `v1.2.3`으로 다시 push
4. Pod가 재시작되면 **다른 이미지**가 배포됨

태그 불변성이 보장되지 않으면 **배포 재현성이 깨집니다**.

**After:**

```hcl
resource "google_artifact_registry_repository" "docker" {
  repository_id = "goti-prod-registry"
  format        = "DOCKER"

  docker_config {
    immutable_tags = true
  }
}
```

한 줄 추가로 같은 태그에 대한 덮어쓰기를 방지합니다.

---

### 3. GKE Audit Logging이 설정되지 않았다

**Before:**

```hcl
resource "google_container_cluster" "primary" {
  # logging_config 블록 없음
}
```

GKE는 기본적으로 시스템 로그만 수집합니다.
**누가 어떤 리소스를 생성/수정/삭제했는지** 기록하는 Audit 로그는 별도 설정이 필요합니다.

보안 사고가 발생했을 때 Audit 로그가 없으면 **원인 추적이 불가능**합니다.

**After:**

```hcl
resource "google_container_cluster" "primary" {
  logging_config {
    enable_components = [
      "SYSTEM_COMPONENTS",
      "WORKLOADS",
      "APISERVER",         # Audit 로그
      "SCHEDULER",
      "CONTROLLER_MANAGER"
    ]
  }
}
```

`APISERVER`를 추가하면 Kubernetes API 서버의 Audit 로그가 Cloud Logging으로 전송됩니다.
`kubectl`로 수행한 모든 작업이 기록됩니다.

---

## 🟢 MEDIUM: 버전이 안 맞는다

AWS 환경에서 이미 업그레이드된 컴포넌트들이 GCP Terraform에서는 **구버전으로 설정**되어 있었습니다.

| 컴포넌트 | GCP (기존) | AWS (현재) | 수정 후 |
|----------|-----------|-----------|---------|
| Istio | 1.24.3 | 1.29.0 | 1.29.0 |
| ESO chart | 0.10.7 | 0.14.3 | 0.14.3 |
| ArgoCD chart | 7.7.21 | 9.4.6 | 9.4.6 |

왜 버전이 달라졌습니까?

GCP Terraform 작업이 시작된 시점과 실제 PR이 올라온 시점 사이에 AWS 쪽에서 버전 업그레이드가 진행되었기 때문입니다.
브랜치를 오래 들고 있으면 이런 일이 발생합니다.

특히 **Istio 1.24.3과 1.29.0은 메이저 버전 차이**입니다.
같은 팀에서 운영하는 AWS/GCP 클러스터의 Istio 버전이 다르면, Service Mesh 설정의 호환성 문제가 발생할 수 있습니다.

이런 드리프트를 방지하려면 **version-matrix.md** 같은 단일 소스를 관리하고, 양쪽 Terraform에서 참조하는 방식이 필요합니다.

```yaml
# version-matrix.md
| Component   | Version | Updated    |
|-------------|---------|------------|
| Istio       | 1.29.0  | 2026-03-28 |
| ESO chart   | 0.14.3  | 2026-03-15 |
| ArgoCD chart| 9.4.6   | 2026-03-20 |
```

---

## 🔍 Cross-Cloud 호환성: K8s manifest가 AWS 전용이다

여기가 이번 리뷰에서 **가장 큰 발견**이었습니다.

Terraform(IaC) 레이어는 AWS/GCP 각각 독립적으로 준비되어 있습니다.
하지만 K8s manifest(Goti-k8s, Goti-monitoring)는 **AWS 전용으로 하드코딩**되어 있었습니다.

GCP 클러스터에서 ArgoCD App-of-Apps를 배포하면, 여기저기서 에러가 발생할 것입니다.

전체 구조를 ASCII 다이어그램으로 보겠습니다.

{/* TODO: Draw.io로 교체 */}

```
┌─────────────────────────────────────────────────────────────┐
│                     Terraform (IaC)                         │
│                                                             │
│   ┌─────────────────┐          ┌──────────────────┐        │
│   │   prod-aws/     │          │   prod-gcp/      │        │
│   │   ✅ 독립 구성   │          │   ✅ 독립 구성    │        │
│   │   EKS, RDS,     │          │   GKE, CloudSQL, │        │
│   │   ElastiCache   │          │   Memorystore    │        │
│   └────────┬────────┘          └────────┬─────────┘        │
│            │                            │                   │
└────────────┼────────────────────────────┼───────────────────┘
             │                            │
             ▼                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  K8s Manifest Layer                         │
│                                                             │
│   ┌─────────────────────────────────────────────────┐      │
│   │            ⚠️ AWS 하드코딩                        │      │
│   │                                                   │      │
│   │  StorageClass:  ebs.csi.aws.com                  │      │
│   │  Registry:      ECR (707925...)                   │      │
│   │  SecretStore:   aws-ssm                          │      │
│   │  Storage:       S3 backend                       │      │
│   │  SA Annotation: eks.amazonaws.com/role-arn       │      │
│   │  OTel:          awss3 exporter                   │      │
│   └─────────────────────────────────────────────────┘      │
│                                                             │
│   ❌ GCP overlay 없음                                       │
└─────────────────────────────────────────────────────────────┘
```

Terraform은 클라우드별로 분리되어 있지만, **그 위에서 동작하는 K8s manifest는 한 벌**입니다.
그 한 벌이 AWS 전용으로 작성되어 있다는 게 문제입니다.

6가지 호환성 이슈를 하나씩 살펴보겠습니다.

---

### 1. StorageClass: 스토리지 드라이버가 다르다

| 항목 | AWS (현재) | GCP (필요) |
|------|-----------|-----------|
| Provisioner | `ebs.csi.aws.com` | `pd.csi.storage.gke.io` |
| Volume Type | `gp3` | `pd-ssd` 또는 `pd-standard` |

**파일**: `Goti-k8s/infrastructure/prod/storage/storageclass-gp3.yaml`

StorageClass는 **클러스터에서 PVC가 생성될 때 어떤 스토리지를 프로비저닝할지** 결정하는 리소스입니다.
AWS에서는 EBS CSI 드라이버가 gp3 볼륨을 생성하고, GCP에서는 PD CSI 드라이버가 Persistent Disk를 생성합니다.

드라이버 이름부터 볼륨 타입까지 완전히 다르기 때문에, **그대로 적용하면 PVC가 Pending 상태에 빠집니다**.
StatefulSet을 사용하는 모든 워크로드(Mimir, Loki, Redis 등)가 시작하지 못합니다.

```yaml
# AWS용 (현재)
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: gp3
provisioner: ebs.csi.aws.com
parameters:
  type: gp3

# GCP용 (필요)
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: gp3           # 이름은 동일하게 유지
provisioner: pd.csi.storage.gke.io
parameters:
  type: pd-ssd
```

이름을 `gp3`로 동일하게 유지하면 다른 manifest에서 `storageClassName: gp3`를 수정하지 않아도 됩니다.

---

### 2. Container Registry: 이미지 경로가 완전히 다르다

| 항목 | AWS (현재) | GCP (필요) |
|------|-----------|-----------|
| Registry | `707925622666.dkr.ecr.ap-northeast-2.amazonaws.com` | `asia-northeast3-docker.pkg.dev/PROJECT/goti-prod-registry` |
| 이미지 경로 | `prod/goti-queue:v1.2.3` | `goti-queue:v1.2.3` |

**파일**: `Goti-k8s/environments/prod/goti-*/values.yaml` (전 서비스)

**모든 서비스의 Helm values에 ECR 주소가 하드코딩**되어 있습니다.
서비스가 10개라면 10개 파일을 모두 수정해야 합니다.

이것을 매번 수동으로 바꾸는 것은 실수가 생기기 쉽습니다.
Helm values에서 registry prefix를 변수로 분리하는 게 맞습니다.

```yaml
# values.yaml
image:
  registry: ""  # 비워두면 global에서 주입
  repository: goti-queue
  tag: v1.2.3

# values-aws.yaml
global:
  imageRegistry: "707925622666.dkr.ecr.ap-northeast-2.amazonaws.com/prod"

# values-gcp.yaml
global:
  imageRegistry: "asia-northeast3-docker.pkg.dev/PROJECT/goti-prod-registry"
```

---

### 3. ExternalSecret: 시크릿 백엔드가 다르다

| 항목 | AWS (현재) | GCP (필요) |
|------|-----------|-----------|
| ClusterSecretStore | `aws-ssm` (Parameter Store) | `gcp-sm` (Secret Manager) |
| 인증 방식 | IRSA JWT | Workload Identity |

**파일**: `Goti-k8s/infrastructure/prod/external-secrets/config/cluster-secret-store.yaml`

다행히 GCP bootstrap Terraform에서 `gcp-sm` ClusterSecretStore는 **이미 생성되어 있습니다**.
문제는 각 서비스의 ExternalSecret 리소스에서 `secretStoreRef.name: aws-ssm`이 하드코딩되어 있다는 점입니다.

```yaml
# 현재 (AWS 하드코딩)
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
spec:
  secretStoreRef:
    name: aws-ssm          # ← 이 부분
    kind: ClusterSecretStore
```

서비스별 ExternalSecret을 하나하나 수정하는 것보다, **overlay로 분기**하는 것이 효율적입니다.

---

### 4. Monitoring Storage: S3에서 GCS로

| 컴포넌트 | AWS (현재) | GCP (필요) |
|----------|-----------|-----------|
| Mimir | S3 backend | GCS backend |
| Loki | S3 backend | GCS backend |
| OTel Collector | AWS S3 exporter | GCS exporter |

**파일**: `Goti-monitoring/values-stacks/prod/mimir-values.yaml`, `loki-values.yaml`

모니터링 스택의 장기 스토리지가 전부 S3로 설정되어 있습니다.
Mimir(메트릭), Loki(로그) 모두 S3 버킷에 데이터를 저장하도록 되어 있습니다.

GCP에서는 GCS 버킷을 사용해야 하고, 설정 형식도 완전히 다릅니다.

```yaml
# Mimir - AWS (현재)
mimir:
  structuredConfig:
    common:
      storage:
        backend: s3
        s3:
          bucket_name: goti-prod-mimir
          region: ap-northeast-2

# Mimir - GCP (필요)
mimir:
  structuredConfig:
    common:
      storage:
        backend: gcs
        gcs:
          bucket_name: goti-prod-mimir
```

GCS 설정이 S3보다 단순한 편입니다.
region 대신 버킷 이름만 지정하면 되고, 인증은 Workload Identity가 처리합니다.

`values-stacks/prod-gcp/` 디렉토리를 만들어서 GCP용 values를 분리하는 방식을 권장했습니다.

---

### 5. Service Account Annotations: IRSA vs Workload Identity

| 항목 | AWS (현재) | GCP (필요) |
|------|-----------|-----------|
| Annotation Key | `eks.amazonaws.com/role-arn` | `iam.gke.io/gcp-service-account` |
| Annotation Value | `arn:aws:iam::role/*` | `*@*.iam.gserviceaccount.com` |

**대상**: Mimir, Loki, ESO 등 클라우드 리소스에 접근하는 모든 ServiceAccount

AWS에서는 IRSA(IAM Roles for Service Accounts)로 Pod에 IAM 역할을 부여합니다.
GCP에서는 Workload Identity로 Pod에 GCP Service Account를 매핑합니다.

**기능은 같지만 메커니즘이 완전히 다릅니다.**

```yaml
# AWS
apiVersion: v1
kind: ServiceAccount
metadata:
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456:role/mimir-role

# GCP
apiVersion: v1
kind: ServiceAccount
metadata:
  annotations:
    iam.gke.io/gcp-service-account: mimir-sa@project.iam.gserviceaccount.com
```

Helm values에서 SA annotation을 변수로 분리하면, 클라우드별로 다른 값만 주입할 수 있습니다.

---

### 6. OTel Collector: 내보내기 대상이 다르다

| 항목 | AWS (현재) | GCP (필요) |
|------|-----------|-----------|
| Exporter | `awss3` | `googlecloudstorage` 또는 GCS exporter |
| Storage | S3 버킷 | GCS 버킷 |

**파일**: `Goti-monitoring/values-stacks/prod/otel-collector-s3-values.yaml`

OTel Collector의 exporter는 수집한 텔레메트리 데이터를 **어디에 저장할지** 결정하는 컴포넌트입니다.
`awss3` exporter는 AWS SDK를 사용하기 때문에 GCP에서는 동작하지 않습니다.

GCP 환경에서는 `googlecloudstorage` exporter로 교체해야 합니다.

---

### 해결 방향: Overlay와 ApplicationSet

6가지 이슈를 개별적으로 수정하는 것보다, **구조적으로 해결**하는 게 맞습니다.

{/* TODO: Draw.io로 교체 */}

```
┌──────────────────────────────────────────────────────────────┐
│                    해결 구조                                   │
│                                                              │
│   Goti-k8s/                    Goti-monitoring/              │
│   ├── environments/            ├── values-stacks/            │
│   │   ├── prod/      (공통)    │   ├── prod/      (공통)     │
│   │   ├── prod-aws/  (AWS)     │   ├── prod-aws/  (AWS)     │
│   │   └── prod-gcp/  (GCP)    │   └── prod-gcp/  (GCP)     │
│   └── infrastructure/          └──                           │
│       └── overlays/                                          │
│           ├── prod-aws/                                      │
│           └── prod-gcp/                                      │
│                                                              │
│   ApplicationSet                                             │
│   ├── generator: cloud = [aws, gcp]                          │
│   └── template: values-stacks/prod-{{cloud}}/               │
└──────────────────────────────────────────────────────────────┘
```

핵심 전략은 세 가지입니다.

1. **`overlays/prod-gcp/`**: StorageClass, ClusterSecretStore 등 인프라 리소스를 GCP용으로 오버라이드
2. **`values-stacks/prod-gcp/`**: Mimir, Loki, OTel 등 모니터링 스택의 GCP용 values
3. **ApplicationSet**: `cloud` 파라미터로 AWS/GCP를 분기, 환경별 values를 자동 선택

이렇게 하면 **공통 manifest는 한 벌로 유지**하면서, 클라우드별 차이만 overlay로 관리할 수 있습니다.

---

## 📊 전체 평가

| 항목 | 점수 | 비고 |
|------|------|------|
| 모듈 구조 | 9/10 | AWS와 일관된 모듈 분리, 잘 정리됨 |
| 보안 | 5/10 → 8/10 | 수정 전 CRITICAL 2건, 수정 후 대부분 해소 |
| 버전 호환성 | 4/10 → 9/10 | Istio/ESO/ArgoCD 버전 정렬 완료 |
| K8s manifest 호환성 | 3/10 | AWS 하드코딩, GCP overlay 전면 필요 |
| 운영 준비도 | 7/10 | DB HA/Backup/KMS 잘 구성, 모니터링 연동 미완 |

각 항목을 풀어서 설명합니다.

**모듈 구조 (9/10)**: AWS Terraform과 동일한 패턴으로 모듈이 분리되어 있습니다. network → compute → database → bootstrap 순서로 의존성이 명확하고, 변수 네이밍도 일관성이 있습니다. 1점 감점은 output 정리가 일부 빠져 있기 때문입니다.

**보안 (5/10 → 8/10)**: 초기 상태에서는 Master API 전체 개방, PGPASSWORD 버그 등 CRITICAL 이슈가 있었습니다. 수정 후에는 대부분 해소되었지만, **Network Policy 기본 정책**이나 **Pod Security Standards** 설정이 아직 없어서 8점입니다.

**버전 호환성 (4/10 → 9/10)**: Istio 5버전 차이, ESO/ArgoCD 메이저 버전 차이가 있었습니다. 수정 후 AWS와 동일한 버전으로 정렬되었습니다. 향후 version-matrix.md를 단일 소스로 관리하면 10점이 될 수 있습니다.

**K8s manifest 호환성 (3/10)**: 이것은 Terraform PR 범위 밖의 문제이긴 합니다. 하지만 **GCP에서 실제로 서비스를 배포하려면 반드시 해결해야 하는 블로커**입니다. 6개 카테고리에서 호환성 이슈가 발견되었고, overlay 구조를 잡는 작업이 필요합니다.

**운영 준비도 (7/10)**: Cloud SQL의 HA 구성, 자동 백업, KMS 암호화가 잘 설정되어 있습니다. 감점 요인은 모니터링 스택(Mimir, Loki)의 GCP 연동이 아직 안 되어 있다는 점입니다.

---

## 📚 핵심 포인트

이번 리뷰에서 배운 것들을 정리합니다.

**Terraform 보안 체크리스트**:
- `0.0.0.0/0`은 어떤 리소스에서든 **즉시 레드 플래그**입니다
- `local-exec`에서 비밀번호는 반드시 `environment` 블록으로 분리
- `deletion_protection`은 **기본 true**, 예외적으로만 false

**Cross-Cloud IaC의 현실**:
- Terraform 레이어가 클라우드별로 분리되어 있어도 **K8s manifest가 하드코딩되면 의미 없습니다**
- 멀티 클라우드를 진지하게 고려한다면, **manifest 레이어의 추상화**가 더 중요합니다
- overlay/values 분리 + ApplicationSet 분기가 현실적인 해결책

**코드 리뷰의 가치**:
- PGPASSWORD 버그는 **코드를 한 줄씩 따라가지 않으면 발견할 수 없는 문제**였습니다
- 변수 이름이 비슷할 때(`db` vs `db_user`) 실수가 발생하기 쉽습니다
- 보안 이슈는 "나중에 고치자"가 아니라 **merge 전에 반드시 수정**해야 합니다
