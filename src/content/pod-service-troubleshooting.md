---
title: Pod는 Running인데 왜 접근이 안 돼? K8s Service 트러블슈팅
excerpt: ''
category: kubernetes
tags:
  - kubernetes
  - k8s
  - service
  - troubleshooting
  - endpoints
  - targetport
  - networking
  - kind
date: '2025-10-14'
---

# Pod는 Running인데 왜 접근이 안 돼? Service 트러블슈팅

## 🔥 상황
Kubernetes 학습 중 Service 설정 문제를 해결하는 과제를 받았다. `broken-frontend-service.yaml`이라는 의도적으로 깨진 YAML 파일을 분석하고 고쳐야 하는 상황. Pod는 멀쩡하게 떠있는데 Service로 접근이 안 된다.

## 💥 증상

Pod 상태를 확인해보니 정상이었다.

```
kubectl get pods -n day1-challenge -l app=frontend

NAME                        READY   STATUS    RESTARTS   AGE
frontend-54f549658d-csr6c   1/1     Running   0          8m
frontend-54f549658d-ljtc5   1/1     Running   0          8m
```

Service도 생성되어 있고, NodePort도 할당되어 있었다.

```
kubectl get svc -n day1-challenge

NAME               TYPE       CLUSTER-IP     PORT(S)
frontend-service   NodePort   10.96.183.79   80:30080/TCP
```

그런데 접근이 안 된다. 로컬에서 `curl localhost:30080`을 시도했지만 Connection refused. "뭐지? 설정이 틀렸나?"

## 🔍 시도했던 것들

### 1차 시도: Pod 상태 확인

먼저 Pod에 문제가 있는지 확인했다.

```
kubectl describe pod frontend-54f549658d-csr6c -n day1-challenge
```

Events를 확인해도 에러가 없었다. Pod는 Running 상태고, 이미지도 정상적으로 받아왔다. "Pod는 문제없네?"

### 2차 시도: Service 내부 접근 테스트

클러스터 내부에서 Service로 접근해보기로 했다.

```
kubectl run curl-test --rm -it -n day1-challenge --image=curlimages/curl -- sh
```

프롬프트가 나오길 기다리다가 Enter를 눌러서 명령어를 입력했다.

```
curl frontend-service
```

그런데... 응답이 오지 않는다. 계속 기다리는 중... Timeout인가? 😱

Ctrl+C로 중단하고 다른 방법을 시도해야겠다고 생각했다.

### 3차 시도: Endpoints 확인 (결정적 단서!)

"Service가 Pod을 제대로 찾고 있나?" 하는 의심이 들어서 Endpoints를 확인했다.

```
kubectl get endpoints -n day1-challenge frontend-service

NAME               ENDPOINTS                       AGE
frontend-service   10.244.0.70:80,10.244.0.71:80   9m
```

어? IP는 있네? 그럼 Service가 Pod은 찾은 건데... 근데 포트 번호를 다시 보니 뭔가 이상했다. 

Service YAML을 다시 확인해봤다.

```
# Service 설정
spec:
  ports:
  - port: 80
    targetPort: 8080  # ← 이게 수상하다
    nodePort: 30080
```

그리고 Pod의 실제 포트를 확인했다.

```
kubectl describe pod frontend-54f549658d-csr6c -n day1-challenge

Containers:
  nginx:
    Container ID:   containerd://16500ee4...
    Image:          nginx:1.27
    Port:           80/TCP  # ← 응? 80이네?
```

**아! Service는 8080으로 트래픽을 보내는데, nginx는 80 포트에서 듣고 있었다!**

## 💡 원인

문제를 정리하면 이랬다:

**Service 설정 (broken-frontend-service.yaml)**
```
spec:
  ports:
  - port: 80
    targetPort: 8080  # ❌ 문제!
```

**Pod 실제 포트**
```
spec:
  containers:
  - name: nginx
    ports:
    - containerPort: 80  # nginx 기본 포트
```

Service가 Pod으로 트래픽을 보낼 때 8080 포트로 보내고 있었는데, nginx는 80 포트에서만 듣고 있으니 당연히 연결이 안 된 것이다. **targetPort 미스매치!**

## ✅ 해결

YAML 파일을 수정했다.

```
# broken-frontend-service.yaml 수정
spec:
  ports:
  - port: 80
    targetPort: 80  # ✅ 80으로 수정!
    nodePort: 30080
```

그리고 다시 적용했다.

```
kubectl apply -f broken-frontend-service.yaml

service/frontend-service configured
```

이제 테스트를 해봐야 하는데, 로컬에서 NodePort로 직접 접근이 안 되는 상황이었다 (kind 클러스터 특성). 그래서 port-forward를 사용했다.

```
kubectl port-forward -n day1-challenge svc/frontend-service 8080:80
```

다른 터미널에서 접근 테스트:

```
curl localhost:8080

<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
...
```

**성공!** HTML이 정상적으로 나온다! ✅

## 🎓 배운 점

### 1. Endpoints가 가장 중요한 단서

Service 문제를 진단할 때 가장 먼저 확인해야 할 것은 Endpoints다.

```
kubectl get endpoints <service-name>
```

- `<none>`: selector가 틀렸다. Pod을 못 찾고 있음
- `IP:포트`: Pod은 찾았는데 접근 안 되면 → **포트 문제 가능성 90%**

이번 케이스에서 Endpoints에 `10.244.0.70:80`이 보였는데, 처음엔 "IP가 있으니까 정상이겠지" 하고 넘어갔다. 근데 Service의 targetPort(8080)와 Endpoints의 포트(80)를 비교했어야 했다.

### 2. 진단은 단계별로

