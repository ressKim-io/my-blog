---
title: "Cloudflare 전환 실전 — 5가지 라우팅 장애와 해결 과정"
excerpt: "CloudFront에서 Cloudflare로 전환하면서 만난 Custom Error Response 충돌, SSL 이중 종단, Pages 우선순위, Workers Host 헤더 제한까지 실전 트러블슈팅 기록"
category: kubernetes
tags:
  - go-ti
  - CloudFront
  - Cloudflare
  - Workers
  - Istio
  - DNS
  - SSL
  - Troubleshooting
series:
  name: "goti-cloudflare-migration"
  order: 2
date: "2026-03-27"
---

## 한 줄 요약

> Cloudflare 전환 과정에서 5가지 라우팅 장애를 만났습니다. CloudFront Custom Error Response, SSL 이중 종단, Pages/Workers 우선순위, Workers Host 헤더 제한 — 하나를 풀면 다음 문제가 나타나는 연쇄 디버깅이었습니다.

## Impact

- **영향 범위**: 소셜 로그인(카카오/구글), 전체 API 호출, Grafana 외부 접근
- **증상**: API가 JSON 대신 HTML 반환, 무한 리다이렉트, 405 Method Not Allowed, 404
- **소요 시간**: 약 8시간 (2일에 걸쳐)
- **발생일**: 2026-03-25

---

## 🔥 증상: 소셜 로그인이 깨졌다

카카오 소셜 로그인 시 프론트엔드에서 이런 에러가 발생했습니다.

```
[200] API expected JSON but received HTML.
Check PUBLIC_API_BASE_URL, dev proxy, or MSW configuration.
<!DOCTYPE html><html><head>...
url: "https://dev.go-ti.shop/api/v1/auth/KAKAO/social/verify"
```

API 응답이 JSON이 아니라 React 앱의 `index.html`이었습니다.
상태 코드는 200입니다. 에러가 아닌 것처럼 보이지만 실제로는 완전히 잘못된 응답이었습니다.

더 혼란스러운 것은 **간헐적**으로 발생한다는 점입니다.
curl로 같은 엔드포인트를 호출하면 정상 JSON이 돌아왔습니다.
백엔드가 403이나 404를 반환할 때만 트리거됐습니다.

---

## 🤔 Issue 1: CloudFront Custom Error Response가 API 에러를 삼킴

### 진단

CloudFront 배포 `EOLI11PF51LX9`의 설정을 확인했습니다.

```
Custom Error Response:
  - 403 → /index.html (200)
  - 404 → /index.html (200)
```

이것은 SPA 라우팅을 위한 설정입니다.
브라우저에서 `/products/123`을 직접 접근하면 S3가 404를 반환하는데, CloudFront가 이걸 `index.html`로 바꿔서 React Router가 처리하게 해주는 것입니다.

문제는 이 규칙이 **Distribution 전역**으로 적용된다는 것입니다.

```
Backend → 404 {"error": "User not found"}
         ↓
CloudFront → 404 감지 → index.html 반환 (200)
         ↓
Client → "왜 HTML이 오지?"
```

S3 origin이든 API origin이든 상관없이, 403이나 404가 나오면 무조건 `index.html`을 돌려줍니다.
curl에서는 정상이었던 이유도 설명됩니다 — 정상 응답(200, 400, 500)은 Custom Error Response에 해당하지 않기 때문입니다.

### 대안 검토

| 방식 | 평가 |
|------|------|
| CloudFront Function으로 패치 | Origin Response에서 경로 분기 가능하지만 근본 해결 아님 |
| S3 Website Hosting으로 전환 | OAC 보안 설정 변경 필요, 복잡도 증가 |
| **Cloudflare Pages + Workers로 전환** | SPA fallback이 Pages에 내장, API는 Workers로 완전 분리 |

CloudFront 안에서 해결하려면 Lambda@Edge나 CloudFront Functions로 우회해야 하는데, 이것은 근본적인 해결이 아닙니다.
[이전 글](/blog/goti-cloudflare-migration-adr)에서 결정한 대로 Cloudflare 전환을 진행했습니다.

---

## 🤔 Issue 2: SSL 이중 종단 — 무한 301 루프

DNS NS를 Cloudflare로 전환하면서 Proxy(Orange Cloud)가 ON인 상태에서 문제가 발생했습니다.

```
Client → Cloudflare (SSL 종단 #1, Flexible: Origin에 HTTP로 전송)
       → CloudFront (SSL 종단 #2, HTTP→HTTPS 리다이렉트)
       → Cloudflare (리다이렉트 따라감, 다시 HTTP로 전송)
       → 무한 루프
```

