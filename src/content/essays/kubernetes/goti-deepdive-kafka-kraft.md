---
title: "Kafka KRaft — ZooKeeper를 제거한 자체 합의 메커니즘"
excerpt: "Kafka 4.x에서 ZooKeeper를 완전히 제거하고 자체 Raft 기반 합의 프로토콜로 메타데이터를 관리하는 KRaft의 내부 동작 원리를 설명합니다"
category: kubernetes
tags:
  - go-ti
  - Kafka
  - KRaft
  - Raft
  - 분산합의
  - 메타데이터로그
  - concept
series:
  name: "goti-deepdive-platform"
  order: 2
date: "2026-03-14"
---

## 한 줄 요약

> Kafka KRaft는 외부 ZooKeeper에 의존하던 클러스터 메타데이터 관리를 Kafka 내부의 Raft 기반 컨트롤러 쿼럼으로 대체한 합의 메커니즘입니다 Kafka 4.0에서 ZooKeeper 의존성이 완전히 제거되었습니다

---

## 🤔 무엇을 푸는 기술인가

Kafka 클러스터는 단순히 메시지를 저장하고 전달하는 것 이상의 정보를 지속적으로 관리해야 합니다 어떤 토픽이 존재하는지, 각 파티션의 리더 브로커가 누구인지, 현재 복제 동기화 집합(ISR)에 어떤 브로커가 속하는지 — 이런 **클러스터 메타데이터**가 항상 일관성 있게 유지되어야 합니다

KRaft 이전까지 Kafka는 이 메타데이터 관리를 **Apache ZooKeeper**에 위탁했습니다 ZooKeeper는 분산 합의를 제공하는 별도 시스템으로, Kafka 클러스터 외부에 별개의 앙상블(3~5 노드)로 운영됩니다 Kafka 브로커들은 ZooKeeper를 통해 리더 선출을 수행하고, 토픽·파티션 메타데이터를 읽고 씁니다

이 구조에는 구조적인 문제가 세 가지 있었습니다

- **운영 복잡도**: 서로 다른 두 분산 시스템을 동시에 운영해야 합니다 ZooKeeper 장애와 Kafka 장애가 독립적으로 발생하며, 두 시스템의 상태 불일치가 장애로 이어질 수 있습니다
- **파티션 수 한계**: ZooKeeper는 파티션 수가 늘어날수록 부하가 급격히 증가합니다 실무에서는 약 20만 파티션 이상에서 불안정 현상이 보고되었습니다
- **컨트롤러 재시작 지연**: Kafka 컨트롤러(브로커 중 1대가 담당)가 재시작될 때 ZooKeeper에서 모든 파티션 상태를 새로 읽어야 합니다 파티션이 많으면 이 과정이 수분 걸릴 수 있습니다

**KRaft**는 이 문제를 Kafka 자체에 Raft 기반 합의 레이어를 내장함으로써 해결합니다 ZooKeeper라는 외부 의존성을 제거하고, 메타데이터를 Kafka 내부의 특수 토픽(`__cluster_metadata`)에 보관하며, 컨트롤러 역할을 Raft 쿼럼이 직접 담당합니다

---

## 🔧 동작 원리

### ZooKeeper가 하던 일

KRaft를 이해하려면 ZooKeeper가 Kafka에서 담당했던 역할을 먼저 파악해야 합니다

ZooKeeper는 Kafka의 다음 세 가지 역할을 맡았습니다

1. **브로커 등록 및 감지**: 각 브로커가 기동되면 ZooKeeper에 ephemeral 노드를 등록합니다 브로커가 종료되면 ephemeral 노드가 자동 삭제되어 다른 브로커들이 이탈을 감지합니다
2. **컨트롤러 선출**: 브로커 중 하나가 ZooKeeper에 `/controller` ZNode를 먼저 생성하면 컨트롤러가 됩니다 컨트롤러 브로커가 이탈하면 나머지 브로커들이 경쟁적으로 새 `/controller` 노드를 생성합니다
3. **토픽·파티션 메타데이터 저장**: 토픽 설정, 파티션-브로커 할당, ISR 목록을 ZooKeeper 트리 구조에 저장합니다

