---
title: "SSA + Force Sync 충돌로 Deployment 미반영 — ArgoCD sync stuck 복구"
excerpt: "ServerSideApply=true 앱에서 Force Sync를 한 번 실행하면, .operation 필드에 잔류한 force 플래그가 매 auto-sync마다 --force --server-side 오류를 유발합니다. 그 결과 Deployment 변경이 전혀 반영되지 않은 사례입니다"
category: argocd
tags:
  - go-ti
  - ArgoCD
  - SSA
  - ForceSync
  - troubleshooting
series:
  name: goti-argocd
  order: 3
date: "2026-03-29"
---

## 한 줄 요약

> `ServerSideApply=true` 앱에서 Force Sync를 한 번 실행하면 `.operation` 필드에 `syncStrategy.apply.force: true`가 잔류합니다. 이후 모든 sync가 `--force --server-side` 충돌 오류로 실패하고, sync-wave 앞 단계에서 막히면 Deployment까지 skip됩니다. Application JSON에서 force 플래그를 제거하고 `kubectl replace`로 교체해 복구했습니다

---

## 🔥 문제: git push 후 Deployment 변경이 전혀 반영되지 않음

### 환경

- Kind K8s dev 환경, ArgoCD v3.3
- Queue POC 비교 테스트 중 팀원 구현체(`goti-queue-poc-b-dev`) 배포 중
- `syncPolicy: automated(prune+selfHeal)`, `syncOptions: ServerSideApply=true`

### 발생한 문제

`QUEUE_TOKEN_SECRET_KEY` 환경변수 값을 34바이트에서 32바이트로 수정한 뒤 git push했습니다.

ArgoCD가 OutOfSync를 감지했지만 Deployment에는 변경이 반영되지 않았습니다.

```text
# Pod 상태 (git push 후에도 그대로)
goti-queue-poc-b-dev-6d7dd8d669-rhpxb   1/2   ImagePullBackOff   (이전 배포 잔재, 태그 없음)
goti-queue-poc-b-dev-c4c686b5-4t5f4     1/2   CrashLoopBackOff   (이미지 pull 성공, 앱 시작 실패)
```

앱이 시작 실패하는 원인은 환경변수 오류였습니다.

```text
Caused by: java.lang.IllegalArgumentException: AES-256 Secret Key는 반드시 32바이트여야 합니다.
  at com.goti.global.utils.TokenEncryptor.<init>(TokenEncryptor.java:37)
```

그리고 ArgoCD sync 자체가 반복 실패하고 있었습니다.

```text
error validating options: --force cannot be used with --server-side
```

---

## 🤔 원인: .operation에 잔류한 force 플래그와 SSA 충돌

### 발생 경로

문제는 이전에 수동으로 실행했던 Force Sync에서 시작됐습니다.

1. 수동 Force Sync 실행 → ArgoCD Application `.operation` 필드에 `syncStrategy.apply.force: true` 기록
2. 이후 auto-sync 또는 수동 sync가 트리거될 때마다 kubectl이 `--force --server-side`를 동시에 사용하려 시도
3. kubectl은 이 조합을 거부 — `--force cannot be used with --server-side` 오류 반환
4. `syncOptions: ServerSideApply=true`로 설정된 앱 전체에서 force 플래그가 지속적으로 전파

### sync-wave가 상황을 악화시킨 이유

이 앱에는 sync-wave가 설정돼 있었습니다.

- Wave -1: ExternalSecret (Secret 생성 담당)
- Wave 0: Deployment

sync 오류가 첫 번째 wave인 ExternalSecret 단계에서 발생하면서, ArgoCD가 후속 wave 전체를 skip하는 동작이 맞물렸습니다.

결과적으로 Deployment는 sync 시도조차 되지 않았습니다. retry 5회가 동일 오류로 소진되고, selfHeal 재시도도 `.operation` 필드의 force 플래그가 남아있는 한 동일하게 실패했습니다.

### 수동 조치가 실패한 이유

