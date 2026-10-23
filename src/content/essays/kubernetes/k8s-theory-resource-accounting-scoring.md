---
title: "자원 회계와 점수 전략 — Pod 요청을 세고 노드를 고르는 기준"
excerpt: "RuntimeClass overhead가 Pod 자원 계산에 더해지는 과정을 따라갑니다. init·sidecar·Pod-level 자원의 합산 조건, Filter와 Score의 요청 차이, NodeResourcesFit 전략과 균형 점수의 범위를 구분합니다"
category: "kubernetes"
tags: ["Kubernetes", "Scheduler", "RuntimeClass", "PodOverhead", "ResourceManagement", "concept"]
series:
  name: "k8s-theory-node"
  order: 15
date: "2026-10-23"
---

스케줄러가 세는 Pod의 요청은 컨테이너에 적은 `requests`의 단순 합계가 아닙니다
init container가 실행되는 순서, Pod 수준 자원 선언, 런타임의 sandbox를 위한 overhead까지 계산에 영향을 줍니다

그 요청으로 배치 가능한 노드를 걸러낸 뒤에도 선택은 남습니다
여유가 많은 노드를 선호할지, 이미 사용 중인 노드에 모을지는 Pod의 자원 선언 대신 스케줄러 프로파일에서 정합니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 수치 예시는 계산 조건을 가정한 것이며 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## RuntimeClass가 채운 값도 요청에 포함됩니다

[앞 편](/essays/k8s-theory-runtime-isolation)에서 RuntimeClass의 `handler`는 실행 환경을 고르는 이름이었습니다
같은 오브젝트의 `overhead.podFixed`는 그 환경에서 Pod sandbox를 유지하는 데 필요한 자원량을 선언합니다

다음은 RuntimeClass의 필드를 설명하는 설정 조각입니다
`250m`과 `120Mi`는 예시 선언이며, 특정 런타임의 실제 필요량으로 측정한 값은 아닙니다

```yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: sandboxed
handler: kata
overhead:
  podFixed:
    cpu: "250m"
    memory: "120Mi"
```

서빙되는 `node.k8s.io/v1`에서는 `handler`·`overhead`·`scheduling`이 최상위 필드입니다
그 사이에 `spec`을 넣지 않습니다

Pod가 `spec.runtimeClassName: sandboxed`를 참조하면 기본 활성인 RuntimeClass admission 플러그인이 클래스의 `podFixed`를 `pod.spec.overhead`로 복사합니다
이후 자원 계산은 사용자가 제출한 컨테이너 선언뿐 아니라 저장되는 Pod의 overhead도 읽습니다

![RuntimeClass admission이 overhead를 채운 Pod를 스케줄러가 자원 합산과 Filter에 사용하고 프로파일의 Score 정책으로 후보를 평가하는 흐름|tall](/diagrams/k8s-theory-resource-accounting-scoring-1.svg)

RuntimeClass admission은 CREATE 요청을 처리합니다
RuntimeClass의 overhead를 나중에 수정해도 기존 Pod의 `spec.overhead`를 다시 복사하는 처리는 없습니다
클래스의 `handler`는 변경할 수 없지만 overhead는 변경할 수 있으므로, 기존 Pod와 새 Pod의 값이 달라질 수 있습니다

### 변경 후의 값도 RuntimeClass와 맞아야 합니다

플러그인은 mutating 단계에서 overhead를 채우고 validating 단계에서 최종 Pod 값과 RuntimeClass를 다시 비교합니다
뒤의 mutating webhook이 이미 채운 overhead를 바꾸더라도 최종 값이 클래스와 다르면 거절됩니다

Pod 생성 요청에 overhead가 적혀 있다는 이유만으로 항상 거절되는 것은 아닙니다
클래스와 같은 값을 보낸 경우에는 통과하고, 플러그인이 클래스의 값으로 다시 채웁니다
다른 값이거나 대응하는 클래스의 overhead가 없으면 거절합니다

이 검사는 선언한 양이 실제 런타임에 충분한지를 측정하지 않습니다
클러스터 관리자가 정한 RuntimeClass와 Pod의 값이 같은지를 확인합니다
RuntimeClass 플러그인을 비활성화하면 이 대조도 수행되지 않습니다

