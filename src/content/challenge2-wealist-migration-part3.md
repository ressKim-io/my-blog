---
title: '팀 프로젝트 K8s 마이그레이션 - Part 3: 백엔드 배포 & Secret 관리'
excerpt: 로컬 이미지 사용부터 OOMKilled 해결까지
category: challenge
tags:
  - bootcamp
  - k3d
  - secret
  - fastapi
  - troubleshooting
  - oomkilled
date: '2025-10-20'
series:
  name: challenge-2-wealist-migration
  order: 3
---

## 🎯 핵심 과제

이번 Part에서는 FastAPI 백엔드를 K8s에 배포하면서 실전에서 마주치는 문제들을 다뤄보겠습니다.

1. 로컬 이미지를 k3d로 가져오기
2. Secret으로 민감 정보 관리하기
3. 다른 네임스페이스의 DB 접근하기
4. 메모리 부족으로 Pod가 죽는 문제 해결하기

## 💡 k3d image import: 로컬 이미지 사용

### Docker Hub 없이 개발하기

개발할 때마다 Docker Hub에 푸시하고 풀하는 건 번거롭습니다. k3d는 로컬 이미지를 클러스터에 바로 넣을 수 있습니다.

```bash
# 1. 백엔드 이미지 빌드
cd applications/backend/services/kanban
docker build -t wealist-board-api:latest .

# 2. k3d 클러스터로 import
k3d image import wealist-board-api:latest -c k3s-local

# 3. 확인
docker exec k3d-k3s-local-server-0 crictl images | grep wealist
```

![k3d image import](/images/challenge2/part3-image-import.png)

이제 매니페스트에서 이 이미지를 바로 쓸 수 있습니다.

### imagePullPolicy 설정

```yaml
containers:
- name: board-api
  image: wealist-board-api:latest
  imagePullPolicy: Never  # 중요!
```

`imagePullPolicy: Never`를 꼭 써야 합니다.
안 그러면 K8s가 Docker Hub에서 이미지를 찾으려고 해서 `ImagePullBackOff` 에러가 납니다.

**사용 빈도: 로컬 개발 95%**

실제 운영 환경에서는 컨테이너 레지스트리(Docker Hub, ECR, GCR)를 쓰지만, 로컬 개발할 땐 이 방법이 훨씬 빠릅니다.

**⚠️ 실제 환경에서는?**

운영 환경에서는 컨테이너 레지스트리를 반드시 사용해야 합니다.

```yaml
# AWS ECR
image: 123456789.dkr.ecr.ap-northeast-2.amazonaws.com/wealist-board-api:v1.0.0
imagePullPolicy: Always  # 최신 이미지 자동 pull

# Docker Hub
image: mycompany/wealist-board-api:v1.0.0
imagePullPolicy: IfNotPresent  # 없을 때만 pull
```

**로컬 vs 운영 비교:**
```
로컬 개발 (k3d):
- k3d image import 사용
- imagePullPolicy: Never
- 빠른 반복 개발

운영 환경:
- 레지스트리에 이미지 푸시 필수
- imagePullPolicy: Always 또는 IfNotPresent
- 버전 태그 명시 (latest 금지)
- CI/CD로 자동화
```

## 📌 Secret: 민감 정보 관리

### ConfigMap vs Secret

환경변수를 넣을 때 두 가지 선택지가 있습니다.

```yaml
# ConfigMap: 일반 설정
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  LOG_LEVEL: "INFO"
  API_PORT: "8000"
```

```yaml
# Secret: 민감 정보
apiVersion: v1
kind: Secret
metadata:
  name: db-secret
type: Opaque
data:
  POSTGRES_PASSWORD: bXlzdXBlcnNlY3JldA==  # Base64
  DATABASE_URL: cG9zdGdyZXNxbDovLy4uLg==
```

**차이점:**
- ConfigMap: 평문 저장, 누구나 볼 수 있음
- Secret: Base64 인코딩, RBAC으로 접근 제어 가능

### Base64 인코딩 실전

Secret은 값을 Base64로 인코딩해봅시다.
(실전에서는 Base64로 안됩니다. 이건 암호화가 아닙니다)

