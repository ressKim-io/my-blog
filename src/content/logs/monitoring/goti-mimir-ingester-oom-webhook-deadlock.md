---
title: "Mimir ingester OOM 47시간 — 카디널리티 폭증과 webhook 교착"
excerpt: "relabeling 규칙 하나가 빠져 Envoy 메트릭 수백 개가 통째로 Mimir에 유입됐고, series 상한도 없어 ingester가 OOM에 빠졌습니다. 복구하려는데 rollout-operator webhook이 StatefulSet 변경을 막는 교착까지 겹친 47시간의 기록입니다"
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

> Envoy PodMonitor에 `metricRelabelings`가 없어 수백 개 메트릭이 통째로 Mimir에 들어왔고 ingester가 OOM으로 죽었습니다. 메모리를 올리려니 rollout-operator webhook이 StatefulSet 변경을 막아, 복구하려면 변경이 필요한데 변경하려면 복구가 필요한 상태가 47시간 이어졌습니다

## Impact

- **영향 범위**: Grafana 메트릭 대시보드 전체 (No data)
- **증상**: Mimir Ingester CrashLoopBackOff 25회, ArgoCD sync 실패
- **다운타임**: 47시간
- **발생일**: 2026-03-23

---

## 🔥 증상: 모든 메트릭이 No data

MSA 5서비스 전환을 마치고 ArgoCD ServiceMonitor 4개를 추가한 뒤, Grafana 대시보드에서 **모든 메트릭이 No data**로 나왔습니다

```text
mimir-dev-ingester-0   0/1   CrashLoopBackOff   25 (3m ago)   2d
```

```text
Last State:     Terminated
  Reason:       OOMKilled
  Exit Code:    137
  Limits:
    memory:  2Gi
  Restart Count:  25
```

Mimir Ingester가 2Gi 한계에서 OOMKilled로 떨어지고 있었습니다. 25회 재시작, CrashLoopBackOff 상태로 **47시간**이 지나 있었습니다

---

## 🤔 1차 원인: Envoy 메트릭 카디널리티 폭증

### 진단

전에도 한 번 터져서 1Gi에서 2Gi로 올린 적이 있었습니다. 그런데 또 터졌습니다

무엇이 달라졌는지 보니 MSA 5서비스 전환과 ArgoCD ServiceMonitor 4개 추가로 active series가 크게 늘어 있었습니다

핵심은 **Envoy PodMonitor에 `metricRelabelings`가 없다**는 점이었습니다

Istio Envoy 프록시는 메트릭을 수백 개 내보냅니다. `envoy_cluster_*`, `envoy_listener_*`, `envoy_http_*` 계열인데 대시보드에서 실제로 쓰는 것은 극히 일부입니다

거르지 않으니 전부 Mimir로 들어왔고, ingester 메모리가 그걸 다 들고 있다가 터졌습니다

여기에 `max_global_series_per_user: 0`, 즉 무제한으로 두고 있었습니다. 한도를 넘겨도 거절하지 않으니 OOM 말고는 멈출 방법이 없는 상태였습니다

---

## 🤔 2차 원인: rollout-operator webhook 교착

진짜 문제는 여기서 시작됐습니다

Ingester 메모리를 3Gi로 올려 commit하고 push했는데 ArgoCD sync가 실패했습니다

```text
failed calling webhook "prepare-downscale-monitoring.grafana.com":
Post "https://mimir-dev-rollout-operator.monitoring.svc:443/admission/prepare-downscale":
context deadline exceeded
```

kubectl patch도 같은 webhook에 막혔습니다

### 교착 구조

Mimir Helm chart에 딸려 오는 rollout-operator가 ValidatingWebhookConfiguration 3개를 만듭니다. Ingester가 비정상일 때 위험한 변경을 막는 것이 목적입니다

그런데 이 판단에 예외가 없습니다. **Ingester가 OOM으로 비정상인 상태에서는, 그걸 고치려는 변경까지 함께 막습니다**

사슬을 풀면 이렇습니다

1. Ingester가 OOMKilled로 비정상 상태에 들어갑니다
2. webhook이 비정상이라는 이유로 변경을 차단합니다
3. ArgoCD sync가 실패합니다
4. 메모리 limit을 못 올립니다
5. Ingester가 계속 OOMKilled로 떨어져 1번으로 돌아갑니다

복구하려면 변경해야 하는데, 변경하려면 먼저 복구돼 있어야 합니다

