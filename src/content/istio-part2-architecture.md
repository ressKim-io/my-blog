---
title: Service Mesh 완벽 이해 Part 2 - 아키텍처와 동작 원리
excerpt: >-
  Control Plane과 Data Plane이 정확히 뭔지, Sidecar가 어떻게 동작하는지, Pod 간 요청이 실제로 어떤 경로로
  흐르는지 파헤치기
category: kubernetes
tags:
  - istio
  - envoy
  - sidecar
  - control-plane
  - data-plane
  - mtls
  - kubernetes
date: '2025-10-23'
series:
  name: istio
  order: 2
---

## 🎯 이전 글 요약

Part 1에서는 Istio가 뭔지, Kong과 어떻게 다른지 개념을 잡았다.

**핵심 내용:**
- Istio는 서비스 간 통신(East-West)을 관리
- Istio만으로도 API Gateway 역할 가능 (Kong 선택사항)
- Service Mesh = 네트워크 로직 분리

Part 2에서는 **Istio가 내부적으로 어떻게 동작하는지** 파헤쳐 보겠습니다.

---

## 💡 학습 동기

Part 1에서 개념은 이해했지만, "그래서 정확히 어떻게 동작하는데?"라는 의문이 남았다.

**궁금했던 것:**
- Sidecar가 트래픽을 가로챈다는데 어떻게?
- Control Plane이 뭐고 Data Plane이 뭔데?
- mTLS가 자동으로 된다는데 누가 인증서를 관리해?
- Pod A → Pod B 요청이 실제로 어떤 경로로?

k3d로 Istio를 설치하고 직접 테스트하면서 하나씩 이해해봤다.

---

## 🏗️ Istio 아키텍처 전체 구조

Istio는 크게 **두 개의 영역**으로 나뉜다.

![Istio Architecture|tall](/images/istio/istio-architecture.svg)

| 영역 | 구성 요소 | 역할 |
|------|----------|------|
| **Control Plane** | Istiod | 설정 배포, 인증서 관리, 정책 검증 (트래픽 직접 처리 X) |
| **Data Plane** | Envoy Proxies | 실제 트래픽 처리, mTLS 암호화, 메트릭 수집 |

**핵심:**
- **Control Plane (Istiod)**: 설정을 관리하고 배포하는 중앙 관제탑
- **Data Plane (Envoy)**: 실제 트래픽을 처리하는 일꾼들

---

## 🎛️ Control Plane - Istiod

### 이전 vs 현재

Istio 초기 버전은 복잡했다.

**이전 (Istio 1.4 이전):**
```
Pilot (트래픽 관리)
Mixer (정책/텔레메트리)
Citadel (보안)
Galley (설정 검증)
→ 4개 컴포넌트 따로 관리
```

**현재 (Istio 1.5+):**
```
Istiod
→ 모든 기능 통합
→ 단순하고 가볍게
```

관리 복잡도를 줄이기 위해 하나로 합쳤다고 한다.

### Istiod가 하는 일

![Istiod Functions](/images/istio/istiod-internal.svg)

| 기능 | 설명 |
|------|------|
| **Service Discovery** | K8s Service/Pod 자동 감지 |
| **Configuration** | VirtualService, DestinationRule → Envoy로 실시간 전송 |
| **Certificate Management** | mTLS 인증서 자동 발급, 24시간마다 갱신 |
| **Validation** | 잘못된 YAML 사전 체크 |

**중요한 점:**

Istiod는 **트래픽을 직접 처리하지 않는다.** 설정만 배포하고, 실제 트래픽은 Envoy들이 처리한다.

마치 교통 경찰(Istiod)이 신호 체계(설정)를 정하면, 현장 경찰관들(Envoy)이 실제로 차량(트래픽)을 통제하는 것과 비슷하다.

---

## 🚀 Data Plane - Envoy Proxy

### Envoy란?

Envoy는 고성능 프록시 서버다. Lyft에서 만들어서 CNCF에 기부했고, Istio가 이걸 Sidecar로 쓴다.

**Envoy의 역할:**
- 모든 네트워크 트래픽 가로채기
- mTLS 암호화/복호화
- 로드 밸런싱
- 재시도, 타임아웃
- 메트릭 수집
- 분산 추적

### Sidecar Pattern

Istio의 핵심은 **Sidecar Pattern**이다.

