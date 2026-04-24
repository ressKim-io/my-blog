---
title: "EKS 노드 조인 401 Unauthorized — AmazonEKSClusterPolicy 누락이 진짜 원인이었습니다"
excerpt: "ASG 스케일다운 복원 후 10개 노드 전체가 클러스터에 조인하지 못한 장애. 네트워크·IAM 가설을 순서대로 배제하며 EKS authenticator 로그에서 AmazonEKSClusterPolicy 누락을 확정했습니다."
category: "kubernetes"
tags:
  - go-ti
  - EKS
  - AWS
  - IAM
  - ClusterPolicy
  - troubleshooting
series:
  name: "goti-eks"
  order: 3
date: "2026-04-07"
---

## 한 줄 요약

> ASG를 0으로 스케일다운한 후 복원하자 신규 노드 10개가 모두 401 Unauthorized로 조인 실패. 원인은 EKS 클러스터 역할에서 `AmazonEKSClusterPolicy`가 Terraform state 누락으로 빠진 것이었습니다.

---

## 배경

go-ti 프로젝트는 삼성·두산 두 구단의 야구 티켓팅 플랫폼을 AWS EKS(`goti-prod`, ap-northeast-2)와 GCP GKE에서 이중 운영합니다. 프로덕션 EKS 클러스터는 K8s v1.34.4, Bottlerocket OS 기반 8노드(Spot + Core 혼합)로 구성되어 있습니다.

비용 절감을 위해 ASG `desired=0`으로 스케일다운했다가 복원하는 절차를 실행했을 때, **새로 부팅된 EC2 인스턴스 10개 전체가 클러스터에 조인하지 못하는 장애**가 발생했습니다.

- 인프라: EKS 1.34, Bottlerocket 1.57.0, Managed Node Groups (core 4 + spot 6)
- Terraform 모듈: `terraform-aws-modules/eks/aws` v20.37.2
- 인증 모드: `API_AND_CONFIG_MAP`
- 이전 상태: 장애 발생 14시간 전까지 노드 10개 Running 정상

---

## 🔥 문제: 노드 10개 전체가 클러스터에 나타나지 않음

ASG `0 → 복원` 후 EC2 인스턴스 10개는 AWS 콘솔에서 Running 상태였으나, `kubectl get nodes`에는 전혀 나타나지 않았습니다.

```bash
$ kubectl get nodes
NAME                                            STATUS                        ROLES    AGE
ip-10-1-0-18.ap-northeast-2.compute.internal    NotReady,SchedulingDisabled   <none>   14h
ip-10-1-0-194.ap-northeast-2.compute.internal   NotReady,SchedulingDisabled   <none>   14h
# (14시간 전 유령 노드 10개만 남아있음 — 새 노드 0개)
```

CSR(Certificate Signing Request)도 하나도 생성되지 않았습니다.

```bash
$ kubectl get csr
No resources found
```

EKS Control Plane의 audit 로그에는 kubelet 요청이 전부 `401 Unauthorized`로 기록되었습니다.

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

`user: {}`가 비어있다는 점이 핵심입니다. 토큰 자체가 거부된 것이 아니라, **인증 단계 자체가 실패**하여 user 정보가 채워지지 못한 상태입니다.

**재현 조건**: ASG desired=0 스케일다운 → 시간 경과 → ASG desired 복원 → 새 인스턴스 부팅 → 노드 조인 실패

---

## 🤔 원인: EKS authenticator가 ec2:DescribeInstances를 호출하지 못함

### 가설 수립과 배제 과정

세 가지 가설을 순서대로 검증했습니다.

**가설 1: 네트워크/SG 문제**

확인한 항목들입니다.

- EKS endpoint: 퍼블릭+프라이빗, 0.0.0.0/0 허용 — 정상
- 클러스터 SG: self-referencing rule (worker ↔ control plane 전 프로토콜) — 정상
- NAT Gateway: available — 정상
- 라우팅 테이블: private subnet → NAT — 정상
- SSM으로 인스턴스에서 직접 EKS endpoint 요청:

```bash
$ curl -sk https://<EKS_ENDPOINT>/healthz
ok
```

API 서버에는 정상적으로 도달할 수 있었습니다. **네트워크 가설 배제**

**가설 2: IAM 역할 불일치**

확인한 항목들입니다.

- 인스턴스 프로필 `eks-ecceab14-...` → 실제 역할 `goti-prod-node-group-role` 매핑 확인
- aws-auth ConfigMap: 동일 역할 매핑 존재
- EKS Access Entry: `EC2_LINUX` 타입으로 동일 역할 등록
- IMDS에서 자격증명 발급 성공 확인

