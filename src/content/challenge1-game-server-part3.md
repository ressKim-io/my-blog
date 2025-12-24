---
title: '게임 서버 K8s 배포 - Part 3: Deployment'
excerpt: 게임 로비 서비스를 K8s에 배포하며 배운 것들
category: challenge
tags:
  - bootcamp
  - deployment
  - pod
  - replicas
  - resources
date: '2025-10-17'
series:
  name: game-server
  order: 3
---

## 🎯 핵심 개념

이제 실제로 서비스를 띄워볼 차례다. K8s에서 애플리케이션을 실행하려면 **Deployment**를 만들어야 한다.

Deployment는 뭘까? 레스토랑 주방으로 비유해보자. 주방장(Deployment)이 요리사(Pod) 몇 명을 고용할지, 어떤 레시피(컨테이너 이미지)를 쓸지, 재료(리소스)는 얼마나 줄지 결정한다. 요리사 한 명이 아프면 자동으로 새 요리사를 뽑아주기도 한다.

## 💡 왜 Deployment를 쓰나

Pod를 직접 만들 수도 있지만, 실무에서는 거의 쓰지 않는다.

```yaml
# ❌ Pod 직접 생성 (실무에서 안 씀)
apiVersion: v1
kind: Pod
metadata:
  name: lobby-pod
spec:
  containers:
  - name: lobby
    image: nginx:alpine
```

이렇게 하면 Pod가 죽었을 때 자동으로 다시 안 뜬다. 수동으로 다시 만들어야 한다.

```yaml
# ✅ Deployment 사용 (실무 방식)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: game-lobby
spec:
  replicas: 3  # Pod 3개 유지
```

Deployment는 Pod가 죽으면 자동으로 다시 띄워준다. 업데이트할 때도 하나씩 교체해서 무중단 배포가 가능하다.

## 📌 주요 특징

### 게임 로비 Deployment 작성

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: game-lobby
  namespace: game-prod
  labels:
    app: game-lobby
    tier: frontend
spec:
  replicas: 3  # Pod 3개 실행
  selector:
    matchLabels:
      app: game-lobby
  template:
    metadata:
      labels:
        app: game-lobby
        tier: frontend
    spec:
      containers:
      - name: lobby-server
        image: nginx:alpine
        ports:
        - containerPort: 80
          name: http
        envFrom:
        - configMapRef:
            name: game-common-config
        - configMapRef:
            name: lobby-config
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
```

하나씩 뜯어보자.

### replicas: 몇 개 띄울까

```yaml
replicas: 3
```

Pod를 3개 띄우겠다는 뜻이다. 게임 로비는 트래픽이 많으니 여러 개 띄워서 부하를 분산한다.

하나가 죽어도 나머지 2개가 서비스를 계속한다. 그 사이에 K8s가 새 Pod를 자동으로 띄워서 다시 3개를 맞춘다.

### resources: 리소스 할당

```yaml
resources:
  requests:
    memory: "128Mi"  # 최소 보장
    cpu: "100m"
  limits:
    memory: "256Mi"  # 최대 사용
    cpu: "200m"
```

**requests**: 이 Pod가 최소한 필요한 리소스다. K8s는 이만큼 여유가 있는 노드에 Pod를 배치한다.

**limits**: 이 Pod가 최대로 쓸 수 있는 리소스다. 이걸 넘으면 컨테이너가 강제로 재시작된다.

![Deployment 상세 정보](/images/challenge1/part3-deployment-describe.png)

식당으로 비유하면, requests는 "최소 테이블 2개는 필요해요", limits는 "테이블 4개 넘게는 안 써요"다.

### probes: 건강 체크

**livenessProbe**: Pod가 살아있나 확인
```yaml
livenessProbe:
  httpGet:
    path: /
    port: 80
  initialDelaySeconds: 10  # 10초 후부터 체크
  periodSeconds: 10        # 10초마다 체크
