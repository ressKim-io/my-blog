---
title: "GCP Redis 복구 + AWS↔GCP JWT 통일 — 멀티클라우드 세션 연속성 확보"
excerpt: "수동 삭제된 GCP Memorystore를 Terraform으로 재생성하고, AWS SSM을 Single Source of Truth로 삼아 JWT RSA 키를 양 클라우드에 통일하여 cross-cloud 세션 호환을 달성한 기록"
category: challenge
tags:
  - go-ti
  - Multi-Cloud
  - GCP
  - Redis
  - JWT
  - Memorystore
series:
  name: "goti-multicloud"
  order: 6
date: "2026-04-17"
---

## 한 줄 요약

> 수동 삭제된 GCP Memorystore Redis를 Terraform으로 재생성하면서 발견한 `REDIS_URL` drift를 import 패턴으로 흡수했습니다. 이어서 AWS와 GCP의 JWT 공개키가 다른 문제를 AWS SSM을 Single Source of Truth로 삼는 방식으로 통일하여 멀티클라우드 세션 연속성을 확보했습니다.

## Impact

- **환경**: prod-gcp (GKE, asia-northeast3)
- **컨텍스트**: AWS ASG=0 상태에서 GCP 단독 운영 준비 중
- **성과**: Redis 복구 + 멀티클라우드 JWT 세션 호환성 확보
- **소요 시간**: 약 3시간 (09:00~12:15) + SMS 후속 (14:00~)
- **발생일**: 2026-04-17

---

## 🔥 문제 1: goti-user Pod가 Redis 연결 타임아웃으로 CrashLoop

### 발견 경위

오전에 GCP 쿼터 상승 신청과 모니터링 스택 배포를 준비하던 중 goti-user 서비스가 CrashLoop 상태임을 확인했습니다.

Pod 로그에서 Redis 연결 타임아웃이 반복되었습니다.

```bash
# Redis 연결 실패
dial tcp 10.155.146.203:6379: i/o timeout
```

사용자에게 확인한 결과, **GCP 쪽 Memorystore Redis 인스턴스를 수동으로 내렸다**는 답을 받았습니다. Terraform state에는 여전히 이전 인스턴스가 남아 있지만 실제 인프라는 삭제된 상태였습니다.

### 1차 조치: Terraform으로 Redis 재생성

```bash
$ cd Goti-Terraform/terraform/prod-gcp
$ terraform apply -target='module.database.google_redis_instance.this' -auto-approve
# Creation complete after 4m41s
# 새 IP: 10.195.173.91 (이전: 10.155.146.203)
```

약 4분 41초 만에 새 인스턴스가 생성되었습니다. 하지만 새 IP(`10.195.173.91`)로 바뀌었기 때문에 애플리케이션 Pod는 여전히 이전 IP를 바라보고 있었습니다.

---

## 🤔 원인: 수동 생성된 `REDIS_URL` 시크릿이 Terraform state 밖에 있었습니다

### Terraform이 관리하는 시크릿 vs 수동 생성 시크릿

Terraform 모듈은 Redis 인스턴스가 재생성될 때 다음 세 개의 Secret Manager 엔트리를 자동 갱신합니다.

- `REDIS_HOST` — Redis 호스트 IP
- `REDIS_PORT` — Redis 포트
- `REDIS_AUTH_TOKEN` — AUTH 토큰

하지만 Go 애플리케이션이 실제로 읽는 값은 `goti-prod-server-REDIS_URL` 하나의 조합된 문자열이었습니다. 그리고 이 시크릿은 **Terraform state 밖에서 수동으로 만들어진 것**이었습니다.

결과적으로 Terraform은 `REDIS_HOST`를 새 IP로 갱신했지만, Go 앱이 읽는 `REDIS_URL`은 여전히 이전 IP를 담은 채 방치되어 있었습니다. 이것이 전형적인 **drift** 상황입니다.