역할 이름이 일치하고, aws-auth와 Access Entry 모두 정상 등록 상태였습니다. **IAM 역할 불일치 가설 배제**

**가설 3: EKS authenticator 토큰 검증 실패**

두 번째 가설이 배제된 후, EKS 내부 인증 흐름에 주목했습니다. Terraform 설정에서 authenticator 로그가 비활성화(`enabled: false`) 상태임을 확인했습니다. `aws eks update-cluster-config`로 authenticator 로그를 활성화한 후 ASG를 재시도하자 다음 로그가 나타났습니다.

```text
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

**근본 원인을 확정했습니다.**

### 인증 실패 메커니즘

EKS 인증 흐름에서 kubelet은 STS 토큰을 포함해 API 서버에 요청합니다. API 서버는 이를 EKS authenticator webhook에 전달하고, authenticator는 Access Entry의 username 템플릿 `system:node:{{EC2PrivateDNSName}}`를 렌더링합니다.

이 렌더링 단계에서 authenticator는 **클러스터 역할**(control plane 역할)로 `ec2:DescribeInstances`를 호출하여 인스턴스 ID를 Private DNS Name으로 변환합니다. `AmazonEKSClusterPolicy`에 이 권한이 포함되어 있는데, 해당 정책이 클러스터 역할에서 빠져있어 403이 발생했습니다.

```text
kubelet → STS 토큰 → API 서버 → Authenticator webhook
  → IAM Role 매칭 ✅
  → username 템플릿 렌더링: {{EC2PrivateDNSName}}
    → 클러스터 역할로 ec2:DescribeInstances 호출
    → ❌ 403 UnauthorizedOperation (AmazonEKSClusterPolicy 없음)
  → 인증 실패 → 401 Unauthorized
```

### 왜 기존 노드는 멀쩡했는가

AmazonEKSClusterPolicy가 빠진 것은 Terraform apply 과정에서 모듈 업데이트 또는 `cluster_compute_config` 설정 변경으로 인해 발생했습니다. `terraform-aws-modules/eks/aws` v20.37.2는 auto_mode 활성화 여부에 따라 정책 세트를 조건부로 분기합니다.

```hcl
# auto_mode OFF → Standard 정책 세트 (AmazonEKSClusterPolicy 포함)
eks_standard_iam_role_policies = { ... }  # !auto_mode_enabled 조건

# auto_mode ON → Auto Mode 정책 세트
eks_auto_mode_iam_role_policies = { ... }  # auto_mode_enabled 조건
```

모듈 내부 조건 분기 과정에서 `AmazonEKSClusterPolicy` attachment가 Terraform state에서 누락되었습니다. 기존 노드들은 이미 kubelet certificate를 발급받아 운영 중이었기 때문에 인증 흐름을 거칠 필요가 없었습니다. ASG `0 → 복원` 시에는 **신규 인스턴스 전체가 처음부터 조인**해야 하므로, 정책 누락의 영향이 한꺼번에 나타났습니다.

---

## 🧭 선택지 비교: 진단 경로 선택

원인 확인 과정에서 authenticator 로그를 어떻게 확인할지가 핵심 갈림길이었습니다.

### 고려한 방법

| 방법 | 핵심 아이디어 | 한계 |
|------|---------------|------|
| A. 노드에서 kubelet 로그 직접 확인 | SSM으로 인스턴스에 접속, journalctl | Bottlerocket은 journalctl 접근이 제한적, 초기 인증 실패는 kubelet 단에서 보이지 않는 경우가 많음 |
| B. VPC Flow Logs + CloudTrail | API 호출 패턴을 네트워크 레벨에서 추적 | 인증 내부 흐름(webhook 단)까지는 보이지 않음, 분석 시간 소요 |
| C. EKS authenticator 로그 활성화 | CloudWatch에서 authenticator 컴포넌트 로그 직접 확인 | 로그 활성화 후 재현이 필요하나, ASG 재시도로 즉시 재현 가능 |

### 결정 기준과 최종 선택

**C(authenticator 로그 활성화)를 채택했습니다.**

결정 기준은 다음 우선순위입니다.

1. **인증 흐름 내부 가시성**: 401은 kubelet 로그보다 API 서버·authenticator 단에서 원인이 드러납니다
2. **즉시 재현 가능성**: ASG 재시도로 동일 상황을 즉시 재현할 수 있어 로그 활성화 후 확인이 가능했습니다
3. **진단 비용**: CloudWatch 로그 쿼리는 VPC Flow Logs 파싱보다 직접적입니다

네트워크와 IAM 역할 매핑이 정상임을 먼저 배제한 뒤, EKS 내부 컴포넌트 로그로 범위를 좁혔기 때문에 C가 가장 빠른 경로였습니다.

---

## ✅ 해결: Terraform으로 정책을 명시적으로 추가

Terraform 코드에서 세 가지를 수정했습니다(`Goti-Terraform/terraform/prod-aws/modules/eks/main.tf`).

**1. AmazonEKSClusterPolicy 명시적 추가**

모듈의 auto_mode 조건부 로직과 무관하게, 클러스터 역할에 항상 이 정책이 붙도록 명시했습니다.

```hcl
iam_role_additional_policies = {
  AmazonEKSClusterPolicy = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}
