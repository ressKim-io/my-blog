# Capacity Planning for KEDA (AWS prod)

- **날짜**: 2026-04-12
- **환경**: EKS prod (core 5 + spot 7 구성, 2026-04-11 명재님 확인 베스트)
- **목적**: KEDA + Karpenter 적용 전 pod 단위 처리 한계 측정 → threshold 산정 근거 확보
- **선행**: [2026-04-03 Queue POC 1000VU](2026-04-03-queue-poc-1000vu.md) (CDN 캐싱 채택), 2026-04-11 3000VU/pod2 재현 테스트

---

## 배경

명재님 2026-04-11 부하테스트:
- 3000 VU / 1000명씩 처리 / ticketing pod 2 → **터짐** (첨부 k9s 스샷 확인)
- 대기열 소비 정체 발생 → **원인 분리 필요** (pod 포화 vs 인증 병목)
- 모니터링 pending → core 5, spot 7 확장 후 안정
- "pod 2 → 늘리기 / VU 1000 → 500 축소" 중 미결정

**결정 대기 질문**: "몇 명 입장 → ticketing pod 몇 대" 산식. capacity planning 없이는 KEDA threshold를 찍기로 정할 수밖에 없음.

---

## 목표

1. pod 1개당 안정 처리 가능한 **VU / RPS baseline** 도출
2. KEDA `targetAverageValue` (CPU%, RPS, queue length) 산정
3. pod 증가 시 **선형성** 검증 (2배 pod = 2배 처리량?)
4. **스케일아웃 소요 시간** 측정 (pod 추가 → Ready까지)
5. 큐 소비 정체 원인 분리 (consumer 포화 vs 인증 병목)

---

## 전제 조건

| 항목 | 값 |
|------|---|
| 부하 도구 | k6, ALB 직접 접근 (Cloudflare 우회), setup() 일괄 토큰 발급 |
| 대기열 수용인원 | QUEUE_MAX_CAPACITY=100 |
| 측정 대시보드 | load-test-command-center / infra-autoscaling / infra-pod-health / api-red-metrics |
| 대시보드 전제 | Istio sidecar/POD/init 제외 필터 적용, CPU Utilization % of Limit 패널 추가된 수정본 사용 |
| 경기 (slot) | (수행 시 기록) |

### 사전 체크리스트
- [ ] 대시보드 수정 PR 머지 + ArgoCD sync 완료
- [ ] k6 테스트 스크립트의 VU ramp 프로파일 확인
- [ ] replicas 고정 방법 확정 (HPA off or KEDA paused — ScaledObject `paused: "true"`)
- [ ] 테스트 전 Grafana time range 고정 (스샷 일관성)

---

## 클러스터 상태 기록 (테스트 시작 전)

| 항목 | 값 |
|------|---|
| core 노드 수 | 5 |
| spot 노드 수 | 7 |
| Karpenter | (활성/비활성 — 기록) |
| ticketing replicas | (기록) |
| queue-* replicas | (기록) |
| user replicas | (기록) |
| payment replicas | (기록) |
| resale replicas | (기록) |

---

## 시나리오 매트릭스

| # | 대상 서비스 | replicas 고정 | VU ramp | 지속 | 목적 | 스샷 대시보드 |
|---|------------|---------------|---------|------|------|-------------|
| **S1** | ticketing | 1 | 100→500 (50씩, 30s per step) | 5분 | 단일 pod 한계 RPS + 깨지는 VU | api-red, pod-health |
| **S2** | ticketing | 2 | 500→1500 | 5분 | 선형성 검증 (S1 × 2 ≈ S2?) | autoscaling, pod-health |
| **S3** | ticketing | 4 | 1500→3000 | 5분 | 2026-04-11 결과 재현 | load-test-cc |
| **S4** | queue consumer | 1 | enter 1000명 고정 | 3분 | 순수 소비 속도 (인증 제외) | load-test-cc (queue row) |
| **S5** | queue + user E2E | 1 | enter 1000명 + 인증 포함 | 3분 | 인증 오버헤드 분리 (S5 − S4) | api-red, queue row |

> S4, S5 실행 방법: k6 시나리오에서 queue-gate 직접 호출 vs user-service 경유 분기

