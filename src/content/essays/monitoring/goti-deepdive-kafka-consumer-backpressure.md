---
title: "Kafka 컨슈머 백프레셔 — fetch.max.bytes가 재시작 OOM을 끊는 원리"
excerpt: "fetch.max.bytes 미설정 상태에서 컨슈머 재시작이 왜 OOM 악순환을 만드는지, 그리고 fetch 단위 제한이 backlog를 점진 소화시켜 백엔드 메모리를 안정화하는 메커니즘을 설명합니다"
category: monitoring
tags:
  - go-ti
  - kafka
  - backpressure
  - kafka-consumer
  - fetch-max-bytes
  - concept
series:
  name: "goti-deepdive-observability"
  order: 8
date: "2026-03-31"
---

## 한 줄 요약

> Kafka 컨슈머가 fetch 크기를 제한하지 않으면 재시작 시 backlog 전량을 한꺼번에 흡입해 백엔드가 OOM으로 다시 죽는 악순환이 생깁니다 — fetch.max.bytes는 이 "흡입 단위"를 제한해 backlog를 retention 내에서 점진적으로 소화하게 만듭니다

---

## 🤔 무엇을 푸는 기술인가

Kafka는 메시지를 **디스크에 append**하는 브로커입니다 Producer가 아무리 빠르게 적재해도 Consumer는 독립적인 offset으로 자신의 속도에 맞춰 읽습니다 이 디커플링 덕분에 버스트가 발생해도 Consumer 쪽 백엔드가 곧바로 압력을 받지 않습니다

그런데 여기에 함정이 있습니다 Consumer가 다운됐다가 재시작하면 **마지막으로 커밋한 offset 이후의 메시지를 모두 읽으려 합니다** retention 내에 수백만 건이 쌓여 있어도, fetch 크기를 제한하지 않으면 첫 번째 fetch 요청에서 가능한 한 많은 바이트를 한꺼번에 가져옵니다 Consumer가 그 데이터를 백엔드로 밀어 넣으면, 백엔드는 순간적으로 대용량 데이터를 처리해야 합니다

**백프레셔(backpressure)**는 이 "밀어 넣는 속도"를 제어하는 메커니즘입니다 Producer가 Consumer보다 빠를 때, 중간 어딘가에서 "너무 빠르게 보내지 말라"는 신호를 보내는 것이 백프레셔입니다 Kafka Consumer에서 이 역할을 하는 핵심 파라미터가 `fetch.max.bytes`입니다

---

## 🔧 동작 원리

### Kafka Consumer fetch 동작 기초

Kafka Consumer는 브로커에 `FetchRequest`를 보내 메시지를 읽습니다 이 요청에는 한 번에 가져올 데이터 크기 상한이 포함됩니다 상한을 지정하지 않으면 브로커는 파티션의 현재 오프셋부터 가능한 만큼 응답합니다

`fetch.max.bytes`는 **하나의 FetchRequest에서 브로커가 반환할 수 있는 최대 바이트 수**입니다 Consumer가 이 값을 지정하지 않으면(기본값 `0` = 무제한), 브로커는 파티션에 쌓인 메시지를 최대한 많이 묶어 반환합니다

Consumer가 메시지를 처리하는 주기는 다음 순서입니다

```text
FetchRequest 전송 → 브로커 응답 수신 → 메시지 역직렬화
→ 처리 로직 실행(백엔드 전송) → 오프셋 커밋
→ 다음 FetchRequest 전송
```

**처리 완료 후 다음 fetch를 요청**하는 구조입니다 즉, 한 번에 가져온 데이터가 클수록 처리에 더 오랜 시간이 걸리고, 그 동안 백엔드는 대량 데이터를 받아 처리해야 합니다

### 무제한 fetch가 재시작 시 OOM을 만드는 메커니즘

정상 운영 중에는 Consumer가 거의 실시간으로 메시지를 소비하므로 한 번의 fetch에서 가져오는 양이 많지 않습니다 문제는 **Consumer 또는 백엔드가 다운됐다가 재시작하는 순간**입니다

Loki나 Tempo가 OOM으로 crash하는 시나리오를 따라가 보겠습니다

먼저 Loki가 메모리 한계를 초과해 OOMKilled됩니다 Loki로 데이터를 전송하는 OTel Collector(Back)의 exporter는 전송 실패를 감지합니다 retry 설정이 없으면 즉시 드롭하고, retry 설정이 있으면 내부 큐에 재전송 대기 상태로 쌓습니다

Loki Pod가 재시작하는 동안 Collector(Back)은 일시 정지하거나 느려집니다 그 사이 Kafka 토픽의 offset lag — **Consumer가 아직 읽지 못한 메시지의 누적량** — 이 빠르게 늘어납니다

