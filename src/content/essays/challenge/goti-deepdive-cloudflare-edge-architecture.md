---
title: "Cloudflare Pages + Workers — 정적·동적 분리 엣지 아키텍처"
excerpt: "Cloudflare Pages가 정적 파일을 엣지에서 서빙하고 Workers가 V8 isolate로 동적 요청을 처리하는 방식, 그리고 SPA fallback이 정적 영역에만 격리 적용되는 구조적 원리를 설명합니다"
category: challenge
tags:
  - go-ti
  - cloudflare
  - cloudflare-pages
  - cloudflare-workers
  - edge-computing
  - spa-fallback
  - concept
series:
  name: "goti-deepdive-edge"
  order: 1
date: "2026-03-27"
---

## 한 줄 요약

> Cloudflare Pages와 Workers는 같은 도메인 아래에서 정적 서빙과 동적 실행을 완전히 분리된 환경에서 처리합니다 — SPA fallback이 API 경로에 침범하지 않는 것은 이 구조적 분리의 자연스러운 결과입니다

---

## 🤔 무엇을 푸는 기술인가

웹 서비스는 두 종류의 리소스를 함께 서빙합니다

첫째는 **정적 파일**입니다 HTML, JavaScript, CSS, 이미지처럼 빌드 시점에 완성되어 내용이 변하지 않는 파일입니다 SPA(Single Page Application)의 번들이 대표적입니다

둘째는 **동적 요청**입니다 `/api/users`, `/api/orders`처럼 서버에서 비즈니스 로직을 실행하고 데이터를 조회해 응답을 생성하는 요청입니다

전통적으로는 하나의 서버 또는 하나의 CDN 설정 안에서 경로 기반으로 이 둘을 구분했습니다 그런데 이 접근은 CDN 설정이 두 유형에 **전역으로 공유**될 때 문제가 생깁니다 SPA 라우팅을 위한 fallback 설정이 API 에러 응답에도 적용되어 JSON 에러가 HTML로 교체되는 현상이 대표적인 예입니다

Cloudflare Pages + Workers 구조는 이 문제를 정적 서빙 환경과 동적 실행 환경을 **아키텍처 레벨에서 분리**함으로써 해결합니다

---

## 🔧 동작 원리

### 엣지 PoP — 모든 요청의 첫 착지점

Cloudflare는 전 세계 **300개 이상의 엣지 PoP(Point of Presence)**를 운영합니다 클라이언트의 DNS 쿼리는 지리적으로 가장 가까운 PoP로 응답됩니다 실제 HTTP 요청도 그 PoP에서 종단됩니다

PoP에서 일어나는 일은 세 가지입니다

첫째로 **TLS 종단**입니다 클라이언트와의 HTTPS 세션이 PoP에서 성립합니다 Origin 서버까지 TLS가 연장되지 않아도 클라이언트 관점에서는 HTTPS가 보장됩니다

둘째로 **캐시 조회**입니다 PoP의 캐시에서 응답을 즉시 반환할 수 있으면 Origin까지 요청이 전달되지 않습니다 정적 파일이 여기서 캐시 히트되면 응답 시간은 수 밀리초 수준입니다

셋째로 **라우팅 결정**입니다 요청 경로와 설정에 따라 Pages, Workers, 또는 Origin 중 어디로 처리를 넘길지 결정합니다

### Cloudflare Pages — 정적 파일 전용 서빙 레이어

Cloudflare Pages는 정적 파일 배포에 특화된 서비스입니다 GitHub 저장소와 연동하면 push 이벤트마다 빌드를 실행하고 산출물을 Cloudflare의 분산 스토리지에 업로드합니다

**Pages의 핵심 특성은 실행 환경이 없다는 것입니다** Pages는 파일을 저장하고 서빙하는 역할만 합니다 서버 코드를 실행하거나 동적 응답을 생성하지 않습니다 모든 응답은 빌드 결과물로서 미리 존재하는 파일입니다

**SPA fallback**은 Pages의 이 특성 위에서 동작합니다 React, Vue 같은 SPA는 클라이언트 사이드 라우팅을 씁니다 `/users/123`에 직접 접근하면 서버(여기서는 Pages)는 이 경로에 해당하는 파일이 없어 404를 반환합니다 SPA fallback은 이런 상황에서 404 대신 `index.html`을 반환해 SPA가 클라이언트에서 라우팅을 처리하게 합니다

Cloudflare Pages에서 SPA fallback은 `_redirects` 파일에 다음 규칙으로 설정합니다

```text
/* /index.html 200
```

이 규칙은 Pages가 처리하는 요청, 즉 **정적 파일 서빙 영역에만** 적용됩니다 Workers가 처리하는 `/api/*` 요청에는 전혀 영향을 미치지 않습니다

### Cloudflare Workers — V8 isolate 엣지 컴퓨팅

Workers는 엣지에서 코드를 실행하는 서비스입니다 Pages와 달리 런타임이 있습니다

