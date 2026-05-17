---
title: "Cache-Aside 패턴 — Lazy Loading 캐싱과 TTL Self-Healing"
excerpt: "애플리케이션이 캐시와 DB를 직접 관리하는 Cache-Aside 패턴의 읽기·쓰기 흐름, TTL 만료가 만드는 stale window, 그리고 cache stampede 대응 방법을 교과서적으로 풀어냅니다"
category: challenge
tags:
  - go-ti
  - Redis
  - cache-aside
  - lazy-loading
  - TTL
  - cache-stampede
  - concept
series:
  name: "goti-deepdive-redis"
  order: 1
date: "2026-04-14"
---

## 한 줄 요약

> Cache-Aside는 애플리케이션이 캐시를 직접 제어하는 lazy loading 패턴입니다 캐시 미스 시에만 DB를 조회하고, TTL 만료로 캐시 상태가 자가 회복되는 것이 핵심 특성입니다

---

## 🤔 무엇을 푸는 기술인가

### DB 직접 조회의 병목

읽기 트래픽이 집중되는 서비스에서는 동일한 데이터를 반복적으로 DB에서 조회하는 패턴이 병목이 됩니다 좌석 상태, 공연 메타, 가격 정책처럼 변경 빈도가 낮고 읽기 빈도가 높은 데이터가 대표적입니다

DB는 디스크 I/O, 커넥션 풀, 쿼리 파싱 비용을 치러야 합니다 수천 요청이 동시에 같은 row를 읽으면 DB 부하가 직접 증가하고, 응답 지연이 길어지며, 최악의 경우 커넥션 풀 고갈로 이어집니다

### Cache-Aside의 핵심 아이디어

Cache-Aside는 이 문제를 **읽기 경로에서 캐시를 우선 조회**하는 방식으로 해결합니다

- 캐시에 데이터가 있으면(HIT) DB를 거치지 않고 즉시 반환합니다
- 캐시에 없으면(MISS) DB를 조회하고, 그 결과를 캐시에 적재한 뒤 반환합니다

"필요할 때만 캐시에 올린다"는 의미에서 **Lazy Loading**이라고도 부릅니다 DB를 먼저 모두 캐시에 올려놓는 Eager Loading과 반대 개념입니다

Cache-Aside는 캐시와 DB 사이의 동기화를 **애플리케이션이 직접 책임**집니다 캐시 레이어가 자동으로 DB를 바라보는 Read-Through나 Write-Through와 달리, 캐시를 언제 채우고 언제 버릴지를 애플리케이션 코드가 명시적으로 제어합니다

---

## 🔧 동작 원리

### 읽기 흐름 — Cache-Aside Read

![Cache-Aside 읽기·쓰기 흐름도|tall](/diagrams/goti-deepdive-cache-aside-pattern-1.svg)

위 흐름도는 Cache-Aside의 읽기(왼쪽)와 쓰기(오른쪽) 경로를 나란히 보여줍니다

**읽기 경로**는 다음 순서로 진행됩니다

1. **GET 요청** — 애플리케이션이 캐시 키를 조회합니다 (`GET seat_statuses:{game_id}`)
2. **HIT** — 캐시에 값이 있으면 즉시 반환합니다 DB 접근 없음
3. **MISS** — 캐시에 없으면 DB를 조회합니다
4. **SET + TTL** — DB 조회 결과를 캐시에 적재합니다 다음 요청부터 HIT 경로로 전환됩니다

두 번째 요청부터는 캐시에서 응답하므로, 동일 데이터를 반복 조회하는 부하가 DB에 전달되지 않습니다 HIT 구간에서 DB는 완전히 격리됩니다

```go
// cache-aside 읽기 패턴 (Go 예시)
func GetSeatStatuses(ctx context.Context, gameID string) ([]SeatStatus, error) {
    key := fmt.Sprintf("seat_statuses:%s", gameID)

    // 1. 캐시 조회
    cached, err := redisClient.Get(ctx, key).Bytes()
    if err == nil {
        var statuses []SeatStatus
        _ = json.Unmarshal(cached, &statuses)
        return statuses, nil  // HIT — DB 접근 없음
    }

    // 2. MISS: DB 조회
    statuses, err := db.QuerySeatStatuses(ctx, gameID)
    if err != nil {
        return nil, err
    }

    // 3. 캐시 적재 (TTL 2초)
    data, _ := json.Marshal(statuses)
    redisClient.Set(ctx, key, data, 2*time.Second)

    return statuses, nil
}
```

### 쓰기 흐름 — Write + Cache Invalidation

쓰기는 읽기보다 단순합니다

