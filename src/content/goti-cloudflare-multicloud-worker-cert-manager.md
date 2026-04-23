---
title: "Cloudflare Worker + cert-manager로 Multi-Cloud 트래픽 분배 구성하기"
excerpt: "팀코드 기반 AWS/GCP 라우팅을 Cloudflare Worker로 구현하고, cert-manager + Let's Encrypt wildcard로 GCP Full(strict) TLS 종단을 설정한 실전 기록입니다."
category: kubernetes
tags:
  - go-ti
  - Multi-Cloud
  - Cloudflare
  - Worker
  - cert-manager
  - TLS
  - troubleshooting
series:
  name: "goti-multicloud"
  order: 4
date: "2026-04-15"
---

## 한 줄 요약

> Cloudflare Worker에서 팀코드 기반 라우팅으로 AWS/GCP를 동시에 서빙하고, GCP 쪽 TLS 종단을 cert-manager + Let's Encrypt wildcard로 올려 Full(strict) 모드를 완성했습니다. 병행 작업으로 prod-gcp Terraform drift도 함께 정리했습니다.

## Impact

- **영향 범위**: 전체 API 트래픽, GCP 이그레스 TLS, prod-gcp Terraform 상태
- **목표**: AWS/GCP가 동시에 살아 있으면 팀별 고정 분배, 한쪽이 죽으면 자동 failover
- **발생일**: 2026-04-15

---

## 🔥 문제: AWS가 꺼졌다 켜졌다 하는 상황에서 안정적 분배가 필요함

### 기존 아키텍처

기존에는 Cloudflare가 단일 프록시 역할만 하고 있었습니다.

- Cloudflare SSL/TLS 모드는 **Flexible**이었고, origin은 HTTP only였습니다(AWS 시절 설정 그대로).
- 프론트는 same-origin `go-ti.shop/api/*`로 호출하고, 기존 Worker가 `api.go-ti.shop`(AWS ALB CNAME)으로 forward하고 있었습니다.
- 즉, API 경로가 **AWS 한 곳**만 바라보고 있었습니다.

### 발견한 문제

2026-04-15 오전, 팀 비용 판단으로 AWS EKS ASG를 0으로 내렸습니다. 사용자 리더 작업은 GCP only로 진행해야 했는데, 기존 Worker가 여전히 `api.go-ti.shop`(AWS ALB)으로 forward하다 보니 Cloudflare가 521/526 에러를 반환하기 시작했습니다.

세션 중 팀원이 AWS를 다시 켰지만(ASG 복구), Harbor가 아직 복구되지 않아 AWS pod 다수가 ImagePullBackOff 상태였습니다. 결국 필요한 것은 **"둘 다 켜지면 각자 잘 가고, 한 쪽 장애 시 자동 넘어가는"** 아키텍처였습니다.

여기에 더해 Terraform prod-gcp 상태가 같이 틀어져 있었습니다. 사용자가 Memorystore Redis를 수동 삭제한 뒤 방치되어 state와 실제 리소스가 크게 어긋나 있었고, 다음 apply 시 **9 add / 4 change / 22 destroy** 계획이 생성되는 위험한 상태였습니다.

---

## 🤔 원인과 선택지 분석

### 문제 1 — Multi-Cloud API 라우팅 방식

세 가지 방식을 비교했습니다.

| 방식 | 장점 | 단점 |
|------|------|------|
| Cloudflare Load Balancer | Origin pool + health check + geo/weighted 공식 지원, 대시보드 관리 | Pro plan에 기본 미포함(~$5/월 base + 요청당 과금), 요청 내용 기반 분배 불가 |
| **Cloudflare Worker (채택)** | Free 100k req/day 또는 $5/월 10M req로 LB보다 저렴, JS 자유 로직, 프로젝트에 이미 Workers 사용 중 | 로직이 코드이므로 배포/버전관리 필요 |
| DNS multi-A 레코드 | 무료, 단순 | round-robin만, health check/지능적 분배 없음, 팀별 고정 배치 불가 |

핵심 요구가 **"특정 팀은 항상 특정 클라우드"**, **"5xx 시 자동 failover"**였기 때문에 LB는 탈락했습니다. LB는 host/path 수준까지만 분기할 수 있는데, 팀별 고정 배치는 요청 내용을 봐야 합니다. DNS는 상태 기반 분배 자체가 불가합니다.

