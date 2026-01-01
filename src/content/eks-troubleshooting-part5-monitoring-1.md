---
title: "EKS 모니터링 구축기 (1): Prometheus가 안 뜬다"
excerpt: "모니터링 스택 띄우는 데만 겪은 6가지 장애물 - 이미지, 스토리지, 권한 문제"
category: kubernetes
tags:
  - Prometheus
  - Grafana
  - monitoring
  - PVC
  - EKS
date: '2025-12-29'
---

## 🎯 한 줄 요약

> 모니터링 스택(Prometheus, Grafana, Loki)을 띄우는 데만 6가지 장애물을 넘었다. 이미지가 없고, 스토리지가 안 붙고, 권한이 없었다.

## 📊 Impact

- **영향 범위**: 모니터링 전체 불가
- **소요 시간**: 약 8시간 (2일에 걸쳐)
- **발생일**: 2025-12-29

---

## 💡 모니터링 스택 구성

구축하려던 모니터링 스택:

```
┌─────────────────────────────────────────────────────────────┐
│                    Monitoring Stack                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐           │
│  │ Prometheus │   │  Grafana   │   │    Loki    │           │
│  │  (메트릭)   │   │ (시각화)   │   │   (로그)   │           │
│  └─────┬──────┘   └─────┬──────┘   └─────┬──────┘           │
│        │                │                │                   │
│        ▼                ▼                ▼                   │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐           │
│  │    PVC     │   │    PVC     │   │    PVC     │           │
│  │  (gp2/gp3) │   │  (gp2/gp3) │   │  (gp2/gp3) │           │
│  └────────────┘   └────────────┘   └────────────┘           │
│                                                              │
│  ┌────────────┐   ┌────────────┐                            │
│  │  Promtail  │   │  Exporters │                            │
│  │ (로그수집)  │   │(node/redis)│                            │
│  └────────────┘   └────────────┘                            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

이 구성을 띄우는 데 6가지 문제가 발생했습니다.

---

## 🔥 1. 모니터링 이미지 ImagePullBackOff

### 증상

```bash
$ kubectl get pods -n wealist-prod | grep -E "grafana|prometheus|loki"
grafana-xxx       0/1     ImagePullBackOff   0
prometheus-xxx    0/1     ImagePullBackOff   0
loki-xxx          0/1     ImagePullBackOff   0
```

세 개 다 ImagePullBackOff입니다.

### 원인 분석

Pod describe를 확인:

```bash
$ kubectl describe pod grafana-xxx -n wealist-prod | grep -A5 Events
Events:
  Warning  Failed   pull image "public.ecr.aws/grafana/grafana:10.2.2"
  Warning  Failed   Error: image not found
```

`public.ecr.aws/grafana/grafana` 이미지가 없습니다.

prod.yaml 설정을 확인해보니:

```yaml
# 문제의 설정
grafana:
  image:
    repository: public.ecr.aws/grafana/grafana  # ECR Public에 없음!
loki:
  image:
    repository: public.ecr.aws/grafana/loki     # ECR Public에 없음!
prometheus:
  image:
    repository: public.ecr.aws/prometheus/prometheus
```

**ECR Public Gallery에 Grafana, Loki 이미지가 없었습니다.**

### 해결

Docker Hub 공식 이미지로 변경:

```yaml
# k8s/helm/environments/prod.yaml

prometheus:
  image:
    repository: prom/prometheus
    tag: "v2.48.0"

grafana:
  image:
    repository: grafana/grafana
    tag: "10.2.2"

loki:
  image:
    repository: grafana/loki
    tag: "2.9.2"
```

### 이미지 레지스트리 참고

| 용도 | Docker Hub | ECR Public |
|------|------------|------------|
| Grafana | `grafana/grafana` ✅ | ❌ 없음 |
| Loki | `grafana/loki` ✅ | ❌ 없음 |
| Prometheus | `prom/prometheus` ✅ | ✅ 있음 |

### 핵심 포인트

- **ECR Public에 모든 이미지가 있는 것은 아니다**
- 이미지 설정 전에 레지스트리에서 존재 여부 확인 필요
- Docker Hub 공식 이미지가 가장 확실함

---

## 🔥 2. Exporter 이미지도 없다

### 증상

Grafana, Prometheus, Loki를 고치고 나니, 이번엔 Exporter들이 문제:

```bash
$ kubectl get pods -n wealist-prod | grep exporter
postgres-exporter-xxx   0/1   ImagePullBackOff   0
redis-exporter-xxx      0/1   ImagePullBackOff   0
```

### 원인 분석

```bash
$ kubectl describe pod postgres-exporter-xxx -n wealist-prod | grep -A3 Events
Events:
  Warning  Failed  pull image "bitnami/postgres-exporter:0.15.0"
  Error: tag does not exist
