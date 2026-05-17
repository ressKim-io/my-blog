---
title: "CDN Edge 캐싱 — Cache-Control로 origin을 우회하는 원리"
excerpt: "HTTP Cache-Control 지시자가 CDN edge PoP에서 응답을 캐싱하는 방식, HIT/MISS 판정 흐름, polling 트래픽이 origin QPS를 사용자 수와 무관하게 만드는 구조적 원리를 설명합니다"
category: challenge
tags:
  - go-ti
  - cdn
  - cache-control
  - cloudflare
  - edge-computing
  - concept
series:
  name: "goti-deepdive-edge"
  order: 3
date: "2026-04-04"
---

## 한 줄 요약

> HTTP 응답에 포함된 `Cache-Control` 지시자가 CDN edge PoP에게 "이 응답을 N초 동안 저장해도 된다"고 알리면, 그 TTL 안에 들어오는 동일 요청은 origin에 닿지 않고 edge에서 바로 처리됩니다

---

## 🤔 무엇을 푸는 기술인가

웹 서비스에서 origin 서버는 유일한 병목입니다 요청이 origin에 직접 꽂히는 구조에서는 사용자 수가 늘어날수록 origin QPS가 선형으로, 때로는 비선형으로 증가합니다 서버를 수평 확장해도 일시적일 뿐이고 트래픽 급증 구간에서 origin은 다시 포화됩니다

CDN(Content Delivery Network) edge 캐싱은 이 문제를 구조적으로 다룹니다 핵심 아이디어는 단순합니다 — **응답이 반복적으로 요청되는 리소스라면, 첫 번째 응답을 origin 가까운 곳이 아니라 사용자 가까운 곳(edge PoP)에 저장해두고 이후 요청은 origin을 거치지 않고 바로 돌려준다**는 것입니다

**Cache-Control 헤더**는 이 동작을 제어하는 HTTP 표준 메커니즘입니다 origin이 응답에 `Cache-Control: public, max-age=5`를 넣으면 CDN은 "이 응답은 공유 캐시에 5초 동안 저장해도 된다"고 해석합니다 그 5초 안에 같은 리소스를 요청하는 모든 사용자는 edge에서 응답을 받으며, origin에는 요청이 도달하지 않습니다

정적 자산(이미지·CSS·JS)에는 이미 오래 쓰인 기법입니다 **이 글에서 주목하는 것은 동적 API 응답 — 특히 수십만 사용자가 짧은 주기로 반복하는 polling 요청**에 edge 캐싱을 적용했을 때 origin 부하가 어떻게 달라지는지입니다

---

## 🔧 동작 원리

### CDN edge PoP가 응답을 저장하는 방식

CDN은 전 세계에 분산된 **PoP(Point of Presence)** 네트워크로 구성됩니다 사용자 요청은 DNS 라우팅에 의해 가장 가까운 PoP로 향합니다 각 PoP는 자체 캐시 저장소를 가지며, 여기서 Cache Key를 기준으로 이전에 저장된 응답이 있는지 조회합니다

이 흐름을 단계로 정리하면 다음과 같습니다

1. 사용자 요청이 edge PoP에 도달
2. PoP가 Cache Key를 계산해 저장소 조회
3. 캐시가 있고 TTL이 유효하면 **HIT** — edge가 바로 응답, origin 요청 없음
4. 캐시가 없거나 TTL이 만료되면 **MISS** — origin으로 요청을 전달
5. origin이 응답을 돌려주면 edge가 `Cache-Control` 헤더를 해석해 저장 여부와 TTL 결정
6. 저장 후 응답 반환 — 다음 요청부터는 HIT

![CDN Edge HIT/MISS 흐름 — 여러 사용자 polling|tall](/diagrams/goti-deepdive-cdn-edge-caching-1.svg)

다이어그램 왼쪽은 TTL이 유효한 동안 여러 사용자가 polling할 때의 HIT 시나리오입니다 사용자 A와 B의 요청이 모두 edge에서 처리되며 origin에는 요청이 도달하지 않습니다 origin 입장에서는 이 두 사용자가 존재하는지조차 알 수 없습니다

오른쪽은 TTL이 만료된 후 처음 들어온 요청의 MISS 시나리오입니다 edge가 origin에 요청을 전달하고, origin이 응답과 함께 새로운 `Cache-Control` 헤더를 보내면 edge는 그 응답을 저장합니다 이후 TTL이 다시 시작되고, 다음 사이클에서는 다시 HIT이 됩니다

**핵심은 비율**입니다 polling 주기가 1초이고 TTL이 5초라면, 동일 사용자의 5회 polling 중 1회만 origin에 도달합니다 사용자 1000명이라면 이론적으로 origin QPS는 200 req/s로 유지됩니다 사용자가 5000명으로 늘어도 origin QPS는 1000 req/s — 사용자 수가 5배 늘었지만 origin 부하 증가는 TTL 비율로 제한됩니다

### Cache-Control 지시자의 역할

