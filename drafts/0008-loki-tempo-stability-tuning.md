# ADR-0008: Loki/Tempo 안정성 튜닝 및 Kafka 연동 개선

- **Status**: Accepted
- **Date**: 2026-03-31
- **Decision Makers**: ress

## Context

트래픽이 증가하면 Loki와 Tempo가 OOM으로 반복 crash. 특히 crash 후 재시작 시 Kafka에 쌓인 backlog가 한꺼번에 유입되어 또 OOM이 발생하는 악순환이 지속됨.

### 환경

- Kind 단일 클러스터 (5노드, 32GB RAM)
- Loki: SingleBinary 모드, Dev 1536Mi / Prod 1Gi memory limit
- Tempo: SingleBinary 모드, Dev 4Gi / Prod 2Gi memory limit
- OTel Collector Back: Kafka consumer → Tempo/Loki 전송

## 문제점 분석

### 1. Kafka Consumer 무제한 fetch (재시작 폭주)

| 항목 | 현재 | 문제 |
|------|------|------|
| Kafka receiver `fetch_max` | 미설정 (무제한) | 재시작 시 backlog 전량 한꺼번에 소비 |
| `max_processing_time` | 100ms (기본) | tail_sampling 처리 시간 부족 |
| Loki exporter retry/queue | 미설정 | Loki 장애 시 데이터 유실, back pressure 없음 |

**악순환 사이클**: Loki/Tempo OOM → crash → 재시작 → Kafka backlog 폭주 유입 → 또 OOM

### 2. Loki 청크 설정 부재 (메모리 과점유)

| 항목 | 현재 (기본값) | 문제 |
|------|-------------|------|
| `chunk_idle_period` | 30m | idle 청크가 30분간 메모리 점유 |
| `max_chunk_age` | 2h | 최대 2시간 메모리 체류 |
| `GOMEMLIMIT` | 미설정 | Go GC가 컨테이너 limit을 모름 → OOM 직전까지 GC 안함 |
| Prod memory limit | 1Gi | SingleBinary(ingestion+compaction+query)에 부족 |
| 쿼리 parallelism | 128 (기본) | 대량 쿼리 시 OOM |

### 3. Tempo Prod ingester 미튜닝 (Dev와 불일치)

| 항목 | Dev | Prod | 문제 |
|------|-----|------|------|
| `max_block_duration` | 5m | 30m (기본) | Prod에서 블록이 6배 오래 메모리 점유 |
| `trace_idle_period` | 10s | 25s (기본) | idle trace 정리 지연 |
| ingestion rate limit | 50MB/s | 무제한 | spike 시 보호 없음 |
| `GOMEMLIMIT` | 미설정 | 미설정 | 양쪽 모두 GC 문제 |

## 검토한 대안

### A. 수평 확장 (Distributed Mode 전환)

- Loki: SimpleScalable 또는 Distributed 모드
- Tempo: Distributed 모드 (ingester/compactor/querier 분리)
- **장점**: 컴포넌트별 독립 스케일링, 장애 격리
- **단점**: Kind 32GB 환경에 과도한 리소스. 최소 Loki 3pod + Tempo 5pod → 모니터링만 8pod 추가
- **판정**: 기각. 현재 환경에 맞지 않음. EKS prod 전환 시 재검토

### B. 현재 아키텍처 유지 + 설정 최적화

- 3가지 축 동시 강화: 백엔드 메모리 최적화 + 유입 제어 + 장애 격리
- **장점**: 코드 변경 없음, values 수정만으로 해결, 즉시 적용 가능
- **단점**: SingleBinary 한계는 존재 (query와 ingestion 경합)
- **판정**: 채택

### C. Kafka retention 단축 (backlog 자체 제거)

- traces: 1h → 15m, logs: 2h → 30m
- **장점**: 재시작 시 backlog 물량 자체가 적어짐
- **단점**: Loki/Tempo가 30분 이상 죽으면 데이터 영구 유실
- **판정**: 부분 채택 가능하나, consumer throttling이 더 근본적 해결

