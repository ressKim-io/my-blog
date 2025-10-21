---
title: "[챌린지 #2] 팀 프로젝트 K8s 마이그레이션 - Part 5: 트러블슈팅 & Helm"
excerpt: "5가지 에러를 겪으며 배운 것들과 더 나은 관리 방법"
categories:
  - challenge
  - kubernetes
  - devops
tags:
  - bootcamp
  - troubleshooting
  - helm
  - debugging
series: "challenge-2-wealist-migration"
toc: true
toc_sticky: true
date: 2025-10-20 10:40:00 +0900
last_modified_at: 2025-10-20 10:40:00 +0900
---

## 🎯 마이그레이션 회고

4개 Part에 걸쳐 Docker Compose에서 K8s로 마이그레이션을 완료했습니다. 하지만 과정이 순탄하지만은 않았습니다.

특히 **오타**와 **설정 실수**로 인한 에러가 정말 많았습니다.  
이번 Part에서는 겪었던 5가지 주요 트러블슈팅을 정리하고, 이런 문제를 근본적으로 줄일 방법을 찾아보겠습니다.

## 🔥 트러블슈팅 5선

### 1. ImagePullBackOff: 이미지를 못 찾는 경우

**증상:**
```bash
kubectl get pods -n board-api-prod

NAME                        READY   STATUS             RESTARTS   AGE
board-api-d6f7f94d7-abc12   0/1     ImagePullBackOff   0          1m
```

**원인:**

로컬에서 빌드한 이미지(`wealist-board-api:latest`)를 k3d 클러스터로 import하지 않았습니다.  찾아보니 K8s가 Docker Hub에서 이미지를 찾으려고 했습니다.

**해결:**
```bash
# 이미지 import
k3d image import wealist-board-api:latest -c k3s-local

# imagePullPolicy 설정
imagePullPolicy: Never  # 로컬 이미지 사용
```

**배운 점 ⭐⭐⭐:**
- k3d는 로컬 Docker 이미지를 자동으로 공유하지 않습니다
- 이미지를 빌드할 때마다 `k3d image import` 필요
- `imagePullPolicy: Never`로 명시해야 안전합니다

---

### 2. CreateContainerConfigError: Secret을 못찾는 에러 

**증상:**
```bash
kubectl get pods -n board-api-prod

NAME                        READY   STATUS                       RESTARTS   AGE
board-api-d6f7f94d7-abc12   0/1     CreateContainerConfigError   0          30s
```

**원인:**

Deployment에서 `db-secret`을 참조했는데, Secret을 만들지 않았습니다.

```yaml
# Deployment
envFrom:
- secretRef:
    name: db-secret  # 이게 없었음!
```

**해결:**
```bash
# Secret 생성
kubectl apply -f k8s-manifests/3-configs/db-secret.yaml

# Pod 재시작 (자동으로 됨)
kubectl get pods -n board-api-prod -w
```

**배운 점 ⭐⭐⭐:**
- Secret은 네임스페이스별로 만들어야 합니다
- `kubectl describe pod`로 정확한 에러 메시지 확인 가능
- 의존성 순서 중요: ConfigMap/Secret → Deployment

---

### 3. OOMKilled: 메모리가 부족현상

**증상:**
```bash
kubectl get pods -n board-api-prod

NAME                        READY   STATUS      RESTARTS   AGE
board-api-d6f7f94d7-abc12   0/1     OOMKilled   3          2m
```

**원인:**

FastAPI 앱이 시작할 때 256Mi 메모리를 초과했습니다.

```yaml
# 처음 설정 (너무 작음)
resources:
  limits:
    memory: "256Mi"
```

**해결:**
```yaml
# 메모리 증가
resources:
  requests:
    memory: "256Mi"
  limits:
    memory: "512Mi"  # 2배 증가
```

**배운 점 ⭐⭐⭐:**
- Exit Code 137 = OOMKilled
- Python/Node.js: 최소 256Mi 권장
- limits를 requests의 2배로 설정
- `kubectl top pods`로 실제 사용량 모니터링

