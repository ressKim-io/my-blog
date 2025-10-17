---
title: "Namespace와 ConfigMap으로 환경 분리하기"
excerpt: "K8s에서 서비스별 설정을 깔끔하게 관리하는 방법"
categories:
  - kubernetes
tags:
  - namespace
  - configmap
  - environment
  - k8s
toc: true
toc_sticky: true
date: 2025-01-17
last_modified_at: 2025-01-17
---

## 🎯 핵심 개념

클러스터를 만들었으니 이제 서비스를 배포해야 한다. 하지만 그 전에 두 가지를 먼저 정리하고 가려고 한다.

1. **Namespace**: 서비스들을 어디에 둘 건가?
2. **ConfigMap**: 환경 변수는 어떻게 관리할 건가?

이 둘을 먼저 잡아두면 나중에 서비스가 늘어나도 깔끔하게 관리할 수 있다.

## 💡 왜 필요한가

### Namespace가 필요한 이유

아파트로 비유해보자. 101동, 102동, 103동처럼 동을 나누듯이, K8s에서도 리소스를 논리적으로 나눌 수 있다. 이게 Namespace다.

```bash
# default 네임스페이스에 전부 때려박기 (❌)
kubectl get pods
# lobby-xxx, gameroom-xxx, chat-xxx 다 섞임

# 네임스페이스로 분리 (✅)
kubectl get pods -n game-prod
# 게임 관련만 보임
```

실무에서는 보통 이렇게 나눈다:
- `dev`: 개발 환경
- `staging`: 테스트 환경
- `prod`: 운영 환경

나는 이번 챌린지에서 `game-prod` 하나만 만들었다.

### ConfigMap이 필요한 이유

환경 변수를 코드에 하드코딩하면 문제가 생긴다.

```yaml
# ❌ 이렇게 하지 말자
env:
  - name: PORT
    value: "8080"
  - name: DB_HOST
    value: "mysql.example.com"
```

환경이 바뀔 때마다 코드를 수정하고 다시 배포해야 한다. 대신 ConfigMap으로 분리하면 설정만 바꾸면 된다.

```yaml
# ✅ 이렇게 하자
envFrom:
  - configMapRef:
      name: lobby-config
```

설정이 바뀌면 ConfigMap만 업데이트하고 Pod를 재시작하면 된다.

## 📌 주요 특징

### Namespace 생성

```bash
# YAML로 생성
cat > 01-namespace.yaml <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: game-prod
  labels:
    env: production
    project: game-server
EOF

kubectl apply -f 01-namespace.yaml
```

간단하다. 이름 붙이고, 라벨 달고 끝.

### ConfigMap 구조

ConfigMap은 두 종류로 나눴다.

**1. 공통 설정** (모든 서비스가 쓰는 것)
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: game-common-config
  namespace: game-prod
data:
  ENVIRONMENT: "production"
  LOG_LEVEL: "info"
  CLUSTER_NAME: "k3s-local"
```

**2. 서비스별 설정** (각 서비스 전용)
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: lobby-config
  namespace: game-prod
data:
  PORT: "8080"
  MAX_PLAYERS: "1000"
  MATCH_TIMEOUT: "30"
```

이렇게 나누면 나중에 관리가 편하다. 공통 설정은 한 곳에서, 서비스별 설정은 각자 관리하면 된다.

### Deployment에서 사용

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: game-lobby
  namespace: game-prod
spec:
  template:
    spec:
      containers:
      - name: lobby
        image: nginx:alpine
        envFrom:
        - configMapRef:
            name: game-common-config  # 공통 설정
        - configMapRef:
            name: lobby-config        # 서비스 전용 설정
```

`envFrom`을 쓰면 ConfigMap의 모든 키가 환경 변수로 들어간다. 일일이 나열할 필요가 없다.

## ⚠️ 주의사항

### default 네임스페이스 피하기

`default` 네임스페이스에 모든 걸 때려박으면 나중에 정리가 안 된다. 처음부터 용도별로 네임스페이스를 나누는 습관을 들이자.

### ConfigMap 변경 시 재시작

ConfigMap을 수정해도 이미 실행 중인 Pod는 자동으로 재시작되지 않는다.

```bash
# ConfigMap 수정
kubectl edit configmap lobby-config -n game-prod

# Pod 재시작 필요
kubectl rollout restart deployment game-lobby -n game-prod
```

이게 귀찮으면 ConfigMap을 파일로 마운트하는 방법도 있지만, 지금은 환경 변수로 충분하다.

### Secret과의 차이

민감한 정보(DB 비밀번호, API 키)는 ConfigMap이 아닌 Secret을 써야 한다. ConfigMap은 평문으로 저장되기 때문이다.

```yaml
# 민감하지 않은 정보 → ConfigMap
PORT: "8080"

# 민감한 정보 → Secret
DB_PASSWORD: "xxxx"
```

이번 챌린지에서는 실제 DB를 안 써서 ConfigMap만 사용했다.

## 정리

Namespace로 리소스를 논리적으로 나누고, ConfigMap으로 환경 변수를 분리했다. 이 두 가지만 잘 써도 K8s 관리가 훨씬 편해진다.

다음 글에서는 이 Namespace에 실제 Deployment를 띄워볼 예정이다.

## 💭 생각해볼 점

**Q**: 네임스페이스를 너무 많이 나누면 어떤 문제가 생길까?

**힌트**: 네임스페이스가 많아지면 리소스 관리가 복잡해진다. 네트워크 정책, RBAC 설정이 네임스페이스별로 필요하고, 서비스 간 통신도 복잡해진다. 보통은 환경별(dev/staging/prod) 정도만 나누는 게 적당하다.

## 🎯 추가 학습

- 네임스페이스 간 통신 방법 (Service DNS)
- ResourceQuota로 네임스페이스별 리소스 제한
- Secret 사용법과 base64 인코딩

## 🔗 참고

- [Kubernetes Namespace 공식 문서](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/)
- [ConfigMap 공식 문서](https://kubernetes.io/docs/concepts/configuration/configmap/)
