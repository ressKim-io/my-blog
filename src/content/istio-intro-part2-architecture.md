---
title: "Istio 아키텍처 완전 정복"
excerpt: "Control Plane과 Data Plane이 정확히 뭘 하는지, Sidecar가 어떻게 트래픽을 가로채는지, Pod 간 요청이 실제로 어떤 경로로 흐르는지"
category: "kubernetes"
tags:
  - istio
  - envoy
  - sidecar
  - control-plane
  - data-plane
  - kubernetes
series:
  name: "istio-intro"
  order: 2
date: "2025-12-07"
---

## 🎯 이전 글 요약

Part 1에서는 Service Mesh가 왜 필요한지, 라이브러리 방식과 뭐가 다른지 정리했습니다.

**핵심 내용:**
- 마이크로서비스 = 네트워크 복잡도 증가
- 라이브러리 방식: 언어별 구현, 코드에 섞임
- Service Mesh: 네트워크 로직을 Sidecar로 분리

Part 2에서는 **Istio가 내부적으로 어떻게 동작하는지** 파헤쳐보겠습니다.

---

## 💡 학습 동기

Part 1에서 개념은 이해했지만, "그래서 정확히 어떻게 동작하는데?"라는 의문이 남았습니다.

**궁금했던 것:**
- Sidecar가 트래픽을 가로챈다는데 어떻게?
- Control Plane이 뭐고 Data Plane이 뭔데?
- mTLS가 자동으로 된다는데 누가 인증서를 관리해?
- Pod A → Pod B 요청이 실제로 어떤 경로로?

---

## 🏗️ Istio 아키텍처 전체 구조

Istio는 크게 **두 개의 영역**으로 나뉩니다.

![Istio Control/Data Plane](/images/istio-intro/istio-control-data-plane.svg)

| 영역 | 구성 요소 | 역할 |
|------|----------|------|
| **Control Plane** | istiod (Pilot, Citadel, Galley) | 설정 관리, 인증서 발급, 유효성 검증 |
| **Data Plane** | Envoy Sidecar | 실제 트래픽 처리, mTLS 암호화 |

---

## 🧠 Control Plane: istiod

istiod는 Istio의 두뇌입니다. 예전에는 Pilot, Citadel, Galley가 별도 컴포넌트였지만, 지금은 istiod 하나로 통합되었습니다.

### istiod가 하는 일

![istiod Roles](/images/istio-intro/istiod-roles.svg)

istiod는 세 가지 역할을 통합한 컴포넌트입니다.

**Pilot (설정 관리)**: VirtualService, DestinationRule 같은 Istio 리소스를 감시합니다. 변경이 감지되면 Envoy가 이해할 수 있는 형식으로 변환해서 xDS API로 각 프록시에 배포합니다.

**Citadel (인증서 관리)**: 각 워크로드에 SPIFFE 기반 인증서를 발급합니다. 24시간마다 자동으로 갱신하므로 개발자가 인증서를 직접 관리할 필요가 없습니다.

**Galley (설정 검증)**: 잘못된 YAML이 배포되는 것을 막습니다. Validation Webhook으로 kubectl apply 시점에 검증합니다.

### xDS API

istiod와 Envoy는 **xDS API**로 통신합니다.

![xDS API](/images/istio-intro/xds-api.svg)

| API | 역할 |
|-----|------|
| **LDS** (Listener) | "이 포트로 들어오는 트래픽은 이렇게 처리해" |
| **RDS** (Route) | "이 경로로 요청이 오면 여기로 보내" |
| **CDS** (Cluster) | "이 서비스의 엔드포인트들은 이거야" |
| **EDS** (Endpoint) | "각 엔드포인트의 IP:Port는 이거야" |
| **SDS** (Secret) | "mTLS에 쓸 인증서는 이거야" |

**핵심**: istiod가 설정을 변경하면, xDS API를 통해 모든 Envoy에 실시간으로 전파됩니다. **재배포 없이 설정 변경 가능!**

---

## 🛡️ Data Plane: Envoy Sidecar

Envoy는 실제 트래픽을 처리하는 프록시입니다. 각 Pod에 Sidecar 컨테이너로 주입됩니다.

### Sidecar Injection

![Sidecar Injection Process](/images/istio-intro/sidecar-injection-process.svg)

| 단계 | 설명 |
|------|------|
| **1** | Namespace에 `istio-injection=enabled` 라벨 추가 |
| **2** | Pod 생성 요청 (원래 컨테이너만 정의) |
| **3** | Admission Controller가 요청 가로챔 |
| **4** | istio-init (iptables 설정) + istio-proxy (Envoy) 자동 추가 |

### iptables로 트래픽 가로채기