```

`bitnami/postgres-exporter:0.15.0` 태그가 없습니다.

Bitnami 이미지는 버전 태그 형식이 다릅니다. 시맨틱 버전 대신 날짜 기반 태그를 사용하거나, 아예 다른 형식입니다.

### 해결

Prometheus 커뮤니티 공식 Exporter 이미지 사용:

```yaml
# k8s/helm/environments/prod.yaml

postgresExporter:
  image:
    repository: prometheuscommunity/postgres-exporter
    tag: "v0.15.0"

redisExporter:
  image:
    repository: oliver006/redis_exporter
    tag: "v1.55.0"
```

### Exporter 이미지 참고

| 용도 | 올바른 이미지 | 잘못된 이미지 |
|------|--------------|--------------|
| PostgreSQL | `prometheuscommunity/postgres-exporter` | `bitnami/postgres-exporter` |
| Redis | `oliver006/redis_exporter` | `bitnami/redis-exporter` |
| Node | `prom/node-exporter` | - |

### 핵심 포인트

- **Bitnami 이미지는 태그 형식이 다를 수 있다**
- **Prometheus 커뮤니티 공식 Exporter를 사용하는 것이 안전**
- 태그 존재 여부는 Docker Hub에서 직접 확인

---

## 🔥 3. PVC Pending - 기본 StorageClass 없음

### 증상

이미지 문제를 해결하고 나니, 이번엔 PVC:

```bash
$ kubectl get pods -n wealist-prod | grep prometheus
prometheus-xxx   0/1   Pending   0

$ kubectl describe pod prometheus-xxx -n wealist-prod | grep -A3 Events
Events:
  Warning  FailedScheduling  pod has unbound immediate PersistentVolumeClaims
```

PVC가 바인딩되지 않았습니다.

```bash
$ kubectl get pvc -n wealist-prod
NAME               STATUS    VOLUME   CAPACITY   STORAGECLASS
prometheus-data    Pending                                      # ← StorageClass 없음!
grafana-data       Pending
loki-data          Pending
```

### 원인 분석

StorageClass를 확인:

```bash
$ kubectl get storageclass
NAME   PROVISIONER             RECLAIMPOLICY
gp2    kubernetes.io/aws-ebs   Delete
gp3    ebs.csi.aws.com         Delete
```

StorageClass는 있지만, **기본(default) StorageClass가 설정되어 있지 않습니다**.

PVC에 `storageClassName`을 명시하지 않으면 기본 StorageClass를 사용하는데, 기본이 없으니 바인딩이 안 됩니다.

### 해결

**즉시 해결** - gp2를 기본 StorageClass로 설정:

```bash
$ kubectl patch storageclass gp2 -p \
  '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'

$ kubectl get storageclass
NAME            PROVISIONER             RECLAIMPOLICY
gp2 (default)   kubernetes.io/aws-ebs   Delete        # ← default 표시
gp3             ebs.csi.aws.com         Delete
```

**영구 해결** - Terraform에서 자동 설정:

```hcl
# terraform/prod/compute/storage.tf
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

### 주의

**기존 Pending PVC는 기본 StorageClass 설정 후에도 자동 바인딩되지 않습니다.**

PVC를 삭제하고 재생성해야 합니다 (또는 Deployment 재배포):

```bash
$ kubectl delete pvc prometheus-data grafana-data loki-data -n wealist-prod
$ kubectl rollout restart deploy/prometheus deploy/grafana deploy/loki -n wealist-prod
```

### 핵심 포인트

- **EKS에서 기본 StorageClass는 자동 설정되지 않는다**
- `storageclass.kubernetes.io/is-default-class: "true"` annotation으로 설정
- Pending 상태의 PVC는 수동 처리 필요

---

## 🔥 4. Prometheus PVC 권한 오류

### 증상

PVC가 바인딩됐는데, 이번엔 Prometheus가 CrashLoopBackOff:

```bash
$ kubectl get pods -n wealist-prod | grep prometheus
prometheus-xxx   0/1   CrashLoopBackOff   3
```

로그 확인:

```bash
$ kubectl logs prometheus-xxx -n wealist-prod
Error opening query log file: open /prometheus/queries.active: permission denied
panic: Unable to create mmap-ed active query log
```

`permission denied`. 권한 문제입니다.

### 원인 분석

