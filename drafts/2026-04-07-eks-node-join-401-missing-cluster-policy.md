---
date: 2026-04-07
category: troubleshoot
project: Goti-Terraform / EKS prod
tags: [eks, iam, authenticator, bottlerocket, terraform, node-join, 401]
---

# EKS 노드 조인 401 Unauthorized — AmazonEKSClusterPolicy 누락

## Context

EKS prod 클러스터 (`goti-prod`, K8s 1.34, Bottlerocket 1.57.0) 비용 절감을 위해 ASG desired=0으로 스케일다운 후, 다시 복원했을 때 **모든 노드(10개)가 클러스터에 조인하지 못하는 장애** 발생.

- 인프라: EKS 1.34, Bottlerocket OS 1.57.0, Managed Node Groups (core 4 + spot 6)
- Terraform: `terraform-aws-modules/eks/aws` v20.37.2
- 인증 모드: `API_AND_CONFIG_MAP`
- 이전 상태: 정상 운영 중 (14시간 전까지 노드 10개 Running)

## Issue

ASG 0→복원 후 새 EC2 인스턴스 10개가 Running이지만 `kubectl get nodes`에 나타나지 않음.

```
# kubectl 출력 — 옛 유령 노드만 남아있고 새 노드 0개
NAME                                            STATUS                        ROLES    AGE
ip-10-1-0-18.ap-northeast-2.compute.internal    NotReady,SchedulingDisabled   <none>   14h
ip-10-1-0-194.ap-northeast-2.compute.internal   NotReady,SchedulingDisabled   <none>   14h
(... 10개 전부 NotReady,SchedulingDisabled)

# CSR도 0개
kubectl get csr → No resources found
```

**EKS control plane audit 로그:**
```json
{
  "user": {},
  "responseStatus": {
    "status": "Failure",
    "message": "Unauthorized",
    "reason": "Unauthorized",
    "code": 401
  },
  "sourceIPs": ["10.1.1.134"],
  "userAgent": "kubelet/v1.34.4 (linux/amd64) kubernetes/e639254"
}
```

모든 kubelet 요청이 `401 Unauthorized`, `user: {}` (빈 user — 인증 자체 실패).

**재현 조건:** ASG desired=0으로 스케일다운 → 시간 경과 → ASG desired 복원 → 새 인스턴스 부팅 → 노드 조인 실패

## Action

### 진단 과정

**가설 1: 네트워크/SG 문제 → 배제**
- EKS endpoint: 퍼블릭+프라이빗, 0.0.0.0/0 허용
- 클러스터 SG: self-referencing rule (worker ↔ control plane 모든 프로토콜)
- NAT Gateway: available
- 라우팅 테이블: 정상 (private subnet → NAT)
- SSM으로 인스턴스에서 `curl -sk https://EKS_ENDPOINT/healthz` → `ok` 반환
- **결론: API 서버 도달 가능. 네트워크 아님.**

**가설 2: IAM 역할 불일치 → 배제**
- 인스턴스 프로필 `eks-ecceab14-...` → 실제 역할 `goti-prod-node-group-role` 확인
- aws-auth ConfigMap: 동일 역할 매핑 존재
- EKS Access Entry: `EC2_LINUX` 타입으로 동일 역할 등록
- IMDS에서 자격증명 발급 성공 확인
- **결론: IAM 역할 매칭 정상.**

**가설 3: EKS authenticator가 토큰 검증 실패 → 확인 필요**
- authenticator 로그가 **비활성화** 상태 (`enabled: false`)
- `aws eks update-cluster-config`로 authenticator 로그 활성화
- ASG 재시도 후 authenticator 로그 확인:

```
level=info msg="Calling ec2:DescribeInstances for the InstanceId = i-0afd2d724ffcaca4a"

level=warning msg="access denied"
error="mapper DynamicFile renderTemplates error:
  error rendering username template \"system:node:{{EC2PrivateDNSName}}\":
  failed querying private DNS from EC2 API for node i-0afd2d724ffcaca4a:
  operation error EC2: DescribeInstances, StatusCode: 403,
  api error UnauthorizedOperation:
  User: arn:aws:sts::707925622666:assumed-role/goti-prod-cluster-.../aws-go-sdk-...
  is not authorized to perform: ec2:DescribeInstances
  because no identity-based policy allows the ec2:DescribeInstances action"
```

