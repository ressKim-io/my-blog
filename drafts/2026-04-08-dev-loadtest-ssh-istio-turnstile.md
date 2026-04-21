---
date: 2026-04-08
category: troubleshoot
project: Goti-load-test / Goti-k8s
tags: [k6, ssh-tunnel, istio, authorizationpolicy, turnstile, kind, port-forward]
---

# dev 부하테스트 연결: SSH 터널 + Istio 정책 + Turnstile 3단계 트러블슈팅

## Context

Goti-load-test의 `feature/queue-suyeon` 브랜치를 main에 머지 후, dev(Kind) 환경에서 K6 부하테스트 실행을 시도.
로컬 맥에서 Kind 클러스터로 K6 트래픽을 보내는 경로를 확보하는 과정에서 3가지 연쇄 이슈 발생.

**환경**: 맥(로컬) → SSH 터널 → Ubuntu 서버(resshome) → Kind 클러스터(goti-dev)

## Issue

### 이슈 1: kubectl port-forward 경유 시 mTLS principal 없음 → 403

```
POST /api/v1/test/users status=403 body=RBAC: access denied
```

kubectl port-forward는 Istio sidecar를 거치지 않아 mTLS principal이 없음.
`goti-user-dev-test-ip-allowlist` AuthorizationPolicy가 IP 기반으로 차단.

### 이슈 2: SSH 터널 → NodePort 경유 시 queue global-status 403

```
GET /api/v1/queue/{gameId}/global-status status=403 body=RBAC: access denied
```

`goti-queue-dev-require-jwt` 정책의 `notPaths`에 `global-status` 경로 누락.
CDN 캐싱용 공개 API인데 JWT 예외 처리가 안 되어 있었음.

### 이슈 3: Turnstile 봇 탐지 403

```
GET /api/v1/stadium-seats/games/{gameId}/seat-grades status=403
body={"code":"CLIENT_ERROR","message":"봇 감지: 요청이 거부되었습니다."}
```

K6 요청에 `X-Turnstile-Token` 헤더가 없어 Turnstile 검증 실패.
서버에 검증 비활성화 flag가 없음.

## Action

### 1단계: 연결 경로 확보

1. **가설: `dev.go-ti.shop` 직접 접근** → Cloudflare 경유라 403 (test API IP 제한)
2. **가설: kubectl port-forward** → mTLS 없어서 RBAC DENY
3. **가설: SSH 터널 → NodePort** → 성공!

**해결 경로**:
```
맥 localhost:18080 → SSH(2232) → Ubuntu → 172.20.0.2:31080(Kind NodePort) → Istio Gateway → Pod
```

- `resshome.iptime.org`의 DDNS에 `dev-api` 서브도메인 없음 (NXDOMAIN)
- `localhost:31080` 연결 거부 → Kind NodePort는 Docker 네트워크 IP(172.20.0.2)로 바인딩
- `31443`(HTTPS) 연결 거부 → `31080`(HTTP)만 동작

### 2단계: Istio 정책 수정

**test API IP 제한 비활성화**:
- `Goti-k8s/environments/dev/goti-user/values.yaml`: `testIpAllowlist.enabled: false`
- ArgoCD selfHeal이 즉시 재생성하므로 kubectl delete 무효 → GitOps 소스 수정 필수

**queue global-status JWT 예외 추가**:
- `Goti-k8s/environments/dev/goti-queue/values.yaml`: `excludePaths`에 `*/global-status` 추가
- 첫 시도 `/api/v1/queue/*/global-status` 실패 — Istio는 경로 중간 와일드카드 미지원
- suffix 매칭 `*/global-status`로 수정하여 해결

**HOST_HEADER 환경변수 지원 추가** (Goti-load-test):
- `helpers/http-client.js`: `HOST_HEADER` 환경변수 있으면 Host 헤더 자동 주입
- `run.sh`: `HOST_HEADER` CLI/config 지원 + K6 args 전달 + 배너 표시

### 3단계: Turnstile 봇 탐지 (미해결)

- `CLOUDFLARE_TURNSTILE_SECRET`은 AWS Parameter Store → ExternalSecret → Pod 환경변수
- Cloudflare 테스트 시크릿(`1x0000000000000000000000000000000AA`) 사용하면 더미 토큰 통과 가능
- 하지만 Parameter Store 변경 시 팀원들의 실제 Turnstile 검증이 깨짐
- **결론: 서버 코드에 `cloudflare.turnstile.enabled` flag 추가 필요**

## Result

### 해결된 것
- smoke 테스트: dev 환경에서 **전체 통과** (schedules, signup, orders, today games)
- queue 진입(enter) + polling(global-status): **성공**
- SSH 터널 경로 확립: `localhost:18080 → 172.20.0.2:31080`
- HOST_HEADER 환경변수: 커밋 + push 완료

### 미해결 (TODO)
- **Turnstile 우회**: 서버 코드 수정 필요 (팀원 작업과 충돌 가능)
  - `CloudflareTurnstileProperties`에 `enabled` 필드 추가
  - `TurnstileService.verify()`에서 `enabled=false`면 `true` 반환
  - `application.yml`: `cloudflare.turnstile.enabled: ${CLOUDFLARE_TURNSTILE_ENABLED:true}`
  - K8s values: `CLOUDFLARE_TURNSTILE_ENABLED=false` 환경변수로 부하테스트 시만 비활성화
- **seat-sections 400**: `"예매 가능 시간이 만료되었습니다"` — 4/9 경기(`5c4598e0`)로 변경 필요
- **prod 적용**: 동일 패턴 (SSH 터널 대신 ALB 직접, Turnstile flag는 동일)

### Istio 경로 매칭 교훈
- `*`는 prefix(`/foo/*`) 또는 suffix(`*/bar`)에서만 동작
- 중간 와일드카드(`/foo/*/bar`) **미지원** — 별도 정책 분리 또는 suffix 매칭 사용

## Related Files

### 수정 완료 (커밋됨)
- `Goti-load-test/helpers/http-client.js` — HOST_HEADER 환경변수 지원
- `Goti-load-test/run.sh` — HOST_HEADER CLI/config/K6 args 전달
- `Goti-k8s/environments/dev/goti-user/values.yaml` — testIpAllowlist.enabled: false
- `Goti-k8s/environments/dev/goti-queue/values.yaml` — global-status JWT 예외 (suffix 매칭)

### 수정 필요 (TODO)
- `Goti-server/integration/.../CloudflareTurnstileProperties.java` — enabled 필드 추가
- `Goti-server/integration/.../TurnstileService.java` — enabled 체크 로직
- `Goti-server/ticketing/src/main/resources/application.yml` — enabled 환경변수
- `Goti-k8s/environments/dev/goti-ticketing/values.yaml` — CLOUDFLARE_TURNSTILE_ENABLED env
