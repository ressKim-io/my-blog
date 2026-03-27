---
date: 2026-03-26
category: troubleshoot
project: Goti-monitoring
tags: [tempo, spanmetrics, alloy, kafka, batch-timeout, ingestion-slack, otel-pipeline]
---

# Tempo spanmetrics 전량 폐기 — Alloy Kafka batch timeout 과다로 ingestion slack 초과

## Context

Goti dev 환경 (Kind K8s). DB Health 대시보드에서 ticketing 서비스 선택 시 DB 관련 패널 전부 No Data.
트레이스 파이프라인: App(OTel Agent) → Alloy(OTLP) → tail_sampling → Kafka → Alloy(consumer) → Tempo.
Tempo metrics generator가 span에서 `traces_spanmetrics_*` 메트릭을 생성하여 Mimir로 remote_write하는 구조.

## Issue

DB Health 대시보드의 span metrics 기반 패널 전체 No Data:
- `traces_spanmetrics_latency_bucket` — 0건
- `traces_spanmetrics_calls_total` — 0건
- HikariCP Connection Pool 메트릭(`db_client_connections_*`)은 정상 수집 (Alloy scraping 경로, 별도 파이프라인)

```
# Tempo /metrics에서 확인
tempo_metrics_generator_spans_received_total{tenant="single-tenant"} = 1,406,413
tempo_metrics_generator_spans_discarded_total{reason="outside_metrics_ingestion_slack",tenant="single-tenant"} = 1,406,413
tempo_metrics_generator_registry_active_series{tenant="single-tenant"} = 0
tempo_metrics_generator_registry_series_added_total{tenant="single-tenant"} = 0
```

140만 span을 수신했지만 **전량 `outside_metrics_ingestion_slack` 사유로 폐기**. 시리즈 0건 생성.

## Action

### 1. 가설: 대시보드 쿼리 오류 → 기각

대시보드 JSON의 PromQL 쿼리 확인. `job="$service_name"`, `service=~"$svc"` 변수 매핑 정상.
`$svc` 변수에 regex `.*/(.+)` 적용으로 namespace 제거도 정상.

### 2. 가설: 메트릭 자체 미수집 → 부분 확인

Mimir에서 직접 쿼리:
- `db_client_connections_usage{job="goti/goti-ticketing"}` → **데이터 있음** (HikariCP 정상)
- `traces_spanmetrics_latency_bucket{service="goti-ticketing"}` → **빈 결과** (spanmetrics 미생성)

→ Tempo metrics generator 문제로 좁힘.

### 3. 가설: Tempo generator 비활성 → 기각

- `/status/overrides/single-tenant` 확인: `processors: [service-graphs, span-metrics]` 정상 로드
- `/metrics-generator/ring` 확인: `tempo-dev-0` ACTIVE 상태, 256 tokens, 100% ownership
- `tempo_metrics_generator_active_processors{processor="span-metrics"}` = 1 (활성)

### 4. 가설: span이 ingestion slack 초과로 폐기 → **확인 (Root Cause)**

`tempo_metrics_generator_spans_discarded_total{reason="outside_metrics_ingestion_slack"}` = 수신 span 수와 동일.
→ **모든 span의 타임스탬프가 Tempo 수신 시각 대비 `metrics_ingestion_time_range_slack`(기본 30s)을 초과.**

### Root Cause: Alloy 트레이스 파이프라인 지연 합산 > 30초

```
App(OTel Agent) 에서 span 생성 (타임스탬프 기록)
  → Alloy OTLP receiver
  → tail_sampling (decision_wait: 5s)         +5초
  → batch "traces" (timeout: 5s)              +5초
  → Kafka exporter → Kafka topic              +~1초
  → Kafka consumer (Alloy)
  → batch "kafka_traces" (timeout: 10s)       +10초  ← 병목
  → Tempo OTLP exporter
──────────────────────────────────────────────
최악 합계:                                     ~21초 + Kafka lag
```

**핵심**: `batch timeout`은 배치가 `send_batch_size`에 도달하지 못할 때만 적용됨.
- **스파이크 트래픽**: 256개 즉시 채워 전송 → timeout 무관
- **저트래픽 (dev 평시)**: 배치가 거의 안 참 → **항상 timeout까지 대기** → 최악 케이스 상시 발생

dev 환경은 synthetic traffic만 소량 흐르므로 batch가 채워지지 않아 매번 timeout(10초) 전체를 대기.
여기에 간헐적 Kafka consumer lag이 추가되면 30초를 넘겨 span 전량 폐기.

### 적용한 수정

1. **Alloy** `batch "kafka_traces"` timeout: `10s → 2s`
   - 저트래픽 시 불필요한 10초 대기 제거
   - 수정 후 파이프라인 최악 지연: 5 + 5 + 1 + 2 = **~13초** (30초 slack 내 안전)
   - 스파이크 시에는 send_batch_size=256이 먼저 트리거되므로 Tempo 부하 영향 없음

2. **Tempo** `metrics_ingestion_time_range_slack: 30s` 명시
   - 기본값과 동일하지만, 파이프라인 지연 대비 충분한 마진임을 주석으로 명시
   - 파이프라인 총 지연(~13초) 대비 2배 이상 여유

## Result

- 배포 후 검증 대기 중
- 검증 항목:
  - [ ] `tempo_metrics_generator_spans_discarded_total{reason="outside_metrics_ingestion_slack"}` 증가 멈춤
  - [ ] `tempo_metrics_generator_registry_active_series > 0`
  - [ ] Mimir에서 `traces_spanmetrics_latency_bucket{service="goti-ticketing"}` 데이터 존재
  - [ ] DB Health 대시보드 span metrics 패널 정상 표시

### 회귀 방지

- 파이프라인에 버퍼(Kafka, queue 등) 추가 시 **다운스트림 ingestion slack 재계산 필수**
- batch timeout 변경 시 전체 파이프라인 지연 합산과 ingestion slack 비교 검증
- `.claude/rules/monitoring.md`에 관련 pitfall 추가 검토

## Related Files

- `Goti-monitoring/values-stacks/dev/alloy-values.yaml` — batch "kafka_traces" timeout 10s → 2s
- `Goti-monitoring/values-stacks/dev/tempo-values.yaml` — metrics_ingestion_time_range_slack 30s 명시
