---
date: 2026-03-23
category: troubleshoot
project: Goti-monitoring
tags: [mimir, ingester, oomkilled, rollout-operator, webhook, deadlock, argocd, series-cardinality]
---

# Mimir ingester OOMKilled + rollout-operator webhook이 ArgoCD sync 교착 유발

## Context

Kind dev 환경. MSA 5서비스(goti-user, goti-ticketing, goti-payment, goti-resale, goti-stadium) 전환 완료 후 ArgoCD ServiceMonitor 4개가 추가된 상태. Grafana 대시보드에서 모든 메트릭이 No data로 표시됨.

## Issue

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

ingester가 2Gi 메모리 제한에서 OOMKilled → CrashLoopBackOff → 47시간 지속.

### 2차 문제: ArgoCD sync 교착

ingester 메모리를 3Gi로 올려 commit/push했으나 ArgoCD sync 실패:

```
failed calling webhook "prepare-downscale-monitoring.grafana.com":
Post "https://mimir-dev-rollout-operator.monitoring.svc:443/admission/prepare-downscale":
context deadline exceeded
```

kubectl patch도 동일한 webhook에 의해 blocking:

```
kubectl patch statefulset mimir-dev-ingester ... → same webhook error
```

## Action

### 1. 가설: ingester 메모리 부족 → 결과: 확인

`kubectl describe pod`에서 `Reason: OOMKilled, Exit Code: 137` 확인.
이전에 1Gi→2Gi로 올렸었으나 MSA 5서비스 + ArgoCD SM 4개 추가로 active series 증가하여 재발.

### 2. 가설: ArgoCD sync로 3Gi 반영 → 결과: webhook 교착으로 실패

Mimir Helm chart의 rollout-operator가 `no-downscale-monitoring`, `pod-eviction-monitoring`, `zpdb-validation-monitoring` 3개 ValidatingWebhookConfiguration을 생성.
ingester가 비정상(0/1)일 때 rollout-operator가 "downscale 안전하지 않다"고 판단 → 모든 StatefulSet 변경을 webhook이 blocking → ArgoCD sync 실패 → ingester 메모리 못 올림 → 교착.

### 3. 가설: webhook 삭제로 해결 → 결과: rollout-operator가 자동 재생성

`kubectl delete validatingwebhookconfiguration no-downscale-monitoring` 실행해도 rollout-operator가 즉시 재생성.

### 4. 가설: rollout-operator를 먼저 죽이고 webhook 삭제 → 결과: API server 캐시 문제

```bash
kubectl scale deploy mimir-dev-rollout-operator --replicas=0
kubectl delete validatingwebhookconfiguration no-downscale-monitoring pod-eviction-monitoring zpdb-validation-monitoring
```

webhook 삭제 확인 (`kubectl get validatingwebhookconfiguration`에서 사라짐) 후에도 patch 시 동일 에러. API server가 webhook 설정을 캐싱하여 즉시 반영되지 않음.

### 5. 해결: API server 캐시 만료 대기 (60초) 후 patch 성공

```bash
sleep 60 && kubectl patch statefulset mimir-dev-ingester ... || kubectl delete statefulset ... --cascade=orphan
```

60초 대기 후 patch 성공 (`patched (no change)` — ArgoCD가 이미 sync 완료).

### 근본 원인 (Root Cause)

**3중 원인:**

1. **시리즈 폭증**: Envoy PodMonitor에 `metricRelabelings`가 없어 envoy_* 수백 개 메트릭이 전부 Mimir로 수집 → ingester 메모리 초과
2. **series limit 미설정**: `max_global_series_per_user: 0` (무제한) → OOM 안전장치 없음
3. **rollout-operator webhook 교착**: ingester 비정상 시 모든 StatefulSet 변경을 blocking → 복구 불가 교착. dev 환경(replicas:1)에서는 불필요한 컴포넌트

### 적용한 수정

**즉시 대응:**
- ingester memory limit: 2Gi → 3Gi
- rollout-operator scale 0 + webhook 삭제 + 60초 대기로 교착 해제

**근본 수정 (Goti-monitoring):**
- `rollout_operator.enabled: false` — dev에서 영구 비활성화, webhook 교착 원천 차단
- `max_global_series_per_user: 150000` — OOM 안전장치

**근본 수정 (Goti-k8s):**
- Envoy PodMonitor에 `metricRelabelings` allowlist 추가: `istio_requests_total` 등 대시보드에서 사용하는 10개 메트릭만 keep, 나머지 전부 drop
- 고카디널리티 레이블 labeldrop: `source_principal`, `destination_principal`, `canonical_service/revision`, `cluster` 등

## Result

- ingester 3Gi + Kafka 재기동 후 `READY=true`, restart 멈춤
- 대시보드 메트릭 정상 표시 확인
- rollout-operator 비활성화로 향후 동일 교착 불가
- Envoy metricRelabelings로 예상 60-80% 시리즈 감소 (Goti-k8s 적용 대기)

### 재발 방지

1. **rollout-operator**: dev 환경에서 영구 비활성화 (prod에서는 multi-replica 환경에서만 활성화)
2. **series limit**: 150,000 제한으로 OOM 전 reject
3. **메트릭 필터링**: 새 ServiceMonitor/PodMonitor 추가 시 반드시 metricRelabelings 검토
4. **prod 전환 시**: rollout-operator 재활성화 + `failurePolicy: Ignore` 검토

## Related Files

- `Goti-monitoring/values-stacks/dev/mimir-values.yaml` — ingester 3Gi, series limit, rollout_operator disabled
- `Goti-k8s/infrastructure/dev/istio/goti-policy/templates/podmonitor-envoy.yaml` — metricRelabelings allowlist
