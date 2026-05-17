---
title: "구조화 로깅 — logfmt·JSON 포맷과 Loki 파싱 원리"
excerpt: "자유 형식 로그의 한계에서 출발해 logfmt(key=value)·JSON 구조화 포맷이 어떻게 다르고, Loki가 | logfmt · | json 파서로 필드를 추출하는 원리, 전송 포맷과 메시지 body를 분리하는 이유를 설명합니다"
category: monitoring
tags:
  - go-ti
  - loki
  - logfmt
  - structured-logging
  - logql
  - otel
  - concept
series:
  name: "goti-deepdive-observability"
  order: 6
date: "2026-03-28"
---

## 한 줄 요약

> logfmt는 사람이 읽기 쉬운 `key=value` 포맷으로 Loki `| logfmt` 파서가 런타임에 필드를 즉시 추출합니다 — 전송은 JSON, 메시지 body는 logfmt인 두 레이어 구조가 핵심입니다

---

## 🤔 무엇을 푸는 기술인가

분산 MSA 환경에서 로그를 중앙 집중 분석할 때 가장 먼저 부딪히는 문제는 **파싱 불일치**입니다

서비스마다 로그 메시지 형식이 다르면 Loki·Grafana에서 통합 필터링이 불가능합니다 `"주문 결제 완료 - orderId: 4821"` 같은 자유 형식은 사람이 읽기엔 자연스럽지만, Loki가 `orderId` 값을 추출하려면 서비스마다 다른 정규식을 별도로 관리해야 합니다

**구조화 로깅(Structured Logging)** 은 이 문제를 포맷 표준화로 해결합니다 로그 메시지를 미리 약속된 구조(key=value 또는 JSON 객체)로 작성하면, 로그 수집 시스템이 파서 한 줄로 모든 서비스의 필드를 동일하게 추출할 수 있습니다

구조화 로깅 포맷은 크게 두 가지가 경쟁합니다 하나는 **logfmt** (`key=value` 페어 나열), 다른 하나는 **JSON body** (`{"key":"value"}` 직렬화)입니다 두 포맷은 기계 파싱 능력은 비슷하지만 사람 가독성과 작성 편의성에서 차이가 납니다

---

## 🔧 동작 원리

### 자유 형식 로그의 한계

자유 형식 로그가 Loki에서 실제로 어떤 문제를 만드는지 살펴봅니다

```text
# Queue 서비스
action=ENTER gameId=101 userId=UID-4821

# Resale 서비스
리셀 결제 요청 실패 - orderId: ORD-4821, error: InsufficientBalance

# Ticketing 서비스
주문 결제 완료 처리 시작 - orderId: ORD-9912, userId: UID-3301
```

세 줄 모두 `orderId`를 포함하지만 표현 방식이 각각 다릅니다 Queue는 `key=value`, Resale은 `- key: value`, Ticketing은 `- key: value`(다른 키 이름)를 씁니다 Loki에서 모든 서비스를 통틀어 `orderId`를 기준으로 집계하려면 서비스별 정규식 파이프라인을 따로 관리해야 합니다

모듈이 늘어날수록 파이프라인 유지 비용이 선형으로 증가합니다 또한 정규식이 포맷 변경에 취약해 "로그 형식 바꿨더니 대시보드가 깨진다"는 운영 사고로 이어집니다

### logfmt — key=value 페어 나열

logfmt는 Tom Preston-Werner가 제안한 단순한 규칙입니다 — 로그 메시지를 `key=value` 페어의 나열로 작성합니다

```text
action=PAYMENT_CREATE orderId=ORD-4821 amount=150000 status=SUCCESS
action=PAYMENT_FAILED orderId=ORD-4822 reason=InsufficientBalance
```

값에 공백이 포함되면 따옴표로 감쌉니다

```text
action=SEAT_HOLD_EXPIRE orderId=ORD-4823 reason="seat already released"
```

SLF4J(Java) 환경에서는 기존 플레이스홀더 문법 그대로 씁니다

```java
log.info("action=PAYMENT_CREATE orderId={} amount={} status=SUCCESS", orderId, amount);
log.error("action=PAYMENT_FAILED orderId={} reason={}", orderId, reason);
```

