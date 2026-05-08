---
title: "GCP prod 전체 destroy — VPC Service Networking peering이 안 풀린다"
excerpt: "프로젝트 종료 후 GCP 비용 제로를 목표로 terraform destroy를 진행하던 중, 이미 삭제된 Memorystore Redis의 peering이 Google 백엔드에 잔존해 Service Networking Connection 삭제가 막혔습니다. Google 비동기 cleanup의 함정과 수동 처리 절차를 기록합니다"
type: troubleshooting
category: challenge
tags:
  - go-ti
  - GCP
  - VPC
  - Terraform
  - Memorystore
  - destroy
  - troubleshooting
series:
  name: "goti-multicloud"
  order: 15
date: "2026-04-21"
---

## 한 줄 요약

> 13단계 destroy 중 마지막 step 13(network)에서 멈췄습니다. 이미 삭제한 Memorystore Redis의 peering이 Google 백엔드에 아직 살아 있어, Service Networking Connection 삭제가 "Producer services 사용 중" 오류로 거부됐습니다

---

## 🔥 문제: 마지막 step에서 VPC peering이 풀리지 않습니다

프로젝트 최종 발표가 종료되어 GCP 비용 제로를 목표로 `terraform/prod-gcp` 전체 destroy를 진행했습니다.

destroy 시작 전에 스크립트를 두 곳 수정했습니다.

- `PROJECT_ID`를 project number(`444455556666`)에서 project ID(`PROJECT_ID`)로 정정
- 2026-04-18 Cloud SQL → GCE VM 전환 이후 미반영되어 있던 `pg-primary` destroy step을 [10/13]으로 추가

13단계 진행 결과는 다음과 같습니다.

| Step | 결과 | 비고 |
|------|------|------|
| 2 ArgoCD finalizer 제거 | ✅ | 36 application + 5 namespace |
| 3 bootstrap destroy | ✅ (fallback 적용) | Application 10개 finalizer가 controller 사라지기 전 복원되어 재제거 필요. `state rm kubernetes_namespace.argocd/external_secrets` 후 재시도 성공 |
| 4 compute destroy | ✅ | 노드 5대 정지 (~$1.35/hr) |
| 5 config destroy | ✅ | Secret Manager 127개 |
| 6 GCS 버킷 비우기 | ✅ | `gsutil -m rm -r gs://.../**` (1 file 경고는 무시 OK) |
| 7 storage destroy | ✅ | 3 buckets |
| 8 registry destroy | ✅ | Artifact Registry |
| 9 database destroy | ✅ | Memorystore Redis |
| 10 pg-primary destroy | ✅ | 11 resources (VM + EXT IP + Secret) |
| 11 kms destroy | ✅ | 7 resources. CryptoKey 2개는 90일 scheduled destruction |
| 12 GKE cluster destroy | ✅ | 11 resources |
| 13 network destroy | ⚠️ Partial | subnet/firewall×2/router/NAT 5개는 정리, **VPC/peering/reserved-IP 3개 stuck** |

step 9에서 Memorystore Redis를 포함해 database 관련 리소스를 모두 삭제했습니다. 그런데 step 13에서 다음 오류와 함께 멈췄습니다.

```text
Error: Unable to remove Service Networking Connection, err: Error waiting
for Delete Service Networking Connection: Error code 9, message: Failed
to delete connection; Producer services (e.g. CloudSQL, Cloud Memstore,
etc.) are still using this connection.
```

오류 메시지가 Cloud SQL과 Memstore를 예시로 드는데, 두 서비스 모두 이미 삭제된 상태였습니다.

---

## 🤔 원인: Google 백엔드의 비동기 peering cleanup

증상과 실제 상태를 맞춰봤습니다.

- Cloud SQL: step 9 이전에 삭제 완료
- Memorystore Redis: step 9에서 삭제 완료
- pg-primary VM: step 10에서 삭제 완료

세 Producer service가 전부 없는데도 "사용 중"으로 표시되는 이유를 추적했습니다.

VPC peering 목록을 조회했을 때 `redis-peer-XXXXXXXXXX`가 아직 존재했습니다. Memorystore Redis 인스턴스는 사라졌지만, 그 인스턴스가 생성했던 VPC peering은 Google 백엔드에서 비동기로 정리되기 때문에 아직 ACTIVE 상태로 남아 있었습니다.

Service Networking Connection은 이 잔존 peering을 보고 "Producer service가 아직 연결돼 있다"고 판단합니다. Terraform은 이 상태에서 Connection 삭제를 시도했고, Google API가 Error code 9(FAILED_PRECONDITION)로 거부했습니다.

