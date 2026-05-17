---
title: "CDN Cache Key 설계 — 사용자별 응답 분리 원리"
excerpt: "CDN이 Cache Key로 응답을 식별하는 방식, URL만으로 캐싱할 때 사용자 데이터가 누출되는 문제, 그리고 사용자 식별자를 키에 포함해 응답을 안전하게 분리하는 원리를 설명합니다"
category: challenge
tags:
  - go-ti
  - cdn
  - cache-key
  - cloudflare
  - edge-computing
  - concept
series:
  name: "goti-deepdive-edge"
  order: 5
date: "2026-04-04"
---

## 한 줄 요약

> CDN은 Cache Key가 일치하는 요청에 같은 응답을 내려줍니다 — URL 경로만으로 키를 구성하면 사용자마다 다른 응답이 필요한 API에서 타인의 데이터가 그대로 노출됩니다

---

## 🤔 무엇을 푸는 기술인가

CDN은 원본 서버(origin) 앞에 위치한 분산 캐시 계층입니다 클라이언트의 요청이 CDN edge PoP에 도달했을 때 이미 캐시된 응답이 있으면 origin에 요청을 보내지 않고 edge에서 바로 응답합니다 이 흐름의 핵심 질문은 **"어떤 기준으로 같은 응답을 공유할 것인가"** 입니다

**Cache Key**는 이 질문에 대한 CDN의 답입니다 두 요청의 Cache Key가 동일하면 CDN은 "같은 리소스에 대한 요청"으로 판단하고 첫 번째 요청의 응답을 두 번째 요청에도 돌려줍니다

정적 자산(이미지, JS, CSS)에서는 URL 경로가 Cache Key의 전부여도 문제없습니다 `/logo.png`에 대한 응답은 누가 요청해도 동일하기 때문입니다 하지만 **사용자별로 다른 응답을 반환하는 동적 API**를 캐싱할 때 Cache Key를 잘못 설계하면 심각한 문제가 발생합니다

대기열 상태 polling이 대표적인 예입니다 `/queue/status`에 대해 사용자 A는 "12번째", 사용자 B는 "87번째" 응답을 받아야 합니다 URL만으로 Cache Key를 구성하면 A의 응답이 B에게도 전달됩니다 — 개인정보 누출이자 서비스 무결성 파괴입니다

Cache Key 설계는 캐싱 전략의 출발점입니다 "무엇을 캐싱하는가"만큼 "누구의 응답을 어떻게 구분하는가"가 중요합니다

---

## 🔧 동작 원리

### Cache Key의 기본 구조

CDN은 캐시 저장소를 거대한 해시 맵으로 관리합니다 Cache Key가 해시 맵의 키이고 캐시된 HTTP 응답이 값입니다

```text
cache["GET /queue/status"] = <HTTP 응답 객체>
```

요청이 도달하면 CDN은 Cache Key를 계산하고 저장소에서 조회합니다 키가 존재하면 **HIT**(저장된 응답 반환), 없으면 **MISS**(origin에 요청 후 저장)입니다

기본 Cache Key 구성은 CDN마다 다르지만 공통 기반은 다음과 같습니다

- **HTTP 메서드**: GET은 캐싱 대상, POST·PUT·DELETE는 기본적으로 캐싱하지 않음
- **URL 스킴 + 호스트**: `https://api.example.com`
- **URL 경로**: `/queue/status`
- **쿼리스트링**: 포함 여부는 설정으로 제어 가능

여기에 **`Vary` 헤더** 또는 **Worker-level 키 조작**으로 추가 차원을 더할 수 있습니다

### URL만으로 캐싱할 때 발생하는 문제

![CDN Cache Key 분리 실패 vs 성공 비교|tall](/diagrams/goti-deepdive-cdn-cache-key-1.svg)

왼쪽 패널은 Cache Key를 URL 경로만으로 구성할 때 발생하는 사용자 응답 누출 시나리오입니다

사용자 A가 `/queue/status`를 요청합니다 CDN에 캐시가 없으므로 MISS 처리되어 origin에서 A의 순번(12번째) 응답을 받아 저장합니다 Cache Key는 `/queue/status` 하나입니다