---

## 측정 지표 (시나리오별 반복)

각 시나리오 실행 후 아래 표를 복사해서 채운다.

| 항목 | 측정값 | 출처 패널 | 스샷 파일명 |
|------|--------|----------|-----------|
| 안정 RPS (깨지기 직전) | | api-red "RPS by Endpoint" | sN-rps.png |
| 깨지는 VU 지점 | | load-test-cc "VU 추이" | sN-vu.png |
| p95 latency at 깨지는 시점 | | api-red "p50/p95/p99" | sN-latency.png |
| **CPU % of Limit at 포화** | | pod-health "CPU Utilization %" (신규) | sN-cpu.png |
| Memory % of Limit | | pod-health "Memory: Request vs 실제" | sN-mem.png |
| Throttling 발생 여부 | | pod-health "CPU Throttling" | sN-throttle.png |
| Pod restart/OOM | | pod-health "OOMKilled (24h)" | sN-oom.png |
| Queue 소비 속도 (S4/S5) | | load-test-cc "대기열 상태" | sN-queue.png |
| Pod 1개당 RPS | | load-test-cc "Pod당 RPS" (신규) | sN-rps-per-pod.png |

---

## 결과 요약 (S1~S3 실행 후 채움)

### Capacity Baseline

| pod 수 | 안정 VU | 안정 RPS | RPS/pod | p95 latency | CPU % of Limit | 비고 |
|--------|---------|----------|---------|-------------|----------------|------|
| 1 (S1) | | | | | | |
| 2 (S2) | | | | | | |
| 4 (S3) | | | | | | |

**선형성**: (S2 RPS/S1 RPS) = ? (이상적으로 2.0), (S3 RPS/S1 RPS) = ? (이상적으로 4.0)

### Queue 소비 병목 분리 (S4 vs S5)

| 항목 | S4 (queue only) | S5 (queue+auth) | 차이 = 인증 오버헤드 |
|------|-----------------|------------------|---------------------|
| enter/sec | | | |
| admitted/sec | | | |
| 소비 지연 (enter − admitted) | | | |
| queue-gate CPU % | | | |
| user-service CPU % | | | |

---

## KEDA 정책 도출

측정 결과 기반으로 아래 표 채움:

| 메트릭 | 임계값 | 근거 |
|--------|--------|------|
| CPU avg | ?% | S1 p95 깨지기 직전 CPU % of Limit |
| RPS per pod | ? | S1 안정 RPS |
| Queue length | ? | S4 소비 속도 × 허용 대기 시간 |
| pollingInterval | 15s | 기본값 유지 (변경 시 근거) |
| cooldownPeriod | ?s | scaleOut 측정값 × 1.5 |

### Karpenter 연동 확인
- ticketing 스케일아웃 → 노드 부족 → Karpenter 노드 프로비저닝 시간 측정
- spot 노드 우선 배치 여부 확인

---

## 다음 단계

1. **KEDA ScaledObject 작성** — 위 threshold 적용
2. **S6 검증 시나리오**: VU 0→3000 ramp (5분), KEDA autoscale 동작 및 latency spike 측정
3. KEDA paused 해제 → 실제 운영 시나리오 부하테스트
4. 결과 기반 ADR 작성 (KEDA threshold 근거)

---

## 제외 사항

- Kind dev 사전 테스트 생략 (시간 제약, AWS prod 직행)
- 다른 서비스 (user/payment/resale) capacity 측정 (별도 작업)
- Karpenter NodePool 튜닝 (별도 작업)

---

## 관련 문서

- [2026-04-03 Queue POC 1000VU](2026-04-03-queue-poc-1000vu.md)
- [2026-03-29 Queue suyeon saturation](2026-03-29-queue-suyeon-saturation.md)
- [synthetic-traffic](synthetic-traffic.md)
- (예정) `docs/adr/0011-keda-threshold-decision.md`

---

## 🔥 2026-04-12 실제 측정 결과 요약

### 환경
- EKS prod, Cloudflare → ALB → Istio → 서비스
- 노드: core 5 + spot 7 (r7g.xlarge ×1 EC2 k6 runner)
- Queue `maxCapacity: 1000 → 3000` 단계 확대
- Ticketing KEDA off (replicaCount=2 고정)

