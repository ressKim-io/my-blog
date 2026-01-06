---
title: "Istio Ambient 모드 실전기 (1): Gateway가 없다"
excerpt: "Sidecar 없는 서비스 메시, Ingress Gateway 누락부터 메트릭 수집 실패까지"
category: kubernetes
tags:
  - EKS
  - Troubleshooting
  - Istio
  - Ambient
  - Prometheus
  - mTLS
  - service-mesh
series:
  name: "eks-troubleshooting"
  order: 2
date: '2025-12-29'
---

## 🎯 한 줄 요약

> Istio Ambient 모드를 선택했더니, Sidecar 모드에서 당연했던 것들이 당연하지 않았다. Gateway가 없고, 메트릭도 안 긁힌다.

## 📊 Impact

- **영향 범위**: 외부 트래픽 수신 불가, 모니터링 메트릭 수집 안 됨
- **소요 시간**: 약 6시간
- **발생일**: 2025-12-29

---

## 💡 왜 Ambient 모드를 선택했나?

Istio를 도입하면서 두 가지 옵션이 있었습니다:

| 구분 | Sidecar 모드 | Ambient 모드 |
|------|-------------|--------------|
| 데이터 플레인 | Envoy Sidecar (Pod마다) | ztunnel (L4) + Waypoint (L7) |
| 리소스 사용량 | 높음 (Pod마다 Envoy) | 낮음 (노드당 ztunnel) |
| 설정 복잡도 | 낮음 | 높음 |
| 성숙도 | 안정적 | 비교적 새로움 |

리소스 효율성 때문에 Ambient 모드를 선택했습니다. 하지만 "설정 복잡도: 높음"이 무엇을 의미하는지 곧 알게 되었습니다.

---

## 🔥 1. Istio Ingress Gateway가 없다

### 증상

Istio 설치를 완료했습니다:

```bash
$ kubectl get pods -n istio-system
NAME                      READY   STATUS    RESTARTS
istiod-xxx                1/1     Running   0
ztunnel-xxx               1/1     Running   0
istio-cni-node-xxx        1/1     Running   0
```

HTTPRoute도 설정했습니다:

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: user-service
spec:
  parentRefs:
    - name: istio-ingressgateway
  rules:
    - matches:
        - path:
            value: /svc/user
      backendRefs:
        - name: user-service
          port: 8081
```

그런데 외부에서 접근이 안 됩니다.

```bash
$ curl https://api.wealist.co.kr/svc/user/health
curl: (7) Failed to connect to api.wealist.co.kr port 443
```

### 원인 분석

Gateway 리소스를 확인해봤습니다:

```bash
$ kubectl get gateway -A
No resources found
```

어? Gateway가 없습니다.

Sidecar 모드에서는 `istio/gateway` Helm chart를 설치하면 자동으로 Ingress Gateway가 생성됩니다. 당연히 Ambient 모드도 그럴 줄 알았는데...

**Ambient 모드는 기본적으로 Ingress Gateway를 포함하지 않습니다.**

```
┌─────────────────────────────────────────────┐
│            Sidecar 모드                      │
├─────────────────────────────────────────────┤
│  istio-ingressgateway (기본 포함)           │
│  istiod                                      │
│  각 Pod에 Envoy sidecar                      │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│            Ambient 모드                      │
├─────────────────────────────────────────────┤
│  istiod                                      │
│  ztunnel (노드당 1개)                        │
│  istio-cni                                   │
│  ingress gateway: ❌ 별도 설치 필요!         │
└─────────────────────────────────────────────┘
```

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

```bash
$ terraform apply

$ kubectl get pods -n istio-system | grep gateway
istio-ingressgateway-xxx   1/1   Running   0

