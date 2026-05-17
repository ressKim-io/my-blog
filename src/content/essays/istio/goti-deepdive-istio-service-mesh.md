---
title: "Istio 서비스 메시 동작 원리 — Envoy 주입부터 xDS·mTLS까지"
excerpt: "Envoy sidecar가 Pod에 주입되어 iptables로 트래픽을 가로채고, istiod가 xDS 프로토콜로 전 클러스터의 설정을 동기화하며, mTLS 인증서가 자동으로 배포되는 내부 흐름을 설명합니다"
category: istio
tags:
  - go-ti
  - istio
  - envoy
  - xDS
  - service-mesh
  - mTLS
  - concept
series:
  name: "goti-deepdive-istio"
  order: 1
date: "2026-03-14"
---

## 한 줄 요약

> Istio는 Envoy를 Pod마다 주입하고 iptables로 트래픽을 투명하게 가로채며, istiod가 xDS 프로토콜로 모든 Envoy에 설정을 실시간 push해 애플리케이션 코드 수정 없이 L7 트래픽 제어·보안·관측성을 제공합니다

---

## 🤔 무엇을 푸는 기술인가

MSA 전환 초기에 공통으로 마주치는 문제가 있습니다 서비스 수가 늘어날수록 인증·암호화·재시도·타임아웃·분산 트레이싱 같은 횡단 관심사(cross-cutting concern)를 각 서비스마다 직접 구현해야 합니다 Java 서비스에서는 Resilience4j, Spring Security, Micrometer를 조합하고, Go 서비스에서는 별도 라이브러리를 선택하는 방식이 전형적입니다 서비스가 10개를 넘으면 설정 분산과 버전 불일치가 필연적으로 발생합니다

**서비스 메시**는 이 문제를 인프라 계층에서 해결합니다 각 서비스 프로세스 옆에 프록시를 두고, 모든 네트워크 트래픽을 이 프록시가 중계하도록 만드는 방식입니다 애플리케이션은 자신이 프록시 뒤에 있다는 사실조차 알 필요가 없습니다

Istio는 그 프록시로 **Envoy**를 사용하고, 프록시 집합의 설정을 중앙에서 관리하는 **istiod**(제어 평면)를 제공합니다 Envoy들의 집합이 **데이터 평면**, istiod가 **제어 평면**입니다

---

## 🔧 동작 원리

### Envoy sidecar 주입 — 어떻게 Pod에 들어가는가

Istio를 설치하면 Kubernetes에 **MutatingAdmissionWebhook**이 등록됩니다 특정 네임스페이스에 `istio-injection: enabled` 레이블이 붙으면, 그 네임스페이스의 모든 Pod 생성 요청이 Kubernetes API Server를 거치면서 이 webhook을 통과합니다

webhook은 Pod 스펙을 수정해 두 가지를 추가합니다

- **`istio-init` initContainer**: Pod 기동 전 iptables 규칙을 설치하는 역할
- **`istio-proxy` sidecar 컨테이너**: 실제 Envoy 프로세스

이 과정은 완전히 자동입니다 Deployment YAML에 한 줄도 추가하지 않아도 네임스페이스 레이블만으로 주입이 이루어집니다

```yaml
# 네임스페이스에 sidecar 자동 주입 활성화
apiVersion: v1
kind: Namespace
metadata:
  name: goti
  labels:
    istio-injection: enabled
```

### iptables 리디렉션 — 트래픽을 투명하게 가로채는 방법

`istio-init` initContainer가 완료되고 나면 Pod의 네트워크 네임스페이스 안에 iptables 규칙이 설치되어 있습니다 이 규칙의 핵심은 다음 두 가지입니다

- **아웃바운드**: 앱 컨테이너가 보내는 모든 TCP 트래픽을 Envoy의 **15001 포트**로 리디렉션
- **인바운드**: 외부에서 들어오는 모든 TCP 트래픽을 Envoy의 **15006 포트**로 리디렉션

Envoy 자신이 내보내는 트래픽은 UID 1337(istio-proxy 프로세스의 UID) 조건으로 예외 처리합니다 이를 통해 무한 루프가 방지됩니다

앱 컨테이너 입장에서는 평소처럼 `localhost:8080`에 요청이 들어오고 `service-b:8080`에 연결을 맺는 것처럼 보입니다 iptables 수준에서 가로채는 구조이기 때문에 애플리케이션 코드는 Envoy의 존재를 알지 못합니다

![Pod 내부 Envoy sidecar 주입과 iptables 트래픽 리디렉션 구조|tall](/diagrams/goti-deepdive-istio-service-mesh-1.svg)

