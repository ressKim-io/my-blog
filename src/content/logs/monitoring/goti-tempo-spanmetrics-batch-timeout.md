---
title: "수신 140만 건, 생성 0건 — 에러 없이 사라진 spanmetrics"
excerpt: "OOM을 막으려 넣은 Kafka 버퍼의 지연이 Tempo의 ingestion slack을 넘기면서 span 140만 건이 전량 폐기됐습니다. 에러 로그도 알림도 없이 대시보드만 No Data였고, 실패한 컴포넌트가 하나도 없는 상태에서 가설 네 개로 원인을 좁혀간 기록입니다"
category: monitoring
tags:
  - go-ti
  - Tempo
  - Alloy
  - Kafka
  - Batch Processing
  - OpenTelemetry
  - Troubleshooting
series:
  name: "goti-observability-stack"
  order: 5
date: "2026-03-26"
---

## 한 줄 요약

> Tempo가 140만 span을 받아서 전부 `outside_metrics_ingestion_slack`으로 버렸습니다. 실패한 컴포넌트는 없었고 로그도 깨끗했습니다. 각 단계의 지연이 합산돼 Tempo의 30초 slack을 넘긴 것이 원인이었고, batch timeout은 트래픽이 적을수록 오히려 커진다는 역설이 있었습니다

## Impact

- **영향 범위**: DB Health 대시보드의 span metrics 기반 패널 전체
- **증상**: `traces_spanmetrics_latency_bucket`, `traces_spanmetrics_calls_total` 모두 0건
- **발생일**: 2026-03-26

---

## 🔥 증상: spanmetrics만 No data

DB Health 대시보드에서 ticketing 서비스를 고르니 span metrics 기반 패널이 전부 No data였습니다

이상한 것은 **HikariCP Connection Pool 메트릭은 멀쩡하다**는 점이었습니다. `db_client_connections_*`는 잘 나오는데 `traces_spanmetrics_*`만 비어 있었습니다

둘은 수집 경로가 다릅니다

- HikariCP: Alloy scraping → Mimir (직접)
- spanmetrics: App → Alloy → Kafka → Tempo → metrics_generator → Mimir

메트릭이 전부 안 나오는 게 아니라 한쪽 경로만 죽었다는 뜻이라, Tempo의 metrics_generator 근처로 범위를 좁혔습니다

---

## 🤔 진단: 140만 span, 전량 폐기

Tempo의 `/metrics` 엔드포인트를 열었습니다

```text
tempo_metrics_generator_spans_received_total       = 1,406,413
tempo_metrics_generator_spans_discarded_total       = 1,406,413
  reason="outside_metrics_ingestion_slack"
tempo_metrics_generator_registry_active_series      = 0
tempo_metrics_generator_registry_series_added_total = 0
```

받은 수와 버린 수가 정확히 같습니다. 만들어진 시리즈는 0건입니다

폐기 사유 `outside_metrics_ingestion_slack`은 span의 타임스탬프가 Tempo에 도착한 시각보다 너무 오래됐다는 뜻입니다

Tempo의 `metrics_ingestion_time_range_slack` 기본값은 **30초**입니다. span이 만들어진 뒤 30초 안에 도착해야 metrics_generator가 받아 줍니다

30초를 넘기면 오래된 데이터로 보고 버립니다. 버리면서 에러를 내지는 않습니다

---

## 🤔 원인: 각 단계 지연을 합치면 30초를 넘는다

트레이스 파이프라인의 지연을 단계별로 더해 봤습니다

| 단계 | 누적 지연 | 비고 |
|---|---|---|
| App에서 span 생성 | 0초 | 타임스탬프 기록 시점 |
| Alloy OTLP receiver | 0초 | |
| `tail_sampling` (`decision_wait: 5s`) | +5초 | |
| `batch "traces"` (`timeout: 5s`) | +5초 | |
| Kafka exporter → Kafka topic | 약 +1초 | |
| Kafka consumer (Alloy) | 0초 | lag 없을 때 |
| `batch "kafka_traces"` (`timeout: 10s`) | +10초 | **병목** |
| Tempo OTLP exporter | 0초 | |
| **최악 합계** | **약 21초** | + Kafka lag |

