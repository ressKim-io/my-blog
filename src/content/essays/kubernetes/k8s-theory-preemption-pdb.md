---
title: "Preemption과 PDB — 희생자 선정과 삭제 허용은 다른 판단입니다"
excerpt: "스케줄러가 낮은 우선순위 Pod를 희생자로 고르는 과정과 PDB를 적용하는 방식을 살펴봅니다. 예정 노드의 한계, 일반 DELETE와 Eviction API, disruptedPods와 drain 재시도의 조건을 구분합니다"
category: "kubernetes"
tags: ["Kubernetes", "Preemption", "PodDisruptionBudget", "PriorityClass", "Eviction", "concept"]
series:
  name: "k8s-theory-node"
  order: 3
date: "2026-09-02"
---

높은 우선순위 Pod를 배치할 자리가 없으면 스케줄러는 다른 Pod를 제거해 자리를 만들 수 있는지 살펴봅니다
이 **preemption**은 PDB를 고려하지만, PDB 예산이 없다는 이유만으로 반드시 중단하지는 않습니다

**PDB(PodDisruptionBudget)**는 애플리케이션의 Pod를 자발적으로 중단할 때 유지할 가용성을 선언하는 오브젝트입니다
희생자를 고를 때 PDB 위반을 줄이는 판단과, 삭제 요청에서 예산을 검사해 거부하는 판단은 서로 다른 경로에 있습니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## 희생자를 골라도 새 Pod가 바로 바인딩되지는 않습니다

[스케줄링 사이클](/essays/k8s-theory-scheduling-binding-cycles)에서 후보를 얻지 못하면 PostFilter가 다음 시도를 도울 수 있습니다
기본 `DefaultPreemption`은 이 확장점에서 기존 Filter를 다시 실행해, Pod를 제거하면 배치할 수 있을지 계산합니다

![PostFilter에서 후보 노드와 희생자를 고르고 삭제 또는 메모리 내 바인딩 취소를 진행한 뒤 요청 Pod는 다음 배치를 기다리는 흐름|tall](/diagrams/k8s-theory-preemption-pdb-1.svg)

희생자 삭제와 새 Pod의 Binding은 별도입니다
preemption으로 후보를 찾은 시도도 새 Pod의 관점에서는 `PodScheduled=False`, `reason=Unschedulable`로 끝나며 재시도를 기다립니다
삭제로 생길 자원에 다른 Pod가 먼저 배치되거나, 그 사이 조건이 달라질 수도 있습니다

이 글은 기본값의 **Pod 단위 DefaultPreemption**을 기준으로 설명합니다
기본 off인 GenericWorkload·PodGroup 관련 집합 경로를 활성화하면 희생자 단위와 영향을 받는 노드의 범위도 달라질 수 있습니다

## PriorityClass는 생성할 때 Pod의 정수 우선순위가 됩니다

사용자는 `priorityClassName`에 PriorityClass 이름을 지정합니다
[`Priority` admission plugin](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/plugin/pkg/admission/priority/admission.go)은 Pod를 생성할 때 클래스의 `value`를 읽어 `spec.priority`에 넣고, `spec.preemptionPolicy`도 결정합니다

직접 넣은 `spec.priority`가 클래스에서 계산한 값과 다르면 생성 요청을 거부합니다
존재하지 않는 클래스를 지정한 경우도 거부하므로, 스케줄러가 큐에서 Pod를 꺼낼 때는 이미 정수 우선순위가 정해져 있습니다

| 구분 | 값 |
|---|---:|
| 사용자 정의 PriorityClass의 상한 | `1000000000` |
| `system-cluster-critical` | `2000000000` |
| `system-node-critical` | `2000001000` |
| 지정 클래스도 globalDefault도 없을 때 | `0` |

[`system-` 접두사](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/scheduling/validation/validation.go)는 시스템 클래스용으로 예약되어 있으며, 두 시스템 클래스는 클러스터 초기 구성 과정에서 생성합니다
`globalDefault: true`인 클래스를 추가할 때 다른 기본 클래스가 있으면 admission이 거부합니다
경쟁 때문에 여러 기본 클래스가 보이는 경우에는 `value`가 가장 작은 것을 선택하는 보정도 있습니다

### 기존 Pod의 우선순위는 클래스 이름을 계속 조회해 바뀌지 않습니다

