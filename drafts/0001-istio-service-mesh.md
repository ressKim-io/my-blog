# Istio 서비스 메시 도입 아키텍처 결정 (ADR)

작성일: 2026-03-14
상태: Accepted
프로젝트: Goti (대규모 티켓팅 서비스)

---

## Decision Summary

| 결정 항목 | 선택 | 대안 | 핵심 근거 |
|-----------|------|------|-----------|
| 서비스 메시 | **Istio (Sidecar 모드)** | Linkerd, Cilium, 서비스 메시 미도입 | API Gateway 대체 (JWT+Rate Limit+mTLS 올인원), OTel 네이티브 통합 |
| 데이터 플레인 모드 | **Sidecar** | Ambient (ztunnel) | Ambient는 L7 메트릭/분산 트레이싱 불가 → 모니터링 운영 불가 |
| API Gateway 방식 | **Istio Gateway** | Spring Cloud Gateway, Kong | 인프라 레벨에서 언어 독립적으로 처리, 별도 게이트웨이 서비스 불필요 |

---

## 1. 배경 (Context)

### 현재 상황

Goti-server는 모놀리식에서 MSA로 전환 예정인 대규모 티켓팅 서비스다. 현재 다음과 같은 기능이 **없거나 부족**하다:

| 부족한 기능 | 현재 상태 | 필요한 이유 |
|------------|----------|------------|
| API Gateway | 없음 (직접 EC2로 요청) | MSA 전환 시 서비스 라우팅, 인증 게이트 필요 |
| Rate Limiting | 없음 | 티켓 오픈 시 트래픽 스파이크 방어 |
| JWT 검증 (Gateway 레벨) | Spring Security에서만 처리 | 각 서비스마다 중복 구현 필요 → Gateway에서 한 번에 처리 |
| mTLS (서비스 간 암호화) | 없음 | MSA에서 서비스 간 통신 보안 필수 |
| 서비스 간 트래픽 관리 | 없음 | Circuit breaker, retry, timeout 등 |

이 기능들을 **개별적으로** 구현하면:
- Rate Limiting → Bucket4j 또는 Redis 기반 직접 구현
- JWT 검증 → Spring Cloud Gateway + Spring Security
- mTLS → cert-manager + 수동 인증서 관리
- Circuit Breaker → Resilience4j
- 트래픽 관리 → Spring Cloud LoadBalancer

→ 5개 이상의 라이브러리/도구를 조합해야 하고, 서비스마다 설정이 분산된다.

### 핵심 질문

**이 모든 기능을 한 곳에서 인프라 레벨로 처리할 수 있는 도구가 있는가?**

---

## 2. 요구사항

| 요구사항 | 설명 | 중요도 |
|----------|------|--------|
| JWT 검증 (Gateway 레벨) | 서비스 도달 전에 토큰 유효성 검증, 각 서비스에서 중복 구현 방지 | 필수 |
| Rate Limiting | 티켓 오픈 시 초당 수만 요청 방어, global/local 모두 필요 | 필수 |
| mTLS | 서비스 간 통신 자동 암호화, 수동 인증서 관리 없이 | 필수 |
| 분산 트레이싱 연동 | Grafana Tempo 워터폴 뷰에서 서비스 간 호출 체인 시각화 | 필수 |
| L7 HTTP 메트릭 | status code, method, route별 메트릭 → Prometheus + Grafana 대시보드 | 필수 |
| Circuit Breaker | 장애 서비스 격리, 연쇄 장애 방지 | 중요 |
| 트래픽 관리 | 카나리 배포, 트래픽 미러링, fault injection (부하 테스트 활용) | 중요 |
| 언어 독립성 | MSA 전환 시 Java 외 서비스 추가 가능성 대비 | 중요 |
| K8s 네이티브 | ArgoCD GitOps 워크플로우에 자연스럽게 통합 | 중요 |
| OTel 호환 | 이미 구축한 Alloy → Prometheus/Loki/Tempo 파이프라인과 호환 | 필수 |

---

## 3. 대안 비교

### 3.1 서비스 메시 비교 매트릭스

