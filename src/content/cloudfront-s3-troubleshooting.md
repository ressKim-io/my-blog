---
title: "Storage 페이지가 HTML을 반환한다: 3층 원인 분석"
excerpt: "CloudFront S3 Fallback, HTTPRoute URL Rewrite, ArgoCD 설정 불일치까지 복합적인 문제를 해결한 기록"
category: kubernetes
tags:
  - EKS
  - CloudFront
  - S3
  - Troubleshooting
  - Istio
  - ArgoCD
series:
  name: "eks-infra"
  order: 1
date: '2026-01-02'
---

## 한 줄 요약

> Storage API가 JSON 대신 HTML을 반환한다. CloudFront 403 fallback이 1차, HTTPRoute 리라이트가 2차, ArgoCD 설정 불일치가 3차 원인. 3층까지 파고들어야 근본 원인을 찾았다.

## Impact

- **영향 범위**: 저장소(Storage) 기능 전체
- **증상**: 파일 목록 조회 실패
- **소요 시간**: 약 5시간
- **발생일**: 2026-01-02

---

## 🔥 증상: API가 HTML을 반환한다

### 에러 메시지

```
Cannot read properties of undefined (reading 'children')
```

### 네트워크 분석

브라우저 개발자 도구를 열어봤습니다:

```
Request: /api/svc/storage/storage/folders/contents
Response Headers:
  server: AmazonS3
  x-cache: Error from cloudfront
  content-type: text/html  ← JSON이어야 하는데!
```

API 응답이 JSON이 아니라 **S3의 index.html**이었습니다.

---

## 🤔 1차 원인: CloudFront Custom Error Response

### 발견

CloudFront 설정을 확인해봤습니다:

```
Custom Error Response:
  - HTTP Error Code: 403
    Response Page Path: /index.html
    HTTP Response Code: 200
```

CloudFront가 403/404 에러를 받으면 S3의 `index.html`로 fallback하도록 설정되어 있었습니다. 이건 SPA(Single Page Application) 라우팅을 위한 일반적인 설정입니다.

### 문제

```
storage-service가 404 반환
    ↓
CloudFront가 403/404 감지
    ↓
S3의 index.html로 fallback
    ↓
클라이언트가 HTML 수신
```

그런데 왜 storage-service가 404를 반환했을까요?

---

## 🤔 2차 원인: HTTPRoute URL Rewrite 불일치

### 요청 경로 추적

클라이언트 요청:
```
/api/svc/storage/storage/folders/contents
```

HTTPRoute 리라이트 규칙:
```yaml
# HTTPRoute 설정
matches:
  - path:
      value: /api/svc/storage
rules:
  - filters:
      - type: URLRewrite
        urlRewrite:
          path:
            replacePrefixMatch: /  # prefix strip
```

실제 storage-service가 받은 경로:
```
/storage/folders/contents
```

### 문제 발견

storage-service의 라우터 설정을 확인했습니다:

```go
// router.go
api := r.Group(cfg.BasePath)  // BasePath = "/api"
storage := api.Group("/storage")
// 등록된 경로: /api/storage/folders/contents
```

| 구분 | 경로 |
|------|------|
| 요청된 경로 | `/storage/folders/contents` |
| 등록된 경로 | `/api/storage/folders/contents` |
| 결과 | **404 Not Found** |

HTTPRoute가 prefix를 strip 했는데, 서비스는 아직 `/api` prefix를 기대하고 있었습니다.

그런데 왜 `BasePath`가 `/api`로 설정되어 있었을까요?

---

## 🤔 3차 원인 (근본): ArgoCD와 prod.yaml 불일치

### 설정 확인

`prod.yaml`을 확인해봤습니다:

```yaml
# k8s/helm/environments/prod.yaml
storage-service:
  config:
    SERVER_BASE_PATH: ""  # 빈 문자열로 설정했는데?
```

분명히 빈 문자열로 설정했는데, 왜 적용이 안 됐을까요?

### ArgoCD Application 확인

```yaml
# k8s/argocd/apps/prod/storage-service.yaml
spec:
  source:
    helm:
      valueFiles:
        - values.yaml
        - ../../environments/base.yaml
        - ../../environments/prod.yaml
      parameters:
        - name: config.DB_NAME
          value: "storage_db"
        # SERVER_BASE_PATH 없음!
```

