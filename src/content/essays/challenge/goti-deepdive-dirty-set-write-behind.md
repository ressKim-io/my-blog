---
title: "Dirty Set과 Write-Behind — 캐시 변경분을 비동기로 영속 저장소에 반영하는 원리"
excerpt: "Redis 쓰기를 즉시 DB에 반영하지 않고 변경된 키 목록(dirty set)을 추적해 배치로 flush하는 write-behind 패턴의 동작 원리와, reconciliation이 drift를 어떻게 감지·보정하는지를 교과서적으로 풀어냅니다"
category: challenge
tags:
  - go-ti
  - Redis
  - write-behind
  - dirty-set
  - reconciliation
  - eventual-consistency
  - concept
series:
  name: "goti-deepdive-redis"
  order: 4
date: "2026-04-14"
---

## 한 줄 요약

> 쓰기 요청을 Redis에만 즉시 반영하고 변경된 키를 dirty set에 쌓아두면, 비동기 worker가 배치로 DB에 flush하기 때문에 쓰기 latency가 줄고 DB 부하가 분산됩니다 reconciliation은 두 저장소 사이에 drift가 생겼을 때 주기적으로 감지하고 보정합니다

---

## 🤔 무엇을 푸는 기술인가

### 쓰기 경로의 병목

캐시를 사용하는 시스템은 **읽기 부하는 쉽게 흡수**할 수 있습니다 캐시에 데이터가 있으면 DB 조회가 발생하지 않기 때문입니다 문제는 **쓰기 경로**입니다

쓰기마다 DB에 즉시 반영하는 **write-through** 패턴은 쓰기 latency가 DB 성능에 종속됩니다 트래픽이 폭발적으로 증가하면 DB write lock 경합이 심해지고 connection pool이 소진됩니다

### write-behind가 해결하는 문제

**write-behind(write-back) 캐싱**은 이 문제를 다음 방식으로 해결합니다

- 쓰기 요청은 **캐시에만 즉시 반영** — 응답 지연이 DB I/O에 종속되지 않음
- 변경된 키를 **dirty set**에 기록해 "나중에 DB에 써야 할 것들"을 추적
- **비동기 worker**가 주기적으로 dirty set을 읽어 DB에 배치 flush
- **reconciliation job**이 주기적으로 캐시-DB 값을 비교해 불일치(drift)를 감지·보정

이 접근은 쓰기 latency를 낮추고 DB 부하를 평탄화하는 대신, 쓰기 직후 DB에는 아직 반영되지 않은 **짧은 비일관성 구간**을 허용합니다 이를 **eventual consistency(최종 일관성)**라고 부릅니다

---

## 🔧 동작 원리

### write-through vs cache-aside vs write-behind 위치

세 패턴은 "언제 DB에 쓰는가"에서 갈립니다

| 패턴 | DB 쓰기 시점 | 일관성 | 쓰기 latency |
|---|---|---|---|
| write-through | 캐시와 DB 동시 쓰기 | 강한 일관성 | DB I/O만큼 느림 |
| cache-aside | 캐시 미스 시 DB 읽기 (쓰기는 캐시 무효화 후 DB 직접) | 강한 일관성 | DB I/O만큼 느림 |
| write-behind | 캐시만 즉시 쓰고 DB는 비동기 배치 | eventual consistency | 빠름 (메모리 쓰기만) |

write-through와 cache-aside는 쓰기 직후 DB와 캐시가 항상 일치합니다 write-behind는 그 일치 시점을 "나중에"로 미루는 대신 쓰기 경로에서 DB I/O를 제거합니다

### Dirty Set으로 변경분 추적하기

write-behind의 핵심은 **"무엇이 바뀌었는지 추적"**하는 구조입니다 변경된 데이터를 찾으려면 모든 키를 순회해야 하는데, 이는 키 수가 많을수록 비용이 커집니다

**dirty set**은 이 문제를 O(1)로 해결합니다 Redis Set 하나를 `dirty:{domain}` 같은 이름으로 유지하면서, 쓰기가 발생할 때마다 해당 키를 SADD로 추가합니다

```text
쓰기 흐름:
HSET inv:{game_id}:{section_id} available 47   ← 데이터 갱신
SADD dirty:inventory inv:{game_id}:{section_id} ← dirty 키 등록
```

둘은 한 쌍으로 실행되어야 합니다 데이터를 바꾸고 dirty 등록을 빠뜨리면 그 변경은 영원히 DB에 반영되지 않습니다 Lua 스크립트나 MULTI/EXEC 트랜잭션으로 원자적으로 묶는 것이 일반적입니다

