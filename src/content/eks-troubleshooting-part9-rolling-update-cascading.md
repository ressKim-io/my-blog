---
title: "EKS Rolling Update 연쇄 장애: SG 삭제부터 IP 소진 데드락까지"
excerpt: "VPC CNI max-pods 불일치를 고치려다 4건의 연쇄 장애를 만난 기록"
category: kubernetes
tags:
  - EKS
  - Troubleshooting
  - VPC-CNI
  - Terraform
  - Rolling-Update
  - Security-Group
  - IP-Exhaustion
series:
  name: "eks-troubleshooting"
  order: 9
date: '2026-04-01'
---

## 🎯 한 줄 요약

> VPC CNI max-pods 불일치를 고치려고 Rolling Update를 실행했더니, Terraform SG 삭제 → 서브넷 IP 소진 데드락 → Kyverno 차단 → Prometheus OOM까지 4건이 연쇄로 터졌다.

## 📊 Impact

- **영향 범위**: 전체 서비스 접근 불가 (15/15 서비스)
- **소요 시간**: 약 6시간
- **발생일**: 2026-04-01

---

## 🤔 발단: VPC CNI max-pods 불일치

### 증상

observer pod를 재시작하거나 임시 psql pod를 생성할 때마다 IP 할당이 실패했습니다.

```
Warning  FailedCreatePodSandBox  kubelet  Failed to create pod sandbox:
  plugin type="aws-cni" name="aws-cni" failed (add):
  add cmd: failed to assign an IP address to container
```

Pod이 `Init:0/2` 상태에서 멈추고, IP는 `<none>`이에요.
이상한 점은 10개 노드(t3.large) 중 대부분이 여유 있는데도 발생한다는 거였습니다.

특히 `ap-northeast-2c` 존 노드에서 집중적으로 발생했어요.
해당 노드의 pod 수는 9~11개 — 한계치 35의 1/3 수준이었습니다.

### 원인: Prefix Delegation은 켰는데 max-pods는 35

VPC CNI 설정을 확인해봤습니다.

```bash
$ kubectl get ds aws-node -n kube-system -o jsonpath='{.spec.template.spec.containers[0].env}' | jq '.[] | select(.name | test("PREFIX|WARM"))'
```

`ENABLE_PREFIX_DELEGATION=true`가 이미 활성화되어 있었어요.
t3.large + prefix delegation이면 **110 pods**까지 가능해야 합니다.

그런데 노드의 capacity를 보면:

```bash
$ kubectl get node ip-10-1-2-107.ap-northeast-2.compute.internal -o jsonpath='{.status.capacity.pods}'
35
```

**35개?** Prefix delegation이 활성화되어 있는데 왜 35인 거지?

문제는 **Bottlerocket AMI**였습니다.

일반 Amazon Linux 2 AMI는 VPC CNI가 max-pods를 자동 계산하지만, Bottlerocket은 kubelet의 `max-pods` 설정을 **별도로 지정**해야 합니다. Launch template에 user_data가 없어서 Bottlerocket 기본값 35(secondary IP 모드 기준)가 적용되고 있었어요.

이 불일치가 만든 상황을 정리하면:

```
{/* TODO: Draw.io로 교체 */}

┌─────────────────────────────────────────────────────────┐
│                    VPC CNI Layer                         │
│  ENABLE_PREFIX_DELEGATION=true                          │
│  → /28 prefix 할당 → 노드당 최대 110 IP 확보 가능       │
└──────────────────────┬──────────────────────────────────┘
                       │ IP는 충분
                       ▼
┌─────────────────────────────────────────────────────────┐
│                  Kubelet Layer                           │
│  max-pods=35 (Bottlerocket 기본값)                      │
│  → 35개 초과 pod 스케줄 거부!                            │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│                    결과                                  │
│  - IP는 남는데 pod이 더 올라가지 않음                    │
│  - rollout restart 시 기존+새 pod 동시 존재로 IP 2배 →  │
│    /24 서브넷 IP까지 소진                                │
└─────────────────────────────────────────────────────────┘
```

**핵심**: VPC CNI는 IP를 넉넉히 확보하려고 /28 prefix를 warm pool로 잡아두는데, kubelet은 35개밖에 못 쓰니까 IP만 낭비하는 구조였습니다.

### 수정: Bottlerocket TOML 템플릿

Bottlerocket은 일반적인 bootstrap args가 아니라 **TOML 형식의 user_data**로 설정을 주입합니다.

```hcl
# bottlerocket.toml.tpl
[settings.kubernetes]
max-pods = ${max_pods}
```