이 구조에서 Kafka 컨트롤러는 ZooKeeper에 의존하는 **얇은 조율자** 역할이었습니다

### KRaft 컨트롤러 쿼럼

KRaft에서는 일부 또는 전체 브로커가 **컨트롤러 역할**을 겸용하며, 이들이 **쿼럼(quorum)**을 형성합니다 이 쿼럼이 ZooKeeper 앙상블을 대체합니다

컨트롤러 쿼럼은 Raft 프로토콜에 따라 **Active Controller(리더)**와 **Follower Controller** 로 구성됩니다 Active Controller는 메타데이터 변경 요청을 직접 처리하고, Follower는 Active의 변경 내용을 복제합니다

![구조 비교 — ZooKeeper 앙상블(Before) vs KRaft 컨트롤러 쿼럼(After)|tall](/diagrams/goti-deepdive-kafka-kraft-1.svg)

위 다이어그램은 두 구조를 비교합니다 왼쪽(Before)은 ZooKeeper 앙상블 3 Pod과 Kafka Broker 3 Pod이 완전히 분리된 구조입니다 ZK 앙상블에 약 1.5GB RAM이 추가로 필요하고, Broker는 메타데이터 읽기/쓰기를 모두 ZooKeeper에 의존합니다 오른쪽(After)은 KRaft combined mode 구조로, 각 Node 안에 Controller 역할과 Broker 역할이 공존합니다 3 Pod만으로 메시지 처리와 메타데이터 합의를 모두 수행하며, 각 노드가 `__cluster_metadata` 토픽의 로컬 복사본을 보유합니다

### 메타데이터 로그 — __cluster_metadata

KRaft의 핵심은 **메타데이터 로그**입니다 Kafka는 메타데이터를 `__cluster_metadata`라는 내부 토픽에 저장합니다 이 토픽은 단일 파티션으로 구성되며, 파티션 리더가 곧 Active Controller입니다

메타데이터 로그에 기록되는 내용은 일반 토픽의 메시지와 다릅니다 각 레코드는 클러스터 상태 변경 이벤트를 담습니다

- `RegisterBrokerRecord`: 브로커 등록
- `TopicRecord` / `PartitionRecord`: 토픽·파티션 생성
- `PartitionChangeRecord`: ISR 변경, 리더 교체
- `RemoveTopicRecord`: 토픽 삭제

이 레코드들은 오프셋 기반으로 순서가 보장됩니다 새 브로커나 새 컨트롤러가 클러스터에 합류할 때 메타데이터 로그를 처음부터 재생(replay)하면 현재 클러스터 상태를 완전히 복원할 수 있습니다 이것이 ZooKeeper의 스냅샷+로그 방식보다 단순하고 신뢰성 있는 이유입니다

### Raft 기반 복제 흐름

Active Controller가 메타데이터 변경을 처리하는 과정은 다음 단계로 진행됩니다

![KRaft 컨트롤러 쿼럼 — 메타데이터 로그 복제 및 리더 선출 흐름|tall](/diagrams/goti-deepdive-kafka-kraft-2.svg)

다이어그램의 두 섹션을 순서대로 설명합니다

**① 정상 흐름 (Append → Replicate → Commit)**

1. 관리 요청(토픽 생성, 파티션 확장 등)이 Active Controller에 도달합니다
2. Active Controller가 변경 레코드를 로컬 메타데이터 로그에 **append**합니다
3. Follower Controller들이 주기적으로 Active에 **FetchRequest**를 보내 새 레코드를 가져갑니다 이는 일반 Kafka 복제와 동일한 패킷 구조를 사용합니다
4. 과반(quorum majority) 이상의 Follower가 해당 오프셋까지 fetch했음을 fetchOffset으로 확인합니다
5. Active Controller가 해당 오프셋을 **commit**합니다 커밋된 변경은 영속적입니다
6. 커밋된 메타데이터 변경이 모든 Broker의 로컬 메타데이터 캐시에 전파됩니다 Broker들은 이 캐시를 기반으로 토픽/파티션 정보를 조회합니다

