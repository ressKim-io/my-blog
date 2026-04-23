---
title: "대기열 POC 부하테스트 (1): K6 테스트 설계와 의존성 격리"
excerpt: "3개 대기열 구현체를 공정하게 비교하기 위한 K6 2-Phase 설계와 의존성 격리 삽질기"
category: kubernetes
tags:
  - Load-Test
  - K6
  - Queue
  - POC
  - Istio
  - Service-Isolation
  - Spring-Security
  - troubleshooting
series:
  name: "queue-poc-loadtest"
  order: 1
date: '2026-03-29'
---

## 🎯 한 줄 요약

> 3개 대기열 구현체를 K6로 부하테스트 비교하기 위해 2-Phase 아키텍처를 설계했고, "구현체만 교체하면 공정 비교가 된다"는 가정이 틀렸음을 발견했습니다.

## 📊 배경

goti-server에서 3명이 각각 다른 대기열을 구현했습니다.

| 구현체 | 개발자 | 핵심 방식 | PR |
|--------|--------|----------|-----|
| A | Josuyeon | JWE 토큰 + 분산 락 + CDN 캐싱 | #309 |
| B | AkiStory | Redis ZSET + Heartbeat + 이벤트 승격 | #311 |
| C | Junsang | Redis Hash + Scheduler 승격 | #312 |

부하테스트의 목적은 두 가지였습니다:

1. **E2E 검증**: 각 구현체가 대기열 → 예매 → 결제 전체 플로우에서 정상 동작하는지
2. **성능 비교**: 구현체 간 순수 대기열 처리량, Redis 부하, 응답 시간 차이

환경은 Kind K8s + Istio + ArgoCD. 이 두 가지를 동시에 커버하는 K6 스크립트 구조가 필요했습니다.

---

## 🔧 K6 테스트 아키텍처 설계

### 3가지 구조 옵션

파일 구조를 어떻게 잡을지 고민했습니다.

| 옵션 | 방식 | 파일 수 | 장점 | 단점 |
|------|------|---------|------|------|
| **A** | 사람별 × 시나리오별 개별 파일 | 15개 | 파일별 독립성 | 코드 중복 극심 |
| **B** | 시나리오별 1파일 + `QUEUE_IMPL` 환경변수 | 9개 | 중복 최소화 | K6 static import 제약 |
| **C** | E2E는 사람별 + 비교만 `QUEUE_IMPL` 패턴 | 9개 | 두 장점 결합 | 두 패턴 혼재 |

### Option C 선택

**Option C(혼합 패턴)**를 선택했습니다.

왜냐하면 E2E와 비교 시나리오의 성격이 다르기 때문입니다.

E2E 시나리오는 구현체마다 API 엔드포인트, 토큰 방식, 세션 처리가 전부 달라서 사람별 커스터마이징이 필수입니다. 반면 비교 시나리오는 "동일 조건에서 구현체만 교체"해야 하므로 환경변수 패턴이 적합합니다.

### Phase 1: E2E 스크립트

사람별 헬퍼 3개 + 시나리오 3개 = 6파일. 공통 인터페이스를 설계했습니다:

```
enterQueue() → waitForAdmission() → enterSeat() → [ticketing] → leaveQueue()
```

이 인터페이스 뒤에서 각 헬퍼가 PR별 API 차이를 처리합니다:

| 단계 | A | B | C |
|------|------|------|------|
| enterQueue | POST /queue/enter | POST /queues/enter?gameId= | POST /queue/validate |
| 승격 판단 | queueNumber ≤ publishedRank | heartbeat 병행 + secureToken | 서버 스케줄러 자동 |
| enterSeat | 명시적 호출 | 명시적 호출 | no-op (Interceptor 처리) |
| leaveQueue | 명시적 호출 | 명시적 호출 | no-op (Spring Event) |

A은 진입 시 JWE 토큰을 발급하고, B은 heartbeat로 세션을 유지하고, C은 인터셉터가 자동 처리하는 구조입니다.
같은 "대기열"이지만 내부 메커니즘이 완전히 달랐습니다.

### Phase 2: 비교 시나리오

`QUEUE_IMPL` 환경변수로 구현체를 전환하는 3개 시나리오를 만들었습니다:

| 시나리오 | 목적 | 핵심 측정 |
|----------|------|----------|
| `spike-queue.js` | 5000 VU 스파이크 | 순수 대기열 처리 한계 |
| `queue-only.js` | 대기열 처리량 + TTL 회수 | Redis 부하, 슬롯 회전 |
| `soldout-queue.js` | 매진 시뮬레이션 | 대기열 생명주기 전체 |

실행 방법:

```bash
# E2E (사람별)
$ ./load-tests/run.sh queue-josuyeon

# 비교 시나리오 (QUEUE_IMPL 자동 설정)
$ ./load-tests/run.sh spike-josuyeon
$ VUS=2000 POLL_INTERVAL=0.5 ./load-tests/run.sh queueonly-junsang
```

**`POLL_INTERVAL` 환경변수**가 핵심입니다. 폴링 간격(기본 1초)을 0.5초~2초로 조절하면 Redis SCAN vs O(1) 방식의 부하 차이가 극명하게 드러납니다.

### 최종 파일 구조

```
load-tests/
  helpers/
    queue-josuyeon.js    # PR #309 대기열 액션
    queue-akistory.js    # PR #311 대기열 액션
    queue-junsang.js     # PR #312 대기열 액션
  scenarios/
    queue-josuyeon.js    # E2E (대기열→예매→결제)
    queue-akistory.js    # E2E
    queue-junsang.js     # E2E
    spike-queue.js       # 비교: 스파이크 (QUEUE_IMPL 패턴)
    queue-only.js        # 비교: 대기열만 (QUEUE_IMPL 패턴)
    soldout-queue.js     # 비교: 매진 (QUEUE_IMPL 패턴)
  run.sh                 # 18개 시나리오 조합 지원
```

하나 아쉬운 점은 K6의 **static import 제약**입니다. 비교 시나리오에서 3개 헬퍼를 모두 import해야 합니다 — 실제로 사용하지 않는 구현체의 코드도 함께 로드되는 것입니다. 런타임에 동적 import가 불가능한 K6의 한계입니다.

---

## 🔥 "구현체만 교체하면 되겠지"가 틀린 이유

설계를 끝내고 실제 테스트를 시작하자마자 문제가 터졌습니다.

A POC는 300/1000/3000 VU saturation 테스트를 무사히 통과했습니다.
그런데 **C POC**로 전환하니까 401이 뜨기 시작했습니다.

### 1차: 401 Empty Body — Spring Security 미등록

```
POST /api/v1/queue/junsang/validate → 401 (empty body)
```

모든 queue API가 401. 응답 body가 비어있었습니다. 뭐지?

Istio 레벨 차단인가? 확인해보니 A과 동일한 requestAuthentication 설정이었고, A은 정상 동작 중이니 기각.

**Spring Security 기본 보안**이 원인이었습니다.

C의 queue 모듈은 독립 Spring Boot 앱으로 분리되었는데, `scanBasePackages`에 핵심 패키지들이 누락되어 있었습니다:

```java
@SpringBootApplication(scanBasePackages = {
    "com.goti.queue",      // queue 패키지
    "com.goti.config",     // WebConfig
    "com.goti.infra",      // Redis 등
    // ...
    // com.goti.user.config.security  ← SecurityConfig 누락!
    // com.goti.controller             ← Controller 누락!
    // com.goti.service                ← Service 누락!
})
```

Spring Security starter가 의존성에 포함되어 있는데 `SecurityConfig` bean이 등록 안 되면, **기본 보안이 활성화**되어 모든 요청을 401로 차단합니다.

### 2차: QueueService bean not found

1차 수정에서 `com.goti.controller`만 추가하고 `com.goti.service`를 빠뜨렸습니다.
CrashLoopBackOff:

```
Parameter 0 of constructor in com.goti.controller.QueueController
required a bean of type 'com.goti.service.QueueService' that could not be found.
```

`scanBasePackages`에 `com.goti.service` 추가로 해결.

### 3차: 진짜 문제 — 공유 ticketing pod의 구현체 종속 로직

1차, 2차를 수정하니 대기열 API는 정상이 되었습니다. 그런데 **예매 플로우에서 실패**:

```
GET /api/v1/stadium-seats/.../seat-grades → 403
  {"message": "좌석 조회는 대기열 입장 완료 후에만 가능합니다."}

GET /api/v1/stadium-seats/.../seat-sections?gameId=... → 400
  {"message": "예매 가능 시간이 만료되었습니다."}
```

1 VU smoke 테스트에서 `http_req_failed: 39.74%`. 대기열은 통과했는데 예매가 안 됐습니다.

원인을 추적해보니, ticketing 엔드포인트는 **goti-ticketing-dev** MSA 서비스가 처리하고 있었습니다.
그런데 이 pod의 이미지에는 **A POC의 ReservationSession 검증 코드**가 포함되어 있었어요.

A의 PR #329가 develop에 머지된 상태였기 때문입니다.

