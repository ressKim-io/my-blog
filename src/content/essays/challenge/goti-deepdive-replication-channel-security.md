---
title: "복제 연결 보안 — TLS 검증, 인증 방식, 최소 권한 설계"
excerpt: "PostgreSQL 복제 연결의 보안을 Transport(TLS), Authentication(인증), Authorization(권한) 세 계층으로 나눠 각각 어떻게 설계하고 어디서 취약해지는지 설명합니다"
category: challenge
tags:
  - go-ti
  - PostgreSQL
  - pglogical
  - TLS
  - replication-security
  - least-privilege
  - concept
series:
  name: "goti-deepdive-database"
  order: 11
date: "2026-04-19"
---

## 한 줄 요약

> 복제 연결의 보안은 채널 암호화(Transport), 접속 신원 확인(Authentication), 복제 계정 권한 범위(Authorization) 세 계층이 독립적으로 작동하며, 하나라도 빠지면 다른 계층을 우회할 수 있는 경로가 열립니다

---

## 🤔 무엇을 푸는 기술인가

PostgreSQL 복제 연결은 일반 쿼리 연결과 두 가지 점에서 다릅니다

첫째, **연결이 며칠·수 주 동안 지속됩니다** 단일 쿼리가 수 밀리초에 끝나는 것과 달리, WAL 스트림은 끊기지 않고 계속 흐릅니다

둘째, **복제 계정은 구조적으로 높은 권한을 갖습니다** `REPLICATION` attribute와 데이터 읽기 권한이 동시에 필요하기 때문입니다

이 두 특성 때문에 복제 연결은 채널 암호화·인증·권한 세 계층을 명시적으로 설계해야 합니다

---

## 🔧 동작 원리

### Transport 계층: TLS와 서버 인증서 검증

TLS 동작은 Subscriber DSN의 `sslmode` 파라미터로 제어합니다

`sslmode` 값마다 검증 범위가 다릅니다

| sslmode | 암호화 | 서버 인증서 검증 | hostname 검증 |
|---|---|---|---|
| `disable` | X | X | X |
| `require` | O | X | X |
| `verify-ca` | O | CA 체인 O | X |
| `verify-full` | O | CA 체인 O | O |

`sslmode=require`는 채널을 암호화하지만 서버 인증서를 검증하지 않습니다 자가서명 인증서를 가진 공격자도 연결을 받아들입니다

![sslmode=require vs verify-full 비교|tall](/diagrams/goti-deepdive-replication-channel-security-1.svg)

왼쪽(`sslmode=require`)은 공격자가 자가서명 인증서를 제출해 중간에 개입할 수 있는 MITM 경로를 보여줍니다 채널이 암호화되어 있어도 복호화 키를 가진 공격자가 중간에 있으면 데이터가 노출됩니다

오른쪽(`sslmode=verify-full`)은 TLS Handshake에서 두 단계를 검증합니다

1. **CA 체인 검증**: 서버 인증서가 신뢰하는 루트 CA까지 이어지는지 확인합니다 자가서명 인증서나 신뢰하지 않는 중간 CA 서명은 이 단계에서 거부됩니다
2. **hostname 검증**: 인증서의 CN/SAN이 DSN hostname과 일치하는지 확인합니다 정상 인증서를 다른 IP로 이동해도 hostname 불일치로 차단됩니다

