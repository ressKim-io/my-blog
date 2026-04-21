---
title: "대기열 POC 1000VU 최종 비교 — Redis 폴링 간격이 가른 확장성"
excerpt: "3개 대기열 구현체를 1000VU 동일 조건으로 부하 비교했습니다. 폴링 1초는 처리량 최고, 5초+heartbeat는 Redis 효율 최고, 2초는 균형형으로 나뉘었습니다."
category: challenge
tags:
  - go-ti
  - Queue
  - POC
  - LoadTest
  - k6
  - 1000VU
series:
  name: "goti-queue-poc"
  order: 9
date: "2026-04-03"
---

## 한 줄 요약

> 3개 대기열 구현체(A/B/C)를 1000VU 동일 조건으로 비교했습니다. 폴링 1초 구현은 처리량이 2배 높은 대신 Redis 부하가 최대였고, 폴링 5초+heartbeat 분리 구현은 Redis 부하가 1/3로 가장 효율적이면서 timeout 0건을 기록했습니다. 폴링 2초 구현은 중간 포지션이지만 JWE 토큰 오버헤드로 enter가 느렸습니다.

## 테스트 환경

- **일자**: 2026-04-03
- **클러스터**: EKS prod, 10노드 Karpenter
- **접근 경로**: ALB 직접 접근 (Cloudflare 우회)
- **경기**: 기아 vs NC소프트 (4/4 14:00)
- **대기열 수용인원**: `QUEUE_MAX_CAPACITY=100`
- **부하 도구**: k6, 1000VU
- **공통 조건**: `setup()`에서 토큰 일괄 발급 (iteration별 signup 병목 제거)

### 클러스터 상태

| 서비스 | replicas | 비고 |
|--------|----------|------|
| user | 3/4 Running | ECR 전환 직후, 1 CrashLoop |
| queue-* | 각 1 | |
| ticketing-* | 각 1 | |
| payment-* | 각 1 | |

3개 구현체를 각각 A, B, C로 칭하며, 원본의 담당 개발자 이름은 익명화했습니다.

- **구현체 A**: Redis 폴링 1초, heartbeat 없음 (status가 겸함)
- **구현체 B**: Redis 폴링 5초 + 별도 heartbeat 10초, TTL 갱신 분리
- **구현체 C**: Redis 폴링 2초, JWE 토큰 + 분산 Lock

---

## 대기열 안정성 비교

동일 조건에서 통과율과 timeout 건수를 측정했습니다.

| 지표 | 구현체 A | 구현체 C | 구현체 B |
|------|----------|----------|----------|
| **queue_pass_rate** | 96.04% (1629/1696) | 88.45% (1180/1334) | **100%** (391/391) |
| **queue_timeouts** | 67건 | 154건 | **0건** |
| **즉시 통과율** | 4.35% | 4.64% | **7.45%** |

안정성만 놓고 보면 구현체 B가 압도적입니다.

구현체 B는 heartbeat를 별도 API(10초 주기)로 분리했기 때문에 Entry TTL이 꾸준히 갱신됩니다.
폴링이 5초로 느려도 **TTL 만료로 인한 탈락이 없습니다**.
반면 구현체 A는 `waiting-ttl: 30초`만 있어 67건이 TTL 만료로 떨어졌습니다.
구현체 C는 Entry TTL이 10분이지만 seat-enter 단계에서 `ALREADY_ADMITTED` 판정으로 154건이 탈락했습니다.

즉시 통과율도 구현체 B가 7.45%로 가장 높았습니다.
수용인원 100명을 꽉 채운 상태에서 **승격이 빠르게 일어나면 대기 줄이 더 잘 비웁니다**.
이 지표는 곧 heartbeat 기반 TTL 관리가 세션 정리에도 효과적이라는 뜻입니다.

---

## 대기열 응답 시간 비교

응답 속도는 각 API의 평균/퍼센타일을 표로 정리했습니다.

| 지표 | 구현체 A | 구현체 C | 구현체 B | 유리 |
|------|----------|----------|----------|------|
| **queue_enter/validate avg** | 148ms | 336ms | **77ms** | B |
| **queue_status avg** | 110ms | 57ms | **38ms** | B |
| **queue_status p95** | 274ms | 193ms | **81ms** | B |
| **queue_seat_enter avg** | N/A | 192ms | **87ms** | B |
| queue_wait avg | 1m33s | 1m33s | **1m22s** | B |
| queue_wait p95 | **2m13s** | 2m59s | 3m40s | A |

