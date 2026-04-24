---
title: "Alloy → OTel Collector 전환 직후 CrashLoop — NetworkPolicy egress 누락 + Loki rate limit 초과"
excerpt: "좋은 결정으로 수집기를 교체했는데, 전환 직후 argocd-server와 otel-collector-back이 동시에 무너졌습니다. 5단계 가설 검증 끝에 두 문제의 근본 원인을 각각 잡아냈습니다."
category: argocd
tags:
  - go-ti
  - ArgoCD
  - OTel-Collector
  - Alloy
  - NetworkPolicy
  - Loki
  - troubleshooting
series:
  name: goti-argocd
  order: 4
date: "2026-03-30"
---

## 한 줄 요약

> Alloy → OTel Collector 전환 PR 머지 직후, argocd-server(NetworkPolicy egress 누락)와 otel-collector-back(Loki ingestion rate 초과)이 동시에 CrashLoop에 빠졌습니다. 두 문제는 원인이 완전히 달랐고, 각각 독립적으로 수정해야 했습니다

---

## 🔥 문제: 두 컴포넌트 동시 CrashLoop

### 전환 배경

Goti 프로젝트는 관측성 수집기를 Grafana Alloy에서 OTel Collector로 교체하기로 결정했습니다.

전환 이유는 4가지였습니다.

**커뮤니티 자료 부족**: Alloy는 River라는 독자적인 문법을 사용합니다. Kafka 연동에서 문제가 생기면 검색 결과가 OTel Collector YAML 기반 자료만 나왔습니다. River 문법으로 변환하는 작업은 팀원이 직접 해야 했고, 이는 학습 비용을 높였습니다.

**Kafka 연동 공식 지원**: 30만 동시 접속 목표에서 로그 급증 시 Loki/Tempo OOM이 위험 요소였습니다. OTel Collector는 `kafkaexporter`/`kafkareceiver`가 공식 contrib으로 제공됩니다. 기존에 traces만 Kafka를 경유했는데, logs도 Kafka 버퍼에 태우는 구조로 전환해 스파이크 대응력을 높일 수 있었습니다.

**벤더 중립**: Alloy의 `loki.process`, `prometheus.remote_write`, `mimir.rules.kubernetes` 등은 Grafana 전용 블록입니다. OTel Collector로 전환하면 이 의존을 끊을 수 있었습니다.

**팀 학습 용이성**: OTel은 CNCF 표준 스택입니다. 팀 전체가 트러블슈팅 시 공통 자료를 활용할 수 있는 범용 도구였습니다.

