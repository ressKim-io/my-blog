# 2026-04-15 — Redis SoT 풀 구현 시도, D0~D2 완성 + D3~D6 follow-up

> SDD-0005 풀 구현 결정 후 plan 모드로 작업. AWS 8시 검증 창 + 시간 제약 + 안전성 trade-off로
> D0~D2 (인프라 + seat_statuses + seat_holds)까지 dual-write 모드로 완성, D3~D6는 follow-up.

## 출발

세션 이전: SDD-0005 작성만 완료, 코드 0%. 사용자 요구:
1. "실제 코드 작성 해야되는거 아니야?? 그래야 확인하지않아?"
2. "풀로 가자"
3. "문서 참고해서 plan으로 가면서 하자"

→ Plan 모드 진입 → 2 Explore agents (Goti-go redis 패턴 + Goti-k8s ExternalSecret 패턴) → 풀 plan 작성 (`~/.claude/plans/misty-seeking-orbit.md`) → 사용자 승인 → 실행.

## 안전장치

dual-write 1주일 검증이 SDD 명세지만 단일샷 위험 회피로:
- **read는 feature flag로 토글** (`TicketingConfig.RedisSoT.{SeatStatuses,SeatHolds,Orders,PaymentConfirm,Tickets}`)
- **write는 dual-write** (RDS + Redis 동시. Lua 실패는 RDS write가 SoT라 warning만)
- **D7 RDS 경로 제거는 본 PR 범위 밖**

## 완성된 작업

### D0a — Goti-k8s PR #261

- `infrastructure/prod/redis-cluster/externalsecret.yaml` (NEW) — SSM `/prod/redis-cluster/AUTH_TOKEN` → secret `goti-redis-cluster-auth` (key: `redis-password`)
- `infrastructure/prod/redis-cluster/application.yaml` — 주석 해제 + Bitnami chart 11.3.5 pin

**선행 작업 (manual)**:
```bash
aws ssm put-parameter --name /prod/redis-cluster/AUTH_TOKEN \
  --type SecureString --value "$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)"
```

### D0b — Goti-go a429981

- `pkg/redis/client.go`: `NewClusterClient` (ClusterURL 비어있으면 nil 반환)
- `pkg/config/config.go`: `RedisConfig.ClusterURL`, `TicketingConfig.RedisSoT { SeatStatuses, SeatHolds, Orders, PaymentConfirm, Tickets bool }`
- `pkg/eventbus/bus.go` (NEW): `EventBus` 인터페이스 (Kafka 미래 전환 추상 — SDD-0005 §10)
- `pkg/eventbus/redis_stream.go` (NEW): `RedisStreamBus` (XADD outbox:stream MAXLEN ~1M, XREADGROUP consumer group, XACK, dedup `outbox:dedup:{idemKey}` TTL 24h)
- `internal/ticketing/idgen/snowflake.go` (NEW): 41 bit ts + 10 bit shard + 12 bit seq, hostname hash 기반 shard
- `configs/ticketing.yaml`: `redis_sot.*` 모두 false (안전 기본값)

### D1 seat_statuses Hash SoT — Goti-go 3e1d8bc

- `internal/ticketing/repository/seat_status_sot_repo.go` (NEW):
  - KEY: `seat:{game_id}:{section_id}` (hash tag `{game_id}` cluster slot 통일)
  - HASH field=`seat_id` value=`'A'` / `'H:order:user'` / `'S:order:user'` / `'B'`
  - `HGetAll` / `HSet` / `HSetMany` + `EncodeStatus` / `DecodeStatus` 헬퍼
- `service/seat_status_service.go`: `enableSoTRead` flag on이면 `HGetAll` → miss 시 RDS lazy build (`HSetMany`). off면 기존 cache-aside.
- `cmd/ticketing/main.go`: cluster 가용 시만 `seatStatusSoTRepo` 생성, 비가용이면 nil.

### D2 seat_holds + Lua dual-write — Goti-go c289e90

- `internal/ticketing/lua/seat_hold.lua` (NEW): atomic Lua
  - section_hash[seat] 검증 + SCARD user_holds < cap + SETNX hold_key + HSET section_hash + HINCRBY inv + SADD user_holds + EXPIRE + XADD outbox
  - 모든 KEYS hash tag `{game_id}` → cluster 같은 slot
- `internal/ticketing/lua/seat_release.lua` (NEW): owner 검증 + 역방향 + XADD
- `internal/ticketing/lua/embed.go` (NEW): Go embed가 `..` 불가 → lua 디렉토리에 패키지로 export
- `repository/seat_hold_sot_repo.go` (NEW): `redis.NewScript` wrapper (cluster + 단일 모두 호환)
- `service/seat_hold_service.go`: `HoldSeat` 끝에 dual-write Lua 호출. Lua 실패는 warning만 (RDS가 SoT).

## Follow-up (다음 세션)