21초에 Kafka lag이 붙습니다. lag이 10초만 끼어도 30초를 넘깁니다

여기서 눈여겨볼 곳은 마지막 batch입니다. 혼자서 전체 지연의 절반을 차지합니다

### batch timeout의 함정

batch processor는 두 조건 중 하나만 맞으면 내보냅니다

1. `send_batch_size`(256개)가 차면 바로 보냅니다
2. `timeout`(10초)이 되면 그때까지 모인 것만 보냅니다

트래픽이 몰릴 때는 256개가 금방 차서 timeout이 걸릴 일이 없습니다. 반대로 트래픽이 적으면 256개를 못 채워 **매번 timeout을 꽉 채워 기다립니다**

dev 환경은 synthetic traffic만 조금 흐르는 곳입니다. 배치가 찰 일이 없으니 항상 10초를 기다렸습니다

부하를 거는 동안에는 멀쩡하다가, 한산한 평상시에 오히려 데이터가 사라지는 구조였습니다

---

## ✅ 해결

### 1. batch timeout 줄이기: 10s → 2s

```yaml
# alloy-values.yaml
batch "kafka_traces":
  timeout: "2s"  # 10s → 2s
  send_batch_size: 256  # 유지
```

수정 후 최악 지연은 이렇게 됩니다

```text
5(tail_sampling) + 5(batch_traces) + 1(Kafka) + 2(batch_kafka) = 약 13초
```

30초 slack 대비 두 배 이상 여유가 생겼습니다

트래픽이 몰릴 때는 `send_batch_size` 256이 먼저 걸리므로 timeout 값은 영향을 주지 않습니다. 2초든 10초든 배치가 금방 차서 바로 나갑니다

### 2. ingestion slack 명시

```yaml
# tempo-values.yaml
metrics_generator:
  metrics_ingestion_time_range_slack: 30s  # 기본값과 동일하지만 명시
```

기본값과 같은 값을 굳이 적어 둔 이유가 있습니다

나중에 파이프라인에 버퍼를 하나 더 넣을 때, 이 값이 보이면 지연 예산을 다시 계산하게 됩니다. 이번에 놓친 것이 정확히 그 계산이었습니다

---

## 📚 배운 점

### batch timeout은 부하에 따라 정반대로 작동한다

batch processor를 설정할 때 "timeout 10초, batch_size 256"이면 무난하다고 여기기 쉽습니다

트래픽이 많은 환경에서는 맞는 말입니다. 256개가 금세 차니 timeout은 안전장치로만 남습니다

그런데 트래픽이 적으면 **timeout이 곧 지연 시간이 됩니다**. 256개를 영영 못 채우니 매번 10초를 꼬박 기다립니다

dev처럼 한산한 환경에서 timeout을 크게 잡아 두면, 사실상 모든 데이터가 10초씩 늦게 도착합니다

### 파이프라인에 버퍼를 넣으면 ingestion slack을 다시 계산해야 한다

Kafka 버퍼를 넣은 이유는 [Tempo OOM 문제](/logs/goti-tempo-oom-kafka-buffer-sampling/) 때문이었습니다

그때는 Kafka가 몰리는 트래픽을 받아 준다는 이점만 봤습니다. 그 대신 파이프라인 전체가 느려진다는 사실은 계산에 넣지 않았습니다

관측 파이프라인에 새 컴포넌트를 넣을 때는 순서를 정해 두는 편이 낫습니다

1. 각 단계의 최악 지연을 **합산**한다
2. 아래쪽 컴포넌트의 **시간 기반 제약**(ingestion slack, out-of-order window 등)과 견준다
3. 합산 지연이 제약의 50% 안에 드는지 확인한다

### dev 환경의 저트래픽 함정

prod에서 잘 도는 설정이 dev에서 깨지는 경우가 있습니다. 이번이 딱 그랬습니다

prod은 트래픽이 많아 배치가 빨리 차므로 timeout과 무관하게 정상입니다. dev는 배치가 안 차서 항상 timeout까지 가고, 지연이 쌓여 결국 폐기됩니다

보통은 dev에서 통과하면 prod을 걱정하는데, 여기서는 방향이 반대였습니다. batch timeout처럼 부하에 따라 동작이 뒤집히는 설정은 양쪽을 따로 봐야 합니다
