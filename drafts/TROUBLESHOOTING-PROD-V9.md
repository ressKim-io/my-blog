# Production 트러블슈팅 V9 - ESO/ArgoCD Bootstrap 순환 의존성 (2026-01-05)

## 개요

이 문서는 External Secrets Operator(ESO)와 ArgoCD 간의 Bootstrap 순환 의존성 문제와 해결 방법을 다룹니다.
이 문제는 AWS EKS, GCP GKE, Azure AKS 등 모든 클라우드 Kubernetes 환경에 공통으로 적용됩니다.

---

## 1. 문제 현상

### 1.1 ArgoCD Pod CrashLoopBackOff

EKS 클러스터 배포 후 ArgoCD가 시작되지 않고 CrashLoopBackOff 상태:

```bash
$ kubectl get pods -n argocd
NAME                                               READY   STATUS             RESTARTS   AGE
argocd-application-controller-0                    0/1     Init:0/1           0          5m
argocd-applicationset-controller-xxx               0/1     Init:0/1           0          5m
argocd-dex-server-xxx                              0/1     Init:0/1           0          5m
argocd-repo-server-xxx                             0/1     Init:0/1           0          5m
argocd-server-xxx                                  0/1     CrashLoopBackOff   3          5m
```

### 1.2 에러 로그

```bash
$ kubectl logs deploy/argocd-server -n argocd
...
error retrieving argocd-secret: secret "argocd-secret" not found
```

---

## 2. 근본 원인: Bootstrap 순환 의존성

### 2.1 순환 의존성 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         순환 의존성 (Circular Dependency)                │
└─────────────────────────────────────────────────────────────────────────┘

    ┌──────────────┐         ┌──────────────────────┐
    │   ArgoCD     │─────────▶│   argocd-secret      │
    │  (시작 필요) │  needs   │  (K8s Secret 필요)   │
    └──────────────┘         └──────────────────────┘
           │                           ▲
           │ deploys                   │ creates
           ▼                           │
    ┌──────────────┐         ┌──────────────────────┐
    │     ESO      │◀────────│   ExternalSecret     │
    │ (ArgoCD App) │  needs  │  (ESO가 처리)        │
    └──────────────┘         └──────────────────────┘
           │                           ▲
           │ needs                     │ needs
           ▼                           │
    ┌──────────────────────────────────────────────┐
    │              ClusterSecretStore              │
    │          (AWS Secrets Manager 연결)           │
    └──────────────────────────────────────────────┘

🔴 문제: ArgoCD → ESO 배포 → ExternalSecret 처리 → argocd-secret 생성
   하지만 ArgoCD가 시작되려면 argocd-secret이 먼저 필요!