## 결정

**Option B 채택**: 3가지 축 동시 강화

### 1. 유입 제어 — Kafka Consumer Throttling

```yaml
# OTel Collector Back Kafka receiver
kafka/traces:
  consumer:
    fetch_max: 5242880       # 5MB/fetch (무제한 → 제한)
    max_processing_time: 1s  # tail_sampling 처리 여유

kafka/logs:
  consumer:
    fetch_max: 10485760      # 10MB/fetch
    max_processing_time: 1s
```

**선택 근거**: 재시작 시 한 번에 가져오는 데이터를 제한하여 backlog를 점진적으로 소화. Kafka retention(1h/2h) 내에 모두 소화되므로 데이터 유실 없음.

### 2. 장애 격리 — Loki Exporter retry + sending_queue

```yaml
otlphttp/loki:
  retry_on_failure:
    enabled: true
    max_elapsed_time: 300s
  sending_queue:
    enabled: true
    queue_size: 500
```

**선택 근거**: Loki 일시 장애 시 500 batches 버퍼링. queue 가득 차면 Kafka consumer에 자연스러운 back pressure. Tempo exporter에는 이미 retry + queue_size 2000 설정 존재.

### 3. 백엔드 강화 — 청크/GOMEMLIMIT/메모리

**Loki:**

| 설정 | Before | After | 근거 |
|------|--------|-------|------|
| `chunk_idle_period` | 30m (기본) | 5m | idle 청크 빠른 flush |
| `max_chunk_age` | 2h (기본) | 30m | 메모리 체류 시간 4배 단축 |
| `GOMEMLIMIT` | 미설정 | limit의 90% | OOM 전 GC 강제 |
| Prod memory limit | 1Gi | 2Gi | SingleBinary 최소 요구 |
| 쿼리 parallelism | 128 | 8 | 쿼리 시 OOM 방지 |

**Tempo (Prod):**

| 설정 | Before | After | 근거 |
|------|--------|-------|------|
| `max_block_duration` | 30m (기본) | 5m | Dev와 통일, 메모리 6배 절감 |
| `trace_idle_period` | 25s (기본) | 10s | idle trace 빠른 정리 |
| ingestion rate | 무제한 | 15MB/s + 30MB burst | spike 보호 |
| `GOMEMLIMIT` | 미설정 | limit의 90% | OOM 전 GC 강제 |

## 메모리 예상 효과

### Loki (Prod)

```
Before: chunk 2h 체류 x stream 수 + GC 미개입 → ~1Gi 초과 → OOM
After:  chunk 30m 체류 x stream 수 + GOMEMLIMIT GC → ~800Mi 안정 (2Gi limit)
```

### Tempo (Prod)

```
Before: block 30m 체류 + 무제한 ingestion → ~2Gi 초과 → OOM
After:  block 5m 체류 + 15MB/s rate limit + GOMEMLIMIT GC → ~1.2Gi 안정 (2Gi limit)
```

## 후속 작업

- Tempo 2.8 업그레이드 시 compactor 메모리 50% 추가 감소 예상
- EKS prod 전환 시 Distributed Mode 재검토
- persistent queue (file_storage extension) 도입 검토 — Collector 재시작 시 queue 보존

## 변경 파일

| 파일 | 변경 내용 |
|------|----------|
| `values-stacks/dev/otel-collector-back-values.yaml` | Kafka consumer throttling + Loki retry/queue |
| `values-stacks/prod/otel-collector-back-values.yaml` | 동일 |
| `values-stacks/dev/loki-values.yaml` | 청크 튜닝 + GOMEMLIMIT + 쿼리 제한 |
| `values-stacks/prod/loki-values.yaml` | 동일 + 메모리 2Gi 증설 |
| `values-stacks/dev/tempo-values.yaml` | GOMEMLIMIT |
| `values-stacks/prod/tempo-values.yaml` | ingester 튜닝 + ingestion limits + GOMEMLIMIT |
