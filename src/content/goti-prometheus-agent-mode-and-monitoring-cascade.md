---
title: "Prometheus Agent Mode 전환 — 모니터링 스택 연쇄 장애 복구기"
excerpt: "core 노드 CPU 포화로 monitoring pod 5개가 Pending 상태에 빠진 상황에서, OTel 라벨 수정 → Agent mode 전환 → operator 데드락 → OOMKill → Grafana 변수 parse error까지 이어진 연쇄 트러블을 복구한 기록입니다."
category: monitoring
tags:
  - go-ti
  - Observability
  - Prometheus
  - Agent-Mode
  - Grafana
  - ArgoCD
  - OpenTelemetry
series:
  name: "goti-observability-ops"
  order: 16
date: "2026-04-14"
---

## 한 줄 요약

> 부하테스트 직전 모니터링 스택이 노드 CPU 포화로 마비됐고, Prometheus Agent mode 전환을 기회 삼아 복구하는 과정에서 NetworkPolicy whitelist, operator 데드락, OOMKill, Grafana 변수 parse error까지 연쇄적으로 드러났습니다. 최종적으로 Prometheus 메모리 사용량을 82% 줄이고 Pending pod 5개를 모두 해소했습니다.

---

## 🔥 문제: 부하테스트 직전 모니터링 스택 전체 마비

### 기대 동작

부하테스트 전 모니터링 스택이 정상 가동되고, Grafana 대시보드에서 prod 환경의 Go 서비스 메트릭이 확인되어야 했습니다.

### 실제 상황

두 가지 구조적 문제가 한꺼번에 드러났습니다.

먼저 **Go cutover 이후 Grafana 대시보드에 메트릭이 뜨지 않았습니다**.
Go pod 로그에는 OTel collector로 트레이스를 내보내지 못한다는 에러가 반복 출력되고 있었습니다.

```text
traces export: name resolver error: produced zero addresses
```

동시에 **monitoring 네임스페이스 전체가 Pending 상태**였습니다.
core 노드 CPU 사용률이 87~97%까지 치솟아 포화됐고, 5개의 pod가 10분째 스케줄되지 못한 채 대기하고 있었습니다.

시작 시점의 Prometheus 리소스 실측은 다음과 같았습니다.

| 지표 | 실측 | 설정 | 비고 |
|---|---|---|---|
| Memory | 2.77Gi | limit 4Gi | 69% 사용 |
| CPU | 89m | request 500m | **5.6배 과할당** |

CPU request 500m은 실측 대비 지나치게 컸고, 이 과할당이 core 노드 스케줄링 여력을 통째로 잡아먹고 있었습니다.

ADR 0011(Prometheus Agent Mode 도입)은 이미 Proposed 상태로 문서화되어 있었고, 2026-04-13 rightsizing 세션의 Follow-up에도 "Agent mode 전환 + Grafana 대시보드 영향 전수 확인 선행"이 등재되어 있었습니다. 이미 준비된 결정을 실행할 때였습니다.

---

## 🤔 원인 1: OTel collector endpoint 오타 + service.namespace 누락

Go 서비스가 traces export에 실패하는 원인은 두 가지가 겹친 결과였습니다.

**Collector 이름 불일치**가 첫 번째였습니다.
Go values에는 collector 엔드포인트가 `otel-collector.monitoring.svc.cluster.local:4317`로 설정되어 있었는데, 실제 prod에 배포된 front collector의 Service 이름은 `otel-front-prod.monitoring.svc:4317`이었습니다. Java 쪽 Instrumentation CR을 기준으로 삼았어야 했지만 Go values에는 과거 이름이 그대로 남아 있었습니다. DNS 해석이 실패하면서 grpc의 name resolver가 "produced zero addresses"를 반환한 것입니다.

**`service.namespace` 리소스 속성 누락**이 두 번째였습니다.
Java 쪽은 `OTEL_RESOURCE_ATTRIBUTES=service.namespace=goti,...`를 넣어두어 Prometheus의 `job` 라벨이 `goti/goti-stadium` 형태로 생성됐습니다. 반면 Go 쪽은 이 속성이 비어 있어 `job` 라벨이 단순히 `goti-stadium-go`로만 찍혔습니다. Grafana panel의 쿼리가 `job="goti/$service_name"` 형태를 기대하고 있어 Go 서비스 메트릭은 모두 빈 결과를 반환했습니다.

