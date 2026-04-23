---
title: "KEDA Capacity Planning — 3000 VU 부하테스트에서 drop된 진짜 범인은 Stadium 조회 API"
excerpt: "KEDA threshold 산정을 위해 pod 단위 capacity를 측정했습니다. ticketing CPU 60% 수준에서 Stadium 조회 API(p95 6.8s, 5xx 10.88%)가 먼저 터지는 cascade를 확인해 KEDA threshold 확정을 유보하고 Stadium Go 전환을 우선 과제로 전환했습니다"
category: kubernetes
tags:
  - go-ti
  - KEDA
  - Karpenter
  - k6
  - LoadTest
  - Capacity-Planning
  - troubleshooting
series:
  name: "goti-scaling"
  order: 1
date: "2026-04-12"
---

## 한 줄 요약

> KEDA + Karpenter 적용 전에 pod 단위 처리 한계를 측정해 `targetAverageValue`를 산정하려 했습니다 실제 3000 VU / ticketing pod=2 부하에서 드러난 것은 ticketing 자체가 아닌 **Stadium 조회 API의 cascade 장애**였고(p95 6.8s, 5xx 10.88%), KEDA threshold 확정을 유보한 채 Stadium Go 전환을 P0로 돌렸습니다

---

## 🔥 배경: "몇 명 입장 → ticketing pod 몇 대" 산식이 없었다

팀원이 2026-04-11 수행한 부하테스트 결과가 출발점이었습니다

- 3000 VU / 1000명씩 처리 / ticketing pod 2 → 터짐
- 대기열 소비 정체 발생 → 원인 분리 필요 (pod 포화 vs 인증 병목)
- "pod 2 → 늘리기 / VU 1000 → 500 축소" 중 미결정

Capacity planning 없이는 KEDA threshold를 찍기로 정할 수밖에 없는 상황이었습니다

### 측정 목표 5가지

1. pod 1개당 안정 처리 가능한 **VU / RPS baseline** 도출
2. KEDA `targetAverageValue` (CPU%, RPS, queue length) 산정
3. pod 증가 시 **선형성** 검증 (2배 pod = 2배 처리량?)
4. **스케일아웃 소요 시간** 측정 (pod 추가 → Ready까지)
5. 큐 소비 정체 원인 분리 (consumer 포화 vs 인증 병목)

### 시나리오 매트릭스

| # | 대상 | replicas | VU ramp | 목적 |
|---|------|----------|---------|------|
| S1 | ticketing | 1 | 100→500 | 단일 pod 한계 RPS + 깨지는 VU |
| S2 | ticketing | 2 | 500→1500 | 선형성 검증 (S1 × 2 ≈ S2?) |
| S3 | ticketing | 4 | 1500→3000 | 2026-04-11 결과 재현 |
| S4 | queue consumer | 1 | enter 1000명 고정 | 순수 소비 속도 (인증 제외) |
| S5 | queue + user E2E | 1 | enter 1000명 + 인증 | 인증 오버헤드 분리 |

---

## 🤔 측정 결과: ticketing이 아니라 Stadium이 먼저 터졌다

### R1: 1500 VU / pod=2 / maxCapacity=1000 (Cloudflare 경유)

| 메트릭 | 값 |
|--------|---|
| ticket_success | 81.9% (4483/5473) |
| http_fail | 0.56% |
| payment p95 | **40.3s** 🔴 |
| seat_selection p95 | 7.31s |
| order_creation p95 | 8.58s |
| queue_wait p95 | 100s |
| e2e duration p95 | **149s (2m30s)** 🔴 |

### R2: 3000 VU / pod=2 / maxCapacity=3000 — API별 health matrix

| Endpoint | RPS | p95 | 5xx % | 판정 |
|---|---|---|---|---|
| `/stadium-seats/games/{gameId}/seat-grades` | 10.25 | **6.84s** | **10.88%** | 🔴 최악 |
| `/stadium-seats/stadiums/{stadiumId}/seat-sections` | 6.35 | 5.48s | 5.81% | 🔴 |
| `/teams/{teamId}/ticket-pricing-policies` | 5.38 | 4.41s | 2.24% | 🟠 |
| `/game-seats/{gameId}/sections/.../seat-statuses` | 1.02 | 4.78s | 3.14% | 🟠 |
| `/seat-reservations/seats/{seatId}` (hold) | 0.98 | 2.47s | 1.63% | 🟠 |
| `/orders` (create) | 0.17 | 987ms | 0% | 🟢 |

