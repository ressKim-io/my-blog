---
title: "Multi-Pod 환경에서 JWT 인증이 50% 확률로 실패한다면"
excerpt: "auth-service가 여러 Pod으로 스케일링될 때 발생하는 JWT 서명/검증 불일치 문제와 해결 방법"
category: istio
tags:
  - EKS
  - JWT
  - RSA
  - Troubleshooting
  - ExternalSecrets
  - AWS Secrets Manager
series:
  name: "eks-security"
  order: 1
date: '2026-01-05'
---

## 한 줄 요약

> 로그인 후 페이지를 이동하면 50% 확률로 로그인이 풀립니다. 새로고침하면 다시 로그인됨. 원인은 각 Pod이 서로 다른 RSA 키를 생성하고 있었던 것.

## Impact

- **영향 범위**: 모든 인증 API
- **증상 빈도**: 50% 확률로 발생
- **소요 시간**: 약 2시간
- **발생일**: 2026-01-05

---

## 🔥 증상: 간헐적 로그인 풀림

### 사용자 리포트

```
"로그인하고 다른 페이지로 이동하면 갑자기 로그인 페이지로 튕깁니다"
"새로고침하면 다시 로그인되어 있습니다"
"랜덤으로 발생해서 재현이 안 됩니다"
```

### 로그 확인

Go 서비스들의 로그를 확인해봤습니다:

```bash
$ kubectl logs deploy/user-service -n wealist-prod | grep -i jwt

JWT validation failed: signature verification failed
JWT validation failed: signature verification failed
```

Istio RequestAuthentication을 통한 검증에서도 동일한 에러:

```
Jwt verification fails
```

### 재현 조건

```bash
$ kubectl get pods -n wealist-prod | grep auth
auth-service-xxx-abc   2/2   Running   0   10m
auth-service-xxx-def   2/2   Running   0   10m
```

auth-service Pod이 2개 이상일 때만 발생했습니다. 단일 Pod으로 스케일 다운하면 문제가 사라졌습니다.

---

## 🤔 원인 분석: Pod별 RSA 키 생성

### 문제의 코드

auth-service의 RSA 키 설정 코드를 확인해봤습니다:

```java
// RsaKeyConfig.java
@Bean
public KeyPair rsaKeyPair() throws Exception {
    if (publicKeyPem != null && !publicKeyPem.isEmpty()
        && privateKeyPem != null && !privateKeyPem.isEmpty()) {
        logger.info("Loading RSA key pair from environment variables");
        keyPair = loadKeyPairFromPem(publicKeyPem, privateKeyPem);
    } else {
        // 개발용 fallback - 이게 문제!
        logger.warn("RSA keys not configured, generating new key pair (development only!)");
        keyPair = generateKeyPair();
    }
    return keyPair;
}
```

환경변수에 RSA 키가 없으면 **런타임에 새로운 키 쌍을 생성**하는 fallback 로직이 있었습니다.

### 무슨 일이 일어났나

각 Pod이 시작할 때마다 서로 다른 RSA 키 쌍을 생성했습니다.

| Pod | Private Key | Public Key |
|-----|-------------|------------|
| Pod A | Key A (Private) | Key A (Public) |
| Pod B | Key B (Private) | Key B (Public) |

### JWT 서명/검증 흐름

문제의 흐름을 따라가보겠습니다:

1. 사용자가 로그인 요청을 보냅니다
2. LoadBalancer가 **Pod A**로 라우팅합니다
3. Pod A가 **Private Key A**로 JWT를 서명합니다
4. 사용자 브라우저에 JWT가 저장됩니다
5. 사용자가 API 요청을 보냅니다
6. LoadBalancer가 **Pod B**로 라우팅합니다
7. Pod B가 **Public Key B**로 검증을 시도합니다
8. **서명 불일치로 검증 실패!**

![JWT RSA 키 Pod별 불일치로 검증 실패](/diagrams/eks-security-jwt-rsa-mismatch-1.svg)

50% 확률로 실패하는 이유가 여기 있었습니다. 같은 Pod으로 요청이 가면 성공, 다른 Pod으로 가면 실패.

### 왜 개발 환경에서는 문제가 없었나

| 환경 | Pod 수 | RSA 키 | 결과 |
|------|--------|--------|------|
| Docker Compose | 1개 | 단일 키 생성 | 항상 동일 |
| Kind (localhost) | 1개 | 단일 키 생성 | 항상 동일 |
| **Production (HPA)** | **2개+** | **Pod마다 다름** | **불일치** |

개발 환경에서는 항상 단일 Pod이었기 때문에 문제가 드러나지 않았습니다.

---

## ✅ 해결: RSA 키를 AWS Secrets Manager로 공유

### 아키텍처

모든 Pod이 동일한 RSA 키를 사용하도록 변경했습니다:

![RSA 키를 AWS Secrets Manager로 공유하는 해결 구조](/diagrams/eks-security-jwt-rsa-mismatch-2.svg)

### Step 1: RSA 키 쌍 생성

```bash
# RSA 2048-bit 키 쌍 생성
openssl genpkey -algorithm RSA -out /tmp/private_key.pem -pkeyopt rsa_keygen_bits:2048
openssl rsa -pubout -in /tmp/private_key.pem -out /tmp/public_key.pem
```