$ kubectl get svc -n istio-system | grep gateway
istio-ingressgateway   LoadBalancer   ...   80:31xxx/TCP,443:32xxx/TCP
```

### 핵심 포인트

- **Ambient 모드 ≠ Sidecar 모드**. 같은 Istio지만 아키텍처가 완전히 다르다
- Ambient 모드 설치 시 Ingress Gateway는 별도로 설치해야 한다
- Terraform/Helm으로 관리한다면 의존성 순서를 명확히 해야 한다

---

## 🔥 2. Prometheus가 서비스 메트릭을 못 긁는다

### 증상

Ingress Gateway를 설치하고 나니 외부 접근은 됩니다. 그런데 Grafana에 들어가보니 Istio 메트릭만 보이고, 서비스 메트릭이 없습니다.

```bash
$ kubectl exec -n wealist-prod deploy/prometheus -- \
  wget -q -O - 'http://localhost:9090/api/v1/targets' | \
  jq -r '.data.activeTargets[] | "\(.scrapePool): \(.health) - \(.lastError)"'

user-service: down - Get "http://user-service:8081/metrics": read tcp: connection reset by peer
board-service: down - Get "http://board-service:8000/metrics": connection reset by peer
auth-service: down - Get "http://auth-service:8080/actuator/prometheus": connection reset by peer
```

`connection reset by peer`. 연결이 강제로 끊기고 있습니다.

### 원인 분석

Prometheus Pod의 라벨을 확인해봤습니다:

```bash
$ kubectl get pod -n wealist-prod -l app=prometheus -o yaml | grep -A5 labels
labels:
  app: prometheus
  istio.io/dataplane-mode: none  # ← 이게 문제!
```

`istio.io/dataplane-mode: none` 라벨이 있습니다. 이 라벨은 **"이 Pod는 mesh에 포함시키지 마세요"**라는 의미입니다.

문제의 구조:

```
┌────────────────────────────────────────────────────────────┐
│                    Istio Ambient Mesh                       │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐  │
│  │user-service │     │board-service│     │auth-service │  │
│  │ (mesh 내부) │     │ (mesh 내부) │     │ (mesh 내부) │  │
│  │ STRICT mTLS │     │ STRICT mTLS │     │ STRICT mTLS │  │
│  └──────▲──────┘     └──────▲──────┘     └──────▲──────┘  │
│         │                   │                   │          │
│         │ mTLS 요구         │ mTLS 요구         │ mTLS 요구│
│         │                   │                   │          │
│         │    ┌──────────────┴───────────────────┘          │
│         │    │                                              │
│         │    │  plain HTTP 요청                             │
│         │    │                                              │
└─────────┼────┼──────────────────────────────────────────────┘
          │    │
          │    │
    ┌─────┴────┴─────┐
    │   Prometheus    │
    │ (mesh 외부!)    │
    │ dataplane: none │
    └─────────────────┘
```

**Prometheus는 mesh 외부에 있고, 서비스들은 STRICT mTLS를 요구합니다.**

Prometheus가 plain HTTP로 메트릭을 긁으려 하면, ztunnel이 mTLS를 요구하면서 연결을 끊어버립니다.

### 해결

Prometheus를 mesh에 포함시켰습니다. `istio.io/dataplane-mode: none` 라벨을 제거하면 됩니다:

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
```

같은 방식으로 Grafana, Loki에서도 `istio.io/dataplane-mode: none` 라벨을 제거했습니다.

**Promtail은 수정 불필요** - 원래 `none` 라벨이 없어서 자동으로 mesh에 포함됩니다.

```bash
$ kubectl rollout restart deploy/prometheus -n wealist-prod
$ kubectl rollout restart deploy/grafana -n wealist-prod
$ kubectl rollout restart deploy/loki -n wealist-prod
```

### 검증

```bash
$ kubectl exec -n wealist-prod deploy/prometheus -- \
  wget -q -O - 'http://localhost:9090/api/v1/targets' | \
  jq -r '.data.activeTargets[] | "\(.scrapePool): \(.health)"' | sort | uniq -c

   1 auth-service: up
   1 board-service: up
   1 chat-service: up
   1 user-service: up
   ...
```

모든 서비스가 `up` 상태입니다.

### Ambient 모드에서 Prometheus 메트릭 수집 정리

| 구성 | 메트릭 수집 | 비고 |
|------|------------|------|
| Prometheus mesh 외부 + STRICT mTLS | ❌ 실패 | connection reset |
| **Prometheus mesh 내부 + STRICT mTLS** | ✅ 성공 | ztunnel이 mTLS 처리 |
| Prometheus mesh 외부 + PERMISSIVE | ✅ 성공 | plain HTTP 허용 (비권장) |

