---
title: 여러 레포지토리를 한 서버에 배포하기 - Docker Compose부터 K8s까지
excerpt: 마이크로서비스 아키텍처에서 중앙 배포 레포지토리 패턴과 GitOps 전략
category: cicd
tags:
  - github-actions
  - docker-compose
  - argocd
  - gitops
  - microservices
date: '2025-10-26'
---

## 💡 학습 동기

부트캠프에서 프로젝트를 진행하는 도중 ec2 에 서버를 올려서 테스트하는 상황이 있었습니다.

user-service, board-service 두 개의 레포지토리를 운영하는데, 하나의 EC2 인스턴스에 배포해서 docker-compose로 통합 실행해야되는 구조였습니다.

"그럼 CI는 어떻게 구성하지?"

각 레포지토리마다 CI를 붙여야 합니까? 아니면 배포 전용 레포를 따로 만들어야 합니까? 고민이 됐습니다.

실무에서는 이런 상황을 어떻게 해결하는지 찾아보니 **중앙 배포 레포지토리 패턴**이라는 게 있는것을 보고,

Docker Compose에서 시작해서 Kubernetes + ArgoCD까지 확장되는 것까지 공부한 내용을 정리해 보았습니다.


## 🏗️ 문제 상황

### 초기 구조

![Multi Repo Problem](/images/diagrams/cicd-multi-repo-problem.drawio.svg)

**고민했던 점:**
- 각 레포에 CI를 만들면 둘 다 EC2에 배포해야 합니까?
- docker-compose.yml은 어디에 둡니까?
- 한쪽만 업데이트됐을 때 어떻게 합니까?

## 🎯 해결책: 중앙 배포 레포지토리 패턴

3개의 레포지토리로 분리하는 방식입니다:

![Central Deploy Repo Pattern](/images/diagrams/cicd-central-deploy-repo.drawio.svg)

### 역할 분리

**앱 레포지토리 (user-service, board-service):**
- 비즈니스 로직 개발
- 단위 테스트
- Docker 이미지 빌드 & 푸시
- ✅ **배포는 하지 않음**

**배포 레포지토리 (deploy-config):**
- docker-compose.yml 관리
- nginx 설정
- 환경변수 (.env)
- ✅ **실제 배포만 담당**

## 🔄 CI/CD 플로우

### Docker Compose 버전

![Docker Compose CI/CD Flow](/images/diagrams/cicd-docker-compose-flow.drawio.svg)

### user-service CI 예시

```yaml
# user-service/.github/workflows/build.yml
...중략...

      # deploy-config 레포에 배포 요청
      - name: Trigger Deployment
        uses: peter-evans/repository-dispatch@v2
        with:
          token: ${{ secrets.DEPLOY_TOKEN }}
          repository: yourname/deploy-config
          event-type: deploy-user-service
...
```

### deploy-config 구조

```
deploy-config/
├── docker-compose.yml
├── .env.example
├── nginx/
│   └── default.conf
└── .github/
    └── workflows/
        └── deploy.yml
```

**docker-compose.yml:**
```yaml
version: '3.8'

services:
  user-service:
    image: ghcr.io/yourname/user-service:latest
    ports:
      - "3001:3001"
    environment:
      - BOARD_SERVICE_URL=http://board-service:3002
    networks:
      - backend

  board-service:
    image: ghcr.io/yourname/board-service:latest
    ports:
      - "3002:3002"
    environment:
      - USER_SERVICE_URL=http://user-service:3001
    networks:
      - backend

networks:
  backend:
    driver: bridge
```

**핵심:**
- 서비스 간 통신은 Docker 네트워크로 (service name으로 호출 가능)
- 이미지는 외부 레지스트리에서 pull
- 환경변수로 서비스 URL 주입

## 🚀 브랜치 전략

"그럼 main 브랜치에 푸시할 때마다 배포되는 거네?"

맞습니다. 그래서 배포 전용 브랜치를 따로 만드는 게 좋습니다.

### 추천 브랜치 구조

![Git Flow Strategy](/images/diagrams/cicd-git-flow-strategy.drawio.svg)

**CI 설정:**
```yaml
on:
  push:
    branches:
      - main      # 빌드만
      - deploy    # 빌드 + 배포 트리거

- name: Trigger Deployment
  if: github.ref == 'refs/heads/deploy'  # deploy 브랜치일 때만
  uses: peter-evans/repository-dispatch@v2
```

