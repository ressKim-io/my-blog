---
title: "Redis를 SoT로 채택한 이유 — SDD-0005 전면 승격 (ADR)"
excerpt: "ADR-0014 Phase A cache-aside의 한계를 넘어, seat/hold/inventory/order 전 hot path를 Redis Source of Truth로 전환한 아키텍처 결정과 D0~D7 로드맵입니다."
category: challenge
tags:
  - go-ti
  - Redis
  - SoT
  - Architecture Decision Record
  - Ticketing
  - Rollout
  - adr
series:
  name: "goti-redis-sot"
  order: 2
date: "2026-04-17"
---

## 한 줄 요약

> 설계 의도는 Redis SoT였지만 실제 운영은 RDS 직격이었습니다. wiring / feature flag / 인프라 세 축이 전부 어긋나 있었고, 이를 바로잡기 위해 SDD-0005를 공식 ADR로 승격해 D0~D7 로드맵을 고정했습니다.

---

## 배경: 설계와 운영의 삼중 미정렬

### 실관측 — 900ms hot path

프론트엔드 Network 탭에서 관측된 수치부터 확인하겠습니다.

```text
GET /game-seats/{gameId}/sections/{sectionId}/seat-statuses
→ 558~967ms (2026-04-17)
```

좌석 진입 시 이 API가 **14회 동시 호출**되는 hot path입니다. 한 번에 1초 가까이 걸리는 요청이 병렬로 14번 나가니, 사용자 체감 지연은 그대로 누적됩니다.

### 코드 상태의 모순

단순히 "Redis를 안 쓰고 있다"가 아닙니다. 더 이상한 상태였습니다.

1. **핸들러는 PG 직격 경로를 호출합니다.** `seatSvc.GetSeatsBySectionForGame`가 PG LEFT JOIN으로 바로 내려갑니다. 캐시를 우회합니다.
2. **동일 서비스에 Redis 경로가 이미 구현되어 있습니다.** `SeatStatusService.GetSeatStatuses`는 Redis `HGETALL` 1 RTT로 동작하는 코드가 존재합니다. 그러나 핸들러에 wiring되지 않았습니다.
3. **Feature flag가 꺼져 있습니다.** `cfg.Ticketing.RedisSoT.SeatStatuses=false`.
4. **인프라도 준비되지 않았습니다.** GCP Memorystore BASIC 1GB 단일 노드라 `redisCluster=nil`이고, 서비스 생성 단계에서 skip됩니다.
5. **쓰기는 이미 dual-write입니다.** hold/release/confirm은 PG UPDATE와 Redis HSET을 둘 다 수행합니다. 그러나 read는 PG만 바라봅니다. Redis는 **그림자 복제본** 역할만 하고 있었습니다.

정리하면 **wiring / flag / 인프라 세 축이 전부 미정렬**입니다. 설계자의 의도는 Redis SoT였지만, 운영은 RDS 직격이었습니다.

### 기존 결정이 멈춘 이유

이 상태가 방치된 배경에는 두 가지 문서의 정체가 있습니다.

**ADR-0014 (Redis-first ticketing)**는 Phase A(cache-aside TTL 2s, SETNX 잠금)만 Accepted 상태였습니다. Phase B(outbox/reconcile), Phase C(payment 비동기)는 "SDD 작성 완료, 별도 PR"로 남아 진척이 없었습니다.

**SDD-0005 (Redis as SoT)**는 D0~D7 단계별 전환, Lua 스크립트, Redis Stream Outbox, Kafka 전환 경로까지 완성된 설계였습니다. 그러나 status가 `Proposed`에 머물러 있어 공식 결정 기록이 없었고, 이 때문에 실행이 정체되어 있었습니다.

결국 설계는 끝났지만 **실행을 공식적으로 승인한 문서가 없어 움직일 수 없는 상태**였습니다.

---

## 고려한 대안

네 가지 대안을 비교했습니다. 본 ADR이 채택한 C(SDD-0005 전면)는 별도 섹션에서 상술하고, 여기서는 기각된 세 가지를 정리합니다.

| # | 대안 | 기각 사유 |
|---|---|---|
| A | Phase A cache-aside read만 wiring | 2초 stale 윈도우에서 race 조건 발생, dual-write 유지, hot path 일부만 개선 |
| B | seat-statuses read만 Redis SoT (D1 단독) | 병목이 seat-statuses에서 order create로 이동할 뿐, D0 인프라(STANDARD HA) 비용을 피할 수 없고 dual-write도 유지됨 |
| D | Kafka 기반 CQRS 즉시 전환 | Lua atomic 내부에서 Kafka producer 호출 불가. Redis Stream 내부 버퍼 + Kafka bridge 양쪽 운영이 필요해 팀 역량 초과 |

각 대안이 왜 부족한지 조금 더 풀어 설명하겠습니다.

