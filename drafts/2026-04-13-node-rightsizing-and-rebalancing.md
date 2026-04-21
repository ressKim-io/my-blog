# 2026-04-13 Go Cutover 후 노드 Rightsizing + Pod 편중 해소

## 배경

Go cutover 완료 직후 (동일 세션 `2026-04-13-java-to-go-cutover-smoke-trouble.md` 참조) AWS EKS prod에 12노드(core 5 + spot 7)가 기동 중이나 실사용률이 매우 낮아 노드 축소 시도. 과정에서 **CPU request 포화** 와 **monitoring stack pod 편중**이라는 두 가지 구조적 문제가 드러남.

## 타임라인

### Step 1: 초기 현황 파악

```
12 노드 (core 5 + spot 7)
CPU actual: 4~14% (매우 낮음)
CPU requests allocated: 65~74% (노드당)
Mem actual: 15~46% (한 core 83% — Prometheus)
```

→ "actual 낮으니 축소 가능" 판단. 단, **requests 총합이 실제 제약**임을 확인.

### Step 2: 축소 목표 산정 (오판)

Go 서비스 request는 이미 100m/128Mi 최소치. Java replicaCount=0. 인프라 오버헤드(Harbor, Karpenter, KEDA, Kyverno, OTel operator, Istio sidecar)가 대부분.

초기 추산: **core 3 + spot 4 = 7대** 권장. 근거는 requests 총합이 노드당 allocatable ~65% 수준이라는 계산. **실제로는 과소평가였다** (아래 Step 4 참조).

### Step 3: ASG 수동 축소 (Terraform drift 인지)

- `compute/main.tf`에 `ignore_changes` 없음 → 다음 `terraform apply` 시 default(core=5/spot=6)로 복귀. tfvars override 없음. 현재 spot=7도 drift 상태였음
- 수동 ASG 경로 선택 (빠른 반복 + 롤백 용이)
- `aws autoscaling update-auto-scaling-group --desired-capacity`로 core 5→3, spot 7→4 변경

### Step 4: Descheduler 로그에서 근본 원인 발견

축소 후 `ip-10-1-0-10` mem 92%, pod 편중 관찰. Descheduler 로그 조회 결과:

```
"Number of overutilized nodes" totalNumber=7   ← 전 노드 CPU 95~100%
"Number of underutilized nodes" totalNumber=0
"No node is underutilized, nothing to do here"
```

**재현된 제약**:
- 7대 축소 후 CPU requests 총합이 노드당 95~100% 포화
- Descheduler `LowNodeUtilization` 정책은 underutilized 노드가 없으면 evict 거부 (받아줄 곳 없음)
- 결과: pod 편중이 자동으로 해소되지 않음

**오판의 원인**:
- Istio sidecar 100m × 13 app pod = 1.3 vCPU가 인프라 오버헤드에 제대로 합산 안 됨
- DaemonSet(node-exporter, otel agent 등) 노드당 고정부하 과소평가

### Step 5: spot 4→5 복구 (재승인)

1대 추가로 새 underutilized 노드(ip-10-1-2-177) 확보 → Descheduler 다시 작동 시작.

### Step 6: Falco 비활성화 (사용자 요청)

미사용 + 알람 off 상태로 리소스만 점유. GCP는 이미 root-app에서 `falco/**` exclude 처리돼 있었음 (2026-04-13~, CPU quota 사유). AWS prod도 동일 패턴 적용.

- 파일: `Goti-k8s/clusters/prod/bootstrap/root-appsets.yaml`
- 변경: `exclude: "{falco/**}"` 추가
- 커밋: `85e2b0a`

### Step 7: Monitoring stack podAntiAffinity 추가

Prometheus/Loki/Tempo/Mimir가 같은 core 노드에 몰리는 것 방지.

- 파일: `Goti-monitoring/values-stacks/prod/{kube-prometheus-stack,loki,tempo}-values.yaml`
- `preferredDuringSchedulingIgnoredDuringExecution` (soft), topologyKey=hostname
- 커밋: `ab5b8de`

### Step 8: Prometheus 4Gi의 근본 원인 발견

실측: Prometheus pod mem 3981Mi / limit 4Gi (99% 턱밑).

`kube-prometheus-stack-values.yaml` L24-26 주석에 직접 명시됨:
```
OOMKilled 근본 해결: WAL replay(71 seg) + TSDB compaction 피크 메모리 대응
100K-300K active series 기준
GOMEMLIMIT = limit의 ~80%, GOGC=75로 peak memory 억제
```

즉 "OOM 나서 limit 2Gi→4Gi 올림"이 근본 해결 아님. 진짜 원인: **Grafana는 이미 Mimir만 쿼리**하는데 Prometheus가 로컬 TSDB 유지 → 이중 저장 + compaction 부담. ADR 0011에서 Agent mode 전환 제안 (별건).

## 최종 상태

| 지표 | Before | After |
|---|---|---|
| 노드 수 | 12 (5c + 7s) | 8 (3c + 5s) |
| ASG desired (core/spot) | 5/7 | 3/5 |
| Falco | 운영 중 | exclude 처리 |
| monitoring podAntiAffinity | 없음 | soft(hostname) |
| Descheduler | 이미 9일째 동작 | 동작 지속, 효과 복귀 |
| Prometheus mem 근본원인 | 미해결 | ADR 0011로 관리 |

## 교훈 (Lessons Learned)

1. **"실사용 낮음 = 축소 가능"은 틀린 명제.** scheduler는 actual이 아닌 requests로 판단. 축소 여부는 **requests 총합 기준**으로 계산해야 함.
2. **Descheduler는 underutilized 노드가 있어야 동작.** 전 노드 포화 시 무력화. 축소의 마지막 단계에선 버퍼(1대) 남겨야 Descheduler가 수렴 도움.
3. **근본 해결 vs 우회 구분.** limit 올려서 OOM 피한 것은 우회. 왜 그 메모리를 쓰는지 답할 수 있어야 근본 해결.
4. **Terraform drift 모니터링 필요.** `lifecycle { ignore_changes = [scaling_config] }` 없으면 ASG 수동 조정이 다음 apply 시 리바운드. 축소 확정 시 tfvars에도 반영 필요 (별건).
5. **문서화된 제약 우선 읽기.** 오늘 cloud-cli-safety.md 규칙(건별 승인)과 workflow.md의 EXPLORE/PLAN 단계가 불필요한 리스크를 크게 줄였음.

## Follow-up

- [ ] ADR 0011 구현 (Prometheus Agent mode) — Grafana 대시보드 영향 전수 확인 선행
- [ ] `Goti-Terraform/terraform/prod-aws/variables.tf` default값 3/5 반영 + `lifecycle.ignore_changes` 추가
- [ ] Falco 제거 이후 실제 리소스 절감량 관측 (spot 1대 재축소 가능성)
- [ ] podAntiAffinity 적용 후 Prometheus pod 실제 재배치 확인 (ArgoCD sync 후 수동 rollout 필요할 수 있음)
- [ ] Istio sidecar request 100m 검토 (hot-path 외 서비스는 50m로 낮출 수 있는지)

## 관련 커밋

- `85e2b0a` — Goti-k8s: falco exclude
- `ab5b8de` — Goti-monitoring: podAntiAffinity 3 charts

## 관련 문서

- [ADR 0011 Prometheus Agent Mode](../adr/0011-prometheus-agent-mode.md)
- [2026-04-13 Java→Go Cutover Smoke Trouble](2026-04-13-java-to-go-cutover-smoke-trouble.md)
