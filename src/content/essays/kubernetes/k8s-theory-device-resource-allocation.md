---
title: "장치 자원 할당 — 개수의 노드 선택에서 DRA의 장치 선택으로"
excerpt: "device plugin의 정수 자원 요청과 kubelet의 장치 ID 선택, DRA의 ResourceClaim 할당과 노드 준비를 비교합니다. NUMA 정렬, CPU·Memory Manager의 조건, 현행 feature gate와 단계별 실패 경계를 함께 살펴봅니다"
category: "kubernetes"
tags: ["Kubernetes", "DevicePlugin", "DRA", "NUMA", "TopologyManager", "concept"]
series:
  name: "k8s-theory-node"
  order: 13
date: "2026-09-18"
---

Pod가 `nvidia.com/gpu: 2`를 요청하면 기본 개수 모델의 스케줄러는 GPU가 두 개 남은 노드를 찾습니다
하지만 그 숫자만으로 어느 모델의 GPU인지, 두 장치가 같은 NUMA 위치에 있는지 알 수는 없습니다

노드의 남은 수량을 비교하는 일과 실제 장치 ID를 고르는 일은 다른 단계입니다
device plugin 경로는 kubelet이 노드에서 장치를 고르고, DRA는 장치 목록과 선택 조건·할당 결과를 API에 표현해 스케줄러가 선택할 수 있게 합니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서, Linux NUMA 문서, CDI Specification v1.1.0을 바탕으로 설명합니다
> Kubernetes ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 실제 GPU·DRA 드라이버·NUMA 배치를 검증한 실측 기록은 포함하지 않습니다

## 기본 개수 모델은 노드 선택과 장치 선택을 나눕니다

**device plugin**은 장치 목록과 건강 상태를 kubelet에 알리고, 선택한 장치를 컨테이너에서 사용할 설정을 반환하는 플러그인입니다
스케줄러는 Node에 광고한 수량을 보고 노드를 고르며, 노드가 정해진 뒤 kubelet이 플러그인의 목록을 사용해 장치 ID를 선택합니다

![Pod의 정수 장치 요청을 스케줄러가 노드의 남은 수량과 비교한 뒤 kubelet이 실제 장치 ID를 선택하고 Allocate 결과를 CRI로 넘기는 기본 device plugin 흐름|tall](/diagrams/k8s-theory-device-resource-allocation-1.svg)

여기서는 기본 device plugin·스칼라 개수 경로부터 설명합니다
현재는 같은 확장 자원 요청을 DRA에 위임하는 연결도 있으므로, 이름과 개수를 요청했다는 사실만으로 항상 이 경로라고 판단하지는 않습니다

## 확장 자원은 이름과 정수 수량을 광고합니다

**확장 자원(extended resource)**은 `example.com/dongle`처럼 이름과 수량으로 광고하는 자원입니다
이름은 유효한 qualified name이어야 하며 기본 Kubernetes 자원 이름이나 `requests.` 접두사를 사용할 수 없습니다
`kubernetes.io` 계열도 기본 자원 영역으로 취급하므로 벤더의 확장 이름과 구분합니다

Node status의 `capacity`에 자원을 광고하는 요청은 다음 모양입니다
실행 결과가 아니라 API 요청 형식을 보여 주는 예시입니다

```text
PATCH /api/v1/nodes/<node>/status
Content-Type: application/json-patch+json

[{"op":"add","path":"/status/capacity/example.com~1dongle","value":"4"}]
```

JSON Patch 경로의 `~1`은 자원 이름의 `/`를 표현합니다
해당 status 쓰기 권한으로 수량을 광고할 수 있지만, Kubernetes가 그 이름에 해당하는 장치의 실제 존재까지 검사하는 것은 아닙니다
장치 등록과 동작을 보장하는 계약 없이 숫자만 광고한 것과 실제 device plugin을 설치한 것은 다릅니다

### 정수 요청에는 overcommit을 허용하지 않습니다

[`validateResourceRequirements`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go)는 기본 확장 자원에 다음 제약을 적용합니다

| 제약 | 의미·검증 메시지 |
|---|---|
| 수량은 정수 | 소수 요청은 `must be an integer` |
| `limits` 필요 | requests만 있으면 `Limit must be set for non overcommitable resources` |
| `requests == limits` | 다르면 `must be equal to <이름> limit of <수량>` |

limits만 작성했다면 기본값 처리로 requests도 같은 값이 됩니다
스케줄러에게는 작은 수량을 요청하고 kubelet에서는 더 큰 수량을 받는 모델을 허용하지 않는 것입니다

