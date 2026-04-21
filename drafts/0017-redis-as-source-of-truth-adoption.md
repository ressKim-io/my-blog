# ADR 0017 — Redis as Source of Truth 전면 채택 (SDD-0005 승격)

- 상태: Accepted (2026-04-17 개정: 1주 시연 Start 범위로 D0 축소)
- 결정일: 2026-04-17
- Supersedes: `docs/adr/0014-redis-first-ticketing.md` Phase A (D1 완료 시점에 cache-aside 제거로 대체)
- 상세 설계: `docs/dx/0005-redis-source-of-truth-sdd.md` (본 ADR 로 공식 채택, 실행 계획은 SDD 갱신에서 정의)
- 참고: `docs/dx/0004-ticketing-hotpath-root-cause-sdd.md`, `docs/dx/0002-seat-status-hotpath-perf.md`
- 영향 레포: Goti-go, Goti-k8s, Goti-Terraform

## 컨텍스트

### 실관측

`GET /game-seats/{gameId}/sections/{sectionId}/seat-statuses` 응답 **558~967ms** (2026-04-17, 프론트 Network 탭). 좌석 진입 시 14 회 동시 호출되는 hot path.

### 코드 상태 (모순)

1. 핸들러는 `seatSvc.GetSeatsBySectionForGame` 호출 → PG LEFT JOIN 직격, 캐시 우회
2. **동일 서비스에 `SeatStatusService.GetSeatStatuses` 가 Redis HGETALL 1 RTT 경로로 이미 구현되어 있음**. 그러나 핸들러 wiring X, `cfg.Ticketing.RedisSoT.SeatStatuses=false`, GCP Memorystore BASIC 1GB 단일 노드라 `redisCluster=nil` → 생성조차 skip
3. hold/release/confirm 쓰기는 PG UPDATE + Redis HSET **dual-write**, 그러나 read 는 PG 만. Redis 는 그림자 복제본.

설계 의도는 Redis SoT, 실제 운영은 RDS 직격. **wiring / flag / 인프라 3 개 모두 미정렬**.

### 기존 결정 한계

- **ADR-0014** (Redis-first ticketing): Phase A (cache-aside TTL 2s, SETNX 잠금) 만 Accepted. Phase B (outbox/reconcile), Phase C (payment 비동기) 는 "SDD 작성 완료, 별도 PR" 로 정체.
- **SDD-0005** (Redis as SoT): D0~D7 단계별 전환, Lua 스크립트, Redis Stream Outbox, Kafka 전환 경로까지 완성 설계. Status `Proposed`. 결정 기록 부재로 실행 정체.

## 고려한 대안

| # | 대안 | 기각 사유 |
|---|---|---|
| A | Phase A cache-aside read 만 wiring | 2s stale 윈도우 race, dual-write 유지, hot path 일부만 개선 |
| B | seat-statuses read 만 Redis SoT (D1 단독) | 병목 이동 (seat-statuses → order create), D0 인프라 (STANDARD HA) 비용 회피 불가, dual-write 유지 |
| D | Kafka 기반 CQRS 즉시 전환 | Lua atomic 안 Kafka producer 불가 → Redis Stream 내부 버퍼 + Kafka bridge 로 양쪽 운영, 팀 역량 초과. Kafka 재검토 트리거는 SDD-0005 § 10 에 보존 |

## 결정

**SDD-0005 전면 채택.** D0~D7 을 공식 로드맵으로 고정.

### 범위 — 이 ADR 하에서 Redis 를 타는 엔티티

| 엔티티 | Redis 자료구조 | RDS 역할 |
|---|---|---|
| seat_statuses | HASH `seat:{game_id}:{section_id}` | Outbox snapshot (audit) |
| seat_holds | STRING `hold:{game_id}:{seat_id}` TTL + SET `user:holds:{user_id}` | 감사 로그만 |
| inventory | HASH `inv:{game_id}:{section_id}` | 1 분 reconcile 대상 |
| orders | HASH `order:{order_id}` | PAID 확정 후 영속 |
| order_items | LIST `order:items:{order_id}` | PAID 확정 후 영속 |
| user_orders index | ZSET `user:orders:{user_id}` | 90 일+ cold fallback |
| tickets | HASH `ticket:{id}` + ZSET `user:tickets:{user_id}` | 30 일+ cold fallback |
| payment_idem | STRING `payment:idem:{pg_tx_id}` TTL 86400 | - |

**쓰기**: Lua EVALSHA 로 atomic 실행, `XADD outbox:stream` 으로 이벤트 발행, `goti-outbox-worker` 가 XREADGROUP → RDS idempotent UPSERT.

**읽기**: 사용자 경로 API 는 Redis 만. PG 접근 금지 (hot path 한정). 90 일+ cold data 만 RDS fallback 허용.

### 결정 규칙 (불변)

1. read 경로에서 PG 호출하는 신규 코드는 merge 금지 (hot path 한정).
2. dual-write 잔재는 각 D 완료 **same-PR** 에서 제거. 별도 PR 미루기 금지.
3. 핸들러는 Redis-aware 서비스로 라우팅. 중복 경로는 D1 PR 에서 통합.
4. `redisCluster=nil` 이면 hot path 기동 **실패** (fail-fast). "Redis 없으면 PG fallback" 같은 silent degradation 금지.
5. Phase A cache-aside 는 D1 완료 PR 에서 제거. SoT 와 cache 공존 금지.
6. Feature flag 는 rollout 1 주 전용. 검증 후 flag + 경로 단일화. 영구 잔존 금지.

### D0 인프라 — 요건

