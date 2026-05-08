# ADR 0022 — 대기열 구현 방식 선택 (CDN 캐싱 채택, POC A/B/C 비교)

- 상태: Accepted
- 결정일: 2026-04-04
- 결정 주체: 리더 (아이디어) · 팀원 A (구현)
- 관련 ADR: `0005-cloudflare-cdn-migration.md` (CDN 전환 기반), `0016-multicloud-circuit-breaker-and-hpa.md` (라우팅 계층)
- 영향 레포: Goti-server, Goti-front, Goti-k8s, Goti-load-test
- 참고 실측:
  - `docs/load-test/2026-04-03-queue-poc-1000vu.md` (POC A/B/C 비교, ALB 직접)
  - `docs/load-test/2026-03-29-queue-member-a-saturation.md` (member-a 단독 saturation)
  - `docs/dev-logs/2026-04-04-queue-impl-final-selection-member-a-cdn.md` (CDN 경유 3000VU 실측 + 최종 선정)

---

## 컨텍스트

### 문제 정의

티켓팅 서비스는 "티켓 오픈 순간"에 동시 접속자 수만~수십만이 **같은 초**에 몰린다.
이때 가상 대기실(Virtual Waiting Room)이 필요한데, 대기 중 사용자 대부분의 트래픽은 **"내 순번이 왔는지 묻는 status polling"** 이다.

사내 1000VU·3000VU 실측에서 **`GET /queue/status` 한 엔드포인트가 전체 트래픽의 70~90% 를 차지**했고, 이 polling이 Redis를 직접 두드리는 구조에서는 VU 증가에 비례하여 Redis QPS가 폭증해 origin이 병목이 된다. 50만 동시접속(경기 시즌 피크) 시나리오를 Redis 단일 클러스터로 감당하는 것은 선형 스케일 문제를 Redis 수평 확장으로 해결해야 한다는 뜻이며, 이는 Cluster Slot rebalancing·Lua 스크립트 파편화 등 추가 복잡도를 유발한다.

### 요구사항

1. **status polling이 origin Redis에 도달하지 않아야 한다** — polling 주기를 늘리는 튜닝만으로는 불충분. 구조적으로 origin을 바이패스해야 함
2. **"내 순번 도달" 반응성은 유지** — polling 간격을 크게 늘려 체감 대기 시간이 악화되면 안 됨
3. **같은 클러스터에서 구현 간 공정 비교 가능할 것** — Redis DB 분리, 동일 ALB, 동일 경기 데이터
4. **멀티클라우드 대기열 경로와 호환** — Cloudflare가 이미 프론트(0005)·라우팅(0016)에 들어가 있음. CDN 계층을 재활용 가능
5. **1주 시연 범위** — Redis Cluster 재설계·Kafka 도입 같은 무거운 대안은 시연 기간 초과

### 기존 결정 한계

- **ADR-0014 (Redis-first ticketing)**: 좌석/주문 경로의 Redis SoT 전환만 다룸. 대기열 polling 최적화는 범위 외.
- **ADR-0005 (Cloudflare CDN migration)**: 정적 자산 캐싱 관점. API 응답 캐싱은 미검토.
- `docs/architecture/ticketing-concurrency-analysis.md`: 좌석 경합 분석 중심. 대기열 polling의 origin 비대칭 부하는 별도 이슈.

---

## 고려한 대안 (POC A/B/C 실측 비교)

**실험 설계**: 동일 EKS prod 클러스터에 3개 구현체를 포트·Redis DB만 분리해 병렬 배포, K6 1000VU → 3000VU 순차 부하. 경기·테스트 계정·좌석 시드 전부 통일. Cloudflare 우회(ALB 직접)로 **origin 단일 부하 기준** 비교.

| # | 대안 | 구현체 | 핵심 설계 | 결과 |
|---|------|-------|----------|------|
| A | **Redis 1s polling (처리량 우선)** | `member-b` | `GET /queue/status` 1초 간격 polling, TTL 30s, heartbeat 없음 | 처리량은 가장 높으나 **3000VU에서 Redis 포화** |
| B | **Redis 5s polling + heartbeat 분리 (효율 우선)** | `member-c` | status polling 5초, 10초 별도 heartbeat API로 TTL 갱신 | **Redis 부하 가장 낮음**, 선형 스케일 |
| C | **CDN 캐싱 + JWE 토큰 (구조적 해결)** | `member-a` | status 응답에 `Cache-Control: max-age=N` + JWE로 사용자별 식별, Cloudflare edge에서 흡수 | **origin 부하 구조적 제거**, 처리량 최고 |

