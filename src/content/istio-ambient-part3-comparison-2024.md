---
title: "Istio Ambient Part 3: Sidecar vs Ambient 기능 비교 (2024.12 기준)"
excerpt: "Istio 1.24 GA 기준 Sidecar와 Ambient의 기능 비교, 제한사항, 선택 기준"
category: "kubernetes"
tags: ["istio", "ambient-mesh", "sidecar", "comparison", "service-mesh", "kubernetes"]
series:
  name: "istio-ambient"
  order: 3
date: "2025-12-24"
---

## 🎯 시작하며

Ambient Mode가 2024년 11월 Istio 1.24에서 GA(Generally Available)가 되었습니다. 이제 프로덕션에서 사용할 수 있다는 의미입니다. 하지만 모든 기능이 Sidecar와 동일하지는 않습니다.

이번 Part에서 다루는 핵심 질문들:

1. 현재(2024.12) Ambient에서 지원하지 않는 것은?
2. EnvoyFilter를 쓰고 있다면?
3. 언제 Ambient를 선택하고, 언제 Sidecar를 유지해야 할까?
4. 우리 프로젝트(Wealist)는 왜 Ambient를 선택했나?

---

## 📊 기능 비교표 (2024.12 기준)

### 핵심 기능

| 기능 | Sidecar | Ambient | 비고 |
|------|:-------:|:-------:|------|
| mTLS | ✅ | ✅ | ztunnel에서 처리 |
| SPIFFE ID | ✅ | ✅ | 동일 |
| AuthorizationPolicy (L4) | ✅ | ✅ | ztunnel에서 처리 |
| AuthorizationPolicy (L7) | ✅ | ✅ | waypoint 필요 |
| VirtualService | ✅ | ✅ | waypoint 필요 |
| DestinationRule | ✅ | ✅ | waypoint 필요 |
| JWT (RequestAuthentication) | ✅ | ✅ | waypoint 필요 |
| 메트릭 (Prometheus) | ✅ | ✅ | |
| 트레이싱 (Jaeger) | ✅ | ✅ | |
| Access Log | ✅ | ✅ | |

핵심 기능 측면에서 Ambient는 Sidecar와 거의 동등합니다. mTLS, SPIFFE ID 같은 보안 기능은 ztunnel에서 완전히 지원되고, AuthorizationPolicy, VirtualService 같은 L7 기능은 waypoint를 통해 지원됩니다.

"비고" 열에서 "ztunnel에서 처리"라고 표시된 기능은 waypoint 없이 사용할 수 있습니다. mTLS와 L4 AuthorizationPolicy가 여기에 해당합니다. 반면 "waypoint 필요"라고 표시된 기능은 L7 처리가 필요하므로 해당 서비스에 waypoint를 배포해야 합니다.

실무적으로 대부분의 서비스는 mTLS와 기본 AuthZ만 필요하므로 ztunnel만으로 충분합니다. JWT 인증이나 HTTP 라우팅이 필요한 일부 서비스에만 waypoint를 추가하면 됩니다.

### 제한사항

| 기능 | Sidecar | Ambient | 비고 |
|------|:-------:|:-------:|------|
| EnvoyFilter | ✅ | ❌ | 미지원 |
| WASM Plugin | ✅ | ⏳ | 지원 예정 |
| 멀티클러스터 | ✅ | ⚠️ | Alpha (1.27+) |
| 외부 컨트롤 플레인 | ✅ | ⏳ | 지원 예정 |
| Sidecar 리소스 | ✅ | ❌ | 해당 없음 |
| PeerAuthentication (Pod) | ✅ | ⚠️ | Namespace 레벨만 |

제한사항은 Ambient 전환 여부를 결정하는 가장 중요한 요소입니다. ❌는 현재 지원하지 않고 대안이 필요하다는 의미이고, ⏳는 향후 지원 예정이니 기다릴 수 있다는 의미입니다.

EnvoyFilter는 가장 큰 제한입니다. Sidecar의 Envoy 설정을 직접 수정하는 강력한 도구인데, ztunnel은 Envoy가 아니므로 적용 자체가 불가능합니다. 커스텀 Rate Limiting, Lua 스크립트, 특수 헤더 조작 등에 EnvoyFilter를 사용 중이라면 대안을 마련해야 합니다.

