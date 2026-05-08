---
title: "Istio JWKS 불일치: CDN 경유하면 JWT가 401인 이유"
excerpt: "RequestAuthentication에 하드코딩된 JWKS가 실제 키와 달라서 19개 서비스 전부 JWT 검증 실패 — jwksUri도 STRICT mTLS에서 불가능했던 디버깅 여정"
category: kubernetes
tags:
  - go-ti
  - Istio
  - JWT
  - JWKS
  - CDN
  - Cloudflare
  - mTLS
  - SSM
  - ExternalSecret
  - Falco
  - Troubleshooting
date: "2026-04-04"
---

## 🎯 한 줄 요약

> CDN 경유 테스트에서 모든 인증 API가 401을 반환했습니다. Istio RequestAuthentication에 하드코딩된 JWKS의 RSA public key가 실제 User 서비스 키와 달랐기 때문입니다. 19개 서비스 전부 오래된 키를 사용 중이었고, jwksUri 동적 조회도 STRICT mTLS에서 불가능했습니다

## 📊 Impact

- **영향 범위**: prod 14개 + prod-gcp 5개 = **19개 서비스 전부** JWT 검증 실패 (잠재적)
- **직접 증상**: CDN(Cloudflare) 경유 테스트 완전 차단
- **소요 시간**: 약 5시간 (디버깅 3시간 + 수정/검증 2시간)
- **발생일**: 2026-04-04
- **환경**: EKS prod, Istio 1.29, ArgoCD v3.3, Cloudflare CDN

---

## 🔥 증상: CDN 경유하면 401, ALB 직접이면 200

### 테스트 배경

CDN 캐싱 부하테스트를 준비하고 있었습니다.
A님 대기열 구현체(queue-suyeon)를 Cloudflare CDN 경유로 테스트하려고 했습니다.

테스트 경로는 `K6 → Cloudflare (api.go-ti.shop) → ALB → Istio Ingress → queue-suyeon Pod` 순서로 흐릅니다.

어제(4/3)는 ALB에 직접 접근해서 테스트했고, 그때는 성공했습니다.
오늘은 CDN을 거치는 실제 경로로 테스트하려는 것이었습니다.

### 에러 로그

K6를 실행하자마자 모든 인증 API에서 401이 쏟아졌습니다.

```log
POST https://api.go-ti.shop/api/v1/queue/suyeon/enter status=401 body=Jwt verification fails
```

이상한 점이 있었습니다.

| 요청 | 결과 |
|---|---|
| `signup` (user 서비스) | 200 OK — JWT 발급 성공 |
| `queue enter` (queue-suyeon) | 401 — 동일 JWT 거부 |

같은 JWT를 사용하는데 user 서비스에서는 성공하고, queue-suyeon에서는 실패합니다.

### 응답 분석: 4ms = Envoy가 차단했다

응답 헤더를 확인했습니다.

```
x-envoy-upstream-service-time: 4
content-type: text/plain
```

4ms만에 응답이 돌아왔습니다.
Spring 앱이 처리했다면 최소 수십 ms는 걸립니다.
**4ms는 Istio Envoy sidecar가 요청을 앱까지 보내지도 않고 차단했다는 뜻입니다.**

content-type이 `text/plain`인 것도 힌트입니다.
Spring은 보통 `application/json`으로 응답합니다.
`text/plain`은 Envoy가 직접 생성한 에러 응답의 특징입니다.

### JWT 디코딩: 토큰 자체는 정상

혹시 JWT 자체에 문제가 있나 확인했습니다.

```json
{
  "kid": "goti-jwt-key-1",
  "iss": "goti-user-service",
  "alg": "RS256",
  "sub": "user-uuid-...",
  "exp": 1743800000
}
```

`kid`, `iss`, `alg` 전부 정상입니다.
만료 시간도 충분히 남아있었습니다.

JWT 자체는 문제가 없습니다.
그렇다면 **검증하는 쪽**에 문제가 있다는 뜻입니다.

---

## 🤔 가설 검증 과정

