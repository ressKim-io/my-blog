---
date: 2026-03-14
category: decision
project: goti-team-controller
tags: [kafka, otel, alloy, telemetry, mimir, loki, tempo, strimzi, backpressure]
---

# Kafka-buffered OTel 텔레메트리 파이프라인 도입 계획

## Context

Goti 프로젝트는 대규모 티켓팅 서비스를 목표로 하며, MSA 전환 후 6+ 서비스에서 대량의 텔레메트리(메트릭, 로그, 트레이스)가 발생할 것으로 예상된다. 현재 파이프라인은 App → Alloy → Mimir/Loki/Tempo 직접 전송 구조로, 백엔드 장애나 트래픽 스파이크 시 데이터 손실 가능성이 있다.

Strimzi 0.51 + Kafka 4.2.0 KRaft 클러스터가 Kind dev에 배포 완료된 상태에서, Kafka를 텔레메트리 버퍼로도 활용할 수 있는지 조사가 필요했다.

## Issue

### Option A: 현재 구조 유지 (Direct Export)

```
App → Alloy (OTLP) → Mimir / Loki / Tempo
```

- 장점: 단순한 구조, 낮은 레이턴시, 운영 부담 최소
- 단점: 백엔드 장애 시 데이터 손실, 트래픽 스파이크 시 Agent 블로킹, 확장성 한계

### Option B: Kafka-buffered Pipeline (전체 시그널)

```
App → Alloy Agent (otelcol.exporter.kafka)
        → Kafka (otlp_proto)
            → Alloy Gateway (otelcol.receiver.kafka) → Mimir / Loki / Tempo
```

- 장점: 내구성(Kafka retention), backpressure 흡수, 독립 확장, fan-out 가능, 백엔드 교체 시 무중단
- 단점: 운영 복잡도 증가, 레이턴시 추가(ms~초), Kafka 리소스 비용, 디버깅 경로 복잡

### Option C: 시그널 선택적 Kafka 버퍼링 (Logs + Traces만)

```
App → Alloy Agent
        ├─ Metrics → 직접 Mimir (현재 구조 유지)
        ├─ Logs   → Kafka → Alloy Gateway → Loki
        └─ Traces → Kafka → Alloy Gateway → Tempo
```

- 장점: 볼륨 큰 Logs/Traces만 버퍼링하여 ROI 극대화, Metrics는 실시간성 유지
- 단점: 두 가지 경로 혼재로 설정 복잡도 약간 증가

## Action

**최종 선택: Option C (시그널 선택적 Kafka 버퍼링) — MSA 전환 후 단계적 도입**

### 선택 근거

1. **시그널별 적합도가 다름**
   - Logs: 볼륨 최대, 버스트 잦음 → Kafka 버퍼링 ROI 가장 높음
   - Traces: 스팬 볼륨 크고, `partition_by_trace_id`로 tail-sampling에 유리
   - Metrics: 볼륨 상대적으로 작고, 주기적 수집(scrape interval)이라 버스트 적음. 알림 실시간성을 위해 직접 export 유지

2. **Kafka 인프라 이미 존재**: Strimzi 0.51 Kafka 클러스터가 비즈니스 이벤트용으로 배포되어 있으므로, 텔레메트리 토픽 추가만으로 활용 가능 (추가 운영 부담 최소)

3. **Grafana Alloy 완전 지원**: `otelcol.exporter.kafka`와 `otelcol.receiver.kafka` 모두 GA 상태 (Alloy v1.13.2)

4. **지금은 불필요**: dev 환경에서 단일 서비스(goti-server)만 운영 중이므로 직접 export로 충분. MSA 전환 + 부하 테스트 후 병목이 확인되는 시점에 도입

### 조사된 기술 상세

**OTel Kafka 컴포넌트:**

| 컴포넌트 | 역할 | Alloy 상태 | 기본 토픽 |
|----------|------|------------|-----------|
| `otelcol.exporter.kafka` | Agent → Kafka 전송 | GA | `otlp_logs`, `otlp_spans`, `otlp_metrics` |
| `otelcol.receiver.kafka` | Kafka → Backend 소비 | GA | 동일 |

**인코딩 권장**: `otlp_proto` (protobuf — forward/backward compatible, JSON보다 빠름)

**성능 참고 (Bindplane 실측, 16파티션):**

| 최적화 단계 | 처리량 (EPS/파티션) | 개선율 |
|-------------|---------------------|--------|
| 초기 상태 | 12,000 | - |
| Batch processor 위치 최적화 | 17,000 | +41% |
| franz-go 클라이언트 전환 | 23,000 | +35% |
| 인코딩 최적화 | 30,000 | +30% |
| **총 합계 (16파티션)** | **480,000 EPS** | **+150%** |

**Kafka 토픽 설계 (예상):**

| 토픽 | 파티션 | 리텐션 | 용도 |
|------|--------|--------|------|
| `otlp_logs` | 3+ | 2h~24h | 로그 버퍼링 |
| `otlp_spans` | 3+ | 2h~24h | 트레이스 버퍼링 |

**Alloy 아키텍처 변경 (예상):**
- 현재 Alloy DaemonSet(Agent) 1종 → Agent(exporter) + Gateway(receiver) 2종으로 분리
- Gateway는 Deployment로 배포하여 수평 확장 가능

## Result

### 즉시 영향
- 현재 구조 변경 없음. 이 결정은 MSA 전환 후 적용할 계획을 사전 기록한 것

### 도입 타이밍
1. MSA 전환 완료 (6+ 서비스 분리)
2. 부하 테스트로 텔레메트리 병목 확인
3. Logs Kafka 버퍼링 먼저 도입
4. 필요 시 Traces 추가

### 후속 작업 (MSA 전환 시점)
- [ ] Kafka 텔레메트리 토픽 생성 (`otlp_logs`, `otlp_spans`)
- [ ] Alloy Agent config에 `otelcol.exporter.kafka` 추가
- [ ] Alloy Gateway Deployment 생성 + `otelcol.receiver.kafka` 설정
- [ ] Consumer lag 모니터링 대시보드 추가 (`kafka_receiver_partition_lag`)
- [ ] 부하 테스트로 파티션 수 / Consumer 수 튜닝

### 제약 사항
- Kafka 클러스터 리소스 계획 시 비즈니스 이벤트 + 텔레메트리 양쪽 부하 고려 필요
- 텔레메트리 토픽 리텐션은 짧게 유지 (2h~24h) — 장기 저장은 Mimir/Loki/Tempo 역할
- Metrics는 알림 실시간성을 위해 직접 export 유지 (Kafka 경유 시 레이턴시 증가)

## Related Files
- `Goti-monitoring/values-stacks/dev/alloy-values.yaml` — 현재 Alloy config (향후 수정 대상)
- `Goti-k8s/infrastructure/strimzi-operator/config/kafka-cluster.yaml` — Kafka 클러스터 정의
- `Goti-k8s/infrastructure/strimzi-operator/config/topics.yaml` — 비즈니스 토픽 (향후 텔레메트리 토픽 추가)
- `docs/kafka-adoption-decision.md` — Kafka 도입 ADR
