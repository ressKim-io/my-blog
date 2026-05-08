---
title: "ArgoCD Sync 5번 실패하면 멈춘다: AppProject 권한과 Retry 소진"
excerpt: "AppProject에 Probe CRD 미등록으로 sync 실패 후 retry 5회 소진으로 블로킹된 상황과 빈 커밋 우회 해결법"
category: argocd
tags:
  - ArgoCD
  - Troubleshooting
  - AppProject
  - CRD
  - Probe
  - GitOps
  - go-ti
series:
  name: "argocd-troubleshooting"
  order: 5
date: '2026-03-31'
---

## 한 줄 요약

> AppProject에 Probe CRD가 등록되지 않아 sync 실패, retry 5회 소진 후 ArgoCD가 재시도를 포기했습니다. AppProject 수정만으로는 부족하고, 빈 커밋으로 리비전을 갱신해야 sync가 재개됩니다.

## 📊 Impact

- **영향 범위**: monitoring-custom Application (Harbor Probe + Pod Health 규칙)
- **증상 지속**: 30분+ OutOfSync / Missing / Failed
- **소요 시간**: 약 1시간
- **발생일**: 2026-03-31

---

## 🔥 1. Sync 실패: "resource is not permitted"

### 증상

EKS prod 환경에서 Harbor Probe와 Pod Health 알림 규칙(ImagePullBackOff, CrashLoopBackOff, OOMKilled)을 Goti-monitoring 차트에 추가하고 push했습니다. ArgoCD monitoring-custom Application이 sync에 실패했습니다.

```
Status: OutOfSync / Missing / Failed
Message: one or more synchronization tasks are not valid (retried 5 times).

syncResult.resources:
  kind: Probe
  message: "resource monitoring.coreos.com:Probe is not permitted in project monitoring"
  status: SyncFailed
```

에러 메시지가 명확합니다. `monitoring.coreos.com:Probe` 리소스가 `monitoring` project에서 허용되지 않는다고 합니다.

### 배경: 리소스 이전 히스토리

Harbor Probe가 갑자기 등장한 게 아닙니다. 이전에는 다른 경로로 배포되고 있었습니다.

| 시점 | Harbor Probe 위치 | 관리 Application | AppProject |
|------|-------------------|------------------|------------|
| 이전 | `Goti-k8s/infrastructure/prod/monitoring/harbor-failover/` | 별도 Application | infra (Probe 허용됨) |
| 현재 | `Goti-monitoring/charts/goti-monitoring/templates/` | monitoring-custom | monitoring (**Probe 미허용!**) |

팀원이 Goti-k8s의 harbor-failover 디렉토리를 삭제하고, Goti-monitoring 차트로 리소스를 이전했습니다. 그런데 이전 대상인 **monitoring AppProject에는 Probe CRD 권한이 없었습니다**.

리소스를 다른 Application으로 옮길 때, 원본 Application의 AppProject와 대상 Application의 AppProject가 **다른 권한을 가질 수 있다**는 점을 놓친 겁니다.

### AppProject의 권한 검증 흐름

ArgoCD는 sync를 실행하기 전에 AppProject의 `namespaceResourceWhitelist`를 확인합니다. 여기에 없는 리소스는 sync를 거부합니다.

![ArgoCD Sync 권한 검증 흐름과 Probe CRD 누락](/diagrams/argocd-probe-crd-appproject-retry-1.svg)

### 해결: AppProject에 Probe CRD 추가

`monitoring-project.yaml`의 whitelist에 누락된 CRD를 추가했습니다.

```yaml
# Before: monitoring-project.yaml
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
    kind: ScrapeConfig
  # Probe 없음!

# After: monitoring-project.yaml
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
    kind: Probe          # ← 추가!
  - group: monitoring.coreos.com
    kind: ScrapeConfig
  - group: monitoring.coreos.com
    kind: ThanosRuler    # ← 미래 대비 추가
```

`ThanosRuler`도 함께 추가했습니다. 나중에 Thanos를 도입하면 같은 문제가 반복될 수 있기 때문입니다.

### monitoring.coreos.com 전체 CRD 목록

kube-prometheus-stack이 설치하는 `monitoring.coreos.com` 그룹의 전체 CRD입니다. AppProject whitelist를 설정할 때 참고하세요.

