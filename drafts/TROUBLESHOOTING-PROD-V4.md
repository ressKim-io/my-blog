# Production 트러블슈팅 V4 (2026-01-02)

## 1. 문제 증상

### 1.1 ArgoCD 자동 갱신 불가
- **현상**: Git 변경사항이 클러스터에 반영되지 않음
- **발견 시점**: 서비스 코드 수정 + manifest 변경 후에도 ArgoCD가 갱신 안됨
- **영향 범위**: 모든 서비스의 마지막 sync가 4시간+ 전

### 1.2 wealist-apps-prod 상태 이상
```json
{
  "message": "waiting for healthy state of argoproj.io/Application/wealist-apps-prod",
  "phase": "Running",
  "startedAt": "2026-01-01T15:03:56Z"  // 9시간+ stuck!
}
```

### 1.3 ops 서비스 배포 안됨
- `ops-service`, `ops-portal` Helm 차트는 존재하지만 ArgoCD Application이 누락됨
- CI/CD 파이프라인에도 미등록

---

## 2. 진단 과정

### 2.1 Application 상태 확인

```bash
# ArgoCD Applications 상태 확인
kubectl get app -n argocd -o custom-columns='NAME:.metadata.name,SYNC:.status.sync.status,HEALTH:.status.health.status,PHASE:.status.operationState.phase'
```

**결과**:
```
NAME                           SYNC        HEALTH      PHASE
argocd-config                  OutOfSync   Healthy     Succeeded
wealist-apps-prod              OutOfSync   Progressing Running   # ← 9시간+ stuck!
auth-service-prod              Synced      Healthy     Succeeded
board-service-prod             Synced      Healthy     Succeeded
...
```

### 2.2 operationState 상세 분석

```bash
kubectl get app wealist-apps-prod -n argocd -o jsonpath='{.status.operationState}' | jq '.'
```

**결과**:
```json
{
  "message": "waiting for healthy state of argoproj.io/Application/wealist-apps-prod",
  "phase": "Running",
  "startedAt": "2026-01-01T15:03:56Z"
}
```

**핵심 발견**: `wealist-apps-prod`가 **자기 자신의** healthy 상태를 기다리며 무한 대기 (deadlock)

### 2.3 root-app.yaml 분석

```yaml
# k8s/argocd/apps/prod/root-app.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: wealist-apps-prod        # ← 자기 자신의 이름
  namespace: argocd
spec:
  source:
    path: k8s/argocd/apps/prod   # ← 이 디렉토리 전체 감시 (자기 포함!)
```

**순환 참조 구조**:
```
wealist-apps-prod (k8s/argocd/apps/prod/ 감시)
  ├── auth-service.yaml → auth-service-prod Application
  ├── board-service.yaml → board-service-prod Application
  ├── ...
  └── root-app.yaml → wealist-apps-prod Application (자기 자신!)
        └── sync 시도 → 자기 자신의 healthy 대기 → DEADLOCK!
```

### 2.4 ops 서비스 누락 확인

| 항목 | 위치 | 상태 |
|------|------|------|
| Helm 차트 | `k8s/helm/charts/ops-service/` | ✅ 존재 |
| Helm 차트 | `k8s/helm/charts/ops-portal/` | ✅ 존재 |
| 서비스 코드 | `services/ops-service/` | ✅ 존재 |
| 서비스 코드 | `services/ops-portal/` | ✅ 존재 |
| ArgoCD Application | `k8s/argocd/apps/prod/ops-service.yaml` | ❌ **누락** |
| ArgoCD Application | `k8s/argocd/apps/prod/ops-portal.yaml` | ❌ **누락** |
| CI/CD 파이프라인 | `.github/workflows/ci-build-images.yaml` | ❌ **누락** |

---

## 3. 근본 원인

### 3.1 root-app.yaml 순환 참조 (Critical!)

