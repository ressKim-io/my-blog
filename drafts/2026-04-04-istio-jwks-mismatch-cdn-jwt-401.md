---
date: 2026-04-04
category: troubleshoot
project: Goti-k8s
tags: [istio, jwt, jwks, cdn, cloudflare, ssm, external-secret, falco, mTLS]
---

# Istio JWKS public key 불일치로 CDN 경유 JWT 401 — SSM Parameter Store 동적 조회로 전환

## Context

CDN 캐싱 부하테스트 준비 중. 수연님 대기열 구현체(queue-suyeon)를 Cloudflare CDN 경유로 테스트하려 했으나, 모든 인증 API에서 401 발생. 이전 테스트(4/3)는 ALB 직접 접근으로 성공했었음.

- 환경: EKS prod, Istio 1.29, ArgoCD v3.3, Cloudflare CDN
- 경로: K6 → Cloudflare (api.go-ti.shop) → ALB → Istio Ingress → queue-suyeon pod

## Issue

```
POST https://api.go-ti.shop/api/v1/queue/suyeon/enter status=401 body=Jwt verification fails
```

- signup (user 서비스) 200 OK → JWT 발급 성공
- queue enter (queue-suyeon) 401 → 동일 JWT 거부
- 응답 헤더: `x-envoy-upstream-service-time: 4` → Istio Envoy가 4ms만에 차단 (앱 미도달)
- JWT 디코딩: `kid: goti-jwt-key-1`, `iss: goti-user-service`, `alg: RS256` — 정상

재현 조건: Cloudflare CDN 경유 시 100% 재현. ALB 직접 접근 시 정상 (단, ALB SG 임시 규칙 이미 제거됨).

## Action

### 가설 1: Istio RequestAuthentication issuer 불일치 → 기각

```bash
kubectl get requestauthentication goti-queue-suyeon-prod-jwt -n goti -o yaml
# issuer: goti-user-service ← JWT의 iss와 일치. 문제 아님.
```

### 가설 2: POC 이미지에 SecurityConfig 누락 → 부분 원인

k8s-troubleshooter 조사 결과 pod 시작 로그에 `Using generated security password` 확인. POC 이미지(`poc-suyeon-37-8856b54`)에 QueueSecurityConfig 미포함. 하지만 이건 Spring 레벨이고, 401은 Istio Envoy에서 발생 (응답 시간 4ms, content-type: text/plain).

### 가설 3: JWKS public key 불일치 → **근본 원인 (Root Cause)**

```bash
# Istio에 박힌 JWKS의 RSA modulus
kubectl get ra goti-queue-suyeon-prod-jwt -n goti -o jsonpath='{.spec.jwtRules[0].jwks}'
# n: vFL8-RL8O2K_ZTTsCD0k...  ← 오래된 키

# User 서비스 실제 키
kubectl exec goti-user-prod-xxx -c goti-server -- wget -qO- http://localhost:8080/.well-known/jwks.json
# n: tXlfiSkDgSujDP6wUyQc...  ← 현재 키

# 전체 19개 서비스 전부 MISMATCH
```

Istio RequestAuthentication에 하드코딩된 JWKS의 RSA public key(`n`)가 User 서비스의 실제 키와 **완전히 다름**. prod 14개 + prod-gcp 5개 = 전체 19개 서비스 전부 오래된 키.

### 어제(4/3) ALB 직접 접근이 된 이유

queue-suyeon에 `require-jwt` AuthorizationPolicy 누락 → Istio가 JWT 검증 실패해도 요청 통과시킴 → Spring 앱의 MeshAuthenticationFilter가 X-User-Id 헤더로 인증 처리. 즉 **어제도 Istio JWT 검증은 실패했지만 앱이 fallback으로 동작**한 것.

### 수정 1차: jwksUri 동적 조회 시도 → 실패

19개 파일의 `jwks` (하드코딩) → `jwksUri` (동적 조회)로 전환 시도.

```
istiod 로그:
Failed to fetch public key from jwksUri: read tcp ... connection reset by peer
The JWKS key is not yet fetched, using a fake JWKS for now
```

**원인**: istio-system에 `STRICT mTLS` PeerAuthentication이 걸려있어, istiod가 user 서비스에 plain HTTP로 JWKS를 가져오려 할 때 sidecar가 connection reset. istiod는 mesh 밖에서 직접 HTTP 요청을 보내므로 mTLS handshake 불가.

### 수정 2차 (최종): SSM Parameter Store → ExternalSecret → Helm lookup

1. **SSM에 JWKS 저장**: `/prod/server/ISTIO_JWKS`
2. **Helm 템플릿 수정**: `_requestauthentication.tpl`에 `jwksFromSecret` 옵션 추가. `lookup`으로 ExternalSecret이 만든 Secret에서 `ISTIO_JWKS` 키를 동적으로 읽어 RequestAuthentication에 주입
3. **values.yaml 전환**: 20개 파일에서 `jwksUri` → `jwksFromSecret: { key: "ISTIO_JWKS" }`
4. **JWKS 소스 우선순위**: `jwksFromSecret` > `jwks` (인라인) > `jwksUri`