### 핵심 포인트

- **Ambient 모드에서 STRICT mTLS 사용 시, 모니터링 스택도 mesh에 포함해야 한다**
- `istio.io/dataplane-mode: none` 라벨이 있으면 mesh 외부로 취급된다
- mesh 내부에 들어가면 ztunnel이 자동으로 mTLS를 처리해준다

---

## 🔥 3. ArgoCD 메트릭도 수집이 안 된다

### 증상

서비스 메트릭은 해결됐는데, ArgoCD 메트릭이 여전히 안 보입니다.

```bash
$ kubectl exec -n wealist-prod deploy/prometheus -- \
  wget -q -O - 'http://localhost:9090/api/v1/targets' | \
  jq -r '.data.activeTargets[] | select(.scrapePool | startswith("argocd"))'

(결과 없음)
```

ArgoCD 관련 타겟 자체가 없습니다.

### 원인 분석

Prometheus 설정을 확인해봤습니다:

```yaml
# prometheus configmap
scrape_configs:
  - job_name: 'argocd-application-controller'
    kubernetes_sd_configs:
      - role: endpoints
    relabel_configs:
      - source_labels: [__meta_kubernetes_service_name]
        action: keep
        regex: argocd-metrics  # ← 이 서비스를 찾고 있음
```

`argocd-metrics` 서비스를 찾고 있습니다. 근데 이 서비스가 있을까요?

```bash
$ kubectl get svc -n argocd | grep metrics
(없음)
```

없습니다. ArgoCD Helm chart에서 metrics 서비스가 비활성화되어 있었습니다.

### 해결

endpoints 기반 스크래핑 대신 Pod 직접 스크래핑으로 변경:

```yaml
# k8s/helm/charts/wealist-monitoring/templates/prometheus/configmap.yaml

# Before - endpoints 기반 (서비스 필요)
- job_name: 'argocd-application-controller'
  kubernetes_sd_configs:
    - role: endpoints
  relabel_configs:
    - source_labels: [__meta_kubernetes_service_name]
      action: keep
      regex: argocd-metrics

# After - Pod 직접 스크래핑
- job_name: 'argocd-application-controller'
  kubernetes_sd_configs:
    - role: pod
      namespaces:
        names:
          - argocd
  relabel_configs:
    - source_labels: [__meta_kubernetes_pod_label_app_kubernetes_io_name]
      action: keep
      regex: argocd-application-controller
    - source_labels: [__meta_kubernetes_pod_container_port_name]
      action: keep
      regex: metrics
```

### ArgoCD 컴포넌트별 메트릭 포트

| 컴포넌트 | Port | 포트 이름 |
|----------|------|----------|
| application-controller | 8082 | metrics |
| server | 8083 | metrics |
| repo-server | 8084 | metrics |
| applicationset-controller | 8080 | metrics |
| notifications-controller | 9001 | metrics |

### 검증

```bash
$ kubectl exec -n wealist-prod deploy/prometheus -- \
  wget -q -O - 'http://localhost:9090/api/v1/targets' | \
  jq -r '.data.activeTargets[] | select(.scrapePool | startswith("argocd")) | "\(.scrapePool): \(.health)"'

argocd-application-controller: up
argocd-server: up
argocd-repo-server: up
argocd-applicationset-controller: up
argocd-notifications-controller: up
```

### 핵심 포인트

- **endpoints 기반 스크래핑은 해당 Service가 존재해야 한다**
- ArgoCD Helm chart에서 metrics Service가 비활성화된 경우, Pod 직접 스크래핑으로 우회할 수 있다
- `kubernetes_sd_configs`의 `role: pod`는 Service 없이도 동작한다

---

## 📚 종합 정리

### Istio Ambient 모드에서 주의할 점

