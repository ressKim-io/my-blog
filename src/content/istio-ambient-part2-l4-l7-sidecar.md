---
title: "Istio Ambient Part 2: L4/L7 분리와 Sidecar 아키텍처 비교"
excerpt: "ztunnel과 waypoint의 역할 분담, HBONE 프로토콜, Sidecar 방식과의 상세 비교"
category: "kubernetes"
tags: ["istio", "ambient-mesh", "ztunnel", "waypoint", "l4-l7", "sidecar", "kubernetes"]
series:
  name: "istio-ambient"
  order: 2
date: "2025-12-23"
---

## 🎯 시작하며

Part 1에서 Ambient Mode의 개요를 배웠습니다. 이번에는 **L4/L7 분리**의 핵심 개념과 **Sidecar 아키텍처와의 차이**를 상세히 다룹니다.

이번 Part에서 다루는 핵심 질문들:

1. mTLS가 L4에서 처리된다는 게 무슨 의미?
2. 언제 ztunnel만으로 충분하고, 언제 waypoint가 필요한가?
3. Sidecar 방식과 Ambient 방식의 트래픽 경로 차이는?
4. HBONE 프로토콜은 무엇인가?

---

## 💡 L4 vs L7 처리

### 일상에서 이해하는 L4/L7

L4와 L7의 차이를 우편 시스템에 비유해봅시다.

**L4 (Transport Layer)**는 우편배달부와 같습니다. 봉투에 적힌 주소(IP:Port)만 보고 배달합니다. 봉투 안에 무엇이 들었는지(HTTP 헤더, Body)는 확인하지 않습니다. 빠르고 효율적이지만, "계약서만 배달하고 광고물은 거부"같은 내용 기반 판단은 할 수 없습니다.

**L7 (Application Layer)**는 비서와 같습니다. 봉투를 열어 내용을 확인합니다. "사장님 앞으로 온 편지 중 계약서는 즉시 전달, 광고는 휴지통"같은 내용 기반 분류가 가능합니다. 하지만 모든 편지를 열어보므로 시간이 더 걸립니다.

Ambient Mode는 이 차이를 활용합니다. 대부분의 내부 통신은 "주소만 보고 배달"하면 충분하므로 L4만 처리하는 가벼운 ztunnel을 사용합니다. "내용을 확인해야 하는" 외부 API 트래픽에만 L7을 처리하는 waypoint를 붙입니다.

### OSI 레이어 복습

![OSI Layers](/images/istio-ambient/osi-layers.svg)

| OSI 계층 | Ambient 처리 | 역할 |
|----------|--------------|------|
| L7 (Application/Presentation/Session) | **waypoint** | HTTP 라우팅, 헤더 조작, JWT 인증 |
| L4 (Transport) | **ztunnel** | TCP/UDP, mTLS, IP/포트 기반 정책 |
| L1-L3 (Physical/DataLink/Network) | 네트워크 인프라 | 패킷 전송 |

OSI 7계층 모델에서 네트워크 통신은 계층별로 역할이 나뉩니다. L1-L3는 물리적인 패킷 전송을 담당하고, L4(Transport)는 TCP/UDP 연결을 관리합니다. L7(Application)은 HTTP, gRPC 같은 애플리케이션 프로토콜을 처리합니다.

Istio Ambient Mode의 핵심 아이디어는 이 계층별 역할 분리를 프록시 아키텍처에도 적용하는 것입니다. 기존 Sidecar 방식은 하나의 Envoy가 L4부터 L7까지 모두 처리했습니다. 반면 Ambient Mode는 ztunnel이 L4를, waypoint가 L7을 담당합니다.

왜 이렇게 분리할까요? 실제 서비스 대부분은 mTLS 암호화만 필요하고 HTTP 라우팅 같은 L7 기능은 필요 없습니다. 분리하면 L4만 필요한 서비스는 가벼운 ztunnel만 거치고, L7이 필요한 서비스만 waypoint를 추가로 배포합니다.

### L4 처리 (ztunnel)

| 기능 | 설명 |
|------|------|
| **mTLS** | SPIFFE ID 검증, 트래픽 암호화, 인증서 자동 갱신 |
| **L4 AuthorizationPolicy** | namespace/principal 기반, IP/포트 기반 (헤더/경로 조건 불가) |
| **TCP 메트릭** | 연결 수, 바이트 전송량, 연결 지속시간 |
| **기본 로드밸런싱** | Round Robin, 헬스체크 |

