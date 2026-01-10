---
title: "EKS 첫 배포 D-Day: 4개의 장애가 동시에 터졌다"
excerpt: "Production EKS에 처음 배포한 날, Redis 연결 실패부터 ALB 미설치까지 4가지 문제를 해결한 기록"
category: kubernetes
tags:
  - EKS
  - Troubleshooting
  - ArgoCD
  - Redis
  - ALB
  - ExternalSecrets
series:
  name: "eks-troubleshooting"
  order: 1
date: '2025-12-27'
---

## 🎯 한 줄 요약

> Production EKS에 처음 배포한 날, 4개의 장애가 동시에 터졌다. Redis 연결 실패, DB SSL 오류, ALB 미설치, ArgoCD 브랜치 불일치.

## 📊 Impact

- **영향 범위**: 전체 서비스 접근 불가
- **소요 시간**: 약 4시간
- **발생일**: 2025-12-27

---

## 🔥 1. auth-service가 Redis에 연결을 못 한다

### 증상

```
auth-service Pod이 CrashLoopBackOff 상태
Readiness probe 실패
```

Pod 로그를 확인해봤습니다:

```bash
$ kubectl logs -f deploy/auth-service -n wealist-prod

Unable to connect to Redis
Connection refused: redis:6379
```

뭐지? Production 환경에서는 AWS ElastiCache를 사용하는데, 왜 `redis:6379`로 연결하려고 하는 거지?

### 원인 분석

설정 파일들을 하나씩 확인해봤습니다.

```bash
$ kubectl get cm auth-service-config -n wealist-prod -o yaml
```

ConfigMap에는 Redis 호스트 설정이 없었습니다. ExternalSecret에서 가져오도록 설계했기 때문입니다.

그런데 Helm values 파일을 확인해보니:

```yaml
# auth-service/values.yaml - 문제의 코드
config:
  SPRING_REDIS_HOST: "redis"     # 로컬용 하드코딩!
  SPRING_REDIS_PORT: "6379"
```

아! `values.yaml`에 로컬 개발용 값이 하드코딩되어 있었습니다.

**우선순위 문제였다:**

```
values.yaml (하드코딩) > ExternalSecret (AWS Secrets Manager)
                ↓
        "redis:6379"로 연결 시도 → 실패
```

### 해결

**1. auth-service/values.yaml에서 하드코딩 제거:**

```yaml
# 수정 후 - 하드코딩 제거
config:
  # SPRING_REDIS_HOST: ExternalSecret에서 가져옴
  # SPRING_REDIS_PORT: ExternalSecret에서 가져옴
```

**2. localhost.yaml에 로컬 개발용 값 분리:**

```yaml
# k8s/helm/environments/localhost.yaml
shared:
  config:
    SPRING_REDIS_HOST: "redis"
    SPRING_REDIS_PORT: "6379"
```

**3. ArgoCD Application에 SSL 설정 추가:**

ElastiCache는 TLS가 필수입니다.

```yaml
# k8s/argocd/apps/prod/auth-service.yaml
spec:
  source:
    helm:
      parameters:
        - name: config.SPRING_DATA_REDIS_SSL_ENABLED
          value: "true"
```

### 검증

```bash
$ kubectl get pods -n wealist-prod -l app=auth-service
NAME                            READY   STATUS    RESTARTS
auth-service-7b9f8c6d4-x2k9m    1/1     Running   0

$ kubectl logs -f deploy/auth-service -n wealist-prod | grep -i redis
Connected to Redis at wealist-prod.xxxxx.cache.amazonaws.com:6379
```

### 핵심 포인트

- **values.yaml에 환경별 값을 하드코딩하면 안 된다**
- 로컬/스테이징/프로덕션 값은 각각의 environment 파일로 분리해야 한다
- ExternalSecret과 ConfigMap 값이 충돌할 때, ConfigMap이 우선 적용될 수 있다

---

## 🔥 2. Go 서비스들이 DB 연결에서 SSL 오류

### 증상

auth-service를 고치고 나니, 이번엔 Go 서비스들이 문제였습니다.

```bash
$ kubectl logs deploy/user-service -n wealist-prod

panic: failed to connect to database
SSL is not enabled on the server
```

user-service, board-service, chat-service... 모든 Go 서비스가 같은 에러를 뱉었습니다.

### 원인 분석

DATABASE_URL을 확인해봤습니다:

```bash
$ kubectl exec deploy/user-service -n wealist-prod -- env | grep DATABASE
DATABASE_URL=postgres://user:pass@rds-endpoint:5432/db?sslmode=verify-full
```

`sslmode=verify-full`로 설정되어 있었습니다.

