# Production 트러블슈팅 V6 (2026-01-02)

## 1. Storage 페이지 에러 - CloudFront S3 Fallback

### 1.1 문제 증상

- **현상**: wealist.co.kr 저장소 페이지 접속 시 에러
- **에러 메시지**: `Cannot read properties of undefined (reading 'children')`
- **네트워크**: `/api/svc/storage/storage/folders/contents` 요청이 HTML 반환

```
Response Headers:
  server: AmazonS3
  x-cache: Error from cloudfront
  content-type: text/html  ← JSON이어야 함
```

### 1.2 원인 분석

#### 1차 원인: CloudFront Custom Error Response
- CloudFront가 403/404 에러 시 S3의 `index.html`로 fallback
- storage-service가 404 반환 → CloudFront가 HTML로 대체

#### 2차 원인: storage-service 404 반환
- 요청 경로: `/api/svc/storage/storage/folders/contents`
- HTTPRoute 리라이트: `/api/svc/storage/*` → `/*`
- 실제 전달 경로: `/storage/folders/contents`

**문제**: storage-service의 BasePath가 `/api`로 설정되어 있어서 `/api/storage/folders/contents`를 기대함

```go
// router.go
api := r.Group(cfg.BasePath)  // BasePath = "/api"
storage := api.Group("/storage")
// 실제 등록된 경로: /api/storage/folders/contents
// 요청된 경로: /storage/folders/contents → 404!
```

#### 3차 원인 (근본): ArgoCD와 prod.yaml 불일치

```yaml
# prod.yaml (Helm에 전달되지 않음!)
storage-service:
  config:
    SERVER_BASE_PATH: ""  ← 이 값이 무시됨

# ArgoCD Application (실제 적용)
parameters:
  - name: config.DB_NAME
    value: "storage_db"
  # SERVER_BASE_PATH 없음!
```

**이유**: ArgoCD가 단일 차트 배포 시 `prod.yaml`의 `storage-service:` 키 아래 값을 읽지 못함. Helm은 TOP level 값만 읽음.

### 1.3 해결 방법

#### Step 1: Go 코드 수정 - 빈 문자열 허용

`services/storage-service/internal/config/config.go`:

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

#### Step 2: ArgoCD Application에 파라미터 추가

`k8s/argocd/apps/prod/storage-service.yaml`:

```yaml
parameters:
  - name: config.DB_NAME
    value: "storage_db"
  - name: config.SERVER_BASE_PATH
    value: ""  # Istio HTTPRoute 리라이트 호환
```

#### Step 3 (근본적 해결): 구조 정리

**문제**: `prod.yaml`의 서비스별 config와 ArgoCD parameters가 중복되어 불일치 발생

**해결**:
1. `prod.yaml`에서 서비스별 `config:` 섹션 제거
2. 모든 서비스별 config를 ArgoCD Application `parameters`에서만 관리

```yaml
# prod.yaml - Before
storage-service:
  replicaCount: 1
  config:
    DB_NAME: "storage_db"
    SERVER_BASE_PATH: ""  # Helm에 전달 안 됨!

# prod.yaml - After
storage-service:
  replicaCount: 1
  # config는 ArgoCD Application parameters에서 관리
```

### 1.4 영향받은 파일

| 파일 | 변경 내용 |
|------|----------|
| `services/storage-service/internal/config/config.go` | `os.LookupEnv` 사용 |
| `k8s/argocd/apps/prod/storage-service.yaml` | `SERVER_BASE_PATH` 파라미터 추가 |
| `k8s/argocd/apps/prod/*.yaml` (7개) | 주석 추가 |
| `k8s/helm/environments/prod.yaml` | 서비스별 config 제거 |
| `CLAUDE.md` | Important Notes #20 추가 |

### 1.5 배포 순서

1. **Go 코드 변경**: CI 자동 배포 (service deploy)
2. **ArgoCD/Helm 변경**: k8s-deploy-prod 브랜치에 머지 → ArgoCD 자동 Sync

```bash
# 플로우
main → prod → k8s-deploy-prod → ArgoCD Sync → ConfigMap 업데이트 → Pod 재시작
```

### 1.6 검증

```bash
# ConfigMap 확인
kubectl get configmap storage-service-config -n wealist-prod -o yaml | grep SERVER_BASE_PATH

# Pod 환경변수 확인
kubectl exec deploy/storage-service -n wealist-prod -- env | grep SERVER_BASE_PATH

# API 테스트
curl "https://api.wealist.co.kr/api/svc/storage/storage/folders/contents?workspaceId=test"
```

### 1.7 교훈

> **Important Notes #20**: `prod.yaml`의 서비스별 config는 Helm에 전달되지 않음.
> 반드시 ArgoCD Application의 `parameters`에서 관리 (`k8s/argocd/apps/prod/{service}.yaml`)

