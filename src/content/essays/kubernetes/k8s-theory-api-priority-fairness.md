---
title: "APF 내부 — 요청 수 대신 처리 자리를 나누는 방식"
excerpt: "FlowSchema가 요청을 분류한 뒤 LIST·쓰기·watch의 처리 폭을 추정하는 과정을 살펴봅니다. 우선순위별 자리 배분과 차용, 큐 선택, 429를 구분하는 근거도 정리합니다"
category: "kubernetes"
tags: ["kubernetes", "APF", "kube-apiserver", "FlowSchema", "concept"]
series:
  name: "k8s-theory-api"
  order: 15
date: "2026-08-13"
---

Pod 하나를 읽는 GET과 Pod 수만 개를 읽는 LIST는 모두 요청 한 건입니다
그런데 API 서버가 처리해야 할 양까지 같지는 않습니다

APF(API Priority and Fairness)는 요청을 분류하고, 실행할 자리를 배정하거나 큐에서 기다리게 하는 기능입니다
여기서 seat는 동시성을 세는 단위이며 요청 하나가 여러 자리를 차지할 수 있습니다
자리 수는 CPU 코어 수나 실제 메모리 사용량을 그대로 나타내는 값이 아닙니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 클러스터 실측은 포함하지 않으며 아래 수치 예시는 코드의 상수와 공식으로 계산한 값입니다

## 요청을 분류한 뒤 필요한 자리를 추정합니다

![FlowSchema의 요청 분류, 우선순위 설정과 처리 폭 추정을 거쳐 실행·대기·거절을 결정하는 흐름|tall](/diagrams/k8s-theory-api-priority-fairness-1.svg)

[API 서버 요청 경로](/essays/k8s-theory-api-request-path)에서 본 APF는 인증 뒤, 일반 인가 앞에 있습니다
사용자 이름과 요청 동작·대상이 이미 있어야 분류할 수 있고, 인가나 admission의 후속 비용을 치르기 전에 과부하를 제어해야 하기 때문입니다

impersonation으로 다른 신원을 사용하는 요청이라면 APF가 보는 것도 바뀐 신원입니다
그 신원으로 요청해도 되는지 확인하는 impersonation의 인가 검사는 APF보다 먼저 수행합니다
필터의 실제 배치는 [`DefaultBuildHandlerChain`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/config.go)에서 확인할 수 있습니다

그림은 APF의 일반적인 분류·배정 경로를 나타냅니다
watch가 아닌 long-running 요청으로 판정된 요청은 이 필터의 추적을 건너뜁니다

## FlowSchema는 분류하고 PriorityLevelConfiguration은 한도를 정합니다

두 리소스는 모두 `flowcontrol.apiserver.k8s.io/v1`의 클러스터 범위 오브젝트입니다

| 오브젝트 | 정하는 것 |
|---|---|
| `FlowSchema` | 요청자·동작·대상을 어떤 규칙으로 분류하고 어느 우선순위 수준으로 보낼지 |
| `PriorityLevelConfiguration` | 그 수준의 동시성 몫, 차용 범위, 큐 구성과 한도 초과 처리 |

FlowSchema의 `rules` 항목 하나가 맞으려면 요청자 조건인 `subjects`와 요청 조건이 **모두** 맞아야 합니다
요청 조건은 resource 요청이면 `resourceRules`, 그 외 URL 요청이면 `nonResourceRules`를 사용합니다
각 목록 안에서는 하나가 맞으면 되고, `rules` 목록 역시 어느 항목 하나가 맞으면 됩니다

namespace 조건도 구분해야 합니다
`namespaces: ["*"]`는 namespace를 지정한 요청에 맞습니다
namespace가 없는 요청까지 포함하려면 `clusterScope: true`가 필요합니다
이는 클러스터 범위 리소스뿐 아니라 모든 namespace를 대상으로 하는 LIST에도 영향을 줍니다
필드의 정의는 [`PolicyRulesWithSubjects`와 `ResourcePolicyRule`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/flowcontrol/v1/types.go)에 있습니다

### 낮은 matchingPrecedence부터 첫 매치를 고릅니다

`matchingPrecedence`는 1부터 10000까지이며 생략 시 1000입니다
낮은 값부터 검사하고 값이 같으면 이름순으로 정렬합니다
첫 매치에서 멈추므로 뒤의 규칙은 같은 요청을 다시 분류하지 못합니다

