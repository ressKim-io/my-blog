---
title: "OOM은 메모리 부족이 아니라 유입 제어 부재였다 — 재시작 악순환 끊기"
excerpt: "죽으면 재시작되고, 재시작하면 그동안 쌓인 backlog가 한꺼번에 밀려들어 또 죽었습니다. 메모리를 올려도 반복되던 이 고리를 consumer throttling과 sending_queue, GOMEMLIMIT 세 축으로 동시에 끊은 기록입니다"
category: monitoring
tags:
  - go-ti
  - Loki
  - Tempo
  - OOM
  - Kafka
  - GOMEMLIMIT
  - Observability
  - Performance-Tuning
  - adr
date: "2026-03-31"
---

## 🎯 한 줄 요약

> Loki와 Tempo가 OOM으로 죽고, 재시작하면 그동안 Kafka에 쌓인 데이터가 한꺼번에 밀려들어 또 죽었습니다. 이 고리를 consumer throttling과 청크·블록 튜닝, GOMEMLIMIT 세 축으로 동시에 끊었습니다

---

## 🤔 문제 분석

### 악순환 사이클

모니터링 백엔드가 계속 죽었습니다. 한 번 OOM으로 죽고 끝나는 게 아니었습니다

![Loki/Tempo OOM 악순환 사이클](/diagrams/goti-adr-loki-tempo-stability-tuning-1.svg)

Loki든 Tempo든 OOM으로 죽으면 곧 재시작됩니다. 그런데 죽어 있는 동안에도 Kafka에는 데이터가 계속 쌓입니다

재시작하자마자 그 밀린 데이터를 한꺼번에 소비하면서 메모리가 다시 치솟고, 또 죽습니다

메모리를 올려 봐도 같은 패턴이 반복됐습니다. 그래서 왜 이 고리가 끊기지 않는지부터 봤고, 세 곳에서 동시에 문제가 있었습니다

### 환경

- Kind 단일 클러스터 (5노드, 32GB RAM)
- Loki: SingleBinary 모드, Dev 1536Mi / Prod 1Gi memory limit
- Tempo: SingleBinary 모드, Dev 4Gi / Prod 2Gi memory limit
- OTel Collector Back: Kafka consumer → Tempo/Loki 전송

SingleBinary 모드라 ingestion과 compaction, query가 한 Pod 안에서 돕니다. 리소스 경합이 심할 수밖에 없는 구조입니다

### 문제 축 1: Kafka Consumer — 재시작 폭주

OTel Collector Back의 Kafka receiver 설정을 봤습니다

| 항목 | 현재 값 | 문제 |
|------|---------|------|
| `fetch_max` | 1MB (기본) | 재시작 시 밀린 데이터를 빠르게 소비하며 메모리 급증 |
| `max_processing_time` | 100ms (기본) | tail_sampling 처리 시간 부족 |
| Loki exporter retry/queue | 미설정 | Loki 장애 시 데이터 유실, back pressure 없음 |

핵심은 `fetch_max`가 아니라 `max_processing_time`이었습니다

재시작 직후 consumer가 데이터를 꺼내는 속도가 tail_sampling이 처리하는 속도를 앞지르면, 처리를 기다리는 데이터가 메모리에 그대로 쌓입니다. `fetch_max`를 5~10MB로 명시하는 것은 한 번에 가져오는 양을 예측 가능하게 만드는 보조 조치일 뿐입니다

소비 속도와 처리 속도를 맞추는 실제 손잡이는 `max_processing_time` 쪽입니다

### 문제 축 2: Loki 청크 — 메모리 과점유

| 항목 | 현재 (기본값) | 문제 |
|------|-------------|------|
| `chunk_idle_period` | 30m | idle 청크가 30분간 메모리 점유 |
| `max_chunk_age` | 2h | 최대 2시간 메모리 체류 |
| `GOMEMLIMIT` | 미설정 | Go GC가 컨테이너 limit을 모름 |
| Prod memory limit | 1Gi | SingleBinary에 부족 |
| 쿼리 parallelism | TSDB 기준 128 | 대량 쿼리 시 OOM |

`chunk_idle_period`가 30분이면 데이터가 더 안 들어오는 스트림의 청크도 30분을 메모리에 머뭅니다. `max_chunk_age` 2시간은 활동 중인 스트림의 청크가 최대 두 시간을 버틴다는 뜻입니다

쿼리 병렬도도 문제였습니다. TSDB 스키마에서는 `tsdb_max_query_parallelism`이 128이 기본이고, 일반 `max_query_parallelism`은 32입니다

Grafana에서 대시보드를 하나만 열어도 쿼리가 한꺼번에 쏟아지는데, SingleBinary 모드에서 128개를 동시에 처리하는 것은 무리입니다

### 문제 축 3: Tempo Prod — Dev와 설정 불일치

