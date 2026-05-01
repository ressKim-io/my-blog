---
title: "모니터링 Pitfalls 체계 구축 — AI가 문법을 틀리지 않도록"
excerpt: "OTel + LGTM 스택의 자주 틀리는 문법을 문서화·규칙화·자동화로 엮어 AI가 생성하는 모니터링 코드 품질을 끌어올린 기록입니다"
category: monitoring
tags:
  - go-ti
  - Observability
  - Monitoring
  - Pitfalls
  - Grafana
  - Tempo
  - Loki
  - PromQL
  - LogQL
  - TraceQL
  - AI-Workflow
  - troubleshooting
series:
  name: "goti-observability-ops"
  order: 9
date: "2026-03-15"
---

## 한 줄 요약

> Developer 대시보드 고도화 중 TraceQL·LogQL·PromQL 문법 오류가 반복 발생했습니다. AI가 참고할 pitfalls 문서, 자동 로드 규칙, lint 스크립트를 함께 구축해 push 전에 400 에러를 잡는 체계를 만들었습니다.

---

## 🔥 문제: 왜 같은 실수가 반복되는가

대시보드 고도화 작업을 진행하면서 여러 문법·호환성 오류가 반복적으로 발생했습니다.
대표적인 증상은 다음과 같습니다.

- TraceQL에서 Grafana multi-value 변수에 `=~`를 사용해 Tempo 400 에러 발생
- Tempo v2 API에서 unscoped tag name을 넣어 400 에러 발생
- LogQL에서 불필요한 `| json`을 붙여 `JSONParserErr` 발생
- Loki alert rule에서 `level=`을 사용해 알림이 동작하지 않음 (실제로는 `detected_level=`)

이 문제들이 반복되는 이유는 **OTel + LGTM 스택의 문법이 최신 버전에서 많이 바뀌었다**는 점에 있습니다.
공식 문서 일부가 최신 동작과 어긋나 있고, AI(Claude)가 구버전 문법으로 코드를 생성하는 경우가 있었습니다.

근본 해결은 개별 수정이 아니라, AI와 사람 모두가 참고할 수 있는 **문서·규칙·검증 스크립트**를 체계적으로 구축하는 것이었습니다.

---

## 🤔 원인: 지식의 최신성과 실행 검증의 부재

오류가 반복된 배경을 세 가지로 정리할 수 있습니다.

첫째, **문법 변경 속도가 빠릅니다**.
Tempo, Loki, Grafana는 릴리스마다 쿼리 문법과 API를 바꿔왔습니다.
Tempo v2 API는 scoped tag name을 강제하고, Loki는 `level` 대신 `detected_level` structured metadata로 전환했습니다.

둘째, **공식 문서와 실제 동작이 불일치**하는 경우가 있습니다.
Grafana 문서에 있는 예제가 Tempo 최신 버전에서 400을 반환하거나, LokiExporter 예제가 native OTLP 경로와 다른 동작을 하는 사례가 있었습니다.

셋째, **실행 검증 없이 push되는 경로**가 있었습니다.
대시보드 JSON은 Grafana에서 열어보기 전에는 오류를 확인하기 어렵고, 알림 규칙은 실제 알림이 트리거되기 전에는 검증이 어렵습니다.

이 세 가지가 맞물려 "AI가 생성한 코드가 문법적으로 그럴듯해 보이지만 런타임에서 400을 내는" 패턴이 반복됐습니다.

---

## ✅ 해결: 문서화 → 규칙화 → 자동화

세 단계를 연속된 파이프라인으로 연결했습니다.

### 1. monitoring-pitfalls.md — 참조 문서 (19개 섹션, 약 700줄)

자주 발생하는 문법·호환성 문제를 한 곳에 정리했습니다.
AI와 사람이 공통으로 참조할 수 있는 단일 출처입니다.

| 섹션 | 핵심 내용 |
|------|----------|
| TraceQL 변수 | `=~` regex 금지, scope 규칙, Tempo 2.8 신기능 |
| Tempo 설정 | v2 scoped tag, span_metrics dimensions, local_blocks |
| Loki LogQL & OTLP | Native OTLP vs LokiExporter, `detected_level`, structured metadata, `\| json` 규칙 |
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

