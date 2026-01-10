# Production 트러블슈팅 V7 (2026-01-05)

## 개요

이 문서는 Istio Ambient → Sidecar 전환, Argo Rollouts 설정, video-service 제거 과정에서 발생한 이슈를 다룹니다.

---

## 1. Istio Ambient → Sidecar 전환

### 1.1 전환 배경

| 항목 | Ambient | Sidecar |
|------|---------|---------|
| L4 처리 | ztunnel | Envoy sidecar |
| L7 처리 | Waypoint | Envoy sidecar |
| 카나리 배포 | 제한적 | VirtualService weight |
| Circuit Breaker | 미지원 | 지원 |

**전환 이유**: 카나리 배포, Circuit Breaker, 연결 풀 관리 등 고급 기능 필요

### 1.2 주요 변경 파일

| 파일 | 변경 내용 |
|------|----------|
| `k8s/helm/scripts/*/0.setup-cluster.sh` | `profile=ambient` → `profile=default` |
| `k8s/helm/charts/istio-config/values.yaml` | `ambient.enabled: false`, `sidecar.enabled: true` |
| `k8s/helm/charts/istio-config/templates/authorization-policy.yaml` | `targetRef` → `selector` |
| `k8s/helm/charts/wealist-common/templates/_deployment.tpl` | Sidecar annotations 추가 |

### 1.3 네임스페이스 라벨 변경

```bash
# Ambient 모드 (제거)
kubectl label namespace wealist-prod istio.io/dataplane-mode=ambient --overwrite

# Sidecar 모드 (적용)
kubectl label namespace wealist-prod istio-injection=enabled --overwrite
```

### 1.4 AuthorizationPolicy 마이그레이션

**Ambient (L7 targetRef)**:
```yaml
spec:
  targetRef:
    kind: Service
    name: auth-service
```

**Sidecar (selector)**:
```yaml
spec:
  selector:
    matchLabels:
      app: auth-service
```

### 1.5 Waypoint 제거

Ambient 모드에서만 사용되는 Waypoint를 제거합니다:

```bash
# Waypoint 삭제
kubectl delete deployment wealist-waypoint -n wealist-prod
kubectl delete service wealist-waypoint -n wealist-prod
kubectl delete gateway wealist-waypoint -n wealist-prod

# Helm 차트에서 waypoint.yaml 조건부 비활성화 또는 삭제
```

**파일**: `k8s/helm/charts/istio-config/templates/waypoint.yaml` 삭제

### 1.6 Sidecar 리소스 설정

```yaml
# k8s/helm/environments/prod.yaml
istio:
  sidecar:
    enabled: true
    resources:
      requests:
        cpu: 100m
        memory: 128Mi
      limits:
        cpu: 500m
        memory: 256Mi
```

---

## 2. 인프라 컴포넌트 Sidecar 제외

### 2.1 문제

Sidecar 모드에서 네임스페이스에 `istio-injection=enabled` 라벨이 있으면 **모든 Pod**에 Sidecar가 주입됩니다.

PostgreSQL, Redis 같은 인프라 컴포넌트에는 Sidecar가 불필요하며, 오히려 성능 저하 및 문제를 유발합니다.

### 2.2 해결: Sidecar 제외 Annotation

```yaml
# k8s/helm/charts/wealist-infrastructure/templates/postgres/statefulset.yaml
spec:
  template:
    metadata:
      annotations:
        sidecar.istio.io/inject: "false"
```

```yaml
# k8s/helm/charts/wealist-infrastructure/templates/redis/statefulset.yaml
spec:
  template:
    metadata:
      annotations:
        sidecar.istio.io/inject: "false"
```

### 2.3 제외 대상 목록

| 컴포넌트 | 제외 필요 | 이유 |
|---------|---------|------|
| PostgreSQL | 필수 | DB는 직접 TCP 연결 필요 |
| Redis | 필수 | 캐시는 mTLS 오버헤드 불필요 |
| MinIO | 권장 | Object Storage |
| Prometheus | 권장 | 메트릭 수집기 |
| Grafana | 권장 | 대시보드 |
| OTEL Collector | 권장 | 트레이스 수집기 |

### 2.4 확인 명령어

```bash
# Sidecar 주입 여부 확인
kubectl get pods -n wealist-prod -o jsonpath='{range .items[*]}{.metadata.name}: {.spec.containers[*].name}{"\n"}{end}'

# 예상 결과:
# postgres-0: postgres  ← istio-proxy 없음
# redis-0: redis        ← istio-proxy 없음
# user-service-xxx: user-service, istio-proxy  ← 주입됨
```