Prometheus 컨테이너는 user `nobody` (UID 65534)로 실행됩니다. 하지만 PVC가 root 소유로 마운트되어 쓰기 권한이 없습니다.

```bash
$ kubectl exec prometheus-xxx -n wealist-prod -- ls -la /prometheus
total 8
drwxr-xr-x 2 root root 4096 Dec 29 09:00 .
```

`root:root` 소유이고 other에 쓰기 권한이 없습니다.

Deployment를 확인해보니:

```yaml
# 문제: securityContext가 없음
spec:
  containers:
    - name: prometheus
      # securityContext 없음!
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
| **fsGroup** | 65534 | **볼륨 마운트 시 그룹 소유권 변경** |

`fsGroup`을 설정하면 Kubernetes가 PVC 마운트 시 해당 그룹으로 소유권을 변경합니다:

```bash
# fsGroup 적용 후
$ kubectl exec prometheus-xxx -n wealist-prod -- ls -la /prometheus
total 8
drwxrwsr-x 2 root 65534 4096 Dec 29 10:00 .
```

그룹이 `65534`로 바뀌고, 그룹 쓰기 권한이 생겼습니다.

### 다른 모니터링 컴포넌트

| 컴포넌트 | 기본 UID | fsGroup 필요 여부 |
|----------|----------|------------------|
| Prometheus | 65534 | ✅ 필요 |
| Grafana | 472 | 필요할 수 있음 |
| Loki | 10001 | 필요할 수 있음 |

### 핵심 포인트

- **많은 컨테이너가 non-root로 실행된다**
- **PVC는 기본적으로 root 소유로 마운트된다**
- **fsGroup으로 볼륨 소유권을 변경해야 한다**

---

## 🔥 5. 모니터링 Pod Lock 충돌

### 증상

ArgoCD에서 Sync 후 Pod가 CrashLoopBackOff:

```bash
$ kubectl get pods -n wealist-prod | grep -E "prometheus|loki"
prometheus-68ddd48c9c-vmxdg   0/1   CrashLoopBackOff   3
prometheus-54846bb74f-k2x9m   1/1   Running            0    # ← 이전 Pod!
loki-75fb48b7bb-nkt5c         0/1   CrashLoopBackOff   2
loki-74bc8b7989-abc12         1/1   Running            0    # ← 이전 Pod!
```

새 Pod와 기존 Pod가 동시에 존재합니다.

### 원인 분석

로그 확인:

```bash
$ kubectl logs prometheus-68ddd48c9c-vmxdg -n wealist-prod
opening storage failed: lock DB directory: resource temporarily unavailable

$ kubectl logs loki-75fb48b7bb-nkt5c -n wealist-prod
failed to init delete store: timeout
```

**PVC Lock 충돌입니다.**

1. ArgoCD sync로 새 ReplicaSet 생성
2. 기존 Pod가 PVC lock을 잡고 있음 (ReadWriteOnce)
3. 새 Pod가 같은 PVC에 접근하려다 lock 획득 실패

```
기존 Pod (prometheus-54846bb74f-xxx) ─── lock ───> PVC
새 Pod (prometheus-68ddd48c9c-xxx)  ─── blocked ──> PVC  → CrashLoopBackOff
```

### 해결

**즉시 해결** - 기존 Pod 삭제:

```bash
$ kubectl delete pod prometheus-54846bb74f-k2x9m loki-74bc8b7989-abc12 -n wealist-prod
```

또는 scale 리셋:

```bash
$ kubectl scale deploy prometheus loki --replicas=0 -n wealist-prod
$ kubectl scale deploy prometheus loki --replicas=1 -n wealist-prod
```

**영구 해결** - Deployment strategy 변경:

```yaml
spec:
  strategy:
    type: Recreate  # 기존 Pod 먼저 삭제 후 새 Pod 생성
```

또는 RollingUpdate + maxSurge: 0:

```yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 0        # 새 Pod 생성 전 기존 Pod 삭제
      maxUnavailable: 1
```

### 핵심 포인트

- **ReadWriteOnce PVC는 동시에 하나의 Pod만 접근 가능**
- **RollingUpdate는 새 Pod 먼저 생성 → Lock 충돌 가능**
- **Recreate 또는 maxSurge: 0으로 해결**

---

## 🔥 6. Frontend ImagePullBackOff (보너스)

### 증상

```bash
$ kubectl get pods -n wealist-prod | grep frontend
frontend-xxx   0/1   ImagePullBackOff   0
```

### 원인 분석

```bash
$ kubectl describe pod frontend-xxx -n wealist-prod | grep -A3 Events
Events:
  Warning  Failed  pull image "xxx.ecr.aws/wealist/frontend:latest"
  Error: image not found
