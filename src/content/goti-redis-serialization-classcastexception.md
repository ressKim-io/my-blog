---
title: "Redis ClassCastException: LinkedHashMap이 내 객체가 아니라고?"
excerpt: "GenericJackson2JsonRedisSerializer의 타입 힌트 부재로 발생한 ClassCastException과 ObjectMapper Bean 오염까지, Redis 직렬화 삽질 2부작"
category: kubernetes
tags:
  - go-ti
  - Redis
  - Jackson
  - Serialization
  - ClassCastException
  - Troubleshooting
  - Spring-Boot
date: "2026-04-01"
---

## 🎯 한 줄 요약

> Redis에 저장한 객체가 `LinkedHashMap`으로 돌아오고, 그걸 고치려다 ObjectMapper Bean을 오염시켜 API 응답까지 깨뜨린 Redis 직렬화 삽질 2부작.

## 📊 Impact

- **영향 범위**: prod EKS 좌석 섹션 조회 API 500 에러 + dev 환경 전체 API 응답 깨짐
- **증상 지속**: 좌석 조회 에러는 특정 세션 캐시 조회 시 지속 발생
- **소요 시간**: 장애 1 약 2시간, 장애 2 약 1시간
- **발생일**: 2026-03-29 ~ 2026-04-01

---

## 🔥 장애 1: LinkedHashMap이 내 객체가 아니라고?

### 증상

prod EKS `goti-ticketing-prod` 환경에서 좌석 섹션 조회 API 호출 시 에러가 발생했습니다.
OTel로 수집된 에러 로그를 확인했습니다.

```
java.lang.ClassCastException: Cannot cast java.util.LinkedHashMap to com.goti.ticketing.session.model.ReservationSessionCache
    at java.base/java.lang.Class.cast(Unknown Source)
    at com.goti.infra.cache.RedisCache.get(RedisCache.java:32)
    at com.goti.ticketing.session.service.application.ReservationSessionService.findReservationSession(ReservationSessionService.java:92)
```

호출 경로를 따라가보면 `StadiumSeatController.getSeatSections` → `SeatSectionServiceImpl.get` → `ReservationSessionService.validateActiveSession` → `RedisCache.get` 순서로 진행되며, 마지막 `RedisCache.get`에서 예외가 터집니다.

`LinkedHashMap`을 `ReservationSessionCache`로 캐스팅할 수 없다는 것입니다.
분명히 `ReservationSessionCache` 객체를 Redis에 넣었는데, 꺼내니까 `LinkedHashMap`이 나옵니다.

**뭐지?**

### 원인 분석

`RedisCache.get()` 코드를 먼저 확인했습니다.

```java
public <T> T get(String key, Class<T> clazz) {
    Object value = redisTemplate.opsForValue().get(key);
    if (value == null) return null;
    return clazz.cast(value);  // ← 여기서 ClassCastException
}
```

`clazz.cast(value)`는 런타임 타입 체크만 합니다.
`value`의 실제 타입이 `LinkedHashMap`이면, `ReservationSessionCache`로 캐스팅이 당연히 실패합니다.

그러면 왜 `LinkedHashMap`이 나올까?

`RedisConfig`를 확인했습니다.

```java
@Configuration
public class RedisConfig {

    @Bean
    public RedisTemplate<String, Object> redisTemplate(RedisConnectionFactory factory) {
        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(factory);
        template.setKeySerializer(new StringRedisSerializer());
        template.setValueSerializer(new GenericJackson2JsonRedisSerializer(objectMapper()));
        return template;
    }

    private ObjectMapper objectMapper() {
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        // activateDefaultTyping 없음!
        return mapper;
    }
}
```

**아!** `activateDefaultTyping`이 빠져있었습니다.

### 핵심: activateDefaultTyping이 없으면 무슨 일이 벌어지나

이 설정의 유무가 Redis에 저장되는 JSON 구조를 완전히 바꿉니다.

