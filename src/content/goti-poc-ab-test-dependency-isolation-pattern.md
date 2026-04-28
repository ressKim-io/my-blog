---
title: "POC A/B 테스트 의존성 격리 패턴 — Uber/DoorDash/Netflix는 어떻게 푸는가"
excerpt: "대기열 구현체만 교체하면 공정 비교가 될 것이라는 가정이 POC 현장에서 깨졌습니다. 공유 ticketing에 특정 구현체 로직이 침투해 있었고, 이를 업계의 Request-Level Routing/Multi-Tenancy/Mirroring 패턴과 비교해 분리 전략을 정리한 기록입니다."
category: challenge
tags:
  - go-ti
  - POC
  - Architecture
  - Isolation
  - Pattern
  - troubleshooting
date: "2026-02-24"
---

## 한 줄 요약

> POC A/B/C 대기열 구현체를 Kind + Istio 위에서 동시에 부하테스트하면서, 공유 ticketing pod에 특정 구현체 고유 로직이 침투해 다른 POC 트래픽을 차단하는 문제를 겪었습니다. Uber SLATE, DoorDash Multi-Tenancy, Netflix Shadow, Lyft Staging Overrides 같은 업계 패턴과 비교해 "의존성 체인 전체를 격리해야 한다"는 원칙을 확인하고, 구현체별 ticketing pod 분리 + Istio path rewrite로 해결했습니다.

---

## 🔥 문제: "구현체만 교체하면 된다"는 가정의 실패

### 기존 기대

3개 대기열 구현체(POC A, POC B, POC C)를 Kind K8s + Istio 환경에 동시 배포하여 부하테스트로 공정 비교하는 것이 목표였습니다.

처음 설계는 단순했습니다.

- 대기열 서비스만 구현체별로 교체합니다.
- 나머지 의존 서비스(ticketing, user, stadium)는 그대로 공유합니다.
- 트래픽만 구현체별로 라우팅하면 공정 비교가 된다고 가정했습니다.

"대기열 구현체만 A/B/C로 바꾸고 부하테스트하면 공정 비교가 된다"는 전제였습니다.

### 실제로 벌어진 일

POC C 부하테스트는 성공적으로 완료했습니다. 그런데 POC A 부하테스트로 넘어가자 ticketing API가 연쇄적으로 실패했습니다.

```text
POST /api/v1/queue/poc-a/validate → 200 (대기열 통과)
POST /api/v1/ticketing/reserve    → 403 / 400 (ticketing 차단)
```

대기열 단계는 통과했는데, **공유 ticketing pod**가 요청을 거부했습니다.

### 원인의 정체

공유 `goti-ticketing-dev` pod 내부에 POC C 고유의 `ReservationSession` 검증 로직이 이미 녹아 있었습니다. POC C 토큰 형식(JWE)과 Redis 키 구조를 전제로 동작하던 인터셉터였습니다.

POC A의 대기열 토큰(Redis Sorted Set + UUID)이 ticketing에 도달하자, ticketing 쪽 인터셉터가 "내가 아는 형식이 아니다"라고 판단해 요청을 차단한 것입니다.

공유 서비스에 특정 구현체의 **암묵적 전제**가 박혀 있으면, 다른 구현체 요청은 그대로 깨집니다.

---

## 🤔 원인: MSA에서 "계약"은 API 스펙만이 아니다

### 암묵적 의존성의 실체

MSA에서 서비스 간 계약은 OpenAPI 스펙만이 아닙니다. 문서에 드러나지 않는 **암묵적 의존성**이 존재합니다.

- **세션/토큰 형식**: POC C는 JWE, POC A는 Redis Sorted Set + UUID 토큰입니다.
- **Redis 키 패턴**: 구현체마다 키 네이밍과 자료구조가 다릅니다.
- **인터셉터/미들웨어**: `QueueInterceptor`, `ReservationSession` 등 스프링 컴포넌트가 특정 구현체를 전제로 동작합니다.
- **인증 방식**: JWT 직접 검증과 Mesh 헤더 신뢰 방식이 섞입니다.