1차로 `values.yaml`을 수정하고 git push했습니다. ArgoCD auto-sync는 미반영이었습니다.

2차로 `kubectl patch application`으로 수동 sync를 트리거했습니다. sync 상태는 Succeeded로 표시됐지만, 실제 Deployment env는 바뀌지 않았습니다. hard refresh도 동일했습니다.

3차로 `syncStrategy.apply.force: true`를 명시해 sync했습니다. 이것이 `.operation` 필드를 갱신하면서 문제를 확정했습니다. 이후 selfHeal이 반복 재시도했지만 모두 동일 오류로 실패했습니다.

---

## ✅ 해결: Application JSON에서 force 플래그 제거 후 replace

ArgoCD Application 리소스 자체를 직접 수정해야 했습니다.

**1단계: Application JSON export**

```bash
$ kubectl get application goti-queue-poc-b-dev -n argocd -o json > app.json
```

**2단계: force 플래그 제거**

`app.json`에서 다음 두 필드를 찾아 제거합니다.

```json
// 제거 대상 1 — .operation
"operation": {
  "sync": {
    "syncStrategy": {
      "apply": {
        "force": true
      }
    }
  }
}

// 제거 대상 2 — .status.operationState.syncResult 내부의 force 관련 필드
```

**3단계: Application 교체**

```bash
$ kubectl replace -f app.json
```

**4단계: 깨끗한 sync 트리거**

force 플래그 없이 sync operation을 새로 트리거합니다.

```bash
$ kubectl patch application goti-queue-poc-b-dev -n argocd \
  --type merge \
  -p '{"operation":{"sync":{"revision":"HEAD"}}}'
```

**결과:**

```text
# 수정 후 3개 POC Pod 모두 정상
goti-queue-poc-a-dev-5944d56f7c-fj26h   2/2   Running
goti-queue-poc-b-dev-f768849c6-kw8k8   2/2   Running
goti-queue-poc-c-dev-7569cd9d-zhqn5    2/2   Running
```

---

## 📚 배운 점

**`ServerSideApply=true` 앱에서 Force Sync는 사용하면 안 됩니다**: kubectl은 `--force --server-side`를 동시에 허용하지 않습니다. ArgoCD UI나 CLI에서 Force Sync 버튼은 보이지만, SSA가 활성화된 앱에 실행하면 `.operation` 필드에 force 플래그가 잔류하고 이후 모든 sync가 실패합니다

**잔류 operation 필드가 selfHeal을 무력화합니다**: ArgoCD selfHeal은 `.operation`을 재사용해 sync를 재시도합니다. force 플래그가 `.operation`에 남아있는 한 selfHeal이 몇 번이고 재시도해도 동일하게 실패합니다. selfHeal이 도는데 상태가 고쳐지지 않는다면 `.operation` 필드를 먼저 확인해야 합니다

**sync-wave 첫 단계 실패는 전체 wave를 멈춥니다**: ExternalSecret처럼 wave -1에 배치된 리소스가 sync에 실패하면 Deployment(wave 0)는 시도조차 되지 않습니다. "Deployment 변경이 반영 안 됨"의 원인이 Deployment 자체가 아닐 수 있습니다

**복구 절차는 `kubectl replace`입니다**: ArgoCD UI에서 force 플래그를 제거하는 방법은 없습니다. Application JSON을 export해 해당 필드를 삭제한 뒤 `kubectl replace`로 교체하는 것이 유일한 방법입니다

### 재발 방지

이 사건 이후 goti-team-controller 규칙 파일에 Force Sync 금지 조항을 추가했습니다. `ServerSideApply=true`로 구성된 goti ApplicationSet 전체에 적용되는 규칙입니다.

stuck 발생 시 복구 절차도 문서화했습니다.

1. `kubectl get application <name> -n argocd -o json > app.json`
2. `app.json`에서 `.operation.sync.syncStrategy.apply.force` 제거
3. `kubectl replace -f app.json`
4. `kubectl patch application <name> -n argocd --type merge -p '{"operation":{"sync":{"revision":"HEAD"}}}'`
