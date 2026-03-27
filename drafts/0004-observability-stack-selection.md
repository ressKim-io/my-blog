# 관측성 스택 선택 아키텍처 결정 (ADR)

작성일: 2026-03-27
상태: Accepted
프로젝트: Goti (대규모 티켓팅 서비스)

---

## Decision Summary

| 결정 항목 | 선택 | 대안 | 핵심 근거 |
|-----------|------|------|-----------|
| 메트릭 백엔드 | **Mimir (분산)** | Prometheus 단독, Thanos | 수평 확장, HA, Kafka Ingest 재활용 |
| 로그 백엔드 | **Loki (OTLP native)** | ELK, Splunk | 비용, Grafana 통합, OTel 네이티브 |
| 트레이싱 백엔드 | **Tempo + tail sampling** | Jaeger, Zipkin | Exemplar 연동, Grafana 통합, 스파이크 내성 |
| 수집 에이전트 | **Alloy (Agent + Gateway)** | OTel Collector, Fluent Bit | River 설정, Grafana 생태계, Kafka 지원 |
| 메트릭 연산/CRD | **kube-prometheus-stack (Prometheus 비활성화)** | 단독 Operator, 수동 scrape | ServiceMonitor CRD 표준, rule 관리 |
| 텔레메트리 버퍼 | **Kafka (로그+트레이스만)** | 전체 Kafka, 버퍼 없음 | 시그널별 특성에 맞춘 선택적 버퍼링 |

---

## 1. 배경 (Context)

### 관측성 요구사항

Goti는 대규모 티켓팅 서비스다. 티켓 오픈 시 수천~수만 동시 접속이 발생하고, 이 순간의 시스템 상태를 **메트릭·로그·트레이스** 세 축으로 실시간 파악해야 한다.

| 요구사항 | 설명 |
|----------|------|
| 메트릭-트레이스 연결 | 레이턴시 스파이크 → 해당 trace로 드릴다운 (Exemplar) |
| MSA 5서비스 통합 뷰 | user, ticketing, payment, resale, stadium 전체 서비스 맵 |
| 스파이크 내성 | 5,000 VU 부하테스트에서 관측 파이프라인이 죽지 않아야 |
| 비용 효율 | 학습 프로젝트이므로 라이선스 비용 0, 인프라 비용 최소화 |
| GitOps 통합 | ArgoCD로 관측성 스택도 선언적 관리 |

### 기존 상태 (전환 전)

EC2 docker-compose 환경에서 Prometheus + Grafana + Loki를 단독 운영. Kind 전환 시 다음 한계에 직면:

- Prometheus 단독: 단일 Pod, 디스크 장애 시 메트릭 유실, 수평 확장 불가
- Loki JSON 수집: OTel semantic convention 미적용, 로그-트레이스 상관관계 없음
- 트레이싱 없음: 분산 트레이싱 자체가 미구축
- 에이전트 파편화: Prometheus scrape + Promtail + 별도 수집기 → 3개 데몬셋

---

## 2. 요구사항

| 요구사항 | 설명 | 중요도 |
|----------|------|--------|
| 3-signal 상관관계 | 메트릭 → Exemplar → 트레이스, 로그 → trace_id → 트레이스 | 필수 |
| OTel 네이티브 | OpenTelemetry semantic convention 기반 (벤더 중립) | 필수 |
| 수평 확장 가능 | Kind dev에서 EKS prod로 전환 시 스케일업 가능 | 필수 |
| 단일 대시보드 | Grafana에서 메트릭/로그/트레이스 한 화면에 | 필수 |
| 스파이크 흡수 | 부하테스트 5,000+ VU에서 관측 파이프라인 안정 | 중요 |
| GitOps 관리 | Helm chart + ArgoCD sync-wave로 배포 순서 제어 | 중요 |
| 라이선스 비용 0 | 오픈소스만 사용 | 선택 |

---

## 3. 대안 비교

### 3.1 메트릭 백엔드: Prometheus vs Mimir vs Thanos

