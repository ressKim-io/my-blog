---
title: "Pod 리소스 상향 vs Karpenter NodePool 분리 — 측정 선행으로 결정"
excerpt: "4차 부하(3000 VU, ticket_success 7.8%, p99 10s)에서 CPU 117% 포화를 보고 Karpenter 전용 CPU-heavy spot 노드 분리를 고민했지만, CPU 117%는 증상이고 FindPrice N+1·distLock WaitTimeout 등 코드 병목이 진짜 원인이라 판단해 NodePool 초안만 준비하고 측정 선행 전략을 채택했습니다"
category: kubernetes
tags:
  - go-ti
  - Karpenter
  - NodePool
  - HPA
  - Scaling
  - Capacity-Planning
  - adr
series:
  name: "goti-scaling"
  order: 3
date: "2026-04-15"
---

## 한 줄 요약

> 4차 부하(2026-04-14, 3000 VU)에서 ticketing pod CPU 117% / p99 10s 이슈가 드러났습니다 "pod 리소스 늘릴까 vs pod 수 늘릴까 vs Karpenter 전용 CPU-heavy spot 노드 띄울까"라는 세 갈래 고민 앞에서, **CPU 117%는 증상이고 FindPrice N+1·distLock WaitTimeout·context timeout 부재 등 코드 병목이 진짜 원인**이라고 판단해 NodePool은 초안(SDD-0006)만 준비하고 측정 선행 전략을 채택했습니다

---

## 🔥 배경: CPU 117%를 보고 세 갈래 고민이 생겼다

4차 부하(2026-04-14, 3000 VU) 결과는 다음과 같았습니다

- `ticket_success_rate` **7.8%**
- ticketing pod CPU peak **117% of request** (limit 1 core hit)
- p99 거의 전부 **10s** (k6 timeout 천장)

1차 대응으로 PR #257에서 CPU req/limit을 상향했습니다 이후 리뷰(CR-009)에서 ratio `1:6` → `1:2`로 재조정했습니다 이 시점에 근본적 질문이 제기됐습니다

### 질문 3가지

1. ticket pod 리소스만 무작정 늘리는 게 나을까, pod 늘려서 분산이 나을까?
2. 노드별 리소스 한계가 있어서 조절이 필요하지 않은가?
3. 부하 시 CPU가 엄청 높으니 Karpenter로 ticketing 전용 **CPU-heavy spot 노드**를 띄우면 어떨까?(상대적으로 CPU가 높은 c-series 인스턴스 활용)

---

## 🤔 분석: "Vertical vs Horizontal"은 잘못된 프레임

CPU 117%는 **증상**이지 근본 원인이 아니었습니다 SDD-0004에서 밝힌 실제 병목은 코드 레벨에 있었습니다

- `FindPrice` N+1 쿼리 (Phase 2에서 0 쿼리로 수정)
- pricing 인덱스 부족 (003 migration 추가)
- `distLock` WaitTimeout 1s (3s로 수정)
- context timeout 부재 (middleware 추가)
- Stadium 동기 chain (5min cache)

이들이 AWS 재기동 후 반영되면 **CPU 사용량 자체가 크게 감소**할 것으로 예상됐습니다
SDD-0005(Redis SoT)까지 가면 RDS round-trip 제거로 추가 50~80% 감소 가능이었습니다

**pod 리소스·수는 baseline 역할일 뿐 진짜 레버는 코드**라는 결론이었습니다

---

## 🧭 선택지 비교 — Vertical vs Horizontal vs NodePool 분리

### Vertical vs Horizontal 트레이드오프

| 관점 | Vertical | Horizontal |
|---|---|---|
| Throttling 즉시 해소 | ✅ | ❌ (스케일 시간) |
| 장애 격리 | ❌ 1/8 | ✅ 1/24 |
| Go goroutine/conn 공유 | ✅ | ❌ pod별 독립 |
| **RDS conn 압박** | ✅ | ❌ **함정** |
| bin packing | ❌ | ✅ |

**RDS 함정**: `MaxConns=15 × 24 pod = 360 > RDS 300 한계`
PgBouncer가 흡수하지만 pool_size × replicas 여유가 빠듯합니다

### Karpenter 전용 NodePool 아이디어 — 방향은 정확, 시점이 이르다

인스턴스 단가 비교 (spot, ap-northeast-2)를 먼저 확인했습니다

| 타입 | vCPU | $/hr | vCPU당 $ |
|---|---|---|---|
| m6i.xlarge | 4 | $0.050 | $0.0125 |
| c7a.xlarge | 4 | $0.055 | $0.014 |
| c7i.xlarge | 4 | $0.065 | $0.016 |

