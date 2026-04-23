---
title: "로깅 컨벤션 ADR — logfmt를 앱 로그 표준으로 채택한 이유"
excerpt: "자유형식 한국어, JSON body, logfmt 세 가지 로그 포맷을 비교하고 logfmt를 채택한 결정 기록입니다. Loki 자동 파싱과 사람 가독성의 균형이 핵심이었습니다."
category: monitoring
tags:
  - go-ti
  - Logging
  - logfmt
  - JSON
  - ADR
date: "2026-02-09"
---

## 한 줄 요약

> goti-server 모듈마다 제각각이던 로그 포맷을 **logfmt(key=value)**로 통일했습니다. Loki `| logfmt` 자동 파싱과 SLF4J placeholder 호환, 그리고 사람 가독성까지 한 번에 확보하기 위한 결정입니다.

---

## 1. 배경

### 현재 상황: 모듈마다 로그 포맷이 다르다

goti-server는 Queue, Resale, Ticketing, Payment 네 모듈로 구성되어 있습니다. 각 모듈의 로그 포맷이 제각각 다른 상태였습니다.

| 모듈 | 현재 패턴 | 예시 |
|------|----------|------|
| Queue | `action=` 구조화 key=value | `action=ENTER gameId={} userId={}` |
| Resale | 한국어 + 하이픈 구분 | `리셀 결제 요청 실패 - orderId: {}, error: {}` |
| Ticketing | 한국어 + 혼합 | `주문 결제 완료 처리 시작 - orderId: {}, userId: {}` |
| Payment | 로그 거의 없음 | `리셀 주문 결제 확정 - orderId: {}, buyerId: {}` |

이 표의 문제는 단순히 "스타일이 다르다"는 수준이 아닙니다.

Queue 모듈은 이미 `action=` 패턴으로 구조화되어 있어 Loki `| logfmt` 파서로 바로 필드를 추출할 수 있습니다. 반면 Resale과 Ticketing은 한국어 자연어 문장에 하이픈으로 필드를 붙인 형태라, 파싱하려면 모듈별로 다른 정규식을 작성해야 합니다.

Payment 모듈은 더 심각합니다. 전체 코드베이스에 로그가 1건뿐인 상황이었습니다. 금융 거래를 처리하는 모듈인데 추적 로그가 사실상 없다는 뜻입니다.

MSA 아키텍처로 전환하면서 이 불일치가 더 큰 문제가 되었습니다. 서비스 간 요청을 trace_id로 묶어 따라가려 해도, 로그 포맷이 달라 집계 쿼리를 한 번에 쓸 수 없었습니다.

### 요구사항

컨벤션 설계 시 다음 요구사항을 정리했습니다.

| 요구사항 | 설명 | 중요도 |
|----------|------|--------|
| Loki 자동 파싱 | `\| logfmt` 또는 `\| json`으로 필드 즉시 추출 | 필수 |
| Grafana 대시보드 연동 | `action`, `service`, 도메인 ID로 필터/집계 | 필수 |
| OTel trace 상관관계 | trace_id/span_id 자동 포함 | 필수 |
| 사람 가독성 | 터미널/로그 뷰어에서 직관적 파악 | 중요 |
| MSA 서비스 간 일관성 | 모든 서비스가 동일 포맷 사용 | 필수 |
| 금융 거래 추적성 | 결제 생명주기 전체 추적 가능 | 필수 |

이 요구사항들의 핵심은 **"기계가 파싱할 수 있어야 하고, 사람도 터미널에서 바로 읽을 수 있어야 한다"**는 두 축의 동시 만족입니다. 어느 한쪽을 희생하면 운영 경험이 나빠집니다.

---

## 2. 🧭 선택지 비교

### 고려한 옵션

후보는 세 가지였습니다.

| 옵션 | 핵심 아이디어 | 대표 예시 |
|------|---------------|----------|
| A. 자유형식 한국어 | 사람이 읽기 좋은 자연어 메시지 | `주문 결제 완료 처리 시작 - orderId: {}` |
| B. JSON body | 메시지 자체를 JSON으로 구성 | `{"action":"PAYMENT_CREATE","orderId":"..."}` |
| C. logfmt (key=value) | 공백 구분 key=value | `action=PAYMENT_CREATE orderId={} amount={}` |

### Option A: 자유형식 한국어 메시지

```java
log.info("주문 결제 완료 처리 시작 - orderId: {}, userId: {}", orderId, userId);
log.error("결제 생성 실패 - orderId: {}, reason: {}", orderId, reason);
```

| 항목 | 평가 |
|------|------|
| 사람 가독성 | 최고 |
| Loki 자동 파싱 | 불가 — 정규식 필요 |
| 대시보드 집계 | action/필드 기반 집계 불가 |
| MSA 일관성 | 개발자마다 메시지 제각각 |
| 구현 난이도 | 가장 쉬움 |