1. **DB Write** — 데이터를 DB에 저장합니다 (RDS가 Source of Truth)
2. **캐시 무효화** — 해당 키를 캐시에서 삭제(`DEL`)합니다

쓰기 시 캐시를 업데이트하는 대신 삭제하는 이유는 **race 회피**입니다 쓰기 작업이 여러 코드 경로에서 발생할 때, 모든 경로에서 캐시에 올바른 값을 넣도록 보장하기가 어렵습니다 삭제하면 다음 읽기 요청이 DB에서 최신 값을 가져와 캐시를 재적재하므로, 쓰기 코드 경로가 단순해집니다

```go
// cache-aside 쓰기 패턴
func HoldSeat(ctx context.Context, gameID, seatID, userID string) error {
    // 1. DB Write (또는 Redis SETNX hold key)
    if err := db.InsertHold(ctx, gameID, seatID, userID); err != nil {
        return err
    }

    // 2. 캐시 무효화 — 업데이트가 아닌 삭제
    key := fmt.Sprintf("seat_statuses:%s", gameID)
    redisClient.Del(ctx, key)

    return nil
}
```

### TTL 만료와 Stale Window

캐시에는 TTL(Time-To-Live)을 설정합니다 TTL이 지나면 Redis가 자동으로 키를 삭제합니다

TTL이 만료된 순간부터 다음 요청이 캐시를 재적재하기까지의 구간을 **stale window**라고 부릅니다 이 구간에서는 모든 읽기 요청이 DB에 직접 도달합니다

![TTL Stale Window와 Cache Stampede 시간축 다이어그램|tall](/diagrams/goti-deepdive-cache-aside-pattern-2.svg)

위 다이어그램은 시간축 위에서 캐시 상태 변화를 보여줍니다

캐시가 적재된 t=0부터 TTL 만료 시점(t=TTL)까지는 모든 요청이 캐시에서 응답합니다 DB 부하는 0입니다 TTL 만료 이후(Stale Window 구간)에는 캐시가 없으므로, 요청이 DB로 향합니다 첫 요청이 DB를 조회하고 캐시를 재적재하면 다시 HIT 상태로 전환됩니다

**TTL self-healing**은 Cache-Aside의 가장 중요한 특성 중 하나입니다 Redis 장애나 캐시 플러시, 수동 삭제가 발생해도 다음 읽기 요청이 DB에서 데이터를 가져와 캐시를 자동으로 복원합니다 별도의 캐시 워밍(warming) 스크립트나 사전 작업이 없어도, 캐시 상태가 스스로 회복됩니다

이 특성은 운영 복잡성을 낮춥니다 캐시와 DB의 정합성이 깨져도 TTL 주기 안에 자연스럽게 수렴합니다

### TTL 값 설계

TTL은 stale 허용 범위와 DB 부하 사이의 트레이드오프입니다

- TTL이 짧을수록 데이터가 최신 상태에 가깝지만, 캐시 미스가 잦아져 DB 부하가 높아집니다
- TTL이 길수록 DB 부하는 낮아지지만, 쓰기 이후 캐시가 오래된 값을 반환하는 stale window가 길어집니다

데이터 성격에 따라 TTL을 다르게 설정하는 것이 일반적입니다

| 데이터 | TTL 예시 | 이유 |
|---|---|---|
| 좌석 실시간 상태 | 2s | 선점 race에 민감 — 짧은 stale 허용 |
| 공연 섹션·가격 메타 | 5m | 변경 빈도 낮음 — 긴 stale 허용 |
| 사용자 프로파일 | 10m ~ 1h | 읽기 집중, 변경 드묾 |

---

## 📐 세부 동작과 옵션

### Cache Stampede — 동시 MISS 폭발

Cache Stampede는 캐시가 만료된 직후 다수의 요청이 동시에 캐시 미스를 경험하고, 모두 DB에 동일한 쿼리를 날리는 현상입니다 부하가 집중된 순간에 TTL이 만료되면 N개 요청이 N개 DB 쿼리를 발생시킵니다 평소의 DB 부하와 비교하면 수십~수백 배 급증이 발생할 수 있습니다

대표적인 대응 패턴은 두 가지입니다

**Probabilistic Early Expiration**은 TTL 만료 전에 일부 요청이 확률적으로 DB를 먼저 조회해 캐시를 갱신합니다 만료 시점에 집중되는 폭발을 시간적으로 분산시킵니다 구현이 간단하고 Redis 명령 추가 없이 애플리케이션 코드만으로 동작합니다

