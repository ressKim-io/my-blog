---
title: "Strimzi Operator — CRD로 Kafka를 선언적으로 운영하는 방법"
excerpt: "Kubernetes Operator 패턴을 통해 Kafka 클러스터·토픽·사용자를 CRD로 선언하고, reconciliation loop가 실제 상태를 자동으로 수렴시키는 Strimzi의 동작 원리를 설명합니다"
category: kubernetes
tags:
  - go-ti
  - Strimzi
  - operator-pattern
  - CRD
  - reconciliation
  - concept
series:
  name: "goti-deepdive-platform"
  order: 3
date: "2026-03-14"
---

## 한 줄 요약

> Strimzi는 Kubernetes Operator 패턴으로 Kafka 클러스터 전체를 CRD로 선언하고, reconciliation loop가 Git에 정의된 상태와 실제 클러스터를 지속적으로 수렴시키는 K8s-native Kafka 관리 도구입니다

---

## 🤔 무엇을 푸는 기술인가

Kafka를 Kubernetes 위에서 운영하면 곧바로 난관에 부딪힙니다

StatefulSet, PersistentVolumeClaim, ConfigMap, Service, Secret — Kafka 브로커 하나를 띄우는 데 관련된 K8s 리소스가 수십 개입니다 토픽을 생성하려면 컨테이너 내부에서 `kafka-topics.sh` CLI를 실행해야 하고, 브로커 설정을 바꾸면 재시작 순서를 수동으로 관리해야 합니다 Kafka를 "설치"하는 게 아니라 "운영"하는 순간 복잡도가 폭발합니다

이 문제를 해결하는 패턴이 **Kubernetes Operator**입니다 Operator는 특정 애플리케이션의 운영 지식(배포, 스케일, 설정 변경, 장애 복구)을 Kubernetes 컨트롤러 코드로 캡슐화합니다 사람이 수행하던 Day-2 운영 작업을 자동화하는 것이 핵심 목표입니다

**Strimzi**는 Kafka 전용 CNCF Operator입니다 `Kafka`, `KafkaTopic`, `KafkaUser`라는 세 가지 핵심 CRD(Custom Resource Definition)를 제공합니다 운영자는 이 CR을 YAML로 선언하기만 하면, Strimzi Operator가 StatefulSet 생성부터 Rolling Update, 토픽·사용자 관리까지 모두 담당합니다

---

## 🔧 동작 원리

### Kubernetes Operator 패턴이란

Operator 패턴은 두 가지 개념의 결합입니다

- **CRD (Custom Resource Definition)**: K8s API를 확장해 애플리케이션 전용 리소스 타입을 정의합니다 `Kafka`, `KafkaTopic`처럼 Kafka 도메인 언어 그대로 K8s 오브젝트를 선언할 수 있게 됩니다
- **Custom Controller**: 해당 CRD를 watch하며 **reconciliation loop**를 실행하는 컨트롤러입니다 K8s의 내장 컨트롤러(Deployment Controller 등)와 동일한 패턴으로 작동합니다

두 요소를 합치면 Operator가 됩니다 CRD가 "무엇을 원하는가"를 정의하는 인터페이스라면, Custom Controller는 "그 상태를 어떻게 만들 것인가"를 구현하는 실행 엔진입니다

### CRD — 선언적 상태의 정의

Strimzi는 세 가지 핵심 CRD로 Kafka 전체를 선언합니다

**Kafka CR** — 클러스터 자체를 선언합니다 브로커 수, 리소스, 스토리지, 리스너(plain/TLS), 복제 팩터, 로그 보존 기간 등 클러스터 전체 설정이 하나의 YAML에 담깁니다

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: goti-kafka
  namespace: kafka
spec:
  kafka:
    version: "4.2.0"
    replicas: 3
    listeners:
      - name: plain
        port: 9092
        type: internal
        tls: false
    config:
      offsets.topic.replication.factor: 3
      default.replication.factor: 3
      min.insync.replicas: 2
      log.retention.hours: 168
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
  entityOperator:
    topicOperator: {}
    userOperator: {}