ztunnel은 Node마다 1개씩 DaemonSet으로 배포됩니다. 해당 Node의 모든 Pod 트래픽을 가로채서 L4 레벨 처리를 수행합니다.

가장 중요한 기능은 mTLS입니다. 서비스 간 통신을 자동으로 암호화하고, SPIFFE ID를 통해 상대방 서비스를 인증합니다. 인증서는 Istio가 자동으로 발급하고 갱신하므로 개발자가 신경 쓸 필요가 없습니다.

L4 AuthorizationPolicy는 "어떤 namespace의 서비스가 어떤 서비스에 접근할 수 있는가"를 제어합니다. 예를 들어 "frontend namespace의 Pod만 backend에 접근 가능"이라는 정책을 설정할 수 있습니다. 단, HTTP 헤더나 URL 경로 같은 L7 정보는 사용할 수 없습니다.

### L7 처리 (waypoint)

| 기능 | 설명 |
|------|------|
| **HTTP 라우팅** | 경로 기반 (`/api/v1` → v1), 헤더 기반, 가중치 라우팅 (Canary) |
| **헤더 기반 AuthZ** | `request.headers["x-user-role"] == "admin"`, 경로 조건 |
| **JWT 인증** | JWKS 검증, 클레임 기반 인가 |
| **복원력** | Retry, Timeout, Circuit Breaker |
| **Traffic Mirroring** | Shadow Testing |
| **헤더 조작** | 요청/응답 헤더 추가/제거 |

waypoint는 L7 기능이 필요한 서비스에만 선택적으로 배포합니다. 내부적으로 Envoy 프록시를 사용하며, 기존 Sidecar와 거의 동일한 기능을 제공합니다.

HTTP 라우팅은 URL 경로나 헤더를 보고 트래픽을 분기합니다. `/api/v1/*` 요청은 v1 서비스로, `/api/v2/*` 요청은 v2 서비스로 보내는 식입니다. Canary 배포도 가능해서 "트래픽의 10%만 새 버전으로" 같은 가중치 라우팅을 설정할 수 있습니다.

JWT 인증은 API 게이트웨이에서 자주 사용됩니다. 클라이언트가 보낸 JWT 토큰을 검증하고, 토큰의 클레임 정보를 기반으로 접근 권한을 결정합니다. 예를 들어 "role=admin인 사용자만 /admin/* 경로 접근 가능"이라는 정책을 설정할 수 있습니다.

Retry, Timeout, Circuit Breaker 같은 복원력 기능도 waypoint에서 처리합니다. 서비스가 일시적으로 응답하지 않을 때 자동으로 재시도하거나, 장애가 전파되는 것을 방지합니다.

---

## 🔀 언제 waypoint가 필요한가?

### 결정 흐름도

![Waypoint Decision](/images/istio-ambient/waypoint-decision.svg)

| 요구사항 | 필요한 것 | 예시 |
|----------|-----------|------|
| mTLS + IP/포트 기반 AuthZ | **ztunnel만** | 단순 gRPC 통신, 내부 DB 접근, 메시지 큐 |
| HTTP 라우팅 필요 | **waypoint 필요** | Canary 배포, A/B Testing, 헤더 기반 라우팅 |
| JWT 인증 필요 | **waypoint 필요** | API Gateway, 사용자 인증 |

waypoint 배포 여부를 결정하는 핵심 질문은 "HTTP 프로토콜을 이해해야 하는가?"입니다.

단순한 서비스 간 통신이라면 ztunnel만으로 충분합니다. 예를 들어 백엔드가 데이터베이스에 접근하거나, 마이크로서비스가 메시지 큐에 연결하는 경우입니다. 이런 통신은 mTLS로 암호화하고 "어떤 서비스가 접근 가능한가"만 제어하면 됩니다.

반면 API Gateway나 외부 트래픽을 받는 서비스는 waypoint가 필요합니다. JWT 토큰을 검증하거나, URL 경로에 따라 다른 백엔드로 라우팅하거나, Canary 배포를 해야 하기 때문입니다.