| 항목 | Prometheus 단독 | Thanos | **Mimir** |
|------|----------------|--------|-----------|
| 아키텍처 | 단일 Pod | Sidecar + Compactor + Query + Store | Distributor + Ingester + Querier + Store-Gateway |
| 수평 확장 | 불가 (vertical only) | 가능 (Sidecar 기반) | **가능 (컴포넌트별 독립 스케일)** |
| HA | 불가 (단일 장애점) | Replica + Dedup | **Ingester replication (N=3)** |
| 장기 스토리지 | 로컬 디스크 (2주 기본) | Object Storage (S3) | **Object Storage (S3/Minio)** |
| PromQL 호환 | 네이티브 | 100% | **100%** |
| 멀티테넌시 | 없음 | 제한적 | **네이티브 (X-Scope-OrgID)** |
| Kafka Ingest | 없음 | 없음 | **내장 (Ingest Storage)** |
| 운영 복잡도 | 낮음 | 중간 (Sidecar + Store 관리) | 높음 (분산 컴포넌트 관리) |
| Grafana 통합 | 좋음 | 좋음 | **최고 (같은 회사)** |

**선택: Mimir**
- Kafka Ingest Storage가 결정적 — Strimzi Kafka가 이미 비즈니스 이벤트용으로 배포되어 있어 추가 인프라 비용 0
- MSA 5서비스 → EKS 전환 시 Ingester/Querier를 독립 스케일할 수 있어야 함
- Thanos는 Sidecar 방식이라 Prometheus Pod가 전제 — Prometheus를 비활성화하고 Alloy로 대체하는 구조에서 Sidecar가 불필요

### 3.2 로그 백엔드: Loki vs ELK vs Splunk

| 항목 | ELK (Elasticsearch + Kibana) | Splunk | **Loki** |
|------|------------------------------|--------|----------|
| 인덱싱 방식 | 전문 인덱싱 (full-text) | 전문 인덱싱 | **레이블 인덱싱 (스트림 기반)** |
| 스토리지 비용 | 높음 (인덱스 ≈ 원본 크기) | 매우 높음 | **낮음 (인덱스 << 원본)** |
| 쿼리 언어 | KQL/Lucene | SPL | **LogQL (PromQL과 유사)** |
| OTel 네이티브 | Exporter 필요 | Exporter 필요 | **OTLP 엔드포인트 네이티브** |
| Grafana 통합 | 플러그인 | 플러그인 | **네이티브 datasource** |
| K8s 이벤트 수집 | Filebeat 필요 | Splunk Connect | **Alloy 내장 `loki.source.kubernetes_events`** |
| 라이선스 | 오픈소스 (Basic) / 유료 | 유료 | **오픈소스 (AGPLv3)** |
| 리소스 사용량 | 높음 (JVM 기반) | 높음 | **낮음 (Go 기반)** |

**선택: Loki**
- PromQL을 아는 사람이 LogQL도 바로 쓸 수 있음 — 학습 곡선 최소
- OTel native OTLP 엔드포인트로 `service_name`, `detected_level` 자동 인덱싱
- ELK는 3노드 최소 구성에 JVM 메모리만 수 GB — Kind 32GB 환경에서 비현실적
- Grafana에서 메트릭 → 로그 → 트레이스 드릴다운이 같은 UI에서 가능

### 3.3 트레이싱 백엔드: Tempo vs Jaeger vs Zipkin

| 항목 | Jaeger | Zipkin | **Tempo** |
|------|--------|--------|-----------|
| 스토리지 | Elasticsearch/Cassandra | Elasticsearch/MySQL | **Object Storage (S3/Minio)** |
| Exemplar 연동 | 없음 | 없음 | **네이티브 (메트릭 → trace_id 드릴다운)** |
| span → 메트릭 변환 | 없음 (별도 구축) | 없음 | **metrics_generator 내장** |
| Grafana 통합 | 플러그인 (별도 UI 병존) | 플러그인 (별도 UI 병존) | **네이티브 datasource (UI 통합)** |
| OTel 네이티브 | OTLP 지원 | OTLP 지원 | **OTLP 네이티브** |
| TraceQL | 없음 | 없음 | **있음 (구조적 쿼리 언어)** |
| 운영 복잡도 | 높음 (ES/Cassandra 의존) | 중간 | **낮음 (Object Storage만)** |
| 라이선스 | 오픈소스 | 오픈소스 | **오픈소스 (AGPLv3)** |

**선택: Tempo**
- **Exemplar가 결정적** — Grafana에서 레이턴시 그래프의 점(exemplar)을 클릭하면 해당 trace로 바로 이동. Jaeger/Zipkin에서는 불가능
- **metrics_generator**: span에서 자동으로 `traces_spanmetrics_latency_bucket` 메트릭 생성 → 별도 계측 없이 서비스맵 + RED 메트릭
- Object Storage 백엔드라 Elasticsearch/Cassandra 운영 부담 없음
- TraceQL로 `{resource.service.name="goti-server" && span.http.response.status_code >= 500}` 같은 구조적 쿼리 가능