### 3000VU 핵심 지표 (ALB 직접, CDN 미적용 상태의 origin 한계치)

| 지표 | A (member-b) | B (member-c) | C (member-a, ALB) | C (member-a, **CDN**) |
|------|------------|--------------|-----------------|---------------------|
| `queue_status` avg | **2.66s** 포화 | 158ms | 926ms | **220ms** |
| `queue_status` p95 | 7.48s | 719ms | 1.98s | **334ms** |
| `queue_enter` avg | 9.43s | 844ms | 1.9s | — (CDN 비캐싱) |
| `http_reqs/s` | 500 | 602 | 655 | **1,044** |
| `iterations` 완료 | 864 | 510 | 1180 | **1,889** |
| `http_req_failed` | 0.02% | 0.25% | 1.26% | **0.08%** |
| `queue_pass_rate` | 100% | 100% | 87.44% | 40.89% ※ |
| 추정 origin Redis req/s | ~3000 | ~900 | ~1500 | **~수십** (CDN HIT 흡수) |

※ **C (CDN) `queue_pass_rate` 40.89% 주의**: 이 수치는 CDN 성능 저하가 아니라 **Cloudflare Free plan의 signup API rate limit(일 100K req)** 에 setup 단계가 걸려 토큰 발급 자체가 실패한 결과다. 실제 polling 경로(CDN이 흡수하는 부분)는 `http_req_failed 0.08%`로 **ALB 직접 대비 16배 개선**되었고, `cf-cache-status: HIT` / `max-age=1`이 프록시 응답 헤더에서 확인되었다. 신뢰할 지표는 polling 성능(status avg / p95 / 처리량)이며 pass_rate는 rate limit 분리 후 재측정 대상이다.

### 1K→3K 스케일 계수 (VU 3배 증가 시 status avg 악화)

| 지표 | A | B | C |
|------|---|---|---|
| `queue_status` avg 악화 | **24배** (110ms→2.66s) | **4배** (38ms→158ms, 선형) | 16배 (57ms→926ms) |
| `queue_enter` avg 악화 | **64배** (148ms→9.43s) | 11배 (77ms→844ms) | 6배 (336ms→1.9s) |
| `queue_timeouts` | 67→0 | 0→0 | 154→157 |

### 기각 사유

| # | 기각 사유 |
|---|----------|
| A (1s polling) | VU 3배에 status가 24배 악화 = **비선형 Redis 포화**. 1초 polling으로 Redis 3000 req/s가 병목. 50만 규모에서 Redis Cluster 수평 확장을 강제하게 되며, 이는 Cluster Slot rebalancing / Lua 스크립트 파편화 / Slot Migration 중 오류 처리 같은 구조적 복잡도를 신규 도입한다 |
| B (5s polling + heartbeat) | 선형 스케일·안정성 최고지만 **origin 부하가 Redis QPS로 여전히 VU에 비례**. 500k VU × 1/5초 polling = 초당 100k req/s가 여전히 origin에 꽂힘. 수평 확장 없이는 한계 분명. 처리량도 iterations 510으로 최저 (C 대비 2.3배 낮음) |

---

## 결정

**Cloudflare CDN 캐싱 기반 대기열 (구현체 C — `member-a`) 채택.**

Cache-Control 헤더로 `GET /queue/status` 응답을 Cloudflare edge에 캐시하고, 사용자 식별은 JWE 토큰으로 서버 상태 없이 검증한다. polling 트래픽의 대부분을 edge에서 흡수하여, **origin Redis는 사용자 수와 무관하게 거의 일정한 부하**를 유지한다.

### 구조

```
[User polling]
  │  GET /queue/status  (매 N초)
  ▼
┌──────────────────────────────────────────────────┐
│ Cloudflare CDN (edge PoP)                        │
│   Cache-Control: public, max-age=N, s-maxage=N   │
│   Cache Key: URL + JWE sub(user_id)              │
│   ─► Cache HIT 시 origin 요청 0                 │
└──────────────────────────────────────────────────┘
  │  Cache MISS (N초 경과 후 1회)
  ▼
[Origin: goti-queue]
  ├─ JWE verify (stateless, AES-256-GCM)
  ├─ Redis ZRANGE (순번 조회)
  └─ Response (next cache까지 max-age N초 TTL)
```

