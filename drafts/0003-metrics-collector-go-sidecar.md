# 비즈니스 메트릭 수집기를 Go 별도 서비스로 분리 (ADR)

작성일: 2026-03-27
상태: Accepted
프로젝트: Goti (대규모 티켓팅 서비스)

---

## Decision Summary

| 결정 항목 | 선택 | 대안 | 핵심 근거 |
|-----------|------|------|-----------|
| 비즈니스 메트릭 수집 방식 | **Go 별도 서비스 (goti-metrics-collector)** | Spring Boot 내장, Alloy/OTel Collector 플러그인 | 관측 로직과 비즈니스 로직의 배포·스케일 독립, DB 직접 읽기로 정확성 확보 |
| 메트릭 노출 방식 | **Prometheus pull (/metrics)** | OTel OTLP push | Exporter 성격에 적합, 기존 Alloy ServiceMonitor 파이프라인 재활용 |
| 데이터 소스 | **PostgreSQL + Redis 직접 읽기** | API 폴링 (goti-server REST) | 서버 부하 없이 정확한 스냅샷, 부하테스트 중 API 응답 지연 영향 없음 |

---

## 1. 배경 (Context)

### 기존 관측성 현황

Goti는 OTel Java Agent + Alloy + Mimir 파이프라인으로 **인프라/애플리케이션 메트릭**을 수집하고 있다:

| 계층 | 수집 메트릭 | 도구 |
|------|-----------|------|
| 인프라 | CPU, Memory, Network | kube-prometheus-stack |
| JVM | Heap, GC, Thread | OTel Java Agent |
| HTTP | Latency (p50/p95/p99), Error Rate, RPS | OTel Java Agent |
| DB Pool | HikariCP active/idle/pending | OTel Java Agent |

이 메트릭들은 **시스템이 건강한가?** 를 알려주지만, **비즈니스가 건강한가?** 는 알려주지 못한다.

### 부하테스트에서 발견된 gap

K6로 5,000 VU 티켓팅 시나리오를 돌리면서 이런 질문에 답할 수 없었다:

- 좌석이 몇 퍼센트 팔렸는가? 분당 판매 속도는?
- 결제 전환율은? 타임아웃으로 잠금이 풀린 비율은?
- 대기열에서 기다리는 사람 수 대비 남은 좌석은?
- 현재 속도로 몇 분 후 매진인가?

이 지표들은 DB/Redis의 **현재 상태 스냅샷**에서만 계산할 수 있다. HTTP 요청 메트릭으로는 유도 불가능하다.

### 요구 메트릭 목록 (25+)

| 카테고리 | 메트릭 예시 | 데이터 소스 |
|----------|-----------|-----------|
| 좌석 | `goti_seats_remaining_total`, `goti_seats_sold_total`, `goti_seats_remaining_by_section` | PostgreSQL (seat_statuses JOIN) |
| 결제 | `goti_payment_completed_total`, `goti_payment_timeout_total` | PostgreSQL (orders) |
| 경기 | `goti_match_phase`, `goti_match_info{match_label="03/25 KIA vs SSG"}` | PostgreSQL (game_statuses + schedules + teams) |
| 대기열 | `goti_queue_length_total`, `goti_queue_gate_active` | Redis |
| 가드레일 | `goti_guardrail_bot_blocked_total` | Redis |
| 파생 | `goti_seats_fill_ratio`, `goti_seats_sell_rate_per_min`, `goti_seats_estimated_soldout_minutes`, `goti_payment_conversion_ratio`, `goti_payment_pressure` | 위 원시 지표에서 계산 |

---

## 2. 요구사항

| 요구사항 | 설명 | 중요도 |
|----------|------|--------|
| 비즈니스 메트릭 실시간 수집 | 좌석/결제/대기열 상태를 10~30초 주기로 | 필수 |
| goti-server 무영향 | 부하테스트 중 메트릭 수집이 서버 성능에 영향 없어야 | 필수 |
| 기존 파이프라인 통합 | Alloy → Mimir → Grafana 기존 경로 재활용 | 필수 |
| 배포 독립성 | 메트릭 수집기 변경이 비즈니스 서비스 배포를 요구하지 않아야 | 중요 |
| 파생 지표 계산 | 원시 지표 조합으로 비율/속도/예측 계산 | 중요 |
| 경량 | 리소스 제한된 Kind dev 환경에서 운영 가능 | 선택 |

---

## 3. 대안 비교

### 선택지 A: Spring Boot에 Actuator 엔드포인트 추가

goti-server에 `/actuator/prometheus` 커스텀 메트릭을 추가하는 방식.