```bash
# 비밀번호 인코딩
echo -n "mysupersecret" | base64
# 결과: bXlzdXBlcnNlY3JldA==

# DATABASE_URL 인코딩 (크로스 네임스페이스 FQDN 포함)
echo -n "postgresql://postgres:mysupersecret@postgres-service.postgresql-prod.svc.cluster.local:5432/wealist" | base64
# 결과: cG9zdGdyZXNxbDovL3Bvc3RncmVzOm15c3VwZXJzZWNyZXRAcG9zdGdyZXMtc2VydmljZS5wb3N0Z3Jlc3FsLXByb2Quc3ZjLmNsdXN0ZXIubG9jYWw6NTQzMi93ZWFsaXN0
```

**⚠️ 중요**: `-n` 옵션을 꼭 써야 합니다. 안 그러면 줄바꿈 문자가 포함돼서 인코딩이 틀어집니다.

### Secret 생성

```yaml
# 3-configs/db-secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-secret
  namespace: board-api-prod
type: Opaque
data:
  POSTGRES_USER: cG9zdGdyZXM=
  POSTGRES_PASSWORD: bXlzdXBlcnNlY3JldA==
  POSTGRES_DB: d2VhbGlzdA==
  DATABASE_URL: cG9zdGdyZXNxbDovL3Bvc3RncmVzOm15c3VwZXJzZWNyZXRAcG9zdGdyZXMtc2VydmljZS5wb3N0Z3Jlc3FsLXByb2Quc3ZjLmNsdXN0ZXIubG9jYWw6NTQzMi93ZWFsaXN0
```

네임스페이스별로 Secret을 만들어야 합니다. `board-api-prod`에서 만든 Secret은 다른 네임스페이스에서 쓸 수 없습니다.

### Deployment에서 Secret 사용

```yaml
# 5-backend/board-api-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: board-api
  namespace: board-api-prod
spec:
  replicas: 2
  selector:
    matchLabels:
      app: board-api
  template:
    metadata:
      labels:
        app: board-api
    spec:
      containers:
      - name: board-api
        image: wealist-board-api:latest
        imagePullPolicy: Never
        ports:
        - containerPort: 8000
          name: http
        envFrom:
        - secretRef:
            name: db-secret  # Secret 전체를 환경변수로
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "200m"
        livenessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 10
          periodSeconds: 5
```

`envFrom` + `secretRef`를 쓰면 Secret의 모든 키를 환경변수로 주입합니다.

```bash
# Pod 안에서 확인
kubectl exec -n board-api-prod <pod-name> -- env | grep DATABASE_URL
# DATABASE_URL=postgresql://postgres:mysupersecret@...
```

## 🌐 크로스 네임스페이스 통신

### 문제 상황

백엔드는 `board-api-prod` 네임스페이스,
DB는 `postgresql-prod` 네임스페이스로 서로 다른 네임스페이스로 관리합니다.

```bash
# ❌ 같은 네임스페이스 접근 (안 됨)
postgresql://postgres:mysupersecret@postgres-service:5432/wealist
```

이렇게 하면 `board-api-prod` 네임스페이스 안에서 `postgres-service`를 찾으려고 합니다.

당연히 못 찾습니다.

### FQDN으로 해결

다른 네임스페이스의 Service에 접근하려면 **FQDN**(Fully Qualified Domain Name)을 써야 합니다.

```bash
# ✅ 크로스 네임스페이스 접근
postgresql://postgres:mysupersecret@postgres-service.postgresql-prod.svc.cluster.local:5432/wealist
```

**형식:**
```
<service-name>.<namespace>.svc.cluster.local
```

K8s의 CoreDNS가 이 주소를 해석해서 올바른 Service로 연결해줍니다.

**실무 팁 ⭐⭐⭐:**
- 같은 네임스페이스: `service-name`
- 다른 네임스페이스: `service-name.namespace.svc.cluster.local`
- 항상 FQDN 쓰면 안전 (네임스페이스 이동해도 작동)

**⚠️ 실무에서는 어떻게 하나요?**

실제 운영 환경에서는 케이스별로 다르게 접근합니다.

