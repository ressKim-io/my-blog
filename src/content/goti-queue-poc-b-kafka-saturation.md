---
title: "POC B(Kafka) 포화 테스트 결과 — 응답은 최고, 회전은 최저"
excerpt: "Redis ZSET + Kafka 이벤트 기반 승격 방식의 포화 테스트 결과입니다. 300/1000/3000 VU 모두 에러 0%, 응답 p95 최고 성능을 보였지만 iteration 회전은 가장 느렸습니다."
category: challenge
tags:
  - go-ti
  - Queue
  - POC
  - LoadTest
  - Kafka
  - Saturation
series:
  name: "goti-queue-poc"
  order: 5
date: "2026-03-30"
---

## 한 줄 요약

> POC B(Kafka 이벤트 기반 승격) 대기열의 300/1000/3000 VU 포화 테스트 결과입니다. 응답 p95와 에러율에서 3개 POC 중 최고 성능을 보였지만, iteration 회전 속도는 가장 느렸습니다.

---

## 테스트 환경

- **테스트일**: 2026-03-30
- **도구**: K6
- **대상**: `goti-queue-poc-b-dev` (이미지 태그 `poc-b-27-4ae7a51`)
- **경기**: 4/1 KIA vs 두산 (`cffa774c`)
- **maxCapacity**: 100

## POC B 특징

POC B는 Redis와 이벤트 기반 승격을 조합한 방식입니다.

- **Redis ZSET + HASH** 기반 대기열 상태 저장
- **Custom TokenEncryptor** — `secureToken`을 `@RequestParam`으로 전달
- **Heartbeat 방식** — TTL 30초, 10초 간격 갱신
- **Redis Key Expiration Event 기반 승격** — 이벤트 수신 시 다음 사용자 승격
- **분산 락** — 이탈 이벤트 처리 시 중복 방지

POC A의 단순 폴링 승격과 다른 점은 **이벤트 기반**이라는 것입니다. 슬롯에 빈 자리가 생기면 Redis Key Expiration Event가 발생하고, 그 이벤트를 받아 다음 사용자를 승격시킵니다. Heartbeat를 별도로 보내 활성 상태를 유지하는 구조입니다.

---

## 🔥 테스트 결과

### 300 VU

| 지표 | 값 | 기준 | 판정 |
|------|-----|------|------|
| Iterations | 457 (1.2/s) | - | - |
| queue_pass_rate | 100% (458/458) | >70% | 통과 |
| ticket_success_rate | 93.87% (429/457) | >20% | 통과 |
| http_req_failed | 0.00% (1/34,894) | <10% | 통과 |
| http_req_duration p95 | 309ms | <2000ms | 통과 |
| queue_enter_ms p95 | 337ms | <1000ms | 통과 |
| queue_status_ms p95 | 281ms | <500ms | 통과 |
| queue_seat_enter_ms p95 | 324ms | <1000ms | 통과 |
| queue_heartbeat_ms p95 | 278ms | - | - |
| queue_wait p50 | 17s | <30s | 통과 |
| queue_wait p95 | 3m59s | <120s | 미달 |
| queue_e2e avg | 56s | - | - |
| queue_immediate_pass_rate | 13.29% | - | - |
| queue_poll_count avg/max | 9.2 / 65 | - | - |
| seat_conflicts | 1 | - | - |
| RPS (avg) | 92 req/s | - | - |

300 VU에서도 queue_pass_rate 100%, http_req_failed 0%를 달성했습니다. 응답 p95도 309ms로 빠른 편이지만, queue_wait p95가 3분 59초로 기준(120s)을 초과했습니다. 꼬리 지연이 첫 단계부터 드러난 것입니다.

### 1000 VU

| 지표 | 값 | 기준 | 판정 |
|------|-----|------|------|
| Iterations | 417 (1.1/s) | - | - |
| queue_pass_rate | 100% (418/418) | >70% | 통과 |
| ticket_success_rate | 90.90% (380/418) | >20% | 통과 |
| http_req_failed | 0.00% (0/106,987) | <10% | 통과 |
| http_req_duration p95 | 282ms | <2000ms | 통과 |
| queue_enter_ms p95 | 293ms | <1000ms | 통과 |
| queue_status_ms p95 | 279ms | <500ms | 통과 |
| queue_seat_enter_ms p95 | 295ms | <1000ms | 통과 |
| queue_heartbeat_ms p95 | 278ms | - | - |
| queue_wait p50 | 11.7s | <30s | 통과 |
| queue_wait p95 | 2m54s | <120s | 미달 |
| queue_e2e avg | 45s | - | - |
| queue_immediate_pass_rate | 7.07% | - | - |
| queue_poll_count avg/max | 7.3 / 67 | - | - |
| RPS (avg) | 283 req/s | - | - |

