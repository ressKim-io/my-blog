---
title: "EC2 CD 파이프라인 스킬 보강 — 트러블 4건을 체크리스트로"
excerpt: "SSM waiter 타임아웃, CloudFront 403, JWT env 누락, ALB 헬스체크 등 EC2 CD에서 반복된 트러블 4건을 ec2-cd-pipeline.md 신규 스킬과 docker.md 보강으로 재발 방지했습니다."
category: cicd
tags:
  - go-ti
  - Meta
  - EC2
  - CD
  - CloudFront
  - ALB
  - Docker
  - Skill
series:
  name: "goti-meta"
  order: 2
date: "2026-03-11"
---

## 한 줄 요약

> K8s 스킬 보강에 이어 EC2 CD 파이프라인 영역을 점검했습니다. 기존 CI/CD 스킬이 ArgoCD/GitOps에 편중되어 GitHub Actions + SSM + ALB + CloudFront 패턴이 비어 있었고, 트러블 4건을 분석해 신규 스킬 1개와 기존 스킬 1개에 반영했습니다

---

## 🔥 문제: EC2 CD 파이프라인 지식이 스킬에 비어 있었다

dev 서버를 EC2 + ALB + CloudFront로 계속 운영 중이었습니다
CI/CD 스킬 파일들이 ArgoCD/GitOps 중심이었기 때문에, EC2 기반 파이프라인에서 반복되는 패턴이 에이전트 참조 지식으로 쌓이지 않았습니다

그 결과 같은 함정에 반복해서 걸렸습니다

### 분석한 데이터 소스 4건

| 트러블 | 증상 |
|--------|------|
| `cd-ssm-waiter-timeout` | `aws ssm wait` 기본 100초 타임아웃에 걸려 CD 실패 |
| `cloudfront-swagger-403` | CloudFront behavior 누락 → S3 폴백이 403 반환 |
| `jwt-social-verify-time` | Docker env 기본값 누락 → Spring Boot Duration 파싱 실패 |
| `dev-monitoring-502` | ALB 헬스체크 경로 + Docker 포트 바인딩 불일치 |

네 건 모두 **"스킬에 있었으면 애초에 걸리지 않았을 항목"**이었습니다
특히 SSM waiter의 100초 타임아웃은 공식 문서에도 묻혀 있어, 실제로 걸려본 뒤에야 학습 가능했습니다

---

## 🤔 원인: ArgoCD-편향 스킬 + "한 번 겪은 패턴"의 휘발성

`.claude/skills/` 구조를 점검해보니 CI/CD 관련 스킬은 GitOps·ArgoCD 중심이었습니다

- `gitops-argocd.md`, `gitops-argocd-advanced.md`, `gitops-argocd-helm.md`
- EC2 계열은 `docker.md` 하나가 전부, 그마저도 환경변수 기본값 패턴이 미흡

겪어본 트러블이 스킬 파일로 정리되지 않으면, 다음 세션에서 Claude가 같은 문제에 부딪혔을 때 일반 지식으로 돌아가 같은 실수를 반복합니다

---

## ✅ 해결: 신규 스킬 1개 + 기존 스킬 보강

### 수정/신규 파일 2개

| 파일 | 작업 | 추가 내용 |
|------|------|----------|
| `docker.md` | 수정 | 환경변수 `${VAR:-default}` 필수 패턴, docker-compose ↔ application.yml 3곳 동기화 체크리스트 |
| `ec2-cd-pipeline.md` | **신규** | SSM polling 패턴, CloudFront behavior, ALB 헬스체크, CD 검증 체크리스트 |

### 트러블 → 스킬 반영 매핑

| 트러블 | 스킬 반영 위치 |
|--------|----------------|
| SSM waiter 100초 타임아웃 | `ec2-cd-pipeline.md` SSM polling 섹션 |
| CloudFront Swagger 403 | `ec2-cd-pipeline.md` CloudFront behavior 섹션 |
| JWT env 기본값 누락 | `docker.md` 환경변수 기본값 패턴 섹션 |
| ALB 헬스체크 401 | `ec2-cd-pipeline.md` ALB 헬스체크 섹션 (+ docker.md 이전 반영) |

### SSM polling 패턴 (예시)

`aws ssm wait command-executed`는 기본 20회 × 5초 = **100초**에서 타임아웃됩니다
Spring Boot 기동이 2~3분 걸리는 dev 환경에서는 무조건 실패합니다

스킬에 기록한 대안 패턴은 다음과 같습니다

```bash
# ❌ Bad: waiter 기본 타임아웃 100초
aws ssm wait command-executed \
  --command-id "$CMD_ID" --instance-id "$INSTANCE_ID"

# ✅ Good: polling 루프로 타임아웃 명시
MAX_ATTEMPTS=60   # 5초 × 60 = 5분
for i in $(seq 1 $MAX_ATTEMPTS); do
  STATUS=$(aws ssm get-command-invocation \
    --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
    --query 'Status' --output text)
  case "$STATUS" in
    Success)   exit 0 ;;
    Failed|Cancelled|TimedOut) exit 1 ;;
    *) sleep 5 ;;
  esac
done
exit 1
```

명시적 polling 루프는 타임아웃을 자유롭게 조절할 수 있고, 실패 시 원인 상태(`Failed`/`Cancelled`)를 구분해 로그에 남길 수 있습니다

---

## 📚 배운 점

- **스킬은 "한 번 겪은 트러블"이 올라가는 선반입니다.** dev-log로만 남기고 스킬로 정리하지 않으면 다음 세션에서 같은 실수를 반복합니다
- **도메인별 스킬 편향을 주기적으로 점검합니다.** ArgoCD/GitOps 스킬이 풍성하고 EC2 스킬이 빈 것처럼, 실제 운영 영역과 스킬 분포가 어긋나 있는지 확인이 필요합니다
- **공식 도구의 기본값은 블로그 수준 가이드에는 잘 안 드러납니다.** SSM waiter 100초 타임아웃처럼 "문서에 있지만 실무에선 모르고 당하는" 항목은 스킬에 먼저 기록해둡니다
- **미반영/TODO도 스킬 문서에 남깁니다.** GitHub Actions best practice(matrix, caching), SSM Parameter Store 전환 같은 추후 이슈는 "미반영" 섹션에 남겨 다음 사이클에서 이어받게 합니다