위 다이어그램에서 왼쪽의 **iptables 영역**이 트래픽을 중개하는 전환점입니다 앱 컨테이너(초록)에서 나오는 아웃바운드 트래픽은 iptables를 거쳐 Envoy sidecar(보라)의 15001 포트로 리디렉션됩니다 외부 클라이언트에서 들어오는 인바운드 트래픽은 마찬가지로 iptables를 거쳐 Envoy의 15006 포트로 향합니다

Envoy가 트래픽을 처리한 뒤에야 앱 컨테이너로 전달됩니다 mTLS 핸드셰이크, JWT 검증, 라우팅 규칙 적용, 메트릭 수집이 이 단계에서 모두 이루어집니다 앱 코드는 8080 포트에서 평범하게 HTTP 요청을 받는다고 인식하지만, 실제로는 Envoy가 이미 검증과 암호화를 처리한 트래픽이 전달된 것입니다

Envoy 자신의 트래픽이 UID 1337 예외 처리로 루프에 빠지지 않는다는 점, 그리고 `istio-init`이 Pod 시작 시 딱 한 번 이 규칙을 설치한다는 점이 구조적으로 중요합니다

### 데이터 평면 vs 제어 평면 — 역할 분리

**데이터 평면**은 실제 패킷을 처리하는 Envoy들의 집합입니다 각 Envoy는 인바운드·아웃바운드 트래픽을 처리하고, L7 정책(라우팅·재시도·Circuit Breaker)을 적용하며, 메트릭과 트레이싱 데이터를 생성합니다

**제어 평면**은 istiod 하나로 통합됩니다 istiod는 과거 Pilot·Citadel·Galley가 각각 맡던 역할을 단일 프로세스에서 담당합니다

| 구성 요소 | istiod 내 역할 | 담당 기능 |
|---|---|---|
| Pilot | 서비스 발견 및 설정 배포 | xDS API 서버, Kubernetes 리소스 watch |
| Citadel | 인증서 CA | mTLS 인증서 발급·rotation |
| Galley | 설정 검증 | CRD 유효성 검사 |

istiod는 Kubernetes API Server를 watch해 `VirtualService`, `DestinationRule`, `Service`, `Endpoints` 리소스 변경을 실시간으로 감지합니다 변경이 감지되면 이를 xDS 형식으로 변환해 연결된 모든 Envoy에 push합니다

### xDS 프로토콜 — 설정이 Envoy에 전달되는 방법

xDS는 eXtensible Discovery Service의 약자로, Envoy가 설정을 동적으로 수신하는 API 집합입니다 istiod와 각 Envoy는 **gRPC long-polling 연결**을 유지합니다

xDS는 다음 네 가지 하위 API로 구성됩니다

| API | 이름 | 전달 내용 | 예시 |
|---|---|---|---|
| LDS | Listener Discovery Service | 포트별 리스너 정의 | 포트 8080 인바운드 리스너 |
| RDS | Route Discovery Service | HTTP 라우팅 규칙 | `/api/v1/*` → `backend` 클러스터 |
| CDS | Cluster Discovery Service | 업스트림 클러스터 목록 | `goti-user.default.svc.cluster.local` |
| EDS | Endpoint Discovery Service | 클러스터의 실제 Pod IP/포트 | `10.0.1.5:8080`, `10.0.1.6:8080` |

Envoy가 처음 시작하면 istiod에 gRPC 연결을 맺고 이 네 가지 API를 구독합니다 설정이 변경될 때마다 istiod가 변경 사항을 스트리밍으로 전달하고, Envoy는 실행 중에 설정을 핫 리로드합니다 **서비스 재시작 없이 라우팅 규칙, 인증 정책, 클러스터 엔드포인트가 갱신**됩니다

`VirtualService`와 `DestinationRule` CRD가 어떻게 Envoy 설정으로 변환되는지 보면 다음과 같습니다

```yaml
# VirtualService — RDS 라우팅 규칙으로 변환됨
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: goti-ticket
spec:
  hosts:
    - goti-ticket
  http:
    - match:
        - uri:
            prefix: "/api/v1"
      route:
        - destination:
            host: goti-ticket
            subset: v2
          weight: 90
        - destination:
            host: goti-ticket
            subset: v1
          weight: 10
```

이 YAML을 적용하면 istiod가 감지하고, 관련 서비스로 향하는 모든 Envoy의 RDS를 갱신합니다 `v2`로 90%, `v1`으로 10% 트래픽이 분산되는 라우팅 규칙이 클러스터 전체 Envoy에 즉시 반영됩니다

