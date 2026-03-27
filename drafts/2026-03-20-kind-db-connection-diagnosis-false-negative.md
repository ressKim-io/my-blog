---
date: 2026-03-20
category: troubleshoot
project: Goti-k8s, goti-team-controller
tags: [kind, networkpolicy, istio, postgresql, oom, dev-tcp, bash-vs-sh, false-negative, debugging-methodology]
---

# Kind K8s 보안 설정 후 DB 연결 장애 — sh /dev/tcp 미지원으로 인한 오진과 장기 디버깅

## Context

- **환경**: Kind K8s 클러스터 (goti-dev, CP1 + Worker4), Ubuntu 호스트 PC에 PostgreSQL 17 직접 설치
- **작업**: Istio 보안 설정 (mTLS STRICT, deny-all AuthorizationPolicy, NetworkPolicy defense-in-depth) 적용 후 MSA 서비스 5개 (user, payment, ticketing, resale, stadium)의 DB 연결 확인
- **네트워크 경로**: Pod → Istio Sidecar (excludeOutboundPorts: 5432,6379) → Kind 노드 → Docker bridge (172.20.0.1) → 호스트 PostgreSQL
- **보안 스택**: NetworkPolicy (default-deny-all + allow 규칙) + Istio AuthorizationPolicy (deny-all + allow 규칙) + Istio Sidecar egress 제한 + PeerAuthentication STRICT mTLS

## Issue

보안 설정 배포 후 새로 생성된 Pod들이 CrashLoopBackOff 상태. 로그에서 DB 연결 실패 확인:

```
Caused by: org.postgresql.util.PSQLException: The connection attempt failed.
  at org.postgresql.core.v3.ConnectionFactoryImpl.openConnectionImpl(ConnectionFactoryImpl.java:385)
  ...
Caused by: java.net.SocketTimeoutException: Connect timed out
  at java.base/sun.nio.ch.NioSocketImpl.timedFinishConnect(Unknown Source)
  at org.postgresql.core.PGStream.createSocket(PGStream.java:261)
  at org.postgresql.core.v3.ConnectionFactoryImpl.tryConnect(ConnectionFactoryImpl.java:146)
```

재현 조건:
- 보안 설정 (NetworkPolicy + Istio AuthorizationPolicy) 적용 후 새로 생성된 Pod에서 발생
- 기존 Pod (보안 설정 전 생성)은 HikariCP 커넥션 풀의 기존 연결로 정상 동작 유지

## Action

### 진단 과정 (가설 → 검증 사이클)

총 **7개 가설**을 순차적으로 검증. 약 1.5시간 소요.

#### 가설 1: NetworkPolicy egress에 DB 포트 누락 → 부분적 맞음 (하지만 핵심 원인 아님)

`allow-goti-egress`에 5432/6379 포트가 없었음. ipBlock 규칙 추가:
```yaml
- to:
    - ipBlock:
        cidr: 172.20.0.1/32
  ports:
    - port: 5432
    - port: 6379
```
→ **적용 후에도 Pod에서 TCP 테스트 실패** → 다음 가설로 진행

#### 가설 2: Istio mTLS STRICT가 비-mesh DB 연결 차단 → 기각

`excludeOutboundPorts: "5432,6379"` annotation으로 Envoy sidecar 우회 설정 확인됨.
istio-proxy 컨테이너 (UID 1337, iptables redirect 면제)에서도 TCP 테스트 실패.
→ **Istio가 원인이 아님**

#### 가설 3: 호스트 방화벽(UFW) 차단 → 기각

UFW에 이미 `172.20.0.0/16 → 5432 ALLOW` 규칙 존재 확인.
추가로 `10.244.0.0/16` (Pod CIDR) iptables 규칙도 추가.
→ **적용 후에도 TCP 테스트 실패**

#### 가설 4: PostgreSQL listen_addresses / pg_hba.conf → 기각

`listen_addresses = '*'`, `0.0.0.0:5432` 바인딩 확인.
pg_hba.conf에 `172.20.0.0/16` 및 `172.0.0.0/8` 허용 확인.
→ **설정 문제 없음**

#### 가설 5: Kind 노드 → 호스트 라우팅 / MASQUERADE 문제 → 기각

Kind 노드에서 직접 테스트: `docker exec goti-dev-worker4 bash -c "echo > /dev/tcp/172.20.0.1/5432"` → **OK**
KIND-MASQ-AGENT 체인에서 Pod 트래픽 masquerade 정상 확인.
→ **Kind 노드 레벨 라우팅은 정상**

