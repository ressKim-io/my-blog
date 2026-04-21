---
date: 2026-03-13
category: troubleshoot
project: Goti-monitoring
tags: [alloy, mimir, ruler, prometheus-rule, duplicate-metrics, config-reload, multitenancy, servicemonitor]
---

# Alloy mimir.rules.kubernetes "duplicate metrics collector registration" 에러로 전체 파이프라인 중단 — mimirtool CI/CD 전환 결정

## Context

Kind 클러스터(3 CP + 4 worker, 32GB)에서 Prometheus → Mimir 완전 전환 작업 중.
Alloy config v4에서 3가지 핵심 변경을 동시에 적용:
1. `prometheus.remote_write` endpoint를 Prometheus → Mimir distributor로 변경
2. `prometheus.operator.servicemonitors`로 K8s ServiceMonitor 기반 scraping 추가 (Prometheus 대체)
3. `mimir.rules.kubernetes`로 PrometheusRule CRD → Mimir ruler API 자동 동기화 추가

Mimir 아키텍처: mimir-distributed 6.0.5 (Mimir 3.0.1), Ingest Storage (Kafka 내장), Minio (S3-compatible).

## Issue

### 증상 1: Grafana 대시보드 전체 데이터 미표시

Grafana에서 모든 대시보드가 에러 표시:
```
Post "http://kube-prometheus-stack-dev-prometheus.monitoring:9090/prometheus/api/v1/query_range":
dial tcp: lookup kube-prometheus-stack-dev-prometheus.monitoring on 10.96.0.10:53: no such host
```
→ Grafana datasource가 Mimir ConfigMap으로 업데이트되었지만 Grafana pod가 재시작되지 않아 이전 Prometheus URL을 캐싱하고 있었음.

### 증상 2: Mimir 401 Unauthorized

Grafana pod restart 후에도 Mimir 쿼리가 실패:
```
curl http://mimir-dev-query-frontend:8080/prometheus/api/v1/query?query=up
→ 401 Unauthorized
```
→ Mimir의 `multitenancy_enabled` 기본값이 `true`여서 `X-Scope-OrgID` 헤더 없는 모든 요청을 거부.

### 증상 3: Mimir 쿼리 빈 결과

`X-Scope-OrgID: anonymous` 헤더를 추가해도 결과가 비어 있음:
```json
{"status":"success","data":{"resultType":"vector","result":[]}}
```
→ Alloy가 Mimir에 데이터를 보내지 못하고 있었음. 원인은 아래 증상 4.

### 증상 4: Alloy config 전체 로드 실패 (핵심 원인)

Alloy 로그에서 5초 간격으로 반복 에러:
```
level=error msg="failed to evaluate config" node=mimir.rules.kubernetes.default
  err="building component: registering metrics failed: duplicate metrics collector registration attempted"

level=error msg="failed to reload config" service=http
  err="error during the initial load: /etc/alloy/config.alloy:249:1:
  Failed to build component: building component: registering metrics failed:
  duplicate metrics collector registration attempted"

level=error msg="node exited with error" node=mimir.rules.kubernetes.default
  err="managed component not built"
```

**"error during the initial load"** — config가 한 번도 성공적으로 로드되지 않아 **OTLP 수신, Mimir remote_write, K8s scraping, Loki/Tempo export 모든 파이프라인이 완전 중단**된 상태.

재현 조건: Alloy config에 `mimir.rules.kubernetes` 블록 포함 시 100% 재현. pod 28시간 동안 Running이었지만 실제로는 모든 텔레메트리 처리가 중단되어 있었음.

## Action

### 진단 과정

1. **가설: Grafana datasource 미갱신** → Grafana pod restart 실행 → datasource URL 반영 확인. 하지만 Mimir에서 401 반환.

2. **가설: Mimir 인증 문제** → Mimir 문서 확인 → `multitenancy_enabled` 기본값 `true`. dev 환경에서는 tenant 헤더 불필요 → `multitenancy_enabled: false` 추가하여 mimir-values.yaml 수정 → push → ArgoCD sync → Mimir pod 재시작 → 401 해소, 200 반환. 하지만 `result: []`.

