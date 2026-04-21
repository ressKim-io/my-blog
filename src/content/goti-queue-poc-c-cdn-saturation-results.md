---
title: "POC C(CDN 캐싱) 포화 테스트 결과 — 처리량 최강, 그러나 pod 1개의 한계"
excerpt: "CDN POC를 1000 VU와 3000 VU로 포화시키는 동안 Lua ARGV 직렬화 불일치, putAll race condition, 직렬화 혼용 JsonParseException 세 가지 버그를 잡았습니다. 동적 publishedRank 계산 방식은 POC A 대비 3000 VU에서 8.6배 높은 iterations를 기록했습니다."
category: challenge
tags:
  - go-ti
  - Queue
  - POC
  - LoadTest
  - CDN
  - Saturation
series:
  name: "goti-queue-poc"
  order: 6
date: "2026-03-30"
---

## 한 줄 요약

> CDN POC(동적 publishedRank 계산 방식)를 K6로 1000/3000 VU에 포화시켜 처리량 특성을 측정했습니다. 과정에서 Lua ARGV 직렬화 불일치, `putAll` race condition, Redis 직렬화 혼용 문제 세 가지를 잡았고, 최종적으로 POC A 대비 3000 VU에서 8.6배 iterations를 달성했습니다.

---

## 테스트 개요

- **테스트일**: 2026-03-30
- **도구**: K6
- **대상**: `goti-queue-dev` (`poc-c-24-2c7348a`)
- **경기**: KIA vs 두산 (`cffa774c-5231-4b5d-b994-0c291898cdef`, 4/1)
- **비교 대상**: POC A(Redis 폴링 + Scheduler 승격)

---

## 🔥 문제: 포화 테스트 도중 드러난 버그 네 가지

1000 VU 테스트를 돌리자마자 정상적인 결과가 나오지 않았습니다. 대기열 자체 로직 문제, K6 스크립트 문제가 섞여 있어 한 번에 다 잡고 다시 테스트를 돌렸습니다.

### 버그 1 — Lua Script ARGV 직렬화 불일치 (`poc-c-22`)

증상은 `tryIncrementActiveCount`가 `activeCount=0`인데도 항상 `QUEUE_CAPACITY_FULL`을 반환하는 것이었습니다.

원인은 Redis 직렬화 설정이었습니다. `RedisTemplate<String, Object>`가 사용하는 `GenericJackson2JsonRedisSerializer`가 Lua ARGV를 `"\"maxCapacity\""` 형태로 직렬화했습니다. Hash 필드명은 그냥 `maxCapacity`인데, Lua에서 `HGET`으로 조회할 때는 따옴표가 포함된 키를 찾게 됩니다.

따라서 `HGET`이 `nil`을 반환하고, `max=0`이 되어 `0 < 0` 비교가 항상 `false`가 됐습니다.

수정은 `StringRedisTemplate`으로 Lua script를 실행하도록 바꿔 plain string ARGV를 전달하는 것입니다.

### 버그 2 — `updateSeatEnterMeta` race condition (`poc-c-23`)

증상은 실제로 81명이 seat-enter에 성공했는데 `lastEnteredRank=6`으로 기록되는 것이었습니다.

원인은 100명이 동시에 seat-enter를 수행하면서 `putAll`을 호출했기 때문입니다. `putAll`은 last-write-wins 방식이라, 네트워크 지연으로 늦게 도착한 낮은 `queueNumber`(예: 6)가 먼저 도착한 높은 값(예: 98)을 덮어썼습니다.

수정은 Lua script의 `max(기존값, 새값)` 패턴으로 원자적으로 갱신하도록 바꾼 것입니다.

### 버그 3 — Redis 직렬화 혼용 `JsonParseException` (`poc-c-24`)

증상은 status API가 500 에러(`JsonParseException`)를 내는 것이었습니다.

원인은 쓰기와 읽기가 서로 다른 직렬화를 썼기 때문입니다. Lua script(`StringRedisTemplate`)는 plain string으로 값을 썼는데, 읽는 쪽은 `RedisTemplate`(JSON serializer)이라 파싱에 실패했습니다.

수정은 meta 읽기/쓰기 전체를 `StringRedisTemplate`으로 통일하는 것입니다.

### 버그 4 — K6 VU signup 과부하 (K6 스크립트 개선)

증상은 setup 단계가 504를 반환하고 `data=null`이 되면서 초당 수십만 건의 빈 iteration이 폭주했습니다. 그 결과 Mimir push가 병목이 됐습니다.

