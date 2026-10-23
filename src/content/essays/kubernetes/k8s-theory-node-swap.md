---
title: "노드 swap — 기동 허용과 컨테이너 한도, 배치 계산을 구분하기"
excerpt: "failSwapOn과 LimitedSwap이 여는 범위를 나누고, 컨테이너별 swap 자격과 비례 한도가 CRI·cgroup에 전달되는 과정을 살펴봅니다. 스케줄러·축출·통계가 swap을 다루는 경계도 확인합니다"
category: "kubernetes"
tags: ["Kubernetes", "NodeSwap", "Swap", "Kubelet", "cgroup", "ResourceManagement", "concept"]
series:
  name: "k8s-theory-node"
  order: 16
date: "2026-09-23"
---

노드에서 swap을 켜고 kubelet의 기동을 허용해도 Pod가 곧바로 swap을 쓰지는 않습니다
kubelet을 시작할 수 있는지와 컨테이너에 얼마의 swap을 허용할지는 별도 설정과 검사로 결정합니다

swap은 RAM의 페이지를 다른 저장 공간으로 내보내 물리 메모리를 회수하는 수단입니다
디스크를 사용한다면 다시 읽어 올 때 I/O가 필요하며, swap을 추가한 용량이 스케줄러의 메모리 배치량에 그대로 더해지는 것도 아닙니다

Linux 노드에서 설정 하나가 기동 검사, 컨테이너 자격 판정, cgroup 상한으로 이어지는 과정을 따라가겠습니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 커널 비교는 Linux v6.3·v6.4, cgroup·VM 설명은 v6.12를 확인했습니다
> 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## 기동 허용과 워크로드 정책을 따로 정합니다

`KubeletConfiguration`의 `failSwapOn` 기본값은 `true`입니다
Linux kubelet은 `/proc/swaps`를 읽고 헤더 외에 항목이 있으면 swap이 켜졌다고 판단합니다
이때 기본 설정에서는 기동을 거부합니다

`failSwapOn: false`는 이 기동 제한을 해제합니다
swap을 만들거나 켜는 설정도, Pod에 swap 사용을 허용하는 설정도 아닙니다

워크로드 정책은 `memorySwap.swapBehavior`로 선택합니다

| 값 | 워크로드에 적용하는 정책 |
|---|---|
| 미지정 또는 `NoSwap` | 기본 정책, 컨테이너의 swap 사용을 허용하지 않음 |
| `LimitedSwap` | 자격 조건을 통과한 컨테이너에 계산한 swap 한도 적용 |

다음은 두 결정을 보여 주는 kubelet 설정 조각입니다
노드의 swap 프로비저닝 절차나 실측 결과를 뜻하지 않습니다

```yaml
failSwapOn: false
memorySwap:
  swapBehavior: LimitedSwap
```

`failSwapOn`만 `false`로 바꾸고 `swapBehavior`를 생략하면 기본 정책은 `NoSwap`입니다
이렇게 kubelet을 기동한 노드에서도 systemd 서비스나 kubelet 자체처럼 Kubernetes 관리 컨테이너 밖의 프로세스는 swap을 사용할 수 있습니다
노드 전체의 swap 사용 여부와 워크로드 정책을 구분해야 하는 이유입니다

![kubelet 기동을 허용한 뒤 LimitedSwap 정책에서 조건을 검사하고 컨테이너별 상한을 계산해 CRI와 런타임을 통해 cgroup에 적용하는 과정|tall](/diagrams/k8s-theory-node-swap-1.svg)

v1.37.1의 `NodeSwap`은 v1.34부터 GA이며 기본 on에 잠겨 있습니다
현재 소스에는 기능 게이트의 심볼·등록과 검사 분기가 남아 있지만, 관리자가 이를 off로 바꿔 사용할 수는 없습니다
GA라는 사실이 `LimitedSwap`을 기본 정책으로 만든다는 뜻도 아닙니다

기동 판단은 [`NewContainerManager`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/cm/container_manager_linux.go), 기본값은 [`SetDefaults_KubeletConfiguration`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/apis/config/v1beta1/defaults.go), 게이트 상태는 [`NodeSwap` 등록](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go)을 기준으로 확인했습니다

