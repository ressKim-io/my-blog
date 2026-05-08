---
title: "모니터링 대시보드 No Data 5건 종합 해결기"
excerpt: "PromQL 폴백, OTel 히스토그램 버킷, Loki 라벨 승격, HikariCP 메트릭명, 크로스 데이터소스 변수까지 한 번에 정리"
category: monitoring
tags:
  - go-ti
  - Prometheus
  - Grafana
  - Loki
  - OpenTelemetry
  - PromQL
  - Alloy
  - Troubleshooting
series:
  name: "goti-otel-prometheus"
  order: 4
date: "2026-03-09"
---

## 🎯 한 줄 요약

> EC2 모니터링 대시보드 14개를 체계적으로 검증했더니 5건의 No Data 문제가 나왔습니다. PromQL 폴백·히스토그램 버킷·Loki 라벨 승격·메트릭명·크로스 데이터소스 변수 — 원인이 전부 달랐습니다

## 📊 Impact

- **영향 범위**: Recording Rules 5개 + 대시보드 패널 다수
- **소요 시간**: 약 6시간
- **발생일**: 2026-03-09

---

## 🔥 상황

앞선 글들에서 OTel 레이블 매핑 이슈를 해결한 뒤, EC2 환경에서 14개 Grafana 대시보드를 SSM으로 접속해 하나씩 검증했습니다.

트래픽을 보내면서 각 패널의 메트릭 수집 여부를 확인한 결과, 다섯 가지 No Data 문제를 발견했습니다.

| # | 문제 | 영향 |
|---|------|------|
| 1 | SLI Availability recording rule No Data | 가용성 지표 미계산 |
| 2 | Apdex score No Data | 성능 지표 미계산 |
| 3 | Loki log_type 라벨 미승격 | 로그 필터링 불가 |
| 4 | HikariCP 메트릭명 불일치 | DB 커넥션 풀 모니터링 불가 |
| 5 | 크로스 데이터소스 변수 불일치 | Loki/Tempo 쿼리 에러 |

하나씩 살펴보겠습니다.

---

## 🔥 Issue 1: SLI Availability — or vector(0) 함정

### 증상

5xx 에러가 한 건도 없는 정상 상태에서 `goti:sli:availability:5m` 등 5개 recording rule이 No Data를 반환했습니다.

### 🤔 원인

Recording rule의 PromQL을 살펴봤습니다.

```promql
1 - (
  (sum(rate(http_server_request_duration_seconds_count{status_code=~"5.."}[5m])) or vector(0))
  /
  (sum(rate(http_server_request_duration_seconds_count[5m])) > 0)
)
```

현재는 `or vector(0)` 폴백이 있어서 동작합니다.
5xx가 없으면 `sum(rate({5xx}))` = empty → `or vector(0)` = 0 → 정상 계산.

하지만 문제는 **향후 MSA 전환** 시입니다.

`by (job)` 같은 그루핑을 추가하면 `vector(0)`에는 `job` 레이블이 없어서 `or` 매칭이 실패합니다.

```promql
# MSA 전환 후 깨지는 패턴
sum(rate({5xx}[5m])) by (job) or vector(0)
# → vector(0)에 job 레이블 없음 → or 매칭 실패
```

### ✅ 해결

`or vector(0)` → `or on() vector(0)`로 변경했습니다.

```promql
# Before
... or vector(0)

# After
... or on() vector(0)
```

`on()`을 명시하면 레이블 매칭을 무시하고 폴백이 적용됩니다.
5개 availability rule 모두 수정했습니다.

`on()` 없이 `or vector(0)`를 쓰면 단일 서비스에서는 동작하지만, 그루핑이 추가되면 깨집니다. 처음부터 `on()`을 쓰는 것이 안전합니다.

---

## 🔥 Issue 2: Apdex Score — 존재하지 않는 히스토그램 버킷

### 증상

`goti:apdex:score` recording rule이 No Data를 반환했습니다.

### 🤔 원인

Apdex 계산에서 `le="2.0"` 버킷을 사용하고 있었습니다.

문제는 OTel 기본 히스토그램 버킷에 `2.0`이 없다는 것입니다.

```
OTel 기본 버킷:
[0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1.0, 2.5, 5.0, 7.5, 10.0]
```