```

이게 실패하면 Pod를 죽이고 새로 띄운다. 애플리케이션이 멈춰있을 때 자동으로 복구하는 장치다.

**readinessProbe**: Pod가 트래픽 받을 준비됐나 확인
```yaml
readinessProbe:
  httpGet:
    path: /
    port: 80
  initialDelaySeconds: 5
  periodSeconds: 5
```

이게 실패하면 Service에서 이 Pod를 제외한다. 초기화 중이거나 과부하 상태일 때 트래픽을 안 보내는 거다.

### 배포 및 확인

```bash
# 배포
kubectl apply -f 03-lobby-deployment.yaml

# Pod 상태 확인
kubectl get pods -n game-prod

# 상세 정보
kubectl describe deployment game-lobby -n game-prod

# 로그 확인
kubectl logs -f deployment/game-lobby -n game-prod
```

정상이면 이렇게 뜬다.

![Pod 3개 실행](/images/challenge1/part3-pods-running.png)

```bash
NAME                          READY   STATUS    RESTARTS   AGE
game-lobby-7d9f8c4b5-abc12    1/1     Running   0          1m
game-lobby-7d9f8c4b5-def34    1/1     Running   0          1m
game-lobby-7d9f8c4b5-ghi56    1/1     Running   0          1m
```

## ⚠️ 주의사항

### selector와 labels 일치

```yaml
spec:
  selector:
    matchLabels:
      app: game-lobby  # 이거랑
  template:
    metadata:
      labels:
        app: game-lobby  # 이거 같아야 함
```

이 둘이 안 맞으면 Deployment가 Pod를 못 찾는다. 처음엔 헷갈리는데, selector는 "이 라벨 가진 Pod 관리해줘", template의 labels는 "내가 만드는 Pod 라벨이야"라는 뜻이다.

### requests vs limits 설정

```yaml
# ❌ 이렇게 하지 말자
requests:
  cpu: "100m"
limits:
  cpu: "10000m"  # 터무니없이 큼
```

limits를 너무 크게 잡으면 다른 Pod가 리소스를 못 쓴다. requests를 너무 작게 잡으면 Pod가 제대로 안 돌아간다.

실무에서는 보통 limits를 requests의 2배 정도로 잡는다.

### image 태그 명시

```yaml
# ❌ 이렇게 하지 말자
image: nginx

# ✅ 이렇게 하자
image: nginx:alpine
```

태그 없이 쓰면 `latest`가 적용되는데, 이건 버전이 계속 바뀐다. 프로덕션에서는 정확한 버전을 명시해야 한다.

## 정리

Deployment로 게임 로비를 띄웠다. replicas로 개수를 정하고, resources로 리소스를 할당하고, probes로 건강을 체크했다.

다음 글에서는 이 Pod들을 외부에서 접근할 수 있게 Service를 만들어볼 예정이다.

## 💭 생각해볼 점

**Q**: replicas를 10개로 늘렸는데 노드가 2개밖에 없으면 어떻게 될까?

**힌트**: K8s는 가능한 한 Pod를 여러 노드에 골고루 분산시킨다. 하지만 노드 리소스가 부족하면 일부 Pod는 Pending 상태로 남는다. 이때는 노드를 추가하거나, Pod의 requests를 줄여야 한다.

## 🎯 추가 학습

- Rolling Update와 Recreate 배포 전략 차이
- Pod Disruption Budget으로 안전한 업데이트
- startupProbe는 언제 쓰나

## 🔗 참고
- **[📂 프로젝트 GitHub 저장소](https://github.com/ressKim-io/game-server-k8s)**
  - [Lobby Deployment YAML](https://github.com/ressKim-io/game-server-k8s/blob/main/k8s-manifests/03-lobby-deployment.yaml)

- [Kubernetes Deployment 공식 문서](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [Pod Lifecycle 공식 문서](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)