Workers의 런타임 모델은 **V8 isolate**입니다 Chrome 브라우저와 Node.js에서 쓰는 바로 그 JavaScript 엔진을 Cloudflare 엣지 서버에서 실행합니다

V8 isolate의 핵심 특성은 **격리와 경량성**입니다

전통적인 서버리스 함수(AWS Lambda 등)는 컨테이너 기반 실행 환경을 씁니다 컨테이너 기동(cold start)에 수백 밀리초가 걸릴 수 있습니다

V8 isolate는 OS 프로세스와 컨테이너 없이 V8 엔진 수준에서 JavaScript 실행 컨텍스트를 격리합니다 기동 시간은 수 밀리초 이하입니다 각 요청은 독립된 isolate에서 처리되므로 요청 간 상태 공유가 없습니다

Workers의 실행 흐름은 다음과 같습니다

```javascript
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // /api/* 요청만 백엔드로 프록시
    if (url.pathname.startsWith("/api/")) {
      const backendUrl = "https://dev-api.go-ti.shop" + url.pathname + url.search;
      return fetch(backendUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });
    }

    // 정적 파일은 Pages로 위임 (Workers Routes 미매칭 시 자동)
    return env.ASSETS.fetch(request);
  }
};
```

Workers는 요청을 받아 로직을 실행하고 응답을 생성하거나 다른 서비스로 프록시합니다 `env.ASSETS`는 Pages 자산에 대한 바인딩으로, Workers가 명시적으로 Pages 파일을 서빙할 수 있습니다

### 정적/동적 분리 — 라우팅 분기 구조

Pages와 Workers는 같은 도메인 아래에서 경로 기반으로 처리를 분담합니다

![Cloudflare Pages + Workers 엣지 라우팅 구조도|tall](/diagrams/goti-deepdive-cloudflare-edge-architecture-1.svg)

위 구조도는 클라이언트 요청이 엣지 PoP에서 분기되는 흐름을 보여줍니다

**엣지 PoP**는 모든 요청의 첫 진입점입니다 TLS 세션을 종단하고, 캐시를 확인하며, Workers Routes 설정에 따라 분기를 결정합니다 Cloudflare 네트워크 내부이므로 지리적으로 가장 가까운 PoP에서 처리됩니다

**Cloudflare Pages**는 정적 파일 전용 영역입니다 `/*` 경로의 기본 처리를 담당합니다 HTML, JS, CSS, 이미지를 서빙하고, SPA fallback(`/* → /index.html`)이 이 영역 안에서만 작동합니다 API 경로와는 실행 환경 자체가 분리되어 있어 fallback이 API에 영향을 줄 방법이 없습니다

**Cloudflare Workers**는 `/api/*` 경로를 처리합니다 V8 isolate 런타임에서 JavaScript 코드를 실행하고 백엔드 서버로 요청을 프록시합니다 API 응답(JSON, 상태 코드)을 그대로 클라이언트에 전달합니다 여기서 발생하는 404, 500 같은 에러 응답은 오염 없이 클라이언트에 도달합니다

**Backend**(go-ti에서는 Kind PC 위의 Istio Gateway)는 Workers로부터 프록시된 요청을 받습니다 Cloudflare 네트워크 밖에 있으므로 Workers와의 통신은 인터넷을 경유합니다

### SPA fallback 격리 — CloudFront와의 구조적 차이

이 분리가 왜 중요한지는 CloudFront와 비교하면 명확해집니다

![CloudFront Custom Error Response vs Cloudflare Pages SPA fallback 비교|tall](/diagrams/goti-deepdive-cloudflare-edge-architecture-2.svg)

위 Before/After 다이어그램은 두 CDN에서 SPA fallback이 적용되는 범위 차이를 보여줍니다

**CloudFront(Before)** 에서 Custom Error Response는 Distribution 전역 설정입니다 Behavior를 `/api/*`와 `/*`로 분리해도 Custom Error Response는 두 Behavior에 모두 적용됩니다 결과적으로 `/api/users/999`에 대한 백엔드의 404 JSON 응답을 CloudFront가 가로채 `index.html`로 교체합니다 클라이언트는 에러 대신 HTML을 받습니다

이 동작은 버그가 아니라 CloudFront의 설계입니다 Custom Error Response는 Behavior 단위 설정이 아니라 Distribution 단위 설정이기 때문입니다 Behavior별로 격리하는 공식적인 방법이 없습니다

**Cloudflare(After)** 에서 SPA fallback은 Pages 실행 환경 안의 설정입니다 Pages의 `_redirects` 규칙은 Pages가 처리하는 요청에만 적용됩니다 Workers가 처리하는 `/api/*` 경로는 Pages 실행 환경에 진입하지 않으므로 fallback 규칙이 존재조차 하지 않습니다

이 차이는 설정 방식의 차이가 아니라 **실행 환경이 분리되어 있는지의 차이**입니다 CloudFront는 하나의 Distribution이 모든 경로를 처리하므로 전역 설정이 모두에 영향을 줍니다 Cloudflare는 Pages와 Workers가 각각 독립된 서비스이므로 각 서비스의 설정은 그 서비스 안에서만 효력을 가집니다