Loki가 재시작을 마치면, Collector(Back)은 Kafka에서 다시 fetch를 시작합니다 `fetch.max.bytes`가 무제한이면 브로커는 retention 기간 내 누적된 backlog를 최대한 묶어 반환합니다 Collector는 이 대용량 데이터를 즉시 Loki에 전송하려 합니다 이제 막 재시작한 Loki는 아직 완전히 안정화되지 않은 상태에서 이전보다 훨씬 많은 데이터를 받습니다 메모리 사용량이 다시 한계를 향해 치솟고, 최악의 경우 또 OOM으로 crash합니다

이것이 **OOM → crash → 재시작 → backlog 폭주 유입 → 또 OOM**으로 이어지는 악순환 사이클입니다

![OOM 악순환 사이클 — fetch.max.bytes 미설정|tall](/diagrams/goti-deepdive-kafka-consumer-backpressure-1.svg)

위 다이어그램은 이 악순환이 어떻게 스스로를 강화하는지 보여줍니다

상단 사이클에서 Loki/Tempo가 OOM으로 crash하면 Pod가 재시작됩니다 재시작한 Pod는 Kafka에 재연결해 offset 이후의 메시지를 fetch합니다 `fetch.max.bytes`가 없으면 Kafka는 누적된 backlog를 그대로 한꺼번에 반환하고, Loki/Tempo는 다시 메모리 압박을 받습니다 점선 장미색 화살표가 이 비정상 반복 경로를 나타냅니다

하단 흐름도는 트래픽 버스트 시의 구조를 보여줍니다 OTel Collector(Front)가 빠르게 produce하면 Kafka 토픽의 backlog가 무제한으로 쌓이고, Collector(Back)이 이를 무제한 fetch해 Loki/Tempo에 밀어 넣습니다 백엔드의 메모리가 폭증해 OOM으로 이어집니다

### fetch.max.bytes가 백프레셔를 거는 방식

`fetch.max.bytes`를 설정하면 Consumer의 한 번 fetch 요청에서 가져오는 데이터 양에 상한이 생깁니다 예를 들어 `fetch.max.bytes: 5242880`(5 MB)으로 설정하면, 브로커는 요청당 최대 5 MB만 반환합니다

이 단순한 제한이 backlog 소화 패턴을 근본적으로 바꿉니다

- **fetch #1**: 5 MB를 가져와 Loki/Tempo에 전송 → 처리 완료
- **fetch #2**: 다음 5 MB를 가져와 처리 → 완료
- **fetch #N**: 이를 반복해 backlog 전량 소화

한 번에 처리하는 데이터 양이 5 MB로 제한되므로, 백엔드가 받는 순간 메모리 압박도 5 MB 단위로 제한됩니다 재시작 직후에도 메모리 피크가 발생하지 않고, 안정적인 처리량으로 backlog를 점진적으로 소화합니다

**핵심 보장 조건**은 Kafka retention 내에 전량 소화 가능한지 여부입니다 예를 들어 traces 토픽 retention이 1시간이고 fetch 처리량이 시간당 30 GB라면, backlog 30 GB 미만은 retention 내에 전량 소화됩니다 retention 내에 소화하지 못하면 오래된 메시지가 삭제되어 데이터 유실이 발생하므로, fetch 처리량 추정이 중요합니다

![fetch.max.bytes 적용 후 backlog 점진 소화 흐름|tall](/diagrams/goti-deepdive-kafka-consumer-backpressure-2.svg)

위 다이어그램은 fetch.max.bytes 적용 전후의 차이를 보여줍니다

상단 타임라인에서 t=0 재시작 후 fetch #1, #2, ..., #N으로 backlog를 나눠 소화하는 흐름을 볼 수 있습니다 각 fetch는 5 MB 단위로 제한되며, 처리 완료 후 다음 fetch를 요청합니다 보라색 박스(`fetch.max.bytes` 설정)가 이 단위 제한의 출처입니다

하단 메모리 추이 비교에서 미적용(빨간 선)은 fetch 이후 메모리가 급격히 상승해 OOM limit을 넘기지만, 적용 후(초록 선)는 각 fetch 처리 시 소폭 오르내리면서 limit 아래에서 안정적으로 유지됩니다

---

## 📐 세부 동작과 옵션

### fetch.max.bytes vs 관련 파라미터 비교

`fetch.max.bytes`와 함께 알아야 할 파라미터들을 정리합니다

| 파라미터 | 적용 대상 | 역할 | 기본값 |
|---|---|---|---|
| `fetch.max.bytes` | Consumer 전체 | 한 FetchRequest 응답의 최대 바이트 | 무제한(0) |
| `max.partition.fetch.bytes` | 파티션 단위 | 파티션당 fetch 최대 바이트 | 1 MB |
| `fetch.max.wait.ms` | FetchRequest 대기 | 최소 데이터 미도달 시 대기 시간 | 500 ms |
| `max_processing_time` | OTel Kafka receiver | Consumer 측 처리 타임아웃 | 100 ms |

