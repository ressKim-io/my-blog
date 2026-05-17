---
title: "Redis maxmemory eviction — 메모리 한도 도달 시 키 축출 정책"
excerpt: "Redis가 maxmemory 한도에 도달했을 때 어떤 정책에 따라 키를 축출하는지, 그리고 eviction과 TTL 만료는 어떻게 다른지 내부 동작 원리를 설명합니다"
category: challenge
tags:
  - go-ti
  - Redis
  - maxmemory
  - eviction
  - LRU
  - concept
series:
  name: "goti-deepdive-redis"
  order: 10
date: "2026-04-17"
---

## 한 줄 요약

> Redis는 `maxmemory` 한도에 도달하면 설정된 eviction 정책에 따라 기존 키를 축출해 공간을 확보하거나 쓰기를 거부합니다 — 정책 선택은 "어떤 키를 잃어도 되는가"에 대한 의사결정입니다

---

## 🤔 무엇을 푸는 기술인가

### 메모리 한도와 쓰기 충돌

Redis는 모든 데이터를 RAM에 올립니다 서버에는 물리적 메모리 한계가 있습니다 Redis가 제한 없이 메모리를 늘리도록 두면 OS의 스왑이 발동하고, 스왑 I/O는 Redis의 응답 시간을 수백 배 악화시킵니다 이 때문에 운영 환경에서는 반드시 `maxmemory`를 설정해 상한을 지정합니다

문제는 한도에 도달했을 때입니다 새 쓰기 명령이 들어오면 Redis는 결정을 내려야 합니다 — 어디서 공간을 확보할 것인가, 아니면 쓰기를 거부할 것인가 이 결정 규칙이 **eviction 정책**입니다

### eviction이 해결하는 문제

Redis를 캐시로만 쓸 때는 정책 선택이 비교적 단순합니다 캐시의 모든 데이터는 원본이 다른 곳(RDB, S3 등)에 있으므로 오래된 키를 지워도 miss 비용만 발생합니다 중요한 데이터가 사라지지 않습니다

그러나 Redis를 **원본 저장소(Source of Truth)** 로 쓰는 패턴에서는 이야기가 달라집니다 원본이 Redis 안에 있다면 키가 예상치 못하게 사라지는 것은 데이터 소실입니다 이 맥락에서 eviction 정책은 단순한 성능 옵션이 아니라 **데이터 안전성 설계**의 일부입니다

---

## 🔧 동작 원리

### 쓰기 명령 처리 흐름

Redis는 모든 쓰기 명령을 처리하기 직전에 메모리 사용량을 점검합니다 `used_memory`가 `maxmemory` 이상이면 `maxmemory-policy` 설정에 따라 분기합니다

![Redis maxmemory 도달 시 정책별 분기 흐름도|tall](/diagrams/goti-deepdive-redis-eviction-policy-1.svg)

위 흐름도는 쓰기 명령이 진입한 뒤 메모리 체크 결과에 따라 어떤 경로를 타는지 보여줍니다

메모리가 한도 미달이면(점선 경로) 축출 없이 쓰기를 바로 수행합니다 한도에 도달했으면 정책 확인 단계로 넘어갑니다 `noeviction`은 쓰기를 거부하고 클라이언트에 `OOM command not allowed when used memory > 'maxmemory'` 오류를 반환합니다 나머지 5개 정책은 대상 키를 선별해 즉시 제거한 뒤 쓰기를 허용합니다

**정책 선택 기준**은 "전체 키에서 고를 것인가(allkeys-*), TTL이 있는 키에서만 고를 것인가(volatile-*)," 그리고 "어떤 순서로 고를 것인가(lru / ttl / random)"의 조합입니다

### LRU 근사 알고리즘

`allkeys-lru`와 `volatile-lru`는 LRU(Least Recently Used), 즉 가장 오랫동안 접근되지 않은 키를 제거합니다 그러나 Redis는 정확한 LRU를 구현하지 않습니다

정확한 LRU는 모든 키를 접근 시각 기준으로 정렬된 리스트에 유지해야 합니다 키가 수백만 개일 때 이 리스트를 관리하는 비용은 메모리와 CPU 모두에서 큽니다 Redis는 대신 **근사 LRU**를 씁니다

```text
eviction 후보 선정 과정:
  1. 키 공간에서 무작위로 N개 샘플링 (기본 N=10, maxmemory-samples 설정)
  2. 각 샘플의 마지막 접근 시각(lru_clock) 비교
  3. 가장 오래된 키를 축출 후보로 선택
```

