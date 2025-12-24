---
title: Docker Compose 환경변수 대통합 - 흩어진 .env 파일 정리하기
excerpt: 멀티 서비스 프로젝트에서 환경변수 충돌 지옥을 끝낸 방법
category: cicd
tags:
  - docker-compose
  - environment-variables
  - team-project
  - automation
date: '2025-11-15'
---

## 🔥 상황

저희는 user-service(Java), board-service(Go), frontend(React) 세 개의 다른 구조가 한 레포지토리에서 관리되고 있는 프로젝트입니다.

그렇다 보니 각자의 영역 개발이 아닌 같이 실행해서 테스트를 할 때 문제가 많이 발생했습니다.

이 상황에서 마주쳤던 문제들과, 해결한 방법을 공유하겠습니다.

### 초기 구조

```bash
project-root/
├── user-service/
│   ├── .env
│   └── .env.example
├── board-service/
│   ├── .env
│   └── .env.example
├── frontend/
│   ├── .env
│   └── .env.example
├── docker-compose.yml
├── .env
└── .env.example
```

환경변수 파일이 프로젝트 곳곳에 흩어져 있는걸 확인할 수 있습니다.

---

## 💥 문제 1: 어디 설정이 적용되는 건가요?

```
frontend/.env          ← VITE_API_URL=localhost
docker-compose.yml     ← API_URL=ec2-domain
user-service/.env      ← 또 다른 값...
```

**git pull 받고 docker-compose up 하면:**

- 어떤 환경변수가 적용될지 예측 불가
- 로컬에선 되는데 다른 팀원은 안 됨
- **"제 컴퓨터에선 잘 되는데요?"** 지옥

환경변수 파일이 프로젝트 여기저기 흩어져 있으니 Docker Compose가 어느 값을 읽는지 알 수 없어 변수때문에 실행이 안되는 경우가 많았습니다.

또, 본인이 맡은 부분이 아니면 어떤 게 수정되었는지, 잘못 덮였는지 예측하기도 어려운 상황이었습니다.

---

## 💡 해결 방향: 중앙 집중화 + 환경별 분리

### 결정한 원칙

문제를 정리하고 나서 이렇게 방향을 잡았습니다:

1. **모든 .env 파일 제거** (각 서비스 디렉토리에서)
2. **docker/ 디렉토리에 통합**
3. **환경별로 명확하게 분리**

첫 번째 원칙이 가장 중요했습니다. 각 서비스에 흩어진 환경변수 파일을 전부 삭제하고, 한 곳에서 관리하기로 결정했습니다.

### 🏗️ 최종 구조

```
project-root/
├── docker/
│   ├── compose/
│   │   ├── docker-compose.yml            # Base
│   │   ├── docker-compose.dev.yml        # 로컬 개발
│   │   ├── docker-compose.ec2-dev.yml    # EC2 개발
│   │   ├── docker-compose.prod.yml       # 운영
│   │   └── docker-compose.monitoring.yml # 모니터링
│   │
│   ├── env/
│   │   ├── .env.dev.example             # 템플릿만
│   │   ├── .env.ec2-dev.example
│   │   ├── .env.prod.example
│   │   │
│   │   ├── .env.dev                     # 실제 값 (git 무시)
│   │   ├── .env.ec2-dev                 # 실제 값 (git 무시)
│   │   └── .env.prod                    # 실제 값 (git 무시)
│   │
│   └── scripts/
│       ├── dev.sh        # 로컬 개발 실행
│       ├── ec2-dev.sh    # EC2 개발 실행
│       └── prod.sh       # 운영 실행
│
├── user-service/          # .env 없음!
├── board-service/         # .env 없음!
└── frontend/              # .env 없음!
```

각 서비스 디렉토리에는 더 이상 환경변수 파일이 없도록 수정하였습니다. 모든 설정이 `docker/` 디렉토리로 모인것을 확인할 수 있습니다.

### 핵심 변화

**Before:**

```bash
# 팀원마다 다른 명령어
cd user-service && docker-compose up  # A의 방법
docker-compose up                      # B의 방법
cd frontend && npm start               # C의 방법
```

**After:**

```bash
# 모두 똑같은 명령어
./docker/scripts/dev.sh up

# 끝.
```

---

## ✅ 실제 적용 과정

### Step 1: 기존 .env 파일 전부 제거

```bash
# 각 서비스의 .env 삭제
rm user-service/.env*
rm board-service/.env*
rm frontend/.env*

# docker-compose.yml에 하드코딩된 값도 확인
grep -r "password\|secret" docker-compose.yml
```

