---
title: "CloudFront에서 Cloudflare로 — CDN 전환을 결정한 이유"
excerpt: "CloudFront Custom Error Response가 API 에러를 삼키는 구조적 한계를 발견하고, Cloudflare Pages + Workers로 전환한 아키텍처 결정 과정"
category: kubernetes
tags:
  - go-ti
  - CloudFront
  - Cloudflare
  - CDN
  - Workers
  - DNS
  - SSL
  - Architecture Decision Record
  - adr
series:
  name: "goti-cloudflare-migration"
  order: 1
date: "2026-03-27"
---

## 한 줄 요약

> CloudFront Custom Error Response가 API 404까지 HTML로 덮어쓰는 구조적 한계를 발견했습니다. Cloudflare Pages + Workers로 전환하면서 API/SPA 라우팅을 완전히 분리하고, 비용도 0원으로 줄였습니다.

---

## 🔥 문제: CloudFront가 API 에러를 삼킨다

### 기존 아키텍처

```
Client → CloudFront → S3 (React SPA, 정적 파일)
                    → Kind PC (API, /api/*)
```

CloudFront Behavior로 경로를 나눠서 라우팅했습니다.
`/api/*`는 Kind PC(Istio Gateway)로, 나머지는 S3로 보내는 구조였습니다.

SPA 라우팅을 위해 Custom Error Response도 설정했습니다.
브라우저에서 `/products/123` 같은 경로를 직접 접근하면 S3가 404를 반환하니까, CloudFront가 이걸 `index.html`로 바꿔주는 설정입니다.

### 발견한 문제

CloudFront Custom Error Response는 **Behavior 단위가 아니라 Distribution 전역**으로 적용됩니다.

```bash
# 기대한 동작
GET /api/users/999 → 404 {"error": "User not found"}

# 실제 동작
GET /api/users/999 → 200 <!DOCTYPE html>...
```

API가 404를 반환하면 CloudFront가 이걸 가로채서 S3의 `index.html`을 대신 돌려줍니다.
프론트엔드 에러 핸들링이 전부 깨졌습니다.
JSON을 기대하는 클라이언트가 HTML을 받으니 파싱 에러가 연쇄적으로 발생했습니다.

이것은 설정 실수가 아니라 **CloudFront의 구조적 한계**입니다.

AWS 공식 문서에서도 Custom Error Response를 Distribution 최상위 레벨에서만 설정하게 되어 있습니다.
CacheBehavior 하위에 넣을 수 있는 옵션이 아닙니다.
[AWS 문서](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/GeneratingCustomErrorResponses.html)에서 이 제약을 확인할 수 있지만, 명시적으로 "Behavior별로 분리할 수 없다"고 적혀있지는 않아서 직접 겪어봐야 알 수 있는 함정입니다.

### 추가 문제: DNS 전환 중 무한 301 루프

Cloudflare로 전환을 시도하는 과정에서 또 다른 문제를 만났습니다.
Route53 NS를 Cloudflare NS로 바꾸면서 Cloudflare Proxy(Orange Cloud)가 활성화되니까:

```
Client → Cloudflare (SSL 종단 #1, HTTP→HTTPS 리다이렉트)
       → CloudFront (SSL 종단 #2, HTTP→HTTPS 리다이렉트)
       → 무한 301 루프
```

Cloudflare의 Flexible SSL은 Origin에 HTTP로 연결합니다.
CloudFront는 HTTP 요청을 받으면 HTTPS로 리다이렉트합니다.
Cloudflare는 그 리다이렉트를 따라가서 다시 HTTP로 보내고... 끝없이 반복됩니다.

**CDN 체인에서 SSL 종단은 한 곳에서만 해야 한다** — 이건 Cloudflare+CloudFront만의 문제가 아니라 모든 이중 프록시 구조에서 동일하게 발생합니다.

---

## 🤔 대안 비교

### CDN/호스팅 플랫폼

