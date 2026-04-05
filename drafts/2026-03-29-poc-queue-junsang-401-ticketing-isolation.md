---
date: 2026-03-29
category: troubleshoot
project: goti-server, Goti-k8s, Goti-load-test
tags: [poc-ab-test, spring-security, istio-routing, service-isolation, redis-db-isolation]
---

# POC Queue 준상 401/403 — SecurityConfig 미등록 + 공유 ticketing pod 의존성 격리

## Context

3개 대기열 구현체(수연/준상/성전) A/B 비교 부하테스트 진행 중.
- 환경: Kind K8s (Istio service mesh, ArgoCD GitOps)
- 수연 POC: 300/1000/3000 VU saturation 테스트 완료
- 준상 POC: `POST /api/v1/queue/junsang/validate` 호출 시 401 empty body로 실패

준상 구현체는 `poc/queue-waiting-junsang` 브랜치에서 `queue` 모듈을 독립 Spring Boot 앱으로 배포.
Istio VirtualService가 `/api/v1/queue/junsang/**` → rewrite `/api/v1/queue/**` → goti-queue-junsang-dev pod.

## Issue

### 1차: 401 Empty Body (대기열 API)

```
POST /api/v1/queue/junsang/validate → 401 (empty body)
```

모든 queue API 호출이 401. 응답 body가 비어있어서 Istio 레벨 차단 또는 Spring Security 기본 차단 의심.

### 2차: QueueService bean not found (배포 실패)

```
Parameter 0 of constructor in com.goti.controller.QueueController
required a bean of type 'com.goti.service.QueueService' that could not be found.
```

1차 수정 후 재배포 시 CrashLoopBackOff.

### 3차: 403/400 (ticketing API)

```
GET /api/v1/stadium-seats/.../seat-grades → 403
  {"code":"CLIENT_ERROR","message":"좌석 조회는 대기열 입장 완료 후에만 가능합니다."}

GET /api/v1/stadium-seats/.../seat-sections?gameId=... → 400
  {"code":"CLIENT_ERROR","message":"예매 가능 시간이 만료되었습니다."}
```

대기열 통과(200 OK) 후 예매 플로우에서 실패. 1 VU smoke 테스트에서 `http_req_failed: 39.74%`.

## Action

### 1차 진단: 401 — Spring Security 미등록

**가설**: Istio JWT 검증 실패 → 결과: Istio requestAuthentication 설정은 수연과 동일, 수연은 정상 → 기각

**가설**: Spring SecurityFilterChain bean 미등록 → 결과: **확인**

`GotiQueueApplication.java`의 `scanBasePackages` 분석:
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

문제:
- `com.goti.user.config.security.SecurityConfig` (JwtAuthenticationFilter 포함) → **스캔 대상 아님**
- `com.goti.controller.QueueController` → **스캔 대상 아님**
- `com.goti.service.QueueService` → **스캔 대상 아님**
- Spring Security starter는 의존성에 포함 → **기본 보안 적용 (모든 요청 401)**

**근본 원인**: queue 모듈이 독립 Spring Boot 앱으로 분리되었지만, 컴포넌트 스캔 범위에 SecurityConfig/Controller/Service 패키지가 누락.

**수정**:
1. `scanBasePackages`에 `com.goti.controller`, `com.goti.service` 추가
2. `QueueSecurityConfig.java` 신규 생성 — `MeshSecuritySupport.applyDefaults()` 사용 (다른 MSA 서비스와 동일 패턴)
   - `GOTI_MESH_ENABLED=true` → Istio X-User-Id/X-User-Role 헤더 신뢰
   - `SimpleUserDetails.getId()` → `@AuthenticationPrincipal(expression = "id") UUID memberId` 호환

### 2차 진단: QueueService not found

1차에서 `com.goti.controller`만 추가하고 `com.goti.service`를 빠뜨림.
QueueController → QueueService 의존성 주입 실패.

**수정**: `scanBasePackages`에 `com.goti.service` 추가.

### 3차 진단: ticketing 403/400 — 공유 서비스의 구현체 종속 로직

