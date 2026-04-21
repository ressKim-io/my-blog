# ADR 0011: Prometheus Agent Mode 전환

- **Status**: Proposed
- **Date**: 2026-04-13
- **Deciders**: ressKim
- **Related**: ADR 0004 (Observability Stack Selection), ADR 0007 (Alloy→OTel Collector), ADR 0008 (Loki/Tempo Stability Tuning)

## Context

2026-04-13 Go cutover 후 노드 rightsizing (12→8대) 과정에서 `kube-prometheus-stack` Prometheus pod가 `ip-10-1-0-10` 노드의 메모리를 98%까지 점유하는 이슈 발생. 직접 원인은 stateful pod 분산 실패지만, 근본적으로 Prometheus 자체가 4Gi 제한을 거의 다 쓰는 (실측 3981Mi) 구조적 문제가 드러남.

### 현재 구조

```
App/Istio → Prometheus (scrape + 로컬 TSDB 2h + remote_write) → Mimir (장기 저장)
Grafana → Mimir-query-frontend (datasource: mimirDistributorService)
```

### 발견된 문제

1. **이중 저장**: Prometheus 로컬 TSDB(2h)와 Mimir(장기)가 같은 데이터를 중복 저장
2. **Grafana는 이미 Mimir만 쿼리**: `charts/goti-monitoring/values-prod.yaml`의 `prometheusService: mimir-prod-query-frontend...`로 세팅됨. Prometheus 로컬 TSDB는 **사실상 사용 안 함**
3. **메모리 압박 원인**: `kube-prometheus-stack-values.yaml` L24-26 주석에 명시됨
   - WAL replay (71 seg) 피크
   - TSDB compaction 피크
   - 100K~300K active series (Istio envoy + kubelet + app metrics)
4. **과거 대응**: memory limit 2Gi → 4Gi로 **우회**. 근본 해결 아님. 다음 피크에서 다시 OOM 가능

## Decision

**Prometheus를 Agent mode로 전환**한다.

Agent mode는 `prometheus --enable-feature=agent` 로 동작하며:
- **로컬 TSDB 없음** → WAL replay 부담 최소화, compaction 제거
- **쿼리 API 비활성화** (이미 사용 안 하므로 무관)
- **remote_write only** → Mimir로 즉시 전송
- 메모리 예상 **4Gi → 1~1.5Gi** (공식 벤치마크 기준 약 1/3)

### 구현 방법

`values-stacks/prod/kube-prometheus-stack-values.yaml`:
```yaml
prometheus:
  prometheusSpec:
    # Agent mode: 로컬 TSDB 제거, remote_write only. Mimir가 쿼리/저장 담당
    enableFeatures:
      - agent
    retention: ""          # Agent mode에서는 무의미
    # storageSpec: 제거 (PVC 불필요)
    resources:
      requests: {cpu: 100m, memory: 512Mi}
      limits:   {cpu: 500m, memory: 1Gi}
```

주의: `kube-prometheus-stack` Helm chart는 operator 기반이라 `Prometheus` CRD의 `spec.mode: agent` 필드를 써야 할 수도 있음. 차트 버전별 검증 필요.

## Alternatives Considered

### A. 현재 구조 유지 + label drop만 (보완)

Istio envoy metric의 고카디널리티 라벨 (`destination_canonical_revision`, `source_cluster` 등) drop → active series 30~50% 감소 → 메모리 ~30% 감소.

- **장점**: 변경 범위 작음
- **단점**: 근본 원인(이중 저장) 미해결, 대시보드 panel 일부 깨질 수 있음, 효과 제한적 (메모리 4Gi → 2.8Gi 정도)

### B. Prometheus 제거, OTel Collector로 대체

- **장점**: 스택 단순화
- **단점**: ADR 0007에서 OTel Collector 채택했지만 Prometheus scrape 역할은 kube-prometheus-stack이 유지하는 쪽으로 결정된 이력. 재검토 비용 크고 kube-state-metrics/node-exporter/prometheus-operator 생태계 의존성 재구축 부담

### C. Horizontal sharding (Prometheus 2+ replicas with hashmod)

- **장점**: scale-out 여지
- **단점**: 100K-300K series 규모에선 과잉 설계. Mimir가 이미 scale-out 저장소 역할 수행 중 → 중복.

### D. 선택: Agent mode (본 ADR)

- **장점**: 공식 기능, 단일 파라미터로 전환, 리소스 대폭 절감, 이미 Mimir가 쿼리 타겟이라 영향 최소
- **단점**: Prometheus UI/쿼리 직접 접근 불가 (어차피 안 쓰고 있음), Mimir 의존도 증가 (이미 Prod critical path이므로 기존 리스크와 동일)

## Consequences

### Positive

- Prometheus 메모리 **~70% 절감** (4Gi → ~1.2Gi 예상)
- OOM 재발 가능성 제거 (TSDB compaction 피크 소멸)
- 노드 rightsizing 여유 확보 → spot 5→4 재축소 검토 가능
- 아키텍처 단순화 (이중 저장 제거)

### Negative

- **Prometheus 로컬 TSDB 손실**: 전환 시 2h 분량 메트릭 블랙아웃 가능 (Mimir에는 remote_write로 계속 들어가므로 실제 관찰 영향 없음, 순간 gap 정도)
- **Prometheus UI 쿼리 불가**: `/graph` 직접 사용 중인 팀원 있으면 영향. Grafana → Mimir 경로로 전환 교육 필요
- **Mimir 의존도 증가**: Mimir 장애 시 쿼리 전체 중단 (단, 현재도 Grafana는 Mimir만 바라보므로 실질적 차이 없음)
- **Agent mode 특정 feature 미지원**: alertmanager rule evaluation은 Mimir ruler가 맡아야 함 (이미 mimir ruler 있는지 확인 필요)

### Neutral

- scrape config, ServiceMonitor, PodMonitor 등 기존 설정 그대로 사용 가능
- kube-prometheus-stack chart 계속 사용 (mode만 전환)

## Implementation Plan

1. **사전 검증** (별건 작업)
   - Grafana 대시보드 전수 조사: `datasource: Prometheus` 쓰는 panel 유무
   - Mimir ruler가 alertmanager rule을 eval 중인지 확인 (아니면 ruler 활성화 선행)
   - dev 환경에서 Agent mode 전환 테스트
2. **Prod 적용**
   - `values-stacks/prod/kube-prometheus-stack-values.yaml` 수정
   - ArgoCD sync
   - Prometheus statefulset 재배포 (PVC detach)
3. **검증**
   - Mimir 쿼리 정상 (대시보드 전수 체크)
   - Prometheus pod memory 1.5Gi 이하
   - remote_write 지연/드랍 없음 (Mimir ingester 메트릭 확인)
4. **후속**
   - Mimir ingester replicas/resources 재조정 (입력 부하 증가 대비)
   - 노드 재축소 여지 측정

## Validation Criteria

- Prometheus pod memory 정상 상태 `< 1.5Gi`
- 전 Grafana 대시보드 panel `No data` 없음
- Mimir remote_write error rate `< 0.1%`
- Alert 정상 발화 (기존 테스트 alert 재검증)
