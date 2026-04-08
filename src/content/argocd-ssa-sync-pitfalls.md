---
title: "ArgoCD SSA의 두 가지 함정: Diff Skip과 Force Sync 충돌"
excerpt: "ServerSideApply 환경에서 Deployment가 sync skip되는 문제와 Force Sync가 영구 stuck을 만드는 문제를 해결한 기록"
category: argocd
tags:
  - ArgoCD
  - Troubleshooting
  - ServerSideApply
  - GitOps
  - Kubernetes
  - go-ti
series:
  name: "argocd-troubleshooting"
  order: 3
date: '2026-03-29'
---

## 한 줄 요약

> SSA 환경에서 Deployment가 OutOfSync인데 sync에서 skip되고, Force Sync를 시도하면 영구 stuck에 빠집니다. 두 문제 모두 SSA의 동작 원리를 이해하면 예방할 수 있습니다.

## 📊 Impact

- **영향 범위**: Queue POC 3개 서비스(A/C/B) 배포 불가
- **증상 지속**: Deployment 변경 미반영 + CrashLoopBackOff
- **소요 시간**: 약 3시간
- **발생일**: 2026-03-29

---

## 🔥 1. Deployment가 OutOfSync인데 Sync에서 사라진다

### 증상

Queue POC 3종에 `GOTI_MESH_ENABLED=true` 환경변수를 추가하고 git push했습니다.
ArgoCD가 변경을 감지해서 OutOfSync로 표시했지만, sync를 실행하면 **Deployment가 적용 대상에서 빠져 있었습니다**.

```
# ArgoCD 리소스 상태
Deployment      goti-queue-dev          OutOfSync   ← 변경 감지했지만
ExternalSecret  goti-queue-dev-secrets  OutOfSync

# sync 결과
ExternalSecret goti-queue-dev-secrets: Synced   ← 이것만 적용됨
(Deployment는 목록에 없음)
```

OutOfSync라고 말해놓고 정작 sync하면 무시합니다. 이상한 상황이었습니다.

### 시도한 방법들 (모두 실패)

하나씩 시도해봤는데 전부 실패했습니다:

| 시도 | 결과 |
|------|------|
| 수동 sync | Deployment skip, ExternalSecret만 적용 |
| Hard refresh + sync | 동일 |
| auto-sync 비활성화 → 수동 sync | 동일 |
| Application JSON replace (operationState 초기화) | 동일 |
| syncStrategy.apply 명시적 지정 | 동일 |

5가지를 시도했는데 모두 같은 결과. Deployment만 계속 skip되었습니다.

흥미로운 점은, B님의 Application은 이전 세션에서 JSON replace로 operationState를 초기화했을 때 sync가 성공했다는 것입니다. 그런데 같은 방법을 A/C에게 적용하면 안 됐습니다.

### Client-side Diff vs Server-side Apply: 불일치의 원인

웹 검색과 ArgoCD GitHub Issues를 파고들어서 근본 원인을 찾았습니다.

문제의 핵심은 **ArgoCD의 diff 비교 방식과 실제 sync 방식이 다르다**는 것이었습니다.

{/* TODO: Draw.io로 교체 (public/images/argocd/argocd-ssa-diff-mismatch.svg) */}
```
┌─────────────────────────────────────────────────────────────────────┐
│                    ArgoCD Sync Pipeline                             │
│                                                                     │
│  ┌──────────────┐     ┌──────────────┐     ┌───────────────────┐   │
│  │  Git Repo    │     │  Diff 비교    │     │  실제 Apply       │   │
│  │  (desired)   │────▶│  (client-side)│────▶│  (server-side)    │   │
│  └──────────────┘     └──────┬───────┘     └────────┬──────────┘   │
│                              │                       │              │
│                       "차이 있음!"              "변경 불필요"        │
│                       OutOfSync 판정          managedFields 기반    │
│                                               소유권 확인 → skip    │
│                              │                       │              │
│                              ▼                       ▼              │
│                     ┌────────────────────────────────────┐          │
│                     │  결과: 영구 OutOfSync               │          │
│                     │  diff는 차이 감지 / apply는 skip    │          │
│                     └────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────────┘
```