#### 가설 6: NetworkPolicy 자체가 모든 TCP egress 차단 (kindnet 구현 이슈) → 기각

NetworkPolicy 전체 삭제 후에도 TCP 테스트 실패.
→ **NetworkPolicy가 근본 원인이 아님**

#### 가설 7 (최종): TCP 테스트 방법 자체가 잘못됨 → **확정 (Root Cause)**

모든 이전 테스트에서 `sh -c 'cat < /dev/tcp/172.20.0.1/5432'` 사용.
`/dev/tcp`는 **bash 전용 기능**이며, 컨테이너의 `sh` (dash/busybox)에서는 지원하지 않음.
→ 모든 TCP 테스트가 **false negative** (네트워크와 무관하게 항상 FAIL)

검증:
```bash
# sh (dash) — 항상 실패 (false negative)
sh -c 'cat < /dev/tcp/172.20.0.1/5432' → FAIL

# bash — 정상 작동
bash -c 'echo > /dev/tcp/172.20.0.1/5432' → OK
```

### 근본 원인 (Root Cause) — 2개

**1. 진단 도구 오류 (Primary)**
- `sh`에서 `/dev/tcp` 미지원으로 모든 TCP 연결 테스트가 false negative
- 이로 인해 정상 작동하는 DB 연결을 장애로 오판
- 6개 가설을 불필요하게 검증하며 1.5시간 낭비

**2. Pod CrashLoopBackOff의 실제 원인: OOMKilled**
- payment/resale/stadium Pod의 memory limit 512Mi가 OTel Java agent + Spring Boot 조합에 부족
- `lastState.terminated.reason: OOMKilled` 확인
- DB 연결 실패 로그는 OOM 직전의 메모리 부족 상태에서 발생한 **증상(symptom)**이었으며, 근본 원인(cause)은 OOM

### 적용한 수정

**1. Memory limit 증가** (OOM 해결)
- `environments/dev/goti-payment/values.yaml`: 256Mi/512Mi → 384Mi/768Mi
- `environments/dev/goti-resale/values.yaml`: 256Mi/512Mi → 384Mi/768Mi
- `environments/dev/goti-stadium/values.yaml`: 256Mi/512Mi → 384Mi/768Mi
- user/ticketing은 이미 384Mi/768Mi로 설정되어 있어 변경 불필요

**2. NetworkPolicy ipBlock 규칙 추가** (방어적 조치)
- `infrastructure/dev/network-policies/goti-netpol.yaml`: 172.20.0.1/32에 대한 5432/6379 egress 허용
- 현재 Envoy 경유 경로로 DB 연결이 작동하지만, excludeOutboundPorts 직접 연결 경로를 위한 안전망

**3. Terraform: sslmode=disable 제거** (불필요한 설정 정리)
- `terraform/dev/terraform.tfvars`: DATASOURCE_URL에서 `?sslmode=disable` 제거
- PostgreSQL `ssl = on` 상태에서 드라이버 기본값 `prefer`로 충분

## Result

### 수정 후 검증
- 모든 Pod 2/2 Running, Ready: true 확인
- `bash -c 'echo > /dev/tcp/172.20.0.1/5432'` → DB_OK
- `bash -c 'echo > /dev/tcp/172.20.0.1/6379'` → REDIS_OK
- NetworkPolicy 원복 (default-deny-all + allow 규칙) 후에도 연결 정상
- tcpdump로 Kind bridge에서 DB 트래픽 정상 흐름 확인 (masquerade 작동)

### 회귀 테스트
- 추가하지 않음 (인프라 설정 이슈, 코드 변경 없음)
- 향후 e2e 테스트 스크립트(`scripts/e2e-api-test.sh`)에서 DB 연결 검증 포함 검토

### 재발 방지책

**1. TCP 연결 테스트 시 반드시 bash 사용**
```bash
# WRONG: sh에서 /dev/tcp 미지원 → false negative
sh -c 'cat < /dev/tcp/HOST/PORT'

# CORRECT: bash 명시
bash -c 'echo > /dev/tcp/HOST/PORT'

# BETTER: curl 또는 nc 사용 (셸 의존성 없음)
curl -s --connect-timeout 3 telnet://HOST:PORT
```

**2. OOM 조기 감지**
- Pod 재시작 시 `kubectl describe pod` → `lastState.terminated.reason` 확인 우선
- CrashLoopBackOff = DB 장애로 단정하지 말고, OOMKilled/Error/시그널 등 종료 사유부터 확인