이제 사용자 B가 같은 경로를 요청합니다 CDN은 Cache Key `/queue/status`로 조회하고 A의 응답이 저장되어 있으므로 HIT 판정 후 그 응답을 그대로 B에게 반환합니다 B의 실제 순번은 87번이지만 A의 응답인 12번을 받습니다

이 오류는 CDN 버그가 아닙니다 CDN은 설계대로 동작했습니다 문제는 Cache Key 설계가 사용자를 구분하지 못한다는 점입니다

오른쪽 패널은 사용자 식별자를 Cache Key에 포함한 정상 흐름입니다 `user-a`와 `user-b`가 각각 독립적인 Cache Key를 가지므로 A의 응답이 B에게 영향을 주지 않습니다 각 사용자의 TTL 내 반복 polling은 모두 edge에서 HIT 처리되어 origin Redis에는 TTL 만료 후 1회만 요청이 도달합니다

### Vary 헤더 — HTTP 표준 방식

Cache Key에 추가 차원을 더하는 HTTP 표준 방법은 `Vary` 응답 헤더입니다

```text
HTTP/1.1 200 OK
Cache-Control: public, max-age=5
Vary: Authorization
```

`Vary: Authorization`을 응답에 포함하면 CDN은 Cache Key 계산에 `Authorization` 요청 헤더 값을 추가합니다 Authorization 헤더가 다른 두 요청은 서로 다른 Cache Key를 갖게 됩니다

```text
Cache Key A = GET /queue/status + Authorization: Bearer <JWE-A>
Cache Key B = GET /queue/status + Authorization: Bearer <JWE-B>
```

`Vary`는 표준이지만 실제 운용에는 주의점이 있습니다

- **Cache Key 폭발**: Vary 값이 요청마다 조금씩 달라지면 캐시 항목이 무한히 늘어납니다 `Vary: Cookie`가 대표적인 함정입니다 — Cookie 헤더 전체가 키에 포함되어 사실상 캐싱이 작동하지 않게 됩니다
- **원시 토큰 노출**: Authorization 헤더 전체를 키로 쓰면 JWE 원문이 캐시 인덱스로 잔류합니다 필요한 것은 토큰 내 식별자(`sub` claim)이지 토큰 원문이 아닙니다

Vary 방식은 단순하지만 "무엇을 키로 사용하는지 정밀하게 제어"하려면 Worker-level 조작이 더 적합합니다

### Worker-level Cache Key 조작 — 정밀 제어

Cloudflare Workers는 캐시 API를 직접 노출합니다 개발자가 어떤 키로 저장하고 조회할지 코드로 완전히 제어합니다

![CDN Cache Key 구성 및 edge Worker 조작 흐름|tall](/diagrams/goti-deepdive-cdn-cache-key-2.svg)

다이어그램 왼쪽부터 흐름을 따라가겠습니다

**① JWE 검증 + sub 추출**: 클라이언트가 보낸 Authorization 헤더의 JWE 토큰을 Workers에서 AES-256-GCM으로 복호화합니다 토큰이 유효하면 `sub` claim(사용자 UUID)을 꺼냅니다 토큰이 위조·만료된 경우 이 단계에서 401을 반환하고 이후 처리는 하지 않습니다

**② Cache Key 조합**: URL 경로와 sub를 결합해 고유한 Cache Key를 생성합니다 Workers는 `Request` 객체를 키로 직접 쓰거나 커스텀 URL을 만들어 키로 활용합니다