| CRD | 역할 | 사용 빈도 |
|-----|------|-----------|
| `Prometheus` | Prometheus 인스턴스 정의 | 높음 |
| `PrometheusRule` | 알림/레코딩 규칙 | 높음 |
| `ServiceMonitor` | 서비스 메트릭 수집 대상 | 높음 |
| `PodMonitor` | Pod 메트릭 수집 대상 | 중간 |
| `Alertmanager` | Alertmanager 인스턴스 정의 | 중간 |
| `AlertmanagerConfig` | 알림 라우팅/수신자 설정 | 중간 |
| `Probe` | Blackbox exporter 프로브 대상 | 낮음 |
| `ScrapeConfig` | 커스텀 scrape 설정 | 낮음 |
| `ThanosRuler` | Thanos ruler 인스턴스 | 낮음 |

`Probe`와 `ScrapeConfig`는 사용 빈도가 낮아서 whitelist에서 빠지기 쉽습니다. 처음부터 전체 목록을 등록해두는 것이 안전합니다.

### 핵심 포인트

- 리소스를 다른 Application으로 이전할 때, **대상 AppProject의 권한이 원본과 다를 수 있다**
- `monitoring.coreos.com` 그룹은 CRD가 9개나 됩니다. 자주 쓰는 것만 등록하면 나중에 빠진 것 때문에 sync 실패가 발생합니다
- 처음에 AppProject를 설정할 때 **해당 API 그룹의 전체 CRD 목록**을 등록하는 것이 안전합니다

---

## 🔥 2. Retry 5회 소진: AppProject를 고쳐도 sync가 안 된다

AppProject에 Probe를 추가하고 `goti-projects` Application을 refresh해서 반영을 확인했습니다. 그런데 monitoring-custom Application은 여전히 sync를 시도하지 않았습니다.

### 증상

AppProject 수정 후 5분, 10분이 지나도 monitoring-custom의 상태는 동일했습니다:

```bash
$ kubectl get application monitoring-custom -n argocd \
    -o jsonpath='{.status.operationState.message}'
"one or more synchronization tasks are not valid (retried 5 times)."
```

"retried 5 times" — ArgoCD가 이미 5번 시도하고 포기한 상태입니다. AppProject를 고쳐도 **새로운 sync를 시작하지 않습니다**.

### ArgoCD의 Retry 소진 메커니즘

ArgoCD의 auto sync에는 retry 메커니즘이 있습니다. 이 동작을 이해하면 왜 AppProject 수정만으로 부족한지 알 수 있습니다.

![ArgoCD Auto Sync Retry 5회 소진과 새 리비전 재시작](/diagrams/argocd-probe-crd-appproject-retry-2.svg)

핵심은 이겁니다:

1. ArgoCD auto sync는 **동일 리비전**에 대해 최대 5회까지 retry합니다 (exponential backoff)
2. 5회 모두 실패하면 해당 리비전을 **"실패 처리 완료"**로 마킹합니다
3. 이후 selfHeal이 트리거되어도 **동일 리비전**이면 새 sync operation을 시작하지 않습니다
4. **새 리비전**이 들어와야 retry 카운트가 초기화되고 새 sync가 시작됩니다

AppProject를 수정한 것은 **Goti-k8s** 레포의 변경입니다. monitoring-custom Application이 바라보는 **Goti-monitoring** 레포의 리비전은 바뀌지 않았습니다. 그래서 ArgoCD가 "이 리비전은 이미 5번 실패했으니 다시 시도하지 않겠다"고 판단한 것입니다.

### 해결: 빈 커밋으로 리비전 갱신

Goti-monitoring 레포에 빈 커밋을 push해서 새 리비전을 만들었습니다.

```bash
# Goti-monitoring 레포에서
$ git commit --allow-empty -m "chore: trigger ArgoCD sync retry"
$ git push origin main
```

새 리비전이 감지되면서 ArgoCD가 retry 카운트를 초기화하고 sync를 다시 시작했습니다. 이번에는 AppProject에 Probe 권한이 있으니 성공합니다.

### Before / After

