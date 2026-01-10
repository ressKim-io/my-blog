---
title: Pod 생성 플로우 완벽 가이드 Part 1 - kubectl부터 Running까지
excerpt: ''
category: Kubernetes
tags:
  - kubernetes
  - k8s
  - pod
  - kubectl
  - troubleshooting
  - scheduler
  - etcd
  - 실무
date: '2025-10-13'
---

## 🎯 TL;DR

**Pod 생성 플로우 요약 (정상 케이스)**

```
kubectl apply → API Server → ETCD → Scheduler → Kubelet → Running
  0.1초        0.1초       0.5초     0.1초      5-30초

가장 오래 걸리는 단계: 이미지 다운로드 (5-30초)
전체 소요 시간: 7-35초 (이미지 크기에 따라)
```

**이 글에서 배우는 것:**
- K8s 컴포넌트 간 실제 통신 과정
- 각 단계별 소요 시간 (실측 데이터)
- 실시간으로 Pod 생성 과정 관찰하는 방법
- 배포 속도를 3배 빠르게 만든 최적화 팁

---

## 💡 왜 이 글을 쓰게 되었나?

k3s로 개인 프로젝트를 운영하면서 생성이 개인프로젝트이고 소규모인데 속도가 생각보다 많이 걸렸는데 이 이유를 찾고,
k8s 환경에서 각 순서에서 얼마정도가 걸릴까 확인을 하려고 했습니다.

```
kubectl get pods --watch
NAME    READY   STATUS              AGE
nginx   0/1     ContainerCreating   30s  # ← 왜 이렇게 오래 걸려?
```

간단 결론 >> 이미지 다운로드의 시간이 대부분이다. (이미지를 최적화하자.) 

이 글에서는:
- kubectl 입력부터 Pod Running까지의 **전체 흐름**
- 각 단계별 **실제 측정 시간** (k3s 환경)
- 배포 속도를 **8초 → 2초**로 개선

---

## 📊 전체 흐름도

![Pod Creation Flow](/images/diagrams/k8s-pod-creation-flow.drawio.svg)

---

## 🔍 단계별 상세 분석

### [단계 1] kubectl → API Server (0.1초)

kubectl 명령 >> API Server로 HTTPS 요청

```
# ~/.kube/config 파일에서 클러스터 정보 읽기
cat ~/.kube/config
```

출력:
```
clusters:
- cluster:
    server: https://192.168.1.100:6443  # ← API Server 주소
```

**API Server가 하는 일:**

**1. 인증 (Authentication)**
- "이 토큰 유효해?"
- Bearer Token 또는 Certificate 확인

**2. 인가 (Authorization - RBAC)**
- "Pod 만들 권한 있어?"
- Role/RoleBinding 확인

**3. 검증 (Validation)**
- "YAML 문법 맞아?"
- 필수 필드 있나?
- 리소스 타입 맞나?

**실제 측정:**
```
# time 명령으로 측정
time kubectl apply -f simple-pod.yaml

# 출력:
real    0m0.152s  # ← API Server 응답 시간
```
---

### [단계 2] API Server → ETCD (0.05초)

API Server는 검증이 끝나면 ETCD에 저장한다.

**ETCD에 저장되는 내용 (단순화):**
```
Key: /registry/pods/default/nginx
Value: {
  "metadata": {
    "name": "nginx",
    "namespace": "default"
  },
  "spec": {
    "containers": [...]
  },
  "status": {
    "phase": "Pending"  # ← 초기 상태
  }
}
```

**실무 포인트:**
- ETCD는 K8s의 **유일한 데이터베이스**
- 여기 저장 안 되면 아무것도 안 됨
- HA 구성 시 Raft 합의 프로토콜로 **3대 중 2대 이상 승인** 필요

**직접 ETCD 확인하기 **
```
ETCDCTL_API=3 etcdctl get /registry/pods/default/nginx \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
```

→ 실제 저장된 데이터를 볼 수 있음 (디버깅 시 유용)

---

### [단계 3] Scheduler 작동 (0.5-2초) ⭐⭐⭐

이 단계가 K8s의 핵심이다. Scheduler가 **어느 노드에 Pod를 배치할지** 결정한다.

**Scheduler의 2단계 알고리즘:**

![Scheduler Filtering Algorithm](/images/diagrams/k8s-scheduler-filtering.drawio.svg)

**실제 예시:**
```
초기 상태:
- node1: CPU 90%, Memory 80%
- node2: CPU 50%, Memory 60%  ← 점수 높음!
- node3: CPU 70%, Memory 85%

Scheduler 결정: node2 선택 ✅
```

**실제 측정:**
```
# Scheduler 결정 시간 확인
kubectl get events --sort-by='.lastTimestamp' | grep Scheduled

# 출력:
0s   Normal  Scheduled  pod/nginx  Successfully assigned default/nginx to node2
```

