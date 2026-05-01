---
title: "동시에 터진 두 개의 CrashLoop: OTel Collector와 ArgoCD Server"
excerpt: "Alloy에서 OTel Collector 마이그레이션 후 Loki rate limit 초과와 NetworkPolicy egress 누락으로 발생한 이중 장애 해결기"
category: argocd
tags:
  - ArgoCD
  - Troubleshooting
  - OTel Collector
  - NetworkPolicy
  - Loki
  - CrashLoopBackOff
  - go-ti
series:
  name: "argocd-troubleshooting"
  order: 4
date: '2026-03-30'
---

## 한 줄 요약

> Alloy에서 OTel Collector로 마이그레이션한 직후, OTel Collector Back과 ArgoCD Server가 동시에 CrashLoopBackOff. 원인은 Loki rate limit 초과와 NetworkPolicy egress 누락이었다.

## 📊 Impact

- **영향 범위**: 전체 로그 수집 중단 + ArgoCD 관리 UI/API 중단
- **증상**: otel-collector-back 26회 재시작, argocd-server 22+회 재시작
- **소요 시간**: 약 4시간
- **발생일**: 2026-03-30

---

## 배경: Alloy → OTel Collector 마이그레이션

이 문제를 이해하려면 먼저 모니터링 파이프라인의 구조를 알아야 합니다.

기존에는 Grafana Alloy가 로그 수집과 전송을 모두 담당했습니다. 이번에 이걸 OTel Collector Front/Back 2-tier 구조로 마이그레이션했습니다.

![OTel Collector 2-Tier 파이프라인 아키텍처](/diagrams/argocd-otel-crashloop-networkpolicy-1.svg)

**Front**(DaemonSet)가 각 노드에서 로그를 수집하고 Kafka에 전송합니다. **Back**(Deployment)이 Kafka에서 소비해서 Loki, Tempo 등 백엔드로 전송하는 구조입니다.

