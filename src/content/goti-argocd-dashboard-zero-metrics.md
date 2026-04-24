---
title: "ArgoCD 대시보드 전체 수치 0 — bootstrap Application source path 불일치"
excerpt: "ArgoCD 대시보드의 모든 stat 패널이 0으로 표시된 원인은 values-dev.yaml 설정 오류가 아니라, bootstrap Application이 존재하지 않는 Git 경로를 바라보고 있어 sync 자체가 되지 않았기 때문이었습니다."
category: argocd
tags:
  - go-ti
  - ArgoCD
  - Prometheus
  - Dashboard
  - troubleshooting
series:
  name: goti-argocd
  order: 1
date: "2026-03-23"
---

## 한 줄 요약

> ArgoCD Application이 존재하지 않는 Git 경로를 참조해 sync 상태가 Unknown이었고, values-dev.yaml의 metrics/ServiceMonitor 설정이 클러스터에 반영되지 않았습니다. bootstrap 매니페스트를 재적용해 올바른 경로로 수정하자 ServiceMonitor 4개와 metrics Service 4개가 자동 생성됐습니다

---

## 🔥 문제: 대시보드 모든 수치가 0

### 기대 동작

Kind dev 환경에서 ArgoCD가 `goti-infra-argocd` 대시보드를 통해 Applications, Synced, OutOfSync, Degraded 등 클러스터 상태를 보여줘야 합니다.

ArgoCD는 컴포넌트별로 메트릭 엔드포인트를 노출하고, Prometheus(또는 Alloy)가 ServiceMonitor를 통해 이를 수집해 Mimir에 저장합니다. 대시보드는 `argocd_app_info` 메트릭을 조회해 수치를 표시합니다.

### 발견한 문제

`goti-infra-argocd` 대시보드의 모든 stat 패널이 0으로 표시됐습니다.

Mimir에서 `argocd_app_info` 메트릭을 직접 조회해도 아무 데이터가 없었습니다.

```bash
# ArgoCD metrics Service 없음
$ kubectl get svc -n argocd | grep metrics
(빈 결과)

# ServiceMonitor 없음
$ kubectl get servicemonitor -n argocd
(빈 결과)

# ArgoCD Application sync 상태
$ argocd app get argocd
Health:  Healthy
Sync:    Unknown    # ← 비정상
```

ServiceMonitor와 metrics Service가 존재하지 않으니 Prometheus가 수집할 대상 자체가 없었습니다. `values-dev.yaml`에는 metrics/ServiceMonitor 설정이 있는데도 클러스터에 반영되지 않은 상황이었습니다.

---

## 🤔 원인: bootstrap Application의 source path 불일치

### 가설 1 — values-dev.yaml 설정 오류 (기각)

첫 번째로 Helm values 설정을 확인했습니다.

```yaml
# values-dev.yaml — 4개 컴포넌트 모두 동일하게 설정
controller:
  metrics:
    enabled: true
    serviceMonitor:
      enabled: true
      additionalLabels:
        release: kube-prometheus-stack-dev
server:
  metrics:
    enabled: true
    serviceMonitor:
      enabled: true
      additionalLabels:
        release: kube-prometheus-stack-dev
repoServer:
  metrics:
    enabled: true
    serviceMonitor:
      enabled: true
      additionalLabels:
        release: kube-prometheus-stack-dev
applicationSet:
  metrics:
    enabled: true
    serviceMonitor:
      enabled: true
      additionalLabels:
        release: kube-prometheus-stack-dev
```

controller, server, repoServer, applicationSet 4개 컴포넌트 모두 정상적으로 설정되어 있었습니다. 설정 오류가 아니었습니다.

### 가설 2 — Application source path 불일치 (확인, 근본 원인)

설정은 정상인데 왜 반영이 안 될까를 더 파고들었습니다. ArgoCD Application이 실제로 어떤 경로를 바라보는지 확인했습니다.

```bash
# Git 레포의 ArgoCD Application 매니페스트
$ cat clusters/dev/bootstrap/argocd-install.yaml | grep path
path: "infrastructure/dev/argocd"

# 클러스터에 실제로 배포된 Application의 source path
$ kubectl get app argocd -n argocd \
    -o jsonpath='{.spec.sources[0].path}'
infrastructure/argocd    # /dev/ 가 빠져있음
```