우선순위는 생성 시점에 Pod에 기록한 값입니다
클래스를 삭제하거나 같은 이름의 클래스를 다시 만들었다고 기존 Pod의 `spec.priority`가 자동으로 갱신되지는 않습니다

또한 PriorityClass의 `value` 자체도 일반 update로 바꿀 수 있는 필드가 아닙니다
[`ValidatePriorityClassUpdate`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/scheduling/validation/validation.go)는 `value` 변경을 거부하고 `preemptionPolicy`도 불변으로 검사합니다

## preemption으로 바뀔 수 있는 노드부터 살펴봅니다

Filter의 `Unschedulable`은 다른 Pod를 제거하면 조건이 바뀔 여지가 있는 거절입니다
`UnschedulableAndUnresolvable`은 다른 Pod를 제거해도 현재 거절 원인이 남는다는 뜻입니다

[`Evaluator.findCandidates`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/preemption/preemption.go)는 `Unschedulable` 상태인 노드를 후보로 가져옵니다
필요한 노드 라벨이 없거나 허용하지 않는 taint가 있는 노드처럼, Pod 제거로 바뀌지 않는 실패는 이 단계에서 제외됩니다

기본 Pod 경로는 배치하려는 노드에 있는 **더 낮은 우선순위의 Pod**를 제거 대상으로 삼습니다
같은 우선순위 Pod를 밀어내거나, 다른 노드의 Pod를 지워 현재 노드의 배치 문제를 해결하는 일반적인 cross-node preemption은 이 기본 경로의 범위가 아닙니다

### 후보 목표 수는 전체 검사 횟수와 다릅니다

[`DefaultPreemption` 설정의 기본값](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/apis/config/v1/defaults.go)은 `minCandidateNodesPercentage: 10`, `minCandidateNodesAbsolute: 100`입니다
잠재 후보 노드 수를 `N`이라고 하면 목표 수는 `min(N, max(N × 10 / 100, 100))`으로 계산하며 정수 나눗셈을 사용합니다

탐색 시작점은 무작위로 고릅니다
하지만 목표 수만큼 노드를 검사하고 무조건 끝내는 것은 아닙니다

[`DryRunPreemption`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/preemption/preemption.go)은 배치 가능한 후보를 찾으며, PDB 위반이 없는 후보를 하나 이상 확보하고 전체 후보 수가 목표에 도달했을 때 탐색을 중단할 수 있습니다
쓸 만한 후보가 부족하면 더 검사해야 합니다

## 희생자를 고르는 동안에는 실제 Pod를 삭제하지 않습니다

**Victim**은 제거할 희생자이고, **reprieve**는 희생자 후보를 남기기로 하는 판단입니다
[`SelectVictimsOnNode`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/defaultpreemption/default_preemption.go)는 노드 스냅샷 사본과 플러그인 상태에서 Pod를 빼고 되돌리며 결과를 비교합니다

![낮은 우선순위 Pod를 사본에서 제거한 뒤 PDB 위반 후보부터 되돌려 Filter를 재실행하고 남길 Pod와 희생자를 구분하는 과정](/diagrams/k8s-theory-preemption-pdb-2.svg)

먼저 제거할 수 있는 낮은 우선순위 Pod를 모두 뺀 상태에서 Filter를 실행합니다
그래도 새 Pod를 배치할 수 없으면 그 노드는 포기합니다

통과했다면 제거했던 Pod를 하나씩 되돌립니다
되돌린 상태에서도 새 Pod가 들어갈 수 있으면 그 Pod는 남기고, 실패하면 다시 빼서 희생자로 정합니다

되돌리는 순서는 PDB를 먼저 반영합니다
삭제하면 PDB를 위반할 후보부터 남겨 보고, 위반하지 않을 후보는 그다음에 검사합니다
각 그룹에서는 우선순위가 높은 Pod부터, 같으면 먼저 시작한 Pod부터 되돌립니다

이것은 모든 조합을 비교해 전역 최소 희생자 집합을 증명하는 탐색은 아닙니다
정해진 순서로 Pod를 되돌리며 가능한 한 많이 남기는 방식입니다

### PDB 위반을 줄이려 하지만 제거를 금지하지는 않습니다

[`FilterVictimsWithPDBViolation`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/preemption/util.go)은 PDB의 `disruptionsAllowed`를 사본으로 가져와 후보를 분류합니다
이 과정에서 API 서버의 실제 PDB 예산을 차감하지는 않습니다

