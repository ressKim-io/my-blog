---
title: "Eviction과 OOM — 컨테이너 종료와 Pod 삭제를 구분합니다"
excerpt: "커널의 OOM, kubelet의 node-pressure eviction, Eviction API가 남기는 상태를 비교합니다. 메모리 신호와 축출 순위, hard·soft의 두 유예 시간, 압박 해제와 새 Pod 수용 조건을 소스에서 확인합니다"
category: "kubernetes"
tags: ["Kubernetes", "Eviction", "OOM", "kubelet", "cgroup", "concept"]
series:
  name: "k8s-theory-node"
  order: 6
date: "2026-09-09"
---

컨테이너가 종료됐다는 사실과 Pod가 삭제됐다는 사실은 다릅니다
커널이 메모리 부족으로 프로세스를 종료할 수도 있고, kubelet이 노드의 자원 부족을 해소하려고 Pod를 축출할 수도 있습니다
사용자가 Eviction API로 Pod 삭제를 요청하는 경로도 있습니다

어느 경로였는지 구분하려면 종료 후 무엇이 남았는지부터 봐야 합니다
컨테이너의 종료 상태, Pod의 실패 이유, 오브젝트의 삭제 기록은 서로 다른 사건을 설명합니다

> **근거**: Linux cgroup v2 문서, Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## 세 경로는 종료 후 남기는 상태가 다릅니다

OOM은 메모리가 부족해 할당을 이어갈 수 없는 상태입니다
여기서는 먼저 컨테이너에 적용된 cgroup의 메모리 한도에 닿은 경우를 kubelet 축출, API 삭제와 비교합니다

![커널의 cgroup OOM, kubelet의 node-pressure 축출, API 서버의 Eviction 요청이 남기는 상태와 후속 처리|tall](/diagrams/k8s-theory-eviction-oom-1.svg)

커널의 cgroup OOM은 Pod 오브젝트를 직접 삭제하지 않습니다
컨테이너가 종료되면 kubelet은 런타임이 보고한 종료 상태를 읽고, 적용되는 재시작 정책에 따라 컨테이너를 다시 실행할 수 있습니다

kubelet의 **node-pressure eviction**은 노드의 메모리·디스크·PID 여유가 부족할 때 Pod를 종료해 자원을 회수하는 경로입니다
축출된 Pod는 `Failed`, `status.reason: Evicted`로 남을 수 있습니다
Pod 오브젝트를 정리하는 별도 삭제가 오기 전까지 이 상태를 확인할 수 있습니다

**Eviction API**는 `pods/eviction` 서브리소스에 보내는 정책 기반 삭제 요청입니다
API 서버가 삭제를 허용하면 Pod에 삭제 시각이 기록되고, kubelet이 이를 보고 컨테이너 종료를 진행합니다
종료 유예와 finalizer 등 삭제 조건이 해소되면 오브젝트도 사라집니다

어느 경우든 대체 Pod를 만드는 일은 별도입니다
Pod를 관리하는 컨트롤러가 있어야 원하는 개수를 복구할 수 있으며, 새 Pod가 다른 노드에 배치된다는 보장도 없습니다

## OOMKilled는 컨테이너 종료 상태에서 확인합니다

