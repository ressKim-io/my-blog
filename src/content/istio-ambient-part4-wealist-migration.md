---
title: "Istio Ambient Part 4: Wealist를 Ambient로 마이그레이션하기"
excerpt: "실제 프로젝트를 Sidecar에서 Ambient로 전환하는 과정과 주의사항"
category: "kubernetes"
tags: ["istio", "ambient-mesh", "migration", "wealist", "kubernetes"]
series:
  name: "istio-ambient"
  order: 4
date: "2024-12-24"
---

## 🎯 시작하며

Part 3에서 Sidecar vs Ambient 비교와 선택 기준을 다뤘습니다. 이번에는 실제 프로젝트인 **Wealist**를 Ambient로 마이그레이션하는 과정을 공유합니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Wealist 마이그레이션 목표                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Before (Sidecar)                After (Ambient)               │
│   ════════════════                ═══════════════               │
│                                                                 │
│   • Pod 12개                      • Pod 12개 (변경 없음)        │
│   • Sidecar 12개                  • Sidecar 0개                 │
│   • CPU: 1.2 CPU                  • CPU: 0.15 CPU               │
│   • Memory: 1.5Gi                 • Memory: 0.3Gi               │
│                                                                 │
│   결과: 87.5% CPU 절감, 80% Memory 절감                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

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

```
┌─────────────────────────────────────────────────────────────────┐
│                  서비스별 L7 필요 여부                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   서비스              L7 기능           waypoint 필요?          │
│   ═══════════════     ═══════════════   ═══════════════         │
│   api-gateway         JWT, 라우팅       ✅ 필요                 │
│   user-service        JWT               ✅ 필요                 │
│   product-service     라우팅            ✅ 필요                 │
│   order-service       라우팅            ✅ 필요                 │
│   payment-service     JWT               ✅ 필요                 │
│   notification-svc    없음              ❌ ztunnel만            │
│   redis               없음              ❌ ztunnel만            │
│   mongodb             없음              ❌ ztunnel만            │
│                                                                 │
│   → default namespace에 waypoint 1개 배포                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

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

```
┌─────────────────────────────────────────────────────────────────┐
│                    올바른 순서                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   1. Istio 업그레이드 (Ambient 지원 버전)                       │
│   2. ztunnel 확인                                               │
│   3. 테스트 Namespace에서 검증                                  │
│   4. Sidecar injection 레이블 제거                              │
│   5. Ambient 레이블 추가                                        │
│   6. Pod 재시작                                                 │
│   7. waypoint 배포 (L7 필요시)                                  │
│   8. 기능 검증                                                  │
│                                                                 │
│   ❌ 잘못된 순서: Ambient 레이블 추가 전 waypoint 배포          │
│   ❌ 잘못된 순서: Pod 재시작 없이 진행                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

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

```
┌─────────────────────────────────────────────────────────────────┐
│                    Wealist 리소스 비교                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                    Before          After          절감          │
│   ═══════════════════════════════════════════════════════       │
│   Sidecar 수       12개            0개            100%          │
│   ztunnel          0개             3개 (Node)     -             │
│   waypoint         0개             1개            -             │
│                                                                 │
│   CPU              1.2 CPU         0.15 CPU       87.5%         │
│   Memory           1.5Gi           0.3Gi          80%           │
│                                                                 │
│   월 비용 (추정)   $150            $30            80%           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 운영 개선

```
• Istio 업그레이드 시 Pod 재시작 불필요
• Sidecar 리소스 튜닝 부담 해소
• 디버깅 단순화 (Sidecar 경로 제외)
```

---

## 📚 정리

```
┌─────────────────────────────────────────────────────────────────┐
│              마이그레이션 체크리스트                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ✅ 사전 확인                                                  │
│      □ EnvoyFilter 미사용 확인                                  │
│      □ WASM Plugin 미사용 확인                                  │
│      □ 멀티클러스터 아님 확인                                   │
│      □ L7 필요 서비스 파악                                      │
│                                                                 │
│   ✅ 마이그레이션                                               │
│      □ Istio 1.24+ 업그레이드                                   │
│      □ 테스트 Namespace 검증                                    │
│      □ Sidecar 레이블 제거                                      │
│      □ Ambient 레이블 추가                                      │
│      □ Pod 재시작                                               │
│      □ waypoint 배포                                            │
│                                                                 │
│   ✅ 검증                                                       │
│      □ mTLS 동작 확인                                           │
│      □ L7 기능 확인 (라우팅, JWT)                               │
│      □ 메트릭 확인                                              │
│      □ 롤백 테스트                                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🎯 핵심 정리

| 단계 | 명령어 |
|------|--------|
| Ambient 활성화 | `istioctl install --set profile=ambient` |
| Namespace 전환 | `kubectl label ns default istio.io/dataplane-mode=ambient` |
| Sidecar 제거 | `kubectl label ns default istio-injection-` |
| waypoint 배포 | `istioctl waypoint apply --namespace default` |
| 롤백 | `kubectl label ns default istio.io/dataplane-mode-` |

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
