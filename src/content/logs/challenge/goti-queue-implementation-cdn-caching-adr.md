---
title: "왜 대기열을 CDN 캐싱으로 풀었나 — POC A/B/C 비교 ADR"
excerpt: "status polling이 전체 트래픽의 70~90%를 차지하는 상황에서 origin Redis 바이패스를 위해 CDN 캐싱을 채택한 결정. 3000VU 실측에서 처리량 2.1배·status p95 1/6 개선을 확인했습니다"
category: challenge
tags:
  - go-ti
  - Queue
  - POC
  - CDN
  - Cloudflare
  - Redis
  - adr
series:
  name: "goti-queue-poc"
  order: 12
date: "2026-04-04"
---

## 한 줄 요약

> `GET /queue/status`가 전체 트래픽의 70~90%를 차지하는 구조에서, Cloudflare CDN 캐싱으로 origin Redis를 구조적으로 바이패스하기로 결정했습니다. 3000VU CDN 실측에서 status avg 220ms · p95 334ms · 처리량 1,044 req/s를 달성했습니다

---

## 배경

### 문제 정의

티켓팅 서비스는 티켓 오픈 순간에 동시 접속자 수만~수십만이 같은 초에 몰립니다. 이때 가상 대기실(Virtual Waiting Room)이 필요한데, 대기 중 사용자 대부분의 트래픽은 **"내 순번이 왔는지 묻는 status polling"** 입니다.

1000VU · 3000VU 실측에서 `GET /queue/status` 한 엔드포인트가 **전체 트래픽의 70~90%** 를 차지했습니다. polling이 Redis를 직접 두드리는 구조에서는 VU 증가에 비례해 Redis QPS가 폭증하며 origin이 병목이 됩니다.

50만 동시접속 시나리오를 Redis 단일 클러스터로 감당하려면 선형 스케일 문제를 Redis 수평 확장으로 해결해야 합니다. Cluster Slot rebalancing · Lua 스크립트 파편화 · Slot Migration 중 오류 처리 같은 구조적 복잡도가 새로 생깁니다.

### 요구사항

1. **status polling이 origin Redis에 도달하지 않아야 합니다** — polling 주기 튜닝만으로는 불충분. 구조적으로 origin을 바이패스해야 합니다
2. **"내 순번 도달" 반응성은 유지합니다** — polling 간격을 크게 늘려 체감 대기 시간이 악화되면 안 됩니다
3. **같은 클러스터에서 구현 간 공정 비교가 가능해야 합니다** — Redis DB 분리, 동일 ALB, 동일 경기 데이터
4. **멀티클라우드 대기열 경로와 호환됩니다** — Cloudflare가 이미 프론트(ADR-0005) · 라우팅(ADR-0016)에 들어가 있어 CDN 계층을 재활용할 수 있습니다
5. **1주 시연 범위 내에서 구현합니다** — Redis Cluster 재설계 · Kafka 도입 같은 무거운 대안은 시연 기간을 초과합니다

### 기존 결정의 한계

| ADR | 내용 | 한계 |
|-----|------|------|
| ADR-0014 (Redis-first ticketing) | 좌석/주문 경로의 Redis SoT 전환 | 대기열 polling 최적화는 범위 외 |
| ADR-0005 (Cloudflare CDN migration) | 정적 자산 캐싱 관점 | API 응답 캐싱은 미검토 |
| ticketing-concurrency-analysis | 좌석 경합 분석 중심 | 대기열 polling의 origin 비대칭 부하는 별도 이슈 |

기존 세 ADR 모두 대기열 polling의 origin 부하 문제를 직접 다루지 않았습니다.

---

## 🧭 선택지 비교

### 실험 설계

동일 EKS prod 클러스터에 3개 구현체를 포트 · Redis DB만 분리해 병렬 배포했습니다. K6 1000VU → 3000VU 순차 부하를 사용했으며, 경기 · 테스트 계정 · 좌석 시드를 전부 통일했습니다. Cloudflare 우회(ALB 직접)로 **origin 단일 부하 기준** 비교를 진행했습니다.