## LimitedSwap도 컨테이너마다 다시 판단합니다

`LimitedSwap`은 cgroup v2에서 지원합니다
cgroup은 프로세스 집단의 자원 사용을 제어하는 Linux 기능이며, kubelet은 컨테이너 런타임에 설정을 전달해 컨테이너 cgroup에 한도를 적용합니다

cgroup v1 노드에 `LimitedSwap`을 설정하면 조용히 무시하지 않고 kubelet 기동에서 실패합니다
v1.37.1은 별도의 `failCgroupV1`도 기본 `true`이므로, cgroup v1 자체를 기본으로 허용하지 않습니다
그 뒤의 자격 검사는 실제 컨테이너에 적용할 정책을 결정하는 단계입니다

[`GetContainerSwapBehavior`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_container_linux.go)는 다음 조건에 걸리면 `NoSwap`을 반환합니다

| 판정 단위 | 제외 조건 |
|---|---|
| 노드 | `NodeSwap`이 꺼짐. 현행 버전에서는 on에 잠겨 있는 검사 |
| 노드 | swap cgroup controller를 사용할 수 없음 |
| 노드 | cgroup v2가 아님 |
| Pod | critical Pod에 해당 |
| Pod | QoS가 Burstable이 아님 |
| 컨테이너 | memory request와 limit이 모두 0이거나, 둘의 값이 같음 |

여기서 QoS는 CPU·메모리 자원 선언으로 계산하는 Pod 등급입니다
현재 기본 설정의 [`ComputePodQOS`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/v1/helper/qos/qos.go)는 Pod 수준 자원이 설정돼 있으면 `spec.resources`로 먼저 등급을 계산합니다
Pod 수준 계산 경로를 사용하지 않을 때는 컨테이너별 선언을 기준으로 모든 대상에 CPU·메모리 양쪽의 양수 request=limit이 있으면 Guaranteed, 두 자원의 선언이 모두 없거나 0이면 BestEffort, 나머지는 Burstable입니다

`LimitedSwap`은 정책상 Guaranteed와 BestEffort를 제외합니다
컨테이너 수준 선언으로 QoS를 계산한 BestEffort는 memory request도 0이어서 비례식에 넣어도 한도가 0입니다

Guaranteed라는 분류가 물리 메모리의 상주나 OOM·축출에서의 절대 생존을 보장한다는 뜻은 아닙니다

critical 판정도 단순히 우선순위가 높은 Pod라는 설명보다 넓습니다
[`IsCriticalPod`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/types/pod_update.go)는 static Pod, mirror Pod, `spec.priority`가 시스템 critical 기준 이상인 Pod를 포함합니다

### Pod의 QoS와 컨테이너의 request를 구분합니다

같은 Burstable Pod 안에서도 컨테이너별 결과는 달라질 수 있습니다
한 컨테이너의 memory request와 limit이 같으면 그 컨테이너에는 `NoSwap`을 적용합니다

반대로 request가 양수이고 limit이 없으면 두 값은 다르므로, 다른 조건을 통과했을 때 비례 계산 대상이 됩니다
request가 명시적인 0이고 limit만 양수라면 자격 검사를 통과해도 계산되는 swap 한도는 0입니다
이 비교는 API 기본값 처리와 admission을 거친 실제 컨테이너 자원 선언을 기준으로 읽어야 합니다

Pod 단위 자원 선언인 `spec.resources`만 보고 swap 한도를 계산하지도 않습니다
Pod QoS를 통과한 뒤의 비교와 계산은 `container.resources.requests.memory`와 `limits.memory`를 직접 읽습니다
Pod-level memory request가 있어도 컨테이너 양쪽 값이 0이면 이 조건에서 제외됩니다

## 한도는 memory request 비율로 계산합니다

자격을 통과하면 kubelet은 컨테이너의 memory request, 노드 전체 RAM, 노드 swap 용량으로 한도를 계산합니다
사용자가 컨테이너의 swap request나 swap limit을 별도 자원 필드에 적는 방식은 아닙니다