```

### 2.2 문제 발생 조건

1. ArgoCD Helm에서 `configs.secret.createSecret = false` 설정
2. `argocd-secret`을 ExternalSecret으로 관리하려고 함
3. ESO를 ArgoCD Application으로 배포하려고 함

### 2.3 왜 이런 설정을 했는가?

- **`createSecret = false`**: ArgoCD가 자기 자신을 sync할 때 Helm이 만든 secret을 삭제하는 것 방지
- **ExternalSecret 사용**: OAuth 자격증명 같은 민감 정보를 AWS Secrets Manager에서 안전하게 관리

---

## 3. 해결 방법: Terraform에서 ESO 먼저 설치

### 3.1 핵심 원칙

**GitOps에서 Bootstrap 컴포넌트는 Terraform으로 설치해야 합니다.**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      올바른 Bootstrap 순서                               │
└─────────────────────────────────────────────────────────────────────────┘

Terraform 설치 (순서 보장):
┌────────────────────────────────────────────────────────────────────────┐
│ 1. EKS Cluster                                                          │
│ 2. Gateway API CRDs                                                     │
│ 3. Istio (Base + Istiod)                                                │
│ 4. External Secrets Operator  ← Terraform Helm Provider                 │
│ 5. ClusterSecretStore         ← Terraform kubernetes_manifest           │
│ 6. ArgoCD                     ← 이제 ESO가 argocd-secret 생성 가능      │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
ArgoCD 관리 (GitOps):
┌────────────────────────────────────────────────────────────────────────┐
│ - ExternalSecret 리소스들 (argocd-secret, service secrets)              │
│ - 마이크로서비스 (auth, user, board, chat, noti, storage)              │
│ - Istio Config (HTTPRoute, Gateway, AuthorizationPolicy)               │
│ - Monitoring (Prometheus, Grafana, Loki)                               │
│ - Cluster Addons (ALB Controller, Cert-Manager, External DNS 등)       │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Terraform 구현 (terraform/prod/compute/helm-releases.tf)

```hcl
# =============================================================================
# 설치 순서 (Bootstrap 순환 의존성 해결):
# 1. Gateway API CRDs (Istio 의존성)
# 2. Istio (Base → Istiod) - Sidecar Mode
# 3. External Secrets Operator + ClusterSecretStore ← ArgoCD보다 먼저!
# 4. ArgoCD (ESO가 argocd-secret 생성 가능)
# 5. ArgoCD Bootstrap App (App of Apps로 나머지 관리)
# =============================================================================

# 3. External Secrets Operator
resource "helm_release" "external_secrets" {
  name       = "external-secrets"
  repository = "https://charts.external-secrets.io"
  chart      = "external-secrets"
  version    = "1.2.0"
  namespace  = "external-secrets"

  create_namespace = true

  set {
    name  = "installCRDs"
    value = "true"
  }

  set {
    name  = "serviceAccount.name"
    value = "external-secrets"  # Pod Identity와 매칭
  }

  depends_on = [helm_release.istiod]
}

# ESO CRDs 등록 대기
resource "time_sleep" "wait_for_eso_crds" {
  depends_on      = [helm_release.external_secrets]
  create_duration = "30s"
}

# ClusterSecretStore
resource "kubernetes_manifest" "cluster_secret_store" {
  manifest = {
    apiVersion = "external-secrets.io/v1"
    kind       = "ClusterSecretStore"
    metadata = {
      name = "aws-secrets-manager"
    }
    spec = {
      provider = {
        aws = {
          service = "SecretsManager"
          region  = var.aws_region
        }
      }
    }
  }

  depends_on = [time_sleep.wait_for_eso_crds]
}

# 4. ArgoCD - ESO가 먼저 설치되어야 함
resource "helm_release" "argocd" {
  name       = "argocd"
  repository = "https://argoproj.github.io/argo-helm"
  chart      = "argo-cd"
  version    = "5.55.0"
  namespace  = "argocd"

  set {
    name  = "configs.secret.createSecret"
    value = "false"  # ExternalSecret이 관리
  }

  depends_on = [kubernetes_manifest.cluster_secret_store]
}
```

---

## 4. ArgoCD 관리 항목 정리

### 4.1 ESO 관련 제거 항목

ESO가 Terraform으로 이동되면서 ArgoCD에서 제거할 파일:

| 파일 | 이유 |
|------|------|
| `k8s/argocd/apps/prod/cluster-addons/external-secrets-operator.yaml` | Terraform이 설치 |
| `k8s/argocd/base/external-secrets/cluster-secret-store.yaml` | Terraform이 생성 |

### 4.2 ArgoCD가 계속 관리하는 항목

| 파일 | 내용 |
|------|------|
| `k8s/argocd/apps/prod/external-secrets.yaml` | ExternalSecret 리소스들 sync |
| `k8s/argocd/base/external-secrets/argocd-oauth-secret.yaml` | ArgoCD OAuth 자격증명 |
| `k8s/argocd/base/external-secrets/external-secret-shared.yaml` | 서비스 공용 시크릿 |

---

## 5. 클라우드별 적용

### 5.1 이 패턴은 클라우드에 무관하게 적용

| 클라우드 | Secrets Backend | IAM 연동 | 패턴 동일 |
|---------|-----------------|---------|---------|
| AWS EKS | Secrets Manager | Pod Identity / IRSA | ✅ |
| GCP GKE | Secret Manager | Workload Identity | ✅ |
| Azure AKS | Key Vault | AAD Pod Identity | ✅ |

### 5.2 차이점은 ClusterSecretStore 설정만

**AWS:**
```yaml
spec:
  provider:
    aws:
      service: SecretsManager
      region: ap-northeast-2