`scheduling`의 취급은 다릅니다
플러그인은 클래스의 `nodeSelector`와 `tolerations`를 Pod에 병합하지만 validating 단계에서 그 결과를 클래스와 다시 대조하지 않습니다
이 필드들은 Pod 생성자도 지정할 수 있으며, overhead처럼 클래스의 선언과 같아야 하는 필드는 아닙니다

이 경로는 [`RuntimeClass` admission](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/plugin/pkg/admission/runtimeclass/admission.go)과 [RuntimeClass 변경 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/node/validation/validation.go)에 있습니다

## Pod 요청은 실행 시점별로 계산합니다

컨테이너 수준 자원을 계산할 때 일반 애플리케이션 컨테이너는 함께 실행하므로 요청을 합산합니다
반면 일반 init container는 차례로 실행되므로 모든 init 요청을 한꺼번에 합산하지 않습니다

restartable init container인 sidecar는 `restartPolicy: Always`로 선언하며, 시작한 뒤에도 후속 init과 애플리케이션 실행 중 계속 동작할 수 있습니다
따라서 공통 자원 helper는 자원별로 다음 두 경우를 비교합니다

1. 일반 컨테이너와 계속 실행되는 sidecar의 요청 합계
2. 각 init 실행 단계에서 해당 init과 그보다 먼저 시작한 sidecar의 요청 합계

각 자원에서 더 큰 값을 선택하므로 CPU 최대량과 메모리 최대량이 서로 다른 실행 단계에서 나올 수도 있습니다
sidecar를 일반 init처럼 최대값 하나로만 계산하거나, 모든 init을 동시에 실행하는 것처럼 더하면 이 계산과 달라집니다

기본 활성인 `PodLevelResources`를 사용하는 호출에서는 지원되는 자원의 Pod-level request가 해당 자원의 컨테이너 집계값을 대체합니다
현재 지원 대상은 CPU·메모리·hugepages이며, Pod-level request가 없는 자원까지 일괄 대체하는 것은 아닙니다
overhead는 이 선택을 마친 뒤 더합니다

DRA(Dynamic Resource Allocation)는 장치 등의 자원을 claim으로 요청하는 기능입니다
이 기능을 사용한다고 모든 claim의 양이 일반 CPU·메모리 요청 합계에 자동으로 추가되지는 않습니다
`DRANodeAllocatableResources`는 현재 alpha·기본 off이며, 이를 켠 호출이 관련 Pod status와 helper 옵션을 사용하는 경우에 추가 회계가 적용됩니다

스케줄러에는 DRA로 처리하는 extended resource를 일반 scalar 자원 검사에서 넘겨받는 분기도 있습니다
따라서 claim 기반 장치 할당과 노드 allocatable의 자원 합산을 같은 계산으로 취급하면 안 됩니다

기본 집계는 [`PodRequests`·`AggregateContainerRequests`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-helpers/resource/helpers.go), 스케줄러의 DRA 조건은 [`NodeResourcesFit`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/noderesources/fit.go)에 있습니다

## overhead는 requests·limits·QoS에서 다르게 쓰입니다

| 계산 목적 | overhead 반영 방식 |
|---|---|
| 일반 Pod requests 계산 | 선택한 요청에 더하며, 그 자원의 요청이 없어도 더함 |
| 일반 Pod limits 계산 | 선택한 상한이 0이 아닌 자원에만 더함 |
| QoS 분류 | overhead를 읽지 않고 Pod 또는 컨테이너의 requests·limits로 분류 |
| eviction 순위의 요청 계산 | overhead를 제외해 계산한 뒤, 해당 자원 요청이 0이 아닐 때만 다시 더함 |
| CRI sandbox 설정 | `resources`에서 제외하고 별도 `overhead` 필드로 전달 |

요청이 없는 것은 그 요청값이 0이라는 뜻이지만, 상한이 없는 것은 해당 제한을 선언하지 않았다는 뜻입니다
상한이 없던 메모리에 overhead `120Mi`만 limit으로 넣으면 원래 없던 작은 상한이 생깁니다
limits에 더하는 조건은 이 차이를 유지합니다