| # | 대안 | 핵심 설계 |
|---|------|----------|
| POC A | Redis 1s polling (처리량 우선) | `GET /queue/status` 1초 간격 polling, TTL 30s, heartbeat 없음 |
| POC B | Redis 5s polling + heartbeat 분리 (효율 우선) | status polling 5초, 10초 별도 heartbeat API로 TTL 갱신 |
| POC C | CDN 캐싱 + JWE 토큰 (구조적 해결) | status 응답에 `Cache-Control: max-age=N` + JWE로 사용자별 식별, Cloudflare edge에서 흡수 |

### 3000VU 핵심 지표

ALB 직접(CDN 미적용) 상태에서 origin 한계치를 측정하고, POC C는 CDN 경유 결과를 별도로 기록했습니다.

| 지표 | POC A (ALB) | POC B (ALB) | POC C (ALB) | POC C (CDN) |
|------|------------|--------------|-------------|-------------|
| `queue_status` avg | **2.66s** | 158ms | 926ms | **220ms** |
| `queue_status` p95 | 7.48s | 719ms | 1.98s | **334ms** |
| `queue_enter` avg | 9.43s | 844ms | 1.9s | — (CDN 비캐싱) |
| `http_reqs/s` | 500 | 602 | 655 | **1,044** |
| iterations 완료 | 864 | 510 | 1,180 | **1,889** |
| `http_req_failed` | 0.02% | 0.25% | 1.26% | **0.08%** |
| `queue_pass_rate` | 100% | 100% | 87.44% | 40.89% ※ |
| 추정 origin Redis req/s | ~3,000 | ~900 | ~1,500 | **수십** |

※ **POC C (CDN) `queue_pass_rate` 40.89% 주의**: CDN 성능 저하가 아니라 Cloudflare Free plan의 signup API rate limit(일 100K req)에 setup 단계가 걸려 토큰 발급 자체가 실패한 결과입니다. 실제 polling 경로(`http_req_failed 0.08%`)는 ALB 직접 대비 16배 개선됐으며, `cf-cache-status: HIT` / `max-age=1`이 응답 헤더에서 확인됐습니다. 신뢰할 지표는 polling 성능(status avg / p95 / 처리량)이며, pass_rate는 rate limit 분리 후 재측정 대상입니다.

### 1K→3K 스케일 계수

VU를 3배 늘렸을 때 status avg가 얼마나 악화됐는지를 측정했습니다.

| 지표 | POC A | POC B | POC C |
|------|-------|-------|-------|
| `queue_status` avg 악화 | **24배** (110ms→2.66s) | **4배** (38ms→158ms, 선형) | 16배 (57ms→926ms) |
| `queue_enter` avg 악화 | **64배** (148ms→9.43s) | 11배 (77ms→844ms) | 6배 (336ms→1.9s) |
| `queue_timeouts` | 67→0 | 0→0 | 154→157 |

스케일 계수는 단순 절대값보다 더 중요한 지표입니다. POC A는 3000VU에서 status가 24배 악화됐으며, 이는 비선형 Redis 포화를 의미합니다. POC B는 4배로 선형에 가깝지만 origin 직격 구조 자체는 유지됩니다. POC C는 CDN 없이는 16배 악화지만, CDN을 켜면 origin 도달 요청이 구조적으로 제한됩니다.

### 기각 사유

**POC A (Redis 1s polling) 기각**

VU 3배에 status가 24배 악화된 것은 비선형 Redis 포화입니다. 1초 polling이 Redis에 3,000 req/s를 유발하며 병목이 됩니다. 50만 VU 시나리오에서 Redis Cluster 수평 확장을 강제하게 되며, Cluster Slot rebalancing · Lua 스크립트 파편화 · Slot Migration 중 오류 처리 같은 구조적 복잡도를 신규 도입해야 합니다.

**POC B (5s polling + heartbeat) 기각**

선형 스케일과 안정성은 가장 뛰어나지만 origin 부하가 Redis QPS로 여전히 VU에 비례합니다. 500K VU × 1/5초 polling = 초당 100K req/s가 origin에 꽂힙니다. 수평 확장 없이는 한계가 분명하며, 처리량도 iterations 510으로 POC C 대비 2.3배 낮습니다.

---

## 결정

**Cloudflare CDN 캐싱 기반 대기열 (POC C) 채택**

