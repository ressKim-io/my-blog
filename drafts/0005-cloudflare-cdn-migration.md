# CloudFront → Cloudflare 전환 아키텍처 결정 (ADR)

작성일: 2026-03-27
상태: Accepted
프로젝트: Goti (대규모 티켓팅 서비스)

---

## Decision Summary

| 결정 항목 | 선택 | 대안 | 핵심 근거 |
|-----------|------|------|-----------|
| CDN/프록시 | **Cloudflare (Pages + Workers)** | CloudFront + S3, Vercel, Netlify | Custom Error Response 구조적 한계, API/정적파일 라우팅 분리 |
| DNS 권한 | **Cloudflare NS** | Route53 NS 유지 | Pages/Workers 사용에 Cloudflare NS 필수, 단일 관리 |
| API 라우팅 | **전용 중간 도메인 (`dev-api.go-ti.shop`)** | Workers Host 헤더 오버라이드, 직접 IP | Workers fetch() Host 헤더 불변 제약 |
| SSL 전략 | **Flexible SSL (중간 도메인)** | Full/Strict | Kind PC에 유효 인증서 없음 (dev 환경) |

---

## 1. 배경 (Context)

### 기존 아키텍처 (CloudFront + S3)

```
Client → CloudFront → S3 (정적 파일, SPA)
                    → Kind PC (API, /api/*)
```

CloudFront Behavior로 경로별 라우팅:
- `/api/*` → Kind PC origin (Istio Gateway)
- `/*` (기본) → S3 origin (React SPA)
- Custom Error Response: 403/404 → `/index.html` (SPA 라우팅용)

### 발생한 문제

**CloudFront Custom Error Response가 API 에러를 삼킨다.**

CloudFront의 Custom Error Response는 **Behavior 단위가 아닌 Distribution 전역**으로 적용된다. SPA 라우팅을 위해 설정한 403/404 → `index.html` 반환이 API 응답에도 적용되어:

```
# 기대: API가 404 JSON 에러를 반환
GET /api/users/999 → 404 {"error": "User not found"}

# 실제: CloudFront가 404를 가로채고 index.html 반환
GET /api/users/999 → 200 <!DOCTYPE html>...
```

API 클라이언트가 에러 응답 대신 HTML을 받으면서 프론트엔드 에러 핸들링이 전부 깨졌다.

### 추가 문제: DNS 전환 시 SSL 이중 종단

Route53 NS → Cloudflare NS 전환 과정에서 Cloudflare Proxy(Orange Cloud)가 활성화되면:

```
Client → Cloudflare (SSL 종단 #1, HTTP→HTTPS 리다이렉트)
       → CloudFront (SSL 종단 #2, HTTP→HTTPS 리다이렉트)
       → 무한 301 루프
```

두 CDN이 각각 HTTPS를 강제하면서 서로에게 리다이렉트를 반복하는 상황이 발생했다.

---

## 2. 요구사항

| 요구사항 | 설명 | 중요도 |
|----------|------|--------|
| API/SPA 라우팅 분리 | API 에러 응답이 SPA fallback에 의해 덮어쓰이지 않아야 | 필수 |
| HTTPS 보장 | 모든 클라이언트 통신 HTTPS | 필수 |
| Host 헤더 정합성 | Istio Gateway가 올바른 Host로 매칭해야 | 필수 |
| DX (배포 편의) | 프론트엔드 배포가 간단해야 (GitHub 연동 선호) | 중요 |
| 비용 효율 | dev 환경이므로 비용 최소화 | 중요 |
| Grafana 외부 접근 | `grafana.go-ti.shop`으로 대시보드 접근 | 선택 |

---

## 3. 대안 비교

### 3.1 CDN/호스팅: CloudFront vs Cloudflare vs Vercel vs Netlify