| 항목 | Dev | Prod | 문제 |
|------|-----|------|------|
| `max_block_duration` | 5m | 30m (기본) | Prod에서 블록이 6배 오래 메모리 점유 |
| `trace_idle_period` | 10s | 25s (기본) | idle trace 정리 지연 |
| ingestion rate | 50MB/s | 무제한 | spike 시 보호 없음 |
| `GOMEMLIMIT` | 미설정 | 미설정 | 양쪽 모두 GC 문제 |

Dev에서는 `max_block_duration`을 5분으로 낮춰 뒀는데 Prod는 기본값 30분 그대로였습니다

같은 SingleBinary 모드인데 Prod 쪽이 블록을 6배 오래 들고 있었습니다. 정작 더 위험한 환경에 튜닝이 빠져 있던 셈입니다

---

## 🔍 검토한 대안

### A. Distributed Mode 전환 — 기각

Loki를 SimpleScalable이나 Distributed 모드로 바꾸고, Tempo도 ingester·compactor·querier를 나누는 방향입니다

- **장점**: 컴포넌트별로 따로 늘릴 수 있고 장애가 격리됩니다
- **단점**: Kind 32GB 환경에는 과합니다. 최소 Loki 3pod에 Tempo 5pod가 필요합니다
- **판정**: **기각**. 모니터링만으로 8개 pod를 더 띄우는 것은 지금 환경에 맞지 않습니다. EKS prod로 넘어갈 때 다시 봅니다

### B. 현재 아키텍처 유지 + 설정 최적화 — 채택

세 축을 동시에 조이는 방향입니다

- **장점**: 코드를 건드리지 않고 values 수정만으로 끝납니다. 바로 적용할 수 있습니다
- **단점**: SingleBinary의 한계는 그대로 남습니다. query와 ingestion이 계속 경합합니다
- **판정**: **채택**

### C. Kafka retention 단축 — 부분 채택

traces retention을 1시간에서 15분으로, logs를 2시간에서 30분으로 줄이는 방향입니다

- **장점**: 재시작 때 밀려 있는 물량 자체가 줄어듭니다
- **단점**: Loki나 Tempo가 30분 넘게 죽어 있으면 그 사이 데이터는 영영 사라집니다
- **판정**: consumer throttling이 더 근본적입니다. 보조로만 병행합니다

---

## ✅ 3가지 축 동시 강화

한 축만 고쳐서는 고리가 끊어지지 않습니다. 앞선 시도가 전부 그렇게 실패했습니다

### 축 1: Kafka Consumer Throttling

재시작 직후 한 번에 가져오는 양을 제한합니다. Kafka retention 1~2시간 안에 다 소화되므로 데이터가 사라지지는 않습니다

```yaml
# OTel Collector Back — Kafka receiver 설정
kafka/traces:
  consumer:
    fetch_max: 5242880       # 5MB/fetch (명시적 제한)
    max_processing_time: 1s  # tail_sampling 처리 여유 확보

kafka/logs:
  consumer:
    fetch_max: 10485760      # 10MB/fetch
    max_processing_time: 1s
```

`max_processing_time`을 100ms에서 1초로 늘린 것이 결정적이었습니다

tail_sampling processor는 trace를 모아 두고 판단하는데, 100ms로는 처리가 계속 밀리면서 메모리에 쌓였습니다. 1초를 주면 꺼내는 속도와 처리하는 속도가 맞물립니다

### 축 2: Loki Exporter retry + sending_queue

Loki가 잠깐 죽어 있을 때 OTel Collector가 데이터를 버리지 않도록 버퍼를 둡니다

```yaml
# OTel Collector Back — Loki exporter 설정
otlphttp/loki:
  retry_on_failure:
    enabled: true
    max_elapsed_time: 300s   # 5분간 재시도
  sending_queue:
    enabled: true
    queue_size: 500          # 500 batches 버퍼링
```

queue가 차면 Kafka consumer 쪽에 자연스럽게 back pressure가 걸립니다. Tempo exporter에는 이미 retry와 `queue_size: 2000`이 들어가 있어 Loki 쪽만 채우면 됐습니다

이 설정이 끊는 고리는 이렇습니다. Loki가 OOM으로 죽으면 Collector가 데이터를 버리고, 재시작 후 다시 보내려고 Kafka를 처음부터 읽고, 그러다 또 죽습니다

`sending_queue`가 있으면 애초에 버리지 않으니 다시 읽을 일도 없습니다

### 축 3: Loki 청크/GOMEMLIMIT + Tempo ingester 튜닝

**Loki Before/After:**

