---
title: "Redis Streams — append-only log와 Consumer Group 소비 모델"
excerpt: "Redis Streams가 append-only log로 어떻게 동작하고, Consumer Group이 메시지를 어떻게 분담하고 추적하는지 XADD·XREADGROUP·XACK·PEL 구조로 설명합니다"
category: challenge
tags:
  - go-ti
  - Redis
  - Redis-Streams
  - consumer-group
  - PEL
  - at-least-once
  - concept
series:
  name: "goti-deepdive-redis"
  order: 7
date: "2026-04-17"
---

## 한 줄 요약

> Redis Streams는 항목이 한 번 기록되면 덮어쓸 수 없는 append-only log이며, Consumer Group은 그 log를 여러 소비자가 분담하면서 "누가 어디까지 처리했는가"를 PEL로 추적해 at-least-once 전달을 보장합니다

---

## 🤔 무엇을 푸는 기술인가

### Pub/Sub의 한계

Redis Pub/Sub는 발행 시점에 구독 중인 클라이언트에게만 메시지를 전달합니다 구독자가 오프라인이거나 연결이 끊기면 메시지가 소멸됩니다 재연결 후에도 이전 메시지를 다시 받을 방법이 없습니다

이 "fire-and-forget" 특성은 단순 알림에는 충분하지만 **메시지를 잃어서는 안 되는** 경우에는 맞지 않습니다 주문 생성 이벤트, 결제 완료 이벤트처럼 하나라도 유실되면 데이터 불일치가 생기는 도메인이 대표적입니다

### Redis Streams가 해결하는 문제

Redis Streams는 두 가지 문제를 한꺼번에 해결합니다

첫째, **메시지 영속성**입니다 메시지는 Stream에 append-only로 기록되며 소비 여부와 무관하게 보존됩니다 구독자가 오프라인이었더라도 나중에 과거 항목을 읽을 수 있습니다

둘째, **소비 보장**입니다 Consumer Group 메커니즘은 "읽었지만 처리 확인이 안 된 항목"을 별도로 추적합니다 소비자가 크래시해도 미처리 항목이 남아 있어 재처리가 가능합니다

---

## 🔧 동작 원리

### Stream — append-only log 자료구조

Redis Stream은 항목이 한 방향으로만 추가되는 log입니다 삽입된 항목은 수정하거나 삭제할 수 없습니다(명시적 XTRIM 또는 XDEL 제외) 각 항목은 자동 생성되는 **ID**로 식별됩니다

ID 형식은 `<밀리초 타임스탬프>-<시퀀스 번호>`입니다

```text
1745000000000-0
1745000000001-0
1745000000001-1   ← 같은 밀리초에 두 번 기록되면 시퀀스가 증가
```

타임스탬프가 포함되어 있어 "언제 기록됐는가"를 ID만으로 알 수 있습니다 또한 ID는 단조 증가(monotonically increasing)하므로 순서가 보장됩니다

### XADD — 항목 추가

```bash
XADD stream_key * field1 value1 field2 value2
```

`*`는 ID를 자동 생성하라는 의미입니다 반환값이 실제 할당된 ID입니다 각 항목은 **필드-값 쌍의 집합**으로 구성됩니다 JSON이나 MessagePack으로 직렬화한 값을 단일 필드에 넣는 것도 일반적입니다

```bash
XADD outbox:stream * event ORDER_CREATED payload '{"order_id":"abc","user_id":1}'
# 반환: "1745000000005-0"
```

### Consumer Group — 소비 분담 구조

단일 소비자(XREAD)는 Stream 전체를 순서대로 읽습니다 처리 속도가 느리거나 단일 장애점이 되는 문제가 있습니다

**Consumer Group**은 하나의 Stream을 여러 소비자 인스턴스가 나눠 처리하도록 합니다 그룹 내의 각 항목은 **한 소비자에게만** 전달됩니다 같은 항목을 두 소비자가 동시에 받지 않습니다

```bash
# 그룹 생성 — '$'는 이후 신규 항목부터, '0'은 처음부터
XGROUP CREATE outbox:stream workers $ MKSTREAM

# 소비자 A가 최대 10개 항목 수신
XREADGROUP GROUP workers consumerA COUNT 10 STREAMS outbox:stream >
```