---

## 3. Terraform Istio 설정 변경 (Production)

### 3.1 ztunnel 리소스 제거

**파일**: `terraform/prod/compute/helm-releases.tf`

```hcl
# 삭제할 리소스
resource "helm_release" "istio_ztunnel" {
  # Ambient 전용 - Sidecar에서 불필요
}
```

### 3.2 istiod profile 변경

```hcl
resource "helm_release" "istiod" {
  # 제거: profile = "ambient"
  # Sidecar는 기본 profile 사용
}
```

### 3.3 Security Group 업데이트

**제거할 규칙** (Ambient 전용):

| 규칙 | 포트 | 이유 |
|------|------|------|
| `istio_hbone_ingress` | 15008 | HBONE 터널 (ztunnel) |
| `istio_hbone_egress` | 15008 | HBONE 터널 (ztunnel) |

**파일**: `terraform/prod/compute/eks.tf`

---

## 4. Argo Rollouts 설정

### 4.1 버전 고정 (v1.8.3)

**문제**: "latest" 태그 사용 시 예기치 않은 버전 업그레이드 위험

```bash
# Before (위험)
kubectl apply -f https://github.com/argoproj/argo-rollouts/releases/latest/download/install.yaml

# After (안전)
ARGO_ROLLOUTS_VERSION="v1.8.3"
kubectl apply -f https://github.com/argoproj/argo-rollouts/releases/download/${ARGO_ROLLOUTS_VERSION}/install.yaml
```

**변경 파일**:
- `k8s/helm/scripts/localhost/0.setup-cluster.sh`
- `k8s/helm/scripts/dev/0.setup-cluster.sh`

### 4.2 Rollout 템플릿

**파일**: `k8s/helm/charts/wealist-common/templates/_rollout.tpl`

```yaml
{{- define "wealist-common.rollout" -}}
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: {{ .name }}
spec:
  strategy:
    canary:
      canaryService: {{ .name }}-canary
      stableService: {{ .name }}
      trafficRouting:
        istio:
          virtualService:
            name: {{ .name }}
            routes:
              - primary
      steps:
        - setWeight: 10
        - pause: {duration: 5m}
        - setWeight: 30
        - pause: {duration: 5m}
        - setWeight: 50
        - pause: {duration: 5m}
{{- end }}
```

### 4.3 VirtualService 카나리 라우팅

```yaml
# k8s/helm/charts/istio-config/templates/virtualservice.yaml
{{- if .Values.canary.enabled }}
- route:
  - destination:
      host: {{ .serviceName }}
      subset: stable
    weight: {{ .Values.canary.stableWeight | default 100 }}
  - destination:
      host: {{ .serviceName }}
      subset: canary
    weight: {{ .Values.canary.canaryWeight | default 0 }}
{{- end }}
```

---

## 5. Istio 버전 업그레이드 (1.24.0 → 1.28.2)

### 5.1 문제

| Version | 지원 상태 | 만료일 |
|---------|----------|--------|
| 1.24.x | 종료 | 2025-06-19 |
| 1.28.x | Active | ~2026 Q4 |

**Localhost의 Istio 1.24.0은 이미 지원 종료됨**

### 5.2 변경 파일

| 파일 | 변경 내용 |
|------|----------|
| `k8s/helm/scripts/localhost/0.setup-cluster.sh` | `ISTIO_VERSION="1.28.2"` |
| `k8s/helm/scripts/dev/0.setup-cluster.sh` | `ISTIO_VERSION="1.28.2"` |
| `makefiles/kind.mk` | `ISTIO_VERSION=1.28.2` |
| `makefiles/helm.mk` | `ISTIO_VERSION=1.28.2` |

### 5.3 업그레이드 절차

```bash
# 1. istioctl 업그레이드
curl -L https://istio.io/downloadIstio | ISTIO_VERSION=1.28.2 sh -

# 2. Istio 업그레이드 (in-place)
istioctl upgrade --set profile=default

# 3. 워크로드 재시작 (Sidecar 업데이트)
kubectl rollout restart deployment -n wealist-prod
```

---

## 6. OTEL Collector Connectors 설정

### 6.1 Span Metrics Connector

트레이스에서 RED 메트릭을 자동 생성합니다.

**파일**: `k8s/helm/charts/wealist-monitoring/templates/otel-collector/configmap.yaml`

```yaml
connectors:
  spanmetrics:
    namespace: traces.spanmetrics
    histogram:
      unit: s
      explicit:
        buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
    dimensions:
      - name: service.name
      - name: http.method
      - name: http.status_code
      - name: http.route
    exemplars:
      enabled: true
```

