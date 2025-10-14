---
layout: post
title: "WSL2에서 k3s가 계속 재시작? WSL2에서는 k3d 를 사용하자"
date: 2025-10-14 21:00:00 +0900
categories: [Kubernetes, Troubleshooting]
tags: [kubernetes, k3s, wsl2, troubleshooting, installation]
description: "k3s 서비스 auto-restart 반복 문제를 완전 초기화로 해결한 과정"
---

## 🔥 상황

WSL2 Ubuntu 환경에서 k3s를 설치했지만, 서비스가 정상적으로 시작되지 않았습니다. `kubectl` 명령어를 실행하면 계속 "connection refused" 에러만 발생했습니다.

```bash
$ kubectl get nodes
The connection to the server 127.0.0.1:6443 was refused - did you specify the right host or port?
```

## 💥 증상

### k3s 서비스 상태 확인

```bash
$ sudo systemctl status k3s
● k3s.service - Lightweight Kubernetes
     Loaded: loaded (/etc/systemd/system/k3s.service; enabled; preset: enabled)
     Active: activating (auto-restart) (Result: exit-code) since Tue 2025-10-14 17:07:44 KST; 2s ago
       Docs: https://k3s.io
    Process: 1474482 ExecStartPre=/sbin/modprobe br_netfilter (code=exited, status=0/SUCCESS)
    Process: 1474483 ExecStart=/usr/local/bin/k3s server (code=exited, status=1/FAILURE)
```

**문제점**:
- `activating (auto-restart)` 상태 반복
- `exit-code` 결과로 실패
- 몇 초마다 재시작 시도 → 실패 → 재시작...

### kubectl 명령 실패

```bash
$ kubectl get pods -A
The connection to the server 127.0.0.1:6443 was refused

$ kubectl version
Client Version: v1.30.0
Kustomize Version: v5.0.4-0.20230601165947-6ce0bf390ce3
The connection to the server 127.0.0.1:6443 was refused
```

API 서버에 연결할 수 없는 상태였습니다.

## 🔍 첫 번째 시도: 서비스 재시작

가장 먼저 서비스 재시작을 시도했습니다.

```bash
$ sudo systemctl restart k3s
$ sudo systemctl status k3s
# 여전히 activating (auto-restart) 반복...
```

**결과**: 실패. 동일한 증상 반복.

## 🔍 두 번째 시도: k3s 언인스톨

공식 언인스톨 스크립트를 실행했습니다.

```bash
$ sudo /usr/local/bin/k3s-uninstall.sh
# 언인스톨 완료 메시지

$ which k3s
# 출력 없음 (제거된 것처럼 보임)
```

### k3s 재설치

```bash
$ curl -sfL https://get.k3s.io | sh -
# 설치 완료

$ sudo systemctl status k3s
# 여전히 activating (auto-restart)...
```

**결과**: 실패. 언인스톨 후에도 동일한 문제 발생.

## 💡 원인 분석

언인스톨 스크립트가 일부 파일을 남겨두고 있었습니다.

```bash
# 잔여 파일 확인
$ ls /etc/rancher/k3s/
k3s.yaml  k3s.yaml.lock

$ ls /var/lib/rancher/k3s/
agent  data  server
```

**문제점**:
- 기존 설정 파일이 남아있음
- kubeconfig 충돌 가능성
- 완전히 깨끗한 상태가 아님

## ✅ 최종 해결: 완전 초기화

### 1. 완전 초기화 스크립트 작성

모든 k3s 관련 파일을 완전히 제거하는 스크립트를 작성했습니다.

```bash
#!/bin/bash
# k3s-complete-reset.sh

echo "🗑️ k3s 완전 초기화 시작..."
echo ""

# 1. k3s 서비스 중지 및 제거
echo "📦 k3s 서비스 제거 중..."
if [ -f /usr/local/bin/k3s-uninstall.sh ]; then
    sudo /usr/local/bin/k3s-uninstall.sh
    echo "  ✅ k3s 언인스톨 완료"
else
    echo "  ℹ️  k3s가 설치되어 있지 않음"
fi

# 2. 잔여 파일 완전 삭제
echo ""
echo "🧹 잔여 파일 정리 중..."
sudo rm -rf /etc/rancher/k3s 2>/dev/null
sudo rm -rf /var/lib/rancher/k3s 2>/dev/null
sudo rm -rf /var/lib/rancher 2>/dev/null
echo "  ✅ 잔여 파일 삭제 완료"

# 3. kubeconfig 백업 및 정리
echo ""
echo "📝 kubeconfig 정리 중..."
if [ -f ~/.kube/config ]; then
    cp ~/.kube/config ~/.kube/config.backup.$(date +%Y%m%d_%H%M%S)
    echo "  ✅ 기존 config 백업 완료"
fi
rm -f ~/.kube/config
rm -f ~/.kube/k3s-config
echo "  ✅ kubeconfig 삭제 완료"

# 4. 네트워크 설정 초기화
echo ""
echo "🌐 네트워크 정리 중..."
sudo iptables -F
sudo iptables -X
echo "  ✅ iptables 규칙 초기화 완료"

echo ""
echo "✅ 완전 초기화 완료!"
echo ""
echo "📊 현재 상태:"
echo "  - k3s: 제거됨"
echo "  - 잔여 파일: 없음"
echo "  - kubeconfig: 초기화됨"
```

