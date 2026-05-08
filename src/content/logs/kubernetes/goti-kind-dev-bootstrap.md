---
title: "kind 로컬에 Goti 전체 스택 부트스트랩 — Go 이식 + OTel 단일 경로"
excerpt: "AWS/GCP 없이 PC kind 클러스터에 6 MSA + outbox-worker + 모니터링을 부트스트랩한 세션 보고. dev values를 Java에서 Go로 전환하면서 만난 문제와 결정 사항을 정리했습니다"
type: troubleshooting
category: "kubernetes"
tags:
  - go-ti
  - kind
  - kubernetes
  - bootstrap
  - OpenTelemetry
  - Helm
  - troubleshooting
series:
  name: "goti-kind-dev-bootstrap"
  order: 1
date: "2026-04-24"
---

## 한 줄 요약

> AWS/GCP 없이 PC kind 클러스터(K8s 1.34)에 Go 기반 6 MSA + outbox-worker + 풀 모니터링 스택을 부트스트랩했습니다. dev values를 Java 베이스에서 Go 기반으로 전환하는 과정에서 만난 probe 경로·OTel 라벨·AuthorizationPolicy·KEDA 트리거 문제와 그 결정 사항을 기록합니다

---

## 🔥 세션 목표

스크린샷용으로 Goti 프로젝트 전체 스택을 로컬에서 재현하는 것이 목표였습니다.

- AWS/GCP 인프라 비용 없이 PC 한 대에서 동작 확인
- Java 베이스로 작성된 dev values를 Go 이미지·환경 변수 체계에 맞게 전환
- OTel 단일 경로(otel-collector-back)로 메트릭/로그/트레이스를 일원화
- prod에서 재현하기 어려운 관측성 파이프라인 전체를 로컬에서 검증

세션 종료 시점 기준으로 goti namespace의 7개 서비스와 monitoring namespace의 전체 스택이 Running 상태에 도달했습니다.

---

## ✅ 현재 상태 (세션 종료 시점)

### kind 클러스터

- 클러스터명: `goti-dev` (K8s 1.34.3)
- 구성: control-plane 1 + worker 3
- docker network: `kind`, gateway `172.20.0.1` (호스트 PG/Redis 접근 경로)

### goti namespace — 7 서비스 Running

| 서비스 | 스케일러 | 비고 |
|---|---|---|
| goti-user-dev | KEDA min=3 | JWT/OAuth/SMS |
| goti-payment-dev | KEDA min=2 | JWT public key |
| goti-queue-dev | HPA 1-6 | 대기열 핵심 |
| goti-resale-dev | KEDA min=1 | |
| goti-stadium-dev | replica 1 | |
| goti-ticketing-dev | KEDA min=2 | JWT + QR secret |
| goti-outbox-worker-dev | replica 1 | ticketing_service schema |

### monitoring namespace

kube-prometheus-stack(kps)을 중심으로 분산 트레이싱·로그·프로파일링까지 풀스택으로 구성했습니다.

| 컴포넌트 | 역할 |
|---|---|
| kps | Prometheus / Grafana / Alertmanager / node-exporter / kube-state-metrics |
| tempo-distributed | 트레이스 수집 — distributor/ingester×3/querier/compactor |
| loki (SingleBinary) | 로그 수집 |
| mimir-dev | 장기 메트릭 저장 — distributor/ingester/querier/query-frontend/query-scheduler/compactor/store-gateway/ruler + MinIO/Kafka |
| pyroscope + alloy | 지속 프로파일링 |
| otel-collector-back | traces/logs/metrics 수신 → Tempo/Loki/Mimir (Deployment) |
| otel-collector-logs | pod stdout → Loki (DaemonSet, prod 패턴 포팅) |
| goti-monitoring | 커스텀 대시보드 / alert rules / VirtualService |

### 외부 접근

- 티켓팅 API: `https://dev.go-ti.shop/` — Cloudflare → Istio IngressGateway → 앱 (JWT 검증)
- Grafana: `https://dev-monitoring.go-ti.shop/`

