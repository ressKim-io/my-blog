---
title: "reconcile — 캐시가 방금 보낸 쓰기를 아직 모를 때"
excerpt: "워크큐의 dirty·processing, ReplicaSet의 expectations와 쓰기 버전 확인, 입양과 재시도, Lease 리더 선출이 각각 어떤 어긋남을 다루는지 설명합니다"
category: kubernetes
tags: [Kubernetes, Reconcile, Workqueue, ReplicaSet, concept]
series:
  name: "k8s-theory-api"
  order: 13
date: "2026-08-09"
---

ReplicaSet이 Pod 세 개를 생성하는 요청을 보냈다고 가정하겠습니다
API 서버는 생성에 성공했지만 watch가 아직 따라잡지 못했다면, 로컬 캐시에서는 여전히 Pod가 0개로 보일 수 있습니다
그 상태로 다시 조정하면 같은 생성 요청을 반복할 위험이 있습니다

[informer의 초기 동기화](/essays/k8s-theory-informer)를 기다리는 것만으로 이 시간차가 사라지지는 않습니다
워크큐는 같은 큐 안에서 같은 키의 동시 처리를 막습니다
expectations는 생성·삭제 요청에 따른 자식 이벤트를 얼마나 더 관찰해야 하는지 기록합니다
리더 선출은 여러 프로세스 중 리더를 정합니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> Pod 개수와 처리 순서는 설명을 위한 가정이며, 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## 큐에는 다시 읽을 대상의 키를 넣습니다

ReplicaSet 컨트롤러의 워크큐에는 이벤트 당시의 오브젝트 대신 `namespace/name` 키를 넣습니다
워커는 키를 꺼낸 뒤 캐시에서 현재 오브젝트와 자식을 다시 읽습니다
reconcile은 그 상태와 원하는 상태를 비교해 필요한 조정을 수행하는 작업입니다

워크큐에는 두 집합이 있습니다
`dirty`는 처리가 필요한 키를, `processing`은 워커가 현재 처리 중인 키를 기억합니다

![같은 키를 처리하는 동안 여러 Add가 들어와도 dirty에 한 번 기록하고 Done 이후 한 번 다시 큐에 넣는 흐름](/diagrams/k8s-theory-reconcile-1.svg)

`Get()`은 키를 `processing`으로 옮기고 `dirty`에서 지웁니다
처리 도중 같은 키에 `Add()`가 오면 `dirty`에는 기록하지만, 즉시 다른 워커에게 전달하지 않습니다
`Done()`이 호출됐을 때 그 키가 다시 dirty라면 큐에 한 번 더 넣습니다

같은 처리 구간에 `Add()`가 여러 번 와도 재처리할 키는 집합에 한 번만 남습니다
이 보장은 **같은 큐 인스턴스를 올바르게 사용하는 워커들 사이**의 동시 처리를 막습니다
다른 프로세스의 큐나 별도로 만든 큐까지 직렬화하지는 않습니다

구현은 [`Typed.Add`·`Get`·`Done`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/util/workqueue/queue.go)에 있습니다
처리가 끝나면 `Done()`을 호출해야 하며, 재시도 이력을 지우는 `Forget()`은 다른 역할입니다

## 지금, 나중에, 실패 후에 다시 넣는 경로가 다릅니다

| 경로 | 메서드 | 의미 |
|---|---|---|
| 기본 큐 | `Add` | 지금 처리가 필요하다고 표시 |
| 지연 큐 | `AddAfter(key, duration)` | 지정한 시간 뒤 기본 큐에 추가 |
| 재시도 제한 큐 | `AddRateLimited` | rate limiter가 계산한 지연 뒤 추가 |

실패만 재처리 이유가 되는 것은 아닙니다
ReplicaSet은 `minReadySeconds`를 충족해 가용해졌는지 다시 확인하려고 `AddAfter`를 사용합니다
Pod가 Ready가 된 시점과 충분히 오래 Ready였다는 판단 시점이 다르기 때문입니다

[`syncReplicaSet`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/replicaset/replica_set.go)은 가용성 재확인 시점을 계산하고, [`AddRateLimited`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/util/workqueue/rate_limiting_queue.go)는 limiter의 지연값을 `AddAfter`에 넘깁니다

## expectations는 요청에 따른 자식 이벤트를 기다립니다

같은 키의 동시 처리를 막아도 캐시 지연으로 인한 중복 조정은 남습니다
두 reconcile이 순서대로 실행됐더라도, 둘 다 아직 0개인 사본을 읽을 수 있기 때문입니다