**istio-init** 컨테이너가 iptables 규칙을 설정해서, 모든 트래픽이 Envoy를 거치게 만듭니다.

![iptables Redirect](/images/istio-intro/iptables-redirect.svg)

| 단계 | 동작 |
|------|------|
| **App** | `curl B:8080` 호출 (원래 목적지) |
| **iptables** | localhost:15001로 리다이렉트 |
| **Envoy** | 원래 목적지 확인 후 mTLS 적용하여 전송 |

**앱 입장에서는 변화 없음!** 그냥 `curl B:8080` 하면 되고, 나머지는 Envoy가 처리합니다.

---

## 🔄 요청 흐름 완전 분석

Pod A의 앱이 Pod B의 앱을 호출하는 전체 과정입니다.

![Request Flow A to B](/images/istio-intro/request-flow-ab.svg)

### 각 단계 상세

| 단계 | 위치 | 설명 |
|------|------|------|
| 1 | App A | 그냥 HTTP 요청 (`curl B:8080`) |
| 2 | iptables | 15001 포트로 리다이렉트 |
| 3 | Envoy A | 목적지 확인, mTLS 준비, 헤더 주입 |
| 4 | 네트워크 | mTLS로 암호화된 통신 |
| 5 | Envoy B | 복호화, 인증서 검증, 인가 체크 |
| 6 | iptables | App B로 전달 |
| 7 | App B | 실제 비즈니스 로직 처리 |

**핵심**: App A, B 둘 다 mTLS를 모릅니다. Envoy가 알아서 처리합니다.

---

## 🔐 mTLS 자동화

### mTLS란?

![TLS vs mTLS](/images/istio-intro/tls-vs-mtls.svg)

| 구분 | TLS (단방향) | mTLS (상호 인증) |
|------|-------------|-----------------|
| **검증** | 클라이언트만 서버 검증 | 양쪽 모두 서로 검증 |
| **인증서** | 서버만 제시 | 양쪽 모두 제시 |
| **사용처** | HTTPS | Zero Trust 환경 |

### Istio에서 mTLS 자동화

istiod(Citadel)가 자동으로 인증서를 관리합니다.

![mTLS Certificate Automation](/images/istio-intro/mtls-cert-automation.svg)

| 단계 | 동작 |
|------|------|
| **1** | 워크로드 시작 감지 |
| **2** | SPIFFE ID 기반 인증서 생성 (예: `spiffe://cluster.local/ns/default/sa/my-service`) |
| **3** | SDS API로 Envoy에 인증서 전달 |
| **4** | 24시간마다 자동 갱신 |

**개발자가 할 일: 없음!** 인증서 발급, 갱신, 배포 모두 자동

---

## 🔍 Envoy 포트 구조

![Envoy Ports](/images/istio-intro/envoy-ports.svg)

| 포트 | 용도 |
|------|------|
| **15001** | Outbound 트래픽 처리 (앱 → 외부) |
| **15006** | Inbound 트래픽 처리 (외부 → 앱) |
| **15000** | Envoy Admin (디버깅용) |
| **15020** | Health Check, Prometheus 메트릭 |
| **15021** | Health Check 엔드포인트 |
| **15090** | Prometheus 메트릭 (상세) |

디버깅할 때:
```bash
kubectl exec -it pod/my-app -c istio-proxy -- curl localhost:15000/config_dump
```

---

## 📚 배운 점

### Control Plane (istiod)

1. **Pilot**: 설정을 Envoy가 이해할 수 있는 형태로 변환
2. **Citadel**: mTLS 인증서 자동 발급/갱신
3. **Galley**: 설정 유효성 검증
4. **xDS API**: 실시간 설정 배포 (재배포 불필요!)

### Data Plane (Envoy)

1. **Sidecar Injection**: Namespace 라벨로 자동 주입
2. **iptables**: 모든 트래픽을 Envoy로 리다이렉트
3. **투명한 프록시**: 앱은 변경 없이 그대로 사용

### mTLS 자동화

1. 인증서 발급, 갱신, 배포 모두 자동
2. SPIFFE 기반 서비스 신원
3. 개발자가 신경 쓸 필요 없음

---

## 🔗 다음 편 예고

Part 3에서는 Kubernetes Service와 Istio의 관계를 정리해보겠습니다.
- kube-proxy는 뭐고 Istio와 뭐가 다른지
- L4 로드밸런싱 vs L7 로드밸런싱
- 둘 다 필요한가?

---

## 📖 참고 자료

- [Istio Architecture 공식 문서](https://istio.io/latest/docs/ops/deployment/architecture/)
- [Envoy Proxy 공식 문서](https://www.envoyproxy.io/docs/envoy/latest/)
- [xDS Protocol](https://www.envoyproxy.io/docs/envoy/latest/api-docs/xds_protocol)
