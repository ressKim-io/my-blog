---
date: 2026-03-20
category: troubleshoot
project: Goti-k8s
tags: [istio, sidecar-injection, namespace-label, postgresql, max_connections, connection-pool, hikaricp, replica-scaling]
---

# Istio sidecar injection 누락 + PostgreSQL max_connections 고갈

## Context

- **환경**: Kind K8s 클러스터 (goti-dev), goti namespace에 5개 MSA 서비스 배포
- **작업**: Istio 보안 설정 적용 후 Pod replica를 1 → 2로 증가, memory limit 조정
- **배경**: 동일 세션에서 NetworkPolicy 디버깅 과정 중 goti namespace의 `istio-injection=enabled` 라벨이 제거됨 (kubectl 직접 조작 또는 ArgoCD sync 과정에서 유실 추정)

## Issue

### Issue 1: Istio sidecar injection 누락

Pod에 `sidecar.istio.io/inject: "true"` annotation이 있지만 istio-init, istio-proxy 컨테이너가 주입되지 않음.
새로 생성되는 Pod이 모두 `1/1` (sidecar 없음)로 뜸.

```
# 정상 Pod (sidecar 있음)
goti-ticketing-dev-76969dd5bf-fcw25   2/2   Running   ← istio-proxy 포함

# 비정상 Pod (sidecar 없음)
goti-user-dev-595c796487-frq7c        1/1   Running   ← sidecar 미주입
goti-payment-dev-6585dffdfb-zcngn     1/1   Running   ← sidecar 미주입
```

재현 조건: goti namespace에 `istio-injection=enabled` 라벨이 없는 상태에서 Pod 생성

### Issue 2: PostgreSQL max_connections 고갈

replica 2 + rollout restart로 기존 Pod + 새 Pod이 동시에 실행되면서 DB 연결 폭증.
PostgreSQL 기본 `max_connections=100`에 도달.

```
Caused by: org.postgresql.util.PSQLException: 치명적오류: 남은 연결 슬롯은 SUPERUSER 속성을 가진 롤용으로 남겨 놓았음
  at org.postgresql.core.v3.QueryExecutorImpl.receiveErrorResponse(QueryExecutorImpl.java:2846)
  at org.postgresql.core.v3.QueryExecutorImpl.readStartupMessages(QueryExecutorImpl.java:2971)
```

재현 조건:
- 5개 서비스 × 2 replicas × rolling update (old + new) = 최대 20 Pod 동시 실행
- HikariCP `idle-timeout: 5000ms`, `max-lifetime: 420000ms` → idle 연결이 빠르게 해제되지 않음
- PostgreSQL max_connections=100 → 97개 idle 연결 점유 상태

## Action

### Issue 1 진단

1. Pod spec 확인 → `sidecar.istio.io/inject: "true"` annotation 존재 확인
2. initContainers 확인 → istio-init 없음, opentelemetry-auto-instrumentation-java만 존재
3. **goti namespace 라벨 확인** → `istio-injection=enabled` 라벨 누락 발견

```yaml
# 현재 상태 (라벨 누락)
metadata:
  labels:
    kubernetes.io/metadata.name: goti
    # istio-injection=enabled 없음!
```

**근본 원인**: namespace에 `istio-injection=enabled` 라벨이 없으면 Istio MutatingWebhookConfiguration이 해당 namespace의 Pod 생성 이벤트를 가로채지 않음. Pod-level annotation(`sidecar.istio.io/inject: "true"`)만으로는 부족 — namespace 라벨이 webhook의 `namespaceSelector`에 매칭되어야 함.

**적용한 수정**:
```bash
kubectl label namespace goti istio-injection=enabled
kubectl rollout restart deployment -n goti
```

### Issue 2 진단

1. rollout restart 후 새 Pod들이 CrashLoopBackOff → 로그 확인
2. `남은 연결 슬롯은 SUPERUSER 속성을 가진 롤용으로 남겨 놓았음` 에러 확인
3. 일반 유저로 psql 접속 시도 → 동일 에러 (연결 불가)
4. `pg_stat_activity` 확인 → 97개 idle 연결 점유 확인

**근본 원인**:
- replica 1 → 2 증가 + rollout restart = 기존 Pod(연결 유지) + 새 Pod(연결 시도) 동시 실행
- HikariCP 기본 설정에서 idle 연결이 5초(`idle-timeout`)에 해제되지만, 기존 Pod들의 활성 연결이 쌓여 max_connections 도달
- PostgreSQL 기본 `max_connections=100`은 MSA 5개 서비스 × 2 replicas에 부족

**적용한 수정**:
```bash
# 1. idle 연결 강제 종료
sudo -u postgres psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND usename != 'postgres';"
# → 97개 연결 종료

# 2. max_connections 증가
sudo -u postgres psql -c "ALTER SYSTEM SET max_connections = 200;"
sudo systemctl restart postgresql
```

### max_connections 산정 근거

```
서비스 5개 × replica 2 = 10 Pod
HikariCP maximumPoolSize 기본값 = 10 (per Pod)
→ 최대 100 연결 + rolling update 시 일시적 2배 = 200
→ max_connections = 200 (superuser 예약 3개 제외 = 197개 사용 가능)
```

## Result

### 수정 후 검증
- 5개 서비스 모두 **2/2 Running × 2 replicas** 달성
- Istio sidecar 정상 주입 (`security.istio.io/tlsMode=istio` 라벨 확인)
- DB 연결 정상 (`bash -c 'echo > /dev/tcp/172.20.0.1/5432'` → OK)
- 이전 sidecar 없는 Pod(1/1)들이 rolling update로 자동 교체됨

### 회귀 테스트
- 추가하지 않음 (인프라 설정 이슈)

### 재발 방지책

**1. Namespace 라벨을 GitOps로 관리**
- `istio-injection=enabled` 라벨이 Helm chart 또는 ArgoCD Application에서 관리되어야 함
- kubectl 직접 조작으로 라벨이 유실될 수 있으므로, 소스 코드에 명시적으로 포함

**2. PostgreSQL max_connections 사전 계획**
```
max_connections = (서비스 수 × replica 수 × HikariCP maxPoolSize) × 2 (rolling update 여유) + 10 (관리용)
현재: (5 × 2 × 10) × 2 + 10 = 210 → 200으로 설정 (충분)
```

**3. HikariCP 연결 수 제한 검토**
- 현재 `maximumPoolSize` 기본값(10) 사용 중
- MSA에서는 서비스별로 `maximumPoolSize=5` 등으로 제한하여 전체 연결 수 관리 필요
- `minimumIdle=2` 설정으로 idle 연결 최소화 가능

**4. Replica 증가 시 DB 연결 영향 체크**
- replica 수 변경 전 `(현재 연결 수 + 추가될 연결 수) < max_connections` 확인
- `pg_stat_activity` 모니터링 대시보드 활용

## Related Files
- `Goti-k8s/environments/dev/goti-*/values.yaml` — replicaCount: 2, memory limit 증가
- `Goti-k8s/infrastructure/dev/network-policies/goti-netpol.yaml` — NetworkPolicy 원복
- `/etc/postgresql/17/main/postgresql.conf` — max_connections = 200 (호스트 PC)