1000 VU에서 응답 p95가 오히려 282ms로 300 VU보다 빨라졌습니다. 0/106,987이라는 에러 0건 기록은 107K 요청 동안 단 한 건의 실패도 없었음을 의미합니다. queue_wait p95만 여전히 2분 54초로 기준을 넘었습니다.

### 3000 VU

| 지표 | 값 | 기준 | 판정 |
|------|-----|------|------|
| Iterations | 290 (0.77/s) | - | - |
| queue_pass_rate | 100% (292/292) | >70% | 통과 |
| ticket_success_rate | 86.20% (250/290) | >20% | 통과 |
| http_req_failed | 0.00% (2/309,449) | <10% | 통과 |
| http_req_duration p95 | 501ms | <2000ms | 통과 |
| queue_enter_ms p95 | 917ms | <1000ms | 통과 |
| queue_status_ms p95 | 500ms | <500ms | 경계 |
| queue_seat_enter_ms p95 | 562ms | <1000ms | 통과 |
| queue_heartbeat_ms p95 | 482ms | - | - |
| queue_wait p50 | 23s | <30s | 통과 |
| queue_wait p95 | 4m48s | <120s | 미달 |
| queue_e2e avg | 1m47s | - | - |
| queue_immediate_pass_rate | 3.04% | - | - |
| queue_poll_count avg/max | 19.6 / 67 | - | - |
| seat_conflicts | 2 | - | - |
| RPS (avg) | 818 req/s | - | - |

3000 VU에서도 309,449건 중 2건 실패로 0.00%를 유지했습니다. 응답 p95도 501ms로 여전히 빠릅니다. 다만 `queue_status_ms p95`가 500ms로 기준과 일치해 경계선에 도달했습니다. `queue_enter_ms p95`도 917ms로 1초 기준에 근접했습니다.

---

## VU 스케일 비교

POC B 단독으로 300/1000/3000 VU를 비교하면 다음과 같습니다.

| 지표 | 300 VU | 1000 VU | 3000 VU |
|------|--------|---------|---------|
| iterations | 457 | 417 | 290 |
| iterations/s | 1.2 | 1.1 | 0.77 |
| queue_pass_rate | 100% | 100% | 100% |
| ticket_success | 93.87% | 90.90% | 86.20% |
| http_req_failed | 0.00% | 0.00% | 0.00% |
| http_req p95 | 309ms | 282ms | 501ms |
| queue_wait p50 | 17s | 11.7s | 23s |
| queue_wait p95 | 3m59s | 2m54s | 4m48s |
| queue_e2e avg | 56s | 45s | 1m47s |
| RPS | 92 | 283 | 818 |

주목할 점은 iteration 수가 VU 증가에 따라 오히려 **감소**한다는 것입니다. 300 VU에서 457회, 1000 VU에서 417회, 3000 VU에서 290회로 떨어졌습니다. iterations/s도 1.2에서 0.77까지 하락했습니다. 슬롯 회전 속도가 VU 증가를 따라가지 못한다는 뜻입니다.

반면 응답 지표(http_req_failed, http_req p95)는 VU가 늘어도 안정적이었습니다. 에러율은 3000 VU에서도 0.00%를 유지했고, 응답 p95는 501ms로 2초 기준에서 한참 여유가 있었습니다.

---

## 🤔 3개 POC 교차 비교

포화 테스트는 POC A(Redis 폴링), POC B(Kafka 이벤트), POC C(CDN 캐싱) 세 방식을 동일 조건에서 비교합니다.

### 300 VU

| 지표 | POC C | POC A | POC B | 비고 |
|------|------|------|------|------|
| iterations | - | 4,476 | 457 | POC A iteration 회전 빠름 |
| queue_pass_rate | - | 99.26% | **100%** | POC B 전원 통과 |
| ticket_success | - | 99.26% | **93.87%** | POC A 우위 |
| http_req_failed | - | 0% | **0%** | 동률 |
| queue_wait p95 | - | 18s | 3m59s | POC A 대기 짧음 |
| RPS | - | 242 | 92 | POC A 2.6배 |

300 VU에서 POC A가 iteration 회전과 대기 시간에서 크게 앞섰습니다. POC B는 queue_pass_rate 100%로 누구도 떨어뜨리지 않았지만, RPS와 회전 속도에서 POC A의 약 40% 수준에 그쳤습니다.

### 1000 VU

| 지표 | POC C | POC A | POC B | 비고 |
|------|------|------|------|------|
| iterations | **5,495** | 3,713 | 417 | POC C > POC A >> POC B |
| iterations/s | **14.5** | 9.84 | 1.1 | POC C 처리량 최고 |
| queue_pass_rate | 81.56% | **100%** | **100%** | POC A/B 전원 통과 |
| ticket_success | 81.51% | **97.96%** | 90.90% | POC A > POC B > POC C |
| http_req_failed | 0.51% | 0.013% | **0.00%** | POC B 에러 0 |
| http_req p95 | 2.18s | **390ms** | **282ms** | **POC B 응답 최고** |
| queue_wait avg | **56s** | 67.7s | 40s | **POC B 대기 최단** |
| queue_wait p95 | 1m17s | 2m16s | 2m54s | POC C 꼬리 최단 |
| RPS | 825 | **781** | 283 | POC C > POC A >> POC B |

