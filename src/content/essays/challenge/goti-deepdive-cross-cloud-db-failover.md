---
title: "Cross-Cloud DB 페일오버 자동화 — 감지·결정·실행을 분리하는 이유"
excerpt: "단일 신호로 장애를 판단할 수 없는 구조적 이유, split-brain이 발생하는 조건과 방어 방법, Step Functions state machine으로 오케스트레이션하는 원리를 설명합니다"
category: challenge
tags:
  - go-ti
  - DR
  - failover
  - split-brain
  - Step Functions
  - HMAC
  - RTO
  - concept
series:
  name: "goti-deepdive-platform"
  order: 9
date: "2026-04-21"
---

## 한 줄 요약

> Cross-cloud DB 페일오버를 안전하게 자동화하려면 감지(어디서 신호를 받는지)·결정(장애를 확정하는 로직)·실행(promote 단계를 순서대로 수행하는 오케스트레이터)을 서로 다른 장애 도메인에 두어야 합니다

---

## 🤔 무엇을 푸는 기술인가

Multi-cloud 운영에서 primary DB가 속한 클라우드 전체에 장애가 나면 쓰기 트래픽을 standby가 있는 다른 클라우드로 전환해야 합니다 이를 **DB 쓰기 승격(promote)** 이라고 부릅니다 트래픽 라우팅 자동화는 Cloudflare Worker 같은 edge 계층이 몇 초 안에 처리할 수 있지만, DB promote는 본질적으로 다릅니다

논리 복제(pglogical) 기반 standby를 primary로 전환하려면 다음을 순서대로 수행해야 합니다

- 복제 구독 비활성화(`pglogical.alter_subscription_disable`)
- standby DB를 쓰기 가능 상태로 전환
- 연결 엔드포인트 갱신(Secret Manager)
- 애플리케이션 롤아웃
- 헬스 체크 + 라우팅 확정

이 다단계 절차를 "자동화"할 때 발생하는 핵심 문제가 두 가지입니다

**첫째, 단일 신호로 장애를 판별할 수 없습니다** edge에서 primary fetch가 실패하는 원인은 실제 클라우드 장애 외에도 Cloudflare↔GCP 경로 장애, 앱 CPU 폭주, 네트워크 파티션 등 다양합니다 이 신호만 보고 promote를 실행하면 멀쩡한 primary DB를 강제로 내리는 참사가 납니다

**둘째, 감지 주체가 장애 도메인 안에 있으면 신호 자체가 소실됩니다** GCP 내부 서비스가 promote 오케스트레이터를 맡으면 GCP 전면 장애 시 오케스트레이터도 함께 죽어 아무런 동작을 하지 못합니다

이 두 문제를 해결하는 설계 원칙이 **장애 도메인 분리**와 **다중 검증(multi-probe)**입니다

---

## 🔧 동작 원리

### 세 주체의 역할 분리

페일오버 자동화 아키텍처는 목적이 다른 세 주체로 구성됩니다

| 주체 | 역할 | 장애 도메인 |
|---|---|---|
| Cloudflare Worker | 감지 — circuit open 신호를 보냄 | edge (GCP·AWS와 독립) |
| AWS Lambda Controller | 결정 — 다중 검증 후 approve/deny | AWS (GCP와 독립) |
| AWS Step Functions | 실행 — 5단계 promote 순서 보장 | AWS |

Cloudflare Worker는 GCP에도, AWS에도 속하지 않습니다 GCP가 전면 장애 나도 Worker는 edge에서 살아 있으며 신호를 발송할 수 있습니다 Lambda Controller는 AWS에 있으므로 GCP 장애와 무관하게 동작합니다 이것이 **감지 주체는 장애 도메인 밖에 두어야 한다**는 DR 설계의 핵심입니다

![Cross-Cloud DB 페일오버 자동화 — 감지·결정·실행 책임 분리|tall](/diagrams/goti-deepdive-cross-cloud-db-failover-1.svg)