Pod가 안 뜨는 문제와 Service 접근 문제는 진단 순서가 다르다.

**Pod이 안 뜰 때:**
1. `kubectl get pods` → STATUS 확인 (ImagePullBackOff 등)
2. `kubectl describe pod` → Events 확인
3. 원인별 해결

**Service 접근이 안 될 때 (Pod은 Running):**
1. `kubectl get endpoints` → Service-Pod 연결 확인
2. Pod 직접 접근 테스트 (`kubectl exec ... curl localhost:포트`)
3. 포트 비교 (targetPort vs containerPort)
4. `kubectl describe` (필요시)

이번 경험으로 Service 문제는 Endpoints를 먼저 보는 게 핵심이라는 걸 배웠다.

### 3. kind 클러스터 특성

로컬 환경에서 kind를 사용하고 있었는데, kind는 NodePort를 바로 접근할 수 없다.

```
# 일반 클러스터 (k3s, EKS 등)
curl <node-ip>:30080  # ✅ 작동

# kind 클러스터
curl localhost:30080  # ❌ Connection refused
```

이유는 kind의 노드들이 Docker 컨테이너로 돌아가기 때문에, 컨테이너 포트가 자동으로 호스트에 노출되지 않는다. 해결책은:

- **port-forward 사용** (가장 간단, 실무 90% 사용)
- **extraPortMappings 설정** (kind 클러스터 생성 시)

포트 문제를 해결한 후에도 접근이 안 돼서 한참 헤맸는데, 이건 kind의 특성이었다. kind를 사용할 때는 port-forward가 기본이라고 생각하면 된다.

## 🔧 실무 적용

### 빠른 진단 체크리스트

실무에서 Service 문제가 생겼을 때 사용할 수 있는 체크리스트를 정리했다.

```
1. Endpoints 확인 (5초)
   kubectl get endpoints <service-name>
   → <none>이면 selector 문제
   → IP:포트가 있으면 포트 비교

2. Pod 포트 확인 (5초)
   kubectl get pod <pod-name> -o jsonpath='{.spec.containers[0].ports[0].containerPort}'

3. 비교 분석
   Service targetPort vs Pod containerPort
   → 불일치하면 수정

4. Pod 직접 테스트 (검증용)
   kubectl exec <pod> -- curl localhost:<port>
   → 성공하면 Pod는 정상
```

대부분의 Service 문제는 1~3번만으로 30초 내에 원인을 파악할 수 있다.

### 실수 방지 팁

- Service YAML 작성 시 targetPort를 명시적으로 적기 (생략하면 port와 같은 값 사용)
- nginx는 기본 80번, custom app은 Dockerfile이나 코드에서 확인
- Endpoints의 포트 번호를 항상 체크

### 실무 명령어 빈도

Service 트러블슈팅에서 실제로 자주 쓰는 명령어:

| 명령어 | 사용 빈도 | 용도 |
|--------|---------|------|
| `kubectl get endpoints` | ⭐⭐⭐ 90% | Service-Pod 연결 확인 |
| `kubectl exec ... curl` | ⭐⭐ 60% | Pod 직접 테스트 |
| `kubectl port-forward` | ⭐⭐⭐ 85% | 로컬 접근 (개발 시) |
| `kubectl describe` | ⭐⭐ 40% | 상세 정보 (애매할 때) |

`kubectl describe`를 먼저 하는 것보다 `kubectl get endpoints`가 훨씬 빠르고 정확하다.


## 🎯 면접 예상 질문

**Q**: "Service로 Pod 접근이 안 될 때 어떻게 진단하나요?"

**A**: "먼저 `kubectl get endpoints`로 Service가 Pod을 찾았는지 확인합니다. Endpoints가 없으면 selector 문제고, IP는 있는데 접근이 안 되면 포트 미스매치를 의심합니다. Service의 targetPort와 Pod의 containerPort를 비교해서 불일치하는 경우가 많습니다. 최근에 targetPort가 8080인데 nginx Pod은 80 포트를 쓰는 케이스를 15분 만에 해결한 경험이 있습니다."

**Q**: "Endpoints는 있는데 왜 접근이 안 될 수 있나요?"

**A**: "Endpoints에 Pod IP가 등록되어 있어도 포트 번호가 틀리면 연결이 안 됩니다. Service의 targetPort가 8080으로 설정되어 있는데 Pod은 80번 포트로 듣고 있으면, Service는 존재하지 않는 8080 포트로 트래픽을 보내게 되어 연결 실패합니다. 또 다른 경우로는 Network Policy나 방화벽 설정 문제도 있을 수 있습니다."

**Q**: "describe 명령어는 언제 사용하나요?"

**A**: "describe는 정보량이 많아서 원인이 명확하지 않을 때 사용합니다. Service 문제는 보통 endpoints만 봐도 원인을 알 수 있어서, describe는 네트워크 정책이나 복잡한 설정을 확인할 때 씁니다. Pod 문제는 describe의 Events 섹션이 중요해서 자주 사용하지만, Service 문제는 endpoints가 더 직관적입니다."

## 🔗 시리즈 연결

- 다음 글: "kind 클러스터 5가지 함정과 해결법"
- 관련 글: "K8s Networking 기초: Service, Endpoints, DNS"

## 📝 정리

Service 트러블슈팅의 핵심:
1. **Endpoints가 90%를 알려준다**
2. **진단 순서**: endpoints → 포트 비교 → 직접 테스트
3. **describe는 최후 수단**
4. **로컬 개발은 port-forward가 기본**

Pod는 Running인데 접근이 안 되면, 당황하지 말고 Endpoints부터 확인하자. 대부분 포트 문제다.