```yaml
# DestinationRule — CDS 클러스터 정책으로 변환됨
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: goti-ticket
spec:
  host: goti-ticket
  subsets:
    - name: v1
      labels:
        version: v1
    - name: v2
      labels:
        version: v2
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 100
    outlierDetection:
      consecutiveErrors: 5
      interval: 30s
      baseEjectionTime: 30s
```

`DestinationRule`은 CDS 레벨에서 클러스터 정의와 Circuit Breaker 설정으로 변환됩니다

![istiod 제어 평면과 xDS로 연결된 데이터 평면 전체 구조|tall](/diagrams/goti-deepdive-istio-service-mesh-2.svg)

위 다이어그램은 제어 평면과 데이터 평면의 역할 분리를 보여줍니다 상단 **제어 평면** 영역에서 istiod는 Kubernetes API를 watch해 CRD 변경을 읽고(파란 화살표), 보라색 점선으로 표현된 xDS push를 통해 하단 데이터 평면의 각 Envoy sidecar에 설정을 내립니다 오른쪽 인증서 CA(Citadel)는 istiod 내부에 통합되어 있으며, mTLS에 필요한 x.509 인증서를 각 Envoy에 자동 배포합니다

하단 **데이터 평면** 영역의 Pod A·B·C는 각각 앱 컨테이너와 Envoy sidecar 쌍으로 구성됩니다 Pod A의 Envoy가 보유한 LDS·RDS·CDS·EDS 설정이 모두 istiod의 xDS push로 채워진 것입니다 Pod A → Pod B 간 트래픽(초록 화살표)은 양 Envoy 사이에서 mTLS로 자동 암호화됩니다 앱 컨테이너는 이 암호화 과정을 인식하지 않습니다

istiod가 재시작되더라도 Envoy는 마지막으로 받은 xDS 설정을 메모리에 캐시하고 있어 기존 트래픽 처리가 유지됩니다 다만 신규 서비스 등록, Pod IP 변경, CRD 정책 수정은 istiod가 복구된 뒤에야 반영됩니다

### mTLS 자동 인증서 관리

Istio에서 서비스 간 mTLS는 수동 인증서 설정 없이 자동으로 작동합니다 그 핵심은 **SPIFFE(Secure Production Identity Framework For Everyone)** 기반의 서비스 아이덴티티입니다

istiod 내 CA(Citadel)가 각 Envoy에게 **x.509 인증서**를 발급합니다 인증서의 SAN(Subject Alternative Name)에 다음 형식의 SPIFFE URI가 포함됩니다

```text
spiffe://<trust-domain>/ns/<namespace>/sa/<service-account>
```

예를 들어 `goti` 네임스페이스의 `ticket-service` ServiceAccount를 가진 Pod의 Envoy는 다음 아이덴티티를 얻습니다

```text
spiffe://cluster.local/ns/goti/sa/ticket-service
```

Envoy는 TLS handshake 시 이 인증서로 자신을 증명하고, 상대 Envoy의 인증서도 검증합니다 인증서는 기본 24시간마다 자동으로 rotation됩니다 개발자는 cert-manager를 따로 설치하거나 인증서 갱신 스크립트를 작성할 필요가 없습니다

`PeerAuthentication` CRD로 메시 전체 또는 특정 네임스페이스의 mTLS 모드를 선언합니다

```yaml
# 네임스페이스 전체 STRICT mTLS — mTLS 없는 트래픽 거부
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: default
  namespace: goti
spec:
  mtls:
    mode: STRICT
```

`STRICT` 모드에서는 Envoy sidecar가 없는 클라이언트(레거시 서비스)의 평문 HTTP 요청이 거부됩니다 `PERMISSIVE` 모드는 평문과 mTLS를 동시에 허용해 점진적 마이그레이션에 활용합니다

---

## 📐 세부 동작과 옵션

### xDS 구독 방식 — Push vs Pull

Envoy는 istiod와 **단방향 gRPC 스트리밍** 연결을 유지합니다 istiod가 설정 변경을 감지하면 해당 Envoy에게 갱신 메시지를 push합니다 Envoy가 주기적으로 istiod에 폴링하는 구조가 아닙니다

이 차이가 실시간성에 중요합니다 `VirtualService`를 수정하고 수 초 이내에 클러스터 전체 Envoy에 변경이 전파됩니다 배포 없이 트래픽 정책이 즉시 반영되는 이유입니다

### Envoy 필터 체인 — 기능이 붙는 방식

