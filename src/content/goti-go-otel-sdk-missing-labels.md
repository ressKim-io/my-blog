---
title: "Go 전환 후 Grafana/Tempo/Mimir에서 OTel 라벨이 사라진 이유 — SDK 미초기화"
excerpt: "Java 시절 OTel Operator가 자동 주입하던 리소스 라벨이 Go 전환 후 누락됐습니다. pkg/observability/가 비어있어 SDK 자체가 초기화되지 않은 것이 원인이었습니다"
category: monitoring
tags:
  - go-ti
  - OpenTelemetry
  - Go
  - SDK
  - troubleshooting
series:
  name: goti-java-to-go
  order: 5
date: "2026-04-13"
---

## 한 줄 요약

> go-ti 프로젝트의 Java → Go 전환 과정에서 OTel SDK 초기화 코드가 누락되어, Grafana·Tempo·Mimir·Loki 전 구간에서 Go 서비스의 `service_name` 라벨이 보이지 않았습니다. `pkg/observability/otel.go`를 신규 작성하고 6개 서비스에 일괄 적용해 해결했습니다

---

## 🔥 문제: Go 서비스가 Grafana에서 조회되지 않음

go-ti 프로젝트는 Java(Spring Boot) 기반 6개 서비스를 Go로 전환하는 작업을 진행 중입니다. Go 전환 이후 OTel 파이프라인은 그대로인데 Go 서비스만 텔레메트리에서 보이지 않는 문제가 발생했습니다.

증상은 다음과 같았습니다.

- Grafana 대시보드에서 `goti-*-go` 서비스 선택 불가 — `service_name` 라벨 자체가 없음
- Tempo에서 `resource.service.name="goti-payment-go"` 쿼리 시 결과 0건
- Mimir에서 job 라벨로 Go 서비스 식별 불가
- Loki에서도 `service_name` 라벨 누락

Go 서비스를 배포하고 Grafana Explore에서 해당 서비스명으로 조회하면 항상 0건이 반환됐습니다.

---

## 🤔 원인: OTel SDK 초기화 코드 자체가 없었음

`Goti-go/pkg/observability/` 디렉토리는 존재했지만 내부가 비어 있었습니다.

`cmd/*/main.go`에는 `middleware.RegisterMetrics(prometheus.DefaultRegisterer)`로 Prometheus `/metrics`만 노출하고 있었습니다. Prometheus scrape는 동작했지만 OTel resource attributes가 없는 상태였습니다. Tempo·OTLP 경로로는 아무 데이터도 전송되지 않았습니다.

config 레이어는 `cfg.OTel.Enabled/Endpoint/ServiceName`을 정상적으로 로드하고 있었습니다. SDK를 초기화하는 코드만 없었습니다.

**Java와의 차이**가 핵심 원인입니다.

Java 서비스는 OTel Operator의 `instrumentation.opentelemetry.io/inject-java` annotation으로 auto-instrumentation이 적용됐습니다. Operator가 JVM 에이전트를 자동 주입하면서 `service.name` 등 리소스 속성도 함께 설정됩니다. 별도 SDK 초기화 코드가 필요 없었습니다.

Go는 다릅니다. OTel Operator의 Go auto-instrumentation은 별도 설정이 필요하고, Goti-go 구조상 SDK를 직접 초기화하는 방식을 선택해야 합니다. 마이그레이션 과정에서 이 초기화 코드 작성이 누락됐습니다.

Collector 레이어 자체는 정상이었습니다. `otel-collector-front-values.yaml`의 `attributes/env` processor가 `service.namespace=goti`·`deployment.environment=prod`를 주입하고, `kubernetesAttributes` preset이 `k8s.*`를 enrich합니다. 그러나 원천 span·metric이 생성되지 않으면 collector가 enrich할 대상이 없습니다.

---

## ✅ 해결: pkg/observability/otel.go 신규 작성 + 6개 서비스 적용

### 1. otel.go 신규 작성

`Goti-go/pkg/observability/otel.go`를 새로 작성했습니다. 구성 요소는 다음과 같습니다.

- **Exporter**: `otlptracegrpc` + `otlpmetricgrpc`
- **Resource 구성**: `resource.WithFromEnv()` + `WithTelemetrySDK()` + `WithProcess()` + `WithHost()`
- **환경변수 자동 소비**: `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_RESOURCE_ATTRIBUTES`
- **글로벌 등록**: `TracerProvider` + `MeterProvider` 모두 글로벌로 등록, shutdown 함수 반환

`service.namespace`와 `deployment.environment`는 collector가 이미 주입하므로 Go 코드에서는 설정하지 않았습니다. 중복 주입을 방지하기 위해서입니다.

### 2. 6개 서비스 main.go에 Setup 호출 추가

```go
// cmd/{payment,queue,resale,stadium,ticketing,user}/main.go 공통 패턴
shutdown, err := observability.Setup(ctx, cfg.OTel)
if err != nil {
    log.Fatal("otel setup failed", zap.Error(err))
}
defer shutdown(context.Background())
```

대상 서비스는 payment·queue·resale·stadium·ticketing·user 총 6개입니다.

### 3. otelgin 미들웨어 추가

```go
// router 최상단에 추가
router.Use(otelgin.Middleware(cfg.OTel.ServiceName))
```

`otelgin.Middleware`를 router chain 최상단에 추가했습니다. 이를 통해 `http.route`·`http.method`·`http.status_code` 속성이 포함된 HTTP span이 자동 생성됩니다.

### 4. go.mod 의존성 추가

```text
go.opentelemetry.io/otel v1.43.0
go.opentelemetry.io/contrib/instrumentation/github.com/gin-gonic/gin/otelgin v0.68.0
```

### 배포 후 예상 라벨

```text
Prometheus: job="goti/goti-payment-go"
Tempo:      resource.service.name="goti-payment-go"
Loki:       service_name="goti-payment-go"
HTTP span:  http.route, http.method, http.status_code (Gin 라우트별)
```

---

## 📚 배운 점

**Java auto-instrumentation과 Go SDK의 차이를 이식 체크리스트에 포함해야 합니다**

Java OTel Operator는 annotation 하나로 SDK 주입·리소스 속성 설정을 자동 처리합니다. Go는 SDK 초기화를 코드에서 직접 수행해야 합니다. Java → Go 포팅 체크리스트에 "OTel SDK 초기화 여부" 항목을 추가해야 합니다

**Go 서비스 템플릿에 observability.Setup을 기본 포함해야 합니다**

이번 누락은 새 서비스 파일을 처음부터 작성하는 과정에서 발생했습니다. Go 서비스 보일러플레이트에 `observability.Setup` 호출과 deferred shutdown을 기본값으로 포함하면 동일한 누락을 방지할 수 있습니다

**배포 후 OTel 연결 검증 쿼리를 플레이북에 등재해야 합니다**

SDK가 없어도 Pod는 정상 기동됩니다. 텔레메트리 누락은 배포 시점에 드러나지 않습니다. 배포 후 즉시 실행할 검증 쿼리를 플레이북에 포함해야 합니다

```promql
# Go 서비스 scrape 정상 여부 확인
count by (job) (up{job=~"goti/.*-go"})
```

**Collector enrich는 원천 데이터가 있어야 동작합니다**

collector 파이프라인이 완벽해도 span·metric 자체가 오지 않으면 아무것도 보이지 않습니다. 트러블슈팅 시 collector 로그보다 앱 측 SDK 초기화 여부를 먼저 확인해야 합니다
