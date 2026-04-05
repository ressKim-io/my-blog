# ADR-0009: FinOps 도구 선택 — OpenCost 기반 비용 모니터링 도입

- **Status**: Accepted
- **Date**: 2026-04-02
- **Decision Makers**: ress

## Context

Multi-Cloud(AWS EKS + GCP GKE) 환경 전환 중이며, 인프라 비용 가시성이 부재한 상태. CloudWatch billing alarm($100)만 존재하고, Grafana FinOps 대시보드는 데이터 소스가 연결되지 않아 모든 쿼리가 `vector(0)` 반환.

### 요구사항

| 요구사항 | 우선순위 |
|----------|----------|
| K8s 워크로드(namespace/pod)별 비용 추적 | P0 |
| 기존 Prometheus/Grafana/Alertmanager 스택 연동 | P0 |
| Multi-Cloud(EKS + GKE) 동일 도구 | P0 |
| 비용 이상 탐지 및 Discord 알림 | P1 |
| 예산 예측 (predict_linear) | P1 |
| 추가 비용 최소화 | P1 |

## Options

### Option A: OpenCost (CNCF Incubating)

- **비용**: 무료 (Pod 리소스 ~$2-4/월만)
- **장점**: CNCF 표준, Prometheus exporter 네이티브, 벤더 중립, MCP Server 내장 (2026)
- **단점**: RI/Spot 할인 미반영 (Phase 3에서 CUR/BigQuery로 보완), 자체 알림 기능 없음 (Alertmanager 활용)

### Option B: Kubecost v3 (IBM)

- **비용**: 무료 티어 $100K 지출 한도 (EKS 번들은 면제), Enterprise $449+/월
- **장점**: RI/Spot 할인 반영, 멀티클러스터 UI, 내장 알림, AWS/GCP 완전 통합
- **단점**: IBM 인수 후 가격 상승, GKE에서 $100K 한도 적용, 벤더 종속성

### Option C: Cloud Native Only (AWS Cost Explorer + GCP FinOps Hub)

- **비용**: 무료
- **장점**: 설정 간단, 클라우드별 최적화
- **단점**: K8s namespace/pod 수준 분해 불가, 통합 뷰 없음, Prometheus 비연동

## Decision

**Option A: OpenCost** 선택.

### 근거

1. **기존 스택 100% 재활용**: Prometheus ServiceMonitor → Mimir → Grafana → Alertmanager → Discord. 새 인프라 없음
2. **Multi-Cloud 동일 도구**: EKS/GKE 모두 동일 Helm chart, 동일 메트릭 이름으로 통합 가능
3. **비용 $2-4/월**: Kubecost Enterprise($449+/월) 대비 100배 이상 저렴
4. **CNCF Incubating**: 벤더 중립, 커뮤니티 활발 (2025년 11회 릴리스)
5. **MCP Server**: Claude Code에서 자연어 비용 조회 가능 (2026 신규)
6. **RI/Spot 미반영 보완**: Phase 3에서 AWS CUR + GCP BigQuery billing export로 보완 예정

## Implementation

### Phase 1: OpenCost 배포 + 대시보드
- monitoring-appset.yaml에 OpenCost 컴포넌트 추가
- opencost-values.yaml 생성 (Mimir query-frontend 연결)
- Terraform IRSA (AWS Pricing API)
- infra-finops.json → OpenCost 메트릭 연결

### Phase 2: 알림 체계
- Recording rules: namespace:cost_hourly:sum, cluster:cost_monthly:sum, CPU/Memory 효율성
- Alert rules: 예산 초과, 비용 급등, 유휴 리소스, 예산 예측
- Discord #goti-finops 채널 연동

### Phase 3: Cloud-native 보완
- AWS Budget → SNS → Lambda → Discord
- GCP Budget → Pub/Sub → Cloud Function → Discord
- AWS Cost Anomaly Detection + Infracost CI

### Phase 4: Multi-Cloud 통합
- GKE OpenCost + FOCUS 포맷 통합 대시보드

## Consequences

### Positive
- K8s 워크로드별 비용 추적 가능 (namespace/pod 수준)
- 기존 모니터링 파이프라인 완전 재활용 → 운영 복잡도 증가 없음
- predict_linear 기반 사전 예산 알림으로 비용 급증 방지
- 경기별 Showback 가능 (삼성=AWS, 두산=GCP)

### Negative
- OpenCost 단독으로는 RI/Spot 할인 반영 불가 → Phase 3 필수
- 전월 대비 비용 비교는 CUR/BigQuery 연동 전까지 불가
- OpenCost Pod 장애 시 비용 메트릭 공백 → recording rule에 `or vector(0)` 패턴 적용

## Related
- [ADR-0007: Alloy→OTel Collector 전환](0007-alloy-to-otel-collector.md) — 동일 모니터링 스택 확장
- [CloudWatch 비용 최적화](../finops/2026-03-31-cloudwatch-cost-optimization.md) — Phase 0 완료
