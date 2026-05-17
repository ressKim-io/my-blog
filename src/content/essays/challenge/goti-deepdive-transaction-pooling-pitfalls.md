---
title: "Transaction Pooling의 함정 — prepared statement·세션 상태가 깨지는 원리"
excerpt: "PgBouncer transaction mode는 강력한 다중화 효과를 주지만, prepared statement·LISTEN/NOTIFY·advisory lock처럼 PostgreSQL 연결에 바인딩된 세션 상태를 조용히 깨뜨립니다 각 기능이 왜 연결에 묶이는지, 연결 교체가 어떤 경로로 충돌을 일으키는지 동작 원리를 분석합니다"
category: challenge
tags:
  - go-ti
  - PgBouncer
  - transaction-pooling
  - prepared-statement
  - PostgreSQL
  - concept
series:
  name: "goti-deepdive-database"
  order: 3
date: "2026-04-14"
---

## 한 줄 요약

> PgBouncer transaction mode는 매 트랜잭션마다 실제 DB 연결을 교체합니다 prepared statement·LISTEN/NOTIFY·advisory lock은 모두 특정 PostgreSQL 백엔드 연결에 바인딩된 세션 상태이므로, 연결이 교체되는 순간 조용히 사라집니다

---

## 🤔 무엇을 푸는 기술인가

[PgBouncer 커넥션 멀티플렉싱 원리](/essays/goti-deepdive-pgbouncer-pooling)에서 pool_mode 3종의 기본 동작을 다뤘습니다 session mode는 100% 호환이지만 다중화 효과가 없고, transaction mode는 다중화 효과가 크지만 제약이 있다고 설명했습니다 이 글은 그 "제약"의 내부 원인을 구체적으로 파고듭니다

transaction mode를 실제 운영에 투입하려면 다음 세 가지 함정을 정확히 이해해야 합니다

- **prepared statement 충돌**: 이름이 같은 prepared statement가 다른 연결에서 "존재하지 않음" 오류를 일으킴
- **LISTEN/NOTIFY 단절**: 비동기 알림이 등록과 다른 연결에 도달해 수신 불가
- **advisory lock 소멸**: 세션 스코프 lock이 트랜잭션 경계에서 강제 해제

세 가지 모두 원인은 동일합니다 PostgreSQL의 특정 기능들이 **연결(프로세스)** 단위로 상태를 유지하는 방식 때문입니다

---

## 🔧 동작 원리

### PostgreSQL 백엔드 프로세스와 세션 상태

PostgreSQL은 클라이언트 연결 하나당 백엔드 프로세스 하나를 fork합니다 이 프로세스는 연결이 살아있는 동안 여러 상태를 메모리에 유지합니다

```text
PostgreSQL 백엔드 프로세스 (conn-1)
├── shared buffer 매핑
├── session-level prepared statements   ← PREPARE로 등록
├── LISTEN 구독 목록                    ← LISTEN channel로 등록
├── session advisory locks              ← pg_advisory_lock()으로 획득
├── SET SESSION 변수                    ← SET search_path 등
└── 임시 테이블                         ← CREATE TEMP TABLE
```

이들은 모두 **프로세스 메모리**에 있습니다 프로세스가 재사용되면 이전 상태가 남아있고, 프로세스가 교체되면 상태가 사라집니다

transaction mode PgBouncer가 하는 일은 정확히 이것입니다 트랜잭션이 끝날 때마다 앱 연결에서 백엔드 프로세스를 떼어내고 다른 앱 연결에 재배정합니다 앱 입장에서는 "하나의 연속된 연결"처럼 보이지만, 실제로는 매 트랜잭션마다 다른 백엔드 프로세스와 통신합니다

### Prepared Statement가 깨지는 경로

PostgreSQL의 named prepared statement는 SQL을 미리 파싱·플래닝해두고 이름으로 재사용하는 기능입니다

```sql
PREPARE stmt_get_ticket AS
  SELECT * FROM tickets WHERE id = $1;

EXECUTE stmt_get_ticket(42);
```

`PREPARE` 실행 시 서버는 파싱 트리와 플랜을 현재 백엔드 프로세스의 메모리에 저장하고 이름(`stmt_get_ticket`)으로 색인합니다 이 저장소는 **프로세스 메모리**입니다 다른 프로세스는 이 이름을 알 방법이 없습니다

Go pgx 드라이버는 기본적으로 named prepared statement를 자동으로 캐싱합니다 쿼리를 처음 실행할 때 내부적으로 `PREPARE`를 보내고, 이후 동일 쿼리에서는 `EXECUTE`만 보내 파싱·플래닝 비용을 줄입니다 드라이버가 생성하는 statement 이름은 결정적(deterministic)입니다 쿼리 문자열의 해시값에 기반한 이름을 씁니다