```
{/* TODO: Draw.io로 교체 */}

┌─────────────────────────────────────────────────────────┐
│              activateDefaultTyping 미설정                 │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  [직렬화] ReservationSessionCache                        │
│      ↓                                                  │
│  Redis 저장: {"sessionId":"abc","seatId":42}             │
│      ↓  (타입 정보 없음!)                                 │
│  [역직렬화] 대상 타입을 모름                               │
│      ↓                                                  │
│  LinkedHashMap {sessionId=abc, seatId=42}                │
│      ↓                                                  │
│  clazz.cast() → ClassCastException 💥                   │
│                                                         │
├─────────────────────────────────────────────────────────┤
│              activateDefaultTyping 설정                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  [직렬화] ReservationSessionCache                        │
│      ↓                                                  │
│  Redis 저장: {                                           │
│    "@class": "com.goti...ReservationSessionCache",       │
│    "sessionId": "abc",                                   │
│    "seatId": 42                                          │
│  }                                                      │
│      ↓  (@class 타입 힌트 포함!)                          │
│  [역직렬화] @class로 대상 타입 결정                        │
│      ↓                                                  │
│  ReservationSessionCache {sessionId=abc, seatId=42}      │
│      ↓                                                  │
│  clazz.cast() → 성공 ✅                                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

`GenericJackson2JsonRedisSerializer`는 이름에 "Generic"이 붙어있습니다.
**모든 타입을 JSON으로 직렬화**할 수 있다는 뜻입니다.

그런데 역직렬화할 때 문제가 생깁니다.
JSON `{"sessionId":"abc","seatId":42}`만 보고는 이게 어떤 클래스인지 알 수 없습니다.
타입 정보가 없으면 Jackson은 기본 전략을 사용합니다.

JSON 객체(`{}`) → `LinkedHashMap`
JSON 배열(`[]`) → `ArrayList`
JSON 문자열(`""`) → `String`

이것이 `activateDefaultTyping`의 역할입니다.
직렬화할 때 `@class` 필드를 JSON에 삽입해서, 역직렬화 시 원본 타입을 복원할 수 있게 합니다.

여기에 한 가지 더 복합적인 문제가 있었습니다.
`ReservationSessionCache`는 Java **record** 타입입니다.

```java
public record ReservationSessionCache(
    String sessionId,
    Long seatId,
    LocalDateTime createdAt
) {}
```

일반 클래스(`class`)라면 Jackson이 `@JsonTypeInfo` 같은 어노테이션으로 힌트를 줄 수 있지만, record는 불변 객체라 Jackson의 기본 역직렬화 전략이 다릅니다.
타입 힌트 없이 record를 역직렬화하면 **100% LinkedHashMap으로 fallback**됩니다.

### 왜 activateDefaultTyping을 안 넣었나

그러면 간단합니다. `activateDefaultTyping` 넣으면 끝 아닌가?

문제는 **기존 Redis 데이터**입니다.

이미 prod Redis에는 `@class` 필드 없이 저장된 데이터가 수천 건 있습니다.
`activateDefaultTyping`을 켜면 역직렬화 시 `@class` 필드를 기대하는데, 기존 데이터에는 그 필드가 없습니다.

결과: **기존 캐시 전부 역직렬화 실패**.

Redis를 전부 flush하면 되긴 하지만, prod 환경에서 캐시를 한 번에 날리면 DB에 순간적으로 부하가 몰립니다.
TTL이 만료될 때까지 기다리는 것도 방법이지만, TTL이 긴 캐시도 있어서 완전 전환까지 시간이 걸립니다.

**그래서 이 방법은 기각했습니다.**

### 수정: convertValue fallback

대신 `RedisCache.get()`에 안전한 변환 로직을 추가했습니다.

**Before:**

```java
public <T> T get(String key, Class<T> clazz) {
    Object value = redisTemplate.opsForValue().get(key);
    if (value == null) return null;
    return clazz.cast(value);  // LinkedHashMap이면 터짐
}
```

**After:**

```java
public <T> T get(String key, Class<T> clazz) {
    Object value = redisTemplate.opsForValue().get(key);
    if (value == null) return null;

    if (clazz.isInstance(value)) {
        return clazz.cast(value);  // 타입이 맞으면 직접 캐스트
    }

    // LinkedHashMap → 대상 타입 변환
    return objectMapper.convertValue(value, clazz);
}
```

핵심은 `objectMapper.convertValue()`입니다.

이 메서드는 Java 객체를 다른 Java 객체로 변환합니다.
내부적으로 `value`를 JSON 트리로 변환한 뒤, 대상 `clazz`로 역직렬화합니다.

`LinkedHashMap {sessionId=abc, seatId=42}` → `ReservationSessionCache(sessionId=abc, seatId=42)`

이 방식의 장점:
- **기존 Redis 데이터 호환**: `@class` 없는 데이터도 정상 처리
- **Redis flush 불필요**: 기존 캐시 그대로 사용 가능
- **전 서비스 공통 보호**: `RedisCache`를 사용하는 모든 곳에 동일하게 적용
- **향후 record 타입 캐시 추가 시에도 안전**

---

## 🔥 장애 2: ObjectMapper Bean 오염 — API 응답이 통째로 깨진다

### 증상

장애 1을 수정하고 deploy/dev에 배포했습니다.
A 대기열 POC 부하테스트를 돌리는데, 이번엔 **API 응답 자체가 깨졌습니다**.

```
HTTP 500 Internal Server Error
```

`ApiSuccessResponse` 직렬화에서 에러가 발생합니다.
모든 API가 500을 반환합니다.

**Redis는 고쳤는데, API가 통째로 죽었다고?**

### 원인: Spring의 ObjectMapper 주입 우선순위

장애 1을 수정하면서 `RedisConfig`에 이런 코드를 넣었습니다.

```java
@Configuration
public class RedisConfig {

