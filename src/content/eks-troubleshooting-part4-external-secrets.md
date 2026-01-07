---
title: "External Secrets Operator의 함정들"
excerpt: "시크릿 관리 자동화의 어두운 면 - apiVersion부터 ArgoCD OutOfSync까지"
category: kubernetes
tags:
  - EKS
  - Troubleshooting
  - ExternalSecrets
  - ArgoCD
  - AWS-SecretsManager
  - GitOps
series:
  name: "eks-troubleshooting"
  order: 4
date: '2025-12-30'
---

## 🎯 한 줄 요약

> External Secrets Operator로 시크릿 관리를 자동화했는데, 예상치 못한 함정들이 많았다. apiVersion 오류, .gitignore 문제, CRD Webhook 충돌, ArgoCD OutOfSync까지.

## 📊 Impact

- **영향 범위**: ArgoCD Sync 실패, Secret 생성 안 됨
- **소요 시간**: 약 4시간
- **발생일**: 2025-12-29 ~ 2025-12-30

---

## 💡 왜 External Secrets Operator를 선택했나?

Kubernetes에서 시크릿을 관리하는 방법은 여러 가지가 있습니다:

| 방식 | 장점 | 단점 |
|------|------|------|
| **Plain Secret** | 단순함 | Git에 커밋 불가 |
| **Sealed Secrets** | Git에 커밋 가능 | 클러스터별 키 관리 |
| **SOPS** | 다양한 KMS 지원 | 설정 복잡 |
| **ESO** | AWS/GCP/Azure 통합 | 러닝커브 |

AWS Secrets Manager를 이미 사용하고 있어서, ESO(External Secrets Operator)를 선택했습니다.

```
AWS Secrets Manager → ExternalSecret → Kubernetes Secret
                        ↑
                   ESO가 자동 동기화
```

---

## 🔥 1. apiVersion v1은 존재하지 않는다

### 증상

ArgoCD에서 external-secrets-config-prod 앱이 SyncFailed 상태입니다:

```bash
$ kubectl get application external-secrets-config-prod -n argocd -o jsonpath='{.status.conditions[0].message}'
"Version v1 of external-secrets.io/ExternalSecret is installed on the destination cluster"
```

### 원인 분석

ExternalSecret 매니페스트를 확인해봤습니다:

```yaml
# external-secret-shared.yaml
apiVersion: external-secrets.io/v1  # ← 문제!
kind: ExternalSecret
metadata:
  name: wealist-shared-secret
```

`external-secrets.io/v1`을 사용하고 있었습니다.

그런데 실제 CRD를 확인해보니:

```bash
$ kubectl get crd externalsecrets.external-secrets.io -o jsonpath='{.spec.versions[*].name}'
v1alpha1 v1beta1
```

**v1은 존재하지 않습니다!**

ESO의 API 버전 역사:
- `v1alpha1`: 초기 버전 (사용 비권장)
- `v1beta1`: 현재 안정 버전 ✅
- `v1`: **존재하지 않음** ❌

### 해결

apiVersion을 `v1beta1`로 변경:

```yaml
# Before
apiVersion: external-secrets.io/v1

# After
apiVersion: external-secrets.io/v1beta1
```

모든 ExternalSecret, ClusterSecretStore 파일을 수정:

```bash
$ grep -rl "external-secrets.io/v1" k8s/argocd/ | xargs sed -i '' 's|external-secrets.io/v1$|external-secrets.io/v1beta1|g'
```

### 핵심 포인트

- **ESO v1 API는 존재하지 않는다** - 다른 K8s 리소스와 다름
- **v1beta1이 현재 안정 버전**
- 공식 문서나 예제에서도 v1beta1 사용을 권장

---

## 🔥 2. .gitignore가 external-secrets.yaml도 무시한다

### 증상

`k8s/argocd/apps/prod/external-secrets.yaml` 파일을 만들었는데, git push가 안 됩니다:

```bash
$ git add k8s/argocd/apps/prod/external-secrets.yaml
$ git status
On branch main
nothing to commit, working tree clean
```