Go 생태계에서 `slog`는 logfmt를 네이티브로 지원합니다

```go
slog.Info("payment processed",
    "action", "PAYMENT_CREATE",
    "orderId", orderId,
    "amount", amount,
    "status", "SUCCESS",
)
// 출력: time=2026-03-28T12:00:00Z level=INFO msg="payment processed"
//       action=PAYMENT_CREATE orderId=ORD-4821 amount=150000 status=SUCCESS
```

### Loki `| logfmt` 파서 — 런타임 필드 추출

Loki에서 `| logfmt` 파서는 로그 라인의 message body를 런타임에 파싱해 key를 임시 레이블로 추출합니다 인덱스에 미리 저장하지 않고, 쿼리 시점에 청크를 읽으면서 파싱합니다

```text
# LogQL 쿼리 예시
{detected_service_name="goti-payment"} | logfmt | action="PAYMENT_CREATE"

# 파서가 추출하는 필드
action  = PAYMENT_CREATE
orderId = ORD-4821
amount  = 150000
status  = SUCCESS
```

파서가 추출한 필드는 이후 파이프라인에서 필터·집계에 바로 사용할 수 있습니다

```text
{detected_service_name=~"goti-.*"} | logfmt
  | action="PAYMENT_CREATE"
  | status="SUCCESS"
  | count_over_time([5m])
```

스트림 셀렉터(`{detected_service_name=~"goti-.*"}`)가 먼저 청크 범위를 좁히고, 그다음 `| logfmt`가 해당 청크 내 라인만 파싱합니다 전체 로그를 스캔하지 않으므로 비용이 낮습니다

### JSON body vs logfmt — 파서 차이

JSON body 방식은 메시지 자체를 JSON 문자열로 작성합니다

```java
log.info("{\"action\":\"PAYMENT_CREATE\",\"orderId\":\"{}\",\"amount\":{}}", orderId, amount);
```

Loki에서 `| json` 파서로 처리합니다

```text
{detected_service_name="goti-payment"} | json | action="PAYMENT_CREATE"
```

두 파서의 동작 방식을 비교하면 다음과 같습니다

| 항목 | `| logfmt` | `| json` |
|---|---|---|
| 파싱 대상 | `key=value` 페어 나열 | JSON 객체 직렬화 |
| 사람 가독성 | 터미널에서 직관적 | 중괄호·따옴표 noise |
| 중첩 구조 | 미지원 (flat만) | 지원 (`obj.field`) |
| 이스케이프 | 공백 포함 값만 따옴표 | 모든 문자열 따옴표 필요 |
| SLF4J 호환 | 자연스러움 | 이스케이프 주의 필요 |
| Go slog 호환 | 네이티브 | `TextHandler` 별도 설정 |
| Loki 파서 | `\| logfmt` | `\| json` |

로그 메시지에 중첩 JSON이 필요한 경우는 드물기 때문에 flat key=value인 logfmt가 대부분의 애플리케이션 로그에서 더 실용적입니다

### 전송 포맷과 메시지 body의 분리

구조화 로깅에서 핵심 개념은 **전송 포맷**과 **메시지 body**가 별개의 레이어라는 점입니다

![logfmt 로그의 Loki 파싱 흐름 — 앱 출력부터 Grafana 필터까지|tall](/diagrams/goti-deepdive-structured-logging-logfmt-1.svg)

위 다이어그램은 로그 한 줄이 애플리케이션에서 Grafana까지 이동하는 6단계 흐름을 보여줍니다

**1단계 — 애플리케이션 출력**: Spring Boot 또는 Go slog가 `action=PAYMENT_CREATE orderId=ORD-4821 ...` 형태의 logfmt 메시지를 생성합니다 이 문자열이 메시지 body입니다

**2단계 — JSON 전송 포맷**: Spring Boot Structured Logging(`logging.structured.format.console: logstash`) 설정이 활성화되면, 애플리케이션이 실제로 콘솔에 출력하는 것은 logfmt 문자열이 아니라 JSON 래퍼입니다 logfmt body는 JSON 필드 `"message"` 안에 문자열로 포함됩니다