```

`entityOperator` 필드가 중요합니다 이 섹션을 선언하면 Strimzi가 **Topic Operator**와 **User Operator**를 함께 배포합니다 이 두 서브-Operator가 각각 `KafkaTopic` CR과 `KafkaUser` CR을 감시합니다

**KafkaTopic CR** — 토픽을 선언합니다 토픽 생성을 위해 더 이상 `kafka-topics.sh --create`를 실행할 필요가 없습니다

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaTopic
metadata:
  name: ticket-order-created-v1
  namespace: kafka
  labels:
    strimzi.io/cluster: goti-kafka
spec:
  partitions: 6
  replicas: 3
  config:
    retention.ms: "604800000"   # 7일
    min.insync.replicas: "2"
```

`strimzi.io/cluster` 레이블이 이 토픽이 어느 Kafka 클러스터에 속하는지 Operator에게 알려줍니다

**KafkaUser CR** — 사용자와 ACL을 선언합니다

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaUser
metadata:
  name: ticket-service
  namespace: kafka
  labels:
    strimzi.io/cluster: goti-kafka
spec:
  authentication:
    type: tls
  authorization:
    type: simple
    acls:
      - resource:
          type: topic
          name: ticket.order-created.v1
        operations: [Read, Write]
      - resource:
          type: group
          name: ticket-consumer-group
        operations: [Read]