```

**GCP:**
```yaml
spec:
  provider:
    gcpsm:
      projectID: my-gcp-project
```

**Azure:**
```yaml
spec:
  provider:
    azurekv:
      vaultUrl: "https://myvault.vault.azure.net"
```

---

## 6. 검증 절차

### 6.1 Terraform 배포 후 확인

```bash
# 1. ESO Pod 상태 확인
kubectl get pods -n external-secrets

# 2. ClusterSecretStore 상태 확인
kubectl get clustersecretstores
kubectl describe clustersecretstore aws-secrets-manager

# 3. ArgoCD Pod 상태 확인
kubectl get pods -n argocd

# 4. argocd-secret 생성 확인
kubectl get secret argocd-secret -n argocd
```

### 6.2 예상 출력

```bash
$ kubectl get clustersecretstores
NAME                   AGE   STATUS   CAPABILITIES   READY
aws-secrets-manager    5m    Valid    ReadWrite      True

$ kubectl get pods -n argocd
NAME                                               READY   STATUS    RESTARTS   AGE
argocd-application-controller-0                    1/1     Running   0          3m
argocd-server-xxx                                  1/1     Running   0          3m
...
```

---

## 7. 관련 참고 자료

### 7.1 AWS EKS Blueprints 패턴

AWS EKS Blueprints에서도 동일한 패턴을 권장:
- ESO를 Terraform `aws_eks_addon` 또는 Helm provider로 설치
- ArgoCD Bootstrap 전에 ESO + ClusterSecretStore 완료

### 7.2 관련 문서

- [External Secrets Operator 공식 문서](https://external-secrets.io/)
- [AWS EKS Blueprints - GitOps Bridge](https://aws-ia.github.io/terraform-aws-eks-blueprints/)
- [lablabs/terraform-aws-eks-external-secrets](https://github.com/lablabs/terraform-aws-eks-external-secrets)

---

## 8. 트러블슈팅 체크리스트

### 8.1 ESO 관련 문제

| 증상 | 확인 사항 | 해결 방법 |
|------|----------|----------|
| ClusterSecretStore Invalid | Pod Identity 설정 확인 | `pod-identity.tf` 확인 |
| ExternalSecret SecretSyncedError | AWS Secrets Manager 권한 | IAM Policy 확인 |
| ESO Pod ImagePullBackOff | ECR 권한 또는 인터넷 접근 | NAT Gateway, ECR 접근 확인 |

### 8.2 ArgoCD 관련 문제

| 증상 | 확인 사항 | 해결 방법 |
|------|----------|----------|
| argocd-secret not found | ESO 설치 순서 | Terraform depends_on 확인 |
| Dex 인증 실패 | OAuth Secret 내용 | AWS Secrets Manager 값 확인 |
| sync 실패 | Git 접근 권한 | argocd-repo-creds 확인 |

---

## 9. 요약

### 핵심 교훈

1. **GitOps의 Bootstrap 문제**: ArgoCD가 자기 자신의 의존성을 배포할 수 없음
2. **해결책**: Bootstrap 컴포넌트(ESO, ClusterSecretStore)는 Terraform으로 먼저 설치
3. **클라우드 무관**: 이 패턴은 EKS, GKE, AKS 모두에 적용

### 변경된 아키텍처

**Before (순환 의존성):**
```
Terraform: EKS → Istio → ArgoCD
ArgoCD: ESO → ClusterSecretStore → ExternalSecret
❌ ArgoCD가 시작되기 전에 argocd-secret 필요
```

**After (올바른 순서):**
```
Terraform: EKS → Istio → ESO → ClusterSecretStore → ArgoCD
ArgoCD: ExternalSecret → 서비스들
✅ ESO가 먼저 있으므로 argocd-secret 생성 가능
```

---

## 10. Istio Sidecar Injection Webhook 실패 (Security Group 이슈)

### 10.1 문제 현상

ESO/ArgoCD Bootstrap 해결 후, wealist-prod 네임스페이스의 Pod들이 시작되지 않음:

```bash
$ kubectl get pods -n wealist-prod
NAME                            READY   STATUS     RESTARTS   AGE
user-service-xxx                0/2     Init:0/1   0          5m
board-service-xxx               0/2     Init:0/1   0          5m
...
```

Pod describe 시 다음 오류:

```bash
$ kubectl describe pod user-service-xxx -n wealist-prod
Events:
  Warning  FailedCreate  5m   kubelet
    Error creating: Internal error occurred:
    failed calling webhook "namespace.sidecar-injector.istio.io":
    failed to call webhook: Post "https://istiod.istio-system.svc:443/inject?timeout=10s":
    context deadline exceeded
