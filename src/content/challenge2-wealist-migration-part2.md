---
title: '팀 프로젝트 K8s 마이그레이션 - Part 2: PostgreSQL StatefulSet'
excerpt: 왜 데이터베이스는 StatefulSet을 써야 할까?
category: challenge
tags:
  - bootcamp
  - statefulset
  - deployment
  - postgresql
  - pvc
  - storage
  - retrospective
date: '2025-10-20'
series:
  name: challenge-2-wealist-migration
  order: 2
---

## 🎯 핵심 개념

데이터베이스를 K8s에 올릴 때 가장 먼저 마주치는 질문이 있습니다.
- "Deployment를 쓸까, StatefulSet을 쓸까?"

결론부터 말하면, **데이터베이스는 무조건 StatefulSet**입니다. 왜 그런지 하나씩 확인해보겠습니다.

## 💡 StatefulSet vs Deployment

### Deployment는 뭐가 문제일까

Deployment로 PostgreSQL을 띄우면 어떻게 될까

```yaml
# ❌ 이렇게 하면 안 됩니다!!
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
spec:
  replicas: 3  # Pod 3개
  template:
    spec:
      containers:
      - name: postgres
        image: postgres:16-alpine
```

이렇게 하면 PostgreSQL Pod가 3개 뜹니다. 각 Pod는 **완전히 독립적**입니다.

**문제 1: 이름이 랜덤**
```
postgres-7d9f8c4b5-abc12
postgres-7d9f8c4b5-def34
postgres-7d9f8c4b5-ghi56
```

Pod가 재시작되면 매번 이름이 바뀝니다. 그렇게 되면 어떤 Pod가 메인 DB인지 알 수 없습니다.

**문제 2: 볼륨 공유 불가**

Deployment는 모든 Pod가 같은 PVC를 사용합니다.
PostgreSQL 같은 DB는 동시에 여러 프로세스가 같은 데이터 파일을 쓰면 **데이터가 깨집니다**.

**문제 3: 순서 보장 안 됨**

DB 클러스터는 보통 Primary → Replica 순서로 띄워야 합니다.
Deployment는 Pod를 무작위로 띄우니까 순서를 보장할 수 없습니다.

### StatefulSet은 어떻게 다를까

```yaml
# ✅ 데이터베이스는 이렇게
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
spec:
  replicas: 1
  serviceName: postgres-service
  template:
    spec:
      containers:
      - name: postgres
        image: postgres:16-alpine
  volumeClaimTemplates:
  - metadata:
      name: postgres-data
    spec:
      accessModes: [ "ReadWriteOnce" ]
      resources:
        requests:
          storage: 5Gi
```

StatefulSet은 이런 차이가 있습니다.

**특징 1: 고정된 이름**
```
postgres-0  # 항상 같은 이름
```

Pod가 재시작해도 이름이 안 바뀝니다. `postgres-0`은 항상 `postgres-0`입니다.

**특징 2: 각 Pod마다 전용 볼륨**

`volumeClaimTemplates`를 쓰면 Pod마다 PVC를 자동으로 만들어줍니다.

```
postgres-0 → postgres-data-postgres-0 (5Gi)
postgres-1 → postgres-data-postgres-1 (5Gi)
postgres-2 → postgres-data-postgres-2 (5Gi)
```

각 Pod가 독립적인 저장소를 갖습니다. 데이터가 섞이지 않습니다.

**특징 3: 순서 보장**

Pod를 0, 1, 2 순서대로 띄웁니다. `postgres-1`은 `postgres-0`이 Ready 상태가 될 때까지 기다립니다.

삭제할 때도 역순(2, 1, 0)으로 진행합니다. Primary DB를 마지막에 내리도록 구축이 되어있습니다. 

## 📌 실전: PostgreSQL StatefulSet 작성

이제 실제로 작성해보겠습니다.

### 1. Namespace 준비