hugepages도 일반 CPU·메모리와 달리 overcommit이 금지돼 request와 limit이 같아야 합니다
다만 hugepages는 `hugepages-2Mi`처럼 페이지 크기별로 미리 확보한 메모리를 별도 회계하는 자원이며, GPU의 정수 개수와 같은 물건은 아닙니다

### 장치만 요청해도 CPU·메모리 QoS는 올라가지 않습니다

[QoS 계산](/essays/k8s-theory-qos-cgroups)은 CPU와 메모리를 사용하며 장치 요청을 포함하지 않습니다
다른 CPU·메모리 요청이나 한도가 없다면 장치만 요청한 Pod는 BestEffort입니다

메모리 압박의 축출 순위도 장치를 보유했다는 이유로 별도 보호하지 않습니다
요청 초과 여부, Pod priority, 요청 대비 사용량을 비교하므로 장치만 요청한 Pod가 항상 첫 대상이라고 단정할 수는 없습니다
CPU·메모리의 예약과 배치 조건을 충족하려면 그 자원을 따로 선언해야 합니다

## NodeResourcesFit은 수량을 검사하고 장치 ID를 고르지 않습니다

[`fitsRequest`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/noderesources/fit.go)의 기본 스칼라 검사는 요청을 `allocatable - requested`와 비교합니다
남은 수량이 모자라면 `Insufficient <자원 이름>`으로 후보 노드를 제외합니다

요청이 노드 전체의 allocatable보다도 크면 `Unresolvable`로 분류합니다
GPU가 전혀 없는 노드에 GPU를 요청한 경우는 기존 Pod를 제거해도 해결되지 않기 때문입니다
반면 전체 수량은 충분하고 다른 Pod가 사용 중인 경우에는 [preemption](/essays/k8s-theory-preemption-pdb)을 검토할 여지가 있습니다

이때 스케줄러는 기본 개수 모델의 장치 ID·건강 상태 목록·NUMA 위치를 읽어 선택하지 않습니다
그 정보는 노드의 device plugin이 kubelet에 전달합니다

## 등록할 때는 kubelet이 서버이고 할당할 때는 플러그인을 호출합니다

device plugin의 gRPC 계약에는 두 서비스가 있습니다

| 서비스 | 서버 | 호출 내용 |
|---|---|---|
| `Registration` | kubelet | 플러그인이 `Register`로 자원 이름·소켓·API 버전 등록 |
| `DevicePlugin` | device plugin | kubelet이 옵션 조회·목록 관찰·할당·시작 전 작업 요청 |

플러그인은 `/var/lib/kubelet/device-plugins/` 아래 소켓을 만들고 kubelet의 `kubelet.sock`에 등록합니다
등록이 끝나면 kubelet은 플러그인의 `GetDevicePluginOptions`, `ListAndWatch`, `GetPreferredAllocation`, `Allocate`, `PreStartContainer`를 계약과 옵션에 따라 사용합니다

`ListAndWatch`는 ID·건강 상태·NUMA 위치가 담긴 장치 목록을 스트림으로 제공합니다
장치 상태가 바뀌거나 사라지면 변경분만이 아니라 목록 전체를 다시 보냅니다

kubelet이 재시작하면서 플러그인 소켓 디렉터리를 정리하면 플러그인은 소켓 삭제를 감지하고 다시 등록해야 합니다
재시작 뒤 자원이 보이지 않는다면 등록과 목록 갱신 상태를 함께 확인해야 합니다

### Allocate 응답은 컨테이너 주입 설정입니다

`Allocate`의 컨테이너별 요청에는 선택한 장치 ID 목록이 들어갑니다
Pod 이름이나 컨테이너 이름을 전달하는 필드는 없습니다
장치 초기화 등 벤더별 처리를 마친 응답은 다음 항목을 반환할 수 있습니다

| 응답 항목 | 컨테이너로 전달하는 설정 |
|---|---|
| `envs` | 환경 변수 |
| `mounts` | 호스트 경로 마운트 |
| `devices` | 장치 노드와 접근 권한 |
| `annotations` | 런타임에 전달할 어노테이션 |
| `cdi_devices` | CDI 장치 이름 |

이 결과는 [CRI 컨테이너 설정](/essays/k8s-theory-cri-oci-boundary)으로 이어지고, 런타임이 실제 컨테이너 실행 설정을 준비합니다
Node를 골랐다는 사실만으로 할당 성공까지 보장하지는 않습니다
노드에서 `requested number of devices unavailable for <이름>`으로 실패하면 kubelet admission이 `UnexpectedAdmissionError`로 거절할 수 있습니다

