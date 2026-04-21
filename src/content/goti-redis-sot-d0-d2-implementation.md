---
title: "D0~D2 구현 — 이중쓰기로 Redis SoT 전환 시작"
excerpt: "SDD-0005 풀 구현 계획 중 D0~D2(인프라 + seat_statuses + seat_holds)까지 dual-write 모드로 완성하고, D3~D7은 follow-up으로 분리한 기록"
category: challenge
tags:
  - go-ti
  - Redis
  - SoT
  - Implementation
  - Rollout
  - Ticketing
  - Lua
series:
  name: "goti-redis-sot"
  order: 4
date: "2026-04-15"
---

## 한 줄 요약

> SDD-0005에서 결정한 Redis SoT 풀 구현을 시도했습니다. 시간 제약과 안전성 trade-off로 D0~D2(인프라, seat_statuses, seat_holds)까지 dual-write 모드로 완성하고, D3 이후는 follow-up으로 분리했습니다.

---

## 🔥 문제: SDD만 있고 코드가 없다

앞선 세션에서 `SDD-0005 Redis Source of Truth` 명세만 완성된 상태였습니다. 실제 코드는 0% 진행이었습니다.

세션 시작 시 사용자의 요구는 세 가지였습니다.

1. "실제 코드 작성 해야되는거 아니야?? 그래야 확인하지않아?"
2. "풀로 가자"
3. "문서 참고해서 plan으로 가면서 하자"

명세만 가지고는 부하 검증을 할 수 없습니다. `/payment-confirmations` 경로의 36.65% 5xx 에러를 실제로 줄이려면 코드가 있어야 합니다.

그래서 plan 모드로 진입해서 작업을 구조화했습니다.

- Explore agent 2개를 병렬 실행했습니다. 하나는 `Goti-go` 내 기존 Redis 사용 패턴을, 다른 하나는 `Goti-k8s`의 ExternalSecret 패턴을 조사했습니다.
- 조사 결과를 바탕으로 풀 plan을 작성했습니다 (`~/.claude/plans/misty-seeking-orbit.md`).
- 사용자 승인 후 실행에 들어갔습니다.

---

## 🤔 원인: 풀 구현을 단일 세션에 넣기 어려운 구조

SDD-0005의 원래 방침은 **dual-write 1주일 검증**이었습니다. 충분한 시간 여유를 두고 데이터 정합성을 확인한 뒤 SoT로 넘어가는 흐름입니다.

그러나 이번 세션에는 두 가지 제약이 있었습니다.

**AWS 검증 창**. 8시에 AWS가 복구되면 바로 검증해야 했습니다. 그때까지 코드가 머지 가능한 상태여야 했습니다.

**단일샷 위험**. D0에서 D6까지 전부 한 번에 커밋하면, 어느 레이어에서 문제가 발생해도 원인을 좁히기 어렵습니다. 특히 D5(payment 서비스 + outbox worker)는 결제 동기 호출 체인을 비동기화하는 큰 변경이라 위험도가 다른 단계보다 훨씬 높습니다.

두 제약을 동시에 만족시키려면, 핵심 안전장치를 넣은 상태에서 범위를 D0~D2로 축소하는 게 합리적이었습니다.

---

## ✅ 해결: 안전장치 3종으로 무장한 D0~D2 완성

### 안전장치 설계

SDD 명세의 dual-write 1주 검증을 짧게 압축하는 대신, 세 개의 안전장치를 설계했습니다.

- **read는 feature flag로 토글**합니다. `TicketingConfig.RedisSoT.{SeatStatuses, SeatHolds, Orders, PaymentConfirm, Tickets}` 다섯 개의 플래그를 개별 제어합니다. 배포 후에도 환경변수 하나로 on/off가 가능합니다.
- **write는 항상 dual-write**입니다. RDS와 Redis 양쪽에 동시에 기록합니다. Lua 실패는 warning만 남기고 진행합니다. RDS가 여전히 SoT이기 때문에 정합성 위험이 없습니다.
- **D7 RDS 경로 제거는 본 PR 범위 밖**으로 고정했습니다. 즉, 이번에는 어떤 경로로도 RDS를 건너뛰지 않습니다.

이 세 가지 덕분에 "최악의 경우 read flag를 off로 돌리면 기존 동작으로 회귀"라는 롤백 전략이 확보됩니다.

### D0a — Goti-k8s PR #261 (인프라)

인프라 쪽 변경은 ExternalSecret과 Application manifest 두 개입니다.