단계별로 설명하면 이렇습니다:

1. **Diff 비교는 client-side**에서 수행됩니다. ArgoCD가 Helm 렌더링 결과(desired)와 클러스터의 live 상태를 직접 비교합니다. 당연히 환경변수가 추가되었으니 "차이 있음 → OutOfSync"로 판정합니다.

2. **실제 sync는 SSA(Server-Side Apply)**로 수행됩니다. K8s API 서버가 `managedFields`를 기반으로 각 필드의 소유권을 확인합니다.

3. Deployment에는 여러 controller가 필드를 소유하고 있습니다. `kube-controller-manager`가 replicas와 strategy를, Istio sidecar injector가 annotation을, OTel auto-instrumentation이 또 다른 필드를 소유합니다.

4. SSA apply 시 K8s API 서버가 "이 필드는 다른 manager 소유" → **변경 skip** → "sync 성공"으로 처리합니다.

5. 하지만 client-side diff에서는 여전히 차이를 감지하니까 → **영구 OutOfSync 루프**가 됩니다.

### managedFields가 뭔가요?

Kubernetes 1.18부터 모든 리소스에 `managedFields`라는 메타데이터가 붙습니다. 이건 **"누가 어떤 필드를 소유하는지"** 추적하는 장치입니다.

```yaml
# kubectl get deployment -o yaml에서 확인 가능
metadata:
  managedFields:
    - manager: kube-controller-manager    # replicas, strategy 소유
      operation: Update
      fieldsV1:
        f:spec:
          f:replicas: {}
    - manager: argocd-controller          # 대부분의 spec 소유
      operation: Apply
      fieldsV1:
        f:spec:
          f:template: {}
    - manager: istio-sidecar-injector     # sidecar annotation 소유
      operation: Update
      fieldsV1:
        f:metadata:
          f:annotations:
            f:sidecar.istio.io/inject: {}
```

SSA는 이 정보를 보고 "내가 소유하지 않은 필드는 건드리지 않겠다"고 판단합니다. Client-side apply는 이런 소유권 개념이 없습니다. 그냥 전체를 덮어씁니다.

**이 차이가 diff(client-side)와 apply(server-side)의 불일치를 만든 거였습니다.**

### B만 성공한 이유

B님의 경우, 이전 세션에서 Application JSON replace로 `operationState`를 완전히 초기화했습니다. 이때 ArgoCD가 fresh sync를 수행하면서 field manager 소유권을 새로 획득했습니다.

A/C은 기존 operationState가 남아있어서 ArgoCD가 "이전 sync 결과를 이어서" 처리했고, 이미 다른 manager가 소유한 필드를 건드리지 않은 겁니다.

### 해결: ServerSideDiff=true annotation

SSA를 사용하면 **diff 비교도 server-side로 통일**해야 합니다.

```yaml
# Before: diff와 apply 방식이 다름
syncOptions:
  - ServerSideApply=true
# diff는 client-side → 영구 OutOfSync

# After: diff도 server-side로 통일
template:
  metadata:
    annotations:
      argocd.argoproj.io/compare-options: ServerSideDiff=true  # ← 추가!
  spec:
    syncPolicy:
      syncOptions:
        - ServerSideApply=true
```

Server-side diff는 API 서버에 SSA dry-run을 요청하고, 그 응답과 live 상태를 비교합니다. API 서버가 기본값, admission webhook 변경, managedFields 소유권을 모두 반영한 결과를 돌려주기 때문에 false positive OutOfSync가 발생하지 않습니다.

### 적용 범위

SSA를 사용하는 **전체 10개 파일**에 `ServerSideDiff=true`를 추가했습니다:

**dev (5개):**
- `gitops/dev/applicationsets/goti-msa-appset.yaml`
- `gitops/dev/applicationsets/goti-infra-appset.yaml`
- `gitops/dev/applicationsets/monitoring-appset.yaml`
- `gitops/dev/applicationsets/goti-istio-policy.yaml`
- `gitops/dev/applicationsets/monitoring-custom-app.yaml`

**prod (5개):**
- `gitops/prod/applicationsets/goti-msa-appset.yaml`
- `gitops/prod/applicationsets/monitoring-appset.yaml`
- `gitops/prod/applicationsets/goti-istio-policy.yaml`
- `gitops/prod/applicationsets/monitoring-custom-app.yaml`
- `gitops/prod/applicationsets/monitoring-istio-policy.yaml`

### 즉시 조치: stuck 상태 해제

annotation 추가만으로는 이미 stuck된 Application이 풀리지 않았습니다. `--cascade=false`로 Application만 삭제하고 ApplicationSet이 자동으로 재생성하게 했습니다:

```bash
# cascade=false: 하위 리소스(Pod, Deployment 등)는 유지, Application 객체만 삭제
$ argocd app delete goti-queue-dev --cascade=false
$ argocd app delete goti-queue-junsang-dev --cascade=false

# ApplicationSet이 자동으로 새 Application 생성 → clean state에서 sync
```

### 핵심 포인트

- `ServerSideApply=true`를 쓰면서 diff는 client-side로 두면 **영구 OutOfSync 루프**에 빠질 수 있습니다
- 해결은 `ServerSideDiff=true` annotation 추가입니다. **SSA를 쓰면 반드시 함께 설정**해야 합니다
- 이미 stuck된 Application은 `--cascade=false` 삭제 → ApplicationSet 재생성으로 해제합니다

---

## 🔥 2. Force Sync가 영구 Stuck을 만든다

첫 번째 문제(Diff Skip)를 해결하기 전, 조급한 마음에 Force Sync를 시도했습니다. 이게 상황을 훨씬 더 악화시켰습니다.

### 증상

B님의 Queue POC 서비스(`goti-queue-sungjeon-dev`)에서 `QUEUE_TOKEN_SECRET_KEY`를 34바이트에서 32바이트로 수정하고 git push했습니다. 그런데 ArgoCD가 변경을 반영하지 않았습니다.

```
# Pod 상태
goti-queue-sungjeon-dev-6d7dd8d669-rhpxb   1/2   ImagePullBackOff
goti-queue-sungjeon-dev-c4c686b5-4t5f4     1/2   CrashLoopBackOff

# 앱 시작 실패 원인
Caused by: java.lang.IllegalArgumentException:
  AES-256 Secret Key는 반드시 32바이트여야 합니다.
  at com.goti.global.utils.TokenEncryptor.<init>(TokenEncryptor.java:37)
```

values.yaml에서 32바이트로 고쳤는데, Deployment에 반영이 안 되니까 Pod은 계속 옛날 34바이트 키로 시작하고, AES-256 검증에 실패해서 CrashLoopBackOff가 반복되었습니다.

### 상황을 악화시킨 Force Sync

변경이 반영되지 않으니 Force Sync를 시도했습니다. 그 순간부터 모든 것이 꼬이기 시작했습니다.

```
# ArgoCD sync 에러 (무한 반복)
"error validating options: --force cannot be used with --server-side"
```

이 에러가 왜 발생하는지 이해하려면, `--force`와 `--server-side`가 무엇인지 알아야 합니다.

| 플래그 | 방식 | 충돌 해결 |
|--------|------|-----------|
| `--force` | Client-side apply. 리소스를 **삭제 후 재생성** | 기존 리소스를 날리고 새로 만듦 |
| `--server-side` | Server-side apply. API 서버에서 처리 | `--force-conflicts`로 **소유권 강제 탈취** |