멀티클러스터는 여러 Kubernetes 클러스터를 하나의 메시로 연결하는 기능입니다. 대기업에서 리전별로 클러스터를 운영할 때 자주 사용합니다. Istio 1.27부터 Alpha로 지원되기 시작했지만, 프로덕션에서는 아직 Sidecar 방식이 더 안정적입니다.

Sidecar 리소스는 특정 Pod의 egress 트래픽을 세밀하게 제어하는 CRD입니다. Ambient에서는 Pod 레벨 설정이 불가능하고 Namespace 레벨에서만 정책을 적용할 수 있습니다.

---

## ⚠️ EnvoyFilter 미지원

### 문제

**Sidecar에서 EnvoyFilter 사용 예:**
- 커스텀 Rate Limiting
- 특수한 헤더 조작
- Lua 스크립트 실행
- 커스텀 로깅 포맷
- 특수한 라우팅 로직

**Ambient에서는?**
- ztunnel은 Envoy가 아님 (Rust 기반) → EnvoyFilter 적용 불가
- waypoint는 Envoy지만 EnvoyFilter 미적용
- 커스텀 Envoy 설정 불가

> ❌ **EnvoyFilter 사용 중이면 Ambient 전환이 어렵습니다**

### 대안

| 기능 | Sidecar | Ambient 대안 |
|------|---------|--------------|
| **Rate Limiting** | EnvoyFilter + Ratelimit 서비스 | 애플리케이션 레벨 구현 (Redis 기반) |
| **헤더 조작** | EnvoyFilter | VirtualService headers 설정 |
| **커스텀 로깅** | EnvoyFilter | Telemetry API 또는 애플리케이션 로깅 |
| **특수 라우팅** | EnvoyFilter | VirtualService로 가능하면 OK, 불가능하면 Sidecar 유지 |

EnvoyFilter를 사용 중이라면 기능별로 대안을 검토해야 합니다.

Rate Limiting은 가장 흔한 EnvoyFilter 사용 사례입니다. Sidecar에서는 Envoy의 ratelimit 필터를 직접 설정할 수 있지만, Ambient에서는 불가능합니다. 대안은 애플리케이션 레벨에서 Redis를 사용해 직접 구현하는 것입니다. Part 6에서 Sliding Window Counter 알고리즘으로 구현하는 방법을 자세히 다룹니다.

헤더 조작의 경우, 단순한 헤더 추가/제거는 VirtualService의 headers 설정으로 가능합니다. 예를 들어 응답에 특정 헤더를 추가하거나, 요청 헤더를 수정하는 작업은 VirtualService로 처리할 수 있습니다. 하지만 복잡한 조건부 로직이 필요하면 EnvoyFilter가 필요하므로 Sidecar를 유지해야 합니다.

커스텀 로깅은 Istio의 Telemetry API로 대부분 해결됩니다. 로그 포맷을 커스터마이징하거나 특정 필드를 추가하는 것이 가능합니다. 그래도 부족하면 애플리케이션 레벨에서 structured logging을 구현하는 것이 더 유연할 수 있습니다.

---

## ⚠️ 멀티클러스터 미지원

![Multicluster Comparison](/images/istio-ambient/multicluster-sidecar.svg)

| 모드 | 멀티클러스터 | 클러스터간 mTLS | 상태 |
|------|:------------:|:---------------:|------|
| **Sidecar** | ✅ 지원 | ✅ 지원 | 프로덕션 Ready |
| **Ambient** | ❌ 미지원 | ❌ 미지원 | 2025년 지원 예정 |

멀티클러스터는 여러 Kubernetes 클러스터를 하나의 서비스 메시로 연결하는 기능입니다. 예를 들어 Cluster A의 주문 서비스가 Cluster B의 결제 서비스를 직접 호출할 수 있게 됩니다. 이 과정에서 클러스터 경계를 넘는 mTLS 암호화와 서비스 디스커버리가 자동으로 처리됩니다.

Sidecar 모드에서는 이미 멀티클러스터가 완전히 지원됩니다. 각 클러스터의 Sidecar가 상대 클러스터의 서비스와 mTLS로 안전하게 통신합니다. 하지만 Ambient 모드에서는 아직 이 기능이 구현되지 않았습니다. ztunnel 간의 클러스터 경계 통신 프로토콜이 아직 완성되지 않았기 때문입니다.

> **멀티클러스터 환경이라면**: 현재로서는 Sidecar를 유지하거나, 2025년 Ambient 멀티클러스터 지원까지 대기해야 합니다.

---

## 🤔 Ambient 선택 기준

