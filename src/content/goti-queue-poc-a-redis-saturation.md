---
title: "POC A(Redis 폴링) 포화 테스트 — 300/1000/3000 VU 결과"
excerpt: "Redis 폴링 기반 대기열 POC를 K6로 300·1000·3000 VU까지 포화시켜 슬롯 회전·대기 시간·레이턴시 추이를 측정했습니다"
category: challenge
tags:
  - go-ti
  - Queue
  - POC
  - LoadTest
  - Redis
  - Saturation
  - troubleshooting
series:
  name: "goti-queue-poc"
  order: 4
date: "2026-03-30"
---

## 한 줄 요약

> Redis 폴링 기반 대기열(POC A)을 K6로 300/1000/3000 VU까지 포화시켰습니다. 슬롯 회전이 정상 동작하면서 1000 VU까지는 안정적이었지만, 3000 VU에서는 queue API p95가 3초대로 급증해 서버 포화가 시작됐습니다.

---

## 🔥 문제: POC A의 포화 지점을 찾자

POC A는 Redis 폴링 기반 대기열 구현입니다. 클라이언트가 주기적으로 `queue_status`를 폴링해서 자기 순서가 됐는지 확인하는 방식입니다.

이번 세션의 목표는 **포화 지점 측정**입니다. 300 VU에서 안정적으로 돌아가는 것은 이전 세션에서 확인했지만, 어느 수준에서 깨지는지는 몰랐습니다.

### 테스트 환경

- **테스트일**: 2026-03-30
- **도구**: K6
- **대상**: `goti-queue-poc-a-dev` (poc-a-17-653bafa)
- **경기**: 삼성 vs 두산 (`6cbe6a53-ddc2-4751-bf9d-449de7d1271b`, 3/31)

### 코드 수정 사항

이전 세션과 이번 세션에 걸쳐 포화 테스트의 전제 조건을 갖추기 위한 수정이 들어갔습니다.

1. **`countKeys()` SCAN → O(1) 카운터**: `RedisCache`의 활성 인원 집계를 SCAN 기반에서 `getActiveCount`/`increment`/`decrement` 카운터로 교체했습니다.
2. **`queueComplete()` API 추가**: MSA 슬롯 반환 경로를 `BookingCompletedEvent` 대신 명시적 API 호출로 바꿨습니다.
3. **메트릭 태그 통일 + gauge 패턴**: `match_id` 태그를 통일하고, `AtomicLong` 기반 gauge로 `queue_max_entry`를 추가했습니다.

---

## ✅ 결과: 300 VU

첫 단계는 300 VU입니다. 이전 구현에서 iteration이 100에 고정되던 문제가 풀렸는지부터 확인해야 합니다.

| 지표 | 값 |
|------|-----|
| iterations | 4,476 |
| ticket_success | 99.26% (4,443/4,476) |
| queue_pass_rate | 100% (4,476/4,476) |
| immediate_pass | 2.22% (100명 = maxCapacity) |
| queue_wait avg | 13.65s |
| queue_wait p50 | 13.57s |
| queue_wait p95 | 18.05s |
| queue_wait max | 20.95s |
| queue_e2e avg | 18.8s |
| queue_e2e p95 | 23.2s |
| queue_poll avg | 10.3회 |
| queue_poll max | 15회 |
| http_req_failed | 5.26% |
| http_req p95 | 406ms |
| http_req p99 | 597ms |
| seat_conflicts | 3건 |
| data_received | 231 MB |
| iterations/s | 11.84 |

이 결과에서 가장 중요한 지표는 `iterations=4,476`입니다.

### 핵심 개선 — 슬롯 회전 정상화

이전 구현에서는 `iterations=100`에 고정돼 있었습니다. 슬롯이 회전하지 않아서 첫 100명이 입장한 뒤로는 더 이상 아무도 들어가지 못하는 상태였습니다. SCAN 기반 카운터가 병목이었고, 예매 완료가 슬롯을 반환하지 않는 구조적 문제도 있었습니다.

이번 세션에서 O(1) 카운터와 `queueComplete()` API로 이 두 문제를 풀었습니다. 결과적으로 슬롯 회전 흐름이 정상 동작했습니다.