**결론: 근본 원인 확정.**

### 근본 원인 (Root Cause)

**EKS 클러스터 역할에 `AmazonEKSClusterPolicy` AWS 관리형 정책이 빠져있었다.**

EKS 인증 흐름에서 access entry의 username 템플릿 `system:node:{{EC2PrivateDNSName}}`를 렌더링할 때, EKS authenticator는 **클러스터 역할**로 `ec2:DescribeInstances`를 호출하여 인스턴스 ID → Private DNS Name을 변환한다. 이 권한이 `AmazonEKSClusterPolicy`에 포함되어 있는데, 이 정책이 빠져서 403 → username 렌더링 실패 → 인증 실패 → 401.

**정상 인증 흐름:**
```
kubelet → STS 토큰 → API 서버 → Authenticator webhook
  → IAM Role 매칭 ✅
  → username 템플릿 렌더링: {{EC2PrivateDNSName}}
    → 클러스터 역할로 ec2:DescribeInstances 호출
    → ❌ 403 UnauthorizedOperation (AmazonEKSClusterPolicy 없음)
  → 인증 실패 → 401 Unauthorized
```

**왜 빠졌는가:**

`terraform-aws-modules/eks/aws` v20.37.2 모듈의 조건부 로직:

```hcl
# auto_mode OFF → Standard 정책 (AmazonEKSClusterPolicy 포함)
eks_standard_iam_role_policies = { ... } if !auto_mode_enabled

# auto_mode ON → Auto Mode 정책 세트
eks_auto_mode_iam_role_policies = { ... } if auto_mode_enabled
```

Terraform apply 과정에서 모듈 업데이트 또는 `cluster_compute_config` 설정 변경으로 인해 `AmazonEKSClusterPolicy` attachment가 Terraform state에서 누락됨. 기존 노드는 이미 certificate를 발급받은 상태라 영향 없었으나, ASG 0→복원 시 **모든 노드가 신규 조인**해야 하므로 전체 장애 발생.

### 적용한 수정

**Terraform 코드 수정** (`Goti-Terraform/terraform/prod-aws/modules/eks/main.tf`):

1. **AmazonEKSClusterPolicy 명시적 추가** — 모듈의 auto_mode 조건과 무관하게 항상 보장
```hcl
iam_role_additional_policies = {
  AmazonEKSClusterPolicy = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}
```

2. **authenticator 로그 활성화** — 인증 실패 디버깅 필수
```hcl
cluster_enabled_log_types = ["audit", "authenticator"]
```

3. **access_entries 정리** — plan drift 해소
```hcl
access_entries = {
  cloud_mj   = { type = "STANDARD", ... }   # type 명시로 drift 방지
  cloud_hj   = { type = "STANDARD", ... }
  node_group = { type = "EC2_LINUX", principal_arn = var.node_group_role_arn }
}
```

## Result

`terraform plan` 결과:
- `aws_iam_role_policy_attachment.additional["AmazonEKSClusterPolicy"]` → **create**
- `aws_iam_role_policy_attachment.this["AmazonEKSClusterPolicy"]` → **create**
- `aws_eks_access_entry.this["node_group"]` → **create**
- cloud_mj/cloud_hj access entry 변경 없음 (drift 해소 확인)

**`terraform apply` 후 ASG 복원 → 노드 정상 조인 예정** (apply 대기 중)

### 재발 방지책

| 항목 | 조치 |
|------|------|
| `AmazonEKSClusterPolicy` | `iam_role_additional_policies`로 명시적 추가 — 모듈 내부 로직에 의존하지 않음 |
| authenticator 로그 | 기본 활성화 — 인증 실패 시 즉시 원인 확인 가능 |
| ASG 0 스케일다운 | 복원 후 노드 조인 확인 절차 필요 — `kubectl get nodes --watch` |
| Terraform 모듈 업데이트 | EKS 모듈 업데이트 시 `terraform plan`에서 IAM 정책 detach 여부 반드시 확인 |

## Related Files

- `Goti-Terraform/terraform/prod-aws/modules/eks/main.tf` — EKS 모듈 설정 (수정)
- `.terraform/modules/eks.eks/main.tf:444-467` — 모듈 내부 auto_mode 조건부 정책 로직 (원인)
