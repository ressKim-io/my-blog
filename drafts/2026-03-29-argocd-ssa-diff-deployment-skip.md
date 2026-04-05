---
date: 2026-03-29
category: troubleshoot
project: Goti-k8s
tags: [argocd, server-side-apply, server-side-diff, deployment, managed-fields, applicationset]
---

# ArgoCD SSA sync 시 Deployment가 OutOfSync인데 실제 적용 skip — ServerSideDiff로 영구 해결

## Context
- Kind K8s dev 환경, ArgoCD v3.3
- 모든 ApplicationSet에 `ServerSideApply=true` syncOption 사용
- Queue POC 3종(수연/준상/성전)에 `GOTI_MESH_ENABLED=true` 환경변수 추가 후 git push
- 성전은 이전 세션에서 Application JSON replace(operationState 초기화)로 sync 성공
- 수연/준상은 동일 변경이 Deployment에 반영되지 않음

## Issue

ArgoCD가 Deployment를 OutOfSync로 표시하지만, sync 실행 시 **Deployment가 syncResult resources에 아예 포함되지 않음**. ExternalSecret(syncWave -1)만 sync되고 Deployment는 skip.

```
# ArgoCD 리소스 상태
Deployment   goti-queue-dev   OutOfSync   ← 변경 감지했지만
ExternalSecret goti-queue-dev-secrets  OutOfSync

# sync 결과
ExternalSecret goti-queue-dev-secrets: Synced ← 이것만 적용됨
(Deployment는 목록에 없음)
```

시도한 방법들 (모두 실패):
- 수동 sync, hard refresh
- auto-sync 비활성화 후 수동 sync
- Application JSON replace로 operation/operationState 정리
- `syncStrategy.apply` 명시적 지정

## Action

### 근본 원인 분석 (웹 검색 + ArgoCD GitHub Issues)

**Root Cause: SSA sync와 client-side diff의 불일치**

1. ArgoCD의 **diff 비교는 client-side**: Helm 렌더링(desired) vs live 상태 → "OutOfSync" 판정
2. **실제 sync는 SSA(server-side)**: K8s API 서버가 `managedFields` 기반으로 소유권 확인
3. Deployment에는 여러 controller가 필드 소유 (kube-controller-manager, Istio sidecar injector, OTel auto-instrumentation)
4. SSA apply 시 K8s가 "이 필드는 다른 manager 소유" → **변경 skip** → "sync 성공"
5. 하지만 client-side diff에서는 여전히 차이 감지 → **영구 OutOfSync**

관련 GitHub Issues:
- [#11106](https://github.com/argoproj/argo-cd/issues/11106) — SSA OutOfSync with Deployment/StatefulSet
- [#10740](https://github.com/argoproj/argo-cd/issues/10740) — OutOfSync on SSA for existing resource
- [#21497](https://github.com/argoproj/argo-cd/issues/21497) — selfHeal sync loops with stale resource list

**성전만 성공한 이유**: Application JSON replace로 `operationState`가 초기화 → fresh sync에서 ArgoCD가 새로 field manager 소유권 획득

### 영구 해결: `ServerSideDiff=true` annotation 추가

SSA를 사용하면 diff 비교도 server-side로 통일해야 불일치가 발생하지 않음.

```yaml
template:
  metadata:
    annotations:
      argocd.argoproj.io/compare-options: ServerSideDiff=true
```

### 적용 범위

SSA 사용하는 **전체 10개 파일**에 `ServerSideDiff=true` 추가:

**dev:**
- `gitops/dev/applicationsets/goti-msa-appset.yaml`
- `gitops/dev/applicationsets/goti-infra-appset.yaml`
- `gitops/dev/applicationsets/monitoring-appset.yaml`
- `gitops/dev/applicationsets/goti-istio-policy.yaml` (Application)
- `gitops/dev/applicationsets/monitoring-custom-app.yaml` (Application)

**prod:**
- `gitops/prod/applicationsets/goti-msa-appset.yaml`
- `gitops/prod/applicationsets/monitoring-appset.yaml`
- `gitops/prod/applicationsets/goti-istio-policy.yaml` (Application)
- `gitops/prod/applicationsets/monitoring-custom-app.yaml` (Application)
- `gitops/prod/applicationsets/monitoring-istio-policy.yaml` (Application)

### 즉시 조치 (stuck 앱 해결)

수연/준상 Application을 `--cascade=false`로 삭제 → ApplicationSet이 자동 재생성 → clean state에서 ServerSideDiff=true와 함께 sync:

```bash
argocd app delete goti-queue-dev --cascade=false
argocd app delete goti-queue-junsang-dev --cascade=false
```

## Result

- dev/prod 전체 SSA 사용 ApplicationSet/Application에 `ServerSideDiff=true` 적용
- EKS 전환 시에도 동일 문제 방지
- `user-approval.md`에 Force Sync 금지 규칙도 이전 세션에서 추가 완료

### 재발 방지 규칙
1. `ServerSideApply=true` 사용 시 반드시 `ServerSideDiff=true` annotation 병행
2. 새 ApplicationSet 생성 시 이 조합을 기본 템플릿으로 포함
3. Force Sync 절대 금지 (SSA와 비호환)

## Related Files
- `Goti-k8s/gitops/dev/applicationsets/goti-msa-appset.yaml`
- `Goti-k8s/gitops/dev/applicationsets/goti-infra-appset.yaml`
- `Goti-k8s/gitops/dev/applicationsets/monitoring-appset.yaml`
- `Goti-k8s/gitops/dev/applicationsets/goti-istio-policy.yaml`
- `Goti-k8s/gitops/dev/applicationsets/monitoring-custom-app.yaml`
- `Goti-k8s/gitops/prod/applicationsets/goti-msa-appset.yaml`
- `Goti-k8s/gitops/prod/applicationsets/monitoring-appset.yaml`
- `Goti-k8s/gitops/prod/applicationsets/goti-istio-policy.yaml`
- `Goti-k8s/gitops/prod/applicationsets/monitoring-custom-app.yaml`
- `Goti-k8s/gitops/prod/applicationsets/monitoring-istio-policy.yaml`
