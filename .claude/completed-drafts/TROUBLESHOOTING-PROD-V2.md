# Production EKS 트러블슈팅 가이드 V2

> 이 문서는 2025-12-30 이후 Production EKS 환경에서 발생한 문제들과 해결 방법을 기록합니다.
>
> 이전 기록: [TROUBLESHOOTING-PROD.md](./TROUBLESHOOTING-PROD.md)

---

## 2025-12-30: ESO CRD Conversion Webhook 오류

### 증상

```
ArgoCD App external-secrets-config-prod가 SyncFailed
"conversion webhook for external-secrets.io/v1beta1, Kind=ClusterSecretStore failed"
ClusterSecretStore, ExternalSecret 리소스 생성/수정 불가
```

### 로그

```bash
kubectl get externalsecret -n wealist-prod
# Error from server: conversion webhook for external-secrets.io/v1beta1,
# Kind=ExternalSecret failed: Post "https://external-secrets-webhook...":
# dial tcp: lookup external-secrets-webhook.external-secrets.svc: no such host
```

### 원인

**ESO CRD에 Conversion Webhook이 설정되어 있으나 v1beta1이 비활성화됨:**

1. ESO 업그레이드 후 CRD에 `v1beta1 served: false` 설정
2. CRD의 `spec.conversion.strategy: Webhook` 유지
3. ArgoCD가 v1 리소스를 적용하려 하면 conversion webhook 호출
4. Webhook이 v1beta1을 변환하려 하지만 v1beta1이 비활성화되어 실패

```bash
# CRD 상태 확인
kubectl get crd clustersecretstores.external-secrets.io -o jsonpath='{.spec.versions}' | jq '.[] | {name, served}'
# {"name":"v1","served":true}
# {"name":"v1beta1","served":false}  # ← v1beta1 비활성화

kubectl get crd clustersecretstores.external-secrets.io -o jsonpath='{.spec.conversion}'
# {"strategy":"Webhook","webhookClientConfig":...}  # ← 아직 Webhook 설정 남아있음
```

### 해결

**CRD의 conversion strategy를 None으로 변경:**

```bash
# 모든 ESO CRD 패치
kubectl patch crd clustersecretstores.external-secrets.io \
  --type=json -p='[{"op":"replace","path":"/spec/conversion","value":{"strategy":"None"}}]'

kubectl patch crd externalsecrets.external-secrets.io \
  --type=json -p='[{"op":"replace","path":"/spec/conversion","value":{"strategy":"None"}}]'

kubectl patch crd secretstores.external-secrets.io \
  --type=json -p='[{"op":"replace","path":"/spec/conversion","value":{"strategy":"None"}}]'
```

### 검증

```bash
# Conversion strategy 확인
kubectl get crd clustersecretstores.external-secrets.io -o jsonpath='{.spec.conversion}'
# {"strategy":"None"}  ← 성공

# ArgoCD 앱 동기화
kubectl patch application external-secrets-config-prod -n argocd \
  --type merge -p '{"operation":{"sync":{"syncStrategy":{"apply":{"force":true}}}}}'

# 상태 확인
kubectl get application external-secrets-config-prod -n argocd -o jsonpath='{.status.sync.status}'
# Synced
```

### 주의사항

- 이 패치는 ESO Helm chart가 CRD를 관리하지 않는 경우에만 영구적
- ESO 재설치/업그레이드 시 CRD가 다시 Webhook 전략으로 돌아갈 수 있음
- ESO Helm values에서 `installCRDs: true`인 경우 CRD 관리 방식 확인 필요

---

## 2025-12-30: ArgoCD 앱 OutOfSync - ESO 기본값 필드

### 증상

```
argocd-config, external-secrets-config-prod 앱이 OutOfSync
리소스는 정상 동작하지만 ArgoCD가 계속 diff 감지
```

### 원인

**ESO가 ExternalSecret에 기본값 필드를 자동 추가:**