| 항목 | CloudFront + S3 | **Cloudflare Pages + Workers** | Vercel | Netlify |
|------|----------------|-------------------------------|--------|---------|
| SPA fallback | Custom Error Response (전역) | **Pages 내장 (정적 파일만)** | 내장 | 내장 |
| API 프록시 | Behavior + Origin (같은 Distribution) | **Workers (분리된 실행 환경)** | Rewrites/Functions | Functions |
| 비용 (dev) | ~$1-5/월 | **무료** | 무료 (Hobby) | 무료 |
| GitHub 연동 | Actions/CodePipeline | **Pages 자동 배포** | 자동 | 자동 |
| SSL 관리 | ACM (수동 갱신) | **자동 (Edge 인증서)** | 자동 | 자동 |
| 에지 컴퓨팅 | Lambda@Edge | **Workers (V8 isolate)** | Edge Functions | Edge Functions |
| DNS 통합 | Route53 별도 | **Cloudflare DNS 통합** | 별도 | 별도 |

이 표에서 핵심은 **SPA fallback 범위**입니다.

CloudFront는 Custom Error Response가 Distribution 전역이라 API 에러까지 삼킵니다.
반면 Cloudflare Pages의 SPA fallback은 **정적 파일 서빙에만 적용**되고, Workers는 완전히 별도의 실행 환경입니다.
구조적으로 API와 SPA가 분리되어 있어서 CloudFront에서 겪은 문제가 원천 차단됩니다.

Vercel과 Netlify도 SPA fallback 문제는 없지만, Cloudflare를 선택한 추가 이유가 있습니다.
DNS + CDN + 에지 컴퓨팅이 단일 대시보드에서 관리되고, Workers의 V8 isolate는 Lambda@Edge보다 cold start가 빠릅니다.
그리고 dev 환경에서 비용이 **0원**입니다.

### API 라우팅: Workers Host 헤더 문제

Workers에서 Kind PC(Istio Gateway)로 프록시할 때 **Host 헤더**가 핵심 난관이었습니다.
세 가지 방식을 시도했습니다.

| 방식 | 동작 | 결과 |
|------|------|------|
| Workers → 직접 IP (`118.38.x.x`) | Cloudflare Error 1003: Direct IP Access Not Allowed | **실패** |
| Workers → DDNS + Host 오버라이드 | `fetch()`가 Host 오버라이드 무시 | **실패** (Istio 404) |
| Workers → Cloudflare Proxy 도메인 | Cloudflare가 `Host: dev-api.go-ti.shop` 자동 설정 | **성공** |

첫 번째 시도부터 살펴보겠습니다.

Workers에서 Origin IP로 직접 요청을 보내면 Cloudflare가 **Error 1003**을 반환합니다.
Cloudflare는 보안 정책상 IP 직접 접근을 차단합니다.

두 번째 시도에서는 DDNS 도메인으로 보내면서 Host 헤더를 오버라이드하려 했습니다.

```javascript
// ❌ Host 오버라이드가 무시됨
await fetch("https://resshome.iptime.org/api/...", {
  headers: { "Host": "dev-api.go-ti.shop" }
});
// 실제 전송되는 Host: resshome.iptime.org
```

Workers의 `fetch()`는 **URL의 hostname을 Host 헤더로 사용하며, 오버라이드가 불가능**합니다.
이것은 Cloudflare의 의도적인 보안 정책입니다.

