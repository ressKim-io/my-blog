---
date: 2026-04-01
category: troubleshoot
project: Goti-server (ticketing)
tags: [redis, jackson, classcastexception, record, deserialization]
---

# RedisCache에서 LinkedHashMap → ReservationSessionCache ClassCastException

## Context
prod EKS 환경 goti-ticketing-prod에서 좌석 섹션 조회 API 호출 시 ERROR 로그 발생.
OTel로 수집된 에러 — `goti-ticketing-prod-6494874454-9z2qh` pod, service version `prod-37-57bdd30`.

## Issue

```
java.lang.ClassCastException: Cannot cast java.util.LinkedHashMap to com.goti.ticketing.session.model.ReservationSessionCache
    at java.base/java.lang.Class.cast(Unknown Source)
    at com.goti.infra.cache.RedisCache.get(RedisCache.java:32)
    at com.goti.ticketing.session.service.application.ReservationSessionService.findReservationSession(ReservationSessionService.java:92)
```

호출 경로: `StadiumSeatController.getSeatSections` → `SeatSectionServiceImpl.get` → `ReservationSessionService.validateActiveSession` → `RedisCache.get`

## Action

1. `RedisCache.get()` 확인 → `clazz.cast(value)` 사용. `GenericJackson2JsonRedisSerializer`가 역직렬화한 값을 직접 캐스팅
2. `RedisConfig` 확인 → `ObjectMapper`에 `activateDefaultTyping` 미설정. JSON에 `@class` 타입 힌트 없이 저장
3. `ReservationSessionCache`가 Java **record** 타입 → Jackson이 타입 힌트 없이 역직렬화 시 `LinkedHashMap`으로 fallback

**Root Cause**: `GenericJackson2JsonRedisSerializer`에 `activateDefaultTyping`이 없어서 Redis에 저장된 JSON에 타입 정보가 포함되지 않음. 역직렬화 시 대상 타입을 모르므로 `LinkedHashMap`으로 반환. `Class.cast()`는 런타임 타입 체크만 하므로 `ClassCastException` 발생.

**수정**: `RedisCache`에 `ObjectMapper` 주입 후 `convertValue()` fallback 추가
- `clazz.isInstance(value)` 체크 → 매칭되면 직접 캐스트
- 매칭 안 되면 `objectMapper.convertValue(value, clazz)` → `LinkedHashMap` → 대상 타입 변환

대안(activateDefaultTyping)은 기존 Redis 데이터 호환성 문제로 기각.

## Result
- 로컬 검증 완료, 기존 Redis 데이터 flush 불필요
- RedisCache를 사용하는 모든 곳에 동일하게 보호됨
- 재발 방지: 향후 record 타입 캐시 추가 시에도 안전

## Related Files
- `Goti-server/integration/src/main/java/com/goti/infra/cache/RedisCache.java`
- `Goti-server/integration/src/main/java/com/goti/config/redis/RedisConfig.java`
- `Goti-server/ticketing/src/main/java/com/goti/ticketing/session/model/ReservationSessionCache.java`