평균/p95 응답 시간 대부분은 구현체 B가 앞섰습니다.

특히 `queue_status`는 평균 38ms, p95 81ms로 **다른 구현체 대비 3배 이상 빠릅니다**.
5초 폴링 간격으로 Redis 요청 빈도가 낮아 경합이 거의 없고, status 응답이 가벼워지는 구조입니다.

반면 **대기 시간 p95는 구현체 A가 2m13s로 유리**했습니다.
폴링 1초는 순번 도달을 거의 실시간으로 감지하기 때문에, 승격된 순간 바로 빠져나갑니다.
구현체 B는 5초 간격이라 최악의 경우 4~5초 추가 대기가 생겨 p95가 3m40s까지 올라갔습니다.

구현체 C의 `queue_enter 336ms`는 JWE 토큰 발급(AES-256-GCM) + 분산 Lock 경합 때문입니다.
1000VU가 동시에 `enter`를 호출하면 Lock 획득 비용이 누적됩니다.

---

## Redis 부하 비교

각 구현체의 폴링/heartbeat 전략이 Redis 요청 빈도에 직결됩니다.

| | 구현체 A | 구현체 C | 구현체 B |
|---|----------|----------|----------|
| Polling 간격 | **1초** | 2초 | 5초 |
| Heartbeat | 없음 (status 겸함) | 없음 | 10초 (별도 API) |
| 1000VU 시 Redis req/s | **~1000** | **~500** | **~300** |
| status 응답 avg | 110ms | 57ms | **38ms** |

Redis 요청 빈도는 구현체 A의 약 1/3 수준입니다.

이 차이가 곧 **확장 여력**을 결정합니다.
구현체 A는 1000VU에서 이미 1000 req/s를 Redis에 쏟아붓고 있습니다.
3000VU로 늘리면 3000 req/s가 되고, Redis single node의 한계(~5~10만 ops, 하지만 응답 레이턴시는 훨씬 빨리 악화)에 근접합니다.

구현체 B는 5초 간격 + heartbeat 분리 덕분에 **VU가 3배로 늘어도 Redis는 900 req/s 수준**입니다.
scale out 없이도 한참 버틸 수 있는 구조입니다.

---

## 처리량 (Throughput) 비교

단위 시간 내 실제 처리된 사용자 수 지표입니다.

| | 구현체 A | 구현체 C | 구현체 B |
|---|----------|----------|----------|
| iterations 완료 | **1588** | 1283 | 756 |
| http_reqs/s | **648** | 384 | 242 |
| 대기열 통과 인원 | **1629** | 1180 | 391 |

처리량은 구현체 A가 2배 이상 높습니다.

폴링 1초의 장점이 여기서 뚜렷합니다.
순번이 돌아온 순간 거의 즉시 감지하고 빠져나오기 때문에, 단위 시간 내 **더 많은 사용자가 대기열 통과**합니다.
5분 테스트에서 1629명 대 391명은 4배 이상의 차이입니다.

구현체 B의 처리량이 낮은 이유는 **각 사용자가 평균 5~10초 더 대기**하기 때문입니다.
대기열 자체의 회전율이 느려져서 통과 인원이 줄어듭니다.

---

## 핵심 분석

결과를 다섯 가지로 정리했습니다.

### 1. 구현체 B는 Redis 효율이 최고

polling 5초 + heartbeat 10초 분리로 Redis req/s가 ~300입니다.
status 응답도 38ms로 가장 빠릅니다.
VU 증가 시 Redis 포화 가능성이 가장 낮아, **대규모 확장에 유리한 구조**입니다.

### 2. 구현체 C는 중간 포지션

polling 2초로 Redis 부하가 ~500 수준입니다.
status 57ms로 양호하지만, `enter 336ms`가 느린 원인은 JWE 토큰 발급 오버헤드입니다.
CDN 캐싱을 도입하면 status 요청이 origin까지 도달하지 않아 크게 개선될 잠재력이 있습니다.

### 3. 구현체 A는 처리량이 2배

polling 1초로 순번 감지가 빠른 만큼, 단위 시간 내 가장 많은 사용자(1629명)를 처리합니다.
다만 Redis 비용이 1000 req/s로 가장 높아 **확장성에서 병목**이 먼저 옵니다.

### 4. TTL 만료 리스크는 heartbeat 유무로 갈림

구현체 A는 `waiting-ttl: 30초`로 67건 만료했습니다.
구현체 C도 Entry TTL 10분이지만 `seat-enter`에서 `ALREADY_ADMITTED` 판정으로 154건 탈락했습니다.
구현체 B는 heartbeat가 TTL을 지속 갱신해 **만료 0건**을 기록했습니다.

