---
title: "Istio Ambient Part 7: Istio vs Linkerd vs Cilium 비교"
excerpt: "Service Mesh 3대장의 철학, 아키텍처, 리소스 사용량을 비교하고 선택 기준을 정리합니다"
category: "kubernetes"
tags: ["istio", "linkerd", "cilium", "service-mesh", "kubernetes", "comparison"]
series:
  name: "istio-ambient"
  order: 7
date: "2025-12-26"
---

## 🎯 시작하며

Istio Ambient 시리즈의 마지막 편입니다. Service Mesh를 도입하려면 **Istio, Linkerd, Cilium** 중 어떤 것을 선택해야 할까요?

![Service Mesh Comparison|tall](/images/istio-ambient/mesh-comparison.svg)

| 항목 | Istio | Linkerd | Cilium |
|------|-------|---------|--------|
| 철학 | Enterprise Feature-rich | Simplicity & Lightweight | eBPF-native Networking |
| 주도 | Google/IBM | Buoyant | Isovalent |
| 프록시 | Envoy (C++) | Rust 프록시 | eBPF + Envoy |
| 상태 | CNCF Graduated | CNCF Graduated | CNCF Graduated |
| 타겟 | 대규모 기업 | 심플함 우선 | 고성능 네트워킹 |

세 가지 모두 CNCF Graduated 프로젝트로 프로덕션 사용이 검증되었습니다. 하지만 접근 방식과 철학이 다릅니다. Istio는 "모든 기능을 제공하자", Linkerd는 "심플하게 필수만", Cilium은 "커널 레벨에서 해결하자"입니다.

각 솔루션의 철학부터 실제 선택 기준까지 정리해보겠습니다.

---

## 📊 아키텍처 비교

### Istio

| 계층 | 컴포넌트 | 역할 |
|------|----------|------|
| Control Plane | istiod | Pilot(설정), Citadel(인증서), Galley(검증) 통합 |
| Data Plane (Sidecar) | Envoy Sidecar | Pod마다 1개, L4+L7 처리 |
| Data Plane (Ambient) | ztunnel + waypoint | Node당 ztunnel(L4), 선택적 waypoint(L7) |

Istio는 두 가지 Data Plane 모드를 제공합니다:

1. **Sidecar 모드**: 전통적인 방식으로 Pod마다 Envoy 프록시가 함께 배포됩니다. 모든 기능을 지원하지만 리소스 오버헤드가 큽니다.
2. **Ambient 모드 (GA)**: Node당 ztunnel이 L4를 처리하고, 필요시 waypoint가 L7을 처리합니다. 리소스 효율적이지만 EnvoyFilter 미지원 등 제한이 있습니다.

**특징**:
- Envoy 프록시 기반 (C++)
- 가장 풍부한 기능 세트
- 복잡하지만 강력한 설정
- Ambient 모드로 리소스 효율화 가능

### Linkerd

| 계층 | 컴포넌트 | 역할 |
|------|----------|------|
| Control Plane | linkerd-control-plane | destination(서비스 디스커버리), identity(인증서), proxy-injector |
| Data Plane | linkerd-proxy (Rust) | Pod마다 1개, 경량 Sidecar |

Linkerd는 Sidecar 방식만 지원하지만, 프록시가 Rust로 작성되어 매우 가볍습니다. Envoy 대비 메모리 사용량이 1/3 수준입니다.

"필요한 것만 제공하자"는 철학으로 기능은 제한적입니다. Circuit Breaker, Rate Limiting, JWT 인증 같은 기능은 없지만, mTLS, 트래픽 분할, 관측성 등 핵심 기능은 완벽하게 지원합니다.

**특징**:
- Rust로 작성된 경량 프록시 (linkerd2-proxy)
- 심플함을 최우선 가치로
- 빠른 설치 (5분 이내)
- 기능은 제한적이지만 필수 기능에 집중

### Cilium

| 계층 | 컴포넌트 | 역할 |
|------|----------|------|
| Control Plane | cilium-operator | Cluster-wide 리소스 관리 |
| Data Plane | cilium-agent (Node당) | eBPF로 L3/L4 처리, Envoy로 L7 처리 |
| Pod | Sidecar 없음 | 순수 애플리케이션만 |