## 🤔 원인 2: CPU 과할당으로 인한 core 노드 포화

monitoring 스택이 Pending에 빠진 이유는 단순했습니다.
Prometheus 한 pod가 500m CPU를 request로 잡고 있었고, 실제로는 89m만 사용하고 있었습니다.
5.6배 과할당이 core 노드의 잔여 여유를 거의 다 소진했습니다.

이 상황에서 monitoring 스택에 추가 pod가 필요해지자, 기존 노드들이 request 기준으로 포화되어 스케줄링이 막혔습니다.
10분이 지나도 5개의 pod가 Pending 상태에서 벗어나지 못했습니다.

근본 해결책은 Prometheus를 **Agent mode**로 전환하는 것이었습니다.
Grafana는 이미 `prometheusService: mimir-prod-query-frontend`로 설정되어 Mimir만 쿼리하고 있었고, alert 평가도 `mimir-prod-ruler`가 9시간째 안정적으로 담당하고 있었습니다. Prometheus 로컬 TSDB는 사실상 중복 저장에 지나지 않았습니다.

---

## ✅ 해결: 6단계 연쇄 복구

연쇄 장애를 하나씩 풀어나갔습니다.

### Step 1: OTel 라벨 매핑 수정

prod values.yaml 6개 파일에 두 가지 수정을 적용했습니다.

```yaml
# prod values.yaml (Go 서비스 공통)
otel:
  endpoint: "otel-front-prod.monitoring.svc:4317"  # 기존: otel-collector.monitoring.svc.cluster.local:4317
  env:
    OTEL_RESOURCE_ATTRIBUTES: "service.namespace=goti,deployment.environment.name=prod"
```

endpoint를 실제 배포된 collector 이름에 맞췄고, `service.namespace=goti`를 추가해 Prometheus `job` 라벨이 Java와 동일한 `goti/goti-*` 형식을 갖도록 통일했습니다.

Goti-k8s 커밋 `275ae04`로 반영했습니다. `prod-gcp` 환경은 collector가 아직 배포되어 있지 않아 이번 범위에서는 건너뛰었습니다.

### Step 2: Agent mode 전환 설정

`values-stacks/prod/kube-prometheus-stack-values.yaml`을 다음과 같이 수정했습니다.

```yaml
prometheus:
  prometheusSpec:
    enableFeatures:
      - agent                       # Agent mode 활성화
    retention: ""                    # 로컬 retention 제거
    # storageSpec 전체 삭제 (PVC 불필요)
    resources:
      requests:
        cpu: 100m                    # 기존: 500m
        memory: 512Mi                # 기존: 2Gi (초기안)
      limits:
        cpu: 500m                    # 기존: 1
        memory: 1Gi                  # 기존: 4Gi
    containers:
      - name: prometheus
        env:
          - name: GOMEMLIMIT
            value: "800MiB"          # 기존: 4GiB
```

Agent mode는 로컬 TSDB 대신 remote-write만 수행하기 때문에, retention과 PVC가 불필요해집니다. 리소스도 그만큼 줄여 잡았습니다.

Goti-monitoring 커밋 `05f0b37`로 반영했습니다.

### Step 3: ArgoCD sync 블록 — NetworkPolicy whitelist

배포를 시도하자 ArgoCD sync가 다음 메시지로 막혔습니다.

```text
NetworkPolicy/kube-prometheus-stack-prod-grafana-image-renderer-ingress:
  resource networking.k8s.io:NetworkPolicy is not permitted in project monitoring
```

원인은 Helm subchart의 side-effect였습니다.
`grafana-image-renderer` subchart가 자동으로 NetworkPolicy를 생성하는데, monitoring AppProject의 `namespaceResourceWhitelist`에는 이 리소스 종류가 등록되어 있지 않았습니다.

AppProject에 `networking.k8s.io/NetworkPolicy`를 추가하고 Goti-k8s `3e3ca64`로 커밋했습니다. 이 변경이 적용되려면 goti-projects ArgoCD app이 먼저 반영되어야 하므로 hard refresh를 수행했습니다.