두 플래그는 완전히 다른 적용 메커니즘을 사용합니다. `--force`는 "리소스를 지우고 다시 만들어"이고, `--server-side`는 "API 서버야, 이걸 적용해줘"입니다. kubectl은 이 두 가지를 동시에 사용하는 것을 거부합니다.

### Force 플래그가 잔류하는 에러 루프

문제는 Force Sync를 한 번 실행하면 Application의 `.operation` 필드에 `force: true`가 기록된다는 것이었습니다. 그리고 이 플래그가 **제거되지 않고 계속 남아있었습니다**.

{/* TODO: Draw.io로 교체 (public/images/argocd/argocd-force-sync-loop.svg) */}
```
┌─────────────────────────────────────────────────────────────────┐
│                Force Sync 에러 루프                              │
│                                                                  │
│  ┌──────────┐    Force Sync    ┌──────────────────────┐         │
│  │ 사용자    │───────────────▶│ Application.operation  │         │
│  └──────────┘                 │ syncStrategy:          │         │
│       ↑                       │   apply:               │         │
│       │                       │     force: true  ← 잔류│         │
│  "왜 안 되지?"                └──────────┬───────────┘         │
│                                          │                      │
│                                          ▼                      │
│                               ┌──────────────────────┐         │
│                               │ kubectl apply         │         │
│                               │ --server-side         │         │
│                               │ --force          ← ❌ │         │
│                               └──────────┬───────────┘         │
│                                          │                      │
│                                          ▼                      │
│                               ┌──────────────────────┐         │
│                               │ "error: --force       │         │
│                               │  cannot be used with  │         │
│                               │  --server-side"       │         │
│                               └──────────┬───────────┘         │
│                                          │                      │
│                                          ▼                      │
│                               ┌──────────────────────┐         │
│                               │ ExternalSecret        │         │
│                               │ (syncWave -1) 실패    │         │
│                               │ → Deployment skip     │         │
│                               └──────────┬───────────┘         │
│                                          │                      │
│                                          ▼                      │
│                               ┌──────────────────────┐         │
│                               │ retry 5회 소진        │         │
│                               │ → selfHeal 재시도     │         │
│                               │ → 동일 force 전파     │──── 루프│
│                               └──────────────────────┘         │
└─────────────────────────────────────────────────────────────────┘
```

발생 경로를 시간순으로 정리하면:

1. **수동 Force Sync 실행** → Application의 `.operation.syncStrategy.apply.force`가 `true`로 설정됨
2. kubectl이 `--force --server-side` 동시 사용을 거부 → **ExternalSecret(syncWave -1) sync 실패**
3. syncWave -1이 실패했으니 **후속 wave(Deployment 등) 전체가 skip**됨
4. retry 5회가 동일 에러로 소진 → selfHeal이 재시도해도 **동일한 force 플래그를 전파**

selfHeal이 새로운 sync를 트리거해도 `.operation` 필드에서 force 플래그를 그대로 가져옵니다. 결국 무한 루프에 빠집니다. 수동 sync를 다시 눌러도 마찬가지입니다.

### 해결: Application JSON에서 force 플래그 제거

해결 방법은 Application 객체를 직접 수정해서 force 플래그를 제거하는 것이었습니다:

```bash
# 1. Application JSON 백업
$ kubectl get application goti-queue-sungjeon-dev -n argocd -o json > app-backup.json

# 2. force 플래그 제거
# .operation.syncStrategy.apply.force: true → 삭제
# .status.operationState.syncResult에서 force 관련 필드 정리

# 3. 수정된 JSON으로 교체
$ kubectl replace -f app-fixed.json

# 4. force 없는 깨끗한 sync 트리거
$ kubectl patch application goti-queue-sungjeon-dev -n argocd \
    --type=merge -p '{"operation":{"initiatedBy":{"username":"admin"},"sync":{"revision":"HEAD"}}}'
```

### Before / After

