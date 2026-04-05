# GCP Terraform 코드 리뷰 + Cross-Cloud 호환성 분석

- **날짜**: 2026-04-04
- **작성자**: ress (Claude 지원)
- **대상 커밋**: `2a7277c` (xaczxzz, 2026-04-03)
- **관련 PR**: Goti-Terraform `fix/gcp-terraform-hardening` 브랜치

---

## 1. 리뷰 대상 (Terraform prod-gcp)

| 모듈 | 역할 |
|------|------|
| network | VPC, 서브넷, Cloud NAT, PSA |
| gke | GKE 클러스터, Workload Identity SA |
| compute | Core/Spot 노드 풀 |
| database | Cloud SQL PostgreSQL 16 + Memorystore Redis 7 |
| kms | Cloud KMS KeyRing + CryptoKey |
| storage | GCS 버킷 (Mimir, Loki) |
| registry | Artifact Registry (Docker) |
| config | GCP Secret Manager |
| bootstrap | Istio + ESO + ArgoCD (Helm) |

---

## 2. 수정한 이슈 (Terraform 브랜치)

### CRITICAL
| 이슈 | 파일 | 수정 내용 |
|------|------|----------|
| GKE Master API `0.0.0.0/0` 개방 | `modules/gke/main.tf` | dynamic block + 변수화 |
| local-exec PGPASSWORD 버그 (user RO 비밀번호를 admin 인증에 사용) | `modules/database/main.tf` | `random_password.db.result` 사용 |
| CREATE USER 비밀번호 평문 노출 | `modules/database/main.tf` | environment 블록으로 분리 |

### HIGH
| 이슈 | 파일 | 수정 내용 |
|------|------|----------|
| GKE deletion_protection = false | `modules/gke/main.tf` | 변수화, default true |
| Artifact Registry immutable_tags = false | `modules/registry/main.tf` | true로 변경 |
| GKE Audit Logging 미설정 | `modules/gke/main.tf` | logging_config 추가 |

### MEDIUM (버전 정렬)
| 컴포넌트 | 기존 | 변경 | 근거 |
|----------|------|------|------|
| Istio | 1.24.3 | 1.29.0 | version-matrix.md |
| ESO chart | 0.10.7 | 0.14.3 | version-matrix.md |
| ArgoCD chart | 7.7.21 | 9.4.6 | version-matrix.md |

---

## 3. Cross-Cloud 호환성 이슈 (K8s manifest 레이어)

Terraform(IaC) 레이어는 AWS/GCP 각각 독립적으로 준비되었으나,
K8s manifest(Goti-k8s, Goti-monitoring)는 **AWS 전용으로 하드코딩**되어 있음.

GCP 클러스터에서 ArgoCD App-of-Apps를 배포하려면 아래 이슈를 먼저 해결해야 함.

### 3-1. StorageClass

| 현재 (AWS) | 필요 (GCP) |
|------------|------------|
| `ebs.csi.aws.com` | `pd.csi.storage.gke.io` |
| `gp3` | `pd-ssd` 또는 `pd-standard` |

- **파일**: `Goti-k8s/infrastructure/prod/storage/storageclass-gp3.yaml`
- **방안**: GCP용 StorageClass yaml 추가 또는 ApplicationSet에서 분기

### 3-2. Container Registry

| 현재 (AWS) | 필요 (GCP) |
|------------|------------|
| `707925622666.dkr.ecr.ap-northeast-2.amazonaws.com/prod/goti-*` | `asia-northeast3-docker.pkg.dev/PROJECT/goti-prod-registry/goti-*` |

- **파일**: `Goti-k8s/environments/prod/goti-*/values.yaml` (전 서비스)
- **방안**: Helm values에서 registry prefix를 변수로 분리

### 3-3. ExternalSecret ClusterSecretStore

| 현재 (AWS) | 필요 (GCP) |
|------------|------------|
| `aws-ssm` (ParameterStore) | `gcp-sm` (Secret Manager) |
| IRSA JWT 인증 | Workload Identity 인증 |

- **파일**: `Goti-k8s/infrastructure/prod/external-secrets/config/cluster-secret-store.yaml`
- **상태**: GCP bootstrap Terraform에서 `gcp-sm` ClusterSecretStore는 이미 생성됨
- **방안**: 서비스별 ExternalSecret에서 `secretStoreRef.name`을 분기 또는 overlay

### 3-4. Monitoring Storage Backend

| 현재 (AWS) | 필요 (GCP) |
|------------|------------|
| Mimir: S3 backend | Mimir: GCS backend |
| Loki: S3 backend | Loki: GCS backend |
| OTel Collector: AWS S3 exporter | OTel Collector: GCS exporter |

- **파일**: `Goti-monitoring/values-stacks/prod/mimir-values.yaml`, `loki-values.yaml`
- **방안**: `values-stacks/prod-gcp/` 디렉토리 추가, ApplicationSet에서 클라우드별 values 분기

### 3-5. Service Account Annotations

| 현재 (AWS) | 필요 (GCP) |
|------------|------------|
| `eks.amazonaws.com/role-arn: arn:aws:iam::*` | `iam.gke.io/gcp-service-account: *@*.iam.gserviceaccount.com` |

- **대상**: Mimir, Loki, ESO 등 Workload Identity 사용 서비스
- **방안**: Helm values에서 SA annotation을 변수로 분리

### 3-6. OTel Collector

| 현재 (AWS) | 필요 (GCP) |
|------------|------------|
| `awss3` exporter | `googlecloudstorage` 또는 GCS exporter |
| S3 버킷 | GCS 버킷 |

- **파일**: `Goti-monitoring/values-stacks/prod/otel-collector-s3-values.yaml`

---

## 4. 권장 다음 단계

1. **Goti-k8s**: `overlays/prod-gcp/` 또는 `environments/prod-gcp/` 디렉토리 추가
2. **Goti-monitoring**: `values-stacks/prod-gcp/` 디렉토리 추가
3. **ApplicationSet**: cloud provider 기반 generator 추가 (AWS/GCP 분기)
4. **CI/CD**: GCP Artifact Registry push 파이프라인 구성
5. **Cloudflare DNS**: GCP Istio Gateway IP → DNS 레코드 추가 (traffic split)

---

## 5. 전체 평가

| 항목 | 점수 | 비고 |
|------|------|------|
| 모듈 구조 | 9/10 | AWS와 일관된 모듈 분리, 잘 정리됨 |
| 보안 | 5/10 → 8/10 | 수정 전 CRITICAL 2건, 수정 후 대부분 해소 |
| 버전 호환성 | 4/10 → 9/10 | Istio/ESO/ArgoCD 버전 정렬 완료 |
| K8s manifest 호환성 | 3/10 | AWS 하드코딩, GCP overlay 전면 필요 |
| 운영 준비도 | 7/10 | DB HA/Backup/KMS 잘 구성, 모니터링 연동 미완 |
