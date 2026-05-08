---
title: "부하테스트 정확도를 높이는 DB 시드 전략 — 2025 KBO 스케줄 기반 360만 행 생성"
excerpt: "75K rows 환경에서 5000 VU 부하테스트가 너무 빠르게 끝난 이유는 인덱스가 전부 메모리에 올라가 있었기 때문입니다. 2025 KBO 시즌 실제 경기 데이터를 기반으로 seat_statuses 360만 행을 시드해 쿼리 병목을 prod 수준으로 재현했습니다"
category: challenge
tags:
  - go-ti
  - LoadTest
  - PostgreSQL
  - DB-Seed
  - EXPLAIN
  - troubleshooting
series:
  name: "goti-loadtest"
  order: 2
date: "2026-03-25"
---

## 한 줄 요약

> 소량 데이터 환경에서는 PostgreSQL EXPLAIN plan이 prod과 전혀 다릅니다. 2025 KBO 시즌 720경기 실제 스케줄을 기반으로 seat_statuses 3.6M 행, users 578K 행을 시드해 쿼리 병목을 현실적으로 재현했습니다

---

## 배경: 왜 DB 시드가 부하테스트 정확도에 직결되는가

이 글은 같은 시리즈의 `synthetic-traffic`과 **레이어가 다릅니다.**

`synthetic-traffic`은 모니터링 파이프라인(메트릭/로그/트레이스/대시보드)이 살아있는지 확인하기 위한 트래픽 레이어 도구였습니다.

이 글에서 다루는 `DB 시드`는 **쿼리 플래너가 prod과 동일한 판단을 내리도록** 데이터 규모를 맞추는 작업입니다.

둘의 목적이 다릅니다.

---

### 왜 소량 데이터 환경의 부하테스트가 부정확한가

PostgreSQL의 쿼리 플래너는 통계 정보(`pg_statistics`)를 보고 실행 계획(EXPLAIN plan)을 선택합니다.

테이블에 데이터가 적으면 인덱스 전체가 메모리(shared_buffers)에 올라가 있고, 쿼리가 거의 캐시 히트로 처리됩니다. 이 상태에서 나온 p95 응답시간은 **prod 수준의 병목을 재현하지 못합니다.**

구체적으로 말하면, 기존 환경의 seat_statuses는 75,060행이었습니다.

```text
seat_statuses:  75,060 행  (진행 예정 경기 3개 × 25K석)
users:         169,000 행
orders:         27,000 행
```

prod 예상 규모는 seat_statuses 수백만, users 50만+ 입니다.

이 차이가 EXPLAIN plan을 완전히 바꿉니다. 소량 환경에서는 Sequential Scan이 선택되거나, 인덱스 스캔 비용 추정이 실제보다 극단적으로 낮게 나옵니다.

결과적으로 5000 VU 부하테스트에서 서버 리소스(CPU 15~21%, Memory 14~20%)가 여유로운 것처럼 보였지만, 실제로는 DB가 비현실적으로 빠르게 응답하고 있던 것입니다.

---

## 🔥 문제: 5000 VU인데 서버가 여유롭고 쿼리가 너무 빠름

### 환경

- Kind 5노드 (Ubuntu 32GB), PostgreSQL 로컬 설치
- K6 5000 VU 부하테스트

### 확인된 증상

```text
- RPS: 823
- 에러율: 12.8%
- p50: 934ms / p95: 9,065ms (좌석선택 p95: 514ms)
- 서버 CPU: 15~21% / Memory: 14~20%
- 좌석 경합(goti_seat_conflicts): 0건
```

CPU와 메모리가 여유로운 상태에서 p95가 9초라는 것은 **DB가 아닌 다른 곳이 병목**이거나, DB는 빠른데 다른 이유로 에러가 쌓이는 상황입니다.

실제로는 인덱스가 전부 메모리에 올라가 있어 DB 병목이 숨겨져 있었습니다.

---

## 🤔 원인: 인덱스 전체가 메모리에 올라가 캐시 히트만 발생

seat_statuses 75K행은 PostgreSQL shared_buffers 기본값(128MB) 대비 매우 작습니다.

인덱스 크기가 작으면 첫 쿼리 이후 인덱스 전체가 캐시에 상주합니다. 이후 모든 쿼리는 디스크 I/O 없이 캐시 히트로 처리됩니다.

이 상태에서의 EXPLAIN 결과는 prod과 다음과 같이 달라집니다.

