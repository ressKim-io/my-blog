---
date: 2026-03-25
category: troubleshoot
project: Goti-monitoring, Goti-k8s
tags: [tempo, oom, kafka, tail-sampling, alloy, network-policy, kube-state-metrics]
---

# Tempo 반복 OOMKilled → Kafka 트레이스 버퍼 + tail sampling 10%로 해결

## Context

5000 VU 부하테스트 환경. Tempo 단일 인스턴스(monolithic)가 모든 트레이스를 직접 수신.
부하테스트 시 MSA 5서비스 × 5000 VU에서 수만 건의 트레이스가 동시 유입.
Alloy → Tempo 직접 OTLP 전송 구조로 Tempo가 유입 속도를 제어할 수 없음.

- 환경: Kind 5노드, Tempo monolithic (chart v1.x)
- 메모리 limit: 3Gi
- 트레이스 수신: Alloy → OTLP gRPC → Tempo (직접)
- 샘플링: 100% (dev 디버깅 우선 설정)

## Issue

Tempo pod가 CrashLoopBackOff 85회 재시작. 종료 사유: **OOMKilled (Exit Code 137)**.

```
Last State:     Terminated
  Reason:       OOMKilled
  Exit Code:    137
  Restart Count: 85
  Limits:
    memory:  3Gi
```

Grafana에서 Tempo 의존 패널 전부 장애:
- Slow DB Query 목록: `dial tcp tempo-dev:3200: connection refused`
- 트레이스 검색: 불가
- Exemplar 링크: 깨짐

compaction 로그에서 130K objects (95MB) 블록을 처리하다 OOM 발생:
```
compacting block totalObjects=130165 size=95354387 compactionLevel=4
```

## Action

### 가설 1: 메모리 limit 부족 → 단순 증설
- 3Gi → 4Gi로 올리면 일시 해결되지만, 부하테스트 규모 10배 증가 시 재발 확실
- **임시 조치로만 적용**

### 가설 2: Tempo 유입량 자체를 줄여야 함 → tail sampling
- 부하테스트 시 트레이스 대부분 동일 패턴 (정상 예매 플로우)
- 에러/느린 요청만 100% 보존하고 나머지 10%면 디버깅에 충분
- **근본 해결 1: Alloy tail sampling 100% → 에러100%/2초초과100%/나머지10%**

### 가설 3: Tempo가 유입 속도를 제어할 수 없는 구조 문제 → Kafka 버퍼
- Alloy → Tempo 직접 전송은 spike에 취약
- Kafka를 중간에 두면 Tempo가 자기 속도로 소비 가능
- 이미 Strimzi Kafka(goti-kafka)가 운영 중이므로 인프라 추가 비용 없음
- **근본 해결 2: Alloy → Kafka → Alloy(consumer) → Tempo**

### 적용한 수정

**1. Tempo 메모리 (임시)**
- `values-stacks/dev/tempo-values.yaml`: memory limit 3Gi → 4Gi

**2. Alloy tail sampling**
- sampling_percentage: 100% → 10%
- slow-traces threshold: 500ms → 2000ms (SLO 기준)
- num_traces: 5000 → 10000 (동시 트레이스 버퍼 확대)

**3. Kafka 트레이스 버퍼 파이프라인**
- Alloy에 `otelcol.exporter.kafka` 추가 (topic: `observability.traces.v1`)
- Alloy에 `otelcol.receiver.kafka` + `otelcol.processor.batch "kafka_traces"` 추가
- Kafka consumer batch: 10s timeout, 256 batch size (Tempo 부하 제어)
- `otelcol.exporter.otlp "tempo"` 유지 (consumer → Tempo)

**4. Kafka 토픽 생성**
- `observability.traces.v1`: 3 partitions, 3 replicas, retention 1시간

**5. NetworkPolicy**
- Alloy → Kafka 9092(plain) egress 허용 (기존 9404 metrics만 허용)

### 부수 해결: kube-state-metrics + prometheus-operator CrashLoopBackOff

**근본 원인**: `default-deny-all` NetworkPolicy가 monitoring namespace egress 전체 차단 → API server(10.96.0.1:443) 접근 불가

```
Failed to run kube-state-metrics: dial tcp 10.96.0.1:443: i/o timeout
```

**수정**: `allow-kps-apiserver-egress` NetworkPolicy 추가 (443/6443 + DNS + monitoring 내부)

### 부수 해결: 대시보드 패널 미표시

**원인 1**: `$service_name` 변수가 `up` 메트릭에서 값 조회 → envoy-sidecar-metrics만 반환
→ `http_server_request_duration_seconds_count` 기준으로 변경

**원인 2**: `$interval=30s`가 scrape interval과 충돌 → rate 범위 부족
→ `$__rate_interval` (Grafana 자동 계산)으로 일괄 교체

## Result

### 변경 전후 파이프라인

```
[Before]
goti pods → Alloy(100% 통과) → OTLP → Tempo(3Gi) → OOMKilled (85회)

[After]
goti pods → Alloy(에러100%/2s초과100%/나머지10%)
              → Kafka(observability.traces.v1, 1시간 보존)
                → Alloy consumer(10s batch, 256건)
                  → OTLP → Tempo(4Gi)
```

### 예상 효과
- Tempo 유입량: 현재 대비 **~90% 감소** (10% 샘플링)
- 부하테스트 10배 증가해도 Kafka가 spike 흡수 + 10% 샘플링 → Tempo 유입 안정
- 에러/느린 트레이스는 100% 보존 → 디버깅 능력 유지
- kube-state-metrics 복구 → Pod 재시작 모니터링 정상화

### 재발 방지
- Kafka 버퍼로 Tempo 직접 유입 차단 → spike 내성 확보
- tail sampling으로 불필요 트레이스 필터링 → 메모리 사용량 근본 감소
- prod 전환 시 Tempo distributed mode + sampling 비율 추가 조정 예정

## Related Files

### Goti-monitoring
- `values-stacks/dev/alloy-values.yaml` — tail sampling 10% + Kafka exporter/consumer
- `values-stacks/dev/tempo-values.yaml` — memory 3Gi → 4Gi
- `grafana/dashboards/devops/load-test-command-center.json` — $__rate_interval + service_name 수정

### Goti-k8s
- `infrastructure/dev/strimzi-operator/config/topics.yaml` — observability.traces.v1 토픽
- `infrastructure/dev/network-policies/monitoring-netpol.yaml` — Alloy→Kafka 9092 + kps API server egress
- `scripts/validate/extract-queries.sh` — K6 + $__rate_interval 변수 치환