```

이 CR을 적용하면 Strimzi User Operator가 TLS 인증서를 자동 발급하고 Kafka ACL을 설정합니다 Secret으로 인증서를 보관하며, 애플리케이션 Pod이 마운트해 사용합니다

### Reconciliation Loop — 핵심 엔진

Strimzi Operator의 핵심은 **reconciliation loop**입니다 이 루프는 세 동작을 반복합니다

1. **Watch**: K8s API Server의 이벤트 스트림을 감시합니다 CR이 생성·변경·삭제되거나, Operator가 관리하는 리소스(StatefulSet, Pod 등)의 상태가 변하면 즉시 알림을 받습니다
2. **Compare**: 현재 Desired State(CR에 선언된 상태)와 Actual State(클러스터에 실제 존재하는 리소스의 상태)를 비교합니다
3. **Act**: 차이가 있으면 조치합니다 — 리소스 생성(Create), 설정 업데이트(Update), 불필요한 리소스 제거(Delete)

![Strimzi Operator Reconciliation Loop — Desired State vs Actual State 수렴|tall](/diagrams/goti-deepdive-strimzi-operator-1.svg)

위 다이어그램은 reconciliation loop의 전체 구조를 보여줍니다 왼쪽의 **Desired State**는 Git에 선언된 CR 명세입니다 오른쪽의 **Actual State**는 Kubernetes에 실제로 존재하는 리소스 상태입니다 Strimzi Operator는 두 상태를 지속적으로 비교하고, 차이가 발생하면 Create·Update·Delete 조치를 실행합니다 조치 결과는 Actual State에 반영되어 다시 비교 대상이 됩니다

중요한 성질이 하나 있습니다 이 루프는 **이벤트 기반 + 주기적** 방식으로 동작합니다 CR 변경 이벤트가 즉시 reconcile을 트리거하면서, 놓친 이벤트를 보완하기 위해 주기적 재확인도 수행합니다 결과적으로 네트워크 일시 장애나 컨트롤러 재시작 후에도 결국 원하는 상태에 수렴합니다 이것이 **eventual consistency** 보장의 메커니즘입니다

### Operator 주도 Rolling Update

Kafka는 일반적인 Deployment와 달리 브로커 재시작 순서가 매우 중요합니다 리더 파티션을 가진 브로커를 먼저 내리면 순간적으로 해당 파티션이 비가용 상태가 됩니다 `min.insync.replicas`(ISR 최솟값) 조건이 맞지 않으면 Producer 쓰기가 실패합니다

Strimzi Operator는 이 복잡성을 내부에서 처리합니다

1. `Kafka` CR의 `config` 섹션을 변경하면 Operator가 변경을 감지합니다
2. Operator가 먼저 해당 브로커의 파티션 리더십을 다른 브로커에게 **이전(leader election)**합니다
3. 리더가 없어진 브로커를 안전하게 재시작합니다
4. 재시작된 브로커가 ISR에 복귀하면 다음 브로커로 이동합니다
5. 모든 브로커가 순차적으로 처리될 때까지 반복합니다

운영자는 단순히 CR을 업데이트하기만 하면 됩니다 어떤 브로커부터 재시작할지, ISR 복구를 어떻게 기다릴지 등 세부 절차는 Operator가 알아서 수행합니다

### GitOps와의 연동 구조

CRD 기반 선언이 강력한 이유는 GitOps와 자연스럽게 통합되기 때문입니다

![GitOps → Strimzi Operator 선언적 운영 흐름|tall](/diagrams/goti-deepdive-strimzi-operator-2.svg)

위 다이어그램은 Git에서 Kafka 클러스터가 만들어지는 전체 흐름을 보여줍니다 Git 저장소에 `Kafka` CR과 `KafkaTopic` CR이 선언되어 있습니다 ArgoCD가 저장소를 주기적으로 감시하다가 변경을 감지하면 K8s API Server에 CR을 apply합니다 K8s API Server가 변경 이벤트를 Strimzi Operator에게 전달하면, Operator의 reconciliation loop가 실행되어 StatefulSet·토픽·사용자를 실제로 생성합니다

왼쪽 패널은 **ArgoCD Sync Wave 순서**를 보여줍니다 Wave 순서가 중요한 이유가 있습니다 Strimzi CRD(`kafka.strimzi.io` 그룹)가 먼저 K8s에 등록되어야(Wave -5) Kafka CR을 apply할 수 있습니다 Strimzi Operator Deployment가 실행 중이어야(Wave -4) reconciliation이 동작합니다 Kafka 클러스터가 준비되어야(Wave 0, ~2-3분 소요) 토픽과 사용자 CR이 의미가 있습니다 이 의존 순서를 Wave 번호로 명시적으로 관리하면, ArgoCD가 각 단계를 순서대로 처리하며 중간에 실패해도 재시도가 안전합니다

이 구조 덕분에 Kafka 클러스터 전체가 Git 히스토리가 됩니다 토픽 하나를 추가하려면 PR을 열고 `KafkaTopic` CR YAML을 추가하면 됩니다 변경 이력, 리뷰, 롤백이 모두 Git 표준 워크플로로 처리됩니다

---

## 📐 세부 동작과 옵션

### Strimzi vs 대안 배포 방식

| 항목 | Strimzi Operator | Bitnami Helm | Confluent Platform |
|------|-----------------|-------------|-------------------|
| 관리 방식 | CRD (Kafka·KafkaTopic·KafkaUser CR) | Helm values | CRD (CFK) |
| Rolling Update | Operator 자동 처리 | StatefulSet 수동 | Operator 자동 |
| 토픽 관리 | KafkaTopic CRD → GitOps 가능 | kafka-topics.sh CLI | CRD |
| 사용자/ACL | KafkaUser CRD | CLI | CRD |
| 라이선스 | Apache 2.0 / CNCF Incubating | Apache 2.0 | 상용 (일부 무료) |
| Kind↔EKS 일관성 | 동일 CRD — 환경 차이 없음 | Helm values 동일 | 동일 CRD |

Bitnami Helm은 StatefulSet을 직접 관리해야 하며, 토픽·사용자를 CLI로만 관리합니다 Git에서 토픽을 선언할 방법이 없으므로 GitOps와 어울리지 않습니다 Confluent Platform은 CRD 방식이지만 상용 라이선스 제약이 있습니다

### KRaft와 Strimzi의 관계

Strimzi가 Kafka를 배포할 때 KRaft 모드를 사용한다면, `Kafka` CR에서 별도로 ZooKeeper 섹션을 선언할 필요가 없습니다 Strimzi 0.46부터 ZooKeeper 모드가 제거되어 KRaft만 지원합니다

Strimzi의 KRaft combined mode에서는 각 브로커 Pod이 `controller`와 `broker` 역할을 모두 수행합니다 `Kafka` CR의 `replicas: 3` 선언 하나로 3개의 KRaft combined Pod이 생성되고, 이들이 메타데이터 합의(KRaft)와 메시지 처리(Broker)를 함께 담당합니다 KRaft 내부 합의 메커니즘 자체에 대해서는 [Kafka KRaft — ZooKeeper를 제거한 자체 합의 메커니즘](/essays/goti-deepdive-kafka-kraft)을 참조하세요

역할 분리가 필요한 대규모 프로덕션에서는 `KafkaNodePool` CR로 Controller 전용 노드와 Broker 전용 노드를 구분 선언합니다

```yaml
# Controller 전용 노드 풀
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: controller
  labels:
    strimzi.io/cluster: goti-kafka
spec:
  replicas: 3
  roles:
    - controller
  storage:
    type: persistent-claim
    size: 20Gi
