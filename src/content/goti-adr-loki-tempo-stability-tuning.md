---
title: "Loki/Tempo OOM과의 전쟁: Kafka Consumer Throttling과 GOMEMLIMIT"
excerpt: "재시작 시 Kafka backlog 폭주로 반복 OOM이 발생하는 악순환을 3가지 축으로 끊은 기록"
category: monitoring
tags:
  - Loki
  - Tempo
  - OOM
  - Kafka
  - GOMEMLIMIT
  - Observability
  - Performance-Tuning
date: '2026-03-31'
---

## 🎯 한 줄 요약

> Loki/Tempo OOM → crash → 재시작 → Kafka backlog 폭주 → 또 OOM. 이 악순환을 Kafka Consumer Throttling + 청크/블록 튜닝 + GOMEMLIMIT 3가지 축으로 끊었다.

---

## 🤔 문제 분석

### 악순환 사이클

모니터링 백엔드가 계속 죽었어요. 한 번 OOM으로 죽으면 끝이 아니었습니다.

{/* TODO: Draw.io로 교체 */}
```
┌─────────────────────────────────────────────────────────────┐
│                    OOM 악순환 사이클                          │
│                                                             │
│         ┌──────────────┐                                    │
│         │ Loki / Tempo │                                    │
│         │   OOM 발생   │                                    │
│         └──────┬───────┘                                    │
│                │                                            │
│                ▼                                            │
│         ┌──────────────┐       ┌──────────────────┐         │
│         │   Pod Crash  │──────▶│  재시작 (restart) │         │
│         │   & Restart  │       └────────┬─────────┘         │
│         └──────────────┘                │                   │
│                ▲                        ▼                   │
│                │               ┌────────────────┐           │
│                │               │  Kafka backlog  │           │
│                │               │  한꺼번에 유입   │           │
│                │               └────────┬───────┘           │
│                │                        │                   │
│                │                        ▼                   │
│                │               ┌────────────────┐           │
│                │               │  메모리 급증     │           │
│                └───────────────│  → 또 OOM!      │           │
│                                └────────────────┘           │
│                                                             │
│   ※ 이 사이클이 무한 반복. 수동 개입 없이는 복구 불가        │
└─────────────────────────────────────────────────────────────┘
```

Loki든 Tempo든, OOM으로 죽으면 재시작됩니다. 그런데 죽어 있던 동안 Kafka에 데이터가 쌓여요. 재시작하자마자 이 backlog를 한꺼번에 소비하면서 메모리가 폭증합니다. 그리고 또 OOM.

**뭐지? 왜 매번 같은 패턴으로 죽는 거야?**

원인을 파고들어 보니 3가지 축에서 동시에 문제가 있었습니다.

### 환경

- Kind 단일 클러스터 (5노드, 32GB RAM)
- Loki: SingleBinary 모드, Dev 1536Mi / Prod 1Gi memory limit
- Tempo: SingleBinary 모드, Dev 4Gi / Prod 2Gi memory limit
- OTel Collector Back: Kafka consumer → Tempo/Loki 전송

SingleBinary 모드라서 ingestion, compaction, query가 한 Pod에서 돌아요. 리소스 경합이 심할 수밖에 없는 구조입니다.

### 문제 축 1: Kafka Consumer — 재시작 폭주

OTel Collector Back의 Kafka receiver 설정을 살펴봤어요.

| 항목 | 현재 값 | 문제 |
|------|---------|------|
| `fetch_max` | 1MB (기본) | 재시작 시 backlog를 빠르게 소비하며 메모리 급증 |
| `max_processing_time` | 100ms (기본) | tail_sampling 처리 시간 부족 |
| Loki exporter retry/queue | 미설정 | Loki 장애 시 데이터 유실, back pressure 없음 |

기본 `max_fetch_size`는 1MB지만, Kafka에 backlog가 쌓인 상태에서 consumer가 빠르게 소비하면서 메모리가 급증하는 문제는 여전히 발생해요. 명시적으로 더 큰 값(5-10MB)을 설정하고 `max_processing_time`을 늘려 처리 여유를 주는 것이 핵심이에요.

**아!** fetch 크기 자체보다, 처리 속도 조절이 관건이었다.

### 문제 축 2: Loki 청크 — 메모리 과점유

| 항목 | 현재 (기본값) | 문제 |
|------|-------------|------|
| `chunk_idle_period` | 30m | idle 청크가 30분간 메모리 점유 |
| `max_chunk_age` | 2h | 최대 2시간 메모리 체류 |
| `GOMEMLIMIT` | 미설정 | Go GC가 컨테이너 limit을 모름 |
| Prod memory limit | 1Gi | SingleBinary에 부족 |
| 쿼리 parallelism | TSDB 기준 128 | 대량 쿼리 시 OOM |