위 시퀀스 다이어그램은 세 주체가 순서대로 협력하는 흐름입니다 왼쪽 Cloudflare Worker가 circuit open 지속을 감지하고 HMAC 서명 웹훅을 1회 발송합니다 가운데 Lambda Controller가 서명 검증, direct ping, pre-flight 검사, Slack 승인 네 단계를 거쳐 promote 여부를 결정합니다 오른쪽 Step Functions는 Controller가 승인한 경우에만 실행을 시작합니다

각 단계에서 **실패하면 흐름이 멈추고 promote가 거부됩니다** 이는 오류가 있을 때 가장 안전한 기본값이 "아무것도 하지 않는 것"이라는 원칙입니다

### HMAC 웹훅 서명

Cloudflare Worker가 Lambda에 POST를 보낼 때 **HMAC-SHA256 서명**을 헤더에 포함합니다

```text
X-Promote-Signature: sha256=<HMAC(shared_secret, body)>
```

Lambda Controller는 수신 즉시 서명을 검증합니다 서명이 틀리면 즉시 거부합니다 이 메커니즘이 필요한 이유가 두 가지입니다

첫째, **재생 공격(replay attack) 방어**입니다 동일한 웹훅 페이로드를 복사해 반복 전송하는 공격을 막으려면 nonce 또는 타임스탬프를 페이로드에 포함하고 서명 검증 시 함께 확인합니다 일정 시간 내 동일 nonce 재사용을 거부합니다

둘째, **credential 격리**입니다 대안 설계에서 Cloudflare Worker가 AWS IAM credential을 직접 보유하는 방식도 가능하지만, edge 수천 곳에 IAM credential이 배포되면 유출 위험이 크게 높아집니다 HMAC shared secret은 단방향이며, Lambda만 검증할 수 있습니다

Cloudflare Worker 쪽에서는 중복 발송 방지를 위해 KV에 플래그를 기록합니다

```javascript
// promote 요청 중복 방지 (TTL 30분)
await CACHE.put("promote:requested", "1", { expirationTtl: 1800 });
```

circuit이 회복되거나 30분이 지나면 플래그가 만료되어 다음 장애 시 다시 발송할 수 있습니다

### split-brain 방어 — 왜 단일 신호로는 부족한가

**Split-brain**은 두 노드(GCP primary, AWS standby)가 서로 자신이 primary라고 판단하는 상태입니다 이 상태에서 양쪽 모두 쓰기를 받으면 데이터가 분기되어 복구가 매우 어려워집니다

단일 신호 기반 자동화가 split-brain을 유발하는 시나리오는 다음과 같습니다

```text
시나리오: Cloudflare↔GCP 경로 장애 (GCP는 정상)
  1. CF Worker: GCP fetch 실패 감지
  2. 잘못된 설계: 즉시 AWS promote 실행
  3. 결과: GCP primary 살아있음 + AWS도 primary 전환 → split-brain
```

Lambda Controller가 `검사 2`에서 **AWS→GCP direct ping**을 실행하는 이유가 여기에 있습니다 Worker의 관점(edge→GCP)과는 독립적인 경로(AWS→GCP)로 GCP에 직접 도달을 시도합니다 GCP가 이 ping에 응답하면 "GCP는 살아있고 경로 문제"라고 판단하여 promote를 거부합니다

![Split-Brain 방어 장치 — 잘못된 페일오버를 막는 4중 검사|tall](/diagrams/goti-deepdive-cross-cloud-db-failover-2.svg)

위 흐름도는 Lambda Controller 안에서 동작하는 4중 검사입니다 HMAC 검증, direct ping, pre-flight 검사, Slack 승인 순서로 진행되며 어느 관문에서든 실패하면 오른쪽 "promote 거부" 분기로 빠집니다 모든 관문을 통과한 경우에만 맨 아래 Step Functions 실행 허가 상태에 도달합니다

4개 관문이 각각 다른 위협을 방어합니다

