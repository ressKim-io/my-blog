---
date: 2026-03-06
category: troubleshoot
project: Goti-monitoring
tags: [otel, prometheus, grafana, label-mapping, dashboard]
---

# OTel → Prometheus 레이블 불일치로 Grafana 대시보드 "No Data"

## Context
Spring Boot goti-server가 Micrometer에서 OTel SDK로 전환 후, Grafana 대시보드/Prometheus recording rules를 OTel 메트릭명으로 마이그레이션하는 작업 중 발생.
초기 마이그레이션 플랜에서 레이블 매핑을 잘못 설정하여 수정 후에도 "No Data" 지속.

## Issue

대시보드에서 `service_name="$service_name"` 필터 사용 → Prometheus에 해당 레이블 미존재 → 모든 패널 "No Data".

```
# 대시보드 쿼리 (잘못된 레이블)
jvm_memory_used_bytes{service_name="goti-server", jvm_memory_type="heap"}

# 실제 Prometheus 레이블
jvm_memory_used_bytes{job="goti-server", jvm_memory_type="heap"}
```

재현 조건: OTel SDK → Alloy(`otelcol.exporter.prometheus`) → Prometheus 파이프라인에서 `service.name` 리소스 속성이 `job` 레이블로 변환됨.

## Action

1. 가설 1: `service.name` → `service_name`으로 매핑될 것이다 → 결과: **기각**. `make verify-labels` 스크립트로 실제 Prometheus 레이블 덤프 확인. `service_name` 레이블 미존재, `job=goti-server`만 존재.

2. 가설 2: OTel-Prometheus 호환성 스펙에서 `service.name` → `job` 매핑이 표준이다 → 결과: **수용**. 외부 검색으로 확인:
   - [OTel Prometheus Compatibility Spec](https://opentelemetry.io/docs/specs/otel/compatibility/prometheus_and_openmetrics/) — `service.name` + `service.namespace` → `job` 레이블
   - [Grafana Alloy otelcol.exporter.prometheus](https://grafana.com/docs/alloy/latest/reference/components/otelcol/otelcol.exporter.prometheus/) — 동일 동작 확인

3. 가설 3: `http.route` → `http_route` 레이블이 존재할 것이다 → 결과: **기각**. Spring Boot OTel 기본 설정에서 `http.route` 속성 미지원. [OTel Java Issue #12353](https://github.com/open-telemetry/opentelemetry-java-instrumentation/issues/12353) 확인.

**근본 원인 (Root Cause):**
`otelcol.exporter.prometheus`가 OTel 리소스 속성 `service.name`을 Prometheus `job` 레이블로 매핑하는 것이 OTel-Prometheus 호환성 스펙의 표준 동작. 초기 마이그레이션에서 이를 `service_name`으로 잘못 매핑.

**적용한 수정:**
- `prometheus/rules/recording.yml`: `service_name="goti-server"` → `job="goti-server"` (16개소)
- `prometheus/rules/application.yml`: 동일 변환 (8개소)
- Grafana 대시보드 6개: `label_values(metric, service_name)` → `label_values(metric, job)`, Prometheus 쿼리 `service_name=` → `job=`
- GC legendFormat: `{{gc}}` → `{{jvm_gc_name}}`
- 변수 이름은 `service_name` 유지 (Tempo TraceQL `resource.service.name` 호환)

## Result

Docker 로컬 검증 (`make verify-up` → `make verify-labels`):
- JVM Heap 사용률: 11% 값 반환 확인
- HTTP 메트릭: 2개 시리즈 (200, 401) 확인
- GC 메트릭: `jvm_gc_name=G1 Young Generation` 확인
- Thread Count: 6개 시리즈 확인
- Recording Rules: `health=ok` 정상 평가
- `label_values(job)`: `goti-server` 포함 확인

회귀 테스트: `scripts/verify-otel-labels.sh` 스크립트 + `make verify-labels` 타겟 추가로 향후 레이블 변경 시 검증 가능.

재발 방지:
- OTel → Prometheus 레이블 매핑은 반드시 실제 메트릭 덤프로 검증 후 대시보드 적용
- `make verify-labels`를 대시보드 변경 PR 전 필수 실행

## Related Files
- prometheus/rules/recording.yml
- prometheus/rules/application.yml
- grafana/dashboards/developer/jvm-deep-dive.json
- grafana/dashboards/developer/api-red-metrics.json
- grafana/dashboards/developer/error-analysis.json
- grafana/dashboards/business/ticketing-overview.json
- grafana/dashboards/developer/distributed-tracing.json
- scripts/verify-otel-labels.sh
- docker/docker-compose.server-otel.yml
- Makefile
