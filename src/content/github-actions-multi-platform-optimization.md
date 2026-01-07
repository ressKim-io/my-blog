---
title: "CI 빌드 시간을 15분에서 3분으로: QEMU 에뮬레이션 제거"
excerpt: "arm64 빌드에서 QEMU 에뮬레이션이 발생하는 원인과 TARGETARCH로 해결하는 방법"
category: cicd
tags:
  - GitHub Actions
  - Docker
  - Multi-Platform
  - QEMU
  - CI/CD
date: '2026-01-02'
---

## 한 줄 요약

> arm64 빌드가 10분+ 걸린다면 QEMU 에뮬레이션을 의심하라. Dockerfile에 `GOARCH=amd64` 하드코딩이 원인일 수 있다.

## Impact

- **영향 범위**: 모든 Go 서비스 CI 빌드
- **개선 효과**: 빌드 시간 15분 → 3분 (80% 단축)
- **소요 시간**: 약 2시간
- **발생일**: 2026-01-02

---

## 🔥 증상: arm64 빌드만 10분+ 소요

### 발견 상황

ops-service CI 빌드에서 arm64 빌드가 비정상적으로 오래 걸렸습니다:

```
#29 [linux/arm64 builder 8/8] RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 ...
                    ↑ arm64 플랫폼에서 amd64 빌드 = QEMU 에뮬레이션 = 매우 느림
```

| 플랫폼 | 빌드 시간 | 원인 |
|--------|----------|------|
| amd64 | ~3분 | 네이티브 빌드 |
| arm64 | ~10분 | QEMU 에뮬레이션 |

---

## 🤔 원인: Dockerfile에 GOARCH 하드코딩

### 문제의 Dockerfile

```dockerfile
FROM golang:1.24-bookworm AS builder
# ...
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build ...
                              ^^^^^^^^
                              모든 플랫폼에서 amd64로 빌드
```

### 빌드 플로우

```
GitHub Actions
├── amd64 러너 (ubuntu-latest)
│   └── GOARCH=amd64 빌드 → 네이티브 → 빠름 ✅
│
└── arm64 러너 (ubuntu-24.04-arm)
    └── GOARCH=amd64 빌드 → QEMU 에뮬레이션 → 느림 ❌
```

arm64 러너에서 amd64 바이너리를 빌드하면 QEMU가 x86_64 명령어를 에뮬레이션해야 합니다. 이것이 10분+ 소요의 원인입니다.

### 추가 발견: EKS는 amd64만 사용

```bash
$ kubectl get nodes -o jsonpath='{.items[*].status.nodeInfo.architecture}'
amd64 amd64 amd64
```

EKS 노드가 전부 amd64라면 arm64 이미지는 **불필요**합니다.

---

## ✅ 해결: TARGETARCH + amd64 단일 빌드

### Step 1: Dockerfile에 TARGETARCH 적용

Docker BuildKit은 `TARGETARCH` 변수를 자동으로 주입합니다:

```dockerfile
# After
FROM golang:1.24-bookworm AS builder
ARG TARGETARCH  # Docker BuildKit이 자동 주입

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} go build -o main ./cmd/api
```

이렇게 하면:
- amd64 플랫폼 빌드 → `TARGETARCH=amd64` → 네이티브 빌드
- arm64 플랫폼 빌드 → `TARGETARCH=arm64` → 네이티브 빌드

### Step 2: CI 워크플로우 단순화 (amd64 only)

EKS가 amd64만 사용하므로 arm64 빌드를 제거합니다:

**Before (2단계 빌드):**
```yaml
# .github/workflows/ci-build-images.yaml
build-platform:
  strategy:
    matrix:
      platform: [linux/amd64, linux/arm64]
      include:
        - platform: linux/amd64
          runner: ubuntu-latest
        - platform: linux/arm64
          runner: ubuntu-24.04-arm

merge-manifests:
  needs: build-platform
  # 두 플랫폼 이미지를 하나의 manifest로 병합
```

**After (단일 빌드):**
```yaml
build-and-push:
  runs-on: ubuntu-latest
  strategy:
    matrix:
      service: ${{ fromJSON(needs.detect-changes.outputs.services) }}
  steps:
    - uses: docker/build-push-action@v5
      with:
        platforms: linux/amd64  # amd64만 빌드
        push: true
        tags: ${{ env.ECR_REGISTRY }}/${{ matrix.service }}:${{ github.sha }}
```

---

## 적용 대상

7개 Go 서비스의 Dockerfile을 수정했습니다:

| 서비스 | 파일 |
|--------|------|
| board-service | `services/board-service/docker/Dockerfile` |
| chat-service | `services/chat-service/docker/Dockerfile` |
| noti-service | `services/noti-service/docker/Dockerfile` |
| storage-service | `services/storage-service/docker/Dockerfile` |
| user-service | `services/user-service/docker/Dockerfile` |
| video-service | `services/video-service/docker/Dockerfile` |
| ops-service | `services/ops-service/docker/Dockerfile` |

---

## 결과

| 항목 | Before | After |
|------|--------|-------|
| arm64 빌드 | ~10분 (QEMU) | 제거됨 |
| 전체 빌드 | ~15분 | ~3분 |
| Job 수 (서비스당) | 2개 | 1개 |
| 빌드 비용 | 높음 | 낮음 |

---

## 📚 배운 점

### QEMU 에뮬레이션 징후

다음 상황에서 QEMU 에뮬레이션을 의심하세요:

1. **특정 플랫폼만 느림**: amd64는 빠른데 arm64만 느림
2. **Docker 빌드 로그**: `[linux/arm64]`에서 `GOARCH=amd64` 같은 불일치
3. **CPU 사용률 100%**: 에뮬레이션은 CPU를 많이 사용함

### 언제 Multi-Platform이 필요한가?

| 상황 | 권장 |
|------|------|
| EKS/GKE가 amd64만 사용 | amd64 단일 빌드 |
| 로컬 개발 (M1/M2 Mac) | Multi-Platform 또는 arm64 |
| Graviton 인스턴스 사용 예정 | Multi-Platform |
| 비용 절감 목적 (Graviton) | Multi-Platform |

### GitHub Actions Runner 종류

| Runner | 아키텍처 | 비용 |
|--------|----------|------|
| `ubuntu-latest` | amd64 | Public repo 무료 |
| `ubuntu-24.04-arm` | arm64 | Public repo 무료 |

---

## 요약

| 문제 | 원인 | 해결 |
|------|------|------|
| arm64 빌드 10분+ | `GOARCH=amd64` 하드코딩 | `GOARCH=${TARGETARCH}` |
| 불필요한 arm64 빌드 | Multi-Platform 설정 | amd64 단일 빌드로 단순화 |

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `.github/workflows/ci-build-images.yaml` | CI 워크플로우 |
| `services/*/docker/Dockerfile` | 각 서비스 Dockerfile |

---

## 참고

- [Docker BuildKit TARGETARCH](https://docs.docker.com/engine/reference/builder/#automatic-platform-args-in-the-global-scope)
- [GitHub Actions Runners](https://docs.github.com/en/actions/using-github-hosted-runners/about-github-hosted-runners)
- [QEMU User Mode Emulation](https://www.qemu.org/docs/master/user/main.html)