**② 장애 복구 (리더 선출)**

Active Controller가 응답하지 않으면 Follower들이 **리더 선출**을 시작합니다 KRaft의 선출 절차는 Raft의 표준 절차를 따릅니다

1. 타임아웃이 만료된 Follower가 자신의 Epoch를 N+1로 올리고 VoteRequest를 브로드캐스트합니다
2. 다른 Follower들이 자신의 메타데이터 로그가 최소한 후보만큼 최신인지 확인하고 VoteGranted를 응답합니다
3. 과반 VoteGranted를 받은 Follower가 새 Active Controller(Epoch N+1)가 됩니다
4. 새 Active Controller가 `BeginQuorumEpoch` 메시지를 브로드캐스트해 나머지 Follower와 Broker에 새 리더를 알립니다

이 전체 과정에서 **ZooKeeper는 전혀 개입하지 않습니다** 메타데이터 합의와 리더 선출이 Kafka 내부에서 완결됩니다

### Epoch 개념 — 스플릿 브레인 방지

Raft에서 **Epoch(임기 번호)**는 스플릿 브레인(split-brain)을 방지하는 핵심 장치입니다 각 메시지와 LeaderEpoch 필드에는 현재 Epoch 번호가 포함됩니다

네트워크 파티션으로 인해 구 Active Controller(Epoch N)와 신 Active Controller(Epoch N+1)가 동시에 존재하는 상황을 가정합니다 구 Controller가 Epoch N으로 메타데이터를 쓰려 시도하면, Follower들은 이미 더 높은 Epoch(N+1)를 알고 있으므로 요청을 거부합니다 클러스터가 두 리더의 쓰기를 동시에 수락하지 않습니다

---

## 📐 세부 동작과 옵션

### Combined Mode vs 역할 분리 Mode

KRaft는 Controller와 Broker 역할을 구성하는 방식에 따라 두 모드를 지원합니다

| 항목 | Combined Mode | 역할 분리 Mode |
|------|--------------|----------------|
| Pod 구성 | Controller + Broker 겸용 | Controller 전용 3+ 대 + Broker 별도 |
| 적합 환경 | 개발·소규모 | 대규모 프로덕션 |
| 리소스 | 적게 사용 | Controller 전용 노드 필요 |
| 장애 격리 | Controller 장애 시 Broker도 영향 | 역할별 독립 장애 격리 |
| 운영 복잡도 | 낮음 | 높음 |
| 파티션 수 | 수십만 이하 권장 | 수백만 지원 |

**Combined Mode**는 컨트롤러와 브로커 역할이 동일 프로세스 안에서 공존합니다 적은 Pod으로 전체 기능을 제공하므로 개발 환경에 적합합니다

**역할 분리 Mode**는 KRaft 컨트롤러만 담당하는 전용 노드(3~5 대)를 따로 두고, 브로커 노드와 완전히 분리합니다 대규모 파티션 환경에서 컨트롤러 부하가 브로커 성능에 영향을 주지 않도록 격리합니다

Strimzi에서 역할 분리는 `Kafka` CR의 `roles` 필드로 선언합니다

```yaml
spec:
  kafka:
    roles:
      - broker
  # Controller 전용 노드 풀 별도 정의
  kafkaNodePools:
    - name: controller
      roles:
        - controller
      replicas: 3
    - name: broker
      roles:
        - broker
      replicas: 5
```

### 파티션 수 한계의 원인과 KRaft의 개선

ZooKeeper 기반 Kafka에서 파티션 수 한계가 발생하는 원인을 이해하면 KRaft의 개선 이유가 명확해집니다