### 핵심 기술 선택

| 항목 | 선택 | 사유 |
|------|------|------|
| CDN | Cloudflare (기존) | ADR-0005에서 이미 도메인·Workers 구축. 추가 인프라 없음 |
| 캐시 대상 | `GET /queue/status` 만 | enter/leave/seat-enter는 상태 변경이므로 캐싱 금지 |
| 토큰 전략 | JWE (AES-256-GCM) | 서버 상태 없이 사용자 식별 + TTL 검증. 세션 저장소 불필요 |
| Cache Key | URL path + JWE sub | 사용자별 순번 응답이므로 user 단위 분리 필수 |
| TTL | 수 초 (운영 조정) | 체감 대기 반응성과 Cache Hit Rate 균형 |
| Redis 역할 | 순번 SoT 유지 | 대기열 대기·승격 로직은 여전히 Redis. polling만 CDN이 흡수 |
| Heartbeat | 불필요 (JWE 내 exp) | JWE 토큰 만료가 자동 정리 역할 |

### 결정 규칙 (불변)

1. **status 응답에만 Cache-Control 허용** — enter / leave / seat-enter / admit에는 `Cache-Control: private, no-store` 명시. 상태 변경 API 캐싱 시 순번 꼬임 즉시 발생.
2. **Cache Key에 사용자 식별자 포함** — URL만으로 캐시하면 A 사용자의 순번이 B에게 노출. JWE `sub` claim을 Vary 또는 Worker-level key에 반영.
3. **JWE 서명 키 회전 시 기존 토큰 무효화 경로 명시** — 회전 runbook은 `docs/runbooks/` 에 별도 관리.
4. **Redis Cluster 전환은 별도 ADR** — CDN으로 polling은 흡수되지만, enter/seat-enter 쓰기 경로가 병목이 되면 Cluster 전환 필요. 그 시점에 별도 ADR.

### Polling과 CDN TTL의 관계

```
polling 주기 P초 · CDN TTL T초 일 때,
  P ≥ T  → 각 polling이 서로 다른 캐시 생성 → Cache Hit 낮음
  P < T  → 같은 캐시를 N = (T/P) 번 공유 → Origin 요청 1/N 로 감소
```

POC 실측은 `max-age=1`로 검증되었고(사용자 체감 대기 지연 미미), polling 주기와의 관계에서 Hit Rate는 polling 주기에 비례해 상승한다. 운영 튜닝은 실측값 `max-age=1`을 기준선으로 유지하며, 체감 대기 반응성이 허용되는 범위에서 T를 늘려 origin 트래픽을 추가로 줄인다.

---

## 결과

### 목표 지표 (실측 기반 갱신)

- Origin `queue/status` QPS: **사용자 수와 독립적으로 수십 req/s 수준** (POC CDN HIT 확인됨, `max-age=1` 기준)
- `queue_status` avg: **220ms** 달성 (ALB 직접 926ms 대비 4.2배 개선, `max-age=1` 기준치)
- `queue_status` p95: **334ms** 달성 (ALB 직접 1.98s 대비 6배 개선)
- 처리량: **1,044 req/s** · iterations **1,889** 달성 (ALB 직접 대비 각각 2.1배 / 1.6배)
- HTTP 실패율: **0.08%** 달성 (ALB 직접 1.26% 대비 16배 개선)
- E2E 티켓팅 성공률: rate limit 분리 후 재측정 예정 (POC 시점 signup rate limit으로 pass_rate 40.89%)

### 운영상 이점

- **Origin 스케일 독립** — HPA가 queue pod replica를 늘려도 status polling이 origin을 치지 않으므로 과도한 auto-scale 불필요
- **멀티클라우드 친화** — Cloudflare edge 한 곳에서 캐싱되므로 AWS·GCP 어느 쪽이 origin이어도 동일 효과 (0016 Circuit Breaker 재연결 시에도 유리)
- **DDoS 내성** — Cloudflare WAF + Cache가 polling flood를 edge에서 차단

### 리스크

