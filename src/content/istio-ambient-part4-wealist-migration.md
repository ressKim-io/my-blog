---
title: "Istio Ambient Part 4: Wealist를 Ambient로 마이그레이션하기"
excerpt: "실제 프로젝트를 Sidecar에서 Ambient로 전환하는 과정과 주의사항"
category: "kubernetes"
tags: ["istio", "ambient-mesh", "migration", "wealist", "kubernetes"]
series:
  name: "istio-ambient"
  order: 4
date: "2025-12-24"
---

## 🎯 시작하며

Part 3에서 Sidecar vs Ambient 비교와 선택 기준을 다뤘습니다. 이번에는 실제 프로젝트인 **Wealist**를 Ambient로 마이그레이션하는 과정을 공유합니다.

![Migration Result](/images/istio-ambient/migration-result.svg)

| 항목 | Before (Sidecar) | After (Ambient) | 절감률 |
|------|------------------|-----------------|:------:|
| Pod 수 | 12개 | 12개 | - |
| Sidecar 수 | 12개 | 0개 | 100% |
| CPU | 1.2 CPU | 0.15 CPU | **87.5%** |
| Memory | 1.5Gi | 0.3Gi | **80%** |

Wealist 프로젝트는 12개의 마이크로서비스로 구성되어 있습니다. Sidecar 모드에서는 각 Pod에 Envoy Sidecar가 함께 배포되어 총 12개의 Sidecar가 실행되었습니다. Ambient로 전환 후 Node당 1개의 ztunnel만 실행되므로, Sidecar 오버헤드가 완전히 제거되었습니다.

결과적으로 CPU는 87.5%, 메모리는 80% 절감했습니다. 이는 클라우드 비용으로 환산하면 월 $120 이상의 절감 효과입니다.

---

## 📋 마이그레이션 전 체크리스트

### 1. 현재 Istio 설정 확인

```bash
# EnvoyFilter 확인
$ kubectl get envoyfilter -A
No resources found

# WASM Plugin 확인
$ kubectl get wasmplugin -A
No resources found

# Sidecar 리소스 확인
$ kubectl get sidecar -A
No resources found

# ✅ 모두 없음 → Ambient 전환 가능
```

### 2. 사용 중인 Istio 리소스 파악

```bash
# VirtualService
$ kubectl get vs -A
NAMESPACE   NAME              GATEWAYS             HOSTS
default     api-routing       ["api-gateway"]      ["api.wealist.io"]

# DestinationRule
$ kubectl get dr -A
NAMESPACE   NAME              HOST
default     api-destination   api-service

# AuthorizationPolicy
$ kubectl get authorizationpolicy -A
NAMESPACE   NAME              AGE
default     allow-frontend    10d

# RequestAuthentication (JWT)
$ kubectl get requestauthentication -A
NAMESPACE   NAME       AGE
default     jwt-auth   10d
```

### 3. L7 기능 필요 서비스 파악

| 서비스 | L7 기능 | waypoint 필요? |
|--------|---------|:--------------:|
| api-gateway | JWT, 라우팅 | ✅ 필요 |
| user-service | JWT | ✅ 필요 |
| product-service | 라우팅 | ✅ 필요 |
| order-service | 라우팅 | ✅ 필요 |
| payment-service | JWT | ✅ 필요 |
| notification-svc | 없음 | ❌ ztunnel만 |
| redis | 없음 | ❌ ztunnel만 |
| mongodb | 없음 | ❌ ztunnel만 |

서비스별로 L7 기능 필요 여부를 분석한 결과입니다. HTTP 라우팅이나 JWT 인증이 필요한 서비스는 waypoint를 통해 L7 처리가 필요합니다. 반면 redis, mongodb 같은 데이터스토어나 단순 내부 통신만 하는 서비스는 mTLS만 있으면 되므로 ztunnel만으로 충분합니다.

Wealist의 경우 모든 서비스가 같은 Namespace(default)에 있고, L7 기능이 필요한 서비스가 과반수이므로 **Namespace 레벨에 waypoint 1개를 배포**하기로 결정했습니다. 서비스별로 따로 배포하면 관리가 복잡해지기 때문입니다.

---

## 🔧 마이그레이션 단계

### Step 1: Istio 업그레이드 (Ambient 지원 버전)

```bash
# Istio 1.24+ 필요
$ istioctl version
client version: 1.24.0
control plane version: 1.24.0

# Ambient 컴포넌트 활성화
$ istioctl install --set profile=ambient -y
```

