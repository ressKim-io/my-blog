---
title: "Tempo metricsGenerator 활성화 삽질 — legacyConfig vs standardOverrides 혼동"
excerpt: "Tempo chart v1.x에서 metrics_generator processors를 활성화하려다 두 가지 overrides 경로의 타입 차이로 CrashLoop에 빠진 사건입니다. overrides.defaults와 per_tenant_overrides가 서로 다른 struct로 파싱된다는 사실을 알아낸 기록입니다"
type: troubleshooting
category: monitoring
tags:
  - go-ti
  - Observability
  - Tempo
  - MetricsGenerator
  - Helm
  - Troubleshooting
series:
  name: "goti-observability-ops"
  order: 6
date: "2026-03-25"
---

## 한 줄 요약

> Tempo chart v1.x에서 `metricsGenerator.enabled: true`만 켜도 spanmetrics가 생성되지 않았습니다. overrides에서 processors를 명시적으로 활성화해야 하는데, `per_tenant_overrides`에 넣으면 LegacyOverrides 타입으로 파싱되어 crash하고, `overrides.defaults`에 넣어야 standardOverrides 타입으로 정상 동작하는 문제였습니다.

## Impact

- **영향 범위**: Tempo dev 환경의 metricsGenerator 전체, 대시보드 38개 쿼리
- **증상**: CrashLoopBackOff 또는 `traces_spanmetrics_*` 0 series
- **환경**: tempo-1.24.4 (Helm chart), Tempo 2.9.0
- **발생일**: 2026-03-25

---

## 🔥 문제: metricsGenerator를 켜도 spanmetrics가 생성되지 않음

### 기존 상태

Tempo dev 환경에서는 원래 OOM 방지 목적으로 `metricsGenerator.enabled: false`로 비활성화되어 있었습니다.
metricsGenerator는 trace span을 집계해 `traces_spanmetrics_*` 메트릭을 뽑아내는 모듈인데, 메모리 사용량이 커서 기본적으로 꺼둔 상태였습니다.

### 발견한 문제

대시보드 쿼리 검증 과정에서 38개 쿼리가 실패한다는 것이 드러났습니다.
모두 `traces_spanmetrics_calls_total`, `traces_spanmetrics_latency_bucket` 같은 spanmetrics 기반 쿼리였습니다.

metricsGenerator를 활성화해야 한다는 결론에 도달했고, 여기서부터 삽질이 시작됐습니다.

---

## 🤔 원인: overrides의 두 경로가 서로 다른 struct로 파싱됨

### 시도 1: per_tenant_overrides에 processors 추가 → CrashLoop

가장 먼저 per-tenant 오버라이드 경로로 processors를 넣었습니다.

```yaml
per_tenant_overrides:
  "single-tenant":
    metrics_generator:
      processors:
        - service-graphs
        - span-metrics
```

결과는 CrashLoopBackOff였습니다. Tempo 로그에 다음 에러가 찍혔습니다.

```text
field metrics_generator not found in type overrides.LegacyOverrides
```

이 메시지가 원인을 정확히 알려줍니다.
`per_tenant_overrides`로 지정한 값은 `overrides.yaml`이라는 별도 ConfigMap으로 렌더링되고, Tempo가 이를 runtime config로 로드할 때 `LegacyOverrides` struct로 파싱합니다.
그런데 `LegacyOverrides` struct에는 `metrics_generator` 필드가 존재하지 않았습니다.
필드 없는 키를 만나자 파싱이 실패하고 프로세스가 죽은 것입니다.

### 시도 2: metricsGenerator.processor만으로 활성화 → 0 series

processors를 overrides에서 제거하고 `metricsGenerator.processor` 블록으로만 설정을 옮겼습니다.

```yaml
metricsGenerator:
  enabled: true
  processor:
    service_graphs: {}
    span_metrics: {}
```

이번에는 Tempo가 정상적으로 시작됐고 generator 모듈도 올라왔습니다.
그런데 메트릭을 확인해보니 `traces_spanmetrics_calls_total`이 0 series였습니다.

distributor 쪽 메트릭을 함께 보니 원인이 보였습니다.

```text
tempo_distributor_metrics_generator_clients 0
```

distributor가 generator에 span을 보내고 있지 않았습니다.
즉 `metricsGenerator.processor` 설정만으로는 processors가 **활성화**되지 않고, overrides에서 명시적으로 활성화해야 distributor가 generator ring에 붙습니다.

### 시도 3: overrides.defaults에 processors 추가 → 시작 성공

`per_tenant_overrides`가 아닌 `overrides.defaults`에 processors를 넣었습니다.

```yaml
overrides:
  defaults:
    metrics_generator:
      processors:
        - service-graphs
        - span-metrics
```

이번에는 ConfigMap에 반영된 것을 확인했고, Tempo도 정상적으로 시작했습니다.
CrashLoopBackOff가 없어진 것입니다.

### 두 경로의 타입 차이

여기서 핵심은 같은 `metrics_generator` 키라도 어느 경로로 들어가느냐에 따라 파싱 struct가 달라진다는 것입니다.

