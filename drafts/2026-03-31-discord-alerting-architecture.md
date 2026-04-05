---
date: 2026-03-31
category: decision
project: goti-monitoring, goti-k8s, goti-terraform
tags: [alertmanager, discord, monitoring, alerting, externalsecret]
---

# Discord 알림 아키텍처 결정 — Slack→Discord 전환, /slack endpoint, severity별 채널 분리

## Context

EKS prod 환경에 Alertmanager, PrometheusRule(20개+), Blackbox Exporter, webhook-bridge가 모두 동작 중이었지만, receiver가 전부 `"null"`로 설정되어 알림이 아무 곳에도 전송되지 않는 상태였다. 팀원이 알림 채널 구축을 요청했고, Slack 대신 Discord를 사용하기로 결정했다.

## Issue

### Option A: Discord native webhook (`webhook_configs`)
- 장점: Discord embed 형식으로 rich 메시지 (색상, 필드 구분) 가능
- 단점: Alertmanager에 Discord 네이티브 지원 없음. Go template으로 Discord embed JSON을 직접 구성해야 하며 유지보수 부담 큼

### Option B: Discord `/slack` endpoint (`slack_configs`)
- 장점: Discord webhook URL에 `/slack` suffix 붙이면 Slack 형식 payload 수신 가능. Alertmanager의 `slack_configs`를 그대로 사용. `api_url_file` 지시어로 ExternalSecret 패턴 재사용
- 단점: Slack-format 메시지는 embed 대신 plain text 렌더링. severity별 색상 sidebar 불가

### Option C: alertmanager-discord 같은 별도 프록시 서비스
- 장점: rich embed + 유연한 포맷팅
- 단점: 추가 Deployment/Service 운영 부담. webhook-bridge와 역할 중복 가능

### 채널 구조: 단일 채널 vs severity별 분리
- 단일 채널: 관리 용이, webhook URL 1개
- severity별 분리: critical/warning 분리로 알림 노이즈 감소. 사용자가 이미 high/low 채널 2개를 생성해둠

## Action

**최종 선택: Option B (Discord `/slack` endpoint) + severity별 2채널 분리**

선택 근거:
- 기존 가이드 문서와 alertmanager.yml이 모두 `slack_configs` 기반으로 작성되어 있어 마이그레이션 비용 최소
- `api_url_file`로 ExternalSecret→Secret→파일 마운트 패턴 그대로 재사용
- alerting 용도에서는 plain text로 충분 (alert name, severity, description 전달 가능)
- 사용자가 high/low 채널을 이미 준비해둔 상태

구현 구조:
```
SSM (DISCORD_WEBHOOK_URL_HIGH/LOW)
  → ExternalSecret (alertmanager-discord-webhook)
  → Secret (url-high, url-low)
  → Alertmanager per-receiver api_url_file
  → Discord channels (high: critical, low: warning)
```

## Result

- **3개 레포 수정**: Goti-Terraform(SSM 4개 변경), Goti-k8s(ExternalSecret 전환), Goti-monitoring(Alertmanager config 전면 교체)
- **테스트 완료**: warning→low, critical→high 양쪽 Discord 수신 확인
- **후속 작업**:
  - monitoring-custom ArgoCD sync 확인 필요 (이전 operation 실패로 블로킹 중)
  - Harbor Probe/Rule + pod-health 규칙(ImagePullBackOff, CrashLoopBackOff, OOMKilled) 반영 확인
  - CI/CD Discord 알림은 별도 작업 (GitHub Actions → Discord webhook 직접 호출)
- **제약 사항**: Discord `/slack` endpoint는 embed 미지원. 향후 rich 알림 필요 시 alertmanager-discord 프록시 도입 검토

## Related Files

- `Goti-Terraform/terraform/prod/modules/config/main.tf` — SSM monitoring_secure_params Discord 전환
- `Goti-Terraform/terraform/prod/modules/config/variables.tf` — Discord webhook URL 변수
- `Goti-Terraform/terraform/prod/terraform.tfvars` — Discord webhook URL 값
- `Goti-k8s/infrastructure/prod/external-secrets/config/alertmanager-discord-externalsecret.yaml` — ExternalSecret 신규
- `Goti-monitoring/values-stacks/prod/kube-prometheus-stack-values.yaml` — Alertmanager config
- `Goti-monitoring/charts/goti-monitoring/templates/prometheusrule-infra.yaml` — pod-health 규칙 추가
- `Goti-monitoring/charts/goti-monitoring/templates/harbor-failover-probe.yaml` — prober URL 수정
- `Goti-monitoring/charts/goti-monitoring/values-prod.yaml` — grafanaAdminSecret 중복 해결
