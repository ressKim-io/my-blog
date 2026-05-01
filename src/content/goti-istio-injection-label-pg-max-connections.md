---
title: "Istio sidecar 미주입 + PostgreSQL 연결 고갈 — 복합 트러블슈팅"
excerpt: "namespace의 istio-injection 라벨이 조작 중 유실되어 신규 Pod에 sidecar가 주입되지 않고, replica 증가 중 PG max_connections 100 한계에 도달한 복합 장애를 진단하고 해결한 기록"
category: istio
tags:
  - go-ti
  - Istio
  - PostgreSQL
  - Sidecar-Injection
  - NetworkPolicy
  - troubleshooting
series:
  name: "goti-istio-ops"
  order: 1
date: "2026-03-20"
---

## 한 줄 요약

> goti namespace의 `istio-injection=enabled` 라벨이 NetworkPolicy 디버깅 도중 유실되어 신규 Pod 전체에 sidecar가 주입되지 않았고, 동시에 replica 증가 과정에서 PG max_connections=100을 초과했습니다. 두 문제를 독립적으로 진단해 각각 복구했습니다

---

## 배경: go-ti Istio 운영 단계

go-ti 프로젝트는 Istio 1.29.0을 **sidecar 모드**로 운영합니다.
MSA 5개 서비스(user, ticketing, payment, resale, stadium) 전체를 mesh에 탑재하며, dev(Kind 클러스터)와 prod(EKS/GKE) 양쪽에 독립 mesh를 구성합니다.

운영 범위는 단계별로 심화했습니다.

초기에는 VirtualService 라우팅만 사용하는 "Istio 껍데기" 상태였습니다.
Phase 1에서 mTLS, AuthorizationPolicy, RequestAuthentication(JWT)을 적용했고, Phase 2에서 DestinationRule CB·retry·timeout·ServiceEntry를 추가했습니다.
Phase 3에서 메트릭 수집과 Kiali 연동까지 확장하는 순서로 진행했습니다.

이 글은 Phase 1 보안 설정을 적용하는 과정에서 발생한 **Istio injection 누락 + PG max_connections 고갈** 복합 트러블을 기록합니다.

---

## 🔥 문제: sidecar가 없는 Pod + DB 연결 고갈

### 상황

- **환경**: Kind K8s 클러스터(goti-dev), goti namespace에 5개 MSA 서비스 배포
- **작업**: Istio 보안 설정 적용 후 Pod replica 1 → 2 증가 및 memory limit 조정
- **직전 작업**: NetworkPolicy 디버깅 중 goti namespace를 `kubectl` 직접 조작 — 이 과정에서 `istio-injection=enabled` 라벨 유실 추정

### Issue 1: Istio sidecar 미주입

신규로 생성되는 Pod가 모두 `1/1`로 뜨기 시작했습니다.

```text
# 정상 Pod (sidecar 포함)
goti-ticketing-dev-76969dd5bf-fcw25   2/2   Running

# 비정상 Pod (sidecar 미주입)
goti-user-dev-595c796487-frq7c        1/1   Running
goti-payment-dev-6585dffdfb-zcngn     1/1   Running
```

Pod spec에는 `sidecar.istio.io/inject: "true"` annotation이 분명히 존재했습니다.
그러나 initContainers를 확인하면 `istio-init`이 없고 `opentelemetry-auto-instrumentation-java`만 남아있었습니다.

### Issue 2: PostgreSQL max_connections 고갈

replica 증가 + rollout restart를 실행하자 기존 Pod(연결 유지)와 신규 Pod(연결 시도)가 동시에 실행되며 DB 연결이 폭증했습니다.
PostgreSQL 기본값 `max_connections=100`에 도달하면서 아래 에러가 발생했습니다.

```text
Caused by: org.postgresql.util.PSQLException: 치명적오류: 남은 연결 슬롯은 SUPERUSER 속성을 가진 롤용으로 남겨 놓았음
  at org.postgresql.core.v3.QueryExecutorImpl.receiveErrorResponse(QueryExecutorImpl.java:2846)
  at org.postgresql.core.v3.QueryExecutorImpl.readStartupMessages(QueryExecutorImpl.java:2971)
```

재현 조건을 정리하면 다음과 같습니다.

- 5개 서비스 × 2 replicas × rolling update(기존 + 신규) = 최대 20 Pod 동시 실행
- HikariCP `idle-timeout: 5000ms`, `max-lifetime: 420000ms` — idle 연결이 빠르게 해제되지 않음
- `pg_stat_activity` 확인 결과 idle 연결 97개 점유 상태

---

## 🤔 원인

### Issue 1 근본 원인: namespace 라벨과 MutatingWebhook의 관계

namespace 라벨 상태를 확인했습니다.

```yaml
# 유실 후 상태
metadata:
  labels:
    kubernetes.io/metadata.name: goti
    # istio-injection=enabled 없음
```

Istio sidecar 주입은 **MutatingWebhookConfiguration**이 담당합니다.
이 webhook은 `namespaceSelector`를 기준으로 동작 여부를 결정합니다.
namespace에 `istio-injection=enabled` 라벨이 없으면, webhook이 해당 namespace의 Pod 생성 이벤트를 가로채지 않습니다.

핵심은 Pod-level annotation(`sidecar.istio.io/inject: "true"`)만으로는 부족하다는 점입니다.
**namespace 라벨이 webhook의 `namespaceSelector`에 매칭되어야 주입이 시작**됩니다.
NetworkPolicy 디버깅 중 `kubectl label` 직접 조작 또는 ArgoCD sync 과정에서 이 라벨이 제거된 것으로 추정됩니다.

