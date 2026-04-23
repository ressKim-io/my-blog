---
title: "Alloy에서 OTel Collector로 전환한 이유"
excerpt: "River 문법의 한계와 Kafka 버퍼링 확장을 위해 CNCF 표준 수집기로 전환한 결정"
category: monitoring
tags:
  - OTel-Collector
  - Grafana-Alloy
  - Architecture-Decision
  - Kafka
  - Mimir
  - Observability
date: '2026-02-05'
---

## 🎯 한 줄 요약

> Grafana Alloy의 River 문법과 제한된 커뮤니티 자료 때문에 CNCF 표준 OTel Collector로 전환했습니다. Kafka 버퍼링을 logs/traces 전체로 확장해 30만 동시 접속 스파이크에 대비합니다.

---

## 🤔 배경: Alloy의 한계

### 현재 아키텍처

Goti 프로젝트의 관측성 파이프라인은 이렇게 구성되어 있었습니다.

```
{/* TODO: Draw.io로 교체 */}

┌──────────────────┐
│  Spring Boot     │
│  (OTel SDK)      │
└────────┬─────────┘
         │ OTLP (gRPC/HTTP)
         ▼
┌──────────────────────────────────────┐
│  Grafana Alloy (DaemonSet, v1.6.1)  │
│  ┌─────────┐ ┌─────────┐ ┌───────┐ │
│  │ Metrics  │ │  Logs   │ │Traces │ │
│  └────┬─────┘ └────┬────┘ └───┬───┘ │
└───────┼─────────────┼─────────┼──────┘
        │             │         │
        ▼             ▼         ▼
   ┌─────────┐  ┌─────────┐  ┌───────────┐
   │  Mimir   │  │  Loki   │  │   Kafka   │
   │ (분산 7P)│  │ (직접)  │  │(traces만) │
   └─────────┘  └─────────┘  └─────┬─────┘
                                    ▼
                              ┌───────────┐
                              │   Tempo    │
                              └───────────┘
```

핵심 문제는 **logs가 Kafka 없이 Loki로 직접 전송**된다는 점입니다.
Traces만 Kafka로 버퍼링하고 있었습니다.

### 문제점 4가지

이 구조에서 운영하면서 4가지 문제를 느꼈습니다.

**1. 커뮤니티 자료 부족**

Alloy는 River라는 독자적인 문법을 사용합니다.
Kafka 연동에서 문제가 생기면, 검색해도 OTel Collector YAML 기반 자료만 나옵니다.
River 문법으로 변환하는 건 결국 팀원이 직접 해야 했습니다.

**2. Kafka 연동 자료 부족**

`otelcol.exporter.kafka` 블록의 세부 설정을 찾기 어려웠습니다.
OTel Collector contrib의 `kafkaexporter`는 문서화가 잘 되어 있지만, Alloy에서 래핑한 버전은 예제가 부족합니다.

**3. 스파이크 대응 불완전**

30만 동시 접속 목표인 Goti에서, 초기 폭주 시 logs가 Loki로 직접 쏟아지면 OOM 위험이 있었습니다.
Traces는 이미 Kafka로 버퍼링하고 있는데, logs만 빠져 있는 구조였습니다.

**결국 logs도 Kafka 버퍼링이 필요했습니다.**

**4. 벤더 종속**

Alloy에는 Grafana 전용 블록이 꽤 있습니다.

- `loki.process`: Loki 전용 로그 처리
- `prometheus.remote_write`: Prometheus 전용 전송
- `mimir.rules.kubernetes`: Mimir 전용 rule sync

이런 블록에 의존하면 나중에 다른 백엔드로 전환하기 어렵습니다.

---

## 🔍 대안 비교

### 수집기: 3가지 옵션

