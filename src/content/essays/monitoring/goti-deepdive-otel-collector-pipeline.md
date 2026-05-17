---
title: "OTel Collector — receiver/processor/exporter 3단 파이프라인 동작 원리"
excerpt: "OTel Collector가 텔레메트리를 수신·변환·전송하는 3단 파이프라인 구조와, 시그널(metrics/logs/traces)별 독립 파이프라인 분기 및 ocb 경량 커스텀 빌드 방식을 설명합니다"
category: monitoring
tags:
  - go-ti
  - otel-collector
  - opentelemetry
  - pipeline
  - receiver
  - exporter
  - concept
series:
  name: "goti-deepdive-observability"
  order: 7
date: "2026-03-29"
---

## 한 줄 요약

> OTel Collector는 텔레메트리(metrics/logs/traces)를 수신(receiver) → 변환(processor 체인) → 전송(exporter)하는 3단 파이프라인 구조로, 시그널마다 독립 파이프라인을 선언해 백엔드 종류에 관계없이 데이터 흐름을 조합합니다

---

## 🤔 무엇을 푸는 기술인가

분산 시스템에서 애플리케이션이 생성하는 텔레메트리(메트릭·로그·트레이스)를 백엔드로 보내는 방법은 크게 두 가지입니다 — 앱이 백엔드 SDK를 직접 임포트해서 보내거나, 중간 수집기를 두는 방식입니다

직접 전송 방식은 단순하지만 결합이 강해집니다 백엔드를 교체하면 앱 코드를 수정해야 하고, 배압(back-pressure) 관리나 재시도 로직도 앱에 추가됩니다 스파이크가 오면 앱이 직접 충격을 받습니다

**OTel Collector**는 이 사이에 위치하는 벤더 중립 수집기입니다 CNCF 프로젝트로, OpenTelemetry Protocol(OTLP)을 기본 수신 포맷으로 사용합니다 앱은 Collector에만 전송하고, Collector가 백엔드 적응(변환·라우팅·버퍼링)을 전담합니다 백엔드가 Prometheus에서 Mimir로 바뀌거나, 트레이스가 Tempo에서 Jaeger로 바뀌어도 앱 코드는 건드리지 않습니다

핵심 설계 원칙 두 가지는 **파이프라인 선언성**과 **컴포넌트 조합 가능성**입니다 수신 방식(receiver)·처리 방식(processor)·전송 방식(exporter)을 YAML에서 독립적으로 선언하고, 시그널별로 조합을 바꿀 수 있습니다 메트릭은 Prometheus 형식으로 Mimir에 보내고, 로그는 Kafka에 버퍼링하는 식입니다

---

## 🔧 동작 원리

### 3단 파이프라인 구조

![OTel Collector 파이프라인 구조도 — receiver/processor 체인/exporter 3단 흐름|tall](/diagrams/goti-deepdive-otel-collector-pipeline-1.svg)

위 다이어그램은 OTel Collector 내부에서 텔레메트리가 처리되는 3단 흐름 전체를 보여줍니다 왼쪽에서 OTel SDK가 OTLP로 전송하면 Receiver(파랑)가 수신하고, 가운데 Processor 체인(보라)이 변환·제어하고, 오른쪽 Exporter(노랑)가 백엔드로 내보냅니다 Processor 영역 하단의 `↓ 순서 고정 필수` 표기는 실제 운영에서 자주 놓치는 주의 사항을 나타냅니다

#### Receiver — 텔레메트리 수신

