# Production EKS 트러블슈팅 가이드

> 이 문서는 Production EKS 환경에서 발생한 문제들과 해결 방법을 기록합니다.

---

## 2024-12-27: auth-service Redis 연결 실패

### 증상

```
auth-service Pod이 CrashLoopBackOff 상태
Readiness probe 실패
```

### 로그

```
Unable to connect to Redis
Connection refused: redis:6379
```

### 원인

`auth-service/values.yaml`에 Redis 호스트가 하드코딩되어 있었음:

```yaml
# 문제의 코드 (auth-service/values.yaml)
config:
  SPRING_REDIS_HOST: "redis"     # 로컬용 하드코딩!
  SPRING_REDIS_PORT: "6379"
```

Production에서는 AWS ElastiCache를 사용하므로 ExternalSecret에서 호스트를 가져와야 하는데,
`values.yaml`의 하드코딩 값이 우선 적용되어 `redis`로 연결 시도.

### 해결

1. **auth-service/values.yaml에서 하드코딩 제거**:

```yaml
# 수정 후 - 하드코딩 제거
config:
  # SPRING_REDIS_HOST: ExternalSecret에서 가져옴
  # SPRING_REDIS_PORT: ExternalSecret에서 가져옴
```

2. **localhost.yaml에 로컬 개발용 값 추가**:

```yaml
# k8s/helm/environments/localhost.yaml
shared:
  config:
    SPRING_REDIS_HOST: "redis"
    SPRING_REDIS_PORT: "6379"
```

3. **ArgoCD Application에 SSL 설정 추가**:

```yaml
# k8s/argocd/apps/prod/auth-service.yaml
spec:
  source:
    helm:
      parameters:
        - name: config.SPRING_DATA_REDIS_SSL_ENABLED
          value: "true"  # ElastiCache TLS 필수
```

### 검증

```bash
# Pod 상태 확인
kubectl get pods -n wealist-prod -l app=auth-service

# 로그 확인
kubectl logs -f deploy/auth-service -n wealist-prod

# Redis 연결 테스트 (Pod 내부에서)
kubectl exec -it deploy/auth-service -n wealist-prod -- \
  curl -s localhost:8080/actuator/health
```

---

## 2024-12-27: Go 서비스 DATABASE_URL SSL 모드 오류

### 증상

```
user-service, board-service 등 Go 서비스 시작 실패
"SSL is not enabled on the server" 오류
```

### 원인

Go 서비스의 DATABASE_URL에 `sslmode=verify-full`이 설정되어 있었으나,
RDS PostgreSQL의 SSL 인증서를 Go 서비스가 신뢰하지 못함.

### 해결

`sslmode=require`로 변경 (인증서 검증 없이 암호화만):

```yaml
# k8s/helm/environments/prod.yaml
shared:
  config:
    DB_SSL_MODE: "require"   # verify-full → require
    DB_SSLMODE: "require"
```

### 참고

| SSL Mode | 암호화 | 인증서 검증 | 용도 |
|----------|--------|-------------|------|
| disable | X | X | 개발 환경 |
| require | O | X | 프로덕션 (간편) |
| verify-ca | O | CA만 검증 | 높은 보안 |
| verify-full | O | CA+호스트명 검증 | 최고 보안 |

RDS는 기본적으로 AWS 루트 CA를 사용하므로, `require`만으로도 충분한 보안 제공.

---

## 2024-12-27: ALB Controller 미설치

### 증상

```
EKS 클러스터 생성 완료
서비스는 정상 동작
외부에서 접근 불가 (LoadBalancer/Ingress 없음)
```

### 원인

Terraform으로 EKS만 생성하고, ALB Controller는 수동 설치 예정이었으나 누락됨.
Pod Identity IAM 역할은 생성되었으나 실제 Helm 릴리스가 없었음.

### 해결

`terraform/prod/compute/helm-releases.tf`에 Helm 릴리스 추가:

```hcl
resource "helm_release" "aws_load_balancer_controller" {
  name       = "aws-load-balancer-controller"
  repository = "https://aws.github.io/eks-charts"
  chart      = "aws-load-balancer-controller"
  version    = "1.7.1"
  namespace  = "kube-system"

  set {
    name  = "clusterName"
    value = module.eks.cluster_name
  }

  set {
    name  = "serviceAccount.name"
    value = "aws-load-balancer-controller"
  }

  set {
    name  = "vpcId"
    value = local.vpc_id
  }

  depends_on = [module.eks, module.pod_identity_alb_controller]
}
```

### 교훈

**Terraform으로 관리할 컴포넌트 체크리스트**:

- [x] EKS 클러스터
- [x] Gateway API CRDs
- [x] Istio (base, istiod, cni, ztunnel, ingress)
- [x] ArgoCD
- [x] AWS Load Balancer Controller
- [x] External Secrets Operator
- [x] cert-manager
- [x] Cluster Autoscaler
- [x] ArgoCD Bootstrap App

---

## 2024-12-27: ArgoCD 앱 브랜치 불일치

### 증상

```
ArgoCD가 앱을 Sync하지만 최신 변경사항이 반영되지 않음
```

### 원인

일부 ArgoCD Application이 `main` 브랜치를 참조하고 있었음:

```yaml
# 문제의 설정
spec:
  source:
    targetRevision: main  # prod는 k8s-deploy-prod 사용해야 함
```

### 해결

모든 prod 앱을 `k8s-deploy-prod` 브랜치로 통일:

```bash
# 변경된 파일들
k8s/argocd/apps/prod/root-app.yaml
k8s/argocd/apps/prod/external-secrets.yaml
k8s/argocd/apps/prod/infrastructure.yaml
k8s/argocd/apps/prod/frontend.yaml
k8s/argocd/apps/prod/db-init.yaml
```

### 검증

```bash
# 모든 앱의 targetRevision 확인
grep -r "targetRevision:" k8s/argocd/apps/prod/

# 예상 출력: 모두 k8s-deploy-prod
```

---

## 2024-12-27: Istio Ingress Gateway 누락

### 증상

```
Istio Ambient 모드 설치 완료
HTTPRoute 설정 완료
외부 트래픽 수신 불가
```

### 원인

Istio Ambient 모드는 기본적으로 Ingress Gateway를 포함하지 않음.
Sidecar 모드와 달리 별도로 Gateway를 설치해야 함.

### 해결

`helm-releases.tf`에 Istio Ingress Gateway 추가:

```hcl
resource "helm_release" "istio_ingress" {
  name       = "istio-ingressgateway"
  repository = "https://istio-release.storage.googleapis.com/charts"
  chart      = "gateway"
  version    = "1.24.0"
  namespace  = "istio-system"

  # AWS NLB 설정
  set {
    name  = "service.type"
    value = "LoadBalancer"
  }

  set {
    name  = "service.annotations.service\\.beta\\.kubernetes\\.io/aws-load-balancer-type"
    value = "external"
  }

  set {
    name  = "service.annotations.service\\.beta\\.kubernetes\\.io/aws-load-balancer-nlb-target-type"
    value = "ip"
  }

  set {
    name  = "service.annotations.service\\.beta\\.kubernetes\\.io/aws-load-balancer-scheme"
    value = "internet-facing"
  }

  depends_on = [
    helm_release.istio_ztunnel,
    helm_release.aws_load_balancer_controller
  ]
}
```

### 참고: Istio 모드별 차이

| 컴포넌트 | Sidecar 모드 | Ambient 모드 |
|----------|-------------|--------------|
| 데이터 플레인 | Envoy Sidecar | ztunnel (L4) + Waypoint (L7) |
| Ingress Gateway | 기본 포함 | 별도 설치 필요 |
| 리소스 사용량 | 높음 | 낮음 |
| 설정 복잡도 | 낮음 | 높음 |

---

## 일반 디버깅 명령어

### Pod 상태 확인

```bash
# 모든 Pod 상태
kubectl get pods -n wealist-prod

# 특정 서비스 로그
kubectl logs -f deploy/{service-name} -n wealist-prod

# Pod 상세 정보
kubectl describe pod -l app={service-name} -n wealist-prod
```