**왜 발생했나?**
- ArgoCD가 단일 Helm 차트를 배포할 때 `valueFiles`로 `prod.yaml`을 참조
- 하지만 Helm은 TOP level 값만 읽음
- `prod.yaml`의 `storage-service.config.XXX`는 umbrella chart용 구조
- 단일 차트 배포에서는 `parameters`로 명시적 오버라이드 필요

---

## 2. 추가 참고사항

### 2.1 HTTPRoute URL Rewrite 패턴

Production 환경의 API 라우팅:

```
클라이언트 요청: /api/svc/storage/storage/folders/contents
                     ↓
HTTPRoute 리라이트: /api/svc/storage/* → /*
                     ↓
storage-service 수신: /storage/folders/contents
                     ↓
라우터 매칭: BasePath="" + "/storage" + "/folders" + "/contents"
```

**BasePath 설정 원칙**:
- HTTPRoute가 prefix를 strip하면 서비스의 BasePath는 빈 문자열 `""`
- HTTPRoute가 그대로 전달하면 서비스의 BasePath 유지

### 2.2 다른 서비스 확인

현재 모든 Go 서비스가 HTTPRoute로 prefix strip됨:
- `/api/svc/user/*` → `/*` (user-service)
- `/api/svc/board/*` → `/*` (board-service)
- 등등...

하지만 대부분의 서비스는 `/api/*` 경로를 사용하므로 BasePath `/api`가 맞음.
storage-service만 `/storage/*` 경로를 직접 노출해서 BasePath `""`가 필요했음.

---

## 3. Storage 파일 업로드 실패 - S3 Presigned URL 자격증명

### 3.1 문제 증상

- **현상**: 파일 업로드 시 `net::ERR_FAILED` 에러
- **네트워크**: Presigned URL에 `minioadmin` 자격증명 포함

```
URL: https://cdn.wealist.co.kr/wealist-prod-files.../file.pdf
     ?X-Amz-Credential=minioadmin/20260102/ap-northeast-2/s3/aws4_request
                       ^^^^^^^^^^
                       MinIO 개발용 자격증명이 Production에서 사용됨!
```

### 3.2 원인 분석

#### 문제: Docker 이미지에 개발용 config 파일 포함

storage-service Docker 이미지의 `configs/config.yaml`:

```yaml
s3:
  bucket: "wealist-dev-files"
  region: "ap-northeast-2"
  access_key: "minioadmin"    # ← 개발용!
  secret_key: "minioadmin"    # ← 개발용!
  endpoint: "http://localhost:9000"
  public_endpoint: "http://localhost:9000"
```

#### 환경변수 오버라이드 실패

```go
// Before: 빈 문자열이면 오버라이드 안 됨
if s3Endpoint := os.Getenv("S3_ENDPOINT"); s3Endpoint != "" {
    c.S3.Endpoint = s3Endpoint
}
```

Production에서:
- `S3_ENDPOINT=""` (빈 문자열)
- 조건 `!= ""` 실패 → config 파일의 `http://localhost:9000` 유지
- `cfg.Endpoint != ""` → MinIO 모드로 동작 → `minioadmin` 사용

### 3.3 해결 방법

#### Step 1: Go 코드 수정 - os.LookupEnv 사용

`services/storage-service/internal/config/config.go`:

```go
// S3_ACCESS_KEY, S3_SECRET_KEY, S3_ENDPOINT: 빈 문자열도 허용
// AWS IAM role (IRSA) 사용 시 빈 값으로 override 필요
if s3AccessKey, ok := os.LookupEnv("S3_ACCESS_KEY"); ok {
    c.S3.AccessKey = s3AccessKey
}
if s3SecretKey, ok := os.LookupEnv("S3_SECRET_KEY"); ok {
    c.S3.SecretKey = s3SecretKey
}
if s3Endpoint, ok := os.LookupEnv("S3_ENDPOINT"); ok {
    c.S3.Endpoint = s3Endpoint
}
```

#### Step 2: prod.yaml에 빈 값 명시

`k8s/helm/environments/prod.yaml`:

```yaml
# S3 Configuration (AWS S3 - Terraform: wealist-prod-storage)
# 빈 값으로 설정하여 config.yaml 기본값 오버라이드
# 빈 값이면 AWS SDK가 IAM Role (IRSA) 자격증명을 자동으로 사용
S3_ENDPOINT: ""      # 빈 값 = AWS S3 기본 엔드포인트 사용
S3_ACCESS_KEY: ""    # 빈 값 = IAM Role 사용 (IRSA)
S3_SECRET_KEY: ""    # 빈 값 = IAM Role 사용 (IRSA)
S3_PUBLIC_ENDPOINT: "https://cdn.wealist.co.kr"
S3_BUCKET: "wealist-prod-files-290008131187"
S3_REGION: "ap-northeast-2"
```

