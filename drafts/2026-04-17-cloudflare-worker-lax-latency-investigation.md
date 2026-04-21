# 2026-04-17 — Cloudflare Worker LAX PoP 라우팅 → API 900ms+ 트러블슈팅

## TL;DR

- Redis SoT D1 배포 완료 직후 프론트 `/seat-statuses` 여전히 **766~1170ms** 관측
- 백엔드 pod 내부 실제 latency 는 **6~70ms, 평균 20ms** — 서버 측 문제 아님
- 응답 헤더 `cf-ray: ...-LAX` + `x-envoy-upstream-service-time: 32` 로 **Cloudflare Worker 가 LAX(Los Angeles) PoP 에서 실행 + Seoul origin 까지 태평양 왕복** 확인
- Cloudflare 공식 조사: **한국 ISP (KT/LGU+) 의 CF peering 사정으로 한국 사용자 요청이 LAX/FUK PoP 로 라우팅되는 이슈** 가 2025 년까지 지속 보고됨 (GitHub cdnjs/issues/3395, CF community)
- 해결: **Cloudflare Workers Smart Placement (Seoul origin 인식 → Worker 를 APAC PoP 에서 실행)** + 2026-01 신규 `Placement Hints = "apac"` 적용. 공식 사례 기준 p50 4~8× 개선 (20~30ms → 1~3ms RTT)
- 장기: **CF Load Balancing (geo-steering addon)** 이관. 팀코드 A/B 로직만 Worker 에 남기고 GSLB 책임은 관리형 LB 에 이관

## 1. 문제 현상

### 1.1 D1 (seat-statuses Redis SoT) 배포 후 프론트 측정

```
seat-statuses  200  13.1 kB   979 ms
seat-statuses  200  13.0 kB  1170 ms
seat-statuses  200  12.5 kB   766 ms
seat-statuses  200  12.0 kB   965 ms
seat-statuses  200  11.8 kB  1170 ms
seat-statuses  200  11.3 kB  1010 ms
... (21 건 동시 요청)
```

응답 크기 증가 (3.7KB → 13KB) 는 정상 동작 (lazy build 후 모든 seat status 가 명시 "AVAILABLE" 로 serialize, 이전 PG LEFT JOIN 은 miss 좌석이 빈 string 이었음).

문제는 **레이턴시가 D1 배포 이전과 동일 수준** 이라는 점. 기대 효과 (~5~20ms) 의 40~50× 수준에 머묾.

### 1.2 사용자 의문

- "cloudflare 에서 왔다갔다 하는 문제는 없어?"
- "이거 단일로 켰을때보다 그냥 느린데"

합리적 의심. 증거 수집 착수.

## 2. 증거 수집

### 2.1 Pod 내부 실제 latency (결정적)

Goti-go ticketing pod 의 HTTP middleware 로그:

```
latency_ms: 62, 60, 69, 7, 8, 10, 15, 6, 28, 28, 31, 31, 31, 37, 9, 7, 27, 37, 8, 10
→ 평균 20ms, 최대 70ms (첫 3건은 lazy build 포함)
```

**백엔드 자체는 깨끗함**. D1 효과 (HGETALL 1 RTT) 완전히 작동 중.

### 2.2 응답 헤더 (사용자 공유)

```
x-envoy-upstream-service-time: 32        # Istio envoy→app pod 32ms
x-goti-route-assigned:          aws       # 팀코드 SS(삼성) = AWS 매핑
x-goti-route-circuit:           open      # Circuit 이미 open (AWS 미응답 인식됨)
x-goti-route-origin:            https://gcp-api.go-ti.shop   # GCP 직행 (failover 아님)
x-goti-route-team:              SS
cf-ray:                         9edb5f933b80db7e-LAX   # PoP = LAX (!)
content-encoding:               br
```

### 2.3 수학적 분해

```
프론트 측정:  966ms
백엔드 실제:   32ms (x-envoy-upstream-service-time)
            ────
네트워크:    934ms 이 설명되지 않음
```

### 2.4 speed.cloudflare.com 대조 실험

사용자가 `speed.cloudflare.com` 실행 → raw 결과:
- download 100KB: 25~40ms latency
- download 1MB: 27~38ms latency

**speed test 는 Worker 미경유 CF 직접 서비스 → 한국 PoP (ICN 추정) 에서 정상 응답**. 즉 CF 네트워크 자체 / 사용자 회선은 정상.

**Worker 경로 (`go-ti.shop/api/*`) 만 LAX 라우팅됨**.

## 3. 원인 분석

### 3.1 가설 매트릭스

