---
title: 여러 레포지토리를 한 서버에 배포하기 - Docker Compose부터 K8s까지
excerpt: 부트캠프 팀 프로젝트에서 mono vs multi-repo를 고민하다 중앙 배포 레포지토리 패턴을 택한 의사결정 서사와, Docker Compose부터 K8s+ArgoCD까지 같은 패턴이 확장되는 과정을 정리합니다
category: cicd
tags:
  - github-actions
  - docker-compose
  - argocd
  - gitops
  - microservices
  - adr
date: '2025-10-26'
---

## 💡 학습 동기

### 부트캠프 팀 프로젝트의 제약

부트캠프에서 백엔드 4명이 팀을 이뤄 프로젝트를 진행하는 상황이었습니다
서비스는 user-service와 board-service로 나누어져 있었고, 인프라 예산 문제로 **단일 EC2 한 대에 두 서비스를 올려야** 했습니다
로컬에서는 각자 Spring Boot 앱을 띄워서 개발하지만, 통합 테스트와 시연은 EC2 한 대 위에서 docker-compose로 함께 돌리는 구조였습니다

이 시점에 고민이 시작됐습니다

> "CI는 어떻게 구성하지?"

각 레포지토리마다 CI를 붙여야 하는지, 아니면 배포 전용 레포를 따로 만들어야 하는지 판단이 서지 않았습니다
이전까지는 단일 레포 + 단일 서버 구조만 다뤄봤기 때문에, 두 개 이상의 레포가 하나의 서버에 공존하는 배포 상황이 처음이었습니다

실무에서는 이런 상황을 어떻게 해결하는지 찾아보니 **중앙 배포 레포지토리 패턴**이라는 이름이 붙어있었습니다
이 글은 Docker Compose에서 시작해 Kubernetes + ArgoCD로 확장되는 과정을 정리한 학습 기록이자, 그 안에서 "왜 이 구조를 택했는가"를 남기는 ADR입니다

## 🤔 대안 비교: Mono vs Multi vs 중앙 배포 레포

구조를 결정하기 전에 세 가지 선택지를 놓고 비교했습니다

### 옵션 A: Mono-repo (단일 레포에 모든 서비스)

```
team-project/
├── user-service/
├── board-service/
└── deploy/
    └── docker-compose.yml
```

- **장점**: 설정과 코드가 한 곳에 있어 전체 아키텍처 파악이 쉽습니다. 공통 라이브러리 공유도 단순합니다
- **단점**: 서비스별 권한 분리가 어렵고, 한 서비스가 빌드 실패하면 전체 파이프라인이 영향을 받습니다. 팀원 4명이 동시에 같은 레포에서 작업하면 머지 충돌이 빈번해집니다
- **우리 상황에 맞지 않은 이유**: 부트캠프 특성상 팀원별로 담당 서비스가 명확히 나뉘어 있었습니다. user-service 담당자는 board-service 코드를 건드리지 않았고, 각자의 커밋 히스토리가 섞이면 코드 리뷰 단위가 모호해집니다

### 옵션 B: Multi-repo, 각 레포에서 직접 배포

```
user-service/      ← CI에서 EC2에 SSH → docker-compose up
board-service/     ← CI에서 EC2에 SSH → docker-compose up
```

- **장점**: 구조가 단순합니다. 각 레포가 자기 배포를 책임집니다
- **단점**: `docker-compose.yml`이 양쪽 레포에 중복되거나, 한쪽 레포에만 있으면 다른 쪽은 배포할 때 전체 구성을 알 수 없습니다. 환경변수(`.env`)도 어디에 둘지 애매해집니다. 서비스 A가 배포되는 순간 서비스 B까지 재시작되는 사이드이펙트가 생깁니다
- **우리 상황에 맞지 않은 이유**: 두 서비스가 **같은 EC2 위에서 docker-compose 한 파일로 묶여 돌아가야** 했습니다. 그런데 compose 파일의 소유권이 불분명해지는 게 가장 큰 문제였습니다. "누가 compose를 고쳐야 하는가"를 매번 합의해야 하는 구조는 4명 팀에도 부담입니다

### 옵션 C: Multi-repo + 중앙 배포 레포 (선택)

```
user-service/      ← CI: 이미지 빌드/푸시만
board-service/     ← CI: 이미지 빌드/푸시만
deploy-config/     ← compose/env/nginx 관리, 실제 배포 담당
```