```javascript
const sub = jwePayload.sub
const cacheKey = new Request(
  `https://cache.internal/queue/status/${sub}`,
  request
)
```

내부 URL `cache.internal`은 실제로 fetch하는 주소가 아니라 캐시 인덱스에만 사용하는 논리 키입니다 Cache Key를 URL 형태로 표현하는 Workers 캐시 API의 관례입니다

**③ 캐시 HIT / MISS 판정**: `caches.default.match(cacheKey)`로 저장된 응답을 조회합니다 HIT이면 그 응답을 클라이언트에 바로 반환합니다 MISS이면 origin으로 요청을 전달합니다

**④ origin 응답 저장**: origin이 `Cache-Control: public, max-age=N` 응답을 돌려주면 Workers는 `caches.default.put(cacheKey, response.clone())`으로 캐시에 저장합니다 다음 요청부터는 HIT 처리됩니다

다이어그램 하단에는 Cache Key의 구성 요소 3가지가 정리되어 있습니다 **URL path**(`/queue/status`)는 캐싱 대상 리소스를 식별하고, **사용자 식별자**(JWE `sub` claim)는 응답의 소유자를 분리하며, 필요 시 **버전·리전** 같은 추가 차원을 선택적으로 붙일 수 있습니다

### Vary vs Worker-level 키 조작 비교

| 방식 | 적합한 상황 | 주의점 |
|---|---|---|
| `Vary: Accept-Language` | 언어별 응답 분리 (변형 수 제한적) | 헤더 전체가 키 — 변형이 많으면 캐시 폭발 |
| `Vary: Authorization` | JWT/JWE 전체로 분리 | 토큰이 매 요청마다 달라지면 사실상 캐싱 불가 |
| Worker-level 키 조작 | 토큰 내 claim 추출 후 분리 | Workers 코드 필요 — 하지만 키를 정밀하게 제어 |

`Vary`는 인프라 설정만으로 쓸 수 있어 진입 장벽이 낮습니다 하지만 "토큰 안의 특정 값만 키로 사용"하는 시나리오에서는 Worker-level 조작이 유일한 선택입니다 JWE처럼 요청마다 암호화 결과가 달라지는 토큰을 Vary로 쓰면 캐시 HIT이 거의 발생하지 않기 때문입니다

### polling 주기와 TTL의 관계

Cache Key가 올바르게 분리된 상태에서 TTL 설정이 origin 부하를 결정합니다

```text
polling 주기 P초 · CDN TTL T초 일 때,
  P >= T  → 각 polling마다 새 캐시 생성 → Cache Hit Rate 낮음
  P < T   → 동일 캐시를 N = (T/P)번 공유 → Origin 요청 1/N로 감소
