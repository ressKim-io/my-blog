# ADR 0023 — Java/Spring Boot → Go 전환 (전 서비스)

- 상태: Accepted (Implementation Complete)
- 결정일: 2026-04-09 (정식 채택)
- 결정 주체: 리더
- 관련 문서:
  - `docs/migration/0004-java-to-go-migration.md` (마이그레이션 기록, **본 ADR이 승격**)
  - `docs/migration/java-to-go/overview.md` (Phase 진행 현황)
  - `docs/migration/java-to-go/stadium-go-performance-sdd.md` (Java prod 3000VU 실측 근거)
  - `docs/migration/java-to-go/phase6.5-go-prod-infra-sdd.md`
- 관련 ADR: `0013-pgbouncer-connection-pooling.md` (Go 전환 후 합산 효과 측정), `0017-redis-as-source-of-truth-adoption.md` (Go에서 Lua atomic 구현), `0022-queue-implementation-cdn-caching.md` (Go queue 서비스 기반)
- 영향 레포: Goti-go (신규), Goti-server (유지 후 deprecation), Goti-k8s, Goti-Terraform, Goti-load-test

---

## 컨텍스트

### 문제 정의

Goti-server(Java Spring Boot 3.5.10)는 MSA 6개 서비스로 운영되었으나, 티켓팅 트래픽 프로파일(평시 → 오픈 순간 수만 배 폭증)과 맞지 않는 런타임 특성을 드러냈다.

1. **JVM 콜드스타트 30~60초** — HPA 스케일아웃이 피크 대응에 늦는다. 티켓 오픈은 "그 순간"이 전부라 warmup에 30초를 소모하면 의미가 없다.
2. **pod당 메모리 요청 512Mi~1Gi** (6 서비스 기준 총 ~2.3Gi) — 동일 노드에서 수용 가능한 replica 수가 적어 스케일아웃 여력이 낮다.
3. **JVM GC pause로 p99 꼬리 지연** — 부하 중 수십~수백 ms의 STW pause가 재현된다.
4. **KEDA cron pre-scale이 필수** — 오픈 시각 전에 강제로 replica를 띄워두지 않으면 첫 분 동안 사용자가 타임아웃.
5. **Kind 로컬 환경 리소스 부족** — 512Mi × 6 서비스 × replica 2 = 6Gi 이상이 필요해 dev 환경 구축 자체가 무거움.

### 실관측 (Java prod 3000VU 측정, 2026-04-12)

`docs/migration/java-to-go/stadium-go-performance-sdd.md` §2 에서 발췌:

| Endpoint | p95 | 5xx | 판정 |
|----------|-----|-----|------|
| `/stadium-seats/games/{gameId}/seat-grades` | **6.84s** | 10.88% | 🔴 최악 |
| `/stadium-seats/stadiums/{stadiumId}/seat-sections` | **5.48s** | 5.81% | 🔴 |
| `/teams/{teamId}/ticket-pricing-policies` | **4.41s** | 2.24% | 🟠 |
| `/seat-reservations/seats/{seatId}` (hold) | 2.47s | 1.63% | 🟠 락 경합 |
| `/queue/enter` p99 | 2.48s | — | 🟠 분산 락 경합 |

부하 중 **queue pass_rate 1.04%** — 3000VU 중 99%가 queue 타임아웃, 실 예매 도달 VU는 1% 미만. Java 구현이 목표 트래픽(10만~50만 동시접속)에 구조적으로 부족함이 정량 확인되었다.

### 요구사항

1. **콜드스타트 수 초 이내** — HPA 스케일아웃이 즉시 효과를 내야 한다
2. **동일 API / DB 계약 유지** — 클라이언트 변경 없이 런타임만 교체
3. **Istio canary로 점진 전환** — 0% → 10% → 25% → 50% → 100%, 각 단계에서 롤백 즉시 가능
4. **1주 시연 범위 내 완료** — Phase 0~8 모두 4월 말까지 처리
5. **관측성 동등 이상** — OTel, Prometheus 메트릭, 로깅 형식 Java와 호환

