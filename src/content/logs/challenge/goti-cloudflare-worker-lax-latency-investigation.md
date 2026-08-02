---
title: "백엔드는 32ms인데 사용자는 900ms — 지연이 사라진 구간 찾기"
excerpt: "Redis 전환으로 서버는 확실히 빨라졌는데 프론트 체감은 그대로였습니다. 브라우저와 엣지, pod 세 지점을 나눠 재서 934ms가 어디로 갔는지 추적했고, 응답 헤더 한 줄에서 Worker가 로스앤젤레스에서 돌고 있다는 사실을 찾아낸 기록입니다"
category: challenge
tags:
  - go-ti
  - Multi-Cloud
  - Cloudflare
  - Worker
  - Latency
  - SmartPlacement
  - troubleshooting
series:
  name: "goti-multicloud"
  order: 5
date: "2026-04-17"
---

## 한 줄 요약

> Redis SoT를 배포했는데도 `/seat-statuses`가 900ms대를 유지했습니다. 백엔드 pod 안에서 재면 20ms였습니다. 세 지점을 나눠 재서 934ms가 네트워크 구간에 있다는 것까지 좁혔고, `cf-ray` 헤더가 Worker의 실행 위치를 로스앤젤레스로 가리키고 있었습니다

---

## 🔥 문제: 백엔드는 빨라졌는데 사용자는 그대로

### 기대한 동작

Redis SoT D1 배포를 막 마친 시점이었습니다

`seat-statuses`는 HGETALL 한 번으로 모든 좌석 상태를 돌려주도록 바꿨으니, 서버 쪽에서 5~20ms 정도가 나오리라 봤습니다

### 실제로 나온 값

프론트에서 잰 결과는 딴판이었습니다

```text
seat-statuses  200  13.1 kB   979 ms
seat-statuses  200  13.0 kB  1170 ms
seat-statuses  200  12.5 kB   766 ms
seat-statuses  200  12.0 kB   965 ms
seat-statuses  200  11.8 kB  1170 ms
seat-statuses  200  11.3 kB  1010 ms
... (21건 동시 요청)
```

응답 크기가 3.7KB에서 13KB로 커진 것은 의도한 변화입니다. Lazy build 이후 모든 좌석이 명시적으로 `AVAILABLE`로 직렬화되기 때문입니다. 이전 PostgreSQL LEFT JOIN 방식은 없는 좌석이 빈 문자열로 나와서 작았을 뿐입니다

문제는 **지연이 D1 배포 전과 똑같다**는 것이었습니다. 기대한 개선폭의 40~50분의 1에 머물렀습니다

팀에서도 의심이 올라왔습니다. Cloudflare를 오가는 구간에 문제가 있는 것 아니냐, 오히려 단일 구성일 때보다 느린 것 같다는 이야기였습니다

여기서 방향을 정했습니다. 코드를 더 보는 대신 **어느 구간에서 시간이 사라지는지부터 재기로** 했습니다

---

## 🤔 증거 수집: 세 지점을 따로 잰다

### 1. pod 내부 실제 지연

Go 티켓팅 pod의 HTTP 미들웨어 로그입니다

```text
latency_ms: 62, 60, 69, 7, 8, 10, 15, 6, 28, 28, 31, 31, 31, 37, 9, 7, 27, 37, 8, 10
평균 20ms, 최대 70ms (첫 3건은 lazy build 포함)
```

**백엔드는 깨끗했습니다.** HGETALL 한 번으로 끝내는 D1 효과가 그대로 나오고 있었습니다

### 2. 응답 헤더

응답 헤더에 결정적인 단서가 있었습니다

```text
x-envoy-upstream-service-time: 32
x-goti-route-assigned:          aws
x-goti-route-circuit:           open
x-goti-route-origin:            https://gcp-api.go-ti.shop
x-goti-route-team:              SS
cf-ray:                         9edb5f933b80db7e-LAX
content-encoding:               br
```

한 줄씩 읽으면 이렇습니다

- `x-envoy-upstream-service-time: 32` — Istio envoy에서 app pod까지 32ms입니다. 빠릅니다
- `x-goti-route-circuit: open` — AWS 서킷이 이미 열려 있어 failover로 인한 지연은 없습니다
- `x-goti-route-origin: https://gcp-api.go-ti.shop` — GCP origin으로 곧장 갑니다
- `cf-ray: ...-LAX` — **Cloudflare Worker가 로스앤젤레스 PoP에서 돌고 있습니다**

### 3. 뺄셈으로 구간 분해

세 수치를 나란히 놓으니 설명되지 않는 구간이 드러났습니다