아래는 v1.37.1의 기본 구성입니다
실제 클러스터에서는 추가·변경된 규칙까지 함께 확인해야 합니다

| FlowSchema | 순서 | 우선순위 수준 | 주요 매칭 범위 |
|---|---:|---|---|
| `exempt` | 1 | `exempt` | `system:masters` |
| `probes` | 2 | `exempt` | `/healthz`·`/readyz`·`/livez`의 GET |
| `system-leader-election` | 100 | `leader-election` | controller-manager·scheduler·kube-system ServiceAccount의 Lease get/create/update |
| `system-node-high` | 400 | `node-high` | `system:nodes`의 nodes·nodes/status·leases |
| `system-nodes` | 500 | `system` | `system:nodes`의 나머지 요청 |
| `kube-controller-manager` | 800 | `workload-high` | kube-controller-manager |
| `kube-scheduler` | 800 | `workload-high` | kube-scheduler |
| `kube-system-service-accounts` | 900 | `workload-high` | kube-system의 ServiceAccount |
| `service-accounts` | 9000 | `workload-low` | 모든 ServiceAccount |
| `global-default` | 9900 | `global-default` | 인증된 사용자와 익명 사용자 |
| `catch-all` | 10000 | `catch-all` | 인증된 사용자와 익명 사용자 |

`system-node-high`가 `system-nodes`보다 먼저인 이유는 노드 상태 보고를 다른 요청과 분리하기 위해서입니다
같은 kubelet의 요청이라도 Node·Lease 갱신은 `node-high`로 가고, 나머지는 `system`에서 경쟁합니다
노드가 동작 중이어도 상태 보고가 밀리면 상태 판단이 늦어질 수 있으므로 이 요청들을 따로 취급합니다

기본 규칙은 [`bootstrap/default.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/apis/flowcontrol/bootstrap/default.go), 정렬은 [`FlowSchemaSequence.Less`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/util/apihelpers/helpers.go)에 있습니다

FlowSchema가 존재하지 않는 우선순위 수준을 가리키면 분류 목록에서 제외합니다
`status.conditions`의 `Dangling` 조건이 `True`인지 확인할 수 있습니다
규칙을 만들었는데 적용되지 않는다면 매칭 순서와 참조 대상의 존재를 함께 봐야 합니다

### 같은 FlowSchema 안에서도 흐름을 나눕니다

flow는 비슷한 속성을 가진 요청의 묶음입니다
FlowSchema 이름과 flow distinguisher라는 구분자 값의 쌍으로 식별합니다

| `distinguisherMethod.type` | 구분자 |
|---|---|
| `ByUser` | 요청자의 이름 |
| `ByNamespace` | 요청 대상 namespace, 없으면 빈 문자열 |
| 필드 생략 | 빈 문자열, 해당 FlowSchema의 요청을 한 흐름으로 취급 |

모든 ServiceAccount가 `service-accounts` 규칙에 맞더라도 `ByUser`로 나누면 서로 다른 흐름이 됩니다
서버는 FlowSchema 이름과 구분자 사이에 0 바이트 구분자를 넣어 SHA-256으로 해시하고, 앞 8바이트를 큐 후보 선택에 사용합니다

다만 `Exempt`이거나 큐가 2개 미만이면 이 구분자와 해시를 계산하지 않습니다
분류·참조 검사·해시는 [`apf_controller.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/util/flowcontrol/apf_controller.go)에 구현되어 있습니다

## 요청의 폭은 실행 전에 정합니다

추정 결과인 `WorkEstimate`는 세 값을 가집니다

| 값 | 의미 |
|---|---|
| `InitialSeats` | 요청을 처리하는 초기 구간의 자리 수 |
| `FinalSeats` | 초기 처리가 끝난 뒤 후속 비용으로 계산한 자리 수 |
| `AdditionalLatency` | 후속 자리 점유를 유지할 시간 |

