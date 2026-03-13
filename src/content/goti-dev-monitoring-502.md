---
title: "502 Bad Gateway 동시다발: Docker 포트 바인딩과 ALB 헬스체크의 합작"
excerpt: "모니터링 스택 개선 배포 직후 Grafana와 API가 동시에 502를 반환한 원인 분석과 해결"
category: cicd
tags:
  - ALB
  - Docker
  - Grafana
  - Spring Security
  - Health Check
  - Troubleshooting
series:
  name: "goti-cloudfront-alb"
  order: 2
date: '2026-03-09'
---

## 한 줄 요약

> 모니터링 스택 개선 배포 후 Grafana(502)와 API(502) 동시 장애. Grafana는 Docker 포트가 localhost 전용으로 바뀐 것, API는 ALB 헬스체크 경로가 인증이 필요한 `/`로 설정된 것이 원인이다.

## Impact

- **영향 범위**: Grafana + API 전체
- **증상**: 502 Bad Gateway (두 서비스 동시)
- **소요 시간**: 약 1시간
- **발생일**: 2026-03-09

---

## 🔥 증상: 두 서비스가 동시에 502

### 발생 시점

모니터링 스택 리뷰 기반 일괄 개선(#52) 배포 직후에 발생했습니다.

```
dev.go-ti.shop/monitoring/*  → 502 Bad Gateway
dev.go-ti.shop/api/*         → 502 Bad Gateway
```

인프라 경로는 CloudFront → ALB(goti-dev-alb) → EC2(Docker containers) 구조입니다.

### ALB Target Group 상태

```
ALB Target Group: goti-dev-grafana-tg → unhealthy (Health checks failed)
ALB Target Group: goti-dev-tg → unhealthy (Health checks failed with codes: [401])
```

두 타겟 그룹 모두 unhealthy 상태였어요.
ALB는 unhealthy 타겟에 트래픽을 전달하지 않으므로 502를 반환한 겁니다.

---

## 🤔 원인 분석: 두 가지 문제가 동시에

### 진단 과정

순서대로 가설을 세우고 검증했습니다.

**가설 1: CloudFront 설정 문제**

CloudFront behaviors를 확인했어요.
`/monitoring/*` → ALB Origin 라우팅 정상, ALB 리스너에 `/monitoring/*` → grafana-tg 룰도 존재.
CloudFront 쪽은 문제가 없었습니다. 기각.

**가설 2: ALB 타겟 헬스 문제**

`aws elbv2 describe-target-health`로 확인하니 두 타겟 모두 unhealthy.
여기가 문제의 시작점이다. 수용.

그런데 두 타겟이 **같은 이유**로 unhealthy인 건 아니었어요.
각각 다른 원인이 있었습니다.

---

### 원인 1: Grafana Docker 포트 바인딩 (localhost 전용)

```bash
$ docker ps
... 127.0.0.1:3000->3000/tcp ...
```

`127.0.0.1:3000`으로 바인딩되어 있었어요.
이러면 **localhost에서만** 접근 가능하고, 외부(ALB 포함)에서는 접근이 불가능합니다.

Git diff로 원인을 찾았습니다:

```bash
$ git diff 7d1ed0a 7708a90 -- docker/docker-compose.yml
```

커밋 7708a90(#52 리뷰 개선)에서 보안 강화 목적으로 포트 바인딩을 변경한 것이 원인이었어요:

```yaml
# Before (정상)
ports:
  - "3000:3000"

# After (문제 발생)
ports:
  - "127.0.0.1:3000:3000"
```

의도는 좋았어요. 불필요한 외부 노출을 막으려고 localhost로 제한한 거니까요.
하지만 **ALB가 EC2의 3000번 포트로 직접 접근하는 구조**를 고려하지 않은 것이 문제였다.

ALB 헬스체크 흐름을 보면:

1. ALB가 EC2:3000으로 헬스체크 요청 전송
2. Docker가 `127.0.0.1`만 리슨 → 연결 거부
3. 헬스체크 실패 → unhealthy 판정
4. 502 Bad Gateway 반환

### 원인 2: ALB 서버 헬스체크 경로 (401 Unauthorized)

Grafana와는 별개로, 서버 타겟 그룹도 unhealthy였어요.
에러 코드가 `401`인 것이 힌트입니다.

Terraform `alb.tf`를 확인했습니다:

```hcl
# terraform/dev/billing/alb.tf
health_check {
  path = "/"  # 문제의 설정
}
```

헬스체크 경로가 `/`로 설정되어 있었어요.
Spring Boot 서버에서 `/`는 Spring Security가 인증을 요구하는 경로입니다.
인증 없이 접근하면 401을 반환하고, ALB는 이를 unhealthy로 판정합니다.

올바른 헬스체크 경로는 `/actuator/health`예요.
Spring Boot Actuator 헬스 엔드포인트는 인증 없이 접근 가능하도록 설계되어 있습니다.

---

## ✅ 해결: 포트 바인딩 복원 + 헬스체크 경로 수정

### 수정 1: Grafana 포트 바인딩 복원

```yaml
# docker/docker-compose.yml (line 206)
# Before
ports:
  - "127.0.0.1:3000:3000"

# After
ports:
  - "3000:3000"
```

Grafana 컨테이너 재시작 후 `goti-dev-grafana-tg`가 healthy로 전환되었습니다.

### 수정 2: ALB 헬스체크 경로 변경

```hcl
# terraform/dev/billing/alb.tf (line 30)
# Before
health_check {
  path = "/"
}

# After
health_check {
  path = "/actuator/health"
}
```

Terraform apply 후 `goti-dev-tg`가 healthy로 전환되었습니다.

### 결과

- `dev.go-ti.shop/monitoring` → 정상 접근 복원
- `dev.go-ti.shop/api/*` → 정상 접근 복원

---

## 📚 배운 점

### Docker 포트 바인딩과 네트워크 접근 제한

Docker 포트 바인딩으로 보안을 강화하려는 시도는 일견 합리적이에요.
하지만 **누가 이 포트에 접근하는지**를 먼저 파악해야 합니다.

| 바인딩 방식 | 접근 범위 | ALB 접근 |
|------------|----------|---------|
| `"3000:3000"` | 모든 네트워크 | 가능 |
| `"127.0.0.1:3000:3000"` | localhost만 | **불가** |

네트워크 접근 제한은 Docker 포트 바인딩이 아닌 **Security Group**에서 처리하는 것이 올바른 방법이에요.
Security Group으로 ALB에서만 접근을 허용하면 보안과 기능을 모두 지킬 수 있습니다.

### ALB 헬스체크 경로 선정 기준

ALB 헬스체크 경로는 반드시 **인증이 불필요한 엔드포인트**를 사용해야 합니다:

- Spring Boot: `/actuator/health`
- Node.js: `/health` 또는 `/healthz`
- Grafana: `/api/health`

헬스체크가 인증을 요구하는 경로를 바라보면, 정상 서비스도 unhealthy로 판정됩니다.

### 배포 후 검증 루틴

모니터링 스택 배포 후에는 타겟 상태를 반드시 확인해야 해요:

```bash
$ aws elbv2 describe-target-health \
    --target-group-arn <target-group-arn> \
    --query 'TargetHealthDescriptions[].TargetHealth'
```

이 명령으로 healthy/unhealthy 상태를 즉시 확인할 수 있습니다.

---

## 요약

| 항목 | 내용 |
|------|------|
| **문제** | Grafana + API 동시 502 Bad Gateway |
| **원인 1** | Grafana Docker 포트가 `127.0.0.1`로 바인딩 → ALB 접근 불가 |
| **원인 2** | ALB 헬스체크 경로 `/`에 Spring Security 인증 → 401 → unhealthy |
| **해결** | 포트 바인딩 `0.0.0.0`으로 복원 + 헬스체크 `/actuator/health`로 변경 |
| **교훈** | 네트워크 제한은 Security Group으로, 헬스체크는 인증 불필요 경로로 |
