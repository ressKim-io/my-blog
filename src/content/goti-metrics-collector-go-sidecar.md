---
title: "비즈니스 메트릭 수집기를 Go로 분리한 이유"
excerpt: "인프라 메트릭은 있는데 비즈니스 메트릭이 없다. 좌석 판매 속도, 결제 전환율 같은 지표를 수집하기 위해 Go 별도 서비스를 만든 아키텍처 결정 과정"
category: monitoring
tags:
  - go-ti
  - Go
  - Prometheus
  - Metrics
  - Architecture Decision Record
  - troubleshooting
series:
  name: "goti-metrics-collector"
  order: 1
date: "2026-02-08"
---

## 한 줄 요약

> 시스템이 건강한지는 알 수 있는데, 비즈니스가 건강한지는 알 수 없었습니다. 좌석/결제/대기열 메트릭을 수집하는 Go 별도 서비스를 만들어서 비즈니스 관측성을 확보했습니다.

---

## 🔥 배경: 부하테스트에서 답할 수 없는 질문들

Goti는 OTel Java Agent + Alloy + Mimir로 인프라/애플리케이션 메트릭을 수집하고 있었습니다.

| 계층 | 수집 메트릭 | 도구 |
|------|-----------|------|
| 인프라 | CPU, Memory, Network | kube-prometheus-stack |
| JVM | Heap, GC, Thread | OTel Java Agent |
| HTTP | Latency (p50/p95/p99), Error Rate, RPS | OTel Java Agent |
| DB Pool | HikariCP active/idle/pending | OTel Java Agent |

이 메트릭들은 **시스템이 건강한가?**를 알려줍니다.
하지만 K6로 5,000 VU 부하테스트를 돌리면서 이런 질문에 답할 수 없었습니다:

- 좌석이 몇 퍼센트 팔렸는가? 분당 판매 속도는?
- 결제 전환율은? 타임아웃으로 잠금이 풀린 비율은?
- 대기열에서 기다리는 사람 수 대비 남은 좌석은?
- 현재 속도로 몇 분 후 매진인가?

이 지표들은 HTTP 메트릭으로는 유도 불가능합니다.
DB와 Redis의 **현재 상태 스냅샷**에서만 계산할 수 있습니다.

수집해야 할 메트릭은 25개 이상이었습니다.

| 카테고리 | 메트릭 예시 | 데이터 소스 |
|----------|-----------|-----------|
| 좌석 | `goti_seats_remaining_total`, `goti_seats_sold_total` | PostgreSQL |
| 결제 | `goti_payment_completed_total`, `goti_payment_timeout_total` | PostgreSQL |
| 경기 | `goti_match_phase`, `goti_match_info` | PostgreSQL |
| 대기열 | `goti_queue_length_total`, `goti_queue_gate_active` | Redis |
| 파생 | `goti_seats_fill_ratio`, `goti_seats_sell_rate_per_min`, `goti_seats_estimated_soldout_minutes` | 계산 |

---

## 🤔 대안 비교

### A. Spring Boot에 Actuator 엔드포인트 추가

goti-server에 커스텀 메트릭을 추가하는 방식입니다.

```java
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

가장 단순하지만, 치명적인 문제가 있습니다.

부하테스트 시 서버가 가장 바쁜 순간에, 같은 JVM에서 3.6M row `seat_statuses` JOIN 쿼리를 돌리면 **HikariCP 커넥션 풀 경합**이 발생합니다.
메트릭 수집이 비즈니스 쿼리와 커넥션을 놓고 경쟁하게 됩니다.
가장 메트릭이 필요한 순간에 오히려 부하테스트 결과를 오염시킵니다.

### B. Go 별도 서비스

독립 Go 서비스가 DB/Redis를 직접 읽어 `/metrics`로 노출하는 방식입니다.

### C. Alloy receiver 플러그인

Alloy(OTel Collector 기반)에 커스텀 SQL receiver를 추가하는 방식입니다.
가능하지만 SQL 기반 rate 계산 한계가 있고, 복수 datasource 설정이 복잡합니다.

### 비교

| 항목 | A. Spring Boot | **B. Go 서비스** | C. Alloy 플러그인 |
|------|---------------|-----------------|------------------|
| 배포 결합도 | 메트릭 변경 = 서버 재배포 | **완전 독립** | Alloy 재배포만 |
| 서버 부하 | 같은 JVM, 커넥션 풀 공유 | **별도 커넥션 (maxConns=3)** | 없음 |
| 파생 지표 | 가능 (Java) | **가능 (Go, 스냅샷 비교)** | 제한적 (SQL만) |
| 리소스 | +50MB JVM 메모리 | **~10MB 바이너리, ~30MB 메모리** | Alloy에 추가 부하 |
| SQL 자유도 | JPA entity 매핑 | **pgx 직접 쿼리, 크로스 스키마 JOIN** | SQL receiver 설정 |

---

## ✅ 결정: Go 별도 서비스

### 핵심 근거 4가지

**1. 관측과 비즈니스의 관심사 분리**

메트릭 수집은 비즈니스 로직이 아닙니다.
관측 주기 변경, 메트릭 추가가 비즈니스 서비스 배포를 트리거하면 안 됩니다.
collector만 배포하면 되므로 메트릭 추가/변경이 분 단위로 가능합니다.

**2. 부하테스트 안정성**

가장 메트릭이 필요한 순간이 부하테스트 중인데, 그때 서버가 가장 바쁩니다.
독립 커넥션 풀(maxConns=3)로 비즈니스 트래픽과 완전 격리됩니다.
서버가 죽어도 메트릭은 계속 수집됩니다.

**3. MSA 대비**

현재 5개 서비스로 분리 완료 상태입니다.
각 서비스에 메트릭 코드를 넣으면 **크로스 서비스 파생 지표**(대기열 대비 잔여 좌석 등) 계산이 불가능합니다.
단일 수집기가 모든 서비스의 DB를 읽어 통합 뷰를 제공합니다.

**4. Go 선택 이유**

- `client_golang`은 Prometheus의 공식 Go 클라이언트 — 가장 성숙하고 문서 풍부
- distroless 바이너리 ~10MB (Java의 1/20), 메모리 ~30MB
- `pgx` 드라이버로 크로스 스키마 JOIN 자유 (JPA entity 매핑 불필요)
- 인프라/DevOps 담당(본인)만 관리하므로 팀 학습 비용 없음

### 아키텍처

```text
PostgreSQL ──┐
             ├── goti-metrics-collector (Go) ──→ :9090/metrics