환경변수 파일을 삭제하고, 하드코딩된 시크릿도 찾아서 정리했습니다.

### Step 2: docker/ 디렉토리 구조 생성

```bash
mkdir -p docker/{compose,env,scripts}

# 템플릿 파일 생성
touch docker/env/.env.dev.example
touch docker/env/.env.ec2-dev.example
touch docker/env/.env.prod.example
```

### Step 3: 환경별 분리

**왜 dev/ec2-dev/prod/monitoring으로 나눴나?**

처음엔 dev/prod 2개만 하려고 했습니다.

그런데 실제로 작업하다 보니 "EC2에서 개발 테스트"하는 환경이 필요했습니다. 그리고 모니터링 같은 경우도 따로 관리해서 붙이기 위해 나누었습니다.

**1. dev (로컬 개발)**
- MinIO (S3 대체)
- 모든 포트 열기
- Hot reload 지원

**2. ec2-dev (EC2 단일 인스턴스)**
- 실제 AWS S3 사용
- ECR 이미지 사용
- Monitoring 포함

**3. prod (운영)**
- RDS, ElastiCache 사용
- 최소 포트만 열기
- 백엔드만 Docker로

로컬에선 MinIO를 쓰지만, EC2에선 실제 S3를 써야 했고, dev에서는 EC2에 Docker로 PostgreSQL을 썼지만, 운영에선 RDS를 써야 했습니다. 그러다 보니 각 환경마다 설정이 달라서 3개로 분리했습니다.

### Step 4: 스크립트 자동화

**dev.sh 핵심 로직:**

```bash
#!/bin/bash

# 환경변수 파일 체크
if [ ! -f "docker/env/.env.dev" ]; then
    echo "❌ .env.dev 파일이 없습니다"
    echo "👉 docker/env/.env.dev.example을 복사하세요"
    exit 1
fi

# localhost로 강제 설정 (중요!)
export VITE_API_BASE_URL="http://localhost"

# Docker Compose 실행
docker compose \
  -f docker/compose/docker-compose.yml \
  -f docker/compose/docker-compose.dev.yml \
  --env-file docker/env/.env.dev \
  up -d
```

**왜 export로 강제 설정했나?**

`.env.dev` 파일에 실수로 EC2 도메인을 적어도, 스크립트가 localhost로 덮어씁니다. 이렇게 하면 로컬 개발 환경이 보장됩니다.

### Step 5: Docker Compose 오버라이드 패턴

```bash
docker compose \
  -f docker/compose/docker-compose.yml \      # Base 설정
  -f docker/compose/docker-compose.dev.yml \  # dev 환경 추가/덮어쓰기
  --env-file docker/env/.env.dev \            # 환경변수
  up -d
```

Docker Compose는 여러 파일을 겹쳐서 사용할 수 있습니다.

- `docker-compose.yml`: 모든 환경의 공통 설정
- `docker-compose.dev.yml`: dev 환경만의 추가 설정

이렇게 하면 공통 부분을 중복 작성하지 않아도 됩니다.

**실행 결과:**

```bash
$ ./docker/scripts/dev.sh up
✅ .env.dev 파일 확인 완료
🚀 Docker Compose 실행 중...
[+] Running 5/5
 ✔ Network wealist_backend    Created
 ✔ Container postgres          Started
 ✔ Container minio            Started
 ✔ Container user-service     Started
 ✔ Container board-service    Started
 ✔ Container frontend         Started
```

### Step 6: 팀원들에게 공유

**Before:**

```
"이거 board-service 바뀐 거 같은데 뭐 바꿔줘야 되나요??"
→ 30분 설명, 1시간 디버깅, docker system prune까지 몇 번 반복
```

**After:**

```
"환경 설정 어떻게 하나요?"
→ "이것만 하세요"

1. cp docker/env/.env.dev.example docker/env/.env.dev
2. vi docker/env/.env.dev  # DB 비번만 수정
3. ./docker/scripts/dev.sh up
```

5분 만에 끝났습니다.

---

## 📊 구조 비교

### Before vs After 다이어그램

**Before (환경변수 분산):**

