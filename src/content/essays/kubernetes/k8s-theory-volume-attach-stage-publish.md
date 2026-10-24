---
title: "attach·stage·publish — 볼륨 연결부터 Pod가 사용할 경로까지"
excerpt: "볼륨을 노드에 연결하고 노드의 공통 경로와 Pod별 사용 경로를 준비하는 과정을 살펴봅니다. kubelet이 상태를 확인하는 방법과 정상 해제 순서, Multi-Attach 검사, 강제 분리의 시간·상태 조건을 현재 소스로 확인합니다"
category: "kubernetes"
tags: ["Kubernetes", "CSI", "Volume", "Storage", "concept"]
series:
  name: "k8s-theory-storage"
  order: 3
date: "2026-10-23"
---

같은 볼륨을 같은 노드의 두 Pod가 쓴다면, 노드에서 함께 쓰는 준비 작업과 Pod마다 따로 필요한 작업이 있습니다
파일시스템 볼륨을 예로 들면 attach는 볼륨을 노드에 연결합니다
stage는 그 노드에서 공유할 볼륨 경로를 준비하고, publish는 각 Pod가 사용할 호스트 경로에 볼륨을 제공합니다

> **근거**: Kubernetes v1.37.1 `f78e722310e50bcaca9276be22276d9e91d91308`과 공식 문서 저장본 `7fde177e22dc98390a6d55d215dd0301b5f6d0bb` 기준입니다
> CSI 계약은 Kubernetes가 의존하는 spec `cd9e7ad1ae0915cabcad179f2b8a660c0cb6eb9f`를 읽고 최신 릴리스 v1.13.0의 같은 RPC 계약과 대조했습니다
> external-attacher 구현 예시는 v4.13.0이며 실제 설치 버전·capability·클러스터 동작을 확인한 기록은 아닙니다
> attach·mount·강제 분리의 실습이나 지연 측정은 포함하지 않습니다

## 노드에서 준비한 볼륨을 Pod별 경로에 제공합니다

그림은 파일시스템 CSI persistent volume을 같은 노드의 두 Pod가 사용할 수 있는 조건의 예시입니다
attach와 stage는 지원·설정에 따라 생략할 수 있고, publish의 호스트 target을 준비한 뒤 runtime이 컨테이너에 경로를 노출합니다

![볼륨-노드 연결과 노드 staging target을 준비한 뒤 같은 노드의 Pod A와 Pod B에 서로 다른 NodePublishVolume target을 만들고 runtime이 컨테이너에 노출하는 흐름|xtall](/diagrams/k8s-theory-volume-attach-stage-publish-1.svg)

### attach는 볼륨-노드 쌍을 연결합니다

attach/detach controller가 연결의 필요를 판단하고 CSI 플러그인을 통해 VolumeAttachment를 만듭니다
external-attacher가 이를 관찰해 드라이버의 `ControllerPublishVolume`을 호출하고 결과를 status에 반영합니다

kubelet의 CSI attach 구현은 직접 연결을 요청받으면 `attaching volumes from the kubelet is not supported` 오류를 반환합니다
kubelet은 `WaitForAttach`에서 VolumeAttachment의 `status.attached`와 오류·삭제 상태를 확인합니다
`enableControllerAttachDetach`의 기본값도 true입니다

연결 제어를 노드 바깥에 두면 해당 노드의 kubelet이 응답하지 않아도 컨트롤 플레인에서 분리를 조정할 수 있습니다
kubelet은 다른 컨트롤러와 드라이버가 연결을 완료해야 볼륨 사용을 준비할 수 있습니다