가장 쓰기 쉽고 읽기도 좋지만, **Loki에서 필드를 추출할 표준 방법이 없습니다**. 모듈마다 정규식을 따로 만들어야 하고, 개발자가 메시지 문구를 바꾸는 순간 파싱이 깨집니다. 대시보드를 만들 수 없다는 점이 결정적 탈락 요인이었습니다.

### Option B: JSON body 로깅

```java
log.info("""
    {"action":"PAYMENT_CREATE","orderId":"{}","amount":{},"status":"SUCCESS"}""",
    orderId, amount);
```

| 항목 | 평가 |
|------|------|
| 사람 가독성 | 나쁨 — 중괄호/따옴표 noise |
| Loki 자동 파싱 | 최고 — `\| json` 완벽 |
| 대시보드 집계 | 최고 |
| MSA 일관성 | 구조 강제됨 |
| 구현 난이도 | JSON 이스케이프 주의 필요 |

Loki 파싱 관점에서는 가장 강력합니다. `| json` 한 줄로 모든 필드가 추출되고 중첩 구조도 표현 가능합니다.

하지만 **사람이 터미널에서 읽기가 어렵습니다**. 중괄호, 따옴표, 이스케이프된 문자가 메시지의 가독성을 크게 해칩니다. 또한 SLF4J placeholder (`{}`)와 JSON의 `{` 문자가 충돌해 이스케이프 처리가 까다롭습니다. 실수로 value에 따옴표가 들어가면 JSON 자체가 깨집니다.

### Option C: logfmt (key=value)

```java
log.info("action=PAYMENT_CREATE orderId={} amount={} status=SUCCESS", orderId, amount);
log.error("action=PAYMENT_FAILED orderId={} reason={}", orderId, reason, e);
```

| 항목 | 평가 |
|------|------|
| 사람 가독성 | 좋음 — key=value 직관적 |
| Loki 자동 파싱 | `\| logfmt` 한 줄로 모든 필드 추출 |
| 대시보드 집계 | action, orderId 등으로 즉시 필터 |
| MSA 일관성 | 양식 강제 용이 |
| 구현 난이도 | SLF4J placeholder 그대로 사용 |

JSON body의 파싱 편의와 자유형식의 가독성 사이 균형점입니다. `action=PAYMENT_CREATE orderId=12345`는 사람 눈에도 한 번에 들어오고, Loki에서는 `| logfmt`로 필드가 즉시 추출됩니다.

### 비교 매트릭스

세 옵션을 핵심 축으로 정리했습니다.

| 항목 | A. 자유형식 | B. JSON body | C. logfmt |
|------|-----------|-------------|-----------|
| Loki `\|` 파싱 | 정규식 필요 | `\| json` | **`\| logfmt`** |
| 사람 가독성 | ★★★★★ | ★★☆☆☆ | **★★★★☆** |
| 대시보드 필터 | 불가 | 가능 | **가능** |
| SLF4J 호환 | 자연스러움 | 어색함 | **자연스러움** |
| Go 생태계 호환 | 없음 | 있음 | **네이티브 (slog)** |
| 학습 비용 | 없음 | 낮음 | **낮음** |

이 매트릭스의 핵심은 **logfmt가 모든 축에서 "최고 또는 동점 2위"**라는 점입니다. JSON은 파싱에서 최고지만 가독성에서 크게 뒤처지고, 자유형식은 가독성 최고지만 파싱·대시보드가 불가능합니다. logfmt만 양쪽을 동시에 만족합니다.

### 기각 이유

- **A 탈락**: Loki 자동 파싱이 불가능하고 대시보드 집계를 만들 수 없습니다. 요구사항의 "필수" 항목을 만족하지 못합니다.
- **B 탈락**: 사람 가독성이 너무 낮고, SLF4J placeholder와 JSON 중괄호가 충돌해 실수 여지가 큽니다. 전송 포맷으로 JSON을 별도로 쓰면 이 장점은 어차피 확보됩니다.

### 결정 기준과 최종 선택

**C(logfmt)를 채택합니다.**

결정 기준은 다음 우선순위입니다.

1. **Loki 자동 파싱 가능성**: 대시보드·집계·알림이 모두 이 위에 쌓이므로 최우선.
2. **MSA 일관성**: Java(Spring)와 Go(slog) 양쪽에서 네이티브로 지원되는 포맷이어야 함.
3. **사람 가독성**: 터미널 `tail`, `kubectl logs`에서 직관적으로 읽혀야 함.

logfmt는 세 기준을 모두 상위권으로 만족합니다. Queue 모듈에서 이미 운영 검증이 끝난 점도 선택을 뒷받침했습니다.

---

## 3. 결정

### logfmt를 앱 로그 메시지 표준으로 채택합니다.

구체적 선택 근거는 다음과 같습니다.