![Sidecar Pattern](/images/istio/sidecar-injection.svg)

| 구분 | Without Istio | With Istio |
|------|--------------|------------|
| **Pod 구성** | App 컨테이너만 | App + Envoy 컨테이너 |
| **네트워크** | App이 직접 통신 | Envoy가 대신 처리 |
| **App 포트** | 외부 노출 | localhost:8080 (내부용) |

**App 입장에서는:**
- localhost:8080만 보임
- 외부와의 통신은 Envoy가 알아서 처리
- 코드 수정 불필요

### Sidecar 주입 과정

k3d로 테스트하면서 신기했던 부분이다.

**1. 네임스페이스에 라벨 추가:**
```bash
kubectl label namespace default istio-injection=enabled
```

**2. Pod 배포:**
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp
spec:
  containers:
  - name: app
    image: nginx
```

**3. 결과 확인:**
```bash
kubectl get pod myapp

NAME    READY   STATUS    RESTARTS   AGE
myapp   2/2     Running   0          10s
```

**2/2?** 컨테이너 하나만 배포했는데 2개?

```bash
kubectl describe pod myapp

Containers:
  app:
    Image: nginx
  istio-proxy:
    Image: istio/proxyv2:1.19.0  # ← Envoy가 자동 주입됨!
```

**자동으로 Envoy가 추가됐다!**

이게 가능한 이유는 **Kubernetes Mutating Webhook** 때문이다. Pod 생성 요청을 가로채서 Envoy 컨테이너를 추가하는 방식이다.

---

## 🔄 실제 요청 흐름

가장 중요한 부분이다. Pod A에서 Pod B로 요청을 보낼 때 내부적으로 뭐가 일어날까?

### 시나리오: Order Service → Payment Service

![Request Flow](/images/istio/request-flow.svg)

| 단계 | 위치 | 동작 |
|------|------|------|
| **1** | Order App | `requests.post("payment-service")` - 평범한 HTTP 호출 |
| **2** | Order Envoy | iptables로 가로채기 → mTLS 암호화 |
| **3** | 네트워크 | 암호화된 트래픽 전송 |
| **4** | Payment Envoy | mTLS 복호화 → 인증 확인 → 메트릭 수집 |
| **5** | Payment App | localhost:8080에서 수신 (암호화 무관) |

**핵심:**
- 앱은 localhost만 봄
- 암호화, 인증, 재시도 모두 Envoy가 처리
- 앱 코드 수정 전혀 불필요

---

## 🔐 mTLS 자동화의 비밀

가장 신기했던 부분이다. 인증서를 직접 관리할 필요가 없다.

### mTLS란?

**Mutual TLS (상호 TLS)**

```
일반 TLS (HTTPS):
Client → Server 인증만
(서버가 진짜인지만 확인)

mTLS:
Client ↔ Server 양방향 인증
(서버도 클라이언트 확인)
```

Service Mesh에서는 모든 서비스가 서로를 인증해야 하니 mTLS가 필요하다.

### 기존 방식의 문제

```
수동 인증서 관리:
1. 각 서비스마다 인증서 생성
2. 서비스 코드에 인증서 경로 설정
3. 만료 전에 수동으로 갱신
4. 새 서비스 추가시 반복

서비스 20개면? 😱
```

### Istio의 자동화

![mTLS Automation](/images/istio/mtls-automation.svg)

| 단계 | 동작 |
|------|------|
| **Pod 시작** | Envoy → Istiod에 인증서 요청 → 즉시 발급 (Service Account 기반) |
| **통신 시** | 양쪽 Envoy가 인증서 교환 → 상호 인증 → 암호화 통신 |
| **24시간 후** | Istiod가 새 인증서 자동 발급 → Envoy 자동 교체 (재시작 X) |

**동작 과정:**

1. **Pod 시작시:**
   - Envoy가 Istiod에 "인증서 주세요" 요청
   - Istiod가 즉시 발급 (Service Account 기반)

2. **통신시:**
   - Order Envoy: "내 인증서 보여줌"
   - Payment Envoy: "확인함. 내 인증서 보여줌"
   - 양방향 인증 완료 → 암호화 통신

3. **24시간 후:**
   - Istiod가 자동으로 새 인증서 발급
   - Envoy가 자동으로 교체
   - 서비스 재시작 불필요

**개발자가 할 일: 없음!**

### 테스트 확인

실제로 mTLS가 동작하는지 확인해봤다.

```bash
# 인증서 확인
kubectl exec -it myapp -c istio-proxy -- \
  openssl s_client -connect payment-service:8080

