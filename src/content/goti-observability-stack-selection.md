---
title: "관측성 스택 선택기 — Grafana LGTM+를 고른 이유"
excerpt: "메트릭·로그·트레이스 백엔드부터 수집 에이전트, Kafka 버퍼링 전략까지 — 티켓팅 서비스의 관측성 아키텍처를 설계하며 내린 6가지 결정을 정리합니다"
category: monitoring
tags:
  - go-ti
  - Grafana
  - Mimir
  - Loki
  - Tempo
  - Alloy
  - OpenTelemetry
  - Kafka
  - Prometheus
  - Architecture Decision Record
  - adr
series:
  name: "goti-observability-stack"
  order: 1
date: "2026-02-04"
---

## 한 줄 요약

> Mimir(메트릭) + Loki(로그) + Tempo(트레이스) + Alloy(수집) + Kafka(버퍼) — Grafana LGTM+ 스택을 선택했습니다. 6가지 결정의 근거와 트레이드오프를 정리합니다

---

## 🔥 배경: 왜 관측성 스택을 새로 구축했나

Goti는 대규모 티켓팅 서비스입니다.
티켓 오픈 시 수천~수만 동시 접속이 발생하고, 이 순간의 시스템 상태를 **메트릭·로그·트레이스** 세 축으로 실시간 파악해야 합니다.

### 기존 상태

EC2 docker-compose 환경에서 Prometheus + Grafana + Loki를 단독 운영하고 있었습니다.
Kind 클러스터로 전환하면서 한계가 드러났습니다.

- **Prometheus 단독**: 단일 Pod, 디스크 장애 시 메트릭 유실, 수평 확장 불가
- **Loki JSON 수집**: OTel semantic convention 미적용, 로그-트레이스 상관관계 없음
- **트레이싱 없음**: 분산 트레이싱 자체가 미구축
- **에이전트 파편화**: Prometheus scrape + Promtail + 별도 수집기 → DaemonSet 3개

가장 큰 문제는 **3-signal 상관관계가 없다**는 것이었습니다.
레이턴시 스파이크가 보여도 "어떤 요청이 느렸는지" 확인하려면 로그를 수동으로 검색해야 했습니다.

### 목표

| 요구사항 | 설명 | 중요도 |
|----------|------|--------|
| 3-signal 상관관계 | 메트릭 → Exemplar → 트레이스, 로그 → trace_id → 트레이스 | 필수 |
| OTel 네이티브 | OpenTelemetry semantic convention 기반 | 필수 |
| 수평 확장 | Kind dev에서 EKS prod로 전환 시 스케일업 가능 | 필수 |
| 스파이크 흡수 | 5,000+ VU 부하테스트에서 파이프라인 안정 | 중요 |
| 비용 0 | 오픈소스만 사용 | 선택 |

이 요구사항을 만족하려면 백엔드 3개, 수집 에이전트 1개, 버퍼링 전략까지 — 총 6가지 결정을 내려야 했습니다.

---

## 🤔 결정 1: 메트릭 백엔드 — Mimir

### 대안 비교

| 항목 | Prometheus 단독 | Thanos | **Mimir** |
|------|----------------|--------|-----------|
| 수평 확장 | 불가 (vertical only) | Sidecar 기반 확장 | **컴포넌트별 독립 스케일** |
| HA | 단일 장애점 | Replica + Dedup | **Ingester replication** |
| 장기 스토리지 | 로컬 디스크 (2주) | Object Storage | **Object Storage** |
| 멀티테넌시 | 없음 | 제한적 | **네이티브 (X-Scope-OrgID)** |
| Kafka Ingest | 없음 | 없음 | **내장** |
| Grafana 통합 | 좋음 | 좋음 | **최고 (같은 회사)** |

Thanos와 Mimir의 차이를 좀 더 자세히 살펴보겠습니다.

**Thanos**는 기존 Prometheus에 Sidecar를 붙이는 방식입니다.
Prometheus Pod가 전제되고, Sidecar가 TSDB 블록을 Object Storage에 업로드합니다.
이미 Prometheus를 운영 중인데 장기 스토리지와 글로벌 뷰만 추가하고 싶다면 좋은 선택입니다.

