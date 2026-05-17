---
title: "Redis Pub/Sub — 채널 기반 메시징과 fire-and-forget의 동작 원리"
excerpt: "Redis Pub/Sub이 채널을 어떻게 관리하고 구독자에게 메시지를 push하는지, fire-and-forget의 한계가 어디서 오는지 내부 동작으로 설명합니다"
category: challenge
tags:
  - go-ti
  - Redis
  - pub-sub
  - fire-and-forget
  - fan-out
  - concept
series:
  name: "goti-deepdive-redis"
  order: 3
date: "2026-04-14"
---

## 한 줄 요약

> Redis Pub/Sub은 publisher가 채널에 메시지를 발행하면 해당 채널을 구독 중인 모든 클라이언트에게 즉시 push하는 메시징 모델이며, 구독하지 않은 시간 동안의 메시지는 영속되지 않아 소멸됩니다

---

## 🤔 무엇을 푸는 기술인가

### polling의 구조적 비용

서비스 간에 "상태가 바뀌면 알려줘"가 필요한 상황은 흔합니다
결제 완료, 주문 상태 변경, 실시간 알림이 대표적입니다

가장 단순한 구현은 **polling**입니다
클라이언트가 일정 주기로 서버에 "지금 어때?" 요청을 반복합니다
구현은 쉽지만 두 가지 비용이 따릅니다

첫째, **불필요한 요청**입니다
상태가 변하지 않아도 요청이 발생합니다
변화가 드문 시나리오일수록 낭비 비율이 높아집니다

둘째, **지연(latency)**입니다
변화 시점과 클라이언트가 변화를 감지하는 시점 사이에 polling 주기만큼의 지연이 생깁니다
주기를 짧게 하면 지연은 줄지만 요청 수가 폭발적으로 증가합니다

### Pub/Sub가 해결하는 문제

Redis Pub/Sub는 이 구조를 뒤집어 **push 모델**로 전환합니다
클라이언트가 묻는 대신 채널을 구독(subscribe)하고 대기합니다
상태가 바뀐 쪽이 채널에 메시지를 발행(publish)하면 Redis가 즉시 전달합니다

불필요한 요청이 사라지고 지연이 실질적으로 0에 가까워집니다
동시에 **fan-out**이 기본 동작입니다 — 같은 채널을 구독한 모든 클라이언트가 동시에 메시지를 받습니다

---

## 🔧 동작 원리

### 채널과 구독 등록

Redis Pub/Sub의 핵심 자료구조는 **채널 레지스트리(Channel Registry)**입니다
Redis 서버는 내부적으로 채널 이름을 키로, 구독 중인 클라이언트 연결 목록을 값으로 하는 매핑을 유지합니다

클라이언트가 `SUBSCRIBE`를 실행하면 이 매핑에 자신이 등록됩니다

```bash
SUBSCRIBE payment:status
```

이후 해당 채널에 메시지가 발행될 때마다 Redis는 매핑을 탐색해 등록된 모든 클라이언트에게 메시지를 push합니다

`PSUBSCRIBE`를 쓰면 패턴으로 여러 채널을 한 번에 구독할 수 있습니다

```bash
# payment:로 시작하는 모든 채널 구독
PSUBSCRIBE payment:*
```

`payment:status`, `payment:refund`, `payment:error` 등 모든 채널 메시지를 하나의 연결로 받을 수 있습니다

### PUBLISH — 메시지 발행

publisher는 채널명과 메시지를 함께 전달합니다

```bash
PUBLISH payment:status '{"order_id":"abc123","result":"paid"}'
```

반환값은 **이 명령으로 메시지를 받은 클라이언트 수**입니다
구독자가 없으면 0을 반환합니다

```bash
# 반환 예시
(integer) 2   # 2개의 클라이언트에게 전달됨
```

Redis는 이 명령을 받는 순간 채널 레지스트리에서 `payment:status` 구독자를 조회하고 각각의 TCP 연결로 메시지를 즉시 씁니다
PUBLISH 자체는 동기로 완료됩니다 — 모든 구독자에게 write가 끝나야 반환합니다

### Polling vs Pub/Sub 비교 흐름

![Polling 방식과 Redis Pub/Sub 방식 비교|tall](/diagrams/goti-deepdive-redis-pubsub-1.svg)

