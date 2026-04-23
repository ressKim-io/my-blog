---
title: "왜 Istio를 선택했나: Service Mesh 도입 아키텍처 결정"
excerpt: "Linkerd, Cilium, Spring Cloud Gateway를 두고 Istio Sidecar를 선택한 이유와 Ambient Mesh를 포기한 근거"
category: kubernetes
tags:
  - Istio
  - Service-Mesh
  - Architecture-Decision
  - Envoy
  - Ambient-Mesh
  - mTLS
date: '2026-02-03'
---

## 🎯 한 줄 요약

> Istio Sidecar 모드를 선택했습니다. JWT 검증 + Rate Limiting + mTLS + 분산 트레이싱을 하나의 도구로 해결하기 위해서입니다. Ambient Mesh는 L7 관측성 한계로 포기했습니다.

---

## 🤔 배경: 왜 서비스 메시가 필요했나

Goti는 대규모 티켓팅 서비스입니다.
모놀리식에서 MSA로 전환을 앞두고 있었습니다.

전환 전에 아키텍처를 점검해보니, **부족한 기능이 5가지**나 있었습니다.

| 부족한 기능 | 현재 상태 | 필요한 이유 |
|------------|----------|------------|
| API Gateway | 없음 (직접 EC2로 요청) | MSA 전환 시 서비스 라우팅, 인증 게이트 필요 |
| Rate Limiting | 없음 | 티켓 오픈 시 트래픽 스파이크 방어 |
| JWT 검증 (Gateway 레벨) | Spring Security에서만 처리 | 서비스마다 중복 구현 → Gateway에서 한 번에 처리 |
| mTLS (서비스 간 암호화) | 없음 | MSA에서 서비스 간 통신 보안 필수 |
| 서비스 간 트래픽 관리 | 없음 | Circuit breaker, retry, timeout |

이 기능들을 하나하나 직접 구현하면 어떻게 되겠습니까?

- Rate Limiting → Bucket4j 또는 Redis 기반 직접 구현
- JWT 검증 → Spring Cloud Gateway + Spring Security
- mTLS → cert-manager + 수동 인증서 관리
- Circuit Breaker → Resilience4j
- 트래픽 관리 → Spring Cloud LoadBalancer

**5개 이상의 라이브러리를 조합해야 합니다.**
서비스마다 설정이 분산되고, 언어가 바뀌면 처음부터 다시 구현해야 합니다.

여기서 핵심 질문이 떠올랐습니다.

> **이 모든 기능을 한 곳에서, 인프라 레벨로 처리할 수 있는 도구가 있는가?**

이 질문에 답하기 위해 서비스 메시를 검토하기 시작했습니다.

---

## 🔍 서비스 메시 3종 비교: Istio vs Linkerd vs Cilium

CNCF Graduated 등급의 서비스 메시 3종을 비교했습니다.

| 항목 | Istio | Linkerd | Cilium |
|------|-------|---------|--------|
| **아키텍처** | Envoy sidecar (L7) | Rust micro-proxy (L7) | eBPF (L3/L4) + Envoy (L7) |
| **mTLS** | 자동 (설치 즉시) | 자동 (설치 즉시) | eBPF 기반 |
| **JWT 검증** | **RequestAuthentication CRD** | 미지원 (외부 도구 필요) | 미지원 (외부 도구 필요) |
| **Rate Limiting** | **EnvoyFilter (local/global)** | 미지원 | 미지원 |
| **AuthorizationPolicy** | **네이티브 RBAC** | Server 정책만 | CiliumNetworkPolicy |
| **분산 트레이싱** | OTel 네이티브 (Envoy → OTLP) | Prometheus 메트릭만 | eBPF 메트릭 (L4 위주) |
| **L7 HTTP 메트릭** | 자동 (istio_requests_total 등) | 자동 | Envoy 추가 시만 |
| **Circuit Breaker** | DestinationRule | 제한적 (2.13+ failure accrual) | 미지원 |
| **Fault Injection** | VirtualService | 미지원 | 미지원 |
| **트래픽 관리** | 카나리, 미러링, 가중치 라우팅 | 트래픽 분할만 | 기본적 라우팅 |
| **K8s Gateway API** | 지원 (구현체) | 지원 | 지원 |
| **리소스 사용량** | 높음 (Envoy sidecar) | **낮음 (Rust, 10배 적음)** | 중간 (eBPF) |
| **학습 곡선** | 높음 | 낮음 | 중간 |
| **CNCF 등급** | Graduated | Graduated | Graduated |

