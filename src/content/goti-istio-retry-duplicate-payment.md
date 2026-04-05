---
title: "Istio Retry가 결제를 3번 시도했다: 비멱등 API의 함정"
excerpt: "VirtualService retryOn: 5xx 설정이 POST 결제 API에 적용되면서 발생한 중복 결제 시도와 @Transactional 롤백 불일치 문제"
category: "kubernetes"
tags:
  - go-ti
  - Istio
  - VirtualService
  - Retry
  - Payment
  - Idempotency
  - Troubleshooting
date: "2026-04-03"
---

## 🎯 한 줄 요약

> Queue POC smoke 테스트에서 티켓팅 성공률 0%. 대기열은 100% 통과했지만, Istio VirtualService의 `retryOn: 5xx` 설정이 POST 결제 API를 3번 호출하면서 모든 결제가 실패했다.

## 📊 Impact

- **영향 범위**: goti-payment-junsang, goti-payment-suyeon, goti-payment-sungjeon — 전체 POC payment 서비스
- **핵심 지표**: `goti_ticket_success_rate: 0%`
- **증상**: 대기열 통과율 100%이나 결제 단계에서 전부 실패
- **소요 시간**: 약 3시간 (분석 2시간 + 수정/검증 1시간)
- **발생일**: 2026-04-03

---

## 🔥 증상: 대기열은 통과했는데 결제가 전부 실패한다

### smoke 테스트 결과

Queue POC의 smoke 테스트를 돌렸습니다.
K6로 동시 사용자 시나리오를 실행했는데, 결과가 이상했어요.

```
대기열 통과율: 100%
결제 성공률: 0%
```

대기열은 완벽하게 동작하고 있었습니다.
문제는 결제 단계에서 터지고 있었어요.

처음에는 payment 서비스 자체의 버그를 의심했습니다.
DB 연결 문제? API 스펙 변경? 인증 토큰 만료?

하나씩 확인해봤지만 아무것도 해당되지 않았어요.

### 로그에서 이상한 점 발견

payment 서비스의 로그를 뒤지다가 수상한 패턴을 발견했습니다.

```log
03:24:56.538 주문 결제 완료 처리 시작 - orderId: 7e50db38...
03:24:56.717 주문 결제 완료 처리 시작 - orderId: 7e50db38... → WARN: 결제 가능한 주문 상태가 아닙니다
03:24:56.804 주문 결제 완료 처리 시작 - orderId: 7e50db38... → WARN: 결제 가능한 주문 상태가 아닙니다
```

같은 `orderId`에 대해 결제 요청이 **3번** 들어오고 있었습니다.

첫 번째 요청은 정상적으로 시작되었고, 두 번째와 세 번째는 "결제 가능한 주문 상태가 아닙니다"라는 경고와 함께 실패했어요.

뭐지? K6 스크립트가 중복 요청을 보내고 있나?

K6 코드를 확인했습니다. 결제 요청은 한 번만 보내고 있었어요.

그렇다면 누가 같은 요청을 3번 보낸 걸까?

시간 간격을 보면 힌트가 있습니다.

```
538ms → 717ms → 804ms
```

179ms, 87ms 간격으로 거의 즉시 재요청이 들어오고 있었어요.
이건 사람이 아니라 **인프라 레이어에서 자동으로 재시도**하고 있다는 뜻이다.

아! **Istio retry.**

---

## 🤔 원인 분석: Istio가 결제를 3번 시도하고 있었다

### VirtualService retry 설정

payment 서비스의 VirtualService 설정을 확인했습니다.

```yaml
# goti-payment-{suyeon,junsang,sungjeon} VirtualService httpRoutes
retries:
  attempts: 2
  perTryTimeout: 5s
  retryOn: 5xx,reset,connect-failure  # ← 문제의 설정
```

여기서 핵심은 `retryOn: 5xx`입니다.
payment 서비스가 500을 반환하면, Istio가 자동으로 재시도해요.

### `attempts: 2`의 의미

Istio의 `attempts` 필드는 직관적이지 않습니다.

많은 사람이 "총 2번 시도"라고 생각하지만, 실제로는 **"원본 1회 + retry 2회 = 총 3회"**예요.

