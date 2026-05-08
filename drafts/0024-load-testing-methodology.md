# ADR 0024 — 부하테스트 방법론 (K6 + queue-oneshot + Mimir Push)

- 상태: Accepted
- 결정일: 2026-03-27 (초기 설계) · 2026-04-03 (방법론 정착) · 2026-04-18 (multicloud 확장)
- 결정 주체: 리더
- 관련 ADR:
  - `0022-queue-implementation-cdn-caching.md` (본 방법론으로 A/B/C 비교 수행)
  - `0013-pgbouncer-connection-pooling.md` (합산 효과 측정에 활용)
  - `0023-java-to-go-migration.md` (Java 병목 실측 근거)
  - `0016-multicloud-circuit-breaker-and-hpa.md` (multicloud-readonly 시나리오)
- 영향 레포: Goti-load-test, Goti-monitoring (Mimir), Goti-k8s (synthetic-traffic CronJob)

---

## 컨텍스트

### 문제 정의

티켓팅 서비스는 평상시 트래픽이 조용하다가 **티켓 오픈 그 순간에 동시 접속자 수만~수십만이 같은 초에 몰리는** 극단적 non-stationary 부하 프로파일을 갖는다. 이 환경에서 의미 있는 부하 검증은 다음을 동시에 요구한다:

1. **E2E 세션 유지** — 대기열 진입 → admitted → 좌석 조회 → 좌석 hold → 주문 → 결제 → leave 까지 한 사용자 흐름이 끊기지 않아야 실제 예매 성공률을 관측할 수 있다
2. **구현 간 공정 비교** — 대기열 POC A/B/C 같은 상황에서 같은 클러스터·같은 시점·같은 데이터로 측정해야 결론이 서는데, 테스트 환경이 조금만 달라져도 숫자가 쏠린다
3. **계층별 병목 분리** — Cloudflare / ALB / Istio / MSA / Redis / PG 중 누가 병목인지 구분할 수 있는 측정 경로 분리가 필요
4. **팀 여러 명의 분산 실행** — 수천 VU를 단일 PC에서 돌리면 OOM. 4명이 동시에 돌려야 할 때 runner별 결과를 섞이지 않게 관측 가능해야 한다
5. **재현성** — POC 비교는 1회성이 아니라 구현 수정 후 재측정이 반복된다. 매 실행을 스크린샷으로만 남기면 비교 불가

### 기존 접근의 한계

- **단일 RPS 측정**: "몇 req/s까지 버티는가"는 티켓팅 피크를 대변하지 못한다. 5분 평균 RPS가 높아도 1초 피크에서 무너지면 실패다.
- **로컬 summary만 남기기**: `k6 --summary-export`는 1회 실행치만 JSON 덩어리로 저장. runner 간 비교·시계열 추적·annotation 불가
- **서버 쪽 메트릭만 신뢰**: 클라이언트가 관측한 실제 사용자 경험(TTFB, TLS, blocking)은 서버 Prometheus로는 드러나지 않는다
- **POC 3종을 하루에 6번 돌리기**: 수동 설정·결과 파일 혼재로 이틀 만에 "어떤 json이 어떤 조건이었지?" 상황 발생

---

## 고려한 대안

본 ADR은 **복합 결정**이므로 축을 4개로 나눠 각각 대안을 비교했다.

### 축 A — 부하 도구

| 후보 | 장점 | 기각 사유 |
|------|------|----------|
| **Gatling (Scala DSL)** | JVM 성숙도, 보고서 HTML 예쁨 | Scala DSL 러닝 커브, JVM warmup이 runner 자체에도 영향, CI 통합·스크립트 재사용성 낮음 |
| **Locust (Python)** | Python 친화, 분산 실행 기능 내장 | GIL로 CPU-bound 워크로드에서 throughput 낮음, VU당 메모리 큼, Prometheus export가 외부 플러그인 의존 |
| **JMeter** | GUI, 엔터프라이즈 성숙도 | XML 기반 시나리오 버전 관리·리뷰 불편, 현대적 CI·Git 플로우에 맞지 않음 |
| **k6 (JavaScript)** | **채택** — JS 시나리오 작성 빠름, 단일 바이너리, Prometheus Remote Write 내장, Grafana 친화, thresholds 선언적, VU당 ~5MB (경량) |