### 가설 1: issuer 불일치 → 기각

Istio RequestAuthentication의 issuer 설정이 JWT의 `iss` 클레임과 다른 건 아닌지 확인했습니다.

```bash
$ kubectl get requestauthentication goti-queue-suyeon-prod-jwt -n goti -o yaml
```

```yaml
spec:
  jwtRules:
    - issuer: goti-user-service  # ← JWT의 iss와 일치
```

issuer는 일치합니다. **기각.**

### 가설 2: POC 이미지에 SecurityConfig 누락 → 부분 원인

k8s-troubleshooter로 pod 로그를 조사했더니 수상한 로그가 있었습니다.

```log
Using generated security password: 8a3f2b1c-...
```

이 메시지는 Spring Security가 자동 생성한 비밀번호를 사용한다는 뜻입니다.
POC 이미지(`poc-suyeon-37-8856b54`)에 `QueueSecurityConfig`가 포함되지 않았습니다.

하지만 이건 **Spring 레벨**의 문제입니다.
401 응답이 4ms만에, `text/plain`으로 왔다는 건 **Istio 레벨**에서 차단됐다는 뜻입니다.

Spring SecurityConfig 누락은 별도로 수정해야 할 문제지만, **지금 401의 원인은 아닙니다.**

### 가설 3: JWKS public key 불일치 → ROOT CAUSE

Istio가 JWT를 검증하려면 **공개 키(JWKS)**가 필요합니다.
RequestAuthentication에 하드코딩된 JWKS와 User 서비스의 실제 키를 비교했습니다.

```bash
# Istio RequestAuthentication에 박힌 JWKS
$ kubectl get ra goti-queue-suyeon-prod-jwt -n goti \
    -o jsonpath='{.spec.jwtRules[0].jwks}' | jq '.keys[0].n'
"vFL8-RL8O2K_ZTTsCD0k..."   # ← 오래된 키
```

```bash
# User 서비스가 실제 사용하는 키
$ kubectl exec goti-user-prod-xxx -c goti-server -- \
    wget -qO- http://localhost:8080/.well-known/jwks.json | jq '.keys[0].n'
"tXlfiSkDgSujDP6wUyQc..."   # ← 현재 키
```

**RSA modulus(`n`)가 완전히 다릅니다.**

User 서비스가 JWT를 서명할 때 쓰는 private key에 대응하는 public key와, Istio가 검증에 쓰는 public key가 다른 것이었습니다.

Istio는 오래된 키로 서명을 검증하니 당연히 실패합니다.

### 19개 서비스 전부 MISMATCH

혹시 queue-suyeon만의 문제인지 확인하기 위해 모든 서비스를 점검했습니다.

```bash
# prod 14개 서비스
$ for svc in $(kubectl get ra -n goti -o name); do
    echo "$svc: $(kubectl get $svc -n goti -o jsonpath='{.spec.jwtRules[0].jwks}' | jq -r '.keys[0].n[:20]')"
  done
```

```
goti-user-prod-jwt: vFL8-RL8O2K_ZTTsCD...
goti-queue-suyeon-prod-jwt: vFL8-RL8O2K_ZTTsCD...
goti-payment-junsang-prod-jwt: vFL8-RL8O2K_ZTTsCD...
goti-ticketing-prod-jwt: vFL8-RL8O2K_ZTTsCD...
... (14개 전부 동일한 오래된 키)
```

prod-gcp 5개도 마찬가지였습니다.
**총 19개 서비스가 전부 오래된 JWKS를 사용하고 있었습니다.**

이것은 단순히 "하나 빠뜨렸다"가 아니라, **JWKS를 하드코딩해서 배포하는 구조 자체의 문제**입니다.

### 인증 흐름 전체 그림

![JWT 인증 흐름 — JWKS 검증 실패 위치](/diagrams/goti-istio-jwks-mismatch-cdn-jwt-401-1.svg)

