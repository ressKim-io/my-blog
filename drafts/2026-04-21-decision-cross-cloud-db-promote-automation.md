---
date: 2026-04-21
category: decision
project: goti-team-controller
tags: [dr, multi-cloud, pglogical, cloudflare-worker, aws-lambda, step-functions, failover, automation]
---

# Cross-Cloud DB Promote 자동화 아키텍처 — queue-gate 기각, AWS Lambda Controller 채택

## Context

RTO/RPO 논의 중 DB 쓰기 승격(promote) 시간이 훈련 10~20분 / 첫 실전 30분+ 로 측정된 상황에서 자동화 방안을 검토. 현재 구조:

- **트래픽**: Cloudflare Worker Circuit Breaker 로 1.5~3초 내 cross-cloud 라우팅 (자동, 검증됨)
- **JWT**: 양쪽 클라우드 RSA 키 미러링으로 RTO 0 (ADR-0015)
- **앱 용량**: HPA scale-up 1~3분 (ADR-0016)
- **DB 쓰기 승격**: **수동 runbook** (ADR-0018/0019/0020, `docs/runbooks/db-failover-failback.md`)

마지막 한 축만 수동이라 전체 RTO 를 깎을 여지가 큼. 자동화 설계 시 **"누가 장애를 감지" 하고 "누가 promote 를 실행" 하느냐** 의 책임 분리가 핵심.

## Issue

### Option A: Cloudflare Worker → queue-gate 신호 (초기 제안)

Cloudflare Worker 가 circuit open 을 감지하면 GCP 내부 `goti-queue-gate` 에 신호를 보내 promote 오케스트레이션 담당.

- 장점
  - 신호 경로가 짧음 (edge → internal)
  - 기존 queue-gate 서비스 재활용
- 단점
  - **장애 도메인 공유**: queue-gate 는 GCP 에 있어 GCP 전면 장애 시 같이 죽음 → 신호 수신 불가
  - **책임 혼재**: 봇탐지 도메인 + DR 오케스트레이션 → queue-gate 배포 때마다 DR 경로가 위험
  - **credential 문제**: Cloudflare Worker edge 수천 곳에 AWS IAM 배포 필요, 유출 리스크 증폭
  - **단일 신호 기반 Split-brain**: Worker 관점의 "primary fetch 실패" 는 실제 GCP 장애 / 네트워크 파티션 / Cloudflare↔GCP 경로 장애 / 앱 CPU 폭주를 구분 불가 → 멀쩡한 DB 를 내리는 참사 가능

### Option B: CF Worker → AWS Lambda Promote Controller → Step Functions (채택)

Cloudflare Worker 가 webhook 으로 AWS 측 Controller 에 알림. Controller 가 이중 확인 + pre-flight + Slack 승인 후 Step Functions 로 promote 오케스트레이션.

- 장점
  - **장애 도메인 분리**: Controller 가 AWS 에 있어 GCP 장애 시 살아있음
  - **책임 단일화**: Controller 는 promote 전용 (queue-gate 와 무관)
  - **pre-flight 검증 가능**: pglogical lag, subscription status, orders/payments sync, RDS healthy 확인
  - **Split-brain 방어**: AWS→GCP direct ping, Slack 승인, Cloudflare KV truth source, (선택) GCP read-only lock
  - **serverless**: 비용 거의 0, 장애 도메인 분리 완벽
  - **시각화**: Step Functions state machine 으로 각 단계 추적/retry/rollback
- 단점
  - Cloudflare Worker 웹훅 + HMAC 서명 검증 구현 필요
  - Lambda + Step Functions + Slack bot 운영 대상 추가
  - cross-cloud 완전 자동은 여전히 비권장 → Slack 승인 1회는 유지

### Option C: EKS Job + ArgoCD hook

AWS EKS 에 Promote Job 을 배포하고 ArgoCD 가 트리거.

- 장점: 기존 GitOps 친숙
- 단점: EKS 장애 시 orchestrator 도 못 쓸 리스크, K8s 의존성, state machine 시각화 약함

### Option D: Temporal workflow

Temporal 로 saga/compensation 패턴 구현.

- 장점: retry/saga/timeout 정석, multi-step orchestration 에 최적
- 단점: Temporal cluster 운영 부담, 러닝커브, MVP 범위 초과

### Option E: GitHub Actions workflow_dispatch

GitHub Actions 의 workflow_dispatch 로 수동 트리거.

- 장점: 매우 빠른 구축, 기존 CI 재활용
- 단점: GitHub 장애 의존, private 인프라 접근을 위한 self-hosted runner 필요, DR 경로가 외부 SaaS 에 종속

## Action

**Option B (CF Worker → AWS Lambda Promote Controller → Step Functions) 채택.**

### 아키텍처 상세

1. **Cloudflare Worker (Trigger)**
   - 기존 Circuit Breaker 확장
   - circuit open 이 5분 이상 지속 시 1회 HMAC 서명 웹훅 발송
   - `CACHE.put("promote:requested", "1", { expirationTtl: 1800 })` 로 중복 방지

2. **AWS Lambda Promote Controller (Decision)**
   - HMAC 서명 검증 (Worker shared secret)
   - **AWS → GCP direct ping** 으로 "edge-only failure vs 실제 장애" 재확인
   - Pre-flight check:
     - pglogical lag < 30s
     - `pglogical.subscription_status_all` = replicating
     - orders/payments sync 비율
     - RDS standby healthy
   - Slack/Discord 승인 요청 (cross-cloud 에서 auto-approve 비권장)

