---
title: "Prometheus 메모리 82% 감축 — 부하테스트 직전 무너진 관측 스택 6단계 복구"
excerpt: "부하테스트를 앞두고 core 노드 CPU가 포화되면서 monitoring pod 5개가 Pending에 빠졌습니다. OTel 라벨 수정에서 시작해 Agent mode 전환, operator 데드락, OOMKill, Grafana 변수 파싱 오류까지 연쇄로 드러난 문제를 하나씩 풀어낸 기록입니다"
category: monitoring
tags:
  - go-ti
  - Observability
  - Prometheus
  - Agent-Mode
  - Grafana
  - ArgoCD
  - OpenTelemetry
  - troubleshooting
series:
  name: "goti-observability-ops"
  order: 16
date: "2026-04-14"
---

## 한 줄 요약

> 부하테스트 직전에 관측 스택이 노드 CPU 포화로 멈춰 섰습니다. Prometheus Agent mode 전환을 기회 삼아 복구하는 과정에서 NetworkPolicy whitelist와 operator 데드락, OOMKill, Grafana 변수 파싱 오류가 차례로 드러났습니다. 최종적으로 Prometheus 메모리를 82% 줄이고 Pending pod 5개를 모두 해소했습니다

---

## 🔥 문제: 부하테스트 직전에 관측 스택이 멈춰 섰다

### 기대한 동작

부하테스트 전에 관측 스택이 정상 가동되고, Grafana에서 prod 환경 Go 서비스 메트릭이 보여야 했습니다

### 실제 상황

두 가지 문제가 한꺼번에 드러났습니다

먼저 **Go cutover 이후 Grafana 대시보드에 메트릭이 뜨지 않았습니다**. Go pod 로그에는 OTel collector로 트레이스를 못 보낸다는 에러가 반복되고 있었습니다

```text
traces export: name resolver error: produced zero addresses
```

동시에 **monitoring 네임스페이스 전체가 Pending**이었습니다. core 노드 CPU 사용률이 87~97%까지 올라 포화됐고, pod 5개가 10분째 스케줄되지 못한 채 대기 중이었습니다

시작 시점의 Prometheus 리소스 실측은 이랬습니다

| 지표 | 실측 | 설정 | 비고 |
|---|---|---|---|
| Memory | 2.77Gi | limit 4Gi | 69% 사용 |
| CPU | 89m | request 500m | **5.6배 과할당** |

CPU request 500m은 실측 대비 지나치게 컸습니다. 이 과할당 하나가 core 노드의 스케줄링 여력을 통째로 잡아먹고 있었습니다

ADR 0011(Prometheus Agent Mode 도입)은 이미 Proposed 상태로 문서화돼 있었고, 하루 전 rightsizing 세션의 Follow-up에도 Agent mode 전환이 올라와 있었습니다. 준비된 결정을 실행할 때였습니다

---

## 🤔 원인 1: collector 이름 불일치 + service.namespace 누락

Go 서비스가 트레이스를 못 보낸 이유는 두 가지가 겹친 결과였습니다

**collector 이름이 어긋나 있었습니다.** Go values에는 엔드포인트가 `otel-collector.monitoring.svc.cluster.local:4317`로 적혀 있는데, 실제 prod에 배포된 front collector의 Service 이름은 `otel-front-prod.monitoring.svc:4317`이었습니다

Java 쪽 Instrumentation CR을 기준으로 삼았어야 하는데 Go values에 옛 이름이 남아 있었습니다. DNS 해석이 실패하면서 grpc가 "produced zero addresses"를 돌려준 것입니다

**`service.namespace` 리소스 속성이 빠져 있었습니다.** Java 쪽은 `OTEL_RESOURCE_ATTRIBUTES`에 `service.namespace=goti`를 넣어 둬서 Prometheus `job` 레이블이 `goti/goti-stadium` 형태로 붙습니다

반면 Go 쪽은 이 속성이 비어 있어 `job`이 그냥 `goti-stadium-go`로 찍혔습니다. Grafana panel 쿼리는 `job="goti/$service_name"`을 기대하고 있었으니 Go 서비스 메트릭은 전부 빈 결과였습니다

## 🤔 원인 2: CPU 과할당이 만든 노드 포화

monitoring 스택이 Pending에 빠진 이유는 단순했습니다

Prometheus 한 pod가 500m을 request로 잡고 실제로는 89m만 쓰고 있었습니다. 5.6배 과할당이 core 노드의 남은 여유를 거의 다 소진했습니다

이 상태에서 monitoring 스택에 pod가 더 필요해지자, 노드들이 request 기준으로 이미 꽉 차 있어 스케줄링이 막혔습니다

근본 해결은 Prometheus를 **Agent mode**로 바꾸는 것이었습니다

