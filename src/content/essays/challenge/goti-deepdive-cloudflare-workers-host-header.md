---
title: "Cloudflare Workers fetch() — Host 헤더 불변과 우회 원리"
excerpt: "Workers fetch()가 URL hostname을 Host 헤더로 강제하는 이유, 직접 IP 접근이 Error 1003으로 막히는 메커니즘, Cloudflare Proxy 경유 시 Host가 자동으로 설정되는 원리를 설명합니다"
category: challenge
tags:
  - go-ti
  - cloudflare-workers
  - host-header
  - reverse-proxy
  - istio
  - concept
series:
  name: "goti-deepdive-edge"
  order: 2
date: "2026-03-27"
---

## 한 줄 요약

> Workers fetch()는 URL의 hostname을 Host 헤더로 강제하며, `headers` 객체에서 Host를 덮어써도 런타임이 이를 무시합니다 — Host 오버라이드가 아닌 URL 설계로 Host를 제어해야 합니다

---

## 🤔 무엇을 푸는 기술인가

HTTP에서 **Host 헤더**는 서버가 어떤 가상 호스트(Virtual Host)로 요청을 처리할지 결정하는 핵심 정보입니다 하나의 IP에 여러 도메인이 매핑되어 있을 때, 서버는 Host 헤더 값으로 라우팅 대상을 선택합니다

리버스 프록시 앞에 Cloudflare Workers 같은 엣지 레이어를 두면 Host 헤더 관리가 복잡해집니다 클라이언트가 보낸 Host와 Workers가 백엔드에 전달하는 Host는 다를 수 있기 때문입니다

**Host 헤더가 잘못 설정되면 두 가지 문제가 발생합니다**

첫째로 Nginx, Istio, AWS ALB 같은 리버스 프록시는 Host를 기반으로 VirtualService나 Server Block을 선택합니다 Host 불일치 시 404 또는 라우팅 오류가 납니다

둘째로 Cloudflare Workers는 Host 헤더에 보안 제약을 두고 있습니다 이 제약을 모르면 예상대로 동작하지 않는 fetch() 호출을 디버깅하면서 시간을 소비하게 됩니다

---

## 🔧 동작 원리

### HTTP Host 헤더 — 리버스 프록시에서 결정되는 방식

HTTP/1.1 요청에서 Host 헤더는 RFC 7230에 따라 필수 항목입니다 브라우저가 `https://example.com/path`에 접근하면 `Host: example.com`을 자동으로 포함합니다

리버스 프록시 체인에서 Host 헤더가 결정되는 경로는 두 가지입니다

**1. 클라이언트 Host를 그대로 전달(pass-through)**

```text
Client → Host: example.com → Proxy → Host: example.com → Backend
```

Nginx의 `proxy_set_header Host $http_host`, Envoy의 `auto_host_rewrite: false` 설정이 이 동작입니다 백엔드는 원래 클라이언트 도메인을 Host로 받습니다

**2. 프록시가 Host를 재설정**

```text
Client → Host: example.com → Proxy → Host: backend.internal → Backend
```

Nginx의 `proxy_set_header Host backend.internal`처럼 명시적으로 Host를 주입합니다 백엔드 IP 또는 내부 도메인을 외부에 노출하지 않으려 할 때 쓰입니다

Istio VirtualService는 두 번째 방식과 유사하게 동작합니다 `hosts` 필드에 선언된 값과 실제 수신 Host 헤더가 일치해야 VirtualService가 적용됩니다

### Workers fetch()가 URL hostname을 Host로 강제하는 이유

Cloudflare Workers에서 fetch()를 호출하면 런타임이 Host 헤더를 다음 규칙으로 결정합니다

```text
Host 헤더 = fetch()에 전달한 URL의 hostname
```

`headers` 객체에 `Host`를 포함해도 Workers 런타임이 이를 무시하고 URL의 hostname으로 덮어씁니다

```javascript
// ❌ 오버라이드 무시됨 — 실제 전송: Host: resshome.iptime.org
await fetch("https://resshome.iptime.org/api/users", {
  headers: { "Host": "dev-api.go-ti.shop" }
});

// ✅ URL hostname이 Host — 실제 전송: Host: dev-api.go-ti.shop
await fetch("https://dev-api.go-ti.shop/api/users");
```

이 동작의 근거는 **보안 정책**입니다 Cloudflare 네트워크를 통과하는 모든 Workers fetch() 요청은 Cloudflare 인프라가 실제 연결을 중계합니다 만약 Host 오버라이드가 허용된다면 Workers 코드가 임의의 Host를 삽입해 다른 Cloudflare 고객의 도메인으로 스푸핑하는 공격 벡터가 생깁니다

Cloudflare는 이 위험을 원천 차단하기 위해 Host 헤더를 URL hostname으로 고정합니다 이는 공개 문서에 명시되어 있지 않지만 Workers Runtime의 일관된 동작 원칙입니다

### 직접 IP 접근이 막히는 이유 — Error 1003