**원인 구조**:
1. `wealist-apps-prod` Application이 `k8s/argocd/apps/prod/` 디렉토리 전체를 감시
2. `root-app.yaml`이 같은 디렉토리에 있어서 자기 자신도 sync 대상
3. ArgoCD가 `wealist-apps-prod` Application을 sync할 때 자기 자신의 healthy 상태를 기다림
4. 영원히 대기 → **모든 자식 Applications의 자동 sync 차단**

**왜 발생했나?**
- App of Apps 패턴에서 root app 정의를 감시 대상 디렉토리에 배치
- Terraform이나 별도 관리가 아닌 같은 디렉토리에서 관리

### 3.2 ops 서비스 ArgoCD 통합 누락

- 새 서비스 추가 시 체크리스트 미준수
- ArgoCD Application 파일만 누락되어 수동 배포만 가능한 상태

### 3.3 ESO Webhook 초기화 지연 (이전 이슈)

- `external-secrets-operator-webhook`이 0/1 상태로 stuck
- CA 인증서 생성 지연으로 cluster-addons-prod 체인 블록
- **해결**: Secret 삭제 후 재시작으로 복구 (V3 문서 참조)

---

## 4. 해결 방법

### 4.1 Step 0: stuck operation 해제 (즉시 조치)

```bash
# 1. stuck operation 제거
kubectl patch app wealist-apps-prod -n argocd \
  --type=json -p='[{"op": "remove", "path": "/status/operationState"}]'

# 2. hard refresh 트리거
kubectl annotate app wealist-apps-prod -n argocd \
  argocd.argoproj.io/refresh=hard --overwrite
```

### 4.2 Step 1: root-app.yaml 순환 참조 해결

**해결 방법 A: directory.exclude 사용 (임시)**

```bash
# wealist-apps-prod가 root-app.yaml을 무시하도록 설정
kubectl patch app wealist-apps-prod -n argocd --type=merge \
  -p='{"spec":{"source":{"directory":{"exclude":"root-app.yaml"}}}}'
```

**해결 방법 B: 디렉토리 분리 (영구, 권장)**

```
Before:
k8s/argocd/apps/prod/
├── root-app.yaml          # ← 문제! 자기 자신도 감시 대상
├── auth-service.yaml
└── ...

After:
k8s/argocd/
├── root-apps/              # ← 새 디렉토리
│   ├── prod.yaml           # ← root app 정의
│   └── dev.yaml
└── apps/prod/
    ├── auth-service.yaml   # ← root-app.yaml 삭제됨
    └── ...
```

**실행 명령**:
```bash
# 1. 새 디렉토리 생성
mkdir -p k8s/argocd/root-apps

# 2. root-app.yaml 이동
mv k8s/argocd/apps/prod/root-app.yaml k8s/argocd/root-apps/prod.yaml
mv k8s/argocd/apps/dev/root-app.yaml k8s/argocd/root-apps/dev.yaml

# 3. Git 커밋 & Push
git add -A
git commit -m "fix: move root-app.yaml to prevent circular reference deadlock"
git push origin main

# 4. main → prod → k8s-deploy-prod PR 머지
```

### 4.3 Step 2: ops 서비스 ArgoCD Application 생성

**ops-service.yaml 생성**:
```yaml
# k8s/argocd/apps/prod/ops-service.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: ops-service-prod
  namespace: argocd
  annotations:
    argocd.argoproj.io/sync-wave: "5"
    notifications.argoproj.io/subscribe.on-deployed.discord: ""
    notifications.argoproj.io/subscribe.on-sync-failed.discord: ""
  labels:
    environment: production
    service: ops-service
spec:
  project: wealist-prod
  source:
    repoURL: https://github.com/OrangesCloud/wealist-project-advanced-k8s.git
    targetRevision: k8s-deploy-prod
    path: k8s/helm/charts/ops-service
    helm:
      valueFiles:
        - values.yaml
        - ../../environments/base.yaml
        - ../../environments/prod.yaml
      parameters:
        - name: image.repository
          value: "prod/ops-service"
        - name: image.tag
          value: "latest"
        - name: externalSecrets.enabled
          value: "true"
        - name: config.DB_NAME
          value: "ops_db"
  destination:
    server: https://kubernetes.default.svc
    namespace: wealist-prod
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

**ops-portal.yaml 생성**:
```yaml
# k8s/argocd/apps/prod/ops-portal.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: ops-portal-prod
  namespace: argocd
  annotations:
    argocd.argoproj.io/sync-wave: "5"
    notifications.argoproj.io/subscribe.on-deployed.discord: ""
  labels:
    environment: production
    service: ops-portal