| 경로 | Values 키 | 렌더링 위치 | 파싱 타입 | metrics_generator 지원 |
|------|----------|-----------|---------|----------------------|
| overrides.defaults | Helm values의 `tempo.overrides.defaults` | `tempo.yaml` 본문의 `overrides.defaults:` 블록 | standardOverrides | 지원 |
| per_tenant_overrides | Helm values의 `tempo.per_tenant_overrides` | 별도 `overrides.yaml` ConfigMap | LegacyOverrides | 미지원 (파싱 에러) |

두 경로의 동작을 풀어서 설명하면 다음과 같습니다.

`overrides.defaults`는 Helm이 `tempo.yaml` 본문의 `overrides.defaults:` 블록에 직접 삽입합니다.
Tempo 본체가 시작하면서 standardOverrides struct로 파싱하고, 이 struct는 `metrics_generator` 필드를 가지고 있어 processors 배열을 그대로 받아들입니다.

`per_tenant_overrides`는 Helm이 별도의 `overrides.yaml` 파일로 렌더링하고, 이를 ConfigMap으로 마운트합니다.
Tempo는 이 파일을 runtime config로 동적 로드하는데, 이때 사용하는 struct가 `LegacyOverrides`입니다.
Legacy라는 이름에서 알 수 있듯이 예전 포맷을 유지하기 위한 구조체이고, 새로 추가된 `metrics_generator` 필드가 아직 들어있지 않습니다.

### 내부 문서가 오해를 부른 부분

팀 내부 `monitoring.md` 규칙에는 "`overrides.defaults` 키 사용 금지"라는 조항이 있었습니다.
이 규칙은 과거 runtime overrides(`overrides.yaml`)에서 `defaults` 키를 잘못 쓴 사례를 금지한 것이었는데, 규칙 문장이 포괄적으로 써져 있어 `tempo.yaml` 본문의 `overrides.defaults`까지 금지로 오해할 여지가 있었습니다.

실제로 `tempo.yaml` 본문의 `overrides.defaults`는 standardOverrides 구조로 정상 동작하는 공식 경로였습니다.
규칙이 불완전했던 것이 시도 1을 오래 붙잡고 있었던 원인입니다.

---

## ✅ 해결: overrides.defaults로 processors 활성화

### 적용한 설정

최종적으로 `tempo-values.yaml`에 다음과 같이 반영했습니다.

```yaml
metricsGenerator:
  enabled: true
  processor:
    service_graphs: {}
    span_metrics: {}

overrides:
  defaults:
    metrics_generator:
      processors:
        - service-graphs
        - span-metrics
```

두 블록의 역할을 나누면 다음과 같습니다.

- `metricsGenerator.processor`: generator 모듈 자체의 processor 설정(세부 파라미터)
- `overrides.defaults.metrics_generator.processors`: tenant별 processors **활성화 목록**

distributor는 overrides의 processors 목록을 보고 어떤 processor에 span을 보낼지 결정합니다.
이 목록이 비어 있으면 아무리 generator 모듈이 떠 있어도 span이 전달되지 않습니다.

### 배포 후 확인

Pod가 1/1 Running으로 안정됐고, CrashLoopBackOff는 사라졌습니다.

```bash
$ kubectl -n monitoring get pod -l app.kubernetes.io/name=tempo
NAME              READY   STATUS    RESTARTS   AGE
tempo-generator   1/1     Running   0          3m
```

ConfigMap에도 overrides가 반영된 것을 확인했습니다.

```bash
$ kubectl -n monitoring get cm tempo -o yaml | grep -A3 "overrides"
overrides:
  defaults:
    metrics_generator:
      processors:
        - service-graphs
        - span-metrics
```

### 남은 문제 (후속 트러블슈팅)

processors 설정이 반영된 후에도 아래 메트릭이 여전히 0이었습니다.

```text
tempo_distributor_metrics_generator_clients 0
```

distributor → generator ring 연결 자체가 붙지 않는 별도 문제로 보였고, 이는 후속 트러블슈팅 주제로 분리했습니다.

---

## 📚 배운 점

- **Tempo overrides는 경로에 따라 파싱 타입이 다릅니다.** `overrides.defaults`는 standardOverrides, `per_tenant_overrides`는 LegacyOverrides로 로드되며, 후자는 `metrics_generator` 필드를 아직 지원하지 않습니다.
- **에러 메시지의 struct 이름은 원인 추적의 핵심 단서**입니다. `overrides.LegacyOverrides`라는 이름을 본 시점에 두 경로가 서로 다른 구조체라는 것을 의심했어야 했습니다.
- **metricsGenerator는 두 곳에서 모두 활성화해야 동작**합니다. 모듈 설정(`metricsGenerator.processor`)만으로는 distributor가 generator에 span을 보내지 않고, overrides에서 processors를 명시해야 ring이 연결됩니다.
- **"금지 규칙"은 맥락을 반드시 함께 기록**해야 합니다. `overrides.defaults` 금지라는 문장이 어떤 파일의 어떤 경로를 의미했는지 맥락이 빠지면, 다음 사람이 정상 경로까지 막게 됩니다.
- **distributor 쪽 메트릭을 보는 습관**이 중요합니다. `tempo_distributor_metrics_generator_clients`가 0이면 generator 모듈 상태와 무관하게 데이터가 흐르지 않으며, 이 지표 하나로 "설정은 붙었지만 배선이 안 된 상태"를 빠르게 가려낼 수 있습니다.