`le="2.0"` 버킷은 존재하지 않으니 쿼리 결과가 empty → Apdex 계산 불가.

Micrometer 시절에는 커스텀 버킷을 사용해서 `2.0`이 있었지만, OTel로 전환하면서 기본 버킷을 쓰게 된 것입니다.

### ✅ 해결

```promql
# Before
le="2.0"   # 존재하지 않는 버킷

# After
le="2.5"   # 가장 가까운 OTel 기본 버킷
```

Apdex 임계값이 2.0초에서 2.5초로 약간 느슨해졌지만, 현실적으로 2.0~2.5초 구간의 차이가 Apdex 점수에 미치는 영향은 미미합니다.

**OTel 히스토그램 버킷 목록을 확인하지 않고 PromQL을 작성하면 이런 문제가 생깁니다.**

---

## 🔥 Issue 3: Loki log_type 라벨 미승격

### 증상

Alloy transform processor에서 `loki.attribute.labels` 힌트로 `log_type` 라벨을 승격시키려 했는데, Loki에 라벨이 생성되지 않았습니다.

### 🤔 원인

Alloy v1.8.3에서 `loki.attribute.labels` 힌트가 작동하지 않는 **알려진 이슈**였습니다.

관련 GitHub 이슈:
- [#2064](https://github.com/grafana/alloy/issues/2064)
- [#1879](https://github.com/grafana/alloy/issues/1879)
- [#2757](https://github.com/grafana/alloy/issues/2757)

세 가지 대안을 검토했습니다.

| 대안 | 설명 | 장단점 |
|------|------|--------|
| A. `loki.process` 파이프라인 | JSON 파싱 후 라벨 승격 | 현재 구조에 최소 변경 |
| B. resource attribute 복사 | OTel 리소스 속성으로 전달 | 파이프라인 수정 범위 큼 |
| C. Loki native OTLP | Loki OTLP 엔드포인트 직접 사용 | 아키텍처 변경 필요 |

현재 구조에 최소 변경으로 적용할 수 있는 A안을 선택했습니다.

### ✅ 해결

파이프라인을 변경했습니다

- **Before**: `otelcol.exporter.loki → loki.write`
- **After**: `otelcol.exporter.loki → loki.process → loki.write`

`loki.process`에서 `stage.json`으로 `attributes.log_type`을 추출하고, `stage.labels`로 인덱스 라벨로 승격시켰습니다.

```alloy
loki.process "add_labels" {
  stage.json {
    expressions = {
      log_type = "attributes.log_type",
    }
  }
  stage.labels {
    values = {
      log_type = "",
    }
  }
  forward_to = [loki.write.default.receiver]
}
```

Alloy 컨테이너는 config 변경 시 자동 reload되지 않아서, 컨테이너를 재시작해야 했습니다.

---

## 🔥 Issue 4: HikariCP 메트릭명 — seconds가 아니라 milliseconds

### 증상

JVM Deep Dive 대시보드에서 HikariCP 커넥션 풀 패널이 No Data였습니다.

### 🤔 원인

대시보드와 실제 Prometheus 메트릭명이 달랐습니다.

```
대시보드:  db_client_connections_create_time_seconds_bucket
실제:     db_client_connections_create_time_milliseconds_bucket
```

OTel Java agent가 레거시 `_milliseconds` 접미사를 사용하고 있었습니다.
새로운 semantic conventions(`_seconds`)는 opt-in이 필요합니다.

또한 `db_client_connections_timeouts_total`이라는 메트릭은 아예 존재하지 않았습니다.

### ✅ 해결

```promql
# Before
db_client_connections_create_time_seconds_bucket
# After
db_client_connections_create_time_milliseconds_bucket
```

단위도 `s` → `ms`로 변경했습니다.
Connection Timeout Rate 패널은 존재하지 않는 메트릭을 참조하고 있어서, Connection Create Time 패널로 교체했습니다.

---

## 🔥 Issue 5: 크로스 데이터소스 변수 불일치

### 증상

하나의 대시보드에서 Prometheus, Loki, Tempo 세 데이터소스를 동시에 사용하는데, 서비스 이름 체계가 달랐습니다.

```
Prometheus job:            goti/goti-server
Loki service_name:         goti-server
Tempo resource.service.name: goti-server
```

`$service_name` 변수에 Prometheus의 `goti/goti-server` 값이 들어가면, Loki 쿼리에서 에러가 발생했습니다.

```
Loki 쿼리 에러: "queries require at least one regexp or equality matcher
that does not have an empty-compatible value"
```

### 🤔 원인

OTel → Prometheus에서는 `job = <namespace>/<service.name>` 형태지만, Loki와 Tempo는 `service.name` 값을 그대로 사용합니다.

데이터소스마다 서비스 이름 체계가 다른 것이 근본 원인입니다.

### ✅ 해결

숨겨진 `$svc` 변수를 추가했습니다.

```
$service_name = "goti/goti-server"  (Prometheus job 레이블 값)
$svc = "goti-server"                (regex로 추출한 순수 서비스명)
```

변수 설정:
- 소스: `label_values(http_server_request_duration_seconds_count, job)`
- Regex: `.*/(.+)` → `goti/goti-server`에서 `goti-server` 추출

각 데이터소스별로 사용하는 변수를 분리했습니다.

| 데이터소스 | 변수 | 값 |
|-----------|------|-----|
| Prometheus | `$service_name` | `goti/goti-server` |
| Loki | `$svc` | `goti-server` |
| Tempo | `$svc` | `goti-server` |

```promql
# Prometheus 쿼리
http_server_request_duration_seconds_count{job="$service_name"}

# Loki 쿼리
{service_name="$svc"} |= "ERROR"

# Tempo TraceQL
{resource.service.name="$svc"}
```

추가로 에러 분석 대시보드에 `or on() vector(0)` 폴백, noValue 설정, 로그 패널 ERROR/WARN 분리도 적용했습니다.

---

## 검증 결과

EC2 SSM으로 최종 검증을 완료했습니다.

| 항목 | 값 | 상태 |
|------|-----|------|
| `goti:sli:availability:5m` | 1 (100%) | 정상 |
| `goti:apdex:score` | 1 (만점) | 정상 |
| `goti:sli:latency_p99:5m` | ~10ms | 정상 |
| Loki `log_type` 라벨 | `["app"]` | 정상 |
| `or on() vector(0)` 폴백 | 0 반환 | 정상 |

모든 recording rule과 대시보드 패널이 정상 데이터를 표시하고 있었습니다.

---

## 📚 배운 점

### 5가지 No Data의 공통점

원인은 전부 달랐지만, 공통점이 있습니다.

**Micrometer에서 OTel로 전환하면서 "당연히 같을 것"이라고 가정한 것들이 달랐습니다.**

| 가정 | 현실 |
|------|------|
| 히스토그램 버킷이 같을 것 | OTel 기본 버킷에 `2.0`이 없음 |
| 메트릭 단위가 seconds일 것 | OTel Java agent는 milliseconds |
| service.name이 모든 곳에서 같을 것 | Prometheus만 `namespace/name` 형태 |
| Alloy 힌트가 동작할 것 | known issue로 미작동 |

### 검증 체크리스트

OTel 전환 후 대시보드를 마이그레이션할 때 확인해야 할 항목들입니다.

1. **PromQL 폴백**: `or vector(0)` 대신 `or on() vector(0)` 사용
2. **히스토그램 버킷**: OTel 기본 버킷 목록 확인 후 `le` 값 설정
3. **메트릭 단위**: `_seconds` vs `_milliseconds` 실제 메트릭명 확인
4. **크로스 데이터소스**: Prometheus, Loki, Tempo의 서비스 이름 체계 차이 확인
5. **Alloy 버전 이슈**: 사용 중인 기능이 known issue에 해당하는지 확인

### 미해결 후속 작업

- **Alloy 자동 재시작**: Docker Compose에서 config 변경 시 Alloy 컨테이너가 자동 reload되지 않음
- **JWT stacktrace**: 401 WARN 로그에 전체 stacktrace가 포함되어 Loki 저장소를 과다 사용 중

이 시리즈를 통해 OTel 전환의 레이블 이슈를 총정리했습니다. SDK 버전 충돌부터 크로스 데이터소스 변수까지, 결국 **실측 검증 없이는 안전한 마이그레이션이 불가능하다**는 것이 핵심 교훈입니다.