spec:
  project: wealist-prod
  source:
    repoURL: https://github.com/OrangesCloud/wealist-project-advanced-k8s.git
    targetRevision: k8s-deploy-prod
    path: k8s/helm/charts/ops-portal
    helm:
      valueFiles:
        - values.yaml
        - ../../environments/base.yaml
        - ../../environments/prod.yaml
      parameters:
        - name: image.repository
          value: "prod/ops-portal"
        - name: image.tag
          value: "latest"
  destination:
    server: https://kubernetes.default.svc
    namespace: wealist-prod
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

### 4.4 Step 3: CI/CD 파이프라인 수정

**수정 파일**: `.github/workflows/ci-build-images.yaml`

**변경 사항**:

1. **paths-filter에 추가**:
```yaml
ops-service:
  - 'services/ops-service/**'
ops-portal:
  - 'services/ops-portal/**'
```

2. **전체 서비스 목록에 추가**:
```yaml
SERVICES='["auth-service","board-service","chat-service","noti-service","storage-service","user-service","video-service","ops-service","ops-portal"]'
```

3. **Go 서비스 목록에 ops-service 추가**:
```yaml
GO_SERVICES='["board-service","chat-service","noti-service","storage-service","user-service","video-service","ops-service"]'
```

4. **build-config case 추가**:
```bash
"ops-service")
  DOCKERFILE="services/${SERVICE}/docker/Dockerfile"
  CONTEXT="."
  ;;
"ops-portal")
  DOCKERFILE="services/${SERVICE}/docker/Dockerfile"
  CONTEXT="services/${SERVICE}"
  ;;
```

### 4.5 argocd-config SharedResourceWarning 해결 (Optional)

**현상**: `argocd-config`가 OutOfSync로 표시되지만 실제 동작에 문제 없음

**원인**: 동일 리소스가 두 Application에서 정의됨
- `argocd-config`: `k8s/argocd/base/external-secrets` 경로
- `external-secrets-config-prod`: 실제 리소스 소유

**해결 방법**:
1. `argocd-config`의 sources에서 `k8s/argocd/base/external-secrets` 제거
2. 또는 SharedResourceWarning 무시 (기능적으로는 정상)

---

## 5. 검증 방법

### 5.1 ArgoCD 전체 상태 확인

```bash
kubectl get app -n argocd -o custom-columns='NAME:.metadata.name,SYNC:.status.sync.status,HEALTH:.status.health.status'
```

**예상 결과**:
```
NAME                           SYNC     HEALTH
argocd-config                  Synced   Healthy  # 또는 OutOfSync (경고만)
auth-service-prod              Synced   Healthy
board-service-prod             Synced   Healthy
ops-service-prod               Synced   Healthy  # 새로 추가됨
ops-portal-prod                Synced   Healthy  # 새로 추가됨
...
```

### 5.2 ops 서비스 Pod 확인

```bash
kubectl get pods -n wealist-prod | grep ops
```

### 5.3 CI/CD 파이프라인 테스트

```bash
# ops-service 코드 변경 후
git push origin service-deploy-prod

# GitHub Actions에서 빌드 확인
# k8s-deploy-prod 브랜치에 이미지 태그 업데이트 확인
```

---

## 6. 예방 조치

### 6.1 새 서비스 추가 시 체크리스트