transaction mode에서 충돌이 발생하는 경로는 다음과 같습니다

1. 앱 goroutine A가 `BEGIN` — PgBouncer가 conn-1 배정
2. goroutine A가 첫 번째 쿼리 실행 — pgx가 자동으로 `PREPARE __pgx_3f8a...` 실행, conn-1에 등록됨
3. goroutine A가 `COMMIT` — PgBouncer가 conn-1 반환, `DISCARD ALL` 실행 → conn-1의 모든 prepared statement 삭제
4. goroutine B가 `BEGIN` — PgBouncer가 conn-2 배정 (또는 `DISCARD ALL` 이후의 conn-1)
5. goroutine B가 동일 쿼리 실행 — pgx가 캐시를 보고 `EXECUTE __pgx_3f8a...` 전송
6. PostgreSQL이 오류 반환: `ERROR: prepared statement "__pgx_3f8a..." does not exist`

![session mode vs transaction mode — prepared statement 수명 비교|tall](/diagrams/goti-deepdive-transaction-pooling-pitfalls-1.svg)

위 시퀀스 다이어그램은 두 mode의 차이를 나란히 보여줍니다 위쪽 section(초록 테두리)은 session mode입니다 conn-1이 연결 내내 고정되어 있으므로 `PREPARE`로 등록된 stmt_1을 이후 `EXECUTE`에서 항상 찾을 수 있습니다

아래쪽 section(노란 테두리)은 transaction mode입니다 Tx-A가 conn-1에 stmt_1을 등록하고 `COMMIT`하는 순간 `DISCARD ALL`이 실행되어 stmt_1이 삭제됩니다 Tx-B는 conn-2(또는 초기화된 conn-1)를 배정받아 stmt_1을 찾지 못하고 오류를 냅니다 pgx 클라이언트 캐시에는 stmt_1이 살아있지만, 서버 측에는 존재하지 않는 불일치 상태가 됩니다

이 충돌은 **같은 이름의 statement를 다른 연결에서 실행하려는 시도**이므로 에러 메시지만 봐서는 원인을 찾기 어렵습니다 pgx 내부 이름(`__pgx_<hash>`)은 사용자가 직접 쓰지 않았으므로, 로그에서 해당 이름을 보면 먼저 PgBouncer transaction mode와의 충돌을 의심해야 합니다

### LISTEN/NOTIFY의 세션 의존성

`LISTEN`은 특정 채널의 알림을 구독하는 명령입니다

```sql
LISTEN order_created;  -- 이 연결에서 order_created 채널 구독
```

PostgreSQL은 구독 목록을 해당 백엔드 프로세스에 연결된 데이터 구조에 유지합니다 다른 프로세스가 `NOTIFY order_created`를 실행하면 PostgreSQL은 자신의 procarray를 순회하며 `order_created`를 구독 중인 모든 백엔드 프로세스에 알림을 전달합니다

transaction mode에서는 `LISTEN`을 실행한 conn이 트랜잭션 종료 후 반환됩니다 `DISCARD ALL`은 해당 연결의 모든 LISTEN 구독을 해제합니다 이후 알림이 와도 받을 프로세스가 없습니다 또는 같은 이름의 다른 앱 연결이 conn을 재사용 중이라면 의도치 않은 수신자가 알림을 받게 됩니다

결론적으로 LISTEN/NOTIFY는 **연결이 살아있는 동안 지속적으로 수신을 기다리는 구조**이므로, 연결을 교체하는 transaction mode와 근본적으로 양립할 수 없습니다

### Advisory Lock의 세션 스코프

PostgreSQL advisory lock에는 두 가지 스코프가 있습니다

```sql
-- session scope: 연결 수명과 같음, 명시적 해제 필요
SELECT pg_advisory_lock(12345);
SELECT pg_advisory_unlock(12345);

-- transaction scope: 트랜잭션 종료 시 자동 해제
SELECT pg_advisory_xact_lock(12345);
```

`pg_advisory_lock()`(session scope)은 lock을 **백엔드 프로세스의 lock 목록**에 등록합니다 이 lock은 같은 세션이 `pg_advisory_unlock()`을 호출하거나 연결이 종료될 때까지 유지됩니다 PostgreSQL은 세션 advisory lock을 "어떤 프로세스가 이 lock을 쥐고 있는가"로 추적합니다