### 6.2 Service Graph Connector

서비스 의존성 그래프를 자동 생성합니다.

```yaml
connectors:
  servicegraph:
    store:
      ttl: 2m
      max_items: 10000
    cache_loop: 1m
    dimensions:
      - service.namespace
      - http.method
```

### 6.3 파이프라인 설정

```yaml
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp/tempo, spanmetrics, servicegraph]
    metrics/spanmetrics:
      receivers: [spanmetrics]
      exporters: [prometheusremotewrite]
    metrics/servicegraph:
      receivers: [servicegraph]
      exporters: [prometheusremotewrite]
```

### 6.4 Prometheus Remote Write 활성화

```yaml
# k8s/helm/environments/localhost.yaml
prometheus:
  remoteWriteReceiver:
    enabled: true

# deployment.yaml에 추가
args:
  - --web.enable-remote-write-receiver
```

### 6.5 생성되는 메트릭

| 메트릭 | 용도 |
|--------|------|
| `traces_spanmetrics_calls_total` | 요청 수 |
| `traces_spanmetrics_duration_seconds_bucket` | 지연 시간 히스토그램 |
| `traces_service_graph_request_total` | 서비스 간 요청 수 |
| `traces_service_graph_request_failed_total` | 서비스 간 실패 요청 |

---

## 7. video-service 완전 제거

### 7.1 제거 이유

사용자 결정: "video-service를 최종으로 안쓰기로 함"

### 7.2 삭제된 디렉토리

| 디렉토리 | 설명 |
|---------|------|
| `k8s/helm/charts/video-service/` | Helm 차트 |
| `services/video-service/` | Go 소스코드 |

### 7.3 삭제된 ArgoCD Applications

| 파일 | 환경 |
|------|------|
| `k8s/argocd/apps/prod/video-service.yaml` | Production |
| `k8s/argocd/apps/dev/video-service.yaml` | Development |

### 7.4 수정된 파일 목록

| 카테고리 | 파일 | 변경 내용 |
|---------|------|----------|
| go.work | `go.work` | video-service 경로 제거 |
| Makefile | `makefiles/_variables.mk` | BACKEND_SERVICES에서 제거 |
| Makefile | `makefiles/services.mk` | 빌드/로드/재배포 타겟 제거 |
| Makefile | `makefiles/validation.mk` | lint, build 검증에서 제거 |
| Makefile | `makefiles/kind.mk` | 서비스 루프에서 제거 |
| Makefile | `makefiles/argo.mk` | 이미지 체크에서 제거 |
| Helm | `k8s/helm/environments/base.yaml` | VIDEO_SERVICE_URL 제거 |
| Helm | `k8s/helm/environments/dev.yaml` | istio.services, config 제거 |
| Helm | `k8s/helm/environments/prod.yaml` | replicaCount 제거 |
| Istio | `istio-config/templates/httproute.yaml` | /api/svc/video 라우트 제거 |
| Istio | `istio-config/templates/virtualservice.yaml` | video-service 블록 제거 |
| Docker | `docker/compose/docker-compose.yml` | video-service 정의 제거 |
| Infra | `wealist-infrastructure/values.yaml` | wealist_video DB 제거 |
| Monitoring | `wealist-monitoring/values.yaml` | videoService 스크래핑 제거 |
| Monitoring | `prometheus/configmap.yaml` | video-service job 제거 |
| Monitoring | `prometheus/alertrules-configmap.yaml` | 알림 규칙에서 제거 |
| Terraform | `terraform/prod/foundation/ecr.tf` | ECR 리포지토리 제거 |
| Terraform | `terraform/prod/compute/pod-identity.tf` | Pod Identity 모듈 제거 |
| ArgoCD | `argocd/scripts/*.sh` | Discord 알림에서 제거 |
| 문서 | `CLAUDE.md` | 서비스 테이블, 라우트 업데이트 |

### 7.5 Terraform ECR 리포지토리 제거

**파일**: `terraform/prod/foundation/ecr.tf`

```hcl
# 제거할 항목
"prod/video-service",
```

**주의**: 기존 이미지는 수동 삭제 필요 (optional)

### 7.6 롤백 방법

video-service를 다시 사용하게 될 경우:

```bash
# Git history에서 삭제된 파일 복원
git checkout HEAD~N -- services/video-service/
git checkout HEAD~N -- k8s/helm/charts/video-service/
git checkout HEAD~N -- k8s/argocd/apps/*/video-service.yaml

# Terraform apply (ECR, Pod Identity 재생성)
cd terraform/prod/foundation && terraform apply
cd terraform/prod/compute && terraform apply
```