Envoy sidecar가 JWT를 파싱하고, RequestAuthentication에 설정된 JWKS로 서명을 검증합니다.
이때 JWKS의 public key가 실제 signing key와 다르면, 서명 검증이 실패하고 요청이 앱까지 도달하지 못합니다.

**이것이 4ms만에 401이 돌아온 이유입니다.**

---

## 🤔 어제는 왜 됐지? — AuthorizationPolicy 누락의 함정

여기서 한 가지 의문이 생깁니다.

> "JWKS가 19개 서비스 전부 틀려있었다면, 어제 ALB 직접 접근 테스트는 왜 성공했지?"

이 질문이 핵심이었습니다.

### require-jwt가 없으면 검증 실패해도 통과한다

Istio에서 JWT 인증은 **두 단계**로 동작합니다.

1. **RequestAuthentication**: JWT를 파싱하고 서명을 검증합니다 (JWKS 사용)
2. **AuthorizationPolicy**: `requestPrincipals`을 체크하여 JWT가 없거나 유효하지 않은 요청을 **차단**합니다

핵심은 이겁니다.
**RequestAuthentication만 있고 AuthorizationPolicy가 없으면, JWT 검증 실패 시 요청이 그냥 통과합니다.**

queue-suyeon에는 `require-jwt` AuthorizationPolicy가 **누락**되어 있었습니다.

두 케이스의 차이를 정리하면 이렇습니다.

**AuthorizationPolicy 있음 (enforce, 정상 서비스)**: JWT가 RequestAuthentication에서 검증 실패하면 `require-jwt` AuthorizationPolicy가 매칭되어 401로 차단합니다.

**AuthorizationPolicy 없음 (permissive, queue-suyeon)**: JWT가 RequestAuthentication에서 검증 실패해도 매칭되는 AuthorizationPolicy가 없어 요청이 그대로 앱으로 통과합니다. 그러면 Spring Filter가 `X-User-Id` 헤더로 인증을 처리합니다.

어제 테스트가 성공한 흐름을 정리하면 이렇습니다.

1. K6이 JWT를 포함해서 요청을 보냄
2. Envoy sidecar가 JWT 서명 검증 → **실패** (JWKS 불일치)
3. AuthorizationPolicy가 없으므로 → **요청 통과**
4. Spring 앱의 `MeshAuthenticationFilter`가 `X-User-Id` 헤더로 인증 처리
5. 200 OK 응답

**어제도 Istio JWT 검증은 실패했지만, 앱이 fallback으로 동작한 것입니다.**

### 그러면 오늘은 왜 실패했나?

CDN 경유 테스트를 위해 queue-suyeon에 AuthorizationPolicy를 추가했기 때문입니다.
보안 설정을 강화하면서 `require-jwt` 정책을 넣었는데, 정작 JWKS가 틀려있었으니 모든 요청이 차단된 것입니다.

**보안을 강화했더니 숨어있던 설정 오류가 드러난 전형적인 케이스입니다.**

---

## 🔧 수정 시도 1: jwksUri → STRICT mTLS에서 불가

### 아이디어

하드코딩이 문제라면, 동적으로 가져오면 됩니다.
Istio RequestAuthentication은 `jwksUri`를 지원합니다.

```yaml
spec:
  jwtRules:
    - issuer: goti-user-service
      jwksUri: http://goti-user-prod.goti.svc.cluster.local:8080/.well-known/jwks.json
```

istiod가 주기적으로 이 URL에서 JWKS를 가져와서 Envoy에 배포합니다.
키가 변경되어도 자동으로 반영되니 완벽한 해결책처럼 보였습니다.

19개 파일의 `jwks` (하드코딩)를 `jwksUri` (동적 조회)로 전환하고 배포했습니다.

### 실패

ArgoCD sync 후 istiod 로그를 확인했습니다.

```log
Failed to fetch public key from jwksUri: read tcp 10.0.1.23:44892->10.0.2.45:8080: connection reset by peer
The JWKS key is not yet fetched, using a fake JWKS for now
```

`connection reset by peer`. 연결이 거부되고 있었습니다.
그리고 `using a fake JWKS for now` — istiod가 가짜 JWKS를 사용하겠다는 겁니다.