```

ECR에 frontend 이미지가 없습니다.

그런데... 잠깐. Production에서 frontend가 필요한가?

### 해결

**Production에서는 CloudFront + S3로 프론트엔드를 제공합니다.**

```
Production 아키텍처:
GitHub Actions → S3 업로드 → CloudFront 배포
                     (EKS에 frontend 불필요!)
```

frontend 리소스 삭제:

```bash
$ kubectl delete deploy frontend -n wealist-prod
$ kubectl delete svc frontend -n wealist-prod
```

ArgoCD apps/prod/에서 frontend.yaml도 제거.

### 핵심 포인트

- **환경별 아키텍처가 다를 수 있다**
- 로컬/개발: EKS에 frontend Pod
- Production: CloudFront + S3
- **배포 전 아키텍처 검토 필요**

---

## 📚 종합 정리

### 6가지 장애물 요약

| # | 문제 | 원인 | 해결 |
|---|------|------|------|
| 1 | Grafana/Loki ImagePullBackOff | ECR Public에 없음 | Docker Hub 이미지 |
| 2 | Exporter ImagePullBackOff | Bitnami 태그 형식 | 공식 Exporter 이미지 |
| 3 | PVC Pending | 기본 StorageClass 없음 | gp2에 default 설정 |
| 4 | Prometheus permission denied | fsGroup 미설정 | securityContext 추가 |
| 5 | Pod Lock 충돌 | RollingUpdate + RWO PVC | Recreate 전략 |
| 6 | Frontend ImagePullBackOff | 아키텍처 불일치 | 리소스 제거 |

### 모니터링 스택 Deployment 체크리스트

```
[ ] 이미지 레지스트리에서 존재 확인
[ ] 이미지 태그 형식 확인
[ ] 기본 StorageClass 설정
[ ] fsGroup 등 securityContext 설정
[ ] Deployment strategy 검토 (RWO PVC 사용 시)
[ ] 환경별 아키텍처 검토
```

---

## 🤔 스스로에게 던지는 질문

### 1. 컨테이너 이미지 레지스트리 선택 기준은?

| 레지스트리 | 장점 | 단점 |
|------------|------|------|
| Docker Hub | 가장 많은 이미지 | Rate limit |
| ECR Public | AWS 네트워크 빠름 | 이미지 제한적 |
| Quay.io | Red Hat 공식 | 이미지 제한적 |
| Private ECR | 완전한 통제 | 관리 필요 |

**권장**: Docker Hub 공식 이미지 + ECR에 미러링

### 2. RWO PVC + Deployment 조합의 위험성은?

- **RollingUpdate**: 새 Pod 생성 → 구 Pod 삭제 → Lock 충돌 가능
- **Recreate**: 구 Pod 삭제 → 새 Pod 생성 → 다운타임 발생
- **StatefulSet**: 순차적 업데이트, 안전하지만 복잡

**권장**: 모니터링 스택은 `Recreate` 또는 `StatefulSet`

### 3. fsGroup은 언제 필요할까?

- 컨테이너가 non-root로 실행될 때
- PVC를 사용할 때
- 볼륨에 쓰기 작업이 필요할 때

**확인 방법**:
```bash
# 컨테이너 실행 UID 확인
docker run --rm <image> id
# uid=65534(nobody) gid=65534(nogroup)
```

### 4. 이미지 존재 여부를 사전에 확인하려면?

```bash
# Docker Hub
docker manifest inspect grafana/grafana:10.2.2

# ECR Public
aws ecr-public describe-images \
  --repository-name grafana/grafana \
  --region us-east-1

# 또는 skopeo
skopeo inspect docker://grafana/grafana:10.2.2
```

---

## 🔗 다음 편 예고

다음 편에서는 **모니터링 스택 S3 전환**을 다룹니다:
- Tempo Pod Identity 문제 (EKS Pod Identity 미지원)
- Loki 3.x 설정 호환성 오류
- 이미지 태그 존재하지 않음
- OTEL Collector 바이너리 경로 변경

PVC에서 S3로 전환하면서 겪은 문제들을 공유하겠습니다.

---

## 🔗 참고

- [Prometheus Storage](https://prometheus.io/docs/prometheus/latest/storage/)
- [Kubernetes Security Context](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/)
- [AWS EBS CSI Driver](https://github.com/kubernetes-sigs/aws-ebs-csi-driver)
