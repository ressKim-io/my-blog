---
title: "Java/Spring Boot에서 Go로 — 6 MSA 전환 결정 ADR"
excerpt: "JVM 콜드스타트 30~60초·메모리 풋프린트·GC pause 한계를 실측 데이터로 확인한 뒤, ticketing-go PoC의 메모리 6배 절감을 근거로 6개 서비스 전체를 Go로 전환하기로 결정한 과정과 근거를 기록합니다"
category: challenge
tags:
  - go-ti
  - Go
  - Java
  - Spring Boot
  - Migration
  - JVM
  - adr
series:
  name: goti-java-to-go
  order: 7
date: "2026-04-09"
---

## 왜 이 결정을 내리게 됐는가

go-ti 프로젝트의 목표는 동시 접속 50만 규모의 야구 티켓팅 플랫폼을 실운영급으로 운영하는 것입니다. API p99 200ms 이하, 좌석 정합성 100%, DR Failover 5분 이내가 핵심 지표였습니다.

초기 Java/Spring Boot 기반 서비스는 Kind 5노드 로컬 환경의 리소스 압박을 가중시켰고, 프로덕션 EKS에서도 스케일 여유가 빠르게 소진됐습니다. ticketing-go PoC 실험에서 동일 부하 조건 대비 **메모리 6배 절감**이 확인됐고, 이것이 전면 전환 결정의 출발점이 됐습니다.

이 ADR은 2026-04-09 정식 채택된 결정의 배경·대안·근거를 기록합니다. Phase 0~6 구현은 4월 11일까지 완료됐고, Phase 6.5(Go prod 인프라 신설) → Phase 7(Go Readiness Audit) 순으로 이어졌습니다. Phase 7은 2026-04-21 프로젝트 종료까지 완료되지 못한 상태였고, Phase 8 Java deprecation은 대기로 남았습니다.

---

## 배경

### Java 런타임의 구조적 한계

Goti-server는 Spring Boot 3.5.10 기반 MSA 6개 서비스(user·ticketing·payment·resale·stadium·queue)로 구성됐습니다. 티켓팅 트래픽 프로파일 — 평시 극소 → 오픈 순간 수만 배 폭증 — 과 맞지 않는 런타임 특성이 반복적으로 드러났습니다.

1. **JVM 콜드스타트 30~60초** — HPA 스케일아웃이 피크 대응에 늦습니다. 티켓 오픈은 "그 순간"이 전부이므로 warmup 30초는 실질적으로 무의미합니다
2. **pod당 메모리 요청 512Mi~1Gi** (6서비스 합산 ~2.3Gi) — 동일 노드에서 수용 가능한 replica 수가 적어 스케일아웃 여력이 낮습니다
3. **JVM GC pause로 p99 꼬리 지연** — 부하 중 수십~수백 ms의 STW pause가 재현됩니다
4. **KEDA cron pre-scale이 필수** — 오픈 시각 전에 강제로 replica를 띄워두지 않으면 첫 분 동안 사용자가 타임아웃을 겪습니다
5. **Kind 로컬 환경 리소스 부족** — 512Mi × 6서비스 × replica 2 = 6Gi 이상이 필요해 dev 환경 구축 자체가 무거웠습니다

### Java prod 3000VU 실측 (2026-04-12)

실제 프로덕션 EKS에서 3000VU 부하테스트를 수행한 결과입니다.

| 엔드포인트 | p95 | 5xx | 판정 |
|-----------|-----|-----|------|
| `/stadium-seats/games/{gameId}/seat-grades` | 6.84s | 10.88% | 최악 |
| `/stadium-seats/stadiums/{stadiumId}/seat-sections` | 5.48s | 5.81% | 심각 |
| `/teams/{teamId}/ticket-pricing-policies` | 4.41s | 2.24% | 불량 |
| `/seat-reservations/seats/{seatId}` (hold) | 2.47s | 1.63% | 락 경합 |
| `/queue/enter` p99 | 2.48s | — | 분산 락 경합 |

이 측정에서 드러난 핵심 수치는 **queue pass_rate 1.04%**입니다. 3000VU 중 99%가 대기열 타임아웃으로 실 예매 단계까지 도달하지 못했습니다. Java 런타임이 목표 트래픽(10만~50만 동시 접속) 대응에 구조적으로 부족하다는 사실이 정량적으로 확인됐습니다.

