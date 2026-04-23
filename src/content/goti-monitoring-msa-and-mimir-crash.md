---
title: "MSA 전환 후 모니터링 스택 종합 수정 — Mimir/Pyroscope CrashLoop + Loki 캐시 최적화"
excerpt: "단일 서비스에서 6개 MSA 서비스로 분리된 직후 Mimir·Pyroscope·Loki·Recording Rules·대시보드가 연쇄적으로 깨진 사례를 한 번에 복구한 기록입니다."
category: monitoring
tags:
  - go-ti
  - Observability
  - Mimir
  - MSA
  - Pyroscope
  - Loki
  - Prometheus
  - Grafana
series:
  name: "goti-observability-ops"
  order: 4
date: "2026-03-17"
---

## 한 줄 요약

> MSA 전환 직후 Mimir와 Pyroscope가 Helm chart 매핑 버그로 CrashLoopBackOff에 빠지고, Recording Rules와 대시보드가 단일 서비스 하드코딩으로 MSA 메트릭을 수집하지 못하던 문제를 한 사이클에 전부 정리했습니다.

---

## 🔥 문제: MSA 전환 직후 관측성 스택 전반이 깨진 상황

### 기존 아키텍처 / 기대 동작

이 시스템은 단일 서비스(`goti-server`) 구조에서 6개 MSA 서비스로 분리된 직후였습니다. 분리된 서비스는 `goti-user`, `goti-stadium`, `goti-ticketing`, `goti-payment`, `goti-resale`, 그리고 남은 `goti-server`입니다.

환경은 Kind 7노드(컨트롤플레인 3, 워커 4), 호스트 RAM 32GB, 배포는 ArgoCD GitOps로 관리합니다. 기대했던 동작은 단순했습니다. MSA 서비스별로 메트릭/트레이스/로그가 수집되고, Recording Rules·대시보드가 각 서비스별로 쿼리 가능해야 합니다.

### 발견한 문제

실제로는 7개 지점에서 동시에 문제가 터졌습니다. 하나씩 살펴보겠습니다.

**1. Mimir CrashLoopBackOff — compactor config 파싱 에러**

```text
error loading config from /etc/mimir/mimir.yaml: yaml: unmarshal errors:
  line 32: field blocks_retention_period not found in type compactor.Config
```

`ingester`, `compactor`, `store-gateway`, `querier`, `query-frontend`, `query-scheduler`가 전부 CrashLoopBackOff 상태였습니다.

**2. Pyroscope CrashLoopBackOff — 동일 패턴**

```text
failed parsing config: /etc/pyroscope/config.yaml: yaml: unmarshal errors:
  line 2: field retention_period not found in type compactor.Config
```

**3. Mimir ingester OOMKilled**

```text
Last State: Terminated
  Reason: OOMKilled
  Exit Code: 137
```

ingester limits가 1Gi였는데, WAL replay와 Kafka catch-up이 동시에 일어나면서 메모리가 초과됐습니다.

**4. Grafana 대시보드 500 에러**

```text
unexpected response with status code 500:
{"status":"error","errorType":"internal","error":"partition 0: too many unhealthy instances in the ring"}
```

ingester가 ring에 ACTIVE로 등록되지 못해 querier가 쿼리를 실행할 수 없었습니다.

**5. Recording/Alerting Rules + 대시보드가 MSA에 미대응**

- Recording rules에 `job="goti/goti-server"` 하드코딩이 19회 발견됐습니다. MSA 서비스 메트릭이 아예 집계되지 않습니다.
- Alerting rules에도 같은 패턴이 12회 있었습니다.
- 대시보드 7종의 `service_name` 변수 `current` 값이 `goti/goti-server`로 고정돼 있었습니다.

**6. Loki memcached 캐시가 과도하게 메모리를 점유**

- `loki-dev-chunks-cache`: 9,830Mi (worker2 requests의 96%)
- `loki-dev-results-cache`: 1,229Mi

dev 환경에서 불필요하게 약 11Gi를 점유하고 있었습니다.

**7. Renovate GitHub Action CI 실패**

```text
##[error]Unable to resolve action `renovatebot/github-action@v41.14.4`, unable to find version `v41.14.4`
```

---

## 🤔 원인

### Mimir/Pyroscope: Helm chart의 structuredConfig 매핑 버그

가장 먼저 의심한 것은 Mimir 3.x 버전에서 `compactor.blocks_retention_period` 필드가 `limits` 섹션으로 이동한 것이 아닐까 하는 가설이었습니다.

Go 소스코드(`github.com/grafana/mimir/pkg/compactor`)를 직접 확인한 결과, `compactor.Config` struct에는 `blocks_retention_period` 필드가 **존재하지 않습니다**. 모든 Mimir 버전에서 올바른 위치는 `limits.compactor_blocks_retention_period`입니다.

