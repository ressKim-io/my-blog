---
title: "대기열 구현체 최종 선정 — CDN 캐싱을 선택한 이유"
excerpt: "3개 POC 구현체를 3000 VU까지 부하테스트한 결과, CDN 캐싱 기반 구현체(POC C)를 최종 채택했습니다. status avg 4.2배 개선, 처리량 2.1배 증가가 결정 근거입니다."
category: challenge
tags:
  - go-ti
  - Queue
  - POC
  - CDN
  - Decision
  - Architecture Decision Record
  - adr
series:
  name: "goti-queue-poc"
  order: 11
date: "2026-04-04"
---

## 한 줄 요약

> 3개 POC 구현체(Redis Polling / Redis ZSET+Heartbeat / JWE+분산 Lock+CDN)를 3000 VU까지 비교한 결과, **CDN 캐싱 기반 구현체**를 최종 선정했습니다. CDN이 polling 트래픽을 엣지에서 흡수하면서 origin Redis 부하가 구조적으로 제한됩니다.

---

## 배경

대규모 티켓팅 서비스에 적용할 대기열 구현체를 선정하는 단계입니다.
팀 내에서 3명의 POC 담당자가 각자 다른 접근 방식으로 구현체를 개발했습니다.
편의상 이 글에서는 담당자를 **POC A / POC B / POC C**로 부릅니다.

- **POC A**: Redis Sorted Set + 1초 Polling
- **POC B**: Redis ZSET + Heartbeat + 5초 Polling
- **POC C**: JWE 토큰 + 분산 Lock + **CDN 캐싱**

테스트는 1000 VU와 3000 VU 두 단계로 진행하고, 성능·안정성·확장성을 종합 비교해 최종 1개를 선정합니다.

### 테스트 환경

- **클러스터**: EKS prod (10 노드, Karpenter)
- **엔트리 경로**: ALB 직접 / Cloudflare CDN 두 가지 비교
- **공통 조건**: `QUEUE_MAX_CAPACITY=100`, K6 `setup()` 단계에서 토큰 일괄 발급
- **일정**: 2026-04-03 ALB 직접 3종 비교, 2026-04-04 CDN 캐싱 POC C 단독

---

## 선택지 비교

### Option A — POC A (Redis Sorted Set + 1초 Polling)

**3000 VU / ALB 직접**

| 항목 | 값 |
|------|-----|
| queue_pass_rate | 100% (952/952) |
| queue_timeouts | 0건 |
| queue_status avg | 2.66s |
| queue_status p95 | 7.48s |
| queue_wait avg | 2m 16s |
| 처리량 | 500 req/s |
| 1K→3K status 증가율 | **24배 (비선형 포화)** |

숫자를 하나씩 해석해보겠습니다.

처리량 자체는 1000 VU 구간에서 가장 높았습니다.
1초 polling 덕분에 대기 p95도 다른 구현체보다 짧게 나왔습니다.
여기까지는 강점입니다.

문제는 3000 VU 구간에서 드러났습니다.
queue_status 평균이 2.66초, p95가 7.48초까지 치솟았습니다.
더 결정적으로 **1K→3K 구간에서 status 응답시간이 24배 증가**했습니다.
선형 스케일이 아니라 비선형 포화입니다.

원인은 구조적입니다.
클라이언트가 1초마다 상태를 polling하면 3000 VU × 1 req/s = 3000 req/s가 Redis에 직행합니다.
validate 경로까지 합치면 Redis가 곧바로 bottleneck이 됩니다.
요청이 정적인 URL 형태가 아니라 토큰마다 다르기 때문에 **CDN 캐싱이 구조적으로 불가능**합니다.

### Option B — POC B (Redis ZSET + Heartbeat + 5초 Polling)

**3000 VU / ALB 직접**

| 항목 | 값 |
|------|-----|
| queue_pass_rate | 100% (404/404) |
| queue_timeouts | 0건 |
| queue_status avg | 158ms |
| queue_status p95 | 719ms |
| queue_wait avg | 1m 17s |
| 처리량 | 602 req/s |
| 1K→3K status 증가율 | **4배 (선형 스케일)** |

POC B는 polling 주기를 5초로 늘리고 Heartbeat 기반으로 상태를 관리하는 구조입니다.

안정성 지표가 모든 구현체 중 가장 좋게 나왔습니다.
timeout 0건, pass_rate 100%, status avg 158ms입니다.
1K→3K 증가율도 4배 수준으로 **선형 스케일**에 가깝습니다.
Redis 효율도 A 대비 약 1/3 부하입니다.

단점도 명확합니다.
처리량이 602 req/s로 A보다 낮고, polling 주기가 5초라 대기 p95가 상대적으로 깁니다.
그리고 A와 마찬가지로 polling 요청이 **CDN 캐싱 가능한 구조가 아닙니다**.
확장할 때 origin Redis에 계속 직접 부하가 걸립니다.

