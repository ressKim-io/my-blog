---
title: "Redis 관리형 유지 + Kafka 완전 제거 — 두 인프라 결정의 배경과 이유"
excerpt: "GCP 확장 시점에 Redis 자체 운영 전환을 검토했지만 관리형 서비스를 유지했습니다. 한편 Strimzi+KRaft로 도입 결정까지 마쳤던 Kafka는 CDN 대기열 채택으로 프로젝트에서 완전히 제거했습니다."
category: challenge
tags:
  - go-ti
  - Kafka
  - Cost
  - Simplification
  - Architecture-Decision-Record
  - adr
series:
  name: "goti-kafka"
  order: 3
date: "2026-04-06"
---

## 한 줄 요약

> Redis는 K8s 자체 운영 전환이 절감액 대비 작업량이 크다고 판단해 관리형을 유지했습니다. Kafka는 CDN 대기열 채택으로 프로젝트에서 불필요해졌고, 코드베이스 전반의 잔재를 일괄 정리했습니다.

---

## 배경: GCP 확장과 두 가지 인프라 결정

Goti 프로젝트는 삼성 구단(AWS EKS)에서 두산 구단(GCP GKE)으로 멀티클라우드를 확장하는 시점이었습니다.
이 전환 과정에서 두 가지 인프라 항목을 재검토해야 했습니다.

첫 번째는 **Redis 운영 방식**입니다.
AWS에서는 ElastiCache를 사용 중이었지만, GCP Memorystore 비용이 추가되면서 두 클라우드의 관리형 Redis를 합산하면 월 약 $120이 됩니다.
K8s Pod로 자체 운영 전환 시 이 비용의 상당 부분을 절감할 수 있다는 주장이 있었습니다.

두 번째는 **Kafka의 존재 이유**입니다.
이전 ADR에서 대기열 처리를 위해 Strimzi 0.51 + KRaft 4.2.0 기반 Kafka 클러스터 도입을 결정했습니다.
그러나 대기열 담당 POC가 CDN 캐싱 방식을 최종 채택하면서, Kafka는 프로젝트에서 실질적인 역할이 없어진 상태였습니다.
코드베이스 곳곳에 Kafka 잔재가 남아 있어 정리가 필요했습니다.

---

## 🧭 Decision 1: Redis 운영 방식

두 가지 옵션을 비교했습니다.

### 고려한 옵션

| 옵션 | 핵심 아이디어 | 장점 | 한계 |
|------|---------------|------|------|
| A. K8s Pod 자체 운영 (Bitnami Sentinel) | Helm chart로 AWS/GCP 통일, Redis를 Pod로 직접 운영 | 연 $1,440~$2,280 비용 절감, GitOps 통합, Multi-Cloud 동일 chart | Failover 직접 관리(Sentinel 5~7분 소요 사례), 10개+ 서비스 env 변경 필요, 백업 CronJob 직접 구성 |
| B. 관리형 서비스 유지 (ElastiCache + Memorystore) | 현상 유지, 벤더 SLA에 의존 | 운영 부담 없음, Failover·백업·업그레이드 자동화 | AWS+GCP 합산 월 ~$120 |

### 기각 이유

**A 탈락**: 두 가지 이유가 결정적이었습니다.

첫째, **Operator 생태계가 부실**합니다.
Spotahome과 OpsTree의 Redis Operator가 모두 2022년에 마지막 릴리스를 한 상태입니다.
활발히 유지보수되지 않는 Operator를 프로덕션에 올리는 것은 리스크가 높습니다.
Palark의 사례에서 replica 확장 시 데이터 파괴가 발생한 기록도 있습니다.

둘째, **10개 이상의 서비스 환경변수를 일괄 변경해야** 합니다.
`REDIS_HOST` 교체와 SSL 설정 해제가 필요하며, 서비스 하나라도 누락되면 배포 사고로 이어집니다.
연간 절감액이 $1,440~$2,280이지만, 이 작업의 공수와 위험이 절감액 대비 과도합니다.

### 결정 기준과 최종 선택

**B(관리형 서비스 유지)를 채택했습니다.**

결정 기준은 다음 우선순위였습니다.

1. **엔지니어링 시간 대비 비용 효과**: 10일도 안 되는 운영 환경에서 전환 작업에 쓸 인력이 없었습니다
2. **운영 안정성**: 15인 팀이 Redis Failover와 백업을 직접 관리하는 부담을 짊어질 필요가 없었습니다
3. **절감 규모의 타당성**: 연 $1,440~$2,280 절감은 의미 있지만, 10개+ 서비스 env 변경 작업량과 배포 사고 리스크를 감당할 만큼 크지 않았습니다

ElastiCache cache.t3.small은 이미 월 약 $50으로 저렴한 편이고, GCP Memorystore Standard HA 1GB(약 $70)는 Terraform에 이미 정의하고 apply가 완료된 상태였습니다.
현재 구조를 바꾸지 않으면 추가 작업 없이 즉시 운영할 수 있습니다.

---

## 🧭 Decision 2: Kafka 처리 방향

### 전말: 도입 결정 후 실제 사용처가 사라졌습니다

Kafka는 대기열 처리를 위해 이전 ADR(goti-kafka 시리즈 이전 글)에서 Strimzi 0.51 + KRaft 4.2.0 기반으로 도입을 결정했습니다.
그러나 대기열 담당 POC가 CDN 캐싱 방식을 최종 채택하면서, Kafka가 담당해야 할 비즈니스 역할이 사라졌습니다.

