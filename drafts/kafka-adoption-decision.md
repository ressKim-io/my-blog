# Kafka 도입 아키텍처 결정 (ADR)

작성일: 2026-03-14
상태: Planned (미구현) — 아키텍처 결정은 완료했으나, 백엔드 팀 역량/일정 이슈로 Kafka 도입은 아직 진행하지 못한 상태.
프로젝트: Goti (대규모 티켓팅 서비스)

---

## Decision Summary

| 결정 항목 | 선택 | 대안 | 핵심 근거 |
|-----------|------|------|-----------|
| 메시징 시스템 | **Kafka** (핵심 이벤트) + Redis (대기열) | RabbitMQ, Redis Streams 단독 | 순서 보장, 내구성, 파티션 병렬성 |
| 배포 방식 | **Strimzi Operator** | Bitnami Helm, Confluent Platform | CRD 기반 K8s-native, ArgoCD 통합, Kind↔EKS 일관성 |
| 합의 프로토콜 | **KRaft** (ZooKeeper 제거) | ZooKeeper | Kafka 4.0+ ZK 완전 제거, 리소스 절감 |
| Kafka 버전 | **4.2.0** | 4.1.0 | Strimzi 0.51 기본값, 최신 안정 |

---

## 1. 왜 Kafka인가 (vs Redis Streams vs RabbitMQ)

### 티켓팅 시스템 요구사항

| 요구사항 | 설명 | 중요도 |
|----------|------|--------|
| 순서 보장 | 같은 좌석에 대한 이벤트는 순서대로 처리 | 필수 |
| 내구성 | 결제/예매 이벤트는 유실 불가 | 필수 |
| 높은 처리량 | 티켓 오픈 시 초당 수만 건 이벤트 | 필수 |
| 재처리 | 장애 복구 시 이벤트 재소비 가능 | 필수 |
| 서비스 간 분리 | MSA 전환 시 비동기 통신 | 필수 |
| 실시간 대기열 | 사용자 대기열 관리 | 중요 |

### 메시징 시스템 비교

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

### 시나리오별 적합도

| 시나리오 | 최적 선택 | 이유 |
|----------|-----------|------|
| 티켓 예매 이벤트 (주문→결제→발권) | **Kafka** | 순서·내구성·재처리 모두 필수 |
| 서비스 간 도메인 이벤트 | **Kafka** | 다수 consumer, 이벤트 소싱 |
| 대기열 (Virtual Waiting Room) | **Redis** | 실시간 카운팅, TTL, 원자적 연산 |
| 좌석 선점 (임시 잠금) | **Redis** | 분산 락, 짧은 TTL |
| 알림 전송 (이메일/SMS) | Kafka 또는 RabbitMQ | 내구성 필요하면 Kafka |

### 결론

**Kafka** (핵심 이벤트 파이프라인) + **Redis** (대기열/선점) **하이브리드 구조**.

- Kafka: 주문→결제→발권 이벤트 체인, 서비스 간 도메인 이벤트, 이벤트 소싱
- Redis: Virtual Waiting Room, 좌석 선점 분산 락, 실시간 카운터

---

## 2. 왜 Strimzi인가 (vs Bitnami vs Confluent)

### 배포 방식 비교

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

### Strimzi 선택 근거

1. **CRD 기반 GitOps**: `Kafka`, `KafkaTopic`, `KafkaUser` CR을 Git에서 관리 → ArgoCD sync
2. **Kind→EKS 일관성**: 동일한 Strimzi CRD로 dev/prod 환경 운영
3. **CNCF Incubating**: 커뮤니티 활성, 장기 지원 보장
4. **Rolling Update 자동화**: Kafka 설정 변경 시 Operator가 브로커 순차 재시작
5. **Bitnami 대비**: StatefulSet 직접 관리 부담 없음, 토픽/사용자 CRD 관리

---

## 3. 왜 KRaft인가 (ZooKeeper 제거)

### ZooKeeper 제거 타임라인

| 시점 | 이벤트 |
|------|--------|
| Kafka 3.3 (2022-10) | KRaft production-ready (KIP-833) |
| Kafka 3.7 (2024-06) | ZooKeeper 마이그레이션 도구 GA |
| **Kafka 4.0 (2025-03-18)** | **ZooKeeper 완전 제거** |
| Strimzi 0.46+ | ZooKeeper 모드 미지원 |
| Kafka 4.2.0 (현재) | KRaft only |

### KRaft 장점

| 항목 | KRaft | ZooKeeper |
|------|-------|-----------|
| 추가 Pod | **없음** (controller 역할 내장) | 3 Pod (~1.5GB RAM) |
| 메타데이터 복제 | Kafka 자체 Raft | 별도 ZK 앙상블 |
| 파티션 수 제한 | **수백만** | ~200K (ZK 부하) |
| 장애 복구 | **빠름** (단일 시스템) | ZK+Kafka 이중 복구 |
| 운영 복잡도 | **낮음** | 높음 (2개 시스템) |

### 결론