- **HMAC 서명 검증**: 위변조·재생 공격 방어
- **direct ping**: edge 관점 오탐 방어 네트워크 파티션이나 Cloudflare↔GCP 경로 장애를 실제 GCP 장애로 오인하는 상황 차단
- **pre-flight lag 체크**: RPO 보호 pglogical lag이 30초를 초과하면 standby의 데이터가 primary보다 뒤처져 있다는 뜻이므로 promote를 허용하면 데이터 손실이 발생합니다 이 경우 lag이 줄어들 때까지 대기하거나 수동 개입이 필요합니다
- **Slack 승인**: 사람 판단 cross-cloud 완전 자동화는 위 세 검사가 통과해도 예측 못한 상태(DDL 복제 미완, 부분 sync 등)가 있을 수 있습니다 Slack 승인 1회가 이 불확실성을 흡수합니다

### Step Functions — 단계별 retry와 rollback

Lambda Controller가 promote를 승인하면 AWS Step Functions state machine이 실행을 맡습니다 Step Functions를 선택하는 이유는 **각 단계의 실패를 독립적으로 처리**할 수 있기 때문입니다

단순 스크립트로 5단계를 순서대로 실행하면 중간 단계 실패 시 어디서 멈췄는지 파악하기 어렵고, retry와 rollback 경로를 직접 구현해야 합니다 Step Functions는 이를 state machine 정의로 선언적으로 표현합니다

5단계 state machine 구성입니다

```text
DisableSubscription
  → SetRDSWritable
    → UpdateSecret
      → TriggerArgoCDSync
        → HealthCheck
            성공: UpdateCFPrimary (완료)
            실패: Rollback
```

각 단계의 역할입니다

| 단계 | 동작 | 실패 시 |
|---|---|---|
| DisableSubscription | `pglogical.alter_subscription_disable` 실행 | Rollback(복제 재활성화) |
| SetRDSWritable | `default_transaction_read_only=off` (apply_method=immediate) | Rollback |
| UpdateSecret | Secret Manager의 `DATABASE_URL`을 AWS RDS writer endpoint로 교체 | Rollback |
| TriggerArgoCDSync | AWS cluster 6개 서비스 rollout 트리거 | Rollback |
| HealthCheck | smoke test 실행 | Rollback |
| UpdateCFPrimary | Cloudflare KV에 `primary=aws` 기록, Worker 라우팅 전환 | - |

`UpdateCFPrimary`가 마지막에 위치하는 이유가 중요합니다 Cloudflare KV를 truth source로 사용하여 "KV에 `primary=aws`가 기록된 시점부터 트래픽이 AWS로 라우팅된다"는 원자적 전환을 보장합니다 HealthCheck가 실패하면 KV를 업데이트하지 않고 Rollback하므로, 트래픽이 아직 AWS로 넘어오지 않은 상태에서 promote를 되돌릴 수 있습니다

`SetRDSWritable`은 `apply_method=immediate`로 적용합니다 일반적으로 RDS 파라미터 변경은 재부팅을 요구하지만, `default_transaction_read_only` 파라미터는 즉시 적용이 가능합니다 재부팅 없이 쓰기 가능 상태로 전환되므로 RTO를 단축합니다

---

## 📐 세부 동작과 옵션

### RTO 계층별 트레이드오프

자동화 수준을 세 계층으로 나누면 RTO와 안전성이 반비례합니다

| 계층 | 방식 | RTO | 위험도 |
|---|---|---|---|
| Tier 1 (수동 트리거) | Makefile target 실행, 각 단계 자동화 | ~5분 | 낮음 |
| Tier 2 (반자동) | 웹훅 + 4중 검사 + Slack 승인 + Step Functions | ~10~12분 | 중간 |
| Tier 3 (자동 승인) | 다중 probe 2/3 투표, 고 severity 한정 auto-approve | ~9분 | 높음 |

