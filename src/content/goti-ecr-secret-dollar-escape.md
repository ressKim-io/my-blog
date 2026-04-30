---
title: "kubectl create secret에서 $ 문자가 사라진다: ECR 연쇄 장애"
excerpt: "쉘 변수 치환으로 Secret 값이 잘려 ECR 토큰 갱신과 ExternalSecret 동기화가 전면 실패한 트러블슈팅 기록"
type: troubleshooting
category: argocd
tags:
  - go-ti
  - ArgoCD
  - GitOps
  - Troubleshooting
  - ECR
  - ExternalSecrets
  - kubectl
series:
  name: "goti-argocd-gitops"
  order: 1
date: '2026-02-10'
---

## 한 줄 요약

> `kubectl create secret --from-literal`에서 큰따옴표를 썼더니 `$` 이후 값이 사라졌습니다. Secret 하나가 비어 ECR 토큰 갱신, ExternalSecret 동기화가 전면 실패.

## Impact

- **영향 범위**: Kind 클러스터 전체 (ECR pull + ExternalSecret 전면 장애)
- **증상**: ImagePullBackOff, ClusterSecretStore InvalidProviderConfig
- **소요 시간**: 약 2시간
- **발생일**: 2026-03-11

---

## 🔥 증상: ECR 이미지 풀과 ExternalSecret이 동시에 실패한다

Kind 클러스터(Ubuntu 32GB, 3노드)에서 모니터링 정상화 작업 중이었습니다.
Terraform으로 생성한 IAM User(`goti-dev-kind-ecr-readonly`)의 Access Key를 `kubectl create secret` 명령으로 등록하는 과정에서 문제가 발생했습니다.

### Secret 상태 확인

```bash
$ kubectl get secret aws-ecr-creds -n goti -o jsonpath='{.data}' | jq
```

확인 결과, 3개 키 중 `AWS_ACCESS_KEY_ID`만 비어있었습니다:

| Key | 상태 |
|-----|------|
| `AWS_ACCESS_KEY_ID` | 비어있음 (0 chars) |
| `AWS_SECRET_ACCESS_KEY` | 정상 (38 chars) |
| `AWS_REGION` | 정상 (ap-northeast-2) |

Access Key ID가 비어있으니 AWS API 인증 자체가 불가능합니다.

### 연쇄 장애

하나의 Secret 값이 비어있을 뿐인데, 영향은 클러스터 전체로 퍼졌습니다.

**첫 번째 연쇄**: ECR 이미지 풀 실패 — `ECR CronJob 실패 → ECR 토큰 갱신 불가 → ImagePullBackOff` 사슬이 만들어졌습니다.

ECR CronJob이 Access Key로 AWS에 인증해서 토큰을 갱신하는데, 키가 비어있으니 인증이 실패합니다.
토큰이 갱신되지 않으면 모든 ECR 이미지 풀이 중단됩니다.

**두 번째 연쇄**: ExternalSecret 전면 불능 — `ClusterSecretStore InvalidProviderConfig → ESO 전체 불능 → grafana-admin-secret 미생성`으로 이어졌습니다.

ClusterSecretStore도 같은 AWS 자격증명을 사용합니다.
ESO가 동작하지 않으니 Grafana admin secret 등 모든 ExternalSecret 동기화가 중단되었습니다.

---

## 🤔 원인: 큰따옴표 안에서 $ 문자가 쉘 변수로 치환된다

### 디버깅 과정

1. Secret 값 확인 → `AWS_ACCESS_KEY_ID`가 0 chars
2. IAM User 존재 확인 → Terraform으로 정상 생성됨
3. AWS 콘솔에서 Access Key 재확인 → 키 정상 존재

키 자체는 문제가 없었습니다. 그렇다면 등록 과정에서 값이 사라진 것입니다.

### 근본 원인

문제는 `kubectl create secret` 명령에서 값을 **큰따옴표**(`"`)로 감싼 것이었습니다.

```bash
# 문제의 명령어
$ kubectl create secret generic aws-ecr-creds \
    --from-literal=AWS_ACCESS_KEY_ID="AKIA...X$abc123..."
```

AWS Access Key에 `$` 문자가 포함되어 있었습니다.
Bash에서 큰따옴표 안의 `$`는 **변수 치환**이 발생합니다.

```bash
# 쉘이 해석하는 과정
"AKIA...X$abc123..."
         ^^^^^^^^
         $abc123 → 존재하지 않는 변수 → 빈 문자열로 치환
```