핵심은 "필요한 곳에만 waypoint를 배포"하는 것입니다. 대부분의 내부 서비스는 ztunnel만으로 충분하고, L7 기능이 필요한 진입점 서비스에만 waypoint를 붙이면 리소스를 크게 절약할 수 있습니다.

### 실제 예시

```yaml
# L4 Only - waypoint 불필요
# mTLS + IP 기반 접근 제어만
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: allow-frontend-only
spec:
  selector:
    matchLabels:
      app: backend
  action: ALLOW
  rules:
  - from:
    - source:
        namespaces: ["frontend"]  # L4에서 처리 가능
---
# L7 필요 - waypoint 배포 필요
# 헤더 기반 조건
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: admin-only
spec:
  selector:
    matchLabels:
      app: admin-api
  action: ALLOW
  rules:
  - when:
    - key: request.headers[x-user-role]  # L7 조건!
      values: ["admin"]
```

---

## 🔗 HBONE 프로토콜

### HBONE이란?

**HBONE** = HTTP Based Overlay Network Encapsulation

Ambient Mode에서 ztunnel 간 통신에 사용하는 터널링 프로토콜입니다.

| 특징 | 설명 |
|------|------|
| **HTTP/2 기반** | HTTP CONNECT 메서드로 터널 생성 |
| **mTLS 암호화** | 모든 터널 트래픽 암호화 |
| **다중화** | HTTP/2 multiplexing으로 효율적 연결 관리 |
| **메타데이터** | SPIFFE ID 등 서비스 정보 전달 |

HBONE은 Ambient Mode에서 ztunnel 간 통신을 위해 설계된 터널링 프로토콜입니다. HTTP/2의 CONNECT 메서드를 사용해 터널을 만들고, 그 안에서 원본 트래픽을 mTLS로 암호화해서 전송합니다.

왜 별도의 터널링 프로토콜이 필요할까요? Sidecar 방식에서는 Envoy가 Pod 내부에 있으므로 iptables로 Pod의 모든 트래픽을 가로챌 수 있습니다. 하지만 ztunnel은 Node 레벨에서 동작합니다. Pod A의 트래픽이 Pod B로 가려면 Node A의 ztunnel에서 Node B의 ztunnel로 명시적인 터널을 통해 전달해야 합니다.

HTTP/2 multiplexing 덕분에 하나의 TCP 연결로 여러 스트림을 동시에 처리할 수 있습니다. 수십 개의 Pod가 통신해도 ztunnel 간에는 소수의 연결만 유지하면 되어 효율적입니다.

### 왜 gRPC가 아닌가?

"HTTP/2를 쓴다면 그냥 gRPC를 쓰면 되지 않나?"라는 의문이 생길 수 있습니다. 하지만 HBONE과 gRPC는 목적이 다릅니다.

gRPC는 **애플리케이션 프로토콜**입니다. 서비스 간 RPC(원격 함수 호출)를 위해 설계되었고, 메시지 직렬화(Protobuf)와 서비스 정의가 핵심입니다. gRPC를 사용하려면 클라이언트와 서버가 모두 gRPC 라이브러리를 사용해야 합니다.

HBONE은 **터널링 프로토콜**입니다. 원본 트래픽을 그대로 캡슐화해서 전달하는 것이 목적입니다. ztunnel은 App A가 보낸 트래픽이 HTTP든, gRPC든, 심지어 MySQL 프로토콜이든 상관없이 있는 그대로 터널링합니다. 애플리케이션을 수정할 필요가 없습니다.

또한 gRPC는 L7 프로토콜이므로 메시지를 파싱하고 해석해야 합니다. HBONE은 HTTP/2 CONNECT로 터널만 열고, 그 안의 데이터는 건드리지 않습니다. L4에서 동작하는 ztunnel에 적합한 설계입니다.

**패킷 구조**: `[TCP/IP] [TLS(mTLS)] [HTTP/2 CONNECT] [원본 데이터]`

### HBONE 통신 흐름

![HBONE Flow|tall](/images/istio-ambient/hbone-flow.svg)

1. **eBPF 캡처**: App A의 트래픽을 Node A의 ztunnel이 가로챔
2. **HBONE 캡슐화**: HTTP/2 CONNECT + mTLS로 터널 생성
3. **전송**: 대상 Node의 ztunnel로 암호화된 터널 통해 전송
4. **디캡슐화**: Node B의 ztunnel이 원본 패킷 추출 후 App B로 전달