### 2. 스크립트 실행

```bash
$ chmod +x k3s-complete-reset.sh
$ ./k3s-complete-reset.sh

🗑️ k3s 완전 초기화 시작...

📦 k3s 서비스 제거 중...
  ✅ k3s 언인스톨 완료

🧹 잔여 파일 정리 중...
  ✅ 잔여 파일 삭제 완료

📝 kubeconfig 정리 중...
  ✅ 기존 config 백업 완료
  ✅ kubeconfig 삭제 완료

🌐 네트워크 정리 중...
  ✅ iptables 규칙 초기화 완료

✅ 완전 초기화 완료!
```

### 3. k3s 재설치

완전히 깨끗한 상태에서 재설치를 진행했습니다.

```bash
$ curl -sfL https://get.k3s.io | sh -
[INFO]  Finding release for channel stable
[INFO]  Using v1.28.3+k3s1 as release
[INFO]  Downloading...
[INFO]  Installing k3s to /usr/local/bin/k3s
[INFO]  systemd: Starting k3s

# 30초 대기 (중요!)
$ sleep 30

# 서비스 상태 확인
$ sudo systemctl status k3s
● k3s.service - Lightweight Kubernetes
     Loaded: loaded (/etc/systemd/system/k3s.service; enabled)
     Active: active (running) since Tue 2025-10-14 17:15:32 KST; 32s ago
       Docs: https://k3s.io
    Process: 1480123 ExecStartPre=/bin/sh -xc ! /usr/bin/systemctl is-enabled --quiet nm-cloud-setup.service (code=exited, status=0/SUCCESS)
   Main PID: 1480125 (k3s-server)
      Tasks: 142
     Memory: 1.2G
        CPU: 45.234s
```

**성공!** `active (running)` 상태입니다.

### 4. kubectl 동작 확인

```bash
# kubeconfig 설정
$ mkdir -p ~/.kube
$ sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
$ sudo chown $USER:$USER ~/.kube/config

# 노드 확인
$ kubectl get nodes
NAME        STATUS   ROLES                  AGE   VERSION
localhost   Ready    control-plane,master   1m    v1.28.3+k3s1

# 시스템 Pod 확인
$ kubectl get pods -A
NAMESPACE     NAME                                     READY   STATUS    RESTARTS   AGE
kube-system   coredns-5d78c9869d-abcde                 1/1     Running   0          2m
kube-system   local-path-provisioner-6c86858495-fghij  1/1     Running   0          2m
kube-system   metrics-server-54fd9b65b-klmno           1/1     Running   0          2m
```

모든 시스템 Pod가 정상적으로 실행 중입니다.

## 🔄 대안: k3d 사용하기

k3s가 계속 문제를 일으킨다면 **k3d**(Docker 기반 k3s)를 사용하는 것도 좋은 대안입니다.

### k3d 설치 및 클러스터 생성

```bash
# k3d 설치
$ curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash

# 클러스터 생성
$ k3d cluster create k3s-local \
  --agents 1 \
  --port "30080:80@loadbalancer" \
  --port "6443:6443@loadbalancer"

INFO[0000] Created network 'k3d-k3s-local'
INFO[0001] Created image volume k3d-k3s-local-images
INFO[0002] Starting new tools node...
INFO[0003] Creating node 'k3d-k3s-local-server-0'
INFO[0005] Creating node 'k3d-k3s-local-agent-0'
INFO[0006] Creating LoadBalancer 'k3d-k3s-local-serverlb'
INFO[0008] Cluster 'k3s-local' created successfully!

# 확인
$ kubectl get nodes
NAME                      STATUS   ROLES                  AGE   VERSION
k3d-k3s-local-agent-0     Ready    <none>                 30s   v1.28.3+k3s1
k3d-k3s-local-server-0    Ready    control-plane,master   32s   v1.28.3+k3s1
```

### k3d 장점

- ✅ **안정성**: Docker 컨테이너로 실행되어 격리됨
- ✅ **속도**: 클러스터 생성/삭제가 빠름 (30초)
- ✅ **멀티 클러스터**: 여러 클러스터 동시 운영 가능
- ✅ **WSL2 호환성**: WSL2에서도 안정적

### k3d 명령어

```bash
# 클러스터 목록
$ k3d cluster list

# 클러스터 시작/중지
$ k3d cluster start k3s-local
$ k3d cluster stop k3s-local

# 클러스터 삭제
$ k3d cluster delete k3s-local
```

## 📚 배운 점

### 1. "언인스톨"이 완전 삭제는 아닙니다