[Linux의 `memory.max`](https://docs.kernel.org/admin-guide/cgroup-v2.html#memory-interface-files)는 cgroup의 메모리 사용량에 적용하는 hard limit입니다
한도에 닿고 메모리 회수로도 사용량을 줄이지 못하면 커널이 해당 cgroup 안에서 OOM killer를 실행할 수 있습니다
종료 대상은 프로세스이며, 그룹 종료 여부는 `memory.oom.group` 등의 조건에 따라 달라집니다

런타임이 종료 이유를 `OOMKilled`로 보고하면 kubelet은 그 이유와 exit code를 컨테이너 상태에 반영합니다
[`toKubeContainerStatus`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_container.go)의 종료 상태 변환에서 런타임의 `Reason`, `ExitCode`를 읽는 경로를 볼 수 있습니다

재시작했다면 `status.containerStatuses[].lastState.terminated`를 확인합니다
`reason: OOMKilled`는 OOM 종료를 구분하는 근거지만, `exitCode: 137`만으로 OOM을 확정할 수는 없습니다
강제 종료도 같은 종료 코드를 남길 수 있기 때문입니다

또한 `OOMKilled`만으로 컨테이너 자신의 한도 초과와 노드 전역 OOM을 구분하지는 못합니다
한도와 cgroup의 `memory.events`, 커널 기록 등 발생 범위를 알 수 있는 근거가 더 필요합니다
커널 문서의 `oom_kill`도 해당 cgroup에서 OOM killer가 종료한 프로세스 수를 합산하며, **OOM killer의 종류는 구분하지 않습니다**

OOM 종료 자체는 Pod의 `DisruptionTarget` 조건을 설정하거나 Pod 전체를 삭제하는 사건이 아닙니다
이 조건이 없다는 이유만으로 OOM이라고 역으로 판정해서도 안 됩니다

## kubelet은 자원 여유를 임계값과 비교합니다

eviction manager는 내부 Summary provider에서 받은 자원 통계를 임계값과 비교합니다
컨테이너 한도의 집행과 달리, 노드나 전체 Pod 영역에 남은 자원을 보는 판단입니다

| 신호 | 연결되는 노드 조건 |
|---|---|
| `memory.available`, `allocatableMemory.available` | `MemoryPressure` |
| `nodefs.available`, `nodefs.inodesFree` | `DiskPressure` |
| `imagefs.available`, `imagefs.inodesFree` | `DiskPressure` |
| `containerfs.available`, `containerfs.inodesFree` | `DiskPressure` |
| `pid.available` | `PIDPressure` |

`nodefs`는 노드의 파일시스템, `imagefs`는 런타임의 이미지 저장 영역을 가리킵니다
`containerfs`는 쓰기 가능한 컨테이너 계층을 구분하는 식별자이며, 구성에 따라 다른 식별자와 같은 파일시스템을 가리킬 수도 있습니다
지원과 분리 여부는 런타임·기능 설정에 달려 있으므로 세 이름을 항상 별도 디스크로 읽으면 안 됩니다

## 한 주기의 node-pressure 축출은 최대 한 Pod입니다

eviction manager는 먼저 노드 수준에서 회수할 수 있는 자원을 살펴봅니다
디스크 부족 때 미사용 이미지나 종료된 컨테이너를 정리해 압박을 해소하면 실행 중인 Pod를 축출할 필요가 없습니다

그 뒤 node-pressure 임계값을 처리하는 루프는 한 주기에 최대 한 Pod를 축출합니다
선택된 Pod의 정리를 최대 30초 동안 기다리며 1초마다 완료 여부를 확인한 뒤 다시 통계를 봅니다
이 정리 완료 대기는 컨테이너 종료에 허용하는 유예와도 별도입니다

종료 효과를 보기 전에 같은 부족 신호로 여러 Pod를 제거하면 필요 이상으로 축출할 수 있습니다
한 번씩 다시 측정하면 그 위험을 줄이지만, 메모리 소모가 급격할 때 회수가 소모 속도를 따라잡지 못할 수 있습니다
커널 OOM과 kubelet 축출이 언제나 고정된 순서로 일어난다고 기대할 수는 없습니다

한 주기에 한 Pod라는 범위는 **node-pressure 임계값 축출 루프**에 해당합니다
그보다 앞서 실행하는 local storage limit 축출은 여러 Pod를 반환할 수 있으므로, eviction manager의 모든 축출을 이 규칙으로 묶지 않습니다

[`evictPod`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/eviction/eviction_manager.go)는 `IsCriticalPod`가 참이면 축출을 거부합니다
확인한 버전의 [`IsCriticalPod`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/types/pod_update.go)는 시스템 critical 우선순위뿐 아니라 static Pod와 mirror Pod도 포함합니다
이 보호는 해당 kubelet 축출 경로의 규칙이며, 커널 OOM까지 막아 주는 보호는 아닙니다

## memory.available은 전체 사용량을 뺀 값과 다릅니다

[`SignalMemoryAvailable`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/eviction/api/types.go)의 기본 정의는 `capacity - workingSet`입니다
working set은 현재 사용 중인 메모리 가운데 회수 가능하다고 보는 일부를 제외한 값입니다
Linux에서는 비활성 파일 페이지인 `inactive_file`을 제외하므로, 전체 사용량이나 `free` 출력과 같은 숫자가 아닙니다

여기서 모든 페이지 캐시를 제외한다고 일반화하면 안 됩니다
활성 파일 페이지도 working set에 남을 수 있으므로, 캐시가 많다는 이유만으로 축출이 일어나지 않는다고 보장할 수 없습니다

v1.37의 `HugepageAwareEviction`은 Beta이며 기본으로 켜져 있습니다
hugepage를 예약한 노드에서는 [`adjustForHugePages`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/server/stats/summary.go)가 노드의 `AvailableBytes`에서 전체 hugepage capacity를 추가로 빼고 0 아래로 내려가지 않게 합니다
따라서 이 조건에서는 단순한 `capacity - workingSet`에 그 보정까지 적용한 값이 eviction manager에 전달됩니다

## hard와 soft에서는 두 종류의 시간을 나눠 봅니다

첫 번째 시간은 **축출을 시작하기 전에 부족 상태가 이어지는지 기다리는 기간**입니다
soft 임계값에는 `--eviction-soft-grace-period`가 필요하며, 그 기간 동안 부족 상태가 유지돼야 축출할 수 있습니다
hard는 이 soft 대기를 두지 않습니다

두 번째 시간은 **축출할 Pod를 고른 뒤 컨테이너 종료에 주는 유예**입니다
[`synchronize`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/eviction/eviction_manager.go)는 발동 조건을 확인한 뒤 이 종료 유예의 override를 별도로 정합니다

![soft의 부족 상태 지속 대기와 Pod 선택 후 종료 유예를 분리하고 hard의 1초 override와 런타임 최소 종료 시간을 보여 주는 흐름|tall](/diagrams/k8s-theory-eviction-oom-2.svg)

| 구분 | hard | soft |
|---|---|---|
| 임계값 설정 | `--eviction-hard` | `--eviction-soft` |
| 발동 전 대기 | soft 유예 없음 | `--eviction-soft-grace-period` 동안 부족 상태 유지 |
| 종료 override | 소스상 `1`초 | 설정한 max와 Pod 종료 유예 중 작은 값 |
| max가 기본 `0`일 때 | hard의 1초 사용 | soft 종료 override는 0초 |

표의 soft 종료 계산은 `--eviction-max-pod-grace-period`를 0 이상으로 설정한 경우입니다
Pod의 `terminationGracePeriodSeconds`는 이 상한을 늘리지 못하지만 줄일 수 있습니다

### 문서의 hard 0s는 소스의 정확한 종료 시간과 다릅니다

[공식 node-pressure 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/scheduling-eviction/node-pressure-eviction.md#hard-eviction-thresholds)는 hard eviction을 `0s` 유예로 설명합니다
그러나 확인한 소스의 `immediateEvictionGracePeriodSeconds`는 `1`입니다

[`killContainer`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_container.go)는 override를 받은 뒤 종료 hook인 `preStop`이 있고 유예가 양수이면 실행을 시도합니다
hook을 기다린 시간도 유예에서 빼므로 hard의 1초로 hook 완료를 보장하지는 않습니다
soft override가 0이면 이 hook 대기를 하지 않습니다

이후 런타임에 `StopContainer`를 요청하기 전에는 남은 유예에 최소 2초를 적용합니다
preStop 대기와 런타임 종료 요청은 다른 단계이므로, hard가 정확히 1초 또는 2초 안에 끝난다는 의미가 아닙니다
Pod의 원래 긴 종료 유예를 그대로 기다리지 않는다는 문서의 취지와 구현의 세부 값을 구분해야 합니다

## 메모리 축출 순위는 QoS 이름으로 정하지 않습니다

노드 수준의 회수로 압박을 해소하지 못해 Pod를 골라야 한다면 다음 순위를 적용합니다

[`rankMemoryPressure`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/eviction/helpers.go)는 세 비교 함수를 순서대로 적용합니다
통계를 얻은 Pod끼리는 앞선 비교에서 순위가 갈리면 뒤의 비교를 하지 않습니다

| 순서 | 비교 기준 | 먼저 축출할 쪽 |
|---:|---|---|
| 1 | working set이 메모리 요청을 초과하는가 | 요청을 초과한 Pod |
| 2 | `spec.priority` | 우선순위가 낮은 Pod |
| 3 | `workingSet - request` | 차이가 더 큰 Pod |

세 번째는 요청에 대한 사용률이나 배수가 아니라 **사용량에서 요청량을 뺀 절대량**입니다
통계가 아예 없는 Pod를 먼저 고르는 예외도 있으므로, 통계 수집 상태가 같다는 전제 없이 표만 적용하면 안 됩니다

QoS는 요청·상한을 통해 간접적으로 영향을 줍니다
BestEffort는 메모리 요청이 0이므로 메모리를 쓰면 초과 그룹에 들어갑니다
그렇지만 요청을 넘겨 쓰는 Burstable도 같은 그룹에 들어가므로, 여기서는 우선순위가 다음 비교 기준입니다

높은 우선순위 BestEffort와 낮은 우선순위 Burstable의 비교가 이 차이를 보여 줍니다
Burstable도 요청을 넘겼다면 두 Pod는 1번 기준에서 같고, 우선순위가 낮은 Burstable을 먼저 축출합니다
이는 순위 규칙으로 설명한 상황이며 실제로 메모리를 고갈시켜 얻은 결과는 아닙니다

Guaranteed 역시 모든 종료나 축출로부터 보호되는 등급은 아닙니다
시스템 데몬이 예약 이상을 쓰고 요청 이내로 쓰는 Pod만 남은 경우처럼, 노드의 안정을 위해 그 안에서 희생자를 골라야 하는 상황도 있습니다

요청 초과를 먼저 보는 이유는 예약한 범위를 넘어 사용 중인 자원을 구분하기 위해서입니다
QoS만으로는 같은 Burstable 두 Pod 중 누가 요청 이내이고 누가 초과했는지 알 수 없습니다
초과 여부가 같을 때 우선순위로 중요도를 비교하고, 그것도 같을 때 더 큰 사용량 차이를 비교합니다

## Linux 기본 hard 임계값도 부분 설정에 주의해야 합니다

[`DefaultEvictionHard`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/eviction/defaults_linux.go)는 다음 다섯 값을 정의합니다

| 신호 | Linux 기본 hard 임계값 |
|---|---:|
| `memory.available` | `<100Mi` |
| `nodefs.available` | `<10%` |
| `nodefs.inodesFree` | `<5%` |
| `imagefs.available` | `<15%` |
| `imagefs.inodesFree` | `<5%` |

`evictionHard`를 지정하지 않으면 이 기본 맵을 사용합니다
일부 값만 지정했다면 빠진 값까지 자동으로 이어받지는 않습니다
[`MergeDefaultEvictionSettings`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kubelet/app/server.go)를 `true`로 설정해야 누락된 기본값을 병합하며, 이 설정의 기본값은 `false`입니다

[QoS와 cgroup](/essays/k8s-theory-qos-cgroups)에서 구분한 두 자원 계산에도 이 임계값이 연결됩니다
스케줄러에게 알리는 `node.status.allocatable`에는 시스템 예약·Kubernetes 예약·hard eviction 예약을 반영하지만, 전체 Pod cgroup 한도 계산에서는 앞의 두 예약만 뺍니다
Pod들이 요청을 넘겨 사용하면 배치 계산에서 제외했던 hard eviction 예약분까지 사용할 수 있고, kubelet은 남은 여유를 자원 신호로 확인합니다

cgroup v2에서는 `cgroup.event_control`을 사용하는 메모리 임계값 알림을 지원하지 않습니다
[`NewCgroupNotifier`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/eviction/threshold_notifier_linux.go)는 비활성 알림기를 반환하므로 `--kernel-memcg-notification`을 켜도 이 알림 경로는 사용할 수 없습니다
eviction manager의 주기적인 통계 확인은 계속됩니다

`KubeletPSI`는 메모리 회수 등에 막혀 기다린 시간을 나타내는 PSI 지표를 노출하는 기능이며, v1.36부터 GA로 기본 활성화됩니다
이 지표가 있다는 사실과 eviction manager가 그 값을 축출 임계값으로 사용한다는 주장은 다릅니다
확인한 eviction 신호 목록과 판단 경로에는 PSI 임계값이 포함돼 있지 않습니다

## 압박 조건의 해제와 새 Pod 수용은 별도 판단입니다

### 부족 상태가 사라져도 조건은 바로 해제되지 않습니다

`--eviction-pressure-transition-period`의 기본값은 5분입니다
kubelet은 마지막으로 압박 조건을 관찰한 시각을 보관하고, 그때부터 이 기간이 지나기 전까지 조건을 유지합니다
soft 발동 전 대기가 끝나기 전에도 압박 조건 자체는 보고할 수 있습니다

이는 임계값 근처에서 신호가 오르내릴 때 조건과 taint가 계속 바뀌는 일을 줄입니다
반대로 자원이 회복돼도 조건과 관련 taint가 남아, 이를 견디지 못하는 새 Pod의 배치가 늦어질 수 있습니다
정확히 회복 후 5분째에 스케줄러가 새 Pod를 배치한다는 시간 보장은 아닙니다

### 새 Pod를 받아들이는 단계에서는 QoS를 사용합니다

앞선 축출 순위와 달리, eviction manager의 [`Admit`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/eviction/eviction_manager.go)는 QoS를 사용합니다
이는 API 서버의 admission이 아니라 노드의 kubelet이 Pod를 받아들일 때 하는 검사입니다

| 노드와 Pod 조건 | 이 검사 결과 |
|---|---|
| 압박 조건 없음 | 허용 |
| critical Pod | 압박 조건과 관계없이 허용 |
| `MemoryPressure`만 있고 BestEffort가 아님 | 허용 |
| `MemoryPressure`만 있고 BestEffort이며 memory-pressure taint를 견딤 | 허용 |
| 그 외 BestEffort 또는 다른 압박 조건이 있는 일반 Pod | 거부 |

여기서 허용은 eviction manager의 검사 하나를 통과했다는 뜻입니다
스케줄러의 taint·자원 검사나 kubelet의 다른 admission 단계까지 모두 통과했다는 보장은 아닙니다

## PDB 집행 여부는 pods/eviction 경로로 구분합니다

[Preemption과 PDB](/essays/k8s-theory-preemption-pdb)에서 살펴본 PDB는 자발적 중단에서 유지할 가용성을 선언하는 예산입니다
Eviction API는 삭제 요청에서 그 예산과 적용 예외를 검사합니다
반면 kubelet의 node-pressure eviction은 `pods/eviction`을 거치지 않으므로 PDB가 이 종료를 막지 못합니다

노드의 메모리가 고갈되는 중에 API 서버 응답이나 가용성 예산 회복을 기다리면 kubelet과 런타임도 자원 부족의 영향을 받을 수 있습니다
node-pressure 축출은 이 상황에서 노드 자원을 회수하려는 동작이며, 애플리케이션의 삭제 예산과 종료 유예를 그대로 기다리는 경로가 아닙니다

## 남은 상태와 삭제 기록을 함께 읽습니다

다음 표는 소스에서 확인한 판별 기준이며 실제 클러스터에서 수집한 출력은 아닙니다

| 확인한 상태 | 알 수 있는 범위 | 추가로 볼 것 |
|---|---|---|
| 컨테이너가 재시작했고 이전 종료 이유가 `OOMKilled` | 런타임이 OOM 종료로 보고함 | cgroup 한도·이벤트·커널 기록으로 발생 범위 구분 |
| Pod가 `Failed`, `status.reason: Evicted` | kubelet 축출 상태 | message, 당시 자원 신호, kubelet 기록 |
| `DisruptionTarget`의 reason이 `TerminationByKubelet` | kubelet이 중단 대상으로 표시함 | node-pressure·노드 종료 등 구체적인 원인 |
| `DisruptionTarget`의 reason이 `EvictionByEvictionAPI` | Eviction API가 중단 대상으로 표시함 | 해당 요청과 삭제 진행 상태 |
| Pod 오브젝트가 없고 새 Pod가 있음 | 기존 오브젝트가 더는 조회되지 않음 | 기존 UID·소유자·이벤트·삭제 요청 기록 |

`TerminationByKubelet`은 node-pressure eviction에만 쓰는 reason이 아닙니다
또한 local storage limit 축출은 `DisruptionTarget` 없이도 `Evicted` 상태를 만들 수 있습니다
조건 하나의 유무로 모든 종료 원인을 나누면 안 됩니다

축출된 Pod가 나중에 사라지는 경우도 있습니다
[`PodGCController`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/podgc/gc_controller.go)는 종료 Pod 정리 임계값이 양수이고 종료 Pod 수가 이를 넘으면 초과 수만큼 삭제합니다
이후 오브젝트가 사라졌다고 해서 원래 종료 원인이 API eviction이었다고 판단해서는 안 됩니다

축출할 수 있는 후보를 찾지 못하면 다음 로그가 나올 수 있습니다
critical Pod만 남은 경우가 한 예입니다

```text
Eviction manager: unable to evict any pods from the node
```

압박이 계속된다면 메모리 신호가 회복됐는지뿐 아니라 다른 압박 신호도 구분해야 합니다
조건 해제 대기가 남았는지, 실제 축출로 자원 소비를 따라잡고 있는지, 당시 판단에 쓸 통계가 있었는지를 함께 확인합니다
종료 뒤의 status만으로는 축출 시점의 자원 값을 복원할 수 없으므로, 그 시점의 관측 기록이 남아 있는지도 별도로 확인해야 합니다

## 확인한 근거

- [Node-pressure Eviction 공식 문서 저장본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/scheduling-eviction/node-pressure-eviction.md) — 신호, 기본값, 회수 순서, QoS와 순위의 관계
- [eviction manager](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/eviction/eviction_manager.go)와 [helpers](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/eviction/helpers.go) — 발동 유예, 순위, 한 주기의 범위, 상태 변경, admission
- [컨테이너 종료 구현](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_container.go)과 [런타임 상수](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_manager.go) — preStop과 최소 종료 유예 2초
- [노드 자원 예약 계산](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/cm/node_container_manager_linux.go) — allocatable 예약과 전체 Pod cgroup 한도의 차이
- [기능 이력](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go) — `HugepageAwareEviction` v1.37 Beta/default on, `KubeletPSI` v1.36 GA/default on
- [Disruptions 공식 문서 저장본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/workloads/pods/disruptions.md#pod-disruption-conditions) — `DisruptionTarget`의 reason과 조건이 없는 종료
- [Linux cgroup v2 문서](https://docs.kernel.org/admin-guide/cgroup-v2.html) — `memory.max`, `memory.oom.group`, `memory.events`