**효과:**
- main: 개발 작업, 이미지 빌드만 (배포 안 됨)
- deploy: 실제 운영 배포 (수동 머지로 제어)
- 실수로 운영 배포되는 것 방지 ✅

## 🎨 Kubernetes + ArgoCD로 확장

같은 패턴을 K8s 환경으로 확장할 수 있습니다. 본질은 동일하고 도구만 바뀝니다.

### 레포지토리 구조 (K8s 버전)

```
┌──────────────────────────────────────────────────────────┐
│                    Git Repositories                       │
├────────────┬────────────┬────────────┬────────────────────┤
│   user     │   board    │   chat     │   k8s-infra       │
│  service   │  service   │  service   │  (manifests)      │
└─────┬──────┴─────┬──────┴─────┬──────┴──────┬────────────┘
      │            │            │              │
      │ Build      │ Build      │ Build        │ ArgoCD
      │ & Push     │ & Push     │ & Push       │ watches
      ▼            ▼            ▼              ▼
┌─────────────────────────────────┐  ┌──────────────────┐
│    Container Registry (GHCR)    │  │     ArgoCD       │
│  - user:v1.2.3                  │  │      Sync        │
│  - board:v2.1.0                 │  └──────┬───────────┘
│  - chat:v1.0.5                  │         │
└─────────────────────────────────┘         ▼
                                   ┌──────────────────┐
                                   │   Kubernetes     │
                                   └──────────────────┘
```

### k8s-infra 레포 구조

```
k8s-infra/
├── argocd/
│   └── applications/
│       ├── user-service-app.yaml
│       ├── board-service-app.yaml
│       └── chat-service-app.yaml
├── services/
│   ├── user-service/
│   │   └── kustomization.yaml
│   ├── board-service/
│   │   └── kustomization.yaml
│   └── chat-service/
│       └── kustomization.yaml
└── overlays/
    ├── development/
    ├── staging/
    └── production/
```

### CI Pipeline (K8s 버전)

```yaml
# user-service/.github/workflows/cd.yml
name: Build and Deploy
on:
  push:
    branches: [main]

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      # 1. Docker 이미지 빌드
      - name: Build and push Docker image
        run: |
          VERSION="${GITHUB_SHA::8}"
          docker build -t ghcr.io/yourname/user-service:${VERSION} .
          docker push ghcr.io/yourname/user-service:${VERSION}

  update-k8s-manifest:
    needs: build-and-push
    runs-on: ubuntu-latest
    steps:
      # 2. k8s-infra 레포 체크아웃
      - name: Checkout k8s-infra repo
        uses: actions/checkout@v3
        with:
          repository: yourorg/k8s-infra
          token: ${{ secrets.DEPLOY_TOKEN }}

      # 3. 이미지 태그 업데이트
      - name: Update image tag
        run: |
          cd services/user-service
          kustomize edit set image ghcr.io/yourname/user-service:${VERSION}

          git add .
          git commit -m "Update user-service to ${VERSION}"
          git push
```

**ArgoCD가 하는 일:**
- k8s-infra 레포를 3분마다 체크
- 변경 감지 시 자동으로 K8s에 배포
- Rolling Update로 무중단 배포

### kustomization.yaml 예시

```yaml
# k8s-infra/services/user-service/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - https://github.com/yourorg/user-service/k8s/base

images:
  - name: ghcr.io/yourorg/user-service
    newTag: abc12345  # CI가 자동으로 업데이트
```

## 📊 패턴 비교

### Docker Compose vs Kubernetes

```
┌──────────────────────────────────────────────────────────┐
│                    GitOps Pattern                         │
├────────────────────────┬─────────────────────────────────┤
│   Docker Compose 버전   │      Kubernetes 버전           │
├────────────────────────┼─────────────────────────────────┤
│                        │                                 │
│  App Repos → Build →   │   App Repos → Build →          │
│  → Update deploy-repo  │   → Update k8s-infra repo      │
│  → docker-compose up   │   → ArgoCD syncs to K8s        │
│                        │                                 │
└────────────────────────┴─────────────────────────────────┘
```