```yaml
# Git에 정의된 내용
spec:
  data:
    - remoteRef:
        key: "wealist/prod/notifications/discord"
        property: webhook_url

# 실제 클러스터에 적용된 내용 (ESO가 기본값 추가)
spec:
  data:
    - remoteRef:
        conversionStrategy: Default     # ← 자동 추가
        decodingStrategy: None          # ← 자동 추가
        key: "wealist/prod/notifications/discord"
        metadataPolicy: None            # ← 자동 추가
        property: webhook_url
  target:
    deletionPolicy: Retain              # ← 자동 추가
```

ArgoCD가 Git 상태와 클러스터 상태의 차이를 감지하여 OutOfSync 표시.

### 해결

**ArgoCD Application에 ignoreDifferences 추가:**

```yaml
# k8s/argocd/apps/prod/argocd-config.yaml
# k8s/argocd/apps/prod/external-secrets.yaml

spec:
  # ESO가 자동으로 추가하는 기본값 필드 무시
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

### 임시 해결 (kubectl)

Git에 반영하기 전 즉시 적용이 필요한 경우:

```bash
kubectl patch application argocd-config -n argocd --type=merge -p '{
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
kubectl patch application argocd-config -n argocd \
  --type merge -p '{"metadata":{"annotations":{"argocd.argoproj.io/refresh":"hard"}}}'
```

### 검증

```bash
kubectl get applications -n argocd -o custom-columns='NAME:.metadata.name,SYNC:.status.sync.status'
# argocd-config                  Synced
# external-secrets-config-prod   Synced
```

### 영향받는 파일

| 파일 | 변경 내용 |
|------|----------|
| `k8s/argocd/apps/prod/argocd-config.yaml` | ignoreDifferences 추가 |
| `k8s/argocd/apps/prod/external-secrets.yaml` | ignoreDifferences 추가 |

---

## 2025-12-30: metrics-server APIService OutOfSync

### 증상

```
metrics-server ArgoCD App이 OutOfSync
APIService v1beta1.metrics.k8s.io 리소스에서 /status 필드 diff 발생
```

### 원인

**Kubernetes가 APIService의 status 필드를 자동 업데이트:**

```yaml
# Git에 정의된 내용
apiVersion: apiregistration.k8s.io/v1
kind: APIService
metadata:
  name: v1beta1.metrics.k8s.io
spec:
  # ...

# 실제 클러스터 상태
apiVersion: apiregistration.k8s.io/v1
kind: APIService
metadata:
  name: v1beta1.metrics.k8s.io
spec:
  # ...
status:              # ← Kubernetes가 자동 추가
  conditions:
    - lastTransitionTime: "2025-12-30T..."
      message: all checks passed
      reason: Passed
      status: "True"
      type: Available
```

ArgoCD가 status 필드 차이를 감지하여 OutOfSync 표시.

### 해결

**Terraform에서 ignoreDifferences 설정:**

```hcl
# terraform/prod/argocd-apps/cluster-addons.tf

resource "kubernetes_manifest" "argocd_app_metrics_server" {
  manifest = {
    # ...
    spec = {
      # ...
      ignoreDifferences = [
        {
          group = "apiregistration.k8s.io"
          kind  = "APIService"
          jsonPointers = ["/status"]
        }
      ]
    }
  }
}
```

### 적용

```bash
cd terraform/prod/argocd-apps
terraform plan
terraform apply
```

### 검증

```bash
kubectl get application metrics-server -n argocd -o jsonpath='{.status.sync.status}'
# Synced
```

---

## 2025-12-30: HPA Scale Down 속도 개선

### 증상

```
auth-service HPA가 스케일 다운이 너무 느림
트래픽 감소 후 5분 이상 대기 후에야 replica 감소
비용 낭비 발생
```

### 원인

**HPA 기본 behavior 설정이 보수적:**

```yaml
# 기존 설정 (암묵적 기본값)
autoscaling:
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300  # 5분 대기
      policies:
        - type: Pods
          value: 1                      # 한 번에 1개만 제거
          periodSeconds: 60
      selectPolicy: Min                 # 가장 보수적인 정책 선택