**Mimir**는 처음부터 분산 TSDB로 설계됐습니다.
Distributor → Ingester → Store-Gateway → Querier로 컴포넌트가 분리되어 있고, 각각 독립적으로 스케일할 수 있습니다.
Grafana Cloud의 메트릭 백엔드가 바로 Mimir입니다.

### 선택 근거

Mimir를 선택한 결정적 이유는 **Kafka Ingest Storage**입니다.

Mimir 2.12부터 도입된 이 기능은 Distributor → Ingester 사이에 Kafka를 넣어서, Ingester가 재시작되거나 느려져도 데이터가 유실되지 않게 합니다.
Strimzi Kafka가 이미 비즈니스 이벤트용으로 배포되어 있었기 때문에 **토픽 추가만으로 구현 가능**했습니다.

추가로, Prometheus를 비활성화하고 Alloy로 대체하는 구조를 계획하고 있었는데, Thanos의 Sidecar 방식은 Prometheus Pod가 필수라서 이 구조에 맞지 않았습니다.

---

## 🤔 결정 2: 로그 백엔드 — Loki

### 대안 비교

| 항목 | ELK | Splunk | **Loki** |
|------|-----|--------|----------|
| 인덱싱 | 전문 인덱싱 (full-text) | 전문 인덱싱 | **레이블 인덱싱** |
| 스토리지 비용 | 높음 (인덱스 ≈ 원본) | 매우 높음 | **낮음 (인덱스 훨씬 작음)** |
| 쿼리 언어 | KQL/Lucene | SPL | **LogQL (PromQL과 유사)** |
| OTel 네이티브 | Exporter 필요 | Exporter 필요 | **OTLP 엔드포인트 네이티브** |
| 리소스 | 높음 (JVM) | 높음 | **낮음 (Go)** |
| 라이선스 | 오픈소스/유료 | 유료 | **오픈소스 (AGPLv3)** |

Loki의 인덱싱 방식이 핵심 차별점입니다.

ELK는 로그 내용 전체를 인덱싱합니다.
검색은 빠르지만, 인덱스 크기가 원본 데이터와 비슷해서 **스토리지 비용이 2배**에 가깝습니다.
게다가 Elasticsearch는 JVM 기반이라 3노드 최소 구성에 메모리만 수 GB가 필요합니다.
Kind 32GB 환경에서는 비현실적입니다.

Loki는 **레이블만 인덱싱**하고 로그 내용은 압축해서 Object Storage에 저장합니다.
검색 시 레이블로 스트림을 좁힌 뒤 로그 내용을 grep하는 방식입니다.
전문 검색보다 느리지만, 스토리지 비용이 극적으로 낮습니다.

그리고 PromQL을 아는 사람이라면 LogQL도 바로 쓸 수 있습니다.
`rate({job="goti-server"} |= "error" [5m])`처럼 메트릭 쿼리와 거의 같은 문법입니다.

---

## 🤔 결정 3: 트레이싱 백엔드 — Tempo

### 대안 비교

| 항목 | Jaeger | Zipkin | **Tempo** |
|------|--------|--------|-----------|
| 스토리지 | Elasticsearch/Cassandra | Elasticsearch/MySQL | **Object Storage** |
| Exemplar 연동 | 없음 | 없음 | **네이티브** |
| span → 메트릭 | 별도 구축 필요 | 없음 | **metrics_generator 내장** |
| TraceQL | 없음 | 없음 | **있음** |
| 운영 복잡도 | 높음 (ES/Cassandra) | 중간 | **낮음 (Object Storage만)** |

### Exemplar: 메트릭에서 트레이스로의 다리

Tempo를 선택한 결정적 이유는 **Exemplar**입니다.

Exemplar가 무엇인지 설명하면, 메트릭 데이터 포인트에 **trace_id를 첨부**하는 기능입니다.
OTel SDK가 메트릭과 트레이스를 동시에 수집하면, 히스토그램에 자동으로 현재 span의 trace_id가 붙습니다.

Grafana에서 이렇게 동작합니다:

1. 레이턴시 그래프를 보고 있는데 스파이크가 보입니다
2. 스파이크 지점에 작은 **다이아몬드 점**(exemplar)이 찍혀 있습니다
3. 점을 클릭하면 trace_id를 읽어서 **Tempo 트레이스 뷰로 바로 이동**
4. 어떤 서비스의 어떤 호출이 느렸는지 즉시 확인 가능

