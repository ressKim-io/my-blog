---
title: "dev 부하테스트 연결 3단 트러블 — SSH 터널·Istio 정책·Turnstile"
excerpt: "로컬 맥에서 Kind 클러스터로 K6 트래픽을 보내는 과정에서 mTLS RBAC 403, JWT 예외 누락, Turnstile 봇 탐지 세 가지 이슈가 연쇄 발생했고 SSH 터널과 GitOps 수정으로 두 가지를 해결한 기록입니다."
category: istio
tags:
  - go-ti
  - Istio
  - LoadTest
  - Turnstile
  - SSH
  - troubleshooting
series:
  name: goti-istio-ops
  order: 3
date: "2026-04-08"
---

## 한 줄 요약

> 맥 로컬에서 Kind dev 클러스터로 K6 부하테스트 경로를 확보하는 과정에서 mTLS 403, JWT 경로 누락 403, Turnstile 봇 탐지 403이 순차 발생했습니다. SSH 터널 NodePort 경유와 GitOps 정책 수정으로 첫 두 이슈를 해결했고, Turnstile은 서버 코드 수정이 필요한 TODO로 남겼습니다.

---

## 🔥 문제: K6 smoke 테스트 전 경로에서 403

### 환경

go-ti 프로젝트의 `feature/queue-poc-c` 브랜치를 main에 머지한 뒤, dev(Kind) 환경에서 K6 부하테스트를 실행하려 했습니다.

```text
맥(로컬) → SSH(2232) → Ubuntu 서버 → Kind 클러스터(goti-dev)
```

맥에서 Kind 클러스터로 트래픽을 보내는 경로를 먼저 확보해야 했습니다.

### 연결 경로 탐색

세 가지 방법을 순서대로 시도했습니다.

**시도 1 — `dev.go-ti.shop` 직접 접근**

Cloudflare를 경유하는 도메인이라 test API IP 제한에 걸려 403이 반환됐습니다.

**시도 2 — `kubectl port-forward` 경유**

```text
POST /api/v1/test/users status=403 body=RBAC: access denied
```

port-forward는 Istio sidecar를 우회하기 때문에 mTLS principal이 없는 상태입니다. `goti-user-dev-test-ip-allowlist` AuthorizationPolicy가 IP 기반으로 요청을 차단했습니다.

**시도 3 — SSH 터널 → NodePort**

성공했습니다. 이후 이 경로로 진행했습니다.

```text
맥 localhost:18080 → SSH(2232) → Ubuntu → 172.20.0.2:31080(Kind NodePort) → Istio Gateway → Pod
```

탐색 과정에서 두 가지 추가 장애물이 있었습니다.

- `resshome.iptime.org`의 DDNS에 `dev-api` 서브도메인이 없어 NXDOMAIN
- `localhost:31080` 연결 거부 → Kind NodePort는 Docker 네트워크 IP(`172.20.0.2`)로 바인딩됨
- `31443`(HTTPS) 연결 거부 → `31080`(HTTP)만 동작

경로를 확보한 뒤 실제 테스트를 실행했을 때 두 가지 추가 403이 발생했습니다.

### 이슈 1: queue global-status 403

```text
GET /api/v1/queue/{gameId}/global-status status=403 body=RBAC: access denied
```

`goti-queue-dev-require-jwt` 정책의 `notPaths`에 `global-status` 경로가 누락되어 있었습니다. CDN 캐싱용 공개 API인데 JWT 예외 처리가 적용되지 않은 상태였습니다.

### 이슈 2: Turnstile 봇 탐지 403

```text
GET /api/v1/stadium-seats/games/{gameId}/seat-grades status=403
body={"code":"CLIENT_ERROR","message":"봇 감지: 요청이 거부되었습니다."}
```

K6 요청에 `X-Turnstile-Token` 헤더가 없어 Turnstile 검증이 실패했습니다. 서버에 검증 비활성화 flag가 없는 상태였습니다.

---

## 🤔 원인

### 이슈 1 원인 — Istio 경로 매칭 누락

`goti-queue-dev-require-jwt` AuthorizationPolicy의 `notPaths` 목록에 `global-status`가 빠져 있었습니다.

처음에는 `/api/v1/queue/*/global-status` 형태의 와일드카드를 시도했으나 Istio는 경로 중간 와일드카드를 지원하지 않습니다. `*`는 prefix(`/foo/*`) 또는 suffix(`*/bar`) 위치에서만 동작합니다.

### 이슈 2 원인 — Turnstile 비활성화 경로 없음

Cloudflare Turnstile 시크릿은 `AWS Parameter Store → ExternalSecret → Pod 환경변수` 경로로 주입됩니다.

Cloudflare가 제공하는 테스트 시크릿(`1x0000000000000000000000000000000AA`)을 사용하면 더미 토큰으로 검증을 통과할 수 있지만, Parameter Store 값을 변경하면 다른 팀원의 실제 Turnstile 검증이 깨집니다. 서버 코드에 `cloudflare.turnstile.enabled` flag 자체가 없어서 환경별로 비활성화할 방법이 없는 것이 근본 원인입니다.

---

## ✅ 해결