### IaC에 반영되지 않은 수동 적용 리소스

클러스터 재생성 시 다시 적용해야 하는 리소스 목록입니다.

**Secret (7개)**

| 리소스 | namespace | 비고 |
|---|---|---|
| goti-user-dev-secrets | goti | JWT, OAuth placeholder, SMS (17개 키) |
| goti-payment-dev-secrets | goti | JWT public (1개 키) |
| goti-queue-dev-secrets | goti | JWT public + QUEUE_TOKEN_SECRET |
| goti-resale-dev-secrets | goti | 1개 키 |
| goti-stadium-dev-secrets | goti | 1개 키 |
| goti-ticketing-dev-secrets | goti | JWT public + TICKETING_QR_SECRET |
| grafana-admin-secret | monitoring | admin user/password |

**Service + Endpoints (호스트 DB 매핑)**

```yaml
# goti-postgres: Service(5432) + Endpoints(172.20.0.1)
# goti-redis:    Service(6379) + Endpoints(172.20.0.1)
```

호스트 PG/Redis를 클러스터 내부에서 사용하기 위해 ExternalName 대신 Endpoints 오브젝트를 직접 생성했습니다. kind docker network의 gateway인 `172.20.0.1`이 호스트 머신으로 도달하는 경로입니다.

**Istio 리소스 (수동 apply)**

- `goti-shared-gateway` (istio-system): Gateway, hosts `["*"]`
- `dev-monitoring-root` (monitoring): VirtualService, `dev-monitoring.go-ti.shop` → kps-grafana

---

## 🤔 이번 세션에서 만난 문제들

### 문제 1 — probe 경로 불일치 (CrashLoopBackOff)

Java dev values에서 Go 이미지로 교체했을 때 liveness/readiness probe가 `/actuator/health/liveness`·`/actuator/health/readiness`(Spring Boot 전용)로 남아있었습니다.

Go 앱은 `/healthz`·`/readyz`를 노출합니다.

```yaml
# Before (Java dev values)
livenessProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080

# After (Go dev values)
livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
readinessProbe:
  httpGet:
    path: /readyz
    port: 8080
```

6개 서비스 values를 일괄 수정했습니다. Java → Go 이식 시 probe·serviceMonitor 경로·JVM 환경 변수 3가지를 먼저 확인해야 합니다.

### 문제 2 — OTel distroless 이미지에서 resource detector 실패

Go 앱을 distroless 이미지(`gcr.io/distroless/static-debian12:nonroot`)로 빌드했을 때 OTel resource detector가 실패했습니다.

OTel SDK의 OS resource detector가 `USER` 환경 변수를 읽으려고 시도하는데, distroless 이미지는 `USER`가 없어서 cgo 없이는 조회가 불가능합니다.

```yaml
# dev values에 추가
env:
  - name: USER
    value: nonroot
```

`USER=nonroot`를 주입하면 resource detector가 환경 변수 폴백 경로로 동작합니다. cgo 없이 빌드한 Go 앱 + distroless 조합에서는 이 설정이 필수입니다.

### 문제 3 — AuthorizationPolicy가 Gateway 트래픽을 차단

`https://dev.go-ti.shop/`으로 요청이 들어왔을 때 외부에서 503이 반환됐습니다.

기존 `from-mesh-internal` AuthorizationPolicy가 `/internal/*` 경로만 허용하도록 설정되어 있었습니다. Istio IngressGateway는 `istio-system` namespace에 있어 메시 내부 트래픽으로 취급되지만, 해당 정책이 특정 경로만 허용해 일반 API 경로를 차단했습니다.

```yaml
# dev values 6개에 추가
authorizationPolicy:
  - name: from-ingress-gateway
    action: ALLOW
    from:
      - source:
          namespaces: ["istio-system"]
```

istio-system namespace에서 오는 트래픽을 명시적으로 허용하는 정책을 추가했습니다.

### 문제 4 — KEDA ScaledObject의 RPS 쿼리가 항상 0 반환

KEDA ScaledObject의 트리거 쿼리가 서비스 인스턴스를 최솟값에서 올리지 못했습니다.