### ArgoCD 상태 확인

```bash
# 모든 앱 상태
kubectl get applications -n argocd

# 특정 앱 상세
kubectl describe application {app-name} -n argocd

# Sync 강제 실행
kubectl patch application {app-name} -n argocd \
  --type merge -p '{"operation":{"sync":{}}}'
```

### Istio 상태 확인

```bash
# ztunnel 로그 (RBAC 거부 확인)
kubectl logs -n istio-system -l app=ztunnel --tail=50 | grep -i denied

# Waypoint 로그
kubectl logs deploy/wealist-waypoint -n wealist-prod --tail=30

# HTTPRoute 상태
kubectl get httproute -n wealist-prod
```

### 서비스 간 통신 테스트

```bash
# board → user 통신 테스트
kubectl exec deploy/board-service -n wealist-prod -- \
  wget -q -O - http://user-service:8081/health/live

# auth → redis 연결 테스트
kubectl exec deploy/auth-service -n wealist-prod -- \
  curl -s localhost:8080/actuator/health
```

### External Secrets 확인

```bash
# ClusterSecretStore 상태
kubectl get clustersecretstore

# ExternalSecret 상태
kubectl get externalsecret -n wealist-prod

# 생성된 Secret 확인
kubectl get secret wealist-shared-secret -n wealist-prod -o yaml
```

---

## 2024-12-29: External Secrets Operator apiVersion 불일치

### 증상

```
ArgoCD App external-secrets-config-prod가 SyncFailed
"Version v1 of external-secrets.io/ExternalSecret is installed on the destination cluster"
```

### 원인

1. ESO Helm chart 버전이 `0.9.11`로 구버전 (v1 API 미지원)
2. `external-secret-shared.yaml`에서 `apiVersion: external-secrets.io/v1` 사용
3. 실제 ESO는 `v1alpha1`, `v1beta1`만 지원 (`v1`은 존재하지 않음)

### 해결

1. **ESO 버전 업그레이드** (`terraform/prod/argocd-apps/cluster-addons.tf`):

```hcl
# Before
targetRevision = "0.9.11"

# After
targetRevision = "0.10.5"  # v1beta1 API 안정 지원
```

2. **ExternalSecret apiVersion 수정** (`k8s/argocd/base/external-secrets/external-secret-shared.yaml`):

```yaml
# Before
apiVersion: external-secrets.io/v1

# After
apiVersion: external-secrets.io/v1beta1  # v1은 존재하지 않음
```

3. **CRD 수동 업데이트** (ESO 업그레이드 후 CRD가 자동 갱신 안 될 경우):

```bash
kubectl apply --server-side --force-conflicts \
  -f https://raw.githubusercontent.com/external-secrets/external-secrets/v0.10.5/deploy/crds/bundle.yaml
```

### ESO API 버전 참고

| API Version | 상태 | 비고 |
|-------------|------|------|
| v1alpha1 | 구버전 | 사용 비권장 |
| v1beta1 | **안정** | ✅ 권장 |
| v1 | **없음** | 존재하지 않음! |

---

## 2024-12-29: external-secrets.yaml이 .gitignore에 의해 무시됨

### 증상

```
k8s/argocd/apps/prod/external-secrets.yaml이 git push 안됨
ArgoCD에서 external-secrets-config-prod Application이 생성되지 않음
```

### 원인

`.gitignore`에 `*-secrets.yaml` 패턴이 있어서 `external-secrets.yaml`도 무시됨.

### 해결

`.gitignore`에 예외 추가:

```gitignore
# Allow External Secrets CRD definitions (not actual secrets)
!k8s/argocd/apps/*/external-secrets.yaml
!k8s/argocd/base/external-secrets/
!k8s/argocd/base/external-secrets/*.yaml
```

### 참고

`external-secrets.yaml`은 실제 비밀값이 아니라 **어디서 비밀을 가져올지** 경로만 정의하므로 Git에 커밋해도 안전함.