**이러면 모든 JWT 검증이 실패합니다.**

### 원인: STRICT mTLS와 istiod의 충돌

왜 connection reset이 발생했는지 파악했습니다.

우리 환경에는 `istio-system` 네임스페이스에 STRICT mTLS PeerAuthentication이 걸려있습니다.

```yaml
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: default
  namespace: istio-system
spec:
  mtls:
    mode: STRICT
```

이 설정이 문제를 만듭니다.
istiod가 JWKS를 가져오는 흐름을 살펴보겠습니다.

![istiod JWKS fetch가 STRICT mTLS에 막히는 흐름](/diagrams/goti-istio-jwks-mismatch-cdn-jwt-401-2.svg)

1. istiod가 User 서비스의 `/.well-known/jwks.json`에 **plain HTTP** 요청을 보냄
2. User Pod의 Envoy sidecar가 이 요청을 가로챔
3. Envoy는 STRICT mTLS를 요구하는데, istiod의 요청은 plain HTTP
4. **connection reset**

istiod는 mesh 컨트롤 플레인이지만, JWKS fetch 시에는 **일반 HTTP 클라이언트**처럼 동작합니다.
mesh 내부의 mTLS 인증서를 사용하지 않습니다.

STRICT mTLS 환경에서는 `jwksUri`를 사용할 수 없습니다.
이것은 Istio의 알려진 제약사항입니다.

해결 방법은 몇 가지가 있습니다.
- User 서비스의 JWKS 엔드포인트만 PERMISSIVE로 변경
- mesh 외부에 JWKS 엔드포인트를 노출

하지만 보안 정책을 약화시키는 건 바람직하지 않습니다.
다른 방법을 찾아봤습니다.

---

## 🔧 수정 시도 2: SSM → ExternalSecret → Helm lookup

### 아이디어

JWKS를 하드코딩하지 않되, `jwksUri`도 사용할 수 없다면?
**외부 Secret Store에서 JWKS를 가져와서 주입하면 됩니다.**

구상한 파이프라인은 `SSM Parameter Store → ExternalSecret → K8s Secret → Helm lookup → RequestAuthentication` 순서입니다.

1. AWS SSM Parameter Store에 JWKS를 저장
2. ExternalSecret이 주기적으로 SSM에서 가져와서 K8s Secret으로 동기화
3. Helm 템플릿에서 `lookup` 함수로 Secret의 값을 읽어 RequestAuthentication에 주입

키가 변경되면 SSM만 업데이트하면 됩니다.
ExternalSecret이 1시간마다 refresh하고, ArgoCD sync 시 새 키가 자동 반영되는 구조입니다.

### 구현

#### Step 1: SSM에 JWKS 저장

```bash
$ aws ssm put-parameter \
    --name "/prod/server/ISTIO_JWKS" \
    --type "SecureString" \
    --value '{"keys":[{"kty":"RSA","kid":"goti-jwt-key-1","n":"tXlfiSkDgSujDP6wUyQc...","e":"AQAB"}]}'
```

#### Step 2: Helm 템플릿 수정

`_requestauthentication.tpl`에 `jwksFromSecret` 옵션을 추가했습니다.

```yaml
# charts/goti-common/templates/_requestauthentication.tpl

{{- define "goti-common.requestauthentication" -}}
apiVersion: security.istio.io/v1
kind: RequestAuthentication
metadata:
  name: {{ include "goti-common.fullname" . }}-jwt
spec:
  selector:
    matchLabels:
      app: {{ include "goti-common.fullname" . }}
  jwtRules:
    - issuer: {{ .Values.istio.jwt.issuer }}
      {{- if .Values.istio.jwt.jwksFromSecret }}
      {{- $secret := lookup "v1" "Secret" .Release.Namespace .Values.istio.jwt.jwksFromSecret.secretName }}
      {{- if $secret }}
      jwks: {{ index $secret.data .Values.istio.jwt.jwksFromSecret.key | b64dec | quote }}
      {{- end }}
      {{- else if .Values.istio.jwt.jwks }}
      jwks: {{ .Values.istio.jwt.jwks | quote }}
      {{- else if .Values.istio.jwt.jwksUri }}
      jwksUri: {{ .Values.istio.jwt.jwksUri }}
      {{- end }}
{{- end }}
```