Cilium은 완전히 다른 접근 방식을 취합니다. 프록시가 아닌 eBPF를 사용해 커널 레벨에서 네트워킹을 처리합니다. Pod에 Sidecar가 없고, Node당 cilium-agent가 모든 트래픽을 처리합니다.

L3/L4 처리는 eBPF로 커널에서 직접 수행되어 매우 빠릅니다. L7 기능(HTTP 라우팅, JWT 등)이 필요할 때만 Envoy가 사용됩니다.

가장 큰 차이점은 CNI(Container Network Interface)까지 통합한다는 점입니다. 네트워킹, 서비스 메시, 네트워크 폴리시를 하나의 솔루션으로 처리합니다.

**특징**:
- eBPF 기반 네트워킹 (커널 레벨)
- CNI + Service Mesh + Network Policy 통합
- L3/L4는 eBPF, L7은 Envoy
- 가장 높은 성능 잠재력

---

## 🔬 기능 비교 (2024.12 기준)

### 핵심 기능 비교표

| 기능 | Istio | Linkerd | Cilium |
|------|-------|---------|--------|
| **mTLS** | ✅ 자동 | ✅ 자동 | ✅ 자동 |
| **트래픽 분할** | ✅ 상세 설정 | ✅ 기본 지원 | ✅ 지원 |
| **Circuit Breaker** | ✅ 상세 설정 | ❌ 미지원 | ✅ 지원 |
| **Retry/Timeout** | ✅ 상세 설정 | ✅ 기본 지원 | ✅ 지원 |
| **Rate Limiting** | ✅ 로컬/글로벌 | ❌ 미지원 | ✅ 지원 |
| **JWT 인증** | ✅ 네이티브 | ❌ 미지원 | ✅ 지원 |
| **멀티클러스터** | ✅ 지원 | ✅ 지원 | ✅ 지원 |
| **트레이싱** | ✅ Jaeger/Zipkin | ✅ Jaeger | ✅ Hubble |
| **메트릭** | ✅ Prometheus | ✅ Prometheus | ✅ Prometheus/Hubble |
| **Service Graph** | ✅ Kiali | ✅ Linkerd Viz | ✅ Hubble UI |

기능 측면에서 Istio가 가장 포괄적입니다. 세 솔루션 모두 mTLS, 트래픽 분할, 관측성 같은 핵심 기능을 지원하지만, 세부적인 차이가 있습니다.

Linkerd가 ❌로 표시된 기능들(Circuit Breaker, Rate Limiting, JWT 인증)은 의도적인 선택입니다. Linkerd는 "필수 기능만 완벽하게"라는 철학을 따르기 때문에 복잡한 기능은 애플리케이션 레벨에서 구현하도록 남겨둡니다. 이런 기능이 필요하다면 Linkerd는 적합하지 않습니다.

Cilium은 대부분의 기능을 지원하지만, L7 기능(JWT, 상세 라우팅 등)은 내부적으로 Envoy를 사용합니다. eBPF로 처리할 수 있는 L3/L4 기능에서는 최고의 성능을 보여주지만, L7은 Istio와 비슷한 방식으로 동작합니다.

### 세부 기능 비교

| 영역 | Istio | Linkerd | Cilium |
|------|-------|---------|--------|
| **트래픽 관리** | ⭐⭐⭐⭐⭐ (VirtualService 세부설정) | ⭐⭐⭐ (TrafficSplit) | ⭐⭐⭐⭐ (CiliumEnvoyConfig) |
| **보안** | ⭐⭐⭐⭐⭐ (AuthZ, JWT, SPIFFE) | ⭐⭐⭐ (mTLS, Policy) | ⭐⭐⭐⭐ (NetworkPolicy + mTLS) |
| **관측성** | ⭐⭐⭐⭐⭐ (Kiali, 상세 메트릭) | ⭐⭐⭐⭐ (Linkerd Viz) | ⭐⭐⭐⭐ (Hubble) |
| **운영 복잡도** | 높음 (학습곡선 가파름) | 낮음 (5분 설치) | 중간 (CNI 교체 필요) |

기능 깊이를 비교하면 Istio가 모든 영역에서 가장 강력합니다. 하지만 그만큼 복잡합니다. Linkerd는 기능이 제한적이지만 운영이 심플합니다. Cilium은 중간 정도의 기능과 복잡도를 가집니다.

