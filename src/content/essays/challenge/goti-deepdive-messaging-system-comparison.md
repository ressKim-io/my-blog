---
title: "메시징 시스템 비교 — Kafka · RabbitMQ · Redis Streams의 동작 원리"
excerpt: "순서 보장·내구성·재처리·처리량 측면에서 세 메시징 시스템이 구조적으로 어떻게 다른지, 그리고 각 시스템이 어떤 상황에 적합한지를 설명합니다"
category: challenge
tags:
  - go-ti
  - Kafka
  - RabbitMQ
  - Redis Streams
  - 메시징
  - Consumer Group
  - concept
series:
  name: "goti-deepdive-platform"
  order: 1
date: "2026-03-14"
---

## 한 줄 요약

> Kafka는 디스크 영속 로그로 순서와 재처리를 보장하고, RabbitMQ는 ACK 기반 큐로 정교한 라우팅을 제공하며, Redis Streams는 메모리 우선 구조로 낮은 지연과 원자적 연산에 특화됩니다

---

## 🤔 무엇을 푸는 기술인가

분산 시스템에서 서비스 간 메시지를 전달할 때 가장 먼저 직면하는 문제는 두 가지입니다

첫째, **비동기 분리**입니다
발신자(Producer)와 수신자(Consumer)가 동시에 살아있지 않아도 메시지를 안정적으로 주고받아야 합니다
둘째, **내구성**입니다
서비스 장애가 발생하더라도 메시지가 유실되지 않아야 합니다

이 두 문제를 해결하는 메시징 시스템은 크게 세 가지 계열로 분류됩니다

- **로그 기반 스트리밍** — Kafka로 대표되는 방식. 메시지를 소비해도 디스크에서 삭제하지 않고, Consumer가 자신의 소비 위치(offset)를 추적합니다
- **큐 기반 브로커** — RabbitMQ로 대표되는 방식. 메시지를 Consumer가 ACK(확인)하면 큐에서 삭제합니다
- **메모리 기반 스트림** — Redis Streams로 대표되는 방식. 메모리에 스트림을 유지하며 초저지연 처리에 집중합니다

세 시스템은 동일한 "비동기 메시지 전달" 문제를 푸는 것처럼 보이지만, 내부 저장 모델이 근본적으로 다르기 때문에 순서 보장·내구성·재처리·처리량에서 명확히 구별됩니다

---

## 🔧 동작 원리

### 저장 모델이 모든 것을 결정한다

세 시스템의 차이는 결국 **메시지를 어디에, 어떻게 저장하는가**에서 비롯됩니다

Kafka는 메시지를 **파티션 단위의 불변 추가(append-only) 로그**로 디스크에 기록합니다
Consumer가 메시지를 읽어도 로그는 삭제되지 않습니다
보존 기간(retention)이 지나야 세그먼트가 삭제됩니다
이 구조가 순서 보장·재처리·높은 처리량을 동시에 가능하게 합니다

RabbitMQ는 **큐(AMQP 모델)**를 사용합니다
Exchange가 메시지를 받아 라우팅 규칙(Direct/Fanout/Topic/Headers)에 따라 큐에 배분합니다
Consumer가 메시지를 수신하고 ACK를 보내면 큐에서 즉시 제거됩니다
"소비된 메시지는 사라진다"는 것이 큐 모델의 핵심입니다

Redis Streams는 Redis의 `XADD` 명령으로 스트림에 엔트리를 추가합니다
각 엔트리는 `timestamp-sequence` 형식의 고유 ID를 가집니다
주 저장 공간이 메모리이므로, 디스크 영속성은 AOF(Append Only File)나 RDB 스냅샷에 의존합니다
Kafka의 디스크 우선 전략과 달리 메모리 크기가 실질적 한계입니다

### 파티션 내 순서 보장 — Kafka의 구조적 근거

Kafka가 순서를 보장하는 단위는 **파티션 내부**입니다
토픽 전체가 아닌 파티션 단위임을 정확히 이해해야 합니다

파티션은 물리적으로 디스크의 세그먼트 파일 집합입니다
모든 Producer 쓰기는 해당 파티션의 리더 브로커에 append됩니다
오프셋은 파티션 내에서 단조 증가하는 정수로, 메시지 순서가 오프셋 순서와 일치합니다

