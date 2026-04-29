---
title: "PostgreSQL Healthcheck가 계속 실패한 이유: 환경변수 이름 혼동"
excerpt: "docker-compose environment 좌변과 우변을 혼동해서 healthcheck가 빈 문자열로 실행된 트러블슈팅"
category: cicd
tags:
  - go-ti
  - docker-compose
  - healthcheck
  - environment-variable
  - postgres
  - ec2
  - troubleshooting
series:
  name: "goti-ec2-deploy"
  order: 1
date: "2026-02-28"
---

## 한 줄 요약

> PostgreSQL healthcheck에서 컨테이너 내부에 없는 환경변수를 참조해서 `pg_isready -U ""`로 실행됨. unhealthy 상태가 되면서 app 서비스가 시작되지 않았습니다.

---

## 🔥 상황

Go-Ti 서버를 EC2에 docker-compose로 배포하는 과정이었습니다.
배포 후 app 서비스가 올라오지 않았습니다.

원인은 단순했습니다.
postgres 컨테이너가 **unhealthy** 상태였고, `depends_on: service_healthy` 조건 때문에 app이 시작을 못 한 것이었습니다.

```bash
$ docker ps
CONTAINER ID  IMAGE     STATUS                    NAMES
abc123        postgres  Up 30s (unhealthy)        postgres
def456        goti-app  Waiting                   goti-server
```

postgres가 정상적으로 뜨는데 왜 unhealthy일까?

---

## 🤔 원인: 환경변수 좌변과 우변의 혼동

문제의 `docker-compose.deploy.yml`을 살펴보겠습니다.

```yaml
# docker-compose.deploy.yml
postgres:
  environment:
    POSTGRES_USER: ${DATASOURCE_USERNAME}    # 호스트 .env → 컨테이너 내부
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U $${DATASOURCE_USERNAME}"]
```

여기서 핵심을 짚어보겠습니다.

### environment 매핑 구조

`environment:` 섹션의 구문을 분해하면 이렇습니다:

- **좌변** `POSTGRES_USER`: 컨테이너 내부에 생성되는 환경변수 이름
- **우변** `${DATASOURCE_USERNAME}`: 호스트의 `.env`에서 가져오는 값

즉, 호스트의 `DATASOURCE_USERNAME` 값을 컨테이너의 `POSTGRES_USER`로 **이름을 바꿔서** 주입하는 것입니다.
컨테이너 내부에는 `POSTGRES_USER`만 존재합니다. `DATASOURCE_USERNAME`은 없습니다.

### healthcheck에서의 $$ 이스케이프

`$${DATASOURCE_USERNAME}`에서 `$$`는 compose의 이스케이프 문법입니다.
compose가 이것을 처리하면 컨테이너 내부에서 `${DATASOURCE_USERNAME}`이라는 셸 변수를 참조하게 됩니다.

그런데 컨테이너 안에는 `DATASOURCE_USERNAME`이 없습니다.

결과적으로 이런 일이 벌어진 것입니다:

1. healthcheck가 컨테이너 내부에서 실행
2. `${DATASOURCE_USERNAME}` → 빈 문자열로 치환
3. `pg_isready -U ""` 실행
4. 인증 실패 → healthcheck 실패 → **unhealthy**

---

## ✅ 해결: 컨테이너 내부 변수명으로 변경

수정은 한 줄이면 됩니다.

```yaml
# Before
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U $${DATASOURCE_USERNAME}"]

# After
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER}"]
```

`DATASOURCE_USERNAME`(호스트 변수명)이 아니라 `POSTGRES_USER`(컨테이너 내부 변수명)를 참조하도록 변경했습니다.

### 검증

`scripts/validate-deploy.sh` 스크립트를 만들어서 이런 패턴을 자동으로 감지하도록 했습니다.

- healthcheck에서 `$${VAR}` 패턴을 추출
- 해당 서비스의 `environment:` 좌변 키와 대조
- 불일치하면 FAIL 처리

```bash
$ ./scripts/validate-deploy.sh
[CHECK] Healthcheck 환경변수 정합성...
  postgres: $${POSTGRES_USER} → environment 키 확인 → PASSED
```

---

## 📚 배운 점

### compose environment 매핑의 핵심 규칙

```yaml
environment:
  CONTAINER_VAR: ${HOST_VAR}
```

여기서 좌변(`CONTAINER_VAR`)은 컨테이너 **내부** 변수명이고, 우변(`${HOST_VAR}`)은 호스트(셸)에서 가져오는 값입니다.

이 구조에서 **healthcheck는 컨테이너 내부에서 실행**됩니다.
따라서 항상 **좌변**(컨테이너 내부 변수명)을 참조해야 합니다.

간단한 규칙이지만, `DATASOURCE_USERNAME`처럼 의미가 통하는 이름이면 무심코 우변을 쓰기 쉽습니다.
특히 여러 서비스에서 같은 값을 다른 이름으로 매핑할 때 더 헷갈립니다.

**자동 검증 스크립트로 이런 실수를 방지하는 것이 가장 확실한 방법입니다.**