```

### 10.2 근본 원인

**EKS Control Plane → istiod:15017 연결 불가**

Istio Sidecar Injection은 MutatingWebhook으로 동작합니다:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   Sidecar Injection Flow                                 │
└─────────────────────────────────────────────────────────────────────────┘

   Pod 생성 요청
        │
        ▼
┌──────────────┐     MutatingWebhook      ┌──────────────────────┐
│  API Server  │ ──────────────────────▶  │      istiod Pod      │
│ (EKS Control │     Service: 443        │ (Worker Node에 배포)  │
│    Plane)    │     Pod: 15017          │                      │
└──────────────┘                          └──────────────────────┘
        │                                           ▲
        └───────────────────────────────────────────┘
                                                    │
                         ❌ Security Group에서 포트 15017 차단

🔴 문제: EKS Control Plane Security Group → Worker Node Security Group
   포트 15017이 열려있지 않아 webhook 타임아웃 발생
```

### 10.3 EKS Security Group 구조

EKS는 두 개의 Security Group을 사용합니다:

| Security Group | 관리 주체 | 연결 대상 |
|----------------|----------|-----------|
| **Cluster SG (Terraform)** | Terraform `module.eks` | Worker Nodes |
| **EKS-created Cluster SG** | EKS (자동 생성) | Control Plane ENIs |

**중요**: Control Plane → Worker Node 통신은 **EKS-created Cluster SG**에서 **Terraform Cluster SG**로 이루어집니다.

### 10.4 해결 방법

`terraform/prod/compute/eks.tf`에 Security Group 규칙 추가:

```hcl
node_security_group_additional_rules = {
  # ... 기존 규칙들 ...

  # Istio webhook (istiod sidecar injection)
  # API Server → istiod:15017 for MutatingWebhook calls
  # Service port 443 → Pod targetPort 15017
  istio_webhook = {
    description                   = "Istio sidecar injector webhook"
    protocol                      = "tcp"
    from_port                     = 15017
    to_port                       = 15017
    type                          = "ingress"
    source_cluster_security_group = true
  }
}
```

**핵심**: `source_cluster_security_group = true`는 EKS-created Cluster SG에서의 인바운드를 허용합니다.

### 10.5 Istio 포트 정리

| 포트 | 용도 | 필요 여부 |
|------|------|----------|
| 15001-15006 | Envoy traffic redirect | ✅ Sidecar 모드 필수 |
| 15012 | istiod XDS (control plane ↔ sidecar) | ✅ Sidecar 모드 필수 |
| **15017** | **Sidecar injection webhook** | ✅ **반드시 필요** |
| 15020-15021 | Metrics, readiness | ✅ 모니터링 필수 |

