---
title: "Kafka 버퍼드 OTel 파이프라인 — MSA 전환에 대비한 텔레메트리 버퍼 설계"
excerpt: "Alloy 직접 전송 구조의 백엔드 의존성을 줄이기 위해 Kafka를 텔레메트리 버퍼로 도입할지 검토했습니다. Logs와 Traces만 선택적으로 버퍼링하는 Option C를 최종 선택했습니다."
category: monitoring
tags:
  - go-ti
  - Observability
  - OpenTelemetry
  - Kafka
  - Grafana-Alloy
  - Architecture-Decision-Record
  - troubleshooting
series:
  name: "goti-observability-ops"
  order: 3
date: "2026-03-14"
---

## 한 줄 요약

> MSA 전환 후 폭증할 텔레메트리에 대비해 Kafka를 OTel 파이프라인의 버퍼로 사용할지 검토했습니다. Metrics는 실시간성 때문에 직접 전송을 유지하고, 볼륨이 큰 Logs와 Traces만 Kafka로 버퍼링하는 **시그널 선택적 버퍼링(Option C)**을 선택했습니다.

---

## 배경: 직접 전송 구조의 한계가 보이기 시작했습니다

Goti 프로젝트는 대규모 티켓팅 서비스를 목표로 합니다.
현재는 단일 서비스(`goti-server`)지만, MSA 전환 이후 6개 이상의 서비스가 동시에 텔레메트리를 생성할 예정입니다.

현재 관측성 파이프라인은 다음과 같이 구성되어 있습니다.

```text
App → Alloy (OTLP) → Mimir / Loki / Tempo
```

Alloy가 애플리케이션의 OTLP 데이터를 받아 Mimir(메트릭), Loki(로그), Tempo(트레이스)로 **직접 전송**합니다.
단순하고 빠르지만, 백엔드 하나라도 불안정해지면 파이프라인 전체가 흔들립니다.

구체적으로 우려되는 시나리오는 다음과 같습니다.

- **백엔드 장애 시 데이터 손실**: Loki가 잠시 응답하지 못하면 그 사이 로그는 사라집니다.
- **트래픽 스파이크 시 Agent 블로킹**: 티켓 오픈 순간 스파이크가 Alloy 버퍼를 넘기면 드롭이 발생합니다.
- **확장성 한계**: Agent가 백엔드까지 직접 밀어내기 때문에 각 백엔드 RPS가 곧 Agent 병목이 됩니다.

마침 Strimzi 0.51 + Kafka 4.2.0 KRaft 클러스터가 Kind dev에 비즈니스 이벤트용으로 배포되어 있었습니다.
이 Kafka를 텔레메트리 버퍼로도 활용할 수 있는지 조사를 시작했습니다.

---

## 선택지 비교

세 가지 선택지를 놓고 비교했습니다.

### Option A: 현재 구조 유지 (Direct Export)

```text
App → Alloy (OTLP) → Mimir / Loki / Tempo
```

- **장점**: 구조가 단순합니다. 레이턴시가 가장 낮습니다. 운영 부담이 최소입니다.
- **단점**: 백엔드 장애 시 데이터 손실이 발생합니다. 스파이크에서 Agent가 블로킹됩니다. 확장성에 한계가 있습니다.

### Option B: 전체 시그널 Kafka 버퍼링

```text
App → Alloy Agent (otelcol.exporter.kafka)
        → Kafka (otlp_proto)
            → Alloy Gateway (otelcol.receiver.kafka)
                → Mimir / Loki / Tempo
```

- **장점**: Kafka 리텐션 덕분에 내구성이 확보됩니다. Backpressure를 흡수할 수 있습니다. Agent와 Gateway가 독립적으로 확장됩니다. 동일 토픽을 여러 소비자가 읽는 fan-out이 가능합니다. 백엔드 교체 시 무중단입니다.
- **단점**: 운영 복잡도가 올라갑니다. 레이턴시가 밀리초에서 초 단위로 늘어납니다. Kafka 리소스 비용이 추가됩니다. 디버깅 경로가 복잡해집니다.

### Option C: 시그널 선택적 Kafka 버퍼링 (Logs + Traces만)

```text
App → Alloy Agent
        ├─ Metrics → 직접 Mimir (현재 구조 유지)
        ├─ Logs   → Kafka → Alloy Gateway → Loki
        └─ Traces → Kafka → Alloy Gateway → Tempo
```

- **장점**: 볼륨이 큰 Logs와 Traces에만 버퍼링을 적용해 ROI를 극대화합니다. Metrics는 직접 전송으로 실시간성을 유지합니다.
- **단점**: 두 경로가 혼재해 설정 복잡도가 조금 올라갑니다.

