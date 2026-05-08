---
title: "Mimir Ingester OOM — 카디널리티 폭발과 webhook 교착"
excerpt: "Envoy 메트릭 수백 개가 필터 없이 Mimir에 유입되면서 Ingester가 OOMKilled됐고, rollout-operator webhook이 복구를 막는 교착까지 발생한 트러블슈팅"
category: monitoring
tags:
  - go-ti
  - Mimir
  - Prometheus
  - OOM
  - Webhook
  - ArgoCD
  - Istio
  - Troubleshooting
series:
  name: "goti-observability-stack"
  order: 4
date: "2026-03-23"
---

## 한 줄 요약

> Envoy PodMonitor에 metricRelabelings가 없어 수백 개 메트릭이 전부 Mimir로 유입 → Ingester OOMKilled. 복구하려는데 rollout-operator webhook이 모든 StatefulSet 변경을 blocking하는 교착까지 발생했습니다

## Impact

- **영향 범위**: Grafana 메트릭 대시보드 전체 (No data)
- **증상**: Mimir Ingester CrashLoopBackOff 25회, ArgoCD sync 실패
- **다운타임**: 47시간
- **발생일**: 2026-03-23

---

## 🔥 증상: 모든 메트릭이 No data

MSA 5서비스 전환을 완료하고 ArgoCD ServiceMonitor 4개를 추가한 뒤, Grafana 대시보드에서 **모든 메트릭이 No data**로 표시됐습니다.

```
mimir-dev-ingester-0   0/1   CrashLoopBackOff   25 (3m ago)   2d
```

```
Last State:     Terminated
  Reason:       OOMKilled
  Exit Code:    137
  Limits:
    memory:  2Gi
  Restart Count:  25
```

Mimir Ingester가 2Gi 메모리 제한에서 OOMKilled.
25회 재시작, CrashLoopBackOff 상태로 **47시간** 동안 지속됐습니다.

---

## 🤔 1차 원인: Envoy 메트릭 카디널리티 폭발

### 진단

이전에 1Gi → 2Gi로 올렸던 적이 있었는데 다시 터졌습니다.
무엇이 달라졌는지 확인해보니, MSA 5서비스 전환 + ArgoCD ServiceMonitor 4개 추가로 **active series가 급증**한 것이었습니다.

핵심 원인은 **Envoy PodMonitor에 `metricRelabelings`가 없었다**는 것입니다.

Istio Envoy 프록시는 수백 개의 메트릭을 노출합니다.
`envoy_cluster_*`, `envoy_listener_*`, `envoy_http_*` 등 대부분은 대시보드에서 사용하지 않는 메트릭입니다.
이것들이 전부 Mimir로 유입되면서 Ingester 메모리가 터졌습니다.

게다가 `max_global_series_per_user: 0` (무제한)으로 설정되어 있어서, OOM 전에 reject하는 안전장치도 없었습니다.

---

## 🤔 2차 원인: rollout-operator webhook 교착

여기서 진짜 문제가 시작됐습니다.

Ingester 메모리를 3Gi로 올려서 commit/push했는데, ArgoCD sync가 **실패**했습니다.

```
failed calling webhook "prepare-downscale-monitoring.grafana.com":
Post "https://mimir-dev-rollout-operator.monitoring.svc:443/admission/prepare-downscale":
context deadline exceeded
```

kubectl patch도 같은 webhook에 의해 blocking됐습니다.

### 교착 구조

Mimir Helm chart에 포함된 rollout-operator가 3개의 ValidatingWebhookConfiguration을 생성합니다.
이 webhook의 목적은 "Ingester가 비정상일 때 unsafe한 변경을 막는 것"입니다.

문제는 **Ingester가 OOM으로 비정상인 상태에서 메모리를 올리는 변경도 차단한다**는 것입니다. 교착 사슬을 단계별로 풀어보면 다음과 같습니다.

1. Ingester가 OOMKilled로 비정상 상태에 들어갑니다
2. rollout-operator의 webhook이 "비정상이니 변경 불가"라며 차단합니다
3. ArgoCD sync가 실패합니다
4. 메모리 limit을 못 올립니다
5. Ingester가 계속 OOMKilled로 떨어집니다 (1번으로 돌아가 사이클 형성)