```
attempts: 2 → 원본 요청 1 + 재시도 2 = 총 3번
```

로그에서 같은 orderId가 정확히 3번 나타난 이유가 이것이었습니다.

| 시도 | 시간 | 결과 |
|------|------|------|
| 원본 요청 | 03:24:56.538 | payment 내부 오류 → 500 |
| Retry 1 | 03:24:56.717 | "결제 가능한 주문 상태가 아닙니다" → 500 |
| Retry 2 | 03:24:56.804 | "결제 가능한 주문 상태가 아닙니다" → 500 |

첫 번째 시도에서 500이 반환되자, Istio가 179ms 후에 즉시 retry를 보냈어요.
그 retry도 실패하자, 87ms 후에 또 retry를 보냈습니다.

이 표를 보면 의문이 생깁니다.
왜 첫 번째 시도는 500이고, 나머지는 "결제 가능한 주문 상태가 아닙니다"인 걸까?

이것을 이해하려면 payment 서비스 내부에서 어떤 일이 벌어지는지 알아야 합니다.

### 비멱등 API에 retry가 적용되면 벌어지는 일

결제 API의 내부 흐름을 따라가봅시다.

#### 정상 흐름 (retry 없이)

```
Client → payment.initPayment() @Transactional
           │
           ├─ 1. ticketingOrderClient.confirmPayment()
           │     → ticketing 서비스: 주문 상태를 PAID로 변경
           │     → 200 OK
           │
           ├─ 2. orderClient.orderDetail()
           │     → 주문 상세 정보 조회
           │     → 200 OK
           │
           ├─ 3. 결제 정보 DB 저장
           │
           └─ commit → 200 OK
```

{/* TODO: Draw.io로 교체 */}

이 흐름에서 핵심은 **1번 단계에서 ticketing 서비스의 주문 상태가 PAID로 변경**된다는 점이에요.
이 호출은 payment 서비스의 `@Transactional` 범위 안에 있지만, ticketing은 별도 서비스입니다.
HTTP를 통해 외부 서비스의 상태를 변경하는 거예요.

#### 장애 흐름 (retry 발생)

```
Client → Istio Sidecar → payment.initPayment() @Transactional
                            │
                            ├─ 1. ticketingOrderClient.confirmPayment()
                            │     → ticketing: 주문 상태 PENDING → PAID ✅
                            │     → 200 OK (외부 상태 이미 변경됨!)
                            │
                            ├─ 2. orderClient.orderDetail()
                            │     → 실패 or 타임아웃 ❌
                            │
                            └─ @Transactional 롤백
                               → payment DB: 롤백됨 ✅
                               → ticketing: PAID 상태 유지 ⚠️ (롤백 안 됨!)
                               → payment 500 반환

         Istio: "500이네? retry하자"

         Istio Sidecar → payment.initPayment() @Transactional  [Retry 1]
                            │
                            ├─ 1. ticketingOrderClient.confirmPayment()
                            │     → ticketing: 이미 PAID 상태
                            │     → 400 "결제 가능한 주문 상태가 아닙니다" ❌
                            │
                            └─ 예외 발생 → 500 반환

         Istio: "또 500? 한 번 더"

         Istio Sidecar → payment.initPayment() @Transactional  [Retry 2]
                            │
                            ├─ 1. ticketingOrderClient.confirmPayment()
                            │     → ticketing: 여전히 PAID 상태
                            │     → 400 "결제 가능한 주문 상태가 아닙니다" ❌
                            │
                            └─ 예외 발생 → 500 반환

         Istio: "3번 다 실패. 포기."
         Client ← 500 Internal Server Error
```

{/* TODO: Draw.io로 교체 */}

이 다이어그램이 이 글의 핵심이에요. 하나씩 풀어봅시다.

**1단계: 첫 번째 시도 — 부분 성공 후 롤백**

payment의 `initPayment()` 메서드가 `@Transactional`로 감싸져 있어요.
이 트랜잭션 안에서 ticketing 서비스에 `confirmPayment()`를 호출합니다.

