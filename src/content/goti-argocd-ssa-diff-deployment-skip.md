---
title: "SSA sync 시 Deployment가 skip되는 영구 OutOfSync — ServerSideDiff=true로 해결"
excerpt: "ArgoCD SSA 환경에서 Deployment가 OutOfSync로 표시되지만 sync 결과에는 아예 포함되지 않는 현상을 겪었습니다. client-side diff와 server-side apply의 불일치가 원인이었고, ServerSideDiff=true로 전체 ApplicationSet에 영구 적용해 해결했습니다."
category: argocd
tags:
  - go-ti
  - ArgoCD
  - SSA
  - Deployment
  - troubleshooting
series:
  name: goti-argocd
  order: 2
date: "2026-03-29"
---

## 한 줄 요약

> ArgoCD가 Deployment를 OutOfSync로 감지하지만, sync 실행 시 Deployment가 syncResult에 아예 포함되지 않았습니다. SSA(ServerSideApply)와 client-side diff의 불일치가 원인이었고, `ServerSideDiff=true` annotation을 전체 ApplicationSet에 추가해 영구 해결했습니다

---

## 🔥 문제: Deployment가 OutOfSync인데 sync 결과에서 사라짐

### 상황

Kind K8s dev 환경, ArgoCD v3.3에서 운영 중입니다. 모든 ApplicationSet에 `ServerSideApply=true` syncOption을 사용하고 있습니다.

Queue POC 3개 Application에 `GOTI_MESH_ENABLED=true` 환경변수를 추가한 뒤 git push했습니다. 이 중 한 Application은 이전 세션에서 Application JSON replace(operationState 초기화)로 sync에 성공했습니다. 나머지 두 Application은 동일한 변경이 Deployment에 반영되지 않았습니다.

### 발생한 현상

ArgoCD가 Deployment를 OutOfSync로 표시하지만, sync 실행 시 **Deployment가 syncResult resources에 아예 포함되지 않았습니다**.

| 리소스 | ArgoCD 상태 | sync 결과 |
|---|---|---|
| `Deployment goti-queue-dev` | OutOfSync (변경 감지됨) | 결과 목록에서 누락 |
| `ExternalSecret goti-queue-dev-secrets` | OutOfSync | Synced |

ExternalSecret(syncWave -1)만 sync되고 Deployment는 결과에서 완전히 제외되었습니다. sync를 반복해도 동일한 상태가 이어졌습니다.

### 시도한 방법 (모두 실패)

- 수동 sync, hard refresh
- auto-sync 비활성화 후 수동 sync
- Application JSON replace로 operation/operationState 정리
- `syncStrategy.apply` 명시적 지정

---

## 🤔 원인: client-side diff와 SSA 소유권 판단의 불일치

### 근본 원인

웹 검색과 ArgoCD GitHub Issues 조사를 통해 원인을 파악했습니다.

ArgoCD의 동작 흐름을 단계별로 살펴보겠습니다.

1. **diff 비교는 client-side**로 수행됩니다. Helm 렌더링 결과(desired state)와 live 상태를 비교해 "OutOfSync"를 판정합니다
2. **실제 sync는 SSA(server-side)**로 수행됩니다. K8s API 서버가 `managedFields` 기반으로 각 필드의 소유권을 확인합니다
3. Deployment에는 여러 controller가 필드를 소유합니다. kube-controller-manager, Istio sidecar injector, OTel auto-instrumentation 등입니다
4. SSA apply 시 K8s가 "이 필드는 다른 manager 소유"로 판단하면 **변경을 skip**합니다. ArgoCD는 이를 "sync 성공"으로 처리합니다
5. 하지만 client-side diff에서는 여전히 차이를 감지합니다. 결과적으로 **영구 OutOfSync** 상태가 됩니다