| 설정 | Before | After | 근거 |
|------|--------|-------|------|
| `chunk_idle_period` | 30m (기본) | 5m | idle 청크 빠른 flush |
| `max_chunk_age` | 2h (기본) | 30m | 메모리 체류 시간 4배 단축 |
| `GOMEMLIMIT` | 미설정 | limit의 90% | OOM 전 GC 적극 개입 |
| Prod memory limit | 1Gi | 2Gi | SingleBinary 최소 요구 |
| 쿼리 parallelism | 128 (TSDB 기본) | 8 | 쿼리 시 OOM 방지 |

**Tempo Before/After (Prod):**

| 설정 | Before | After | 근거 |
|------|--------|-------|------|
| `max_block_duration` | 30m (기본) | 5m | Dev와 통일, 메모리 6배 절감 |
| `trace_idle_period` | 25s (기본) | 10s | idle trace 빠른 정리 |
| ingestion rate | 무제한 | 15MB/s + 30MB burst | spike 보호 |
| `GOMEMLIMIT` | 미설정 | limit의 90% | OOM 전 GC 적극 개입 |

GOMEMLIMIT은 짚고 넘어갈 부분이 있습니다

이 값은 **soft limit**입니다. Go 런타임이 한도에 가까워지면 GC를 더 자주 돌리지만, 절대 넘지 않는다고 보장하지는 않습니다. 그래도 아무것도 설정하지 않아 Go GC가 컨테이너 한도를 모른 채 도는 것보다는 훨씬 낫습니다

컨테이너 memory limit이 2Gi면 GOMEMLIMIT은 90%인 1.8Gi 정도로 잡습니다. 런타임이 1.8Gi 근처에서 미리 GC를 돌리기 때문에 2Gi에 닿아 OOM Kill을 당하는 상황을 피할 수 있습니다

쿼리 병렬도를 128에서 8로 줄인 것도 효과가 컸습니다. SingleBinary에서 128개 병렬 쿼리는 ingestion과 자원을 심하게 다툽니다

8로 낮추면 쿼리는 느려지지만 OOM 위험이 크게 줄어듭니다. dev 환경에서는 이 교환이 남는 장사였습니다

---

## 📊 메모리 예상 효과

### Loki (Prod)

- **Before**: chunk 2h 체류 × stream 수 + GC 미개입 → 1Gi 초과 → OOM (limit 1Gi)
- **After**: chunk 30m 체류 × stream 수 + GOMEMLIMIT GC → 약 800Mi 안정 (limit 2Gi)

limit을 2Gi로 올리면서 실제 사용량은 800Mi 수준으로 낮추는 것이 의도였습니다. 여유가 있어야 갑자기 몰리는 트래픽도 넘길 수 있습니다

### Tempo (Prod)

- **Before**: block 30m 체류 + 무제한 ingestion → 2Gi 초과 → OOM (limit 2Gi)
- **After**: block 5m 체류 + 15MB/s rate limit + GOMEMLIMIT GC → 약 1.2Gi 안정 (limit 2Gi)

### 악순환 차단 후

![3가지 축 적용 후 악순환 차단](/diagrams/goti-adr-loki-tempo-stability-tuning-2.svg)

세 축이 동시에 걸리면서 고리가 끊어졌습니다

재시작할 때 밀린 데이터가 있어도 throttling이 조금씩 흘려보냅니다. 백엔드가 잠깐 죽어도 sending_queue가 받아 둡니다. 백엔드 자체도 청크와 블록을 빨리 비우고 GOMEMLIMIT이 GC를 앞당기니 한도까지 가지 않습니다

---

## 📚 핵심 포인트

**OOM은 메모리가 부족해서 나는 게 아니라 유입을 제어하지 않아서 납니다**

메모리를 아무리 늘려도 들어오는 속도를 잡지 않으면 결국 같은 자리에 옵니다. 특히 Kafka처럼 버퍼가 앞에 있는 구조에서는 재시작 직후 밀린 데이터가 치명적입니다

정리하면 순서가 있습니다

1. **유입 제어가 먼저입니다**: consumer throttling으로 밀린 데이터를 조금씩 소화합니다
2. **다음이 장애 격리입니다**: sending_queue로 백엔드 한 곳의 장애가 파이프라인 전체로 번지지 않게 막습니다
3. **마지막이 백엔드 최적화입니다**: 청크·블록 체류 시간을 줄이고 GOMEMLIMIT으로 GC를 앞당깁니다

세 축이 함께 걸려야 고리가 끊어집니다. 하나만 고치면 문제가 다른 경로로 옮겨가 그대로 재발합니다

---

## 🔗 관련 기술 해설

여기서 고른 기술이 실제로 어떻게 동작하는지는 아래 해설에서 따로 다룹니다

- [Kafka 컨슈머 백프레셔 — fetch.max.bytes가 재시작 OOM을 끊는 원리](/essays/goti-deepdive-kafka-consumer-backpressure/)
- [GOMEMLIMIT — Go 서비스가 컨테이너 메모리 한계를 인지하는 방법](/essays/goti-deepdive-gomemlimit/)