### 축 B — 메트릭 수집 방식

| 후보 | 기각 사유 |
|------|----------|
| 로컬 `--summary-export` JSON만 | runner 간 통합 불가, 시계열 없음, 비교 난이도 ↑ |
| InfluxDB v1/v2 output | 별도 스택 운영 필요, Grafana 탐색 경험이 Prom/Mimir 대비 약함 |
| **Prometheus Remote Write → Grafana Mimir** | **채택** — 기존 관측성 스택(ADR-0004)과 단일화, runner·endpoint·test 라벨로 쿼리 가능, 시계열 보존 |

### 축 C — 시나리오 모델

| 후보 | 적합성 |
|------|--------|
| `constant-vus` / `ramping-vus` | 정적·선형 부하엔 유용하나 "1명이 1번 티켓팅하는 E2E"를 VU 라이프사이클에 매핑하기 어렵다 |
| VU당 무한 반복 (default) | 같은 사용자가 계속 예매를 반복 — 실제 사용자 행동과 통계 해석 괴리 |
| **`per-vu-iterations: 1` 원샷 모델** | **채택** — 1 VU = 1 사용자 = 1회 E2E. 3000VU 실행 = 3000명이 1회씩 예매 시도. 결과 해석이 도메인과 1:1 매칭 |

부가로 multicloud read-only 관측용은 `constant-vus`가 적합 — 상태 변경 없이 양쪽 클러스터 p95 비교.

### 축 D — 측정 경로

| 후보 | 기각 사유 |
|------|----------|
| Cloudflare 경유 단일 측정 | Cloudflare Free plan rate limit(일 100K req)이 3000VU 부하에 걸려 **서버 capacity와 WAF 차단이 섞임** |
| ALB 직접 단일 측정 | 실제 사용자 경로가 아님. 실서비스의 Cloudflare 캐싱·TLS·WAF 효과가 관측 안 됨 |
| **ALB 직접 + Cloudflare 경유 이원 측정** | **채택** — capacity baseline은 ALB, 실사용자 경험은 Cloudflare. 두 수치의 차이 자체가 edge 효과 정량화 |

---

## 결정

**K6 + Prometheus Remote Write(Mimir) + `per-vu-iterations=1` 원샷 모델 + ALB/CF 이원 측정 + RUNNER_ID 분산 실행** 을 티켓팅 부하테스트의 표준 방법론으로 채택한다.

### 구조

```
┌─ Runner (로컬 PC / EC2) ─────────────┐
│  k6 v0.56+                           │
│  scenarios/queue-oneshot.js          │
│  per-vu-iterations: 1, thresholds    │
│  RUNNER_ID=[0..N], START_TIME 동기화 │
└──────────────┬───────────────────────┘
               │  (E2E HTTP)
               ▼
       ┌─────────────────┐
       │  측정 경로 선택  │
       │  ENV=prod-alb   │ ── ALB 직접 (Host: api.* header)
       │  또는           │
       │  CF 경유        │ ── Cloudflare → ALB → Istio → MSA
       └─────────────────┘
               │
               │  k6 prometheus-remote-write output
               ▼
      ┌──────────────────┐       ┌──────────────────┐
      │ Grafana Mimir    │ ─────►│ Grafana Dashboard│
      │ (runner 라벨로    │       │  runner 별·테스트│
      │  multi-runner    │       │  별 p50/p95/p99  │
      │  통합)           │       │  성공률 비교     │
      └──────────────────┘       └──────────────────┘
```

### 핵심 기술 선택