p95 6.84초와 5xx 10.88%는 단순 최적화로 해소될 수준이 아닙니다. JVM warmup 지연과 GC pause가 복합적으로 작용하면서, 부하가 집중되는 경로에서 스택 전체가 무너지는 양상이었습니다. 이것이 대안 검토를 시작한 직접 계기였습니다.

### 요구사항

1. **콜드스타트 수 초 이내** — HPA 스케일아웃이 즉시 효과를 내야 합니다
2. **동일 API / DB 계약 유지** — 클라이언트(Goti-front) 변경 없이 런타임만 교체해야 합니다
3. **Istio canary로 점진 전환** — 0% → 10% → 25% → 50% → 100%, 각 단계에서 즉시 롤백 가능해야 합니다
4. **1주 시연 범위 내 완료** — Phase 0~8 모두 4월 말까지 처리해야 합니다
5. **관측성 동등 이상** — OTel, Prometheus 메트릭, 로깅 형식이 Java와 호환돼야 합니다

---

## 🧭 선택지 비교

### 고려한 옵션

| 옵션 | 핵심 아이디어 | 한계 |
|------|-------------|------|
| A. Java + JVM 튜닝 | G1/ZGC, heap 튜닝, HikariCP pool 재설정 | 콜드스타트·메모리 풋프린트의 구조적 한계 그대로 |
| B. Spring Boot + Virtual Threads (Java 21 Loom) | 동시성 개선으로 I/O-bound 경로 효율화 | JVM warmup·메모리 구조적 문제 미해결 |
| C. GraalVM Native Image (Spring Native) | AOT 컴파일로 콜드스타트 해결 | 빌드 시간 폭증, JPA/리플렉션 AOT 불호환, 팀 도구 부재 |
| D. Kotlin + Ktor / Quarkus Native | JVM 대안 또는 Quarkus AOT | Kotlin은 JVM warmup 동일, Quarkus는 GraalVM 이슈 동일 |
| E. Rust (actix-web / axum) | 성능·리소스 Go 이상 | 팀 내 Rust 경력 0, DB/Redis/OTel 생태계 미성숙, 1주 내 6서비스 재작성 불가 |
| F. Node.js / TypeScript (NestJS) | 콜드스타트 빠름, JS 생태계 풍부 | 단일 스레드 이벤트 루프가 CPU-bound 경로에서 불리, 타입 안전성·동시성 모델 약함 |
| **G. Go (Gin + pgx + go-redis)** | **채택** — 콜드스타트 초 단위, 정적 바이너리 distroless 배포, goroutine 동시성 | — |

### 기각 이유

**A 탈락**: ZGC로 p99 pause는 줄일 수 있지만, pod당 1Gi·warmup 30초 문제는 구조적으로 해결되지 않습니다. 50만 동시 접속 목표에 필요한 스케일아웃 밀도가 확보되지 않습니다

**B 탈락**: Virtual Threads의 주된 이점은 blocking call에 가려진 CPU cost 문제입니다. 티켓팅의 Redis/DB 경로는 이미 non-blocking 패턴 적용이 가능하며, JVM warmup과 메모리 오버헤드는 그대로 남습니다

**C 탈락**: 콜드스타트는 해결되지만 (1) 빌드 시간 폭증, (2) 리플렉션·프록시·JPA 런타임 특성과 AOT 불호환, (3) 팀 학습·디버깅 도구 부재로 1주 시연 범위 안에서 6서비스를 안정적으로 전환할 수 없었습니다

**D 탈락**: Kotlin은 여전히 JVM 위에서 동작하므로 warmup 문제가 동일합니다. Quarkus Native는 GraalVM의 이슈를 그대로 가집니다. 팀의 Kotlin 경험도 Java 대비 얕았습니다

**E 탈락**: 성능·리소스 측면에서 Go보다 우수할 수 있으나, 팀 내 Rust 경력이 전무하고 DB/Redis/OTel 생태계 성숙도가 낮습니다. 1주 시연 범위에서 6서비스 재작성은 일정 리스크가 그대로 프로젝트 실패 리스크가 됩니다

**F 탈락**: 단일 스레드 이벤트 루프가 JWE 검증·Lua 전처리·JSON serde 같은 CPU-bound 경로에서 Go 대비 불리합니다. TypeScript 트랜스파일·빌드 체인의 복잡도도 1주 내 안정화에 장애가 됐습니다

