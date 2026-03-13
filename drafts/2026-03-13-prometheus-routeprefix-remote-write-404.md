---
date: 2026-03-13
category: troubleshoot
project: Goti-monitoring
tags: [prometheus, routePrefix, remote-write, alloy, tempo, 404]
---

# Prometheus routePrefix=/prometheus로 인해 Alloy/Tempo remote_write 404

## Context
Kind 클러스터 모니터링 스택에서 Grafana 대시보드 확인 시 Log Explorer 데이터 없음, JVM Deep Dive 메트릭 없음, etcd 데이터 없음 등 다수 이상 발견. Alloy pod 로그 분석 착수.

## Issue
```
level=error msg="non-recoverable error"
  component_id=prometheus.remote_write.default
  url=http://kube-prometheus-stack-dev-prometheus.monitoring.svc:9090/api/v1/write
  err="server returned HTTP status 404 Not Found: 404 page not found\n"
```

```
level=info msg="Exporting failed. Will retry the request after interval."
  component_id=otelcol.exporter.otlp.tempo
  error="rpc error: code = Unavailable desc = connection refused"
```

재현 조건: Prometheus가 `routePrefix: "/prometheus"`로 설정된 환경에서 Alloy/Tempo가 `/api/v1/write`로 remote write 시도.

## Action
1. 가설: Alloy/Loki/Tempo pod 문제 → 결과: 기각 (모든 pod Running, Loki 로그 정상)
2. 가설: Prometheus remote write receiver 미활성화 → 결과: 기각 (`enableRemoteWriteReceiver: true` 확인)
3. 가설: Prometheus API 경로 불일치 → 결과: 채택

**근본 원인 (Root Cause)**:

kube-prometheus-stack values에서:
```yaml
prometheusSpec:
  externalUrl: "/prometheus"
  routePrefix: "/prometheus"
```

이로 인해 Prometheus 프로세스가 `--web.route-prefix=/prometheus`로 시작:
```
/bin/prometheus --web.route-prefix=/prometheus --web.enable-remote-write-receiver ...
```

따라서 remote write 엔드포인트가 `/prometheus/api/v1/write`에 위치. 하지만 Alloy와 Tempo는 `/api/v1/write`로 전송 → 404.

직접 확인:
```bash
# 404
kubectl exec prometheus-0 -- wget -qO- --post-data="" http://localhost:9090/api/v1/write
# 400 (정상 — 빈 body라서 400이지만 경로는 맞음)
kubectl exec prometheus-0 -- wget -qO- --post-data="" http://localhost:9090/prometheus/api/v1/write
```

**적용한 수정:**

1. `values-stacks/dev/alloy-values.yaml`:
```
- url = "http://...svc:9090/api/v1/write"
+ url = "http://...svc:9090/prometheus/api/v1/write"
```

2. `values-stacks/dev/tempo-values.yaml`:
```yaml
- url: "http://...svc:9090/api/v1/write"
+ url: "http://...svc:9090/prometheus/api/v1/write"
```

참고: docker-compose용 설정(`alloy/config.alloy`, `tempo/tempo-config.yml`)은 `prometheus:9090/api/v1/write`로 유지 — docker-compose의 Prometheus는 routePrefix 없이 동작.

## Result
수정 후 ArgoCD 자동 sync 대기 (사용자 commit/push 후).

- Alloy → Prometheus remote_write 정상화 → JVM/OTel 메트릭 수집 복구 예상
- Tempo metricsGenerator → Prometheus remote_write 정상화 → service-graphs/span-metrics 복구 예상

회귀 테스트: Alloy pod 로그에서 `404 Not Found` 에러 소멸 확인.

재발 방지: **Prometheus routePrefix 설정 시 해당 prefix가 모든 remote_write client URL에 반영되어야 함**. docker-compose(prefix 없음)와 K8s(prefix 있음) 환경의 URL이 다른 점 주의.

## Related Files
- Goti-monitoring/values-stacks/dev/alloy-values.yaml (line 203)
- Goti-monitoring/values-stacks/dev/tempo-values.yaml (line 38)
- Goti-monitoring/values-stacks/dev/kube-prometheus-stack-values.yaml (line 12-13, routePrefix)
