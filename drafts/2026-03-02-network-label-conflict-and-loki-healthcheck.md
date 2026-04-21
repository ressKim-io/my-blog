---
date: 2026-03-02
category: troubleshoot
project: Goti-monitoring, Goti-server
tags: [docker-compose, network, external, label-conflict, wget, healthcheck, loki]
---

# docker-compose 네트워크 라벨 충돌 + Loki 헬스체크 HEAD 미지원

## Context
배포 환경 개선 작업 중 docker-compose 네트워크를 `external: true` → `name: goti-monitoring` + `driver: bridge`로 변경하여 순서 독립성을 확보하려 했음. 동시에 Monitoring CD에서 Loki 헬스체크가 매번 실패하는 기존 이슈도 발견.

## Issue

### 이슈 1: 네트워크 라벨 충돌

```
time="2026-03-02T03:16:28Z" level=warning msg="a network with name goti-monitoring exists but was not created by compose.
Set `external: true` to use an existing network"
network goti-monitoring was found but has incorrect label com.docker.compose.network set to "" (expected: "goti-monitoring")
```

재현 조건: deploy.sh에서 `docker network create goti-monitoring`으로 수동 생성된 네트워크가 있는 상태에서, docker-compose에 `name: goti-monitoring` + `driver: bridge`를 사용하면 발생.

### 이슈 2: Loki 헬스체크 실패

```
[7/8] 서비스 헬스체크...
  ✓ Prometheus OK
  ✓ Grafana OK
  ✗ Loki FAIL (http://localhost:3100/ready)
  ✓ Tempo OK
  ✓ Alertmanager OK
  ✓ Alloy OK
```

재현 조건: Monitoring CD가 실행될 때마다 Loki만 실패. docker healthcheck(컨테이너 내부)에서는 healthy인데 deploy.sh(호스트)에서만 실패. 이전 배포(PR #32, #34)에서도 동일 증상 확인.

## Action

### 이슈 1 진단
1. 가설: `name:` + `driver:` 방식이면 네트워크 없을 때 자동 생성, 있으면 재사용할 것 → 결과: **로컬에서는 성공**, EC2에서는 실패
2. 가설: EC2의 기존 네트워크가 `docker network create`로 수동 생성된 것이라 compose 라벨이 없음 → 결과: **정확함**. compose는 `com.docker.compose.network` 라벨을 체크하여 자기가 만든 네트워크만 재사용

근본 원인: docker compose는 `name:` + `driver:` 조합일 때 같은 이름의 네트워크가 있어도 compose 라벨이 없으면 거부함. `external: true`만이 라벨 무관하게 기존 네트워크를 수용.

적용 수정:
- `external: true`로 복원 (docker-compose.yml, docker-compose.deploy.yml 양쪽)
- 로컬 순서 독립성은 Makefile의 `up` 타겟에 `docker network create` 안전장치 추가로 해결

### 이슈 2 진단
1. 가설: Loki 기동이 느려서 타임아웃 → 결과: 아님. docker ps에서 healthy이고 40시간 전에 생성된 컨테이너
2. 가설: `wget --spider`가 HEAD 요청을 보내는데 Loki `/ready`가 HEAD를 지원하지 않음 → 결과: **정확함**. docker healthcheck에서는 같은 URL이지만 `wget --spider`가 아닌 다른 방식일 수 있음

근본 원인: `wget -q --spider`는 HEAD 요청을 보냄. Loki `/ready` 엔드포인트가 HEAD 메서드를 지원하지 않아 항상 실패.

적용 수정:
- `wget -q --spider "$url"` → `wget -qO /dev/null "$url"` (GET 요청으로 변경)

## Result
- 이슈 1: Server CD(deploy/dev) 배포 성공 확인 (run 22560005362)
- 이슈 2: Monitoring CD(main) 배포 성공 확인 (run 22560192329, 37초) — Loki 포함 6개 서비스 전체 헬스체크 통과
- 회귀 테스트: 별도 추가 없음 (CD 파이프라인 자체가 검증)
- 재발 방지: docker-compose에서 `external: true` 네트워크는 `name:` + `driver:`로 바꾸지 말 것. deploy.sh에서 수동 `docker network create`를 사용하는 한 `external: true` 유지 필수

## Related Files
- Goti-monitoring/docker/docker-compose.yml
- Goti-monitoring/Makefile
- Goti-monitoring/scripts/deploy.sh
- Goti-server/docker/docker-compose.deploy.yml