### Ambient가 적합한 경우

| 조건 | 설명 | 이유 |
|------|------|------|
| ✅ 리소스 절감 필요 | 비용 절감 목표, Pod 수가 많음 | 80-90% 리소스 절감 효과 |
| ✅ 기본 기능만 사용 | mTLS, VirtualService, AuthZ, JWT | 모두 Ambient에서 지원 |
| ✅ EnvoyFilter 미사용 | 커스텀 Envoy 설정 없음 | Ambient는 EnvoyFilter 미지원 |
| ✅ 단일 클러스터 | 멀티클러스터 환경 아님 | 멀티클러스터는 아직 미지원 |
| ✅ 신규 프로젝트 | 처음부터 Ambient로 시작 | 마이그레이션 부담 없음 |
| ✅ 운영 간소화 | Sidecar 관리, 업그레이드 부담 | ztunnel DaemonSet만 관리 |

Ambient Mode는 "적게 관리하고, 적게 쓰고, 기본 기능 충실히" 원칙에 맞는 환경에서 최적입니다. Pod가 100개라면 Sidecar 100개를 관리하는 대신 Node당 1개의 ztunnel만 관리하면 됩니다. 업그레이드 시에도 Sidecar는 Pod 재시작이 필요하지만, ztunnel은 DaemonSet 롤링 업데이트로 끝납니다.

특히 mTLS와 기본적인 라우팅만 필요한 경우, Ambient의 L4 처리만으로 충분합니다. waypoint 없이도 대부분의 보안 요구사항을 충족할 수 있어 리소스 효율이 극대화됩니다.

### Sidecar를 유지해야 하는 경우

| 조건 | 사용 사례 | 영향 |
|------|-----------|------|
| ⚠️ EnvoyFilter 사용 | Rate Limiting, Lua 스크립트, 커스텀 Envoy 설정 | 대안 없으면 전환 불가 |
| ⚠️ 멀티클러스터 | 클러스터 간 통신, 글로벌 로드밸런싱 | 2025년까지 대기 필요 |
| ⚠️ WASM Plugin | 커스텀 플러그인 | 지원 예정이나 시기 불확실 |
| ⚠️ Pod 레벨 PeerAuth | 특정 Pod만 다른 mTLS 설정 | Namespace 레벨만 지원 |
| ⚠️ Sidecar 리소스 | Egress 트래픽 세밀한 제어 | 해당 기능 없음 |

위 조건 중 하나라도 해당되면 Ambient 전환을 신중하게 검토해야 합니다. 특히 EnvoyFilter는 Envoy 내부 설정을 직접 조작하는 강력한 도구인데, ztunnel은 Envoy가 아니라 Rust로 작성된 별도 프록시입니다. 따라서 EnvoyFilter 설정을 적용할 방법이 원천적으로 없습니다.

멀티클러스터 환경에서는 아직 선택의 여지가 없습니다. 여러 클러스터 간 통신이 필요하다면 현재로서는 Sidecar를 유지해야 합니다. 다만 Istio 커뮤니티에서 2025년 내 멀티클러스터 지원을 목표로 개발 중이므로, 단일 클러스터부터 Ambient로 시작하고 나머지는 지원 후 전환하는 전략도 고려할 수 있습니다.

---

## 💡 Wealist 프로젝트의 선택

### 프로젝트 상황

| 항목 | 내용 |
|------|------|
| 서비스 규모 | 마이크로서비스 10+ 개 |
| 클러스터 | 단일 클러스터 |
| 보안 요구사항 | mTLS + JWT 인증 |
| 추가 요구사항 | Rate Limiting |

Wealist는 10개 이상의 마이크로서비스로 구성된 프로젝트입니다. 단일 클러스터에서 운영되며, 서비스 간 mTLS 암호화와 JWT 기반 사용자 인증이 필수였습니다. 그리고 API 남용을 방지하기 위해 Rate Limiting도 필요했습니다.

### 문제와 결정

| 고민 | 결정 | 이유 |
|------|------|------|
| Sidecar 리소스 부담 | ✅ Ambient 선택 | 80% 리소스 절감 가능 |
| Rate Limiting 필요 | ✅ 애플리케이션 레벨 구현 | EnvoyFilter 대안으로 Go + Redis |

가장 큰 고민은 Rate Limiting이었습니다. Sidecar 모드에서는 EnvoyFilter로 Envoy 레벨에서 처리할 수 있지만, Ambient에서는 불가능합니다. 두 가지 선택지가 있었습니다:

1. Sidecar를 유지하고 EnvoyFilter로 Rate Limiting 구현
2. Ambient를 선택하고 애플리케이션 레벨에서 Rate Limiting 직접 구현

리소스 절감 효과가 컸기 때문에 2번을 선택했습니다. Rate Limiting은 Go와 Redis를 사용해 Sliding Window Counter 알고리즘으로 직접 구현했습니다. (상세 구현은 Part 6에서 다룹니다)

### 트레이드오프

| 얻은 것 | 잃은 것 |
|---------|---------|
| 80% 리소스 절감 | Rate Limiting 직접 구현 필요 |
| 운영 복잡도 감소 | 애플리케이션 코드 증가 |
| 업그레이드 간소화 | 인프라 레벨 Rate Limiting 불가 |

결과적으로 좋은 선택이었다고 생각합니다. 직접 구현한 Rate Limiting은 비즈니스 로직과 더 긴밀하게 통합할 수 있었고, 리소스 절감으로 클러스터 비용도 줄었습니다.

---

## 📈 마이그레이션 고려사항

### Sidecar → Ambient 전환 시

| 순서 | 확인 항목 | 명령어 | 결과별 조치 |
|:----:|-----------|--------|-------------|
| 1 | EnvoyFilter | `kubectl get envoyfilter -A` | 있으면 대안 마련 후 전환 |
| 2 | WASM Plugin | `kubectl get wasmplugin -A` | 있으면 Sidecar 유지 또는 대기 |
| 3 | Sidecar 리소스 | `kubectl get sidecar -A` | egress 제어 사용 시 대안 검토 |
| 4 | 멀티클러스터 | 아키텍처 검토 | 멀티클러스터면 Sidecar 유지 |
| 5 | L7 기능 서비스 | VS, JWT 사용 서비스 파악 | waypoint 배포 계획 수립 |
| 6 | 점진적 전환 | - | 일부 Namespace부터 시작 |

마이그레이션은 한 번에 모든 것을 바꾸는 것이 아닙니다. Sidecar와 Ambient는 같은 클러스터 내에서 공존할 수 있습니다. 이 특성을 활용해 점진적으로 전환하는 것이 안전합니다.

1. **사전 점검**: 위 표의 1-4번 항목을 먼저 확인합니다. 블로커가 있으면 해결하거나 해당 서비스는 Sidecar로 유지합니다.
2. **waypoint 계획**: VirtualService나 JWT를 사용하는 서비스를 파악하고, 어떤 waypoint를 배포할지 계획합니다.
3. **테스트 Namespace**: 가장 단순한 서비스가 있는 Namespace부터 Ambient로 전환합니다.
4. **점진적 확대**: 문제가 없으면 다음 Namespace로 확대합니다.

### 공존 가능

```yaml
# Sidecar Namespace
apiVersion: v1
kind: Namespace
metadata:
  name: legacy
  labels:
    istio-injection: enabled   # Sidecar 방식

# Ambient Namespace
apiVersion: v1
kind: Namespace
metadata:
  name: new-services
  labels:
    istio.io/dataplane-mode: ambient   # Ambient 방식

# 두 Namespace 간 통신 OK
# mTLS는 양쪽에서 동작
```

---

## 📊 성능 비교

### 레이턴시 (P50)

| 모드 | 추가 레이턴시 | 경로 | 비고 |
|------|:-------------:|------|------|
| Sidecar | +1.5ms | 앱 → Sidecar → Network → Sidecar → 앱 | 기준 |
| Ambient L4 | +0.8ms | 앱 → ztunnel → Network → ztunnel → 앱 | **45% 감소** |
| Ambient L7 | +1.8ms | 앱 → ztunnel → waypoint → ztunnel → 앱 | Sidecar와 유사 |

레이턴시 차이의 핵심은 L4 처리입니다. ztunnel은 Rust로 작성되어 Envoy보다 가볍고, TCP 레벨에서만 처리하므로 오버헤드가 적습니다. L7 기능(HTTP 라우팅, JWT 등)이 필요한 경우 waypoint를 경유하게 되어 Sidecar와 비슷한 레이턴시가 됩니다.

따라서 mTLS만 필요한 서비스에서 가장 큰 성능 이점을 얻을 수 있습니다. 반대로 모든 서비스에 waypoint가 필요하다면 성능 이점은 크지 않습니다.