transaction mode에서 conn이 반환될 때 `DISCARD ALL`이 실행되면 세션 advisory lock이 강제 해제됩니다 앱은 lock을 쥐고 있다고 가정하지만 실제로는 해제된 상태입니다 이후 다른 트랜잭션이 같은 key로 lock을 획득할 수 있으며, 상호 배제가 보장되어야 할 구간에서 동시 실행이 발생합니다

반면 `pg_advisory_xact_lock()`(transaction scope)은 트랜잭션 종료 시 자동 해제되므로 transaction mode와 충돌하지 않습니다 transaction mode 환경에서 advisory lock이 필요하다면 반드시 xact 변형을 사용해야 합니다

### SET SESSION과 연결 경계

`SET search_path = my_schema, public` 같은 `SET SESSION` 명령도 동일한 제약을 받습니다

```sql
SET search_path = 'tenant_a', public;
-- 이후 쿼리들이 tenant_a 스키마를 기본으로 사용
SELECT * FROM orders;  -- tenant_a.orders 조회
```

이 설정은 백엔드 프로세스의 GUC(Grand Unified Configuration) 변수에 저장됩니다 transaction mode에서 conn이 반환되면 `DISCARD ALL`이 GUC를 포함한 세션 변수를 모두 초기화합니다 다음 트랜잭션에서는 기본 `search_path`가 적용됩니다

멀티 테넌시를 세션 변수로 구현한 경우 특히 위험합니다 `SET search_path`로 테넌트를 전환하는 패턴은 transaction mode 앞에서 테넌트가 뒤섞이는 결과로 이어집니다

![transaction mode가 깨뜨리는 세션 의존 기능 3종|tall](/diagrams/goti-deepdive-transaction-pooling-pitfalls-2.svg)

위 비교표 다이어그램은 세 가지 기능을 session mode와 transaction mode 관점으로 나란히 정리합니다 세 행 모두 "공통 원인" 박스가 같습니다 prepared statement·LISTEN 구독·session advisory lock은 모두 PostgreSQL 백엔드 연결(프로세스)에 바인딩된 세션 상태입니다 session mode에서는 연결이 고정되어 있어 세 기능이 정상 동작하고, transaction mode에서는 매 트랜잭션마다 연결이 교체되어 세 기능이 모두 의도대로 동작하지 않습니다

---

## 📐 세부 동작과 옵션

### pgx의 QueryExecMode — prepared statement 대응

Go pgx 드라이버는 `DefaultQueryExecMode` 설정으로 prepared statement 처리 방식을 바꿀 수 있습니다

| 모드 | 동작 | transaction mode 호환 | 비고 |
|---|---|---|---|
| `QueryExecModeCacheStatement` (기본) | 자동 named prepared statement 캐싱 | 충돌 발생 | pgx 기본값 |
| `QueryExecModeSimpleProtocol` | PostgreSQL simple query protocol 사용 | 호환 | prepared statement 없음, 바인딩 오버헤드 ~10% |
| `QueryExecModeExec` | unnamed prepared statement 사용 | 호환 | 이름 없으므로 충돌 없음 |
| `QueryExecModeCacheDescribe` | 타입 정보만 캐싱, 실행은 simple | 호환 | 타입 안전성 유지 |

`QueryExecModeSimpleProtocol`은 PostgreSQL의 simple query protocol로 전환합니다 이 프로토콜에서는 클라이언트가 SQL 문자열을 그대로 전송하고 서버가 즉시 실행합니다 prepared statement 단계가 없으므로 transaction mode와 충돌하지 않습니다 단점은 파라미터 바인딩을 드라이버가 텍스트로 이스케이프해서 처리하므로 extended query protocol 대비 약간의 오버헤드가 있습니다

```go
config, _ := pgxpool.ParseConfig(dsn)
config.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
config.ConnConfig.StatementCacheCapacity = 0
config.ConnConfig.DescriptionCacheCapacity = 0
pool, _ := pgxpool.NewWithConfig(ctx, config)
```

`StatementCacheCapacity = 0`과 `DescriptionCacheCapacity = 0`을 함께 설정해 드라이버 내부 캐시를 완전히 비웁니다 PgBouncer 앞에서는 캐시된 statement 이름이 유효하지 않으므로 캐시를 유지하면 오히려 잘못된 실행으로 이어집니다

### server_reset_query와 DISCARD ALL

transaction mode에서 PgBouncer는 서버 연결을 반환할 때 `server_reset_query`에 지정된 명령을 실행합니다 기본 권장값은 `DISCARD ALL`입니다

```ini
server_reset_query = DISCARD ALL
```