`infrastructure/prod/redis-cluster/externalsecret.yaml`을 새로 추가했습니다. SSM 파라미터 `/prod/redis-cluster/AUTH_TOKEN`을 K8s secret `goti-redis-cluster-auth`의 `redis-password` 키로 주입합니다.

`infrastructure/prod/redis-cluster/application.yaml`은 주석을 해제하고 Bitnami chart `11.3.5` 버전으로 pin했습니다.

선행 작업으로 SSM 파라미터를 먼저 생성해야 합니다.

```bash
aws ssm put-parameter --name /prod/redis-cluster/AUTH_TOKEN \
  --type SecureString \
  --value "$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)"
```

AUTH_TOKEN은 32바이트 random으로 생성합니다. `/+=`를 제거하는 이유는 Redis URL 파싱 호환성 때문입니다.

### D0b — Goti-go a429981 (클라이언트 + 추상화)

Go 서비스 쪽은 클라이언트, 설정, 이벤트버스, ID 생성기를 준비했습니다.

- `pkg/redis/client.go`에 `NewClusterClient`를 추가했습니다. `ClusterURL`이 비어 있으면 nil을 반환합니다. 이것이 **점진적 전환**의 핵심입니다. cluster가 가용하지 않은 환경에서는 기존 단일 Redis client가 그대로 동작합니다.
- `pkg/config/config.go`에 `RedisConfig.ClusterURL`과 `TicketingConfig.RedisSoT` 구조체를 추가했습니다. 다섯 개의 bool 플래그가 read 토글입니다.
- `pkg/eventbus/bus.go`에 `EventBus` 인터페이스를 정의했습니다. SDD-0005 §10의 "Kafka 미래 전환" 추상화를 코드로 표현한 것입니다.
- `pkg/eventbus/redis_stream.go`에 `RedisStreamBus` 구현을 추가했습니다. `outbox:stream`에 XADD하고 MAXLEN `~1M`로 자연 trim합니다. XREADGROUP consumer group, XACK, `outbox:dedup:{idemKey}` TTL 24h로 dedup을 구현했습니다.
- `internal/ticketing/idgen/snowflake.go`에 41bit timestamp + 10bit shard + 12bit seq 구성의 snowflake를 추가했습니다. shard는 hostname hash로 결정합니다. Deployment ordinal이 없는 환경에서도 동작하게 하기 위함입니다.
- `configs/ticketing.yaml`에서 `redis_sot.*`는 모두 false로 설정했습니다. 안전 기본값입니다.

### D1 seat_statuses Hash SoT — Goti-go 3e1d8bc

좌석 상태를 Redis Hash로 이전했습니다.

```go
// KEY: seat:{game_id}:{section_id}   (hash tag {game_id}로 cluster slot 통일)
// HASH field=seat_id, value=상태 코드
//   'A'              = Available
//   'H:order:user'   = Held
//   'S:order:user'   = Sold
//   'B'              = Blocked
```

`{game_id}`를 hash tag로 쓰는 이유는 **같은 게임의 모든 섹션 키가 cluster의 같은 slot에 들어가도록** 하기 위함입니다. 이후 D2의 Lua 스크립트가 여러 key를 atomic하게 다룰 때 필수 조건입니다.

`seat_status_sot_repo.go`에는 `HGetAll`, `HSet`, `HSetMany`와 `EncodeStatus` / `DecodeStatus` 헬퍼를 구현했습니다.

서비스 레이어는 `enableSoTRead` 플래그로 분기합니다.

- 플래그 on이면 `HGetAll`로 1 RTT에 섹션 전체를 읽습니다. miss 시 RDS에서 lazy build 후 `HSetMany`로 채웁니다.
- 플래그 off면 기존 cache-aside 로직을 그대로 탑니다.

`cmd/ticketing/main.go`에서는 cluster가 가용할 때만 `seatStatusSoTRepo`를 만듭니다. 비가용이면 nil이 전달되고 서비스는 기존 경로로 fallback합니다.

### D2 seat_holds + Lua dual-write — Goti-go c289e90

좌석 hold/release는 Lua로 atomic하게 처리했습니다.

`internal/ticketing/lua/seat_hold.lua`가 하는 일을 단계별로 정리하겠습니다.

1. `section_hash[seat]` 값을 읽어서 현재 상태가 `A`(Available)인지 검증합니다.
2. `user_holds:{user_id}` SET의 크기를 SCARD로 확인해서 사용자별 hold 개수 cap을 체크합니다.
3. SETNX로 `hold:{seat_id}` 키를 선점합니다. 이미 있으면 실패 반환.
4. HSET으로 `section_hash[seat]`를 `H:order:user`로 바꿉니다.
5. HINCRBY로 inventory hash(`inv:{game_id}:{section_id}`)의 available/held 필드를 조정합니다.
6. SADD로 `user_holds`에 seat_id를 추가하고 EXPIRE로 TTL을 설정합니다.
7. XADD로 outbox stream에 이벤트를 씁니다. MAXLEN `~1M`입니다.