JWKS 소스 우선순위를 정리했습니다.

| 우선순위 | 소스 | 설명 |
|---------|------|------|
| 1 | `jwksFromSecret` | Secret에서 lookup (권장) |
| 2 | `jwks` | 인라인 하드코딩 (fallback) |
| 3 | `jwksUri` | URL 동적 조회 (STRICT mTLS에서 불가) |

`jwksFromSecret`이 있으면 Secret에서 읽고, 없으면 인라인 `jwks`를 사용하고, 그것도 없으면 `jwksUri`를 사용합니다.
이렇게 하면 점진적 전환이 가능합니다.

#### Step 3: values.yaml 전환

20개 values.yaml 파일을 전환했습니다.

```yaml
# Before (하드코딩)
istio:
  jwt:
    issuer: goti-user-service
    jwks: '{"keys":[{"kty":"RSA","kid":"goti-jwt-key-1","n":"vFL8-RL8O2K_ZTTsCD0k..."}]}'

# After (Secret lookup)
istio:
  jwt:
    issuer: goti-user-service
    jwksFromSecret:
      secretName: goti-server-secret
      key: ISTIO_JWKS
```

prod 14개, prod-gcp 5개, guardrail 1개.
총 20개 파일을 일괄 전환했습니다.

### BUT: ArgoCD에서 lookup 불가

커밋하고 push했습니다.
ArgoCD가 sync를 시작했는데... 문제가 생겼습니다.

ArgoCD는 매니페스트를 생성할 때 `helm template`을 사용합니다.
`helm template`은 **클러스터에 접근하지 않습니다**.

따라서 흐름은 `helm template → 클러스터 접근 없음 → lookup 함수가 빈 값 반환 → jwks 없는 RequestAuthentication 생성`이 됩니다.

`lookup` 함수는 실제 클러스터의 API server에 요청을 보내서 리소스를 읽어오는 함수입니다.
`helm install`이나 `helm upgrade` 때는 동작하지만, `helm template` 때는 항상 빈 값을 반환합니다.

**ArgoCD를 쓰는 한 Helm lookup은 사용할 수 없습니다.**

이건 ArgoCD의 잘 알려진 제약사항입니다.
`argocd-repo-server`에 ServiceAccount와 RBAC을 설정하면 가능하다는 글도 있지만, 보안상 바람직하지 않습니다.

### 최종 결정: inline jwks 유지

결국 실용적인 결정을 내렸습니다.

```yaml
# 최종 적용
istio:
  jwt:
    issuer: goti-user-service
    jwks: '{"keys":[{"kty":"RSA","kid":"goti-jwt-key-1","n":"tXlfiSkDgSujDP6wUyQc...","e":"AQAB"}]}'
```

**현재 키**로 업데이트한 inline JWKS를 사용합니다.
SSM에 저장한 JWKS는 향후 자동화 파이프라인용으로 보관합니다.

키 로테이션이 발생하면:
1. SSM Parameter Store 업데이트
2. 20개 values.yaml의 inline jwks 업데이트
3. ArgoCD sync

수동 작업이 남아있지만, 적어도 오래된 키를 쓰는 문제는 해결했습니다.

---

## 🔥 사이드 이펙트: Falco 알림 폭주

### kubectl exec → Falco CRITICAL

디버깅 과정에서 `kubectl exec`으로 User 서비스 Pod 내부에서 `wget`을 실행했었습니다.

```bash
$ kubectl exec goti-user-prod-xxx -c goti-server -- \
    wget -qO- http://localhost:8080/.well-known/jwks.json
```

이 명령이 **Falco 알림 폭주**를 일으켰습니다.