---

## 고려한 대안

| # | 대안 | 기각 사유 |
|---|------|----------|
| A | **Java Spring Boot 유지 + JVM 튜닝** (G1/ZGC, heap 튜닝, HikariCP pool 재설정) | 콜드스타트·메모리 풋프린트의 **구조적 한계 그대로**. ZGC로 p99 pause는 줄여도 pod당 1Gi·warmup 30초 문제는 해결 불가 |
| B | **Spring Boot + Virtual Threads (Java 21 Loom)** | 동시성 문제 일부 해결되나 JVM warmup·메모리 해결 안 됨. 또 우리는 I/O-bound인데 Virtual Thread의 주요 이득은 blocking call에 가려진 CPU cost 문제이며, 티켓팅의 Redis/DB 경로는 이미 non-blocking pgx/lettuce 패턴 적용 가능 |
| C | **GraalVM Native Image (Spring Native)** | 콜드스타트 해결은 가능. 그러나 (1) 빌드 시간 폭증, (2) 리플렉션·프록시·JPA 런타임 특성과 AOT 불호환, (3) 팀 학습·디버깅 도구 부재. Spring 생태계 이점을 상당수 포기해야 함 |
| D | **Kotlin + Ktor / Quarkus Native** | Kotlin은 여전히 JVM이라 warmup 문제 동일. Quarkus Native는 GraalVM 기반 이슈 동일. 팀 Kotlin 경험도 Java 대비 얕음 |
| E | **Rust (actix-web / axum)** | 성능·리소스 측면 Go보다 우수할 수 있으나 (1) 팀 내 Rust 경력 0, (2) DB/Redis/OTel 생태계 미성숙, (3) 1주 시연 범위에서 6 서비스 재작성 불가능. 학습 곡선 위험이 일정 리스크로 직결 |
| F | **Node.js / TypeScript (NestJS)** | 콜드스타트 빠르고 JS 생태계 풍부하나 (1) 단일 스레드 이벤트 루프가 CPU-bound 경로(JWE 검증·Lua 전처리·JSON serde)에서 Go 대비 불리, (2) 타입 안전성과 동시성 모델이 Go 대비 약함, (3) TypeScript 트랜스파일·빌드 체인의 복잡도 |
| G | **Go (Gin + pgx + go-redis)** | **채택** — 콜드스타트 초 단위, 정적 바이너리 distroless 배포, 동시성 모델이 티켓팅 도메인에 적합, pgx 성능·OTel SDK 성숙, 팀 내 최소한의 Go 경험 확보 |

### Go를 선택한 구체 근거

- **콜드스타트**: 스케줄된 Pod이 Ready 상태가 되기까지 **초 단위** → HPA 스파이크 대응이 실제로 의미를 가짐
- **리소스**: 정적 컴파일 + 런타임 없음으로 **같은 요청 처리당 메모리 6배 절감** 관측 (2.3Gi → 384Mi 합계)
- **동시성**: goroutine + channel로 대기열·좌석 hold 같은 경합 제어가 표준 패턴
- **배포**: `FROM gcr.io/distroless/static-debian12:nonroot` → 이미지 < 50MB, 공격 표면 최소
- **팀**: Go 경험자 존재 + 문법 단순성으로 러닝 커브 수용 가능
- **생태계 완성도**: pgx (PostgreSQL Top-tier), go-redis (Cluster 지원), golang-jwt, OTel SDK 모두 성숙

---

## 결정

**Goti-server의 6 MSA 서비스 전부를 Go로 재작성한다.** API 계약·DB 스키마·Redis 키 패턴은 100% 유지하며, Istio weighted routing canary로 점진 전환 후 Java deprecation 한다.

### 구조

