---
title: "PgBouncer — 커넥션 멀티플렉싱으로 DB 연결 비용을 줄이는 원리"
excerpt: "PgBouncer가 다수의 앱 연결을 소수의 실제 DB 연결로 다중화하는 방식, pool_mode 3종의 연결 반환 단위, connection storm 완충까지 내부 동작 원리를 설명합니다"
category: challenge
tags:
  - go-ti
  - PgBouncer
  - connection-pooling
  - PostgreSQL
  - multiplexing
  - concept
series:
  name: "goti-deepdive-database"
  order: 2
date: "2026-04-14"
---

## 한 줄 요약

> PgBouncer는 PostgreSQL 앞에 놓이는 연결 중개 프록시입니다 앱의 수백 개 논리 연결을 수십 개의 실제 DB 연결로 다중화(multiplexing)하여 PostgreSQL의 연결당 프로세스 비용과 `max_connections` 상한 문제를 해결합니다

---

## 🤔 무엇을 푸는 기술인가

PostgreSQL은 클라이언트 연결을 프로세스 단위로 처리합니다 연결 하나가 맺어지면 `postmaster`가 새 백엔드 프로세스를 fork합니다 이 프로세스는 연결이 idle 상태로 대기 중이더라도 메모리를 약 10MB 점유합니다 연결이 100개면 1GB, 300개면 3GB가 프로세스 메모리로 묶입니다

이 구조 때문에 PostgreSQL은 `max_connections` 파라미터로 연결 수 상한을 설정합니다 RDS t3.large의 기본값은 300 안팎입니다 연결 수가 이 한계에 근접하면 신규 연결 시도가 실패합니다

한편 애플리케이션 드라이버(예: Go pgx)는 연결 풀을 관리합니다 pod 하나에 pool 크기 18개를 설정하면 해당 pod는 항상 18개 연결을 PostgreSQL에 유지합니다 pod가 10개라면 논리 연결만 180개입니다 그런데 이 180개가 동시에 쿼리를 실행하는 시간 비율은 매우 낮습니다 대부분은 idle 상태로 메모리만 차지합니다

**PgBouncer**는 이 불일치를 해소합니다 앱 → PgBouncer 구간에서는 수많은 논리 연결을 허용하고, PgBouncer → PostgreSQL 구간에서는 최소한의 실제 연결만 유지합니다 PgBouncer 자체는 I/O 이벤트 루프(libevent) 기반 단일 프로세스로 동작하므로 연결당 비용이 매우 낮습니다

---

## 🔧 동작 원리

### 연결 수 불일치 문제와 멀티플렉싱 해법

앱이 쿼리를 보내는 절차는 다음과 같습니다 앱은 드라이버 풀에서 연결을 빌리고, 쿼리를 실행하고, 연결을 풀에 반납합니다 이 중 실제로 쿼리가 실행되는 구간은 전체 생애 주기의 일부에 불과합니다 나머지 시간은 idle입니다

PostgreSQL 입장에서는 idle 연결도 동일한 비용입니다 프로세스가 fork되어 있고 메모리가 잡혀 있습니다 `max_connections`가 꽉 차면 새 요청을 받을 수 없습니다

PgBouncer는 이 문제를 **연결 재사용**으로 해결합니다 앱 연결이 쿼리를 보내지 않는 순간, PgBouncer는 해당 앱 연결이 점유하던 실제 DB 연결을 회수합니다 다른 앱 연결이 쿼리를 보내면 그 연결을 재배정합니다 동시 쿼리 실행 수는 전체 논리 연결 수보다 훨씬 적기 때문에, 실제 DB 연결을 훨씬 적게 유지해도 됩니다

![PgBouncer 커넥션 멀티플렉싱 구조도](/diagrams/goti-deepdive-pgbouncer-pooling-1.svg)

위 구조도는 PgBouncer의 멀티플렉싱 동작을 보여줍니다 왼쪽에는 6개 Go 서비스(ticketing · stadium · user · payment · resale · queue)가 있습니다 각 서비스는 HPA로 인해 복수의 pod를 가질 수 있으며, pod마다 드라이버 풀을 유지합니다 이들이 보내는 논리 연결은 최대 250개 이상입니다

이 모든 연결은 중앙에 위치한 PgBouncer(StatefulSet × 2)로 집결합니다 PgBouncer는 `max_client_conn = 2000`으로 클라이언트 연결을 넉넉히 수용하되, 실제 DB 연결은 pool 설정(`pool_size = 25 per (db, user)`)에 따라 극히 소수만 유지합니다 오른쪽 Primary RDS에는 약 20개, Replica RDS에는 약 50개의 실제 연결만 유지됩니다 250개 이상의 논리 연결이 70개 이하의 실제 DB 연결로 좁아지는 깔때기 구조입니다

