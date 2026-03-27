---
date: 2026-03-25
category: troubleshoot
project: goti-team-controller, Goti-k8s, Goti-monitoring, Goti-front
tags: [cloudflare, cloudfront, workers, istio, dns, ssl, oauth, custom-error-response, host-header]
---

# Cloudflare 전환 중 API 라우팅 실패 — CloudFront Custom Error Response + Workers Host 헤더 + dev-api 경유 해결

## Context

- 기존: `dev.go-ti.shop` → Route53 → CloudFront → S3(프론트) + Kind PC(API via `/api/*`)
- 목표: CloudFront에서 Cloudflare(Pages + Workers)로 전환
- 배경: go-ti.shop 도메인의 NS를 Cloudflare로 이전 완료 (2026-03-23). 프론트엔드를 Cloudflare Pages로 이전, API는 Workers로 프록시하여 Kind PC에 연결

## Issue

### Issue 1: CloudFront Custom Error Response가 API 응답을 덮어씌움

소셜 로그인(카카오) 시 프론트엔드에서 다음 에러 발생:

```
[200] API expected JSON but received HTML. Check PUBLIC_API_BASE_URL, dev proxy, or MSW configuration.
<!DOCTYPE html><html><head>...
url: "https://dev.go-ti.shop/api/v1/auth/KAKAO/social/verify"
```

- 브라우저에서 API 호출 시 200 상태코드와 함께 index.html(React 앱) 반환
- curl로 동일 엔드포인트 호출 시 정상 JSON 응답 (400/500)
- 간헐적 발생 — 백엔드가 403/404 반환 시에만 트리거

### Issue 2: Cloudflare proxy ON 상태에서 SSL 이중 종단

```
dev.go-ti.shop → Cloudflare(proxy ON) → CloudFront → Origin
                  SSL 종단 #1          SSL 종단 #2
```

- `dev.go-ti.shop` DNS가 Cloudflare IP(104.26.10.42, 104.26.11.42)로 해석
- 이전 인시던트(2026-03-24)에서 DNS Only로 전환했으나 다시 proxy ON 상태

### Issue 3: api.go-ti.shop CloudFront 배포 미존재

```
curl -sI https://api.go-ti.shop/
HTTP/2 530  ← Cloudflare Error: Origin DNS Error
```

- `api.go-ti.shop`에 대한 CloudFront 배포가 없음
- Cloudflare proxy ON이지만 origin 미설정 → 530 에러

### Issue 4: Cloudflare Pages 전환 후 API 405/404

Cloudflare Pages로 프론트엔드 이전 후:

```
POST https://dev.go-ti.shop/api/v1/auth/reissue
Status Code: 405 Method Not Allowed
```

- Pages는 정적 파일만 서빙 → POST 요청 처리 불가
- Workers route(`dev.go-ti.shop/api/*`) 설정했으나 Pages custom domain이 우선 처리

### Issue 5: Workers fetch()에서 Host 헤더 override 불가

Workers에서 Kind PC로 직접 프록시 시도:

```javascript
// 시도 1: DDNS 호스트명
fetch('http://resshome.iptime.org/api/...', {
  headers: { 'Host': 'dev.go-ti.shop' }
});
// 결과: 404 (wallTimeMs: 751ms — Kind PC 도달했으나 Istio가 Host 미매칭)

// 시도 2: IP 직접 사용
fetch('http://118.38.182.85/api/...', {
  headers: { 'Host': 'dev.go-ti.shop' }
});
// 결과: 403 Error 1003 (Cloudflare: Direct IP Access Not Allowed)
```

- Cloudflare Workers의 `fetch()`가 명시적 Host 헤더를 무시하고 URL hostname을 Host로 사용
- Istio Gateway는 `dev.go-ti.shop`만 인식 → `resshome.iptime.org` Host로 오면 404
- bare IP 접근은 Cloudflare가 차단 (Error 1003)

재현 조건:
1. Cloudflare Workers에서 외부 origin으로 fetch 시 Host 헤더 커스텀 설정
2. Origin이 Istio Gateway처럼 Host-based 라우팅을 사용하는 경우

## Action

### 진단 과정

**1단계: CloudFront 구조 분석**

