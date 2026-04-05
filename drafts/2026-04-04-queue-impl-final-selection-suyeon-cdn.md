---
date: 2026-04-04
category: decision
project: Goti-server / Goti-k8s
tags: [queue, cdn, cloudflare, redis, load-test, architecture]
---

# 대기열 구현체 최종 선정: suyeon (CDN 캐싱) 채택

## Context

대규모 티켓팅 서비스의 대기열 구현체를 3명(준상/수연/성전)이 각각 POC로 개발. 1000 VU + 3000 VU 부하테스트를 통해 성능 비교 후 최종 1개를 선정해야 함.

- 테스트 환경: EKS prod (10노드, Karpenter), ALB 직접 + Cloudflare CDN
- 공통 조건: QUEUE_MAX_CAPACITY=100, setup() 토큰 일괄 발급
- 테스트 일정: 2026-04-03 (ALB 직접 3개 구현체), 2026-04-04 (CDN 캐싱 suyeon)

## Issue

### Option A: junsang — Redis Sorted Set + 1초 Polling

**3000 VU 결과 (ALB 직접)**

| 항목 | 값 |
|------|-----|
| queue_pass_rate | 100% (952/952) |
| queue_timeouts | 0건 |
| queue_status avg | 2.66s |
| queue_status p95 | 7.48s |
| queue_wait avg | 2m16s |
| 처리량 (iterations/5min) | — |
| 처리량 (req/s) | 500 |
| 1K→3K status 증가율 | 24배 (비선형 포화) |

- 장점: 처리량 최고 (1K), 대기 p95 짧음 (polling 1초)
- 단점: **Redis 포화 치명적** — 3K에서 status 2.66s, validate 9.43s. 1초 polling으로 Redis 3000 req/s가 bottleneck. CDN 캐싱 불가 구조

### Option B: suyeon — JWE 토큰 + 분산 Lock + CDN 캐싱

**3000 VU 결과 (ALB 직접)**

| 항목 | 값 |
|------|-----|
| queue_pass_rate | 87.44% (1093/1250) |
| queue_timeouts | 157건 |
| queue_status avg | 926ms |
| queue_status p95 | 1.98s |
| queue_wait avg | 1m55s |
| 처리량 (iterations/5min) | 907 |
| 처리량 (req/s) | 655 |
| 1K→3K status 증가율 | 16배 |

**3000 VU 결과 (CDN 캐싱)**

| 항목 | 값 |
|------|-----|
| queue_pass_rate | 40.89% (1826/4465) * |
| queue_timeouts | 2,586건 * |
| queue_status avg | **220ms** |
| queue_status p95 | **334ms** |
| queue_wait avg | 4m22s * |
| 처리량 (iterations/5min) | **1,889** |
| 처리량 (req/s) | **1,044** |
| CDN 캐싱 | `cf-cache-status: HIT`, `max-age=1` |

> \* pass_rate/timeout 악화는 Cloudflare Free plan rate limit으로 signup 실패 연쇄. CDN 자체 성능은 status avg 4.2배 개선.

- 장점: **CDN 캐싱으로 status 4.2배 개선** (926ms → 220ms), 에러율 16배 감소 (1.26% → 0.08%), 처리량 2.1배 증가, 확장 시 origin 부하 제한적
- 단점: JWE 토큰 발급 오버헤드 (enter 느림), 분산 Lock 경합, timeout 이슈 (rate limit 해결 시 개선 예상)

### Option C: sungjeon — Redis ZSET + Heartbeat + 5초 Polling

**3000 VU 결과 (ALB 직접)**

| 항목 | 값 |
|------|-----|
| queue_pass_rate | 100% (404/404) |
| queue_timeouts | 0건 |
| queue_status avg | 158ms |
| queue_status p95 | 719ms |
| queue_wait avg | 1m17s |
| 처리량 (iterations/5min) | — |
| 처리량 (req/s) | 602 |
| 1K→3K status 증가율 | 4배 (선형 스케일) |

- 장점: **Redis 효율 최고** (1/3 부하), 안정성 최고 (timeout 0), 선형 스케일
- 단점: 처리량 낮음, CDN 캐싱 미지원 구조, 대기 p95 길음 (5초 polling)

## Action

**최종 선택: Option B — suyeon (CDN 캐싱)**

선택 근거:

1. **CDN 캐싱이 결정적 차별점**: polling 요청을 Cloudflare 엣지에서 흡수 → origin Redis 부하 대폭 감소. 3000 VU에서 status avg 220ms는 sungjeon(158ms)과 비슷한 수준이면서, origin 부하는 훨씬 적음
2. **확장성**: VU 증가 시 CDN 캐시 히트율이 높아져 origin 부하는 거의 일정. sungjeon은 선형 스케일이지만 여전히 origin 직접 부하
3. **처리량 최고**: CDN 경유 1,044 req/s, iterations/5min 1,889로 모든 구현체 중 최고
4. **에러율 최저**: http_req_failed 0.08%로 ALB 직접 대비 16배 개선
5. **timeout 이슈는 해결 가능**: Cloudflare rate limit 문제이지 구현체 문제가 아님. signup을 ALB 직접으로 분리하면 해결

트레이드오프:
- sungjeon이 안정성(timeout 0)에서는 우위지만, CDN 캐싱 없이는 대규모 확장 시 Redis가 결국 병목
- suyeon의 JWE 오버헤드는 enter 시에만 발생하고, 핵심 polling 경로는 CDN이 흡수

## Result

### 후속 작업

- [ ] suyeon 구현체를 develop 브랜치에 머지 (POC → 정식)
- [ ] signup ALB 직접 / polling CDN 분리 테스트 (rate limit 해결)
- [ ] CDN 1000 VU 테스트 (1K→3K 증가율 측정)
- [ ] Cloudflare Cache Rule 최적화 (TTL 튜닝, cache key 설정)
- [ ] POC 이미지 → 정식 이미지 전환 (QueueSecurityConfig 포함)
- [ ] 다른 POC 브랜치(junsang, sungjeon) 정리

### 제약 사항

- Cloudflare Free plan rate limit (100K req/day) → 대규모 테스트 시 ALB 직접 병행 필요
- CDN `max-age=1` → 대기열 상태 최대 1초 지연 (사용자 체감 미미)
- STRICT mTLS 환경에서 Istio jwksUri 불가 → inline JWKS 유지

## Related Files

- `docs/load-test/2026-04-03-queue-poc-1000vu.md` — 3개 구현체 비교 테스트 결과
- `docs/dev-logs/2026-04-04-istio-jwks-mismatch-cdn-jwt-401.md` — CDN 테스트 트러블슈팅
- `Goti-load-test/scenarios/queue-suyeon.js` — K6 부하테스트 스크립트
- `Goti-load-test/results/cdn-suyeon-3000vu-kimhj.json` — CDN 3K 테스트 결과