| 항목 | CloudFront + S3 | **Cloudflare Pages + Workers** | Vercel | Netlify |
|------|----------------|-------------------------------|--------|---------|
| SPA fallback | Custom Error Response (전역, API 침범) | **Pages 내장 (정적 파일에만 적용)** | 내장 | 내장 |
| API 프록시 | Behavior + Origin (같은 Distribution) | **Workers (완전 분리된 실행 환경)** | Rewrites/Functions | Functions/Redirects |
| 비용 (dev) | ~$1-5/월 (S3 + CloudFront) | **무료 (Free plan 충분)** | 무료 (Hobby) | 무료 (Starter) |
| GitHub 연동 | CodePipeline 또는 Actions | **Pages 자동 배포** | 자동 배포 | 자동 배포 |
| 커스텀 도메인 SSL | ACM 인증서 (수동 관리) | **자동 (Cloudflare Edge)** | 자동 | 자동 |
| 에지 컴퓨팅 | Lambda@Edge / CloudFront Functions | **Workers (V8 isolate, 유연)** | Edge Functions | Edge Functions |
| DNS 통합 | Route53 별도 | **Cloudflare DNS 통합** | 별도 | 별도 |
| IaC 지원 | Terraform (완전) | Terraform (부분), Wrangler CLI | Vercel CLI | Netlify CLI |

**선택: Cloudflare Pages + Workers**

핵심 이유:
1. **API/SPA 라우팅이 구조적으로 분리됨**: Pages는 정적 파일만 서빙, Workers는 API 프록시만 담당 — CloudFront의 "전역 Custom Error Response" 문제가 원천 차단
2. **Workers 에지 컴퓨팅**: 향후 rate limiting, bot detection, A/B testing 등 엣지 로직 추가 가능
3. **비용**: dev 환경에서 CloudFront $1-5/월 vs Cloudflare Free plan 0원
4. **DNS + CDN + 컴퓨팅 통합**: 단일 대시보드에서 DNS, SSL, 캐싱, Workers 모두 관리

### 3.2 API 라우팅: Workers Host 헤더 문제

Workers에서 Kind PC(Istio Gateway)로 프록시할 때 **Host 헤더 문제**가 핵심 난관이었다.

| 방식 | 동작 | 결과 |
|------|------|------|
| Workers → 직접 IP (`118.38.x.x`) | Cloudflare Error 1003: Direct IP Access Not Allowed | **실패** |
| Workers → DDNS (`resshome.iptime.org`) + Host 오버라이드 | `fetch()`가 Host 헤더 오버라이드 무시, `Host: resshome.iptime.org` 전송 | **실패** (Istio 404) |
| Workers → Cloudflare Proxy 도메인 (`dev-api.go-ti.shop`) | Cloudflare가 자동으로 `Host: dev-api.go-ti.shop` 설정 | **성공** |

**결정: 전용 중간 도메인 (`dev-api.go-ti.shop`) 도입**

```
Client → dev.go-ti.shop (Cloudflare Pages: SPA)
       → dev.go-ti.shop/api/* (Workers → dev-api.go-ti.shop → Kind PC)

dev-api.go-ti.shop → Cloudflare Proxy ON → DDNS → Kind PC (Istio Gateway)
                     Host: dev-api.go-ti.shop (자동 설정)
                     Istio: dev-api.go-ti.shop 매칭 ✅
```

Workers의 `fetch()` 함수는 URL의 hostname을 Host 헤더로 사용하며 오버라이드가 불가능하다. 이는 Cloudflare의 보안 정책이다. 중간 도메인을 경유하면 Cloudflare가 프록시하면서 올바른 Host를 자동 설정한다.

### 3.3 SSL 전략: Flexible vs Full vs Strict

| 모드 | Cloudflare → Origin 통신 | 인증서 요구 | 적합 환경 |
|------|--------------------------|-----------|----------|
| **Flexible** | HTTP (평문) | 없음 | **dev (Kind PC, 인증서 없음)** |
| Full | HTTPS (자체 서명 허용) | 자체 서명 | staging |
| Strict | HTTPS (유효 인증서 필수) | CA 서명 | production |

**선택: Flexible (dev 환경 한정)**

Kind PC는 가정 네트워크의 DDNS 뒤에 있어 `dev-api.go-ti.shop`에 대한 유효 SSL 인증서가 없다. Client → Cloudflare 구간은 Cloudflare Edge 인증서로 HTTPS가 보장되므로 dev 환경에서는 허용 가능하다.

> ⚠️ prod 환경에서는 반드시 Full 이상 사용. cert-manager + Let's Encrypt로 Origin 인증서 발급.

---

## 4. 결정 (Decision)

**Cloudflare Pages + Workers + 전용 중간 도메인** 구조로 전환한다.

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

### 트레이드오프 인정