HBONE 통신은 4단계로 이루어집니다. 먼저 App A가 App B로 요청을 보내면, eBPF가 이 트래픽을 캡처해서 Node A의 ztunnel로 리다이렉트합니다. eBPF는 커널 레벨에서 동작하므로 iptables보다 빠르고 효율적입니다.

Node A의 ztunnel은 원본 패킷을 HBONE 터널로 캡슐화합니다. HTTP/2 CONNECT로 터널을 열고, mTLS로 암호화한 후 Node B의 ztunnel로 전송합니다. 이 과정에서 SPIFFE ID 같은 서비스 메타데이터도 함께 전달됩니다.

Node B의 ztunnel은 HBONE 터널에서 원본 패킷을 추출(디캡슐화)하고, 목적지인 App B로 전달합니다. App A와 App B 입장에서는 직접 통신하는 것처럼 보이지만, 실제로는 두 ztunnel 사이에 암호화된 터널을 통해 안전하게 전달됩니다.

---

## ⚖️ Sidecar vs Ambient 상세 비교

### 아키텍처 비교

![Sidecar vs Ambient Architecture](/images/istio-ambient/sidecar-vs-ambient-arch.svg)

| 구분 | Sidecar | Ambient |
|------|---------|---------|
| **Pod 구조** | App + Envoy Sidecar | App만 (Sidecar 없음) |
| **프록시 위치** | Pod 내부 | Node 레벨 (ztunnel) + 선택적 waypoint |
| **L4/L7 처리** | 같은 Envoy에서 모두 처리 | ztunnel(L4) + waypoint(L7) 분리 |
| **트래픽 인터셉트** | iptables | eBPF |

Sidecar 방식에서는 모든 Pod에 Envoy 프록시가 함께 배포됩니다. `kubectl get pod`를 하면 READY 열이 `2/2`로 표시되는데, 하나는 애플리케이션이고 하나는 Envoy Sidecar입니다. 이 Envoy가 L4부터 L7까지 모든 프록시 기능을 담당합니다.

Ambient 방식에서는 Pod에 Sidecar가 없습니다. READY 열이 `1/1`로 표시되고, 애플리케이션만 실행됩니다. 프록시 기능은 Node 레벨의 ztunnel이 담당합니다. L7 기능이 필요하면 waypoint를 추가로 배포합니다.

트래픽 인터셉트 방식도 다릅니다. Sidecar는 iptables 규칙으로 Pod의 트래픽을 가로챕니다. Ambient는 eBPF를 사용해 커널 레벨에서 더 효율적으로 리다이렉트합니다. eBPF는 iptables보다 CPU 사용량이 적고 레이턴시가 낮습니다.

### 트래픽 경로 비교

![Traffic Path Comparison](/images/istio-ambient/traffic-path-compare.svg)

| 모드 | 경로 | 홉 수 | 특징 |
|------|------|-------|------|
| **Sidecar** | App A → Sidecar → Sidecar → App B | 4 | 양쪽에서 L4+L7 전체 처리 |
| **Ambient (L4)** | App A → ztunnel → ztunnel → App B | 4 | L4만 처리 → 더 빠름 |
| **Ambient (L7)** | App A → ztunnel → waypoint → ztunnel → App B | 5 | L7 필요시에만 waypoint 경유 |

트래픽 경로를 비교하면 Sidecar와 Ambient의 차이가 명확해집니다.

Sidecar 모드에서 App A가 App B를 호출하면, 먼저 App A의 Sidecar(Envoy)를 거칩니다. 여기서 mTLS 암호화, L7 라우팅 등 모든 처리가 이루어집니다. 그 다음 App B의 Sidecar를 거쳐 최종적으로 App B에 도달합니다. 양쪽 Sidecar에서 똑같은 L4+L7 처리를 중복으로 수행합니다.

Ambient L4 모드에서는 ztunnel만 거칩니다. App A의 트래픽이 Node A의 ztunnel로 가고, HBONE 터널을 통해 Node B의 ztunnel로 전달되어 App B에 도착합니다. ztunnel은 L4만 처리하므로 Envoy보다 훨씬 가볍고 빠릅니다.