Git에는 `infrastructure/dev/argocd`로 명시되어 있는데, 클러스터의 Application은 `infrastructure/argocd`라는 존재하지 않는 경로를 바라보고 있었습니다.

이 경로에는 실제 파일이 없으므로 ArgoCD가 sync할 대상을 찾지 못해 `Unknown` 상태가 된 것입니다. sync가 되지 않으니 `values-dev.yaml`의 metrics/ServiceMonitor 설정도 클러스터에 반영될 수 없었습니다.

### 왜 이런 불일치가 생겼는가

ArgoCD bootstrap Application은 초기 `kubectl apply`로 생성합니다. 이후 Git에서 매니페스트를 수정해도 ArgoCD가 자기 자신의 Application spec을 관리하지 않기 때문에, 변경이 자동으로 클러스터에 반영되지 않습니다.

Git에서 경로를 `infrastructure/dev/argocd`로 수정했지만, 클러스터의 Application 오브젝트는 이전 경로(`infrastructure/argocd`)를 그대로 유지하고 있었습니다.

---

## ✅ 해결: bootstrap 매니페스트 재적용

수정된 `argocd-install.yaml`을 직접 kubectl로 재적용했습니다.

```bash
$ kubectl apply -f clusters/dev/bootstrap/argocd-install.yaml
```

재적용 후 ArgoCD Application이 올바른 경로(`infrastructure/dev/argocd`)를 참조하게 됐습니다. 자동 sync가 동작하면서 설정이 반영됐습니다.

```bash
# ServiceMonitor 4개 생성 확인
$ kubectl get servicemonitor -n argocd
NAME                                    AGE
argocd-application-controller           12s
argocd-applicationset-controller        12s
argocd-repo-server                      12s
argocd-server                           12s

# metrics Service 4개 생성 확인
$ kubectl get svc -n argocd | grep metrics
argocd-application-controller-metrics   ClusterIP   ...
argocd-applicationset-controller-metrics ClusterIP   ...
argocd-repo-server-metrics              ClusterIP   ...
argocd-server-metrics                   ClusterIP   ...
```

ServiceMonitor가 생성되면서 Alloy가 scrape를 시작하고, 수집된 메트릭이 Mimir에 저장되어 대시보드에 표시되는 파이프라인이 복구됐습니다.

### 미해결 사항

메트릭 파이프라인은 복구됐지만, 당시 Mimir ingester가 OOMKilled 상태여서 실제 메트릭 수집은 ingester 정상화 이후에 확인이 필요했습니다. ServiceMonitor와 metrics Service 생성까지는 이번 트러블슈팅에서 해결됐습니다.

---

## 📚 배운 점

**bootstrap Application은 ArgoCD가 자기 자신을 관리하지 않는다**: 일반 ArgoCD Application은 Git에서 변경하면 자동 sync로 클러스터에 반영됩니다. 그런데 ArgoCD 자체를 정의하는 bootstrap Application은 예외입니다. Git에서 경로나 레포를 변경해도 클러스터 오브젝트에는 반영되지 않습니다. 반드시 `kubectl apply`로 직접 재적용해야 합니다

**sync Unknown 상태가 "설정 오류"를 가릴 수 있다**: 대시보드에 값이 없으면 values.yaml을 먼저 확인하게 됩니다. 그러나 이번처럼 sync 자체가 되지 않는 상태라면 values.yaml이 아무리 올바르게 설정되어 있어도 의미가 없습니다. ArgoCD Application의 sync 상태와 source path를 먼저 확인하는 것이 순서상 맞습니다

**bootstrap 변경 시 kubectl apply를 체크리스트에 포함해야 합니다**: `clusters/dev/bootstrap/` 하위 매니페스트를 수정할 때는 자동화에 의존할 수 없습니다. 팀 내 배포 체크리스트에 "bootstrap 변경 시 `kubectl apply -f clusters/dev/bootstrap/` 직접 실행" 항목을 명시적으로 추가해야 합니다

**ServiceMonitor 부재는 메트릭 수집 파이프라인 전체를 막는다**: `kubectl get servicemonitor -n <namespace>`를 통해 수집 대상이 실제로 존재하는지 먼저 확인하는 것이 대시보드 0 문제의 첫 번째 진단 단계입니다. Prometheus/Alloy 설정보다 ServiceMonitor 존재 여부를 먼저 봐야 합니다