### 결정 기준과 최종 선택

**G(Go)를 채택했습니다.**

결정 기준은 다음 우선순위였습니다.

1. **1주 시연 범위 내 6서비스 전체를 완성할 수 있는가**: E(Rust)·C(GraalVM)가 여기서 탈락했습니다
2. **콜드스타트와 메모리 풋프린트를 구조적으로 해결하는가**: A·B·D가 여기서 탈락했습니다
3. **팀이 즉시 생산성을 낼 수 있는 언어·생태계인가**: Go 경험자가 팀 내에 있었고, 문법 단순성으로 러닝 커브가 허용 범위였습니다

Go는 이 세 기준을 모두 충족한 유일한 선택지였습니다.

---

## 결정

**Goti-server의 6 MSA 서비스 전부를 Go로 재작성합니다.** API 계약·DB 스키마·Redis 키 패턴은 100% 유지하며, Istio weighted routing canary로 점진 전환 후 Java deprecation합니다.

### 기술 스택

| 계층 | Java (전) | Go (후) | 선택 이유 |
|------|----------|---------|----------|
| HTTP | Spring MVC | Gin v1.12 | 경량, middleware 생태계 성숙, otelgin 자동계측 지원 |
| DB | JPA/Hibernate | pgx v5 (raw SQL) | ORM 제거 → N+1·`SELECT *` 원천 차단, prepared statement 명시 제어 |
| Redis | Spring Data Redis | go-redis v9 (UniversalClient) | 단일↔Cluster 분기 유연, Lua `Eval` 표준, Stream 지원 |
| JWT | jjwt 0.13 | golang-jwt v5 (RS256 + JWKS) | `user`만 private key 보유, 나머지는 JWKS 오프라인 검증 |
| 설정 | `application.yml` | Viper (YAML + env override) | 12-factor 준수, 동일 바이너리 환경별 재사용 |
| 관측 | OTel Java Agent (auto) | OTel Go SDK + otelgin + otelhttp | 미들웨어 경유로 동등한 계측 효과 |
| 메트릭 | Micrometer | prometheus/client_golang | K8s ServiceMonitor 호환 |
| 컨테이너 | Eclipse Temurin JRE | distroless/static-debian12:nonroot | 이미지 수십 MB, shell 없음, UID 65532 |
| 빌드 | Gradle | go build + Makefile | 빌드 시간 수 초, 재현성 높음 |

기술 선택 중 몇 가지에 대해 추가 설명이 필요합니다.

**ORM을 쓰지 않기로 한 이유**는 단순히 "Go에 JPA가 없어서"가 아닙니다. Phase 1~6 마이그레이션 과정에서 Java 쿼리를 재검토하다가 N+1, `SELECT *` 패턴이 여러 건 발견됐습니다. ORM의 추상화가 쿼리 비용을 숨기고 있었던 것입니다. pgx + raw SQL로 전환하면 모든 쿼리가 코드 상에 명시되므로 리뷰 시점에서 비효율을 잡을 수 있습니다

**golang-jwt의 JWKS 검증 방식**은 `user` 서비스만 private key를 보유하고, 나머지 5개 서비스는 JWKS 엔드포인트에서 공개키를 받아 오프라인 검증하는 구조입니다. 서비스 간 토큰 검증 의존이 없어지고 Istio RequestAuthentication과도 자연스럽게 통합됩니다

### Go 모노레포 구조

신규 레포 Goti-go의 최상위 레이아웃은 다음과 같습니다.

```text
Goti-go/
├── cmd/
│   ├── user/
│   ├── stadium/
│   ├── ticketing/
│   ├── payment/
│   ├── resale/
│   ├── queue/
│   └── outbox/
├── internal/          # 서비스별 4-layer (handler/service/repo/domain)
└── pkg/               # 공통 모듈
    ├── auth/
    ├── database/
    ├── redis/
    ├── lock/
    ├── middleware/
    └── observability/
```

7개 서비스가 하나의 레포에 공존합니다. `pkg/` 공통 모듈 덕분에 DB 연결, Redis, OTel 초기화, JWT 미들웨어를 모든 서비스가 공유합니다. 서비스별 차이는 `internal/`에만 집중됩니다

### 마이그레이션 Phase

