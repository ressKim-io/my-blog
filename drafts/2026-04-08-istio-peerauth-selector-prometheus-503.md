---
date: 2026-04-08
category: troubleshoot
project: Goti-k8s
tags: [istio, mtls, prometheus, peerauthentication, authorizationpolicy, 503, 403, metrics, scrape]
---

# Istio STRICT mTLS에서 Prometheus scrape 503→403 — PeerAuthentication selector 누락 + AuthorizationPolicy source identity 불일치

## Context

prod(EKS) 환경에서 goti 네임스페이스의 3개 서비스(goti-load-observer, goti-guardrail, goti-queue-gate) 메트릭이 Grafana 대시보드에 표시되지 않는 문제 발견. K6 부하테스트 대시보드, Guardrail 대시보드, Queue-Gate 대시보드 모두 데이터 없음.

- Istio mesh-wide STRICT mTLS 적용 중
- Prometheus(kube-prometheus-stack)는 monitoring namespace에 배포, **Istio sidecar 미주입**
- 3개 서비스는 goti namespace에 배포, Istio sidecar 주입됨 (2/2 containers)
- ServiceMonitor로 Prometheus pull 방식 스크래핑

## Issue

```
Prometheus targets → health: "down"
scrapeUrl: http://10.1.0.107:9090/metrics
lastError: "server returned HTTP status 503 Service Unavailable"
```

3개 서비스 모두 동일한 503 에러:

| 서비스 | 메트릭 포트 | health |
|--------|-----------|--------|
| goti-load-observer-prod | 9090 | down (503) |
| goti-guardrail-prod | 8000 | down (503) |
| goti-queue-gate-prod (x2) | 8080 | down (503) |

ArgoCD `goti-istio-policy` 앱이 OutOfSync 상태:

```
PeerAuthentication.security.istio.io "goti-permissive-for-scrape" is invalid:
  spec: Invalid value: "object": portLevelMtls requires selector (retried 5 times)
```

재현 조건: mesh-wide STRICT mTLS + Prometheus sidecar 미주입 + PeerAuthentication에 selector 없이 portLevelMtls 사용

## Action

### 진단 과정

1. **가설: K6 메트릭이 Mimir에 push 안 됨**
   → Mimir `label/__name__/values`에 `k6_*` 메트릭명 존재 확인. 하지만 실제 시리즈(data)는 0건
   → K6 직접 push 문제가 아닌, goti-load-observer가 수집하는 메트릭도 없음

2. **가설: goti-load-observer pod 자체 문제**
   → Pod 2/2 Running, ready=true, 로그 정상 (DB connected, poller started)
   → `curl http://goti-load-observer-prod.goti.svc:9090/metrics` → 정상 응답 (`goti_match_info` 등 확인)

3. **가설: Prometheus가 observer를 타겟으로 인식 못함**
   → `kubectl get servicemonitor` → `goti-load-observer-prod` 존재, `release: kube-prometheus-stack-prod` 라벨 정상
   → Prometheus targets API → `goti-load-observer-prod` job 존재하지만 `health: "down"`

4. **가설: Istio mTLS로 인한 503** ← **근본 원인**
   → Prometheus pod에 Istio sidecar 없음 (`containers: prometheus config-reloader`)
   → Plain HTTP로 Pod IP 직접 scrape → Istio sidecar가 mTLS 아닌 요청 거부 → 503
   → `PeerAuthentication goti-permissive-for-scrape` OutOfSync 확인
   → ArgoCD 에러: `portLevelMtls requires selector`

### 근본 원인 (Root Cause)

`peer-auth-prometheus-ports.yaml` 템플릿에서 `portLevelMtls`를 사용하면서 **`spec.selector` 필드를 누락**. Istio는 `portLevelMtls` 사용 시 반드시 selector로 대상 workload를 지정해야 함 (namespace-wide portLevelMtls 불가). Kubernetes admission webhook이 거부하여 ArgoCD sync 5회 retry 후 OutOfSync 상태로 방치.

dev 환경에서는 namespace 전체를 `mode: PERMISSIVE`로 설정하여 동작했으나, prod에서 보안 강화를 위해 portLevelMtls로 전환하면서 selector를 빠뜨림.

### 적용한 수정

기존 단일 PeerAuthentication(selector 없음, 3개 포트 나열)을 **서비스별 3개 PeerAuthentication으로 분리**, 각각 `selector.matchLabels`로 대상 지정:

```yaml
# goti-load-observer: 메트릭 포트 9090만 PERMISSIVE
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: goti-load-observer
  mtls:
    mode: STRICT
  portLevelMtls:
    9090:
      mode: PERMISSIVE

# goti-guardrail: 메트릭 포트 8000만 PERMISSIVE
# goti-queue-gate: 메트릭 포트 8080만 PERMISSIVE
# (동일 패턴)
```