트래픽 관리에서 Istio의 VirtualService는 헤더, 가중치, 미러링 등 세밀한 제어가 가능합니다. Linkerd의 TrafficSplit은 기본적인 가중치 라우팅만 지원합니다.

보안에서 Istio는 AuthorizationPolicy, JWT, SPIFFE 등 모든 기능을 네이티브로 지원합니다. Linkerd는 mTLS와 기본 Policy만 지원합니다. Cilium은 NetworkPolicy가 강력하지만 JWT는 별도 설정이 필요합니다.

---

## 📈 리소스 사용량 비교

### Sidecar 모드 비교 (Pod당)

| 솔루션 | CPU (Pod당) | Memory (Pod당) | 비고 |
|--------|-------------|----------------|------|
| Istio Envoy | 100-150m | 100-150Mi | Envoy 프록시 |
| Linkerd proxy | 10-50m | 20-50Mi | Rust 경량 프록시 |
| Cilium | 0 | 0 | Sidecar 없음 (Node당 agent) |

> * Cilium은 Node당 cilium-agent가 리소스 사용
> * Istio Ambient 모드는 Node당 ztunnel만 사용

Sidecar 방식을 사용하는 Istio와 Linkerd를 비교하면, Linkerd가 훨씬 가볍습니다. Linkerd의 프록시는 Rust로 작성되어 Envoy(C++)보다 메모리 효율이 좋습니다. Pod당 CPU는 1/5, 메모리는 1/3 수준입니다.

Cilium은 아예 Sidecar가 없습니다. Pod 레벨이 아닌 Node 레벨에서 cilium-agent가 모든 트래픽을 처리합니다. eBPF를 사용해 커널에서 직접 패킷을 처리하므로 사용자 공간 프록시보다 효율적입니다.

Istio도 Ambient 모드를 선택하면 Sidecar 없이 Node당 ztunnel만 사용합니다. 이 경우 Cilium과 비슷한 아키텍처가 되어 리소스 효율이 크게 개선됩니다.

### 100개 Pod 기준 총 리소스

```bash
# Istio Sidecar (Pod당 100m CPU, 128Mi Memory)
총 CPU: 100 x 100m = 10,000m = 10 CPU
총 Memory: 100 x 128Mi = 12.8 Gi

# Linkerd (Pod당 20m CPU, 30Mi Memory)
총 CPU: 100 x 20m = 2,000m = 2 CPU
총 Memory: 100 x 30Mi = 3 Gi

# Istio Ambient (3 Node 기준, ztunnel만)
총 CPU: 3 x 50m = 150m = 0.15 CPU
총 Memory: 3 x 100Mi = 300 Mi

# Cilium (3 Node 기준, cilium-agent)
총 CPU: 3 x 100m = 300m = 0.3 CPU
총 Memory: 3 x 256Mi = 768 Mi
```

### 리소스 효율성 순위 (100 Pod, 3 Node 기준)

| 순위 | 솔루션 | CPU | Memory | 특징 |
|:----:|--------|-----|--------|------|
| 1 | **Istio Ambient** | 0.15 CPU | 0.3 Gi | Node당 ztunnel만 운영 |
| 2 | Cilium | 0.3 CPU | 0.8 Gi | Sidecar 없음, Node당 agent |
| 3 | Linkerd | 2 CPU | 3 Gi | Sidecar 있지만 경량 |
| 4 | Istio Sidecar | 10 CPU | 12.8 Gi | Pod마다 Envoy Sidecar |

리소스 효율성에서는 Istio Ambient가 1위입니다. Sidecar 없이 Node당 ztunnel만 운영하므로 Pod 수에 관계없이 리소스가 일정합니다. 100 Pod에서 10 CPU를 사용하던 Istio Sidecar 대비 98.5% 절감입니다.

Cilium도 Sidecar가 없어 효율적이지만, cilium-agent가 eBPF와 Envoy를 함께 운영하므로 ztunnel보다는 무겁습니다.

Linkerd는 Sidecar 방식이지만 Rust 프록시가 가벼워서 Istio Sidecar 대비 80% 절감됩니다.

---

## 🎭 철학과 접근 방식

### Istio: "Enterprise Feature-rich"