```text
컨테이너 swap 상한
  = (컨테이너 memory request / 노드 전체 RAM) × 노드 swap 용량
```

[`calcSwapForBurstablePods`와 호출부](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_container_linux.go)는 노드 RAM에 `MachineInfo.MemoryCapacity`, swap에 `MachineInfo.SwapCapacity`를 전달합니다
분모는 스케줄러에 알리는 allocatable이 아니라 노드의 전체 메모리입니다
계산 결과는 정수 바이트로 바꿔 사용합니다

함수의 swap 인자 이름은 `totalPodsSwapAvailable`이지만, 이 버전의 호출부는 노드 swap 전체 용량을 넣습니다
시스템용 swap 예약량을 별도로 뺀 값이라고 해석하면 안 됩니다

노드 메모리가 0 이하이거나 컨테이너 memory request가 노드 전체 메모리보다 크면 계산은 실패합니다
이 경우 호출부는 오류를 기록하고 해당 컨테이너를 `NoSwap`으로 설정합니다
계산 오류를 허용량 무제한으로 바꾸지 않습니다

### 비례식은 swap 예약을 만들지 않습니다

같은 노드 RAM과 swap 용량을 입력으로 쓰는 컨테이너들의 한도를 더하면, 한도 합도 memory request 합에 비례합니다
동시에 실행할 컨테이너의 memory request 합이 노드 RAM 이하라는 전제에서는 계산한 한도 합도 노드 swap 이하가 됩니다

일반적인 스케줄러의 memory request 회계가 이 입력을 제한하는 데 도움을 줍니다
그러나 이 식 자체가 직접 바인딩한 Pod나 배치 이후의 변경을 검증하거나 swap을 예약하지는 않습니다
메모리 요청 합과 실제 사용량도 서로 다르므로 I/O 경합이나 swap 부족을 모두 막는 장치로 읽으면 안 됩니다

swap을 쓰지 못하는 Pod 몫을 다른 컨테이너에 재분배하는 계산도 없습니다
한도는 사용량 보장이나 특정 swap 영역의 독점 배정이 아니며, 노드의 시스템 프로세스도 swap을 사용할 수 있습니다

## kubelet이 값을 전달하고 런타임이 cgroup에 적용합니다

cgroup v2와 swap controller를 사용할 수 있으면 kubelet은 CRI의 `LinuxContainerResources.Unified` 맵에 `memory.swap.max` 값을 넣습니다
CRI는 kubelet과 컨테이너 런타임이 자원 설정과 실행 요청을 주고받는 인터페이스입니다

[`configureSwap`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_container_linux.go)가 계산한 바이트 수를 문자열로 전달하면, 런타임이 컨테이너 cgroup에 적용합니다
`NoSwap` 경로는 같은 키에 `0`을 전달합니다

