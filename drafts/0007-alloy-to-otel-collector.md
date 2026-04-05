# Alloy → OTel Collector 전환 (ADR)

작성일: 2026-03-29
상태: Accepted (2026-03-30)
프로젝트: Goti (대규모 티켓팅 서비스 — 30만 동시 접속 목표)

---

## Decision Summary

| 결정 항목 | 선택 | 대안 | 핵심 근거 |
|-----------|------|------|-----------|
| 텔레메트리 수집기 | **OTel Collector** | Alloy 유지 | 커뮤니티 자료 풍부, Kafka 연동 공식 지원, 벤더 중립 |
| 메트릭 저장소 배포 | **Mimir 분산 유지** | ~~Mimir 싱글바이너리~~ | `mimir-distributed` Helm chart에 SingleBinary 모드 없음 (Discussion #6211). SimpleScalable도 Mimir 3.0에서 제거됨 |
| 스파이크 버퍼링 | **Kafka (기존 클러스터 공유)** | 별도 큐 / Collector 내부 큐 | 30만 스파이크 시 logs/traces OOM 방지, 추가 인프라 비용 0 |

---

## 1. 배경 (Context)

### 현재 상태

```
Spring Boot (OTel SDK)
    │ OTLP
    ▼
Grafana Alloy (DaemonSet, v1.6.1)
    ├── Metrics → Mimir 분산 (7 Pod + Kafka + MinIO)
    ├── Logs   → Loki OTLP native (/otlp)
    └── Traces → Kafka (observability.traces.v1) → Alloy consumer → Tempo
```

### 문제점

1. **Mimir 분산 모드 유지**: 활성 시리즈 ~50만 수준에서 분산 모드가 과잉이나, 공식 Helm chart에 SingleBinary 모드가 없어 현상 유지 (Grafana Discussion #6211)

2. **Alloy 커뮤니티 자료 부족**: River 문법 전용, contrib 생태계 제한. Kafka 연동 시 공식 OTel Collector 문서 기반 정보 찾기 어려움

3. **스파이크 대응 불완전**: 현재 traces만 Kafka 버퍼 사용. logs는 Alloy → Loki 직접 전송이라 30만 스파이크 시 Loki OOM 위험

4. **벤더 종속**: Alloy의 `loki.process`, `prometheus.remote_write`, `mimir.rules.kubernetes` 등 Grafana 전용 블록에 의존

---

## 2. 요구사항

| 요구사항 | 설명 | 중요도 |
|----------|------|--------|
| 30만 동시 접속 스파이크 대응 | 초기 폭주 시 텔레메트리 유실 방지 | 필수 |
| monitoring Pod 수 절감 | 현재 ~17개 코어 Pod → 최소화 | 중요 |
| 커뮤니티 자료 접근성 | 팀원 학습/트러블슈팅 용이 | 중요 |
| 기존 대시보드/알림 유지 | 40개 대시보드, 4개 PrometheusRule, 3개 Loki 알림 | 필수 |
| Kind/EKS 양쪽 동작 | dev(Kind) 먼저, prod(EKS) 나중에 | 필수 |
| log_type 기반 보존 정책 유지 | payment 5년, audit 2년 법적 요구 | 필수 |

---

## 3. 대안 비교

### 수집기

| 항목 | Alloy 유지 | OTel Collector | Prometheus Agent + OTel |
|------|-----------|----------------|------------------------|
| Kafka exporter/receiver | Alloy 문법 (자료 적음) | **공식 contrib (자료 풍부)** | OTel만 Kafka, Agent는 별도 |
| OTLP 수신 | otelcol.* 래핑 | **네이티브** | OTel에서 처리 |
| K8s metrics scraping | 내장 (prometheus.operator.*) | Preset (kubernetesAttributes) | Agent가 담당 |
| Loki 연동 | loki.process (Alloy 전용) | **otlphttp → /otlp (표준)** | 동일 |
| 커뮤니티 | Grafana 중심 | **CNCF 전체** | 분산 |
| River 문법 의존 | 있음 | **없음 (표준 YAML)** | 없음 |
| 커스텀 빌드 | 불가 | **ocb로 경량 빌드** | 불가 |
| 파이프라인 UI | 12345 포트 | 없음 (대시보드 대체) | 없음 |

### 메트릭 저장소

| 항목 | Mimir 분산 유지 | Mimir 싱글바이너리 | Prometheus 단독 |
|------|----------------|-------------------|----------------|
| Pod 수 | 7 + Kafka + MinIO = 9 | **1** | 1 |
| 활성 시리즈 한계 | 수천만 | **~100만** | ~50만 |
| OTLP native | 지원 | **지원** | 미지원 |
| 장기 보관 | S3 | **S3/filesystem** | 로컬만 |
| HA | 다중 replica | 단일 (모드 전환 필요) | 단일 |
| Recording rules | Ruler 컴포넌트 | **내장 Ruler** | 내장 |
| 현재 시리즈 | ~50만 | **적정 범위** | 한계 근접 |

### 스파이크 버퍼

| 항목 | Kafka (기존 공유) | 별도 Redis Streams | Collector 내부 큐 |
|------|-----------------|-------------------|------------------|
| 추가 Pod | **0** | 1+ | 0 |
| 버퍼 용량 | **디스크 기반 (대용량)** | 메모리 기반 | 메모리 기반 |
| 내구성 | **디스크 + replication** | AOF/RDB | 프로세스 종료 시 유실 |
| 이미 운영 중 | **Yes (traces용)** | No | - |
| logs 버퍼링 | **topic 추가만** | 구현 필요 | 제한적 |

---

## 4. 결정 (Decision)

### 목표 아키텍처

```
Spring Boot (OTel SDK)
    │ OTLP (4317/4318)
    ▼
OTel Collector Front (Deployment, 1-2 replica)
    ├── Metrics → Mimir 분산 (prometheusremotewrite, 직접)
    ├── Logs   → Kafka (observability.logs.v1) ──→ OTel Collector Back → Loki OTLP
    └── Traces → Kafka (observability.traces.v1) ─→ OTel Collector Back → Tempo

K8s ServiceMonitor/PodMonitor → Prometheus (kps) → remoteWrite → Mimir 분산
                                                          ↑
                                                    (tail sampling, PII masking)
```

### 결정 근거

1. **OTel Collector**: `kafkaexporter`/`kafkareceiver`가 공식 contrib으로 문서화가 잘 되어 있고, Alloy의 otelcol.* 블록은 OTel Collector YAML과 1:1 매핑 가능하여 전환 리스크가 낮다

2. **Mimir 분산 유지**: 공식 `mimir-distributed` Helm chart에 SingleBinary 모드가 없음 (Grafana Discussion #6211). SimpleScalable도 Mimir 3.0에서 제거됨 (PR #12584). 커스텀 StatefulSet 대신 공식 chart 유지를 선택

3. **Kafka 공유**: 백엔드팀이 이미 Strimzi Kafka를 운영하고 있고, traces 버퍼링도 이미 Kafka로 하고 있다. logs topic만 추가하면 됨

### 트레이드오프 인정

- Alloy Web UI (파이프라인 시각화) 상실 → Grafana 대시보드 `infra-otel-pipeline.json`으로 대체
- `mimir.rules.kubernetes` 자동 sync 상실 → mimirtool CronJob 또는 수동 sync 필요
- Alloy 클러스터링 (DaemonSet 타겟 분배) 상실 → Prometheus(kps)가 scrape + remoteWrite to Mimir

---

## 5. 결과 (Consequences)

### 긍정적 영향

| 영향 | 정량적 효과 |
|------|-----------|
| Pod 변화 | Alloy DaemonSet 제거 → OTel Collector Front/Back 2개 + Prometheus 1개 추가 |
| 스파이크 대응 | logs + traces 모두 Kafka 버퍼링 |
| 학습 비용 | 표준 YAML, 풍부한 커뮤니티 자료 |

### 부정적 영향 / 리스크

| 리스크 | 확률 | 영향 | 대응 |
|--------|------|------|------|
| Mimir 분산 모드 리소스 과잉 | 확정 | 낮 | dev 수용, 향후 Helm chart에 SingleBinary 추가 시 재검토 |
| 대시보드 40개 중 일부 깨짐 | 높 | 낮 | otelcol_* 호환, alloy_* 1개 패널만 교체 |
| log_type 라벨 동작 변경 | 중 | 높 | 이미 Loki OTLP native + distributor otlp_config 사용 중 |
| PrometheusRule sync 방식 변경 | 확정 | 중 | mimirtool CronJob으로 대체 |

### 향후 과제

- prod(EKS) 배포 시 Mimir 리소스 최적화 검토 (Helm chart SingleBinary 지원 시 재검토)
- OTel Collector Operator 도입 검토 (auto-instrumentation, sidecar injection)
- Kafka SCRAM-SHA-512 인증 설정 (prod 전용)

---

## 6. 참고 자료

- [OTel Collector Kafka Exporter](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/exporter/kafkaexporter)
- [OTel Collector Kafka Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/kafkareceiver)
- [Grafana Mimir Deployment Modes](https://grafana.com/docs/mimir/latest/references/architecture/deployment-modes/)
- [Loki Native OTLP](https://grafana.com/docs/loki/latest/send-data/otel/)
- Goti Skills: `/observability-alloy-to-otel`, `/observability-mimir-monolithic`, `/observability-otel-collector-helm`
