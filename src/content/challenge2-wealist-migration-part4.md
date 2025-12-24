---
title: '팀 프로젝트 K8s 마이그레이션 - Part 4: 프론트엔드 & Ingress'
excerpt: nginx로 React 서빙하고 Ingress로 라우팅 설정하기
category: challenge
tags:
  - bootcamp
  - nginx
  - ingress
  - react
  - routing
date: '2025-10-20'
series:
  name: challenge-2-wealist-migration
  order: 4
---

## 🎯 핵심 과제

이번 Part에서는 프론트엔드를 배포하고, Ingress로 외부에서 접근할 수 있게 만들어 보겠습니다.

1. React 앱을 nginx로 서빙하기
2. Ingress Controller 설치하기
3. 경로 기반 라우팅 설정하기 (/, /api)
4. 로컬에서 도메인으로 접속하기

## 💡 React + nginx 배포

### Dockerfile 구조

React 같은 SPA는 빌드 후 정적 파일만 있으면 됩니다. nginx로 서빙하는 게 가장 효율적입니다.

```dockerfile
# 멀티스테이지 빌드
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# nginx로 서빙
FROM nginx:alpine
COPY --from=builder /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

첫 번째 스테이지에서 빌드하고, 두 번째 스테이지에서는 빌드 결과물만 nginx에 복사합니다.   
최종 이미지 크기가 훨씬 작아집니다.

### nginx 설정

```nginx
# nginx.conf
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # API 요청은 백엔드로 프록시
    location /api {
        proxy_pass http://board-api-service.board-api-prod.svc.cluster.local:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

`/about`, `/products` 같은 경로도 React Router가 처리하도록  SPA는 모든 경로를 `index.html`로 보내야 합니다.

### 이미지 빌드 & import

```bash
# 프론트엔드 이미지 빌드
cd applications/frontend
docker build -t wealist-frontend:latest .

# k3d로 import
k3d image import wealist-frontend:latest -c k3s-local

# 확인
docker exec k3d-k3s-local-server-0 crictl images | grep wealist-frontend
```

### Deployment 작성

```yaml
# 6-frontend/frontend-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: front-prod
spec:
  replicas: 2
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      containers:
      - name: frontend
        image: wealist-frontend:latest
        imagePullPolicy: Never
        ports:
        - containerPort: 80
          name: http
        resources:
          requests:
            memory: "64Mi"
            cpu: "50m"
          limits:
            memory: "128Mi"
            cpu: "100m"
        livenessProbe:
          httpGet:
            path: /
            port: 80
          initialDelaySeconds: 10
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /
            port: 80
          initialDelaySeconds: 5
          periodSeconds: 5
```

정적 파일만 서빙하니까 백엔드보다 적은 64Mi 로 정합니다.

### Service 생성

```yaml
# 6-frontend/frontend-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: frontend-service
  namespace: front-prod
spec:
  type: ClusterIP
  selector:
    app: frontend
  ports:
  - port: 80
    targetPort: 80
```

ClusterIP로 만들고, 나중에 Ingress에서 이 Service를 연결할 해보겠습니다.

## 📌 Ingress Controller 설치

### nginx-ingress란?

Ingress는 L7 로드밸런서입니다.  HTTP/HTTPS 요청을 받아서 경로나 도메인에 따라 다른 Service로 라우팅합니다.


**예시:**
```
wealist.local/       → frontend-service
wealist.local/api/   → board-api-service
```

Ingress 리소스만 만들면 안 되고, **Ingress Controller**가 필요합니다. 실제 트래픽을 처리하는 구현체죠.

### k3d에서 nginx-ingress 설치

k3d는 Traefik을 기본으로 제공하지만, nginx-ingress로 바꿔서 진행을 해보겠습니다.

```bash
# nginx-ingress controller 설치
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.1/deploy/static/provider/cloud/deploy.yaml

# 네임스페이스 확인
kubectl get namespace

# ingress-nginx 네임스페이스에 Pod 생성됨
kubectl get pods -n ingress-nginx

# 서비스 확인
kubectl get svc -n ingress-nginx
```

정상이면 이렇게 뜹니다.

```bash
NAME                                 TYPE           CLUSTER-IP      EXTERNAL-IP
ingress-nginx-controller             LoadBalancer   10.43.123.45    <pending>
```

k3d는 로컬이라 EXTERNAL-IP가 `<pending>` 상태입니다. 포트포워딩으로 접속해 보겠습니다.

**사용 빈도: ⭐⭐⭐ (실무 90%)**

실무에서는 nginx-ingress나 Traefik을 거의 필수로 씁니다.  클라우드에서는 ALB/NLB Ingress Controller도 많이 씁니다.

## 🌐 Ingress 리소스 작성

### 백엔드 Ingress

```yaml
# 7-ingress/backend-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: backend-ingress
  namespace: board-api-prod
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /$2
spec:
  ingressClassName: nginx
  rules:
  - host: wealist.local
    http:
      paths:
      - path: /api(/|$)(.*)
        pathType: ImplementationSpecific
        backend:
          service:
            name: board-api-service
            port:
              number: 8000
```

**rewrite-target 설명:**

```
요청: wealist.local/api/boards
실제 전달: board-api-service:8000/boards
```

FastAPI는 `/api` 경로를 모르기때문에  `/api` 프리픽스를 제거하고 백엔드로 보냅니다. 

### 프론트엔드 Ingress

```yaml
# 7-ingress/frontend-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: frontend-ingress
  namespace: front-prod
spec:
  ingressClassName: nginx
  rules:
  - host: wealist.local
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: frontend-service
            port:
              number: 80
```

루트 경로(`/`)는 프론트엔드로 보냅니다.

### 배포 및 확인

```bash
# Ingress 배포
kubectl apply -f k8s-manifests/7-ingress/

# Ingress 확인
kubectl get ingress -A

# 상세 정보
kubectl describe ingress backend-ingress -n board-api-prod
```

정상이면 이렇게 뜹니다.

```bash
NAMESPACE        NAME               CLASS   HOSTS           ADDRESS      PORTS
board-api-prod   backend-ingress    nginx   wealist.local   172.19.0.4   80
front-prod       frontend-ingress   nginx   wealist.local   172.19.0.4   80
```

## 🔗 로컬에서 접속하기

### /etc/hosts 설정

`wealist.local` 도메인을 로컬호스트로 매핑해야 합니다.

```bash
# /etc/hosts 편집 (관리자 권한 필요)
sudo nano /etc/hosts

# 추가
127.0.0.1 wealist.local
```

Windows WSL2라면:

```bash
# WSL에서 실행
echo "127.0.0.1 wealist.local" | sudo tee -a /etc/hosts

# Windows hosts 파일도 수정 (선택)
# C:\Windows\System32\drivers\etc\hosts
```

### 포트포워딩

```bash
# Ingress Controller로 포트포워딩
kubectl port-forward -n ingress-nginx svc/ingress-nginx-controller 8080:80
```

이제 `localhost:8080`으로 들어오는 요청이 Ingress Controller로 전달됩니다.

### 브라우저에서 확인

```
http://localhost:8080
```

브라우저가 Host 헤더로 `wealist.local`을 보내고, Ingress가 이걸 보고 라우팅합니다.

### curl로 테스트

```bash
# 프론트엔드
curl -H "Host: wealist.local" http://localhost:8080/

# 백엔드
curl -H "Host: wealist.local" http://localhost:8080/api/health
```

정상이면 각각 HTML과 JSON 응답이 옵니다.

## ⚠️ 주의사항

### pathType 선택

```yaml
# Prefix: /api로 시작하는 모든 경로
pathType: Prefix
path: /api

# Exact: 정확히 /api만
pathType: Exact
path: /api

# ImplementationSpecific: 컨트롤러 의존
pathType: ImplementationSpecific
path: /api(/|$)(.*)
```

정규식을 쓰려면 `ImplementationSpecific`을 써야 합니다.

### Host 헤더 문제

```bash
# ❌ Host 헤더 없이 요청
curl http://localhost:8080/

# 404 Not Found (Ingress가 라우팅 못 함)
```

Ingress는 Host 헤더를 보고 라우팅합니다.  curl로 테스트할 땐 `-H "Host: wealist.local"`을 꼭 붙여야 합니다.

### CORS 이슈

프론트엔드에서 `/api`로 요청하면 CORS 에러가 날 수 있습니다.

```javascript
// 프론트엔드 코드
fetch('/api/boards')  // Same-origin이라 OK

fetch('http://localhost:8000/boards')  // CORS 에러!
```

Ingress를 거치면 같은 도메인이니까 CORS 문제가 없습니다. 이게 Ingress의 큰 장점입니다.

## 정리

프론트엔드를 nginx로 서빙하고, Ingress로 백엔드와 연결했습니다.

- React 빌드 결과를 nginx 컨테이너에 복사
- Ingress Controller 설치 (nginx-ingress)
- 경로 기반 라우팅 설정 (`/` → frontend, `/api` → backend)
- /etc/hosts와 포트포워딩으로 로컬 접속

이제 `http://localhost:8080`으로 전체 앱을 쓸 수 있습니다!

다음 Part에서는 지금까지 겪었던 모든 트러블슈팅을 정리해보겠습니다.

## 💭 한번 더 생각해볼 질문들

**Q1**: Ingress 대신 각 Service를 LoadBalancer 타입으로 만들면 안 될까요?

---

**Q2**: `/api` 경로를 프론트엔드 nginx에서 proxy_pass로 처리하는 것과 Ingress를 쓰는 것, 뭐가 다를까요?

---

**Q3**: HTTPS는 어떻게 설정하나요?

## 🎯 추가 학습

- cert-manager로 HTTPS 자동 설정
- Ingress Annotation으로 Rate Limiting, IP Whitelist
- Canary Deployment with Ingress

## 🔗 참고
- **[📂 프로젝트 GitHub 저장소](https://github.com/ressKim-io/wealist-k8s-migration)**
  - [Frontend Deployment YAML](https://github.com/ressKim-io/wealist-k8s-migration/tree/main/k8s-manifests/6-frontend)
  - [Ingress YAML](https://github.com/ressKim-io/wealist-k8s-migration/tree/main/k8s-manifests/7-ingress)
- [Kubernetes Ingress 공식 문서](https://kubernetes.io/docs/concepts/services-networking/ingress/)
- [nginx-ingress Controller](https://kubernetes.github.io/ingress-nginx/)
