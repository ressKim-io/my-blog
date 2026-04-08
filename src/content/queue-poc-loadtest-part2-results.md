---
title: "대기열 POC 부하테스트 (2): 3개 구현체 Saturation 결과"
excerpt: "300/1000/3000 VU 부하에서 드러난 처리량·신뢰성·안정성 트레이드오프"
category: kubernetes
tags:
  - Load-Test
  - K6
  - Queue
  - POC
  - Redis
  - Performance
  - Saturation
series:
  name: "queue-poc-loadtest"
  order: 2
date: '2026-03-30'
---

## 🎯 한 줄 요약

> 3개 대기열 구현체를 300/1000/3000 VU로 Saturation 테스트한 결과, A은 처리량 최고, C은 신뢰성 최고, B은 안정성 최고로 각각 다른 축에서 강점을 보였습니다.

## 📊 테스트 조건

모든 구현체에 동일한 조건을 적용했습니다.

| 항목 | 값 |
|------|-----|
| maxCapacity | 100 (동시 입장 가능 인원) |
| Pod 수 | 1 replica |
| CDN | 미적용 (ALB 직접) |
| 인프라 | Kind 7-node 클러스터 |
| 폴링 간격 | 1초 (3개 구현체 동일) |
| 경기 | KIA vs 두산 (동일 경기) |

각 구현체의 아키텍처 차이를 먼저 정리하면:

| | C | B | A |
|---|------|------|------|
| 자료구조 | Redis Hash + Scheduler | ZSET + HASH + Heartbeat | JWE 토큰 + 분산 락 |
| 승격 방식 | Scheduler 1초 주기 | Redis Key Expiration Event | 동적 publishedRank 계산 |
| 세션 유지 | 없음 (Interceptor) | Heartbeat (30s TTL, 10s 갱신) | JWE 토큰 |
| 이탈 처리 | Spring Event | 분산 락 + 이벤트 | leave API 호출 |

---

## 🔧 테스트 중 발견된 버그와 수정

Saturation 테스트를 돌리면서 각 구현체의 버그를 발견하고 수정했습니다. 부하를 주기 전까지는 발견할 수 없었던 문제들입니다.

### C: Redis SCAN → O(1) 카운터

가장 큰 문제는 `countKeys()` 메서드였습니다.

```java
// Before — O(N) SCAN
public long getActiveCount() {
    return redisTemplate.keys("queue:active:*").size();  // SCAN으로 전체 키 순회
}

// After — O(1) 카운터
public long getActiveCount() {
    return Long.parseLong(redisTemplate.opsForValue().get("queue:activeCount"));
}
```

SCAN은 키가 많아질수록 느려집니다. 100개 슬롯이 다 차면 매 요청마다 SCAN을 돌리니까 **슬롯 회전이 멈췄습니다**. iterations가 100에서 고정된 이유가 이것이었습니다.

O(1) 카운터(RedisCache)로 전환하고, `queueComplete()` API를 추가해서 예매 완료 시 슬롯을 반환하도록 수정했습니다.

결과: iterations가 **100 → 4,476** (300 VU 기준)으로 44배 증가.

### A: Lua Script ARGV 직렬화 불일치

```java
// Before — GenericJackson2JsonRedisSerializer가 ARGV를 이중 직렬화
// Lua: HGET key "maxCapacity"  →  실제 전달: "\"maxCapacity\""  →  nil

// After — StringRedisTemplate으로 plain string 전달
stringRedisTemplate.execute(luaScript, keys, "maxCapacity");
```

`RedisTemplate<String, Object>`의 `GenericJackson2JsonRedisSerializer`가 Lua script의 ARGV를 `"\"maxCapacity\""` 형태로 직렬화했습니다. Redis Hash에서 필드명 `"maxCapacity"`를 찾아야 하는데 `"\"maxCapacity\""`를 찾으니 항상 nil → max=0 → 항상 `QUEUE_CAPACITY_FULL`.