PDB를 위반하는 Pod까지 모두 남기면 새 Pod가 들어갈 수 없는 경우에는 그 Pod도 희생자가 됩니다
그래서 PDB를 고려한다는 설명을 PDB가 preemption을 거부한다는 의미로 읽으면 안 됩니다

노드 후보가 여러 개라면 다음 기준을 차례로 비교합니다
앞 기준이 같을 때만 다음으로 넘어갑니다

| 순서 | 선호하는 노드 |
|---|---|
| 1 | PDB 위반 수가 적음 |
| 2 | 희생자 중 가장 높은 우선순위가 낮음 |
| 3 | 희생자들의 보정한 우선순위 합이 작음 |
| 4 | 희생자 수가 적음 |
| 5 | 최고 우선순위 희생자들의 시작 시각 중 가장 이른 값이 더 늦음 |
| 6 | 그래도 같으면 남은 후보 중 첫 노드 |

[`pickOneNodeForPreemption`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/preemption/preemption.go)은 합을 구할 때 각 우선순위에 `MaxInt32 + 1`을 더합니다
음수 우선순위가 있다는 이유로 더 많은 희생자를 가진 노드의 합이 작아지는 문제를 피하기 위한 보정입니다

다섯 번째 기준은 같은 최고 우선순위라면 더 오래 실행한 Pod를 가급적 남기는 순서입니다
마지막 후보 순서는 노드 이름의 정렬 순서로 보장되는 것은 아닙니다

## 높은 우선순위도 밀어내기를 하지 않을 수 있습니다

`preemptionPolicy: Never`인 Pod는 높은 우선순위를 가져도 다른 Pod를 밀어내지 않습니다
우선순위는 큐 순서에 반영되지만, 자리가 없으면 다른 Pod가 빠져 배치 가능해지기를 기다립니다

기본 정책은 `PreemptLowerPriority`입니다
Never는 다른 Pod를 밀어낼 권한을 끄는 것이며, 그 Pod 자신이 더 높은 우선순위 Pod에게 밀려나지 않는다는 의미는 아닙니다

이전에 preemption을 요청한 Pod는 nominated node에서 희생자가 종료 중이면 추가 preemption을 보통 중단합니다
이때 검사하는 것은 단순히 삭제 중인 모든 Pod가 아니라, preemption을 요청한 Pod가 밀어낼 수 있고 preemption 때문에 종료 중인 Pod입니다

다만 그 nominated node의 상태가 `UnschedulableAndUnresolvable`이면 다시 preemption을 시도할 수 있습니다
그 노드에서 종료만 기다려서는 현재의 배치 실패를 해결할 수 없기 때문입니다

## nominatedNodeName은 Binding을 예약하지 않습니다

스케줄러는 preemption 후보 노드를 `pod.status.nominatedNodeName`에 표시할 수 있습니다
실제로 바인딩한 노드인 `spec.nodeName`과 다릅니다

표시는 다른 Pod의 Filter 계산에도 반영됩니다
[`RunFilterPluginsWithNominatedPods`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/runtime/framework.go)는 같은 노드에 예정된, 검사 중인 Pod와 **우선순위가 같거나 높은** Pod를 임시로 추가합니다
낮은 우선순위의 예정 Pod는 더 높은 우선순위 Pod의 자리를 막지 않도록 이 추가 대상에서 제외합니다

예정 Pod를 실제로 추가했고 첫 Filter가 통과했다면, 예정 Pod를 추가하지 않은 상태에서도 다시 검사합니다
추가 대상이 없거나 첫 검사에서 실패하면 두 번째 검사는 하지 않습니다

| 검사 상태 | 확인하려는 조건 |
|---|---|
| 예정 Pod가 함께 있다고 가정 | 그 Pod의 자원 요청이나 필수 anti-affinity까지 고려해도 배치할 수 있는지 |
| 예정 Pod가 아직 없다고 가정 | 필수 affinity가 아직 배치되지 않은 상대의 존재에만 의존하지 않는지 |

필수 affinity는 선택한 상대 Pod와 같은 노드·zone 등 지정 범위에 함께 있어야 한다는 조건입니다
필수 anti-affinity는 그 상대와 같은 범위에 함께 놓이지 않아야 한다는 조건입니다
예정 Pod는 다른 노드로 갈 수도 있으므로 존재한다고 가정한 결과만으로도, 없다고 가정한 결과만으로도 충분하지 않습니다

