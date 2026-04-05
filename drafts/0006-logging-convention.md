# 애플리케이션 로깅 컨벤션 아키텍처 결정 (ADR)

작성일: 2026-03-28
상태: Proposed
프로젝트: Goti (대규모 티켓팅 서비스)

---

## Decision Summary

| 결정 항목 | 선택 | 대안 | 핵심 근거 |
|-----------|------|------|-----------|
| 로그 메시지 포맷 | **logfmt (key=value)** | 자유형식 한국어, JSON body | Loki `| logfmt` 즉시 파싱 + 사람 가독성 균형 |
| 전송 포맷 | **JSON (Spring Boot Structured Logging)** | plaintext | OTel Collector/Alloy 자동 파싱, trace 상관관계 |
| 필수 필드 | **action + 도메인 ID** | 자유 선택 | 대시보드 집계·필터링 표준화 |

---

## 1. 배경 (Context)

### 현재 문제

goti-server 모듈별 로그 양식이 제각각이다:

| 모듈 | 현재 패턴 | 예시 |
|------|----------|------|
| Queue | `action=` 구조화 key=value | `action=ENTER gameId={} userId={}` |
| Resale | 한국어 + 하이픈 구분 | `리셀 결제 요청 실패 - orderId: {}, error: {}` |
| Ticketing | 한국어 + 혼합 | `주문 결제 완료 처리 시작 - orderId: {}, userId: {}` |
| Payment | 로그 거의 없음 (1개) | `리셀 주문 결제 확정 - orderId: {}, buyerId: {}` |

**문제점:**
- Loki에서 통합 필터링/집계 불가 — 모듈마다 파싱 규칙이 달라야 함
- Grafana 대시보드에서 `action` 기반 드릴다운 불가능 (Queue만 가능)
- Payment 모듈은 금융 거래임에도 추적 로그가 사실상 없음
- MSA 분리 후 서비스 간 요청 추적 시 로그 포맷 불일치로 상관관계 분석 어려움

### 요구사항

| 요구사항 | 설명 | 중요도 |
|----------|------|--------|
| Loki 자동 파싱 | `\| logfmt` 또는 `\| json`으로 필드 즉시 추출 | 필수 |
| Grafana 대시보드 연동 | `action`, `service`, 도메인 ID로 필터/집계 | 필수 |
| OTel trace 상관관계 | trace_id/span_id 자동 포함 | 필수 |
| 사람 가독성 | 터미널/로그 뷰어에서 직관적 파악 | 중요 |
| MSA 서비스 간 일관성 | 모든 서비스가 동일 포맷 사용 | 필수 |
| 금융 거래 추적성 | 결제 생명주기 전체 추적 가능 | 필수 |

---

## 2. 대안 비교

### Option A: 자유형식 한국어 메시지

```java
log.info("주문 결제 완료 처리 시작 - orderId: {}, userId: {}", orderId, userId);
log.error("결제 생성 실패 - orderId: {}, reason: {}", orderId, reason);
```

| 항목 | 평가 |
|------|------|
| 사람 가독성 | ★★★★★ 최고 |
| Loki 자동 파싱 | ★☆☆☆☆ 불가 — 정규식 필요 |
| 대시보드 집계 | ★☆☆☆☆ action/필드 기반 집계 불가 |
| MSA 일관성 | ★★☆☆☆ 개발자마다 메시지 제각각 |
| 구현 난이도 | ★★★★★ 가장 쉬움 |

### Option B: JSON body 로깅

```java
log.info("""
    {"action":"PAYMENT_CREATE","orderId":"{}","amount":{},"status":"SUCCESS"}""",
    orderId, amount);
```

| 항목 | 평가 |
|------|------|
| 사람 가독성 | ★★☆☆☆ 나쁨 — 중괄호/따옴표 noise |
| Loki 자동 파싱 | ★★★★★ 최고 — `\| json` 완벽 |
| 대시보드 집계 | ★★★★★ 최고 |
| MSA 일관성 | ★★★★☆ 구조 강제됨 |
| 구현 난이도 | ★★☆☆☆ JSON 이스케이프 주의 필요 |

### Option C: logfmt (key=value) — 선택

```java
log.info("action=PAYMENT_CREATE orderId={} amount={} status=SUCCESS", orderId, amount);
log.error("action=PAYMENT_FAILED orderId={} reason={}", orderId, reason, e);
```

| 항목 | 평가 |
|------|------|
| 사람 가독성 | ★★★★☆ 좋음 — key=value 직관적 |
| Loki 자동 파싱 | ★★★★★ `\| logfmt` 한 줄로 모든 필드 추출 |
| 대시보드 집계 | ★★★★★ action, orderId 등으로 즉시 필터 |
| MSA 일관성 | ★★★★★ 양식 강제 용이 |
| 구현 난이도 | ★★★★★ SLF4J placeholder 그대로 사용 |