`Cache-Control` 헤더로 `GET /queue/status` 응답을 Cloudflare edge에 캐시하고, 사용자 식별은 JWE 토큰으로 서버 상태 없이 검증합니다. polling 트래픽의 대부분을 edge에서 흡수하여 **origin Redis는 사용자 수와 무관하게 거의 일정한 부하**를 유지합니다.

### 트래픽 흐름

polling 요청이 어떤 경로로 처리되는지 단계별로 살펴보겠습니다.

1. 사용자가 매 N초마다 `GET /queue/status`를 요청합니다
2. Cloudflare CDN edge PoP에서 `Cache-Control: public, max-age=N`을 확인합니다
3. Cache Key는 `URL path + JWE sub(user_id)` 조합입니다 — 사용자별 순번 응답이므로 user 단위 분리가 필수입니다
4. **Cache HIT**: edge가 직접 응답합니다. origin 요청 0건입니다
5. **Cache MISS** (N초 경과 후 1회): origin으로 요청이 내려갑니다. origin에서 JWE verify → Redis ZRANGE(순번 조회) → 응답을 반환하고 다음 max-age N초 동안 캐시됩니다

HIT 비율이 높아질수록 origin Redis 부하는 VU 증가와 무관하게 수십 req/s 수준으로 유지됩니다. 이것이 구조적 해결의 핵심입니다.

### 핵심 기술 선택

| 항목 | 선택 | 사유 |
|------|------|------|
| CDN | Cloudflare (기존) | ADR-0005에서 이미 도메인 · Workers 구축. 추가 인프라 없음 |
| 캐시 대상 | `GET /queue/status` 만 | enter/leave/seat-enter는 상태 변경이므로 캐싱 금지 |
| 토큰 전략 | JWE (AES-256-GCM) | 서버 상태 없이 사용자 식별 + TTL 검증. 세션 저장소 불필요 |
| Cache Key | URL path + JWE sub | 사용자별 순번 응답이므로 user 단위 분리 필수 |
| TTL | 수 초 (운영 조정) | 체감 대기 반응성과 Cache Hit Rate 균형 |
| Redis 역할 | 순번 SoT 유지 | 대기열 대기 · 승격 로직은 여전히 Redis. polling만 CDN이 흡수 |
| Heartbeat | 불필요 (JWE 내 exp) | JWE 토큰 만료가 자동 정리 역할 |

### Polling과 CDN TTL의 관계

polling 주기(P초)와 CDN TTL(T초)의 관계가 Cache Hit Rate를 결정합니다.

- `P ≥ T`: 각 polling이 서로 다른 캐시를 생성 → Cache Hit 낮음
- `P < T`: 같은 캐시를 N = (T/P) 번 공유 → origin 요청이 1/N로 감소

POC 실측은 `max-age=1`로 검증됐습니다. 사용자 체감 대기 지연은 미미했으며, polling 주기에 비례해 Hit Rate가 상승합니다. 운영 튜닝은 `max-age=1`을 기준선으로 유지하면서, 체감 대기 반응성이 허용되는 범위에서 TTL을 늘려 origin 트래픽을 추가로 줄일 수 있습니다.

### 결정 규칙 (불변)

1. **status 응답에만 Cache-Control 허용** — enter / leave / seat-enter / admit에는 `Cache-Control: private, no-store`를 명시합니다. 상태 변경 API를 캐싱하면 순번 꼬임이 즉시 발생합니다
2. **Cache Key에 사용자 식별자 포함** — URL만으로 캐시하면 사용자 A의 순번이 사용자 B에게 노출됩니다. JWE `sub` claim을 Vary 또는 Worker-level key에 반영해야 합니다
3. **JWE 서명 키 회전 시 기존 토큰 무효화 경로 명시** — 회전 runbook은 `docs/runbooks/`에 별도 관리합니다
4. **Redis Cluster 전환은 별도 ADR** — CDN으로 polling은 흡수되지만, enter/seat-enter 쓰기 경로가 병목이 되면 그 시점에 별도 ADR을 작성합니다

---

## 결과

### 실측 달성 지표

CDN 캐싱 구조가 실측에서 어떤 효과를 냈는지 항목별로 확인하겠습니다.

