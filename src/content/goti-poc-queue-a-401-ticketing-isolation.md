---
title: "POC 환경 401 티켓팅 격리 — A/B 비교는 의존성까지 분리해야 한다"
excerpt: "POC A 대기열 구현체 부하테스트에서 401이 떨어졌습니다. Spring Security 컴포넌트 스캔 누락부터 공유 ticketing pod에 침투한 POC C 로직까지, 의존성 체인 전체를 격리한 기록입니다"
category: challenge
tags:
  - go-ti
  - Queue
  - POC
  - LoadTest
  - Isolation
  - Auth
  - troubleshooting
series:
  name: "goti-queue-poc"
  order: 2
date: "2026-03-29"
---

## 한 줄 요약

> POC A 대기열 구현체를 부하테스트하려는데 `POST /api/v1/queue/poc-a/validate`가 401 empty body로 떨어졌습니다. Spring Security 컴포넌트 스캔 누락을 잡고 나니, 공유 ticketing pod에 POC C의 세션 검증 로직이 침투해 있어서 ticketing pod까지 구현체별로 분리 배포해야 했습니다.

---

## Impact

- **영향 범위**: 대기열 POC 3종(A/B/C) A/B 비교 부하테스트
- **증상**: POC A 검증 API 401, 이후 티켓팅 403/400 연쇄 실패
- **환경**: Kind K8s, Istio service mesh, ArgoCD GitOps
- **발생일**: 2026-03-29

---

## 🔥 문제: 대기열 통과 후에도 ticketing에서 계속 실패

### 배경

3개 대기열 구현체(POC A/B/C)를 A/B 비교 부하테스트하는 중이었습니다.

- **POC C**: 300/1000/3000 VU saturation 테스트 완료
- **POC A**: `poc/queue-waiting-a` 브랜치에서 `queue` 모듈을 독립 Spring Boot 앱으로 배포
- **POC B**: Kafka 기반 구현체

POC A는 Istio VirtualService로 `/api/v1/queue/poc-a/**`를 받아 `/api/v1/queue/**`로 rewrite한 뒤 `goti-queue-poc-a-dev` pod으로 라우팅하는 구조였습니다.

### 1차 증상: 401 Empty Body

부하테스트를 시작하자 대기열 API(`POST /api/v1/queue/poc-a/validate`)가 전부 **401(empty body)** 로 떨어졌습니다.

응답 body가 비어 있어서 Istio 레벨 차단인지 Spring Security 기본 차단인지조차 판단이 어려웠습니다.

### 2차 증상: QueueService bean not found

1차 수정을 배포한 직후 pod이 CrashLoopBackOff로 재시작을 반복했습니다.

```
Parameter 0 of constructor in com.goti.controller.QueueController
required a bean of type 'com.goti.service.QueueService' that could not be found.
```

### 3차 증상: ticketing API 403/400

대기열 통과(200 OK)까지는 성공했지만, 그 이후 예매 플로우에서 실패가 쏟아졌습니다.

```text
GET /api/v1/stadium-seats/.../seat-grades → 403
  {"code":"CLIENT_ERROR","message":"좌석 조회는 대기열 입장 완료 후에만 가능합니다."}

GET /api/v1/stadium-seats/.../seat-sections?gameId=... → 400
  {"code":"CLIENT_ERROR","message":"예매 가능 시간이 만료되었습니다."}
```

1 VU smoke 테스트에서 `http_req_failed: 39.74%`가 나왔습니다. 대기열은 뚫었는데 그 뒤가 전부 막혀 있는 상태였습니다.

---

## 🤔 원인: 컴포넌트 스캔 누락 + 공유 ticketing에 POC C 로직 침투

### 1차 원인: Spring Security 컴포넌트 스캔 범위 누락

먼저 Istio JWT 검증 실패를 의심했지만, `requestAuthentication` 설정은 POC C와 동일했고 POC C는 정상 동작했습니다. 가설을 기각하고 Spring 쪽을 들여다봤습니다.

`GotiQueueApplication.java`의 `scanBasePackages`를 확인하니 범위가 좁았습니다.