---

## 2024-12-29: db-init Job이 생성되지 않음

### 증상

```
db-init-prod ArgoCD App이 Synced/Healthy
하지만 Job이 생성되지 않음
서비스들이 "database does not exist" 오류로 CrashLoopBackOff
```

### 원인

`k8s/helm/charts/db-init/templates/job.yaml` 첫 줄:

```yaml
{{- if .Values.database.host }}  # host가 비어있으면 Job 생성 안됨
```

Production에서는 `database.host`를 직접 설정하지 않고 `secretRef.hostKey`로 Secret에서 가져오도록 설정했는데,
템플릿 조건이 이를 고려하지 않았음.

### 해결

템플릿 조건 수정:

```yaml
# Before
{{- if .Values.database.host }}

# After
{{- if or .Values.database.host .Values.secretRef.hostKey }}
```

### PreSync Hook 주의사항

db-init Job은 ArgoCD `PreSync` hook으로 설정됨:
- 이미 Synced 상태인 앱에서는 실행되지 않음
- 강제 sync 필요: `kubectl patch application db-init-prod -n argocd --type merge -p '{"operation":{"sync":{}}}'`
- 또는 Application 삭제 후 재생성

---

## 2024-12-29: PVC Pending (StorageClass 없음)

### 증상

```
grafana, prometheus, loki Pod가 Pending 상태
"pod has unbound immediate PersistentVolumeClaims"
```

### 원인

PVC에 `storageClassName`이 지정되지 않았고, 기본 StorageClass도 설정되지 않음.

### 해결

1. **즉시 해결** - gp2를 기본 StorageClass로 설정:

```bash
kubectl patch storageclass gp2 -p \
  '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'
```

2. **영구 해결** - Terraform에서 자동 설정 (`terraform/prod/compute/storage.tf`):

```hcl
resource "kubernetes_annotations" "gp2_default" {
  api_version = "storage.k8s.io/v1"
  kind        = "StorageClass"
  metadata {
    name = "gp2"
  }
  annotations = {
    "storageclass.kubernetes.io/is-default-class" = "true"
  }
  force = true

  depends_on = [module.eks]
}
```

### 참고

기존 Pending PVC는 기본 StorageClass 설정 후에도 자동 바인딩되지 않음.
PVC 삭제 후 재생성 필요 (모니터링 앱 재배포).

---

## 2024-12-29: Production에서 Frontend Deployment 불필요

### 증상

```
frontend Pod가 ImagePullBackOff
ECR에 frontend 이미지가 없음
```

### 원인

Production에서는 CloudFront + S3로 프론트엔드를 제공하므로 EKS에 frontend Deployment가 필요없음.
하지만 이전에 배포된 frontend 리소스가 남아있었음.

### 해결

1. **frontend 리소스 삭제**:

```bash
kubectl delete deploy frontend -n wealist-prod
kubectl delete svc frontend -n wealist-prod
```

2. **ArgoCD apps/prod/에서 frontend.yaml 제거** (이미 제거됨)

3. **GitHub Actions에서 prod 환경 frontend 빌드 제외** (필요시)

### Production Frontend 배포 방식

```
GitHub Actions → S3 업로드 → CloudFront 배포
(EKS 미사용)
```

---

## 2024-12-29: 모니터링 이미지 ImagePullBackOff (public.ecr.aws)

### 증상

```
grafana, prometheus, loki, promtail Pod가 ImagePullBackOff
"failed to pull image public.ecr.aws/grafana/grafana:10.2.2"
```

### 원인

`k8s/helm/environments/prod.yaml`에 `public.ecr.aws` 이미지가 설정되어 있었으나,
해당 이미지들이 ECR Public Gallery에 존재하지 않거나 접근 불가.

```yaml
# 문제의 설정 (public.ecr.aws 이미지 존재하지 않음)
grafana:
  image:
    repository: public.ecr.aws/grafana/grafana  # 없음!
loki:
  image:
    repository: public.ecr.aws/grafana/loki  # 없음!
```

