---
date: 2026-03-30
category: troubleshoot
project: Goti-k8s, Goti-monitoring
tags: [argocd, otel-collector, crashloopbackoff, networkpolicy, loki, kafka, rate-limit, istio-sidecar]
---

# ArgoCD server + OTel Collector Back CrashLoopBackOff — NetworkPolicy egress 누락 + Loki rate limit 초과

## Context

Alloy→OTel Collector 마이그레이션 4단계 PR을 모두 머지한 직후 (2026-03-30), 두 개의 CrashLoopBackOff가 동시에 발생.

- **환경**: Kind dev 클러스터 (7노드: CP3 + Worker4), Istio mesh, ArgoCD v3.3.2 (Helm chart 9.4.6)
- **직전 작업**: Alloy 영구 제거 (Goti-k8s #155), OTel Collector Front/Back 배포 (#152), OTLP endpoint 전환 (#154)
- **모니터링 스택**: kube-prometheus-stack + Mimir 분산 + Loki SingleBinary + Tempo + OTel Collector Front/Back

## Issue

### 문제 1: otel-collector-back CrashLoopBackOff (26회 재시작)

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

- OTel Collector Back이 Kafka에서 로그를 소비하여 Loki로 전송 시 **HTTP 429** 반복
- Loki 기본 ingestion rate limit: **4MB/sec** — 배치당 ~1200 lines / ~2MB씩 전송하나 retry 증폭으로 limit 초과
- retry → 메모리 누적 → crash → 재시작 → Kafka에서 다시 소비 → 반복

### 문제 2: argocd-server CrashLoopBackOff (22+회 재시작)

```
time="2026-03-30T14:24:19Z" level=info msg="ArgoCD API Server is starting" version=v3.3.2
time="2026-03-30T14:24:19Z" level=info msg="Loading Redis credentials from environment variables"
time="2026-03-30T14:24:19Z" level=info msg="Loading Redis credentials from environment variables"
time="2026-03-30T14:24:19Z" level=info msg="Starting configmap/secret informers"
(여기서 로그 끊김 — 30초 후 liveness probe 실패로 kill)
```

- `Starting configmap/secret informers`에서 hang → port 8080 bind 안 됨
- Liveness probe (`/healthz?full=true`, initialDelaySeconds: 10, failureThreshold: 3) 실패
- exitCode: 143 (SIGTERM from kubelet)
- application-controller, repo-server는 정상 Running

`argocd-redis-secret-init` Job pod에서 결정적 단서 발견:
```
{"level":"fatal","msg":"Post \"https://10.96.0.1:443/api/v1/namespaces/argocd/secrets\":
  dial tcp 10.96.0.1:443: i/o timeout","time":"2026-03-30T15:38:51Z"}
```

**K8s API server(10.96.0.1:443)에 연결 자체가 차단**되고 있었음.

## Action

### 문제 1 진단: otel-collector-back

1. **최초 확인**: Pod 로그에서 Loki HTTP 429 확인
2. **Kafka consumer group describe**: LAG = 0 (밀린 데이터 없음) → 현재 처리량 자체가 rate limit 초과
3. **Loki values 확인**: `ingestion_rate_mb` 미설정 → 기본값 4MB/sec 사용 중

**Root Cause**: Loki 기본 ingestion rate limit (4MB/sec)이 OTel Collector의 Kafka→Loki 전송량에 부족. Alloy 시절에는 Alloy가 직접 Loki OTLP로 전송하며 자체 rate control이 있었으나, OTel Collector는 Kafka batch를 더 공격적으로 전송.

**수정**:
- `Goti-monitoring/values-stacks/dev/loki-values.yaml`:
  - `ingestion_rate_mb: 16` 추가 (기본 4 → 16)
  - `ingestion_burst_size_mb: 32` 추가 (기본 6 → 32)
  - `per_stream_rate_limit: 5MB` (기존 3MB)
  - `per_stream_rate_limit_burst: 15MB` (기존 10MB)

### 문제 2 진단: argocd-server (5단계 가설 검증)

1. **가설 1 — OTel Collector 불안정 영향**
   - 근거: collector-back CrashLoop이 전체 모니터링 불안정 유발
   - 검증: collector-back 해결 후에도 argocd-server 동일 증상 지속
   - 결과: **기각**

2. **가설 2 — OTLP tracing gRPC blocking**
   - 근거: ArgoCD values에 `otlp.address: otel-collector-front-dev-...:4317` 설정. gRPC 연결이 startup blocking?
   - 검증: ArgoCD 소스 코드 분석 (`cmd/argocd-server/commands/argocd_server.go:275-280`)
     ```
     NewServer() → ensureSynced() → WaitForCacheSync()  ← 여기서 hang
     Init() → Listen() → InitTracer()  ← OTLP는 여기서 초기화 (도달 못 함)
     ```
   - 결과: **기각** (OTLP 초기화는 informer sync 이후에 발생, 도달하지 못함)
   - 조치: 확인 차원에서 OTLP 일시 비활성화 (원인 아님이 확인됨, TODO: 재활성화)

3. **가설 3 — Istio sidecar race condition (argoproj/argo-cd#10391)**
   - 근거: Istio sidecar가 ready 전에 앱 컨테이너 시작 → K8s API 호출 차단
   - 검증: `holdApplicationUntilProxyStarts: true` annotation 추가 → 효과 없음
   - 추가 확인: prod에만 `holdApplicationUntilProxyStarts` 있고 dev에는 없었음
   - 결과: **부분 기각** (기여 요인일 수 있으나 근본 원인 아님)

4. **가설 4 — 리소스 부족 (BestEffort QoS)**
   - 근거: `resources: {}` → BestEffort, CPU throttling 가능
   - 검증: `kubectl top nodes` — 전체 노드 메모리 최대 19%, 여유로움
   - 조치: resources 추가 (requests: 100m/256Mi, limits: 500m/512Mi)
   - 결과: **기여 요인이나 근본 원인 아님** (resources 추가 후에도 동일 증상)

5. **가설 5 — NetworkPolicy egress 차단** (결정적 단서)
   - 근거: `argocd-redis-secret-init` pod 로그에서 `dial tcp 10.96.0.1:443: i/o timeout` 발견
   - 검증:
     ```
     kubectl get networkpolicy -n argocd
     → default-deny-all: 전체 ingress/egress 차단
     → allow-controller-k8s-api: application-controller만 443/6443 egress 허용
     → allow-argocd-server: Ingress(8080)만, Egress 없음!
     ```
   - 결과: **근본 원인 확정**

**Root Cause**: `argocd-netpol.yaml`의 `default-deny-all`이 전체 namespace egress를 차단하는데, K8s API(443/6443) egress를 `application-controller`에만 열어두고 **`argocd-server`에는 누락**. server의 informer가 K8s API에 LIST/WATCH 요청을 보내지 못해 `WaitForCacheSync()`에서 무한 대기.

application-controller는 egress가 있어서 정상 동작했고, repo-server는 GitHub egress(443)가 K8s API와 포트가 같아서 우연히 동작.

**수정**:
- `Goti-k8s/infrastructure/dev/network-policies/argocd-netpol.yaml`:
  - `allow-argocd-server`에 `Egress` policyType 추가
  - K8s API egress rule 추가 (443/6443, 0.0.0.0/0 except IMDS)

### 추가 이슈: ServerSideApply policyTypes merge 실패

NetworkPolicy 소스에 `policyTypes: [Ingress, Egress]`를 추가했으나, ArgoCD ServerSideApply로 sync 시 `policyTypes`에 `Egress`가 반영되지 않는 현상 발생.

- 원인: SSA merge 시 기존 `policyTypes: [Ingress]`와 새 `[Ingress, Egress]`가 제대로 merge되지 않음
- 해결: `kubectl annotate application network-policies -n argocd argocd.argoproj.io/refresh=hard --overwrite`로 강제 re-sync
- 교훈: SSA에서 array 필드 변경 시 자동 sync만으로 부족할 수 있음. 특히 policyTypes 같은 핵심 필드.

## Result

### 검증 결과

| 컴포넌트 | Before | After |
|----------|--------|-------|
| otel-collector-back | CrashLoopBackOff (26회) | Running, 재시작 0회 (24분+ 안정) |
| otel-collector-front | Running (7회 재시작 후 안정) | Running, 안정 |
| argocd-server | CrashLoopBackOff (22+회) | **1/1 Running, 재시작 0회** |
| argocd-application-controller | Running (영향 없음) | Running |
| argocd-redis-secret-init | CrashLoopBackOff | 정상 완료 (Job 소멸) |

### 부수 변경 사항 (같은 세션에서 진행)

| 변경 | 레포 | 상태 |
|------|------|------|
| Prometheus 재활성화 + remoteWrite → Mimir | Goti-monitoring | push 완료 |
| 대시보드/알림 Alloy→OTel Collector 전환 | Goti-monitoring | push 완료 |
| alloy-values.yaml (dev) 삭제 | Goti-monitoring | push 완료 |
| ArgoCD server resources 추가 | Goti-k8s | push 완료 |
| ArgoCD OTLP tracing 일시 비활성화 | Goti-k8s | push 완료, TODO: 재활성화 |
| holdApplicationUntilProxyStarts 추가 | Goti-k8s | push 완료 (방어적 조치) |
| ADR-0007 Accepted + Mimir 취소 반영 | goti-team-controller | 커밋 완료 |
| Migration-0003 상태 업데이트 | goti-team-controller | 커밋 완료 |

### 재발 방지책

1. **NetworkPolicy 체크리스트 추가**: 새 컴포넌트가 K8s API 접근이 필요한 경우 반드시 egress rule 확인
2. **NetworkPolicy 리뷰 시 질문**: "이 Pod가 K8s API를 호출하는가?" — informer, leader election, webhook 등
3. **Loki rate limit 모니터링**: `loki_distributor_bytes_received_total` rate를 대시보드에 추가하여 limit 근접 시 사전 감지
4. **ArgoCD SSA 주의**: policyTypes 같은 array 필드 변경 시 sync 후 실제 리소스 확인 필요
5. **dev 환경에도 holdApplicationUntilProxyStarts 적용**: Istio mesh 내 모든 서비스에 방어적 적용 검토

### TODO

- [ ] ArgoCD OTLP tracing 재활성화 (NetworkPolicy 수정 후 정상 동작 예상)
- [ ] dev Istio meshConfig에 글로벌 `holdApplicationUntilProxyStarts: true` 추가 검토
- [ ] Loki ingestion rate 대시보드 패널 추가

## Related Files

**Goti-monitoring** (main direct push):
- `values-stacks/dev/loki-values.yaml` — ingestion_rate_mb 16으로 증가
- `values-stacks/dev/kube-prometheus-stack-values.yaml` — Prometheus 재활성화 + remoteWrite
- `grafana/dashboards/devops/infra-otel-pipeline.json` — Alloy→OTel Collector 전환
- `grafana/dashboards/devops/monitoring-stack-health.json` — Alloy→OTel Collector 전환
- `prometheus/rules/infra.yml` — AlloyExporterFailed→OTelCollectorExporterFailed
- `charts/goti-monitoring/templates/prometheusrule-infra.yaml` — 동일
- `values-stacks/dev/alloy-values.yaml` — 삭제

**Goti-k8s** (main direct push):
- `infrastructure/dev/network-policies/argocd-netpol.yaml` — **핵심 수정: server egress 추가**
- `infrastructure/dev/argocd/values-dev.yaml` — resources + holdApplicationUntilProxyStarts + OTLP 비활성화

**goti-team-controller**:
- `docs/adr/0007-alloy-to-otel-collector.md` — Accepted, Mimir SingleBinary 취소
- `docs/migration/0003-monitoring-stack-migration.md` — Phase 상태 업데이트
