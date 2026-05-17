---
title: "관측 파이프라인의 Kafka 버퍼 — 시그널별 백프레셔 설계 원리"
excerpt: "메트릭은 직접 remote_write하고 로그·트레이스만 Kafka로 버퍼링하는 이유를 시그널별 지연 허용도 차이, 버스트가 백엔드를 OOM시키는 메커니즘, Kafka 디스크 버퍼가 백프레셔를 흡수하는 원리로 설명합니다"
category: monitoring
tags:
  - go-ti
  - kafka
  - backpressure
  - observability
  - OTel
  - concept
series:
  name: "goti-deepdive-observability"
  order: 5
date: "2026-03-27"
---

## 한 줄 요약

> 관측 파이프라인에서 메트릭은 실시간 알림 때문에 직접 전송하고, 로그·트레이스는 버스트 시 백엔드 OOM을 막기 위해 Kafka 디스크 버퍼를 경유합니다

---

## 🤔 무엇을 푸는 기술인가

관측성 파이프라인은 크게 세 종류의 시그널을 다룹니다 — **메트릭**, **로그**, **트레이스** 각 시그널은 생산 속도, 데이터 크기, 지연 허용도가 제각각입니다

단일 파이프라인으로 모든 시그널을 동일하게 처리하면 한 가지 문제가 생깁니다 트래픽이 갑자기 몰리는 **버스트** 구간에서 수집기(Collector)가 백엔드(Loki, Tempo)에 그대로 밀어 넣으면, 백엔드가 처리 속도를 초과하는 데이터를 메모리에 쌓다가 한계를 넘겨 OOMKilled됩니다

이 문제의 해법이 **버퍼(buffer)**입니다 수집기와 백엔드 사이에 버퍼를 두면, 버스트 시 데이터가 버퍼에 쌓이고 백엔드는 자신이 처리할 수 있는 속도로만 소비합니다 이를 **백프레셔(backpressure) 흡수**라고 합니다

그런데 모든 시그널에 버퍼를 끼워 넣는 건 최선이 아닙니다 메트릭은 알림(alert)과 직결되어 있어, 버퍼 레이턴시가 생기면 "디스크가 90% 찼다"는 알림이 10분 늦게 도착하는 상황이 생깁니다 따라서 **시그널별로 버퍼 사용 여부를 다르게 가져가는 것**이 올바른 설계입니다

---

## 🔧 동작 원리

### 시그널별 특성 — 지연 허용도가 다른 이유

세 시그널은 목적이 다르기 때문에 지연을 바라보는 기준이 다릅니다

| 시그널 | 주 용도 | 지연 허용도 | 데이터 특성 |
|---|---|---|---|
| 메트릭 | 알림 · 대시보드 실시간 모니터링 | 30초 이내 필수 | 소형 숫자(float64), 꾸준한 흐름 |
| 로그 | 장애 원인 분석 | 수십 초~수 분 허용 | 가변 길이 텍스트, 버스트 시 폭증 |
| 트레이스 | span 워터폴 · 레이턴시 분석 | 수십 초~수 분 허용 | 대형 payload (span 수백 개), 버스트 시 폭증 |

메트릭은 Prometheus alert rule이 30초 간격으로 평가됩니다 Kafka를 경유하면 10~30초의 추가 레이턴시가 붙을 수 있어, 알림 발동이 1~2 주기 지연됩니다 장애 대응 타임라인에서 이 지연은 실질적 손해입니다

로그와 트레이스는 상황이 다릅니다 운영자가 장애 발생 후 원인을 분석하는 시점에는 이미 수십 초~수 분이 지난 뒤입니다 데이터가 그 안에 도착하면 충분합니다 그 대신 **데이터 양이 버스트에 취약**합니다 티켓 오픈 같은 순간에 수천 명이 동시에 요청을 보내면, 로그와 span이 순간적으로 수십 배 이상 쏟아집니다

### 버스트가 백엔드를 OOM시키는 메커니즘

버퍼 없이 Collector가 Loki·Tempo에 직접 전송하는 경우를 따라가 보겠습니다

애플리케이션에서 OTLP로 Collector로 span 스트림이 유입됩니다 Collector는 수신한 span을 즉시 Tempo의 OTLP 엔드포인트로 전송합니다 평상시에는 문제가 없습니다 그러나 버스트 구간에서는 Collector가 밀어 넣는 속도가 Tempo가 처리하는 속도를 앞지릅니다

Tempo의 Distributor는 수신된 span을 메모리 내 큐에 쌓아 Ingester로 분배합니다 처리 속도보다 유입 속도가 빠르면 이 큐가 계속 쌓입니다 JVM이나 Go 힙이 설정된 메모리 한도(`--mem-limit-bytes`)를 초과하는 순간, OOM killer가 Pod를 종료합니다 Pod가 재시작되는 동안 유입 데이터는 유실됩니다