ticketing 서비스는 주문 상태를 `PENDING`에서 `PAID`로 변경해요.
이 변경은 **ticketing 서비스의 자체 트랜잭션**으로 즉시 커밋됩니다.

그 다음 `orderDetail()` 호출에서 실패가 발생합니다.
이때 payment의 `@Transactional`이 롤백되지만, 이미 HTTP로 보낸 ticketing 요청은 되돌릴 수 없어요.

결과적으로 payment는 500을 반환합니다.

**2단계: Istio retry — 이미 변경된 상태에서 재시도**

Istio는 500을 보고 "서버 오류니까 다시 시도하자"라고 판단해요.

하지만 ticketing 서비스에서 주문 상태는 이미 `PAID`입니다.
payment가 다시 `confirmPayment()`를 호출하면, ticketing은 "이미 결제된 주문"이라며 400을 반환해요.

이 400은 payment 내부에서 예외로 처리되어 다시 500이 반환됩니다.
Istio는 이 500을 보고 또 retry합니다.

**3단계: 최종 실패 — 모든 시도 소진**

세 번째 시도도 동일하게 실패합니다.
Istio는 모든 retry를 소진하고 클라이언트에 500을 반환해요.

결과적으로 하나의 결제 요청이 **3번의 실패**로 기록됩니다.

### @Transactional 롤백 vs 외부 서비스 상태 불일치

이 문제의 본질은 **분산 트랜잭션의 불일치**입니다.

`@Transactional`은 로컬 데이터베이스에 대해서만 롤백을 보장해요.
HTTP로 호출한 외부 서비스의 상태 변경까지 롤백해주지 않습니다.

```
@Transactional 범위:
  ┌──────────────────────────────────────┐
  │  payment DB 작업     → 롤백 가능 ✅   │
  │  ticketing HTTP 호출 → 롤백 불가 ❌   │
  │  order HTTP 호출     → 롤백 불가 ❌   │
  └──────────────────────────────────────┘
```

{/* TODO: Draw.io로 교체 */}

payment의 `@Transactional`이 롤백되면:
- **payment DB**: 저장한 결제 정보가 롤백돼요. 문제없어요.
- **ticketing 서비스**: 이미 PAID로 변경된 주문 상태는 그대로예요. 되돌릴 방법이 없어요.

이 상태에서 retry가 들어오면 ticketing은 "이미 PAID인데 왜 또 결제하려고 해?"라며 400을 반환하는 거예요.

### 왜 "일부 성공 + 전체 롤백"이 위험한지

이 패턴이 특히 위험한 이유를 정리해봅시다.

**1. 상태 불일치가 자동으로 복구되지 않는다**

ticketing에서는 PAID, payment에서는 기록 없음.
이 불일치를 해소하려면 수동 개입이나 보상 트랜잭션이 필요합니다.

**2. retry가 상황을 더 악화시킨다**

retry 없이 한 번만 실패했다면, "ticketing은 PAID인데 payment 기록이 없다"는 하나의 불일치만 남아요.
하지만 retry가 추가되면, 불필요한 에러 로그가 쌓이고, ticketing 서비스에도 불필요한 부하가 발생합니다.

**3. 멱등하지 않은 API에 retry는 부작용을 증폭시킨다**

GET 요청은 멱등합니다. 10번 호출해도 결과가 같아요.
하지만 POST로 결제를 처리하는 API는 비멱등합니다.
한 번 호출로 상태가 변경되면, 같은 요청을 다시 보내도 원래 결과를 재현할 수 없어요.

**이것이 Istio retry + 비멱등 API 조합이 치명적인 이유다.**

---

## ✅ 해결: retryOn에서 5xx 제거

### Before / After

```yaml
# Before — 5xx 포함
retries:
  attempts: 2
  perTryTimeout: 5s
  retryOn: 5xx,reset,connect-failure
```

```yaml
# After — 5xx 제거
retries:
  attempts: 2
  perTryTimeout: 5s
  retryOn: reset,connect-failure
```

변경은 단 한 줄이에요. `5xx`를 `retryOn`에서 제거했습니다.

### 왜 reset, connect-failure는 안전한가