| 구분 | 소량(75K) | prod 수준(3.6M) |
|------|-----------|-----------------|
| Index Scan cost 추정 | 극히 낮음 (캐시 히트 가정) | 현실적 I/O 포함 |
| Sequential Scan 선택 가능성 | 높음 | 낮음 (Index 강제) |
| 쿼리 응답시간 | 수ms | 수십~수백ms |

좌석선택 p95가 514ms로 나온 것도 이 때문입니다. prod에서는 인덱스 스캔 + 디스크 I/O 경합이 겹쳐 훨씬 높은 지연이 발생합니다.

---

## ✅ 해결: 2025 KBO 시즌 기반 3단계 시드

### 시드 설계 원칙

실제 운영 데이터 구조를 최대한 모사하기 위해 **2025 KBO 정규시즌 실제 스케줄**을 기반으로 설계했습니다.

임의의 난수 데이터 대신 실제 경기 일정을 사용한 이유는 두 가지입니다.

첫째, 경기별 홈팀/원정팀/구장 구조가 seat_statuses 파티셔닝 패턴과 일치해야 쿼리 플래너가 올바른 판단을 내립니다.

둘째, 특정 날짜·특정 경기 조건으로 필터링하는 실제 쿼리 패턴을 재현할 수 있습니다.

### 데이터 수집: KBO 공식 사이트 AJAX API

```bash
# KBO 공식 사이트 AJAX 엔드포인트 활용
# https://www.koreabaseball.com/ws/Schedule.asmx/GetScheduleList
# 2025 정규시즌 720경기 완료 데이터 수집
$ python scripts/seed-2025/generate-step1.py
# → game_schedules, game_statuses, game_ticketing_statuses SQL 생성
```

### 3단계 시드 구조

시드를 한 번에 실행하면 FK 제약·CHECK 제약 순서 문제가 발생합니다. 단계별로 분리해 순차 실행합니다.

```text
Step 1: 경기 데이터 (720건)
  - game_schedules
  - game_statuses
  - game_ticketing_statuses

Step 2: 좌석 상태 (~350만 행)
  - seat_statuses
  - 대상: 광주·대구 홈경기 142경기 × 25K석

Step 3: 유저 + 주문/결제 (대량)
  - users: 33만 추가
  - orders + order_items + payments: 14만건
```

### 제약 위반 트러블슈팅

시드 실행 과정에서 CHECK 제약 위반이 여러 건 발생했습니다. 각각 실제 스키마를 확인해 수정했습니다

| 테이블 | 직관적 추측 | 실제 Enum 값 |
|---|---|---|
| `game_ticketing_statuses` | `CLOSED` | `TERMINATED` |
| `users` | `ROLE_MEMBER` / `ACTIVE` | `MEMBER` / `ACTIVATED` |
| `order_items` | `CONFIRMED` | `PAID` |
| `payments` | `PAID` / `NORMAL` | `SUCCESS` / `PAYMENT` |

이 과정에서 알게 된 것은 **내부 Enum 값이 직관적인 이름과 다를 수 있다**는 점입니다. 시드 스크립트를 작성하기 전 스키마의 CHECK 제약 조건을 먼저 조회하는 것이 더 효율적입니다.

```sql
-- CHECK 제약 확인
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'payments'::regclass AND contype = 'c';
```

### 디스크 풀 — Step 2 실행 중 발생

Step 2 완료 직후 디스크 풀이 발생했습니다.

```text
사용: 285GB 중 270GB 사용
가용: 11MB
```

Docker 이미지 빌드 캐시가 누적된 상태에서 350만 행 INSERT가 더해지며 용량이 소진됐습니다.

```bash
# Docker 이미지 + 빌드 캐시 정리
$ docker system prune -af --volumes
# → 약 45GB 확보
```

이후 Step 3까지 정상 완료했습니다.

### 최종 시드 결과

| 테이블 | 시드 전 | 시드 후 | 배율 |
|--------|---------|---------|------|
| seat_statuses | 75,060 | 3,634,716 | 48배 |
| users | 169,000 | ~500,000 | 3배 |
| orders | 27,000 | ~169,000 | 6배 |

seat_statuses 기준으로 목표였던 prod 수준(수백만 행)에 도달했습니다.

users는 578K 수준으로, 프로젝트 목표였던 50만+ 동시 접속 시나리오에 대응합니다.

### 부하테스트 결과 비교 (5000 VU)

시드 전후 동일 5000 VU로 부하테스트를 수행해 비교했습니다.

