---
title: "[챌린지 #1] 게임 서버 K8s 배포 - Part 5: 나머지 서비스"
excerpt: "게임 룸, 채팅, 랭킹 서비스를 워크로드 특성에 맞게 배치하기"
categories:
  - challenge
  - kubernetes
tags:
  - bootcamp
  - deployment
  - nodeSelector
  - workload
  - resource-optimization
series: "challenge-1-game-server"
toc: true
toc_sticky: true
date: 2025-10-17 10:40:00 +0900
last_modified_at: 2025-10-17 10:40:00 +0900
---

## 🎯 핵심 개념

로비 서비스를 띄웠으니 이제 나머지 서비스들을 배포할 차례다. 하지만 모든 서비스를 똑같이 배포하면 안 된다. 각 서비스의 특성이 다르기 때문이다.

- **게임 룸**: CPU를 많이 쓴다 (게임 로직 계산)
- **채팅**: 메모리를 많이 쓴다 (메시지 버퍼)
- **랭킹**: 단일 인스턴스면 충분하다

식당으로 비유하면, 주방장(게임 룸)은 화력 좋은 곳에, 바텐더(채팅)는 냉장고 큰 곳에, 계산대(랭킹)는 하나만 두는 것과 같다.

## 💡 왜 워크로드를 분리하나

k3d로 클러스터를 만들 때 워커 노드 2개에 라벨을 달아뒀었다.

```bash
kubectl label nodes k3d-k3s-local-agent-0 workload=compute
kubectl label nodes k3d-k3s-local-agent-1 workload=backend
```

이제 **nodeSelector**를 써서 서비스를 적절한 노드에 배치할 수 있다.

```yaml
spec:
  nodeSelector:
    workload: compute  # compute 라벨 가진 노드에만 배치
```

실무에서는 이렇게 노드를 나눈다:
- CPU 집약적 워크로드 → 고성능 CPU 노드
- 메모리 집약적 워크로드 → 고용량 메모리 노드
- GPU 필요한 워크로드 → GPU 노드

비용 최적화를 위해 워크로드 특성에 맞는 인스턴스 타입을 쓰는 거다.

## 📌 게임 룸 서비스 (CPU 집약적)

게임 로직을 계산하는 서비스다. CPU를 많이 쓴다.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: game-room
  namespace: game-prod
  labels:
    app: game-room
    tier: backend
spec:
  replicas: 2
  selector:
    matchLabels:
      app: game-room
  template:
    metadata:
      labels:
        app: game-room
        tier: backend
    spec:
      # CPU 집약적이므로 compute 노드에 배치
      nodeSelector:
        workload: compute
      containers:
      - name: room-server
        image: nginx:alpine
        ports:
        - containerPort: 80
          name: http
        envFrom:
        - configMapRef:
            name: game-common-config
        - configMapRef:
            name: gameroom-config
        resources:
          requests:
            memory: "256Mi"
            cpu: "500m"  # CPU 많이 할당
          limits:
            memory: "512Mi"
            cpu: "1000m"
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
---
apiVersion: v1
kind: Service
metadata:
  name: game-room
  namespace: game-prod
  labels:
    app: game-room
spec:
  type: ClusterIP
  selector:
    app: game-room
  ports:
  - name: http
    port: 80
    targetPort: 80
    protocol: TCP
```

CPU requests/limits가 로비보다 5배 크다. 게임 로직 계산에 필요한 만큼 할당했다.

## 📌 채팅 서비스 (메모리 집약적)

실시간 메시지를 처리하는 서비스다. 메모리를 많이 쓴다.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: game-chat
  namespace: game-prod
  labels:
    app: game-chat
    tier: backend
spec:
  replicas: 2
  selector:
    matchLabels:
      app: game-chat
  template:
    metadata:
      labels:
        app: game-chat
        tier: backend
    spec:
      # 일반 backend 노드에 배치
      nodeSelector:
        workload: backend
      containers:
      - name: chat-server
        image: nginx:alpine
        ports:
        - containerPort: 80
          name: http
        envFrom:
        - configMapRef:
            name: game-common-config
        - configMapRef:
            name: chat-config
        resources:
          requests:
            memory: "512Mi"  # 메모리 많이 할당
            cpu: "100m"
          limits:
            memory: "1024Mi"
            cpu: "200m"
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
---
apiVersion: v1
kind: Service
metadata:
  name: game-chat
  namespace: game-prod
  labels:
    app: game-chat
spec:
  type: ClusterIP
  selector:
    app: game-chat
  ports:
  - name: http
    port: 80
    targetPort: 80
    protocol: TCP
```

메모리 requests/limits가 크다. 메시지 버퍼를 메모리에 올려두기 때문이다.

## 📌 랭킹 서비스 (단일 인스턴스)

랭킹 데이터를 관리하는 서비스다. 일관성을 위해 하나만 띄운다.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: game-ranking
  namespace: game-prod
  labels:
    app: game-ranking
    tier: backend
spec:
  replicas: 1  # 단일 인스턴스
  selector:
    matchLabels:
      app: game-ranking
  template:
    metadata:
      labels:
        app: game-ranking
        tier: backend
    spec:
      nodeSelector:
        workload: backend
      containers:
      - name: ranking-server
        image: nginx:alpine
        ports:
        - containerPort: 80
          name: http
        envFrom:
        - configMapRef:
            name: game-common-config
        - configMapRef:
            name: ranking-config
        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
          limits:
            memory: "256Mi"
            cpu: "200m"
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
---
apiVersion: v1
kind: Service
metadata:
  name: game-ranking
  namespace: game-prod
  labels:
    app: game-ranking
spec:
  type: ClusterIP
  selector:
    app: game-ranking
  ports:
  - name: http
    port: 80
    targetPort: 80
    protocol: TCP
```

replicas가 1이다. 실무에서는 DB를 쓰겠지만, 이번 챌린지에서는 단순하게 갔다.

## 📌 배포 및 확인

```bash
# ConfigMap 먼저 생성 (각 서비스별)
kubectl apply -f 02-configmap.yaml

# 모든 서비스 배포
kubectl apply -f 05-gameroom-deployment.yaml
kubectl apply -f 06-chat-deployment.yaml
kubectl apply -f 07-ranking-deployment.yaml

# 전체 Pod 확인
kubectl get pods -n game-prod -o wide

# 노드별 Pod 배치 확인
kubectl get pods -n game-prod -o wide | grep compute
kubectl get pods -n game-prod -o wide | grep backend
```

정상이면 이렇게 뜬다.

```bash
NAME                           READY   STATUS    NODE
game-lobby-xxx                 1/1     Running   agent-0
game-lobby-xxx                 1/1     Running   agent-1
game-room-xxx                  1/1     Running   agent-0  # compute 노드
game-room-xxx                  1/1     Running   agent-0
game-chat-xxx                  1/1     Running   agent-1  # backend 노드
game-chat-xxx                  1/1     Running   agent-1
game-ranking-xxx               1/1     Running   agent-1
```

게임 룸은 compute 노드(agent-0)에, 채팅과 랭킹은 backend 노드(agent-1)에 배치됐다.

## ⚠️ 주의사항

### nodeSelector로 인한 Pending

노드 라벨이 없으면 Pod가 Pending 상태로 남는다.

```bash
$ kubectl get pods -n game-prod
NAME                    READY   STATUS    RESTARTS   AGE
game-room-xxx           0/1     Pending   0          1m

$ kubectl describe pod game-room-xxx -n game-prod
Events:
  Warning  FailedScheduling  pod didn't match node selector
```

이럴 때는 노드 라벨을 확인한다.

```bash
# 라벨 확인
kubectl get nodes --show-labels

# 라벨 추가
kubectl label nodes k3d-k3s-local-agent-0 workload=compute
```

### 리소스 부족

노드 리소스가 부족하면 Pod가 안 뜬다.

```bash
$ kubectl describe pod game-room-xxx -n game-prod
Events:
  Warning  FailedScheduling  Insufficient cpu
```

이럴 때는 requests를 줄이거나, 노드를 추가해야 한다.

### replicas=1의 위험성

랭킹 서비스는 replicas=1이라 Pod가 죽으면 서비스 전체가 중단된다. 실무에서는 이렇게 하면 안 되고, DB를 써서 상태를 분리하고 replicas를 2개 이상으로 가져간다.

## 정리

게임 룸, 채팅, 랭킹 서비스를 배포했다. nodeSelector로 워크로드 특성에 맞게 노드를 분리했고, 각 서비스에 적절한 리소스를 할당했다.

다음 글에서는 HPA로 부하에 따라 자동으로 Pod를 늘리고 줄이는 걸 해볼 예정이다.

## 💭 생각해볼 점

**Q**: nodeSelector 대신 더 유연한 방법은 없을까?

**힌트**: nodeAffinity를 쓰면 "선호하는 노드"를 지정할 수 있다. nodeSelector는 "반드시 이 라벨"이지만, nodeAffinity는 "가능하면 이 라벨, 안 되면 다른 곳"도 가능하다. 더 복잡하지만 유연하다.

## 🎯 추가 학습

- nodeAffinity와 podAffinity 차이
- Taint와 Toleration으로 노드 격리하기
- PriorityClass로 중요한 Pod 우선 배치

## 🔗 참고

- [Kubernetes Node Selection 공식 문서](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/)
- [Resource Management 공식 문서](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