Grafana는 이미 `prometheusService: mimir-prod-query-frontend`로 Mimir만 조회하고 있었고, alert 평가도 `mimir-prod-ruler`가 9시간째 맡고 있었습니다. Prometheus의 로컬 TSDB는 사실상 중복 저장에 지나지 않았습니다

---

## ✅ 해결: 6단계 연쇄 복구

### Step 1: OTel 라벨 매핑 수정

prod values.yaml 6개 파일에 두 가지를 적용했습니다

```yaml
# prod values.yaml (Go 서비스 공통)
otel:
  endpoint: "otel-front-prod.monitoring.svc:4317"  # 기존: otel-collector.monitoring.svc.cluster.local:4317
  env:
    OTEL_RESOURCE_ATTRIBUTES: "service.namespace=goti,deployment.environment.name=prod"
```

엔드포인트를 실제 배포된 이름에 맞추고, `service.namespace=goti`를 넣어 `job` 레이블이 Java와 같은 `goti/goti-*` 형식이 되도록 통일했습니다

Goti-k8s 커밋 `275ae04`로 반영했습니다. `prod-gcp`는 collector가 아직 없어 이번 범위에서 뺐습니다

### Step 2: Agent mode 전환 설정

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

Agent mode는 로컬 TSDB 없이 remote-write만 하므로 retention과 PVC가 필요 없습니다. 리소스도 그만큼 줄여 잡았습니다

Goti-monitoring 커밋 `05f0b37`로 반영했습니다

### Step 3: ArgoCD sync 차단 — NetworkPolicy whitelist

배포하자 ArgoCD sync가 막혔습니다

```text
NetworkPolicy/kube-prometheus-stack-prod-grafana-image-renderer-ingress:
  resource networking.k8s.io:NetworkPolicy is not permitted in project monitoring
```

Helm subchart가 만든 리소스가 원인이었습니다. `grafana-image-renderer` subchart가 NetworkPolicy를 자동 생성하는데, monitoring AppProject의 `namespaceResourceWhitelist`에 그 종류가 없었습니다

AppProject에 `networking.k8s.io/NetworkPolicy`를 추가하고 Goti-k8s `3e3ca64`로 커밋했습니다. 이 변경이 먹으려면 goti-projects app이 먼저 반영돼야 해서 hard refresh를 걸었습니다

### Step 4: operator Pending 데드락 해소

whitelist를 푼 다음 더 까다로운 문제를 만났습니다. `kube-prometheus-stack-operator` pod 자체가 Pending이었습니다

상황을 정리하면 순환이었습니다

1. 노드 CPU가 부족해 operator pod가 스케줄되지 못합니다
2. operator가 없으니 Prometheus StatefulSet spec을 갱신할 수 없습니다
3. 기존 Prometheus pod는 여전히 500m을 물고 있습니다
4. CPU 여유가 생기지 않으니 operator는 계속 Pending입니다

이 고리를 끊는 방법은 **기존 Prometheus pod를 먼저 내리는 것**이었습니다

```bash
kubectl scale sts prometheus-kube-prometheus-stack-prod-prometheus --replicas=0
```

기존 pod가 종료되며 500m이 풀렸고, operator가 곧바로 스케줄됐습니다. operator가 뜨자 새 spec으로 STS를 다시 만들었고 Agent mode 설정이 적용된 pod가 Running으로 올라왔습니다

이후 ASG scale-up으로 새 노드(`ip-10-1-2-37`)가 합류하면서 Pending이던 pod 5개가 차례로 해소됐습니다

GitOps 관점에서 `kubectl scale`은 drift를 만드는 작업입니다. 다만 operator가 곧바로 원하는 상태로 되돌리기 때문에 실질적인 위험은 없었습니다

### Step 5: Agent mode OOMKill — limit 재조정

배포 직후 새 Prometheus pod가 CrashLoopBackOff에 빠졌습니다

```bash
kubectl describe pod prometheus-kube-prometheus-stack-prod-prometheus-0
# Last State:     Terminated
#   Reason:       OOMKilled
#   Exit Code:    137
#   Limits:
#     memory:  1Gi
```

1Gi로는 기동 피크를 못 넘겼습니다

Agent mode는 평시 메모리가 적지만, 기동 시점에 **WAL replay와 300K series 초기 scrape가 동시에** 일어나며 1.3Gi 근처까지 올라갑니다. 처음 잡은 1Gi는 너무 빡빡했습니다

```yaml
resources:
  limits:
    memory: 2Gi                     # 기존: 1Gi
env:
  - name: GOMEMLIMIT
    value: "1600MiB"                # 기존: 800MiB
```

Goti-monitoring 커밋 `a53db01`로 반영했습니다. ArgoCD가 바로 반영하지 않아 Prometheus CR을 직접 patch해 적용하고, 이후 자동 sync로 다시 맞췄습니다

안정화 후 실측은 CPU 177m, Memory 492Mi(limit 2Gi)였습니다