남은 선택은 두 가지였습니다.

| 옵션 | 내용 |
|------|------|
| A. Kafka 유지 | 잠재적 사용처를 위해 클러스터 유지, 관련 설정도 그대로 둠 |
| B. 전체 제거 | 비즈니스 역할 없는 컴포넌트를 코드베이스에서 완전히 삭제 |

### 결정 기준과 최종 선택

**B(전체 제거)를 선택했습니다.**

사용하지 않는 컴포넌트를 유지하는 것은 운영 비용과 인지 부담을 높입니다.
Kafka 클러스터를 실행하면 Strimzi Operator, Zookeeper 대체 KRaft, 관련 NetworkPolicy가 계속 자원을 소비합니다.
CDN 대기열로 방향이 확정된 이상, Kafka 잔재를 코드베이스에 두는 것은 혼란만 가중시킵니다.

---

## ✅ 실행 내용

### Redis: 관리형 서비스 유지 확정

GCP Memorystore Standard HA 1GB를 Terraform으로 프로비저닝하고 apply를 완료했습니다.
AWS ElastiCache는 기존 설정을 그대로 유지합니다.

```text
AWS:  ElastiCache cache.t3.small Multi-AZ  ~$50/월
GCP:  Memorystore Standard HA 1GB          ~$70/월
합계: ~$120/월 (추가 작업 없음)
```

### Kafka: 코드베이스 전체 정리

코드베이스 전반에 흩어져 있던 Kafka 참조를 일괄 제거했습니다.

**사이드카 egress 제거**

```yaml
# 제거 대상: sidecar egress kafka/* 블록 (17개 서비스 values)
# environments/prod/goti-*/values-aws.yaml — kafka egress 제거 (5개)
# environments/prod/goti-*/values-gcp.yaml — kafka egress 제거 (5개)
```

**NetworkPolicy 정리**

```bash
# 제거한 파일 및 규칙
infrastructure/prod/network-policies/kafka-netpol.yaml          # 삭제
infrastructure/prod/network-policies/goti-netpol.yaml           # kafka 규칙 제거
infrastructure/prod/network-policies/monitoring-netpol.yaml     # kafka egress 제거
infrastructure/prod/gcp/network-policies/goti-netpol.yaml       # kafka 규칙 제거
```

**ArgoCD 프로젝트 권한 제거**

```yaml
# gitops/prod/projects/infra-project.yaml
# kafka namespace 참조 및 Strimzi CRD 권한 제거
```

정리 완료 후 코드베이스에 활성 Kafka 참조는 남아있지 않습니다.
`infrastructure/prod/strimzi-operator/` 디렉토리는 전체 주석 처리 상태로 잔존하며 추후 삭제 가능합니다.

### GCP 대기열 서비스 구성 완료

Kafka 제거와 동시에 CDN 대기열 기반의 GCP 서비스 구성을 완료했습니다.

```text
신규 생성:
  environments/prod/goti-queue/values.yaml        — queue 정식 base values
  environments/prod/goti-queue/values-gcp.yaml    — queue GCP overlay
  environments/prod-gcp/goti-queue-gate/values.yaml

ApplicationSet 업데이트:
  gitops/prod-gcp/applicationsets/goti-msa-appset.yaml    — queue 추가
  gitops/prod-gcp/applicationsets/goti-infra-appset.yaml  — queue-gate 추가
```

---

## 후속 작업

Kafka 제거와 GCP 대기열 구성 이후 남은 작업은 다음과 같습니다.

- GCP Secret Manager에 queue/queue-gate 시크릿 등록 (Terraform)
- Artifact Registry에 queue/queue-gate 이미지 push
- queue(대기열 서비스) 이미지 태그 및 ECR 레포명 정식 리네이밍

---

## 📚 배운 점

- **절감액의 절대값보다 전환 비용 대비 ROI를 먼저 계산해야 합니다** — 연 $1,440 절감이 의미 없는 것은 아니지만, 10개+ 서비스 env 변경 공수와 배포 사고 리스크가 그것을 넘어설 수 있습니다
- **이미 결정이 번복된 컴포넌트는 즉시 제거하는 것이 낫습니다** — Kafka는 ADR 채택까지 마쳤지만 사용처가 사라진 순간 잔재가 부채가 되었습니다. 빠른 정리가 코드베이스 명확성을 유지합니다
- **Operator 성숙도는 선택 기준에 명시적으로 포함해야 합니다** — 2022년 마지막 릴리스 이후 유지보수가 없는 Redis Operator는 프로덕션 안정성을 보장하기 어렵습니다. 생태계의 활성도를 도구 선택 기준으로 삼아야 합니다
- **"쓰지 않는다"도 유효한 결정입니다** — 기술을 도입할지 말지를 판단할 때, 현재 사용하지 않는 컴포넌트를 계속 유지하는 비용(운영 부담, 인지 복잡도)을 명시적으로 계산해야 합니다
- **멀티클라우드 전환 시점은 기술 부채 정리의 기회입니다** — GCP 확장으로 전체 인프라를 재검토하면서 Kafka 잔재와 Redis 전략을 동시에 정리할 수 있었습니다. 변화의 시점을 정리 계기로 활용하는 것이 효과적입니다