기본은 1자리이며 LIST와 일부 watch, create·update·patch·delete에는 별도 추정기를 적용합니다
실행 전에는 결과를 모르므로 리소스별 객체 수·평균 크기나 관심 watcher 수를 사용합니다
[`width.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/util/flowcontrol/request/width.go)가 요청별 추정기를 선택합니다

이 세 값과 실제 자리 예약 방식은 구분해야 합니다
큐 구현은 실행·후속 구간에 `max(InitialSeats, FinalSeats)`를 예약합니다
그래서 `InitialSeats: 1`, `FinalSeats: 10`이라고 해서 실행 중에는 꼭 1자리만 쓰는 것은 아닙니다

## LIST는 예상 바이트와 저장 경로로 계산합니다

v1.37.1에서는 `SizeBasedListCostEstimate`가 beta·기본 활성입니다
이때 추정기는 한 번에 메모리에 올라갈 바이트를 100,000으로 나누어 올림합니다

```text
예상 바이트 = 예상 적재 객체 수 × 평균 객체 크기
자리 수 = ceil(예상 바이트 / 100,000)
```

기본 상수와 계산은 [`config.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/util/flowcontrol/request/config.go), [`list_work_estimator.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/util/flowcontrol/request/list_work_estimator.go)에 있습니다
평균 크기는 이번 응답의 직렬화 결과를 미리 측정한 값이 아니라 저장 계층의 통계입니다

추정기는 먼저 LIST가 캐시와 저장소 중 어느 경로를 사용할지 판단합니다
캐시 경로로 추정하면 예상 바이트에 1,000,000바이트 상한을 적용하므로 이 계산의 결과는 최대 10자리입니다
저장소 경로에는 이 상한이 없고 LIST 추정기의 전역 상한은 100자리입니다

| 요청 조건 | 추정 경로의 주요 분기 |
|---|---|
| `resourceVersion="0"` | 캐시 경로로 추정 |
| 빈 resourceVersion | 저장소의 watch progress 지원 여부에 따라 캐시 또는 저장소로 추정 |
| `resourceVersionMatch=NotOlderThan` | 캐시 경로로 추정 |
| Exact 또는 continue | 추정기가 사용하는 `CacheWithoutSnapshots`에서는 저장소 경로로 추정 |

캐시 지원 판정은 [`ShouldDelegateListMeta`와 `ConsistentReadSupported`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/cacher/delegator/interface.go)를 따릅니다
이 버전에서는 과거 `ConsistentListFromCache` gate를 검사하지 않고 watch progress 지원을 확인합니다

추정 경로와 실제 읽기 경로가 같다는 보장은 없습니다
추정기의 helper는 캐시 snapshot을 고려하지 않고, 실제 읽기는 캐시의 준비 상태나 신선도 등 추가 조건에 영향을 받습니다
따라서 [410 이후 전체 상태를 다시 읽는 과정](/essays/k8s-theory-watch)이 항상 100자리 LIST가 되는 것도 아닙니다

객체 수를 계산할 때도 조건이 있습니다
이름 하나를 지정한 요청은 객체 1개로 보고, 일반 요청은 전체 수와 `limit` 중 작은 수를 사용합니다
저장소 경로에 selector가 있으면 그 수와 전체 객체 수의 절반 중 큰 쪽을 예상 적재량으로 봅니다
selector로 반환될 객체만 세면 검사 과정의 비용을 놓칠 수 있기 때문입니다

통계가 오래됐으면 큰 객체 수·크기를 대입한 뒤 경로별 상한을 적용합니다
반면 통계 자체가 없으면 aggregated API처럼 다른 서버에 위임될 가능성도 있어 최소 1자리를 반환합니다
둘을 모두 “최대 비용”으로 묶으면 이 분기를 놓칩니다

### 100자리는 모든 수준에서 사용할 수 있는 값이 아닙니다

큐를 쓰는 수준에는 별도의 요청당 상한도 있습니다
`NominalCL`은 그 수준의 기본 동시성 몫이며 뒤에서 계산합니다

```text
수준별 요청 상한 = max(1, min(ceil(NominalCL × 0.15), floor(NominalCL / handSize)))
최종 LIST 상한 = min(수준별 요청 상한, 전역 LIST 상한)
```

이는 [`finishQueueSetReconfigsLocked`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/util/flowcontrol/apf_controller.go)의 계산입니다
따라서 캐시 추정의 10자리나 전역 상한 100자리만으로 실제 요청 폭을 단정하면 안 됩니다

크기 기반 gate를 끄면 객체 수 기반 추정으로 바뀌고 전역 LIST 상한은 10자리입니다
이전 방식은 처리할 것으로 예상한 객체 100개마다 1자리로 계산하되, 캐시·selector·limit에 따라 예상 처리 개수를 다르게 잡습니다
확인한 [공식 문서 저장본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/cluster-administration/flow-control.md)은 LIST 비용을 객체 수에 비례한다고 설명하므로, 기본 활성인 크기 기반 구현과 구분해서 읽어야 합니다

## 쓰기는 watch 이벤트의 후속 비용까지 계산합니다

오브젝트를 바꾸면 관심 있는 watcher에 변경 이벤트를 전달해야 합니다
추정기는 이 필터링·직렬화·전송 부담을 이벤트를 만든 쓰기 요청의 후속 작업량으로 계산합니다
watcher 수를 실제 직렬화 횟수나 전송 성공 횟수와 동일하게 보는 것은 아닙니다

관심 watcher가 10개 미만이면 후속 비용을 추가하지 않습니다
10개 이상이면 우선 `ceil(watcher 수 / 10)`자리와 5ms를 곱해 작업량을 구합니다
그 뒤 자리 상한을 적용하되 **작업량은 줄이지 않고 시간을 늘립니다**

![관심 watcher 1000개와 자리 상한 10을 가정했을 때 후속 작업량을 보존하며 폭을 줄이고 시간을 늘리는 계산](/diagrams/k8s-theory-api-priority-fairness-2.svg)

그림은 관심 watcher가 1000개이고 요청당 상한이 10자리인 계산 예시입니다
먼저 100자리 × 5ms로 500 seat-ms를 추정하고, 상한을 적용한 뒤에는 10자리 × 50ms로 같은 작업량을 나타냅니다
`AdditionalLatency`가 항상 5ms인 것은 아닙니다

쓰기 추정기의 전역 자리 상한은 10이며 수준별 상한이 더 작으면 그 값을 사용합니다
이벤트를 만들지 않는 ServiceAccount의 `token` 하위 리소스는 후속 비용을 제외합니다
자세한 분기는 [`mutatingWorkEstimator.estimate`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/util/flowcontrol/request/mutating_work_estimator.go)에 있습니다

후속 시간은 응답을 그만큼 늦추는 sleep이 아닙니다
응답 처리 뒤에도 자리를 예약해 두었다가 비동기로 반환하여 이후 요청의 배정에 반영합니다
큐에서 실행을 배정할 때 `FinalSeats`가 현재 수준의 한도보다 크면 폭을 다시 줄이고 시간을 조정하는 경로도 있습니다

## watch는 연결 전체가 아니라 초기화 구간을 셉니다

watch 연결을 몇 시간 유지한다고 몇 시간 동안 APF 자리를 점유하지는 않습니다
APF는 저장 계층이 초기화를 마쳤다는 신호를 보낼 때 실행 구간을 끝냅니다
초기 객체 이벤트를 받는 watch라면 그 초기 전송까지 포함합니다

`WatchList`가 활성화된 기본 구성에서 추정기는 다음 조건을 구분합니다

- `sendInitialEvents=true`이거나 resourceVersion이 비어 있거나 `"0"`이면 LIST 추정기로 초기 비용을 계산합니다
- 그 외의 watch는 최소 1자리로 계산합니다

이는 추정기가 검사하는 조건이며 모든 watch가 같은 초기 이벤트를 받는다는 뜻은 아닙니다
legacy watch와 streaming 초기 전송의 의미 차이는 [watch 글](/essays/k8s-theory-watch)에서 구분했습니다

초기화가 끝난 연결은 APF 자리를 놓지만 이후 변경 이벤트 전달 비용까지 사라진 것은 아닙니다
그 비용은 앞서 본 쓰기 요청의 후속 추정에 반영합니다
초기화 대기와 자리 반환 경계는 [`priority-and-fairness.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/filters/priority-and-fairness.go)에 있습니다