```bash
# Before: retry 소진 상태
$ kubectl get application monitoring-custom -n argocd \
    -o custom-columns='SYNC:.status.sync.status,HEALTH:.status.health.status,PHASE:.status.operationState.phase'
SYNC        HEALTH    PHASE
OutOfSync   Missing   Failed

# After: 빈 커밋으로 새 리비전 생성 후
$ kubectl get application monitoring-custom -n argocd \
    -o custom-columns='SYNC:.status.sync.status,HEALTH:.status.health.status,PHASE:.status.operationState.phase'
SYNC     HEALTH    PHASE
Synced   Healthy   Succeeded
```

### 다른 해결 방법은 없었나?

"빈 커밋"이 깔끔하지 않다고 느낄 수 있습니다. 다른 방법도 있습니다:

| 방법 | 동작 | 권장 여부 |
|------|------|-----------|
| 빈 커밋 push | 새 리비전 → retry 초기화 | ✅ 가장 안전 |
| Hard refresh | 캐시 새로고침만, retry 카운트 미초기화 | ❌ 효과 없음 |
| Force sync | 강제 sync 시도 | ⚠️ SSA 환경에서는 [위험](/blog/argocd-ssa-sync-pitfalls) |
| Application 삭제 후 재생성 | 전체 초기화 | ⚠️ 과도한 조치 |
| `kubectl patch`로 operationState 초기화 | retry 카운트 우회 | ⚠️ 내부 상태 직접 수정 |

빈 커밋이 가장 안전한 이유는 **ArgoCD의 정상적인 동작 흐름**을 따르기 때문입니다. 새 리비전 → 새 sync operation이라는 설계 의도 그대로입니다.

### 핵심 포인트

- ArgoCD auto sync는 **동일 리비전에 대해 5번 실패하면 포기**합니다
- AppProject, 인프라 설정 등 **다른 레포의 변경**으로는 retry가 초기화되지 않습니다
- 빈 커밋(`git commit --allow-empty`)으로 새 리비전을 만들면 자연스럽게 sync가 재개됩니다

---

## 📚 종합 정리

| 문제 | 원인 | 해결 | 예방 |
|------|------|------|------|
| Probe CRD sync 거부 | AppProject whitelist에 Probe 미등록 | whitelist에 Probe + ThanosRuler 추가 | API 그룹의 전체 CRD를 등록 |
| Retry 소진으로 sync 중단 | 동일 리비전 5회 실패 → 포기 | 빈 커밋으로 새 리비전 생성 | 인프라 변경 후 관련 레포에 빈 커밋 push |

### 검증 결과

AppProject 수정 + 빈 커밋 후 배포된 리소스들:

| 리소스 | 유형 | 상태 |
|--------|------|------|
| harbor-health | Probe | ✅ 배포 완료 |
| harbor-failover | PrometheusRule | ✅ HarborDown / HarborRecovered |
| pod-health | PrometheusRule | ✅ PodImagePullBackOff / PodCrashLoopBackOff / PodOOMKilled |

---

## 🤔 스스로에게 던지는 질문

1. **AppProject whitelist를 `*`(전체 허용)로 설정하면 안 되나?** — 보안 관점에서 권장하지 않습니다. AppProject의 whitelist는 "이 팀이 배포할 수 있는 리소스 범위"를 제한하는 RBAC 역할을 합니다. 전체 허용하면 실수로 ClusterRole 같은 위험한 리소스를 배포할 수 있습니다. CRD 목록을 관리하는 수고가 있지만, 그만한 가치가 있습니다.

2. **retry 횟수를 늘리면 이런 문제가 줄어들까?** — ArgoCD의 `syncPolicy.retry.limit`을 늘릴 수 있지만, 근본적으로 "잘못된 설정으로 100번 시도해봤자 100번 실패한다"는 점은 같습니다. retry 횟수보다 중요한 건 **실패 원인을 빨리 찾는 것**입니다.

3. **리소스 이전 시 AppProject 차이를 자동으로 검증할 수 있는가?** — CI 파이프라인에서 Helm template 렌더링 결과의 GVK(Group/Version/Kind) 목록을 추출하고, 대상 AppProject의 whitelist와 비교하는 검증 스크립트를 만들 수 있습니다. 아직 구현하지 않았지만, 같은 실수를 방지하려면 고려해볼 만합니다.

---

## 🔗 참고

- [ArgoCD Projects](https://argo-cd.readthedocs.io/en/stable/user-guide/projects/)
- [ArgoCD Sync Options - Retry](https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/)
- [kube-prometheus-stack CRDs](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack/charts/crds)
