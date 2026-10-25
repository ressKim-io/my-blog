---
title: "볼륨 개수 상한 — 드라이버가 말한 숫자를 누가 고치나"
excerpt: "NodeGetInfo의 상한이 CSINode를 거쳐 스케줄러에 전달되는 경로를 따라갑니다. 중복 제거의 단위와 예외, nil·0의 차이, 주기 갱신과 ResourceExhausted 이후 Pod 실패 처리의 조건을 구분합니다"
category: "kubernetes"
tags: ["Kubernetes", "CSI", "Storage", "Scheduling", "concept"]
series:
  name: "k8s-theory-storage"
  order: 6
date: "2026-10-28"
---

노드에 볼륨을 몇 개까지 붙일 수 있는지는 CSI(Container Storage Interface) 드라이버가 선언합니다
kubelet은 노드 정보를 묻는 `NodeGetInfo` RPC의 응답을 CSINode에 기록하고, 스케줄러는 그 값을 노드별 배치 판단에 사용합니다

이 숫자는 Kubernetes 코어가 하드웨어의 남은 자리를 직접 측정한 결과가 아닙니다
등록 때의 값이 이후 상태와 달라지면 배치를 통과한 Pod도 attach에서 실패할 수 있습니다

> **근거**: Kubernetes v1.37.1 소스 `f78e722310e50bcaca9276be22276d9e91d91308`과 공식 문서 저장본 `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`를 대조했습니다
> CSI 계약은 코어의 의존 commit `cd9e7ad1ae0915cabcad179f2b8a660c0cb6eb9f` 기준입니다
> v1.35의 과거 구현과 현행 갱신·설치 확인 조건을 구분하며, 실제 드라이버 설치·상한 변경·장애 재현이나 측정은 포함하지 않습니다

## 드라이버가 선언한 상한을 노드와 드라이버별로 읽습니다

CSINode는 해당 노드에 등록된 CSI 드라이버의 정보를 담는 오브젝트입니다
드라이버 항목의 `allocatable.count`에는 그 노드에서 해당 드라이버가 관리할 수 있다고 보고한 고유 볼륨 개수가 들어갑니다

![CSI 드라이버의 NodeGetInfo 상한을 kubelet이 CSINode에 기록하고 NodeVolumeLimits가 노드와 드라이버별 기존 수와 새 요구를 비교해 상한 초과 노드를 제외하는 흐름|xtall](/diagrams/k8s-theory-volume-attachment-limits-1.svg)

숫자 상한이 설정된 드라이버에 대해 **NodeVolumeLimits** 플러그인은 Filter 확장점에서 후보 노드를 검사합니다
현재 기본 스케줄러 설정에 포함된 플러그인이며, 이를 통과해도 다른 Filter·점수·바인딩 조건이 남습니다

다음은 필드의 위치를 보여 주는 예시입니다
25가 모든 드라이버·클라우드의 기본값이라는 뜻은 아닙니다

```yaml
apiVersion: storage.k8s.io/v1
kind: CSINode
metadata:
  name: node-a
spec:
  drivers:
    - name: csi.example.com
      nodeID: driver-node-a
      allocatable:
        count: 25
```

드라이버가 다르면 별도의 상한으로 계산합니다
서로 다른 드라이버나 네트워크 인터페이스가 백엔드의 같은 장치 한도를 나눠 쓰는 환경이라도, 이 플러그인이 그 자원을 하나의 전역 숫자로 합쳐 측정하지는 않습니다
드라이버가 자기 볼륨에 사용할 수 있는 상한을 적절히 보고해야 합니다