| 항목 | Istio | Linkerd | Cilium |
|------|-------|---------|--------|
| **아키텍처** | Envoy sidecar (L7) | Rust micro-proxy (L7) | eBPF (L3/L4) + Envoy (L7) |
| **mTLS** | 자동 (설치 즉시) | 자동 (설치 즉시) | eBPF 기반 |
| **JWT 검증** | **RequestAuthentication CRD** | 미지원 (외부 도구 필요) | 미지원 (외부 도구 필요) |
| **Rate Limiting** | **EnvoyFilter (local/global)** | 미지원 | 미지원 |
| **AuthorizationPolicy** | **네이티브 RBAC** | Server 정책만 | CiliumNetworkPolicy |
| **분산 트레이싱** | OTel 네이티브 (Envoy → OTLP) | Prometheus 메트릭만 | eBPF 메트릭 (L4 위주) |
| **L7 HTTP 메트릭** | 자동 (istio_requests_total 등) | 자동 | Envoy 추가 시만 |
| **Circuit Breaker** | DestinationRule | 미지원 (외부) | 미지원 |
| **Fault Injection** | VirtualService | 미지원 | 미지원 |
| **트래픽 관리** | 카나리, 미러링, 가중치 라우팅 | 트래픽 분할만 | 기본적 라우팅 |
| **K8s Gateway API** | 지원 (구현체) | 지원 | 지원 |
| **리소스 사용량** | 높음 (Envoy sidecar) | **낮음 (Rust, 10배 적음)** | 중간 (eBPF) |
| **학습 곡선** | 높음 | 낮음 | 중간 |
| **CNCF 등급** | Graduated | Graduated | Graduated |

### 3.2 API Gateway 대안 비교

서비스 메시 없이 API Gateway만 도입하는 방안도 검토했다.

| 항목 | Istio Gateway | Spring Cloud Gateway | Kong |
|------|-------------|---------------------|------|
| **JWT 검증** | RequestAuthentication CRD | Spring Security 통합 | 플러그인 |
| **Rate Limiting** | EnvoyFilter (local/global) | Bucket4j/Redis | 내장 |
| **mTLS** | 자동 (메시 전체) | 수동 (cert-manager 별도) | 수동 |
| **서비스 간 통신 보안** | 메시 전체 자동 적용 | **게이트웨이까지만** (내부 통신 별도) | **게이트웨이까지만** |
| **Circuit Breaker** | DestinationRule | Resilience4j 통합 | 플러그인 |
| **분산 트레이싱** | OTel 네이티브 (서비스 간 전체) | Micrometer (게이트웨이만) | 플러그인 (게이트웨이만) |
| **언어 종속성** | 없음 (인프라 레벨) | **Java/Spring 전용** | 없음 |
| **배포 방식** | K8s CRD (GitOps 호환) | 별도 Spring 앱 배포 | Helm chart |
| **추가 인프라** | 없음 (Istio에 포함) | **별도 서비스 운영 필요** | **별도 서비스 운영 필요** |

### 3.3 시나리오별 적합도

| 시나리오 | 최적 선택 | 이유 |
|----------|-----------|------|
| MSA에서 JWT+Rate Limit+mTLS 통합 | **Istio** | 유일하게 세 기능 모두 인프라 레벨에서 제공 |
| 서비스 간 mTLS만 필요 | Linkerd | 가장 가볍고 빠름 |
| 고성능 L3/L4 네트워크 정책 | Cilium | eBPF 기반 커널 레벨 처리 |
| Java 모놀리식 + 단순 라우팅 | Spring Cloud Gateway | Spring 생태계 내에서 완결 |
| API 관리 + 개발자 포털 | Kong | API key, 사용량 추적, 포털 기능 |
| 분산 트레이싱 워터폴 시각화 | **Istio** | Envoy가 OTel trace를 자동 전파, Tempo 워터폴 뷰 완전 호환 |

---

## 4. Ambient Mesh를 선택하지 않은 이유

Istio의 차세대 데이터 플레인인 Ambient Mesh (ztunnel)도 검토했으나, **관측성(Observability) 한계로 채택하지 않았다.**

### 4.1 Sidecar vs Ambient 관측성 비교