3. **AWS Step Functions (Actuator)** — 5단계 state machine
   - `DisableSubscription`: `pglogical.alter_subscription_disable`
   - `SetRDSWritable`: RDS parameter `default_transaction_read_only=off` (apply_method=immediate)
   - `UpdateSecret`: Secret Manager `DATABASE_URL` → AWS RDS writer endpoint
   - `TriggerArgoCDSync`: AWS cluster 6 서비스 rollout
   - `HealthCheck`: smoke test → 성공 시 `UpdateCFPrimary`, 실패 시 `Rollback`
   - `UpdateCFPrimary`: Cloudflare KV `primary=aws` 기록 → Worker 라우팅 전환

### Split-brain 방어 장치 (최소)

| 장치 | 역할 |
|------|------|
| AWS→GCP direct ping | edge 관점 실패 vs 실제 GCP 장애 구분 |
| Pre-flight lag check | lag > 30s 면 promote 거부 (RPO 보호) |
| Slack 승인 1회 | 사람 sanity check |
| Cloudflare KV primary flag | truth source 단일화 |
| (선택) GCP DB read-only lock | 진짜 살아있으면 write 차단 |

### 선택 근거

- **장애 도메인 분리 원칙**: 감지/결정 주체는 장애 도메인 밖에 있어야 함 → Controller 는 반드시 AWS
- **업계 관행**: Aurora/Patroni 는 in-region only, cross-cloud 는 Netflix/Shopify 도 반자동 유지
- **logical replication 특성**: multi-step orchestration 이라 careful automation 필요 (lag/sync/DDL 전파 상태 확인 필수)
- **credential 안전성**: Lambda 의 execution role 이 edge Worker env 보다 훨씬 안전

## Result

### RTO 개선 효과

| 방식 | RTO |
|------|-----|
| 현재 (수동 runbook) | 30분+ (첫 실전) / 10~20분 (훈련) |
| Tier 1 (Makefile target) | 5분 (수동 트리거, 자동 실행) |
| Tier 2 (본 설계, Slack 승인 포함) | **10~12분** |
| Tier 3 (auto-approve, 고 severity 한정) | 9분 |

### 구현 로드맵

- **Tier 1 (1주 내)**: `infra/ops/promote/` 하위에 `promote-to-aws.sh` + `preflight.sh` + `rollback.sh`. Makefile target `make promote-to-aws`. 실행 시간만 자동화, 결정은 사람.
- **Tier 2 (1~3개월)**: 본 설계 구현. CF Worker webhook 추가 → API Gateway + Lambda → Step Functions state machine + Slack bot 연동.
- **Tier 3 (장기)**: 다중 Trigger quorum — Cloudflare edge + 외부 uptime (UptimeRobot/Pingdom) + DB direct probe 2/3 vote. 고 severity (5xx > 50% for 3min) 한정 auto-approve.

### 선행 조건 (현재 블로커)

1. **AWS 재기동** — 2026-04-19 전량 destroy 상태 (`project_aws_cost_freeze_gcp_only.md`)
2. **Phase B orders/payments 재sync** — `dr-rpo-rto.md` 블로커 B2 / ADR-0021 C3
3. **Tier 1 Makefile target 선행** — 수동 runbook 의 각 단계가 스크립트 idempotent 하게 다듬어져야 Lambda 가 호출할 단위가 명확해짐

### 후속 영향

- `docs/sre/dr-rpo-rto.md` 블로커 B5 ("promote 자동화 없음") 를 "Tier 1/2/3 로드맵 확정" 으로 갱신 예정
- ADR-0021 Tier 2 섹션의 "DB failover 자동화" 를 본 설계로 구체화 예정
- Tier 2 구현 진입 시점에 **별도 ADR (0026 등) 로 승격** 권장 — 구현 범위/비용/SLO 영향을 정식 문서화

### 트레이드오프 수용

- **운영 복잡도 +3** (Lambda + Step Functions + Slack bot + HMAC 시크릿 관리)
- **비용 +α** (Lambda invocation + Step Functions transitions, 월 ≪ $5)
- **완전 무인화 포기** (Slack 승인 1회 유지) — 대신 Split-brain 방어

## Related Files

- `docs/sre/dr-rpo-rto.md` — RTO/RPO 목표 + 블로커 B5
- `docs/adr/0018-multicloud-db-replication-technology.md` — pglogical 선택 근거
- `docs/adr/0020-db-failback-reverse-replication.md` — 역방향 복제 (failback 절차)
- `docs/adr/0021-pglogical-mr-replication-known-gaps-and-roadmap.md` — 한계 + Tier 1/2/3 로드맵
- `docs/runbooks/db-failover-failback.md` — 현재 수동 runbook (Tier 1 자동화의 원본)
- (예정) `docs/adr/0026-db-promote-automation.md` — Tier 2 진입 시 신규 ADR
- (예정) `infra/ops/promote/` — Tier 1 Makefile target + scripts
- (예정) `cloudflare-worker/src/promote-webhook.ts` — Worker webhook 로직
- (예정) `infra/aws/lambda/promote-controller/` — Lambda 함수 + Step Functions 정의