`StringRedisTemplate`으로 전환해서 해결했습니다.

### A: updateSeatEnterMeta race condition

100명이 동시에 seat-enter를 호출하면 `putAll`이 last-write-wins로 동작합니다.
`lastEnteredRank`가 98이어야 하는데 나중에 도착한 6이 덮어써서 **6으로 기록**되는 문제.

Lua script로 `max(기존값, 새값)` 패턴을 적용해 원자적으로 갱신하도록 수정했습니다.

### K6: VU signup 과부하

매 iteration마다 새 유저를 생성하니까 setup 단계에서 504가 터졌습니다. `data=null`이 되면 초당 수십만 빈 iteration이 폭주하면서 Mimir push까지 병목이 걸렸습니다.

VU당 1명 고정(`__VU` 기반 uniqueId) + setup에서 `bulk` API로 사전 생성하는 방식으로 해결했습니다.

---

## 🏃 C: Redis Hash + Scheduler 승격

O(1) 카운터 수정 후 본격적인 Saturation 테스트를 진행했습니다.

### 300 → 1000 → 3000 VU 결과

| 지표 | 300 VU | 1000 VU | 3000 VU |
|------|--------|---------|---------|
| **iterations** | 4,476 | 3,713 | 763 |
| **iterations/s** | 11.84 | 9.84 | 2.00 |
| **ticket_success** | 99.26% | 97.96% | 86.89% |
| **queue_pass_rate** | 100% | 100% | 100% |
| **queue_status p95** | 404ms | 361ms | 3,103ms |
| **queue_wait avg** | 13.7s | 67.7s | 53.5s |
| **queue_wait p95** | 18.0s | 136.4s | 151.0s |
| **http_req p95** | 406ms | 390ms | 3,102ms |
| **http_req_failed** | 5.26% | 0.013% | 0.003% |

C 구현체의 가장 큰 강점은 **신뢰성**입니다.

3000 VU에서도 `queue_pass_rate`가 **100%**입니다. 대기열에 들어간 사람은 전원 통과합니다.
`ticket_success`도 86.89%로 3개 구현체 중 가장 높은 수준을 유지합니다.

반면 약점은 3000 VU에서의 **레이턴시 급증**입니다.
`queue_status p95`가 361ms → 3,103ms로 **8.6배** 증가합니다.
Scheduler가 1초 주기로 승격하는데, API 자체가 느려지면서 polling도 느려지고, 결국 iterations가 763까지 급감했습니다.

재미있는 점은 `http_req_failed`가 오히려 VU가 올라갈수록 **감소**한다는 것입니다.
300 VU에서 5.26%던 것이 3000 VU에서 0.003%. ramping 방식이 VU를 점진적으로 올리면서 signup 부하가 분산된 효과입니다.

---

## 🏃 B: ZSET + Heartbeat + 이벤트 승격

### 300 → 1000 → 3000 VU 결과

| 지표 | 300 VU | 1000 VU | 3000 VU |
|------|--------|---------|---------|
| **iterations** | 457 | 417 | 290 |
| **iterations/s** | 1.2 | 1.1 | 0.77 |
| **ticket_success** | 93.87% | 90.90% | 86.20% |
| **queue_pass_rate** | 100% | 100% | 100% |
| **queue_status p95** | 281ms | 279ms | 500ms |
| **queue_wait p50** | 17s | 11.7s | 23s |
| **queue_wait p95** | 3m59s | 2m54s | 4m48s |
| **http_req p95** | 309ms | 282ms | 501ms |
| **http_req_failed** | 0.00% | 0.00% | 0.00% |

B 구현체의 특징은 한마디로 **"느리지만 절대 안 깨진다"**입니다.

`http_req_failed`가 **모든 VU에서 0.00%**입니다.
300 VU에서든 3000 VU에서든 에러가 단 한 건도 없습니다.