Workers에서 IP 주소를 URL에 직접 쓰면 `Cloudflare Error 1003: Direct IP Access Not Allowed`가 반환됩니다

```javascript
// ❌ Error 1003 — Cloudflare가 차단
await fetch("https://118.38.x.x/api/users");
```

이 정책의 배경은 Cloudflare의 **오렌지 클라우드(Orange Cloud) 모델**에 있습니다 Cloudflare는 등록된 도메인에 대해서만 트래픽을 처리하도록 설계되어 있습니다 IP 직접 접근을 허용하면 Cloudflare 인프라가 임의의 IP 스캐닝·공격 중계에 악용될 수 있습니다

Workers 내부에서 발생하는 fetch()도 이 정책의 예외가 아닙니다 Workers는 Cloudflare 엣지에서 실행되지만, 외부 IP에 대한 직접 접근은 동일하게 제한됩니다

결국 Workers에서 백엔드에 접근하려면 **Cloudflare에 등록된 도메인을 경유해야 합니다**

### Cloudflare Proxy 경유 우회가 작동하는 원리

Cloudflare DNS에 도메인을 추가하고 Proxy(Orange Cloud)를 활성화하면 다음 흐름이 완성됩니다

```text
Workers fetch("https://dev-api.go-ti.shop/api/...")
  → Host: dev-api.go-ti.shop (URL hostname 자동)
  → Cloudflare Proxy가 DNS A 레코드 조회
  → DDNS(resshome.iptime.org) → Kind PC IP로 연결
  → Kind PC: Host: dev-api.go-ti.shop 수신
  → Istio VirtualService 매칭 성공
```

핵심은 Workers가 `dev-api.go-ti.shop`으로 fetch()를 호출하면 Host 헤더가 `dev-api.go-ti.shop`으로 자동 설정되고, Cloudflare Proxy가 해당 도메인의 A 레코드(DDNS)를 해석해 실제 서버 IP로 연결한다는 점입니다

Cloudflare Proxy는 SSL 종단도 처리합니다 Workers → Proxy 구간은 Cloudflare 내부 네트워크이고, Proxy → Origin 구간은 SSL 모드 설정(Flexible/Full/Strict)에 따라 HTTP 또는 HTTPS로 연결됩니다

![Workers Host 헤더 — 3가지 시도 비교|tall](/diagrams/goti-deepdive-cloudflare-workers-host-header-1.svg)

위 다이어그램은 동일한 목표(백엔드 API 프록시)를 달성하려는 세 가지 시도를 나란히 비교합니다

**시도 1(직접 IP)**에서 Workers는 `118.38.x.x`로 fetch()를 호출합니다 Host 헤더는 `118.38.x.x`로 설정되지만, Cloudflare Error 1003 정책이 이 요청을 즉시 차단합니다 IP 주소 자체가 도메인이 아니기 때문에 Cloudflare Proxy 처리 대상이 아닙니다

**시도 2(Host 오버라이드)**에서 DDNS 주소로 fetch()를 호출하면서 `headers` 객체에 원하는 Host를 삽입합니다 Workers 런타임은 이 오버라이드를 무시하고 URL hostname인 `resshome.iptime.org`로 Host를 강제합니다 Istio VirtualService는 `dev-api.go-ti.shop`을 기대하지만 `resshome.iptime.org`를 받아 매칭 실패 후 404를 반환합니다

**시도 3(중간 도메인)**에서 Cloudflare에 등록된 `dev-api.go-ti.shop`으로 fetch()를 호출합니다 URL hostname이 그대로 Host가 되고, Cloudflare Proxy가 도메인을 해석해 Kind PC로 연결합니다 Istio Gateway는 `dev-api.go-ti.shop` Host를 정상 매칭합니다

![Workers fetch() Host 헤더 결정 내부 흐름|tall](/diagrams/goti-deepdive-cloudflare-workers-host-header-2.svg)

두 번째 다이어그램은 Workers 런타임 내부에서 Host 헤더가 결정되는 단계를 보여줍니다

개발자가 작성한 코드(왼쪽 검정 박스)는 `resshome.iptime.org`를 URL로 전달하면서 `headers`에 `Host: dev-api.go-ti.shop`을 포함합니다 Workers Runtime(보라 박스)은 세 단계를 거칩니다 첫째로 URL에서 hostname인 `resshome.iptime.org`를 추출합니다 둘째로 `headers.Host` 오버라이드를 보안 정책으로 차단합니다 셋째로 Host 헤더를 `resshome.iptime.org`로 강제 설정합니다 오른쪽 실제 전송 패킷을 보면 `Host: resshome.iptime.org`가 명시되어 있고, Istio 매칭이 실패함을 알 수 있습니다

하단 녹색 박스는 올바른 해결 방법을 제시합니다 URL 자체를 `dev-api.go-ti.shop`으로 설정하면 Host가 자동으로 원하는 값이 됩니다

---

## 📐 세부 동작과 옵션

### Host 헤더 전달 방식 — Nginx와 Workers 비교