## 우선순위 수준은 서버 전체 자리의 비율을 받습니다

APF가 활성화되어 있으면 서버 전체 동시성 한도 `ServerCL`은 다음 두 플래그의 합입니다

```text
ServerCL = --max-requests-inflight + --max-mutating-requests-inflight
NominalCL(i) = ceil(ServerCL × NCS(i) / sum_ncs)
```

`NCS`는 `nominalConcurrencyShares`이며 `sum_ncs`는 모든 수준의 NCS 합입니다
기본 서버 값은 400과 200이므로 `ServerCL`은 600입니다
APF를 사용하는 동안 이 두 값을 읽기 400·쓰기 200의 별도 풀로 해석하지 않습니다
[플래그 정의](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/options/server_run_options.go)와 [`FeatureOptions.ApplyTo`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/options/feature.go)가 이 관계를 보여 줍니다

| 기본 수준 | NCS | 빌려줄 비율 | 한도 초과 처리 | 큐 수 / handSize |
|---|---:|---:|---|---|
| `exempt` | 0 | 0% | 제한 없음 | — |
| `catch-all` | 5 | 0% | `Reject` | — |
| `system` | 30 | 33% | `Queue` | 64 / 6 |
| `node-high` | 40 | 25% | `Queue` | 64 / 6 |
| `leader-election` | 10 | 0% | `Queue` | 16 / 4 |
| `workload-high` | 40 | 50% | `Queue` | 128 / 6 |
| `workload-low` | 100 | 90% | `Queue` | 128 / 6 |
| `global-default` | 20 | 50% | `Queue` | 128 / 6 |

