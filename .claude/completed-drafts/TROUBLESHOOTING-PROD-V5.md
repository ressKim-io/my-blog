# Production 트러블슈팅 V5 (2026-01-02)

## 1. CI 빌드 속도 개선

### 1.1 문제 증상

- **현상**: ops-service CI 빌드에서 arm64 빌드가 10분+ 소요
- **원인**: QEMU 에뮬레이션으로 arm64 크로스 컴파일

```
#29 [linux/arm64 builder 8/8] RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 ...
                    ↑ arm64 플랫폼에서 amd64 빌드 = QEMU 에뮬레이션 = 매우 느림
```

### 1.2 근본 원인

1. **Dockerfile에 GOARCH=amd64 하드코딩**
   - 모든 Go 서비스 Dockerfile에서 `GOARCH=amd64` 고정
   - multi-platform 빌드 시 arm64 러너에서도 amd64로 빌드 시도
   - QEMU 에뮬레이션 발생 → 10분+ 소요

2. **EKS는 amd64만 사용**
   ```bash
   kubectl get nodes -o jsonpath='{.items[*].status.nodeInfo.architecture}'
   # 출력: amd64 amd64 amd64
   ```
   - arm64 빌드가 불필요했음

### 1.3 해결 방법

#### Step 1: Dockerfile에 TARGETARCH 적용

모든 Go 서비스 Dockerfile 수정:

```dockerfile
# Before
FROM golang:1.24-bookworm AS builder
...
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build ...

# After
FROM golang:1.24-bookworm AS builder
ARG TARGETARCH  # Docker BuildKit이 자동 주입
...
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} go build ...
```

적용 대상 (7개 서비스):
- `services/board-service/docker/Dockerfile`
- `services/chat-service/docker/Dockerfile`
- `services/noti-service/docker/Dockerfile`
- `services/storage-service/docker/Dockerfile`
- `services/user-service/docker/Dockerfile`
- `services/video-service/docker/Dockerfile`
- `services/ops-service/docker/Dockerfile`

#### Step 2: CI 워크플로우 단순화 (amd64 only)

EKS가 amd64만 사용하므로 arm64 빌드 제거:

```yaml
# .github/workflows/ci-build-images.yaml

# Before: 2단계 빌드 (build-platform → merge-manifests)
build-platform:
  strategy:
    matrix:
      platform: [linux/amd64, linux/arm64]
      include:
        - platform: linux/amd64
          runner: ubuntu-latest
        - platform: linux/arm64
          runner: ubuntu-24.04-arm

# After: 단순화된 단일 빌드
build-and-push:
  runs-on: ubuntu-latest
  strategy:
    matrix:
      service: ${{ fromJSON(needs.detect-changes.outputs.services) }}
  ...
  - uses: docker/build-push-action@v5
    with:
      platforms: linux/amd64  # amd64만 빌드
```

### 1.4 결과

| 항목 | Before | After |
|------|--------|-------|
| arm64 빌드 | ~10분 (QEMU) | 제거됨 |
| 전체 빌드 | ~15분 | ~3분 |
| Job 수 (서비스당) | 2개 | 1개 |

### 1.5 참고: GitHub Actions Runner 종류

| Runner | 제공자 | 아키텍처 | 비용 |
|--------|--------|----------|------|
| `ubuntu-latest` | GitHub 호스팅 | amd64 | Public repo 무료 |
| `ubuntu-24.04-arm` | GitHub 호스팅 | arm64 | Public repo 무료 |
| Self-hosted | 직접 구성 (EC2 등) | 선택 | 인프라 비용 |

---

## 2. ops-service DB 연결 실패

### 2.1 문제 증상

```
FATAL: database "ops_db" does not exist (SQLSTATE 3D000)
```

- ops-service Pod가 계속 재시작
- Liveness/Readiness probe 실패

### 2.2 근본 원인

- RDS에 `ops_db` 데이터베이스가 생성되지 않음
- RDS 초기 생성 시 `wealist` DB만 생성됨
- 다른 서비스들(board_db, user_db 등)은 이미 수동 생성됨

### 2.3 진단

```bash
# 현재 존재하는 데이터베이스 확인
kubectl exec psql-debug -n wealist-prod -- sh -c \
  'PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USERNAME -d wealist \
   -c "SELECT datname FROM pg_database;"'

# 결과:
#  datname
# ------------
#  postgres
#  wealist
#  board_db
#  user_db
#  chat_db
#  noti_db
#  storage_db
#  video_db
# (8 rows)
#
# ops_db 누락!
```

### 2.4 해결

#### Step 1: psql 디버그 Pod 생성

```bash
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: psql-debug
  namespace: wealist-prod
spec:
  containers:
  - name: psql
    image: postgres:17-alpine
    command: ["sleep", "3600"]
    envFrom:
    - secretRef:
        name: wealist-shared-secret
  restartPolicy: Never
EOF
```

#### Step 2: ops_db 생성

```bash
kubectl exec psql-debug -n wealist-prod -- sh -c \
  'PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USERNAME -d wealist \
   -c "CREATE DATABASE ops_db;"'

# 출력: CREATE DATABASE
```

#### Step 3: 확인 및 정리

```bash
# 생성 확인
kubectl exec psql-debug -n wealist-prod -- sh -c \
  'PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USERNAME -d wealist \
   -c "SELECT datname FROM pg_database WHERE datname = '\''ops_db'\'';"'

# 디버그 Pod 삭제
kubectl delete pod psql-debug -n wealist-prod
```

