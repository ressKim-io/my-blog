---
title: "Istio Ambient Part 1: Sidecar 없는 Service Mesh"
excerpt: "Istio 1.24 GA된 Ambient Mode - ztunnel과 waypoint로 80-90% 리소스 절감"
category: istio
tags: ["istio", "ambient-mesh", "ztunnel", "waypoint", "service-mesh", "kubernetes"]
series:
  name: "istio-ambient"
  order: 1
date: "2025-12-22"
---

## 🎯 시작하며

지금까지 배운 Istio는 모두 **Sidecar 방식**이었습니다. 각 Pod마다 Envoy Sidecar가 함께 배포되어 트래픽을 처리했죠. 하지만 2024년 11월, Istio 1.24에서 **Ambient Mode**가 정식(GA) 출시되었습니다.

![Sidecar vs Ambient](/images/istio-ambient/sidecar-vs-ambient.svg)

| 구분 | Sidecar Mode | Ambient Mode |
|------|--------------|--------------|
| 프록시 위치 | Pod 내부 (Envoy Sidecar) | Node 레벨 (ztunnel DaemonSet) |
| 프록시 개수 | Pod 수만큼 (10 Pods = 10 Sidecars) | Node 수만큼 (5 Nodes = 5 ztunnels) |
| 트래픽 인터셉트 | iptables | eBPF |
| 리소스 사용 | 높음 | **80-90% 절감** |
| 업그레이드 | Pod 재시작 필요 | Pod 재시작 불필요 |

두 방식의 가장 큰 차이는 **프록시가 어디에 배포되는가**입니다.

Sidecar 방식에서는 모든 Pod에 Envoy 프록시가 주입됩니다. Pod가 100개면 Sidecar도 100개가 필요하죠. 반면 Ambient 방식에서는 Node마다 하나의 ztunnel만 배포됩니다. 5개 Node 클러스터라면 ztunnel은 5개뿐입니다.

트래픽을 가로채는 방식도 다릅니다. Sidecar는 iptables 규칙을 사용하는데, 이는 사용자 공간과 커널 공간을 오가며 오버헤드가 발생합니다. Ambient의 ztunnel은 eBPF를 사용해 커널 레벨에서 직접 트래픽을 리다이렉트하므로 더 효율적입니다.

학습하면서 궁금했던 것들입니다:
- Sidecar 없이 어떻게 mTLS가 가능할까?
- ztunnel과 waypoint는 무엇일까?
- 왜 Ambient를 도입해야 할까?

---

## 💡 Sidecar 방식의 한계

### 리소스 오버헤드

![Sidecar Resource](/images/istio-ambient/sidecar-resource.svg)

**100 Pods 클러스터 기준 (5 Nodes)**

| 구분 | Sidecar Mode | Ambient Mode |
|------|--------------|--------------|
| 프록시 개수 | 100 Sidecars | 5 ztunnels |
| CPU | 1,000m ~ 5,000m | 500m |
| Memory | 12.8Gi ~ 50Gi | 1.28Gi |
| 비고 | Sidecar가 앱보다 리소스를 더 쓸 수 있음 | **80-90% 절감** |

이 숫자가 실제로 의미하는 바를 생각해봅시다.

Sidecar 방식에서 Envoy 하나당 기본 설정으로 CPU 10~50m, Memory 128~512Mi를 사용합니다. 작아 보이지만, Pod 수가 늘어나면 이야기가 달라집니다. 100개 Pod 클러스터에서는 Sidecar만으로 CPU 1~5 코어, 메모리 12.8~50Gi가 필요합니다.

더 심각한 문제는 **Sidecar가 앱보다 리소스를 더 쓰는 상황**입니다. 가벼운 마이크로서비스(CPU 50m, Memory 64Mi)에 Sidecar(CPU 100m, Memory 128Mi)가 붙으면, 프록시가 앱의 2배 리소스를 소비하게 됩니다. 이건 Service Mesh의 가치를 훼손하는 심각한 오버헤드입니다.