### Step 2: ztunnel 확인

```bash
# ztunnel DaemonSet 확인
$ kubectl get pods -n istio-system -l app=ztunnel
NAME            READY   STATUS    RESTARTS   AGE
ztunnel-7xk2p   1/1     Running   0          5m
ztunnel-9xm3q   1/1     Running   0          5m
ztunnel-b2n4r   1/1     Running   0          5m

# Node 수만큼 Pod 존재
```

### Step 3: 테스트 Namespace부터 시작

```bash
# 새로운 테스트 Namespace 생성
$ kubectl create namespace ambient-test

# Ambient 레이블 적용
$ kubectl label namespace ambient-test istio.io/dataplane-mode=ambient

# 테스트 앱 배포
$ kubectl apply -f test-app.yaml -n ambient-test

# mTLS 확인
$ kubectl exec -n ambient-test deploy/test-client -- \
    curl -v http://test-server:8080
# TLS 핸드셰이크 확인
```

### Step 4: 기존 Sidecar 제거 준비

```bash
# 현재 Sidecar injection 상태 확인
$ kubectl get namespace default --show-labels
NAME      STATUS   AGE   LABELS
default   Active   30d   istio-injection=enabled
```

### Step 5: Namespace 전환 (핵심!)

```bash
# 1. 기존 Sidecar injection 레이블 제거
$ kubectl label namespace default istio-injection-

# 2. Ambient 레이블 추가
$ kubectl label namespace default istio.io/dataplane-mode=ambient

# 3. 확인
$ kubectl get namespace default --show-labels
NAME      STATUS   AGE   LABELS
default   Active   30d   istio.io/dataplane-mode=ambient
```

### Step 6: Pod 재시작으로 Sidecar 제거

```bash
# 모든 Deployment 재시작
$ kubectl rollout restart deployment -n default

# Sidecar 제거 확인
$ kubectl get pods -n default
NAME                              READY   STATUS    RESTARTS   AGE
api-gateway-xxx                   1/1     Running   0          1m    # 2/2 → 1/1
user-service-xxx                  1/1     Running   0          1m
product-service-xxx               1/1     Running   0          1m

# 이전: 2/2 (앱 + Sidecar)
# 이후: 1/1 (앱만)
```

### Step 7: waypoint 배포

```bash
# Namespace 레벨 waypoint 배포
$ istioctl waypoint apply --namespace default

# 확인
$ kubectl get gateway -n default
NAME       CLASS            ADDRESS        PROGRAMMED   AGE
waypoint   istio-waypoint   10.96.xx.xx    True         1m

# waypoint Pod 확인
$ kubectl get pods -n default -l gateway.istio.io/managed
NAME                        READY   STATUS    RESTARTS   AGE
waypoint-xxx                1/1     Running   0          1m
```

### Step 8: 기능 검증

```bash
# 1. mTLS 확인
$ kubectl exec deploy/test-client -- curl -v http://api-gateway:8080
# TLS 연결 확인

# 2. VirtualService 라우팅 확인
$ kubectl exec deploy/test-client -- curl http://api-gateway:8080/api/v1/users
# 정상 응답

# 3. JWT 인증 확인
$ kubectl exec deploy/test-client -- curl http://api-gateway:8080/api/users \
    -H "Authorization: Bearer $TOKEN"
# 인증 성공

# 4. AuthorizationPolicy 확인
$ kubectl exec deploy/unauthorized-client -- curl http://api-gateway:8080
# 403 Forbidden
```

---

## 📊 마이그레이션 검증

### 트래픽 확인

```bash
# ztunnel 로그에서 트래픽 확인
$ kubectl logs -n istio-system -l app=ztunnel | grep "default/api-gateway"

# waypoint 로그에서 L7 처리 확인
$ kubectl logs -n default -l gateway.istio.io/managed | grep "HTTP"
```

### 메트릭 확인

```promql
# 요청량 확인
sum(rate(istio_requests_total{destination_service=~".*wealist.*"}[5m])) by (destination_service)

# 에러율 확인
sum(rate(istio_requests_total{destination_service=~".*wealist.*", response_code=~"5.."}[5m]))
/
sum(rate(istio_requests_total{destination_service=~".*wealist.*"}[5m]))
```

### 리소스 사용량 비교