Worker는 이미 프로젝트에서 `dev.go-ti.shop → Workers → Kind` 경로로 사용 중이라 경로 재활용도 가능했습니다. 디버깅용 응답 헤더를 자유롭게 추가할 수 있다는 점도 컸습니다.

### 문제 2 — GCP TLS 종단 방식

두 가지를 비교했습니다.

| 방식 | 장점 | 단점 |
|------|------|------|
| Cloudflare Origin CA + Full strict | 자동 발급, 15년 유효 | Cloudflare 외부 직접 접근 시 untrusted, 내부 감사/엔드포인트 테스트 시 혼선 |
| **Let's Encrypt wildcard + cert-manager DNS-01 (채택)** | 공인 CA(브라우저 신뢰) + wildcard 한 장으로 전체 서브도메인 커버, 자동 90일 갱신, 내부 직접 테스트도 유효 | Cloudflare API 토큰(Zone:DNS:Edit) 관리 필요, DNS-01 전파 1~3분 대기 |

내부 팀원이 GCP 엔드포인트를 Cloudflare 우회해 직접 테스트하는 경우가 잦았기 때문에, **공인 CA**가 중요한 기준이었습니다. Origin CA는 Cloudflare를 거쳐야만 신뢰되므로 테스트 흐름을 깨뜨립니다.

### 문제 3 — Terraform prod-gcp drift 처리

22 destroy 계획의 destroy 대상에 다음이 포함되어 있었습니다.

- **sqladmin API**
- **GKE artifactregistry.reader IAM**
- **ESO secretmanager.viewer IAM**
- **Secret Manager 5개**

그대로 apply하면 연쇄 장애가 예상됐습니다.

1. sqladmin 비활성화 → Postgres 관리 차단
2. GKE 노드가 GAR 이미지 pull 실패
3. ESO `dataFrom.find` 동작 불가
4. `DATASOURCE_URL`이 `postgres://` → `jdbc:postgresql://`로 회귀 → Go pgxpool DSN 파싱 실패 → 전면 CrashLoopBackOff

두 가지 선택지가 있었습니다.

- **Option A: state 전부 지우고 재프로비저닝** — 빠르지만 데이터 소실 + 재구성 비용. 프로덕션 불가.
- **Option B: 코드 복원 + 선별 state rm + in-place 재조정 (채택)** — 실제 GCP 리소스를 전혀 건드리지 않고 state/code 정합성만 회복. 수작업 검증 필요.

---

## ✅ 해결

### Worker 코드 (배포 완료)

`/api/{teamCode}/v1/...` 경로를 `{cloud}/api/v1/...`로 rewrite하면서 teamCode를 스트립하는 구조입니다.

```js
// =============================================================================
// Goti 멀티클라우드 라우터 (Cloudflare Worker)
// URL 패턴: /api/{teamCode}/v1/...  →  {cloud}/api/v1/...  (teamCode 스트립)
// teamCode 없는 /api/* 는 DEFAULT_CLOUD 로 pass-through
// 같은 팀 = 항상 같은 클라우드 (상태/세션 consistency)
// 5xx 응답 시 다른 클라우드로 자동 failover
// =============================================================================

// 팀 → 클라우드 매핑 (EKS=5팀, GKE=5팀)
const TEAM_ROUTING = {
  SS:  'aws', KIA: 'aws', LG:  'aws', HH:  'aws', SSG: 'aws',
  DO:  'gcp', NC:  'gcp', KT:  'gcp', LOT: 'gcp', KIW: 'gcp',
};

const ORIGINS = {
  aws: 'https://aws-api.go-ti.shop',
  gcp: 'https://gcp-api.go-ti.shop',
};

const DEFAULT_CLOUD = 'gcp';
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

    // body는 retry 대비 미리 버퍼링 (GET/HEAD 제외)
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
      // 5xx는 failover, 4xx는 정상 비즈니스 응답으로 통과
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

핵심 설계 포인트를 짚어보겠습니다.

**팀코드 = 클라우드 고정 매핑**으로 같은 팀의 요청은 항상 같은 클라우드로 갑니다. 상태/세션 consistency를 보장하기 위한 선택입니다. 예를 들어 KIA 팀 유저가 AWS에서 장바구니를 담았는데 다음 요청이 GCP로 가면 장바구니가 비어 있게 됩니다.

**5xx만 failover**하고 4xx는 그대로 통과시킵니다. 4xx는 비즈니스 에러(validation, 권한 등)라 다른 클라우드로 보내도 동일하게 실패할 가능성이 큽니다. 불필요한 요청을 두 번 보내지 않도록 5xx 범위에서만 재시도합니다.

**응답 헤더 `x-goti-route-team` / `x-goti-route-origin` / `x-goti-route-failover`**를 추가해 어느 경로로 처리됐는지 curl로 즉시 확인할 수 있게 했습니다. 디버깅이 훨씬 수월해집니다.

**body 사전 버퍼링**은 retry 대비용입니다. Request body는 ReadableStream이라 한 번 소비하면 재사용 못 하므로, failover 시 두 번째 fetch에서 쓸 수 있도록 `arrayBuffer()`로 미리 읽어둡니다.

### Worker 배포 후 검증

AWS Harbor 미복구 상태(AWS pod가 ImagePullBackOff)에서 두 팀을 각각 테스트했습니다.

```bash
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

