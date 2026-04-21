---
date: 2026-03-13
category: troubleshoot
project: Goti-monitoring
tags: [tempo, securityContext, argocd, helm, structured-merge-diff]
---

# Tempo securityContext Pod/container level 혼동으로 ArgoCD sync 실패

## Context
Goti-monitoring → Goti-k8s ArgoCD 직접 참조 전환 후, ArgoCD에서 모니터링 앱 sync 상태 확인 중 tempo-dev만 `Unknown` 상태로 남아 있었다.

## Issue
```
Failed to compare desired state to live state: failed to calculate diff:
error calculating structured merge diff: error building typed value from config resource:
.spec.template.spec.securityContext.allowPrivilegeEscalation: field not declared in schema
```

ArgoCD가 desired state와 live state를 비교할 때 structured merge diff 계산에서 스키마 에러 발생.

재현 조건: `values-stacks/dev/tempo-values.yaml`에서 최상위 `securityContext`에 container-level 전용 필드를 설정한 상태로 ArgoCD sync.

## Action
1. 가설: ArgoCD repo credential 미등록 → 결과: 기각 (다른 앱은 Synced, 에러 메시지가 스키마 관련)
2. 가설: securityContext 필드가 잘못된 위치에 있음 → 결과: 채택

`helm show values grafana-community/tempo --version 1.24.4`로 chart 구조 확인:
- **최상위 `securityContext`** = Pod-level → `runAsUser`, `runAsGroup`, `fsGroup`, `runAsNonRoot`만 허용
- **`tempo.securityContext`** = container-level → `allowPrivilegeEscalation`, `capabilities` 등

**근본 원인**: `allowPrivilegeEscalation`과 `capabilities`는 K8s PodSecurityContext 스키마에 존재하지 않는 필드. container-level SecurityContext에만 있는 필드를 Pod-level에 넣어서, ArgoCD의 structured merge diff가 스키마 검증 실패.

**적용한 수정:**
- Pod-level securityContext에 `runAsUser/runAsGroup/fsGroup/runAsNonRoot` 추가
- container-level 필드(`allowPrivilegeEscalation`, `capabilities`)를 `tempo.securityContext`로 이동

## Result
수정 후 ArgoCD sync 상태 Synced 확인 대기 (사용자 commit/push 후 자동 반영 예정).

회귀 테스트: `validate.yml`의 `helm template` dry-run이 렌더링 검증하지만, ArgoCD structured merge diff 스키마 에러는 helm template으로 감지 불가. ArgoCD 배포 후 수동 확인 필요.

재발 방지: Helm chart의 securityContext 설정 시 Pod-level vs container-level 구분을 주석으로 명시하는 패턴 적용.

## Related Files
- values-stacks/dev/tempo-values.yaml
