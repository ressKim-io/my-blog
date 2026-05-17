---
title: "Cross-Cloud DB Promote 자동화 — Lambda Controller + Step Functions 채택"
excerpt: "DR 훈련 10~20분, 첫 실전 30분+이었던 DB 쓰기 승격 수동 runbook을 자동화하는 방안을 5가지 옵션으로 검토했습니다. 장애 도메인 분리·책임 단일화·Split-brain 방어를 기준으로 CF Worker → AWS Lambda Promote Controller → Step Functions 조합을 채택했습니다"
category: challenge
tags:
  - go-ti
  - DR
  - Multi-Cloud
  - AWS Lambda
  - Step Functions
  - Cloudflare Worker
  - pglogical
  - adr
series:
  name: "goti-multicloud"
  order: 14
date: "2026-04-21"
---

## 한 줄 요약

> DB 쓰기 승격(promote)만 남은 수동 runbook을 자동화하는 설계를 결정했습니다. 핵심 기준은 "감지·결정 주체가 장애 도메인 밖에 있는가"였습니다. Cloudflare Worker → AWS Lambda Promote Controller → Step Functions 5단계 state machine 구조를 채택했습니다

---

## 배경

go-ti Multi-Cloud는 4개 축으로 RTO를 줄여왔습니다.

| 축 | 방식 | 상태 |
|---|---|---|
| 트래픽 라우팅 | Cloudflare Worker Circuit Breaker | 1.5~3초, 자동, 검증 완료 |
| JWT | 양쪽 클라우드 RSA 키 미러링 (ADR-0015) | RTO 0 |
| 앱 용량 | HPA scale-up | 1~3분 |
| DB 쓰기 승격 | **수동 runbook** (ADR-0018/0019/0020) | 훈련 10~20분 / 첫 실전 30분+ |

마지막 한 축인 DB promote만 수동으로 남아 있었습니다.
훈련에서는 10~20분이었지만 첫 실전에서는 30분을 넘겼습니다.
여기서 전체 RTO를 깎을 여지가 가장 컸습니다.

자동화를 설계할 때 핵심 질문은 **"누가 장애를 감지하고, 누가 promote를 실행하는가"**였습니다.
두 주체가 같은 장애 도메인 안에 있으면 GCP 전면 장애 시 둘 다 같이 죽기 때문입니다.

---

## 🧭 선택지 비교

### 고려한 옵션

| 옵션 | 핵심 아이디어 | 채택 여부 |
|---|---|---|
| A. CF Worker → queue-gate 신호 | edge에서 GCP 내부 queue-gate로 신호 전달 | 기각 |
| B. CF Worker → AWS Lambda Controller → Step Functions | edge에서 AWS Controller에 웹훅, Step Functions 오케스트레이션 | **채택** |
| C. EKS Job + ArgoCD hook | EKS에 Promote Job 배포, ArgoCD 트리거 | 기각 |
| D. Temporal workflow | Temporal saga/compensation 패턴 | 기각 |
| E. GitHub Actions workflow_dispatch | workflow_dispatch 수동 트리거 | 기각 |

### 기각 이유

**Option A — CF Worker → queue-gate 신호**

queue-gate는 GCP 안에 있습니다.
GCP 전면 장애가 발생하면 queue-gate도 같이 죽기 때문에 신호를 받을 수 없습니다.
**장애 도메인 공유**가 치명적 결함입니다.

세 가지 문제가 더 있습니다.

첫째, **책임 혼재**입니다. queue-gate는 봇 탐지 도메인인데 DR 오케스트레이션 책임을 추가하면, queue-gate 배포할 때마다 DR 경로가 위험에 노출됩니다.

둘째, **credential 문제**입니다. Cloudflare Worker는 전 세계 edge PoP에서 실행됩니다. 수천 곳에 AWS IAM 자격증명을 배포해야 하고 유출 리스크가 증폭됩니다.

셋째, **Split-brain 위험**입니다. Worker 관점의 "primary fetch 실패"는 실제 GCP 장애와 네트워크 파티션, Cloudflare↔GCP 경로 장애, 앱 CPU 폭주를 구분하지 못합니다. 멀쩡한 DB를 내리는 참사가 발생할 수 있습니다.

**Option C — EKS Job + ArgoCD hook**

EKS가 장애를 겪으면 오케스트레이터도 함께 사용할 수 없어집니다.
K8s 의존성이 생기고 state machine 시각화가 약합니다.

**Option D — Temporal workflow**

retry/saga/timeout 처리에 최적이지만 Temporal cluster 운영 부담과 러닝커브가 있습니다.
MVP 범위를 초과하는 투자였습니다.

**Option E — GitHub Actions workflow_dispatch**

GitHub 장애에 DR 경로가 종속됩니다.
private 인프라 접근을 위해 self-hosted runner가 필요하고, 이 runner가 또 다른 단일 장애점이 됩니다.

### 결정 기준과 최종 선택

**Option B를 채택했습니다.**

