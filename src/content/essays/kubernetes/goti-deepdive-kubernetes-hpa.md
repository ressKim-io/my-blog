---
title: "Kubernetes HPA — 메트릭 기반 replica 자동 조정 원리"
excerpt: "HorizontalPodAutoscaler가 metrics-server에서 CPU 사용량을 읽어 desired replica를 계산하고 Deployment를 조정하는 제어 루프 메커니즘을 설명합니다"
category: kubernetes
tags:
  - go-ti
  - HPA
  - HorizontalPodAutoscaler
  - metrics-server
  - KEDA
  - concept
series:
  name: "goti-deepdive-platform"
  order: 8
date: "2026-04-17"
---

## 한 줄 요약

> HPA는 metrics-server에서 현재 CPU 사용량을 읽어 `ceil(currentReplicas × 현재CPU / targetCPU)` 공식으로 desired replica를 계산하고, minReplicas·maxReplicas 범위 안에서 Deployment를 자동 조정하는 Kubernetes 내장 제어 루프입니다

---

## 🤔 무엇을 푸는 기술인가

웹 서비스 트래픽은 고정적이지 않습니다 점심 시간, 이벤트 시작 직전, 배치 작업 시간대에 급증하고, 그 외에는 낮아집니다 Pod replica 수를 항상 최대치로 유지하면 비용이 낭비되고, 최소치로 유지하면 급증 구간에 장애가 납니다

**HorizontalPodAutoscaler(HPA)**는 이 문제를 자동화합니다 메트릭을 주기적으로 관측하고, 현재 부하에 맞는 replica 수를 계산하여, 사람 개입 없이 Deployment를 조정합니다

HPA가 지원하는 메트릭 소스는 세 종류입니다

- **리소스 메트릭**: CPU·메모리 사용량 — metrics-server가 제공 (내장, 별도 구성 불필요)
- **커스텀 메트릭**: 애플리케이션이 노출하는 임의 메트릭 — Prometheus Adapter 등 어댑터 필요
- **외부 메트릭**: 클러스터 외부 시스템의 값 (큐 깊이, 클라우드 메트릭 등) — KEDA 등 별도 오퍼레이터 필요

go-ti 프로젝트에서 활성화한 것은 첫 번째, **리소스 메트릭(CPU)** 기반입니다 나머지는 아래 `📐 세부 동작` 섹션에서 KEDA와 비교하며 다룹니다

---

## 🔧 동작 원리

### 제어 루프 전체 흐름

HPA는 Kubernetes의 일반 제어 루프 원칙을 따릅니다 "현재 상태(actual)"를 관측하고, "원하는 상태(desired)"를 계산하여, 둘이 일치하도록 조정 명령을 내립니다 이 루프가 기본 **15초마다** 반복됩니다

![HPA 제어 루프 — metrics-server에서 Pod replica 조정까지|tall](/diagrams/goti-deepdive-kubernetes-hpa-1.svg)

다이어그램의 흐름을 순서대로 읽겠습니다

**① kubelet → metrics-server**: 각 노드의 kubelet이 cAdvisor를 통해 해당 노드에서 실행 중인 Pod의 CPU·메모리 사용량을 수집합니다 metrics-server는 클러스터 내 모든 kubelet에서 이 수치를 모아 집계합니다 metrics-server는 Kubernetes 클러스터에 애드온으로 배포되는 경량 집계 서버입니다 메트릭을 장기 보존하지 않으며, 가장 최근 값만 메모리에 유지합니다

**② metrics-server → HPA 컨트롤러**: `kube-controller-manager` 안에서 실행되는 HPA 컨트롤러가 15초마다 metrics-server의 `metrics.k8s.io` API를 조회합니다 이 API는 현재 각 Pod이 사용 중인 CPU(밀리코어 단위)를 반환합니다

**③ HPA 컨트롤러 → Deployment**: 컨트롤러가 desired replica를 계산하고, 현재 Deployment의 `spec.replicas`와 다르면 패치를 전송합니다 패치 대상은 HPA 리소스의 `scaleTargetRef` 필드가 가리키는 Deployment(또는 StatefulSet)입니다

**④ Deployment 컨트롤러 → ReplicaSet → Pod**: Deployment 컨트롤러가 변경된 `spec.replicas`를 감지해 ReplicaSet을 갱신합니다 ReplicaSet 컨트롤러가 현재 Pod 수와 목표 Pod 수의 차이를 채웁니다 새 Pod가 Running 상태에 도달하면 kubelet이 해당 Pod의 메트릭을 수집하기 시작합니다

