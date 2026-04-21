---
date: 2026-04-06
category: decision
project: goti-team-controller
tags: [redis, kafka, finops, managed-service, multi-cloud]
---

# Redis 관리형 유지 + Kafka 프로젝트 완전 제거

## Context

대규모 티켓팅 플랫폼의 비용 및 인프라 최적화를 검토하면서 두 가지 결정이 필요했다:

1. **Redis**: GCP 확장 시 Memorystore 비용이 상대적으로 높아, K8s Pod로 자체 운영하여 비용을 절감할지 vs 관리형 서비스를 유지할지
2. **Kafka**: 이전에 도입 결정(ADR)까지 했던 Kafka(Strimzi 0.51 + KRaft 4.2.0)가 프로젝트에서 완전히 빠진 상태 — 코드베이스 잔재 정리 필요

## Issue

### Decision 1: Redis 운영 방식

#### Option A: K8s Pod 자체 운영 (Bitnami Sentinel)
- 장점: Multi-Cloud 비용 절감 (연 $3,600~$5,400), 동일 Helm chart로 AWS/GCP 통일, GitOps 통합
- 단점: Failover 직접 관리 (Sentinel 5-7분 소요 사례), 10개+ 서비스 env 변경 (REDIS_HOST, SSL off), 백업 CronJob 직접 구성, Operator 생태계 부실 (Spotahome/OpsTree 2022년 마지막 릴리스), Palark 장애 사례 (replica 확장 시 데이터 파괴)

#### Option B: 관리형 서비스 유지 (ElastiCache + Memorystore)
- 장점: 운영 부담 제로, Failover SLA 벤더 보장, 자동 백업/업그레이드, 엔지니어링 시간 절약
- 단점: Multi-Cloud 합산 비용 ~$120/월 (ElastiCache ~$50 + Memorystore Standard HA 1GB ~$70)

### Decision 2: Kafka 정리

Kafka는 CDN 대기열(수연) 최종 채택으로 프로젝트에서 완전 제거됨. 코드베이스에 sidecar egress, NetworkPolicy, infra-project 등에 잔재가 남아있었음.

## Action

### Redis: Option B (관리형 유지)

**선택 근거:**
- 현재 ElastiCache cache.t3.small이 월 ~$50으로 이미 저렴
- GCP Memorystore Standard HA 1GB도 월 ~$70 — Terraform에 이미 정의+apply 완료
- K8s 전환 시 절감액 연 $1,440~$2,280이지만, 10개+ 서비스 env 변경 작업량과 배포 사고 리스크가 절감액 대비 과도
- 15인 팀에서 Redis 운영 부담을 가져갈 필요 없음
- 10일도 안 띄울 환경에서 엔지니어링 시간 > 비용 절감

### Kafka: 전체 잔재 정리

- sidecar egress `kafka/*` 제거 (17개 서비스 values)
- NetworkPolicy kafka 규칙 제거 (goti-netpol, monitoring-netpol)
- kafka-netpol.yaml 삭제
- infra-project kafka namespace + Strimzi CRD 권한 제거
- 대기열은 CDN 캐싱(수연) + Redis 조합으로 확정

## Result

**Redis:**
- AWS: ElastiCache cache.t3.small Multi-AZ 유지 (~$50/월)
- GCP: Memorystore Standard HA 1GB 사용 (~$70/월, Terraform 이미 apply)
- 합계: ~$120/월, 추가 작업 없음

**Kafka:**
- Goti-k8s 코드베이스에서 활성 kafka 참조 전체 제거
- `infrastructure/prod/strimzi-operator/` 디렉토리는 전체 주석 처리 상태로 잔존 (삭제 가능)
- `infrastructure/dev/strimzi-operator/`도 잔존 (dev 무시 정책)

**후속 작업:**
- GCP queue/queue-gate values 생성 + ApplicationSet 추가 완료
- GCP Secret Manager에 queue/queue-gate 시크릿 등록 필요 (Terraform)
- Artifact Registry에 queue/queue-gate 이미지 push 필요
- queue-suyeon → queue 정식 리네이밍 (이미지 태그, ECR 레포명)

## Related Files

- `environments/prod/goti-queue/values.yaml` — queue 정식 base values (신규)
- `environments/prod/goti-queue/values-gcp.yaml` — queue GCP overlay (신규)
- `environments/prod-gcp/goti-queue-gate/values.yaml` — queue-gate GCP (신규)
- `gitops/prod-gcp/applicationsets/goti-msa-appset.yaml` — queue 추가
- `gitops/prod-gcp/applicationsets/goti-infra-appset.yaml` — queue-gate 추가
- `environments/prod/goti-*/values-aws.yaml` — kafka egress 제거 (5개)
- `environments/prod/goti-*/values-gcp.yaml` — kafka egress 제거 (5개)
- `infrastructure/prod/network-policies/goti-netpol.yaml` — kafka 규칙 제거
- `infrastructure/prod/network-policies/monitoring-netpol.yaml` — kafka egress 제거
- `infrastructure/prod/network-policies/kafka-netpol.yaml` — 삭제
- `infrastructure/prod/gcp/network-policies/goti-netpol.yaml` — kafka 규칙 제거
- `gitops/prod/projects/infra-project.yaml` — kafka namespace/Strimzi 권한 제거
