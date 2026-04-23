---
title: "Alloy mimir.rules.kubernetes duplicate metrics — 전체 파이프라인이 멈춘 이유"
excerpt: "Alloy의 mimir.rules.kubernetes 컴포넌트가 duplicate metrics collector 에러로 config initial load를 실패시키면서 OTLP 수신, remote_write, scraping이 모두 중단됐고, mimirtool CI/CD 전환으로 돌파한 기록입니다."
category: monitoring
tags:
  - go-ti
  - Observability
  - Grafana-Alloy
  - Mimir
  - Prometheus
  - troubleshooting
series:
  name: "goti-observability-ops"
  order: 1
date: "2026-02-07"
---

## 한 줄 요약

> Alloy config의 `mimir.rules.kubernetes` 블록 하나가 duplicate metrics collector 에러를 내면서 config initial load 자체가 실패했고, 그 결과 OTLP 수신·Mimir remote_write·ServiceMonitor scraping이 전부 중단됐습니다. 해당 블록을 제거하고 PrometheusRule 동기화를 `mimirtool` CI/CD로 옮겨 해결했습니다.

---

## 🔥 문제: Grafana 대시보드 전체가 No data

### 기존 아키텍처 / 기대 동작

Kind 클러스터(Control Plane 3대 + Worker 4대, 32GB) 위에서 Prometheus → Mimir 완전 전환 작업을 진행하던 중이었습니다. Alloy config v4에 세 가지 핵심 변경을 동시에 적용했습니다.

- `prometheus.remote_write` endpoint를 Prometheus에서 Mimir distributor로 변경했습니다.
- `prometheus.operator.servicemonitors`로 K8s ServiceMonitor 기반 scraping을 추가해 Prometheus를 대체했습니다.
- `mimir.rules.kubernetes`로 PrometheusRule CRD를 Mimir ruler API에 자동 동기화하도록 붙였습니다.

Mimir 쪽은 mimir-distributed 6.0.5 (Mimir 3.0.1), Ingest Storage는 Kafka 내장, 오브젝트 스토리지는 Minio(S3 호환)로 구성했습니다.

기대한 동작은 단순했습니다. Alloy가 ServiceMonitor를 읽어 scrape → Mimir로 remote_write → Grafana는 Mimir datasource로 쿼리. 이 흐름이 전부 한 번에 도입됐습니다.

### 발견한 문제

Grafana 대시보드를 열자 모든 패널이 에러를 뱉었습니다.

```text
Post "http://kube-prometheus-stack-dev-prometheus.monitoring:9090/prometheus/api/v1/query_range":
dial tcp: lookup kube-prometheus-stack-dev-prometheus.monitoring on 10.96.0.10:53: no such host
```

Grafana datasource ConfigMap은 이미 Mimir로 갱신됐는데, Grafana pod가 재시작되지 않아 이전 Prometheus URL을 캐싱하고 있었습니다.

Grafana pod를 재시작한 뒤에도 상황이 나아지지 않았습니다. Mimir가 401을 반환했습니다.

```bash
$ curl http://mimir-dev-query-frontend:8080/prometheus/api/v1/query?query=up
# 401 Unauthorized
```

Mimir는 `multitenancy_enabled` 기본값이 `true`라 `X-Scope-OrgID` 헤더 없는 요청을 모두 거절합니다. dev 환경에서는 tenant 헤더를 쓰지 않기로 했으므로 `multitenancy_enabled: false`를 적용했습니다.

이제 200은 돌아오는데 결과가 비어 있었습니다.

```json
{"status":"success","data":{"resultType":"vector","result":[]}}
```

`X-Scope-OrgID: anonymous`를 명시해도 여전히 빈 결과였습니다. Mimir distributor stats를 보니 ingester series가 0이었습니다. **Alloy가 Mimir로 데이터를 단 한 건도 보내지 않고 있었습니다.**

Alloy 파드 로그를 열어보니 5초 간격으로 같은 에러가 반복됐습니다.

```text
level=error msg="failed to evaluate config" node=mimir.rules.kubernetes.default
  err="building component: registering metrics failed: duplicate metrics collector registration attempted"

level=error msg="failed to reload config" service=http
  err="error during the initial load: /etc/alloy/config.alloy:249:1:
  Failed to build component: building component: registering metrics failed:
  duplicate metrics collector registration attempted"

level=error msg="node exited with error" node=mimir.rules.kubernetes.default
  err="managed component not built"
```

