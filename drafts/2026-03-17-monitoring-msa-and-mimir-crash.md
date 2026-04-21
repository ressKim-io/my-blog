---
date: 2026-03-17
category: troubleshoot
project: Goti-monitoring, Goti-k8s
tags: [mimir, pyroscope, loki, prometheus-rules, grafana-dashboard, msa, oom, kafka, helm-chart, argocd]
---

# 모니터링 스택 종합 수정 — MSA 대응 + Mimir/Pyroscope CrashLoopBackOff + Loki 캐시 최적화

## Context

MSA 전환 후 모니터링 스택 전반에 문제 발생. goti-server 단일 서비스에서 6개 MSA 서비스(goti-user, goti-stadium, goti-ticketing, goti-payment, goti-resale + goti-server)로 분리된 상태.

환경: Kind 7노드 (CP3 + Worker4), 32GB RAM 호스트, ArgoCD GitOps

## Issue

### 1. Mimir CrashLoopBackOff — compactor config 에러

```
error loading config from /etc/mimir/mimir.yaml: yaml: unmarshal errors:
  line 32: field blocks_retention_period not found in type compactor.Config
```

ingester, compactor, store-gateway, querier, query-frontend, query-scheduler 전부 CrashLoopBackOff.

### 2. Pyroscope CrashLoopBackOff — 동일 패턴

```
failed parsing config: /etc/pyroscope/config.yaml: yaml: unmarshal errors:
  line 2: field retention_period not found in type compactor.Config
```

### 3. Mimir ingester OOMKilled

```
Last State: Terminated
  Reason: OOMKilled
  Exit Code: 137
```

ingester limits 1Gi에서 WAL replay + Kafka catch-up 시 메모리 초과.

### 4. Grafana 대시보드 500 에러

```
unexpected response with status code 500:
{"status":"error","errorType":"internal","error":"partition 0: too many unhealthy instances in the ring"}
```

ingester가 ring에 ACTIVE 등록 안 되어 querier가 쿼리 실행 불가.

### 5. Recording/Alerting Rules + 대시보드 MSA 미대응

- Recording rules: `job="goti/goti-server"` 하드코딩 19회 → MSA 서비스 메트릭 수집 안 됨
- Alerting rules: 동일 패턴 12회
- 대시보드 7종: `service_name` 변수 current 값 `goti/goti-server` 하드코딩

### 6. Loki memcached 캐시 과다 메모리 사용

- loki-dev-chunks-cache: 9,830Mi (worker2 requests의 96%)
- loki-dev-results-cache: 1,229Mi
- dev에서 불필요한 ~11Gi 메모리 점유

### 7. Renovate GitHub Action CI 실패 (Goti-k8s)

```
##[error]Unable to resolve action `renovatebot/github-action@v41.14.4`, unable to find version `v41.14.4`
```

## Action

### 1. Mimir `compactor.blocks_retention_period` — 외부 조사 + 수정