각 섹션은 "틀린 패턴 → 올바른 패턴 → 이유"의 3단 구조로 작성했습니다.
AI가 프롬프트에 해당 섹션만 로드해도 즉시 활용할 수 있도록 짧고 구체적으로 유지했습니다.

### 2. `.claude/rules/monitoring.md` — 자동 적용 규칙

모니터링 관련 작업을 할 때 **모든 대화에 자동으로 로드**되는 규칙 파일을 만들었습니다.
이 규칙은 pitfalls 문서 참조를 강제하고, 핵심 체크리스트를 대화 초입부터 삽입합니다.

문서를 아무리 잘 정리해도 "필요할 때 떠올리지 못하면" 소용이 없습니다.
자동 로드 규칙은 이 "떠올림"의 부담을 시스템에 맡기기 위한 장치입니다.

### 3. Skills 6개 업데이트

모니터링 관련 skill에 pitfalls 관련 지식을 반영했습니다.

| Skill | 추가 내용 |
|-------|----------|
| monitoring-grafana | TraceQL 변수 제약, Tempo scoped tags, internal link |
| logging-loki | Native OTLP 비교표, detected_level 대문자, structured metadata |
| observability-otel | stable semconv 매핑, Tempo v2 API, Alloy River, span vs resource |
| monitoring-metrics | `or on() vector(0)`, histogram_quantile by(le), 나눗셈 보호 |
| otel-optimization | Loki native OTLP 권장 대안 |
| kube-prometheus-stack | Apdex 버킷, PrometheusRule selector |

효과는 두 방향입니다.
AI가 모니터링 코드를 생성할 때 최신 문법을 참고할 수 있게 됐고, 사람이 skill 문서를 열어볼 때도 최신 함정이 바로 보입니다.

### 4. Agents 4개 업데이트

전문 agent가 모니터링 작업 시 pitfalls를 인식하고 사전에 회피하도록 보강했습니다.

| Agent | 추가 내용 |
|-------|----------|
| otel-expert | Goti pitfalls 참조, tail sampling, span metrics 카디널리티 |
| k8s-troubleshooter | 모니터링 스택 진단 섹션 |
| incident-responder | 모니터링 검증 체크리스트 |
| debugging-expert | TraceQL/LogQL/PromQL 상관 분석 |

특히 `debugging-expert`는 세 쿼리 언어를 **함께** 다루도록 수정했습니다.
현실의 장애는 메트릭·로그·트레이스를 넘나들며 진단해야 하므로, 한 언어의 pitfall만 아는 것으로는 부족했습니다.

### 5. 검증 스크립트 — lint-dashboards.sh

클러스터 없이도 대시보드 JSON만으로 8개 항목을 오프라인 검증하는 스크립트입니다.

```bash
# lint-dashboards.sh가 검증하는 8개 항목
# 1. TraceQL `=~"$...` 변수 regex 사용
# 2. TraceQL unscoped intrinsic (`kind=` vs `span.kind=`)
# 3. LogQL `level=` vs `detected_level=`
# 4. PromQL `histogram_quantile` + `by (le)` 누락
# 5. Datasource UID 허용 목록 위반
# 6. Tempo datasource tags scoped 여부
# 7. Loki alert rules `level=` 사용
# 8. JSON 자체 유효성
```

핵심 가치는 "오늘 겪은 400 에러를 내일도 겪지 않게" 만드는 데 있습니다.
`./validate.sh --lint-only` 한 번으로 push 전에 앞서 겪었던 모든 종류의 문법 오류를 사전에 잡을 수 있습니다.

### 6. 검증 스크립트 — check-coverage.sh

대시보드에서 사용하는 메트릭과 label이 테스트 데이터에 실제로 있는지 확인하는 스크립트입니다.

대시보드를 추가했는데 테스트 payload를 업데이트하지 않아 "로컬에선 패널이 비어 보이는" 케이스가 자주 있었습니다.
이 스크립트는 그 누락을 코드 리뷰 전에 드러냅니다.

### 7. payloads/metrics.json 보강

JVM/Process 메트릭 11개를 추가했습니다.
`class`, `buffer`, `cpu.time`, `process.cpu.start_time` 등입니다.

대시보드에서 참조하는 메트릭이 테스트 데이터에 없으면 lint는 통과하더라도 실제 Grafana에서 No Data가 뜹니다.
payload 보강은 그 격차를 좁히는 작업입니다.

### 8. extract-queries.sh 변수 치환 업데이트

대시보드 템플릿 변수 7개를 새로 추가했습니다.
`http_route`, `log_level`, `span_name`, `db_system`, `instance` 등입니다.

쿼리 추출기가 이 변수들을 실제 값으로 치환하지 못하면 검증 파이프라인이 잘못된 형태의 쿼리를 테스트하게 됩니다.

### 9. validate.sh 통합

모든 검증을 하나의 엔트리포인트로 묶었습니다.

```bash
# 대시보드 수정 후, push 전 (클러스터 불필요)
./validate.sh --lint-only    # 오프라인 lint + 커버리지