이 비교표에서 핵심을 짚어보겠습니다.

**Istio가 유일하게 JWT + Rate Limiting + mTLS를 모두 제공합니다.**
Linkerd는 가볍고 빠르지만, JWT 검증과 Rate Limiting이 없습니다.
결국 별도 도구를 붙여야 하고, 올인원의 이점이 사라집니다.

Cilium은 eBPF 기반으로 L3/L4에서는 압도적인 성능을 보여줍니다.
하지만 HTTP 수준의 정책(JWT, Rate Limit)은 Envoy를 추가해야 합니다.
그러면 Istio와 복잡도가 비슷해지는데, 생태계는 Istio가 더 성숙합니다.

분산 트레이싱도 차이가 큽니다.
Istio의 Envoy는 OTel OTLP를 네이티브로 export합니다.
이미 구축한 Alloy → Tempo 파이프라인에 바로 연결됩니다.
Linkerd는 Prometheus 메트릭만, Cilium은 L4 위주 메트릭만 제공합니다.

### 시나리오별 적합도

모든 상황에서 Istio가 최선은 아닙니다.
시나리오에 따라 최적의 선택이 달라집니다.

| 시나리오 | 최적 선택 | 이유 |
|----------|-----------|------|
| MSA에서 JWT+Rate Limit+mTLS 통합 | **Istio** | 유일하게 세 기능 모두 인프라 레벨에서 제공 |
| 서비스 간 mTLS만 필요 | Linkerd | 가장 가볍고 빠름 |
| 고성능 L3/L4 네트워크 정책 | Cilium | eBPF 기반 커널 레벨 처리 |
| 분산 트레이싱 워터폴 시각화 | **Istio** | Envoy OTel trace 자동 전파, Tempo 완전 호환 |

Goti의 요구사항은 첫 번째와 네 번째에 정확히 해당했습니다.

---

## 🔍 API Gateway 대안 비교: Istio Gateway vs Spring Cloud Gateway vs Kong

서비스 메시 없이 API Gateway만 도입하는 방안도 검토했습니다.
"꼭 서비스 메시까지 필요한가?"라는 질문에 답하기 위해서입니다.

| 항목 | Istio Gateway | Spring Cloud Gateway | Kong |
|------|-------------|---------------------|------|
| **JWT 검증** | RequestAuthentication CRD | Spring Security 통합 | 플러그인 |
| **Rate Limiting** | EnvoyFilter (local/global) | Bucket4j/Redis | 내장 |
| **mTLS** | 자동 (메시 전체) | 수동 (cert-manager 별도) | 수동 |
| **서비스 간 통신 보안** | 메시 전체 자동 적용 | **게이트웨이까지만** | **게이트웨이까지만** |
| **Circuit Breaker** | DestinationRule | Resilience4j 통합 | 플러그인 |
| **분산 트레이싱** | OTel 네이티브 (서비스 간 전체) | Micrometer (게이트웨이만) | 플러그인 (게이트웨이만) |
| **언어 종속성** | 없음 (인프라 레벨) | **Java/Spring 전용** | 없음 |
| **배포 방식** | K8s CRD (GitOps 호환) | 별도 Spring 앱 배포 | Helm chart |
| **추가 인프라** | 없음 (Istio에 포함) | **별도 서비스 운영 필요** | **별도 서비스 운영 필요** |

여기서 결정적인 차이는 **"서비스 간 통신 보안"** 행입니다.

Spring Cloud Gateway와 Kong은 게이트웨이-백엔드 구간만 보호합니다.
서비스 A → 서비스 B로 직접 통신할 때는 보안이 없습니다.
MSA에서 서비스 간 내부 통신이 많아지면, 이 빈틈이 치명적이 됩니다.

Istio Gateway는 서비스 메시의 일부이기 때문에 다릅니다.
게이트웨이 통과 후에도 서비스 간 mTLS가 자동 적용됩니다.

분산 트레이싱도 마찬가지입니다.
Spring Cloud Gateway의 Micrometer는 게이트웨이 자체의 메트릭만 수집합니다.
서비스 간 호출 체인을 워터폴 뷰로 시각화하려면 각 서비스에 직접 계측을 추가해야 합니다.