c-series는 **vCPU당 20% 비쌉니다** 그러나 JSON marshal, JWT verify, pgx encoding 같은 CPU bound 연산에서 clock·cache 우세로 **cost-per-req 기준은 c가 유리할 수도** 있습니다 실측 필요합니다

NodePool 분리 시 주의점은 다음과 같습니다

1. 단일 instance-type 선점 시 **spot 중단 blast radius 큼** → c7a/c7i/c6i mix + multi-AZ
2. Karpenter 노드 프로비저닝 60~90s + Istio sidecar 30s 지연 → overprovision 고려
3. cost-per-req metric (비용 / `goti_ticket_success`)로만 진짜 비교 가능

### 고려한 옵션 (A vs B)

| 옵션 | 내용 | 평가 |
|------|------|------|
| A. 지금 NodePool 분리 착수 | 사용자 초기 아이디어대로 즉시 전용 spot 노드풀 | **기각** — 코드 효과 측정 전이라 효과 예측 불가, 낭비 위험 |
| **B. 측정 선행 + NodePool은 SDD 초안만** | Phase 1+2 효과 독립 측정, SDD-0006로 설계 준비 | **채택** |

### 기각·채택 이유

**A 탈락**: 격리를 즉시 확보하고 noisy neighbor를 방지하는 장점은 있지만, 코드 최적화 효과를 측정하기 전이라 overprovision 크기 산정 근거가 없습니다 기본적으로 "필요 없을 수 있는 지출"이 될 위험이 큽니다

**B 채택 근거**:

1. Phase 1+2 최적화가 매우 큼(FindPrice N+1 제거, context timeout, Stadium cache, pricing index) — CPU 요구량 자체가 크게 변할 가능성
2. 측정 없이 NodePool 분리하면 overprovision 크기 산정 근거가 없음
3. SDD-0006 초안으로 설계는 준비해두면 측정 결과 나오자마자 즉시 착수 가능

### 결정 기준

1. **코드 효과 독립 측정 가능 여부** — 인프라를 동시 변경하면 변수가 섞입니다 (1순위)
2. **overprovision 근거 확보** — 데이터 없는 분리는 비용 리스크
3. **재작업 비용** — 설계는 미리 해두되 적용은 데이터 기반으로

---

## ✅ 결정: Option B 채택 + SDD-0006 초안만 준비

### SDD-0006 초안 완료

`docs/dx/0006-ticketing-karpenter-nodepool-sdd.md`에 다음을 포함해 준비했습니다

- Karpenter NodePool 매니페스트 초안
- c7a/c7i/c6i mix + multi-AZ 설계
- Overprovision Deployment 옵션
- 측정 지표 정의 (CFS throttling, CPU p95, cost-per-req)

### 5차 부하 측정 후 의사결정 재개 조건

| 관측 조건 | 판정 |
|----------|------|
| throttling < 1%, CPU 사용량 < 70% | NodePool 불필요 |
| throttling 여전 or CPU 사용량 > 80% | NodePool 착수 |

SDD-0005 D7 완료 후(Redis SoT 전환 후) CPU 요구량을 재산정하는 2차 체크포인트도 잡았습니다

---

## 📚 배운 점

- **"무엇을 고칠까" 전에 "실제 병목이 무엇인가"를 코드·쿼리 수준으로 먼저 확인합니다** CPU 117%는 숫자이지 원인이 아닙니다 FindPrice N+1, distLock WaitTimeout, Stadium 동기 chain 같은 코드 병목이 실제로 CPU를 만들어내고 있었습니다
- **리소스 상향은 증상 치료, 코드 최적화가 근본 치료입니다** 리소스를 올리면 즉시 throttling은 해소되지만 비용 구조는 그대로이고, 같은 트래픽에서 반복 재발합니다
- **인프라 최적화는 데이터 없이 하면 낭비 리스크가 큽니다** NodePool 분리·전용 인스턴스 같은 결정은 실측 기반이어야 합니다 overprovision 크기 산정 근거가 없으면 설계부터 잘못됩니다
- **설계 문서는 미리 준비해두되 적용은 측정 후입니다** SDD를 초안으로 두면 측정 결과가 나오자마자 즉시 착수 가능합니다 "설계 없이 측정 후 급하게 짬"과 "설계 완료 상태에서 측정 후 바로 적용"은 리드타임이 크게 다릅니다
- **Vertical vs Horizontal의 숨은 함정은 RDS 커넥션입니다** `MaxConns × replicas`가 DB 한계를 넘으면 수평 확장이 오히려 장애를 유발합니다 PgBouncer 같은 흡수 계층을 함께 설계해야 합니다
