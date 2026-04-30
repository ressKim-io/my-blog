---
title: "메트릭 파이프라인 E2E 개통 — AuthorizationPolicy부터 DB 스키마까지"
excerpt: "Go 메트릭 수집기를 배포했는데 Grafana에 아무것도 안 뜬다. Istio L7, NetworkPolicy L3/L4, DB search_path까지 3중 방어 레이어를 하나씩 뚫은 트러블슈팅"
type: troubleshooting
category: monitoring
tags:
  - go-ti
  - Prometheus
  - Istio
  - NetworkPolicy
  - PostgreSQL
  - Alloy
  - Troubleshooting
series:
  name: "goti-metrics-collector"
  order: 2
date: "2026-03-26"
---

## 한 줄 요약

> ServiceMonitor를 만들었는데 Grafana가 텅 비어있습니다. Istio AuthorizationPolicy, ingress/egress NetworkPolicy 3곳에서 포트 9090이 누락되어 있었고, DB 쿼리는 잘못된 스키마를 참조하고 있었습니다.

## Impact

- **영향 범위**: K6 부하테스트 대시보드 전체
- **증상**: 모든 비즈니스 메트릭 패널 No data
- **소요 시간**: 약 6시간
- **발생일**: 2026-03-26

---

## 🔥 증상: scrape부터 실패

goti-metrics-collector를 배포하고 ServiceMonitor를 생성했는데, Grafana에서 **모든 패널이 No data**였습니다.

```
# Mimir 쿼리
up{job="goti-load-observer-dev"} = 0
```

`up=0`이면 Alloy가 scrape 자체에 실패했다는 뜻입니다.
monitoring namespace에서 goti namespace:9090으로 TCP 연결이 타임아웃됐습니다.

---

## 🤔 1차 원인: 3중 방어 레이어에서 포트 누락

goti namespace는 defense-in-depth 구조입니다.
Istio AuthorizationPolicy(L7) + NetworkPolicy(L3/L4) 양방향으로 보호됩니다.

기존에 허용된 포트는 Spring Boot용이었습니다:
- 8080 (Spring Boot HTTP)
- 15020/15090 (Istio sidecar)

Go 메트릭 수집기가 사용하는 **9090 포트가 3곳 모두에서 누락**되어 있었습니다.

### 가설별 디버깅

**가설 1: Istio AuthorizationPolicy가 9090 차단**

```yaml
# allow-prometheus-scrape.yaml
rules:
  - to:
      - operation:
          ports: ["8080", "15020", "15090"]  # 9090 없음!
```

9090을 추가했는데, 여전히 타임아웃.

**가설 2: goti namespace ingress NetworkPolicy가 9090 차단**

```yaml
# allow-monitoring-scrape (goti ns)
ingress:
  - from: [{namespaceSelector: monitoring}]
    ports: [8080, 15020, 15090]  # 9090 없음!
```

9090을 추가했는데, 여전히 타임아웃.

**가설 3: monitoring namespace egress NetworkPolicy가 9090 차단**

```yaml
# allow-alloy-scrape-egress (monitoring ns)
egress:
  - to: [{namespaceSelector: goti}]
    ports: [8080, 15020, 15090]  # 9090 없음!
```

9090을 추가하니 **연결 성공**! (HTTP 200, 1.6ms)

### defense-in-depth 체크리스트

새 포트를 추가할 때 **3곳 모두** 확인해야 합니다:

| 레이어 | 위치 | 역할 |
|--------|------|------|
| L7 | Istio AuthorizationPolicy | HTTP 메서드/경로 기반 허용 |
| L3/L4 인바운드 | target namespace ingress NetworkPolicy | TCP 포트 허용 (받는 쪽) |
| L3/L4 아웃바운드 | source namespace egress NetworkPolicy | TCP 포트 허용 (보내는 쪽) |

한 곳이라도 빠지면 연결이 안 됩니다.
가설 1에서 L7만 열어도 L3/L4가 차단하니까 타임아웃이 계속됐고, L3/L4 인바운드를 열어도 아웃바운드가 차단했습니다.

---

## 🤔 2차 원인: DB 스키마 불일치

scrape가 성공한 뒤 `/metrics`를 확인했는데, 비즈니스 메트릭이 없었습니다

- `goti_match_active_total` → 0
- `goti_guardrail_blacklist_size` → 0
- `goti_seats_*`, `goti_payment_*` → 응답 자체에 없음