진짜 원인은 Helm chart에 있었습니다. `mimir-distributed` chart 6.0.5가 `structuredConfig.limits.compactor_blocks_retention_period`로 전달된 값을 최종 렌더링 단계에서 `compactor.blocks_retention_period`로 **잘못 매핑**하고 있었습니다. 사용자는 올바른 경로로 값을 넣었지만 chart template이 잘못된 위치로 밀어넣은 것입니다.

Pyroscope도 Mimir 기반을 공유하므로 `compactor.Config`에 `retention_period` 필드가 없는 동일한 문제가 있었습니다.

### Mimir ingester OOM: WAL replay + Kafka catch-up의 동시 부하

OOM의 원인은 복합적이었습니다.

1. ingester limits가 1Gi로 잡혀 있었고, 5시간 동안 CrashLoop가 반복되는 사이 Kafka `mimir-ingest` 토픽에 약 60만건의 메시지가 적체됐습니다.
2. ingester가 기동할 때는 WAL replay와 Kafka catch-up이 동시에 일어나며 메모리 spike가 발생합니다.
3. 2Gi로 올려도 5시간분 catch-up을 따라가려고 하면 out-of-order 샘플이 대량으로 reject되면서 진행이 매우 느려집니다.

### Ring unhealthy: ingester 미가입의 연쇄 효과

ingester가 CrashLoop로 ring에 등록되지 못하면 `too many unhealthy instances in the ring`이 발생합니다. querier는 ring이 건강하지 않으면 쿼리를 거부하고, 그 결과 Grafana에서 500이 반환됩니다.

### Rules/대시보드: 단일 서비스 시절의 하드코딩

MSA로 분리되기 전에는 모든 메트릭의 `job` 레이블이 `goti/goti-server` 하나였습니다. Recording Rules와 대시보드는 그 전제로 작성돼 있었기 때문에, 서비스가 6개로 늘어나자 기존 서비스 한 개만 집계되고 나머지는 조용히 무시됐습니다.

### Loki 캐시: chart 기본값이 dev에 과했음

Loki chart의 `chunksCache`/`resultsCache`는 기본값이 `enabled: true`이며 대형 memcached 리소스를 요구합니다. 운영 환경에는 맞지만 Kind 7노드 dev 환경에서는 약 11Gi를 먹으면서 다른 워크로드를 압박하고 있었습니다.

### Renovate Action: 태그 삭제

`renovatebot/github-action@v41.14.4`가 어느 시점에 레지스트리에서 삭제되면서 CI가 resolve 단계에서 실패했습니다.

---

## ✅ 해결

### 1. Mimir `compactor.blocks_retention_period` 제거

`mimir-values.yaml`에서 retention 설정을 제거했습니다. dev에서는 기본값(사실상 무제한 보존)을 사용하기로 했고, 향후 chart 업그레이드 또는 runtime config로 해결할 예정입니다.