Ambient에서는 Node당 1개의 ztunnel만 배포됩니다. 5개 Node에서 Pod가 100개든 1000개든 ztunnel은 5개뿐입니다. Pod 수와 무관하게 일정한 오버헤드만 발생하므로 대규모 클러스터에서 효과가 극대화됩니다.

### 운영 복잡성

| 문제 | 설명 |
|------|------|
| **Injection 관리** | Pod별 inject 결정, 레이블 관리, 롤백 어려움 |
| **업그레이드** | Istio 업그레이드 시 모든 Pod 재시작 필요 (1000 Pods = 1000 재시작) |
| **리소스 튜닝** | Pod마다 Sidecar 리소스 설정 필요, 과소→성능저하, 과대→낭비 |
| **디버깅** | 요청 경로 복잡 (App→Sidecar→Network→Sidecar→App) |

Sidecar 방식의 운영 복잡성은 실제로 겪어보면 더 크게 느껴집니다.

**Injection 관리**부터 까다롭습니다. 어떤 Pod에 Sidecar를 주입할지 결정해야 하고, Namespace나 Pod에 레이블을 붙여야 합니다. 문제가 생겨서 Sidecar를 빼고 싶으면 레이블을 제거하고 Pod를 재시작해야 하는데, 프로덕션에서 이 작업은 부담스럽습니다.

**업그레이드 문제**가 가장 큽니다. Istio 버전을 1.23에서 1.24로 올린다고 가정해봅시다. 새 Envoy 버전을 적용하려면 모든 Pod를 재시작해야 합니다. 1000개 Pod 클러스터에서 Rolling Restart를 하면 수 시간이 걸릴 수 있고, 그 동안 서비스 안정성에 영향을 줄 수 있습니다.

**리소스 튜닝**도 문제입니다. Pod마다 트래픽 패턴이 다르므로 Sidecar 리소스 설정도 달라야 합니다. CPU를 너무 적게 주면 요청이 밀리고, 너무 많이 주면 낭비입니다. Pod 수가 많아지면 이 튜닝 작업이 끝없이 반복됩니다.

Ambient에서는 이런 문제가 대부분 사라집니다. ztunnel은 DaemonSet이므로 업그레이드할 때 애플리케이션 Pod는 건드릴 필요가 없습니다. ztunnel 자체만 Rolling Update하면 됩니다.

---

## 🆕 Ambient Mode 아키텍처

### 핵심 컴포넌트

![Ambient Architecture](/images/istio-ambient/ambient-architecture.svg)

| 컴포넌트 | 배포 방식 | 역할 |
|----------|-----------|------|
| **istiod** | Deployment | Control Plane, 설정 배포 |
| **ztunnel** | DaemonSet (Node당 1개) | L4 처리, mTLS, 기본 AuthZ |
| **waypoint** | Deployment (필요시) | L7 처리, 라우팅, JWT |
| **App Pods** | - | Sidecar 없음 |

Ambient Mode의 핵심 아이디어는 **역할 분리**입니다.

기존 Sidecar는 L4(TCP)와 L7(HTTP)을 모두 처리했습니다. mTLS 암호화도 하고, HTTP 헤더 기반 라우팅도 하고, JWT 검증도 했죠. 그런데 생각해보면, 모든 서비스가 L7 기능을 필요로 하지는 않습니다.

내부 gRPC 통신만 하는 서비스라면 mTLS만 있으면 충분합니다. 굳이 무거운 Envoy가 HTTP 파싱까지 할 필요가 없죠. Ambient는 이 점에 착안해서 역할을 분리했습니다.

**ztunnel**은 모든 Node에 배포되어 L4 처리를 담당합니다. mTLS 암호화/복호화, IP/포트 기반 인가 정책, TCP 메트릭 수집이 ztunnel의 역할입니다.

**waypoint**는 L7 기능이 필요할 때만 선택적으로 배포합니다. HTTP 헤더 기반 라우팅, JWT 인증, Retry/Timeout 같은 기능이 필요한 서비스에만 waypoint를 붙이면 됩니다.