### 3.4 영향받은 파일

| 파일 | 변경 내용 |
|------|----------|
| `services/storage-service/internal/config/config.go` | S3 관련 환경변수에 `os.LookupEnv` 사용 |
| `k8s/helm/environments/prod.yaml` | `S3_ACCESS_KEY`, `S3_SECRET_KEY` 빈 값 추가 |

### 3.5 S3 클라이언트 동작 원리

`s3_client.go`의 분기 로직:

```go
if cfg.Endpoint != "" {
    // MinIO mode: Static credentials 사용
    awsCfg, err = config.LoadDefaultConfig(ctx,
        config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
            cfg.AccessKey,  // minioadmin
            cfg.SecretKey,
            "",
        )),
        // endpoint resolver...
    )
} else {
    // AWS S3 mode: IAM Role (IRSA) 자동 사용
    awsCfg, err = config.LoadDefaultConfig(ctx,
        config.WithRegion(cfg.Region),
    )
}
```

### 3.6 교훈

> **중요**: Docker 이미지에 개발용 config 파일이 포함되어 있을 수 있음.
> Production에서 IAM Role을 사용하려면 환경변수로 **빈 문자열을 명시적으로 설정**해야 함.

**os.Getenv vs os.LookupEnv:**
- `os.Getenv`: 빈 문자열과 미설정을 구분 못함
- `os.LookupEnv`: 미설정(false)과 빈 문자열(true, "")을 구분

```go
// os.Getenv - 빈 값 설정해도 오버라이드 안 됨
if val := os.Getenv("KEY"); val != "" { ... }

// os.LookupEnv - 빈 값도 명시적 설정으로 인식
if val, ok := os.LookupEnv("KEY"); ok { ... }
```

---

## 4. WebSocket 재연결 시 토큰 갱신 실패

### 4.1 문제 증상

- **현상**: 채팅 전송 버튼이 동작하지 않음
- **콘솔 로그**: WebSocket 연결 실패 후 5회 재시도 모두 실패

```
🔌 [Chat WS] 연결 시도: wss://wealist.co.kr/api/svc/chat/...?token=eyJ...
❌ WebSocket connection failed
🔌 [Chat WS] 연결 닫힘: 1006
🔄 [Chat WS] 재연결 시도 1/5...
🔌 [Chat WS] 연결 시도: wss://...?token=eyJ...  ← 같은 만료된 토큰!
❌ WebSocket connection failed
...
❌ [Chat WS] 최대 재연결 시도 초과
```

### 4.2 원인 분석

#### JWT 토큰 만료
```json
{
  "sub": "b0395e6e-...",
  "iat": 1767329009,
  "exp": 1767330809,  // 만료됨 (약 30분 전)
  "type": "access"
}
```

#### WebSocket은 Axios 인터셉터 미적용

Axios 클라이언트는 401 응답 시 자동으로 `refreshAccessToken()` 호출:
```javascript
// apiConfig.ts - Axios 인터셉터
client.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (status === 401 && !originalRequest._retry) {
      const newToken = await refreshAccessToken();  // ✅ 자동 갱신
      // ...
    }
  }
);
```

하지만 **WebSocket은 Axios를 사용하지 않음**:
```javascript
// chatWebsocket.ts - Before (문제)
ws.onclose = (event) => {
  if (event.code !== 1000) {
    setTimeout(connect, 3000);  // ❌ 만료된 토큰으로 재시도
  }
};
```

### 4.3 해결 방법

#### WebSocket 재연결 전 토큰 갱신 추가

`services/frontend/src/utils/chatWebsocket.ts`:
```javascript
import { getChatWebSocketUrl, refreshAccessToken } from '../api/apiConfig';

ws.onclose = async (event) => {
  if (event.code !== 1000 && reconnectAttempts < maxReconnectAttempts) {
    reconnectAttempts++;

    // 🔥 재연결 전 토큰 갱신 시도
    try {
      console.log('🔄 [Chat WS] 토큰 갱신 시도...');
      await refreshAccessToken();
      console.log('✅ [Chat WS] 토큰 갱신 성공');
    } catch (error) {
      console.error('❌ [Chat WS] 토큰 갱신 실패, 재연결 중단');
      return;  // 갱신 실패 시 로그아웃 처리됨
    }

    setTimeout(connect, reconnectDelay);
  }
};
```

### 4.4 영향받은 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/api/apiConfig.ts` | `refreshAccessToken` 함수 export 추가 |
| `src/utils/chatWebsocket.ts` | 재연결 전 토큰 갱신 로직 추가 |
| `src/utils/boardWebsocket.ts` | 재연결 전 토큰 갱신 로직 추가 |
| `src/utils/presenceWebsocket.ts` | 재연결 전 토큰 갱신 로직 추가 |