Pod-level과 컨테이너 수준 모두 CPU·메모리를 선언하지 않고 RuntimeClass에만 해당 overhead가 있다면 QoS는 BestEffort일 수 있습니다
그러나 스케줄러의 Pod requests에는 overhead가 포함되므로 요청량은 0이 아닙니다
BestEffort라는 분류를 배치 요청량 0과 같은 뜻으로 읽을 수 없는 이유입니다

eviction 순위의 helper는 Pod-level 자원이 선언된 경우 컨테이너 집계를 건너뛰는 경로도 사용합니다
해당 자원에 선택된 요청이 0인지 확인한 뒤 overhead를 더하므로, 항상 컨테이너 요청 합계만으로 조건을 판단하는 것은 아닙니다
이 경로는 DRA의 node-allocatable claim 회계를 아직 고려하지 않는다는 TODO도 남겨 두고 있습니다

Pod cgroup 설정을 만드는 입력 집계에도 overhead가 포함됩니다
다만 실제 적용할 CPU shares·quota·메모리 상한은 QoS와 상한 선언 여부로 다시 선택합니다
BestEffort 분기는 최소 CPU shares를 쓰므로 overhead가 있다고 그 요청량에 비례한 CPU shares가 항상 적용되는 것은 아닙니다

CRI sandbox 설정은 런타임에 자원과 overhead를 따로 알려주기 위해 두 필드로 나누며, overhead의 요청과 상한은 같은 양으로 계산합니다
두 표현을 다시 더해 overhead를 중복 계산하면 안 됩니다

구현은 [QoS 계산](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/v1/helper/qos/qos.go), [eviction용 요청 helper](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/api/v1/resource/helpers.go), [Pod cgroup 설정](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/cm/helpers_linux.go), [CRI sandbox 자원 설정](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_sandbox_linux.go)에 있습니다

### kubectl 표시도 호출 옵션을 봐야 합니다

현재 `kubectl describe node`는 공통 자원 helper를 호출하며 Pod-level 자원도 읽습니다
과거 v1.35의 별도 축약 구현이 Pod-level 자원을 읽지 않았던 동작을 현재 버전에 그대로 적용하면 안 됩니다

다만 Pod별 행의 계산은 `UseStatusResources: true`로 status에 기록된 resize 자원을 고려하고, 노드의 전체 요청 합계는 다른 옵션으로 계산합니다
같은 helper를 사용한다는 사실만으로 resize 중인 Pod의 표시값과 스케줄러의 모든 집계값이 항상 같다고 단정할 수는 없습니다
표시가 다르면 자원 선언뿐 아니라 호출부의 Pod-level·status·DRA 옵션을 함께 확인해야 합니다

관련 호출은 [`describeNodeResource`·`getPodsTotalRequestsAndLimits`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kubectl/pkg/describe/describe.go)에 있습니다

## Filter와 Score는 누락된 요청을 다르게 셉니다

Filter는 새 Pod의 요청이 노드의 남은 allocatable 안에 들어가는지 확인합니다
allocatable은 노드가 시스템 예약 등을 제외하고 Pod 배치에 사용할 수 있다고 알리는 자원량입니다
이 단계는 CPU 실사용률이나 메모리 실사용량을 읽어 여유를 판단하지 않습니다

`NodeResourcesFit`의 Score는 요청을 누락한 컨테이너가 많이 배치된 노드를 계산상 비어 있는 노드로 보지 않도록 별도 가정값을 사용합니다

| NodeResourcesFit의 계산 | 컨테이너 request 키가 빠진 자원 | 기존 Pod들의 노드 집계 |
|---|---|---|
| Filter | 0 | 선언한 요청을 기준으로 한 합계 |
| Score | CPU `100m`, 메모리 `200Mi` | 같은 누락 요청 보정을 적용한 합계 |

이 가정값은 Pod 오브젝트에 채우는 기본 request도, 실행 중에 보장하는 예약량도 아닙니다
명시적으로 0을 쓴 경우와 request 키 자체가 없는 경우도 구분합니다