- **Stale data** — TTL 내 순번 변경분이 사용자에게 지연 전달. 완화책: TTL을 낮게 시작하고 Hit Rate·체감 반응성 관측하며 조정
- **JWE 키 유출 시 전체 대기열 토큰 재발급** — 키 회전 runbook + 즉시 invalidation 필요
- **Cache Key 설계 오류 시 사용자 간 순번 노출** — 초기 배포 시 `curl`로 서로 다른 JWE 토큰이 서로 다른 응답을 받는지 전수 검증
- **signup rate limit 취약** — POC CDN 실측에서 Cloudflare Free plan 일 100K req 한도에 setup 단계가 걸려 pass_rate가 40.89%로 하락. signup은 CDN 우회 경로로 분리하거나 Pro 플랜 한도 재계산 필요. polling 자체 성능과는 독립 이슈
- **enter/seat-enter 경로는 여전히 origin 쓰기** — polling만 흡수되므로, 쓰기 경로의 Lock 경합 / JWE 발급 오버헤드는 별도 최적화 필요 (3000VU에서 C는 enter avg 1.9s · timeout 157건 기록)

### Reversibility

- **1단계 롤백**: Cache-Control 헤더 제거 → 모든 요청이 origin 직격. `member-a` 구현이 그대로 Redis-direct로 동작하므로 코드 변경 없음
- **2단계 폴백**: 구현체 B (`member-c` 5s polling + heartbeat) 로 전환. values 토글만으로 가능 (Goti-k8s Blue/Green cutover 패턴과 동일)
- **비가역 요소 없음** — CDN 설정은 전부 Cloudflare 콘솔/Worker script 수준이라 즉시 되돌릴 수 있음

### 비용

- Cloudflare Workers / Cache: 기존 Free·Pro plan 범위 내. 추가 인프라 비용 0
- origin Redis / Pod: CDN Hit Rate 향상 비율만큼 QPS 감소 → **Redis Cluster 전환 회피 = 월 수백 달러 절감**

---

## 후속

1. signup / polling 경로 분리 후 3000VU 재측정 (Cloudflare rate limit 회피, pass_rate 회복 확인)
2. `member-a` 구현체의 enter/seat-enter 경합 최적화 (timeout 157건 분석 → JWE 발급 캐싱 / 분산 Lock 축소)
3. Cache Key·TTL 튜닝 runbook 작성 (`docs/runbooks/queue-cdn-tuning.md`)
4. Redis Cluster 전환 트리거 조건 ADR (언제 origin 쓰기 경로가 한계에 도달하는가)
5. `A` · `B` POC 코드 정리 (`poc/fix-queue-member-b-*`, `poc/queue-member-c-loadtest` 브랜치 아카이브)

---

## 실행 기록

| 일자 | 이벤트 |
|------|--------|
| 2026-03-29 | `member-a` saturation 단독 부하 (`docs/load-test/2026-03-29-queue-member-a-saturation.md`) |
| 2026-04-03 | POC A/B/C 1000VU / 3000VU 비교 실측 완료 (ALB 직접, CDN 미적용) |
| 2026-04-04 | **CDN 경유 3000VU 실측 완료** — status avg 220ms / p95 334ms / 1,044 req/s / 실패율 0.08% / `cf-cache-status: HIT`. ALB 직접 대비 status 4.2배 · 처리량 2.1배 · 실패율 16배 개선 확인 (`docs/dev-logs/2026-04-04-queue-impl-final-selection-member-a-cdn.md`) |
| 2026-04-04 | C (CDN 캐싱) 최종 채택. 구현체 `member-a` 본류 병합 방향 |
| 2026-04-14 | **사후 검증 — CDN + PgBouncer + Redis 캐시 합산 환경에서 `queue_status` p95 73ms 지속**. 3000VU queue-oneshot 원샷 측정, queue_pass_rate 100%, 총 90,415 요청 (402 RPS) (`docs/load-test/2026-04-14-3000vu-queue-oneshot.md`). 해당 측정은 티켓팅 전체 파이프라인 부하테스트이며 병목은 결제 path로 이동함 — 대기열 CDN 결정 자체의 정당성은 재확인됨 |
| 후속 | signup rate limit 분리 후 pass_rate 재검증, 50만 VU 시나리오 추정 및 Redis Cluster 전환 트리거 별도 ADR |

### 주: 아이디어 소유권

CDN 캐싱 아이디어 자체는 리더(본인)의 설계이며, 팀원 A이 `poc/queue-waiting-member-a-cdn-optimized` 브랜치에서 구현했다. POC 선정은 이 아이디어 기반 구현체가 실제 데이터로 최적임을 확인하는 과정이었다.