### Issue 2 근본 원인: rolling update 중 연결 수 계산 오류

문제의 흐름을 단계별로 살펴보겠습니다.

1. replica 1 → 2 변경 + `rollout restart` 실행
2. 기존 Pod(연결 유지)와 신규 Pod(연결 시도)가 동시에 실행
3. HikariCP idle 연결이 `idle-timeout: 5000ms` 기준으로 해제되지만, 기존 Pod의 활성 연결이 쌓임
4. 5개 서비스 × 2 replicas × HikariCP maximumPoolSize 기본값 10 = 최대 100 연결
5. rolling update 중 일시적으로 2배인 200 연결 시도 → `max_connections=100` 초과

PostgreSQL 기본 `max_connections=100`은 MSA 5개 서비스 × 2 replicas 환경에서 rolling update 여유를 포함하면 처음부터 부족한 설정이었습니다.

---

## ✅ 해결

### Issue 1: namespace 라벨 복구 후 rollout restart

```bash
# namespace 라벨 복구
kubectl label namespace goti istio-injection=enabled

# 전체 Deployment 재시작 (sidecar 재주입)
kubectl rollout restart deployment -n goti
```

이후 신규 Pod는 모두 `2/2 Running`으로 확인됐습니다.
`security.istio.io/tlsMode=istio` 라벨도 정상 부여됐습니다.

### Issue 2: idle 연결 강제 종료 + max_connections 증가

먼저 현재 점유 중인 idle 연결을 강제 종료했습니다.

```bash
# idle 연결 97개 일괄 종료
sudo -u postgres psql -c "
  SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
  WHERE state = 'idle'
    AND usename != 'postgres';
"
```

다음으로 max_connections를 200으로 증가했습니다.

```bash
sudo -u postgres psql -c "ALTER SYSTEM SET max_connections = 200;"
sudo systemctl restart postgresql
```

**max_connections=200 산정 근거**는 다음과 같습니다

1. 서비스 5개 × replica 2 = **10 Pod**
2. HikariCP `maximumPoolSize` 기본값 = 10 (Pod당) → **최대 100 연결**
3. rolling update 시 일시적 2배 여유 → **200**
4. `max_connections = 200` (superuser 예약 3개 제외 시 197개 사용 가능)

### 수정 후 검증

```bash
# DB 연결 정상 확인
bash -c 'echo > /dev/tcp/172.20.0.1/5432'
# → 연결 성공

# sidecar 주입 확인
kubectl get pods -n goti
# → 5개 서비스 모두 2/2 Running × 2 replicas
```

이전에 sidecar 없이 실행 중이던 `1/1` Pod들은 rolling update로 자동 교체됐습니다.

---

## 📚 배운 점

### 1. Pod annotation만으로 sidecar가 주입되지 않는다

`sidecar.istio.io/inject: "true"` annotation은 **webhook이 동작한다는 전제** 아래에서만 유효합니다.
webhook의 `namespaceSelector` 매칭 기준은 namespace 라벨입니다.
namespace 라벨이 없으면 webhook 자체가 개입하지 않으므로, annotation은 무의미해집니다.

Istio 주입 문제를 디버깅할 때 가장 먼저 확인해야 할 것은 Pod spec이 아니라 **namespace 라벨**입니다.

### 2. namespace 라벨은 GitOps로 관리합니다

`kubectl` 직접 조작은 라벨을 언제든 유실시킬 수 있습니다.
`istio-injection=enabled` 라벨은 Helm chart 또는 ArgoCD Application 소스에 명시적으로 선언해야 합니다.

```yaml
# 예: Helm chart의 namespace 정의
apiVersion: v1
kind: Namespace
metadata:
  name: goti
  labels:
    istio-injection: enabled  # GitOps로 관리
```

ArgoCD가 sync할 때마다 이 상태가 보장됩니다.

### 3. replica 변경 전 DB 연결 수를 사전 계산합니다

rolling update 중에는 기존 Pod와 신규 Pod가 동시에 실행됩니다.
최대 연결 수는 `(서비스 수 × replica 수 × HikariCP maxPoolSize) × 2(rolling 여유) + 관리용`으로 계산합니다.

```text
공식: (N_service × N_replica × maxPoolSize) × 2 + 10
현재: (5 × 2 × 10) × 2 + 10 = 210
적용: max_connections = 200 (여유 충분)
```

replica를 변경하기 전에 `pg_stat_activity`로 현재 연결 수를 확인하는 습관이 필요합니다.

### 4. HikariCP maximumPoolSize 기본값은 MSA에 크다

HikariCP `maximumPoolSize` 기본값은 10입니다.
서비스가 5개이고 replica가 2라면, 기본값만으로 최대 100 연결이 생성됩니다.
서비스별로 `maximumPoolSize=5`, `minimumIdle=2`로 제한하면 전체 연결 수를 절반으로 줄일 수 있습니다.

### 5. 복합 장애는 각 원인을 독립적으로 격리합니다

이번 트러블은 두 개의 독립적인 원인(namespace 라벨 유실, DB 연결 한계)이 동시에 발생했습니다.
한 문제를 해결하는 도중 다른 문제가 섞이면 진단이 어려워집니다.
**각 이슈를 하나씩 격리하고, 수정 후 개별 검증**하는 순서가 복합 장애 해결의 기본입니다.