이 표시가 계산에 반영되더라도 바인딩 권리를 예약하는 것은 아닙니다
또한 v1.37.1에서는 긴 Permit·PreBind 대기를 알리는 용도로도 사용하므로, nominatedNodeName이 있다는 이유만으로 반드시 preemption이 있었다고 단정할 수 없습니다

## 희생자 처리는 일반 DELETE와 메모리 내 취소로 나뉩니다

현재 [`Executor.PreemptPod`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/preemption/executor.go)는 먼저 희생자가 어느 단계에 있는지 확인합니다

| 희생자의 상태 | 처리 |
|---|---|
| Permit 대기 중 | `WaitingPod.Preempt`로 대기를 중단 |
| PreBind 중 | 바인딩 취소를 시도 |
| 메모리에서 중단하지 못한 경우 | `DisruptionTarget` 조건을 기록하고 일반 Pod DELETE 요청 |

Permit 대기 희생자에 대한 [`Preempt`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/runtime/waiting_pods_map.go)는 Error 상태를 전달해 다시 시도할 수 있게 합니다
이것은 일반 `Reject`가 Unschedulable을 전달하는 동작과 다릅니다
PreBind 취소도 성공하면 해당 Pod를 API에서 삭제하는 경로로 이어지지 않습니다

이 경우 희생자는 [바인딩 실패 정리](/essays/k8s-theory-scheduling-binding-cycles)를 거쳐 다시 큐에 들어갈 수 있습니다
같은 UID의 Pod가 informer에 남아 있고 아직 바인딩되지 않았는지 등의 조건을 다시 확인합니다

일반 DELETE 경로의 희생자는 삭제 대상이 됩니다
소유 컨트롤러가 대체 Pod를 만들더라도 그것은 새 UID를 가진 다른 오브젝트입니다
요청한 높은 우선순위 Pod의 재큐잉과, 희생자의 삭제·재생성을 같은 사건으로 취급하면 안 됩니다

### 비동기 삭제 요청이 끝나는 시점과 자원이 비는 시점도 다릅니다

기본 on인 `SchedulerAsyncPreemption`은 희생자 처리 요청을 goroutine으로 넘깁니다
요청을 보내고 응답을 기다리는 동안 다음 스케줄링 결정을 진행할 수 있습니다

`DefaultPreemption.PreEnqueue`는 진행 중인 preemption 상태로 요청 Pod의 재진입을 조절합니다
현재 구현은 마지막 희생자가 이미 없어졌거나 `deletionTimestamp`가 생긴 상태도 확인하므로, goroutine이 반환했는지만으로 재진입을 결정하지는 않습니다

DELETE가 승인되어도 희생자의 프로세스가 즉시 종료되는 것은 아닙니다
종료 유예 동안 자원이 남아 있을 수 있으므로, 다음 시도에서도 실제 배치 조건을 다시 판단해야 합니다

## PDB의 예산은 disruption controller가 계산합니다

사용자는 `minAvailable` 또는 `maxUnavailable` 중 하나로 유지할 가용성 목표를 선언합니다
[`DisruptionController`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/disruption/disruption.go)는 선택된 Pod와 소유 컨트롤러의 규모를 읽어 PDB status를 갱신합니다

| status 필드 | 뜻 |
|---|---|
| `currentHealthy` | 현재 가용하다고 계산한 Pod 수 |
| `desiredHealthy` | 선언에서 계산한 가용 Pod 목표 수 |
| `expectedPods` | 전체 규모 계산에 사용한 수 |
| `disruptionsAllowed` | 현재 허용하는 추가 disruption 수 |

기본 관계는 `currentHealthy - desiredHealthy`입니다
구현은 결과가 0 이하이거나 `expectedPods`가 0 이하이면 `disruptionsAllowed`를 0으로 보정합니다

`currentHealthy`는 Ready=True만 세는 단순 합도 아닙니다
삭제 중인 Pod와 `disruptedPods`에 최근 기록되어 삭제될 것으로 예상하는 Pod는 Ready여도 제외합니다

정수 `minAvailable`은 그 수를 목표로 사용하고 전체 수에는 선택된 Pod 수를 사용합니다
백분율 `minAvailable`이나 `maxUnavailable`은 소유 컨트롤러의 replica 수 또는 scale 서브리소스로 전체 규모를 구합니다
백분율은 올림으로 계산합니다

