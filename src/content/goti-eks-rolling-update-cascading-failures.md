---
title: "EKS max-pods rolling update가 부른 연쇄 장애 4건 — SG 삭제, IP 소진, RDS 단절, OOM"
excerpt: "goti-load-observer IP 할당 실패를 해결하려 max-pods 35→110 rolling update를 실행했다가 프로덕션에서 Terraform SG 충돌·VPC 서브넷 IP 소진·RDS 접속 불가·Prometheus OOM이 연달아 터진 기록"
category: "kubernetes"
tags:
  - go-ti
  - EKS
  - AWS
  - VPC-CNI
  - RollingUpdate
  - CascadingFailure
  - Terraform
  - troubleshooting
series:
  name: "goti-eks"
  order: 2
date: "2026-04-01"
---

## 한 줄 요약

> EKS 노드당 max-pods를 35→110으로 올리는 rolling update 하나가 RDS·ElastiCache SG 삭제, 서브넷 IP 소진 데드락, RDS 접속 불가, Prometheus OOM 순으로 연쇄 장애를 일으켰습니다. 15개 서비스가 모두 Init stuck·CrashLoopBackOff에 빠진 프로덕션 사고였습니다

---

## 배경

go-ti 프로젝트는 삼성·두산 두 구단의 야구 티켓팅 플랫폼을 AWS EKS(`goti-prod`, ap-northeast-2)와 GCP GKE에서 이중 운영합니다. 동시 접속 50만, API p99 200ms 이하라는 목표를 위해 지속적으로 파드를 추가하는 상황이었습니다.

이 시점에 `goti-load-observer` 등 신규 파드들이 VPC CNI prefix delegation 부족으로 IP 할당을 받지 못하고 Pending 상태에 빠졌습니다. 노드를 줄이는 것이 아니라 **기존 노드에 파드를 더 많이 태우기 위해** — 즉 노드당 밀집도를 올려 해결하기 위해 — Bottlerocket launch template의 `max-pods`를 35에서 110으로 올리는 rolling update를 실행했습니다.

Terraform으로 launch template `user_data`에 `max-pods=110`을 주입하고 `terraform apply`를 실행한 것이 시작이었습니다.

- **클러스터**: `goti-prod`, K8s v1.34.4, Bottlerocket OS
- **노드 구성**: Core 4 + Spot 6, 총 10대
- **데이터 계층**: RDS PostgreSQL 16.10 Multi-AZ + ElastiCache Redis (TLS)
- **Terraform 모듈**: `terraform-aws-modules/eks/aws` v20.37.2

---

## 🔥 문제: rolling 시작 직후 15개 서비스 전체 불능

rolling update가 시작되자 goti 네임스페이스 파드 전체가 Init stuck 또는 CrashLoopBackOff에 빠졌습니다.

```text
goti-payment-api        0/1   Init:0/1   CrashLoopBackOff   ...
goti-ticket-api         0/1   Init:0/1   CrashLoopBackOff   ...
goti-user-api           0/1   Init:0/1   CrashLoopBackOff   ...
# (15개 서비스 전체)
```

동시에 여러 에러가 겹쳐서 터졌습니다.

**RDS/ElastiCache 접속 끊김:**

```text
SocketTimeoutException: Read timed out
  at org.postgresql.core.v3.ConnectionFactoryImpl.enableSSL
```

**IP 할당 실패:**

```text
FailedCreatePodSandBox: plugin type="aws-cni" failed (add):
  failed to assign an IP address to container
```

**rolling 자체 차단:**

```text
Error: ClusterUnreachable: The requested managed node group operation
  was blocked by a Kubernetes webhook configuration
```

**Prometheus OOM:**

```text
reason: OOMKilled (exit code 137)
memory limit: 1Gi
```

단일 작업이 4개의 서로 다른 레이어에서 동시에 장애를 일으킨 상황이었습니다.

---

## 🤔 원인: 4건 연쇄 구조

각 장애는 원인이 달랐습니다. 순서대로 짚겠습니다.

### 원인 1 — Terraform inline SG + 별도 rule 충돌로 ingress 삭제

