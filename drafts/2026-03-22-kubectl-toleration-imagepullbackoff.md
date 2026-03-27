---
date: 2026-03-22
category: troubleshoot
project: Goti-k8s
tags: [kubectl, toleration, ImagePullBackOff, ArgoCD, GitOps, ECR, drift]
---

# kubectl 직접 수정으로 전 서비스 ImagePullBackOff 장애 발생

## Context
- 환경: Kind dev 클러스터 (4 worker nodes), ArgoCD GitOps
- 서비스: goti-user, goti-payment, goti-resale, goti-stadium, goti-ticketing (5개 MSA)
- 이미지 레지스트리: AWS ECR (private), CronJob으로 6시간마다 credential 갱신
- 상황: prod 작업(spot 노드 toleration) 중 dev 클러스터에도 kubectl로 toleration을 직접 추가

## Issue
모든 goti 서비스에서 새 pod가 `ImagePullBackOff` 상태로 4시간 이상 복구되지 않음.

```
spec.containers{goti-server}: Back-off pulling image "707925622666.dkr.ecr.ap-northeast-2.amazonaws.com/goti-user:dev-36-033f89e"
Error: ImagePullBackOff

상세 메시지 (containerStatuses):
failed to resolve reference: unexpected status from HEAD request to
https://707925622666.dkr.ecr.ap-northeast-2.amazonaws.com/v2/goti-user/manifests/dev-36-033f89e: 403 Forbidden
```

- ArgoCD 상태: 5개 서비스 모두 `OutOfSync + Degraded`
- Running pod(이전 RS) 2개씩은 정상, 새 RS의 pod 1개씩이 BackOff
- ECR credential secret(`ecr-creds`)은 존재하고 유효, 수동 테스트 pod에서는 pull 성공

### 재현 경로
1. kubectl patch/edit으로 deployment의 `spec.template.spec.tolerations` 변경
2. template 변경 → 새 ReplicaSet 생성 → 새 pod 스케줄링
3. 새 pod 생성 시점에 ECR credential이 만료 상태 또는 kubelet 캐시 미스
4. 403 Forbidden → exponential backoff 진입 → credential 갱신 후에도 회복 안 됨

## Action

### 진단 과정
1. **가설 1: ECR credential 만료** → `ecr-creds` secret 확인, token length 정상(2464), CronJob 87분 전 성공적으로 갱신됨. 수동 test pod로 pull 성공 → **credential 자체는 유효**

2. **가설 2: 이미지 태그 미존재** → `aws ecr describe-images`로 확인, `dev-36-033f89e` 태그 존재, 마지막 pull `2026-03-22T00:18:37` → **이미지 문제 아님**

3. **가설 3: Running pod와 BackOff pod 차이** → ReplicaSet template diff 비교 → **tolerations 추가가 유일한 차이**
   ```yaml
   tolerations:
     - effect: NoSchedule
       key: node-role
       value: spot
   ```

4. **가설 4: Git 소스에 toleration 존재** → Helm values, chart template, 레포 전체 grep → **소스에 없음. kubectl로 직접 추가된 것**

5. **가설 5: Kyverno mutating policy** → dev 클러스터에 Kyverno 미설치 → **해당 없음**

### 근본 원인 (Root Cause)
kubectl로 모든 goti deployment에 `tolerations: [{key: node-role, value: spot, effect: NoSchedule}]`을 직접 추가.
- Git 소스(Helm chart/values)에는 이 설정 없음
- deployment template hash 변경 → 새 ReplicaSet 생성 → rolling update 시도
- 새 pod가 ECR credential 만료 타이밍에 생성되어 403 Forbidden
- exponential backoff에 빠져 credential 갱신 후에도 자동 복구 안 됨

### 적용한 수정
1. `kubectl patch`로 5개 deployment에서 toleration 제거
   ```bash
   kubectl patch deployment $deploy -n goti --type=json \
     -p='[{"op":"remove","path":"/spec/template/spec/tolerations"}]'
   ```
2. ArgoCD `force-sync` annotation으로 남은 잔여물(`force-sync` annotation) 정리
3. ArgoCD `hard refresh`로 캐시 갱신

## Result

### 수정 후 검증
- toleration 제거 즉시 BackOff pod 자동 정리 (새 RS 축소)
- 기존 Running pod(이전 RS)가 그대로 서비스 유지 → **서비스 다운타임 없음**
- 모든 pod `2/2 Running` 상태 복구
- ArgoCD Health: `Healthy` 복구 (OutOfSync는 잔여 annotation 정리 후 해소 예정)

### 재발 방지책
1. **`.claude/rules/user-approval.md`에 "kubectl 변경 금지" 섹션 추가**
   - kubectl은 읽기 전용(get, describe, logs)으로만 사용
   - 모든 변경은 소스 코드(Helm values/manifest) → git push → ArgoCD sync 경로
   - 긴급 장애 대응 시에만 예외, 즉시 소스에 반영
2. **feedback memory 업데이트** — 오늘 사고 사례를 근거로 명문화

### 교훈
- kubectl 직접 수정은 "빠른 테스트"처럼 보이지만, GitOps 환경에서는 drift → 예측 불가능한 부작용 유발
- ECR credential은 12시간 유효 + 6시간 갱신 주기라 타이밍에 따라 신규 pod pull 실패 가능
- ImagePullBackOff는 exponential backoff 때문에 credential 갱신 후에도 자동 회복이 느림 — pod 삭제/재생성이 가장 빠른 복구 방법

## Related Files
- `.claude/rules/user-approval.md` — kubectl 변경 금지 규칙 추가
