---
title: "Tempo OOM 85회 — Kafka 버퍼와 tail sampling으로 해결하기"
excerpt: "5,000 VU 부하테스트에서 Tempo가 OOMKilled로 85회 재시작됐습니다. 100% 샘플링을 10%로 줄이되 에러와 느린 요청은 전부 남기고, Tempo 앞에 Kafka를 넣어 유입 속도를 고르게 만든 과정입니다"
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

> Alloy가 Tempo로 직접 쏘고 샘플링도 100%인 상태에서 5,000 VU를 걸었더니 Tempo가 OOMKilled로 85회 죽었습니다. 에러와 2초 넘는 요청은 전부 남기고 나머지만 10%로 줄인 뒤, Alloy와 Tempo 사이에 Kafka를 넣어 유입 속도를 고르게 만들었습니다

## Impact

- **영향 범위**: 트레이스 검색, Exemplar 링크, Slow DB Query 대시보드 전체
- **증상**: Tempo CrashLoopBackOff 85회, Grafana의 트레이스 기능 전면 중단
- **소요 시간**: 약 5시간
- **발생일**: 2026-03-25

---

## 🔥 증상: Tempo가 85번 죽었다

5,000 VU 부하테스트를 돌리고 Grafana를 열었더니 트레이스 관련 패널이 전부 죽어 있었습니다

```text
Slow DB Query 목록: dial tcp tempo-dev:3200: connection refused
트레이스 검색: 불가
Exemplar 링크: 깨짐
```

Tempo Pod 상태를 봤습니다

```text
Last State:     Terminated
  Reason:       OOMKilled
  Exit Code:    137
  Restart Count: 85
  Limits:
    memory:  3Gi
```

**85회 재시작**입니다. CrashLoopBackOff에 들어가면 재시도 간격이 점점 벌어져서, 복구까지 수십 분이 걸렸습니다

Tempo 로그를 보니 compaction 도중에 터지고 있었습니다

```text
compacting block totalObjects=130165 size=95354387 compactionLevel=4
```

13만 개 객체, 95MB짜리 블록을 처리하다 메모리가 넘쳤습니다

---

## 🤔 원인 분석

세 가지가 겹쳐 있었습니다

### 1. 100% 샘플링

dev 환경이라 디버깅 편하라고 모든 트레이스를 저장하고 있었습니다

5,000 VU에서 MSA 5개 서비스가 각각 span을 만들면 초당 수만 건이 들어옵니다. Tempo 3Gi로는 받아낼 양이 아니었습니다

### 2. 유입 속도를 제어할 수단이 없음

기존 흐름은 goti pods에서 Alloy를 거쳐 OTLP gRPC로 Tempo에 바로 꽂히는 구조였습니다

중간에 완충이 없으니 부하가 몰려도 Tempo가 잠깐 멈추라고 말할 방법이 없었습니다

gRPC에 backpressure가 있긴 합니다. 그런데 그건 문제를 한 칸 앞으로 옮길 뿐입니다. Tempo가 못 받으면 Alloy에 쌓이고, 그러면 이번엔 Alloy가 위험해집니다

### 3. compaction과 ingestion이 같은 메모리를 다툼

Tempo monolithic 모드에서는 ingestion과 compaction이 한 Pod 안에서 돕니다

데이터가 계속 들어오는 와중에 compaction이 큰 블록을 잡으면 메모리가 순간적으로 치솟습니다. 위 로그의 95MB 블록이 그 순간이었습니다

---

## ✅ 해결: 세 가지 조치

### 조치 1: 메모리 증설 (임시)

```yaml
# tempo-values.yaml
resources:
  limits:
    memory: 4Gi  # 3Gi → 4Gi
```

임시방편입니다. 부하테스트 규모가 열 배가 되면 그대로 다시 터집니다

일단 급한 불을 끄고 근본 대응으로 넘어갔습니다

### 조치 2: Tail Sampling — 10%로 줄이되 중요한 건 전부 남기기

Alloy의 tail sampling 정책을 다시 짰습니다

```text
에러 트레이스:           100% 보존
2초 이상 느린 트레이스:   100% 보존
나머지 정상 트레이스:     10% 샘플링
```

부하테스트에서 만들어지는 트레이스는 대부분 똑같은 정상 패턴입니다. 에러와 느린 요청만 전수로 챙기면 나머지는 10%만 있어도 디버깅에 모자라지 않습니다

건드린 값은 셋입니다

- `sampling_percentage`: 100% → 10%
- slow-traces threshold: 500ms → 2000ms (SLO 기준에 맞춤)
- `num_traces`: 5000 → 10000 (동시 트레이스 버퍼 확대)

`num_traces`를 올린 데는 이유가 있습니다. tail sampling은 트레이스가 끝날 때까지 메모리에 들고 있어야 판단할 수 있습니다