원인은 매 iteration마다 `__ITER`가 포함된 `uniqueId`로 신규 유저를 생성하고 있었기 때문입니다. 토큰 캐시 히트율이 0%였습니다.

수정은 다음과 같습니다.

- VU당 1명 고정: `uniqueId = __VU`
- `login()` API(read-only) 우선 사용
- setup에서 `bulk` API로 계정 사전 생성
- backoff 강화

---

## 1000 VU 결과

버그를 전부 잡은 뒤 측정한 결과입니다.

| 지표 | 값 |
|------|-----|
| iterations | 5,495 (14.5/s) |
| ticket_success | 81.51% (4,480/5,496) |
| queue_pass_rate | 81.56% (4,483/5,496) |
| immediate_pass | 1.81% (100명 = maxCapacity) |
| queue_wait avg | 56.4s |
| queue_wait p50 | 56.3s |
| queue_wait p95 | 1m17s |
| queue_wait max | 1m26s |
| queue_e2e avg | 1m2s |
| queue_e2e p95 | 1m24s |
| queue_poll avg | 27.0회 |
| queue_poll max | 37회 |
| queue_enter avg | 1.52s |
| queue_seat_enter avg | 1.27s |
| queue_leave avg | 1.05s |
| queue_status avg / p95 | 942ms / 2.18s |
| http_req p95 | 2.18s |
| http_req_failed | 0.51% |
| seat_selection avg | 421ms |
| order_creation avg | 312ms |
| payment avg | 331ms |
| data_received | 320 MB |
| data_sent | 17 MB |

### 분석

슬롯 회전은 정상 동작했습니다. `publishedRank`가 2000+ 이상 증가했고, active 슬롯은 50~65/100 수준을 유지했습니다.

대기 시간은 평균 56초였습니다. 1000명이 100개 슬롯을 두고 경쟁하는 구조상 예상 범위에 들어옵니다.

ticket_success 81.51%는 좌석 경합(AVAILABLE 좌석 소진)으로 약 18%가 실패한 것입니다. 대기열 자체 문제는 아닙니다.

queue_pass_rate 81.56%는 pass 후 ticketing에 실패한 VU를 포함한 값입니다. 좌석 없음, hold 실패 등이 섞여 있습니다.

http_req_failed 0.51%는 queue pod 1개로 1000 VU polling을 처리하면서 간헐적으로 504가 발생한 비율입니다.

queue_status p95 2.18s는 pod 과부하로 status polling이 느려진 결과입니다. POC A의 390ms 대비 훨씬 높습니다.

---

## POC C vs POC A — 1000 VU 비교

| 지표 | POC C | POC A | 차이 | 비고 |
|------|------|------|------|------|
| **iterations** | **5,495** | 3,713 | **+48%** | POC C가 iteration 회전 빠름 |
| **iterations/s** | **14.5** | 9.84 | **+47%** | POC C 처리량 우위 |
| **ticket_success** | 81.51% | **97.96%** | -16pp | POC A가 예매 성공률 높음 |
| **queue_pass_rate** | 81.56% | **100%** | -18pp | POC A는 전원 통과 |
| queue_wait avg | **56.4s** | 67.7s | **-17%** | POC C가 대기 시간 짧음 |
| queue_wait p95 | **1m17s** | 136.4s | **-15%** | POC C가 꼬리 지연도 적음 |
| queue_poll avg | **27회** | 52.2회 | **-48%** | POC C가 polling 횟수 절반 |
| queue_status p95 | 2.18s | **390ms** | 5.6x 높음 | POC C pod 과부하 |
| http_req p95 | 2.18s | **390ms** | 5.6x 높음 | 동일 원인 |
| http_req_failed | 0.51% | **0.013%** | 39x 높음 | POC C 504 간헐 발생 |
| immediate_pass | 1.81% | 2.21% | 유사 | 첫 100명 즉시 통과 |

### 핵심 차이 분석

**POC C 강점 — 처리량(throughput)**

- iterations가 48% 더 많습니다. POC C의 "동적 publishedRank 계산 + 즉시 승격" 방식이 슬롯 회전을 빠르게 했습니다.
- polling 횟수가 48% 적습니다. leave 즉시 `availableSlots`가 증가하면서 다음 status에서 바로 통과합니다.
- 대기 시간이 17% 짧습니다.

**POC A 강점 — 안정성(reliability)**