문제의 핵심은 `"error during the initial load"`였습니다. config가 한 번도 성공적으로 로드되지 않았다는 뜻이고, 결과적으로 OTLP 수신, Mimir remote_write, K8s ServiceMonitor scraping, Loki/Tempo export가 **전부 중단된 상태**였습니다.

파드는 28시간 동안 `Running`으로 찍혀 있었지만, 내부 텔레메트리 처리는 0이었습니다. health check만 통과하고 실제로는 아무 일도 하지 않는 파드였습니다.

재현 조건은 단순했습니다. Alloy config에 `mimir.rules.kubernetes` 블록을 포함하면 100% 재현됐습니다.

---

## 🤔 원인: Alloy의 컴포넌트 초기화 실패가 전체 config를 막는 아키텍처 버그

### 진단 흐름

가설을 하나씩 소거했습니다.

1. **Grafana datasource 캐싱 가설**: Grafana pod를 재시작했습니다. datasource URL은 반영됐지만, 여전히 Mimir가 401을 반환했습니다.
2. **Mimir 인증 가설**: `multitenancy_enabled: false`를 `mimir-values.yaml`에 추가하고 ArgoCD sync로 Mimir pod를 재시작했습니다. 401은 해소됐지만 결과는 여전히 `[]`였습니다.
3. **Alloy → Mimir 전송 실패 가설**: `X-Scope-OrgID: anonymous`로 직접 쿼리해도 빈 결과였고, distributor stats도 0이었습니다. Alloy가 데이터를 못 보내고 있다는 것이 확정됐습니다.
4. **Alloy config 가설**: Alloy 로그 상세 분석에서 `mimir.rules.kubernetes` 컴포넌트가 "duplicate metrics collector registration" 에러를 내고 있었고, 이로 인해 **config initial load 자체가 실패**한다는 것을 확인했습니다.

### 외부 이슈 조사

이 에러는 Alloy의 알려진 아키텍처 버그였습니다. GitHub Issues를 훑었습니다.