- **IaC 부재**: Cloudflare 설정은 현재 UI/Wrangler CLI로 관리 — Terraform Cloudflare Provider로 전환 예정
- **중간 도메인 복잡성**: `dev-api.go-ti.shop`이 순수히 Host 헤더 해결을 위해 존재 — 아키텍처적으로 깔끔하지 않지만 Workers의 제약을 우회하는 유일한 방법
- **SSL Flexible 보안 약점**: Origin 구간 평문 — dev 환경 한정으로 허용, prod에서는 Full/Strict 필수
- **Cloudflare 의존도 증가**: DNS + CDN + Pages + Workers 전부 Cloudflare — 단, 정적 파일은 어디서든 서빙 가능하고 Workers 로직은 이식 가능

---

## 5. 결과 (Consequences)

### 긍정적 영향

- **API 에러 응답 정상화**: SPA fallback이 API 경로에 영향 없음 — 프론트엔드 에러 핸들링 복구
- **비용 절감**: CloudFront + S3 비용 → Cloudflare Free plan (0원)
- **배포 간소화**: GitHub push → Cloudflare Pages 자동 배포 (GitHub Actions 불필요)
- **SSL 자동 관리**: Cloudflare Edge 인증서 자동 갱신 (ACM 수동 관리 제거)
- **Grafana 외부 접근**: `grafana.go-ti.shop` Workers 라우트로 간단히 해결

### 부정적 영향 / 리스크

- Cloudflare UI 기반 설정 → IaC 전환 전까지 변경 이력 추적 어려움
- Workers의 fetch() Host 헤더 제약은 문서에 명시적으로 안내되지 않아 디버깅에 시간 소요
- DNS NS 전환 시 TTL 전파 지연 (24-48시간) → 전환 중 일시적 서비스 불안정

### 향후 과제

- Cloudflare Terraform Provider로 DNS/Workers/Pages 설정 IaC화
- prod 환경: SSL Full/Strict + Origin 인증서 (cert-manager)
- Workers에 rate limiting / bot detection 로직 추가 (가드레일 연동)
- CloudFront Distribution + S3 bucket 정리 (Terraform destroy)

---

## 6. 마이그레이션 과정에서 발견된 교훈

### 교훈 1: CDN 이중 종단은 반드시 무한 루프를 만든다

두 개의 CDN/프록시가 각각 HTTP→HTTPS 리다이렉트를 강제하면 무한 301 루프가 발생한다. 이는 CloudFront + Cloudflare 조합에만 해당하지 않고, **모든 이중 프록시 구조**에서 동일하게 발생한다.

```
해결 원칙: CDN 체인에서 SSL 종단은 한 곳에서만.
병렬: 각각 독립 도메인 → 문제 없음
직렬: 첫 번째만 SSL 종단, 두 번째는 패스스루 또는 Flexible
```

### 교훈 2: Workers fetch()의 Host 헤더는 URL hostname이다

```javascript
// ❌ Host 오버라이드 무시됨
await fetch("https://resshome.iptime.org/api/...", {
  headers: { "Host": "dev-api.go-ti.shop" }
});
// 실제 전송: Host: resshome.iptime.org

// ✅ URL hostname이 Host가 됨
await fetch("https://dev-api.go-ti.shop/api/...");
// 실제 전송: Host: dev-api.go-ti.shop
```

이 동작은 Cloudflare 보안 정책이며, 공식 문서에서 명시적으로 안내하지 않아 디버깅에 시간이 소요되었다.

### 교훈 3: Pages 커스텀 도메인은 Workers 라우트보다 우선

Cloudflare Pages에 커스텀 도메인(`dev.go-ti.shop`)을 설정하면, 같은 도메인의 Workers 라우트(`dev.go-ti.shop/api/*`)보다 Pages가 먼저 매칭된다. API 요청이 Pages로 가면서 405 Method Not Allowed가 발생했다.

```
해결: Pages 커스텀 도메인 제거 → Workers가 모든 라우트 처리 → 정적 파일은 Workers에서 Pages로 프록시
또는: Workers 라우트를 먼저 평가하도록 Pages 설정 조정
```

---

## 7. 참고 자료

- [CloudFront-Cloudflare 301 리다이렉트 루프](../dev-logs/2026-03-24-cloudflare-cloudfront-301-redirect-loop.md)
- [Cloudflare Workers Host 헤더 + API 라우팅](../dev-logs/2026-03-25-cloudflare-migration-api-routing-troubleshoot.md)
