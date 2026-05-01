---
title: "ArgoCD가 9시간 동안 멈춘 이유: App of Apps 순환 참조"
excerpt: "App of Apps 패턴에서 root-app.yaml이 자기 자신을 감시하면서 발생하는 deadlock과 argocd-secret 순환 삭제 문제"
category: argocd
tags:
  - ArgoCD
  - GitOps
  - Troubleshooting
  - App of Apps
  - ExternalSecrets
series:
  name: "argocd-troubleshooting"
  order: 1
date: '2026-01-02'
---

## 한 줄 요약

> ArgoCD Application이 9시간+ 동안 "Running" 상태로 stuck. 원인은 root-app.yaml이 자기 자신을 sync 대상에 포함시켜 무한 대기하는 순환 참조.

## Impact

- **영향 범위**: 모든 서비스 자동 배포 중단
- **증상 지속**: 9시간+ Running 상태
- **소요 시간**: 약 3시간
- **발생일**: 2026-01-02

---

## 🔥 증상: Git 변경사항이 반영되지 않는다

### 발견 상황

서비스 코드와 manifest를 수정하고 push 했습니다. ArgoCD에서 sync 했고, "Synced" 상태로 바뀌었습니다.

그런데 변경사항이 클러스터에 반영되지 않았습니다.

```bash
$ kubectl get app -n argocd -o custom-columns='NAME:.metadata.name,SYNC:.status.sync.status,HEALTH:.status.health.status,PHASE:.status.operationState.phase'

NAME                   SYNC        HEALTH       PHASE
argocd-config          OutOfSync   Healthy      Succeeded
wealist-apps-prod      OutOfSync   Progressing  Running   # ← 9시간+ stuck!
auth-service-prod      Synced      Healthy      Succeeded
board-service-prod     Synced      Healthy      Succeeded
```

### 상세 분석

`wealist-apps-prod`의 상태를 확인해봤습니다:

```bash
$ kubectl get app wealist-apps-prod -n argocd -o jsonpath='{.status.operationState}' | jq '.'
```

```json
{
  "message": "waiting for healthy state of argoproj.io/Application/wealist-apps-prod",
  "phase": "Running",
  "startedAt": "2026-01-01T15:03:56Z"
}
```

**자기 자신의 healthy 상태를 기다리고 있었습니다!**

---

## 🤔 원인: root-app.yaml 순환 참조

### 문제의 구조

```yaml
# k8s/argocd/apps/prod/root-app.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: wealist-apps-prod        # 자기 자신의 이름
  namespace: argocd
spec:
  source:
    path: k8s/argocd/apps/prod   # 이 디렉토리 전체 감시 (자기 포함!)
```

root-app.yaml이 `k8s/argocd/apps/prod/` 디렉토리를 감시하는데, 자기 자신도 그 디렉토리에 있었습니다.

### 순환 참조 흐름

![ArgoCD App-of-Apps Circular Dependency](/images/argocd/argocd-circular-dependency.svg)

ArgoCD가 `wealist-apps-prod` Application을 sync할 때:
1. `k8s/argocd/apps/prod/` 디렉토리의 모든 yaml을 적용
2. root-app.yaml도 적용 대상
3. `wealist-apps-prod` Application이 healthy가 되길 대기
4. 그런데 자기가 바로 그 Application...
5. **영원히 대기**

### 결과

root Application이 stuck → 모든 자식 Applications의 자동 sync 차단 → 전체 GitOps 파이프라인 정지

---

## ✅ 해결: 디렉토리 분리

### 즉시 조치: stuck operation 해제

```bash
# 1. stuck operation 제거
kubectl patch app wealist-apps-prod -n argocd \
  --type=json -p='[{"op": "remove", "path": "/status/operationState"}]'

# 2. hard refresh 트리거
kubectl annotate app wealist-apps-prod -n argocd \
  argocd.argoproj.io/refresh=hard --overwrite
```

### 영구 해결: 디렉토리 분리

**Before (문제 구조):**
```text
k8s/argocd/apps/prod/
├── root-app.yaml          # 문제! 자기 자신도 감시 대상
├── auth-service.yaml
├── board-service.yaml
└── ...
```

**After (올바른 구조):**
```text
k8s/argocd/
├── root-apps/              # 새 디렉토리 (별도 관리)
│   ├── prod.yaml           # root app 정의
│   └── dev.yaml
└── apps/prod/
    ├── auth-service.yaml   # root-app.yaml 없음!
    └── ...
```

### 적용 명령

```bash
# 1. 새 디렉토리 생성
mkdir -p k8s/argocd/root-apps

# 2. root-app.yaml 이동
mv k8s/argocd/apps/prod/root-app.yaml k8s/argocd/root-apps/prod.yaml

# 3. Git 커밋 & Push
git add -A
git commit -m "fix: move root-app.yaml to prevent circular reference deadlock"
git push origin main
```

### 핵심 원칙

> Root Application 정의는 감시 대상 디렉토리에 포함하지 않는다

---

## 🔥 두 번째 문제: argocd-secret이 계속 삭제된다

root-app 문제를 해결하고 나니 새로운 문제가 발생했습니다.

### 증상

```bash
$ kubectl get pods -n argocd | grep -E "server|dex"
argocd-dex-server-xxx    0/1     CrashLoopBackOff   10   7h
argocd-server-xxx        0/1     CrashLoopBackOff   10   7h
```

로그를 확인해봤습니다:

```bash
$ kubectl logs -n argocd deploy/argocd-server --tail=10
level=fatal msg="error retrieving argocd-secret: secret \"argocd-secret\" not found"
```

### 수동 생성해도 삭제됨

