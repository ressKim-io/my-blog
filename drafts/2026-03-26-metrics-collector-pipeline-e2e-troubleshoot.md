---
date: 2026-03-26
category: troubleshoot
project: goti-load-observer, Goti-k8s, Goti-monitoring
tags: [prometheus, alloy, servicemonitor, networkpolicy, istio-authorizationpolicy, grafana, mimir, goti-metrics-collector]
---

# goti-metrics-collector 관측 파이프라인 E2E 개통 — 3중 방어 레이어 + DB 스키마 불일치 해결

## Context

goti-metrics-collector(구 goti-load-observer)는 PostgreSQL/Redis에서 좌석·결제·대기열 비즈니스 메트릭을 수집하여 Prometheus `/metrics` 엔드포인트로 노출하는 Go 서비스다. Alloy(DaemonSet)가 ServiceMonitor를 통해 스크래핑 → Mimir → Grafana K6 대시보드로 시각화하는 구조.

ServiceMonitor 생성 후 Grafana에서 **모든 패널이 "No data"** 표시. 파이프라인 전 구간에 걸친 복합 문제였다.

**환경**: Kind 5노드, Istio sidecar injection + deny-all NetworkPolicy, Alloy v1.13.2 (monitoring namespace, sidecar 미주입)

## Issue

### 증상 1: Alloy scrape `up=0` (타임아웃)
```
# Mimir 쿼리 결과
up{job="goti-load-observer-dev"} = 0
```
monitoring namespace → goti namespace:9090 TCP 연결 자체가 타임아웃(5초 이내 응답 없음).

### 증상 2: 메트릭 0건 — goti_seats_*, goti_payment_* 미노출
```
# observer /metrics 엔드포인트에서 goti_ 메트릭 확인
goti_match_active_total 0
goti_guardrail_blacklist_size 0
# goti_seats_*, goti_payment_* → 아예 없음
```
collector health 메트릭(poll_duration)만 있고 비즈니스 메트릭이 전무.

## Action

### 증상 1 진단: 3중 방어 레이어 누락

goti namespace는 defense-in-depth 구조 (Istio AuthorizationPolicy L7 + NetworkPolicy L3/L4 양방향):

**가설 1: Istio AuthorizationPolicy가 9090 차단**
→ `allow-prometheus-scrape.yaml` 확인: 8080(Spring Boot), 15020/15090(Istio) 만 허용, **9090 누락**
→ 9090 추가 후에도 여전히 타임아웃

**가설 2: goti namespace ingress NetworkPolicy가 9090 차단**
→ `allow-monitoring-scrape` 확인: 동일하게 8080/15020/15090만, **9090 누락**
→ 추가 후에도 여전히 타임아웃

**가설 3: monitoring namespace egress NetworkPolicy가 9090 차단**
→ `allow-alloy-scrape-egress` 확인: goti namespace로의 egress도 8080/15020/15090만, **9090 누락**
→ 추가 후 **연결 성공** (HTTP 200, 1.6ms)

**근본 원인**: Go metrics-collector가 기존 Spring Boot(8080)과 다른 포트(9090)를 사용하는데, 새 포트를 3곳 모두에 추가해야 하는 것을 인지하지 못함.

| 레이어 | 리소스 | 수정 |
|--------|--------|------|
| L7 | Istio AuthorizationPolicy `allow-prometheus-scrape` | 9090 /metrics GET 추가 |
| L3/L4 인바운드 | NetworkPolicy `allow-monitoring-scrape` (goti ns) | monitoring→9090 추가 |
| L3/L4 아웃바운드 | NetworkPolicy `allow-alloy-scrape-egress` (monitoring ns) | goti:9090 추가 |

### 증상 2 진단: DB 스키마 + 빈 테이블 + aggregator 미연결

**가설 1: DB가 비어있음**
→ `ticketing_service.orders` 180K건, `seat_statuses` 3.6M건 확인. **DB는 풍부하게 시드되어 있었음**

**가설 2: search_path 문제**
→ DB `search_path = "$user", public` — observer가 스키마 미지정으로 쿼리 → `public` 스키마 참조 → public에는 0건
→ `ticketing_service` 스키마에 데이터 존재