`dev.go-ti.shop`의 DNS가 Cloudflare IP로 해석되면서, 요청이 Cloudflare를 먼저 거칩니다.
Cloudflare Flexible SSL은 Origin에 HTTP로 연결합니다.
CloudFront는 HTTP 요청을 받으면 HTTPS로 리다이렉트합니다.
Cloudflare가 그 리다이렉트를 따라가서 다시 HTTP로 보내고... 끝없이 반복됩니다.

### 해결

이 문제는 CloudFront를 완전히 걷어내면서 자연스럽게 해결됐습니다.
Cloudflare가 유일한 CDN/프록시가 되면서 SSL 종단이 한 곳에서만 발생합니다.

만약 두 CDN을 병행해야 하는 상황이라면:
- 각각 **독립된 도메인**을 사용하거나
- 직렬 구조에서는 **첫 번째만 SSL 종단**, 두 번째는 HTTP 허용으로 설정해야 합니다

---

## 🤔 Issue 3: Pages Custom Domain이 Workers Route보다 우선

Cloudflare Pages에 프론트엔드를 배포하고, Workers route를 `dev.go-ti.shop/api/*`로 설정했습니다.
기대한 동작은 이거였습니다:

```
dev.go-ti.shop/api/* → Workers (API 프록시)
dev.go-ti.shop/*     → Pages (SPA)
```

실제로는 이렇게 됐습니다:

```bash
POST https://dev.go-ti.shop/api/v1/auth/reissue
→ 405 Method Not Allowed
```

Pages가 **모든 요청을 먼저 가로챘습니다**.
Pages는 정적 파일만 서빙하니까 POST 요청에 405를 반환한 것입니다.

Cloudflare Pages에 커스텀 도메인을 설정하면, 같은 도메인의 Workers route보다 **Pages가 우선**합니다.
이것은 공식 문서에 명확히 나와있지 않아서 직접 겪어야 알 수 있는 부분입니다.

### 해결

```
1. Pages에서 커스텀 도메인(dev.go-ti.shop) 제거
2. Workers route를 dev.go-ti.shop/* (전체)로 변경
3. Worker 코드에서 /api/* → Kind PC, 나머지 → Pages *.pages.dev로 분기
```

Workers가 모든 요청의 진입점이 되고, 정적 파일 요청은 Pages의 `.pages.dev` URL로 프록시하는 구조로 바꿨습니다.

---

## 🤔 Issue 4: Workers fetch() Host 헤더 제한

Workers가 요청을 가로채는 것은 성공했지만, Kind PC로 프록시할 때 또 문제가 생겼습니다.

### 디버깅 단계

하나씩 검증해봤습니다.

**Step 1: Worker 코드 실행 확인**
```javascript
return new Response('Worker OK');
// → 200 OK ✅
```
Worker 자체는 정상 동작합니다.

**Step 2: DDNS로 프록시 시도**
```javascript
fetch('http://resshome.iptime.org/api/...', {
  headers: { 'Host': 'dev.go-ti.shop' }
});
// → 404 (751ms) ❌
```
Kind PC까지 도달했습니다 (응답 시간 751ms로 확인).
하지만 Istio Gateway가 404를 반환합니다.
Host 헤더가 `resshome.iptime.org`로 전송되니까 Istio가 매칭하지 못한 것입니다.

**Step 3: IP 직접 접근 시도**
```javascript
fetch('http://118.38.182.85/api/...', {
  headers: { 'Host': 'dev.go-ti.shop' }
});
// → 403 Error 1003 ❌
```
Cloudflare가 bare IP 접근을 차단합니다.

**Step 4: curl로 동일 요청 확인**
```bash
$ curl -H "Host: dev.go-ti.shop" http://resshome.iptime.org:80/api/v1/health
# → 200 JSON ✅
```

curl에서는 Host 헤더 오버라이드가 정상 동작합니다.
**Workers fetch()에서만 Host 헤더가 무시**되는 거였습니다.

### 원인

Workers의 `fetch()` 함수는 URL의 hostname을 Host 헤더로 사용하며, 명시적으로 전달한 Host 헤더를 **무시**합니다.
이것은 Cloudflare의 의도적인 보안 정책입니다.

```javascript
// ❌ Headers의 Host가 무시됨
await fetch("https://resshome.iptime.org/api/...", {
  headers: { "Host": "dev-api.go-ti.shop" }
});
// 실제 전송: Host: resshome.iptime.org

// ✅ URL hostname이 곧 Host
await fetch("https://dev-api.go-ti.shop/api/...");
// 실제 전송: Host: dev-api.go-ti.shop
```

---

## ✅ 해결: dev-api 중간 도메인 도입

### 구조

```
dev-api.go-ti.shop → CNAME resshome.iptime.org (Cloudflare Proxy ON, SSL Flexible)
```