# Kind 클러스터에서 전체 검증
./validate.sh               # lint → port-forward → 전송 → 추출 → 검증
```

두 모드를 나눈 이유는 **빠른 피드백 루프**를 위해서입니다.
오프라인 lint는 수 초 안에 끝나므로 수정 → 검증 → 재수정 사이클을 빠르게 돌릴 수 있고, 클러스터 기반 전체 검증은 push 직전에 한 번만 돌리면 됩니다.

---

## 📊 이 체계로 탐지한 실제 버그

구축한 체계가 실제로 어떤 버그를 잡았는지 정리합니다.

| 버그 | 발견 방법 | 영향 |
|------|----------|------|
| TraceQL `span.http.route=~"$http_route"` | 수동 발견 후 lint 규칙에 추가 | Tempo 400 에러 |
| Tempo tags `service.name` (unscoped) | 외부 검색으로 확인 | Tempo v2 API 400 에러 |
| `kind=client` (unscoped intrinsic) | `lint-dashboards.sh`가 탐지 | TraceQL 400 에러 |
| `span.db.system=~"$db_system"` | `lint-dashboards.sh`가 탐지 | TraceQL 400 에러 |
| Loki alert `level=` | pitfall 검증 agent가 탐지 | 알림 미작동 |
| `\| json \| logger` (불필요 JSON 파싱) | 실제 Grafana에서 JSONParserErr | 패널 에러 |

첫 두 건은 "사람이 먼저 찾고 → 규칙으로 등록"한 케이스입니다.
이후 같은 패턴이 다른 대시보드에 들어왔을 때 lint가 자동으로 잡았습니다.

이 흐름이 이 체계가 지향하는 모양입니다.
새로운 함정을 만나면 pitfalls 문서에 기록하고, 가능하면 lint 규칙으로 승격하며, 그 순간부터는 자동화가 검증을 대신합니다.

---

## 📚 배운 점

- **문서화 → 규칙화 → 자동화 순서**가 효과적입니다. 문서만으로는 AI도 사람도 놓치지만, lint 스크립트가 잡아주면 더 이상 실수가 축적되지 않습니다.
- **OTel + LGTM 스택은 문법 변경이 빠릅니다**. Grafana 공식 문서조차 Tempo v2와 일부 불일치합니다. 실제 API 동작을 기준으로 검증해야 합니다.
- **AI가 생성하는 코드의 품질은 참고 가능한 지식의 품질에 비례합니다**. skills/rules를 최신으로 유지하면 AI 출력이 즉시 개선됩니다.
- **빠른 피드백 루프를 위한 오프라인 검증**을 분리해두면 수정 사이클이 짧아집니다. 클러스터 없이 수 초 안에 끝나는 lint는 push 전 마지막 방어선 역할을 합니다.
- **버그 → 규칙 승격 파이프라인**을 갖추면 한 번 겪은 장애가 조직 전체의 자산이 됩니다. 같은 400 에러를 두 번 겪지 않는 것이 이 체계의 목표입니다.