### 리소스 사용량 (Pod 100개, Node 5개 기준)

| 항목 | Sidecar | Ambient | 절감률 |
|------|---------|---------|:------:|
| 메모리 | 12.8Gi (128Mi × 100) | 1.28Gi (256Mi × 5) | **90%** |
| CPU | 10 CPU (100m × 100) | 0.5 CPU (100m × 5) | **95%** |

리소스 절감은 Ambient의 가장 강력한 장점입니다. Sidecar는 Pod마다 배포되므로 Pod 수에 비례해 리소스가 증가합니다. 반면 ztunnel은 Node당 1개만 배포되므로, Pod가 아무리 많아도 Node 수에만 비례합니다.

실제로 Pod 100개, Node 5개 환경에서 메모리는 90%, CPU는 95% 절감됩니다. 대규모 클러스터일수록 이 차이는 더 커집니다.

---

## 📚 정리

### 선택 가이드 플로우차트

![Ambient Decision Flow](/images/istio-ambient/ambient-decision-flow.svg)

| 단계 | 질문 | Yes | No |
|:----:|------|-----|-----|
| 1 | EnvoyFilter 사용? | Sidecar 유지 또는 대안 마련 | 다음 단계 |
| 2 | 멀티클러스터? | Sidecar 유지 (2025년 대기) | 다음 단계 |
| 3 | 리소스 절감 필요? | Ambient 강력 추천 | 둘 다 가능 |

선택 결정은 위 플로우차트를 따르면 됩니다.

1. **EnvoyFilter를 사용 중인가요?** EnvoyFilter로 Rate Limiting, 커스텀 로깅, Lua 스크립트 등을 구현했다면 Ambient로 직접 전환할 수 없습니다. 대안을 마련하거나 해당 서비스는 Sidecar로 유지해야 합니다.

2. **멀티클러스터 환경인가요?** 여러 클러스터 간 통신이 필요하다면 현재는 Sidecar만 선택 가능합니다. 2025년 멀티클러스터 지원까지 기다리거나, 단일 클러스터부터 Ambient로 시작하세요.

3. **리소스 절감이 중요한가요?** 위 두 조건을 통과했다면 Ambient를 강력히 추천합니다. 80-90%의 리소스 절감은 클라우드 비용에 직접적인 영향을 줍니다.

---

## 🎯 핵심 정리

| 기준 | Sidecar | Ambient |
|------|---------|---------|
| **EnvoyFilter** | ✅ 지원 | ❌ 미지원 |
| **멀티클러스터** | ✅ 지원 | ❌ 미지원 (예정) |
| **WASM** | ✅ 지원 | ⏳ 예정 |
| **리소스** | 높음 | 80-90% 절감 |
| **운영 복잡도** | 높음 | 낮음 |
| **레이턴시** | 기본 | L4 시 더 낮음 |

Sidecar와 Ambient 중 어떤 것을 선택할지는 위 표로 판단할 수 있습니다.

EnvoyFilter나 멀티클러스터가 필수라면 현재로서는 Sidecar를 선택해야 합니다. 이건 협상의 여지가 없는 하드 블로커입니다. WASM Plugin을 사용 중이라면 지원 예정이므로 기다리거나, 당장 필요하면 Sidecar를 유지해야 합니다.

반면 위 기능들이 필요 없다면 Ambient를 강력히 추천합니다. 80-90%의 리소스 절감은 클라우드 비용에 직접적인 영향을 줍니다. 운영 복잡도도 크게 낮아져서 업그레이드나 디버깅이 훨씬 쉬워집니다.

레이턴시 측면에서도 L4 처리만 필요한 경우(mTLS + 기본 AuthZ) Ambient가 더 빠릅니다. L7 기능을 사용하면 Sidecar와 비슷해지지만, 그래도 리소스 이점은 유지됩니다.

---

## 🔗 다음 편 예고

Part 4에서는 **Wealist를 Ambient로 마이그레이션**하는 실제 과정을 다룹니다:
- 마이그레이션 단계별 진행
- 주의사항과 롤백 전략
- 모니터링 설정

---

## 🔗 참고 자료

- [Istio Ambient Mode GA](https://istio.io/latest/blog/2024/ambient-reaches-ga/)
- [Istio Feature Status](https://istio.io/latest/docs/releases/feature-stages/)
- [Ambient vs Sidecar](https://istio.io/latest/docs/ambient/overview/)