이렇게 하면 대부분의 서비스는 가벼운 ztunnel만 거치고, L7이 필요한 일부 서비스만 waypoint를 경유합니다.

### ztunnel (Zero Trust Tunnel)

![ztunnel Diagram](/images/istio-ambient/ztunnel-diagram.svg)

| 항목 | 설명 |
|------|------|
| **역할** | L4 (TCP) 처리, mTLS, 기본 AuthZ (IP/포트), Telemetry |
| **배포** | DaemonSet (Node당 1개) |
| **언어** | Rust (고성능, 저메모리) |
| **인터셉트** | eBPF로 트래픽 리다이렉트 |

ztunnel은 "Zero Trust Tunnel"의 약자입니다. 이름에서 알 수 있듯이, Zero Trust 보안 모델의 핵심 역할을 합니다.

기술적으로 흥미로운 점은 **Rust로 작성**되었다는 것입니다. Envoy는 C++로 작성되어 있고 수년간 최적화되었지만, 여전히 메모리 사용량이 적지 않습니다. ztunnel은 Rust의 메모리 안전성과 효율성을 활용해 더 적은 리소스로 동작합니다.

트래픽 인터셉트 방식도 다릅니다. Sidecar의 Envoy는 iptables 규칙을 사용하는데, 이는 패킷이 커널 공간과 사용자 공간을 여러 번 오가게 만듭니다. ztunnel은 **eBPF**를 사용해 커널 레벨에서 직접 트래픽을 리다이렉트합니다. 이 차이가 레이턴시 10-30% 감소로 이어집니다.

ztunnel의 역할은 명확합니다:
- **mTLS**: 모든 Pod 간 통신을 자동 암호화하고, SPIFFE ID로 상대방 신원을 검증합니다.
- **L4 AuthorizationPolicy**: IP 주소나 포트 기반의 접근 제어를 적용합니다.
- **Telemetry**: TCP 연결 메트릭을 수집해 Prometheus로 내보냅니다.

### waypoint Proxy

![waypoint Diagram](/images/istio-ambient/waypoint-diagram.svg)

| 항목 | 설명 |
|------|------|
| **역할** | L7 (HTTP) 처리, VirtualService, JWT, Retry/Timeout, Circuit Breaker |
| **배포** | Deployment (필요시에만), Service/Namespace 단위 |
| **L4 Only** | App → ztunnel → App (mTLS만) |
| **L7 Required** | App → ztunnel → **waypoint** → ztunnel → App |

waypoint는 이름 그대로 **경유지** 역할을 합니다. L7 처리가 필요한 트래픽만 waypoint를 거쳐갑니다.

Sidecar 방식에서는 모든 Pod에 Envoy가 있으므로 L7 기능을 어디서든 사용할 수 있었습니다. 하지만 Ambient에서 ztunnel은 L4만 처리하므로, L7 기능이 필요하면 별도의 waypoint를 배포해야 합니다.

waypoint가 처리하는 기능들:
- **VirtualService 라우팅**: HTTP 헤더, URI 경로 기반으로 트래픽을 분배합니다.
- **JWT 인증**: Authorization 헤더의 JWT 토큰을 검증합니다.
- **Retry/Timeout**: HTTP 요청 실패 시 재시도하거나, 타임아웃을 설정합니다.
- **Circuit Breaker**: 연속 실패 시 일시적으로 트래픽을 차단합니다.
- **헤더 기반 AuthorizationPolicy**: HTTP 헤더 값으로 접근을 제어합니다.

waypoint의 배포 단위는 유연합니다. Namespace 전체에 하나의 waypoint를 배포할 수도 있고, 특정 Service에만 전용 waypoint를 배포할 수도 있습니다. 필요한 곳에만 배포하면 되므로, **mTLS만 필요한 서비스는 waypoint 없이 ztunnel만으로 동작**합니다.

이 선택적 배포가 리소스 절감의 핵심입니다. 100개 서비스 중 10개만 L7 기능이 필요하다면, waypoint도 10개만 있으면 됩니다. Sidecar 방식이었다면 100개 모두 무거운 Envoy를 갖고 있어야 했을 것입니다.