Receiver는 외부에서 데이터를 받아 Collector 내부 파이프라인으로 넘기는 입구 컴포넌트입니다 가장 범용적인 것이 **otlpreceiver**로, gRPC(기본 포트 4317)와 HTTP(4318) 두 엔드포인트를 동시에 열 수 있습니다

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318
```

수신된 데이터는 시그널 타입(metrics/logs/traces)에 따라 내부적으로 분리됩니다 단일 otlpreceiver를 세 파이프라인이 공유하더라도, 내부에서는 시그널별 채널이 분리되어 있어 메트릭 급증이 트레이스 수신을 막지 않습니다

otlpreceiver 외에도 contrib 레포지터리에는 kafkareceiver, prometheusr eceiver, jaegerreceiver 등 다양한 수신기가 있습니다 이 컴포넌트들은 각각 독립 모듈로 패키징되어, ocb 빌드 시 필요한 것만 포함할 수 있습니다

#### Processor 체인 — 변환과 흐름 제어

Processor는 파이프라인 중간에서 데이터를 가공하거나 흐름을 제어합니다 복수의 Processor를 순서대로 연결해 체인으로 구성하며, **순서가 의미를 가집니다**

가장 중요한 두 Processor는 **memory_limiter**와 **batch**입니다

```yaml
processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 512
    spike_limit_mib: 128
  batch:
    send_batch_size: 512
    timeout: 5s
```

**memory_limiter**는 Collector 프로세스의 메모리 사용량을 모니터링합니다 `limit_mib`에 도달하면 이후 들어오는 데이터를 거부(backpressure)해 OOM을 방지합니다 `spike_limit_mib`는 급격한 메모리 증가 상황에서 더 빨리 반응하도록 합니다 이 Processor는 **반드시 체인의 1번째**에 놓아야 합니다 나중에 놓으면 이미 메모리에 적재된 데이터를 처리한 후에야 한도를 확인하므로 의미가 없습니다

**batch** Processor는 데이터를 모아서 한 번에 Exporter로 내보냅니다 `send_batch_size`개가 모이거나 `timeout`이 지나면 내보냅니다 백엔드에 대한 요청 횟수를 줄여 네트워크 비용을 낮추고, 백엔드의 수신 부하를 고르게 분산합니다 batch는 항상 memory_limiter 뒤에 위치합니다

그 외 주요 Processor는 다음과 같습니다

| Processor | 역할 |
|---|---|
| `k8sattributes` | K8s 메타 자동 주입 (Pod명·네임스페이스·노드명) |
| `resource` | 리소스 속성 추가/삭제/변환 |
| `attributes` | 데이터포인트 속성 편집 |
| `tail_sampling` | 트레이스 완성 후 샘플링 (에러·느린 요청 보존) |
| `filter` | 조건에 맞는 데이터만 통과 |

#### Exporter — 백엔드로 전송

Exporter는 처리된 데이터를 목적지 백엔드에 맞는 형식과 프로토콜로 전송합니다 한 파이프라인에 여러 Exporter를 동시에 연결하면 데이터를 팬아웃(fan-out)합니다 예를 들어 디버그용 `debug` Exporter와 실제 백엔드 Exporter를 함께 붙이면 데이터가 양쪽으로 복사됩니다

go-ti에서 사용한 주요 Exporter는 두 가지입니다

```yaml
exporters:
  prometheusremotewrite:
    endpoint: "http://mimir-distributor:9009/api/v1/push"
    headers:
      X-Scope-OrgID: "goti"
  kafka:
    brokers: ["kafka-0.kafka.observability.svc:9092"]
    topic: observability.logs.v1
    encoding: otlp_proto
```

`prometheusremotewrite`는 메트릭을 Prometheus Remote Write 형식으로 Mimir에 전송합니다 `X-Scope-OrgID` 헤더는 Mimir 멀티테넌시에서 테넌트를 식별하는 필수 헤더입니다

`kafkaexporter`는 로그·트레이스를 Kafka 토픽에 발행합니다 `encoding: otlp_proto`를 지정하면 수신 측 Back Collector가 표준 OTLP 형식으로 파싱할 수 있습니다

### 시그널별 파이프라인 분기

![시그널별 독립 파이프라인 분기 — metrics/logs/traces|tall](/diagrams/goti-deepdive-otel-collector-pipeline-2.svg)

위 다이어그램은 세 파이프라인이 각각 독립적으로 선언되어, receiver와 processor는 공유하거나 각자 가질 수 있고 exporter는 시그널 특성에 따라 다른 백엔드로 분기되는 구조를 보여줍니다 metrics(초록)는 Mimir로 직접 전송하고, logs(파랑)와 traces(노랑)는 Kafka exporter를 통해 메시지 큐에 발행됩니다

Collector의 파이프라인은 service 섹션에서 선언합니다

```yaml
service:
  pipelines:
    metrics:
      receivers:  [otlp]
      processors: [memory_limiter, batch]
      exporters:  [prometheusremotewrite]
    logs:
      receivers:  [otlp]
      processors: [memory_limiter, batch, resource, attributes]
      exporters:  [kafka/logs]
    traces:
      receivers:  [otlp]
      processors: [memory_limiter, batch]
      exporters:  [kafka/traces]
