---
date: 2026-03-15
category: troubleshoot
project: Goti-monitoring
tags: [tempo, loki, traceql, logql, grafana, 400-error, JSONParserErr]
---

# 대시보드 고도화 중 발견한 모니터링 버그 6건

## 버그 목록

### 1. TraceQL Grafana multi-value 변수 =~ 호환 안 됨

**증상**: 분산 추적 대시보드 TraceQL 패널 400 에러
**원인**: `span.http.route=~"$http_route"` — PromQL의 `=~`는 Grafana가 pipe-separated 변환해주지만 TraceQL은 미지원
**수정**: `=~"$http_route"` 필터 제거, `select(span.http.route)` 로 결과 표시만
**영향**: distributed-tracing 2곳, error-analysis 1곳

### 2. Tempo v2 API scoped tag 필수

**증상**: Grafana에서 Tempo 관련 기능 사용 시 400 에러
**원인**: `tracesToLogsV2.tags` key가 `service.name` (unscoped) → Tempo v2 API는 scoped name만 허용
**수정**: `service.name` → `resource.service.name` (kps values + provisioning 6곳)
**참고**: Grafana 공식 문서 기본값이 unscoped라 문서만 보면 틀림

### 3. TraceQL unscoped intrinsic `kind=client`

**증상**: db-dependencies 대시보드 External Call 패널 400 에러
**원인**: `kind=client` 는 잘못된 문법. 올바른 형태: `span.kind=client`
**수정**: `kind=client` → `span.kind=client`, `span.url.full` → `span.http.url`
**발견**: lint-dashboards.sh가 자동 탐지

### 4. TraceQL `span.db.system=~"$db_system"` 변수 regex

**증상**: db-dependencies Slow DB Query 패널 잠재적 400 에러
**원인**: 2번과 동일 원인 (TraceQL + Grafana multi-value 변수 비호환)
**수정**: `span.db.system=~"$db_system"` → `span.db.system != nil`
**발견**: lint-dashboards.sh가 자동 탐지

### 5. Loki alert rule `level=` (구 방식)

**증상**: PaymentErrorSpike 알림이 작동하지 않음
**원인**: Native OTLP 경로에서는 `detected_level` 이어야 하는데 `level` 사용
**수정**: `level=~"error|ERROR"` → `detected_level="ERROR"`
**발견**: pitfall 검증 agent가 탐지

### 6. LogQL `| json` 불필요 파싱 → JSONParserErr

**증상**: Error Analysis "에러 로그 Logger별 분포" 패널 에러
**원인**: `logger`는 OTel log attribute → structured metadata로 이미 저장됨. `| json`으로 plain text 로그를 파싱하려다 실패
**수정**: `| json | logger != ""` → `| logger != ""` (| json 제거)
**발견**: 실제 Grafana UI에서 사용자가 발견

## 공통 근본 원인

**OTel + LGTM 스택의 문법이 빠르게 변하면서**:
- Tempo v1 → v2 API: scoped tag 필수
- Loki Promtail → Native OTLP: `level` → `detected_level`, structured metadata
- TraceQL: Grafana 변수 interpolation 방식이 PromQL과 다름
- OTel semantic conventions: stable vs unstable attribute name 변경

AI(Claude)가 구버전 문법이나 PromQL 패턴을 TraceQL에 그대로 적용하면서 에러 발생. 이를 방지하기 위해 monitoring-pitfalls.md + lint-dashboards.sh 체계를 구축함.
