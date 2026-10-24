---
title: "노드 하트비트와 taint 축출 — 관찰 실패와 실제 종료는 다릅니다"
excerpt: "Lease와 Node status에서 시작해 Node 조건, NoExecute taint, Pod 삭제와 podGC까지 따라갑니다. 판정 유예와 Pod toleration, zone별 속도 제한, 캐시 지연 보호, 예고된 노드 종료의 차이를 구분합니다"
category: "kubernetes"
tags: ["Kubernetes", "Node", "Lease", "Taint", "Eviction", "concept"]
series:
  name: "k8s-theory-node"
  order: 10
date: "2026-09-14"
---

노드의 하트비트가 끊겨도 컨트롤 플레인은 노드의 전원이 꺼졌는지 바로 알 수 없습니다
노드가 응답하지 않는 것과, 노드가 보낸 갱신을 컨트롤러가 관찰하지 못하는 것이 같은 모습으로 보일 수 있기 때문입니다

그래서 Node 상태를 바꾸는 판단, 기존 Pod의 삭제를 요청하는 판단, 남은 오브젝트를 정리하는 판단을 나눠야 합니다
각 단계의 주체와 타이머도 다릅니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 클러스터에서 하트비트 중단이나 노드 종료를 재현한 실측 기록은 포함하지 않습니다

## 하트비트 부재부터 Pod 정리까지 주체가 바뀝니다

**node lifecycle controller**는 kube-controller-manager에서 노드 상태를 관찰하고 Node 조건과 taint를 관리합니다
**taint eviction controller**는 `NoExecute` taint와 Pod의 toleration을 비교해 Pod 삭제를 요청합니다
삭제 뒤 실제 컨테이너 종료와 오브젝트 정리에는 kubelet이나 별도 정리 컨트롤러가 관여합니다

이 글은 해당 컨트롤러들을 실행하는 기본 구성을 전제로 합니다
taint 기반 삭제는 별도 컨트롤러이며, controller-manager의 `--controllers=-taint-eviction-controller` 설정으로 실행을 제외한 구성에서는 같은 삭제 흐름을 기대할 수 없습니다

![node lifecycle controller가 하트비트 변화를 관찰하고 유예와 Lease 재확인 뒤 상태·taint를 바꾸며, taint eviction controller는 Pod toleration에 따라 일반 DELETE를 요청하는 흐름|tall](/diagrams/k8s-theory-node-heartbeat-taint-eviction-1.svg)

이 흐름에서 기본 50초와 300초는 같은 타이머가 아닙니다
앞은 컨트롤러의 노드 판정 유예이고, 뒤는 각 Pod에 저장된 toleration 시간입니다
둘을 더한 값도 오브젝트 삭제 완료 시각을 보장하지는 않습니다

## kubelet은 작은 Lease와 큰 Node status를 따로 갱신합니다

**Lease**는 갱신 시각 등을 담는 작은 API 오브젝트입니다
노드 하트비트용 Lease는 `kube-node-lease` 네임스페이스에 노드마다 하나씩 있습니다
kubelet은 이 Lease의 `spec.renewTime`을 갱신하는 경로와 Node의 `status`를 보고하는 경로를 함께 사용합니다

| 설정·동작 | 기본값 | 의미 |
|---|---:|---|
| `nodeLeaseDurationSeconds` | 40초 | Lease에 기록할 수명 설정 |
| Lease 갱신 기준 간격 | 10초 | 위 값의 0.25배 |
| `nodeStatusUpdateFrequency` | 10초 | Node status를 계산하고 보고 필요 여부를 확인하는 간격 |
| `nodeStatusReportFrequency` | 5분 | 변경이 없어도 Node status를 다시 보고하는 기준 간격 |

Node status에는 용량, 이미지, 조건, 주소 등이 들어갑니다
작은 생존 신호와 큰 상태 보고를 나누면 같은 내용을 담은 Node 오브젝트를 하트비트마다 다시 쓰는 부하를 줄일 수 있습니다
빈번한 변경을 받아야 하는 watch 소비자의 처리도 줄어듭니다

status를 10초마다 계산한다고 매번 API 서버에 보내지는 않습니다
변경을 발견하면 report 간격을 기다리지 않고 보내고, 변경이 없으면 보고 주기의 만료를 봅니다
조건의 `lastHeartbeatTime`만 달라진 것은 비교에서 제외합니다