ReplicaSet은 생성 요청을 보내기 전에 `ExpectCreations`로 기다릴 생성 이벤트 수를 기록합니다
Pod 생성 알림이 핸들러에 도착하면 `CreationObserved`가 이 기대 개수를 줄입니다
다음 reconcile에서는 `SatisfiedExpectations`로 기대한 자식 이벤트를 모두 관찰했는지 확인합니다

![생성 요청 전에 기대 수를 기록하고 생성 응답과 별도로 watch 관찰을 기다린 뒤 다음 조정을 허용하는 흐름](/diagrams/k8s-theory-reconcile-2.svg)

예를 들어 세 개를 만들기로 했다면 먼저 기대 수를 3으로 둡니다
생성 이벤트 세 개를 관찰하면 기대 수가 0이 되어 다음 복제본 수 조정을 진행할 수 있습니다
기대가 아직 남아 있다면 `manageReplicas`를 건너뜁니다

이때 전체 reconcile이 곧바로 끝나는 것은 아닙니다
앞의 캐시 일관성 검사·조회·소유권 판정이 성공하면 status 계산과 갱신 경로는 계속 진행합니다
status도 캐시가 아는 상태를 반영하므로, 아직 안 보이는 Pod를 이미 관찰한 것처럼 세지는 않습니다

expectations는 프로세스 메모리에 있는 임시 기록입니다
[`ExpectationsTimeout`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/controller_utils.go)은 5분이며, 만료된 뒤 `SatisfiedExpectations`를 다시 호출하면 통과시킵니다
기록이 없거나 내부 조회 오류가 발생한 경우도 조정을 허용하는 분기가 있습니다

**5분이 지나면 자동으로 키가 큐에 들어간다는 뜻은 아닙니다**
만료는 다음 검사에서 적용하는 조건이므로, 실제 재처리 시점에는 다른 이벤트나 재예약도 필요합니다

생성 요청 일부가 실패하거나 slow start 때문에 보내지 못했다면, 오지 않을 이벤트 수만큼 기대 개수를 줄입니다
이렇게 해야 실패한 요청에서 발생하지 않을 생성 이벤트를 계속 기다리지 않습니다

삭제는 개수만으로 구분하기 어렵습니다
유예 삭제에서는 `deletionTimestamp`가 설정되는 update와 실제 delete가 둘 다 들어올 수 있습니다
`UIDTrackingControllerExpectations`는 삭제 대상으로 정한 자식 키를 기억해 같은 삭제를 두 번 세지 않습니다
타입 이름에 UID가 들어 있지만 ReplicaSet이 넘기는 `PodKey`는 `namespace/name`입니다

## v1.37.1은 기록한 쓰기 버전도 확인합니다

현행 ReplicaSet에는 expectations 외에 **자신이 쓴 버전까지 캐시가 따라왔는지 확인하는 경로**도 있습니다
`StaleControllerConsistencyReplicaSet`이 켜지면 consistency store가 Pod·ReplicaSet 쓰기의 resourceVersion을 기록합니다
이 기능은 v1.36부터 Beta·기본 true이며 `AtomicFIFO`에 의존합니다

다음 `syncReplicaSet`은 부모를 읽기 전에 `EnsureReady()`를 호출합니다
기록한 쓰기 버전보다 해당 리소스 캐시의 `LastStoreSyncResourceVersion()`이 오래됐으면 오류를 반환하고 재시도합니다
이 경우에는 뒤의 expectations·소유권 판정·status 갱신까지 도달하지 않습니다

| 검사 | 기억하는 것 | 기다리는 기준 |
|---|---|---|
| expectations | 요청한 생성·삭제의 관찰 수와 삭제 키 | 기대한 자식 이벤트를 관찰했는지 |
| consistency store | 리소스별로 기록한 쓰기 resourceVersion | 캐시가 그 버전 이상까지 반영했는지 |

`RealPodControl`은 생성 및 관련 patch 성공 시 callback으로 버전을 기록하고, ReplicaSet status 갱신 뒤에도 버전을 기록합니다
모든 API 쓰기를 포괄하는 영구 기록은 아니며, 기능을 끄면 아무 일도 하지 않는 구현을 사용합니다
추적하지 않는 리소스이거나 캐시 버전이 비어 있거나 버전 비교에서 오류가 나면 검사를 건너뛰는 경로도 있습니다

