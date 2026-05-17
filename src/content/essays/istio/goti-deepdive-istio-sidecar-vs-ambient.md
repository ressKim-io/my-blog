---
title: "Istio 데이터 플레인 — Sidecar와 Ambient의 내부 동작 차이"
excerpt: "Pod마다 Envoy를 주입하는 Sidecar 모드와 노드별 ztunnel·네임스페이스별 Waypoint로 분리한 Ambient 모드가 각각 어떻게 트래픽을 처리하고, L7 파싱 위치·관측성·리소스 비용 측면에서 무엇을 트레이드오프하는지 설명합니다"
category: istio
tags:
  - go-ti
  - istio
  - sidecar
  - ambient
  - ztunnel
  - envoy
  - concept
series:
  name: "goti-deepdive-istio"
  order: 2
date: "2026-03-14"
---

## 한 줄 요약

> Sidecar 모드는 Pod마다 Envoy를 주입해 L4·L7을 한 프록시에서 처리하고, Ambient 모드는 노드 ztunnel(L4)과 네임스페이스 Waypoint(L7)를 분리해 오버헤드를 줄이되 관측성 완성도를 일부 희생합니다

---

## 🤔 무엇을 푸는 기술인가

서비스 메시는 애플리케이션 코드 변경 없이 서비스 간 통신에 mTLS, 트래픽 정책, 관측성을 제공합니다 이 기능들은 모두 **데이터 플레인**이 처리합니다 컨트롤 플레인(`istiod`)이 정책을 정의하고 배포하면, 데이터 플레인이 실제 패킷 경로 위에서 그 정책을 집행합니다

데이터 플레인의 핵심 질문은 하나입니다

> 프록시를 어디에 두어야 모든 트래픽을 투명하게 가로챌 수 있는가

Istio는 이 질문에 두 가지 다른 방식으로 답합니다 첫 번째가 **Sidecar 모드**, 두 번째가 **Ambient 모드**입니다 두 모드의 차이는 단순한 구성 옵션이 아니라, 프록시 배치 위치와 L7 처리 경계가 근본적으로 다른 아키텍처입니다

---

## 🔧 동작 원리

### Sidecar 모드 — Pod마다 Envoy 주입

Sidecar 모드에서 Envoy 프록시는 각 Pod 안에 컨테이너로 주입됩니다 네임스페이스에 `istio-injection: enabled` 레이블을 붙이거나, Pod에 `sidecar.istio.io/inject: "true"` 어노테이션을 달면 `istio-proxy` 컨테이너가 자동으로 추가됩니다

**트래픽 리디렉션 메커니즘**은 `iptables` 규칙으로 동작합니다 Pod가 생성될 때 `istio-init` initContainer가 먼저 실행되어 iptables 규칙을 설정합니다 이 규칙은 모든 인바운드 트래픽을 포트 15006(inbound)으로, 모든 아웃바운드 트래픽을 포트 15001(outbound)로 강제 리디렉션합니다

![Sidecar 모드 트래픽 흐름 — iptables 리디렉션과 Envoy 처리 단계|tall](/diagrams/goti-deepdive-istio-sidecar-vs-ambient-2.svg)

위 다이어그램은 외부 요청이 Pod 안을 통과하는 5단계를 보여줍니다 ➊ 외부에서 들어온 HTTP/gRPC 패킷은 iptables 규칙에 의해 포트 15006으로 강제 리디렉션됩니다 ➋ **Envoy inbound**가 mTLS를 종료하고 L7 파싱을 수행하며 Prometheus 메트릭·트레이스 Span을 기록합니다 ➌ 파싱된 요청이 **App Container**로 전달되어 비즈니스 로직이 실행됩니다 ➍ 응답은 iptables를 통해 포트 15001의 **Envoy outbound**로 리디렉션되어 DestinationRule 적용·mTLS 암호화가 이루어집니다 ➎ 암호화된 패킷이 **원격 Pod의 Envoy inbound**에 도달해 다시 mTLS가 종료됩니다

이 구조의 핵심은 App Container가 Envoy를 전혀 인식하지 못한다는 점입니다 앱은 평소와 동일한 소켓으로 바인딩하고 연결을 맺지만, 커널 레벨에서 패킷이 투명하게 Envoy로 향합니다

**L7 파싱 위치**는 Envoy 프록시 내부입니다 HTTP 메서드, 경로, 상태 코드, 헤더 같은 L7 정보를 Envoy가 직접 파싱합니다 이 덕분에 다음이 모두 자동으로 처리됩니다

- `istio_requests_total` (method, response_code, destination_service 포함) Prometheus 메트릭 자동 생성
- 분산 트레이스 Span 생성 및 `traceparent` 헤더 전파
- Access Log에 HTTP 상세 정보 기록

**리소스 비용**은 Pod별로 발생합니다 Envoy는 기본적으로 CPU 0.1~0.5 코어, Memory 50~150 MiB 수준을 소모합니다 Pod 100개 클러스터에서 Sidecar는 사실상 200개의 Envoy 프로세스가 동시에 동작하는 것과 같습니다