- **KIA (AWS 매핑)**: primary AWS가 5xx를 반환하자 fallback GCP로 자동 전환됐고, `failover=true` 헤더가 붙었습니다.
- **DO (GCP 매핑)**: GCP 직행이므로 failover 헤더가 없습니다.

의도한 대로 팀별 분배와 5xx failover가 모두 동작했습니다.

### cert-manager + Full (strict) 배포

GCP 쪽 TLS 종단을 Let's Encrypt wildcard로 구성했습니다.

- **ExternalSecret** `cert-manager/cloudflare-api-token` — GCP Secret Manager의 `goti-prod-cert-manager-CLOUDFLARE_API_TOKEN`(Zone:DNS:Edit 권한, go-ti.shop만, TTL 프로젝트 만료일)을 K8s secret으로 동기화합니다.
- **ClusterIssuer** `letsencrypt-staging` + `letsencrypt-prod` — DNS-01 Cloudflare solver로 구성했고, `dnsZones: [go-ti.shop]`로 제한했습니다.
- **Certificate** `istio-ingress/go-ti-shop-wildcard` — secret `go-ti-shop-tls`, SAN `go-ti.shop + *.go-ti.shop`, 90일 주기 자동 갱신입니다.
  - staging 발급 `Ready=True` 검증 후 `issuerRef`를 `letsencrypt-prod`로 전환해 prod CertificateRequest-2로 재발급했습니다(issuer = `Let's Encrypt R12`).
- **Istio Gateway template 수정** — `sharedGateway.tls.enabled` 조건부로 443 protocol=HTTPS, `credentialName=go-ti-shop-tls`를 렌더하도록 했습니다. AWS 경로는 tls 미정의라 HTTP 유지(하위 호환).
- **Cloudflare SSL/TLS** → Full (strict)로 전환했습니다.

staging을 먼저 쓴 것은 Let's Encrypt **rate limit 회피**를 위해서입니다. prod issuer는 도메인당 주당 50장 한도가 있어, 설정 시행착오로 수십 번 요청하면 밴이 걸립니다. staging에서 `Ready=True`까지 확인한 뒤 prod로 전환하는 것이 표준 흐름입니다.

### Terraform drift 복구

`Goti-Terraform/terraform/prod-gcp`에서 다음 순서로 진행했습니다.

**코드 복원** (git show로 원본 블록 추출):

- `modules/kms/main.tf` → `google_project_service.sqladmin`, `time_sleep.wait_for_sqladmin_sa`
- `modules/compute/main.tf` → `data.google_compute_default_service_account.default`, `google_project_iam_member.gke_nodes_artifactregistry_reader`
- `modules/gke/main.tf` → `google_project_iam_member.external_secrets_secretmanager_viewer`

**잘못된 in-place 변경 되돌림**:

- `modules/database/main.tf` availability_type `REGIONAL → ZONAL`(실제 ZONAL, 코드가 잘못됨)
- `modules/config/main.tf` DATASOURCE_URL `jdbc:postgresql://... → postgres://user:pass@host/db?sslmode=disable`(commit `99af893` 회귀 복원)
- `modules/database/main.tf` Redis tier `STANDARD_HA → BASIC`(비용 절감), `transit_encryption_mode SERVER_AUTHENTICATION → DISABLED`(Go 클라이언트 TLS 미지원)