    @Bean  // ← 이게 문제!
    public ObjectMapper redisObjectMapper() {
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        return mapper;
    }

    @Bean
    public RedisTemplate<String, Object> redisTemplate(
            RedisConnectionFactory factory, ObjectMapper redisObjectMapper) {
        // ...
    }
}
```

`@Bean ObjectMapper redisObjectMapper()`을 선언한 순간, Spring IoC 컨테이너에 ObjectMapper Bean이 **2개**가 됩니다.

```
{/* TODO: Draw.io로 교체 */}

┌─────────────────────────────────────────────────────────┐
│                 Spring IoC Container                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ObjectMapper Beans:                                    │
│                                                         │
│  ┌─────────────────────────────┐                        │
│  │ jacksonObjectMapper (auto)  │ ← Spring Boot 자동 설정 │
│  │ - HTTP 요청/응답 직렬화      │                        │
│  │ - @RequestBody, @Response   │                        │
│  └─────────────────────────────┘                        │
│                                                         │
│  ┌─────────────────────────────┐                        │
│  │ redisObjectMapper (@Bean)   │ ← 우리가 추가한 Bean    │
│  │ - Redis 전용 설정            │                        │
│  │ - JavaTimeModule만 등록      │                        │
│  └─────────────────────────────┘                        │
│                                                         │
│  Spring MVC가 ObjectMapper 주입 시:                      │
│  → @Primary도 없고, @Qualifier도 없으면?                  │
│  → Bean 이름 매칭 or 등록 순서에 따라 결정                 │
│  → redisObjectMapper가 선택될 수 있음! 💥                 │
│                                                         │
│  결과:                                                   │
│  HTTP 응답 직렬화에 redisObjectMapper 사용                │
│  → ApiSuccessResponse 직렬화 실패                        │
│  → 전체 API 500 에러                                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

Spring Boot는 `JacksonAutoConfiguration`으로 기본 ObjectMapper를 자동 설정합니다.
여기에 우리가 `@Bean ObjectMapper`를 하나 더 등록하면 **충돌**이 발생합니다.

Spring MVC의 `MappingJackson2HttpMessageConverter`가 ObjectMapper를 주입받을 때, `@Primary`나 `@Qualifier`가 없으면 Bean 이름이나 등록 순서에 따라 선택합니다.

