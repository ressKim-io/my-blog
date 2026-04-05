# Queue POC (수연) Saturation 부하 테스트 결과

테스트일: 2026-03-29
테스터: ress
도구: K6
대상: goti-queue (수연 구현체) — 대기열 진입 → 폴링 → 좌석 선택 → 결제 E2E

---

## 1. 테스트 목적

수연 Queue POC의 처리 한계(saturation point)를 파악한다.

- 단일 pod 환경에서 동시 사용자 수 증가에 따른 성능 변화 측정
- 대기열 순환(leave → 승격) 메커니즘의 정상 동작 검증
- 스케일아웃 필요 시점 판단을 위한 기준 데이터 확보

**SLO 기준**:
- `http_req_failed` < 1%
- `http_req_duration` p(95) < 2,000ms
- `queue_pass_rate` > 80%
- `goti_ticket_success_rate` > 80%

## 2. 테스트 환경

### 인프라 구성

| 구성요소 | 스펙 | 비고 |
|----------|------|------|
| Kind 클러스터 | 5노드 (1 CP + 4 worker) | Ubuntu 32GB RAM, 12 CPU |
| goti-queue (수연) | 1 pod (replica=1) | CPU 100m-500m, Memory 512Mi-1Gi |
| goti-ticketing | 6 pods | 좌석 선택/결제 처리 |
| Redis | 호스트 PC, DB 0 | 분산락 + 대기열 상태 저장 |
| maxCapacity | 100 | 동시 처리 가능 인원 |
| 네트워크 경로 | Mac → Cloudflare CDN → Istio Gateway → Queue Service | 외부 네트워크 지연 포함 |

### 애플리케이션 설정

- Java OTel Agent: 2.25.0
- Istio sidecar injection 활성화
- Cloudflare CDN/Proxy 경유 (Mac 로컬 → 외부 네트워크)

### 테스트 도구 설정

- K6 (Mac 로컬 실행)
- 시나리오: 대기열 진입 → 폴링 대기 → 좌석 선택 → 결제 E2E 흐름

## 3. 테스트 시나리오

| # | 시나리오 | 설명 | VU | 비고 |
|---|----------|------|----|------|
| 1 | Saturation 300 VU | 안정 동작 확인 | 300 | 전체 threshold 통과 |
| 2 | Saturation 1000 VU | 처리 한계 탐색 | 1000 | threshold 실패 |
| 3 | Saturation 3000 VU | 한계 확인 | 3000 | threshold 실패, 포화 확정 |

### 시나리오별 요청 흐름

```
1. POST /queue/enter          — 대기열 진입
2. GET  /queue/status (poll)  — 대기 상태 폴링 (통과까지 반복)
3. POST /seat/select          — 좌석 선택
4. POST /payment              — 결제
```

## 4. 테스트 결과

### 4.1 종합 요약

| 지표 | 300 VU | 1000 VU | 3000 VU | SLO 기준 |
|------|--------|---------|---------|----------|
| exit code | 0 | 99 | 99 | 0 |
| queue_pass_rate | 89.79% | 84.3% | 82.8% | > 80% |
| goti_ticket_success_rate | 89.77% | 84.0% | 82.5% | > 80% |
| http_req_failed | 0.64% | 0.45% | 0.2% | < 1% |
| http_req_duration p(95) | 402ms | 1,808ms | 1,209ms | < 2,000ms |
| http_req_duration p(99) | 556ms | 미측정 | 미측정 | - |
| iterations | 4,764 | 4,477 | 4,577 | - |
| iterations/s | **13.4/s** | **11.9/s** | **12.1/s** | - |
| http_reqs | 75,931 | 158,908 | 418,453 | - |
| http_reqs/s | 214/s | 421/s | 1,109/s | - |

### 4.2 대기열 메트릭 상세

| 지표 | 300 VU | 1000 VU | 3000 VU | 비고 |
|------|--------|---------|---------|------|
| queue_enter_ms p(95) | 532ms | 4,847ms | 2,754ms | 분산락 경합 지표 |
| queue_enter_ms avg | 미측정 | 1,448ms | 1,136ms | |
| queue_seat_enter_ms p(95) | 511ms | 미측정 | 1,320ms | |
| queue_wait_duration avg | 미측정 | 67.4s | 158.2s | maxCapacity 설계에 의한 대기 (성능 지표 아님) |
| queue_wait_duration p(95) | 19.0s | 88.3s | 237.7s | |
| queue_poll_count avg | 5.75 | 미측정 | 54 | |
| queue_immediate_pass_rate | 2.05% | 미측정 | 1.3% | |
| queue_e2e_duration avg | 19.2s | 미측정 | 162.7s | 대기 시간 포함 전체 E2E |

### 4.3 처리량 비교 (핵심)