| 가설 | 증거 | 결론 |
|---|---|---|
| A. AWS circuit breaker 실패로 매 요청 1.5s timeout 후 failover | `x-goti-route-circuit: open` 이미 open. failover 지연 없음 | ❌ 기각 |
| B. Redis HGETALL 지연 | pod 내부 latency 20ms 로 빠름 | ❌ 기각 |
| C. PG lazy build 반복 (flag 미적용) | 뒤쪽 요청 6~10ms (cache hit) | ❌ 기각 |
| D. Pod / Istio / GKE 내부 병목 | upstream_service_time 32ms 로 빠름 | ❌ 기각 |
| **E. Cloudflare Worker 가 LAX 에서 실행, Seoul origin 왕복** | cf-ray -LAX, speed test 는 한국 PoP 정상 | ✅ **확정** |

### 3.2 경로 분해

현재 요청 경로 (추정):

```
한국 사용자 브라우저
    ↓ (정상이면 ~20ms, ICN PoP)
    ↓ (실제 라우팅) 200~300ms
Cloudflare LAX PoP
    ↓ Worker 실행 (circuit check, header parse)
    ↓ fetch('gcp-api.go-ti.shop') - LAX → Seoul
    ↓ 태평양 왕복 150~250ms
GCP Cloud Load Balancer (Seoul)
    ↓ Istio Ingress Gateway
    ↓ Ticketing pod (32ms 실제 처리)
    ↑ 역순 반환
    ↑ Seoul → LAX 150~250ms
    ↑ LAX → 한국 200~300ms
```

**누적 네트워크 오버헤드 ~700~1100ms.** 실측 934ms 와 일치.

### 3.3 왜 LAX 로 라우팅되는가

