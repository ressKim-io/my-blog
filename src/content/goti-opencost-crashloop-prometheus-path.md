---
title: "OpenCost CrashLoopBackOff — Mimir의 /prometheus 경로 누락"
excerpt: "Mimir는 Prometheus 호환 API를 /prometheus/api/v1/... 경로에 노출합니다. OpenCost가 이 prefix 없이 쿼리해 404로 반복 재시작한 사례."
category: monitoring
tags:
  - go-ti
  - Observability
  - OpenCost
  - Prometheus
  - Mimir
  - FinOps
  - troubleshooting
series:
  name: "goti-observability-ops"
  order: 15
date: "2026-04-06"
---

## 한 줄 요약

> OpenCost가 Mimir query-frontend에 `PROMETHEUS_SERVER_ENDPOINT`를 붙여 쿼리하는데, Mimir는 `/prometheus` prefix 아래에 Prometheus 호환 API를 노출합니다. 이 prefix가 누락되어 404 FATAL로 CrashLoopBackOff가 약 150분간 지속됐습니다.

## Impact

- **영향 범위**: EKS prod 클러스터 `goti-prod-aws`의 monitoring 네임스페이스 OpenCost
- **증상**: OpenCost pod 컨테이너가 시작 직후 FATAL 종료, 32회 이상 반복 재시작
- **지속 시간**: 약 150분
- **발생일**: 2026-04-06
- **구성**: OpenCost chart 2.5.12 / App v1.119.2, Mimir query-frontend 연동

---

## 🔥 문제: OpenCost가 시작 직후 FATAL로 종료됩니다

### 기대 동작

OpenCost는 클러스터 리소스 사용량과 가격 정보를 조합해 비용 대시보드를 제공하는 FinOps 도구입니다. 내부적으로 Prometheus(또는 Prometheus 호환 저장소)에 `up` 쿼리를 던져 데이터 소스 연결을 검증한 뒤 메트릭을 수집합니다.

프로덕션에서는 Prometheus Agent Mode + Mimir 조합을 사용하고 있었습니다. OpenCost는 `PROMETHEUS_SERVER_ENDPOINT` 값을 Mimir query-frontend 서비스로 지정해 메트릭을 읽도록 구성돼 있었습니다.

### 발견한 증상

모니터링 네임스페이스의 OpenCost pod가 `1/2 Ready` 상태로 멈춰 있었고, 재시작 횟수가 32회까지 쌓여 있었습니다.

```bash
$ kubectl get pod -n monitoring | grep opencost
opencost-prod-8489956f48-bpdq4   1/2   CrashLoopBackOff   32   2h30m
```

컨테이너 로그를 열어보니 시작 직후 FATAL 종료가 반복되고 있었습니다.

```text
FTL Failed to create Prometheus data source: failed to query prometheus at
http://mimir-prod-query-frontend.monitoring.svc.cluster.local:8080:
Communication error: 404 (Not Found)
URL: 'http://mimir-prod-query-frontend.monitoring.svc.cluster.local:8080/api/v1/query?query=up'
```

Startup probe도 500을 반환하며 실패하고 있었습니다.

```text
HTTP probe failed with statuscode: 500
```

Istio sidecar는 정상 동작 중이었고, mTLS도 문제가 없었습니다. 순수하게 OpenCost 컨테이너만 Mimir 엔드포인트를 치면 404를 받고 있는 상황이었습니다.

---

## 🤔 원인: Mimir는 Prometheus 호환 API를 /prometheus 아래에 노출합니다

### 가설 1 — Mimir 자체가 죽어 있는가

먼저 Mimir 쪽 상태를 확인했습니다.

```bash
$ kubectl get pods -n monitoring | grep mimir
mimir-prod-query-frontend-xxxx   2/2   Running
mimir-prod-distributor-xxxx      2/2   Running
mimir-prod-ingester-0            2/2   Running
mimir-prod-store-gateway-0       2/2   Running
```

query-frontend를 포함한 모든 Mimir 컴포넌트가 `2/2 Running` 상태였습니다. Mimir 자체는 건강했습니다.

### 가설 2 — 경로 prefix 문제

Mimir는 Grafana Mimir 문서에 명시된 대로 Prometheus 호환 API를 **`/prometheus/api/v1/...`** 경로에 노출합니다. 같은 서비스 주소여도 `/api/v1/...`로 바로 쿼리하면 404가 나오도록 기본 라우팅이 걸려 있습니다.

istio-proxy 사이드카에서 직접 curl을 쳐서 가설을 검증했습니다.