`chunk_idle_period` 30분이면, 데이터가 안 들어오는 스트림의 청크도 30분간 메모리에 남아요. `max_chunk_age` 2시간은 활성 스트림의 청크가 최대 2시간 동안 메모리를 점유한다는 뜻입니다.

쿼리 parallelism도 문제였어요. TSDB 스키마 기준 `tsdb_max_query_parallelism`이 128이에요 (일반 `max_query_parallelism`은 32). Grafana에서 대시보드 하나 열면 쿼리가 동시에 쏟아지는데, 128개 병렬 처리는 SingleBinary 모드에서 감당이 안 됩니다.

### 문제 축 3: Tempo Prod — Dev와 설정 불일치

| 항목 | Dev | Prod | 문제 |
|------|-----|------|------|
| `max_block_duration` | 5m | 30m (기본) | Prod에서 블록이 6배 오래 메모리 점유 |
| `trace_idle_period` | 10s | 25s (기본) | idle trace 정리 지연 |
| ingestion rate | 50MB/s | 무제한 | spike 시 보호 없음 |
| `GOMEMLIMIT` | 미설정 | 미설정 | 양쪽 모두 GC 문제 |

Dev에서는 `max_block_duration` 5분으로 튜닝해놓고, Prod는 기본값 30분 그대로였어요. 같은 SingleBinary 모드인데 Prod가 6배 더 오래 메모리를 점유한다.

---

## 🔍 검토한 대안

### A. Distributed Mode 전환 — 기각

Loki를 SimpleScalable/Distributed 모드로, Tempo도 ingester/compactor/querier를 분리하는 방안이에요.

- **장점**: 컴포넌트별 독립 스케일링, 장애 격리
- **단점**: Kind 32GB 환경에 과도한 리소스. 최소 Loki 3pod + Tempo 5pod 필요
- **판정**: **기각**. 모니터링만으로 8pod 추가는 현재 환경에 맞지 않음. EKS prod 전환 시 재검토

### B. 현재 아키텍처 유지 + 설정 최적화 — 채택

3가지 축을 동시에 강화하는 방안이에요.

- **장점**: 코드 변경 없음, values 수정만으로 해결, 즉시 적용 가능
- **단점**: SingleBinary 한계는 존재 (query와 ingestion 경합)
- **판정**: **채택**

### C. Kafka retention 단축 — 부분 채택 가능

traces retention을 1h에서 15m으로, logs를 2h에서 30m으로 줄이는 방안이에요.

- **장점**: 재시작 시 backlog 물량 자체가 적어짐
- **단점**: Loki/Tempo가 30분 이상 죽으면 데이터 영구 유실
- **판정**: consumer throttling이 더 근본적 해결. 보조적으로 병행 가능

---

## ✅ 3가지 축 동시 강화

이것이 핵심이다. 한 축만 고쳐서는 악순환이 끊어지지 않아요.

### 축 1: Kafka Consumer Throttling

재시작 시 한 번에 가져오는 데이터를 제한합니다. Kafka retention(1h/2h) 내에 모두 소화되므로 데이터 유실은 없어요.

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

`max_processing_time`을 100ms에서 1s로 늘린 것이 중요해요. tail_sampling processor가 trace를 모아서 판단하는데, 100ms로는 처리가 밀리면서 메모리가 쌓였습니다. 1초의 여유를 주면 처리와 소비가 균형을 이뤄요.

### 축 2: Loki Exporter retry + sending_queue

Loki가 일시적으로 장애 상태일 때, OTel Collector가 데이터를 버리지 않도록 버퍼를 둡니다.

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

queue가 가득 차면 Kafka consumer에 자연스러운 back pressure가 걸려요. Tempo exporter에는 이미 retry + queue_size 2000이 설정되어 있었기 때문에 Loki 쪽만 추가하면 됩니다.

**이게 핵심 포인트다.** Loki OOM → Collector가 데이터 유실 → 재시작 후 다시 보내려고 Kafka 재소비 → 또 OOM. 이 고리를 sending_queue가 끊어줍니다.

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

GOMEMLIMIT에 대해 짚고 넘어갈 부분이 있어요.

GOMEMLIMIT은 **soft limit**이에요. Go 런타임이 이 한도에 가까워지면 GC를 더 적극적으로 수행하지만, 절대적 보장은 아닙니다. 그래도 미설정 시 Go GC가 컨테이너 메모리 limit을 모르고 동작하는 것보다 훨씬 효과적이에요.

컨테이너 memory limit이 2Gi면, GOMEMLIMIT을 90%인 ~1.8Gi로 설정합니다. Go 런타임이 1.8Gi 근처에서 GC를 적극적으로 수행하기 때문에, limit 2Gi에 도달해서 OOM Kill되는 것을 방지할 수 있어요.

