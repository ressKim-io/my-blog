---
title: 8편 - ArgoCD + Helm 실전 문제들
excerpt: GitOps 환경에서 발생하는 ArgoCD와 Helm 관련 문제들. Synced인데 적용 안 됨, OutOfSync 무한 루프, Job 미생성 등 실전 트러블슈팅
category: kubernetes
tags:
  - EKS
  - ArgoCD
  - Helm
  - GitOps
  - HPA
  - Troubleshooting
date: '2025-12-31'
---

## 시리즈 마무리

EKS 트러블슈팅 시리즈의 마지막 편입니다. 이번에는 GitOps의 핵심인 ArgoCD와 Helm 관련 문제들을 다룹니다.

**이전 편 요약**:
- 1편: EKS 첫 배포 D-Day (Redis, SSL, ALB)
- 2-3편: Istio Ambient 모드와 Gateway API
- 4편: External Secrets Operator
- 5-6편: 모니터링 스택 구축
- 7편: Go 서비스 배포 삽질기

---

## 다룰 문제들

| 문제 | 한 줄 요약 | Impact |
|------|-----------|--------|
| db-init Job 미생성 | 템플릿 조건이 Secret 참조를 고려 안 함 | 서비스 기동 불가 |
| ConfigMap 변경 무시 | Synced인데 Pod는 이전 설정 | 설정 적용 안 됨 |
| APIService OutOfSync | Kubernetes가 status 자동 추가 | 무한 Sync 루프 |
| HPA 느린 Scale Down | 기본 설정이 너무 보수적 | 비용 낭비 |
| ESO 기본값 OutOfSync | ESO가 필드 자동 추가 | 무한 Sync 루프 |

---

## 문제 1: db-init Job이 생성되지 않음

### 상황

```
ArgoCD: db-init-prod → Synced, Healthy ✅
실제: Job 생성 안 됨
서비스: "database does not exist" → CrashLoopBackOff
```

ArgoCD는 정상이라고 하는데, DB 초기화 Job이 없어서 서비스들이 전부 죽었습니다.

### 증상

```bash
$ kubectl get jobs -n wealist-prod
No resources found in wealist-prod namespace.

$ kubectl logs deploy/user-service -n wealist-prod
panic: database "wealist_user_db" does not exist
```

### 원인 분석

`k8s/helm/charts/db-init/templates/job.yaml` 첫 줄을 확인했습니다:

```yaml
{{- if .Values.database.host }}
apiVersion: batch/v1
kind: Job
# ...
{{- end }}
```

Production에서는 DB 호스트를 직접 설정하지 않고 `secretRef.hostKey`로 Secret에서 가져옵니다:

```yaml
# k8s/helm/environments/prod.yaml
secretRef:
  enabled: true
  hostKey: DB_HOST
  passwordKey: DB_PASSWORD
```

**문제 정리**:
- 로컬: `database.host` 직접 설정 → Job 생성 O
- Production: `secretRef.hostKey` 사용 → `database.host` 비어있음 → Job 생성 X

### 해결

템플릿 조건 수정:

```yaml
# Before
{{- if .Values.database.host }}

# After
{{- if or .Values.database.host .Values.secretRef.hostKey }}
```

### PreSync Hook 함정

db-init Job은 ArgoCD `PreSync` hook으로 설정되어 있습니다:

```yaml
metadata:
  annotations:
    argocd.argoproj.io/hook: PreSync
    argocd.argoproj.io/hook-delete-policy: BeforeHookCreation
```

**문제**: 이미 Synced 상태인 앱에서는 PreSync hook이 실행되지 않습니다.

```bash
# 강제 Sync 필요
$ kubectl patch application db-init-prod -n argocd \
    --type merge -p '{"operation":{"sync":{}}}'

# 또는 Application 삭제 후 재생성
$ kubectl delete application db-init-prod -n argocd
$ kubectl apply -f k8s/argocd/apps/prod/db-init.yaml
```

### 검증

```bash
$ kubectl get jobs -n wealist-prod
NAME           COMPLETIONS   DURATION   AGE
db-init-prod   6/6           45s        2m

$ kubectl logs job/db-init-prod -n wealist-prod
Creating database wealist_user_db... OK
Creating database wealist_board_db... OK
...
```