rolling update 전 단계에서 `terraform apply -target=module.config`로 SSM과 SG inline ingress를 통합 적용했습니다. 이후 `terraform apply` (full)을 실행하자 별도 `aws_security_group_rule` 리소스가 destroy됐고, **AWS에서 실제 규칙이 삭제됐습니다**.

문제의 구조는 두 단계 apply가 같은 SG 규칙을 서로 다른 방식으로 관리하면서 발생합니다

1. **`terraform apply -target=module.config`** — `aws_security_group.this`의 inline ingress로 규칙을 통합해 Terraform state에 기록합니다
2. **`terraform apply` (full)** — `aws_security_group_rule.from_eks_primary`가 destroy되면서 AWS의 실제 SG ingress 규칙이 삭제됩니다. 그 결과 EKS primary SG(`sg-0a7b4cec82230ff01`)에서 RDS/ElastiCache로 가는 인바운드가 소실됩니다

Terraform은 동일한 SG 규칙을 `aws_security_group` 블록의 inline ingress와 `aws_security_group_rule` 두 곳에서 관리하면, full apply 시 중복 상태를 정리하면서 실제 규칙을 지웁니다. EKS cluster primary SG에서 RDS(5432)와 ElastiCache(6379)로의 인바운드가 전부 사라진 것이 RDS 접속 불가의 직접 원인이었습니다.

### 원인 2 — /24 서브넷에서 prefix delegation warm pool 과다 예약 → 데드락

private 서브넷이 `/24` (가용 IP 254개)였습니다. rolling 중 기존 노드 10대와 신규 노드 8대가 동시에 존재했습니다.

문제는 `WARM_PREFIX_TARGET=1` 설정이었습니다.

```text
노드당 IP 예약:
  /28 prefix(16 IP) × ENI 3개 = 48 IP/노드

전체 예약:
  18노드 × 48 IP = 864 IP > 서브넷 가용 254 IP
```

신규 노드가 IP를 받지 못하니 파드를 올릴 수 없었고, 기존 노드에서 파드를 drain할 수 없으니 IP가 반환되지 않았습니다. **신규 노드 IP 할당 불가 → 기존 노드 drain 불가 → IP 미반환 → 신규 노드 IP 할당 불가** 로 이어지는 완전한 데드락이었습니다.

### 원인 3 — Kyverno admission webhook이 core 노드 그룹 rolling 차단

spot 노드 그룹은 정상적으로 rolling이 완료됐지만 core 노드 그룹에서 막혔습니다.

```text
Error: ClusterUnreachable: The requested managed node group operation
  was blocked by a Kubernetes webhook configuration
```

Kyverno admission webhook이 EKS managed node group의 노드 교체 과정에서 파드 생성을 차단하는 상황이었습니다. rolling 중 일시적으로 Kyverno 정책 위반이 감지되어 새 파드 생성 자체가 거부됐습니다.

### 원인 4 — Prometheus WAL 축적으로 재시작 시 OOM

rolling 중 Prometheus가 메트릭 수집을 정상적으로 처리하지 못하면서 WAL(Write-Ahead Log)이 대량으로 축적됐습니다. 재시작 시 WAL replay와 Mimir remote write가 동시에 실행되면서 메모리 1Gi 한도를 초과했습니다.

추가로 OTel Collector가 보내는 `otelcol.k8s.pod.association_total` (`.` 포함 메트릭명)이 Mimir에서 400 Bad Request를 반환하는 부작용도 겹쳤습니다.

---

## ✅ 해결: 순서대로 막힌 것을 뚫었습니다

장애 복구는 타임라인 순서대로 진행했습니다. 얽혀있는 장애를 한꺼번에 풀 수 없었기 때문에 가장 근본적인 것부터 해결했습니다.

### 복구 타임라인