[`tryUpdateNodeStatus`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kubelet_node_status.go)는 첫 조회에 로컬 캐시를 사용하고 재시도에서는 API 서버를 직접 조회합니다
Lease 갱신도 직전에 쓴 사본을 재사용해 갱신 전 조회를 줄입니다
현재 구현의 Node status 보고는 상태 변경이나 kubelet 재시작 뒤 **다음 보고 간격에 한 번** 무작위 지연을 적용하며, 이후 변경 없는 주기 보고는 기준 간격으로 돌아갑니다

### update만 명시해도 report 기본값이 달라집니다

[`KubeletConfiguration` 기본값 처리](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/apis/config/v1beta1/defaults.go)는 두 필드가 모두 없을 때 update 10초·report 5분을 채웁니다
report를 생략하고 update만 명시하면 report도 그 값으로 채웁니다
update를 10초로 직접 지정한 경우도 변경 없는 상태 보고가 기본 5분 대신 10초 기준이 될 수 있습니다

이 둘은 모두 kubelet 설정 필드입니다
`--node-status-update-frequency`라는 CLI 별칭이 있다는 사실로 계산과 보고를 필드·플래그의 차이로 나누면 안 됩니다

하트비트용 클라이언트는 일반 클라이언트와도 분리합니다
클라이언트 속도 제한을 끄고, 요청 타임아웃은 status 계산 간격과 Lease 수명 중 짧은 값으로 잡습니다
이는 하트비트가 클라이언트의 요청 제한 때문에 기다리는 일을 줄이는 처리이며, 서버 쪽 처리가 항상 즉시 끝난다는 보장은 아닙니다

## 판정 시간은 컨트롤러의 마지막 관찰 시각으로 계산합니다

[`tryUpdateNodeHealth`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/nodelifecycle/node_lifecycle_controller.go)는 Lease의 `renewTime`이 직전 관찰보다 새로워졌는지 확인합니다
새 값을 보면 컨트롤러 자신의 현재 시각을 `probeTimestamp`에 저장합니다
Node `Ready` 조건의 `lastHeartbeatTime`이 바뀐 경우도 관찰 시각을 갱신합니다

판정 유예가 지났는지는 컨트롤러의 현재 시각과 이 관찰 시각을 비교해 확인합니다
노드가 쓴 타임스탬프를 컨트롤러의 현재 시각에서 직접 빼는 계산은 아닙니다
이렇게 하면 경과 시간 계산에 노드와 컨트롤 플레인의 시계 차이가 직접 들어오는 것을 피할 수 있습니다

| controller-manager 설정 | 기본값 | 적용 대상 |
|---|---:|---|
| `--node-monitor-period` | 5초 | 노드 건강 상태 검사 주기 |
| `--node-monitor-grace-period` | 50초 | 상태를 보고한 적 있는 노드에서 새 하트비트를 관찰하지 못한 유예 |
| `--node-startup-grace-period` | 60초 | 아직 Ready 조건을 보고하지 않은 시작 단계의 유예 |

Lease 또는 Node status의 새 하트비트를 관찰하면 하트비트가 끊겼다는 판정을 피할 수 있습니다
Lease 갱신 자체가 kubelet의 `Ready=False`를 `True`로 바꿔 주는 것은 아닙니다

**Lease의 `leaseDurationSeconds: 40`은 node lifecycle controller의 판정 타임아웃이 아닙니다**
이 컨트롤러는 그 수명 필드로 Node를 판정하지 않습니다
따라서 Lease 수명만 바꿔도 controller-manager의 50초가 함께 바뀌는 것은 아닙니다

관찰 시각은 컨트롤러 메모리에 있으므로 재시작이나 리더 교체 뒤 다시 만들어집니다
기존 Node를 새로 관찰하는 경우 현재 시각부터 관찰을 시작해 판정이 늦어질 수 있습니다

### 유예를 넘기면 네 조건을 Unknown으로 바꿉니다