**모든 KEYS에는 hash tag `{game_id}`**가 들어갑니다. 이것이 cluster 환경에서 Lua가 돌아가는 유일한 조건입니다. Redis Cluster는 한 Lua 안의 키들이 전부 같은 slot에 있어야만 실행을 허용합니다.

`seat_release.lua`는 역방향입니다. owner 검증 후 역 연산 + XADD로 release 이벤트를 기록합니다.

Go embed 쪽에 한 가지 문제가 있었습니다. Go embed는 상위 디렉토리를 참조할 수 없습니다(`..` 불가). 그래서 `internal/ticketing/lua/` 디렉토리에 별도 패키지를 만들고 `embed.go`에서 lua 파일을 export하는 방식으로 회피했습니다.

`seat_hold_sot_repo.go`는 `redis.NewScript`를 감싸는 wrapper입니다. cluster와 단일 Redis 모두 호환됩니다.

서비스 쪽에서는 `HoldSeat` 끝에 Lua 호출을 추가했습니다. Lua 실패는 warning 로그만 남기고 진행합니다. RDS가 여전히 SoT이기 때문에 정합성이 깨지지 않습니다.

---

## 🤔 Follow-up으로 분리한 이유

이번 세션에서 D3~D7은 전부 follow-up으로 미뤘습니다. 각 단계별로 다음 세션에서 처리할 작업과 우선순위를 정리했습니다.

| Phase | 작업 | 우선순위 | 사유 |
|---|---|---|---|
| **D3** | inventory reconcile job (1분 주기 HVALS vs HGETALL 비교 + auto-repair) | Medium | 기존 inventoryRedisRepo가 동작하므로 drift 검증만 추가하면 됩니다. 부하 검증에는 critical하지 않습니다. |
| **D4** | orders/order_items Hash/List + order_create.lua + dual-write | High | D5의 전제입니다. order PENDING→PAID CAS가 필요합니다. 별도 PR 권장입니다. |
| **D5** | payment_confirm.lua + outbox worker + payment 서비스 변경 | **Critical** | `/payment-confirmations` 36.65% 5xx의 실제 fix입니다. payment 동기 chain을 끊습니다. 가장 큰 변화입니다. |
| **D6** | tickets Hash/ZSET dual-write | Medium | `/tickets/myinfo` read 가속입니다. |
| **D7** | RDS 경로 제거 (dual-write off) | 추후 | 1주 검증 후에 진행합니다. |
| 단위 테스트 (miniredis) | seat_hold/release Lua + sot_repo | High | 이번 세션에 미작성입니다. follow-up 필수입니다. |
| Goti-k8s ticketing-v2 values | `TICKETING_REDIS_CLUSTER_URL` + flag env 추가 | High | D0a 머지 후 별도 PR입니다. |
| Karpenter ↔ Redis Cluster 12 pod 자원 | nodepool limits 검증 (cpu=100 vs 12×2=24 core OK) | 검증 | D0a 머지 후 관찰합니다. |

D5가 가장 critical한데 단일 세션에서 처리하지 않은 이유가 중요합니다. payment 서비스는 다른 서비스와 동기 호출 체인으로 연결돼 있습니다. 이 호출을 outbox worker를 통한 비동기 이벤트로 바꾸는 변경은, 호출 순서·타임아웃·재시도 정책이 전부 달라지는 구조 변경입니다. D0~D2와 같은 세션에 올리면 디버깅 범위가 너무 넓어집니다.

---

## ✅ 의사결정 기록

이번 세션에서 내린 주요 의사결정을 정리합니다.

| 결정 | 채택 | 근거 |
|---|---|---|
| 풀 D0~D6 vs 단계적 | D0~D2 + follow-up | 시간과 안전성입니다. D5가 payment 서비스까지 건드려야 해서 단일 세션 위험이 큽니다. |
| dual-write vs read-only | dual-write | Lua 실패해도 RDS가 SoT라 정합성이 안전합니다. |
| feature flag 범위 | read만 토글 | write는 cluster 가용 시 항상 dual-write입니다. 실패는 warning만. |
| Lua 위치 | 별도 lua 패키지 + embed.go | Go embed가 `..`를 허용하지 않는 제약을 회피하기 위함입니다. |
| Cluster client | 비가용 시 nil → 기존 단일 client 사용 | 점진적 전환이 가능하고 무중단입니다. |
| Snowflake shard | hostname hash | Deployment ordinal이 없는 환경에 대응합니다. |
| EventBus 인터페이스 | RedisStreamBus 1개 impl | SDD-0005 §10의 Kafka 미래 전환 추상화입니다. |
| outbox stream MAXLEN | `~1M` | 약 7일 보관 기준의 대략적(approx) 값입니다. |