샘플 수가 클수록 이상적인 LRU에 가까워지지만 CPU 비용이 증가합니다 기본값 10은 대부분의 워크로드에서 충분히 좋은 근사를 제공합니다 Redis의 각 키 객체는 `lru_clock` 필드(24비트, 초 단위 타임스탬프)를 메타데이터로 보관합니다 명령 처리 시마다 이 값을 갱신합니다

Redis 4.0부터는 LRU 대신 **LFU(Least Frequently Used)** 정책도 제공합니다 접근 빈도가 낮은 키를 우선 제거합니다 `allkeys-lfu`와 `volatile-lfu` 두 가지가 있으며 동작 방식은 LRU와 동일하게 근사 기반입니다

### volatile-ttl의 특수성

`volatile-ttl`은 LRU와 다른 기준을 씁니다 TTL이 설정된 키 중에서 **만료 시각이 가장 빠른 키**를 우선 축출합니다 곧 어차피 만료될 키를 먼저 제거하겠다는 논리입니다

```bash
# 예시: 세 키의 TTL 상태
TTL key:a  # 300 (5분 후 만료)
TTL key:b  # 10  (10초 후 만료)
TTL key:c  # -1  (TTL 없음)
```

위 상태에서 `volatile-ttl`이 동작하면 `key:b`가 먼저 축출 후보가 됩니다 `key:c`는 TTL이 없으므로 `volatile-*` 계열에서는 절대 축출되지 않습니다 TTL이 있는 키가 모두 소진되면 `volatile-*` 정책은 공간을 확보하지 못하고 `noeviction`처럼 오류를 반환합니다

---

## 📐 세부 동작과 옵션

### 정책 6종 비교

| 정책 | 축출 대상 키 | 선택 기준 | 적합한 상황 |
|---|---|---|---|
| `noeviction` | 없음 — 쓰기 거부 | — | Redis를 SoT로 쓸 때, 데이터 소실 불허 |
| `allkeys-lru` | 전체 키 | 가장 오래 미접근 | 범용 캐시, 핫 키 생존율 극대화 |
| `volatile-lru` | TTL 있는 키만 | 가장 오래 미접근 | 영구 키와 캐시 키 혼재 환경 |
| `allkeys-random` | 전체 키 | 무작위 | 접근 패턴이 균일한 캐시 |
| `volatile-ttl` | TTL 있는 키만 | 만료 시각이 가장 빠른 키 | TTL 관리 기반 캐시, 임박 만료 키 우선 정리 |
| `volatile-random` | TTL 있는 키만 | 무작위 | TTL 키 비율이 높고 접근 패턴 무관할 때 |

`allkeys-lru`는 Redis를 순수 캐시로 운영할 때 가장 널리 쓰이는 기본값입니다 자주 쓰이는 키는 살아남고 오래 안 쓰인 키가 나가므로 캐시 히트율을 자연스럽게 높입니다

### eviction과 TTL 만료는 어떻게 다른가

두 메커니즘은 모두 키를 제거하지만 트리거와 동작 방식이 완전히 다릅니다

![eviction(강제 축출)과 TTL 만료(자가 회복)의 차이|tall](/diagrams/goti-deepdive-redis-eviction-policy-2.svg)

왼쪽 eviction 흐름에서 트리거는 **메모리 압박**입니다 새 쓰기가 들어오는 순간 `used_memory >= maxmemory` 조건을 검사합니다 조건이 충족되면 정책에 따라 LRU 근사 샘플링을 수행하고 가장 오래된 키를 즉시 제거합니다 이 과정은 TTL 설정 여부와 무관합니다 `allkeys-lru`라면 TTL이 없는 영구 키도 축출될 수 있습니다 언제 어떤 키가 사라질지 키를 만든 쪽에서는 예측하기 어렵습니다

오른쪽 TTL 만료 흐름에서 트리거는 **시간 경과**입니다 `EXPIRE key 300`을 실행한 순간부터 해당 키에는 만료 시각이 내부 `expires` 딕셔너리에 기록됩니다 이후 두 경로로 삭제가 일어납니다 **Lazy 삭제**는 만료된 키에 접근할 때 비로소 제거합니다 클라이언트가 읽기를 시도하면 그때 만료 여부를 검사하고 만료됐다면 즉시 삭제 후 `nil`을 반환합니다 **Active 삭제**는 100ms 주기 백그라운드 작업이 랜덤하게 샘플링한 키들의 만료 여부를 점검해 제거합니다 TTL 설정자가 만료 시각을 알고 있으므로 키가 사라지는 시점이 예측 가능합니다

두 메커니즘의 핵심 차이는 다음 표로 요약됩니다

