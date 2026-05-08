---
title: "부하테스트 방법론 ADR — k6 + queue-oneshot + Mimir Push로 정착"
excerpt: "티켓팅 non-stationary 부하 프로파일에서 의미 있는 검증을 위해 k6 + Prometheus Remote Write to Mimir + per-vu-iterations 1 원샷 모델을 4개 결정 축으로 분리해 채택한 방법론 기록입니다"
category: "challenge"
tags:
  - go-ti
  - LoadTest
  - k6
  - Mimir
  - Grafana
  - adr
series:
  name: "goti-loadtest"
  order: 4
date: "2026-03-27"
---

## 한 줄 요약

> 티켓팅 피크를 정량 비교하기 위해 k6 `per-vu-iterations: 1` 원샷 모델 + Prometheus Remote Write → Mimir + ALB/CF 이원 측정을 표준 방법론으로 채택했습니다. 이 방법론으로 대기열 POC 3종 비교, Java → Go 전환 근거 데이터, PgBouncer 합산 효과 측정을 수행했습니다

---

## 배경

### 왜 방법론이 필요했는가

티켓팅 서비스는 평상시 트래픽이 조용하다가 티켓 오픈 순간에 동시 접속자 수만~수십만이 같은 초에 몰리는 극단적인 non-stationary 부하 프로파일을 갖습니다.
이 환경에서 의미 있는 부하 검증은 다섯 가지를 동시에 요구합니다.

1. **E2E 세션 유지**: 대기열 진입 → admitted → 좌석 조회 → 좌석 hold → 주문 → 결제 → leave까지 한 사용자 흐름이 끊기지 않아야 실제 예매 성공률을 관측할 수 있습니다
2. **구현 간 공정 비교**: 대기열 POC 3종을 비교할 때 같은 클러스터·같은 시점·같은 데이터로 측정해야 결론이 섭니다. 테스트 환경이 조금만 달라져도 숫자가 쏠립니다
3. **계층별 병목 분리**: Cloudflare / ALB / Istio / MSA / Redis / PostgreSQL 중 누가 병목인지 구분할 수 있는 측정 경로 분리가 필요합니다
4. **분산 실행 지원**: 수천 VU를 단일 PC에서 돌리면 OOM이 발생합니다. 팀원 여러 명이 동시에 돌릴 때 runner별 결과를 섞이지 않게 관측할 수 있어야 합니다
5. **재현성**: POC 비교는 1회성이 아니라 구현 수정 후 재측정이 반복됩니다. 매 실행을 스크린샷으로만 남기면 비교가 불가능합니다

### 기존 접근의 한계

기존 방식에는 네 가지 구조적 문제가 있었습니다.

**단일 RPS 측정**은 티켓팅 피크를 대변하지 못합니다.
5분 평균 RPS가 높아도 1초 피크에서 무너지면 실패입니다.

**로컬 summary만 남기기**는 runner 간 비교를 막습니다.
`k6 --summary-export`는 1회 실행치만 JSON 덩어리로 저장하고, 시계열 추적과 annotation이 불가능합니다.

**서버 쪽 메트릭만 신뢰**하면 실제 사용자 경험이 보이지 않습니다.
클라이언트가 관측한 TTFB·TLS·blocking은 서버 Prometheus로는 드러나지 않습니다.

**POC 3종을 하루에 여섯 번 돌리는** 환경에서 수동 설정과 결과 파일이 혼재하면 이틀 만에 "어떤 JSON이 어떤 조건이었지?" 상황이 발생합니다.

---

## 🧭 선택지 비교

본 ADR은 복합 결정이므로 결정 축을 네 개로 분리했습니다.

### 축 A — 부하 도구

| 후보 | 장점 | 기각 사유 |
|------|------|-----------|
| Gatling (Scala DSL) | JVM 성숙도, HTML 보고서 | Scala DSL 러닝 커브, JVM warmup이 runner 자체에도 영향, CI 통합·스크립트 재사용성 낮음 |
| Locust (Python) | Python 친화, 분산 실행 기능 내장 | GIL로 CPU-bound 워크로드에서 처리량 낮음, VU당 메모리 큼, Prometheus export가 외부 플러그인 의존 |
| JMeter | GUI, 엔터프라이즈 성숙도 | XML 기반 시나리오라 버전 관리·리뷰 불편, 현대적 CI·Git 플로우에 맞지 않음 |
| **k6 (JavaScript)** | **채택** — JS 시나리오 작성 빠름, 단일 바이너리, Prometheus Remote Write 내장, Grafana 친화, thresholds 선언적, VU당 약 5 MB(경량) | — |

