---
date: 2026-03-13
category: troubleshoot
project: Goti-monitoring
tags: [istio, virtualservice, fqdn, dns, gateway, 503]
---

# Istio VirtualService destination host .svc → .svc.cluster.local FQDN 누락으로 503

## Context
Goti-k8s ArgoCD 직접 참조 전환 후, `https://kind.go-ti.shop/grafana/` 접속 시 503 에러 발생. CloudFront → Kind PC:80 → Istio Gateway:31080 → Grafana 경로.

## Issue
```
503 Service Unavailable
```

CloudFront에서 Kind PC Origin으로 연결 시 503 반환. curl로 확인:
```bash
curl -s -o /dev/null -w "%{http_code}" https://kind.go-ti.shop/grafana/
# 503
```

재현 조건: VirtualService destination host가 `.svc`로 끝나는 상태에서 Istio Gateway를 통한 외부 접근.

## Action
1. 가설: CloudFront → Kind PC 네트워크 문제 → 결과: 부분 채택 (503이므로 Gateway까지는 도달)
2. 가설: Kind PC 방화벽/포트포워딩 → 결과: 기각 (ArgoCD 등 다른 서비스는 접근 가능)
3. 가설: VirtualService destination host DNS resolution 실패 → 결과: 채택

**근본 원인 (Root Cause)**:

VirtualService의 destination host가 `.svc`로 끝남:
```yaml
host: kube-prometheus-stack-dev-grafana.monitoring.svc
host: kube-prometheus-stack-dev-prometheus.monitoring.svc
```

Istio Gateway pod는 `istio-system` 네임스페이스에 위치. sidecar와 달리 **Gateway는 DNS search domain이 없어서** `.svc`만으로는 Envoy 클러스터를 매칭하지 못함.

Envoy가 등록한 클러스터 이름:
```
outbound|80||kube-prometheus-stack-dev-grafana.monitoring.svc.cluster.local
outbound|9090||kube-prometheus-stack-dev-prometheus.monitoring.svc.cluster.local
```

cross-namespace 참조 시 FQDN(`.svc.cluster.local`)이 필수.

**적용한 수정:**

`values-dev.yaml`에서 destination host를 FQDN으로 변경:
```yaml
# Before
grafanaService: kube-prometheus-stack-dev-grafana.monitoring.svc
prometheusService: kube-prometheus-stack-dev-prometheus.monitoring.svc

# After
grafanaService: kube-prometheus-stack-dev-grafana.monitoring.svc.cluster.local
prometheusService: kube-prometheus-stack-dev-prometheus.monitoring.svc.cluster.local
```

## Result
수정 후 ArgoCD 자동 sync → VirtualService 업데이트 → 503 해결, Grafana/Prometheus 정상 접근 확인.

회귀 테스트: VirtualService destination host를 kubectl로 확인 가능 (`kubectl get vs -n monitoring -o jsonpath`).

재발 방지: **Istio Gateway를 통한 cross-namespace 서비스 참조 시 반드시 `.svc.cluster.local` FQDN 사용**. sidecar 환경에서는 DNS search domain이 있어 `.svc`로도 동작하지만, Gateway는 다름.

## Related Files
- Goti-monitoring/charts/goti-monitoring/values-dev.yaml
- Goti-monitoring/charts/goti-monitoring/templates/istio-gateway.yaml
