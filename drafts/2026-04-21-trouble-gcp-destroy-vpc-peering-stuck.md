# 2026-04-21 — GCP prod 전체 destroy 중 VPC Service Networking peering stuck

## 배경

프로젝트 최종 발표 종료, **GCP 비용 0 만들기** 목표로 `terraform/prod-gcp` 전체 destroy 진행.

- destroy.sh 선 수정:
  - `PROJECT_ID="444455556666"` → `"project-xxxxxxxx-xxxx-xxxx-xxx"` (잘못된 project number였음)
  - `pg-primary` destroy step 누락 → [10/13] 추가 (2026-04-18 Cloud SQL→GCE VM 전환 이후 스크립트 미반영)

## 진행 결과

| Step | 결과 | 비고 |
|---|---|---|
| 2 ArgoCD finalizer 제거 | ✅ | 36 application + 5 namespace |
| 3 bootstrap destroy | ✅ (fallback 적용) | Application 10개 finalizer가 controller 사라지기 전 복원되어 재제거 필요. state rm `kubernetes_namespace.argocd/external_secrets` 후 재시도 성공 |
| 4 compute destroy | ✅ | 노드 5대 정지 (~$1.35/hr) |
| 5 config destroy | ✅ | Secret Manager 127개 |
| 6 GCS 버킷 비우기 | ✅ | `gsutil -m rm -r gs://.../**` (1 file 경고는 무시 OK) |
| 7 storage destroy | ✅ | 3 buckets |
| 8 registry destroy | ✅ | Artifact Registry |
| 9 database destroy | ✅ | Memorystore Redis |
| 10 pg-primary destroy | ✅ | 11 resources (VM + EXT IP + Secret) |
| 11 kms destroy | ✅ | 7 resources. CryptoKey 2개는 90일 scheduled destruction (비용 미미) |
| 12 GKE cluster destroy | ✅ | 11 resources |
| 13 network destroy | ⚠️ **Partial** | subnet/firewall×2/router/NAT 5개는 정리, **VPC/peering/reserved-IP 3개 stuck** |

## Step 13 에러

```
Error: Unable to remove Service Networking Connection, err: Error waiting
for Delete Service Networking Connection: Error code 9, message: Failed
to delete connection; Producer services (e.g. CloudSQL, Cloud Memstore,
etc.) are still using this connection.
```

## 원인 분석

- Cloud SQL / Memorystore Redis / pg-primary 모두 이미 destroy 완료
- 그런데 Google 백엔드에서 "Producer services 사용 중"으로 표시
- VPC peering 조회 시 `redis-peer-555566667777` 가 destroy된 Redis 인스턴스의 peering으로 잔존
- 메모리 이슈: Google-managed VPC peering cleanup이 비동기 + 지연
- Google Issue Tracker: https://issuetracker.google.com/178876281 — 동일 케이스 보고됨, 최대 24시간 지연 가능

## 수동 정리 시도

```bash
# 1) Redis peer 수동 삭제 — 성공
gcloud compute networks peerings delete redis-peer-555566667777 \
  --network=goti-prod-vpc --project=project-xxxxxxxx-xxxx-xxxx-xxx --quiet

# 2) servicenetworking peering async 삭제 요청 — 진행 중 (async operation)
gcloud services vpc-peerings delete --network=goti-prod-vpc \
  --service=servicenetworking.googleapis.com \
  --project=project-xxxxxxxx-xxxx-xxxx-xxx --async

# 3) 2분 polling — servicenetworking-googleapis-com 여전히 ACTIVE
# 4) terraform destroy -target=module.network 재시도 — 같은 에러 반복
```

async operation이 2분 동안 정리되지 않음. 더 긴 대기 필요.

## 현재 잔존 리소스 (전부 무료)

```
module.network.google_compute_global_address.private_services  # reserved IP range
module.network.google_compute_network.this                     # VPC
module.network.google_service_networking_connection.this       # peering
+ data sources 2개 (무시 가능)
```

**청구서 영향: $0** — VPC/peering/reserved-IP-range는 사용 안 하면 무료.

## 회귀 방지 / 운영 노트

1. **destroy.sh의 PROJECT_ID는 반드시 project ID (string), project number 아님**
   - `gcloud` 명령에 project number 넣어도 동작하긴 하지만 섞이면 혼란
2. **pg-primary 처럼 후행 추가된 모듈은 destroy.sh에도 반영** (2026-04-18 도입 당시 미반영)
3. **Service Networking peering cleanup은 비동기**
   - Producer service(Cloud SQL / Memstore) destroy 후에도 Google 백엔드에서 peering 정리에 수 분~수 시간 걸림
   - redis-peer 같은 잔존 peering은 수동 삭제 가능
   - servicenetworking-googleapis-com peering은 Google async, 강제 방법 없음 → 대기 외 답 없음
4. **해결 실패 시에도 비용 영향 없음** — 무료 리소스라 방치 가능

## 내일(2026-04-22) 재시도 절차

```bash
cd /Users/ress/my-file/tech-up/goti-team-project/Goti-Terraform/terraform/prod-gcp

# 1. peering 상태 확인 — servicenetworking 사라졌는지
gcloud compute networks peerings list --network=goti-prod-vpc \
  --project=project-xxxxxxxx-xxxx-xxxx-xxx

# 2. 사라졌으면 바로 destroy
terraform destroy -target=module.network -auto-approve

# 3. 아직 ACTIVE면 한 번 더 async delete 요청 후 대기
gcloud services vpc-peerings delete --network=goti-prod-vpc \
  --service=servicenetworking.googleapis.com \
  --project=project-xxxxxxxx-xxxx-xxxx-xxx --async
# 그 후 1-2시간 뒤 다시 polling
```

## 후속 작업 (미완료)

- [ ] Step 13 완료 (VPC/peering/reserved-IP 정리) — 2026-04-22 재시도
- [ ] Phase 3: Cloudflare DNS (`gcp-api.go-ti.shop`, Worker `dev.go-ti.shop`) 정리
- [ ] Phase 3: WIF Provider / Service Account (`gh_actions_*`) 정리 — GitHub Actions가 GCP WIF 사용 중이었음
- [ ] KMS CryptoKey 90일 scheduled destruction은 방치 (비용 미미, 방치 문제 없음)
- [ ] GCP 콘솔에서 최종 $0 확인