- 프론트 측정: 966ms
- 백엔드 실제: 32ms
- 차이: **934ms**

이 934ms가 코드 어디에도 없다면 남는 곳은 네트워크뿐입니다

### 4. speed.cloudflare.com 대조

`speed.cloudflare.com`을 돌려 봤습니다

- download 100KB: 25~40ms
- download 1MB: 27~38ms

Speed test는 Worker를 거치지 않고 Cloudflare가 직접 응답합니다. 즉 한국 PoP에서 정상적으로 답이 오고 있었습니다

Cloudflare 네트워크도, 사용자 회선도 문제가 없다는 뜻입니다

**Worker를 타는 `go-ti.shop/api/*` 경로만 LAX로 빠지고 있었습니다**

---

## 🤔 원인: Worker가 LAX에서 돌면서 태평양을 왕복

### 가설 매트릭스

| 가설 | 증거 | 결론 |
|---|---|---|
| A. AWS 서킷브레이커 실패로 매 요청 1.5s timeout 후 failover | `x-goti-route-circuit: open` 이미 open, failover 지연 없음 | 기각 |
| B. Redis HGETALL 지연 | pod 내부 20ms로 빠름 | 기각 |
| C. PG lazy build 반복 (플래그 미적용) | 뒤쪽 요청 6~10ms (cache hit) | 기각 |
| D. Pod·Istio·GKE 내부 병목 | upstream_service_time 32ms로 빠름 | 기각 |
| **E. Worker가 LAX에서 실행, Seoul origin 왕복** | cf-ray -LAX, speed test는 한국 PoP 정상 | **확정** |

### 경로 분해

요청이 실제로 어떻게 도는지 따라가 봤습니다

1. 한국 사용자 브라우저에서 Cloudflare LAX PoP까지 200~300ms (정상이면 ICN PoP에서 약 20ms)
2. LAX PoP에서 Worker가 실행됩니다 (서킷 체크, 헤더 파싱)
3. Worker가 `fetch('gcp-api.go-ti.shop')`을 호출합니다. LAX에서 Seoul까지 태평양을 건너 150~250ms
4. GCP Cloud Load Balancer(Seoul)와 Istio Ingress Gateway를 지나 pod에서 32ms에 처리됩니다
5. 응답이 역순으로 Seoul에서 LAX로 150~250ms, LAX에서 한국으로 200~300ms

누적하면 700~1100ms입니다. 실측 934ms가 이 범위 안에 정확히 들어옵니다

### 왜 LAX로 갔는가

Cloudflare Anycast는 보통 사용자 IP 기준으로 가장 가까운 PoP를 물립니다. 한국 사용자라면 ICN이 정상입니다