k6를 선택한 핵심은 두 가지입니다.
첫째, `prometheusRW` output이 내장되어 있어 별도 exporter 없이 Mimir에 직접 Push할 수 있습니다.
둘째, `thresholds`를 시나리오 파일에 선언적으로 작성하면 통과·실패 판정이 자동화되어 "합격인 척 넘어가기"를 구조적으로 방지합니다.

Gatling은 보고서 품질이 우수하지만, 팀 스택이 JavaScript 기반이고 1주 시연 범위에서 Scala DSL 러닝 커브를 소화하기 어렵다고 판단했습니다.
Locust는 분산 실행이 내장되어 매력적이지만, GIL로 인한 처리량 상한과 Prometheus export 플러그인 의존이 결정적 약점이었습니다.

### 축 B — 메트릭 수집 방식

| 후보 | 기각 사유 |
|------|-----------|
| 로컬 `--summary-export` JSON만 | runner 간 통합 불가, 시계열 없음, 비교 난이도 상승 |
| InfluxDB v1/v2 output | 별도 스택 운영 필요, Grafana 탐색 경험이 Prometheus/Mimir 대비 약함 |
| **Prometheus Remote Write → Grafana Mimir** | **채택** — 기존 관측성 스택과 단일화, runner·endpoint·test 라벨로 쿼리 가능, 시계열 보존 |

기존 관측성 스택(Grafana Mimir)이 이미 운영 중이었습니다.
여기에 k6 메트릭을 Push하면 서버 Prometheus 메트릭과 같은 대시보드에서 클라이언트 관점의 지표를 나란히 볼 수 있습니다.

`runner` 라벨을 붙이면 팀원 여러 명이 동시에 측정해도 runner별 분리 집계가 가능하고, 합산도 선택적으로 가능합니다.
InfluxDB는 별도 스택을 운영해야 하고, 팀이 Grafana + PromQL에 이미 익숙하다는 점에서 기각했습니다.

### 축 C — 시나리오 모델

| 후보 | 적합성 |
|------|--------|
| `constant-vus` / `ramping-vus` | 정적·선형 부하에는 유용하지만, "1명이 1번 티켓팅하는 E2E"를 VU 라이프사이클에 매핑하기 어렵습니다 |
| VU당 무한 반복 (기본값) | 같은 사용자가 예매를 계속 반복하는 모양이 되어 실제 사용자 행동과 통계 해석의 괴리가 생깁니다 |
| **`per-vu-iterations: 1` 원샷 모델** | **채택** — 1 VU = 1 사용자 = 1회 E2E. 3000 VU 실행 = 3000명이 1회씩 예매 시도. 결과 해석이 도메인과 1:1 매핑됩니다 |

티켓팅 도메인에서 "3000명이 동시에 예매 시도한다"는 시나리오를 그대로 코드로 표현할 수 있다는 점이 결정적이었습니다.
VU당 무한 반복 모델에서는 `goti_ticket_success_rate`가 "한 사람이 예매에 몇 번 성공했는가"를 집계하게 되어 도메인 해석이 어긋납니다.

다만 read-only 관측용은 `constant-vus`가 적합합니다.
멀티클라우드 양쪽 클러스터의 p95를 장시간 비교할 때는 상태 변경 없이 균일한 부하를 유지하는 것이 중요하기 때문입니다.

### 축 D — 측정 경로

| 후보 | 기각 사유 |
|------|-----------|
| Cloudflare 경유 단일 측정 | Cloudflare Free plan rate limit(일 100K req)이 3000 VU 부하에 걸려 서버 capacity와 WAF 차단이 섞입니다 |
| ALB 직접 단일 측정 | 실제 사용자 경로가 아닙니다. 실서비스의 Cloudflare 캐싱·TLS·WAF 효과가 관측되지 않습니다 |
| **ALB 직접 + Cloudflare 경유 이원 측정** | **채택** — capacity baseline은 ALB, 실사용자 경험은 Cloudflare. 두 수치의 차이 자체가 edge 효과 정량화입니다 |

두 경로를 동시에 측정하면 "서버가 얼마나 버티는가"와 "실제 사용자가 경험하는 속도"를 분리해서 볼 수 있습니다.
Cloudflare rate limit(HTTP 429 / error 1015)을 capacity 측정과 분리하는 구조적 이유이기도 합니다.

---

## ✅ 결정

**k6 + Prometheus Remote Write(Mimir) + `per-vu-iterations: 1` 원샷 모델 + ALB/CF 이원 측정 + RUNNER\_ID 분산 실행**을 티켓팅 부하테스트의 표준 방법론으로 채택했습니다.