이 모드는 SSL 연결 + CA 인증서 + 호스트명까지 전부 검증합니다. 그런데 Go 서비스 컨테이너에는 AWS RDS의 CA 인증서가 없었습니다.

### 해결

`sslmode=require`로 변경했습니다. 암호화는 하되, 인증서 검증은 건너뜁니다.

```yaml
# k8s/helm/environments/prod.yaml
shared:
  config:
    DB_SSL_MODE: "require"   # verify-full → require
    DB_SSLMODE: "require"
```

### SSL Mode 참고

| SSL Mode | 암호화 | 인증서 검증 | 용도 |
|----------|--------|-------------|------|
| disable | ❌ | ❌ | 개발 환경 |
| require | ✅ | ❌ | **프로덕션 (간편)** |
| verify-ca | ✅ | CA만 검증 | 높은 보안 |
| verify-full | ✅ | CA+호스트명 | 최고 보안 |

RDS는 기본적으로 AWS 루트 CA를 사용하므로, `require`만으로도 충분한 보안을 제공합니다.

### 핵심 포인트

- **verify-full은 CA 인증서가 컨테이너에 있어야 한다**
- RDS 사용 시 `require`로 시작하고, 필요하면 CA 인증서를 마운트해서 `verify-full`로 올리는 게 현실적이다
- Go와 Java의 SSL 설정 방식이 다르므로 각각 확인해야 한다

---

## 🔥 3. 외부에서 접근이 안 된다 - ALB가 없다

### 증상

서비스들이 다 뜬 것 같은데, 외부에서 접근이 안 됩니다.

```bash
$ kubectl get svc -n wealist-prod
NAME           TYPE        CLUSTER-IP       PORT(S)
user-service   ClusterIP   172.20.45.123    8081/TCP
auth-service   ClusterIP   172.20.67.89     8080/TCP
...

$ kubectl get ingress -n wealist-prod
No resources found
```

Ingress가 없습니다. 그럼 LoadBalancer는?

```bash
$ kubectl get svc -A | grep LoadBalancer
(없음)
```

### 원인 분석

Terraform 코드를 확인해봤습니다:

```hcl
# terraform/prod/compute/main.tf
module "eks" {
  source = "terraform-aws-modules/eks/aws"
  # ... EKS 클러스터 설정
}

# Pod Identity IAM 역할은 있는데...
module "pod_identity_alb_controller" {
  # ... IAM 역할 생성
}

# Helm 릴리스가 없다!
```

IAM 역할은 만들어뒀는데, 정작 **AWS Load Balancer Controller Helm 릴리스가 없었습니다**.

```
Terraform으로 관리할 예정이었지만...
→ "나중에 하지" 하고 넘어갔던 것
→ 프로덕션 배포일에 터짐
```

### 해결

`helm-releases.tf`에 AWS Load Balancer Controller 추가:

```hcl
# terraform/prod/compute/helm-releases.tf
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

```bash
$ cd terraform/prod/compute
$ terraform apply

$ kubectl get pods -n kube-system | grep aws-load-balancer
aws-load-balancer-controller-xxx   1/1   Running   0
```

### Terraform 체크리스트 (교훈)

이 사건 이후 체크리스트를 만들었습니다:

```
[ ] EKS 클러스터
[ ] Gateway API CRDs
[ ] Istio (base, istiod, cni, ztunnel, ingress)
[ ] ArgoCD
[ ] AWS Load Balancer Controller  ← 빠뜨렸던 것
[ ] External Secrets Operator
[ ] cert-manager
[ ] Cluster Autoscaler
[ ] ArgoCD Bootstrap App
```

### 핵심 포인트

- **IAM 역할 생성 ≠ 컴포넌트 설치**
- Terraform으로 관리할 컴포넌트는 체크리스트로 관리해야 한다
- "나중에 하지"는 프로덕션 배포일에 터진다

---

## 🔥 4. ArgoCD가 Sync 했는데 변경사항이 없다

### 증상

ArgoCD에서 앱을 Sync 했습니다. "Synced" 상태로 바뀌었습니다.

그런데 최신 변경사항이 반영되지 않았습니다.

```bash
$ kubectl describe application user-service -n argocd | grep Revision
Revision: abc123def  # 예전 커밋
```

분명 새 커밋을 푸시했는데, ArgoCD가 예전 커밋을 보고 있었습니다.

### 원인 분석

ArgoCD Application 설정을 확인해봤습니다:

```yaml
# k8s/argocd/apps/prod/user-service.yaml
spec:
  source:
    repoURL: https://github.com/org/repo.git
    targetRevision: main  # ← 문제!
    path: k8s/helm/charts/user-service
```

`targetRevision: main`으로 되어 있었습니다.

그런데 Production 배포는 `k8s-deploy-prod` 브랜치를 사용하기로 했었습니다.

```
main 브랜치: 개발 중인 코드
k8s-deploy-prod 브랜치: 프로덕션 배포용