`max.partition.fetch.bytes`는 파티션 단위 상한이고, `fetch.max.bytes`는 그 합산의 전체 상한입니다 파티션이 3개이고 `max.partition.fetch.bytes: 2 MB`로 설정해도, `fetch.max.bytes: 5 MB`이면 최대 5 MB까지만 가져옵니다

`max_processing_time`은 OTel Collector의 Kafka receiver 파라미터로, Consumer가 메시지를 처리하는 데 허용되는 최대 시간입니다 기본값 100 ms는 tail sampling처럼 복잡한 처리 로직이 있는 파이프라인에서 타임아웃이 발생할 수 있습니다 이 경우 1 s로 늘려야 안정적으로 동작합니다

### backlog 소화 속도 추정

fetch.max.bytes를 너무 작게 설정하면 retention 내에 소화하지 못해 데이터 유실이 생깁니다 너무 크게 설정하면 백프레셔 효과가 줄어듭니다 적정값 추정 방법은 다음과 같습니다

```text
backlog 소화 속도 = fetch.max.bytes × (처리 완료까지 평균 시간의 역수)

예:
  fetch.max.bytes = 5 MB
  평균 처리 시간 = 2초 (전송 + 커밋)
  소화 속도 = 5 MB / 2s = 2.5 MB/s = 150 MB/min = 9 GB/h

retention = 1시간이면 → 최대 9 GB backlog 소화 가능
```

평균 처리 시간은 Collector의 처리량 메트릭(`otelcol_exporter_send_failed_log_records` 등)으로 모니터링할 수 있습니다

### sending_queue와 조합하는 백프레셔 연쇄

`fetch.max.bytes`만으로는 Loki 일시 장애 시 exporter가 메시지를 드롭할 수 있습니다 `sending_queue`를 함께 설정하면 백프레셔가 두 단계로 연쇄됩니다

```yaml
# OTel Collector Back — Loki exporter
exporters:
  otlphttp/loki:
    retry_on_failure:
      enabled: true
      max_elapsed_time: 300s
    sending_queue:
      enabled: true
      queue_size: 500
```

`sending_queue`가 가득 차면 Collector는 Kafka로부터 더 이상 fetch를 진행하지 않습니다 Kafka 토픽의 offset lag가 늘어나지만, 데이터는 retention 내에서 안전하게 대기합니다 Loki가 복구되면 queue가 비워지고 fetch가 재개됩니다 이 구조에서 Kafka는 **최종 버퍼**, sending_queue는 **단기 충격 완충재** 역할을 합니다

---

## 🧩 go-ti에서는

go-ti의 관측성 파이프라인은 OTel Collector(Back)이 Kafka에서 로그·트레이스를 소비해 Loki·Tempo로 전달하는 구조입니다 초기에는 Kafka receiver의 `fetch_max`가 미설정(무제한)이었습니다 Loki와 Tempo가 OOM으로 crash하면 재시작 후 Kafka backlog를 한꺼번에 빨아들여 다시 OOM이 발생하는 악순환이 반복됐습니다

이를 해결하기 위해 traces용 Kafka receiver에 `fetch_max: 5242880`(5 MB), logs용에 `fetch_max: 10485760`(10 MB)을 적용했습니다 함께 `max_processing_time`을 기본값 100 ms에서 1 s로 늘려 tail sampling 처리 여유를 확보했습니다 Loki exporter에는 `sending_queue: 500` + `retry_on_failure`도 추가해 Loki 일시 장애 시 Kafka backlog를 retention 내에서 안전하게 보전하도록 연쇄 백프레셔를 구성했습니다

이 변경 후 Kafka retention(traces 1시간, logs 2시간) 내에 backlog 전량을 소화하는 것이 보장됐고, 재시작 시 OOM 악순환이 재현되지 않았습니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [Loki/Tempo 안정성 튜닝 및 Kafka 연동 개선](/essays/goti-adr-loki-tempo-stability-tuning)에 정리했습니다

---

## 📚 핵심 정리

- Kafka Consumer는 기본적으로 fetch 크기 제한이 없어 재시작 시 backlog 전량을 한 번에 가져오려 합니다 — 이를 백엔드로 밀어 넣으면 OOM 악순환이 시작됩니다
- `fetch.max.bytes`는 FetchRequest 하나에서 브로커가 반환할 수 있는 최대 바이트를 제한해 backlog를 N번의 fetch로 나눠 점진 소화하도록 만듭니다
- backlog 전량을 Kafka retention 내에 소화하려면 `fetch.max.bytes` × 처리 속도 × retention 시간이 최대 예상 backlog보다 커야 합니다
- `sending_queue`를 함께 설정하면 "queue 소진 → fetch 정지"라는 자연스러운 연쇄 백프레셔가 생겨, 백엔드 일시 장애 시에도 Kafka retention 내에서 데이터가 안전하게 보전됩니다
- `max_processing_time`은 Consumer 측 처리 타임아웃으로, tail sampling 같은 복잡한 로직을 포함하면 기본값 100 ms에서 1 s 이상으로 늘려야 안정적으로 동작합니다