**A안**은 가장 손쉬운 선택지로 보입니다. 이미 구현된 Phase A cache-aside를 wiring만 하면 되기 때문입니다. 그러나 TTL 2초 동안 stale 데이터가 돌아다니는 구간이 생깁니다. hold/release처럼 초당 수십 회 상태가 바뀌는 엔티티에서는 이 2초가 그대로 중복 판매나 잘못된 좌석 표시로 이어질 수 있습니다. 그리고 read만 고칠 뿐이라 dual-write 유지 비용은 그대로 남습니다.

**B안**은 범위를 줄여 리스크를 줄이는 접근입니다. 그러나 seat-statuses의 병목만 해소되면 다음 병목(order create의 PG UPDATE)이 그대로 드러납니다. "D1만 빠르게"가 사실상 불가능한 구조입니다. 또한 read를 Redis로 돌리려면 결국 D0 인프라(eviction 방지 가능한 Redis)가 필요해, 비용 회피도 되지 않습니다.

**D안**은 장기적으로 가장 이상적인 선택지입니다. 다만 Lua 스크립트 내부에서 Kafka로 바로 producer 호출이 불가능하므로, Redis Stream을 내부 버퍼로 두고 Kafka bridge를 따로 운영해야 합니다. 결국 "Redis Stream + Kafka" 양쪽을 모두 돌리는 셈이 되어 팀의 현 역량으로 소화하기 어렵습니다. Kafka 재검토 트리거는 SDD-0005 § 10에 별도로 보존합니다.

---

## 결정: SDD-0005 전면 채택

**SDD-0005를 전면 채택하고, D0~D7을 공식 로드맵으로 고정합니다.**

상태는 Accepted이며, 2026-04-17 개정에서 D0 범위를 "1주 시연(~2026-04-24)" 현실에 맞게 축소했습니다. 이 ADR은 ADR-0014 Phase A를 D1 완료 시점(cache-aside 제거 시점)에 대체(Supersedes)합니다.

### Redis를 타는 엔티티 범위

이 ADR 하에서 **사용자 hot path의 read는 모두 Redis만** 바라봅니다. PG는 영속/감사 용도로만 사용합니다.

| 엔티티 | Redis 자료구조 | RDS 역할 |
|---|---|---|
| seat_statuses | HASH `seat:{game_id}:{section_id}` | Outbox snapshot (audit) |
| seat_holds | STRING `hold:{game_id}:{seat_id}` TTL + SET `user:holds:{user_id}` | 감사 로그만 |
| inventory | HASH `inv:{game_id}:{section_id}` | 1분 reconcile 대상 |
| orders | HASH `order:{order_id}` | PAID 확정 후 영속 |
| order_items | LIST `order:items:{order_id}` | PAID 확정 후 영속 |
| user_orders index | ZSET `user:orders:{user_id}` | 90일+ cold fallback |
| tickets | HASH `ticket:{id}` + ZSET `user:tickets:{user_id}` | 30일+ cold fallback |
| payment_idem | STRING `payment:idem:{pg_tx_id}` TTL 86400 | - |

표에서 눈에 띄는 점을 풀어 설명하겠습니다.

**seat_statuses와 seat_holds, inventory**는 가장 뜨거운 세 엔티티입니다. 이 세 개는 Redis가 단순 캐시가 아니라 **유일한 실시간 진실**이 됩니다. RDS는 감사/reconcile 목적으로만 기록합니다.

**orders / order_items**는 PAID 상태로 확정되기 전까지 Redis에만 존재합니다. 결제 확정 후에야 RDS로 영속합니다. 이 구조가 payment hot path의 p50을 6.5초에서 200ms 이하로 낮추는 핵심입니다.

**tickets와 user_orders index**는 ZSET으로 시간 역순 조회를 지원합니다. 30일·90일을 넘어선 cold data는 RDS fallback을 허용해, Redis 메모리를 무한히 늘리지 않습니다.

**쓰기 경로**는 Lua EVALSHA로 atomic하게 실행하고, `XADD outbox:stream`으로 이벤트를 발행합니다. `goti-outbox-worker`가 `XREADGROUP`으로 이를 소비해 RDS에 idempotent UPSERT를 수행합니다.

**읽기 경로**는 사용자 hot path에서는 Redis만 사용합니다. PG 접근은 금지합니다. 다만 90일·30일을 넘어선 cold data 조회는 RDS fallback을 허용합니다.

### 결정 규칙 (불변)

아래 여섯 가지는 본 ADR이 유효한 동안 예외 없이 지켜야 합니다.