### 문제의 원인

ArgoCD가 단일 Helm 차트를 배포할 때, `prod.yaml`의 **서비스별 키 아래 값**은 Helm에 전달되지 않았습니다.

```yaml
# prod.yaml 구조
storage-service:       # ← 이 키 아래 값은 umbrella chart용
  config:
    SERVER_BASE_PATH: "" # ← 단일 차트 배포에서는 무시됨
```

Helm은 **TOP level 값만** 읽습니다. `storage-service.config.XXX` 형태는 umbrella chart(여러 서브차트를 묶는 차트)에서 사용하는 구조입니다.

**3층 원인 구조:**

![3-Layer Root Cause Analysis|short](/images/cloudfront-s3/cloudfront-3layer-cause.svg)

---

## ✅ 해결 방법

### Step 1: Go 코드 수정 - 빈 문자열 허용

기존 코드는 빈 문자열을 무시했습니다:

```go
// Before (빈 문자열 무시)
if basePath := os.Getenv("SERVER_BASE_PATH"); basePath != "" {
    c.Server.BasePath = basePath
}

// After (빈 문자열 허용)
if basePath, ok := os.LookupEnv("SERVER_BASE_PATH"); ok {
    c.Server.BasePath = basePath
}
```

**os.Getenv vs os.LookupEnv:**

| 함수 | 미설정 | 빈 문자열 설정 |
|------|--------|----------------|
| `os.Getenv` | `""` 반환 | `""` 반환 |
| `os.LookupEnv` | `"", false` | `"", true` |

`os.LookupEnv`를 사용하면 "환경변수가 설정되지 않음"과 "빈 문자열로 설정됨"을 구분할 수 있습니다.

### Step 2: ArgoCD Application에 파라미터 추가

```yaml
# k8s/argocd/apps/prod/storage-service.yaml
parameters:
  - name: config.DB_NAME
    value: "storage_db"
  - name: config.SERVER_BASE_PATH
    value: ""  # 빈 문자열 명시
```

### Step 3: 설정 관리 원칙 정립

**문제**: `prod.yaml`의 서비스별 config와 ArgoCD parameters가 중복되어 불일치 발생

**해결 원칙**: 서비스별 config는 ArgoCD Application `parameters`에서만 관리

```yaml
# prod.yaml - 이렇게 하지 말 것
storage-service:
  config:
    DB_NAME: "storage_db"       # Helm에 전달 안 됨!
    SERVER_BASE_PATH: ""

# ArgoCD Application - 이렇게 할 것
parameters:
  - name: config.DB_NAME
    value: "storage_db"
  - name: config.SERVER_BASE_PATH
    value: ""
```

---

## 🔥 추가 문제: S3 Presigned URL에 minioadmin 자격증명

Storage 경로 문제를 해결하고 나니 새로운 문제가 발생했습니다.

### 증상

```
파일 업로드 실패: net::ERR_FAILED

Presigned URL:
https://cdn.wealist.co.kr/.../file.pdf
  ?X-Amz-Credential=minioadmin/20260102/...
                    ^^^^^^^^^^
                    MinIO 개발용 자격증명!
```

Production에서 **minioadmin** 자격증명이 사용되고 있었습니다.

### 원인

Docker 이미지에 개발용 config 파일이 포함되어 있었습니다:

```yaml
# configs/config.yaml (이미지에 포함됨)
s3:
  access_key: "minioadmin"    # 개발용!
  secret_key: "minioadmin"
  endpoint: "http://localhost:9000"
```

환경변수 오버라이드가 실패한 이유:

```go
// Before
if s3Endpoint := os.Getenv("S3_ENDPOINT"); s3Endpoint != "" {
    c.S3.Endpoint = s3Endpoint
}
```

Production 환경에서 `S3_ENDPOINT=""`(빈 문자열)로 설정했지만, `!= ""` 조건 때문에 오버라이드되지 않았습니다.

### 해결

```go
// After - os.LookupEnv 사용
if s3Endpoint, ok := os.LookupEnv("S3_ENDPOINT"); ok {
    c.S3.Endpoint = s3Endpoint
}
if s3AccessKey, ok := os.LookupEnv("S3_ACCESS_KEY"); ok {
    c.S3.AccessKey = s3AccessKey
}
```