### 에러 상태코드 분포

| 상태코드 | 건수 | 주 원인 |
|---|---|---|
| 400 | 2.48K | `"예매 가능 시간이 만료되었습니다"` — Stadium 느림 → reservation session TTL 초과 (2차 피해) |
| 500 | 567 | Stadium-seats / ticket-pricing-policies 서버 오류 |
| 403 | 665 | Cloudflare DDoS 차단 (초기 k6 UA → Mozilla 위장으로 해소) |
| 409 | 20 | 좌석 경합 (정상 수준) |

### 병목 판정

**1) Stadium 서비스 조회 API가 진짜 범인**

- `seat-grades`, `seat-sections`, `ticket-pricing-policies` 전부 Stadium 서비스 소속입니다
- RPS 10 수준에서 5xx 10.88%, p95 7초 — CPU 낮은데 터졌습니다
- 원인은 **Hibernate N+1 + 동기 JOIN heavy 쿼리** 강력 추정(실측 프로파일링은 별도 필요)
- 조회 API이기 때문에 Stadium 단일 pod(`replicaCount=1`) + 인덱스 부재 가능성

**2) Queue scheduler 버그 (별건)**

- `publishedRank=0` 고착 현상 — active 3000명 고착, 뒤 4533명 무한 대기
- `released=false` 빈발 — EXPIRED user leave 시 active-users SET 미제거
- Queue 서비스 scheduler 로직 개선 필요

**3) Payment는 기능적으로 OK**

- 5xx 0%, p95만 5초 (외부 PG 동기 호출 추정)
- Go 전환 효과 낮음, 원복 순위 낮음

**4) 좌석 경합은 설계 OK**

- 409 20건만 발생 — 좌석 락·트랜잭션 설계는 문제없음

### Queue 서비스 측정 (비교용 — 문제 없음)

| Endpoint | RPS | p95 | p99 | 판정 |
|---|---|---|---|---|
| `/queue/enter` | 7.50 | 700ms | 2.48s | 🟡 acceptable |
| `/queue/{gameId}/seat-enter` | 6.13 | 720ms | 1.96s | 🟡 acceptable |
| **`/queue/{gameId}/global-status`** | **0.13** | **45ms** | 484ms | 🟢 CDN 캐싱 효과 |
| `/queue/{gameId}/leave` | 0.01 | 9ms | 21ms | 🟢 |

Queue 엔드포인트 p95 700~720ms는 Stadium 6.8s 대비 **10배 빠릅니다**
`global-status` RPS 0.13은 Cloudflare CDN 캐싱 설계 성공을 보여줍니다(polling 대부분을 edge에서 흡수)

---

## ✅ 결정: KEDA threshold 확정 유보 + Stadium Go 전환 P0

### 왜 KEDA threshold를 확정하지 못했는가

Ticketing pod CPU 60% 수준에서 주변 서비스(Stadium/session)가 먼저 터지는 **cascade**가 확인됐습니다
ticketing 단일 서비스 capacity 측정은 Stadium 개선 후 재측정해야 의미가 있습니다
따라서 이번 라운드에서 KEDA `ScaledObject` 확정 threshold 도출은 불가능했습니다

### 우선순위 재배치

| 우선순위 | 대상 | 기대 효과 |
|---------|------|----------|
| P0 | **Stadium 조회 API Go 전환** | p95 6.8s → 수백 ms 기대 (sqlc + 쿼리 최적화) |
| P1 | **ticketing Go 전환** | 기존 진행 중 (Phase 7 audit) |
| P2 | Queue scheduler `publishedRank` 버그 수정 | 단기 Java 수정 가능 |
| P3 | Payment | 외부 PG 의존 — 유지 |

### Java → Go 전환 체크리스트 (P0 Stadium 대상)

Java에서 드러난 문제들을 Go에서 반복하지 않도록 검증 항목을 정리했습니다

**DB 레이어**

| Java 문제 | Go에서 검증할 것 |
|-----------|----------------|
| Hibernate lazy loading → N+1 쿼리 | sqlc/pgx 사용 시 **1쿼리 JOIN** 또는 `ANY($1::uuid[])` IN clause batching |
| Eager fetching으로 인한 과도한 JOIN | 필요한 컬럼만 SELECT, `SELECT *` 금지 |
| 인덱스 부재 (JOIN on FK 느림) | Goose migration 리뷰 — `game_id`, `stadium_id`, `section_id` FK 인덱스 확인 |

