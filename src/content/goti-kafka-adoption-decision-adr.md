---
title: "Kafka 도입 아키텍처 결정 — Strimzi + KRaft로 선택한 이유"
excerpt: "50만 동시 접속, p99 200ms 이하를 목표로 한 티켓팅 플랫폼에서 Kafka를 핵심 이벤트 파이프라인으로 채택하고, 배포 방식으로 Strimzi Operator, 합의 프로토콜로 KRaft를 선택한 아키텍처 결정 과정"
category: challenge
tags:
  - go-ti
  - Kafka
  - Strimzi
  - KRaft
  - Architecture Decision Record
  - adr
series:
  name: "goti-kafka"
  order: 1
date: "2026-03-25"
---

## 한 줄 요약

> 50만 동시 접속·p99 200ms 이하를 목표로 한 go-ti 티켓팅 플랫폼에서, 순서 보장·내구성·재처리가 모두 필수인 이벤트 파이프라인에 Kafka를 채택했습니다. 배포는 Strimzi Operator(CNCF, ArgoCD GitOps 통합), 합의 프로토콜은 KRaft(ZooKeeper 완전 제거)를 선택했습니다. 아키텍처 결정은 완료됐으나, 백엔드 팀 일정 이슈로 실제 구현은 Planned 상태입니다.

---

## 배경

go-ti는 삼성·두산 2개 구단을 대상으로 한 대규모 야구 티켓팅 플랫폼입니다.

3대 목표는 **동시 접속 50만**, **API p99 200ms 이하**, **좌석 정합성 100%**였습니다.
티켓 오픈 순간에 수만 건의 이벤트가 폭증하고, 결제와 발권이 순서대로 연결되어야 하며, 관측성 파이프라인(Loki/Tempo)도 스파이크 트래픽 구간에 OOM 없이 버텨야 했습니다.

이 요구사항을 충족하기 위해 **비동기 이벤트 파이프라인 도입**을 결정하고, 메시징 시스템·배포 방식·합의 프로토콜 세 가지 축에서 아키텍처를 결정했습니다.

| 결정 항목 | 선택 | 핵심 근거 |
|-----------|------|-----------|
| 메시징 시스템 | **Kafka** (핵심 이벤트) + Redis (대기열) | 순서 보장, 내구성, 파티션 병렬성 |
| 배포 방식 | **Strimzi Operator** | CRD 기반 GitOps, ArgoCD 통합, Kind↔EKS 일관성 |
| 합의 프로토콜 | **KRaft** (ZooKeeper 제거) | Kafka 4.0+ ZK 완전 제거, 리소스 절감 |
| Kafka 버전 | **4.2.0** | Strimzi 0.51 기본값, 최신 안정 |

아래에서 각 결정의 배경과 기각 이유를 상세히 설명합니다.

---

## 🧭 선택지 비교 — 메시징 시스템

### 티켓팅 시스템 요구사항

먼저 메시징 시스템이 충족해야 할 요구사항을 정의했습니다.

| 요구사항 | 설명 | 중요도 |
|----------|------|--------|
| 순서 보장 | 같은 좌석에 대한 이벤트는 순서대로 처리 | 필수 |
| 내구성 | 결제/예매 이벤트는 유실 불가 | 필수 |
| 높은 처리량 | 티켓 오픈 시 초당 수만 건 이벤트 | 필수 |
| 재처리 | 장애 복구 시 이벤트 재소비 가능 | 필수 |
| 서비스 간 분리 | MSA 전환 시 비동기 통신 | 필수 |
| 실시간 대기열 | 사용자 대기열 관리 | 중요 |

순서 보장·내구성·재처리 세 가지가 모두 필수로 묶이는 것이 이번 결정의 핵심 제약이었습니다.

### 고려한 옵션

| 항목 | Apache Kafka | RabbitMQ | Redis Streams |
|------|-------------|----------|---------------|
| 처리량 | **수백만 msg/s** | 수만 msg/s | 수십만 msg/s |
| 순서 보장 | 파티션 내 보장 | 큐 내 보장 | 스트림 내 보장 |
| 내구성 | **디스크 영속, 복제** | 디스크 영속, 미러링 | AOF/RDB (제한적) |
| 재처리 | **offset 리셋으로 자유로움** | Dead Letter Queue | 제한적 |
| Consumer Group | **네이티브 지원** | 수동 구성 | 지원 |
| K8s Operator | **Strimzi (CNCF)** | RabbitMQ Operator | 없음 |
| 학습 곡선 | 높음 | 보통 | 낮음 |
| 운영 복잡도 | 높음 (Strimzi로 완화) | 보통 | 낮음 |