### 해결

Docker Hub 공식 이미지로 변경:

```yaml
# k8s/helm/environments/prod.yaml

# Prometheus
prometheus:
  image:
    repository: prom/prometheus
    tag: "v2.48.0"

# Loki
loki:
  image:
    repository: grafana/loki
    tag: "2.9.2"

# Promtail
promtail:
  image:
    repository: grafana/promtail
    tag: "2.9.2"

# Grafana
grafana:
  image:
    repository: grafana/grafana
    tag: "10.2.2"

# Postgres Exporter
postgresExporter:
  image:
    repository: bitnami/postgres-exporter
    tag: "0.15.0"

# Redis Exporter
redisExporter:
  image:
    repository: bitnami/redis-exporter
    tag: "1.55.0"
```

### 이미지 레지스트리 참고

| 용도 | Docker Hub | ECR Public |
|------|------------|------------|
| Grafana | `grafana/grafana` | ❌ 없음 |
| Loki | `grafana/loki` | ❌ 없음 |
| Prometheus | `prom/prometheus` | ✅ 있음 |
| Bitnami Exporters | `bitnami/*` | ✅ 있음 |

> **Note**: ECR Public은 일부 이미지만 미러링되어 있으므로, Docker Hub 공식 이미지 사용을 권장.

---

## 2024-12-29: Exporter 이미지 ImagePullBackOff (bitnami 태그 없음)

### 증상

```
postgres-exporter, redis-exporter Pod가 ImagePullBackOff
"failed to pull image bitnami/postgres-exporter:0.15.0: not found"
```

### 원인

`bitnami/postgres-exporter`, `bitnami/redis-exporter`는 Docker Hub에서 버전 태그 형식이 다름.
Bitnami 이미지는 SHA 기반 태그만 제공하거나 태그가 존재하지 않음.

### 해결

Prometheus 커뮤니티 공식 exporter 이미지 사용:

```yaml
# k8s/helm/environments/prod.yaml

# Postgres Exporter (공식)
postgresExporter:
  image:
    repository: prometheuscommunity/postgres-exporter
    tag: "v0.18.1"

# Redis Exporter (공식)
redisExporter:
  image:
    repository: oliver006/redis_exporter
    tag: "v1.80.1"
```

### Exporter 이미지 참고

| 용도 | 올바른 이미지 | 잘못된 이미지 |
|------|--------------|--------------|
| PostgreSQL | `prometheuscommunity/postgres-exporter` | `bitnami/postgres-exporter` |
| Redis | `oliver006/redis_exporter` | `bitnami/redis-exporter` |

---

## 2024-12-29: Prometheus PVC 권한 오류 (permission denied)

### 증상

```
Prometheus Pod가 CrashLoopBackOff
"Error opening query log file: open /prometheus/queries.active: permission denied"
"panic: Unable to create mmap-ed active query log"
```

### 원인

Prometheus 컨테이너는 user `nobody` (UID 65534)로 실행되지만,
PVC가 root 소유로 마운트되어 쓰기 권한이 없음.

```yaml
# 문제: securityContext가 없음
spec:
  containers:
    - name: prometheus
      # ...
```

### 해결

Pod securityContext에 fsGroup 추가:

```yaml
# k8s/helm/charts/wealist-monitoring/templates/prometheus/deployment.yaml
spec:
  securityContext:
    runAsUser: 65534      # nobody
    runAsGroup: 65534     # nogroup
    fsGroup: 65534        # PVC 마운트 그룹 소유권
    runAsNonRoot: true
  containers:
    - name: prometheus
      # ...
```

### fsGroup 설명

| 필드 | 값 | 설명 |
|------|-----|------|
| runAsUser | 65534 | 컨테이너 실행 UID (nobody) |
| runAsGroup | 65534 | 컨테이너 실행 GID |
| fsGroup | 65534 | 볼륨 마운트 시 그룹 소유권 변경 |

`fsGroup`을 설정하면 Kubernetes가 PVC 마운트 시 해당 그룹으로 소유권을 변경해줌.