```java
@SpringBootApplication(scanBasePackages = {
    "com.goti.queue",     // queue 패키지 (실제 코드 없음)
    "com.goti.config",    // WebConfig
    "com.goti.infra",     // Redis 등
    "com.goti.domain.base",
    "com.goti.exception",
    "com.goti.global"
})
```

다음 3개가 전부 스캔 대상 밖이었습니다.

- `com.goti.user.config.security.SecurityConfig` (JwtAuthenticationFilter 포함)
- `com.goti.controller.QueueController`
- `com.goti.service.QueueService`

Spring Security starter는 의존성에 포함되어 있어서, `SecurityFilterChain` bean이 없으면 Spring이 기본 보안 정책을 적용합니다. 그 결과 **모든 요청이 자동으로 401로 막히고**, custom `ExceptionResolver`도 타지 않으니 body가 비어 있는 상태가 된 것이었습니다.

근본 원인은 queue 모듈을 독립 Spring Boot 앱으로 떼어내면서 컴포넌트 스캔 범위에 SecurityConfig와 Controller/Service 패키지를 포함시키지 않은 것이었습니다.

### 2차 원인: scan 추가 시 service 패키지 누락

1차 수정에서 `com.goti.controller`만 추가하고 `com.goti.service`를 빠뜨렸습니다. Controller는 로드됐지만 의존성 주입 대상인 `QueueService`가 없어서 pod이 기동 자체에 실패했습니다.

### 3차 원인: 공유 ticketing pod에 POC C의 세션 검증 로직 침투

3차는 더 근본적인 문제였습니다. 처음에는 `X-Queue-Token` 검증이 Redis DB 불일치 때문일 거라고 의심했습니다.

- POC A queue: Redis DB 1에 토큰 저장
- 메인 서버 `QueueInterceptor`: Redis DB 0 조회

이것도 일부 맞았지만, 진짜 원인은 더 아래에 있었습니다.

ticketing 엔드포인트(`/api/v1/stadium-seats/*`)는 `goti-ticketing-dev`라는 별도 MSA 서비스가 처리합니다. 그런데 이 서비스의 현재 이미지(`dev-44-3737148`)에 **POC C의 `ReservationSession` 검증 코드가 그대로 들어 있었습니다**.

- POC C의 개선 PR `#329`(`poc/queue-waiting-c-cdn-optimized`)가 `develop`에 머지된 상태
- `seat-grades`: `ReservationSession`이 없으면 403
- `seat-sections`: 세션 만료 시 400

POC C 테스트 시에는 POC C queue가 `ReservationSession`을 발급하므로 정상 동작했습니다. 하지만 POC A queue는 `QueueInterceptor + X-Queue-Token`이라는 완전히 다른 세션 방식을 사용하므로, POC C용 세션 검증을 통과할 수 없었던 것입니다.

한 줄로 요약하면, **공유 의존 서비스(ticketing)에 특정 POC 구현체의 세션 로직이 침투해 있어서, 다른 구현체가 같은 ticketing pod을 사용하면 검증에 실패하는 구조**였습니다. 구현체만 바꾸면 공정 비교가 될 것이라는 가정이 깨진 순간이었습니다.

---

## ✅ 해결: scan 범위 복구 + ticketing pod 구현체별 분리

### 1차 수정: 컴포넌트 스캔과 Security 설정

```java
@SpringBootApplication(scanBasePackages = {
    "com.goti.queue",
    "com.goti.config",
    "com.goti.infra",
    "com.goti.domain.base",
    "com.goti.exception",
    "com.goti.global",
    "com.goti.controller",  // 추가
    "com.goti.service"      // 추가
})
```

추가로 `QueueSecurityConfig.java`를 신규 작성해 다른 MSA 서비스와 동일한 `MeshSecuritySupport.applyDefaults()` 패턴을 적용했습니다.

- `GOTI_MESH_ENABLED=true`일 때 Istio가 내려주는 `X-User-Id`/`X-User-Role` 헤더를 신뢰
- `SimpleUserDetails.getId()`가 `@AuthenticationPrincipal(expression = "id") UUID memberId`와 호환되도록 유지