```
┌─────────────────────────────────────────────┐
│             Git Repository                   │
├──────────────┬──────────────┬───────────────┤
│ user-service │board-service │   frontend    │
│   .env ❌    │   .env ❌    │   .env ❌     │
│   .env.ex    │   .env.ex    │   .env.ex     │
└──────────────┴──────────────┴───────────────┘
         │              │              │
         └──────────────┼──────────────┘
                        │ 충돌!
                        ▼
              ┌─────────────────┐
              │ docker-compose  │
              │   어느 값?? 🤷  │
              └─────────────────┘
```

**After (중앙 집중화):**

```
┌─────────────────────────────────────────────┐
│             Git Repository                   │
├──────────────┬──────────────┬───────────────┤
│ user-service │board-service │   frontend    │
│   (no .env)  │   (no .env)  │   (no .env)   │
└──────────────┴──────────────┴───────────────┘
                        │
                        ▼
              ┌─────────────────┐
              │   docker/env/   │
              │  .env.dev ✅    │
              │  .env.ec2 ✅    │
              │  .env.prod ✅   │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │    scripts/     │
              │   dev.sh        │
              │   ec2-dev.sh    │
              │   prod.sh       │
              └─────────────────┘
```

---

## 📚 배운 점

### 1. 환경변수는 "어디서" 관리하느냐가 중요한걸 알수있었습니다

각 서비스에 분산 ❌
→ 한 곳에 모으기 ✅

**이유:**

- 수정이 일어났을 시 추적이 간단합니다
- 환경별 차이를 한눈에 볼 수 있습니다
- Git 충돌을 최소화할 수 있습니다

### 2. 스크립트 자동화의 힘

```bash
# Before: 5개 명령어 + 2개 파일 수정
docker-compose down
docker-compose pull
docker-compose up -d
docker exec ... (설정 변경)
docker-compose restart

# After: 1줄
./docker/scripts/dev.sh rebuild
```

**시간 절약:**

- 개발자 1명당 매일10분 이상 절약

복잡한 명령어를 매번 입력할 필요가 없으니 실수도 줄어들었습니다.

### 3. 초기 설계의 중요성

"일단 돌아가게 하고, 나중에 정리하자"
→ 나중으로 미루면 나중이 언제올지 알 수 없습니다.

처음부터 `/docker` 디렉토리 구조를 잡았다면 3주간의 환경변수 충돌 지옥을 피할 수 있었습니다.

**교훈:**
초기 설계에 시간을 투자하면, 나중에 몇 배의 시간을 절약할 수 있습니다.

### 4. Docker Compose 오버라이드 패턴의 활용

처음엔 환경마다 완전히 다른 docker-compose 파일을 만들려고 했습니다. 하지만 그렇게 하면 공통 부분이 중복됩니다.

오버라이드 패턴을 쓰니까:
- 공통 설정은 base 파일에만
- 환경별 차이만 오버라이드 파일에
- 유지보수가 훨씬 쉬워졌다

### 5. 팀 프로젝트 환경변수 관리 원칙

정리하면 이렇습니다:

1. **템플릿은 플레이스홀더만** (.example 파일)
2. **환경별로 명확하게 분리** (dev/staging/prod)
3. **한 곳에서 관리** (중앙 집중화)
4. **스크립트로 자동화** (실수 방지)

---

## 🎯 추가 학습

이번 경험을 통해 더 알아보고 싶은 것들:

- **Docker Compose override 패턴 심화** - extends, profiles 기능
- **GitHub Actions에서 환경별 배포** - 환경변수를 어떻게 주입할까?
- **시크릿 관리 도구** - Vault, SOPS, AWS Secrets Manager
- **Kubernetes ConfigMap/Secret** - K8s로 가면 어떻게 바뀔까?

---

## 💭 정리

환경변수 관리는 생각보다 중요합니다. "일단 돌아가게만 하자" 하려다가 3주를 비효율적으로 일했습니다.

하지만 제대로 정리하고 나니:

- ✅ git pull 하고 충돌 때문에 꼬일까 걱정이 줄었습니다
- ✅ 환경 전환이 한 줄 명령어로 끝납니다
- ✅ 팀원 온보딩이 5분으로 단축되었습니다
- ✅ "제 컴퓨터에선 되는데요?" 지옥에서 탈출했다

혹시 비슷한 문제를 겪고 계신다면, 이 글이 도움이 되길 바랍니다.

---

## 🔗 참고

- [Docker Compose 공식 문서 - Multiple Compose files](https://docs.docker.com/compose/multiple-compose-files/)
- [12 Factor App - Config](https://12factor.net/config)
- [Docker Compose best practices](https://docs.docker.com/compose/production/)
