---
date: 2026-03-30
type: troubleshoot
tags: [load-test, queue, member-c, saturation]
---

# 팀원 C 대기열 포화 테스트 결과 (방식 2)

테스트일: 2026-03-30
도구: K6
대상: goti-queue-member-c-dev (poc-member-c-27-4ae7a51)
경기: 4/1 KIA vs 두산 (cffa774c)
maxCapacity: 100

## 방식 2 특징
- Redis ZSET + HASH 기반 대기열
- Custom TokenEncryptor (secureToken, @RequestParam)
- Heartbeat 방식 (TTL 30초, 10초 간격 갱신)
- Redis Key Expiration Event 기반 승격
- 분산 락 (이탈 이벤트 처리)

## 테스트 결과

### 300 VU

| 지표 | 값 | 기준 | 판정 |
|------|-----|------|------|
| Iterations | 457 (1.2/s) | - | - |
| queue_pass_rate | 100% (458/458) | >70% | ✅ |
| ticket_success_rate | 93.87% (429/457) | >20% | ✅ |
| http_req_failed | 0.00% (1/34,894) | <10% | ✅ |
| http_req_duration p95 | 309ms | <2000ms | ✅ |
| queue_enter_ms p95 | 337ms | <1000ms | ✅ |
| queue_status_ms p95 | 281ms | <500ms | ✅ |
| queue_seat_enter_ms p95 | 324ms | <1000ms | ✅ |
| queue_heartbeat_ms p95 | 278ms | - | - |
| queue_wait p50 | 17s | <30s | ✅ |
| queue_wait p95 | 3m59s | <120s | ❌ |
| queue_e2e avg | 56s | - | - |
| queue_immediate_pass_rate | 13.29% | - | - |
| queue_poll_count avg/max | 9.2 / 65 | - | - |
| seat_conflicts | 1 | - | - |
| RPS (avg) | 92 req/s | - | - |

### 1000 VU

| 지표 | 값 | 기준 | 판정 |
|------|-----|------|------|
| Iterations | 417 (1.1/s) | - | - |
| queue_pass_rate | 100% (418/418) | >70% | ✅ |
| ticket_success_rate | 90.90% (380/418) | >20% | ✅ |
| http_req_failed | 0.00% (0/106,987) | <10% | ✅ |
| http_req_duration p95 | 282ms | <2000ms | ✅ |
| queue_enter_ms p95 | 293ms | <1000ms | ✅ |
| queue_status_ms p95 | 279ms | <500ms | ✅ |
| queue_seat_enter_ms p95 | 295ms | <1000ms | ✅ |
| queue_heartbeat_ms p95 | 278ms | - | - |
| queue_wait p50 | 11.7s | <30s | ✅ |
| queue_wait p95 | 2m54s | <120s | ❌ |
| queue_e2e avg | 45s | - | - |
| queue_immediate_pass_rate | 7.07% | - | - |
| queue_poll_count avg/max | 7.3 / 67 | - | - |
| RPS (avg) | 283 req/s | - | - |

### 3000 VU

| 지표 | 값 | 기준 | 판정 |
|------|-----|------|------|
| Iterations | 290 (0.77/s) | - | - |
| queue_pass_rate | 100% (292/292) | >70% | ✅ |
| ticket_success_rate | 86.20% (250/290) | >20% | ✅ |
| http_req_failed | 0.00% (2/309,449) | <10% | ✅ |
| http_req_duration p95 | 501ms | <2000ms | ✅ |
| queue_enter_ms p95 | 917ms | <1000ms | ✅ |
| queue_status_ms p95 | 500ms | <500ms | ⚠️ |
| queue_seat_enter_ms p95 | 562ms | <1000ms | ✅ |
| queue_heartbeat_ms p95 | 482ms | - | - |
| queue_wait p50 | 23s | <30s | ✅ |
| queue_wait p95 | 4m48s | <120s | ❌ |
| queue_e2e avg | 1m47s | - | - |
| queue_immediate_pass_rate | 3.04% | - | - |
| queue_poll_count avg/max | 19.6 / 67 | - | - |
| seat_conflicts | 2 | - | - |
| RPS (avg) | 818 req/s | - | - |

## 팀원 C VU 스케일 비교

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

## 3자 비교 — 팀원 A vs 팀원 B vs 팀원 C

### 300 VU