| 항목 | Alloy 유지 | OTel Collector | Prometheus Agent + OTel |
|------|-----------|----------------|------------------------|
| Kafka 연동 | River 문법 (자료 적음) | **공식 contrib (자료 풍부)** | OTel만 Kafka, Agent는 별도 |
| OTLP 수신 | otelcol.* 래핑 | **네이티브** | OTel에서 처리 |
| K8s metrics | 내장 prometheus.operator.* | Preset (kubernetesAttributes) | Agent가 담당 |
| Loki 연동 | loki.process (전용) | **otlphttp → /otlp (표준)** | 동일 |
| 커뮤니티 | Grafana 중심 | **CNCF 전체** | 분산 |
| River 의존 | 있음 | **없음 (표준 YAML)** | 없음 |
| 커스텀 빌드 | 불가 | **ocb로 경량 빌드** | 불가 |
| 파이프라인 UI | 12345 포트 | 없음 (대시보드 대체) | 없음 |

OTel Collector가 커뮤니티, Kafka 연동, 표준 YAML 면에서 압도적이었습니다.
유일한 단점은 Alloy의 파이프라인 시각화 UI를 잃는 것인데, Grafana 대시보드로 대체할 수 있었습니다.

### 메트릭 저장소: Mimir 분산 유지

"활성 시리즈가 약 50만인데 분산 모드가 과잉 아닌가?"라는 의문이 있었습니다.

| 항목 | Mimir 분산 유지 | Mimir 싱글바이너리 | Prometheus 단독 |
|------|----------------|-------------------|----------------|
| Pod 수 | 7 + Kafka + MinIO | **1** | 1 |
| 활성 시리즈 한계 | 수천만 | ~100만 | ~50만 |
| OTLP native | 지원 | 지원 | 미지원 |
| 장기 보관 | S3 | S3/filesystem | 로컬만 |
| HA | 다중 replica | 단일 | 단일 |

싱글바이너리로 가고 싶었지만, **현실적으로 불가능**했습니다.