Jaeger나 Zipkin에서는 이게 불가능합니다.
메트릭 대시보드와 트레이싱 UI가 별도 애플리케이션이라 trace_id를 수동으로 복사해야 합니다.

주의할 점이 있습니다.
Exemplar의 trace_id가 가리키는 트레이스가 **샘플링으로 버려졌을 수 있습니다**.
tail sampling으로 10%만 저장하면, exemplar를 클릭했을 때 "trace not found"가 나올 수 있습니다.
이건 트레이드오프로 인정하고, 중요 경로는 always-on sampling을 적용하는 것으로 대응했습니다.

### metrics_generator: 계측 없이 RED 메트릭

Tempo의 또 다른 강점은 **metrics_generator**입니다.
수집된 span에서 자동으로 RED(Rate/Error/Duration) 메트릭을 생성합니다.

```yaml
metrics_generator:
  processor:
    span_metrics:
      dimensions: [service.name, http.method, http.status_code]
    service_graphs:
      enabled: true  # 서비스 간 호출 그래프
  remote_write:
    - url: http://mimir:9009/api/v1/push
```

이렇게 설정하면 `traces_spanmetrics_latency_bucket`, `traces_service_graph_request_total` 같은 메트릭이 Mimir에 자동 저장됩니다.
별도의 애플리케이션 계측 없이 서비스맵과 RED 대시보드를 만들 수 있습니다.

단, tail sampling을 사용하면 metrics_generator는 **샘플링된 span만** 봅니다.
정확한 RED 메트릭이 필요하면 sampling 전에 OTel Collector의 spanmetrics connector를 사용하는 것이 맞습니다.
이 프로젝트에서는 dev 환경이라 metrics_generator로 충분했습니다.

---

## 🤔 결정 4: 수집 에이전트 — Alloy

### 대안 비교

| 항목 | OTel Collector | Prometheus Agent | **Alloy** |
|------|---------------|-----------------|-----------|
| 설정 언어 | YAML | YAML | **Alloy syntax (River)** |
| 메트릭 수집 | OTLP + scraper | ServiceMonitor | **ServiceMonitor 네이티브** |
| 로그 수집 | filelog receiver | 없음 | **K8s events 내장** |
| 트레이스 수집 | OTLP | 없음 | **OTLP** |
| Kafka 지원 | exporter + receiver | 없음 | **exporter + receiver** |
| 설정 리로드 | Pod 재시작 | Pod 재시작 | **런타임 리로드** |

Alloy는 Grafana Agent의 후속입니다.
OTel Collector의 컴포넌트를 내부적으로 사용하면서, Grafana 생태계에 최적화된 설정 언어와 기능을 제공합니다.

### 왜 OTel Collector가 아닌가

솔직히 말하면, OTel Collector가 **벤더 중립적이고 업계 표준**입니다.
Alloy를 선택하면 Grafana 생태계에 더 묶이는 건 사실입니다.

그럼에도 Alloy를 선택한 이유는 세 가지입니다.

**첫째, ServiceMonitor CRD 네이티브 지원.**
kube-prometheus-stack의 Prometheus를 비활성화해도 `prometheus.operator.servicemonitors` 컴포넌트가 ServiceMonitor CRD를 읽어서 scrape합니다.
OTel Collector에서는 이것을 하려면 Prometheus receiver를 설정하고 ServiceMonitor 변환 로직을 별도로 구현해야 합니다.

**둘째, Agent + Gateway 분리.**
Alloy는 DaemonSet(Agent)과 StatefulSet(Gateway)을 나눠서 배포할 수 있습니다.
Agent는 수집만, Gateway는 변환/버퍼링/전송만 담당합니다.
OTel Collector도 Agent + Gateway 패턴이 가능하지만, Alloy의 클러스터링 기능이 타겟 분배를 자동으로 처리해서 더 간편했습니다.

**셋째, 런타임 리로드.**
ConfigMap이 바뀌면 Pod 재시작 없이 설정이 반영됩니다.
관측성 파이프라인은 설정 변경이 잦은데, 매번 Pod를 재시작하면 수집 공백이 생깁니다.