분명히 파일을 만들었는데 git에 추가가 안 됩니다.

### 원인 분석

`.gitignore`를 확인해봤습니다:

```gitignore
# Secrets
*-secrets.yaml
*.secret.yaml
```

`*-secrets.yaml` 패턴이 있습니다. 이게 `external-secrets.yaml`도 무시하고 있었습니다!

```
external-secrets.yaml
         ↑
    *-secrets.yaml 패턴에 매칭
```

### 해결

`.gitignore`에 예외 추가:

```gitignore
# Secrets
*-secrets.yaml
*.secret.yaml

# Allow External Secrets CRD definitions (not actual secrets)
!k8s/argocd/apps/*/external-secrets.yaml
!k8s/argocd/base/external-secrets/
!k8s/argocd/base/external-secrets/*.yaml
```

`!` 접두사는 "이건 무시하지 마세요"라는 의미입니다.

### 왜 이 파일은 Git에 커밋해도 안전한가?

`external-secrets.yaml`은 실제 시크릿 값이 아닙니다:

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
spec:
  secretStoreRef:
    name: aws-secrets-manager
  data:
    - secretKey: DB_PASSWORD
      remoteRef:
        key: "wealist/prod/database"  # AWS Secrets Manager 경로만
        property: password
```

**"어디서 가져올지"** 경로만 있고, **실제 값은 없습니다**.

### 핵심 포인트

- **.gitignore 패턴이 의도치 않게 필요한 파일을 무시할 수 있다**
- `!` 접두사로 예외 처리 가능
- ExternalSecret 정의 파일은 시크릿 값이 아니므로 Git 커밋 가능

---

## 🔥 3. ESO 업그레이드 후 CRD Webhook 오류

### 증상

ESO를 업그레이드한 후, 모든 ExternalSecret 리소스가 오류를 뱉습니다:

```bash
$ kubectl get externalsecret -n wealist-prod
Error from server: conversion webhook for external-secrets.io/v1beta1,
Kind=ExternalSecret failed: Post "https://external-secrets-webhook...":
dial tcp: lookup external-secrets-webhook.external-secrets.svc: no such host
```

### 원인 분석

CRD 상태를 확인해봤습니다:

```bash
$ kubectl get crd externalsecrets.external-secrets.io -o jsonpath='{.spec.conversion}'
{"strategy":"Webhook","webhookClientConfig":...}
```

CRD에 Conversion Webhook이 설정되어 있습니다. 이게 뭘까요?

**Conversion Webhook**: CRD가 여러 버전(v1alpha1, v1beta1)을 지원할 때, 버전 간 변환을 담당하는 웹훅입니다.

그런데 ESO 업그레이드 과정에서:
1. CRD에는 Webhook 설정이 남아있음
2. 실제 Webhook Pod는 재시작됨
3. v1beta1이 `served: false`로 변경됨

```bash
$ kubectl get crd externalsecrets.external-secrets.io -o jsonpath='{.spec.versions}' | jq '.[] | {name, served}'
{"name":"v1beta1","served":false}  # ← v1beta1이 비활성화!
{"name":"v1","served":true}
```

결과적으로 Webhook 호출 → Webhook이 비활성화된 버전을 변환하려 함 → 실패.

### 해결

CRD의 conversion strategy를 None으로 변경:

```bash
# 모든 ESO CRD 패치
$ kubectl patch crd clustersecretstores.external-secrets.io \
  --type=json -p='[{"op":"replace","path":"/spec/conversion","value":{"strategy":"None"}}]'

$ kubectl patch crd externalsecrets.external-secrets.io \
  --type=json -p='[{"op":"replace","path":"/spec/conversion","value":{"strategy":"None"}}]'

$ kubectl patch crd secretstores.external-secrets.io \
  --type=json -p='[{"op":"replace","path":"/spec/conversion","value":{"strategy":"None"}}]'
```

### 검증

```bash
$ kubectl get crd externalsecrets.external-secrets.io -o jsonpath='{.spec.conversion}'
{"strategy":"None"}