```java
// goti-server에 추가
@Component
public class SeatMetrics {
    private final MeterRegistry registry;

    @Scheduled(fixedRate = 15000)
    void updateSeatMetrics() {
        long sold = seatRepo.countByStatus(SOLD);
        registry.gauge("goti_seats_sold_total", sold);
    }
}
```

### 선택지 B: Go 별도 서비스 (goti-metrics-collector)

독립 Go 서비스가 DB/Redis를 직접 읽어 `/metrics`로 노출.

### 선택지 C: Alloy receiver 플러그인

Alloy (OTel Collector 기반)에 커스텀 SQL receiver를 추가하는 방식.

### 비교 매트릭스

| 항목 | A. Spring Boot 내장 | B. Go 별도 서비스 | C. Alloy 플러그인 |
|------|---------------------|-------------------|-------------------|
| **구현 복잡도** | 낮음 (기존 코드에 추가) | 중간 (새 서비스 구축) | 높음 (커스텀 receiver 개발) |
| **배포 결합도** | 높음 — 메트릭 변경 = 서버 재배포 | **없음 — 완전 독립** | 없음 — Alloy 재배포만 |
| **서버 부하 영향** | 있음 — 같은 JVM에서 DB 쿼리 실행, 커넥션 풀 공유 | **없음 — 별도 커넥션 (maxConns=3)** | 없음 |
| **부하테스트 중 안정성** | 위험 — HikariCP 풀 소진 시 메트릭 쿼리도 영향 | **안전 — 독립 커넥션** | 안전 |
| **파생 지표 계산** | 가능 (Java 코드) | **가능 (Go 코드, 이전 스냅샷 비교)** | 제한적 (SQL만, rate 계산 불가) |
| **메트릭 파이프라인** | OTel Agent가 Actuator scrape → Alloy → Mimir | **Alloy ServiceMonitor scrape → Mimir** | Alloy 내장 → Mimir |
| **리소스 사용** | 추가 JVM 메모리 (~50MB) | **distroless 바이너리 (~10MB), 메모리 ~30MB** | Alloy에 추가 부하 |
| **인프라 비용** | 0 (기존 Pod) | ECR 레포 + K8s Deployment + CI/CD | 0 |
| **유지보수 범위** | goti-server 팀 | 인프라/DevOps 팀 (본인) | 인프라 팀 |
| **기술 스택 일관성** | Java (기존) | Go (새로운 언어 도입) | River (Alloy DSL) |
| **SQL 자유도** | JPA/jOOQ 의존 | **pgx 직접 쿼리, 크로스 스키마 JOIN 자유** | SQL receiver 설정 |

### 시나리오별 적합도

**부하테스트 시나리오 (5,000+ VU)**:
- A 부적합: 서버가 과부하 상태에서 추가 DB 쿼리는 HikariCP 풀 경합을 악화. 3.6M `seat_statuses` JOIN 쿼리가 비즈니스 쿼리와 커넥션을 놓고 경쟁
- **B 최적**: 독립 커넥션 풀 (maxConns=3)로 서버 무영향. 서버가 죽어도 메트릭은 계속 수집
- C 가능하지만 SQL 기반 rate 계산 한계

**MSA 전환 후 시나리오**:
- A 부적합: 5개 서비스(user, ticketing, payment, resale, stadium) 각각에 메트릭 코드 중복, 크로스 서비스 집계 불가
- **B 최적**: 단일 수집기가 모든 서비스의 DB를 읽어 통합 뷰 제공
- C 가능하지만 복수 datasource 설정이 복잡

**운영 시나리오 (메트릭 추가/변경)**:
- A: goti-server PR → 빌드 → 배포 (팀원 리뷰 필요, 5개 서비스 배포 가능성)
- **B: collector PR → 빌드 → 배포 (인프라 단독, 비즈니스 무영향)**
- C: Alloy ConfigMap 수정 → ArgoCD sync

---

## 4. 결정 (Decision)

**Go 별도 서비스 (선택지 B)** 를 선택한다.

### 핵심 근거

1. **관측과 비즈니스의 관심사 분리**: 메트릭 수집은 비즈니스 로직이 아니다. 관측 주기 변경, 메트릭 추가가 비즈니스 서비스 배포를 트리거하면 안 된다

2. **부하테스트 안정성**: 가장 메트릭이 필요한 순간이 부하테스트 중인데, 그때 서버가 가장 바쁘다. 같은 JVM/커넥션풀에서 집계 쿼리를 돌리면 부하테스트 결과 자체를 오염시킨다

3. **MSA 대비**: 현재 모놀리스지만 5서비스로 분리 완료 상태. 각 서비스에 메트릭 코드를 넣으면 크로스 서비스 파생 지표(대기열 대비 잔여 좌석 등) 계산이 불가능하다

