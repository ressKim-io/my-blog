---
title: "Grafana Tempo — 분산 트레이싱 저장·Exemplar·metrics_generator 동작 원리"
excerpt: "Grafana Tempo가 분산 트레이스를 Object Storage에 저장하는 구조, Exemplar로 메트릭 스파이크에서 trace까지 드릴다운하는 방법, metrics_generator가 span에서 RED 메트릭과 서비스맵을 자동 생성하는 원리를 설명합니다"
category: monitoring
tags:
  - go-ti
  - tempo
  - distributed-tracing
  - exemplar
  - metrics_generator
  - TraceQL
  - concept
series:
  name: "goti-deepdive-observability"
  order: 4
date: "2026-03-27"
---

## 한 줄 요약

> Grafana Tempo는 분산 트레이스를 Object Storage에 저장하는 백엔드로, Exemplar로 메트릭→trace 드릴다운을 연결하고 metrics_generator로 span 스트림에서 RED 메트릭과 서비스맵을 자동 생성합니다

---

## 🤔 무엇을 푸는 기술인가

MSA 환경에서 하나의 HTTP 요청은 여러 서비스를 거쳐 완료됩니다 각 서비스가 독립적으로 로그를 남겨도, "어느 서비스에서 얼마나 걸렸는지"를 한 화면에서 보기 어렵습니다 이 문제를 해결하는 것이 **분산 트레이싱(distributed tracing)**입니다

분산 트레이싱의 핵심 개념은 두 가지입니다

- **span**: 단일 서비스 내 작업 단위 — 시작 시각, 종료 시각, 서비스명, 에러 여부 등을 담습니다
- **trace**: 한 요청이 생성하는 span들의 집합 — 모든 span은 동일한 `trace_id`를 공유합니다

클라이언트가 서비스 A를 호출하면 `trace_id`가 생성됩니다 서비스 A가 서비스 B를 호출할 때 HTTP 헤더(`traceparent`)에 `trace_id`를 실어 보냅니다 서비스 B는 같은 `trace_id`로 자신의 span을 기록합니다 이렇게 전파된 span들을 `trace_id` 기준으로 모으면 전체 호출 경로가 완성됩니다

전통적인 트레이싱 백엔드(Jaeger, Zipkin)는 Elasticsearch나 Cassandra 같은 별도 스토리지를 운영해야 합니다 **Grafana Tempo**는 다른 선택을 합니다 — S3·Minio 같은 Object Storage를 직접 사용합니다 Trace 데이터는 특성상 "쓰고 → 가끔 읽는" 패턴이라 Object Storage가 잘 맞습니다 스토리지 운영 부담을 줄이면서 대용량 trace를 저렴하게 보관할 수 있습니다

---

## 🔧 동작 원리

### trace 저장 파이프라인

Tempo의 내부 구조는 Mimir와 유사한 컴포넌트 분리 설계를 따릅니다

**Distributor**가 OTLP gRPC(4317)로 span 스트림을 수신합니다 수신된 span은 `trace_id` 기준으로 해시 링에 의해 여러 Ingester에 분배됩니다 모든 span이 같은 `trace_id`를 가진다면, 하나의 trace를 구성하는 span들은 같은 Ingester 샤드에 모입니다

**Ingester**는 수신한 span을 메모리 내 WAL(Write-Ahead Log)에 먼저 씁니다 일정 시간 또는 블록 크기에 도달하면 span 집합을 **Parquet 포맷으로 직렬화**해 Object Storage에 플러시합니다 Parquet는 컬럼 지향 포맷이라 `trace_id`·`service.name`·`duration` 같은 필드 기반 필터링이 빠릅니다

**Querier**는 쿼리 시 두 경로를 병합합니다 — Ingester 메모리(최신 데이터)와 Object Storage 블록(오래된 데이터)를 합쳐 결과를 반환합니다

### Exemplar — 메트릭에서 trace로