### R1: 1500 VU / pod=2 / maxCapacity=1000 (Cloudflare 경유)
| 메트릭 | 값 |
|--------|-----|
| ticket_success | 81.9% (4483/5473) |
| http_fail | 0.56% |
| payment p95 | **40.3s** 🔴 |
| seat_selection p95 | 7.31s |
| order_creation p95 | 8.58s |
| queue_wait p95 | 100s |
| e2e duration p95 | **149s (2m30s)** 🔴 |

### R2: 3000 VU / pod=2 / maxCapacity=3000 (Cloudflare 경유 + UA 위장)

#### API Health Matrix (Grafana 측정)
| Endpoint | RPS | p95 | 5xx % | 판정 |
|---|---|---|---|---|
| `/stadium-seats/games/{gameId}/seat-grades` | 10.25 | **6.84s** | **10.88%** | 🔴 최악 |
| `/stadium-seats/stadiums/{stadiumId}/seat-sections` | 6.35 | 5.48s | 5.81% | 🔴 |
| `/teams/{teamId}/ticket-pricing-policies` | 5.38 | 4.41s | 2.24% | 🟠 |
| `/orders/{orderId}/payment-confirmations` | 0.02 | 4.83s | 0% | 🟠 latency만 |
| `/orders/{orderId}/payment-order` | 0.02 | 4.75s | 0% | 🟠 latency만 |
| `/game-seats/{gameId}/sections/.../seat-statuses` | 1.02 | 4.78s | 3.14% | 🟠 |
| `/seat-reservations/seats/{seatId}` (hold) | 0.98 | 2.47s | 1.63% | 🟠 |
| `/orders` (create) | 0.17 | 987ms | 0% | 🟢 |

#### 에러 상태코드 분포
| 상태코드 | 건수 | 주 원인 |
|---|---|---|
| 400 | 2.48K | `"예매 가능 시간이 만료되었습니다"` — stadium 느림 → reservation session TTL 초과 (2차 피해) |
| 500 | 567 | stadium-seats / ticket-pricing-policies 서버 오류 |
| 403 | 665 | Cloudflare DDoS 차단 (초기 k6 UA — 이후 Mozilla로 위장하여 해소) |
| 409 | 20 | 좌석 경합 (정상 수준) |

### 🎯 병목 판정

**1) Stadium 서비스 조회 API가 진짜 범인**
- `seat-grades`, `seat-sections`, `ticket-pricing-policies` 전부 stadium 서비스 소속
- RPS 10 수준에서 5xx 10.88%, p95 7초 — CPU 낮은데 터짐
- **원인: Hibernate N+1 + 동기 JOIN heavy 쿼리 강력 추정** (실측 프로파일링은 별도 필요)
- 조회 API이기 때문에 stadium 단일 pod(replicaCount=1) + 인덱스 부재 가능성

**2) Queue scheduler 버그 (별건)**
- `publishedRank=0` 고착 현상 — active 3000명 고착, 뒤 4533명 무한 대기
- `released=false` 빈발 — EXPIRED user leave 시 active-users SET 미제거
- queue 서비스 scheduler 로직 개선 필요

**3) Payment는 기능적으로 OK**
- 5xx 0%, 단지 p95 5초 (외부 PG 동기 호출 추정)
- Go 전환 효과 낮음, 원복 순위 낮음

**4) 좌석 경합은 설계 OK**
- 409 20건만 발생 — 좌석 락/트랜잭션 설계는 큰 문제 없음

### 🔚 결론: Java 서버 코드 최적화 한계 → Go 전환 합리화

| 우선순위 | 대상 | 기대 효과 |
|---------|------|----------|
| P0 | **stadium 조회 API Go 전환** | p95 6.8s → 수백 ms 기대 (sqlc + 쿼리 최적화) |
| P1 | **ticketing Go 전환** | 기존 진행 중 (Phase 7 audit) |
| P2 | Queue scheduler publishedRank 버그 수정 | 단기 Java 수정 가능 |
| P3 | Payment | 외부 PG 의존 — 유지 |

### 📉 KEDA threshold 산정 유보