| 컴포넌트 | Before | After |
|----------|--------|-------|
| goti-queue-dev (A) | 2/2 Running (Diff Skip 문제만) | 2/2 Running ✅ |
| goti-queue-junsang-dev (C) | 2/2 Running (Diff Skip 문제만) | 2/2 Running ✅ |
| goti-queue-sungjeon-dev (B) | 1/2 CrashLoopBackOff | 2/2 Running ✅ |
| ArgoCD sync 상태 | `--force cannot be used with --server-side` 반복 | Synced ✅ |
| QUEUE_TOKEN_SECRET_KEY | 34바이트 (AES-256 실패) | 32바이트 (정상) |

### 핵심 포인트

- **SSA 환경에서 Force Sync는 절대 사용하면 안 됩니다.** `--force`와 `--server-side`는 근본적으로 호환되지 않는 메커니즘입니다.
- Force Sync를 한 번이라도 실행하면 `.operation` 필드에 `force: true`가 **잔류**하고, 이후 모든 sync(selfHeal 포함)에 전파됩니다.
- 복구 방법: Application JSON을 직접 수정해서 force 플래그를 제거한 뒤 clean sync를 트리거합니다.

---

## 📚 종합 정리

| 문제 | 원인 | 해결 | 예방 |
|------|------|------|------|
| Deployment OutOfSync인데 sync skip | Client-side diff vs Server-side apply 불일치 | `ServerSideDiff=true` annotation | SSA 사용 시 반드시 ServerSideDiff 병행 |
| Force Sync 후 영구 stuck | `--force`와 `--server-side` 호환 불가 + force 플래그 잔류 | Application JSON replace로 force 제거 | **SSA 앱에서 Force Sync 절대 금지** |

### SSA 사용 체크리스트

ArgoCD에서 Server-Side Apply를 설정할 때 반드시 확인해야 할 것들입니다:

- [ ] `ServerSideApply=true` syncOption 설정했는가?
- [ ] `ServerSideDiff=true` compare-options annotation을 **함께** 설정했는가?
- [ ] 팀원에게 Force Sync 금지를 공유했는가?
- [ ] stuck 발생 시 복구 절차(JSON replace → force 제거 → clean sync)를 문서화했는가?
- [ ] 새 ApplicationSet 템플릿에 이 조합을 기본으로 포함했는가?

---

## 🤔 스스로에게 던지는 질문

1. **SSA를 꼭 써야 하는가?** — Istio sidecar injection, OTel auto-instrumentation처럼 여러 controller가 리소스를 수정하는 환경에서는 SSA가 managedFields 충돌을 자동으로 해결해줍니다. 쓰되, ServerSideDiff를 반드시 함께 설정해야 합니다.

2. **ArgoCD UI에서 Force Sync 버튼이 보이는데, 비활성화할 수 있는가?** — ArgoCD 자체적으로 RBAC에서 `applications, sync` action을 제한할 수는 있지만, Force Sync만 따로 비활성화하는 설정은 아직 없습니다. 팀 규칙으로 관리해야 합니다.

3. **managedFields 충돌이 발생하는 리소스를 미리 파악할 수 있는가?** — `kubectl get deploy -o jsonpath='{.metadata.managedFields[*].manager}'`로 각 리소스의 field manager 목록을 확인할 수 있습니다. manager가 3개 이상이면 SSA diff 불일치 가능성이 높습니다.

---

## 🔗 참고

- [ArgoCD Diff Strategies - Server-Side Diff](https://argo-cd.readthedocs.io/en/stable/user-guide/diff-strategies/)
- [ArgoCD Sync Options - Server-Side Apply](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-options/)
- [Kubernetes Server-Side Apply](https://kubernetes.io/docs/reference/using-api/server-side-apply/)
- [ArgoCD Issue #11106 — SSA OutOfSync with Deployment](https://github.com/argoproj/argo-cd/issues/11106)
- [ArgoCD Issue #10740 — OutOfSync on SSA for existing resource](https://github.com/argoproj/argo-cd/issues/10740)