---

## ✅ AWS 검증 시나리오 (8시 복구 후)

복구 이후의 검증 순서를 네 단계로 정리했습니다.

### 1. 인프라 활성화

- Goti-k8s PR #261을 머지합니다.
- ArgoCD에서 `goti-redis-cluster` Application을 수동 sync합니다.
- 12 pod 기동을 확인합니다.

```bash
$ kubectl get pod -n goti -l app.kubernetes.io/name=redis-cluster
```

- `cluster_state=ok`, master 6 + slave 6 구성을 검증합니다.

### 2. Goti-go 배포

- Goti-go main HEAD에는 D0~D2가 전부 포함돼 있습니다.
- ticketing-v2 이미지를 빌드하고, values.yaml에 `TICKETING_REDIS_CLUSTER_URL` env를 추가해서 배포합니다.
- 이 시점에 **모든 RedisSoT 플래그는 false**입니다. 기존 동작 유지를 확인합니다.

### 3. Smoke Test (플래그 1개씩)

- `TICKETING_REDIS_SOT_SEAT_STATUSES=true` 환경변수 패치로 smoke 실행합니다.
- `/seat-statuses?gameID=...` 응답을 확인합니다. HGetAll 1 RTT로 응답이 와야 합니다.
- 다음으로 `TICKETING_REDIS_SOT_SEAT_HOLDS=true`를 켭니다. hold/release smoke를 돌려 Lua dual-write가 정상 동작하는지 확인합니다.

### 4. 5차 부하

- 1차: 모든 플래그 off. Phase 1+2 효과만 측정합니다.
- 2차: seat_statuses + seat_holds 플래그 on. SoT 효과를 측정합니다.
- 비교 지표: `/seat-statuses` p50/p95, RDS QPS, ticket_success_rate.

---

## 📚 배운 점

### 풀 구현 의지는 좋지만 세션 경계는 지키자

SDD 명세를 단일 세션에 전부 구현하려는 의지가 있었지만, D5처럼 다른 서비스까지 건드리는 변경은 단일 세션에 넣기에 위험합니다. 세션 경계는 **커밋 단위보다 변경 영향 범위로** 나누는 게 맞습니다.

### dual-write는 과도하지 않은 안전장치다

"RDS 그대로 쓰고 Redis에도 쓴다"는 단순한 규칙이지만, Lua 실패를 warning만 남기게 해두면 장애 상황에서도 서비스가 죽지 않습니다. SoT 전환의 표준 패턴으로 쓸 만합니다.

### Go embed와 hash tag 두 가지 제약

Go embed는 상위 디렉토리를 참조할 수 없습니다. Lua 파일을 별도 패키지로 분리해서 해결했습니다.

Redis Cluster의 Lua는 모든 key가 같은 slot이어야 실행됩니다. `{game_id}` hash tag를 키 설계의 기본 규칙으로 고정해야 합니다.

### 단위 테스트 미작성은 기록해두자

이번 세션에서는 miniredis 기반 단위 테스트를 생략하고 dev smoke로 대체했습니다. follow-up 리스트에 "High" 우선순위로 기록해뒀습니다. 검증 누락을 "해결된 것"처럼 남기지 말고 문서에 명시하는 편이 미래의 자신에게 유리합니다.

### inv key 형식 불일치는 reconcile로 잡자

기존 `inventoryRedisRepo`는 `inventory:{gameID}` 키에 gradeID를 필드로 썼습니다. D2 Lua는 `inv:{game_id}:{section_id}` 키에 available/held/sold를 필드로 씁니다. 형식이 다른 두 경로가 공존하면 부하 시 정합성 차이가 발생할 수 있습니다. D3의 reconcile job에서 조정하기로 정리했습니다.

---

## 📎 관련 산출물

- SDD-0005: `docs/dx/0005-redis-source-of-truth-sdd.md`
- Plan: `~/.claude/plans/misty-seeking-orbit.md`
- PR Goti-k8s #261 (D0a 인프라)
- Goti-go main: `a429981` (D0b), `3e1d8bc` (D1), `c289e90` (D2)