---

## 🔧 Ambient Mode 활성화

### Istio 설치 시 Ambient 프로필

```bash
# Ambient 프로필로 설치
$ istioctl install --set profile=ambient

# 또는 기존 설치에 Ambient 추가
$ istioctl install --set profile=default \
    --set components.ztunnel.enabled=true \
    --set values.ztunnel.variant=distroless
```

### Namespace를 Ambient로 전환

```bash
# Namespace에 Ambient 레이블 추가
$ kubectl label namespace default istio.io/dataplane-mode=ambient

# 확인
$ kubectl get namespace default --show-labels
```

기존 Sidecar 방식과 공존 가능합니다:
- `istio-injection=enabled` → Sidecar 방식
- `istio.io/dataplane-mode=ambient` → Ambient 방식

### waypoint 배포

```bash
# Namespace에 waypoint 배포
$ istioctl waypoint apply --namespace default

# 특정 Service에만 waypoint 배포
$ istioctl waypoint apply --namespace default --name reviews-waypoint \
    --for service/reviews
```

```yaml
# 또는 YAML로 직접 배포
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: waypoint
  namespace: default
  labels:
    istio.io/waypoint-for: all  # 또는 service, workload
spec:
  gatewayClassName: istio-waypoint
  listeners:
  - name: mesh
    port: 15008
    protocol: HBONE
```

---

## 📊 트래픽 흐름

### L4 Only (mTLS만 필요한 경우)

![L4 Traffic Flow](/images/istio-ambient/l4-traffic-flow.svg)

- mTLS (SPIFFE ID 검증)
- L4 AuthorizationPolicy
- TCP 메트릭

L4 Only 모드가 Ambient의 기본이자 가장 효율적인 경로입니다.

트래픽 흐름을 따라가봅시다. Pod A에서 Pod B로 요청을 보내면:

1. Pod A의 요청이 나갑니다.
2. Node A의 ztunnel이 이 트래픽을 eBPF로 가로챕니다.
3. ztunnel이 Pod A의 SPIFFE ID로 mTLS 암호화를 수행합니다.
4. 암호화된 트래픽이 네트워크를 통해 Node B로 전달됩니다.
5. Node B의 ztunnel이 트래픽을 받아 mTLS 복호화합니다.
6. Pod B의 SPIFFE ID를 검증하고, L4 AuthorizationPolicy를 확인합니다.
7. 정책을 통과하면 Pod B로 트래픽을 전달합니다.

이 과정에서 **HTTP 헤더를 전혀 파싱하지 않습니다**. TCP 레벨에서 암호화/복호화와 IP 기반 인가만 수행하므로 오버헤드가 최소화됩니다. 대부분의 마이크로서비스 통신은 이 정도면 충분합니다.

### L7 필요 (waypoint 경유)

![L7 Traffic Flow](/images/istio-ambient/l7-traffic-flow.svg)

- VirtualService 라우팅
- 헤더 기반 AuthZ
- JWT 인증
- Retry, Timeout

HTTP 헤더를 봐야 하는 정책이 있다면 waypoint가 필요합니다.

예를 들어 "Authorization 헤더에 유효한 JWT가 있어야 접근 허용"이라는 정책을 적용하려면, 누군가가 HTTP 헤더를 파싱해야 합니다. ztunnel은 L4만 처리하므로 이건 할 수 없고, waypoint가 대신합니다.

L7 트래픽 흐름:

1. Pod A의 요청이 나갑니다.
2. Node A의 ztunnel이 트래픽을 암호화합니다.
3. ztunnel이 목적지 서비스에 waypoint가 있는지 확인합니다.
4. waypoint가 있으면, ztunnel은 트래픽을 **waypoint로 먼저 보냅니다**.
5. waypoint가 HTTP 헤더를 파싱하고 L7 정책을 적용합니다.
6. 정책을 통과하면 waypoint가 트래픽을 Node B의 ztunnel로 전달합니다.
7. Node B의 ztunnel이 Pod B로 트래픽을 전달합니다.

