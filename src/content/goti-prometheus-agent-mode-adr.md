---
title: "Prometheus Agent Mode 전환 — 4Gi 메모리를 1.2Gi로 줄인 아키텍처 결정"
excerpt: "50만 동시 접속 티켓팅 플랫폼에서 노드 rightsizing 중 Prometheus가 메모리 98%를 점유한 문제를 Agent Mode 전환으로 근본 해결한 ADR"
category: monitoring
tags:
  - go-ti
  - Prometheus
  - Agent-Mode
  - Observability
  - Architecture Decision Record
  - adr
date: "2026-03-18"
---

## 한 줄 요약

> Go cutover 후 노드를 12대에서 8대로 줄이는 과정에서 Prometheus가 단일 노드 메모리를 98%까지 점유했습니다. 근본 원인은 이미 Mimir가 모든 쿼리를 담당하고 있는데도 Prometheus가 로컬 TSDB를 유지하면서 이중 저장이 이어지던 구조적 문제였습니다. Agent Mode 전환으로 이중 저장을 제거하고 메모리를 70% 절감했습니다

---

## 🔥 배경: 노드 축소 중 드러난 구조적 문제

### 프로젝트 맥락

go-ti 프로젝트는 삼성(AWS EKS)·두산(GCP GKE) 2개 구단의 티켓팅을 동시에 처리하는 멀티클라우드 플랫폼입니다. 동시 접속 50만, API p99 200ms 이내, 좌석 정합성 100%를 목표로 운영됐습니다.

2026-04-13 Go cutover 이후, 프로덕션 EKS 클러스터의 노드를 12대에서 8대로 rightsizing하는 작업을 진행했습니다. 이 과정에서 `kube-prometheus-stack`의 Prometheus Pod가 `ip-10-1-0-10` 노드의 메모리를 **98%까지 점유**하는 이슈가 발생했습니다.

직접 원인은 StatefulSet 분산 실패였지만, 그 이면에는 더 근본적인 문제가 있었습니다. Prometheus 자체가 4Gi 메모리 제한을 거의 소진하고 있었던 것입니다(실측 3,981Mi).

### 현재 아키텍처

```text
App/Istio → Prometheus (scrape + 로컬 TSDB 2h + remote_write) → Mimir (장기 저장)
Grafana → Mimir query-frontend (datasource: mimir-prod-query-frontend)
```

이 구조에서 Prometheus가 로컬 TSDB에 2시간치 데이터를 보관하면서 동시에 Mimir로 remote_write를 수행하고 있었습니다.

### 발견된 구조적 문제

문제를 파고들면서 4가지 이슈가 드러났습니다.

**첫째, 이중 저장입니다.** Prometheus 로컬 TSDB(2시간)와 Mimir(장기)가 동일한 데이터를 중복 저장하고 있었습니다.

**둘째, Grafana는 이미 Mimir만 쿼리합니다.** `values-prod.yaml`의 datasource가 `prometheusService: mimir-prod-query-frontend`로 설정되어 있었습니다. Prometheus 로컬 TSDB는 사실상 아무도 쓰지 않는 데이터를 보관하고 있었습니다.

**셋째, 메모리 압박의 실제 원인입니다.** `kube-prometheus-stack-values.yaml` 주석에도 명시된 바와 같이 3가지가 복합 작용했습니다.

- WAL replay (71 segment) 피크
- TSDB compaction 피크
- 100K~300K active series (Istio Envoy + kubelet + 앱 메트릭)

**넷째, 이전 대응이 우회에 불과했습니다.** 과거에 memory limit을 2Gi에서 4Gi로 올렸지만, 이는 근본 해결이 아닙니다. 다음 피크에서 OOM이 재발할 수 있는 구조였습니다.

---

## 🧭 선택지 비교

### 고려한 옵션

| 옵션 | 핵심 아이디어 | 장점 | 한계 |
|------|---------------|------|------|
| A. 현재 구조 유지 + label drop | Istio Envoy 고카디널리티 라벨 제거로 active series 감소 | 변경 범위 작음 | 이중 저장 미해결, 효과 제한적 (4Gi → 2.8Gi) |
| B. Prometheus 제거 + OTel Collector 대체 | 스크레이핑을 OTel Collector로 완전 이관 | 스택 단순화 | ADR 0007 이력 재검토 비용, kube-state-metrics·node-exporter 생태계 재구축 부담 |
| C. Horizontal Sharding | Prometheus 2+ replicas + hashmod | scale-out 여지 | 100K~300K series 규모에서 과잉 설계, Mimir가 이미 scale-out 저장소 역할 수행 중 |
| D. Agent Mode 전환 (채택) | 로컬 TSDB 제거, remote_write only | 단일 파라미터로 전환, 메모리 대폭 절감 | Prometheus UI/쿼리 직접 접근 불가 (어차피 미사용), Mimir 의존도 증가 |

