---
date: 2026-03-25
category: troubleshoot
project: goti-team-controller, Goti-monitoring, Goti-k8s
tags: [load-test, postgresql, seed-data, k6, grafana-dashboard, network-policy, kube-state-metrics]
---

# 부하테스트 DB 데이터 부족으로 비현실적 성능 → 2025 KBO 시즌 대량 시드로 해결

## Context

5000 VU 부하테스트에서 서버 리소스(CPU 15~21%, Memory 14~20%)가 여유로운 상태. 실서비스 대비 DB 데이터가 너무 적어 쿼리가 비현실적으로 빠르게 실행되고 있었음.

- 환경: Kind 5노드 (Ubuntu 32GB), PostgreSQL 로컬 설치
- seat_statuses: 75,060행 (AVAILABLE 경기 3개 × 25K석)
- users: 169K, orders: 27K
- 실서비스 예상: seat_statuses 수백만, users 50만+

## Issue

### 1. DB 데이터 부족 — 비현실적 성능

5000 VU 부하테스트에서 p95 460ms, 좌석선택 p95 514ms — 인덱스가 전부 메모리에 올라가서 쿼리가 거의 캐시 히트. 실서비스 병목을 재현할 수 없음.

### 2. 대시보드 패널 데이터 미표시

Command Center 대시보드에서 서버 HTTP p99, 5xx 에러 시계열, 에러 Top 5, Node CPU, Pod 재시작 패널이 전부 비어있음.

### 3. K6 좌석 경합 카운터 미동작

`goti_seat_conflicts` 카운터가 0건 — 대시보드 conflicts/sec 패널 빈 상태.

### 4. kube-state-metrics CrashLoopBackOff (4일째)

```
Failed to run kube-state-metrics: failed to create client:
error while trying to communicate with apiserver:
Get "https://10.96.0.1:443/version": dial tcp 10.96.0.1:443: i/o timeout
```

## Action

### 1. DB 대량 시드 (75K → 360만 seat_statuses)

**가설**: seat_statuses 테이블에 수백만 행이 있으면 인덱스 스캔 비용이 현실적으로 올라갈 것

**진행**:
1. 2025 KBO 정규시즌 스케줄+결과 수집 — KBO 공식 사이트 AJAX API (`/ws/Schedule.asmx/GetScheduleList`) 활용, 720경기 완료 데이터
2. 3단계 시드 스크립트 작성:
   - Step 1: 경기 데이터 720건 (`game_schedules`, `game_statuses`, `game_ticketing_statuses`)
   - Step 2: 좌석 상태 ~350만 행 (`seat_statuses`, 광주/대구 홈경기 142경기 × 25K석)
   - Step 3: 유저 33만 + 주문/결제 14만건

**트러블슈팅 과정**:
- `game_ticketing_statuses` CHECK 제약 위반 → `CLOSED` 없음, `TERMINATED` 사용
- `users` CHECK 제약 위반 → `ROLE_MEMBER` → `MEMBER`, `ACTIVE` → `ACTIVATED`
- `order_items` CHECK 제약 위반 → `CONFIRMED` → `PAID`
- `payments` CHECK 제약 위반 → `PAID` → `SUCCESS`, `NORMAL` → `PAYMENT`
- Step 2 완료 후 **디스크 풀** (285GB 중 270GB 사용, 가용 11MB) → Docker 이미지/빌드 캐시 정리로 45GB 확보

**결과**: seat_statuses 75K → 3,634,716행 (48배), users 170K → 500K, orders 27K → 169K

### 2. 대시보드 수정 (3건)

**원인 1: `$service_name` 변수 쿼리 오류**
- `label_values(up{job=~"goti/.+"}, job)` → `goti/envoy-sidecar-metrics`만 반환 (Istio sidecar)
- 실제 OTel 메트릭 job: `goti/goti-ticketing`, `goti/goti-payment` 등
- 수정: `label_values(http_server_request_duration_seconds_count{job=~"goti/.+"}, job)`