컨트롤러 없이 만든 Pod가 규모 계산에 들어오면 전체 replica 수를 구할 수 없습니다
이 경우 controller는 `UnmanagedPods` Warning 이벤트를 남기고 나머지 계산을 진행합니다
해당 Pod까지 정확히 포함한 전체 규모라고 가정하면 안 되며, 이런 Pod는 정수 `minAvailable`로 목표를 표현할 수 있습니다

## 예산을 검사해 삭제를 거부하는 곳은 Eviction API입니다

**Eviction API**는 `policy/v1`의 `Eviction`을 Pod의 `eviction` 서브리소스에 CREATE하는 요청입니다
일반 Pod DELETE와 요청 경로가 다릅니다

```text
POST /api/v1/namespaces/<namespace>/pods/<name>/eviction
```

다음 그림은 PDB 예산을 사용하는 eviction 경로와 일반 preemption 삭제 경로를 비교합니다
미준비·종료 Pod처럼 예산 검사를 생략하거나 차감 없이 허용하는 조건은 아래에서 구분합니다

![일반 preemption DELETE는 PDB 예산 검사를 거치지 않고 Eviction API는 예산이 필요한 경로에서 부족하면 429로 거절하는 차이](/diagrams/k8s-theory-preemption-pdb-3.svg)

[`EvictionREST.checkAndDecrement`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/pod/storage/eviction.go)는 예산이 필요한 요청에서 `disruptionsAllowed`를 확인하고 1을 차감합니다
0이면 429와 `Cannot evict pod as it would violate the pod's disruption budget.`을 반환합니다

PDB의 `observedGeneration`이 현재 generation보다 낮아 아직 새 선언을 처리하지 못한 경우도 429로 재시도를 요구합니다
따라서 모든 429를 현재 가용 Pod 수 부족 하나로 해석해서는 안 됩니다
PDB를 검사하는 Pod가 둘 이상의 PDB에 선택되면 이 서브리소스는 500을 반환합니다

### Ready가 아닌 Pod의 정책은 별도로 적용합니다

`Succeeded`, `Failed`, `Pending`이거나 이미 삭제 중인 Pod는 PDB 검사를 생략하는 경로가 있습니다
그 외의 Ready가 아닌 Pod는 `unhealthyPodEvictionPolicy`에 따라 처리합니다

| 정책 | Ready가 아닌 Pod의 예산 차감 없는 허용 조건 |
|---|---|
| 없음 또는 `IfHealthyBudget` | `desiredHealthy > 0`이고 `currentHealthy >= desiredHealthy` |
| `AlwaysAllow` | 가용성 예산과 관계없이 허용 |

애플리케이션의 Running Pod가 모두 Ready가 아니고 목표 가용 수가 1 이상이라면 기본 정책에서 eviction이 막힐 수 있습니다
`AlwaysAllow`는 이 미준비 Pod를 제거할 수 있도록 둔 정책입니다
앞의 Pending·종료 상태 생략 조건과 구분해서 봐야 합니다

### disruptedPods는 삭제 확인 전의 예산 중복 사용을 막습니다

API 서버는 예산을 차감하면서 `status.disruptedPods`에 Pod 이름과 시각도 기록합니다
controller가 Pod 삭제를 확인하기 전까지 그 Pod를 가용 수에서 빼서, 같은 예산을 다시 허용하지 않도록 합니다

기본 `DeletionTimeout`은 2분입니다
그 기한이 지났는데 삭제되지 않은 항목은 controller가 재검토해 맵에서 제외하고 예산을 다시 계산합니다
모든 항목이 정확히 2분 뒤 같은 순간에 정리된다는 시간 보장은 아닙니다

## PDB는 preemption의 집행을 막지 않습니다

PDB는 희생자 선정 중 되돌리는 순서와 최종 노드 선택에 반영됩니다
그러나 일반 preemption 삭제는 `Pods().Delete`를 사용하므로 Eviction API의 예산 검사를 거치지 않습니다
메모리 내 Permit·PreBind 취소도 `pods/eviction` 요청이 아닙니다

