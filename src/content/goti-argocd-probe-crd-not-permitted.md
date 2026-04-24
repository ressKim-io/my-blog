---
title: "ArgoCD Sync 실패 — Probe CRD 미등록 + retry 소진 블로킹"
excerpt: "AppProject whitelist에 Probe CRD가 없어 sync가 거부됐고, 5회 retry 소진 후 ArgoCD가 동일 리비전을 더 이상 시도하지 않는 블로킹 상태가 함께 발생했습니다."
category: argocd
tags:
  - go-ti
  - ArgoCD
  - CRD
  - Permission
  - troubleshooting
series:
  name: goti-argocd
  order: 5
date: "2026-03-31"
---

## 한 줄 요약

> AppProject `monitoring`의 `namespaceResourceWhitelist`에 `monitoring.coreos.com/Probe`가 없어 sync가 거부됐습니다. retry 5회 소진 후 ArgoCD가 해당 리비전을 "실패 처리 완료"로 마킹해, AppProject 수정 후에도 sync가 재시작되지 않는 이중 블로킹 상태였습니다

---

## 🔥 문제: OutOfSync / Missing / Failed 30분 이상 지속

### 발생 상황

EKS prod 환경에서 Harbor Probe + Pod Health 알림 규칙(ImagePullBackOff, CrashLoopBackOff, OOMKilled)을 Goti-monitoring 차트에 추가한 뒤 push했습니다. ArgoCD `monitoring-custom` Application이 sync에 실패해 30분 이상 OutOfSync / Missing / Failed 상태가 지속됐습니다.

### 에러 메시지

```text
Status: OutOfSync / Missing / Failed
Message: one or more synchronization tasks are not valid (retried 5 times).

syncResult.resources:
  kind: Probe
  message: "resource monitoring.coreos.com:Probe is not permitted in project monitoring"
  status: SyncFailed
```

`monitoring-custom`이 `harbor-health` Probe를 배포하려 했으나, ArgoCD AppProject `monitoring`의 `namespaceResourceWhitelist`에 `monitoring.coreos.com/Probe`가 없어 거부됐습니다.

문제는 여기서 끝나지 않았습니다. 5번 retry를 소진한 뒤 ArgoCD가 동일 리비전에 대해 더 이상 sync를 시도하지 않는 블로킹 상태가 추가로 발생했습니다. AppProject를 수정해도 Goti-monitoring 리비전이 바뀌지 않으면 새 sync operation이 시작되지 않는 상황이었습니다.

---

## 🤔 원인: 두 가지 독립적인 원인

### 원인 1: AppProject whitelist에 Probe CRD 미등록

진단 과정에서 AppProject `monitoring`의 `namespaceResourceWhitelist`를 확인했습니다. `monitoring.coreos.com` 그룹에 등록된 리소스 목록은 다음과 같았습니다.

- Prometheus
- PrometheusRule
- ServiceMonitor
- PodMonitor
- Alertmanager
- AlertmanagerConfig
- ScrapeConfig

목록에서 **Probe가 누락**되어 있었습니다.

왜 Probe 권한이 없었는지 맥락이 있었습니다. Harbor Probe는 이전에 Goti-k8s의 `infrastructure/prod/monitoring/harbor-failover/`에서 별도 Application으로 배포되고 있었습니다. 어느 시점에 해당 디렉토리가 삭제되었고, Harbor Probe 배포를 Goti-monitoring 차트로 이전하게 됐습니다. 이전하면서 monitoring AppProject에 Probe 권한이 추가로 필요해졌으나 whitelist에 반영하지 않은 것입니다.

### 원인 2: ArgoCD auto sync retry 소진 블로킹

ArgoCD auto sync는 동일 리비전에서 실패가 반복되면 retry 횟수 상한(기본 5회)에 도달한 뒤 해당 리비전을 "실패 처리 완료"로 마킹합니다. 이후 새 커밋(리비전 변경)이 없으면 auto sync가 새 operation을 시작하지 않습니다.

결과적으로 AppProject에 Probe를 추가해도, Goti-monitoring 리비전이 바뀌지 않았기 때문에 ArgoCD는 sync를 재시도하지 않는 상태였습니다.