### 5. 대기 시간 p95는 구현체 A가 유리

polling 1초라 순번 도달 감지가 빠릅니다(p95 2m13s).
구현체 B는 5초 간격이라 p95가 3m40s로 길어집니다.
**사용자 체감 대기 시간은 구현체 A가 가장 짧습니다**.

---

## 한 줄 요약 비교

각 구현체의 강점과 약점을 한 줄로 정리했습니다.

| 구현체 | 강점 | 약점 |
|--------|------|------|
| **구현체 B** | Redis 효율 최고 (1/3), 안정성 최고 (timeout 0) | 처리량 낮음, 대기 p95 길음 |
| **구현체 C** | 균형잡힌 성능, CDN 캐싱 가능 구조 | enter 느림 (JWE), seat-enter 만료 이슈 |
| **구현체 A** | 처리량 최고 (2배), 대기 p95 짧음 | Redis 부하 최대, TTL 만료 리스크 |

관점별 우위도 두 축으로 갈립니다.

- **확장성 관점**: 구현체 B > 구현체 C > 구현체 A (Redis 부하 기준)
- **응답성 관점**: 구현체 A > 구현체 C > 구현체 B (사용자 체감 대기 기준)

어느 하나가 모든 축에서 이기지 않았습니다.
**확장 가능성(구현체 B)**과 **단기 처리량(구현체 A)**을 놓고 트레이드오프를 선택해야 합니다.

---

## 개별 테스트 상세

### 구현체 A — 1차 (Cloudflare 경유, iteration별 signup)

**결과 파일**: `queue-poc-a-20260403-135046.json`
**조건**: Cloudflare 경유, iteration마다 signup (비공정 — 참고용)

| 지표 | 값 |
|------|-----|
| ticket_success_rate | 1.44% (1035/71465) |
| queue_pass_rate | 30.14% (1051/3486) |
| queue_timeouts | 2435건 |
| http_req_failed | 25.52% |
| signup 성공률 | 5% |

실패 원인은 **대기열 성능이 아니라 테스트 환경 문제**였습니다.
user 서비스가 3 replica뿐이라 iteration별 signup이 5%밖에 성공하지 못했습니다.
`waiting-ttl 30초`도 겹쳐 2435건이 만료로 탈락했습니다.

이후 `setup()`에서 토큰을 일괄 발급하는 방식으로 테스트 스크립트를 변경했습니다.

### 구현체 A — 2차 (ALB 직접, 일괄 발급) ← 공정 비교 대상

**결과 파일**: `queue-poc-a-20260403-143542.json`

| 지표 | 값 | 판정 |
|------|-----|------|
| ticket_success_rate | **93.79%** (1512/1612) | OK |
| queue_pass_rate | **96.04%** (1629/1696) | OK |
| queue_timeouts | 67건 | |
| http_req_failed | 0.04% (102/208782) | OK |
| signup 성공률 | 100% (1000/1000, setup 일괄) | OK |
| http_reqs | 648 req/s | |

대기열 지표 상세입니다.

| 지표 | avg | p90 | p95 | max |
|------|-----|-----|-----|-----|
| queue_validate_ms | 148ms | 316ms | 391ms | 989ms |
| queue_status_ms | 110ms | 215ms | 274ms | 1.02s |
| queue_wait_duration | 1m33s | 2m11s | 2m13s | 2m16s |
| queue_e2e_duration | 1m43s | 2m24s | 2m26s | 2m30s |
| queue_poll_count | 83 | 117 | 119 | 120 |

예매 단계 지표도 안정적입니다.

| 예매 지표 | avg | p90 | p95 | max |
|----------|-----|-----|-----|-----|
| seat_selection_ms | 44ms | 60ms | 80ms | 628ms |
| order_creation_ms | 84ms | 121ms | 159ms | 425ms |
| payment_ms | 120ms | 174ms | 215ms | 904ms |
| seat_conflicts | 82건 | | | |

poll_count 평균이 83이라는 것은 **5분 동안 83번 status를 호출**했다는 뜻입니다.
폴링 1초니까 약 83초 대기 후 통과한 셈입니다.

### 구현체 B — 1000VU (ALB 직접, 일괄 발급)

**결과 파일**: `queue-poc-b-20260403-142622.json`