| 구분 | Eviction | TTL 만료 |
|---|---|---|
| 트리거 | 메모리 압박 (쓰기 명령 수신 시) | 시간 경과 (EXPIRE 설정 기준) |
| 예측 가능성 | 낮음 — 어떤 키가 사라질지 모름 | 높음 — 설정한 시각에 제거 |
| 대상 | 정책에 따라 영구 키 포함 가능 | TTL이 설정된 키만 |
| 목적 | 메모리 공간 확보 | 데이터 유효기간 관리 |
| 운영자 제어 | 정책 선택으로 간접 제어 | EXPIRE 값으로 직접 제어 |

TTL 만료는 일종의 **자가 회복**입니다 키가 스스로 유효기간을 갖고 정해진 때에 사라집니다 eviction은 메모리 시스템이 강제로 개입하는 **외부 압력**입니다 두 메커니즘을 동시에 설계할 때는 이 차이를 명확히 구분해야 합니다

### maxmemory 설정 예시

```bash
# redis.conf
maxmemory 1gb
maxmemory-policy noeviction

# 또는 런타임 변경
CONFIG SET maxmemory 1gb
CONFIG SET maxmemory-policy allkeys-lru
CONFIG SET maxmemory-samples 10
```

`maxmemory` 단위는 `mb`·`gb` 접미사를 지원합니다 0으로 설정하면 한도 없음(운영 환경에서 권장하지 않음)입니다 `maxmemory-samples`는 LRU/LFU 근사 샘플 수로 높일수록 정확도가 올라가고 CPU 비용도 증가합니다

현재 메모리 상태는 다음 명령으로 확인합니다

```bash
redis-cli INFO memory | grep -E "used_memory_human|maxmemory_human|mem_fragmentation_ratio|evicted_keys"
```

`evicted_keys` 카운터가 증가하고 있다면 eviction이 발생 중입니다 `noeviction` 정책이라면 이 값은 항상 0이어야 합니다

---

## 🧩 go-ti에서는

go-ti 티켓팅 플랫폼은 좌석 상태·재고·주문 데이터의 원본 저장소로 Redis를 운영합니다 이 맥락에서 eviction 정책 선택은 단순한 튜닝이 아니었습니다 **"eviction이 발생하면 티켓 중복 판매가 일어난다"** — 이 한 문장이 결정을 확정했습니다

ADR에 기록된 D0 인프라 결정은 다음과 같습니다

```text
maxmemory-policy: allkeys-lru → noeviction  (in-place update, 비용 $0)
```

GCP Memorystore BASIC 1GB, 실수요 280MB로 메모리 여유가 충분한 상황이었습니다 따라서 eviction이 실제로 발동할 가능성은 낮았습니다 그럼에도 `noeviction`을 명시적으로 설정한 이유는 **fail-fast 원칙** 때문입니다 메모리가 한도에 근접하면 조용히 키를 날리는 대신 쓰기 오류를 발생시켜 운영자가 인지할 수 있게 했습니다 `noeviction`이면 `evicted_keys` 카운터 대신 클라이언트 오류와 알림으로 이상 징후가 드러납니다

`seat_holds`처럼 짧은 TTL을 갖는 키가 있습니다 이 키들의 소멸은 eviction이 아니라 TTL 만료 메커니즘이 담당합니다 좌석 선점 시간이 지나면 `hold:{game_id}:{seat_id}` 키가 자동으로 사라져 좌석이 다시 선택 가능 상태가 됩니다 eviction과 TTL 만료를 명확히 분리 설계한 사례입니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [Redis를 SoT로 채택한 이유 — SDD-0005 전면 승격 (ADR)](/logs/goti-redis-sot-adoption-adr)에 정리했습니다

---

## 📚 핵심 정리

- `maxmemory` 한도에 도달하면 Redis는 `maxmemory-policy` 설정에 따라 기존 키를 축출(eviction)하거나 쓰기를 거부합니다
- `noeviction`은 키를 절대 제거하지 않고 쓰기를 거부합니다 Redis를 SoT로 사용할 때 데이터 소실을 방지하는 유일한 정책입니다
- LRU 정책은 모든 키를 정렬하지 않고 무작위 N개를 샘플링해 가장 오래된 키를 선택하는 **근사 알고리즘**을 씁니다 기본 샘플 수는 10입니다
- **eviction은 메모리 압박이 트리거**이고, **TTL 만료는 시간이 트리거**입니다 eviction은 예측 불가 강제 삭제, TTL 만료는 설정자가 시각을 제어하는 예측 가능 삭제입니다
- `allkeys-*` 계열은 전체 키에서, `volatile-*` 계열은 TTL이 있는 키에서만 축출합니다 TTL 없는 키를 보호하려면 `volatile-*`를 선택합니다
- `evicted_keys` 카운터 모니터링으로 eviction 발생 여부를 실시간 추적할 수 있습니다 SoT 패턴에서는 이 값이 0을 유지해야 합니다