```
{/* TODO: Draw.io로 교체 */}

┌──────────────┐     ┌──────────────────────────────────┐
│  C Queue   │     │    goti-ticketing-dev (공유)      │
│  Pod          │     │                                  │
│  Redis DB 1   │────▶│  ReservationSession 검증 (A)  │
│  QueueToken   │     │  → A 세션 없으면 403          │
│               │     │  → A 세션 만료 시 400         │
└──────────────┘     └──────────────────────────────────┘
        │                          ▲
        │     ┌──────────────┐     │
        │     │  A Queue   │     │
        │     │  Pod          │─────┘ ✅ A 세션 발급 → 통과
        │     │  Redis DB 0   │
        │     └──────────────┘
        │
        └──────── ❌ C은 다른 세션 방식 (QueueInterceptor + X-Queue-Token)
                    → A의 ReservationSession 검증 통과 불가
```

이것이 **"구현체만 교체하면 공정 비교가 된다"는 가정이 깨진 순간**입니다.

### 해결: 구현체별 ticketing pod 분리

C 전용 ticketing pod를 분리 배포했습니다:

- `goti-ticketing-junsang-dev` 신규 배포 (C 브랜치의 API 이미지)
- Istio 라우팅 추가: `/junsang/api/v1/**` → rewrite `/api/v1/**` → goti-ticketing-junsang-dev
- K6에서 `ticketingBase = baseUrl + "/junsang"` 으로 경로 분리
- Redis DB 1 공유 (queue ↔ ticketing 간 토큰 검증을 위해)

---

## ✅ 의존성 격리 패턴

이 경험을 통해 정리한 격리 구조입니다.

### Goti POC의 4계층 격리

| 격리 계층 | 방식 | 업계 패턴 대응 |
|-----------|------|---------------|
| **트래픽** | Istio path rewrite (`/queue/suyeon`, `/queue/junsang`) | Request-Level Routing |
| **데이터** | Redis DB 번호 분리 (0/1/2) | Multi-Tenancy (data-at-rest) |
| **컴퓨팅** | 구현체별 전용 pod | Sandbox (변경 서비스만 배포) |
| **의존성** | ticketing pod 분리 배포 | Uber SLATE (의존 체인 격리) |

이 구조는 Uber, DoorDash, Netflix 같은 대규모 MSA 기업들이 수렴한 패턴과 본질적으로 동일합니다.

차이점이 있다면 라우팅 방식입니다. 업계는 **헤더 기반**(Jaeger Baggage, OpenTelemetry context)으로 라우팅하지만, Goti POC는 **Path 기반**(`/queue/suyeon`, `/junsang/api/v1`)을 사용합니다.

| 항목 | 업계 (Uber/DoorDash) | Goti POC |
|------|---------------------|----------|
| 라우팅 | 헤더 기반 (request-tenancy) | Path 기반 (Istio rewrite) |
| 데이터 격리 | Tenancy별 DB/캐시/Kafka | Redis DB 번호 분리 |
| 인프라 비용 | 변경 서비스만 추가 배포 | 구현체별 queue + ticketing pod |
| 트래픽 전환 | 헤더 하나로 즉시 전환 | K6 QUEUE_IMPL 환경변수 |

Path 기반은 클라이언트 URL을 바꿔야 하는 단점이 있지만, POC 환경에서는 K6가 URL을 제어하므로 문제없었습니다. 프로덕션에서는 헤더 기반으로 전환하는 것이 맞습니다.

### A/B 테스트 시 의존성 격리 체크리스트

이 경험에서 뽑은 체크리스트입니다:

1. 테스트 대상 서비스가 **의존하는 서비스 목록**을 식별한다
2. 각 의존 서비스에 **구현체 고유 로직**이 있는지 확인한다
   - 인터셉터, 세션 검증, 커스텀 필터
   - DB 스키마, Redis 키 구조, 메시지 포맷
3. 고유 로직이 있는 의존 서비스는 **구현체별로 분리 배포**한다
4. 데이터 계층도 격리한다 (Redis DB, DB 스키마, Kafka 토픽)
5. 격리 범위를 **최소화**한다 — 변경 없는 서비스(user, stadium 등)는 공유 베이스라인 사용

---

## 📚 핵심 포인트

**첫째, K6의 static import 제약은 환경변수 패턴으로 우회할 수 있습니다.**
`QUEUE_IMPL` 패턴으로 3개 구현체를 단일 시나리오 파일로 비교했습니다. 사용하지 않는 헬퍼도 import해야 하는 오버헤드가 있지만, 비교의 공정성을 보장하는 트레이드오프입니다.

**둘째, 암묵적 의존성은 API 스펙에 드러나지 않습니다.**
세션/토큰 형식, Redis 키 패턴, 인터셉터/미들웨어, 인증 방식 — 이런 것들은 Swagger 문서에 안 나옵니다.
**실제 트래픽을 흘려봐야만 발견**할 수 있습니다.

**셋째, 의존 서비스에 구현체 고유 로직이 침투해 있으면 의존성 체인 전체를 격리해야 합니다.**
"대기열만 교체하면 되겠지"는 MSA에서 가장 위험한 가정입니다.