| 지표 | 값 | 판정 |
|------|-----|------|
| ticket_success_rate | **49.40%** (376/761) | OK |
| queue_pass_rate | **100%** (391/391) | OK |
| queue_timeouts | 0건 | OK |
| http_req_failed | 1.03% (795/77119) | OK |
| signup 성공률 | 100% (1000/1000, setup 일괄) | OK |
| http_reqs | 242 req/s | |

대기열 지표 상세입니다.

| 지표 | avg | p90 | p95 | max |
|------|-----|-----|-----|-----|
| queue_enter_ms | 77ms | 128ms | 162ms | 781ms |
| queue_status_ms | 38ms | 56ms | 81ms | 1.35s |
| queue_seat_enter_ms | 87ms | 141ms | 252ms | 1.1s |
| queue_heartbeat_ms | 40ms | 58ms | 89ms | 1.23s |
| queue_wait_duration | 1m22s | 3m17s | 3m40s | 4m2s |
| queue_e2e_duration | 1m33s | 3m24s | 3m46s | 4m4s |
| queue_poll_count | 16 | 39 | 43 | 48 |

예매 단계 지표입니다.

| 예매 지표 | avg | p90 | p95 | max |
|----------|-----|-----|-----|-----|
| seat_selection_ms | 75ms | 86ms | 135ms | 1.18s |
| order_creation_ms | 98ms | 141ms | 155ms | 341ms |
| payment_ms | 176ms | 309ms | 375ms | 600ms |
| seat_conflicts | 21건 | | | |

poll_count 평균이 16입니다. 폴링 5초에 heartbeat 10초가 별도로 돌면서 **Redis 방문 횟수가 구현체 A의 1/5 수준**입니다.

### 구현체 C — 1000VU (ALB 직접, 일괄 발급)

**결과 파일**: `queue-poc-c-20260403-150032.json`

| 지표 | 값 | 판정 |
|------|-----|------|
| ticket_success_rate | **83.42%** (1082/1297) | OK |
| queue_pass_rate | **88.45%** (1180/1334) | FAIL (threshold 90%) |
| queue_timeouts | 154건 | |
| http_req_failed | 1.00% (1272/125955) | OK |
| signup 성공률 | 100% (1000/1000, setup 일괄) | OK |
| http_reqs | 384 req/s | |

대기열 지표 상세입니다.

| 지표 | avg | p90 | p95 | max |
|------|-----|-----|-----|-----|
| queue_enter_ms | 336ms | 769ms | 847ms | 1.63s |
| queue_status_ms | 57ms | 108ms | 193ms | 1.49s |
| queue_seat_enter_ms | 192ms | 595ms | 891ms | 1.87s |
| queue_wait_duration | 1m33s | 2m51s | 2m59s | 3m10s |
| queue_e2e_duration | 1m44s | 3m0s | 3m6s | 3m16s |
| queue_poll_count | 44 | 84 | 88 | 93 |
| queue_immediate_pass_rate | 4.64% | | | |

예매 단계 지표입니다.

| 예매 지표 | avg | p90 | p95 | max |
|----------|-----|-----|-----|-----|
| seat_selection_ms | 48ms | 60ms | 75ms | 1s |
| order_creation_ms | 71ms | 110ms | 147ms | 322ms |
| payment_ms | 113ms | 185ms | 240ms | 514ms |

### 구현체 C 병목 분석

세 가지 원인이 복합적으로 작용했습니다.

1. **queue_enter 336ms로 가장 느림**: JWE 토큰 발급(AES-256-GCM) + 분산 Lock 획득 오버헤드. 1000VU 동시 enter 시 Lock 경합이 누적됩니다.
2. **seat_enter 192ms**: 토큰 검증 + 상태 전이에 시간이 소요됩니다. p95 891ms로 편차가 큽니다.
3. **154건 timeout**: polling 150회 × 2초 = 5분 대기 후 만료입니다. `QUEUE_MAX_CAPACITY=100`에 1000명이 몰리면서 승격 대기 시간을 초과했습니다.

---

## 공통 이슈 (3개 구현체)

테스트 과정에서 공통으로 만난 이슈를 표로 정리했습니다.

| 이슈 | 원인 | 해결 |
|------|------|------|
| ApiSuccessResponse 역직렬화 | `@JsonCreator` 없음 | 3개 브랜치 전부 수정 완료 |
| Istio payment retry 중복 | `retryOn: 5xx + POST` | 5xx 제거 (reset, connect-failure만) |
| Cloudflare Workers HTML | `go-ti.shop/prefix → SPA` | `api.go-ti.shop/prefix`로 우회 |
| Cloudflare rate limit 초과 | Free plan 100K/day | ALB 직접 접근으로 우회 |
| Redis 잔류 데이터 | 이전 테스트 queue 키 | 테스트 전 `FLUSHDB` |
| user ImagePullBackOff | Harbor → EKS 접근 불가 | ECR 전환 완료 |
| signup 병목 (1차 테스트) | iteration별 signup + user 3 replica | `setup()` 일괄 발급으로 해결 |

