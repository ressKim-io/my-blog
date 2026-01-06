# Production 트러블슈팅 V3 (2026-01-01~)

이 문서는 Production 환경에서 발생한 문제와 해결 과정을 기록합니다.

## 목차

1. [서비스 CrashLoopBackOff - DB/Redis 연결 실패](#1-서비스-crashloopbackoff---dbredis-연결-실패)
2. [ESO Webhook Not Ready](#2-eso-webhook-not-ready)
3. [Auth Service Redis 연결 실패](#3-auth-service-redis-연결-실패)
4. [Cluster Addons Terraform → ArgoCD 마이그레이션](#4-cluster-addons-terraform--argocd-마이그레이션)
5. [Google OAuth 404 - HTTPRoute 경로 누락](#5-google-oauth-404---httproute-경로-누락)
6. [Cluster Autoscaler 스케일업 실패 - clusterName 불일치](#6-cluster-autoscaler-스케일업-실패---clustername-불일치)
7. [Pod Pending - 노드 리소스/Pod 수 제한 초과](#7-pod-pending---노드-리소스pod-수-제한-초과)
8. [Helm Values 환경별 설정 혼재 문제](#8-helm-values-환경별-설정-혼재-문제)
9. [ArgoCD SSO - HTTPRoute 크로스 네임스페이스 라우팅 실패](#9-argocd-sso---httproute-크로스-네임스페이스-라우팅-실패)
10. [ArgoCD SSO - 307 리다이렉트 루프](#10-argocd-sso---307-리다이렉트-루프)

---

## 1. 서비스 CrashLoopBackOff - DB/Redis 연결 실패

### 증상

```
CrashLoopBackOff: board-service, user-service, chat-service 등
로그: dial tcp 127.0.0.1:5432: connect: connection refused
```

서비스들이 localhost(127.0.0.1)의 PostgreSQL/Redis에 연결 시도.

### 원인

1. **ExternalSecret 미생성**: ESO(External Secrets Operator) webhook이 준비되지 않아 ExternalSecret이 생성되지 않음
2. **Secret 누락**: `wealist-shared-secret`이 없어서 환경변수(DB_HOST, REDIS_HOST)가 주입되지 않음
3. **기본값 사용**: 환경변수가 없으면 Go/Spring 앱이 localhost를 기본값으로 사용

### 진단

```bash
# ExternalSecret 상태 확인
kubectl get externalsecret -n wealist-prod

# ESO 상태 확인
kubectl get pods -n external-secrets

# Secret 확인
kubectl get secret wealist-shared-secret -n wealist-prod
```

### 해결

```bash
# ESO deployment 재시작
kubectl rollout restart deployment -n external-secrets external-secrets
kubectl rollout restart deployment -n external-secrets external-secrets-webhook
kubectl rollout restart deployment -n external-secrets external-secrets-cert-controller

# ArgoCD에서 external-secrets-config Application refresh
argocd app refresh external-secrets-config-prod

# 서비스 재시작
kubectl rollout restart deployment -n wealist-prod -l environment=production
```

### 근본 해결 (마이그레이션 적용)

**문제**: sync-wave는 Application 생성 순서만 보장하고, "Healthy" 상태까지 대기하지 않음

**해결책**:
1. ArgoCD health check 설정 추가 (`k8s/argocd/config/argocd-cm-patch.yaml`)
2. Init container로 Secret 대기 (`waitForSecrets` 설정)
3. sync-wave 재조정

---

## 2. ESO Webhook Not Ready

### 증상

```
ExternalSecret status: SecretSyncedError
Message: could not get secret: webhook validation failed
```

### 원인

ESO cert-controller가 TLS 인증서를 생성하지 못함.
Kubernetes control plane이 webhook에 연결할 수 없음.

```
# cert-controller 로그
"ca cert not yet ready, queuing for later"
```

### 진단

```bash
# ESO pods 상태
kubectl get pods -n external-secrets

# cert-controller 로그
kubectl logs -n external-secrets deploy/external-secrets-cert-controller

# webhook 상태
kubectl get validatingwebhookconfiguration
```

### 해결

```bash
# 모든 ESO 컴포넌트 재시작 (순서 중요)
kubectl rollout restart deployment -n external-secrets external-secrets-cert-controller
sleep 30  # cert-controller가 인증서 생성할 시간
kubectl rollout restart deployment -n external-secrets external-secrets-webhook
sleep 10
kubectl rollout restart deployment -n external-secrets external-secrets
```

### 예방

ArgoCD Application에 retry 설정 추가:

```yaml
syncPolicy:
  retry:
    limit: 10
    backoff:
      duration: 5s
      factor: 2
      maxDuration: 5m
```

---

## 3. Auth Service Redis 연결 실패

### 증상

다른 서비스들은 복구되었지만 auth-service만 계속 실패:

```
Redis connection failed: localhost:6379
```

### 원인

1. Pod가 Secret 생성 전에 시작됨
2. Spring Boot는 환경변수를 시작 시에만 읽음
3. Secret이 나중에 생성되어도 기존 Pod는 갱신되지 않음

### 해결

```bash
# auth-service 재시작
kubectl rollout restart deployment auth-service -n wealist-prod
```

### 예방 (마이그레이션 적용)

Init container 추가로 Secret 대기:

```yaml
initContainers:
  - name: wait-for-secrets
    image: bitnami/kubectl:1.30
    command:
      - /bin/sh
      - -c
      - |
        echo "Waiting for secret wealist-shared-secret..."
        while ! kubectl get secret wealist-shared-secret -n $NAMESPACE; do
          sleep 5
        done
        echo "Secret ready!"
```

---

## 4. Cluster Addons Terraform → ArgoCD 마이그레이션

### 배경

**문제**:
- Terraform argocd-apps layer가 cluster addons를 관리
- sync-wave가 순서만 보장하고 Healthy 상태 대기하지 않음
- ESO가 준비되기 전에 서비스가 시작되어 CrashLoopBackOff 발생

**해결 방향**:
- 모든 cluster addons를 ArgoCD(Git)로 이전
- ArgoCD health check로 Healthy 상태까지 대기
- Init container로 추가 안전장치

### 새로운 sync-wave 순서

```
Wave -10: argocd-config (health checks, notifications, projects)
Wave  -6: cluster-addons App (child apps 배포)
Wave  -5: ALB Controller
Wave  -4: Metrics Server
Wave  -3: Cluster Autoscaler, Node Termination Handler
Wave  -2: External Secrets Operator
Wave  -1: cert-manager, External DNS
Wave   0: (reserved)
Wave   1: ClusterSecretStore, ExternalSecret
Wave   2: wealist-infrastructure (ConfigMaps)
Wave   3: db-init
Wave   5: Services (with init container)
Wave  10: istio-config
Wave  11: istio-addons
Wave  12: monitoring
```

### 생성/수정된 파일

#### 신규 생성

| 파일 | 설명 |
|------|------|
| `k8s/argocd/config/argocd-cm-patch.yaml` | ArgoCD health check (Application, ExternalSecret) |
| `k8s/argocd/apps/prod/cluster-addons.yaml` | cluster-addons App of Apps |
| `k8s/argocd/apps/prod/cluster-addons/alb-controller.yaml` | ALB Controller |
| `k8s/argocd/apps/prod/cluster-addons/metrics-server.yaml` | Metrics Server |
| `k8s/argocd/apps/prod/cluster-addons/cluster-autoscaler.yaml` | Cluster Autoscaler |
| `k8s/argocd/apps/prod/cluster-addons/node-termination-handler.yaml` | Node Termination Handler |
| `k8s/argocd/apps/prod/cluster-addons/external-secrets-operator.yaml` | ESO |
| `k8s/argocd/apps/prod/cluster-addons/cert-manager.yaml` | cert-manager |
| `k8s/argocd/apps/prod/cluster-addons/external-dns.yaml` | External DNS |
| `k8s/argocd/apps/prod/infrastructure.yaml` | Infrastructure ConfigMaps |
| `terraform/prod/compute/argocd-cluster-config.tf` | GitOps Bridge ConfigMap |
| `k8s/helm/charts/*/templates/rbac.yaml` | Secret reader Role/RoleBinding |

#### 수정된 파일

| 파일 | 변경 내용 |
|------|-----------|
| `k8s/argocd/apps/prod/argocd-config.yaml` | sync-wave: -5 → -10, config 디렉토리 추가 |
| `k8s/argocd/apps/prod/*-service.yaml` (7개) | sync-wave: 2 → 5 |
| `k8s/argocd/apps/prod/db-init.yaml` | sync-wave: 2 → 3 |
| `k8s/argocd/projects/wealist-prod.yaml` | sourceRepos, destinations, clusterResourceWhitelist 확장 |
| `k8s/helm/charts/wealist-common/templates/_deployment.tpl` | Init container 추가 |
| `k8s/helm/charts/wealist-common/templates/_rbac.tpl` | secretReaderRole 추가 |
| `k8s/helm/environments/prod.yaml` | waitForSecrets 설정 추가 |

### 마이그레이션 순서

#### Phase 1: Git 변경 (완료)

1. ✅ ArgoCD config 디렉토리 생성 및 health check 추가
2. ✅ cluster-addons 디렉토리 및 Application 파일 생성
3. ✅ AppProject 업데이트 (sourceRepos, destinations 확장)
4. ✅ 서비스 sync-wave를 5로 변경
5. ✅ Init container 및 RBAC 추가
6. ✅ argocd-config.yaml 업데이트

#### Phase 2: Terraform 정리 (사용자 실행)

```bash
# 1. Git 변경사항 커밋 및 푸시
git add -A && git commit -m "chore: migrate cluster addons to ArgoCD"
git push origin main

# 2. main → prod → k8s-deploy-prod PR 생성 및 머지

# 3. EKS 완전 삭제
cd terraform/prod/argocd-apps && terraform destroy
cd ../compute && terraform destroy
cd ../foundation && terraform destroy

# 4. argocd-apps 디렉토리 삭제 (Git에서)
rm -rf terraform/prod/argocd-apps
git add -A && git commit -m "chore: remove terraform argocd-apps layer"
```

#### Phase 3: EKS 재생성 (사용자 실행)

```bash
# 1. Foundation layer
cd terraform/prod/foundation
terraform init && terraform apply

# 2. Compute layer (ArgoCD 포함)
cd ../compute
terraform init && terraform apply

# 3. ArgoCD root-app 적용
kubectl apply -f k8s/argocd/apps/prod/root-app.yaml -n argocd

# 4. ArgoCD가 자동으로 모든 것을 sync
```

#### Phase 4: 검증

```bash
# ArgoCD UI에서 확인
# 1. argocd-config → cluster-addons → ESO → ExternalSecret → Services 순서 확인
# 2. 모든 Application이 Healthy 상태인지 확인

# CLI 확인
argocd app list
kubectl get pods -n wealist-prod
kubectl get externalsecret -n wealist-prod
```

### ALB Controller VPC ID 설정

ALB Controller는 VPC ID가 필요합니다. 현재 하드코딩되어 있으며, 배포 후 업데이트 필요:

```bash
# 1. Terraform에서 VPC ID 확인
cd terraform/prod/foundation
terraform output vpc_id

# 2. ALB Controller YAML 업데이트
# k8s/argocd/apps/prod/cluster-addons/alb-controller.yaml
# vpcId: "vpc-xxx" 값 수정

# 또는 Terraform compute layer의 ConfigMap 확인
kubectl get configmap wealist-cluster-config -n argocd -o yaml
```

### 주의사항

1. **EKS 재생성 필수**: argocd-apps Terraform 삭제 전 EKS destroy 필요
2. **Git 브랜치**: k8s-deploy-prod에 먼저 반영 후 terraform 정리
3. **ALB Controller VPC ID**: 첫 배포 시 수동 업데이트 필요
4. **Init Container 이미지**: `bitnami/kubectl:1.30` 사용 (ECR에 push 권장)

---

## Quick Reference

### 서비스 재시작

```bash
# 전체 서비스
kubectl rollout restart deployment -n wealist-prod -l environment=production

# 특정 서비스
kubectl rollout restart deployment auth-service -n wealist-prod
```

### ESO 재시작

```bash
kubectl rollout restart deployment -n external-secrets --all
```

### ArgoCD Sync

```bash
argocd app sync wealist-apps-prod
argocd app sync external-secrets-config-prod
```

### 로그 확인

```bash
# 서비스 로그
kubectl logs -f deploy/board-service -n wealist-prod

# ESO 로그
kubectl logs -f deploy/external-secrets -n external-secrets

# ArgoCD Application Controller 로그
kubectl logs -f deploy/argocd-application-controller -n argocd
```

---

## 5. Google OAuth 404 - HTTPRoute 경로 누락

### 증상

```
https://api.wealist.co.kr/oauth2/authorization/google → 404 Not Found
```

Google OAuth 로그인 시도 시 404 에러 발생.

### 원인

HTTPRoute에 `/oauth2/*` 경로가 없었음:

```yaml
# 기존 설정 (문제)
- path: /api/oauth2/*  → rewrite to /oauth2/* → auth-service

# 사용자 접근 URL
https://api.wealist.co.kr/oauth2/authorization/google  # 404!
```

Spring Security OAuth2 기본 경로 `/oauth2/authorization/{provider}`가 라우팅되지 않음.

### 해결

`k8s/helm/charts/istio-config/templates/httproute.yaml`에 경로 추가:

```yaml
# OAuth2 Routes (Spring Security 기본 경로)
- matches:
    - path:
        type: PathPrefix
        value: /oauth2
  backendRefs:
    - name: auth-service
      port: 8080

- matches:
    - path:
        type: PathPrefix
        value: /login/oauth2
  backendRefs:
    - name: auth-service
      port: 8080
```

### 검증

```bash
curl -sI "https://api.wealist.co.kr/oauth2/authorization/google" | head -3
# HTTP/1.1 302 Found
# location: https://accounts.google.com/o/oauth2/v2/auth?...
```

---

## 6. Cluster Autoscaler 스케일업 실패 - clusterName 불일치

### 증상

```
Pending pods: user-service, video-service, wealist-waypoint
Event: "pod didn't trigger scale-up:" (빈 메시지)
```

Cluster Autoscaler가 Pending pods를 감지하지만 스케일업하지 않음.

### 원인

Cluster Autoscaler의 `clusterName`과 ASG 태그 불일치:

| 항목 | 값 |
|------|-----|
| Autoscaler 설정 | `k8s.io/cluster-autoscaler/wealist-prod` ❌ |
| ASG 태그 | `k8s.io/cluster-autoscaler/wealist-prod-eks` ✅ |

### 진단

```bash
# Autoscaler 현재 설정 확인
kubectl get deployment cluster-autoscaler-aws-cluster-autoscaler -n kube-system \
  -o jsonpath='{.spec.template.spec.containers[0].command}' | jq -r '.[]' | grep discovery

# ASG 태그 확인
aws autoscaling describe-auto-scaling-groups --output json | \
  jq '.AutoScalingGroups[] | select(.Tags[]? | .Key | contains("cluster-autoscaler"))'
```

### 해결

1. **ArgoCD Application 직접 패치** (임시):

```bash
kubectl patch application cluster-autoscaler -n argocd --type='json' \
  -p='[{"op": "replace", "path": "/spec/source/helm/valuesObject/autoDiscovery/clusterName", "value": "wealist-prod-eks"}]'

kubectl -n argocd patch application cluster-autoscaler --type merge \
  -p '{"operation":{"sync":{"prune":true,"syncStrategy":{"apply":{"force":true}}}}}'
```

2. **Git 영구 수정** (`k8s/argocd/apps/prod/cluster-addons/cluster-autoscaler.yaml`):

```yaml
helm:
  valuesObject:
    autoDiscovery:
      clusterName: "wealist-prod-eks"  # wealist-prod → wealist-prod-eks
```

### 검증

```bash
# 스케일업 트리거 확인
kubectl logs -n kube-system deploy/cluster-autoscaler-aws-cluster-autoscaler --tail=20 | grep -i "scale"
# TriggeredScaleUp: 2->3 (max: 4)
```

### 근본 원인

ArgoCD의 cluster-addons-prod가 ALB Controller의 Healthy 상태를 대기 중이라 다른 Application들이 sync되지 않았음:

```
"waiting for healthy state of aws-load-balancer-controller"
```

---

## 7. Pod Pending - 노드 리소스/Pod 수 제한 초과

### 증상

```
0/2 nodes are available: 1 Insufficient cpu, 1 Too many pods
```

### 원인

1. **Pod 수 제한 도달**: t3.large는 노드당 최대 35 pods
2. **노드 수 부족**: min: 2로 시작하여 총 70 pods 용량
3. **실제 필요**: ~80 pods (서비스 + 모니터링 + 시스템)

| 노드 | Pod 수 | 최대 | 상태 |
|------|--------|------|------|
| node-1 | 29 | 35 | 83% |
| node-2 | 35 | 35 | **100%** |

### 인스턴스 타입별 Pod 제한 (AWS ENI 기반)

| 타입 | vCPU | RAM | **Pod 제한** | Spot 가격 |
|------|------|-----|-------------|-----------|
| t3.medium | 2 | 4GB | 17 | ~$0.013/h |
| t3.large | 2 | 8GB | 35 | ~$0.026/h |
| t3.xlarge | 4 | 16GB | 58 | ~$0.052/h |

### 해결

**Terraform 변수 수정** (`terraform/prod/compute/variables.tf`):

```hcl
variable "spot_min_size" {
  default = 3  # 2 → 3
}

variable "spot_max_size" {
  default = 6  # 4 → 6
}

variable "spot_desired_size" {
  default = 3  # 2 → 3
}
```

**Terraform Apply 시 에러 발생 시**:

```bash
# Error: Minimum capacity 3 can't be greater than desired size 2

# AWS CLI로 먼저 업데이트
aws eks update-nodegroup-config \
  --cluster-name wealist-prod-eks \
  --nodegroup-name <nodegroup-name> \
  --scaling-config minSize=3,maxSize=6,desiredSize=3

# 이후 terraform apply
terraform apply
```

### 최종 설정

| 항목 | 변경 전 | 변경 후 |
|------|---------|---------|
| Nodes | 2 | 3 |
| Pod 용량 | 70 | 105 |
| min_size | 2 | 3 |
| max_size | 4 | 6 |

---

## 8. Helm Values 환경별 설정 혼재 문제

### 증상

- base.yaml에 환경별 값이 하드코딩되어 있어 환경 간 설정 충돌
- `ENV: "production"`이 base에 있어 localhost에서도 production 환경으로 인식
- secrets가 base.yaml에 있어 prod 배포 시 혼란 유발

### 원인

초기 설정 시 환경별 분리 원칙 없이 base.yaml에 모든 기본값을 넣음:

```yaml
# base.yaml (문제 상태)
shared:
  config:
    ENV: "production"          # 환경별로 달라야 함
    LOG_LEVEL: "info"          # localhost는 debug
    S3_ENDPOINT: "http://minio:9000"  # prod는 AWS S3
    OAUTH2_CLIENT_REDIRECT_URI: "http://localhost/..."  # 환경마다 다름
  secrets:
    DB_PASSWORD: "postgres"    # secrets는 환경별 관리 필요
```

### 해결

**Option A 패턴 적용**: 환경별 설정은 환경 파일에서만 관리

**1. base.yaml 간소화** (진정한 전역 설정만)
```yaml
shared:
  config:
    # 포트 (모든 환경 동일)
    POSTGRES_PORT: "5432"
    REDIS_PORT: "6379"

    # Service URLs (K8s 내부 통신)
    AUTH_SERVICE_URL: "http://auth-service:8080"
    # ... 다른 service URLs

    # 안전한 기본값
    DB_AUTO_MIGRATE: "false"

    # OTEL 고정 설정
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel-collector:4317"
  # secrets 섹션 제거
```

**2. 환경 파일에서 개별 관리**

| 설정 | localhost.yaml | dev.yaml | prod.yaml |
|------|---------------|----------|-----------|
| ENV | development | dev | production |
| LOG_LEVEL | debug | info | info |
| DB_HOST | postgres | 172.17.0.1 | ESO 주입 |
| S3_ENDPOINT | minio:9000 | minio:9000 | (빈값=AWS) |
| secrets | 직접 설정 | ESO 사용 | ESO 사용 |

### 변경 파일

```
k8s/helm/environments/
├── base.yaml       # 환경별 설정 제거, 전역 설정만
├── localhost.yaml  # secrets 추가, S3/OTEL 설정 추가
├── dev.yaml        # OTEL 설정 추가
└── prod.yaml       # 변경 없음 (이미 올바름)
```

### 검증

```bash
# 각 환경별 ConfigMap 렌더링 확인
helm template wealist-infrastructure ./k8s/helm/charts/wealist-infrastructure \
  -f ./k8s/helm/environments/base.yaml \
  -f ./k8s/helm/environments/localhost.yaml \
  --namespace wealist-localhost | grep -A 30 "name: wealist-shared-config"
```

### Best Practice

1. **base.yaml**: 모든 환경에서 동일한 값만 (포트, 내부 service URL, 안전한 기본값)
2. **환경 파일**: 해당 환경에서만 사용되는 모든 설정
3. **secrets**: localhost는 직접, dev/prod는 ESO 사용
4. **템플릿 호환성**: `POSTGRES_HOST`와 `DB_HOST` 둘 다 설정 (템플릿에서 POSTGRES_HOST 참조)

---

## Quick Reference (추가)

### Cluster Autoscaler 디버깅

```bash
# ASG 태그 확인
aws autoscaling describe-auto-scaling-groups --output json | \
  jq '.AutoScalingGroups[] | {name: .AutoScalingGroupName, tags: [.Tags[] | select(.Key | contains("cluster"))]}'

# Autoscaler 로그
kubectl logs -n kube-system deploy/cluster-autoscaler-aws-cluster-autoscaler --tail=50 | grep -E "scale|Scale|NodeGroup"
```

### ArgoCD Application 강제 Sync

```bash
# Hard refresh + Force sync
kubectl -n argocd patch application <app-name> --type merge \
  -p '{"metadata":{"annotations":{"argocd.argoproj.io/refresh":"hard"}}}'

kubectl -n argocd patch application <app-name> --type merge \
  -p '{"operation":{"sync":{"prune":true,"syncStrategy":{"apply":{"force":true}}}}}'
```

### Node Group 스케일링

```bash
# 현재 설정 확인
aws eks describe-nodegroup --cluster-name wealist-prod-eks \
  --nodegroup-name <nodegroup-name> | jq '.nodegroup.scalingConfig'

# 스케일링 설정 변경
aws eks update-nodegroup-config \
  --cluster-name wealist-prod-eks \
  --nodegroup-name <nodegroup-name> \
  --scaling-config minSize=3,maxSize=6,desiredSize=3
```

---

## 9. ArgoCD SSO - HTTPRoute 크로스 네임스페이스 라우팅 실패

### 증상

```
https://argocd.wealist.co.kr → 500 Internal Server Error
```

ArgoCD SSO 설정 후 전용 도메인(`argocd.wealist.co.kr`) 접속 시 500 에러.

### 진단

```bash
# HTTPRoute 상태 확인
kubectl get httproute argocd-route -n wealist-prod -o yaml

# status에서 에러 메시지 확인
status:
  parents:
  - conditions:
    - message: backendRef argocd-server/argocd not accessible to a HTTPRoute
              in namespace "wealist-prod" (missing a ReferenceGrant?)
      reason: RefNotPermitted
      status: "False"
      type: ResolvedRefs
```

### 원인

**Gateway API 보안 모델**:
- HTTPRoute는 기본적으로 **같은 네임스페이스의 Service만 참조 가능**
- 다른 네임스페이스의 Service를 참조하려면 **ReferenceGrant 필요**
- 이는 의도치 않은 크로스 네임스페이스 트래픽 라우팅을 방지하는 보안 기능

```
HTTPRoute (wealist-prod) → argocd-server (argocd) = ❌ 차단됨
```

### 해결

**ReferenceGrant 생성** (`k8s/helm/charts/istio-config/templates/referencegrant-argocd.yaml`):

```yaml
apiVersion: gateway.networking.k8s.io/v1beta1
kind: ReferenceGrant
metadata:
  name: allow-httproute-to-argocd
  namespace: argocd  # 대상 네임스페이스 (argocd-server가 있는 곳)
spec:
  from:
    - group: gateway.networking.k8s.io
      kind: HTTPRoute
      namespace: wealist-prod  # 요청하는 HTTPRoute가 있는 네임스페이스
  to:
    - group: ""
      kind: Service
      name: argocd-server  # 참조할 Service 이름
```

**해석**:
- `from`: "wealist-prod 네임스페이스의 HTTPRoute가"
- `to`: "argocd 네임스페이스의 argocd-server Service를 참조하는 것을 허용"

### 배경 지식

#### Gateway API 크로스 네임스페이스 참조 규칙

| 참조 유형 | 기본 동작 | ReferenceGrant 필요 |
|----------|----------|-------------------|
| HTTPRoute → 같은 NS Service | ✅ 허용 | 불필요 |
| HTTPRoute → 다른 NS Service | ❌ 차단 | **필요** |
| Gateway → 같은 NS Secret (TLS) | ✅ 허용 | 불필요 |
| Gateway → 다른 NS Secret | ❌ 차단 | **필요** |

#### ReferenceGrant 주요 개념

1. **위치**: 대상(to) 네임스페이스에 생성
2. **방향**: from → to (단방향)
3. **범위**: 특정 리소스만 허용 가능 (name 지정)

#### 일반적인 해결 패턴

**패턴 1: 같은 네임스페이스에 HTTPRoute 생성**
```yaml
# argocd 네임스페이스에 HTTPRoute 직접 생성
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: argocd-route
  namespace: argocd  # Service와 같은 네임스페이스
spec:
  parentRefs:
    - name: istio-ingressgateway
      namespace: istio-system
  hostnames:
    - "argocd.example.com"
  rules:
    - backendRefs:
        - name: argocd-server
          port: 80
```
→ ReferenceGrant 불필요, 단 AppProject에서 argocd 네임스페이스 배포 권한 필요

**패턴 2: ReferenceGrant 생성 (우리 방식)**
```yaml
# 대상 네임스페이스에 명시적 허용
apiVersion: gateway.networking.k8s.io/v1beta1
kind: ReferenceGrant
metadata:
  name: allow-httproute
  namespace: argocd
spec:
  from:
    - group: gateway.networking.k8s.io
      kind: HTTPRoute
      namespace: wealist-prod
  to:
    - group: ""
      kind: Service
      name: argocd-server
```
→ HTTPRoute를 기존 네임스페이스에 유지, 명시적 허용

**패턴 3: 모든 네임스페이스 허용 (비권장)**
```yaml
spec:
  from:
    - group: gateway.networking.k8s.io
      kind: HTTPRoute
      namespace: "*"  # 모든 네임스페이스 허용 - 보안 위험!
```

### 검증

```bash
# ReferenceGrant 상태 확인
kubectl get referencegrant -A

# HTTPRoute 상태 재확인
kubectl get httproute argocd-route -n wealist-prod -o jsonpath='{.status.parents[0].conditions}' | jq

# 정상 상태
# type: Accepted, status: "True"
# type: ResolvedRefs, status: "True"

# 접속 테스트
curl -sI https://argocd.wealist.co.kr | head -3
# HTTP/1.1 200 OK
```

### 관련 파일

| 파일 | 용도 |
|------|------|
| `k8s/helm/charts/istio-config/templates/httproute-argocd.yaml` | ArgoCD 전용 HTTPRoute |
| `k8s/helm/charts/istio-config/templates/referencegrant-argocd.yaml` | 크로스 NS 참조 허용 |
| `k8s/helm/environments/prod.yaml` | `httpRoute.argocd.host` 설정 |

### 참고 자료

- [Gateway API - ReferenceGrant](https://gateway-api.sigs.k8s.io/api-types/referencegrant/)
- [Gateway API - Cross-Namespace routing](https://gateway-api.sigs.k8s.io/guides/multiple-ns/)
- [GEP-709: Cross Namespace References](https://gateway-api.sigs.k8s.io/geps/gep-709/)

---

## 10. ArgoCD SSO - 307 리다이렉트 루프

### 증상

```bash
curl -sI https://argocd.wealist.co.kr
# HTTP/1.1 307 Temporary Redirect
# location: https://argocd.wealist.co.kr/
# (무한 반복)
```

ArgoCD 접속 시 307 리다이렉트가 무한 반복.

### 원인

**NLB TLS Termination + ArgoCD Insecure 모드 불일치**:

```
브라우저 → HTTPS (443) → NLB (TLS 종료) → HTTP (80) → Gateway → ArgoCD
```

ArgoCD `server.insecure: false` 상태에서:
1. HTTP 요청을 받으면 HTTPS로 리다이렉트 시도
2. NLB가 다시 HTTP로 전달
3. 무한 루프 발생

### 진단

```bash
# ConfigMap 확인
kubectl get cm argocd-cmd-params-cm -n argocd -o jsonpath='{.data.server\.insecure}'
# 결과: false ← 문제!
```

### 해결

**Terraform Helm values 수정** (`terraform/prod/compute/helm-releases.tf`):

```hcl
resource "helm_release" "argocd" {
  # ...

  # Insecure mode (TLS termination at NLB)
  # server.insecure: deployment command line flag
  # configs.params: argocd-cmd-params-cm ConfigMap (이게 우선)
  set {
    name  = "server.insecure"
    value = "true"
  }

  set {
    name  = "configs.params.server\\.insecure"  # ConfigMap 직접 설정
    value = "true"
  }
}
```

**왜 두 개 모두 필요한가?**

| 설정 | 적용 대상 | 우선순위 |
|------|----------|---------|
| `server.insecure` | Deployment 명령줄 플래그 | 낮음 |
| `configs.params.server.insecure` | argocd-cmd-params-cm ConfigMap | **높음** |

ArgoCD는 ConfigMap 값을 우선 사용하므로 둘 다 설정해야 안전.

### 임시 해결 (kubectl)

```bash
# ConfigMap 패치 (임시)
kubectl patch cm argocd-cmd-params-cm -n argocd \
  --type merge -p '{"data":{"server.insecure":"true"}}'

# ArgoCD 서버 재시작
kubectl rollout restart deploy/argocd-server -n argocd
```

⚠️ **주의**: kubectl 직접 수정은 Terraform과 충돌할 수 있음. 반드시 Terraform에 영구 반영 필요.

### 검증

```bash
curl -sI https://argocd.wealist.co.kr | head -3
# HTTP/1.1 200 OK
# content-type: text/html; charset=utf-8
```