prod values에서 복사한 Prometheus 트리거가 `job="goti/goti-ticketing"` 라벨을 사용합니다. OTel 단일 경로로 전환하면서 ServiceMonitor를 비활성화했기 때문에 이 `job` 라벨이 Mimir에 존재하지 않습니다. 쿼리 결과가 항상 0이어서 KEDA가 `minReplicaCount`에서 스케일업하지 않습니다.

현재 임시 해결책으로 minReplicaCount를 수동으로 설정해 두었습니다. 근본 해결은 queue depth 기반 leading indicator로 교체하는 것으로, 다음 세션에서 진행 예정입니다.

```text
# 향후 교체 방향
queue_waiting{service_name="goti-queue-go"} > N
→ ticketing/payment를 대기열이 쌓이는 시점에 선행 스케일업
```

티켓팅 도메인 특성상 RPS는 후행 지표입니다. 사람이 대기열에 쌓이는 시점에 ticketing/payment를 미리 올리는 것이 의도된 동작입니다.

### 문제 5 — k6-operator가 K8s 1.34에서 hang

k6-operator를 설치했지만 TestRun 리소스를 apply해도 k6 Job이 생성되지 않았습니다.

K8s 1.34에서 EndpointSlice의 hostname 필드 처리가 변경됐고, k6-operator starter가 이를 기다리며 hang 상태에 빠졌습니다.

```bash
# 우회: k6 Job 직접 실행
$ kubectl apply -f /tmp/k6-browse-job.yaml
```

k6-operator 없이 Job을 직접 apply하는 방식으로 우회했습니다. synthetic traffic은 CronJob으로 별도 구성했습니다(현재 suspend 상태).

---

## ✅ 주요 결정 사항

### Java → Go dev values 전환 매핑

| 항목 | Java (이전) | Go (이후) |
|---|---|---|
| 이미지 | ECR 태그 | 로컬 `goti-<svc>-go:dev` + kind load |
| liveness probe | `/actuator/health/liveness` | `/healthz` |
| readiness probe | `/actuator/health/readiness` | `/readyz` |
| serviceMonitor path | `/actuator/prometheus` | 비활성 (OTel 단일 경로) |
| 환경 변수 prefix | Spring 프로퍼티 | viper prefix (`{SVC}_DATABASE_URL` 등) |
| externalSecret | AWS Parameter Store 활성 | 비활성 |

### OTel 단일 경로 전환

otel-collector-back에 metrics pipeline을 추가하고 ServiceMonitor를 전면 비활성화했습니다.

```yaml
# otel-collector-back values — metrics pipeline 추가
exporters:
  prometheusremotewrite/mimir:
    endpoint: http://mimir-dev-distributor.monitoring.svc:9009/api/v1/push

# 7개 dev values 공통 변경
serviceMonitor:
  enabled: false   # Prometheus scrape 비활성 → OTel push로 전환
```

endpoint 이름도 stale 상태였던 것을 일괄 교정했습니다.

```text
tempo-dev        → tempo-distributor
loki-dev         → loki
kps-dev-*        → kps-* (정확한 service 이름으로)
```

### 호스트 PG/Redis 재사용

클러스터 내부에 PG/Redis Deployment를 별도로 띄우는 대신 호스트 native 프로세스를 재사용했습니다.

기존 schema(user_service/payment_service/queue_service/resale_service/stadium_service/ticketing_service)가 호스트 PG에 이미 존재하기 때문에 데이터 재구성이 불필요했습니다.

```yaml
# Endpoints 오브젝트 — 클러스터 내부에서 호스트 DB 참조
subsets:
  - addresses:
      - ip: 172.20.0.1   # kind docker gateway → 호스트
    ports:
      - port: 5432
```

outbox-worker만 `OUTBOX_WORKER_DATABASE_SCHEMA=ticketing_service` override를 별도로 주입했습니다.

### Pyroscope 통합

`pkg/observability/pyroscope.go`를 신규 작성해 pyroscope-go SDK로 push 방식 프로파일링을 통합했습니다.