### unhealthy 보고는 새 할당 수량을 줄이며 기존 Pod를 옮기지는 않습니다

플러그인이 장치를 unhealthy로 보고하면 해당 자원의 allocatable은 줄지만 capacity는 유지됩니다
[`GetCapacity`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/cm/devicemanager/manager.go)는 건강한 장치를 allocatable에, 건강한 장치와 unhealthy 장치를 합한 수를 capacity에 반영합니다

이미 할당한 Pod는 그 장치에 계속 연결됩니다
기본 device plugin의 건강 상태 통지만으로 자동 재배치가 일어나는 것은 아닙니다
장치에 의존하는 앱이 이후 실패하거나 재시작하는 것과 장치 재선택도 별도입니다

노드의 PodResources API로 할당 ID를 조사할 수 있으며, 현재 Beta·기본 on인 `ResourceHealthStatus`에서는 Pod의 `containerStatuses[].allocatedResourcesStatus`로 할당 장치 ID와 건강 상태를 보고할 수도 있습니다
따라서 현재 구현을 설명하면서 장치 정보가 API에 전혀 남지 않는다고 단정하면 안 됩니다
다만 이 보고가 DRA처럼 스케줄러가 참조하는 별도 장치 목록·할당 claim을 만든다는 뜻은 아닙니다

## NUMA 정렬은 개수 검사 뒤의 노드 내부 판단입니다

**NUMA node**는 한 서버 안에서 CPU·메모리·I/O의 위치 관계를 구분하는 하드웨어 자원 단위입니다
Pod를 실행할 서버를 나타내는 Kubernetes Node와 다르며 한 Kubernetes Node 안에 여러 NUMA node가 있을 수 있습니다

CPU가 어느 위치의 메모리나 장치에 접근하는지에 따라 접근 거리와 비용이 달라집니다
따라서 GPU 두 개가 남았다는 사실과 CPU·메모리·장치를 가까운 위치에 함께 할당할 수 있다는 사실은 다른 조건입니다

![device manager·CPU manager·memory manager의 NUMA 힌트를 Topology Manager가 scope와 정책에 따라 병합해 admission을 판단하는 관계](/diagrams/k8s-theory-device-resource-allocation-2.svg)

**Topology Manager**는 각 manager의 NUMA 배치 힌트를 결합합니다
`container` scope는 컨테이너별로, `pod` scope는 Pod 전체를 정렬 단위로 봅니다
기본 scope는 container입니다

| 정책 | NUMA 정렬에 따른 admission |
|---|---|
| `none` | 정렬 조건을 적용하지 않음 |
| `best-effort` | 가능한 정렬을 선택하지만 정렬 실패로 거절하지 않음 |
| `restricted` | 병합한 힌트가 preferred가 아니면 거절 |
| `single-numa-node` | 자원을 하나의 NUMA node에 맞춘 preferred 힌트를 얻지 못하면 거절 |

뒤의 두 정책에서 거절하면 `TopologyAffinityError`로 나타납니다
single-numa-node의 한 노드는 서버 한 대가 아니라 그 안의 NUMA node 하나입니다
토폴로지 제약을 주지 않는 자원의 힌트까지 억지로 다른 자원처럼 제한하는 뜻은 아닙니다

### CPU·Memory Manager의 전용 할당 조건은 서로 다릅니다

CPU Manager의 `static` 정책은 기본 컨테이너 경로에서 Guaranteed QoS와 정수 CPU 요청을 요구합니다
조건을 만족하지 못하면 전용 CPU를 받지 않고 공유 풀을 사용합니다
이 전용 CPU를 항상 물리 코어 전체 할당으로 해석하지는 않습니다
정책 옵션과 CPU 토폴로지도 실제 할당에 영향을 줍니다

CPU 예약을 남기는 노드 설정도 필요합니다
GPU를 받았다는 사실만으로 CPU가 전용으로 배정되는 것은 아닙니다

Linux Memory Manager의 `Static`도 Guaranteed를 전제로 하지만 CPU 요청의 정수 조건을 그대로 적용하지는 않습니다
NUMA별 시스템 예약량을 `reservedMemory`로 구성해야 하며, 예약 합계와 Node Allocatable의 예약 조건도 맞아야 합니다
Windows의 Static은 지원되지 않고 별도 BestEffort 정책 분기가 있습니다