- CloudFront 배포 `EOLI11PF51LX9` 확인:
  - Default behavior → S3 (프론트엔드, OAC)
  - `/api/*` behavior → Kind PC (`resshome.iptime.org:80`)
  - Custom Error Response: 403→index.html(200), 404→index.html(200)
- Custom Error Response가 **전역 적용** (S3와 Kind PC origin 모두에 영향)
  - S3용 SPA 라우팅 의도이나, Kind PC API 에러까지 덮어씌움

→ 결과: CloudFront Custom Error Response가 API 에러를 HTML로 변환하는 것이 Issue 1의 근본 원인

**2단계: Cloudflare 전환 결정**

CloudFront의 Custom Error Response는 per-behavior 설정 불가 (전역만 가능). 대안 비교:
- CloudFront Function으로 패치 → 근본 해결 아님
- S3 Website Hosting 전환 → OAC 보안 설정 변경 필요
- **Cloudflare Pages + Workers로 전환** → SPA fallback 내장, API 프록시 분리

→ 결정: Cloudflare 전환

**3단계: Cloudflare Pages 배포 + Workers 설정**

- Cloudflare Pages에 프론트엔드 배포 (GitHub 연동)
- Workers route `dev.go-ti.shop/api/*` 설정
- 가설: Workers route가 Pages보다 우선 처리됨
- → 결과: **Pages custom domain이 Workers route보다 우선** → 405 Method Not Allowed (Issue 4)

**4단계: Workers를 전체 진입점으로 변경 시도**

- Workers route를 `dev.go-ti.shop/*`로 변경
- Worker 코드에서 `/api/*` → Kind PC, 나머지 → Pages `.pages.dev`로 분기
- Pages에서 custom domain 제거

→ 결과: Worker가 요청을 가로채기 시작. 그러나 Kind PC 프록시에서 404 발생 (Issue 5)

**5단계: Host 헤더 문제 디버깅**

단계별 디버그:
1. `return new Response('Worker OK')` → 200 OK ✅ (Worker 코드 실행 확인)
2. `fetch('http://resshome.iptime.org/...', { Host: 'dev.go-ti.shop' })` → 404 (751ms) ❌
3. `fetch('http://118.38.182.85/...', { Host: 'dev.go-ti.shop' })` → 403 Error 1003 ❌
4. `curl -H "Host: dev.go-ti.shop" http://resshome.iptime.org:80/api/...` → 200 JSON ✅

→ 결론: Workers fetch()가 Host 헤더를 URL hostname으로 덮어씌움. curl에서는 정상이나 Workers 내부에서만 재현

**6단계: dev-api.go-ti.shop 경유 방식 발견**

- Cloudflare DNS에 `dev-api.go-ti.shop` → CNAME `resshome.iptime.org` (proxy ON, SSL Flexible) 추가
- Istio Gateway + VirtualService에 `dev-api.go-ti.shop` 호스트 추가
- Workers에서 `fetch('https://dev-api.go-ti.shop/api/...')` → Cloudflare가 자동으로 Host: dev-api.go-ti.shop 설정 → Istio 매칭 성공

→ 결과: 200 OK, JSON 정상 반환 ✅

### 근본 원인 (Root Cause)

**복합 원인:**

1. **CloudFront Custom Error Response 전역 적용**: SPA용 403/404→index.html 규칙이 API origin에도 적용되어 백엔드 에러가 HTML로 변환
2. **Cloudflare Workers fetch() Host 헤더 제한**: Workers의 fetch()가 명시적 Host 헤더 override를 무시하고 URL hostname 사용. bare IP 접근은 Error 1003으로 차단
3. **Cloudflare Pages custom domain 우선순위**: Pages custom domain이 Workers route보다 우선 처리되어 API 요청이 Pages로 라우팅

### 적용한 수정

**인프라 (Cloudflare):**
- Cloudflare Pages에 프론트엔드 배포 (GitHub 연동, `dev.go-ti.shop`)
- Cloudflare Workers를 API 프록시로 설정 (route: `dev.go-ti.shop/api/*`, `dev.go-ti.shop/grafana/*`)
- Workers가 `dev-api.go-ti.shop` 경유로 Kind PC에 프록시 (Host 헤더 자동 해결)
- `dev-api.go-ti.shop` DNS 레코드 추가 (CNAME → resshome.iptime.org, proxy ON, SSL Flexible)
- Configuration Rules로 `dev-api.go-ti.shop` SSL Flexible 개별 설정