그런데 외부 자료에서 같은 현상이 반복 보고되고 있었습니다 (GitHub cdnjs/cdnjs#3395, CF community "Smart Placement not smart enough", LowEndTalk "Cloudflare TTFB Asia")

한국 ISP인 KT와 LGU+의 Cloudflare peering 용량과 비용 사정 때문에, 특정 zone이나 workload의 요청이 ICN이 아니라 LAX나 FUK, NRT로 빠지는 현상입니다. 2025년까지 계속 올라오고 있었습니다

Free나 Pro plan zone이 Enterprise보다 태평양 횡단 라우팅을 더 자주 겪는다는 관측도 있지만 공식 확인은 되지 않습니다

여기서 중요한 것은 **Worker가 실행되는 PoP가 사용자가 처음 닿은 PoP와 같다**는 점입니다. DNS 라우팅 문제가 Worker 실행 위치까지 그대로 옮겨 붙습니다

`speed.cloudflare.com`이 ICN에 붙는 이유는 그 zone의 정책이 다르거나 별도 백본 경로를 쓰기 때문으로 보입니다. 이것도 관측에 기반한 해석이고 공식 확인은 못 했습니다

---

## 🤔 외부 조사: Multi-Cloud 라우팅 실무 패턴

### Cloudflare Workers Smart Placement

공식 문서 사례에서는 Sydney에서 Frankfurt DB를 부르는 상황의 RTT가 20~30ms에서 1~3ms로 줄었습니다. 4~8배입니다

동작 방식은 이렇습니다

- Worker를 **backend origin에 가까운 PoP로 자동 이전**해 fetch 왕복을 줄입니다
- 2025-03에 stable로 전환됐습니다
- 2026-01에 Placement Hints(`"apac"`, `"wnam"`, `"enam"`, `"weur"`, `"eeur"`)가 추가돼 region을 직접 지정할 수 있습니다

제약도 있습니다

- fetch handler만 대상입니다. RPC와 static asset은 빠집니다
- 여러 지역에서 지속적인 트래픽이 쌓여야 판단합니다. 초기에는 `INSUFFICIENT_INVOCATIONS`로 표시됩니다
- backend가 여러 지역에 흩어져 있으면 자동으로 꺼집니다
- 1% 미만의 경우 오히려 느려지면 자동으로 되돌립니다

지금 상황은 Worker가 LAX에서 돌고 backend는 ap-northeast3 단일 리전입니다. 이 기능이 겨냥한 사례와 정확히 맞습니다

### Multi-Cloud 라우팅 패턴 비교

| 패턴 | 지연 특성 | 비용 | 운영 복잡도 |
|---|---|---|---|
| **CF Load Balancing (GSLB)** | edge에서 즉시 steering, DNS TTL 영향 없음 | $5~60/mo (geo-steering addon 포함) | 낮음, Cloudflare가 health·failover 관리 |
| **Route 53 + Cloud DNS** | DNS TTL(30~60s)만큼 failover 지연 | 저렴 | 2-provider 병행 시 health 공유 불가 |
| **Anycast IP (Spectrum / NS1)** | BGP 최근접, L4 | Enterprise | 과잉, L7 로직 제한 |
| **Istio multi-primary** | east-west gateway 경유, mesh 내부 mTLS | 인프라 비용 | 컨트롤플레인 2벌 운영 부담 |
| **API Gateway (AWS/Kong)** | 리전 내 TLS 종료 | 저렴 | GW 자체가 단일 cloud 종속 |

실무의 정석은 바깥에 GSLB를 두고 안쪽에 Istio multi-primary를 붙이는 조합입니다

Worker로 라우팅을 직접 짜는 방식은 엔지니어 10명 이상과 장기 운영을 전제로 할 때 의미가 있습니다

### CF Worker 커스텀 vs CF Load Balancing

| 항목 | CF Worker 커스텀 (현재) | CF Load Balancing |
|---|---|---|
| 비용 | Workers $5/mo + 요청당 | LB $5~60/mo |
| 유연성 | 팀코드·헤더 자유 로직 | 정책 기반 (geo/weighted/dynamic) |
| 운영 부담 | JS 디버깅, 서킷브레이커 직접 구현 | Cloudflare 관리 |
| **지연** | **Smart Placement 미설정 시 엉뚱한 PoP에서 실행** | edge에서 즉시 proxy, 추가 hop 없음 |
| 팀 규모 | 10명 이상 엔지니어 필요 | 소규모 팀에 적합 |

지금 겪는 현상은 Worker에 Smart Placement를 켜지 않았을 때 나오는 결과와 정확히 같습니다

---

## ✅ 해결: Smart Placement 활성화 + 장기 이관 계획

### 검토한 선택지

**Option A (즉시, 최소 수정) — Smart Placement 활성화**

Dashboard에서 `goti-prod-proxy`의 Placement를 Smart로 토글합니다. `wrangler.toml`에 `[placement] mode = "smart"`와 `hint = "apac"`을 적어 APAC을 직접 지정할 수도 있습니다

900ms에서 200~300ms로 줄어들 것으로 봤습니다. 태평양 왕복이 빠지는 만큼입니다

위험은 낮습니다. 오히려 느려지면 Cloudflare가 알아서 되돌립니다. 배포는 토글 1분, wrangler로 하면 10분입니다

**Option B (중기, 코드 축소) — AWS 라우팅 로직 제거**

1주 시연에 AWS cost freeze까지 겹쳐 있으니, 팀코드에서 AWS로 보내는 매핑 자체가 의미를 잃었습니다

```js
// multicloud-router.worker.js
const TEAM_ROUTING = {
  SS: 'gcp', KIA: 'gcp', LG: 'gcp', HH: 'gcp', SSG: 'gcp',   // 원래 AWS
  DO: 'gcp', NC: 'gcp', KT: 'gcp', LOT: 'gcp', KIW: 'gcp',    // 원래 GCP
};
// + 서킷 체크 / fetch 1회 / fanout 유지
```

Worker 실행 시간이 몇 ms 줄어듭니다. 다만 **실행 PoP가 LAX인 한 근본 개선은 안 됩니다.** Option A와 같이 가야 의미가 있습니다

**Option C (장기, 정석) — CF Load Balancing으로 이관**

Workers Routes를 걷고 Load Balancing Pro에 Geo-steering addon을 붙입니다. Origin pool에 AWS와 GCP를 등록하고 Monitor Groups로 health check을 겁니다

APAC 사용자는 GCP Seoul로, 나머지는 AWS나 fallback으로 보냅니다. Worker에는 팀코드 A/B 로직만 남깁니다

월 $60 정도에 운영 부담이 Cloudflare로 넘어갑니다. 다만 재배포와 테스트, DNS 변경까지 1~2일이 걸려 1주 시연에는 과합니다

**Option D (시연 전용) — 프론트 base URL 직접 변경**

`axios.create({ baseURL: 'https://gcp-api.go-ti.shop/api' })`로 Worker를 통째로 우회합니다

`gcp-api.go-ti.shop`이 CF Proxy를 켠 상태면 같은 LAX 문제가 재현될 수 있고, DNS-only면 GCP LB로 직행해 100~150ms가 나옵니다. 대신 Worker의 failover와 fanout을 잃습니다

### 채택: Option A 즉시 적용, B는 대기

1주 시연 범위에서 가장 빨리 검증할 수 있는 경로였습니다. 토글 1분에 재배포도 없고, 공식적으로 검증된 사례와 조건이 같습니다

효과가 미미하면 B를 함께 걸기로 했습니다. C는 프로젝트를 재개할 때 장기 과제로 넘겼습니다

### 실행 체크리스트

- Dashboard에서 `goti-prod-proxy` Placement를 Smart로 전환
- 프론트 새로고침 후 `cf-ray` 헤더의 PoP 코드 확인 (`LAX`에서 `ICN`·`NRT`·`HKG`로 바뀌길 기대)
- seat-statuses 지연 재측정 (목표 300ms 이하, cache hit 시 100ms 미만)
- 효과가 있으면 `wrangler.toml`에 hint를 명시하고 `wrangler deploy`
- 효과가 없으면 Option B 병행
- ADR-0016에 Option C 이관 계획을 장기 과제로 등록

---

## 📚 배운 점

### 백엔드 개선과 사용자 체감은 다른 층이다

D1으로 서버 쪽은 900ms에서 32ms가 됐습니다. 그런데 네트워크 구간이 그 성과를 통째로 가렸습니다

측정은 사용자 경로 전체와 백엔드 자체를 **나눠서** 해야 합니다. 한쪽만 보면 개선이 안 됐다는 잘못된 결론에 도달합니다. 실제로 이번에도 처음에는 Redis 전환이 실패한 줄 알았습니다

### 세 지점 뺄셈이 표준 절차가 됐다

이번 조사에서 실제로 쓴 도구는 셋뿐이었습니다

- `cf-ray` 헤더로 어느 PoP를 거쳤는지 봅니다
- `x-envoy-upstream-service-time`으로 envoy에서 pod까지의 시간을 봅니다
- pod 내부 미들웨어 로그로 애플리케이션 처리 시간을 봅니다

세 값을 빼면 시간이 어디서 사라지는지 바로 드러납니다. 지연 문제를 만나면 첫 단계로 이걸 돌리기로 정했습니다

### 한국에서 Cloudflare Workers를 쓴다면 Smart Placement는 기본값

KT와 LGU+의 peering 사정 때문에 PoP가 엉뚱하게 잡히는 일이 실제로 일어납니다

origin이 한 리전에만 있으면, Worker가 다른 대륙에서 도는 순간 origin까지의 왕복이 전체 지연을 지배합니다. 애플리케이션을 아무리 튜닝해도 이 구간은 줄지 않습니다

느려지면 자동으로 되돌리니 위험도 거의 없습니다. 켜 두지 않을 이유가 없습니다

### 단계마다 적정 복잡도가 다르다

- 1주 시연: 토글 하나로 끝나는 방식이 낫습니다
- 장기 운영: 관리형 GSLB로 넘겨 운영 부담을 줄이는 편이 낫습니다
- 10팀 이상 확장: Worker 커스텀 라우팅의 유연성이 값어치를 갖지만 엔지니어 10명 이상이 전제입니다

작고 짧은 프로젝트에서는 관리형이 이깁니다. 이 기준을 처음에 정해 두지 않으면, 초기에 고른 유연성이 시간이 지날수록 운영 부담으로 되돌아옵니다

---

## 이후 전개

이 글에서는 Option A를 골랐습니다

다만 후속 세션에서 Smart Placement만으로는 LAX 문제가 완전히 풀리지 않는다는 것이 확인됐습니다. 결국 Cloudflare Proxy를 끄고 GCP LB에 DNS Only로 직접 붙는 경로로 바꿨고, 지연은 900ms대에서 60ms 수준으로 떨어졌습니다

그 전환 과정은 [AWS 전량 Destroy + GCP-Only 지연 최적화](/logs/goti-aws-full-destroy-gcp-latency-optimization/)에 정리했습니다
