---
title: "Istio VirtualService 503 에러: .svc와 .svc.cluster.local의 차이"
excerpt: "VirtualService destination host를 .svc로 끝냈더니 503 에러 — Istio Gateway는 DNS search domain이 없다"
category: kubernetes
tags:
  - go-ti
  - istio
  - virtualservice
  - gateway
  - dns
  - troubleshooting
  - kind
series:
  name: "goti-kind-monitoring"
  order: 2
date: "2026-03-13"
---

## 🎯 한 줄 요약

> VirtualService destination host를 `.svc`로 끝냈더니 503 에러. Istio Gateway는 sidecar와 달리 DNS search domain이 없어서, 반드시 `.svc.cluster.local` FQDN을 사용해야 합니다.

## 📊 Impact

- **영향 범위**: Grafana, Prometheus 외부 접근 불가
- **증상**: `https://kind.go-ti.shop/grafana/` 접속 시 503
- **발생일**: 2026-03-13

---

## 🔥 상황: Grafana 접속 시 503

ArgoCD 직접 참조 전환 후, `https://kind.go-ti.shop/grafana/`에 접속하면 503 에러가 발생했습니다.

```bash
$ curl -s -o /dev/null -w "%{http_code}" https://kind.go-ti.shop/grafana/
503
```

트래픽 흐름은 이렇습니다:

```
CloudFront → Kind PC:80 → Istio Gateway:31080 → Grafana
```

503이라는 것은 Istio Gateway까지는 도달했다는 의미입니다.
Gateway 뒤에서 라우팅이 실패한 것이 분명합니다.

---

## 🤔 원인 분석: 세 가지 가설

하나씩 가설을 세우고 검증했습니다.

**가설 1: CloudFront → Kind PC 네트워크 문제**

503이 반환된다는 것은 Gateway까지는 도달한 것입니다.
네트워크 문제라면 타임아웃이나 연결 거부가 발생해야 합니다.
부분 채택 — 네트워크는 문제없지만, Gateway 이후가 문제.

**가설 2: Kind PC 방화벽/포트포워딩**

ArgoCD 등 다른 서비스는 정상 접근 가능합니다.
기각.

**가설 3: VirtualService destination host DNS resolution 실패**

채택. 이것이 근본 원인이었습니다.

---

## 🤔 근본 원인: Gateway는 DNS search domain이 없다

VirtualService의 destination host가 `.svc`로 끝나고 있었습니다:

```yaml
# VirtualService destination
host: kube-prometheus-stack-dev-grafana.monitoring.svc
host: kube-prometheus-stack-dev-prometheus.monitoring.svc
```

Istio Gateway Pod는 `istio-system` 네임스페이스에 위치합니다.

여기서 핵심적인 차이가 있습니다.
**sidecar**와 **Gateway**는 DNS 처리 방식이 다릅니다.

sidecar 환경에서는 Kubernetes가 DNS search domain을 자동으로 설정합니다.
`<service>.monitoring.svc`로 끝나도 Kubernetes DNS resolver가 `.cluster.local`을 자동으로 붙여줍니다.

하지만 Istio Gateway는 다릅니다.
Gateway의 Envoy는 DNS search domain에 의존하지 않고, **Envoy 클러스터 이름으로 정확히 매칭**합니다.

Envoy가 실제로 등록한 클러스터 이름을 확인해보면:

```
outbound|80||kube-prometheus-stack-dev-grafana.monitoring.svc.cluster.local
outbound|9090||kube-prometheus-stack-dev-prometheus.monitoring.svc.cluster.local
```

`.svc.cluster.local`까지 전체 FQDN으로 등록되어 있습니다.
VirtualService에서 `.svc`로만 지정하면, Envoy가 일치하는 클러스터를 찾지 못하고 503을 반환합니다.

이것이 sidecar에서는 동작하지만 Gateway에서는 실패하는 이유입니다.

---

## ✅ 해결: FQDN으로 변경

`values-dev.yaml`에서 destination host를 FQDN으로 변경했습니다:

```yaml
# Before
grafanaService: kube-prometheus-stack-dev-grafana.monitoring.svc
prometheusService: kube-prometheus-stack-dev-prometheus.monitoring.svc

# After
grafanaService: kube-prometheus-stack-dev-grafana.monitoring.svc.cluster.local
prometheusService: kube-prometheus-stack-dev-prometheus.monitoring.svc.cluster.local
```

수정 후 ArgoCD가 자동으로 sync하면서 VirtualService가 업데이트됐습니다.
503이 사라지고, Grafana와 Prometheus에 정상 접근할 수 있게 됐습니다.

### 검증

```bash
$ curl -s -o /dev/null -w "%{http_code}" https://kind.go-ti.shop/grafana/
200
```

VirtualService의 destination host 확인도 가능합니다:

```bash
$ kubectl get vs -n monitoring -o jsonpath='{.items[*].spec.http[*].route[*].destination.host}'
```

---

## 📚 배운 점

### sidecar vs Gateway의 DNS 처리 차이

| 항목 | sidecar | Gateway |
|------|---------|---------|
| DNS search domain | 있음 (Kubernetes 자동 설정) | 없음 |
| `.svc`로 끝나는 호스트 | 동작함 | **503 에러** |
| `.svc.cluster.local` FQDN | 동작함 | 동작함 |

sidecar 환경에서는 `.svc`로 끝나도 문제가 없습니다.
Kubernetes DNS resolver가 search domain을 통해 자동으로 FQDN을 완성해주기 때문입니다.

하지만 Gateway를 통한 cross-namespace 서비스 참조 시에는 반드시 `.svc.cluster.local`까지 써야 합니다.

### 재발 방지 규칙

**Istio Gateway를 통한 서비스 참조 시 반드시 `.svc.cluster.local` FQDN을 사용해야 합니다.**

sidecar 환경에서 동작했다고 해서 Gateway에서도 동작할 거라고 가정하면 안 됩니다.
이 규칙은 VirtualService뿐 아니라, Gateway를 경유하는 모든 destination host에 적용됩니다.