1. `terraform apply -target=module.config` — SSM + SG inline 통합 (이 시점 문제 씨앗)
2. `terraform apply` (full) — launch template 변경 + SG rule destroy → **RDS SG 삭제 발생**
3. rolling 시작 — 신규 노드 8대 생성, IP 소진 시작
4. goti 파드 전체 Init stuck / CrashLoopBackOff
5. `WARM_IP_TARGET=2` 적용 → 일부 IP 확보
6. goti 서비스 replica=0 축소 → IP 압박 완화
7. Alertmanager silence 설정 (알람 폭주 방지)
8. SG 원인 발견 → `aws ec2 authorize-security-group-ingress`로 수동 복구
9. 기존 core 노드 3대 수동 EC2 종료 → ASG 자동 교체
10. goti 서비스 replica=1 복원 → 14/15 정상 복구
11. payment-api 서비스 환경변수 오류 수정(`QUEUE_TOKEN_SECRET_KEY` 길이 불일치) → 15/15 완료

### 복구 1 — SG 수동 재추가

RDS와 ElastiCache SG에 EKS primary SG 인바운드를 즉시 수동으로 재추가했습니다.

```bash
# RDS SG에 EKS primary SG 인바운드 재추가 (TCP 5432)
aws ec2 authorize-security-group-ingress \
  --group-id sg-0d0dde54608adeaed \
  --protocol tcp \
  --port 5432 \
  --source-group sg-0a7b4cec82230ff01

# ElastiCache SG에 EKS primary SG 인바운드 재추가 (TCP 6379)
aws ec2 authorize-security-group-ingress \
  --group-id sg-07963da9ecd595ffc \
  --protocol tcp \
  --port 6379 \
  --source-group sg-0a7b4cec82230ff01
```

Terraform 근본 수정은 inline ingress 제거 + `lifecycle { ignore_changes = [ingress] }` + 별도 `aws_security_group_rule`로 완전 분리했습니다.

```hcl
resource "aws_security_group" "this" {
  name   = var.name
  vpc_id = var.vpc_id

  # inline ingress 제거 — aws_security_group_rule로만 관리
  lifecycle {
    ignore_changes = [ingress]
  }
}

resource "aws_security_group_rule" "from_node_group" { ... }
resource "aws_security_group_rule" "from_eks_primary" { ... }
```

이후 `terraform import` 4건으로 state 동기화를 완료했습니다.

```text
module.rds.aws_security_group_rule.from_node_group
module.rds.aws_security_group_rule.from_eks_primary
module.elasticache.aws_security_group_rule.from_node_group
module.elasticache.aws_security_group_rule.from_eks_primary
```

### 복구 2 — WARM_IP_TARGET 축소로 데드락 해제

aws-node DaemonSet의 warm pool 설정을 즉시 낮췄습니다.

```bash
# WARM_PREFIX_TARGET 제거
kubectl set env daemonset aws-node -n kube-system WARM_PREFIX_TARGET-

# 노드당 IP 예약을 2~3개로 제한
kubectl set env daemonset aws-node -n kube-system WARM_IP_TARGET=2
kubectl set env daemonset aws-node -n kube-system MINIMUM_IP_TARGET=2
```

노드당 IP 예약이 48개에서 2~3개로 줄어들면서 서브넷 내 IP가 확보됐습니다.

추가로 goti 서비스를 replica=0으로 일괄 축소하여 IP 압박을 완화한 후, 기존 core 노드 3대를 수동으로 EC2 종료했습니다.

```text
수동 종료 인스턴스:
  i-0a71269eac37900d5
  i-0bcc2ca083000645d
  i-00280d2f0a6688aee
```

ASG가 자동으로 새 노드(max-pods=110 적용)를 생성했고 데드락이 해소됐습니다.

### 복구 3 — Kyverno webhook 우회

core 노드 그룹 rolling이 webhook으로 차단된 상황에서, 기존 core 노드 EC2를 수동 종료하여 우회했습니다. ASG가 새 노드(max-pods=110 설정 포함)를 자동 생성함으로써 rolling 없이 교체 효과를 얻었습니다.

### 복구 4 — Prometheus OOM 자연 복구

서비스가 정상화되면서 WAL 크기가 줄어들어 자연 복구를 기다렸습니다. 필요시 memory limit을 2Gi로 임시 증가하는 옵션을 준비해두었습니다.

`otelcol.k8s.pod.association_total` 메트릭명의 `.` → `_` 치환은 후속 작업으로 분류했습니다.