| 축 | 선택 | 사유 |
|---|------|------|
| 도구 | **k6 v0.56+** | JS 시나리오, 단일 바이너리, thresholds 선언적, Prom Remote Write 내장 |
| 시나리오 모델 | **`per-vu-iterations: 1`** (queue-oneshot) | 1 VU = 1 사용자 1회 티켓팅. 3000VU = 3000명 피크 재현 |
| 관측용 모델 | `constant-vus` (multicloud-readonly) | 장시간 read-only polling, 클러스터 간 p95 비교 |
| 메트릭 수집 | **Prometheus Remote Write → Mimir** | 기존 관측 스택과 통합, 라벨 기반 쿼리 |
| 토큰 발급 | **`setup()`에서 VU 수만큼 일괄 signup** | signup 병목과 실제 피크 성능 **분리 (핵심)** |
| 경로 분리 | **`ENV=prod-alb` vs `BASE_URL=https://<cf-domain>`** | WAF/edge 효과 정량화 |
| Runner 분산 | **`RUNNER_ID=0..N`** + `START_TIME=HH:MM:SS` | 계정 풀 분리, 초 단위 동시 시작 |
| 초기화 | `ENV=...` + Redis `FLUSHDB` + `game-seats init` + HPA/KEDA off | 공정 비교 4대 필수 |
| 임계치 | **`thresholds` JSON 선언 필수** | `queue_pass_rate`, `goti_ticket_success_rate`, `http_req_failed`, `http_req_duration{endpoint:*}` |

### 표준 커스텀 메트릭

서버 Prometheus가 아닌 **클라이언트 관점**의 도메인 메트릭을 k6 `Trend`/`Rate`로 정의하고 Mimir로 Push:

| 메트릭 | 의미 |
|--------|------|
| `queue_enter_ms` | `/queue/enter` 응답 시간 |
| `queue_status_ms` | `/queue/status` polling 응답 (ADR-0022 핵심 지표) |
| `queue_wait_duration_ms` | admit 될 때까지 실제 대기 시간 |
| `queue_seat_enter_ms` | admitted 후 좌석 진입까지 |
| `queue_pass_rate` | `admitted / (admitted + timeout)` |
| `goti_ticket_success_rate` | E2E 전체 성공률 (결제까지) |
| `goti_order_creation_ms` / `goti_payment_ms` / `goti_seat_selection_ms` | 각 단계 p50/p95/p99 |

### 결정 규칙 (불변)

1. **토큰은 `setup()`에서 일괄 발급** — VU 루프 안에서 signup 호출 금지. signup 자체 부하는 별도 시나리오로만 측정
2. **Redis FLUSHDB가 측정 전 필수** — 이전 실행의 큐 잔재(activeCount 누적, waiting key)가 다음 실행을 오염시킴
3. **HPA/KEDA는 capacity 측정 시 비활성** — replica가 부하 중 흔들리면 "어떤 replica 수가 얼마를 처리했는지" 불분명
4. **모든 실행은 Mimir에 Push** — 로컬 summary만 남기기 금지. `RUNNER_ID` + `RUNNER_NAME` + `test` 라벨 필수
5. **3개 구현체 비교는 Redis DB 분리** — A=DB0, B=DB1, C=DB2. 네임스페이스 충돌 방지
6. **threshold 위반 시 명시적 판정 기록** — `✗` 항목을 결과 문서 요약 표 상단에 두어 "합격인 척 넘어가기" 방지
7. **Cloudflare 경유 대량 부하 전 WAF 룰 조율** — 단일 IP 요청 폭주는 1015 rate limit 유발. capacity baseline은 반드시 ALB 직접

### 의식적으로 "하지 않은 것"

- **분산 실행 플랫폼 도입 보류** (k6 Operator, k6 Cloud) — 4명 수동 분산으로 충분. Operator 운영 오버헤드가 1주 시연 범위 초과
- **Gatling/JMeter 이중 도입 안 함** — 도구 한 개로 수렴. 공정 비교 맥락에서 도구 간 숫자 혼재 방지