```yaml
# 1-namespaces/namespaces.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: postgresql-prod
  labels:
    environment: production
    project: wealist-db
```

데이터베이스는 독립된 네임스페이스로 분리하도록 합시다.

### 2. PVC용 StorageClass 확인

```bash
kubectl get storageclass

# k3d는 기본 StorageClass 제공
NAME                   PROVISIONER             RECLAIMPOLICY
local-path (default)   rancher.io/local-path   Delete
```

k3d는 `local-path`라는 StorageClass를 기본 제공합니다. 별도 설정 없이 바로 PVC를 만들 수 있습니다.

**⚠️ 실무 환경에서는?**

실제 클라우드에서는 클라우드 제공자의 StorageClass를 사용해야 합니다.
```yaml
# AWS EKS
storageClassName: gp3  # EBS 볼륨

# GCP GKE  
storageClassName: standard  # Persistent Disk

# Azure AKS
storageClassName: managed-premium  # Azure Disk
```

로컬 개발(k3d)에서는 `local-path`로 테스트하고, 실제 배포할 때 StorageClass만 바꾸면 됩니다.
나머지 PVC 설정은 거의 동일합니다.

**사용 빈도: ⭐⭐⭐ (실무 필수)**
- 로컬: local-path, hostPath
- 클라우드: 각 제공자의 기본 StorageClass
- 온프레미스: NFS, Ceph, Longhorn 등

### 3. PostgreSQL StatefulSet

```yaml
# 4-database/postgres-statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: postgresql-prod
spec:
  serviceName: postgres-service
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
      - name: postgres
        image: postgres:16-alpine
        ports:
        - containerPort: 5432
          name: postgres
        env:
        - name: POSTGRES_DB
          value: "wealist"
        - name: POSTGRES_USER
          value: "postgres"
        - name: POSTGRES_PASSWORD
          value: "mysupersecret"
        - name: PGDATA
          value: "/var/lib/postgresql/data/pgdata"
        volumeMounts:
        - name: postgres-data
          mountPath: /var/lib/postgresql/data
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "200m"
  volumeClaimTemplates:
  - metadata:
      name: postgres-data
    spec:
      accessModes: [ "ReadWriteOnce" ]
      resources:
        requests:
          storage: 5Gi
```

하나씩 살펴 보겠습니다.

### serviceName: 헤드리스 서비스

```yaml
serviceName: postgres-service
```

StatefulSet은 반드시 **헤드리스 서비스**(ClusterIP: None)가 필요합니다.
각 Pod에 안정적인 네트워크 ID를 부여하기 위해서입니다.

```yaml
# 4-database/postgres-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: postgres-service
  namespace: postgresql-prod
spec:
  clusterIP: None  # 헤드리스!
  selector:
    app: postgres
  ports:
  - port: 5432
    targetPort: 5432
```

이렇게 하면 Pod에 다음 DNS가 생깁니다.

```
postgres-0.postgres-service.postgresql-prod.svc.cluster.local
```

### PGDATA 경로 지정

```yaml
env:
- name: PGDATA
  value: "/var/lib/postgresql/data/pgdata"
```

PostgreSQL은 데이터 디렉토리를 볼륨 루트 바로 아래에 두면 문제가 생깁니다.

`lost+found` 같은 시스템 파일과 충돌하기 때문입니다.

`/var/lib/postgresql/data/pgdata` 처럼 서브디렉토리를 명시해야 합니다.

### volumeClaimTemplates

```yaml
volumeClaimTemplates:
- metadata:
    name: postgres-data
  spec:
    accessModes: [ "ReadWriteOnce" ]
    resources:
      requests:
        storage: 5Gi
```

StatefulSet은 Pod마다 PVC를 자동 생성합니다.

- `ReadWriteOnce`: 하나의 노드에서만 읽기/쓰기
- `storage: 5Gi`: 5GB 할당

replicas가 3이면 PVC도 3개 만들어집니다.

### 배포 및 확인