```go
// Probabilistic Early Expiration 패턴
func GetWithEarlyRenewal(ctx context.Context, key string, ttl time.Duration) ([]byte, error) {
    val, err := redisClient.Get(ctx, key).Bytes()
    if err == nil {
        // 남은 TTL이 전체의 10% 이하면 20% 확률로 미리 갱신
        remaining, _ := redisClient.TTL(ctx, key).Result()
        if remaining < ttl/10 && rand.Float32() < 0.2 {
            go refreshCache(ctx, key, ttl)  // 백그라운드 갱신
        }
        return val, nil
    }
    return fetchFromDB(ctx, key, ttl)
}
```

**SETNX 재적재 뮤텍스**는 캐시 미스를 감지한 첫 요청만 DB를 조회하도록 잠금을 걸고, 나머지 요청은 잠금이 해제될 때까지 대기합니다 잠금 해제 후 캐시에서 읽으므로 DB 쿼리가 1회로 제한됩니다

```go
// SETNX 뮤텍스 패턴
func GetWithMutex(ctx context.Context, key string) ([]byte, error) {
    // 캐시 조회
    if val, err := redisClient.Get(ctx, key).Bytes(); err == nil {
        return val, nil
    }

    lockKey := "lock:" + key
    // 첫 요청만 락 획득 (NX = 없을 때만 SET)
    acquired, _ := redisClient.SetNX(ctx, lockKey, "1", 3*time.Second).Result()
    if !acquired {
        // 락 못 얻은 요청: 잠시 대기 후 캐시 재조회
        time.Sleep(50 * time.Millisecond)
        return redisClient.Get(ctx, key).Bytes()
    }
    defer redisClient.Del(ctx, lockKey)

    // 락 획득 요청: DB 조회 + 캐시 적재
    return fetchFromDB(ctx, key, 2*time.Second)
}
```

### Cache Invalidation 전략 비교

쓰기 이후 캐시를 어떻게 다룰지는 여러 전략이 있습니다

| 전략 | 동작 | 장점 | 단점 |
|---|---|---|---|
| DEL (무효화) | 쓰기 후 키 삭제 | 단순, race 없음 | 다음 읽기에서 MISS + DB 조회 |
| SET (즉시 갱신) | 쓰기 후 캐시도 업데이트 | MISS 없음 | 여러 코드 경로 동기화 어려움 |
| 쓰기 무시 | 쓰기 시 캐시 건드리지 않음 | 코드 단순 | TTL 만료까지 stale 데이터 반환 |

Cache-Aside에서는 **DEL이 기본 권장 전략**입니다 구현이 단순하고 코드 경로마다 "올바른 값을 캐시에 넣어야 한다"는 책임이 없습니다 단, 쓰기 직후 읽기가 집중되는 hot path에서는 MISS 폭발 가능성을 고려해야 합니다

---

## 🧩 go-ti에서는

go-ti 티켓팅 플랫폼에서는 3,000 VU 부하 테스트 결과 RDS 직접 조회가 병목임을 확인한 후 좌석 상태와 섹션/가격 메타 데이터에 Cache-Aside를 도입했습니다 좌석 상태(`seat_statuses:{game_id}`)는 TTL 2s, 섹션·가격 메타(`seat-sections`, `pricing-policies`)는 TTL 5m으로 설정했습니다

HoldSeat 이후에는 해당 섹션의 캐시 키를 즉시 무효화(DEL)해서, 다음 읽기 요청이 최신 상태를 가져오도록 했습니다 TTL self-healing 덕분에 Redis 장애나 배포 재시작 시에도 별도 워밍 없이 캐시 상태가 자동으로 복원됩니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [티켓팅 도메인 Redis-first 전환 (ADR)](/logs/goti-redis-first-ticketing-adr)에 정리했습니다

---

## 📚 핵심 정리

- Cache-Aside는 캐시를 애플리케이션이 직접 제어합니다 캐시 미스 시 DB 조회 후 캐시에 적재하는 lazy loading 방식입니다
- 쓰기 시에는 DB에 저장 후 캐시 키를 DEL합니다 다음 읽기가 DB에서 최신 값을 가져와 캐시를 재적재합니다
- TTL 만료는 stale window를 만들지만, 동시에 self-healing 메커니즘이기도 합니다 별도 워밍 없이 캐시 상태가 자동 복원됩니다
- TTL 만료 직후 다수 요청의 동시 MISS는 cache stampede를 유발합니다 Probabilistic Early Expiration 또는 SETNX 뮤텍스로 대응합니다
- TTL 값은 stale 허용 범위와 DB 부하 사이의 트레이드오프입니다 데이터 변경 빈도와 정합성 요구에 따라 다르게 설정합니다
