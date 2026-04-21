---
date: 2026-03-11
category: troubleshoot
project: Goti-k8s
tags: [kubectl, secret, shell-escape, ecr, external-secrets]
---

# Kind aws-ecr-creds Secret에 `$` 문자가 쉘 변수로 치환되어 연쇄 장애 발생

## Context
Kind 모니터링 정상화 작업 중, Kind 클러스터(Ubuntu 32GB, 3노드)에서 ECR 이미지 pull 및 ExternalSecret 동기화가 전면 실패.
Terraform으로 생성한 IAM User(`goti-dev-kind-ecr-readonly`)의 Access Key를 `kubectl create secret` 명령으로 Kind 클러스터에 등록하는 과정에서 발생.

## Issue

aws-ecr-creds Secret의 3개 키 중 `AWS_ACCESS_KEY_ID`가 비어있음 (0 chars):

```
┌───────────────────────┬───────────────────────┐
│          Key          │       현재 상태       │
├───────────────────────┼───────────────────────┤
│ AWS_ACCESS_KEY_ID     │ 비어있음 (0 chars)    │
│ AWS_SECRET_ACCESS_KEY │ 정상 (38 chars)       │
│ AWS_REGION            │ 정상 (ap-northeast-2) │
└───────────────────────┴───────────────────────┘
```

연쇄 장애:
- ECR CronJob 실패 → ECR 토큰 갱신 불가 → ImagePullBackOff
- ClusterSecretStore InvalidProviderConfig → ESO 전체 불능 → grafana-admin-secret 미생성

## Action

1. Secret 값 확인 → `AWS_ACCESS_KEY_ID`가 0 chars로 비어있음 확인
2. IAM User 존재 여부 확인 → Terraform으로 이미 생성됨 (`goti-dev-kind-ecr-readonly`)
3. Access Key 재확인 → AWS 콘솔에서 키 정상 존재 확인

**근본 원인 (Root Cause)**:
`kubectl create secret --from-literal` 명령에서 값을 큰따옴표(`"`)로 감쌌는데, 값에 `$` 문자가 포함되어 있어 쉘이 `$` 이후를 변수로 해석 → 값이 잘림.

**적용한 수정**:
- Secret 값을 작은따옴표(`'`)로 감싸서 쉘 변수 치환 방지
- `kubectl create secret generic aws-ecr-creds --from-literal=AWS_ACCESS_KEY_ID='AKIA...$...'`

## Result

- ECR CronJob 성공 → goti, argocd 네임스페이스 ecr-creds 갱신 완료
- ClusterSecretStore 정상 복구 → ExternalSecret 동기화 정상
- 모니터링 관련 ArgoCD App 4개 전부 Synced/Healthy 복구

**재발 방지책**:
- `kubectl create secret --from-literal` 사용 시 값에 특수문자(`$`, `!`, `` ` ``) 포함 가능성이 있으면 반드시 작은따옴표(`'`) 사용
- Secret 등록 후 `kubectl get secret -o jsonpath`로 실제 저장된 값 검증 필수

## Related Files
- Kind 클러스터 aws-ecr-creds Secret (goti, argocd namespace)