Istio는 Envoy sidecar가 모든 서비스에서 trace를 자동 전파하기 때문에,
**애플리케이션 코드 수정 없이** 전체 호출 체인을 볼 수 있습니다.

결국 API Gateway만으로는 Goti의 요구사항 절반밖에 못 채웁니다.
나머지 절반(mTLS, 서비스 간 보안, 전체 트레이싱)은 서비스 메시가 필요했습니다.

---

## 🚫 Ambient Mesh를 선택하지 않은 이유

Istio를 선택한 뒤, 다음 질문은 **데이터 플레인 모드**였습니다.

Istio는 두 가지 모드를 제공합니다:
- **Sidecar**: 각 Pod에 Envoy proxy를 주입
- **Ambient**: Node 레벨의 ztunnel(L4) + 선택적 waypoint(L7)

Ambient는 sidecar 대비 **메모리/CPU를 70~90% 절감**한다고 합니다.
매력적인 숫자입니다. 당연히 검토했습니다.

그런데 **관측성(Observability)을 파고들수록 문제가 보이기 시작했습니다.**

### Sidecar vs Ambient 관측성 비교

| 관측 항목 | Sidecar (Envoy) | Ambient (ztunnel only) | Ambient + Waypoint |
|----------|-----------------|----------------------|-------------------|
| TCP 메트릭 (바이트, 연결 수) | O | O | O |
| **HTTP 메트릭** (status code, method, route) | **O (자동)** | **X** | O (Waypoint에서) |
| **분산 트레이싱** (trace propagation) | **O (자동)** | **X** | **부분적** — workload name 불완전 |
| **OTel OTLP export** | O (Envoy 네이티브) | X | O (Waypoint Envoy) |
| Access Log (L7) | O (HTTP 상세) | TCP 레벨만 | O |
| mTLS | O | O | O |

이 표를 하나씩 풀어보겠습니다.

Sidecar 모드에서는 모든 관측 항목이 자동으로 동작합니다.
Envoy가 각 Pod 옆에 붙어서 L7 트래픽을 직접 보기 때문입니다.
HTTP status code, method, route별 메트릭이 자동 수집되고,
OTel trace도 Envoy가 네이티브로 export합니다.

Ambient의 ztunnel은 다릅니다.
**L4(TCP) 레벨에서만 동작합니다.**
HTTP 메트릭? 없습니다. 분산 트레이싱? 없습니다.
ztunnel은 TCP 바이트와 연결 수만 볼 수 있습니다.

"그러면 Waypoint를 추가하면 되지 않나?"

맞습니다. Waypoint proxy를 추가하면 L7 관측이 가능해집니다.
**하지만 여기서 새로운 문제가 생깁니다.**

### 핵심 문제: 분산 트레이싱 워터폴 뷰의 한계

Goti 프로젝트는 Grafana Tempo의 **워터폴(Waterfall) 트레이스 뷰**가 핵심입니다.
서비스 간 호출 체인을 시간 축으로 펼쳐서 보여주는 뷰입니다.

이 뷰가 의미 있으려면, **각 span에 워크로드 이름이 정확히 표시**되어야 합니다.
"user-service에서 200ms 걸렸다", "ticketing-service에서 500ms 걸렸다" — 이게 보여야 합니다.

두 모드의 워터폴 뷰를 비교해보겠습니다.

