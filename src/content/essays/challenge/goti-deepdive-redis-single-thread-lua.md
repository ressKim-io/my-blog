---
title: "Redis 단일 스레드와 Lua 원자성 — 왜 Lock 없이 동시성 문제가 해결되는가"
excerpt: "Redis가 명령을 단일 스레드로 직렬 처리하는 이유, Lua 스크립트가 끼어들 틈 없이 실행되는 원리, 그리고 WATCH/MULTI/EXEC 낙관적 트랜잭션과 무엇이 다른지를 교과서적으로 풀어냅니다"
category: challenge
tags:
  - go-ti
  - Redis
  - Lua
  - 단일-스레드
  - EVALSHA
  - 원자성
  - concept
series:
  name: "goti-deepdive-redis"
  order: 6
date: "2026-04-17"
---

## 한 줄 요약

> Redis는 단 하나의 스레드로 모든 명령을 순서대로 처리하기 때문에, Lock 없이도 경쟁 조건이 발생하지 않습니다 Lua 스크립트는 이 모델을 기반으로 여러 명령을 하나의 단위로 묶어 원자적으로 실행합니다

---

## 🤔 무엇을 푸는 기술인가

### 동시성과 check-then-act 문제

분산 시스템에서 가장 흔한 버그 패턴 중 하나는 **check-then-act race**입니다

```text
Thread A: 재고 확인 → 1 남음 → 차감 결정
Thread B: 재고 확인 → 1 남음 → 차감 결정
Thread A: 재고 차감 → 0
Thread B: 재고 차감 → -1  ← 재고 초과 판매
```

두 스레드가 "확인" 단계를 동시에 통과하면, 각자 독립적으로 "차감" 단계를 수행해 불일치가 생깁니다 관계형 데이터베이스는 이를 `SELECT FOR UPDATE` 같은 비관적 잠금이나 CAS(Compare-And-Swap) 트랜잭션으로 해결합니다

Redis는 다른 방식으로 이 문제를 구조적으로 없앱니다

### 단일 스레드가 제공하는 불변 보장

Redis 명령 처리기는 설계 원칙부터 **단 하나의 스레드로 모든 명령을 처리**합니다 멀티스레드 서버처럼 스레드 간 공유 메모리나 뮤텍스가 없습니다 두 클라이언트가 동시에 명령을 보내더라도, Redis 내부에서 그 명령들은 반드시 어떤 순서로든 줄 세워져 하나씩 실행됩니다

이 단순한 설계 결정이 **Lock 없는 원자성**을 가능하게 합니다

---

## 🔧 동작 원리

### 이벤트 루프와 명령 직렬화

Redis 프로세스는 내부적으로 `ae_event_loop`라는 이벤트 루프를 실행합니다 이 루프는 epoll(Linux) 또는 kqueue(macOS)를 통해 소켓 I/O를 비동기로 감지하고, 준비된 명령을 순서대로 단일 스레드에서 실행합니다

![Redis 단일 스레드 명령 직렬화 구조도|tall](/diagrams/goti-deepdive-redis-single-thread-lua-1.svg)

위 구조도를 단계별로 따라가겠습니다

1. **소켓 버퍼 수신** — 클라이언트 1~4가 각자 다른 명령(`HSET`, `EVALSHA`, `HGET`, `XADD`)을 보냅니다 각 명령은 TCP 소켓의 recv buffer에 도착합니다
2. **epoll 알림** — 이벤트 루프가 epoll을 통해 "읽을 수 있는 소켓"을 감지합니다 여러 소켓이 동시에 준비되어도 이벤트 루프는 하나씩 처리합니다
3. **FIFO 큐 진입** — 파싱된 명령들은 도착 순서대로 실행 큐에 쌓입니다 순서는 이벤트 루프가 소켓을 처리하는 순서에 따릅니다
4. **단일 스레드 실행** — 실행기는 큐의 맨 앞 명령 하나를 꺼내 완전히 실행한 뒤에야 다음 명령으로 넘어갑니다 명령 실행 중에는 다른 명령이 **절대 끼어들 수 없습니다**
5. **응답 반환** — 실행 결과가 해당 클라이언트 소켓에 기록됩니다

이 흐름 덕분에 어떤 클라이언트도 "다른 명령이 실행 중인 틈"을 비집고 들어올 수 없습니다 뮤텍스나 세마포어가 없어도 됩니다