```bash
# Before (Sidecar)
$ kubectl top pods -n default
NAME                     CPU(cores)   MEMORY(bytes)
api-gateway-old          150m         200Mi    # 앱 100m + Sidecar 50m

# After (Ambient)
$ kubectl top pods -n default
NAME                     CPU(cores)   MEMORY(bytes)
api-gateway-new          100m         150Mi    # 앱만
```

---

## ⚠️ 주의사항

### 1. 순서 중요

![Migration Steps|tall](/images/istio-ambient/migration-steps.svg)

| 단계 | 작업 | 설명 |
|:----:|------|------|
| 1 | Istio 업그레이드 | Ambient 지원 버전 (1.24+) |
| 2 | ztunnel 확인 | DaemonSet 정상 동작 확인 |
| 3 | 테스트 Namespace | 별도 Namespace에서 먼저 검증 |
| 4 | istio-injection 제거 | 기존 Sidecar 레이블 제거 |
| 5 | ambient 레이블 추가 | `istio.io/dataplane-mode=ambient` |
| 6 | Pod 재시작 | Sidecar 제거를 위해 필수 |
| 7 | waypoint 배포 | L7 기능 필요시 |
| 8 | 기능 검증 | mTLS, 라우팅, JWT 테스트 |

순서를 지키는 것이 매우 중요합니다. 특히 다음 두 가지 실수를 주의하세요:

- **❌ Ambient 레이블 추가 전 waypoint 배포**: waypoint는 Ambient 모드 Namespace에서만 동작합니다. 레이블 없이 배포하면 waypoint가 트래픽을 받지 못합니다.
- **❌ Pod 재시작 없이 진행**: Namespace 레이블을 바꿔도 기존 Pod의 Sidecar는 그대로 남아있습니다. 반드시 Pod를 재시작해야 Sidecar가 제거됩니다.

### 2. 롤백 준비

```bash
# 롤백 시나리오: Ambient에서 문제 발생

# 1. Ambient 레이블 제거
$ kubectl label namespace default istio.io/dataplane-mode-

# 2. Sidecar injection 레이블 복원
$ kubectl label namespace default istio-injection=enabled

# 3. Pod 재시작
$ kubectl rollout restart deployment -n default

# 4. waypoint 제거 (선택)
$ istioctl waypoint delete --namespace default
```

### 3. 하이브리드 운영

```yaml
# Sidecar와 Ambient 공존 가능
# 서로 다른 Namespace에서

# Sidecar Namespace
apiVersion: v1
kind: Namespace
metadata:
  name: legacy-services
  labels:
    istio-injection: enabled

# Ambient Namespace
apiVersion: v1
kind: Namespace
metadata:
  name: new-services
  labels:
    istio.io/dataplane-mode: ambient

# 두 Namespace 간 mTLS 통신 OK
```

---

## 📈 마이그레이션 결과

### 리소스 절감

| 항목 | Before | After | 절감률 |
|------|--------|-------|:------:|
| Sidecar 수 | 12개 | 0개 | 100% |
| ztunnel | 0개 | 3개 (Node당) | - |
| waypoint | 0개 | 1개 | - |
| CPU | 1.2 CPU | 0.15 CPU | **87.5%** |
| Memory | 1.5Gi | 0.3Gi | **80%** |
| 월 비용 (추정) | $150 | $30 | **80%** |

리소스 절감 효과가 극적입니다. Sidecar 12개가 완전히 제거되고, 그 자리를 Node당 1개의 ztunnel이 대체했습니다. 3개 Node 클러스터이므로 ztunnel은 3개, 그리고 L7 처리를 위한 waypoint 1개가 추가되었습니다.

CPU는 1.2 CPU에서 0.15 CPU로, 메모리는 1.5Gi에서 0.3Gi로 줄었습니다. 클라우드 비용으로 환산하면 월 $120 절감입니다. 연간으로 계산하면 $1,440의 비용 절감 효과입니다.

### 운영 개선

| 개선 항목 | Before (Sidecar) | After (Ambient) |
|-----------|------------------|-----------------|
| Istio 업그레이드 | Pod 재시작 필요 | DaemonSet 업데이트만 |
| 리소스 튜닝 | Pod별 Sidecar 설정 | ztunnel 설정 한 곳 |
| 디버깅 | App + Sidecar 경로 | App 경로만 집중 |

운영 측면에서도 개선이 있었습니다. 가장 큰 변화는 Istio 업그레이드 시 더 이상 모든 Pod를 재시작할 필요가 없다는 점입니다. ztunnel은 DaemonSet이므로 롤링 업데이트만 하면 됩니다. 또한 Sidecar별 리소스 튜닝이 필요 없어져 운영 부담이 크게 줄었습니다.