Cloudflare Anycast 는 통상 사용자 IP 기준 최근접 PoP 를 반환한다. 한국 사용자 → ICN PoP 가 정상. 그러나 외부 조사 (GitHub cdnjs/cdnjs#3395, CF community "Smart Placement not smart enough", LowEndTalk "Cloudflare TTFB Asia") 결과:

- **한국 ISP (KT, LGU+) 의 Cloudflare peering 용량 / 비용 협상 사정** 으로 특정 zone / workload 요청이 ICN 이 아닌 LAX / FUK / NRT 로 빠짐
- 2025 년까지 지속적으로 보고되는 이슈
- Free/Pro plan zone 은 Enterprise 대비 trans-pacific 라우팅 빈도 높음 (보고 빈도 기준, 공식 확인 불가)
- Worker 실행 PoP 는 **사용자가 처음 진입한 PoP 와 동일** 하므로 DNS 라우팅 이슈가 Worker 실행 위치까지 전염됨

speed.cloudflare.com 이 ICN 에 붙는 이유는 해당 zone 의 routing policy 가 다르거나, 비즈니스급 backbone 우선 경로를 쓰기 때문 (공식 확인 불가, 관측 기반 추정).

## 4. 외부 조사 결과 — Multi-cloud 실무 패턴

### 4.1 Cloudflare Workers Smart Placement

- **공식 사례**: Sydney → Frankfurt DB 시나리오 RTT **20~30ms → 1~3ms**, **4~8× 개선**
- 동작: Worker 를 **backend origin 에 가까운 PoP 로 자동 이전** 하여 fetch() 왕복 최소화
- 2025-03 **stable** 전환
- 2026-01 **Placement Hints** (`"apac"`, `"wnam"`, `"enam"`, `"weur"`, `"eeur"`) 추가 — 명시적 region 지정 가능
- 제약:
  - fetch handler 만 대상 (RPC / static asset 제외)
  - "multiple locations 의 지속 트래픽" 확보 후 결정 (초기 `INSUFFICIENT_INVOCATIONS` 표시)
  - backend 가 geo-distributed 면 자동 비활성
  - 1% 미만 케이스에서 오히려 느려져 롤백

**우리 케이스 (LAX 에서 실행 / backend ap-northeast3 단일 리전) 에 정확히 일치하는 use case**.

### 4.2 Multi-cloud 라우팅 패턴 비교

| 패턴 | latency 특성 | 비용 | 운영 복잡도 |
|---|---|---|---|
| **CF Load Balancing (GSLB)** | edge 즉시 steering, DNS TTL 영향 없음 | $5~60/mo (geo-steering addon 포함) | 낮음, Cloudflare 가 health/failover 관리 |
| **Route 53 + Cloud DNS** | DNS TTL (30~60s) 만큼 failover 지연 | 저렴 | 2-provider 병행 시 health 공유 불가 |
| **Anycast IP (Spectrum / NS1)** | BGP 최근접, L4 | Enterprise | 과잉, L7 로직 제한 |
| **Istio multi-primary** | east-west gateway 경유, mesh 내부 mTLS | 인프라 비용 | 컨트롤플레인 2벌 운영 부담 |
| **API Gateway (AWS/Kong)** | 리전 내 TLS 종료 | 저렴 | GW 자체가 단일 cloud 종속 |

**실무 정석: 외부 GSLB (CF LB or Route53) + 내부 Istio multi-primary 조합**.

### 4.3 Active-Active vs Active-Passive

- **Netflix**: Full active-active 3 AWS regions. "no primary region" 원칙. Chaos Kong 으로 region evacuation 훈련. 단 Netflix 는 단일 클라우드 내 multi-region
- **Airbnb (2025)**: Istio multi-cluster 중심 대규모 업그레이드
- **공통 교훈**: active-active 의 bottleneck 은 data layer (DB 양방향 복제, 세션 호환성). 우리의 pglogical + JWT 통일 (ADR-0015) 은 올바른 방향

### 4.4 CF Worker 커스텀 vs CF Load Balancing

| 항목 | CF Worker 커스텀 (현재) | CF Load Balancing |
|---|---|---|
| 비용 | Workers $5/mo + 요청당 | LB $5~60/mo |
| 유연성 | 팀코드/헤더 자유 로직 | 정책 기반 (geo/weighted/dynamic) |
| 운영 부담 | JS 디버깅, CB 직접 구현 | Cloudflare 관리 |
| **latency** | **Smart Placement 미설정 시 LAX 등 엉뚱한 PoP 실행** | edge 에서 즉시 proxy, 추가 hop 없음 |
| 팀 규모 | 10+ 엔지니어 필요 | 소규모 팀에 적합 |

우리 현상 (LAX 실행, 900ms+) 은 **Worker 에 Smart Placement 를 안 쓴 결과** 와 정확히 일치.

## 5. 해결 옵션

### Option A (즉시, 최소 수정) — Smart Placement 활성화

- Cloudflare Dashboard → Workers & Pages → `goti-prod-proxy` → Settings → Placement → **Smart**
- 2026-01 신규 기능: `wrangler.toml` 에 `[placement] mode = "smart"; hint = "apac"` 로 명시적 APAC region 힌트
- 예상: 900ms → **200~300ms** (공식 4~8× 개선 사례 기준, trans-pacific RTT 제거)
- 위험: **낮음**. 1% 미만 케이스에서 오히려 느려지면 자동 롤백
- 배포: Dashboard 토글 1분 또는 `wrangler deploy` 10분

### Option B (중기, 코드 축소) — AWS 라우팅 로직 제거

1주 시연 + AWS cost freeze 전제이므로 Worker 가 수행하는 팀코드→AWS 매핑 자체가 무의미:

```js
// multicloud-router.worker.js
const TEAM_ROUTING = {
  SS: 'gcp', KIA: 'gcp', LG: 'gcp', HH: 'gcp', SSG: 'gcp',   // 원래 AWS
  DO: 'gcp', NC: 'gcp', KT: 'gcp', LOT: 'gcp', KIW: 'gcp',    // 원래 GCP
};
// + circuit check / fetch 1회 / fanout 유지
```

- Worker 실행 시간 수 ms 단축. 하지만 **실행 PoP 가 LAX 이면 근본 개선 제한적** — Option A 와 병행해야 의미
- `wrangler deploy` 필요

### Option C (장기, 정석) — CF Load Balancing 으로 이관

- Workers Routes 해제
- Cloudflare Load Balancing Pro + Geo-steering addon 활성
- Origin pool: AWS + GCP, Monitor Groups (2025-08 신기능) 로 health check
- APAC 사용자 → GCP Seoul, 그 외 → AWS (재기동 후) 또는 fallback
- Worker 는 **팀코드 A/B 테스트 로직만** LB 뒤에 유지 (필요 시)
- 비용 ~$60/mo, 운영 부담 Cloudflare 로 이관
- 재배포 / 테스트 / DNS 변경 **1~2 일 작업**. **1주 시연 범위에서는 과함**

### Option D (시연 전용 workaround) — 프론트 base URL 직접 변경

`axios.create({ baseURL: 'https://gcp-api.go-ti.shop/api' })` + 팀코드 prefix 제거

- Worker 완전 우회
- gcp-api.go-ti.shop 가 CF Proxy (orange cloud) 라면 동일 LAX 이슈 재현 가능성, DNS-only (grey cloud) 라면 GCP LB 직행 → 100~150ms
- Goti-front 재배포 필요 (15분~1시간)
- Worker 의 failover / fanout 기능 상실

## 6. 채택 및 실행

### 선정: Option A 즉시 적용 → 효과 관측 후 Option B 병행

**근거**:
- 1주 시연 범위에서 가장 빠른 검증 경로
- Dashboard 토글 1분, 재배포 없음
- 공식 검증된 use case (LAX 실행 + single-region backend)
- 효과 미미 시 Option B + A 병행 (30분 추가 작업)
- Option C 는 장기 과제 — 프로젝트 재개 시점

### 실행 체크리스트

- [ ] **Cloudflare Dashboard → `goti-prod-proxy` → Placement: Smart** (사용자 수행 중)
- [ ] 프론트 새로고침 → `cf-ray` 헤더에서 PoP 코드 변화 확인 (`LAX` → `ICN/NRT/HKG` 기대)
- [ ] seat-statuses 레이턴시 재측정 (목표 300ms 이하, hit 시 < 100ms)
- [ ] 효과 있으면 `infra/cloudflare/multicloud-router.worker.js` 옆 `wrangler.toml` 에 명시적 hint 추가 + `wrangler deploy`
- [ ] 효과 없으면 Option B (AWS 라우팅 로직 제거) 병행
- [ ] 장기 과제 등록: ADR-0016 보강 — Option C (CF LB) 이관 계획 (프로젝트 재개 시)

## 7. 교훈

1. **백엔드 개선과 사용자 체감 latency 는 다른 레이어**. D1 (seat-statuses Redis SoT) 로 서버 측 900ms → 32ms 개선했으나 **네트워크 경로 이슈가 효과 마스킹**. 측정은 반드시 **사용자 경로 전체 + 백엔드 자체** 두 지점에서 분리 측정해야 진단 가능.
2. **`cf-ray` 헤더 / `x-envoy-upstream-service-time` / pod 로그 3 지점 상관분석** 이 경로 병목 파악의 표준 루틴. 앞으로 latency 이슈 발생 시 첫 증거 수집 단계로.
3. **Cloudflare Workers 는 Smart Placement 를 default 로 켜야** 한다. 한국 리전 특유의 PoP 라우팅 이슈 때문. 특히 single-region origin 을 쓰는 경우.
4. **1주 시연 / 장기 운영 / 10팀 확장** 단계별로 인프라 복잡도 기준 다름. Worker 커스텀 라우팅은 10+ 엔지니어 + 장기 운영 전제. 소규모 + 단기에는 관리형 GSLB 가 우월.

## 8. 관련 자료

### 공식 문서
- [Cloudflare Workers Smart Placement](https://developers.cloudflare.com/workers/configuration/smart-placement/)
- [Workers Smart Placement announcement blog](https://blog.cloudflare.com/announcing-workers-smart-placement/)
- [Smart Placement stabilization 2025-03](https://developers.cloudflare.com/changelog/2025-03-22-smart-placement-stablization/)
- [Placement Hints 2026-01](https://developers.cloudflare.com/changelog/post/2026-01-22-explicit-placement-hints/)
- [Cloudflare Load Balancing](https://developers.cloudflare.com/load-balancing/)
- [Monitor Groups (2025-08)](https://developers.cloudflare.com/changelog/2025-08-15-monitor-groups-for-load-balancing/)
- [Geo-steering policy](https://developers.cloudflare.com/load-balancing/understand-basics/traffic-steering/steering-policies/geo-steering/)

### 한국 PoP 라우팅 이슈
- [cdnjs/cdnjs#3395 — Korea routed to LAX](https://github.com/cdnjs/cdnjs/issues/3395)
- [LowEndTalk — Cloudflare TTFB Asia](https://lowendtalk.com/discussion/156892/cloudflare-ttfb-latency-not-good-for-asia)
- [CF community — Smart Placement not smart enough](https://community.cloudflare.com/t/smart-placement-not-smart-enough-lets-have-dumb-placement/768906)

### Multi-cloud 실무
- [Netflix — Global Cloud Active-Active](https://medium.com/netflix-techblog/global-cloud-active-active-and-beyond-a0fdfa2c3a45)
- [Why Netflix runs Multi-Region Active-Active (2024)](https://medium.com/@ismailkovvuru/why-netflix-runs-multi-region-active-active-across-aws-the-real-engineering-lessons-422a085f9e1f)
- [Airbnb Istio Upgrade at Massive Scale — InfoQ 2025](https://www.infoq.com/news/2025/08/airbnb-istio-upgrade/)
- [Istio Ambient Multicluster alpha 2025](https://istio.io/latest/blog/2025/ambient-multicluster/)
- [Cloudflare vs AWS ELB vs Azure Front Door vs GCP LB](https://inventivehq.com/blog/cloudflare-load-balancing-vs-aws-alb-vs-azure-front-door-vs-google-cloud-load-balancing)
- [2025 Guide to Multi-Cloud Resilient DNS](https://medium.com/@ismailkovvuru/the-2025-guide-to-multi-cloud-resilient-dns-zero-trust-architecture-053390a651da)

### 내부 문서
- ADR-0016 Multi-cloud Circuit Breaker + HPA — `docs/adr/0016-multicloud-circuit-breaker-and-hpa.md`
- Worker 소스 — `infra/cloudflare/multicloud-router.worker.js`
- Redis SoT D1 rollout — `docs/dev-logs/2026-04-17-redis-sot-d0-d1-rollout.md`
