---
title: "HPA로 Auto Scaling 구현하기"
excerpt: "부하에 따라 Pod를 자동으로 늘리고 줄이는 방법"
categories:
  - kubernetes
tags:
  - hpa
  - autoscaling
  - metrics-server
  - k8s
toc: true
toc_sticky: true
date: 2025-10-17 10:50:00 +0900
last_modified_at: 2025-10-17 10:50:00 +0900
---

## 🎯 핵심 개념

지금까지는 replicas를 고정으로 설정했다. 로비는 3개, 게임 룸은 2개 이런 식으로. 하지만 실제 서비스에서는 트래픽이 계속 변한다.

평일 낮에는 사람이 적고, 저녁과 주말에는 사람이 몰린다. 고정된 개수로는 비효율적이다. 트래픽이 적을 때는 리소스가 낭비되고, 많을 때는 서비스가 느려진다.

이걸 해결하는 게 **HPA(Horizontal Pod Autoscaler)**다. 부하에 따라 Pod 개수를 자동으로 조절한다.

편의점으로 비유하면, 손님이 많을 땐 알바를 더 부르고, 적을 땐 집에 보내는 것과 같다.

## 💡 왜 HPA가 필요한가

고정 replicas의 문제를 보자.

```yaml
# 평일 낮 (트래픽 적음)
replicas: 3  # 1개만 있어도 충분한데 2개가 놀고 있음 💸

# 주말 저녁 (트래픽 많음)
replicas: 3  # 부족해서 응답 느려짐 🐌
```

HPA를 쓰면 자동으로 조절된다.

```yaml
# 평일 낮
실제 Pod: 1개 (최소값)

# 주말 저녁
실제 Pod: 10개 (최대값)
```

비용 절감과 성능 확보를 동시에 할 수 있다.

## 📌 주요 특징

### Metrics Server 설치

HPA가 동작하려면 Pod의 CPU/메모리 사용량을 알아야 한다. 이걸 제공하는 게 **Metrics Server**다.

```bash
# Metrics Server 설치
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# k3d에서는 TLS 검증 비활성화 필요
kubectl patch deployment metrics-server -n kube-system --type='json' \
  -p='[{"op": "add", "path": "/spec/template/spec/containers/0/args/-", "value": "--kubelet-insecure-tls"}]'

# 설치 확인
kubectl get deployment metrics-server -n kube-system

# 메트릭 수집 대기 (1-2분)
kubectl top nodes
kubectl top pods -n game-prod
```

`kubectl top` 명령이 작동하면 Metrics Server가 정상이다.

```bash
NAME                      CPU(cores)   MEMORY(bytes)
k3d-k3s-local-server-0    200m         1200Mi
k3d-k3s-local-agent-0     150m         800Mi
k3d-k3s-local-agent-1     120m         750Mi
```

### HPA 생성 (게임 로비)

게임 로비에 HPA를 적용해보자. CPU 사용량이 70%를 넘으면 Pod를 늘리고, 낮아지면 줄인다.

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: game-lobby-hpa
  namespace: game-prod
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: game-lobby
  minReplicas: 2  # 최소 2개
  maxReplicas: 10  # 최대 10개
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70  # 평균 CPU 70% 목표
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300  # 5분간 안정화 후 축소
      policies:
      - type: Percent
        value: 50  # 한 번에 50%씩 축소
        periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 0  # 즉시 확장
      policies:
      - type: Percent
        value: 100  # 한 번에 100%씩 확장 (2배)
        periodSeconds: 30
```

배포하고 확인해보자.

```bash
# HPA 생성
kubectl apply -f 08-lobby-hpa.yaml

# HPA 상태 확인
kubectl get hpa -n game-prod

# 상세 정보
kubectl describe hpa game-lobby-hpa -n game-prod
```

정상이면 이렇게 보인다.

```bash
NAME              REFERENCE              TARGETS   MINPODS   MAXPODS   REPLICAS
game-lobby-hpa    Deployment/game-lobby  15%/70%   2         10        2
```

현재 CPU 사용량이 15%라 최소값인 2개로 유지되고 있다.

### 부하 테스트

HPA가 제대로 동작하는지 부하를 줘보자. `hey` 도구를 사용한다.

```bash
# hey 설치 (Mac)
brew install hey