---
# Broker 전용 노드 풀
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: broker
  labels:
    strimzi.io/cluster: goti-kafka
spec:
  replicas: 5
  roles:
    - broker
  storage:
    type: persistent-claim
    size: 100Gi
```

### Entity Operator — 토픽·사용자 CR의 실행 주체

`entityOperator` 섹션을 Kafka CR에 선언하면 Strimzi가 두 개의 서브-Operator를 배포합니다

**Topic Operator**는 `KafkaTopic` CR을 감시합니다 CR이 생성되면 실제 Kafka 토픽을 생성하고, CR이 삭제되면 토픽을 삭제합니다(옵션에 따라 다름) `spec.partitions`나 `spec.config` 변경도 감지해 실제 토픽 설정에 반영합니다

**User Operator**는 `KafkaUser` CR을 감시합니다 TLS 인증서를 발급하고 K8s Secret으로 저장합니다 `spec.authorization.acls` 변경을 감지해 Kafka 내부 ACL을 업데이트합니다

둘 다 Strimzi Operator와 동일한 reconciliation loop 패턴으로 동작합니다 메인 Operator가 클러스터 레벨을 담당하고, 두 서브-Operator가 각각 토픽과 사용자 레벨을 담당하는 계층 구조입니다

---

## 🧩 go-ti에서는

go-ti는 Strimzi 0.51 + Kafka 4.2.0 조합으로 Kafka 도입을 설계했습니다 배포 방식 선택에서 Strimzi를 고른 핵심 이유는 두 가지였습니다

첫째, **CRD = GitOps 통합**입니다 `Kafka`, `KafkaTopic`, `KafkaUser` CR을 Goti-k8s 저장소에서 관리하면 ArgoCD sync 대상이 됩니다 토픽 추가·삭제가 PR 워크플로로 추적되고, 롤백도 `git revert` 한 번으로 처리됩니다 `kafka-topics.sh`를 직접 실행하는 방식은 Git 이력에 남지 않아 채택하지 않았습니다

둘째, **Kind↔EKS 환경 일관성**입니다 Kind 개발 환경에서 Strimzi `Kafka` CR로 클러스터를 올리고, EKS 프로덕션에서도 동일한 CR 구조를 사용합니다 `values-dev.yaml`과 `values-prod.yaml`로 리소스·스토리지 크기만 달리하고, 운영 방식 자체는 동일합니다

ArgoCD Sync Wave는 `-5(CRD) → -4(Operator) → 0(Kafka CR) → 1(Topic) → 2(User) → 5(앱)`로 설계했습니다 Kafka 클러스터 준비에 2-3분이 소요되므로 Wave 0 이후 Wave 1까지 ArgoCD의 Health Check 대기가 필요합니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(Kafka vs RabbitMQ vs Redis Streams 비교, Strimzi vs Bitnami vs Confluent Platform 비교, 버전 호환성 검증)은
> [Kafka 도입 아키텍처 결정 — Strimzi + KRaft로 선택한 이유](/logs/goti-kafka-adoption-decision-adr)에 정리했습니다

---

## 📚 핵심 정리

- **Operator 패턴 = CRD + Custom Controller**: CRD가 선언적 인터페이스를 제공하고, Custom Controller의 reconciliation loop가 원하는 상태를 실제로 만들어냅니다 Strimzi는 이 패턴의 Kafka 구현입니다
- **세 가지 CRD가 Kafka 전체를 선언**: `Kafka` CR이 클러스터를, `KafkaTopic` CR이 토픽을, `KafkaUser` CR이 사용자와 ACL을 담당합니다 모두 YAML로 Git에서 관리 가능합니다
- **Reconciliation loop의 eventual consistency**: 이벤트 기반 + 주기적 방식으로 동작해 네트워크 장애나 컨트롤러 재시작 후에도 결국 원하는 상태에 수렴합니다
- **Rolling Update를 Operator가 주관**: 운영자는 CR만 변경하면 됩니다 리더십 이전, ISR 대기, 순차 재시작 등 안전한 Rolling Update의 세부 절차는 Strimzi Operator가 자동으로 처리합니다
- **GitOps 연동의 자연스러운 경로**: CRD 선언이 ArgoCD sync 대상이 되어 토픽·사용자 변경이 PR 워크플로로 추적됩니다 Sync Wave로 의존 순서를 명시적으로 관리할 수 있습니다