### 4.5 WebSocket 인증 모범 사례

| 방식 | 설명 | 장단점 |
|------|------|--------|
| Query String Token | URL에 토큰 포함 | 간단하지만 로그에 노출 |
| First Message Auth | 연결 후 첫 메시지로 인증 | 안전하지만 추가 핸드셰이크 |
| Cookie (httpOnly) | 브라우저가 자동 전송 | XSS 방어, CORS 복잡 |

**핵심 원칙**:
1. 재연결 시 반드시 토큰 갱신 시도
2. 401 에러와 네트워크 에러 구분 처리
3. 갱신 실패 시 graceful logout

### 4.6 교훈

> **WebSocket은 Axios 인터셉터가 적용되지 않음**.
> 재연결 로직에서 직접 `refreshAccessToken()` 호출 필요.

**증상 패턴**:
- WebSocket 연결 실패 후 동일 에러로 계속 재시도
- 콘솔에 같은 토큰으로 5회 연속 실패 로그
- HTTP API는 정상 동작 (Axios 인터셉터 덕분)

---

## 5. LiveKit WebRTC SFU 서버 EKS 배포

### 5.1 개요

- **목적**: video-service가 사용하는 LiveKit 서버를 EKS Production에 배포
- **날짜**: 2026-01-03

### 5.2 ArgoCD Application sourceRepos 오류

#### 문제 증상

```
ArgoCD Application Status: Unknown
Error: application repo https://helm.livekit.io is not permitted in project 'wealist-prod'
```

#### 원인 분석

ArgoCD AppProject의 `sourceRepos`에 LiveKit Helm repo가 허용되지 않음.

```yaml
# wealist-prod AppProject
spec:
  sourceRepos:
    - "https://github.com/OrangesCloud/wealist-project-advanced-k8s.git"
    - "https://aws.github.io/eks-charts"
    # ... 기존 Helm repos
    # helm.livekit.io 없음!
```

#### 해결 방법

`k8s/argocd/projects/wealist-prod.yaml`에 LiveKit Helm repo 추가:

```yaml
sourceRepos:
  # ... 기존 repos
  # LiveKit WebRTC SFU Server
  - "https://helm.livekit.io"
```

**주의**: AppProject가 ArgoCD에 의해 관리됨 (`argocd.argoproj.io/instance: argocd-config` 라벨).
Git에 변경사항 푸시 후 ArgoCD가 자동 Sync해야 적용됨.

### 5.3 LiveKit API Keys 설정

#### 문제 증상

LiveKit Helm Chart는 `livekit.keys` 또는 `storeKeysInSecret`으로 API 키를 설정해야 함.
일반적인 환경변수 (`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`)로는 작동하지 않음.

#### 해결 방법

##### Step 1: AWS Secrets Manager에 키 생성

```bash
# LiveKit API Key/Secret 생성
LIVEKIT_API_KEY="API$(openssl rand -hex 8)"
LIVEKIT_API_SECRET=$(openssl rand -base64 32 | tr -d '/+=' | head -c 40)

# AWS Secrets Manager에 저장
aws secretsmanager put-secret-value \
  --secret-id wealist/prod/livekit/credentials \
  --secret-string "{\"api_key\":\"$LIVEKIT_API_KEY\",\"api_secret\":\"$LIVEKIT_API_SECRET\"}"
```

##### Step 2: ExternalSecret으로 keys.yaml 형식 생성

LiveKit Helm Chart는 `keys.yaml` 파일 형식을 기대함:
```yaml
API_KEY: API_SECRET
```

`k8s/argocd/base/external-secrets/external-secret-livekit.yaml`:

```yaml
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: wealist-livekit-keys
  namespace: wealist-prod
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-manager
    kind: ClusterSecretStore
  target:
    name: wealist-livekit-keys
    creationPolicy: Owner
    template:
      type: Opaque
      data:
        keys.yaml: |
          {{ .api_key }}: {{ .api_secret }}
  data:
    - secretKey: api_key
      remoteRef:
        key: "wealist/prod/livekit/credentials"
        property: api_key
    - secretKey: api_secret
      remoteRef:
        key: "wealist/prod/livekit/credentials"
        property: api_secret
```

##### Step 3: livekit.yaml에서 existingSecret 참조

```yaml
helm:
  valuesObject:
    storeKeysInSecret:
      enabled: true
      existingSecret: wealist-livekit-keys
```

### 5.4 Redis 설정 환경변수 확장

#### 문제 증상

YAML에서 `$(REDIS_HOST)` 형식은 환경변수 확장이 안 됨.

```yaml
# 작동 안 함!
redis:
  address: "$(REDIS_HOST):6379"
```

#### 해결 방법

LiveKit은 `${VAR}` 형식의 환경변수 확장을 지원:

```yaml
redis:
  address: "${REDIS_HOST}:6379"
  use_tls: true
```