Google Issue Tracker [178876281](https://issuetracker.google.com/178876281)에 동일 케이스가 보고되어 있습니다. Google 백엔드 cleanup은 최대 24시간까지 지연될 수 있습니다.

---

## ✅ 해결: Redis peering 수동 삭제 후 재시도

비동기 cleanup이 완료될 때까지 기다리거나, 잔존 peering을 수동으로 제거하는 두 경로가 있었습니다. 수동 삭제를 먼저 시도했습니다.

### 1단계: Redis peering 수동 삭제

```bash
# 잔존 redis-peer 수동 삭제
gcloud compute networks peerings delete redis-peer-XXXXXXXXXX \
  --network=goti-prod-vpc \
  --project=PROJECT_ID \
  --quiet
```

이 명령은 성공했습니다.

### 2단계: Service Networking peering 비동기 삭제 요청

```bash
gcloud services vpc-peerings delete \
  --network=goti-prod-vpc \
  --service=servicenetworking.googleapis.com \
  --project=PROJECT_ID \
  --async
```

`--async` 플래그를 붙였기 때문에 명령은 즉시 반환됩니다. 실제 삭제는 Google이 비동기로 처리합니다.

### 3단계: 상태 확인 후 재시도

2분 간격으로 peering 목록을 확인했습니다.

```bash
gcloud compute networks peerings list \
  --network=goti-prod-vpc \
  --project=PROJECT_ID
```

2분 이내에는 `servicenetworking-googleapis-com`이 여전히 ACTIVE 상태였습니다.
당일 재시도에서 같은 오류가 반복되어, 다음 날 재시도로 결정했습니다.

### 다음 날 재시도 절차

```bash
# 1. peering 상태 확인 — servicenetworking이 사라졌는지 확인
gcloud compute networks peerings list \
  --network=goti-prod-vpc \
  --project=PROJECT_ID

# 2. 사라졌으면 network 모듈만 재시도
terraform destroy -target=module.network -auto-approve

# 3. 아직 ACTIVE면 async delete 재요청 후 1~2시간 대기
gcloud services vpc-peerings delete \
  --network=goti-prod-vpc \
  --service=servicenetworking.googleapis.com \
  --project=PROJECT_ID \
  --async
```

### 당일 잔존 리소스 현황

당일 종료 시점에 남아 있는 리소스는 다음 세 개였습니다.

```text
module.network.google_compute_global_address.private_services  # reserved IP range
module.network.google_compute_network.this                     # VPC
module.network.google_service_networking_connection.this       # peering
```

VPC, peering, reserved IP range는 실제로 사용하지 않으면 과금이 없습니다. **청구서 영향: $0** — 다음 날 재시도 전까지 방치해도 비용이 발생하지 않았습니다.

---

## 📚 배운 점

- **Service Networking peering cleanup은 비동기입니다** — Memorystore Redis를 삭제해도 Google이 VPC peering을 정리하는 데 수 분~수십 분이 걸립니다. destroy 직후 network 모듈을 시도하면 "Producer services 사용 중" 오류가 발생합니다. redis-peer처럼 Terraform 관리 밖에 있는 peering은 `gcloud compute networks peerings delete`로 수동 삭제해야 합니다
- **destroy.sh의 PROJECT_ID는 project ID(string)를 써야 합니다** — project number(숫자)도 일부 gcloud 명령에서 동작하지만, Terraform과 혼용하면 혼란이 생깁니다. destroy 스크립트에서 명시적으로 project ID로 통일합니다
- **후행 추가된 모듈은 destroy 스크립트에 즉시 반영합니다** — `pg-primary`는 2026-04-18에 Cloud SQL에서 GCE VM으로 전환되면서 추가됐지만, destroy.sh에 반영하지 않았습니다. 모듈이 추가될 때마다 destroy 순서를 함께 업데이트해야 누락이 없습니다
- **잔존 리소스가 무료인지 먼저 확인합니다** — VPC, peering, reserved IP range는 실사용이 없으면 비용이 발생하지 않습니다. 비용 영향이 없다면 Google 비동기 처리를 기다렸다가 다음 날 재시도하는 것이 강제 삭제 시도보다 안전합니다
- **ArgoCD finalizer가 있는 리소스는 Terraform state에서 먼저 제거합니다** — bootstrap destroy 중 Application finalizer가 controller가 사라진 뒤에도 복원되는 케이스가 발생했습니다. `terraform state rm`으로 상태를 제거한 뒤 재시도하면 풀립니다
