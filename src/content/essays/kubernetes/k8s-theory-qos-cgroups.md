---
title: "QoS와 cgroup — request가 배치 계산에, limit이 실행 상한에 쓰이는 과정"
excerpt: "requests·limits가 스케줄러와 kubelet에서 다른 값으로 쓰이는 과정을 따라갑니다. QoS 분류, Pod와 컨테이너 cgroup, OOM 보정값, allocatable과 resize의 조건을 구분합니다"
category: "kubernetes"
tags: ["Kubernetes", "QoS", "cgroup", "ResourceManagement", "OOM", "concept"]
series:
  name: "k8s-theory-node"
  order: 5
date: "2026-09-07"
---

Pod의 `requests`와 `limits`는 같은 자원을 서로 다른 목적으로 표현합니다
request는 배치할 때 필요한 양을 계산하는 기준이고, limit은 노드에서 허용할 사용량의 상한입니다

그렇다고 request가 스케줄러에서만 쓰이는 것은 아닙니다
kubelet은 CPU request를 경합 시 배분 가중치로 바꾸고, request와 limit의 관계에서 QoS도 계산합니다
하나의 매니페스트가 배치 판단과 실행 중 자원 제어로 이어지는 경로를 살펴봅니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## request와 limit은 서로 다른 질문에 답합니다

스케줄러의 자원 Filter는 노드의 allocatable에서 이미 배치된 Pod들의 요청량을 빼고, 새 Pod의 request를 수용할 수 있는지 판단합니다
allocatable은 시스템과 Kubernetes 구성요소에 필요한 예약 등을 제외하고 Pod 배치에 사용할 수 있다고 알리는 자원량입니다

limit 합계가 아닌 request로 계산하므로 오버커밋이 가능합니다
오버커밋은 요청량을 기준으로 배치한 Pod들의 실제 사용량이 그 요청 합계를 넘어설 수 있도록 허용하는 구성입니다
모든 Pod가 동시에 limit까지 사용해도 자원이 충분하다는 보장은 아닙니다

![request는 스케줄러의 배치 계산과 kubelet의 CPU 가중치에, limit은 kubelet의 CPU quota와 메모리 상한에 연결되는 과정](/diagrams/k8s-theory-qos-cgroups-1.svg)

가령 평소 CPU `100m`이 필요하고 순간적으로 `500m`까지 사용한다는 **가정**을 해보겠습니다
`1000m`은 CPU 1개에 해당하는 양이므로 `100m`과 `500m`은 각각 0.1개와 0.5개에 해당합니다

| 배치량과 상한을 하나로 묶는 가정 | 생기는 제약 |
|---|---|
| 둘 다 `500m` | 순간 최대량을 항상 요청한 것으로 배치 계산 |
| 둘 다 `100m` | 추가 CPU가 있어도 상한 때문에 순간 실행량 제한 |
| request `100m`, limit `500m` | 배치량은 작게 계산하되 노드의 여유와 제어 조건 안에서 추가 사용 가능 |

CPU request가 특정 코어를 미리 떼어 놓는다는 뜻은 아닙니다
일반적인 CPU 배분에서는 경합 시 상대 가중치로 작용하며, CPU Manager의 전용 CPU 할당은 별도 정책과 조건을 따릅니다

### 요청이 없으면 Filter와 Score의 계산이 달라집니다

Filter는 후보 노드를 제외하는 단계이고, Score는 통과한 후보 사이에 점수를 매기는 단계입니다
CPU·메모리 request가 없으면 해당 자원의 Filter 요청량은 0입니다
그 자원 요청 때문에 노드를 제외하지 않는다는 뜻이며, 다른 배치 조건까지 통과한다는 뜻은 아닙니다

자원 Score에서 누락 요청을 보정하는 경로는 컨테이너당 CPU `100m`·메모리 `200Mi`를 가정값으로 씁니다
Pod-level request가 있으면 그 값도 계산에 반영하므로, 이 경우까지 항상 가정값을 더하는 것은 아닙니다

이 가정값은 request가 없는 Pod가 이미 많이 배치된 노드를 자원 계산상 비어 있는 것처럼 보는 문제를 줄입니다
실제 사용량을 측정한 값도, Pod 오브젝트에 채워 넣는 기본 request도 아닙니다

구현은 [`computePodResourceRequest`·`fitsRequest`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/noderesources/fit.go), [`calculatePodResourceRequest`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/noderesources/resource_allocation.go), [`getNonMissingContainerRequests`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/types.go)에서 확인할 수 있습니다

## limit만 써도 같은 자원의 request가 생깁니다

API 서버의 [`SetDefaults_Pod`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/v1/defaults.go)는 일반 컨테이너와 init container의 자원 선언을 각각 확인합니다
limit에는 있고 request에는 없는 키를 찾아 같은 값을 request에 복사합니다

다음은 이 기본값 처리를 설명하는 컨테이너 설정 조각입니다
실제 API 응답을 수집한 출력은 아닙니다

```yaml
resources:
  limits:
    cpu: "500m"
    memory: "256Mi"
```

다른 기본값 처리로 request가 지정되지 않았다면 CPU request는 `500m`, 메모리 request는 `256Mi`가 됩니다
이렇게 생긴 request는 실제 Pod 선언의 일부이므로 배치와 QoS 계산에도 사용합니다
앞 절의 Score 전용 가정값과 다릅니다

이 처리는 Pod 생성에서 적용하며 Deployment 등의 Pod template에 같은 방식으로 값을 채우는 것은 아닙니다
또한 v1.37의 Pod-level 기본값 계산은 별도입니다
기본 on인 `PodLevelResourcesFixDefaulting` 경로에서는 admission이 컨테이너를 추가한 뒤의 전체 Pod를 보도록 [`PrepareForCreate`의 `DefaultPodLevelResources`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/pod/strategy.go)에서 처리합니다

limit을 썼다는 사실만으로 Guaranteed가 되지는 않습니다
모든 QoS 계산 대상에 CPU와 메모리 양쪽 조건이 충족되어야 합니다

## QoS는 자원 선언의 관계로 계산합니다

QoS는 Quality of Service의 약자로, 여기서는 Pod의 CPU·메모리 request와 limit 관계에 따른 분류입니다
사용자가 원하는 등급을 지정하는 spec 필드가 아니며 계산 결과는 `status.qosClass`에 기록됩니다

컨테이너별 자원 선언만 사용하는 경우의 기준은 다음과 같습니다

| 등급 | 조건 |
|---|---|
| Guaranteed | 모든 대상 컨테이너에 CPU·메모리 양수 request와 limit이 있고, 각 자원에서 request=limit |
| BestEffort | 모든 대상 컨테이너의 CPU·메모리 request와 limit이 0이거나 없음 |
| Burstable | 나머지 경우 |

일반 컨테이너와 init container가 대상이며, 계속 실행되는 restartable init sidecar도 포함합니다
ephemeral container는 자원을 선언할 수 없어 이 계산에 포함하지 않습니다
CPU·메모리 이외의 자원만 요청했다고 이 분류가 자동으로 Burstable이 되지는 않습니다

컨테이너 하나가 Guaranteed 조건이고 다른 하나는 아무것도 선언하지 않았다면 Pod 전체는 Burstable입니다
CPU 조건만 같고 메모리 조건이 빠져 있어도 Guaranteed가 아닙니다

### Pod 단위 선언에는 별도 판정 경로가 있습니다

기본 on인 `PodLevelResources`를 사용해 `spec.resources`에 자원을 선언하면 Pod 단위 값으로 QoS를 판정하는 경로를 사용합니다
여기서도 Guaranteed에는 CPU와 메모리 양쪽의 양수 request=limit 조건이 필요합니다

v1.37에는 `PodLevelResourcesFixKubeletQOSClass`도 기본 on입니다
이 경로의 [`ComputePodQOS`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/v1/helper/qos/qos.go)는 `spec.resources` 포인터가 있다는 사실만 보지 않고 지원하는 Pod-level 자원이 실제로 설정되어 있는지도 확인합니다

`GetPodQOS`는 `status.qosClass`가 이미 있으면 그 값을 사용합니다
등급은 Pod 수명 동안 유지하며, 뒤에서 설명할 resize도 등급을 바꾸는 요청은 거부합니다

## kubelet은 숫자를 cgroup 제어 값으로 바꿉니다