**2026-04-17 개정**: 프로젝트 종료 ~2026-04-24 확인. Start 를 1주 시연 현실로 대폭 축소. Mid/Target 은 장기 prod 재개 시 참조용으로 보존.

프로덕션 운영 범위 **기아 + 삼성 홈구장 2 구장**. 실수요 메모리 ~280MB / 처리량 수천 req/s.

**Start (1주 시연 — 2026-04-24 종료 프로젝트)**
- GCP Memorystore **BASIC 1GB** 그대로 유지
- `maxmemory-policy: allkeys-lru → noeviction` 만 교체 (in-place update, 비용 $0)
- 다운타임 초 단위, host/auth 재생성 없음, 앱 pod 재시작 불필요
- 1GB 실수요 280MB 대비 여유 충분
- 적용: Goti-Terraform `9761dd2`

**Mid (장기 prod 재개 시 — 보존)**
- Memorystore **STANDARD HA 5GB** (primary + replica)
- 월 ~$266 추가, force-replace (다운타임 30~60 분)
- 전환 기준: 프로젝트 재개 + 장기 운영 확정 OR 시연 중 OOM 발생

**Target (10팀 확장 시 — 보존)**
- Memorystore **Cluster 3~6 shard + 1 replica**
- 월 ~$600~1,500
- 전환 기준: CPU > 70% 지속 OR ops/s > 80k 지속 OR used_memory > 3GB OR 10팀 확장
- 전환 비용: endpoint 교체만 (`UniversalClient` 추상 덕분에 코드 재작성 없음)

**공통 불변 (Start 부터 준수)**
- hash tag `{game_id}` (Cluster 전환 시 재작성 없도록)
- `redis.UniversalClient` 추상 — 구체 타입 직접 사용 금지
- 메모리 정책 **noeviction** (eviction = 티켓 중복판매)
- NetworkPolicy: ticketing / payment / stadium / queue namespace 만 6379 허용 (Goti-k8s 작업)
- 모니터링: used_memory, slowlog, ops/s (Mid/Target 에서 replication_lag, cluster_state, Lua p99 추가)

AWS 쪽은 prod 재기동 시 **현재는 동급 최소 구성**, 장기 운영 결정 후 Standard/Cluster 로 승격.

### 롤아웃 단계 (상세는 SDD-0005 갱신)

D0 인프라 → D1 seat_statuses → D2 seat_holds → D3 inventory → D4 orders/items → D5 payment + Outbox worker → D6 tickets → D7 dual-write off.

각 D 의 PR 체크리스트, Exit criteria, Rollback trigger 는 SDD-0005 갱신에서 정의.

### 진행 상황 (2026-04-17 기준)

부하 목표 10만~50만 TPS 로 격상되며 1주 시연 범위를 D0~D7 전체로 확장.

| D | 상태 | 커밋 / 비고 |
|---|---|---|
| D0 Memorystore `noeviction` | ✅ apply 완료 | Goti-Terraform `9761dd2` |
| D1 seat-statuses Redis HGETALL | ✅ 완료 | Goti-go `e1bc2f3` + Goti-k8s `b422b9f` |
| D2 seat_holds Lua + PG write 제거 | ✅ 완료 | Goti-go `b8466a0` |
| D3 inventory 1분 reconcile + metric | ✅ 완료 | Goti-go `0159918` |
| D4 orders Redis SoT + Lua | ✅ 완료 | Goti-go `2fa267a` |
| D5a goti-outbox-worker 신규 서비스 | ⏳ 진행 중 | — |
| D5b payment_confirm.lua | ⏳ 대기 | 의존: D5a |
| D5c dual-write off | ⏳ 대기 | 의존: D5a/b |
| D6 tickets Redis HASH + ZSET | ⏳ 대기 | |
| D7 Phase A cache 제거 + flag 일괄 제거 | ⏳ 대기 | |

**치명적 의존**: D4 이후 `ORDER_CREATED` 이벤트는 outbox stream 에 쌓이지만 consumer (D5a) 미구축 상태라 **RDS orders/order_items 영속이 비어있다**. D5a 를 최우선 후속 작업으로 즉시 착수.

인프라 (Memorystore STANDARD_HA / Cluster 전환) 은 D0 Start 범위 유지. 부하 단계별 병목 발견 시점에 순차 확장 + 각 전환을 별도 dev-log 로 기록 (점진적 인프라 확장 기록 전략).

## 결과

### 목표 지표

- `/seat-statuses` p95 900ms → **< 50ms**
- `/payment-confirmations` p50 6.5s → **< 200ms**
- 3000 VU ticket_success 13~16% → **80%+**
- 사용자 경로 RDS round-trip **0 회**, PG QPS **90%↓**

### 리스크

- Redis 전체 장애 시 사용자 경로 영향도 증가 → SDD-0005 § 7 degrade mode 준수 필수
- AOF 최대 1 초 유실 → `outbox-replay`, `redis-rebuild-from-rds` 운영 스크립트 준비 필수
- Lua 운영 역량 — miniredis 단위 테스트, canary 배포, script 버전 태깅 의무

### Reversibility

- D0~D3: feature flag off 로 RDS 경로 복귀 가능 (dual-write 유지 구간)
- D4 이후: 실질적 비가역. 롤백은 outbox replay + RDS snapshot
- 각 D 별 Rollback trigger 는 SDD-0005 갱신에 명시

## 후속

1. SDD-0005 갱신: Current Code Audit, D0 인프라 Memorystore Cluster vs StatefulSet 비교·선택, 각 D PR 체크리스트 / Exit criteria / Rollback
2. D0 PR (Goti-k8s)
3. D1 PR (Goti-go handler 재배선 + flag on + Phase A cache 제거)