Workers에서 `dev-api.go-ti.shop`으로 요청을 보내면:
1. URL hostname이 `dev-api.go-ti.shop`이니까 Host 헤더도 `dev-api.go-ti.shop`
2. Cloudflare Proxy가 CNAME을 따라 `resshome.iptime.org`의 IP로 연결
3. Istio Gateway가 `dev-api.go-ti.shop`을 매칭 → VirtualService 라우팅 성공

### 적용한 수정

**Cloudflare 설정:**
- `dev-api.go-ti.shop` DNS 레코드 추가 (CNAME → resshome.iptime.org, Proxy ON)
- Configuration Rules로 `dev-api.go-ti.shop` SSL Flexible 개별 설정

**Istio 설정 (7파일 수정):**
- Gateway hosts에 `dev-api.go-ti.shop` 추가
- 각 서비스(user, ticketing, payment, stadium, resale) VirtualService hosts 추가
- swagger-ui VirtualService hosts 추가

**Workers 최종 코드:**

```javascript
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith('/api/') || path.startsWith('/grafana/')) {
      const target = 'https://dev-api.go-ti.shop' + url.pathname + url.search;
      try {
        const resp = await fetch(target, {
          method: request.method,
          headers: {
            'Accept': request.headers.get('Accept') || '*/*',
            'Content-Type': request.headers.get('Content-Type') || '',
            'Authorization': request.headers.get('Authorization') || '',
            'Cookie': request.headers.get('Cookie') || '',
          },
          body: request.body,
        });
        return new Response(resp.body, {
          status: resp.status,
          headers: resp.headers,
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response('Not Found', { status: 404 });
  }
};
```

핵심은 `fetch(target, ...)`에서 target URL의 hostname이 `dev-api.go-ti.shop`이라는 것입니다.
이렇게 하면 Workers의 보안 정책에 의해 Host 헤더가 자동으로 `dev-api.go-ti.shop`이 됩니다.

---

## 🔍 최종 아키텍처

```
브라우저
  ├─ dev.go-ti.shop (정적 파일)
  │   → Cloudflare Pages (*.pages.dev)
  │
  ├─ dev.go-ti.shop/api/*
  │   → Workers → dev-api.go-ti.shop → Kind PC (Istio → 각 서비스)
  │
  ├─ dev.go-ti.shop/grafana/*
  │   → Workers → grafana.go-ti.shop → Kind PC (Istio → Grafana)
  │
  └─ dev-api.go-ti.shop (직접 API 테스트용)
      → Cloudflare Proxy (Flexible) → resshome.iptime.org:80 → Istio Gateway
```

---

## 📚 배운 점

### 5가지 문제의 연쇄 관계

이번 트러블슈팅에서 인상적이었던 것은 **문제가 연쇄적으로 나타났다**는 점입니다.

1. CloudFront Custom Error Response 문제 발견 → Cloudflare 전환 결정
2. DNS 전환하니까 → SSL 이중 종단 무한 루프
3. CloudFront 걷어내니까 → Pages가 API 요청을 가로챔 (405)
4. Workers를 진입점으로 바꾸니까 → Host 헤더 문제로 Istio 404
5. 중간 도메인 도입으로 → 최종 해결

한 문제를 풀면 다음 문제가 드러나는 구조였습니다.
이것은 CDN 전환처럼 여러 레이어가 동시에 바뀌는 작업에서 흔한 패턴입니다.

### 디버깅 원칙: 한 레이어씩 확인

Workers 디버깅에서 가장 도움이 된 것은 **한 레이어씩 확인하는 방법**이었습니다.

```
Step 1: Worker 자체가 동작하는가? → return new Response('OK')
Step 2: Origin에 도달하는가? → 응답 시간으로 확인 (751ms = 도달)
Step 3: Origin이 올바르게 응답하는가? → curl로 직접 확인
Step 4: Workers와 curl의 차이는? → Host 헤더
```

각 단계에서 하나의 변수만 바꿔가며 확인하면 원인을 좁힐 수 있습니다.

### CDN 전환 시 체크리스트

이번 경험을 바탕으로 CDN 전환 체크리스트를 정리했습니다.

- [ ] Custom Error Response / fallback이 API 경로에 영향 주는지 확인
- [ ] CDN 체인에서 SSL 종단 지점이 하나인지 확인
- [ ] Pages/Functions와 Workers의 라우팅 우선순위 확인
- [ ] Workers/Edge Functions의 Host 헤더 동작 확인
- [ ] Origin의 Host-based 라우팅(Istio, nginx 등) 설정 업데이트
- [ ] OAuth redirect URI 환경변수 업데이트