$ kubectl get externalsecret -n wealist-prod
NAME                     STORE                  REFRESH   STATUS
wealist-shared-secret    aws-secrets-manager    1h        SecretSynced
```

### 주의사항

이 패치는 ESO Helm chart가 CRD를 관리하지 않는 경우에만 영구적입니다. ESO 재설치/업그레이드 시 CRD가 다시 Webhook 전략으로 돌아갈 수 있습니다.

### 핵심 포인트

- **CRD 업그레이드 시 Conversion Webhook 설정을 확인해야 한다**
- **Webhook 전략은 모든 API 버전이 served: true일 때만 동작**
- `strategy: None`으로 변경하면 버전 변환 없이 직접 사용

---

## 🔥 4. ArgoCD OutOfSync - ESO가 기본값 필드를 추가한다

### 증상

external-secrets-config-prod 앱이 계속 OutOfSync 상태입니다. Sync를 눌러도 잠시 후 다시 OutOfSync가 됩니다:

```bash
$ kubectl get application external-secrets-config-prod -n argocd -o jsonpath='{.status.sync.status}'
OutOfSync
```

ArgoCD UI에서 diff를 확인해보니:

```diff
spec:
  data:
    - remoteRef:
+       conversionStrategy: Default     # ← ESO가 추가
+       decodingStrategy: None          # ← ESO가 추가
        key: "wealist/prod/database"
+       metadataPolicy: None            # ← ESO가 추가
        property: password
+ target:
+   deletionPolicy: Retain              # ← ESO가 추가
```

### 원인 분석

**ESO Controller가 ExternalSecret에 기본값 필드를 자동 추가합니다.**

Git에는 이런 필드가 없지만:

```yaml
# Git에 정의된 내용
spec:
  data:
    - remoteRef:
        key: "wealist/prod/database"
        property: password
```

클러스터에 적용되면 ESO가 기본값을 채워넣습니다:

```yaml
# 클러스터에 적용된 내용
spec:
  data:
    - remoteRef:
        conversionStrategy: Default     # 자동 추가
        decodingStrategy: None          # 자동 추가
        key: "wealist/prod/database"
        metadataPolicy: None            # 자동 추가
        property: password
  target:
    deletionPolicy: Retain              # 자동 추가
```

ArgoCD는 Git 상태와 클러스터 상태를 비교하므로 → **영원히 OutOfSync**.

### 해결

ArgoCD Application에 `ignoreDifferences` 추가:

```yaml
# k8s/argocd/apps/prod/external-secrets.yaml
spec:
  ignoreDifferences:
    - group: external-secrets.io
      kind: ExternalSecret
      jqPathExpressions:
        - .spec.data[].remoteRef.conversionStrategy
        - .spec.data[].remoteRef.decodingStrategy
        - .spec.data[].remoteRef.metadataPolicy
        - .spec.target.deletionPolicy
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

`jqPathExpressions`는 jq 문법으로 무시할 필드 경로를 지정합니다.

### 즉시 적용 (kubectl)

Git에 반영하기 전에 즉시 적용이 필요한 경우:

```bash
$ kubectl patch application external-secrets-config-prod -n argocd --type=merge -p '{
  "spec": {
    "ignoreDifferences": [
      {
        "group": "external-secrets.io",
        "kind": "ExternalSecret",
        "jqPathExpressions": [
          ".spec.data[].remoteRef.conversionStrategy",
          ".spec.data[].remoteRef.decodingStrategy",
          ".spec.data[].remoteRef.metadataPolicy",
          ".spec.target.deletionPolicy"
        ]
      }
    ]
  }
}'

# 앱 새로고침
$ kubectl patch application external-secrets-config-prod -n argocd \
  --type merge -p '{"metadata":{"annotations":{"argocd.argoproj.io/refresh":"hard"}}}'
```

### 검증

```bash
$ kubectl get application external-secrets-config-prod -n argocd -o jsonpath='{.status.sync.status}'
Synced
```

### 핵심 포인트