Cloudflare Workers 기술 리드인 Kenton Varda가 [커뮤니티 포럼](https://community.cloudflare.com/t/not-possible-to-override-the-host-header-on-workers-requests/13077)에서 이유를 설명했는데, 많은 고객이 Cloudflare IP만 허용하고 Host 헤더로 보안 설정이 적용되었음을 검증하기 때문에, 임의 Host 오버라이드를 허용하면 이 신뢰 모델이 무너진다는 것입니다.

공식 문서에서는 이 제약이 명시적으로 안내되지 않아서 디버깅에 시간이 꽤 들었습니다.

세 번째 시도에서 **전용 중간 도메인**을 도입해서 해결했습니다.

```javascript
// ✅ URL hostname이 Host가 됨
await fetch("https://dev-api.go-ti.shop/api/...");
// 실제 전송되는 Host: dev-api.go-ti.shop
```

`dev-api.go-ti.shop`이라는 Cloudflare Proxy가 켜진 도메인을 만들고, Workers가 이 도메인으로 요청을 보내면 Cloudflare가 자동으로 올바른 Host 헤더를 설정합니다.
Istio Gateway가 `dev-api.go-ti.shop`을 매칭하도록 설정하면 됩니다.

### SSL 전략: Flexible vs Full vs Strict

| 모드 | Cloudflare → Origin | 인증서 요구 | 적합 환경 |
|------|---------------------|-----------|----------|
| **Flexible** | HTTP (평문) | 없음 | dev (Kind PC, 인증서 없음) |
| Full | HTTPS (자체 서명 허용) | 자체 서명 | staging |
| Strict | HTTPS (유효 인증서 필수) | CA 서명 | production |

Kind PC는 가정 네트워크의 DDNS 뒤에 있어서 유효한 SSL 인증서가 없습니다.
Client → Cloudflare 구간은 Edge 인증서로 HTTPS가 보장되니까, dev 환경에서는 Flexible로 충분합니다.

> ⚠️ prod 환경에서는 반드시 Full 이상 사용해야 합니다. cert-manager + Let's Encrypt로 Origin 인증서를 발급하면 됩니다.

---

## ✅ 결정: Cloudflare Pages + Workers + 전용 중간 도메인

### 최종 아키텍처

```
                     ┌─ dev.go-ti.shop ──────────────────┐
                     │                                    │
                     │  정적 파일 → Cloudflare Pages      │
                     │  /api/*    → Workers               │
                     │  /grafana/* → Workers              │
                     │                                    │
                     └────────────┬───────────────────────┘
                                  │ Workers fetch()
                                  ▼
                     ┌─ dev-api.go-ti.shop ──────────────┐
                     │  Cloudflare Proxy ON               │
                     │  SSL: Flexible                     │
                     │  Origin: resshome.iptime.org:31080 │
                     │  Host: dev-api.go-ti.shop (자동)   │
                     └────────────┬───────────────────────┘
                                  │
                                  ▼
                     ┌─ Kind PC ─────────────────────────┐
                     │  Istio Gateway                     │
                     │  hosts:                            │
                     │    - dev.go-ti.shop                │
                     │    - dev-api.go-ti.shop            │
                     │    - grafana.go-ti.shop            │
                     │  VirtualService → K8s Services     │
                     └────────────────────────────────────┘
```

아키텍처를 위에서부터 따라가보겠습니다.

1. 클라이언트가 `dev.go-ti.shop`으로 접속합니다.
2. 정적 파일 요청은 **Cloudflare Pages**가 직접 서빙합니다. SPA fallback도 여기서만 동작합니다.
3. `/api/*` 또는 `/grafana/*` 요청은 **Workers**가 가로챕니다.
4. Workers는 `dev-api.go-ti.shop`으로 `fetch()`를 보냅니다. URL hostname이 곧 Host 헤더가 되니까 Istio가 올바르게 매칭할 수 있습니다.
5. Cloudflare Proxy가 DDNS를 통해 Kind PC의 Istio Gateway로 전달합니다.
6. Istio VirtualService가 경로별로 적절한 K8s Service에 라우팅합니다.

핵심은 **Pages와 Workers가 완전히 분리된 실행 환경**이라는 것입니다.
Pages에서 SPA fallback이 발생해도 Workers를 거치는 API 요청에는 영향이 없습니다.
CloudFront에서 겪었던 "API 에러를 HTML로 덮어쓰는" 문제가 구조적으로 불가능해진 것입니다.

### 트레이드오프

모든 아키텍처 결정에는 대가가 있습니다. 이번 전환에서 인정한 트레이드오프를 정리했습니다.

**중간 도메인 복잡성**: `dev-api.go-ti.shop`은 순수히 Host 헤더 문제를 해결하기 위해 존재합니다. 아키텍처적으로 깔끔하지 않지만, Workers의 fetch() 제약을 우회하는 유일한 방법입니다.

**SSL Flexible 보안 약점**: Origin 구간이 평문 통신입니다. dev 환경 한정으로 허용했지만, prod에서는 절대 사용하면 안 됩니다.

**Cloudflare 의존도 증가**: DNS + CDN + Pages + Workers 전부 Cloudflare에 올라갔습니다. 단, 정적 파일은 어디서든 서빙 가능하고 Workers 로직은 표준 Fetch API라 이식은 가능합니다.

**IaC 부재**: 현재 Cloudflare 설정은 UI/Wrangler CLI로 관리하고 있습니다. Terraform Cloudflare Provider로 전환할 예정입니다.

---

## 📊 전환 결과

| 항목 | Before (CloudFront) | After (Cloudflare) |
|------|---------------------|---------------------|
| API 에러 응답 | HTML로 덮어쓰임 | **JSON 정상 반환** |
| 비용 | ~$1-5/월 | **$0** |
| 배포 | GitHub Actions → S3 | **GitHub push → 자동** |
| SSL 관리 | ACM 수동 | **자동 갱신** |
| Grafana 외부 접근 | 별도 구성 필요 | **Workers 라우트로 해결** |

---

## 📚 교훈 3가지

### 1. CDN 이중 종단은 무한 루프를 만든다

두 개의 CDN/프록시가 각각 HTTP→HTTPS 리다이렉트를 강제하면 무한 301 루프가 발생합니다.
Cloudflare + CloudFront만의 문제가 아니라, nginx + Cloudflare, CloudFront + ALB 등 **모든 이중 프록시 구조**에서 동일합니다.

```
해결 원칙: CDN 체인에서 SSL 종단은 한 곳에서만.
병렬 (각각 독립 도메인): 문제 없음
직렬 (체인 구조): 첫 번째만 SSL 종단, 나머지는 패스스루
```

Cloudflare 공식 문서의 [ERR_TOO_MANY_REDIRECTS 트러블슈팅](https://developers.cloudflare.com/ssl/troubleshooting/too-many-redirects/) 가이드에서 이 패턴을 자세히 다루고 있습니다.

### 2. Workers fetch()의 Host 헤더는 URL hostname이다

```javascript
// ❌ Host 오버라이드 무시됨 — Cloudflare 보안 정책
await fetch("https://resshome.iptime.org/api/...", {
  headers: { "Host": "dev-api.go-ti.shop" }
});
// 실제 전송: Host: resshome.iptime.org

// ✅ URL hostname이 곧 Host
await fetch("https://dev-api.go-ti.shop/api/...");
// 실제 전송: Host: dev-api.go-ti.shop
```

이 동작은 의도적인 보안 정책이지만, 공식 문서에 명시적으로 안내되지 않습니다.
[Workers 커뮤니티 포럼](https://community.cloudflare.com/t/not-possible-to-override-the-host-header-on-workers-requests/13077)에서만 확인할 수 있습니다.

Enterprise 고객이라면 Page Rules로 Host 헤더 오버라이드가 가능하지만, 그 외에는 중간 도메인(CNAME) 방식이 유일한 우회책입니다.

### 3. Pages 커스텀 도메인은 Workers 라우트보다 우선한다

Cloudflare Pages에 커스텀 도메인(`dev.go-ti.shop`)을 설정하면, 같은 도메인의 Workers 라우트(`dev.go-ti.shop/api/*`)보다 **Pages가 먼저 매칭**됩니다.
API 요청이 Pages로 가면서 405 Method Not Allowed가 발생했습니다.

```
해결: Pages 커스텀 도메인 제거
→ Workers가 모든 라우트 처리
→ 정적 파일은 Workers에서 Pages *.pages.dev URL로 프록시
```

이 우선순위 규칙도 공식 문서에 명확히 나와있지 않습니다. 직접 겪어봐야 알 수 있는 부분입니다.

---

## 🔮 향후 과제

- Cloudflare Terraform Provider로 DNS/Workers/Pages 설정 IaC화
- prod 환경: SSL Full/Strict + cert-manager Origin 인증서
- Workers에 rate limiting / bot detection 로직 추가
- 기존 CloudFront Distribution + S3 bucket 정리

---

## 다음 글 예고

이 글에서는 "왜 Cloudflare로 전환했는가"라는 의사결정을 다뤘습니다.
다음 글에서는 **실제 전환 과정에서 만난 5가지 라우팅 문제**와 해결 과정을 자세히 다룹니다.