### 측정 흐름

Runner(로컬 PC 또는 EC2)에서 k6가 E2E HTTP 요청을 실행합니다.
`ENV=prod-alb` 프리셋을 쓰면 ALB 직접 경로로, `BASE_URL`을 Cloudflare 도메인으로 설정하면 CF 경유 경로로 측정합니다.
k6는 실행 중 Prometheus Remote Write로 메트릭을 Mimir에 Push하고, Grafana 대시보드에서 runner·test·endpoint 라벨로 분리 집계합니다.

### 핵심 기술 선택 요약

| 축 | 선택 | 핵심 이유 |
|----|------|-----------|
| 도구 | k6 v0.56+ | JS 시나리오, 단일 바이너리, Prom Remote Write 내장 |
| 시나리오 모델 | `per-vu-iterations: 1` (queue-oneshot) | 1 VU = 1 사용자 1회 티켓팅. 도메인과 1:1 |
| 관측용 모델 | `constant-vus` (multicloud-readonly) | 장시간 read-only 폴링, 양 클러스터 p95 비교 |
| 메트릭 수집 | Prometheus Remote Write → Mimir | 기존 관측 스택과 통합, 라벨 기반 쿼리 |
| 토큰 발급 | `setup()`에서 VU 수만큼 일괄 signup | signup 병목과 실제 피크 성능 분리 |
| 경로 분리 | `ENV=prod-alb` vs `BASE_URL=https://<cf-domain>` | WAF/edge 효과 정량화 |
| Runner 분산 | `RUNNER_ID=0..N` + `START_TIME=HH:MM:SS` | 계정 풀 분리, 초 단위 동시 시작 |
| 초기화 | Redis `FLUSHDB` + `game-seats init` + HPA/KEDA off | 공정 비교 4대 필수 |
| 임계치 | `thresholds` JSON 선언 필수 | `queue_pass_rate`, `goti_ticket_success_rate` 등 |

### 표준 커스텀 메트릭

서버 Prometheus가 아닌 **클라이언트 관점**의 도메인 메트릭을 k6 `Trend`/`Rate`로 정의하고 Mimir로 Push합니다.

| 메트릭 | 의미 |
|--------|------|
| `queue_enter_ms` | `/queue/enter` 응답 시간 |
| `queue_status_ms` | `/queue/status` 폴링 응답 (대기열 POC 핵심 지표) |
| `queue_wait_duration_ms` | admitted 될 때까지 실제 대기 시간 |
| `queue_seat_enter_ms` | admitted 후 좌석 진입까지 |
| `queue_pass_rate` | `admitted / (admitted + timeout)` |
| `goti_ticket_success_rate` | E2E 전체 성공률 (결제까지) |
| `goti_order_creation_ms` / `goti_payment_ms` / `goti_seat_selection_ms` | 각 단계 p50/p95/p99 |

서버 메트릭만으로는 "클라이언트가 실제로 기다린 시간"을 알 수 없습니다.
`queue_wait_duration_ms`는 admitted 신호를 받기까지 k6 VU가 실제로 루프를 돌며 기다린 시간을 측정하므로, 사용자 경험과 직결됩니다.

### 결정 규칙 (불변)

1. **토큰은 `setup()`에서 일괄 발급** — VU 루프 안에서 signup 호출 금지. signup 자체 부하는 별도 시나리오로만 측정합니다
2. **Redis FLUSHDB가 측정 전 필수** — 이전 실행의 큐 잔재(activeCount 누적, waiting key)가 다음 실행을 오염시킵니다
3. **HPA/KEDA는 capacity 측정 시 비활성** — replica가 부하 중 흔들리면 "어떤 replica 수가 얼마를 처리했는지" 불분명해집니다
4. **모든 실행은 Mimir에 Push** — 로컬 summary만 남기기 금지. `RUNNER_ID` + `RUNNER_NAME` + `test` 라벨 필수입니다
5. **3개 구현체 비교는 Redis DB 분리** — 네임스페이스 충돌 방지를 위해 각 구현체에 별도 DB를 할당합니다
6. **threshold 위반 시 명시적 판정 기록** — `✗` 항목을 결과 문서 요약 표 상단에 두어 "합격인 척 넘어가기"를 방지합니다
7. **Cloudflare 경유 대량 부하 전 WAF 룰 조율** — 단일 IP 요청 폭주는 1015 rate limit을 유발합니다. capacity baseline은 반드시 ALB 직접으로 측정합니다

### 의식적으로 하지 않은 것