dev 환경이라 더 나빴습니다. replicas가 1이라 유일한 Ingester가 죽어 있으니 모든 변경이 막혔습니다. prod처럼 3 replicas였다면 나머지가 살아 있어 webhook이 통과시켰을 것입니다

---

## ✅ 교착 해제 과정

네 번 시도한 끝에 풀었습니다

### 시도 1: webhook 삭제 → 실패

```bash
kubectl delete validatingwebhookconfiguration no-downscale-monitoring
```

지워도 rollout-operator가 곧바로 다시 만듭니다

### 시도 2: rollout-operator 스케일 다운 + webhook 삭제 → 실패

```bash
kubectl scale deploy mimir-dev-rollout-operator --replicas=0
kubectl delete validatingwebhookconfiguration no-downscale-monitoring \
  pod-eviction-monitoring zpdb-validation-monitoring
```

`kubectl get`으로는 webhook이 사라진 것이 확인되는데, patch를 걸면 여전히 같은 에러가 났습니다

**API server가 webhook 설정을 캐시하고 있었기** 때문입니다

### 시도 3: API server 캐시 만료 대기 → 성공

```bash
# rollout-operator 스케일 다운 + webhook 삭제 후
sleep 60  # API server 캐시 만료 대기

kubectl patch statefulset mimir-dev-ingester ...
# → patched (no change) — ArgoCD가 이미 sync 완료
```

캐시가 만료되기까지 약 60초가 걸렸고, 그 사이 ArgoCD가 알아서 sync를 마쳤습니다

---

## ✅ 근본 수정

교착을 푼 뒤 세 가지를 손봤습니다

### 1. rollout-operator 비활성화 (dev 환경)

```yaml
# mimir-values.yaml
rollout_operator:
  enabled: false
```

dev처럼 replicas가 1인 환경에서는 이 보호 로직이 오히려 복구를 막습니다. multi-replica인 prod에서만 켜면 됩니다

### 2. series limit 설정

```yaml
# mimir-values.yaml
limits:
  max_global_series_per_user: 150000
```

무제한이던 series를 150,000으로 묶었습니다. 한도를 넘으면 Mimir가 새 series를 거절합니다

메트릭 일부를 잃는 편이 Pod가 통째로 죽는 것보다 훨씬 낫습니다

### 3. Envoy metricRelabelings allowlist

```yaml
# podmonitor-envoy.yaml
metricRelabelings:
  - sourceLabels: [__name__]
    regex: "istio_requests_total|istio_request_duration_milliseconds_.*|..."
    action: keep
```

대시보드에서 실제로 쓰는 10개만 남기고 나머지는 전부 버립니다. series가 60~80% 줄어들 것으로 예상했습니다

값이 많이 갈라지는 레이블도 함께 뺐습니다. `source_principal`, `destination_principal`, `canonical_service`, `canonical_revision`, `cluster` 같은 것들인데, 조합이 많아 series를 불리는 주범입니다

---

## 📚 배운 점

### webhook 교착은 dev 환경에서 더 위험하다

rollout-operator는 prod에서 Ingester를 지켜 주는 좋은 도구입니다

문제는 replicas가 1일 때입니다. 유일한 Ingester가 죽으면 복구 경로까지 전부 막힙니다. 지켜 줄 대상이 이미 죽었는데 보호 규칙만 남아 있는 셈입니다

dev에서는 안전장치보다 복구 가능성이 우선입니다. 같은 컴포넌트라도 환경에 따라 켜고 끄는 판단이 달라야 합니다

### series limit이 없으면 OOM이 유일한 안전장치가 된다

`max_global_series_per_user: 0`은 사실상 "한도가 없다"가 아니라 "메모리가 다 찰 때까지 받는다"는 뜻입니다

150,000 같은 한도를 걸어 두면 초과분을 HTTP 429로 거절합니다. 거절은 복구할 수 있지만 OOM은 그렇지 않습니다

### PodMonitor를 새로 붙일 때는 allowlist부터

Istio Envoy처럼 메트릭을 수백 개 내보내는 컴포넌트는 처음부터 allowlist로 시작해야 합니다

필요한 것만 남기고 나머지를 버리는 방향이 안전합니다. 나중에 아쉬운 메트릭이 생기면 그때 목록에 추가하면 됩니다. 반대 방향은 이번처럼 터진 뒤에야 알게 됩니다