```
┌─ Goti-server (Java, 유지 후 deprecate) ───┐
│  Spring Boot 3.5.10, JPA, jjwt, Gradle    │
│  Eclipse Temurin JRE                      │
└──────────────┬────────────────────────────┘
               │ (Istio VirtualService weight)
               │   0% → 10% → 25% → 50% → 100%
               ▼
┌─ Goti-go (Go, 신규 모노레포) ─────────────┐
│  cmd/ (user · stadium · ticketing ·       │
│        payment · resale · queue · outbox) │
│  internal/ (도메인별 4-layer)              │
│  pkg/ (auth · database · redis · lock ·   │
│        middleware · observability · ...)  │
│  Go 1.26 / Gin v1.12 / pgx v5 /           │
│  go-redis v9 / golang-jwt v5 / Viper      │
│  Build: go build → distroless/static      │
└───────────────────────────────────────────┘
```

### 핵심 기술 선택

| 계층 | Java (전) | Go (후) | 사유 |
|------|----------|---------|------|
| HTTP | Spring MVC | **Gin v1.12** | 경량, middleware 생태계 성숙, otelgin 자동계측 지원 |
| DB | JPA/Hibernate | **pgx v5 (raw SQL)** | ORM 제거 → N+1·`SELECT *` 원천 차단, prepared statement 명시 제어 |
| Redis | Spring Data Redis | **go-redis v9 (UniversalClient)** | 단일↔Cluster 분기 유연, Lua `Eval` 표준, Stream 지원 |
| JWT | jjwt 0.13 | **golang-jwt v5 (RS256 + JWKS)** | `user`만 private key 보유, 나머지는 JWKS로 오프라인 검증 |
| 설정 | `application.yml` | **Viper** (YAML + env override) | 12-factor 준수, 동일 바이너리 환경별 재사용 |
| 관측 | OTel Java Agent (auto) | **OTel Go SDK + otelgin + otelhttp** | 자동계측은 아니지만 미들웨어로 동등 효과 |
| 메트릭 | Micrometer | **prometheus/client_golang** | K8s ServiceMonitor 호환 |
| 컨테이너 | Eclipse Temurin JRE | **distroless/static-debian12:nonroot** | 이미지 수십 MB, shell 없음, UID 65532 |
| 빌드 | Gradle | **go build + Makefile** | 빌드 시간 수 초, 재현성 높음 |

### 마이그레이션 순서 (Phase 0 → 8)

| Phase | 서비스 | 복잡도 | 상태 |
|-------|--------|--------|------|
| 0 | Foundation (`pkg/` 공통) | — | ✅ 완료 (2026-04-09) |
| 1 | Stadium | 낮음 | ✅ 완료 (2026-04-09) |
| 2 | User (OAuth 3종 · JWT · SMS) | 중간 | ✅ 완료 (2026-04-09) |
| 3 | Queue | 낮음 | ✅ 완료 (2026-04-09) |
| 4 | Resale | 중간 | ✅ 완료 (2026-04-10) |
| 5 | Payment (Mock PG · 정산 · 에스크로) | 중간 | ✅ 완료 (2026-04-11) |
| 6 | Ticketing (좌석 hold · 주문 · Lua atomic) | 높음 | ✅ 완료 (2026-04-11) |
| 6.5 | Go prod 인프라 (Phase 7 진입 차단 갭 해소) | — | ✅ 완료 |
| 7 | Go Readiness Audit (E2E · 부하 · 관측성 · 보안) | — | 진행 중 → PAUSED (Phase 6.5 기반 위에서 재개) |
| 8 | Cleanup (Java deprecation) | — | 대기 |

### 결정 규칙 (불변)

1. **API 계약 100% 호환** — 엔드포인트, 응답 JSON 필드, HTTP status 코드까지 Java와 일치. 클라이언트(Goti-front)는 변경 금지
2. **DB 스키마 공유** — 동일 PostgreSQL 스키마 그대로 사용. Java와 Go가 병렬 운영 중인 기간 동안 동시 쓰기 가능
3. **Istio canary 전환만 허용** — DNS 전환 / 수동 배포 전환 금지. Weight 기반이어야 즉시 롤백 가능
4. **Go는 prod 직행** — dev Kind는 Java + 모니터링 + 가드레일 전용. Go의 부하·정합성·관측성 검증 전부 prod에서 수행 (2026-04-12 결정)
5. **병렬 배포 기간 Java 무영향** — Java 서비스 config/코드 수정 금지. 문제 발견 시 Go 쪽만 수정
6. **Step 4 = 4b 확정** — 6개 서비스 전부 컷오버. ticketing만 부분 전환(4a)은 거부됨 (2026-04-12 결정)