| Issue | 컴포넌트 | 상태 |
|-------|---------|------|
| [alloy#5448](https://github.com/grafana/alloy/issues/5448) | 아키텍처 전체 (근본 원인) | Open (2026-02) |
| [alloy#2105](https://github.com/grafana/alloy/issues/2105) | `loki.source.journal` | Fixed |
| [alloy#2074](https://github.com/grafana/alloy/issues/2074) | `prometheus.write.queue` | Fixed |
| [alloy#1076](https://github.com/grafana/alloy/issues/1076) | `mimir.rules.kubernetes` — startup 재시도 없음 | Open |
| [alloy#307](https://github.com/grafana/alloy/issues/307) | `mimir.rules.kubernetes` — invalid rule 시 전체 중단 | Open |

표에서 주목할 점은 이슈 #5448이 **개별 컴포넌트 버그가 아니라 아키텍처 수준의 버그**라는 것입니다. 이미 Fixed된 이슈들(#2105, #2074)은 같은 증상을 다른 컴포넌트에서 겪었던 과거 사례고, 아직 Open인 이슈들(#1076, #307)은 `mimir.rules.kubernetes`에 한정된 구체적 증상입니다.

근본 원인은 이렇습니다. Alloy 컴포넌트는 `Registration.Build` 단계에서 Prometheus metrics registry라는 **공유 자원**을 바인딩합니다. 초기화가 실패했을 때 cleanup 없이 재시도하면, 이미 등록된 collector를 또 등록하려다 panic이 발생합니다. 이 panic이 해당 컴포넌트만 죽이고 끝나면 다행인데, 실제로는 **config 전체 로드를 차단**합니다. 결과적으로 OTLP receiver처럼 이 문제와 무관한 컴포넌트까지 전부 동작하지 못하게 됩니다.

즉, `mimir.rules.kubernetes` 하나가 Alloy 전체를 벽돌로 만들어버리는 구조적 문제였습니다. Alloy 버전 업그레이드 전까지 이 블록을 쓸 수 없다는 결론이 나왔습니다.

### 추가 발견: config reload만으로는 회복되지 않는다

`mimir.rules.kubernetes` 블록을 제거한 뒤에도 흥미로운 현상을 발견했습니다.

- ConfigMap을 변경하면 Alloy가 config reload를 시도하고, 일부 파드에서 `"config reloaded"` 성공 로그가 나왔습니다.
- 하지만 이전에 initial load가 실패했던 파드에서는 `prometheus.operator.servicemonitors`가 target을 하나도 발견하지 못했습니다. ServiceMonitor watch가 clean state에서 시작되지 않았기 때문입니다.
- 파드 rollout restart를 수행한 뒤에야 clean state에서 config가 로드됐고, ServiceMonitor scraping이 정상 동작하기 시작했습니다. `up` 메트릭 target이 62개로 늘어난 것을 확인했습니다.

Alloy에서 initial load가 한 번 실패하면, 단순 ConfigMap 수정으로는 안쪽 컴포넌트가 되살아나지 않습니다. 파드 자체를 재시작해서 clean state를 강제해야 합니다.

---

## ✅ 해결: 블록 제거 + mimirtool CI/CD 전환

### PrometheusRule 동기화 대안 비교

Mimir ruler는 PrometheusRule CRD를 직접 읽지 못합니다. 따라서 CRD에서 ruler로 옮겨주는 중간 매개체가 반드시 필요합니다. 세 가지 선택지를 비교했습니다.

| | Alloy `mimir.rules.kubernetes` | `mimirtool` CI/CD | ConfigMap 마운트 |
|---|---|---|---|
| **안정성** | 아키텍처 버그 미해결, 수정 시점 불명 | Grafana 공식 CLI, 프로덕션 검증 | 중간 매개체 불필요 |
| **EKS 적합성** | 파드 시작 순서 의존, 재시도 없음 | CI/CD에서 독립 실행, 순서 무관 | 수동 동기화 필요 |
| **운영 부담** | Alloy 버전 업마다 재검증 | 한번 구성하면 끝 | ConfigMap 수동 관리 |
| **기존 구조** | PrometheusRule CRD watch | 같은 CRD YAML 그대로 사용 | CRD 미사용 |
| **자동화** | 실시간 동기화 (정상 작동 시) | git push → CI/CD 트리거 | 없음 |

세 선택지는 안정성·자동화·운영 부담의 균형점이 서로 달랐습니다.

**옵션 A (`mimir.rules.kubernetes`)**는 정상 작동만 한다면 실시간 동기화라는 장점이 있지만, 아키텍처 버그가 Open 상태이고 수정 시점이 불명확했습니다. EKS 전환이 며칠 남지 않은 시점에 불확실성을 떠안기 어려웠습니다.

**옵션 C (ConfigMap 마운트)**는 중간 매개체가 아예 없어 가장 단순하지만, PrometheusRule CRD를 더 이상 쓰지 않게 되므로 기존 자산과 호환성이 깨집니다. 수동으로 ConfigMap을 관리해야 하는 운영 부담도 큽니다.

**옵션 B (`mimirtool rules sync` CI/CD)**가 가장 균형이 좋았습니다. Grafana가 공식 제공하는 CLI로 프로덕션에서 이미 널리 검증된 방식이고, 기존 PrometheusRule CRD YAML을 그대로 재사용할 수 있습니다. 실시간은 아니지만 git push 기준이라 변경 이력도 명확합니다.

EKS 전환이 임박한 상황이라 안정성을 최우선으로 두고 **옵션 B**를 선택했습니다. Alloy 아키텍처 버그의 해결을 기다리지 않기로 했습니다.

### 적용한 수정

실제로 적용한 네 가지 변경은 다음과 같습니다.

1. **Mimir 멀티테넌시 비활성화**: `mimir-values.yaml`에 `multitenancy_enabled: false`를 추가했습니다.
2. **`mimir.rules.kubernetes` 블록 제거**: Alloy config에서 해당 블록을 뺐습니다. 이유는 TODO 주석으로 남겨 Alloy 업그레이드 시 재검토할 수 있게 했습니다.
3. **Grafana pod restart**: datasource ConfigMap 변경을 실제 접속에 반영하기 위해 재시작했습니다.
4. **Alloy DaemonSet rollout restart**: clean state에서 config를 로드해 ServiceMonitor scraping이 초기화되도록 강제했습니다.

### 수정 후 검증

Mimir distributor stats에서 처음으로 데이터 유입이 찍혔습니다.

```text
User: anonymous | Series: 296 | Ingest Rate: 6.68/s
```

`up` 메트릭 개수는 기대한 수준이었습니다.

```text
count(up) = 62
```

보고 중인 job 목록도 예상대로 나왔습니다.

```text
alloy-dev, apiserver, coredns, kube-state-metrics, kubelet, node-exporter,
kube-prometheus-stack-dev-alertmanager, kube-prometheus-stack-dev-grafana,
kube-prometheus-stack-dev-operator,
monitoring/compactor, monitoring/distributor, monitoring/ingester,
monitoring/querier, monitoring/query-frontend, monitoring/query-scheduler,
monitoring/ruler, monitoring/store-gateway, monitoring/overrides-exporter,
monitoring/loki-dev, monitoring/loki-canary,
monitoring/loki-dev-chunks-cache, monitoring/loki-dev-results-cache,
tempo-dev
```

node-exporter는 7개 노드(Control Plane 3 + Worker 4)에서 모두 확인됐습니다.

```text
node_memory_MemTotal_bytes: 7개 instance
```

OTLP 경로도 살아 있었습니다. Spring Boot 서버 메트릭이 정상적으로 들어왔습니다.

```text
jvm_thread_count, http_server_request_duration_seconds 등 정상
job="goti-server", service_namespace="goti", deployment_environment="dev"
```

### 회귀 테스트

- Alloy 파드 로그에서 `"failed to reload config"`나 `"error"`가 더 이상 나오지 않음을 확인했습니다.
- Mimir 쿼리가 200 OK와 데이터를 함께 반환하는지 확인했습니다.
- `up` 메트릭 target 수가 이전 Prometheus 환경과 동일한 62개인지 확인했습니다.

---

## 📚 배운 점

- **컴포넌트 하나가 config 전체를 막는 아키텍처는 위험합니다**. Alloy의 `Registration.Build`는 cleanup 없이 재시도하면서 panic을 유발했고, 이 panic이 config initial load를 차단해 무관한 컴포넌트까지 전부 죽였습니다. 공유 자원을 바인딩하는 구조는 부분 실패를 격리할 수 있어야 합니다.
- **파드의 `Running` 상태는 동작 증명이 아닙니다**. Alloy 파드는 28시간 동안 health check를 통과하며 `Running`이었지만 내부 텔레메트리 처리는 0이었습니다. 실제 출력(메트릭, 트레이스, 로그) 기반의 sanity check가 필요합니다.
- **config reload는 failure recovery 수단이 아닙니다**. initial load가 실패한 상태에서 ConfigMap만 고치면 일부 컴포넌트가 여전히 초기화되지 않습니다. 근본적 회복은 파드 rollout restart입니다.
- **GitHub에서 Open인 아키텍처 버그는 회피가 정답일 때가 많습니다**. 수정 시점이 불명확하면 대안으로 우회하는 쪽이 운영 안정성에 유리합니다. `mimirtool` CI/CD처럼 공식 CLI 기반의 길이 있으면 그쪽이 안전합니다.
- **변경을 동시에 세 개 넣지 않습니다**. remote_write 엔드포인트 변경, ServiceMonitor scraping 추가, `mimir.rules.kubernetes` 도입을 한 번에 적용한 탓에 원인 특정에 시간이 걸렸습니다. 특히 관측성 파이프라인처럼 진단 자체가 어려워지는 계층은 더더욱 한 번에 하나씩 움직여야 합니다.

---

## 관련 파일

- `Goti-monitoring/values-stacks/dev/alloy-values.yaml` — `mimir.rules.kubernetes` 블록 제거, pipeline v4
- `Goti-monitoring/values-stacks/dev/mimir-values.yaml` — `multitenancy_enabled: false` 추가
- `Goti-monitoring/values-stacks/dev/kube-prometheus-stack-values.yaml` — `prometheus.enabled: false`, Grafana datasource Mimir 전환
- `Goti-monitoring/values-stacks/dev/tempo-values.yaml` — metricsGenerator remote_write를 Mimir로 전환
- `Goti-monitoring/charts/goti-monitoring/values-dev.yaml` — `prometheusService` → `mimir-dev-query-frontend`
- `Goti-monitoring/charts/goti-monitoring/templates/istio-gateway.yaml` — VirtualService port 8080
- `Goti-monitoring/charts/goti-monitoring/templates/prometheusrule-infra.yaml` — Prometheus 전용 rule 제거
- `Goti-k8s/gitops/applicationsets/monitoring-appset.yaml` — Mimir 컴포넌트 추가