| Phase | 작업 | 우선순위 | 사유 |
|---|---|---|---|
| **D3** | inventory reconcile job (1분 주기 HVALS vs HGETALL inv 비교 + auto-repair) | Medium | 기존 inventoryRedisRepo가 동작하므로 drift 검증만 추가. 부하 검증에 critical 아님 |
| **D4** | orders/order_items Hash/List + order_create.lua + dual-write | High | D5의 전제 (order PENDING→PAID CAS). 별도 PR로 분리 권장 |
| **D5** | payment_confirm.lua + outbox worker + payment 서비스 변경 | **Critical** | `/payment-confirmations` 36.65% 5xx의 진짜 fix. payment 동기 chain 단절. 가장 큰 변화 |
| **D6** | tickets Hash/ZSET dual-write | Medium | `/tickets/myinfo` read 가속 |
| **D7** | RDS 경로 제거 (dual-write off) | 추후 | 1주 검증 후 |
| 단위 테스트 (miniredis) | seat_hold/release Lua + sot_repo | High | 이번 세션 미작성, follow-up 필수 |
| Goti-k8s ticketing-v2 values 업데이트 | `TICKETING_REDIS_CLUSTER_URL` env + flag env | High | D0a 머지 후 별도 PR |
| Karpenter ↔ Redis Cluster 12 pod 자원 | nodepool limits cpu=100 vs 12 × 2 = 24 core OK | 검증 | D0a 머지 후 관찰 |

## 의사결정 기록

| 결정 | 채택 | 근거 |
|---|---|---|
| 풀 D0~D6 vs 단계적 | D0~D2 + follow-up | 시간 + 안전성. D5는 payment 서비스도 건드려야 해서 단일 세션 위험 |
| dual-write vs read-only | dual-write | Lua 실패해도 RDS가 SoT라 정합성 안전 |
| feature flag | read만 토글 | write는 항상 dual-write (cluster 가용 시). 실패는 warning |
| Lua 위치 | 별도 lua 패키지 + embed.go | Go embed `..` 불가 회피 |
| Cluster client | 비가용 시 nil → 기존 단일 client 그대로 | 점진적 전환, 무중단 |
| Snowflake shard | hostname hash | Deployment ordinal 없는 환경 대응 |
| EventBus 인터페이스 | RedisStreamBus 1개 impl | SDD-0005 §10 Kafka 미래 전환 추상 |
| outbox stream MAXLEN | ~1M | 7일 보관, 대략적 (~ approx) |

## AWS 검증 시나리오 (8시 복구 후)

### 1. 인프라 활성화
- Goti-k8s PR #261 머지 → ArgoCD `goti-redis-cluster` Application 수동 sync
- 12 pod 기동 확인: `kubectl get pod -n goti -l app.kubernetes.io/name=redis-cluster`
- cluster_state=ok, master 6 + slave 6 검증

### 2. Goti-go 배포
- `Goti-go` main HEAD에 D0~D2 모두 포함됨
- ticketing-v2 이미지 빌드 → values.yaml에 `TICKETING_REDIS_CLUSTER_URL` env 추가 + 배포
- **모든 RedisSoT flag = false** 상태 → 기존 동작 유지 확인

### 3. Smoke Test (flag 1개씩)
- `TICKETING_REDIS_SOT_SEAT_STATUSES=true` 환경변수 패치 → smoke
- `/seat-statuses?gameID=...` 응답 확인 (HGetAll 1 RTT)
- `TICKETING_REDIS_SOT_SEAT_HOLDS=true` → hold/release smoke (Lua dual-write)

### 4. 5차 부하
- flag off 1차: Phase 1+2 효과만 측정
- flag on 2차 (seat_statuses + seat_holds): SoT 효과 측정
- 비교 지표: `/seat-statuses` p50/p95, RDS QPS, ticket_success_rate

## 위험 / 제약

- **단위 테스트 미작성** — Lua 로직 검증 부족. dev에서 smoke 선행 필수
- **Goti-k8s ticketing-v2 values 업데이트 미수행** — `TICKETING_REDIS_CLUSTER_URL` env 추가하는 별도 PR 필요
- **D5 미완성 → `/payment-confirmations` 36.65% 5xx 그대로** — Phase 1+2 + D1/D2 효과만 5차 부하에서 측정
- **outbox worker 미와이어링** — D2 Lua가 XADD하지만 consume하는 worker 없음 → Stream 무한 누적 (MAXLEN ~1M로 자연 trim, MAXLEN으로는 7일 보관)
- **inventoryRedisRepo와 D2 Lua의 inv key 형식 다름** — 기존 `inventory:{gameID}` (Hash field=gradeID), D2 Lua는 `inv:{game_id}:{section_id}` (Hash field=available/held/sold). 부하 시 inventory 정합성 차이 있을 수 있음. **dev 검증 필수**.

## 관련 산출물

- SDD-0005: `docs/dx/0005-redis-source-of-truth-sdd.md`
- Plan: `~/.claude/plans/misty-seeking-orbit.md`
- PR Goti-k8s #261
- Goti-go main: a429981 (D0b), 3e1d8bc (D1), c289e90 (D2)
- 본 dev-log

## 회고

- 풀 구현 의지는 좋았지만 D5 (payment 서비스까지 건드리는 outbox 비동기화)는 단일 세션에 위험
- D0~D2까지는 dual-write 안전장치로 잘 마무리
- 다음 세션에서 D3 (reconcile, 짧음) → D4 (orders) → D5 (payment + outbox worker) 순으로 진행
- 단위 테스트 없이 push한 점 아쉬움. miniredis 기반 테스트 추가 필요
- inv key 형식 차이는 운영 위험이라 D3 reconcile에서 조정 필요