---

## 결정: Option C를 MSA 전환 후 단계적으로 도입합니다

최종 선택은 **Option C(시그널 선택적 Kafka 버퍼링)**입니다.
다만 지금 당장 적용하지 않고, MSA 전환이 끝난 시점에 단계적으로 도입할 계획입니다.

### 근거 1: 시그널별 적합도가 다릅니다

세 시그널은 볼륨 특성과 실시간성 요구가 모두 다릅니다.

- **Logs**: 볼륨이 가장 크고 버스트가 잦습니다. 버퍼링 ROI가 가장 높은 시그널입니다.
- **Traces**: 스팬 볼륨이 크고, Kafka `partition_by_trace_id` 전략을 쓰면 tail-sampling에 유리합니다.
- **Metrics**: 볼륨이 상대적으로 작고, scrape interval 기반 주기적 수집이라 버스트가 적습니다. 알림 실시간성을 위해 직접 전송을 유지해야 합니다.

Metrics까지 Kafka를 태우면 알림 지연이 수 초 늘어날 수 있습니다.
티켓팅 서비스에서 이 지연은 허용하기 어려운 수준입니다.

### 근거 2: Kafka 인프라가 이미 존재합니다

Strimzi 0.51 Kafka 클러스터는 비즈니스 이벤트용으로 이미 배포되어 있습니다.
텔레메트리 토픽만 추가하면 되므로 **추가 운영 부담이 최소**입니다.

새로운 클러스터를 띄우는 것이 아니라, 기존 클러스터에 `otlp_logs`와 `otlp_spans` 토픽을 얹는 수준입니다.

### 근거 3: Grafana Alloy가 완전히 지원합니다

`otelcol.exporter.kafka`와 `otelcol.receiver.kafka` 컴포넌트 모두 Alloy v1.13.2에서 **GA 상태**입니다.
커스텀 빌드 없이 기본 Alloy만으로 파이프라인을 구성할 수 있습니다.

### 근거 4: 지금은 불필요합니다

dev 환경에서는 단일 서비스만 운영 중이라 직접 전송으로 충분합니다.
MSA 전환 후 부하 테스트로 병목이 실제로 확인되는 시점에 도입하는 것이 합리적입니다.

---

## 조사된 기술 상세

### OTel Kafka 컴포넌트

| 컴포넌트 | 역할 | Alloy 상태 | 기본 토픽 |
|----------|------|------------|-----------|
| `otelcol.exporter.kafka` | Agent → Kafka 전송 | GA | `otlp_logs`, `otlp_spans`, `otlp_metrics` |
| `otelcol.receiver.kafka` | Kafka → Backend 소비 | GA | 동일 |

Exporter는 Alloy Agent 쪽에서 실행되며 OTLP 데이터를 Kafka 토픽으로 밀어냅니다.
Receiver는 Alloy Gateway 쪽에서 실행되며 Kafka에서 읽어 각 백엔드로 전송합니다.

**인코딩**은 `otlp_proto`를 권장합니다.
Protobuf 인코딩은 forward/backward compatible하며 JSON보다 훨씬 빠릅니다.
스키마 호환성이 중요하지 않은 단기 버퍼용이라도, JSON보다 인코딩 비용이 작다는 점이 결정적입니다.

### 성능 참고치 (Bindplane 실측, 16파티션)

| 최적화 단계 | 처리량 (EPS/파티션) | 개선율 |
|-------------|---------------------|--------|
| 초기 상태 | 12,000 | - |
| Batch processor 위치 최적화 | 17,000 | +41% |
| franz-go 클라이언트 전환 | 23,000 | +35% |
| 인코딩 최적화 | 30,000 | +30% |
| **총 합계 (16파티션)** | **480,000 EPS** | **+150%** |

공식 OTel 커뮤니티 벤치마크가 아니라 Bindplane 실측치이므로 절대 수치는 환경에 따라 달라질 수 있습니다.
다만 **최적화 여지가 크다**는 점은 분명합니다.

단순히 디폴트 설정으로 쓰면 파티션당 12K EPS 수준이지만, Batch processor 위치 조정과 franz-go 클라이언트 전환만으로 2배 가까이 끌어올릴 수 있습니다.
16파티션이면 이론상 48만 EPS까지 가능합니다.

Goti 환경에서 동일한 수치를 바로 기대하지는 않지만, **튜닝 포인트가 명확하다**는 것이 중요합니다.

### Kafka 토픽 설계(예상)