1000 VU에서 POC B의 강점이 드러났습니다. 응답 p95 282ms는 POC A(390ms)와 POC C(2.18s)를 모두 앞섭니다. queue_wait 평균도 40초로 가장 짧습니다. 다만 iteration 회전에서는 여전히 POC C의 1/13, POC A의 1/9 수준에 머물렀습니다.

### 3000 VU

| 지표 | POC C | POC A | POC B | 비고 |
|------|------|------|------|------|
| iterations | **6,574** | 763 | 290 | POC C >> POC A > POC B |
| iterations/s | **12.2** | 2.0 | 0.77 | POC C 처리량 압도적 |
| queue_pass_rate | 57.90% | **100%** | **100%** | POC A/B 전원 통과 |
| ticket_success | 56.85% | 86.89% | **86.20%** | POC A ≈ POC B > POC C |
| http_req_failed | 0.63% | 0% | **0.00%** | POC B/A 에러 0 |
| http_req p95 | 2.13s | 3.1s | **501ms** | **POC B 응답 압도적** |
| queue_wait p50 | 2m19s | 53s | **23s** | **POC B 대기 최단** |
| queue_wait p95 | 2m54s | 2m31s | 4m48s | POC A 꼬리 최단 |
| queue_e2e avg | 2m0s | 53.5s | 1m47s | POC A E2E 최단 |
| RPS | **825** | 865 | 818 | 비슷 |

3000 VU에서 POC B의 응답 p95 501ms는 POC A(3.1s)의 1/6, POC C(2.13s)의 1/4 수준입니다. Pod 단위 요청 처리는 3개 중 가장 안정적입니다. 반면 iteration은 290회로 POC C의 1/22에 머물렀습니다.

---

## ✅ 분석

### POC B의 강점

- **http_req p95 최저** — 1000 VU에서 282ms, 3000 VU에서 501ms. Pod 단위 응답 속도가 가장 빠릅니다.
- **http_req_failed 0.00%** — 모든 VU 구간에서 실패 요청이 거의 0건입니다. 안정성이 가장 높습니다.
- **queue_pass_rate 100%** — 모든 VU에서 대기열에 들어온 사용자 전원이 통과했습니다.
- **queue_wait p50 최단** — 3000 VU에서도 p50이 23초로, 중앙값 기준 대기 시간이 가장 짧습니다.

에러 0%와 빠른 응답은 POC B의 **이벤트 기반 구조**가 기여한 것으로 보입니다. Redis Key Expiration Event를 사용하면 폴링 간격에 의존하지 않고 즉시 승격이 트리거됩니다.

### POC B의 약점

- **iterations 최소** — 슬롯 회전이 가장 느립니다. 이벤트 기반 승격이 비동기로 동작하기 때문에 지연이 발생합니다.
- **queue_wait p95 최장** — 3000 VU에서 4분 48초로 꼬리 지연이 가장 깁니다. 일부 사용자는 매우 오래 기다리게 됩니다.
- **Heartbeat 오버헤드** — 10초마다 Heartbeat를 보내야 해서 polling 트래픽 외에 추가 요청이 발생합니다.

강점과 약점은 **같은 설계 선택의 양면**입니다. 이벤트 기반 + Heartbeat 방식은 개별 요청의 응답 품질을 높여주지만, 전체 회전 속도는 떨어뜨립니다.

### 다른 POC와의 비교

POC C는 동일 시간에 가장 많은 예매를 완료했습니다. Scheduler 기반 승격으로 슬롯 회전이 안정적입니다.

POC A는 대기열 통과 후 예매 성공률이 가장 높습니다. 전체 E2E 흐름이 가장 빠른 균형형입니다.

---

## 📚 결론

세 POC의 성격을 한 줄로 정리하면 다음과 같습니다.

- **POC B (Kafka 이벤트)**: 안정성(에러 0, 응답 빠름) 최고, 처리량(iterations) 최저
- **POC C (CDN 캐싱)**: 처리량 최고, 안정성 상대적 약함 (3000 VU에서 pass_rate 58%)
- **POC A (Redis 폴링)**: 균형형 — 처리량과 성공률 모두 양호

POC B는 "한 요청을 잘 처리한다"는 관점에서 가장 뛰어납니다. 다만 티켓팅 시스템의 핵심 요구인 "빠른 슬롯 회전"에서는 다른 두 방식에 못 미쳤습니다.

다음 편에서 POC C(CDN 캐싱)의 포화 테스트 결과를 살펴보겠습니다.