이 구조에서 앱 pod가 10개에서 100개로 스케일아웃되어도 실제 DB 연결 수는 거의 변하지 않습니다 PgBouncer pool이 포화되지 않는 한, DB에 전달되는 연결 수는 pool_size 설정에 묶여 있습니다

### 연결 점유 구간 — pool_mode가 결정하는 것

PgBouncer의 핵심 설정은 `pool_mode`입니다 이 값은 **실제 DB 연결을 언제 앱 연결에서 떼어내 반환하느냐**를 결정합니다 반환 시점이 빠를수록 다중화 효과가 커지고, 제약도 늘어납니다

![pool_mode 3종 연결 점유 구간 타임라인](/diagrams/goti-deepdive-pgbouncer-pooling-2.svg)

위 타임라인 다이어그램은 세 가지 pool_mode를 시간축으로 비교합니다 가로 방향으로 `BEGIN` → 쿼리1 → 쿼리2 → `COMMIT` → idle 순서로 이벤트가 흐릅니다 진한 색 구간이 실제 DB 연결을 점유하는 시간이고, 점선 구간은 연결이 반환되어 다른 클라이언트가 재사용할 수 있는 시간입니다

**session mode**(초록 행)에서는 클라이언트가 접속한 순간부터 접속을 끊을 때까지 DB 연결을 통째로 점유합니다 idle 상태에서도 연결이 잡혀 있으므로 다중화 효과는 사실상 없습니다 PostgreSQL 내장 풀과 동일합니다 100% 호환성이 필요하고 연결 수 최적화가 불필요한 특수 상황에만 씁니다

**transaction mode**(노란 행)에서는 `BEGIN`부터 `COMMIT`(또는 `ROLLBACK`) 사이에만 DB 연결을 점유합니다 트랜잭션이 끝나면 즉시 연결을 반환합니다 쿼리와 쿼리 사이 idle 시간은 물론, 트랜잭션 자체가 없는 idle 상태에도 연결을 놓습니다 다중화 효과가 크면서도 트랜잭션을 그대로 지원하므로 운영 환경에서 현실적인 선택입니다

**statement mode**(빨간 행)에서는 쿼리 하나가 끝날 때마다 연결을 반환합니다 다중화 효과는 최대지만, 트랜잭션을 지원하지 않습니다 `BEGIN`과 `COMMIT` 사이에 DB 연결이 교체될 수 있으므로 트랜잭션 원자성을 보장할 수 없습니다 사실상 운영 환경에서는 사용하지 않습니다

### idle 연결 회수와 재배정

transaction mode에서 PgBouncer가 연결을 회수하고 재배정하는 흐름은 다음과 같습니다

1. 클라이언트 A가 `BEGIN`을 보냅니다 → PgBouncer가 서버 풀에서 idle DB 연결 하나를 클라이언트 A에 배정합니다
2. 클라이언트 A가 쿼리를 실행합니다 → 배정된 DB 연결로 전달됩니다
3. 클라이언트 A가 `COMMIT`을 보냅니다 → PgBouncer가 DB 연결을 서버 풀로 반환합니다 이 시점에 `server_reset_query = DISCARD ALL`이 실행되어 세션 상태를 초기화합니다
4. 클라이언트 B가 `BEGIN`을 보냅니다 → 방금 반환된 DB 연결이 클라이언트 B에 재배정됩니다

이 흐름에서 클라이언트 A와 B는 **서로 다른 앱 요청**이지만 **동일한 PostgreSQL 백엔드 프로세스**를 재사용합니다 PostgreSQL 입장에서는 연결 하나가 두 클라이언트를 번갈아 처리하는 셈입니다

`server_reset_query = DISCARD ALL`은 이전 세션의 임시 테이블, `SET` 변수, advisory lock 등 상태를 지웁니다 transaction mode에서는 이 초기화가 올바른 격리를 보장하는 데 필수입니다

### connection storm 완충

DB 재시작이나 앱 대량 재기동 시 수백 개의 연결 요청이 동시에 몰리는 상황을 connection storm이라고 합니다 PostgreSQL이 직접 노출되어 있으면 이 연결 폭발이 그대로 전달되어 PostgreSQL가 과부하를 겪거나 `max_connections` 초과로 연결을 거부합니다

PgBouncer가 앞에 있으면 앱 연결은 PgBouncer에 먼저 맺어집니다 PgBouncer는 `max_client_conn` 범위 안에서 연결 요청을 수용하고, 실제 DB 연결은 `pool_size` 범위에서 순차적으로 처리합니다 클라이언트는 `reserve_pool_timeout` 동안 대기하면서 DB 연결을 기다립니다 DB에는 연결 요청이 제어된 속도로 도달합니다

