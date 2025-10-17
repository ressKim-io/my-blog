---
title: "WSL2에서 k3s가 계속 재시작? WSL2에서는 k3d를 사용하자"
excerpt: "WSL2 환경에서 k3s 설치 시 겪은 트러블슈팅과 완전 초기화 방법"
categories:
  - Kubernetes
tags:
  - k3s
  - k3d
  - WSL2
  - troubleshooting
toc: true
toc_sticky: true
---

## 🔥 상황

WSL2 Ubuntu 환경에서 k3s를 설치했지만, 서비스가 정상적으로 시작되지 않았습니다. `kubectl` 명령어를 실행하면 계속 "connection refused" 에러만 발생했습니다.
```bash
$ kubectl get nodes
The connection to the server 127.0.0.1:6443 was refused - did you specify the right host or port?
```

서비스 상태를 확인해보니:
```bash
$ sudo systemctl status k3s
● k3s.service - Lightweight Kubernetes
   Loaded: loaded (/etc/systemd/system/k3s.service; enabled; preset: enabled)
   Active: activating (auto-restart) (Result: exit-code)
```

**문제점:**
- `activating (auto-restart)` 상태 반복
- `exit-code` 결과로 실패
- API 서버에 연결할 수 없는 상태

## 🤔 시도한 방법들

### 1️⃣ 서비스 재시작 (실패)

가장 먼저 서비스 재시작을 시도했습니다.
```bash
$ sudo systemctl restart k3s
$ sudo systemctl status k3s
# 여전히 activating (auto-restart) 반복...
```

**결과:** 실패. 동일한 증상 반복.

### 2️⃣ 공식 언인스톨 후 재설치 (실패)

공식 언인스톨 스크립트를 실행했습니다.
```bash
$ sudo /usr/local/bin/k3s-uninstall.sh
# 언인스톨 완료

$ curl -sfL https://get.k3s.io | sh -
# 재설치

$ sudo systemctl status k3s
# 여전히 activating (auto-restart)...
```

**결과:** 실패. 언인스톨 후에도 동일한 문제 발생.

**원인 파악:**  
언인스톨 스크립트가 일부 파일을 남겨두고 있었습니다.
```bash
$ ls /etc/rancher/k3s/
k3s.yaml  k3s.yaml.lock

$ ls /var/lib/rancher/k3s/
agent  data  server
```

## ✅ 해결: 완전 초기화 스크립트

모든 k3s 관련 파일을 완전히 제거하는 스크립트를 작성했습니다.
```bash
#!/bin/bash
# k3s-complete-reset.sh

echo "🗑️ k3s 완전 초기화 시작..."

# 1. k3s 서비스 중지 및 제거
if [ -f /usr/local/bin/k3s-uninstall.sh ]; then
    sudo /usr/local/bin/k3s-uninstall.sh
    echo "✅ k3s 언인스톨 완료"
fi

# 2. 잔여 파일 완전 삭제
sudo rm -rf /etc/rancher/k3s
sudo rm -rf /var/lib/rancher/k3s
sudo rm -rf /var/lib/rancher
echo "✅ 잔여 파일 삭제 완료"

# 3. kubeconfig 백업 및 정리
if [ -f ~/.kube/config ]; then
    cp ~/.kube/config ~/.kube/config.backup.$(date +%Y%m%d_%H%M%S)
    echo "✅ 기존 config 백업 완료"
fi
rm -f ~/.kube/config
echo "✅ kubeconfig 삭제 완료"

# 4. 네트워크 설정 초기화
sudo iptables -F
sudo iptables -X
echo "✅ iptables 규칙 초기화 완료"

echo ""
echo "✅ 완전 초기화 완료!"
```

**실행 결과:**
```bash
$ chmod +x k3s-complete-reset.sh
$ ./k3s-complete-reset.sh

🗑️ k3s 완전 초기화 시작...
✅ k3s 언인스톨 완료
✅ 잔여 파일 삭제 완료
✅ kubeconfig 삭제 완료
✅ iptables 규칙 초기화 완료

✅ 완전 초기화 완료!
```

### 재설치 성공!

완전히 깨끗한 상태에서 재설치를 진행했습니다.
```bash
$ curl -sfL https://get.k3s.io | sh -
[INFO] Installing k3s to /usr/local/bin/k3s
[INFO] systemd: Starting k3s

# 30초 대기 (중요!)
$ sleep 30

# 서비스 상태 확인
$ sudo systemctl status k3s
● k3s.service - Lightweight Kubernetes
   Active: active (running) ✅

# 노드 확인
$ kubectl get nodes
NAME        STATUS   ROLES                  AGE   VERSION
localhost   Ready    control-plane,master   1m    v1.28.3+k3s1
```

**성공!** 🎉

## 💡 대안: k3d 사용

k3s가 계속 문제를 일으킨다면 **k3d**(Docker 기반 k3s)를 사용하는 것도 좋은 대안입니다.
```bash
# k3d 설치
$ curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash

# 클러스터 생성
$ k3d cluster create k3s-local --agents 1

# 확인
$ kubectl get nodes
NAME                    STATUS   ROLES                  AGE
k3d-k3s-local-agent-0   Ready    <none>                 30s
k3d-k3s-local-server-0  Ready    control-plane,master   32s
```

**k3d 장점:**
- WSL2에서 더 안정적
- 멀티 클러스터 관리 편리
- 완전 삭제/재생성이 간단
```bash
# 클러스터 삭제
$ k3d cluster delete k3s-local
```

## 📚 배운 점

### 1. 언인스톨 스크립트의 한계

`k3s-uninstall.sh`는 **서비스와 바이너리만 제거**합니다.

남아있는 것들:
- `/etc/rancher/k3s/` (설정 파일)
- `/var/lib/rancher/k3s/` (데이터 디렉토리)
- `~/.kube/config` (kubeconfig)
- iptables 규칙

**교훈:** 재설치 전에는 완전 초기화가 필수입니다.

### 2. 서비스 시작 대기 시간

k3s 설치 직후 바로 `kubectl` 명령을 실행하면 실패할 수 있습니다.
```bash
# ❌ 바로 실행
$ curl -sfL https://get.k3s.io | sh -
$ kubectl get nodes
The connection to the server was refused

# ✅ 30초 대기 후 실행
$ curl -sfL https://get.k3s.io | sh -
$ sleep 30
$ kubectl get nodes
```

**교훈:** 서비스가 완전히 시작될 때까지 기다려야 합니다.

### 3. WSL2에서는 k3d가 더 안정적

| 비교 항목 | k3s | k3d |
|----------|-----|-----|
| 설치 | systemd 의존 | Docker 컨테이너 |
| WSL2 호환성 | 가끔 문제 | 안정적 ✅ |
| 초기화 | 수동 삭제 필요 | `k3d cluster delete` |
| 멀티 클러스터 | 복잡 | 간단 ✅ |

**교훈:** 로컬 개발 환경에서는 k3d를 추천합니다.

## 💭 생각해볼 점

**Q:** k3s 재설치가 필요할 때 가장 먼저 해야 할 일은?

**힌트:** 언인스톨 스크립트만으로는 부족합니다. 설정 파일과 데이터 디렉토리도 함께 삭제해야 합니다.

## 🔗 참고

- [k3s 공식 문서](https://docs.k3s.io)
- [k3d 공식 문서](https://k3d.io)
