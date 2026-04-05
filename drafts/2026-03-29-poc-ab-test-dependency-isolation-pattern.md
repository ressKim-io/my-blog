---
date: 2026-03-29
category: decision
project: goti-team-project
tags: [ab-test, service-mesh, istio, traffic-routing, multi-tenancy, dependency-isolation]
---

# POC A/B 비교 테스트에서 의존성 서비스 격리가 필요한 이유 — 업계 패턴과 Goti 적용

## 배경

3개 대기열 구현체(수연/준상/성전)를 Kind K8s + Istio 환경에서 동시 배포하여 부하테스트로 비교하는 과정에서,
**"대기열 서비스만 교체하면 공정 비교가 될 것"이라는 가정이 틀렸다**는 것을 발견했다.

수연 POC 테스트 성공 후, 준상 POC에서 ticketing API가 403/400으로 실패.
원인: 공유 ticketing 서비스(goti-ticketing-dev)에 수연 구현체 고유 로직(ReservationSession 검증)이 침투해 있어서,
준상 대기열을 통과한 요청이 ticketing 단계에서 차단.

**해결**: 구현체별 전용 ticketing pod를 분리 배포하고, Istio path rewrite로 트래픽 격리.

이것은 실무에서 **서비스 메시 기반 A/B 테스트**의 전형적인 패턴이며,
Uber, DoorDash, Netflix, Lyft 등 대규모 MSA 운영 기업들이 공통적으로 겪고 해결한 문제다.

## 핵심 학습

> 구현체만 교체하면 공정 비교가 될 것이라는 가정은 위험하다.
> 의존하는 서비스에 구현체 고유 로직이 침투해 있으면, **의존성 체인 전체를 격리**해야 한다.

---

## 1. 업계 패턴 분류

### 1-1. Request-Level Routing (요청 수준 라우팅)

전체 서비스 스택을 복제하지 않고, **요청 헤더에 메타데이터를 삽입**하여 특정 요청만 테스트 대상 서비스로 라우팅.
가장 비용 효율적이며 대규모 기업들이 수렴한 핵심 패턴.

**Uber — SLATE (Short-Lived Application Testing Environment)**
- 프로덕션 환경 안에 테스트 인스턴스를 배포
- **Jaeger Baggage (`request-tenancy` 헤더)**로 테스트 트래픽 구분
- Edge Gateway가 tenancy를 인식하면 `routing-overrides`를 Jaeger Baggage에 추가
- 콜 트리 전체에 tenancy가 투명하게 전파 — 의존 서비스 체인 전체 격리
- Kafka, 로깅, 메트릭, 알림 시스템 모두 tenancy 인식

**DoorDash — Multi-Tenancy Architecture**
- **OpenTelemetry context propagation**으로 tenancy context를 모든 트래픽에 추가
- 서비스 메시가 테스트 트래픽을 특정 환경으로 자동 라우팅
- "프로덕션 안에서 테스트하는 것이 유일하게 스케일 가능한 방법" — DoorDash 엔지니어링 결론

**Lyft — Staging Overrides**
- 공유 스테이징 환경에서 PR별로 실험 코드를 offloaded deployment로 배포 (서비스 디스커버리에 미등록)
- 클라이언트가 **Context ID 헤더**를 추가하면, 서비스 메시가 컨트롤 플레인에 쿼리하여 라우팅 수정
- 전체 복제 대신 변경된 서비스만 배포 — 나머지는 기존 베이스라인 사용

### 1-2. Multi-Tenancy (멀티 테넌시)

data-in-flight(요청, 메시지 큐)과 data-at-rest(스토리지, 캐시)를 **tenancy로 논리적 격리**하여 동일 인프라에서 여러 실험 동시 운영.

**Uber — 2,200+ 마이크로서비스 멀티테넌시**
- 활용 범위: 통합 테스트, 섀도우 트래픽, 트래픽 녹화/재생, 용량 계획, 성능 예측
- 데이터 격리: 테넌시별 DB 스키마 분리, Redis DB 번호 분리, Kafka 토픽 분리