```

### 해결

**더 공격적인 스케일 다운 설정:**

```yaml
# k8s/helm/environments/prod.yaml
autoscaling:
  enabled: true
  minReplicas: 1
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70
  targetMemoryUtilizationPercentage: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 120  # 2분으로 단축
      policies:
        - type: Percent
          value: 50
          periodSeconds: 60
        - type: Pods
          value: 2                      # 한 번에 최대 2개 제거
          periodSeconds: 60
      selectPolicy: Max                 # 더 공격적으로 스케일 다운
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Percent
          value: 100
          periodSeconds: 30
        - type: Pods
          value: 4
          periodSeconds: 30
      selectPolicy: Max
```

### 설정 설명

| 설정 | 기존 | 변경 | 효과 |
|------|------|------|------|
| `stabilizationWindowSeconds` | 300 (5분) | 120 (2분) | 대기 시간 단축 |
| `policies.Pods.value` | 1 | 2 | 한 번에 더 많이 제거 |
| `selectPolicy` | Min | Max | 더 공격적인 정책 선택 |

### 검증

```bash
# HPA 상태 확인
kubectl get hpa -n wealist-prod

# HPA 상세 확인 (behavior 설정)
kubectl describe hpa auth-service-hpa -n wealist-prod
```

### 참고: Helm 구조 제약

**서비스별 autoscaling override는 불가능:**

```yaml
# ❌ 작동하지 않음 (Helm 경로 불일치)
auth-service:
  autoscaling:
    minReplicas: 2  # .Values.auth-service.autoscaling.minReplicas

# ✅ 전역 설정만 적용됨
autoscaling:
  minReplicas: 1  # .Values.autoscaling.minReplicas
```

서비스별 다른 HPA 설정이 필요하면:
- 각 서비스 Helm chart에서 별도 autoscaling 블록 정의
- 또는 서비스별 values 파일 분리

---

## 2025-12-31: Go genproto 모듈 충돌 (CI 빌드 실패)

### 증상

```
board-service CI 빌드가 계속 실패
PR: prod → k8s-deploy-prod 머지 불가
```

```bash
# CI 에러 로그
go: downloading google.golang.org/genproto v0.0.0-20210310155132-4ce2db91004e
/go/pkg/mod/github.com/grpc-ecosystem/grpc-gateway/v2@v2.23.0/runtime/handler.go:13:2:
ambiguous import: found package google.golang.org/genproto/googleapis/api/httpbody in multiple modules:
    google.golang.org/genproto v0.0.0-20210310155132-4ce2db91004e
    google.golang.org/genproto/googleapis/api v0.0.0-20241104194629-dd2ea8efbc28
```

### 원인

**Go genproto 패키지 분리로 인한 버전 충돌:**

2021년경 Google은 genproto를 monolithic 패키지에서 submodule로 분리:
- 구버전: `google.golang.org/genproto` (모든 googleapis 포함)
- 신버전: `google.golang.org/genproto/googleapis/api`, `.../googleapis/rpc` (분리된 submodule)

두 버전이 동시에 존재하면 동일 패키지가 두 곳에서 발견되어 `ambiguous import` 에러 발생.

**board-service의 의존성 체인 분석:**

```
leanovate/gopter v0.2.11 (property-based testing library)
  → smartystreets/goconvey v1.8.1
    → gopherjs v1.17.2
      → spf13/cobra v1.2.1
        → spf13/viper v1.8.1
          → bketelsen/crypt v0.0.4
            → go.etcd.io/etcd/api v3.5.0
              → grpc-ecosystem/grpc-gateway v1.16.0  ← 범인!
                → google.golang.org/genproto v0.0.0-20200513103714-09dca8ec2884 (구버전)