이것이 **"직접 전송 → 버스트 → 백엔드 OOM → 데이터 유실"** 사이클입니다 Loki도 동일한 경로로 OOM이 발생합니다

### Kafka 버퍼가 백프레셔를 흡수하는 원리

Kafka는 메시지를 **디스크에 append**합니다 메모리가 아니라 디스크이기 때문에, 처리 속도 차이를 디스크 용량으로 흡수할 수 있습니다

Collector(Front)는 버스트 구간에서도 Kafka에 데이터를 빠르게 적재(produce)합니다 Kafka broker는 토픽 파티션의 파일에 순차적으로 씁니다 이 쓰기 속도는 순수 디스크 I/O 속도에만 의존합니다 Loki나 Tempo의 처리 속도와 무관합니다

Collector(Back) — Kafka consumer — 는 자신이 처리할 수 있는 속도로 Kafka 토픽에서 읽습니다 Loki·Tempo가 처리할 수 있는 throughput에 맞게 batch 크기와 flush 주기를 튜닝합니다 백엔드에 과부하가 걸리면 consumer가 자연히 느려지고, Kafka 토픽의 offset lag가 늘어납니다 백엔드는 OOM 없이 안정적인 처리량을 유지합니다

이 구조의 핵심은 **생산(produce) 속도와 소비(consume) 속도를 디커플링**하는 데 있습니다

![관측 파이프라인 시그널별 경로 분기 — 메트릭 직접 전송 vs 로그·트레이스 Kafka 경유|tall](/diagrams/goti-deepdive-telemetry-kafka-buffer-1.svg)

위 다이어그램은 시그널별 경로가 어떻게 분기하는지 보여줍니다

상단의 Application은 OTel SDK로 세 가지 시그널을 OTLP gRPC(4317)로 Collector에 전송합니다 Collector는 시그널 유형을 식별해 라우팅을 분기합니다 — 메트릭은 초록 경로를 따라 곧바로 Mimir의 `remote_write` 엔드포인트로 전달됩니다 로그는 보라 경로, 트레이스는 주황 경로로 각각 Kafka의 `otlp_logs`·`otlp_spans` 토픽에 적재됩니다

Kafka 하단에는 Collector(Back)이 있습니다 이 프로세스가 토픽을 소비해 Loki와 Tempo에 배치 전송합니다 왼쪽 하단의 점선 박스는 "직접 전송 — 지연 허용 불가" 경로를, 오른쪽 하단은 "Kafka 버퍼 경유 — 버스트 흡수·OOM 방지" 경로를 강조합니다

![버퍼 없음 vs Kafka 버퍼 — 버스트 상황 비교|tall](/diagrams/goti-deepdive-telemetry-kafka-buffer-2.svg)

위 다이어그램은 같은 버스트 상황에서 버퍼 유무에 따른 결과 차이를 나란히 보여줍니다

왼쪽은 버퍼가 없는 경우입니다 Collector가 버스트 트래픽을 그대로 Loki·Tempo에 밀어 넣으면, 두 백엔드 모두 메모리가 폭증해 OOMKilled 박스로 이어집니다 Pod가 재시작되는 동안 파이프라인은 단절되고 데이터는 유실됩니다

오른쪽은 Kafka 버퍼가 있는 경우입니다 Collector(Front)는 버스트를 Kafka 토픽에 빠르게 쌓습니다 Kafka는 디스크 기반 버퍼이므로 메모리 한계 없이 수용합니다 Collector(Back)은 Loki·Tempo가 감당할 속도로 토픽을 소비합니다 두 백엔드는 평상시와 동일한 처리량으로 안정적으로 동작합니다

---

## 📐 세부 동작과 옵션

### 메트릭은 왜 Kafka를 쓰지 않는가

메트릭도 버스트가 발생하지만 성격이 다릅니다 메트릭은 각 서비스가 **일정한 scrape 주기(15~60초)**로 수집됩니다 요청량이 폭증해도 scrape 주기가 바뀌지 않아 메트릭 수집량은 비교적 안정적입니다 반면 로그·트레이스는 요청 하나마다 이벤트가 발생하므로 요청량에 정비례해 폭증합니다

또한 메트릭 alerm rule은 30초마다 평가됩니다 Kafka exporter의 `flush_max_messages`·`flush_frequency` 설정에 따라 수십 초의 레이턴시가 추가될 수 있고, 이는 알림 발동을 최대 1~2 주기(30~60초) 지연시킵니다

결론적으로 메트릭은 버퍼 필요성이 낮고 지연 허용도가 낮아 직접 전송이 최적입니다

### Kafka topic 설계 — 시그널별 분리

토픽을 시그널별로 분리하면 두 가지 이점이 생깁니다

첫째, **retention 정책을 별도로 적용**할 수 있습니다 로그 토픽은 24시간 retention으로 유지하고 트레이스 토픽은 12시간으로 짧게 가져가는 식으로 운영합니다