이 루프가 계속 돌면서 클러스터는 부하에 따라 replica를 자동으로 늘리거나 줄입니다

### metrics-server가 없으면

metrics-server가 배포되지 않은 클러스터에서 CPU 기반 HPA를 생성하면 HPA의 `TARGETS` 컬럼이 `<unknown>/60%` 상태로 머물고 scaling이 발생하지 않습니다 HPA 이벤트에는 다음과 같은 메시지가 나타납니다

```text
unable to get metrics for resource cpu: unable to fetch metrics from resource metrics API
```

metrics-server 미설치 여부는 다음으로 확인합니다

```bash
kubectl get apiservice v1beta1.metrics.k8s.io
```

`Available` 상태가 `False`면 metrics-server가 없거나 비정상입니다

### desired replica 계산식

HPA 컨트롤러가 사용하는 핵심 공식은 다음과 같습니다

```text
desiredReplicas = ceil(currentReplicas × (현재 평균 CPU / targetCPU))
```

`ceil`은 올림 연산입니다 소수점이 생기면 항상 위로 올려 Pod 부족이 발생하지 않게 합니다

![desired replica 계산 흐름 — CPU 관측에서 범위 클램핑까지|tall](/diagrams/goti-deepdive-kubernetes-hpa-2.svg)

다이어그램의 세 단계를 자세히 설명합니다

**단계 1 — 현재 CPU 관측**: HPA 컨트롤러가 scaleTargetRef가 가리키는 Deployment의 모든 Running Pod CPU를 metrics-server API로 조회합니다 Pod 3개가 각각 50m, 60m, 70m을 사용 중이라면 합산은 180m, 평균은 60m입니다

**단계 2 — rawDesired 계산**: `currentReplicas × (현재 평균 CPU / targetCPU)` 공식을 적용합니다 targetCPU 60%를 설정했다면, Pod의 `resources.requests.cpu` 값의 60%를 목표 절대값으로 환산해 비교합니다 예를 들어 `requests.cpu: 500m`이고 `targetAverageUtilization: 60`이면 목표 절대값은 300m입니다 현재 평균이 450m이면 `ceil(3 × 450/300) = ceil(4.5) = 5`가 됩니다

**단계 3 — 범위 클램핑**: rawDesired가 `minReplicas`보다 작으면 minReplicas로, `maxReplicas`보다 크면 maxReplicas로 고정됩니다 이 범위가 운영자가 설정하는 안전 울타리입니다

### 쿨다운(stabilization window)

HPA는 계산된 desired가 매 루프마다 즉시 적용되지 않습니다 **쿨다운 기간** 동안 변경을 억제해 flapping(replica가 빠르게 오르내리는 현상)을 방지합니다

기본값은 다음과 같습니다

| 방향 | 기본 쿨다운 |
|------|------------|
| scale-up | 0초 (즉시 반응) |
| scale-down | 300초 (5분) |

scale-up을 즉시 허용하는 이유는 부하 급증 시 빠르게 replica를 확보해야 하기 때문입니다 반면 scale-down은 단기 트래픽 감소에 overreact하면 바로 올라가야 할 상황에 Pod이 없는 문제가 생기므로 보수적입니다

`HorizontalPodAutoscaler` 오브젝트의 `spec.behavior` 필드로 두 방향을 독립적으로 조정할 수 있습니다

```yaml
spec:
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Percent
          value: 100
          periodSeconds: 15
    scaleDown:
      stabilizationWindowSeconds: 300
```

---

## 📐 세부 동작과 옵션