---

## 문제 2: ConfigMap 변경해도 Pod에 적용 안 됨

### 상황

```
ArgoCD: storage-service → Synced ✅
ConfigMap: S3_BUCKET 변경됨 ✅
Pod: 여전히 이전 S3_BUCKET 사용 ❌
```

### 증상

```bash
# ConfigMap 확인 - 새 값
$ kubectl get cm storage-service-config -n wealist-prod \
    -o jsonpath='{.data.S3_BUCKET}'
wealist-prod-files-290008131187

# Pod 환경변수 확인 - 이전 값!
$ kubectl exec deploy/storage-service -n wealist-prod -- env | grep S3_BUCKET
S3_BUCKET=wealist-prod-storage
```

수동으로 `kubectl rollout restart`를 해야만 적용됩니다.

### 원인 분석

**Kubernetes는 ConfigMap이 변경되어도 기존 Pod를 재시작하지 않습니다.**

ArgoCD 관점에서:
1. ConfigMap 업데이트 ✅
2. Deployment spec 변경 없음 (image, replicas 동일)
3. "Synced" 상태로 표시 ✅
4. Pod는 재시작되지 않음 ❌

이게 Kubernetes의 정상 동작입니다. ArgoCD 문제가 아닙니다.

### 해결: ConfigMap Checksum Annotation

Deployment의 pod template에 ConfigMap 내용의 해시값을 annotation으로 추가합니다.

```
ConfigMap 변경 → 해시값 변경 → pod template 변경 → rolling update 트리거
```

**1. Helper 함수 추가**:

```yaml
# k8s/helm/charts/wealist-common/templates/_helpers.tpl

{{/*
ConfigMap checksum for triggering pod restart on config change
*/}}
{{- define "wealist-common.configChecksum" -}}
{{- $sharedConfig := .Values.shared.config | default dict | toJson -}}
{{- $serviceConfig := .Values.config | default dict | toJson -}}
{{- printf "%s-%s" $sharedConfig $serviceConfig | sha256sum | trunc 16 -}}
{{- end }}
```

**2. Deployment 템플릿에 annotation 추가**:

```yaml
# 각 서비스의 templates/deployment.yaml
spec:
  template:
    metadata:
      annotations:
        checksum/config: {{ include "wealist-common.configChecksum" . }}
```

### 적용 후 동작

| 변경 유형 | 재시작 범위 |
|----------|------------|
| 서비스 이미지 변경 | 해당 서비스만 |
| `shared.config` 변경 | 모든 Go 서비스 |
| 서비스별 `config` 변경 | 해당 서비스만 |

### 검증

```bash
# Helm 템플릿에서 checksum 확인
$ helm template storage-service k8s/helm/charts/storage-service \
    -f k8s/helm/environments/base.yaml \
    -f k8s/helm/environments/prod.yaml | grep "checksum/config"
        checksum/config: cbc34bf242def090

# ConfigMap 변경 후 checksum이 달라지면 자동 재시작
```

---

## 문제 3: metrics-server OutOfSync 무한 루프

### 상황

```
ArgoCD: metrics-server → OutOfSync (계속)
Sync 눌러도 다시 OutOfSync
```

### 증상

```bash
$ kubectl get application metrics-server -n argocd -o jsonpath='{.status.sync.status}'
OutOfSync

# diff 확인
$ kubectl get application metrics-server -n argocd \
    -o jsonpath='{.status.resources}' | jq '.[] | select(.status == "OutOfSync")'
{
  "group": "apiregistration.k8s.io",
  "kind": "APIService",
  "name": "v1beta1.metrics.k8s.io",
  "status": "OutOfSync"
}
```

### 원인 분석

**Kubernetes가 APIService의 status 필드를 자동 추가합니다**:

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
status:              # ← Kubernetes가 자동 추가!
  conditions:
    - lastTransitionTime: "2025-12-30T..."
      message: all checks passed
      reason: Passed
      status: "True"
      type: Available
```

Git에는 status가 없고, 클러스터에는 있으니 ArgoCD가 계속 차이를 감지합니다.

### 해결

**ignoreDifferences 설정** (Terraform):

```hcl
# terraform/prod/argocd-apps/cluster-addons.tf