```

예를 들어 TTL 5초, polling 주기 1초라면 동일 사용자의 5회 polling 중 4회는 edge에서 HIT 처리됩니다 사용자 1000명이 1초마다 polling할 때 origin에 도달하는 요청은 이론적으로 200 req/s(1000 ÷ 5)로 줄어듭니다

이 감소 효과는 Cache Key가 사용자별로 올바르게 분리되었을 때만 성립합니다 Cache Key가 잘못 설계되어 모든 사용자가 같은 항목에 HIT한다면 origin 부하는 줄겠지만 각 사용자는 타인의 응답을 받게 됩니다

---

## 📐 세부 동작과 옵션

### 캐싱 대상 API 선별 기준

API 응답을 CDN에 캐싱할 수 있는지 판단하는 기준은 다음과 같습니다

| 기준 | 캐싱 가능 | 캐싱 불가 |
|---|---|---|
| HTTP 메서드 | GET (읽기 전용) | POST·PUT·DELETE (상태 변경) |
| 응답 내용 | 조회 결과 (순번, 상태) | 트랜잭션 결과, 결제 정보 |
| 일관성 요구 | TTL 내 stale 허용 | 즉시 최신값 필요 |
| 사용자 의존성 | 있어도 됨 — Cache Key 설계로 분리 | 없음 |

대기열 상태 polling(`GET /queue/status`)은 TTL 몇 초의 stale이 허용되고 조회 전용입니다 반면 대기열 진입(`POST /queue/enter`)이나 좌석 예약은 상태를 변경하므로 캐싱하지 않습니다 — 캐싱하면 여러 사용자가 같은 좌석을 예약하는 것처럼 오작동할 수 있습니다

### Cache-Control 지시어와 edge 캐싱

origin이 응답에 포함하는 `Cache-Control` 헤더 지시어가 edge 캐싱 동작을 제어합니다

```text
Cache-Control: public, max-age=5, s-maxage=5
```

- `public`: CDN·프록시 등 공유 캐시가 저장 가능
- `max-age=N`: 클라이언트 및 공유 캐시의 TTL(초)
- `s-maxage=N`: 공유 캐시 전용 TTL (`max-age`보다 우선)
- `private`: 브라우저에만 캐싱, CDN 저장 불가
- `no-store`: 어디에도 캐싱 금지

상태 변경 API(`/queue/enter`, `/queue/admit`)에는 반드시 `Cache-Control: private, no-store`를 명시해야 합니다 지시어가 없을 때 일부 CDN은 응답을 캐시하는 경우가 있기 때문입니다

### Cache Key 설계 오류 감지 방법

```bash
# 두 사용자의 JWE 토큰으로 각각 요청 후 응답 비교
curl -H "Authorization: Bearer $JWE_A" https://api.example.com/queue/status
curl -H "Authorization: Bearer $JWE_B" https://api.example.com/queue/status
```

`cf-cache-status` 응답 헤더로 캐시 상태를 확인합니다

| 헤더 값 | 의미 |
|---|---|
| `HIT` | 캐시 항목이 존재해 edge에서 응답 |
| `MISS` | 캐시 없음 → origin 요청 후 저장 |
| `EXPIRED` | TTL 만료 → origin 재요청 후 갱신 |
| `BYPASS` | `Cache-Control: no-store` 등으로 캐싱 건너뜀 |
| `DYNAMIC` | Workers 또는 설정으로 캐싱 비활성화 |

두 사용자의 응답이 서로 다른 내용을 반환하면서 각각 HIT/MISS 상태가 독립적으로 동작하면 Cache Key 분리가 올바르게 작동하는 것입니다 반대로 사용자 B의 요청이 사용자 A 요청 직후 HIT을 반환하면서 내용도 같다면 키 분리에 실패한 것입니다

---

## 🧩 go-ti에서는

go-ti 티켓팅 서비스에서 대기열 status polling은 전체 트래픽의 70~90%를 차지했습니다 1000VU·3000VU 부하 테스트에서 polling이 Redis를 직접 두드리는 구조는 VU 증가에 비례해 Redis QPS가 폭증하는 비선형 병목을 드러냈습니다

이를 해결한 방식이 Cloudflare CDN 캐싱이었습니다 `GET /queue/status` 응답에 `Cache-Control: public, max-age=N`을 설정하고, Cache Key는 URL 경로와 JWE `sub` claim을 조합해 사용자별로 분리했습니다 polling 트래픽의 대부분이 edge에서 HIT 처리되어 origin Redis에는 TTL 만료 후 사용자당 1회만 요청이 도달했습니다

CDN HIT 확인 환경에서 3000VU 기준 `queue_status` 평균 응답 시간은 220ms, p95는 334ms였습니다 ALB 직접 경유 시(origin에 모든 요청이 도달) 평균 926ms, p95 1.98s와 비교하면 각각 4.2배·6배 개선된 수치입니다 추정 origin Redis 요청은 VU 수와 무관하게 수십 req/s 수준으로 유지되었습니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [대기열 구현 방식 선택 — CDN 캐싱 채택 ADR](/logs/goti-queue-implementation-cdn-caching-adr)에 정리했습니다

---

## 📚 핵심 정리

- **Cache Key는 응답 공유 범위를 결정합니다** — 키가 같은 요청은 같은 캐시 항목을 공유하므로, 사용자별 응답이 다른 API에서는 반드시 사용자 식별자를 키에 포함해야 합니다
- **`Vary` 헤더는 HTTP 표준 방식이지만 토큰 전체가 키가 됩니다** — JWE처럼 매 요청마다 암호화 결과가 다른 토큰을 Vary로 쓰면 캐시 HIT이 발생하지 않습니다
- **Worker-level 키 조작은 토큰 내부 claim만 키로 추출합니다** — JWE를 복호화해 `sub` claim만 꺼내 URL 경로와 조합하면 정밀하고 안전한 Cache Key를 구성할 수 있습니다
- **상태 변경 API에는 반드시 `Cache-Control: private, no-store`를 명시합니다** — enter·admit·결제 경로가 캐싱되면 트랜잭션 무결성이 깨집니다
- **TTL이 짧을수록 응답 신선도는 올라가지만 origin 요청은 늘어납니다** — polling 주기보다 TTL이 길어야 HIT Rate가 실질적으로 오릅니다
