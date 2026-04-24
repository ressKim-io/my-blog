---
title: "PgBouncer 도입 + 1차 3000 VU — 쓰러지고 나서야 보인 것들"
excerpt: "PgBouncer session 모드를 실제 배포하면서 마주친 ConfigMap 문법 오류·ArgoCD 캐시 교착·prepared statement 4단 시행착오, 그리고 3000 VU 부하테스트에서 ticket_success 15.6%가 나온 진짜 원인을 기록합니다"
category: challenge
tags:
  - go-ti
  - PgBouncer
  - PostgreSQL
  - LoadTest
  - Rollout
series:
  name: "goti-pgbouncer"
  order: 2
date: "2026-04-14"
---

## 한 줄 요약

> ADR에서 session 모드를 채택한 뒤 실제 배포하는 과정에서 5개 트러블이 연달아 터졌고, 1차 3000 VU 부하테스트에서 ticket_success 15.6%라는 초라한 결과가 나왔습니다. 진짜 병목은 DB 연결 과부하가 아니라 ANALYZE 미실행으로 인한 통계 부재였습니다.

## 배경

go-ti 프로젝트는 3000 VU 부하테스트를 목표로 DB 연결 구조를 개선해왔습니다.

이전 테스트에서 `ticket_success 15.6%`, `order_creation p95 60s timeout`이라는 결과가 나왔습니다. 6 replica × app pool이 RDS 커넥션 한계(~150~200)를 쉽게 초과한다는 것이 첫 번째 가설이었습니다. 팀은 [ADR(order 1)](goti-adr-pgbouncer-pool-mode)에서 PgBouncer session 모드 채택을 결정했습니다.

이 글은 그 결정을 실제로 적용하면서 **무엇이 쓰러졌고 무엇을 발견했는지**의 기록입니다. "왜 session 모드를 골랐는가"는 ADR(order 1)을 참조하시기 바랍니다.

---

## 🔥 트러블 1: ConfigMap 문법 오류 — `options=` 키 미지원

### 증상

PgBouncer Pod를 배포하자마자 다음 에러와 함께 기동 실패가 발생했습니다.

```text
FATAL: unrecognized connection parameter: options
FATAL: cannot load config
```

### 원인

`[databases]` 섹션에 `options=-c search_path=...` 형태로 search_path를 설정하려 했는데, PgBouncer 1.23은 이 키를 지원하지 않습니다.

공식 지원 키는 `dbname`, `host`, `port`, `user`, `password`, `pool_size`, `pool_mode`, `connect_query` 등으로 한정됩니다.

### 해결

`options=` 대신 `connect_query`로 대체했습니다.

```ini
[databases]
goti_ticketing = host=... dbname=goti_ticketing
  connect_query='SET search_path TO ticketing_service'
```

`connect_query`는 클라이언트 연결이 맺어질 때마다 실행되는 SQL로, search_path 주입에 적합합니다.

함께 발견한 부수 문제도 수정했습니다. 기존 `server_reset_query = DISCARD ALL` 설정이 search_path까지 초기화하고 있었습니다. PgBouncer가 서버 연결을 풀에 반납할 때 DISCARD ALL을 실행하면 SET한 search_path가 날아갑니다.

```ini
# 변경 전
server_reset_query = DISCARD ALL

# 변경 후 — prepared statement 잔류 방지에 충분
server_reset_query = DISCARD PLANS
```

SimpleProtocol을 사용 중이라 prepared statement 잔류 위험이 없으므로 `DISCARD PLANS`로 약화해도 충분합니다.

---

## 🔥 트러블 2: ArgoCD sync stuck — in-memory 캐시 stale

### 증상

Git push 이후 ArgoCD가 이전 revision에 멈춰 있었습니다.

```text
Already attempted sync
```

Deployment는 OutOfSync 상태인데 sync task 목록에서 빠져 있었습니다.

### 원인

`argocd-application-controller`의 in-memory 캐시가 stale한 상태였습니다. repo-server가 최신 revision을 인식해도 application-controller 캐시가 갱신되지 않으면 sync가 트리거되지 않습니다.

### 해결

```bash
$ kubectl delete pod argocd-application-controller-0 -n argocd
```

pod 삭제 후 hard refresh를 실행하면 캐시가 초기화되면서 sync가 재개됩니다.

repo-server만 재시작해서는 controller 캐시가 따로 동작하기 때문에 해소되지 않습니다. application-controller pod도 함께 재시작해야 합니다.

