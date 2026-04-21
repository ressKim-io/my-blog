---
date: 2026-03-06
category: troubleshoot
project: Goti-server
tags: [spring-boot, docker, env-var, jwt, duration-parsing]
---

# JWT_SOCIAL_VERIFY_TIME 환경변수 기본값 누락으로 Docker 기동 실패

## Context
OTel 레이블 검증을 위해 `make verify-up`으로 goti-server + 모니터링 스택을 Docker에 기동하는 중 발생.
goti-server 컨테이너가 반복적으로 재시작됨.

## Issue

```
Failed to bind properties under 'jwt.social-verify-valid-time' to java.time.Duration:
    Property: jwt.social-verify-valid-time
    Value: "${JWT_SOCIAL_VERIFY_TIME}"
    Origin: class path resource [application.yml] - 43:29
    Reason: '${JWT_SOCIAL_VERIFY_TIME}' is not a valid duration
```

재현 조건: `.env` 파일 없이 `docker-compose.app.yml`로 기동 시 `JWT_SOCIAL_VERIFY_TIME` 환경변수가 전달되지 않아 Spring Boot가 `${JWT_SOCIAL_VERIFY_TIME}` 문자열을 Duration으로 파싱 시도 → 실패.

## Action

1. 가설 1: OTel 관련 설정 문제 → 결과: **기각**. `docker logs goti-server`에서 JWT Duration 파싱 에러 확인.

2. 가설 2: `docker-compose.app.yml`에 환경변수 누락 → 결과: **수용**. 다른 JWT 변수(`JWT_ACCESS_TIME`, `JWT_REFRESH_TIME`)는 `${VAR:-default}` 패턴으로 기본값이 있으나 `JWT_SOCIAL_VERIFY_TIME`만 누락.

**근본 원인 (Root Cause):**
`application.yml`의 `jwt.social-verify-valid-time: ${JWT_SOCIAL_VERIFY_TIME}` 속성에 기본값이 없고, `docker-compose.app.yml`에도 해당 환경변수가 정의되지 않음. 다른 JWT 환경변수 추가 시 이 항목만 누락된 것으로 추정.

**적용한 수정:**
- `docker/docker-compose.app.yml`: `JWT_SOCIAL_VERIFY_TIME: ${JWT_SOCIAL_VERIFY_TIME:-300000}` 추가
- `api/src/main/resources/application.yml`: `${JWT_SOCIAL_VERIFY_TIME:300000}` 기본값 추가

## Result

수정 후 `.env` 없이 Docker 기동 성공 확인.
goti-server PR로 제출 (branch: `chore/fix-docker-env-defaults`).

재발 방지:
- 새 환경변수 추가 시 `docker-compose.app.yml`과 `application.yml` 양쪽에 기본값 설정 필수
- `make verify-up` 검증 플로우에서 서버 기동 실패 자동 감지 (헬스체크 대기)

## Related Files
- goti-server/docker/docker-compose.app.yml
- goti-server/api/src/main/resources/application.yml
- Goti-monitoring/docker/docker-compose.server-otel.yml (임시 우회용)
