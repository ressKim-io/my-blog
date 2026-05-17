---
title: "OpenCost — K8s 리소스 사용량을 비용으로 환산하는 원리"
excerpt: "OpenCost가 K8s 리소스 사용량과 클라우드 Pricing API를 결합해 namespace·pod별 비용을 산출하고, Prometheus exporter로 메트릭을 노출하는 동작 원리를 설명합니다"
category: monitoring
tags:
  - go-ti
  - opencost
  - finops
  - cost-allocation
  - prometheus-exporter
  - predict-linear
  - concept
series:
  name: "goti-deepdive-observability"
  order: 10
date: "2026-04-02"
---

## 한 줄 요약

> OpenCost는 K8s 리소스 사용량(CPU·Memory request/usage)과 클라우드 Pricing API에서 가져온 노드 단가를 결합해 namespace·pod 단위로 비용을 분해하고, 그 결과를 Prometheus exporter 형태로 노출하는 CNCF Incubating 프로젝트입니다

---

## 🤔 무엇을 푸는 기술인가

클라우드 비용 청구서는 인스턴스 유형·리전·서비스 단위로 집계됩니다 AWS 비용 대시보드를 열어도 "이번 달 EKS 클러스터 총 비용 $X"는 보이지만, "ticketing 서비스가 그 중 $Y를 썼다"는 정보는 기본 제공되지 않습니다

K8s는 하나의 노드 위에 복수의 Pod을 스케줄하고, 각 Pod은 CPU·Memory를 다른 비율로 사용합니다 이 혼재 상태에서 "namespace별·서비스별 비용"을 산출하려면 리소스 사용량을 분해해서 노드 비용에 비례 배분하는 추가 계산이 필요합니다

**OpenCost**는 이 계산을 K8s-native 방식으로 수행합니다 핵심 개념은 두 가지입니다

- **Cost Allocation**: 노드 비용을 Pod의 리소스 요청량(request) 비율로 namespace·pod·label에 할당하는 분해 연산
- **Idle Cost**: 전체 할당 가능 용량에서 실제 Pod이 요청하지 않은 부분 — 리소스를 예약했지만 아무 Pod도 사용하지 않는 "낭비" 구간

이 두 개념을 구분하지 않으면 비용 효율화 지점을 찾기 어렵습니다 서비스별 비용이 낮아 보여도 Idle Cost가 높다면 노드가 과잉 프로비저닝된 것이고, Pod별 비용이 높다면 리소스 요청 조정이 필요합니다

---

## 🔧 동작 원리

### 데이터 수집 — 세 개의 입력 소스

OpenCost는 비용을 계산하기 위해 세 개의 독립적인 데이터를 수집합니다

**K8s API Server**에서 Pod spec(request·limit), 노드 메타데이터, 네임스페이스·레이블을 읽습니다 이 데이터는 "어떤 Pod이 얼마의 리소스를 요청했는가"를 알려줍니다

**cAdvisor / kubelet**에서 실제 사용량 시계열을 가져옵니다 request만으로는 예약량 기준 비용 배분이 되지만, 실제 사용량(usage)을 더하면 Efficiency 지표도 계산할 수 있습니다 Efficiency = usage / request로, 1에 가까울수록 리소스를 빽빽하게 쓰는 Pod입니다

**클라우드 Pricing API**에서 노드 인스턴스 유형의 시간당 단가를 가져옵니다 AWS는 `pricing.us-east-1.amazonaws.com`, GCP는 `cloudbilling.googleapis.com`을 사용합니다 OpenCost는 IRSA(IAM Roles for Service Accounts) 또는 Workload Identity로 이 API에 접근합니다 온디맨드 단가가 기준이며, RI·Spot 할인은 별도 CUR/BigQuery 연동이 필요합니다

### Cost Allocation — 비용 분해 연산

![OpenCost 비용 데이터 파이프라인 흐름도|tall](/diagrams/goti-deepdive-opencost-1.svg)

위 흐름도는 OpenCost가 세 개의 입력 소스를 받아 비용 메트릭을 산출하고 Prometheus exporter를 거쳐 Mimir와 Grafana까지 전달되는 전체 경로를 보여줍니다 핵심은 가운데 OpenCost 엔진 박스입니다 — 이 엔진이 수집된 리소스 사용량과 단가를 결합해 분해 연산을 수행합니다

Cost Allocation의 핵심 공식은 다음과 같습니다

```text
pod_cpu_cost = node_hourly_cost
               × cpu_weight
               × (pod_cpu_request / node_total_cpu)

pod_memory_cost = node_hourly_cost
                  × memory_weight
                  × (pod_memory_request / node_total_memory)
```

`cpu_weight`와 `memory_weight`는 기본값 0.5/0.5로 CPU와 Memory 비용을 균등 분배합니다 인스턴스 유형에 따라 CPU 집약적(c5 계열) 또는 Memory 집약적(r5 계열)이라면 가중치를 조정해 단가 분배를 더 정확하게 할 수 있습니다

