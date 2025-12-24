---
title: '게임 서버 K8s 배포 - Part 7: Ingress'
excerpt: 여러 서비스를 하나의 URL로 통합하는 방법
category: challenge
tags:
  - bootcamp
  - ingress
  - nginx-ingress
  - routing
date: '2025-10-17'
series:
  name: game-server
  order: 7
---

## 🎯 핵심 개념

지금까지 각 서비스마다 LoadBalancer나 NodePort를 만들었다면, 서비스마다 다른 포트나 IP를 써야 한다.

```bash
게임 로비: http://localhost:30080
게임 룸: http://localhost:30081
채팅: http://localhost:30082
랭킹: http://localhost:30083
```

이건 불편하다. 실제 서비스에서는 모든 기능이 하나의 도메인으로 들어온다.

```bash
https://game.example.com/lobby
https://game.example.com/room
https://game.example.com/chat
https://game.example.com/ranking
```

이걸 가능하게 하는 게 **Ingress**다. 경로(path)를 보고 적절한 Service로 라우팅한다.

아파트 경비실로 비유하면, 방문객이 "101동 1005호"라고 말하면 경비가 해당 동으로 안내하는 것과 같다. Ingress는 경비실, 각 Service는 각 동이다.

## 💡 왜 Ingress를 쓰나

### LoadBalancer의 문제

각 서비스마다 LoadBalancer를 만들면 비용이 많이 든다.

```yaml
# 서비스 4개 = LoadBalancer 4개
- game-lobby: LoadBalancer (비용 $0.025/시간)
- game-room: LoadBalancer (비용 $0.025/시간)
- game-chat: LoadBalancer (비용 $0.025/시간)
- game-ranking: LoadBalancer (비용 $0.025/시간)

# 한 달 비용: $0.025 * 4 * 24 * 30 = $72
```

Ingress를 쓰면 LoadBalancer 하나만 있으면 된다.

```yaml
# Ingress 1개 = LoadBalancer 1개
- nginx-ingress: LoadBalancer (비용 $0.025/시간)

# 한 달 비용: $0.025 * 24 * 30 = $18
```

75% 절약된다.

### 경로 기반 라우팅

Ingress는 URL 경로를 보고 Service를 선택한다.

```
http://localhost/lobby  → game-lobby Service
http://localhost/room   → game-room Service
http://localhost/chat   → game-chat Service
http://localhost/ranking → game-ranking Service
```

하나의 진입점으로 모든 서비스에 접근할 수 있다.

## 📌 주요 특징

### Ingress Controller 설치

Ingress 리소스만 만들어선 안 되고, **Ingress Controller**를 먼저 설치해야 한다. nginx-ingress를 사용한다.

```bash
# nginx-ingress-controller 설치
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.1/deploy/static/provider/cloud/deploy.yaml

# 설치 확인
kubectl get pods -n ingress-nginx

# LoadBalancer 생성 확인
kubectl get svc -n ingress-nginx
```

정상이면 이렇게 보인다.

```bash
NAME                                 TYPE           EXTERNAL-IP
ingress-nginx-controller             LoadBalancer   localhost
```

k3d에서는 자동으로 localhost에 매핑된다.

### Ingress 리소스 작성

이제 Ingress 리소스를 만든다. 경로별로 Service를 매핑한다.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: game-ingress
  namespace: game-prod
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  ingressClassName: nginx
  rules:
  - http:
      paths:
      - path: /lobby
        pathType: Prefix
        backend:
          service:
            name: game-lobby
            port:
              number: 80
      - path: /room
        pathType: Prefix
        backend:
          service:
            name: game-room
            port:
              number: 80
      - path: /chat
        pathType: Prefix
        backend:
          service:
            name: game-chat
            port:
              number: 80
      - path: /ranking
        pathType: Prefix
        backend:
          service:
            name: game-ranking
            port:
              number: 80
```

배포하고 확인해보자.

```bash
# Ingress 생성
kubectl apply -f 09-game-ingress.yaml

# Ingress 확인
kubectl get ingress -n game-prod

# 상세 정보
kubectl describe ingress game-ingress -n game-prod
```

![Ingress 라우팅 규칙](/images/challenge1/part7-ingress-rules.png)


### 접속 테스트

브라우저나 curl로 테스트해보자.

```bash
# 게임 로비
curl http://localhost/lobby

# 게임 룸
curl http://localhost/room

