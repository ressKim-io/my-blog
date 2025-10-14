---
layout: post
title: "K8s Service가 안 될 때 확인해야되는 것은"
date: 2025-10-14 20:00:00 +0900
categories: [Kubernetes, Troubleshooting]
tags: [kubernetes, service, endpoints, troubleshooting, devops]
description: "Service 접근 실패 시 describe 대신 endpoints를 먼저 확인해야 하는 이유"
---

## 🔥 상황

Kubernetes 학습 챌린지 중 일부러 깨뜨린 `broken-frontend-service.yaml` 파일을 진단하는 과제를 받았습니다. Pod는 정상적으로 Running 상태인데, NodePort로 접근하면 연결이 되지 않는 상황이었습니다.

```yaml
# broken-frontend-service.yaml (일부)
apiVersion: v1
kind: Service
metadata:
  name: frontend-service
spec:
  type: NodePort
  ports:
  - port: 80
    targetPort: 8080  # 🤔 이게 문제?
    nodePort: 30080
  selector:
    app: frontend
```

## 💥 증상

```bash
# Pod는 정상
$ kubectl get pods -l app=frontend
NAME                        READY   STATUS    RESTARTS   AGE
frontend-7d4b9c8f6d-abc12   1/1     Running   0          2m
frontend-7d4b9c8f6d-def34   1/1     Running   0          2m

# Service도 생성됨
$ kubectl get svc frontend-service
NAME               TYPE       CLUSTER-IP      EXTERNAL-IP   PORT(S)        AGE
frontend-service   NodePort   10.43.123.45    <none>        80:30080/TCP   2m

# 하지만 접근 실패
$ curl localhost:30080
curl: (7) Failed to connect to localhost port 30080: Connection refused
```

## 🔍 첫 번째 시도 (학습 자료대로)

챌린지 가이드에서 제시한 진단 순서를 따라 진행했습니다.

```bash
# 1. Pod 상태 확인
kubectl get pods -l app=frontend

# 2. Service 상태 확인  
kubectl get svc frontend-service

# 3. Service 상세 정보 확인
kubectl describe svc frontend-service

# 4. Pod 포트 확인
kubectl describe pod <frontend-pod-name>
```

### 문제점

`kubectl describe` 명령어는 정보량이 너무 많아서 뭘 봐야될지 확인하기 쉽진 않았습니다.

```bash
$ kubectl describe svc frontend-service
Name:                     frontend-service
Namespace:                day1-challenge
Labels:                   <none>
Annotations:              <none>
Selector:                 app=frontend
Type:                     NodePort
IP Family Policy:         SingleStack
IP Families:              IPv4
IP:                       10.43.123.45
IPs:                      10.43.123.45
Port:                     <unset>  80/TCP
TargetPort:               8080/TCP
NodePort:                 <unset>  30080/TCP
Endpoints:                10.42.0.5:8080,10.42.0.6:8080
Session Affinity:         None
External Traffic Policy:  Cluster
Events:                   <none>

# 😵 Endpoints에 IP는 있는데, 뭐가 문제지?
# Pod describe도 확인...
```

정보는 많지만 **어디가 문제인지 바로 파악하기 어려웠습니다**.

## 💡 실무 방식 적용

실무에서는 Service 문제 진단 시 **Endpoints를 가장 먼저 확인**한다는 것을 알게 되었습니다.

```bash
# ⭐ 핵심: Endpoints 확인
$ kubectl get endpoints frontend-service
NAME               ENDPOINTS
frontend-service   10.42.0.5:8080,10.42.0.6:8080

# Pod의 실제 포트 확인
$ kubectl get pod -l app=frontend -o jsonpath='{.items[0].spec.containers[0].ports[0].containerPort}'
80

# 비교
# Service targetPort: 8080 ❌
# Pod containerPort:  80    ✅
# → 포트 미스매치!
```

### 원인 파악

- **Service**는 트래픽을 **8080 포트**로 전달하려고 시도
- **nginx Pod**는 **80 포트**에서 대기 중
- 결과: 연결 실패

## ✅ 해결

`targetPort`를 Pod의 실제 포트인 80으로 수정했습니다.

```yaml
# 수정 전
spec:
  ports:
  - port: 80
    targetPort: 8080  # ❌

# 수정 후
spec:
  ports:
  - port: 80
    targetPort: 80    # ✅
```