---

## 🔥 트러블 3: pgbouncer-exporter 셋업 — 3단계 진행

pgbouncer-exporter를 붙이는 과정에서 이미지 버전·DSN 파싱·Prometheus scrape 인증 세 가지가 순서대로 막혔습니다.

### 단계 1: 이미지 버전 없음

`v0.10.4`가 Docker Hub에 존재하지 않았습니다. `v0.12.0`으로 교체했습니다.

### 단계 2: DSN URL 특수문자 파싱 실패

DB 비밀번호에 `|`, `%`, `^`, `#` 같은 특수문자가 포함되어 있어 DSN 파싱이 실패했습니다.

```text
postgres://goti:-bh||...  → parse error: invalid URL
```

특수문자를 포함한 비밀번호를 DSN URL에 그대로 넣으면 URL 파서가 구분자로 오해합니다.

URL 인코딩된 비밀번호를 SSM에 별도 파라미터로 관리하는 방식으로 해결했습니다.

```bash
# SSM 파라미터 두 개 운영
/prod/pgbouncer/db-user-password        # 원본 (앱 접속용)
/prod/pgbouncer/db-user-password-urlenc # urlencode 적용 사본 (exporter DSN용)
```

Terraform 쪽도 동기화했습니다.

```hcl
# Terraform — exporter용 파라미터
resource "aws_ssm_parameter" "pgbouncer_password_urlenc" {
  value = urlencode(var.pgbouncer_rds_password)
}
```

ExternalSecret이 urlenc 파라미터를 자동으로 fetch해서 exporter의 DSN에 주입합니다.

### 단계 3: Prometheus scrape 403 → 503 → 200 해소

Ambient 모드 환경에서 9127 포트 scrape 설정이 단계적으로 실패했습니다.

처음 설정에서 `excludeInboundPorts: "5432,9127"`을 적용했는데, ztunnel mTLS와 sidecar 우회 plain 포트가 충돌해 503이 발생했습니다.

9127만 sidecar를 통과하도록 변경하니 403으로 바뀌었습니다. mTLS는 성립했지만 AuthorizationPolicy에 9127이 누락되어 있었습니다.

```yaml
# AuthorizationPolicy에 9127 추가
- ports:
    - number: 9127
```

이 수정 이후 200 응답을 확인했습니다.

---

## 🔥 트러블 4: PgBouncerCompat 코드 누락 — 4단 시행착오

prepared statement 오류가 가장 오래 걸렸습니다.

### 증상

```text
prepared statement "stmtcache_xxx" already exists
prepared statement "stmtcache_xxx" does not exist
```

### 원인

모든 v2 서비스의 `cmd/*/main.go`가 구버전 `database.NewPool`을 호출하고 있었습니다. `NewPools`(replica 전용)에만 `PgBouncerCompat` 처리 코드가 있었고, `NewPool`에는 누락되어 있었습니다. 환경변수는 정상적으로 주입된 상태였기 때문에 발견이 늦었습니다.

### 🧭 선택지 비교

`NewPool`에 PgBouncer 호환 모드를 추가하는 방법으로 4가지를 시도했습니다.

**진화 1 — SimpleProtocol 모드**

```go
config.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
```

`[]uuid.UUID` 배열 인코딩 실패가 발생했습니다.

```text
cannot find encode plan, OID 0
```

pgx가 배열 타입의 OID를 결정하지 못하는 문제입니다.

**진화 2 — Exec 모드**

```go
config.DefaultQueryExecMode = pgx.QueryExecModeExec
```

동일한 `OID 0` 에러가 발생했습니다. Exec 모드도 커스텀 타입 인코딩을 해결하지 못했습니다.

**진화 3 — DescribeExec 모드**

```go
config.DefaultQueryExecMode = pgx.QueryExecModeDescribeExec
```

```text
bind message supplies 1 parameters, but prepared statement requires 2
```

sqlc가 생성한 쿼리와 파라미터 수가 맞지 않는 충돌이 발생했습니다.

**진화 4 — pool_mode session 회귀**

코드 변경 없이 PgBouncer 설정 자체를 변경했습니다.

```ini
[databases]
; 변경 전
; goti_ticketing = ... pool_mode=transaction

; 변경 후
goti_ticketing = ... pool_mode=session
```

session 모드에서는 클라이언트가 서버 연결을 세션 동안 독점합니다. prepared statement, 배열 타입, sqlc 생성 쿼리가 모두 문제없이 동작합니다.

