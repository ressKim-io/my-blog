---
date: 2026-03-09
category: troubleshoot
project: Goti-monitoring
tags: [promql, recording-rule, loki, alloy, grafana, cross-datasource, otel, hikaricp, no-data]
---

# 모니터링 대시보드 전체 No Data 종합 해결 (5건)

## Context
Goti-monitoring EC2 환경에서 14개 Grafana 대시보드를 SSM으로 접속하여 체계적으로 검증.
트래픽을 전송하며 각 패널의 메트릭 수집 여부를 확인한 결과, 다수의 No Data 문제 발견.

## Issue 1: SLI Availability Recording Rule — No Data

5xx 에러가 없는 정상 상태에서 `goti:sli:availability:5m` 등 5개 recording rule이 No Data 반환.

```
recording rule expr:
1 - (
  (sum(rate({5xx}[5m])) or vector(0))
  /
  (sum(rate({all}[5m])) > 0)
)

문제: sum(rate({5xx})) = empty (not 0), "empty or vector(0)" = 0 → 동작하지만
      향후 MSA 전환 시 by 그루핑 추가하면 label 매칭 실패 가능
```

재현 조건: 5xx 에러가 한 건도 없는 환경

### Action
1. 가설: `sum(rate({5xx}))` 결과가 empty → `or vector(0)` 폴백 필요 → 결과: 맞음, 이미 적용돼 있었음
2. 외부 검색: `or vector(0)` vs `or on() vector(0)` 비교 → 결과: `on()` 명시가 MSA 전환 시 안전

Root Cause: `or vector(0)`는 단일 서비스에서 동작하지만, `by` 그루핑 추가 시 레이블 매칭 문제 발생 가능.

수정:
- 5개 availability rule: `or vector(0)` → `or on() vector(0)`

## Issue 2: Apdex Score — No Data

```
le="2.0" 버킷이 OTel 기본 히스토그램 버킷에 존재하지 않음.
OTel 기본 버킷: [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1.0, 2.5, 5.0, 7.5, 10.0]
```

### Action
Root Cause: `le="2.0"` 미존재 → 해당 bucket 쿼리 결과 없음 → Apdex 계산 불가.

수정:
- `le="2.0"` → `le="2.5"` (가장 가까운 기본 버킷)

## Issue 3: Loki log_type 라벨 미승격

Alloy transform processor에서 `loki.attribute.labels` 힌트로 `log_type` 라벨 승격 시도했으나 Loki에 라벨 미생성.

### Action
1. 가설: `loki.attribute.labels` 힌트 미작동 → 결과: Alloy v1.8.3 known issue 확인 (GitHub #2064, #1879, #2757)
2. 대안 검토: (A) loki.process, (B) resource attribute 복사, (C) Loki native OTLP
3. 선택: `loki.process` stage.json + stage.labels — 현재 구조에 최소 변경

Root Cause: Alloy v1.8.3에서 `loki.attribute.labels` 힌트가 미작동하는 알려진 이슈.

수정:
- `otelcol.exporter.loki` → `loki.process` → `loki.write` 파이프라인으로 변경
- `stage.json`으로 `attributes.log_type` 추출 → `stage.labels`로 인덱스 라벨 승격
- Alloy 컨테이너 재시작 필요 (config 변경 시 자동 reload 안 됨)

## Issue 4: JVM Deep Dive HikariCP 메트릭 불일치

```
대시보드: db_client_connections_create_time_seconds_bucket
실제 Prometheus: db_client_connections_create_time_milliseconds_bucket

대시보드: db_client_connections_timeouts_total (미존재 메트릭)
```

### Action
Root Cause: OTel Java agent가 레거시 `_milliseconds` suffix 사용 (새 semantic conventions opt-in 필요).

수정:
- `_seconds_bucket` → `_milliseconds_bucket`, 단위 `s` → `ms`
- Connection Timeout Rate 패널 → Connection Create Time 패널로 교체

## Issue 5: Cross-Datasource 변수 불일치

```
$service_name = "goti/goti-server" (Prometheus job 라벨)
Loki service_name = "goti-server"
Tempo resource.service.name = "goti-server"

Loki 쿼리 에러: "queries require at least one regexp or equality matcher
that does not have an empty-compatible value"
```

### Action
1. 가설: `label_values({job="$service_name"}, service_name)` 쿼리로 파생 → 결과: http 메트릭에 `service_name` 라벨 없어서 빈 값 반환
2. 수정: regex `.*/(.+)`로 job 값에서 서비스명 추출

Root Cause: OTel → Prometheus에서 `job` = `<namespace>/<service.name>`, Loki/Tempo는 `service.name` 직접 사용. 데이터소스 간 이름 체계 불일치.

수정:
- 숨겨진 `$svc` 변수 추가: `label_values(http_server_request_duration_seconds_count, job)` + `regex: ".*/(.+)"`
- Loki 쿼리: `service_name="$svc"`, Tempo: `resource.service.name="$svc"`
- Prometheus 쿼리: 기존 `job="$service_name"` 유지
- 에러 분석 대시보드: 에러율 `or on() vector(0)` 추가, noValue 설정, 로그 패널 ERROR/WARN 분리

## Result

EC2 SSM 검증 완료:

| Recording Rule | 값 | 상태 |
|---|---|---|
| `goti:sli:availability:5m` | 1 (100%) | 정상 |
| `goti:apdex:score` | 1 (만점) | 정상 |
| `goti:sli:latency_p99:5m` | ~10ms | 정상 |
| Loki `log_type` 라벨 | `["app"]` | 정상 |
| `or on() vector(0)` 폴백 | 0 반환 | 정상 |

재발 방지:
- Recording rule에 새 availability 윈도우 추가 시 `or on() vector(0)` 패턴 준수
- Grafana 대시보드에서 Loki/Tempo 쿼리 시 `$svc` 변수 사용 (Prometheus `$service_name` 아님)
- OTel 히스토그램 기본 버킷 목록 확인 후 PromQL 작성

## 미해결 (후속 작업)
- **Alloy CI/CD 재시작**: docker-compose 수정 필요 (config 변경 시 Alloy 컨테이너 자동 재시작 안 됨)
- **JwtAuthenticationEntryPoint stacktrace**: 401 WARN 로그에 전체 stacktrace 포함 → Loki 저장소 부담. Goti-server 이슈로 등록 예정

## Related Files
- `Goti-monitoring/prometheus/rules/recording.yml`
- `Goti-monitoring/alloy/config.alloy`
- `Goti-monitoring/grafana/dashboards/developer/jvm-deep-dive.json`
- `Goti-monitoring/grafana/dashboards/developer/error-analysis.json`
- `Goti-monitoring/grafana/dashboards/developer/distributed-tracing.json`