ZooKeeper에서 각 파티션은 별도의 ZNode 경로(`/brokers/topics/{topic}/partitions/{id}/state`)를 가집니다 컨트롤러가 재시작되면 이 ZNode를 모두 순회해 현재 상태를 재구성합니다 파티션이 20만 개라면 20만 번의 ZooKeeper 읽기가 발생합니다 ZooKeeper 자체의 watch 이벤트 폭발도 문제였습니다

KRaft에서는 파티션 상태가 메타데이터 로그에 **오프셋 기반 레코드**로 저장됩니다 컨트롤러 재시작 시 로그를 순차적으로 재생하면 되므로 ZooKeeper watch 폭발이 없습니다 인메모리 메타데이터 캐시(MetadataImage)를 활용하면 수백만 파티션도 빠르게 처리할 수 있습니다

| 항목 | ZooKeeper 기반 | KRaft |
|------|---------------|-------|
| 파티션 수 실용 한계 | ~200,000 | 수백만 |
| 컨트롤러 재시작 시간 | 파티션 수에 비례 (수 분) | 로그 재생으로 단축 |
| 메타데이터 저장 방식 | ZNode 트리 | 오프셋 기반 이벤트 로그 |
| 외부 의존성 | ZooKeeper 앙상블 필요 | 없음 |

결국 ZooKeeper 기반에서의 파티션 한계는 저장 방식의 구조적 차이에서 옵니다 KRaft는 ZNode 랜덤 탐색 대신 순차 로그 재생을 사용하므로, 파티션 수가 늘어도 재시작 비용이 로그 크기에만 비례합니다

---

## 🧩 go-ti에서는

go-ti는 Strimzi 0.51 + Kafka 4.2.0 조합으로 Kafka를 도입했습니다 Kafka 4.x는 ZooKeeper를 완전히 제거했고 Strimzi 0.46부터 ZooKeeper 모드를 지원하지 않으므로, 새로 도입하는 상황에서 KRaft는 선택이 아닌 기본값이었습니다

Kind 개발 환경에서는 Combined Mode(controller+broker 겸용) 3 Pod으로 구성해 ZooKeeper 앙상블 없이 클러스터를 운영합니다 EKS 프로덕션 전환 시에는 3 Controller(KRaft 전용) + 3~5 Broker 역할 분리로 컨트롤러 부하를 격리할 계획입니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(Kafka vs RabbitMQ vs Redis Streams 비교, Strimzi Operator 선택 근거, 버전 호환성 검증)은
> [Kafka 도입 아키텍처 결정 — Strimzi + KRaft로 선택한 이유](/logs/goti-kafka-adoption-decision-adr)에 정리했습니다

---

## 📚 핵심 정리

- **KRaft = Kafka 내장 Raft**: 외부 ZooKeeper를 제거하고 `__cluster_metadata` 토픽과 컨트롤러 쿼럼으로 메타데이터를 관리합니다 Kafka 4.0(2025-03)에서 ZooKeeper 코드가 완전 제거되었습니다
- **메타데이터 로그가 단일 진실 원천**: 클러스터 상태 변경을 오프셋 기반 이벤트 레코드로 순서대로 기록합니다 컨트롤러 재시작 시 로그 재생으로 상태를 복원하므로 ZooKeeper의 watch 폭발 문제가 없습니다
- **Epoch로 스플릿 브레인 방지**: 모든 메타데이터 요청에 Epoch 번호가 포함되어, 네트워크 파티션 상황에서 구 리더의 쓰기를 자동으로 거부합니다
- **Combined vs 역할 분리 선택 기준**: 파티션 수와 운영 규모에 따라 결정합니다 개발 환경은 Combined Mode로 리소스를 절약하고, 대규모 프로덕션은 역할 분리로 컨트롤러 부하를 격리합니다
- **파티션 수 제한 해소**: ZooKeeper 기반에서 약 20만이었던 실용 파티션 한계가 KRaft에서 수백만으로 확장됩니다 이는 ZNode 순회 방식 대신 순차 로그 재생 방식을 쓰기 때문입니다
