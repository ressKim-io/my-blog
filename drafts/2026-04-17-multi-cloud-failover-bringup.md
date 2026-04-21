# 2026-04-17 — Multi-Cloud Failover 관측 파이프라인 bring-up (GCP)

## 목표

Cloudflare Worker `multicloud-router` 의 AWS/GCP 라우팅 분배와 GCP 장애 시 AWS 100% 전환을 **영상 촬영 가능한 수준의 라이브 대시보드**로 관측. 양쪽 cluster 어느 쪽 Grafana 에서 봐도 동일 데이터 확보.

## 결론 (한 줄)

GCP 쪽 파이프라인 **end-to-end 동작 검증**. CF Worker → `goti-load-observer` sink → Prometheus → `d/goti-multi-cloud-failover`. AWS 쪽은 ASG=0 대기 (재기동 후 수 분 작업으로 완성).

## 핵심 설계 결정

1. **진실은 Worker 의 라우팅 결정 자체** — origin 도달 메트릭은 중간 실패/circuit open 을 놓침. Worker 가 직접 emit 해야 함.
2. **cloudflare-exporter 는 zone 단위라 cloud 분리 불가** — 메트릭 소스로 부적절.
3. **양쪽 cluster 동일 뷰** 를 위해 Worker 가 `aws-api` + `gcp-api` 양쪽으로 fanout (`ctx.waitUntil` fire-and-forget).
4. **수집 방식** — Workers Analytics Engine 은 1~2분 지연으로 라이브 데모 부적합 → 커스텀 HTTP sink 채택.

## 아키텍처

```
CF Worker ──ctx.waitUntil(Promise.allSettled([
    fetch('https://aws-api.go-ti.shop/__worker-metrics/ingest'),
    fetch('https://gcp-api.go-ti.shop/__worker-metrics/ingest'),
]))──▶

  [AWS EKS]                    [GCP GKE]          ← 각 cluster
   Istio Gateway                Istio Gateway
     │                            │
     └─/__worker-metrics ──▶     └─/__worker-metrics ──▶
         goti-load-observer          goti-load-observer
           │                            │
         Prom scrape                  Prom scrape (향후)
           │
       Grafana: Multi-Cloud Failover (17 panel)
```

## 작업 내역 (5 레포)

### goti-load-observer (개인 레포)
- `internal/ingest/handler.go` 추가 — POST `/__worker-metrics/ingest` (shared-token 인증, 4KB cap, cardinality bounded labels)
- registry 확장: `goti_worker_{requests,failover,circuit_opens,request_duration,ingest_errors}` 5종
- `.github/workflows/cd-gcp.yml` 추가 — GCP Artifact Registry push + Goti-k8s PR 자동 생성
- commits: `7795425`, `a37b622`, `cc57b0f`

### Goti-k8s (인프라 레포)
- `environments/prod/goti-load-observer/values.yaml` — gateway.enabled + `aws-api.go-ti.shop/__worker-metrics/*` → load-observer-prod
- `environments/prod-gcp/goti-load-observer/values.yaml` — 동일 패턴, `gcp-api.go-ti.shop`
- 2026-04-17 수정: GCP 쪽 `gatewayRef: "istio-system/..."` → `"istio-ingress/..."` (네임스페이스 차이)
- commits: `85a68ab`, `d8ed57f`

### Goti-monitoring
- `grafana/dashboards/devops/multi-cloud-failover.json` + `charts/goti-monitoring/` 동기 복사 — 17 panel
- 파이(AWS/GCP 라우팅 비율), 상태 stat, 시계열, failover 원인, 팀별 테이블, CF edge 참고, origin 검증
- commit: `b9c0013`

### goti-team-controller
- `infra/cloudflare/multicloud-router.worker.js` — fanout 추가 (Promise.allSettled, 500ms timeout, loop 방지)
- `infra/cloudflare/README.md` — `METRICS_TOKEN` Worker Secret 가이드
- commit: `76d71a3`