Pod-level request가 적용되는 자원은 그 값이 컨테이너 집계값을 대체합니다
가정값을 이미 선언된 Pod-level request 위에 추가로 더하는 것은 아닙니다
overhead는 각 경로가 선택한 요청에 더합니다

이 차이는 [`calculatePodResourceRequest`·`calculateNodeAllocatableRequest`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/noderesources/resource_allocation.go)에서 확인할 수 있습니다
다른 자원 Score 플러그인까지 모두 같은 누락 요청 보정을 쓴다는 뜻은 아닙니다

## NodeResourcesFit은 세 가지 전략을 제공합니다

자원 점수의 요청 비율은 **기존 Pod의 점수 계산용 요청 합계와 새 Pod 요청을 더한 값 / 노드 allocatable**입니다
새 Pod를 그 노드에 넣는다고 가정한 비율이며 아직 바인딩이 끝났다는 뜻은 아닙니다

| `scoringStrategy.type` | 높은 자원 점수를 주는 방향 |
|---|---|
| `LeastAllocated` | 요청 비율이 낮은 노드 |
| `MostAllocated` | 요청 비율이 높은 노드 |
| `RequestedToCapacityRatio` | 요청 비율 구간별로 지정한 점수 그래프 |

CPU만 채점하고 두 후보가 모두 Filter를 통과했다고 가정하겠습니다
각 노드의 CPU allocatable은 4, 기존 점수 계산용 요청은 A가 1·B가 2이며 새 Pod의 요청은 1입니다
이 요청값에는 해당 계산이 반영할 overhead 등의 몫이 이미 포함되어 있습니다

| 후보 | 기존 요청 + 새 요청 | 추가 후 요청 비율 | LeastAllocated CPU 점수 | MostAllocated CPU 점수 |
|---|---|---|---|---|
| A | 1 + 1 = 2 | 50% | 50 | 50 |
| B | 2 + 1 = 3 | 75% | 25 | 75 |

같은 후보를 평가해도 LeastAllocated는 A를, MostAllocated는 B를 선호합니다
후자는 기존 노드에 요청을 모으는 bin packing 방향이지만, 이 전략을 고른 것만으로 노드 수나 비용이 줄어드는 것은 아닙니다

자원별 계산은 [LeastAllocated](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/noderesources/least_allocated.go)와 [MostAllocated](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/noderesources/most_allocated.go) 구현에 근거합니다

**기본값은 LeastAllocated이며 기본 자원은 CPU·메모리, 자원별 가중치는 각각 1입니다**
Resource Bin Packing 공식 문서는 밀집 배치를 위한 MostAllocated와 RequestedToCapacityRatio를 설명하므로, 기본값은 별도의 [설정 기본값 함수](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/apis/config/v1/defaults.go)까지 확인해야 합니다

자원 가중치는 1~100을 허용합니다
가중치를 생략하거나 0으로 보내면 기본값 처리가 1을 채운 뒤 검증하므로, 0이 자원을 끄는 설정은 아닙니다

### shape의 0~10과 프레임워크의 0~100을 구분합니다

RequestedToCapacityRatio의 `shape[].utilization`은 위 요청 비율의 백분율이며 0~100 범위입니다
`shape[].score`는 그 지점에서 줄 점수이며 0~10 범위입니다
지점은 utilization이 증가하는 순서로 지정하며, 그 사이의 점수는 선형 보간합니다

구현은 shape의 입력 점수에 10을 곱해 프레임워크의 0~100 점수 범위로 맞춥니다
요청 합계가 allocatable을 넘으면 utilization 100 지점의 점수를 사용합니다
`shape[].score: 100`처럼 최종 범위를 그대로 입력하면 설정 검증에서 거절됩니다

이 변환은 후보 노드 전체의 최솟값·최댓값으로 점수를 다시 펼치는 정규화와 다릅니다
NodeResourcesFit과 NodeResourcesBalancedAllocation은 별도 `NormalizeScore`를 구현하지 않습니다
프레임워크는 플러그인이 낸 점수의 범위를 확인하고 플러그인 가중치를 곱해 최종 합계에 더합니다