**가설**: seat-grades 403은 QueueInterceptor의 X-Queue-Token 검증 → Redis DB 불일치
- 준상 queue는 Redis DB 1에 토큰 저장
- 메인 서버의 QueueInterceptor는 Redis DB 0 조회
- → 결과: 일부 맞지만 근본 원인은 더 깊음

**실제 원인 발견**:
- ticketing 엔드포인트(`/api/v1/stadium-seats/*` 등)는 **goti-ticketing-dev** MSA 서비스가 처리
- goti-ticketing-dev 이미지(`dev-44-3737148`)에 **수연 POC의 ReservationSession 검증 코드**가 포함
  - `#329` (poc/queue-waiting-suyeon-cdn-optimized)가 develop에 머지된 상태
  - seat-grades: ReservationSession 없으면 403
  - seat-sections: 세션 만료 시 400
- 수연 테스트 시에는 수연 queue가 세션을 발급하므로 정상 동작
- 준상 queue는 다른 세션 방식(QueueInterceptor + X-Queue-Token) → 수연 세션 검증 통과 불가

**근본 원인**: POC A/B 비교 시 **공유 의존 서비스(ticketing)에 특정 구현체의 로직이 침투**해 있어서, 다른 구현체가 동일 ticketing pod을 사용하면 검증 실패.

**수정**: 구현체별 ticketing pod 분리 배포
- `goti-ticketing-junsang-dev` 신규 배포 (준상 브랜치의 api 모놀리스 이미지)
- Istio 라우팅: `/junsang/api/v1/**` → rewrite `/api/v1/**` → goti-ticketing-junsang-dev
- K6: `ticketingBase = baseUrl + "/junsang"` 으로 ticketing 호출 분리
- Redis DB 1 공유 (queue와 동일 DB → QueueInterceptor 토큰 검증 가능)

## Result

### 1차/2차 수정 후
- `POST /api/v1/queue/junsang/validate` → **200 OK** (isPassed=true, token 발급)
- pod 정상 기동 (2/2 Running, restart 0)
- smoke 1 VU: `queue_pass_rate: 100%`, `queue_validate_ms p95: 314ms`

### 3차 수정
- Goti-k8s: `goti-ticketing-junsang/values.yaml` 신규 + ApplicationSet element 추가
- goti-server CD: `build_module` 파라미터 추가 (queue/api 선택)
- K6: `ticketingBase` 도입으로 구현체별 ticketing 경로 분리
- 배포 및 E2E 검증 진행 중

### 학습: POC A/B 테스트 시 의존성 격리 원칙

> **구현체만 교체하면 공정 비교가 될 것이라는 가정은 위험하다.**
> 의존하는 서비스에 구현체 고유 로직이 침투해 있으면, 의존성 체인 전체를 격리해야 한다.

이것은 서비스 메시 기반 A/B 테스트의 핵심 패턴:
- **트래픽 격리**: Istio path rewrite로 구현체별 경로 분리
- **데이터 격리**: Redis DB 번호 분리 (0/1/2)
- **컴퓨팅 격리**: 구현체별 전용 pod 배포 (queue + ticketing)
- **프로덕션 적용**: 카나리/블루그린 배포 시에도 동일 문제 발생 가능 — 의존 서비스의 호환성 검증 필수

## Related Files

### goti-server (poc/fix-queue-junsang-security-config)
- `queue/src/main/java/com/goti/GotiQueueApplication.java` — scanBasePackages 수정
- `queue/src/main/java/com/goti/config/security/QueueSecurityConfig.java` — 신규
- `.github/workflows/cd-poc-queue.yml` — build_module 파라미터 추가

### Goti-k8s (main)
- `environments/dev/goti-ticketing-junsang/values.yaml` — 신규
- `gitops/dev/applicationsets/goti-msa-appset.yaml` — ticketing-junsang element 추가

### Goti-load-test (feature/queue-junsang)
- `scenarios/queue-junsang.js` — ticketingBase 도입, sections 동적 조회
- `scenarios/queue-junsang-saturation.js` — 동일