Exemplar는 Prometheus 메트릭 데이터점에 `trace_id`를 첨부하는 메커니즘입니다 OpenMetrics 표준에 정의되어 있습니다

```text
# 일반 메트릭 데이터점
http_request_duration_seconds_bucket{le="0.5"} 24054

# Exemplar가 붙은 데이터점
http_request_duration_seconds_bucket{le="0.5"} 24054 # {traceID="abc123ef"} 0.48 1711500000
```

Exemplar가 붙은 데이터점은 Grafana 패널에서 **다이아몬드 형태의 점(◆)**으로 표시됩니다 이 점을 클릭하면 Grafana가 `traceID` 값으로 Tempo datasource를 자동 쿼리합니다 메트릭 그래프에서 레이턴시 스파이크를 발견하고 클릭 한 번으로 해당 trace의 워터폴 뷰로 이동할 수 있습니다

![3-Signal 상관 드릴다운 흐름 — Exemplar 클릭 → Tempo → Loki|tall](/diagrams/goti-deepdive-tempo-tracing-1.svg)

위 다이어그램은 Exemplar를 매개로 한 3-signal 상관 드릴다운의 전체 흐름입니다

첫 번째 단계는 Grafana의 메트릭 패널입니다 PromQL로 레이턴시 히스토그램을 시각화하면, 특정 구간에 Exemplar 점이 표시됩니다 이 점에는 해당 시점에 처리된 요청 중 하나의 `trace_id`가 내장되어 있습니다 Exemplar는 OTel SDK 계측 코드에서 `trace_id`를 메트릭에 첨부하거나, Alloy 파이프라인에서 span 수신 시 관련 메트릭에 자동 주입하는 방식으로 생성됩니다

두 번째 단계는 Tempo의 trace 워터폴 뷰입니다 `trace_id`로 쿼리된 trace는 span들의 시간축 배치로 표현됩니다 각 span은 서비스명·작업명·소요 시간을 보여줍니다 가장 오른쪽으로 뻗어 나온 span이 병목 구간입니다 위 다이어그램에서 `DB query 21ms`가 rose 색상으로 강조된 것이 병목 span 예시입니다

세 번째 단계는 Loki 로그 드릴다운입니다 Tempo의 span 상세 화면에서 `trace_id`를 Loki LogQL 쿼리로 연동할 수 있습니다 `{trace_id="abc123"}` 필터로 해당 요청이 각 서비스를 통과하면서 남긴 로그만 추출합니다 코드 수준에서 무슨 일이 있었는지 확인하는 마지막 단계입니다

이 3단계 드릴다운은 모두 단일 Grafana UI 안에서 이루어집니다 Jaeger나 Zipkin에는 Exemplar 개념이 없어 메트릭→trace 연결을 만들기 어렵습니다

### metrics_generator — span에서 메트릭 자동 생성

Tempo의 `metrics_generator`는 span 스트림을 처리해 **직접 계측 없이** 두 종류의 메트릭을 생성합니다

![Tempo metrics_generator 동작 구조도|tall](/diagrams/goti-deepdive-tempo-tracing-2.svg)

위 다이어그램은 metrics_generator의 내부 구조입니다 Distributor가 span을 수신하는 순간, 두 경로가 동시에 시작됩니다 한 경로는 Ingester를 거쳐 Object Storage에 trace를 저장하는 정규 경로이고, 다른 경로는 metrics_generator가 같은 span 스트림을 소비하는 병렬 경로입니다

metrics_generator 내부에는 두 개의 독립 프로세서가 있습니다

**spanmetrics 프로세서**는 각 span의 소요 시간을 히스토그램 버킷으로 집계합니다 `span.name`(작업명)·`span.status`·`resource.service.name`을 레이블로 삼아 아래 메트릭군을 생성합니다