Redis    ────┘         │
                       │  Alloy ServiceMonitor scrape
                       ↓
                    Alloy → Mimir → Grafana Dashboard
```

### 구현 결과

| 파일 | 줄 수 | 역할 |
|------|-------|------|
| `cmd/collector/main.go` | 156 | 진입점, DB/Redis 연결, graceful shutdown |
| `internal/metrics/registry.go` | 202 | Prometheus 메트릭 25+ 정의 |
| `internal/poller/db_poller.go` | 202 | PostgreSQL 폴링 (좌석/주문/경기) |
| `internal/poller/redis_poller.go` | 64 | Redis 폴링 (대기열/가드레일) |
| `internal/aggregator/aggregator.go` | 100 | 파생 지표 계산 |
| `internal/config/config.go` | 67 | 환경변수 설정 |
| **합계** | **791** | — |

프레임워크 없이 `net/http` + `promhttp`만 사용합니다.
의존성은 `pgx/v5`, `go-redis/v9`, `client_golang` 세 개뿐입니다.

---

## ⚠️ 트레이드오프

**인프라 오버헤드**: ECR 레포, CI/CD 파이프라인, K8s Deployment, ServiceMonitor, NetworkPolicy, AuthorizationPolicy 전부 새로 구축해야 했습니다. 실제로 3-Layer 보안 개통에 1.5세션이 소요됐습니다.

**DB 스키마 결합**: collector가 DB 테이블 구조를 직접 알아야 합니다. 스키마 변경 시 collector도 수정 필요합니다. Read Replica 사용으로 write path에는 영향 없습니다.

**기술 스택 분산**: 팀 전체는 Java/Spring Boot인데 Go 서비스가 하나 추가됩니다. 이 서비스는 인프라 담당자만 관리하므로 팀 학습 비용은 없습니다.

---

## 📚 교훈

### "관측 가능하다"와 "비즈니스를 이해한다"는 다릅니다

CPU, 메모리, 레이턴시가 잘 보인다고 해서 시스템을 이해하는 것은 아닙니다.
"p99 레이턴시가 200ms다"보다 **"좌석 80% 팔렸고, 현재 속도로 3분 후 매진"**이 의사결정에 훨씬 유용합니다.

인프라 메트릭은 "문제가 있다"를 알려주고, 비즈니스 메트릭은 "무엇이 일어나고 있다"를 알려줍니다.

### 메트릭 수집은 비즈니스 코드에 넣지 말자

부하테스트 중에 메트릭이 가장 필요한데, 그때 서버가 가장 바쁩니다.
같은 프로세스에서 집계 쿼리를 돌리면 관측이 시스템을 방해하는 역설이 발생합니다.
관측 로직은 비즈니스 로직과 **물리적으로 분리**하는 것이 맞습니다.

---

## 다음 글 예고

791줄짜리 서비스를 만들었는데, 실제로 Grafana에 메트릭이 뜨기까지는 훨씬 많은 삽질이 필요했습니다.
다음 글에서는 **3-Layer 보안(Istio L7 + NetworkPolicy L3/L4) 개통부터 DB 스키마 불일치까지** E2E 트러블슈팅 과정을 다룹니다.