같은 좌석(seatId)에 대한 예약·취소 이벤트를 동일 파티션에 몰아넣으려면 **파티션 키**를 사용합니다
`seatId`를 키로 지정하면 동일 `seatId`의 메시지는 항상 동일 파티션에 배치됩니다
Consumer는 해당 파티션만 읽으면 이벤트 순서가 자동으로 보장됩니다

RabbitMQ도 **단일 큐 내에서는** 순서가 보장됩니다
그러나 Consumer가 여럿이고 라운드로빈으로 메시지가 분배되면, Consumer A가 msg1을 처리하는 동안 Consumer B가 msg2를 더 빨리 처리할 수 있습니다
처리 완료 순서와 수신 순서가 달라질 가능성이 있습니다

Redis Streams도 스트림 내 엔트리 추가 순서는 ID 단조 증가로 보장됩니다
단, Consumer Group으로 여러 Consumer가 동시 처리하면 처리 완료 순서는 보장되지 않습니다

### 디스크 영속성과 복제 내구성

![메시징 시스템 저장·소비 모델 비교 — Kafka · RabbitMQ · Redis Streams|tall](/diagrams/goti-deepdive-messaging-system-comparison-1.svg)

위 다이어그램은 세 시스템의 저장 구조와 Consumer 소비 방식을 나란히 비교합니다

**Kafka**는 파티션 로그를 디스크에 기록하고, 복제 팩터 설정으로 리더 파티션 외에 팔로워 N개에 복사본을 유지합니다
ISR(In-Sync Replicas)은 리더와 동기화된 팔로워 목록입니다
`min.insync.replicas=2`로 설정하면 리더 포함 최소 2대가 쓰기를 확인해야 커밋됩니다
브로커 1대가 죽어도 메시지가 유실되지 않습니다
보존 기간은 기본 7일(`log.retention.hours=168`)이며, 기간 내라면 언제든 오프셋을 리셋해 재처리할 수 있습니다

**RabbitMQ**는 Classic Queue와 Quorum Queue 두 방식을 제공합니다
Quorum Queue는 Raft 기반으로 복수 노드에 복제하여 내구성을 보장합니다
Classic Queue는 `durable=true`로 선언해도 단일 노드 장애 시 손실 위험이 있습니다
ACK를 받은 메시지는 큐에서 제거되므로, 이미 소비된 메시지의 재처리는 애플리케이션 수준 재시도 로직이나 Dead Letter Queue(DLQ)로만 가능합니다

**Redis Streams**는 메모리에 데이터를 유지하므로 Redis 프로세스가 재시작되면 AOF 재생이 필요합니다
AOF `fsync=always` 설정으로 내구성을 높일 수 있지만, Kafka의 디스크 우선 저장 대비 구조적으로 취약합니다
`MAXLEN` 옵션으로 스트림 크기를 제한할 수 있어 메모리 관리가 가능하지만, 오래된 메시지는 자동으로 잘립니다

### offset 재처리 vs DLQ

Consumer가 처리 도중 실패했을 때 메시지를 어떻게 다시 처리하는가는 시스템별로 접근이 전혀 다릅니다

Kafka는 **offset을 뒤로 되돌리는** 방식으로 재처리합니다
`kafka-consumer-groups.sh --reset-offsets --to-earliest` 명령으로 특정 Consumer Group의 오프셋을 처음으로 되돌리거나, `--to-offset <n>`으로 특정 위치부터 재처리할 수 있습니다
메시지가 디스크에 그대로 남아 있으므로, 보존 기간 안이라면 몇 번이든 재처리가 가능합니다
이 특성은 이벤트 소싱(Event Sourcing) 패턴과 완벽하게 맞습니다

```bash
# Consumer Group 오프셋을 처음으로 리셋 (재처리)
kafka-consumer-groups.sh \
  --bootstrap-server kafka:9092 \
  --group payment-consumer-group \
  --topic ticket.payment-completed.v1 \
  --reset-offsets --to-earliest \
  --execute
```

RabbitMQ는 Consumer가 NACK(Negative Acknowledgement)를 보내거나 메시지가 만료되면 **Dead Letter Exchange(DLX)**로 메시지를 라우팅합니다
DLX에 연결된 Dead Letter Queue(DLQ)에 실패 메시지가 쌓이고, 별도 Consumer가 DLQ를 모니터링해 재처리합니다
큐에서 이미 ACK된 메시지는 복원할 수 없으므로, 재처리 설계는 DLQ 중심으로 이루어집니다