### 1단계 — SSH 터널 경로 확립

Ubuntu 서버(`resshome`)를 경유하는 SSH 터널로 Kind NodePort에 접근하는 경로를 고정했습니다.

```bash
# 맥에서 SSH 터널 수립
$ ssh -L 18080:172.20.0.2:31080 -p 2232 <user>@resshome.iptime.org -N
```

K6 스크립트에서 `HOST_HEADER` 환경변수를 지원하도록 `Goti-load-test`를 수정했습니다.

```javascript
// helpers/http-client.js
const hostHeader = __ENV.HOST_HEADER;
if (hostHeader) {
  params.headers['Host'] = hostHeader;
}
```

```bash
# run.sh — HOST_HEADER CLI/config 지원 + K6 args 전달
HOST_HEADER=dev.go-ti.shop k6 run --env HOST_HEADER=$HOST_HEADER script.js
```

### 2단계 — Istio 정책 수정 (GitOps)

**test API IP 제한 비활성화**

ArgoCD selfHeal이 활성화되어 있어 `kubectl delete`로 정책을 지워도 즉시 재생성됩니다. GitOps 소스를 수정해야 합니다.

```yaml
# Goti-k8s/environments/dev/goti-user/values.yaml
testIpAllowlist:
  enabled: false  # false로 변경
```

**queue global-status JWT 예외 추가**

```yaml
# Goti-k8s/environments/dev/goti-queue/values.yaml
excludePaths:
  - "*/global-status"   # suffix 매칭 — Istio 중간 와일드카드 미지원
```

첫 시도에서 `/api/v1/queue/*/global-status`를 사용했으나 적용되지 않았습니다. Istio 경로 매칭 규칙에 따라 suffix 형태인 `*/global-status`로 변경하여 해결했습니다.

ArgoCD sync 후 두 정책이 정상 적용되었고 관련 403이 사라졌습니다.

### 3단계 — Turnstile (미해결, TODO)

이 이슈는 서버 코드 수정이 필요합니다. 수정 계획은 다음과 같습니다.

```java
// CloudflareTurnstileProperties.java
@ConfigurationProperties("cloudflare.turnstile")
public class CloudflareTurnstileProperties {
    private boolean enabled = true;  // enabled 필드 추가
    // ...
}
```

```java
// TurnstileService.java
public boolean verify(String token) {
    if (!properties.isEnabled()) {
        return true;  // enabled=false면 검증 건너뜀
    }
    // 기존 검증 로직
}
```

```yaml
# application.yml
cloudflare:
  turnstile:
    enabled: ${CLOUDFLARE_TURNSTILE_ENABLED:true}
```

```yaml
# Goti-k8s/environments/dev/goti-ticketing/values.yaml
env:
  - name: CLOUDFLARE_TURNSTILE_ENABLED
    value: "false"  # 부하테스트 시만 비활성화
```

팀원 작업과 충돌 가능성이 있어 서버 코드 수정은 조율 후 진행해야 합니다.

### 결과

| 항목 | 결과 |
|------|------|
| smoke 테스트 (schedules, signup, orders, today games) | 전체 통과 |
| queue 진입(enter) + polling(global-status) | 성공 |
| SSH 터널 경로 | `localhost:18080 → 172.20.0.2:31080` 확립 |
| HOST_HEADER 환경변수 | 커밋·push 완료 |
| seat-grades (Turnstile) | 미해결 |
| seat-sections 400 | 미해결 (4/9 이후 경기 ID로 교체 필요) |

---

## 📚 배운 점

- **Istio 중간 와일드카드 미지원**: `*`는 prefix(`/foo/*`) 또는 suffix(`*/bar`) 위치에서만 동작합니다. `/foo/*/bar` 형태는 지원되지 않으므로, 중간 세그먼트가 가변인 경로는 suffix 매칭 또는 정책 분리로 처리해야 합니다

- **ArgoCD selfHeal 환경에서 kubectl delete는 무효**: selfHeal이 활성화된 ArgoCD 앱에서는 리소스를 직접 삭제해도 즉시 재생성됩니다. 정책을 바꾸려면 반드시 GitOps 소스(values.yaml)를 수정해야 합니다

- **kubectl port-forward는 Istio sidecar를 우회**: port-forward는 Istio sidecar 체인을 거치지 않아 mTLS principal이 없는 상태로 요청이 들어옵니다. source identity 기반 AuthorizationPolicy가 있는 서비스에 port-forward로 접근하면 403이 발생합니다

- **Kind NodePort는 Docker 네트워크 IP에 바인딩**: Kind 클러스터의 NodePort는 `localhost`가 아니라 Docker bridge 네트워크 IP(`172.20.x.x`)에 바인딩됩니다. SSH 터널 설정 시 이 IP를 타겟으로 지정해야 합니다

- **테스트 환경 우회는 flag로 설계**: Turnstile처럼 외부 검증 서비스가 필요한 기능은 서버 코드에 `enabled` 환경변수 flag를 처음부터 만들어두면 테스트 환경에서 선택적으로 비활성화할 수 있습니다. 사후에 추가하면 팀 작업과 충돌할 가능성이 생깁니다