Launch template에 이 TOML을 base64로 인코딩해서 주입:

```hcl
# modules/compute/main.tf
resource "aws_launch_template" "this" {
  user_data = base64encode(templatefile(
    "${path.module}/bottlerocket.toml.tpl",
    { max_pods = var.max_pods }
  ))
}
```

core/spot 노드 그룹 모두에 `max_pods = 110` 적용 후 `terraform apply`.

이 변경은 launch template 버전을 올리기 때문에 **managed node group의 Rolling Update**가 트리거됩니다.
노드가 하나씩 교체되면서 새 설정이 적용되는 방식이에요.

여기까지는 괜찮았습니다. 문제는 이 Rolling Update 과정에서 터졌어요.

---

## 🔥 연쇄 장애 1: RDS/ElastiCache Security Group ingress 삭제

### 증상

Rolling Update가 시작되자마자 모든 서비스에서 DB 연결 에러가 터졌습니다.

```
SocketTimeoutException: Read timed out
  at org.postgresql.core.v3.ConnectionFactoryImpl.enableSSL
```

RDS와 ElastiCache 모두 연결이 끊겼어요. 뭐지?

### 원인: Terraform inline ingress와 별도 rule의 충돌

`terraform apply`를 두 단계로 나눠서 실행했는데, 이게 문제였습니다.

1단계로 `-target=module.config`만 먼저 apply했을 때, Terraform이 SG의 **inline ingress**를 기준으로 상태를 정리했습니다.
2단계 full apply에서는 별도로 관리하던 `aws_security_group_rule` 리소스를 destroy하면서 — **AWS에서 실제 규칙이 삭제**되어 버렸어요.

문제의 구조를 보면:

```hcl
# Before — 이중 관리 상태 (위험!)

resource "aws_security_group" "rds" {
  # inline ingress (방법 1)
  ingress {
    from_port       = 5432
    to_port         = 5432
    security_groups = [var.eks_primary_sg_id]
  }
}

resource "aws_security_group_rule" "rds_from_eks" {
  # 별도 rule (방법 2) — 같은 규칙을 또 관리!
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  source_security_group_id = var.eks_primary_sg_id
  security_group_id        = aws_security_group.rds.id
}
```

같은 SG 규칙을 **두 곳에서 관리**하면, Terraform은 한쪽을 삭제할 때 다른 쪽이 살아있으니 괜찮다고 판단하지 않습니다.
별도 `aws_security_group_rule`을 destroy하면 **AWS API에서 해당 규칙 자체를 삭제**해요.

결과적으로 EKS cluster primary SG에서 RDS/ElastiCache로의 인바운드 규칙이 사라졌습니다.

### 복구

수동으로 SG 규칙을 다시 추가했습니다:

```bash
# RDS SG에 EKS primary SG로부터의 5432 인바운드 허용
$ aws ec2 authorize-security-group-ingress \
    --group-id sg-0d0dde54608adeaed \
    --protocol tcp --port 5432 \
    --source-group sg-0a7b4cec82230ff01

# ElastiCache SG에 EKS primary SG로부터의 6379 인바운드 허용
$ aws ec2 authorize-security-group-ingress \
    --group-id sg-07963da9ecd595ffc \
    --protocol tcp --port 6379 \
    --source-group sg-0a7b4cec82230ff01
```

### 근본 수정

Terraform에서 inline ingress를 완전히 제거하고 별도 `aws_security_group_rule`로 통일했습니다:

```hcl
# After — 별도 rule로 분리

resource "aws_security_group" "this" {
  # inline ingress 없음
  lifecycle { ignore_changes = [ingress] }
}

resource "aws_security_group_rule" "from_node_group" { ... }
resource "aws_security_group_rule" "from_eks_primary" { ... }
```

기존 AWS에 이미 존재하는 규칙을 Terraform state에 연결하기 위해 4건의 `terraform import`를 실행했습니다:

```bash
$ terraform import module.rds.aws_security_group_rule.from_node_group ...
$ terraform import module.rds.aws_security_group_rule.from_eks_primary ...
$ terraform import module.elasticache.aws_security_group_rule.from_node_group ...
$ terraform import module.elasticache.aws_security_group_rule.from_eks_primary ...
```

**교훈**: Terraform에서 Security Group 규칙은 반드시 **한 가지 방법**으로만 관리해야 한다. inline ingress와 `aws_security_group_rule`을 혼용하면 destroy 시 실제 규칙이 삭제될 수 있다.

---

## 🔥 연쇄 장애 2: VPC 서브넷 IP 소진 데드락

### 증상

