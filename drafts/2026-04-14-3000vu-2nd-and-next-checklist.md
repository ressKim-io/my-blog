# 2026-04-14 부하 2차 결과 + 다음 부하 전 체크리스트

## 2차 결과 (3000 VU queue-oneshot)
변경: ANALYZE + ticketing MaxConns 18→10 + pgbouncer goti_ticketing pool_size 100

| 지표 | 1차 | 2차 | 평가 |
|---|---|---|---|
| ticket_success | 15.6% | **13.2%** | ↓ 악화 |
| seat_selection p95 | 9.86s | **50.66s** | ↑↑ 대폭 악화 |
| queue_enter p95 | 1.87s | 11.6s | ↑ |
| iteration p95 | 2m48s | 5m18s | ↑ |
| 실행 시간 | 3m44s | 7m03s | ↑ |
| http_req_duration p95 | 2.88s | 8.62s | ↑ |
| order_creation p95 | 60s | 60s timeout | 동일 |
| payment p95 | 10.5s | 13s | 약간 ↑ |

브라우저 직접 확인:
- `seat-statuses` 단건 응답 **58초**
- `seat-grades?forceNewSession=true` **504 timeout 1분**
- `seat-sections` 4~8초

## 진단 — 두 가지 동시 작용
1. **MaxConns 18 → 10 변경이 역효과**
   - 1차 burst 시 잠깐 wait(peak 10) → 2차에선 app 자체가 query를 못 쏨
   - **app pool 줄인 게 PgBouncer pool 효과보다 손해**
2. **노드 자원 부족 (진짜 큰 원인)**
   - 부하 중 monitoring pod 4개 Pending: mimir-ingester-0,
     prometheus-prometheus-0, otel-logs-agent ×2, redis-exporter
   - `0/10 nodes are available: 8 Insufficient cpu, 3 Insufficient memory`
   - **EXPLAIN 1ms 인 query 가 운영에서 58s** → connection 이 아닌 **compute throttling**
   - 측정 도구도 같이 죽어 어디가 병목인지 직접 확인 불가

## 다음 부하 전 MUST 체크리스트

### 0. ADR 0014 Phase A 전체 적용 완료
- e4f651e: seat-statuses Redis cache-aside (TTL 2s)
- 7c70162: seat-sections + pricing-policies in-memory TTL (5m)
- 0d6f7b4: order create Redis SETNX reservation lock (race 흡수)
- 예상 효과:
  - seat-statuses p95 50s → 50ms
  - seat-sections / pricing 5~8s → 1ms (in-memory hit)
  - ORDER_SEAT_ALREADY_EXISTS 409 거의 사라짐 (race 가 Redis 에서 끝남)

### 1. ticketing MaxConns 되돌리기 (역효과 확인됨)
```yaml
# environments/prod/goti-ticketing-v2/values.yaml
- name: TICKETING_DATABASE_MAX_CONNS
  value: "18"        # 10 → 18 복귀
- name: TICKETING_DATABASE_MIN_CONNS
  value: "5"         # 3 → 5 복귀
```
PgBouncer `goti_ticketing pool_size=100` 은 유지 (해가 없음).

### 2. 노드 추가 (사용자 승인 필수)
```bash
# 권장: spot 노드 +3 (현재 5 → 8)
aws eks update-nodegroup-config \
  --cluster-name goti-prod \
  --nodegroup-name goti-prod-spot \
  --scaling-config minSize=5,maxSize=10,desiredSize=8 \
  --region ap-northeast-2
```
- 비용: t3.large × 3 ≈ $0.09/h
- 주의: **자동 shutdown 정책(5:50 PM) 우회 가능** — 부하 끝나면 desired
  되돌리기 (8 → 5)
- rule: 컴퓨트 변경은 건별 사용자 승인 필수 (cloud-cli-safety.md)

### 3. Redis 큐 flush
부하 시작 직전:
```bash
kubectl apply -f /tmp/redis-flush.yaml   # 또는 동등한 매니페스트
```

### 4. 모니터링 사전 확인
- PgBouncer dashboard 정상 데이터 표시
- Mimir ingester 3/3 Running
- Prometheus `pgbouncer_up == 1` 응답

### 5. 부하 명령 (변경 없음)
```bash
VUS=3000 ./run.sh queue-oneshot
```
큐 max_capacity 1000 유지 (동시 활성 사용자 1000명).

## 다음 부하 목표
- ticket_success > 60%
- order_creation p95 < 5s
- seat_selection p95 < 3s

여전히 낮으면:
- Tempo trace 로 order create / payment 호출 path 분석
- payment 서비스 자체 latency 측정
- seat reservation race insert backoff/retry 추가

## 미해결 이슈 트래킹
- [ ] PgBouncer transaction mode + Go pgx 호환 (pgx custom type registry)
- [ ] Mimir 카디널리티 측정 + drop rule (k6_*, envoy_*) + active_series limit
- [ ] otel-collector-logs DaemonSet 정상 기동 확인 (현재 Pending)
- [ ] order create / payment 코드 path 추적
- [ ] seat reservation insert race 시 retry/backoff