보안 유지:
- 메트릭 포트만 PERMISSIVE, 비즈니스 포트는 STRICT 유지
- AuthorizationPolicy deny-all + allow-prometheus-scrape (monitoring ns, GET /metrics만)
- Istio 공식 권장 패턴 확인 (portLevelMtls + selector)

## Result (1차: 503→403)

PeerAuthentication selector 추가 후 ArgoCD sync 완료. 3개 PeerAuthentication 정상 생성 확인:

```
goti-guardrail-permissive-scrape       STRICT   22s
goti-load-observer-permissive-scrape   STRICT   22s
goti-queue-gate-permissive-scrape      STRICT   22s
```

그러나 503이 **403 Forbidden**으로 변경됨 — 2차 이슈 발생.

---

## Issue (2차: 403 Forbidden)

PeerAuthentication 적용 후 mTLS 문제는 해결되었으나, AuthorizationPolicy에서 차단:

```
Prometheus targets → health: "down"
lastError: "server returned HTTP status 403 Forbidden"
```

### 근본 원인 (2차)

`allow-prometheus-scrape` AuthorizationPolicy에서 `source.namespaces: ["monitoring"]`을 사용하고 있었으나, **Prometheus에 Istio sidecar가 없으므로 mTLS identity가 없음** → Istio가 source namespace를 식별할 수 없어 `source.namespaces` 조건이 매칭 실패 → deny-all에 의해 403.

추가로 queue-gate(Go/Gin)는 포트 8080에서 `/metrics`를 노출하지만, AuthorizationPolicy에서 8080은 `/actuator/prometheus`(Spring Boot용)만 허용 → 경로 불일치.

### 적용한 수정 (2차)

`allow-prometheus-scrape.yaml` 수정:

1. **`source.namespaces: ["monitoring"]` 제거** — sidecar 없는 Prometheus는 mTLS identity 없으므로 매칭 불가
2. **8080 포트에 `/metrics` 경로 추가** — queue-gate 대응
3. 포트+경로+메서드 조합으로 접근 제한 유지 (비즈니스 포트는 deny-all로 차단)

```yaml
# Before: source identity 기반 (sidecar 없으면 동작 불가)
rules:
  - from:
      - source:
          namespaces: ["monitoring"]
    to:
      - operation:
          ports: ["8080"]
          paths: ["/actuator/prometheus"]

# After: 포트+경로 기반 (sidecar 유무 무관)
rules:
  - to:
      - operation:
          ports: ["8080"]
          paths: ["/actuator/prometheus", "/metrics"]
```

보안 분석:
- `source.namespaces` 제거로 인한 위험: 메트릭 포트(9090/8000/8080)의 GET /metrics 경로만 허용
- 비즈니스 데이터 미노출 (Go runtime, collector stats만)
- deny-all이 기본이므로 명시적 ALLOW 경로 외에는 전부 차단

## Result (2차)

- 검증 대기 중 (push 완료)

### 재발 방지

- `portLevelMtls` 사용 시 반드시 `selector` 포함 — Istio validation 규칙
- sidecar 없는 컴포넌트가 source일 때 `source.namespaces` 사용 금지 — mTLS identity 필요
- 새로운 goti 서비스에 ServiceMonitor 추가 시 체크리스트:
  1. ServiceMonitor 생성
  2. PeerAuthentication portLevelMtls 추가 (해당 메트릭 포트)
  3. AuthorizationPolicy에 해당 포트+경로 추가
- ArgoCD OutOfSync 알림 즉시 확인 (sync 실패 방치 → 메트릭 수집 중단)

### 대안 검토 결과

| 방식 | 판단 |
|------|------|
| portLevelMtls PERMISSIVE + 포트/경로 ALLOW (채택) | Istio 공식 권장, ServiceMonitor 호환 |
| Istio metrics merging | `prometheus.io` annotation 기반 → ServiceMonitor와 불일치, 부적합 |
| Prometheus에 sidecar 주입 | kube-prometheus-stack 충돌 가능, 운영 복잡도 증가, 비권장 |
| source.ipBlocks | EKS VPC CNI에서 Pod IP 변경 가능, 유지보수 어려움, 비권장 |

## Related Files

- `Goti-k8s/infrastructure/prod/istio/goti-policy/templates/peer-auth-prometheus-ports.yaml` — PeerAuthentication selector 추가
- `Goti-k8s/infrastructure/prod/istio/goti-policy/templates/allow-prometheus-scrape.yaml` — source.namespaces 제거 + /metrics 경로 추가
- `Goti-k8s/infrastructure/prod/istio/goti-policy/values.yaml`
- `Goti-k8s/infrastructure/dev/istio/goti-policy/templates/peer-auth-prometheus-ports.yaml` (참고: dev는 namespace-wide PERMISSIVE)