- [ ] `services/{service}/` 코드 생성
- [ ] `k8s/helm/charts/{service}/` Helm 차트 생성
- [ ] `k8s/argocd/apps/prod/{service}.yaml` ArgoCD Application 생성
- [ ] `.github/workflows/ci-build-images.yaml` 수정
  - [ ] paths-filter 추가
  - [ ] 서비스 목록 추가
  - [ ] build-config case 추가
- [ ] `k8s/helm/environments/prod.yaml`에 서비스 설정 추가 (필요시)

### 6.2 ArgoCD stuck 상태 해제 절차

```bash
# 1. stuck operation 제거
kubectl patch app {APP_NAME} -n argocd \
  --type=json -p='[{"op": "remove", "path": "/status/operationState"}]'

# 2. hard refresh 트리거
kubectl annotate app {APP_NAME} -n argocd \
  argocd.argoproj.io/refresh=hard --overwrite

# 3. 필요시 수동 sync
kubectl patch app {APP_NAME} -n argocd \
  --type=merge -p='{"operation":{"initiatedBy":{"username":"admin"},"sync":{"prune":true}}}'
```

### 6.3 App of Apps 패턴 권장 구조

```
k8s/argocd/
├── root-apps/              # Root Applications (별도 관리)
│   ├── prod.yaml           # Terraform 또는 kubectl로 직접 apply
│   └── dev.yaml
├── apps/
│   ├── prod/               # Production 서비스 Applications
│   │   ├── auth-service.yaml
│   │   ├── board-service.yaml
│   │   └── ...             # root-app.yaml 없음!
│   └── dev/
└── config/                 # ArgoCD 설정 (RBAC, notifications 등)
```

**핵심 원칙**: Root Application 정의는 감시 대상 디렉토리에 포함하지 않음

---

## 7. 관련 문서

- [TROUBLESHOOTING-PROD.md](./TROUBLESHOOTING-PROD.md) - 초기 트러블슈팅 (~2025-12-29)
- [TROUBLESHOOTING-PROD-V2.md](./TROUBLESHOOTING-PROD-V2.md) - 트러블슈팅 V2 (2025-12-30~)
- [TROUBLESHOOTING-PROD-V3.md](./TROUBLESHOOTING-PROD-V3.md) - ESO Webhook 이슈 (2025-12-31~)
- [ISTIO_OBSERVABILITY.md](./ISTIO_OBSERVABILITY.md) - Istio Ambient 모드 설정

---

## 8. 수정된 파일 요약

| 파일 | 작업 | 설명 |
|------|------|------|
| `k8s/argocd/apps/prod/root-app.yaml` | 삭제/이동 | `root-apps/prod.yaml`로 이동 |
| `k8s/argocd/apps/dev/root-app.yaml` | 삭제/이동 | `root-apps/dev.yaml`로 이동 |
| `k8s/argocd/root-apps/prod.yaml` | 생성 | 순환참조 방지를 위한 분리 |
| `k8s/argocd/root-apps/dev.yaml` | 생성 | 순환참조 방지를 위한 분리 |
| `k8s/argocd/apps/prod/ops-service.yaml` | 생성 | ops-service ArgoCD Application |
| `k8s/argocd/apps/prod/ops-portal.yaml` | 생성 | ops-portal ArgoCD Application |
| `.github/workflows/ci-build-images.yaml` | 수정 | ops 서비스 빌드 추가 |

---

## 9. argocd-secret 순환 삭제 문제 (Critical!)

### 9.1 문제 증상

```bash
kubectl get pods -n argocd | grep -E "server|dex"
```

```
argocd-dex-server-xxx    0/1     CrashLoopBackOff   10   7h
argocd-server-xxx        0/1     CrashLoopBackOff   10   7h
```

**로그 확인**:
```bash
kubectl logs -n argocd deploy/argocd-server --tail=10
```

```
level=fatal msg="error retrieving argocd-secret: secret \"argocd-secret\" not found"
```

**argocd.wealist.co.kr 접속 불가**

### 9.2 진단 과정