이 기본값의 NCS 합은 245입니다
`workload-low`의 기본 몫은 `ceil(600 × 100 / 245) = 245`, `leader-election`은 `ceil(600 × 10 / 245) = 25`자리입니다
각 수준에서 올림하므로 모두 더하면 602가 됩니다
이는 기본값과 공식으로 계산한 결과이며 실측 동시 요청 수가 아닙니다

`workload-low`는 몫이 크지만 그중 90%를 빌려줄 수 있습니다
반대로 `leader-election`은 다른 수준에 빌려주지 않도록 설정되어 있습니다
NCS의 크기만 비교하면 실제로 보존하려는 용량의 차이를 놓칩니다

### Exempt와 기본 구성의 자동 갱신

`type: Exempt`인 수준은 APF 동시성 한도 때문에 큐에 들어가거나 거절되지 않습니다
기본 `exempt`는 NCS와 `lendablePercent`가 모두 0이지만, 두 값을 바꿔 다른 수준의 배분에 영향을 줄 수 있습니다
그 값을 바꿔도 Exempt 요청 자체에 동시성 제한을 거는 것은 아닙니다

기본 오브젝트를 모두 같은 방식으로 되돌리는 것도 아닙니다
`exempt`·`catch-all`의 필수 구성은 자동 갱신이 강제되며, `exempt` 수준의 NCS와 `lendablePercent`가 spec 갱신의 예외입니다
나머지 권장 구성은 `apf.kubernetes.io/autoupdate-spec` annotation과 generation에 따라 자동 갱신 여부가 달라집니다

권장 구성에서 annotation이 `false`이면 spec을 자동 갱신하지 않습니다
annotation이 없으면 generation 1은 자동 갱신 대상으로, 1보다 크면 사용자 수정이 있는 것으로 취급합니다
자세한 조건은 [`AutoUpdateAnnotationKey`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/flowcontrol/v1/types.go)에 명시되어 있습니다

## 남는 자리를 빌리되 매 요청마다 한도를 바꾸지는 않습니다

`lendablePercent`는 내 기본 몫 중 다른 수준에 빌려줄 비율입니다
`borrowingLimitPercent`는 내 몫 대비 빌려올 수 있는 상한이며 생략하면 별도의 비율 상한을 두지 않습니다
빌려줄 수 있는 실제 자리가 무한하다는 뜻은 아닙니다

```text
LendableCL = round(NominalCL × lendablePercent / 100)
BorrowingCL = round(NominalCL × borrowingLimitPercent / 100)
```

서버는 수준별 자리 수요를 모아 10초마다 현재 한도를 다시 계산합니다
수요가 줄어들 때 적용하는 평활 계수는 0.977이며, 코드 주석의 반감기는 약 5분입니다

평활값을 갱신할 때는 측정 구간의 `평균 + 표준편차`와 감쇠시킨 이전 값 중 큰 값을 사용합니다
그래서 짧은 부하 증가도 측정 구간에 잡히면 다음 재계산에 반영될 수 있습니다
반감기가 5분이라고 차용을 시작하려면 반드시 5분을 기다린다는 뜻은 아닙니다

현재 한도 계산에는 측정 구간의 최대 수요도 사용합니다
기본 몫 `NominalCL`과 차용 결과인 현재 한도는 구분해야 하며, 재계산 사이에는 서버 전체에 여유가 있어도 특정 수준이 한도에 도달할 수 있습니다
[`seatDemandStats.update`와 `updateBorrowingLocked`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/util/flowcontrol/apf_controller.go)가 이 입력들을 사용합니다