### Step 4: Operator Pending 데드락 해소

whitelist 문제를 푼 다음에는 더 어려운 문제를 만났습니다.
`kube-prometheus-stack-operator` pod 자체가 Pending 상태였습니다.

상황을 정리하면 순환 구조였습니다.

1. 노드 CPU 부족으로 operator pod가 스케줄되지 못합니다.
2. operator가 없으니 Prometheus StatefulSet spec을 업데이트할 수 없습니다.
3. 기존 Prometheus pod는 여전히 500m request로 CPU를 점유합니다.
4. CPU 여유가 생기지 않으니 operator는 계속 Pending입니다.

이 데드락을 끊는 방법은 **기존 Prometheus pod를 먼저 내리는 것**이었습니다.

```bash
$ kubectl scale sts prometheus-kube-prometheus-stack-prod-prometheus --replicas=0
statefulset.apps/prometheus-kube-prometheus-stack-prod-prometheus scaled
```

기존 Prometheus pod가 종료되면서 500m CPU가 해제됐고, operator가 즉시 스케줄 가능해졌습니다. operator가 기동하자 새 spec으로 Prometheus STS를 재생성했고, Agent mode 설정이 적용된 pod가 Running 상태로 올라왔습니다.

이후 ASG scale-up으로 올라온 새 노드(`ip-10-1-2-37`)까지 join하면서 Pending 상태의 5개 pod가 순차적으로 해소됐습니다.

GitOps 관점에서 `kubectl scale`은 drift를 만드는 작업이지만, operator가 즉시 원하는 상태로 되돌리기 때문에 실질적 위험은 없었습니다.

### Step 5: Agent mode OOMKill → limit 재조정

배포 직후 새 Prometheus pod가 CrashLoopBackOff에 빠졌습니다.

```bash
$ kubectl describe pod prometheus-kube-prometheus-stack-prod-prometheus-0
...
Last State:     Terminated
  Reason:       OOMKilled
  Exit Code:    137
  Limits:
    memory:  1Gi
```

1Gi limit이 초기 구동 피크를 흡수하지 못했습니다.
Agent mode는 평시에는 메모리를 적게 쓰지만, 기동 시점에 **WAL replay + 300K series 초기 scrape**가 동시에 일어나며 피크가 1.3Gi 정도까지 올라갑니다. 처음 설정한 1Gi는 너무 빡빡했습니다.

limit을 조정했습니다.

```yaml
resources:
  limits:
    memory: 2Gi                     # 기존: 1Gi
env:
  - name: GOMEMLIMIT
    value: "1600MiB"                # 기존: 800MiB
```

Goti-monitoring 커밋 `a53db01`로 반영했습니다. ArgoCD가 즉시 반영하지 않아 Prometheus CR을 직접 patch해 적용하고, 이후 자동 sync로 다시 맞췄습니다.

안정화 이후 실측 지표는 다음과 같았습니다.

| 지표 | 실측 |
|---|---|
| CPU | 177m |
| Memory | **492Mi** / 2Gi limit |

전환 전 실측 2.77Gi 대비 **약 88% 감소**했습니다.

### Step 6: Grafana `$deployment` 변수 parse error

마지막 문제는 대시보드 쪽에서 나왔습니다.

```text
1:50 parse error: unexpected <op:>>
```

팝업이 뜨는 panel을 추적해 보니, `infra-pod-health.json`의 `$deployment` 변수 쿼리였습니다.
이전에 Java 0/0 deployment를 드롭다운에서 제외하려고 다음처럼 수정한 것이 원인이었습니다(커밋 `1c46d13`).

```text
label_values(kube_deployment_spec_replicas{namespace=~"$namespace"} > 0, deployment)
```

문법 자체는 PromQL로서 유효합니다. 문제는 Grafana의 `label_values()` 함수가 내부적으로 Prometheus의 `/api/v1/series` endpoint를 사용한다는 점이었습니다.
**이 endpoint는 label matcher만 허용하고 비교 연산자는 거부합니다.**

대안으로 `query_result()` + regex 추출로 변경했습니다(커밋 `94b00e4`).

```text
query: query_result(kube_deployment_spec_replicas{namespace=~"$namespace"} > 0)
regex: /deployment="([^"]+)"/
```

