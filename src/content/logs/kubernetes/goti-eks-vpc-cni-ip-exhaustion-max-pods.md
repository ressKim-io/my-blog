---
title: "VPC CNI IP 소진 — /24 서브넷과 max-pods=35 고정의 충돌"
excerpt: "프로덕션 EKS에서 prefix delegation을 활성화했음에도 kubelet max-pods=35 고정 때문에 IP 할당이 실패했습니다. Bottlerocket TOML로 max-pods=110을 주입해 해결한 과정을 기록합니다"
category: "kubernetes"
tags:
  - go-ti
  - EKS
  - AWS
  - VPC-CNI
  - Networking
  - troubleshooting
series:
  name: "goti-eks"
  order: 1
date: "2026-04-01"
---

## 한 줄 요약

> VPC CNI에서 prefix delegation을 활성화했지만 Bottlerocket kubelet의 `max-pods=35` 기본값이 그대로 남아, IP는 충분함에도 pod가 `Init:0/2` 상태로 멈추는 복합 장애가 발생했습니다

---

## 🔥 문제: IP가 있는데 pod가 올라오지 않는다

### 클러스터 환경

go-ti 프로젝트의 프로덕션 EKS 클러스터 `goti-prod`는 ap-northeast-2 리전에서 K8s v1.34.4로 운영되었습니다.
노드는 8개(Bottlerocket AMI, Spot + Core 혼합)로 구성되었고, VPC private 서브넷은 초기 설계 시 /24 CIDR(최대 254 IP)로 프로비저닝되었습니다.

/24 서브넷은 당초 소규모 pod 운영을 가정한 크기였습니다.
그러나 goti-load-observer 등 신규 pod가 추가되고, 롤링 배포 시 기존 pod와 신규 pod가 동시에 IP를 요구하면서 이 제약이 실제 장애로 터졌습니다.

### 발견한 문제

`goti-load-observer` pod를 재시작하거나 임시 psql pod를 생성할 때마다 pod가 `Init:0/2` 상태에서 멈추고 IP가 `<none>`으로 표시되었습니다.

```text
Warning  FailedCreatePodSandBox  kubelet  Failed to create pod sandbox: plugin type="aws-cni" name="aws-cni" failed (add): add cmd: failed to assign an IP address to container
```

특이한 점은 장애가 특정 가용 영역(ap-northeast-2c)의 노드에 집중되었다는 것입니다.
해당 노드(`ip-10-1-2-107`, `ip-10-1-2-35`)의 현재 pod 수는 9~11개로, 제한값 35의 1/3 수준에 불과했습니다.

롤링 배포 시 기존 pod + 신규 pod가 동시에 존재하는 구간에서 IP 요구량이 2배로 늘어나는 점도 실패를 가속했습니다.

---

## 🤔 원인: prefix delegation과 kubelet max-pods의 불일치

원인을 파악하기 위해 VPC CNI 설정과 노드 capacity를 순서대로 확인했습니다.

```bash
# VPC CNI 환경변수 확인
$ kubectl describe daemonset aws-node -n kube-system | grep -A1 ENABLE_PREFIX_DELEGATION
ENABLE_PREFIX_DELEGATION: true
```

```bash
# 노드 capacity 확인
$ kubectl get node ip-10-1-2-107 -o json | jq '.status.capacity.pods, .status.allocatable.pods'
"35"
"35"
```

이 두 값을 함께 보면 문제 구조가 드러납니다.

VPC CNI의 `ENABLE_PREFIX_DELEGATION=true`는 각 노드에 `/28` prefix(16 IP)를 warm pool로 할당하는 방식입니다.
t3.large 인스턴스는 prefix delegation 활성화 시 이론상 **110 pods**를 수용할 수 있습니다.

그런데 노드의 `capacity.pods`와 `allocatable.pods`가 모두 35로 고정되어 있었습니다.
이는 VPC CNI가 IP를 확보했더라도 kubelet이 35개 이상의 pod 스케줄을 애초에 거부한다는 의미입니다.

원인은 두 계층의 충돌이었습니다.

**첫 번째**: Bottlerocket AMI는 bootstrap args 방식이 아닌 TOML 형식의 user_data로 kubelet 설정을 주입합니다.
launch template에 user_data가 없었기 때문에 kubelet은 prefix delegation을 고려하지 않은 secondary IP 모드 기본값인 `max-pods=35`로 기동되었습니다.