## 큐 후보를 나누고 대기 작업량이 적은 큐를 고릅니다

한 수준 안에서 모든 흐름을 큐 하나에 넣으면 요청이 많은 흐름이 다른 흐름의 대기를 늘립니다
흐름마다 큐를 만들면 흐름 수만큼 큐가 늘어나므로 APF는 고정된 큐 중 일부를 각 흐름의 후보로 고릅니다
이 방식이 shuffle sharding입니다

![흐름별 큐 후보가 일부 겹치더라도 각각의 후보 안에서 대기 작업량이 적은 큐를 고르는 예시](/diagrams/k8s-theory-api-priority-fairness-3.svg)

`handSize`는 흐름마다 고르는 후보 큐 수입니다
필드를 생략한 일반 기본값은 `queues: 64`, `handSize: 8`, `queueLengthLimit: 50`입니다
앞의 기본 수준 표는 이 값을 명시적으로 덮어쓴 구성이므로 두 종류의 기본값을 구분해야 합니다

서버는 해시로 고른 후보들 중 **대기 작업량의 합이 가장 작은 큐**에 요청을 넣습니다
요청 개수가 가장 적은 큐를 고르는 것과는 다릅니다
작업량의 단위는 자리 수와 시간을 곱한 seat-second입니다

```text
예상 작업량 = InitialSeats × 3ms + FinalSeats × AdditionalLatency
```

초기 처리시간 추정은 요청마다 3ms로 같습니다
후속 비용이 없다면 1자리 요청 10개와 10자리 요청 1개의 초기 작업량은 모두 30 seat-ms입니다
동시 점유 폭이 다르다고 누적 작업량도 반드시 더 큰 것은 아닙니다

이 계산과 후보 선택은 [`completeWorkEstimate`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/util/flowcontrol/fairqueuing/queueset/types.go), [`shuffleShardLocked`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/util/flowcontrol/fairqueuing/queueset/queueset.go)에 있습니다
어느 큐에서 실행할지는 큐별 가상 완료 시점을 비교해 정하고, 고른 큐의 가장 오래된 요청을 꺼냅니다
요청이 끝나면 실제 실행 시간과 3ms 추정치의 차이로 그 큐의 가상 시점을 보정합니다
초기 배정은 추정값으로 하지만 실제 시간을 전혀 사용하지 않는 구현은 아닙니다

shuffle sharding은 흐름 사이의 완전한 겹침 가능성을 줄이며 격리를 보장하지는 않습니다
큐 128개에서 6개 후보를 고르는 조합은 `C(128, 6) = 5,423,611,200`개입니다
후보 조합이 균등하게 선택된다는 가정에서 두 흐름의 후보가 전부 같을 확률은 약 54억 분의 1이지만, 일부 큐가 겹칠 가능성까지 이 값으로 계산하면 안 됩니다

## 자리가 없으면 기다리거나 429로 거절합니다

`Limited` 수준의 `limitResponse`가 `Reject`이면 자리를 배정할 수 없을 때 즉시 거절합니다
`Queue`이면 선택한 큐에서 기다리되 길이와 시간 조건을 적용합니다

큐 길이 제한은 `사용 중인 자리 수 >= 현재 동시성 한도`이고 동시에 해당 큐 길이가 `queueLengthLimit` 이상일 때 적용합니다
따라서 `queueLengthLimit`를 모든 상황에서 지키는 단순한 절대 큐 길이로 해석하면 안 됩니다

### 대기 마감은 요청 도착 시점을 기준으로 계산합니다

요청 context에 deadline이 있으면 도착 시점부터 deadline까지의 4분의 1을 대기 예산으로 사용합니다
deadline이 없으면 `RequestTimeout/4`를 쓰며, 기본 RequestTimeout이 60초이므로 15초입니다
두 경우 모두 대기 예산의 상한은 1분입니다

마감은 `요청 도착 시점 + 대기 예산`입니다
큐에 들어온 순간부터 15초를 새로 주는 방식이 아니므로 APF 앞에서 쓴 시간도 남은 대기에 영향을 줍니다
이 계산은 [`getRequestWaitContext`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/filters/priority-and-fairness.go)에 있습니다

실행할 시간을 남기려는 제한이며, 큐에서 기다렸다고 실행 성공까지 보장하지는 않습니다
대기 context가 취소된 경우도 큐 구현에서는 `time-out` 거절 사유로 집계될 수 있습니다

