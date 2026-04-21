---
date: 2026-04-13
category: troubleshoot
project: Goti-go
tags: [otel, observability, go-sdk, tracing, metrics, gin]
failure_type: [context-missing, env-difference]
misdiagnosis_count: 0
time_to_resolve: 1h
related_changes: [c96e1d8]
---

# Go 전환 후 Grafana/Tempo/Mimir에서 OTel 리소스 라벨 누락 — SDK 미초기화

## Context

Goti 프로젝트가 Java(Spring Boot) → Go로 마이그레이션된 후, Grafana/Tempo/Mimir에서 `service_name` 및 Java 시절 존재하던 리소스 라벨들이 들어오지 않는 문제가 발생. OTel 파이프라인은 그대로인데 Go 서비스에서만 텔레메트리가 보이지 않음.

## Issue

- Grafana 대시보드에서 Go 서비스(`goti-*-go`) 선택 불가 — `service_name` 라벨 누락
- Tempo: `resource.service.name="goti-payment-go"` 쿼리 결과 없음
- Mimir: job 라벨로 Go 서비스 식별 불가
- Loki: service_name 라벨 누락

재현: Go 서비스 배포 → Grafana Explore에서 해당 서비스명으로 조회 → 결과 0건.

## Action

### 근본 원인 (Root Cause)

**Goti-go에 OTel SDK 초기화 코드가 아예 없었음.**

- `pkg/observability/` 디렉토리는 존재하나 비어있음
- `cfg.OTel.Enabled/Endpoint/ServiceName` config만 로드하고 SDK는 미초기화
- `cmd/*/main.go`에서 `middleware.RegisterMetrics(prometheus.DefaultRegisterer)`로 Prometheus /metrics만 노출 → scrape는 되지만 OTel resource attributes 없음
- Tempo/OTLP 경로로는 아무 데이터도 전송되지 않음

Java는 OTel Operator의 `instrumentation.opentelemetry.io/inject-java` annotation으로 auto-instrumentation이 적용되어 Resource가 자동 주입됐지만, Go는 SDK 직접 호출이 필요한데 마이그레이션 과정에서 누락됨.

Collector 레이어(`otel-collector-front-values.yaml`)는 정상 — `attributes/env` processor가 `service.namespace=goti`, `deployment.environment=prod`를 주입하고 `kubernetesAttributes` preset이 `k8s.*`를 enrich. 하지만 원천(span/metric) 자체가 생성되지 않으면 collector가 enrich할 대상이 없음.

### 적용한 수정

- `pkg/observability/otel.go` 신규 작성:
  - `otlptracegrpc` + `otlpmetricgrpc` exporter
  - `resource.WithFromEnv()` + `WithTelemetrySDK()` + `WithProcess()` + `WithHost()`
  - `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_RESOURCE_ATTRIBUTES` env 자동 소비
  - `TracerProvider` + `MeterProvider` 글로벌 등록, shutdown 함수 반환
- 6개 서비스 `cmd/{payment,queue,resale,stadium,ticketing,user}/main.go`에 `observability.Setup` 호출 + deferred shutdown
- `otelgin.Middleware(cfg.OTel.ServiceName)`를 router chain 최상단에 추가 → HTTP span 자동 생성 (`http.route`, `http.method`, `http.status_code`)
- `service.namespace` / `deployment.environment`은 collector가 이미 주입하므로 Go 코드에서는 미설정 (중복 방지)
- go.mod: otel v1.43.0, contrib otelgin v0.68.0 등 추가

## Result

- `go build ./...` 통과
- 커밋 `c96e1d8` main 브랜치 푸시 완료
- 배포 후 예상 라벨:
  - Prometheus: `job="goti/goti-payment-go"`
  - Tempo: `resource.service.name="goti-payment-go"`
  - Loki: `service_name="goti-payment-go"`
  - HTTP span의 `http.route` 등 Gin 라우트별 라벨

### 재발 방지

- Java→Go 포팅 체크리스트에 "OTel SDK 초기화 여부" 항목 추가 필요 (`project_aws_to_gcp_port.md` 유형 문서에 반영 권장)
- Go 서비스 템플릿에 `observability.Setup` 호출을 기본 포함
- 배포 후 검증 쿼리를 플레이북에 등재: `count by (job) (up{job=~"goti/.*-go"})`

## Related Files

- `Goti-go/pkg/observability/otel.go` (신규)
- `Goti-go/cmd/payment/main.go`
- `Goti-go/cmd/queue/main.go`
- `Goti-go/cmd/resale/main.go`
- `Goti-go/cmd/stadium/main.go`
- `Goti-go/cmd/ticketing/main.go`
- `Goti-go/cmd/user/main.go`
- `Goti-go/go.mod`, `go.sum`
