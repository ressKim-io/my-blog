---
title: "PeerAuthentication selector 누락이 Prometheus scrape를 멈춘 경위 — 503→403 복합 트러블"
excerpt: "Istio STRICT mTLS Phase 1 적용 중 PeerAuthentication portLevelMtls에 selector를 빠뜨려 Prometheus scrape가 503이 되었고, 수정 후에는 AuthorizationPolicy source identity 불일치로 403이 추가 발생한 복합 트러블슈팅 기록입니다."
category: istio
tags:
  - go-ti
  - Istio
  - PeerAuthentication
  - mTLS
  - Prometheus
  - troubleshooting
series:
  name: goti-istio-ops
  order: 2
date: "2026-04-08"
---

## 한 줄 요약

> PeerAuthentication `portLevelMtls` 사용 시 `selector` 누락 → ArgoCD OutOfSync → Prometheus 503, 수정 후 sidecar 없는 Prometheus의 mTLS identity 부재로 AuthorizationPolicy가 403을 추가 반환한 2단계 트러블입니다.

---

## 🔥 문제: Grafana 대시보드 메트릭 전체 소멸

### 환경

go-ti 프로젝트는 Istio 1.29.0 sidecar 모드로 MSA 5개 서비스 전체를 mesh에 올린 상태입니다.

초기에는 VirtualService 라우팅만 사용하는 "껍데기" 수준이었지만, Phase 1에서 mTLS 강화(STRICT 모드), AuthorizationPolicy, RequestAuthentication JWT를 순차 적용했습니다. 이 글은 Phase 1 mTLS 정책을 프로덕션(EKS `goti-prod`)에 배포하는 과정에서 발생한 이슈입니다.

**PeerAuthentication**은 워크로드 간 mTLS를 제어하는 Istio 정책입니다. `mode: STRICT`로 설정하면 sidecar가 없는 컴포넌트(plain HTTP)의 요청은 거부됩니다. Prometheus(kube-prometheus-stack)는 `monitoring` 네임스페이스에 배포되어 있고 **Istio sidecar가 주입되지 않은 상태**였습니다. Prometheus는 ServiceMonitor로 `goti` 네임스페이스의 3개 서비스를 pull 방식으로 scrape합니다.

### 발견한 문제

K6 부하테스트 대시보드, Guardrail 대시보드, Queue-Gate 대시보드가 모두 데이터 없음 상태였습니다.

Prometheus targets를 확인했습니다.

```text
Prometheus targets → health: "down"
scrapeUrl: http://10.1.0.107:9090/metrics
lastError: "server returned HTTP status 503 Service Unavailable"
```

3개 서비스 모두 동일하게 503이었습니다.

| 서비스 | 메트릭 포트 | health |
|--------|-----------|--------|
| goti-load-observer-prod | 9090 | down (503) |
| goti-guardrail-prod | 8000 | down (503) |
| goti-queue-gate-prod (×2) | 8080 | down (503) |

동시에 ArgoCD `goti-istio-policy` 앱이 OutOfSync 상태였습니다.

```text
PeerAuthentication.security.istio.io "goti-permissive-for-scrape" is invalid:
  spec: Invalid value: "object": portLevelMtls requires selector (retried 5 times)
```

---

## 🤔 원인: 두 단계로 나뉜 근본 원인

### 1차 원인 — `portLevelMtls`에 `selector` 누락

진단 과정을 단계별로 정리합니다.

**1단계 — K6 메트릭 push 문제 의심**

Mimir `label/__name__/values`에 `k6_*` 메트릭명은 존재했으나 실제 시리즈(data)는 0건이었습니다. K6 직접 push 문제가 아니라 goti-load-observer가 수집하는 메트릭 자체가 없는 상황임을 확인했습니다.

**2단계 — Pod 자체 문제 의심**

```bash
$ kubectl get pods -n goti
# Pod 2/2 Running, ready=true

$ kubectl exec -n goti <pod> -- curl http://goti-load-observer-prod.goti.svc:9090/metrics
# 정상 응답 (goti_match_info 등 확인)
```

Pod 자체는 정상이었습니다.

**3단계 — ServiceMonitor 인식 문제 의심**

```bash
$ kubectl get servicemonitor -n monitoring
# goti-load-observer-prod 존재, release: kube-prometheus-stack-prod 라벨 정상

# Prometheus targets API 확인 → job 존재하나 health: "down"
```