`>`는 "이 그룹에서 아직 어느 소비자에게도 전달되지 않은 신규 항목"을 의미합니다 `XREADGROUP`을 호출하면 해당 항목이 소비자 A에게 배정됩니다

### XACK와 PEL — 처리 추적 핵심

소비자가 항목을 받은 시점과 실제로 처리 완료한 시점 사이에는 간격이 있습니다 이 구간에 소비자가 크래시하면 항목을 잃어버릴 수 있습니다

Redis는 이 문제를 **PEL(Pending Entries List)** 로 해결합니다 `XREADGROUP`으로 항목을 전달하는 순간, 해당 항목이 PEL에 등록됩니다 PEL 항목에는 다음 정보가 포함됩니다

- 항목 ID
- 배정된 소비자 이름
- 전달된 시각
- 전달 횟수(delivery count)

소비자가 처리를 완료하면 `XACK`을 호출합니다

```bash
XACK outbox:stream workers 1745000000005-0
```

`XACK`가 성공하면 해당 항목이 PEL에서 제거됩니다 제거되지 않은 항목은 언제든 재처리 대상이 됩니다

![Redis Streams Consumer Group 소비 흐름 — XADD·XREADGROUP·XACK·PEL 구조|tall](/diagrams/goti-deepdive-redis-streams-consumer-group-1.svg)

Stream에 항목이 XADD로 추가됩니다 Consumer Group의 소비자 A가 XREADGROUP으로 항목을 가져오면, 해당 항목이 즉시 PEL에 등록됩니다 PEL에 등록된 항목은 아직 처리가 확인되지 않은 상태입니다

소비자 A가 처리를 완료하고 XACK를 보내면 PEL에서 항목이 제거됩니다 이 시점에 비로소 처리가 완료된 것으로 인정됩니다 XACK 없이 소비자 A가 크래시하면 PEL에 항목이 남아있어 나중에 재처리할 수 있습니다

### 미처리 항목 재처리 — XPENDING과 XCLAIM

PEL에 남아있는 항목은 `XPENDING`으로 확인할 수 있습니다

```bash
# 그룹 전체 미처리 항목 요약
XPENDING outbox:stream workers

# 상세 — 특정 소비자의 미처리 항목, 최대 10개
XPENDING outbox:stream workers - + 10 consumerA
```

크래시한 소비자의 항목은 다른 소비자가 인계받아야 합니다 `XCLAIM`이 이 역할을 합니다

```bash
# 60초 이상 처리되지 않은 항목을 consumerB에게 재배정
XCLAIM outbox:stream workers consumerB 60000 1745000000005-0
```

자동화된 방식으로는 `XAUTOCLAIM`을 씁니다

```bash
# idle 60초 초과 항목을 consumerB로 자동 재배정, 최대 10개
XAUTOCLAIM outbox:stream workers consumerB 60000 0-0 COUNT 10
```

재배정된 항목은 PEL에서 소유자가 바뀌고 delivery count가 증가합니다 delivery count가 임계치를 넘으면 "처리할 수 없는 독성 항목(poison message)"으로 판단해 dead-letter 처리를 고려해야 합니다

### at-least-once 소비가 구현되는 구조

PEL의 존재가 at-least-once 소비를 구조적으로 보장합니다 흐름을 정리하면 다음과 같습니다

```text
XREADGROUP → PEL 등록 → 처리 → XACK → PEL 제거  (정상)
XREADGROUP → PEL 등록 → 처리 실패/크래시          (예외)
              ↓
        idle timeout 초과 후 XAUTOCLAIM → 다른 소비자에게 재배정 → 재처리
```

항목이 XACK로 완전히 해소되기 전까지는 PEL에 남습니다 소비자가 몇 번 크래시하든 항목은 보존됩니다 "적어도 한 번은 처리된다"는 보장이 구조에서 나옵니다

따라서 소비자 쪽 처리는 반드시 **멱등**해야 합니다 같은 항목을 두 번 처리해도 결과가 동일해야 합니다

---

## 📐 세부 동작과 옵션

### Stream 크기 관리 — XTRIM

append-only 특성상 Stream은 계속 증가합니다 `XADD`에 `MAXLEN` 옵션을 함께 사용하면 항목 수를 자동으로 제한합니다

