---
date: 2026-03-31
category: troubleshoot
project: goti-monitoring, goti-k8s
tags: [argocd, externalsecret, alertmanager, secret-mount, sync-failure]
---

# monitoring-custom ArgoCD sync 실패 + Alertmanager Secret 마운트 실패

## Context

EKS prod 환경에서 Discord alerting 구축 중 2건의 연쇄 장애 발생.
Goti-monitoring(Alertmanager config) → Goti-k8s(ExternalSecret) → Terraform(SSM) 3개 레포를 동시에 수정하는 과정에서, 배포 순서 의존성과 리소스 충돌 문제가 드러남.

## Issue

### 장애 1: Alertmanager Pod FailedMount (Secret 미존재)

```
Events:
  Warning  FailedMount  39s (x11 over 6m51s)  kubelet
    MountVolume.SetUp failed for volume "secret-alertmanager-discord-webhook" :
    secret "alertmanager-discord-webhook" not found
```

Alertmanager Pod가 `3/3 Running`이 아닌 `Pending` 상태. `alertmanagerSpec.secrets: [alertmanager-discord-webhook]`로 마운트를 요구하지만 Secret이 아직 생성되지 않음.

재현 조건: Alertmanager config(Secret 참조) 배포가 ExternalSecret(Secret 생성) 배포보다 먼저 완료된 경우.

### 장애 2: ExternalSecret SecretSyncedError

```
Events:
  Warning  UpdateFailed  67s (x9 over 5m22s)  external-secrets
    error processing spec.data[0] (key: /prod/monitoring/DISCORD_WEBHOOK_URL_HIGH),
    err: Secret does not exist
```

ExternalSecret이 SSM에서 파라미터를 읽지 못함. Terraform apply 직후임에도 ESO가 캐시된 상태를 보고 있었음.

### 장애 3: monitoring-custom ArgoCD sync 실패

```
Status: OutOfSync / Missing / Failed
Message: one or more synchronization tasks are not valid (retried 5 times).
Condition: ExternalSecret/grafana-admin-secret is part of applications
  argocd/monitoring-custom and external-secrets-config
```

`grafana-admin-secret` ExternalSecret이 monitoring-custom 차트와 external-secrets-config 양쪽에서 동시 관리되어 ArgoCD가 소유권 충돌로 sync 거부.

## Action

### 장애 1 진단 및 해결

1. 가설: Secret이 아직 생성 안 됨 → `kubectl get secret alertmanager-discord-webhook -n monitoring` 확인 → **맞음, 없음**
2. 근본 원인: **배포 순서 역전** — Goti-monitoring(Alertmanager config) push가 Goti-k8s(ExternalSecret) + Terraform(SSM) 배포보다 먼저 ArgoCD sync됨
3. 해결: Secret 생성 후 `kubectl delete pod alertmanager-...` → StatefulSet이 새 Pod 생성 → 마운트 성공, 3/3 Running

### 장애 2 진단 및 해결

1. 가설: IAM 권한 부족 → ESO role policy 확인 → `arn:aws:ssm:...parameter/prod/*` 와일드카드로 **권한 문제 아님**
2. 가설: ESO 캐시 → `kubectl annotate externalsecret ... force-sync=$(date +%s)` → **SecretSynced 성공**
3. 근본 원인: **ESO 캐시** — Terraform apply 직후 SSM 파라미터가 생성됐지만, ESO가 이전 polling 결과(파라미터 미존재)를 캐시하고 있었음. refreshInterval(1h) 내 수동 트리거 필요

### 장애 3 진단 및 해결

1. `kubectl get application monitoring-custom -n argocd` → conditions 확인 → **grafana-admin-secret 이중 소유**
2. `kubectl get externalsecret grafana-admin-secret -n monitoring -o jsonpath='{.metadata.annotations}'` → tracking-id가 `external-secrets-config` 소유
3. 근본 원인: **리소스 이중 관리** — Goti-monitoring 차트의 `grafana-admin-externalsecret.yaml` 템플릿과 Goti-k8s의 external-secrets-config Application이 동일 리소스를 배포
4. 해결: `values-prod.yaml`에서 `grafanaAdminSecret.enabled: false` 설정 → monitoring-custom 차트에서 제외, external-secrets-config에서만 관리

## Result

### 장애 1
- Pod 재시작 후 3/3 Running 확인
- amtool로 테스트 알림 발송 → Discord 양쪽 채널 수신 확인
- **재발 방지**: 배포 순서 문서화 — Terraform(SSM) → Goti-k8s(ExternalSecret) → Goti-monitoring(Alertmanager) 순서 필수

### 장애 2
- force-sync annotation으로 즉시 해결
- **재발 방지**: SSM 파라미터 신규 생성 후 ExternalSecret에 `force-sync` annotation 추가하는 것을 운영 절차에 포함

### 장애 3
- `grafanaAdminSecret.enabled: false` push 완료
- **미확인**: monitoring-custom sync 성공 여부 — 이전 operation 5번 retry 소진으로 블로킹 중. ArgoCD polling 주기(3분) 후 자동 재시도 또는 UI에서 일반 Refresh 필요
- **재발 방지**: ExternalSecret은 Goti-k8s(external-secrets-config)에서 통합 관리. Goti-monitoring 차트에 ExternalSecret 템플릿 추가 시 중복 여부 반드시 확인

## Related Files

- `Goti-monitoring/values-stacks/prod/kube-prometheus-stack-values.yaml` — Alertmanager config (Secret 마운트 참조)
- `Goti-monitoring/charts/goti-monitoring/values-prod.yaml` — grafanaAdminSecret.enabled: false
- `Goti-k8s/infrastructure/prod/external-secrets/config/alertmanager-discord-externalsecret.yaml` — Discord ExternalSecret
- `Goti-Terraform/terraform/prod/modules/config/main.tf` — SSM 파라미터 정의