`retryOn`에 남겨둔 두 가지 조건을 살펴봅시다.

| 조건 | 의미 | 안전한 이유 |
|------|------|-------------|
| `reset` | TCP RST 수신 | 서버가 연결을 강제로 끊은 것. 요청이 처리되지 않았을 가능성이 높다. |
| `connect-failure` | TCP 연결 자체 실패 | 서버에 도달하지 못한 것. 요청이 서버에 전달되지 않았다. |

이 두 경우는 **서버가 요청을 받기 전에 실패**한 상황이에요.
서버가 요청을 처리하지 않았으므로, 같은 요청을 다시 보내도 부작용이 없습니다.

반면 `5xx`는 다릅니다.

```
5xx = 서버가 요청을 받아서 처리하다가 실패한 것
```

서버가 요청을 받았다는 건, **이미 부분적으로 처리했을 수 있다**는 뜻이에요.
결제 API처럼 외부 서비스를 호출하는 경우, 5xx 시점에 이미 외부 상태가 변경되었을 수 있어요.

이것이 `5xx` retry가 비멱등 API에서 위험한 근본적인 이유다.

### 적용 범위

| 서비스 | 파일 | 수정 내용 |
|--------|------|-----------|
| goti-payment-junsang | `environments/prod/goti-payment-junsang/values.yaml` | `retryOn`에서 `5xx` 제거 |
| goti-payment-suyeon | `environments/prod/goti-payment-suyeon/values.yaml` | `retryOn`에서 `5xx` 제거 |
| goti-payment-sungjeon | `environments/prod/goti-payment-sungjeon/values.yaml` | `retryOn`에서 `5xx` 제거 |

세 팀의 POC payment 서비스에 동일하게 적용했습니다.

### 수정 후 검증

수정 배포 후 smoke 테스트를 다시 실행했어요.

```
대기열 통과율: 100%
결제 성공률: 정상 범위로 복구
```

같은 orderId에 대한 중복 호출도 사라졌습니다.

```log
03:45:12.112 주문 결제 완료 처리 시작 - orderId: a3f1bc92...
03:45:12.445 주문 결제 완료 처리 완료 - orderId: a3f1bc92...
```

깔끔하게 한 번만 호출되고 있어요.

---

## 🔍 더 깊은 문제: @Transactional 안에서 외부 API 호출

retry 설정을 수정해서 당장의 문제는 해결했지만, 근본적인 위험은 남아 있습니다.

### 이 패턴이 위험한 이유

```java
@Transactional
public void initPayment(PaymentRequest request) {
    // 1. 외부 서비스 호출 — 트랜잭션 범위 밖
    ticketingOrderClient.confirmPayment(request.getOrderId());

    // 2. 또 다른 외부 서비스 호출
    OrderDetail detail = orderClient.orderDetail(request.getOrderId());

    // 3. 로컬 DB 저장 — 트랜잭션 범위 안
    paymentRepository.save(new Payment(detail));
}
```

이 코드의 문제를 정리하면:

**1번에서 외부 상태가 변경됩니다.**
ticketing 서비스의 주문 상태가 `PAID`로 바뀌어요.
이 변경은 payment의 `@Transactional`과 무관하게 **즉시 커밋**됩니다.

**2번에서 실패하면 3번은 실행되지 않습니다.**
`@Transactional`이 롤백되면서 3번의 DB 저장도 취소돼요.

**하지만 1번의 변경은 되돌릴 수 없습니다.**

이것이 `@Transactional` 안에서 외부 API를 호출하면 안 되는 이유예요.
로컬 트랜잭션은 로컬 DB만 보장합니다.
HTTP로 나간 요청은 별개의 세계입니다.

### 해결 방향

이 패턴을 근본적으로 해결하려면 분산 트랜잭션 패턴이 필요합니다.

**방법 1: Outbox 패턴**

```
@Transactional 내에서:
  1. 결제 정보 DB 저장
  2. Outbox 테이블에 이벤트 저장
  → 커밋

별도 프로세스:
  3. Outbox 이벤트 발행 → ticketing 서비스 호출
  4. 실패 시 재시도 (Outbox에 기록이 있으므로 안전)
```

