---
title: '팀 프로젝트 K8s 마이그레이션 - Part 1: 프로젝트 분석 & 전략'
excerpt: Docker Compose로 개발 중이던 weAlist를 K8s로 전환하기
category: challenge
tags:
  - bootcamp
  - k3d
  - docker-compose
  - migration
  - statefulset
  - postgresql
date: '2025-10-20'
series:
  name: challenge-2-wealist-migration
  order: 1
---

## 🎯 챌린지 배경

이번 챌린지는 이커머스 프로젝트를 K8s로 마이그레이션하는 과제였습니다. 원래는 내용이 없는 빈 프로젝트로 마이그레이션을 해보는 것이었는데, 저는 팀에서 작업하고 있는 프로젝트를 마이그레이션하며 진행하였습니다.

**weAlist 프로젝트:**
- 5명 팀 프로젝트 (회원/게시판/프론트)
- 현재 Docker Compose로 개발 중
- 이번 마이그레이션: 게시판(FastAPI) + 프론트(React) + PostgreSQL

회원 서비스는 아직 개발 중이라 이번에는 제외했습니다. 실무에서도 완성된 것부터 단계적으로 전환한다고 하니 따로 먼저 진행해보는 느낌으로 했습니다.

## 🏗️ 기존 구조 (Docker Compose)

기존에는 docker-compose 로 다음과 같이 구성되어 있습니다.

```yaml
# docker-compose.yml (일부)
services:
  postgres:
    image: postgres:16-alpine
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: wealist
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: mysupersecret

  board-api:
    build: ./backend/services/kanban
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql://postgres:mysupersecret@postgres:5432/wealist
    depends_on:
      - postgres

  frontend:
    build: ./frontend
    ports:
      - "3000:80"
    depends_on:
      - board-api
```

실행은 잘 되지만 여기서 추가로 채팅같은 추가 기능들을 구현하기에는 여러모로 복잡성이 높은 프로젝트 입니다.

## 🤔 왜 K8s로 마이그레이션?

### 챌린지 요구사항

부트캠프 과제로 "기존 애플리케이션을 K8s로 전환"이라는 미션이 있었습니다. 네임스페이스 분리, 서비스 타입 활용, 스토리지 관리 같은 K8s 핵심 개념을 익히는 게 목표입니다.

### 실무 학습 목적

기존 과제는 구조만 이럴꺼다 하는 빈 프로젝트를 마이그레이션 해보자 였지만, 실제 프로젝트를 마이그레이션하면서 부딪혀보는 게 나중에 도움이 될 것 같아서 팀에서 진행하던 wealist 프로젝트를 마이그레이션 해보기로 하였습니다.

Docker Compose는 단일 서버에서 돌아가다 보니, 나중에 트랙픽이 늘거나 하면 스케일 아웃을 수동으로 하거나 해야되다보니 불편하지만, k8s 로 구축을 하게되면 자동 스케일 아웃 인을 설정할 수 있기 때문에 더 유연하다고 볼 수 있습니다.

## 📋 마이그레이션 전략

### 완성된 것부터 단계적으로

실무에서도 모든 서비스를 한 번에 전환하진 않는다고 합니다. 우리도 마찬가지로 나와있는것 부터 마이그레이션 해보기로 하였습니다.

**Phase 1 (이번)**: 게시판 + 프론트 + PostgreSQL
- ✅ FastAPI 백엔드 (게시판)
- ✅ React 프론트 (nginx)
- ✅ PostgreSQL DB

**Phase 2 (나중에)**: 회원 서비스 추가
- ⏸️ Spring Boot 백엔드 (회원)
- ⏸️ Redis 캐시

완성된 게시판과 프론트만 먼저 전환을 시도하고,나중에 회원 서비스를 추가할 예정입니다.

### 기술 스택 선택

**로컬 클러스터: k3d**

Minikube나 k3s도 있지만, k3d를 선택했습니다.
- Docker 컨테이너로 실행 (WSL2에서 안정적)
- 멀티 노드 클러스터 구성 가능
- 로컬 이미지 바로 사용 가능 (`k3d image import`)

**네임스페이스 분리**

```
- board-api-prod: 게시판 백엔드
- front-prod: 프론트엔드
- postgresql-prod: 데이터베이스
```

서비스별로 네임스페이스를 나눠서 리소스를 관리했습니다. 나중에 dev 환경도 추가할 수 있게 `-prod` suffix를 붙여서 만들었습니다.

## 🎯 핵심 과제들

이번 마이그레이션에서 집중적으로 다룰 부분들은 다음과 같습니다.(상세설명은 각 part 에서 하겠습니다)

### StatefulSet vs Deployment

PostgreSQL 같은 데이터베이스는 Deployment가 아니라 **StatefulSet**을 사용합니다.

### Secret 관리

DB 비밀번호 같은 민감 정보는 ConfigMap이 아니라 **Secret**으로 관리합니다. 일단 여기서는 Base64 인코딩만 사용하고(실무에선 더 강력하게), 네임스페이스마다 따로 만들어야 합니다.

### 크로스 네임스페이스 통신

`board-api-prod` 네임스페이스의 Pod가 `postgresql-prod` 네임스페이스의 DB에 접근하려면 어떻게 해야 할까?

```bash
# 같은 네임스페이스: 
postgres-service

# 다른 네임스페이스:
postgres-service.postgresql-prod.svc.cluster.local
```


## 💭 한번 더 생각해볼 질문들

**Q1**: Docker Compose에서 `depends_on`을 썼는데, K8s에서는 서비스 간 시작 순서를 어떻게 보장할까?

---

**Q2**: 네임스페이스를 나눴는데, 만약 백엔드가 프론트엔드의 API를 호출해야 한다면? (서로 다른 네임스페이스)

---

**Q3**: 로컬에서 k3d로 개발하다가 실제 클라우드(EKS, GKE)로 배포할 때 뭘 바꿔야 할까?


## 🎯 추가 학습

- Docker Compose와 K8s 리소스 매핑
- 로컬 개발 환경 비교 (Minikube vs k3d vs kind)
- 마이그레이션 체크리스트

## 🔗 참고
- **[📂 프로젝트 GitHub 저장소](https://github.com/ressKim-io/wealist-k8s-migration)**
  - [K8s Manifests](https://github.com/ressKim-io/wealist-k8s-migration/tree/main/k8s-manifests)
- **[원본 프로젝트]**
  - [Backend (FastAPI)](https://github.com/OrangesCloud/weAlist-Board)
  - [Frontend (React)](https://github.com/OrangesCloud/weAlist-Front)
- [k3d 공식 문서](https://k3d.io/)
- [Kubernetes Namespace 공식 문서](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/)
