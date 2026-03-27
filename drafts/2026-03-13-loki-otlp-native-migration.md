---
date: 2026-03-13
category: troubleshoot
project: Goti-monitoring
tags: [loki, otlp, alloy, log_type, structured-metadata, otel, exporter-loki, exporter-otlphttp]
---

# Loki OTLP Native 전환 — otelcol.exporter.loki → otelcol.exporter.otlphttp

## Context

Prometheus → Mimir 전환 완료 후 Log Explorer 대시보드에 데이터 미표시 문제 조사.
파이프라인: Spring Boot → OTel SDK → Alloy (OTLP receiver) → Loki.

## Issue

### 증상
Log Explorer 대시보드의 모든 패널이 빈 결과 반환. 대시보드 LogQL:
```logql
{log_type=~"$log_type", service_name=~"$service"} | detected_level=~"$level"
```

### 원인 분석

Loki에 실제 존재하는 label 목록: `deployment_environment`, `exporter`, `job`, `level`, `pod`, `service_name`, `service_namespace`, `stream`

| 대시보드 사용 label | Loki 존재 여부 | 역할 |
|-------------------|--------------|------|
| `service_name` | ✅ 존재 | stream selector |
| `log_type` | ❌ **없음** | stream selector — **이것이 핵심 원인** |
| `detected_level` | ✅ Loki built-in 자동 감지 | pipeline filter — 정상 동작 |

`log_type`이 Loki label로 승격되지 않는 이유:
- Alloy `otelcol.processor.transform`에서 `loki.attribute.labels = "log_type"` 설정했으나 미작동
- Alloy `loki.attribute.labels` known issue (v1.8.3~v1.13.2에서 지속)
- `otelcol.exporter.loki`는 자체 label 설정이 없고, hint attributes에만 의존

## 외부 조사 결과 (2026-03 기준)

### 1. Loki Native OTLP 지원

Loki 3.x는 `/otlp/v1/logs` 네이티브 OTLP endpoint 제공 (Loki 3.0부터).
**Grafana 공식 권장**: native OTLP가 로그 전송 표준, `otelcol.exporter.loki` 는 deprecation 논의 중.

| 비교 항목 | `otelcol.exporter.loki` (현재) | Native OTLP (`/otlp`) (권장) |
|----------|-------------------------------|------------------------------|
| Log body | JSON으로 전체 인코딩 | plaintext 원문 저장 |
| Attribute 접근 | `\| json` 파싱 필요 | structured metadata 직접 접근 |
| Label 제어 | hint attributes (buggy) | 서버 측 `otlp_config` (안정적) |
| 향후 방향 | deprecation 논의 | 모든 개발 집중 |

### 2. `otelcol.exporter.loki` label 핸들링

`otelcol.exporter.loki`는 자체 label 제어 설정이 **없음**. hint attributes에만 의존:
- `loki.resource.labels` — resource attributes → Loki index label
- `loki.attribute.labels` — log attributes → Loki index label

이 hints는 upstream processor에서 설정해야 하며, 에러가 나도 silent fail (디버깅 어려움).

### 3. Loki `otlp_config` — 서버 측 label 제어

Loki 3.x `limits_config.otlp_config`:
```yaml
limits_config:
  allow_structured_metadata: true
  otlp_config:
    resource_attributes:
      attributes_config:
        - action: index_label
          attributes:
            - service.name
            - service.namespace
            - deployment.environment
            - log_type          # resource에 복사 시
    # log_attributes에는 index_label 미지원!
    # structured_metadata 또는 drop만 가능
```