### 기각 이유

**Redis Streams 단독 기각**: 재처리 기능이 제한적입니다. 장애 복구 시 이벤트를 특정 시점부터 재소비해야 하는 결제 도메인에서는 offset 기반 재처리가 필수입니다. 또한 K8s Operator가 없어 GitOps 관리가 어렵습니다.

**RabbitMQ 기각**: 처리량 자체가 수만 msg/s 수준으로 티켓 오픈 스파이크에 부족하고, Consumer Group을 수동으로 구성해야 합니다. 이벤트 소싱·다수 컨슈머 패턴에서 Kafka보다 불리합니다.

### 결정 기준과 최종 선택

**Kafka를 채택했습니다.**

결정 기준의 우선순위는 다음과 같습니다.

1. **순서 보장 + 내구성 + 재처리의 동시 충족**: 결제→발권 이벤트 체인에서 세 가지가 모두 필수입니다
2. **처리량**: 티켓 오픈 스파이크에서 수백만 msg/s를 감당해야 합니다
3. **K8s Operator 존재 여부**: GitOps 파이프라인(ArgoCD)과의 통합이 요구됩니다

Kafka의 파티션 내 순서 보장, 디스크 영속·복제 기반 내구성, offset 리셋을 통한 자유로운 재처리가 이 기준을 가장 잘 만족합니다.

단, 대기열(Virtual Waiting Room)과 좌석 선점에는 **Redis**를 병행합니다. 실시간 카운팅·TTL·원자적 연산이 필요한 영역에서는 Redis가 적합하기 때문입니다.

| 시나리오 | 선택 | 이유 |
|----------|------|------|
| 티켓 예매 이벤트 (주문→결제→발권) | **Kafka** | 순서·내구성·재처리 모두 필수 |
| 서비스 간 도메인 이벤트 | **Kafka** | 다수 consumer, 이벤트 소싱 |
| 대기열 (Virtual Waiting Room) | **Redis** | 실시간 카운팅, TTL, 원자적 연산 |
| 좌석 선점 (임시 잠금) | **Redis** | 분산 락, 짧은 TTL |
| 알림 전송 (이메일/SMS) | Kafka | 내구성 필요 시 Kafka 우선 |

---

## 🧭 선택지 비교 — Kafka 배포 방식

### 고려한 옵션

| 항목 | Strimzi Operator | Bitnami Helm | Confluent Platform |
|------|-----------------|-------------|-------------------|
| 관리 방식 | **CRD (Kafka CR, KafkaTopic CR)** | Helm values | CRD (CFK) |
| K8s 통합 | K8s-native, Operator 패턴 | StatefulSet 직접 관리 | K8s-native |
| Rolling Update | **Operator 자동 관리** | 수동 StatefulSet | Operator 자동 |
| 토픽 관리 | **KafkaTopic CRD** (GitOps) | kafka-topics CLI | CRD |
| 사용자 관리 | KafkaUser CRD | CLI | CRD |
| 라이선스 | **Apache 2.0** | Apache 2.0 | 상용 (일부 무료) |
| CNCF | **Incubating** | - | - |
| Kind↔EKS 일관성 | **동일 CRD** | 동일 Helm | 동일 CRD |
| ArgoCD 통합 | **CRD = 선언적 관리** | values만 | CRD = 선언적 |

### 기각 이유

**Bitnami Helm 기각**: StatefulSet을 직접 관리해야 합니다. 토픽·사용자 생성이 CLI 기반이라 GitOps 파이프라인과 통합하려면 별도 스크립트가 필요합니다. Strimzi의 `KafkaTopic` CRD처럼 Git에서 선언적으로 관리할 수 없습니다.

**Confluent Platform 기각**: CRD 기반 선언적 관리는 가능하지만 라이선스가 상용입니다. go-ti는 포트폴리오·시연 목적이므로 비용 부담이 없는 Apache 2.0 라이선스가 필요했습니다.

### 결정 기준과 최종 선택

**Strimzi Operator를 채택했습니다.**

결정 기준의 우선순위는 다음과 같습니다.

1. **GitOps 통합**: `Kafka`, `KafkaTopic`, `KafkaUser` CR을 Git에서 선언적으로 관리하고 ArgoCD가 sync해야 합니다
2. **Kind↔EKS 환경 일관성**: dev(Kind)와 prod(EKS) 간 동일한 CRD를 사용해 환경 차이를 최소화해야 합니다
3. **라이선스 및 커뮤니티**: 장기 지원이 보장되는 오픈소스여야 합니다