- **많은 Operator가 기본값 필드를 자동 추가한다** (ESO, Istio, cert-manager 등)
- **ArgoCD ignoreDifferences로 이런 필드를 무시할 수 있다**
- `jqPathExpressions`는 복잡한 경로 표현에 유용

---

## 🔥 5. ESO Webhook Not Ready - cert-controller 순서 문제

### 증상

ExternalSecret이 생성되지 않고 webhook validation 에러가 발생합니다:

```
ExternalSecret status: SecretSyncedError
Message: could not get secret: webhook validation failed
```

모든 Go/Spring 서비스가 CrashLoopBackOff 상태가 됩니다:

```
로그: dial tcp 127.0.0.1:5432: connect: connection refused
```

서비스들이 localhost의 PostgreSQL/Redis에 연결을 시도합니다. 왜일까요?

### 원인 분석

ESO는 세 개의 컴포넌트로 구성됩니다:

| 컴포넌트 | 역할 |
|----------|------|
| external-secrets | ExternalSecret → Secret 동기화 |
| external-secrets-webhook | 리소스 validation |
| **external-secrets-cert-controller** | **TLS 인증서 생성** |

**시작 순서 문제**:

```
cert-controller 로그:
"ca cert not yet ready, queuing for later"
```

1. cert-controller가 아직 TLS 인증서를 생성하지 못함
2. webhook이 TLS 없이 시작됨
3. Kubernetes control plane이 webhook에 연결 불가
4. ExternalSecret validation 실패
5. Secret이 생성되지 않음
6. 서비스가 환경변수(DB_HOST, REDIS_HOST) 없이 시작
7. **localhost를 기본값으로 사용** → CrashLoopBackOff

### 진단

```bash
# ESO pods 상태
kubectl get pods -n external-secrets
# NAME                                              READY   STATUS
# external-secrets-xxx                              1/1     Running
# external-secrets-cert-controller-xxx              0/1     CrashLoopBackOff ← 문제!
# external-secrets-webhook-xxx                      1/1     Running

# cert-controller 로그
kubectl logs -n external-secrets deploy/external-secrets-cert-controller
# "ca cert not yet ready, queuing for later"

# webhook 상태
kubectl get validatingwebhookconfiguration | grep external-secrets
```

### 해결

**ESO 컴포넌트를 올바른 순서로 재시작**:

```bash
# 1. cert-controller 먼저 재시작
kubectl rollout restart deployment -n external-secrets external-secrets-cert-controller

# 2. 인증서 생성 대기 (30초)
sleep 30

# 3. webhook 재시작
kubectl rollout restart deployment -n external-secrets external-secrets-webhook

# 4. 잠시 대기
sleep 10

# 5. main controller 재시작
kubectl rollout restart deployment -n external-secrets external-secrets
```

그 후 서비스도 재시작:

```bash
kubectl rollout restart deployment -n wealist-prod -l environment=production
```

### 예방

ArgoCD Application에 retry 설정 추가:

```yaml
# external-secrets Application
syncPolicy:
  retry:
    limit: 10
    backoff:
      duration: 5s
      factor: 2
      maxDuration: 5m
```

더 근본적인 해결책은 **서비스에 Init Container 추가**:

```yaml
initContainers:
  - name: wait-for-secrets
    image: bitnami/kubectl:1.30
    command:
      - /bin/sh
      - -c
      - |
        echo "Waiting for secret wealist-shared-secret..."
        while ! kubectl get secret wealist-shared-secret -n $NAMESPACE; do
          sleep 5
        done
        echo "Secret ready!"
```

이렇게 하면 Secret이 준비될 때까지 서비스가 시작하지 않습니다.

### 핵심 포인트

- **ESO는 세 컴포넌트의 시작 순서가 중요하다**: cert-controller → webhook → controller
- **Secret이 없으면 앱은 기본값(localhost)을 사용한다**
- **ArgoCD sync-wave는 "생성 순서"만 보장하고 "Ready 상태"를 기다리지 않는다**
- **Init Container로 Secret 준비를 확실히 보장할 수 있다**

---

