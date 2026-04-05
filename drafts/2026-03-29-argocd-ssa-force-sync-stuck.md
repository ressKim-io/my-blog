---
date: 2026-03-29
category: troubleshoot
project: Goti-k8s
tags: [argocd, server-side-apply, force-sync, crashloopbackoff, external-secret, sync-wave]
---

# ArgoCD ServerSideApply + Force Sync 충돌로 sync stuck → Deployment 미반영 → CrashLoopBackOff 지속

## Context
- Kind K8s dev 환경, ArgoCD v3.3
- Queue POC A/B/C 비교 테스트 중 성전님 구현체(`goti-queue-sungjeon-dev`) 배포
- `QUEUE_TOKEN_SECRET_KEY` 환경변수 값을 34바이트 → 32바이트로 수정 후 git push
- ArgoCD Application syncPolicy: `automated(prune+selfHeal)`, syncOptions: `ServerSideApply=true`

## Issue
git push 후 ArgoCD가 OutOfSync를 감지했으나 **Deployment에 변경이 반영되지 않음**.

```
# Pod 상태
goti-queue-sungjeon-dev-6d7dd8d669-rhpxb   1/2   ImagePullBackOff    (이전 배포 잔재, poc-sungjeon-latest 태그 없음)
goti-queue-sungjeon-dev-c4c686b5-4t5f4     1/2   CrashLoopBackOff   (이미지 pull 성공, 앱 시작 실패)

# 앱 시작 실패 원인
Caused by: java.lang.IllegalArgumentException: AES-256 Secret Key는 반드시 32바이트여야 합니다.
  at com.goti.global.utils.TokenEncryptor.<init>(TokenEncryptor.java:37)

# ArgoCD sync 에러 (반복)
"error validating options: --force cannot be used with --server-side"
```

재현 조건: ServerSideApply=true 앱에서 Force Sync를 1회 이상 실행한 후 발생

## Action

### 1차: values.yaml 수정 + ArgoCD sync 시도
- `QUEUE_TOKEN_SECRET_KEY`: 34바이트 → 32바이트로 수정
- `image.tag`: `poc-sungjeon-latest` → `poc-sungjeon-2-5c79616` 교체
- git push 후 ArgoCD auto-sync 대기 → **미반영**

### 2차: 수동 sync 시도 (kubectl patch)
- `kubectl patch application` → sync Succeeded로 표시되나 Deployment env 미변경
- hard refresh 시도 → 동일

### 3차: Force sync 시도 → 상태 악화
- `syncStrategy.apply.force: true` 추가 sync → `"--force cannot be used with --server-side"` 에러
- ExternalSecret(syncWave -1) 실패 → Deployment(wave 0) **아예 skip됨**
- retry 5회 소진, selfHeal 재시도도 동일 에러 반복

### 4차: 근본 원인 분석 (k8s-troubleshooter 에이전트)

**Root Cause**: `.operation` 필드에 잔류한 `syncStrategy.apply.force: true`가 `ServerSideApply=true`와 충돌

발생 경로:
1. 수동 Force Sync → `syncStrategy.apply.force: true` 설정됨
2. kubectl은 `--force --server-side` 동시 사용을 거부
3. ExternalSecret(syncWave -1)이 먼저 실패 → 후속 wave 리소스 전체 skip
4. retry 5회가 동일 에러로 소진 → selfHeal이 재시도해도 force 플래그 전파

### 5차: 해결
1. Application JSON export → `operation`, `operationState.syncStrategy` 에서 force 플래그 제거
2. `kubectl replace -f <fixed-json>` 으로 Application 교체
3. force 없는 깨끗한 sync operation 트리거 (`kubectl patch` with revision 명시)
4. Deployment 정상 반영 → 새 Pod Running (2/2)

## Result

```
# 수정 후 3개 Pod 모두 정상
goti-queue-dev-5944d56f7c-fj26h           2/2   Running   (수연)
goti-queue-junsang-dev-7569cd9d-zhqn5     2/2   Running   (준상)
goti-queue-sungjeon-dev-f768849c6-kw8k8   2/2   Running   (성전)
```

### 재발 방지
- `.claude/rules/user-approval.md`에 **ArgoCD Force Sync 금지** 섹션 추가
- ServerSideApply=true 앱 전체(goti ApplicationSet)에 해당
- stuck 발생 시 복구 절차 문서화 (Application JSON → force 제거 → replace → clean sync)

## Related Files
- `Goti-k8s/environments/dev/goti-queue-sungjeon/values.yaml` — AES-256 키 32바이트 수정 + 이미지 태그 교체
- `goti-team-controller/.claude/rules/user-approval.md` — Force Sync 금지 규칙 추가