### 2.5 결과

- ops-service가 자동으로 DB 연결됨 (Pod가 이미 재시작 중이었음)
- rollout 불필요

```bash
kubectl get pods -n wealist-prod -l app.kubernetes.io/name=ops-service
# NAME                           READY   STATUS    RESTARTS
# ops-service-587f79885b-9r6fd   1/1     Running   3
# ops-service-587f79885b-dcm7b   1/1     Running   0
```

### 2.6 향후 개선

새 서비스 추가 시 DB 생성 체크리스트:
1. [ ] RDS에 `{service}_db` 데이터베이스 생성
2. [ ] AWS Secrets Manager에 DATABASE_URL 추가 (필요시)
3. [ ] Helm values에 DB_NAME 설정
4. [ ] ArgoCD Application 생성
5. [ ] CI 파이프라인에 서비스 추가

---

## 3. CloudFront + S3 + KMS 403 Forbidden

### 3.1 문제 증상

```
Request URL: https://cdn.wealist.co.kr/profiles/xxx/image.png
Status Code: 403 Forbidden
```

- S3에 파일 업로드는 정상
- CloudFront를 통한 이미지 조회 시 403

### 3.2 근본 원인

1. **S3 버킷이 KMS 암호화 사용**
   ```
   x-amz-server-side-encryption: aws:kms
   x-amz-server-side-encryption-aws-kms-key-id: arn:aws:kms:...:key/a6f10269-...
   ```

2. **KMS 키 정책에 CloudFront 권한 없음**
   - CloudFront OAC가 S3에 접근 가능해도
   - KMS Decrypt 권한이 없으면 암호화된 객체 읽기 불가

### 3.3 진단

```bash
# CloudFront 설정 확인
aws cloudfront get-distribution --id E11S2DJHTYZKER \
  --query "Distribution.DistributionConfig.Origins.Items[0]"

# S3 버킷 암호화 확인
aws s3api get-bucket-encryption --bucket wealist-prod-files-290008131187

# KMS 키 정책 확인
aws kms get-key-policy --key-id a6f10269-c08f-4352-b6e4-cc303653244e \
  --policy-name default --query Policy --output text | jq .
```

### 3.4 해결

#### Step 1: KMS 키 정책에 CloudFront 추가 (AWS CLI - 임시)

```bash
# 현재 정책 백업
aws kms get-key-policy --key-id a6f10269-... --policy-name default \
  --query Policy --output text > kms-policy.json

# 정책에 CloudFront Decrypt 권한 추가
# Statement 배열에 추가:
{
  "Sid": "AllowCloudFrontDecrypt",
  "Effect": "Allow",
  "Principal": {
    "Service": "cloudfront.amazonaws.com"
  },
  "Action": [
    "kms:Decrypt",
    "kms:GenerateDataKey*"
  ],
  "Resource": "*",
  "Condition": {
    "StringEquals": {
      "AWS:SourceArn": "arn:aws:cloudfront::290008131187:distribution/E11S2DJHTYZKER"
    }
  }
}

# 정책 적용
aws kms put-key-policy --key-id a6f10269-... --policy-name default \
  --policy file://kms-policy-updated.json
```

#### Step 2: Terraform에 영구 반영

```hcl
# terraform/prod/foundation/kms.tf
module "kms" {
  # ... 기존 설정 ...

  key_statements = [
    {
      sid    = "AllowCloudFrontDecrypt"
      effect = "Allow"
      principals = [
        {
          type        = "Service"
          identifiers = ["cloudfront.amazonaws.com"]
        }
      ]
      actions = [
        "kms:Decrypt",
        "kms:GenerateDataKey*"
      ]
      resources = ["*"]
      conditions = [
        {
          test     = "StringEquals"
          variable = "AWS:SourceArn"
          values   = ["arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:distribution/${var.cloudfront_distribution_id}"]
        }
      ]
    }
  ]
}
```

### 3.5 GetFileURL 코드 수정

CloudFront는 S3 버킷을 origin으로 사용하므로 URL에 bucket 이름 제외 필요:

```go
// Before (잘못됨)
return fmt.Sprintf("%s/%s/%s", c.publicEndpoint, c.bucket, fileKey)
// → https://cdn.wealist.co.kr/wealist-prod-files-xxx/profiles/...

// After (올바름)
if c.publicEndpoint != "" && c.endpoint == "" {
    return fmt.Sprintf("%s/%s", c.publicEndpoint, fileKey)
}
// → https://cdn.wealist.co.kr/profiles/...
```

적용 서비스: storage-service, board-service, user-service

### 3.6 결과

```bash
curl -sI "https://cdn.wealist.co.kr/profiles/xxx/image.png"
# HTTP/2 200 ✅
# x-cache: Hit from cloudfront
```

---

## 4. 관련 파일

| 파일 | 변경 내용 |
|------|----------|
| `.github/workflows/ci-build-images.yaml` | amd64 only 빌드로 단순화 |
| `services/*/docker/Dockerfile` | TARGETARCH 적용 (7개 서비스) |
| `services/*/internal/client/s3_client.go` | GetFileURL CDN 모드 지원 |
| `terraform/prod/foundation/kms.tf` | CloudFront Decrypt 권한 |
| `terraform/prod/foundation/variables.tf` | cloudfront_distribution_id 변수 |
| RDS `ops_db` | 수동 생성 |
| Route53 `cdn.wealist.co.kr` | CloudFront Alias 레코드 |