Ambient L7 모드는 waypoint가 추가되어 홉 수가 하나 늘어납니다. 하지만 모든 트래픽이 waypoint를 거치는 것이 아니라, L7 기능이 필요한 특정 서비스로 가는 트래픽만 waypoint를 경유합니다.

### 리소스 비교

**시나리오**: Pod 100개, Node 5개

| 모드 | 프록시 개수 | CPU | Memory | 절감률 |
|------|-------------|-----|--------|--------|
| **Sidecar** | Envoy 100개 | 10,000m (10 CPU) | 12.8Gi | - |
| **Ambient (L4)** | ztunnel 5개 | 500m (0.5 CPU) | 1.28Gi | CPU 95%, Mem 90% |
| **Ambient (L7)** | ztunnel 5개 + waypoint 2개 | 700m | 1.5Gi | CPU 93%, Mem 88% |

리소스 사용량을 비교하면 Ambient Mode의 장점이 극명하게 드러납니다.

Sidecar 방식에서 100개의 Pod를 운영하면 100개의 Envoy가 필요합니다. Envoy 하나당 보통 100m CPU와 128Mi Memory를 사용하므로, 총 10 CPU와 12.8Gi Memory가 프록시에만 소비됩니다. 이건 클러스터 전체 리소스의 상당 부분을 차지합니다.

Ambient L4 모드에서는 Pod 수와 관계없이 Node 수만큼의 ztunnel만 필요합니다. 5개의 Node에서 100개의 Pod를 운영해도 ztunnel은 5개뿐입니다. 게다가 ztunnel은 Rust로 작성되어 Envoy보다 메모리 효율이 훨씬 좋습니다. 결과적으로 CPU 95%, Memory 90% 절감이 가능합니다.

Ambient L7 모드는 waypoint가 추가되지만 여전히 Sidecar보다 훨씬 효율적입니다. waypoint는 L7 기능이 필요한 서비스에만 배포하므로, 전체 Pod 수가 아닌 L7 필요 서비스 수에 비례합니다.

---

## 🔧 ztunnel 상세

### ztunnel 특징

| 항목 | 설명 |
|------|------|
| **언어** | Rust - 메모리 안전성, C++ 수준 성능, 낮은 메모리 사용 |
| **트래픽 인터셉트** | eBPF - 커널 레벨 리다이렉트, iptables보다 효율적, 낮은 레이턴시 |
| **배포** | DaemonSet - 모든 Node에 1개씩, hostNetwork: true |
| **확장성** | Pod 수와 무관하게 Node 수에만 비례 |

ztunnel은 Ambient Mode의 핵심 컴포넌트입니다. Rust로 작성되어 C++ 수준의 성능을 내면서도 메모리 안전성이 보장됩니다. Envoy가 C++로 작성된 것과 달리, ztunnel은 메모리 누수나 버퍼 오버플로우 같은 문제에서 자유롭습니다.

eBPF(extended Berkeley Packet Filter)를 사용해 커널 레벨에서 트래픽을 리다이렉트합니다. Sidecar 방식의 iptables는 사용자 공간과 커널 공간 사이를 오가며 오버헤드가 발생하지만, eBPF는 커널 내부에서 직접 처리하므로 레이턴시가 훨씬 낮습니다.

DaemonSet으로 배포되어 모든 Node에 1개씩 실행됩니다. `hostNetwork: true` 설정으로 Node의 네트워크 스택에 직접 접근하며, 해당 Node의 모든 Pod 트래픽을 처리합니다. Pod가 100개든 1000개든 ztunnel 수는 Node 수에만 비례합니다.

### ztunnel 모니터링

```bash
# ztunnel Pod 확인
$ kubectl get pods -n istio-system -l app=ztunnel

# ztunnel 로그
$ kubectl logs -n istio-system -l app=ztunnel

# ztunnel 메트릭
$ kubectl exec -n istio-system deploy/ztunnel -- \
    curl localhost:15020/stats/prometheus
```

---

## 📊 정리: L4에서 되는 것 vs L7이 필요한 것

| L4 (ztunnel) - waypoint 불필요 | L7 (waypoint) - waypoint 필요 |
|-------------------------------|------------------------------|
| mTLS (암호화, 인증) | VirtualService 라우팅 |
| SPIFFE ID 검증 | 헤더 기반 라우팅 |
| namespace/principal 기반 AuthZ | 가중치 라우팅 (Canary) |
| IP/포트 기반 AuthZ | 헤더 기반 AuthZ |
| TCP 메트릭 | JWT 인증 |
| 기본 로드밸런싱 | Retry, Timeout, Circuit Breaker |
| | Traffic Mirroring, 헤더 조작, HTTP 메트릭 |