### 참고: 다른 모니터링 컴포넌트

| 컴포넌트 | 기본 UID | fsGroup 필요 |
|----------|----------|--------------|
| Prometheus | 65534 | ✅ 필요 |
| Grafana | 472 | 필요할 수 있음 |
| Loki | 10001 | 필요할 수 있음 |

---

## 2024-12-29: Prometheus가 Istio Ambient 환경에서 메트릭 수집 실패

### 증상

```
Grafana에서 Istio 메트릭만 표시됨
서비스 메트릭 (user-service, board-service 등) 수집 안됨
ArgoCD 메트릭 수집 안됨
Prometheus 타겟이 "connection reset by peer" 오류로 DOWN
```

### 로그

```bash
# Prometheus 타겟 상태 확인
kubectl exec -n wealist-prod deploy/prometheus -- \
  wget -q -O - 'http://localhost:9090/api/monitoring/prometheus/api/v1/targets' | \
  jq -r '.data.activeTargets[] | "\(.scrapePool): \(.health) - \(.lastError)"'

# 출력:
# user-service: down - Get "http://user-service:8081/metrics": read tcp 10.0.1.161:44688->172.20.37.254:8081: read: connection reset by peer
# board-service: down - Get "http://board-service:8000/metrics": connection reset by peer
```

### 원인

**Istio Ambient 모드 + STRICT mTLS 환경에서 Prometheus가 mesh 외부에 있었음:**

```
Prometheus (mesh 외부)  ─── plain HTTP ───X───> 서비스 (STRICT mTLS)
      ↓                                           ↑
istio.io/dataplane-mode: none              ztunnel이 mTLS 요구 → 연결 거부
```

1. Prometheus Pod에 `istio.io/dataplane-mode: none` 라벨이 설정되어 mesh 외부
2. 서비스들은 Ambient mesh 내부 + STRICT mTLS 적용
3. Prometheus가 plain HTTP로 접근하려 하면 ztunnel이 mTLS를 요구하여 연결 리셋

### 해결

**모니터링 스택을 Ambient mesh에 포함:**

```yaml
# k8s/helm/charts/wealist-monitoring/templates/prometheus/deployment.yaml
# Before
labels:
  app: prometheus
  istio.io/dataplane-mode: none  # ❌ mesh 외부

# After
labels:
  app: prometheus
  # istio.io/dataplane-mode: none 제거 → mesh에 포함
  # PeerAuthentication PERMISSIVE로 외부 접근 허용됨
```

동일하게 Grafana, Loki에서도 `istio.io/dataplane-mode: none` 제거.

**Promtail은 수정 불필요** - 원래 `none` 라벨이 없어서 자동으로 mesh에 포함됨.

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `prometheus/deployment.yaml` | `istio.io/dataplane-mode: none` 제거 |
| `grafana/deployment.yaml` | `istio.io/dataplane-mode: none` 제거 |
| `loki/deployment.yaml` | `istio.io/dataplane-mode: none` 제거 |

### 검증

```bash
# Prometheus 타겟 상태 확인
kubectl exec -n wealist-prod deploy/prometheus -- \
  wget -q -O - 'http://localhost:9090/api/monitoring/prometheus/api/v1/targets' | \
  jq -r '.data.activeTargets[] | "\(.scrapePool): \(.health)"' | sort | uniq -c

# 기대 출력: 모든 서비스가 UP
#   1 auth-service: up
#   1 board-service: up
#   1 user-service: up
#   ...
```

### 참고: Ambient 모드에서 Prometheus 메트릭 수집

| 구성 | 메트릭 수집 | 비고 |
|------|------------|------|
| Prometheus mesh 외부 + STRICT mTLS | ❌ 실패 | connection reset |
| Prometheus mesh 내부 + STRICT mTLS | ✅ 성공 | ztunnel이 mTLS 처리 |
| Prometheus mesh 외부 + PERMISSIVE | ✅ 성공 | plain HTTP 허용 (비권장) |

**권장**: Prometheus를 mesh에 포함하여 mTLS로 메트릭 수집 (보안 강화)