| 지표 | ALB 직접 (기준) | CDN 캐싱 | 개선 |
|------|----------------|---------|------|
| `queue_status` avg | 926ms | **220ms** | 4.2배 |
| `queue_status` p95 | 1.98s | **334ms** | 5.9배 |
| 처리량 (`http_reqs/s`) | 655 | **1,044** | 2.1배 |
| iterations/5분 | 1,180 | **1,889** | 1.6배 |
| `http_req_failed` | 1.26% | **0.08%** | 16배 |
| origin Redis req/s | ~1,500 | **수십** | 구조적 감소 |

`max-age=1` 기준치에서 측정된 수치입니다. origin Redis 요청이 수십 req/s 수준으로 유지됐으며, `cf-cache-status: HIT`가 프록시 응답 헤더에서 확인됐습니다.

사후 검증(2026-04-14)에서 CDN + PgBouncer + Redis 캐시 합산 환경 3000VU 원샷 측정 결과, `queue_status` p95 **73ms** 지속, queue_pass_rate 100%, 총 90,415 요청(402 RPS)을 달성했습니다. 이 측정은 티켓팅 전체 파이프라인 부하테스트이며, 병목은 결제 path로 이동했습니다. 대기열 CDN 결정 자체의 정당성은 재확인됐습니다.

### 운영상 이점

**Origin 스케일 독립**: HPA가 queue pod replica를 늘려도 status polling이 origin을 치지 않으므로 과도한 auto-scale이 불필요합니다.

**멀티클라우드 친화**: Cloudflare edge 한 곳에서 캐싱되므로 AWS · GCP 어느 쪽이 origin이어도 동일 효과입니다. ADR-0016 Circuit Breaker 재연결 시에도 유리합니다.

**DDoS 내성**: Cloudflare WAF + Cache가 polling flood를 edge에서 차단합니다.

### 리스크

**Stale data**: TTL 내 순번 변경분이 사용자에게 지연 전달됩니다. 완화책은 TTL을 낮게 시작하고 Hit Rate · 체감 반응성을 관측하며 조정하는 것입니다.

**JWE 키 유출 시 전체 대기열 토큰 재발급**: 키 회전 runbook과 즉시 invalidation 절차가 필요합니다.

**Cache Key 설계 오류 시 사용자 간 순번 노출**: 초기 배포 시 `curl`로 서로 다른 JWE 토큰이 서로 다른 응답을 받는지 전수 검증해야 합니다.

**signup rate limit 취약**: POC CDN 실측에서 Cloudflare Free plan 일 100K req 한도에 setup 단계가 걸려 pass_rate가 40.89%로 하락했습니다. signup은 CDN 우회 경로로 분리하거나 Pro 플랜 한도를 재계산해야 합니다. polling 자체 성능과는 독립된 이슈입니다.

**enter/seat-enter 경로는 여전히 origin 쓰기**: polling만 흡수되므로 쓰기 경로의 Lock 경합 / JWE 발급 오버헤드는 별도 최적화가 필요합니다. 3000VU에서 POC C는 enter avg 1.9s · timeout 157건을 기록했습니다.

### 롤백 가능성

- **1단계 롤백**: `Cache-Control` 헤더를 제거하면 모든 요청이 origin 직격으로 전환됩니다. 구현체가 그대로 Redis-direct로 동작하므로 코드 변경이 없습니다
- **2단계 폴백**: POC B(5s polling + heartbeat)로 전환합니다. values 토글만으로 가능합니다(Goti-k8s Blue/Green cutover 패턴과 동일)
- **비가역 요소 없음**: CDN 설정 전부가 Cloudflare 콘솔/Worker script 수준이라 즉시 되돌릴 수 있습니다

### 비용

Cloudflare Workers / Cache는 기존 Free · Pro plan 범위 내이므로 추가 인프라 비용은 0입니다. CDN Hit Rate 향상 비율만큼 origin Redis · Pod QPS가 감소하며, **Redis Cluster 전환 회피 = 월 수백 달러 절감** 효과가 있습니다.

---

## 후속 과제