이 표를 기준으로 서비스마다 waypoint 필요 여부를 판단할 수 있습니다.

왼쪽 열의 기능만 필요하면 waypoint 없이 ztunnel만으로 충분합니다. mTLS로 서비스 간 통신을 암호화하고, "frontend namespace의 Pod만 backend에 접근 가능"같은 L4 수준의 접근 제어를 할 수 있습니다. 대부분의 마이크로서비스 내부 통신은 이 정도면 충분합니다.

오른쪽 열의 기능이 하나라도 필요하면 waypoint를 배포해야 합니다. VirtualService로 URL 경로나 헤더 기반 라우팅을 하거나, JWT 토큰을 검증하거나, Canary 배포를 하려면 HTTP 프로토콜을 파싱해야 하기 때문입니다.

실무에서는 보통 API Gateway 역할을 하는 서비스에만 waypoint를 붙이고, 나머지 내부 서비스는 ztunnel만 사용합니다. 이렇게 하면 Istio의 모든 기능을 활용하면서도 리소스를 최소화할 수 있습니다.

---

## 🎯 핵심 정리

| 구분 | ztunnel (L4) | waypoint (L7) |
|------|--------------|---------------|
| **배포** | DaemonSet (Node당 1개) | Deployment (필요시) |
| **언어** | Rust | Envoy (C++) |
| **처리** | mTLS, 기본 AuthZ | 라우팅, JWT, Retry |
| **성능** | 매우 빠름 | Sidecar와 유사 |
| **필수 여부** | 항상 필요 | L7 기능 시에만 |

ztunnel과 waypoint는 역할이 명확하게 분리됩니다.

ztunnel은 Ambient Mode를 사용하면 자동으로 배포됩니다. 별도의 설정 없이 모든 Ambient 메시 트래픽의 L4 처리를 담당합니다. Rust로 작성되어 가볍고 빠르며, eBPF를 통해 효율적으로 트래픽을 가로챕니다.

waypoint는 필요할 때만 명시적으로 배포합니다. `istioctl waypoint apply` 명령으로 특정 namespace나 서비스에 waypoint를 붙일 수 있습니다. Envoy 프록시를 사용하므로 Sidecar와 비슷한 기능과 성능을 가집니다.

### 언제 무엇을 사용?

| 시나리오 | 필요한 것 |
|----------|-----------|
| mTLS만 필요 | ztunnel만 |
| IP 기반 접근 제어 | ztunnel만 |
| HTTP 라우팅 필요 | ztunnel + waypoint |
| JWT 인증 필요 | ztunnel + waypoint |
| Canary 배포 | ztunnel + waypoint |

실제 서비스에서 이 표를 체크리스트처럼 활용할 수 있습니다. 예를 들어 데이터베이스에 접근하는 백엔드 서비스는 mTLS만 있으면 되므로 ztunnel만으로 충분합니다. 반면 외부 API 요청을 받는 서비스는 JWT 인증이나 Rate Limiting이 필요하므로 waypoint를 배포해야 합니다.

처음 Ambient Mode를 도입할 때는 ztunnel만으로 시작하고, L7 기능이 필요한 서비스를 발견할 때마다 waypoint를 추가하는 점진적 접근을 권장합니다. 이렇게 하면 불필요한 리소스 낭비 없이 필요한 기능만 사용할 수 있습니다.

---

## 🔗 다음 편 예고

Part 3에서는 **Sidecar vs Ambient 기능 비교 (2024.12 기준)**를 다룹니다:
- 멀티클러스터 미지원 등 현재 제한사항
- EnvoyFilter 대안
- Ambient 선택 기준

---

## 🔗 참고 자료

- [Istio ztunnel](https://istio.io/latest/docs/ambient/architecture/ztunnel/)
- [Istio waypoint](https://istio.io/latest/docs/ambient/architecture/waypoint/)
- [HBONE Protocol](https://istio.io/latest/docs/ambient/architecture/hbone/)
- [ztunnel Source (Rust)](https://github.com/istio/ztunnel)