> **"모든 기능을 제공하고, 사용자가 선택하게 하자"**

| 장점 | 단점 |
|------|------|
| 가장 풍부한 기능 세트 | 학습 곡선이 가파름 |
| 세밀한 트래픽 제어 가능 | 설정이 복잡할 수 있음 |
| 대규모 기업 환경에서 검증됨 | 작은 팀에게는 과할 수 있음 |
| Ambient 모드로 리소스 문제 해결 | |

**적합한 경우**:
- ✅ 대규모 마이크로서비스 환경
- ✅ 세밀한 트래픽 제어 필요
- ✅ 전담 플랫폼 팀 보유
- ✅ 복잡한 보안 요구사항

Istio는 "부엌칼 세트"와 같습니다. 모든 종류의 칼이 있어서 어떤 요리도 할 수 있지만, 전문가가 아니면 어떤 칼을 써야 할지 헷갈립니다. 대규모 기업에서 전담 플랫폼 팀이 운영한다면 최적의 선택입니다.

### Linkerd: "Simplicity & Lightweight"

> **"필수 기능만 완벽하게, 심플하게"**

| 장점 | 단점 |
|------|------|
| 5분 안에 설치 가능 | 고급 기능 부족 (Circuit Breaker 등) |
| 경량 Rust 프록시 (메모리 효율적) | Rate Limiting 미지원 |
| 학습 곡선이 완만 | JWT 인증 미지원 |
| 운영 부담 최소화 | 커스터마이징 제한적 |

**적합한 경우**:
- ✅ 빠른 도입이 필요한 경우
- ✅ 작은 팀, 리소스 제한적
- ✅ mTLS + 관측성이 주 목적
- ✅ 운영 복잡도 최소화 원하는 경우

Linkerd는 "스위스 군용 칼"과 같습니다. 핵심 기능만 있지만 가볍고 실용적입니다. "일단 Service Mesh를 도입해보자"는 팀에게 최적입니다. 5분이면 설치되고, 바로 mTLS와 관측성을 얻을 수 있습니다.

### Cilium: "eBPF-native Networking"

> **"네트워킹을 커널 레벨에서 해결하자"**

| 장점 | 단점 |
|------|------|
| 최고의 네트워킹 성능 (eBPF) | CNI 교체 필요 (마이그레이션 복잡) |
| CNI + Service Mesh + Network Policy 통합 | 커널 버전 요구사항 |
| 사이드카 없음 (리소스 효율적) | L7 기능은 Envoy 필요 |
| 강력한 관측성 (Hubble) | 학습 곡선 존재 |

**적합한 경우**:
- ✅ 새 클러스터를 처음부터 구축
- ✅ 고성능 네트워킹이 중요
- ✅ Network Policy도 함께 관리
- ✅ 통합 네트워킹 스택 원하는 경우

Cilium은 "전문가용 장비"와 같습니다. 커널 레벨에서 작동하므로 성능이 뛰어나지만, 기존 CNI를 교체해야 합니다. 새 클러스터를 처음부터 구축한다면 가장 현대적이고 통합된 선택입니다.

---

## 🎯 선택 가이드

### 의사결정 플로우차트

![Service Mesh Decision Flow](/images/istio-ambient/mesh-decision-flow.svg)

위 플로우차트는 Service Mesh 선택을 위한 의사결정 과정입니다. 가장 먼저 새 클러스터 여부를 확인하는데, 새로 시작하면서 CNI도 함께 선택할 수 있다면 Cilium이 가장 현대적이고 통합된 선택입니다.

기존 클러스터라면 요구사항을 체크합니다. JWT 인증, Rate Limiting, Circuit Breaker 같은 고급 기능이 필요하면 Istio가 유일한 선택입니다. Linkerd는 이런 기능을 지원하지 않기 때문입니다.

전담 플랫폼 팀이 있다면 Istio의 복잡한 설정을 감당할 수 있으므로 Istio를 권장합니다. 반대로 작은 팀이거나 리소스가 제한적이라면 Linkerd가 적합합니다.

빠른 도입이 우선이라면 5분 안에 설치되는 Linkerd가 최선입니다. 그 외의 경우, 확장성과 미래 대비를 고려하면 Istio Ambient가 리소스 효율과 기능을 모두 갖춘 선택입니다.