**가설**: Mimir 3.x에서 `compactor.blocks_retention_period` 필드가 `limits` 섹션으로 이동
**조사 결과**: Go 소스코드([pkg/compactor](https://pkg.go.dev/github.com/grafana/mimir/pkg/compactor)) 확인 — `compactor.Config` struct에 `blocks_retention_period` 필드가 **존재하지 않음**. 모든 Mimir 버전에서 올바른 위치는 `limits.compactor_blocks_retention_period`.

**근본 원인**: mimir-distributed Helm chart 6.0.5가 `structuredConfig.limits.compactor_blocks_retention_period`를 `compactor.blocks_retention_period`로 **잘못 매핑**하는 chart template 버그.

**수정**: `mimir-values.yaml`에서 `compactor_blocks_retention_period` 제거 (dev에서 기본값 무제한 보존 사용). 향후 chart 업그레이드 또는 runtime config로 해결.

- 참고: [Grafana Mimir retention docs](https://grafana.com/docs/mimir/latest/configure/configure-metrics-storage-retention/)

### 2. Pyroscope `compactor.retention_period` — 동일 패턴

**근본 원인**: Pyroscope도 Mimir 기반이라 동일한 struct 이슈. `compactor.Config`에 `retention_period` 필드 없음.

**수정**: `pyroscope-values.yaml`에서 `structuredConfig.compactor.retention_period` 제거.

### 3. Mimir ingester OOMKilled — 리소스 + Kafka topic purge

**진단**:
1. ingester limits 1Gi → 5시간 CrashLoop 동안 Kafka에 ~60만건 메시지 적체
2. ingester 기동 시 WAL replay + Kafka catch-up에 메모리 spike → OOM
3. 2Gi로 올려도 5시간분 catch-up이 out-of-order reject하면서 진행이 느림

**수정**:
1. ingester memory limits `1Gi → 2Gi`
2. Kafka `mimir-ingest` topic 삭제 (apache/kafka:3.8.1 임시 파드로 CLI 실행)
3. ingester PVC 삭제 → StatefulSet 재생성 → 깨끗한 상태에서 기동
4. 닭과 달걀 문제 (ArgoCD sync가 ingester healthy 대기 → StatefulSet 업데이트 불가) → helm template으로 직접 kubectl apply

### 4. Recording/Alerting Rules MSA 대응

**수정 패턴**:

| Before (단일 서비스) | After (MSA) |
|---------------------|-------------|
| `sum(rate(...{job="goti/goti-server"}...))` | `sum by (job) (rate(...{job=~"goti/.+"}...))` |
| `or on() vector(0)` | `or (0 * sum by (job) (rate(...)))` |
| `sum(...) by (le)` | `sum by (job, le) (...)` |

- `or on() vector(0)` → `or (0 * total)` 패턴: MSA에서 job 레이블 보존
- alerting rules annotation에 `{{ $labels.job }}` 추가로 서비스 식별
- Helm template 주석에 `{{ $labels.job }}` 사용 시 Go template 파싱 에러 → 이스케이프 필요

**파일**: recording rule (templates + SSOT), alerting rule (templates + SSOT) — 총 4파일

### 5. 대시보드 MSA 대응

7개 대시보드에서 `service_name` + `svc` 변수의 `current` 하드코딩 제거 → `"current": {}` (Grafana가 첫 번째 쿼리 결과 자동 선택).

**파일**: charts 7파일 + grafana SSOT 7파일 = 14파일

### 6. Loki 캐시 비활성화

```yaml
chunksCache:
  enabled: false
resultsCache:
  enabled: false
```

chart 기본값 `enabled: true` → dev에서 override. ~11Gi 메모리 절약.

### 7. Renovate Action 버전 수정

`renovatebot/github-action@v41.14.4` → `@v46.1.5` (구 태그 삭제됨)

### 8. 검증 스크립트 MSA 대응 (Goti-k8s)

- `extract-queries.sh`: `$service_name` → `goti/goti-user`, `$svc` → `goti-user`
- `payloads/*.json`: `service.name` → `goti-user`

## Result

### 수정 후 상태

| 컴포넌트 | Before | After |
|----------|--------|-------|
| mimir ingester | OOMKilled (CrashLoop 65회) | **Running, ready=true, 0 restarts** |
| mimir compactor | CrashLoopBackOff (config 에러) | **Running 1/1** |
| mimir store-gateway | CrashLoopBackOff (config 에러) | **Running 1/1** |
| mimir distributor/querier/frontend/scheduler | 일부 CrashLoop | **전원 Running** |
| pyroscope | CrashLoopBackOff (config 에러) | **Running 1/1** |
| loki | Running (캐시 11Gi 낭비) | **Running (캐시 비활성화)** |
| 대시보드 | 500 ring unhealthy + No data | **쿼리 가능** |
| Recording rules | goti-server만 집계 | **by (job) MSA 전체 집계** |
| Renovate CI | resolve 실패 | **v46.1.5 정상** |

### 재발 방지

1. **version-matrix.md에 Renovate Action 버전 추가** — CI/CD 섹션 신설
2. **monitoring rules에 `or (0 * total)` 패턴 문서화** — MSA 환경에서 job 레이블 보존 표준
3. **Helm chart structuredConfig 매핑 버그 기록** — Mimir chart 6.0.5 + Pyroscope chart에서 retention 설정 시 주의
4. **Loki 캐시 dev 비활성화 패턴** — dev values에 chunksCache/resultsCache enabled: false 표준화

## Related Files

### Goti-monitoring
- `values-stacks/dev/mimir-values.yaml` — ingester 2Gi + retention 제거
- `values-stacks/dev/pyroscope-values.yaml` — compactor.retention_period 제거
- `values-stacks/dev/loki-values.yaml` — chunksCache/resultsCache 비활성화
- `charts/goti-monitoring/templates/prometheusrule-recording.yaml` — MSA by (job)
- `charts/goti-monitoring/templates/prometheusrule-application.yaml` — MSA by (job) + annotation
- `prometheus/rules/recording.yml` — SSOT 동기화
- `prometheus/rules/application.yml` — SSOT 동기화
- `charts/goti-monitoring/dashboards/developer/*.json` (5파일) — current 제거
- `charts/goti-monitoring/dashboards/business/ticketing-overview.json` — current 제거
- `grafana/dashboards/**/*.json` (7파일) — SSOT 동기화

### Goti-k8s
- `.github/workflows/renovate.yml` — v41.14.4 → v46.1.5
- `scripts/validate/extract-queries.sh` — $service_name → goti/goti-user
- `scripts/validate/payloads/metrics.json` — service.name → goti-user
- `scripts/validate/payloads/traces.json` — service.name → goti-user
- `scripts/validate/payloads/logs.json` — service.name → goti-user

### goti-team-controller
- `docs/version-matrix.md` — CI/CD 섹션 추가, Renovate Action v46.1.5