| Phase | 대상 | 복잡도 | 완료일 |
|-------|------|--------|--------|
| 0 | Foundation (`pkg/` 공통) | — | 2026-04-09 |
| 1 | Stadium | 낮음 | 2026-04-09 |
| 2 | User (OAuth 3종·JWT·SMS) | 중간 | 2026-04-09 |
| 3 | Queue | 낮음 | 2026-04-09 |
| 4 | Resale | 중간 | 2026-04-10 |
| 5 | Payment (Mock PG·정산·에스크로) | 중간 | 2026-04-11 |
| 6 | Ticketing (좌석 hold·주문·Lua atomic) | 높음 | 2026-04-11 |
| 6.5 | Go prod 인프라 (Phase 7 진입 차단 갭 해소) | — | 2026-04-15 |
| 7 | Go Readiness Audit (E2E·부하·관측성·보안) | — | PAUSED |
| 8 | Cleanup (Java deprecation) | — | 대기 |

Phase를 복잡도 오름차순으로 배열한 이유가 있습니다. Stadium처럼 단순한 서비스로 공통 패턴(`pkg/`)을 먼저 검증하고, Ticketing처럼 복잡한 서비스(Redis Lua atomic, 좌석 hold 경합 제어)는 나중에 처리했습니다. Phase 0~6이 4월 11일까지 완료된 것은 이 순서 덕분이기도 합니다

Phase 6.5는 당초 계획에 없던 Phase입니다. Phase 7 진입 시점에 "Go prod 인프라에 values가 Java 기준이라 Go pod 하나도 프로덕션에 없음"을 발견했습니다. Helm values 5세트, SSM Parameter ExternalSecret, ApplicationSet entry, KEDA 설정이 전부 누락된 상태였습니다. 이 갭을 해소하기 위해 6.5를 신설하고 PR #192를 통해 병렬 처리했습니다

### 결정 규칙 (불변)

이 결정과 함께 다음 규칙을 함께 확정했습니다.

1. **API 계약 100% 호환** — 엔드포인트, 응답 JSON 필드, HTTP status 코드까지 Java와 동일합니다. 클라이언트(Goti-front)는 변경 금지입니다
2. **DB 스키마 공유** — 동일 PostgreSQL 스키마를 그대로 사용합니다. Java와 Go가 병렬 운영되는 기간에도 동시 쓰기를 허용합니다
3. **Istio canary 전환만 허용** — DNS 전환·수동 배포 전환은 금지입니다. Weight 기반이어야 즉시 롤백이 가능합니다
4. **Go는 prod 직행** — Kind dev는 Java + 모니터링 + 가드레일 전용입니다. Go의 부하·정합성·관측성 검증 전부를 prod에서 수행합니다 (2026-04-12 결정)
5. **병렬 운영 기간 Java 무영향** — Java 서비스 config·코드 수정을 금지합니다. 문제 발견 시 Go 쪽만 수정합니다
6. **Step 4 = 4b 확정** — 6개 서비스 전부 컷오버합니다. ticketing만 부분 전환하는 4a안은 2026-04-12에 기각됐습니다

4a(ticketing 선행) 기각 이유를 보충합니다. ticketing만 Go로 전환하면 Java user·payment와의 서비스 간 호출이 혼재됩니다. 그 경우 관측성 데이터(trace, metric)가 Java/Go 혼재로 해석이 복잡해지고, canary 가중치를 서비스별로 독립 관리해야 해서 운영 복잡도가 기하급수적으로 증가합니다. 6개를 같은 Helm release 사이클로 전환하는 편이 일관성·추적성 측면에서 훨씬 유리했습니다

---

## 결과

### Go 전환 단독 기여

아래는 **Go 런타임 전환 자체의 직접 효과**입니다. PgBouncer, Redis 캐시, ANALYZE 등 다른 최적화와 혼재되지 않는 수치입니다.

| 지표 | Java | Go | 변화 |
|------|------|-----|------|
| pod당 메모리 요청 (6서비스 합산) | ~2,300 Mi | ~384 Mi | **6배 절감** |
| 콜드스타트 (Pod 생성 → Ready) | 30~60s | 1~3s | **10~20배 개선** |
| `initialDelaySeconds` | 30~60 | 3 | warmup 대기 제거 |
| KEDA cron pre-scale | 필수 | 불필요 | 스케줄 의존성 제거 |
| HPA `cooldownPeriod` | 300s | 120s | 반응성 2.5배 향상 |
| 이미지 크기 | ~280MB (Eclipse Temurin JRE) | ~40MB (distroless/static) | 7배 축소 |