### 팀 규모별 추천

| 팀 규모 | 추천 | 이유 |
|---------|------|------|
| 1-3명 | Linkerd | 운영 부담 최소화, 빠른 도입 |
| 4-10명 | Linkerd 또는 Istio Ambient | 팀 역량에 따라 선택 |
| 10명+ | Istio | 풍부한 기능 활용 가능 |
| 플랫폼팀 보유 | Istio 또는 Cilium | 복잡한 요구사항 대응 |

### 요구사항별 추천

| 요구사항 | 1순위 | 2순위 |
|----------|-------|-------|
| 빠른 도입 | Linkerd | Istio Ambient |
| 리소스 효율 | Istio Ambient | Cilium |
| 풍부한 기능 | Istio | Cilium |
| 고성능 네트워킹 | Cilium | Istio Ambient |
| 심플한 운영 | Linkerd | - |
| 새 클러스터 + 통합 | Cilium | - |

---

## 💡 Wealist에서 Istio Ambient를 선택한 이유

| 요구사항 | 결과 | 이유 |
|----------|------|------|
| JWT 인증 필요 (RequestAuthentication) | Linkerd 탈락 | JWT 미지원 |
| 리소스 제약 (소규모 클러스터) | Sidecar 방식 탈락 | 오버헤드가 너무 큼 |
| CNI 변경 불가 (기존 클러스터) | Cilium 탈락 | CNI 교체 필요 |
| AuthorizationPolicy 필요 | Istio 선택 | 세밀한 접근 제어 |
| 향후 확장성 (멀티클러스터 예정) | Ambient 모드 선택 | GA 달성, 안정화 |

Wealist 프로젝트에서 Service Mesh 선택은 소거법으로 진행했습니다. 가장 먼저 JWT 인증 요구사항 때문에 Linkerd가 탈락했습니다. Linkerd는 심플함을 추구하기 때문에 JWT, Rate Limiting 같은 기능을 의도적으로 지원하지 않습니다.

다음으로 Cilium을 검토했지만, 기존 클러스터에서 CNI를 교체하는 것은 리스크가 너무 컸습니다. CNI 변경은 모든 Pod의 네트워킹을 재구성해야 하므로 프로덕션 환경에서는 피하고 싶었습니다.

Istio가 선택되었지만, 소규모 클러스터에서 Pod마다 Envoy Sidecar를 붙이면 리소스 오버헤드가 너무 컸습니다. 마침 Istio Ambient가 2024년 11월에 GA가 되면서 프로덕션 사용이 가능해졌고, Sidecar 없이 Istio의 기능을 사용할 수 있게 되었습니다.

### Ambient 선택 후 해결한 과제

| 과제 | 해결 방법 | 상세 |
|------|-----------|------|
| JWT 인증 | RequestAuthentication + waypoint | HS512 → RSA 전환 (Part 5 참조) |
| Rate Limiting | 코드단 구현 | Redis + Gin Middleware (Part 6 참조) |
| 리소스 절감 | Ambient 전환 | Sidecar 12개 → ztunnel 3개 + waypoint 1개 |

Ambient 모드로 전환하면서 몇 가지 과제를 해결해야 했습니다. JWT 인증은 RequestAuthentication과 waypoint를 조합해서 구현했는데, 기존 HS512 방식이 Istio와 호환되지 않아 RS256으로 전환했습니다. 이 과정은 Part 5에서 자세히 다뤘습니다.

Rate Limiting은 예상 외의 난관이었습니다. Ambient 모드가 EnvoyFilter를 지원하지 않아서 Istio 레벨에서 Rate Limiting을 구현할 수 없었습니다. 결국 Redis와 Gin Middleware를 사용해 애플리케이션 레벨에서 구현했고, 이 과정은 Part 6에서 정리했습니다.

리소스 절감 효과는 기대 이상이었습니다. 12개의 Sidecar를 3개의 ztunnel과 1개의 waypoint로 교체하면서 CPU 87.5%, Memory 80%를 절감했습니다.

---

## 📚 정리

### 한눈에 보는 비교