전체 순환 흐름은 다음과 같습니다.

1. `queueComplete()` 호출로 예매 완료가 명시적으로 신호됩니다.
2. 완료 신호를 받은 대기열이 MSA 슬롯을 반환합니다.
3. Scheduler가 다음 대기자를 승격시킵니다.
4. 승격된 유저가 입장해서 예매를 진행합니다.
5. 다시 1번으로 돌아가는 순환이 안정적으로 돕니다.

iteration이 4,476까지 돌았다는 것은 이 순환이 끊김 없이 유지됐다는 의미입니다.

---

## ✅ 결과: 1000 VU

다음은 1000 VU입니다. 300 VU 대비 3배 이상 부하입니다.

| 지표 | 값 |
|------|-----|
| iterations | 3,713 |
| ticket_success | 97.96% |
| queue_pass_rate | 100% |
| immediate_pass | 2.21% (100명 = maxCapacity) |
| queue_wait avg | 67.7s |
| queue_wait p50 | 66.4s |
| queue_wait p95 | 136.4s |
| queue_wait max | 158.0s |
| queue_e2e avg | 72.0s |
| queue_e2e p95 | 140.0s |
| queue_poll avg | 52.2회 |
| queue_poll max | 124회 |
| http_req_failed | 0.013% |
| http_req p95 | 390ms |
| seat_conflicts | 2건 |
| data_received | 293 MB |
| iterations/s | 9.84 |
| signup 성공 | 4,528/4,528 (100%) |

### 300 VU 대비 비교

| 지표 | 300 VU | 1000 VU | 변화 |
|------|--------|---------|------|
| iterations | 4,476 | 3,713 | -17% (대기 시간 증가로 iteration 감소) |
| ticket_success | 99.26% | 97.96% | -1.3pp |
| queue_wait avg | 13.65s | 67.7s | 5x 증가 (대기열 길어짐) |
| queue_wait p95 | 18.05s | 136.4s | 7.6x 증가 |
| queue_poll avg | 10.3회 | 52.2회 | 5x 증가 |
| http_req_failed | 5.26% | 0.013% | 대폭 개선 (ramping 효과) |
| http_req p95 | 406ms | 390ms | 유사 |
| iterations/s | 11.84 | 9.84 | -17% |

표만 보면 여러 지표가 악화된 것처럼 보이지만, 실제로는 **예상 범위 내 선형 증가**에 가깝습니다.

### 분석 — 1000 VU는 여전히 안정

핵심 관찰은 네 가지입니다.

첫째, 슬롯 회전이 여전히 정상 동작합니다. 1000 VU에서도 `iterations=3,713`을 기록했습니다. 이전 100 고정 구현 대비 약 37배 개선된 수치입니다.

둘째, 대기 시간은 선형 증가했습니다. 1000명이 100 슬롯을 두고 경쟁하는 구조이므로 대기 시간이 비례해서 늘어나는 것은 설계상 당연합니다. `queue_wait avg`가 13.7초에서 67.7초로, `queue_poll avg`가 10.3회에서 52.2회로 늘어난 것도 같은 이유입니다.

셋째, `ticket_success 97.96%`는 거의 완벽한 결과입니다. 실패 원인도 좌석 경합(`seat_conflicts` 2건)뿐입니다. 대기열 자체가 깨져서 실패한 것이 아닙니다.

넷째, `http_req_failed`가 오히려 개선됐습니다. 300 VU의 5.26%에서 1000 VU의 0.013%로 떨어졌습니다. 1000 VU 테스트는 ramping 구간을 길게 잡아서 signup 요청이 분산됐기 때문입니다. 300 VU 테스트에서는 signup stagger가 없어 초기 스파이크로 실패가 났습니다.

---

## ✅ 결과: 3000 VU

마지막은 3000 VU입니다. 포화 지점을 찾기 위한 테스트입니다.