현재 한도보다 넓은 요청을 다루는 예외도 있습니다
`canAccommodateSeatsLocked`는 그런 요청을 배정할 때 실행 중인 요청 수가 0인지 검사합니다
기본 몫만 보고 바로 거절된다고 단정할 수 없으며, 실제 dispatch는 현재 한도와 큐 상태를 함께 따릅니다

## 응답 헤더와 메트릭으로 분류와 거절 이유를 나눠 봅니다

APF가 분류한 요청에는 성공·거절 양쪽에서 다음 응답 헤더를 붙입니다

```text
X-Kubernetes-PF-FlowSchema-UID
X-Kubernetes-PF-PriorityLevel-UID
```

값은 이름이 아니라 UID입니다
이름에 포함된 관리자의 분류 정보나 우선순위 표현을 노출하지 않으려는 선택이며, 코드 주석에도 이유가 적혀 있습니다
이름을 알아내려면 해당 FlowSchema·PriorityLevelConfiguration을 읽어 UID와 대응해야 합니다
APF를 건너뛴 long-running 비-watch 요청에는 이 분류 헤더가 없습니다

거절 사유는 `apiserver_flowcontrol_rejected_requests_total`의 `reason` 라벨로 구분합니다

| reason | 코드에서 구분하는 상황 |
|---|---|
| `concurrency-limit` | 큐를 쓰지 않는 수준에서 현재 자리를 배정하지 못함 |
| `queue-full` | 현재 자리 한도와 해당 큐의 길이 제한에 함께 도달 |
| `time-out` | 큐에서 실행을 기다리는 context의 마감·취소 |

APF의 429에는 `Retry-After`도 붙습니다
값은 수준별로 관리하고 1에서 시작합니다
최근 거절량과 이전 증가 후 경과 시간을 검사해 두 배로 늘리되 최대 32이며, 거절량이 적으면 1씩 줄입니다
거절할 때마다 무조건 두 배가 되거나 부하가 멈춘 즉시 타이머로 줄어드는 것은 아닙니다
갱신은 새 거절을 기록하며 초 경계를 넘을 때 수행합니다
[`dropped_requests_tracker.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/util/flowcontrol/dropped_requests_tracker.go)가 이 조건을 정의합니다

| 확인할 상황 | 함께 볼 값 |
|---|---|
| 서버 전체에는 여유가 있는데 특정 수준에서 거절 | `apiserver_flowcontrol_nominal_limit_seats`, `apiserver_flowcontrol_current_limit_seats`, `apiserver_flowcontrol_current_executing_seats` |
| 큰 LIST나 초기 watch의 폭이 커짐 | `apiserver_flowcontrol_work_estimated_seats`, 요청 옵션·캐시 추정 경로·수준별 요청 상한 |
| 쓰기 뒤 후속 비용이 커짐 | `apiserver_flowcontrol_watch_count_samples`, 추정 FinalSeats·AdditionalLatency |
| 새 FlowSchema가 적용되지 않음 | 앞선 matchingPrecedence의 규칙, 참조 대상과 Dangling 조건 |
| 일부 흐름만 오래 대기 | 해당 수준의 큐별 대기 작업량과 후보 겹침 |

메트릭의 실제 이름과 라벨은 [`metrics.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/util/flowcontrol/metrics/metrics.go)에 있습니다
`work_estimated_seats`도 InitialSeats만이 아니라 초기·후속 자리의 최댓값을 기록합니다

더 세밀한 상태는 다음 디버그 경로에서 CSV로 볼 수 있습니다
일반 리소스 API가 아니라 내부 상태를 진단하기 위한 경로입니다

```text
/debug/api_priority_and_fairness/dump_priority_levels
/debug/api_priority_and_fairness/dump_queues
/debug/api_priority_and_fairness/dump_requests
```

각각 우선순위 수준·큐·요청 단위이며 [`apf_controller_debug.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/util/flowcontrol/apf_controller_debug.go)에 등록되어 있습니다

같은 요청도 `system:masters` 신원과 ServiceAccount 신원으로 보내면 다른 수준에 분류될 수 있습니다
기본 `system:masters` 요청은 Exempt이므로 관리자의 성공만으로 다른 신원의 과부하를 배제할 수 없습니다
429를 해석할 때는 요청 내용뿐 아니라 **어떤 신원과 규칙으로 분류되었는지**부터 확인해야 합니다