health 메트릭만 있고 비즈니스 메트릭이 전무했습니다.

### 가설 1: DB가 비어있나?

```sql
SELECT count(*) FROM ticketing_service.orders;      -- 180,000건
SELECT count(*) FROM ticketing_service.seat_statuses; -- 3,600,000건
```

DB는 풍부하게 시드되어 있었습니다.

### 가설 2: search_path 문제

collector가 SQL에서 스키마를 명시하지 않고 있었습니다.

```sql
-- collector 코드
SELECT count(*) FROM orders;  -- public.orders (0건)

-- 실제 데이터 위치
SELECT count(*) FROM ticketing_service.orders;  -- 180,000건
```

PostgreSQL의 `search_path`가 `"$user", public`이라 스키마 미지정 시 `public`을 참조합니다.
데이터는 `ticketing_service` 스키마에 있었습니다.

### 가설 3: 잘못된 테이블 참조

collector가 `game_seat_inventories` 테이블을 집계 소스로 사용하고 있었는데, 이 테이블은 **양 스키마 모두 0건**이었습니다.
실제 좌석 데이터는 `seat_statuses` + `seats` + `seat_sections` + `seat_grades` JOIN으로 집계해야 합니다.

### 가설 4: aggregator 미연결

파생 지표를 계산하는 `aggregator.UpdateSold()`, `aggregator.UpdatePayment()` 메서드가 존재하지만, poller에서 **호출하지 않고 있었습니다**.
`fill_ratio`, `conversion_ratio` 같은 파생 메트릭 계산 자체가 안 되고 있었습니다.

---

## ✅ 수정 내용

### 네트워크 정책 (3곳)

| 레이어 | 파일 | 수정 |
|--------|------|------|
| L7 | `allow-prometheus-scrape.yaml` | ports에 `"9090"` 추가, paths에 `/metrics` GET |
| L3/L4 인바운드 | `goti-netpol.yaml` | monitoring → goti:9090 ingress 추가 |
| L3/L4 아웃바운드 | `monitoring-netpol.yaml` | alloy → goti:9090 egress 추가 |

### DB 쿼리 수정

1. 모든 쿼리에 `ticketing_service.` 스키마 명시
2. `game_seat_inventories` → `seat_statuses JOIN seats JOIN seat_sections JOIN seat_grades` 쿼리로 교체
3. poller에서 `aggregator.UpdateSold()`, `aggregator.UpdatePayment()` 호출 추가

### 검증 결과

```
up{job="goti-load-observer-dev"} = 1                    # scrape 성공
count(goti_seats_total) = 145                           # 145경기 좌석 데이터
goti_seats_fill_ratio{match_id="035875e1..."} = 0.80    # 파생 지표 계산
count(goti_payment_conversion_ratio) = 145              # 결제 전환율
```

---

## 📚 배운 점

### Defense-in-depth에서 새 포트 추가 시 체크리스트

이번 건의 핵심 교훈입니다. 기존 Spring Boot(8080)에 최적화된 보안 정책이 있는 상태에서, 새 서비스가 다른 포트(9090)를 쓰면 **3곳 모두 업데이트**해야 합니다.

```
[ ] Istio AuthorizationPolicy — L7 (HTTP 메서드/경로/포트)
[ ] target namespace ingress NetworkPolicy — L3/L4 인바운드
[ ] source namespace egress NetworkPolicy — L3/L4 아웃바운드
```

한 곳만 빠져도 연결이 안 되고, 디버깅 시 "어느 레이어가 차단하는지" 파악이 어렵습니다.
위에서부터 하나씩 열면서 확인하는 게 가장 확실합니다.

### PostgreSQL search_path를 신뢰하지 말자

외부 서비스가 DB에 직접 접근할 때는 **항상 스키마를 명시**해야 합니다.
`search_path`는 세션 설정이라 예상과 다를 수 있고, 같은 테이블 이름이 여러 스키마에 존재할 수 있습니다.

### Prometheus GaugeVec은 Set() 호출 전까지 메트릭을 노출하지 않는다

`client_golang`의 `GaugeVec`은 한 번도 `Set()`이 호출되지 않은 label 조합은 `/metrics`에 **아예 나타나지 않습니다**.
DB에 해당하는 row가 0건이면 메트릭 자체가 사라지는 것입니다.
이것은 "값이 0"이 아니라 "메트릭이 없음"으로 처리되므로, Grafana에서 No data로 보입니다.