### 1-3. Traffic Mirroring / Shadow Traffic (트래픽 미러링)

실제 프로덕션 트래픽의 **복사본**을 새 버전에 보내서 결과를 비교. 미러링된 응답은 버려서 사용자 영향 없음.

**Netflix — Shadow Deployment**
- 새 추천 엔진 배포 시, 프로덕션 트래픽을 기존 엔진과 섀도우 버전 양쪽에 미러링
- CPU/메모리 사용량, 레이턴시, 처리량, DB 영향, 에러 패턴을 비교 후 정식 배포 결정
- Feature Flag와 결합하여 점진적 활성화

Istio에서 기본 지원:
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

단, **상태 변경(write)**이 있는 서비스는 순수 미러링이 부적합. 별도 DB/캐시로 격리 필요.

### 1-4. Progressive Delivery / Flagger 자동화

A/B 테스트 + Canary를 **메트릭 기반으로 자동화**. Prometheus 메트릭 모니터링 → 성공률/레이턴시 임계값 초과 시 자동 롤백.

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

### 1-5. Sandbox / Ephemeral Environment (샌드박스)

PR마다 **경량 격리 환경**을 자동 생성. 변경된 서비스만 배포하고, 의존 서비스는 공유 베이스라인 사용.

**Signadot** — 변경된 서비스만 Sandbox로 배포, HTTP 헤더 기반 요청 수준 격리, 비용 90% 절감.

---

## 2. Goti POC의 현재 접근법

### 격리 구조

| 격리 계층 | 방식 | 업계 패턴 대응 |
|-----------|------|---------------|
| **트래픽** | Istio path rewrite (`/queue/suyeon`, `/queue/junsang`) | Request-Level Routing (path 기반) |
| **데이터** | Redis DB 번호 분리 (0/1/2) | Multi-Tenancy (data-at-rest) |
| **컴퓨팅** | 구현체별 전용 pod (goti-queue-{name}-dev) | Sandbox (변경 서비스만 배포) |
| **의존성** | ticketing pod 분리 (goti-ticketing-junsang-dev) | Uber SLATE (의존 체인 격리) |

### 발견한 문제와 해결

```
[문제] 공유 ticketing pod에 수연 구현체의 ReservationSession 검증이 내장
       → 준상 대기열을 통과한 요청이 ticketing에서 403/400

[해결] 구현체별 ticketing pod 분리 배포
       /junsang/api/v1/** → rewrite /api/v1/** → goti-ticketing-junsang-dev
       Redis DB 1 공유 (queue ↔ ticketing 간 토큰 검증 가능)
```

이 해결법은 Uber의 SLATE 패턴과 본질적으로 동일:
- "변경된 서비스 + 그 서비스에 의존성이 걸린 서비스"를 함께 격리
- 나머지(user, stadium 등)는 공유 베이스라인 사용

---

## 3. 업계 패턴 vs 현재 Goti POC 비교

| 항목 | Uber/DoorDash/Lyft | Netflix | Goti POC (현재) |
|------|-------------------|---------|----------------|
| **라우팅 방식** | 헤더 기반 (Jaeger Baggage, OTel context) | Feature Flag + Weight | Path 기반 (`/queue/suyeon`, `/junsang/api/v1`) |
| **데이터 격리** | Tenancy별 DB/캐시/Kafka 분리 | Shadow 환경 별도 | Redis DB 번호 분리 (0/1/2) |
| **인프라 비용** | 변경 서비스만 추가 배포 | 미러링 (추가 인프라 최소) | 구현체별 queue + ticketing pod 배포 |
| **트래픽 전환** | 헤더 하나로 즉시 전환 | Weight 점진적 조절 | URL 경로 변경 (K6 env var) |
| **관측성** | Tenancy별 메트릭/로그 자동 분리 | 프로덕션 vs Shadow 비교 | 서비스별 Grafana 대시보드 |