| 토픽 | 파티션 | 리텐션 | 용도 |
|------|--------|--------|------|
| `otlp_logs` | 3+ | 2h~24h | 로그 버퍼링 |
| `otlp_spans` | 3+ | 2h~24h | 트레이스 버퍼링 |

리텐션을 일부러 짧게(2시간~24시간) 잡습니다.
장기 저장은 Mimir, Loki, Tempo가 담당하고, **Kafka는 단기 버퍼 역할만 합니다**.

리텐션을 길게 잡으면 Kafka 디스크가 빠르게 차오르고, 토픽 자체가 장애 지점이 됩니다.
버퍼는 버퍼의 역할만 하도록 범위를 좁혔습니다.

### Alloy 아키텍처 변경(예상)

현재는 Alloy DaemonSet 하나가 Agent 역할과 전송 역할을 모두 수행합니다.
Option C를 도입하면 Alloy를 두 종류로 분리해야 합니다.

- **Alloy Agent**(DaemonSet): 애플리케이션 OTLP 수집 + Kafka 전송(`otelcol.exporter.kafka`)
- **Alloy Gateway**(Deployment): Kafka 소비(`otelcol.receiver.kafka`) + 백엔드 전송

Gateway를 Deployment로 배포하면 **수평 확장**이 가능해집니다.
Kafka Consumer Group 기반이라 Replica를 늘리면 파티션이 자동으로 재분배됩니다.

---

## 영향과 도입 타이밍

### 즉시 영향

현재 구조에는 변경이 없습니다.
이 결정은 MSA 전환 후 적용할 계획을 **사전에 문서화**한 것입니다.

### 도입 단계

다음 순서로 점진적으로 도입합니다.

1. MSA 전환이 완료됩니다(6개 이상 서비스 분리).
2. 부하 테스트로 텔레메트리 병목을 실제로 확인합니다.
3. **Logs Kafka 버퍼링 먼저** 도입합니다. 볼륨이 가장 크고 ROI가 명확하기 때문입니다.
4. 필요하면 Traces를 추가합니다.

Logs를 먼저 도입하는 이유는 두 가지입니다.
첫째, 로그는 볼륨이 가장 커서 버퍼링 효과가 즉시 드러납니다.
둘째, 로그는 tail-sampling 같은 복잡한 파티셔닝 전략이 필요 없어 설정이 가장 간단합니다.

### 후속 작업 목록 (MSA 전환 시점)

- Kafka 텔레메트리 토픽 생성 (`otlp_logs`, `otlp_spans`)
- Alloy Agent config에 `otelcol.exporter.kafka` 추가
- Alloy Gateway Deployment 생성 + `otelcol.receiver.kafka` 설정
- Consumer lag 모니터링 대시보드 추가 (`kafka_receiver_partition_lag`)
- 부하 테스트로 파티션 수와 Consumer 수 튜닝

### 제약 사항

- Kafka 클러스터 리소스 계획 시 **비즈니스 이벤트 + 텔레메트리 양쪽 부하**를 함께 고려해야 합니다.
- 텔레메트리 토픽 리텐션은 짧게 유지합니다(2시간~24시간). 장기 저장은 Mimir/Loki/Tempo의 역할입니다.
- Metrics는 직접 전송을 유지합니다. Kafka 경유 시 알림 실시간성이 훼손됩니다.

---

## 배운 점

- **"지금 도입하지 않는다"도 유효한 결정**입니다. MSA 전환 전에는 직접 전송이 더 싸고 단순합니다. 미리 쓰지 않고 설계만 확정해 두는 것이 낭비를 줄입니다.
- 텔레메트리 시그널은 **하나의 파이프라인으로 묶지 않아도 됩니다**. Metrics/Logs/Traces는 볼륨과 실시간성이 다르므로 경로를 분리하는 편이 ROI가 좋습니다.
- Kafka를 버퍼로 쓸 때 **리텐션은 짧게 잡아야 합니다**. 장기 저장소는 Mimir/Loki/Tempo이고, Kafka는 backpressure 흡수용입니다. 역할을 섞으면 Kafka가 장애 지점이 됩니다.
- OTel Kafka 컴포넌트의 **인코딩은 `otlp_proto`**가 기본입니다. JSON은 사람이 읽기 쉽지만 인코딩 비용 때문에 파이프라인 성능이 떨어집니다.
- Alloy Agent와 Gateway를 **역할로 분리**하면 수평 확장이 자연스러워집니다. DaemonSet 하나가 모든 역할을 지는 구조는 규모가 커지면 병목이 됩니다.