---

## 결과

### 이 방법론으로 확보한 것

1. **ADR-0022 (CDN 대기열 채택)** — POC A/B/C 동일 환경 비교로 `queue_status p95`를 1.98s → 334ms(6배)로 개선한 근거 제시. 방법론 없이는 "팀원 A 구현이 좋더라" 수준을 넘지 못했을 것
2. **ADR-0023 (Java → Go) 전환 근거 데이터** — Java 3000VU 실측으로 `seat-grades p95 6.84s / 5xx 10.88%` 같은 정량 병목 포착 (`docs/migration/java-to-go/stadium-go-performance-sdd.md §2`)
3. **ADR-0013 합산 효과 Before/After 표** — PgBouncer + Go + Redis 캐시 + ANALYZE 의 합산 효과를 endpoint 단위로 정량 기록
4. **Multi-cloud readonly 경로 검증 (2026-04-18)** — `multicloud-readonly` 시나리오로 AWS/GCP 양쪽 p95를 동일 대시보드에서 비교 (ADR-0016 연관)
5. **Capacity planning 초기 틀** — pod당 안정 RPS, KEDA threshold 산정 근거 측정 (`docs/load-test/2026-04-12-capacity-planning-keda.md`)

### 관측 가능한 효과

- **재현성**: 2주 전 측정치가 Mimir에 그대로 남아 있어 구현 수정 후 비교 가능
- **runner 공정성**: 팀원 4명이 동시 실행해도 `runner` 라벨로 분리 집계, 합산도 선택적 가능
- **병목 위치 분리**: Java prod 부하에서 "서버 p95 + k6 클라이언트 TTFB" 동시 관측으로 Cloudflare vs ALB vs MSA 병목 구분

### 리스크

- **Cloudflare Free plan rate limit (일 100K req)** — 단일 IP 대량 요청 시 HTTP 429 / error 1015. Cloudflare 경유 3000VU 측정에서 `queue_pass_rate 40.89%` 하락의 원인이었음 (ADR-0022). 대응: capacity는 ALB 직접, CF는 소규모·회복 후 재측정
- **VU당 메모리 ~5MB 제약** — c7g.xlarge(8GB) 한도 ~1,500 VU / r7g.xlarge(32GB) ~6,000 VU. 50만 VU는 물리적 runner 40~100대 필요 → 현 방법론은 **수천 VU 범위**까지 유효. 더 큰 규모는 k6 Operator 또는 k6 Cloud 별도 ADR
- **k6 JS 시나리오 디버깅 도구 부족** — Java Agent 같은 profiler 없음. 시나리오 버그는 로그 + summary 해석으로만 추적. 헬퍼 코드 리뷰 중요도 상승
- **`per-vu-iterations: 1` 의 꼬리 요청 왜곡** — 테스트 말미에 남은 VU가 적어 throughput 계산이 꺾인다. 시나리오 duration + ramp 조율로 완화 (각 결과 문서에 ramp 프로파일 명시)
- **Cloudflare 경유 시 signup이 먼저 rate limit** — setup() 일괄 signup의 대가. 대규모 측정은 signup 경로 분리 필요 (ADR-0022 후속 과제)
- **공정 비교의 계절성** — RDS CPU / EKS 스팟 가용성 / Cloudflare 라우팅 PoP 가 시점에 따라 달라져 **같은 숫자가 재현 안 될 수 있음**. 최소한 같은 "날·같은 시간대" 내 비교로 제한

### Reversibility

- **도구 교체**: k6 시나리오는 JavaScript이고 `helpers/` 는 헬퍼 함수 모음이라 Locust/Gatling로 포팅 가능. 단, 합산 비교는 끊긴다
- **메트릭 수집**: `PUSH_METRICS=false` 한 줄로 Mimir Push 비활성. 로컬 summary로 전환 즉시 가능
- **비가역 요소 없음** — 방법론 자체가 측정 계층이지 운영 계층이 아님