### 최종 결과

```text
goti namespace: 15/15 서비스 정상 Running + Ready
EKS 노드 max-pods=110: spot 완료, core ASG 자동 교체로 부분 완료
RDS/ElastiCache SG: 복구 완료
Alertmanager silence: 2026-04-02 09:00 UTC까지 설정
```

---

## 📚 배운 점

**Terraform inline SG와 별도 SG rule은 절대 혼용하지 않습니다**

동일한 SG 규칙을 `aws_security_group` 블록의 inline ingress와 `aws_security_group_rule` 두 곳에서 동시에 관리하면, Terraform full apply 시 중복 해소 과정에서 실제 AWS 규칙이 삭제됩니다. SG 관리는 `aws_security_group_rule` 단독으로 통일하고, SG 블록에는 `lifecycle { ignore_changes = [ingress] }`를 반드시 붙여야 합니다. `-target` 부분 apply도 state 불일치의 씨앗이 됩니다

**`/24` 서브넷에서 prefix delegation warm pool은 서브넷 IP를 초과합니다**

`WARM_PREFIX_TARGET=1`이면 노드당 /28 prefix 3개 = 48 IP를 예약합니다. 노드가 10대만 넘어가도 서브넷 254 IP를 전부 소진합니다. `/24` 서브넷을 사용할 때는 `WARM_IP_TARGET=2` + `MINIMUM_IP_TARGET=2`로 제한하거나, 서브넷을 `/20` 이상으로 확장해야 합니다. rolling update처럼 기존 노드와 신규 노드가 동시에 존재하는 구간에서는 IP 소비가 일시적으로 2배로 늘어난다는 점을 반드시 계산에 넣어야 합니다

**rolling update 전 서브넷 가용 IP를 반드시 계산합니다**

```text
필요 IP = (현재 노드 수 + 신규 노드 수) × 노드당 예약 IP
```

이 값이 서브넷 가용 IP를 초과하면 rolling 자체가 데드락에 빠집니다. rolling 전 체크리스트에 다음 항목을 추가해야 합니다.

| 항목 | 확인 방법 |
|------|-----------|
| 서브넷 가용 IP | AWS 콘솔 → VPC → 서브넷 → 사용 가능한 IPv4 주소 |
| 노드당 IP 예약 | `WARM_PREFIX_TARGET` × ENI 수 × prefix 크기 |
| SG 규칙 | Terraform plan에서 SG rule destroy 항목 체크 |
| Kyverno webhook | `failurePolicy` 설정 + 노드 교체 시 영향 범위 확인 |

**Kyverno webhook은 EKS managed node group rolling과 충돌할 수 있습니다**

Kyverno admission webhook이 rolling 중 새 파드 생성을 차단하면 managed node group 교체 작업 전체가 멈춥니다. rolling update 전에 Kyverno의 `failurePolicy`를 확인하고, 필요하면 일시 비활성화 또는 예외 처리를 준비해야 합니다

**replica=1 서비스는 PDB `maxUnavailable: 0`이 없으면 rolling 중 단일 장애점이 됩니다**

replica=1 서비스는 rolling 중 파드가 한 번이라도 내려가면 해당 서비스가 전체 다운됩니다. `maxUnavailable: 0`의 PodDisruptionBudget을 추가하면 drain 시 해당 파드를 보호할 수 있습니다

**재발 방지 체크리스트**

| 항목 | 조치 |
|------|------|
| Terraform SG 관리 | inline ingress 사용 금지 → `aws_security_group_rule` 단독 관리 |
| 서브넷 CIDR | `/24` → `/20` 이상 확장 (secondary CIDR 추가) |
| WARM_IP_TARGET | prefix delegation + `/24` 서브넷 조합 시 `WARM_IP_TARGET=2` + `MINIMUM_IP_TARGET=2` 고정 |
| rolling 전 점검 | 서브넷 가용 IP, SG 규칙, Kyverno webhook failurePolicy |
| PDB 설정 | replica=1 서비스에도 `maxUnavailable: 0` 추가 |
| Prometheus memory | WAL 축적 시나리오 대비 2Gi 검토 |
