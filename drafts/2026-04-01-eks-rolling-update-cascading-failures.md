---
date: 2026-04-01
category: troubleshoot
project: Goti-Terraform, Goti-k8s (EKS prod)
tags: [eks, rolling-update, security-group, vpc-cni, ip-exhaustion, subnet-cidr, oom, terraform, inline-sg-conflict]
---

# EKS max-pods rolling update 중 연쇄 장애 — SG 삭제, IP 소진, RDS 접속 불가, OOM

## Context
goti-load-observer의 IP 할당 실패 해결을 위해 EKS 노드 max-pods를 35→110으로 변경하는 rolling update 실행.
Bottlerocket launch template에 `user_data`로 `max-pods=110` 주입 후 `terraform apply`.

## Issue

rolling update 중 4건의 연쇄 장애 발생:

### 1. RDS/ElastiCache Security Group ingress 삭제

```
SocketTimeoutException: Read timed out
  at org.postgresql.core.v3.ConnectionFactoryImpl.enableSSL
```

**원인**: Terraform이 inline ingress와 별도 `aws_security_group_rule`을 동시에 관리.
첫 apply(`-target=module.config`)에서 inline ingress로 SG 통합 → full apply에서 별도 `aws_security_group_rule` destroy 시 **AWS에서 실제 규칙이 삭제됨**.
EKS cluster primary SG(`sg-0a7b4cec82230ff01`)에서 RDS/ElastiCache로의 인바운드가 소실.

**복구**:
```bash
aws ec2 authorize-security-group-ingress --group-id sg-0d0dde54608adeaed --protocol tcp --port 5432 --source-group sg-0a7b4cec82230ff01
aws ec2 authorize-security-group-ingress --group-id sg-07963da9ecd595ffc --protocol tcp --port 6379 --source-group sg-0a7b4cec82230ff01
```

**근본 수정**: SG 리소스에서 inline ingress 제거 + `lifecycle { ignore_changes = [ingress] }` + 별도 `aws_security_group_rule`로 분리.

### 2. VPC 서브넷 IP 소진 (데드락)

```
FailedCreatePodSandBox: plugin type="aws-cni" failed (add): failed to assign an IP address to container
```

**원인**: private 서브넷이 `/24` (254 IP). rolling 중 기존 노드 10대 + 신규 노드 8대 = 18대 동시 존재.
`WARM_PREFIX_TARGET=1`로 노드당 /28(16 IP) × 3 ENI = 48 IP 예약 → 18 × 48 = 864 IP > 254 IP/서브넷.
신규 노드에서 IP 할당 불가 → 기존 노드 drain 불가 → IP 반환 안 됨 → **데드락**.

**복구**:
```bash
kubectl set env daemonset aws-node -n kube-system WARM_PREFIX_TARGET-
kubectl set env daemonset aws-node -n kube-system WARM_IP_TARGET=2
kubectl set env daemonset aws-node -n kube-system MINIMUM_IP_TARGET=2
```
노드당 IP 예약 48→2~3으로 감소 → IP 확보 → 데드락 해소.

추가로 goti 서비스 replica 0으로 축소 → IP 압박 해소 → 기존 노드 3대 수동 EC2 종료(i-0a71269eac37900d5, i-0bcc2ca083000645d, i-00280d2f0a6688aee) → ASG 자동 교체.

### 3. Kyverno webhook이 core 노드 그룹 rolling 차단

```
Error: ClusterUnreachable: The requested managed node group operation was blocked by a Kubernetes webhook configuration
```

**원인**: Kyverno admission webhook이 EKS managed node group의 노드 교체 과정에서 pod 생성을 차단.
spot 노드 그룹은 완료됐으나 core 노드 그룹은 실패.

**복구**: 기존 core 노드 EC2 수동 종료로 우회. ASG가 새 노드(110 pods) 자동 생성.

### 4. Prometheus OOMKilled

```
reason: OOMKilled (exit code 137)
memory limit: 1Gi
```

**원인**: rolling 중 WAL(Write-Ahead Log)이 대량 축적 → 재시작 시 WAL replay + Mimir remote write로 메모리 1Gi 초과.
추가로 OTel Collector에서 보낸 `otelcol.k8s.pod.association_total` (`.` 포함 메트릭명)이 Mimir에서 400 Bad Request 발생.