**Case 1: 같은 네임스페이스 (일반적 ⭐⭐⭐ 90%)**
```
my-app (namespace)
├── frontend
├── backend
└── redis
```
관련 서비스를 같은 네임스페이스에 두고 간단하게 `service-name`으로 접근합니다.

**Case 2: 공유 인프라 분리 (이 글 케이스 ⭐⭐ 30%)**
```
postgresql-prod (namespace) ← 여러 앱이 공유
board-api-prod (namespace)
user-api-prod (namespace)
```
DB를 독립 네임스페이스로 분리하고, FQDN으로 접근합니다. 주로 인프라 팀이 DB를 중앙 관리할 때 씁니다.

**Case 3: 외부 관리형 DB (중요!! 실무 가장 많음 ⭐⭐⭐ 95%)**
```yaml
# AWS RDS, Google Cloud SQL 등
DATABASE_URL: postgresql://user:pwd@mydb.abc123.rds.amazonaws.com:5432/db
```
K8s 클러스터 외부의 관리형 DB를 사용합니다. 백업/복구, 고가용성, 스케일링이 자동화되어 있어서 실무에서 가장 많이 씁니다.

**K8s 안에 DB를 띄우는 건:**
- 개발/테스트 환경
- 작은 사이드 프로젝트
- 온프레미스 환경
- 특수한 요구사항 (데이터 주권, 컴플라이언스)

이번 챌린지에서는 K8s 학습 목적으로 StatefulSet을 사용했지만, 실제 서비스라면 RDS 같은 관리형 DB를 고려해야 합니다.

## 🔥 트러블슈팅: OOMKilled

### 문제 발견

배포하고 보니 Pod가 계속 재시작 되는 현상이 있었습니다.
실행하고 모니터링을 하니깐 시작 후 바로 꺼지고 다음과 같이 나옵니다.

```bash
kubectl get pods -n board-api-prod

NAME                        READY   STATUS      RESTARTS   AGE
board-api-d6f7f94d7-2nvfd   0/1     OOMKilled   3          2m
```

`OOMKilled`는 **Out Of Memory Killed**의 약자입니다. Pod가 할당된 메모리를 초과해서 강제 종료된 겁니다.

### 원인 분석

OOMKilled 가 보이지만 한번 더 describe 를 이용해 확인해 보겠습니다.

```bash
kubectl describe pod -n board-api-prod board-api-d6f7f94d7-2nvfd

# Last State:
#   Terminated:
#     Reason: OOMKilled
#     Exit Code: 137
```

처음에 설정한 값은 다음과 같습니다.

```yaml
resources:
  requests:
    memory: "128Mi"
  limits:
    memory: "256Mi"  # 너무 작음!
```

FastAPI 앱이 시작할 때 256Mi를 넘어버린 겁니다.
Python은 런타임과 라이브러리들이 메모리를 많이 쓴다고 합니다.

### 해결: 메모리 증가

```yaml
resources:
  requests:
    memory: "256Mi"  # 2배 증가
  limits:
    memory: "512Mi"  # 2배 증가
```

이렇게 바꾸니까 정상적으로 돌아갔습니다.

```bash
kubectl get pods -n board-api-prod

NAME                        READY   STATUS    RESTARTS   AGE
board-api-84744fcc8b-abc12  1/1     Running   0          5m
board-api-84744fcc8b-def34  1/1     Running   0          5m
```

파이썬은 실행할 때 생각보다 메모리를 많이 먹는다는것도 추가로 알 수 있었네요.


**실무 팁 ⭐⭐⭐:**
- Python/Node.js 앱: 최소 256Mi
- Java/Spring Boot: 최소 512Mi
- 프로덕션: limits를 requests의 2배로 설정
- 처음엔 넉넉하게, 모니터링하면서 조정

### 재시작 완료

```bash
# Deployment 재시작
kubectl rollout restart deployment board-api -n board-api-prod

# 롤아웃 확인
kubectl rollout status deployment board-api -n board-api-prod

# 로그 확인
kubectl logs -n board-api-prod -l app=board-api --tail=50
```

로그를 보니 DB 연결도 성공했습니다.

