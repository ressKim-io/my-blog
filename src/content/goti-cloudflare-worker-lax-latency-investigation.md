---
title: "Cloudflare Worker가 LAX에서 실행되어 900ms 지연 — Smart Placement로 해결"
excerpt: "백엔드는 32ms인데 프론트는 900ms+. cf-ray 헤더로 Worker가 LAX PoP에서 실행되어 Seoul origin과 태평양 왕복하는 것을 확인하고 Smart Placement로 해결한 조사 기록"
category: challenge
tags:
  - go-ti
  - Multi-Cloud
  - Cloudflare
  - Worker
  - Latency
  - SmartPlacement
series:
  name: "goti-multicloud"
  order: 5
date: "2026-04-17"
---

## 한 줄 요약

> Redis SoT 배포 후에도 `/seat-statuses` 레이턴시가 900ms+를 유지했습니다. 백엔드 실측은 20ms였고, `cf-ray` 헤더에서 Cloudflare Worker가 LAX PoP에서 실행되어 Seoul origin과 태평양을 왕복하는 경로 이슈를 발견했습니다. Smart Placement 활성화로 해결했습니다.

---

## 🔥 문제: 백엔드는 빠른데 프론트는 여전히 900ms+

### 기대 동작

Redis SoT(Source of Truth) D1 배포가 완료된 직후였습니다. `seat-statuses` 엔드포인트는 HGETALL 한 번으로 모든 좌석 상태를 반환하도록 개선했기 때문에, 서버 측에서 5~20ms 수준의 레이턴시가 기대되었습니다.

### 발견한 증상

프론트에서 측정한 결과는 기대와 크게 달랐습니다.

```
seat-statuses  200  13.1 kB   979 ms
seat-statuses  200  13.0 kB  1170 ms
seat-statuses  200  12.5 kB   766 ms
seat-statuses  200  12.0 kB   965 ms
seat-statuses  200  11.8 kB  1170 ms
seat-statuses  200  11.3 kB  1010 ms
... (21건 동시 요청)
```

응답 크기가 3.7KB에서 13KB로 증가한 것은 정상 동작입니다. Lazy build 이후 모든 좌석 상태가 명시적으로 `AVAILABLE`로 직렬화되기 때문입니다. 이전 PostgreSQL LEFT JOIN 방식은 miss된 좌석이 빈 문자열로 반환되어 크기가 작았을 뿐입니다.

문제는 **레이턴시가 D1 배포 이전과 동일한 수준**이라는 점이었습니다. 기대 효과의 40~50배에 머물렀습니다.

사용자 쪽에서도 합리적인 의심이 올라왔습니다. "Cloudflare에서 왔다갔다 하는 문제는 없어?", "이거 단일로 켰을때보다 그냥 느린데". 증거 수집에 착수했습니다.

---

## 🤔 증거 수집: 3지점 상관 분석

### 1. Pod 내부 실제 레이턴시

Go 티켓팅 pod의 HTTP 미들웨어 로그입니다.

```
latency_ms: 62, 60, 69, 7, 8, 10, 15, 6, 28, 28, 31, 31, 31, 37, 9, 7, 27, 37, 8, 10
평균 20ms, 최대 70ms (첫 3건은 lazy build 포함)
```

**백엔드 자체는 깨끗했습니다**. D1 효과(HGETALL 1 RTT)가 완전히 작동하고 있었습니다.

### 2. 응답 헤더

사용자가 공유한 응답 헤더에 결정적인 단서가 있었습니다.

```
x-envoy-upstream-service-time: 32
x-goti-route-assigned:          aws
x-goti-route-circuit:           open
x-goti-route-origin:            https://gcp-api.go-ti.shop
x-goti-route-team:              SS
cf-ray:                         9edb5f933b80db7e-LAX
content-encoding:               br
```

- `x-envoy-upstream-service-time: 32`: Istio envoy에서 app pod까지 32ms로 빠릅니다.
- `x-goti-route-circuit: open`: AWS 서킷이 이미 open 상태이므로 failover 지연이 없습니다.
- `x-goti-route-origin: https://gcp-api.go-ti.shop`: GCP origin으로 직행 중입니다.
- `cf-ray: ...-LAX`: **Cloudflare Worker가 LAX(Los Angeles) PoP에서 실행되고 있습니다**.

### 3. 수학적 분해

세 지점의 수치를 맞춰보면 설명되지 않는 구간이 드러났습니다.

```
프론트 측정:  966ms
백엔드 실제:   32ms (x-envoy-upstream-service-time)
           ────
네트워크:    934ms 이 설명되지 않음
```

934ms 대부분이 네트워크 경로에서 소비되고 있었습니다.

### 4. speed.cloudflare.com 대조 실험