Alloy에서 OTel Collector로 전환하면서 4개 PR을 머지했습니다:
- OTel Collector Front/Back 배포 (#152)
- OTLP endpoint 전환 (#154)
- Alloy 영구 제거 (#155)

PR 머지 직후, 두 개의 CrashLoopBackOff가 동시에 터졌습니다.

---

## 🔥 1. OTel Collector Back: Loki Rate Limit 초과

### 증상

otel-collector-back Pod이 26회 재시작을 반복했습니다. 로그를 보니 Loki가 **HTTP 429**로 응답하고 있었습니다.

```
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

핵심 수치를 뽑아보면:
- **Loki 기본 rate limit**: 4,194,304 bytes/sec (4MB/sec)
- **1회 전송량**: 1,212 lines / ~2MB
- **문제**: retry가 쌓이면서 실제 전송량이 limit을 초과

### Retry 증폭 사이클

단순히 "전송량 > limit"이 아니었습니다. **retry가 문제를 증폭**시키는 사이클이 있었습니다.

![Loki Retry 증폭 사이클](/diagrams/argocd-otel-crashloop-networkpolicy-2.svg)

1. Kafka에서 로그 배치(~2MB)를 소비합니다
2. Loki에 전송하면 429 응답이 옵니다
3. OTel Collector가 retry 큐에 해당 배치를 다시 넣습니다
4. 그 사이에 Kafka에서 새 배치가 또 들어옵니다
5. **이전 retry + 새 배치**가 동시에 전송되면서 limit을 더 초과합니다
6. 메모리가 누적되다가 OOM 또는 연속 실패로 crash → 재시작 → 반복

### Alloy와 OTel Collector의 차이

왜 Alloy 때는 괜찮았는데 OTel Collector로 바꾸니까 터졌을까요? 두 시스템의 차이를 비교해보겠습니다.

| 항목 | Alloy | OTel Collector Back |
|------|-------|---------------------|
| Loki 전송 방식 | 직접 push (자체 rate control) | Kafka batch 소비 → push |
| 전송 패턴 | 실시간 소량 (flow control) | 배치 단위 대량 전송 |
| Buffer | 자체 WAL | Kafka (unbounded) |
| Rate limit 초과 시 | Back pressure 적용 | retry 큐에 적재 → 증폭 |

Alloy는 로그를 실시간으로 소량씩 전송하면서 자체적으로 흐름을 조절했습니다. OTel Collector Back은 Kafka에서 배치 단위로 소비하기 때문에, 전송 패턴이 더 공격적입니다. Kafka 자체가 "가능한 한 빨리 소비해라"라는 설계 철학을 갖고 있기 때문입니다.

### 해결

Loki의 ingestion rate limit을 올렸습니다.

```yaml
# Before: loki-values.yaml
limits_config:
  # ingestion_rate_mb: (미설정, 기본 4)
  # ingestion_burst_size_mb: (미설정, 기본 6)
  per_stream_rate_limit: 3MB
  per_stream_rate_limit_burst: 10MB

# After: loki-values.yaml
limits_config:
  ingestion_rate_mb: 16           # 4 → 16  (4배)
  ingestion_burst_size_mb: 32     # 6 → 32  (5배)
  per_stream_rate_limit: 5MB      # 3MB → 5MB
  per_stream_rate_limit_burst: 15MB  # 10MB → 15MB
```

**4배**로 올린 이유: 현재 OTel Collector가 배치당 ~2MB를 전송하고, 피크 시 2-3개 배치가 동시에 들어올 수 있습니다. 4MB에서는 1개 배치만으로도 limit에 근접했습니다. 16MB면 동시 배치 4개 정도를 수용할 수 있는 여유가 생깁니다.

### 검증

```bash
$ kubectl get pods -n monitoring | grep otel-collector-back
otel-collector-back-dev-7f8b9c6d4-xk2m3   2/2   Running   0   24m
```

Rate limit 변경 후 24분 이상 재시작 없이 안정적으로 동작했습니다. Loki 로그에서도 429 응답이 사라졌습니다.

### 핵심 포인트

- 모니터링 파이프라인 마이그레이션 시 **전송 패턴의 차이**를 반드시 고려해야 합니다
- Kafka buffer를 사용하면 배치 크기가 커지고 전송이 공격적이 됩니다 → 백엔드 rate limit 재검토 필수
- Loki rate limit은 `loki_distributor_bytes_received_total` 메트릭으로 모니터링 가능

---

## 🔥 2. ArgoCD Server: NetworkPolicy Egress 누락

이 문제가 더 까다로웠습니다. 5개의 가설을 검증한 끝에 근본 원인을 찾았습니다.

### 증상

argocd-server가 22회 이상 재시작을 반복했습니다. 로그를 보면 **informer 초기화에서 멈춰있었습니다**.

```
time="2026-03-30T14:24:19Z" level=info msg="ArgoCD API Server is starting" version=v3.3.2
time="2026-03-30T14:24:19Z" level=info msg="Loading Redis credentials from environment variables"
time="2026-03-30T14:24:19Z" level=info msg="Starting configmap/secret informers"
(여기서 로그 끊김 — 30초 후 liveness probe 실패로 kill)
```

`Starting configmap/secret informers` 이후 아무 로그도 없습니다. 30초 뒤에 liveness probe가 실패하면서 kubelet이 SIGTERM(exitCode: 143)으로 Pod을 죽이고, 다시 시작하면 같은 지점에서 멈추는 것을 반복했습니다.

흥미로운 점: **application-controller와 repo-server는 정상 동작** 중이었습니다. argocd-server만 죽고 있었습니다.

### 결정적 단서: redis-secret-init의 i/o timeout

argocd 네임스페이스의 다른 Pod 로그를 확인하다가 결정적 단서를 발견했습니다.

```json
// argocd-redis-secret-init Job pod
{"level":"fatal",
 "msg":"Post \"https://10.96.0.1:443/api/v1/namespaces/argocd/secrets\":
  dial tcp 10.96.0.1:443: i/o timeout",
 "time":"2026-03-30T15:38:51Z"}
```

`10.96.0.1:443`은 K8s API server의 ClusterIP입니다. **K8s API에 연결 자체가 차단**되고 있었습니다.

하지만 이 단서를 보기 전에 5개의 가설을 하나씩 검증했습니다. 그 과정을 공유합니다.

### 가설 검증 과정

#### 가설 1: OTel Collector 불안정 → 전체 모니터링 영향

첫 번째 의심은 "otel-collector-back이 CrashLoop이니까 전체 모니터링 스택이 불안정해진 것 아닌가?"였습니다.

- **검증**: otel-collector-back의 Loki rate limit 문제를 먼저 해결했습니다. 정상 동작 확인 후에도 argocd-server는 동일하게 CrashLoopBackOff를 반복했습니다.
- **결론**: **기각**. 두 문제는 독립적이었습니다.

#### 가설 2: OTLP tracing gRPC blocking

ArgoCD values에 OTLP tracing 설정이 있었습니다:

```yaml
# values-dev.yaml
controller:
  otlp:
    address: otel-collector-front-dev-opentelemetry-collector.monitoring.svc:4317
```

gRPC 연결이 startup을 blocking하는 것 아닌가 의심했습니다.

- **검증**: ArgoCD 소스 코드를 분석했습니다.

ArgoCD Server 시작 순서는 다음과 같습니다.

1. `NewServer()`
   - `ensureSynced()` 호출
   - `WaitForCacheSync()` ← 여기서 hang
2. `Init()`
   - `Listen(:8080)`
   - `InitTracer()` ← OTLP 초기화 (도달 못 함)

OTLP tracer 초기화는 `InitTracer()` 단계에서 발생하는데, 서버가 `WaitForCacheSync()`에서 멈추고 있으니 `InitTracer()`까지 도달하지 못합니다. 원인이 아닙니다.

- **조치**: 확인 차원에서 OTLP를 일시 비활성화했지만, 예상대로 효과 없었습니다.
- **결론**: **기각**.

#### 가설 3: Istio sidecar race condition

ArgoCD 이슈 [argoproj/argo-cd#10391](https://github.com/argoproj/argo-cd/issues/10391)에서 알려진 문제입니다. Istio sidecar가 ready 되기 전에 앱 컨테이너가 시작하면, K8s API 호출이 차단될 수 있습니다.

- **검증**: `holdApplicationUntilProxyStarts: true` annotation을 추가했습니다. 효과 없었습니다.
- **추가 발견**: prod에만 이 설정이 있고 dev에는 빠져 있었습니다. 방어적으로 dev에도 추가했지만 근본 원인은 아니었습니다.
- **결론**: **부분 기각**. sidecar race가 기여 요인일 수 있지만, 근본 원인은 다른 곳에 있었습니다.

#### 가설 4: 리소스 부족 (BestEffort QoS)

ArgoCD server의 resources 설정을 확인했더니 비어 있었습니다:

```yaml
# values-dev.yaml
server:
  resources: {}  # BestEffort QoS → 노드 리소스 부족 시 가장 먼저 evict
```

- **검증**: `kubectl top nodes`로 확인했더니 전체 노드 메모리 최대 19%, 여유로웠습니다.
- **조치**: 그래도 BestEffort는 좋지 않으니 resources를 추가했습니다.

```yaml
server:
  resources:
    requests:
      cpu: 100m
      memory: 256Mi
    limits:
      cpu: 500m
      memory: 512Mi
```

- **결론**: **기여 요인이나 근본 원인 아님**. resources 추가 후에도 동일 증상이었습니다.

#### 가설 5: NetworkPolicy egress 차단 (근본 원인)

`argocd-redis-secret-init` 로그에서 발견한 `i/o timeout` 단서를 추적했습니다.

```bash
$ kubectl get networkpolicy -n argocd
NAME                        POD-SELECTOR                  AGE
default-deny-all            <none>                        30d
allow-controller-k8s-api    app=application-controller    30d
allow-argocd-server         app=argocd-server             30d
allow-repo-server-github    app=repo-server               30d
```

각 NetworkPolicy의 내용을 확인했습니다:

| NetworkPolicy | 대상 Pod | Ingress | Egress |
|---------------|----------|---------|--------|
| `default-deny-all` | 전체 | ❌ 차단 | ❌ 차단 |
| `allow-controller-k8s-api` | application-controller | - | ✅ 443/6443 |
| `allow-argocd-server` | argocd-server | ✅ 8080 | **❌ 없음!** |
| `allow-repo-server-github` | repo-server | - | ✅ 443 (GitHub) |

**argocd-server에 Egress 규칙이 없었습니다!**

`default-deny-all`이 전체 namespace의 egress를 차단하고, `allow-argocd-server`는 Ingress(8080)만 열어두고 Egress를 설정하지 않았습니다.

### 왜 application-controller는 괜찮고 argocd-server만 문제였나?

![argocd 네임스페이스 NetworkPolicy Egress 비교](/diagrams/argocd-otel-crashloop-networkpolicy-3.svg)

- **application-controller**: `allow-controller-k8s-api`에서 443/6443 egress가 명시적으로 열려 있음 → 정상
- **repo-server**: `allow-repo-server-github`에서 443 egress가 열려 있고, K8s API도 443 포트를 사용하니까 **우연히** 동작
- **argocd-server**: Ingress(8080)만 열려 있고 Egress 규칙이 없음 → **K8s API 접근 차단**

repo-server가 "우연히" 동작한 것이 흥미로운 포인트입니다. GitHub용 443 egress가 K8s API(443)와 포트가 동일해서 의도치 않게 둘 다 허용된 것입니다.

### argocd-server에게 K8s API 접근이 왜 필요한가?

argocd-server는 시작 시 `WaitForCacheSync()`에서 K8s informer를 초기화합니다. Informer는 K8s API server에 LIST/WATCH 요청을 보내서 ConfigMap, Secret, Application 등의 리소스를 캐시합니다.

argocd-server 시작 순서는 다음과 같습니다.

1. Redis 연결 (ClusterIP 내부 통신, NetworkPolicy 무관)
2. ConfigMap/Secret informer 시작
   - K8s API server에 LIST 요청 ← 여기서 차단
   - `WaitForCacheSync()`가 무한 대기
3. liveness probe가 30초 후 실패
4. kubelet이 SIGTERM을 보내고 재시작

Egress가 차단되어 있으니 LIST 요청이 K8s API에 도달하지 못하고, informer가 영원히 대기하는 겁니다.

### 해결

`allow-argocd-server` NetworkPolicy에 Egress 규칙을 추가했습니다.

```yaml
# Before: argocd-netpol.yaml
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
    - Ingress        # Ingress만!
  ingress:
    - ports:
        - port: 8080

# After: argocd-netpol.yaml
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
    - Egress         # ← 추가!
  ingress:
    - ports:
        - port: 8080
  egress:            # ← 추가!
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
              - 169.254.169.254/32   # IMDS 차단
      ports:
        - port: 443
          protocol: TCP
        - port: 6443
          protocol: TCP
```

### 추가 이슈: SSA에서 policyTypes 변경이 반영 안 됨

NetworkPolicy를 수정해서 git push하고 ArgoCD가 sync했는데, **policyTypes에 Egress가 추가되지 않았습니다**.

이것은 [이전 글](/blog/argocd-ssa-sync-pitfalls)에서 다룬 SSA의 또 다른 함정입니다. SSA merge 시 array 필드 변경이 제대로 반영되지 않는 경우가 있습니다.

```bash
# hard refresh로 강제 re-sync
$ kubectl annotate application network-policies -n argocd \
    argocd.argoproj.io/refresh=hard --overwrite
```

Hard refresh 후에 policyTypes가 정상 반영되었습니다.

### 핵심 포인트

- **default-deny-all**을 사용하면 각 컴포넌트의 egress를 빠짐없이 확인해야 합니다
- "이 Pod가 K8s API를 호출하는가?" — informer, leader election, webhook, secret-init 등 많은 컴포넌트가 API 접근이 필요합니다
- **포트 번호가 같아서 "우연히" 동작하는 케이스**에 주의해야 합니다. repo-server의 GitHub egress가 K8s API도 허용한 것처럼, 의도치 않은 허용은 나중에 정책 변경 시 예상치 못한 장애를 만듭니다

---

## 📊 Before / After

### 전체 컴포넌트 상태

| 컴포넌트 | Before | After |
|----------|--------|-------|
| otel-collector-back | CrashLoopBackOff (26회 재시작) | Running, 재시작 0회 ✅ |
| otel-collector-front | Running (7회 재시작 후 안정) | Running, 안정 ✅ |
| argocd-server | CrashLoopBackOff (22+회 재시작) | 1/1 Running, 재시작 0회 ✅ |
| argocd-application-controller | Running (영향 없음) | Running ✅ |
| argocd-redis-secret-init | CrashLoopBackOff (i/o timeout) | 정상 완료 ✅ |

### 변경된 설정

| 설정 | Before | After |
|------|--------|-------|
| Loki ingestion_rate_mb | 4 (기본값) | **16** |
| Loki ingestion_burst_size_mb | 6 (기본값) | **32** |
| Loki per_stream_rate_limit | 3MB | **5MB** |
| argocd-server NetworkPolicy | Ingress only | **Ingress + Egress** |
| argocd-server resources | `{}` (BestEffort) | **100m/256Mi ~ 500m/512Mi** |
| holdApplicationUntilProxyStarts | prod만 | **dev + prod** |

---

## 📚 종합 정리

| 문제 | 근본 원인 | 해결 | 예방 |
|------|-----------|------|------|
| OTel Collector CrashLoop | Loki rate limit 4MB/sec 초과 | ingestion_rate_mb: 16 | 파이프라인 전환 시 백엔드 rate limit 재검토 |
| ArgoCD Server CrashLoop | NetworkPolicy egress 누락 | server egress 규칙 추가 | 새 컴포넌트 추가 시 K8s API 접근 여부 확인 |

### NetworkPolicy 체크리스트

default-deny-all을 사용하는 namespace에 새 컴포넌트를 추가할 때 확인해야 할 것들입니다:

- [ ] 이 Pod가 K8s API server에 접근하는가? (informer, leader election, webhook)
- [ ] 이 Pod가 외부 서비스에 접근하는가? (GitHub, ECR, S3 등)
- [ ] 이 Pod가 다른 namespace의 서비스에 접근하는가?
- [ ] 기존 egress 규칙이 "우연히" 다른 트래픽도 허용하고 있지 않은가?
- [ ] SSA 환경에서 policyTypes 변경이 제대로 반영되었는가?

---

## 🤔 스스로에게 던지는 질문

1. **Loki rate limit을 16MB로 올렸는데, 적절한 수치인가?** — 현재 dev 환경 기준으로 충분하지만, prod에서는 로그 볼륨이 다를 수 있습니다. `loki_distributor_bytes_received_total` 메트릭을 대시보드에 추가해서 지속적으로 모니터링해야 합니다.

2. **NetworkPolicy를 처음부터 deny-all로 시작하는 것이 맞는가?** — 보안 관점에서는 맞습니다. 하지만 "기본적으로 필요한 egress"를 빠뜨리기 쉽습니다. deny-all을 사용할 때는 각 컴포넌트의 네트워크 요구사항을 반드시 문서화해야 합니다.

3. **가설 5개를 검증하는 데 4시간이 걸렸는데, 더 빨리 찾을 수 있었는가?** — `argocd-redis-secret-init`의 i/o timeout 로그를 더 일찍 확인했다면 30분 안에 해결할 수 있었을 겁니다. **문제가 발생한 Pod뿐만 아니라, 같은 namespace의 다른 Pod 로그도 확인**하는 습관이 중요합니다.

4. **repo-server가 "우연히" 동작한 것을 발견하지 못했다면?** — GitHub 전용 egress를 IP 기반으로 제한하거나, 포트를 분리하면 이런 우연한 허용을 방지할 수 있습니다. 하지만 GitHub의 IP 범위는 자주 변경되기 때문에 실용적이지 않을 수 있습니다. 의도적인 허용과 우연한 허용의 차이를 주석으로 명확히 문서화하는 것이 현실적입니다.

---

## 🔗 참고

- [Kubernetes NetworkPolicy](https://kubernetes.io/docs/concepts/services-networking/network-policies/)
- [Loki Rate Limiting](https://grafana.com/docs/loki/latest/configure/#limits_config)
- [ArgoCD Issue #10391 — Istio sidecar race condition](https://github.com/argoproj/argo-cd/issues/10391)
- [OTel Collector Kafka Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/kafkareceiver)