**디버깅 팁:**
```
# 왜 이 노드에 배정됐는지 확인
kubectl describe pod nginx

# Events 섹션:
Events:
  Type    Reason     Message
  ----    ------     -------
  Normal  Scheduled  Successfully assigned to node2
```

---

### [단계 4] Kubelet 감지 + 이미지 다운로드 (5-30초) ⭐⭐⭐

**가장 오래 걸리는 단계!**

#### 4-1. Kubelet이 감지 (0.1초)

Scheduler가 nodeName을 node2로 설정하면, node2의 Kubelet이 Watch로 감지한다.

```
Kubelet (node2):
"어? ETCD에 내 노드 이름이 추가됐네!"
"이 Pod를 실행해야겠다!"
```

#### 4-2. 이미지 다운로드 (5-30초) ⭐⭐⭐

**시간이 오래 걸리는 작업이였다.**

**nginx 이미지 예시:**
```
docker images nginx
REPOSITORY   TAG      SIZE
nginx        latest   187MB  # ← 약 6초 소요 (내 환경)
```

**이미지 Pull 과정:**

![Image Pull Process](/images/diagrams/k8s-image-pull-process.drawio.svg)

**실제 측정:**
```
# 로컬에 이미지 없는 상태로 테스트
docker rmi nginx:latest

# Pod 생성 시간 측정
kubectl delete pod nginx
time kubectl apply -f nginx-pod.yaml && \
  kubectl wait --for=condition=ready pod/nginx --timeout=60s

# 출력:
real    0m8.234s  # ← 8초 소요 (이미지 다운 포함)
```

```
# 이미지 있는 상태로 재시도
kubectl delete pod nginx
time kubectl apply -f nginx-pod.yaml && \
  kubectl wait --for=condition=ready pod/nginx --timeout=60s

# 출력:
real    0m2.145s  # ← 2초! (이미지 캐시 사용)
```

→ **용량 차이도 많이 나고, 속도도 차이가 많이 난다.**

---

### [단계 5] 컨테이너 실행 (1초)

```
Container Runtime (containerd):
1. 컨테이너 생성 (0.5초)
   └─ 네임스페이스, Cgroup 설정
   
2. 네트워크 설정 (0.3초)
   └─ CNI 플러그인 호출
   └─ IP 할당 (예: 10.244.1.5)
   
3. 볼륨 마운트 (0.2초)
   └─ ConfigMap, Secret 등
   
4. ENTRYPOINT 실행 (0.1초)
   └─ nginx 프로세스 시작
```

**Kubelet이 API Server에 상태 보고:**
```
ETCD 업데이트:
{
  "status": {
    "phase": "Running",  # ← Pending에서 변경!
    "containerStatuses": [{
      "ready": true,
      "restartCount": 0,
      "state": {
        "running": {
          "startedAt": "2025-10-13T10:05:30Z"
        }
      }
    }]
  }
}
```

---

## ⏱️ 단계별 소요 시간 정리

| 단계 | 컴포넌트 | 소요 시간 | 비고 |
|------|----------|-----------|------|
| 1 | API Server | 50-150ms | kubectl 응답 |
| 2 | ETCD | 10-50ms | 저장 |
| 3 | Scheduler | 100-500ms | 노드 선택 |
| 4-1 | Kubelet | 100ms | 감지 |
| 4-2 | Runtime | **5-8초** | 이미지 다운 ⭐ |
| 4-3 | Runtime | 1-2초 | 컨테이너 생성 |
| **합계** | | **7-12초** | 이미지 없을 때 |
| **합계** | | **2-3초** | 이미지 있을 때 ✅ |

**이미지 크기별 비교 (실측):**

| 이미지 | 크기 | 다운로드 시간 | 전체 시간 |
|--------|------|---------------|-----------|
| nginx:alpine | 42MB | 2초 | **4초** ⭐ |
| nginx:latest | 187MB | 6초 | 8초 |
| python:3.9 | 915MB | 30초 | 32초 |

---

## 🎬 실시간 관찰하기 ⭐⭐⭐

**3개 터미널로 전 과정 관찰** (실무 필수 스킬!)

```
# 터미널 1: Pod 상태 실시간 보기
kubectl get pods --watch

# 터미널 2: 이벤트 실시간 보기 (가장 중요!)
kubectl get events --watch

# 터미널 3: Pod 생성
kubectl apply -f nginx-pod.yaml
```

**실제 출력:**

**터미널 1 (Pod 상태):**
```
NAME    READY   STATUS    AGE
nginx   0/1     Pending   0s
nginx   0/1     Pending   0s      # ← Scheduler 작동 전
nginx   0/1     ContainerCreating  2s  # ← 노드 배정됨
nginx   1/1     Running   8s      # ← 완료!
```