---

## ✅ 해결: AppProject 수정 + 빈 커밋으로 리비전 생성

### 1단계: AppProject에 Probe CRD 추가

`Goti-k8s/gitops/prod/projects/monitoring-project.yaml`의 `namespaceResourceWhitelist`에 `monitoring.coreos.com/Probe`를 추가했습니다.

```yaml
# monitoring-project.yaml
spec:
  namespaceResourceWhitelist:
    - group: monitoring.coreos.com
      kind: Prometheus
    - group: monitoring.coreos.com
      kind: PrometheusRule
    - group: monitoring.coreos.com
      kind: ServiceMonitor
    - group: monitoring.coreos.com
      kind: PodMonitor
    - group: monitoring.coreos.com
      kind: Alertmanager
    - group: monitoring.coreos.com
      kind: AlertmanagerConfig
    - group: monitoring.coreos.com
      kind: Probe          # ← 추가
    - group: monitoring.coreos.com
      kind: ScrapeConfig
    - group: monitoring.coreos.com
      kind: ThanosRuler
```

### 2단계: AppProject 반영 확인

`goti-projects` Application을 refresh해 AppProject 변경이 반영됐는지 확인했습니다.

### 3단계: 빈 커밋으로 리비전 생성

retry 소진 블로킹을 해제하기 위해 Goti-monitoring에 빈 커밋을 push했습니다.

```bash
$ git commit --allow-empty -m "chore: trigger ArgoCD sync retry"
$ git push
```

빈 커밋으로 새 리비전이 생성되면 ArgoCD auto sync가 새 operation을 시작합니다. hard refresh나 force sync는 필요하지 않았습니다.

### 결과

| 리소스 | 결과 |
|--------|------|
| monitoring-custom | Synced / Healthy / Succeeded |
| Harbor Probe (`harbor-health`) | 배포 확인 |
| Harbor Rule (`harbor-failover`) | HarborDown / HarborRecovered 배포 확인 |
| Pod Health 규칙 | PodImagePullBackOff / PodCrashLoopBackOff / PodOOMKilled 배포 확인 |

---

## 📚 배운 점

**새 CRD를 차트에 추가할 때 AppProject whitelist를 반드시 확인해야 합니다**: 차트에 새 CRD 리소스를 추가하면 해당 CRD의 group과 kind가 AppProject에 허용되어 있어야 합니다. 특히 `monitoring.coreos.com` 그룹처럼 CRD 종류가 많은 경우, 전체 목록을 한 번에 등록하는 것이 안전합니다. 현재 등록이 필요한 전체 목록은 Prometheus, PrometheusRule, ServiceMonitor, PodMonitor, Alertmanager, AlertmanagerConfig, Probe, ScrapeConfig, ThanosRuler입니다

**ArgoCD retry 소진 블로킹은 빈 커밋으로 해제합니다**: 동일 리비전에서 retry가 소진되면 AppProject를 수정해도 sync가 재시작되지 않습니다. 빈 커밋(`git commit --allow-empty`)으로 새 리비전을 만들면 auto sync가 새 operation을 시작합니다. hard refresh나 force sync까지 할 필요는 없습니다

**리소스를 다른 Application으로 이전할 때 AppProject 권한 차이를 반드시 확인해야 합니다**: 기존 Application이 소속된 AppProject와 이전 대상 AppProject가 허용하는 리소스 목록이 다를 수 있습니다. 이전 전에 "이 리소스가 새 AppProject에서도 허용되는가?"를 먼저 확인해야 합니다

**에러 메시지에 원인이 명확히 있을 때 이전 에러의 잔상을 먼저 의심하지 않아야 합니다**: 첫 번째 가설이 이전 세션의 `grafana-admin-secret` 이중 소유 충돌이었습니다. `status.conditions`를 확인하니 해당 메시지는 없었고, 실제 원인은 `syncResult.resources`에 명확히 기록되어 있었습니다. 에러 메시지를 먼저 끝까지 읽는 것이 진단의 출발점입니다