5,000 VU에서 동시에 진행 중인 트레이스가 5,000개를 넘으면 오래된 것부터 강제로 결정해 버려서 판단이 부정확해집니다

### 조치 3: Kafka 버퍼 — Tempo 앞에 완충 넣기

| 시점 | 파이프라인 |
|---|---|
| Before | goti pods → Alloy(100% 샘플링) → OTLP → Tempo → **OOMKilled** |
| After | goti pods → Alloy(tail sampling 10%) → Kafka(`observability.traces.v1`) → Alloy consumer(batch) → OTLP → Tempo |

Alloy와 Tempo 사이에 Kafka를 끼웠습니다

Strimzi Kafka가 이미 비즈니스 이벤트용으로 돌고 있어서 토픽만 추가하면 됐습니다

```yaml
# observability.traces.v1
partitions: 3
replicas: 3
retention: 1시간
```

retention을 1시간으로 짧게 잡았습니다. 트레이스는 Tempo에 들어가면 Kafka에 남겨 둘 이유가 없습니다

Kafka는 오래 보관하는 곳이 아니라 몰릴 때 받아 주는 곳입니다. 역할을 섞으면 Kafka 자체가 장애 지점이 됩니다

consumer 쪽 batch는 `timeout` 10초, `send_batch_size` 256으로 뒀습니다. Tempo가 감당할 만한 속도로 일정하게 흘려보내는 설정입니다

부하가 아무리 튀어도 Kafka가 받아 두고 consumer가 자기 속도로 꺼내 갑니다

### 부수 수정: NetworkPolicy

Alloy에서 Kafka로 나가는 길에 9404(metrics) 포트만 열려 있었습니다. 9092를 추가해야 했습니다

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

```text
[Before]
유입량:    100% (제한 없음)
버퍼:      없음 (직접 전송)
Tempo:     3Gi, CrashLoopBackOff 85회

[After]
유입량:    약 10% (에러·느린 요청은 100%)
버퍼:      Kafka (몰리는 트래픽 흡수)
Tempo:     4Gi, 안정 운영
```

Tempo로 들어가는 양이 약 **90% 줄었습니다**

남은 10%도 Kafka를 거치니 부하테스트 규모를 열 배로 키워도 Tempo가 받는 속도는 일정합니다

에러와 느린 트레이스는 그대로 다 남으니 디버깅 능력은 줄지 않았습니다. 왜 느렸는지 쫓는 데는 정상 트레이스 10%면 충분합니다

---

## 📚 배운 점

### 관측 파이프라인에도 backpressure가 필요하다

HTTP 서버 앞에 rate limiter를 다는 것은 당연하게 여깁니다. 그런데 관측 파이프라인에는 왜 아무 보호 장치도 두지 않았는지 돌아봐야 했습니다

트레이스는 애플리케이션 트래픽에 비례해 늘어납니다. 부하테스트로 트래픽이 열 배가 되면 트레이스도 열 배가 됩니다

**관측 대상이 바빠지는 바로 그때 관측 시스템도 같이 바빠집니다.** 가장 필요한 순간에 가장 취약해지는 구조입니다

Kafka 버퍼가 그 답이었습니다. producer인 Alloy와 consumer인 Tempo 사이에 두면, 앞에서 아무리 빨리 보내도 뒤에서는 자기 속도로 처리합니다

### 샘플링은 얼마나 버릴지가 아니라 무엇을 남길지의 문제

100%에서 10%로 줄인다고 하면 90%를 버린다고 읽히기 쉽습니다

정확히는 **에러와 느린 요청은 반드시 남기고 나머지만 통계적으로 줄인다**는 뜻입니다

tail sampling의 값어치가 여기 있습니다. 확률로 미리 정하는 head sampling과 달리 트레이스가 끝난 뒤에 판단하므로, 에러가 있었는지 SLO를 넘겼는지를 기준으로 삼을 수 있습니다

### monolithic Tempo의 한계

monolithic 모드는 ingestion과 compaction, query가 한 Pod에서 돕니다

부하가 높을 때 compaction이 메모리를 크게 잡으면 ingestion과 자원을 다툽니다. 어느 쪽이 범인인지 분리하기도 어렵습니다

prod에서는 distributed 모드로 옮겨 ingester와 compactor, querier를 나눠야 합니다. 각자 따로 늘릴 수 있으면 이런 다툼 자체가 생기지 않습니다

### 덧붙임 — 이 완충이 다음 문제를 만들었습니다

여기서 넣은 Kafka 버퍼는 OOM을 확실히 막았습니다

대신 파이프라인 전체 지연이 늘었고, 그것이 며칠 뒤 [span 140만 건이 통째로 폐기되는 사건](/logs/goti-tempo-spanmetrics-batch-timeout/)으로 돌아왔습니다

완충 장치는 지연이라는 값을 치르고 안정성을 사는 거래입니다. 그 값을 계산하지 않으면 다른 곳에서 청구서를 받습니다