```json
{
  "@timestamp": "2026-03-28T12:00:00.000Z",
  "level": "INFO",
  "logger": "c.g.payment.PaymentService",
  "message": "action=PAYMENT_CREATE orderId=ORD-4821 amount=150000 status=SUCCESS",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7"
}
```

이 두 레이어 분리가 중요한 이유는 각각 다른 목적을 가지기 때문입니다 JSON 전송 포맷은 OTel Collector와 Alloy가 자동 파싱하기 위한 기계용 구조입니다 메시지 body의 logfmt는 사람이 터미널에서 읽고, Loki `| logfmt` 파서가 분석 시점에 필드를 뽑아내기 위한 구조입니다

**3단계 — OTel Collector / Alloy**: OTLP 포맷으로 수신한 JSON 로그에서 `service.name`, `level`, `trace_id` 등 Resource Attributes를 Loki 레이블로 변환합니다

**4단계 — Loki 저장**: `{service="payment", level="info"}` 레이블 조합으로 스트림을 분류하고 압축 청크로 저장합니다 message body의 logfmt 내용은 인덱싱 없이 원문 그대로 청크에 들어갑니다

**5단계 — `| logfmt` 파서**: LogQL 쿼리 실행 시 해당 청크를 읽어 message body의 `key=value` 페어를 실시간으로 파싱합니다 `action`, `orderId`, `status` 등이 쿼리 가능한 임시 필드로 추출됩니다

**6단계 — Grafana 필터**: 추출된 필드로 `action="PAYMENT_CREATE"` 필터나 `count_over_time([5m])` 집계를 실행합니다 서비스별 액션 처리량, 에러율 대시보드가 별도 파이프라인 설정 없이 동작합니다

### trace_id · span_id MDC 자동 주입

OTel Java Agent를 사용하면 trace_id와 span_id가 MDC(Mapped Diagnostic Context)에 자동으로 주입됩니다 Spring Boot Structured Logging과 함께 사용하면 모든 로그 라인에 trace 상관관계 정보가 자동으로 포함됩니다

```yaml
# application.yml
logging:
  structured:
    format:
      console: logstash
  pattern:
    level: "%5p [${spring.application.name:},%X{trace_id:-},%X{span_id:-}]"
```

```text
# 출력 예시 (전송 JSON의 message 필드 내용)
action=PAYMENT_CREATE orderId=ORD-4821 amount=150000 status=SUCCESS
```

trace_id는 JSON 전송 포맷의 별도 필드에 포함되어 Loki 레이블이나 Structured Metadata로 저장됩니다 Grafana에서 로그 라인을 클릭하면 동일 trace_id로 Tempo 트레이스로 바로 이동(TraceQL 연동)할 수 있습니다

---

## 📐 세부 동작과 옵션

### logfmt 파싱 규칙 — 엣지케이스

logfmt 파서가 처리하는 주요 케이스를 정리합니다

| 케이스 | 입력 예시 | 파싱 결과 |
|---|---|---|
| 기본 key=value | `action=PAYMENT_CREATE` | `action = "PAYMENT_CREATE"` |
| 숫자 값 | `amount=150000` | `amount = "150000"` (문자열로 저장) |
| 공백 포함 값 | `reason="seat already released"` | `reason = "seat already released"` |
| 빈 값 | `error=""` | `error = ""` |
| 따옴표 없는 공백 | `action=PAYMENT CREATE` | 파싱 오류 — 따옴표 필요 |
| 등호 없는 토큰 | `ERROR` | 무시되거나 파서 경고 |

실전에서 주의할 점은 값에 공백이 포함될 수 있는 필드입니다 도메인 ID나 숫자 값은 공백이 없으므로 따옴표 없이 쓸 수 있지만, 에러 메시지처럼 자연어가 포함될 수 있는 필드는 반드시 따옴표로 감싸야 합니다

### action 네이밍 컨벤션

logfmt에서 `action` 필드는 서비스 전반에서 동일한 네이밍 규칙을 따르는 것이 대시보드 통합의 핵심입니다