Pod별로 계산된 비용은 namespace, label, deployment 기준으로 상위 집계됩니다 `namespace:cost_hourly:sum`은 namespace 레벨, `deployment:cost_hourly:sum`은 deployment 레벨 집계입니다

### namespace·pod 비용 분해 구조

![Cost Allocation — 노드 비용 namespace·pod 분해 구조도|tall](/diagrams/goti-deepdive-opencost-2.svg)

위 구조도는 하나의 노드($0.192/hr, m5.xlarge)에서 CPU와 Memory 요청 비율에 따라 ticketing 네임스페이스와 resale 네임스페이스로 비용이 분배되고, 아무도 예약하지 않은 남은 용량이 Idle Cost로 분리되는 흐름을 보여줍니다

ticketing Pod이 전체 vCPU 중 25%를 request한다면 `0.192 × 0.5 × 0.25 = $0.024/hr`가 CPU 비용으로 배분됩니다 이 계산이 노드 수 × 네임스페이스 수 × 샘플 주기로 반복됩니다 OpenCost는 이 연산을 분마다 수행해 거의 실시간 비용 데이터를 제공합니다

**Idle Cost**는 `노드 용량 합계 - 전체 Pod request 합계`로 산출됩니다 이 구간은 어떤 namespace에도 귀속되지 않습니다 클러스터 전체 Idle Cost 비율이 높다면 노드 수를 줄이거나 Karpenter 같은 오토스케일러로 빈 노드를 회수해야 합니다

### Prometheus exporter 모델

OpenCost는 별도 데이터베이스 없이 계산된 비용 메트릭을 `/metrics` 엔드포인트로 직접 노출합니다 이 설계는 기존 Prometheus 수집 파이프라인을 그대로 재활용할 수 있게 합니다

노출되는 주요 메트릭은 다음과 같습니다

```text
# namespace별 시간당 비용
opencost_namespace_cost_hourly{namespace="ticketing",cluster="goti-eks"} 0.072

# pod별 CPU 비용
opencost_pod_cpu_cost_hourly{namespace="ticketing",pod="ticket-api-xxx"} 0.024

# pod별 Memory 비용
opencost_pod_memory_cost_hourly{namespace="ticketing",pod="ticket-api-xxx"} 0.010

# 클러스터 전체 Idle Cost
opencost_idle_cost_hourly{cluster="goti-eks"} 0.048

# pod CPU 효율성 (usage / request)
container_cpu_allocation{namespace="ticketing",pod="ticket-api-xxx"} 0.65
```

Prometheus ServiceMonitor가 이 엔드포인트를 스크레이프하면 메트릭이 Mimir에 저장되고, Grafana에서 FinOps 대시보드로 시각화됩니다 OpenCost 자체는 상태를 갖지 않고, 재시작 시에도 Pricing API를 다시 호출하면 됩니다

### predict_linear를 활용한 예산 예측

비용이 메트릭으로 노출되면 PromQL의 `predict_linear` 함수를 활용해 월말 예산을 예측할 수 있습니다

```promql
# 현재 추세로 30일 후 monthly 비용 예측
predict_linear(
  namespace:cost_hourly:sum{namespace="ticketing"}[7d],
  30 * 24 * 3600
) * 720
```

이 쿼리는 최근 7일간의 `cost_hourly` 추세를 선형 회귀해 30일 후 시간당 비용을 추정하고, 720시간(30일)을 곱해 월 비용으로 환산합니다 Recording rule에 저장해두면 Alertmanager에서 임계값 초과 알림으로 활용할 수 있습니다

```yaml
# recording rule 예시
- record: namespace:cost_monthly_predicted:sum
  expr: |
    predict_linear(
      namespace:cost_hourly:sum[7d],
      30 * 24 * 3600
    ) * 720
```

이 패턴을 사용하면 "이달 말 ticketing 서비스 비용이 $150를 넘을 것으로 예측됩니다"는 사전 알림이 가능합니다 비용이 실제로 초과한 뒤가 아니라 추세 단계에서 개입할 수 있습니다

### Showback과 Chargeback

OpenCost가 namespace·label 기준으로 비용을 분해하면 두 가지 조직적 활용이 가능합니다

**Showback**은 비용을 각 팀이나 서비스에 "보여주기만" 하는 방식입니다 "ticketing 팀이 이번 달 $320를 사용했습니다"를 리포트로 공유하지만, 실제 내부 정산은 하지 않습니다 비용 의식을 팀에 심어주는 첫 단계로 적합합니다

**Chargeback**은 한 단계 더 나아가 비용을 실제 내부 정산에 반영하는 방식입니다 클라우드 비용을 수익 창출 서비스와 지원 서비스로 나눠 P&L에 반영하거나, 프로젝트별 예산 소진을 실시간으로 추적합니다

두 방식 모두 namespace·label 기준의 정확한 비용 분해가 전제 조건입니다 OpenCost의 Cost Allocation이 이 분해를 담당합니다

---

## 📐 세부 동작과 옵션

### 비용 배분 기준 비교

OpenCost는 비용 배분 방식을 세 가지로 설정할 수 있습니다

