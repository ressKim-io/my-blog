---
title: "Go cutover 후 노드 Rightsizing — Descheduler가 알려준 축소 한계"
excerpt: "Go cutover 후 EKS 12노드(core 5 + spot 7) 실사용률이 낮아 축소했더니 CPU request 100% 포화로 Descheduler가 무력화됐습니다. 스케줄러는 actual이 아닌 requests로 판단한다는 교훈, Istio sidecar + DaemonSet 과소평가, 버퍼 1대의 필요성을 정리했습니다"
category: kubernetes
tags:
  - go-ti
  - EKS
  - Descheduler
  - Karpenter
  - Resource-Planning
  - Terraform
  - adr
series:
  name: "goti-scaling"
  order: 2
date: "2026-04-13"
---

## 한 줄 요약

> Go cutover 직후 AWS EKS prod에 12노드(core 5 + spot 7)가 기동 중이었지만 실사용률이 매우 낮아 축소를 시도했습니다 과정에서 **CPU request 포화**와 **monitoring stack pod 편중**이라는 구조적 문제가 드러났고, Descheduler 로그가 "underutilized 노드가 없으면 evict 거부" 동작을 그대로 보여주며 오판을 교정해 줬습니다

---

## 🔥 문제: 12노드 CPU actual 4~14%인데 왜 축소가 안 되는가

### 초기 현황

```text
12 노드 (core 5 + spot 7)
CPU actual: 4~14% (매우 낮음)
CPU requests allocated: 65~74% (노드당)
Mem actual: 15~46% (한 core 83% — Prometheus)
```

"actual 낮으니 축소 가능"이라고 판단했습니다 단, **requests 총합이 실제 제약**임은 인지하고 있었습니다

### 오판한 축소 목표

Go 서비스 request는 이미 100m/128Mi 최소치였고 Java `replicaCount=0`이었습니다 인프라 오버헤드(Harbor, Karpenter, KEDA, Kyverno, OTel operator, Istio sidecar)가 대부분을 차지했습니다

초기 추산: **core 3 + spot 4 = 7대** 권장 근거는 requests 총합이 노드당 allocatable ~65% 수준이라는 계산이었습니다 실제로는 과소평가였습니다

### Terraform drift 인지

- `compute/main.tf`에 `ignore_changes` 없음 → 다음 `terraform apply` 시 default(core=5/spot=6)로 복귀
- tfvars override 없음, 현재 spot=7도 drift 상태였음
- 수동 ASG 경로 선택 (빠른 반복 + 롤백 용이)
- `aws autoscaling update-auto-scaling-group --desired-capacity`로 core 5→3, spot 7→4 변경

---

## 🤔 Descheduler 로그가 근본 원인을 말해줬다

축소 후 `ip-10-1-0-10` mem 92%, pod 편중이 관찰됐습니다
Descheduler 로그 조회 결과는 교과서적이었습니다

```text
"Number of overutilized nodes" totalNumber=7   ← 전 노드 CPU 95~100%
"Number of underutilized nodes" totalNumber=0
"No node is underutilized, nothing to do here"
```

### 재현된 제약

- 7대 축소 후 CPU requests 총합이 노드당 95~100% 포화
- Descheduler `LowNodeUtilization` 정책은 **underutilized 노드가 없으면 evict 거부**(받아줄 곳이 없기 때문)
- 결과: pod 편중이 자동으로 해소되지 않음

### 오판의 원인

- Istio sidecar **100m × 13 app pod = 1.3 vCPU**가 인프라 오버헤드에 제대로 합산 안 됨
- DaemonSet(node-exporter, otel agent 등) 노드당 고정부하 과소평가

---

## ✅ 해결: spot 1대 복구 + Falco 비활성화 + monitoring podAntiAffinity

### Step 5: spot 4 → 5 복구

1대 추가로 새 underutilized 노드(`ip-10-1-2-177`)를 확보해 Descheduler가 다시 작동하기 시작했습니다

### Step 6: Falco 비활성화

미사용 + 알람 off 상태로 리소스만 점유하고 있었습니다 GCP는 이미 root-app에서 `falco/**` exclude 처리돼 있었습니다(2026-04-13~, CPU quota 사유) AWS prod도 동일 패턴을 적용했습니다