```bash
# Secret 수동 생성
kubectl create secret generic argocd-secret -n argocd \
  --from-literal=server.secretkey=$(openssl rand -base64 32)
# secret/argocd-secret created

# 10초 후 확인
sleep 10 && kubectl get secret argocd-secret -n argocd
# Error: secrets "argocd-secret" not found  ← 삭제됨!
```

**수동으로 만들어도 계속 삭제됩니다!**

### 원인: ArgoCD가 자기 Secret을 prune

문제의 핵심:
- `argocd-config` Application이 argocd namespace 리소스를 sync
- `prune: true` 설정으로 Git에 없는 리소스는 자동 삭제
- Helm이 만든 `argocd-secret`은 Git에 정의되어 있지 않음
- ArgoCD가 Helm이 만든 Secret을 삭제 → 자기 자신을 죽임

---

## ✅ 해결: ExternalSecret으로 단일 소스 관리

### Step 1: Terraform - AWS Secrets Manager에 ArgoCD 서버 시크릿 추가

```hcl
# terraform/prod/foundation/secrets.tf
resource "aws_secretsmanager_secret" "argocd_server" {
  name       = "wealist/prod/argocd/server"
  kms_key_id = module.kms.key_arn
}

resource "random_password" "argocd_secretkey" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret_version" "argocd_server" {
  secret_id = aws_secretsmanager_secret.argocd_server.id
  secret_string = jsonencode({
    secretkey = random_password.argocd_secretkey.result
  })
}
```

### Step 2: Helm에서 argocd-secret 생성 비활성화

```hcl
# terraform/prod/compute/helm-releases.tf
resource "helm_release" "argocd" {
  # ... 기존 설정 ...

  # argocd-secret은 ExternalSecret이 관리
  set {
    name  = "configs.secret.createSecret"
    value = "false"
  }
}
```

### Step 3: ExternalSecret을 Owner로 변경

```yaml
# k8s/argocd/base/external-secrets/argocd-oauth-secret.yaml
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: argocd-oauth-secret
  namespace: argocd
spec:
  secretStoreRef:
    name: aws-secrets-manager
    kind: ClusterSecretStore

  target:
    name: argocd-secret
    creationPolicy: Owner  # Merge → Owner로 변경!
    template:
      metadata:
        labels:
          app.kubernetes.io/name: argocd-secret
          app.kubernetes.io/part-of: argocd
      data:
        server.secretkey: "{{ .server_secretkey }}"
        dex.google.clientID: "{{ .dex_google_clientID }}"
        dex.google.clientSecret: "{{ .dex_google_clientSecret }}"

  data:
    - secretKey: server_secretkey
      remoteRef:
        key: "wealist/prod/argocd/server"
        property: secretkey
    # ... OAuth 설정 ...
```

**핵심 변경**: `creationPolicy: Merge` → `creationPolicy: Owner`

- **Merge**: 기존 Secret이 있어야만 동작 (Helm이 먼저 만들어야 함)
- **Owner**: ExternalSecret이 Secret을 직접 생성하고 소유

### 검증

```bash
# ExternalSecret 상태 확인
kubectl get externalsecret -n argocd
# NAME                    STATUS         READY
# argocd-oauth-secret     SecretSynced   True

# Secret 존재 확인
kubectl get secret argocd-secret -n argocd
# NAME            TYPE     DATA   AGE
# argocd-secret   Opaque   3      1m

# ArgoCD 서버 상태 확인
kubectl get pods -n argocd | grep -E "server|dex"
# argocd-server-xxx       1/1     Running   0   1m
# argocd-dex-server-xxx   1/1     Running   0   1m
```

---

## 📚 배운 점

### App of Apps 패턴 권장 구조

```text
k8s/argocd/
├── root-apps/              # Root Applications (Terraform 또는 kubectl로 직접 apply)
│   ├── prod.yaml
│   └── dev.yaml
├── apps/
│   ├── prod/               # Production 서비스 Applications
│   │   ├── auth-service.yaml
│   │   └── ...             # root-app.yaml 없음!
│   └── dev/
└── config/                 # ArgoCD 설정 (RBAC, notifications 등)
```

### Helm과 ArgoCD가 같은 리소스를 관리할 때

| 상황 | 결과 |
|------|------|
| Helm이 생성, ArgoCD가 prune | Secret 삭제 → 서비스 crash |
| 둘 다 관리 | 무한 충돌 |
| **단일 소스 (ExternalSecret)** | **안정적** |

### 체크리스트

ArgoCD가 자기 자신을 관리할 때 확인해야 할 것들:

- [ ] Root Application이 감시 대상 디렉토리에 포함되지 않는가?
- [ ] `prune: true`로 인해 필수 리소스가 삭제되지 않는가?
- [ ] Helm과 ArgoCD가 같은 리소스를 관리하고 있지 않은가?
- [ ] ExternalSecret은 `creationPolicy: Owner`인가?

---

## 요약

| 문제 | 원인 | 해결 |
|------|------|------|
| 9시간 stuck | root-app.yaml 순환 참조 | 디렉토리 분리 |
| argocd-secret 삭제 | Helm vs ArgoCD prune 충돌 | ExternalSecret Owner |

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `k8s/argocd/root-apps/prod.yaml` | root app 정의 (분리됨) |
| `k8s/argocd/base/external-secrets/argocd-oauth-secret.yaml` | argocd-secret 관리 |
| `terraform/prod/foundation/secrets.tf` | AWS Secrets Manager |
| `terraform/prod/compute/helm-releases.tf` | ArgoCD Helm 설정 |

---

## 참고

- [ArgoCD App of Apps Pattern](https://argo-cd.readthedocs.io/en/stable/operator-manual/cluster-bootstrapping/)
- [ArgoCD Sync Options](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-options/)
- [External Secrets Operator - Creation Policy](https://external-secrets.io/latest/api/externalsecret/)