사용자가 `speed.cloudflare.com`을 실행한 결과입니다.

- download 100KB: 25~40ms 레이턴시
- download 1MB: 27~38ms 레이턴시

Speed test는 Worker를 경유하지 않는 Cloudflare 직접 서비스입니다. 즉 한국 PoP(ICN 추정)에서 정상 응답이 돌아오고 있었습니다. Cloudflare 네트워크 자체, 사용자 회선 모두 정상입니다.

**오직 Worker 경로(`go-ti.shop/api/*`)만 LAX로 라우팅되고 있었습니다**.

---

## 🤔 원인: Worker가 LAX에서 실행, Seoul origin과 태평양 왕복

### 가설 매트릭스

| 가설 | 증거 | 결론 |
|---|---|---|
| A. AWS 서킷브레이커 실패로 매 요청 1.5s timeout 후 failover | `x-goti-route-circuit: open` 이미 open, failover 지연 없음 | 기각 |
| B. Redis HGETALL 지연 | pod 내부 레이턴시 20ms로 빠름 | 기각 |
| C. PG lazy build 반복 (플래그 미적용) | 뒤쪽 요청 6~10ms (cache hit) | 기각 |
| D. Pod / Istio / GKE 내부 병목 | upstream_service_time 32ms로 빠름 | 기각 |
| **E. Cloudflare Worker가 LAX에서 실행, Seoul origin 왕복** | cf-ray -LAX, speed test는 한국 PoP 정상 | **확정** |

### 경로 분해

현재 요청이 실제로 어떻게 흐르고 있는지 따라가보겠습니다.

```
한국 사용자 브라우저
    ↓ (정상이면 ~20ms, ICN PoP)
    ↓ (실제 라우팅) 200~300ms
Cloudflare LAX PoP
    ↓ Worker 실행 (서킷 체크, 헤더 파싱)
    ↓ fetch('gcp-api.go-ti.shop') — LAX에서 Seoul로
    ↓ 태평양 왕복 150~250ms
GCP Cloud Load Balancer (Seoul)
    ↓ Istio Ingress Gateway
    ↓ 티켓팅 pod (32ms 실제 처리)
    ↑ 역순 반환
    ↑ Seoul에서 LAX로 150~250ms
    ↑ LAX에서 한국으로 200~300ms
```

누적 네트워크 오버헤드는 700~1100ms입니다. 실측 934ms와 일치합니다.

### 왜 LAX로 라우팅되는가

