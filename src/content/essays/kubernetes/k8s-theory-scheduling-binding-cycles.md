---
title: "스케줄링과 바인딩 사이클 — 노드 선택과 기록을 나누는 이유"
excerpt: "스케줄러가 노드를 고른 뒤 assume·Reserve·Permit을 거쳐 바인딩하는 경로를 살펴봅니다. Pod별 순차 판단과 비동기 기록이 어떻게 겹치는지, 실패하면 무엇을 정리하고 언제 재시도하는지 설명합니다"
category: "kubernetes"
tags: ["Kubernetes", "Scheduler", "SchedulingFramework", "Binding", "QueueingHint", "concept"]
series:
  name: "k8s-theory-node"
  order: 1
date: "2026-08-29"
---

Pod를 배치할 노드를 골랐다고 해서 API 서버의 `spec.nodeName`이 바로 채워지는 것은 아닙니다
노드를 고르는 판단과, 그 결과를 API 서버에 기록하는 요청 사이에는 시간이 필요합니다

그동안 다음 Pod의 노드를 고르는 일까지 멈추면 API 응답 대기가 스케줄러 전체의 처리 속도를 제한합니다
스케줄러는 선택한 노드를 자기 캐시에 먼저 반영하고, API 서버에 기록하는 작업은 별도 goroutine으로 진행합니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## 노드를 고른 뒤에도 API 서버의 Pod는 아직 미배치 상태입니다

스케줄러는 [informer가 유지하는 사본](/essays/k8s-theory-informer)으로 Pod를 보고 큐에서 하나씩 꺼내 판단하는 컨트롤러입니다
기본 Pod 경로에서는 `spec.nodeName`이 비어 있는 Pod에 대해 노드 후보를 찾고, 선택 결과를 API 서버에 씁니다

**Scheduling cycle**은 노드를 고르고 캐시·플러그인 상태를 반영하는 직렬 구간입니다
**Binding cycle**은 그 뒤 별도 goroutine에서 대기와 API 서버 쓰기를 진행하는 구간입니다

![기본 Pod 경로에서 직렬로 노드를 고르고 assume·Reserve·Permit을 거친 뒤 별도 goroutine이 바인딩을 진행하는 흐름|tall](/diagrams/k8s-theory-scheduling-binding-cycles-1.svg)

[`scheduleOnePod`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/schedule_one.go)는 `schedulingCycle`에 성공하면 `go sched.runBindingCycle(...)`을 호출합니다
따라서 앞 Pod의 binding cycle과 다음 Pod의 scheduling cycle이 겹칠 수 있습니다

이 글은 기본값에서 사용하는 Pod별 경로를 설명합니다
v1.37.1의 `GenericWorkload`는 Beta·기본 off이며, 활성화한 PodGroup 경로는 뒤에서 별도로 구분합니다

## PreEnqueue는 노드 검사를 시작하기 전의 관문입니다

**확장점(extension point)**은 스케줄링 프레임워크가 플러그인을 호출하는 단계입니다
플러그인마다 같은 확장점에서 다른 조건을 검사하거나 자기 상태를 갱신할 수 있습니다

`PreEnqueue`는 Pod가 실행 대기열인 activeQ에 들어가기 전에 호출합니다
기본 [`SchedulingGates.PreEnqueue`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/schedulinggates/scheduling_gates.go)는 `spec.schedulingGates`가 남아 있으면 진입을 막습니다

이 Pod는 스케줄러 내부 대기 목록에는 있을 수 있지만, 노드 선택을 시작하지는 않습니다
노드를 검사한 끝에 자리가 없어 거절한 경우와 구분해야 합니다

API 서버는 게이트가 있는 Pod를 생성할 때 [`applySchedulingGatedCondition`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/pod/strategy.go)으로 `PodScheduled=False`, `reason=SchedulingGated`를 기록합니다
메시지는 `Scheduling is blocked due to non-empty scheduling gates`입니다
스케줄러의 기본 PreEnqueue 차단이 `FailedScheduling` 실패 처리 경로를 거치는 것은 아닙니다

## Filter는 가능한 노드를 남기고 Score는 그 안에서 고릅니다

**Feasible node**는 현재 판단에서 Pod를 배치할 수 있다고 통과한 노드입니다
Filter는 불가능한 노드를 제외하고, Score는 남은 후보의 우선순위를 비교합니다

