---
title: "GitOps의 Bootstrap 문제: ArgoCD가 자기 의존성을 배포할 수 없다"
excerpt: "External Secrets Operator와 ArgoCD 간의 Bootstrap 순환 의존성을 Terraform으로 해결하는 방법"
category: argocd
tags:
  - ArgoCD
  - GitOps
  - Troubleshooting
  - ExternalSecrets
  - Terraform
  - EKS
series:
  name: "argocd-troubleshooting"
  order: 2
date: '2026-01-05'
---

## 한 줄 요약

> ArgoCD가 CrashLoopBackOff. `argocd-secret not found`. ArgoCD가 시작하려면 Secret이 필요한데, 그 Secret을 만드는 ESO는 ArgoCD가 배포해야 합니다. 닭이 먼저냐 달걀이 먼저냐.

## Impact

- **영향 범위**: 클러스터 전체 (ArgoCD 시작 불가)
- **증상**: ArgoCD CrashLoopBackOff
- **소요 시간**: 약 4시간
- **발생일**: 2026-01-05

---

## 🔥 증상: ArgoCD가 시작되지 않는다

### Pod 상태

EKS 클러스터 배포 후 ArgoCD가 시작되지 않았습니다:

```bash
$ kubectl get pods -n argocd
NAME                                               READY   STATUS             RESTARTS   AGE
argocd-application-controller-0                    0/1     Init:0/1           0          5m
argocd-applicationset-controller-xxx               0/1     Init:0/1           0          5m
argocd-dex-server-xxx                              0/1     Init:0/1           0          5m
argocd-repo-server-xxx                             0/1     Init:0/1           0          5m
argocd-server-xxx                                  0/1     CrashLoopBackOff   3          5m
```

### 에러 로그

```bash
$ kubectl logs deploy/argocd-server -n argocd
...
error retrieving argocd-secret: secret "argocd-secret" not found
```

`argocd-secret`이 없어서 ArgoCD가 시작할 수 없습니다.

---

## 🤔 원인: Bootstrap 순환 의존성

### 설정 배경

우리는 다음과 같이 설정했습니다:

1. **`configs.secret.createSecret = false`**: Helm이 `argocd-secret`을 만들지 않음
2. **ExternalSecret으로 관리**: OAuth 자격증명을 AWS Secrets Manager에서 가져옴
3. **ESO를 ArgoCD Application으로 배포**: GitOps 원칙에 따라

이렇게 설정한 이유는 다음과 같습니다:
- ArgoCD가 자기 자신을 sync할 때 Helm이 만든 secret을 `prune: true`로 삭제하는 것 방지
- OAuth 자격증명 같은 민감 정보를 AWS Secrets Manager에서 안전하게 관리

### 순환 의존성 구조

그런데 이렇게 하니 순환 의존성이 발생했습니다:

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
```

![ArgoCD ESO 순환 의존성](/images/eso_argocd_circular_dependency.png)

흐름을 따라가보겠습니다:

1. ArgoCD가 시작하려면 `argocd-secret`이 필요
2. `argocd-secret`은 ExternalSecret이 만듦
3. ExternalSecret은 ESO가 처리해야 함
4. ESO는 ArgoCD Application으로 배포되어야 함
5. ArgoCD가 시작되어야 ESO를 배포할 수 있음
6. **하지만 ArgoCD가 시작되려면 Secret이 필요...** (무한 루프)

---

## ✅ 해결: Bootstrap 컴포넌트는 Terraform으로

### 핵심 원칙

> GitOps에서 Bootstrap 컴포넌트는 Terraform으로 설치해야 한다

ArgoCD가 배포해야 하는 것들 중에서, ArgoCD 자체의 의존성인 것들은 ArgoCD 외부에서 먼저 설치해야 합니다.

### 올바른 Bootstrap 순서

```
┌────────────────────────────────────────────────────────────────────────┐
│                       Terraform 설치 (순서 보장)                        │
├────────────────────────────────────────────────────────────────────────┤
│ 1. EKS Cluster                                                          │
│ 2. Gateway API CRDs                                                     │
│ 3. Istio (Base + Istiod)                                                │
│ 4. External Secrets Operator  ← Terraform Helm Provider                 │
│ 5. ClusterSecretStore         ← Terraform kubernetes_manifest           │
│ 6. ArgoCD                     ← 이제 ESO가 argocd-secret 생성 가능      │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        ArgoCD 관리 (GitOps)                             │
├────────────────────────────────────────────────────────────────────────┤
│ - ExternalSecret 리소스들 (argocd-secret, service secrets)              │
│ - 마이크로서비스 (auth, user, board, chat, noti, storage)              │
│ - Istio Config (HTTPRoute, Gateway, AuthorizationPolicy)               │
│ - Monitoring (Prometheus, Grafana, Loki)                               │
│ - Cluster Addons (ALB Controller, Cert-Manager, External DNS 등)       │
└────────────────────────────────────────────────────────────────────────┘
```

![ArgoCD ESO 순환 의존성 해결](/images/eso_argocd_solution.png)

### Terraform 구현

```hcl
# terraform/prod/compute/helm-releases.tf

