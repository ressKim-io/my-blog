# Istio Retry로 인한 Payment 중복 결제 확인 요청

- **날짜**: 2026-04-03
- **환경**: EKS prod (POC 부하테스트)
- **영향**: 수연/준상/성전 전체 POC payment 서비스

## 증상

Queue POC smoke 테스트에서 `goti_ticket_success_rate: 0%`. 대기열 통과 100%이나 결제 단계에서 전부 실패.

## 원인

### Istio VirtualService retry 설정

```yaml
# goti-payment-{suyeon,junsang,sungjeon} httpRoutes
retries:
  attempts: 2
  perTryTimeout: 5s
  retryOn: 5xx,reset,connect-failure  # ← 문제
```

### 발생 시퀀스

```
K6 → Istio → payment (attempt 1)
  → payment.initPayment() @Transactional
    → ticketingOrderClient.confirmPayment() → 성공 (주문 → PAID)
    → orderClient.orderDetail() → 실패 or 느림
  → @Transactional 롤백 but ticketing은 이미 PAID → payment 500 반환

Istio retry (attempt 2, 3):
  → payment.initPayment()
    → ticketingOrderClient.confirmPayment() → 400 "결제 가능한 주문 상태가 아닙니다"
  → payment 500 반환
```

### 로그 증거

같은 orderId에 대해 ticketing에 3번 payment-confirmations 호출 확인:
```
03:24:56.538 주문 결제 완료 처리 시작 - orderId: 7e50db38...
03:24:56.717 주문 결제 완료 처리 시작 - orderId: 7e50db38... → WARN: 결제 가능한 주문 상태가 아닙니다
03:24:56.804 주문 결제 완료 처리 시작 - orderId: 7e50db38... → WARN: 결제 가능한 주문 상태가 아닙니다
```

`attempts: 2` = 원본 1 + retry 2 = **총 3번** → 로그와 정확히 일치.

## 근본 원인

**POST /payments는 비멱등(non-idempotent) API인데 Istio가 5xx retry를 수행.**

결제 API는 상태를 변경하는 POST이므로, 5xx 발생 시 재시도하면 중복 결제 시도가 발생한다. 특히 `@Transactional` 내에서 외부 서비스(ticketing) 호출 후 롤백되면, 외부 상태는 이미 변경된 상태에서 retry가 실행되어 불일치가 발생.

## 수정

```yaml
# Before
retryOn: 5xx,reset,connect-failure

# After — 5xx 제거 (비멱등 POST에 대해 5xx retry 위험)
retryOn: reset,connect-failure
```

`reset`(TCP RST)과 `connect-failure`는 요청이 서버에 도달하지 않은 경우이므로 안전하게 retry 가능.

### 적용 범위

| 서비스 | 파일 | 수정 |
|--------|------|------|
| goti-payment-junsang | `environments/prod/goti-payment-junsang/values.yaml` | `5xx` 제거 |
| goti-payment-suyeon | `environments/prod/goti-payment-suyeon/values.yaml` | `5xx` 제거 |
| goti-payment-sungjeon | `environments/prod/goti-payment-sungjeon/values.yaml` | `5xx` 제거 |

## 추가 고려사항

- **기존 goti-payment-prod도 동일 설정인지 확인 필요** (파일 미존재 — prod payment는 별도 구조)
- **ticketing/queue 라우트는 GET 중심이므로 5xx retry 유지해도 무방**
- **장기적으로**: `@Transactional` 내에서 외부 API 호출하는 패턴 자체가 위험. Outbox 패턴 또는 SAGA 검토 필요