```bash
# 배포
kubectl apply -f k8s-manifests/1-namespaces/
kubectl apply -f k8s-manifests/4-database/

# Pod 확인
kubectl get pods -n postgresql-prod

# PVC 확인
kubectl get pvc -n postgresql-prod

# 상세 정보
kubectl describe statefulset postgres -n postgresql-prod
```

정상이면 이렇게 뜹니다.

![PostgreSQL StatefulSet 실행](/images/challenge2/part2-statefulset-running.png)

```bash
NAME         READY   STATUS    RESTARTS   AGE
postgres-0   1/1     Running   0          2m

NAME                              STATUS   VOLUME          CAPACITY
postgres-data-postgres-0          Bound    pvc-abc123...   5Gi
```

## ⚠️ 주의사항

### replicas: 1부터 시작

```yaml
# ✅ 처음엔 1개
replicas: 1

# ❌ 처음부터 3개 하지 말기
replicas: 3
```

PostgreSQL 클러스터 구성은 복잡합니다.

Primary/Replica 설정, 레플리케이션 슬롯 등 추가 작업이 필요합니다.

단일 인스턴스로 먼저 검증한 뒤, 나중에 클러스터로 확장하는 게 안전합니다.

### PVC는 삭제 안 됨

StatefulSet을 삭제해도 **PVC는 남습니다**.

```bash
# StatefulSet 삭제
kubectl delete statefulset postgres -n postgresql-prod

# PVC는 여전히 존재
kubectl get pvc -n postgresql-prod
```

실수로 StatefulSet을 지워도 데이터는 보존됩니다.

PVC도 지우려면 명시적으로 삭제해야 합니다.

```bash
kubectl delete pvc postgres-data-postgres-0 -n postgresql-prod
```

### 환경변수는 Secret으로

```yaml
# ❌ 지금은 평문
env:
- name: POSTGRES_PASSWORD
  value: "mysupersecret"

# ✅ Secret 사용 (Part 3에서)
env:
- name: POSTGRES_PASSWORD
  valueFrom:
    secretKeyRef:
      name: db-secret
      key: POSTGRES_PASSWORD
```

지금은 평문으로 뒀지만, 실무에서는 절대 이러면 안 됩니다. 다음 Part에서 바꿀 예정입니다.

## 정리

데이터베이스는 StatefulSet을 써야 합니다.

고정된 이름, 독립적인 볼륨, 순서 보장이 필요하기 때문입니다.

`volumeClaimTemplates`로 Pod마다 전용 PVC를 자동 생성할 수 있고,

k3d의 기본 StorageClass 덕분에 별도 설정 없이 바로 쓸 수 있었습니다.

다음 Part에서는 백엔드 API를 배포하면서 Secret 관리와 크로스 네임스페이스 통신을 다뤄보겠습니다.

## 💭 한번 더 생각해볼 질문들

**Q1**: StatefulSet의 Pod를 강제로 삭제하면 어떻게 될까요? (kubectl delete pod --force)

---

**Q2**: `volumeClaimTemplates` 대신 수동으로 PVC를 만들어서 쓸 수 있을까요?

---

**Q3**: Deployment로 DB를 운영하는 건 정말 불가능할까요?


## 🎯 추가 학습

- PostgreSQL Replication (Primary-Replica 구성)
- StatefulSet의 PodManagementPolicy (Parallel vs OrderedReady)
- PVC Reclaim Policy (Retain vs Delete)

## 🔗 참고
- **[📂 프로젝트 GitHub 저장소](https://github.com/ressKim-io/wealist-k8s-migration)**
  - [PostgreSQL StatefulSet YAML](https://github.com/ressKim-io/wealist-k8s-migration/tree/main/k8s-manifests/4-database)
- [Kubernetes StatefulSet 공식 문서](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)
- [PostgreSQL on Kubernetes 모범 사례](https://kubernetes.io/docs/tutorials/stateful-application/basic-stateful-set/)