### Step 2: Terraform에 Secret 정의

```hcl
# terraform/prod/foundation/secrets.tf
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

### Step 3: AWS에 실제 키 저장

```bash
SECRET_STRING=$(jq -n \
  --arg pub "$(cat /tmp/public_key.pem)" \
  --arg priv "$(cat /tmp/private_key.pem)" \
  '{"public_key": $pub, "private_key": $priv}')

aws secretsmanager put-secret-value \
  --secret-id wealist/prod/app/jwt-rsa-keys \
  --secret-string "$SECRET_STRING"
```

### Step 4: ExternalSecret 업데이트

```yaml
# k8s/argocd/base/external-secrets/external-secret-shared.yaml
data:
  # 기존 항목들...

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

### Step 5: 배포 및 검증

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

## 검증

### 로그 확인

```bash
$ kubectl logs deploy/auth-service -n wealist-prod | grep -i rsa

# 수정 후 (정상)
Loading RSA key pair from environment variables

# 수정 전 (문제)
RSA keys not configured, generating new key pair (development only!)
```

### JWT 검증 테스트

```bash
# 여러 번 API 호출 테스트
for i in {1..10}; do
  curl -s https://api.wealist.co.kr/api/svc/auth/actuator/health | jq .status
done
# 모두 "UP" 반환
```

### JWKS 엔드포인트 확인

```bash
# 두 Pod에서 동일한 공개키 반환 확인
curl -s https://api.wealist.co.kr/api/svc/auth/actuator/jwks | jq .keys[0].n
# 항상 동일한 값
```

---

## 🔥 추가 이슈: Kyverno 정책 차단

Pod 재시작 시 새로운 문제가 발생했습니다:

```bash
$ kubectl describe deployment auth-service -n wealist-prod
Events:
  Warning  ReplicaSetCreateError  10m  deployment-controller
    Failed to create new replica set: admission webhook "validate.kyverno.svc-fail" denied the request:
    require-prod-stage-label: 'validation error: stage: prod 라벨이 없는 리소스는 배포할 수 없습니다.'
```

Kyverno ClusterPolicy가 `stage: prod` 라벨을 필수로 요구하고 있었습니다.

### 해결

Helm 템플릿에 stage 라벨 추가:

```yaml
# deployment.yaml
spec:
  template:
    metadata:
      labels:
        {{- include "wealist-common.selectorLabels" . | nindent 8 }}
        version: stable
        stage: {{ .Values.stage | default "prod" }}  # 추가
```

---

## 📚 Go 서비스는 영향 없나?

Go 서비스는 JWT를 **서명하지 않고 검증만** 합니다.

| 동작 | auth-service (Spring) | Go 서비스 |
|------|----------------------|-----------|
| JWT 발급 (서명) | Private Key 사용 | 안 함 |
| JWT 검증 | Public Key 사용 | JWKS or Istio |

Go 서비스는 다음 방식으로 JWT를 검증합니다:

1. **ISTIO_JWT_MODE=true**: Istio RequestAuthentication이 검증, Go는 파싱만
2. **ISTIO_JWT_MODE=false**: auth-service의 `/actuator/jwks`에서 공개키 조회

RSA 키를 공유하면 `/actuator/jwks`가 동일한 공개키를 반환하므로 Go 서비스도 자동으로 해결됩니다.

---

## 📚 배운 점

### 개발용 fallback 코드의 위험성

```java
// 이런 코드는 Production에서 시한폭탄이 된다
if (key == null) {
    logger.warn("Using generated key (development only!)");
    key = generateKey();  // 각 Pod마다 다른 키!
}
```

개발 편의를 위한 fallback 코드가 Production에서 심각한 버그를 만들 수 있습니다.

### 예방 조치

**1. 개발 환경에서도 고정 키 사용:**

```yaml
# docker/compose/.env
JWT_RSA_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n..."
JWT_RSA_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
```

**2. Production 경고 로그 모니터링:**

```
"RSA keys not configured, generating new key pair"
```

이 로그가 Production에서 보이면 즉시 조치가 필요합니다.

---

## 요약

| 항목 | 내용 |
|------|------|
| **문제** | Multi-pod auth-service에서 각 Pod이 다른 RSA 키 생성 |
| **증상** | 간헐적 JWT 검증 실패, 50% 확률로 로그인 풀림 |
| **원인** | 환경변수 미설정 시 런타임 키 생성 fallback |
| **해결** | AWS Secrets Manager + ExternalSecret으로 모든 Pod에 동일 키 주입 |
| **검증** | 로그에서 "Loading RSA key pair from environment variables" 확인 |

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `terraform/prod/foundation/secrets.tf` | RSA 키 Secret 정의 |
| `k8s/argocd/base/external-secrets/external-secret-shared.yaml` | K8s Secret 동기화 |
| `services/auth-service/.../RsaKeyConfig.java` | RSA 키 로딩 로직 |

---

## 참고

- [AWS Secrets Manager 문서](https://docs.aws.amazon.com/secretsmanager/)
- [External Secrets Operator](https://external-secrets.io/)
- [JWT RS256 vs HS256](https://auth0.com/blog/rs256-vs-hs256-whats-the-difference/)