1. **Read 경로에서 PG를 호출하는 신규 코드는 merge 금지**입니다. 단, hot path 한정입니다.
2. **Dual-write 잔재는 각 D 완료와 동일 PR에서 제거**합니다. "별도 PR에서 정리"로 미루지 않습니다.
3. **핸들러는 Redis-aware 서비스로 라우팅**합니다. 기존 중복 경로(PG 직격 / Redis 경로)는 D1 PR에서 하나로 통합합니다.
4. **`redisCluster=nil`이면 hot path 기동을 실패**시킵니다(fail-fast). "Redis 없으면 PG로 fallback" 같은 silent degradation은 금지합니다. 이 규칙이 없으면 운영 중 조용히 RDS로 폴백해 다시 900ms로 돌아갑니다.
5. **Phase A cache-aside는 D1 완료 PR에서 제거**합니다. SoT와 cache의 공존은 일관성 혼선의 원인이므로 허용하지 않습니다.
6. **Feature flag는 rollout 1주 한정**입니다. 검증 후 flag와 경로를 단일화합니다. 영구 flag는 남기지 않습니다.

### D0 인프라 — 3단계 전략

**2026-04-17 개정**에서 프로젝트 종료일(~2026-04-24)을 확인하고, Start 범위를 1주 시연 현실에 맞춰 대폭 축소했습니다. Mid/Target은 장기 prod 재개 시 참조용으로 보존합니다.

프로덕션 운영 범위는 **기아 + 삼성 홈구장 2구장**이며, 실수요 메모리는 약 280MB, 처리량은 수천 req/s입니다.

**Start (1주 시연 — 2026-04-24 종료 프로젝트)**

- GCP Memorystore **BASIC 1GB** 그대로 유지
- `maxmemory-policy`: `allkeys-lru` → `noeviction`만 교체 (in-place update, 비용 $0)
- 다운타임 초 단위, host/auth 재생성 없음, 앱 Pod 재시작 불필요
- 1GB 실수요 280MB 대비 여유 충분
- 적용: Goti-Terraform `9761dd2`

**Mid (장기 prod 재개 시 — 보존)**

- Memorystore **STANDARD HA 5GB** (primary + replica)
- 월 약 $266 추가, force-replace (다운타임 30~60분)
- 전환 기준: 프로젝트 재개 + 장기 운영 확정 OR 시연 중 OOM 발생

**Target (10팀 확장 시 — 보존)**

- Memorystore **Cluster 3~6 shard + 1 replica**
- 월 약 $600~1,500
- 전환 기준: CPU > 70% 지속 OR ops/s > 80k 지속 OR used_memory > 3GB OR 10팀 확장
- 전환 비용: endpoint 교체만 (`UniversalClient` 추상 덕분에 코드 재작성 없음)

**공통 불변 (Start부터 준수)**

- **Hash tag `{game_id}`**: 추후 Cluster 전환 시 재작성이 필요 없도록 키 설계 단계에서 강제합니다.
- **`redis.UniversalClient` 추상**: 구체 타입(`*redis.Client`, `*redis.ClusterClient`)을 직접 사용하지 않습니다. 인프라 승격 시 endpoint 교체만으로 끝나도록 하기 위함입니다.
- **메모리 정책 `noeviction`**: 티켓 중복 판매 방지의 생명선입니다. `allkeys-lru`로 남겨두면 메모리 압박 시 임의 키가 증발해 hold/inventory 무결성이 깨집니다.
- **NetworkPolicy**: ticketing / payment / stadium / queue namespace만 6379 포트를 허용합니다 (Goti-k8s 작업).
- **모니터링**: `used_memory`, `slowlog`, `ops/s`. Mid/Target 승격 시에는 `replication_lag`, `cluster_state`, Lua p99를 추가합니다.

AWS 쪽은 prod 재기동 시점에 **현재는 동급 최소 구성**을 유지하고, 장기 운영 결정 후 Standard/Cluster로 승격합니다.

### 롤아웃 단계

전체 흐름은 다음과 같습니다.

```text
D0 인프라
 → D1 seat_statuses
 → D2 seat_holds
 → D3 inventory
 → D4 orders/items
 → D5 payment + Outbox worker
 → D6 tickets
 → D7 dual-write off
```

각 D 단계의 PR 체크리스트, Exit criteria, Rollback trigger는 SDD-0005 갱신에서 정의합니다. 본 ADR은 이 순서와 의존성만 고정합니다.

### 진행 상황 (2026-04-17 기준)

부하 목표가 10만~50만 TPS로 격상되면서, 1주 시연 범위를 D0~D7 전체로 확장했습니다.