API 레이턴시도 압도적입니다. 3000 VU에서 `http_req p95`가 **501ms** — C(3,102ms)의 1/6 수준입니다.
`queue_status p95`는 300 VU(281ms) → 3000 VU(500ms)로 **1.8배**밖에 증가하지 않습니다.

이 안정성의 비밀은 **Redis ZSET + 이벤트 기반 승격**에 있습니다.
ZSET은 정렬이 O(log N)으로 빠르고, 승격을 Redis Key Expiration Event로 처리하니까 polling 요청이 서버를 직접 압박하지 않습니다.

하지만 대가가 있습니다. **iterations가 압도적으로 적습니다.**
3000 VU에서 290 iterations — C(763)의 38%, A(6,574)의 4.4% 수준입니다.
이벤트 기반 승격은 비동기 특성상 슬롯 회전이 느립니다.

또 하나의 약점은 **queue_wait p95**입니다. 3000 VU에서 4분 48초.
중간값(p50)은 23초로 빠르지만, 꼬리가 매우 깁니다.
"초반에는 빠르게 통과하지만, 뒤에 갈수록 오래 기다린다"는 특성입니다.

---

## 🏃 A: JWE 토큰 + 동적 승격

A POC는 300 VU 테스트를 건너뛰고 1000 VU부터 시작했습니다.

### 1000 → 3000 VU 결과

| 지표 | 1000 VU | 3000 VU |
|------|---------|---------|
| **iterations** | 5,495 | 6,574 |
| **iterations/s** | 14.5 | 12.2 |
| **ticket_success** | 81.51% | 56.85% |
| **queue_pass_rate** | 81.56% | 57.90% |
| **queue_status p95** | 2.18s | 2.13s |
| **queue_wait avg** | 56.4s | 1m55s |
| **queue_wait p95** | 1m17s | 2m54s |
| **http_req p95** | 2.18s | 2.13s |
| **http_req_failed** | 0.51% | 0.63% |
| **active/100** | 54~65 | 98~100 |

A 구현체는 **처리량의 왕**입니다.

1000 VU에서 5,495 iterations, 3000 VU에서 6,574 iterations.
3000 VU 기준으로 C(763)의 **8.6배**, B(290)의 **22.7배** 처리량입니다.

비결은 **동적 publishedRank 계산**입니다. 유저가 leave하면 즉시 `availableSlots`가 증가하고, 다음 status 폴링에서 바로 승격 판단이 됩니다. Scheduler를 기다릴 필요가 없습니다.

3000 VU에서 active가 98~100/100으로 슬롯을 거의 100% 활용하고 있다는 것도 인상적입니다.

하지만 약점도 명확합니다.

**`queue_pass_rate`가 3000 VU에서 57.90%로 떨어집니다.** C/B이 100%인 것과 대비되는 수치입니다.
이유는 빠른 회전 속도 때문에 동시 좌석 경합이 증가하고, AVAILABLE 좌석이 소진되면서 예매 자체가 실패하는 것입니다 — 대기열 자체의 문제라기보다는 좌석 수 대비 처리량이 너무 높아서 생기는 현상입니다.

`queue_status p95`는 2.18s → 2.13s로 **3000 VU에서도 안정적**입니다.
1000 VU든 3000 VU든 pod 1개의 한계점에서 비슷한 레이턴시를 보여줍니다.
C이 3000 VU에서 3.1s로 급증하는 것과 대조적입니다.

---

## 📊 3자 비교: 1000 VU