---

### 4. DATABASE_URL 오타: postgre**ss**-service

**증상:**
```bash
kubectl logs -n board-api-prod <pod-name>

# 에러:
# could not translate host name "postgress-service" to address
```

백엔드 Pod는 Running 상태인데, 로그를 보니 DB 연결 실패 에러가 계속 나왔습니다.

**원인:**

Secret에서 `DATABASE_URL`을 Base64 인코딩할 때 오타가 있었습니다.

```yaml
# ❌ 틀린 URL (postgress-service)
DATABASE_URL: postgresql://postgres:pwd@postgress-service.postgresql-prod.svc.cluster.local:5432/wealist
                                         ^^^^^^^^^ s 2개!

# ✅ 올바른 URL (postgres-service)
DATABASE_URL: postgresql://postgres:pwd@postgres-service.postgresql-prod.svc.cluster.local:5432/wealist
                                        ^^^^^^^^ s 1개!
```

Service 이름은 `postgres-service`인데, URL에 `postgress-service`로 적었던 겁니다.

**해결:**
```bash
# 올바른 URL 다시 인코딩
echo -n "postgresql://postgres:mysupersecret@postgres-service.postgresql-prod.svc.cluster.local:5432/wealist" | base64

# Secret 수정
kubectl apply -f k8s-manifests/3-configs/db-secret.yaml

# Deployment 재시작
kubectl rollout restart deployment board-api -n board-api-prod
```

**배운 점 ⭐⭐⭐:**
- Base64 인코딩 전에 URL을 먼저 검증해야 합니다
- 긴 FQDN은 오타 나기 쉽습니다
- `kubectl exec`로 Pod 안에서 nslookup 테스트 가능

---

### 5. 502 Bad Gateway: 백엔드가 응답 안 하는 경우

**증상:**

브라우저에서 `http://localhost:8080/api/health` 접속 시 502 에러.

**원인:**

여러 문제가 겹쳤습니다.
1. 위의 DATABASE_URL 오타로 백엔드가 DB 연결 실패
2. 백엔드 Pod는 떠있지만 헬스체크 실패
3. Ingress가 백엔드로 요청을 보내지만 응답 없음

**해결:**

DATABASE_URL 오타를 고치니 모든 게 해결됐습니다.

```bash
# 백엔드 로그 확인
kubectl logs -n board-api-prod -l app=board-api --tail=50

# 정상 로그
INFO: Connected to database
INFO: Application startup complete
```

**배운 점 ⭐⭐⭐:**
- 502는 보통 백엔드 문제입니다
- Ingress 로그보다 백엔드 로그를 먼저 확인
- 한 가지 오타가 연쇄 에러를 유발합니다

## 🤔 근본 원인: 오타와 설정 관리

5가지 트러블슈팅을 돌아보니 **공통점**이 보였습니다.

```
❌ 반복되는 문제들:
- Service 이름 오타 (postgress vs postgres)
- 네임스페이스 오타 (postgresql-prod vs postgres-prod)
- Base64 인코딩 실수 (줄바꿈 포함, URL 오타)
- 같은 값을 여러 파일에 중복 작성
- 환경(dev/prod)별로 일일이 수정
```

특히 이런 부분이 문제였습니다.

### 문제 1: 하드코딩된 Service 이름

```yaml
# 3-configs/db-secret.yaml (board-api-prod용)
data:
  DATABASE_URL: ...@postgres-service.postgresql-prod.svc...

# 3-configs/db-secret.yaml (board-api-dev용)
data:
  DATABASE_URL: ...@postgres-service.postgresql-dev.svc...
```

Service 이름을 10군데가 넘게 반복해서 적었습니다. 하나라도 오타 나면 다 틀립니다.

### 문제 2: 중복된 설정

```yaml
# 백엔드 Deployment
resources:
  limits:
    memory: "512Mi"

# 프론트 Deployment
resources:
  limits:
    memory: "128Mi"
```

메모리 설정을 바꾸려면 모든 Deployment를 일일이 수정해야 했습니다.