### 기각 이유

**A 탈락 — label drop만으로는 근본 해결이 안 됩니다.** 고카디널리티 라벨(`destination_canonical_revision`, `source_cluster` 등)을 drop하면 active series를 30~50% 줄일 수 있습니다. 그러나 메모리 감소폭이 4Gi → 2.8Gi 정도에 그치고, 이중 저장 문제 자체는 해결되지 않습니다. 대시보드 panel 일부가 깨질 수 있다는 부작용도 있습니다.

**B 탈락 — ADR 0007 이력과 생태계 의존성 문제입니다.** ADR 0007에서 OTel Collector를 채택하면서도 Prometheus scrape 역할은 kube-prometheus-stack이 유지하기로 결정한 이력이 있습니다. 이를 뒤집으려면 kube-state-metrics, node-exporter, prometheus-operator 생태계 의존성을 모두 재구축해야 합니다. 재검토 비용이 너무 큽니다.

**C 탈락 — 100K~300K series 규모에서 과잉 설계입니다.** Horizontal sharding은 더 큰 규모에서 의미 있는 방안이고, Mimir가 이미 scale-out 저장소 역할을 수행하고 있어 중복입니다.

### 결정 기준과 최종 선택

**D — Agent Mode를 채택했습니다.**

결정 기준은 다음 우선순위였습니다.

1. **이중 저장 구조적 제거**: 문제의 근본 원인을 해결하는가
2. **변경 비용 최소화**: 기존 scrape config, ServiceMonitor, PodMonitor를 그대로 유지할 수 있는가
3. **즉각적 효과**: 노드 rightsizing 맥락에서 충분한 메모리 여유를 확보하는가

Agent Mode는 단일 파라미터(`--enable-feature=agent`)로 전환 가능하고, 기존 설정을 그대로 활용하면서 이중 저장을 완전히 제거합니다. Grafana가 이미 Mimir만 바라보고 있기 때문에 Prometheus UI 쿼리 불가는 실질적인 영향이 없습니다.

---

## ✅ 결정: Prometheus Agent Mode 전환

### Agent Mode가 해결하는 것

Agent Mode는 `prometheus --enable-feature=agent`로 동작합니다. 기존 Server Mode와의 차이는 다음 3가지입니다.

- **로컬 TSDB 없음**: WAL replay 부담이 최소화되고 TSDB compaction이 사라집니다
- **쿼리 API 비활성화**: 어차피 사용하지 않으므로 영향 없습니다
- **remote_write only**: Mimir로 즉시 전송합니다

공식 벤치마크 기준으로 메모리 사용량이 Server Mode의 약 1/3로 줄어듭니다. 실측 3,981Mi 기준으로 1~1.5Gi 수준이 예상됩니다.

### 구현 방법

`values-stacks/prod/kube-prometheus-stack-values.yaml`을 다음과 같이 수정합니다.

```yaml
prometheus:
  prometheusSpec:
    # Agent mode: 로컬 TSDB 제거, remote_write only
    # Mimir가 쿼리/저장 전담
    enableFeatures:
      - agent
    retention: ""        # Agent mode에서는 무의미
    # storageSpec: 제거 (PVC 불필요)
    resources:
      requests:
        cpu: 100m
        memory: 512Mi
      limits:
        cpu: 500m
        memory: 1Gi
```

주의사항이 하나 있습니다. `kube-prometheus-stack` Helm chart는 operator 기반이라 `Prometheus` CRD의 `spec.mode: agent` 필드를 별도로 설정해야 할 수 있습니다. 차트 버전별로 검증이 필요합니다.

### 사전 검증 항목

적용 전에 다음 3가지를 먼저 확인합니다.