### Step 6: Grafana `$deployment` 변수 파싱 오류

마지막 문제는 대시보드 쪽이었습니다

```text
1:50 parse error: unexpected <op:>>
```

팝업이 뜨는 panel을 따라가니 `infra-pod-health.json`의 `$deployment` 변수 쿼리였습니다. Java 0/0 deployment를 드롭다운에서 빼려고 이렇게 고쳐 둔 것이 원인이었습니다(커밋 `1c46d13`)

```text
label_values(kube_deployment_spec_replicas{namespace=~"$namespace"} > 0, deployment)
```

PromQL 문법 자체는 유효합니다. 문제는 Grafana의 `label_values()`가 내부적으로 Prometheus `/api/v1/series`를 쓴다는 데 있습니다

**이 엔드포인트는 label matcher만 받고 비교 연산자는 거부합니다**

`query_result()`와 regex 추출로 바꿨습니다(커밋 `94b00e4`)

```text
query: query_result(kube_deployment_spec_replicas{namespace=~"$namespace"} > 0)
regex: /deployment="([^"]+)"/
```

`query_result()`는 `/api/v1/query` instant endpoint를 쓰므로 일반 PromQL 연산자를 지원합니다. 이제 `replicas > 0`인 deployment만 드롭다운에 나오고 Java 0/0 잔여 항목이 사라졌습니다. grafana 차트와 k8s values 양쪽을 함께 맞췄습니다

---

## 📊 최종 상태

| 지표 | Before | After | 변화 |
|---|---|---|---|
| Prometheus 메모리 (실측) | 2,770Mi | **492Mi** | **-82%** |
| Prometheus CPU request | 500m | **100m** | -80% |
| Prometheus 메모리 limit | 4Gi | 2Gi | -50% |
| Pending monitoring pods | 5개 (10분+) | **0** | 해소 |
| Grafana `$deployment` 드롭다운 | Java 0/0 포함 | replicas>0만 노출 | 정리 완료 |
| core 노드 CPU | 87~97% | 정상 | — |

Agent mode 전환 하나가 가장 큰 몫을 했습니다

로컬 TSDB 제거와 GOMEMLIMIT 축소가 겹쳐 메모리가 82% 줄었고, 그만큼 core 노드 포화가 풀리면서 Pending pod 5개가 한꺼번에 스케줄됐습니다

---

## 📚 배운 점

**Mimir 중심 구조에서 Agent mode는 정리 작업에 가깝다**

Grafana가 이미 Mimir query-frontend만 조회하고 alert 평가도 ruler에 있다면, Prometheus 로컬 TSDB는 remote-write 직전 버퍼 말고는 쓸모가 없습니다. 이런 구조에서 Agent mode 전환은 선택이라기보다 중복 제거입니다

**Helm subchart가 몰래 만드는 리소스를 AppProject에서 먼저 확인한다**

`grafana-image-renderer`의 NetworkPolicy처럼, 직접 선언하지 않은 리소스가 subchart에서 튀어나와 sync를 막을 수 있습니다. 큰 chart를 도입할 때는 `networking.k8s.io/NetworkPolicy`나 `policy/PodDisruptionBudget` 같은 흔한 보조 리소스를 whitelist에 미리 넣어 두는 편이 안전합니다

**operator 데드락은 STS를 0으로 내려 끊는다**

operator 기반 구조는 operator 자체가 스케줄되지 않으면 어떤 spec 변경도 적용되지 않습니다. 이 상황에서 `kubectl scale sts --replicas=0`은 drift를 만들지만, operator가 살아나는 즉시 원하는 상태로 되돌립니다. 비상시 회복 수단으로 기억해 둘 만합니다

**Agent mode의 OOM은 TSDB와 무관하게 기동 피크에서 난다**

평시 메모리는 절반 이하지만, WAL replay와 초기 scrape가 겹치는 기동 시점에는 평소의 2~3배가 됩니다. limit을 평시 실측 기준으로 낮게 잡으면 CrashLoop에 빠집니다. 기동 피크를 흡수할 여유를 남겨야 합니다

**Grafana `label_values()`는 비교 연산자를 받지 않는다**

내부적으로 `/api/v1/series`를 쓰기 때문입니다. 변수 쿼리에 필터가 필요하면 `query_result()`와 regex를 써야 합니다. 이 제약은 문서에서 잘 안 보이는데, 변수 panel이 `parse error: unexpected <op:>>` 같은 메시지를 내면 거의 이 원인입니다

---

## Follow-up

- ADR 0011 status를 Proposed에서 Accepted로 전환 (본 세션에서 실행)
- dev 환경에도 Agent mode를 적용할지 검토 (현재 prod만)
- `prod-gcp` OTel collector 미배포 상태 정리 — Go 서비스 traces export 실패가 고정화 중
- Istio sidecar request 100m 재검토 (rightsizing 세션에서 이어진 TODO)
