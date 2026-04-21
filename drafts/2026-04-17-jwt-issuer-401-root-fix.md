# 2026-04-17 — prod-gcp /queue 401 근본 원인 제거

## TL;DR

- **증상**: go-ti.shop 에서 로그인 후 /queue 진입 시 `POST /api/SS/v1/queue/enter` → 401 `"Jwt issuer is not configured"`. JWT 가 필요한 모든 API 동일 증상.
- **원인**: Goti-go 가 발급하는 JWT 의 `iss` 가 `"goti"` 였지만 Istio RequestAuthentication 은 `"goti-user-service"` 로 구성되어 있었다. viper 의 설정 파일 우선순위(`Config > Env`)가 K8s 에 이미 주입되어 있던 `USER_JWT_ISSUER` 를 덮어서 `configs/user.yaml` 의 하드코딩 값이 승리.
- **조치**: K8s values 를 issuer 의 단일 SoT 로 승격. Goti-go 에서 default/하드코딩 제거 + user 서비스는 env 미주입 시 fail-fast.
- **결과**: 12개 values 를 이리저리 동기화하는 대신, K8s 한 곳만 수정하면 전 환경이 일관된다.

## 타임라인

| 시각 (KST) | 이벤트 |
|---|---|
| 04:12 | 유저 제보 /queue 에서 401. pod 로그에 `client_ip=118.38.182.85 → 401` |
| 04:14 | curl `DO/KIA/v1/queue/enter` → Worker + Istio 경로 정상, 401 원인 JWT 쪽으로 범위 축소 |
| 04:24 | www-authenticate 헤더 + 본문에서 `Jwt issuer is not configured` 확인 |
| 04:25 | JWT payload 디코드 → `iss: "goti"`. K8s values 의 RequestAuthentication `issuer: "goti-user-service"` 와 불일치 확인 |
| 04:35 | 근본 원인 분석. drift 지점 3개 레이어로 정리 (Goti-go default, configs, K8s values) |
| 05:09 | Goti-go `977130c` 커밋 푸시 + CD workflow `#24548695059` 성공 (6개 서비스 이미지 빌드) |
| 05:15 | Goti-k8s PR #270 merge (image tag bump + `USER_JWT_ISSUER` env) |
| 05:20+ | ArgoCD auto-sync → user/queue/stadium/payment/ticketing/resale rolling update |

## 조사 과정에서 확인된 것 (가설 → 기각/확정)

1. ❌ Cloudflare Pages SPA 자체 문제 — `GET /queue` 200, HTML 정상
2. ❌ Cloudflare Worker 라우팅 문제 — `x-goti-route-origin: gcp-api.go-ti.shop`, failover 정상
3. ❌ Istio VirtualService 부재 — prod-gcp 에 `/api/v1/queue` route 존재, Envoy 처리 `x-envoy-upstream-service-time: 11ms`
4. ❌ JWKS mismatch — user/queue RequestAuthentication jwks 433 bytes bit-identical
5. ❌ `goti-queue-gate` ImagePullBackOff — 기본 /queue 플로우와 무관 (Phase 2 용)
6. ✅ **issuer drift** — JWT `iss="goti"` vs Istio `issuer="goti-user-service"`

## 핵심 단서

```
www-authenticate: Bearer realm="https://gcp-api.go-ti.shop/api/v1/queue/enter",
                  error="invalid_token"
body: Jwt issuer is not configured
```

JWT payload (base64 디코드):
```json
{"iss":"goti","sub":"...","provider_type":"GOOGLE","role":"MEMBER",...}
```

Goti-go `configs/user.yaml:27` → `issuer: "goti"`
Goti-k8s `environments/prod-gcp/goti-user/values.yaml:222` → `issuer: "goti-user-service"`

## 근본 원인 3층 분석

| 층위 | 문제 |
|---|---|
| L1 (표면) | JWT iss ≠ Istio RequestAuth issuer → 401 |
| L2 (중간) | `pkg/config/config.go:269` 가 default `"goti"` + `configs/{user,payment,stadium}.yaml` 에 `issuer: "goti"` 중복(payment/stadium 은 dead). `configs/{queue,ticketing,resale}` 는 필드 자체 없음 → default 상속. |
| L3 (근본) | issuer 값에 대한 SoT 가 없음. Goti-go 와 Goti-k8s 가 서로 다른 값을 보유하며 drift 불가피. |

## 해결 (commit 단위)

### Goti-go `977130c`
- `pkg/config/config.go`: default `"goti"` → `""` + 주석
- `internal/user/service/jwt_provider.go:NewJwtProvider`: `cfg.Issuer == ""` 이면 fail-fast
- `configs/user.yaml`: `issuer` 필드 제거 (주석으로 ENV 주입 명시)
- `configs/payment.yaml`, `configs/stadium.yaml`: dead `jwt:` 블록 제거