Strimzi는 이 기준을 모두 만족합니다. CNCF Incubating 프로젝트로 커뮤니티가 활성화되어 있고, Rolling Update도 Operator가 브로커 순차 재시작으로 자동 처리합니다.

---

## 🧭 선택지 비교 — 합의 프로토콜

### ZooKeeper 제거 타임라인

Kafka의 합의 프로토콜 선택은 버전 흐름으로 이해하는 것이 가장 명확합니다.

| 시점 | 이벤트 |
|------|--------|
| Kafka 3.3 (2022-10) | KRaft production-ready (KIP-833) |
| Kafka 3.7 (2024-06) | ZooKeeper 마이그레이션 도구 GA |
| **Kafka 4.0 (2025-03-18)** | **ZooKeeper 완전 제거** |
| Strimzi 0.46+ | ZooKeeper 모드 미지원 |
| Kafka 4.2.0 (현재) | KRaft only |

Kafka 4.0에서 ZooKeeper가 완전히 제거되었고, Strimzi 0.46부터 ZooKeeper 모드를 지원하지 않습니다. 이번에 사용하는 Strimzi 0.51 + Kafka 4.2.0 조합에서는 선택지가 사실상 KRaft 하나입니다.

### ZooKeeper 대비 KRaft 장점

| 항목 | KRaft | ZooKeeper |
|------|-------|-----------|
| 추가 Pod | **없음** (controller 역할 내장) | 3 Pod (~1.5GB RAM) |
| 메타데이터 복제 | Kafka 자체 Raft | 별도 ZK 앙상블 |
| 파티션 수 제한 | **수백만** | ~200K (ZK 부하) |
| 장애 복구 | **빠름** (단일 시스템) | ZK+Kafka 이중 복구 |
| 운영 복잡도 | **낮음** | 높음 (2개 시스템) |

새로 도입하는 상황에서 ZooKeeper를 선택할 이유가 없습니다. ZooKeeper 앙상블 3 Pod은 약 1.5GB RAM을 추가로 소비하고, 장애 발생 시 ZK와 Kafka 두 시스템을 동시에 복구해야 하는 운영 부담이 있습니다.

KRaft는 Kafka 자체 Raft로 메타데이터를 복제하므로 단일 시스템만 관리하면 됩니다.

---

## 버전 호환성

실제 구현 전에 스택 전체의 호환성을 검증했습니다.

```text
Strimzi 0.51.0 ── Kafka 4.1.0, 4.2.0 (default)
    │                  │
    ├─ K8s >=1.30 ✅ (1.34 호환)
    │
    ├─ Istio 1.29 sidecar ✅ (TCP 포트 기반, 프로토콜 간섭 없음)
    │
    └─ OTel Operator ✅ (Kafka JMX → Prometheus Exporter)

Spring Boot 3.5.x
    ├─ spring-kafka 3.3.x
    │       └─ kafka-clients 3.8.1
    │               └─ Kafka 4.x broker backward compatible ✅
    │                  (KIP-896: broker 4.x supports client >=2.1)
    │
    └─ OTel Java Agent 2.25.0 (Kafka 계측 포함)
```

| 조합 | 호환 | 근거 |
|------|------|------|
| Strimzi 0.51 + K8s 1.34 | ✅ | K8s >=1.30 지원 |
| Kafka 4.2.0 + KRaft | ✅ | ZK 제거, KRaft only |
| kafka-clients 3.8.1 + Kafka 4.2.0 broker | ✅ | KIP-896: broker supports client >=2.1 |
| spring-kafka 3.3.x + kafka-clients 3.8.1 | ✅ | Spring Boot 3.5.x 기본 포함 |
| Strimzi + Istio sidecar | ✅ | TCP 포트, mTLS passthrough |
| Strimzi + ArgoCD v3.3 | ✅ | CRD 선언적 관리 |

특히 Spring Boot 3.5.x에 기본 포함된 kafka-clients 3.8.1이 Kafka 4.2.0 브로커와 하위 호환된다는 점이 중요합니다. 클라이언트 버전을 올리지 않아도 브로커 4.x에 연결할 수 있습니다 (KIP-896 보장).

---

## 환경별 구성 전략

### Kind 개발 환경 (32GB RAM)