### 3.4 수집 에이전트: Alloy vs OTel Collector vs Prometheus Agent

| 항목 | OTel Collector | Prometheus Agent | **Alloy** |
|------|---------------|-----------------|-----------|
| 설정 언어 | YAML | YAML | **River (동적 리로드)** |
| 메트릭 수집 | OTLP receiver + scraper | ServiceMonitor scrape | **prometheus.operator.servicemonitors** |
| 로그 수집 | filelog receiver | 없음 | **loki.source.kubernetes_events 내장** |
| 트레이스 수집 | OTLP receiver | 없음 | **OTLP receiver** |
| Kafka 지원 | exporter + receiver | 없음 | **otelcol.exporter.kafka + otelcol.receiver.kafka** |
| tail sampling | 있음 | 없음 | **otelcol.processor.tail_sampling** |
| 설정 리로드 | Pod 재시작 필요 | Pod 재시작 필요 | **런타임 리로드 (Pod 유지)** |
| Grafana 생태계 | 벤더 중립 | Prometheus 전용 | **Mimir/Loki/Tempo 최적화** |

**선택: Alloy**
- River 설정 언어로 런타임 리로드 가능 — ConfigMap 변경 시 Pod 재시작 없이 반영
- ServiceMonitor CRD 네이티브 지원 — kube-prometheus-stack의 Prometheus를 비활성화해도 ServiceMonitor 기반 scrape 가능
- Agent (DaemonSet) + Gateway (StatefulSet) 분리 아키텍처 — 수집과 변환/버퍼링을 독립 스케일

### 3.5 텔레메트리 버퍼: 시그널별 선택적 Kafka 버퍼링

| 시그널 | 직접 전송 | Kafka 버퍼 | **선택** |
|--------|----------|-----------|----------|
| 메트릭 | 실시간 (<30s), 알림 지연 불가 | 불필요한 레이턴시 추가 | **직접 전송** |
| 로그 | 버스트 시 유실 가능 | 스파이크 흡수 | **Kafka 버퍼** |
| 트레이스 | 대용량 payload → OOM 위험 | 배압 흡수 | **Kafka 버퍼** |

```
메트릭:  App → OTel Agent → Alloy scrape → 직접 remote_write → Mimir
로그:    App → OTel Agent → Alloy → Kafka(otlp_logs) → Alloy Gateway → Loki
트레이스: App → OTel Agent → Alloy(tail sampling) → Kafka(otlp_spans) → Alloy Gateway → Tempo
```

**핵심 근거:**
- 메트릭은 알림이 30초 이내에 발동해야 하므로 Kafka 레이턴시가 치명적
- 로그/트레이스는 2~24시간 지연 허용 가능하고, 부하테스트 5,000 VU에서 버스트가 심함
- Strimzi Kafka가 이미 배포되어 있으므로 토픽 추가만으로 구현 가능 (인프라 비용 0)
- **실제 사고**: Kafka 버퍼 없이 Alloy → Tempo 직접 전송 시 5,000 VU에서 Tempo OOMKilled 발생 → Kafka 버퍼 + tail sampling 10%로 해결

---

## 4. 결정 (Decision)

**Grafana LGTM+ 스택** (Loki + Grafana + Tempo + Mimir + Alloy)을 선택한다.

### 전체 아키텍처

```
                        ┌─────────────────────────────┐
                        │     Grafana (Dashboard)      │
                        │  Datasource: mimir, loki,    │
                        │  tempo, pyroscope            │
                        └──────┬──────┬──────┬─────────┘
                               │      │      │
                    ┌──────────┘      │      └──────────┐
                    ▼                 ▼                  ▼
                 Mimir            Loki              Tempo
              (메트릭)          (로그)           (트레이스)
                 ▲                ▲                  ▲
                 │                │                  │
            remote_write    Kafka consumer     Kafka consumer
                 │                │                  │
                 │           ┌────┘                  │
                 │           │    Alloy Gateway      │
                 │           │    (batch + export)    │
                 │           └────┐                  │
                 │                │                  │
                 │           Kafka topics            │
                 │        (otlp_logs, otlp_spans)    │
                 │                ▲                  │
                 │                │                  │
              Alloy Agent ───────┴──── tail sampling
              (DaemonSet)
                 ▲
                 │  OTLP gRPC (4317)
                 │
         ┌───────┴───────┐
         │  Application  │
         │  (OTel Agent) │
         └───────────────┘
```