[공식 문서의 best effort](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/scheduling-eviction/pod-priority-preemption.md#poddisruptionbudget-is-supported-but-not-guaranteed)는 이 범위를 뜻합니다
PDB 위반을 줄이려고 시도하지만 필요하면 위반하는 희생자도 제거할 수 있습니다

이 경계를 없애면 사용자의 `maxUnavailable: 0`이 시스템용 고우선순위 Pod가 사용할 자리까지 막을 수 있습니다
가용성 예산은 자원을 선점할 권한을 정하는 우선순위와 별도입니다

### drain의 기본 Eviction 경로와 예외도 구분합니다

`kubectl drain`은 먼저 노드를 cordon해 새 배치를 막고, 기본적으로 Eviction API를 사용해 Pod를 제거합니다
429를 받으면 대기 후 재시도하므로 예산이 계속 부족하면 멈춘 것처럼 보일 수 있습니다
`--timeout`의 0은 유한한 시간 제한을 두지 않는 설정입니다

하지만 [drain 구현](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kubectl/pkg/drain/drain.go)은 eviction 지원 여부와 `DisableEviction` 설정에 따라 일반 DELETE 경로도 선택합니다
`--disable-eviction`을 지정한 drain은 PDB 예산 검사를 우회합니다
명령 이름만으로 예산을 검사했다고 판단할 수는 없습니다

## 중단 주체는 조건과 요청 경로를 함께 확인합니다

`DisruptionTarget` 조건이 남아 있다면 reason으로 중단 주체를 구분하는 데 도움이 됩니다
다음은 소스의 조건 값이며 실제 수집한 이벤트가 아닙니다

| reason | 주체 | PDB 적용 범위 |
|---|---|---|
| `PreemptionByScheduler` | 스케줄러의 일반 preemption 삭제 | 선정에 고려, eviction 예산 검사 없음 |
| `EvictionByEvictionAPI` | Eviction API 호출자 | 해당 요청의 예산·생략 조건 적용 |
| `TerminationByKubelet` | kubelet의 node-pressure eviction 등 | eviction 예산 검사 없음 |
| `DeletionByTaintManager` | NoExecute taint 집행 | eviction 예산 검사 없음 |
| `DeletionByPodGC` | 사라진 노드에 남은 Pod 정리 | eviction 예산 검사 없음 |

메모리에서 중단한 preemption 희생자는 일반 삭제 경로와 조건 기록이 다를 수 있습니다
현재 실행기는 `Preempted` 이벤트 메시지에 `(in kube-scheduler memory)`를 붙여 이 경우를 구분합니다

컨테이너의 cgroup OOM kill은 Pod 오브젝트를 삭제하는 사건 자체가 아닙니다
이 조건만 찾는 대신 컨테이너의 종료 상태와 재시작 기록을 확인해야 합니다

### PostFilter 메시지는 preemption이 멈춘 지점을 알려 줍니다

| 메시지 | 해석 |
|---|---|
| `not eligible due to preemptionPolicy=Never.` | 이 Pod는 다른 Pod를 밀어내지 않음 |
| `not eligible due to a terminating pod on the nominated node.` | 이전 preemption의 종료를 기다림. 노드가 Unresolvable이면 재검토 가능 |
| `Preemption is not helpful for scheduling` | 배치 가능한 preemption 후보를 얻지 못함 |
| `No preemption victims found for incoming pod` | 후보 노드에서 제거할 수 있는 더 낮은 우선순위 희생자를 찾지 못함 |

후보 부재는 초기 Filter가 모두 Unresolvable이었다는 경우만 뜻하지 않습니다
희생자를 빼고도 배치가 안 되는 경우 등 여러 단계에서 후보를 얻지 못할 수 있습니다

PostFilter가 자체 `FitError`를 만들면 앞선 스케줄링 실패 메시지 뒤에 `0/N nodes are available`이 다시 붙을 수도 있습니다
PostFilter 문장이 없다는 이유만으로 플러그인이 꺼졌다고 확정하는 것도 피해야 합니다

### drain 재시도가 계속되면 예산과 계산 상태를 봅니다

`disruptionsAllowed`뿐 아니라 `currentHealthy`, `desiredHealthy`, `observedGeneration`, `disruptedPods`를 함께 확인합니다
PDB의 `DisruptionAllowed` 조건은 `SufficientPods`, `InsufficientPods`, `SyncFailed` 등으로 계산 상태를 알립니다

PDB가 막을 수 있는 범위를 판단하는 기준은 호출자가 누구인지에 더해 **요청이 Eviction API를 지나는지**입니다
그 경계를 먼저 구분하면 희생자를 고르는 스케줄러의 판단과, 가용성 예산을 강제하는 API 서버의 판단을 나눠 볼 수 있습니다