**터미널 2 (이벤트):**
```
LAST SEEN   TYPE    REASON      MESSAGE
0s          Normal  Scheduled   Successfully assigned default/nginx to node1
2s          Normal  Pulling     Pulling image "nginx:latest"
7s          Normal  Pulled      Successfully pulled image
8s          Normal  Created     Created container nginx
8s          Normal  Started     Started container nginx
```

→ **이런식으로 어떤게 오래걸리는지 모니터링할 수 있다.**

**한 줄 명령으로 보기:**
```
kubectl get events --sort-by='.lastTimestamp' | tail -20
```

---

## 💡 이 과정에서 배운 점

### 1. imagePullPolicy 설정은 필수! ⭐⭐⭐

**Before (기본값):**
```
spec:
  containers:
  - name: nginx
    image: nginx:latest
    # imagePullPolicy 없음 → Always로 동작
```

→ 매번 이미지 확인, **약 8초 소요**

**After (최적화):**
```
spec:
  containers:
  - name: nginx
    image: nginx:latest
    imagePullPolicy: IfNotPresent  # 로컬 우선!
```

→ 로컬 이미지 사용, **약 2초 소요** ✅

**실무 적용:**
- 개발 환경: `IfNotPresent` (빠른 재배포)
- 프로덕션: `Always` (최신 이미지 보장)

---

### 2. alpine 이미지를 쓰자 ⭐⭐⭐

**Before:**
```
nginx:latest  # 187MB → 6초
```

**After:**
```
nginx:alpine  # 42MB → 2초  ⭐
```

**실제 비교:**
```
# nginx:latest 테스트
time kubectl apply -f nginx-pod.yaml && \
  kubectl wait --for=condition=ready pod/nginx --timeout=60s
# real    0m8.234s

# nginx:alpine 테스트
time kubectl apply -f nginx-alpine-pod.yaml && \
  kubectl wait --for=condition=ready pod/nginx-alpine --timeout=60s
# real    0m4.156s
```

→ **거의 절반!**

---

### 3. 이벤트는 디버깅의 보물창고 ⭐⭐⭐

```
# 뭔가 이상하면 무조건 이것부터!
kubectl get events --sort-by='.lastTimestamp'
```

**사례 예시 :**

Pod가 30초째 ContainerCreating인데 원인을 모를 때:

```
kubectl describe pod my-app

# Events:
Events:
  Type    Reason     Message
  Normal  Scheduled  Successfully assigned to node1
  Normal  Pulling    Pulling image...
  Warning Failed     Failed to pull image: timeout  # ← 원인!
```

→ 네트워크 타임아웃! Registry 주소 확인하니 오타였음

**디버깅 체크리스트:**
```
1. kubectl get pods  # 상태 확인
2. kubectl describe pod <name>  # Events 확인
3. kubectl logs <name>  # 앱 로그 확인
```

→ **이 순서로 90% 문제 해결 가능!**

---

## 🚀 배포 속도 최적화 요약

**내가 적용한 3가지:**

1. **alpine 이미지 사용**
   ```
   nginx:latest → nginx:alpine
   187MB → 42MB
   ```

2. **imagePullPolicy 설정**
   ```
   imagePullPolicy: IfNotPresent
   ```

3. **로컬 Registry 구성** (선택)
   ```
   Harbor 설치 → 내부망에서 3초 안에 다운
   ```

**결과:**
- Before: 평균 **35초**
- After: 평균 **8초**


---
## 관련 면접 예상 질문

**Q: "Pod 생성이 느린데 어디를 확인하시겠어요?"**

**A:** "먼저 `kubectl get events --watch`로 어느 단계에서 시간이 걸리는지 확인합니다. 대부분 이미지 다운로드가 원인이라 `imagePullPolicy`를 `IfNotPresent`로 바꾸거나 alpine 이미지를 사용합니다. 실제로 제 프로젝트에서 이 방법으로 배포 시간을 35초에서 8초로 줄였습니다."

**Q: "K8s에서 가장 중요한 컴포넌트는 뭔가요?"**

**A:** "ETCD입니다. 유일한 데이터베이스라서 ETCD 없이는 아무것도 작동하지 않습니다. 그래서 제 k3s 환경에서는 매일 자동으로 ETCD 백업을 S3에 저장하도록 설정했습니다."

---

## 📚 참고 자료

- [Kubernetes Official Docs: Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)
- 내 실험 환경: k3s v1.28, 로컬 3-node cluster
- 측정 도구: `time`, `kubectl get events --watch`

---

**작성일**: 2025-10-13  
**환경**: k3s v1.28, 로컬 3-node cluster  
