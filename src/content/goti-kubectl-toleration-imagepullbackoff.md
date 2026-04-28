---
title: "kubectl patch가 만든 GitOps drift — 전 서비스 ImagePullBackOff"
excerpt: "kubectl로 toleration을 직접 추가했더니 GitOps drift가 발생하고, ECR credential 만료 타이밍과 겹쳐 5개 서비스가 4시간 동안 ImagePullBackOff에 빠졌다"
category: kubernetes
tags:
  - go-ti
  - GitOps
  - ArgoCD
  - kubectl
  - ECR
  - ImagePullBackOff
  - Troubleshooting
date: "2026-02-25"
---

## 한 줄 요약

> prod용 spot toleration을 dev에도 kubectl로 직접 추가했더니, rolling update가 트리거되면서 ECR credential 만료 타이밍에 걸렸다. 5개 서비스가 4시간 동안 ImagePullBackOff.

## Impact

- **영향 범위**: goti-user, goti-payment, goti-resale, goti-stadium, goti-ticketing (5개 전체)
- **증상**: 새 Pod ImagePullBackOff, ArgoCD OutOfSync + Degraded
- **다운타임**: 기존 Pod가 서비스 유지했으나 4시간 동안 새 배포 불가
- **발생일**: 2026-03-22

---

## 🔥 증상: 모든 서비스에서 ImagePullBackOff

모든 goti 서비스에서 새 Pod가 `ImagePullBackOff` 상태로 복구되지 않았습니다.

```
failed to resolve reference:
unexpected status from HEAD request to
https://707925622666.dkr.ecr.ap-northeast-2.amazonaws.com/v2/goti-user/manifests/dev-36-033f89e:
403 Forbidden
```

ArgoCD는 5개 서비스 모두 **OutOfSync + Degraded** 상태.
기존 ReplicaSet의 Running Pod 2개씩은 정상이었지만, 새 ReplicaSet의 Pod가 올라오지 않았습니다.

---

## 🤔 진단 과정

### 가설 1: ECR credential 만료

```bash
$ kubectl get secret ecr-creds -n goti -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d | wc -c
2464  # 정상 길이
```

CronJob도 87분 전에 성공적으로 갱신됐습니다.
수동 test Pod로 pull 테스트 → **성공**. credential 자체는 유효합니다.

### 가설 2: 이미지 태그 미존재

```bash
$ aws ecr describe-images --repository-name goti-user --image-ids imageTag=dev-36-033f89e
# 존재 확인, 마지막 pull: 2026-03-22T00:18:37
```

이미지도 문제 없습니다.

### 가설 3: Running Pod와 BackOff Pod의 차이

ReplicaSet template을 diff해봤더니 **toleration 추가가 유일한 차이**였습니다.

```yaml
tolerations:
  - effect: NoSchedule
    key: node-role
    value: spot
```

### 가설 4: Git 소스에 toleration 존재 여부

Helm values, chart template, 레포 전체를 grep했는데 **소스에 없었습니다**.
kubectl로 직접 추가된 거였습니다.

---

## 🤔 근본 원인: kubectl drift + ECR 타이밍 충돌

prod 작업(spot 노드 toleration) 중에 dev 클러스터에도 kubectl로 toleration을 직접 추가했습니다.

이것이 연쇄 장애를 만든 과정을 따라가보겠습니다.

1. `kubectl patch`로 5개 deployment의 `spec.template.spec.tolerations` 변경
2. template이 바뀌면 Kubernetes가 **새 ReplicaSet을 생성**하고 rolling update 시작
3. 새 Pod가 생성되는 시점에 ECR credential이 만료 상태이거나 kubelet 캐시 미스
4. 403 Forbidden → **exponential backoff** 진입
5. CronJob이 credential을 갱신해도, kubelet의 backoff timer가 이미 수십 분 단위
6. 4시간 동안 자동 복구 안 됨

핵심은 **kubectl 직접 수정이 불필요한 rolling update를 트리거**했다는 것입니다.
Git 소스에 없는 변경이라 ArgoCD는 이걸 drift로 감지하고, 상태가 OutOfSync로 바뀝니다.

---

## ✅ 해결

### 즉시 대응

```bash
# 5개 deployment에서 toleration 제거
kubectl patch deployment $deploy -n goti --type=json \
  -p='[{"op":"remove","path":"/spec/template/spec/tolerations"}]'
```

toleration을 제거하면 template이 원래대로 돌아가면서 BackOff Pod가 자동 정리됩니다.
기존 Running Pod(이전 RS)가 그대로 서비스를 유지했기 때문에 **서비스 다운타임은 없었습니다**.

### ArgoCD 정리

```bash
# force-sync로 잔여물 정리
argocd app sync goti-user --force
# hard refresh로 캐시 갱신
argocd app get goti-user --hard-refresh
```

---

## 📚 배운 점

### GitOps 환경에서 kubectl은 읽기 전용

kubectl 직접 수정은 "빠른 테스트"처럼 보입니다.
하지만 GitOps 환경에서는 **drift → 예측 불가능한 부작용**을 만듭니다.

이번 경우처럼 template 변경이 rolling update를 트리거하고, 그 타이밍에 ECR credential이 만료되면 전 서비스 장애가 발생합니다.

- **모든 변경**: 소스 코드 → git push → ArgoCD sync
- **kubectl**: get, describe, logs (읽기 전용)
- **긴급 장애 대응**: kubectl 사용 후 즉시 소스에 반영

### ImagePullBackOff는 exponential backoff 때문에 자동 복구가 느리다

ECR credential이 갱신돼도 kubelet의 backoff timer가 이미 수십 분 단위로 올라가 있습니다.
자동 복구를 기다리는 것보다 **Pod를 삭제하고 재생성**하는 게 가장 빠른 복구 방법입니다.

### ECR credential 타이밍

ECR 토큰은 12시간 유효하고, CronJob이 6시간마다 갱신합니다.
갱신 직전 타이밍에 새 Pod가 생성되면 pull에 실패할 수 있습니다.
이런 엣지 케이스를 줄이려면 갱신 주기를 더 짧게(4시간) 가져가거나, credential helper 방식을 검토해야 합니다.