# 게임 로비에 부하 주기
hey -z 3m -c 50 -q 10 http://localhost/lobby

# 다른 터미널에서 HPA 모니터링
watch kubectl get hpa -n game-prod

# Pod 증가 확인
kubectl get pods -n game-prod -w
```

부하를 주면 CPU 사용량이 올라가고, HPA가 Pod를 늘린다.

```bash
# 부하 전
game-lobby-hpa    15%/70%   2         10        2

# 부하 중 (1분 후)
game-lobby-hpa    85%/70%   2         10        4

# 부하 중 (2분 후)
game-lobby-hpa    92%/70%   2         10        8

# 부하 종료 (5분 후)
game-lobby-hpa    20%/70%   2         10        4

# 안정화 (10분 후)
game-lobby-hpa    15%/70%   2         10        2
```

CPU가 70%를 넘으면 Pod가 늘어나고, 낮아지면 다시 줄어든다.

## 📌 메모리 기반 HPA

CPU뿐만 아니라 메모리로도 스케일링할 수 있다. 채팅 서비스에 적용해보자.

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: game-chat-hpa
  namespace: game-prod
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: game-chat
  minReplicas: 2
  maxReplicas: 8
  metrics:
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80  # 평균 메모리 80% 목표
```

메모리 사용량이 80%를 넘으면 Pod를 늘린다.

### CPU와 메모리 동시 사용

둘 다 사용할 수도 있다.

```yaml
metrics:
- type: Resource
  resource:
    name: cpu
    target:
      type: Utilization
      averageUtilization: 70
- type: Resource
  resource:
    name: memory
    target:
      type: Utilization
      averageUtilization: 80
```

CPU 70% 또는 메모리 80% 중 하나라도 넘으면 스케일링된다.

## ⚠️ 주의사항

### Deployment에 resources 필수

HPA가 동작하려면 Deployment에 `resources.requests`가 반드시 있어야 한다.

```yaml
# ❌ 이렇게 하면 HPA 안 됨
spec:
  containers:
  - name: app
    image: nginx

# ✅ 이렇게 해야 HPA 동작
spec:
  containers:
  - name: app
    image: nginx
    resources:
      requests:
        cpu: "100m"
        memory: "128Mi"
```

requests가 없으면 HPA가 사용률을 계산할 수 없다.

### 너무 빠른 스케일링 방지

HPA는 기본적으로 15초마다 메트릭을 확인한다. 하지만 너무 자주 스케일링하면 불안정해진다.

```yaml
behavior:
  scaleDown:
    stabilizationWindowSeconds: 300  # 5분간 안정화
```

축소할 때는 신중하게, 확장할 때는 빠르게 하는 게 좋다.

### Metrics Server 메모리 사용량

Metrics Server도 리소스를 쓴다. 클러스터가 크면 메모리를 더 할당해야 한다.

```bash
# Metrics Server 리소스 확인
kubectl top pod -n kube-system | grep metrics-server
```

## 정리

HPA로 부하에 따라 Pod를 자동으로 늘리고 줄였다. Metrics Server를 설치하고, CPU/메모리 기준으로 스케일링했다. 부하 테스트로 실제 동작도 확인했다.

다음 글에서는 Ingress로 모든 서비스를 단일 진입점으로 통합해볼 예정이다.

## 💭 생각해볼 점

**Q**: HPA가 Pod를 늘릴 때, 노드에 리소스가 부족하면 어떻게 될까?

**힌트**: Pod는 Pending 상태로 남는다. 이럴 때는 Cluster Autoscaler가 필요하다. CA는 Pod가 Pending이면 노드를 자동으로 추가한다. HPA는 Pod 개수를, CA는 노드 개수를 조절한다.

## 🎯 추가 학습

- VPA(Vertical Pod Autoscaler)는 언제 쓰나
- Custom Metrics로 비즈니스 메트릭 기반 스케일링
- KEDA로 이벤트 기반 스케일링

## 🔗 참고

- [Kubernetes HPA 공식 문서](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
- [Metrics Server GitHub](https://github.com/kubernetes-sigs/metrics-server)
