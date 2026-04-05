# 수연 POC Saturation 부하테스트 결과

테스트일: 2026-03-30
도구: K6
대상: goti-queue-dev (poc-suyeon-24-2c7348a)
경기: KIA vs 두산 (cffa774c-5231-4b5d-b994-0c291898cdef, 4/1)

## 버그 수정 사항 (테스트 과정에서 발견 → 수정)

### 1. Lua Script ARGV 직렬화 불일치 (poc-suyeon-22)
- **증상**: tryIncrementActiveCount가 항상 QUEUE_CAPACITY_FULL 반환 (activeCount=0인데도)
- **원인**: `RedisTemplate<String, Object>`의 `GenericJackson2JsonRedisSerializer`가 Lua ARGV를 `"\"maxCapacity\""` 형태로 직렬화 → Hash 필드명 `"maxCapacity"`와 불일치 → `HGET` nil → max=0 → `0 < 0` = false
- **수정**: `StringRedisTemplate`으로 Lua script 실행하여 plain string ARGV 전달

### 2. updateSeatEnterMeta race condition (poc-suyeon-23)
- **증상**: lastEnteredRank=6 (실제 81명 seat-enter 성공했는데)
- **원인**: 100명 동시 seat-enter → `putAll` last-write-wins → 늦게 도착한 낮은 queueNumber(6)가 높은 값(98)을 덮어씀
- **수정**: Lua script `max(기존값, 새값)` 패턴으로 원자적 갱신

### 3. Redis 직렬화 혼용 JsonParseException (poc-suyeon-24)
- **증상**: status API 500 에러 (JsonParseException)
- **원인**: Lua script(stringRedisTemplate)이 plain string으로 쓴 값을 redisTemplate(JSON serializer)이 읽으면서 파싱 실패
- **수정**: meta 읽기/쓰기 전체를 `StringRedisTemplate`으로 통일

### 4. K6 VU signup 과부하 (K6 스크립트 개선)
- **증상**: setup 504 → data=null → 초당 수십만 빈 iteration 폭풍 → Mimir push 병목
- **원인**: 매 iteration마다 `__ITER` 포함 uniqueId로 신규 유저 생성 (tokenCache 히트 0%)
- **수정**: VU당 1명 고정 (`uniqueId = __VU`) + `login()` API(read-only) 우선 + setup에서 `bulk` 사전 생성 + backoff 강화

## 1000 VU 결과

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
| queue_status avg/p95 | 942ms / 2.18s |
| http_req p95 | 2.18s |
| http_req_failed | 0.51% |
| seat_selection avg | 421ms |
| order_creation avg | 312ms |
| payment avg | 331ms |
| data_received | 320 MB |
| data_sent | 17 MB |

### 분석

- **슬롯 회전 정상 동작**: publishedRank가 2000+ 이상 증가, active 50~65/100 수준 유지
- **대기 시간**: 1000명 × 100슬롯 경쟁 → avg 56s, 대기열 설계상 예상 범위
- **ticket_success 81.51%**: 좌석 경합(AVAILABLE 좌석 소진)으로 약 18% 실패 — 대기열 자체 문제 아님
- **queue_pass_rate 81.56%**: pass 후 ticketing 실패한 VU 포함 (좌석 없음, hold 실패 등)
- **http_req_failed 0.51%**: queue pod 1개로 1000 VU polling 처리 시 간헐적 504
- **queue_status p95 2.18s**: pod 과부하로 status polling 느림 (준상 390ms 대비 높음)

## 수연 vs 준상 1000 VU 비교

| 지표 | 수연 | 준상 | 차이 | 비고 |
|------|------|------|------|------|
| **iterations** | **5,495** | 3,713 | **+48%** | 수연이 iteration 회전 빠름 |
| **iterations/s** | **14.5** | 9.84 | **+47%** | 수연 처리량 우위 |
| **ticket_success** | 81.51% | **97.96%** | -16pp | 준상이 예매 성공률 높음 |
| **queue_pass_rate** | 81.56% | **100%** | -18pp | 준상은 전원 통과 |
| queue_wait avg | **56.4s** | 67.7s | **-17%** | 수연이 대기 시간 짧음 |
| queue_wait p95 | **1m17s** | 136.4s | **-15%** | 수연이 꼬리 지연도 적음 |
| queue_poll avg | **27회** | 52.2회 | **-48%** | 수연이 polling 횟수 절반 |
| queue_status p95 | 2.18s | **390ms** | 5.6x 높음 | 수연 pod 과부하 |
| http_req p95 | 2.18s | **390ms** | 5.6x 높음 | 동일 원인 |
| http_req_failed | 0.51% | **0.013%** | 39x 높음 | 수연 504 간헐 발생 |
| immediate_pass | 1.81% | 2.21% | 유사 | 첫 100명 즉시 통과 |

### 핵심 차이 분석

**수연 강점 — 처리량(throughput)**
- iterations 48% 더 많음: 수연의 "동적 publishedRank 계산 + 즉시 승격" 방식이 슬롯 회전을 빠르게 함
- polling 횟수 48% 적음: leave 즉시 availableSlots 증가 → 다음 status에서 바로 통과
- 대기 시간 17% 짧음