공식 `mimir-distributed` Helm chart에 SingleBinary 모드가 없습니다 (Grafana Discussion #6211).
SimpleScalable 모드도 Mimir 3.0에서 제거되었습니다 (PR #12584).
커스텀 StatefulSet을 직접 만드는 것보다 공식 chart를 유지하는 것이 운영 부담이 적다고 판단했습니다.

**분산 모드가 과잉인 건 맞지만, 공식 chart의 한계 때문에 현상 유지를 선택한 것입니다.**

### 스파이크 버퍼: Kafka vs Redis Streams vs 내부 큐

| 항목 | Kafka (기존 공유) | Redis Streams | Collector 내부 큐 |
|------|-----------------|---------------|------------------|
| 추가 Pod | **0** | 1+ | 0 |
| 버퍼 용량 | **디스크 기반 (대용량)** | 메모리 기반 | 메모리 기반 |
| 내구성 | **디스크 + replication** | AOF/RDB | 프로세스 종료 시 유실 |
| 이미 운영 중 | **Yes (traces용)** | No | - |
| logs 버퍼링 | **topic 추가만** | 구현 필요 | 제한적 |

백엔드팀이 이미 Strimzi Kafka를 운영하고 있었습니다.
Traces 버퍼링도 Kafka topic으로 하고 있었습니다.

추가 인프라 비용 0으로 logs topic만 추가하면 되는 Kafka가 가장 현실적이었습니다.

30만 스파이크 시 초당 수만 건의 로그가 쏟아져도, Kafka의 디스크 기반 버퍼링은 OOM 걱정이 없습니다.
Redis Streams나 Collector 내부 큐는 메모리 기반이라 대용량 스파이크에 취약합니다.

---

## ✅ 결정: 목표 아키텍처

### Before / After

**Before: Alloy 기반**

```
{/* TODO: Draw.io로 교체 */}

┌──────────────────┐
│  Spring Boot     │
│  (OTel SDK)      │
└────────┬─────────┘
         │ OTLP
         ▼
┌──────────────────────────────────────┐
│  Grafana Alloy (DaemonSet)           │
│  metrics ──→ Mimir 분산 (직접)       │
│  logs    ──→ Loki (직접) ⚠️ 버퍼 없음│
│  traces  ──→ Kafka → Alloy → Tempo  │
└──────────────────────────────────────┘
```

**After: OTel Collector + Kafka 전면 버퍼링**

```
{/* TODO: Draw.io로 교체 */}

┌──────────────────┐
│  Spring Boot     │
│  (OTel SDK)      │
└────────┬─────────┘
         │ OTLP (4317/4318)
         ▼
┌──────────────────────────────────────────┐
│  OTel Collector Front (Deployment, 1-2r) │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ Metrics   │ │  Logs    │ │  Traces  │ │
│  └────┬──────┘ └────┬─────┘ └────┬─────┘ │
└───────┼──────────────┼────────────┼───────┘
        │              │            │
        ▼              ▼            ▼
   ┌─────────┐   ┌──────────┐ ┌──────────┐
   │  Mimir   │   │  Kafka   │ │  Kafka   │
   │ (분산)   │   │ logs.v1  │ │traces.v1 │
   │ (직접)   │   └────┬─────┘ └────┬─────┘
   └─────────┘        │            │
                       ▼            ▼
              ┌────────────────────────────┐
              │ OTel Collector Back (1-2r)  │
              │ tail sampling, PII masking  │
              │ logs  ──→ Loki OTLP        │
              │ traces ──→ Tempo           │
              └────────────────────────────┘

┌──────────────────────────────────────────┐
│ K8s ServiceMonitor / PodMonitor          │
│ → Prometheus (kps) → remoteWrite → Mimir │
└──────────────────────────────────────────┘
```

핵심 변화를 정리하면 다음과 같습니다.

**Metrics**: OTel Collector Front에서 `prometheusremotewrite` exporter로 Mimir에 직접 전송합니다.
Kafka를 거치지 않는 이유는, 메트릭은 실시간성이 중요하고 볼륨도 상대적으로 적기 때문입니다.

**Logs**: 기존에 Loki 직접 전송이던 것을 Kafka topic(`observability.logs.v1`)으로 전환했습니다.
Collector Back이 Kafka에서 소비해 Loki OTLP로 전달합니다.

**Traces**: 기존과 동일하게 Kafka 버퍼링을 유지합니다.
다만 Alloy consumer 대신 OTel Collector Back이 소비합니다.

### 결정 근거

**1. OTel Collector: 커뮤니티와 Kafka 연동**

`kafkaexporter`/`kafkareceiver`가 공식 contrib으로 문서화가 잘 되어 있습니다.
팀원이 트러블슈팅할 때 검색하면 바로 답을 찾을 수 있습니다.

Alloy의 `otelcol.*` 블록이 OTel Collector의 컴포넌트와 **개념적으로 대응**하기 때문에 어떤 컴포넌트가 필요한지는 동일합니다. 하지만 **파이프라인 배선 구문은 완전히 다르기** 때문에 마이그레이션 시 YAML 재작성이 필요합니다.

OTel Collector는 YAML 기반 pipeline 정의를 사용합니다:

```yaml
service:
  pipelines:
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [kafka]
```

반면 Alloy는 River 문법으로 output 블록을 명시적으로 연결합니다:

```river
otelcol.receiver.otlp "default" {
  output {
    logs = [otelcol.exporter.kafka.default.input]
  }
}
```

컴포넌트 이름은 비슷하지만, 배선 방식이 근본적으로 다릅니다.
**전환 리스크가 낮다고 오해하면 안 됩니다.** YAML 재작성은 필수입니다.

**2. Mimir 분산 유지: 공식 chart 한계**

공식 `mimir-distributed` Helm chart에 SingleBinary 모드가 없습니다 (Discussion #6211).
SimpleScalable도 Mimir 3.0에서 제거되었습니다.
커스텀 StatefulSet을 만드는 것보다 공식 chart를 유지하는 것이 장기적으로 안전합니다.

**3. Kafka 공유: 추가 비용 0**

백엔드팀이 이미 Strimzi Kafka를 운영하고 있고, traces도 이미 Kafka 버퍼링 중입니다.
`observability.logs.v1` topic 하나만 추가하면 됩니다.

---

## 📊 트레이드오프

모든 전환에는 잃는 것이 있습니다. 솔직하게 정리합니다.

### 긍정적 영향

| 영향 | 정량적 효과 |
|------|-----------|
| Pod 구성 변화 | Alloy DaemonSet 제거 → OTel Collector Front/Back 2개 + Prometheus 1개 추가 |
| 스파이크 대응 | logs + traces **모두** Kafka 버퍼링 |
| 학습 비용 절감 | 표준 YAML, CNCF 전체 커뮤니티 자료 활용 |
| 벤더 중립 | Grafana 전용 블록 의존 제거 |

### 부정적 영향 / 리스크

| 리스크 | 확률 | 영향 | 대응 |
|--------|------|------|------|
| Mimir 분산 모드 리소스 과잉 | 확정 | 낮 | dev 수용, chart에 SingleBinary 추가 시 재검토 |
| 대시보드 40개 중 일부 깨짐 | 높 | 낮 | otelcol_* 호환, alloy_* 1개 패널만 교체 |
| log_type 라벨 동작 변경 | 중 | 높 | Loki OTLP native + distributor otlp_config 사용 중 |
| PrometheusRule sync 방식 변경 | 확정 | 중 | mimirtool CronJob으로 대체 |

**상실하는 기능 3가지**를 구체적으로 보면:

**Alloy Web UI 상실**: Alloy는 `:12345` 포트에서 파이프라인 DAG를 시각적으로 보여줬습니다.
OTel Collector에는 이 기능이 없습니다.
대신 Grafana 대시보드(`infra-otel-pipeline.json`)로 파이프라인 상태를 모니터링할 계획입니다.

**mimir.rules.kubernetes 자동 sync 상실**: Alloy가 Kubernetes의 PrometheusRule CR을 감시해서 Mimir ruler에 자동으로 sync하던 기능입니다.
OTel Collector에는 이 기능이 없으므로, `mimirtool` CronJob 또는 수동 sync로 대체해야 합니다.

**Alloy 클러스터링 상실**: DaemonSet 간 타겟 분배 기능입니다.
Prometheus(kps)가 scrape + remoteWrite to Mimir 하는 구조로 대체합니다.

---

## 📚 핵심 포인트

이번 결정에서 가장 중요한 교훈을 정리합니다.

**도구보다 생태계를 봐야 합니다.** Alloy 자체는 훌륭한 도구입니다.
하지만 River 문법이라는 독자적 생태계가 팀의 학습과 트러블슈팅을 느리게 만들었습니다.
CNCF 표준(OTel Collector YAML)은 검색 한 번에 답이 나옵니다.

**버퍼링은 전부 아니면 전무입니다.** Traces만 Kafka로 버퍼링하고 logs는 직접 전송하는 반쪽짜리 구조는 위험했습니다.
30만 스파이크에서 logs가 Loki를 OOM시키면, traces만 살아남아도 의미가 없습니다.

**공식 chart의 한계도 수용해야 합니다.** Mimir 싱글바이너리가 이상적이지만, 공식 Helm chart가 지원하지 않으면 무리하게 커스텀하지 않는 것이 장기적으로 낫습니다.
Helm chart에 SingleBinary 모드가 추가되면 그때 전환하면 됩니다.

### 향후 과제

- prod(EKS) 배포 시 Mimir 리소스 최적화 검토
- OTel Collector Operator 도입 검토 (auto-instrumentation, sidecar injection)
- Kafka SCRAM-SHA-512 인증 설정 (prod 전용)