KRaft combined mode를 사용하면 controller와 broker 역할을 동일 Pod에서 겸용하므로 개발 환경에서 리소스를 아낄 수 있습니다.

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
spec:
  kafka:
    version: "4.2.0"
    replicas: 3          # combined mode: controller + broker 겸용
    listeners:
      - name: plain
        port: 9092
        type: internal
        tls: false
      - name: tls
        port: 9093
        type: internal
        tls: true
    config:
      offsets.topic.replication.factor: 3
      transaction.state.log.replication.factor: 3
      transaction.state.log.min.isr: 2
      default.replication.factor: 3
      min.insync.replicas: 2
      log.retention.hours: 168        # 7일
      num.partitions: 3
    storage:
      type: persistent-claim
      size: 10Gi
    resources:
      requests:
        memory: 1Gi
        cpu: 200m
      limits:
        memory: 2Gi
        cpu: 500m
  # entityOperator: 토픽/사용자 CRD 관리
  entityOperator:
    topicOperator: {}
    userOperator: {}
```

리소스 영향 추정입니다.

- Strimzi Operator: ~512MB
- Kafka 3 broker (combined mode): ~3~6GB (limits 기준)
- Entity Operator: ~256MB
- 총 추가: ~4~7GB (32GB 중 여유 충분)

### EKS 프로덕션 — Strimzi vs MSK

프로덕션 배포 전략은 두 가지 옵션을 검토했습니다.

**옵션 A — Strimzi on EKS**

```text
- 3 controller (KRaft) + 3~5 broker (역할 분리)
- 전용 노드 그룹 (r5.xlarge 이상)
- EBS gp3 볼륨 (IOPS 사전 프로비저닝)
- Pod Anti-Affinity (AZ 분산)
```

직접 운영하므로 세밀한 설정이 가능하지만, 운영 부담이 존재합니다.

**옵션 B — Amazon MSK**

```text
- 완전 관리형, 운영 부담 최소
- KRaft 지원 (Kafka 3.7+)
- 앱 코드 변경 없이 endpoint만 교체
- Strimzi 대비 비용 높음, 세밀한 설정 제한
```

앱 코드는 Kafka Client 표준 API만 사용하므로 전환 비용이 낮습니다.

**권장 전략**: 초기에는 Strimzi로 시작합니다. 운영 부담이 과도할 경우 MSK 전환을 고려합니다. 앱 코드가 Kafka Client 표준 API에만 의존하므로 endpoint만 바꾸면 전환이 가능합니다.

---

## 토픽 설계

### 네이밍 컨벤션

```text
{domain}.{event-type}.{version}

예:
  ticket.order-created.v1
  ticket.payment-completed.v1
  ticket.seat-reserved.v1
  user.registered.v1
  notification.email-requested.v1
```

### 도메인별 토픽

| 토픽 | 파티션 | 키 | 리텐션 | 용도 |
|------|--------|-----|--------|------|
| `ticket.order-created.v1` | 6 | orderId | 7일 | 주문 생성 이벤트 |
| `ticket.payment-completed.v1` | 6 | orderId | 7일 | 결제 완료 이벤트 |
| `ticket.seat-reserved.v1` | 6 | seatId | 7일 | 좌석 예약 이벤트 |
| `ticket.issued.v1` | 6 | orderId | 30일 | 발권 완료 이벤트 |
| `ticket.cancelled.v1` | 6 | orderId | 30일 | 취소 이벤트 |
| `user.registered.v1` | 3 | userId | 30일 | 사용자 가입 |
| `notification.email-requested.v1` | 3 | userId | 3일 | 이메일 발송 요청 |
| `resale.listed.v1` | 3 | ticketId | 7일 | 양도 등록 |

### 키 전략

파티션 키 설계가 순서 보장의 핵심입니다.

- **orderId 키**: 같은 주문의 이벤트가 같은 파티션에 배치되어 처리 순서가 보장됩니다
- **seatId 키**: 같은 좌석의 예약·취소 이벤트가 순서대로 처리됩니다
- **파티션 수**: 초기 3~6으로 시작하며, Consumer 수에 맞춰 확장합니다 (파티션 수 ≥ Consumer 수 유지)

---

## ArgoCD 배포 설계

### Sync Wave 순서

Strimzi Operator → Kafka 클러스터 → 토픽/사용자 → 애플리케이션의 순서가 중요합니다. CRD가 먼저 설치되어야 Kafka CR을 적용할 수 있습니다.

```text
Wave -5: Strimzi CRDs (strimzi-kafka-operator chart)
Wave -4: Strimzi Operator Deployment
Wave  0: Kafka CR (클러스터 생성, ~2-3분 소요)
Wave  1: KafkaTopic CRs (토픽 생성)
Wave  2: KafkaUser CRs (사용자/ACL 생성)
Wave  5: Application Deployments (Kafka 의존 서비스)
```

### AppProject 설계

Kafka 전용 AppProject를 분리해 Strimzi CRD에 대한 접근 권한을 명시적으로 정의합니다.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: kafka
spec:
  sourceRepos:
    - 'https://github.com/Team-Ikujo/Goti-k8s.git'
    - 'https://strimzi.io/charts/'
  destinations:
    - namespace: kafka
      server: https://kubernetes.default.svc
  clusterResourceWhitelist:
    - group: 'kafka.strimzi.io'
      kind: '*'
    - group: 'core.strimzi.io'
      kind: '*'
```