실제 동작은 [`NewReplicaSetController`와 `syncReplicaSet`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/replicaset/replica_set.go), [`ConsistencyStore`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/util/consistency/consistency.go), [기능 기본값과 의존성](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go)에 있습니다
두 장치 모두 캐시가 서버의 전역 최신 상태를 항상 반영한다고 보장하지는 않습니다

## 생성 요청은 작은 배치부터 늘립니다

ReplicaSet은 부족한 Pod를 한꺼번에 모두 생성하지 않습니다
첫 배치는 1개이며, 배치 전체가 성공하면 다음 배치를 두 배로 늘립니다
한 번의 수 조정은 설정된 `burstReplicas`까지 제한하며, 기본 상수 `BurstReplicas`는 500입니다

쿼터가 부족해 모든 생성이 같은 이유로 실패하는 상황을 생각하면 이유가 보입니다
첫 요청이 실패했는데 나머지 수백 개까지 보내면 같은 실패 요청과 Event만 늘어납니다
`slowStartBatch`는 진행 중인 배치를 마친 뒤 실패가 하나라도 있으면 다음 배치를 보내지 않습니다

같은 배치 안의 요청은 병렬로 실행될 수 있습니다
따라서 언제나 딱 한 번의 실패만 생긴다는 뜻은 아니며, **첫 1개 배치가 실패했을 때** 한 번에서 멈춥니다
보내지 않았거나 실패한 요청 수는 expectations의 대기 개수에서도 뺍니다

[`manageReplicas`와 `slowStartBatch`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/replicaset/replica_set.go)는 요청량 제한과 관찰 대기 수 조정을 함께 처리합니다
Namespace가 종료 중인 오류에는 별도 분기가 있으므로 모든 생성 오류를 같은 처리로 단정하지 않습니다

## 입양 전에는 부모를 API 서버에서 다시 읽습니다