---

## 2024-12-29: ArgoCD 메트릭 수집 실패

### 증상

```
Prometheus에서 ArgoCD 메트릭이 수집되지 않음
argocd-application-controller, argocd-server 등 모든 ArgoCD 타겟 없음
```

### 원인

1. **ArgoCD Helm에서 metrics 서비스가 비활성화됨**
   - Prometheus 설정이 `argocd-metrics`, `argocd-server-metrics` 서비스를 찾음
   - 하지만 해당 서비스들이 생성되지 않음

2. **Prometheus 설정이 endpoints 기반 스크래핑 사용**
   ```yaml
   # 기존 설정 - 서비스 이름으로 endpoints 검색
   - job_name: 'argocd-application-controller'
     kubernetes_sd_configs:
       - role: endpoints
     relabel_configs:
       - source_labels: [__meta_kubernetes_service_name]
         action: keep
         regex: argocd-metrics  # ← 이 서비스가 없음!
   ```

### 해결

**Pod 직접 스크래핑으로 변경:**

```yaml
# k8s/helm/charts/wealist-monitoring/templates/prometheus/configmap.yaml
# After - Pod를 직접 스크래핑
- job_name: 'argocd-application-controller'
  kubernetes_sd_configs:
    - role: pod  # endpoints → pod
      namespaces:
        names:
          - argocd
  relabel_configs:
    - source_labels: [__meta_kubernetes_pod_label_app_kubernetes_io_name]
      action: keep
      regex: argocd-application-controller  # Pod 라벨로 필터
    - source_labels: [__meta_kubernetes_pod_container_port_name]
      action: keep
      regex: metrics  # metrics 포트만
```

### ArgoCD Pod 메트릭 포트

| 컴포넌트 | Port | 포트 이름 |
|----------|------|----------|
| application-controller | 8082 | metrics |
| server | 8083 | metrics |
| repo-server | 8084 | metrics |
| applicationset-controller | 8080 | metrics |
| notifications-controller | 9001 | metrics |

### 검증

```bash
# ArgoCD 메트릭 확인
kubectl exec -n wealist-prod deploy/prometheus -- \
  wget -q -O - 'http://localhost:9090/api/monitoring/prometheus/api/v1/targets' | \
  jq -r '.data.activeTargets[] | select(.scrapePool | startswith("argocd")) | "\(.scrapePool): \(.health)"'

# 기대 출력:
# argocd-application-controller: up
# argocd-server: up
# argocd-repo-server: up
# argocd-applicationset-controller: up
# argocd-notifications-controller: up
```

---

## 2024-12-29: 모니터링 Pod CrashLoopBackOff (PVC Lock 충돌)

### 증상

```
Prometheus, Loki Pod가 CrashLoopBackOff
새 Pod와 기존 Pod가 동시에 존재
```

### 로그

```bash
# Prometheus
kubectl logs prometheus-68ddd48c9c-vmxdg -n wealist-prod
# "opening storage failed: lock DB directory: resource temporarily unavailable"

# Loki
kubectl logs loki-75fb48b7bb-nkt5c -n wealist-prod
# "failed to init delete store: timeout"
```

### 원인

1. ArgoCD sync로 새 ReplicaSet 생성
2. 기존 Pod가 PVC lock을 잡고 있음 (ReadWriteOnce)
3. 새 Pod가 같은 PVC에 접근하려다 lock 획득 실패

```
기존 Pod (prometheus-54846bb74f-xxx) ─── lock ───> PVC
새 Pod (prometheus-68ddd48c9c-xxx)  ─── blocked ──> PVC  → CrashLoopBackOff
```

### 해결

**기존 Pod 삭제 후 새 Pod가 정상 시작:**

```bash
# 기존 Pod 삭제
kubectl delete pod prometheus-54846bb74f-xxx loki-74bc8b7989-xxx -n wealist-prod

# 또는 Deployment scale 리셋
kubectl scale deploy prometheus --replicas=0 -n wealist-prod
kubectl scale deploy prometheus --replicas=1 -n wealist-prod
```