### 10.6 검증 절차

```bash
# 1. Security Group 규칙 확인
aws ec2 describe-security-groups \
  --group-ids <cluster-sg-id> \
  --query 'SecurityGroups[0].IpPermissions'

# 2. istiod Service 확인
kubectl get svc istiod -n istio-system -o yaml
# ports:
#   - name: https-webhook
#     port: 443
#     targetPort: 15017

# 3. Pod 재시작 후 Sidecar 주입 확인
kubectl delete pod -l app=user-service -n wealist-prod
kubectl get pods -n wealist-prod
# READY: 2/2 (main + istio-proxy)
```

### 10.7 교훈

1. **EKS webhook 통신**: Control Plane → Worker Node는 별도 Security Group 규칙 필요
2. **Istio 15017**: Sidecar injection webhook의 실제 포트 (Service 443 → Pod 15017)
3. **source_cluster_security_group**: EKS-created SG에서의 트래픽 허용에 필수

---

## 11. auth-service OTEL Endpoint 형식 오류 (해결됨)

### 11.1 문제 현상

auth-service가 CrashLoopBackOff 상태로 반복 재시작:

```bash
$ kubectl logs deploy/auth-service -n wealist-prod
...
Invalid endpoint, must start with http:// or https://: otel-collector:4317
```

### 11.2 근본 원인 (임시)

초기에는 Go 서비스와 Java 서비스가 다른 OTEL 프로토콜을 사용:
- Go 서비스: gRPC (4317) - `host:port` 형식
- Java 서비스: HTTP/Protobuf (4318) - `http://host:port` 형식

이로 인해 `base.yaml`에서 공통 설정이 불가능했습니다.

### 11.3 영구 해결 방법 (2025-01-05)

**모든 서비스를 HTTP/protobuf (4318)로 통일**:

1. **Go OTEL 패키지 변경** (`packages/wealist-advanced-go-pkg/otel/otel.go`):
   - `otlptracegrpc` → `otlptracehttp`
   - `otlploggrpc` → `otlploghttp`

2. **base.yaml 공통 설정**:
   ```yaml
   shared:
     config:
       # Protocol: HTTP/protobuf (OpenTelemetry 권장 - 모든 언어 호환)
       OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel-collector:4318"
       OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf"
   ```

3. **ArgoCD override 제거**: auth-service의 OTEL endpoint 오버라이드 불필요

### 11.4 HTTP/protobuf 선택 이유

| 항목 | gRPC (4317) | HTTP/protobuf (4318) |
|------|-------------|----------------------|
| OpenTelemetry 권장 | - | ✅ 기본 프로토콜 |
| 언어 호환성 | 일부 | ✅ 모든 SDK 지원 |
| 방화벽 친화성 | HTTP/2 필요 | ✅ HTTP/1.1 호환 |
| 디버깅 | 복잡 | ✅ 용이 |

### 11.5 통일 후 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    모든 서비스 (Go + Java)                               │
│                                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ board-svc   │  │ user-svc    │  │ chat-svc    │  │ auth-svc    │     │
│  │ (Go)        │  │ (Go)        │  │ (Go)        │  │ (Java)      │     │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │
│         │                │                │                │             │
│         └────────────────┴────────────────┴────────────────┘             │
│                                   │                                       │
│                                   ▼ HTTP/protobuf                        │
│                            ┌─────────────┐                               │
│                            │    4318     │                               │
│                            │   (HTTP)    │                               │
│                            └──────┬──────┘                               │
│                                   │                                       │
└───────────────────────────────────│───────────────────────────────────────┘
                                    │
                                    ▼
                          ┌──────────────────┐
                          │  OTEL Collector  │
                          │                  │
                          │  → Tempo         │
                          │  → Prometheus    │
                          └──────────────────┘
```
