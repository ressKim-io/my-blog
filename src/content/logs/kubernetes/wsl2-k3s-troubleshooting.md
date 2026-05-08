---
title: WSL2에서 k3s가 계속 재시작? WSL2에서는 k3d를 사용하자
excerpt: WSL2 환경에서 k3s를 쓰다 겪은 auto-restart 무한 루프와 완전 초기화 과정, 그리고 왜 결국 k3d로 넘어가야 했는지를 정리합니다
category: kubernetes
tags:
  - k3s
  - k3d
  - WSL2
  - troubleshooting
date: '2025-12-24'
---

## 🔥 상황

### 왜 WSL2에서 k3s를 썼는가

로컬에서 쿠버네티스 실습 환경이 필요했습니다
회사/학교 노트북이 Windows였고, Docker Desktop 대신 WSL2 Ubuntu를 메인 개발 환경으로 쓰던 상황이었습니다
리소스가 가벼운 단일 노드 클러스터가 필요했기 때문에 풀 스펙의 kubeadm이나 minikube보다 **k3s**가 적합해 보였습니다

k3s는 공식 install 스크립트 한 줄(`curl -sfL https://get.k3s.io | sh -`)로 설치되고, 경량이면서 API가 완전히 호환됩니다
그래서 WSL2 Ubuntu 위에 바로 k3s를 올렸습니다

문제는 그 다음에 벌어졌습니다

### 증상: API 서버 연결 불가

설치 직후 `kubectl`을 날려봤습니다

```bash
$ kubectl get nodes
The connection to the server 127.0.0.1:6443 was refused - did you specify the right host or port?
```

API 서버 포트가 열려있지 않다는 뜻입니다
서비스 상태를 확인해봤습니다

```bash
$ sudo systemctl status k3s
● k3s.service - Lightweight Kubernetes
   Loaded: loaded (/etc/systemd/system/k3s.service; enabled; preset: enabled)
   Active: activating (auto-restart) (Result: exit-code)
```

핵심 단서는 두 가지였습니다

- `activating (auto-restart)`: 기동 중 실패하면 systemd가 바로 재시작을 시도합니다. 이 상태가 반복된다는 건 매번 기동이 실패한다는 뜻입니다
- `Result: exit-code`: 프로세스가 종료 코드를 남기고 죽었습니다. 메모리 부족(OOM)이나 신호(Killed)가 아니라 내부 로직에서 자발적으로 exit했다는 신호입니다

즉, k3s 바이너리 자체는 뜨지만 내부 초기화 단계 어딘가에서 실패하고, systemd가 그걸 계속 되살리려다 무한 루프에 빠진 상황이었습니다

---

## 🤔 시도한 방법들

### 1️⃣ 단순 재시작 (실패)

가장 먼저 해본 건 시스템 재시작 차원의 `systemctl restart`였습니다

```bash
$ sudo systemctl restart k3s
$ sudo systemctl status k3s
# 여전히 activating (auto-restart) 반복...
```

결과는 당연히 동일했습니다
문제가 일시적 기동 실패가 아니라 **구조적 실패**이기 때문입니다
앞서 종료 코드를 남기고 죽는 패턴이라는 걸 확인한 이상, 재시작은 같은 실패를 반복하게 만들 뿐입니다

### 2️⃣ 공식 uninstall 스크립트로 재설치 (실패)

그럼 깨끗하게 지우고 다시 깔면 될 거라 생각했습니다
k3s는 공식 uninstall 스크립트를 제공합니다

```bash
$ sudo /usr/local/bin/k3s-uninstall.sh
# 언인스톨 완료

$ curl -sfL https://get.k3s.io | sh -
# 재설치

$ sudo systemctl status k3s
# 여전히 activating (auto-restart)...
```

똑같은 증상이 재현됐습니다
이 시점에서 의심이 든 건 **uninstall 스크립트가 진짜로 전부 지운 게 맞는가**였습니다

디렉토리를 들여다봤더니 잔여물이 남아 있었습니다

```bash
$ ls /etc/rancher/k3s/
k3s.yaml  k3s.yaml.lock

$ ls /var/lib/rancher/k3s/
agent  data  server
```

이게 왜 문제가 되는지 생각해봤습니다

- `/etc/rancher/k3s/k3s.yaml`: kubeconfig 파일입니다. 새 설치가 이 파일을 재생성하려 할 때 기존 파일과 충돌할 수 있습니다
- `/var/lib/rancher/k3s/server/`: etcd/SQLite 데이터스토어, 인증서, 토큰이 들어있습니다. 새 설치는 **새 인증서**를 생성하지만, 기존 데이터스토어가 남아있으면 서로 다른 인증서를 참조하게 되어 TLS 핸드셰이크부터 깨집니다
- `iptables` 규칙: k3s는 flannel로 Pod 네트워크를 구성하면서 수많은 iptables NAT/filter 규칙을 추가합니다. uninstall 스크립트는 이 규칙을 전부 지우지 않습니다

정리하면 uninstall은 **서비스 유닛과 바이너리만 제거**하고, 설정·데이터·네트워크 규칙은 남깁니다
재설치 시 남은 상태가 새 상태와 충돌하면서 기동이 실패하는 구조였습니다

---

## ✅ 해결: 완전 초기화 스크립트

그래서 uninstall이 놓치는 영역까지 강제로 정리하는 스크립트를 만들었습니다

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

각 단계가 왜 필요한지 짚어보겠습니다

**1단계 (공식 uninstall)**: 서비스 유닛과 바이너리를 정석대로 제거합니다. 이걸 건너뛰고 파일만 지우면 systemd에 유닛 파일이 남아 `systemctl`이 여전히 k3s를 인식합니다