호출 경계는 [csiAttacher.Attach·WaitForAttach](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/csi_attacher.go), sidecar의 결과 처리는 [external-attacher csi_handler](https://github.com/kubernetes-csi/external-attacher/blob/40d44ae14961a415348180a0e666651e82e44eb7/pkg/controller/csi_handler.go)에 있습니다

### stage는 노드의 staging target을 준비합니다

kubelet은 드라이버의 NodeGetCapabilities에서 `STAGE_UNSTAGE_VOLUME` 지원 여부를 확인합니다
지원하면 `NodeStageVolume`이 성공한 뒤 publish를 진행하며, 지원하지 않으면 이 RPC를 생략합니다

파일시스템 준비·검사·장치 연결·마운트 중 실제 작업은 드라이버에 따라 다릅니다
stage를 쓴다는 이유만으로 모든 드라이버가 같은 마운트 작업과 비용을 갖는 것은 아닙니다
이 단계에서 준비한 노드의 경로는 Pod별 사용 경로와 따로 관리합니다

### publish는 target path마다 볼륨을 제공합니다

kubelet은 `NodePublishVolume`에 Pod가 사용할 호스트 target path를 전달합니다
같은 노드에서 여러 Pod가 볼륨을 사용할 수 있다면 Pod마다 target이 달라집니다

파일시스템 드라이버가 staging target을 Pod target에 bind mount하는 것은 구현 사례입니다
CSI 계약은 요청한 target에 볼륨을 제공하도록 요구하며, 모든 publish를 같은 bind mount 구현으로 고정하지 않습니다
그 뒤 컨테이너에 호스트 경로를 노출하는 일은 runtime의 역할입니다

실패하거나 응답을 받지 못하면 같은 요청을 다시 보낼 수 있고, 이미 준비된 대상에 재요청할 수도 있습니다
CSI는 이런 호환되는 반복 요청을 처리하는 멱등성을 요구합니다

`CSIDriver.spec.requiresRepublish`를 사용하면 초기 성공 뒤에도 같은 target에 NodePublishVolume이 다시 호출될 수 있습니다
이 세 단계는 준비 대상을 기준으로 나눈 것이며, 각 RPC를 한 번만 호출한다는 뜻은 아닙니다

| 파일시스템 경로의 예 | 단위를 구분하는 부분 |
|---|---|
| `<CSI plugin dir>/<driver>/<sha256(volumeHandle)>/globalmount` | Pod UID 없이 노드의 볼륨 준비 경로 |
| `host.GetPodVolumeDir(Pod UID, plugin, volume id)` 아래 target | Pod UID로 구분하는 사용 경로 |

실제 생성은 [makeDeviceMountPath](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/csi_attacher.go)와 [csiMountMgr.GetPath·getTargetPath](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/csi_mounter.go)에 있습니다
기본 루트 경로를 모든 노드의 실제 설정으로 가정하지는 않습니다

## attach와 stage는 서로 다른 조건에서 생략합니다

| 준비 단계 | 생략을 판단하는 입력 |
|---|---|
| attach | CSIDriver의 `attachRequired: false` |
| stage | 드라이버의 Node capability에 `STAGE_UNSTAGE_VOLUME` 없음 |
| publish | 이 사용 경로를 준비하려면 필요 |

attach 여부는 드라이버 RPC를 부르기 전에 클러스터의 정책 판단에 필요하므로 오브젝트에서 읽습니다
stage 지원 여부는 kubelet이 Node 서비스와 통신할 때 확인합니다
CSIDriver가 없다는 이유만으로 attach를 생략하지도 않습니다

CSI inline ephemeral volume은 persistent volume과 수명이 달라 앞의 세 단계 그림을 그대로 적용하지 않습니다
현재 플러그인은 그 lifecycle에서 attach와 device-mount 경로를 생략합니다
관련 분기는 [csiPlugin.CanAttach·CanDeviceMount·skipAttach](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/csi_plugin.go)에 있습니다

### Block 모드를 파일시스템 마운트로 설명하면 안 됩니다

raw Block volume은 파일시스템 디렉터리를 제공하는 대신 장치 target을 준비합니다
현재 Kubernetes CSI block 구현에도 선택적 NodeStageVolume과 Pod별 NodePublishVolume이 있지만, staging·publish·장치 map 경로를 별도로 구성합니다
파일시스템용 globalmount 경로가 모든 볼륨 모드의 공통 경로인 것은 아닙니다

operation executor도 Filesystem이면 mount/unmount, Block이면 map/unmap 연산을 생성합니다
따라서 ‘볼륨이 마운트됐다’는 표현만으로 파일시스템 생성이나 bind mount가 실행됐다고 단정할 수 없습니다
근거는 [csi_block.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/csi_block.go)와 [OperationExecutor](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/util/operationexecutor/operation_executor.go)입니다

## kubelet은 목표 상태와 준비 상태를 계속 대조합니다

kubelet의 DesiredStateOfWorld는 어떤 Pod가 어떤 볼륨을 필요로 하는지 기록합니다
ActualStateOfWorld는 kubelet이 파악한 attachment·노드 준비·Pod별 사용 상태를 기록하며, 결과가 불확실한 상태도 구분합니다
이 둘은 attach/detach controller가 따로 유지하는 같은 이름의 상태 캐시와 다릅니다

reconciler가 차이를 보고 필요한 작업을 operation executor에 맡깁니다
실행 중인 관련 작업이 겹치지 않게 pending operation을 검사하고, 실패한 작업은 재시도와 backoff를 거칩니다
호출을 시작했다는 로그가 작업 완료나 실제 장치 준비까지 의미하지는 않습니다

다른 작업이 끝날 때까지 기다려야 하는 범위도 작업에 따라 다릅니다
앞의 attachable 또는 device-mountable 볼륨은 mount/device 준비를 볼륨 단위로 조정합니다
두 조건에 모두 해당하지 않는 플러그인의 mount는 Pod별로 구분하며, Pod별 unmount/unmap도 서로 다른 Pod target에서 병렬 실행할 수 있습니다
이 제어는 관련 볼륨 작업의 순서를 조정하는 것이며 여러 CSI 단계와 백엔드 변경을 하나의 원자적 작업으로 만들지는 않습니다

캐시의 정의는 [DSW](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/volumemanager/cache/desired_state_of_world.go)·[ASW](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/volumemanager/cache/actual_state_of_world.go), 작업 키와 backoff는 [NestedPendingOperations](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/util/nestedpendingoperations/nestedpendingoperations.go)에 있습니다

## 정상 해제는 Pod target부터 되돌립니다

같은 노드의 다른 Pod가 볼륨을 계속 쓴다면 한 Pod의 사용 종료만으로 노드의 준비까지 해제하면 안 됩니다
CSI는 NodeStage를 사용하는 볼륨에서 모든 NodeUnpublishVolume이 성공한 뒤 NodeUnstageVolume을 호출하도록 요구합니다
ControllerUnpublishVolume도 필요한 노드 사용 해제가 끝난 뒤 호출하는 계약입니다

![정상 해제에서 각 Pod target의 NodeUnpublishVolume이 성공한 뒤 선택적인 NodeUnstageVolume으로 노드 준비를 해제하고 ControllerUnpublishVolume으로 볼륨-노드 연결을 해제하는 순서|tall](/diagrams/k8s-theory-volume-attach-stage-publish-2.svg)

현재 kubelet reconciler는 Pod 사용 참조가 사라졌는지 확인해 UnmountVolume을 실행합니다
노드 준비 해제는 ASW의 mounted Pod 참조가 없고 DSW에도 더 필요한 볼륨이 없으며 관련 작업이 진행 중이지 않을 때 판단합니다
시작 시 상태 복구가 덜 끝난 것을 미사용으로 오인하지 않도록 해제 준비 조건도 확인합니다

파일시스템 CSI 구현의 TearDownAt은 NodeUnpublishVolume을, UnmountDevice는 지원되는 경우 NodeUnstageVolume을 호출합니다
그 뒤 controller가 VolumeAttachment 삭제를 요청하고 external-attacher가 ControllerUnpublishVolume을 수행합니다
VolumeAttachment 삭제 요청의 접수와 백엔드의 분리 완료도 같은 시점은 아닙니다

이 순서는 [kubelet reconciler](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/volumemanager/reconciler/reconciler_common.go)와 [CSI 참조 계수·해제 계약](https://github.com/container-storage-interface/spec/blob/cd9e7ad1ae0915cabcad179f2b8a660c0cb6eb9f/spec.md#rpc-interactions-and-reference-counting)에 근거합니다
노드가 응답하지 않아 정상 해제를 끝낼 수 없는 경우는 뒤의 강제 분리 조건과 구분해야 합니다

## 코어의 Multi-Attach 검사를 통과해도 드라이버가 거절할 수 있습니다

attach/detach controller는 attach를 시작하기 전에 다른 노드에 이미 붙어 있는지 확인합니다
CSI persistent volume의 PV accessModes에 대한 코어의 사전 판단은 다음과 같습니다

| PV accessModes | IsMultiAttachAllowed의 판단 |
|---|---|
| 비어 있음 | 알 수 없으므로 통과시켜 실제 attacher 판단을 기다림 |
| ReadWriteMany 또는 ReadOnlyMany가 있음 | 여러 노드 attach를 코어에서 미리 차단하지 않음 |
| 그 밖의 모드만 있음 | 다른 노드 attachment가 있으면 차단 |

이때 `FailedAttachVolume` Event에 `Multi-Attach error`가 포함됩니다
다른 노드의 사용 Pod를 찾았는지에 따라 단독 연결이 남았다는 메시지 또는 사용 중인 Pod 목록이 나옵니다

이 검사를 통과했다고 백엔드의 실제 multi-attach 지원까지 증명되는 것은 아닙니다
드라이버는 요청 capability나 이미 연결된 노드에 따라 ControllerPublishVolume을 거절할 수 있습니다

RWO는 한 노드의 여러 Pod가 함께 사용하는 것까지 금지하는 모드가 아닙니다
반면 RWOP는 스케줄러와 kubelet의 별도 Pod 사용 검사도 있으므로 같은 노드 공유의 설명에 함께 묶으면 안 됩니다
현재 사전 검사는 [IsMultiAttachAllowed](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/util/util.go), Pod 사용 검사는 [operation generator](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/util/operationexecutor/operation_generator.go)에 있습니다

## ContainerCreating만으로 어느 준비가 남았는지 알 수 없습니다

kubelet은 컨테이너를 만들기 전에 WaitForAttachAndMount로 볼륨 준비 상태를 기다립니다
현재 한 번의 대기 상한은 2분 3초이며 300ms 간격으로 상태를 확인합니다
이는 CSI RPC를 300ms마다 재호출한다는 뜻이나 전체 Pod 기동이 그 시간에 끝난다는 뜻이 아닙니다
상위 context 종료로 대기가 더 일찍 끝날 수도 있습니다

Pod phase인 Pending과 컨테이너 Waiting reason인 ContainerCreating은 다른 필드입니다
이 표시만으로 attach·stage·publish 중 어느 단계가 실행됐거나 실패했는지 확정할 수 없습니다

파일시스템 경로에서 다음 접두어는 Kubernetes가 어느 작업을 수행하다 실패했는지 좁히는 단서입니다

| 접두어·표시 | 확인할 주체와 조건 |
|---|---|
| AttachVolume.Attach failed | attach/detach controller, external-attacher, 드라이버 Controller 서비스 |
| MountVolume.WaitForAttach failed | VolumeAttachment의 attached·attachError·삭제 상태 |
| MountVolume.MountDevice failed | NodeStage 연결 경로, node 드라이버·장치·입력 조건 |
| MountVolume.SetUp failed | Pod target 준비와 NodePublish 경로, 권한·입력·Pod 사용 제약 |
| UnmountDevice failed | 노드 준비 해제, 남은 참조·마운트·드라이버 오류 |

이 접두어만으로 CSI RPC가 실제로 호출됐다고 판단할 수는 없습니다
capability 조회나 자격 증명·경로 준비가 먼저 실패할 수도 있으므로 뒤의 오류와 드라이버 로그를 함께 확인해야 합니다
subPath 처리나 runtime의 경로 노출도 NodePublish 호출 하나로 모두 설명할 수 없습니다

타임아웃의 `unattached volumes`는 attach 준비가 남은 대상을, `unmounted volumes`는 Pod 사용 준비가 남은 대상을 구분합니다
unattached가 비어 있어도 attach RPC가 반드시 실행돼 성공했다는 뜻은 아닙니다
attach가 불필요하거나 생략된 경로일 수도 있습니다

### 등록 상한과 실제 자원 고갈 응답도 다릅니다

스케줄러는 CSINode의 allocatable.count를 배치 판단에 사용합니다
하지만 kubelet이 모든 Pod admission에서 같은 숫자를 다시 세어 거절하는 흐름은 아닙니다

현재 구현에서 WaitForAttachAndMount가 실패한 뒤에는 attachable volume의 VerifyExhaustedResource가 별도 오류를 반환할 수 있습니다
드라이버 갱신 주기 설정과 VolumeAttachment의 `ResourceExhausted` 오류 코드가 조건에 맞을 때입니다
kubelet은 이를 `VolumeAttachmentLimitExceeded`로 Pod 거절·종료 처리에 넘깁니다
`MutableCSINodeAllocatableCount`는 v1.35의 beta와 달리 현재 GA·true로 잠겨 있지만, 갱신 설정과 실제 오류 확인 조건은 여전히 필요합니다

대기·오류의 근거는 [volume_manager.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/volumemanager/volume_manager.go), [VerifyExhaustedResource](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/csi_plugin.go), [현재 gate](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go)에 있습니다

## force-detach의 6분은 장애 발생부터 재는 시간이 아닙니다

현재 DefaultTimerConfig의 `ReconcilerMaxWaitForUnmountDuration`은 6분입니다
controller-manager가 실제로 이 기본 설정을 attach/detach controller에 전달합니다
이 시간은 노드가 꺼지거나 Pod DELETE가 접수된 순간부터 재는 것이 아닙니다

controller는 attached 상태인데 더 이상 desired 상태에 없는 볼륨-노드 쌍에 detach 요청 시각을 기록합니다
이전에 기록한 시각이 없으면 SetDetachRequestTime이 그때의 현재 시각을 넣고, 이후 그 시각부터의 경과 시간을 계산합니다
다시 필요한 attachment가 되면 요청 시각을 초기화하는 경로도 있습니다

아직 `MountedByNode`로 보고되는 볼륨을 timeout 때문에 분리 대상으로 넘기려면 다음 조건을 함께 봅니다

| 조건 | 현재 처리 |
|---|---|
| detach 요청 경과 시간이 6분을 초과 | 기본 timeout 조건 충족 |
| 노드가 건강한 것으로 판정되지 않음 | timeout에 의한 사용 중 분리 조건에 필요 |
| DisableForceDetachOnTimeout이 false | timeout 경로가 활성화된 상태 |
| out-of-service taint 키가 있음 | 위 timeout과 별도로 MountedByNode 확인을 우회하는 경로 |

소스의 판단은 `forceDetach := !isHealthy && forceDetachTimeoutExpired`입니다
정상적인 노드 조회에서 건강 여부는 NodeReady가 True인지로 판단합니다
따라서 단순히 6분이 지났다는 이유만으로 건강한 노드가 아직 마운트 중이라고 보고한 볼륨을 떼지 않습니다

`--disable-force-detach-on-timeout`의 CLI 기본값은 false입니다
true로 지정하면 timeout에 의한 강제 분리 경로를 끄지만 out-of-service를 통한 별도 복구 경로까지 같은 조건으로 끄는 것은 아닙니다

이 조건을 만족해도 진행 중인 작업·backoff, Node status 갱신, VolumeAttachment 처리, 드라이버·백엔드 분리가 남습니다
따라서 6분이 지난 시각에 분리 요청이 전송되거나 실제 분리가 완료된다고 보장할 수는 없습니다

기본값과 시계는 [DefaultTimerConfig](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/volume/attachdetach/attach_detach_controller.go)·[SetDetachRequestTime](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/volume/attachdetach/cache/actual_state_of_world.go), 분기는 [attach/detach reconciler](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/volume/attachdetach/reconciler/reconciler.go), 플래그는 [controller-manager 옵션](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kube-controller-manager/app/options/attachdetachcontroller.go)에 있습니다

### 강제 분리는 정상 해제 완료의 증거가 아닙니다

노드가 응답하지 않으면 모든 NodeUnpublish·NodeUnstage의 완료를 확인하지 못할 수 있습니다
그 상태에서 분리를 진행하는 것은 앞의 정상 CSI 해제 순서와 다른 장애 복구 경로입니다

공식 문서는 강제로 분리한 볼륨을 기존 노드의 워크로드가 계속 사용하면 CSI 순서 계약을 어기고 데이터 손상이 생길 수 있다고 설명합니다
out-of-service 처리 전에 노드가 실제로 종료·전원 차단됐는지 확인하도록 요구하는 이유도 여기에 있습니다
taint가 물리적인 전원 차단이나 남은 쓰기의 중단까지 수행하는 것은 아닙니다

근거는 [Node Shutdowns의 비정상 종료·강제 분리](https://kubernetes.io/docs/concepts/cluster-administration/node-shutdown/#storage-force-detach-on-timeout)와 [ControllerUnpublishVolume 계약](https://github.com/container-storage-interface/spec/blob/cd9e7ad1ae0915cabcad179f2b8a660c0cb6eb9f/spec.md#controllerunpublishvolume)입니다
실제 노드의 전원·마운트·백엔드 상태와 분리 완료는 이 글에서 확인하지 않았습니다

## 참고 자료

- [Kubernetes 의존 CSI 버전](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/go.mod)과 [현재 의존 spec](https://github.com/container-storage-interface/spec/blob/cd9e7ad1ae0915cabcad179f2b8a660c0cb6eb9f/spec.md)
- [CSI spec v1.13.0](https://github.com/container-storage-interface/spec/blob/b516e92e3d6c0d27e6c8ffd0a956e3918b50f619/spec.md): 이 글에서 다룬 여섯 RPC의 순서·멱등성 설명을 의존 버전과 대조
- [external-attacher v4.13.0](https://github.com/kubernetes-csi/external-attacher/tree/40d44ae14961a415348180a0e666651e82e44eb7): 역할·오류·재시도 경계, 실제 설치 버전과 구분
