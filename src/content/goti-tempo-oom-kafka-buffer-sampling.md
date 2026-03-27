---
title: "Tempo OOM 85회 — Kafka 버퍼와 tail sampling으로 해결하기"
excerpt: "5,000 VU 부하테스트에서 Tempo가 OOMKilled로 85회 재시작됐다. 100% 샘플링을 10%로 줄이고, Kafka 버퍼를 도입해서 트레이스 파이프라인을 안정화한 과정"
category: monitoring
tags:
  - go-ti
  - Tempo
  - Kafka
  - Alloy
  - OOM
  - Tail Sampling
  - OpenTelemetry
  - Troubleshooting
series:
  name: "goti-observability-stack"
  order: 3
date: "2026-03-25"
---

## 한 줄 요약

> Alloy → Tempo 직접 전송 + 100% 샘플링 구조에서 5,000 VU 부하테스트를 돌리니 Tempo가 OOMKilled됐다. Kafka 버퍼 + tail sampling 10% + 에러/느린 요청 100% 보존으로 해결했다.

## Impact

- **영향 범위**: 트레이스 검색, Exemplar 링크, Slow DB Query 대시보드 전체
- **증상**: Tempo CrashLoopBackOff 85회, Grafana에서 트레이스 관련 기능 전부 장애
- **소요 시간**: 약 5시간
- **발생일**: 2026-03-25

---

## 🔥 증상: Tempo가 85번 죽었다

5,000 VU 부하테스트를 실행한 뒤 Grafana를 열었더니 트레이스 관련 패널이 전부 장애였어요.

```
Slow DB Query 목록: dial tcp tempo-dev:3200: connection refused
트레이스 검색: 불가
Exemplar 링크: 깨짐
```

Tempo Pod 상태를 확인했습니다.

```
Last State:     Terminated
  Reason:       OOMKilled
  Exit Code:    137
  Restart Count: 85
  Limits:
    memory:  3Gi
```

**85회 재시작**. CrashLoopBackOff 상태에서 exponential backoff 때문에 복구까지 수십 분이 걸렸어요.

Tempo 로그를 보니 compaction 중 OOM이 발생했습니다:

```
compacting block totalObjects=130165 size=95354387 compactionLevel=4
```

130K objects, 95MB 블록을 처리하다 메모리가 터진 거예요.

---

## 🤔 원인 분석

구조적 문제가 세 가지 겹쳐 있었어요.

### 1. 100% 샘플링

dev 환경이라 디버깅 편의를 위해 모든 트레이스를 저장하고 있었어요.
5,000 VU에서 MSA 5서비스가 각각 span을 생성하면 초당 수만 건의 트레이스가 유입됩니다.
Tempo 3Gi 메모리로는 감당이 안 됐어요.

### 2. 유입 속도 제어 불가

```
goti pods → Alloy → OTLP gRPC → Tempo (직접)
```

Alloy에서 Tempo로 직접 전송하는 구조라서, 부하가 급증해도 Tempo가 "잠깐 멈춰"라고 할 수 없었어요.
gRPC는 backpressure가 있지만, 이미 Alloy 쪽에 데이터가 쌓이면 Alloy도 메모리 부담이 커집니다.

### 3. Compaction + Ingestion 동시 메모리 경쟁

Tempo monolithic 모드에서는 ingestion과 compaction이 같은 Pod에서 실행돼요.
유입이 계속되는 와중에 compaction이 대량 블록을 처리하면 메모리가 순간적으로 폭증합니다.

---

## ✅ 해결: 세 가지 조치

### 조치 1: 메모리 증설 (임시)

```yaml
# tempo-values.yaml
resources:
  limits:
    memory: 4Gi  # 3Gi → 4Gi
```

이건 임시 조치예요.
부하테스트 규모가 10배 늘어나면 다시 터집니다.
근본 해결이 필요해요.

### 조치 2: Tail Sampling — 10%로 줄이되, 중요한 건 100%

Alloy의 tail sampling 정책을 재설계했어요.

```
에러 트레이스:           100% 보존
2초 이상 느린 트레이스:   100% 보존
나머지 정상 트레이스:     10% 샘플링
```

부하테스트 시 트레이스 대부분은 동일한 정상 패턴이에요.
에러나 느린 요청만 전수 보존하고, 나머지는 10%만 저장해도 디버깅에 충분합니다.

tail sampling 설정의 핵심 파라미터:

- `sampling_percentage`: 100% → 10%
- `slow-traces threshold`: 500ms → 2000ms (SLO 기준에 맞춤)
- `num_traces`: 5000 → 10000 (동시 트레이스 버퍼 확대)