Redis Streams는 PEL(Pending Entry List)로 재처리를 지원합니다
`XREADGROUP`으로 수신한 메시지 중 `XACK`를 받지 못한 것이 PEL에 남습니다
`XCLAIM` 명령으로 PEL의 메시지 소유권을 다른 Consumer에 이전해 재처리할 수 있습니다
단, 스트림에 `MAXLEN`을 설정하면 오래된 엔트리가 잘려 PEL에만 남고 원본이 없어지는 엣지케이스가 발생합니다

### Consumer Group 동작 방식

세 시스템 모두 "Consumer Group"이라는 개념을 지원하지만 동작이 다릅니다

**Kafka Consumer Group**은 그룹 내 Consumer들이 토픽의 파티션을 나눠 가집니다
파티션 3개, Consumer 3개면 1:1로 배분됩니다
Consumer가 줄거나 늘면 **리밸런싱**이 발생해 파티션 재배분이 이루어집니다
핵심은 파티션 하나를 동시에 두 Consumer가 처리하지 않는다는 점입니다
이것이 파티션 내 순서를 유지하는 방법입니다

**RabbitMQ**는 Consumer Group이라는 개념 대신 여러 Consumer가 동일 큐를 구독합니다
브로커가 라운드로빈으로 메시지를 분배합니다
`prefetch count`를 설정하면 각 Consumer가 미리 가져갈 메시지 수를 제한해 공정한 분배가 가능합니다

**Redis Streams Consumer Group**은 `XGROUP CREATE`로 생성합니다
`XREADGROUP`을 사용하면 같은 그룹 내 Consumer들이 메시지를 중복 없이 분배받습니다
각 메시지는 한 Consumer에만 전달되며, `XACK`로 처리 완료를 알립니다

### 처리량 차이의 구조적 원인

Kafka가 수백만 msg/s를 처리할 수 있는 이유는 아래 세 가지 설계에서 비롯됩니다

첫째, **순차 I/O**입니다
파티션 로그는 항상 끝에 append합니다
디스크에서 순차 쓰기는 랜덤 쓰기보다 수십 배 빠릅니다
RabbitMQ의 큐 구조는 ACK·NACK·삭제가 섞여 랜덤 I/O가 발생합니다

둘째, **배치 전송 및 압축**입니다
Kafka Producer는 `linger.ms`와 `batch.size` 설정으로 메시지를 모아 한꺼번에 전송합니다
네트워크 왕복 횟수가 줄어듭니다
압축(snappy, lz4, zstd)을 적용하면 네트워크 대역폭도 절약됩니다

셋째, **Zero-Copy**입니다
Kafka는 Consumer에게 메시지를 전송할 때 OS의 `sendfile()` 시스템 콜을 활용해 커널 버퍼에서 소켓으로 직접 데이터를 복사합니다
애플리케이션 레이어를 거치지 않으므로 CPU 오버헤드가 최소화됩니다

RabbitMQ는 라우팅 로직(Exchange 규칙 평가), ACK/NACK 처리, 개별 메시지 TTL 관리 등 메시지 단위 처리 비용이 Kafka보다 높습니다
그 대신 복잡한 라우팅 패턴(Direct/Fanout/Topic/Headers)을 브로커 수준에서 처리할 수 있습니다

Redis Streams는 메모리 접근 속도 덕분에 수십만 msg/s를 처리하지만, 데이터 세트 전체가 RAM에 올라가야 합니다
메모리 한계가 처리량의 실질적 상한입니다

---

## 📐 세부 동작과 옵션

### 세 시스템 핵심 지표 비교

| 항목 | Kafka | RabbitMQ | Redis Streams |
|------|-------|----------|---------------|
| 저장 위치 | 디스크 (로그 세그먼트) | 디스크 (큐) | 메모리 (AOF 보조) |
| 순서 보장 | 파티션 내 보장 | 단일 큐 내 보장 | 스트림 내 보장 |
| 내구성 | 복제 팩터 + ISR | Quorum Queue / Classic+Mirroring | AOF/RDB (제한적) |
| 재처리 | offset 리셋 (자유) | DLQ 중심 (ACK 전만) | PEL + XCLAIM (제한적) |
| 처리량 | 수백만 msg/s | 수만 msg/s | 수십만 msg/s |
| Consumer Group | 네이티브 (파티션 기반) | 수동 큐 구독 | XGROUP (스트림 기반) |
| K8s Operator | Strimzi (CNCF) | RabbitMQ Operator | 없음 |
| 학습 곡선 | 높음 | 보통 | 낮음 |
| 운영 복잡도 | 높음 | 보통 | 낮음 |

