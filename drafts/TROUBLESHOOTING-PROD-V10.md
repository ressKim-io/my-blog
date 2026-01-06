# Production 트러블슈팅 V10 - Multi-Pod JWT RSA 키 불일치 (2026-01-05)

## 개요

이 문서는 auth-service가 여러 Pod으로 스케일링될 때 발생하는 JWT 인증 실패 문제와 해결 방법을 다룹니다.

---

## 1. 문제 현상

### 1.1 증상

- 로그인 후 사이트 이동 중 **간헐적으로** 로그인 페이지로 리다이렉트됨
- 새로고침하면 다시 로그인이 됨 (50% 확률)
- 토큰 만료 시간(30분) 전에도 발생
- 단일 Pod일 때는 문제 없음

### 1.2 에러 패턴

```
# Go 서비스 로그 (user-service, board-service 등)
JWT validation failed: signature verification failed

# 또는 Istio가 검증할 때
Jwt verification fails
```

### 1.3 재현 조건

```bash
# auth-service Pod 수 확인
$ kubectl get pods -n wealist-prod | grep auth
auth-service-xxx-abc   2/2   Running   0   10m
auth-service-xxx-def   2/2   Running   0   10m   # 2개 이상
```

---

## 2. 근본 원인: Pod별 RSA 키 생성

### 2.1 문제 코드

`services/auth-service/src/main/java/OrangeCloud/AuthService/config/RsaKeyConfig.java`:

```java
@Bean
public KeyPair rsaKeyPair() throws Exception {
    // 환경변수에서 키 로드 시도
    if (publicKeyPem != null && !publicKeyPem.isEmpty()
        && privateKeyPem != null && !privateKeyPem.isEmpty()) {
        logger.info("Loading RSA key pair from environment variables");
        keyPair = loadKeyPairFromPem(publicKeyPem, privateKeyPem);
    } else {
        // 개발용: 런타임에 키 생성 ⚠️ 이게 문제!
        logger.warn("RSA keys not configured, generating new key pair (development only!)");
        keyPair = generateKeyPair();
    }
    return keyPair;
}
```

### 2.2 JWT 서명/검증 흐름

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          JWT 서명/검증 불일치                                 │
└─────────────────────────────────────────────────────────────────────────────┘

사용자 로그인 요청
        │
        ▼
┌──────────────────┐     JWT 발급 (Private Key A로 서명)
│  auth-service    │─────────────────────────────────────────┐
│  Pod A           │  KeyPair A (시작 시 생성)                │
│  (Private Key A) │                                         │
└──────────────────┘                                         │
                                                             ▼
                                                    사용자 브라우저
                                                    (JWT 저장)
                                                             │
                                                             ▼
┌──────────────────┐     API 요청 with JWT
│  auth-service    │◀────────────────────────────────────────┘
│  Pod B           │
│  (Private Key B) │  ❌ Public Key B로 검증 → 실패!
└──────────────────┘     (Public Key A가 아님)
```

### 2.3 왜 개발환경에서는 문제가 없었나?

| 환경 | Pod 수 | RSA 키 | 결과 |
|------|--------|--------|------|
| Docker Compose | 1개 | 단일 키 생성 | ✅ 항상 동일 |
| Kind (localhost) | 1개 | 단일 키 생성 | ✅ 항상 동일 |
| Production (HPA) | 2개+ | **Pod마다 다름** | ❌ 불일치 |

---

## 3. 해결 방법: RSA 키 공유 (AWS Secrets Manager)

### 3.1 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          해결: 공유 RSA 키                                   │
└─────────────────────────────────────────────────────────────────────────────┘

┌───────────────────────┐
│  AWS Secrets Manager  │
│  wealist/prod/app/    │
│  jwt-rsa-keys         │──────────────────────┐
│  {                    │                      │
│    public_key: "...", │                      │
│    private_key: "..." │                      │
│  }                    │                      │
└───────────────────────┘                      │
                                               ▼
                                  ┌────────────────────────┐
                                  │   ExternalSecret       │
                                  │   wealist-shared-secret│
                                  └────────────────────────┘
                                               │
                          ┌────────────────────┼────────────────────┐
                          ▼                    ▼                    ▼
                 ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
                 │  auth-service   │  │  auth-service   │  │  auth-service   │
                 │  Pod A          │  │  Pod B          │  │  Pod C          │
                 │  동일 키 사용 ✅ │  │  동일 키 사용 ✅ │  │  동일 키 사용 ✅ │
                 └─────────────────┘  └─────────────────┘  └─────────────────┘
```

