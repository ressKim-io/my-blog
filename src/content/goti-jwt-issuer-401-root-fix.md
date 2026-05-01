---
title: "prod-gcp /queue 전수 401 — JWT issuer drift 근본 원인 제거"
excerpt: "go-ti.shop /queue 진입이 전부 401을 반환했습니다. 원인은 JWT iss=\"goti\"가 Istio RequestAuthentication issuer=\"goti-user-service\"와 불일치였습니다. viper 우선순위가 K8s env를 configs 하드코딩으로 덮어쓰고 있어, K8s values를 단일 SoT로 승격해 근본 원인을 제거했습니다"
category: istio
tags:
  - go-ti
  - JWT
  - Istio
  - viper
  - Configuration
  - Multi-Cloud
  - troubleshooting
series:
  name: "goti-auth"
  order: 4
date: "2026-04-17"
---

## 한 줄 요약

> `go-ti.shop`에서 로그인 후 `/queue` 진입 시 `POST /api/SS/v1/queue/enter`가 401 `"Jwt issuer is not configured"`를 반환했습니다. JWT `iss`가 `"goti"`로 발급됐는데 Istio `RequestAuthentication`은 `"goti-user-service"`로 구성되어 있었습니다. viper의 설정 우선순위(`Config > Env`)가 K8s의 env 주입을 `configs/user.yaml` 하드코딩으로 덮고 있었습니다. K8s values를 issuer의 단일 SoT로 승격해 근본 원인을 제거했습니다

---

## 🔥 문제: JWT 필요한 모든 API가 401

### 증상

- 유저 제보: `/queue`에서 401
- curl로 `DO/KIA/v1/queue/enter` 호출 → Worker + Istio 경로 자체는 정상. 401은 JWT 검증 단계에서 발생
- 응답 헤더: `www-authenticate: Bearer realm="...", error="invalid_token"`
- 응답 본문: `Jwt issuer is not configured`

### 핵심 단서

JWT payload를 base64 디코드한 결과:

```json
{"iss":"goti","sub":"...","provider_type":"GOOGLE","role":"MEMBER"}
```

K8s values의 `RequestAuthentication` 구성:

```yaml
# environments/prod-gcp/goti-user/values.yaml
requestAuthentication:
  issuer: "goti-user-service"
```

**JWT는 `iss="goti"`, Istio는 `issuer="goti-user-service"`를 기대하므로 매칭 실패.**

---

## 🤔 원인: viper 우선순위와 issuer drift

### 조사 과정에서 기각한 가설들

| # | 가설 | 판정 |
|---|------|------|
| 1 | Cloudflare Pages SPA 자체 문제 | ❌ `GET /queue` 200, HTML 정상 |
| 2 | Cloudflare Worker 라우팅 문제 | ❌ `x-goti-route-origin: gcp-api.go-ti.shop`, failover 정상 |
| 3 | Istio VirtualService 부재 | ❌ prod-gcp에 `/api/v1/queue` route 존재, Envoy 처리 정상 |
| 4 | JWKS mismatch | ❌ user/queue `RequestAuthentication` jwks 433 bytes bit-identical |
| 5 | `goti-queue-gate` ImagePullBackOff | ❌ 기본 `/queue` 플로우와 무관 (Phase 2 용) |
| 6 | **issuer drift** | ✅ **확정** |

### 3층 근본 원인 분석

| 층위 | 문제 |
|-----|-----|
| L1 (표면) | JWT `iss` ≠ Istio `RequestAuth` `issuer` → 401 |
| L2 (중간) | `pkg/config/config.go:269`가 default `"goti"` + `configs/{user,payment,stadium}.yaml`에 `issuer: "goti"` 중복 (payment/stadium은 dead). `configs/{queue,ticketing,resale}`에는 필드 자체가 없어 default 상속 |
| L3 (근본) | **issuer 값에 대한 SoT 부재.** Goti-go와 Goti-k8s가 서로 다른 값을 보유하며 drift 불가피 |

viper의 우선순위는 `Set > Flag > Env > Config > Default`입니다
K8s values에서 `USER_JWT_ISSUER=goti-user-service`를 env로 주입하고 있었음에도, **`configs/user.yaml`의 `issuer: "goti"`가 Config 레이어에서 env를 덮었습니다**. 그 결과 토큰은 `iss: "goti"`로 발급되고 Istio가 매칭을 거부했습니다

---

## ✅ 해결: K8s values를 단일 SoT로 승격

### Goti-go 커밋 `977130c`

- `pkg/config/config.go`: default를 `"goti"` → `""`로 변경, 주석으로 사유 명시
- `internal/user/service/jwt_provider.go:NewJwtProvider`: `cfg.Issuer == ""`이면 fail-fast
- `configs/user.yaml`: `issuer` 필드 제거 (주석으로 ENV 주입 명시)
- `configs/payment.yaml`, `configs/stadium.yaml`: dead `jwt:` 블록 제거

### Goti-k8s PR #270 (squash merge `f41b5ba`)