Pod 수준 자원을 사용한다면 한 조건이 더 있습니다
현재 Beta·기본 off인 `PodLevelResourceManagers`를 켜지 않은 기본 구성에서는 CPU·Memory Static이 Pod 수준 자원을 사용하는 Pod의 할당·힌트를 건너뛰는 경로가 있습니다
Guaranteed라는 이유만으로 이 생략 조건을 없애면 안 됩니다
이 게이트를 켜는 경우에는 Pod 단위 할당과 컨테이너별 자격 조건도 추가되므로 기본 컨테이너 경로와 구분해야 합니다

## DRA는 목록·요구·할당 결과를 API로 표현합니다

**DRA(Dynamic Resource Allocation)**는 장치 목록과 선택 조건, 할당 결과를 API 오브젝트로 표현하는 자원 할당 모델입니다
개수 모델의 `2`에는 장치 모델, 메모리 크기, 공유나 장치 간 관계를 표현할 문법이 없습니다
DRA는 드라이버가 광고한 속성을 **CEL(Common Expression Language)** 조건으로 걸러 장치를 고를 수 있습니다

코어 API 네 종류는 `resource.k8s.io/v1`에 있습니다

| 오브젝트 | 역할 |
|---|---|
| `DeviceClass` | 장치 범주와 선택 기준 |
| `ResourceSlice` | 드라이버가 광고한 장치 목록과 풀 정보 |
| `ResourceClaim` | 장치 요구와 할당 결과, 예약 사용자 |
| `ResourceClaimTemplate` | Pod별 claim을 만들기 위한 템플릿 |

class를 골라 claim으로 자원을 요구하는 부분은 StorageClass·PVC와 비슷합니다
ResourceSlice는 선택 가능한 장치를 API에 먼저 광고하는 목록이라는 차이가 있습니다

장치 식별자는 드라이버·풀·장치 이름의 세 값입니다
한 풀은 여러 ResourceSlice에 걸칠 수 있으며, 소비자는 가장 높은 pool generation의 목록을 봅니다
최신 세대의 슬라이스가 `resourceSliceCount`만큼 모이지 않았다면 갱신이 아직 완전하지 않을 수 있습니다

Pod는 `spec.resourceClaims`에서 claim을 선언하고 컨테이너는 `resources.claims`로 그 이름을 참조합니다
한 claim을 여러 컨테이너나 Pod가 함께 참조하는 모델도 표현할 수 있습니다
이것이 모든 하드웨어를 임의로 공유할 수 있다는 보장은 아니며, 선택한 장치·할당 결과와 드라이버의 지원을 따라야 합니다

직접 만든 claim은 사용자가 수명을 관리합니다
ResourceClaimTemplate에서 생성한 Pod별 claim은 해당 Pod에 연결된 수명을 가지므로, API 오브젝트가 늘어난 뒤의 생성·정리도 할당 모델의 일부가 됩니다

## DRA의 내부 예약과 API 기록은 다른 단계입니다

![장치 목록·요구를 API로 표현하고 스케줄러가 Filter·Reserve에서 계산과 내부 예약을 진행한 뒤 PreBind에서 claim을 기록하고 kubelet이 노드 준비와 CDI 전달을 수행하는 흐름|tall](/diagrams/k8s-theory-device-resource-allocation-3.svg)

[`DynamicResources`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/dynamicresources/dynamicresources.go)는 PreEnqueue·PreFilter·Filter·PostFilter·Score·Reserve·Unreserve·PreBind 등 여러 단계에 참여합니다
노드별 할당 가능성을 계산하는 것, 스케줄러 내부에서 선택 결과를 예약하는 것, API에 실제로 기록하는 것이 분리돼 있습니다

| 단계 | 주된 역할 |
|---|---|
| PreFilter·Filter | claim 상태와 장치 목록을 읽고 노드별 할당 가능성 계산 |
| Reserve | 선택한 할당 결과를 내부 상태에서 예약 |
| PreBind | claim의 `status.allocation`과 `status.reservedFor`를 API에 기록 |
| Unreserve | 실패한 바인딩 시도의 내부 예약 등을 정리 |

Reserve에서 claim의 API 예약 쓰기를 기다리면 직렬로 진행하는 스케줄링 사이클도 그 왕복을 기다리게 됩니다
그래서 API 기록은 병렬로 진행할 수 있는 바인딩 사이클의 PreBind에서 처리합니다
대신 기록 실패가 노드 후보를 정한 뒤에 나타날 수 있습니다