`sslrootcert` 파라미터로 신뢰할 CA 파일을 지정합니다 공인 CA(Let's Encrypt 등)를 사용하면 `sslrootcert=system`으로 OS 신뢰 저장소를 참조할 수 있습니다

### Authentication 계층: plaintext 비밀번호 vs 클라이언트 인증서

Authentication 계층은 "이 연결이 정말 허가된 복제 계정에서 왔는가"를 확인합니다

가장 흔한 방식은 **plaintext 비밀번호 DSN**입니다 비밀번호를 DSN에 직접 포함하면 `pg_subscription` 카탈로그에 저장됩니다 `pg_dump`나 에러 로그에 노출될 수 있고, rotation 전 이전 버전이 스냅샷에 남습니다

더 강한 대안은 **클라이언트 인증서 인증(cert authentication)**입니다 비밀번호 대신 클라이언트 인증서와 개인 키로 신원을 증명합니다

Publisher 측 `pg_hba.conf`에 `cert` method를 지정하면 클라이언트가 제출하는 인증서를 검증합니다 인증서는 서버가 신뢰하는 CA로 서명되어야 하며, CN이 DB user 이름과 일치해야 합니다

```text
# pg_hba.conf (Publisher)
hostssl gotidb  pglogical_repl  AWS_NAT/32  cert
```

Subscriber DSN에는 비밀번호 대신 인증서 경로를 지정합니다

```text
host=34.64.74.209 port=5432 dbname=gotidb user=pglogical_repl
sslmode=verify-full sslcert=/etc/ssl/pg/client.crt
sslkey=/etc/ssl/pg/client.key sslrootcert=/etc/ssl/certs/custom-ca.pem
```

DSN에 비밀번호 항목이 없으므로 로그 노출 위험이 구조적으로 사라집니다 `clientcert=verify-full`을 추가하면 비밀번호 인증과 인증서 검증을 동시에 요구하는 이중 인증이 됩니다(PostgreSQL 12+)

### Authorization 계층: REPLICATION role과 최소 권한

인증이 통과해도 복제 계정 권한 범위가 과도하면 위험합니다 복제 계정에 필요한 최소 권한은 세 가지입니다

1. **REPLICATION attribute**: 복제 연결 자체를 허용합니다 role 생성 시 `CREATE ROLE pglogical_repl REPLICATION LOGIN`으로 부여합니다
2. **복제 대상 테이블 SELECT**: initial sync에서 publisher가 `COPY`로 데이터를 전송할 때 필요합니다
3. **pglogical 스키마 USAGE**: pglogical 내부 함수 접근에 필요합니다

![복제 연결 3계층 보안 모델|tall](/diagrams/goti-deepdive-replication-channel-security-2.svg)

이 다이어그램은 복제 연결 보안을 Transport, Authentication, Authorization 세 계층으로 분리한 전체 구조를 보여줍니다 왼쪽(빨간 테두리)은 현재 취약하거나 한계가 있는 상태이고, 오른쪽(초록 테두리)은 각 계층의 개선 목표입니다 세 계층은 독립적으로 동작하므로, 한 계층을 강화해도 다른 계층의 약점은 그대로 남습니다

문제는 `pg_read_all_data` 같은 광역 권한을 부여할 때 발생합니다 이 권한은 PostgreSQL 14에서 도입된 predefined role로, 인스턴스의 모든 테이블·뷰·시퀀스를 SELECT할 수 있게 합니다 복제 설정을 빠르게 구성할 때 편리하지만, 복제 대상이 아닌 테이블의 데이터도 읽을 수 있는 권한을 부여합니다

최소 권한 원칙(least privilege)을 적용하면 pglogical replication set에 등록된 테이블만 명시적으로 SELECT를 허용합니다

```sql
-- REPLICATION 권한만 가진 계정 생성
CREATE ROLE pglogical_repl REPLICATION LOGIN PASSWORD '...';

-- pglogical 스키마 접근만 허용
GRANT USAGE ON SCHEMA pglogical TO pglogical_repl;

-- 복제 대상 테이블만 명시적 허용 (pg_read_all_data 대신)
GRANT SELECT ON public.orders    TO pglogical_repl;
GRANT SELECT ON public.payments  TO pglogical_repl;
GRANT SELECT ON public.users     TO pglogical_repl;
-- (복제 대상 외 테이블은 포함하지 않음)
```

이 접근 방식의 단점은 복제 대상 테이블이 늘어날 때마다 `GRANT SELECT`를 추가해야 한다는 관리 부담입니다 이를 자동화하는 방법으로 Flyway/Liquibase migration이 replication set 등록과 동시에 GRANT를 실행하도록 연동할 수 있습니다

---

## 📐 세부 동작과 옵션

### pg_hba.conf 인증 방식 비교

`pg_hba.conf`는 연결 유형별로 인증 방식을 지정합니다 복제 연결에는 `hostssl`(TLS 필수)을 사용합니다 pglogical은 복제 프로토콜 연결과 내부 쿼리용 일반 연결을 모두 사용하므로, 두 규칙을 함께 정의해야 합니다

```text
hostssl  replication  pglogical_repl  AWS_NAT/32  scram-sha-256
hostssl  gotidb       pglogical_repl  AWS_NAT/32  scram-sha-256
```

각 인증 방식 비교입니다

| 방식 | DSN에 비밀번호 필요 | 유출 위험 | 설정 복잡도 |
|---|---|---|---|
| `md5` | O (평문 해시) | 높음 | 낮음 |
| `scram-sha-256` | O (챌린지-응답) | 중간 | 낮음 |
| `cert` | X (인증서) | 낮음 | 높음 |
| `scram-sha-256` + `clientcert=verify-full` | O + 인증서 | 낮음 | 높음 |

`scram-sha-256`은 `md5`보다 안전한 챌린지-응답 방식이라 비밀번호가 네트워크로 평문 전송되지 않습니다 PostgreSQL 10에서 도입되었으며, 현재 비밀번호 인증을 사용한다면 `md5` 대신 `scram-sha-256`으로 전환하는 것이 기본값이어야 합니다

### DSN 비밀번호 노출 완화 방법

cert 인증 전환 전까지 위험을 낮추는 두 가지 방법이 있습니다

**Secret Manager + K8s Job 주입**: PostgreSQL은 vault 참조를 지원하지 않으므로, K8s Job에서 Secret을 마운트한 뒤 DSN 문자열을 조합해 `create_subscription`을 실행합니다 비밀번호가 소스 코드에 하드코딩되는 것을 방지합니다

**정기 rotation**: `pglogical.alter_subscription_interface()`로 DSN을 갱신합니다 rotation 주기를 단축하면 유출된 비밀번호의 유효 기간을 줄일 수 있습니다

### REPLICATION attribute vs SUPERUSER

`REPLICATION` attribute는 복제 스트림 열기·복제 슬롯 관리에 한정됩니다 `SUPERUSER`와 달리 DDL 실행, `pg_hba.conf` 변경, 다른 user로 `SET ROLE`, RLS 우회 권한을 갖지 않습니다 복제 계정에 `SUPERUSER`를 주면 인스턴스 전체 관리 권한이 열립니다 `REPLICATION` attribute만 부여하고 필요한 테이블 SELECT를 별도로 GRANT하는 방식이 올바른 구성입니다

---

## 🧩 go-ti에서는

go-ti 복제 구성에서 Transport 계층은 `sslmode=require`로 채널 암호화만 적용된 상태였습니다 GCE VM에 자가서명 인증서를 사용하고 있어 `sslmode=verify-full`로 전환하려면 공인 CA 인증서 발급이 선행 조건이었습니다 1주 시연 기간 내에 cert-manager나 Let's Encrypt를 구성하는 것이 시간 부담이 컸으므로 의도적으로 미뤘습니다

Authentication 계층에서는 subscription DSN에 plaintext 비밀번호를 포함하는 방식을 사용했습니다 2026-04-18 Phase B K8s Job 실행 중 에러 로그에 DSN 전문이 노출되는 사건이 있었고, 이후 비밀번호를 rotation하여 이전 버전은 Secret Manager에서 삭제했습니다

Authorization 계층에서 `pglogical_repl` 계정에는 `pg_read_all_data` predefined role을 부여했습니다 복제 대상 테이블이 늘어날 때마다 GRANT를 추가하는 관리 부담을 피하기 위한 결정이었으나, 복제 범위 밖 테이블까지 읽기 권한이 열린다는 한계가 남아있습니다

세 계층 모두 시연 종료 후 프로덕션 전환 시 Tier 2 개선 항목으로 분류되어 있습니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [Multi-Cloud pglogical 복제 알려진 한계와 개선 로드맵](/logs/goti-pglogical-mr-replication-gaps-adr)에 정리했습니다

---

## 📚 핵심 정리

- `sslmode=require`는 채널 암호화만 보장하고 서버 신원을 검증하지 않아 MITM에 취약합니다 `verify-full`은 CA 체인 + hostname 두 단계 검증으로 MITM을 차단합니다
- 클라이언트 인증서 인증(`cert` method + `clientcert=verify-full`)은 DSN에서 비밀번호를 제거합니다 로그·스냅샷을 통한 비밀번호 유출 표면을 구조적으로 줄이는 유일한 방법입니다
- Transport·Authentication·Authorization 세 계층은 독립적입니다 채널을 암호화했다고 해서 인증이 강화되지 않으며, 인증이 강화됐다고 해서 과도한 권한 문제가 해결되지 않습니다
- `pg_read_all_data`는 편리하지만 최소 권한 원칙에서 벗어납니다 복제 대상 테이블만 SELECT를 명시적으로 GRANT하고 REPLICATION attribute와 분리 관리하는 것이 올바른 구성입니다
- `scram-sha-256`은 `md5`보다 안전한 챌린지-응답 방식으로, cert 인증 전환 전까지 기본 비밀번호 인증 방식으로 사용해야 합니다