### 비용

- EC2 c7g.xlarge 1~4대 × 측정 시간 (수분~수십 분) → 회당 $1 이하
- Mimir 저장 비용: k6 메트릭은 cardinality 관리 필요 (`endpoint`, `runner` 외 라벨 제한). 장기적으로 drop rule 대상

---

## 후속

1. **Mimir 메트릭 카디널리티 관리** — k6_* 메트릭 drop rule / active_series 제한 (ADR-0013 후속 과제와 공통)
2. **signup / polling 경로 분리 시나리오** — Cloudflare rate limit 우회, 순수 polling 성능 재측정 (ADR-0022 후속)
3. **50만 VU 시나리오 설계** — 현 방법론으로는 runner 물리 한계. k6 Operator on K8s 도입 가능성 별도 ADR 검토
4. **Gatling 병행 검토 (필요 시)** — JVM warmup 문제 재관측되면 Gatling outbound connection 측정으로 교차 검증
5. **부하테스트 자동화 파이프라인** — PR merge → ArgoCD sync → `synthetic-traffic` CronJob 상시 smoke. 현 수동 실행 패턴을 CI-기반으로 전환

---

## 실행 기록

| 일자 | 이벤트 |
|------|--------|
| 2026-03-27 | K6 2-Phase 설계 (`docs/dev-logs/2026-03-27-queue-loadtest-k6-two-phase-design.md`). 파일 구조 Option A/B/C 중 **Option C** (E2E 사람별 + 비교 시나리오 QUEUE_IMPL 패턴) 채택 |
| 2026-03-29 | `member-a` 단독 saturation 측정 (`docs/load-test/2026-03-29-queue-member-a-saturation.md`) |
| 2026-04-03 | **POC A/B/C 1000VU / 3000VU 비교 완료** — 본 방법론이 실전 공정 비교에 정착 (`docs/load-test/2026-04-03-queue-poc-1000vu.md`). ALB 직접·Redis DB 분리·setup() 일괄 signup·thresholds 선언 확립 |
| 2026-04-04 | CDN 경유 3000VU 실측 (ADR-0022 근거). Cloudflare rate limit 이슈 최초 관측 |
| 2026-04-11 | `ENV=prod-alb` 프리셋 확립 (environments.js). ALB URL·Host header·STADIUM_ID·HOME_TEAM_ID 자동 설정. Runner EC2(c7g.xlarge) 1500VU 안정 운영 확인 |
| 2026-04-12 | **Capacity planning 시나리오 매트릭스 S1~S5 설계** — pod 단위 RPS·VU 한계, 선형성 검증, 큐 소비 속도·인증 오버헤드 분리 (`docs/load-test/2026-04-12-capacity-planning-keda.md`) |
| 2026-04-14 | 3000VU queue-oneshot으로 PgBouncer + Go + 캐시 합산 효과 측정. `queue_status p95 73ms` 관측 |
| 2026-04-18 | **multicloud-readonly 시나리오 신규** — CF Worker 경로로 AWS/GCP 양쪽 분배 read-only 관측 (`docs/load-test/2026-04-18-multicloud-readonly-smoke.md`, ADR-0016 연관) |

### 현 시점 운영 시나리오 (2026-04-20 기준)

`Goti-load-test/scenarios/` 에 다수 시나리오가 존재하나 운영 유지는 아래 2개:

- **`queue-oneshot`** — 1 VU 1 iteration, 티켓 오픈 피크 재현 (per-vu-iterations=1)
- **`multicloud-readonly`** — constant-vus, read-only 엔드포인트 4종, 양 클러스터 p95 비교

나머지(`smoke`, `e2e`, `spike`, `soak`, `normal`, `queue-member-a*`, `flow-debug`, `synthetic-traffic`)는 초기 실험용으로 보존만 하고 run.sh 분기에서 제거됨. 자세한 배경은 Goti-load-test README 참조.