**Goti-k8s (7파일 수정):**
- `infrastructure/dev/istio/gateway/values-dev.yaml`: Gateway hosts에 `dev-api.go-ti.shop` 추가
- `environments/dev/goti-user/values.yaml`: VirtualService hosts 추가
- `environments/dev/goti-ticketing/values.yaml`: VirtualService hosts 추가
- `environments/dev/goti-payment/values.yaml`: VirtualService hosts 추가
- `environments/dev/goti-stadium/values.yaml`: VirtualService hosts 추가
- `environments/dev/goti-resale/values.yaml`: VirtualService hosts 추가
- `environments/dev/swagger-ui/values.yaml`: VirtualService hosts 추가

**Cloudflare Workers 최종 코드:**
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

**프론트엔드 환경변수:**
- Cloudflare Pages Settings에 OAuth 환경변수 설정 (기존 AWS SSM에서 이전)
- `PUBLIC_GOOGLE_CLIENT_ID`, `PUBLIC_GOOGLE_REDIRECT_URI` 등

## Result

**해결됨:**
- `dev.go-ti.shop/api/*` → Workers → `dev-api.go-ti.shop` → Kind PC: **200 JSON 정상**
- `dev-api.go-ti.shop` 직접 API 호출: **200 JSON 정상**
- Google/Kakao 소셜 로그인: **정상 동작** (환경변수 설정 후)
- CloudFront Custom Error Response 문제: **Cloudflare 전환으로 근본 해결**

**미완료:**
- Tempo metricsGenerator ring 이슈: 별도 트러블슈팅 (legacy overrides format 통일로 해결 예정)

**추가 해결 (Grafana 라우팅):**
- `dev.go-ti.shop/grafana/` → Worker(`goti-dev-grafana-proxy`) → `grafana.go-ti.shop` → Kind PC: **정상 동작**
- `grafana.go-ti.shop` DNS + SSL Flexible + Istio Gateway/VirtualService 호스트 추가로 해결
- `dev-api.go-ti.shop`은 API 트래픽 테스트 전용, Grafana와 분리

**재발 방지책:**
1. Cloudflare Workers에서 외부 origin 프록시 시 **Host 헤더를 직접 설정하지 말고**, 별도 서브도메인(dev-api)을 경유하여 Cloudflare가 자동 설정하도록 함
2. CDN 수준의 Custom Error Response는 **전역 적용되는 점** 인지 — API와 프론트엔드가 같은 배포에 있으면 충돌 가능
3. Cloudflare Pages custom domain은 Workers route보다 우선 → **같은 도메인에서 Pages + Workers 혼용 시 Pages custom domain 제거 필요**

## Architecture (최종)

```
브라우저
  ├─ dev.go-ti.shop (정적 파일) → Cloudflare Pages
  ├─ dev.go-ti.shop/api/*       → Cloudflare Workers → dev-api.go-ti.shop → Kind PC
  ├─ dev.go-ti.shop/grafana/*   → Cloudflare Workers(goti-dev-grafana-proxy) → grafana.go-ti.shop → Kind PC
  ├─ grafana.go-ti.shop         → Cloudflare proxy(Flexible) → resshome.iptime.org:80 → Istio Gateway → Grafana
  └─ dev-api.go-ti.shop         → Cloudflare proxy(Flexible) → resshome.iptime.org:80 → Istio Gateway (API 전용)
```

## Related Files

- `Goti-k8s/infrastructure/dev/istio/gateway/values-dev.yaml`
- `Goti-k8s/environments/dev/goti-{user,ticketing,payment,stadium,resale}/values.yaml`
- `Goti-k8s/environments/dev/swagger-ui/values.yaml`
- `Goti-monitoring/charts/goti-monitoring/templates/istio-gateway.yaml` (미수정, 추가 필요)
- `Goti-front/src/shared/api/client.ts`
- `Goti-front/src/shared/config/oauth.ts`
- `Goti-front/rsbuild.config.ts`