---

## 결과

### Go 전환 단독 기여 (언어·런타임 선택의 직접 결과)

아래 4개 지표는 **Go 전환이 단독으로 유발한 효과**이므로 다른 최적화(PgBouncer, Redis 캐시, ANALYZE)와 **혼재되지 않는다**:

| 지표 | Java | Go | 개선 |
|------|------|-----|------|
| **pod당 메모리 요청 (min replicas 기준 합산)** | ~2,300 Mi | ~384 Mi | **6배 절감** |
| **콜드스타트 (Pod 생성 → Ready)** | 30~60s | 1~3s | **10~20배 개선** |
| **`initialDelaySeconds`** | 30~60 | 3 | warmup 대기 제거 |
| **KEDA cron pre-scale** | 필수 (오픈 시각 전 강제 기동) | **불필요** | 스케줄 의존성 제거 |
| **HPA `cooldownPeriod`** | 300s (재스케일 억제 길게) | 120s | 반응성 2.5배 향상 |
| **이미지 크기** | ~280MB (Eclipse Temurin JRE 기반) | ~40MB (distroless/static) | 7배 축소, 공격 표면 감소 |
| **배포 시 이미지 pull 시간** | 수십 초 | 수 초 | HPA 스케일아웃 실효성 향상 |

### 합산 효과 (Go + PgBouncer + Redis 캐시 + ANALYZE)

티켓팅 엔드포인트의 p95·RPS·5xx 개선은 Go 전환 단독이 아니라 여러 결정의 합산 효과이며, 상세 측정치와 단일 원인 breakdown 불가 주의사항은 **`ADR-0013-pgbouncer-connection-pooling.md` 실행 기록 섹션에 기록**되어 있다. 본 ADR에서는 중복 수록하지 않는다.

Go 단독 기여도를 분리 측정하려면 "Go + PgBouncer off + Redis 캐시 off + ANALYZE off" 상태의 부하가 필요하며, 이는 후속 과제이다.

### 운영상 이점

- **HPA 실효성 회복**: 콜드스타트 3초 이내라 HPA target 도달 즉시 replica가 실제 트래픽을 받는다. Java에서는 Ready가 되어도 warmup 30초 동안 slow response
- **Kind dev 환경 수용 가능**: 6개 서비스 × 384Mi = ~2.3Gi로 Ubuntu 32GB 호스트에서 여유 운영
- **KEDA 스케줄 의존 제거**: 오픈 시각 예측이 틀려도 실시간 부하에 반응. 운영 복잡도 감소
- **ORM 제거 효과**: JPA의 lazy load·N+1·`SELECT *`로 인한 예상치 못한 쿼리 폭발이 원천 차단 (Phase 1~6 마이그레이션에서 Java 쿼리 재검토 중 실제로 여러 건 발견)

### 리스크

