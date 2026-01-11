---
title: "Istio Ambient에서 Sidecar로 돌아온 이유"
excerpt: "카나리 배포와 Circuit Breaker가 필요해서 Ambient 모드를 Sidecar로 전환한 과정"
category: istio
tags:
  - Istio
  - Ambient
  - Sidecar
  - Service Mesh
  - EKS
series:
  name: "istio-ambient"
  order: 7
date: '2026-01-05'
---

## 한 줄 요약

> Istio Ambient 모드로 6개월 운영했지만, 카나리 배포와 Circuit Breaker가 필요해서 Sidecar로 돌아왔다.

## Impact

- **영향 범위**: 전체 서비스 메시
- **변경 사항**: Ambient → Sidecar
- **소요 시간**: 약 4시간
- **발생일**: 2026-01-05

---

## 전환 배경

### Ambient vs Sidecar 비교

| 항목 | Ambient | Sidecar |
|------|---------|---------|
| L4 처리 | ztunnel (노드당 1개) | Envoy sidecar (Pod당 1개) |
| L7 처리 | Waypoint (선택적) | Envoy sidecar |
| 리소스 사용 | 적음 | 많음 |
| 카나리 배포 | 제한적 | VirtualService weight |
| Circuit Breaker | 미지원 | 지원 |
| 연결 풀 관리 | 미지원 | 지원 |

### 전환 이유

Ambient 모드로 6개월간 운영하면서 몇 가지 한계에 부딪혔습니다:

1. **카나리 배포 필요**: Argo Rollouts + Istio VirtualService weight 기반 배포를 하고 싶었습니다
2. **Circuit Breaker 필요**: 외부 서비스 장애 시 연쇄 장애 방지가 필요했습니다
3. **연결 풀 관리**: DB 연결 풀 최적화를 Istio 레벨에서 하고 싶었습니다

Ambient 모드는 L7 기능을 Waypoint로 제공하지만, 카나리 배포처럼 정교한 트래픽 제어는 Sidecar가 더 안정적입니다.

---

## 전환 과정

### 1. 네임스페이스 라벨 변경

```bash
# Ambient 모드 라벨 제거
kubectl label namespace wealist-prod istio.io/dataplane-mode-

# Sidecar 모드 라벨 적용
kubectl label namespace wealist-prod istio-injection=enabled
```

### 2. Istio 프로파일 변경

**Before (Ambient):**
```hcl
# terraform/prod/compute/helm-releases.tf
resource "helm_release" "istiod" {
  set {
    name  = "profile"
    value = "ambient"
  }
}
```

**After (Sidecar):**
```hcl
resource "helm_release" "istiod" {
  # profile 설정 제거 → 기본값(default) 사용
}
```

### 3. ztunnel 리소스 제거

Ambient 전용 컴포넌트인 ztunnel을 제거합니다:

```hcl
# 삭제
resource "helm_release" "istio_ztunnel" {
  # ...
}
```

### 4. Waypoint 제거

Ambient 모드에서만 사용하는 Waypoint를 제거합니다:

```bash
kubectl delete deployment wealist-waypoint -n wealist-prod
kubectl delete service wealist-waypoint -n wealist-prod
kubectl delete gateway wealist-waypoint -n wealist-prod
```

---

## AuthorizationPolicy 마이그레이션

### Ambient 방식 (targetRef)

```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: auth-service-policy
spec:
  targetRef:
    kind: Service
    name: auth-service
  rules:
    - from:
        - source:
            principals: ["cluster.local/ns/wealist-prod/sa/user-service"]
```

### Sidecar 방식 (selector)

```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: auth-service-policy
spec:
  selector:
    matchLabels:
      app: auth-service
  rules:
    - from:
        - source:
            principals: ["cluster.local/ns/wealist-prod/sa/user-service"]
```

**변경 포인트**:
- `targetRef` → `selector`
- `kind: Service` → `matchLabels`

---

## 인프라 컴포넌트 Sidecar 제외

Sidecar 모드에서는 네임스페이스의 모든 Pod에 Sidecar가 주입됩니다. PostgreSQL, Redis 같은 인프라 컴포넌트에는 불필요하며 오히려 문제를 일으킬 수 있습니다.

### Sidecar 제외 설정

```yaml
# statefulset.yaml
spec:
  template:
    metadata:
      annotations:
        sidecar.istio.io/inject: "false"
```

### 제외 대상

| 컴포넌트 | 제외 필요 | 이유 |
|---------|---------|------|
| PostgreSQL | 필수 | DB는 직접 TCP 연결 필요 |
| Redis | 필수 | 캐시는 mTLS 오버헤드 불필요 |
| Prometheus | 권장 | 메트릭 수집기 |
| Grafana | 권장 | 대시보드 |
| OTEL Collector | 권장 | 트레이스 수집기 |

### 확인 명령어

```bash
# Sidecar 주입 여부 확인
kubectl get pods -n wealist-prod -o jsonpath='{range .items[*]}{.metadata.name}: {.spec.containers[*].name}{"\n"}{end}'

# 예상 결과:
# postgres-0: postgres              ← istio-proxy 없음
# redis-0: redis                    ← istio-proxy 없음
# user-service-xxx: user-service, istio-proxy  ← 주입됨
```

---

## Sidecar 리소스 설정

Pod마다 Sidecar가 추가되므로 리소스 설정이 중요합니다:

```yaml
# prod.yaml
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

### 리소스 영향

| 구성 | Pod 수 | Sidecar 메모리 | 총 추가 메모리 |
|------|--------|---------------|---------------|
| 7개 서비스 × 2 replica | 14개 | 128Mi | ~1.8Gi |

Ambient 모드에서는 노드당 ztunnel 하나만 있었지만, Sidecar는 Pod마다 있으므로 리소스 사용량이 늘어납니다.

---

## Security Group 업데이트

### 제거할 규칙 (Ambient 전용)

| 규칙 | 포트 | 용도 |
|------|------|------|
| `istio_hbone_ingress` | 15008 | HBONE 터널 (ztunnel) |
| `istio_hbone_egress` | 15008 | HBONE 터널 (ztunnel) |

### 유지할 규칙

| 규칙 | 포트 | 용도 |
|------|------|------|
| `istio_webhook` | 15017 | Sidecar injection webhook |
| `istio_xds` | 15012 | istiod XDS |

---

## 전환 후 워크로드 재시작

Sidecar가 주입되려면 Pod을 재시작해야 합니다:

```bash
# 모든 Deployment 재시작
kubectl rollout restart deployment -n wealist-prod

# 확인
kubectl get pods -n wealist-prod
# READY: 2/2 (main + istio-proxy)
```

---

## Argo Rollouts 설정

Sidecar로 전환한 주요 목적 중 하나인 카나리 배포를 설정합니다.

### VirtualService 카나리 라우팅

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: user-service
spec:
  hosts:
    - user-service
  http:
    - route:
        - destination:
            host: user-service
            subset: stable
          weight: 90
        - destination:
            host: user-service
            subset: canary
          weight: 10
```

### DestinationRule subset

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: user-service
spec:
  host: user-service
  subsets:
    - name: stable
      labels:
        version: stable
    - name: canary
      labels:
        version: canary
```

### Argo Rollout

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: user-service
spec:
  strategy:
    canary:
      canaryService: user-service-canary
      stableService: user-service
      trafficRouting:
        istio:
          virtualService:
            name: user-service
            routes:
              - primary
      steps:
        - setWeight: 10
        - pause: {duration: 5m}
        - setWeight: 30
        - pause: {duration: 5m}
        - setWeight: 50
        - pause: {duration: 5m}
```

---

## 트러블슈팅

### Sidecar 주입 안 됨

```bash
# 네임스페이스 라벨 확인
kubectl get namespace wealist-prod --show-labels | grep istio-injection

# 해결
kubectl label namespace wealist-prod istio-injection=enabled --overwrite
kubectl rollout restart deployment -n wealist-prod
```

### 서비스 간 통신 403 Forbidden

```bash
# AuthorizationPolicy 확인
kubectl get authorizationpolicy -n wealist-prod

# istio-proxy 로그 확인
kubectl logs deploy/user-service -c istio-proxy -n wealist-prod | grep -i denied
```

AuthorizationPolicy를 `targetRef`에서 `selector`로 변경했는지 확인하세요.

### mTLS 연결 실패

```bash
# mTLS 상태 확인
istioctl authn tls-check deploy/user-service.wealist-prod

# PeerAuthentication 확인
kubectl get peerauthentication -n wealist-prod
```

---

## 📚 배운 점

### Ambient는 아직 진화 중

Istio Ambient 모드는 리소스 효율성 면에서 훌륭하지만, 아직 일부 고급 기능이 부족합니다:

- 카나리 배포 (weight 기반)
- Circuit Breaker
- 연결 풀 관리
- 상세한 L7 정책

Production에서 이런 기능이 필요하다면 Sidecar가 더 안정적인 선택입니다.

### 마이그레이션 체크리스트

전환 시 확인해야 할 것들:

- [ ] 네임스페이스 라벨 변경 (`istio-injection=enabled`)
- [ ] AuthorizationPolicy 마이그레이션 (`targetRef` → `selector`)
- [ ] Waypoint 제거
- [ ] ztunnel 리소스 제거
- [ ] 인프라 컴포넌트 Sidecar 제외
- [ ] Security Group 규칙 업데이트
- [ ] 워크로드 재시작

---

## 요약

| 항목 | Before (Ambient) | After (Sidecar) |
|------|-----------------|-----------------|
| Istio 프로파일 | ambient | default |
| 네임스페이스 라벨 | `istio.io/dataplane-mode=ambient` | `istio-injection=enabled` |
| AuthorizationPolicy | `targetRef` | `selector` |
| L7 프록시 | Waypoint | Envoy sidecar |
| 카나리 배포 | 제한적 | VirtualService weight |
| Circuit Breaker | 미지원 | 지원 |

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `terraform/prod/compute/helm-releases.tf` | Istio Helm 설정 |
| `terraform/prod/compute/eks.tf` | Security Group 규칙 |
| `k8s/helm/charts/istio-config/templates/authorization-policy.yaml` | AuthorizationPolicy |
| `k8s/helm/charts/istio-config/templates/virtualservice.yaml` | VirtualService |

---

## 참고

- [Istio Ambient vs Sidecar](https://istio.io/latest/docs/ops/ambient/architecture/)
- [Istio AuthorizationPolicy](https://istio.io/latest/docs/reference/config/security/authorization-policy/)
- [Argo Rollouts + Istio](https://argoproj.github.io/argo-rollouts/features/traffic-management/istio/)
