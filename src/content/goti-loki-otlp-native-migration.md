---
title: "Loki OTLP Native 전환 — exporter.loki에서 벗어나기"
excerpt: "otelcol.exporter.loki의 hint 버그로 label 승격이 안 되는 문제를 발견하고, Loki 3.x native OTLP 엔드포인트로 전환한 과정"
type: troubleshooting
category: monitoring
tags:
  - go-ti
  - Loki
  - OpenTelemetry
  - Alloy
  - OTLP
  - Structured Metadata
  - Troubleshooting
series:
  name: "goti-observability-stack"
  order: 2
date: "2026-03-13"
---

## 한 줄 요약

> Alloy의 `otelcol.exporter.loki`에서 hint attribute가 silent fail하면서 label 승격이 안 됐습니다. Loki 3.x native OTLP 엔드포인트로 전환하고, 서버 측 `otlp_config`로 label을 제어하는 방식으로 해결했습니다.

## Impact

- **영향 범위**: Log Explorer, Audit Log, Payment Log 대시보드 전체
- **증상**: 모든 패널 빈 결과
- **소요 시간**: 약 4시간 (조사 2시간 + 전환 2시간)
- **발생일**: 2026-03-13

---

## 🔥 증상: Log Explorer가 텅 비어있다

Prometheus → Mimir 전환을 완료한 뒤 Log Explorer 대시보드를 열었더니 **모든 패널이 빈 결과**를 반환했습니다.

대시보드의 LogQL은 이렇게 생겼습니다:

```logql
{log_type=~"$log_type", service_name=~"$service"} | detected_level=~"$level"
```

Loki에 실제 존재하는 label을 확인했습니다.

| 대시보드 사용 label | Loki에 존재? | 비고 |
|-------------------|-------------|------|
| `service_name` | ✅ | 정상 |
| `log_type` | ❌ | **핵심 원인** |
| `detected_level` | ✅ | Loki built-in 자동 감지 |

`log_type` label이 Loki에 없었습니다.
stream selector에서 존재하지 않는 label로 필터링하니 당연히 결과가 0건입니다.

---

## 🤔 원인: exporter.loki의 hint attribute가 silent fail

파이프라인 구조는 Spring Boot → OTel SDK → Alloy(OTLP receiver) → `otelcol.exporter.loki` → Loki 순이었습니다.

Alloy의 `otelcol.processor.transform`에서 hint attribute를 설정해놨습니다:

```
loki.attribute.labels = "log_type"
```

이 hint는 `otelcol.exporter.loki`에게 "log_type을 Loki index label로 승격해라"라고 지시하는 것입니다.

문제는 **이것이 작동하지 않았다**는 것입니다.
에러 로그도 없었습니다. 완전한 silent fail입니다.