ArgoCD가 main을 보고 있었음 → 프로덕션 변경사항 미반영
```

### 해결

모든 prod 앱의 `targetRevision`을 수정했습니다:

```bash
$ grep -r "targetRevision:" k8s/argocd/apps/prod/
root-app.yaml:    targetRevision: main          # ❌
external-secrets.yaml:    targetRevision: main  # ❌
user-service.yaml:    targetRevision: main      # ❌
...
```

전부 `k8s-deploy-prod`로 변경:

```yaml
# 수정 후
spec:
  source:
    targetRevision: k8s-deploy-prod  # ✅
```

### 검증

```bash
$ grep -r "targetRevision:" k8s/argocd/apps/prod/ | grep -v k8s-deploy-prod
(없음 - 모두 수정됨)
```

### 핵심 포인트

- **ArgoCD "Synced" 상태는 "최신"을 의미하지 않는다**
- `targetRevision`이 어떤 브랜치를 가리키는지 반드시 확인해야 한다
- 환경별 브랜치 전략을 사용한다면, ArgoCD Application도 그에 맞게 설정해야 한다

---

## 📚 종합 정리

### 이 날 배운 것들

| 문제 | 근본 원인 | 교훈 |
|------|----------|------|
| Redis 연결 실패 | values.yaml 하드코딩 | 환경별 값은 environment 파일로 분리 |
| DB SSL 오류 | verify-full + CA 인증서 없음 | SSL 모드와 인증서 요구사항 이해 |
| ALB 미설치 | Helm 릴리스 누락 | Terraform 체크리스트 필수 |
| ArgoCD 브랜치 | targetRevision 불일치 | 환경별 브랜치 전략 일관성 |

### 공통점

4가지 문제의 공통점은 **"설정 불일치"**였습니다.

- 로컬 설정이 프로덕션에 섞여 들어감
- 있어야 할 컴포넌트가 없음
- 봐야 할 브랜치를 안 봄

### 아키텍처 다이어그램

![Production EKS Architecture|short](/images/eks-troubleshooting/eks-architecture.svg)

---

## 🤔 스스로에게 던지는 질문

이번 트러블슈팅을 하면서 생각해본 질문들입니다:

### 1. 새로운 EKS 클러스터를 구축한다면, 체크리스트에 뭘 추가할까?

- 네트워크 컴포넌트 (ALB Controller, ExternalDNS)
- 시크릿 관리 (ESO, cert-manager)
- 모니터링 (Prometheus, Grafana)
- GitOps (ArgoCD)
- 보안 (OPA, Falco)

### 2. ExternalSecret과 ConfigMap 값이 충돌할 때, 우선순위를 어떻게 설계할까?

- 방법 1: values.yaml에 절대 환경별 값을 넣지 않는다
- 방법 2: 환경별 values 파일에서 명시적으로 override
- 방법 3: ExternalSecret만 사용하고 ConfigMap은 비환경변수용으로만

### 3. ArgoCD에서 "Synced"인데 실제로 반영이 안 됐다면, 어떻게 디버깅을 시작할까?

```bash
# 1. 현재 보고 있는 revision 확인
kubectl get application <app> -n argocd -o jsonpath='{.status.sync.revision}'

# 2. 실제 원하는 브랜치의 최신 커밋 확인
git ls-remote origin <branch>

# 3. ArgoCD가 바라보는 targetRevision 확인
kubectl get application <app> -n argocd -o jsonpath='{.spec.source.targetRevision}'
```

### 4. 이 문제들을 사전에 발견하려면, 어떤 테스트를 추가해야 할까?

- **Helm template 테스트**: 렌더링된 결과에 하드코딩된 값이 없는지
- **ArgoCD Application 검증**: targetRevision이 환경과 일치하는지
- **Terraform plan 리뷰**: 필수 컴포넌트가 누락되지 않았는지
- **스모크 테스트**: 배포 후 기본 연결 확인 자동화

---

## 🔗 다음 편 예고

다음 편에서는 **Istio Ambient 모드**에서 겪은 문제들을 다룹니다:
- Ingress Gateway가 없다?
- Prometheus가 메트릭을 못 긁는다
- ArgoCD 메트릭도 수집이 안 된다

Sidecar 없는 서비스 메시의 현실을 공유하겠습니다.

---

## 🔗 참고

- [AWS Load Balancer Controller 설치 가이드](https://kubernetes-sigs.github.io/aws-load-balancer-controller/)
- [ArgoCD Application Specification](https://argo-cd.readthedocs.io/en/stable/user-guide/application-specification/)
- [External Secrets Operator](https://external-secrets.io/)