**두 번째**: ap-northeast-2c 서브넷의 가용 IP 자체가 적어 `/28` prefix 할당이 실패하는 경우도 있었습니다.
VPC CNI가 prefix를 확보하지 못하면 kubelet이 허용하더라도 실제 IP 배정은 실패합니다.

결과적으로 "kubelet 제한"과 "서브넷 고갈" 두 가지가 겹친 복합 장애였습니다.

---

## ✅ 해결: Bottlerocket TOML로 max-pods=110 주입

### 1단계 — Bottlerocket TOML 템플릿 작성

Bottlerocket은 kubelet 파라미터를 TOML 형식의 user_data로 설정합니다.
`bottlerocket.toml.tpl` 파일을 신규 생성했습니다.

```toml
# terraform/prod-aws/modules/compute/bottlerocket.toml.tpl
[settings.kubernetes]
max-pods = 110
```

### 2단계 — launch template에 user_data 주입

```hcl
# terraform/prod-aws/modules/compute/main.tf
resource "aws_launch_template" "node" {
  # ...
  user_data = base64encode(templatefile(
    "${path.module}/bottlerocket.toml.tpl", {}
  ))
}
```

core 노드 그룹과 spot 노드 그룹 모두에 동일하게 적용했습니다.

### 3단계 — terraform apply + rolling update

```bash
$ terraform plan
# launch template 새 버전 생성 + node group update-in-place 확인

$ terraform apply
```

노드 그룹 업데이트는 `max_unavailable=1` 설정에 따라 노드 하나씩 순차 교체(rolling update)로 진행되었습니다.

교체된 노드는 kubelet이 `max-pods=110`으로 기동되어, 이후 `capacity.pods`가 110으로 변경됩니다.

```bash
# 롤링 완료 후 노드 capacity 재확인
$ kubectl get node ip-10-1-2-107 -o json | jq '.status.capacity.pods'
"110"
```

### 잠재 리스크 (롤링 진행 중 주의)

롤링 업데이트 도중 발생할 수 있는 위험 요소를 미리 확인했습니다.

- **순간 503**: `replica=1` 서비스는 노드 교체 중 일시적으로 내려갈 수 있습니다. PDB(PodDisruptionBudget)가 미설정된 서비스는 영향을 받을 수 있습니다
- **StatefulSet Pending**: PVC가 특정 AZ에 고정된 경우, 다른 AZ 노드로 이동 불가로 Pending 상태가 될 수 있습니다
- **2c 서브넷 고갈 지속**: ap-northeast-2c 서브넷의 CIDR 자체가 좁으면 `/28` prefix 할당 실패가 재발할 수 있습니다. 이 문제는 별도로 VPC 서브넷 /20 확장과 `WARM_IP_TARGET=2` 설정으로 후속 조치했습니다

---

## 📚 배운 점

- **prefix delegation과 max-pods는 반드시 함께 설정해야 합니다** — VPC CNI에서 prefix delegation을 활성화하면 kubelet의 `max-pods`도 그에 맞게 올려주어야 합니다. 어느 한쪽만 설정하면 실제 pod 수용 능력이 낮은 쪽에 맞춰집니다
- **Bottlerocket은 bootstrap args가 아닌 TOML user_data를 사용합니다** — Amazon Linux 2 계열과 달리 Bottlerocket은 kubelet 파라미터를 TOML 형식으로 주입합니다. launch template에 user_data가 없으면 기본값이 그대로 적용됩니다
- **/24 서브넷은 prefix delegation 환경에서 빠르게 고갈됩니다** — `/28` prefix 하나가 16 IP를 점유하므로, 노드가 8~16개인 클러스터에서 /24는 금세 부족해집니다. 초기 설계 시 서브넷 크기를 /20 이상으로 잡는 것이 안전합니다
- **롤링 업데이트 전 PDB 점검이 선행되어야 합니다** — `replica=1` 서비스에 PDB가 없으면 노드 교체 중 순간 다운이 발생할 수 있습니다. 프로덕션 롤링 전에는 반드시 PDB 설정 여부를 확인합니다
- **향후 Karpenter NodePool에도 동일 설정 필요** — Karpenter를 사용하는 경우 NodePool의 kubelet 설정에도 `maxPods: 110`을 명시해야 합니다. 이 설정이 누락되면 Karpenter가 프로비저닝하는 신규 노드에서 동일 문제가 재발합니다
