---
date: 2026-03-15
category: meta
project: goti-team-controller, Goti-k8s
tags: [monitoring-pitfalls, ai-workflow, validation, lint, observability, claude-code]
---

# Monitoring Pitfalls 체계 구축 — AI가 모니터링 문법을 틀리지 않도록

## Context

Developer 대시보드 고도화 작업 중 여러 문법/호환성 오류가 발생했다:
- TraceQL에서 Grafana multi-value 변수 `=~` 사용 → Tempo 400 에러
- Tempo v2 API에서 unscoped tag name → 400 에러
- LogQL에서 `| json` 불필요 사용 → JSONParserErr
- Loki alert rule에서 `level=` 사용 → `detected_level=` 이어야 함

이런 문제들이 반복적으로 발생하는 이유: **OTel + LGTM 스택의 문법이 최신 버전에서 많이 바뀌었고, AI(Claude)가 구버전 문법으로 코드를 생성하는 경우가 있었다.**

근본 해결: AI가 참고할 수 있는 문서 + 규칙 + 검증 스크립트를 체계적으로 구축.

## 구축한 체계

### 1. monitoring-pitfalls.md (19개 섹션, 700줄)

모니터링 수정 시 자주 발생하는 문법/호환성 문제를 정리한 참조 문서.

| 섹션 | 핵심 |
|------|------|
| TraceQL 변수 | `=~` regex 금지, scope 규칙, Tempo 2.8 신기능 |
| Tempo 설정 | v2 scoped tag, span_metrics dimensions, local_blocks |
| Loki LogQL & OTLP | Native OTLP vs LokiExporter, `detected_level`, structured metadata, `| json` 규칙 |
| PromQL | multi-value `=~`, `or on() vector(0)`, histogram_quantile |
| OTel Semantic Conventions | stable HTTP 속성 매핑, 메트릭명 변환, resource vs span |
| Alloy | River 문법, `loki.attribute.labels` 미작동 |
| Mimir | recording rule, PrometheusRule selector |
| Pyroscope | tag에 `.` 불가, CPU only |
| Grafana JSON | datasource UID, data link, merge, 셀 색상 |
| Apdex | OTel 버킷 `le="2.5"` |
| Helm Chart 동기화 | 6단계 체크리스트 |
| Tail Sampling | 정책 순서, prod 조정 |
| Loki Retention | 법적 보관기간 |
| Mimir Kafka | partition 수 |
| Recording Rule MSA | `by (job)` 전환 대비 |
| Datasource UID | 변경 금지 |
| PrometheusRule | selector label 매칭 |
| Istio mTLS | PERMISSIVE 유지 |

### 2. .claude/rules/monitoring.md (자동 적용 규칙)

모니터링 관련 작업 시 **모든 대화에 자동 로드**되는 규칙. pitfalls 문서 참조를 강제하고 핵심 체크리스트를 포함.

### 3. Skills 6개 업데이트

| Skill | 추가 내용 |
|-------|----------|
| monitoring-grafana | TraceQL 변수 제약, Tempo scoped tags, internal link |
| logging-loki | Native OTLP 비교표, detected_level 대문자, structured metadata |
| observability-otel | stable semconv 매핑, Tempo v2 API, Alloy River, span vs resource |
| monitoring-metrics | `or on() vector(0)`, histogram_quantile by(le), 나눗셈 보호 |
| otel-optimization | Loki native OTLP 권장 대안 |
| kube-prometheus-stack | Apdex 버킷, PrometheusRule selector |

**효과**: AI가 모니터링 코드를 생성할 때 최신 문법을 참고할 수 있게 됨.

### 4. Agents 4개 업데이트

| Agent | 추가 내용 |
|-------|----------|
| otel-expert | Goti pitfalls 참조, tail sampling, span metrics 카디널리티 |
| k8s-troubleshooter | 모니터링 스택 진단 섹션 |
| incident-responder | 모니터링 검증 체크리스트 |
| debugging-expert | TraceQL/LogQL/PromQL 상관 분석 |

**효과**: 전문 agent가 모니터링 관련 작업 시 pitfalls를 인식하고 사전 회피.

### 5. 검증 스크립트 체계 (Goti-k8s)

#### lint-dashboards.sh (신규) — 오프라인 pitfalls 검증
클러스터 없이 대시보드 JSON만으로 8개 항목 검증:
- TraceQL `=~"$` 변수 regex
- TraceQL unscoped intrinsic (`kind=` vs `span.kind=`)
- LogQL `level=` vs `detected_level=`
- PromQL `histogram_quantile` + `by (le)` 누락
- Datasource UID 허용 목록
- Tempo datasource tags scoped
- Loki alert rules `level=`
- JSON validity

**핵심 가치**: `./validate.sh --lint-only` 한 번으로 push 전에 오늘 겪었던 모든 종류의 400 에러를 사전에 잡을 수 있다.

#### check-coverage.sh (신규) — 대시보드 ↔ 테스트 데이터 커버리지
대시보드에서 사용하는 메트릭/label이 테스트 데이터에 있는지 확인. 대시보드 추가 시 payload 업데이트 누락 방지.

#### payloads/metrics.json 보강
11개 JVM/Process 메트릭 추가 (class, buffer, cpu.time, process.cpu.start_time 등).

#### extract-queries.sh 변수 치환 업데이트
새 대시보드 변수 7개 추가 (http_route, log_level, span_name, db_system, instance 등).

### 6. validate.sh 통합

```bash
# 대시보드 수정 후, push 전 (클러스터 불필요)
./validate.sh --lint-only    # 오프라인 lint + 커버리지

# Kind 클러스터에서 전체 검증
./validate.sh               # lint → port-forward → 전송 → 추출 → 검증
```

## 발견한 실제 버그 (이 체계로 탐지)

| 버그 | 발견 방법 | 영향 |
|------|----------|------|
| TraceQL `span.http.route=~"$http_route"` | 수동 발견 → lint에 규칙 추가 | Tempo 400 에러 |
| Tempo tags `service.name` (unscoped) | 외부 검색으로 확인 | Tempo v2 API 400 에러 |
| `kind=client` (unscoped intrinsic) | lint-dashboards.sh가 탐지 | TraceQL 400 에러 |
| `span.db.system=~"$db_system"` | lint-dashboards.sh가 탐지 | TraceQL 400 에러 |
| Loki alert `level=` | pitfall 검증 agent가 탐지 | 알림 미작동 |
| `| json | logger` (불필요 JSON 파싱) | 실제 Grafana에서 JSONParserErr | 패널 에러 |

## 교훈

1. **문서화 → 규칙화 → 자동화** 순서가 효과적. 문서만으로는 AI도 사람도 놓치지만, lint 스크립트가 잡아준다.
2. **OTel + LGTM 스택은 문법 변경이 빠르다**. Grafana 공식 문서조차 Tempo v2와 불일치하는 부분이 있다. 실제 API 동작 기준으로 검증해야 한다.
3. **AI가 생성하는 코드의 품질은 참고할 수 있는 지식의 품질에 비례한다.** skills/rules를 최신화하면 AI 출력이 즉시 개선된다.