### Goti-Terraform
- `prod-aws` / `prod-gcp` config 모듈에 `WORKER_INGEST_TOKEN` secret 추가
- `prod-gcp` database 모듈에 `google_sql_user.observer_ro` + `config` 모듈에 `LOAD_OBSERVER_DB_DSN`/`REDIS_ADDR`/`REDIS_PASSWORD` secret
- commits: `35de9fd`, (GRANT 용 `null_resource` 제거)

## 겪은 문제 + 해결

### 1. ArgoCD auto-sync 못 pickup
PR #273 머지 44분 뒤에도 deployment 가 옛 tag 참조. `kubectl patch application ...refresh=hard` 로 수동 트리거 → 즉시 revision 업데이트. 원인 미확인 (auto-sync polling 실패 or webhook 미설정).

### 2. Cloud SQL private-only 환경 + Terraform null_resource
`cloud-sql-proxy` 로컬 실행은 private IP 인스턴스에 연결 불가. apply 15분 hang → timeout. 해결: null_resource 제거 + K8s Job 으로 GRANT 실행. 상세: `memory/trouble_tf_local_exec_private_ip.md`.

### 3. ExternalSecret regex rewrite override
`goti-user-prod-gcp-secrets` 의 `DATASOURCE_USERNAME` 이 `goti_app` 이 아니라 `goti_user_ro` 로 저장됨 — 다른 ExternalSecret 의 rewrite 와 key 충돌. 해결: master 전용 `goti-db-master-cred` ExternalSecret 을 좁은 regex(`^goti-prod-server-DATASOURCE_(USERNAME|PASSWORD)$`) 로 별도 생성. 상세: `memory/reference_gcp_externalsecret_override.md`.

### 4. Istio Gateway 네임스페이스 차이
prod-gcp 는 `istio-ingress`, prod-aws 는 `istio-system`. 첫 배포 시 실수로 `istio-system` 참조 → 모든 요청 404. 상세: `memory/reference_istio_gateway_ns.md`.

### 5. Distroless 이미지라 kubectl exec 불가
metrics 확인 시 `kubectl exec ... wget` 못 씀. `kubectl port-forward` 로 로컬에서 scrape.

## 검증 로그 (2026-04-17 17:40 KST)

```
$ curl -X POST https://gcp-api.go-ti.shop/__worker-metrics/ingest \
    -H "x-metrics-token: ${TOKEN}" -d '{...valid payload...}'
HTTP 204

$ curl -X POST https://gcp-api.go-ti.shop/__worker-metrics/ingest \
    -H "x-metrics-token: WRONG" -d '{...}'
HTTP 401

# Pod 내부 /metrics (port-forward)
goti_worker_failover_total{from_cloud="gcp",reason="timeout",to_cloud="aws"} 1
goti_worker_ingest_errors_total{reason="auth"} 1
goti_worker_request_duration_seconds_count{routed_cloud="gcp"} 25  ← 실사용자 트래픽
goti_worker_request_duration_seconds_count{routed_cloud="aws"} 1
```

`gcp=25` 는 CF Worker 가 이미 실사용자 요청을 fanout 중이라는 증거. 배포 완전 완료.

## AWS 재기동 후 남은 작업

1. `terraform apply` (prod-aws) — SSM 에 `WORKER_INGEST_TOKEN` 저장
2. goti-load-observer AWS ECR 이미지 재빌드 + Goti-k8s prod values tag 업데이트
3. ArgoCD sync → AWS load-observer pod 기동 → AWS sink 수신 시작
4. AWS Grafana `d/goti-multi-cloud-failover` → GCP kill 시나리오 라이브 촬영

## 사용된 자산 (재사용 가능)

- `/tmp/observer-master-cred.yaml` — master credential 전용 ExternalSecret
- `/tmp/observer-grants-job.yaml` — 5 svc schema GRANT 실행 Job
- `reference_prod_db_cleanup_job.md` 템플릿을 이번에 확장 사용

## 관련 메모리

- `project_multi_cloud_failover_dashboard.md`
- `project_cloudflare_multicloud_worker.md`
- `project_gcp_ci_wif_todo.md`
- `reference_gcp_wif_values.md`
- `reference_gcp_externalsecret_override.md` (신규)
- `reference_istio_gateway_ns.md` (신규)
- `trouble_tf_local_exec_private_ip.md` (신규)