`DISCARD ALL`은 다음을 모두 초기화합니다

```text
DISCARD ALL 효과
├── DEALLOCATE ALL          -- 모든 named prepared statement 삭제
├── CLOSE ALL               -- 모든 커서 닫기
├── UNLISTEN *              -- 모든 LISTEN 구독 해제
├── SELECT pg_advisory_unlock_all()   -- 모든 세션 advisory lock 해제
├── RESET ALL               -- 모든 GUC 변수 초기화 (search_path 포함)
└── DROP TABLE 임시 테이블  -- 임시 테이블 삭제
```

이 명령이 의도적으로 세션 상태를 깨끗이 지우는 것입니다 transaction mode에서 연결을 안전하게 재사용하려면 이전 세션의 흔적이 남아있어서는 안 됩니다 `DISCARD ALL`은 바로 그 보장을 위한 것입니다

`server_reset_query`를 빈 문자열로 설정하거나 가벼운 명령으로 바꾸면 세션 상태가 연결 간에 유출될 수 있습니다 `search_path`가 이전 세션에서 설정된 채로 다음 세션에 전달되거나, 이전 트랜잭션이 획득했지만 해제하지 못한 advisory lock이 남아있을 수 있습니다

### LISTEN/NOTIFY 대안

PgBouncer transaction mode를 쓰면서 LISTEN/NOTIFY가 필요한 경우 두 가지 방향이 있습니다

**1. 전용 연결 분리**: LISTEN 목적으로 session mode 또는 별도 직접 연결(PgBouncer 우회)을 사용합니다 pgx에서는 `pgconn.Connect()`로 직접 연결을 맺어 LISTEN 전용으로 유지할 수 있습니다

```go
// LISTEN 전용 직접 연결 (PgBouncer 우회)
conn, _ := pgconn.Connect(ctx, directDatabaseURL)
_, _ = conn.Exec(ctx, "LISTEN order_created").ReadAll()
// 이 연결은 닫지 않고 알림 수신 루프로 유지
```

**2. 외부 pub/sub 전환**: Redis pub/sub·Kafka 등 외부 메시지 브로커로 대체합니다 PostgreSQL 알림은 데이터베이스 트랜잭션과 강하게 결합된 경우(예: 커밋 시 알림 보장)에만 가치가 있습니다 그 외에는 외부 브로커가 더 확장성 있습니다

---

## 🧩 go-ti에서는

go-ti는 ADR 0013에서 PgBouncer transaction mode 도입 시 prepared statement 충돌 문제를 명시적으로 검토했습니다 Go pgx의 기본 동작(`QueryExecModeCacheStatement`)이 transaction mode와 충돌하므로, Phase C에서 `QueryExecModeSimpleProtocol`로 전환하는 계획을 수립했습니다 환경 변수 `PGBOUNCER_COMPAT=true`로 스위치를 제공해 PgBouncer 경유 여부에 따라 모드를 전환합니다 LISTEN/NOTIFY는 ADR 시점에 사용 사례가 없어 기존 Redis pub/sub로 처리되고 있었고, session scope advisory lock도 사용 이력이 없음을 전수 grep으로 확인했습니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [PgBouncer 도입 — Connection Multiplexing 전략 결정](/logs/goti-pgbouncer-connection-pooling-adr)에 정리했습니다

---

## 📚 핵심 정리

- prepared statement·LISTEN 구독·session advisory lock·SET SESSION 변수는 모두 PostgreSQL 백엔드 프로세스(연결)에 바인딩된 세션 상태이며, 연결이 교체되면 소멸합니다
- transaction mode PgBouncer는 `COMMIT` 시마다 `DISCARD ALL`을 실행해 연결을 다음 클라이언트에 안전하게 재사용합니다 이 초기화가 세션 상태 소멸의 직접 원인입니다
- Go pgx에서는 `QueryExecModeSimpleProtocol`(또는 `QueryExecModeExec`)로 전환해 named prepared statement 충돌을 해소할 수 있습니다 `StatementCacheCapacity = 0`을 함께 설정합니다
- LISTEN/NOTIFY가 필요하다면 전용 직접 연결(PgBouncer 우회)을 분리하거나 외부 pub/sub로 대체합니다
- advisory lock은 transaction scope 변형(`pg_advisory_xact_lock`)을 사용하거나 Redis distributed lock으로 대체합니다
- transaction mode를 도입하기 전에 코드베이스 전체에서 `LISTEN`·`pg_advisory_lock`·`SET search_path` 패턴을 전수 grep하는 것이 필수입니다