```bash
# Secret 존재 확인
kubectl get secret argocd-secret -n argocd
# Error: secrets "argocd-secret" not found

# 수동 생성 시도
kubectl create secret generic argocd-secret -n argocd \
  --from-literal=server.secretkey=$(openssl rand -base64 32)
# secret/argocd-secret created

# 10초 후 다시 확인
sleep 10 && kubectl get secret argocd-secret -n argocd
# Error: secrets "argocd-secret" not found  ← 삭제됨!
```

**수동 생성해도 계속 삭제됨!**

### 9.3 근본 원인

```
┌─────────────────────────────────────────────────────────────┐
│  순환 삭제 문제 (Circular Deletion)                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Helm 설치 → argocd-secret 생성                          │
│           ↓                                                 │
│  2. ArgoCD 서버 시작                                        │
│           ↓                                                 │
│  3. argocd-config Application sync 시작                     │
│           ↓                                                 │
│  4. k8s/argocd/base/external-secrets/ 디렉토리 sync         │
│           ↓                                                 │
│  5. argocd-secret은 Git에 정의 안됨 + prune: true           │
│           ↓                                                 │
│  6. ArgoCD가 argocd-secret 삭제! ← 문제!                    │
│           ↓                                                 │
│  7. argocd-server crash                                     │
│           ↓                                                 │
│  8. Helm 재설치해도 3번으로 돌아감 → 무한 반복               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**핵심 문제**:
- `argocd-oauth-secret.yaml`이 `creationPolicy: Merge` 사용
- Merge는 **기존 Secret이 있어야만** 동작
- 하지만 `prune: true`로 인해 Helm이 만든 Secret이 삭제됨
- ExternalSecret이 Merge할 대상이 없어서 실패

### 9.4 해결 방법

#### Step 1: Terraform - AWS Secrets Manager에 ArgoCD 서버 시크릿 추가

**파일**: `terraform/prod/foundation/secrets.tf`

```hcl
# ArgoCD Server Secret (자동 생성)
resource "aws_secretsmanager_secret" "argocd_server" {
  name       = "wealist/prod/argocd/server"
  kms_key_id = module.kms.key_arn

  tags = merge(local.common_tags, {
    Purpose = "ArgoCD Server Authentication"
  })
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

#### Step 2: Terraform - Helm에서 argocd-secret 생성 비활성화

**파일**: `terraform/prod/compute/helm-releases.tf`

```hcl
resource "helm_release" "argocd" {
  # ... 기존 설정 ...

  # argocd-secret은 ExternalSecret이 관리 (Helm 생성 비활성화)
  set {
    name  = "configs.secret.createSecret"
    value = "false"
  }
}
```

#### Step 3: ExternalSecret을 Owner로 변경

**파일**: `k8s/argocd/base/external-secrets/argocd-oauth-secret.yaml`

```yaml
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: argocd-oauth-secret
  namespace: argocd
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-manager
    kind: ClusterSecretStore

  target:
    name: argocd-secret
    creationPolicy: Owner  # ← Merge에서 Owner로 변경!
    template:
      metadata:
        labels:
          app.kubernetes.io/name: argocd-secret
          app.kubernetes.io/part-of: argocd
      data:
        # ArgoCD 서버 인증 필수
        server.secretkey: "{{ .server_secretkey }}"
        # Dex OAuth credentials
        dex.google.clientID: "{{ .dex_google_clientID }}"
        dex.google.clientSecret: "{{ .dex_google_clientSecret }}"

  data:
    - secretKey: server_secretkey
      remoteRef:
        key: "wealist/prod/argocd/server"
        property: secretkey

    - secretKey: dex_google_clientID
      remoteRef:
        key: "wealist/prod/oauth/argocd"
        property: client_id

    - secretKey: dex_google_clientSecret
      remoteRef:
        key: "wealist/prod/oauth/argocd"
        property: client_secret
```

### 9.5 적용 순서

```bash
# 1. Terraform foundation apply (AWS Secrets Manager 생성)
cd terraform/prod/foundation
terraform apply

# 2. Terraform compute apply (Helm 설정 업데이트)
cd ../compute
terraform apply

# 3. Git 변경사항 Push
git add -A
git commit -m "fix: ArgoCD secret을 ExternalSecret으로 관리"
git push origin main

# 4. main → prod → k8s-deploy-prod PR 머지

# 5. ArgoCD sync 또는 수동 적용
kubectl apply -f k8s/argocd/base/external-secrets/argocd-oauth-secret.yaml
```

### 9.6 검증

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

# 웹 접속 확인
curl -I https://argocd.wealist.co.kr
# HTTP/2 200
```

### 9.7 왜 이 문제가 발생했나?

| 원인 | 설명 |
|------|------|
| **ArgoCD가 자기 자신을 관리** | argocd-config Application이 argocd namespace 리소스를 sync |
| **prune: true 설정** | Git에 없는 리소스는 자동 삭제 |
| **Helm과 ArgoCD 충돌** | Helm이 만든 Secret을 ArgoCD가 삭제 |
| **creationPolicy: Merge** | 기존 Secret이 있어야만 동작 |

### 9.8 교훈

1. **ArgoCD가 관리하는 리소스는 Git에 정의해야 함**
2. **Helm과 ArgoCD가 같은 리소스를 관리하면 충돌 발생**
3. **Secret은 ExternalSecret(creationPolicy: Owner)으로 단일 소스 관리**
4. **configs.secret.createSecret=false로 Helm의 Secret 생성 비활성화**

---

## 10. ops-portal 빌드 오류 (CI/CD)

### 10.1 문제 증상

```
npm ci failed: package-lock.json not found
```

```
tsc error: Property 'env' does not exist on type 'ImportMeta'
```

```
ESLint couldn't find an eslint.config.(js|mjs|cjs) file
```

### 10.2 원인 및 해결

| 문제 | 원인 | 해결 |
|------|------|------|
| `npm ci` 실패 | `package-lock.json` 누락 | `npm install` 실행 후 커밋 |
| `import.meta.env` 타입 에러 | `vite-env.d.ts` 누락 | 파일 생성 |
| ESLint 설정 에러 | ESLint 9.x는 `eslint.config.js` 필요 | 새 형식 설정 파일 생성 |

### 10.3 수정된 파일

```
services/ops-portal/
├── package-lock.json          # 신규 생성
├── eslint.config.js           # 신규 생성
└── src/
    ├── vite-env.d.ts          # 신규 생성
    └── contexts/
        └── AuthContext.tsx    # eslint-disable 추가
```

**vite-env.d.ts**:
```typescript
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_URL: string
  readonly VITE_API_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

---

## 11. 수정된 파일 요약 (전체)

| 파일 | 작업 | 설명 |
|------|------|------|
| `k8s/argocd/apps/prod/root-app.yaml` | 이동 | `root-apps/prod.yaml`로 |
| `k8s/argocd/apps/dev/root-app.yaml` | 이동 | `root-apps/dev.yaml`로 |
| `k8s/argocd/apps/prod/ops-service.yaml` | 생성 | ops-service Application |
| `k8s/argocd/apps/prod/ops-portal.yaml` | 생성 | ops-portal Application |
| `k8s/argocd/base/external-secrets/argocd-oauth-secret.yaml` | 수정 | creationPolicy: Owner |
| `terraform/prod/foundation/secrets.tf` | 수정 | argocd/server secret 추가 |
| `terraform/prod/compute/helm-releases.tf` | 수정 | createSecret=false |
| `.github/workflows/ci-build-images.yaml` | 수정 | ops 서비스 빌드 추가 |
| `services/ops-portal/package-lock.json` | 생성 | npm ci 지원 |
| `services/ops-portal/eslint.config.js` | 생성 | ESLint 9.x 호환 |
| `services/ops-portal/src/vite-env.d.ts` | 생성 | Vite 타입 정의 |

---

*작성일: 2026-01-02*
*작성자: Claude Code*