- **장점**: 서비스 코드와 인프라 설정의 책임이 깔끔히 분리됩니다. compose 파일의 소유권이 명확합니다. 각 서비스가 독립적으로 빌드되면서도 배포는 중앙에서 통합됩니다
- **단점**: 레포가 3개로 늘어나 초기 설정 비용이 큽니다. 레포 간 트리거를 위해 `repository-dispatch` 같은 메커니즘을 알아야 합니다
- **우리가 택한 이유**: 구조적으로 "compose는 누구 것인가" 질문에 명확하게 답할 수 있었고, 이게 팀 협업의 마찰을 가장 크게 줄였습니다. 초기 비용은 한 번만 지불하면 되고, 이후 패턴을 K8s로 확장할 때도 동일한 사고방식을 이어갈 수 있다는 점이 큰 장점이었습니다

## 🏗️ 문제 상황

### 초기 구조

![Multi Repo Problem](/images/diagrams/cicd-multi-repo-problem.drawio.svg)

옵션 B로 갔을 때 부딪힌 질문들입니다

- 각 레포에 CI를 만들면 둘 다 EC2에 배포해야 합니까?
- docker-compose.yml은 어디에 둡니까?
- 한쪽만 업데이트됐을 때 어떻게 합니까?

이 질문들에 매번 팀 회의로 답하는 대신, 구조로 답을 고정하는 쪽을 택한 셈입니다

## 🎯 해결책: 중앙 배포 레포지토리 패턴

3개의 레포지토리로 분리하는 방식입니다

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

역할 분리의 실질적 효과는 **"누구에게 권한을 줘야 하는가"가 명확해진다**는 점입니다
예를 들어 PR 리뷰어 지정 규칙을 만들 때, 앱 레포는 해당 서비스 담당자가 리뷰하고 배포 레포는 인프라 담당자가 리뷰하도록 분리할 수 있습니다

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

여기서 핵심은 **앱 레포가 EC2를 직접 알지 못한다**는 점입니다
앱 레포는 "나 새 이미지 만들었어"라는 이벤트만 쏘고, 실제 배포 방식은 deploy-config 레포가 결정합니다
이 덕분에 나중에 배포 대상이 EC2에서 K8s로 바뀌어도 앱 레포 CI는 **한 줄도 수정하지 않아도 됩니다**

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

여기서 한 가지 함정이 있습니다

> "그럼 main 브랜치에 푸시할 때마다 배포되는 거네?"

맞습니다
하지만 개발 중에도 main에 푸시가 자주 일어나기 때문에, **배포 트리거를 main에 묶으면 원하지 않을 때도 운영이 갱신됩니다**
그래서 배포 전용 브랜치를 따로 만드는 게 안전합니다

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

흥미로운 점은, 이 패턴이 K8s 환경으로 거의 그대로 확장된다는 것입니다
본질은 "앱 레포는 이미지만 만들고, 인프라 레포가 배포를 관리한다"이고, 도구만 바뀝니다

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

`deploy-config`가 `k8s-infra`로 이름만 바뀌었고, `docker-compose.yml`이 Kustomize/Helm manifest로 바뀌었을 뿐입니다
"인프라 레포"라는 역할은 동일합니다

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

배포 상태를 보려면 Git 레포를 보면 됩니다
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

Docker Compose로 시작해서 K8s로 확장하는 게 이해하기 쉬웠습니다
**구조가 같고 도구만 바뀌기 때문입니다**
이 점이 "중앙 배포 레포" 패턴의 진짜 가치라고 생각합니다

### 4. 브랜치 전략의 중요성

deploy 브랜치를 분리하니까 세 가지 효과가 있었습니다

- 개발은 자유롭게 (main에서)
- 배포는 신중하게 (deploy로 PR)
- 실수 방지 (브랜치 보호 규칙)

부트캠프처럼 git 협업 경험이 서로 다른 팀에서는 특히 중요합니다
**"실수로 본 서버 날리는 사고"**를 구조가 막아주는 쪽이 훨씬 안전했습니다

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

Docker Compose 네트워크 내에서는 **서비스명으로 호출 가능**합니다

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

K8s도 동일합니다

```java
// application.yml
board:
  service:
    url: http://board-service.default.svc.cluster.local:3002
```

### 3. 시크릿 관리

중요한 정보는 Git에 올리지 않습니다

```bash
# .gitignore
.env
secrets/
```

GitHub Secrets를 사용합니다

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
