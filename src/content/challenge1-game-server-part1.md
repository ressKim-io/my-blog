---
title: '게임 서버 K8s 배포 - Part 1: k3s → k3d'
excerpt: WSL2 환경에서 k3s 대신 k3d를 선택한 이유
category: challenge
tags:
  - bootcamp
  - k3s
  - k3d
  - wsl2
  - troubleshooting
date: '2025-10-17'
series:
  name: game-server
  order: 1
---

## 🔥 상황

게임 서버를 K8s에 배포하는 챌린지를 시작했다. Mac에서 Windows WSL2로 원격 접속해서 작업하는 환경이었는데, k3s 설치 후 서비스가 계속 재시작만 반복했다.

```bash
$ sudo systemctl status k3s
● k3s.service - Lightweight Kubernetes
     Active: activating (auto-restart) (Result: exit-code)
```

kubectl 명령도 먹히지 않았다.

```bash
$ kubectl get nodes
The connection to the server 127.0.0.1:6443 was refused
```

서비스가 시작하자마자 죽고, 다시 시작하려 하고, 또 죽는 무한 루프.

## 🤔 원인

k3s 로그를 보니 cgroup 관련 에러가 계속 발생했다.

```bash
$ sudo journalctl -u k3s -n 50
Failed to start ContainerManager
system validation failed - wrong number of fields
```

핵심은 **WSL2의 cgroup v2** 문제였다. WSL2는 최신 커널을 쓰면서 cgroup v2를 기본으로 사용하는데, k3s가 이 환경에서 제대로 동작하지 않는 거였다.

은행으로 비유하면, k3s는 "구형 번호표(cgroup v1)"로 일하려는데 은행은 "신형 키오스크(cgroup v2)"만 설치해놔서 업무를 못 보는 상황이었다.

시도했던 것들:
- k3s 완전 삭제 → 재설치: 실패
- WSL 커널 업데이트: 실패  
- cgroup v1 전환 시도: WSL2에서 지원 안 함

결국 WSL2 환경에서는 k3s를 안정적으로 쓸 수 없다고 판단했다.

## ✅ 해결

k3s 대신 **k3d**를 선택했다.

k3d는 Docker 컨테이너 안에서 k3s를 실행한다. Docker라는 "안정적인 상자" 안에 k3s를 넣어서 돌리니 WSL2의 cgroup 문제를 우회할 수 있었다.

```bash
# k3d 설치
curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash

# 클러스터 생성 (마스터 1개, 워커 2개)
k3d cluster create k3s-local \
  --agents 2 \
  --port "8080:80@loadbalancer"

# 확인
kubectl get nodes
```

바로 성공했다. 클러스터가 올라오고, kubectl도 정상 작동했다.

```bash
NAME                       STATUS   ROLE           AGE
k3d-k3s-local-server-0     Ready    control-plane  1m
k3d-k3s-local-agent-0      Ready    <none>         1m
k3d-k3s-local-agent-1      Ready    <none>         1m
```

## 📚 배운 점

### k3s vs k3d

**k3s**는 호스트에 직접 설치한다.
- 가볍고 빠르다
- 프로덕션에 적합하다
- 하지만 WSL2 같은 특수 환경에서 문제가 생길 수 있다

**k3d**는 Docker 안에서 k3s를 실행한다.
- 환경 독립적이다 (Docker만 있으면 된다)
- 로컬 개발에 최적화되어 있다
- 여러 클러스터 관리가 편하다

로컬 개발 환경, 특히 Mac → Windows WSL2 같은 복잡한 구조에서는 k3d가 훨씬 안정적이라는 걸 배웠다.

### 노드 라벨링

나중을 위해 워커 노드에 라벨을 달아뒀다.

```bash
# 각 노드에 역할 부여
kubectl label nodes k3d-k3s-local-agent-0 workload=compute
kubectl label nodes k3d-k3s-local-agent-1 workload=backend

# 확인
kubectl get nodes --show-labels
```

CPU 집약적인 게임 룸은 compute 노드에, 일반 서비스는 backend 노드에 배치할 계획이다.

## 💭 생각해볼 점

**Q**: 프로덕션에서도 k3d를 쓸 수 있을까?

**힌트**: k3d는 개발용이다. 실제 서비스에서는 k3s를 직접 설치하거나, EKS/GKE 같은 관리형 서비스를 쓰는 게 맞다. k3d의 Docker 레이어는 성능 오버헤드가 있고, 고가용성 구성이 어렵다.

## 🎯 추가 학습

- k3s 공식 문서에서 cgroup v2 요구사항 확인하기
- k3d로 멀티 클러스터 관리하는 방법
- Docker-in-Docker 동작 원리 이해하기

## 🔗 참고
- **[📂 프로젝트 GitHub 저장소](https://github.com/ressKim-io/game-server-k8s)**

- [k3d 공식 문서](https://k3d.io/)
- [k3s cgroup v2 이슈](https://github.com/k3s-io/k3s/issues)