3. **가설: Alloy → Mimir 데이터 전송 실패** → `X-Scope-OrgID: anonymous` 헤더로 직접 쿼리해도 빈 결과 → Mimir distributor stats 확인 시 ingester에 series 0 → Alloy가 데이터를 보내지 못하고 있음 확인.

4. **가설: Alloy config 문제** → Alloy 로그 상세 분석 → `mimir.rules.kubernetes` 컴포넌트에서 "duplicate metrics collector registration" 에러 → **config initial load 자체가 실패** → 모든 컴포넌트 미동작 확인. Alloy pod는 Running(health check 통과)이지만 내부적으로 텔레메트리 처리 전혀 안 되는 상태.

5. **외부 조사** → GitHub issues 탐색:

| Issue | 컴포넌트 | 상태 |
|-------|---------|------|
| [alloy#5448](https://github.com/grafana/alloy/issues/5448) | **아키텍처 전체** (근본 원인) | Open (2026-02) |
| [alloy#2105](https://github.com/grafana/alloy/issues/2105) | `loki.source.journal` | Fixed |
| [alloy#2074](https://github.com/grafana/alloy/issues/2074) | `prometheus.write.queue` | Fixed |
| [alloy#1076](https://github.com/grafana/alloy/issues/1076) | `mimir.rules.kubernetes` — startup 재시도 없음 | Open |
| [alloy#307](https://github.com/grafana/alloy/issues/307) | `mimir.rules.kubernetes` — invalid rule 시 전체 중단 | Open |

### 근본 원인 (Root Cause)

**Alloy 아키텍처 버그** ([alloy#5448](https://github.com/grafana/alloy/issues/5448)).
컴포넌트가 `Registration.Build` 단계에서 shared resource(Prometheus metrics registry)를 바인딩하는데, 초기화 실패 시 cleanup 없이 재시도하면서 동일 collector를 중복 등록 시도 → panic. 이 panic이 개별 컴포넌트가 아닌 **전체 config 로드를 차단**하여 관련 없는 다른 컴포넌트(OTLP receiver, remote_write 등)까지 모두 미동작.

### 추가 발견: config reload vs pod restart

`mimir.rules.kubernetes` 블록을 제거한 후:
- ConfigMap 변경 → Alloy가 config reload 시도 → **일부 pod에서 "config reloaded" 성공** 확인
- 하지만 **이전에 initial load가 실패했던 pod에서는 `prometheus.operator.servicemonitors`가 target을 발견하지 못함** (컴포넌트가 clean state에서 초기화되지 않아 ServiceMonitor watch가 시작되지 않음)
- **pod rollout restart 후** clean state에서 config 로드 → ServiceMonitor scraping 정상 동작 시작 → `up` 메트릭 62개 target 확인

→ **교훈**: Alloy에서 initial load 실패 후 ConfigMap만 수정해서는 불충분. pod 자체를 재시작해야 모든 컴포넌트가 clean state에서 초기화됨.

### 대안 비교 및 결정 (PrometheusRule → Mimir ruler 동기화)

Mimir ruler는 PrometheusRule CRD를 직접 읽지 못함. 중간 매개체 필수.

| | Alloy `mimir.rules.kubernetes` | `mimirtool` CI/CD | ConfigMap 마운트 |
|---|---|---|---|
| **안정성** | 아키텍처 버그 미해결, 수정 시점 불명 | Grafana 공식 CLI, 프로덕션 검증 | 중간 매개체 불필요 |
| **EKS 적합성** | pod 시작 순서 의존, 재시도 없음 | CI/CD에서 독립 실행, 순서 무관 | 수동 동기화 필요 |
| **운영 부담** | Alloy 버전 업 때마다 재검증 | 한번 구성하면 끝 | ConfigMap 수동 관리 |
| **기존 구조** | PrometheusRule CRD watch | 같은 CRD YAML 그대로 사용 | CRD 미사용 |
| **자동화** | 실시간 동기화 (정상 작동 시) | git push → CI/CD 트리거 | 없음 |

**결정: 옵션 B (`mimirtool rules sync` CI/CD)** — EKS 전환이 며칠 내이므로 프로덕션급 안정성 우선. Alloy 아키텍처 버그 해결을 기다리지 않음.

### 적용한 수정

1. **Mimir multi-tenancy 비활성화**: `mimir-values.yaml`에 `multitenancy_enabled: false` 추가
2. **`mimir.rules.kubernetes` 블록 제거**: Alloy config에서 비활성화 (TODO 주석으로 사유 기록)
3. **Grafana pod restart**: datasource ConfigMap 변경 반영
4. **Alloy DaemonSet rollout restart**: clean state에서 config 로드하여 ServiceMonitor scraping 초기화

## Result

### 수정 후 검증 결과

```bash
# Mimir distributor stats — 데이터 유입 확인
User: anonymous | Series: 296 | Ingest Rate: 6.68/s

# up 메트릭 — K8s ServiceMonitor scraping 정상
count(up) = 62

# 보고 중인 job 목록
alloy-dev, apiserver, coredns, kube-state-metrics, kubelet, node-exporter,
kube-prometheus-stack-dev-alertmanager, kube-prometheus-stack-dev-grafana,
kube-prometheus-stack-dev-operator,
monitoring/compactor, monitoring/distributor, monitoring/ingester,
monitoring/querier, monitoring/query-frontend, monitoring/query-scheduler,
monitoring/ruler, monitoring/store-gateway, monitoring/overrides-exporter,
monitoring/loki-dev, monitoring/loki-canary,
monitoring/loki-dev-chunks-cache, monitoring/loki-dev-results-cache,
tempo-dev

# node-exporter — 7노드 (3CP + 4W) 전부 확인
node_memory_MemTotal_bytes: 7개 instance

# OTLP 메트릭 — Spring Boot goti-server
jvm_thread_count, http_server_request_duration_seconds 등 정상
job="goti-server", service_namespace="goti", deployment_environment="dev"
```

### 회귀 테스트

- Alloy pod 로그에서 `"failed to reload config"` 또는 `"error"` 없음 확인
- Mimir 쿼리 200 OK + 데이터 반환 확인
- `up` 메트릭 62개 target 확인 (이전 Prometheus 환경과 동일 수준)

### 재발 방지

1. `mimir.rules.kubernetes`는 Alloy 아키텍처 버그([#5448](https://github.com/grafana/alloy/issues/5448)) 해결 전까지 사용하지 않음
2. PrometheusRule → Mimir ruler 동기화는 EKS 전환 시 `mimirtool rules sync` CI/CD 파이프라인으로 구현
3. Alloy config 변경 후에는 반드시 pod 로그에서 "config reloaded" 또는 에러 여부를 확인할 것
4. Alloy initial load 실패 시에는 ConfigMap 수정만으로 불충분 — **pod rollout restart 필수**

## Related Files
- `Goti-monitoring/values-stacks/dev/alloy-values.yaml` — mimir.rules.kubernetes 블록 제거, pipeline v4
- `Goti-monitoring/values-stacks/dev/mimir-values.yaml` — multitenancy_enabled: false 추가
- `Goti-monitoring/values-stacks/dev/kube-prometheus-stack-values.yaml` — prometheus.enabled: false, Grafana datasource Mimir 전환
- `Goti-monitoring/values-stacks/dev/tempo-values.yaml` — metricsGenerator remote_write Mimir 전환
- `Goti-monitoring/charts/goti-monitoring/values-dev.yaml` — prometheusService → mimir-dev-query-frontend
- `Goti-monitoring/charts/goti-monitoring/templates/istio-gateway.yaml` — VirtualService port 8080
- `Goti-monitoring/charts/goti-monitoring/templates/prometheusrule-infra.yaml` — Prometheus 전용 rule 제거
- `Goti-k8s/gitops/applicationsets/monitoring-appset.yaml` — Mimir component 추가