| 항목 | Istio | Linkerd | Cilium |
|------|-------|---------|--------|
| 철학 | Feature-rich | Simplicity | eBPF-native |
| 프록시 | Envoy (C++) | Rust | eBPF + Envoy |
| 사이드카 | 있음/없음* | 있음 | 없음 |
| 리소스 | 높음/낮음* | 낮음 | 낮음 |
| 기능 | 최다 | 필수만 | 중간 |
| 복잡도 | 높음 | 낮음 | 중간 |
| 학습곡선 | 가파름 | 완만 | 중간 |

> *Ambient 모드 기준

**추천 상황**:
- **Istio**: 대규모 환경, 복잡한 요구사항, 전담 플랫폼팀 보유
- **Linkerd**: 빠른 도입, 심플함 우선, 작은 팀
- **Cilium**: 새 클러스터, 고성능 네트워킹, 통합 스택

세 솔루션 모두 CNCF Graduated 프로젝트로 프로덕션에서 검증되었습니다. 하지만 철학과 접근 방식이 완전히 다릅니다. Istio는 모든 기능을 제공하고 사용자가 선택하게 하는 반면, Linkerd는 필수 기능만 완벽하게 구현합니다. Cilium은 커널 레벨에서 문제를 해결하는 가장 현대적인 접근입니다.

어떤 것이 "정답"이라고 할 수 없습니다. 팀의 규모, 기술 역량, 요구사항에 따라 최적의 선택이 달라집니다. 작은 팀이라면 Linkerd의 심플함이 가치 있고, 대규모 기업이라면 Istio의 풍부한 기능이 필요합니다. 새로 시작한다면 Cilium이 가장 통합된 경험을 제공합니다.

### 핵심 메시지

> **"정답은 없다. 팀과 상황에 맞는 선택이 최선이다."**

- **Istio**: 기능이 풍부하고 Ambient로 리소스 문제도 해결됨
- **Linkerd**: 심플함의 가치를 아는 팀에게 최적
- **Cilium**: 새로 시작한다면 가장 현대적인 선택

---

## 🎯 Istio Ambient 시리즈 마무리

7편에 걸쳐 Istio Ambient를 다뤘습니다:

| Part | 주제 | 핵심 |
|------|------|------|
| 1 | Ambient 소개 | ztunnel, waypoint, 리소스 절감 |
| 2 | L4/L7 분리 | HBONE, Sidecar와 차이점 |
| 3 | 기능 비교 | EnvoyFilter 미지원, 선택 이유 |
| 4 | 마이그레이션 | 실제 전환 과정 |
| 5 | JWT 인증 | HS512→RSA, waypoint 설정 |
| 6 | Rate Limiting | Redis 기반 코드단 구현 |
| 7 | Mesh 비교 | Istio vs Linkerd vs Cilium |

이 시리즈는 Istio Ambient를 개념부터 실제 적용까지 단계별로 다뤘습니다. Part 1-2에서는 ztunnel과 waypoint의 아키텍처를 이해하고, Part 3에서는 Sidecar와의 기능 차이를 분석했습니다. Part 4에서는 실제 마이그레이션 과정을 따라가며 주의사항을 정리했습니다.

Part 5-6은 Ambient 특유의 도전 과제를 다뤘습니다. JWT 인증에서 HS512가 JWKS와 호환되지 않아 RS256으로 전환해야 했고, EnvoyFilter 미지원으로 Rate Limiting을 애플리케이션 레벨에서 직접 구현해야 했습니다. 이런 제약사항이 있지만, 80-90%의 리소스 절감이라는 큰 이점을 얻었습니다.

Istio Ambient는 Sidecar의 리소스 문제를 해결하면서도 Istio의 강력한 기능을 유지합니다. 2024년 11월 GA가 되면서 프로덕션 사용이 가능해졌고, Wealist에서 직접 적용해본 결과 80~90%의 리소스 절감 효과를 확인했습니다.

---

## 🔗 참고 자료

- [Istio Official Docs](https://istio.io/latest/docs/)
- [Linkerd Official Docs](https://linkerd.io/docs/)
- [Cilium Official Docs](https://docs.cilium.io/)
- [CNCF Service Mesh Landscape](https://landscape.cncf.io/card-mode?category=service-mesh)
- [Istio vs Linkerd Benchmark](https://linkerd.io/2021/05/27/linkerd-vs-istio-benchmarks/)
