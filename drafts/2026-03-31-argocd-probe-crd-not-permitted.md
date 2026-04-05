---
date: 2026-03-31
category: troubleshoot
project: goti-k8s, goti-monitoring
tags: [argocd, appproject, probe, crd, whitelist, retry-exhaustion]
---

# monitoring-custom ArgoCD sync 실패 — Probe CRD 미허용 + retry 소진 블로킹

## Context

EKS prod 환경에서 Harbor Probe + Pod Health 알림 규칙(ImagePullBackOff, CrashLoopBackOff, OOMKilled)을 Goti-monitoring 차트에 추가 후 push. ArgoCD monitoring-custom Application이 sync 실패하여 30분 이상 OutOfSync/Missing/Failed 상태 지속.

## Issue

```
Status: OutOfSync / Missing / Failed
Message: one or more synchronization tasks are not valid (retried 5 times).

syncResult.resources:
  kind: Probe
  message: "resource monitoring.coreos.com:Probe is not permitted in project monitoring"
  status: SyncFailed
```

monitoring-custom이 harbor-health Probe를 배포하려 했으나 ArgoCD AppProject `monitoring`의 `namespaceResourceWhitelist`에 `monitoring.coreos.com/Probe`가 없어서 거부됨.

추가로, 5번 retry 소진 후 ArgoCD가 동일 리비전에 대해 더 이상 sync를 시도하지 않는 블로킹 상태 발생.

## Action

### 진단 과정

1. 가설: grafana-admin-secret 이중 소유 충돌 (이전 에러) → `status.conditions` 확인 → 해당 메시지 없음. 이전 fix(`grafanaAdminSecret.enabled: false`)로 해결 완료
2. 가설: sync operation이 stuck → `status.operationState.syncResult.resources` 확인 → **Probe CRD가 project에서 not permitted** 발견
3. AppProject `monitoring`의 `namespaceResourceWhitelist` 확인 → `monitoring.coreos.com` 그룹에 Prometheus, PrometheusRule, ServiceMonitor, PodMonitor, Alertmanager, AlertmanagerConfig, ScrapeConfig은 있으나 **Probe 누락**

### 근본 원인 (2가지)

**원인 1**: AppProject에 Probe CRD 미등록. Harbor Probe가 이전에는 Goti-k8s의 `infrastructure/prod/monitoring/harbor-failover/`에서 별도 Application으로 배포되었으나, 팀원이 해당 디렉토리를 삭제. Goti-monitoring 차트로 이전하면서 monitoring AppProject에 Probe 권한이 필요해졌으나 추가하지 않음.

**원인 2**: ArgoCD auto sync의 retry 소진 블로킹. 동일 리비전에서 5번 retry 실패 → ArgoCD가 해당 리비전을 "실패 처리 완료"로 마킹 → AppProject 수정 후에도 Goti-monitoring 리비전이 바뀌지 않아 새 sync operation 미시작.

### 적용한 수정

1. **Goti-k8s** `gitops/prod/projects/monitoring-project.yaml`에 `monitoring.coreos.com/Probe` 추가
2. `goti-projects` Application refresh → AppProject 반영 확인
3. **Goti-monitoring**에 빈 커밋 push (`git commit --allow-empty -m "chore: trigger ArgoCD sync retry"`) → 새 리비전 생성으로 auto sync 재시도 트리거

## Result

- monitoring-custom: **Synced / Healthy / Succeeded**
- Harbor Probe (`harbor-health`): 배포 확인
- Harbor Rule (`harbor-failover`): HarborDown/HarborRecovered 배포 확인
- Pod Health 규칙: PodImagePullBackOff, PodCrashLoopBackOff, PodOOMKilled 배포 확인

### 재발 방지

1. **새 CRD를 차트에 추가할 때 AppProject whitelist 확인 필수** — monitoring.coreos.com 그룹의 전체 CRD 목록: Prometheus, PrometheusRule, ServiceMonitor, PodMonitor, Alertmanager, AlertmanagerConfig, Probe, ScrapeConfig, ThanosRuler
2. **ArgoCD retry 소진 블로킹 해결법**: 빈 커밋으로 새 리비전을 만들면 auto sync가 새 operation 시작. hard refresh나 force sync 불필요
3. **리소스를 다른 Application으로 이전할 때** AppProject 권한 차이를 반드시 확인

## Related Files

- `Goti-k8s/gitops/prod/projects/monitoring-project.yaml` — Probe CRD whitelist 추가
- `Goti-monitoring/charts/goti-monitoring/templates/harbor-failover-probe.yaml` — Harbor Probe + Rule
- `Goti-monitoring/charts/goti-monitoring/templates/prometheusrule-infra.yaml` — pod-health 규칙 추가
