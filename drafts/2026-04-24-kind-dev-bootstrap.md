# 2026-04-24 kind dev 환경 부트스트랩 (Go 이식 + OTel 단일 경로)

## 세션 개요

이번 세션 목적: PC 로컬 kind 클러스터에 Goti 프로젝트 전체 스택(Go 기반 6 MSA + outbox-worker + 모니터링)을 스크린샷용으로 띄우기. 
AWS/GCP 없이 로컬만 사용. dev values를 Java용 → Go용으로 전환, monitoring은 Goti-monitoring fork의 values-stacks/dev 패턴 따름.

---

## 현재 상태 (세션 종료 시점)

### kind 클러스터

- 클러스터: `goti-dev` (K8s 1.34.3) — control-plane 1 + worker 3
- KUBECONFIG: `$HOME/.kube/config` (시스템 전역 `/etc/profile.d/kubeconfig.sh`도 수정됨)
- docker network: `kind`, gateway `172.20.0.1` (host PG/Redis 접근 경로)

### goti namespace (7 서비스 Running)

- goti-user-dev (KEDA min=3)
- goti-payment-dev (KEDA min=2)
- goti-queue-dev (HPA 1-6)
- goti-resale-dev (KEDA min=1)
- goti-stadium-dev (replica 1)
- goti-ticketing-dev (KEDA min=2)
- goti-outbox-worker-dev (replica 1)

### monitoring namespace

- kps (kube-prometheus-stack) — prom/grafana/alertmanager/node-exporter/kube-state-metrics
- tempo-distributed + tempo-ingester × 3 + distributor/querier/compactor
- loki (SingleBinary)
- mimir-dev (distributor/ingester/querier/query-frontend/query-scheduler/compactor/store-gateway/ruler + minio/kafka)
- pyroscope + pyroscope-alloy
- otel-collector-back (deployment) — traces/logs/metrics 수신 → Tempo/Loki/Mimir
- otel-collector-logs (daemonset) — pod stdout → Loki (prod 패턴 dev 포팅)
- goti-monitoring (커스텀 — dashboards/rules/VirtualService)

### istio-system

- istiod + istio-ingressgateway (NodePort 31080→host 80, 31443→host 443)
- Gateway 리소스 `goti-shared-gateway` (수동 apply, IaC 미반영)

### keda namespace

- keda operator + admission webhook + metrics-apiserver

### 외부 접근

- `https://dev.go-ti.shop/` — 티켓팅 API (Cloudflare → Istio → 앱, JWT 검증)
- `https://dev-monitoring.go-ti.shop/` — Grafana (admin / `fcWtBRr9BX6dOsCyQYmI`, session rotated)
- k9s: `KUBECONFIG=$HOME/.kube/config k9s`

---

## 남은 작업 (TODO — PC 재부팅 후 이어서)

### 진행 중 결정 대기
- [ ] **KEDA trigger를 queue depth 기반으로 교체** — 현재 RPS 쿼리(`http_server_request_duration_seconds_count{job="goti/goti-ticketing"}`)는 `job` 라벨이 OTel 경로에 없어 항상 0. 대신 `queue_waiting{service_name="goti-queue-go"} > N` 같은 leading indicator로 바꿔야 함. 사용자 의도는 티켓팅 도메인 특성상 "사람이 대기열에 쌓이는 시점에 ticketing/payment 미리 scale-up"
- [ ] **goti-queue-gate 서비스를 dev로 포팅할지 결정** — prod에 존재하는 admission control layer
- [ ] **대시보드 변수 mismatch** — log-explorer 대시보드의 `service` 변수가 `label_values(service_name)`이라 시스템 서비스(grafana/prometheus 등)까지 전부 노출. regex filter `goti-.*` 또는 namespace 제한 필요. 또 일부 패널은 `log_type` 라벨 필수로 요구하는데 otel-collector-logs에선 이 라벨 주입 중(attributes/env에 추가했지만 확인 필요)

### OTel 완전 통합 관련
- [ ] **Go 앱 log → OTel Logs SDK 직접 push 검토** — 현재는 filelog receiver(DaemonSet)가 stdout tail 방식. 사용자 의도가 "pure OTel"이면 `go.opentelemetry.io/otel/log` + `otelslog` 브릿지로 앱 내부에서 OTLP push (코드 변경). 단 prod도 Java OTel Agent가 같은 방식이라 filelog 경로 유지도 정당함
- [ ] **trace에 `/api/v1/games/schedules` 같은 메인 API 실제 도달 여부 재확인** — tail_sampling 100%로 올렸지만 `GET /api/v1/baseball-teams`, `/readyz`, `/healthz` 외 API 미수집. otelgin middleware는 등록돼 있는데 원인 재조사 필요. 가능성: Istio sidecar가 특정 path 우회 또는 Tempo search indexing 제한