### 문제 3: 환경별 관리 어려움

dev 환경 추가하려면 모든 YAML을 복사해서 네임스페이스만 바꿔야 했습니다. 파일이 2배로 늘어납니다.

## 💡 해결책: Helm으로 템플릿화

이런 문제들을 찾아보다가 **Helm**이라는 걸 알게 됐습니다.  다음 챌린지 과제에도 포함되어 있어서, 이번 기회에 공부해보기로 했습니다.

### Helm이 뭔가요?

Helm은 **K8s의 패키지 매니저**입니다. apt, yum, npm 같은 거죠.

```bash
# nginx-ingress 설치 (지금)
kubectl apply -f https://raw.githubusercontent.com/.../deploy.yaml

# nginx-ingress 설치 (Helm)
helm install nginx-ingress ingress-nginx/ingress-nginx
```

더 중요한 건, YAML을 **템플릿**으로 만들 수 있다는 점입니다.

### Helm으로 바꾸면?

**Before: 하드코딩**
```yaml
# db-secret.yaml
data:
  DATABASE_URL: cG9zdGdyZXNxbDovLy4uLkBwb3N0Z3Jlcy1zZXJ2aWNlLnBvc3RncmVzcWwtcHJvZC5zdmMuY2x1c3Rlci5sb2NhbDo1NDMyL3dlYWxpc3Q=
```

**After: 템플릿**
```yaml
# templates/db-secret.yaml
data:
  DATABASE_URL: {{ printf "postgresql://%s:%s@%s.%s.svc.cluster.local:5432/%s" 
    .Values.database.user 
    .Values.database.password 
    .Values.database.service 
    .Values.database.namespace 
    .Values.database.name | b64enc }}
```

**values.yaml (중앙 설정)**
```yaml
database:
  user: postgres
  password: mysupersecret
  service: postgres-service
  namespace: postgresql-prod
  name: wealist

backend:
  image: wealist-board-api
  tag: latest
  replicas: 2
  memory:
    request: 256Mi
    limit: 512Mi
```

이제 Service 이름을 바꾸고 싶으면 `values.yaml` 한 곳만 수정하면 됩니다!

### 환경별 관리도 쉬워집니다

```bash
# 운영 환경
helm install wealist ./wealist-chart -f values-prod.yaml

# 개발 환경
helm install wealist-dev ./wealist-chart -f values-dev.yaml
```

**values-prod.yaml**
```yaml
environment: production
namespace: board-api-prod
replicas: 3
```

**values-dev.yaml**
```yaml
environment: development
namespace: board-api-dev
replicas: 1
```

같은 템플릿으로 환경만 바꿔서 배포할 수 있습니다.

## 📚 Helm 기본 구조

```
wealist-chart/
├── Chart.yaml           # 차트 메타데이터
├── values.yaml          # 기본 설정값
├── values-prod.yaml     # 운영 환경 설정
├── values-dev.yaml      # 개발 환경 설정
└── templates/
    ├── namespaces.yaml
    ├── secrets.yaml
    ├── statefulset.yaml
    ├── deployments.yaml
    └── ingress.yaml
```

**Chart.yaml**
```yaml
apiVersion: v2
name: wealist
description: weAlist K8s Migration
version: 1.0.0
```

**templates/deployment.yaml 예시**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .Values.backend.name }}
  namespace: {{ .Values.namespace }}
spec:
  replicas: {{ .Values.backend.replicas }}
  template:
    spec:
      containers:
      - name: {{ .Values.backend.name }}
        image: {{ .Values.backend.image }}:{{ .Values.backend.tag }}
        resources:
          requests:
            memory: {{ .Values.backend.memory.request }}
          limits:
            memory: {{ .Values.backend.memory.limit }}