selector가 맞는 고아 Pod는 [ReplicaSet이 입양할 수 있습니다](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/workloads/controllers/replicaset.md#non-template-pod-acquisitions)
입양은 해당 Pod에 `ownerReferences`를 추가하는 patch입니다

| 소유 관계 | selector 일치 | selector 불일치 |
|---|---|---|
| 이 ReplicaSet의 자식 | 유지 | 소유 참조를 제거해 방출 |
| 다른 controller의 자식 | 변경하지 않음 | 변경하지 않음 |
| controller 참조가 없는 고아 | 조건을 확인하고 입양 | 변경하지 않음 |

부모가 삭제 중이면 새 입양이나 방출을 하지 않습니다
이미 소유하며 selector도 맞는 자식은 새로운 patch 없이 그대로 유지할 수 있습니다
삭제 중인 고아나 namespace가 다른 고아도 입양하지 않습니다

입양 patch는 `controller: true`, `blockOwnerDeletion: true`와 자식의 UID를 넣습니다
부모가 누구인지 표시하고, foreground 삭제에서 자식이 부모의 삭제를 막는 관계를 기록하며, 이름이 재사용된 다른 Pod를 잘못 수정하지 않도록 합니다
방출은 자기 소유 참조를 제거하는 patch이며, 해당 Pod가 없거나 UID가 달라 생기는 일부 404·422 오류는 무시하는 경로가 있습니다

첫 입양 직전에는 부모를 lister 캐시 대신 API 서버에서 직접 읽습니다
캐시에 남은 부모가 실제로는 이미 삭제 중이거나 같은 이름의 다른 객체일 수 있기 때문입니다
조회한 부모의 UID가 같고 `deletionTimestamp`가 없는지 다시 확인합니다

이 확인은 `PodControllerRefManager` 인스턴스당 입양을 시도할 때 한 번입니다
각 reconcile에서 새 manager를 만들므로, 컨트롤러의 전체 수명 동안 딱 한 번만 확인하는 것은 아닙니다

[`ClaimObject`·`AdoptPod`·`CanAdopt`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/controller_ref_manager.go)와 [`claimPods`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/replicaset/replica_set.go)가 이 순서를 구현합니다
직접 읽기가 부모 조회와 자식 patch를 하나의 원자적 트랜잭션으로 만드는 것은 아닙니다

## 실패 재시도의 기본 지연은 두 제한 중 긴 쪽입니다

ReplicaSet이 사용하는 `DefaultTypedControllerRateLimiter`는 키별 실패 이력과 큐 전체의 재시도 예약을 함께 제한합니다

| 제한 | 기본 동작 |
|---|---|
| 키별 지수 백오프 | 첫 실패 5ms, 이후 두 배씩 증가, 최대 1,000초 |
| 전체 토큰 버킷 | 초당 10개, 버스트 100개 |

두 제한이 계산한 지연 중 긴 쪽을 사용합니다
성공 후 `Forget()`을 호출하면 해당 키의 실패 횟수가 지워져 다음 실패는 다시 첫 지연부터 시작합니다

이 토큰 버킷은 **`AddRateLimited`를 통한 재시도 예약**에 적용합니다
일반 `Add()`로 들어오는 이벤트나 컨트롤러가 직접 예약하는 모든 `AddAfter()`까지 초당 10개로 제한한다는 뜻은 아닙니다
여러 키의 지연·병합과 실제 처리 시점도 있으므로 API 요청 QPS가 곧 10이라는 의미로 읽으면 안 됩니다

구성과 계산은 [`DefaultTypedControllerRateLimiter`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/util/workqueue/default_rate_limiters.go), 성공·실패 분기는 [`processNextWorkItem`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/replicaset/replica_set.go)에 있습니다

## status와 Event는 서로 다른 정보를 남깁니다

status는 오브젝트의 현재 상태를 요약합니다
Event는 특정 시점에 일어난 일을 별도 오브젝트로 남기며, 영구 이력은 아닙니다

| Event reason | 유형 | 판별할 내용 |
|---|---|---|
| `SuccessfulCreate` | Normal | 자식 생성 요청 성공 |
| `FailedCreate` | Warning | 생성 실패의 원인, 예를 들어 쿼터나 admission 거부 |
| `SuccessfulDelete` | Normal | 자식 삭제 요청 성공 |
| `FailedDelete` | Warning | 삭제 요청 실패의 원인 |

이 Event를 남기는 구현은 [`RealPodControl`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/controller_utils.go)에 있습니다
생성 요청 성공은 Pod가 Ready가 됐다는 뜻이 아니며, 삭제 요청 성공도 유예 종료와 finalizer 처리가 모두 끝났다는 뜻은 아닙니다
status의 개수와 Event의 message를 함께 봐야 원하는 수에 도달하지 못한 원인을 구분할 수 있습니다

## Lease 경쟁에서 이겨도 이전 리더의 작업을 차단하지는 못합니다

여러 프로세스 중 리더를 고를 때는 Lease를 사용할 수 있습니다
후보는 Lease의 리더 기록이 바뀌는 것을 관찰하고, 자신의 로컬 시계로 관찰 후 경과 시간을 계산합니다
다른 프로세스가 쓴 `renewTime`을 자기 시계와 그대로 비교하는 방식은 아닙니다

| 설정 | 기본값 | 역할 |
|---|---|---|
| `LeaseDuration` | 15초 | 후보가 기록 변화 없이 기다리는 기간 |
| `RenewDeadline` | 10초 | 현재 리더가 갱신을 재시도하다 물러나는 기한 |
| `RetryPeriod` | 2초 | 선출·갱신 재시도의 기준 간격 |

이 값은 [component-base의 권장 기본 설정](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-base/config/v1alpha1/defaults.go)에 있으며, 모든 호출자가 반드시 사용하는 라이브러리 고정값은 아닙니다
시계의 절대 시각 차이뿐 아니라 시계가 진행하는 속도와 API 지연도 동작에 영향을 줍니다

두 후보가 같은 `resourceVersion`의 Lease를 읽고 Update를 보냈다면 한쪽 쓰기만 먼저 성공합니다
다른 쪽은 오래된 버전이므로 충돌합니다
[`LeaseLock.Update`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/tools/leaderelection/resourcelock/leaselock.go)는 직전 조회나 성공 응답에 있던 Lease 객체로 일반 Update를 보냅니다

하지만 이 낙관적 동시성 제어가 보호하는 대상은 **Lease 갱신**입니다
이전 리더가 이미 시작한 API 요청이나 외부 작업까지 취소하지 않습니다
[`leaderelection`의 계약](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/tools/leaderelection/leaderelection.go)도 하나의 프로세스만 리더로 행동하게 강제하는 fencing을 보장하지 않는다고 명시합니다

`ReleaseOnCancel`을 켠 경우에도 보호 대상 작업이 모두 끝나기 전에 Lease를 놓으면 새 리더와 기존 작업이 겹칠 수 있습니다
프로세스 메모리의 expectations나 Lease만으로 외부 시스템에 대한 중복 작업까지 막았다고 판단하면 안 됩니다

v1.37.1의 [resource lock 생성기](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/tools/leaderelection/resourcelock/interface.go)는 `leases`를 지원하고 옛 Endpoints·ConfigMap 기반 락에는 오류를 반환합니다
kube-controller-manager도 리더 선출이 활성화돼 있을 때 다른 락 타입을 거부합니다

```text
endpoints lock is removed, migrate to leases
```

과거 Endpoints·ConfigMap에 리더 기록을 넣으면 다른 용도로 그 오브젝트를 감시하는 구성요소에도 갱신이 전달됐습니다
[Lease 이전 이슈](https://github.com/kubernetes/kubernetes/issues/80289)는 이 불필요한 부하를 이전 이유로 설명합니다
Lease를 감시하는 주체가 전혀 없다는 뜻은 아닙니다

## 워크큐 메트릭은 대기와 처리를 나눠 읽습니다

v1.37.1의 Prometheus workqueue 제공자는 다음 7개 메트릭을 큐 이름 라벨 `name`과 함께 등록합니다
현재 소스의 안정성 등급은 모두 **BETA**입니다

| 메트릭 | 의미 |
|---|---|
| `workqueue_depth` | 처리할 것으로 표시된 키 수 |
| `workqueue_adds_total` | 중복 dirty 항목을 제외하고 새로 처리 대상으로 기록한 횟수 |
| `workqueue_queue_duration_seconds` | 기본 큐의 Add 기록부터 다음 Get까지의 시간 |
| `workqueue_work_duration_seconds` | Get부터 Done까지의 처리 시간 |
| `workqueue_retries_total` | 지연 큐의 AddAfter 호출에서 기록하는 횟수 |
| `workqueue_unfinished_work_seconds` | 처리 중인 작업들의 현재 경과 시간 합 |
| `workqueue_longest_running_processor_seconds` | 처리 중인 작업 중 가장 긴 경과 시간 |

`queue_duration`에는 `AddAfter` 타이머나 rate limiter를 기다리느라 아직 기본 큐에 들어오지 않은 시간이 포함되지 않습니다
반면 처리 중인 키에 다시 `Add()`했다면 현재 처리의 남은 시간도 다음 `Get()`까지의 대기에 포함될 수 있습니다
`depth` 역시 이때 dirty로 표시한 재처리 키를 포함하므로, 내부 FIFO 길이와 항상 같지는 않습니다

`retries_total`은 실패 횟수와 같지 않습니다
가용성 재확인처럼 정상적인 `AddAfter()`도 포함되며, 지연이 0 이하인 호출도 기록합니다
기본 큐가 중복 키를 합쳐도 지연 예약을 호출한 횟수가 줄어드는 것은 아닙니다

큐 깊이만 보지 말고 처리 시간과 진행 중인 작업의 경과 시간도 함께 봐야 합니다
새 키가 늘지 않더라도 `longest_running_processor_seconds`가 계속 커지면 워커가 긴 작업을 붙잡고 있을 수 있습니다

등록 이름·등급은 [Prometheus 메트릭 정의](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-base/metrics/prometheus/workqueue/metrics.go), 측정 경계는 [`metrics.add`·`get`·`done`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/util/workqueue/metrics.go)과 [`AddAfter`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/util/workqueue/delaying_queue.go)에 있습니다

## 같은 증상이어도 보호하는 범위가 다릅니다

| 증상 | 구분할 조건 |
|---|---|
| 기대 수가 남아 복제본 조정을 건너뜀 | `Controller still waiting on expectations`, 관찰 누락·만료 후 재처리 여부 |
| 쓰기 뒤 reconcile 자체가 재시도됨 | consistency store의 read/written 버전, 기능 활성 상태 |
| Pod가 과도하게 생성됨 | 같은 큐의 동시 처리인지, 캐시 지연 중 순차 조정인지, 여러 프로세스인지 |
| 고아 Pod를 입양하지 않음 | selector·기존 controller·부모와 자식의 삭제 상태·UID·namespace |
| 재시도가 느려짐 | 키별 백오프와 전체 재시도 제한, 일반 Add 유입 |
| 리더가 잠시 겹쳐 행동함 | Lease 갱신 성공과 진행 중인 작업 종료를 따로 확인 |

reconcile은 같은 키가 다시 들어올 수 있다는 전제에서 작성합니다
현재 상태를 다시 읽고 같은 조정을 반복해도 의도한 상태가 더 어긋나지 않는 멱등성이 필요합니다
다만 낡은 입력, 서로 다른 프로세스, 외부 시스템의 부작용은 각각의 조건으로 다뤄야 합니다
