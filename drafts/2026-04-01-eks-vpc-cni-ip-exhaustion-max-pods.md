---
date: 2026-04-01
category: troubleshoot
project: Goti-Terraform (EKS)
tags: [eks, vpc-cni, ip-exhaustion, prefix-delegation, max-pods, bottlerocket, rolling-update]
---

# EKS VPC CNI IP 할당 실패 — max-pods=35 고정으로 prefix delegation 무효화

## Context
observer pod 재시작, 임시 psql pod 생성 시 반복적으로 IP 할당 실패.
pod가 `Init:0/2` 상태에서 stuck, IP `<none>`.
10개 노드(t3.large) 중 대부분 여유 있음에도 발생.

## Issue

```
Warning  FailedCreatePodSandBox  kubelet  Failed to create pod sandbox: plugin type="aws-cni" name="aws-cni" failed (add): add cmd: failed to assign an IP address to container
```

- ap-northeast-2c 존 노드에서 집중 발생 (ip-10-1-2-107, ip-10-1-2-35)
- 해당 노드 pod 수: 9~11개 (한계 35의 1/3 수준)
- rollout restart 시 기존 pod + 새 pod 동시 존재로 IP 2배 필요 → 실패

## Action

1. VPC CNI 설정 확인 → `ENABLE_PREFIX_DELEGATION=true` 이미 활성화
2. 노드 capacity 확인 → `capacity.pods=35`, `allocatable.pods=35`
3. t3.large + prefix delegation이면 **110 pods** 가능해야 하는데 35로 고정
4. 노드 그룹 확인 → **Bottlerocket AMI** 사용, launch template에 user_data 없음

**Root Cause**: 
- `ENABLE_PREFIX_DELEGATION=true`가 VPC CNI에 설정되어 있지만
- Bottlerocket의 kubelet `max-pods`가 기본값 35(secondary IP 모드 기준)로 설정됨
- prefix delegation으로 IP는 충분하지만 kubelet이 35개 이상 pod 스케줄을 거부
- 결과: 서브넷에서 /28 prefix를 warm pool로 확보해도 kubelet 제한에 걸려 pod 수용 불가
- 특히 2c 존 서브넷의 가용 IP가 적어 /28 prefix 할당 자체도 실패하는 복합 원인

**수정**:
- Bottlerocket TOML 설정 템플릿 생성 (`bottlerocket.toml.tpl`)
- launch template에 `user_data`로 `max-pods=110` 주입
- core/spot 노드 그룹 모두 적용
- `terraform apply` → rolling update (`max_unavailable=1`)

## Result
- terraform plan 확인: launch template version 변경 + node group update-in-place
- rolling update 진행 중 (노드 하나씩 교체)
- 교체 완료 후 노드당 110 pods 수용 가능

잠재 리스크:
- Rolling 중 replica=1 서비스 순간 503 (PDB 미설정)
- StatefulSet PVC가 다른 AZ 노드로 이동 불가 시 Pending
- 2c 서브넷 CIDR 자체가 작으면 prefix 할당 실패 지속 가능

재발 방지:
- prefix delegation 사용 시 반드시 kubelet max-pods도 함께 설정
- Bottlerocket은 bootstrap args가 아닌 TOML user_data로 설정 필요
- 향후 Karpenter NodePool에도 동일 설정 적용 필요

## Related Files
- `Goti-Terraform/terraform/prod-aws/modules/compute/main.tf`
- `Goti-Terraform/terraform/prod-aws/modules/compute/variables.tf`
- `Goti-Terraform/terraform/prod-aws/modules/compute/bottlerocket.toml.tpl` (신규)
