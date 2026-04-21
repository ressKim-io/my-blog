---
date: 2026-03-25
category: troubleshoot
project: Goti-monitoring
tags: [tempo, metrics-generator, spanmetrics, overrides, legacyconfig, helm-chart-v1]
---

# Tempo metricsGenerator 활성화 삽질 — legacyConfig vs standardOverrides 혼동

## Context
Tempo chart v1.x (tempo-1.24.4, Tempo 2.9.0) dev 환경에서 `traces_spanmetrics_*` 메트릭이 생성되지 않는 문제.
원래 OOM 방지 목적으로 `metricsGenerator.enabled: false`였으나, 대시보드 쿼리 검증에서 38개 쿼리가 실패하여 활성화 시도.

## Issue

### 시도 1: `per_tenant_overrides`에 processors 추가
```yaml
per_tenant_overrides:
  "single-tenant":
    metrics_generator:
      processors:
        - service-graphs
        - span-metrics
```

결과: **CrashLoopBackOff**
```
field metrics_generator not found in type overrides.LegacyOverrides
```

### 시도 2: `metricsGenerator.processor`만으로 활성화
```yaml
metricsGenerator:
  enabled: true
  processor:
    service_graphs: {}
    span_metrics: {}
```

결과: Tempo 시작 성공, generator 모듈 시작, 하지만 **`traces_spanmetrics_calls_total` 0 series**. `tempo_distributor_metrics_generator_clients 0` — distributor가 generator에 span을 보내지 않음.

### 시도 3: `overrides.defaults`에 processors 추가
```yaml
overrides:
  defaults:
    metrics_generator:
      processors:
        - service-graphs
        - span-metrics
```

결과: ConfigMap 반영 확인, Tempo 시작 성공, CrashLoopBackOff 없음. **하지만 아직 `tempo_distributor_metrics_generator_clients 0` — 별도 조사 필요.**

## Action

**핵심 발견: Tempo chart v1.x의 두 가지 overrides 경로**

| 경로 | Values 키 | 렌더링 위치 | 타입 | metrics_generator 지원 |
|------|----------|-----------|------|----------------------|
| `tempo.overrides.defaults` | Helm values | `tempo.yaml` 본문 | standardOverrides | ✅ 지원 |
| `tempo.per_tenant_overrides` | Helm values | `overrides.yaml` ConfigMap | **LegacyOverrides** | ❌ 미지원 (파싱 에러) |

- `per_tenant_overrides` → `overrides.yaml` 파일로 렌더링 → runtime config로 로드 → `LegacyOverrides` struct 파싱 → `metrics_generator` 필드 없음 → crash
- `overrides.defaults` → `tempo.yaml` 본문 `overrides.defaults:` 블록으로 렌더링 → `standardOverrides` struct → `metrics_generator` 필드 있음 → 정상

**근본 원인 (Root Cause)**:
- `monitoring.md` 규칙에 "`overrides.defaults` 키 사용 금지"로 기록되어 있었으나, 이는 runtime overrides(`overrides.yaml`)에서의 이야기
- `tempo.yaml` 본문의 `overrides.defaults`는 **정상 동작** — 규칙이 불완전했음
- `metricsGenerator.processor` config만으로는 processors가 활성화되지 않음 — overrides에서 명시적 활성화 필수

**추가 미해결**: `overrides.defaults`에 processors 설정 후에도 `tempo_distributor_metrics_generator_clients 0` — distributor → generator ring 연결 문제. 별도 트러블슈팅 필요.

## Result

- Tempo CrashLoopBackOff 해소, 1/1 Running 안정
- `overrides.defaults.metrics_generator.processors` 반영 확인
- **spanmetrics 데이터 미생성** — distributor → generator ring 연결 문제 (TODO)
- `monitoring.md` 규칙 업데이트 필요: `per_tenant_overrides`에서 `metrics_generator` 미지원 명시, `overrides.defaults`는 사용 가능

## Related Files
- `Goti-monitoring/values-stacks/dev/tempo-values.yaml` — metricsGenerator 활성화 + overrides.defaults
- `.claude/rules/monitoring.md` — 규칙 업데이트 필요
