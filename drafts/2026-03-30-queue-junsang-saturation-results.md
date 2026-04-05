# 준상 POC Saturation 부하테스트 결과

테스트일: 2026-03-30
도구: K6
대상: goti-queue-junsang-dev (poc-junsang-17-653bafa)
경기: 삼성 vs 두산 (6cbe6a53-ddc2-4751-bf9d-449de7d1271b, 3/31)

## 코드 수정 사항 (이전 세션 + 이번 세션)

1. **countKeys() SCAN → O(1) 카운터** (RedisCache: getActiveCount/increment/decrement)
2. **queueComplete() API 추가** — MSA 슬롯 반환 (BookingCompletedEvent 대체)
3. **메트릭 태그 match_id 통일** + AtomicLong gauge 패턴 + queue_max_entry 추가

## 300 VU 결과

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

### 핵심 개선

- **이전**: iterations=100 고정 (슬롯 미회전, SCAN 병목)
- **이후**: iterations=4,476 (슬롯 정상 회전, O(1) 카운터)
- queueComplete() 호출로 예매 완료 → 슬롯 반환 → Scheduler 승격 → 다음 유저 입장 순환 정상

## 1000 VU 결과

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

### 300 → 1000 VU 비교

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

### 분석

- **슬롯 회전 정상 동작**: 1000 VU에서도 iterations=3,713 (이전 100 고정 대비 37x 개선)
- **대기 시간 선형 증가**: 1000명 중 100 슬롯 경쟁 → 대기 시간 비례 증가 (예상 범위)
- **ticket_success 97.96%**: 좌석 경합(seat_conflicts) 2건만 발생, 거의 완벽
- **http_req_failed 0.013%**: 300 VU 대비 대폭 개선 (signup stagger 불필요, ramping이 분산)

## 3000 VU 결과

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

### 3000 VU 분석

- **queue API 레이턴시 급증**: status p95가 361ms → 3,103ms (8.6x). 서버 포화 시작
- **iterations 급감**: 763 (1000 VU 대비 -79%). 대기열 + 예매 E2E가 길어져서 iteration 회전 감소
- **queue_pass_rate 100% 유지**: 대기열 자체는 안정, 느려질 뿐 깨지지 않음
- **http_failed 0.003%**: 에러 거의 없음 — 느리지만 안정