`reservedFor`의 예약 사용자는 최대 256개입니다
이미 할당한 공유 claim에는 여러 사용자를 기록할 수 있지만 예약 슬롯과 할당 조건을 만족해야 합니다

[`bindClaim`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/dynamicresources/dynamicresources.go)은 resourceVersion 충돌이면 최신 claim을 읽어 재시도합니다
하지만 미할당 claim에 서로 다른 할당 결과를 쓰려던 사이 다른 쪽이 먼저 할당했다면 `got allocated elsewhere in the meantime`로 실패할 수 있습니다
모든 경합이 단순 쓰기 재시도로 해결되는 것은 아닙니다

PreBind가 실패하면 Unreserve 정리를 거쳐 Pod가 backoff 큐로 돌아갑니다
스케줄러가 노드를 골랐다는 사실과 claim의 API 기록이 성공했다는 사실도 따로 확인해야 합니다

`DRADeviceBindingConditions`와 `DRAResourceClaimDeviceStatus`를 사용하고 장치가 binding 조건을 선언했다면 PreBind에서 그 조건도 기다립니다
외부 장치 controller가 준비 상태를 보고해야 실제 Pod 바인딩을 진행하는 경로입니다
실패 조건이나 대기 시간 초과도 다음 스케줄링 시도로 이어질 수 있으므로, allocation 기록만 보고 바인딩이 끝났다고 판단하면 안 됩니다

### 노드 준비는 kubelet이 DRA 드라이버에 요청합니다

기본 노드 준비 경로에서는 kubelet이 DRA 드라이버의 `NodePrepareResources`를 호출합니다
정리할 때는 `NodeUnprepareResources`를 사용합니다
준비 RPC는 장치 선택을 스케줄러 대신 다시 수행하는 단계가 아니라 할당된 claim을 해당 노드에서 사용할 수 있게 준비하는 단계입니다

응답에는 pool·device 이름, 선택적인 request 이름·share ID, CDI 장치 ID가 들어갑니다
claim별 오류나 요청한 claim의 결과 누락이 있으면 준비 성공으로 처리하지 않습니다
따라서 API에 allocation이 있어도 노드의 준비나 컨테이너 시작은 실패할 수 있습니다

**CDI(Container Device Interface)**는 이름으로 지정한 장치에 필요한 컨테이너 설정을 런타임이 적용하는 규격입니다
런타임은 노드의 CDI 명세에서 이름에 해당하는 항목을 찾아 장치 노드·마운트·환경 변수 등의 OCI 설정을 반영합니다
해당 CDI 설정과 런타임 지원이 전제입니다

device plugin의 Allocate는 앞의 다섯 주입 채널을 반환할 수 있습니다
DRA의 kubelet 경로는 준비 응답에서 CDI 이름을 모아 CRI `ContainerConfig.CDIDevices`로 전달합니다
응답 전체에 CDI만 있다는 뜻이 아니라 컨테이너에 장치 설정을 주입하는 채널이 CDI라는 뜻입니다
장치 하나가 여러 CDI 이름을 반환하거나 CDI 이름을 반환하지 않는 응답도 계약상 가능합니다

선택 기능인 optional node operations를 사용하는 장치는 노드 준비·정리 RPC를 생략하는 경로도 있습니다
이 예외를 사용하는 드라이버와 설정을 기본 준비 흐름과 섞어 판단해서는 안 됩니다

## 정수 요청도 DRA에 위임할 수 있습니다

현재 `DRAExtendedResource`는 GA·기본 on이며 잠겨 있습니다
DeviceClass는 확장 자원 이름을 선언할 수 있고, 생략한 경우 `deviceclass.resource.kubernetes.io/` 접두사의 이름을 사용할 수 있습니다

[`shouldDelegateResourceToDRA`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/noderesources/fit.go)는 자원 이름에 대응하는 DeviceClass가 있는지 확인합니다
이때 해당 노드가 같은 이름을 **양수 allocatable**로 광고하고 있다면 기존 스칼라 검사를 유지합니다
그렇지 않고 DRA 매핑이 있으면 기본 스칼라 뺄셈을 생략하고 claim 경로에 위임할 수 있습니다

따라서 같은 정수 형태의 요청도 노드와 매핑 상태에 따라 처리 경로가 달라질 수 있습니다
기존 device plugin 자원을 광고한 노드와 DRA 장치를 사용하는 노드가 섞인 구성을 단일 경로로 단정하면 안 됩니다