transaction 모드 + Go pgx 완전 호환 구현은 별도 PR로 유예했습니다. 옵션은 `pgx custom type registry + DescribeExec 조합` 또는 `pgx를 Exec + 명시 OID 매핑` 방식입니다.

session 모드는 client ↔ server 연결이 1:1 매핑되므로 `pool_size`를 충분히 크게 설정해야 합니다.

---

## 🔥 트러블 5: Mimir Ingester OOM

부하테스트 준비 중 Mimir Ingester가 OOMKilled됐습니다.

```text
ingester-0   OOMKilled (WAL replay)
ring: too many unhealthy instances
Grafana query: 500
```

즉시 메모리를 2Gi → 4Gi로 늘려 복구했습니다.

근본 원인은 카디널리티 폭증 가능성입니다. k6 메트릭, `envoy_*` 메트릭, per-pod 라벨이 복합적으로 유입되면서 series가 급증했을 것으로 추정됩니다. `prometheus_tsdb_head_series` / `cortex_ingester_memory_series` 측정 후 high-cardinality drop rule + active_series limit 설정이 필요합니다.

---

## 🔥 트러블 6: Loki 로그 미수집

Grafana에서 로그가 전혀 보이지 않았습니다. Loki labels에 `service_name` 하나만 있는 상태였습니다.

원인은 DaemonSet 부재였습니다. otel-collector 3개(back/front/s3)가 모두 Deployment 모드로 운영 중이었고, 노드의 `/var/log/pods`를 읽는 DaemonSet이 없어서 kubelet stdout 로그가 Loki로 전달되지 않았습니다.

`otel-collector-logs` DaemonSet을 추가해 해결했습니다.

```yaml
# DaemonSet 핵심 설정
presets:
  logsCollection:
    enabled: true  # filelog receiver + hostPath 마운트 + RBAC
exporters:
  otlphttp/loki:
    endpoint: http://loki:3100/otlp
```

---

## ✅ 1차 부하테스트 결과 (3000 VU, 3분 44초)

위 트러블들을 해소한 뒤 1차 3000 VU 부하테스트를 실행했습니다.

### 핵심 지표

| 지표 | 값 | 평가 |
|------|----|------|
| queue_pass_rate | 100% | 대기열 자체는 정상 |
| **ticket_success_rate** | **15.6%** | 핵심 문제 |
| order_creation p95 | 60s (timeout) | 병목 |
| payment p95 | 10.5s | 느림 |
| seat_selection p95 | 9.86s | 느림 |
| http_req_failed | 4.40% | 3,980 / 90,415 건 |

결과를 한마디로 요약하면, 대기열은 통과했지만 그 이후 단계에서 무너졌습니다.

### 3가설 검증

세 가지 가설을 동시에 검증했습니다.

| 가설 | 판정 | 근거 |
|------|------|------|
| A. Seat hold TTL 짧음 | 무관 | TTL 600s, 시나리오 90초라 여유 충분 |
| B. PgBouncer pool 부족 | 부분 | peak 35/80 사용, waiting peak 10 (잠깐 burst) |
| C. 슬로우 쿼리 / Order 트랜잭션 | **진짜 병목** | seat-grades 9건 5초+, order POST 60s timeout |

PgBouncer pool 자체는 여유가 있었습니다. peak 사용률 35/80 수준이었고 waiting이 발생한 것은 짧은 burst 구간뿐이었습니다.

진짜 문제는 쿼리 실행 속도였습니다.

### EXPLAIN 결과 — Plan은 정상

`seat_statuses` 테이블이 7.5GB에 달하지만 `idx_game_seat(game_schedule_id, seat_id)` + `idx_seats_section_id`로 nested loop 1ms 안에 완료되었습니다. 인덱스와 실행 계획은 정상이었습니다.

### 진짜 원인 — ANALYZE 미실행

문제는 통계 정보가 없었다는 것입니다.

```text
모든 hot table: n_live_tup = 0
```

`n_live_tup = 0`은 PostgreSQL 통계 테이블(`pg_stat_user_tables`)이 해당 테이블의 행 수를 0으로 보고 있다는 뜻입니다. ANALYZE를 한 번도 실행하지 않은 상태였습니다.

통계가 없으면 쿼리 플래너가 잘못된 실행 계획을 선택할 수 있습니다. `idx_game_seat`가 완벽해도 플래너가 "행이 없다"고 오판하면 sequential scan을 선택할 수 있습니다. 7.5GB 테이블 전체를 스캔하면 60s timeout이 나오는 것은 자연스러운 결과입니다.