| 지표 | 팀원 A | 팀원 B | 팀원 C | 비고 |
|------|------|------|------|------|
| iterations | - | 4,476 | 457 | 팀원 B iteration 회전 빠름 |
| queue_pass_rate | - | 99.26% | **100%** | 팀원 C 전원 통과 |
| ticket_success | - | 99.26% | **93.87%** | 팀원 B 우위 |
| http_req_failed | - | 0% | **0%** | 동률 |
| queue_wait p95 | - | 18s | 3m59s | 팀원 B이 대기 짧음 |
| RPS | - | 242 | 92 | 팀원 B 2.6x |

### 1000 VU

| 지표 | 팀원 A | 팀원 B | 팀원 C | 비고 |
|------|------|------|------|------|
| iterations | **5,495** | 3,713 | 417 | 팀원 A > 팀원 B >> 팀원 C |
| iterations/s | **14.5** | 9.84 | 1.1 | 팀원 A 처리량 최고 |
| queue_pass_rate | 81.56% | **100%** | **100%** | 팀원 B/팀원 C 전원 통과 |
| ticket_success | 81.51% | **97.96%** | 90.90% | 팀원 B > 팀원 C > 팀원 A |
| http_req_failed | 0.51% | 0.013% | **0.00%** | 팀원 C 에러 0 |
| http_req p95 | 2.18s | **390ms** | **282ms** | **팀원 C 응답 최고** |
| queue_wait avg | **56s** | 67.7s | 40s | **팀원 C 대기 최단** |
| queue_wait p95 | 1m17s | 2m16s | 2m54s | 팀원 A 꼬리 최단 |
| RPS | 825 | **781** | 283 | 팀원 A > 팀원 B >> 팀원 C |

### 3000 VU

| 지표 | 팀원 A | 팀원 B | 팀원 C | 비고 |
|------|------|------|------|------|
| iterations | **6,574** | 763 | 290 | 팀원 A >> 팀원 B > 팀원 C |
| iterations/s | **12.2** | 2.0 | 0.77 | 팀원 A 처리량 압도적 |
| queue_pass_rate | 57.90% | **100%** | **100%** | 팀원 B/팀원 C 전원 통과 |
| ticket_success | 56.85% | 86.89% | **86.20%** | 팀원 B ≈ 팀원 C > 팀원 A |
| http_req_failed | 0.63% | 0% | **0.00%** | 팀원 C/팀원 B 에러 0 |
| http_req p95 | 2.13s | 3.1s | **501ms** | **팀원 C 응답 압도적** |
| queue_wait p50 | 2m19s | 53s | **23s** | **팀원 C 대기 최단** |
| queue_wait p95 | 2m54s | 2m31s | 4m48s | 팀원 B 꼬리 최단 |
| queue_e2e avg | 2m0s | 53.5s | 1m47s | 팀원 B E2E 최단 |
| RPS | **825** | 865 | 818 | 비슷 |

## 분석

### 팀원 C님 강점
- **http_req p95 최저** — 1000 VU 282ms, 3000 VU 501ms. pod 단위 응답이 빠름
- **http_req_failed 0.00%** — 모든 VU에서 에러 0건. 안정성 최고
- **queue_pass_rate 100%** — 모든 VU에서 대기열 전원 통과
- **queue_wait p50 최단** — 3000 VU에서도 23s

### 팀원 C님 약점
- **iterations 최소** — 슬롯 회전이 느림 (이벤트 기반 승격 → 비동기 지연)
- **queue_wait p95 최장** (3000 VU) — 꼬리 지연 4m48s
- **Heartbeat 오버헤드** — polling 외에 heartbeat도 보내야 함

### 팀원 A님 강점
- **iterations/처리량 최고** — 동일 시간에 가장 많은 예매 완료
- **Scheduler 기반 승격** — 안정적인 슬롯 회전

### 팀원 B님 강점
- **ticket_success 최고** — 대기열 통과 후 예매 성공률 가장 높음
- **queue_e2e 최단** — 전체 흐름 가장 빠름

## 결론
- 팀원 C님: **안정성(에러 0, 응답 빠름)** 최고, **처리량(iterations)** 최저
- 팀원 A님: **처리량** 최고, **안정성** 상대적 약함 (3000 VU에서 pass_rate 58%)
- 팀원 B님: **균형형** — 처리량과 성공률 모두 양호