- `environments/prod-gcp/goti-user/values.yaml`에 `env: USER_JWT_ISSUER=goti-user-service` 추가
- CD가 자동 생성한 image tag bump 6개(`gcp-6-977130c`) 함께 포함
- `prod/goti-user-v2/values.yaml`은 이미 env가 설정되어 있었으므로 재빌드만으로 수정 효과 발현

### 타임라인

| 시각 (KST) | 이벤트 |
|------|------|
| 04:12 | 유저 제보 `/queue`에서 401. pod 로그에 401 확인 |
| 04:24 | `www-authenticate` 헤더 + 본문에서 `Jwt issuer is not configured` 확인 |
| 04:25 | JWT payload 디코드 → `iss: "goti"`. K8s values `requestAuthentication.issuer`와 불일치 확인 |
| 04:35 | 근본 원인 분석, drift 지점 3개 레이어로 정리 |
| 05:09 | Goti-go `977130c` 커밋 푸시 + CD workflow 성공 (6개 서비스 이미지 빌드) |
| 05:15 | Goti-k8s PR #270 merge (image tag bump + `USER_JWT_ISSUER` env) |
| 05:20+ | ArgoCD auto-sync → user/queue/stadium/payment/ticketing/resale rolling update |

### 검증

- user pod(`gcp-6-977130c`) 시작 시 `USER_JWT_ISSUER=goti-user-service` 주입 → viper가 config file 값이 없으므로 env 사용
- 로그인 시 발급된 JWT의 `iss` → `"goti-user-service"`
- Istio `RequestAuth` issuer와 일치 → JWT API 전부 정상화

---

## 🚨 추가 이슈 — `/queue`가 "느리다"의 실체

JWT 401을 잡은 뒤 유저가 브라우저 DevTools에서 추가 현상을 보고했습니다
`/queue`의 `global-status` polling이 **10~30초**씩 걸린다는 것이었습니다

서버 로그에 `latency_ms=0`이라 서비스 내부는 멀쩡했습니다
지연은 **Cloudflare Worker ↔ AWS origin 사이**에서 발생하고 있었습니다

- AWS ASG=0 (의도된 cost freeze) 상태에서 Worker가 `fetch(https://aws-api.go-ti.shop/...)` 호출
- TCP 연결 자체가 성립하지 못해 ~10초 소켓 timeout 후에야 catch로 빠져 GCP fallback
- AWS 매핑 팀(SS/KIA/LG/HH/SSG)의 유저는 매 API 호출마다 10초 지연이 누적 → 체감상 `/queue`가 "죽은" 것처럼 보임

### 조치 (별도 ADR로 정리)

1. **Worker Circuit Breaker** — `PRIMARY_TIMEOUT_MS=1500` + Cloudflare Cache API로 `CB_OPEN_SEC=60` 상태 저장. AWS가 한 번이라도 실패/타임아웃하면 60초간 GCP로 직행하고, 60초 뒤 첫 요청이 probe 역할을 합니다
2. **GCP HPA 활성화** — prod-gcp 6개 Go 서비스에 HPA(CPU 60%)를 적용. 2배 트래픽 유입 시 자동 scale-up. (Goti-k8s PR #271)

---

## 📚 배운 점

- **viper 우선순위는 `Set > Flag > Env > Config > Default`입니다.** configs 파일에 값이 있으면 env 주입은 무시됩니다. env로 주입하고 싶다면 configs에서 반드시 필드를 제거해야 합니다
- **"같은 개념을 두 곳에 정의"한 순간 drift는 시간문제입니다.** 한 레포에서 끝나는 건 PR 리뷰로 막히지만, 두 레포(예: 앱 + IaC)를 넘나드는 중복은 PR 리뷰에서도 잡히지 않습니다
- **Istio `"Jwt issuer is not configured"`는 헷갈리기 쉬운 메시지입니다.** "RequestAuthentication에 JWT rule이 없다"가 아니라 **"토큰이 전달한 iss에 매칭되는 jwtRule이 없다"**를 의미합니다
- **근본 원인까지 파고듭니다.** L1만 고치면 다음에 누군가 `configs/user.yaml`을 또 수정했을 때 같은 장애가 재발합니다. L3(SoT 부재)을 해결해야 구조적 재발 방지가 됩니다
- **failover와 앱 버그는 겹칠 때 오진을 유발합니다.** AWS origin이 없는 상태에서 Worker가 10초 timeout 후 fallback하는 동작은 "`/queue`가 느리다"로 체감되어 별개 버그로 오해되기 쉽습니다. 헤더(`x-goti-route-failover`, `x-goti-route-origin`)를 확인해 경로를 먼저 구분합니다

---

## 후속 작업

1. chart template 리팩토링 — `USER_JWT_ISSUER` env와 `requestAuthentication.issuer`를 단일 values key(`.Values.jwtIssuer`)에서 참조
2. dev 환경이 Go로 전환될 때 `USER_JWT_ISSUER` env 주입 반영
3. JWT payload 검증 스크립트를 부하 테스트 도구에 포함 — 토큰 발급 직후 `iss`/`aud`/`exp`를 자동 검사
