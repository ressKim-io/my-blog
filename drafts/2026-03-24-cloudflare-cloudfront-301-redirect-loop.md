---
date: 2026-03-24
category: troubleshoot
project: goti-team-controller
tags: [dns, cloudflare, cloudfront, redirect-loop, nameserver, ssl]
---

# Cloudflare 네임서버 전환 후 dev.go-ti.shop 301 리디렉션 무한 루프

## Context

`api.go-ti.shop` 도메인 분리를 위해 네임서버를 Route53 → Cloudflare로 변경 (2026-03-23). 변경 당일에는 정상 동작했으나, 24시간 후 DNS 전파 완료 시점에 `dev.go-ti.shop` 전체 접근 불가.

기존 DNS 구조: 도메인 등록기관 → Route53 NS → Route53 A (Alias) → CloudFront
변경 후: 도메인 등록기관 → **Cloudflare NS** → Cloudflare 프록시 → CloudFront

## Issue

```
$ curl -sk -D - https://dev.go-ti.shop/
HTTP/2 301
location: https://dev.go-ti.shop/
server: cloudflare
x-cache: Redirect from cloudfront
```

브라우저: "dev.go-ti.shop에서 리디렉션한 횟수가 너무 많습니다."

301 → 자기 자신으로 무한 리디렉션. `/grafana`, `/api/*`, 정적 파일 등 모든 경로 동일 증상.

재현 조건: DNS 전파 완료 후 (네임서버 변경 후 24~48시간). TTL 만료 전까지는 기존 Route53 캐시로 정상 동작.

## Action

### 가설 1: Kind 클러스터 장애 → 기각
- `kubectl get nodes` 전부 Ready, Istio Gateway Running
- Kind 호스트에서 `curl localhost:80 -H "Host: dev.go-ti.shop"` → 정상 응답 (400, 경로 동작 확인)

### 가설 2: S3 프론트엔드 파일 누락 → 기각
- `aws s3 ls s3://goti-dev-front-s3/static/js/` → 파일 정상 존재
- S3 직접 접근 (`aws s3api head-object`) → 정상

### 가설 3: CloudFront 캐시 문제 → 기각
- `aws cloudfront create-invalidation --paths "/*"` → 무효화 후에도 301 지속

### 가설 4: DNS/네임서버 변경 → 확인
```
$ dig go-ti.shop NS +short
zac.ns.cloudflare.com.
keyla.ns.cloudflare.com.
```

Route53 NS (`ns-1100.awsdns-09.org` 등)가 아닌 **Cloudflare NS로 변경**되어 있음.

```
$ dig dev.go-ti.shop +short
104.26.10.42    ← Cloudflare IP (CloudFront IP 아님)
```

### 근본 원인 (Root Cause)

`api.go-ti.shop` 설정을 위해 네임서버를 Cloudflare로 변경했는데, **네임서버는 도메인 단위로 적용**되므로 `dev.go-ti.shop`, `kind.go-ti.shop` 등 모든 서브도메인이 영향받음.

Cloudflare 프록시(오렌지 클라우드)가 활성화된 상태에서 Origin이 CloudFront를 가리키면:
1. 클라이언트 → **Cloudflare** (SSL 종단) → **CloudFront** (SSL 종단) → Origin
2. CloudFront가 `ViewerProtocolPolicy: redirect-to-https` 설정으로 HTTP→HTTPS 리디렉션 시도
3. Cloudflare가 이 리디렉션을 받아 다시 자기 자신으로 전달 → 무한 루프

**두 CDN/프록시의 SSL 정책 충돌**이 원인.

변경 당일 정상이었던 이유: DNS TTL이 만료되지 않아 리졸버가 여전히 Route53 캐시를 사용. 24시간 후 TTL 만료 → Cloudflare NS로 전환 → 증상 발생.

### 적용한 수정

Cloudflare DNS에서 CloudFront를 사용하는 서브도메인의 **프록시 OFF (회색 구름, DNS Only)**:
- `dev.go-ti.shop` → CNAME `d1neyu3nycqrkl.cloudfront.net` (프록시 OFF)
- `api.go-ti.shop` → CNAME (CloudFront 도메인) (프록시 OFF)
- `kind.go-ti.shop` → A (Kind PC IP) (프록시 OFF)
- `argocd.go-ti.shop` → A (Kind PC IP) (프록시 OFF)

## Result

프록시 OFF 후 `dev.go-ti.shop` 정상 접근 확인. 301 루프 해소.

### 재발 방지

- **Cloudflare + CloudFront 동시 사용 시 반드시 Cloudflare 프록시 OFF** — 두 CDN의 SSL 정책이 충돌
- 네임서버 변경은 도메인 전체에 영향 — 특정 서브도메인만 변경 불가
- DNS 변경 후 24~48시간 모니터링 필요 (TTL 만료 시점에 문제 발현)

## Related Files
- Route53 Hosted Zone: Z07003782ABOJTESFVDGQ
- CloudFront Distribution: EOLI11PF51LX9 (dev.go-ti.shop)