이것은 Alloy v1.8.3~v1.13.2에서 지속되는 known issue였습니다.
[GitHub Issue #2064](https://github.com/grafana/alloy/issues/2064)와 [#3216](https://github.com/grafana/alloy/issues/3216)에서 보고된 문제입니다.

`otelcol.exporter.loki`는 자체 label 제어 설정이 **없고**, 오직 hint attributes에만 의존합니다.
hint가 작동하지 않으면 label 승격 자체가 불가능합니다.

---

## 🤔 대안 분석: Native OTLP vs 기존 exporter

이 시점에서 두 가지 방향이 있었습니다.

### 기존 방식 유지 + 우회

`loki.process`를 사용해서 JSON body를 파싱하고 `stage.labels`로 승격하는 방법입니다. 흐름은 OTLP → `exporter.loki` → `loki.process`(JSON 파싱 후 label 승격) → `loki.write` 순입니다.

동작은 하지만, `exporter.loki` 자체가 deprecation 논의 중이라 장기적으로 좋지 않습니다.

### Native OTLP로 전환

Loki 3.x부터 `/otlp/v1/logs` 네이티브 OTLP 엔드포인트를 제공합니다.
Grafana 공식 권장 방향이고, 모든 개발이 여기에 집중되고 있습니다.

| 항목 | `otelcol.exporter.loki` | **Native OTLP** |
|------|------------------------|-----------------|
| Log body | JSON으로 전체 인코딩 | plaintext 원문 저장 |
| Attribute 접근 | `\| json` 파싱 필요 | structured metadata 직접 접근 |
| Label 제어 | hint attributes (buggy) | **서버 측 `otlp_config` (안정적)** |
| 향후 방향 | deprecation 논의 | 모든 개발 집중 |

차이가 큽니다.

`exporter.loki`는 전체 LogRecord를 JSON으로 인코딩해서 Loki에 보냅니다.
쿼리할 때 `| json`으로 매번 파싱해야 합니다.

Native OTLP는 **plaintext 원문을 그대로 저장**하고, OTel attributes는 structured metadata로 자동 보관합니다.
`| json` 파싱 없이 바로 접근 가능합니다.

```logql
# Before (exporter.loki — JSON body)
{service_name="goti-server"} | json | log_type="payment"

# After (native OTLP — structured metadata)
{service_name="goti-server"} | log_type="payment"
```

Native OTLP로 전환하기로 결정했습니다.

---

## 🤔 log_type을 어떻게 index label로 만들 것인가

Native OTLP로 전환해도 한 가지 문제가 남습니다.

Loki의 `otlp_config`에서 `index_label` action은 **resource attributes에만** 지원됩니다.
log attributes에는 structured metadata나 drop만 가능합니다.

`log_type`은 원래 log attribute입니다.
index label로 만들려면 resource attribute로 옮겨야 합니다.

세 가지 옵션을 비교했습니다.

| 옵션 | 방법 | 장점 | 단점 |
|------|------|------|------|
| A. Structured Metadata | log attribute 그대로 유지 | 가장 단순 | stream selector 불가 |
| **B. Resource로 복사** | OTTL로 resource에 복사 | index label 가능 | stream 분할 |
| C. loki.process | JSON 파싱 → label 승격 | 기존 exporter 유지 | deprecated 방향 |

### 옵션 A의 한계

structured metadata로 저장하면 `| log_type="payment"` 같은 pipe filter로만 접근 가능합니다.
`{log_type="payment"}` 같은 **stream selector로는 쓸 수 없습니다**.

이것이 왜 문제냐면, retention policy에서 label selector가 필요하기 때문입니다.
전자금융거래법에 따라 payment 로그는 5년 보관이 필요한데, `{log_type="payment"}`로 retention을 다르게 설정하려면 index label이어야 합니다.

### 옵션 B 선택

OTTL(OpenTelemetry Transformation Language)로 `log_type`을 resource attribute로 복사합니다.

```
set(resource.attributes["log_type"], attributes["log_type"])
```

`log_type`의 값은 `app`, `payment`, `audit` 3가지뿐입니다.
stream이 3배로 분할되지만, 값이 3개라 카디널리티 부담이 없습니다.

---

## ✅ 전환 내용

### Loki 설정: otlp_config 추가

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
            - log_type
```

서버 측에서 어떤 resource attribute를 index label로 승격할지 선언합니다.
hint attribute에 의존하던 방식보다 훨씬 안정적입니다.

### Alloy 파이프라인: exporter.loki → exporter.otlphttp

| 시점 | 파이프라인 |
|---|---|
| Before | OTLP → `transform`(hints 설정) → `exporter.loki` → `loki.write` |
| After | OTLP → `transform`(PII 마스킹 + log_type→resource 복사) → `batch` → `exporter.otlphttp` → Loki `/otlp` |

핵심 변경 두 가지:
1. `exporter.loki` → `exporter.otlphttp`로 교체 (OTLP native 엔드포인트 사용)
2. transform에서 hint 설정 대신 **log_type을 resource로 복사**하는 OTTL 추가

### 대시보드 LogQL 수정

```logql
# Before — JSON 파싱 필요
{service_name=~"$service"} | json | log_type=~"$log_type" | detected_level=~"$level"

# After — structured metadata 직접 접근
{service_name=~"$service", log_type=~"$log_type"} | detected_level=~"$level"
```

`log_type`이 index label이 됐으니 stream selector에서 직접 필터링합니다.
`| json` 파싱도 없어졌습니다.
쿼리 성능이 눈에 띄게 좋아졌습니다.

---

## 📊 Before / After 비교

| 항목 | Before | After |
|------|--------|-------|
| Exporter | `otelcol.exporter.loki` | `otelcol.exporter.otlphttp` |
| Log body | JSON 인코딩 (전체 LogRecord) | plaintext 원문 |
| Label 제어 | hint attributes (buggy) | 서버 측 `otlp_config` |
| log_type | label 미승격 (silent fail) | index label (resource 복사) |
| 쿼리 | `\| json \| log_type="x"` | `{log_type="x"}` |
| 향후 호환 | deprecation 예정 | Grafana 공식 권장 |

---

## 📚 배운 점

### Silent fail은 가장 위험한 버그다

에러가 나면 최소한 원인을 추적할 수 있습니다.
하지만 `otelcol.exporter.loki`의 hint attribute는 실패해도 **아무 로그도 남기지 않았습니다**.
데이터가 들어오지 않는 이유를 찾으려면 Loki의 label 목록부터 역추적해야 했습니다.

관측성 파이프라인에서 silent fail은 특히 위험합니다.
"모니터링을 모니터링해야 하는" 상황이 생기기 때문입니다.

### index_label은 resource attributes에만 가능하다

Loki 3.x의 `otlp_config`에서 `index_label` action은 resource attributes에만 적용됩니다.
log attributes는 structured metadata로만 저장할 수 있습니다.

[Loki PR #15293](https://github.com/grafana/loki/pull/15293)에서 log attributes index_label을 추가하려는 시도가 있었지만, 2025-05 기준 merge되지 않았습니다.
stream selector로 사용해야 하는 log attribute가 있다면, OTTL로 resource에 복사하는 것이 현재 유일한 방법입니다.

### Grafana의 공식 방향을 따르자

`otelcol.exporter.loki`는 여전히 동작하지만, Grafana의 모든 개발 리소스가 native OTLP에 집중되고 있습니다.
deprecation 공식 발표는 아직 없지만, 새 기능 추가도 없습니다.
신규 구축이라면 처음부터 native OTLP를 선택하는 것이 맞습니다.

---

## 📎 참고 자료

- [Loki Native OTLP vs Loki Exporter](https://grafana.com/docs/loki/latest/send-data/otel/native_otlp_vs_loki_exporter/)
- [Loki OTel Ingestion](https://grafana.com/docs/loki/latest/send-data/otel/)
- [Loki Structured Metadata](https://grafana.com/docs/loki/latest/get-started/labels/structured-metadata/)
- [Alloy Issue #2064 — OTLP Label Setting](https://github.com/grafana/alloy/issues/2064)
- [Loki PR #15293 — log_attributes index_label](https://github.com/grafana/loki/pull/15293)