**벤더 탈출 경로**도 확보했습니다.
Alloy의 `otelcol.*` 컴포넌트는 OTel Collector 컴포넌트를 래핑한 거라서, 필요하면 OTel Collector YAML로 변환할 수 있습니다.
데이터 포맷은 전부 OTLP 표준입니다.

---

## 🤔 결정 5: kube-prometheus-stack (Prometheus 비활성화)

이 결정은 좀 독특합니다.
kube-prometheus-stack을 설치하면서 **Prometheus를 비활성화**합니다.

왜냐하면 ServiceMonitor, PrometheusRule 같은 CRD와 Prometheus Operator가 필요하기 때문입니다.
Alloy가 이 CRD를 읽어서 scrape하고, rule은 Mimir가 평가합니다.
Prometheus 자체의 TSDB는 불필요하지만, **CRD 생태계**는 필수입니다.

```yaml
# kube-prometheus-stack values
prometheus:
  enabled: false  # Prometheus Pod 비활성화
prometheusOperator:
  enabled: true   # Operator + CRD는 유지
```

---

## 🤔 결정 6: Kafka 버퍼링 — 시그널별 선택적 적용

모든 텔레메트리를 Kafka에 넣을 필요는 없습니다.
시그널별 특성이 다르니까 **선택적으로** 적용했습니다.

| 시그널 | 전략 | 이유 |
|--------|------|------|
| 메트릭 | **직접 전송** | 알림이 30초 이내에 발동해야 — Kafka 레이턴시가 치명적 |
| 로그 | **Kafka 버퍼** | 2~24시간 지연 허용, 버스트 시 유실 방지 |
| 트레이스 | **Kafka 버퍼** | 대용량 payload, OOM 위험 — 배압 흡수 필수 |

```text
메트릭:  App → OTel SDK → Alloy scrape → remote_write → Mimir
로그:    App → OTel SDK → Alloy → Kafka(otlp_logs) → Alloy Gateway → Loki
트레이스: App → OTel SDK → Alloy(tail sampling) → Kafka(otlp_spans) → Alloy Gateway → Tempo
```

메트릭은 실시간성이 생명입니다.
Prometheus 알림이 30초 evaluation interval로 동작하는데, Kafka를 거치면 불필요한 레이턴시가 추가됩니다.
그래서 Alloy에서 Mimir로 직접 remote_write합니다.

로그와 트레이스는 다릅니다.
2시간 전 로그를 분석하는 것은 전혀 문제가 없습니다.
대신 부하테스트 5,000 VU에서 트레이스 payload가 급증하면 Tempo가 OOM으로 죽을 수 있습니다.

### 실제 사고: Tempo OOMKilled

Kafka 버퍼 없이 Alloy → Tempo 직접 전송 구조에서 5,000 VU 부하테스트를 돌렸더니 **Tempo가 OOMKilled**됐습니다.
CrashLoopBackOff가 85회까지 올라갔습니다.

Kafka 버퍼를 도입하고 tail sampling을 10%로 설정한 뒤에야 안정화됐습니다.
이 내용은 [시리즈 다음 글](/blog/goti-tempo-oom-kafka-buffer-sampling)에서 자세히 다룹니다.

---

## ✅ 최종 아키텍처

![관측성 스택 최종 아키텍처 — Grafana LGTM + Alloy + Kafka 버퍼](/diagrams/goti-observability-stack-selection-1.svg)

위에서부터 따라가보겠습니다.

**애플리케이션 레이어**: OTel Java Agent가 메트릭·로그·트레이스를 OTLP gRPC로 Alloy Agent에 전송합니다.
메트릭에는 자동으로 exemplar(trace_id)가 붙습니다.

**수집 레이어**: Alloy Agent(DaemonSet)가 노드별로 배포됩니다.
메트릭은 ServiceMonitor 기반으로 scrape하고, 로그/트레이스는 OTLP로 수신합니다.
트레이스는 tail sampling(10%)을 거쳐 Kafka로 전송합니다.

**버퍼 레이어**: Kafka가 로그와 트레이스의 버스트를 흡수합니다.
메트릭은 Kafka를 거치지 않고 Mimir로 직접 전송됩니다.

