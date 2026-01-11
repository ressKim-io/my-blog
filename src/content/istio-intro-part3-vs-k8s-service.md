---
title: "Kubernetes Service vs Istio: 뭐가 다른가?"
excerpt: "kube-proxy의 한계, L4 vs L7 로드밸런싱 차이, 그리고 둘 다 필요한가에 대한 답"
category: istio
tags:
  - istio
  - kubernetes
  - kube-proxy
  - load-balancing
  - service-mesh
series:
  name: "istio-intro"
  order: 3
date: "2025-12-08"
---

## 🎯 이전 글 요약

**Part 1**: Service Mesh가 필요한 이유 (라이브러리 vs 인프라 방식)

**Part 2**: Istio 아키텍처 (Control Plane, Data Plane, mTLS 자동화)

Part 3에서는 **Kubernetes Service와 Istio가 어떻게 다른지** 정리해보겠습니다.

---

## 💡 학습 동기

Istio를 공부하면서 가장 헷갈렸던 부분입니다.

**궁금했던 것:**
- Kubernetes에도 Service가 있는데, Istio가 왜 필요해?
- kube-proxy랑 Envoy가 뭐가 다른데?
- 둘 다 로드밸런싱 하는 거 아니야?

결론부터 말하면, **둘은 동작하는 레이어가 다릅니다.**

---

## 📦 Kubernetes Service 복습

먼저 Kubernetes Service가 어떻게 동작하는지 복습해보겠습니다.

### ClusterIP 동작 원리

![Kubernetes Service ClusterIP](/images/istio-intro/k8s-service-clusterip.svg)

| 단계 | 동작 |
|------|------|
| **Pod A** | `curl my-service:8080` 호출 |
| **kube-proxy** | ClusterIP → Pod IP 변환 (랜덤/라운드로빈) |
| **Pod B** | 실제 Pod 중 하나로 요청 전달 |

### kube-proxy가 하는 일

```yaml
# Service 정의
apiVersion: v1
kind: Service
metadata:
  name: my-service
spec:
  selector:
    app: my-app
  ports:
  - port: 8080
    targetPort: 8080
```

kube-proxy가 이걸 보고 iptables 규칙을 생성합니다:

```bash
# 실제 iptables 규칙 (간략화)
-A KUBE-SERVICES -d 10.96.0.100/32 -p tcp --dport 8080 \
    -j KUBE-SVC-XXXXX

-A KUBE-SVC-XXXXX -m statistic --mode random --probability 0.333 \
    -j KUBE-SEP-POD1
-A KUBE-SVC-XXXXX -m statistic --mode random --probability 0.500 \
    -j KUBE-SEP-POD2
-A KUBE-SVC-XXXXX \
    -j KUBE-SEP-POD3
```

**핵심**: kube-proxy는 **L4 (IP + Port)** 레벨에서 동작합니다.

---

## 🤔 kube-proxy의 한계

### 1. L4만 볼 수 있음

![L4 vs L7](/images/istio-intro/l4-vs-l7.svg)

kube-proxy는 L4(Transport Layer)에서 동작합니다. IP, Port, Protocol만 볼 수 있습니다.

문제는 현대 마이크로서비스에서 필요한 라우팅 결정 대부분이 L7 정보에 의존한다는 것입니다. "이 URL로 오면 v2로 보내"나 "이 헤더가 있으면 다른 처리를 해"같은 것들이죠.

Istio의 Envoy는 L7까지 볼 수 있어서 HTTP Method, URL Path, Headers, Body 전부를 기반으로 라우팅 결정을 할 수 있습니다.

### 2. L4만으로는 못하는 것들

![L4 Limitations](/images/istio-intro/l4-limitations.svg)

| 기능 | L4 지원 | 이유 |
|------|---------|------|
| **URL 기반 라우팅** | ❌ | URL을 볼 수 없음 |
| **헤더 기반 라우팅** | ❌ | 헤더 내용을 볼 수 없음 |
| **세밀한 트래픽 분배** | △ | 제한적 (iptables probability) |
| **조건부 재시도** | ❌ | HTTP 상태코드를 볼 수 없음 |
| **JWT 검증** | ❌ | Authorization 헤더를 볼 수 없음 |

---

## 🚀 Istio가 하는 일

Istio(Envoy)는 **L7 레벨**에서 동작합니다.

![Istio L7 Routing](/images/istio-intro/istio-l7-routing.svg)

| 단계 | 동작 |
|------|------|
| **Pod A** | `curl my-service:8080/api/users -H "X-Version: canary"` |
| **Envoy** | HTTP 요청 파싱 (Method, Path, Header 확인) |
| **VirtualService** | 규칙 적용 → X-Version: canary면 v2로 라우팅 |
| **Pod B (v2)** | 요청 수신 |

### Istio로 할 수 있는 것들

```yaml
# URL 기반 라우팅
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: my-service
spec:
  hosts:
  - my-service
  http:
  - match:
    - uri:
        prefix: /api/v1
    route:
    - destination:
        host: my-service-v1
  - match:
    - uri:
        prefix: /api/v2
    route:
    - destination:
        host: my-service-v2
```