---

## 8. 버전 호환성 매트릭스

### 8.1 현재 상태

| Component | Production (EKS) | Localhost (Kind) |
|-----------|-----------------|------------------|
| Kubernetes | 1.34 | 1.30 |
| Istio | 1.28.2 | 1.28.2 |
| Gateway API CRDs | v1.2.0 | v1.2.0 |
| ArgoCD | 5.55.0 | N/A |
| Argo Rollouts | v1.8.3 | v1.8.3 |
| OTEL Collector | v0.114.0 | v0.114.0 |
| Tempo | v2.9.0 | v2.9.0 |

### 8.2 Istio 지원 일정

| Version | 만료일 |
|---------|--------|
| 1.24.x | 2025-06-19 (종료) |
| 1.25.x | 2025-09-22 |
| 1.27.x | 2026-04-30 |
| 1.28.x | ~2026 Q4 |

---

## 9. 일반적인 문제 해결

### 9.1 Sidecar 주입 안 됨

**증상**: Pod에 istio-proxy 컨테이너가 없음

**확인**:
```bash
kubectl get namespace wealist-prod --show-labels | grep istio-injection
```

**해결**:
```bash
kubectl label namespace wealist-prod istio-injection=enabled --overwrite
kubectl rollout restart deployment -n wealist-prod
```

### 9.2 서비스 간 통신 403 Forbidden

**증상**: 서비스 호출 시 403 반환

**확인**:
```bash
kubectl get authorizationpolicy -n wealist-prod
kubectl logs deploy/user-service -c istio-proxy -n wealist-prod | grep -i denied
```

**해결**: AuthorizationPolicy 규칙에 caller 서비스 추가

```yaml
# k8s/helm/charts/istio-config/values.yaml
istio:
  serviceAuthorization:
    rules:
      - targetService: user-service
        allowedCallers:
          - board-service
          - chat-service  # 추가
```

### 9.3 Prometheus 메트릭 없음

**증상**: 새 메트릭 (`traces_spanmetrics_*`)이 안 보임

**확인**:
```bash
# OTEL Collector 로그
kubectl logs deploy/otel-collector -n wealist-prod --tail=100 | grep -i error

# Prometheus remote write 활성화 확인
kubectl get deploy prometheus -n wealist-prod -o yaml | grep enable-remote-write
```

**해결**:
1. Prometheus에 `--web.enable-remote-write-receiver` 플래그 추가
2. OTEL Collector ConfigMap에 `prometheusremotewrite` exporter 추가
3. Pipeline에 connectors 연결 확인

### 9.4 Argo Rollouts 카나리 실패

**증상**: 카나리 배포가 진행되지 않음

**확인**:
```bash
kubectl argo rollouts get rollout user-service -n wealist-prod
kubectl describe rollout user-service -n wealist-prod
```

**해결**:
1. VirtualService가 올바르게 설정되었는지 확인
2. canaryService와 stableService가 존재하는지 확인
3. DestinationRule subset (stable, canary) 확인

---

## 10. 유용한 명령어

### 10.1 Istio 관련

```bash
# Sidecar 버전 확인
istioctl proxy-status

# Envoy 설정 확인
istioctl proxy-config all deploy/user-service -n wealist-prod

# mTLS 상태 확인
istioctl authn tls-check deploy/user-service.wealist-prod
```

### 10.2 Argo Rollouts 관련

```bash
# Rollout 상태
kubectl argo rollouts list rollouts -n wealist-prod

# 롤백
kubectl argo rollouts undo user-service -n wealist-prod

# 즉시 프로모션
kubectl argo rollouts promote user-service -n wealist-prod
```

### 10.3 OTEL 관련

```bash
# Span metrics 확인
curl -s "http://localhost:8080/api/monitoring/prometheus/api/v1/query?query=traces_spanmetrics_calls_total" | jq

# Service graph 확인
curl -s "http://localhost:8080/api/monitoring/prometheus/api/v1/query?query=traces_service_graph_request_total" | jq
```

---

## 요약

| 항목 | 변경 전 | 변경 후 |
|------|--------|--------|
| Istio 모드 | Ambient | Sidecar |
| Istio 버전 | 1.24.0 | 1.28.2 |
| Argo Rollouts | N/A 또는 "latest" | v1.8.3 |
| 서비스 수 | 8개 (6 Go) | 7개 (5 Go) |
| 카나리 배포 | 미지원 | VirtualService weight |
| OTEL Connectors | 미사용 | spanmetrics, servicegraph |