```text
# 추천 패턴: {도메인}_{동작}
action=PAYMENT_CREATE
action=PAYMENT_FAILED
action=SEAT_HOLD_RESERVE
action=SEAT_HOLD_EXPIRE
action=QUEUE_ENTER
action=QUEUE_DEQUEUE
action=RESALE_BID_SUBMIT
```

`{도메인}_{동작}` 패턴으로 고정하면 Grafana 변수에서 `action=~"PAYMENT_.*"` 처럼 도메인 단위 필터가 자동으로 동작합니다

### `| logfmt` vs `| json` — 선택 기준

| 상황 | 권장 파서 |
|---|---|
| 메시지 body가 `key=value` 나열 | `\| logfmt` |
| 메시지 body가 JSON 직렬화 | `\| json` |
| 전송 포맷(JSON 래퍼) 필드 추출 | `\| json` (래퍼 레이어) |
| 중첩 오브젝트 필드 접근 | `\| json` (`obj.field` 접근 지원) |
| 로그 라인 전체가 JSON | `\| json` |

go-ti처럼 전송은 JSON, body는 logfmt인 구조에서는 두 파서를 순서대로 쓸 수 있습니다

```text
{detected_service_name="goti-payment"}
  | json                          # 전송 JSON 래퍼 파싱 → trace_id 추출
  | message != ""                 # message 필드 필터
  | logfmt                        # message body의 logfmt 파싱
  | action="PAYMENT_CREATE"       # logfmt 필드 필터
```

실무에서는 `| logfmt`만으로도 message body의 logfmt 필드를 바로 추출할 수 있습니다 Loki가 JSON 래퍼의 `message` 필드 값에서 파서를 자동으로 적용하기 때문입니다

---

## 🧩 go-ti에서는

go-ti의 초기 모듈별 로그 형식은 각각 달랐습니다 Queue 서비스는 `action=ENTER gameId={}` 형태의 logfmt를 이미 쓰고 있었고, Resale과 Ticketing은 한국어 자유 형식이었으며, Payment는 로그 자체가 거의 없었습니다 이 상태에서는 Loki에서 서비스 간 통합 필터링이 불가능했고, 모듈마다 다른 파싱 규칙을 관리해야 했습니다

표준화 이후 모든 서비스가 `action={도메인}_{동작} {도메인ID}={값}` 패턴의 logfmt를 공유합니다 전송은 Spring Boot Structured Logging의 JSON 포맷을 사용하고, OTel Java Agent가 trace_id·span_id를 MDC에 자동 주입합니다 Go로 작성된 goti-load-observer는 `slog`의 logfmt 핸들러를 사용해 동일 컨벤션을 유지합니다 Grafana 대시보드에서 `action` 레이블 하나로 전 서비스의 비즈니스 이벤트를 통합 집계할 수 있게 되었습니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [애플리케이션 로깅 컨벤션 — logfmt를 표준으로 채택한 이유](/essays/goti-logging-convention-adr)에 정리했습니다

---

## 📚 핵심 정리

- logfmt(`key=value` 나열)는 사람 가독성과 기계 파싱 능력을 모두 갖춘 포맷으로, Loki `| logfmt` 파서가 런타임에 필드를 즉시 추출합니다
- 전송 포맷(JSON 래퍼)과 메시지 body(logfmt)는 별개의 레이어입니다 JSON 전송은 OTel Collector가 자동 파싱하고, body의 logfmt는 Loki 쿼리 시점에 파싱합니다
- `trace_id`·`span_id`는 JSON 전송 포맷의 별도 필드로 포함되어 Loki에 저장됩니다 OTel Java Agent가 MDC에 자동 주입하므로 코드 변경 없이 모든 로그에 trace 상관관계가 붙습니다
- 레이블 설계가 Loki 성능을 결정합니다 `action`, `service`, `level` 같은 저카디널리티 값만 레이블로 씁니다 `orderId`, `trace_id` 같은 고유 식별자는 logfmt body에 넣고 `| logfmt` 파서로 추출합니다
- `| logfmt`와 `| json`은 같은 쿼리 파이프라인에서 순서대로 적용할 수 있습니다 전송 JSON 래퍼를 먼저 `| json`으로 열고, message body를 `| logfmt`로 파싱하는 이중 파서 패턴이 가능합니다