**서비스 간 호출**

| Java 문제 | Go에서 검증할 것 |
|-----------|----------------|
| 동기 REST 체인 누적 latency | gRPC + deadline propagation |
| Istio sidecar mTLS overhead(~10ms/hop) 누적 | 서비스 체인 짧게, Istio gRPC 네이티브 경로 |
| 외부 PG 동기 호출(payment p95 5초) | goroutine + `context.WithTimeout`, retry with backoff |

**분산 락·동시성**

| Java 문제 | Go에서 검증할 것 |
|-----------|----------------|
| Redis 분산 락 경합 (queue enter p99 2.5s 추정) | Redis Lua script로 atomic CAS, 단일 노드 SET NX PX |
| `QueueLeaveService` `released=false` 케이스 | Leave 시 상태 기반 idempotent 처리 |
| Scheduler `publishedRank` 업데이트 지연 | Event-driven 전환 고려, 주기 단축(30s → 5s) |

**리소스·관측성**

| Java 문제 | Go에서 검증할 것 |
|-----------|----------------|
| HikariCP pool 포화로 500 error | pgx pool size = `min(DB_MAX_CONNECTIONS, 2 × CPU_LIMIT_CORES + diskCount)` |
| 리소스 limit 1 core로 스로틀링 | Go는 GOMAXPROCS 설정 필수(`automaxprocs` 라이브러리) |
| OTel Java agent webhook inject 누락 | Go는 SDK 직접 embed → inject 의존 없음 |
| Spring startup 77초로 liveness probe SIGTERM | Go는 보통 &lt;2초 기동, 그래도 `startupProbe` 안전망 |

### 검증 기준 (Go 구현 후 동일 조건 재부하테스트)

동일 경기, 동일 `maxCapacity=3000`, 동일 3000 VU 조건에서 목표치는 다음과 같습니다

- Stadium 조회 API **p95 < 500ms** (Java 6.8s 대비 13× 개선)
- Queue `enter`·`seat-enter` **p95 < 300ms** (Java 700ms 대비 2× 개선)
- e2e 성공 1건 **< 10초** (Java 149s 대비 15× 개선)
- 5xx **< 0.1%** (Java 10.88% 대비 100× 개선)

---

## 📚 배운 점

- **pod capacity 측정은 주변 서비스 cascade 이전에는 의미가 없습니다** ticketing pod 2개 한계를 측정하려 했는데 Stadium이 먼저 터져 ticketing 자체 수치를 얻지 못했습니다 주변 서비스의 baseline을 먼저 확보해야 capacity planning이 가능합니다
- **"CPU 사용량 낮은데 5xx 10%"는 쿼리 문제의 고전적 증상입니다** RPS 10 수준인데 p95 7초 + 5xx 10%라면 CPU·메모리가 아니라 DB·lock·외부 호출의 문제일 가능성이 높습니다
- **k6 기본 UA가 Cloudflare DDoS ruleset에 차단됩니다** `k6/0.56.0`이 "known bad user agent"로 분류되어 403이 섞였습니다 Mozilla UA로 위장이 필수입니다
- **r7g.xlarge 32GB 단일 EC2는 3000 VU가 안정 한계입니다** 5000 VU에서 OOM + EC2 reboot이 발생했습니다
- **OTel Java agent inject 누락이 빈번합니다** ticketing/payment/Stadium 등 일부 pod에 agent가 주입되지 않아 전체 rollout restart 후에야 메트릭 수집이 정상화됐습니다 Go 전환 시 SDK 직접 embed로 근본 해결됩니다

---

## 후속 과제

- [ ] Stadium Go 전환 (Phase 7 이후 우선순위로)
- [ ] Queue scheduler `publishedRank` 업데이트 로직 검증 (`released=false` 케이스)
- [ ] r7g.xlarge 단일 EC2 5000 VU OOM 조건 문서화
- [ ] Cloudflare DDoS L7 Ruleset 우회 영구 적용 (UA + WAF skip rule)
- [ ] Queue `maxCapacity=3000` 실운영 반영 여부 결정 (현재 테스트용 확대 상태)