| D | 상태 | 커밋 / 비고 |
|---|---|---|
| D0 Memorystore `noeviction` | 완료 | Goti-Terraform `9761dd2` |
| D1 seat-statuses Redis HGETALL | 완료 | Goti-go `e1bc2f3` + Goti-k8s `b422b9f` |
| D2 seat_holds Lua + PG write 제거 | 완료 | Goti-go `b8466a0` |
| D3 inventory 1분 reconcile + metric | 완료 | Goti-go `0159918` |
| D4 orders Redis SoT + Lua | 완료 | Goti-go `2fa267a` |
| D5a goti-outbox-worker 신규 서비스 | 진행 중 | — |
| D5b payment_confirm.lua | 대기 | 의존: D5a |
| D5c dual-write off | 대기 | 의존: D5a/b |
| D6 tickets Redis HASH + ZSET | 대기 | — |
| D7 Phase A cache 제거 + flag 일괄 제거 | 대기 | — |

**치명적 의존 관계**가 하나 있습니다. D4 이후 `ORDER_CREATED` 이벤트는 outbox stream에 쌓이지만, consumer인 D5a가 미구축이라 **RDS의 orders / order_items 영속이 비어 있는 상태**입니다. D5a를 최우선 후속 작업으로 즉시 착수합니다.

인프라(Memorystore STANDARD_HA / Cluster 전환)는 D0 Start 범위를 유지하며, 부하 단계별 병목이 발견되는 시점에 순차 확장합니다. 각 전환은 별도 dev-log로 기록하는 점진적 인프라 확장 전략을 따릅니다.

---

## 근거: 목표 지표와 리스크

### 목표 지표

본 ADR이 달성하고자 하는 정량 목표입니다.

- `/seat-statuses` p95: **900ms → < 50ms**
- `/payment-confirmations` p50: **6.5s → < 200ms**
- 3000 VU ticket_success: **13~16% → 80%+**
- 사용자 경로 RDS round-trip: **0회**
- PG QPS: **90% 감소**

숫자만 나열하면 크기 감이 잘 오지 않으니 풀어 설명하겠습니다.

`/seat-statuses`의 p95가 900ms에서 50ms 미만으로 떨어진다는 것은, 좌석 진입 시 14회 병렬 호출의 누적 대기가 수초에서 수백 ms 이하로 줄어든다는 의미입니다. 사용자가 좌석을 클릭한 순간부터 렌더링되는 시간이 체감적으로 다른 제품이 됩니다.

`/payment-confirmations` p50이 6.5s에서 200ms로 내려가는 것은 더 극적입니다. 결제 버튼을 누른 뒤 6초 넘게 기다리던 사용자가 200ms 안에 결과를 보게 됩니다. 티켓팅 도메인에서 결제 지연은 곧 이탈이므로, 이 한 줄이 서비스 품질의 중심 지표입니다.

3000 VU ticket_success가 13~16%에서 80%+로 올라간다는 것은 **부하 상황에서 실제로 티켓을 받는 사용자 비율**이 다섯 배 이상 뛴다는 뜻입니다. 대기열 POC에서 측정한 기존 수치와 비교하면 전혀 다른 시스템에 가깝습니다.

### 리스크

이득만큼의 리스크도 명확합니다.

- **Redis 전체 장애 시 사용자 경로 영향도 증가**: 기존에는 Redis가 죽어도 PG가 답했지만, 본 ADR에서는 hot path가 **Redis 없이 동작하지 않습니다**. SDD-0005 § 7 degrade mode 준수가 필수입니다.
- **AOF 최대 1초 유실 가능성**: 장애 시점의 마지막 1초 데이터가 손실될 수 있습니다. `outbox-replay`와 `redis-rebuild-from-rds` 운영 스크립트를 사전에 준비해야 합니다.
- **Lua 운영 역량 요구**: atomic 로직이 Lua 스크립트로 이동하므로, miniredis 단위 테스트, canary 배포, script 버전 태깅이 의무입니다. 한 번 잘못 배포하면 모든 트랜잭션이 영향을 받습니다.

### Reversibility

단계별 가역성이 크게 다릅니다.

**D0~D3 구간**은 feature flag off로 RDS 경로 복귀가 가능합니다. 이 구간에서는 dual-write가 유지되므로, PG에도 동일한 데이터가 있습니다.

**D4 이후**부터는 실질적 비가역입니다. orders가 Redis SoT로 전환된 뒤 dual-write가 제거되면, RDS에는 영속된 데이터만 남습니다. 롤백하려면 outbox replay와 RDS snapshot 복원을 병행해야 합니다.

각 D의 Rollback trigger는 SDD-0005 갱신에 명시합니다.

---

## 후속 작업

본 ADR 승인 직후 처리할 항목입니다.

1. **SDD-0005 갱신**: Current Code Audit 섹션 추가, D0 인프라 Memorystore Cluster vs StatefulSet 비교·선택 확정, 각 D의 PR 체크리스트 / Exit criteria / Rollback trigger 정의.
2. **D0 PR**: Goti-k8s — NetworkPolicy 및 Terraform 변경 사항 반영.
3. **D1 PR**: Goti-go — 핸들러 재배선 + flag on + Phase A cache 제거.