```yaml
# dev values — pyroscope 활성화
env:
  - name: PYROSCOPE_ENABLED
    value: "true"
  - name: PYROSCOPE_SERVER_ADDRESS
    value: http://pyroscope.monitoring.svc:4040
```

Setup() 함수가 호출될 때 자동으로 시작됩니다.

---

## 📚 배운 점

- **Java → Go 이식 시 3가지를 먼저 바꿔라**: probe 경로(`/healthz`·`/readyz`), serviceMonitor 경로(`/metrics` 또는 비활성), JVM·Spring 전용 환경 변수 제거. 이 세 가지를 놓치면 CrashLoopBackOff가 연속으로 발생합니다
- **distroless + cgo 없이 빌드한 Go 앱은 `USER` 환경 변수를 명시해야 합니다**: OTel resource detector가 OS 사용자 정보를 읽을 때 cgo를 쓰는 경로가 없으면 환경 변수 폴백으로 가는데, 이 변수가 없으면 에러가 발생합니다
- **KEDA 트리거는 메트릭 수집 경로와 함께 검증해야 합니다**: ServiceMonitor를 비활성화하고 OTel push로 전환하면 기존 `job` 라벨 기반 쿼리가 동작하지 않습니다. 스케일러와 메트릭 파이프라인은 같이 바꾸거나, 쿼리를 먼저 검증해야 합니다
- **호스트 DB를 kind에서 재사용할 때는 Endpoints 오브젝트를 직접 생성합니다**: `172.20.0.1`이 kind docker network에서 호스트로 도달하는 안정적인 경로입니다. ExternalName Service보다 Endpoints 직접 생성이 더 단순합니다
- **수동 적용 리소스는 목록으로 관리해야 합니다**: Secret·Endpoints·Istio 리소스는 IaC에 포함되지 않으므로 클러스터 재생성 후 복구 절차를 문서화해 두지 않으면 세션마다 다시 찾아야 합니다

---

## 재부팅 후 복구 순서

kind 클러스터는 docker 컨테이너 기반이라 호스트 재부팅 후 재기동이 필요합니다.

```bash
# 1. kind 클러스터 노드 컨테이너 재기동
$ kind get clusters
goti-dev
$ docker start $(docker ps -aqf name=goti-dev)

# 2. kubeconfig 설정
$ export KUBECONFIG=$HOME/.kube/config

# 3. 노드 Ready 확인
$ kubectl get nodes
# 4개 노드가 Ready 상태여야 합니다

# 4. 비정상 Pod 확인
$ kubectl get pods -A | grep -v Running

# 5. 호스트 PG/Redis 프로세스 확인 (systemd 서비스)
$ systemctl status postgresql
$ systemctl status redis
```

노드가 Ready 상태가 된 후 "IaC에 반영되지 않은 수동 적용 리소스" 섹션의 Secret·Endpoints·Istio 리소스를 순서대로 재적용합니다. `tmp` 디렉토리의 파일은 재부팅 시 사라지므로 이번 세션에서 git에 docs로 옮겨 두었습니다.

---

## 남은 작업

| 항목 | 내용 |
|---|---|
| KEDA 트리거 교체 | RPS 쿼리 → `queue_waiting` leading indicator (다음 세션) |
| goti-queue-gate dev 포팅 | prod admission control layer, Go 이미지 존재 여부 확인 필요 |
| 대시보드 변수 mismatch | log-explorer `service` 변수에 `goti-.*` regex 필터 추가 |
| Go 앱 OTel Logs SDK 검토 | 현재 filelog DaemonSet → 앱 내부 OTLP push 방식 비교 |
| trace 수집 경로 재확인 | `/api/v1/baseball-teams` 외 API가 Tempo에 미수집 — Istio sidecar 우회 여부 조사 |
| 모니터링 노출 경로 차단 | `/metrics`, `/admin/*` 익명 접근 차단 VirtualService 추가 |
| OAuth Secret 실값 주입 | KAKAO/GOOGLE/NAVER client_id/secret placeholder 교체 |