cgroup은 Linux가 프로세스를 계층으로 묶어 자원 사용을 제어하는 기능입니다
부모 cgroup의 제약은 자식에도 적용되므로 컨테이너별 상한과 Pod 전체 상한은 서로 다른 범위에서 함께 작용할 수 있습니다
이 계층의 의미는 [Linux 공식 cgroup v2 문서](https://docs.kernel.org/admin-guide/cgroup-v2.html#what-is-cgroup)에 설명되어 있습니다

| 매니페스트 값 | kubelet이 계산하는 값 | 역할 |
|---|---|---|
| `requests.cpu` | CPU shares, cgroup v2 Pod 경로에서는 weight로 변환 | CPU 경합 시 상대 배분 가중치 |
| `limits.cpu` | CPU quota와 period | 기간당 사용 가능한 CPU 시간 상한 |
| `limits.memory` | 메모리 바이트 상한 | cgroup이 수용할 메모리 사용량 제한 |

[`MilliCPUToShares`·`MilliCPUToQuota`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/cm/helpers_linux.go)의 계산은 다음과 같습니다
정수 나눗셈을 사용합니다

```text
shares = (milliCPU × 1024) / 1000, 범위 [2, 262144]
quota  = (milliCPU × period) / 1000, 양수 입력의 하한 1000µs
기본 period = 100000µs = 100ms
```

기본 period에서 양수 limit이 `10m` 미만이면 quota 하한 `1ms`에 걸립니다
입력이 0이면 `MilliCPUToQuota`는 하한 계산 전에 0을 반환하므로, 미지정 limit을 `1ms` 상한으로 바꾸는 것은 아닙니다

shares를 cgroup v2의 `cpu.weight` 값과 혼동해서는 안 됩니다
Pod cgroup을 만드는 [`getCPUWeight`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/cm/cgroup_manager_linux.go)는 shares 범위 `[2, 262144]`를 weight 범위 `[1, 10000]`으로 변환합니다
컨테이너에는 kubelet이 CRI로 자원 값을 전달하므로, 실제 런타임의 변환까지 이 함수와 같다고 단정하지 않습니다

CPU quota 적용은 kubelet의 `cpuCFSQuota` 설정과 CPU 정책의 예외를 따릅니다
기본 `cpuCFSQuota: true`, `cpuCFSQuotaPeriod: 100ms`는 [설정 기본값 소스](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/apis/config/v1beta1/defaults.go)에서 확인할 수 있습니다

### QoS 계층과 Pod 계층은 다릅니다

kubelet이 QoS별 cgroup을 사용하는 구성에서는 Burstable과 BestEffort에만 별도 QoS 부모를 만듭니다
Guaranteed Pod는 별도 Guaranteed 계층 없이 kubepods 루트 아래에 놓습니다

![kubepods 아래 Guaranteed Pod는 바로 놓이고 Burstable과 BestEffort Pod는 각각의 QoS 부모 아래 놓이며 각 Pod 안에는 컨테이너 범위가 있는 관계](/diagrams/k8s-theory-qos-cgroups-2.svg)

BestEffort QoS 계층은 최소 CPU shares인 `2`를 사용합니다
앞서 본 v2 Pod cgroup 변환에서는 weight `1`에 해당합니다
이는 경합 시 낮은 상대 가중치이며, 경합이 없어도 CPU를 전혀 사용할 수 없다는 뜻은 아닙니다

[`PodRequests`·`PodLimits`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-helpers/resource/helpers.go)의 계산에는 일반 컨테이너와 계속 실행되는 sidecar의 합뿐 아니라 일반 init container의 최대 요구량과 Pod overhead도 반영합니다
따라서 모든 컨테이너의 수치를 조건 없이 더하는 단순 합으로 읽으면 안 됩니다
Pod-level 선언이 있으면 그 값도 계산에 반영합니다

컨테이너별 선언만 쓰는 경로에서 한 대상 컨테이너라도 해당 자원의 limit이 없으면, Pod cgroup에는 그 자원의 상한을 설정하지 않습니다
다른 컨테이너에 적힌 개별 limit은 여전히 각 컨테이너 범위에 적용할 수 있습니다
Pod-level limit을 선언한 경로는 별도 조건으로 전체 상한을 설정할 수 있습니다

부모 선택은 [`GetPodContainerName`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/cm/pod_container_manager_linux.go), QoS 부모 생성은 [`qosContainerManagerImpl.Start`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/cm/qos_container_manager_linux.go), Pod 자원 값은 [`ResourceConfigForPod`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/cm/helpers_linux.go)에 나뉘어 있습니다
그림의 이름은 제어 범위를 나타내며 실제 systemd 드라이버의 slice 경로를 그대로 옮긴 것은 아닙니다

## CPU 상한은 실행을 미루고 메모리 상한은 회수를 요구합니다

CPU quota를 다 쓰면 커널은 실행을 미뤘다가 다음 period에 다시 실행할 기회를 줍니다
quota 제한 자체는 프로세스를 종료하지 않습니다

메모리는 이미 사용 중인 페이지를 CPU 실행처럼 다음 period로 미룰 수 없습니다
커널은 먼저 회수 가능한 페이지를 회수하며, 한도 안에서 메모리를 할당할 수 없으면 cgroup OOM kill이 일어날 수 있습니다
상한에 닿는 순간 항상 즉시 종료된다는 뜻은 아닙니다

이 때문에 CPU를 압축 가능한 자원, 메모리를 압축 불가능한 자원이라고 구분하기도 합니다
그렇다고 메모리에 실행 지연을 유발하는 제어가 전혀 없다는 뜻은 아닙니다
`memory.high`는 강한 회수와 할당 지연을 유도하는 별도 경계이며, `memory.max`의 최종 상한과 구분합니다

Linux의 [`memory.high`·`memory.max` 정의](https://docs.kernel.org/admin-guide/cgroup-v2.html#memory-interface-files)와 Kubernetes의 [자원 제어 설명](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/configuration/manage-resources-containers.md)을 함께 읽으면 두 반응의 차이를 확인할 수 있습니다

### MemoryQoS가 켜져도 추가 설정이 필요합니다

v1.37.1의 `MemoryQoS`는 Beta·기본 on입니다
다만 기본 kubelet 설정의 `memoryThrottlingFactor`는 nil이고 `memoryReservationPolicy`는 `None`이므로, gate가 켜졌다는 사실만으로 유효한 `memory.high` 제한이나 `memory.min`·`memory.low` 보호를 설정하지는 않습니다

`memoryThrottlingFactor`를 설정하면 조건에 따라 request와 limit 사이의 `memory.high`를 계산합니다
`memoryReservationPolicy: TieredReservation`은 QoS에 따른 메모리 보호를 추가합니다
이 기능은 cgroup v2를 전제로 하며, 자원 선언에서 QoS를 계산하는 규칙 자체를 바꾸지는 않습니다

이 구분은 [QoS 공식 문서의 MemoryQoS 절](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/workloads/pods/pod-qos.md#memory-qos-with-cgroup-v2)과 [`generateLinuxContainerResources`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_container_linux.go)에 나와 있습니다

## OOM 보정값은 종료 순서를 보장하지 않습니다

`oom_score_adj`는 커널이 OOM 희생 프로세스를 선택할 때 사용하는 점수의 보정값입니다
kubelet은 컨테이너를 시작할 때 이 값을 계산해 전달합니다
같은 메모리 사용 조건에서는 값이 클수록 희생자로 선택되기 쉽지만, 실제 사용량과 OOM이 발생한 범위도 판단에 들어갑니다

| 대상 | kubelet이 계산하는 보정값 |
|---|---|
| Guaranteed 또는 node-critical Pod | `-997` |
| BestEffort | `1000` |
| Burstable 기본 분기 | `1000 - (1000 × 컨테이너 유효 memory request) / 노드 메모리 용량` |
| kubelet 자신·kube-proxy의 상수 | `-999` |

기본 Burstable 분기의 유효 요청은 컨테이너 memory request입니다
기본 off인 `DRANodeAllocatableResources`를 활성화하면 DRA로 할당한 메모리 몫도 계산에 들어갈 수 있습니다
DRA는 장치 등의 자원 할당을 별도로 관리하는 Dynamic Resource Allocation 기능입니다

Pod-level request를 사용하는 분기는 Pod memory request에서 컨테이너들의 유효 요청 집계를 뺀 잔여량을 추가로 고려합니다
잔여량은 음수면 0으로 보정하고 일반·init 컨테이너 총개수로 나눠 각 컨테이너의 유효 요청에 더합니다
Pod memory request가 0이면 이 추가 몫도 0입니다

restartable init sidecar에는 별도 보정이 있습니다
일반 컨테이너들의 최소 유효 memory request로 비교값을 계산하고, sidecar 자신의 보정값과 비교해 더 낮은 값을 사용합니다
Pod-level 분기라면 비교용 요청에도 같은 잔여 요청 몫을 더합니다
일반 컨테이너들의 **최소 보정값**을 선택하는 계산과는 다릅니다

최종 Burstable 계산값이 `3`보다 작으면 `3`으로 올리고 정확히 `1000`이면 `999`로 내립니다
이 규칙은 Guaranteed·BestEffort에 지정한 보정값과 구분하기 위한 휴리스틱이며, sidecar의 생존이나 마지막 로그 보존을 보장하지 않습니다

계산과 조건은 [`GetContainerOOMScoreAdjust`·`getEffectiveContainerMemoryRequest`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/qos/policy.go), 잔여량과 비교용 요청은 [`remainingPodMemReqPerContainer`·`minRegularContainerMemory`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/qos/helpers.go)에 있습니다

node-pressure eviction은 kubelet이 Pod를 축출하는 별도 판단입니다
메모리 압박의 [`rankMemoryPressure`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/eviction/helpers.go)는 요청 초과 여부·Pod priority·요청을 초과한 사용량 순으로 정렬하며 QoS 자체를 정렬 키로 쓰지 않습니다
QoS와는 같은 자원 선언을 통해 간접으로 연결되며, `oom_score_adj`를 eviction 순서표로 읽으면 안 됩니다

### OOMKilled는 런타임이 기록하는 이유입니다

[`CRI ContainerStatus.reason` 규약](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cri-api/pkg/apis/runtime/v1/api.proto)은 cgroup OOM killer로 종료된 컨테이너에 런타임이 `OOMKilled`를 기록하도록 요구합니다
커널의 종료 결정, 런타임의 이유 기록, kubelet의 상태 조회는 서로 다른 단계입니다

kubelet의 [`isInitContainerFailed`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/helpers.go)는 이 이유가 있으면 종료 코드가 0이어도 init container 실패로 판단합니다
반대로 종료 코드 `137`만 보고 cgroup OOM이라고 확정해서는 안 됩니다
컨테이너 종료 이유와 cgroup·노드 상태를 함께 확인해야 합니다

cgroup v2에서는 `SingleProcessOOMKill` 설정에 따라 kubelet이 `memory.oom.group=1`을 전달하는 경로도 있습니다
이는 컨테이너의 프로세스들을 묶어 OOM 처리하도록 요청하는 설정이며, 같은 Pod의 다른 컨테이너까지 반드시 종료한다는 뜻은 아닙니다
그룹 처리에도 예외가 있으므로 [Linux의 `memory.oom.group` 정의](https://docs.kernel.org/admin-guide/cgroup-v2.html#memory-interface-files)를 함께 확인해야 합니다

## allocatable과 kubepods 한도는 같은 숫자가 아닙니다

시스템용 예약과 eviction 임계값을 Pod 배치 계산에서 제외하는 일, 노드 cgroup에 상한을 거는 일은 다른 경로입니다
다음은 Node Allocatable 집행을 사용하는 구성에서 메모리 계산 항목을 비교한 것입니다

| 값 | 계산에 반영하는 예약 |
|---|---|
| `node.status.allocatable` | capacity에서 system-reserved·kube-reserved·hard eviction 예약 차감 |
| kubepods cgroup 한도 | capacity에서 system-reserved·kube-reserved 차감 |

[`getNodeAllocatableAbsoluteImpl`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/cm/node_container_manager_linux.go)은 cgroup 집행에 쓸 값에서 eviction 예약을 빼지 않습니다
배치에서 제외할 예약량을 계산하는 `GetNodeAllocatableReservation`은 `hardEvictionReservation`까지 더합니다
실제 집행 값은 `cgroupsPerQOS`와 `enforceNodeAllocatable` 설정 조건도 따릅니다

따라서 Pod가 request를 초과해 메모리를 쓰면 배치 계산에서 제외했던 eviction 예약분까지 사용할 수 있습니다
그 결과 노드 압박이 임계값에 도달하면 kubelet의 node-pressure eviction이 개입합니다
allocatable 자체가 노드 메모리 사용을 그 숫자에서 바로 멈추게 하는 cgroup 상한은 아닙니다

## 자원 변경은 pods/resize로 처리합니다

실행 중인 Pod의 CPU·메모리는 전용 `pods/resize` 서브리소스로 변경할 수 있습니다
일반 Pod update와는 허용 필드·검증 조건·RBAC 권한이 다릅니다
따라서 자원 변경 권한을 이미지 변경 등의 일반 update 권한과 구분할 수 있습니다

| 경로 | 결정하는 내용 |
|---|---|
| `pods` update | 이미지 등 일반 update가 허용하는 필드 |
| `pods/binding` | 배치할 노드 |
| `pods/eviction` | API를 통한 축출 허용 여부 |
| `pods/resize` | 실행 중 자원 선언 변경 |

자원별 `resizePolicy`는 적용 때 컨테이너 재시작이 필요한지 지정합니다
`NotRequired`가 기본이며 재시작 없이 적용합니다
`RestartContainer`는 재시작해 적용하며, 시작 시점에 정한 메모리 설정을 실행 중 바꿀 수 없는 애플리케이션 등에서 사용합니다

변경하려는 자원 값은 spec에, 실제 적용한 값은 `status.containerStatuses[].resources`에 기록됩니다
spec이 바뀌었다는 사실만으로 노드에 적용까지 끝났다고 판단하면 안 됩니다

| 상태 조건 | 의미 |
|---|---|
| `PodResizePending`, reason `Deferred` | 현재 여유가 부족한 등 나중에 적용 가능성이 있어 재시도 |
| `PodResizePending`, reason `Infeasible` | 노드 용량 자체를 넘는 등 현재 노드에서 적용 불가능 |
| `PodResizeInProgress` | kubelet이 요청을 받아 자원을 배정했고 적용 중 |

[`ValidatePodResize`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go)는 변경 전후 QoS가 다른 요청을 거부합니다
Guaranteed는 CPU·메모리의 request=limit 관계를 유지해야 하며, Burstable을 Guaranteed로 만들거나 BestEffort에 자원 선언을 추가해 다른 등급으로 바꾸는 것도 허용하지 않습니다

`NotRequired` 정책으로 메모리 limit을 낮추는 경우, 현재 사용량이 새 limit보다 크면 적용을 건너뛰고 InProgress에 머물 수 있습니다
이는 OOM을 피하려는 best effort 검사입니다
검사 직후 메모리 사용량이 늘어날 수 있으므로 OOM 방지를 보장하지는 않습니다
이 상태와 제약은 [공식 resize 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/tasks/configure-pod-container/resize-container-resources.md#limitations)에 설명되어 있습니다

### v1.37.1에서 확인한 기능 상태

아래는 [`defaultVersionedKubernetesFeatureGates`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go)의 v1.37 동작 기준입니다
실제 클러스터의 설정을 조회한 결과는 아닙니다

| 기능 | 상태와 조건 |
|---|---|
| `InPlacePodVerticalScaling` | v1.35 GA·기본 on·잠김 |
| `PodLevelResources` | v1.34 Beta·기본 on |
| `InPlacePodLevelResourcesVerticalScaling` | v1.36 Beta·기본 on |
| `MemoryQoS` | v1.37 Beta·기본 on, 보호·throttling 설정은 별도 |
| `CustomCPUCFSQuotaPeriod` | v1.36 GA·기본 on, 고정 소스의 등록 항목에는 `LockToDefault` 없음 |

마지막 기능의 Go 상수 이름은 `CPUCFSQuotaPeriod`이고 설정에 쓰는 gate 문자열은 `CustomCPUCFSQuotaPeriod`입니다
소스 주석에 적힌 잠금 예정 시점만으로 실제 등록에 없는 잠금 상태를 단정해서는 안 됩니다
이전에 GA로 등록되어 있던 `MemoryManager` gate는 이 고정 소스에서 제거되어 있으며, NUMA를 고려하는 메모리 관리 기능 자체가 사라졌다는 뜻은 아닙니다

## 증상을 해석할 때는 판단 주체를 먼저 나눕니다

| 증상 | 먼저 구분할 값과 경로 |
|---|---|
| Pending, `Insufficient cpu`·`Insufficient memory` | 스케줄러의 request·allocatable·이미 배치된 요청 합계 |
| 실행되지만 CPU 지연 | CPU quota와 throttling. 평균 사용률만으로 quota 도달 여부를 판단하지 않음 |
| `OOMKilled` 종료 | 런타임이 전달한 이유, 메모리 한도와 OOM 범위 |
| 노드 압박으로 Pod 축출 | kubelet의 압박 신호와 eviction 판단 |
| 예상과 다른 QoS | 모든 대상의 CPU·메모리 관계, Pod-level 선언 여부 |
| resize 대기 | spec과 적용 상태 차이, Pending reason·InProgress message |

`Insufficient memory`는 배치 요청을 수용할 노드를 찾지 못한 결과이고 `OOMKilled`는 실행 뒤 컨테이너 종료 이유입니다
이 둘을 나누면 자원 선언의 문제인지, 노드에서 실행 중인 프로세스의 사용량과 상한 문제인지부터 좁힐 수 있습니다
