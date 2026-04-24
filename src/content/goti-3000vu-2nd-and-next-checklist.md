---
title: "3000VU 2차 부하테스트 — 결과 악화 원인과 다음 실행 전 체크리스트"
excerpt: "MaxConns 축소와 노드 자원 부족이 동시에 작용해 2차 결과가 1차보다 악화됐습니다. 되돌릴 설정과 3차 실행 전 필수 확인 항목을 정리했습니다."
category: challenge
tags:
  - go-ti
  - LoadTest
  - k6
  - 3000VU
  - Checklist
  - troubleshooting
series:
  name: "goti-loadtest"
  order: 3
date: "2026-04-14"
---

## 한 줄 요약

> 2차 3000VU 부하테스트에서 ticket_success가 15.6% → 13.2%로 악화됐습니다. MaxConns 축소가 역효과였고, 더 큰 원인은 노드 자원 부족이었습니다.

---

## 🔥 문제: 2차 결과가 전 항목에 걸쳐 악화

1차 대비 2차 결과를 비교하면 다음과 같습니다.

| 지표 | 1차 | 2차 | 평가 |
|---|---|---|---|
| ticket_success | 15.6% | **13.2%** | 악화 |
| seat_selection p95 | 9.86s | **50.66s** | 대폭 악화 |
| queue_enter p95 | 1.87s | 11.6s | 악화 |
| iteration p95 | 2m48s | 5m18s | 악화 |
| 실행 시간 | 3m44s | 7m03s | 악화 |
| http_req_duration p95 | 2.88s | 8.62s | 악화 |
| order_creation p95 | 60s | 60s timeout | 동일 |
| payment p95 | 10.5s | 13s | 소폭 악화 |

2차에서 달라진 설정은 다음 세 가지였습니다.

- `ANALYZE` 실행
- ticketing MaxConns 18 → 10 축소
- PgBouncer `goti_ticketing pool_size` 100으로 확장

브라우저 직접 확인 결과는 더 심각했습니다.

- `seat-statuses` 단건 응답 **58초**
- `seat-grades?forceNewSession=true` **504 timeout 1분**
- `seat-sections` 응답 4~8초

---

## 🤔 원인: 두 가지 문제가 동시에 작용

### 원인 1. MaxConns 축소가 역효과

1차에서는 burst 순간에만 잠깐 wait(peak 10)가 발생했습니다.
MaxConns를 18 → 10으로 줄이자 애플리케이션 자체가 쿼리를 내보내지 못하는 상황이 됐습니다.
PgBouncer pool_size 확장으로 얻는 이득보다 앱 풀 축소의 손해가 컸습니다.

### 원인 2. 노드 자원 부족 (더 큰 원인)

부하 도중 모니터링 Pod 4개가 Pending 상태로 전환됐습니다.

```text
Pending: mimir-ingester-0, prometheus-prometheus-0, otel-logs-agent ×2, redis-exporter
이유: 0/10 nodes are available: 8 Insufficient cpu, 3 Insufficient memory
```

EXPLAIN 기준 1ms 쿼리가 운영에서 58초로 지연된 것은 커넥션 문제가 아니라 **컴퓨트 스로틀링**이었습니다.
측정 도구(Mimir, Prometheus)까지 함께 죽어 부하 도중 병목을 실시간으로 확인할 수 없었습니다.

---

## ✅ 해결: 3차 부하 전 필수 체크리스트

### 0. ADR 0014 Phase A 전체 적용 완료 확인

아래 커밋이 모두 배포됐는지 확인합니다.

| 커밋 | 내용 | 예상 효과 |
|---|---|---|
| `e4f651e` | seat-statuses Redis cache-aside (TTL 2s) | p95 50s → 50ms |
| `7c70162` | seat-sections + pricing-policies in-memory TTL (5m) | 5~8s → 1ms |
| `0d6f7b4` | order create Redis SETNX reservation lock | 409 race 거의 소멸 |

### 1. ticketing MaxConns 원복 (역효과 확인됨)

```yaml
# environments/prod/goti-ticketing-v2/values.yaml
- name: TICKETING_DATABASE_MAX_CONNS
  value: "18"        # 10 → 18 복귀
- name: TICKETING_DATABASE_MIN_CONNS
  value: "5"         # 3 → 5 복귀
```

PgBouncer `goti_ticketing pool_size=100`은 유지합니다(해가 없음).

### 2. 노드 추가 (사용자 승인 필수)

```bash
# 권장: spot 노드 +3 (현재 5 → 8)
aws eks update-nodegroup-config \
  --cluster-name goti-prod \
  --nodegroup-name goti-prod-spot \
  --scaling-config minSize=5,maxSize=10,desiredSize=8 \
  --region ap-northeast-2
```

비용은 t3.large × 3 기준 약 $0.09/h입니다.
자동 shutdown 정책(5:50 PM)을 우회할 수 있으므로, 부하 종료 후 `desiredSize`를 8 → 5로 되돌려야 합니다.
컴퓨트 변경은 건별 사용자 승인이 필수입니다.

### 3. Redis 큐 flush

부하 시작 직전에 실행합니다.

```bash
kubectl apply -f /tmp/redis-flush.yaml
```

### 4. 모니터링 사전 확인

부하 시작 전 아래 항목이 모두 정상인지 확인합니다.

- PgBouncer 대시보드 정상 데이터 표시
- Mimir ingester 3/3 Running
- `pgbouncer_up == 1` Prometheus 응답 확인

### 5. 부하 명령 (변경 없음)

```bash
VUS=3000 ./run.sh queue-oneshot
```

큐 `max_capacity 1000`은 유지합니다(동시 활성 사용자 1000명 기준).

---

## 📚 배운 점

- **앱 커넥션 풀과 프록시 풀은 함께 조율해야 합니다** — PgBouncer pool을 늘려도 앱 MaxConns를 줄이면 앱이 먼저 막힙니다
- **측정 도구가 죽으면 진단이 불가능합니다** — 모니터링 Pod가 Pending되면 부하 중 실시간 병목을 확인할 방법이 없습니다. 모니터링 노드를 별도로 확보하거나 리소스 요청을 보장해야 합니다
- **EXPLAIN 1ms ≠ 운영 1ms** — 컴퓨트 스로틀링 환경에서는 쿼리 자체는 빨라도 실행 기회를 얻지 못해 수십 초가 걸릴 수 있습니다
- **변경은 한 번에 하나씩** — 이번처럼 ANALYZE + MaxConns 변경 + PgBouncer pool 변경을 동시에 적용하면 어떤 변경이 영향을 미쳤는지 분리가 어렵습니다

---

## 미해결 이슈

- PgBouncer transaction mode + Go pgx 호환 (pgx custom type registry)
- Mimir 카디널리티 측정 + drop rule (`k6_*`, `envoy_*`) + `active_series` limit
- otel-collector-logs DaemonSet Pending 상태 해소
- order create / payment 코드 경로 추적 (Tempo trace 활용)
- seat reservation insert race 발생 시 retry/backoff 추가