- **분산 실행 플랫폼 도입 보류** (k6 Operator, k6 Cloud) — 팀원 4명이 수동 분산으로도 충분하고, Operator 운영 오버헤드가 1주 시연 범위를 초과합니다
- **Gatling/JMeter 이중 도입 안 함** — 도구 하나로 수렴했습니다. 공정 비교 맥락에서 도구 간 숫자 혼재를 방지합니다

---

## 결과

### 이 방법론으로 확보한 것

이 방법론이 실질적으로 기여한 결정들을 정리합니다.

**대기열 POC 3종 비교 (2026-04-03)**: POC 3종을 동일 환경에서 비교해 `queue_status p95`를 1.98s → 334ms(약 6배)로 개선한 CDN 캐싱 방식의 근거를 제시했습니다.
방법론 없이는 "어느 팀원 구현이 좋더라" 수준을 넘지 못했을 것입니다.

**Java → Go 전환 근거 데이터**: Java 3000 VU 실측으로 `seat-grades p95 6.84s / 5xx 10.88%` 같은 정량 병목을 포착했습니다.
Go 마이그레이션 결정의 수치 근거가 됐습니다.

**PgBouncer 합산 효과 측정**: PgBouncer + Go + Redis 캐시 + ANALYZE 의 합산 효과를 endpoint 단위로 정량 기록했습니다.

**멀티클라우드 read-only 경로 검증 (2026-04-18)**: `multicloud-readonly` 시나리오로 AWS/GCP 양쪽 p95를 동일 대시보드에서 비교했습니다.

**Capacity planning 초기 틀**: pod당 안정 RPS, KEDA threshold 산정 근거를 측정했습니다.

### 관측 가능한 효과

2주 전 측정치가 Mimir에 그대로 남아 있어 구현 수정 후 비교가 가능합니다.
팀원 여러 명이 동시에 측정해도 `runner` 라벨로 분리 집계하고 합산도 선택적으로 가능합니다.
Java 프로덕션 부하에서 서버 p95와 k6 클라이언트 TTFB를 동시에 관측해 Cloudflare vs ALB vs MSA 병목을 구분했습니다.

### 현 시점 운영 시나리오 (2026-04-20 기준)

`Goti-load-test/scenarios/`에 여러 시나리오가 있지만 운영을 유지하는 것은 두 개입니다.

- **`queue-oneshot`** — `per-vu-iterations: 1`, 티켓 오픈 피크 재현용
- **`multicloud-readonly`** — `constant-vus`, read-only 엔드포인트 4종, 양 클러스터 p95 비교용

나머지(`smoke`, `e2e`, `spike`, `soak`, `normal`, `queue-poc-*`, `flow-debug`, `synthetic-traffic`)는 초기 실험용으로 보존만 하고 `run.sh` 분기에서 제거됐습니다.

---

## 리스크와 제약

### 알려진 리스크

**Cloudflare Free plan rate limit** — 단일 IP 대량 요청 시 HTTP 429 / error 1015가 발생합니다.
Cloudflare 경유 3000 VU 측정에서 `queue_pass_rate 40.89%` 하락의 원인이었습니다.
대응 방침: capacity는 ALB 직접, CF는 소규모·회복 후 재측정으로 분리합니다.

**VU당 메모리 약 5 MB 제약** — c7g.xlarge(8 GB) 한도는 약 1,500 VU, r7g.xlarge(32 GB)는 약 6,000 VU입니다.
50만 VU는 물리적 runner 40~100대가 필요합니다.
현 방법론은 수천 VU 범위까지 유효하며, 더 큰 규모는 k6 Operator 또는 k6 Cloud를 별도로 검토해야 합니다.

**`per-vu-iterations: 1`의 꼬리 요청 왜곡** — 테스트 말미에 남은 VU가 적어 처리량 계산이 꺾입니다.
시나리오 duration과 ramp 조율로 완화하고, 각 결과 문서에 ramp 프로파일을 명시합니다.

**공정 비교의 계절성** — RDS CPU, EKS 스팟 가용성, Cloudflare 라우팅 PoP이 시점에 따라 달라져 같은 숫자가 재현되지 않을 수 있습니다.
최소한 같은 날·같은 시간대 내 비교로 제한합니다.

### Reversibility

- **도구 교체**: k6 시나리오는 JavaScript 기반이라 Locust/Gatling으로 포팅 가능합니다. 단, 합산 비교는 끊깁니다
- **메트릭 수집**: `PUSH_METRICS=false` 한 줄로 Mimir Push 비활성, 로컬 summary로 즉시 전환 가능합니다
- **비가역 요소 없음** — 방법론 자체가 측정 계층이지 운영 계층이 아닙니다