**원인 2: `$interval=30s` rate 범위 부족**
- scrape interval 30s에서 `rate(...[30s])`는 최소 2개 샘플 필요 → stale 판정
- `rate(...[5m])`에서는 정상 데이터 반환
- 수정: `$interval` 커스텀 변수 삭제 → `$__rate_interval` (Grafana 자동 계산)으로 일괄 교체

**원인 3: auto-refresh 옵션 없음**
- `timepicker.refresh_intervals` 추가: `["5s", "10s", "30s", "1m", "5m"]`

### 3. K6 conflict 카운터 수정

**근본 원인**: K6 스크립트가 `res.status === 409`만 카운트하지만, 서버는 좌석 경합 시 `400 "좌석 점유 가능 상태에서만..."` 반환

수정: `400` + body에 `'점유'` 포함 시에도 conflict로 카운트
```javascript
if (res.status === 409) { metrics.seatConflict.add(1); return null; }
if (res.status === 400 && res.body && res.body.includes('점유')) {
  metrics.seatConflict.add(1); return null;
}
```

### 4. kube-state-metrics + prometheus-operator NetworkPolicy

**근본 원인**: `default-deny-all` NetworkPolicy가 monitoring namespace 전체 egress 차단 → kube-state-metrics/prometheus-operator가 API server(10.96.0.1:443)에 접근 불가

수정: `allow-kps-apiserver-egress` NetworkPolicy 추가 (443/6443 + DNS)

## Result

### 부하테스트 비교 (5000 VU)

| 지표 | 75K rows | 360만 rows | 변화 |
|------|------:|------:|------|
| RPS | 823 | 674 | -18% |
| 에러율 | 12.8% | 22.0% | +72% |
| p50 | 934ms | 1,257ms | +35% |
| p95 | 9,065ms | 12,392ms | +37% |
| 좌석선택 p95 | 514ms | 12,355ms | **24배** |
| 주문생성 p95 | 335ms | 12,345ms | **37배** |
| 결제 p95 | 421ms | 15,629ms | **37배** |
| 예매 성공률 | 35.3% | 5.8% | -83% |
| 좌석 경합 | 0건 | 22,405건 | 카운터 수정 효과 |

**결론**: DB 데이터 48배 증가로 쿼리 병목이 현실적으로 나타남. 성능 최적화(인덱스, 커넥션풀, 쿼리 튜닝)가 필요한 수준.

### 대시보드

- `$service_name` 변수 수정 → 서버 HTTP p99, DB 커넥션, JVM 스레드 패널 정상 표시
- `$__rate_interval` 적용 → 5xx, 에러 Top 5, Node CPU 패널 정상 표시
- kube-state-metrics 복구 → Pod 재시작 & OOM 패널 데이터 수집 시작
- conflict 카운터 → 좌석 경합 패널 22,405건 표시

### 재발 방지

- 시드 스크립트 `scripts/seed-2025/` 에 3단계 분리 저장 → 재실행 가능
- `$__rate_interval` 사용으로 scrape interval 변경에도 대시보드 자동 대응
- `extract-queries.sh`에 K6/rate_interval 변수 치환 추가 → 검증 스크립트 동기화

## Related Files

### goti-team-controller
- `load-tests/helpers/ticketing-actions.js` — think time 축소 (1~6초), 1~4석 다중 점유, conflict 카운터 수정
- `load-tests/my-config.env` — GAME_ID 변경 (3/25 → 3/26 KIA vs SSG)
- `scripts/seed-2025/generate-step1.py` — 2025 경기 720건 SQL 생성
- `scripts/seed-2025/step2-seat-statuses.sql` — 좌석 상태 350만 행 INSERT
- `scripts/seed-2025/step3-users-orders.sql` — 유저 33만 + 주문/결제 14만
- `scripts/seed-2025/run.sh` — 시드 실행 스크립트

### Goti-monitoring
- `grafana/dashboards/devops/load-test-command-center.json` — service_name 변수 + $__rate_interval + auto-refresh

### Goti-k8s
- `infrastructure/dev/network-policies/monitoring-netpol.yaml` — kube-state-metrics/operator API server egress
- `scripts/validate/extract-queries.sh` — K6 + $__rate_interval 변수 치환 추가