---

## 📐 세부 동작과 옵션

### pool_mode 3종 비교

| 모드 | DB 연결 반환 시점 | 다중화 효과 | 주요 제약 |
|---|---|---|---|
| **session** | 클라이언트 접속 종료 시 | 거의 없음 | 없음 (100% 호환) |
| **transaction** | `COMMIT` / `ROLLBACK` 시 | 크다 | prepared statement 공유 불가, `LISTEN/NOTIFY` 불가 |
| **statement** | 쿼리 1개 종료 시 | 최대 | 트랜잭션 불가 (사실상 미사용) |

transaction mode에서 named prepared statement가 깨지는 원인과 pgx 드라이버 대응 방법은 별도 글에서 자세히 다룹니다

### 주요 파라미터

```ini
# pgbouncer.ini 핵심 설정
pool_mode = transaction
default_pool_size = 25       # (db, user) 쌍 당 서버 연결 최대 수
max_client_conn = 2000       # 클라이언트 연결 허용 총량
min_pool_size = 5            # 항상 유지하는 최소 서버 연결 수
reserve_pool_size = 5        # 긴급 예비 연결 수
reserve_pool_timeout = 3     # 예비 풀 사용 전 대기 시간 (초)
server_idle_timeout = 300    # 서버 연결 idle 유지 시간 (초)
server_lifetime = 3600       # 서버 연결 최대 수명 (초)
server_reset_query = DISCARD ALL   # 연결 반환 시 세션 초기화
```

`default_pool_size`는 (db 이름, 사용자) 쌍 단위로 적용됩니다 `goti_write`와 `goti_read`를 별도 db 섹션으로 선언하면 각각 독립된 풀이 생성됩니다 `max_client_conn`은 PgBouncer가 받을 수 있는 총 앱 연결 수 상한으로, `default_pool_size × db 수`보다 훨씬 크게 설정합니다

### PgBouncer가 완충하는 시나리오

| 시나리오 | 효과 |
|---|---|
| 앱 pod 스케일아웃 | pool_size가 고정되어 DB 연결 수 증가 없음 |
| 앱 idle 연결 다수 | 비활성 구간에 연결 회수 후 재배정 |
| DB 재시작 / RDS failover | 클라이언트는 PgBouncer에 유지, DB 재연결을 PgBouncer가 순차 처리 |
| connection storm | `max_client_conn`까지 앱 연결 수용, DB에는 `pool_size` 속도로 전달 |
| 멀티 서비스 공유 DB | 서비스별 pool 합이 `max_connections`를 초과해도 동작 |

---

## 🧩 go-ti에서는

go-ti는 6개 Go 서비스가 RDS PostgreSQL 하나를 공유합니다 HPA로 pod가 늘어날 때마다 논리 연결이 증가하며, 2026-04-14 기준 피크 250개 이상의 연결이 `max_connections = 300`에 근접했습니다 ADR 0012의 read replica 분리로 primary 부하를 완화하되, primary 쓰기 연결 경합이 지속될 경우 PgBouncer를 도입하는 2단계 계획을 수립했습니다

목표 구성은 K8s StatefulSet 2 replicas로 PgBouncer를 구성하고, `goti_write`(primary)와 `goti_read`(replica) 두 db 섹션을 선언하는 방식입니다 앱은 단일 PgBouncer 엔드포인트만 알면 되고, write/read 라우팅은 PgBouncer 설정에서 처리합니다 Istio ambient mesh를 통해 앱 → PgBouncer 구간 mTLS를 적용하고, PgBouncer → RDS 구간에는 `server_tls_sslmode = require`를 설정합니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [PgBouncer 도입 — Connection Multiplexing 전략 결정](/logs/goti-pgbouncer-connection-pooling-adr)에 정리했습니다

---

## 📚 핵심 정리

- PostgreSQL은 연결마다 프로세스를 fork합니다 idle 연결도 ~10MB 메모리를 점유하므로 `max_connections` 상한이 빠르게 소진됩니다
- PgBouncer는 앱의 논리 연결(수백 개)을 실제 DB 연결(수십 개)로 다중화합니다 앱 pod가 스케일아웃되어도 DB 연결 수는 `pool_size` 설정에 묶여 증가하지 않습니다
- `pool_mode = transaction`이 운영 환경의 현실적 선택입니다 `COMMIT` 시점에 연결을 반환하여 idle 구간의 DB 연결을 다른 클라이언트가 재사용합니다
- transaction mode에서는 `server_reset_query = DISCARD ALL`로 세션 상태를 초기화해야 연결 재사용 시 격리를 보장합니다
- connection storm 시 PgBouncer가 앱 연결을 수용하고 DB에는 제어된 속도로 전달하여 `max_connections` 초과를 방지합니다
