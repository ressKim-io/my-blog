# deploy/dev 핫픽스: Redis 직렬화 + Queue seat-enter

발생일: 2026-03-29
작성자: ress
상태: 진행 중

---

## 배경

수연 대기열 POC 부하테스트 중 발견된 버그 2건을 `deploy/dev`에 직접 핫픽스.
**develop 브랜치를 거치지 않았으므로 나중에 반드시 동기화 필요.**

## deploy/dev 직접 커밋 목록

### 1. RedisCache 역직렬화 안전 변환

| 항목 | 내용 |
|------|------|
| 파일 | `integration/.../RedisCache.java`, `integration/.../RedisConfig.java` |
| 원인 | `GenericJackson2JsonRedisSerializer`가 `LinkedHashMap`으로 역직렬화 → `clazz.cast()` ClassCastException → 500 |
| 수정 | `RedisCache.get()`에 `isInstance` 체크 + `objectMapper.convertValue` fallback |
| 영향 | 전 서비스 공통 (integration 모듈), 하위 호환 |

### 2. RedisConfig ObjectMapper Bean 오염 수정

| 항목 | 내용 |
|------|------|
| 파일 | `integration/.../RedisConfig.java`, `integration/.../RedisCache.java` |
| 원인 | `@Bean ObjectMapper redisObjectMapper()` → Spring이 HTTP 응답 직렬화에 사용 → `ApiSuccessResponse` 500 |
| 수정 | Bean 제거, ObjectMapper를 `redisTemplate` 메서드 로컬 변수로 이동 |
| 영향 | 전 서비스 API 응답 깨짐 해소 |

## POC 브랜치 전용 커밋 (deploy/dev에 미포함)

### 3. seat-enter publishedRank 검증 수정

| 항목 | 내용 |
|------|------|
| 브랜치 | `poc/queue-waiting-suyeon-cdn-optimized` |
| 파일 | `queue/.../QueueSeatEnterService.java`, `queue/.../QueueSeatEnterApiTest.java` |
| 원인 | `currentAllowedRank`(초기 0) 기준 검증 → 최초 입장 불가 (chicken-and-egg) |
| 수정 | status API와 동일한 `publishedRank` 동적 계산으로 변경 |
| 배포 | POC Queue CD (`cd-poc-queue.yml`)로 별도 배포 |

## TODO: develop 동기화

deploy/dev에 직접 넣은 커밋(1, 2번)을 develop에 머지해야 함:

```bash
# develop에서 deploy/dev의 핫픽스 커밋 cherry-pick
git checkout develop
git cherry-pick <commit-hash-1>  # RedisCache 안전 변환
git cherry-pick <commit-hash-2>  # ObjectMapper Bean 오염 수정
git push origin develop
```

또는 다음 develop → deploy/dev 머지 시 충돌 해결로 동기화.

## TODO: 근본 해결 (Redis Repository 패턴)

현재 `RedisTemplate<String, Object>` + `GenericJackson2JsonRedisSerializer` 조합의 구조적 한계.
`RedisTemplate<String, String>` + 도메인별 Repository 패턴으로 전환 예정.

가이드: `docs/conventions/redis-serialization-guide.md`