### 보안 (모니터링 정상화 후 진행)
- [ ] **`dev-monitoring.go-ti.shop` 공개 노출 경로 차단** — 현재 `/metrics`, `/admin/*`, `/debug/*` 전부 익명 접근 가능 (Grafana 프론트 프록시가 모두 forwarding). VS에 directResponse 403 block 추가 (이번 세션에 한 번 적용했다가 사용자 요청으로 롤백함). 스냅샷: [세션 메시지 참조]
- [ ] **Grafana admin 비밀번호 rotate 이후 문서화** — 현재 문서에 노출된 비밀번호는 세션용. 운영 전 재변경

### prod → dev 포팅 남은 항목
- [ ] **KEDA query를 OTel metric에 맞는 label로 재작성** (위와 동일 이슈)
- [ ] **prod `goti-queue-gate` dev 포팅** — chart/values 복사 + 이미지 확인 (Go 버전 이미지 존재 여부?)
- [ ] **instrumentation-java.yaml** — Java OTel Operator. Go만 쓰면 불필요하지만 혹시 Java 서비스 재도입 시 참고
- [ ] **prometheus-blackbox-exporter / opencost / otel-collector-s3** — AWS 의존 컴포넌트. kind에서 의미 약해서 skip했음 (필요 시 재검토)

### Secret 플레이스홀더 (사용자가 나중에 일괄 실값 주입)
- [ ] OAuth client_id/secret: KAKAO, GOOGLE, NAVER — `goti-user-dev-secrets` Secret에 placeholder
- [ ] SMS API (Nurigo/CoolSMS) — `SMS_ENABLED=false`로 비활성, 실값 주입 시 true
- [ ] `QUEUE_TOKEN_SECRET`, `TICKETING_QR_SECRET` — 현재 dummy 값

---

## IaC(fork)에 반영 안 된 수동 적용 리소스

아래는 `kubectl apply` / `kubectl create` 로 직접 만들었고 helm chart/git에 없음.
**재부팅 후 cluster 재생성 시 다시 적용 필요.**

### Secret (git에 절대 넣지 말 것 — 실값 포함 가능)
1. `goti-user-dev-secrets` (goti) — 17개 키 (JWT, OAuth placeholder, SMS)
2. `goti-payment-dev-secrets` (goti) — 1개 키 (JWT public)
3. `goti-queue-dev-secrets` (goti) — 2개 키 (JWT public, QUEUE_TOKEN_SECRET)
4. `goti-resale-dev-secrets` (goti) — 1개 키
5. `goti-stadium-dev-secrets` (goti) — 1개 키
6. `goti-ticketing-dev-secrets` (goti) — 2개 키 (JWT public, TICKETING_QR_SECRET)
7. `grafana-admin-secret` (monitoring) — admin user/password

**재적용 스크립트**: `/tmp/jwt-private.pem`, `/tmp/jwt-public.pem` 재생성 후 kubectl create secret 반복. 이번 세션 기록 참조.

### Service + Endpoints (호스트 PG/Redis 매핑)
- `goti-postgres` (goti) — Service(port 5432) + Endpoints(172.20.0.1)
- `goti-redis` (goti) — Service(port 6379) + Endpoints(172.20.0.1)

**재적용**: `/tmp/goti-host-db-endpoints.yaml` 내용 참조 (아래 git commit에 docs로 포함 가능)

### Istio 리소스
- `goti-shared-gateway` (istio-system) — Gateway, hosts `["*"]`, selector `istio: ingressgateway`
- `dev-monitoring-root` (monitoring) — VirtualService, host `dev-monitoring.go-ti.shop`, `/` → kps-grafana

### ServiceMonitor 라벨
- 7개 goti 서비스의 ServiceMonitor에 `kubectl label release=kps` 적용 (현재는 chart에서 `serviceMonitor.enabled: false`로 빠졌지만 혹시 재활성화 시 필요)

---

## 이번 세션 주요 결정/변경 요약

### 1. dev values Java → Go 매핑
- image: ECR → 로컬 빌드 `goti-<svc>-go:dev` + `kind load`
- probes: `/actuator/health/{liveness,readiness}` → `/healthz`, `/readyz`
- serviceMonitor path: `/actuator/prometheus` → `/metrics` (이후 OTel 단일 경로 전환으로 `serviceMonitor.enabled: false`)
- env: Spring/JVM 제거, viper prefix(`{SVC}_DATABASE_URL`, `{SVC}_REDIS_URL`, `{SVC}_OTEL_*`) 주입
- externalSecret: AWS Parameter Store 참조 비활성화