### Lua 스크립트: 여러 명령을 하나의 명령처럼

단일 명령은 원자적입니다 그런데 비즈니스 로직은 보통 여러 명령을 조합합니다

```text
재고 확인 (HGET)
→ 조건 분기
→ 재고 차감 (HINCRBY)
→ 주문 기록 (HSET)
→ 이벤트 발행 (XADD)
```

이 네 단계 사이에 다른 클라이언트의 명령이 끼어들면 race가 생깁니다 Redis는 이를 위해 **Lua 스크립트 실행 모델**을 제공합니다

`EVAL` 또는 `EVALSHA`로 Lua 스크립트를 전송하면, Redis는 그 스크립트 전체를 **단 하나의 명령처럼** 처리합니다 스크립트 실행이 시작되면 완료될 때까지 다른 모든 명령은 대기 상태가 됩니다

```lua
-- hold_seat.lua (간략화)
local inventory_key = KEYS[1]  -- inv:{game_id}:{section_id}
local hold_key      = KEYS[2]  -- hold:{game_id}:{seat_id}
local user_id       = ARGV[1]
local ttl_seconds   = tonumber(ARGV[2])

-- 1. 재고 확인
local inv = tonumber(redis.call('HGET', inventory_key, 'available'))
if inv == nil or inv < 1 then
  return redis.error_reply('SOLD_OUT')
end

-- 2. 재고 차감
redis.call('HINCRBY', inventory_key, 'available', -1)

-- 3. hold 등록 (TTL 포함)
redis.call('SET', hold_key, user_id, 'EX', ttl_seconds)

-- 4. 이벤트 발행
redis.call('XADD', 'outbox:stream', '*', 'type', 'SEAT_HELD', 'seat', hold_key)

return 'OK'
```

이 스크립트를 `EVALSHA`로 실행하면, 4개 명령 사이에 **어떤 클라이언트도 끼어들 수 없습니다** "확인 후 차감" 사이에 다른 클라이언트가 같은 재고를 확인하는 상황이 구조적으로 차단됩니다

### EVALSHA와 SHA 캐싱

`EVAL`은 매번 스크립트 전문(全文)을 전송합니다 스크립트가 길면 네트워크 오버헤드가 누적됩니다 `EVALSHA`는 이를 최적화합니다

```bash
# 한 번만 등록
SCRIPT LOAD "local inv = ..."
# → "a8f3b2c4d5e6..." (SHA1 해시 반환)

# 이후 호출은 SHA로만
EVALSHA a8f3b2c4d5e6... 2 inv:{game_id}:{section_id} hold:{game_id}:{seat_id} user123 30
```

Redis는 `SCRIPT LOAD` 또는 첫 `EVAL` 시점에 스크립트를 파싱해 내부 캐시에 저장합니다 이후 `EVALSHA` 호출에서는 SHA1 해시(40자)만 전송하면 됩니다 스크립트가 100줄이어도 네트워크 전송량은 동일합니다

SHA 캐시는 서버 재시작 시 소거됩니다 애플리케이션이 시작할 때 스크립트를 다시 로드하는 초기화 패턴이 필요합니다

---

## 📐 세부 동작과 옵션

### Lua vs WATCH/MULTI/EXEC — 원자성 모델 비교

Redis에서 여러 명령을 묶는 방법은 두 가지입니다

![Lua 원자 실행 vs WATCH/MULTI/EXEC 낙관적 트랜잭션 타임라인 비교|tall](/diagrams/goti-deepdive-redis-single-thread-lua-2.svg)

위 타임라인에서 두 모델의 차이를 확인할 수 있습니다

왼쪽(Lua EVALSHA)에서 클라이언트 A가 스크립트를 전송하면, Redis가 Lua 블록 전체를 실행하는 동안 클라이언트 B의 명령은 대기 상태가 됩니다 실행 구간 자체를 "끼어들 수 없는 구간"으로 표시했습니다 Lua 블록이 끝난 후에야 B가 실행됩니다 재시도 개념이 없습니다

오른쪽(WATCH/MULTI/EXEC)에서 클라이언트 C가 `WATCH seat:1:A`를 등록하고 트랜잭션을 구성하는 사이, 클라이언트 D가 같은 키를 변경합니다 C가 `EXEC`를 호출하면 Redis는 감시 중인 키가 변경된 것을 감지하고 **nil을 반환**합니다 C는 이 nil을 받고 처음부터 다시 시도해야 합니다