pod당 메모리 요청이 6배 줄었다는 것이 무엇을 의미하는지 구체적으로 살펴보겠습니다.

Java 기준 합산 2.3Gi는 8노드 EKS 클러스터에서 서비스 replica 2씩 띄우면 노드 여유 용량이 빠르게 줄어듭니다. 여기에 모니터링 스택, KEDA, Istio sidecar가 붙으면 추가 pod를 스케줄할 여유가 없었습니다. HPA가 트리거되어도 신규 pod가 들어갈 노드가 없어 Pending 상태로 대기하는 상황이 반복됐습니다

Go 전환 후 합산 384Mi로 줄면서, 동일 노드에서 수용 가능한 replica 수가 크게 늘었습니다. 콜드스타트 3초와 합쳐지면 "HPA가 트리거 → 신규 pod Ready → 실제 트래픽 처리"까지의 사이클이 실질적으로 의미 있는 속도가 됩니다

KEDA cron pre-scale이 불필요해진 것도 운영 측면에서 큰 변화입니다. Java 시절에는 티켓 오픈 시각을 예측해서 그 전에 replica를 강제 기동해야 했습니다. 오픈 시각이 바뀌거나 예측이 틀리면 대비가 없었습니다. Go 전환 후에는 실시간 HPA만으로 대응이 가능해서 스케줄 의존성 자체가 사라졌습니다

### 합산 효과에 대한 주의

티켓팅 엔드포인트의 p95·RPS·5xx 개선 수치는 Go 전환 단독이 아니라, PgBouncer 커넥션 풀링·Redis 캐시·ANALYZE·pgbouncer session mode 등이 복합 작용한 결과입니다. 단일 원인 breakdown이 불가능하며, 상세 측정치는 ADR-0013(PgBouncer 커넥션 풀링) 실행 기록에 기록되어 있습니다

Go 단독 기여도를 분리 측정하려면 "Go + PgBouncer off + Redis 캐시 off + ANALYZE off" 상태의 별도 부하가 필요합니다. 이는 후속 과제로 남아 있습니다

### 운영 이점

- **HPA 실효성 회복**: 콜드스타트 3초 이내라 HPA target 도달 즉시 replica가 실제 트래픽을 받습니다. Java에서는 Ready 상태가 되어도 warmup 30초 동안 slow response가 지속됐습니다
- **Kind dev 환경 수용 가능**: 6서비스 × 384Mi = ~2.3Gi로 Ubuntu 32GB 호스트에서 여유 있게 운영 가능합니다
- **KEDA 스케줄 의존 제거**: 오픈 시각 예측이 틀려도 실시간 부하에 반응합니다
- **ORM 제거 효과**: JPA의 lazy load·N+1·`SELECT *`로 인한 예상치 못한 쿼리 폭발이 원천 차단됐습니다. Phase 1~6 마이그레이션 중 실제로 여러 건 발견됐습니다

### 리스크와 완화

| 리스크 | 완화 |
|--------|------|
| 팀 내 Go 경험 편차 | `pkg/` 공통 모듈과 4-layer 구조 표준화로 주니어도 패턴을 따라올 수 있게 함 |
| raw SQL 관리 부담 | `scripts/audit-sql-timestamps.py` 등 정적 스캐너로 `created_at/updated_at` 누락 전수 검사 |
| Java/Go 병렬 운영 기간 이중 유지보수 | Phase 8 cleanup 최우선 후속 과제로 지정 |
| OTel Java Agent 자동계측 범위 일부 손실 | otelgin·otelhttp로 주요 경로 커버, 내부 span 일부 누락은 허용 |
| cutover 초기 호환성 불일치 | 2026-04-13 첫 스모크에서 OAuth env·PG DATE 타입·viper·JSON 필드명·JWT issuer 5건 연쇄 발생. 런타임 500/401로만 드러나는 유형이므로 별도 smoke trail 관리 필요 |
| PgBouncer transaction mode 호환 | pgx prepared statement 캐시와 충돌. 현재 SimpleProtocol 스위치로 우회 (ADR-0013 참조) |

### 롤백 가능성

**즉시(1단계)**: Istio VirtualService weight를 Go 0%, Java 100%로 변경합니다. Helm values 한 줄 수정입니다