결과적으로 `$abc123` 이후 문자열이 모두 사라지고, `AKIA...X`까지만 저장됩니다.
더 정확히는 `$abc123`이라는 변수가 설정되어 있지 않으므로 빈 문자열로 치환되어, `$` 이후 다음 특수문자까지 전부 잘리게 됩니다.

### 큰따옴표 vs 작은따옴표

Bash에서 따옴표 동작 차이를 정리하면:

| 따옴표 | `$` 처리 | 예시 |
|--------|----------|------|
| 큰따옴표 `"..."` | 변수 치환 발생 | `"hello$world"` → `"hello"` (world 변수 없으면) |
| 작은따옴표 `'...'` | 그대로 유지 | `'hello$world'` → `"hello$world"` |

이건 Shell 기초 중의 기초인데, 실전에서 Secret 값을 다루다 보면 쉽게 놓치게 됩니다.

---

## ✅ 해결: 작은따옴표로 쉘 치환 방지

### 즉시 수정

Secret을 삭제 후 **작은따옴표**로 다시 생성했습니다:

```bash
# 기존 Secret 삭제
$ kubectl delete secret aws-ecr-creds -n goti
$ kubectl delete secret aws-ecr-creds -n argocd

# 작은따옴표로 재생성
$ kubectl create secret generic aws-ecr-creds \
    --from-literal=AWS_ACCESS_KEY_ID='AKIA...$abc123...' \
    --from-literal=AWS_SECRET_ACCESS_KEY='...' \
    --from-literal=AWS_REGION='ap-northeast-2' \
    -n goti
```

### 등록 후 검증

Secret 등록 직후 반드시 저장된 값을 확인합니다:

```bash
# 실제 저장된 값 확인
$ kubectl get secret aws-ecr-creds -n goti \
    -o jsonpath='{.data.AWS_ACCESS_KEY_ID}' | base64 -d | wc -c
```

글자 수가 원본 키와 일치하면 정상입니다.

### 복구 결과

```bash
# ECR CronJob 수동 실행
$ kubectl create job --from=cronjob/ecr-creds-sync ecr-manual -n goti

# 결과 확인
$ kubectl get pods -n goti
```

- ECR CronJob 성공 → goti, argocd 네임스페이스 ecr-creds 갱신 완료
- ClusterSecretStore 정상 복구 → ExternalSecret 동기화 정상
- 모니터링 관련 ArgoCD App 4개 전부 Synced/Healthy 복구

---

## 📚 배운 점

### 재발 방지 원칙

`kubectl create secret --from-literal` 사용 시 값에 특수문자(`$`, `!`, `` ` ``)가 포함될 가능성이 있으면 **반드시 작은따옴표**를 사용해야 합니다.

사실 더 안전한 방법은 `--from-literal` 대신 `--from-file`을 사용하는 것입니다:

```bash
# 파일에 값 저장 (쉘 해석 없음)
$ echo -n 'AKIA...$abc123...' > /tmp/access-key-id

# 파일에서 Secret 생성
$ kubectl create secret generic aws-ecr-creds \
    --from-file=AWS_ACCESS_KEY_ID=/tmp/access-key-id \
    -n goti

# 임시 파일 삭제
$ rm /tmp/access-key-id
```

### Secret 등록 후 검증 필수

Secret을 등록한 뒤에는 반드시 `kubectl get secret -o jsonpath`로 **실제 저장된 값을 검증**해야 합니다.
명령어가 성공했다고 해서 값이 정확하게 저장된 것은 아닙니다.

### 연쇄 장애의 교훈

Secret 하나가 잘못되면 클러스터 전체가 영향받을 수 있습니다.
특히 ECR 자격증명처럼 **여러 컴포넌트가 공유하는 Secret**은 한 번의 실수가 연쇄 장애로 이어집니다.

---

## 요약

| 항목 | 내용 |
|------|------|
| **문제** | `kubectl create secret`에서 `$` 문자가 쉘 변수로 치환 |
| **증상** | ECR 토큰 갱신 실패 + ExternalSecret 전면 장애 |
| **원인** | 큰따옴표 안에서 `$` 이후 값이 빈 문자열로 치환됨 |
| **해결** | 작은따옴표 사용으로 쉘 치환 방지 |
| **재발 방지** | Secret 값은 항상 작은따옴표, 등록 후 반드시 검증 |