| 지표 | 75K rows (시드 전) | 360만 rows (시드 후) | 변화 |
|------|:------------------:|:--------------------:|------|
| RPS | 823 | 674 | -18% |
| 에러율 | 12.8% | 22.0% | +72% |
| p50 | 934ms | 1,257ms | +35% |
| p95 | 9,065ms | 12,392ms | +37% |
| 좌석선택 p95 | 514ms | 12,355ms | **24배** |
| 주문생성 p95 | 335ms | 12,345ms | **37배** |
| 결제 p95 | 421ms | 15,629ms | **37배** |
| 예매 성공률 | 35.3% | 5.8% | -83% |
| 좌석 경합 | 0건 | 22,405건 | - |

숫자를 보면 방향이 명확합니다.

시드 전에는 좌석선택 p95가 514ms였지만, 시드 후에는 12,355ms로 **24배** 상승했습니다. 이제 DB가 실제 병목으로 작동하고 있습니다.

특히 예매 성공률이 35.3%에서 5.8%로 떨어진 것은 나쁜 신호가 아닙니다. **지금까지 숨겨져 있던 병목이 드러난 것**입니다. 이 수치가 최적화의 출발점입니다.

### 함께 수정한 사항

부하테스트 환경을 정비하는 과정에서 세 가지를 함께 수정했습니다.

**K6 좌석 경합 카운터 수정**

기존 K6 스크립트는 `res.status === 409`만 경합으로 카운트했습니다. 그런데 실제 서버는 좌석 경합 상황에서 `400 "좌석 점유 가능 상태에서만..."` 메시지를 반환하고 있었습니다.

```javascript
// 수정 전: 409만 카운트
if (res.status === 409) { metrics.seatConflict.add(1); return null; }

// 수정 후: 400 + 점유 메시지도 카운트
if (res.status === 409) { metrics.seatConflict.add(1); return null; }
if (res.status === 400 && res.body && res.body.includes('점유')) {
  metrics.seatConflict.add(1); return null;
}
```

이 수정으로 좌석 경합 카운터가 0건 → 22,405건으로 정상 집계됐습니다.

**Grafana 대시보드 `$__rate_interval` 전환**

scrape interval 30s 환경에서 `rate(...[30s])`는 최소 2개 샘플이 필요해 stale 판정이 날 수 있습니다. `$__rate_interval`로 전환하면 Grafana가 scrape interval을 자동으로 감지해 적절한 범위를 계산합니다.

**kube-state-metrics NetworkPolicy egress 추가**

`default-deny-all` NetworkPolicy가 monitoring namespace 전체 egress를 차단해 kube-state-metrics가 API server(10.96.0.1:443)에 접근하지 못하고 4일째 CrashLoopBackOff 상태였습니다.

```text
Failed to run kube-state-metrics: failed to create client:
error while trying to communicate with apiserver:
Get "https://10.96.0.1:443/version": dial tcp 10.96.0.1:443: i/o timeout
```

`allow-kps-apiserver-egress` NetworkPolicy를 추가해 443/6443 + DNS egress를 허용했습니다.

---

## 📚 배운 점

- **소량 데이터 환경의 부하테스트는 신뢰할 수 없습니다** — 인덱스가 메모리에 상주하면 DB 병목이 숨겨집니다. prod 데이터 규모에 맞는 시드가 EXPLAIN plan 검증의 전제 조건입니다

- **시드 데이터는 실제 데이터 구조를 모사해야 합니다** — 난수 대신 실제 KBO 스케줄 기반으로 설계했을 때 쿼리 패턴과 파티셔닝 선택이 현실적으로 맞아떨어집니다

- **CHECK 제약은 시드 전에 먼저 확인합니다** — `pg_get_constraintdef()`로 Enum 허용값을 조회한 후 스크립트를 작성하면 제약 위반 트러블슈팅 시간을 줄일 수 있습니다

- **시드 스크립트를 3단계로 분리하면 재실행이 가능합니다** — `scripts/seed-2025/` 에 단계별로 저장해두면 환경을 초기화하고 다시 시드할 때 선택적으로 실행할 수 있습니다

- **부하테스트 지표 악화 = 정상화** — 시드 후 성공률 하락과 지연 급증은 실패가 아닙니다. 숨겨져 있던 실제 병목이 드러난 것이며, 이제부터 의미 있는 최적화(인덱스 튜닝, 커넥션풀, 쿼리 리팩토링)를 시작할 수 있습니다