**가설 3: game_seat_inventories 테이블 비어있음**
→ observer가 `game_seat_inventories` 테이블을 집계 소스로 사용 → 이 테이블은 양 스키마 모두 0건
→ 실제 좌석 데이터는 `seat_statuses` (3.6M건) + `seats` + `seat_sections` + `seat_grades` JOIN으로 집계해야 함

**가설 4: aggregator 파생 메트릭 미계산**
→ `UpdateSold()`, `UpdatePayment()` 메서드는 존재하나 poller에서 **호출하지 않음**
→ `fill_ratio`, `conversion_ratio` 등 파생 메트릭 계산 자체가 안 되고 있었음

**근본 원인**: observer 코드가 실제 DB 스키마와 불일치 (game_seat_inventories 미사용 + search_path 미고려) + aggregator 연결 누락

**적용한 수정** (goti-load-observer):
1. `game_seat_inventories` → `seat_statuses JOIN seats JOIN seat_sections JOIN seat_grades` 쿼리로 교체
2. 모든 쿼리에 `ticketing_service.` 스키마 명시
3. `NewDBPoller`에 aggregator 인자 추가, `pollSeats`/`pollOrders` 끝에서 `UpdateSold`/`UpdatePayment` 직접 호출
4. `goti_match_info` 메타데이터 메트릭 추가 (경기명 + 날짜 라벨)

## Result

### 파이프라인 검증 (E2E)
```
Observer Pod :9090/metrics
  → NetworkPolicy L3/L4 양방향 9090 허용 ✅
  → Istio AuthorizationPolicy L7 9090 /metrics GET ✅
  → Alloy scrape (ServiceMonitor, clustering) ✅
  → Mimir remote_write ✅
  → Grafana 대시보드 데이터 표시 ✅
```

```
# Mimir 쿼리 결과
up{job="goti-load-observer-dev"} = 1                    # scrape 성공
count(goti_seats_total) = 145                           # 145경기 좌석 데이터
goti_seats_fill_ratio{match_id="035875e1..."} = 0.80    # 파생 지표 계산됨
count(goti_payment_conversion_ratio) = 145              # 결제 전환율
count(goti_match_info) = 1414                           # 경기 메타 정보
```

### 대시보드 개선
- `${DS_MIMIR}` → `prometheus` 고정 UID (datasource not found 해소)
- 경기 선택 변수: UUID → "03/24 KIA vs SSG" 형태 드롭다운 (삼성/KIA 홈만, 날짜순)
- 구역별 좌석 bargauge 크기 확대 + 경기 상세 정보 테이블 추가

### 부하테스트 준비
- 4월 전체 삼성/KIA 홈 22경기 좌석 시드 완료 (~55만 row)
- `scripts/reset-game.sh` — 7테이블 cascade 리셋 (FK 정합성 보장, 전 스키마 검증 완료)

### 재발 방지
- **교훈**: defense-in-depth 환경에서 새 포트 추가 시 반드시 3곳 체크리스트 확인 (AuthorizationPolicy + ingress NetworkPolicy + egress NetworkPolicy)
- **교훈**: observer가 직접 DB 쿼리하는 구조에서는 스키마 명시 필수. `search_path` 의존 금지
- **교훈**: Prometheus client_golang의 GaugeVec은 Set() 호출 전까지 메트릭 미노출 — DB 0 row면 메트릭 자체가 사라짐

## Related Files

### Goti-k8s
- `infrastructure/dev/istio/goti-policy/templates/allow-prometheus-scrape.yaml`
- `infrastructure/dev/network-policies/goti-netpol.yaml`
- `infrastructure/dev/network-policies/monitoring-netpol.yaml`

### goti-load-observer
- `internal/poller/db_poller.go`
- `internal/metrics/registry.go`
- `internal/aggregator/aggregator.go`
- `cmd/collector/main.go`

### Goti-monitoring
- `charts/goti-monitoring/dashboards/devops/k6-load-test.json`

### goti-team-controller
- `scripts/reset-game.sh`