Tier 3으로 갈수록 RTO는 줄어들지만 split-brain 위험은 커집니다 Tier 2에서 Slack 승인 1회를 유지하는 것은 성능 최적화가 아니라 **불확실성 흡수 장치**입니다

Tier 3을 안전하게 구현하려면 단일 probe가 아닌 **quorum**이 필요합니다 Cloudflare edge + 외부 uptime 모니터(UptimeRobot/Pingdom) + DB direct probe 중 2/3가 "GCP 장애"로 동의할 때만 auto-approve하는 방식입니다

### Cloudflare KV — truth source 단일화

페일오버 후 라우팅 결정의 진실 공급원(truth source)을 단일화하는 것이 split-brain 방어의 마지막 층입니다 Cloudflare KV의 `primary` 키가 `gcp`이면 Worker가 GCP로, `aws`이면 AWS로 라우팅합니다 어떤 경로로든 이 값을 변경하면 즉시 모든 edge에 전파됩니다

Step Functions의 `UpdateCFPrimary`가 이 값을 `aws`로 쓰는 마지막 단계인 이유가 여기에 있습니다 모든 서비스가 healthy 상태를 확인한 다음에야 truth source를 바꿉니다 만약 `UpdateSecret` 단계에서 이 값을 바꾼다면 애플리케이션이 아직 준비되지 않은 AWS DB로 트래픽을 보내게 됩니다

---

## 🧩 go-ti에서는

go-ti의 DB 쓰기 승격은 수동 runbook으로 운영될 때 DR 훈련 10~20분, 첫 실전 30분+이었습니다 트래픽 라우팅(Cloudflare Worker, 1.5~3초)·JWT(양쪽 RSA 키 미러링, RTO 0)·앱 용량(HPA scale-up, 1~3분)은 이미 자동화된 상황에서 DB promote만 수동으로 남아 전체 RTO를 잡아먹는 병목이었습니다

설계는 위에서 설명한 3-tier 구조를 따릅니다 다만 2026-04 기준 AWS 인프라가 비용 절감으로 전량 destroy된 상태였으므로, 즉시 구현 가능한 Tier 1(Makefile target) 완성 후 Tier 2(본 설계)로 진입하는 로드맵을 수립했습니다 Tier 2 구현 진입 시에는 구현 범위·비용·SLO 영향을 정식 ADR로 별도 문서화할 예정입니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [Cross-Cloud DB Promote 자동화 — Lambda Controller + Step Functions 채택](/logs/goti-cross-cloud-db-promote-automation-adr)에 정리했습니다

---

## 📚 핵심 정리

- **감지 주체는 장애 도메인 밖에 두어야 합니다** GCP 내부 서비스가 GCP 장애를 감지하고 오케스트레이션하면 같이 죽습니다 edge(Cloudflare Worker)가 감지하고 AWS Lambda가 결정하는 구조가 이 원칙을 구현합니다
- **단일 신호로 장애를 판별할 수 없습니다** edge fetch 실패는 실제 클라우드 장애·네트워크 파티션·앱 폭주 등을 구분하지 못합니다 AWS→GCP direct ping으로 독립 경로를 추가 확인해야 split-brain 오탐을 방지합니다
- **HMAC 서명은 credential을 edge에 두지 않기 위한 장치입니다** edge에 AWS IAM을 배포하는 대신 shared secret으로 요청 진위를 검증하고, IAM은 Lambda 내 execution role로 격리합니다
- **pre-flight lag 체크는 RPO를 보호합니다** pglogical lag > 30s 상태에서 promote를 허용하면 최대 lag만큼의 데이터가 손실됩니다 lag이 줄어들 때까지 대기하거나 수동 개입이 필요합니다
- **truth source를 단일화하고 가장 마지막에 씁니다** Cloudflare KV의 `primary` 값이 라우팅 결정권을 가집니다 HealthCheck 통과 후에야 이 값을 바꿔 트래픽 전환과 DB 준비 완료를 동기화합니다