`num_traces`를 늘린 이유는, tail sampling은 트레이스가 완료될 때까지 메모리에 들고 있어야 하기 때문이에요.
5,000 VU에서 동시 진행 트레이스가 5,000개를 초과하면 오래된 것부터 강제 결정되어 부정확해집니다.

### 조치 3: Kafka 버퍼 — Tempo 앞에 충격 흡수기

```
[Before]
goti pods → Alloy(100%) → OTLP → Tempo → OOMKilled

[After]
goti pods → Alloy(tail sampling 10%)
              → Kafka(observability.traces.v1)
                → Alloy consumer(batch)
                  → OTLP → Tempo
```

Kafka를 Alloy와 Tempo 사이에 넣었어요.
Strimzi Kafka가 이미 비즈니스 이벤트용으로 운영 중이라 **토픽 추가만으로 구현** 가능했습니다.

Kafka 토픽 설정:

```yaml
# observability.traces.v1
partitions: 3
replicas: 3
retention: 1시간
```

retention을 1시간으로 설정한 이유는, 트레이스 데이터는 Tempo에 저장되면 Kafka에서 삭제해도 되기 때문이에요.
Kafka는 순수히 **spike 흡수용 버퍼**입니다.

Alloy consumer 쪽 batch 설정:

- `timeout`: 10s
- `send_batch_size`: 256

Tempo가 감당할 수 있는 속도로 일정하게 데이터를 보내는 거예요.
부하가 아무리 급증해도 Kafka가 흡수하고, consumer가 일정 속도로 꺼내줍니다.

### 부수 수정: NetworkPolicy

기존에 Alloy → Kafka는 9404(metrics) 포트만 허용되어 있었어요.
9092(plain) egress를 추가해야 했습니다.

```yaml
# monitoring-netpol.yaml
- to:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: kafka
  ports:
    - port: 9092  # Kafka plain
    - port: 9404  # Kafka metrics (기존)
```

---

## 📊 Before / After

```
[Before]
유입량:    100% (제한 없음)
버퍼:      없음 (직접 전송)
Tempo:     3Gi, CrashLoopBackOff 85회

[After]
유입량:    ~10% (에러/느린 요청은 100%)
버퍼:      Kafka (spike 흡수)
Tempo:     4Gi, 안정 운영
```

Tempo 유입량이 약 **90% 감소**했어요.
남은 10%도 Kafka가 버퍼링하기 때문에, 부하테스트 규모를 10배 늘려도 Tempo 유입 속도는 일정합니다.

에러/느린 트레이스는 100% 보존되니까 디버깅 능력은 유지돼요.
"왜 느렸는지"를 추적하는 데는 정상 트레이스의 10%면 충분합니다.

---

## 📚 배운 점

### 관측성 파이프라인도 backpressure가 필요하다

HTTP 서버에 rate limiter를 다는 건 당연하게 여기면서, 관측성 파이프라인에는 왜 아무 보호 장치가 없었을까요.

트레이스 데이터는 애플리케이션 트래픽에 비례해서 증가해요.
부하테스트처럼 갑자기 트래픽이 10배 뛰면 트레이스도 10배 뜁니다.
**관측 대상이 바빠질 때 관측 시스템도 바빠지는** 구조적 문제가 있어요.

Kafka 버퍼는 이 문제에 대한 답이에요.
producer(Alloy)와 consumer(Tempo) 사이에 Kafka를 두면, producer가 아무리 빠르게 보내도 consumer는 자기 속도로 처리합니다.

### Sampling은 "얼마나 버릴까"가 아니라 "뭘 반드시 남길까"

100% → 10% 샘플링이라고 하면 "90%를 버린다"고 생각하기 쉬워요.
하지만 정확히는 **"에러와 느린 요청은 반드시 남기고, 나머지만 통계적으로 줄인다"**예요.

tail sampling의 장점이 여기 있어요.
head sampling(확률적)과 달리, 트레이스가 완료된 뒤에 결정하니까 "에러가 있었는지", "SLO를 초과했는지"를 기준으로 판단할 수 있습니다.

### Monolithic Tempo의 한계

Tempo monolithic 모드에서는 ingestion + compaction + query가 한 Pod에서 실행돼요.
부하가 높을 때 compaction이 메모리를 크게 먹으면서 ingestion과 경쟁합니다.

prod 환경에서는 Tempo distributed mode로 전환해서 ingester, compactor, querier를 분리해야 해요.
각 컴포넌트가 독립적으로 스케일할 수 있으니까 이런 메모리 경쟁이 발생하지 않습니다.