판정 대상은 `Ready`, `MemoryPressure`, `DiskPressure`, `PIDPressure`입니다
기존 조건이 Unknown이 아니었다면 이유 `NodeStatusUnknown`과 메시지 `Kubelet stopped posting node status.`를 기록합니다
아예 조건을 보고한 적이 없다면 `NodeStatusNeverUpdated`라는 이유로 조건을 만듭니다

`NetworkUnavailable`은 이 경로가 바꾸지 않습니다
따라서 하트비트 부재가 모든 Node 조건을 같은 값으로 덮는다고 일반화할 수는 없습니다

### 50초는 노드 재시도뿐 아니라 관찰 연결도 고려한 값입니다

컨트롤러의 watch 연결이 조용히 끊기면 노드가 Lease를 갱신해도 캐시에 새 값이 도착하지 않을 수 있습니다
이 상태에서도 마지막 관찰 후의 시간은 계속 늘어납니다

소스의 기본값 주석은 노드 판정 유예가 HTTP/2 연결 검사 시간의 합계보다 커야 한다고 설명합니다
실제 [`http.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/util/net/http.go)의 기본값은 읽기 유휴 30초와 ping 응답 대기 15초이며 합계는 45초입니다
기본 50초는 이 연결 장애 감지에도 여유를 두는 값이지, 그 안에 재연결과 relist가 반드시 끝난다는 기한은 아닙니다

현재는 추가 보호도 있습니다
v1.37에서 Beta·기본 on인 `NodeControllerLeaseCircuitBreaker`는 유예를 넘겼을 때 실제 Lease를 API 서버에서 직접 GET해 캐시와 대조합니다

![관찰 유예를 넘기면 실제 Lease GET으로 resourceVersion을 캐시와 대조하고, 캐시가 뒤처졌으면 반영을 기다리며 판정을 중단하는 Lease circuit breaker 흐름|tall](/diagrams/k8s-theory-node-heartbeat-taint-eviction-2.svg)

실제 Lease의 `resourceVersion`이 캐시에 저장한 것과 다르면 캐시 지연으로 봅니다
반영을 확인할 때까지 해당 노드뿐 아니라 이 컨트롤러의 다른 노드 판정도 중단합니다

GET 자체가 실패해도 오류를 무시하고 Unknown 판정으로 진행하지는 않습니다
실제 Lease와 캐시가 같거나 Lease가 존재하지 않는 응답이면 이후 상태 판정 경로로 갑니다

이 대조는 캐시가 뒤처진 것을 노드의 하트비트 중단으로 오인하지 않도록 하는 보호입니다
Lease 갱신을 볼 수 없다는 사실만으로 노드의 실제 전원 상태까지 증명하지는 못합니다

## Ready=False와 Unknown은 다른 taint로 이어집니다

| Node Ready 조건 | 이 경로의 대표 작성 주체 | 대응 taint 키 |
|---|---|---|
| `False` | 준비 실패를 보고한 kubelet | `node.kubernetes.io/not-ready` |
| `Unknown` | 새 하트비트를 관찰하지 못한 node lifecycle controller | `node.kubernetes.io/unreachable` |

kubelet의 `KubeletNotReady`는 런타임·네트워크·스토리지·종료 진행 중 오류나 필수 용량 누락 등을 반영합니다
컨트롤러가 기록한 `NodeStatusUnknown`은 그런 오류를 노드가 직접 보고했다는 뜻이 아닙니다

**taint**는 노드에 붙이는 제약이고, **toleration**은 Pod가 그 제약을 견딜 조건입니다
`NoSchedule`은 새 배치를 제한하며, `NoExecute`는 이미 배치한 Pod의 삭제 판단에도 쓰입니다
같은 Ready 조건에서 만들더라도 두 effect는 별도 처리 경로를 거칩니다

node lifecycle controller는 위 두 `NoExecute` taint를 상호 배타적으로 교체합니다
Unknown에서 False로 바뀌면 unreachable을 제거하고 not-ready를 추가하는 식입니다
새 배치를 막는 taint와 기존 Pod 삭제를 유발하는 taint의 처리 시각이 반드시 같지는 않습니다

이 두 컨트롤러의 분리는 v1.29에 도입됐고 v1.34부터 GA로 잠겼습니다
기능 분리가 고정됐다는 것과 별도 컨트롤러의 실행을 구성에서 제외할 수 있다는 것은 다른 조건입니다

## 속도 제한은 Pod 수가 아니라 NoExecute를 붙이는 노드 수에 적용합니다

taint를 붙이는 주체와 Pod를 삭제하는 주체가 다르므로 속도 제한도 적용 위치를 구분해야 합니다
node lifecycle controller는 zone마다 `NoExecute` taint를 붙이는 노드 수를 제한합니다
정상 속도 `--node-eviction-rate=0.1`은 초당 0.1개 노드이며 토큰 버킷 burst는 1입니다

**zone**은 장애 범위를 나눠 처리하는 구역입니다
여기서 상태는 실제 전원 장애 원인을 분석한 결과가 아니라 컨트롤러가 관찰한 Ready 노드 수로 계산합니다

| zone 상태 | 소스의 판정 | 해당 zone의 NoExecute 추가 속도 |
|---|---|---|
| 정상 | 아래 두 상태가 아님 | 기본 초당 0.1개 노드 |
| 부분 장애 | Ready가 아닌 노드 3개 이상이고 비율이 기본 0.55 이상 | zone 노드 수가 50 초과면 기본 0.01, 50 이하면 0 |
| 전면 장애 | Ready 노드가 0이고 Ready가 아닌 노드가 있음 | 다른 zone이 전면 장애가 아니라면 정상 속도 |

부분 장애의 비율은 `--unhealthy-zone-threshold`, 속도는 `--secondary-node-eviction-rate`, 크기 경계는 `--large-cluster-size-threshold`로 정합니다
이 크기 비교는 다중 zone 구성에서 전체 클러스터 합계가 아니라 해당 zone의 노드 수를 사용합니다

한 노드의 taint를 본 뒤 여러 Pod가 각각 삭제될 수 있으므로, 초당 0.1개 노드는 Pod DELETE 요청을 초당 0.1개로 제한한다는 뜻이 아닙니다
노드 수가 많으면 taint 추가 대기만으로도 Pod의 toleration 시간을 세기 시작하는 시점이 늦어질 수 있습니다

### 모든 zone이 전면 장애면 이 경로의 taint 추가를 멈춥니다

[`handleDisruption`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/nodelifecycle/node_lifecycle_controller.go)은 모든 zone에서 Ready 노드가 사라진 상태로 들어가면 관리하던 두 `NoExecute` taint를 제거하고 추가 속도를 0으로 둡니다
노드 전체가 실제로 종료된 것인지, 컨트롤 플레인의 관찰 경로가 끊긴 것인지 이 상태만으로 구분하지 못하기 때문입니다

이는 모든 Pod 삭제 기능을 전역으로 끄는 설정이 아닙니다
다른 컨트롤러의 삭제나 사용자가 붙인 다른 NoExecute taint까지 같은 정책으로 멈춘다고 해석하면 안 됩니다
일부 Node가 다시 Ready로 관찰되면 관찰 시각과 zone별 속도를 다시 설정하며 이 모드에서 나옵니다

## 기본 300초는 admission이 Pod에 기록합니다

[`DefaultTolerationSeconds`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/plugin/pkg/admission/defaulttolerationseconds/admission.go)는 not-ready와 unreachable을 견디는 기본 toleration을 각각 추가합니다
기본 `tolerationSeconds`는 300입니다
API 서버의 `--default-not-ready-toleration-seconds`와 `--default-unreachable-toleration-seconds`가 이 값을 정합니다

이미 해당 항목이 있으면 덮어쓰지 않습니다
빈 키로 모든 taint를 허용하거나 effect를 비워 둔 toleration처럼 해당 기본 항목의 추가를 생략하게 하는 경우도 있습니다
따라서 모든 Pod에 같은 300초가 적용된다고 가정해서는 안 됩니다

값은 Pod 오브젝트에 남습니다
API 서버의 기본값 설정을 바꾼다고 기존 Pod의 toleration이 일괄 변경되지는 않습니다
Pod마다 대기 시간을 다르게 두는 것은 로컬 상태를 유지할 여유와 대체 Pod 생성 지연 사이의 선택이기도 합니다

taint eviction controller는 다음 규칙으로 각 Pod의 삭제를 예약합니다

| 현재 NoExecute taint와 toleration의 관계 | 처리 |
|---|---|
| 견디지 못하는 taint가 하나라도 있음 | 지연 없이 삭제 예약 |
| 모두 견디며 매칭에 사용한 toleration에 유한한 시간이 있음 | 그중 가장 짧은 시간 사용. 0 이하는 즉시 |
| 매칭에 사용한 toleration의 시간이 전부 생략됨 | 무기한 허용, 예약한 삭제 취소 |

DaemonSet controller가 추가하는 not-ready·unreachable toleration에는 `tolerationSeconds`가 없습니다
따라서 두 taint의 시간 만료만으로 해당 DaemonSet Pod가 삭제되지는 않습니다
다른 삭제 원인에 대한 면제를 의미하지는 않습니다

### 삭제 요청은 Eviction API를 거치지 않습니다

예약 시점이 오면 `DisruptionTarget=True`, reason `DeletionByTaintManager`를 먼저 patch하고 일반 Pod DELETE를 보냅니다
메시지는 `Taint manager: deleting due to NoExecute taint`입니다

이 경로는 `pods/eviction` 서브리소스를 사용하지 않습니다
[PDB를 집행하는 Eviction API](/essays/k8s-theory-preemption-pdb)를 지나지 않으므로 PDB의 가용성 예산이 이 삭제를 막지는 못합니다
문서의 eviction이라는 용어만으로 요청이 Eviction API를 거쳤다고 판단하면 안 됩니다

Pod별 삭제 타이머는 컨트롤러 메모리에 있습니다
컨트롤러가 재시작하면 현재 taint·toleration을 보고 다시 만들기 때문에 유한한 대기가 다시 시작할 수 있습니다
기존 타이머가 계속 유지된다고 가정해 이전 예약 시각만으로 완료 시점을 계산할 수는 없습니다

기본 50초 뒤 노드 판정을 마치고 즉시 taint를 추가·관찰했다고 가정하면, 300초 toleration을 더해 삭제 요청 시점을 약 350초로 계산할 수 있습니다
이는 기본값을 연결한 예시이며 감시·큐·API 처리·재시작 지연과 실제 종료 시간을 생략한 값입니다

또한 Pod의 Ready 변경은 이 삭제 요청보다 앞설 수 있습니다
node lifecycle controller는 Node가 Ready에서 벗어나면 해당 노드의 Pod Ready를 False로 바꿉니다
이후 EndpointSlice의 준비 상태 전파와 taint 기반 삭제는 각각 비동기로 진행되므로, Pod 오브젝트가 남아 있어도 일반 요청의 대상에서 빠질 수 있습니다

## Pod 삭제 요청 뒤에도 정리할 조건이 남습니다

노드에 배치한 실행 Pod의 일반적인 유예 삭제는 `deletionTimestamp` 기록과 실제 컨테이너 종료를 나눠 처리합니다
kubelet은 컨테이너 종료 뒤 status manager에서 유예 0의 마지막 DELETE를 요청합니다
노드가 응답하지 못하면 이 마무리도 진행되지 않아 오브젝트가 Terminating으로 남을 수 있습니다

현재 kubelet의 삭제 조건에는 API에서 관찰한 Pod phase가 종료 상태이고, 로컬 종료 후 정리도 끝났는지가 포함됩니다
단순히 프로세스가 사라졌다는 한 가지 사실만으로 즉시 마지막 삭제를 요청하는 것은 아닙니다

별도 **Pod garbage collector(podGC)**는 정리 조건에 따라 Pod 삭제를 요청합니다

| 정리 트리거 | 대상 |
|---|---|
| 배치한 Node 오브젝트가 실제로 없음 | 해당 노드에 묶인 orphaned Pod |
| 노드가 Ready가 아니고 `node.kubernetes.io/out-of-service` taint가 있음 | 그 노드에서 이미 삭제 중인 Pod |
| 종료 Pod 수가 양수인 `--terminated-pod-gc-threshold`를 초과 | 기준 초과분. 기본 threshold는 12500 |
| `spec.nodeName` 없이 삭제 중 | 아직 노드에 배치되지 않은 삭제 중 Pod |

종료 Pod 초과분은 Evicted 여부, 생성 시각, 이름 순으로 정렬해 삭제 대상을 고릅니다
Node 부재 정리는 캐시에 Node가 없다는 이유만으로 곧바로 실행하지 않습니다
기본 40초 격리 뒤 API 서버를 직접 GET해 여전히 없는지 확인합니다

[`markFailedAndDeletePodWithCondition`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/podgc/gc_controller.go)은 아직 Succeeded·Failed가 아닌 Pod를 Failed로 patch한 뒤 유예 0의 삭제를 요청합니다
Node 부재 경로는 이 patch에 `DeletionByPodGC` 조건도 기록합니다
이미 종료 phase인 Pod는 phase·조건 patch를 생략합니다

하트비트 경로에서 kubelet과 node lifecycle controller가 Node 오브젝트 자체를 삭제한 것은 아닙니다
따라서 하트비트가 끊겼다는 사실만으로 Node 부재에 따른 podGC가 곧 실행된다고 연결하면 안 됩니다

또한 Node의 `Ready=Unknown`과 Pod phase `Unknown`은 다른 값입니다
[kubelet의 Pod 상태 판정](/essays/k8s-theory-kubelet-pod-lifecycle)은 Node 연락 두절을 이유로 Pod phase를 자동 Unknown으로 바꾸지 않습니다
Pod에는 마지막 Running이 남을 수 있으며, 위 podGC 정리 시 미종료 phase를 Failed로 바꾸는 이유도 여기에 있습니다

### out-of-service는 실제 종료를 확인한 판단을 전달합니다

하트비트 부재만으로 노드가 확실히 종료됐다고 알 수 없기 때문에 외부의 판단이 필요할 수 있습니다
`out-of-service`는 Pod 정리와 볼륨 분리 경로가 이 판단을 사용할 수 있게 하는 taint입니다

[공식 Node Shutdown 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/cluster-administration/node-shutdown.md)는 이를 붙이기 전에 노드가 실제로 종료됐는지 확인하도록 요구합니다
기존 컨테이너가 살아 있는 상태에서 대체 Pod가 같은 신원과 볼륨을 사용하면 중복 실행·데이터 손상 위험이 있기 때문입니다
복구가 끝난 뒤 taint를 제거하는 일도 별도입니다

볼륨 attach/detach 조정 경로도 이 taint를 읽습니다
일반적인 비정상 노드의 언마운트 타임아웃 경로와 달리, 이 taint가 있으면 그 대기 시간과 별개로 강제 분리를 진행할 수 있습니다
Pod 정리와 볼륨 분리는 같은 사건이 아니지만 둘 다 대체 Pod의 시작에 영향을 줍니다

## 예고된 노드 종료는 kubelet이 먼저 알립니다

Linux의 **graceful node shutdown**은 systemd 종료 이벤트를 받은 kubelet이 시작합니다
kubelet은 logind의 **inhibit lock**, 즉 종료를 잠시 지연시키는 잠금으로 Pod와 볼륨을 정리할 시간을 확보합니다

이때는 하트비트 부재의 50초를 기다리는 대신 노드 종료 상태를 즉시 보고하려고 시도합니다
Ready=False를 보고하고, 새 Pod의 admission을 거절하며, 우선순위가 낮은 그룹부터 Pod를 종료합니다
각 그룹의 Pod 종료와 볼륨 언마운트를 기다린 뒤 잠금을 놓는 흐름입니다

종료 지연 상한인 logind의 `InhibitDelayMaxSec`가 필요한 시간보다 작으면 kubelet은 설정을 조정하고 reload한 뒤 반영을 확인합니다
요청한 시간이 실제로 확보되지 않아도 무시하고 진행하는 설정은 아닙니다

| kubelet 설정 | 의미 |
|---|---|
| `shutdownGracePeriod` | 전체 Pod 종료에 배정할 시간 |
| `shutdownGracePeriodCriticalPods` | 그중 마지막 critical 그룹에 배정할 시간 |
| `shutdownGracePeriodByPodPriority` | 우선순위별 그룹과 시간을 직접 지정 |

두 시간 필드로 구성한 예에서 전체 30초·critical 10초를 지정했다면 일반 그룹에는 20초, critical 그룹에는 10초를 배정합니다
이는 설정 예시이며 기본값이 아닙니다
그룹에 Pod가 없으면 그 그룹의 시간을 전부 기다리지도 않습니다

현재 GracefulNodeShutdown과 우선순위별 종료 게이트는 Beta·기본 on입니다
하지만 시간 필드가 기본 0이고 별도 그룹 설정도 없으면 종료 관리자는 비활성 구현을 사용합니다
게이트가 켜져 있다는 사실과 실제 종료 관리 설정이 있다는 사실을 나눠야 합니다

실행 중이던 Pod는 보통 Failed phase와 reason `Terminated`, 메시지 `Pod was terminated in response to imminent node shutdown.`을 남깁니다
`DisruptionTarget` reason은 `TerminationByKubelet`이며, 이미 Succeeded였던 phase는 덮어쓰지 않는 예외가 있습니다
이 종료 관리자가 Pod 오브젝트를 직접 DELETE하는 것은 아닙니다
워크로드 컨트롤러가 실패 상태를 보고 대체 Pod를 만드는 과정은 별도입니다

Windows는 `WindowsGracefulNodeShutdown` 게이트와 서비스 실행 조건을 따릅니다
이 게이트도 현재 Beta·기본 on이지만 Linux의 systemd·logind 경로를 그대로 적용하지는 않습니다

## 원인 조사에서는 조건·요청·정리 상태를 함께 봅니다

| 관찰한 상태 | 다음에 확인할 것 |
|---|---|
| Node Ready=False, reason `KubeletNotReady` | kubelet이 기록한 런타임·네트워크·스토리지·종료 오류 메시지 |
| Node Ready=Unknown, reason `NodeStatusUnknown` | Lease·status 관찰 시각, 컨트롤러 watch·캐시·실제 Lease 조회 오류 |
| 여러 노드가 동시에 NotReady | 실제 노드 장애와 관찰 경로 장애를 구분할 자료 |
| taint 추가가 늦거나 멈춤 | zone Ready 집계, 속도 설정, 전 zone 전면 장애 모드 |
| Pod Ready=False지만 오브젝트는 남음 | 준비 상태 전파와 toleration·삭제 진행 상태를 분리 |
| 기본 5분이 지나도 삭제 요청이 없음 | 실제 toleration, 무기한 허용 여부, taint 관찰·큐·컨트롤러 재시작 |
| 삭제 요청은 있지만 Terminating으로 남음 | kubelet의 종료 확인과 마지막 정리, podGC 적용 조건 |
| PDB가 taint 삭제를 막지 못함 | 일반 DELETE인지 Eviction API 요청인지 |
| graceful shutdown 게이트는 on인데 정리가 없음 | 시간·우선순위 그룹 설정과 OS 실행 조건 |

연락이 끊긴 노드를 Ready가 아니라고 기록하는 것은 관찰에 근거한 상태 판정입니다
Pod 삭제를 요청하는 것, API 오브젝트가 사라지는 것, 기존 컨테이너가 실제로 종료되는 것은 각각 다른 증거로 확인해야 합니다

## 확인한 소스와 문서

- [Node 상태 관찰과 zone 정책](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/nodelifecycle/node_lifecycle_controller.go) — `tryUpdateNodeHealth`·`doNoExecuteTaintingPass`·`ComputeZoneState`·`handleDisruption`
- [노드 판정 기본값](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/nodelifecycle/config/v1alpha1/defaults.go) — 50초·60초·5초와 연결 검사 여유
- [taint eviction 구현](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/tainteviction/taint_eviction.go) — toleration 최소값·무기한·예약과 일반 DELETE
- [PodGC](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/podgc/gc_controller.go) — 네 정리 경로·40초 격리·종료 phase patch
- [Lease 갱신](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-helpers/apimachinery/lease/controller.go)과 [Node status 보고](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kubelet_node_status.go) — 사본 재사용·변경 감지·보고 간격
- [Graceful shutdown 구현](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/nodeshutdown/nodeshutdown_manager.go)과 [Linux 관리자](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/nodeshutdown/nodeshutdown_manager_linux.go) — 설정 활성화·우선순위 그룹·상태 기록·inhibit lock
- [Node Status](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/node/node-status.md), [Taints and Tolerations](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/scheduling-eviction/taint-and-toleration.md) — 외부 상태와 설정의 의미. 실제 작성 주체·삭제 요청·기본값은 위 고정 소스와 함께 대조