### 예방

Deployment 업데이트 시 `strategy.type: Recreate` 사용 고려:

```yaml
spec:
  strategy:
    type: Recreate  # 기존 Pod 먼저 삭제 후 새 Pod 생성
```

또는 RollingUpdate + `maxSurge: 0`:

```yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 0        # 새 Pod 생성 전 기존 Pod 삭제
      maxUnavailable: 1
```

### 참고

PVC가 `ReadWriteOnce`인 경우 동시에 하나의 Pod만 접근 가능.
모니터링 스택에서는 HA를 위해 `ReadWriteMany` 스토리지 또는 StatefulSet 사용 고려.

---

## 2024-12-29: OAuth2 Google 로그인 간헐적 실패 (Multiple Pods)

### 증상

```
Google 로그인 시 어떨 때는 성공, 어떨 때는 실패
auth-service Pod가 2개 이상일 때 발생
"CSRF detected - state parameter was required but no state could be found" 오류
```

### 원인

**Spring Security OAuth2가 state 파라미터를 메모리 세션(HttpSession)에 저장:**

```
1. 사용자 → Google 로그인 요청 → Pod A (state=abc123 메모리에 저장)
2. Google OAuth 완료
3. Google → 콜백 → Pod B (state를 찾을 수 없음 → 실패!)
```

- `SecurityConfig.java`에서 `SessionCreationPolicy.IF_REQUIRED` 사용
- 세션이 메모리에 저장되어 Pod 간 공유 불가
- `spring-session-data-redis` 의존성 및 `@EnableRedisHttpSession` 누락

### 해결

**Spring Session Redis를 사용하여 세션을 Redis에 저장:**

1. **build.gradle에 의존성 추가:**

```gradle
// 기존
implementation 'org.springframework.boot:spring-boot-starter-data-redis'

// 추가
implementation 'org.springframework.session:spring-session-data-redis'
```

2. **RedisSessionConfig.java 생성:**

```java
package OrangeCloud.AuthService.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.session.data.redis.config.annotation.web.http.EnableRedisHttpSession;

@Configuration
@EnableRedisHttpSession(maxInactiveIntervalInSeconds = 1800) // 30분
public class RedisSessionConfig {
    // Spring Session이 자동으로 Redis에 세션 저장
}
```

3. **application.yml에 세션 설정 추가:**

```yaml
spring:
  session:
    store-type: redis
    redis:
      namespace: wealist:auth:session
```

### 변경된 파일

| 파일 | 변경 |
|------|------|
| `services/auth-service/build.gradle` | `spring-session-data-redis` 의존성 추가 |
| `services/auth-service/src/.../config/RedisSessionConfig.java` | 신규 생성 |
| `services/auth-service/src/main/resources/application.yml` | 세션 설정 추가 |

### 동작 원리

```
Before (문제):
  Pod A: HttpSession{state=abc123} (메모리)
  Pod B: HttpSession{} (state 없음)
  → 콜백이 Pod B로 가면 실패

After (해결):
  Redis: wealist:auth:session:xyz → {state=abc123}
  Pod A/B 모두 Redis에서 동일 세션 조회
  → 어느 Pod로 가도 state 검증 성공
```

### 검증

```bash
# 배포 후 Google 로그인 10회 연속 테스트
for i in {1..10}; do
  echo "Test $i: $(curl -s -o /dev/null -w '%{http_code}' https://api.wealist.co.kr/oauth2/authorization/google)"
done

# Redis에서 세션 키 확인
kubectl exec -it redis-0 -n wealist-prod -- redis-cli KEYS "wealist:auth:session:*"
```

### 참고: OAuth2 Multiple Pods 환경 체크리스트

| 항목 | 확인 |
|------|------|
| `spring-session-data-redis` 의존성 | ✅ |
| `@EnableRedisHttpSession` 어노테이션 | ✅ |
| Redis 연결 설정 (호스트, 포트) | ✅ |
| 세션 만료 시간 설정 | ✅ (30분) |

---