쿼리 parallelism 128 → 8 변경도 큰 효과가 있어요. TSDB 스키마 기준 `tsdb_max_query_parallelism`이 기본 128인데 (일반 `max_query_parallelism`은 32), SingleBinary에서 128개 병렬 쿼리는 ingestion과 리소스를 심하게 경합합니다. 8로 줄이면 쿼리 속도는 느려지지만, OOM 위험이 크게 줄어요.

---

## 📊 메모리 예상 효과

### Loki (Prod)

```
Before: chunk 2h 체류 x stream 수 + GC 미개입 → ~1Gi 초과 → OOM (limit: 1Gi)
After:  chunk 30m 체류 x stream 수 + GOMEMLIMIT GC → ~800Mi 안정 (limit: 2Gi)
```

메모리 limit을 2Gi로 올리면서 동시에 실제 사용량을 800Mi 수준으로 낮추는 것이 포인트에요. 여유분이 충분해야 burst 트래픽도 버틸 수 있습니다.

### Tempo (Prod)

```
Before: block 30m 체류 + 무제한 ingestion → ~2Gi 초과 → OOM (limit: 2Gi)
After:  block 5m 체류 + 15MB/s rate limit + GOMEMLIMIT GC → ~1.2Gi 안정 (limit: 2Gi)
```

### 악순환 차단 후

{/* TODO: Draw.io로 교체 */}
```
┌─────────────────────────────────────────────────────────────┐
│               악순환 차단 — 3가지 축 적용 후                  │
│                                                             │
│                  ┌──────────────────┐                        │
│                  │  Kafka backlog   │                        │
│                  │  (재시작 후 존재) │                        │
│                  └────────┬─────────┘                        │
│                           │                                 │
│                           ▼                                 │
│              ┌────────────────────────┐                      │
│              │  축1: Consumer Throttle │                      │
│              │  fetch_max 5-10MB      │                      │
│              │  processing_time 1s    │                      │
│              └────────────┬───────────┘                      │
│                           │ 점진적 소비                      │
│                           ▼                                 │
│              ┌────────────────────────┐                      │
│              │  축2: sending_queue    │                      │
│              │  500 batch 버퍼        │                      │
│              │  back pressure 전달    │                      │
│              └────────────┬───────────┘                      │
│                           │ 안정적 전송                      │
│                           ▼                                 │
│              ┌────────────────────────┐                      │
│              │  축3: 백엔드 튜닝      │                      │
│              │  청크/블록 빠른 flush   │                      │
│              │  GOMEMLIMIT GC 개입    │                      │
│              └────────────┬───────────┘                      │
│                           │                                 │
│                           ▼                                 │
│              ┌────────────────────────┐                      │
│              │  ✅ 메모리 안정 유지    │                      │
│              │  Loki ~800Mi / 2Gi     │                      │
│              │  Tempo ~1.2Gi / 2Gi    │                      │
│              │                        │                      │
│              │  ❌ OOM 사이클 차단!    │                      │
│              └────────────────────────┘                      │
│                                                             │
│   ※ backlog가 있어도 점진적으로 소화 → OOM 없이 복구          │
└─────────────────────────────────────────────────────────────┘
```

3가지 축이 동시에 작동하면서 악순환 고리가 끊어졌어요.

재시작 시 Kafka backlog가 있어도 throttling으로 점진적으로 소비합니다. 백엔드가 일시 장애여도 sending_queue가 버퍼링해요. 그리고 백엔드 자체도 청크/블록을 빠르게 flush하고 GOMEMLIMIT으로 GC가 적극 개입하기 때문에, 메모리가 limit에 도달하지 않습니다.

---

## 📚 핵심 포인트

**OOM은 메모리 부족이 아니라 유입 제어 부재가 원인이다.**

메모리를 아무리 늘려도, 유입 속도를 제어하지 않으면 결국 OOM이 발생해요. 특히 Kafka와 같은 버퍼가 있는 파이프라인에서는 재시작 후 backlog 폭주가 치명적입니다.

3가지를 기억합시다:

1. **유입 제어가 첫 번째**: Consumer throttling으로 backlog를 점진적으로 소화
2. **장애 격리가 두 번째**: sending_queue로 백엔드 장애가 전체 파이프라인을 무너뜨리지 않도록 차단
3. **백엔드 최적화가 세 번째**: 청크/블록 체류 시간 단축 + GOMEMLIMIT으로 메모리 효율화

이 세 축이 동시에 작동해야 악순환이 끊어진다. 하나만 고치면 다른 경로로 같은 문제가 반복됩니다.