운이 나쁘면 (정확히는 컴포넌트 스캔 순서에 따라) Redis 전용 ObjectMapper가 HTTP 직렬화에 사용됩니다.

이 ObjectMapper에는 Spring Boot가 자동으로 등록하는 여러 Module이 빠져있습니다.
`ApiSuccessResponse`처럼 커스텀 직렬화가 필요한 응답 객체에서 에러가 터집니다.

**한 마디로, Redis용 ObjectMapper가 HTTP 응답 직렬화까지 오염시킨 것입니다.**

### 수정: Bean 제거, 로컬 변수로 이동

**Before:**

```java
@Configuration
public class RedisConfig {

    @Bean  // Spring 컨테이너에 등록됨 → 오염 원인
    public ObjectMapper redisObjectMapper() {
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        return mapper;
    }

    @Bean
    public RedisTemplate<String, Object> redisTemplate(
            RedisConnectionFactory factory, ObjectMapper redisObjectMapper) {
        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(factory);
        template.setValueSerializer(new GenericJackson2JsonRedisSerializer(redisObjectMapper));
        return template;
    }
}
```

**After:**

```java
@Configuration
public class RedisConfig {

    @Bean
    public RedisTemplate<String, Object> redisTemplate(RedisConnectionFactory factory) {
        // ObjectMapper를 메서드 로컬 변수로 생성 → Bean 오염 없음
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(factory);
        template.setKeySerializer(new StringRedisSerializer());
        template.setValueSerializer(new GenericJackson2JsonRedisSerializer(mapper));
        return template;
    }
}
```

핵심 변경은 딱 하나입니다.
**`@Bean` 제거, ObjectMapper를 `redisTemplate` 메서드 안의 로컬 변수로 이동.**

이렇게 하면 이 ObjectMapper는 Spring IoC 컨테이너에 등록되지 않습니다.
`redisTemplate` Bean 내부에서만 사용되고, 외부에 영향을 주지 않습니다.

Spring Boot의 기본 `jacksonObjectMapper`가 유일한 ObjectMapper Bean으로 남으므로, HTTP 직렬화는 정상적으로 동작합니다.

---

## 🤔 근본 원인: RedisTemplate\&lt;String, Object\>의 구조적 한계

두 장애 모두 같은 뿌리에서 나왔습니다.

**`RedisTemplate<String, Object>` + `GenericJackson2JsonRedisSerializer` 조합의 구조적 한계.**

이 조합이 왜 위험한지 정리해보겠습니다.

| 문제 | 설명 |
|------|------|
| **타입 안전성 없음** | Value가 `Object`이므로 컴파일 타임에 타입 체크 불가 |
| **역직렬화 타입 불확실** | `activateDefaultTyping` 없으면 `LinkedHashMap` fallback |
| **`activateDefaultTyping`의 부작용** | JSON에 FQCN 포함 → 클래스 이름 변경 시 기존 데이터 깨짐 |
| **ObjectMapper 공유 위험** | Bean으로 등록하면 HTTP 직렬화와 충돌 가능 |

이 표의 내용을 하나씩 풀어보겠습니다.

첫째, `RedisTemplate<String, Object>`는 Value 타입이 `Object`입니다.
어떤 타입이든 넣을 수 있다는 건 편리하지만, 꺼낼 때 타입을 보장할 수 없습니다.
컴파일러가 잡아줄 수 없는 런타임 에러의 원인이 됩니다.

둘째, `GenericJackson2JsonRedisSerializer`는 만능 직렬화기처럼 보이지만 함정이 있습니다.
`activateDefaultTyping`이 없으면 역직렬화 결과가 `LinkedHashMap`이 되고, 있으면 JSON에 FQCN(Fully Qualified Class Name)이 박힙니다.
FQCN이 박히면 패키지 이동이나 클래스 이름 변경 시 기존 Redis 데이터가 전부 깨집니다.

**권장 패턴은 이렇습니다:**