관련 GitHub Issues:
- [#11106](https://github.com/argoproj/argo-cd/issues/11106) — SSA OutOfSync with Deployment/StatefulSet
- [#10740](https://github.com/argoproj/argo-cd/issues/10740) — OutOfSync on SSA for existing resource
- [#21497](https://github.com/argoproj/argo-cd/issues/21497) — selfHeal sync loops with stale resource list

### 한 Application만 성공한 이유

이전 세션에서 Application JSON replace로 `operationState`를 초기화했더니, fresh sync 상태에서 ArgoCD가 새로 field manager 소유권을 획득했습니다. 이 Application만 정상적으로 sync된 이유입니다.

나머지 두 Application은 operationState가 초기화되지 않아 동일한 불일치 상태가 유지되었습니다.

---

## ✅ 해결: ServerSideDiff=true 전체 ApplicationSet 적용

### 영구 해결 방법

SSA를 사용한다면 diff 비교도 server-side로 통일해야 불일치가 발생하지 않습니다.

ArgoCD는 `ServerSideDiff=true` annotation으로 이를 지원합니다.

```yaml
# ApplicationSet template metadata에 추가
template:
  metadata:
    annotations:
      argocd.argoproj.io/compare-options: ServerSideDiff=true
```

이 annotation이 적용되면 ArgoCD는 diff 비교 시 dry-run SSA를 수행합니다. K8s API 서버가 실제 SSA와 동일한 소유권 기준으로 차이를 계산하므로 불일치가 사라집니다.

### 적용 범위

SSA를 사용하는 dev/prod 전체 10개 파일에 `ServerSideDiff=true`를 추가했습니다.

**dev 환경:**
- `gitops/dev/applicationsets/goti-msa-appset.yaml`
- `gitops/dev/applicationsets/goti-infra-appset.yaml`
- `gitops/dev/applicationsets/monitoring-appset.yaml`
- `gitops/dev/applicationsets/goti-istio-policy.yaml`
- `gitops/dev/applicationsets/monitoring-custom-app.yaml`

**prod 환경:**
- `gitops/prod/applicationsets/goti-msa-appset.yaml`
- `gitops/prod/applicationsets/monitoring-appset.yaml`
- `gitops/prod/applicationsets/goti-istio-policy.yaml`
- `gitops/prod/applicationsets/monitoring-custom-app.yaml`
- `gitops/prod/applicationsets/monitoring-istio-policy.yaml`

### 즉시 조치 (stuck Application 해결)

이미 OutOfSync 상태에 빠진 두 Application은 cascade 없이 삭제해 해결했습니다. ApplicationSet이 자동으로 재생성하면서 clean state에서 `ServerSideDiff=true`가 적용된 채로 sync됩니다.

```bash
$ argocd app delete goti-queue-dev --cascade=false
$ argocd app delete goti-queue-poc-a-dev --cascade=false
```

`--cascade=false`를 사용하면 K8s 리소스는 그대로 두고 ArgoCD Application 오브젝트만 삭제합니다. 실제 워크로드에 영향을 주지 않고 ApplicationSet 재생성을 유도할 수 있습니다.

### 결과

dev/prod 전체 SSA 사용 ApplicationSet/Application에 `ServerSideDiff=true`가 적용되었습니다. 이후 EKS 전환 시에도 동일한 문제가 발생하지 않도록 사전 차단했습니다.

---

## 📚 배운 점

**`ServerSideApply=true`와 `ServerSideDiff=true`는 세트로 사용해야 합니다**: SSA sync를 사용한다면 diff 비교도 반드시 server-side로 통일해야 합니다. client-side diff + server-side apply 조합은 구조적으로 영구 OutOfSync를 유발합니다. 새 ApplicationSet 생성 시 두 옵션을 기본 템플릿에 포함하는 것이 가장 안전합니다

**Deployment에는 여러 controller가 managedFields를 소유한다**: Istio sidecar injector, OTel auto-instrumentation 같은 admission webhook이 필드를 소유하면, ArgoCD SSA가 해당 필드를 변경하려 해도 skip됩니다. multi-controller 환경일수록 SSA 소유권 문제가 빈번하게 발생합니다

**sync 결과에서 리소스가 사라지면 소유권 문제를 먼저 의심해야 합니다**: sync 실행 후 OutOfSync 리소스가 syncResult에 포함되지 않는다면, SSA field ownership conflict가 원인일 가능성이 높습니다. `kubectl get <resource> -o yaml`로 `managedFields`를 확인해 어떤 manager가 해당 필드를 소유하는지 파악해야 합니다

**Force Sync는 SSA와 비호환입니다**: SSA 환경에서 Force Sync를 사용하면 managedFields 충돌이 더 심각해질 수 있습니다. stuck 상태 해결 시에는 `--cascade=false` 삭제 후 ApplicationSet 재생성이 안전한 방법입니다

### 재발 방지 규칙

1. `ServerSideApply=true` 사용 시 반드시 `ServerSideDiff=true` annotation 병행
2. 새 ApplicationSet 생성 시 두 옵션을 기본 템플릿에 포함
3. Force Sync 사용 금지 (SSA와 비호환)