왼쪽(Polling)에서 클라이언트는 Server에 반복적으로 `GET /status` 요청을 보냅니다
결과가 `pending`이면 일정 시간 대기 후 다시 요청합니다
상태가 바뀌기 전까지 이 루프가 계속됩니다
서버는 매 요청마다 DB 조회가 발생하고, 대부분의 응답이 "아직 변화 없음"으로 끝납니다

오른쪽(Pub/Sub)에서 Subscriber A와 B는 채널을 한 번 구독하고 대기합니다
Publisher가 결제 완료 후 `PUBLISH`를 한 번 실행하면 Redis가 연결된 구독자 전체에 즉시 push합니다
서버 쪽 처리는 한 번, 클라이언트는 변화 시점에만 깨어납니다

하단 경고 박스가 핵심 한계를 보여줍니다 — **구독하지 않은 시간에 발행된 메시지는 소멸**됩니다

### fire-and-forget — 내부에서 무슨 일이 일어나는가

Redis Pub/Sub의 메시지에는 **저장(persistence)이 없습니다**
PUBLISH 명령이 실행되는 순간, Redis는 현재 채널 레지스트리에 등록된 클라이언트 목록만 봅니다
그 연결들에게 push하고 나면 Redis 쪽에서는 해당 메시지에 대한 정보가 사라집니다

이 동작을 **fire-and-forget**이라고 부릅니다
"쏘고 잊는다"는 의미입니다

결과적으로 세 가지 상황에서 메시지가 유실됩니다

- 메시지 발행 시점에 구독하지 않은 클라이언트 (연결이 끊겨 있거나 아직 구독 전)
- 네트워크 단절로 TCP write가 실패한 클라이언트
- Redis 서버 재시작 (메모리 휘발)

### Redis Pub/Sub 내부 동작 흐름

![Redis Pub/Sub 내부 동작 — SUBSCRIBE·PUBLISH·fire-and-forget 흐름|tall](/diagrams/goti-deepdive-redis-pubsub-2.svg)

왼쪽 Publisher가 `PUBLISH payment:status "paid"`를 보냅니다
Redis 서버 내부의 채널 레지스트리(`payment:status → [A, B]`)를 탐색합니다
현재 연결되어 구독 중인 Subscriber A와 B에게 메시지를 push합니다

Subscriber C는 오프라인 상태이거나 해당 채널을 구독하지 않았습니다
Redis는 채널 레지스트리에 C가 없으므로 전달을 시도하지 않습니다
이 메시지는 C에게 영구적으로 전달 불가입니다 — Redis 어디에도 메시지가 남지 않습니다

왼쪽 아래의 SUBSCRIBE 흐름 박스가 순서를 요약합니다
클라이언트가 먼저 구독을 등록하고, 이후 발행된 메시지만 받을 수 있습니다
구독 이전 메시지는 소급 수신이 불가합니다

오른쪽 PSUBSCRIBE 박스는 `payment:*` 같은 와일드카드 패턴으로 여러 채널을 한 번에 구독하는 방식을 보여줍니다
패턴 구독도 동일한 fire-and-forget 특성을 가집니다

### fan-out 특성

같은 채널을 구독한 클라이언트 수에 관계없이 publisher는 PUBLISH 한 번으로 모두에게 전달합니다
이것이 **fan-out** 패턴입니다

publisher는 구독자가 몇 명인지 알 필요가 없습니다
Redis가 채널 레지스트리를 순회하며 자동으로 분배합니다

구독자가 100명이라면 하나의 PUBLISH로 100개의 TCP write가 발생합니다
Redis 서버 입장에서는 구독자 수만큼 처리 비용이 선형으로 늘어납니다
구독자 수가 매우 많다면 이 점을 감안해 설계해야 합니다

---

## 📐 세부 동작과 옵션

### 구독 상태에서의 클라이언트 제약

`SUBSCRIBE` 또는 `PSUBSCRIBE`를 실행한 클라이언트는 **구독 모드**로 진입합니다
구독 모드에서는 아래 명령만 허용됩니다

| 허용 명령 | 용도 |
|---|---|
| `SUBSCRIBE` | 추가 채널 구독 |
| `UNSUBSCRIBE` | 채널 구독 해제 |
| `PSUBSCRIBE` | 패턴 채널 구독 |
| `PUNSUBSCRIBE` | 패턴 구독 해제 |
| `PING` | 연결 유지 확인 |
| `RESET` | 구독 모드 초기화 |
| `QUIT` | 연결 종료 |