**3. MSA 서비스 메모리 기준**
- OTel Java agent + Spring Boot 조합: 최소 768Mi limit 권장
- `MaxRAMPercentage=60.0` 설정으로 JVM이 limit의 60% 사용 → 768Mi * 0.6 = ~460Mi heap

## 교훈 (Lessons Learned)

### 진단 프로세스 오류
이번 트러블슈팅에서 가장 큰 실수는 **진단 도구 자체를 검증하지 않은 것**. `sh -c 'cat < /dev/tcp/...'` 테스트가 항상 FAIL을 반환했지만, "네트워크가 문제다"라는 가설에 매몰되어 테스트 도구의 정확성을 의심하지 않았음.

디버깅 원칙: **계측 도구(instrumentation)가 정확한지 먼저 검증하라.** 잘못된 측정 → 잘못된 가설 → 잘못된 수정 → 시간 낭비.

### Pod 종료 사유 확인 우선
CrashLoopBackOff 로그에서 DB 연결 실패를 보고 "DB 연결 문제"로 단정했지만, `kubectl describe pod`의 `lastState.terminated.reason: OOMKilled`를 먼저 확인했어야 했음. **증상(로그)보다 원인(종료 사유)을 먼저 확인.**

### 불필요한 변경 범위
NetworkPolicy를 전체 삭제하고 재생성하는 등 blast radius가 큰 작업을 수행함. 정상 작동하는 시스템을 불필요하게 변경하면 새로운 문제를 만들 수 있음.

## Timeline

| 시간 | 작업 | 결과 |
|------|------|------|
| 11:00 | 문제 인식, 3개 레포 병렬 탐색 (K8s/Server/Kind) | NetworkPolicy egress 누락 발견 |
| 11:10 | NetworkPolicy ipBlock 규칙 추가, Terraform sslmode=disable 제거 | 코드 수정 완료, push |
| 11:17 | PostgreSQL ssl=on 확인, systemctl reload | 호스트 DB 설정 정상 |
| 11:30 | ArgoCD sync → Pod TCP 테스트 실패 | `sh /dev/tcp` false negative (미인지) |
| 11:32 | UFW/iptables 규칙 추가 | 여전히 실패 |
| 11:33 | Kind 노드 masquerade/FORWARD 체인 분석 | 정상 확인 |
| 11:35 | Kind 노드에서 직접 DB 연결 → OK | Pod 레벨 문제로 범위 축소 |
| 11:38 | NetworkPolicy 전체 삭제 → 여전히 실패 | NetworkPolicy 원인 아님 확정 |
| 11:41 | ArgoCD sync 시도 → token expired | kubectl 직접 적용으로 전환 |
| 11:45 | tcpdump → 기존 Pod의 DB 트래픽 정상 확인 | 새 Pod 트래픽만 미도착 |
| 11:47 | Pod annotation/istio-init 분석 | excludeOutboundPorts 정상 적용 확인 |
| 11:48 | **bash -c 'echo > /dev/tcp' 테스트 → DB_OK** | **Root cause 발견: sh /dev/tcp 미지원** |
| 11:49 | Pod describe → lastState: OOMKilled 확인 | **실제 원인: OOM (메모리 부족)** |
| 11:50 | NetworkPolicy 원복, memory limit 증가 | 최종 수정 완료 |

## Related Files

### 수정된 파일
- `Goti-k8s/infrastructure/dev/network-policies/goti-netpol.yaml` — ipBlock egress 규칙 추가
- `Goti-k8s/environments/dev/goti-payment/values.yaml` — memory 256Mi/512Mi → 384Mi/768Mi
- `Goti-k8s/environments/dev/goti-resale/values.yaml` — memory 256Mi/512Mi → 384Mi/768Mi
- `Goti-k8s/environments/dev/goti-stadium/values.yaml` — memory 256Mi/512Mi → 384Mi/768Mi
- `goti-terraform/terraform/dev/terraform.tfvars` — sslmode=disable 제거

### 참조 파일
- `Goti-k8s/infrastructure/dev/istio/mesh-policy/templates/mesh-wide-mtls.yaml` — STRICT mTLS
- `Goti-k8s/infrastructure/dev/istio/goti-policy/templates/deny-all.yaml` — deny-all AuthorizationPolicy
- `Goti-k8s/charts/goti-common/templates/_deployment.tpl` — Pod template
- `Goti-k8s/kind/cluster-config.yaml` — Kind 클러스터 설정