## 📚 종합 정리

### ESO 트러블슈팅 체크리스트

```
[ ] apiVersion이 v1beta1인가? (v1 아님!)
[ ] .gitignore가 파일을 무시하고 있지 않은가?
[ ] CRD Conversion Webhook 상태가 정상인가?
[ ] ArgoCD ignoreDifferences 설정이 되어 있는가?
[ ] cert-controller가 정상 동작 중인가?
[ ] ESO 컴포넌트 시작 순서가 올바른가? (cert-controller → webhook → controller)
```

### ESO API 버전 참고

| API Version | 상태 | 비고 |
|-------------|------|------|
| v1alpha1 | 구버전 | 사용 비권장 |
| **v1beta1** | **안정** | ✅ 권장 |
| v1 | **없음** | 존재하지 않음! |

### 이 경험에서 배운 것들

1. **API 버전을 가정하지 말고 확인하라** - v1이 항상 있는 게 아니다
2. **.gitignore는 의도치 않은 부작용이 있을 수 있다**
3. **CRD 업그레이드는 Webhook 설정까지 확인해야 한다**
4. **Operator가 추가하는 기본값은 ArgoCD와 충돌한다**
5. **ESO cert-controller가 먼저 준비되어야 webhook이 동작한다**
6. **sync-wave는 "생성 순서"만 보장한다** - Ready 상태를 기다리지 않음

---

## 🤔 스스로에게 던지는 질문

### 1. CRD 버전 업그레이드 시 주의할 점은?

- Conversion Webhook 설정 확인
- served/storage 버전 확인
- 기존 리소스와의 호환성 테스트
- ArgoCD 등 GitOps 도구와의 호환성

### 2. ArgoCD ignoreDifferences는 언제 사용해야 할까?

**사용하는 경우:**
- Operator가 기본값을 추가하는 필드
- 런타임에 변경되는 status 필드
- 환경별로 다른 annotation

**사용하면 안 되는 경우:**
- 실제로 관리해야 하는 설정
- 보안 관련 필드
- 의도적으로 다르게 설정한 값

### 3. ESO vs Sealed Secrets vs SOPS, 선택 기준은?

| 기준 | ESO | Sealed Secrets | SOPS |
|------|-----|---------------|------|
| AWS 통합 | ✅ 최고 | ❌ | ✅ |
| 멀티 클러스터 | ✅ | ❌ (클러스터별 키) | ✅ |
| GitOps 친화성 | ⚠️ (ignoreDifferences 필요) | ✅ | ✅ |
| 러닝커브 | 중간 | 낮음 | 중간 |

**AWS 사용 + 멀티 클러스터 → ESO 추천**

### 4. ExternalSecret Sync 실패 시 디버깅 순서는?

```bash
# 1. ExternalSecret 상태 확인
kubectl get externalsecret -n <namespace> -o wide

# 2. SecretStore/ClusterSecretStore 상태 확인
kubectl get clustersecretstore
kubectl describe clustersecretstore <name>

# 3. ESO Controller 로그 확인
kubectl logs -n external-secrets -l app.kubernetes.io/name=external-secrets

# 4. AWS Secrets Manager 권한 확인 (Pod Identity/IRSA)
kubectl describe pod -n external-secrets -l app.kubernetes.io/name=external-secrets
```

---

## 🔗 다음 편 예고

다음 편에서는 **EKS 모니터링 스택 구축**에서 겪은 문제들을 다룹니다:
- 모니터링 이미지 ImagePullBackOff
- PVC Pending - 기본 StorageClass 미설정
- Prometheus PVC 권한 오류
- 모니터링 Pod Lock 충돌

Prometheus 띄우는 데만 7가지 장애물을 넘은 이야기를 공유하겠습니다.

---

## 🔗 참고

- [External Secrets Operator 공식 문서](https://external-secrets.io/)
- [ArgoCD ignoreDifferences](https://argo-cd.readthedocs.io/en/stable/user-guide/diffing/)
- [Kubernetes CRD Conversion Webhooks](https://kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definition-versioning/)