```

**동시에 common package에서:**
```
wealist-advanced-go-pkg
  → grpc-gateway/v2 v2.23.0
    → google.golang.org/genproto/googleapis/api v0.0.0-20241104194629-dd2ea8efbc28 (신버전)
```

### 진단 명령어

```bash
cd services/board-service

# 어떤 패키지가 genproto를 가져오는지 확인
go mod graph | grep genproto

# grpc-gateway v1 사용 여부 확인
go mod graph | grep "grpc-gateway" | grep -v "v2"

# 전체 의존성 체인 추적
go mod graph | grep "gopter"
go mod graph | grep "goconvey"
go mod graph | grep "etcd"
```

### 해결

**1. gopter 의존성 제거 (property test 임시 비활성화):**

```bash
# go.mod에서 gopter 제거
# github.com/leanovate/gopter v0.2.11  # 삭제

# property test 파일들 이동
mkdir -p internal/service/property_tests_disabled
mv internal/service/*property*.go internal/service/property_tests_disabled/

# 파일 확장자 변경 (Go가 파싱하지 않도록)
cd internal/service/property_tests_disabled
for f in *.go; do mv "$f" "${f%.go}.go.disabled"; done
```

**2. go.mod에 exclude 블록 추가:**

```go
// Exclude old genproto to avoid ambiguous import errors
// Root cause: gopter → goconvey → gopherjs → cobra → viper → crypt → etcd → grpc-gateway v1 → old genproto
exclude (
    // Exclude grpc-gateway v1 (the direct source of old genproto)
    github.com/grpc-ecosystem/grpc-gateway v1.16.0

    // Exclude all old genproto versions that conflict with googleapis/api submodule
    google.golang.org/genproto v0.0.0-20210602131652-f16073e35f0c
    google.golang.org/genproto v0.0.0-20210402141018-6c239bbf2bb1
    google.golang.org/genproto v0.0.0-20210319143718-93e7006c17a6
    google.golang.org/genproto v0.0.0-20210310155132-4ce2db91004e
    google.golang.org/genproto v0.0.0-20200825200019-8632dd797987
    google.golang.org/genproto v0.0.0-20200806141610-86f49bd18e98
    google.golang.org/genproto v0.0.0-20200526211855-cb27e3aa2013
    google.golang.org/genproto v0.0.0-20200513103714-09dca8ec2884
    google.golang.org/genproto v0.0.0-20200423170343-7949de9c1215
    google.golang.org/genproto v0.0.0-20200115191322-ca5a22157cba
    google.golang.org/genproto v0.0.0-20191108220845-16a3f7862a1a
    google.golang.org/genproto v0.0.0-20190911173649-1774047e7e51
    google.golang.org/genproto v0.0.0-20190819201941-24fa4b261c55
    google.golang.org/genproto v0.0.0-20190801165951-fa694d86fc64
    google.golang.org/genproto v0.0.0-20190502173448-54afdca5d873
    google.golang.org/genproto v0.0.0-20190425155659-357c62f0e4bb
    google.golang.org/genproto v0.0.0-20190418145605-e7d98fc518a7
    google.golang.org/genproto v0.0.0-20190307195333-5fe7a883aa19
    google.golang.org/genproto v0.0.0-20180817151627-c66870c02cf8
)
```

**3. Swagger 비활성화 (관련 문제 방지):**

```bash
# docs 폴더 이동
mv docs docs.bak

# main.go에서 docs import 주석 처리
# // _ "project-board-api/docs"

# router.go에서 swagger endpoint 주석 처리
# // baseGroup.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))
```

### 검증

```bash
cd services/board-service

# go.work로 빌드 테스트 (로컬)
cd ../.. && go build ./services/board-service/cmd/api
# 성공 시 출력 없음

# CI 환경 시뮬레이션 (GOWORK=off + replace directive)
cd services/board-service
echo 'replace github.com/OrangesCloud/wealist-advanced-go-pkg => ../../packages/wealist-advanced-go-pkg' >> go.mod
GOWORK=off go mod tidy
GOWORK=off go build ./cmd/api
# 성공 시 출력 없음

# Lint 테스트
golangci-lint run --timeout=5m
# 0 issues

# 테스트 실행
go test ./...
# ok
```

### 영향받은 파일

| 파일 | 변경 내용 |
|------|----------|
| `services/board-service/go.mod` | gopter 제거, exclude 블록 추가 |
| `services/board-service/go.sum` | 의존성 업데이트 |
| `services/board-service/cmd/api/main.go` | docs import 주석 처리 |
| `services/board-service/internal/router/router.go` | swagger endpoint 주석 처리 |
| `services/board-service/docs/` → `docs.bak/` | swagger docs 임시 비활성화 |
| `services/board-service/internal/service/property_tests_disabled/` | property test 파일 이동 |

### 근본 해결 방안 (추후)

1. **gopter 업그레이드 확인**: 최신 버전에서 goconvey 의존성이 제거되었는지 확인
2. **swagger 업그레이드**: gin-swagger를 최신 버전으로 업그레이드하여 genproto 충돌 해결
3. **property test 재활성화**: gopter 문제 해결 후 테스트 파일 복원

### 참고: 왜 board-service만 문제였나?

다른 Go 서비스(user, chat, noti, storage, video)는 gopter를 사용하지 않음:

```bash
# 서비스별 gopter 사용 여부 확인
for svc in user chat noti storage video; do
  grep -l "gopter" services/$svc-service/go.mod 2>/dev/null || echo "$svc: not using gopter"
done
# 모두 "not using gopter" 출력
```

board-service만 property-based testing을 위해 gopter를 사용했고, 이것이 유일한 grpc-gateway v1 의존성 경로였음.

---

## 일반 디버깅 명령어 (V2)

### ESO 관련

```bash
# CRD conversion 전략 확인
kubectl get crd clustersecretstores.external-secrets.io \
  -o jsonpath='{.spec.conversion.strategy}'

# ExternalSecret 상태 확인
kubectl get externalsecret -n wealist-prod -o wide

# SecretStore/ClusterSecretStore 상태
kubectl get clustersecretstore
kubectl get secretstore -n wealist-prod
```

### ArgoCD 관련

```bash
# OutOfSync 리소스 찾기
kubectl get application {app-name} -n argocd \
  -o jsonpath='{.status.resources}' | \
  jq '.[] | select(.status == "OutOfSync")'

# 앱 강제 동기화
kubectl patch application {app-name} -n argocd \
  --type merge -p '{"operation":{"sync":{"syncStrategy":{"apply":{"force":true}}}}}'

# 앱 새로고침
kubectl patch application {app-name} -n argocd \
  --type merge -p '{"metadata":{"annotations":{"argocd.argoproj.io/refresh":"hard"}}}'

# ignoreDifferences 확인
kubectl get application {app-name} -n argocd \
  -o jsonpath='{.spec.ignoreDifferences}' | jq .
```

### HPA 관련

```bash
# HPA 현재 상태
kubectl get hpa -n wealist-prod -o wide

# HPA 상세 (behavior 설정 포함)
kubectl describe hpa {service}-hpa -n wealist-prod

# HPA 이벤트 확인
kubectl get events -n wealist-prod --field-selector reason=SuccessfulRescale
```

---

## 2025-12-31: 모니터링 스택 업그레이드 및 S3 전환

### 1. Go 서비스 CrashLoopBackOff - DB 인증 실패

#### 증상

```
모든 Go 서비스 (board, user, chat, noti, storage, video) CrashLoopBackOff
password authentication failed for user "board_db"
```

#### 원인

**ConfigMap 템플릿의 DB_USER 자동 생성이 shared.config 값을 덮어씀:**

```yaml
# _configmap.tpl - 문제 코드
{{- if .Values.config.DB_NAME }}
{{- $dbUser := regexReplaceAll "wealist_(.*)_db" .Values.config.DB_NAME "${1}" }}
DB_USER: {{ $dbUser | quote }}  # board_db 생성 → shared.config.DB_USER (wealist_admin) 덮어씀
{{- end }}
```

- Secret: `wealist_admin` 비밀번호
- ConfigMap: `board_db` (자동 생성)
- 결과: 인증 불일치

#### 해결

**`_configmap.tpl` 수정 - shared.config와 service config 모두 확인 후 자동 생성:**

```yaml
{{- if .Values.config.DB_NAME }}
{{- $sharedDbUser := "" }}
{{- if .Values.shared }}{{- if .Values.shared.config }}{{- $sharedDbUser = .Values.shared.config.DB_USER | default "" }}{{- end }}{{- end }}
{{- $serviceDbUser := .Values.config.DB_USER | default "" }}
{{- if and (eq $sharedDbUser "") (eq $serviceDbUser "") }}
{{- $dbUser := regexReplaceAll "wealist_(.*)_db" .Values.config.DB_NAME "${1}" }}
DB_USER: {{ $dbUser | quote }}
{{- end }}
{{- end }}
```

---

### 2. Prometheus OOMKilled (exitCode: 137)

#### 증상

```
prometheus-xxx  0/1  CrashLoopBackOff
Exit Code: 137 (OOMKilled)
WAL replay 중 메모리 초과
```

#### 원인

기본 메모리 제한 512Mi가 WAL replay에 부족

#### 해결

**prod.yaml에 리소스 증가:**

```yaml
prometheus:
  resources:
    limits:
      memory: "1Gi"  # 512Mi → 1Gi
```

---

### 3. Tempo S3 Access Denied - Pod Identity 미지원

#### 증상

```
unexpected error from ListObjects on wealist-prod-tempo-traces: Access Denied
ServiceAccount 'tempo' not found
```

#### 진단

1. S3 버킷 존재 확인 ✓
2. Pod Identity 생성 ✓
3. ServiceAccount 없음 ✗
4. Tempo 2.3.1은 EKS Pod Identity 미지원 (minio-go 버전 문제)

```bash
# Pod에서 AWS CLI 테스트 - 성공
kubectl exec -n wealist-prod deploy/tempo -- aws s3 ls s3://wealist-prod-tempo-traces

# Tempo 자체 S3 접근 - 실패 (minio-go가 Pod Identity 미지원)
```

#### 해결

1. **ServiceAccount 생성:** `templates/tempo/serviceaccount.yaml`
2. **Deployment에 serviceAccountName 추가**
3. **Tempo 버전 업그레이드:** 2.3.1 → 2.6.1 (minio-go 7.0.70+ 포함)

```yaml
# GitHub Issue #3899 참조
tempo:
  image:
    tag: "2.6.1"  # Pod Identity 지원
```

---

### 4. 모니터링 컴포넌트 ImagePullBackOff

#### 증상

```
prometheus-xxx  ImagePullBackOff
loki-xxx        ImagePullBackOff
alloy-xxx       ImagePullBackOff
Failed to pull image "prom/prometheus:v2.56.1": not found
```

#### 원인

**존재하지 않는 이미지 태그 지정:**

| Component | 잘못된 태그 | 실제 최신 |
|-----------|------------|----------|
| Prometheus | v2.56.1 | v2.55.1 |
| Loki | 2.10.6 | 3.6.3 |
| Alloy | 1.5.0 | v1.12.1 |
| OTEL Collector | 0.116.0 | 0.92.0 (유지) |

#### 해결

**Docker Hub에서 실제 태그 확인 후 수정:**

```bash
# 태그 확인
curl -s "https://hub.docker.com/v2/repositories/prom/prometheus/tags" | jq -r '.results[].name' | grep "^v2\." | head -5

# prod.yaml 수정
prometheus:
  image:
    tag: "v2.55.1"
loki:
  image:
    tag: "3.6.3"
alloy:
  image:
    tag: "v1.12.1"
```

---

### 5. Loki 3.x 설정 호환성 오류

#### 증상

```
failed parsing config: yaml: unmarshal errors:
line 42: field enforce_metric_name not found in type validation.plain
```

#### 원인

Loki 3.x에서 `enforce_metric_name` 필드 deprecated

#### 해결

**ConfigMap에서 deprecated 필드 제거:**

```yaml
# 변경 전
limits_config:
  enforce_metric_name: false  # ← 삭제
  reject_old_samples: true

# 변경 후
limits_config:
  reject_old_samples: true
```

**Loki 3.x 추가 변경사항:**
- TSDB 스키마 v13 사용
- `boltdb-shipper` → `tsdb_shipper`
- S3 설정 형식 변경

---

### 6. OTEL Collector 0.116.0 CrashLoopBackOff

#### 증상

```
exec /otelcol-contrib: no such file or directory
```

#### 원인

0.116.0 버전에서 바이너리 경로 변경

#### 해결

**기존 동작 버전 유지:**

```yaml
otelCollector:
  image:
    tag: "0.92.0"  # 현재 안정 동작 버전
```

---

### 최종 버전 매트릭스

| Component | 이전 버전 | 최종 버전 | 상태 |
|-----------|----------|----------|------|
| Prometheus | v2.48.0 | v2.55.1 | ✅ |
| Grafana | 10.2.2 | 10.4.12 | ✅ |
| Loki | 2.9.2 | 3.6.3 | ✅ S3 |
| Tempo | 2.3.1 | 2.6.1 | ✅ S3 |
| Alloy | - | v1.12.1 | ✅ 신규 |
| Promtail | 2.9.2 | 비활성화 | - |
| OTEL Collector | 0.92.0 | 0.92.0 | ✅ 유지 |
| kube-state-metrics | v2.10.1 | v2.14.0 | ✅ |
| node-exporter | v1.7.0 | v1.9.0 | ✅ |

---

### 관련 파일

| 변경 유형 | 파일 |
|----------|------|
| Terraform | `foundation/s3.tf` (Loki S3 버킷) |
| Terraform | `compute/pod-identity.tf` (Loki Pod Identity) |
| Helm | `templates/loki/serviceaccount.yaml` (신규) |
| Helm | `templates/loki/configmap.yaml` (3.x 호환) |
| Helm | `templates/alloy/*` (신규 5개) |
| Values | `values.yaml`, `prod.yaml` |

---

## 2025-12-31: Go OTel Schema URL 충돌 (트레이싱 실패)

### 증상

```
모든 Go 서비스에서 OTel 초기화 실패
트레이스가 Tempo로 전송되지 않음
```

```json
{"level":"warn","msg":"Failed to initialize OpenTelemetry, continuing without tracing",
 "error":"conflicting Schema URL: https://opentelemetry.io/schemas/1.26.0 and https://opentelemetry.io/schemas/1.32.0"}
```

---

### 1차 수정: semconv 버전 업그레이드

#### 원인

`packages/wealist-advanced-go-pkg/otel/otel.go`에서 사용하는 semconv v1.27.0이 OTel SDK v1.32.0과 호환되지 않음.

```go
// 문제 코드
import semconv "go.opentelemetry.io/otel/semconv/v1.27.0"  // Schema 1.26.0/1.27.0 혼용
```

#### 해결

```go
// 수정
import semconv "go.opentelemetry.io/otel/semconv/v1.32.0"  // Schema 1.32.0 통일
```

#### 결과

배포 후에도 동일 에러 지속 → 2차 원인 발견

---

### 2차 수정: GORM OTel 플러그인 업그레이드

#### 원인

`gorm.io/plugin/opentelemetry v0.1.8`이 내부적으로 OTel SDK v1.19.0 사용 (Schema 1.26.0)

```bash
go mod graph | grep "gorm.io/plugin/opentelemetry@v0.1.8" | grep sdk
# gorm.io/plugin/opentelemetry@v0.1.8 go.opentelemetry.io/otel/sdk@v1.19.0
```

#### 해결

```bash
cd packages/wealist-advanced-go-pkg
go get gorm.io/plugin/opentelemetry@v0.1.16
go mod tidy
```

#### API 변경 적용

v0.1.16에서 `tracing.WithDBName()` 삭제됨:

```go
// 변경 전 (v0.1.8)
opts := []tracing.Option{
    tracing.WithDBName(cfg.DBName),  // ← 삭제됨
}

// 변경 후 (v0.1.16)
opts := []tracing.Option{
    tracing.WithAttributes(attribute.String("db.name", cfg.DBName)),
    tracing.WithDBSystem("postgresql"),
}
```

#### 결과

배포 후에도 동일 에러 지속 → 3차 원인 발견

---

### 3차 수정: resource.Merge() 충돌 해결

#### 원인

`otel.go`의 `newResource()` 함수에서 `resource.Merge()` 사용 시 Schema URL 충돌:

```go
// 문제 코드
func newResource(cfg *Config) (*resource.Resource, error) {
    return resource.Merge(
        resource.Default(),        // ← 내부 Schema URL (다름)
        resource.NewWithAttributes(
            semconv.SchemaURL,     // ← v1.32.0 Schema URL
            // ...
        ),
    )
}
```

`resource.Default()`는 SDK 내부 Schema URL을 사용하고, `resource.NewWithAttributes()`는 semconv.SchemaURL을 사용 → 병합 시 충돌

#### 해결

`resource.New()`로 직접 생성하여 단일 Schema URL 사용:

```go
func newResource(cfg *Config) (*resource.Resource, error) {
    return resource.New(
        context.Background(),
        resource.WithSchemaURL(semconv.SchemaURL),  // 단일 Schema URL
        resource.WithAttributes(
            semconv.ServiceName(cfg.ServiceName),
            semconv.ServiceVersion(cfg.ServiceVersion),
            semconv.DeploymentEnvironmentName(cfg.Environment),
        ),
        resource.WithTelemetrySDK(),
        resource.WithHost(),
        resource.WithOS(),
        resource.WithProcess(),
    )
}
```

---

### 최종 변경 파일

| 파일 | 변경 내용 |
|------|----------|
| `packages/wealist-advanced-go-pkg/go.mod` | GORM 플러그인 v0.1.8 → v0.1.16, redis v9.8.0 → v9.17.2 |
| `packages/wealist-advanced-go-pkg/otel/otel.go` | semconv v1.32.0, resource.New() 사용 |
| `packages/wealist-advanced-go-pkg/otel/gorm.go` | WithDBName → WithAttributes + WithDBSystem |

---

### 버전 호환성 매트릭스

| 패키지 | 이전 버전 | 최종 버전 | 비고 |
|--------|----------|----------|------|
| semconv | v1.27.0 | v1.32.0 | Schema URL 1.32.0 |
| OTel SDK | v1.32.0 | v1.32.0 | 유지 |
| OTel trace | v1.33.0 | v1.39.0 | 자동 업그레이드 |
| GORM OTel Plugin | v0.1.8 | v0.1.16 | SDK v1.32.0 사용 |
| go-redis/redisotel | v9.8.0 | v9.17.2 | 호환성 개선 |

---

### 검증 명령어

```bash
# 로컬 빌드 테스트
for svc in user-service board-service chat-service noti-service storage-service video-service; do
  (cd services/$svc && go build -o /dev/null ./cmd/api) && echo "✅ $svc" || echo "❌ $svc"
done

# 배포 후 로그 확인
kubectl logs deploy/user-service -n wealist-prod | grep -i "otel\|schema"
# "GORM OpenTelemetry tracing enabled" 만 나오면 성공
# "conflicting Schema URL" 에러 없으면 성공

# Tempo에 trace 수신 확인
kubectl logs deploy/tempo -n wealist-prod --tail=20
```

---

### 상태: 🔄 배포 대기 중

3차 수정 완료, CI 빌드 및 배포 필요.

---