**중요**: `index_label` action은 **resource_attributes에만** 지원. log_attributes는 structured_metadata로만 저장 가능.
(Loki PR #15293 — log_attributes index_label 추가 시도했으나 merge 안 됨, 2025-05)

### 4. `log_type` 해결 방법 비교

| 옵션 | 방법 | 장점 | 단점 |
|------|------|------|------|
| **A. Structured Metadata** | log_type을 log attribute로 유지, Loki가 자동으로 structured metadata 저장 | 가장 단순, OTel 표준 준수 | index label 아님, `{log_type="payment"}` stream selector 불가. retention policy에서 label selector 사용 불가 |
| **B. Resource로 복사** | OTTL: `set(resource.attributes["log_type"], attributes["log_type"])` | index label 가능, retention에서 사용 가능, 빠른 쿼리 | log별로 resource 달라져 stream 분할 (3개 값이라 OK) |
| **C. loki.process** | JSON body 파싱 → stage.labels로 승격 | 기존 exporter.loki 유지 | deprecated 방향, 복잡 |

**결정: 옵션 B** — `log_type`을 resource attribute로 복사 + native OTLP 전환.
- 3개 값(app/payment/audit)이라 stream 분할 부담 없음
- retention policy에서 `{log_type="payment"}` label selector 필요 (전자금융거래법 5년 보관)
- EKS 프로덕션에서도 동일 구조 사용 가능

### 5. Structured Metadata 쿼리 방식

Native OTLP로 전환 시 OTel attributes는 structured metadata로 자동 저장.
LogQL에서 pipe syntax로 직접 접근 가능 (| json 파싱 불필요):
```logql
# Before (exporter.loki — JSON body)
{service_name="goti-server"} | json | log_type="payment"

# After (native OTLP — structured metadata)
{service_name="goti-server"} | log_type="payment"

# log_type이 index label인 경우 (resource로 복사 시)
{service_name="goti-server", log_type="payment"}
```

### 6. 파이프라인 변경 요약

```
Before:
  OTLP → transform(hints설정) → exporter.loki → loki.write
  - body: JSON 인코딩 (전체 LogRecord + attributes)
  - label: hint 의존 (buggy)
  - 쿼리: | json 필수

After:
  OTLP → transform(PII마스킹 + log_type→resource복사) → batch → exporter.otlphttp → Loki /otlp
  - body: plaintext 원문
  - label: Loki otlp_config (서버 측, 안정적)
  - 쿼리: structured metadata 직접 접근
```

## Action

(구현 내용은 아래 별도 섹션에 기록)

### 수정 파일 목록

1. `Goti-monitoring/values-stacks/dev/alloy-values.yaml` — 파이프라인 재구성
2. `Goti-monitoring/values-stacks/dev/loki-values.yaml` — otlp_config 추가
3. `Goti-monitoring/charts/goti-monitoring/dashboards/devops/log-explorer.json` — LogQL 수정
4. `Goti-monitoring/charts/goti-monitoring/dashboards/devops/audit-log-viewer.json` — LogQL 수정
5. `Goti-monitoring/charts/goti-monitoring/dashboards/devops/payment-log-viewer.json` — LogQL 수정

## 참고 문서

- [Loki OTel Ingestion Docs](https://grafana.com/docs/loki/latest/send-data/otel/)
- [Native OTLP vs Loki Exporter](https://grafana.com/docs/loki/latest/send-data/otel/native_otlp_vs_loki_exporter/)
- [Alloy OTel Logs to Loki Tutorial](https://grafana.com/docs/loki/latest/send-data/alloy/examples/alloy-otel-logs/)
- [otelcol.exporter.loki Docs](https://grafana.com/docs/alloy/latest/reference/components/otelcol/otelcol.exporter.loki/)
- [Alloy Issue #2064 — OTLP Label Setting](https://github.com/grafana/alloy/issues/2064)
- [Alloy Issue #3216 — Missing Custom Labels](https://github.com/grafana/alloy/issues/3216)
- [Loki PR #15293 — log_attributes index_label (closed)](https://github.com/grafana/loki/pull/15293)
- [Loki Issue #13044 — Resource Attributes as Labels](https://github.com/grafana/loki/issues/13044)
- [Loki Structured Metadata Docs](https://grafana.com/docs/loki/latest/get-started/labels/structured-metadata/)
- [Community: Add Index Labels via OTLP](https://community.grafana.com/t/add-additional-index-labels-in-loki-3-0-via-otlp/121225)
- [Community: Map Log Attributes to Loki Labels](https://community.grafana.com/t/how-to-map-log-attributes-to-loki-label-filters-with-grafana-alloy/140816)

## Related Files
- `Goti-monitoring/values-stacks/dev/alloy-values.yaml`
- `Goti-monitoring/values-stacks/dev/loki-values.yaml`
- `Goti-monitoring/charts/goti-monitoring/dashboards/devops/log-explorer.json`
- `Goti-monitoring/charts/goti-monitoring/dashboards/devops/audit-log-viewer.json`
- `Goti-monitoring/charts/goti-monitoring/dashboards/devops/payment-log-viewer.json`