| 구분 | Lua EVALSHA | WATCH/MULTI/EXEC |
|---|---|---|
| 원자성 방식 | 스크립트 전체 실행 중 차단 | 키 변경 감지 후 abort |
| 충돌 시 동작 | 충돌 자체가 불가능 | EXEC → nil, 클라이언트 재시도 |
| 재시도 로직 | 불필요 | 클라이언트가 직접 구현 |
| 복잡한 조건 분기 | Lua 내부에서 처리 가능 | 조건 분기 불가 (명령 나열만) |
| 적합한 상황 | check-then-act, 복합 상태 변경 | 단순 read-modify-write, 충돌 드문 상황 |

WATCH/MULTI/EXEC는 "충돌이 드물 것"이라는 낙관적 가정 위에서 동작합니다 좌석 선점처럼 동시 경쟁이 심한 도메인에서는 충돌 빈도가 높아지고, 재시도가 폭발적으로 늘어날 수 있습니다 이 경우 Lua가 더 적합합니다

### Lua 스크립트의 제약

원자성을 위한 비용도 있습니다

- **블로킹 I/O 금지**: 스크립트 실행 중에는 Redis가 다른 명령을 처리하지 못합니다 오래 걸리는 스크립트(수백ms)는 다른 모든 클라이언트를 차단합니다
- **외부 호출 불가**: Kafka producer, HTTP 요청 등 외부 시스템과 통신하는 코드는 Lua 내부에 넣을 수 없습니다 이벤트 발행은 `XADD`로 Redis 내부 스트림에 기록한 뒤, 별도 워커가 소비하는 방식으로 분리합니다
- **스크립트 오류 처리**: `redis.error_reply()`로 오류를 반환해도 이미 실행된 명령은 롤백되지 않습니다 스크립트는 ACID 트랜잭션이 아닙니다 오류 시나리오를 스크립트 앞쪽에서 미리 검증해야 합니다

---

## 🧩 go-ti에서는

go-ti 티켓팅 플랫폼에서 좌석 hold/release/confirm 경로는 모두 Lua EVALSHA로 구현했습니다 seat_holds(`hold:{game_id}:{seat_id}` STRING + TTL), inventory(`inv:{game_id}:{section_id}` HASH), outbox stream(`XADD outbox:stream`)을 하나의 스크립트에서 atomic하게 처리합니다 "재고 확인 후 차감" 사이에 다른 요청이 끼어드는 check-then-act race를 구조적으로 차단하는 것이 목적입니다

orders(`order:{order_id}` HASH) 전환 이후에도 동일한 패턴을 사용했습니다 Lua 블록 안에서 외부 시스템(Kafka 등)을 직접 호출할 수 없기 때문에, 이벤트는 `XADD outbox:stream`으로 Redis 내부 스트림에 기록하고 `goti-outbox-worker`가 `XREADGROUP`으로 소비해 RDS에 idempotent UPSERT를 수행하는 분리 구조를 채택했습니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [Redis를 SoT로 채택한 이유 — SDD-0005 전면 승격 (ADR)](/logs/goti-redis-sot-adoption-adr)에 정리했습니다

---

## 📚 핵심 정리

- Redis는 단일 스레드 이벤트 루프로 모든 명령을 직렬 처리합니다 Lock 없이도 동시성 문제가 발생하지 않습니다
- 단일 명령은 원자적이지만 여러 명령 사이에는 다른 클라이언트가 끼어들 수 있습니다 Lua 스크립트는 스크립트 전체를 하나의 명령처럼 처리해 이 간극을 제거합니다
- `EVALSHA`는 SHA1 해시만 전송하므로, 스크립트가 길어도 네트워크 오버헤드가 고정됩니다 서버 재시작 후 스크립트 재등록이 필요합니다
- WATCH/MULTI/EXEC는 충돌이 드문 상황에 적합한 낙관적 모델입니다 충돌이 잦은 hot path에서는 재시도 폭발이 발생할 수 있어 Lua가 더 적합합니다
- Lua 스크립트는 외부 I/O를 차단하고 롤백을 지원하지 않습니다 오류 검증은 스크립트 시작 부분에서 선행하고, 외부 이벤트 발행은 Redis Stream(`XADD`)을 통한 비동기 분리를 사용합니다