- Ticketing pod CPU 60% 수준에서 **주변 서비스(stadium/session) 먼저 터지는 cascade** 확인
- ticketing 단일 서비스 capacity 측정은 **stadium 개선 후 재측정 필요**
- 따라서 이번 라운드에서 **KEDA ScaledObject 확정 threshold 도출 불가**. Go 전환 후 재측정.

### 📌 후속 과제
- [ ] stadium Go 전환 (Phase 7 이후 우선순위로)
- [ ] Queue scheduler `publishedRank` 업데이트 로직 검증 (`released=false` 케이스)
- [ ] r7g.xlarge 단일 EC2 5000 VU 테스트 (OOM 발생, 3000이 안정 한계)
- [ ] Cloudflare DDoS L7 Ruleset 우회 영구 적용 (UA + WAF skip rule)
- [ ] Queue `maxCapacity=3000` 실운영 반영 여부 결정 (현재 테스트용 확대 상태)

#### Queue 서비스 측정 (비교용 — 문제 없음)
| Endpoint | RPS | p95 | p99 | 판정 |
|---|---|---|---|---|
| `/queue/enter` | 7.50 | 700ms | 2.48s | 🟡 acceptable |
| `/queue/{gameId}/seat-enter` | 6.13 | 720ms | 1.96s | 🟡 acceptable |
| **`/queue/{gameId}/global-status`** | **0.13** | **45ms** | 484ms | 🟢 CDN 캐싱 효과 (polling 99%+ edge 흡수) |
| `/queue/{gameId}/leave` | 0.01 | 9ms | 21ms | 🟢 |
| `/actuator/health` | 0.60 | 17ms | 230ms | 🟢 |

**관찰**:
- Queue 엔드포인트 p95 700~720ms는 Stadium 6.8s 대비 **10배 빠름**
- 5xx 기록 없음 → Queue 서비스 코드는 부하에 견딤
- global-status RPS 0.13 = **Cloudflare CDN 캐싱 설계 성공** (suyeon 의도대로 polling 대부분 edge에서 처리)
- 다만 p99 2.5s는 분산 락 경합 의심 — Go 이전 시 개선 여지

---

### 💡 부수적 학습
- **k6 기본 User-Agent `k6/0.56.0`가 Cloudflare DDoS L7 ruleset에 "known bad user agent"로 차단됨** — Mozilla UA로 위장 필수
- EC2 EIP는 Cloudflare Rate Limit whitelist 외 **WAF Managed Rules/Bot Fight Mode 별도 bypass 필요**
- r7g.xlarge 32GB → 3000 VU가 안정 한계 (5000 VU 시 OOM, EC2 reboot 필요)
- OTel Java agent 미주입 pod이 많았음 (ticketing, payment, stadium 등) → 전체 rollout restart 후에야 메트릭 수집 정상

---

## 🧭 Java 코드 문제 패턴 → Go 마이그레이션 체크리스트

Java에서 발견된 문제들을 **Go 구현에서 반복하지 않도록 검증**. Phase 7 audit 단계 또는 Go 코드 리뷰 시 반드시 확인.

### P0 — Stadium 서비스 조회 API (최우선)

| Java 문제 | Go에서 검증할 것 |
|-----------|----------------|
| Hibernate lazy loading → N+1 쿼리 | sqlc/pgx 사용 시 **1쿼리 JOIN** 또는 `ANY($1::uuid[])` IN clause batching. Repo layer에 N+1 테스트 필수 |
| Eager fetching으로 인한 과도한 JOIN | 필요한 컬럼만 SELECT. `SELECT *` 금지 |
| Hibernate second-level cache 의존 | 애초에 Hibernate 없으므로 N/A. 하지만 Redis 캐시 layer 설계 필요 |
| 인덱스 부재 (JOIN on FK 느림) | Goose migration 리뷰 — `game_id`, `stadium_id`, `section_id` FK 인덱스 확인 |
| `seat-grades`, `seat-sections`, `pricing-policies` API p95 4~7초 | Go 구현 후 같은 부하에서 **p95 < 500ms** 목표 |

### P1 — 서비스 간 호출 설계