- **팀 내 Go 경험 편차** — 시니어 외 주니어의 러닝 커브 존재. pkg/ 공통 모듈과 4-layer 구조 표준화로 완화
- **ORM 미사용 → raw SQL 관리 부담** — `scripts/audit-sql-timestamps.py` 등 정적 스캐너로 `created_at/updated_at` 누락 같은 패턴을 레포 전체 검사. 향후 sqlc·bob 도입 검토 (메모리 `project_sql_validation_todo.md`)
- **Java/Go 병렬 운영 기간 이중 유지보수** — Phase 8 cleanup 이전까지 2개 코드베이스에서 버그 수정 중복. Phase 8은 최우선 후속
- **OTel Java Agent의 자동계측 범위 일부 손실** — Go SDK는 수동 계측이 기본. otelgin·otelhttp로 주요 경로는 커버되나 내부 라이브러리 호출까지는 도달 못함. Tempo trace 완결성에서 일부 span 누락 허용
- **cutover smoke 초기 트러블**: 2026-04-13 첫 smoke에서 OAuth env · PostgreSQL date 타입 · Viper env override · JSON 필드명 · JWT issuer 5건이 연쇄 발생 (`docs/dev-logs/2026-04-13-cutover-smoke-trail-fixes.md` 및 `2026-04-13-go-cutover-residual-fixes.md`). Java 호환성 계약이 있어도 런타임 level에서 드러나는 미묘한 불일치 존재
- **PgBouncer transaction mode 호환** — pgx prepared statement 캐시와 충돌. 현재 `SimpleProtocol` 스위치로 우회 (ADR-0013 참조)

### Reversibility

**1단계 (즉시)**: Istio VirtualService weight를 Go 0%, Java 100%로 되돌림. values 한 줄.
**2단계 (Phase 8 이전)**: Java 서비스 그대로 유지 중이므로 weight 전환만으로 완전 롤백 가능. DB 스키마·Redis 키 호환이므로 데이터 손실 없음.
**비가역 구간**: Phase 8 cleanup 이후 Java 레포 deprecate. 이 시점부터는 Go 내부 버그 수정으로만 대응.

---

## 실행 기록

### Phase 진행 요약

| 일자 | 이벤트 |
|------|--------|
| 2026-04-09 | ADR 승인 (이 문서의 전신 `migration/0004`). Phase 0 foundation (`pkg/`) 완료. Phase 1 Stadium, Phase 2 User, Phase 3 Queue 완료 |
| 2026-04-10 | Phase 4 Resale 완료 |
| 2026-04-11 | Phase 5 Payment (11 API · 3 테이블 · Mock PG · VAT 정산), Phase 6 Ticketing (58 Go 파일 · Redis Lua · N+1 제거) 완료 |
| 2026-04-12 | **Step 4 = 4b 확정** (6 서비스 전부 컷오버). **Go는 prod 직행** 정책 결정. Java 3000VU 부하로 병목 정량 확인 (`stadium-go-performance-sdd.md §2`) |
| 2026-04-13 | Goti-go cutover 첫 smoke — OAuth env / PG date / viper / JSON 필드 / JWT issuer 5건 연쇄 수정 (`dev-logs/2026-04-13-*`) |
| 2026-04-14 | PgBouncer session mode 도입 + Go v2 6서비스 PgBouncer 경유 전환. 3000VU queue-oneshot 측정에서 대기열·정적 조회 안정화 확인 (병목은 결제 path로 이동). 합산 Before/After → ADR-0013 실행 기록 |
| 2026-04-15 | Phase 6.5 W1 PoC PR #192 merged. Phase 7 Go Readiness Audit은 Phase 6.5 기반 위에서 재개 대기 (PAUSED) |

### 후속 과제

1. **Phase 7 Go Readiness Audit 완료** — S0/S3 GREEN, 나머지 8 gate 통과 필요
2. **Phase 8 Java deprecation** — Istio weight 100% 고정 후 Goti-server 레포 archive
3. **Go 단독 기여도 분리 측정** — PgBouncer/캐시 없이 Go 단독 p95 측정 (후속 ADR 대상)
4. **PgBouncer transaction mode 전환** — pgx SimpleProtocol 스위치 완료 후 (ADR-0013 후속)
5. **Migration 도구 표준화** — 현재 수동 psql. golang-migrate / goose 중 택일 (메모리 `project_sql_validation_todo.md`)
6. **OTel trace 완결성 보강** — Go SDK 수동 계측 범위 확대 (내부 라이브러리 호출)

### 레거시 ADR 처리

- `docs/migration/0004-java-to-go-migration.md` 는 **본 ADR로 승격**되었다. `0004`는 마이그레이션 기록으로 보존하되, ADR 인덱스 기준 권위는 본 문서가 갖는다.
