---
title: "Tempo spanmetrics 전량 폐기 — batch timeout과 ingestion slack의 함정"
excerpt: "140만 span이 수신됐지만 전량 폐기됐다. Alloy Kafka consumer의 batch timeout이 Tempo의 ingestion slack을 초과해서 모든 spanmetrics가 생성되지 않은 문제"
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

> Tempo가 140만 span을 수신했지만 전량 `outside_metrics_ingestion_slack`으로 폐기했습니다. Alloy Kafka consumer의 batch timeout(10s)이 dev 환경의 저트래픽에서 항상 최악 케이스로 작동해서, 전체 파이프라인 지연이 Tempo의 30초 slack을 넘긴 것이 원인이었습니다.

## Impact

- **영향 범위**: DB Health 대시보드의 span metrics 기반 패널 전체
- **증상**: `traces_spanmetrics_latency_bucket`, `traces_spanmetrics_calls_total` 모두 0건
- **발생일**: 2026-03-26

---

## 🔥 증상: spanmetrics만 No data

DB Health 대시보드에서 ticketing 서비스를 선택하니 span metrics 기반 패널이 전부 No data였습니다.

이상한 점은 **HikariCP Connection Pool 메트릭은 정상**이라는 것입니다.
`db_client_connections_*`는 잘 보이는데, `traces_spanmetrics_*`만 없습니다.

두 메트릭의 수집 경로가 다르기 때문입니다:
- HikariCP: Alloy scraping → Mimir (직접)
- spanmetrics: App → Alloy → Kafka → Tempo → metrics_generator → Mimir

Tempo의 metrics_generator 쪽에 문제가 있다고 좁혔습니다.

---

## 🤔 진단: 140만 span, 전량 폐기

Tempo의 `/metrics` 엔드포인트를 확인했습니다.

```
tempo_metrics_generator_spans_received_total       = 1,406,413
tempo_metrics_generator_spans_discarded_total       = 1,406,413
  reason="outside_metrics_ingestion_slack"
tempo_metrics_generator_registry_active_series      = 0
tempo_metrics_generator_registry_series_added_total = 0
```

140만 span을 수신했지만 **전량 폐기**. 시리즈 0건 생성.

폐기 사유가 `outside_metrics_ingestion_slack`입니다.
이것은 "span의 타임스탬프가 Tempo 수신 시각 대비 너무 오래됐다"는 의미입니다.

Tempo의 `metrics_ingestion_time_range_slack` 기본값은 **30초**입니다.
span이 생성된 후 30초 이내에 Tempo에 도착해야 metrics_generator가 처리합니다.
30초를 넘기면 "너무 오래된 데이터"로 판단해서 폐기합니다.

---

## 🤔 원인: 파이프라인 지연 합산이 30초를 넘는다

전체 트레이스 파이프라인의 지연을 단계별로 계산했습니다.

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

최악 케이스에서 21초 + Kafka lag.
간헐적으로 Kafka consumer lag이 10초 이상 추가되면 30초를 넘깁니다.

### batch timeout의 함정

여기서 핵심은 **batch timeout의 동작 방식**입니다.

batch processor는 두 가지 조건 중 하나가 충족되면 전송합니다:
1. `send_batch_size`(256개)에 도달하면 즉시 전송
2. `timeout`(10s)에 도달하면 모아진 것만 전송

**스파이크 트래픽**에서는 256개가 금방 차서 timeout이 무의미합니다.
**저트래픽**에서는 256개가 안 차서 **항상 timeout까지 대기**합니다.

dev 환경은 synthetic traffic만 소량 흐르는 저트래픽 환경입니다.
batch가 채워지지 않아서 **매번 timeout 10초 전체를 대기**합니다.
이 10초가 파이프라인 전체 지연의 절반을 차지했습니다.

---

## ✅ 해결

### 1. batch timeout 줄이기: 10s → 2s

```yaml
# alloy-values.yaml
batch "kafka_traces":
  timeout: "2s"  # 10s → 2s
  send_batch_size: 256  # 유지
```

수정 후 파이프라인 최악 지연:

```
5(tail_sampling) + 5(batch_traces) + 1(Kafka) + 2(batch_kafka) = ~13초
```

30초 slack 대비 **2배 이상 여유**가 생겼습니다.

스파이크 트래픽에서는 어떻겠습니까?
send_batch_size=256이 먼저 트리거되니까 timeout 값은 무관합니다.
2초든 10초든 부하가 높으면 배치가 금방 차서 즉시 전송됩니다.

### 2. ingestion slack 명시

```yaml
# tempo-values.yaml
metrics_generator:
  metrics_ingestion_time_range_slack: 30s  # 기본값과 동일하지만 명시
```

기본값과 같지만, 파이프라인 지연 대비 마진이 충분함을 **주석으로 문서화**했습니다.
나중에 파이프라인에 새 버퍼를 추가할 때 이 값을 확인하게 됩니다.

---

## 📚 배운 점

### Batch timeout은 부하에 따라 완전히 다르게 작동한다

batch processor를 설정할 때 보통 "timeout 10s, batch_size 256"이면 적당하다고 생각합니다.
스파이크 트래픽에서는 맞는 말입니다. 256개가 금방 차니까 timeout은 안전장치 역할만 합니다.

하지만 **저트래픽에서는 timeout이 곧 지연 시간**입니다.
256개를 절대 못 채우니까 매번 10초를 꼬박 기다립니다.
dev 환경처럼 트래픽이 적은 곳에서 timeout이 큰 값이면, 실질적으로 모든 데이터가 10초씩 지연되는 것입니다.

### 파이프라인에 버퍼를 추가하면 ingestion slack을 재계산해야 한다

Kafka 버퍼를 도입한 것은 [Tempo OOM 문제](/blog/goti-tempo-oom-kafka-buffer-sampling) 때문이었습니다.
그때는 "Kafka가 spike를 흡수한다"는 장점만 봤지, **파이프라인 전체 지연이 늘어난다**는 점은 놓쳤습니다.

관측성 파이프라인에 새 컴포넌트(Kafka, queue, 추가 processor 등)를 넣을 때는 반드시:

1. **각 단계의 최악 지연을 합산**한다
2. 다운스트림의 **time-based 제약**(ingestion slack, out-of-order window 등)과 비교한다
3. 합산 지연이 제약의 50% 이내인지 확인한다 (마진 확보)

### dev 환경의 "저트래픽 함정"

prod에서는 잘 동작하는 설정이 dev에서 깨지는 경우가 있습니다.
이 케이스가 정확히 그랬습니다.

prod의 고트래픽 → batch가 빨리 차서 timeout 무관 → 정상
dev의 저트래픽 → batch가 안 차서 항상 timeout → 지연 누적 → 폐기

prod과 dev의 차이를 batch timeout 하나에서도 고려해야 합니다.