근거는 [shape 계산](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/noderesources/requested_to_capacity_ratio.go), [입력 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/apis/config/validation/validation_pluginargs.go), [프레임워크의 점수 결합](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/runtime/framework.go)에 있습니다

## 균형 점수는 별도 플러그인이 계산합니다

`NodeResourcesBalancedAllocation`은 자원별 요청 비율이 얼마나 고른지를 평가하는 별도 플러그인입니다
현재 구현은 새 Pod를 넣기 전과 후의 균형을 각각 구하고, **Pod 추가로 균형이 얼마나 개선되는지**를 점수에 반영합니다
추가 후 CPU 90%·메모리 10%라는 값만으로 최종 점수를 정할 수는 없습니다

앞의 CPU 예시에 메모리 조건을 더하겠습니다
각 노드의 메모리 allocatable은 4Gi, 기존 메모리 요청은 A가 2Gi·B가 1Gi, 새 Pod의 메모리 요청은 512Mi라고 가정합니다
누락 요청과 추가 overhead는 없는 조건이며, 이 플러그인이 선택한 요청량으로 비교합니다

![CPU와 메모리 요청 비율이 A에서는 25퍼센트포인트 차이에서 12.5퍼센트포인트로 좁아지고 B에서는 25에서 37.5로 벌어지는 가정 예시|tall](/diagrams/k8s-theory-resource-accounting-scoring-2.svg)

A는 자원별 비율 차이가 줄고 B는 커지므로 균형 점수는 A가 더 높습니다
앞서 CPU만 본 MostAllocated가 B를 선호한 것과 다른 평가 기준입니다
이 플러그인은 NodeResourcesFit의 `scoringStrategy`를 바꿔도 별도로 참여합니다

BalancedAllocation은 컨테이너의 누락 요청을 앞 절의 `100m`·`200Mi`로 보정하지 않는 요청 집계를 사용합니다
계산 대상 요청이 전부 0이면 채점을 건너뛰며, 이는 QoS 이름이 BestEffort인지 확인하는 검사가 아닙니다
overhead 때문에 요청이 0이 아닌 BestEffort Pod를 같은 경우로 묶으면 안 됩니다

이 플러그인의 자원 가중치는 1만 허용합니다
현재의 추가 전후 비교는 [`balancedResourceScorer`·`balancedResourceScore`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/noderesources/balanced_allocation.go)에 구현되어 있습니다

### 한 플러그인의 선호가 최종 배치는 아닙니다

기본 Score 구성에는 NodeResourcesFit·NodeResourcesBalancedAllocation·ImageLocality의 가중치 1 외에도 TaintToleration 3, NodeAffinity·PodTopologySpread·InterPodAffinity 각각 2가 참여합니다
DRA가 활성인 구성은 DynamicResources 가중치 2도 등록하며, 기능 gate에 따라 추가 플러그인이 달라질 수 있습니다

따라서 MostAllocated로 바꿔도 다른 점수와 배치 제약은 계속 적용됩니다
후보를 먼저 제외하는 Filter, 플러그인 내부 자원 가중치, 최종 합계에 적용하는 플러그인 가중치를 구분해야 합니다
등록과 기본 가중치는 [기본 플러그인 구성](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/apis/config/v1/default_plugins.go)에 있습니다

## Pod는 점수 전략 대신 프로파일 이름을 참조합니다

`scoringStrategy`는 kube-scheduler가 `--config`로 읽는 `KubeSchedulerConfiguration` 파일에 둡니다
API 서버가 etcd에 저장하는 오브젝트가 아니므로, 이 파일을 바꾸는 행위 자체에는 Kubernetes API의 RBAC·audit이 적용되지 않습니다
설정 적용은 스케줄러 실행 구성과 재시작 절차에서 관리합니다

Pod의 `spec.schedulerName`은 파일의 `profiles[].schedulerName`을 선택합니다
워크로드가 이름을 적는 것만으로 새 프로파일이나 점수 정책을 만들 수는 없습니다

한 프로세스에서 여러 프로파일을 사용할 수 있지만 이름은 중복될 수 없습니다
하나의 스케줄링 큐를 공유하므로 QueueSort 플러그인과 그 인자도 같아야 합니다