Cloudflare Anycast는 통상 사용자 IP 기준 최근접 PoP를 반환합니다. 한국 사용자는 ICN PoP가 정상입니다. 그러나 외부 조사 결과(GitHub cdnjs/cdnjs#3395, CF community "Smart Placement not smart enough", LowEndTalk "Cloudflare TTFB Asia")에서 반복적으로 보고되는 이슈가 있었습니다.

한국 ISP(KT, LGU+)의 Cloudflare peering 용량과 비용 협상 사정으로, 특정 zone이나 workload의 요청이 ICN이 아닌 LAX, FUK, NRT로 빠지는 현상입니다. 2025년까지 지속적으로 보고되고 있습니다. Free/Pro plan zone이 Enterprise 대비 trans-pacific 라우팅 빈도가 높다는 관측도 있지만 공식 확인은 불가합니다.

Worker 실행 PoP는 **사용자가 처음 진입한 PoP와 동일**합니다. 따라서 DNS 라우팅 이슈가 Worker 실행 위치까지 전염됩니다.

`speed.cloudflare.com`이 ICN에 붙는 이유는 해당 zone의 routing policy가 다르거나 비즈니스급 백본 우선 경로를 쓰기 때문으로 추정됩니다. 역시 공식 확인은 불가한 관측 기반 해석입니다.

---

## 🤔 외부 조사: Multi-Cloud 라우팅 실무 패턴

### Cloudflare Workers Smart Placement

공식 문서의 사례를 보면, Sydney에서 Frankfurt DB를 호출하는 시나리오에서 RTT 20~30ms가 1~3ms로 줄었습니다. 4~8배 개선입니다.

Smart Placement의 동작 방식은 다음과 같습니다.

- Worker를 **backend origin에 가까운 PoP로 자동 이전**하여 fetch() 왕복을 최소화합니다.
- 2025-03 stable 전환되었습니다.
- 2026-01에 **Placement Hints**(`"apac"`, `"wnam"`, `"enam"`, `"weur"`, `"eeur"`)가 추가되어 명시적 region 지정이 가능합니다.

제약 사항도 있습니다.

- fetch handler만 대상입니다. RPC, static asset은 제외됩니다.
- "multiple locations의 지속 트래픽"을 확보한 후 결정합니다. 초기에는 `INSUFFICIENT_INVOCATIONS`로 표시됩니다.
- backend가 geo-distributed이면 자동 비활성화됩니다.
- 1% 미만 케이스에서 오히려 느려지면 자동 롤백됩니다.

우리 케이스(LAX에서 실행, backend는 ap-northeast3 단일 리전)는 정확히 이 use case에 맞습니다.

### Multi-Cloud 라우팅 패턴 비교

| 패턴 | 레이턴시 특성 | 비용 | 운영 복잡도 |
|---|---|---|---|
| **CF Load Balancing (GSLB)** | edge 즉시 steering, DNS TTL 영향 없음 | $5~60/mo (geo-steering addon 포함) | 낮음, Cloudflare가 health/failover 관리 |
| **Route 53 + Cloud DNS** | DNS TTL(30~60s)만큼 failover 지연 | 저렴 | 2-provider 병행 시 health 공유 불가 |
| **Anycast IP (Spectrum / NS1)** | BGP 최근접, L4 | Enterprise | 과잉, L7 로직 제한 |
| **Istio multi-primary** | east-west gateway 경유, mesh 내부 mTLS | 인프라 비용 | 컨트롤플레인 2벌 운영 부담 |
| **API Gateway (AWS/Kong)** | 리전 내 TLS 종료 | 저렴 | GW 자체가 단일 cloud 종속 |

실무의 정석은 **외부 GSLB(CF LB 또는 Route53) + 내부 Istio multi-primary 조합**입니다. Worker 커스텀 라우팅은 10명 이상 엔지니어 + 장기 운영을 전제한 선택지입니다.

### CF Worker 커스텀 vs CF Load Balancing

| 항목 | CF Worker 커스텀 (현재) | CF Load Balancing |
|---|---|---|
| 비용 | Workers $5/mo + 요청당 | LB $5~60/mo |
| 유연성 | 팀코드/헤더 자유 로직 | 정책 기반 (geo/weighted/dynamic) |
| 운영 부담 | JS 디버깅, CB 직접 구현 | Cloudflare 관리 |
| **레이턴시** | **Smart Placement 미설정 시 LAX 등 엉뚱한 PoP 실행** | edge에서 즉시 proxy, 추가 hop 없음 |
| 팀 규모 | 10명 이상 엔지니어 필요 | 소규모 팀에 적합 |

우리 현상(LAX 실행, 900ms+)은 **Worker에 Smart Placement를 안 쓴 결과**와 정확히 일치합니다.

---

## ✅ 해결: Smart Placement 활성화 + 장기 이관 계획

### 해결 옵션

#### Option A (즉시, 최소 수정) — Smart Placement 활성화

- Cloudflare Dashboard → Workers & Pages → `goti-prod-proxy` → Settings → Placement → **Smart**로 토글합니다.
- 2026-01 신규 기능으로 `wrangler.toml`에 `[placement] mode = "smart"; hint = "apac"`을 명시해 APAC region을 지정할 수 있습니다.
- 예상 효과는 900ms에서 200~300ms로 감소(공식 4~8배 개선 사례 기준, trans-pacific RTT 제거)합니다.
- 위험은 낮습니다. 1% 미만 케이스에서 오히려 느려지면 자동 롤백됩니다.
- 배포는 Dashboard 토글 1분 또는 `wrangler deploy` 10분입니다.

#### Option B (중기, 코드 축소) — AWS 라우팅 로직 제거

1주 시연 + AWS cost freeze 전제이므로, Worker가 수행하는 팀코드에서 AWS 매핑 자체가 무의미해집니다.

```js
// multicloud-router.worker.js
const TEAM_ROUTING = {
  SS: 'gcp', KIA: 'gcp', LG: 'gcp', HH: 'gcp', SSG: 'gcp',   // 원래 AWS
  DO: 'gcp', NC: 'gcp', KT: 'gcp', LOT: 'gcp', KIW: 'gcp',    // 원래 GCP
};
// + 서킷 체크 / fetch 1회 / fanout 유지
```

Worker 실행 시간이 수 ms 단축됩니다. 하지만 **실행 PoP가 LAX이면 근본 개선이 제한적**이므로 Option A와 병행해야 의미가 있습니다.

#### Option C (장기, 정석) — CF Load Balancing으로 이관

- Workers Routes를 해제합니다.
- Cloudflare Load Balancing Pro + Geo-steering addon을 활성화합니다.
- Origin pool로 AWS + GCP를 등록하고, Monitor Groups(2025-08 신기능)로 health check을 구성합니다.
- APAC 사용자는 GCP Seoul, 그 외는 AWS(재기동 후) 또는 fallback으로 연결합니다.
- Worker는 팀코드 A/B 테스트 로직만 LB 뒤에 유지합니다(필요 시).
- 비용은 월 약 $60, 운영 부담은 Cloudflare로 이관됩니다.
- 재배포, 테스트, DNS 변경을 합쳐 1~2일 작업입니다. 1주 시연 범위에서는 과합니다.

#### Option D (시연 전용 workaround) — 프론트 base URL 직접 변경

`axios.create({ baseURL: 'https://gcp-api.go-ti.shop/api' })` + 팀코드 prefix 제거입니다.

- Worker를 완전히 우회합니다.
- `gcp-api.go-ti.shop`이 CF Proxy(orange cloud)이면 동일 LAX 이슈가 재현될 가능성이 있고, DNS-only(grey cloud)이면 GCP LB 직행으로 100~150ms가 나옵니다.
- Goti-front 재배포가 필요합니다(15분~1시간).
- Worker의 failover 및 fanout 기능이 상실됩니다.

### 채택: Option A 즉시 적용 + Option B 병행 대기

- 1주 시연 범위에서 가장 빠른 검증 경로입니다.
- Dashboard 토글 1분, 재배포 없음입니다.
- 공식 검증된 use case(LAX 실행 + single-region backend)입니다.
- 효과가 미미하면 Option B와 A를 병행합니다(30분 추가 작업).
- Option C는 장기 과제로 프로젝트 재개 시점에 착수합니다.

### 실행 체크리스트

- Cloudflare Dashboard → `goti-prod-proxy` → Placement: Smart (사용자 수행 중)
- 프론트 새로고침 → `cf-ray` 헤더에서 PoP 코드 변화 확인 (`LAX` → `ICN/NRT/HKG` 기대)
- seat-statuses 레이턴시 재측정 (목표 300ms 이하, hit 시 100ms 미만)
- 효과 있으면 `infra/cloudflare/multicloud-router.worker.js` 옆 `wrangler.toml`에 명시적 hint 추가 + `wrangler deploy`
- 효과 없으면 Option B(AWS 라우팅 로직 제거) 병행
- 장기 과제 등록: ADR-0016 보강 — Option C(CF LB) 이관 계획 (프로젝트 재개 시)

---

## 📚 배운 점

### 백엔드 개선과 사용자 체감 레이턴시는 다른 레이어

D1(seat-statuses Redis SoT)로 서버 측은 900ms에서 32ms로 개선되었습니다. 하지만 **네트워크 경로 이슈가 이 효과를 마스킹**했습니다.

측정은 반드시 **사용자 경로 전체 + 백엔드 자체** 두 지점에서 분리 측정해야 진단이 가능합니다. 한쪽만 보면 "개선이 안 됐다"는 오판에 빠집니다.

### cf-ray + x-envoy-upstream-service-time + pod 로그 3지점 상관 분석이 표준 루틴

이번 조사의 핵심 도구는 세 지점의 상관 분석이었습니다.

- `cf-ray` 헤더: Cloudflare의 어느 PoP를 거쳤는지 파악합니다.
- `x-envoy-upstream-service-time`: Istio envoy에서 app pod까지의 시간을 측정합니다.
- Pod 내부 미들웨어 로그: 애플리케이션 자체의 처리 시간을 측정합니다.

세 지점의 차이를 뺄셈으로 분해하면 어느 구간에서 시간이 사라지는지 한눈에 보입니다. 앞으로 레이턴시 이슈 발생 시 첫 증거 수집 단계로 활용해야 합니다.

### Cloudflare Workers는 Smart Placement를 default로 켜야 한다

한국 리전 특유의 PoP 라우팅 이슈(KT/LGU+ peering 사정) 때문입니다. 특히 single-region origin을 쓰는 경우 Worker가 엉뚱한 대륙의 PoP에서 실행되면 origin까지 왕복 비용이 전체 레이턴시를 지배합니다.

Smart Placement는 1% 미만 케이스에서 자동 롤백되므로 실질적인 위험 없이 기본값으로 켤 수 있습니다.

### 시연/장기/확장 단계별로 인프라 복잡도 기준이 다르다

- 1주 시연: Dashboard 토글 수준의 즉시 적용이 유리합니다.
- 장기 운영: 관리형 GSLB로 이관해 운영 부담을 줄이는 것이 유리합니다.
- 10팀 이상 확장: Worker 커스텀 라우팅이 유연성 측면에서 의미를 가질 수 있으나, 10명 이상 엔지니어를 전제합니다.

소규모 + 단기에는 관리형 GSLB가 우월합니다. 이 기준을 프로젝트 초기부터 명시하지 않으면 기술 선택이 시간이 지날수록 운영 부담으로 돌아옵니다.