### HPA 리소스 YAML 구조

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: goti-user-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: goti-user
  minReplicas: 3
  maxReplicas: 12
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
```

- `scaleTargetRef`: scaling 대상 Deployment(또는 StatefulSet·ReplicaSet)
- `minReplicas` / `maxReplicas`: replica 허용 범위
- `metrics[].resource.target.averageUtilization`: 목표 CPU 사용률 (%)

`autoscaling/v2` API가 현재 안정판입니다 `autoscaling/v1`은 CPU 단일 메트릭만 지원하고 `autoscaling/v2beta2`는 1.26부터 제거되었습니다

### HPA vs KEDA — 메트릭 소스 기준 비교

HPA가 지원하는 메트릭 범위보다 더 다양한 트리거가 필요할 때 **KEDA(Kubernetes Event-Driven Autoscaler)**를 사용합니다

| 항목 | HPA (리소스 메트릭) | KEDA |
|------|---------------------|------|
| 메트릭 소스 | CPU·메모리 (metrics-server) | Kafka 큐 깊이, SQS 메시지 수, Prometheus 쿼리, Cron 등 50+ 스케일러 |
| 설치 | Kubernetes 내장 | 별도 오퍼레이터 설치 필요 |
| 0 replica 지원 | 미지원 (minReplicas ≥ 1) | 지원 (트리거가 0이면 0으로 축소) |
| 복잡도 | 낮음 | 어댑터 구성 필요 |
| 적합 워크로드 | CPU·메모리 비례 서비스 | 큐 기반·이벤트 기반·스케줄 기반 워크로드 |

HPA는 "현재 얼마나 바쁜가(리소스 사용률)"를 기준으로 scaling합니다 KEDA는 "처리할 작업이 얼마나 쌓였는가(이벤트/메시지 수)"를 기준으로 scaling합니다 두 기준은 본질적으로 다릅니다

CPU 기반 HPA는 트래픽이 들어오고 CPU가 올라간 **뒤** 반응합니다 KEDA Kafka 스케일러는 메시지가 큐에 쌓인 **즉시** 반응하므로 응답성이 더 빠릅니다 반면 KEDA는 어댑터(스케일러) 구성과 외부 메트릭 소스 연결이 선행되어야 합니다

---

## 🧩 go-ti에서는

go-ti는 2026-04-17 기준으로 prod-gcp 클러스터의 6개 Go 서비스에 HPA를 활성화했습니다 기존에는 KEDA를 사용하려 했으나, KEDA ScaledObject가 `mimir-prod-query-frontend.monitoring.svc`를 참조하고 있었는데 해당 서비스가 prod-gcp에 존재하지 않아 trigger가 실질적으로 비활성 상태였습니다 이를 제거하고 단순한 CPU 기반 HPA로 교체했습니다

targetCPU는 60%로 설정해 부하 급증 시 공격적으로 scale-up되도록 했습니다 replica 범위는 서비스별로 다음과 같이 설정했습니다

| 서비스 | minReplicas | maxReplicas |
|--------|-------------|-------------|
| goti-user | 3 | 12 |
| goti-queue | 2 | 12 |
| goti-ticketing | 2 | 12 |
| goti-resale | 2 | 8 |
| goti-stadium | 2 | 8 |
| goti-payment | 2 | 10 |

KEDA는 `keda.enabled: false`로 비활성 상태를 유지합니다 GCP Managed Prometheus → KEDA adapter 구축이 완료되면 Prometheus 기반 트리거를 재도입할 자리를 남겨 두었습니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(Circuit Breaker와 HPA를 함께 채택한 배경, KEDA 비활성화 경위)은
> [Multi-cloud 장애 대응 — Circuit Breaker + HPA 결정](/logs/goti-multicloud-circuit-breaker-hpa-adr)에 정리했습니다

---

## 📚 핵심 정리

- **HPA는 15초 주기 제어 루프**: metrics-server에서 현재 CPU를 읽고 `ceil(currentReplicas × 현재CPU / targetCPU)` 공식으로 desired replica를 계산하여 Deployment를 패치합니다
- **metrics-server가 선행 조건**: metrics-server 없이는 HPA가 `<unknown>` 상태에 머물러 scaling이 발생하지 않습니다 `v1beta1.metrics.k8s.io` API 서비스 상태를 먼저 확인해야 합니다
- **minReplicas·maxReplicas가 안전 울타리**: rawDesired 계산 후 이 범위로 클램핑됩니다 운영 최솟값(장애 대비 여유)과 비용 상한을 이 두 값으로 표현합니다
- **scale-down은 5분 쿨다운이 기본**: 단기 트래픽 감소에 overreact하지 않도록 설계된 것입니다 `spec.behavior`로 조정 가능합니다
- **HPA vs KEDA 선택 기준**: CPU·메모리 비례 워크로드는 HPA, 큐 깊이·외부 이벤트·스케줄 기반은 KEDA가 적합합니다 두 오브젝트는 동일 Deployment를 동시에 제어할 수 없으므로 반드시 하나를 선택해야 합니다