`k3s-uninstall.sh`는 서비스와 바이너리만 제거합니다.

```bash
# 남아있는 것들
/etc/rancher/k3s/          # 설정 파일
/var/lib/rancher/k3s/      # 데이터 디렉토리
~/.kube/config             # kubeconfig
iptables 규칙              # 네트워크 설정
```

**교훈**: 재설치 전에는 **완전 초기화**가 필수입니다.

### 2. 1초만에 안켜질수도 있으니 30초 가량 대기도 중요

k3s 설치 직후 바로 `kubectl` 명령을 실행하면 실패할 수 있습니다.

```bash
# ❌ 바로 실행
$ curl -sfL https://get.k3s.io | sh -
$ kubectl get nodes
The connection to the server 127.0.0.1:6443 was refused

# ✅ 30초 대기 후 실행
$ curl -sfL https://get.k3s.io | sh -
$ sleep 30
$ kubectl get nodes
NAME        STATUS   ROLES   AGE   VERSION
localhost   Ready    ...     30s   v1.28.3+k3s1
```

**교훈**: 서비스가 완전히 시작될 때까지 기다려야 합니다.

### 3. kubeconfig 백업을 습관화합니다

초기화 전에 항상 백업을 생성했습니다.

```bash
# 백업 생성
$ cp ~/.kube/config ~/.kube/config.backup.$(date +%Y%m%d_%H%M%S)

# 백업 파일들
$ ls ~/.kube/
config
config.backup.20251014_170530
config.backup.20251014_171245
```

**교훈**: 다른 클러스터 설정이 있을 수 있으므로 백업은 필수입니다.

### 4. 로컬 환경은 k3d가 더 안정적입니다

WSL2 환경에서는 k3s보다 k3d가 더 안정적이었습니다.

| 비교 항목 | k3s | k3d |
|----------|-----|-----|
| 설치 | systemd 의존 | Docker 컨테이너 |
| WSL2 호환성 | 가끔 문제 | 안정적 |
| 초기화 | 수동 삭제 필요 | `k3d cluster delete` |
| 멀티 클러스터 | 복잡 | 간단 |
| 실무 유사도 | 높음 | 중간 |

**교훈**: 로컬 개발 환경에서는 k3d를 추천합니다.

## 🎯 면접 대비 질문

**Q1: k3s 설치 후 서비스가 계속 재시작될 때 어떻게 해결하나요?**

```
A: 먼저 systemctl status k3s로 에러 로그를 확인하고,
   k3s-uninstall.sh로 제거한 후 
   /etc/rancher와 /var/lib/rancher 디렉토리를 수동으로 삭제합니다.
   
   kubeconfig도 백업 후 삭제하고,
   iptables 규칙도 초기화한 다음
   완전히 깨끗한 상태에서 재설치합니다.
   
   설치 후에는 30초 정도 대기해야 
   API 서버가 완전히 시작됩니다.
```

**Q2: k3s와 k3d의 차이는 무엇인가요?**

```
A: k3s는 systemd 서비스로 실행되는 경량 Kubernetes이고,
   k3d는 Docker 컨테이너로 k3s를 실행하는 도구입니다.
   
   k3s는 실무 환경에 가깝지만 WSL2에서 가끔 문제가 발생하고,
   k3d는 로컬 개발에 더 안정적이며 
   멀티 클러스터 관리가 편리합니다.
   
   실무 경험을 위해서는 k3s,
   로컬 개발 환경에서는 k3d를 추천합니다.
```

**Q3: 언인스톨 스크립트로 제거했는데 왜 문제가 남나요?**

```
A: k3s-uninstall.sh는 서비스와 바이너리만 제거하고,
   설정 파일(/etc/rancher/k3s)과 
   데이터 디렉토리(/var/lib/rancher/k3s)는 남겨둡니다.
   
   이전 설정이 남아있으면 재설치 시 충돌이 발생할 수 있어서,
   재설치 전에는 이런 디렉토리들을 
   수동으로 삭제하는 것이 좋습니다.
```

## 📝 완전 초기화 체크리스트

```bash
# 1. 서비스 제거
sudo /usr/local/bin/k3s-uninstall.sh

# 2. 디렉토리 삭제
sudo rm -rf /etc/rancher/k3s
sudo rm -rf /var/lib/rancher/k3s
sudo rm -rf /var/lib/rancher

# 3. kubeconfig 백업 및 삭제
cp ~/.kube/config ~/.kube/config.backup.$(date +%Y%m%d_%H%M%S)
rm -f ~/.kube/config

# 4. 네트워크 초기화
sudo iptables -F
sudo iptables -X

# 5. 재설치
curl -sfL https://get.k3s.io | sh -

# 6. 30초 대기
sleep 30

# 7. 확인
kubectl get nodes
```

---

**핵심 요약**: k3s 재설치 시에는 **완전 초기화**가 필수입니다. WSL2 환경에서는 k3d가 더 안정적인 대안인거 같습니다.