resource "kubernetes_manifest" "argocd_app_metrics_server" {
  manifest = {
    apiVersion = "argoproj.io/v1alpha1"
    kind       = "Application"
    metadata = {
      name      = "metrics-server"
      namespace = "argocd"
    }
    spec = {
      # ... 기존 설정
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

### kubectl로 즉시 적용

```bash
$ kubectl patch application metrics-server -n argocd --type=merge -p '{
  "spec": {
    "ignoreDifferences": [
      {
        "group": "apiregistration.k8s.io",
        "kind": "APIService",
        "jsonPointers": ["/status"]
      }
    ]
  }
}'

# 앱 새로고침
$ kubectl patch application metrics-server -n argocd \
    --type merge -p '{"metadata":{"annotations":{"argocd.argoproj.io/refresh":"hard"}}}'
```

### 검증

```bash
$ kubectl get application metrics-server -n argocd -o jsonpath='{.status.sync.status}'
Synced
```

---

## 문제 4: HPA Scale Down이 너무 느림

### 상황

```
트래픽 감소 → 5분 이상 대기 → 그제서야 replica 감소
→ 불필요한 Pod 유지 → 비용 낭비
```

### 증상

```bash
$ kubectl get hpa auth-service-hpa -n wealist-prod
NAME               REFERENCE           TARGETS   MINPODS   MAXPODS   REPLICAS
auth-service-hpa   Deployment/auth     10%/70%   1         10        5

# CPU 10%인데 replicas가 5개... 스케일 다운이 안 됨
```

### 원인 분석

HPA 기본 behavior 설정이 매우 보수적입니다:

```yaml
# 암묵적 기본값
behavior:
  scaleDown:
    stabilizationWindowSeconds: 300  # 5분 대기
    policies:
      - type: Pods
        value: 1                      # 한 번에 1개만 제거
        periodSeconds: 60
    selectPolicy: Min                 # 가장 보수적인 정책 선택
```

5분 대기 후 1분마다 1개씩만 제거. 10개에서 1개로 줄이려면 최소 14분 소요.

### 해결

더 공격적인 스케일 다운 설정:

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

### 설정 비교

| 설정 | 기존 | 변경 | 효과 |
|------|------|------|------|
| `stabilizationWindowSeconds` | 300 (5분) | 120 (2분) | 대기 시간 60% 단축 |
| `policies.Pods.value` | 1 | 2 | 한 번에 2배 더 제거 |
| `selectPolicy` | Min | Max | 더 공격적인 정책 선택 |

### 주의: Helm 구조 제약

**서비스별 autoscaling override는 불가능합니다**:

```yaml
# ❌ 작동하지 않음 (Helm 경로 불일치)
auth-service:
  autoscaling:
    minReplicas: 2  # .Values.auth-service.autoscaling.minReplicas

# ✅ 전역 설정만 적용됨
autoscaling:
  minReplicas: 1  # .Values.autoscaling.minReplicas
```

서비스별 다른 HPA가 필요하면:
- 각 서비스 Helm chart에 별도 autoscaling 블록 정의
- 또는 서비스별 values 파일 분리

---

## 문제 5: ESO가 추가한 필드로 OutOfSync

### 상황

```
ArgoCD: external-secrets-config-prod → OutOfSync (계속)
ExternalSecret은 정상 동작
```

### 증상

```bash
# diff 확인
$ kubectl get application external-secrets-config-prod -n argocd \
    -o jsonpath='{.status.resources}' | jq '.[] | select(.status == "OutOfSync")'
{
  "group": "external-secrets.io",
  "kind": "ExternalSecret",
  "name": "argocd-notifications-secret",
  "status": "OutOfSync"
}
```

### 원인 분석

**ESO가 ExternalSecret에 기본값 필드를 자동 추가합니다**:

```yaml
# Git에 정의된 내용
spec:
  data:
    - remoteRef:
        key: "wealist/prod/notifications/discord"
        property: webhook_url

# 실제 클러스터 상태 (ESO가 기본값 추가)
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

### 해결

**ignoreDifferences에 jqPathExpressions 사용**:

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

### kubectl로 즉시 적용

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

# 새로고침
$ kubectl patch application external-secrets-config-prod -n argocd \
    --type merge -p '{"metadata":{"annotations":{"argocd.argoproj.io/refresh":"hard"}}}'
```

---

## 종합 정리: ArgoCD + Helm 실전 패턴

### OutOfSync 패턴 분류

| 패턴 | 원인 | 해결 |
|------|------|------|
| status 필드 | K8s가 자동 추가 | `jsonPointers: ["/status"]` |
| 기본값 필드 | Operator가 자동 추가 | `jqPathExpressions` |
| lastApplied | kubectl이 추가 | managedFieldsExceptions |
| 시간 필드 | 매번 달라짐 | 해당 필드 ignore |

### Synced인데 적용 안 됨 패턴

| 상황 | 원인 | 해결 |
|------|------|------|
| ConfigMap 변경 | Pod 재시작 안 됨 | checksum annotation |
| Secret 변경 | Pod 재시작 안 됨 | checksum annotation |
| PreSync Hook | 이미 Synced 상태 | 강제 Sync 또는 App 삭제 |

### Helm 템플릿 주의사항

```yaml
# 여러 조건을 고려해야 함
{{- if or .Values.database.host .Values.secretRef.hostKey }}

# 기본값과 override 구조 명확히
{{- $dbUser := .Values.shared.config.DB_USER | default .Values.config.DB_USER | default "" }}

# checksum은 모든 config 소스 포함
{{- $all := printf "%s-%s" ($shared | toJson) ($service | toJson) }}
```

---

## 스스로에게 던지는 질문

### Q1. OutOfSync가 계속 발생하면?
```
1. 무엇이 diff인지 확인: kubectl get app -o jsonpath='{.status.resources}'
2. K8s가 추가하는 필드인지, Operator가 추가하는 필드인지 판단
3. 적절한 ignoreDifferences 패턴 적용
   - status 필드: jsonPointers
   - 중첩 배열: jqPathExpressions
```

### Q2. ConfigMap 변경이 Pod에 적용 안 되면?
```
1. Kubernetes 정상 동작임을 인지
2. Deployment에 checksum annotation 추가
3. 또는 Reloader 같은 도구 사용 고려
4. 임시: kubectl rollout restart
```

### Q3. PreSync Hook Job이 실행 안 되면?
```
1. Application이 이미 Synced 상태인지 확인
2. 강제 Sync: kubectl patch application ... '{"operation":{"sync":{}}}'
3. 또는 Application 삭제 후 재생성
4. hook-delete-policy 설정 확인
```

### Q4. HPA가 너무 느리거나 빠르면?
```
1. behavior 설정 확인
2. stabilizationWindowSeconds 조정
3. policies의 type, value, periodSeconds 조정
4. selectPolicy (Min/Max) 확인
5. 서비스별 설정이 필요하면 Chart 구조 수정
```

---

## 시리즈를 마치며

8편에 걸쳐 EKS Production 트러블슈팅 경험을 정리했습니다.

### 주요 교훈

1. **Error 메시지를 정확히 읽자**
   - 대부분의 해결책은 에러 메시지에 힌트가 있음

2. **"정상 동작"을 의심하자**
   - Synced인데 적용 안 됨 = Kubernetes 정상 동작
   - OutOfSync 무한 루프 = ArgoCD 정상 동작

3. **레이어를 구분하자**
   - K8s 문제 vs Helm 문제 vs ArgoCD 문제
   - 각 레이어의 책임 범위 이해

4. **자동화 도구의 한계를 인지하자**
   - GitOps가 모든 것을 해결하지 않음
   - 수동 개입이 필요한 상황 존재

### 참고 자료

- [ArgoCD ignoreDifferences 공식 문서](https://argo-cd.readthedocs.io/en/stable/user-guide/diffing/)
- [Kubernetes HPA Behavior 공식 문서](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/#configurable-scaling-behavior)
- [Helm Named Templates](https://helm.sh/docs/chart_template_guide/named_templates/)

---

*이 시리즈가 EKS Production 환경을 운영하시는 분들께 도움이 되길 바랍니다.*