| 지표 | 값 |
|------|-----|
| iterations | 763 (2.00/s) |
| ticket_success | 86.89% |
| queue_pass_rate | 100% |
| immediate_pass | 2.66% |
| queue_validate avg/p95 | 1,429ms / 2,993ms |
| queue_status avg/p95 | 2,420ms / 3,103ms |
| queue_wait avg | 53.5s |
| queue_wait p95 | 151.0s |
| queue_wait max | 228.7s |
| queue_poll avg/max | 17.4 / 68회 |
| queue_e2e avg/p95 | 58.7s / 149.9s |
| http_req avg/p95 | 2,357ms / 3,102ms |
| http_failed | 0.003% |
| seat_conflicts | 8건 |
| 총 HTTP 요청 | 329,262 (865/s) |
| data | 204 MB recv / 22 MB sent |

### 300 → 1000 → 3000 VU 추이

| 지표 | 300 VU | 1000 VU | 3000 VU |
|------|--------|---------|---------|
| iterations | 4,476 | 3,713 | 763 |
| queue_status p95 | 404ms | 361ms | 3,103ms |
| queue_validate p95 | 499ms | 452ms | 2,993ms |
| http_req p95 | 406ms | 390ms | 3,102ms |
| queue_wait avg | 13.7s | 67.7s | 53.5s |
| http_failed | 5.26% | 0.013% | 0.003% |
| HTTP req/s | 242 | 781 | 865 |

### 분석 — 3000 VU에서 서버 포화 시작

3000 VU에서는 뚜렷한 변곡점이 관찰됐습니다.

가장 눈에 띄는 것은 **queue API 레이턴시 급증**입니다. `queue_status p95`가 1000 VU의 361ms에서 3,103ms로 8.6배 뛰었습니다. `queue_validate p95`도 452ms에서 2,993ms로 유사한 증가폭을 보였습니다. 이 수치는 서버가 포화 구간에 진입했다는 신호입니다.

두 번째는 **iterations 급감**입니다. 3000 VU에서 763회만 돌았습니다. 1000 VU 대비 -79%입니다. 대기열 대기 시간과 예매 E2E 시간이 모두 길어지면서 iteration 회전율이 떨어진 결과입니다.

세 번째는 **대기열 자체는 깨지지 않았다**는 점입니다. `queue_pass_rate`가 100%를 유지하고 있습니다. 느려질 뿐, 승격 로직이나 상태 관리가 무너진 것은 아닙니다.

네 번째는 **에러율이 여전히 매우 낮다**는 점입니다. `http_failed 0.003%`로, 실패 응답은 거의 없습니다. 응답이 느릴 뿐 반환되기는 합니다. 이는 서버가 멈춘 것이 아니라 처리 속도만 한계에 도달했다는 것을 의미합니다.

---

## 📚 배운 점

- **슬롯 회전 설계가 먼저다**: 아무리 부하를 줘도 iteration이 100에 고정되면 측정 자체가 무의미합니다. 포화 테스트 이전에 `queueComplete()` API와 O(1) 카운터로 회전을 정상화한 것이 전제 조건이었습니다.
- **대기 시간 선형 증가는 정상**: 슬롯 수가 고정(100)이므로 VU가 늘어나면 대기 시간이 선형으로 늘어나는 것은 설계상 당연한 결과입니다. 이것을 "문제"로 해석하지 않는 판단이 필요합니다.
- **포화는 에러율이 아니라 레이턴시로 드러난다**: 3000 VU에서 `http_failed`는 여전히 0.003%이지만 `queue_status p95`가 3초대로 뛰었습니다. 실패 응답만 보면 정상처럼 보입니다. 레이턴시 분포를 함께 봐야 포화 지점을 놓치지 않습니다.
- **ramping이 signup 에러율을 좌우했다**: 300 VU(5.26%) vs 1000 VU(0.013%)의 차이는 부하 자체가 아니라 signup stagger 여부에서 왔습니다. 초기 스파이크를 분산시키는 것만으로 에러율이 400배 이상 개선됐습니다.
- **1000 VU까지는 안정, 3000 VU가 포화 시작점**: Redis 폴링 POC는 1000 VU에서 거의 완벽한 결과(97.96% 성공, p95 < 400ms)를 보였지만, 3000 VU에서는 queue API가 3초대로 느려졌습니다. 이 차이를 기록해두는 것이 다른 POC(Kafka, CDN 캐싱)와 비교할 때의 기준선이 됩니다.