### 2. 호스트 PG/Redis 재사용
- 내가 만든 cluster 내부 PG/Redis Deployment 제거
- Endpoints(172.20.0.1) 로 호스트 native PG/Redis 매핑
- 마스터 계정 `postgres/postgres` 사용 (schema는 호스트 PG에 이미 존재: user_service/payment_service/queue_service/resale_service/stadium_service/ticketing_service)
- outbox-worker만 `OUTBOX_WORKER_DATABASE_SCHEMA=ticketing_service` override

### 3. OTel 단일 경로 전환
- otel-collector-back에 metrics pipeline 추가 (`prometheusremotewrite/mimir` exporter)
- 7개 dev values의 `serviceMonitor.enabled: true → false`
- Go 앱 env: `USER=nonroot` 주입 (distroless에서 cgo 없이 OTel resource detector 호환)
- tail_sampling sampling_percentage: 10 → 100
- endpoints: `tempo-dev` → `tempo-distributor`, `loki-dev` → `loki`, `kube-prometheus-stack-dev-alertmanager` → `kps-...`
- ServiceMonitor extraLabels release 모두 `kps`로

### 4. Pyroscope 통합 (push 방식)
- `pkg/observability/pyroscope.go` 신규 (pyroscope-go SDK)
- `pkg/observability/otel.go`의 Setup()에서 자동 호출
- values env: `PYROSCOPE_ENABLED=true`, `PYROSCOPE_SERVER_ADDRESS=http://pyroscope.monitoring.svc:4040`

### 5. Istio AuthorizationPolicy 외부 허용
- dev values 6개에 `from-ingress-gateway` ALLOW 정책 추가 (istio-system namespace 허용)
- 원래 `from-mesh-internal`은 `/internal/*` 경로만 허용이라 Gateway 경유 트래픽 차단됨

### 6. KEDA operator + ScaledObject 4개
- user (3-10), payment (2-8), resale (1-6), ticketing (2-10)
- prod values에서 triggers 복사, serverAddress만 `mimir-prod` → `mimir-dev`
- **주의**: 현재 RPS 쿼리는 `job` 라벨 의존이라 OTel 단일 경로에서 항상 0. queue depth 기반으로 교체 예정

### 7. k6 부하 (in-cluster)
- `k6-browse-only` (Job) — GET-only 시나리오, 평탄 ConfigMap `k6-test` (helpers/config/scenarios 5개 파일)
- `synthetic-traffic` (CronJob) — 5분마다 기본 시나리오 (현재 suspend)
- k6-operator 설치했지만 K8s 1.34 EndpointSlice hostname 누락으로 starter hang → 현재 Job 직접 실행으로 우회

### 8. 기타
- Grafana admin password rotate: admin/admin → 랜덤 20자
- `/etc/profile.d/kubeconfig.sh` 를 `$HOME/.kube/config`로 수정 (사용자 수동 sudo)
- nodeExporter enabled: false → true (노드 리소스 대시보드 no-data 해결)
- KPS grafana datasource URL들 stale service name 교정
- Loki alerting-rules ConfigMap 없어 loki-0 PVC stuck 했던 건 goti-monitoring install로 자동 해결

---

## 재부팅 후 복구 체크리스트 (순서대로)

1. docker desktop/데몬 기동 확인
2. kind 클러스터 상태: `kind get clusters` — `goti-dev` 존재하면 `docker start $(docker ps -aqf name=goti-dev)` 로 노드 컨테이너 부팅
3. `export KUBECONFIG=$HOME/.kube/config`
4. `kubectl get nodes` — 4 Ready 확인
5. 누락 리소스 재적용 (위 "IaC에 반영 안 된 수동 적용 리소스" 섹션 참조)
6. `kubectl get pods -A | grep -v Running` — 비정상 pod 확인
7. 호스트 PG/Redis 프로세스 살아있는지 확인 (native systemd)
8. k6 다시 띄울 때: `kubectl apply -f /tmp/k6-browse-job.yaml` (tmp는 재부팅 시 사라지므로 이번에 git에 옮겨둠)

---

## 관련 세션 메모

- 프로젝트 원 상태에서 PC에 직접 Go 서비스 6개 + outbox-worker + 모니터링 풀스택 + k6 부하 + KEDA 까지 구축 완료
- Java baseline의 ECR/AWS Secrets Manager/ArgoCD 의존을 dev 환경에서 전부 제거
- 공식 ArgoCD ApplicationSet 구조(values-stacks/{env}) 존중하며 수동 helm install
- 스크린샷 목적이라 prod 보안/HA 설정까지 모두 재현하지 않음 (PDB/HA etc 생략)