### 현재 POC의 강점

1. **Redis DB 격리가 업계 data-at-rest 테넌시 패턴과 정확히 일치**
2. 구현체별 독립 Deployment로 **리소스 사용량(CPU/메모리) 공정 비교 용이**
3. Istio path rewrite로 각 구현체에 **동일한 내부 API 경로 유지** — 코드 수정 없이 라우팅만으로 격리
4. K6 환경변수(`QUEUE_IMPL`)로 **테스트 대상 즉시 전환**

### 개선 가능 방향 (프로덕션 적용 시)

1. **Path → Header 기반 전환**: 동일 URL에 `X-Queue-Variant: junsang` 헤더만 바꿔서 라우팅. 클라이언트 URL 변경 불필요
2. **OTel Baggage 활용**: 이미 OTel이 구축되어 있으므로, Baggage로 variant 정보를 전파하면 의존 서비스 체인 전체 자동 격리 (Uber/DoorDash 패턴)
3. **Flagger 도입**: POC 결정 후 프로덕션 배포 시 메트릭 기반 progressive delivery 자동화
4. **Traffic Mirroring**: 읽기 전용 API는 Istio mirror로 성능 비교 (write 있는 API는 별도 DB 격리 필요)

---

## 4. 의사결정 원칙 정리

### A/B 테스트 시 의존성 격리 체크리스트

```
1. 테스트 대상 서비스가 의존하는 서비스 목록을 식별한다
2. 각 의존 서비스에 "구현체 고유 로직"이 있는지 확인한다
   - 인터셉터, 세션 검증, 커스텀 필터 등
   - DB 스키마, Redis 키 구조, 메시지 포맷 차이
3. 고유 로직이 있는 의존 서비스는 구현체별로 분리 배포한다
4. 데이터 계층도 격리한다 (Redis DB, DB 스키마, Kafka 토픽)
5. 격리 범위를 최소화한다 — 변경 없는 서비스는 공유 베이스라인 사용
```

### "교체하면 되겠지"가 실패하는 이유

MSA에서 서비스 간 계약(contract)은 API 스펙만이 아니다.
**암묵적 의존성**이 존재한다:

- 세션/토큰 형식 (수연: JWE, 준상: Redis Sorted Set + UUID 토큰)
- Redis 키 패턴 (구현체마다 다른 키 구조)
- 인터셉터/미들웨어 (QueueInterceptor, ReservationSession)
- 인증 방식 (JWT 직접 검증 vs Mesh 헤더 신뢰)

이런 암묵적 의존성은 API 스펙에 드러나지 않으므로,
**실제 트래픽을 흘려봐야만 발견**된다.

---

## 참고 자료

- [Uber - Multi-tenancy in Microservice Architecture](https://www.uber.com/blog/multitenancy-microservice-architecture/)
- [Uber - Simplifying Developer Testing Through SLATE](https://www.uber.com/blog/simplifying-developer-testing-through-slate/)
- [DoorDash - Multi-tenancy Architecture for Testing in Production](https://medium.com/@dmosyan/how-doordash-uses-multi-tenancy-architecture-to-test-in-production-279f503a021b)
- [Lyft - Building a Control Plane for Shared Development Environment](https://eng.lyft.com/building-a-control-plane-for-lyfts-shared-development-environment-6a40266fcf5e)
- [Netflix - Testing in Production the Netflix Way](https://launchdarkly.com/blog/testing-in-production-the-netflix-way/)
- [Istio - Traffic Mirroring](https://istio.io/latest/docs/tasks/traffic-management/mirroring/)
- [Flagger - Istio A/B Testing](https://docs.flagger.app/tutorials/istio-ab-testing)
- [Signadot - Creating Sandboxes in Kubernetes at Scale](https://www.signadot.com/blog/creating-sandboxes-in-kubernetes-at-scale/)