### Goti-k8s PR #270 (squash merge `f41b5ba`)
- `environments/prod-gcp/goti-user/values.yaml` 에 `env: USER_JWT_ISSUER=goti-user-service` 추가
- CD 가 자동 생성한 image tag bump 6개 함께 포함 (gcp-6-977130c)
- `prod/goti-user-v2/values.yaml` 은 이미 env 가 설정돼 있었으므로 재빌드만으로 수정 효과 발현

## 검증

### 기대 동작
- user pod (gcp-6-977130c) 시작 시 `USER_JWT_ISSUER=goti-user-service` 주입 → viper 가 config file 값이 없으므로 env 사용
- 로그인 시 발급되는 JWT 의 `iss` → `"goti-user-service"`
- Istio RequestAuth issuer 와 일치 → JWT API 전부 정상화

### 회귀 체크
- [ ] 브라우저 재로그인 후 /queue 진입 → 200
- [ ] 발급된 토큰 payload 에 `iss: "goti-user-service"` 확인
- [ ] queue/ticketing/resale/payment/stadium pod 로그에서 401 부재
- [ ] 기존 발급 토큰(iss="goti")은 강제 재로그인 — 현재도 이미 401 상태라 악화 없음

## 배운 점

- viper 우선순위는 `Set > Flag > Env > Config > Default`. **configs 파일에 값이 있으면 env 주입은 무시된다.** env 로 주입하고 싶다면 configs 에서 반드시 필드를 제거해야 한다.
- "같은 개념을 두 곳에 정의" 한 순간 drift 는 시간문제. 한 레포에서 끝나는 건 리뷰로 막히지만, 두 레포(예: 앱 + IaC)를 넘나드는 중복은 PR 리뷰에서도 잡히지 않는다.
- Istio 에러 메시지 `"Jwt issuer is not configured"` 는 "RequestAuthentication 에 JWT rule 이 없다" 가 아니라 **"토큰이 전달한 iss 에 매칭되는 jwtRule 이 없다"** 를 의미. (헷갈리기 쉬움)

## 후속 작업

1. chart template 리팩토링 — `USER_JWT_ISSUER` env 와 `requestAuthentication.issuer` 를 단일 values key (`.Values.jwtIssuer`) 에서 참조.
2. dev 환경이 Go 로 전환될 때 `USER_JWT_ISSUER` env 주입 반영.
3. JWT payload 검증 스크립트를 부하 테스트 도구에 포함 — 토큰 발급 직후 iss/aud/exp 를 자동 검사.

## 추가 이슈 — "/queue 페이지가 느림" 의 실체

JWT 401 을 잡은 뒤 유저가 브라우저 DevTools 에서 확인한 현상: `/queue` 의 `global-status` polling 이 **10 ~ 30 초** 씩 걸림. 서버 `latency_ms=0` 이라 서비스 내부는 멀쩡했고, 지연은 **Cloudflare Worker ↔ AWS origin 사이** 에서 발생하고 있었다.

- AWS ASG 0 (의도된 cost freeze) 상태에서 Worker 가 `fetch(https://aws-api.go-ti.shop/...)` 호출.
- TCP 연결 자체가 성립하지 못해 `~10 s` 소켓 timeout 뒤에야 catch 로 빠져 GCP fallback.
- AWS 팀 (SS/KIA/LG/HH/SSG) 선택한 유저는 매 API 호출마다 10 초 지연 누적 → 체감상 `/queue` 가 "죽은" 것처럼 보임.

### 조치 (ADR 0016)

1. **Worker Circuit Breaker** — `PRIMARY_TIMEOUT_MS=1500` + Cloudflare Cache API 로 `CB_OPEN_SEC=60` 상태 저장. AWS 한 번이라도 실패/타임아웃하면 60 초간 GCP 로 직행 (지연 없음), 60 초 뒤 첫 요청이 probe 역할. 소스: `infra/cloudflare/multicloud-router.worker.js`.
2. **GCP HPA 활성화** — prod-gcp 6 개 Go 서비스에 HPA(CPU 60 %) 적용. 2배 트래픽 유입 시 자동 scale-up. Goti-k8s PR #271.

### 검증 대기

- 사용자가 Cloudflare 대시보드에 신규 Worker 배포하면 즉시 반영.
- ArgoCD sync 후 `kubectl get hpa -n goti` 로 HPA 6 개 생성 확인.
- SS/KIA 등 AWS 매핑 팀으로 /queue 재현 → 응답 1.5 s 이내.

## 관련 링크

- Goti-go commit: https://github.com/ressKim-io/Goti-go/commit/977130c
- Goti-k8s PR #270 (issuer env): https://github.com/Team-Ikujo/Goti-k8s/pull/270
- Goti-k8s PR #271 (HPA): https://github.com/Team-Ikujo/Goti-k8s/pull/271
- CD workflow: https://github.com/ressKim-io/Goti-go/actions/runs/24548695059
- ADR 0015: `docs/adr/0015-jwt-issuer-sot-in-k8s-values.md`
- ADR 0016: `docs/adr/0016-multicloud-circuit-breaker-and-hpa.md`
- Worker 소스: `infra/cloudflare/multicloud-router.worker.js`
