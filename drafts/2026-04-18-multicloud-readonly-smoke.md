# 2026-04-18 멀티클라우드 read-only smoke (Phase B 관측)

- 목적: CF Worker → AWS EKS + GCP GKE 양쪽에 2분 read-only 트래픽 → Grafana 에서 p95/rps/cpu cloud 별 비교
- 실행 시점: 저녁 AWS EKS 기동 + pglogical subscription `replicating` 확인 후
- Script: `infra/ops/phase-b-pglogical/load-test-multicloud-readonly.js`

## 사전 체크리스트

- [ ] AWS EKS ASG ≥ 10 node (core 5 + spot 5), 앱 pod 전부 Ready
  ```bash
  kubectl --context=aws-goti-prod get nodes --no-headers | wc -l   # 10 이상
  kubectl --context=aws-goti-prod get pods -n goti --no-headers | grep -c Running
  ```
- [ ] AWS monitoring stack 정상 (Mimir/Grafana Running, query-frontend endpoints 존재)
  ```bash
  kubectl --context=aws-goti-prod get pods -n monitoring --no-headers | head
  kubectl --context=aws-goti-prod get ep mimir-prod-query-frontend -n monitoring
  ```
- [ ] pglogical subscription 상태 확인 (AWS 쪽)
  ```bash
  # master password K8s Secret + pod 에서
  psql -h <rds-endpoint> -U goti -d goti -c \
    "SET default_transaction_read_only=off; SELECT status, slot_name FROM pglogical.show_subscription_status();"
  # expected: status=replicating
  ```
- [ ] CF Worker 정상 (samsung/doosan 팀 코드 분배 작동)
  ```bash
  curl -s -w "%{http_code} %{time_total}s\n" -o /dev/null https://go-ti.shop/api/v1/games/schedules?today=true
  ```
- [ ] **orders/payments 정합성 복구 완료** (선택 — 왜곡 회피용)
  - 안 하면 양쪽 row count 가 달라서 대시보드에서 이상해 보일 수 있음
  - 복구 절차는 `docs/runbooks/db-failover-failback.md` 참조 또는 별도 작업

## 실행

```bash
cd /Users/ress/my-file/tech-up/goti-team-project/goti-team-controller/infra/ops/phase-b-pglogical

# 기본 (5 VU, 2분)
k6 run -e BASE_URL=https://go-ti.shop load-test-multicloud-readonly.js

# 확장 (시연 인상 강화: 10 VU, 5분)
k6 run -e BASE_URL=https://go-ti.shop -e VUS=10 -e DURATION=5m load-test-multicloud-readonly.js
```

## 관측 포인트 (Grafana `monitoring.go-ti.shop`)

### 1. `multi-cloud-compare` 대시보드
- panel: **p99 per cluster** — aws/gcp 양쪽 선이 동시에 뜨는지
- panel: **error rate** — 0 유지 (read-only 라 이상 없음)
- panel: **requests per cluster** — CF Worker 분배 비율 확인

### 2. `pglogical-replication` 관련 (있으면)
- replication lag 변화 없음 (read 만이라 WAL 미생성)
- subscription status `replicating`

### 3. `istio-ingress` 대시보드
- AWS Istio gateway rps
- GCP Istio gateway rps
- 합계 = k6 요청 × 2 endpoints / 2초 sleep

### 4. `pod/cpu` (각 cloud)
- aws goti-user / ticketing / stadium 중 호출된 서비스 CPU spike
- gcp goti-user-prod-gcp 도 동일

## 예상 결과 (에러 없음 시나리오)

```json
{
  "duration": "120s",
  "vus": 5,
  "total_requests": "~600",
  "rps": "5.0",
  "failed_rate": 0,
  "p95_ms": "<2000",
  "p99_ms": "<5000"
}
```

- 양쪽 cloud 에 약 300 req 씩 (CF Worker 분배)
- 에러 0 (read-only 라 쓰기 차단 영향 없음)
- Grafana 대시보드에 aws/gcp 양 선 동시 표시 → **멀티클라우드 active-active read 증명 완료**

## 트러블슈팅

| 증상 | 원인 | 조치 |
|------|------|------|
| `no healthy upstream` | AWS monitoring pod readiness 지연 | 1~2분 대기 후 재시도 |
| 502 / 503 | AWS 쪽 앱 pod 아직 기동 중 | `kubectl rollout status` 확인 |
| 401 | 정상 (인증 없는 요청 일부) | 무시 |
| p95 > 5s | CF Worker LAX 라우팅 이슈 (메모리 참조) | Smart Placement / APAC hint 확인 |

## 완료 후

- K6 결과 JSON 캡처 → `docs/screenshots/phase-b-readonly-*.png` 또는 `.json`
- Grafana 스크린샷 → 멀티클라우드 aws/gcp 비교 panel
- dev-log 업데이트 (본 문서 시연 결과 블록 채우기)

## 확장 시나리오 (선택)

### Failover 시연 추가
현 smoke 중 30초 지점에 GCP VM stop → CF Worker 가 AWS 로 전환 → 양쪽 rps 변화 관측

```bash
# 별도 터미널에서 smoke 30초 후 실행
gcloud compute instances stop goti-prod-pg-primary --zone=asia-northeast3-a --project=project-7b8317dd-9b4d-4f5f-ba2

# 시연 종료 후 재시작
gcloud compute instances start goti-prod-pg-primary --zone=asia-northeast3-a --project=project-7b8317dd-9b4d-4f5f-ba2
```

주의: GCP 앱이 VM 에 붙어있으므로 VM stop 시 앱도 먹통. CF Worker 가 AWS 로 넘김. AWS 는 read_only 라 read 만 성공 (smoke 는 read 만이라 계속 성공).

### 결과 기록 블록 (시연 후 작성)

- 실 실행 시각:
- 소요:
- 결과 JSON:
- Grafana 링크:
- 관찰점:
