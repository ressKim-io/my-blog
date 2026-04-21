---
date: 2026-03-25
category: decision
project: Goti-k8s
tags: [redis, redis-exporter, monitoring, kind, external-service, networkpolicy]
---

# Redis Exporter 배포 방식 — Kind 내 Deployment + 호스트 IP 직접 지정

## Context
redis-deep-dive, war-room 대시보드에서 `redis_*` 메트릭 17건 전부 실패.
Redis는 Kind 외부 호스트 PC에 직접 설치 (`172.20.0.1:6379`, bind `0.0.0.0`, protected-mode off).
redis-exporter를 어디에, 어떻게 배포할지 결정 필요.

## Issue

### Option A: Kind 내 Deployment + 호스트 IP 직접 지정
- 장점: K8s 네이티브 (Deployment + Service + ServiceMonitor), ArgoCD GitOps 관리 가능, Alloy가 자동 스크래핑
- 단점: NetworkPolicy에 호스트 IP egress 추가 필요, 호스트 IP 하드코딩 (`172.20.0.1`)

### Option B: 호스트 PC에 직접 redis-exporter 설치 + Alloy 외부 스크래핑
- 장점: 네트워크 경로 단순 (localhost), NetworkPolicy 불필요
- 단점: GitOps 관리 불가, 호스트 PC 상태에 의존, Alloy 설정에 static target 추가 필요, ServiceMonitor 패턴과 불일치

### Option C: ExternalName Service + ServiceMonitor
- 장점: K8s Service 추상화 사용
- 단점: ExternalName은 IP 주소 직접 미지원 (CNAME만), 결국 Endpoints 수동 정의 필요 → Option A와 동일

## Action
**최종 선택: Option A**

선택 근거:
- 기존 kafka-exporter와 동일한 패턴 (Deployment + Service + ServiceMonitor)
- ArgoCD auto-sync로 GitOps 관리 — `infrastructure/dev/redis-exporter/` 디렉토리
- `goti-infrastructure` App of Apps가 `*application.yaml` 자동 재귀 탐색하므로 별도 등록 불필요
- `172.20.0.1`은 Kind Docker bridge gateway로 안정적 (Kind 재생성해도 동일)
- NetworkPolicy는 `172.20.0.1/32:6379`만 열어서 최소 권한 유지

## Result
- redis-exporter 1/1 Running, `redis_up=1`, `redis_connected_clients=252` 정상 수집
- validate-queries.sh에서 redis 관련 +15 PASS
- **제약**: 호스트 Redis IP 변경 시 Deployment env 수정 필요
- **Prod 전환 시**: Redis가 K8s 내부 Pod로 이동하면 `REDIS_ADDR`만 변경

## Related Files
- `Goti-k8s/infrastructure/dev/redis-exporter/deployment.yaml`
- `Goti-k8s/infrastructure/dev/redis-exporter/service.yaml`
- `Goti-k8s/infrastructure/dev/redis-exporter/servicemonitor.yaml`
- `Goti-k8s/infrastructure/dev/redis-exporter/application.yaml`
- `Goti-k8s/infrastructure/dev/network-policies/monitoring-netpol.yaml` — egress 규칙 추가