**Phase 8 이전**: Java 서비스를 그대로 유지하고 있으므로 weight 전환만으로 완전 롤백이 가능합니다. DB 스키마·Redis 키 호환으로 데이터 손실이 없습니다

**비가역 구간**: Phase 8 cleanup 이후 Java 레포를 deprecate합니다. 이 시점부터는 Go 내부 버그 수정만으로 대응해야 합니다

---

## 실행 타임라인

| 일자 | 이벤트 |
|------|--------|
| 2026-04-09 | ADR 정식 채택. Phase 0 foundation(`pkg/`) + Phase 1 Stadium + Phase 2 User + Phase 3 Queue 완료 |
| 2026-04-10 | Phase 4 Resale 완료 |
| 2026-04-11 | Phase 5 Payment (11 API·3 테이블·Mock PG·VAT 정산) + Phase 6 Ticketing (58 Go 파일·Redis Lua·N+1 제거) 완료 |
| 2026-04-12 | Step 4 = 4b 확정 (6서비스 전부 컷오버). Go는 prod 직행 정책 결정. Java 3000VU 부하로 병목 정량 확인 |
| 2026-04-13 | cutover 첫 스모크 — OAuth env·PG DATE·viper·JSON 필드명·JWT issuer 5건 연쇄 수정 |
| 2026-04-14 | PgBouncer session mode 도입 + Go v2 6서비스 PgBouncer 경유 전환. 3000VU queue-oneshot에서 대기열·정적 조회 안정화 확인 |
| 2026-04-15 | Phase 6.5 W1 PoC PR #192 merged. Phase 7 PAUSED (Phase 6.5 기반 위에서 재개 대기) |
| 2026-04-21 | 프로젝트 전체 destroy. Phase 7 미완료, Phase 8 대기 상태로 종료 |

---

## 📚 배운 점

**1. 콜드스타트와 메모리 문제는 튜닝이 아니라 런타임 전환으로 해결했습니다**

ZGC·Virtual Threads·GraalVM Native를 검토하면서 공통적으로 발견한 패턴이 있었습니다. 각 방법이 문제의 일부를 해결하지만, JVM 구조에서 비롯된 한계는 피해가지 못했습니다. 티켓팅처럼 "그 순간"이 전부인 트래픽 프로파일에서는 콜드스타트와 메모리 오버헤드를 구조적으로 제거하는 것이 유일한 경로였습니다

**2. ORM 제거는 성능보다 가시성의 문제였습니다**

pgx + raw SQL로 전환을 결정했을 때 주요 동기는 N+1·`SELECT *` 차단이었습니다. 실제로 Phase 1~6에서 Java JPA 코드를 Go로 옮기는 과정에서 숨겨져 있던 비효율 쿼리를 여러 건 발견했습니다. ORM은 생산성을 높이지만, 쿼리 비용을 코드에서 보이지 않게 만드는 부작용이 있었습니다

**3. Istio canary는 롤백 가능성을 실질적으로 보장했습니다**

6개 서비스를 동시에 전환하면서 Istio weight 기반 canary를 쓴 것이 핵심 안전장치였습니다. 첫 cutover 스모크에서 5건의 블로커가 연속으로 터졌지만, 각 단계마다 Java로 즉시 되돌릴 수 있다는 사실이 과감하게 prod에서 검증을 진행할 수 있게 해줬습니다

**4. Phase 6.5 같은 갭은 사전 점검으로 잡아야 합니다**

Phase 7 진입 시점에 Go prod 인프라가 전무했다는 것은 Phase 0~6 완료 직후 prod 상태를 한 번만 확인했어도 막을 수 있었던 갭입니다. "코드는 완성됐는데 인프라가 없다"는 상황을 막으려면, 각 Phase 완료 시 "이 서비스가 prod에 실제로 배포 가능한 상태인가"를 체크리스트로 검증하는 것이 필요합니다

**5. Java 호환 계약은 컴파일 시점이 아닌 런타임에서 드러납니다**

JSON 필드명, JWT issuer, env 키명 차이는 컴파일도 통과하고 배포도 됩니다. 런타임 500·401이 나야 비로소 드러납니다. API 계약 100% 유지를 목표로 할 때는 OpenAPI export + contract test처럼 런타임 이전에 불일치를 잡는 도구가 필수입니다