`query_result()`는 `/api/v1/query` instant endpoint를 사용해 일반 PromQL 연산자를 지원합니다.
이제 `replicas > 0`인 deployment만 드롭다운에 노출되고, Java 0/0 잔존 항목이 사라졌습니다. grafana 차트와 k8s values 두 곳을 모두 동기화했습니다.

---

## 📊 최종 상태

| 지표 | Before | After | 변화 |
|---|---|---|---|
| Prometheus 메모리 (실측) | 2770Mi | **492Mi** | **-82%** |
| Prometheus CPU request | 500m | **100m** | -80% |
| Prometheus 메모리 limit | 4Gi | 2Gi | -50% |
| Pending monitoring pods | 5개 (10분+) | **0** | 해소 |
| Grafana `$deployment` 드롭다운 | Java 0/0 포함 | replicas>0만 노출 | clean |
| core 노드 CPU 포화 | 87~97% | 정상 | - |

Agent mode 전환이 단일 조치로 가장 큰 영향을 미쳤습니다.
로컬 TSDB 제거와 GOMEMLIMIT 축소가 결합되어 메모리 사용량이 82% 줄었고, 이에 따라 core 노드 포화가 해소되면서 Pending pod 5개가 한꺼번에 스케줄됐습니다.

---

## 📚 배운 점

**Agent mode는 Mimir 중심 구조에서 중복 저장을 제거하는 핵심 수단입니다.**
Grafana가 이미 Mimir query-frontend만 쿼리하고 alert 평가도 ruler에 있다면, Prometheus 로컬 TSDB는 remote-write 직전 스크랩 버퍼 외에 쓸모가 거의 없습니다. 이 구조에서는 Agent mode 전환이 선택이 아니라 정리 작업에 가깝습니다.

**Helm subchart의 자동 생성 리소스는 AppProject whitelist를 먼저 점검해야 합니다.**
`grafana-image-renderer`의 NetworkPolicy처럼, 사용자가 직접 선언하지 않은 리소스가 subchart에서 튀어나와 sync를 막을 수 있습니다. 대규모 Helm chart를 도입할 때는 AppProject `namespaceResourceWhitelist`에 `networking.k8s.io/NetworkPolicy`, `policy/PodDisruptionBudget` 같은 흔한 보조 리소스까지 미리 포함해 두는 편이 안전합니다.

**"CPU 부족 → operator 부족 → 기존 pod 유지 → CPU 부족" 데드락은 STS를 먼저 0으로 내려 끊습니다.**
operator 기반 아키텍처는 operator 자체가 스케줄되지 않으면 어떤 spec 변경도 적용되지 않습니다. 이 상황에서 `kubectl scale sts --replicas=0`은 GitOps drift를 유발하지만, operator가 복구되자마자 원하는 상태로 되돌립니다. 비상시 회복 기법으로 기억해 둘 가치가 있습니다.

**Agent mode의 OOM은 TSDB 부재와 별개로 기동 피크에서 발생합니다.**
평시 메모리는 절반 이하지만, WAL replay와 초기 scrape가 겹치는 기동 시점에는 평소의 2~3배 피크가 생깁니다. limit을 평시 실측 기준으로 낮게 잡으면 CrashLoop에 빠질 수 있습니다. 기동 피크를 흡수할 여유를 남겨 둬야 합니다.

**Grafana `label_values()`는 내부적으로 `/api/v1/series`를 사용해 비교 연산자를 허용하지 않습니다.**
변수 쿼리에 필터 조건이 필요하면 `query_result()` + regex 패턴을 써야 합니다. 이 제약은 Grafana 문서에 눈에 잘 띄지 않지만, 변수 panel이 "parse error: unexpected <op:>>" 같은 메시지를 내면 거의 이 원인입니다.

---

## Follow-up

- ADR 0011 status Proposed → Accepted 전환(본 세션에서 실행됨)
- `dev` 환경에도 Agent mode 적용 여부 검토(현재 prod만)
- `prod-gcp` OTel collector 미배포 상태 정리 — Go 서비스 traces export 실패가 고정화 중
- Istio sidecar request 100m 재검토(rightsizing 세션에서 이어진 TODO)