`envFrom`으로 `wealist-shared-secret`을 마운트하면 `REDIS_HOST` 환경변수 사용 가능.

### 5.5 전체 구성 파일

#### livekit.yaml (ArgoCD Application)

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: livekit-prod
  namespace: argocd
  annotations:
    argocd.argoproj.io/sync-wave: "2"
spec:
  project: wealist-prod
  source:
    repoURL: https://helm.livekit.io
    chart: livekit-server
    targetRevision: "1.7.2"
    helm:
      valuesObject:
        replicaCount: 1
        hostNetwork: true
        terminationGracePeriodSeconds: 18000

        storeKeysInSecret:
          enabled: true
          existingSecret: wealist-livekit-keys

        livekit:
          log_level: info
          rtc:
            use_external_ip: true
            port_range_start: 50000
            port_range_end: 60000
            tcp_port: 7881
          redis:
            address: "${REDIS_HOST}:6379"
            use_tls: true
          room:
            empty_timeout: 300
            max_participants: 100

        service:
          type: ClusterIP
          port: 7880

        envFrom:
          - secretRef:
              name: wealist-shared-secret

        turn:
          enabled: false
  destination:
    server: https://kubernetes.default.svc
    namespace: wealist-prod
```

### 5.6 EKS Security Group 설정

WebRTC UDP 트래픽을 위한 Security Group 규칙 추가 필요.

`terraform/prod/compute/eks.tf`:

```hcl
node_security_group_additional_rules = {
  # LiveKit WebRTC UDP (media traffic)
  livekit_webrtc_udp_ingress = {
    description = "LiveKit WebRTC UDP (media traffic)"
    protocol    = "udp"
    from_port   = 50000
    to_port     = 60000
    type        = "ingress"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # WebRTC TCP fallback
  livekit_webrtc_tcp_ingress = {
    description = "LiveKit WebRTC TCP fallback"
    protocol    = "tcp"
    from_port   = 7881
    to_port     = 7881
    type        = "ingress"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
```

### 5.7 배포 순서

1. **AWS Secrets Manager**: LiveKit API 키 생성 ✅
2. **Git 커밋**:
   - `k8s/argocd/projects/wealist-prod.yaml` - helm.livekit.io 추가
   - `k8s/argocd/apps/prod/livekit.yaml` - 새 ArgoCD Application
   - `k8s/argocd/base/external-secrets/external-secret-livekit.yaml` - 새 ExternalSecret
   - `k8s/helm/environments/prod.yaml` - livekit HTTPRoute 설정
3. **Git Push**: main → prod → k8s-deploy-prod
4. **ArgoCD Sync**: 자동 배포
5. **Terraform Apply**: Security Group 규칙 적용 (수동)

### 5.8 검증

```bash
# ExternalSecret 상태 확인
kubectl get externalsecret wealist-livekit-keys -n wealist-prod

# Secret 내용 확인
kubectl get secret wealist-livekit-keys -n wealist-prod -o jsonpath='{.data.keys\.yaml}' | base64 -d

# LiveKit Pod 상태
kubectl get pod -l app.kubernetes.io/name=livekit-server -n wealist-prod

# LiveKit 로그
kubectl logs -l app.kubernetes.io/name=livekit-server -n wealist-prod

# API 테스트
curl -I https://livekit.wealist.co.kr
```

### 5.9 관련 파일

| 파일 | 변경 내용 |
|------|----------|
| `k8s/argocd/projects/wealist-prod.yaml` | helm.livekit.io sourceRepos 추가 |
| `k8s/argocd/apps/prod/livekit.yaml` | 새 ArgoCD Application |
| `k8s/argocd/apps/prod/video-service.yaml` | LIVEKIT_HOST, LIVEKIT_WS_URL 추가 |
| `k8s/argocd/base/external-secrets/external-secret-livekit.yaml` | 새 ExternalSecret (keys.yaml) |
| `k8s/helm/charts/istio-config/templates/httproute-livekit.yaml` | 새 HTTPRoute |
| `k8s/helm/environments/prod.yaml` | livekit.wealist.co.kr 설정 |
| `terraform/prod/compute/eks.tf` | WebRTC UDP/TCP 포트 Security Group |

### 5.10 교훈

> **LiveKit Helm Chart는 keys.yaml 형식을 기대함.**
> ExternalSecret의 template 기능으로 `api_key: api_secret` 형식으로 변환 필요.

**핵심 포인트**:
1. ArgoCD AppProject의 sourceRepos 확인 필수
2. Helm values에서 환경변수 확장은 `${VAR}` 형식 사용
3. hostNetwork 사용 시 노드당 1개 Pod만 배포됨
4. WebRTC UDP 포트 (50000-60000) Security Group 오픈 필수

---

## 6. EKS 리소스 최적화 - 노드 과다 프로비저닝

### 6.1 문제 증상

- **현상**: EC2 인스턴스 5대가 실행 중 (비용 증가)
- **설정**: min=3, max=6, desired=3
- **리소스 사용률**: CPU 1-7%, Memory 8-23% (매우 낮음)

```bash
$ kubectl top nodes
NAME                    CPU(cores)   CPU%   MEMORY(bytes)   MEMORY%
ip-10-0-1-xxx           41m          2%     720Mi           9%
ip-10-0-2-xxx           71m          3%     1120Mi          15%
ip-10-0-3-xxx           115m         5%     1830Mi          24%
ip-10-0-1-yyy           29m          1%     628Mi           8%
ip-10-0-2-yyy           38m          1%     739Mi           9%
```

### 6.2 원인 분석

#### 1. HPA minReplicas=2

모든 서비스의 HPA가 `minReplicas: 2`로 설정되어 Pod 수가 과다:

```yaml
# prod.yaml
autoscaling:
  enabled: true
  minReplicas: 2  # 모든 서비스가 최소 2개 Pod 유지
```

이로 인해 11개 서비스 × 2개 replica = 22개 Pod 최소 유지.

#### 2. CPU Requests vs Usage

Cluster Autoscaler는 **실제 사용량**이 아닌 **requests**를 기준으로 scale-down 결정:

| 서비스 | CPU Request | 실제 사용 | Replicas |
|--------|-------------|-----------|----------|
| livekit (CrashLoop) | 500m × 2 | 0% | 2 |
| auth-service | 100m × 2 | 3% | 2 |
| Go 서비스들 | 25m × 2 | 4-8% | 2 each |
| otel-collector | 100m × 2 | ~5% | 2 |

노드별 CPU requests 합계가 55-99%로 높아서 Autoscaler가 scale-down 불가로 판단.

#### 3. LiveKit CrashLoopBackOff

LiveKit Pod 2개가 CrashLoopBackOff 상태로 1000m CPU를 요청하면서 아무 일도 안 함.

### 6.3 해결 방법

#### Phase 1: LiveKit 정리 (즉시)

CrashLoopBackOff 상태의 LiveKit 삭제:

```bash
kubectl delete application livekit-prod -n argocd
kubectl delete externalsecret wealist-livekit-keys -n wealist-prod
```

**효과**: 1000m CPU requests 해제

#### Phase 2: HPA minReplicas 조정

`k8s/helm/environments/prod.yaml`:

```yaml
# Before
autoscaling:
  enabled: true
  minReplicas: 2

# After
autoscaling:
  enabled: true
  minReplicas: 1  # 기본값 1로 변경
```

핵심 서비스만 ArgoCD parameters에서 오버라이드:

```yaml
# auth-service.yaml, user-service.yaml
parameters:
  - name: autoscaling.minReplicas
    value: "2"  # 고가용성 유지
```

**서비스별 최종 설정**:

| 서비스 | minReplicas | 이유 |
|--------|-------------|------|
| auth-service | 2 | 핵심 인증, 고가용성 필수 |
| user-service | 2 | 핵심 서비스 |
| board-service | 1 | 트래픽 낮음 |
| chat-service | 1 | 트래픽 낮음 |
| noti-service | 1 | 트래픽 낮음 |
| storage-service | 1 | 트래픽 낮음 |
| video-service | 1 | 트래픽 낮음 |
| ops-portal | 1 | 내부 도구 |
| ops-service | 1 | 내부 도구 |

#### Phase 3: 노드 그룹 크기 조정

`terraform/prod/compute/variables.tf`:

```hcl
# Before
variable "spot_min_size" { default = 3 }
variable "spot_desired_size" { default = 3 }

# After
variable "spot_min_size" { default = 2 }
variable "spot_desired_size" { default = 2 }
```

### 6.4 예상 효과

| 항목 | Before | After |
|------|--------|-------|
| 노드 수 | 5개 | 2-3개 |
| 총 vCPU | 10개 | 4-6개 |
| 월 비용 | ~$80-100 | ~$30-50 |
| **절감** | - | **40-50%** |

### 6.5 배포 순서

1. ✅ LiveKit ArgoCD Application 삭제
2. ⏳ Git 커밋: prod.yaml (minReplicas: 1) + ArgoCD parameters (auth/user: 2)
3. Git Push: main → prod → k8s-deploy-prod
4. ArgoCD Sync: Pod 수 감소
5. Terraform apply: 노드 그룹 크기 변경

### 6.6 수정 파일

| 파일 | 변경 내용 |
|------|----------|
| `k8s/helm/environments/prod.yaml` | `autoscaling.minReplicas: 2 → 1` |
| `k8s/argocd/apps/prod/auth-service.yaml` | `autoscaling.minReplicas: 2` 추가 |
| `k8s/argocd/apps/prod/user-service.yaml` | `autoscaling.minReplicas: 2` 추가 |
| `terraform/prod/compute/variables.tf` | `spot_min/desired: 3 → 2` |

### 6.7 교훈

> **Cluster Autoscaler는 requests 기준으로 scale-down 결정.**
> 실제 사용량이 낮아도 requests가 높으면 노드 축소 불가.

**최적화 원칙**:
1. HPA minReplicas는 필요한 만큼만 설정
2. CrashLoopBackOff Pod는 리소스 낭비 원인
3. 핵심 서비스만 고가용성 (minReplicas: 2) 유지
4. 나머지는 HPA가 트래픽에 따라 자동 조절

---

## 7. ops-portal OAuth 로그인 실패 - Filter Order & JWT Mode

### 7.1 문제 증상

- **현상**: ops-portal에서 Google 로그인 후 main frontend로 리다이렉트됨
- **기대**: `https://wealist.co.kr/api/ops-portal/login?accessToken=...`로 리다이렉트
- **실제**: `https://wealist.co.kr/oauth/callback?accessToken=...`로 리다이렉트

```
ops-portal → auth-service OAuth → Google 인증 → main frontend로 잘못 리다이렉트
```

### 7.2 원인 분석

#### 1차 원인: OAuth2RedirectUriFilter 순서 문제

ops-portal의 Login.tsx가 `redirect_uri` 파라미터를 전송:

```typescript
// ops-portal/src/pages/Login.tsx
const redirectUri = `${window.location.origin}/api/ops-portal/login`
window.location.href = `${authUrl}/api/oauth2/authorization/google?redirect_uri=${encodeURIComponent(redirectUri)}`
```

하지만 auth-service 로그에 `redirect_uri`가 capture되지 않음:

```
# 로그에 OAuth2RedirectUriFilter 관련 로그가 전혀 없음!
# 필터가 실행되지 않았다는 의미
```

**원인**: Spring Security Filter Chain 순서 문제

```java
// Before (문제)
.addFilterBefore(oAuth2RedirectUriFilter, UsernamePasswordAuthenticationFilter.class)
```

Spring Security 필터 실행 순서:
1. `OAuth2AuthorizationRequestRedirectFilter` ← 여기서 Google로 리다이렉트!
2. ... (중간 필터들)
3. `UsernamePasswordAuthenticationFilter` ← 우리 필터는 여기 앞에 위치

**문제**: `OAuth2AuthorizationRequestRedirectFilter`가 먼저 실행되어 Google로 리다이렉트하므로, 우리 필터(`OAuth2RedirectUriFilter`)는 실행되지 않음.

#### 2차 원인: ops-service JWT 검증 실패

OAuth 필터 순서를 수정한 후, 리다이렉트는 성공:

```
OAuth2 authorization request detected: /oauth2/authorization/google
Client redirect_uri parameter: https://wealist.co.kr/api/ops-portal/login
Stored client redirect_uri in session: https://wealist.co.kr/api/ops-portal/login
Using client-specified redirect_uri: https://wealist.co.kr/api/ops-portal/login
Redirecting to: https://wealist.co.kr/api/ops-portal/login?accessToken=eyJ...
```

하지만 브라우저에서는 여전히 로그인 페이지로 돌아옴.

**원인**: ops-portal의 AuthContext가 token 저장 후 `/api/users/me` 호출:

```typescript
// ops-portal/src/contexts/AuthContext.tsx
const login = async (token: string) => {
  localStorage.setItem('token', token)
  await fetchUser()  // 여기서 /api/users/me 호출
  navigate('/')
}

const fetchUser = async () => {
  try {
    const userData = await getMe()  // /api/users/me 호출
    setUser(userData)
  } catch {
    localStorage.removeItem('token')  // 401이면 토큰 삭제!
  }
}
```

**401 발생 원인**: ops-service의 `ISTIO_JWT_MODE` 설정 문제

```yaml
# ops-service ArgoCD Application - Before
parameters:
  - name: config.DB_NAME
    value: "ops_db"
  # ISTIO_JWT_MODE 없음 → 기본값 사용
```

ops-service의 router.go:

```go
istioJWTMode := os.Getenv("ISTIO_JWT_MODE") == "true"

if istioJWTMode {
    // Istio가 JWT 검증했다고 가정 → 파싱만
    parser := middleware.NewJWTParser(cfg.Logger)
    authMiddleware = middleware.IstioAuthMiddleware(parser)
} else {
    // 직접 JWT 검증 (JWKS fetch)
    authMiddleware = middleware.AuthWithValidator(tokenValidator)
}
```

**문제**:
- prod.yaml에 `ISTIO_JWT_MODE: "true"`가 설정됨 (global)
- 하지만 ops-service는 Istio `RequestAuthentication`이 없음
- Istio가 JWT를 검증하지 않으므로 파싱만으로는 인증 불가

### 7.3 해결 방법

#### Step 1: OAuth Filter 순서 수정

`services/auth-service/src/main/java/OrangeCloud/AuthService/config/SecurityConfig.java`:

```java
// Before
.addFilterBefore(oAuth2RedirectUriFilter, UsernamePasswordAuthenticationFilter.class)

// After - OAuth2AuthorizationRequestRedirectFilter 앞에 위치
.addFilterBefore(oAuth2RedirectUriFilter, OAuth2AuthorizationRequestRedirectFilter.class)
```

#### Step 2: ops-service ISTIO_JWT_MODE 설정

`k8s/argocd/apps/prod/ops-service.yaml`:

```yaml
parameters:
  - name: image.repository
    value: "prod/ops-service"
  - name: image.tag
    value: "latest"
  - name: externalSecrets.enabled
    value: "true"
  - name: config.DB_NAME
    value: "ops_db"
  # ops-service는 Istio RequestAuthentication이 없으므로 직접 JWT 검증
  - name: config.ISTIO_JWT_MODE
    value: "false"
```

### 7.4 Spring Security Filter Chain 순서

```
SecurityContextHolderFilter
├── HeaderWriterFilter
├── CorsFilter
├── CsrfFilter
├── LogoutFilter
├── OAuth2RedirectUriFilter       ← 수정 후 위치 (redirect_uri capture)
├── OAuth2AuthorizationRequestRedirectFilter  ← Google로 리다이렉트
├── OAuth2LoginAuthenticationFilter
├── UsernamePasswordAuthenticationFilter  ← 수정 전 위치 (너무 늦음!)
└── ...
```

### 7.5 OAuth2 플로우 (수정 후)

```
1. ops-portal → auth-service: /oauth2/authorization/google?redirect_uri=https://wealist.co.kr/api/ops-portal/login

2. OAuth2RedirectUriFilter: redirect_uri를 세션에 저장

3. OAuth2AuthorizationRequestRedirectFilter: Google로 리다이렉트
   (state 파라미터에 세션 ID 포함)

4. Google 인증 완료 → auth-service callback

5. OAuth2SuccessHandler: 세션에서 redirect_uri 조회
   → https://wealist.co.kr/api/ops-portal/login?accessToken=...

6. ops-portal: token 저장 → /api/users/me 호출

7. ops-service: ISTIO_JWT_MODE=false → JWKS로 직접 검증 → 200 OK

8. ops-portal: 로그인 성공 → Dashboard로 이동
```

### 7.6 영향받은 파일

| 파일 | 변경 내용 |
|------|----------|
| `services/auth-service/src/main/java/.../SecurityConfig.java` | Filter 순서 변경 |
| `k8s/argocd/apps/prod/ops-service.yaml` | `ISTIO_JWT_MODE: "false"` 추가 |

### 7.7 배포 순서

1. **auth-service 코드 수정**: Filter 순서 변경 → CI 자동 빌드/배포
2. **ops-service ArgoCD 설정**: ISTIO_JWT_MODE 파라미터 추가
3. **Git Push**: main → prod → k8s-deploy-prod
4. **ArgoCD Sync**: 자동 배포

### 7.8 검증

```bash
# auth-service 로그 확인
kubectl logs deploy/auth-service -n wealist-prod | grep -i "redirect_uri"
# OAuth2 authorization request detected: /oauth2/authorization/google
# Client redirect_uri parameter: https://wealist.co.kr/api/ops-portal/login
# Stored client redirect_uri in session: ...

# ops-service 환경변수 확인
kubectl exec deploy/ops-service -n wealist-prod -- env | grep ISTIO_JWT_MODE
# ISTIO_JWT_MODE=false

# ops-service 로그 확인 (401 에러 없어야 함)
kubectl logs deploy/ops-service -n wealist-prod | grep -E "401|Unauthorized"
```

### 7.9 교훈

> **Spring Security Filter 순서가 중요함.**
> OAuth2 관련 커스텀 필터는 `OAuth2AuthorizationRequestRedirectFilter` **앞에** 위치해야 함.

**핵심 포인트**:
1. `addFilterBefore(filter, A.class)`는 A 필터 **앞에** 위치시킴
2. OAuth2 플로우에서 redirect 발생 전에 데이터 capture 필요
3. Istio JWT 검증을 사용하지 않는 서비스는 `ISTIO_JWT_MODE=false` 명시
4. prod.yaml의 global 설정이 모든 서비스에 맞지 않을 수 있음

**디버깅 팁**:
- OAuth 로그인이 예상과 다른 곳으로 리다이렉트 → Filter 순서 확인
- token 저장 후 바로 사라짐 → API 호출 실패 여부 확인
- 401 에러 → JWT 검증 방식 (Istio vs Application) 확인