참고: [Grafana Mimir retention docs](https://grafana.com/docs/mimir/latest/configure/configure-metrics-storage-retention/)

### 2. Pyroscope `compactor.retention_period` 제거

`pyroscope-values.yaml`에서 `structuredConfig.compactor.retention_period`를 제거했습니다. 동일 계열의 chart 매핑 버그이기 때문에 동일 처방을 적용했습니다.

### 3. Mimir ingester 리소스 상향 + Kafka topic purge

적체된 메시지를 끌고 가는 대신 dev 환경이므로 상태를 깨끗이 밀고 다시 시작하는 방향을 택했습니다.

1. ingester memory limits를 `1Gi → 2Gi`로 상향했습니다.
2. Kafka `mimir-ingest` 토픽을 삭제했습니다. `apache/kafka:3.8.1` 이미지를 임시 Pod로 올려서 CLI로 실행했습니다.
3. ingester PVC를 삭제하고 StatefulSet을 재생성했습니다. 깨끗한 상태에서 기동합니다.
4. 이 과정에서 닭과 달걀 문제가 있었습니다. ArgoCD sync가 ingester healthy를 기다리느라 StatefulSet 업데이트를 진행하지 못하는 상황입니다. 이 구간만은 `helm template`으로 매니페스트를 뽑아 `kubectl apply`로 직접 반영했습니다.

### 4. Recording/Alerting Rules MSA 대응

하드코딩된 `job`을 정규식 매칭으로 바꾸고, 집계 시 `job` 레이블을 보존하도록 고쳤습니다.

| Before (단일 서비스) | After (MSA) |
|---------------------|-------------|
| `sum(rate(...{job="goti/goti-server"}...))` | `sum by (job) (rate(...{job=~"goti/.+"}...))` |
| `or on() vector(0)` | `or (0 * sum by (job) (rate(...)))` |
| `sum(...) by (le)` | `sum by (job, le) (...)` |

핵심 포인트는 두 가지입니다.

첫째, `or on() vector(0)` 패턴은 편리하지만 MSA 환경에서는 `job` 레이블을 날려버립니다. `or (0 * total)` 형태로 바꿔야 `job` 레이블이 유지됩니다.

둘째, Alerting rules의 `annotation`에 `{{ $labels.job }}`을 추가해 알림에서 어느 서비스인지 식별할 수 있게 했습니다. 다만 Helm template 주석에서 `{{ $labels.job }}`을 그대로 쓰면 Go template 파서가 먼저 평가하려고 시도해 파싱 에러가 납니다. 이 부분은 이스케이프 처리가 필요합니다.

수정 파일은 recording rule(templates + SSOT), alerting rule(templates + SSOT) 총 4개입니다.

### 5. 대시보드 MSA 대응

7개 대시보드에서 `service_name`과 `svc` 변수의 `current` 하드코딩을 제거하고 `"current": {}`로 비웠습니다. 이렇게 두면 Grafana가 첫 번째 쿼리 결과를 자동으로 선택합니다.

```json
"current": {}
```

수정 파일은 charts 7개 + Grafana SSOT 7개로 총 14개입니다.

### 6. Loki 캐시 비활성화

dev values에서 chart 기본값을 덮어썼습니다.

```yaml
chunksCache:
  enabled: false
resultsCache:
  enabled: false
```

약 11Gi 메모리가 즉시 회수됐습니다.

### 7. Renovate Action 버전 업데이트

```yaml
uses: renovatebot/github-action@v46.1.5
```

`v41.14.4`는 삭제됐으므로 `v46.1.5`로 교체했습니다.

### 8. 검증 스크립트 MSA 대응

모니터링 스택 검증 스크립트도 단일 서비스 전제로 작성돼 있어 고쳤습니다.

- `extract-queries.sh`: `$service_name` → `goti/goti-user`, `$svc` → `goti-user`
- `payloads/*.json`: `service.name` → `goti-user`

### 수정 후 상태

| 컴포넌트 | Before | After |
|----------|--------|-------|
| Mimir ingester | OOMKilled (CrashLoop 65회) | Running, ready=true, 0 restarts |
| Mimir compactor | CrashLoopBackOff (config 에러) | Running 1/1 |
| Mimir store-gateway | CrashLoopBackOff (config 에러) | Running 1/1 |
| Mimir distributor/querier/frontend/scheduler | 일부 CrashLoop | 전원 Running |
| Pyroscope | CrashLoopBackOff (config 에러) | Running 1/1 |
| Loki | Running (캐시 11Gi 낭비) | Running (캐시 비활성화) |
| 대시보드 | 500 ring unhealthy + No data | 쿼리 가능 |
| Recording rules | goti-server만 집계 | `by (job)` 기반 MSA 전체 집계 |
| Renovate CI | resolve 실패 | `v46.1.5` 정상 |

---

## 📚 배운 점

- **Helm chart의 structuredConfig는 곧이곧대로 믿지 않습니다.** Mimir 6.0.5처럼 상위 스펙의 필드를 하위 경로로 잘못 매핑하는 버그가 실재합니다. 설정 파싱 에러가 나면 values를 의심하기 전에 렌더링된 ConfigMap을 먼저 확인합니다.
- **CrashLoop가 오래 지속된 후에는 리소스만 올려서는 안 됩니다.** Kafka에 적체된 메시지가 WAL replay와 겹치면서 또 다른 OOM 루프를 만듭니다. dev라면 topic purge + PVC 초기화가 가장 빠릅니다.
- **`or on() vector(0)` 패턴은 MSA에 맞지 않습니다.** `job` 같은 그룹핑 레이블을 보존하려면 `or (0 * sum by (job) (...))`로 바꿔야 합니다. 모든 규칙에 일괄 적용할 수 있도록 표준화하는 것이 좋습니다.
- **대시보드 변수 `current`는 비워두는 것이 안전합니다.** 하드코딩된 값은 아키텍처가 변할 때마다 No data 장애의 씨앗이 됩니다.
- **dev 환경의 chart 기본값은 항상 의심합니다.** Loki chunksCache/resultsCache처럼 운영을 가정한 기본값이 dev의 노드를 통째로 먹을 수 있습니다.
- **GitHub Action은 pinning보다 버전 상한을 관리합니다.** 태그가 삭제되는 경우가 있으므로 CI에서 resolve 실패가 뜨면 곧바로 업스트림 릴리스를 확인합니다.