Envoy의 L7 기능은 **필터 체인(Filter Chain)** 구조로 구성됩니다 인바운드/아웃바운드 각각의 리스너에 필터가 순서대로 적용됩니다

| 필터 | CRD 연결 | 기능 |
|---|---|---|
| JWT AuthN 필터 | RequestAuthentication | JWT 서명 검증, claims 추출 |
| RBAC 필터 | AuthorizationPolicy | principals·namespace·경로 기반 접근 제어 |
| Router 필터 | VirtualService | 가중치 라우팅, Fault Injection, 재시도 |
| Circuit Breaker | DestinationRule | 연결 풀 제한, outlier detection |
| TLS inspector | PeerAuthentication | mTLS handshake |

이 필터들은 istiod가 xDS로 Envoy에 주입하는 설정입니다 CRD를 추가하거나 수정하면 관련 필터 체인이 자동으로 갱신됩니다

### Pilot-agent와 Envoy 기동 순서

`istio-proxy` 컨테이너 안에는 Envoy 외에 **pilot-agent** 프로세스도 함께 실행됩니다 pilot-agent의 역할은 다음과 같습니다

- Envoy 프로세스 시작 및 모니터링
- istiod로부터 초기 xDS 설정 부트스트랩 수신
- 인증서 파일 관리 (SDS — Secret Discovery Service)
- `/healthz/ready` 헬스체크 엔드포인트 제공

Pod 기동 순서는 다음과 같습니다

```text
1. istio-init (initContainer) — iptables 규칙 설치
2. pilot-agent 시작 → istiod에서 부트스트랩 설정 수신
3. Envoy 시작 → pilot-agent를 통해 xDS 구독 시작
4. 앱 컨테이너 시작 → 이미 Envoy가 준비된 상태
```

앱 컨테이너가 뜨기 전에 Envoy가 먼저 준비되는 순서가 보장됩니다

---

## 🧩 go-ti에서는

go-ti는 `goti` 네임스페이스에 `istio-injection: enabled` 레이블을 적용해 Istio Sidecar 모드로 운영했습니다 `goti-server`(Java/Spring)·`user-service`·`ticket-service` 등 모든 서비스가 코드 수정 없이 Envoy sidecar를 자동으로 획득했습니다

`PeerAuthentication` STRICT 모드로 네임스페이스 전체의 서비스 간 통신을 mTLS로 강제했습니다 cert-manager나 수동 인증서 관리 없이 istiod CA가 24시간 rotation을 처리했습니다 `VirtualService`로 카나리 배포와 Fault Injection을 선언적으로 관리했고, 변경 사항이 ArgoCD GitOps 워크플로우에서 CRD YAML로 추적됩니다

Grafana Tempo의 워터폴 뷰에서 서비스 간 호출 체인이 정상적으로 표시된 것은 Envoy가 OTLP trace를 자동으로 생성하고 전파한 결과였습니다 Sidecar 모드를 선택한 가장 큰 이유이기도 했습니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [Istio 서비스 메시 도입 ADR — Linkerd·Cilium 대비 올인원 선택](/essays/goti-adr-istio-service-mesh)에 정리했습니다

---

## 📚 핵심 정리

- **MutatingAdmissionWebhook이 자동 주입의 진입점입니다** 네임스페이스 레이블 하나로 이후 생성되는 모든 Pod에 Envoy sidecar와 iptables 규칙이 투명하게 삽입됩니다
- **iptables REDIRECT가 투명성의 열쇠입니다** 앱 코드는 프록시를 인식하지 않아도 모든 트래픽이 Envoy를 경유합니다 Envoy 자신의 트래픽은 UID 1337 예외로 루프를 방지합니다
- **istiod와 Envoy는 xDS gRPC 스트리밍으로 실시간 동기화됩니다** LDS·RDS·CDS·EDS 네 API가 리스너·라우팅·클러스터·엔드포인트를 각각 담당하며, CRD 변경이 수 초 이내에 전 클러스터 Envoy에 반영됩니다
- **mTLS는 SPIFFE 아이덴티티 기반으로 자동화됩니다** istiod CA가 각 Envoy에 x.509 인증서를 발급하고 24시간마다 자동 rotation합니다 개발자의 인증서 관리 작업이 없습니다
- **제어 평면 장애가 즉각적 서비스 중단을 의미하지는 않습니다** Envoy는 마지막 xDS 설정을 캐시해 기존 트래픽을 계속 처리합니다 단, 신규 서비스 등록과 정책 변경은 istiod 복구 후에야 반영됩니다