SG 문제를 복구한 뒤에도 pod들이 계속 `FailedCreatePodSandBox` 상태였습니다.

```
FailedCreatePodSandBox: plugin type="aws-cni" failed (add):
  failed to assign an IP address to container
```

이번에는 SG가 아니라 **IP 자체가 없는** 상황이에요.

### 원인: /24 서브넷에서 18개 노드의 IP 예약 폭발

Rolling Update 중에는 기존 노드와 신규 노드가 **동시에 존재**합니다.

| 구분 | 노드 수 |
|------|---------|
| 기존 노드 (max-pods=35) | 10대 |
| 신규 노드 (max-pods=110) | 8대 |
| **합계** | **18대** |

문제는 VPC CNI의 `WARM_PREFIX_TARGET=1` 설정이에요.
이 설정은 "항상 /28 prefix 1개를 여유분으로 확보해둬라"는 뜻입니다.

각 노드의 IP 예약량을 계산해보면:

| 항목 | 값 |
|------|-----|
| ENI 수 (t3.large) | 3개 |
| ENI당 할당된 /28 prefix | 1개 (사용 중) + 1개 (warm) = ~2개 |
| /28 prefix당 IP | 16개 |
| **노드당 예약 IP** | **~48개** |
| 동시 노드 수 | 18대 |
| **총 IP 요구량** | **~864개** |

그런데 private 서브넷은 `/24` — **254개 IP**밖에 없습니다.

864 > 254. 완전히 초과했어요.

이게 **데드락**을 만들었습니다:

```
{/* TODO: Draw.io로 교체 */}

┌──────────────────────────────────┐
│        신규 노드 8대              │
│   IP 할당 실패 → Pod 생성 불가   │◄─────┐
│   → 기존 노드 drain 불가         │      │
└──────────────┬───────────────────┘      │
               │ drain 불가 =             │
               │ IP 반환 안 됨            │
               ▼                          │
┌──────────────────────────────────┐      │
│        기존 노드 10대             │      │
│   drain 대기 중                  │      │
│   → IP를 계속 점유               │──────┘
│   → 서브넷 IP 고갈 유지          │ IP 고갈
└──────────────────────────────────┘

신규 노드에 IP가 없어서 Pod을 못 올리고,
기존 노드는 Pod이 신규로 이동해야 drain되는데,
신규 노드에 Pod을 못 올리니 drain도 안 된다.
→ 무한 루프
```

### 복구

3단계로 데드락을 풀었습니다.

**1단계: IP 예약량 줄이기**

```bash
# WARM_PREFIX_TARGET 제거 (노드당 ~48 IP → ~3 IP로 감소)
$ kubectl set env daemonset aws-node -n kube-system WARM_PREFIX_TARGET-
$ kubectl set env daemonset aws-node -n kube-system WARM_IP_TARGET=2
$ kubectl set env daemonset aws-node -n kube-system MINIMUM_IP_TARGET=2
```

노드당 IP 예약이 48개에서 2~3개로 급감 — 일부 IP가 확보되었습니다.

**2단계: 서비스 축소로 IP 압박 해소**

```bash
# goti 서비스 전체 replica=0으로 축소
$ kubectl scale deploy --all -n goti --replicas=0
```

**3단계: 기존 노드 수동 종료**

기존 core 노드 3대를 수동으로 EC2 종료했습니다.
ASG가 자동으로 새 노드(max-pods=110)를 생성하면서 교체가 완료되었어요.

```bash
$ aws ec2 terminate-instances --instance-ids \
    i-0a71269eac37900d5 \
    i-0bcc2ca083000645d \
    i-00280d2f0a6688aee
```

**교훈**: `/24` 서브넷(254 IP)에서 prefix delegation을 사용하면, Rolling Update 중 노드 수가 2배로 뛸 때 IP가 터진다. 서브넷을 `/20` 이상으로 확장하거나, `WARM_IP_TARGET`을 사전에 낮춰야 한다.

---

## 🔥 연쇄 장애 3: Kyverno Webhook 차단

SG 복구하고 IP 데드락도 풀었더니, 이번에는 core 노드 그룹의 Rolling Update가 막혔습니다.

```
Error: ClusterUnreachable: The requested managed node group operation
  was blocked by a Kubernetes webhook configuration
```

Kyverno admission webhook이 EKS managed node group의 노드 교체 과정에서 **pod 생성을 차단**한 거예요.
spot 노드 그룹은 이미 완료되었는데, core 노드 그룹에서만 발생했습니다.

복구는 기존 core 노드 EC2를 수동 종료하는 방식으로 우회했습니다.
ASG가 새 노드(max-pods=110)를 자동 생성하면서 결과적으로 교체가 이루어졌어요.