```text
traces_spanmetrics_latency_bucket{service="ticketing-svc", span_name="POST /tickets", le="0.1"} 42
traces_spanmetrics_latency_count{service="ticketing-svc", span_name="POST /tickets"}        50
traces_spanmetrics_calls_total{service="ticketing-svc", span_name="POST /tickets"}          50
```

이 메트릭들은 **RED 메트릭(Rate·Errors·Duration)**의 완전한 구현입니다 `traces_spanmetrics_calls_total`은 Rate와 Error를 집계하고, `traces_spanmetrics_latency_bucket`은 Duration을 히스토그램으로 제공합니다 별도 메트릭 계측 코드 없이 span 데이터만으로 서비스 성능 대시보드를 구성할 수 있습니다

**service_graphs 프로세서**는 parent span과 child span의 관계를 파악합니다 span에는 `parent_span_id` 필드가 있습니다 이 필드를 따라 호출 방향(edge)을 추출하면 서비스 간 호출 그래프가 만들어집니다

```text
traces_service_graph_request_total{
  client="goti-gateway", server="ticketing-svc"
} 120
traces_service_graph_request_failed_total{
  client="ticketing-svc", server="postgres"
} 3
```

이 메트릭을 Grafana의 Node Graph 패널로 시각화하면 MSA 서비스맵이 됩니다 특정 서비스 간 연결선의 굵기·색상으로 트래픽 볼륨과 에러율을 한눈에 파악할 수 있습니다

두 프로세서가 생성한 메트릭은 Prometheus `remote_write` 프로토콜로 Mimir에 저장됩니다 Mimir에 저장된 이후에는 일반 PromQL 메트릭과 동일하게 쿼리하고 알림 규칙을 걸 수 있습니다

### tail sampling — 스파이크 내성 확보

Tempo는 **tail sampling**을 지원합니다 일반적인 head sampling은 요청 시작 시점에 "수집할지 여부"를 결정합니다 이 방식은 에러가 발생한 요청도 미리 제외될 수 있습니다

tail sampling은 trace가 완전히 완료된 **이후** 샘플링 여부를 결정합니다 에러가 포함된 trace, 느린 trace(latency > 임계값)는 100% 보존하고 정상 trace는 무작위 N%만 보관하는 정책을 적용할 수 있습니다 에러·이상 케이스를 놓치지 않으면서 전체 저장량을 줄이는 실용적인 전략입니다

tail sampling은 Alloy의 `otelcol.processor.tail_sampling` 컴포넌트에서 처리됩니다 span이 Tempo에 도달하기 전에 Alloy에서 필터링이 완료됩니다

### TraceQL — 구조적 쿼리 언어

Jaeger와 Zipkin은 trace를 검색할 때 태그 키-값 조합만 지원합니다 Tempo는 **TraceQL**이라는 구조적 쿼리 언어를 제공합니다

```text
# 에러가 발생한 ticketing-svc span 중 100ms 이상
{resource.service.name="ticketing-svc" && status=error && duration>100ms}

# 결제 실패 trace 중 전체 trace 소요가 2초 이상
{span.http.status_code=500 && resource.service.name="payment-svc"} | duration > 2s

# 특정 사용자 ID를 포함한 trace
{span.user_id="12345"}
```

파이프(`|`) 뒤에 aggregate 조건을 붙이면 span 단위 필터와 trace 단위 조건을 결합할 수 있습니다 복잡한 장애 상황에서 원하는 trace를 빠르게 좁혀 가는 데 유용합니다

---

## 📐 세부 동작과 옵션

### Object Storage 블록 구조

Tempo가 Object Storage에 쓰는 블록은 두 종류입니다

| 블록 유형 | 위치 | 내용 |
|---|---|---|
| WAL 블록 | Ingester 로컬 디스크 | 최신 span 버퍼, 재시작 복구용 |
| Parquet 블록 | Object Storage | 압축·색인된 trace 집합 |

