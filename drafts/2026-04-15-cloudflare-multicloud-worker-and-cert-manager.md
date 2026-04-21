---
date: 2026-04-15
category: decision
project: goti-team-project
tags: [cloudflare, worker, multi-cloud, cert-manager, lets-encrypt, istio, terraform, gcp, aws, drift]
---

# Cloudflare Worker 기반 멀티클라우드 라우터 + cert-manager Full(strict) + Terraform drift 복구

AWS 비용 중단으로 GCP 단독 운영 전환 → AWS 재가동 후에도 팀원이 작업할 때마다 GCP/AWS 양쪽이 자연스럽게 섞일 수 있도록, Cloudflare Worker 에서 팀코드 기반 라우팅을 구축한 세션. 그 과정에서 GCP 쪽 TLS 종단(cert-manager + Let's Encrypt wildcard)과 Terraform prod-gcp state drift 도 함께 정리.

## Context

- 2026-04-15 오전: 팀 비용 판단으로 AWS EKS ASG 를 0 으로 내림. 사용자 리더 작업은 GCP only 진행.
- 기존 Cloudflare SSL/TLS 는 **Flexible** 모드, origin 은 HTTP only (AWS 시절 설정). GCP 단독 전환하면서 정식 TLS 종단 필요.
- 프론트는 same-origin `go-ti.shop/api/*` 로 호출, 기존 Worker 가 `api.go-ti.shop` (AWS ALB CNAME) 로 forward 하고 있었음 → AWS 꺼져 있으면 Cloudflare 521/526 에러.
- 세션 중 팀원이 AWS 를 다시 켰으나 (ASG 복구) Harbor 아직 미복구 상태라 AWS pod 다수 ImagePullBackOff. 그래서 “둘 다 켜지면 각자 잘 가고, 한 쪽 장애 시 자동 넘어가는” 아키텍처가 필요.
- Terraform prod-gcp 는 사용자가 Memorystore Redis 를 수동 삭제한 뒤 방치되어 state 와 실제가 크게 어긋나 있었고, 다음 apply 시 9 add / 4 change / **22 destroy** 계획이 생성되는 위험 상태.

## Issue

### 문제 1 — 멀티클라우드 API 라우팅 방식

#### Option A: Cloudflare Load Balancer (유료 add-on)
- 장점
  - Origin pool + health check + geo/weighted steering 공식 지원
  - 코드 없이 대시보드 기반 관리
- 단점
  - Pro plan 에 기본 포함 안 됨 (~$5/월 base + 요청당 과금)
  - “특정 경기/팀 = 특정 클라우드” 같은 요청 내용 기반 분배는 불가 (host/path 수준 제약)

#### Option B: Cloudflare Worker (채택)
- 장점
  - Free tier 100k req/day 또는 Paid $5/월에 10M req (LB 보다 저렴)
  - JS 로 자유 로직 (teamCode, gameId, 해시, header 기반 등)
  - 프로젝트에 이미 Workers 사용 중 (`dev.go-ti.shop → Workers → Kind`) 경로 재활용
  - 디버깅용 응답 헤더 자유 추가 가능
- 단점
  - 로직이 코드이므로 배포/버전관리 필요 (현재는 CF 콘솔 직접 편집)

#### Option C: DNS multi-A 레코드
- 장점: 무료, 단순
- 단점: round-robin 만, health check / 지능적 분배 없음. 팀별 고정 배치 불가

### 문제 2 — GCP TLS 종단 방식

#### Option A: Cloudflare Origin CA 발급 + Full strict
- 장점: 자동 발급, 15년 유효
- 단점: Cloudflare 외부 직접 접근 시 untrusted (내부 감사/엔드포인트 테스트 시 혼선)

#### Option B: Let's Encrypt wildcard + cert-manager DNS-01 (채택)
- 장점
  - 공인 CA (브라우저 신뢰) + wildcard 한 장으로 전체 서브도메인 커버
  - 자동 90일 갱신 (Certificate + ClusterIssuer GitOps 관리)
  - 내부 직접 테스트 시에도 유효
- 단점
  - Cloudflare API 토큰 (Zone:DNS:Edit) 관리 필요
  - DNS-01 challenge 전파 1~3분 대기

### 문제 3 — Terraform prod-gcp drift 처리

Plan 이 `9 add / 4 change / 22 destroy` 로, destroy 대상에 **sqladmin API**, **GKE artifactregistry.reader IAM**, **ESO secretmanager.viewer IAM**, Secret Manager 5개가 포함. 그대로 apply 하면:
- sqladmin 비활성화 → Postgres 관리 차단
- GKE 노드가 GAR 이미지 pull 실패
- ESO dataFrom.find 동작 불가
- DATASOURCE_URL 이 `postgres://` → `jdbc:postgresql://` 로 회귀 → Go pgxpool DSN 파싱 실패 → 전면 CrashLoopBackOff

#### Option A: state 전부 지우고 신규 재프로비저닝
- 장점: 빠름
- 단점: 데이터 소실 + 재구성 비용 큼. 프로덕션 불가

#### Option B: 코드 복원 + 선별 state rm + in-place 재조정 (채택)
- 장점: 실제 GCP 리소스를 전혀 건드리지 않고 state/code 정합성만 회복
- 단점: git log + live GCP 비교로 각 리소스 검증 필요 (수작업)

## Action

### 선택 요약
1. **Worker 기반 멀티클라우드 라우터** (Option B) — 팀별 고정 분배 + 5xx 자동 failover
2. **Let's Encrypt wildcard + cert-manager DNS-01** (Option B) — Cloudflare API Token 으로 `_acme-challenge` TXT 자동 관리, Istio Gateway 에 credentialName 으로 주입
3. **Terraform drift 선별 복구** (Option B) — 4 리소스 코드 복원, 11 stale state rm, Postgres availability_type / DATASOURCE_URL 되돌림

### Worker 코드 (배포 완료)

```js
// =============================================================================
// Goti 멀티클라우드 라우터 (Cloudflare Worker)
// URL 패턴: /api/{teamCode}/v1/...  →  {cloud}/api/v1/...  (teamCode 스트립)
// teamCode 없는 /api/* 는 DEFAULT_CLOUD 로 pass-through
// 같은 팀 = 항상 같은 클라우드 (상태/세션 consistency)
// 5xx 응답 시 다른 클라우드로 자동 failover
// =============================================================================

// 팀 → 클라우드 매핑
// 근거: memory reference — EKS(삼성), GKE(두산) 초기 설계
const TEAM_ROUTING = {
  // AWS (EKS) — 5팀
  SS:  'aws', // 삼성 라이온즈
  KIA: 'aws', // KIA 타이거즈
  LG:  'aws', // LG 트윈스
  HH:  'aws', // 한화 이글스
  SSG: 'aws', // SSG 랜더스

  // GCP (GKE) — 5팀
  DO:  'gcp', // 두산 베어스
  NC:  'gcp', // NC 다이노스
  KT:  'gcp', // KT wiz
  LOT: 'gcp', // 롯데 자이언츠
  KIW: 'gcp', // 키움 히어로즈
};

const ORIGINS = {
  aws: 'https://aws-api.go-ti.shop',
  gcp: 'https://gcp-api.go-ti.shop',
};

// teamCode 미매칭 시 기본 origin
const DEFAULT_CLOUD = 'gcp';

// /api/{teamCode}/v1/... 추출 (teamCode 는 2~5자 대문자/숫자)
const TEAM_PATTERN = /^\/api\/([A-Z0-9]{2,5})\/v1\/(.+)$/;

function pickOriginByTeam(teamCode) {
  const cloud = TEAM_ROUTING[teamCode] || DEFAULT_CLOUD;
  return ORIGINS[cloud] || ORIGINS[DEFAULT_CLOUD];
}

function buildHeaders(request) {
  const h = new Headers(request.headers);
  h.delete('host');
  h.delete('cf-connecting-ip');
  h.delete('cf-ipcountry');
  h.delete('cf-ray');
  h.delete('cf-visitor');
  h.set('x-forwarded-for', request.headers.get('cf-connecting-ip') || '');
  h.set('x-forwarded-proto', 'https');
  return h;
}

async function forward(target, method, headers, bodyBuffer) {
  const init = { method, headers, redirect: 'manual' };
  if (bodyBuffer && !['GET', 'HEAD'].includes(method)) {
    init.body = bodyBuffer;
  }
  const resp = await fetch(target, init);
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: resp.headers,
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
      return new Response('Not Found', { status: 404 });
    }

    let originUrl;
    let rewrittenPath;
    let matchedTeam = null;

    const m = url.pathname.match(TEAM_PATTERN);
    if (m) {
      matchedTeam = m[1];
      originUrl = pickOriginByTeam(matchedTeam);
      rewrittenPath = `/api/v1/${m[2]}`;
    } else {
      originUrl = ORIGINS[DEFAULT_CLOUD];
      rewrittenPath = url.pathname;
    }

    const target = originUrl + rewrittenPath + url.search;
    const headers = buildHeaders(request);

    // body 는 retry 대비 미리 버퍼링 (GET/HEAD 제외)
    let bodyBuffer = null;
    if (!['GET', 'HEAD'].includes(request.method)) {
      try {
        bodyBuffer = await request.arrayBuffer();
      } catch (_) {
        bodyBuffer = null;
      }
    }

    try {
      const resp = await forward(target, request.method, headers, bodyBuffer);
      // 5xx 는 failover, 4xx 는 정상 비즈니스 응답으로 통과
      if (resp.status >= 500 && resp.status < 600) {
        throw new Error(`upstream ${resp.status}`);
      }
      const out = new Response(resp.body, resp);
      out.headers.set('x-goti-route-team', matchedTeam || 'none');
      out.headers.set('x-goti-route-origin', originUrl);
      return out;
    } catch (primaryErr) {
      // Failover: 다른 클라우드 시도
      const fallbackUrl = originUrl === ORIGINS.aws ? ORIGINS.gcp : ORIGINS.aws;
      try {
        const resp = await forward(
          fallbackUrl + rewrittenPath + url.search,
          request.method,
          headers,
          bodyBuffer,
        );
        const out = new Response(resp.body, resp);
        out.headers.set('x-goti-route-team', matchedTeam || 'none');
        out.headers.set('x-goti-route-origin', fallbackUrl);
        out.headers.set('x-goti-route-failover', 'true');
        return out;
      } catch (fallbackErr) {
        return new Response(
          JSON.stringify({
            error: 'both origins failed',
            primary: primaryErr.message,
            fallback: fallbackErr.message,
          }),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }
  },
};
```

### Worker 배포 후 검증 (2026-04-15, AWS Harbor 미복구 상태)

```
$ curl -is https://go-ti.shop/api/KIA/v1/games/schedules?today=true | grep -iE "^HTTP|^x-goti"
HTTP/2 200
x-goti-route-team: KIA
x-goti-route-failover: true
x-goti-route-origin: https://gcp-api.go-ti.shop

$ curl -is https://go-ti.shop/api/DO/v1/games/schedules?today=true | grep -iE "^HTTP|^x-goti"
HTTP/2 200
x-goti-route-team: DO
x-goti-route-origin: https://gcp-api.go-ti.shop
```

- KIA (AWS 매핑): primary AWS 5xx → fallback GCP 자동 전환, `failover=true` 헤더 ✓
- DO (GCP 매핑): GCP 직행, failover 헤더 없음 ✓

### cert-manager + Full (strict) 배포

- **ExternalSecret** `cert-manager/cloudflare-api-token` — GCP SM `goti-prod-cert-manager-CLOUDFLARE_API_TOKEN` (Zone:DNS:Edit, go-ti.shop 만, TTL 프로젝트 만료일) → K8s secret
- **ClusterIssuer** `letsencrypt-staging` + `letsencrypt-prod` — DNS-01 Cloudflare solver (`dnsZones: [go-ti.shop]`)
- **Certificate** `istio-ingress/go-ti-shop-wildcard` — secret `go-ti-shop-tls`, SAN `go-ti.shop + *.go-ti.shop`, 90d 주기 자동 갱신
  - staging 발급 Ready=True 검증 후 `issuerRef → letsencrypt-prod` 전환 → prod CertificateRequest-2 로 재발급 완료 (issuer = `Let's Encrypt R12`)
- **Istio Gateway template** 수정: `sharedGateway.tls.enabled` 조건부로 443 protocol=HTTPS, `credentialName=go-ti-shop-tls` 렌더. AWS 경로는 tls 미정의라 HTTP 유지 (하위 호환)
- **Cloudflare SSL/TLS** → Full (strict)

### Terraform drift 복구 (`Goti-Terraform/terraform/prod-gcp`)

- 코드 복원 (git show 로 원본 블록 추출):
  - `modules/kms/main.tf` → `google_project_service.sqladmin`, `time_sleep.wait_for_sqladmin_sa`
  - `modules/compute/main.tf` → `data.google_compute_default_service_account.default`, `google_project_iam_member.gke_nodes_artifactregistry_reader`
  - `modules/gke/main.tf` → `google_project_iam_member.external_secrets_secretmanager_viewer`
- 잘못된 in-place 변경 되돌림:
  - `modules/database/main.tf` availability_type `REGIONAL → ZONAL` (실제 ZONAL, 코드가 잘못됨)
  - `modules/config/main.tf` DATASOURCE_URL `jdbc:postgresql://... → postgres://user:pass@host/db?sslmode=disable` (commit `99af893` 회귀 복원)
  - `modules/database/main.tf` Redis tier `STANDARD_HA → BASIC` (비용 절감), `transit_encryption_mode SERVER_AUTHENTICATION → DISABLED` (Go 클라이언트 TLS 미지원)
- State 정리:
  - 5 OAuth secret + 5 version + 1 redis_instance `terraform state rm` (실제 미존재)
- Apply 결과: `3 add / 3 change / 2 destroy` (의도된 변경만). 새 Redis IP `10.155.146.203`
- 후속: Secret Manager REDIS_HOST/AUTH_TOKEN/URL 재생성 + ExternalSecret force-sync + K8s secret 수동 patch + 6개 MSA deployment rollout → 전부 2/2 Running

## Result

### 즉시 효과
- `https://go-ti.shop/api/{teamCode}/v1/...` 팀별 클라우드 분배 동작 (5xx 자동 failover)
- `gcp-api.go-ti.shop` Full (strict) + LE prod wildcard 정상 서빙
- GCP 6개 MSA 서비스 (user/ticketing/payment/queue/stadium/resale) 2/2 Running
- Terraform prod-gcp plan 이 clean (대형 destroy 위험 제거)

### 파급 / 제약
- **Worker 는 현재 Cloudflare 콘솔 직접 편집** — Wrangler + git 버전관리 도입 권장 (후속 task)
- **AWS ALB ACM cert Full strict 호환 여부** 는 AWS Harbor 복구 + pod 가 실제 응답 가능한 상태에서 재검증 필요
- `api.go-ti.shop` 레코드는 제거됨. 외부 문서/코드에서 참조가 있으면 `gcp-api.go-ti.shop` 로 일괄 교체 권장 (Worker 가 프론트 same-origin 경로를 처리)
- `argocd`, `harbor`, `monitoring` CNAME 이 여전히 AWS ALB 가리키는 상태 — AWS 복구 후 동작 재검증
- Cloudflare Pro plan 은 **LB 미포함** — Worker free/Paid $5 구조로 당분간 운영
- 프론트 JWT refreshToken 쿠키에 문제 없음 (curl 출력에서 cookie 전달 확인)

### 후속 TODO
- AWS Harbor 복구 cycle (이전 기록: redis PV AZ 2a spot toleration 추가 → Harbor pod 기동 → 이미지 재pull)
- AWS 임시 축소 커밋 `7245fb1`, `3a91f6b` (ticketing/payment/queue/user/stadium minReplicas 축소, cron prewarm 축소) revert → 5차 부하 직전
- Worker Wrangler + GitHub Actions 로 버전 관리/배포 자동화
- 팀별 경기 ID 기반 세부 분배 (현재는 team 단위) 필요 시 `GAME_ROUTING` layer 추가
- load-observer / queue-gate 이미지 빌드 및 배포 (별도 레포)

## Related Files

### Goti-k8s
- `infrastructure/prod/gcp/cert-manager/externalsecret-cloudflare-api-token.yaml`
- `infrastructure/prod/gcp/cert-manager/clusterissuer-letsencrypt-staging.yaml`
- `infrastructure/prod/gcp/cert-manager/clusterissuer-letsencrypt-prod.yaml`
- `infrastructure/prod/gcp/cert-manager/certificate-go-ti-shop.yaml`
- `infrastructure/prod/gcp/istio/gateway/values-gcp.yaml`
- `infrastructure/prod/istio/gateway/templates/shared-gateway.yaml`
- `gitops/prod-gcp/projects/infra-project.yaml`
- `environments/prod-gcp/goti-{ticketing,payment,queue,user,stadium,resale}/values.yaml`

### Goti-Terraform
- `terraform/prod-gcp/modules/kms/main.tf`
- `terraform/prod-gcp/modules/compute/main.tf`
- `terraform/prod-gcp/modules/gke/main.tf`
- `terraform/prod-gcp/modules/database/main.tf`
- `terraform/prod-gcp/modules/config/main.tf`

### Goti-go
- `.github/workflows/cd-gcp.yml` (신규 — WIF 인증 기반 GAR push + Goti-k8s PR 생성)
- `.github/workflows/cd-{payment,queue,resale,stadium,ticketing,user}-gcp.yml` (삭제 — 잘못된 하드코딩)

### Cloudflare (외부)
- Worker: `go-ti.shop/api/*` routes (코드는 본 문서 상단 embed)
- Secret Manager: `goti-prod-cert-manager-CLOUDFLARE_API_TOKEN`, `goti-prod-server-REDIS_{HOST,AUTH_TOKEN,URL}`

### 주요 커밋
- Goti-Terraform `932cca7` — prod-gcp drift 복구 + Redis BASIC
- Goti-Terraform `e602ad3` — Redis transit_encryption DISABLED
- Goti-k8s `25385aa` — cert-manager DNS-01 + Istio HTTPS
- Goti-k8s `373ac50` + `e10d83b` — AppProject whitelist (cert-manager + cert-manager ns)
- Goti-k8s `2853f21` — Certificate issuerRef staging → prod
- Goti-k8s `63ff401` + `772ca06` — prod-gcp replicaCount 정상화
- Goti-go `1bfe89e` — cd-gcp.yml unified WIF