L4 Only보다 홉이 하나 더 늘어나지만, **L7 기능이 필요한 서비스에만 이 경로가 적용**됩니다. 10개 서비스 중 2개만 JWT 검증이 필요하다면, 나머지 8개는 L4 Only로 빠르게 통신합니다.

이것이 Ambient가 효율적인 이유입니다. 모든 트래픽에 무거운 L7 처리를 강제하지 않고, 필요한 곳에만 선택적으로 적용합니다.

---

## 📈 Ambient의 장점

| 장점 | Sidecar | Ambient |
|------|---------|---------|
| **리소스** | 100 Pods × 100 Sidecars = CPU 2000m, Mem 12Gi | 5 Nodes × 5 ztunnels = CPU 500m, Mem 1.2Gi (**80-90% 절감**) |
| **업그레이드** | 모든 Pod 재시작 필요 | Pod 재시작 불필요, ztunnel만 업데이트 |
| **성능** | 메모리 복사 오버헤드 | eBPF 직접 전달, **레이턴시 10-30% 감소** |
| **도입** | 전체 적용 필요 | Namespace 단위 점진적 도입 가능 |

Ambient의 장점을 하나씩 살펴봅시다.

**리소스 절감**이 가장 눈에 띕니다. Sidecar 방식에서 프록시 수는 Pod 수에 비례하지만, Ambient에서는 Node 수에 비례합니다. Pod가 많을수록 절감 효과가 커집니다. 5개 Node에 100개 Pod가 있다면 Sidecar는 100개, ztunnel은 5개입니다. 1000개 Pod로 늘어나도 ztunnel은 여전히 5개입니다.

**성능 향상**도 중요합니다. eBPF는 커널 레벨에서 동작하므로 iptables보다 오버헤드가 적습니다. Sidecar 방식에서는 패킷이 App → Sidecar → Network → Sidecar → App으로 흐르면서 사용자 공간 메모리 복사가 여러 번 발생합니다. Ambient에서는 이 복사가 줄어들어 레이턴시가 10-30% 감소합니다.

**운영 편의성**도 빼놓을 수 없습니다. Istio 업그레이드 시 ztunnel DaemonSet만 업데이트하면 됩니다. 애플리케이션 Pod를 재시작할 필요가 없으므로 다운타임 없이 업그레이드할 수 있습니다.

**점진적 도입**이 가능한 것도 장점입니다. 기존 Sidecar 방식 워크로드와 Ambient 워크로드가 같은 클러스터에서 공존할 수 있습니다. 한 Namespace씩 Ambient로 전환하면서 안정성을 확인할 수 있습니다.

```bash
# 점진적 도입 예시
kubectl label namespace staging istio.io/dataplane-mode=ambient
kubectl label namespace production istio.io/dataplane-mode=ambient
```

---

## ⚠️ 고려사항

### 현재 제한사항 (2024.12 기준)

| 기능 | Sidecar | Ambient |
|------|---------|---------|
| mTLS | ✅ | ✅ |
| L7 라우팅 | ✅ | ✅ (waypoint) |
| JWT 인증 | ✅ | ✅ (waypoint) |
| EnvoyFilter | ✅ | ❌ (1.24 기준) |
| 멀티클러스터 | ✅ | Alpha (1.27+) |
| WASM Plugin | ✅ | ❌ (예정) |

Ambient가 GA되었다고 해서 모든 기능이 Sidecar와 동등한 것은 아닙니다. 현재 상태를 정확히 알아야 도입 결정을 내릴 수 있습니다.

**완전히 지원되는 기능**:
- mTLS 자동 암호화는 ztunnel에서 기본 제공됩니다.
- VirtualService, DestinationRule 같은 L7 라우팅은 waypoint를 통해 지원됩니다.
- JWT 인증, RequestAuthentication도 waypoint에서 동작합니다.