---

## 🔥 연쇄 장애 4: Prometheus OOMKilled

마지막으로 Prometheus가 죽었습니다.

```
reason: OOMKilled (exit code 137)
memory limit: 1Gi
```

Rolling Update 동안 노드가 오르락내리락하면서 **WAL(Write-Ahead Log)이 대량 축적**되었어요.
Prometheus가 재시작될 때 이 WAL을 replay하면서 동시에 Mimir로 remote write를 시도하니까 메모리 1Gi를 초과한 겁니다.

추가로 OTel Collector에서 보낸 `otelcol.k8s.pod.association_total` 메트릭명에 `.`이 포함되어 있어서 Mimir에서 400 Bad Request가 발생하는 것도 발견했습니다.

서비스가 정상화된 후 WAL 크기가 자연스럽게 줄어들면서 복구되었습니다.

---

## ⏱️ 전체 타임라인

| 단계 | 액션 | 결과 |
|------|------|------|
| 1 | `terraform apply -target=module.config` | SSM + SG inline 통합 apply |
| 2 | `terraform apply` (full) | launch template 변경 + **SG rule destroy → RDS SG 삭제** |
| 3 | Rolling Update 시작 | 신규 노드 8대 생성, IP 소진 시작 |
| 4 | 서비스 장애 발생 | goti pod 전체 Init stuck / CrashLoopBackOff |
| 5 | `WARM_IP_TARGET=2` 적용 | 일부 IP 확보 |
| 6 | goti 서비스 replica=0 축소 | IP 압박 완화 |
| 7 | Alertmanager silence 설정 | 알람 폭주 방지 |
| 8 | SG 원인 발견 | `aws ec2 authorize-security-group-ingress`로 수동 복구 |
| 9 | 기존 core 노드 3대 수동 EC2 종료 | ASG 자동 교체 |
| 10 | goti 서비스 replica=1 복원 | 14/15 서비스 정상 복구 |
| 11 | payment-sungjeon `QUEUE_TOKEN_SECRET_KEY` 31→32바이트 수정 | 15/15 완료 |

---

## ✅ 재발 방지

### Terraform Security Group 관리

**inline ingress 사용 금지**. 항상 `aws_security_group_rule` 별도 리소스로 관리합니다.
같은 규칙을 두 곳에서 관리하면 destroy 시 실제 AWS 규칙이 삭제될 수 있어요.

### VPC CNI + max-pods 설정

1. **Prefix delegation 사용 시 반드시 kubelet max-pods도 함께 설정**: Bottlerocket은 TOML user_data, Amazon Linux 2는 bootstrap args
2. **`/24` 서브넷에서는 `WARM_IP_TARGET=2`**: prefix delegation의 warm pool이 서브넷을 잡아먹지 않도록
3. **서브넷 CIDR 확장 검토**: `/24`(254 IP) → `/20`(4,094 IP) 이상, 또는 secondary CIDR 추가

### Rolling Update 사전 점검 체크리스트

Rolling Update 실행 전에 이것들을 확인해야 합니다:

- [ ] 서브넷 가용 IP 수 확인 (노드 2배 × 노드당 예약 IP)
- [ ] Security Group 규칙 관리 방식 확인 (inline vs 별도 rule 혼용 여부)
- [ ] Kyverno webhook `failurePolicy` 확인 (`Ignore`로 변경 검토)
- [ ] Prometheus memory limit 여유 확인 (WAL replay 대비)
- [ ] replica=1 서비스에 PDB 설정 (`maxUnavailable: 0`)

---

## 📚 핵심 포인트

이 장애에서 배운 3가지를 정리합니다.

**첫째, "한 가지만 바꾸는" 변경은 없다.**
max-pods를 35에서 110으로 올리는 단순한 변경이 launch template을 바꾸고, Rolling Update를 트리거하고, 그 과정에서 Terraform state 불일치, 서브넷 용량, webhook, 모니터링까지 건드렸습니다.

**둘째, 서브넷 설계는 Day 1에 결정해야 한다.**
`/24`는 개발 환경에선 충분하지만, prefix delegation + Rolling Update가 만나면 순식간에 바닥납니다.
프로덕션 서브넷은 최소 `/20` 이상으로 잡는 게 안전해요.

**셋째, Terraform은 "선언적"이지만 "안전"하진 않다.**
inline ingress와 별도 rule을 혼용하면 Terraform이 한쪽을 삭제할 때 실제 AWS 규칙도 사라집니다.
리소스 관리 방식을 반드시 하나로 통일해야 합니다.