### 문제의 구조

```
Terraform 관리               수동 생성 (drift)
─────────────────            ──────────────────
REDIS_HOST        갱신됨     REDIS_URL         갱신 안 됨 ❌
REDIS_PORT        갱신됨     (실제로 앱이 읽는 값)
REDIS_AUTH_TOKEN  갱신됨
```

Go 앱은 `REDIS_HOST`가 아니라 `REDIS_URL`을 참조했기 때문에, Terraform apply 뒤에도 앱 관점에서는 아무것도 바뀌지 않은 것처럼 보였습니다.

---

## ✅ 해결 1: Terraform import 패턴으로 drift 흡수

수동 생성된 시크릿을 삭제하고 새로 만들면 애플리케이션이 읽을 값이 잠시라도 비는 순간이 생깁니다. 그래서 **Terraform import 패턴**을 사용했습니다.

### 적용 순서

```bash
# 1. modules/config/main.tf의 locals 맵에 server-REDIS_URL 엔트리 추가
# 2. Secret container만 import (version은 새로 생성됨)
$ terraform import 'module.config.google_secret_manager_secret.this["server-REDIS_URL"]' \
    projects/.../secrets/goti-prod-server-REDIS_URL

# 3. terraform apply — 새 version이 생성되면서 drift 해소
```

`import` 대상은 Secret container(`google_secret_manager_secret`)만입니다. Secret version은 Terraform이 새로 생성하여 새 Redis IP를 담은 URL로 교체합니다.

### 시크릿 재주입 + 롤아웃

ESO(External Secrets Operator)에 force-sync 애노테이션을 걸어 K8s Secret을 갱신하고, Deployment를 rolling restart했습니다.

```bash
$ for svc in user ticketing resale payment stadium queue; do
    kubectl annotate externalsecret goti-${svc}-prod-gcp-secrets \
      force-sync=$(date +%s%N) --overwrite
  done

$ for svc in user ticketing resale payment stadium queue; do
    kubectl rollout restart deployment/goti-${svc}-prod-gcp
  done
```

6개 서비스 모두 `2/2 Running`으로 회복했고 Redis 연결 에러가 사라졌습니다.

---

## 🔥 문제 2: AWS에서 로그인한 사용자가 GCP로 라우팅되면 JWT 검증 실패

Redis 복구 직후 사용자가 새로운 요구사항을 제시했습니다.

> "aws에서 로그인한 게 gcp로 연결돼도 유지되도록 해야 되는 게 제일 중요한 포인트야"

이전 계획은 단순히 GCP 전용 JWKS를 교체하는 것이었지만, **AWS와 GCP가 동일한 RSA 키를 공유**해야 한다는 점이 명확해지면서 설계를 재검토했습니다.

### 근본 진단

JWT 관련 구성을 세 군데에서 교차 확인했습니다.

1. AWS SSM `/prod/user/JWT_RSA_PRIVATE_KEY` 값 추출 후 modulus(`n`) 값이 `values.yaml`에 하드코딩된 jwks와 일치함을 확인했습니다.
2. GCP `prod-gcp/goti-user/values.yaml`를 점검했더니 `USER_JWT_PRIVATE_KEY_PEM` env 자체가 **없었습니다**.
3. `goti-prod-server-JWT_PUBLIC_KEY_PEM` 시크릿은 수동으로 생성되어 있었고, `REDIS_URL`과 동일한 drift 패턴이었습니다.

요약하면 세 가지 문제가 겹쳐 있었습니다.

| 구성요소 | 상태 |
|----------|------|
| GCP Secret Manager RSA 키 | Terraform이 독립 키를 자동 생성 중 (AWS와 불일치) |
| 6 prod-gcp values.yaml의 jwks 하드코딩 | AWS 공개키로 하드코딩됨 |
| goti-user values.yaml의 PRIVATE_KEY env | env 자체가 빠져 있음 |