`memory.swap.max`는 cgroup v2의 swap 사용 상한입니다
RAM 사용 상한인 `memory.max`와 별도이며, 메모리와 swap을 합한 상한으로 읽으면 안 됩니다
파일 의미는 [Linux cgroup v2 문서](https://github.com/torvalds/linux/blob/v6.12/Documentation/admin-guide/cgroup-v2.rst)에서 확인할 수 있습니다

swap controller를 감지하지 못하면 이 설정 경로는 값을 보내지 않고 반환합니다
따라서 `NoSwap`이라는 정책명만 보고 어떤 노드에서든 동일한 파일에 `0`이 쓰였다고 단정할 수는 없습니다

### cgroup v1의 NoSwap은 제어 방식이 다릅니다

cgroup v1 기동을 별도로 허용한 환경에서 controller가 있으면 `ConfigureNoSwap`은 CRI의 `MemorySwapLimitInBytes`를 `MemoryLimitInBytes`와 같게 둡니다
이때 해당 값은 메모리와 swap을 합한 한도입니다
메모리 상한을 넘는 추가 swap 여유를 없애는 방식이며, 소스 주석도 일부 swap이 가능하다고 설명합니다

또한 메모리 한도가 0이면 이 swap 한도는 무시됩니다
cgroup v2의 `memory.swap.max=0`과 cgroup v1의 동작을 같은 보장으로 취급하지 않아야 합니다
워크로드의 `LimitedSwap` 지원 범위는 앞서 본 것처럼 cgroup v2입니다

## 메모리 볼륨에는 tmpfs noswap을 확인합니다

`emptyDir.medium: Memory`와 Secret 볼륨은 Linux에서 tmpfs를 사용합니다
tmpfs는 메모리를 사용하는 파일시스템이지만, 그 이름만으로 내용이 디스크 swap에 나가지 않는다고 보장하지는 않습니다
kubelet은 지원되는 환경에서 tmpfs 마운트에 `noswap` 옵션을 붙입니다

[`IsTmpfsNoswapOptionSupported`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/util/swap/swap_util.go)의 판정 순서는 다음과 같습니다

1. kubelet 프로세스가 사용자 네임스페이스 안에서 실행되면 미지원으로 판단합니다
2. 커널 버전을 읽지 못하면 미지원으로 판단합니다
3. 커널 버전이 소스 상수 `6.4` 이상이면 지원한다고 판단합니다
4. 더 낮은 버전이면 임시 디렉토리에 `noswap` tmpfs 마운트를 시험합니다. 성공하면 지원으로 판정하고 마운트를 해제합니다

구버전 배포판이 옵션을 백포트했을 수 있으므로 버전 숫자만으로 모두 거부하지 않는 구조입니다
여기서 사용자 네임스페이스 검사는 kubelet 자신이 실행되는 환경에 대한 판정입니다
Pod에 user namespace를 사용한다는 이유만으로 곧바로 같은 분기에 들어가는 것은 아닙니다

공식 [Swap memory management](https://kubernetes.io/docs/concepts/cluster-administration/swap-memory-management/)와 [Linux Kernel Version Requirements](https://kubernetes.io/docs/reference/node/kernel-version-requirements/)는 지원 버전을 `6.3`으로 적고 있습니다
그러나 kubelet의 [`TmpfsNoswapSupportKernelVersion`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/util/kernel/constants.go)은 `6.4`이며, Linux [`v6.3`](https://github.com/torvalds/linux/blob/v6.3/mm/shmem.c)에는 없던 `noswap` 파서가 [`v6.4`](https://github.com/torvalds/linux/blob/v6.4/mm/shmem.c)에 있습니다
이 글에서는 실제 kubelet의 `6.4` 기준과 낮은 버전에서의 마운트 시험을 기준으로 설명합니다

swap이 켜진 노드에서 기동을 허용했는데 `noswap`을 지원하지 않으면 kubelet은 `PossibleMemoryBackedVolumesOnDisk` Warning 이벤트를 남깁니다
이 경고만으로 기동을 중단하지는 않습니다
메모리 볼륨의 내용이 디스크로 나갈 수 있다는 조건을 보존해야 하며, swap 암호화는 kubelet 설정 밖의 OS 구성입니다

실제 마운트 옵션 추가는 [`emptyDir.setupTmpfs`와 `generateTmpfsMountOptions`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/emptydir/empty_dir.go), Secret의 메모리 emptyDir 사용은 [`wrappedVolumeSpec`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/secret/secret.go)에서 확인했습니다

## 스케줄러의 memory 회계에는 swap이 더해지지 않습니다

스케줄러는 Pod의 memory request를 노드 allocatable과 이미 배치한 요청량에 대조합니다
swap 용량을 memory allocatable에 더하거나, swap 사용량으로 새 Pod의 배치 가능량을 계산하지 않습니다
swap에 별도의 request를 선언하는 모델이 아니기 때문입니다

[swap의 배치 제약을 설명한 공식 문서](https://kubernetes.io/docs/concepts/cluster-administration/swap-memory-management/#swap-aware-scheduling)와 [`NodeResourcesFit`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/noderesources/fit.go)의 memory 비교가 이 경계를 보여 줍니다

Pod overhead는 계산해서 붙이는 값이어도 자원 요청 합에 포함됩니다
반면 swap 한도는 컨테이너 실행 설정으로 계산할 뿐, 새로운 배치 자원 요청으로 더하지 않습니다
계산해서 생긴 값인지보다 어느 회계에 포함하는지가 다릅니다

노드의 taint나 label로 swap 노드에 배치할 자격을 구분할 수는 있습니다
하지만 자격을 제한하는 정책과 남은 swap 수량을 세어 배치하는 기능은 별개입니다

## 메모리 압박의 축출도 swap 사용량 자체를 임계로 삼지 않습니다

kubelet의 node-pressure eviction은 노드 메모리 부족을 감지하면 회수와 Pod 축출을 시도하는 경로입니다
메모리 가용량 신호는 내부 Summary의 `Memory.AvailableBytes`를 사용하고, Pod의 메모리 사용량을 비교하는 `memoryUsage`는 `WorkingSetBytes`를 읽습니다
swap 사용량을 더해 Pod의 메모리 사용량으로 계산하지 않습니다

working set은 현재 물리 메모리 사용에서 회수할 수 있다고 보는 일부 파일 페이지를 제외한 값입니다
RSS와 같지 않으며 모든 캐시를 뺀 값도 아닙니다
페이지가 swap으로 나가면 물리 메모리의 사용량과 working set이 달라질 수 있지만, swap 사용량 증가 자체가 메모리 축출 임계를 넘었다는 뜻은 아닙니다

[`eviction/api`의 신호 정의](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/eviction/api/types.go), [`makeMemoryAvailableSignalObservation`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/eviction/helpers_others.go), [`memoryUsage`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/eviction/helpers.go)를 대조하면 swap 전용 압박 신호와 swap 사용량 기반 축출 순위가 없음을 확인할 수 있습니다

### 커널 회수와 kubelet 축출의 순서를 함께 봅니다

kubelet이 커널의 회수·swap out보다 먼저 Pod를 축출하면 워크로드가 swap을 쓸 여지가 줄어듭니다
반대로 축출을 너무 늦추면 회수로 메모리를 확보하지 못한 상황에서 커널 OOM이 먼저 개입할 수 있습니다
swap이 있다고 OOM이나 축출이 사라지는 것은 아닙니다

공식 문서는 이 순서를 고려해 `vm.min_free_kbytes`와 kubelet 축출 임계를 조정하도록 권고합니다
다만 [`vm.min_free_kbytes`](https://github.com/torvalds/linux/blob/v6.12/Documentation/admin-guide/sysctl/vm.rst)는 커널이 메모리 영역별 최소 여유 페이지 기준인 `WMARK_MIN`을 계산하는 입력입니다
kubelet의 working set 기반 `memory.available`과 같은 지표가 아니므로 두 숫자를 그대로 비교해 보편적인 안전값을 정할 수는 없습니다

커널 OOM, cgroup의 메모리 상한, kubelet의 node-pressure eviction은 각각 별도 경로입니다
Guaranteed나 높은 Pod priority만으로 모든 경로에서 살아남는다고 해석하지 않아야 합니다

## 용량 정보와 사용량 통계를 구분합니다

노드가 알려 주는 swap 용량은 `status.capacity.memory`가 아니라 `status.nodeInfo.swap.capacity`에 기록됩니다
[`MachineInfo` 상태 세터](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/nodestatus/setters.go)는 감지한 swap 용량이 0이 아니면 이 필드를 설정합니다
필드가 없다는 사실만으로 swap을 만들지 않은 경우와 kubelet이 용량을 알아내지 못한 경우를 구분할 수는 없습니다

Node status가 용량을 보고한다는 사실을 kubelet 전체가 용량만 보고한다는 뜻으로 넓혀 읽으면 안 됩니다
사용량과 가용량은 별도 통계 경로에 있습니다

| 경로 | 확인할 값과 의미 |
|---|---|
| Node status | `status.nodeInfo.swap.capacity`, 감지한 노드 swap 용량 |
| `/stats/summary` | `swapUsageBytes`, 현재 사용량. `swapAvailableBytes`, 한도에서 사용량을 뺀 값 |
| `/metrics/resource` | `node_swap_usage_bytes`, `container_swap_usage_bytes`, `pod_swap_usage_bytes`, 사용량 |
| `/metrics/resource` | `container_swap_limit_bytes`, 통계의 가용량과 사용량으로 구성한 컨테이너 한도 |

[`SwapStats`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kubelet/pkg/apis/stats/v1alpha1/types.go)는 swap 한도가 정의되지 않으면 `swapAvailableBytes`를 생략할 수 있습니다
[`resourceMetricsCollector`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/metrics/collectors/resource_metrics.go)도 필요한 통계 필드가 있는지 확인한 뒤 지표를 내보냅니다
따라서 지표 부재를 사용량 0과 같게 취급하지 않아야 합니다

통계의 제공 경로에도 차이가 있습니다
cAdvisor 변환은 유한한 swap 한도가 있을 때 가용량을 계산하고, CRI 경로는 런타임의 swap 필드를 변환하며 Pod 통계를 컨테이너들로부터 합산하는 경로도 있습니다
특히 현재 CRI 변환은 런타임의 swap 통계 자체가 없으면 0으로 채우는 분기가 있어, 노출된 0이 항상 커널에서 측정한 0이라는 뜻은 아닙니다

이 경계는 [`cadvisorInfoToSwapStats`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/stats/helper.go), [`makeContainerCPUAndMemoryStats`와 `aggregatePodSwapStats`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/stats/cri_stats_provider.go)에서 확인했습니다
관측할 수 있다는 사실과 스케줄러·축출이 그 값을 판단에 사용한다는 사실을 구분해야 합니다

## 실패 지점을 설정과 판정 단위로 찾습니다

| 증상·메시지 | 먼저 확인할 경계 |
|---|---|
| `running with swap on is not supported, please disable swap or set --fail-swap-on flag to false` | swap을 감지했고 `failSwapOn`이 기동을 거부하는지 확인 |
| `swap feature is enabled and LimitedSwap but it is only supported with cgroupv2` | `LimitedSwap`을 cgroup v1에서 설정했는지 확인 |
| `NoSwap is set due to memorySwapBehavior not specified` | 기동 제한만 해제하고 워크로드 정책은 생략했는지 확인 |
| 같은 Burstable Pod에서 일부 컨테이너만 swap 한도 0 | 컨테이너별 memory request=limit 여부와 request 0 여부 확인 |
| Burstable인데 모두 swap 한도 0 | critical Pod 여부, controller 가용성, 컨테이너 자원 선언 확인 |
| `Cannot calculate swap allocation amount; disallowing swap` | 노드 전체 메모리와 컨테이너 request가 비례식의 입력 조건을 충족하는지 확인 |
| `PossibleMemoryBackedVolumesOnDisk` Warning 이벤트 | tmpfs `noswap` 지원과 kubelet의 사용자 네임스페이스 실행 여부 확인 |
| swap은 늘었지만 배치 가능량·축출 판단은 그대로 | swap의 실행 한도·통계와 memory request·메모리 압박 회계를 구분 |

## 확인한 문서와 소스

- [Kubernetes Swap memory management](https://kubernetes.io/docs/concepts/cluster-administration/swap-memory-management/)와 [Linux Node Swap Behaviors](https://kubernetes.io/docs/reference/node/swap-behavior/): 정책의 목적과 지원 범위. 문서 저장본은 도입부의 website ref를 사용했으며 tmpfs 지원 버전은 본문의 소스 대조를 우선했습니다
- [kubelet `run`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kubelet/app/server.go), [`IsSwapOn`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/util/swap/swap_util.go), [설정 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/apis/config/validation/validation.go): 기동 검사, 정책 미지정 시 처리, 허용 값
- [CRI `LinuxContainerResources`·`SwapUsage`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cri-api/pkg/apis/runtime/v1/api.proto): cgroup v2 설정 맵, cgroup v1용 swap 필드, 통계 전달 계약
- [Linux cgroup v2](https://github.com/torvalds/linux/blob/v6.12/Documentation/admin-guide/cgroup-v2.rst), [VM sysctl](https://github.com/torvalds/linux/blob/v6.12/Documentation/admin-guide/sysctl/vm.rst): swap 한도와 `min_free_kbytes`의 의미
