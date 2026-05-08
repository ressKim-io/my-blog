---
title: "대시보드 고도화 중 쏟아진 모니터링 버그 6건 — OTel + LGTM 문법 변천사"
excerpt: "TraceQL 변수 비호환, Tempo v2 scoped tag, Loki detected_level 등 OTel + LGTM 스택 문법 변화에서 비롯된 6개 버그를 한 번에 정리합니다"
category: monitoring
tags:
  - go-ti
  - Observability
  - Monitoring
  - Tempo
  - Loki
  - TraceQL
  - LogQL
  - Grafana
  - troubleshooting
series:
  name: "goti-observability-ops"
  order: 8
date: "2026-03-15"
---

## 한 줄 요약

> 분산 추적·에러 분석 대시보드를 고도화하던 중 OTel + LGTM 스택의 문법 변화에서 비롯된 버그 6건을 한꺼번에 발견했습니다. 공통 원인은 Tempo v1→v2 API, Loki Promtail→Native OTLP, TraceQL과 Grafana 변수 interpolation의 불일치입니다.

## Impact

- **영향 범위**: distributed-tracing 대시보드, error-analysis 대시보드, db-dependencies 대시보드, PaymentErrorSpike 알림 룰
- **증상**: TraceQL 패널 400 에러, Tempo tag values API 400, Loki 알림 미발동, LogQL `JSONParserErr`
- **발견 경로**: `lint-dashboards.sh` 자동 탐지, pitfall 검증 agent, 실제 Grafana UI 사용 중 발견

---

## 🔥 문제: 대시보드 고도화 중 6건의 버그가 한꺼번에 드러났다

분산 추적 대시보드와 에러 분석 대시보드를 고도화하던 중, 새로 추가한 패널과 기존 패널에서 동시다발로 400 에러와 `JSONParserErr`가 발생했습니다.

각 버그의 증상은 표면적으로는 서로 다르지만, 파고들어보면 **OTel + LGTM 스택의 문법이 빠르게 바뀌는 과정**에서 기인한 일관된 패턴이 있었습니다. 이 글에서는 6건을 한 번에 정리합니다.

---

## 🤔 원인 + ✅ 해결: 버그 6건 상세

### 1. TraceQL이 Grafana multi-value 변수의 `=~` 변환을 지원하지 않음

**증상**: 분산 추적 대시보드의 TraceQL 패널에서 400 에러가 반환되었습니다.

**원인**: 쿼리에 `span.http.route=~"$http_route"`를 썼습니다. PromQL에서는 Grafana가 multi-value 변수를 `val1|val2|val3` 형태로 변환해 `=~` regex에 넘겨주지만, **TraceQL은 이 interpolation을 지원하지 않습니다**.

**수정**: `=~"$http_route"` 필터 자체를 제거하고, 결과 표시용으로 `select(span.http.route)`만 남겼습니다.

**영향 범위**: distributed-tracing 대시보드 2곳, error-analysis 대시보드 1곳.

---

### 2. Tempo v2 API는 scoped tag name만 허용

**증상**: Grafana에서 Tempo 관련 기능(trace to logs 등)을 사용할 때 400 에러가 반환되었습니다.

**원인**: `tracesToLogsV2.tags` 키에 `service.name`(unscoped)을 썼습니다. 그런데 **Tempo v2 API는 scoped name만 허용**합니다. 예: `resource.service.name`.

**수정**: `service.name` → `resource.service.name`으로 변경했습니다. kps values 파일 + provisioning 설정 총 6곳을 수정했습니다.

**참고**: Grafana 공식 문서 기본 예시가 unscoped `service.name`으로 표기되어 있습니다. 문서만 참고하면 틀리는 함정입니다.

---

### 3. TraceQL intrinsic `kind`는 `span.` prefix가 필요

**증상**: db-dependencies 대시보드의 External Call 패널에서 400 에러가 반환되었습니다.

**원인**: 쿼리에 `kind=client`로 적었습니다. 이 문법은 **잘못된 형식**입니다. 올바른 형태는 `span.kind=client`입니다. 마찬가지로 `span.url.full` 또한 OTel semantic convention 변경에 따라 `span.http.url`로 표기해야 합니다.

**수정**:
- `kind=client` → `span.kind=client`
- `span.url.full` → `span.http.url`

**발견 경로**: `lint-dashboards.sh` 스크립트가 자동으로 탐지했습니다.

---

### 4. `span.db.system=~"$db_system"`도 TraceQL 변수 regex 함정

**증상**: db-dependencies 대시보드의 Slow DB Query 패널에서 잠재적 400 에러가 감지되었습니다.

**원인**: 버그 #1과 동일한 원인입니다. TraceQL + Grafana multi-value 변수의 `=~` interpolation 비호환.

**수정**: `span.db.system=~"$db_system"` → `span.db.system != nil`로 변경해, "값이 있으면 모두 표시"로 필터 의도를 단순화했습니다.

**발견 경로**: `lint-dashboards.sh`가 자동 탐지했습니다. 버그 #1의 교훈을 스크립트에 반영해둔 덕분에 같은 패턴을 재발견할 수 있었습니다.