4. **Go 선택 이유**:
   - Prometheus client_golang은 Go가 1등 시민 — 가장 성숙하고 문서 풍부
   - distroless 바이너리 ~10MB (Java의 1/20), 메모리 ~30MB (JVM의 1/10)
   - pgx 드라이버로 크로스 스키마 JOIN 자유 (JPA entity 매핑 불필요)
   - 본인이 인프라/DevOps 담당이므로 Go 유지보수가 팀원에게 부담되지 않음

### 트레이드오프 인정

- **인프라 오버헤드**: ECR 레포, CI/CD 파이프라인, K8s Deployment, ServiceMonitor, NetworkPolicy, AuthorizationPolicy 전부 새로 구축 필요 — 실제로 3-Layer 보안(Istio L7 + NetworkPolicy L3/L4) 개통에 1.5세션 소요
- **기술 스택 분산**: 팀 전체는 Java/Spring Boot인데 Go 서비스가 하나 추가됨. 단, 이 서비스는 인프라 담당자(본인)만 관리하므로 팀 학습 비용 없음
- **DB 스키마 결합**: collector가 DB 테이블 구조를 직접 알아야 함. 스키마 변경 시 collector도 수정 필요. 단, Read Replica 사용으로 write path에는 영향 없음

---

## 5. 결과 (Consequences)

### 긍정적 영향

- **부하테스트 가시성 확보**: 좌석 판매 속도, 결제 전환율, 매진 예상 시간 등 실시간 확인 가능
- **서버 무영향 관측**: maxConns=3 독립 커넥션으로 비즈니스 트래픽과 완전 격리
- **빠른 메트릭 이터레이션**: collector만 배포하면 되므로 메트릭 추가/변경이 분 단위
- **MSA 통합 뷰**: 5개 서비스의 데이터를 하나의 수집기가 통합, 크로스 서비스 파생 지표 계산 가능
- **경량 운영**: distroless ~10MB 이미지, 30MB 메모리, CPU 거의 사용 안 함

### 부정적 영향 / 리스크

- 인프라 구축 일회성 비용 (CI/CD, K8s manifest, 보안 정책 등) — 이미 완료
- DB 스키마 변경 시 collector 쿼리도 수정 필요 — 모놀리스 단계에서는 빈도 낮음
- 3.6M row seat_statuses JOIN → poll duration 모니터링 필요 (현재 ~1-2초)

### 향후 과제

- Read Replica 분리: 현재는 primary DB에서 읽고 있으므로, 트래픽 증가 시 Read Replica로 전환
- queue-gate 배포 후 Redis 대기열 메트릭 활성화
- goti-load-observer → goti-metrics-collector 리네임

---

## 6. 구현 결과

### 아키텍처

```
PostgreSQL ──┐
             ├── goti-metrics-collector (Go) ──→ :9090/metrics
Redis    ────┘         │
                       │  Alloy ServiceMonitor scrape
                       ↓
                    Alloy → Mimir → Grafana Dashboard
```

### 코드 규모

| 파일 | 줄 수 | 역할 |
|------|-------|------|
| `cmd/collector/main.go` | 156 | 진입점, DB/Redis 연결, HTTP 서버, graceful shutdown |
| `internal/metrics/registry.go` | 202 | Prometheus 메트릭 25+ 정의 |
| `internal/poller/db_poller.go` | 202 | PostgreSQL 폴링 (좌석/주문/경기) |
| `internal/poller/redis_poller.go` | 64 | Redis 폴링 (대기열/가드레일) |
| `internal/aggregator/aggregator.go` | 100 | 파생 지표 계산 (fill ratio, sell rate, est soldout) |
| `internal/config/config.go` | 67 | 환경변수 설정 |
| **합계** | **791** | — |

### 의존성 (최소화)

```
pgx/v5          — PostgreSQL 드라이버
go-redis/v9     — Redis 클라이언트
client_golang   — Prometheus 메트릭
```

프레임워크 없음 (net/http + promhttp만 사용). OTel SDK 의존성 제거 (초기에는 OTLP push였으나 pull 방식으로 전환하며 제거).

---

## 7. 참고 자료

- [E2E 파이프라인 개통 트러블슈팅](../dev-logs/2026-03-26-metrics-collector-pipeline-e2e-troubleshoot.md) — 3-Layer 보안 개통 과정
- [Tempo spanmetrics batch timeout](../dev-logs/2026-03-26-tempo-spanmetrics-batch-timeout-ingestion-slack.md) — 관측 파이프라인 타이밍 이슈
- [OTel → Prometheus 레이블 매핑](../dev-logs/2026-03-06-otel-label-mismatch.md) — 기존 인프라 메트릭 파이프라인 구조