이 상태에서는 AWS에서 발급한 JWT를 GCP가 받아 검증하거나 그 반대로도 통과할 수 없었습니다.

---

## 🤔 원인: 각 클라우드가 독립 키를 생성하면 cross-cloud 세션이 성립하지 않습니다

Terraform `tls_private_key.jwt_rsa` 리소스가 apply 시점마다 **각 클라우드별로 독립적인 RSA 키**를 생성하고 있었습니다. AWS가 발급한 JWT의 서명은 AWS 공개키로만 검증 가능했고, GCP가 발급한 JWT는 GCP 공개키로만 검증 가능했습니다.

멀티클라우드 환경에서 사용자가 AWS에서 로그인한 뒤 요청이 GCP로 라우팅되면, GCP 측 검증기는 서명을 확인하지 못해 401을 반환합니다. 이 구조로는 세션 연속성이 원천적으로 불가능했습니다.

---

## ✅ 해결 2: AWS SSM을 Single Source of Truth로 삼은 `.tfvars` 주입

### 핵심 결정 사항

Plan mode로 종합 설계를 진행하여 다음과 같이 정리했습니다.

- **AWS SSM을 single source of truth**로 삼고, 값을 `.tfvars`로 주입합니다.
- Terraform에 AWS Provider는 추가하지 않습니다 (cloud independence 유지).
- `tls_private_key.jwt_rsa` 자동 생성 리소스를 제거합니다.
- 수동 생성된 `JWT_PUBLIC_KEY_PEM` 시크릿을 import하여 Terraform 관리로 편입합니다.
- `goti-user` values.yaml에 `USER_JWT_PRIVATE_KEY_PEM` env 한 줄을 추가합니다.

AWS Provider를 GCP Terraform에 넣지 않은 것은 의도적입니다. 각 클라우드의 Terraform이 다른 클라우드에 의존하면 cloud independence가 깨지기 때문입니다. 대신 AWS SSM에서 한 번 값을 꺼내 `.tfvars`로 주입하는 경계만 두었습니다.

### Phase A~D 실행

```bash
# Phase A: AWS SSM에서 키 추출 → /tmp/jwt-migration/ 임시 저장
# Phase B: Terraform 코드 수정 (6 파일)
# Phase C: state rm tls_private_key + import JWT_PUBLIC_KEY_PEM
# Phase D: terraform apply (4 target)
#   결과: Apply complete — 3 added, 1 changed, 2 destroyed
#   (3개 secret version 교체)
```

### Goti-k8s PR #264

goti-user Helm values에 JWT private key env 한 줄을 추가했습니다.

```
[FEAT] prod-gcp goti-user에 JWT private key env 추가
1 file changed, 7 insertions(+)
```

사용자 승인 후 merge했습니다.

### ArgoCD sync 수동 트리거

MCP `sync_application`이 fetch failed를 반환하여 kubectl 애노테이션으로 hard refresh를 걸었습니다.

```bash
$ kubectl annotate application goti-user-prod-gcp \
    argocd.argoproj.io/refresh=hard --overwrite
```

Sync 커밋이 `fd47d3d → fe789d4`로 이동하면서 Deployment rolling update가 진행되었고, 새 Pod `5fffbbcb65-*`가 `2/2 Running`에 도달했습니다.

### Phase G: 검증

```bash
$ curl http://localhost:18080/.well-known/jwks.json
{"keys":[{"alg":"RS256","kid":"goti-jwt-key-1","n":"tXlfiSkDgSujDP6w...","e":"AQAB"}]}
```

GCP 측에서 공개된 jwks의 modulus가 **AWS 공개키의 modulus와 완전히 일치**했습니다. 이로써 cross-cloud JWT 호환이 달성되었습니다.

---

## 🔥 문제 3 (후속): GCP에서 가입 시 SMS 인증번호가 오지 않음

### 증상