dirty set 덕분에 flush worker는 **변경된 키만 선택적으로 처리**할 수 있습니다 전체 키 공간을 스캔하는 대신 SMEMBERS 한 번으로 처리 대상 목록을 가져옵니다

### 비동기 배치 Flush Worker

![Write-Behind 쓰기 흐름도 — Dirty Set 적재에서 배치 Flush까지](/diagrams/goti-deepdive-dirty-set-write-behind-1.svg)

위 흐름도는 쓰기 요청이 Redis에 반영되고 DB에 도달하기까지의 경로를 5단계로 보여줍니다

**1단계 — 쓰기 요청**: 애플리케이션은 `SET`/`HSET` 명령으로 Redis에 데이터를 즉시 갱신합니다 이 시점에서 응답이 반환되므로, 클라이언트가 기다리는 시간은 메모리 쓰기 시간뿐입니다

**2단계 — dirty 키 등록**: 동일한 쓰기 사이클 안에서 `SADD dirty:{domain} {key}` 명령으로 변경된 키를 dirty set에 기록합니다 Lua 스크립트로 1·2단계를 원자적으로 묶으면 등록 누락이 없습니다

**3단계 — Worker 폴링**: 별도 goroutine(또는 스케줄된 cron)으로 동작하는 Flush Worker가 주기적으로 `SMEMBERS dirty:{domain}` 명령으로 변경 키 목록을 가져옵니다 이때 `DEL dirty:{domain}`(또는 `SREM`으로 처리 완료된 키 제거)을 함께 수행해 이미 가져간 키가 다음 주기에 중복 처리되지 않도록 합니다

**4단계 — 배치 읽기**: 가져온 키 목록을 기반으로 `MGET`/`HGETALL` 등으로 Redis의 현재 값을 일괄 조회합니다 이 순간의 값이 DB에 쓸 데이터입니다

**5단계 — 배치 UPSERT**: 조회한 값들을 DB에 batch INSERT ON CONFLICT UPDATE(UPSERT)로 반영합니다 한 번의 네트워크 왕복에 여러 행을 처리하므로, 건별 INSERT에 비해 DB 부하가 크게 줄어듭니다

오른쪽의 주기 반복 루프(점선)는 Worker가 이 과정을 계속 반복함을 나타냅니다 flush 주기가 짧을수록 eventual consistency 창이 좁아지고, 길수록 배치 크기가 커져 DB 효율이 높아집니다 trade-off를 고려해 도메인마다 적절한 주기를 선택합니다

### Flush 시 원자성 문제

SMEMBERS로 키 목록을 가져온 뒤 DEL로 dirty set을 비우는 사이, 새 쓰기가 들어오면 그 키가 소실될 수 있습니다 이를 방지하는 일반적인 패턴은 두 가지입니다

**패턴 A — GETDEL + rename 기법**: dirty set을 `RENAME dirty:{d} processing:{d}`로 먼저 이름을 바꾼 뒤, `processing:{d}`를 처리합니다 처리 중에 새로 들어오는 쓰기는 다시 `dirty:{d}`에 쌓입니다 처리가 완료되면 `processing:{d}`를 삭제합니다

**패턴 B — 개별 SREM**: 처리한 키를 개별적으로 `SREM dirty:{d} {key}`로 지웁니다 처리에 실패한 키는 남아 다음 주기에 재처리됩니다 멱등 UPSERT를 전제로 하면 가장 안전합니다

go-ti처럼 멱등한 UPSERT를 DB 레이어에서 보장한다면 패턴 B가 단순하고 안전합니다

---

## 📐 세부 동작과 옵션

### Reconciliation — Drift 감지와 보정

flush worker가 정상 동작하더라도 예외 상황은 발생합니다 Worker 재시작 중 flush 누락, 네트워크 파티션, 버그로 인한 dirty 등록 누락 등이 축적되면 캐시와 DB 사이에 **drift(불일치)**가 생깁니다

Reconciliation은 이를 주기적으로 감지하고 보정하는 **안전망** 역할을 합니다

![Reconciliation 루프 — 캐시-DB drift 감지 및 보정 흐름도](/diagrams/goti-deepdive-dirty-set-write-behind-2.svg)

위 흐름도는 Reconciliation Job이 drift를 처리하는 경로를 보여줍니다