| 레이어 | Host 결정 방식 | 오버라이드 가능 여부 |
|---|---|---|
| Nginx | `proxy_set_header Host $http_host` (기본: upstream hostname) | 가능 — 설정으로 자유롭게 변경 |
| Envoy(Istio Sidecar) | `auto_host_rewrite` 설정에 따라 결정 | 가능 — VirtualService `headers` 블록 |
| Cloudflare Workers fetch() | URL hostname 고정 | 불가 — `headers.Host` 오버라이드 무시 |
| Cloudflare Proxy(Orange Cloud) | 수신 도메인 그대로 전달 | Cloudflare가 자동 관리 |

Workers는 범용 HTTP 클라이언트가 아닌 Cloudflare 보안 모델 위에서 동작하는 엣지 런타임입니다 Host 오버라이드 제한은 이 모델의 필연적 결과입니다

### Cloudflare Proxy SSL 모드

Workers를 통해 접근하는 중간 도메인에 Cloudflare Proxy를 걸면 SSL 종단 방식을 선택해야 합니다

| 모드 | Workers → Proxy | Proxy → Origin | Origin 인증서 요구 |
|---|---|---|---|
| Flexible | HTTPS(Cloudflare Edge) | HTTP(평문) | 없음 |
| Full | HTTPS | HTTPS(자체 서명 허용) | 자체 서명 이상 |
| Strict | HTTPS | HTTPS(CA 서명 필수) | 유효 CA 인증서 |

Origin 서버에 유효한 인증서가 없는 개발 환경에서는 Flexible이 유일한 옵션입니다 단, Proxy → Origin 구간이 평문이므로 프로덕션에서는 Full 이상을 사용해야 합니다

### 연결 가능한 Origin 유형

Workers fetch()의 URL hostname 강제 정책 하에서 Origin에 접근하는 경로는 다음과 같습니다

- **Cloudflare DNS 등록 도메인** + Proxy ON: Workers가 fetch() 가능, Host 자동 설정
- **Cloudflare DNS 등록 도메인** + Proxy OFF(DNS only): IP가 외부에 노출되며 Workers가 직접 IP로 연결 시도 → Error 1003
- **외부 도메인(비 Cloudflare DNS)**: Workers가 외부 DNS를 해석해 연결 시도 가능 — 단, IP로 해석되는 경우 Error 1003 정책이 다시 적용될 수 있음
- **직접 IP**: 항상 Error 1003

결론적으로 Workers에서 가장 안정적인 Origin 접근 방법은 **Cloudflare DNS에 등록 + Proxy ON** 구성입니다

---

## 🧩 go-ti에서는

go-ti는 Cloudflare Pages + Workers로 프론트엔드와 API 프록시를 구성했습니다 Workers가 Kind PC 위의 Istio Gateway로 API 요청을 전달해야 하는 상황에서, Host 헤더 문제가 핵심 난관으로 등장했습니다

처음에는 DDNS 주소(`resshome.iptime.org`)를 URL에 넣고 `headers` 객체에 Istio가 기대하는 Host(`dev-api.go-ti.shop`)를 삽입하면 될 것으로 예상했습니다 실제로는 Workers 런타임이 Host 오버라이드를 무시해 Istio 매칭이 실패했습니다 직접 IP 시도는 Error 1003으로 즉시 차단됐습니다

최종 해결책은 `dev-api.go-ti.shop`을 전용 중간 도메인으로 Cloudflare DNS에 등록하고 Proxy를 활성화한 것입니다 Workers가 `dev-api.go-ti.shop`으로 fetch()를 호출하면 URL hostname이 Host 헤더로 자동 설정되고, Cloudflare Proxy가 DDNS를 해석해 Kind PC로 연결합니다 이 도메인은 순수하게 Host 헤더 제약을 우회하기 위해 존재합니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [CloudFront → Cloudflare 전환 아키텍처 결정](/logs/goti-cloudflare-migration-adr)에 정리했습니다

---

## 📚 핵심 정리

- **Workers fetch()의 Host 헤더는 URL hostname입니다** `headers` 객체에 Host를 넣어도 런타임이 무시하고 URL hostname으로 강제합니다
- **직접 IP 접근은 Error 1003으로 차단됩니다** Cloudflare는 등록된 도메인을 통해서만 트래픽을 처리하는 보안 모델로 운영됩니다
- **Host 오버라이드 금지는 스푸핑 방지 정책입니다** Cloudflare 네트워크를 경유하는 Workers 요청에서 임의 Host 삽입이 허용되면 다른 고객 도메인 스푸핑 공격 벡터가 생깁니다
- **우회 방법은 URL 설계입니다** fetch() URL의 hostname 자체를 원하는 Host로 맞추고, 해당 도메인을 Cloudflare Proxy로 등록하면 Host가 자동으로 올바르게 설정됩니다
- **Istio VirtualService와 연동 시 Host 정합성 확인이 필수입니다** `hosts` 필드에 선언된 도메인과 Workers가 전달하는 Host 헤더가 일치해야 라우팅이 동작합니다