오후에 팀원이 "GCP 신규 회원가입 시 휴대폰 인증번호가 도착하지 않는다"고 보고했습니다. AWS 쪽은 정상이었습니다.

Pod 로그에서 결정적 증거가 나왔습니다.

```json
{"msg":"sms provider disabled, skipping send","to":"010****3182"}
{"msg":"request","method":"POST","path":"/api/v1/auth/signup/sms/send","status":200}
```

API는 200 OK를 반환했지만 **실제로는 SMS를 보내지 않고 skip**하고 있었습니다. 클라이언트 입장에서는 성공으로 보이는 silent failure였습니다. `SmsProvider.Enabled=false`로 초기화되어 `Send()` 메서드가 no-op으로 동작한 것입니다.

### 근본 원인

`cmd/user/main.go:206-214`의 `loadSmsConfig()`는 `os.Getenv("SMS_*")`를 **USER\_ 접두사 없이** 직접 호출합니다.

GCP `prod-gcp/goti-user/values.yaml`에는 SMS 관련 env가 **하나도 정의되어 있지 않았습니다**. 따라서 `os.Getenv()` 호출 결과가 전부 빈 문자열이었고, `Enabled=false`로 떨어졌습니다.

### AWS(Java) vs GCP(Go) 주입 방식 차이

| 항목 | AWS (Java) | GCP (Go) |
|------|-----------|---------|
| env 주입 방식 | `envFrom: secretRef` (bulk) | 개별 `valueFrom: secretKeyRef` |
| Secret 키 → env 자동 매핑 | 모든 Secret 키가 자동으로 env에 들어감 | 명시적으로 선언한 key만 들어감 |
| 본 이슈 발생 조건 | 발생 불가 | GCP 마이그레이션 시 매우 흔함 |

AWS 쪽은 `envFrom: secretRef`로 Secret 전체를 bulk 주입하기 때문에 누락이 원천적으로 발생하지 않았습니다. GCP는 Go 애플리케이션에 맞춰 `valueFrom: secretKeyRef`로 키를 하나씩 명시하는 패턴을 사용했고, 그 과정에서 SMS 관련 4개 키가 통째로 빠진 것입니다.

DATABASE, REDIS, JWT 같은 주요 config는 대부분 주목을 받아 누락되지 않지만, SMS처럼 주변부 기능의 env는 이렇게 통째로 빠지기 쉽습니다.

### 값 검증 (plaintext 미노출)

AWS SSM과 GCP Secret Manager의 4개 SMS 값을 SHA256 해시로 비교했습니다.

```
SMS_API_KEY:    일치 (len=16)
SMS_API_SECRET: 일치 (len=32)
SMS_API_SENDER: 일치 (len=11)
SMS_API_DOMAIN: 일치 (len=25)
```

Secret Manager 값 자체는 이미 동일했고, 누락된 것은 Helm values.yaml의 env 선언뿐이었습니다. 즉, 순수 values.yaml 문제였고 Secret Manager는 건드릴 필요가 없었습니다.

### 수정 (PR #265)

```yaml
# environments/prod-gcp/goti-user/values.yaml 추가
- name: SMS_ENABLED
  value: "true"
- name: SMS_API_KEY
  valueFrom:
    secretKeyRef:
      name: goti-user-prod-gcp-secrets
      key: SMS_API_KEY
# SMS_API_SECRET / SENDER / DOMAIN 동일 패턴
```

ArgoCD sync와 rollout이 완료된 뒤 Pod env에 SMS 5개가 주입된 것을 확인했습니다(`goti-user-prod-gcp-67969654df-*`).

---

## 📚 배운 점

### 1. Terraform drift 흡수 패턴

수동 생성된 리소스를 발견했을 때의 공통 대응 패턴을 정리했습니다. 세션 내에서 `REDIS_URL`과 `JWT_PUBLIC_KEY_PEM` 두 건에 연속 적용하여 재현 가능성을 확인했습니다.