```
[CRITICAL] Read sensitive file /etc/passwd by process wget in container istio-proxy
[CRITICAL] Shell spawned in container istio-proxy
```

Discord 알림 채널에 CRITICAL 메시지가 연달아 쏟아졌습니다.

`kubectl exec`을 실행하면 Pod의 컨테이너에서 프로세스가 생성됩니다.
`wget`은 DNS 해석 등을 위해 `/etc/passwd`를 읽을 수 있습니다.
Falco가 이걸 **컨테이너 내부에서 민감 파일 접근**으로 탐지한 겁니다.

디버깅하려고 exec한 건데, 보안 도구가 난리를 친 것입니다.

### Falco 룰 리팩토링

이 경험을 계기로 Falco 룰을 리팩토링했습니다.

**Before (레거시 패턴)**:

```yaml
- rule: Read sensitive file untrusted
  condition: >
    open_read and sensitive_files
    and not (proc.name in (allowed_processes))
    and not (container.image.repository contains "istio")  # ← condition에 직접 예외 추가
```

condition에 `and not (...)` 를 계속 추가하는 방식은 유지보수가 힘듭니다.
예외가 10개만 넘어가도 condition이 읽기 어려워집니다.

**After (exceptions 패턴, Falco 0.28+)**:

```yaml
# goti-rules.yaml (룰 정의)
- rule: Read sensitive file untrusted
  condition: open_read and sensitive_files
  exceptions:
    - name: known_istio_proxy
      fields: [container.name, proc.name]
    - name: known_debug_tools
      fields: [container.name, proc.name]
```

```yaml
# goti-exceptions.yaml (예외 값만, append: true)
- rule: Read sensitive file untrusted
  exceptions:
    - name: known_istio_proxy
      values:
        - [istio-proxy, wget]    # 2026-04-04: JWKS 디버깅 시 필요
        - [istio-proxy, curl]    # 2026-04-04: 헬스체크 디버깅
    - name: known_debug_tools
      values:
        - [istio-proxy, cat]     # 2026-04-04: 설정 확인
```

룰과 예외를 **파일 분리**했습니다.

| 파일 | 역할 |
|------|------|
| `goti-rules.yaml` | 룰 condition + exception 슬롯 정의 |
| `goti-exceptions.yaml` | exception values만 관리 (append: true) |

이렇게 하면 예외를 추가할 때 룰 파일을 건드리지 않아도 됩니다.
각 예외에 **사유와 날짜**를 주석으로 기록하는 것도 규칙으로 정했습니다.

---

## 📋 디버깅 중 발견한 추가 이슈 6건

JWKS 문제를 디버깅하면서 연쇄적으로 다른 이슈들도 발견했습니다.

| # | 이슈 | 원인 | 수정 |
|---|------|------|------|
| 1 | RBAC 403 (global-status) | `excludePaths: []` → Istio `operation: null` validation 에러 + notPaths 중간 와일드카드 미지원 | jwtAuthorizationPolicy 비활성화 |
| 2 | pricing 404 | `my-config.env`에 dev UUID (`.seed-ids.json`) 사용, prod는 step0 SQL UUID | prod 실제 UUID로 수정 |
| 3 | TLS 에러 (ALB 직접) | ALB 인증서가 `harbor.go-ti.shop`용, ALB 호스트네임 불일치 | K6 `insecureSkipTLSVerify: true` |
| 4 | ALB 직접 404 | VirtualService가 ALB 호스트네임으로 매칭 안 됨 | CDN 경유로 smoke (ALB 직접 시 Host 헤더 필요) |
| 5 | Helm lookup 불가 | ArgoCD `helm template`에서 `lookup` 함수 클러스터 접근 불가 | inline jwks 유지, SSM 향후 자동화용 |
| 6 | seat-enter 409 | Redis에 이전 테스트 데이터 잔류 | `FLUSHDB`로 초기화 |

하나의 JWT 401을 디버깅하면서 **6개 추가 이슈**가 쏟아진 것입니다.