| 지표 | 300 VU | 1000 VU | 3000 VU | 분석 |
|------|--------|---------|---------|------|
| iterations/s | **13.4/s** | **11.9/s** | **12.1/s** | **완전 포화 — VU 10배 올려도 처리량 동일** |
| http_reqs/s | 214/s | 421/s | 1,109/s | 폴링 횟수 증가(대기 시간 증가)에 의한 req 수 증가 |

### 4.4 에러 분석

| 에러 유형 | 300 VU | 1000 VU | 원인 |
|-----------|--------|---------|------|
| http_req_failed | 0.64% | 0.45% | 타임아웃/5xx (정상 범위) |
| queue 미통과 (leave) | 10.21% | 15.7% | maxCapacity 제한에 의한 정상 탈락 |
| 티켓 실패 | 10.23% | 16.0% | 대기열 미통과에 비례 |

에러율 자체는 양쪽 모두 SLO 이내이나, 1000 VU에서 threshold 실패는 queue_enter 응답 시간 급등에 의한 것으로 판단.

## 5. 성능 지표 해석 가이드

대기열 부하테스트에서 **무엇을 보고 판단하는가**:

| 관점 | 메트릭 | 의미 | 이 테스트 결과 |
|------|--------|------|---------------|
| **처리 능력** | `iterations/s` | pod이 초당 몇 건의 E2E를 완료하는가 | 12~13 TPS (pod 1개 한계) |
| **응답 속도** | `queue_enter p95` | 진입 API 95th percentile 응답시간 | 300VU=532ms, 3000VU=2.7s |
| **안정성** | `http_req_failed` | 과부하에서 서버가 5xx를 뱉는가 | 0.2~0.6% (안정) |
| **대기열 효율** | `queue_pass_rate` | 줄 선 사람이 타임아웃 없이 입장하는가 | 82~90% |

**주의: `queue_wait_duration`은 성능 지표가 아님.**
대기 시간은 maxCapacity(동시 수용 인원)와 VU(접속자 수)의 비율에 의해 결정됨.
- maxCapacity=100, VU=3000 → 대기 158초는 정상 (2900명이 100명씩 순환)
- maxCapacity=5000, VU=3000 → 대기 거의 없음 (전원 즉시 입장)

**핵심 판단 기준**: iterations/s가 VU를 올려도 증가하지 않으면 → **pod 처리 한계 도달** → 스케일아웃 필요.

## 6. 병목 지점 분석

### 단일 pod 처리 한계 도달

- **iterations/s가 300 VU(13.4/s)와 1000 VU(11.9/s)에서 거의 동일** — 전형적인 saturation 징후
- VU를 3.3배 늘려도 처리량이 증가하지 않고, 오히려 11.2% 감소
- 병목은 queue pod 1개의 처리 능력 (CPU 500m 상한)

### 분산락 경합

- `queue_enter_ms` p(95): 532ms → 4,847ms (9.1배 급등)
- Redis 분산락 획득 대기가 동시 요청 증가에 비례하여 증가
- 단일 pod 내 분산락 직렬화 구간이 throughput ceiling 결정

### 대기 시간 선형 증가

- `queue_wait_duration` p(95): 19.0s → 88.3s (4.6배)
- maxCapacity=100 고정 상태에서 VU 증가 → 대기열 길이 증가 → 폴링 횟수 및 대기 시간 비례 증가
- 이는 대기열 순환 메커니즘이 정상 동작함을 의미 (병목이 아닌 설계 의도)

### 네트워크 경로 오버헤드

- Mac → Cloudflare → Kind PC 경로로 인한 추가 지연 존재
- 순수 서버 성능 측정을 위해 Kind PC 로컬 테스트 필요

## 7. 개선 방안

| # | 개선 항목 | 예상 효과 | 우선순위 | 담당 |
|---|----------|----------|----------|------|
| 1 | queue pod replica 2~3개 스케일아웃 | iterations/s 선형 증가, enter 지연 분산 | P0 | ress |
| 2 | Kind PC 로컬 K6 실행 (네트워크 지연 제거) | 순수 서버 성능 기준선 확보 | P1 | ress |
| 3 | 준상/성전 POC 동일 조건 비교 테스트 | A/B/C 구현체 성능 비교 데이터 | P1 | ress |
| 4 | maxCapacity 튜닝 (100 → 150/200) | 대기열 회전율 향상, 대기 시간 감소 | P2 | 수연 |
| 5 | 분산락 최적화 (TTL/재시도 간격 조정) | enter 지연 감소 | P2 | 수연 |

## 8. 이전 테스트 대비

최초 saturation 테스트로 비교 대상 없음. 본 결과를 기준선(baseline)으로 사용한다.

| 기준선 (300 VU, 단일 pod) | 값 |
|---------------------------|-----|
| iterations/s | 13.4/s |
| http_req_duration p(95) | 402ms |
| queue_enter_ms p(95) | 532ms |
| queue_pass_rate | 89.79% |

## 9. 첨부

- Grafana 대시보드: `grafana.go-ti.shop` — K6 Load Test / Queue 대시보드 참조
- K6 스크립트: `load-tests/scenarios/` (goti-team-controller)