해당 프로세스의 프로파일에 없는 schedulerName을 가진 Pod는 그 스케줄러가 큐에 넣지 않습니다
그 경우 배치 평가도 하지 않아 해당 스케줄러의 FailedScheduling 이벤트가 없을 수 있습니다
다만 이벤트가 없다는 사실 하나로 이름 불일치를 확정할 수는 없으므로 담당 스케줄러와 설정을 함께 확인합니다

자세한 구조는 [Scheduler Configuration 공식 문서](https://kubernetes.io/docs/reference/scheduling/config/), [프로파일 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/apis/config/validation/validation.go), [Pod 이벤트 핸들러](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/eventhandlers.go)에서 확인할 수 있습니다

## 실패한 위치와 자원 계산을 함께 확인합니다

| 증상 | 확인할 경계와 조건 |
|---|---|
| `Pod's Overhead doesn't match RuntimeClass's defined Overhead` | Pod의 최종 overhead와 RuntimeClass 선언이 다름 |
| `Pod Overhead set without corresponding RuntimeClass defined Overhead` | Pod에 overhead가 있지만 대응하는 RuntimeClass overhead가 없음 |
| `pod rejected: RuntimeClass "..." not found` | Pod 생성 admission에서 참조한 클래스를 찾지 못함 |
| `conflict: runtimeClass.scheduling.nodeSelector[k] = a; pod.spec.nodeSelector[k] = b` | 같은 키에 Pod와 RuntimeClass가 서로 다른 값을 요구함 |
| 컨테이너 요청은 작아 보이는데 `Insufficient memory` | init·sidecar·Pod-level·overhead까지 포함한 요청과 노드 allocatable 및 기존 요청을 비교 |
| kubelet의 `OutOfmemory` 거절 | 바인딩 이후 kubelet admission 시점의 자원 부족을 확인 |
| `MostAllocated`인데 분산 배치 | Filter 제약과 다른 Score·플러그인 가중치까지 확인 |
| `not in valid range [0, 10]` | RequestedToCapacityRatio의 shape 입력 점수 범위를 확인 |
| Pending이지만 담당 스케줄러의 실패 이벤트가 없음 | schedulerName과 실제 프로파일·담당 프로세스부터 확인 |

`Insufficient memory`에서도 현재 여유가 부족한 경우와 Pod 요청 자체가 노드 전체 allocatable보다 큰 경우는 다릅니다
전자는 다른 Pod를 제거하면 여유가 생길 가능성이 있지만, 후자는 그 노드에서 제거할 Pod가 있어도 들어갈 수 없습니다
NodeResourcesFit은 후자를 `UnschedulableAndUnresolvable`로 구분합니다

kubelet은 바인딩 후 자기 시점의 상태로 자원 수용 여부를 다시 확인합니다
스케줄러가 통과시킨 시점과 달리 노드가 찼다면 `Node didn't have enough resource: memory, requested: ..., used: ..., capacity: ...`와 같은 admission 거절이 생길 수 있습니다
이는 이미 실행 중인 프로세스를 커널이 죽인 OOM과 구분해야 합니다

이 구분은 [자원 Filter](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/noderesources/fit.go)와 [kubelet admission](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/lifecycle/predicate.go)에 근거합니다

## 참고 자료

- [Pod Overhead 공식 문서](https://kubernetes.io/docs/concepts/scheduling-eviction/pod-overhead/): RuntimeClass에서 온 overhead의 배치·실행 경로
- [Resource Bin Packing 공식 문서](https://kubernetes.io/docs/concepts/scheduling-eviction/resource-bin-packing/): MostAllocated와 RequestedToCapacityRatio의 설정
- [컨테이너·Pod 자원 관리 공식 문서](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/): Pod-level 자원과 컨테이너 자원 선언
- [기능 gate의 버전별 기본값](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go): PodLevelResources·DRA 조건

공식 Pod Overhead 문서는 eviction 순위에도 overhead를 반영한다고 요약합니다
이 글에서는 해당 자원의 선택된 요청이 0이 아닐 때만 더하는 고정 소스의 조건까지 구분했습니다