```

파이프라인 이름(예: `kafka/logs`, `kafka/traces`)에 `/` 뒤 접미사를 붙이면 동일 컴포넌트 타입을 여러 파이프라인에서 별도 인스턴스로 사용할 수 있습니다 logs용 Kafka exporter와 traces용 Kafka exporter가 토픽 설정만 다를 때 유용합니다

각 파이프라인은 완전히 독립 고루틴에서 실행됩니다 logs 파이프라인이 Kafka backpressure로 느려지더라도 metrics 파이프라인은 영향받지 않습니다 시그널별 처리 보장은 이 격리 구조에서 나옵니다

### ocb — 경량 커스텀 빌드

OTel Collector는 두 가지 배포 형태를 공식 제공합니다

- **otelcol**: 핵심 컴포넌트만 포함한 최소 빌드
- **otelcol-contrib**: 모든 contrib 컴포넌트를 포함한 최대 빌드 (바이너리 크기 큼)

대부분의 프로덕션 환경은 이 둘 사이 어딘가를 필요로 합니다 kafkaexporter는 필요하지만 jaegerexporter는 필요 없는 식입니다 이때 사용하는 것이 **ocb(OpenTelemetry Collector Builder)**입니다

```yaml
# builder-config.yaml
dist:
  name: otelcol-goti
  description: "go-ti custom collector"
  version: "0.98.0"

receivers:
  - gomod: go.opentelemetry.io/collector/receiver/otlpreceiver v0.98.0
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/receiver/kafkareceiver v0.98.0

processors:
  - gomod: go.opentelemetry.io/collector/processor/memorylimiterprocessor v0.98.0
  - gomod: go.opentelemetry.io/collector/processor/batchprocessor v0.98.0
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/processor/k8sattributesprocessor v0.98.0

exporters:
  - gomod: go.opentelemetry.io/collector/exporter/otlpexporter v0.98.0
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/exporter/prometheusremotewriteexporter v0.98.0
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/exporter/kafkaexporter v0.98.0
```

```bash
# 빌드 실행
ocb --config builder-config.yaml
```

`builder-config.yaml`에 필요한 컴포넌트만 열거하면 ocb가 Go 모듈 그래프를 구성해 단일 바이너리를 빌드합니다 otelcol-contrib 대비 바이너리 크기가 수십 MB 줄고, 포함하지 않은 컴포넌트의 코드 경로 자체가 없어 공격 표면이 감소합니다

---

## 📐 세부 동작과 옵션

### memory_limiter 파라미터

| 파라미터 | 역할 | 권장값 |
|---|---|---|
| `check_interval` | 메모리 체크 주기 | `1s` |
| `limit_mib` | 한도 초과 시 backpressure | 컨테이너 limit의 80% |
| `spike_limit_mib` | 급증 감지 마진 | `limit_mib`의 25% |
| `limit_percentage` | MiB 대신 % 지정 | `80` (동적 환경) |

`limit_mib`에 도달한 Collector는 새 데이터를 `ResourceExhausted` gRPC 상태로 거부합니다 OTel SDK는 이 응답을 받으면 내장 재시도 큐에 데이터를 보관합니다 Collector 메모리가 내려오면 자동으로 재전송이 시작됩니다

### batch Processor 파라미터

| 파라미터 | 역할 | 기본값 |
|---|---|---|
| `send_batch_size` | 묶음 크기(데이터포인트 수) | `8192` |
| `send_batch_max_size` | 최대 허용 크기 | `0` (무제한) |
| `timeout` | 최대 대기 시간 | `200ms` |

`timeout`이 짧을수록 백엔드 전송 지연이 줄지만 요청 수가 늘어납니다 메트릭 알림 지연에 민감한 경우 `timeout: 1s` 이하를 권장합니다 Kafka exporter와 조합할 때는 `timeout: 5s` 정도로 넉넉히 설정해 묶음 크기를 키우는 것이 처리량에 유리합니다

### 벤더 중립 YAML

Collector 설정 파일은 표준 YAML이라 버전 관리에 적합합니다 특정 클라우드 벤더나 Grafana 전용 문법에 의존하지 않습니다 Alloy의 River 문법은 Grafana 생태계에서만 통용되지만, Collector YAML은 어느 CI 도구에서도 lint·diff·PR review가 가능합니다

```yaml
# YAML 레이아웃 — 4개 최상위 섹션
receivers:    # 수신기 선언
processors:   # 처리기 선언
exporters:    # 전송기 선언
service:      # 파이프라인 조합
  pipelines:
    metrics:  { receivers: [...], processors: [...], exporters: [...] }
    logs:     { receivers: [...], processors: [...], exporters: [...] }
    traces:   { receivers: [...], processors: [...], exporters: [...] }