외부 서비스 호출을 트랜잭션 밖으로 빼는 거예요.
트랜잭션이 성공한 후에만 외부 호출이 실행됩니다.

**방법 2: SAGA 패턴**

```
1. payment: 결제 시작 (PENDING)
2. ticketing: 주문 확인 → 성공/실패
3-a. 성공: payment 상태를 COMPLETED로
3-b. 실패: 보상 트랜잭션 실행 (ticketing 롤백)
```

각 서비스가 독립적으로 트랜잭션을 관리하고, 실패 시 보상 트랜잭션으로 일관성을 맞추는 패턴이에요.

두 패턴 모두 구현 복잡도가 높습니다.
당장은 Istio retry 설정 수정으로 충분하지만, 서비스가 복잡해지면 반드시 고려해야 할 패턴이에요.

### Istio retry 설정 가이드

이번 경험을 바탕으로 정리한 Istio retry 설정 가이드예요.

| HTTP 메서드 | 멱등성 | retryOn 권장값 | 이유 |
|------------|--------|---------------|------|
| GET | 멱등 | `5xx,reset,connect-failure` | 같은 요청을 여러 번 보내도 결과가 같다 |
| POST (비멱등) | 비멱등 | `reset,connect-failure` | 서버에 도달한 후 실패하면 부작용이 남을 수 있다 |
| POST (멱등키 있음) | 멱등 | `5xx,reset,connect-failure` | 멱등키로 중복 요청을 식별할 수 있다 |
| PUT | 멱등 | `5xx,reset,connect-failure` | 같은 리소스를 같은 값으로 덮어쓰므로 안전하다 |
| DELETE | 멱등 | `5xx,reset,connect-failure` | 이미 삭제된 리소스를 다시 삭제해도 결과가 같다 |

이 테이블에서 주목할 것은 **POST (멱등키 있음)** 행이에요.

비멱등 API라도 멱등키(Idempotency Key)를 도입하면 안전하게 retry할 수 있습니다.
클라이언트가 고유한 키를 요청에 포함하고, 서버가 이 키로 중복 요청을 식별하는 방식이에요.

```
POST /payments
Idempotency-Key: abc-123-def

→ 첫 번째 요청: 결제 처리 후 결과 저장
→ 두 번째 요청 (같은 키): 저장된 결과 반환 (재처리 안 함)
```

장기적으로 결제 API에 멱등키를 도입하면, Istio retry의 `5xx`를 다시 켤 수 있어요.
그때까지는 `reset,connect-failure`만 사용하는 게 안전합니다.

### 기존 서비스 영향 확인

이번 수정은 POC payment 서비스에만 적용했어요.
추가로 확인이 필요한 사항들:

- **goti-payment-prod**: 동일한 VirtualService 설정을 사용하는지 확인 필요. 별도 구조라 파일이 다를 수 있어요.
- **ticketing / queue 서비스**: GET 중심의 API라 `5xx` retry를 유지해도 안전해요. 상태를 변경하지 않으니까요.
- **다른 POST API**: payment 외에도 상태를 변경하는 POST API가 있다면 동일한 위험이 존재합니다.

---

## 📚 핵심 포인트

- **Istio `retryOn: 5xx`는 비멱등 POST API에 적용하면 안 된다.** 서버가 요청을 부분적으로 처리한 후 실패하면, retry가 중복 부작용을 일으킨다.
- **`attempts: 2`는 "총 2번"이 아니라 "원본 1 + retry 2 = 총 3번"이다.** Istio 문서를 꼼꼼히 읽어야 한다.
- **`@Transactional` 안에서 외부 HTTP 호출은 위험하다.** 로컬 롤백은 외부 서비스의 상태 변경을 되돌리지 못한다.
- **`reset`과 `connect-failure`는 안전한 retry 조건이다.** 서버에 요청이 도달하지 않았으므로 부작용이 없다.
- **장기적으로 멱등키(Idempotency Key) 도입을 검토해야 한다.** 비멱등 API를 멱등하게 만들면, 네트워크 레벨의 retry를 안전하게 활용할 수 있다.
