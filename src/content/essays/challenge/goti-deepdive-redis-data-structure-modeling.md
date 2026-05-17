---
title: "도메인 모델을 Redis 자료구조로 사상하기 — HASH·STRING·LIST·ZSET·SET"
excerpt: "관계형 데이터베이스에서 테이블로 표현하던 엔티티를 Redis 5대 자료구조로 옮길 때의 사고법과, 각 자료구조의 내부 구조·시간복잡도·적합 용도를 정리합니다"
category: challenge
tags:
  - go-ti
  - Redis
  - HASH
  - ZSET
  - data-modeling
  - concept
series:
  name: "goti-deepdive-redis"
  order: 8
date: "2026-04-17"
---

## 한 줄 요약

> Redis는 자료구조 서버입니다 — 어떤 엔티티를 HASH로, 어떤 관계를 ZSET으로 표현할지 결정하는 것이 곧 설계이며, 잘못된 자료구조 선택은 O(N)과 O(log N)의 차이로 직결됩니다

---

## 🤔 무엇을 푸는 기술인가

관계형 데이터베이스에서는 엔티티를 테이블로, 관계를 외래 키(FK)로 표현합니다 조인이 비싸지는 시점에 캐시 레이어를 추가하지만, 캐시와 DB가 분리되면 정합성 유지 비용이 생깁니다

Redis는 이 문제에 다른 방식으로 접근합니다 "단순 키-값 캐시"가 아니라 **목적별로 특화된 5개의 자료구조를 직접 제공**합니다 엔티티를 HASH에, 정렬 인덱스를 ZSET에, 임시 잠금을 STRING+TTL에 넣으면 조인 없이도 도메인 로직을 표현할 수 있습니다

이때 "어느 자료구조에 무엇을 넣는가"가 Redis 모델링의 핵심입니다 올바른 자료구조를 선택하면 단일 RTT로 원하는 연산이 끝납니다 잘못 선택하면 애플리케이션 코드가 Redis를 단순 저장소로만 쓰면서 정렬·필터링을 직접 구현하게 됩니다

---

## 🔧 동작 원리

### Redis 자료구조가 일반 캐시와 다른 이유

일반 키-값 캐시는 값이 불투명한 바이트 덩어리입니다 "좌석 상태를 JSON으로 저장했다가 꺼내서 파싱"하는 패턴이 이에 해당합니다 Redis는 다릅니다 값 안의 필드를 서버 쪽에서 직접 조작합니다

예를 들어 HASH의 `HINCRBY`는 **전체 JSON을 읽어서 애플리케이션에서 파싱하고 수정하고 다시 쓰는** 3 RTT를 **서버에서 1 RTT**로 줄입니다 이 속성이 Redis를 단순 캐시가 아닌 **연산 가능한 도메인 계층**으로 만드는 근거입니다

### HASH — 엔티티 객체의 기본 단위

HASH는 하나의 키 아래 필드-값 쌍의 집합을 저장합니다 관계형 테이블의 **행(row)** 과 가장 가깝습니다

```bash
# 좌석 상태 저장
HSET seat:1001:A seat_id 42 status AVAILABLE version 3 updated_at 1745000000

# 특정 필드만 읽기 — O(1)
HGET seat:1001:A status

# 전체 필드 읽기 — O(N), N = 필드 수
HGETALL seat:1001:A

# 특정 필드만 원자적 갱신 — 전체 읽기 없이
HSET seat:1001:A status HELD
```

HASH의 강점은 **부분 갱신**입니다 주문 엔티티의 상태 필드 하나만 바꾸고 싶을 때, JSON을 전체 교체할 필요 없이 `HSET order:{id} status PAID` 한 줄로 끝납니다

내부적으로 Redis는 필드 수가 적으면(기본 128개 이하) listpack이라는 압축 구조를 씁니다 필드가 늘어나면 해시 테이블로 전환합니다 애플리케이션에서 보이는 API는 같지만 메모리 효율이 다릅니다

**한계**: HASH는 조건 검색을 지원하지 않습니다 "상태가 HELD인 모든 주문"을 HASH만으로 찾으려면 HGETALL로 전체를 읽어야 합니다 이 경우 별도 ZSET이나 SET 인덱스를 만들어야 합니다

### STRING + TTL — 만료 키의 설계

STRING은 Redis 자료구조 중 가장 단순합니다 하나의 키에 하나의 값입니다 여기에 `EX`(초 단위) 또는 `PX`(밀리초 단위) TTL을 붙이면 강력한 패턴 두 가지가 만들어집니다

**패턴 1 — 임시 잠금 (Distributed Lock)**