```

선언 섹션에서 컴포넌트를 정의하고, `service.pipelines`에서 조합합니다 선언만 하고 파이프라인에 연결하지 않으면 해당 컴포넌트는 실행되지 않습니다 이 분리 덕분에 동일 컴포넌트를 여러 파이프라인에서 재사용하거나, 파이프라인마다 다른 인스턴스를 붙이는 설계가 자연스럽습니다

---

## 🧩 go-ti에서는

go-ti 관측성 스택 재구성 과정에서 Grafana Alloy를 OTel Collector로 교체했습니다 교체의 직접적 이유는 Alloy의 `otelcol.*` 블록이 결국 OTel Collector YAML과 1:1 매핑되는 래퍼에 불과한데, Kafka exporter 설정 관련 커뮤니티 자료가 OTel 공식 문서 기준으로만 작성되어 있었기 때문입니다 Alloy 문법으로 변환된 예시를 찾는 비용보다 Collector를 직접 쓰는 것이 더 빠르다고 판단했습니다

Front Collector(Deployment, 1~2 replica)가 Spring Boot에서 OTLP를 수신하고, 시그널별로 파이프라인을 분기합니다 — 메트릭은 `prometheusremotewrite`로 Mimir에 직행하고, 로그·트레이스는 `kafkaexporter`로 Kafka 토픽에 발행됩니다 Back Collector가 Kafka consumer로 로그를 Loki에, 트레이스를 Tempo에 전달합니다 메트릭을 Kafka를 거치지 않고 직접 Mimir로 보내는 이유는 알림 지연이 30초 이내여야 하기 때문입니다 — Kafka 버퍼를 넣으면 그 이상 지연이 발생합니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [Alloy에서 OTel Collector로 — 수집기 전환 결정](/essays/goti-adr-alloy-to-otel-collector)에 정리했습니다

---

## 📚 핵심 정리

- OTel Collector는 receiver(수신) → processor 체인(변환·흐름 제어) → exporter(전송) 3단 구조로, 각 컴포넌트를 YAML에서 독립 선언하고 파이프라인에서 조합합니다
- `memory_limiter` Processor는 체인의 1번째로 놓아야 합니다 — 나중에 놓으면 OOM 방지 효과가 없습니다
- `batch` Processor는 memory_limiter 뒤에 위치해 묶음 전송으로 백엔드 요청 수를 줄이고 처리량을 높입니다
- 시그널별(metrics/logs/traces) 파이프라인은 완전 격리 실행됩니다 — 한 시그널의 backpressure가 다른 시그널에 전파되지 않습니다
- ocb 경량 커스텀 빌드로 필요한 컴포넌트만 포함한 바이너리를 만들 수 있습니다 — 크기 절감과 공격 표면 축소 두 가지를 얻습니다
