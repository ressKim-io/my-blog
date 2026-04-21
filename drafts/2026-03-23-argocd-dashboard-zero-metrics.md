---
date: 2026-03-23
category: troubleshoot
project: Goti-k8s, Goti-monitoring
tags: [argocd, grafana, servicemonitor, metrics, bootstrap, application-path]
---

# ArgoCD 대시보드 모든 수치가 0으로 표시 — ServiceMonitor/metrics Service 미생성

## Context

Kind dev 환경. ArgoCD 대시보드(`goti-infra-argocd`)에서 전체 Applications, Synced, OutOfSync, Degraded 등 모든 stat 패널이 0으로 표시. `argocd_app_info` 메트릭이 Mimir에 없음.

## Issue

```
# ArgoCD metrics Service 없음
kubectl get svc -n argocd | grep metrics → (빈 결과)

# ServiceMonitor 없음
kubectl get servicemonitor -n argocd → (빈 결과)

# ArgoCD app sync 상태
argocd    Unknown    Healthy
```

`values-dev.yaml`에 metrics/ServiceMonitor 설정이 있지만 실제 클러스터에 반영되지 않음.

## Action

### 1. 가설: values-dev.yaml 설정 오류 → 결과: 설정은 정상

```yaml
# values-dev.yaml — 4개 컴포넌트 모두 metrics + ServiceMonitor 활성화
controller/server/repoServer/applicationSet:
  metrics:
    enabled: true
    serviceMonitor:
      enabled: true
      additionalLabels:
        release: kube-prometheus-stack-dev
```

### 2. 가설: ArgoCD Application source path 불일치 → 결과: 확인 (근본 원인)

```bash
# Git 파일 (argocd-install.yaml)
path: "infrastructure/dev/argocd"

# 라이브 클러스터 Application
kubectl get app argocd -n argocd -o jsonpath='{.spec.sources[0].path}'
→ "infrastructure/argocd"  # /dev/ 빠져있음!
```

ArgoCD Application이 존재하지 않는 경로 `infrastructure/argocd`를 바라보고 있어서 sync status가 "Unknown"이고, `values-dev.yaml`의 metrics 설정이 반영되지 않음.

### 3. 해결: bootstrap 매니페스트 재적용

```bash
kubectl apply -f clusters/dev/bootstrap/argocd-install.yaml
```

적용 후 ArgoCD가 올바른 경로를 바라보면서 자동 sync → ServiceMonitor 4개 + metrics Service 4개 생성.

## Result

```
kubectl get servicemonitor -n argocd
→ argocd-application-controller, argocd-applicationset-controller, argocd-repo-server, argocd-server

kubectl get svc -n argocd | grep metrics
→ 4개 metrics Service 생성 확인
```

- ServiceMonitor 생성 → Alloy scrape → Mimir 저장 → 대시보드 표시
- **미해결**: ingester OOMKilled로 Mimir가 죽어있어서 메트릭 수집은 ingester 정상화 후 확인 필요

### 재발 방지

- ArgoCD bootstrap Application은 초기 `kubectl apply` 이후 변경 시 반드시 재적용 필요 (ArgoCD가 자기 자신의 Application spec을 관리하지 않음)
- bootstrap 매니페스트 변경 시 체크리스트에 `kubectl apply` 추가

## Related Files

- `Goti-k8s/clusters/dev/bootstrap/argocd-install.yaml` — source path 수정
- `Goti-k8s/infrastructure/dev/argocd/values-dev.yaml` — metrics/ServiceMonitor 설정 (기존 정상)