```bash
# 정확하게 10000개 유지 (느림)
XADD outbox:stream MAXLEN 10000 * event ORDER_CREATED payload ...

# 근사값으로 최소 10000개 유지 (빠름, ~로 근사 지정)
XADD outbox:stream MAXLEN ~ 10000 * event ORDER_CREATED payload ...
```

`~` 근사 방식은 내부 listpack/skiplist 블록 단위로 잘라내므로 정확한 숫자가 아닐 수 있지만 성능 부담이 훨씬 낮습니다 실시간 고처리량 환경에서는 `MAXLEN ~`를 권장합니다

명시적 트리밍은 `XTRIM`으로도 가능합니다

```bash
XTRIM outbox:stream MAXLEN ~ 10000
```

### 소비 시작 지점 제어

`XGROUP CREATE`의 세 번째 인수가 소비 시작 ID를 결정합니다

| 값 | 의미 |
|---|---|
| `$` | 그룹 생성 이후 신규 항목만 |
| `0` | Stream의 첫 항목부터 전체 |
| `<특정 ID>` | 해당 ID 이후 항목부터 |

서비스가 처음 기동할 때는 `$`를 쓰는 것이 일반적입니다 과거 항목을 재처리해야 하는 경우에는 `0` 또는 원하는 시점의 ID를 지정합니다

### Pub/Sub, List, Stream 비교

| 특성 | Pub/Sub | List (LPUSH/BRPOP) | Stream |
|---|---|---|---|
| 영속성 | 없음 (fire-and-forget) | 있음 | 있음 |
| 소비자 그룹 | 없음 | 없음 (단일 큐) | 있음 |
| 미처리 추적 | 없음 | 없음 | PEL |
| 과거 항목 재소비 | 불가 | 불가 | 가능 (ID 지정) |
| 처리 보장 | at-most-once | at-most-once | at-least-once |
| 메시지 순서 | 발행 순서 (연결 유지 시) | 삽입 순서 | 엄격한 ID 순서 |

Pub/Sub은 실시간 알림처럼 유실을 허용하는 경우에 적합합니다 List를 큐로 쓰는 패턴은 단순하지만 처리 보장을 직접 구현해야 합니다 Stream은 영속성·처리 보장·소비 분담을 모두 Redis 안에서 해결합니다

---

## 🧩 go-ti에서는

go-ti의 Redis SoT 전환 이후, 비즈니스 데이터 갱신과 이벤트 발행은 Lua 스크립트 안에서 원자적으로 실행됩니다 `HSET seat:{game_id}:{section_id}` 갱신과 `XADD outbox:stream * event ORDER_CREATED ...` 기록이 하나의 Lua 실행으로 묶여 분리되지 않습니다

`goti-outbox-worker`는 XREADGROUP으로 `outbox:stream`을 소비하고, 처리 완료 후 XACK를 호출합니다 ACK 전에 워커가 크래시해도 PEL에 항목이 남아있어 재기동 후 자동으로 재처리됩니다 RDS로의 idempotent UPSERT가 at-least-once 소비의 안전망 역할을 합니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [Redis as Source of Truth 전면 채택 (ADR)](/logs/goti-redis-sot-adoption-adr)에 정리했습니다

---

## 📚 핵심 정리

- Redis Stream은 append-only log입니다 삽입된 항목은 보존되며 소비 여부와 무관하게 재소비할 수 있습니다 Pub/Sub과 달리 소비자가 오프라인이었던 구간의 항목도 나중에 읽을 수 있습니다
- XADD로 항목을 기록하고, XREADGROUP으로 Consumer Group 내 소비자에게 배정합니다 같은 항목은 그룹 내 한 소비자에게만 전달됩니다
- 항목을 전달받은 순간 PEL에 등록됩니다 소비자가 XACK를 보내야 PEL에서 제거됩니다 XACK 없이 크래시해도 PEL에 항목이 남아 재처리 대상이 됩니다
- XPENDING으로 PEL 상태를 확인하고, XCLAIM/XAUTOCLAIM으로 idle 항목을 다른 소비자에게 재배정합니다 delivery count가 높은 항목은 독성 메시지(poison message)로 분류해 별도 처리합니다
- PEL 메커니즘이 at-least-once 전달을 구조적으로 보장합니다 소비자 쪽은 반드시 멱등하게 구현해야 합니다
