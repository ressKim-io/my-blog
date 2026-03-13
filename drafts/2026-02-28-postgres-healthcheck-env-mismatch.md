---
date: 2026-02-28
category: troubleshoot
project: Goti-server
tags: [docker-compose, healthcheck, environment-variable, postgres]
---

# postgres healthcheck에서 컨테이너 내부에 없는 환경변수 참조

## Context
- Goti-server `docker-compose.deploy.yml`의 postgres 서비스
- EC2 배포 시 postgres 컨테이너가 unhealthy → app 서비스 시작 불가 (depends_on: service_healthy)

## Issue

```yaml
# docker-compose.deploy.yml
postgres:
  environment:
    POSTGRES_USER: ${DATASOURCE_USERNAME}    # .env의 값을 POSTGRES_USER로 매핑
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U $${DATASOURCE_USERNAME}"]  # 컨테이너 내부에서 실행
```

`$${DATASOURCE_USERNAME}`은 compose의 `$$` 이스케이프로 컨테이너 내부에서 `${DATASOURCE_USERNAME}` 셸 변수로 해석됨.
그러나 postgres 컨테이너 내부에는 `POSTGRES_USER`만 환경변수로 존재하고 `DATASOURCE_USERNAME`은 없음.

결과: `pg_isready -U ""` (빈 문자열) → healthcheck 실패 → unhealthy

## Action

### 진단
- compose의 `environment:` 섹션에서 `POSTGRES_USER: ${DATASOURCE_USERNAME}` 구문 확인
  - 이는 호스트의 `DATASOURCE_USERNAME` 값을 컨테이너의 `POSTGRES_USER` 변수로 **이름을 바꿔서** 주입
  - 컨테이너 내부에는 `POSTGRES_USER`만 존재, `DATASOURCE_USERNAME`은 없음
- healthcheck의 `$${}` 는 컨테이너 내부 셸에서 실행되므로 컨테이너 내부 환경변수만 참조 가능

### 근본 원인 (Root Cause)
compose `environment:` 의 좌변(컨테이너 내부 변수명)과 우변(호스트 변수 참조)을 혼동.
healthcheck에서는 **좌변**(컨테이너 내부 변수명)을 사용해야 함.

### 적용한 수정

```yaml
# Before
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U $${DATASOURCE_USERNAME}"]

# After
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER}"]
```

## Result
- `scripts/validate-deploy.sh` 검증 스크립트로 정합성 확인 → PASSED
- EC2 재배포는 미완료 (OTel BOM 수정과 함께 commit/push 대기)

### 재발 방지책
- `scripts/validate-deploy.sh` 의 "Healthcheck 환경변수 정합성" 검사가 이 패턴을 자동 감지
  - `$${VAR}` 패턴을 추출 → 해당 서비스의 `environment:` 좌변 키와 대조 → 불일치 시 FAIL
- **교훈**: compose에서 `environment: { A: ${B} }` 구문은 "호스트의 B를 컨테이너의 A로 매핑"이므로, 컨테이너 내부 healthcheck에서는 반드시 A를 참조

## Related Files
- `Goti-server/docker/docker-compose.deploy.yml` — healthcheck 환경변수 참조 수정
- `scripts/validate-deploy.sh` — 자동 검증 스크립트 (신규)