| 확장점 | 실행 단위 | 역할 |
|---|---|---|
| `PreFilter` | Pod 단위 | 전처리하거나 노드 후보 집합 제한 |
| `Filter` | 노드 단위 | 배치 가능 여부와 거절 이유 판단 |
| `PostFilter` | 후보를 얻지 못한 시도 | 다음 시도의 배치 가능성을 높이는 후처리 |
| `PreScore` | 후보 집합에 대해 | 점수 계산 전처리 |
| `Score` | 노드 단위 | 플러그인별 점수 계산 |

일반 Pod 경로에서 `PreFilter`가 배치 불가를 반환하거나 Filter 결과가 0개이면 `FitError`가 됩니다
등록된 `PostFilter` 플러그인은 이 결과를 받아 다음 시도를 도울 수 있습니다
preemption도 여기서 동작하지만, PostFilter 성공이 현재 시도에서 곧바로 바인딩 성공을 뜻하지는 않습니다

Score 플러그인의 최종 점수 범위는 0~100이며, 플러그인 가중치를 적용한 총점으로 비교합니다
`NormalizeScore`는 Score 플러그인이 선택적으로 구현하는 `ScoreExtensions`의 callback입니다
설정 파일의 독립 `Plugins` 필드로 등록하는 단계와 구분해야 합니다