```yaml
# prod.yaml
# 빈 값으로 설정하여 config.yaml 기본값 오버라이드
# 빈 값이면 AWS SDK가 IAM Role (IRSA) 자격증명을 자동으로 사용
S3_ENDPOINT: ""      # AWS S3 기본 엔드포인트
S3_ACCESS_KEY: ""    # IAM Role 사용
S3_SECRET_KEY: ""    # IAM Role 사용
```

### S3 클라이언트 분기 로직

```go
if cfg.Endpoint != "" {
    // MinIO mode: Static credentials 사용
    awsCfg, err = config.LoadDefaultConfig(ctx,
        config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
            cfg.AccessKey,  // minioadmin
            cfg.SecretKey,
            "",
        )),
    )
} else {
    // AWS S3 mode: IAM Role (IRSA) 자동 사용
    awsCfg, err = config.LoadDefaultConfig(ctx,
        config.WithRegion(cfg.Region),
    )
}
```

빈 문자열로 `Endpoint`를 오버라이드하면 AWS S3 모드로 동작하고, IAM Role을 자동으로 사용합니다.

---

## 검증

```bash
# ConfigMap 확인
kubectl get configmap storage-service-config -n wealist-prod -o yaml | grep SERVER_BASE_PATH

# Pod 환경변수 확인
kubectl exec deploy/storage-service -n wealist-prod -- env | grep -E "SERVER_BASE_PATH|S3_"

# API 테스트
curl "https://api.wealist.co.kr/api/svc/storage/storage/folders/contents?workspaceId=test"
# JSON 응답이어야 함
```

---

## 📚 배운 점

### HTTPRoute URL Rewrite 패턴

```
클라이언트 요청: /api/svc/storage/storage/folders/contents
                     ↓
HTTPRoute 리라이트: /api/svc/storage/* → /*
                     ↓
storage-service 수신: /storage/folders/contents
                     ↓
라우터 매칭: BasePath="" + "/storage" + "/folders" + "/contents"
```

**BasePath 설정 원칙:**
- HTTPRoute가 prefix를 strip하면 → 서비스의 BasePath는 빈 문자열 `""`
- HTTPRoute가 그대로 전달하면 → 서비스의 BasePath 유지

### os.LookupEnv가 필요한 경우

Docker 이미지에 개발용 config가 포함되어 있을 때, Production에서 IAM Role을 사용하려면 환경변수로 **빈 문자열을 명시적으로 설정**해야 합니다.

```go
// os.Getenv - 빈 값 설정해도 오버라이드 안 됨
if val := os.Getenv("KEY"); val != "" { ... }

// os.LookupEnv - 빈 값도 명시적 설정으로 인식
if val, ok := os.LookupEnv("KEY"); ok { ... }
```

### ArgoCD 단일 차트 배포 시 주의점

`prod.yaml`의 서비스별 키 아래 값은 Helm에 전달되지 않습니다.

```yaml
# 이렇게 하면 안 됨 (umbrella chart용 구조)
storage-service:
  config:
    MY_VAR: "value"  # 무시됨!

# ArgoCD Application parameters로 직접 지정해야 함
parameters:
  - name: config.MY_VAR
    value: "value"
```

---

## 요약

| 층 | 원인 | 해결 |
|----|------|------|
| 1층 | CloudFront 403 → HTML fallback | 근본 원인 해결로 자동 해결 |
| 2층 | HTTPRoute 리라이트 후 경로 불일치 | BasePath를 빈 문자열로 설정 |
| 3층 | ArgoCD parameters에 설정 누락 | parameters에 명시적 추가 |
| 추가 | minioadmin 자격증명 사용 | os.LookupEnv + 빈 문자열 오버라이드 |

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `services/storage-service/internal/config/config.go` | 환경변수 처리 |
| `k8s/argocd/apps/prod/storage-service.yaml` | ArgoCD Application |
| `k8s/helm/environments/prod.yaml` | 환경별 설정 |

---

## 참고

- [Istio HTTPRoute URL Rewrite](https://istio.io/latest/docs/reference/config/networking/virtual-service/#HTTPRewrite)
- [AWS S3 SDK Credential Chain](https://docs.aws.amazon.com/sdk-for-go/v1/developer-guide/configuring-sdk.html)
- [CloudFront Custom Error Response](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/custom-error-pages.html)