```bash
# 최초 호출만 성공, 이미 키가 있으면 nil 반환 — O(1)
SET hold:1001:42 user_id:999 NX EX 300
```

`NX`(Not eXists)는 키가 없을 때만 쓰기를 허용합니다 단일 스레드 실행 모델 덕분에 이 연산은 **원자적**입니다 동시에 두 요청이 같은 키에 SET NX를 보내도 하나만 성공합니다 300초 후 TTL 만료로 키가 자동 삭제되면 잠금이 풀립니다

**패턴 2 — 멱등키 (Idempotency Key)**

```bash
# 결제 트랜잭션 ID를 키로, 처리 완료 표시를 값으로
SET payment:idem:pg_tx_abc123 PROCESSED EX 86400
```

같은 결제 콜백이 두 번 들어올 때 키가 이미 있으면 `SETNX`가 실패합니다 이미 처리된 요청임을 인식하고 중복 처리를 방지합니다 86400초(24시간) 후 TTL 만료로 키가 사라지면 오래된 트랜잭션 레코드가 자동 정리됩니다

두 패턴 모두 **만료가 비즈니스 로직의 일부**입니다 TTL이 없는 STRING은 단순 상수 저장에 불과하지만, TTL이 있는 STRING은 "시간 범위 안에서만 유효한 계약"을 표현합니다

### LIST — 삽입 순서가 의미를 갖는 컬렉션

LIST는 삽입 순서를 보존하는 연결 리스트입니다 양 끝에 대한 push/pop이 O(1)입니다 특정 인덱스로의 접근은 O(N)이므로, 임의 접근이 잦으면 LIST는 적합하지 않습니다

```bash
# 주문 항목 추가 — 오른쪽에 append
RPUSH order:items:order_abc item_id:10 item_id:11 item_id:12

# 전체 조회 — O(S+N), S=시작 오프셋, N=반환 수
LRANGE order:items:order_abc 0 -1

# 항목 수 — O(1)
LLEN order:items:order_abc
```

`order:items:{order_id}`처럼 **주문 ID에 종속된 항목 목록**은 LIST가 자연스럽습니다 항목은 추가된 순서가 곧 의미(예: 장바구니 담은 순서)이고, 전체를 한 번에 읽는 패턴이 주를 이루기 때문입니다

큐로도 씁니다 `LPUSH`로 왼쪽에 넣고 `RPOP`으로 오른쪽에서 빼면 FIFO 큐가 됩니다 `BRPOP`을 쓰면 항목이 들어올 때까지 블로킹 대기도 가능합니다

### ZSET — score 기반 정렬 인덱스

ZSET(Sorted Set)은 Redis에서 가장 독특한 자료구조입니다 각 멤버에 **score**(부동소수점 수)를 붙여 저장합니다 멤버는 score 오름차순으로 항상 정렬된 상태를 유지합니다

```bash
# 유저 주문 목록에 order_id 추가, score = 생성 타임스탬프
ZADD user:orders:user999 1745000000 order_abc
ZADD user:orders:user999 1745000100 order_def

# score 오름차순 전체 조회 (오래된 것부터)
ZRANGE user:orders:user999 0 -1

# score 내림차순 (최신 것부터) — O(log N + M)
ZREVRANGE user:orders:user999 0 9

# 특정 기간만 조회 — O(log N + M)
ZRANGEBYSCORE user:orders:user999 1745000000 1745086400
```

ZSET이 강력한 이유는 **검색과 정렬이 O(log N)**이라는 점입니다 내부적으로 skiplist + hashtable 조합으로 구현됩니다 skiplist는 평균 O(log N)으로 정렬 위치를 찾고, hashtable은 O(1)로 멤버 존재 여부와 score를 확인합니다

관계형 DB에서 "유저별 주문 목록을 최신순으로 10개"는 인덱스가 있으면 빠르지만 없으면 전체 스캔입니다 ZSET은 애초에 정렬된 상태로 저장되어 있어 **범위 쿼리가 항상 O(log N + M)**입니다

score에 타임스탬프를 쓰는 패턴이 일반적입니다 `ZADD user:tickets:{user_id} <issued_at> <ticket_id>`처럼 설계하면 "이 유저의 최근 발급 티켓 10장"이 `ZREVRANGE ... 0 9` 한 줄로 끝납니다

**주의**: ZSET의 멤버는 유일합니다 같은 멤버를 두 번 ZADD하면 score가 갱신됩니다 중복 멤버가 필요하면 LIST를 써야 합니다

### SET — 중복 없는 집합과 멤버십 확인