| Java 문제 | Go에서 검증할 것 |
|-----------|----------------|
| 동기 REST 체인 (Stadium → Ticketing → Payment) 누적 latency | gRPC + deadline propagation. 내부 호출은 gRPC 권장 |
| Istio sidecar mTLS overhead 누적 (~10ms/hop) | Istio gRPC 네이티브 경로 활용, 서비스 체인 짧게 |
| 외부 PG 동기 호출 (payment p95 5초) | 외부 호출은 **goroutine + context.WithTimeout**, retry with backoff |

### P2 — 분산 락 / 동시성

| Java 문제 | Go에서 검증할 것 |
|-----------|----------------|
| Redis 분산 락 경합 (queue enter p99 2.5s 추정) | **Redis Lua script로 atomic** CAS. Redlock 라이브러리 대신 단일 노드 SET NX PX 활용 |
| `QueueLeaveService` `released=false` 케이스 | Leave 시 **상태 기반 idempotent 처리**. EXPIRED user도 active-users SET에서 제거되도록 |
| Scheduler publishedRank 업데이트 지연 | Event-driven으로 전환 고려. 또는 scheduler 주기 단축 (30s → 5s) |

### P3 — 세션 / TTL 관리

| Java 문제 | Go에서 검증할 것 |
|-----------|----------------|
| Reservation session TTL 만료로 "예매 가능 시간 만료" 2.48K건 | Long-running 작업 중에도 **heartbeat로 TTL 갱신**. 또는 TTL 충분히 길게 (15분 → 30분) |
| Queue Entry TTL vs Admitted TTL 불일치 | 단일 상태 머신으로 명확화. enum + Redis hash status 필드로 관리 |

### P4 — 데이터베이스 커넥션 / 리소스

| Java 문제 | Go에서 검증할 것 |
|-----------|----------------|
| HikariCP pool 포화로 500 error | pgx pool size = `min(DB_MAX_CONNECTIONS, 2 × CPU_LIMIT_CORES + diskCount)`. 환경변수화 |
| RDS `max_connections` 한계 | K8s replicas × pool size < RDS max. PgBouncer transaction pooling 고려 |
| 리소스 limit 1 core로 스로틀링 | Go는 GOMAXPROCS 설정 필수 (K8s CPU limit 감지 라이브러리 `automaxprocs`) |

### P5 — 관측성 / 운영

| Java 문제 | Go에서 검증할 것 |
|-----------|----------------|
| OTel Java agent webhook inject 누락 (pod 재시작 전까지 메트릭 없음) | Go는 SDK 직접 embed → inject 의존 없음. OTel init 코드를 `cmd/main.go` 최상단에 배치 |
| Spring startup 77초로 liveness probe SIGTERM | Go 컨테이너는 보통 <2초 기동. 그래도 `startupProbe` 추가하여 안전망 |
| `instrumentation.opentelemetry.io/inject-java` 어노테이션 누락으로 메트릭 없음 | Go 배포는 Instrumentation CR 불필요. Deployment에서 `OTEL_EXPORTER_OTLP_ENDPOINT` 명시 주입 |

### P6 — 테스트 환경 세팅

| Java 문제 | Go에서 검증할 것 |
|-----------|----------------|
| 좌석 상태 리셋 API 부재 (init은 idempotent, HELD/SOLD 초기화 안 함) | `POST /admin/game-seats/{id}/reset` 추가 고려 (test env only flag) |
| k6 UA 기본값이 Cloudflare DDoS 차단 대상 | 부하테스트 시 Mozilla UA 위장 표준화. `my-config.env`에 USER_AGENT 변수 추가 |

---

### 검증 방법

Go 구현 후 **동일 조건 재부하테스트**:
```
동일 경기 (기아 04-14), 동일 maxCapacity(3000), 동일 3000 VU
→ p95 목표:
   - stadium 조회 API < 500ms (현재 Java 6.8s 대비 13× 개선)
   - queue enter/seat-enter < 300ms (현재 Java 700ms 대비 2× 개선)
   - e2e 성공 1건 < 10초 (현재 Java 149s 대비 15× 개선)
→ 5xx < 0.1% (현재 Java 10.88% 대비 100× 개선)
```

**개선 실패 시 Go 구현 문제. 이 체크리스트로 원인 역추적.**