```
INFO: Connected to database
INFO: Application startup complete
INFO: Uvicorn running on http://0.0.0.0:8000
```

## ⚠️ 주의사항

### Secret은 네임스페이스별로

```bash
# board-api-prod용 Secret
kubectl apply -f 3-configs/db-secret.yaml

# ❌ postgresql-prod에서는 못 씀
kubectl get secret db-secret -n postgresql-prod
# Error: secrets "db-secret" not found
```

네임스페이스마다 Secret을 따로 만들어야 합니다. 공유되지 않습니다.

### Base64는 암호화가 아님

```bash
# Base64 디코딩은 누구나 가능
echo "bXlzdXBlcnNlY3JldA==" | base64 -d
# mysupersecret
```

Secret은 그냥 인코딩일 뿐 암호화가 아닙니다. 실제 운영 환경에서는:
- **외부 저장소 사용** (AWS Secrets Manager, Vault)
- **암호화된 Secret** (Sealed Secrets, SOPS)
- **RBAC으로 접근 제어**

이런 추가 보안 레이어가 필요합니다.

### 헬스체크 경로 확인

```yaml
livenessProbe:
  httpGet:
    path: /health  # 이 경로가 실제로 있어야 함!
    port: 8000
```

FastAPI 앱에 `/health` 엔드포인트가 없으면 헬스체크가 실패합니다. 백엔드 코드에 추가해야 합니다.

```python
# FastAPI 앱
@app.get("/health")
async def health():
    return {"status": "healthy"}
```

## 정리

백엔드를 K8s에 배포하면서 여러 가지를 배웠습니다.

- Secret으로 민감 정보를 Base64 인코딩해서 관리(실제는 암호화 적용과 분리 필수)
- FQDN으로 다른 네임스페이스의 Service 접근(실제는 외부 저장소 RDS 같은것을 사용)
- OOMKilled는 메모리 부족, limits를 늘려서 해결(올리는 프로그램이 무거운지 아닌지도 확인필요(python, java등))

다음 Part에서는 프론트엔드를 배포하고, Ingress로 외부에서 접근할 수 있게 만들어보겠습니다.

## 💭 한번 더 생각해볼 질문들

**Q1**: Secret을 환경변수로 주입하는 것과 파일로 마운트하는 것, 뭐가 다를까요?

**힌트**: 환경변수는 `envFrom`으로 간단하지만, 프로세스 목록에서 보일 수 있습니다.
          파일 마운트는 `volumeMounts`로 복잡하지만, 더 안전합니다. 특히 큰 인증서 파일은 파일로 마운트하는 게 좋습니다.

---

**Q2**: 다른 클러스터의 DB에 접근해야 한다면? (예: 외부 RDS)

**힌트**: ExternalName Service를 만들어서 외부 도메인을 K8s Service처럼 쓸 수 있습니다. 
          또는 Endpoints를 직접 만들어서 IP를 지정할 수도 있습니다.

---

**Q3**: OOMKilled가 계속 나는데 메모리를 무한정 늘릴 수는 없다. 이럴땐?

**힌트**: 애플리케이션 레벨에서 메모리 누수를 찾아야 합니다.
          Python의 경우 `memory_profiler`로 분석하고, 불필요한 객체를 del하거나 가비지 컬렉션을 강제로 실행할 수 있습니다.
          K8s는 어디까지나 인프라일 뿐, 근본 원인은 코드에 있습니다.

## 🎯 추가 학습

- Sealed Secrets로 Git에 안전하게 Secret 저장
- Horizontal Pod Autoscaler로 메모리 기반 오토스케일링
- Resource Quota로 네임스페이스별 리소스 제한

## 🔗 참고
- **[📂 프로젝트 GitHub 저장소](https://github.com/ressKim-io/wealist-k8s-migration)**
  - [Backend Deployment YAML](https://github.com/ressKim-io/wealist-k8s-migration/tree/main/k8s-manifests/5-backend)
  - [Secret YAML](https://github.com/ressKim-io/wealist-k8s-migration/tree/main/k8s-manifests/3-configs)
- [Kubernetes Secret 공식 문서](https://kubernetes.io/docs/concepts/configuration/secret/)
- [Managing Resources for Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