```text
Sidecar 모드 워터폴 뷰 (정상):
┌─ goti-gateway ─────────────────────────────────┐
│  ┌─ user-service ──────────────┐               │
│  │  ┌─ PostgreSQL query ──┐   │               │
│  │  └─────────────────────┘   │               │
│  └─────────────────────────────┘               │
│  ┌─ ticketing-service ─────────────────────┐   │
│  │  ┌─ Redis distributed lock ─┐          │   │
│  │  └──────────────────────────┘          │   │
│  │  ┌─ PostgreSQL query ───────────┐      │   │
│  │  └──────────────────────────────┘      │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘

Ambient 모드 워터폴 뷰 (문제):
┌─ waypoint-proxy-xxxxx ──────────────────────────┐
│  ┌─ ??? (workload name 불완전) ─┐              │
│  │  ┌─ PostgreSQL query ──┐    │              │
│  │  └─────────────────────┘    │              │
│  └──────────────────────────────┘              │
│  ┌─ waypoint-proxy-yyyyy ──────────────────┐   │
│  │  ┌─ ??? ─────────────┐                 │   │
│  │  └───────────────────┘                 │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

{/* TODO: Draw.io로 교체 */}

Sidecar 모드에서는 각 span에 서비스 이름이 명확하게 표시됩니다.
`goti-gateway → user-service → ticketing-service`로 호출 체인이 한눈에 보입니다.
어디서 지연이 발생했는지 즉시 파악할 수 있습니다.

Ambient 모드에서는 `waypoint-proxy-xxxxx`가 서비스 이름 자리를 차지합니다.
실제 워크로드 이름이 불완전하게 표시되거나 누락됩니다.

> Istio 1.28+에서 service name 표시가 개선되었지만, trace overlay의 gap은 여전히 존재합니다. 워크로드 이름이 완전히 해결된 것은 아닙니다.

티켓 오픈 시 트래픽 폭주가 발생하면, 어떤 서비스에서 병목이 생겼는지 **초 단위로** 파악해야 합니다.
워터폴 뷰에서 서비스 이름이 보이지 않으면, 장애 추적 자체가 불가능합니다.

이것이 Ambient를 포기한 가장 큰 이유입니다.

### 텔레메트리 이중 엣지 문제

Ambient + Waypoint 구성에서는 또 다른 문제가 있습니다.

ztunnel(L4)과 waypoint(L7)이 **동시에 텔레메트리를 리포트**합니다.
같은 요청에 대해 두 곳에서 메트릭을 내보내는 것입니다.

이로 인해 Kiali 같은 서비스 그래프 도구에서 **트래픽 그래프가 왜곡**됩니다.
실제 요청 1개가 그래프에서 2개로 보이거나,
의도하지 않은 엣지(연결선)가 나타납니다.

모니터링 대시보드를 운영하는 입장에서,
데이터를 믿을 수 없게 되면 대시보드 자체가 무의미해집니다.

### ztunnel L7 관측: 커뮤니티 vs 상용

"ztunnel에서 L7 파싱이 가능하면 문제가 해결되는 거 아닌가?"

좋은 질문입니다. 실제로 이 부분도 조사했습니다.

Solo.io 문서 기준으로, 커뮤니티 Istio의 ztunnel에서는 L7 HTTP 파싱이 불가능하고 상용 버전에서만 지원되는 것으로 보입니다.

즉, 커뮤니티 Istio를 사용하는 한 ztunnel에서 HTTP 메트릭이나 트레이싱을 얻을 방법이 없습니다.
Waypoint를 배포하거나, 상용 솔루션을 도입하거나, 둘 중 하나입니다.

Waypoint를 배포하면 앞서 말한 텔레메트리 이중 엣지 문제가 따라오고,
상용 솔루션은 비용과 벤더 종속 문제가 있습니다.

### Sidecar vs Ambient 판단 정리

| 기준 | Sidecar | Ambient |
|------|---------|---------|
| 워터폴 트레이스 정상 표시 | **O** | X (workload name 불완전) |
| 추가 구성 없이 L7 관측 | **O** | X (Waypoint 필수) |
| 텔레메트리 중복 없음 | **O** | X (이중 엣지) |
| 메모리/CPU 효율 | X (sidecar 오버헤드) | **O (70-90% 절감)** |

**리소스 효율보다 관측성이 우선입니다.**

모니터링이 안 되면 다음 리소스 계획이나 장애 추적이 불가능합니다.
대규모 티켓팅 서비스에서 이는 치명적입니다.

Ambient Mesh의 리소스 절감 이점은 분명합니다.
하지만 2026년 3월 기준, 커뮤니티 Istio의 Ambient 모드는
관측성 측면에서 프로덕션 수준에 도달하지 못했습니다.

향후 Ambient의 트레이싱 이슈가 해결되면 재평가할 계획입니다.

---

## ✅ 최종 결정

**Istio Sidecar 모드**를 서비스 메시 + API Gateway로 채택합니다.

아래 다이어그램은 Istio가 Goti에서 처리하는 기능들의 전체 흐름입니다.

```text
                    ┌─────────────────────────────────────────────┐
                    │              Istio Control Plane             │
                    │  (istiod: config, cert, service discovery)  │
                    └──────────────────┬──────────────────────────┘
                                       │ CRD push
     External                          ▼
     Traffic ──► ┌─────────────────────────────────────┐
                 │        Istio Ingress Gateway         │
                 │  ┌───────────┐  ┌────────────────┐  │
                 │  │ JWT 검증  │  │ Rate Limiting  │  │
                 │  │ (JWKS)    │  │ (local/global) │  │
                 │  └─────┬─────┘  └───────┬────────┘  │
                 │        └────────┬───────┘           │
                 └─────────────────┼───────────────────┘
                            mTLS   │
                 ┌─────────────────▼───────────────────┐
                 │        Service A Pod                 │
                 │  ┌──────────┐  ┌─────────────────┐  │
                 │  │  Envoy   │──│   Application   │  │
                 │  │ sidecar  │  │                 │  │
                 │  │ ・L7 metrics │                 │  │
                 │  │ ・OTel trace │                 │  │
                 │  │ ・circuit    │                 │  │
                 │  │  breaker    │                 │  │
                 │  └──────┬───┘  └─────────────────┘  │
                 └─────────┼───────────────────────────┘
                    mTLS   │
                 ┌─────────▼───────────────────────────┐
                 │        Service B Pod                 │
                 │  ┌──────────┐  ┌─────────────────┐  │
                 │  │  Envoy   │──│   Application   │  │
                 │  │ sidecar  │  │                 │  │
                 │  └──────────┘  └─────────────────┘  │
                 └─────────────────────────────────────┘
                                       │
                         OTel OTLP     │
                 ┌─────────────────────▼───────────────┐
                 │  Alloy → Tempo (traces)             │
                 │        → Prometheus (metrics)       │
                 │        → Grafana (dashboard)        │
                 └─────────────────────────────────────┘