**아직 미지원인 기능**:
- **EnvoyFilter**는 현재 Ambient에서 사용할 수 없습니다. 커스텀 Lua 스크립트나 특수한 Envoy 설정이 필요한 경우 Sidecar를 유지해야 합니다.
- **멀티클러스터** 지원은 Istio 1.27부터 Alpha로 제공됩니다. 아직 프로덕션 환경에서는 Sidecar가 더 안정적입니다.
- **WASM Plugin**도 예정된 기능입니다. Envoy에 커스텀 WASM 필터를 적용하고 싶다면 현재로서는 Sidecar를 써야 합니다.

이런 제한사항을 고려해서 워크로드별로 Sidecar와 Ambient를 혼용할 수 있습니다. 대부분의 서비스는 Ambient로, EnvoyFilter가 필요한 일부 서비스는 Sidecar로 운영하는 전략이 가능합니다.

### 언제 Sidecar를 유지할까?

- EnvoyFilter 커스터마이징 필요
- 멀티클러스터 환경
- 특수한 Envoy 설정 필요

### 언제 Ambient를 선택할까?

- 리소스 절감이 중요
- mTLS + 기본 정책이면 충분
- 신규 프로젝트 시작

---

## 📚 정리

### 컴포넌트

| 컴포넌트 | 역할 | 배포 |
|----------|------|------|
| **ztunnel** | L4 처리 (mTLS, 기본 AuthZ) | Node당 1개 |
| **waypoint** | L7 처리 (라우팅, JWT) | 필요시에만 |

### 장점

- 리소스 80-90% 절감
- Pod 재시작 없이 업그레이드
- 점진적 도입 가능
- 성능 향상 (저레이턴시)

### 활성화 방법

```bash
# Namespace를 Ambient로 전환
kubectl label namespace <ns> istio.io/dataplane-mode=ambient

# L7 기능이 필요한 경우 waypoint 배포
istioctl waypoint apply --namespace <ns>
```

---

## 🎯 핵심 정리

| 항목 | Sidecar | Ambient |
|------|---------|---------|
| **배포** | Pod마다 Sidecar | Node마다 ztunnel |
| **L4 처리** | Envoy Sidecar | ztunnel |
| **L7 처리** | Envoy Sidecar | waypoint (선택적) |
| **리소스** | 높음 | 80-90% 절감 |
| **업그레이드** | Pod 재시작 필요 | Pod 재시작 불필요 |

이 표가 Sidecar와 Ambient의 차이를 요약합니다.

Sidecar 방식에서는 모든 Pod에 Envoy가 주입되어 L4/L7을 모두 처리했습니다. 리소스 오버헤드가 크고, 업그레이드할 때마다 모든 Pod를 재시작해야 했죠.

Ambient는 이 문제를 **역할 분리**로 해결합니다. Node당 하나의 ztunnel이 L4를 담당하고, L7이 필요한 서비스에만 waypoint를 배포합니다. 프록시 수가 Pod 수가 아닌 Node 수에 비례하므로 리소스가 크게 절감됩니다.

2024년 11월 Istio 1.24에서 GA가 되면서 프로덕션 환경에서도 사용할 수 있게 되었습니다. 신규 프로젝트를 시작하거나, 기존 Sidecar 방식의 리소스 부담이 크다면 Ambient를 검토해볼 만합니다.

다만 EnvoyFilter나 멀티클러스터 같은 고급 기능이 필요하다면 Sidecar를 유지해야 합니다. 두 방식을 혼용할 수 있으므로, 워크로드 특성에 따라 선택하면 됩니다.

---

## 🔗 다음 편 예고

Part 2에서는 **L4/L7 분리 상세와 Sidecar 아키텍처 비교**를 다룹니다:
- ztunnel에서 처리되는 것 vs waypoint에서 처리되는 것
- HBONE 프로토콜
- Sidecar 방식과의 상세 비교

---

## 🔗 참고 자료

- [Istio Ambient Mesh](https://istio.io/latest/docs/ambient/)
- [Istio 1.24 Release - Ambient GA](https://istio.io/latest/news/releases/1.24.x/announcing-1.24/)
- [ztunnel Architecture](https://istio.io/latest/docs/ambient/architecture/ztunnel/)
- [waypoint Architecture](https://istio.io/latest/docs/ambient/architecture/waypoint/)