`GET`, `SET`, `HSET` 같은 일반 데이터 명령은 구독 모드에서 실행할 수 없습니다
Pub/Sub 전용 연결을 분리해서 관리하는 이유가 여기 있습니다
Go의 `go-redis` 클라이언트는 이를 위해 `Subscribe()` 호출 시 별도 연결을 자동으로 생성합니다

### Keyspace Notification — 키 이벤트 구독

Redis 설정을 통해 **데이터 변경 자체를 채널로 받는** Keyspace Notification을 활성화할 수 있습니다

```bash
# redis.conf 또는 CONFIG SET
CONFIG SET notify-keyspace-events KEA
# K = Keyspace, E = Keyevent, A = 모든 명령
```

활성화하면 아래 같은 자동 생성 채널에서 이벤트를 받습니다

```text
__keyevent@0__:set      # DB 0에서 SET 명령 발생 시
__keyspace@0__:mykey    # DB 0의 mykey에 변경 발생 시
```

TTL 만료 이벤트도 구독할 수 있습니다

```text
__keyevent@0__:expired  # 키가 만료(expire)될 때
```

이 기능도 동일한 fire-and-forget 특성을 가집니다
이벤트 발생 시점에 구독 중이지 않으면 이벤트를 받지 못합니다

### Pub/Sub vs Streams — 무엇을 쓸 것인가

| 특성 | Pub/Sub | Redis Streams |
|---|---|---|
| 메시지 영속성 | 없음 | 있음 (append-only log) |
| 소비자 오프라인 시 | 메시지 소멸 | 메시지 보존 |
| 재처리 | 불가 | 가능 (ID 지정) |
| 처리 보장 | at-most-once | at-least-once (PEL) |
| fan-out | 기본 동작 | 별도 구성 필요 |
| 구현 단순성 | 단순 | 복잡 |

두 모델의 선택 기준은 **메시지 유실 허용 여부**입니다
유실을 허용해도 되는 실시간 알림, 브로드캐스트 상태 업데이트라면 Pub/Sub가 구현 비용이 낮습니다
결제 완료, 주문 처리처럼 하나라도 빠지면 안 되는 이벤트라면 영속성과 PEL을 가진 Streams가 맞습니다

---

## 🧩 go-ti에서는

go-ti의 ADR-0014에서 결제 상태 전달 방식을 **polling에서 Pub/Sub으로 전환하는 Phase C** 설계가 수립되었습니다
3000 VU 부하 테스트에서 결제 경로의 RDS 경합이 확인된 이후, Redis-first 전환의 일환으로 설계된 항목입니다

결제 서버가 처리 완료 후 `payment:status:{order_id}` 채널에 결과를 발행(PUBLISH)하면, 결과를 기다리는 클라이언트나 내부 서비스가 구독(SUBSCRIBE)해 즉시 수신하는 구조입니다
기존 polling 방식에서 발생하던 반복적 DB 조회가 제거되어 RDS 부하가 크게 줄어들 것으로 기대되었습니다

결제 이벤트 자체는 유실되면 안 되는 도메인이기 때문에, Pub/Sub 알림은 "변화가 있었다는 신호"로만 쓰고 실제 데이터는 별도 Outbox 패턴으로 처리하는 설계를 채택했습니다
Pub/Sub의 fire-and-forget 한계를 인지하면서 역할을 의도적으로 제한한 접근입니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [티켓팅 도메인 Redis-first 전환 (ADR)](/logs/goti-redis-first-ticketing-adr)에 정리했습니다

---

## 📚 핵심 정리

- Redis Pub/Sub은 채널 기반 push 모델입니다 publisher가 PUBLISH하면 Redis가 채널 레지스트리를 탐색해 구독 중인 모든 클라이언트에게 즉시 전달합니다
- fire-and-forget 특성으로 메시지 영속성이 없습니다 구독하지 않은 시간에 발행된 메시지는 복구할 방법이 없습니다
- fan-out이 기본입니다 같은 채널 구독자 전체가 하나의 PUBLISH로 메시지를 받습니다 구독자 수에 비례해 Redis의 write 비용이 증가합니다
- PSUBSCRIBE로 와일드카드 패턴 구독이 가능합니다 `payment:*` 한 번으로 모든 하위 채널 메시지를 받을 수 있습니다
- 영속성이 필요하면 Redis Streams를 검토합니다 Pub/Sub은 유실이 허용되는 실시간 알림·브로드캐스트에 적합하고, Streams는 처리 보장이 필요한 이벤트 파이프라인에 맞습니다