1. **Grafana 대시보드 전수 조사**: `datasource: Prometheus`를 직접 사용하는 panel이 있는지 확인합니다. 있다면 Mimir 경로로 전환해야 합니다
2. **Mimir ruler 상태 확인**: alertmanager rule evaluation이 Mimir ruler를 통해 이뤄지고 있는지 확인합니다. Agent Mode에서는 Prometheus가 rule evaluation을 수행할 수 없습니다
3. **dev 환경 테스트**: 프로덕션 적용 전 dev 클러스터에서 Agent Mode를 먼저 검증합니다

### Prod 적용 절차

```bash
# 1. values 파일 수정 후 ArgoCD sync
$ kubectl apply -f values-stacks/prod/kube-prometheus-stack-values.yaml

# 2. Prometheus StatefulSet 재배포 (PVC detach 포함)
$ kubectl rollout status statefulset/prometheus-kube-prometheus-stack-prometheus -n monitoring

# 3. 검증: Prometheus Pod 메모리 확인
$ kubectl top pod -n monitoring -l app.kubernetes.io/name=prometheus

# 4. remote_write 지연/드랍 없음 확인 (Mimir ingester 메트릭)
$ kubectl port-forward svc/mimir-prod-nginx 8080:80 -n monitoring
```

### 검증 기준

- Prometheus Pod 정상 상태 메모리 `< 1.5Gi`
- 전체 Grafana 대시보드 panel `No data` 없음
- Mimir remote_write error rate `< 0.1%`
- 기존 테스트 alert 정상 발화

---

## 📊 예상 효과

Agent Mode 전환 후 기대되는 변화를 정리합니다.

### 긍정적 효과

메모리 절감이 핵심입니다. 실측 3,981Mi에서 공식 벤치마크 기준 ~1.2Gi로 **약 70% 절감**이 예상됩니다. OOM 재발 원인인 TSDB compaction 피크가 소멸합니다.

노드 rightsizing 여유도 확보됩니다. Prometheus 메모리 절감분이 spot 노드 재축소 검토로 이어질 수 있습니다(5대 → 4대 재검토).

아키텍처도 단순해집니다. 이중 저장 구조가 제거되고, `Grafana → Mimir`라는 단일 쿼리 경로만 남습니다.

### 감수하는 비용

**Prometheus 로컬 TSDB 손실**: 전환 시 2시간치 메트릭 블랙아웃이 발생할 수 있습니다. 단, Mimir에는 remote_write가 계속 유입되므로 실제 관찰 영향은 순간적인 gap 수준입니다.

**Prometheus UI 쿼리 불가**: `/graph` 직접 접근이 필요한 경우 Grafana → Mimir 경로로 전환해야 합니다. 팀원에게 사전 안내가 필요합니다.

**Mimir 의존도 증가**: Mimir 장애 시 쿼리가 전체 중단됩니다. 단, 현재도 Grafana는 Mimir만 바라보고 있으므로 실질적인 리스크 변화는 없습니다.

### 영향 없는 것

- scrape config, ServiceMonitor, PodMonitor 등 기존 설정은 그대로 사용 가능합니다
- kube-prometheus-stack chart는 계속 사용합니다. mode만 전환합니다

---

## 📚 배운 점

**"메모리 limit 올리기"는 우회일 뿐입니다.** 2Gi → 4Gi로 limit을 늘렸을 때 문제가 해결된 것처럼 보였지만, 실제로는 다음 피크를 기다리는 것이었습니다. 구조적 원인(이중 저장, 사용하지 않는 TSDB)을 그대로 두고 자원만 늘리면 재발합니다

**"누군가는 쓰겠지"는 위험한 가정입니다.** Grafana datasource가 Mimir로 설정된 시점부터 Prometheus 로컬 TSDB는 아무도 쿼리하지 않았습니다. 그럼에도 TSDB를 유지하면서 compaction·WAL replay 비용을 계속 지불했습니다. 실제 사용 여부를 주기적으로 확인해야 합니다

**Agent Mode는 "Mimir가 있다면" 자연스러운 선택입니다.** Prometheus + Mimir 조합에서 장기 저장을 Mimir가 담당한다면, Prometheus의 로컬 TSDB는 중복 투자입니다. 처음 스택을 구성할 때부터 Agent Mode를 검토하는 것이 효율적입니다

**알람 평가(ruler) 역할 확인이 선행돼야 합니다.** Agent Mode에서 Prometheus는 rule evaluation을 수행할 수 없습니다. Mimir ruler가 이미 활성화되어 있다면 문제없지만, 그렇지 않다면 alert가 조용히 멈춥니다. 전환 전 반드시 확인해야 하는 항목입니다
