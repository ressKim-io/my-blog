---
title: "Grafana 대시보드가 전부 빨간색: CSRF Origin Not Allowed"
excerpt: "ALB(HTTPS) → Grafana(HTTP) 구성에서 Origin 헤더 불일치로 모든 패널이 깨진 트러블슈팅"
category: cicd
tags:
  - go-ti
  - grafana
  - csrf
  - alb
  - https
  - terraform
  - ec2
  - troubleshooting
series:
  name: "goti-ec2-deploy"
  order: 3
date: "2026-03-02"
---

## 한 줄 요약

> ALB가 HTTPS → HTTP로 변환하면서 브라우저의 Origin 헤더(`https://`)와 Grafana 내부 프로토콜(`http://`)이 불일치. CSRF 검증 실패로 모든 대시보드 패널이 데이터를 표시하지 못했습니다.

---

## 🔥 상황

EC2에 배포된 Grafana(`https://dev.go-ti.shop/monitoring/`)에 접속했습니다.

모든 대시보드 패널에 빨간 삼각형이 떠 있었습니다.
마우스를 올려보면 한 줄짜리 에러 메시지가 보입니다:

```
origin not allowed
```

CPU, 메모리, 요청 수 — 모든 패널이 동일한 에러였습니다.
Prometheus 데이터소스 자체에 접근하지 못하는 상황이었습니다.

---

## 🤔 원인: HTTPS → HTTP 변환에서의 Origin 불일치

### 가설 1: ALB가 Prometheus 포트를 안 열어서?

처음에는 ALB 보안그룹 문제를 의심했습니다.
하지만 Grafana의 데이터소스는 `access: proxy` 모드로 설정되어 있습니다.

이 모드에서는 Grafana 서버가 **Docker 내부 네트워크**에서 직접 Prometheus와 통신합니다.
브라우저 → ALB → Prometheus 경로가 아니라, Grafana 컨테이너 → Prometheus 컨테이너 경로입니다.
ALB 포트 노출과는 무관합니다.

### 가설 2: CSRF Origin 검증 실패?

이게 정답이었습니다.

요청 흐름을 따라가보겠습니다:

1. 브라우저가 `https://dev.go-ti.shop`으로 Grafana에 접속
2. 대시보드 패널이 데이터를 요청할 때 `Origin: https://dev.go-ti.shop` 헤더 전송
3. ALB가 HTTPS를 종료하고 HTTP로 변환하여 EC2의 Grafana에 전달
4. Grafana는 HTTP로 동작 중이므로, 자신의 Origin은 `http://...`
5. 브라우저의 `https://` Origin과 자신의 `http://` Origin이 불일치
6. **CSRF 보호 로직이 요청을 차단**

Grafana의 CSRF 보호는 요청의 Origin 헤더가 자신의 도메인과 일치하는지 검증합니다.
ALB 같은 리버스 프록시가 프로토콜을 변환하면, 이 검증이 실패하게 됩니다.

---

## ✅ 해결: CSRF Trusted Origins 설정

### 핵심 설정

Grafana에 `GF_SECURITY_CSRF_TRUSTED_ORIGINS` 환경변수를 추가하면 됩니다.

```yaml
# docker-compose.yml
grafana:
  environment:
    GF_SECURITY_CSRF_TRUSTED_ORIGINS: dev.go-ti.shop
```

이 설정은 "이 도메인에서 오는 요청은 프로토콜이 달라도 CSRF 검증을 통과시켜라"는 의미입니다.

### 인프라 반영 과정

단순히 docker-compose만 수정하면 안 됩니다.
EC2 배포 환경에서는 SSM Parameter Store에서 환경변수를 가져오기 때문에, 여러 곳을 수정해야 했습니다.

**1. SSM 파라미터 추가**

```bash
aws ssm put-parameter \
  --name "/dev/monitoring/GF_SECURITY_CSRF_TRUSTED_ORIGINS" \
  --value "dev.go-ti.shop" \
  --type "String"
```

**2. deploy.sh에 파라미터 로드 추가**

배포 스크립트가 SSM에서 해당 파라미터를 가져오도록 수정했습니다.

**3. Terraform 변수 선언**

```hcl
# terraform/dev/config/variables.tf
variable "grafana_csrf_trusted_origins" {
  description = "Grafana CSRF trusted origins"
  type        = string
}
```

여기서 한 가지 추가 이슈가 발생했습니다.

### 추가 이슈: Terraform undeclared variable

Terraform apply 시 이런 경고가 나왔습니다:

```
Warning: Value for undeclared variable
```

config 모듈의 `variables.tf`에는 변수를 선언했지만, **루트 모듈**의 `variables.tf`와 `main.tf`에서 변수를 선언하고 전달하지 않았던 것이 원인이었습니다.

Terraform에서 모듈을 사용할 때는 이 흐름을 기억해야 합니다:

1. 루트 `variables.tf`에 변수 선언
2. 루트 `main.tf`에서 모듈에 변수 전달
3. 모듈 `variables.tf`에서 변수 수신

어느 한 단계라도 빠지면 경고가 발생합니다.

### 최종 검증

```bash
# PR #37 merge → Monitoring CD 실행
$ curl -s -o /dev/null -w "%{http_code}" https://dev.go-ti.shop/monitoring/api/health
200
```

Grafana 대시보드의 모든 패널이 정상적으로 데이터를 표시했습니다.

### IaC 동기화

CLI로 먼저 생성한 SSM 파라미터를 Terraform state에 반영했습니다.

```bash
$ terraform import aws_ssm_parameter.grafana_csrf \
  "/dev/monitoring/GF_SECURITY_CSRF_TRUSTED_ORIGINS"

$ terraform apply
# No changes. Infrastructure is up-to-date.
```

---

## 📚 배운 점

### 리버스 프록시 + CSRF = 주의

ALB, Nginx, Traefik 등 리버스 프록시가 HTTPS를 종료하는 구성에서는 항상 CSRF 설정을 확인해야 합니다.

| 구성 | 브라우저 Origin | 서버 Origin | CSRF 결과 |
|------|:-:|:-:|:-:|
| 직접 HTTPS | `https://domain` | `https://domain` | 통과 |
| ALB(HTTPS) → 서버(HTTP) | `https://domain` | `http://domain` | **실패** |
| ALB + trusted origins 설정 | `https://domain` | `http://domain` | 통과 |

이건 Grafana만의 문제가 아닙니다.
Django, Rails, Spring Security 등 CSRF 보호가 있는 모든 프레임워크에서 동일하게 발생할 수 있습니다.

### 새 도메인 추가 시 잊지 말 것

`GF_SECURITY_CSRF_TRUSTED_ORIGINS`에 새 도메인을 추가해야 합니다.
Go-Ti 프로젝트에서는 이 값을 Terraform `tfvars`에서 관리하기로 했습니다.

**프로토콜 변환이 있는 리버스 프록시 뒤에서는 CSRF trusted origins 설정이 필수입니다.**