SET은 중복을 허용하지 않는 비순서 집합입니다 멤버 추가·삭제·존재 확인이 모두 O(1)입니다

```bash
# 유저가 점유한 좌석 목록 관리
SADD user:holds:user999 hold:1001:42 hold:1001:43

# 특정 좌석이 이 유저의 hold에 포함되는지 — O(1)
SISMEMBER user:holds:user999 hold:1001:42

# 점유 해제
SREM user:holds:user999 hold:1001:42

# 교집합 — 두 유저 모두 점유한 좌석 (경합 감지)
SINTER user:holds:user999 user:holds:user888
```

`user:holds:{user_id}` SET은 STRING+TTL의 잠금 키와 쌍을 이룹니다 잠금 키(`hold:{game_id}:{seat_id}`)는 특정 좌석이 잠겼는지를 O(1)로 확인합니다 SET은 "이 유저가 현재 몇 개나 점유 중인가"를 O(1) SCARD로 파악하거나, 모든 점유를 일괄 해제할 때 SMEMBERS로 목록을 얻을 수 있게 합니다

![도메인 엔티티 → Redis 자료구조 매핑|tall](/diagrams/goti-deepdive-redis-data-structure-modeling-1.svg)

위 다이어그램은 go-ti의 7개 도메인 엔티티가 Redis 4종 자료구조로 어떻게 분배되는지를 보여줍니다

**HASH(보라)**는 속성이 여러 개인 엔티티(`seat_statuses`, `inventory`, `orders`)를 담습니다 관계형 테이블의 행과 1:1 대응합니다 `HGETALL`로 엔티티 전체를 한 번에 읽고, `HSET`으로 특정 필드만 갱신합니다

**STRING+TTL(노란)**는 시간 범위 안에서만 유효한 값을 표현합니다 `seat_holds`는 300초 TTL로 잠금이 자동 해제되고, `payment_idem`은 24시간 TTL로 중복 결제를 막은 뒤 자동 정리됩니다 TTL 만료 자체가 비즈니스 이벤트입니다

**LIST(청록)**는 `order_items`처럼 삽입 순서가 의미를 갖는 1:N 관계를 표현합니다 항목을 RPUSH로 순서대로 쌓고 LRANGE로 전체를 읽습니다

**ZSET(분홍)**은 정렬 인덱스 역할을 합니다 `user:orders`와 `user:tickets` 인덱스에 타임스탬프를 score로 써서 최신순 조회를 O(log N + M)으로 처리합니다

![Redis 5대 자료구조 — 시간복잡도와 적합 용도|tall](/diagrams/goti-deepdive-redis-data-structure-modeling-2.svg)

위 비교표는 5대 자료구조를 대표 명령·시간복잡도·주요 용도로 나란히 정리합니다

HASH와 STRING은 단일 연산이 O(1)으로 가장 빠릅니다 단, HGETALL처럼 전체를 읽는 연산은 O(N)이 됩니다 LIST는 양 끝 push/pop이 O(1)이지만 범위 조회인 LRANGE는 O(S+N)입니다 ZSET은 추가·삭제와 범위 조회가 O(log N)입니다 로그 팩터지만 수백만 항목에서도 수 밀리초 안에 끝납니다 SET은 멤버십 확인이 O(1)로 가장 빠릅니다

---

## 📐 세부 동작과 옵션

### 관계형 모델 → Redis 사상 시 결정 기준

엔티티를 Redis로 옮길 때 다음 기준으로 자료구조를 결정합니다

| 질문 | 선택 |
|---|---|
| 속성이 여러 개이고 부분 갱신이 필요한가? | HASH |
| 시간이 지나면 자동으로 사라져야 하는가? | STRING + TTL |
| 삽입 순서가 의미를 가지며 전체를 한 번에 읽는가? | LIST |
| 정렬 조건으로 범위 검색이 필요한가? | ZSET |
| 중복 없이 멤버십만 관리하거나 집합 연산이 필요한가? | SET |
| 여러 조건으로 검색이 필요한가? | HASH + ZSET 인덱스 조합 |

"여러 조건 검색"은 Redis 단독으로는 어렵습니다 예를 들어 "특정 유저의 PAID 상태 주문만"은 ZSET 인덱스에서 유저별 주문 목록을 꺼낸 뒤, 각 주문의 HASH에서 status를 확인하는 2단계가 필요합니다 조건이 복잡해질수록 인덱스 수가 늘어납니다 이 지점이 Redis SoT의 실질적 설계 비용입니다

### 키 네이밍 전략

Redis 키에는 구분자로 `:`를 씁니다 키 자체가 엔티티의 주소이자 스키마 힌트입니다