origin이 응답에 포함하는 `Cache-Control` 헤더 지시자가 edge의 캐싱 동작을 결정합니다

![Cache-Control 지시자별 CDN edge 캐싱 결정 흐름|tall](/diagrams/goti-deepdive-cdn-edge-caching-2.svg)

다이어그램은 origin 응답이 도달했을 때 edge가 캐싱 여부와 TTL을 결정하는 흐름을 보여줍니다

**`no-store`가 있으면 캐싱 전면 금지**입니다 edge는 이 응답을 저장하지 않으며 이후 요청도 매번 origin으로 전달됩니다 상태 변경 API(대기열 진입·좌석 예약·결제)에 반드시 붙여야 하는 지시자입니다

**`private`이 있으면 CDN은 저장하지 않고 브라우저만 캐싱**합니다 `Cache-Control: private`은 "이 응답은 요청한 사용자 브라우저에만 저장해도 된다 — 공유 캐시(CDN·프록시)는 저장하지 마라"는 의미입니다 사용자별 민감 정보가 포함된 응답에 적합하지만, edge 캐싱 이점은 포기합니다

**`public`이 있으면 edge 저장 허용**입니다 여기서 TTL을 결정하는 지시자가 두 가지입니다

- `s-maxage=N`: 공유 캐시(CDN·프록시) 전용 TTL — **`max-age`보다 우선적으로 적용됩니다**
- `max-age=N`: 브라우저와 공유 캐시 모두에 적용되는 TTL

`s-maxage`와 `max-age`를 함께 쓰면 브라우저와 CDN의 TTL을 별도로 제어할 수 있습니다 예를 들어 `Cache-Control: public, max-age=1, s-maxage=5`라고 설정하면 브라우저는 1초, CDN edge는 5초 동안 캐시를 유지합니다

```text
Cache-Control: public, max-age=1, s-maxage=5

브라우저: 1초 후 재요청
CDN edge: 5초 동안 HIT 처리 → origin 요청 감소
```

### HIT/MISS와 origin QPS의 관계

polling 트래픽에서 edge 캐싱이 origin을 어떻게 보호하는지 수식으로 정리합니다

```text
polling 주기 P초, CDN TTL T초, 동시 사용자 U명 일 때:

P < T  인 경우:
  edge HIT 횟수  = U × (T/P - 1) / (T/P)  ≈  U × (1 - P/T)
  origin 요청/s  = U × (1/T)               ← 사용자 U와 무관하게 TTL로 고정

P ≥ T  인 경우:
  각 polling이 새 캐시를 생성 → Hit Rate 낮음
  origin 요청/s  ≈ U × (1/P)              ← 사용자 수에 비례
```

`P < T`인 조건에서 origin QPS는 `U/T`로 수렴합니다 T(TTL)가 고정이면, 사용자 수 U가 아무리 늘어도 origin에는 초당 `1/T` 비율로만 요청이 도달합니다 U = 1,000이든 U = 500,000이든 **T가 같으면 origin QPS는 같습니다**

이것이 edge 캐싱이 "origin 부하를 사용자 수와 독립"으로 만든다고 말하는 의미입니다 수평 확장 없이 origin을 보호하는 구조적 해결책입니다

### edge가 HIT/MISS를 판단하는 Cache Key

edge가 HIT인지 MISS인지를 판단하는 기준이 **Cache Key**입니다 기본 Cache Key는 HTTP 메서드 + URL 경로 + 쿼리스트링이지만, 사용자별로 다른 응답을 돌려주어야 하는 API에서는 사용자 식별자를 Key에 포함해야 합니다

Cache Key 설계 원리와 사용자별 응답 분리 방법은 이 시리즈의 [CDN Cache Key 설계 — 사용자별 응답 분리 원리](/essays/goti-deepdive-cdn-cache-key)에 별도로 정리했습니다

---

## 📐 세부 동작과 옵션

### 지시자 조합 비교

| 헤더 조합 | CDN 저장 | 브라우저 저장 | 적합한 용도 |
|---|---|---|---|
| `public, s-maxage=N` | O (N초) | 미지정 | CDN 캐싱 최우선, polling API |
| `public, max-age=N` | O (N초) | O (N초) | 정적 자산, 공개 응답 |
| `public, max-age=N, s-maxage=M` | O (M초) | O (N초) | 브라우저/CDN TTL 별도 제어 |
| `private, max-age=N` | X | O (N초) | 개인 데이터, CDN 우회 |
| `private, no-store` | X | X | 상태 변경 API, 민감 트랜잭션 |
| 지시자 없음 | CDN 재량 | 브라우저 재량 | 예측 불가 — 명시 권장 |

지시자를 명시하지 않으면 CDN이 자체 휴리스틱으로 캐싱 여부를 결정합니다 의도치 않은 캐싱 또는 캐싱 누락이 발생할 수 있으므로, 모든 API 응답에 Cache-Control을 명시하는 것이 안전합니다