### 3.2 구현 단계

#### Step 1: RSA 키 쌍 생성

```bash
# RSA 2048-bit 키 쌍 생성
openssl genpkey -algorithm RSA -out /tmp/private_key.pem -pkeyopt rsa_keygen_bits:2048
openssl rsa -pubout -in /tmp/private_key.pem -out /tmp/public_key.pem
```

#### Step 2: Terraform에 Secret 정의 추가

`terraform/prod/foundation/secrets.tf`:

```hcl
# JWT RSA Key Pair (수동 입력)
resource "aws_secretsmanager_secret" "jwt_rsa_keys" {
  name       = "wealist/prod/app/jwt-rsa-keys"
  kms_key_id = module.kms.key_arn

  tags = merge(
    local.common_tags,
    { Purpose = "JWT RS256 Token Signing" }
  )
}

resource "aws_secretsmanager_secret_version" "jwt_rsa_keys" {
  secret_id = aws_secretsmanager_secret.jwt_rsa_keys.id
  secret_string = jsonencode({
    public_key  = "PLACEHOLDER-UPDATE-ME"
    private_key = "PLACEHOLDER-UPDATE-ME"
  })

  lifecycle {
    ignore_changes = [secret_string]  # 수동 업데이트 후 덮어쓰지 않음
  }
}
```

#### Step 3: Terraform Apply

```bash
cd terraform/prod/foundation
terraform plan -out=tfplan
terraform apply tfplan
```

#### Step 4: 실제 RSA 키 저장

```bash
SECRET_STRING=$(jq -n \
  --arg pub "$(cat /tmp/public_key.pem)" \
  --arg priv "$(cat /tmp/private_key.pem)" \
  '{"public_key": $pub, "private_key": $priv}')

aws secretsmanager put-secret-value \
  --secret-id wealist/prod/app/jwt-rsa-keys \
  --secret-string "$SECRET_STRING"
```

#### Step 5: ExternalSecret 업데이트

`k8s/argocd/base/external-secrets/external-secret-shared.yaml`:

```yaml
data:
  # ... 기존 항목들 ...

  # JWT RSA Key Pair (Multi-pod 환경 필수)
  - secretKey: JWT_RSA_PUBLIC_KEY
    remoteRef:
      key: "wealist/prod/app/jwt-rsa-keys"
      property: public_key

  - secretKey: JWT_RSA_PRIVATE_KEY
    remoteRef:
      key: "wealist/prod/app/jwt-rsa-keys"
      property: private_key
```

#### Step 6: Git Push & ArgoCD Sync

```bash
git add .
git commit -m "fix(auth): add shared RSA key pair for multi-pod JWT consistency"
git push origin main
# PR: main → prod → k8s-deploy-prod
```

#### Step 7: ExternalSecret 강제 새로고침 & Pod 재시작

```bash
# ExternalSecret 강제 새로고침
kubectl annotate externalsecret wealist-shared-secret -n wealist-prod \
  force-sync=$(date +%s) --overwrite

# Secret 동기화 확인
kubectl get secret wealist-shared-secret -n wealist-prod \
  -o jsonpath='{.data.JWT_RSA_PUBLIC_KEY}' | base64 -d | head -2

# auth-service 재시작
kubectl rollout restart deployment/auth-service -n wealist-prod
```

---

## 4. 검증

### 4.1 로그 확인

```bash
# 새 Pod 로그에서 RSA 키 로딩 확인
kubectl logs deploy/auth-service -n wealist-prod --tail=100 | grep -i rsa

# 기대 출력:
# Loading RSA key pair from environment variables

# 이전 (문제):
# RSA keys not configured, generating new key pair (development only!)
```