**스토리지 레이어**: Mimir(메트릭), Loki(로그), Tempo(트레이스)가 각각 Object Storage(Minio)에 데이터를 저장합니다.
Tempo의 metrics_generator가 span에서 RED 메트릭을 생성해 Mimir에 remote_write합니다.

**대시보드 레이어**: Grafana에서 3개 datasource를 연결합니다.
메트릭 그래프의 exemplar 점을 클릭하면 Tempo 트레이스로, 트레이스에서 로그로 드릴다운이 가능합니다.

---

## 🔍 왜 "전부 Grafana"인가

단일 벤더 잠금 우려가 당연히 있습니다.
그럼에도 이 프로젝트에서는 장점이 압도적이었습니다.

**Exemplar 체인이 가장 매끄럽습니다.**
Mimir exemplar → Tempo trace_id → Loki log correlation이 같은 회사 제품이라 한 번의 클릭으로 이어집니다.
Prometheus + Jaeger 조합에서는 trace_id를 복사-붙여넣기해야 합니다.

**쿼리 언어가 통일됩니다.**
PromQL(메트릭) + LogQL(로그) + TraceQL(트레이스) 모두 유사한 문법입니다.
`{service_name="goti-server"}` 같은 레이블 셀렉터가 세 쿼리 언어에서 동일하게 동작합니다.
학습 비용이 1회로 줄어듭니다.

**벤더 탈출 경로가 있습니다.**
모든 컴포넌트가 OTLP 표준을 지원합니다.
Alloy → OTel Collector, Mimir → Thanos, Tempo → Jaeger, Loki → ELK로 전환할 때 데이터 포맷 변환이 필요 없습니다.
잠금이 아니라 **생태계 활용**에 가깝습니다.

---

## ⚠️ 트레이드오프

모든 장점에는 대가가 있습니다.

**운영 복잡도가 높습니다.**
Mimir 분산 + Kafka + Alloy Agent/Gateway + Tempo + Loki = 12+ Pod.
Kind 32GB에서 메모리 12-15GB를 점유합니다 (약 47%).

**Alloy River 문법은 Grafana 전용입니다.**
OTel Collector YAML과 호환되지 않습니다.
다른 수집기로 전환하려면 설정을 다시 작성해야 합니다.

**Tempo chart의 legacyConfig 문제.**
v1.x chart에서 `overrides.defaults`와 `per_tenant_overrides` 경로 혼동으로 CrashLoopBackOff가 발생했습니다.
이건 시리즈 후속 글에서 다룹니다.

---

## 📊 결정 요약

| 결정 항목 | 선택 | 핵심 근거 |
|-----------|------|-----------|
| 메트릭 백엔드 | **Mimir** | 수평 확장, Kafka Ingest 재활용 |
| 로그 백엔드 | **Loki** | 비용, OTel 네이티브, LogQL |
| 트레이싱 백엔드 | **Tempo** | Exemplar 연동, metrics_generator |
| 수집 에이전트 | **Alloy** | ServiceMonitor CRD, 런타임 리로드 |
| 메트릭 연산/CRD | **kube-prometheus-stack** | CRD 생태계 (Prometheus 비활성화) |
| 텔레메트리 버퍼 | **Kafka (로그+트레이스만)** | 시그널별 특성에 맞춘 선택적 버퍼링 |

---

## 📚 참고 자료

- [Grafana Mimir Architecture](https://grafana.com/docs/mimir/latest/get-started/about-grafana-mimir-architecture/)
- [Mimir Ingest Storage (Kafka)](https://grafana.com/docs/mimir/latest/configure/about-ingest-storage/)
- [Tempo metrics-generator](https://grafana.com/docs/tempo/latest/metrics-generator/)
- [Grafana Exemplars](https://grafana.com/docs/grafana/latest/fundamentals/exemplars/)
- [Alloy Configuration Reference](https://grafana.com/docs/alloy/latest/reference/components/)
- [OTel Collector](https://opentelemetry.io/docs/collector/)

---

## 다음 글 예고

이 글에서는 스택 선택의 **근거**를 다뤘습니다.
다음 글부터는 실제 운영에서 만난 트러블슈팅을 다룹니다:
- Loki OTLP Native 전환 삽질기
- Tempo OOM + Kafka 버퍼 + tail sampling
- Mimir Ingester OOM + webhook 교착
- Tempo spanmetrics 유실 문제