새로 도입하는 상황에서 ZooKeeper를 선택할 이유가 없음. Kafka 4.x + Strimzi 0.46+은 KRaft만 지원.

---

## 4. 버전 호환성 매트릭스

### 전체 호환성

```
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

### 호환성 검증 결과

| 조합 | 호환 | 근거 |
|------|------|------|
| Strimzi 0.51 + K8s 1.34 | ✅ | K8s >=1.30 지원 |
| Kafka 4.2.0 + KRaft | ✅ | ZK 제거, KRaft only |
| kafka-clients 3.8.1 + Kafka 4.2.0 broker | ✅ | KIP-896: broker supports client >=2.1 |
| spring-kafka 3.3.x + kafka-clients 3.8.1 | ✅ | Spring Boot 3.5.x 기본 포함 |
| Strimzi + Istio sidecar | ✅ | TCP 포트, mTLS passthrough |
| Strimzi + ArgoCD v3.3 | ✅ | CRD 선언적 관리 |

---

## 5. 환경별 구성 전략

### Kind 개발 환경 (32GB RAM)

```yaml
# Kafka CR 개요
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
  # KRaft combined mode: controller 별도 배포 불필요
  # entityOperator: 토픽/사용자 CRD 관리
  entityOperator:
    topicOperator: {}
    userOperator: {}
```

**리소스 영향 추정:**
- Strimzi Operator: ~512MB
- Kafka 3 broker: ~3-6GB (limits 기준)
- Entity Operator: ~256MB
- **총 추가: ~4-7GB** (32GB 중 여유 충분)

### EKS 프로덕션 (향후)

```
옵션 A: Strimzi on EKS
  - 3 controller (KRaft) + 3~5 broker (역할 분리)
  - 전용 노드 그룹 (r5.xlarge 이상)
  - EBS gp3 볼륨 (IOPS 사전 프로비저닝)
  - Pod Anti-Affinity (AZ 분산)

옵션 B: Amazon MSK
  - 완전 관리형, 운영 부담 최소
  - KRaft 지원 (Kafka 3.7+)
  - 앱 코드 변경 없이 endpoint만 교체
  - Strimzi 대비 비용 높음, 세밀한 설정 제한

권장: 초기 Strimzi → 운영 부담 과다 시 MSK 전환 고려
      (앱 코드는 Kafka Client 표준 API만 사용하므로 전환 용이)
```

---

## 6. 토픽 설계안

### 네이밍 컨벤션

```
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

- **orderId 키**: 같은 주문의 이벤트가 같은 파티션에 배치 → 순서 보장
- **seatId 키**: 같은 좌석의 예약/취소가 순서대로 처리
- **파티션 수**: 초기 3~6, Consumer 수에 맞춰 확장 (파티션 수 ≥ Consumer 수)

---

## 7. Goti-k8s 배포 아키텍처

### ArgoCD Sync Wave 순서

```
Wave -5: Strimzi CRDs (strimzi-kafka-operator chart)
Wave -4: Strimzi Operator Deployment
Wave  0: Kafka CR (클러스터 생성, ~2-3분 소요)
Wave  1: KafkaTopic CRs (토픽 생성)
Wave  2: KafkaUser CRs (사용자/ACL 생성)
Wave  5: Application Deployments (Kafka 의존 서비스)
```

### Goti-k8s 디렉토리 구조 (예상)

```
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

### AppProject 설계

```yaml
# kafka 전용 AppProject
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

---

## 8. 향후 로드맵

### Phase 1: Strimzi + Kafka 클러스터 배포

- Strimzi Operator Helm chart 추가 (Goti-k8s)
- Kafka CR 작성 (Kind dev 환경)
- ArgoCD ApplicationSet에 kafka 앱 추가
- 기본 토픽 생성 및 연결 검증

### Phase 2: Spring Boot Kafka 연동 (MSA 전환 시)

- `spring-kafka` 의존성 추가 (각 서비스)
- Producer/Consumer 구현
- Outbox 패턴 적용 (트랜잭션 보장)
- Dead Letter Topic (DLT) 설정
- OTel Kafka 계측 확인 (자동 계측)

### Phase 3: 고급 기능

- KEDA + Kafka Consumer Lag 기반 오토스케일링
- Schema Registry (Apicurio 또는 Confluent Schema Registry)
- Kafka Connect (외부 시스템 연동 필요 시)
- MirrorMaker 2 (멀티 클러스터, 프로덕션 DR)

---

## 소스

- [Strimzi Documentation](https://strimzi.io/documentation/)
- [Strimzi 0.51.0 Release](https://github.com/strimzi/strimzi-kafka-operator/releases/tag/0.51.0)
- [Apache Kafka 4.0 Release](https://kafka.apache.org/blog/2025/03/18/apache-kafka-4.0.0-release-announcement/)
- [KIP-896: Remove old client protocol API versions](https://cwiki.apache.org/confluence/display/KAFKA/KIP-896)
- [Spring Kafka Reference](https://docs.spring.io/spring-kafka/reference/)
- [CNCF Strimzi](https://www.cncf.io/projects/strimzi/)