### 왜 "전부 Grafana"인가

단일 벤더 잠금(lock-in) 우려가 있지만, 이 프로젝트에서는 장점이 압도적이다:

1. **Exemplar 체인**: Mimir exemplar → Tempo trace_id → Loki log correlation이 같은 회사 제품이라 가장 매끄럽게 동작
2. **쿼리 언어 통일**: PromQL(메트릭) + LogQL(로그) + TraceQL(트레이스) 모두 유사한 문법 → 학습 비용 1회
3. **ServiceMonitor → Alloy → 3 백엔드**: 단일 에이전트가 모든 시그널 수집 → DaemonSet 1개로 통합
4. **벤더 탈출 경로**: 모든 컴포넌트가 OTel 표준 지원 → OTel Collector + Jaeger + Elasticsearch로 언제든 전환 가능 (데이터 포맷 잠금 없음)

### 트레이드오프 인정

- **운영 복잡도 높음**: Mimir 분산 + Kafka + Alloy Agent/Gateway + Tempo + Loki = 12+ Pod — Kind 32GB에서 빠듯
- **Alloy mimir.rules.kubernetes 버그**: 초기 로드 실패 시 전체 파이프라인 중단 → mimirtool CI/CD로 우회
- **Grafana 생태계 의존**: Alloy River 문법은 Grafana 전용 — OTel Collector YAML과 호환 안 됨
- **Tempo chart v1.x 문제**: legacyConfig 구조에서 `overrides.defaults` vs `per_tenant_overrides` 경로 혼동 → CrashLoopBackOff 유발 (트러블슈팅 2건)

---

## 5. 결과 (Consequences)

### 긍정적 영향

- **3-signal 상관관계 완성**: 메트릭 스파이크 → Exemplar 클릭 → Tempo trace → Loki log 한 화면에서 드릴다운
- **5,000 VU 부하테스트 안정**: Kafka 버퍼 + tail sampling 10%로 Tempo OOMKilled 해결
- **MSA 5서비스 서비스맵**: Tempo metrics_generator가 span에서 자동으로 서비스 간 호출 그래프 생성
- **GitOps 완전 통합**: ArgoCD sync-wave (kps → Mimir/Loki/Tempo → Alloy → Grafana) 순서 배포
- **비용 0**: 전체 오픈소스, Kafka는 비즈니스용 재활용

### 부정적 영향 / 리스크

- Kind dev에서 메모리 12-15GB 점유 (32GB 중 약 47%)
- 컴포넌트 간 버전 호환성 관리 필요 (version-matrix.md로 관리 중)
- Alloy River 문법 학습 곡선 (OTel Collector YAML 경험자에게도 새로움)
- Mimir Kafka Ingest의 `producer_max_record_size_bytes` 15.2MB 하드 리밋 존재

### 향후 과제

- EKS 전환 시 Object Storage를 Minio → S3로 전환
- Mimir 멀티테넌시 활성화 (MSA 서비스별 격리)
- Alloy mimir.rules.kubernetes 버그 해결 시 mimirtool CI/CD → Alloy 내장으로 복귀
- Pyroscope continuous profiling 활성화 (현재 메트릭만 수집 중)

---

## 6. 참고 자료

- [Tempo OOM + Kafka 버퍼 + tail sampling](../dev-logs/2026-03-25-tempo-oom-kafka-buffer-sampling.md)
- [Alloy-Mimir rules 중복 메트릭 버그](../dev-logs/2026-03-13-alloy-mimir-rules-duplicate-metrics.md)
- [Kafka-buffered OTel 파이프라인 설계](../dev-logs/2026-03-14-kafka-buffered-otel-pipeline.md)
- [Loki OTLP native 전환](../dev-logs/2026-03-13-loki-otlp-native-migration.md)
- [Tempo chart legacyConfig 파싱 에러](../dev-logs/2026-03-24-tempo-overrides-legacyconfig-parsing-error.md)
- [모니터링 대시보드 No Data 5건 종합](../dev-logs/2026-03-09-monitoring-dashboard-nodata-comprehensive.md)
- [Tempo spanmetrics batch timeout](../dev-logs/2026-03-26-tempo-spanmetrics-batch-timeout-ingestion-slack.md)