```bash
$ kubectl exec -it opencost-prod-xxxx -c istio-proxy -n monitoring -- \
    curl -s -o /dev/null -w "%{http_code}\n" \
    'http://mimir-prod-query-frontend.monitoring.svc.cluster.local:8080/api/v1/query?query=up'
404

$ kubectl exec -it opencost-prod-xxxx -c istio-proxy -n monitoring -- \
    curl -s -o /dev/null -w "%{http_code}\n" \
    'http://mimir-prod-query-frontend.monitoring.svc.cluster.local:8080/prometheus/api/v1/query?query=up'
200
```

결과가 명확했습니다. `/prometheus` prefix가 붙으면 200이 돌아오고, 빠지면 404가 돌아옵니다.

### 근본 원인 — Helm values는 맞지만 Deployment에 반영되지 않았습니다

OpenCost Helm values 자체는 올바르게 설정돼 있었습니다.

```yaml
opencost:
  prometheus:
    internal:
      serviceName: mimir-prod-query-frontend
      namespaceName: monitoring
      port: 8080
      path: "/prometheus"  # 이 값이 핵심
```

문제는 실제 배포된 Deployment의 `PROMETHEUS_SERVER_ENDPOINT` 환경변수였습니다. 컨테이너 env에서 확인해보면 `/prometheus` suffix가 빠진 상태로 들어가 있었습니다.

values에는 있는데 Deployment에는 반영되지 않은 원인은 **ArgoCD sync 타이밍 이슈**로 추정됩니다. 이전 배포가 values 변경 이전 시점에서 찍혔고, 그 이후 values는 업데이트됐지만 Deployment 재생성이 트리거되지 않은 상태로 남아 있었던 것으로 보입니다.

---

## ✅ 해결: ArgoCD 자동 sync로 새 ReplicaSet이 롤아웃됩니다

별도로 values를 수정할 필요는 없었습니다. Helm values는 이미 `/prometheus`로 올바르게 설정돼 있었기 때문입니다.

ArgoCD가 주기적으로 desired state와 실제 상태를 비교하면서 diff를 감지했고, 자동 sync로 Deployment를 재생성하며 `/prometheus` path가 반영된 환경변수로 새 ReplicaSet이 롤아웃됐습니다.

```bash
$ kubectl get pods -n monitoring | grep opencost
opencost-prod-79b54c785f-p2tnj   2/2   Running   0   3m
```

새 pod가 `2/2 Running`으로 뜨면서 구 pod는 자동 정리됐습니다. 대시보드에서도 비용 메트릭이 다시 그려지기 시작했습니다.

### 재발 방지 체크 포인트

- OpenCost values에서 `opencost.prometheus.internal.path` 값이 `/prometheus`로 유지되는지 PR 리뷰 시 확인합니다.
- GCP 쪽 values(`prod-gcp/opencost-values.yaml`)도 동일하게 설정돼 있는지 별도로 점검해야 합니다.
- ArgoCD sync 상태와 live Deployment의 env 변수를 배포 직후 실제로 비교하는 스모크 스텝을 추가합니다.

---

## 📚 배운 점

- **Mimir의 Prometheus 호환 API는 `/prometheus` prefix 아래에 있습니다.** Mimir를 Prometheus 대체로 쓰는 클라이언트(OpenCost, Grafana, 커스텀 exporter 등)는 엔드포인트 URL에 반드시 `/prometheus`를 포함해야 합니다.
- **Helm values가 맞다고 Deployment가 맞다는 보장은 없습니다.** ArgoCD sync가 밀리거나 auto-sync 조건에서 벗어난 상황에서는 values 변경이 live 리소스에 반영되지 않을 수 있습니다. `kubectl describe deployment`로 실제 env를 확인하는 습관이 필요합니다.
- **FATAL + 404 조합은 경로를 의심합니다.** 애플리케이션이 startup probe 전에 데이터 소스 헬스체크를 수행하고, 404로 아예 올라오지 못하는 경우 서버 다운이 아니라 경로/라우팅 문제일 가능성이 높습니다.
- **istio-proxy 사이드카에서 curl을 찍는 것**이 가장 빠른 검증 수단입니다. 애플리케이션 컨테이너에 shell이 없을 때도 사이드카에서 동일한 네트워크 컨텍스트로 요청을 재현할 수 있습니다.
- **멀티 클라우드 환경에서는 동일 설정이 양쪽 values에 모두 반영됐는지 확인**해야 합니다. AWS와 GCP values 파일이 분리된 구조에서는 한쪽만 수정하고 배포하는 실수가 쉽게 생깁니다.