### TTL 선택 기준

TTL을 너무 짧게 설정하면 MISS가 자주 발생해 origin 요청이 늘어납니다 너무 길게 설정하면 stale 응답(만료된 데이터)이 사용자에게 전달됩니다 polling 기반 대기열에서 TTL 선택 기준은 다음과 같습니다

- **체감 반응성**: TTL = 5초이면 사용자는 최대 5초 지연된 순번 정보를 받습니다 체감 대기 시간이 나빠지지 않을 허용 범위를 파악한 뒤 TTL을 설정합니다
- **Hit Rate 목표**: TTL이 길수록 Hit Rate는 올라가고 origin QPS는 줄어듭니다 `max-age=1`이라도 polling 주기가 1초이면 이론적으로 Hit Rate 0%에 가깝습니다 — polling 주기보다 TTL이 길어야 의미 있는 Hit Rate가 확보됩니다
- **단계적 조정**: 운영 시작은 낮은 TTL(1~2초)로 안정성을 확인한 뒤, `cf-cache-status` 헤더 통계를 보면서 단계적으로 올립니다

### `cf-cache-status` 헤더 — 동작 확인

Cloudflare는 응답에 `cf-cache-status` 헤더를 포함합니다 이를 통해 edge에서 실제로 어떻게 처리됐는지 확인할 수 있습니다

```bash
curl -I -H "Authorization: Bearer $JWE_TOKEN" \
  https://api.example.com/queue/status
```

| 헤더 값 | 의미 |
|---|---|
| `HIT` | edge 캐시 항목이 유효해 origin 요청 없음 |
| `MISS` | 캐시 없음 — origin에 요청 후 저장 |
| `EXPIRED` | TTL 만료 — origin 재요청 후 갱신 |
| `BYPASS` | `no-store` 등으로 캐싱 건너뜀 |
| `DYNAMIC` | Workers 또는 설정으로 캐싱 비활성화 |

배포 직후 첫 번째 요청은 반드시 `MISS`가 돌아와야 합니다 이후 같은 Cache Key로 재요청 시 `HIT`이 확인되면 edge 캐싱이 정상 동작하는 것입니다 상태 변경 API에서 `HIT`이 돌아온다면 Cache-Control 설정이 잘못된 것입니다

---

## 🧩 go-ti에서는

go-ti 티켓팅 서비스의 가상 대기실(Virtual Waiting Room)에서 `GET /queue/status`는 전체 트래픽의 70~90%를 차지했습니다 K6 부하 테스트에서 1000VU → 3000VU(3배)로 늘었을 때 Redis-direct 구조의 status 응답 평균이 110ms에서 2.66s로 24배 악화되었습니다 VU 증가와 Redis QPS가 선형으로 연결된 구조에서 비선형 포화가 발생한 것입니다

CDN 캐싱 채택 이후, `GET /queue/status` 응답에 `Cache-Control: public, max-age=1`을 적용하고 Cloudflare edge에서 HIT 처리를 확인했습니다 3000VU 환경에서 `queue_status` 평균 응답 시간은 220ms, p95는 334ms였으며, 추정 origin Redis 요청은 사용자 수와 무관하게 수십 req/s 수준을 유지했습니다 ALB 직접 경유(origin에 모든 요청이 도달)의 평균 926ms, p95 1.98s와 비교하면 각각 4.2배·6배 개선입니다

`POST /queue/enter`와 `POST /seat-enter` 등 상태 변경 경로에는 `Cache-Control: private, no-store`를 명시해 캐싱을 완전히 차단했습니다 캐싱 대상은 조회 전용(`GET /queue/status`)으로만 한정하고, 대기열 순번 SoT(Source of Truth)는 여전히 origin Redis가 관리합니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [대기열 구현 방식 선택 — CDN 캐싱 채택 ADR](/logs/goti-queue-implementation-cdn-caching-adr)에 정리했습니다

---

## 📚 핵심 정리

- **`Cache-Control: public, s-maxage=N`은 CDN edge에게 "N초 동안 이 응답을 저장하라"는 지시입니다** — TTL 안의 모든 동일 요청은 origin을 거치지 않습니다
- **HIT 상태에서 origin QPS는 `사용자 수 / TTL`로 수렴합니다** — TTL이 고정이면 사용자 수가 늘어도 origin 부하가 함께 늘지 않는 구조적 보호입니다
- **`no-store`와 `private`은 edge 캐싱을 차단합니다** — 상태 변경 API에는 반드시 명시해야 합니다 지시자를 생략하면 CDN이 임의로 캐싱할 수 있습니다
- **`s-maxage`는 `max-age`보다 우선합니다** — CDN과 브라우저의 TTL을 별도로 제어하려면 두 지시자를 함께 사용합니다
- **`cf-cache-status: HIT`는 실제 HIT 여부를 직접 확인하는 지표입니다** — 배포 후 이 헤더로 edge 캐싱 동작을 검증하는 것이 권장됩니다