### 비교 매트릭스

| 항목 | A. 자유형식 | B. JSON body | C. logfmt |
|------|-----------|-------------|-----------|
| Loki `\|` 파싱 | 정규식 필요 | `\| json` | **`\| logfmt`** |
| 사람 가독성 | ★★★★★ | ★★☆☆☆ | **★★★★☆** |
| 대시보드 필터 | 불가 | 가능 | **가능** |
| SLF4J 호환 | 자연스러움 | 어색함 | **자연스러움** |
| Go 생태계 호환 | 없음 | 있음 | **네이티브 (slog)** |
| 학습 비용 | 없음 | 낮음 | **낮음** |

---

## 3. 결정 (Decision)

### logfmt (key=value) 포맷을 앱 로그 메시지 표준으로 채택한다.

**선택 근거:**

1. **Loki 최적 호환**: `| logfmt`으로 모든 필드를 즉시 추출. 정규식이나 JSON 파싱 없이 `action="PAYMENT_CREATE"` 같은 필터를 바로 사용 가능
2. **사람 + 기계 균형**: JSON보다 읽기 쉽고, 자유형식보다 파싱이 쉬운 최적 균형점
3. **SLF4J 자연스러운 호환**: `log.info("action=X key={}", value)` — 기존 코드 스타일과 충돌 없음
4. **Go 생태계 호환**: goti-load-observer(Go)의 `slog`가 logfmt 네이티브 지원. MSA 전 서비스 통일 가능
5. **Queue 모듈 검증 완료**: 이미 `action=` 패턴으로 운영 중, 대시보드 연동 검증됨

**트레이드오프 인정:**

- 한국어 메시지의 직관성을 포기함 → `action` 값의 네이밍으로 보완 (예: `PAYMENT_CREATE`, `SEAT_HOLD_EXPIRE`)
- 공백 포함 값은 따옴표 필요 → 도메인 ID/숫자 위주라 실제 빈도 낮음
- JSON body 대비 중첩 구조 미지원 → 로그 메시지에 중첩이 필요한 경우는 거의 없음

### 전송 포맷

Spring Boot Structured Logging (JSON)을 전송 포맷으로 사용한다:

```yaml
# application.yml
logging:
  structured:
    format:
      console: logstash  # JSON 출력 (OTel Collector/Alloy가 파싱)
  pattern:
    level: "%5p [${spring.application.name:},%X{trace_id:-},%X{span_id:-}]"
```

- 전송은 JSON (기계 파싱용), 메시지 body는 logfmt (사람 가독성 + Loki 필드 추출용)
- OTel Java Agent가 trace_id/span_id를 MDC에 자동 주입

---

## 4. 결과 (Consequences)

### 긍정적 영향

- Grafana 대시보드에서 `action` 기반 필터/집계 전 모듈 통일
- Loki LogQL 쿼리 표준화: `{service_name=~"$svc"} | logfmt | action="PAYMENT_CREATE"`
- 새 모듈/서비스 추가 시 로그 양식 논의 불필요 — 컨벤션 문서 참조
- Payment 등 로그 부재 모듈의 추적성 확보

### 부정적 영향 / 리스크

- 기존 Resale/Ticketing 모듈의 한국어 메시지를 logfmt으로 전환하는 마이그레이션 필요
- 팀원 학습 비용 (낮음 — key=value는 직관적)
- value에 공백/특수문자가 있으면 따옴표로 감싸야 함

### 향후 과제

- [ ] 기존 모듈 로그 마이그레이션 (Queue 제외 — 이미 준수)
- [ ] Payment 모듈 로그 추가 (Critical)
- [ ] Grafana 대시보드 `| logfmt` 기반 패널 추가
- [ ] Spring Boot 3.4+ structured logging 전환 검토 (현재 3.x 버전 확인 필요)
- [ ] 로그 기반 알림 규칙 표준화 (action별 에러율)

---

## 5. 참고 자료

- [Spring Boot Structured Logging Docs](https://docs.spring.io/spring-boot/reference/features/logging.html)
- [Grafana Loki — OTel 수집](https://grafana.com/docs/loki/latest/send-data/otel/)
- [Loki Structured Metadata](https://grafana.com/docs/loki/latest/get-started/labels/structured-metadata/)
- [Log Format Standards: JSON, XML, Key-Value | Last9](https://last9.io/blog/log-format/)
- [Structured Logging Guide | SigNoz](https://signoz.io/blog/structured-logs/)
- 내부: `docs/conventions/logging-standard.md` (실전 가이드)