### 비용

EC2 c7g.xlarge 1~4대 × 측정 시간(수 분~수십 분)으로 회당 $1 이하입니다.
Mimir 저장 비용은 cardinality 관리가 필요합니다. `endpoint`·`runner` 외 라벨 확산을 제한하고 장기적으로 drop rule 대상에 포함시킵니다.

---

## 실행 기록

| 일자 | 이벤트 |
|------|--------|
| 2026-03-27 | k6 2-Phase 설계. 파일 구조 Option A/B/C 중 Option C(E2E 사람별 + 비교 시나리오 `QUEUE_IMPL` 패턴) 채택 |
| 2026-03-29 | POC C 단독 saturation 측정 |
| 2026-04-03 | **POC 3종 1000 VU / 3000 VU 비교 완료** — 방법론이 실전 공정 비교에 정착. ALB 직접·Redis DB 분리·`setup()` 일괄 signup·thresholds 선언 확립 |
| 2026-04-04 | CDN 경유 3000 VU 실측. Cloudflare rate limit 이슈 최초 관측 |
| 2026-04-11 | `ENV=prod-alb` 프리셋 확립. ALB URL·Host header·STADIUM\_ID·HOME\_TEAM\_ID 자동 설정. EC2(c7g.xlarge) 1500 VU 안정 운영 확인 |
| 2026-04-12 | **Capacity planning 시나리오 매트릭스 S1~S5 설계** — pod 단위 RPS·VU 한계, 선형성 검증, 큐 소비 속도·인증 오버헤드 분리 |
| 2026-04-14 | 3000 VU queue-oneshot으로 PgBouncer + Go + 캐시 합산 효과 측정. `queue_status p95 73ms` 관측 |
| 2026-04-18 | **multicloud-readonly 시나리오 신규** — Cloudflare Worker 경로로 AWS/GCP 양쪽 분배 read-only 관측 |

---

## 후속 과제

1. **Mimir 메트릭 cardinality 관리** — `k6_*` 메트릭 drop rule / active\_series 제한
2. **signup / polling 경로 분리 시나리오** — Cloudflare rate limit 우회, 순수 polling 성능 재측정
3. **50만 VU 시나리오 설계** — 현 방법론으로는 runner 물리 한계. k6 Operator on K8s 도입 가능성 별도 ADR 검토
4. **부하테스트 자동화 파이프라인** — PR merge → ArgoCD sync → `synthetic-traffic` CronJob 상시 smoke. 현 수동 실행 패턴을 CI 기반으로 전환

---

## 📚 배운 점

### 복합 결정은 축을 분리해야 합니다

"어떤 도구를 쓸 것인가"와 "메트릭을 어디에 저장할 것인가"는 독립적인 결정입니다.
두 결정을 묶어서 "k6가 좋다"로만 정리하면 나중에 하나를 바꿀 때 나머지도 흔들립니다.
축을 분리하면 각 축의 대안이 명확해지고, 이후 한 축만 교체하는 결정도 수월해집니다.

### signup 병목과 피크 성능은 반드시 분리합니다

`setup()`에서 토큰을 일괄 발급하지 않으면 VU 루프 안에서 signup이 실행되어 signup 자체가 병목이 됩니다.
이 경우 측정하고자 하는 대기열 성능이 아니라 signup 성능을 측정하게 됩니다.
초기화 단계와 측정 단계를 명확히 분리하는 것이 공정한 비교의 출발점입니다.

### 공정 비교의 조건은 코드와 절차로 보장합니다

Redis FLUSHDB, HPA/KEDA 비활성, Redis DB 분리, `RUNNER_ID` 라벨은 모두 "측정이 오염되지 않았다"는 것을 사후에 주장할 수 있게 해주는 장치입니다.
이 조건 중 하나라도 빠지면 결과를 두고 팀 내에서 "환경이 달랐던 것 아니냐"는 의문이 생기고, 의사결정 근거로 쓰기 어려워집니다.

### 클라이언트 메트릭 없이는 사용자 경험을 측정하지 못합니다

서버 Prometheus의 `http_request_duration`은 서버가 응답을 만드는 데 걸린 시간입니다.
클라이언트가 TLS handshake·TCP 연결·Cloudflare edge를 거친 후 실제로 기다린 시간은 k6 클라이언트 메트릭(`http_req_duration`, TTFB)으로만 측정됩니다.
두 지표를 같은 시간축에 놓고 보면 병목 위치(서버 vs edge)가 명확해집니다.