**State 정리**:

- 5 OAuth secret + 5 version + 1 redis_instance를 `terraform state rm`(실제 미존재).

**Apply 결과**: `3 add / 3 change / 2 destroy`로 의도된 변경만 남았고, 새 Redis IP `10.155.146.203`을 확보했습니다.

**후속 작업**: Secret Manager REDIS_HOST/AUTH_TOKEN/URL 재생성 + ExternalSecret force-sync + K8s secret 수동 patch + 6개 MSA deployment rollout → 전부 2/2 Running 상태로 복구했습니다.

### 즉시 효과

- `https://go-ti.shop/api/{teamCode}/v1/...` 팀별 클라우드 분배가 동작하고, 5xx 자동 failover가 확인됐습니다.
- `gcp-api.go-ti.shop` Full (strict) + LE prod wildcard로 정상 서빙합니다.
- GCP 6개 MSA 서비스(user/ticketing/payment/queue/stadium/resale)가 2/2 Running입니다.
- Terraform prod-gcp plan이 clean해졌습니다(대형 destroy 위험 제거).

### 남은 제약

- **Worker는 현재 Cloudflare 콘솔 직접 편집** — Wrangler + git 버전관리 도입이 필요합니다(후속 task).
- **AWS ALB ACM cert Full strict 호환 여부**는 AWS Harbor 복구 + pod가 실제 응답 가능한 상태에서 재검증해야 합니다.
- `api.go-ti.shop` 레코드는 제거됐습니다. 외부 문서/코드에서 참조가 있으면 `gcp-api.go-ti.shop`로 일괄 교체를 권장합니다(Worker가 프론트 same-origin 경로를 처리).
- `argocd`, `harbor`, `monitoring` CNAME이 여전히 AWS ALB를 가리키는 상태입니다. AWS 복구 후 동작 재검증이 필요합니다.
- Cloudflare Pro plan은 **LB 미포함**이라 Worker free/Paid $5 구조로 당분간 운영합니다.

---

## 📚 배운 점

### 1. 요청 내용 기반 분배는 LB로 안 된다

Cloudflare Load Balancer는 host/path 수준까지만 분기할 수 있습니다. "팀코드별 고정 배치" 같이 **URL path 세그먼트를 파싱해 분배**하려면 코드가 필요합니다. Worker는 이 지점에서 LB보다 구조적으로 유리합니다.

### 2. 5xx만 failover, 4xx는 그대로

4xx는 비즈니스 에러(인증 실패, validation 등)로, 다른 클라우드로 보내도 똑같이 실패합니다. 괜한 재시도는 지연만 늘리므로 **5xx 범위에서만 failover**하는 것이 표준 패턴입니다.

### 3. Let's Encrypt는 staging부터

prod issuer는 도메인당 주당 발급 한도가 있어 설정 시행착오로 밴이 걸릴 수 있습니다. **staging에서 `Ready=True`까지 검증한 뒤 prod로 전환**하는 것이 표준 흐름입니다.

### 4. state rm은 실제 존재 여부를 반드시 교차 확인

state와 실제 리소스가 어긋나 있을 때, `state rm`은 안전한 옵션이지만 **실제로 존재하지 않는지 GCP 콘솔/CLI로 교차 확인한 뒤**에만 써야 합니다. 실존 리소스를 state에서만 지우면 다음 apply가 다시 만들려 하거나, 반대로 관리 대상에서 누락되는 혼란이 생깁니다.

### 5. 응답 헤더로 경로 추적

`x-goti-route-team` 같은 디버깅 헤더는 실전에서 아주 요긴합니다. Worker/Proxy 계층이 복잡해질수록 **"이 요청이 어떤 경로로 처리됐는가"**를 응답만 보고 알 수 있어야 합니다. 로그만으로는 재현이 어렵습니다.

### 6. 후속 TODO

- AWS Harbor 복구 사이클(redis PV AZ 2a spot toleration 추가 → Harbor pod 기동 → 이미지 재pull).
- AWS 임시 축소 커밋 revert → 5차 부하 직전.
- Worker를 Wrangler + GitHub Actions로 버전 관리/배포 자동화.
- 팀별 경기 ID 기반 세부 분배(현재는 team 단위)가 필요하면 `GAME_ROUTING` layer 추가.
