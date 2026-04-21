---
date: 2026-04-06
category: troubleshoot
project: Goti-monitoring
tags: [opencost, mimir, prometheus, crashloopbackoff, helm]
---

# OpenCost CrashLoopBackOff — Mimir Prometheus API path 누락으로 404 발생

## Context
EKS prod 클러스터(`goti-prod-aws`) monitoring 네임스페이스에서 OpenCost pod가 CrashLoopBackOff 상태로 약 150분간 지속. OpenCost chart 2.5.12 / App v1.119.2, Mimir query-frontend 연동 구성.

## Issue
OpenCost 컨테이너가 시작 직후 FATAL 에러로 종료되며 반복 재시작.

```
FTL Failed to create Prometheus data source: failed to query prometheus at
http://mimir-prod-query-frontend.monitoring.svc.cluster.local:8080:
Communication error: 404 (Not Found)
URL: 'http://mimir-prod-query-frontend.monitoring.svc.cluster.local:8080/api/v1/query?query=up'
```

- Pod: `opencost-prod-8489956f48-bpdq4` (1/2 Ready, 32회 재시작)
- Startup probe도 실패: `HTTP probe failed with statuscode: 500`
- Istio sidecar는 정상 동작 중

## Action

1. **가설: Mimir 서비스 자체가 죽어있음** → 결과: `kubectl get pods -n monitoring | grep mimir` 확인, query-frontend 포함 전체 Mimir 컴포넌트 2/2 Running 정상

2. **가설: Mimir API 경로에 `/prometheus` prefix 필요** → 결과: istio-proxy 컨테이너에서 curl 테스트
   - `localhost:8080/api/v1/query` → 404
   - `localhost:8080/prometheus/api/v1/query` → 200 (정상 응답)

**근본 원인**: Mimir는 Prometheus-compatible API를 `/prometheus/api/v1/...` 경로로 노출하는데, OpenCost의 `PROMETHEUS_SERVER_ENDPOINT` 환경변수에 `/prometheus` suffix가 빠져 있었음. Helm values에는 `internal.path: "/prometheus"`가 설정되어 있었으나, 실제 배포된 deployment에 반영되지 않은 상태였음 (ArgoCD sync 타이밍 이슈 추정).

**적용한 수정**:
- 별도 수정 불필요 — Helm values 자체는 올바르게 설정되어 있었음
- ArgoCD가 자동 sync하면서 deployment에 `/prometheus` path가 반영된 새 ReplicaSet이 롤아웃됨

## Result
- 새 pod `opencost-prod-79b54c785f-p2tnj`가 2/2 Running 정상 확인
- 구 pod는 자동 정리됨
- 재발 방지: OpenCost values에서 `opencost.prometheus.internal.path` 값이 `/prometheus`로 유지되는지 PR 리뷰 시 확인

## Related Files
- `Goti-monitoring/values-stacks/prod/opencost-values.yaml` (설정 확인)
- `Goti-monitoring/values-stacks/prod-gcp/opencost-values.yaml` (GCP 동일 설정 확인 필요)