결정 기준은 다음 우선순위였습니다.

1. **장애 도메인 분리**: 감지·결정 주체는 반드시 장애 도메인 밖에 있어야 합니다. GCP 장애 시에도 Controller는 살아 있어야 합니다
2. **책임 단일화**: promote 오케스트레이션은 전용 컴포넌트가 담당해야 합니다. 기존 서비스에 DR 로직을 얹으면 배포 리스크가 생깁니다
3. **Split-brain 방어**: pre-flight 검증 + Slack 승인으로 오판 가능성을 최소화해야 합니다
4. **운영 비용**: serverless로 비용이 거의 0에 가까워야 합니다

Option B는 Controller가 AWS에 있어 GCP 전면 장애 시에도 살아있습니다.
promote 전용 Lambda이므로 다른 서비스와 책임이 완전히 분리됩니다.
AWS→GCP direct ping + pglogical lag 검증 + Slack 승인으로 Split-brain을 방어합니다.

---

## 아키텍처 상세

전체 흐름은 세 계층으로 분리됩니다.

### 1. Cloudflare Worker (Trigger)

기존 Circuit Breaker를 확장합니다.

- circuit open이 **5분 이상** 지속될 때 1회 HMAC 서명 웹훅을 발송합니다
- 중복 발송 방지를 위해 Cloudflare KV에 플래그를 기록합니다

```typescript
// Cloudflare KV에 중복 방지 플래그 기록 (TTL 30분)
await CACHE.put("promote:requested", "1", { expirationTtl: 1800 });
```

### 2. AWS Lambda Promote Controller (Decision)

edge 신호를 받아 "실제 장애인지"를 재확인하고 승인을 요청합니다.

1. HMAC 서명 검증 (Worker shared secret)
2. **AWS → GCP direct ping**으로 "edge-only failure vs 실제 GCP 장애" 재확인
3. Pre-flight check 실행
4. Slack 승인 요청

Pre-flight 항목은 다음과 같습니다.

| 항목 | 기준 |
|---|---|
| pglogical lag | < 30s |
| subscription status | `pglogical.subscription_status_all` = replicating |
| orders/payments sync 비율 | 임계값 이상 |
| RDS standby | healthy |

pglogical lag이 30초를 초과하면 promote를 거부합니다.
데이터 손실(RPO 위반) 가능성이 있기 때문입니다.

### 3. AWS Step Functions (Actuator)

Slack 승인이 확인되면 5단계 state machine이 실행됩니다.

```text
DisableSubscription
  → SetRDSWritable
  → UpdateSecret
  → TriggerArgoCDSync
  → HealthCheck → [성공] UpdateCFPrimary
                → [실패] Rollback
```

각 단계의 역할은 다음과 같습니다.

- **DisableSubscription**: `pglogical.alter_subscription_disable`로 GCP→AWS 복제를 중단합니다
- **SetRDSWritable**: RDS parameter `default_transaction_read_only=off` (apply_method=immediate)로 쓰기를 허용합니다
- **UpdateSecret**: Secret Manager의 `DATABASE_URL`을 AWS RDS writer endpoint로 교체합니다
- **TriggerArgoCDSync**: AWS cluster 6개 서비스 rollout을 트리거합니다
- **HealthCheck**: smoke test 실행 후 성공이면 `UpdateCFPrimary`로 진행하고, 실패이면 `Rollback`을 실행합니다
- **UpdateCFPrimary**: Cloudflare KV에 `primary=aws`를 기록해 Worker 라우팅을 전환합니다

Step Functions를 쓰는 이유는 각 단계의 **retry/rollback 시각화** 때문입니다.
한 단계가 실패했을 때 어디서 멈췄는지 콘솔에서 즉시 확인할 수 있고, 재실행 범위를 좁힐 수 있습니다.

---

## Split-brain 방어 장치

Split-brain은 "GCP DB는 살아있는데 AWS DB가 write를 시작하는" 상황입니다.
양쪽에서 write가 발생하면 데이터 정합성이 깨집니다.

최소 방어 장치는 다음과 같습니다.

| 장치 | 역할 |
|---|---|
| AWS→GCP direct ping | edge 관점 실패 vs 실제 GCP 장애 구분 |
| pre-flight lag check | lag > 30s면 promote 거부 (RPO 보호) |
| Slack 승인 1회 | 사람 sanity check |
| Cloudflare KV primary flag | truth source 단일화 |
| (선택) GCP DB read-only lock | GCP가 살아있으면 write 차단 |

AWS→GCP direct ping이 핵심입니다.
Cloudflare Worker가 "GCP fetch 실패"를 보고해도, Lambda가 GCP에 직접 도달할 수 있으면 네트워크 경로 문제일 가능성이 높습니다.
이 경우 promote를 거부합니다.

업계에서 Aurora/Patroni는 in-region only, cross-cloud는 Netflix/Shopify도 반자동을 유지합니다.
logical replication은 lag/sync/DDL 전파 상태 확인이 필수인 multi-step orchestration이기 때문에 완전 자동화보다 신중한 자동화가 적합합니다.