이런 전제는 API 스펙 문서에 적히지 않습니다. **실제 트래픽을 흘려봐야만 발견됩니다.**

### 왜 "교체만 하면 된다"가 틀리는가

공유 ticketing이 POC C 토큰만 이해한다면, ticketing은 더 이상 "POC와 무관한 공유 서비스"가 아닙니다. 이미 POC C에 결합된 서비스입니다.

이 상태에서 POC A 요청을 흘리면, 공정 비교가 아니라 **"POC C 호환성 테스트"**가 됩니다. POC A/B의 점수는 실제 성능이 아니라 "얼마나 POC C처럼 보이느냐"로 결정됩니다.

이 문제는 저희만의 것이 아닙니다. Uber, DoorDash, Netflix, Lyft 같은 대규모 MSA 조직이 모두 같은 함정을 만나 각자의 해결 패턴을 정립했습니다.

---

## 🧭 선택지 비교 — 업계의 다섯 가지 패턴

POC 격리를 어떻게 설계할 수 있는지, 업계에서 수렴된 패턴 다섯 가지를 먼저 살펴보고 그중 어느 축을 저희 POC에 적용했는지 정리합니다.

### 고려한 옵션

| 옵션 | 핵심 아이디어 | 장점 | 한계 |
|------|---------------|------|------|
| A. Request-Level Routing | 헤더 메타데이터로 요청 단위 라우팅 (Uber SLATE, DoorDash, Lyft) | 인프라 복제 최소, 콜 트리 전체에 tenancy 전파 | OTel/Baggage 전파 인프라와 서비스 메시 연동 필요 |
| B. Multi-Tenancy | data-in-flight + data-at-rest를 tenancy로 격리 (Uber 2,200+ 서비스) | 동일 인프라에서 여러 실험 병행, 데이터까지 분리 | DB 스키마/Redis DB/Kafka 토픽 등 모든 계층 설계 필요 |
| C. Traffic Mirroring | 프로덕션 트래픽 복사본을 신버전에 전달 (Netflix Shadow) | 사용자 영향 없이 실전 트래픽 검증 | write 경로는 별도 DB/캐시 없이 불가 |
| D. Progressive Delivery / Flagger | Prometheus 메트릭 기반 Canary 자동화, 임계값 초과 시 자동 롤백 | 메트릭 기반 자동 의사결정, 프로덕션 안정성 | POC 단계에서는 "자동 롤백"보다 "구현체 비교"가 목적이라 오버스펙 |
| E. Sandbox / Ephemeral | PR마다 변경 서비스만 배포, 나머지는 베이스라인 공유 (Signadot 등) | 비용 90% 절감, 변경 범위 최소화 | 공유 서비스에 tenancy 인식 로직이 전제됨 |

**옵션 A — Request-Level Routing**은 요청 헤더(Jaeger Baggage, OTel context)에 tenancy 메타데이터를 실어 의존 체인 전체에 전파합니다. Uber SLATE는 프로덕션 안에 테스트 인스턴스를 띄우고 `request-tenancy` 헤더로 구분하며, DoorDash는 "프로덕션 안에서 테스트하는 것이 유일하게 스케일 가능한 방법"이라는 결론에 도달했습니다. Lyft는 Context ID 헤더로 서비스 메시가 컨트롤 플레인에 쿼리해 라우팅을 수정합니다.

**옵션 B — Multi-Tenancy**는 통합 테스트, 섀도우 트래픽, 트래픽 녹화/재생, 용량 계획, 성능 예측에 활용됩니다. 테넌시별로 DB 스키마를 분리하고, Redis DB 번호를 나누고, Kafka 토픽을 분리합니다. data-in-flight과 data-at-rest를 **모두** 격리하는 것이 핵심입니다.

**옵션 C — Traffic Mirroring**은 Netflix Shadow 배포의 핵심입니다. Istio에서도 기본 지원됩니다.

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
spec:
  http:
  - route:
    - destination:
        host: queue-service
        subset: current
    mirror:
      host: queue-service
      subset: new-impl
    mirrorPercentage:
      value: 100.0
```

미러링된 응답은 버려지므로 사용자 영향은 없지만, **상태 변경(write)**이 있는 서비스는 순수 미러링이 부적합합니다. 별도 DB/캐시로 격리해야 합니다.

**옵션 D — Progressive Delivery / Flagger**는 A/B 테스트와 Canary를 Prometheus 메트릭 기반으로 자동화합니다. 성공률·레이턴시 임계값을 벗어나면 자동 롤백이 동작합니다. 다만 이번 POC는 **구현체 3종의 성능 비교**가 목적이지 점진적 배포 안전성 확보가 목적이 아닙니다.

**옵션 E — Sandbox**는 Signadot 같은 도구로 구현됩니다. 변경된 서비스만 Sandbox로 배포하고 HTTP 헤더 기반 요청 격리를 사용해 비용 90% 절감을 달성합니다. 다만 전제는 **공유 서비스가 이미 tenancy를 인식**하고 있다는 점입니다.

### 저희 POC의 제약

- 대기열은 write-heavy합니다. 토큰 발급, Redis 상태 갱신, Kafka 발행이 있습니다. 순수 미러링(C)은 바로 적용이 어렵습니다.
- 공유 ticketing이 이미 POC C 로직과 결합돼 있어, 공유 서비스를 그대로 두는 Sandbox(E) 접근은 불가합니다.
- OTel/Baggage 전파는 이미 구축 중이지만, POC 단계에서는 서비스 메시 라우팅과 결합할 시간이 없습니다(A 풀 적용 보류).
- Flagger(D)의 자동 롤백은 POC 목적(구현체 비교)에 오버스펙이며, 프로덕션 진입 후 도입 예정으로 미룹니다.
- Kind + Istio 위에서 1주 내 3개 구현체 부하테스트를 돌려야 합니다.

### 결정 기준과 최종 선택

**B(Multi-Tenancy)의 핵심 원칙을 POC 규모에 맞게 축약해 적용했습니다.**

결정 기준은 다음 우선순위입니다.

1. **1주 내 3개 구현체 공정 비교**를 완결할 수 있는가.
2. **write 경로의 데이터 오염**을 피할 수 있는가.
3. **코드 수정 최소**(구현체 코드에 손대지 않고) 라우팅만으로 격리할 수 있는가.

B는 data-at-rest 격리(Redis DB 번호 분리)로 write 오염을 막고, 컴퓨팅 격리(구현체별 pod)로 리소스 사용량까지 공정 비교를 가능하게 합니다. A의 "의존 체인 격리" 원칙을 차용해 ticketing pod까지 구현체별로 분리 배포합니다.

트래픽 라우팅은 OTel Baggage(A)가 아니라 **Istio path rewrite**로 단순화합니다. POC 단계에서는 path 기반이 가장 저렴한 선택입니다. 프로덕션 도입 시 헤더 기반으로 전환하면 됩니다.

---

## ✅ 해결: 의존 체인 전체를 격리한 POC 구조

### 4계층 격리

| 격리 계층 | 방식 | 업계 패턴 대응 |
|-----------|------|---------------|
| **트래픽** | Istio path rewrite (`/queue/poc-c`, `/queue/poc-a`) | Request-Level Routing (path 기반) |
| **데이터** | Redis DB 번호 분리 (0/1/2) | Multi-Tenancy (data-at-rest) |
| **컴퓨팅** | 구현체별 전용 pod (`goti-queue-<variant>-dev`) | Sandbox (변경 서비스만 배포) |
| **의존성** | ticketing pod 분리 (`goti-ticketing-<variant>-dev`) | Uber SLATE (의존 체인 격리) |

네 계층을 모두 격리한 이유를 하나씩 풀어보겠습니다.

**트래픽 계층**은 Istio VirtualService의 path rewrite로 해결합니다. 클라이언트(K6)는 `/queue/poc-c/...` 같은 경로를 사용하고, Istio가 이를 `/queue/...`로 rewrite해 각 구현체 pod으로 전달합니다. 구현체 코드는 내부 API 경로가 그대로 `/queue/...`이므로 수정이 필요 없습니다.

**데이터 계층**은 Redis DB 번호(0/1/2)로 분리합니다. 동일 Redis 인스턴스를 쓰지만 논리 DB가 분리되므로, 구현체 간 키 충돌이 없습니다. 이는 Uber의 tenancy별 Redis 분리와 동일한 패턴입니다.

**컴퓨팅 계층**은 구현체별 독립 Deployment입니다. 리소스 사용량(CPU/메모리)을 공정 비교하려면 Pod가 분리돼야 합니다. 하나의 Pod에서 프로파일만 바꾸는 방식은 이전 실행의 JVM 상태가 다음 실행에 영향을 줄 수 있어 배제했습니다.

**의존성 계층**이 이 글의 핵심입니다. ticketing pod까지 구현체별로 분리해야 합니다.

### ticketing 분리 구조

**문제** — 공유 `goti-ticketing-dev` pod에 POC C의 `ReservationSession` 검증이 내장되어 있어, POC A 대기열을 통과한 요청이 ticketing에서 403/400으로 차단되었습니다.

**해결** — 구현체별 ticketing pod를 분리 배포했습니다. 예를 들어 POC A는 다음 경로를 거칩니다.

1. `/poc-a/api/v1/**` 요청이 들어옵니다
2. Istio가 `/api/v1/**`로 rewrite해 `goti-ticketing-poc-a-dev`로 전달합니다
3. queue ↔ ticketing이 Redis DB 1을 공유해 토큰을 검증합니다

POC A 대기열과 POC A ticketing은 같은 Redis DB 1을 공유합니다. 두 서비스가 서로의 토큰 형식을 이해해야 하기 때문입니다. POC C 대기열과 POC C ticketing은 Redis DB 0을 공유합니다. 구현체 경계 안에서는 상태를 나누고, 경계 바깥에서는 완전히 분리됩니다.

이 구조는 Uber SLATE 패턴과 본질적으로 동일합니다. "변경된 서비스 + 그 서비스에 의존성이 걸린 서비스"를 함께 격리하고, 나머지(user, stadium 등 구현체 무관 서비스)는 공유 베이스라인을 사용합니다.

### 현재 POC와 업계 패턴 비교

| 항목 | Uber/DoorDash/Lyft | Netflix | 저희 POC |
|------|-------------------|---------|---------|
| **라우팅** | 헤더 기반 (Jaeger Baggage, OTel context) | Feature Flag + Weight | Path 기반 (`/queue/poc-c`, `/poc-a/api/v1`) |
| **데이터 격리** | Tenancy별 DB/캐시/Kafka 분리 | Shadow 환경 별도 | Redis DB 번호 분리 (0/1/2) |
| **인프라 비용** | 변경 서비스만 추가 배포 | 미러링 (추가 인프라 최소) | 구현체별 queue + ticketing pod 배포 |
| **트래픽 전환** | 헤더 하나로 즉시 전환 | Weight 점진적 조절 | URL 경로 변경 (K6 env var) |
| **관측성** | Tenancy별 메트릭/로그 자동 분리 | 프로덕션 vs Shadow 비교 | 서비스별 Grafana 대시보드 |

**현재 POC의 강점**을 하나씩 보겠습니다.

- **Redis DB 번호 격리**는 업계 data-at-rest 테넌시 패턴과 정확히 일치합니다.
- 구현체별 독립 Deployment로 **리소스 사용량(CPU/메모리) 공정 비교**가 용이합니다.
- Istio path rewrite로 각 구현체에 **동일한 내부 API 경로**를 유지합니다. 코드 수정 없이 라우팅만으로 격리합니다.
- K6 환경변수(`QUEUE_IMPL`)로 **테스트 대상 즉시 전환**이 가능합니다.

**프로덕션 적용 시 개선 방향**은 다음과 같습니다.

- **Path → Header 기반 전환**: 동일 URL에 `X-Queue-Variant: poc-a` 같은 헤더만 바꿔서 라우팅합니다. 클라이언트 URL 변경이 불필요합니다.
- **OTel Baggage 활용**: 이미 OTel이 구축되어 있으므로, Baggage로 variant 정보를 전파하면 의존 서비스 체인 전체가 자동 격리됩니다(Uber/DoorDash 패턴).
- **Flagger 도입**: POC 결정 후 프로덕션 배포 시 메트릭 기반 progressive delivery를 자동화합니다.
- **Traffic Mirroring 결합**: 읽기 전용 API는 Istio mirror로 성능을 비교합니다. write가 있는 API는 별도 DB 격리가 필요합니다.

Flagger 설정 예시는 다음과 같습니다.

```yaml
apiVersion: flagger.app/v1beta1
kind: Canary
spec:
  analysis:
    match:
    - headers:
        x-user-type:
          exact: "beta"
    metrics:
    - name: request-success-rate
      thresholdRange:
        min: 99
    - name: request-duration
      thresholdRange:
        max: 500
```

Prometheus 메트릭을 모니터링하다가 성공률/레이턴시 임계값을 넘으면 자동 롤백됩니다. POC 단계에서는 과투자지만, 프로덕션 점진 배포 단계에서는 필수 도구입니다.

---

## 📚 배운 점

- **"구현체만 교체하면 공정 비교가 된다"는 가정은 위험합니다.** 의존하는 서비스에 구현체 고유 로직이 침투해 있으면, 의존성 체인 전체를 격리해야 공정 비교가 성립합니다.
- **MSA의 계약은 OpenAPI 스펙만이 아닙니다.** 세션/토큰 형식, Redis 키 패턴, 인터셉터/미들웨어, 인증 방식 같은 암묵적 의존성이 존재하며, 실제 트래픽을 흘려봐야만 드러납니다.
- **A/B 테스트 시 의존성 격리 체크리스트**를 먼저 돌립니다.
  1. 테스트 대상이 의존하는 서비스 목록을 식별합니다.
  2. 각 의존 서비스에 구현체 고유 로직(인터셉터, 세션 검증, 커스텀 필터)이 있는지 확인합니다.
  3. 고유 로직이 있는 의존 서비스는 구현체별로 분리 배포합니다.
  4. 데이터 계층(Redis DB, DB 스키마, Kafka 토픽)도 함께 격리합니다.
  5. 변경 없는 서비스는 공유 베이스라인을 유지해 격리 범위를 최소화합니다.
- **업계 패턴은 참고하되 규모에 맞게 축약합니다.** Uber SLATE의 Baggage 전파, DoorDash의 OTel context, Lyft의 Context ID는 큰 조직의 완성형입니다. POC 규모에서는 Multi-Tenancy의 data-at-rest 격리 + Istio path rewrite 조합이 가장 빠른 경로입니다.
- **프로덕션 진입 시 경로를 미리 염두에 둡니다.** Path 기반 라우팅은 POC에서는 싸고 빠르지만, 프로덕션에서는 Header 기반 + OTel Baggage + Flagger로 옮겨가야 의존 체인이 자동 전파되고 progressive delivery가 가능해집니다.

---

## 참고 자료

- [Uber — Multi-tenancy in Microservice Architecture](https://www.uber.com/blog/multitenancy-microservice-architecture/)
- [Uber — Simplifying Developer Testing Through SLATE](https://www.uber.com/blog/simplifying-developer-testing-through-slate/)
- [DoorDash — Multi-tenancy Architecture for Testing in Production](https://medium.com/@dmosyan/how-doordash-uses-multi-tenancy-architecture-to-test-in-production-279f503a021b)
- [Lyft — Building a Control Plane for Shared Development Environment](https://eng.lyft.com/building-a-control-plane-for-lyfts-shared-development-environment-6a40266fcf5e)
- [Netflix — Testing in Production the Netflix Way](https://launchdarkly.com/blog/testing-in-production-the-netflix-way/)
- [Istio — Traffic Mirroring](https://istio.io/latest/docs/tasks/traffic-management/mirroring/)
- [Flagger — Istio A/B Testing](https://docs.flagger.app/tutorials/istio-ab-testing)
- [Signadot — Creating Sandboxes in Kubernetes at Scale](https://www.signadot.com/blog/creating-sandboxes-in-kubernetes-at-scale/)