```text
seat:{game_id}:{section_id}        ← 게임+섹션으로 한정된 좌석 상태 HASH
hold:{game_id}:{seat_id}           ← 좌석 단위 잠금 STRING
order:{order_id}                   ← 주문 헤더 HASH
order:items:{order_id}             ← 주문 항목 LIST
user:orders:{user_id}              ← 유저별 주문 인덱스 ZSET
payment:idem:{pg_tx_id}            ← 결제 멱등키 STRING
```

Redis Cluster에서는 `{game_id}`처럼 `{}` 안의 값이 해시 태그(hash tag)가 됩니다 같은 `{game_id}`를 공유하는 키들이 같은 슬롯에 배치되어 Lua 스크립트에서 멀티-키 원자 연산이 가능합니다

### HASH vs STRING(JSON) 선택

JSON을 STRING에 통째로 직렬화하는 방식도 흔합니다 트레이드오프는 다음과 같습니다

| 항목 | HASH | STRING(JSON) |
|---|---|---|
| 부분 필드 갱신 | HSET 한 번 | GET → 파싱 → 수정 → SET |
| 읽기 비용 | HGETALL O(N), 필드 HGET O(1) | GET O(1) 후 파싱 비용 |
| 중첩 구조 | 불가 (1단계만) | 자유로운 중첩 |
| 메모리 효율 | listpack 압축 (필드 적을 때) | 직렬화 크기 의존 |

중첩 없는 단순 엔티티(주문, 좌석 상태)는 HASH가 유리합니다 중첩 구조(예: 주문 안에 결제 정보 중첩)는 애플리케이션에서 평탄화하거나 JSON STRING을 씁니다

---

## 🧩 go-ti에서는

ADR-0017이 채택되면서 go-ti의 모든 hot-path 엔티티가 Redis로 이관되었습니다 엔티티별 자료구조 선택은 ADR의 "범위" 표에 그대로 반영됩니다

`seat_statuses`와 `inventory`는 섹션 단위 HASH로 저장됩니다 키가 `seat:{game_id}:{section_id}` 형태라 같은 `{game_id}`를 공유하는 HASH들이 Cluster 전환 시에도 같은 슬롯에 위치합니다 Lua 스크립트 안에서 `seat:*`와 `inv:*`를 함께 수정할 수 있는 기반이 됩니다

`order_items`는 LIST를 씁니다 주문 항목은 담긴 순서가 의미를 가지며, 주문 조회 시 전체를 한 번에 읽는 패턴이 대부분이기 때문입니다 `user:orders:{user_id}` ZSET은 score에 생성 타임스탬프를 써서 최신 주문을 O(log N)으로 꺼냅니다

`seat_holds`의 STRING+TTL은 두 역할을 동시에 합니다 `SET hold:{game_id}:{seat_id} {user_id} NX EX 300`은 잠금 획득(NX)과 자동 해제(EX 300)를 한 번에 표현합니다 TTL 만료는 곧 좌석 반환이라는 비즈니스 규칙을 인프라가 자동으로 이행합니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [Redis as Source of Truth 전면 채택 (ADR)](/logs/goti-redis-sot-adoption-adr)에 정리했습니다

---

## 📚 핵심 정리

- HASH는 관계형 테이블의 행과 대응합니다 속성이 여러 개이고 특정 필드만 갱신하는 엔티티에 적합합니다 `HSET`으로 부분 갱신, `HGETALL`로 전체 읽기 — 조인 없는 단일 RTT로 엔티티를 다룹니다
- STRING+TTL은 "시간 범위 안에서만 유효한 계약"을 표현합니다 `SET NX EX`는 분산 잠금, TTL이 붙은 키는 멱등키와 임시 토큰에 씁니다 TTL 만료가 곧 비즈니스 이벤트입니다
- LIST는 삽입 순서가 의미를 갖는 1:N 관계에 씁니다 양 끝 push/pop이 O(1)이라 주문 항목·이벤트 로그처럼 순서대로 쌓고 전체를 읽는 패턴에 맞습니다
- ZSET은 score 기반 정렬 인덱스입니다 타임스탬프를 score로 써서 "유저별 최신 주문 N건"처럼 범위 검색이 필요한 인덱스를 O(log N + M)으로 구현합니다 관계형 인덱스의 역할을 Redis 안에서 담당합니다
- SET은 중복 없는 멤버십 관리에 씁니다 `SISMEMBER`가 O(1)이어서 "이 키가 이 집합에 속하는가"를 빠르게 확인합니다 집합 연산(교집합·합집합)도 지원합니다