각 이슈가 테스트 공정성에 어떤 영향을 미쳤는지 간단히 정리했습니다.

**signup 병목**은 1차 테스트의 결과를 완전히 왜곡시켰습니다.
iteration마다 signup을 호출하면 user 서비스 3 replica에 병목이 생겨 5%만 성공했습니다.
`setup()`에서 1000명분 토큰을 일괄 발급하는 방식으로 바꾼 뒤에야 대기열 자체의 성능이 드러났습니다.

**Cloudflare 경유**는 Free plan의 100K/day 제한에 걸려 테스트를 완주할 수 없었습니다.
ALB 직접 접근으로 우회하면서 이 제약이 사라졌습니다.

**Redis 잔류 데이터**는 이전 테스트의 queue 키가 남아 새 테스트의 상태를 오염시켰습니다.
테스트 전 `FLUSHDB`를 루틴화했습니다.

---

## 📚 배운 점

### 대기열 성능은 "폴링 간격"이 거의 전부를 결정한다

세 구현체의 언어/프레임워크/상세 알고리즘은 모두 달랐지만, 성능 차이의 본질은 **Redis 폴링 간격**이었습니다.

- 1초 폴링 = 처리량 최고 + Redis 부하 최대
- 2초 폴링 = 균형형
- 5초 폴링 + heartbeat 분리 = Redis 효율 최고

대기열 같은 상태 기반 시스템에서는 **클라이언트가 얼마나 자주 상태를 물어보는가**가 확장성의 핵심입니다.

### heartbeat와 polling을 분리하면 두 마리 토끼를 잡을 수 있다

구현체 B가 timeout 0건을 기록한 비결은 **heartbeat 10초 주기를 별도 API로 분리**한 것입니다.

- polling(5초): 순번 조회, 가벼운 조회만 수행
- heartbeat(10초): TTL 갱신, 최소 쓰기만 수행

두 관심사를 분리하면 polling 주기를 늘려 Redis 부하를 줄이면서도 TTL이 만료되지 않습니다.
polling만 있는 구현체는 주기를 늘리면 TTL이 만료되고, 주기를 줄이면 Redis가 포화됩니다.
**heartbeat 분리가 이 딜레마의 해결책**입니다.

### 처리량과 응답성은 트레이드오프다

1000VU 결과만 보면 "어느 구현체가 최고냐"는 쉽게 답할 수 없습니다.

- 사용자 체감(대기 시간 짧음)을 중시하면 구현체 A
- 대규모 확장(Redis 부하 적음)을 중시하면 구현체 B
- 균형을 원하면 구현체 C (CDN 도입 시 잠재력 有)

실제 서비스는 **대기 시간보다 전체 처리량과 안정성**을 더 중요하게 여기는 경우가 많습니다.
1000VU에서 안정적이지 않으면 3000VU 이상에서는 완전히 무너질 수 있기 때문입니다.

### `setup()` 일괄 발급이 "공정 비교"의 전제조건

이번 테스트의 1차와 2차 결과 차이는 극단적이었습니다.

- 1차 (iteration별 signup): queue_pass_rate 30%, timeouts 2435건
- 2차 (`setup()` 일괄 발급): queue_pass_rate 96%, timeouts 67건

같은 구현체, 같은 부하임에도 숫자가 이 정도로 달라집니다.
**인프라 병목(user signup)이 대기열 성능 측정을 완전히 가린 것**입니다.

부하테스트에서는 측정 대상 외의 병목을 최대한 제거해야 합니다.
`setup()` 단계에서 토큰/계정을 미리 준비하는 방식은 대기열처럼 **특정 컴포넌트의 순수 성능을 보고 싶을 때 필수**입니다.

### dev/staging 설정의 Cloudflare rate limit 함정

Cloudflare Free plan은 100K/day 제한이 있습니다.
1000VU × 수백 request × 테스트 여러 번이면 금방 초과합니다.

개발 단계의 부하테스트는 **ALB 등 origin에 직접 접근**하는 것이 정석입니다.
CDN은 운영에서 캐시 효과를 측정할 때만 경유시키고, 순수 서비스 성능 비교에서는 우회하는 것이 맞습니다.