현재 [`sorted_nodes.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/sorted_nodes.go)는 총점이 높은 노드를 먼저 꺼내는 힙을 구성합니다
총점이 같으면 점수 항목의 `Randomizer` 값으로 순서를 정합니다
후보가 하나만 남으면 점수 비교 없이 그 노드를 사용합니다

### 전체 노드를 다 검사하기 전에 후보 탐색을 끝낼 수 있습니다

[`numFeasibleNodesToFind`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/schedule_one.go)는 `percentageOfNodesToScore`로 찾을 feasible 노드의 목표 수를 계산합니다
100개 미만이면 전체 수를 목표로 삼고, 100개 이상이면 비율로 계산하되 최소 100개를 찾도록 합니다

비율이 0이면 다음 식으로 자동 계산합니다
다음은 소스의 계산을 정리한 식이며 실행한 측정값이 아닙니다

```text
percentage = max(50 - numAllNodes / 125, 5)
numNodesToFind = max(numAllNodes * percentage / 100, 100)
```

예를 들어 후보 집합이 5,000노드이면 비율은 10%, 목표는 500개의 feasible 노드입니다
이는 노드 500개를 검사한 뒤 멈춘다는 뜻이 아닙니다
통과한 노드가 부족하면 더 검사해야 하며, Filter 내부의 오류도 탐색을 중단할 수 있습니다

Score를 수행할 구성도, 노드를 걸러내는 extender도 없다면 목표를 1개로 줄입니다
extender는 프레임워크 밖의 서비스에 노드 검사 등을 위임하는 연동 방식입니다
따라서 노드가 100개 미만이라는 이유만으로 모든 경로가 항상 모든 노드의 Filter를 실행하는 것도 아닙니다

스케줄러는 다음 탐색의 시작 위치도 옮깁니다
직전 사이클에서 처리한 위치를 반영해 원형으로 탐색하므로, 늘 목록 앞의 노드만 후보가 되는 편향을 줄입니다

후보 수를 줄이면 노드를 고르는 직렬 구간을 짧게 할 수 있습니다
대신 점수를 비교하는 노드의 범위도 줄어듭니다

## assume과 Reserve는 서로 다른 상태를 반영합니다

노드를 고르면 [`assumeAndReserve`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/schedule_one.go)는 Pod 사본의 `spec.nodeName`을 채운 뒤 assume과 Reserve를 실행합니다
**assume**은 선택한 노드에 Pod가 이미 배치된 것으로 스케줄러 메모리에 반영하는 작업입니다

기본 경로에서는 [`Cache.AssumePod`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/backend/cache/cache.go)가 이 Pod를 노드 정보에 더합니다
[`NodeInfo.update`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/types.go)는 Pod의 CPU·memory 요청 등을 누적하고, 뒤따르는 `NodeResourcesFit`의 Filter는 그 요청량을 읽습니다

그래서 다음 Pod는 앞 Pod의 Binding 응답을 기다리지 않고도 앞선 배치가 사용할 자원을 계산에 넣을 수 있습니다
하지만 API 서버의 Pod에는 아직 이 선택이 기록되지 않았습니다

**Reserve**는 상태를 유지하는 플러그인이 자기 자원·바인딩 정보를 해당 Pod의 몫으로 잡는 확장점입니다
노드 캐시의 assume과 플러그인이 별도로 유지하는 상태는 구분해야 합니다

[`VolumeBinding.Reserve`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/volumebinding/volume_binding.go)는 PV·PVC 바인딩 가정을 자체 캐시에 반영합니다
Reserve가 없어도 assume이 반영한 CPU·memory 요청은 다음 Filter에 포함되지만, 이 볼륨 플러그인의 별도 가정까지 생기는 것은 아닙니다

두 상태 모두 스케줄러 쪽의 잠정 결정입니다
API 서버의 자원을 잠그거나 다른 스케줄러의 배치까지 막는 분산 잠금은 아닙니다

## Permit의 호출과 실제 대기는 다른 구간에 있습니다

**Permit**은 바인딩을 승인하거나 거절하고, 필요하면 제한 시간을 둔 Wait를 반환하는 확장점입니다
노드 선택·assume·Reserve 뒤의 직렬 구간에서 호출합니다

Wait를 반환해도 그 자리에서 동료 Pod를 기다리지는 않습니다
스케줄러는 대기 Pod를 등록하고 scheduling cycle을 끝내며, 별도 binding cycle의 `WaitOnPermit`에서 실제로 기다립니다

이 구분으로 gang scheduling처럼 여러 Pod가 준비되기를 기다리는 조건을 표현할 수 있습니다
Reserve에서 오래 기다리면 다음 Pod의 노드 선택도 멈추지만, Permit의 실제 대기는 다음 선택과 겹칠 수 있습니다

![앞 Pod의 assume 뒤에 다음 Pod의 결정이 시작되고, 앞 Pod의 바인딩 대기는 그 결정과 겹칠 수 있는 개념적 시간 관계](/diagrams/k8s-theory-scheduling-binding-cycles-3.svg)

그림은 동시 진행 관계를 설명한 것이며 실제 실행 시간이나 지연 비율을 나타내지 않습니다
직렬이라는 설명은 Pod 사이의 노드 선택에 적용됩니다
한 Pod를 판단하는 동안 여러 노드에서 실행하는 Filter까지 모두 직렬이라는 뜻은 아닙니다

## 바인딩은 선택한 노드를 API 서버에 기록합니다

Permit 대기를 통과하면 PreBind·Bind·PostBind가 이어집니다
현재 구현은 필요한 PreBind 작업을 미리 확인하는 `PreBindPreFlight`도 binding cycle에서 실행합니다

PreBind가 하는 일은 플러그인에 달려 있습니다
VolumeBinding은 필요한 PV·PVC 정보를 API에 쓰고 PV controller가 바인딩을 마치기를 기다립니다
이는 노드의 실제 볼륨 attach·mount 작업과 다릅니다

### DefaultBinder는 Pod 전체 대신 Binding을 보냅니다

[`DefaultBinder.Bind`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/defaultbinder/default_binder.go)는 Pod의 이름·namespace·UID와 대상 Node를 담은 `Binding`을 만듭니다
기본 API 호출은 `POST .../pods/<name>/binding`으로 보내는 서브리소스 요청입니다

| Binding에 넣는 값 | 목적 |
|---|---|
| `metadata.name`, `metadata.namespace` | 바인딩할 Pod 식별 |
| `metadata.uid` | 선택 당시의 Pod와 같은 오브젝트인지 검사 |
| `target.kind: Node`, `target.name` | 선택한 대상 노드 지정 |

[오브젝트 신원](/essays/k8s-theory-object-identity-ownership)에서 이름과 UID를 구분한 이유가 여기에도 적용됩니다
같은 이름으로 Pod를 다시 만들었더라도 UID가 다르면 이전 배치 결정을 적용해서는 안 됩니다

기본 DefaultBinder는 UID를 보내지만 `resourceVersion`은 넣지 않습니다
[`BindingREST`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/pod/storage/storage.go)는 UID와 resourceVersion 중 제공된 값만 precondition으로 전달합니다
다른 클라이언트가 resourceVersion을 제공하면 그 조건도 검사합니다

API 서버는 저장소 갱신을 통해 Pod의 `spec.nodeName`을 채웁니다
이미 노드가 지정됐거나 삭제 중이거나 schedulingGates가 남은 Pod는 거절합니다
PreEnqueue의 검사와 API 서버의 검사는 서로 다른 경계이므로, 커스텀 스케줄러가 게이트를 무시해도 Binding 경로의 검사가 남습니다

`pods/binding`은 별도 REST handler와 권한을 갖는 서브리소스입니다
바인딩 성공은 노드 선택이 기록됐다는 뜻이며, 컨테이너의 실행 완료를 뜻하지는 않습니다
그 뒤 kubelet이 자기 노드에 배치된 Pod를 처리합니다

### PostBind는 성공 뒤의 알림과 정리에 사용합니다

[`PostBindPlugin`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kube-scheduler/framework/interface.go)은 오류를 반환하지 않는 인터페이스입니다
Bind 성공 뒤 플러그인의 정보 전달이나 정리에 사용할 수 있으며, 실패를 반환해 앞선 Binding을 취소하는 단계는 아닙니다

## 실패하면 잠정 상태를 정리하고 다시 시도할지 판단합니다

Reserve가 실패하거나 Permit이 거절한 경우, 바인딩 구간에서 실패한 경우에는 잠정 상태 정리가 필요합니다
[`unreserveAndForget`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/schedule_one.go)은 플러그인의 Unreserve를 호출하고 assumed Pod를 노드 캐시에서 제거합니다

Unreserve는 Reserve 플러그인을 역순으로 호출합니다
Reserve를 실행하지 못한 플러그인에도 호출될 수 있으므로 구현은 여러 번 호출되어도 같은 결과를 내도록 작성해야 합니다

VolumeBinding의 Unreserve는 PV·PVC 캐시에 둔 가정을 정리합니다
이미 PreBind에서 API 서버에 성공적으로 기록한 변경을 모두 원복하는 트랜잭션은 아닙니다
따라서 노드 캐시와 플러그인 캐시를 정리하더라도 API 서버의 기록까지 함께 되돌아가지는 않습니다

바인딩 실패 뒤 assumed Pod를 제거하면 그 자원 때문에 기다리던 다른 Pod의 재시도도 검토합니다
하지만 실패한 Pod를 무조건 다시 넣지는 않습니다
현재 informer 사본에서 Pod가 사라졌거나 이미 바인딩되었거나 UID가 바뀌었다면 재큐잉을 중단하는 검사가 있습니다
이 검사는 API 쓰기는 성공했지만 응답이 늦어 실패처럼 보인 경우도 고려합니다

### 단계 이름에 더해 반환 코드도 확인합니다

기본 VolumeBinding과 DefaultBinder의 PreBind·Bind 실행 오류는 Error로 돌아와 `SchedulerError`로 분류되고 백오프를 거쳐 재시도합니다
Permit의 거절이나 대기 중 거절은 `Unschedulable`로 기록될 수 있습니다

다만 v1.37.1의 [`RunPreBindPlugins`와 `RunBindPlugins`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/runtime/framework.go)는 플러그인의 `IsRejected()` 상태를 그대로 반환하는 경로도 갖습니다
최종 [`handleSchedulingFailure`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/schedule_one.go)는 이 반환 코드가 거절인지로 reason을 고릅니다
따라서 모든 플러그인에 대해 Permit 뒤의 실패가 반드시 SchedulerError라고 일반화하면 안 됩니다

소스에는 Permit을 스케줄 불가 판정의 마지막 단계로 설명한 주석이 남아 있지만, 오류를 판별할 때는 현재 플러그인의 반환 코드와 실제 처리 분기를 함께 봐야 합니다

## 재시도할 Pod를 모두 같은 대기열에 넣지는 않습니다

[`PriorityQueue`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/backend/queue/scheduling_queue.go)는 실행할 항목과 백오프 중인 항목, 조건 변화를 기다리는 항목을 나눕니다
v1.37.1의 배치 불가 대기 저장소 이름은 `unschedulableEntities`이며 Pod와 PodGroup을 함께 담을 수 있습니다

![PreEnqueue를 통과한 Pod는 activeQ에서 선택되고 실패 후에는 조건 변화나 백오프를 기다렸다가 재시도하는 큐 관계](/diagrams/k8s-theory-scheduling-binding-cycles-2.svg)

| 위치 | 자료구조와 역할 | 다시 시도하는 조건 |
|---|---|---|
| `activeQ` | QueueSort 순서의 힙 | 스케줄러가 꺼내 다음 사이클 시작 |
| `backoffQ` | 배치 거절·실행 오류를 나눠 담는 두 힙 | 백오프 완료 후 activeQ로 이동 |
| `unschedulableEntities` | 배치 불가·게이트 대기 항목을 담는 맵 | 관련 사건 또는 주기적인 재검토 |

기본 Pod 백오프는 1초에서 시작해 두 배씩 늘고 최대 10초입니다
설정값을 그대로 두면 계산상 `1s, 2s, 4s, 8s, 10s, 10s`처럼 늘어납니다
노드에 맞지 않아 거절된 횟수와 연속 실행 오류 횟수는 별도로 관리합니다

다만 이 숫자가 모든 재시도의 최소 간격을 보장하지는 않습니다
기본 on인 `SchedulerPopFromBackoffQ`는 activeQ가 비면 아직 백오프 중인 **배치 거절 쪽 힙**에서도 항목을 꺼낼 수 있습니다
[오류 전용 힙](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/backend/queue/backoff_queue.go)은 이 조기 꺼내기 대상이 아닙니다

배치 거절 쪽 힙은 백오프 만료 시각을 1초 단위로 묶고, 같은 시간대에서는 activeQ와 같은 우선순위를 사용합니다
오류 쪽 힙은 백오프 만료 시각으로 정렬합니다
두 힙을 모두 단순한 대기 시간 순서라고 요약하면 이 차이가 사라집니다

`unschedulableEntities`에 머무는 기본 제한은 5분입니다
스케줄러는 30초 주기로 오래 남은 항목을 찾아 activeQ 또는 backoffQ로 옮길지 다시 검토합니다
게이트가 여전히 남아 있다면 재검토가 곧 노드 선택의 시작을 뜻하지는 않습니다

### QueueingHint는 그 사건이 배치 조건을 바꿀 수 있는지 묻습니다

**QueueingHint**는 클러스터의 변경이 해당 Pod의 재시도에 도움이 되는지 플러그인이 답하는 함수입니다
예를 들어 노드 조건 때문에 거절한 Pod를 관계없는 PVC 변경마다 다시 계산할 필요는 없습니다

[`isPodWorthRequeuing`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/backend/queue/scheduling_queue.go)는 앞선 시도의 `UnschedulablePlugins`와 `PendingPlugins`에 기록된 플러그인만 대상으로 삼습니다
일반적인 사건에서는 기본적으로 Skip하고, 관련 함수가 Queue를 반환하면 다시 큐에 넣습니다

Pending 플러그인의 Queue는 즉시 재시도를 허용하고, 배치 거절 플러그인의 Queue는 남은 백오프를 고려합니다
함수가 오류를 반환하면 Pod가 계속 대기 목록에 갇히지 않도록 Queue로 취급합니다
실패 플러그인이 기록되지 않은 실행 오류나 강제 활성화 사건에는 별도의 재큐잉 경로도 있습니다

## Pending의 원인은 PodScheduled 조건에서 나눠 봅니다

다음은 소스의 조건과 오류 문구를 정리한 판별 기준이며 실제 수집한 이벤트가 아닙니다

| `PodScheduled`의 reason | 기록 주체와 의미 |
|---|---|
| `SchedulingGated` | API 서버가 생성 시 게이트 대기를 표시. 노드 선택 시작 전 |
| `Unschedulable` | 스케줄러가 배치 거절 코드로 분류. 후보 부족이나 Reserve·Permit 거절 등 |
| `SchedulerError` | 스케줄러가 실행 오류로 분류. 기본 PreBind·Bind 오류 등 |

스케줄러의 실패 처리 경로는 `FailedScheduling` Warning 이벤트도 기록합니다
그러나 이벤트 이름만으로 Filter 실패와 바인딩 실패를 구분할 수는 없습니다
조건의 reason과 플러그인 메시지를 함께 확인해야 합니다

`FitError`의 `0/N nodes are available`도 맥락이 필요합니다
기본 Pod의 후보 탐색 실패에서는 N이 전체 노드 집합의 수이고, 선택 뒤 Reserve·Permit 거절을 감싼 오류에서는 N을 1로 구성합니다

| 메시지 형태 | 읽을 수 있는 의미 |
|---|---|
| `0/N nodes are available: ...` | 후보 집합에서 배치할 노드를 얻지 못함. 사유별 노드 수가 함께 나올 수 있음 |
| `0/1 nodes are available: <plugin message>` | 하나 고른 노드에서 Reserve·Permit 등이 거절한 경로일 수 있음 |

N은 각 노드에서 Filter를 실제 호출한 횟수가 아닙니다
PreFilter가 후보를 좁히면 제외한 노드에는 공통 거절 상태를 붙일 수 있습니다
또한 전체 노드가 하나인 클러스터의 후보 탐색 실패도 `0/1`이므로 숫자만으로 단계까지 확정하면 안 됩니다

Binding 경로의 대표 거절 문구는 다음과 같습니다
일반 오류는 `pods/binding`의 409 Conflict로 감싸며, 이미 API 상태로 분류한 저장소 오류는 그 상태를 보존합니다

| 문구 | 거절 조건 |
|---|---|
| `pod X is already assigned to node "Y"` | `spec.nodeName`이 이미 있음 |
| `pod X is being deleted, cannot be assigned to a host` | 삭제 중인 Pod |
| `pod X has non-empty .spec.schedulingGates` | 배치 준비 게이트가 남아 있음 |

## 비동기 바인딩과 별도의 API 호출 기능을 구분합니다

다음은 [v1.37.1의 gate 목록](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go)에서 기본 동작과 관련 있는 항목입니다
[emulated 버전](/essays/k8s-theory-version-emulation-rollback)이나 명시적 설정에 따라 실제로 적용되는 동작은 달라질 수 있습니다

| 기능 | v1.37 기준 상태 | 바꾸는 범위 |
|---|---|---|
| QueueingHint | [v1.34에 GA](https://github.com/kubernetes/kubernetes/blob/v1.36.0/pkg/features/kube_features.go), 현재 독립 gate 항목 없음 | 사건에 따른 재큐잉 판단 |
| `SchedulerPopFromBackoffQ` | Beta·기본 on | activeQ가 비면 배치 거절 backoff 항목도 꺼내기 |
| `SchedulerAsyncPreemption` | Beta·기본 on | preemption 작업의 비동기 처리 |
| `SchedulerAsyncAPICalls` | Beta·기본 off | API 호출을 별도 디스패처로 처리 |
| `NominatedNodeNameForExpectation` | Beta·기본 on | 긴 바인딩 대기를 외부에 알릴 후보 노드 기록 |
| `ClearingNominatedNodeNameAfterBinding` | Beta·기본 on | Binding 시 nominatedNodeName 정리 |
| `OpportunisticBatching` | Beta·기본 on | 같은 서명의 Pod에서 앞선 결과 재사용 |

`SchedulerAsyncAPICalls`가 꺼져 있어도 앞에서 본 binding cycle의 goroutine 분리는 동작합니다
두 비동기 처리는 같은 스위치가 아닙니다

OpportunisticBatching의 서명은 플러그인들이 제공한 배치 관련 입력을 조합한 값입니다
재사용 조건을 충족하면 앞선 노드 힌트와 점수 결과를 활용할 수 있지만, 기본 scheduling cycle 자체를 여러 Pod가 동시에 실행하는 것으로 바꾸지는 않습니다

## 기본 Pod 경로와 집합 스케줄링의 경계가 있습니다

기본 Pod 경로는 한 Pod의 결정을 캐시에 반영하고 다음 Pod를 처리합니다
DaemonSet은 컨트롤러가 노드를 순회하며 Pod별 nodeAffinity로 대상 노드를 좁히고, Permit을 활용한 gang scheduling은 Pod별 결정 뒤에 동료의 준비를 기다리는 식으로 집합 요구를 표현할 수 있습니다

한편 v1.37.1에서 `GenericWorkload`를 활성화하면 PodGroup이라는 집합 단위도 `ScheduleOne`의 입력이 됩니다
그 집합의 결정 중에는 [`assume`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/schedule_one.go)이 노드 캐시 대신 `nodeInfoSnapshot`에 먼저 반영하는 경로를 탑니다
기본 Pod 경로의 설명을 모든 집합 스케줄링에 그대로 적용해서는 안 됩니다

Pod별이든 집합 경로든, 노드 상태를 미리 반영하는 작업과 플러그인의 Reserve가 관리하는 별도 상태를 구분해야 합니다
배치 결정, 잠정 상태, API 서버의 기록을 나눠 보면 Pending이 어느 경계에서 멈췄는지도 더 구체적으로 판단할 수 있습니다
