# 2026-04-15 — Pod 리소스 상향 vs Karpenter NodePool 분리 의사결정

> SDD-0004 Phase 1에서 ticketing CPU req/limit 을 100m/1core → 500m/3core (리뷰 후 1core/2core)로 상향하는 과정에서
> 사용자가 제기한 고민과 Claude의 응답을 기록.

## 배경

4차 부하(2026-04-14, 3000 VU) 결과:
- `ticket_success_rate` 7.8%
- ticketing pod CPU peak 117% of request (limit 1 core hit)
- p99 거의 전부 10s (k6 timeout 천장)

1차 대응으로 PR #257에서 CPU req/limit 상향. 이후 리뷰(CR-009)에서 ratio 1:6 → 1:2로 재조정.
이 시점에 사용자가 근본적 질문을 제기.

## 사용자 고민

1. "ticket pod 리소스만 무작정 늘리는 게 나을까, pod 늘려서 분산이 나을까?"
2. "노드별 리소스 한계가 있어서 조절이 필요하지 않나?"
3. "부하 시 CPU가 엄청 높으니, Karpenter로 ticketing 전용 CPU-heavy spot 노드 띄우면 어떨까?
   상대적으로 CPU가 더 높은 인스턴스(c-series) 받는 방식."

**핵심**: pod 수평/수직 스케일링 + 전용 노드풀 분리 필요성을 물음.

## Claude의 분석

### "Vertical vs Horizontal"은 잘못된 프레임

CPU 117%는 **증상**이지 근본 원인이 아님. SDD-0004에서 밝힌 실제 병목:
- FindPrice N+1 쿼리 (Phase 2에서 0 쿼리로 수정)
- pricing 인덱스 부족 (003 migration 추가)
- distLock WaitTimeout 1s (3s로 수정)
- context timeout 부재 (middleware 추가)
- stadium 동기 chain (5m cache)

이들이 AWS 재기동 후 반영되면 **CPU 사용량 자체가 크게 감소** 예상.
SDD-0005 Redis SoT까지 가면 RDS round-trip 제거로 추가 50~80% 감소 가능.

→ **pod 리소스/수는 baseline 역할일 뿐, 진짜 레버는 코드**.

### 그럼에도 비교하면

| 관점 | Vertical | Horizontal |
|---|---|---|
| Throttling 즉시 해소 | ✅ | ❌ (스케일 시간) |
| 장애 격리 | ❌ 1/8 | ✅ 1/24 |
| Go goroutine/conn 공유 | ✅ | ❌ pod별 독립 |
| **RDS conn 압박** | ✅ | ❌ **함정** |
| bin packing | ❌ | ✅ |

**RDS 함정**: `MaxConns=15 × 24 pod = 360 > RDS 300 한계`.
PgBouncer가 흡수하지만 pool_size × replicas 여유가 빠듯.

### Karpenter 전용 NodePool 아이디어 — 방향은 정확, 시점이 이르다

**인스턴스 단가 비교 (spot, ap-northeast-2)**:
| 타입 | vCPU | $/hr | vCPU당 $ |
|---|---|---|---|
| m6i.xlarge | 4 | $0.050 | $0.0125 |
| c7a.xlarge | 4 | $0.055 | $0.014 |
| c7i.xlarge | 4 | $0.065 | $0.016 |

c-series는 **vCPU당 20% 비쌈**. 그러나 JSON marshal/JWT verify/pgx encoding 같은 CPU bound 연산에서
clock/cache 우세 → **cost-per-req 기준은 c가 유리할 수도**. 실측 필요.

**주의점**:
1. 단일 instance-type 선점 시 spot 중단 blast radius 큼 → c7a/c7i/c6i mix + multi-AZ
2. Karpenter 노드 프로비저닝 60~90s + Istio sidecar 30s 지연 → overprovision 고려
3. cost-per-req metric (비용 / goti_ticket_success) 로만 진짜 비교 가능

## 결정 (A vs B)

**A. 지금 NodePool 분리 착수 (사용자 초기 아이디어)**
- 장점: 격리 즉시 확보, noisy neighbor 방지
- 단점: 코드 효과 측정 전이라 효과 예측 불가, 낭비 위험

**B. 측정 선행 + NodePool은 SDD 초안만** ✅ 채택
- 장점: Phase 1+2 효과를 독립 측정 가능, 데이터 기반 결정
- 단점: 실제 착수 시점 지연 (5차 부하 후로 밀림)

**채택 이유**:
- Phase 1+2 최적화가 매우 커서 (FindPrice N+1 제거, context timeout, stadium cache, pricing index)
  CPU 요구량 자체가 크게 변할 가능성
- 측정 없이 NodePool 분리하면 overprovision 크기 산정 근거가 없음
- SDD-0006 초안으로 설계는 준비해둬 측정 결과 나오면 즉시 착수 가능

## 후속 작업

1. **SDD-0006 초안 작성 완료** (`docs/dx/0006-ticketing-karpenter-nodepool-sdd.md`)
   - Karpenter NodePool 매니페스트 초안
   - c7a/c7i/c6i mix + multi-AZ 설계
   - Overprovision Deployment 옵션
   - 측정 지표 정의 (CFS throttling, CPU p95, cost-per-req)

2. **5차 부하 측정 후 의사결정 재개**:
   - throttling < 1%, CPU 사용량 < 70% → NodePool 불필요
   - throttling 여전 or CPU 사용량 > 80% → NodePool 착수

3. **SDD-0005 D7 완료 후 재측정**: Redis SoT 전환 후 CPU 요구량 재산정

## 교훈

- **"무엇을 고칠까" 전에 "실제 병목이 무엇인가"를 코드/쿼리 수준으로 먼저 확인**
- 리소스 상향은 증상 치료, 코드 최적화가 근본 치료
- 인프라 최적화(NodePool 등)는 데이터 없이 하면 낭비 리스크 큼
- 설계 문서는 미리 준비해두되 적용은 측정 후

## 관련 문서

- SDD-0004: `docs/dx/0004-ticketing-hotpath-root-cause-sdd.md`
- SDD-0005: `docs/dx/0005-redis-source-of-truth-sdd.md`
- SDD-0006: `docs/dx/0006-ticketing-karpenter-nodepool-sdd.md`
- PR #257: https://github.com/Team-Ikujo/Goti-k8s/pull/257
- PR #257 리뷰 코멘트: CR-009 (CPU ratio), CR-010 (memory)