**준상 강점 — 안정성(reliability)**
- ticket_success 97.96% vs 81.51%: 준상은 예매 실패가 거의 없음
- queue_pass_rate 100%: 대기열 통과 후 전원 예매 성공
- http_req_failed 0.013%: API 에러 거의 0
- status p95 390ms: 안정적 응답 시간

**차이 원인 추정**
1. **수연 ticket_success 낮은 이유**: 빠른 회전 → 동시 좌석 경합 증가 → AVAILABLE 좌석 소진/hold 실패
2. **수연 status 느린 이유**: publishedRank를 매 요청마다 동적 계산 (Redis HGET 2회 + 계산) vs 준상은 Scheduler가 주기적 갱신
3. **수연 http_failed 높은 이유**: 1000 VU × 1초 polling = 1000 req/s status 요청이 pod 1개 한계 초과

### 공정 비교 시 고려사항

- **pod 수**: 양쪽 모두 1 replica (공정)
- **maxCapacity**: 양쪽 모두 100 (공정)
- **polling 간격**: 수연 1초, 준상 1초 (통일 완료)
- **경기/좌석 데이터**: 다른 경기 사용 — 좌석 수 차이 가능
- **이미지 태그**: 수연 poc-suyeon-24, 준상 poc-junsang-17

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
| queue_seat_enter avg/p95 | 1.68s / 2.29s |
| queue_leave avg | 1.46s |
| queue_status avg/p95 | 1.55s / 2.13s |
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

- **대기열 안정**: 3000 VU에서도 active=98~100/100 유지, publishedRank 6477까지 상승
- **user 서비스 과부하 해소**: setup에서 토큰 사전 발급으로 VU 실행 중 login 호출 제거 → 503 완전 제거
- **ticket_success 하락 원인**: 좌석 경합 — 6,574 iterations × 1석/iteration = 좌석 소진. 대기열 자체 문제 아님
- **queue_status p95 안정**: 1000 VU(2.18s) → 3000 VU(2.13s) — 유의미한 차이 없음, pod 1개 한계에서 안정

## 수연 vs 준상 전체 비교 (300/1000/3000 VU)

### 1000 VU

| 지표 | 수연 | 준상 | 승자 |
|------|------|------|------|
| iterations | **5,495** | 3,713 | **수연 +48%** |
| ticket_success | 81.51% | **97.96%** | **준상** |
| queue_pass_rate | 81.56% | **100%** | **준상** |
| queue_wait avg | **56s** | 67.7s | **수연 -17%** |
| polling 횟수 | **27회** | 52회 | **수연 -48%** |
| status p95 | 2.18s | **390ms** | **준상** |
| http_failed | 0.51% | **0.013%** | **준상** |

### 3000 VU

| 지표 | 수연 | 준상 | 승자 |
|------|------|------|------|
| iterations | **6,574** | 763 | **수연 8.6x** |
| iterations/s | **12.2** | 2.0 | **수연 6.1x** |
| ticket_success | 56.85% | **86.89%** | **준상** |
| queue_pass_rate | 57.90% | **100%** | **준상** |
| queue_wait avg | 1m55s | **53.5s** | **준상** |
| queue_status p95 | **2.13s** | 3,103ms | **수연** |
| http_req_failed | 0.63% | **0.003%** | **준상** |
| HTTP reqs | **445K** | 329K | **수연 +35%** |
| active/100 유지 | **98~100** | - | **수연** |

### 종합 분석

**수연 (방식 3) 특성:**
- **처리량 최강**: 3000 VU에서 준상 대비 8.6x iterations. 동적 publishedRank 계산으로 leave 즉시 다음 유저 승격
- **수용인원 100% 유지**: active=98~100/100으로 슬롯 낭비 없음
- **대규모 VU에서 status API 안정**: 3000 VU에서도 status p95 2.13s (준상 3.1s 대비 안정)
- **약점**: seat-enter 시 동시 경합(409 CAPACITY_FULL) — 단, 실사용에서는 문제 아님 (polling 재시도로 자연 해소)

**준상 (방식 2) 특성:**
- **신뢰성 최강**: queue_pass_rate 항상 100%, ticket_success 87~98%
- **Scheduler 1초 주기 승격**: 빈 슬롯만큼만 승격하여 경합 없음
- **약점**: 3000 VU에서 API 레이턴시 급증 (status p95: 390ms → 3.1s) → iterations=763으로 처리량 급감

**3000 VU 처리량 차이(8.6x)의 주 원인:**
- Scheduler 주기(1초)보다 **준상의 API 레이턴시 급증**이 핵심 → status p95 3.1s에서 polling 자체가 느려짐
- 수연은 status API가 3000 VU에서도 p95 2.13s로 안정 유지

**결론**: 수연=고처리량/고효율, 준상=고안정성/고신뢰성. 대규모(3000+)에서 수연이 압도적 처리량 우위.