- ticket_success가 97.96%입니다. POC C(81.51%)에 비해 예매 실패가 거의 없습니다.
- queue_pass_rate 100%로 대기열 통과 후 전원 예매에 성공했습니다.
- http_req_failed 0.013%로 API 에러가 거의 0에 가깝습니다.
- status p95 390ms로 응답 시간이 안정적입니다.

**차이 원인 추정**

1. POC C의 ticket_success가 낮은 이유는 빠른 회전 때문입니다. 동시 좌석 경합이 증가하면서 AVAILABLE 좌석이 소진되거나 hold가 실패했습니다.
2. POC C의 status가 느린 이유는 `publishedRank`를 매 요청마다 동적으로 계산하기 때문입니다. Redis `HGET` 2회와 계산이 매 status마다 수행됩니다. POC A는 Scheduler가 주기적으로 갱신해서 계산 비용이 없습니다.
3. POC C의 http_req_failed가 높은 이유는 1000 VU × 1초 polling = 초당 1000 req의 status 요청이 pod 1개 한계를 초과했기 때문입니다.

### 공정 비교 시 고려사항

- **pod 수**: 양쪽 모두 1 replica (공정)
- **maxCapacity**: 양쪽 모두 100 (공정)
- **polling 간격**: POC C 1초, POC A 1초 (통일 완료)
- **경기/좌석 데이터**: 다른 경기 사용 — 좌석 수 차이 가능
- **이미지 태그**: POC C `poc-c-24`, POC A `poc-a-17`

---

## 3000 VU 결과

| 지표 | 값 |
|------|-----|
| iterations | 6,574 (12.2/s) |
| ticket_success | 56.85% (3,751/6,597) |
| queue_pass_rate | 57.90% (3,851/6,651) |
| immediate_pass | 1.12% (100명 = maxCapacity) |
| queue_wait avg | 1m55s |
| queue_wait p50 | 2m19s |
| queue_wait p95 | 2m54s |
| queue_wait max | 3m5s |
| queue_e2e avg | 2m0s |
| queue_e2e p95 | 2m56s |
| queue_poll avg | 42.5회 |
| queue_poll max | 82회 |
| queue_enter avg | 1.53s |
| queue_seat_enter avg / p95 | 1.68s / 2.29s |
| queue_leave avg | 1.46s |
| queue_status avg / p95 | 1.55s / 2.13s |
| http_req p95 | 2.13s |
| http_req_failed | 0.63% |
| seat_selection avg | 419ms |
| order_creation avg | 316ms |
| payment avg | 323ms |
| HTTP reqs | 445,086 (825/s) |
| data_received | 453 MB |
| data_sent | 32 MB |

### 1000 → 3000 VU 비교

| 지표 | 1000 VU | 3000 VU | 변화 |
|------|---------|---------|------|
| iterations | 5,495 | 6,574 | +20% |
| iterations/s | 14.5 | 12.2 | -16% (VU 대기 시간 증가) |
| ticket_success | 81.51% | 56.85% | -25pp (좌석 경합 증가) |
| queue_pass_rate | 81.56% | 57.90% | -24pp |
| queue_wait avg | 56s | 1m55s | 2x 증가 |
| queue_status p95 | 2.18s | 2.13s | 유사 (안정) |
| http_req_failed | 0.51% | 0.63% | 유사 |
| active/100 | 54~65 | 98~100 | 3000 VU에서 100% 수용 |

### 분석

3000 VU에서도 대기열은 안정적이었습니다. active가 98~100/100으로 유지됐고, `publishedRank`는 6477까지 상승했습니다.

user 서비스 과부하도 해소됐습니다. setup 단계에서 토큰을 사전 발급해 VU 실행 중 login 호출을 제거했기 때문에, 503 에러가 완전히 사라졌습니다.

ticket_success 하락의 원인은 좌석 경합입니다. 6,574 iterations × 1석/iteration 계산이면 좌석 자체가 소진됩니다. 대기열 문제는 아닙니다.

queue_status p95가 1000 VU(2.18s)와 3000 VU(2.13s)에서 유의미한 차이가 없었다는 점이 흥미롭습니다. pod 1개 한계에 도달한 이후로는 그 한계에서 안정화됩니다.

---

## POC C vs POC A — 전체 비교 (1000/3000 VU)

### 1000 VU 승자 구분