### Ambient 모드 — ztunnel(L4) + Waypoint(L7) 분리

Ambient 모드는 "프록시를 Pod 안에 두지 않아도 트래픽을 가로챌 방법이 있다"는 관찰에서 출발합니다 대신 두 종류의 프록시를 Pod 바깥에 배치합니다

**ztunnel**은 `DaemonSet`으로 배포됩니다 노드마다 하나의 ztunnel 프로세스가 존재하고, 그 노드에서 실행 중인 모든 Ambient 네임스페이스 Pod의 트래픽을 처리합니다 ztunnel이 처리하는 범위는 **L4** — TCP 연결, mTLS 암호화·복호화, 기본적인 연결 단위 메트릭(바이트 수, 연결 수)입니다

트래픽 리디렉션은 `iptables` 대신 **HBONE(HTTP-Based Overlay Network Encapsulation)** 터널을 사용합니다 Pod에서 나온 패킷이 HBONE 터널로 ztunnel에게 전달되고, ztunnel이 mTLS를 적용해 원격 노드의 ztunnel로 전송합니다 L4만 경유하는 기본 경로는 `App Container → ztunnel(현재 노드, HBONE mTLS 암호화) → ztunnel(원격 노드, mTLS 복호화) → App Container`입니다

**Waypoint Proxy**는 L7 처리 담당입니다 ztunnel과 달리 Waypoint는 선택적입니다 네임스페이스나 서비스 어카운트 단위로 배포하며, L7 정책(AuthorizationPolicy HTTP 조건, VirtualService 라우팅, Circuit Breaker 등)이 필요할 때만 생성합니다 Waypoint 내부는 Envoy이므로, Waypoint가 있는 경로에서는 Sidecar와 동등한 L7 처리가 가능합니다

L7 기능이 필요한 요청은 ztunnel 사이에 Waypoint가 추가로 개입합니다 `App Container → ztunnel(현재 노드) → Waypoint Proxy(L7 파싱·AuthPolicy·VirtualService 적용) → ztunnel(원격 노드) → App Container` 순으로 처리됩니다 Waypoint가 없는 경로와 달리 중간에 L7 Envoy가 삽입되는 구조입니다

![Sidecar 모드 vs Ambient 모드 데이터 플레인 구조 비교|tall](/diagrams/goti-deepdive-istio-sidecar-vs-ambient-1.svg)

위 다이어그램에서 두 모드의 구조적 차이를 볼 수 있습니다

왼쪽 **Sidecar 모드**에서는 Pod A, Pod B, Pod C 모두 내부에 Envoy Sidecar 컨테이너를 갖고 있습니다 App Container의 트래픽은 iptables 규칙에 의해 Envoy로 강제 리디렉션됩니다 Pod 간 통신도 각 Pod의 Envoy끼리 mTLS를 직접 협상합니다 L4와 L7 처리가 Envoy 하나에서 이루어지므로 트래픽이 Envoy를 통과하기만 하면 즉시 HTTP 메트릭과 트레이스 Span이 생성됩니다

오른쪽 **Ambient 모드**에서는 Pod D, Pod E, Pod F 모두 내부에 프록시가 없습니다 대신 노드 상단에 ztunnel(DaemonSet)이 위치하고 HBONE 터널을 통해 각 Pod의 트래픽을 수집합니다 L7 기능이 필요한 경우에만 Waypoint Proxy가 중간에 개입합니다 Waypoint가 없는 경로에서는 ztunnel의 L4 처리만 이루어지므로 HTTP 수준 정보는 수집되지 않습니다

---

## 📐 세부 동작과 옵션

### L7 파싱 위치와 관측성 완성도

두 모드의 관측성 차이는 L7 파싱이 어디서 이루어지는가에서 비롯됩니다

| 관측 항목 | Sidecar | Ambient (ztunnel만) | Ambient + Waypoint |
|---|---|---|---|
| TCP 바이트·연결 메트릭 | 있음 | 있음 | 있음 |
| HTTP 메서드·경로·상태코드 메트릭 | **자동** | **없음** | Waypoint에서 수집 |
| 분산 트레이스 Span 생성 | **자동** | **없음** | 부분적 — workload name 누락 |
| OTLP trace export | 있음 (Envoy 네이티브) | 없음 | Waypoint Envoy에서만 |
| Access Log (HTTP 상세) | 있음 | TCP 레벨만 | 있음 |
| mTLS 자동 적용 | 있음 | 있음 | 있음 |

Waypoint를 추가해도 완전한 동등성에 미치지 못하는 지점이 있습니다 **분산 트레이싱에서 workload name 누락** 문제입니다

Sidecar 모드에서는 각 Pod의 Envoy가 해당 Pod의 서비스 이름을 Span 속성에 기록합니다 Grafana Tempo 워터폴 뷰에서 `user-service`, `ticketing-service` 같은 정확한 워크로드 이름으로 Span이 표시됩니다

