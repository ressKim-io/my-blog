---
title: "Pod 배치 제약 — 노드를 제외하는 조건과 점수를 높이는 조건"
excerpt: "nodeSelector·affinity·taint·topology spread를 Filter와 Score의 역할로 나눕니다. 전용 노드풀, minDomains의 계산, 배치 뒤의 조건 변경과 preemption의 한계를 소스에서 살펴봅니다"
category: "kubernetes"
tags: ["Kubernetes", "Scheduling", "Affinity", "Taints", "TopologySpread", "concept"]
series:
  name: "k8s-theory-node"
  order: 2
date: "2026-08-31"
---

Pod에 배치 조건을 넣었는데도 원하는 노드에 가지 않거나 Pending에 남는다면, 먼저 그 조건이 필수인지 선호인지 구분해야 합니다
필수 조건을 어긴 노드는 후보에서 제외되고, 선호 조건은 남은 후보 사이의 순위를 바꿉니다
노드 선호 점수가 높아도 필수 조건을 만족하지 못한 노드를 선택할 수는 없습니다

같은 노드풀을 사용하더라도 원하는 Pod의 목적지를 제한하는 일과 다른 Pod의 진입을 막는 일은 별개입니다
이 차이를 nodeSelector·affinity·taint·topology spread가 어떻게 표현하는지 살펴봅니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## 필수 조건과 선호 조건은 다른 단계에서 적용합니다

스케줄러의 Filter는 후보 노드에 Pod를 배치할 수 있는지 판단하는 단계입니다
Score는 Filter를 통과한 후보에 점수를 매기는 단계입니다
플러그인은 이 단계에 연결되어 특정 배치 조건을 처리하는 구현입니다

![Pod와 Node 정보를 읽어 필수 조건을 Filter의 통과 여부로, 선호 조건을 Score의 순위로 해석하는 관계](/diagrams/k8s-theory-scheduling-constraints-1.svg)

| 설정 | 새 Pod의 배치에서 하는 일 |
|---|---|
| `requiredDuringSchedulingIgnoredDuringExecution` | 충족하지 못하는 노드를 제외 |
| `preferredDuringSchedulingIgnoredDuringExecution` | 조건을 만족하는 후보를 선호 |
| `NoSchedule`·`NoExecute` taint | toleration하지 못하는 후보를 제외 |
| `PreferNoSchedule` taint | toleration하지 못하는 후보의 선호도를 낮춤 |
| spread의 `DoNotSchedule` | 허용한 개수 차이를 넘는 후보를 제외 |
| spread의 `ScheduleAnyway` | 분산 정도를 후보 점수에 반영 |

필드 이름은 달라도 통과 여부와 선호도라는 두 질문으로 나눌 수 있습니다
실제 구현에는 노드별 Filter 앞의 PreFilter처럼 조건을 미리 계산하거나 후보를 좁히는 단계도 있습니다
따라서 필수 조건을 처리한다는 설명을 모든 노드에서 같은 Filter 함수를 반드시 한 번씩 실행한다는 뜻으로 읽으면 안 됩니다