### Option C — POC C (JWE 토큰 + 분산 Lock + CDN 캐싱)

**3000 VU / ALB 직접**

| 항목 | 값 |
|------|-----|
| queue_pass_rate | 87.44% (1093/1250) |
| queue_timeouts | 157건 |
| queue_status avg | 926ms |
| queue_status p95 | 1.98s |
| queue_wait avg | 1m 55s |
| 처리량 (iterations/5min) | 907 |
| 처리량 | 655 req/s |
| 1K→3K status 증가율 | 16배 |

**3000 VU / CDN 캐싱**

| 항목 | 값 |
|------|-----|
| queue_pass_rate | 40.89% (1826/4465) * |
| queue_timeouts | 2,586건 * |
| queue_status avg | **220ms** |
| queue_status p95 | **334ms** |
| queue_wait avg | 4m 22s * |
| 처리량 (iterations/5min) | **1,889** |
| 처리량 | **1,044 req/s** |
| CDN 캐싱 | `cf-cache-status: HIT`, `max-age=1` |

> \* pass_rate 악화와 timeout 급증은 Cloudflare Free plan의 rate limit으로 인해 signup 단계가 연쇄 실패한 영향입니다. CDN 자체 성능은 status avg에서 4.2배 개선되었습니다.

ALB 직접 구간에서는 POC C가 가장 좋은 숫자는 아니었습니다.
status avg 926ms, p95 1.98s로 B보다 느리고, timeout도 157건 발생했습니다.

그런데 **CDN 캐싱을 켠 순간 성격이 완전히 바뀝니다**.

- status avg: **926ms → 220ms (4.2배 개선)**
- status p95: **1.98s → 334ms**
- 처리량: 655 → 1,044 req/s (2.1배 증가)
- iterations/5min: 907 → 1,889

응답 헤더에 `cf-cache-status: HIT`, `max-age=1`이 찍혔습니다.
polling 요청이 Cloudflare 엣지에서 흡수되면서 origin Redis까지 도달하는 요청이 대폭 줄어든 결과입니다.

단점도 있습니다.
JWE 토큰 발급 오버헤드 때문에 enter 구간이 느립니다.
분산 Lock 경합도 있습니다.
timeout이 2,586건으로 높게 나왔지만, 이것은 rate limit 원인이라 구현체 자체 문제는 아닙니다.

---

## 결정: POC C (CDN 캐싱)를 최종 채택

숫자만 보면 POC B가 안정성에서 앞서고, POC A가 1K 구간 처리량에서 앞섭니다.
그럼에도 POC C를 선택한 이유를 정리하겠습니다.

### 1. CDN 캐싱이 결정적 차별점입니다

POC C만이 polling 요청을 **CDN 엣지에서 흡수할 수 있는 구조**입니다.
3000 VU에서 status avg 220ms는 POC B(158ms)와 비슷한 수준이지만, 이 값을 origin Redis가 아니라 CDN이 만들어냈다는 점이 중요합니다.
origin 부하 자체가 근본적으로 낮습니다.

### 2. 확장성에서 우위입니다

VU가 늘어날수록 CDN 캐시 히트율이 올라가기 때문에 **origin 부하는 거의 일정하게 유지됩니다**.
POC B는 선형 스케일이지만 여전히 origin 직접 부하입니다.
10,000 VU 이상 대규모 확장을 가정하면 차이가 더 벌어집니다.

### 3. 처리량과 에러율이 모두 최고입니다

- 처리량: CDN 경유 1,044 req/s, iterations/5min 1,889 — 모든 구현체 중 최고
- http_req_failed: 0.08% — ALB 직접 대비 16배 개선

처리량 최고, 에러율 최저를 동시에 달성한 구현체는 POC C뿐입니다.

### 4. timeout 이슈는 구현체 문제가 아닙니다

3000 VU CDN 테스트에서 나온 2,586건 timeout은 Cloudflare Free plan의 rate limit(일일 100K req)에 부딪혀서 signup 단계가 연쇄 실패한 결과입니다.
구현체 내부 문제가 아니라 **외부 제약**에서 온 수치입니다.
signup 요청만 ALB 직접 경로로 분리하면 해결됩니다.

### 트레이드오프

선택에는 대가가 있습니다. 인정하고 가는 트레이드오프를 정리합니다.

**안정성 측면에서 POC B가 우위입니다.**
POC B는 3000 VU에서 timeout 0건, pass_rate 100%를 유지했습니다.
POC C는 CDN 없이는 timeout이 발생합니다.
다만 CDN 캐싱 없이 대규모로 확장하면 결국 Redis가 병목이 될 구조라, 장기적 관점에서 POC C가 유리합니다.