Reconciliation Job은 매 N분마다 실행됩니다 먼저 Redis에서 집계값(예: 재고 카운트, 좌석 수)을 조회하고, 동시에 RDS에서 COUNT를 조회합니다 두 값을 비교해 일치하면 정상으로 판단하고 다음 주기까지 대기합니다

**Drift가 감지되면 두 가지 액션**이 병행됩니다 첫째, 알림 채널(Slack, PagerDuty 등)에 drift 발생을 보고합니다 이를 통해 개발팀이 원인을 파악하고 flush worker 로직을 개선할 수 있습니다 둘째, Redis 값을 RDS 기준으로 덮어씁니다 RDS가 Single Source of Truth이기 때문에 RDS 값이 정답입니다

이 자동 복구는 eventual consistency 시스템이 "결국에는 일치한다"는 보장을 실현하는 핵심 메커니즘입니다

### Flush 주기와 Eventual Consistency 창

flush 주기(interval)는 시스템 특성에 따라 조정합니다

| flush 주기 | 특성 | 적합한 상황 |
|---|---|---|
| 100ms 이하 | eventual consistency 창 매우 좁음, DB 부하 높음 | 수치 정확도가 중요한 도메인 |
| 1~5초 | 균형 — 실시간에 가까운 정합성 | 재고·좌석 수 같은 카운트 도메인 |
| 30초~수분 | DB 부하 최소화, 큰 배치 효율 | 집계 통계, 분석용 데이터 |

flush 주기와 무관하게, reconciliation 주기(예: 5분)는 항상 flush 주기보다 길게 설정합니다 flush가 완료되기 전에 reconciliation이 drift를 "오탐"하면 불필요한 알림이 발생합니다

### 멱등성(Idempotency) 요건

write-behind에서 DB UPSERT는 반드시 **멱등**해야 합니다 동일 키를 두 번 flush해도 결과가 달라지면 안 됩니다

PostgreSQL에서는 `INSERT ... ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`를 사용합니다 "이미 있으면 덮어쓰고, 없으면 삽입"하는 이 패턴은 중복 실행에 안전합니다

멱등 UPSERT가 보장되면 flush 실패 후 재시도, reconciliation의 강제 덮어쓰기 모두 안전하게 동작합니다

---

## 🧩 go-ti에서는

go-ti 티켓팅 플랫폼은 3000 VU 부하 테스트에서 RDS read/lock 경합으로 ticket_success 13~16%를 기록했습니다 병목은 seat_holds와 reservation의 Redis → RDS 동기화 경로에 집중되었습니다

write-behind + dirty set 패턴은 인벤토리 도메인에 먼저 적용되어 있었고, ADR 0014에서 hold/reservation 도메인까지 확장하기로 결정했습니다 Redis에 hold와 reservation을 즉시 반영하고, `dirty:inventory` Set에 변경 키를 기록한 뒤, Sync Worker가 RDS에 배치 UPSERT를 수행하는 구조입니다 DB connection pool이 hold 경로에서 소진되는 문제를 쓰기 경로에서 DB I/O를 분리함으로써 해소했습니다

reconciliation은 매 5분 주기로 Redis와 RDS의 재고·좌석 수를 비교하고, drift가 감지되면 알림과 자동 교정을 수행하도록 설계했습니다(Phase B, SDD 작성 완료 상태)

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [티켓팅 도메인 Redis-first 전환 (ADR)](/logs/goti-redis-first-ticketing-adr)에 정리했습니다

---

## 📚 핵심 정리

- write-behind는 쓰기를 캐시에만 즉시 반영하고 DB는 비동기 배치로 처리합니다 DB I/O가 쓰기 latency 경로에서 제거되어 응답 속도가 빨라집니다
- dirty set은 변경된 키만 추적하는 Redis Set입니다 flush worker가 전체 키를 스캔하는 대신 변경 키 목록을 O(1)로 가져올 수 있게 합니다
- 쓰기와 dirty 등록은 Lua 스크립트나 MULTI/EXEC로 원자적으로 묶어야 합니다 등록이 누락되면 해당 변경은 DB에 도달하지 못합니다
- DB UPSERT는 반드시 멱등해야 합니다 재시도와 reconciliation의 강제 교정이 모두 멱등 UPSERT 위에서 동작합니다
- reconciliation은 주기적으로 캐시-DB 불일치를 감지하고 RDS를 정답으로 Redis를 교정합니다 write-behind의 eventual consistency 보장을 실현하는 안전망입니다