```bash
# 적용
$ kubectl apply -f fixed-frontend-service.yaml
service/frontend-service configured

# 확인
$ kubectl get endpoints frontend-service
NAME               ENDPOINTS
frontend-service   10.42.0.5:80,10.42.0.6:80

# 테스트
$ curl localhost:30080
<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
...
```

접근 성공했습니다.

## 📊 실무 진단 순서 정리

### ❌ 학습용 순서 (비효율적)
```bash
1. kubectl get pods
2. kubectl get svc
3. kubectl describe svc  # 정보 과다
4. kubectl describe pod  # 시간 소요
```

### ✅ 실무 순서 (효율적)
```bash
# 1단계: 전체 상태 확인 (10초)
kubectl get all -l app=frontend

# 2단계: Endpoints 확인 (핵심!)
kubectl get endpoints <service-name>

# Endpoints가 비어있으면:
#   → selector와 Pod label 불일치
# Endpoints는 있는데 접근 안 되면:
#   → targetPort와 containerPort 불일치

# 3단계: 포트 비교
kubectl get pod <pod-name> -o jsonpath='{.spec.containers[0].ports[0].containerPort}'
kubectl get svc <service-name> -o jsonpath='{.spec.ports[0].targetPort}'

# 4단계: 필요시에만 describe 사용
kubectl describe svc <service-name>
```

## 📚 배운 점

### Endpoints가 90%를 알려줍니다

Service 트러블슈팅의 핵심은 **Endpoints 상태 확인**입니다.

```bash
# Endpoints가 비어있는 경우
$ kubectl get endpoints my-service
NAME         ENDPOINTS
my-service   <none>

# → selector 문제: Service의 selector가 Pod label과 맞지 않음

# Endpoints에 IP는 있지만 포트가 이상한 경우  
$ kubectl get endpoints my-service
NAME         ENDPOINTS
my-service   10.42.0.5:8080  # Pod는 80 포트인데?

# → targetPort 문제: Service의 targetPort 설정 오류
```

### describe는 상세 조사용으로 보는게 좋다.

- **Endpoints**: 문제 유무를 빠르게 파악
- **describe**: 원인을 상세히 분석

대부분의 Service 문제는 Endpoints만 확인해도 원인을 알 수 있습니다.

### 포트 미스매치가 가장 흔하다고 하니 확인을 먼저하는게 좋은거 같습니다.

초보자가 자주 하는 실수:
- nginx 이미지는 기본 80 포트
- 하지만 Service에 targetPort: 8080 설정
- Pod가 8080에서 듣고 있을 거라고 착각

**항상 Pod의 실제 containerPort를 먼저 확인**해야 합니다.

## 🎯 면접 대비 질문

**Q1: Kubernetes Service가 접근되지 않을 때 어떻게 디버깅하나요?**

```
A: 먼저 kubectl get endpoints로 Service의 Endpoints를 확인합니다.
   
   Endpoints가 비어있으면 selector와 Pod label 불일치,
   Endpoints에 IP는 있는데 접근이 안 되면 
   targetPort와 containerPort 불일치를 의심합니다.
   
   실무에서는 describe보다 endpoints 확인이 더 빠르고 정확합니다.
```

**Q2: Service의 targetPort와 containerPort의 차이는?**

```
A: containerPort는 Pod 내 컨테이너가 실제로 리스닝하는 포트이고,
   targetPort는 Service가 트래픽을 전달할 목적지 포트입니다.
   
   두 값이 일치해야 정상적으로 트래픽이 전달됩니다.
   예를 들어 nginx는 80 포트를 사용하므로,
   Service의 targetPort도 80으로 설정해야 합니다.
```

**Q3: Endpoints가 비어있는 경우 어떻게 해결하나요?**

```
A: Service의 selector와 Pod의 label이 정확히 일치하는지 확인합니다.

   kubectl get svc <service-name> -o yaml | grep -A 5 selector
   kubectl get pods --show-labels
   
   두 값이 다르면 Service spec을 수정하거나 
   Pod의 label을 추가해야 합니다.
```

---

**핵심 요약**: Service 문제는 describe 대신 **endpoints 먼저 확인**하면 대부분 해결됩니다.