RBAC 403은 Istio AuthorizationPolicy의 `notPaths`가 중간 와일드카드(`/api/*/status`)를 지원하지 않아서 발생한 문제였습니다.
pricing 404는 dev와 prod의 UUID가 다른 전형적인 환경 불일치 문제였습니다.

이런 이슈들은 개별적으로는 사소하지만, CDN 경유 테스트라는 새로운 경로를 타면서 한꺼번에 드러났습니다.

---

## ✅ 최종 결과

### JWKS 업데이트 후 CDN smoke 테스트

모든 서비스의 inline JWKS를 현재 키로 업데이트하고, ArgoCD sync를 완료한 후 smoke 테스트를 실행했습니다.

```
queue_pass_rate:    100%
seat_enter_rate:    100%
payment_success:    100%
```

**CDN 경유 경로에서 모든 인증 API가 정상 동작합니다.**

### 수정 사항 요약

| 항목 | Before | After |
|------|--------|-------|
| JWKS | 오래된 public key 하드코딩 (19개 서비스) | 현재 public key로 업데이트 |
| SSM | 미사용 | `/prod/server/ISTIO_JWKS` 저장 (향후 자동화용) |
| Helm 템플릿 | `jwks` 인라인만 지원 | `jwksFromSecret` > `jwks` > `jwksUri` 우선순위 |
| values.yaml | `jwks` 하드코딩 | 현재 키로 갱신 (20개 파일) |
| Falco | condition에 예외 직접 추가 | exceptions 필드 + 파일 분리 |

### 재발 방지

| 방지책 | 상세 |
|--------|------|
| JWKS 하드코딩 주의 | 키 로테이션 시 SSM + 20개 values.yaml 동시 업데이트 |
| STRICT mTLS 환경 | `jwksUri`는 istiod가 plain HTTP로 요청하므로 불가. inline `jwks` 또는 `jwksFromSecret` 사용 |
| AuthorizationPolicy | RequestAuthentication만으로는 JWT 검증 실패를 차단하지 않음. `require-jwt` 정책 필수 |
| Falco 예외 관리 | `goti-exceptions.yaml`에 values만 추가, 룰 condition 직접 수정 금지 |

---

## 📚 핵심 포인트

### 1. RequestAuthentication ≠ 인증 강제

Istio의 `RequestAuthentication`은 **JWT를 검증하는 역할**만 합니다.
검증 실패 시 요청을 차단하려면 반드시 `AuthorizationPolicy`로 `require-jwt`를 설정해야 합니다.

이 둘이 세트라는 걸 몰랐기 때문에, JWKS가 19개 서비스 전부 틀려있었는데도 아무도 몰랐던 것입니다.
**장애가 안 나서 문제를 인지하지 못한 것이 더 위험합니다.**

### 2. STRICT mTLS 환경에서 jwksUri는 함정

`jwksUri`는 깔끔한 해결책처럼 보이지만, STRICT mTLS 환경에서는 동작하지 않습니다.
istiod의 JWKS fetcher는 plain HTTP 클라이언트이기 때문입니다.

이 제약사항은 Istio 문서에도 언급되어 있지만, 직접 겪어보기 전까지는 인지하기 어렵습니다.

### 3. ArgoCD + Helm lookup = 불가

ArgoCD는 `helm template`으로 매니페스트를 생성합니다.
`helm template`은 클러스터에 접근하지 않으므로 `lookup` 함수가 항상 빈 값을 반환합니다.

Helm의 동적 기능을 100% 활용하려면 ArgoCD 대신 `helm upgrade`를 직접 사용해야 합니다.
하지만 GitOps의 장점을 포기하는 건 더 큰 손실입니다.

### 4. 보안 강화가 숨은 버그를 드러낸다

AuthorizationPolicy를 추가하자 JWKS 불일치가 드러났습니다.
CDN 경유라는 새로운 경로를 테스트하자 6개 추가 이슈가 드러났습니다.

**보안을 강화하고, 새로운 경로를 테스트하는 것이 숨어있던 문제를 드러내는 가장 좋은 방법입니다.**