클라우드의 실제 한도도 인스턴스·장치 종류·드라이버 정책에 따라 달라집니다
공식 문서의 클라우드별 숫자 표를 모든 CSI 드라이버의 한도로 적용하면 안 됩니다
CSI 경로에서는 [NodeGetInfo로 보고한 상한](https://kubernetes.io/docs/concepts/storage/storage-limits/#dynamic-volume-limits)을 읽습니다

## 세는 것은 Pod나 마운트 횟수가 아니라 볼륨 키입니다

먼저 앞의 예시처럼 양수 상한이 기록된 드라이버의 계산을 보겠습니다
바인딩된 CSI PV의 키는 `드라이버이름/볼륨핸들`입니다
같은 볼륨을 같은 노드의 여러 Pod가 사용해도 기존 Pod 목록에서는 하나로 셉니다
attach와 mount가 모두 있다는 이유로 두 개가 되지도 않습니다

이 단위는 [attach·stage·publish의 준비 단위](/essays/k8s-theory-volume-attach-stage-publish)와 다릅니다
Pod마다 publish target이 생겨도 그 경로 수를 볼륨 상한에 더하는 방식은 아닙니다

현재 Filter는 새 Pod, 기존 Pod 목록, VolumeAttachment를 다음 순서로 대조합니다

1. 새 Pod의 볼륨 키를 모읍니다
2. 해당 노드의 기존 Pod 볼륨을 중복 제거해 세고, 같은 키를 새 요구에서 제거합니다
3. 그 노드를 가리키는 VolumeAttachment 중 기존 Pod 목록에 없는 키를 기존 수에 더합니다
4. 남은 새 요구를 드라이버별로 세어 `기존 수 + 새 수 > 상한`이면 노드를 거절합니다

이때 VolumeAttachment는 `status.attached: true`인 것만 고르지 않습니다
현재 경로는 해당 노드·attacher·참조 PV·CSI volumeHandle을 확인해 셉니다
API 오브젝트 수나 현재 attach 성공 횟수를 직접 세는 것과는 다릅니다

### 중복 제거에도 범위가 있습니다

VolumeAttachment에만 남아 있고 기존 Pod 목록에는 없는 볼륨을 새 Pod가 요구하는 경우가 있습니다
현재 구현은 그 키를 VolumeAttachment 쪽 기존 수에 더하면서 새 요구에서는 제거하지 않습니다
이 경우 두 수에 함께 들어갈 수 있으므로 모든 자료를 하나의 집합으로 합쳐 한 번만 센다고 설명하면 틀립니다

아직 바인딩되지 않은 PVC는 StorageClass의 provisioner와 PVC에 기반한 임시 식별자로 셀 수 있습니다
검사 도중 바인딩되면 임시 식별자와 실제 핸들을 서로 다른 볼륨으로 세어 과다 계산할 수 있다는 주석도 있습니다

generic ephemeral volume은 생성되는 PVC 이름과 Pod 소유 관계를 확인해 같은 계산 경로에 넣습니다
Pod의 `volumes[].csi`로 직접 지정하는 CSI inline ephemeral과 같은 경로는 아닙니다
마이그레이션 대상 in-tree 볼륨도 변환·활성 조건을 거쳐 CSI 키로 계산할 수 있습니다

볼륨 수 계산과 중복 제거, 설치 확인의 실제 분기는 [CSILimits.Filter·filterAttachableVolumes·getNodeVolumeAttachmentInfo](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/nodevolumelimits/csi.go)에 있습니다

## 상한 갱신은 같은 드라이버에게 다시 묻는 과정입니다

등록 때 사용할 수 있던 자리가 나중에도 같다는 보장은 없습니다
[KEP-4876](https://github.com/kubernetes/enhancements/blob/239378198938b817a1a5fbdf05501bd66d304a86/keps/sig-storage/4876-mutable-csinode-allocatable/README.md)은 수동 장치 연결, 여러 드라이버, 특정 장비의 네트워크 인터페이스와 볼륨이 공유하는 한도를 배경으로 설명합니다
모든 스토리지가 이런 슬롯 구조를 가진다는 뜻은 아닙니다

`MutableCSINodeAllocatableCount`는 v1.35에서 beta·기본 활성이었고 v1.36부터 GA·true로 잠겼습니다
현행 v1.37에서 이 기능을 쓰기 위해 false였던 게이트를 켜는 절차로 설명할 수는 없습니다
실제 재조회에는 CSIDriver의 `spec.nodeAllocatableUpdatePeriodSeconds` 설정이 여전히 필요합니다

| 주기 필드 | 동작 |
|---|---|
| 미설정 | 이 기능의 주기 갱신과 고갈 반응 갱신을 모두 하지 않음 |
| 10초 이상 설정 | 설치·조회 조건이 맞으면 해당 간격으로 NodeGetInfo 재조회 |
| 10초 미만 설정 | API 검증에서 거절 |

주기 갱신기는 로컬에 드라이버가 설치됐는지와 CSIDriver 오브젝트·주기를 확인합니다
주기가 바뀌면 기존 갱신 작업을 멈추고 새 주기로 시작하며, 드라이버 해제나 오브젝트 삭제도 중단 조건입니다

조회가 곧 API 쓰기는 아닙니다
보고된 nodeID·topology 키·상한과 관리 어노테이션이 그대로면 CSINode 갱신을 생략합니다
10초의 하한은 검증 코드로 확인되지만, 10이라는 값을 선택한 정량 근거까지 그 코드가 설명하지는 않습니다

### 기존 드라이버 항목 전체가 가변이 된 것은 아닙니다

API 검증은 같은 이름으로 남아 있는 기존 드라이버 항목을 비교합니다
현행에서는 양쪽 사본의 allocatable만 제거해 비교하므로 이 필드의 변경을 허용하고, nodeID·topologyKeys 같은 나머지 변경은 불변 검증을 받습니다
드라이버 항목의 추가·삭제까지 금지한다는 뜻은 아닙니다

nodeID는 스토리지가 노드를 식별하는 값이고 topology 키는 볼륨의 위치 제약과 연결됩니다
상한을 갱신하면서 이 식별·위치 관계까지 함께 바꿀 수 있도록 허용하는 기능이 아닙니다
count의 갱신은 이후 판단에 쓰일 숫자를 바꾸며 이미 붙은 볼륨을 자동 분리하지 않습니다

주기·미변경 쓰기 생략은 [csi_node_updater.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/csi_node_updater.go)와 [nodeinfomanager.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/nodeinfomanager/nodeinfomanager.go), 단계·기본값은 [feature gate 정의](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go)에 근거합니다

## attach의 ResourceExhausted는 볼륨 대기 실패 뒤에 확인합니다

주기 갱신 외에 attach의 `ResourceExhausted` 오류로 재조회를 시도하는 경로가 있습니다
현재 kubelet은 모든 Pod의 admission에서 볼륨 개수를 다시 세는 대신, WaitForAttachAndMount가 실패한 뒤 아직 미부착인 볼륨의 원인을 확인합니다

![VolumeAttachment에 기록된 ResourceExhausted 숫자 코드를 kubelet이 대기 실패 후 조건부로 확인해 드라이버 재조회와 상한 갱신을 시도하고 Pod를 Failed로 처리하며 새 Pod 생성은 워크로드 컨트롤러에 맡기는 흐름|xtall](/diagrams/k8s-theory-volume-attachment-limits-2.svg)

이 경로에 들어가려면 attachable plugin을 찾을 수 있어야 합니다
CSI persistent volume의 경우 CSIDriver 조회와 주기 설정, 해당 VolumeAttachment 조회, `status.attachError.errorCode`의 숫자 8이 필요합니다
8은 gRPC `RESOURCE_EXHAUSTED`이며 소스의 Go 상수 이름은 `codes.ResourceExhausted`입니다

오류 message에 자리 부족이라는 문구가 있는 것만으로는 이 판정을 하지 않습니다
NodePublish 오류나 조회 실패도 이 숫자 조건을 대신하지 않습니다
external-attacher 같은 상태 작성자가 실제 숫자 코드를 기록해야 합니다

코드를 확인한 kubelet은 NodeGetInfo를 다시 호출하고 CSINode 갱신을 시도합니다
그 뒤 특수 오류를 받은 SyncPod가 Pod를 `Failed`로 처리하며 reason은 `VolumeAttachmentLimitExceeded`입니다
공식 문서의 ‘즉시 갱신’은 주기 tick을 기다리지 않는 이 반응 경로이며, attach 실패 발생 즉시 감지하거나 갱신 완료 시간을 보장한다는 뜻은 아닙니다

### Pod 실패와 상한 갱신 성공은 하나의 작업이 아닙니다

재조회나 CSINode 갱신에 실패해도 VerifyExhaustedResource는 오류를 로그에 남긴 뒤 고갈 판정을 true로 반환합니다
따라서 Pod가 Failed인 것만으로 상한 갱신까지 성공했다고 판단하면 안 됩니다
성공한 갱신이 스케줄러의 캐시에 전달되는 과정도 비동기입니다

이 처리는 같은 Pod를 다른 노드로 옮기는 동작이 아닙니다
대체 Pod를 만들지는 Deployment·StatefulSet 같은 워크로드 컨트롤러의 정책이 결정하며, 단독 Pod에는 자동 대체가 없습니다
새 Pod가 만들어져 갱신된 상한으로 다시 평가되더라도 다른 노드 선택이나 attach 성공까지 보장하지는 않습니다

주기를 적지 않으면 이 글의 고갈 확인·갱신·특수 Pod 실패 경로가 활성화되지 않습니다
일반 attach 작업의 재시도·backoff나 스케줄러의 Pending Pod 재평가는 별도 주체의 동작입니다

이 조건과 실패 순서는 [WaitForAttachAndMount](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/volumemanager/volume_manager.go), [VerifyExhaustedResource](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/csi_plugin.go), [SyncPod·rejectPod](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kubelet.go)에서 확인할 수 있습니다

## CSI의 0과 CSINode의 0은 다릅니다

CSI의 `max_volumes_per_node`는 생략하거나 0으로 보내면 오케스트레이터가 한도를 결정하도록 맡긴다는 뜻입니다
음수는 CSI 계약에서 허용하지 않습니다

반면 CSINode의 `count`는 포인터 필드입니다
`allocatable` 자체도 포인터이므로 숫자 상한의 미설정은 두 위치에서 생길 수 있습니다

| 값이 있는 위치 | 의미·현재 변환 |
|---|---|
| NodeGetInfo의 0·미설정 | kubelet이 allocatable을 만들지 않음 |
| NodeGetInfo의 음수 | 오류 로그를 남기고 상한 없이 드라이버 항목 저장 |
| NodeGetInfo의 양수 | count로 기록, int32 최댓값 초과는 2147483647로 제한 |
| CSINode의 allocatable 또는 count 미설정 | 이 드라이버의 숫자 상한 표에 넣지 않음 |
| CSINode의 count: 0 | 명시적인 상한 0, 음수만 거절하는 API 검증상 유효 |

따라서 앞의 kubelet 변환 경로로는 `count: 0`이 생기지 않습니다
다른 API 작성자가 기록할 수 있지만, 값 하나만 보고 누가 작성했는지 단정할 수는 없습니다

미설정이면 이 필터가 숫자로 제한하지 않는다는 뜻입니다
실제 백엔드가 무제한이거나 드라이버가 노드에 설치됐거나 attach가 성공한다는 보장은 아닙니다
상한을 0으로 바꾸는 것도 이미 사용하는 볼륨을 떼거나 기존 Pod를 퇴거시키는 동작은 아닙니다

근거는 [CSI NodeGetInfo 계약](https://github.com/container-storage-interface/spec/blob/cd9e7ad1ae0915cabcad179f2b8a660c0cb6eb9f/spec.md#nodegetinfo), [kubelet의 변환](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/nodeinfomanager/nodeinfomanager.go), [스토리지 API 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/storage/validation/validation.go)입니다

## 상한 검사와 드라이버 설치 확인은 별도입니다

v1.37의 `VolumeLimitScaling`은 beta·기본 활성입니다
하지만 드라이버가 없는 노드로의 배치를 막으려면 CSIDriver의 `spec.preventPodSchedulingIfMissing: true`도 필요합니다
이 필드의 기본값은 false입니다

현재 설치 확인은 다음 순서로 동작합니다

| 조건 | 이 설치 확인의 결과 |
|---|---|
| CSIDriver 조회가 NotFound | 이 확인으로 막지 않음 |
| CSIDriver 조회에서 다른 오류 | 오류 반환 |
| preventPodSchedulingIfMissing이 true가 아님 | 이 확인으로 막지 않음 |
| true인데 CSINode가 없거나 해당 드라이버 항목이 없음 | Unschedulable |
| true이고 해당 드라이버 항목이 있음 | 숫자 상한 등 다음 판단 진행 |

이 확인은 숫자 상한 표를 읽기 전에 있습니다
그러므로 count가 없으면 숫자 검사를 하지 않는다는 설명을 드라이버 설치 확인까지 생략한다는 뜻으로 넓히면 안 됩니다
v1.35의 alpha·기본 비활성과 현행의 beta·기본 활성도 구분해야 합니다

Cluster Autoscaler를 함께 쓴다면 새 노드의 배치 시뮬레이션에 필요한 CSI 정보를 포함하는 설정도 확인해야 합니다
[공식 문서](https://kubernetes.io/docs/concepts/storage/storage-limits/#csi-volume-attach-limits-and-cluster-autoscaler)는 이 설치 확인 옵트인을 CSI node-aware scheduling 설정과 함께 쓰도록 안내합니다

## Node의 옛 확장 자원 키를 현재 상한으로 읽지 않습니다

과거에는 `Node.status.allocatable`에 `attachable-volumes-csi-<driver>` 형태의 키가 사용됐습니다
v1.35 고정 소스에는 kubelet 등록·해제 때 그 키를 지우는 removeMaxAttachLimit 함수가 남아 있었습니다
같은 함수의 제거 예정 주석과 그 릴리스에 실제 코드가 남아 있는 것은 구분해야 합니다

현재 v1.37의 등록·해제 구현에는 그 정리 함수가 없으며, 앞에서 확인한 NodeVolumeLimits는 CSINode의 숫자 필드를 읽습니다
Node에 옛 키가 남아 있다고 이 플러그인이 두 위치의 상한을 합치거나 CPU·memory처럼 일반 자원 수요로 계산하지는 않습니다

과거 경로는 [v1.35 nodeinfomanager](https://github.com/kubernetes/kubernetes/blob/5671697925fe8d7222c4ab09cb15f28f5f9d0383/pkg/volume/csi/nodeinfomanager/nodeinfomanager.go), 현재 경로는 [v1.37.1 nodeinfomanager](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/nodeinfomanager/nodeinfomanager.go)와 대조했습니다

## 같은 Pending이라도 개수·바인딩·위치를 나눕니다

| 상태·사유 | 구분할 조건 |
|---|---|
| Pending, node(s) exceed max volume count | NodeVolumeLimits가 계산한 기존·새 요구와 해당 드라이버 count |
| Pending, node(s) didn't find available persistent volumes to bind | 바인딩 가능한 PV·프로비저닝과 StorageClass의 바인딩 조건 |
| Pending, node(s) didn't match PersistentVolume's node affinity | PV의 위치 제약과 후보 노드 |
| Pending, CSI driver is not installed on the node | VolumeLimitScaling과 CSIDriver의 설치 확인 옵트인·CSINode 항목 |
| PVC 조회 NotFound | NodeVolumeLimits에서 UnschedulableAndUnresolvable, PVC 생성 필요 |
| 배치 뒤 Failed, VolumeAttachmentLimitExceeded | kubelet 대기 실패 후의 주기 설정·숫자 고갈 코드 등 조건 |

숫자 상한 초과는 현재 Filter에서 `Unschedulable`입니다
볼륨을 쓰던 Pod나 VolumeAttachment가 없어지거나 CSINode 상한이 늘면 재평가 대상이 될 수 있습니다
스케줄러가 관련 이벤트를 받아 다시 시도하는 것과, 배치된 Pod를 kubelet이 실패 처리하고 컨트롤러가 대체하는 것은 다른 흐름입니다

바인딩·위치 사유의 원문은 [volumebinding/binder.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/volumebinding/binder.go), 숫자 상한·PVC 오류·재평가 이벤트는 [nodevolumelimits/csi.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/nodevolumelimits/csi.go)에 있습니다

## 확인한 근거

- [현재 Node-specific Volume Limits 문서](https://kubernetes.io/docs/concepts/storage/storage-limits/)와 [공식 문서 고정본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/storage/storage-limits.md): 숫자 상한·동적 갱신·설치 확인의 구분
- [VolumeNodeResources·CSIDriverSpec·VolumeError 타입](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/storage/v1/types.go): 고유 볼륨·주기·오류 코드의 계약
- [기본 스케줄러 플러그인](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/apis/config/v1/default_plugins.go): NodeVolumeLimits의 기본 포함
- [external-attacher v4.13.0의 saveAttachError](https://github.com/kubernetes-csi/external-attacher/blob/40d44ae14961a415348180a0e666651e82e44eb7/pkg/controller/csi_handler.go): 기능 조건 아래 숫자 오류 코드를 status에 기록하는 외부 구현 예시, 실제 설치 버전과 구분