### 2차 수정 후 결과

1차·2차 수정을 적용한 뒤 `POST /api/v1/queue/poc-a/validate`가 **200 OK** (isPassed=true, token 발급)로 응답하면서 정상 동작을 확인했습니다.

- pod 2/2 Running, restart 0
- smoke 1 VU: `queue_pass_rate: 100%`, `queue_validate_ms p95: 314ms`

### 3차 수정: ticketing pod 구현체별 분리 배포

공유 ticketing pod 문제는 구현체별로 전용 ticketing pod을 띄우는 방향으로 풀었습니다.

- `goti-ticketing-poc-a-dev`를 POC A 브랜치의 api 모놀리스 이미지로 신규 배포
- Istio 라우팅: `/poc-a/api/v1/**` → rewrite `/api/v1/**` → `goti-ticketing-poc-a-dev`
- K6 시나리오: `ticketingBase = baseUrl + "/poc-a"`으로 ticketing 호출을 분리
- Redis DB는 queue와 동일한 DB 1을 공유하여 `QueueInterceptor`가 토큰을 검증할 수 있도록 구성

### 반영 위치

| 저장소 | 브랜치 | 변경 |
|---|---|---|
| goti-server | `poc/fix-queue-poc-a-security-config` | `GotiQueueApplication.java` scanBasePackages, `QueueSecurityConfig.java` 신규, `.github/workflows/cd-poc-queue.yml`에 `build_module` 파라미터 추가 |
| Goti-k8s | `main` | `environments/dev/goti-ticketing-poc-a/values.yaml` 신규, `gitops/dev/applicationsets/goti-msa-appset.yaml`에 element 추가 |
| Goti-load-test | `feature/queue-poc-a` | `scenarios/queue-poc-a.js`·`queue-poc-a-saturation.js`에 `ticketingBase` 도입, sections 동적 조회 |

배포와 E2E 검증은 이 시점에서 진행 중이었고, 이후 POC별 saturation 결과 글에서 이어집니다.

---

## 📚 배운 점

### POC A/B 비교는 의존성 체인 전체를 격리해야 한다

> 구현체만 교체하면 공정 비교가 될 것이라는 가정은 위험합니다.

공유 의존 서비스에 특정 구현체 고유 로직이 침투해 있으면, 다른 구현체는 그 순간부터 "다른 조건"으로 테스트됩니다. 서비스 메시 기반 A/B 테스트에서는 다음 3가지 축을 모두 격리해야 공정한 비교가 됩니다.

- **트래픽 격리**: Istio path rewrite로 구현체별 경로 분리 (`/poc-a`, `/poc-c`, `/poc-b`)
- **데이터 격리**: Redis DB 번호를 구현체별로 분리 (0/1/2)
- **컴퓨팅 격리**: queue뿐 아니라 의존 서비스(ticketing)까지 구현체별 pod 분리 배포

### Spring Boot 모듈 분리 시 컴포넌트 스캔 범위를 처음부터 꼼꼼히

독립 앱으로 떼어낼 때 `scanBasePackages`를 작게 잡으면 Spring Security가 "설정 없음 → 기본 보안"으로 전환해 조용히 401을 내려 버립니다. 이때 `ExceptionResolver`도 타지 않으므로 응답 body가 비어 있어 디버깅이 어렵습니다. 모듈 분리 시 `SecurityConfig`·`Controller`·`Service` 패키지가 모두 스캔 대상에 포함되는지 우선 확인하는 것이 안전합니다.

### 프로덕션 카나리/블루그린에도 같은 함정이 있다

POC A/B 비교 상황만의 문제가 아닙니다. 카나리나 블루그린 배포에서도 새 버전이 "현재 버전 고유 로직이 박힌 의존 서비스"에 호출을 보내면 동일한 증상이 발생할 수 있습니다. 새 버전을 올릴 때는 **의존 서비스 호환성**을 함께 검증해야 진짜 회귀를 막을 수 있습니다.