```

변수화된 부분이 `{{ .Values.xxx }}`로 바뀝니다.

## 🎯 다음 단계

이번 챌린지에서는 시간 관계상 Helm을 적용하지 못했습니다.  하지만 다음 챌린지 과제에 Helm이 포함되어 있어서, 이 프로젝트를 Helm Chart로 전환해볼 예정입니다.

**계획:**
1. 현재 YAML을 Helm 템플릿으로 변환
2. values.yaml로 설정 중앙화
3. dev/prod 환경 분리
4. Helm Chart GitHub에 공개

**사용 빈도: ⭐⭐⭐ (실무 70%)**

큰 조직일수록 Helm을 많이 씁니다. 여러 환경(dev/staging/prod)을 관리하거나, 같은 앱을 여러 번 배포할 때 필수입니다.

## ⚠️ 실무 팁

### 트러블슈팅 순서

1. **Pod 상태 확인**: `kubectl get pods -n <namespace>`
2. **로그 확인**: `kubectl logs -n <namespace> <pod-name>`
3. **상세 정보**: `kubectl describe pod -n <namespace> <pod-name>`
4. **이벤트 확인**: `kubectl get events -n <namespace> --sort-by='.lastTimestamp'`

대부분의 문제는 로그에 답이 있습니다.

### 오타 방지 전략

```
✅ 변수 사용 (Helm, Kustomize)
✅ 이름 규칙 정하기 (postgres-service, postgresql-prod)
✅ FQDN은 복사-붙여넣기
✅ Base64 인코딩 전에 echo로 확인
✅ CI/CD로 YAML 검증 (kubeval, kube-linter)
```

### 환경변수 관리

```
개발 단계:
ConfigMap (평문) → Secret (Base64) → Helm (템플릿화) → Vault (암호화)

실무 추천:
- 로컬 개발: ConfigMap
- 스테이징: Secret
- 프로덕션: 외부 저장소 (AWS Secrets Manager, Vault)
```

## 정리

5가지 트러블슈팅을 겪으며 많은 걸 배웠습니다.

- **ImagePullBackOff**: k3d image import 필요
- **CreateContainerConfigError**: Secret 의존성 확인
- **OOMKilled**: 메모리 충분히 할당
- **DATABASE_URL 오타**: 긴 FQDN 조심
- **502 Bad Gateway**: 백엔드 로그 먼저 확인

특히 **오타와 설정 중복**이 많은 문제를 일으켰습니다.    

이를 해결하기 위해 Helm을 알게 됐고, 다음 챌린지에서 본격적으로 적용해볼 예정입니다.

실수를 통해 배우는 게 정말 많았습니다. 다음엔 더 효율적으로 관리할 수 있을 것 같습니다!

## 💭 한번 더 생각해볼 질문들

**Q1**: Helm 말고 다른 템플릿 도구는 없나요?

**힌트**: Kustomize가 있습니다. K8s에 내장되어 있고 (`kubectl apply -k`), Helm보다 단순합니다. 오버레이 방식으로 base + patch 구조를 씁니다. Helm은 더 복잡한 로직과 패키지 배포에 강하고, Kustomize는 간단한 환경별 관리에 적합합니다.

---

**Q2**: Secret을 Git에 올려도 Base64니까 안전한가요?

---

**Q3**: 트러블슈팅할 때 가장 먼저 봐야 할 것은?

**힌트**: Pod 로그입니다. `kubectl logs <pod-name> --previous`로 재시작 전 로그도 볼 수 있습니다.   에러 메시지가 명확히 나와 있는 경우가 대부분입니다. 그 다음이 `kubectl describe pod`로 이벤트 확인입니다.

## 🎯 추가 학습

- Helm Chart 작성법
- Kustomize vs Helm 비교
- GitOps (ArgoCD, FluxCD)
- Kubernetes Operator Pattern

## 🔗 참고
- **[📂 프로젝트 GitHub 저장소](https://github.com/ressKim-io/wealist-k8s-migration)**
  - [전체 K8s Manifests](https://github.com/ressKim-io/wealist-k8s-migration/tree/main/k8s-manifests)
- [Helm 공식 문서](https://helm.sh/docs/)
- [Kubernetes Troubleshooting](https://kubernetes.io/docs/tasks/debug/)
- [12 Factor App](https://12factor.net/ko/) - 설정 관리 원칙