**공통점:**
- 🎯 인프라 설정과 앱 코드 분리
- 📝 선언적 설정 파일 (YAML)
- 🔄 Git을 통한 상태 관리 (GitOps)
- 🚀 자동 배포 파이프라인

**차이점:**
- 오케스트레이션 도구 (Docker Compose vs K8s)
- 배포 실행 방법 (SSH vs ArgoCD)
- 복잡도 (Simple vs Enterprise)

## 💭 배우면서 이해한 핵심

### 1. 중앙 배포 레포의 장점

**Before (배포 레포 없이):**
```
user-service CI → EC2 SSH → docker-compose up user
board-service CI → EC2 SSH → docker-compose up board

문제점:
- docker-compose.yml이 두 레포에 중복
- 환경변수 관리가 분산됨
- 전체 아키텍처 파악 어려움
```

**After (중앙 배포 레포 사용):**
```
user-service CI → 이미지 빌드만
board-service CI → 이미지 빌드만
deploy-config → 통합 배포 관리

장점:
- 명확한 책임 분리 ✅
- 인프라 설정 중앙화 ✅
- 독립적인 배포 가능 ✅
```

### 2. GitOps 패턴의 본질

"Git이 Single Source of Truth"

배포 상태를 보려면 Git 레포를 보면 됩니다:
- docker-compose.yml을 보면 현재 운영 중인 서비스 구조 파악
- kustomization.yaml을 보면 현재 배포된 이미지 버전 확인
- Git 히스토리로 배포 이력 추적

### 3. Docker Compose → K8s는 자연스러운 진화

```
학습 곡선:
     Simple                                Complex
        │                                     │
        ▼                                     ▼
┌───────────────┬─────────────────┬──────────────┐
│ Local Docker  │ Docker Compose  │  Kubernetes  │
│               │   + GitOps      │   + ArgoCD   │
└───────────────┴─────────────────┴──────────────┘
        └─────────────┬─────────────┘
              같은 패턴, 다른 도구
```

Docker Compose로 시작해서 K8s로 확장하는 게 이해하기 쉬웠습니다.

### 4. 브랜치 전략의 중요성

deploy 브랜치를 분리하니까:
- 개발은 자유롭게 (main에서)
- 배포는 신중하게 (deploy로 PR)
- 실수 방지 (브랜치 보호 규칙)

실무 패턴을 배우면서 안전성도 확보하는 좋은 방법이었습니다.

## 🎓 실전 팁

### 1. 학습시 프로젝트 배포 전략

```
초기: Docker Compose + 중앙 배포 레포
  └─ 개념 이해하기 쉬움
  └─ 빠른 피드백

후반: K8s + ArgoCD
  └─ 실무 패턴 경험
  └─ 확장 가능한 구조
```

### 2. 서비스 간 통신

Docker Compose 네트워크 내에서는 **서비스명으로 호출 가능**:

```java
// user-service 코드 (Java Spring)
@Service
public class BoardServiceClient {

    private final RestTemplate restTemplate;

    @Value("${board.service.url}")  // http://board-service:3002
    private String boardServiceUrl;

    public List<Board> getUserBoards(Long userId) {
        String url = boardServiceUrl + "/api/boards/user/" + userId;
        return restTemplate.getForObject(url, List.class);
    }
}
```

K8s도 동일:
```java
// application.yml
board:
  service:
    url: http://board-service.default.svc.cluster.local:3002
```

### 3. 시크릿 관리

중요한 정보는 Git에 올리지 않기:
```bash
# .gitignore
.env
secrets/
```

GitHub Secrets 사용:
```yaml
env:
  DB_PASSWORD: ${{ secrets.DB_PASSWORD }}
```

## 📚 참고 자료

- [GitOps - What is GitOps](https://www.gitops.tech/)
- [ArgoCD Documentation](https://argo-cd.readthedocs.io/)
- [GitHub Actions - Repository Dispatch](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#repository_dispatch)
- [Kustomize Documentation](https://kustomize.io/)
- [Docker Compose Networking](https://docs.docker.com/compose/networking/)

---

**작성일**: 2025-10-26
**학습 환경**: Docker Compose (로컬), K3s (실습용)
**키워드**: GitOps, 중앙 배포 레포지토리, ArgoCD, 마이크로서비스 CI/CD