---

## RTO 개선 효과

| 방식 | 예상 RTO |
|---|---|
| 현재 (수동 runbook) | 30분+ (첫 실전) / 10~20분 (훈련) |
| Tier 1 (Makefile target) | 5분 (수동 트리거, 자동 실행) |
| Tier 2 (본 설계, Slack 승인 포함) | **10~12분** |
| Tier 3 (auto-approve, 고 severity 한정) | 9분 |

Tier 2 기준으로 첫 실전 대비 3분의 1로 단축됩니다.
Slack 승인 1회를 유지하는 이유는 Split-brain 리스크가 그만큼 높기 때문입니다.
완전 무인화보다 Slack 승인 한 번의 안전 장치가 더 가치 있다고 판단했습니다.

---

## 구현 로드맵

단계별로 나눠 구현합니다. 전체를 한 번에 올리면 검증하기 어렵습니다.

**Tier 1 — 1주 내**: `infra/ops/promote/` 하위에 스크립트 3개를 만듭니다.

```text
promote-to-aws.sh   # 각 Step Functions 단계를 순서대로 실행
preflight.sh        # pglogical lag, subscription status 확인
rollback.sh         # DisableSubscription 이전 상태로 복귀
```

Makefile target `make promote-to-aws`로 실행합니다.
실행 시간은 자동화하되 결정은 사람이 내립니다.
이 스크립트가 idempotent하게 다듬어져야 Lambda가 호출할 단위가 명확해집니다.

**Tier 2 — 1~3개월**: Cloudflare Worker 웹훅 → API Gateway + Lambda → Step Functions + Slack bot 연동.

**Tier 3 — 장기**: 다중 Trigger quorum — Cloudflare edge + 외부 uptime (UptimeRobot/Pingdom) + DB direct probe 2/3 vote. 고 severity (5xx > 50% for 3분) 한정 auto-approve.

---

## 선행 조건

현재 블로커는 세 가지입니다.

1. **AWS 재기동**: 2026-04-19 전량 destroy 상태라 RDS 환경 자체가 없습니다
2. **Phase B orders/payments 재sync**: pglogical 구독이 정상 상태여야 pre-flight 검증이 의미 있습니다
3. **Tier 1 Makefile target 선행**: 각 단계가 스크립트로 idempotent하게 구현되어야 Lambda 호출 단위가 생깁니다

---

## 트레이드오프 수용

이 설계로 운영 대상이 늘어납니다.

- Lambda + Step Functions + Slack bot + HMAC secret 관리
- 비용 증가: Lambda invocation + Step Functions transitions, 월 ≪ $5
- 완전 무인화 포기: Slack 승인 1회 유지

운영 복잡도 증가는 받아들입니다.
Split-brain 발생 시 데이터 정합성 복구 비용이 훨씬 크기 때문입니다.

---

## 후속 영향

- `docs/sre/dr-rpo-rto.md` 블로커 B5("promote 자동화 없음")를 "Tier 1/2/3 로드맵 확정"으로 갱신 예정
- ADR-0021의 "DB failover 자동화" 섹션을 본 설계로 구체화 예정
- Tier 2 구현 진입 시점에 별도 ADR(0026 등)으로 승격 권장 — 구현 범위·비용·SLO 영향을 정식 문서화

---

## 📚 배운 점

- **장애 도메인 분리 원칙**: 감지·결정 주체는 반드시 장애 도메인 밖에 있어야 합니다. GCP 장애를 감지하는 Controller가 GCP 안에 있으면 아무 의미가 없습니다
- **credential 안전성**: edge 수천 곳에 배포하는 Worker 환경과 Lambda execution role은 보안 특성이 전혀 다릅니다. DR 경로의 credential은 가장 좁은 범위에 두는 것이 안전합니다
- **단일 신호 기반 자동화의 위험**: "fetch 실패"는 실제 장애 외에도 경로 장애, CPU 폭주 등 여러 원인이 있습니다. 자동화일수록 재확인 단계가 필요합니다
- **Tier 분리 접근**: 전체 자동화를 한 번에 구현하지 않고 Tier 1(스크립트화) → Tier 2(웹훅+state machine) → Tier 3(quorum)으로 나누면 각 단계를 검증하며 올라갈 수 있습니다
- **logical replication promote는 multi-step**: pglogical disable → RDS writable → Secret 교체 → rollout → health check 순서가 지켜져야 합니다. 한 단계라도 실패하면 이전 상태로 되돌아갈 수 있어야 합니다

---

## 🔗 관련 기술 해설

이 글에서 결정한 기술의 동작 원리는 다음 해설글에서 자세히 다룹니다

- [Cross-Cloud DB 페일오버 자동화 — 감지·결정·실행을 분리하는 이유](/essays/goti-deepdive-cross-cloud-db-failover)