```

{/* TODO: Draw.io로 교체 */}

외부 트래픽이 들어오면 Istio Ingress Gateway에서 JWT 검증과 Rate Limiting을 먼저 처리합니다.
유효하지 않은 토큰은 서비스에 도달하기 전에 차단됩니다.
티켓 오픈 시 트래픽 스파이크도 Gateway 레벨에서 방어합니다.

Gateway를 통과한 요청은 mTLS로 암호화되어 서비스로 전달됩니다.
각 서비스의 Envoy sidecar가 L7 메트릭을 자동 수집하고,
OTel trace를 Alloy → Tempo로 export합니다.

**애플리케이션 코드 수정 없이, 이 모든 것이 인프라 레벨에서 동작합니다.**

### 선택 이유 5가지

1. **올인원**: JWT 검증 + Rate Limiting + mTLS + Circuit Breaker + 트래픽 관리. 별도 API Gateway 서비스 운영 불필요
2. **OTel 네이티브 통합**: Envoy OTLP export → Alloy → Tempo 파이프라인에 자연스럽게 연결. Grafana 워터폴 뷰에서 전체 호출 체인 시각화
3. **인프라 레벨 처리**: 애플리케이션 코드 수정 없이 K8s CRD로 정책 적용. Java 외 서비스 추가에도 동일 적용
4. **GitOps 호환**: VirtualService, DestinationRule, RequestAuthentication → 모두 YAML CRD. ArgoCD로 선언적 관리
5. **부하 테스트 활용**: VirtualService의 Fault Injection으로 장애 시나리오 시뮬레이션. 별도 도구 불필요

### 미선택 이유

**Linkerd를 선택하지 않은 이유:**

Linkerd는 Rust 기반 micro-proxy로 리소스 효율이 뛰어납니다.
mTLS와 기본적인 L7 메트릭도 잘 제공합니다.

하지만 JWT 검증과 Rate Limiting이 없습니다.
이 기능들을 별도 도구로 조합하면 올인원의 이점이 사라집니다.
Linkerd 2.13+에서 failure accrual 기반의 circuit breaking이 추가되었지만,
Istio의 DestinationRule만큼 세밀한 제어는 어렵습니다.

> mTLS만 필요한 프로젝트라면 Linkerd가 최선의 선택입니다. Goti에는 맞지 않았을 뿐입니다.

**Cilium을 선택하지 않은 이유:**

Cilium의 eBPF 기반 네트워킹은 L3/L4에서 압도적인 성능을 보여줍니다.
하지만 HTTP 수준 정책(JWT, Rate Limit)은 미지원입니다.
L7 기능을 쓰려면 Envoy를 추가해야 하는데,
그러면 Istio와 복잡도가 비슷해지면서 생태계 성숙도는 떨어집니다.

**Spring Cloud Gateway를 선택하지 않은 이유:**

Java/Spring 종속이 가장 큰 문제입니다.
MSA 전환 시 다른 언어 서비스가 추가될 수 있습니다.
또한 별도 Spring 앱으로 배포해야 하고,
mTLS와 서비스 간 보안은 여전히 별도 구현이 필요합니다.
분산 트레이싱도 게이트웨이 자체까지만 커버합니다.

**Kong을 선택하지 않은 이유:**

API 관리와 개발자 포털이 필요한 프로젝트라면 Kong이 좋습니다.
하지만 Goti에는 그런 요구사항이 없었고,
mTLS가 게이트웨이-백엔드 구간에만 적용되는 한계가 있습니다.
서비스 간 내부 통신 보안은 별도 구현이 필요합니다.

---

## 📊 결과와 트레이드오프

### 긍정적 영향

- API Gateway 코드를 직접 구현할 필요 없음 → **백엔드 팀은 비즈니스 로직에 집중**
- MSA 전환 시 서비스 간 mTLS 자동 적용 → 보안 설정 누락 방지
- Grafana 워터폴 뷰에서 전체 호출 체인 시각화 → **성능 병목 즉시 파악**
- 카나리 배포, fault injection → 안정적 배포 전략
- CRD 기반 설정 → ArgoCD GitOps와 완벽 통합, 변경 이력 추적

### 트레이드오프

| 트레이드오프 | 영향 | 대응 |
|-------------|------|------|
| 리소스 오버헤드 | 각 Pod에 Envoy sidecar 추가 (CPU/Memory) | dev 환경에서 수용 가능, EKS 전환 시 노드 스펙 계획에 반영 |
| 학습 곡선 | VirtualService, DestinationRule 등 CRD 학습 필요 | 실전 패턴 축적으로 대응 |
| 디버깅 복잡도 | sidecar 관련 문제 (503, RBAC 등) 트러블슈팅 | Kiali, istioctl analyze 활용 |
| Ambient 전환 비용 | 향후 Ambient 성숙 시 전환 작업 필요 | Istio 공식 마이그레이션 가이드 제공 예정, 당분간 sidecar 유지 |

리소스 오버헤드는 Sidecar 모드의 가장 큰 단점입니다.
각 Pod에 Envoy가 붙으면 CPU 10~50m, Memory 128~256Mi가 추가됩니다.

하지만 이 오버헤드는 **예측 가능**합니다.
Pod 수에 비례해서 선형으로 증가하기 때문에, 노드 스펙 계획에 반영할 수 있습니다.

반면 관측성이 불완전하면, 장애 시 원인을 찾지 못해 **예측 불가능한 손실**이 발생합니다.
예측 가능한 비용과 예측 불가능한 리스크 중에서, 전자를 선택했습니다.

---

## 📚 핵심 포인트

1. **서비스 메시 선택은 "무엇이 필요한가"에서 시작합니다.** mTLS만 필요하면 Linkerd, L3/L4 정책이면 Cilium, JWT+Rate Limit+mTLS 올인원이면 Istio.

2. **API Gateway만으로는 MSA 보안이 완성되지 않습니다.** 게이트웨이 뒤의 서비스 간 통신 보안은 서비스 메시가 필요합니다.

3. **Ambient Mesh의 리소스 절감은 매력적이지만, 관측성 비용이 큽니다.** 특히 분산 트레이싱 워터폴 뷰가 핵심인 프로젝트에서는 Sidecar가 현실적인 선택입니다.

4. **"리소스 효율 vs 관측성"은 트레이드오프입니다.** Goti에서는 관측성을 선택했습니다. 모니터링 없이는 다음 최적화 자체가 불가능하기 때문입니다.

5. **Ambient Mesh는 계속 진화 중입니다.** Istio 1.28+에서 개선이 이루어지고 있고, 2026 하반기에 재평가할 계획입니다.
