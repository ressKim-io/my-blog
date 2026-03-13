---
title: "Docker 네트워크 라벨 충돌 + Loki Healthcheck HEAD 미지원"
excerpt: "docker-compose 네트워크 설정 변경으로 라벨 충돌이 발생하고, wget --spider가 Loki에서 실패한 두 가지 트러블슈팅"
category: cicd
tags:
  - go-ti
  - docker-compose
  - docker-network
  - loki
  - healthcheck
  - ec2
series:
  name: "goti-ec2-deploy"
  order: 4
date: "2026-03-02"
---

## 한 줄 요약

> docker-compose 네트워크를 `external: true`에서 `name: + driver:`로 바꾸면 라벨 충돌이 발생하고, `wget --spider`는 HEAD 요청을 보내는데 Loki `/ready`가 HEAD를 지원하지 않아 healthcheck가 실패했습니다.

---

이 글에서는 배포 환경 개선 중 동시에 발생한 두 가지 이슈를 다룹니다.

---

## 🔥 이슈 1: Docker 네트워크 라벨 충돌

### 상황

docker-compose 네트워크를 `external: true` 대신 `name:` + `driver:` 조합으로 변경하려고 했습니다.
목적은 **순서 독립성 확보**였어요.

`external: true`는 네트워크가 미리 존재해야 합니다.
Server를 먼저 올리고 Monitoring을 나중에 올리면, Monitoring의 네트워크가 아직 없어서 실패할 수 있어요.
`name:` + `driver:` 조합이면 없을 때 자동으로 생성해주니까 순서에 의존하지 않을 거라 생각했습니다.

로컬에서는 정상 동작했습니다. 하지만 EC2에서는 달랐어요.

### 에러 메시지

```
time="2026-03-02T03:16:28Z" level=warning msg="a network with name goti-monitoring
exists but was not created by compose.
Set `external: true` to use an existing network"

network goti-monitoring was found but has incorrect label
com.docker.compose.network set to "" (expected: "goti-monitoring")
```

### 🤔 원인

EC2의 `deploy.sh`에서는 `docker network create goti-monitoring`으로 네트워크를 **수동 생성**합니다.
수동으로 만든 네트워크에는 compose 라벨(`com.docker.compose.network`)이 없어요.

docker-compose는 `name:` + `driver:` 조합일 때 이렇게 동작합니다:

1. 같은 이름의 네트워크가 있는지 확인
2. 있으면 `com.docker.compose.network` 라벨을 체크
3. 라벨이 없거나 값이 다르면 → **거부**

즉, compose는 **자기가 만든 네트워크만 재사용**합니다.
`docker network create`로 수동 생성한 네트워크는 "남의 것"으로 취급해요.

반면 `external: true`는 라벨을 체크하지 않습니다.
"이미 존재하는 외부 네트워크를 그대로 쓰겠다"는 명시적 선언이니까요.

### ✅ 해결

`external: true`로 복원했습니다.

```yaml
# docker-compose.yml, docker-compose.deploy.yml
networks:
  goti-monitoring:
    external: true    # 라벨 무관하게 기존 네트워크 사용
```

순서 독립성은 다른 방법으로 해결했어요.
Makefile의 `up` 타겟에 네트워크 생성 안전장치를 추가했습니다:

```makefile
up:
	docker network create goti-monitoring 2>/dev/null || true
	docker compose up -d
```

`2>/dev/null || true`로 이미 존재할 때의 에러를 무시합니다.

---

## 🔥 이슈 2: Loki Healthcheck만 실패

### 상황

Monitoring CD가 실행될 때마다 Loki만 healthcheck에서 실패했습니다.
이전 배포(PR #32, #34)에서도 동일한 증상이 있었어요.

```
[7/8] 서비스 헬스체크...
  ✓ Prometheus OK
  ✓ Grafana OK
  ✗ Loki FAIL (http://localhost:3100/ready)
  ✓ Tempo OK
  ✓ Alertmanager OK
  ✓ Alloy OK
```

이상한 점은, Docker 컨테이너 자체의 healthcheck에서는 **healthy**로 표시된다는 거예요.
`deploy.sh`의 호스트 healthcheck에서만 실패했습니다.

### 🤔 원인

`deploy.sh`의 healthcheck 함수를 살펴봤습니다:

```bash
check_health() {
  local url=$1
  wget -q --spider "$url"
}
```

`wget --spider`의 동작 방식이 핵심입니다.
`--spider`는 파일을 다운로드하지 않고 **HEAD 요청**만 보냅니다.

Loki의 `/ready` 엔드포인트는 GET 요청에는 응답하지만, **HEAD 메서드를 지원하지 않아요**.
HEAD 요청을 받으면 405(Method Not Allowed)나 빈 응답을 반환합니다.

다른 서비스(Prometheus, Grafana 등)는 HEAD 요청도 처리하기 때문에 문제가 없었던 거예요.

### ✅ 해결

`wget --spider`를 `wget -qO /dev/null`로 변경했습니다.

```bash
# Before: HEAD 요청
wget -q --spider "$url"

# After: GET 요청 (출력은 /dev/null로 버림)
wget -qO /dev/null "$url"
```

`-O /dev/null`은 응답 본문을 버리면서 GET 요청을 보냅니다.
실질적으로 "URL이 응답하는지"만 확인하는 용도로는 이 방식이 더 안전해요.

---

## 검증 결과

두 이슈를 모두 수정한 후:

- **이슈 1**: Server CD(deploy/dev) 배포 성공
- **이슈 2**: Monitoring CD 배포 성공 — Loki 포함 6개 서비스 전체 healthcheck 통과 (37초)

```
[7/8] 서비스 헬스체크...
  ✓ Prometheus OK
  ✓ Grafana OK
  ✓ Loki OK          ← 드디어 통과!
  ✓ Tempo OK
  ✓ Alertmanager OK
  ✓ Alloy OK
```

---

## 📚 배운 점

### Docker Compose 네트워크: external vs name

| 방식 | 자동 생성 | 라벨 체크 | 수동 생성 네트워크 |
|------|:-:|:-:|:-:|
| `external: true` | ❌ | ❌ | 사용 가능 |
| `name:` + `driver:` | ✅ | ✅ | **사용 불가** |

`deploy.sh`에서 `docker network create`를 사용하는 구조라면 `external: true`를 유지해야 합니다.
`name:` + `driver:` 조합은 compose가 네트워크 생명주기를 완전히 관리하는 경우에만 쓰세요.

### wget --spider의 함정

`wget --spider`는 healthcheck에 자주 쓰이지만, HEAD 메서드를 지원하지 않는 서비스에서는 실패합니다.

| 서비스 | HEAD 지원 | --spider 결과 |
|--------|:-:|:-:|
| Prometheus | ✅ | 성공 |
| Grafana | ✅ | 성공 |
| Loki | ❌ | **실패** |
| Tempo | ✅ | 성공 |

healthcheck에서는 `wget -qO /dev/null`이 더 범용적이다.
HEAD 메서드 지원 여부에 의존하지 않기 때문에, 어떤 서비스든 안정적으로 확인할 수 있습니다.