**4단계 — Istio mTLS 차단 확인 (근본 원인)**

Prometheus pod에 Istio sidecar가 없어(`containers: prometheus config-reloader`) plain HTTP로 Pod IP를 직접 scrape합니다. Istio sidecar가 mTLS가 아닌 요청을 거부하여 503을 반환한 것입니다.

`PeerAuthentication goti-permissive-for-scrape`의 ArgoCD 에러를 확인했습니다.

```text
portLevelMtls requires selector (retried 5 times)
```

**핵심은 `peer-auth-prometheus-ports.yaml` 템플릿에서 `portLevelMtls`를 사용하면서 `spec.selector` 필드를 누락한 것**입니다.

Istio는 `portLevelMtls` 사용 시 반드시 selector로 대상 workload를 지정해야 합니다. namespace-wide portLevelMtls는 허용되지 않습니다. Kubernetes admission webhook이 이 요청을 거부했고, ArgoCD는 sync를 5회 retry한 뒤 OutOfSync 상태로 방치했습니다.

dev 환경에서는 namespace 전체를 `mode: PERMISSIVE`로 설정하여 문제 없이 동작했습니다. prod에서 보안 강화를 위해 portLevelMtls로 전환하면서 selector를 빠뜨린 것이 원인이었습니다.

### 2차 원인 — sidecar 없는 Prometheus의 mTLS identity 부재

1차 수정 후 503은 해소됐지만 **403 Forbidden**이 새로 발생했습니다.

```text
Prometheus targets → health: "down"
lastError: "server returned HTTP status 403 Forbidden"
```

`allow-prometheus-scrape` AuthorizationPolicy에서 `source.namespaces: ["monitoring"]`을 사용했으나, Prometheus에 Istio sidecar가 없으므로 **mTLS identity가 없습니다**. Istio는 source namespace를 식별할 수 없어 `source.namespaces` 조건이 매칭에 실패합니다. deny-all 정책에 의해 403이 반환된 것입니다.

추가로 goti-queue-gate(Go/Gin)는 포트 8080에서 `/metrics`를 노출하지만 AuthorizationPolicy에서 8080은 `/actuator/prometheus`(Spring Boot용 경로)만 허용되어 경로 불일치도 발생했습니다.

---

## 🧭 선택지 비교

Prometheus scrape 허용 방식으로 4가지 선택지를 검토했습니다.

| 옵션 | 방식 | 판단 |
|------|------|------|
| A. portLevelMtls PERMISSIVE + 포트/경로 ALLOW | 메트릭 포트만 PERMISSIVE, AuthorizationPolicy로 경로 제한 | **채택** — Istio 공식 권장, ServiceMonitor 호환 |
| B. Istio metrics merging | `prometheus.io` annotation 기반 자동 수집 | ServiceMonitor와 불일치 → 탈락 |
| C. Prometheus sidecar 주입 | kube-prometheus-stack에 Istio sidecar 강제 주입 | operator 충돌 가능, 운영 복잡도 증가 → 비권장 |
| D. source.ipBlocks | EKS VPC CNI에서 Pod IP를 화이트리스트 | Pod IP 변경 가능, 유지보수 부담 → 비권장 |

옵션 A를 채택한 결정 기준은 다음과 같습니다.

1. **ServiceMonitor 호환성**: kube-prometheus-stack은 ServiceMonitor pull 방식이 표준이며, Istio metrics merging(옵션 B)은 annotation 기반으로 동작 방식이 달라 기존 ServiceMonitor 구성과 공존이 어렵습니다
2. **운영 복잡도 최소화**: Prometheus에 sidecar를 주입하면(옵션 C) kube-prometheus-stack operator와의 충돌 가능성이 있고 업그레이드 시마다 sidecar 주입 여부를 별도 관리해야 합니다
3. **안정적인 IP 참조**: EKS VPC CNI 환경에서 Pod IP는 재스케줄 시 변경됩니다. ipBlocks(옵션 D)는 유지보수가 까다롭습니다
4. **Istio 공식 권장 패턴**: portLevelMtls + selector 조합은 Istio 공식 문서에서 권장하는 방식입니다

---

## ✅ 해결: 서비스별 PeerAuthentication 분리 + AuthorizationPolicy 수정

### 1차 수정 — PeerAuthentication selector 추가