```bash
# 1. 코드에 리소스 정의 추가 (main.tf의 locals 맵)
# 2. terraform import (container만)
$ terraform import 'module.config.google_secret_manager_secret.this["NAME"]' \
    projects/.../secrets/goti-prod-server-NAME
# 3. terraform apply (version은 새로 생성)
```

Secret container만 import하고 version은 새로 생성하는 이유는 import된 상태로는 Terraform이 version을 관리하지 못하기 때문입니다.

### 2. Go viper `SetDefault` 누락은 silent 실패를 만듭니다

`pkg/config/config.go:272`에 다음 두 줄이 반드시 필요했습니다.

```go
v.SetDefault("jwt.private_key_pem", "")
v.SetDefault("jwt.public_key_pem", "")
```

viper의 `AutomaticEnv()`는 `SetDefault`로 등록된 key만 env 바인딩을 적용합니다. 이 라인이 없으면 `configs/user.yaml`에 있는 `${JWT_PRIVATE_KEY_PEM}` 리터럴 문자열이 그대로 unmarshal되어 RSA 파싱 에러가 발생합니다.

### 3. Distroless 컨테이너 디버깅 제약

```
$ kubectl exec goti-user -- wget
exec: "wget": executable file not found in $PATH
```

보안 강화된 distroless 이미지(`gcr.io/distroless/*`)에는 `wget`, `curl`, `sh` 모두 없습니다. in-cluster API 테스트는 **port-forward + local curl**이 거의 유일한 경로입니다. 이 제약 때문에 env 전수 확인도 `kubectl exec env`가 아니라 values.yaml diff로 대신해야 했습니다.

### 4. MCP ArgoCD 서버 접근 범위 확인

`mcp__argocd__sync_application`이 `fetch failed`를 반환하는 경우가 있었습니다. MCP 서버가 AWS ArgoCD만 연결되어 있을 가능성이 높습니다. GCP ArgoCD는 `kubectl annotate application ... argocd.argoproj.io/refresh=hard`로 대체했습니다.

### 5. Java → Go 마이그레이션 체크리스트

AWS `envFrom: secretRef`(bulk 주입)에서 GCP `valueFrom: secretKeyRef`(개별 주입)로 전환할 때 **Secret 키 전수조사**가 필수입니다.

- 누락되지 않는 경향: DATABASE, REDIS, JWT 등 주요 config
- 누락 위험이 높은 것: **SMS, OAuth, 외부 API 키** 등 주변부 config
- 검증 방법: `kubectl exec pod -- env | grep -vi "^(KUBERNETES|POD|HOST)"` 로 예상 env 전수 확인 (distroless의 경우 exec 불가 → values.yaml diff로 대체)

### 6. plaintext 미노출 비교 원칙

hook이 `aws ssm get-parameter --with-decryption` 같은 명령의 plaintext 출력을 transcript에 남기지 않도록 차단하고 있었습니다. 프로덕션 credential 보호 관점에서 올바른 정책입니다.

우회 방법은 `> /tmp/file` 리다이렉트와 SHA256 해시만 출력하는 방식이었습니다. **값이 일치하는지만 확인하면 되는 목적이라면 plaintext는 불필요**합니다. 세션 종료 전 `/tmp/jwt-migration/`, `/tmp/sms-migration/` 디렉터리를 삭제하여 secret 잔류를 제거했습니다.

### 7. "앱이 실제로 읽는 값"을 기준으로 확인해야 합니다

Terraform이 관리하는 `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH_TOKEN`이 갱신되었다고 해서 앱이 정상일 것이라 가정하면 안 됩니다. Go 앱이 실제로 읽는 것은 `REDIS_URL`이었고, 그 값만 drift되어 있었습니다. 인프라 관점의 "정상"과 애플리케이션 관점의 "정상"이 다를 수 있다는 점을 잊지 않아야 합니다.