---

## 📚 정리

### 마이그레이션 체크리스트

**✅ 사전 확인**

| 항목 | 확인 명령어 | 통과 조건 |
|------|-------------|-----------|
| EnvoyFilter 미사용 | `kubectl get envoyfilter -A` | No resources found |
| WASM Plugin 미사용 | `kubectl get wasmplugin -A` | No resources found |
| 멀티클러스터 아님 | 아키텍처 확인 | 단일 클러스터 |
| L7 필요 서비스 파악 | VS, JWT 리소스 확인 | 목록 작성 완료 |

**✅ 마이그레이션**

| 순서 | 작업 | 완료 확인 방법 |
|:----:|------|----------------|
| 1 | Istio 1.24+ 업그레이드 | `istioctl version` |
| 2 | 테스트 Namespace 검증 | mTLS 통신 테스트 |
| 3 | Sidecar 레이블 제거 | `istio-injection` 레이블 없음 |
| 4 | Ambient 레이블 추가 | `istio.io/dataplane-mode=ambient` 확인 |
| 5 | Pod 재시작 | READY가 `2/2` → `1/1`로 변경 |
| 6 | waypoint 배포 | `kubectl get gateway` |

**✅ 검증**

| 항목 | 테스트 방법 | 예상 결과 |
|------|-------------|-----------|
| mTLS 동작 | curl -v로 TLS 핸드셰이크 확인 | TLS 연결 성공 |
| L7 기능 | VirtualService 라우팅 테스트 | 정상 라우팅 |
| JWT 인증 | 토큰 없이 요청 | 401 Unauthorized |
| 메트릭 | Prometheus 쿼리 | istio_requests_total 증가 |
| 롤백 테스트 | 레이블 복원 후 재시작 | Sidecar 복원 |

체크리스트를 순서대로 따라가면 안전하게 마이그레이션할 수 있습니다. 특히 사전 확인 단계에서 블로커가 발견되면 해당 서비스는 Sidecar로 유지하고, 나머지만 Ambient로 전환하는 하이브리드 전략을 고려하세요.

---

## 🎯 핵심 정리

| 단계 | 명령어 |
|------|--------|
| Ambient 활성화 | `istioctl install --set profile=ambient` |
| Namespace 전환 | `kubectl label ns default istio.io/dataplane-mode=ambient` |
| Sidecar 제거 | `kubectl label ns default istio-injection-` |
| waypoint 배포 | `istioctl waypoint apply --namespace default` |
| 롤백 | `kubectl label ns default istio.io/dataplane-mode-` |

마이그레이션에 필요한 핵심 명령어 5개입니다. 이 명령어들만 알면 기본적인 전환이 가능합니다.

`istioctl install --set profile=ambient`는 Istio를 Ambient 프로파일로 설치합니다. 기존 Istio가 있다면 업그레이드 형태로 ztunnel 컴포넌트가 추가됩니다. ztunnel은 DaemonSet으로 모든 Node에 자동 배포됩니다.

Namespace 전환은 두 단계입니다. 먼저 `istio-injection-`로 기존 Sidecar 레이블을 제거하고, `istio.io/dataplane-mode=ambient`로 Ambient 모드를 활성화합니다. 레이블만 바꿔도 새로 생성되는 Pod는 Ambient 모드로 동작하지만, 기존 Pod의 Sidecar를 제거하려면 Pod를 재시작해야 합니다.

waypoint 배포는 L7 기능이 필요한 경우에만 수행합니다. `istioctl waypoint apply`로 간단히 배포할 수 있습니다. Namespace 레벨, ServiceAccount 레벨, 또는 특정 서비스에만 적용할 수 있습니다.

롤백도 간단합니다. Ambient 레이블을 제거하고 Sidecar 레이블을 다시 추가한 후 Pod를 재시작하면 원래 상태로 돌아갑니다.

---

## 🔗 다음 편 예고

Part 5에서는 **Ambient에서 JWT 통합 인증 구현**을 다룹니다:
- HS512 → RSA 전환 이유
- JWKS 설정
- waypoint에서 JWT 검증

---

## 🔗 참고 자료

- [Istio Ambient Getting Started](https://istio.io/latest/docs/ambient/getting-started/)
- [Waypoint Deployment](https://istio.io/latest/docs/ambient/usage/waypoint/)
- [Ambient Upgrade](https://istio.io/latest/docs/ambient/upgrade/)