| 배분 기준 | 의미 | 적합한 상황 |
|---|---|---|
| **request** (기본) | Pod이 요청한 용량 기준 | 리소스 예약 비용을 책임지게 하려는 경우 |
| **usage** | 실제 사용한 용량 기준 | 사용한 만큼만 비용 귀속이 원칙인 경우 |
| **max(request, usage)** | 둘 중 큰 값 기준 | 보수적 비용 회계 |

request 기준을 사용하면 Pod이 CPU를 실제로 1% 썼어도 request로 50%를 예약했다면 50%에 해당하는 비용이 배분됩니다 이 방식은 리소스 낭비에 대한 책임을 명확히 하는 효과가 있습니다

### Idle Cost 분리 방식

Idle Cost는 세 가지 형태로 발생합니다

| 유형 | 원인 | 확인 메트릭 |
|---|---|---|
| **Cluster Idle** | 어떤 Pod도 스케줄되지 않은 빈 노드 전체 | `opencost_idle_cost_hourly` |
| **Unallocated** | request 미설정 Pod — 비용 귀속 불가 | `container_cpu_allocation == 0` |
| **Overhead** | K8s 시스템 Pod(kube-proxy, CoreDNS 등) | namespace `kube-system` 비용 합계 |

request를 설정하지 않은 Pod은 비용을 배분받지 못하고 Unallocated로 처리됩니다 이는 FinOps 관점에서 "이 서비스의 비용을 알 수 없음"을 의미합니다 모든 서비스 Pod에 resource request를 설정하는 것이 정확한 비용 분석의 전제 조건입니다

### Recording rule 세트

비용 메트릭은 원시값 그대로보다 recording rule로 집계해 사용하는 것이 효율적입니다 집계 빈도를 줄이고 대시보드 쿼리 속도를 높이기 위해서입니다

```yaml
groups:
  - name: opencost.rules
    interval: 5m
    rules:
      # namespace별 시간당 비용 합계
      - record: namespace:cost_hourly:sum
        expr: |
          sum by (namespace, cluster) (
            opencost_namespace_cost_hourly
          ) or vector(0)

      # 클러스터 월간 비용 (현재 시간당 × 720)
      - record: cluster:cost_monthly:sum
        expr: |
          sum by (cluster) (
            namespace:cost_hourly:sum
          ) * 720

      # pod CPU 효율성
      - record: pod:cpu_efficiency:ratio
        expr: |
          rate(container_cpu_usage_seconds_total[5m])
          / on(pod, namespace)
          kube_pod_container_resource_requests{resource="cpu"}
```

`or vector(0)` 패턴은 OpenCost Pod이 재시작되거나 일시적으로 스크레이프에 실패했을 때 메트릭 공백 대신 0이 반환되도록 합니다 Alertmanager 알림이 `no data`로 오발동되는 것을 방지하는 데 효과적입니다

---

## 🧩 go-ti에서는

go-ti 멀티클라우드 환경(EKS + GKE)에서 각 클러스터에 OpenCost를 Helm으로 배포했습니다 EKS에는 Terraform IRSA로 AWS Pricing API 접근 권한을 부여했고, GKE에서는 Workload Identity로 동일한 방식으로 권한을 설정했습니다 두 클러스터 모두 동일한 Helm chart와 동일한 메트릭 이름을 사용하므로, `cluster` 레이블 하나로 EKS/GKE 비용을 통합 집계할 수 있었습니다

기존 모니터링 스택(Prometheus ServiceMonitor → Mimir → Grafana → Alertmanager → Discord)을 그대로 재활용했기 때문에 별도 인프라 추가 없이 도입이 완료됐습니다 `infra-finops.json` Grafana 대시보드에 OpenCost 메트릭을 연결하고, `predict_linear` 기반 예산 예측 알림을 Discord `#goti-finops` 채널로 연동했습니다 RI·Spot 할인 미반영 문제는 Phase 3에서 AWS CUR·GCP BigQuery billing export로 보완할 예정입니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [FinOps 도구 선택 — OpenCost 기반 비용 모니터링 도입](/essays/goti-finops-opencost-adoption-adr)에 정리했습니다

---

## 📚 핵심 정리

- OpenCost는 노드 단가(Pricing API) × Pod 리소스 요청 비율로 namespace·pod별 비용을 분해하는 Cost Allocation 연산이 핵심입니다 — 별도 DB 없이 Prometheus exporter로 메트릭을 바로 노출합니다
- Idle Cost(아무 Pod도 요청하지 않은 용량)와 Unallocated(request 미설정 Pod)를 분리하면 "비용 낭비 vs 비용 불명확"을 구별할 수 있습니다
- `predict_linear` + recording rule로 월말 예산을 추세 기반 예측해 비용 급증 전에 알림을 받을 수 있습니다
- Showback(비용 가시성)에서 Chargeback(내부 정산)으로 이어지는 FinOps 성숙 경로 모두 namespace·label 기준의 정확한 분해가 전제입니다
- 모든 서비스 Pod에 resource request를 설정하는 것이 정확한 비용 분석의 필수 조건입니다 — request 없는 Pod은 비용 귀속이 불가능합니다
