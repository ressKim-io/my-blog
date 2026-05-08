---
title: "OTel → Prometheus 레이블 매핑 함정: service_name은 없다"
excerpt: "OTel의 service.name이 Prometheus에서 job 레이블로 변환되는 표준 동작을 몰라서 대시보드 전체가 No Data가 된 이야기"
category: monitoring
tags:
  - go-ti
  - OpenTelemetry
  - Prometheus
  - Grafana
  - Alloy
  - Troubleshooting
series:
  name: "goti-otel-prometheus"
  order: 2
date: "2026-03-06"
---

## 🎯 한 줄 요약

> OTel의 `service.name` 리소스 속성은 Prometheus에서 `service_name`이 아니라 `job` 레이블로 변환됩니다. OTel-Prometheus 호환성 스펙에 명시된 표준 동작입니다

## 📊 Impact

- **영향 범위**: Grafana 대시보드 6개 + Recording Rules 24개소 전체 No Data
- **소요 시간**: 약 4시간
- **발생일**: 2026-03-06

---

## 🔥 상황

Goti-server를 Micrometer에서 OTel SDK로 전환한 뒤, Grafana 대시보드와 Prometheus recording rules를 OTel 메트릭명으로 마이그레이션하고 있었습니다.

메트릭명은 잘 바꿨는데, 대시보드를 열어보니 모든 패널이 "No Data"였습니다.

문제의 쿼리를 살펴봤습니다.

```promql
# 대시보드에서 사용한 쿼리 (No Data)
jvm_memory_used_bytes{service_name="goti-server", jvm_memory_type="heap"}
```

`service_name="goti-server"`로 필터링하고 있었습니다.
당연히 OTel의 `service.name`이 `service_name`으로 매핑될 것이라고 생각했습니다.

Prometheus에서 실제 레이블을 확인해봤습니다.

```promql
# 실제 Prometheus에 존재하는 레이블
jvm_memory_used_bytes{job="goti-server", jvm_memory_type="heap"}
```

`service_name` 레이블은 아예 존재하지 않았습니다.
`job` 레이블에 서비스명이 들어가 있었습니다.

---

## 🤔 원인

### 가설 1: service.name이 service_name으로 매핑될 것이다

`make verify-labels` 스크립트로 실제 Prometheus 레이블을 덤프해봤습니다.

```bash
$ make verify-labels
# jvm_memory_used_bytes 레이블 확인
job="goti-server"
jvm_memory_type="heap"
jvm_memory_pool_name="G1 Eden Space"
# ... service_name 레이블 없음
```

**기각**. `service_name`은 어디에도 없었습니다.

### 가설 2: service.name → job 매핑이 표준이다

OTel-Prometheus 호환성 스펙을 확인했습니다.

[OTel Prometheus Compatibility Spec](https://opentelemetry.io/docs/specs/otel/compatibility/prometheus_and_openmetrics/)에 따르면:

> `service.name` + `service.namespace` → Prometheus `job` 레이블

이것은 **표준 동작**이었습니다.

[Grafana Alloy의 otelcol.exporter.prometheus](https://grafana.com/docs/alloy/latest/reference/components/otelcol/otelcol.exporter.prometheus/) 문서에서도 동일한 동작을 확인했습니다.

### 가설 3: http.route가 http_route로 매핑될 것이다

추가로 `http.route` 속성도 확인했습니다.
Spring Boot OTel 기본 설정에서는 `http.route` 속성을 지원하지 않았습니다.

[OTel Java Issue #12353](https://github.com/open-telemetry/opentelemetry-java-instrumentation/issues/12353)에서 관련 논의를 확인했습니다. **기각**.

### 근본 원인

Alloy의 `otelcol.exporter.prometheus`가 OTel 리소스 속성 `service.name`을 Prometheus `job` 레이블로 매핑하는 것은 OTel-Prometheus 호환성 스펙의 표준 동작입니다.

초기 마이그레이션에서 이걸 `service_name`으로 잘못 매핑한 것이 원인이었습니다.

정리하면 이런 매핑 관계입니다.

| OTel 리소스 속성 | Prometheus 레이블 | 비고 |
|-----------------|------------------|------|
| `service.name` | `job` | 호환성 스펙 표준 |
| `service.namespace` + `service.name` | `job` (`<ns>/<name>`) | namespace 있을 때 |
| 일반 속성 (`.` → `_`) | 속성명 그대로 | `jvm.memory.type` → `jvm_memory_type` |

`service.name`만 특별하게 `job`으로 변환된다는 점이 핵심입니다.

---

## ✅ 해결

총 4개 영역을 수정했습니다.

### 1. Prometheus Recording Rules

```yaml
# Before
- record: goti:jvm:heap_usage
  expr: jvm_memory_used_bytes{service_name="goti-server", jvm_memory_type="heap"}

# After
- record: goti:jvm:heap_usage
  expr: jvm_memory_used_bytes{job="goti-server", jvm_memory_type="heap"}
```

- `prometheus/rules/recording.yml`: 16개소 수정
- `prometheus/rules/application.yml`: 8개소 수정

### 2. Grafana 대시보드

대시보드 6개에서 다음을 변경했습니다.

- 변수 쿼리: `label_values(metric, service_name)` → `label_values(metric, job)`
- 패널 쿼리: `service_name=` → `job=`
- GC legendFormat: `{{gc}}` → `{{jvm_gc_name}}`

### 3. 변수 이름은 유지

대시보드 변수 이름 자체는 `service_name`으로 유지했습니다.
Tempo의 TraceQL에서 `resource.service.name`으로 필터링할 때 이 변수명을 쓰고 있었기 때문입니다.

변수 이름과 실제 Prometheus 레이블이 다른 건 혼란스러울 수 있지만, 크로스 데이터소스 호환을 위한 의도적인 선택이었습니다.

---

## 검증

Docker 로컬 환경에서 `make verify-labels`로 검증했습니다.

```bash
$ make verify-up    # 모니터링 스택 기동
$ make verify-labels # 레이블 검증
```

| 항목 | 결과 |
|------|------|
| JVM Heap 사용률 | 11% 값 반환 |
| HTTP 메트릭 | 2개 시리즈 (200, 401) |
| GC 메트릭 | `jvm_gc_name=G1 Young Generation` |
| Thread Count | 6개 시리즈 |
| Recording Rules | `health=ok` 정상 평가 |
| `label_values(job)` | `goti-server` 포함 |

모든 항목이 정상이었습니다.

---

## 📚 배운 점

### OTel → Prometheus 레이블은 반드시 실측으로 검증

스펙 문서를 읽지 않고 직감으로 매핑한 것이 실수였습니다.
`service.name` → `service_name`이라고 가정하면 안 됩니다.

**대시보드 변경 전 필수 단계:**

1. 실제 메트릭을 Prometheus에 수집한다
2. `label_values()` 또는 메트릭 덤프로 실제 레이블명을 확인한다
3. 확인된 레이블로 대시보드와 rules를 작성한다

### 회귀 테스트 스크립트

`scripts/verify-otel-labels.sh`와 `make verify-labels` 타겟을 추가했습니다.
대시보드 변경 PR 전에 이 스크립트를 실행하면 레이블 불일치를 미리 잡을 수 있습니다.

이 검증 스크립트가 없었으면 같은 실수를 반복했을 것입니다.