기존 단일 PeerAuthentication(selector 없음, 3개 포트 나열)을 **서비스별 3개 PeerAuthentication으로 분리**하고 각각 `selector.matchLabels`를 지정했습니다.

```yaml
# goti-load-observer: 메트릭 포트 9090만 PERMISSIVE
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: goti-load-observer-permissive-scrape
  namespace: goti
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: goti-load-observer  # selector 필수
  mtls:
    mode: STRICT
  portLevelMtls:
    9090:
      mode: PERMISSIVE

# goti-guardrail: 메트릭 포트 8000만 PERMISSIVE (동일 패턴)
# goti-queue-gate: 메트릭 포트 8080만 PERMISSIVE (동일 패턴)
```

메트릭 포트만 PERMISSIVE로 열고 비즈니스 포트는 STRICT를 유지합니다.

ArgoCD sync 완료 후 3개 PeerAuthentication이 정상 생성되었습니다.

```bash
$ kubectl get peerauthentication -n goti
NAME                                   MODE     AGE
goti-guardrail-permissive-scrape       STRICT   22s
goti-load-observer-permissive-scrape   STRICT   22s
goti-queue-gate-permissive-scrape      STRICT   22s
```

### 2차 수정 — AuthorizationPolicy source.namespaces 제거 + 경로 추가

```yaml
# Before: source identity 기반 (sidecar 없으면 동작 불가)
rules:
  - from:
      - source:
          namespaces: ["monitoring"]  # sidecar 없으면 identity 없음
    to:
      - operation:
          ports: ["8080"]
          paths: ["/actuator/prometheus"]  # queue-gate(Go)는 /metrics 사용

# After: 포트+경로 기반 (sidecar 유무 무관)
rules:
  - to:
      - operation:
          ports: ["8080"]
          paths: ["/actuator/prometheus", "/metrics"]  # Go 서비스 경로 추가
```

수정 내용은 두 가지입니다.

첫째, `source.namespaces: ["monitoring"]`을 제거했습니다. sidecar가 없는 Prometheus는 mTLS identity가 없으므로 이 조건이 매칭되지 않습니다. source identity 없이 포트+경로+메서드 조합으로만 접근을 제한했습니다.

둘째, 8080 포트에 `/metrics` 경로를 추가했습니다. goti-queue-gate는 Go/Gin 기반으로 Prometheus 기본 경로인 `/metrics`를 사용합니다.

보안 관점에서 `source.namespaces` 제거로 인한 위험을 분석했습니다. 메트릭 포트(9090/8000/8080)의 `GET /metrics` 경로만 허용하고 비즈니스 데이터는 노출되지 않습니다. 기본 deny-all 정책이 유지되므로 명시적 ALLOW 경로 외에는 전부 차단됩니다.

---

## 📚 배운 점

- **`portLevelMtls`에 `selector`는 필수**: namespace-wide portLevelMtls는 Istio admission webhook에서 거부됩니다. 사용 전 공식 문서에서 이 조건을 반드시 확인해야 합니다

- **sidecar 없는 컴포넌트에 `source.namespaces` 사용 금지**: `source.namespaces`, `source.principals` 등 source identity 기반 조건은 mTLS가 구성된 sidecar가 있어야 동작합니다. Prometheus처럼 sidecar 없이 plain HTTP로 접근하는 컴포넌트에는 적용할 수 없습니다

- **ArgoCD OutOfSync 알림은 즉시 확인**: sync 실패를 방치하면 정책 변경이 적용되지 않은 채 운영됩니다. 이번 사례처럼 mTLS 정책이 실패한 채로 방치되면 메트릭 수집이 중단됩니다

- **새 서비스 ServiceMonitor 추가 시 3종 체크리스트**: (1) ServiceMonitor 생성 → (2) PeerAuthentication portLevelMtls 추가(해당 메트릭 포트, selector 포함) → (3) AuthorizationPolicy에 해당 포트+경로 추가. 이 순서를 빠뜨리면 503 또는 403이 조합으로 발생합니다

- **503과 403은 Istio에서 다른 레이어**: 503은 mTLS 계층(PeerAuthentication)에서, 403은 인가 계층(AuthorizationPolicy)에서 발생합니다. 한 번에 두 정책을 수정하면 원인을 구분하기 어려우므로 계층별로 순차 수정하고 검증하는 것이 좋습니다
