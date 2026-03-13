---
title: "Spring Boot가 Docker에서 안 뜨는 이유: JWT 환경변수 기본값 누락"
excerpt: "다른 JWT 변수에는 기본값이 있는데 하나만 빠져서 Duration 파싱 에러가 발생한 트러블슈팅"
category: cicd
tags:
  - go-ti
  - docker-compose
  - spring-boot
  - environment-variable
  - ec2
series:
  name: "goti-ec2-deploy"
  order: 5
date: "2026-03-06"
---

## 한 줄 요약

> `JWT_SOCIAL_VERIFY_TIME` 환경변수에만 기본값이 없어서, `.env` 파일 없이 Docker 기동 시 Spring Boot가 Duration 파싱에 실패했습니다.

---

## 🔥 상황

OTel 레이블 검증을 위해 `make verify-up`으로 goti-server와 모니터링 스택을 Docker에 올리는 중이었습니다.

goti-server 컨테이너가 반복적으로 재시작되고 있었어요.

```bash
$ docker ps
CONTAINER ID  IMAGE        STATUS                          NAMES
abc123        goti-server  Restarting (1) 5 seconds ago    goti-server
```

---

## 🤔 원인: 하나만 빠진 기본값

### 에러 메시지

docker logs를 확인해봤습니다.

```
Failed to bind properties under 'jwt.social-verify-valid-time' to java.time.Duration:
    Property: jwt.social-verify-valid-time
    Value: "${JWT_SOCIAL_VERIFY_TIME}"
    Origin: class path resource [application.yml] - 43:29
    Reason: '${JWT_SOCIAL_VERIFY_TIME}' is not a valid duration
```

Spring Boot가 `${JWT_SOCIAL_VERIFY_TIME}`이라는 **문자열 그 자체**를 Duration으로 파싱하려다 실패한 거예요.

### 왜 이런 일이 발생했나

처음에는 OTel 관련 설정 문제를 의심했습니다.
하지만 에러 메시지를 보면 JWT Duration 파싱 문제가 명확했어요.

다른 JWT 환경변수와 비교해봤습니다:

```yaml
# docker-compose.app.yml
environment:
  JWT_ACCESS_TIME: ${JWT_ACCESS_TIME:-3600000}       # 기본값 있음 ✅
  JWT_REFRESH_TIME: ${JWT_REFRESH_TIME:-604800000}   # 기본값 있음 ✅
  # JWT_SOCIAL_VERIFY_TIME: ???                       # 아예 없음 ❌
```

`JWT_ACCESS_TIME`과 `JWT_REFRESH_TIME`은 `${VAR:-default}` 패턴으로 기본값이 설정되어 있었습니다.
그런데 `JWT_SOCIAL_VERIFY_TIME`만 `docker-compose.app.yml`에 정의조차 되어 있지 않았어요.

`application.yml`도 마찬가지였습니다:

```yaml
# application.yml
jwt:
  access-valid-time: ${JWT_ACCESS_TIME:3600000}           # 기본값 있음 ✅
  refresh-valid-time: ${JWT_REFRESH_TIME:604800000}       # 기본값 있음 ✅
  social-verify-valid-time: ${JWT_SOCIAL_VERIFY_TIME}     # 기본값 없음 ❌
```

새 JWT 환경변수를 추가할 때 이 항목만 누락된 것으로 추정됩니다.
`.env` 파일이 있는 환경에서는 값이 주입되니 문제가 없었지만, `.env` 없이 기동하면 바로 터지는 구조였어요.

---

## ✅ 해결: 양쪽에 기본값 추가

### docker-compose.app.yml

```yaml
# Before: JWT_SOCIAL_VERIFY_TIME 항목 자체가 없음

# After
environment:
  JWT_SOCIAL_VERIFY_TIME: ${JWT_SOCIAL_VERIFY_TIME:-300000}
```

### application.yml

```yaml
# Before
jwt:
  social-verify-valid-time: ${JWT_SOCIAL_VERIFY_TIME}

# After
jwt:
  social-verify-valid-time: ${JWT_SOCIAL_VERIFY_TIME:300000}
```

### 검증

수정 후 `.env` 없이 Docker 기동에 성공했습니다.

```bash
$ make verify-up
[+] Running 3/3
 ✔ Container postgres     Started
 ✔ Container goti-server  Started
 ✔ Container prometheus   Started
```

---

## 📚 배운 점

### 환경변수 기본값은 두 곳에 설정하자

Docker Compose 환경에서 Spring Boot 앱을 운영하면, 환경변수가 두 단계를 거칩니다:

1. **docker-compose.yml**: `${VAR:-default}` → 컨테이너에 환경변수 주입
2. **application.yml**: `${VAR:default}` → Spring Boot가 프로퍼티로 바인딩

어느 한쪽만 기본값이 있으면 나머지 한쪽에서 터질 수 있습니다.

| 상황 | compose 기본값 | application.yml 기본값 | 결과 |
|------|:-:|:-:|------|
| .env 있음 | 불필요 | 불필요 | 정상 |
| .env 없음, compose만 기본값 | ✅ | ❌ | 정상 (compose가 주입) |
| .env 없음, yml만 기본값 | ❌ | ✅ | 정상 (Spring이 처리) |
| .env 없음, 둘 다 없음 | ❌ | ❌ | **파싱 에러** |

가장 안전한 방법은 **양쪽 모두 기본값을 설정**하는 것이다.

### 새 환경변수 추가 시 체크리스트

- [ ] `docker-compose.app.yml`에 `${VAR:-default}` 형태로 추가했는가?
- [ ] `application.yml`에 `${VAR:default}` 형태로 기본값 추가했는가?
- [ ] `.env` 없이 기동 테스트를 해봤는가?

하나라도 빠지면 특정 환경에서만 터지는 시한폭탄이 됩니다.