| 관측 항목 | Sidecar (Envoy) | Ambient (ztunnel only) | Ambient + Waypoint |
|----------|-----------------|----------------------|-------------------|
| TCP 메트릭 (바이트, 연결 수) | O | O | O |
| **HTTP 메트릭** (status code, method, route) | **O (자동)** | **X** | O (Waypoint에서) |
| **분산 트레이싱** (trace propagation) | **O (자동)** | **X** | **부분적** — workload name 누락 |
| **OTel OTLP export** | O (Envoy 네이티브) | X | O (Waypoint Envoy) |
| Access Log (L7) | O (HTTP 상세) | TCP 레벨만 | O |
| mTLS | O | O | O |

### 4.2 핵심 문제: 분산 트레이싱 워터폴 뷰 불가

Goti 프로젝트는 Grafana Tempo의 **워터폴(Waterfall) 트레이스 뷰**를 핵심 시각화로 사용한다. 이 뷰는 서비스 간 호출 체인을 시간 축으로 펼쳐서 보여주는 것으로, **각 span에 워크로드(서비스) 이름이 정확히 표시**되어야 의미가 있다.

```
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
│  ┌─ ??? (workload name 누락) ──┐               │
│  │  ┌─ PostgreSQL query ──┐   │               │
│  │  └─────────────────────┘   │               │
│  └─────────────────────────────┘               │
│  ┌─ waypoint-proxy-yyyyy ──────────────────┐   │
│  │  ┌─ ??? ─────────────┐                 │   │
│  │  └───────────────────┘                 │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

**Ambient + Waypoint를 사용해도**:
- trace에서 workload name이 누락되어 **어떤 서비스에서 지연이 발생했는지 식별 불가**
- ztunnel(L4)과 waypoint(L7)이 동시 리포트 → **텔레메트리 이중 엣지** 발생, 트래픽 그래프 왜곡
- ztunnel에서의 L7 HTTP 파싱은 **Solo Enterprise(상용) 전용** — 커뮤니티 Istio에서는 미지원

### 4.3 판단

| 기준 | Sidecar | Ambient |
|------|---------|---------|
| 워터폴 트레이스 정상 표시 | **O** | X (workload name 누락) |
| 추가 구성 없이 L7 관측 | **O** | X (Waypoint 필수) |
| 텔레메트리 중복 없음 | **O** | X (이중 엣지) |
| 메모리/CPU 효율 | X (sidecar 오버헤드) | **O (70-90% 절감)** |

**리소스 효율보다 관측성이 우선이다.** 모니터링이 안 되면 다음 리소스 계획이나 장애 추적이 불가능하고, 이는 대규모 티켓팅 서비스 운영에서 치명적이다. Ambient Mesh의 리소스 절감 이점은 있지만, 현재(2026-03) 커뮤니티 Istio의 Ambient 모드는 관측성 측면에서 프로덕션 수준에 도달하지 못했다.

---

## 5. 결정 (Decision)

**Istio Sidecar 모드**를 서비스 메시 + API Gateway로 채택한다.

### 선택 이유 요약

1. **올인원**: JWT 검증 + Rate Limiting + mTLS + Circuit Breaker + 트래픽 관리를 하나의 도구에서 제공. 별도 API Gateway 서비스 운영 불필요
2. **OTel 네이티브 통합**: Envoy가 OTLP trace를 직접 export → 이미 구축한 Alloy → Tempo 파이프라인과 자연스럽게 연결. Grafana 워터폴 뷰에서 서비스 간 호출 체인 완벽 시각화
3. **인프라 레벨 처리**: 애플리케이션 코드 수정 없이 K8s CRD로 정책 적용. Java 외 서비스 추가 시에도 동일하게 적용
4. **GitOps 호환**: VirtualService, DestinationRule, RequestAuthentication 등 모두 YAML CRD → ArgoCD로 선언적 관리
5. **부하 테스트 활용**: Fault Injection (VirtualService)으로 장애 시나리오 시뮬레이션, 별도 도구 불필요

### Linkerd/Cilium을 선택하지 않은 이유

| 대안 | 미선택 이유 |
|------|-----------|
| **Linkerd** | JWT 검증, Rate Limiting, Circuit Breaker 미지원 → 별도 도구 조합 필요, 올인원 이점 상실 |
| **Cilium** | L3/L4 중심 → HTTP 수준 정책(JWT, Rate Limit) 미지원. L7은 Envoy 추가 필요하면 Istio와 복잡도 유사 |

### Spring Cloud Gateway/Kong을 선택하지 않은 이유

| 대안 | 미선택 이유 |
|------|-----------|
| **Spring Cloud Gateway** | Java 종속, 별도 서비스 운영 필요, mTLS/서비스 간 보안은 여전히 미해결, 분산 트레이싱은 게이트웨이까지만 |
| **Kong** | 별도 서비스 운영 필요, mTLS는 게이트웨이-백엔드 구간만, 서비스 간 통신 보안은 별도 구현 필요 |

---

## 6. 결과 (Consequences)

### 긍정적 영향

- goti-server에 API Gateway 코드를 직접 구현할 필요 없음 → 백엔드 팀은 비즈니스 로직에 집중
- MSA 전환 시 서비스 간 보안(mTLS)이 자동 적용 → 보안 설정 누락 방지
- Grafana 워터폴 뷰에서 전체 호출 체인 시각화 → 성능 병목 즉시 파악
- 카나리 배포, fault injection 등 고급 트래픽 관리 → 안정적 배포 전략 가능
- CRD 기반 설정 → ArgoCD GitOps와 완벽 통합, 설정 변경 이력 추적

### 부정적 영향 / 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| 리소스 오버헤드 | 각 Pod에 Envoy sidecar 추가 (CPU/Memory) | Kind dev 환경에서 충분히 수용 가능 (32GB), EKS 전환 시 노드 스펙 계획에 반영 |
| 학습 곡선 | VirtualService, DestinationRule 등 Istio CRD 학습 필요 | .claude/skills/service-mesh/ 에 실전 패턴 198개 축적 |
| 디버깅 복잡도 | sidecar 관련 문제 (503, RBAC 등) 트러블슈팅 | Kiali, istioctl analyze 활용, dev-logs에 트러블슈팅 기록 축적 |
| Ambient 전환 비용 | 향후 Ambient가 성숙해도 sidecar → ambient 전환 작업 필요 | Istio 공식 마이그레이션 가이드 제공 예정, 당분간 sidecar 유지 |

### 향후 과제

- [ ] Istio RequestAuthentication으로 JWT 검증 CRD 작성
- [ ] EnvoyFilter로 Rate Limiting 정책 구성 (티켓 오픈 시나리오)
- [ ] AuthorizationPolicy로 서비스 간 접근 제어 (RBAC)
- [ ] Ambient Mesh 성숙도 재평가 (2026 하반기, trace workload name 이슈 해결 여부 확인)
- [ ] 부하 테스트에서 VirtualService fault injection 활용

---

## 7. 참고 자료

- [Istio 공식: Sidecar or Ambient?](https://istio.io/latest/docs/overview/dataplane-modes/)
- [Istio 공식: Rate Limiting](https://istio.io/latest/docs/tasks/policy-enforcement/rate-limit/)
- [Istio as API Gateway (OneUptime)](https://oneuptime.com/blog/post/2026-02-24-how-to-use-istio-as-an-api-gateway/view)
- [Service Meshes Decoded: Istio vs Linkerd vs Cilium (LiveWyer)](https://livewyer.io/blog/service-meshes-decoded-istio-vs-linkerd-vs-cilium/)
- [OTel + Envoy/Istio 통합 (OpenTelemetry Blog)](https://opentelemetry.io/blog/2024/new-otel-features-envoy-istio/)
- [Ambient Mesh Observability 한계](https://ambientmesh.io/docs/observability/)
- [Ambient ztunnel L7 관측 — Solo Enterprise 전용](https://docs.solo.io/gloo-mesh/main/ambient/observability/layer7/)
- [Kiali: Ambient Mesh trace 갭](https://kiali.io/docs/features/ambient/)
- [Istio Roadmap 2025-2026](https://istio.io/latest/blog/2025/roadmap/)
- [Goti 버전 매트릭스](../version-matrix.md) — Istio 1.29.0, K8s 1.34 호환성 확인