---

## 📐 세부 동작과 옵션

### Pages 자산 서빙 — Workers에서 직접 접근

Workers를 통해 모든 라우팅을 제어하면서 Pages 파일도 서빙하는 패턴이 있습니다 Pages 커스텀 도메인 대신 Workers Routes를 통해 모든 요청을 Workers가 받고, Workers 안에서 `env.ASSETS.fetch(request)`로 Pages 자산에 접근하는 방식입니다

```javascript
// Workers에서 Pages 자산 바인딩
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      // API 요청: 백엔드 프록시
      return proxyToBackend(request, url);
    }

    // 정적 파일: Pages 자산 바인딩으로 서빙
    return env.ASSETS.fetch(request);
  }
};
```

이 패턴은 라우팅 우선순위를 Workers가 완전히 제어한다는 장점이 있습니다 Pages 커스텀 도메인과 Workers Routes가 충돌하는 상황(같은 도메인에서 Pages가 Workers보다 우선 매칭되는 문제)을 회피할 수 있습니다

### Workers 실행 제약 — isolate 모델

V8 isolate는 경량 실행을 위해 일부 기능을 제한합니다

| 특성 | 내용 |
|---|---|
| 최대 실행 시간 | 무료 플랜 10ms CPU, 유료 플랜 30s까지 |
| 메모리 | isolate당 128MB |
| 파일시스템 | 없음 — 모든 데이터는 KV, R2, D1 등 외부 스토리지 |
| Node.js API | 전체 지원 아님 — Web 표준 API(fetch, crypto 등) 중심 |
| 글로벌 상태 | isolate 간 공유 불가 — 상태는 외부 저장소로 |

Workers는 요청-응답 처리에 최적화된 런타임입니다 긴 연산이나 스트리밍 처리가 필요한 경우 실행 시간 제한이 제약이 됩니다

### SPA fallback 설정 방식 비교

| 방식 | 설정 위치 | API 경로 영향 |
|---|---|---|
| CloudFront Custom Error Response | Distribution 전역 | 있음 — API 에러도 HTML로 교체 |
| Vercel rewrite | `vercel.json` `rewrites` 블록 | 경로 필터로 `/api` 제외 가능 |
| Netlify `_redirects` | 파일, 경로 조건 가능 | 경로 필터로 `/api` 제외 가능 |
| Cloudflare Pages `_redirects` | Pages 자산 폴더 내 파일 | 없음 — Pages 영역에만 적용 |

Vercel과 Netlify도 경로 필터(`/api`로 시작하지 않는 경우만 fallback)를 설정하면 API 침범을 막을 수 있습니다 다만 이는 올바른 설정을 작성해야 하는 규율의 문제입니다 Cloudflare는 실행 환경 분리 덕분에 설정 없이 구조적으로 격리됩니다

---

## 🧩 go-ti에서는

go-ti는 CloudFront + S3 구성에서 Cloudflare Pages + Workers로 전환했습니다 전환의 직접적 계기는 CloudFront Custom Error Response가 API 에러 응답을 삼키는 문제였습니다 `/api/users/999`에 대한 404 JSON이 클라이언트에게 200 HTML로 전달되어 프론트엔드 에러 핸들링 전체가 동작하지 않는 상황이었습니다

전환 후 Workers가 `/api/*`를 처리하면서 API 에러 응답이 정상적으로 클라이언트에 전달되었습니다 Pages의 SPA fallback은 정적 파일 영역에만 격리되어 API 경로에 영향을 주지 않습니다 또한 GitHub push 시 Pages 자동 배포가 적용되어 배포 파이프라인도 단순해졌습니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [CloudFront → Cloudflare 전환 아키텍처 결정](/logs/goti-cloudflare-migration-adr)에 정리했습니다

---

## 📚 핵심 정리

- **Cloudflare Pages는 파일 서빙 전용, Workers는 코드 실행 전용입니다** 같은 도메인 아래에서 경로로 분기되지만 두 서비스는 독립된 실행 환경입니다
- **SPA fallback이 API에 침범하지 않는 이유는 설정이 아니라 구조입니다** Pages `_redirects` 규칙은 Pages 실행 환경 안에서만 적용되므로 Workers가 처리하는 경로에는 영향이 없습니다
- **V8 isolate는 컨테이너 없이 격리를 구현합니다** cold start 없이 수 밀리초 안에 실행되며, 엣지 PoP에서 직접 코드가 실행됩니다
- **CloudFront Custom Error Response는 Distribution 전역입니다** Behavior를 나눠도 전역 설정은 모든 경로에 적용됩니다 Behavior 단위 격리가 필요하다면 CDN 설계를 다시 검토해야 합니다
- **Workers는 프록시뿐 아니라 엣지 로직 실행 플랫폼입니다** rate limiting, 인증, A/B 테스트처럼 요청 경로 위에서 실행하는 모든 로직을 엣지에서 처리할 수 있습니다