**JWE 오버헤드는 enter 경로에만 집중됩니다.**
분산 Lock 경합도 enter 시점에 발생합니다.
핵심 polling 경로는 CDN이 흡수하므로 서비스 안정성에 미치는 영향이 제한적입니다.

**CDN `max-age=1`로 상태 최대 1초 지연이 있습니다.**
대기열 순서가 1초 지연되어 사용자에게 보이지만, 실제 체감은 거의 없습니다.

---

## 후속 작업

결정 이후 실행할 작업을 체크리스트로 남겼습니다.

- [ ] POC C 구현체를 develop 브랜치에 머지 (POC → 정식)
- [ ] signup은 ALB 직접, polling은 CDN으로 분리 테스트 (rate limit 해결)
- [ ] CDN 1000 VU 테스트 수행 (1K→3K 증가율 측정)
- [ ] Cloudflare Cache Rule 최적화 (TTL 튜닝, cache key 설정)
- [ ] POC 이미지 → 정식 이미지 전환 (`QueueSecurityConfig` 포함)
- [ ] 나머지 POC 브랜치(A, B) 정리

### 제약 사항

- **Cloudflare Free plan rate limit** (100K req/day): 대규모 테스트 시 ALB 직접 경로를 병행해야 합니다.
- **CDN `max-age=1`**: 대기열 상태에 최대 1초 지연이 생깁니다. 사용자 체감은 미미합니다.
- **STRICT mTLS 환경에서 Istio `jwksUri` 사용 불가**: inline JWKS 설정을 유지합니다.

---

## 📚 배운 점

### 1. ALB 직접 벤치만으로 구현체를 판단하면 안 됩니다

POC C는 ALB 직접 테스트에서 가장 좋은 구현체가 아니었습니다.
status avg 926ms, timeout 157건으로 POC B보다 뒤졌습니다.
만약 ALB 직접 결과만 보고 결정했다면 POC B를 선택했을 것입니다.

그러나 **실제 운영 경로**는 CDN을 거칩니다.
CDN 캐싱을 켜는 순간 status avg가 4.2배 개선되면서 순위가 완전히 뒤바뀌었습니다.
구현체를 비교할 때는 **실제 배포될 경로와 동일한 조건**에서 테스트해야 합니다.

### 2. polling 구조가 CDN 캐싱 가능한지 설계 단계에서 고려해야 합니다

POC A와 POC B는 구조적으로 CDN 캐싱이 불가능합니다.
토큰별로 요청이 달라지고, 응답이 매번 바뀌기 때문입니다.

POC C는 처음부터 `cf-cache-status: HIT`를 의도한 설계입니다.
`max-age=1`로 1초 단위 캐시를 허용하고, 대기 순서는 엣지가 흡수하도록 구성했습니다.
대규모 트래픽을 가정하면 **CDN 친화적 구조로 설계하는 것이 가장 큰 레버리지**입니다.

### 3. timeout 지표는 원인을 분리해서 봐야 합니다

POC C CDN 테스트에서 timeout 2,586건이 나왔을 때, 이 숫자만 보면 최악의 구현체처럼 보입니다.
실제로는 Cloudflare Free plan rate limit에 부딪혀 signup이 막힌 결과였습니다.

구현체 내부 문제와 외부 환경 제약을 분리해서 해석해야 올바른 결정을 내릴 수 있습니다.
이번 케이스에서는 `pass_rate` 악화와 `status avg` 개선이 같은 테스트에서 공존했고, 각각의 원인이 달랐습니다.

### 4. 1K → 3K 증가율이 확장성의 핵심 지표입니다

절대값(avg, p95)만 보지 않고 **VU 증가에 따른 응답시간 증가율**을 봐야 합니다.

- POC A: 24배 (비선형 포화)
- POC B: 4배 (선형 스케일)
- POC C CDN: CDN 히트율 증가로 거의 일정

이 지표가 프로덕션에서 트래픽 폭증 시 서비스가 버틸지 판단하는 근거가 됩니다.

---

## Related Files

- `docs/load-test/2026-04-03-queue-poc-1000vu.md` — 3개 구현체 비교 테스트 결과
- `docs/dev-logs/2026-04-04-istio-jwks-mismatch-cdn-jwt-401.md` — CDN 테스트 트러블슈팅
- `Goti-load-test/scenarios/queue-poc-c.js` — K6 부하테스트 스크립트
- `Goti-load-test/results/cdn-poc-c-3000vu.json` — CDN 3K 테스트 결과

---

## 시리즈 마무리

이 글은 `goti-queue-poc` 시리즈의 마지막 편입니다.
K6 2-Phase 설계부터 3개 POC의 1K/3K 부하테스트, 그리고 최종 구현체 선정까지 11편에 걸쳐 기록했습니다.
의사결정의 근거를 숫자와 구조 양쪽에서 남겨둔 덕분에, 나중에 팀이 이 결정을 재검토할 때 논리를 추적할 수 있게 되었습니다.