복구하려면 변경이 필요한데, 변경하려면 복구가 필요한 상태.
dev 환경에서 replicas가 1이라 더 심각했습니다.
prod에서 3 replicas면 나머지가 살아있으니 webhook이 허용할 수 있지만, 1 replica면 유일한 Ingester가 죽어있으니 모든 변경을 차단합니다.

---

## ✅ 교착 해제 과정

4번의 시도 끝에 해결했습니다.

### 시도 1: webhook 삭제 → 실패

```bash
kubectl delete validatingwebhookconfiguration no-downscale-monitoring
```

삭제해도 rollout-operator가 즉시 재생성합니다.

### 시도 2: rollout-operator 스케일 다운 + webhook 삭제 → 실패

```bash
kubectl scale deploy mimir-dev-rollout-operator --replicas=0
kubectl delete validatingwebhookconfiguration no-downscale-monitoring \
  pod-eviction-monitoring zpdb-validation-monitoring
```

webhook이 `kubectl get`에서 사라진 것을 확인했는데도, patch하면 같은 에러가 나옵니다.
**API server가 webhook 설정을 캐싱**하고 있기 때문이었습니다.

### 시도 3: API server 캐시 만료 대기 → 성공

```bash
# rollout-operator 스케일 다운 + webhook 삭제 후
sleep 60  # API server 캐시 만료 대기

kubectl patch statefulset mimir-dev-ingester ...
# → patched (no change) — ArgoCD가 이미 sync 완료
```

API server의 webhook 캐시가 만료되는 데 약 60초가 걸렸습니다.
그 뒤에 ArgoCD가 자동으로 sync를 완료했습니다.

---

## ✅ 근본 수정

교착을 해제한 뒤 세 가지 근본 수정을 적용했습니다.

### 1. rollout-operator 비활성화 (dev 환경)

```yaml
# mimir-values.yaml
rollout_operator:
  enabled: false
```

dev에서 replicas:1이면 rollout-operator의 보호 로직이 오히려 **복구를 방해**합니다.
prod에서 multi-replica 환경에서만 활성화하면 됩니다.

### 2. series limit 설정

```yaml
# mimir-values.yaml
limits:
  max_global_series_per_user: 150000
```

무제한이었던 series를 150,000으로 제한했습니다.
이 한도를 초과하면 Mimir가 새 series를 reject합니다.
OOM으로 Pod가 죽는 것보다 일부 메트릭이 거부되는 것이 훨씬 안전합니다.

### 3. Envoy metricRelabelings allowlist

```yaml
# podmonitor-envoy.yaml
metricRelabelings:
  - sourceLabels: [__name__]
    regex: "istio_requests_total|istio_request_duration_milliseconds_.*|..."
    action: keep
```

대시보드에서 실제 사용하는 10개 메트릭만 keep하고 나머지는 전부 drop합니다.
예상 **60-80% series 감소** 효과입니다.

추가로 고카디널리티 레이블도 drop했습니다:
`source_principal`, `destination_principal`, `canonical_service`, `canonical_revision`, `cluster` 등.
이 레이블들은 값의 조합이 많아서 series 폭발의 주범입니다.

---

## 📚 배운 점

### Webhook 교착은 dev 환경에서 더 위험하다

rollout-operator는 prod에서 Ingester 안전을 보장하는 좋은 도구입니다.
하지만 dev에서 replicas:1이면 **유일한 Ingester가 죽었을 때 모든 복구 경로를 차단**합니다.

dev 환경에서는 안전장치보다 **복구 가능성**이 더 중요합니다.
prod과 dev의 차이를 인식하고 컴포넌트별로 활성화 여부를 다르게 가져가야 합니다.

### Series limit은 OOM의 안전장치다

`max_global_series_per_user: 0`(무제한)은 **"OOM이 유일한 안전장치"**라는 뜻입니다.
150,000 같은 한도를 설정하면, 한도 초과 시 HTTP 429로 reject합니다.
Pod가 죽는 것보다 일부 메트릭 손실이 훨씬 낫습니다.

### 새 PodMonitor/ServiceMonitor 추가 시 metricRelabelings 필수

특히 Istio Envoy처럼 수백 개 메트릭을 노출하는 컴포넌트는 **기본이 allowlist**여야 합니다.
필요한 메트릭만 keep하고 나머지를 drop하는 구조로 시작해야 합니다.
나중에 필요한 것이 있으면 allowlist에 추가하면 됩니다.