```java
// RedisTemplate<String, String> + 도메인별 Repository
@Bean
public RedisTemplate<String, String> redisTemplate(RedisConnectionFactory factory) {
    RedisTemplate<String, String> template = new RedisTemplate<>();
    template.setConnectionFactory(factory);
    template.setKeySerializer(new StringRedisSerializer());
    template.setValueSerializer(new StringRedisSerializer());
    return template;
}
```

```java
// 도메인별 Repository에서 직접 직렬화/역직렬화
@Repository
public class ReservationSessionCacheRepository {

    private final RedisTemplate<String, String> redisTemplate;
    private final ObjectMapper objectMapper;

    public void save(String key, ReservationSessionCache session) {
        String json = objectMapper.writeValueAsString(session);
        redisTemplate.opsForValue().set(key, json);
    }

    public ReservationSessionCache find(String key) {
        String json = redisTemplate.opsForValue().get(key);
        if (json == null) return null;
        return objectMapper.readValue(json, ReservationSessionCache.class);
        // ← 대상 타입을 명시적으로 지정!
    }
}
```

이 패턴의 장점은 명확합니다.

- **타입 안전**: `readValue`에 대상 타입을 명시하므로 `LinkedHashMap` fallback 없음
- **타입 힌트 불필요**: `@class` 필드 없어도 정상 역직렬화
- **ObjectMapper 격리**: Bean 등록 없이 로컬에서 사용하므로 HTTP 직렬화와 충돌 없음
- **도메인별 책임 분리**: 각 Repository가 자신의 캐시 구조를 관리

다만 이번에는 `RedisCache`가 integration 모듈의 공통 컴포넌트이고, 여러 서비스에서 사용 중이라 **전면 리팩토링은 별도 태스크로 분리**했습니다.
지금은 `convertValue` fallback으로 방어하고, 점진적으로 도메인별 Repository 패턴으로 전환할 계획입니다.

---

## ✅ 수정 결과

### 검증 내용

| 항목 | 결과 |
|------|------|
| `RedisCache.get()` LinkedHashMap 변환 | 로컬 + dev 환경 검증 완료 |
| 기존 Redis 데이터 호환성 | flush 없이 정상 조회 확인 |
| ObjectMapper Bean 오염 해소 | 전체 API 응답 정상 확인 |
| record 타입 캐시 역직렬화 | `ReservationSessionCache` 정상 반환 |

### 배포 이력

이 수정은 **deploy/dev에 직접 핫픽스**로 들어갔습니다.
A 대기열 POC 부하테스트가 진행 중이었기 때문에, develop 브랜치를 거치지 않고 바로 배포했습니다.

```bash
# 나중에 develop에 동기화 필요
git checkout develop
git cherry-pick <hotfix-commit-1>  # RedisCache 안전 변환
git cherry-pick <hotfix-commit-2>  # ObjectMapper Bean 오염 수정
git push origin develop
```

develop 동기화를 잊으면 다음 develop → deploy/dev 머지 시 충돌이 발생할 수 있으므로, **반드시 cherry-pick 또는 머지 시 동기화**가 필요합니다.

---

## 📚 핵심 포인트

- **`GenericJackson2JsonRedisSerializer`에 `activateDefaultTyping`이 없으면**, 역직렬화 결과는 원본 타입이 아니라 `LinkedHashMap`입니다. 특히 Java record 타입은 100% fallback됩니다.
- **`@Bean ObjectMapper`를 함부로 등록하면 안 됩니다.** Spring Boot의 자동 설정 ObjectMapper와 충돌해서, Redis뿐 아니라 HTTP 응답 직렬화까지 오염시킬 수 있습니다.
- **`RedisTemplate<String, Object>` 조합 자체가 구조적 위험**을 갖고 있습니다. 장기적으로는 `RedisTemplate<String, String>` + 도메인별 Repository 패턴이 안전합니다.
- **prod 환경 핫픽스는 반드시 동기화 추적**이 필요합니다. deploy/dev에 직접 넣은 커밋은 develop cherry-pick을 잊지 말아야 합니다.