### 추가 수정: Falco 오탐 예외 처리

디버깅 중 `kubectl exec`으로 pod 내부 `wget` 실행 시 Falco가 istio-proxy의 `/etc/passwd` 읽기를 CRITICAL로 탐지. Discord 알림 폭주.

Falco 룰을 실무 패턴으로 리팩토링:
- condition에 `and not (...)` 추가 (레거시) → `exceptions` 필드 사용 (Falco 0.28+ 공식)
- 룰/예외 파일 분리: `goti-rules.yaml` (룰 + exception 슬롯) + `goti-exceptions.yaml` (values만, append: true)
- 사유/날짜/검토주기 주석 필수

## Result

- SSM Parameter Store에 JWKS 저장 완료 (`/prod/server/ISTIO_JWKS`, Version 1)
- Helm 템플릿 `jwksFromSecret` lookup 구현 완료
- 20개 values.yaml 전환 완료 (하드코딩 제거)
- Falco 예외 파일 분리 완료 (istio-proxy /etc/passwd, shell, wget/curl)
- **Smoke 테스트**: push 후 ExternalSecret refresh + ArgoCD sync 대기 중 (검증 미완료)

### 회귀 테스트

- [x] ExternalSecret이 SSM에서 `ISTIO_JWKS` 키를 정상적으로 가져오는지 확인
- [x] ~~Helm lookup이 Secret에서 값을 읽어 RequestAuthentication에 주입하는지 확인~~ → ArgoCD에서 lookup 불가, inline jwks로 유지
- [x] CDN 경유 smoke 테스트 (queue-suyeon enter 200) → **queue_pass_rate 100%**
- [ ] Falco 알림이 istio-proxy /etc/passwd에 대해 더 이상 발생하지 않는지 확인 (Falco 임시 비활성화 중)

### 재발 방지

| 방지책 | 상세 |
|--------|------|
| JWKS 하드코딩 금지 | SSM → ExternalSecret → Helm lookup 파이프라인으로 자동화 |
| 키 로테이션 시 | SSM만 업데이트 → ExternalSecret 1h refresh → ArgoCD sync |
| Falco 예외 관리 | `goti-exceptions.yaml`에 values만 추가, 룰 condition 수정 금지 |
| STRICT mTLS 환경 주의 | `jwksUri`는 istiod가 plain HTTP로 요청하므로 STRICT mTLS에서 불가. `jwksFromSecret` 또는 inline `jwks` 사용 |

## 추가 발견 이슈 (동일 세션)

| 이슈 | 원인 | 수정 |
|------|------|------|
| RBAC 403 (global-status) | jwtAuthorizationPolicy `excludePaths: []` → Istio `operation: null` validation 에러 + Istio notPaths 중간 와일드카드 미지원 | queue-suyeon jwtAuthorizationPolicy 비활성화 |
| pricing 404 | `my-config.env`에 dev UUID (`.seed-ids.json`) 사용, prod는 step0 SQL UUID | prod 실제 UUID로 수정 (`e5f58f8c`, `4553f1c7`) |
| TLS 에러 (ALB 직접) | ALB 인증서가 `harbor.go-ti.shop`용, ALB 호스트네임 불일치 | K6 `insecureSkipTLSVerify: true` 추가 |
| ALB 직접 404 | Istio VirtualService가 ALB 호스트네임으로 매칭 안 됨 | CDN 경유로 smoke (ALB 직접 시 Host 헤더 필요) |
| Helm lookup 불가 | ArgoCD는 `helm template` 사용, `lookup` 함수가 클러스터 접근 불가 | inline jwks 유지, SSM은 향후 자동화용 보관 |
| seat-enter 409 | Redis에 이전 테스트 데이터 잔류 | FLUSHDB로 초기화 |

## Related Files

- `Goti-k8s/charts/goti-common/templates/_requestauthentication.tpl` — jwksFromSecret lookup 추가
- `Goti-k8s/charts/goti-server/values.yaml` — jwksFromSecret 기본값 추가
- `Goti-k8s/environments/prod/goti-*/values.yaml` (14개) — jwksFromSecret 전환
- `Goti-k8s/environments/prod-gcp/goti-*/values.yaml` (5개) — jwksFromSecret 전환
- `Goti-k8s/environments/prod/goti-guardrail/values.yaml` — jwksFromSecret 전환
- `Goti-k8s/infrastructure/prod/falco/values.yaml` — 룰/예외 분리 + exceptions 패턴 적용
- `Goti-load-test/helpers/data-setup.js` — GAME_ID 직접 지정 시 schedules 조회 스킵
- `Goti-load-test/run.sh` — STADIUM_ID, HOME_TEAM_ID 환경변수 전달 추가
- `Goti-load-test/my-config.env` — CDN 테스트용 설정 (KIA vs NC 4/5 경기)