# 채팅
curl http://localhost/chat

# 랭킹
curl http://localhost/ranking
```

각 경로마다 다른 Service로 연결된다.

### rewrite-target 이해하기

```yaml
annotations:
  nginx.ingress.kubernetes.io/rewrite-target: /
```

이게 없으면 Service에 `/lobby` 경로 그대로 전달된다. 하지만 대부분 애플리케이션은 `/` 경로에서 시작한다.

```
# rewrite-target 없으면
요청: http://localhost/lobby
전달: http://game-lobby/lobby  ← 404 에러

# rewrite-target 있으면
요청: http://localhost/lobby
전달: http://game-lobby/  ← 정상
```

경로를 `/`로 재작성해준다.

### 도메인 기반 라우팅 (옵션)

경로뿐만 아니라 도메인으로도 라우팅할 수 있다.

```yaml
spec:
  rules:
  - host: lobby.game.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: game-lobby
            port:
              number: 80
  - host: chat.game.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: game-chat
            port:
              number: 80
```

이렇게 하면 서브도메인별로 다른 Service에 연결된다.

```
lobby.game.example.com → game-lobby
chat.game.example.com  → game-chat
```

## ⚠️ 주의사항

### Service는 ClusterIP로

Ingress를 쓸 때 Service는 ClusterIP 타입으로 만든다. LoadBalancer는 필요 없다.

```yaml
# ❌ 이렇게 하지 말자
apiVersion: v1
kind: Service
spec:
  type: LoadBalancer  # Ingress 있으면 불필요

# ✅ 이렇게 하자
apiVersion: v1
kind: Service
spec:
  type: ClusterIP  # Ingress가 알아서 연결
```

Ingress Controller의 LoadBalancer 하나만 있으면 된다.

### pathType 선택

pathType에는 세 가지가 있다.

```yaml
# Prefix: /lobby로 시작하는 모든 경로
pathType: Prefix  # /lobby, /lobby/123 모두 매칭

# Exact: 정확히 일치
pathType: Exact  # /lobby만 매칭

# ImplementationSpecific: Ingress Controller가 결정
pathType: ImplementationSpecific
```

보통은 Prefix를 쓴다.

### HTTPS 설정

프로덕션에서는 HTTPS를 써야 한다. cert-manager로 자동으로 인증서를 발급받을 수 있다.

```yaml
annotations:
  cert-manager.io/cluster-issuer: "letsencrypt-prod"
spec:
  tls:
  - hosts:
    - game.example.com
    secretName: game-tls
```

이번 챌린지에서는 로컬이라 HTTP만 사용했다.

## 정리

Ingress로 여러 서비스를 하나의 진입점으로 통합했다. nginx-ingress-controller를 설치하고, 경로 기반 라우팅을 설정했다. LoadBalancer를 하나만 써서 비용도 절감했다.

이제 게임 서버 K8s 배포가 완료됐다. Namespace로 환경을 분리하고, ConfigMap으로 설정을 관리하고, Deployment로 서비스를 띄우고, Service로 네트워크를 연결하고, HPA로 자동 스케일링하고, Ingress로 단일 진입점을 만들었다.

## 💭 생각해볼 점

**Q**: Ingress가 죽으면 모든 서비스가 죽는 거 아닌가? 단일 장애점(SPOF) 문제는?

**힌트**: nginx-ingress-controller도 Deployment로 실행된다. replicas를 2개 이상으로 설정하면 고가용성을 확보할 수 있다. 하나가 죽어도 다른 하나가 트래픽을 받는다. 프로덕션에서는 최소 2개, 보통 3개를 띄운다.

## 🎯 추가 학습

- cert-manager로 자동 HTTPS 인증서 발급
- Ingress의 sticky session 설정
- 다른 Ingress Controller (Traefik, HAProxy, Envoy)

## 🔗 참고
- **[📂 프로젝트 GitHub 저장소](https://github.com/ressKim-io/game-server-k8s)**
  - [Ingress YAML](https://github.com/ressKim-io/game-server-k8s/blob/main/k8s-manifests/09-ingress.yaml)
  - [전체 매니페스트 보기](https://github.com/ressKim-io/game-server-k8s/tree/main/k8s-manifests)

- [Kubernetes Ingress 공식 문서](https://kubernetes.io/docs/concepts/services-networking/ingress/)
- [nginx-ingress-controller GitHub](https://github.com/kubernetes/ingress-nginx)