이 글은 기본 스케줄러가 새 Pod를 배치하는 경로를 다룹니다
`spec.nodeName`으로 이미 노드를 지정해 스케줄러를 우회하는 경우까지 같은 배치 검사를 보장하지는 않습니다
이 경계는 [공식 nodeName 설명](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/scheduling-eviction/assign-pod-node.md#nodename)에 나와 있습니다

## nodeSelector와 nodeAffinity는 목적지를 제한합니다

`nodeSelector`는 Pod가 요구하는 노드 라벨의 키와 값을 맵으로 적습니다
지정한 항목을 모두 만족해야 하므로 항목 사이는 AND입니다
이 맵만으로 여러 조건 사이의 OR를 표현할 수는 없습니다

nodeAffinity는 조건 목록과 연산자를 사용합니다
`In`·`NotIn`·`Exists`·`DoesNotExist`·`Gt`·`Lt`를 사용할 수 있으며, required 조건의 `nodeSelectorTerms` 사이는 OR이고 한 term 안의 조건 사이는 AND입니다

다음은 배치 조건을 설명하는 Pod spec의 일부입니다

```yaml
nodeSelector:
  workload: batch
affinity:
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      nodeSelectorTerms:
        - matchExpressions:
            - key: topology.kubernetes.io/zone
              operator: In
              values: ["ap-northeast-2a", "ap-northeast-2c"]
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 50
        preference:
          matchExpressions:
            - key: disk
              operator: In
              values: ["ssd"]
```

이 Pod는 `workload=batch`이면서 지정한 두 존 중 하나에 속한 노드만 후보로 남깁니다
그 후보 안에서는 `disk=ssd`인 노드를 선호하지만, SSD 라벨이 없다는 이유만으로 배치를 거절하지는 않습니다
`nodeSelector`와 required nodeAffinity를 함께 지정하면 둘 다 만족해야 합니다

[`NodeAffinity.Filter`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/nodeaffinity/node_affinity.go)와 [`RequiredNodeAffinity.Match`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-helpers/scheduling/corev1/nodeaffinity/nodeaffinity.go)가 이 결합을 처리합니다
같은 위치의 `matchFields`로 노드 필드 조건을 지정하는 방식도 있습니다

preferred 항목의 `weight`는 1~100이며 만족한 항목의 가중치를 합합니다
그 뒤 NodeAffinity 플러그인의 후보 점수를 0~100 범위로 정규화합니다
위의 50은 노드 선택 확률 50%나 전체 스케줄러 점수 50점을 보장하는 값이 아닙니다

스케줄러 프로파일에 `addedAffinity`를 설정했다면 Pod에 적힌 조건 외에 그 조건도 적용됩니다
Pod spec만 읽었는데 노드가 제외되는 경우에는 프로파일의 추가 조건도 확인해야 합니다

## taint는 다른 Pod를 제외하지만 toleration은 목적지를 고르지 않습니다

taint는 노드에 지정하며, effect에 따라 Pod 배치를 거절하거나 선호도를 낮추는 데 쓰입니다
toleration은 해당 taint를 이유로 거절하지 않도록 Pod에 적는 예외입니다

GPU Pod가 GPU 노드만 사용하게 하려면 required nodeAffinity로 목적지를 제한할 수 있습니다
하지만 이 조건을 적지 않은 다른 Pod까지 GPU 노드에서 제외하지는 못합니다
반대로 GPU 노드의 taint를 toleration해도 그 Pod가 일반 노드로 가는 것을 막지는 못합니다

전용 노드풀에서는 두 방향을 함께 표현합니다
affinity로 원하는 Pod의 목적지를 제한하고, taint로 해당 toleration이 없는 Pod를 제외합니다
toleration을 추가할 수 있는 작성자까지 taint가 통제하는 것은 아니므로 이것만으로 접근 권한 정책을 대신할 수는 없습니다

| effect | 새 Pod | 이미 배치된 Pod |
|---|---|---|
| `NoSchedule` | toleration하지 못하면 Filter 실패 | 이 taint만으로 축출하지 않음 |
| `PreferNoSchedule` | toleration하지 못하는 taint 수를 Score에 반영 | 이 taint만으로 축출하지 않음 |
| `NoExecute` | toleration하지 못하면 Filter 실패 | taint eviction controller가 삭제를 처리 |

[`TaintToleration.Filter`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/tainttoleration/taint_toleration.go)는 `NoSchedule`과 `NoExecute`를 검사합니다
Score는 toleration하지 못하는 `PreferNoSchedule` taint 개수를 세고, 그 수가 적은 후보에 높은 점수를 주도록 정규화합니다

`NoExecute`의 기존 Pod 처리는 스케줄러가 맡지 않습니다
[`taint eviction controller`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/tainteviction/taint_eviction.go)는 모든 taint를 toleration하는지와 `tolerationSeconds`를 사용해 삭제 작업을 결정합니다
시간을 지정하지 않은 무기한 toleration과, 제한된 유예 시간을 구분해야 합니다

### 기본 300초는 모든 Pod의 공통 유예 시간이 아닙니다

노드 상태에 따라 `not-ready`·`unreachable`·`memory-pressure`·`disk-pressure`·`pid-pressure`·`network-unavailable`·`unschedulable` 등의 taint가 붙을 수 있습니다
이 중 not-ready와 unreachable에는 Pod의 기본 toleration을 추가하는 별도 admission 처리가 있습니다

[`DefaultTolerationSeconds`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/plugin/pkg/admission/defaulttolerationseconds/admission.go)가 활성화되어 있고 해당 toleration이 없으면 기본 300초를 추가합니다
키나 effect가 비어 있어 여러 taint를 포함하는 기존 toleration도 검사하며, 이미 지정된 toleration을 덮어쓰지 않습니다
기본값은 API 서버의 `--default-not-ready-toleration-seconds`와 `--default-unreachable-toleration-seconds`로 바꿀 수 있습니다

DaemonSet 컨트롤러는 이 두 NoExecute taint에 대해 `tolerationSeconds`가 없는 toleration을 추가합니다
따라서 DaemonSet Pod까지 일괄적으로 5분 뒤 축출된다고 설명할 수는 없습니다
그 처리는 [`AddOrUpdateDaemonPodTolerations`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/daemon/util/daemonset_util.go)에서 확인할 수 있습니다

이처럼 최종 Pod의 배치 조건에는 사용자가 작성한 값뿐 아니라 admission과 컨트롤러가 추가한 값도 들어갑니다
[admission의 변경 단계](/essays/k8s-theory-admission-order/)가 스케줄링보다 앞에 있는 이유와도 연결됩니다

## pod affinity는 기존 Pod의 위치를 기준으로 합니다

pod affinity는 selector로 고른 기존 Pod와 같은 영역에 배치하려는 조건입니다
pod anti-affinity는 그 Pod와 같은 영역을 피하려는 조건입니다
판단 대상이 노드 라벨 자체인 nodeAffinity와 다릅니다

`labelSelector`는 기준 Pod를 고르고, `topologyKey`는 어느 노드들을 같은 영역으로 볼지 정합니다
이때 영역을 domain이라고 하며, 같은 라벨 키와 값을 가진 노드들이 한 domain에 속합니다
Pod 선택 범위에는 `namespaces`·`namespaceSelector`도 관여합니다

다음은 hostname 값이 노드마다 다르고 cache Pod 하나가 node1에 있다고 가정한 예시입니다

![cache Pod를 기준으로 zone은 node1과 node2를 같은 영역으로, hostname은 node1만 같은 영역으로 보는 예시](/diagrams/k8s-theory-scheduling-constraints-2.svg)

required affinity의 `topologyKey`가 zone이면 cache Pod와 같은 zone=a의 node1·node2가 같은 영역입니다
hostname이면 node1만 같은 영역입니다
required anti-affinity에서는 반대로 해당 영역의 후보를 제외합니다

다만 required anti-affinity에 임의의 topologyKey를 언제나 사용할 수 있는 것은 아닙니다
`LimitPodHardAntiAffinityTopology` admission plugin이 활성화되어 있으면 `kubernetes.io/hostname`으로 제한합니다
위의 zone 비교는 그 제한에 막히지 않는 설정을 가정한 것입니다
이 조건은 [공식 affinity 설명](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/scheduling-eviction/assign-pod-node.md#affinity-and-anti-affinity)에도 명시돼 있습니다

### 새 Pod와 기존 Pod 양쪽의 required anti-affinity를 확인합니다

새 Pod에 적힌 anti-affinity만 검사하면 이미 실행 중인 Pod의 조건을 깨뜨릴 수 있습니다
그래서 [`InterPodAffinity.Filter`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/interpodaffinity/filtering.go)는 기존 Pod가 요구한 anti-affinity도 확인합니다

새 Pod의 조건은 자신이 피하려는 기존 Pod의 영역을 제외합니다
기존 Pod의 조건은 자신의 selector에 맞는 새 Pod가 같은 영역에 들어오는 것을 막습니다
뒤의 실패 메시지가 두 종류인 이유입니다

required affinity에는 자기 자신과의 affinity로 첫 Pod가 영원히 Pending에 남는 것을 피하는 예외도 있습니다
매칭되는 다른 Pod가 없고, 새 Pod가 자신의 조건에 맞으며, 후보 노드에 필요한 topology 라벨이 있으면 첫 Pod의 배치를 허용할 수 있습니다
따라서 매칭 Pod가 아직 없다는 사실만으로 required affinity의 실패를 확정할 수는 없습니다

### 기존 Pod를 확인하는 계산에는 비용이 듭니다

nodeAffinity와 taint 검사는 후보 노드의 라벨·taint를 읽습니다
pod affinity는 다른 Pod의 위치와 조건도 확인해야 하므로 집계 범위가 더 넓습니다
공식 문서는 수백 노드보다 큰 클러스터에서 inter-pod affinity·anti-affinity 사용을 권장하지 않습니다
이는 특정 환경에서 측정한 절대 성능 한도가 아니라 [문서의 사용 권고](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/scheduling-eviction/assign-pod-node.md#inter-pod-affinity-and-anti-affinity)입니다

기본 경로는 PreFilter에서 기존 Pod의 조건과 domain별 매칭 정보를 집계해 노드별 Filter에서 재사용합니다
기존 Pod의 required anti-affinity를 검사할 때는 해당 규칙을 가진 Pod가 있는 노드만 조회합니다
아무 조건도 없는 경우에는 계산을 건너뛰는 경로도 있습니다

v1.37의 `InterPodAffinityHostnameFastPath`는 Alpha·기본 off입니다
이 기능을 켠 경로는 hostname 조건 일부를 노드별 Pod 검사로 처리하므로, 모든 설정이 동일한 전역 집계를 수행한다고 일반화하면 안 됩니다

## topology spread는 domain별 Pod 개수 차이를 계산합니다

`topologySpreadConstraints`는 selector에 맞는 Pod가 domain별로 몇 개씩 있는지 비교합니다
`DoNotSchedule`의 Filter 판정식은 다음과 같습니다

```text
skew = matchNum + selfMatchNum - minMatchNum
```

`matchNum`은 후보 domain에 이미 있는 매칭 Pod 수입니다
`selfMatchNum`은 새 Pod도 자신의 selector에 맞으면 1, 아니면 0입니다
`minMatchNum`은 계산에 포함하는 적격 domain의 최소 매칭 Pod 수이며, `minDomains` 조건에 따라 0으로 바뀔 수 있습니다

이 skew가 `maxSkew`보다 크면 해당 후보 노드를 제외합니다
[`PodTopologySpread.Filter`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/podtopologyspread/filtering.go)가 후보 노드의 topology 라벨과 이 식을 검사합니다

| 필드 | 계산에서 하는 일 |
|---|---|
| `topologyKey` | hostname·zone처럼 domain을 나누는 라벨 키 |
| `labelSelector` | 개수를 셀 Pod의 조건 |
| `maxSkew` | 후보 domain에 배치한 뒤 global minimum과 비교할 허용 차이 |
| `whenUnsatisfiable` | `DoNotSchedule`은 통과 조건, `ScheduleAnyway`는 점수 조건 |
| `minDomains` | 적격 domain이 이 수보다 적으면 global minimum을 0으로 계산 |

`maxSkew`는 임의의 두 노드에 있는 전체 Pod 수를 비교하는 값이 아닙니다
같은 namespace에서 selector에 맞는 Pod를 topology domain으로 집계하며, 종료 중인 Pod를 제외하는 조건도 있습니다
실제 개수 집계는 [`countPodsMatchSelector`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/podtopologyspread/common.go)에서 확인할 수 있습니다

### minDomains는 부족한 domain을 만들어 주지 않습니다

`minDomains`를 생략하면 1로 계산하며, 이 필드는 `DoNotSchedule`에서만 지정할 수 있습니다
적격 domain이 하나뿐이면 그 domain의 기존 Pod 수가 최소값이 됩니다
새 Pod도 selector에 맞는다면 기존 개수에 1을 더하고 같은 기존 개수를 빼므로 skew는 계속 1입니다

다음은 적격 domain 하나에 매칭 Pod 5개가 있고 새 Pod도 매칭되는 계산 예시입니다

| 설정 | global minimum | 새 Pod를 넣은 skew | `maxSkew: 1`의 판정 |
|---|---:|---:|---|
| `minDomains` 생략 | 5 | `5 + 1 - 5 = 1` | 통과 |
| `minDomains: 3` | 0 | `5 + 1 - 0 = 6` | 실패 |

첫 설정은 domain 하나에 Pod가 계속 늘어나는 것을 막지 못합니다
두 번째 설정은 부족한 domain을 생성하는 대신, 최소값을 0으로 보고 조건을 엄격하게 계산합니다
모든 후보가 실패하면 Pod는 Pending에 남습니다

### 적격 domain과 실제 배치 가능한 후보는 같지 않을 수 있습니다

`nodeAffinityPolicy`와 `nodeTaintsPolicy`는 spread 개수 계산에 어느 노드를 포함할지 정합니다
[`matchNodeInclusionPolicies`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/podtopologyspread/common.go)가 이를 적용합니다

| 필드 | 기본 동작 | `Honor`와 `Ignore`의 차이 |
|---|---|---|
| `nodeAffinityPolicy` | `Honor` | nodeSelector·nodeAffinity를 만족하는 노드만 셀지, 이를 무시할지 |
| `nodeTaintsPolicy` | `Ignore` | toleration하지 못하는 NoSchedule·NoExecute taint의 노드를 계산에서 뺄지 |

여기서 `Ignore`는 집계할 때 해당 조건을 무시한다는 뜻입니다
NodeAffinity·TaintToleration Filter의 거절까지 끄지는 않습니다
따라서 spread의 최소값에 영향을 주는 domain이 실제 배치 후보로는 제외될 수 있습니다

### 시스템 기본 spread도 적용 조건이 있습니다

기본 스케줄러는 `SystemDefaulting`을 사용하며 다음 선호 제약을 갖습니다

| topologyKey | maxSkew | whenUnsatisfiable |
|---|---:|---|
| `kubernetes.io/hostname` | 3 | `ScheduleAnyway` |
| `topology.kubernetes.io/zone` | 5 | `ScheduleAnyway` |

그러나 명시적 제약이 없는 모든 Pod에 무조건 적용하지는 않습니다
[`buildDefaultConstraints`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/podtopologyspread/common.go)는 Service·ReplicationController·ReplicaSet·StatefulSet에서 해당 Pod의 selector를 구성하고, 결과가 비어 있으면 기본 제약도 만들지 않습니다

명시적인 `topologySpreadConstraints`가 있으면 그 설정을 사용하며, 스케줄러 설정에서 기본값을 바꾸거나 비활성화할 수도 있습니다
기본 두 제약은 Score용이므로 이 제약 자체가 노드를 제외해 스케줄 불가를 만드는 것은 아닙니다

## Score는 후보를 비교하는 값입니다

노드의 어떤 플러그인 점수가 40이라고 해서 합격이나 불합격을 판단할 수는 없습니다
필요한 정규화와 플러그인 가중치를 적용하고 다른 후보의 결과와 비교해야 합니다
높은 Score가 앞의 Filter 실패를 취소하지도 않습니다

[`getDefaultPlugins`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/apis/config/v1/default_plugins.go)의 기본 가중치는 TaintToleration 3, NodeAffinity·PodTopologySpread·InterPodAffinity 각각 2입니다
가중치가 크면 같은 정규화 점수 차이가 총점에 더 크게 반영됩니다
이 값은 스케줄러 프로파일에서 바꿀 수 있으므로 모든 클러스터의 고정 우선순위는 아닙니다

노드별 Score 계산은 병렬로 실행할 수 있습니다
점수가 모이면 각 플러그인의 `NormalizeScore`가 해당 플러그인의 후보 목록을 사용하고, 정규화 자체도 플러그인 사이에서는 병렬로 실행합니다
이후 가중치를 곱한 합산도 노드별로 병렬 처리합니다
[`RunScorePlugins`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/runtime/framework.go)는 이 범위를 나눠 실행합니다

## 배치 뒤의 조건 변경은 기존 Pod를 자동으로 옮기지 않습니다

`IgnoredDuringExecution`은 스케줄링 시점에 검사한 조건이 실행 중 바뀌었다는 이유로 기존 Pod를 축출하지 않는다는 뜻입니다
노드 라벨이 바뀌거나 새 노드가 생겨 분포가 달라져도, 스케줄러가 이미 배치한 Pod를 자동으로 옮겨 조건을 다시 맞추지는 않습니다

| 배치 뒤의 변화 | 해당 제약이 하는 일 |
|---|---|
| 노드 라벨이 바뀌어 required nodeAffinity를 만족하지 않음 | 그 사실만으로 기존 Pod를 축출하지 않음 |
| 기존 affinity·anti-affinity 관계가 달라짐 | 바뀐 관계에 맞춰 기존 Pod를 재배치하지 않음 |
| 노드 증설로 spread 분포가 달라짐 | 새 Pod의 배치에 계산하며 기존 Pod를 자동 이동하지 않음 |
| toleration하지 못하는 NoExecute taint 추가 | 별도의 taint eviction controller가 삭제를 처리 |

[PodAffinity API 타입](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/core/v1/types.go)에는 `RequiredDuringSchedulingRequiredDuringExecution`이라는 이름이 주석으로 남아 있지만 실제 제공하는 필드는 아닙니다
배치 후 강제 유지가 필요하다는 이유로 이 이름의 설정을 만들어 넣을 수는 없습니다

기능 단계도 기준 버전에 맞춰 확인해야 합니다
v1.37.1에서 `MatchLabelKeysInPodAffinity`와 `NodeInclusionPolicyInPodTopologySpread`는 GA·기본 on·잠김 상태입니다
앞의 기능은 pod affinity의 `matchLabelKeys`·`mismatchLabelKeys`를, 뒤의 기능은 spread 집계의 node affinity·taint 포함 정책을 지원합니다
`MatchLabelKeysInPodTopologySpread`는 Beta·기본 on이고, `TaintTolerationComparisonOperators`는 Alpha·기본 off입니다
뒤의 기능은 toleration에 `Gt`·`Lt` 비교를 추가하며 nodeAffinity의 같은 이름 연산자 지원과 별개입니다
이력은 [`defaultVersionedKubernetesFeatureGates`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go)에서 확인할 수 있습니다

## 실패 메시지는 preemption으로 바꿀 수 있는 조건도 구분합니다

preemption은 우선순위가 낮은 기존 Pod를 제거해 새 Pod의 배치 조건을 만들려는 동작입니다
다른 Pod를 제거해도 노드 라벨이나 taint가 저절로 바뀌지는 않습니다
반면 기존 Pod의 개수와 위치로 판단하는 조건은 제거 결과에 따라 달라질 수 있습니다

| 실패 문구·조건 | 상태 코드 | 제거로 바꿀 수 있는가 |
|---|---|---|
| `node(s) didn't match Pod's node affinity/selector` | `UnschedulableAndUnresolvable` | 라벨 조건은 그대로 남음 |
| `node(s) had untolerated taint(s)` | `UnschedulableAndUnresolvable` | taint 조건은 그대로 남음 |
| `node(s) didn't match pod affinity rules` | `UnschedulableAndUnresolvable` | 함께 배치할 Pod를 제거로 만들 수 없음 |
| `node(s) didn't match pod anti-affinity rules` | `Unschedulable` | 충돌하는 기존 Pod가 제거되면 달라질 수 있음 |
| `node(s) didn't satisfy existing pods anti-affinity rules` | `Unschedulable` | 해당 기존 Pod가 제거되면 달라질 수 있음 |
| `node(s) didn't match pod topology spread constraints` | `Unschedulable` | Pod 개수가 달라지면 판정도 달라질 수 있음 |
| spread의 `(missing required label)` | `UnschedulableAndUnresolvable` | topology 라벨 부재는 그대로 남음 |
| `Insufficient cpu`·`Insufficient memory` | 요청량에 따라 달라짐 | 노드 전체 allocatable을 넘으면 제거로 해결할 수 없음 |

allocatable은 노드가 Pod에 배정할 수 있다고 보고한 자원량입니다
[`NodeResourcesFit`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/noderesources/fit.go)은 현재 사용량 때문에 부족한 경우와 요청 자체가 전체 용량을 넘는 경우를 나눕니다

`Unschedulable`은 제거하면 반드시 성공한다는 보장이 아닙니다
실제 제거 가능한 Pod의 우선순위, 제거할 수 있는 노드 범위, 나머지 배치 조건까지 만족해야 합니다
`UnschedulableAndUnresolvable`도 영구적으로 배치 불가능하다는 뜻은 아니며, 현재 실패 원인을 preemption으로 해결할 수 없다는 분류입니다

이 표의 문구는 소스의 반환값을 정리한 것이며 직접 수집한 이벤트 출력은 아닙니다
같은 Pending 상태에서도 필수 조건을 바꿔야 하는지, 집계 범위를 확인해야 하는지, 기존 Pod 제거를 검토할 여지가 있는지를 먼저 나눠 볼 수 있습니다