처리량 수치는 하드웨어와 설정에 따라 다를 수 있으며 공개 벤치마크 기준 대략적 수치입니다

### 시나리오별 적합 시스템

| 시나리오 | 최적 | 근거 |
|----------|------|------|
| 이벤트 소싱 (주문→결제→발권) | Kafka | 순서·내구성·재처리 모두 필요 |
| 도메인 이벤트 (서비스 간 비동기) | Kafka | 다수 Consumer, 이벤트 보존 |
| 작업 큐 (이메일·SMS 발송) | RabbitMQ 또는 Kafka | 단순 라우팅은 RabbitMQ, 내구성 중요하면 Kafka |
| 복잡한 메시지 라우팅 | RabbitMQ | Exchange 패턴 (Direct/Topic/Headers) |
| 실시간 대기열·선점 | Redis | 원자적 연산, 짧은 TTL, 초저지연 |
| 분산 락 | Redis | SETNX / SET NX EX 패턴 |
| 실시간 카운터·순위 | Redis | 단일 스레드 원자성 |
| 로그·지표 파이프라인 | Kafka | 높은 처리량, offset 재처리 |

### Kafka 파티션 수 설계 원칙

파티션 수는 Consumer 병렬성을 결정하므로 처음부터 충분히 설정합니다
파티션 수를 늘리는 것은 가능하지만, 줄이는 것은 데이터 재배치를 수반합니다

파티션 수 결정 기준은 다음과 같습니다

- 파티션 수 ≥ Consumer 수 (파티션 수보다 많은 Consumer는 유휴 상태)
- 예상 처리량 / 브로커당 처리량 목표 = 최소 파티션 수
- 키 카디널리티 고려 — `orderId` 키라면 카디널리티가 높아 균등 분산됩니다

---

## 🧩 go-ti에서는

go-ti는 티켓팅 서비스의 메시징 요구사항을 분석한 끝에 **Kafka + Redis 하이브리드 구조**를 선택했습니다
핵심 이벤트 파이프라인(주문 생성→결제 완료→발권)에는 Kafka를 사용합니다
같은 주문의 이벤트가 같은 파티션에 배치되도록 `orderId`를 파티션 키로 지정해 순서를 보장합니다
실시간 대기열(Virtual Waiting Room)과 좌석 선점 분산 락에는 Redis를 사용합니다
Redis의 원자적 연산과 TTL이 대기열 관리에 적합하기 때문입니다

RabbitMQ는 Strimzi Operator를 통한 K8s-native 관리나 KRaft 기반 운영 단순화 장점을 제공하지 않아 후보에서 제외되었습니다
Redis Streams는 대기열 역할에 이미 Redis를 사용하므로 중복 관리가 필요 없어 별도 도입 대신 Redis 하나에 통합했습니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [Kafka 도입 아키텍처 결정 — Strimzi + KRaft로 선택한 이유](/logs/goti-kafka-adoption-decision-adr)에 정리했습니다

---

## 📚 핵심 정리

- **저장 모델이 특성을 결정합니다** — Kafka는 append-only 디스크 로그, RabbitMQ는 ACK 후 삭제되는 큐, Redis Streams는 메모리 우선 스트림입니다 저장 방식이 순서·내구성·재처리·처리량을 모두 결정합니다
- **순서 보장 단위는 다릅니다** — Kafka는 파티션 내, RabbitMQ는 단일 큐 내, Redis Streams는 스트림 내에서 보장됩니다 토픽/큐 전체가 아님을 명확히 이해해야 합니다
- **재처리 방식이 완전히 다릅니다** — Kafka는 offset 리셋으로 보존 기간 내 언제든 재처리 가능합니다 RabbitMQ는 ACK 전 메시지만 DLQ로 재처리할 수 있습니다 Redis Streams는 PEL+XCLAIM로 제한적으로 지원합니다
- **처리량 차이는 설계 차이입니다** — Kafka의 순차 I/O·배치 전송·Zero-Copy가 수백만 msg/s를 가능하게 합니다 RabbitMQ는 라우팅 로직·ACK 처리 비용이 추가됩니다
- **단일 선택이 아닌 하이브리드가 현실적입니다** — 핵심 이벤트 파이프라인은 Kafka, 실시간 대기열/선점은 Redis, 복잡한 라우팅이 필요한 알림은 RabbitMQ처럼 시나리오별로 최적 시스템을 선택합니다