### 코어 안정화와 부속 기능의 상태는 별도로 확인합니다

다음은 확인한 v1.37.1 고정 소스의 기본 상태입니다
GA 여부와 기본값을 바꿀 수 없는 LockToDefault도 구분합니다

| feature gate | 현행 단계·기본값 |
|---|---|
| `DynamicResourceAllocation` | GA·on·잠금 |
| `DRAExtendedResource` | GA·on·잠금 |
| `DRAAdminAccess`, `DRAPrioritizedList` | GA·on·잠금 |
| `DRADeviceTaints`, `DRADeviceTaintRules` | GA·on. 현재 잠금은 아님 |
| `DRAPartitionableDevices`, `DRAConsumableCapacity`, `DRADeviceBindingConditions` | Beta·on |
| `ResourceHealthStatus` | Beta·on |

부속 기능은 드라이버 지원과 관련 게이트·API 조건도 따릅니다
코어가 GA라는 이유로 모든 고급 선택·분할·상태 보고 기능이 같은 조건으로 작동한다고 읽으면 안 됩니다

## 실패 위치를 API 검증·스케줄링·노드 준비로 나눕니다

| 증상·단서 | 확인할 경계 |
|---|---|
| 정수·limits·request 동일성 오류 | API 자원 검증 |
| Pending과 `Insufficient <이름>` | 기본 개수 경로의 allocatable·기존 요청·DRA 위임 여부 |
| 요청이 전체 allocatable도 넘음 | preemption으로 해결 가능한 자원 부족인지 |
| 장치는 있는데 Node에 자원이 안 보임 | plugin 등록·자원 이름·목록 갱신·건강 상태 |
| capacity는 같고 allocatable만 줄어듦 | unhealthy 보고와 새 할당 가능 수량 |
| 노드 선택 뒤 `UnexpectedAdmissionError` | kubelet의 실제 장치 할당 가능 여부 |
| `TopologyAffinityError` | Topology Manager의 정책·scope·각 provider의 힌트 |
| Guaranteed지만 CPU·메모리 전용 할당 없음 | 정수 CPU 조건, 예약 설정, Pod-level 자원과 manager 게이트 |
| claim을 쓰는 Pod가 Pending | claim 존재·allocation·reservedFor·장치 선택 조건 |
| PreBind 뒤 재시도 | API 충돌 재시도인지 실제 할당 경합인지 |
| ResourceSlice는 있는데 할당되지 않음 | 속성 조건과 최신 pool generation의 완전성 |
| allocation은 있는데 시작 실패 | NodePrepareResources 결과와 CDI·런타임 설정 |

장치 수량이 충분하다는 판정, 장치의 선택 결과, 노드에서의 준비 완료, 컨테이너 시작은 각각 다른 경계입니다
어느 주체가 무엇을 기록했는지 나누면 Pending 이후의 실패도 스케줄러 한 곳의 문제로 묶지 않고 조사할 수 있습니다

## 확인한 소스와 문서

- [Device plugin 계약](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kubelet/pkg/apis/deviceplugin/v1beta1/api.proto)과 [device manager](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/cm/devicemanager/manager.go) — 서비스 방향·목록·ID 선택·주입 응답·건강 상태 수량
- [DRA API 타입](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/resource/v1/types.go)과 [노드 준비 RPC](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kubelet/pkg/apis/dra/v1/api.proto) — 장치 식별·pool generation·예약 상한·준비 응답
- [kubelet DRA manager](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/cm/dra/manager.go) — 준비 오류와 CDI 이름 전달
- [DRA 개요](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/resource-management/dynamic-resource-allocation/_index.md), [API 역할](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/resource-management/dynamic-resource-allocation/dra-api.md), [동작 흐름](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/resource-management/dynamic-resource-allocation/how-dra-works.md) — 기본 모델과 공유·선택·수명
- [Topology Manager](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/tasks/administer-cluster/topology-manager.md)와 [Linux NUMA](https://docs.kernel.org/mm/numa.html) — 서버 내부 위치 단위·정책·scope
- [CPU static 정책](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/cm/cpumanager/policy_static.go), [Memory static 정책](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/cm/memorymanager/policy_static.go), [feature gate 목록](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go) — 전용 할당 자격과 Pod-level·현행 기능 조건
- [CDI Specification v1.1.0](https://github.com/cncf-tags/container-device-interface/blob/v1.1.0/SPEC.md) — CDI 이름과 OCI 설정 적용의 계약