| 항목 | Sidecar 모드 | Ambient 모드 |
|------|-------------|--------------|
| Ingress Gateway | 기본 포함 | **별도 설치 필요** |
| 메트릭 수집 | Sidecar가 처리 | **mesh 포함 여부 확인** |
| mTLS | Pod별 Envoy | ztunnel (노드별) |
| 설정 복잡도 | 상대적 단순 | **주의 필요** |

### 이 날 배운 것들

1. **Ambient 모드는 Sidecar 모드가 아니다** - 같은 Istio지만 완전히 다른 아키텍처
2. **모니터링 스택도 mesh의 일부** - STRICT mTLS 환경에서는 모니터링도 mesh에 포함해야 한다
3. **Service 없이도 스크래핑 가능** - `role: pod`로 직접 스크래핑

### 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────────────────┐
│                 Istio Ambient Mesh (wealist-prod)            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐               │
│  │   ztunnel  │ │   ztunnel  │ │   ztunnel  │  (노드당 1개) │
│  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘               │
│        │              │              │                       │
│        ▼              ▼              ▼                       │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐               │
│  │user-service│ │board-service│ │auth-service│               │
│  └────────────┘ └────────────┘ └────────────┘               │
│        ▲              ▲              ▲                       │
│        │              │              │                       │
│        └──────────────┼──────────────┘                       │
│                       │                                      │
│                       │ mTLS (ztunnel 자동 처리)             │
│                       │                                      │
│                 ┌─────┴─────┐                                │
│                 │Prometheus │  ← mesh 내부 (라벨 제거)       │
│                 └───────────┘                                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │  Istio Ingress Gateway │  ← 별도 설치
              │     (LoadBalancer)     │
              └───────────────────────┘
                          │
                          ▼
                    외부 트래픽
```

---

## 🤔 스스로에게 던지는 질문

### 1. Ambient 모드에서 새 서비스를 추가할 때, mesh 포함 여부를 어떤 기준으로 결정할까?

- **포함해야 하는 경우**: 다른 서비스와 통신, mTLS 필요, 트래픽 제어 필요
- **제외해도 되는 경우**: 외부 전용 서비스, 레거시 호환성, 디버깅 목적
- 기본은 포함, 특별한 이유가 있을 때만 제외하는 게 안전하다

### 2. PERMISSIVE vs STRICT mTLS, 어떤 상황에서 뭘 선택할까?

```yaml
# PERMISSIVE: mTLS + plain HTTP 둘 다 허용
apiVersion: security.istio.io/v1
kind: PeerAuthentication
spec:
  mtls:
    mode: PERMISSIVE

# STRICT: mTLS만 허용
spec:
  mtls:
    mode: STRICT
```

- **PERMISSIVE**: 마이그레이션 기간, 외부 연동, 레거시 시스템
- **STRICT**: 프로덕션 권장, 보안 요구사항 있을 때
- Prometheus를 mesh에 포함시키면 STRICT에서도 문제없다

### 3. 모니터링 스택을 mesh 안에 넣을까 밖에 둘까?

**mesh 안에 넣는 장점:**
- STRICT mTLS 환경에서도 메트릭 수집 가능
- 모니터링 트래픽도 암호화
- 일관된 보안 정책

**mesh 밖에 두는 장점:**
- 모니터링이 mesh 장애에 영향 안 받음
- 설정이 단순

**권장**: mesh 안에 넣되, 모니터링 전용 PeerAuthentication으로 PERMISSIVE 설정하는 것도 방법

---

## 🔗 다음 편 예고

다음 편에서는 **HTTPS를 붙이기까지** 겪은 문제들을 다룹니다:
- Kubernetes Gateway API로 마이그레이션
- AWS LB Controller Security Group 권한 부족
- NLB 재생성 → Route53 DNS 불일치
- NLB + ACM으로 TLS 설정

3번의 삽질 끝에 HTTPS를 붙인 이야기를 공유하겠습니다.

---

## 🔗 참고

- [Istio Ambient Mode 공식 문서](https://istio.io/latest/docs/ambient/)
- [Istio Gateway Installation](https://istio.io/latest/docs/setup/additional-setup/gateway/)
- [Prometheus Kubernetes SD Config](https://prometheus.io/docs/prometheus/latest/configuration/configuration/#kubernetes_sd_config)