# =============================================================================
# 설치 순서 (Bootstrap 순환 의존성 해결):
# 1. Gateway API CRDs
# 2. Istio (Base → Istiod)
# 3. External Secrets Operator + ClusterSecretStore ← ArgoCD보다 먼저!
# 4. ArgoCD
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

**핵심 포인트**:
- `depends_on`으로 설치 순서 보장
- `time_sleep`으로 CRD 등록 대기
- ESO + ClusterSecretStore가 ArgoCD보다 먼저

---

## ArgoCD에서 제거할 항목

ESO가 Terraform으로 이동되면서 ArgoCD에서 제거해야 합니다:

| 파일 | 이유 |
|------|------|
| `k8s/argocd/apps/prod/cluster-addons/external-secrets-operator.yaml` | Terraform이 설치 |
| `k8s/argocd/base/external-secrets/cluster-secret-store.yaml` | Terraform이 생성 |

ArgoCD가 계속 관리하는 항목:

| 파일 | 내용 |
|------|------|
| `k8s/argocd/apps/prod/external-secrets.yaml` | ExternalSecret 리소스들 sync |
| `k8s/argocd/base/external-secrets/argocd-oauth-secret.yaml` | ArgoCD OAuth 자격증명 |
| `k8s/argocd/base/external-secrets/external-secret-shared.yaml` | 서비스 공용 시크릿 |

---

## 클라우드별 적용

이 패턴은 **모든 클라우드에 동일하게 적용**됩니다:

| 클라우드 | Secrets Backend | IAM 연동 | 패턴 동일 |
|---------|-----------------|---------|---------|
| AWS EKS | Secrets Manager | Pod Identity / IRSA | 적용 가능 |
| GCP GKE | Secret Manager | Workload Identity | 적용 가능 |
| Azure AKS | Key Vault | AAD Pod Identity | 적용 가능 |

차이점은 ClusterSecretStore 설정만:

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

## 검증

### Terraform 배포 후 확인

```bash
# 1. ESO Pod 상태 확인
$ kubectl get pods -n external-secrets
NAME                                READY   STATUS    RESTARTS   AGE
external-secrets-xxx                1/1     Running   0          5m
external-secrets-cert-controller    1/1     Running   0          5m
external-secrets-webhook            1/1     Running   0          5m

# 2. ClusterSecretStore 상태 확인
$ kubectl get clustersecretstores
NAME                   AGE   STATUS   CAPABILITIES   READY
aws-secrets-manager    5m    Valid    ReadWrite      True

# 3. ArgoCD Pod 상태 확인
$ kubectl get pods -n argocd
NAME                                               READY   STATUS    RESTARTS   AGE
argocd-application-controller-0                    1/1     Running   0          3m
argocd-server-xxx                                  1/1     Running   0          3m
...

# 4. argocd-secret 생성 확인
$ kubectl get secret argocd-secret -n argocd
NAME            TYPE     DATA   AGE
argocd-secret   Opaque   3      1m
```

---

## 🔥 추가 이슈: Istio Sidecar Injection 실패

Bootstrap 문제를 해결하고 나니 새로운 문제가 발생했습니다:

```bash
$ kubectl describe pod user-service-xxx -n wealist-prod
Events:
  Warning  FailedCreate  5m   kubelet
    failed calling webhook "namespace.sidecar-injector.istio.io":
    Post "https://istiod.istio-system.svc:443/inject?timeout=10s":
    context deadline exceeded
```

### 원인

EKS Control Plane → istiod:15017 연결 불가. Security Group에서 포트 15017이 차단되어 있었습니다.

### 해결

`terraform/prod/compute/eks.tf`에 Security Group 규칙 추가:

```hcl
node_security_group_additional_rules = {
  # Istio webhook (istiod sidecar injection)
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

`source_cluster_security_group = true`가 핵심입니다. EKS Control Plane에서 Worker Node로의 트래픽을 허용합니다.

---

## 📚 배운 점

### GitOps의 한계

GitOps는 강력하지만, **자기 자신의 의존성을 배포할 수 없습니다**. Bootstrap 컴포넌트는 GitOps 외부에서 먼저 설치해야 합니다.

### Bootstrap 컴포넌트란?

GitOps 시스템(ArgoCD)이 동작하기 위해 먼저 존재해야 하는 것들:

- **External Secrets Operator**: ArgoCD가 Secret을 가져오려면 ESO가 먼저 있어야 함
- **ClusterSecretStore**: ESO가 AWS Secrets Manager에 접근하려면 먼저 있어야 함
- **Istio**: 서비스 메시가 동작하려면 먼저 설치되어야 함
- **Gateway API CRDs**: Istio Gateway가 동작하려면 CRD가 먼저 등록되어야 함

### 아키텍처 변경

| 영역 | Before (순환 의존성) | After (올바른 순서) |
|---|---|---|
| Terraform 설치 순서 | EKS → Istio → ArgoCD | EKS → Istio → ESO → ClusterSecretStore → ArgoCD |
| ArgoCD가 관리 | ESO → ClusterSecretStore → ExternalSecret | ExternalSecret → 서비스들 |
| 결과 | ❌ ArgoCD 시작 전에 `argocd-secret`이 필요해 막힘 | ✅ ESO가 먼저 있어 `argocd-secret` 생성 가능 |

---

## 요약

| 항목 | 내용 |
|------|------|
| **문제** | ArgoCD ↔ ESO 순환 의존성 |
| **증상** | ArgoCD CrashLoopBackOff, argocd-secret not found |
| **원인** | ESO를 ArgoCD가 배포해야 하는데, ArgoCD가 먼저 ESO가 필요 |
| **해결** | Bootstrap 컴포넌트(ESO, ClusterSecretStore)는 Terraform으로 먼저 설치 |

---

## 트러블슈팅 체크리스트

### ESO 관련

| 증상 | 확인 사항 | 해결 방법 |
|------|----------|----------|
| ClusterSecretStore Invalid | Pod Identity 설정 | `pod-identity.tf` 확인 |
| ExternalSecret SecretSyncedError | AWS 권한 | IAM Policy 확인 |
| ESO Pod ImagePullBackOff | 이미지 접근 | NAT Gateway, ECR 확인 |

### ArgoCD 관련

| 증상 | 확인 사항 | 해결 방법 |
|------|----------|----------|
| argocd-secret not found | ESO 설치 순서 | Terraform depends_on 확인 |
| Dex 인증 실패 | OAuth Secret 내용 | AWS Secrets Manager 값 확인 |

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `terraform/prod/compute/helm-releases.tf` | ESO, ArgoCD Helm 설치 |
| `terraform/prod/compute/eks.tf` | Security Group 규칙 |
| `k8s/argocd/base/external-secrets/argocd-oauth-secret.yaml` | ArgoCD Secret |

---

## 참고

- [External Secrets Operator 공식 문서](https://external-secrets.io/)
- [AWS EKS Blueprints - GitOps Bridge](https://aws-ia.github.io/terraform-aws-eks-blueprints/)
- [ArgoCD Bootstrap Pattern](https://argo-cd.readthedocs.io/en/stable/operator-manual/cluster-bootstrapping/)