1. **Loki 최적 호환**: `| logfmt` 한 줄로 모든 필드가 추출됩니다. `action="PAYMENT_CREATE"` 같은 필터를 정규식 없이 바로 쓸 수 있습니다.
2. **사람 + 기계 균형**: JSON body보다 읽기 쉽고, 자유형식보다 파싱이 쉽습니다.
3. **SLF4J 자연스러운 호환**: `log.info("action=X key={}", value)` 구문이 기존 Java 코드 스타일과 충돌하지 않습니다.
4. **Go 생태계 호환**: goti-load-observer 같은 Go 기반 서비스의 `slog`가 logfmt를 네이티브로 지원합니다. MSA 전 서비스 통일이 가능합니다.
5. **Queue 모듈 검증 완료**: 이미 `action=` 패턴으로 운영 중이고 Grafana 대시보드 연동도 검증되었습니다.

### 인정한 트레이드오프

완벽한 선택은 없습니다. 다음 트레이드오프를 받아들였습니다.

- 한국어 메시지의 직관성을 일부 포기합니다. 대신 `action` 값의 네이밍으로 의미를 실어 보완합니다(예: `PAYMENT_CREATE`, `SEAT_HOLD_EXPIRE`).
- 공백 포함 값은 따옴표로 감싸야 합니다. 다만 실제 value는 도메인 ID/숫자 위주라 빈도가 낮습니다.
- JSON body 대비 중첩 구조를 표현할 수 없습니다. 로그 메시지에 중첩이 필요한 경우는 거의 없으므로 실용상 제약이 아닙니다.

### 전송 포맷: JSON (Spring Boot Structured Logging)

메시지 body는 logfmt이지만, **전송 포맷은 JSON**으로 사용합니다. 두 레이어는 분리됩니다.

```yaml
# application.yml
logging:
  structured:
    format:
      console: logstash  # JSON 출력 (OTel Collector/Alloy가 파싱)
  pattern:
    level: "%5p [${spring.application.name:},%X{trace_id:-},%X{span_id:-}]"
```

이 구성의 의도는 다음과 같습니다.

- **전송 레이어(JSON)**: OTel Collector와 Alloy가 자동으로 파싱합니다. trace_id, span_id, service_name 같은 메타데이터가 구조화되어 전송됩니다.
- **메시지 레이어(logfmt)**: JSON의 `message` 필드 안에 logfmt 문자열이 들어갑니다. Loki에서는 `| json | line_format "{{.message}}" | logfmt`로 이중 파싱하거나, 직접 `| json | message =~ "action=..."`로 필터링합니다.
- **OTel Java Agent**가 trace_id/span_id를 MDC에 자동 주입하므로 별도 코드 수정 없이 로그-트레이스 상관관계가 확보됩니다.

---

## 4. 결과

### 긍정적 영향

- Grafana 대시보드에서 `action` 기반 필터/집계가 전 모듈에 걸쳐 통일됩니다.
- Loki LogQL 쿼리가 표준화됩니다: `{service_name=~"$svc"} | logfmt | action="PAYMENT_CREATE"`.
- 새 모듈/서비스 추가 시 로그 양식 논의가 필요 없어집니다. 컨벤션 문서만 참조하면 됩니다.
- Payment처럼 로그 부재 모듈의 추적성이 확보됩니다.

### 부정적 영향 / 리스크

- 기존 Resale/Ticketing 모듈의 한국어 메시지를 logfmt로 전환하는 **마이그레이션 작업**이 필요합니다.
- 팀원 학습 비용이 발생하지만, key=value는 직관적이라 부담이 낮습니다.
- value에 공백/특수문자가 있으면 따옴표로 감싸야 합니다. 잘못 쓰면 파싱이 깨집니다.

### 향후 과제

- [ ] 기존 모듈 로그 마이그레이션 (Queue 제외 — 이미 준수)
- [ ] Payment 모듈 로그 추가 (Critical)
- [ ] Grafana 대시보드 `| logfmt` 기반 패널 추가
- [ ] Spring Boot 3.4+ structured logging 전환 검토 (현재 버전 확인 필요)
- [ ] 로그 기반 알림 규칙 표준화 (action별 에러율)

---

## 5. 참고 자료

- [Spring Boot Structured Logging Docs](https://docs.spring.io/spring-boot/reference/features/logging.html)
- [Grafana Loki — OTel 수집](https://grafana.com/docs/loki/latest/send-data/otel/)
- [Loki Structured Metadata](https://grafana.com/docs/loki/latest/get-started/labels/structured-metadata/)
- [Log Format Standards: JSON, XML, Key-Value | Last9](https://last9.io/blog/log-format/)
- [Structured Logging Guide | SigNoz](https://signoz.io/blog/structured-logs/)
- 내부: `docs/conventions/logging-standard.md` (실전 가이드)