# 출력:
Certificate chain
 0 s:
   i:O = cluster.local  # ← Istio가 자동 발급한 인증서!
```

실제로 자동 발급된 인증서가 보였다.

---

## 🎭 트래픽 가로채기의 비밀 (iptables)

"Envoy가 어떻게 트래픽을 가로챈다는 거지?" 궁금했다.

### iptables 규칙

Istio는 **iptables**를 사용한다.

```bash
# Pod 안의 iptables 확인
kubectl exec -it myapp -c istio-proxy -- iptables -t nat -L

# 출력 (단순화):
Chain OUTPUT
target     prot  source    destination
ISTIO_OUT  all   0.0.0.0   0.0.0.0

Chain ISTIO_OUT
- 외부로 나가는 모든 트래픽 → 15001 포트로 리다이렉트
- 15001은 Envoy의 Outbound 포트

Chain PREROUTING
- 들어오는 모든 트래픽 → 15006 포트로 리다이렉트
- 15006은 Envoy의 Inbound 포트
```

**결과:**
```
App이 payment-service:8080 호출
  → iptables가 가로채기
    → localhost:15001 (Envoy Outbound)로 리다이렉트
      → Envoy가 실제 처리
```

App은 전혀 모르고, Envoy가 투명하게 처리한다.

---

## 💭 배우면서 이해한 핵심

### 1. Control Plane은 설정만, Data Plane이 실제 처리

```
Istiod (Control Plane):
- "이렇게 라우팅해", "저 인증서 써" 같은 설정만
- 트래픽은 전혀 안 거침

Envoy (Data Plane):
- 실제 모든 트래픽이 여기로
- 암호화, 라우팅, 메트릭 수집 다 여기서
```

처음엔 Istiod가 모든 트래픽을 처리하는 줄 알았는데, 설정만 배포하는 역할이었다.

### 2. Sidecar = 투명한 프록시

```
App 입장:
"나는 그냥 localhost로 통신하는데?"

실제:
Envoy가 모든 걸 대신 처리
- iptables로 가로채기
- mTLS 암호화
- 재시도, 타임아웃
```

코드 수정이 필요 없는 이유가 바로 이거다.

### 3. mTLS 자동화가 핵심 가치

수동으로 20개 서비스 인증서 관리하면:
- 인증서 생성 20번
- 코드 설정 20번
- 갱신 추적 20번
- 새 서비스 추가시 반복

Istio는:
- 자동 발급
- 자동 갱신 (24시간)
- 개발자 개입 0

이게 진짜 큰 장점이다.

### 4. Webhook으로 자동 주입

```
kubectl apply -f myapp.yaml
  → K8s가 Pod 생성 요청
    → Istio Webhook이 가로채기
      → Envoy 컨테이너 추가
        → 2/2 컨테이너로 생성됨
```

YAML 파일 수정 없이도 Sidecar가 붙는 마법이 바로 Webhook이다.

---

## 🔗 다음 편 예고

Part 2에서는 Istio의 아키텍처와 내부 동작 원리를 파헤쳤다.

**Part 3에서는:**

- Istio Gateway로 외부 트래픽 받기

- **JWT 검증을 Gateway에서 하는 이유** ⭐

- Gateway vs Pod 레벨 인증 비교

- 실전: 모바일 앱 API 서버 구성

- RequestAuthentication & AuthorizationPolicy

"왜 모든 서비스 코드에 JWT 검증 로직을 넣지 않고 Gateway에서만 하는가?"라는 질문에 대한 답을 코드 비교와 함께 보겠습니다.

---

## 📚 참고 자료

- [Istio 공식 문서 - Architecture](https://istio.io/latest/docs/ops/deployment/architecture/)
- [Envoy Proxy 공식 문서](https://www.envoyproxy.io/docs/envoy/latest/)
- [Kubernetes Mutating Webhook](https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/)

---

**작성일**: 2025-10-23
**학습 환경**: k3d 로컬 클러스터
**이전 글**: Part 1 - Istio 개념과 Kong 비교
**다음 글**: Part 3 - Gateway와 JWT 인증 실전