---

### 5. Loki alert rule에서 `level=` 구식 방식 사용

**증상**: `PaymentErrorSpike` 알림이 전혀 발동하지 않았습니다.

**원인**: 알림 룰에 `level=~"error|ERROR"`를 썼습니다. **Native OTLP 경로**에서는 레이블 이름이 `level`이 아니라 `detected_level`입니다. Loki Promtail 시절의 `level`을 그대로 복사한 채 Native OTLP로 이관한 것이 문제였습니다.

**수정**: `level=~"error|ERROR"` → `detected_level="ERROR"`로 변경했습니다.

**발견 경로**: pitfall 검증 agent가 탐지했습니다.

---

### 6. LogQL `| json`이 structured metadata 로그에서 `JSONParserErr`

**증상**: Error Analysis 대시보드의 "에러 로그 Logger별 분포" 패널이 에러를 반환했습니다.

**원인**: 쿼리에 `| json | logger != ""`를 썼습니다. 하지만 `logger`는 OTel log attribute로 **이미 structured metadata**에 저장되어 있습니다. plain text 로그가 아니기 때문에 `| json`이 파싱에 실패해 `JSONParserErr`를 반환합니다.

**수정**: `| json | logger != ""` → `| logger != ""` (불필요한 `| json` 제거).

**발견 경로**: `lint-dashboards.sh`나 pitfall agent가 놓친 케이스로, 실제 Grafana UI에서 사용자가 먼저 발견했습니다. 검증 자동화의 사각지대를 알려준 의미 있는 발견이었습니다.

---

## 공통 근본 원인: OTel + LGTM 스택의 문법 변천

6건은 증상이 다르지만, 원인을 하나의 축으로 묶을 수 있습니다. **OTel + LGTM 스택의 문법이 빠르게 변하는 과정**에서 옛 문법과 새 문법이 섞여 들어간 것입니다.

- **Tempo v1 → v2 API**: unscoped tag(`service.name`) → scoped tag(`resource.service.name`) 필수화
- **Loki Promtail → Native OTLP**: `level` → `detected_level`, 그리고 attribute의 structured metadata 저장
- **TraceQL 변수 interpolation**: PromQL과 다른 규칙. Grafana multi-value 변수의 `=~` 변환이 지원되지 않음
- **OTel semantic conventions**: stable vs unstable attribute 이름 변경 (예: `url.full` → `http.url`)

여기에 AI 보조 편집이 더해지면서, 구버전 문법이나 PromQL 패턴을 그대로 TraceQL/LogQL에 적용해 버리는 사례가 반복되었습니다.

---

## ✅ 해결: 검증 체계 구축

버그 6건을 수정하는 것만으로는 재발을 막을 수 없습니다. 문법이 또 바뀌면 같은 종류의 버그가 반드시 다시 나타납니다. 그래서 두 가지 검증 체계를 구축했습니다.

- **`monitoring-pitfalls.md`**: 이번에 발견한 함정을 모아 사람이 읽을 수 있는 형태로 정리했습니다. 대시보드를 새로 만들 때 체크리스트로 활용합니다.
- **`lint-dashboards.sh`**: 자동 탐지 스크립트. 대시보드 JSON에서 `kind=client`, `=~"$var"`(TraceQL 문맥), `| json | ...` 같은 알려진 안티패턴을 찾아 CI에서 실패시킵니다.

이번 라운드에서 버그 #3, #4는 `lint-dashboards.sh`가 먼저 잡아줬고, #5는 pitfall agent가 탐지했습니다. #6은 사람이 먼저 발견했지만, 같은 패턴을 스크립트에 추가해 다음에는 자동으로 잡히도록 했습니다.

---

## 📚 배운 점

- **문법이 바뀌는 스택에서는 "검증 자동화"가 가장 저렴한 방어선**입니다. Tempo/Loki/OTel은 메이저 버전 사이에 문법이 실제로 바뀝니다. 사람의 기억력에 의존하지 않고 `lint-*.sh`와 pitfall agent에 축적합니다.
- **PromQL 습관을 TraceQL·LogQL에 그대로 이식하지 않습니다**. Grafana multi-value 변수 interpolation은 PromQL에서만 `pipe-separated` 변환이 자동으로 적용됩니다. TraceQL은 다른 전략(필터 제거, `!= nil`, `select()`로 대체)을 써야 합니다.
- **Grafana 공식 문서 기본값을 무비판적으로 믿지 않습니다**. Tempo v2 scoped tag가 대표적 예입니다. 실제 API 응답과 Tempo 문서를 교차 확인해야 합니다.
- **Loki Native OTLP에서는 label 이름이 바뀝니다**. `level` → `detected_level`. 알림 룰을 Native OTLP로 이관하면서 label 이름을 한 번 더 점검해야 합니다.
- **자동 검증의 사각지대는 사용자가 먼저 발견한 버그(#6)로 드러납니다**. 사람이 잡은 버그는 반드시 스크립트로 역주입해 다음에는 자동으로 탐지되도록 합니다.