| 지표 | A | C | B | 비고 |
|------|------|------|------|------|
| **iterations** | **5,495** | 3,713 | 417 | A >> C >> B |
| **ticket_success** | 81.51% | **97.96%** | 90.90% | C > B > A |
| **queue_pass_rate** | 81.56% | **100%** | **100%** | C/B 전원 통과 |
| **http_req p95** | 2.18s | 390ms | **282ms** | B 레이턴시 최저 |
| **http_req_failed** | 0.51% | 0.013% | **0.00%** | B 에러 0 |
| **queue_wait avg** | 56.4s | 67.7s | **40s** | B 대기 최단 |
| **queue_wait p95** | **1m17s** | 2m16s | 2m54s | A 꼬리 최단 |
| **queue_poll avg** | **27회** | 52.2회 | 7.3회 | B 폴링 최소 |

1000 VU에서는 세 구현체의 성격 차이가 명확하게 드러납니다.

A은 iterations 5,495로 **처리량이 압도적**입니다.
C 대비 48% 더 많은 예매를 완료했습니다.
동적 승격 방식이 leave 즉시 다음 유저를 승격시키니까 슬롯 회전이 빠릅니다.

C은 **ticket_success 97.96%**로 예매 성공률이 가장 높습니다.
Scheduler가 빈 슬롯만큼만 승격하니까 동시 경합이 적습니다.

B은 **http_req p95 282ms**로 API 응답이 가장 빠릅니다.
에러도 0건. 하지만 iterations 417로 슬롯 회전이 느립니다.

## 📊 3자 비교: 3000 VU

| 지표 | A | C | B | 비고 |
|------|------|------|------|------|
| **iterations** | **6,574** | 763 | 290 | A >> C > B |
| **ticket_success** | 56.85% | **86.89%** | 86.20% | C ≈ B > A |
| **queue_pass_rate** | 57.90% | **100%** | **100%** | C/B 전원 통과 |
| **http_req p95** | 2.13s | 3.1s | **501ms** | B 압도적 |
| **http_req_failed** | 0.63% | 0.003% | **0.00%** | B 에러 0 |
| **queue_wait p50** | 2m19s | 53s | **23s** | B 중간값 최단 |
| **queue_wait p95** | 2m54s | **2m31s** | 4m48s | C 꼬리 최단 |
| **HTTP reqs** | **445K** | 329K | 309K | A 네트워크 부하 최대 |

3000 VU에서는 차이가 더 극단적으로 벌어집니다.

A의 iterations가 6,574로 C(763)의 **8.6배**입니다.
3000명이 동시에 몰려도 슬롯을 98~100% 활용하면서 빠르게 회전합니다.

B은 `http_req p95`가 **501ms**로 3000 VU에서도 여전히 빠릅니다.
C이 3.1s로 급증하는 것과 대조적입니다.
300 VU(309ms) → 3000 VU(501ms)로 **1.6배밖에 안 늘어나는** 스케일링 내성이 인상적입니다.

C은 `queue_pass_rate` 100%를 끝까지 유지합니다. 대기열에 들어간 사람은 **반드시** 통과합니다.
3000 VU에서 ticket_success 86.89%도 가장 높습니다.

---

## 📚 핵심 포인트

세 구현체는 각각 다른 축에서 최고를 달성했습니다.

**A — 처리량 최고:**
3000 VU에서 6,574 iterations. 동적 승격으로 슬롯 낭비 없이 100% 활용.
하지만 pass_rate 57.90%로 안정성은 부족합니다.

**C — 신뢰성 최고:**
모든 VU에서 queue_pass_rate 100%. ticket_success 86~98%.
하지만 3000 VU에서 레이턴시가 급증하면서 처리량이 급감합니다.

**B — 안정성 최고:**
에러 0건, http_req p95가 3000 VU에서도 501ms.
하지만 이벤트 기반 승격의 비동기 특성으로 슬롯 회전이 느립니다.

이 결과만으로는 "어떤 구현체가 최선인가"를 판단하기 어렵습니다.
다음 편에서 **순수 대기열 성능**, **서버 부하**, **승격 메커니즘**을 더 깊이 비교하고, CDN 캐싱이라는 변수까지 추가해서 최종 선정 과정을 다룹니다.