이 결정은 ADR-0007로 정리되어 Accepted 상태였습니다. 2026-03-30, Alloy 영구 제거(Goti-k8s #155), OTel Collector Front/Back 배포(#152), OTLP endpoint 전환(#154) — 4단계 PR을 모두 머지했습니다.

### 발생한 문제

PR 머지 직후 두 컴포넌트가 동시에 무너졌습니다.

**문제 1: otel-collector-back CrashLoopBackOff (26회 재시작)**

```text
2026-03-30T14:33:23Z info Exporting failed. Will retry the request after interval.
  otelcol.component.id=otlphttp/loki
  error="rpc error: code = ResourceExhausted desc = error exporting items,
    request to http://loki-dev.monitoring.svc:3100/otlp/v1/logs responded with
    HTTP Status Code 429,
    Message=ingestion rate limit exceeded for user fake
    (limit: 4194304 bytes/sec)
    while attempting to ingest '1212' lines totaling '1969264' bytes,
    reduce log volume or contact your Loki administrator to see if the limit can be increased"
  interval="4.23353473s"
```

Loki가 HTTP 429를 반환하고 있었습니다. OTel Collector Back이 Kafka에서 로그를 소비해 Loki로 전송하는데, 기본 ingestion rate limit(4MB/sec)을 초과한 것입니다.

retry가 누적되면서 메모리가 쌓이고, 결국 crash → 재시작 → Kafka에서 다시 소비 → 동일 초과 → crash가 반복되는 루프에 빠졌습니다.

**문제 2: argocd-server CrashLoopBackOff (22회 이상 재시작)**

```text
time="2026-03-30T14:24:19Z" level=info msg="ArgoCD API Server is starting" version=v3.3.2
time="2026-03-30T14:24:19Z" level=info msg="Loading Redis credentials from environment variables"
time="2026-03-30T14:24:19Z" level=info msg="Loading Redis credentials from environment variables"
time="2026-03-30T14:24:19Z" level=info msg="Starting configmap/secret informers"
(여기서 로그 끊김 — 30초 후 liveness probe 실패로 kill)
```

`Starting configmap/secret informers` 로그 이후 아무것도 출력되지 않았습니다. 포트 8080 바인딩이 되지 않고, liveness probe(`/healthz?full=true`, initialDelaySeconds: 10, failureThreshold: 3)가 실패해 kubelet이 SIGTERM(exitCode: 143)을 보냈습니다.

흥미롭게도 application-controller와 repo-server는 정상 Running 상태였습니다.

---

## 🤔 원인: 각각 독립적인 두 가지 근본 원인

### 원인 1: Loki ingestion rate limit (otel-collector-back)

Alloy가 직접 Loki OTLP로 전송할 때는 자체 rate control이 동작했습니다. OTel Collector는 Kafka batch를 더 공격적으로 전송합니다. 배치당 ~1200 lines / ~2MB씩 전송하는데, retry 증폭이 더해지면 Loki 기본 limit(4MB/sec)이 금방 초과됩니다.

`Loki values`를 확인하니 `ingestion_rate_mb` 설정이 없었고, 기본값 4MB/sec를 사용하고 있었습니다.

### 원인 2: NetworkPolicy egress 누락 (argocd-server)

argocd-server 문제는 결정적 단서를 찾기까지 5단계 가설 검증이 필요했습니다.

단서는 `argocd-redis-secret-init` Job pod 로그에서 나왔습니다.

```text
{"level":"fatal","msg":"Post \"https://10.96.0.1:443/api/v1/namespaces/argocd/secrets\":
  dial tcp 10.96.0.1:443: i/o timeout","time":"2026-03-30T15:38:51Z"}
```

K8s API server(10.96.0.1:443)에 연결 자체가 차단되고 있었습니다.

```bash
$ kubectl get networkpolicy -n argocd
NAME                        POD-SELECTOR
default-deny-all            <모든 pod>
allow-controller-k8s-api    app=application-controller
allow-argocd-server         app=argocd-server
```

`default-deny-all`이 전체 namespace의 ingress/egress를 차단하는 상황에서, K8s API(443/6443) egress는 `application-controller`에만 열려 있었습니다. `allow-argocd-server` 정책은 Ingress(8080)만 있고, **Egress 규칙이 없었습니다.**

argocd-server의 informer가 K8s API에 LIST/WATCH 요청을 보내지 못해 `WaitForCacheSync()`에서 무한 대기 상태에 빠진 것입니다.

application-controller는 egress rule이 있어서 정상이었고, repo-server는 GitHub egress(443)가 K8s API와 포트가 같아서 우연히 동작하고 있었습니다.

### 왜 5단계 가설이 필요했는가

argocd-server 문제는 증상만으로는 원인을 특정하기 어려웠습니다. 5단계 검증 과정이 중요한 기록이어서 남깁니다.

**가설 1 — OTel Collector 불안정 영향**: collector-back CrashLoop이 전체 불안정을 유발한다고 의심했습니다. collector-back을 해결한 후에도 argocd-server 증상이 동일하게 지속되어 기각했습니다.

**가설 2 — OTLP tracing gRPC blocking**: ArgoCD values에 `otlp.address: otel-collector-front-dev-...:4317`이 설정되어 있었습니다. gRPC 연결이 startup을 blocking하는지 소스 코드를 확인했습니다.

```text
NewServer() → ensureSynced() → WaitForCacheSync()  ← 여기서 hang
Init() → Listen() → InitTracer()  ← OTLP는 여기서 초기화 (도달 못 함)
```

OTLP 초기화는 informer sync 이후에 발생하는 코드 경로였습니다. hang 지점에 도달조차 못 했으므로 기각했습니다. 확인 차원에서 OTLP를 일시 비활성화했지만 원인이 아님이 확인됐습니다.

**가설 3 — Istio sidecar race condition**: Istio sidecar가 ready 전에 앱 컨테이너가 시작되면 K8s API 호출이 차단될 수 있습니다(argoproj/argo-cd#10391). `holdApplicationUntilProxyStarts: true` annotation을 추가했으나 효과가 없었습니다. prod에만 이 설정이 있고 dev에는 없었다는 점도 발견했습니다. 기여 요인일 수 있으나 근본 원인은 아니었습니다.

**가설 4 — 리소스 부족(BestEffort QoS)**: `resources: {}`로 설정되어 BestEffort QoS 등급이었습니다. `kubectl top nodes`를 확인하니 전체 노드 메모리 최대 19%로 여유로웠습니다. resources를 추가(requests: 100m/256Mi, limits: 500m/512Mi)해도 동일 증상이 지속되어 기여 요인에 불과했습니다.

**가설 5 — NetworkPolicy egress 차단**: `argocd-redis-secret-init` Job log에서 i/o timeout을 발견하면서 결정적 단서를 잡았습니다. `kubectl get networkpolicy -n argocd`로 정책 목록을 확인하니 `allow-argocd-server`에 Egress 규칙이 없었습니다. 근본 원인이 확정됐습니다.

---

## ✅ 해결: 두 문제 각각 수정

### 해결 1: Loki ingestion rate limit 상향

`Goti-monitoring/values-stacks/dev/loki-values.yaml`에 rate limit 설정을 추가했습니다.

```yaml
# loki-values.yaml (dev)
limits_config:
  ingestion_rate_mb: 16          # 기본 4 → 16
  ingestion_burst_size_mb: 32    # 기본 6 → 32
  per_stream_rate_limit: 5MB     # 기존 3MB
  per_stream_rate_limit_burst: 15MB  # 기존 10MB
```

OTel Collector가 Kafka batch를 공격적으로 소비하는 특성을 수용하는 값으로 상향했습니다. 4배 여유를 확보해 retry 증폭이 더해져도 limit를 초과하지 않도록 했습니다.

### 해결 2: argocd-server Egress 추가

`Goti-k8s/infrastructure/dev/network-policies/argocd-netpol.yaml`에 Egress 규칙을 추가했습니다.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-argocd-server
  namespace: argocd
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: argocd-server
  policyTypes:
    - Ingress
    - Egress   # ← 추가
  ingress:
    - ports:
        - port: 8080
  egress:
    # K8s API server
    - ports:
        - port: 443
          protocol: TCP
        - port: 6443
          protocol: TCP
      to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
              - 169.254.169.254/32  # IMDS 차단 유지
```

### 추가 이슈: SSA policyTypes merge 실패

NetworkPolicy에 `policyTypes: [Ingress, Egress]`를 추가한 뒤 ArgoCD ServerSideApply(SSA)로 sync했는데, `policyTypes`에 `Egress`가 반영되지 않는 현상이 발생했습니다.

SSA merge 시 기존 `policyTypes: [Ingress]`와 새 `[Ingress, Egress]`가 제대로 병합되지 않은 것입니다. 강제 re-sync로 해결했습니다.

```bash
$ kubectl annotate application network-policies -n argocd \
  argocd.argoproj.io/refresh=hard --overwrite
```

### 검증 결과

| 컴포넌트 | 수정 전 | 수정 후 |
|----------|---------|---------|
| otel-collector-back | CrashLoopBackOff (26회) | Running, 재시작 0회 (24분+ 안정) |
| otel-collector-front | 7회 재시작 후 안정 | Running, 안정 |
| argocd-server | CrashLoopBackOff (22회+) | 1/1 Running, 재시작 0회 |
| argocd-application-controller | Running (영향 없음) | Running |
| argocd-redis-secret-init | CrashLoopBackOff | 정상 완료 (Job 소멸) |

두 문제가 완전히 독립적이었음이 검증 결과에서도 드러납니다. collector-back을 먼저 수정해도 argocd-server는 계속 crash했고, argocd-server를 수정해도 collector-back은 계속 crash했습니다.

### 부수 변경 (같은 세션)

| 변경 내용 | 레포 | 상태 |
|-----------|------|------|
| Prometheus 재활성화 + remoteWrite → Mimir | Goti-monitoring | 완료 |
| 대시보드/알림 Alloy → OTel Collector 전환 | Goti-monitoring | 완료 |
| alloy-values.yaml (dev) 삭제 | Goti-monitoring | 완료 |
| ArgoCD server resources 추가 | Goti-k8s | 완료 |
| ArgoCD OTLP tracing 일시 비활성화 | Goti-k8s | 완료 (TODO: 재활성화) |
| holdApplicationUntilProxyStarts 추가 | Goti-k8s | 완료 (방어적 조치) |
| ADR-0007 Accepted + Mimir 취소 반영 | goti-team-controller | 완료 |

---

## 📚 배운 점

**NetworkPolicy는 "열려있지 않은 것은 모두 차단된다"**: `default-deny-all`이 있는 namespace에 새 컴포넌트를 추가할 때, Ingress만 열고 Egress를 빠뜨리는 실수가 쉽게 발생합니다. 특히 K8s API 접근이 필요한 컴포넌트(informer, leader election, webhook)는 반드시 egress rule을 함께 작성해야 합니다. "이 Pod가 K8s API를 호출하는가?"를 NetworkPolicy 리뷰의 첫 번째 질문으로 삼아야 합니다

**오래 running한 컴포넌트가 정상인 이유를 확인해야 한다**: application-controller와 repo-server가 정상이라는 사실이 오히려 판단을 흐렸습니다. 이들이 정상인 이유를 먼저 확인했다면 NetworkPolicy egress 차단을 더 빨리 찾았을 것입니다. application-controller는 egress rule이 있었고, repo-server는 우연히 포트가 겹쳐서 동작하고 있었습니다

**수집기 교체 시 rate limit을 재설정해야 한다**: 기존 수집기가 자체 rate control을 하고 있었다면, 새 수집기는 다른 패턴으로 전송합니다. OTel Collector는 Kafka batch를 Alloy보다 더 공격적으로 소비합니다. rate limit 기본값을 새 수집기의 특성에 맞게 검토하고 상향해야 합니다

**ArgoCD SSA에서 array 필드 변경 시 강제 re-sync가 필요할 수 있다**: `policyTypes` 같은 배열 필드를 추가하는 변경은 SSA merge가 의도대로 동작하지 않을 수 있습니다. sync 후 실제 리소스를 `kubectl get networkpolicy -o yaml`로 확인하는 습관이 필요합니다. 의도대로 반영되지 않았다면 `argocd.argoproj.io/refresh=hard` annotation으로 강제 re-sync합니다

**동시 다발 장애는 원인이 따로따로다**: 두 컴포넌트가 같은 시점에 crash했다고 해서 원인이 같은 것은 아닙니다. 타임라인이 겹칠 때 하나의 원인을 찾으려는 경향이 생기는데, 각각 독립적으로 진단해야 합니다

### 재발 방지

- NetworkPolicy 리뷰 체크리스트에 "K8s API egress 필요 여부 확인" 항목 추가
- Loki 대시보드에 `loki_distributor_bytes_received_total` rate 패널 추가 → limit 근접 사전 감지
- dev 환경 전체에 `holdApplicationUntilProxyStarts: true` 적용 검토 (방어적 조치)

### 남은 과제

- ArgoCD OTLP tracing 재활성화 (NetworkPolicy 수정 후 정상 동작 예상)
- dev Istio meshConfig에 `holdApplicationUntilProxyStarts: true` 글로벌 설정 검토
- Loki ingestion rate 대시보드 패널 추가