**2단계 (`/etc/rancher`, `/var/lib/rancher` 전체 삭제)**: 앞서 확인한 kubeconfig·인증서·데이터스토어 잔여물을 한꺼번에 지웁니다. 특히 `/var/lib/rancher/k3s/server/tls/`에 들어있는 CA 인증서는 새 설치 때 재생성되지 않으면 클라이언트와 서버의 CA가 불일치해 연결 자체가 불가능합니다

**3단계 (kubeconfig 백업 후 삭제)**: `~/.kube/config`에는 이전 설치 때 복사된 context/cluster 정보가 남아있을 수 있습니다. 지우지 않으면 `kubectl`이 죽은 클러스터의 엔드포인트로 요청을 보냅니다

**4단계 (iptables flush)**: `-F`는 체인의 모든 규칙을 비우고, `-X`는 사용자 정의 체인을 제거합니다. k3s/flannel이 추가한 NAT·filter 규칙이 남아있으면 새 설치의 네트워크 구성과 충돌합니다

### 실행 결과

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

### 재설치 성공

완전히 빈 상태에서 재설치를 돌렸습니다

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

30초 대기를 넣은 이유는 k3s 기동이 단일 스텝이 아니기 때문입니다
설치 스크립트가 리턴되는 시점은 systemd가 k3s 프로세스를 `start`한 직후입니다
그 뒤로 k3s 내부에서 API 서버, 컨트롤러 매니저, 스케줄러, kubelet, containerd, flannel이 순차적으로 올라옵니다
이 과정이 5~30초 정도 걸리기 때문에 바로 `kubectl get nodes`를 때리면 "connection refused"가 나옵니다

---

## 💡 대안: k3d로 넘어가기

완전 초기화로 일단 굴러가긴 했지만, 이 고생을 반복하고 싶지 않았습니다
근본적으로 **WSL2 + systemd 기반 k3s 조합 자체가 깨지기 쉬운 구조**라는 판단이 들었기 때문입니다

WSL2는 원래 systemd를 지원하지 않았고, 2022년 9월 이후 `/etc/wsl.conf`에 `systemd=true` 옵션이 추가됐습니다
하지만 WSL2의 systemd는 일반 Linux의 PID 1과 동작이 완전히 동일하진 않습니다
그래서 systemd에 의존하는 서비스(k3s가 대표적입니다)가 예상치 못한 지점에서 실패할 수 있습니다

게다가 iptables도 WSL2에서는 `iptables-legacy`와 `iptables-nft` 사이의 모드 충돌이 종종 발생합니다
k3s/flannel이 기대하는 모드와 WSL2 기본값이 어긋나면 앞서 겪은 NAT 충돌이 재발합니다

k3d는 이 문제를 **구조적으로** 우회합니다
k3d는 k3s를 Docker 컨테이너 안에서 실행합니다
즉, systemd 유닛도 아니고 호스트 iptables를 직접 만지지도 않습니다
모든 것이 Docker가 관리하는 격리된 공간 안에서 일어납니다

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

k3d의 실질적인 장점은 **삭제/재생성 비용이 0에 가깝다는 것**입니다

```bash
# 클러스터 삭제
$ k3d cluster delete k3s-local
```

문제가 생기면 컨테이너를 지우고 다시 만들면 끝입니다
완전 초기화 스크립트 같은 우회 절차가 필요 없습니다

---

## 📚 배운 점

### 1. uninstall 스크립트는 "완전 삭제"가 아닙니다

k3s의 `k3s-uninstall.sh`는 **서비스 유닛과 바이너리만** 제거합니다
남아있는 것들은 다음과 같습니다

- `/etc/rancher/k3s/` — 설정 파일
- `/var/lib/rancher/k3s/` — 데이터스토어, 인증서
- `~/.kube/config` — kubeconfig
- iptables 규칙 — flannel이 추가한 NAT/filter 체인

재설치 전에 이 네 가지를 직접 정리해야 같은 문제를 재발시키지 않습니다

### 2. 설치 완료 != 서비스 Ready

`install.sh`가 리턴됐다고 해서 API 서버가 바로 응답하는 게 아닙니다
k3s 내부에서 API 서버·컨트롤러·스케줄러·kubelet이 순차적으로 올라오는 데 5~30초가 필요합니다
자동화 스크립트에서는 `kubectl wait --for=condition=Ready` 같은 명시적 대기를 넣거나 최소 30초의 sleep을 두는 게 안전합니다

### 3. WSL2에서는 k3d가 구조적으로 안정적입니다

| 비교 항목 | k3s | k3d |
|----------|-----|-----|
| 기반 | systemd 유닛 | Docker 컨테이너 |
| WSL2 호환성 | systemd·iptables 모드에 민감 | Docker만 있으면 동작 |
| 초기화 | 수동 정리 필요 | `k3d cluster delete` 한 줄 |
| 멀티 클러스터 | 복잡 | 여러 개 동시 생성 가능 |

k3s가 "경량 K8s 배포본"이라면, k3d는 "경량 K8s 배포본을 컨테이너로 감싼 것"입니다
한 겹의 격리층이 WSL2의 systemd·네트워크 이슈를 전부 흡수해 줍니다
로컬 실습 용도라면 k3d가 거의 모든 상황에서 낫습니다

## 💭 생각해볼 점

**Q:** k3s 재설치가 필요할 때 가장 먼저 해야 할 일은?

**힌트:** uninstall 스크립트만으로는 부족합니다. 설정 파일·데이터 디렉토리·iptables까지 함께 정리해야 같은 문제가 재발하지 않습니다

## 🔗 참고

- [k3s 공식 문서](https://docs.k3s.io)
- [k3d 공식 문서](https://k3d.io)
- [WSL2에서 systemd 활성화하기](https://learn.microsoft.com/en-us/windows/wsl/wsl-config#systemd-support)