### 4.2 JWT 검증 테스트

```bash
# 여러 번 로그인/API 호출 테스트
for i in {1..10}; do
  curl -s https://api.wealist.co.kr/api/svc/auth/actuator/health | jq .status
done
# 모두 "UP" 반환되어야 함
```

### 4.3 JWKS 엔드포인트 확인

```bash
# 두 Pod에서 동일한 공개키 반환 확인
curl -s https://api.wealist.co.kr/api/svc/auth/actuator/jwks | jq .keys[0].n
# 항상 동일한 값이어야 함
```

---

## 5. 추가 이슈: Kyverno 정책 차단

### 5.1 증상

Pod 재시작 시 새 ReplicaSet 생성 실패:

```bash
$ kubectl describe deployment auth-service -n wealist-prod
Events:
  Warning  ReplicaSetCreateError  10m  deployment-controller
    Failed to create new replica set: admission webhook "validate.kyverno.svc-fail" denied the request:

    require-prod-stage-label:
      autogen-check-stage-label: 'validation error: 배포 실패: stage: prod 라벨이 없는 리소스는 배포할 수 없습니다.'
```

### 5.2 원인

Kyverno `ClusterPolicy`가 `wealist-prod` 네임스페이스의 모든 Pod에 `stage: prod` 라벨 필수 요구.

### 5.3 해결

`k8s/helm/charts/auth-service/templates/deployment.yaml`:

```yaml
spec:
  template:
    metadata:
      labels:
        {{- include "wealist-common.selectorLabels" . | nindent 8 }}
        version: stable
        stage: {{ .Values.stage | default "prod" }}  # 추가
```

---

## 6. Go 서비스 영향

### Q: Go 서비스도 동일한 문제가 있나요?

**A: 아니요.** Go 서비스는 JWT를 **서명하지 않고 검증만** 합니다.

| 동작 | auth-service (Spring) | Go 서비스 |
|------|----------------------|-----------|
| JWT 발급 (서명) | ✅ Private Key 사용 | ❌ 안 함 |
| JWT 검증 | ✅ Public Key 사용 | ✅ JWKS or Istio |

Go 서비스는 다음 방식으로 JWT 검증:

1. **ISTIO_JWT_MODE=true**: Istio RequestAuthentication이 검증 → Go는 파싱만
2. **ISTIO_JWT_MODE=false**: auth-service의 `/actuator/jwks`에서 공개키 조회

RSA 키를 공유하면 `/actuator/jwks`가 동일한 공개키를 반환하므로 Go 서비스도 자동 해결됩니다.

---

## 7. 관련 파일

| 파일 | 역할 |
|------|------|
| `terraform/prod/foundation/secrets.tf` | RSA 키 Secret 정의 |
| `k8s/argocd/base/external-secrets/external-secret-shared.yaml` | K8s Secret 동기화 |
| `services/auth-service/.../RsaKeyConfig.java` | RSA 키 로딩 로직 |
| `k8s/helm/charts/auth-service/templates/deployment.yaml` | Pod 템플릿 |

---

## 8. 예방 조치

### 8.1 개발 환경에서도 RSA 키 설정

Docker Compose에서도 고정 RSA 키 사용 권장:

```yaml
# docker/compose/.env
JWT_RSA_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n..."
JWT_RSA_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
```

### 8.2 로그 모니터링

```bash
# 경고 로그 감지 시 알림 설정
"RSA keys not configured, generating new key pair"
```

이 로그가 Production에서 보이면 즉시 조치 필요.

---

## 9. 요약

| 항목 | 내용 |
|------|------|
| **문제** | Multi-pod auth-service에서 각 Pod이 다른 RSA 키 생성 |
| **증상** | 간헐적 JWT 검증 실패, 로그인 풀림 |
| **원인** | `jwt.rsa.public-key`, `jwt.rsa.private-key` 환경변수 미설정 |
| **해결** | AWS Secrets Manager + ExternalSecret으로 모든 Pod에 동일 키 주입 |
| **검증** | 로그에서 "Loading RSA key pair from environment variables" 확인 |