1. signup / polling 경로 분리 후 3000VU 재측정 — Cloudflare rate limit 회피 후 pass_rate 회복 확인
2. POC C 구현체의 enter/seat-enter 경합 최적화 — timeout 157건 분석 → JWE 발급 캐싱 / 분산 Lock 축소
3. Cache Key · TTL 튜닝 runbook 작성 (`docs/runbooks/queue-cdn-tuning.md`)
4. Redis Cluster 전환 트리거 조건 ADR — 언제 origin 쓰기 경로가 한계에 도달하는지
5. POC A · POC B 코드 정리 — poc 브랜치 아카이브

---

## 📚 배운 점

### polling 구조가 CDN 캐싱 가능한지 설계 단계부터 고려해야 합니다

POC A · POC B는 구조적으로 CDN 캐싱이 불가능합니다. 토큰별로 요청이 달라지고 응답이 매번 바뀌기 때문입니다.

POC C는 처음부터 `cf-cache-status: HIT`를 의도한 설계였습니다. `max-age=1`로 1초 단위 캐시를 허용하고, 대기 순서 응답은 edge가 흡수하도록 구성했습니다. 대규모 트래픽을 가정할 때 **CDN 친화적 구조로 설계하는 것이 가장 큰 레버리지**입니다.

### ALB 직접 벤치만으로 구현체를 판단하면 잘못된 결정을 내릴 수 있습니다

ALB 직접 테스트에서 POC C는 status avg 926ms · timeout 157건으로 POC B보다 뒤졌습니다. 만약 이 결과만 보고 결정했다면 POC B를 선택했을 것입니다.

그러나 실제 운영 경로는 CDN을 거칩니다. CDN 캐싱을 켜는 순간 status avg가 4.2배 개선되면서 순위가 뒤바뀌었습니다. 구현체를 비교할 때는 **실제 배포될 경로와 동일한 조건**에서 테스트해야 합니다.

### timeout 지표는 원인을 분리해서 해석해야 합니다

POC C CDN 테스트에서 timeout 2,586건과 pass_rate 40.89%가 나왔을 때 숫자만 보면 최악처럼 보입니다. 실제로는 Cloudflare Free plan rate limit에 부딪혀 signup이 막힌 결과였습니다.

구현체 내부 문제와 외부 환경 제약을 분리해야 올바른 결정이 가능합니다. 같은 테스트에서 `pass_rate` 악화와 `status avg` 개선이 공존했고, 각각의 원인이 달랐습니다.

### 1K→3K 증가율이 확장성의 핵심 지표입니다

절대값(avg, p95)만 보지 않고 **VU 증가에 따른 응답시간 증가율**을 봐야 합니다.

- POC A: 24배 (비선형 포화)
- POC B: 4배 (선형 스케일)
- POC C CDN: CDN 히트율 증가로 거의 일정

이 지표가 프로덕션에서 트래픽 폭증 시 서비스가 버틸지 판단하는 근거가 됩니다. 현재 성능이 아니라 **스케일 행동(scaling behavior)** 을 보고 선택해야 합니다.

---

## 실행 기록

| 일자 | 이벤트 |
|------|--------|
| 2026-03-29 | POC C 단독 saturation 부하 |
| 2026-04-03 | POC A/B/C 1000VU / 3000VU 비교 실측 완료 (ALB 직접, CDN 미적용) |
| 2026-04-04 | CDN 경유 3000VU 실측 — status avg 220ms / p95 334ms / 1,044 req/s / 실패율 0.08% / `cf-cache-status: HIT` 확인 |
| 2026-04-04 | POC C (CDN 캐싱) 최종 채택, 구현체 본류 병합 방향 결정 |
| 2026-04-14 | 사후 검증 — CDN + PgBouncer + Redis 캐시 합산 환경 3000VU 원샷: `queue_status` p95 73ms, pass_rate 100%, 총 90,415 요청. 병목이 결제 path로 이동함을 확인 |

---

## 🔗 관련 기술 해설

이 글에서 결정한 기술의 동작 원리는 다음 해설글에서 자세히 다룹니다.

- [CDN Edge 캐싱 — Cache-Control로 origin을 우회하는 원리](/essays/goti-deepdive-cdn-edge-caching)
- [JWE — 암호화 토큰이 서명 토큰보다 강한 이유](/essays/goti-deepdive-jwe-token)
- [CDN Cache Key 설계 — 사용자별 응답 분리 원리](/essays/goti-deepdive-cdn-cache-key)