### 디렉토리 구조

```text
charts/
  strimzi-operator/          # Strimzi Operator Helm chart wrapper
    Chart.yaml
    values.yaml
    values-dev.yaml
  kafka-cluster/             # Kafka CR + Topic/User CRs
    Chart.yaml
    templates/
      kafka.yaml             # Kafka CR
      topics.yaml            # KafkaTopic CRs
    values.yaml
    values-dev.yaml
```

---

## 향후 로드맵

### Phase 1 — Strimzi + Kafka 클러스터 배포

- Strimzi Operator Helm chart 추가 (Goti-k8s)
- Kafka CR 작성 (Kind dev 환경)
- ArgoCD ApplicationSet에 kafka 앱 추가
- 기본 토픽 생성 및 연결 검증

### Phase 2 — Spring Boot Kafka 연동 (MSA 전환 시)

- `spring-kafka` 의존성 추가 (각 서비스)
- Producer/Consumer 구현
- Outbox 패턴 적용 (트랜잭션 보장)
- Dead Letter Topic (DLT) 설정
- OTel Kafka 계측 확인 (자동 계측)

### Phase 3 — 고급 기능

- KEDA + Kafka Consumer Lag 기반 오토스케일링
- Schema Registry (Apicurio 또는 Confluent Schema Registry)
- Kafka Connect (외부 시스템 연동 필요 시)
- MirrorMaker 2 (멀티 클러스터, 프로덕션 DR)

---

## 📚 배운 점

- **메시징 시스템 선택은 요구사항의 교집합으로**: 순서 보장·내구성·재처리 세 조건을 동시에 충족하는 시스템이 Kafka뿐이었습니다. 운영 복잡도가 높더라도 요구사항이 요구한다면 선택이 명확해집니다
- **모든 영역을 같은 시스템으로 해결하려 하지 않는다**: 대기열·좌석 선점처럼 실시간 원자적 연산이 필요한 영역은 Redis가 더 적합합니다. Kafka와 Redis의 하이브리드 구조가 현실적인 답입니다
- **Kafka 4.x 신규 도입이라면 KRaft만**: ZooKeeper 앙상블은 ~1.5GB RAM과 이중 복구 부담을 추가합니다. Kafka 4.0에서 완전 제거된 이상 새 클러스터에서 ZooKeeper를 선택할 이유가 없습니다
- **Strimzi의 GitOps 통합이 핵심**: `KafkaTopic` CRD는 토픽 설정을 Git으로 선언적 관리하게 해줍니다. CLI 기반 토픽 관리는 드리프트가 발생하기 쉽습니다
- **앱 코드를 표준 API에만 묶어두면 이후 유연성이 생긴다**: Kafka Client 표준 API만 사용하면 Strimzi → MSK 전환 시 endpoint 교체만으로 충분합니다. 벤더 종속 기능 사용은 전환 비용을 높입니다

---

## 참고

- [Strimzi Documentation](https://strimzi.io/documentation/)
- [Strimzi 0.51.0 Release](https://github.com/strimzi/strimzi-kafka-operator/releases/tag/0.51.0)
- [Apache Kafka 4.0 Release Announcement](https://kafka.apache.org/blog/2025/03/18/apache-kafka-4.0.0-release-announcement/)
- [KIP-896: Remove old client protocol API versions](https://cwiki.apache.org/confluence/display/KAFKA/KIP-896)
- [Spring Kafka Reference](https://docs.spring.io/spring-kafka/reference/)
- [CNCF Strimzi](https://www.cncf.io/projects/strimzi/)