Parquet 블록은 `trace_id`·`start_time`·`duration` 등 핵심 컬럼에 별도 인덱스를 포함합니다 TraceQL 쿼리가 들어오면 Querier는 인덱스만 먼저 스캔해 관련 블록을 특정하고, 필요한 컬럼만 읽습니다

### metrics_generator 설정 핵심 파라미터

```yaml
metricsGenerator:
  enabled: true
  config:
    processor:
      spanMetrics:
        dimensions:
          - http.method
          - http.status_code
      serviceGraphs:
        dimensions:
          - http.method
    storage:
      remoteWrite:
        - url: http://mimir-distributor:8080/api/v1/push
```

`dimensions` 목록을 늘리면 메트릭 카디널리티가 증가합니다 초기에는 최소한으로 시작하고 필요에 따라 추가하는 것이 좋습니다

### Tempo 설정에서 자주 발생하는 혼동

Helm chart v1.x의 `overrides` 설정 경로가 버전별로 달라 CrashLoopBackOff가 발생하는 경우가 있습니다

```yaml
# legacyConfig=true 구조 (구 버전)
config:
  overrides: |
    overrides:
      defaults:
        metrics_generator:
          processors: ["spanmetrics"]

# legacyConfig=false 구조 (신 버전)
overrides:
  defaults:
    metrics_generator:
      processors: ["spanmetrics", "service-graphs"]
```

`legacyConfig` 설정과 `overrides` 경로가 맞지 않으면 Tempo Compactor가 YAML 파싱 에러로 기동하지 않습니다

---

## 🧩 go-ti에서는

go-ti 관측성 스택에서 Tempo는 트레이싱 백엔드 역할을 맡았습니다 Alloy가 tail sampling(에러·슬로우 trace 100% + 정상 10%)을 적용한 뒤 Kafka `otlp_spans` 토픽으로 span을 버퍼링합니다 Alloy Gateway가 Kafka에서 span을 소비해 Tempo로 전달합니다 5,000 VU 부하테스트에서 Kafka 버퍼 없이 Alloy→Tempo 직접 전송했을 때 Tempo가 OOMKilled됐고, Kafka 버퍼 도입 이후 안정화됐습니다

`metrics_generator`의 `service_graphs` 프로세서로 user·ticketing·payment·resale·stadium 5개 서비스 간 호출 그래프를 자동 생성했습니다 별도 계측 코드 없이 Grafana 서비스맵 패널에서 MSA 전체 의존관계와 에러율을 확인할 수 있었습니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [관측성 스택 선택 — Grafana LGTM+ 스택을 택한 이유](/logs/goti-observability-stack-selection)에 정리했습니다

---

## 📚 핵심 정리

- Tempo는 Object Storage(S3/Minio)를 유일한 백엔드로 사용합니다 Elasticsearch/Cassandra 없이도 분산 트레이싱 백엔드를 운영할 수 있습니다
- Exemplar는 메트릭 데이터점에 `trace_id`를 첨부하는 표준 포맷입니다 Grafana에서 메트릭 스파이크 → Exemplar 클릭 → Tempo trace → Loki 로그까지 드릴다운이 단일 UI에서 이루어집니다
- `metrics_generator`의 `spanmetrics` 프로세서가 span에서 RED 메트릭(Rate·Errors·Duration)을 생성하고, `service_graphs` 프로세서가 MSA 서비스 간 호출 그래프를 만듭니다 별도 메트릭 계측 없이 서비스 성능 대시보드를 구성할 수 있습니다
- tail sampling은 trace 완료 후 에러·슬로우 케이스를 100% 보존하고 정상 trace는 일부만 보관하는 전략입니다 대용량 부하 환경에서 Tempo OOM을 방지하는 핵심 설정입니다
- TraceQL은 span 속성과 trace 전체 조건을 결합한 구조적 쿼리를 지원합니다 Jaeger/Zipkin의 단순 태그 검색보다 복잡한 장애 시나리오를 빠르게 좁힐 수 있습니다