둘째, **consumer를 독립적으로 스케일**할 수 있습니다 트레이스 처리량이 느린 상황에서 로그 consumer는 영향받지 않습니다

```yaml
# Kafka 토픽 예시
- name: otlp_logs
  partitions: 3
  replication_factor: 2
  config:
    retention.ms: "86400000"  # 24시간

- name: otlp_spans
  partitions: 3
  replication_factor: 2
  config:
    retention.ms: "43200000"  # 12시간
```

### Collector에서의 라우팅 설정

OTel Collector는 signal 유형(metrics/logs/traces)별로 파이프라인을 분리하고 exporter를 다르게 붙입니다

```yaml
# otel-collector-config.yaml (일부)
exporters:
  prometheusremotewrite:
    endpoint: "http://mimir-distributor:8080/api/v1/push"
  kafka/logs:
    brokers: ["kafka-bootstrap:9092"]
    topic: otlp_logs
    encoding: otlp_proto
  kafka/traces:
    brokers: ["kafka-bootstrap:9092"]
    topic: otlp_spans
    encoding: otlp_proto

service:
  pipelines:
    metrics:
      receivers: [otlp]
      exporters: [prometheusremotewrite]
    logs:
      receivers: [otlp]
      exporters: [kafka/logs]
    traces:
      receivers: [otlp]
      processors: [tail_sampling]
      exporters: [kafka/traces]
```

`pipelines` 아래에 `metrics`, `logs`, `traces`를 각각 선언합니다 각 파이프라인은 독립적인 exporter를 가지므로 시그널별 라우팅이 명확하게 분리됩니다

### tail sampling과 Kafka 버퍼의 조합

트레이스 파이프라인에서는 Kafka 버퍼에 더해 **tail sampling**을 함께 적용하면 효과가 배가됩니다

tail sampling은 trace가 완료된 이후 에러·슬로우 trace는 100% 보존하고 정상 trace는 N%만 보관합니다 Kafka에 적재되는 데이터량 자체를 줄여 Tempo의 처리 부하를 낮춥니다

```yaml
processors:
  tail_sampling:
    decision_wait: 10s
    policies:
      - name: errors-policy
        type: status_code
        status_code: {status_codes: [ERROR]}
      - name: slow-traces-policy
        type: latency
        latency: {threshold_ms: 500}
      - name: probabilistic-policy
        type: probabilistic
        probabilistic: {sampling_percentage: 10}
```

위 설정은 에러 trace와 500ms 초과 trace는 100% 보존하고, 나머지는 10%만 유지합니다 Kafka 토픽에 쌓이는 span 수가 90% 줄어 Tempo의 메모리 사용량이 안정됩니다

---

## 🧩 go-ti에서는

go-ti는 티켓팅 서비스로, 티켓 오픈 시 5,000 VU 이상의 동시 접속이 발생합니다 초기 설계에서는 Alloy가 로그·트레이스 모두를 Loki·Tempo에 직접 전송했습니다 5,000 VU 부하테스트 실행 중 Tempo가 OOMKilled됐고, 파이프라인이 단절되어 그 구간의 트레이스가 유실됐습니다

Strimzi Kafka가 이미 비즈니스 이벤트용으로 클러스터에 운영 중이었습니다 토픽 두 개(`otlp_logs`, `otlp_spans`)를 추가하는 것만으로 버퍼를 확보할 수 있었습니다 별도 인프라 비용은 없었습니다 Kafka 버퍼 도입 후 tail sampling(에러·슬로우 100% + 정상 10%)을 함께 적용했고, 이후 동일 부하에서 Tempo OOMKilled가 재현되지 않았습니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [Alloy → OTel Collector 전환 — 벤더 중립과 Kafka 버퍼 확장](/essays/goti-adr-alloy-to-otel-collector)에 정리했습니다

---

## 📚 핵심 정리

- 메트릭·로그·트레이스는 지연 허용도가 다릅니다 메트릭은 알림 평가 주기(30초)와 직결돼 버퍼 레이턴시를 허용하지 않고, 로그·트레이스는 수십 초~분 단위 지연이 허용됩니다
- 버퍼 없이 버스트 트래픽이 Loki·Tempo에 직접 유입되면, 백엔드가 처리 속도 이상의 데이터를 메모리에 적재하다 OOMKilled됩니다 재시작 중 데이터는 유실됩니다
- Kafka는 메시지를 디스크에 append하므로, 생산 속도와 소비 속도의 차이를 디스크 용량으로 흡수합니다 Collector(Front)는 빠르게 적재하고, Collector(Back)은 백엔드 처리 속도에 맞게 소비합니다
- 토픽을 시그널별로 분리하면 retention 정책과 consumer 스케일을 독립적으로 관리할 수 있습니다
- tail sampling과 Kafka 버퍼를 조합하면 Kafka에 적재되는 데이터량 자체를 줄여 백엔드 부하를 이중으로 낮출 수 있습니다