**복구**: 서비스 정상화 후 WAL 크기 감소 → 자연 복구 대기. 필요시 memory limit 2Gi 임시 증가.

## Action

### 타임라인
1. `terraform apply -target=module.config` — SSM + SG inline 통합 apply
2. `terraform apply` (full) — launch template 변경 + SG rule destroy → **RDS SG 삭제 발생**
3. rolling 시작 — 신규 노드 8대 생성, IP 소진 시작
4. goti pod 전체 Init stuck / CrashLoopBackOff
5. `WARM_IP_TARGET=2` 적용 → 일부 IP 확보
6. goti 서비스 replica=0 축소 → IP 압박 완화
7. Alertmanager silence 설정 (알람 폭주 방지)
8. SG 원인 발견 → `aws ec2 authorize-security-group-ingress`로 수동 복구
9. 기존 core 노드 3대 수동 EC2 종료 → ASG 교체
10. goti 서비스 replica=1 복원 → 14/15 정상 복구
11. payment-sungjeon `QUEUE_TOKEN_SECRET_KEY` 31→32바이트 수정 → 15/15 완료

### 근본 원인 (Root Cause)

1. **Terraform inline SG + 별도 SG rule 충돌** — 동일 규칙을 2곳에서 관리하면 destroy 시 실제 삭제됨
2. **/24 서브넷에서 prefix delegation** — warm pool이 서브넷 IP를 초과 예약
3. **Kyverno webhook** — EKS managed node group rolling과 충돌

### Terraform 최종 수정

**RDS/ElastiCache 모듈**: inline ingress 제거 → 별도 `aws_security_group_rule`로 분리
```hcl
resource "aws_security_group" "this" {
  # inline ingress 없음
  lifecycle { ignore_changes = [ingress] }
}

resource "aws_security_group_rule" "from_node_group" { ... }
resource "aws_security_group_rule" "from_eks_primary" { ... }
```

4건 `terraform import` 완료:
- `module.rds.aws_security_group_rule.from_node_group`
- `module.rds.aws_security_group_rule.from_eks_primary`
- `module.elasticache.aws_security_group_rule.from_node_group`
- `module.elasticache.aws_security_group_rule.from_eks_primary`

## Result

- goti namespace 15/15 서비스 정상 Running + ready
- 노드 max-pods=110 적용 완료 (spot), core는 ASG 자동 교체로 부분 완료
- RDS/ElastiCache SG 복구 완료
- Alertmanager silence 2026-04-02 09:00 UTC까지 설정

### 재발 방지

1. **Terraform SG 관리**: inline ingress 사용 금지 → 항상 `aws_security_group_rule` 별도 리소스 사용
2. **서브넷 CIDR**: `/24`에서 `/20` 이상으로 확장 검토 (secondary CIDR 추가)
3. **WARM_IP_TARGET**: prefix delegation 시 `/24` 서브넷에서는 `WARM_IP_TARGET=2` + `MINIMUM_IP_TARGET=2` 사용
4. **rolling update 전 점검**: 서브넷 가용 IP, SG 규칙, Kyverno webhook failurePolicy 확인
5. **PDB 설정**: replica=1 서비스에도 `maxUnavailable: 0` PDB 추가 검토

### 남은 작업

- [ ] core 노드 그룹 rolling 재시도 (Kyverno webhook 해결 후)
- [ ] Prometheus memory limit 조정 검토
- [ ] `otelcol.k8s.pod.association_total` 메트릭명 수정 (`.` → `_`)
- [ ] 서브넷 CIDR 확장 계획

## Related Files
- `Goti-Terraform/terraform/prod-aws/modules/rds/main.tf` (SG inline→별도 rule 분리)
- `Goti-Terraform/terraform/prod-aws/modules/elasticache/main.tf` (동일)
- `Goti-Terraform/terraform/prod-aws/modules/compute/main.tf` (launch template user_data)
- `Goti-Terraform/terraform/prod-aws/modules/compute/bottlerocket.toml.tpl` (max-pods=110)
- `Goti-Terraform/terraform/prod-aws/modules/compute/variables.tf` (max_pods 변수)