```

모듈 내부 로직에 의존하지 않고 `additional_policies`로 덮어쓰는 것이 핵심입니다. 모듈 버전이 바뀌어도 이 정책은 항상 붙어있게 됩니다.

**2. authenticator 로그 기본 활성화**

이번 장애에서 authenticator 로그가 없었기 때문에 초기 진단이 지연되었습니다. 기본 활성화로 변경했습니다.

```hcl
cluster_enabled_log_types = ["audit", "authenticator"]
```

**3. access_entries 타입 명시**

Terraform plan에서 drift가 발견된 access_entries도 정리했습니다.

```hcl
access_entries = {
  team_member_a = { type = "STANDARD", ... }  # type 명시로 drift 방지
  team_member_b = { type = "STANDARD", ... }
  node_group    = { type = "EC2_LINUX", principal_arn = var.node_group_role_arn }
}
```

### terraform plan 결과

```text
# aws_iam_role_policy_attachment.additional["AmazonEKSClusterPolicy"] will be created
# aws_iam_role_policy_attachment.this["AmazonEKSClusterPolicy"] will be created
# aws_eks_access_entry.this["node_group"] will be created
# (team_member access entries: no changes — drift 해소 확인)
```

`terraform apply` 후 ASG 복원 → 노드 정상 조인이 확인되었습니다.

---

## 📚 배운 점

**Terraform 모듈 내부 조건 분기는 신뢰하지 않습니다**

`terraform-aws-modules/eks`처럼 내부 조건으로 정책 세트를 바꾸는 모듈은, 설정 변경 한 번으로 핵심 정책이 detach될 수 있습니다. EKS 클러스터 역할처럼 운영에 필수적인 정책은 `iam_role_additional_policies`로 명시적으로 추가해 모듈 로직과 독립시켜야 합니다

**모든 노드가 동시에 조인하는 시나리오에서만 증상이 드러납니다**

기존 노드가 정상 운영 중일 때는 잠재적 정책 누락이 보이지 않습니다. ASG `0 → 복원`처럼 전체 신규 조인이 발생할 때 비로소 장애가 터집니다. 비용 절감을 위한 스케일다운 절차가 있다면, **복원 후 노드 조인 확인 절차**(`kubectl get nodes --watch`)를 운영 체크리스트에 넣어야 합니다

**authenticator 로그는 기본 활성화해야 합니다**

401의 진짜 원인이 네트워크인지, IAM인지, 내부 webhook인지는 authenticator 로그 없이는 구분하기 어렵습니다. 비용 대비 디버깅 가치가 훨씬 큽니다

**Terraform 모듈 업데이트 시 IAM 정책 detach를 반드시 확인합니다**

EKS 모듈을 업데이트하거나 `cluster_compute_config` 같은 주요 설정을 변경할 때, `terraform plan` 출력에서 `aws_iam_role_policy_attachment`의 destroy 항목을 반드시 확인해야 합니다

**재발 방지 체크리스트**

| 항목 | 조치 |
|------|------|
| `AmazonEKSClusterPolicy` | `iam_role_additional_policies`로 명시적 추가 — 모듈 내부 로직 의존 금지 |
| authenticator 로그 | `cluster_enabled_log_types`에 `authenticator` 기본 포함 |
| ASG 스케일다운 복원 | 복원 후 `kubectl get nodes --watch`로 조인 확인 |
| EKS 모듈 업데이트 | `terraform plan`에서 IAM 정책 detach 항목 체크 |

이 장애는 Terraform state에서 정책이 조용히 빠져나갔고, 평상시에는 기존 노드가 버텨주기 때문에 전혀 보이지 않다가, 전체 재조인 시나리오에서 한꺼번에 터진 전형적인 잠복 장애 패턴이었습니다