- 파일: `Goti-k8s/clusters/prod/bootstrap/root-appsets.yaml`
- 변경: `exclude: "{falco/**}"` 추가
- 커밋: `85e2b0a`

### Step 7: Monitoring stack podAntiAffinity

Prometheus/Loki/Tempo/Mimir가 같은 core 노드에 몰리는 것을 방지했습니다

- 파일: `Goti-monitoring/values-stacks/prod/{kube-prometheus-stack,loki,tempo}-values.yaml`
- `preferredDuringSchedulingIgnoredDuringExecution` (soft), `topologyKey=hostname`
- 커밋: `ab5b8de`

### Step 8: Prometheus 4Gi의 근본 원인

실측은 Prometheus pod mem 3981Mi / limit 4Gi (99% 턱밑)이었습니다

`kube-prometheus-stack-values.yaml` L24-26 주석에 직접 명시되어 있었습니다

```text
OOMKilled 근본 해결: WAL replay(71 seg) + TSDB compaction 피크 메모리 대응
100K-300K active series 기준
GOMEMLIMIT = limit의 ~80%, GOGC=75로 peak memory 억제
```

즉 "OOM 나서 limit 2Gi → 4Gi 올림"은 근본 해결이 아니었습니다 진짜 원인은 Grafana가 이미 Mimir만 쿼리하는데 Prometheus가 로컬 TSDB를 유지하고 있어 **이중 저장 + compaction 부담**이 발생한 것이었습니다 ADR 0011에서 Agent mode 전환을 제안해 별건으로 관리하게 됐습니다

---

## 최종 상태

| 지표 | Before | After |
|---|---|---|
| 노드 수 | 12 (5c + 7s) | 8 (3c + 5s) |
| ASG desired (core/spot) | 5/7 | 3/5 |
| Falco | 운영 중 | exclude 처리 |
| monitoring podAntiAffinity | 없음 | soft(hostname) |
| Descheduler | 이미 9일째 동작 | 동작 지속, 효과 복귀 |
| Prometheus mem 근본원인 | 미해결 | ADR 0011로 관리 |

---

## 📚 배운 점

- **"실사용 낮음 = 축소 가능"은 틀린 명제입니다** 스케줄러는 actual이 아닌 **requests**로 판단합니다 축소 여부는 requests 총합 기준으로 계산해야 합니다
- **Descheduler는 underutilized 노드가 있어야 동작합니다** 전 노드 포화 시 무력화됩니다 축소의 마지막 단계에는 **버퍼 1대**를 남겨야 Descheduler가 수렴에 도움을 줍니다
- **근본 해결과 우회를 구분합니다** limit을 올려서 OOM을 피한 것은 우회입니다 왜 그 메모리를 쓰는지 답할 수 있어야 근본 해결입니다 Prometheus의 경우 "Grafana가 Mimir만 쿼리하는데 Prometheus 로컬 TSDB 유지"가 진짜 원인이었습니다
- **Terraform drift 모니터링이 필요합니다** `lifecycle { ignore_changes = [scaling_config] }` 없이 ASG를 수동 조정하면 다음 `terraform apply`에서 리바운드됩니다 축소 확정 시 tfvars에도 반영해야 합니다
- **Istio sidecar 오버헤드는 과소평가되기 쉽습니다** `100m × 13 pod = 1.3 vCPU`가 "인프라 오버헤드"로 별도 분류되어야 했는데 app pod 리소스에 포함시키는 실수가 반복됩니다

---

## Follow-up

- [ ] ADR 0011 구현 (Prometheus Agent mode) — Grafana 대시보드 영향 전수 확인 선행
- [ ] `Goti-Terraform/terraform/prod-aws/variables.tf` default 값 3/5 반영 + `lifecycle.ignore_changes` 추가
- [ ] Falco 제거 이후 실제 리소스 절감량 관측 (spot 1대 재축소 가능성)
- [ ] podAntiAffinity 적용 후 Prometheus pod 실제 재배치 확인 (ArgoCD sync 후 수동 rollout 필요할 수 있음)
- [ ] Istio sidecar request 100m 검토 (hot-path 외 서비스는 50m로 낮출 수 있는지)