PgBouncer session 모드에서 ticketing이 pool을 dominant하게 점유하면서 일부 burst 구간에서 wait이 발생한 것도 복합적으로 작용했습니다.

### 부수 발견

**ORDER_SEAT_ALREADY_EXISTS (409)** — 첫 번째 사용자의 결제가 60s timeout으로 실패하면, seat hold가 만료됩니다. 다른 사용자가 해당 좌석을 선점한 뒤 첫 번째 사용자가 재시도하면 409가 반환됩니다. 결제 latency 자체가 근본 문제입니다.

**duplicate key violates unique constraint** — seat reservation race condition입니다. 동시 insert 충돌 시 retry/backoff 로직이 없어서 즉시 실패합니다.

---

## ✅ 즉시 적용한 fix

3개의 수정을 바로 적용했습니다.

**1. ANALYZE 9개 hot table 수행**

```sql
ANALYZE seats;
ANALYZE seat_statuses;
ANALYZE seat_holds;
ANALYZE game_seat_inventories;
ANALYZE seat_sections;
ANALYZE seat_grades;
ANALYZE tickets;
ANALYZE orders;
ANALYZE order_items;
```

**2. ticketing MaxConns 조정**

```text
TICKETING_DATABASE_MAX_CONNS: 18 → 10
(6 replica × 10 = 60 client 연결)
```

**3. PgBouncer ticketing DB pool 확대**

```ini
[databases]
; ticketing만 별도 pool_size 설정
goti_ticketing = ... pool_size=100
; 다른 DB는 기본 80 유지
```

---

## 다음 부하테스트 체크리스트

- [x] ANALYZE 완료
- [x] ticketing MaxConns 10, pool_size 100 적용
- [ ] Redis flush (queue 잔여 키 제거) — 테스트 직전 수행
- [ ] PgBouncer 메트릭 대시보드 실시간 관측
- [ ] order POST p95, payment p95 추이 비교

---

## 📚 배운 점

**통계 없이 인덱스만 믿으면 안 됩니다**

`EXPLAIN`이 정상 plan을 보여줘도, 운영 데이터 투입 후 `ANALYZE`를 실행하지 않으면 플래너가 엉뚱한 결정을 내릴 수 있습니다. 대규모 데이터를 로드한 이후에는 반드시 ANALYZE를 실행하는 것을 체크리스트에 포함해야 합니다

**PgBouncer `options=` 키는 1.23에서 지원하지 않습니다**

search_path 주입이 필요하면 `connect_query`를 사용합니다. `server_reset_query = DISCARD ALL`은 connect_query로 설정한 search_path까지 초기화하므로, SimpleProtocol 환경에서는 `DISCARD PLANS`로 약화하는 것이 안전합니다

**ArgoCD controller 캐시는 repo-server 재시작으로 해소되지 않습니다**

sync가 stale하면 `argocd-application-controller-0` pod를 직접 삭제해야 합니다. controller와 repo-server는 캐시를 공유하지 않습니다

**DSN URL에 특수문자 비밀번호를 직접 넣으면 파싱이 실패합니다**

URL 인코딩된 사본을 별도 SSM 파라미터로 관리하고 ExternalSecret으로 주입하는 패턴이 안전합니다. Terraform에서도 `urlencode()` 함수로 동기화해두면 수동 오류가 없습니다

**transaction 모드 + pgx 배열 타입은 단순하지 않습니다**

SimpleProtocol / Exec / DescribeExec 모드 모두 pgx의 custom type 인코딩과 sqlc 생성 쿼리와 충돌이 발생했습니다. 단기에 해결하려면 session 모드 회귀가 가장 확실한 선택입니다. 완전한 transaction 모드 호환은 pgx OID 매핑을 명시적으로 처리하는 별도 작업이 필요합니다

## 미해결 / 후속 작업

- PgBouncer transaction 모드 + Go pgx 완전 호환 구현 (pgx custom type registry + DescribeExec, 또는 Exec + 명시 OID 매핑)
- pgbouncer-exporter ServiceMonitor 자동 발견 (현재 수동 ServiceMonitor)
- Mimir 카디널리티 측정 + drop rule + active_series limit 설정
- order create / payment latency 분석 (Tempo trace 분포)
- seat reservation race condition 시 retry/backoff 구현 (현재 즉시 409 반환)