Ambient + Waypoint에서는 ztunnel과 Waypoint가 각각 Span을 생성하면서 **텔레메트리 이중 엣지** 문제가 발생합니다 같은 트래픽이 ztunnel과 Waypoint 양쪽에서 보고되어 트래픽 그래프가 왜곡될 수 있습니다 또한 Waypoint는 네임스페이스 단위로 배포되는 공유 프록시이기 때문에, Span에 개별 워크로드 이름 대신 Waypoint 프록시 식별자가 찍힙니다

### 리소스 비용 구조 차이

Sidecar의 리소스 비용은 **Pod 수에 선형 비례**합니다 Pod가 늘어날수록 동일한 비율로 메모리·CPU가 증가합니다 Pod 500개라면 Envoy 프로세스도 500개가 동작합니다

Ambient의 리소스 비용은 **노드 수와 Waypoint 수의 합산**입니다 ztunnel은 노드당 하나이므로 Pod 증가에 거의 무관합니다 노드 20개 클러스터에서 ztunnel은 20개뿐입니다 Waypoint가 없는 경우 리소스 절감이 가장 극적이며, Istio 공식 자료 기준 메모리 70~90% 절감을 이야기합니다

그러나 Waypoint를 모든 네임스페이스에 배포하면 이 이점이 줄어듭니다 Waypoint도 Envoy이므로 그에 상응하는 리소스가 필요합니다

### 마이그레이션 경로

Sidecar 모드에서 Ambient 모드로의 전환은 네임스페이스 단위로 점진적으로 가능합니다 Istio 1.22 이후 동일 클러스터 내에서 Sidecar 네임스페이스와 Ambient 네임스페이스를 혼용할 수 있습니다

전환 순서는 다음과 같습니다

```bash
# 1. 네임스페이스를 Ambient 모드로 전환
kubectl label namespace default istio.io/dataplane-mode=ambient

# 2. Sidecar 어노테이션 제거 (또는 그대로 두면 Sidecar가 우선)
kubectl annotate namespace default istio-injection-

# 3. L7 기능이 필요하면 Waypoint 배포
istioctl waypoint apply --enroll-namespace --wait
```

단, 트레이스 워크로드 이름 누락, 이중 엣지 메트릭 같은 관측성 차이는 마이그레이션 전에 반드시 검증해야 합니다

---

## 🧩 go-ti에서는

go-ti 프로젝트는 **Sidecar 모드**를 선택했습니다 결정의 핵심은 관측성이었습니다 Grafana Tempo 워터폴 뷰에서 `user-service`, `ticketing-service`, `goti-gateway` 같은 정확한 워크로드 이름으로 Span이 표시되어야 병목 지점과 지연 원인을 즉시 파악할 수 있습니다 Ambient + Waypoint 구성에서는 workload name 누락과 텔레메트리 이중 엣지 문제가 해결되지 않아 이 요건을 충족할 수 없었습니다

Ambient 모드의 리소스 절감(70~90%)은 분명한 장점이지만, 모니터링이 불가능하면 티켓팅 서비스의 장애 추적과 성능 계획 수립이 불가능합니다 ztunnel에서 L7 HTTP 파싱을 지원하는 기능은 커뮤니티 Istio가 아닌 상용 솔루션(Solo.io Enterprise)에서만 제공되는 점도 기각 이유 중 하나였습니다

2026년 하반기 Ambient 성숙도 재평가 계획을 ADR에 남겨두었습니다 trace workload name 문제가 공식 지원으로 해결되면 전환을 재검토할 예정입니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [Istio 서비스 메시 도입 아키텍처 결정](/essays/goti-adr-istio-service-mesh)에 정리했습니다

---

## 📚 핵심 정리

- **Sidecar 모드는 Pod마다 Envoy를 주입해 L4·L7을 한 프록시에서 처리합니다** iptables 리디렉션으로 앱 코드 변경 없이 투명하게 동작하며, HTTP 메트릭·분산 트레이스·mTLS가 자동으로 활성화됩니다
- **Ambient 모드는 ztunnel(노드 DaemonSet)이 L4를 담당하고 Waypoint(선택적 Envoy)가 L7을 담당합니다** Pod 내부 프록시가 없어 리소스 오버헤드가 대폭 줄어들지만, Waypoint 없이는 HTTP 메트릭과 분산 트레이스가 수집되지 않습니다
- **L7 파싱 위치가 관측성의 핵심 분기점입니다** Sidecar에서는 각 Pod의 Envoy가 즉시 L7 정보를 파싱하고, Ambient에서는 Waypoint를 경유하는 트래픽만 L7 수준 관측이 가능합니다
- **Ambient + Waypoint도 Sidecar와 완전히 동등하지 않습니다** 분산 트레이스에서 workload name 누락, ztunnel·Waypoint 이중 텔레메트리 엣지 문제가 현재(2026-03 커뮤니티 Istio 기준) 미해결 상태입니다
- **리소스 트레이드오프는 명확합니다** Sidecar는 Pod 수에 선형 비례하는 Envoy 비용이 발생하고, Ambient는 노드 수 고정 비용이므로 Pod 규모가 클수록 Ambient의 리소스 이점이 커집니다