| 지표 | POC C | POC A | 승자 |
|------|------|------|------|
| iterations | **5,495** | 3,713 | **POC C +48%** |
| ticket_success | 81.51% | **97.96%** | **POC A** |
| queue_pass_rate | 81.56% | **100%** | **POC A** |
| queue_wait avg | **56s** | 67.7s | **POC C -17%** |
| polling 횟수 | **27회** | 52회 | **POC C -48%** |
| status p95 | 2.18s | **390ms** | **POC A** |
| http_failed | 0.51% | **0.013%** | **POC A** |

### 3000 VU 승자 구분

| 지표 | POC C | POC A | 승자 |
|------|------|------|------|
| iterations | **6,574** | 763 | **POC C 8.6x** |
| iterations/s | **12.2** | 2.0 | **POC C 6.1x** |
| ticket_success | 56.85% | **86.89%** | **POC A** |
| queue_pass_rate | 57.90% | **100%** | **POC A** |
| queue_wait avg | 1m55s | **53.5s** | **POC A** |
| queue_status p95 | **2.13s** | 3,103ms | **POC C** |
| http_req_failed | 0.63% | **0.003%** | **POC A** |
| HTTP reqs | **445K** | 329K | **POC C +35%** |
| active/100 유지 | **98~100** | - | **POC C** |

### 종합 분석

**POC C(방식 3) 특성**

- **처리량 최강**: 3000 VU에서 POC A 대비 8.6x iterations를 기록했습니다. 동적 `publishedRank` 계산으로 leave 즉시 다음 유저가 승격되는 구조 덕분입니다.
- **수용인원 100% 유지**: active가 98~100/100으로 슬롯 낭비가 없었습니다.
- **대규모 VU에서 status API 안정**: 3000 VU에서도 status p95 2.13s를 유지했습니다. POC A의 3.1s 대비 안정적입니다.
- **약점**: seat-enter 시 동시 경합(409 CAPACITY_FULL)이 발생합니다. 다만 실사용에서는 polling 재시도로 자연스럽게 해소되는 수준입니다.

**POC A(방식 2) 특성**

- **신뢰성 최강**: queue_pass_rate는 항상 100%, ticket_success는 87~98%였습니다.
- **Scheduler 1초 주기 승격**: 빈 슬롯만큼만 승격하기 때문에 경합이 없습니다.
- **약점**: 3000 VU에서 API 레이턴시가 급증했습니다. status p95가 390ms에서 3.1s로 치솟으면서 iterations가 763으로 급감했습니다.

### 3000 VU에서 8.6x 처리량 차이의 원인

핵심은 Scheduler 주기(1초)가 아닙니다. **POC A의 API 레이턴시 급증**이 주원인입니다. status p95가 3.1s가 되면 polling 자체가 느려지면서 전체 iterations가 줄어듭니다.

POC C는 동일한 3000 VU 조건에서도 status API가 p95 2.13s로 안정을 유지했기 때문에 polling 주기를 지킬 수 있었습니다.

---

## 📚 배운 점

### Redis 직렬화는 한 경로에 하나만

Lua script와 Java 쪽에서 같은 키를 다른 직렬화로 읽고 쓰면 반드시 깨집니다. 버그 1과 버그 3이 같은 뿌리에서 나왔습니다. Lua를 쓸 때는 `StringRedisTemplate`으로 통일하고, 읽기/쓰기 경로 전체에 같은 템플릿을 적용해야 합니다.

### 동시성 카운터는 `putAll`이 아니라 Lua `max`

버그 2의 `putAll` last-write-wins는 동시성 환경에서 흔히 나오는 함정입니다. "최댓값을 유지해야 하는 카운터"는 `putAll`이 아니라 Lua script로 `max(기존값, 새값)`을 원자적으로 적용하는 것이 안전합니다.

### 처리량과 안정성은 트레이드오프

POC C와 POC A의 비교가 그대로 보여줍니다. POC C는 동적 계산으로 처리량을 끌어올렸지만 status API가 느려졌습니다. POC A는 Scheduler로 API를 가볍게 유지했지만 대규모에서 레이턴시가 튀었습니다. 실제 선택은 트래픽 프로파일과 요구 SLO에 따라 결정됩니다.

### K6 스크립트가 테스트 자체를 망가뜨린다

K6 VU마다 신규 계정을 만드는 스크립트가 setup 504를 유발하고, 그 결과 iteration이 폭주하면서 Mimir push를 병목으로 만들었습니다. 부하테스트의 결과를 신뢰하려면 VU 고정, 캐시 친화적 API 우선, 사전 준비 단계에서 bulk 생성 같은 원칙을 지켜야 합니다.