```yaml
# 헤더 기반 라우팅 (Canary)
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: my-service
spec:
  hosts:
  - my-service
  http:
  - match:
    - headers:
        x-version:
          exact: canary
    route:
    - destination:
        host: my-service
        subset: v2
  - route:
    - destination:
        host: my-service
        subset: v1
```

```yaml
# 트래픽 비율 분배
- route:
  - destination:
      host: my-service
      subset: v1
    weight: 90
  - destination:
      host: my-service
      subset: v2
    weight: 10
```

---

## ⚖️ kube-proxy vs Istio 비교

| 항목 | kube-proxy | Istio (Envoy) |
|------|------------|---------------|
| **동작 레이어** | L4 (IP + Port) | L7 (HTTP) |
| **로드밸런싱** | 랜덤/라운드로빈 | 다양한 알고리즘 |
| **URL 라우팅** | ❌ | ✅ |
| **헤더 라우팅** | ❌ | ✅ |
| **트래픽 분배** | 제한적 | 세밀한 비율 조절 |
| **재시도/타임아웃** | ❌ | ✅ (조건별 설정) |
| **서킷브레이커** | ❌ | ✅ |
| **mTLS** | ❌ | ✅ 자동 |
| **트레이싱** | ❌ | ✅ 자동 |
| **JWT 검증** | ❌ | ✅ |
| **리소스 사용량** | 적음 | 추가 Sidecar 필요 |

---

## 🤷 둘 다 필요한가?

**예, 둘 다 필요합니다.**

![kube-proxy and Istio Coexist](/images/istio-intro/kube-proxy-istio-coexist.svg)

| 구성 요소 | 역할 |
|----------|------|
| **Kubernetes Service** | ClusterIP/NodePort/LoadBalancer, DNS 매핑, 서비스 디스커버리 |
| **Istio (Envoy)** | L7 기능 (라우팅, 재시도), 보안 (mTLS), 관측성 (메트릭, 트레이싱) |

**결론**: Istio는 kube-proxy를 대체하는 게 아니라 그 위에 올라감

### 실제 트래픽 흐름

![Actual Traffic Flow](/images/istio-intro/actual-traffic-flow.svg)

| 단계 | 동작 |
|------|------|
| **1** | App A: curl my-service:8080 |
| **2** | CoreDNS: my-service → ClusterIP |
| **3** | iptables: 15001로 리다이렉트 |
| **4** | Envoy A: VirtualService 규칙 적용 |
| **5** | Envoy A: 실제 Pod IP로 요청 (mTLS) |
| **6** | Envoy B: 수신, 인가 체크 |
| **7** | App B: 요청 처리 |

**kube-proxy는 언제 쓰이나?** Istio 없는 Pod와 통신할 때, Headless Service 사용할 때

---

## 💡 자주 하는 오해

### 오해 1: "Istio 쓰면 Service 안 만들어도 돼"

**틀렸습니다.** Istio는 Kubernetes Service를 기반으로 엔드포인트를 찾습니다.

```yaml
# 이건 여전히 필요!
apiVersion: v1
kind: Service
metadata:
  name: my-service
spec:
  selector:
    app: my-app
  ports:
  - port: 8080
```

### 오해 2: "VirtualService가 Service를 대체해"

**틀렸습니다.** VirtualService는 라우팅 **규칙**이지, 서비스 **등록**이 아닙니다.

```
Kubernetes Service: "이 Pod들이 my-service야"
VirtualService: "my-service로 오는 요청은 이 규칙대로 처리해"
```

### 오해 3: "Istio 쓰면 kube-proxy 삭제해도 돼"

**위험합니다.** 시스템 컴포넌트(CoreDNS, metrics-server 등)가 여전히 kube-proxy에 의존할 수 있습니다.

---

## 📚 배운 점

### kube-proxy
- L4 레벨 로드밸런싱
- iptables/IPVS 기반
- 단순하고 가볍지만 기능 제한

### Istio (Envoy)
- L7 레벨 트래픽 제어
- HTTP 내용(URL, 헤더, 메서드) 기반 라우팅
- mTLS, 인증/인가, 트레이싱 등 풍부한 기능

### 둘의 관계
- Istio는 kube-proxy를 대체하지 않음
- Kubernetes Service 위에서 L7 기능 추가
- 공존하며 각자 역할 수행

---

## 🔗 다음 시리즈 예고

istio-intro 시리즈는 여기서 마무리합니다.

다음 **istio-security** 시리즈에서는 Zero Trust 보안을 다룹니다:
- mTLS 상세 동작
- SPIFFE 서비스 신원
- AuthorizationPolicy 완전 정복
- JWT 인증 구현

---

## 📖 참고 자료

- [Kubernetes Service 공식 문서](https://kubernetes.io/docs/concepts/services-networking/service/)
- [kube-proxy 모드](https://kubernetes.io/docs/reference/networking/virtual-ips/)
- [Istio Traffic Management](https://istio.io/latest/docs/concepts/traffic-management/)
