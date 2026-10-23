---
title: "확장·스냅샷·임시 볼륨 — 요청 뒤의 주체와 수명"
excerpt: "PVC 크기 변경을 백엔드와 노드 작업으로 나누고, 스냅샷의 CRD·controller·sidecar와 복원 경로를 구분합니다. generic ephemeral과 CSI inline의 소유권·정리·쿼터 차이, VolumeAttributesClass의 속성 변경도 살펴봅니다"
category: "kubernetes"
tags: ["Kubernetes", "CSI", "Storage", "VolumeExpansion", "VolumeSnapshot", "EphemeralVolume", "concept"]
series:
  name: "k8s-theory-storage"
  order: 5
date: "2026-10-25"
---

PVC의 요청 용량을 늘리는 API 갱신이 성공해도 애플리케이션이 바로 그 공간을 쓸 수 있는 것은 아닙니다
백엔드 볼륨과 필요한 노드 작업이 끝나야 하며, 명세와 용량 상태 사이에 진행 중인 차이가 남을 수 있습니다

[CSI 구조](/essays/k8s-theory-csi-architecture)에서 구분한 외부 controller와 kubelet의 호출 책임이 확장에서도 이어집니다
스냅샷은 요청·실물·클래스의 대응을, 임시 볼륨은 Pod 소유 참조나 노드 호출을 이용해 수명을 정합니다

> **근거**: Kubernetes v1.37.1 `f78e722310e50bcaca9276be22276d9e91d91308`과 공식 문서 저장본 `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`를 대조했습니다
> 코어의 CSI 의존 commit과 외부 spec v1.13.0, external-resizer v2.3.0·external-provisioner v6.4.0·external-snapshotter v8.7.0은 별도 버전입니다
> 실제 클러스터에서 확장·복원·삭제를 실행하거나 드라이버 호환성을 시험한 기록은 포함하지 않습니다

## PVC 요청 변경에는 검증과 admission 조건이 붙습니다

Bound PVC에서 일반적으로 변경하는 명세는 `resources.requests.storage`와 `volumeAttributesClassName`입니다
앞은 용량이고 뒤는 드라이버가 제공하는 속성 클래스입니다

생성 뒤의 다른 명세를 자유롭게 고치는 것은 아닙니다
비어 있던 `volumeName`을 바인딩 과정에서 채우거나, nil인 StorageClass를 지정하고 옛 어노테이션을 필드로 옮기는 예외는 별도로 있습니다
Pending이라는 이유만으로 `volumeMode`나 기존 `dataSource`를 임의로 바꿀 수도 없습니다

기본 활성 admission인 **PersistentVolumeClaimResize**는 크기 증가 요청에서 다음을 검사합니다

- 기존 PVC가 Bound 상태인지
- 이전·새 PVC가 같은 비어 있지 않은 StorageClass를 참조하는지
- 현재 그 StorageClass의 `allowVolumeExpansion`이 true인지

false·미설정이거나 클래스를 읽지 못하면 증가 요청을 거절합니다
이 admission을 비활성화한 환경과 별개로, API가 요청을 받는 것과 드라이버가 실제 확장을 지원하는 것도 나눠야 합니다

판단은 [PVC update 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go)과 [resize admission](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/plugin/pkg/admission/storage/persistentvolume/resize/admission.go)에 있습니다
확장 요청은 PVC에 적습니다. PV 용량만 먼저 고쳐 명세를 맞추면 컨트롤러가 이미 확장됐다고 판단해 실제 작업이 생략될 수 있습니다

## 백엔드 확장과 노드 작업은 다른 호출입니다

아래는 10Gi에서 20Gi로 늘리는 가정 예시입니다
ControllerExpand와 노드의 파일시스템 확장이 모두 필요한 경로를 그린 것이며 모든 드라이버의 공통 순서는 아닙니다

![PVC 요청이 10Gi에서 20Gi로 바뀐 뒤 external-resizer의 백엔드 확장과 kubelet의 필요한 노드 확장을 거쳐 용량 상태가 갱신되는 예시|tall](/diagrams/k8s-theory-volume-expansion-snapshots-ephemeral-1.svg)

`ControllerExpandVolume`은 external-resizer가, `NodeExpandVolume`은 kubelet이 드라이버에 요청합니다
백엔드 용량 변경과 그 장치를 사용하는 노드의 준비를 나누면 두 위치에 필요한 작업·권한·실패를 따로 다룰 수 있습니다
노드 쪽 작업을 파일시스템 확장으로만 한정하지도 않습니다

### 두 RPC가 항상 모두 호출되지는 않습니다

Controller·Node 서비스의 `EXPAND_VOLUME` capability는 각각의 확장 지원을 나타냅니다
ControllerExpandVolume 응답의 `node_expansion_required`가 false이면 이 응답은 노드 확장을 요구하지 않습니다

반대로 노드 확장만 지원하는 구성도 있습니다
현재 [resizer 생성 코드](https://github.com/kubernetes-csi/external-resizer/blob/baa08e6d8773f167dbddce36579f36d84bbe3fde/pkg/resizer/csi_resizer.go)는 지원 여부를 확인해 trivial resizer를 선택할 수 있습니다
이 경로의 sidecar는 ControllerExpandVolume을 부르지 않고 PV 용량과 다음 노드 작업을 연결합니다

코어에도 expand controller가 있지만 native CSI 외부 확장 경로에서 백엔드 RPC를 대신 호출하지 않습니다
`ExternalExpanding` 이벤트와 `waiting for an external controller to expand this PVC` 메시지는 외부 처리를 기다린다는 뜻입니다
이 이벤트 하나로 sidecar의 부재나 실패까지 확정할 수는 없습니다

### NodeExpand는 노드에서 준비된 볼륨을 대상으로 합니다

CSI 규격은 stage 지원 시 NodeStageVolume 성공 뒤에 NodeExpandVolume을 호출하도록 정합니다
stage를 쓰지 않으면 NodePublishVolume 성공 뒤입니다
애플리케이션 컨테이너가 반드시 이미 실행 중이어야 한다는 뜻은 아닙니다

raw Block 모드도 노드 작업이 필요할 수 있습니다
현재 [CSI expander](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/expander.go)는 파일시스템이면 mount 경로를, Block이면 장치 경로를 요청에 사용합니다
Block이라는 이유로 NodeExpand를 항상 생략하거나 파일시스템을 키운다고 설명하면 맞지 않습니다

온라인 확장은 사용 중인 볼륨을 확장하는 기능이며 드라이버와 파일시스템의 지원이 필요합니다
CSI의 ONLINE·OFFLINE capability도 이 조건을 나눕니다
OFFLINE만 지원하면 규격이 정한 사용 해제 뒤 백엔드 확장을 수행하고, 필요한 노드 작업은 다시 stage·publish된 경로에서 진행합니다

예전 `ExpandInUsePersistentVolumes` gate가 현재 기능 선언에 없다는 이유로 모든 드라이버가 온라인 확장을 지원하는 것은 아닙니다
PVC를 수정하는 행위만으로 드라이버의 지원 조건이나 볼륨 사용 해제가 해결되지도 않습니다

## 용량 상태와 오류는 어느 작업이 남았는지 알려 줍니다

PVC의 `conditions`와 `allocatedResourceStatuses.storage`는 같은 확장 과정의 상태를 다른 형태로 나타냅니다
다음은 API가 정의한 의미이며 모든 오류에서 두 열이 일대일로 함께 기록된다는 표는 아닙니다

| 진행·분류 | condition | allocatedResourceStatuses.storage |
|---|---|---|
| Controller 쪽 확장 진행 | `Resizing` | `ControllerResizeInProgress` |
| 노드 확장 대기 | `FileSystemResizePending` | `NodeResizePending` |
| 노드 확장 진행 | — | `NodeResizeInProgress` |
| Controller 쪽 확장 오류·복구 불가능 분류 | `ControllerResizeError` | `ControllerResizeInfeasible` |
| 노드 확장 오류·복구 불가능 분류 | `NodeResizeError` | `NodeResizeInfeasible` |

Infeasible은 단순 타임아웃 같은 일시적 오류보다 좁은 분류입니다
다만 이를 ‘앞으로 영원히 재시도하지 않는다’로 읽으면 안 됩니다
현재 external-resizer에는 이 상태의 느린 재시도 경로가 있으며 요청 변경도 별도로 처리합니다

`FileSystemResizePending`의 메시지는 사용자에게 Pod를 `(re-)start`하라고 안내합니다
이는 노드 작업이 남았다는 단서이며 반드시 Pod를 재시작해야 한다는 판정은 아닙니다
사용 중 확장을 지원하면 실행 중에도 작업할 수 있고, 볼륨을 사용할 Pod가 없으면 노드 작업을 시작할 조건이 부족할 수 있습니다

RWX에서는 PVC 용량 상태가 갱신됐어도 다른 노드의 확장이 남을 수 있습니다
현재 [NodeExpander.runPreCheck](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/util/operationexecutor/node_expander.go)는 노드 확장 불필요 어노테이션이 없는 RWX에 추가 노드 작업을 허용하는 분기가 있습니다
PVC의 용량 숫자 하나가 모든 노드 작업의 완료를 뜻하지는 않습니다

### 실패한 요청을 낮추는 것은 볼륨 축소가 아닙니다

현재 검증은 이전 요청보다 작은 새 요청을 허용하되 **기존 `status.capacity.storage`보다 커야 한다**는 하한을 둡니다
같은 값으로 낮추는 것도 거절합니다

| 크기 관계 | 검증의 의미 |
|---|---|
| 이전 요청보다 큰 새 요청 | 앞의 update·admission 조건과 실제 드라이버 지원을 확인 |
| 현재 용량 < 새 요청 < 이전 요청 | 실패한 확장 요청을 낮춰 다시 시도할 수 있음 |
| 새 요청 ≤ 현재 용량 | 요청 감소에서 거절 |

오류는 `field can not be less than status.capacity`이지만 비교는 `<=`입니다
예를 들어 상태가 10Gi이고 실패한 요청이 20Gi라면 그 사이의 새 요청을 선택하는 복구이며, 이미 커진 디스크를 줄이는 기능이 아닙니다

`RecoverVolumeExpansionFailure`는 v1.34에서 GA·true로 잠겼습니다

## 스냅샷은 요청·실물·클래스를 별도 API로 둡니다

**VolumeSnapshot**은 스냅샷 요청이고 **VolumeSnapshotContent**는 스토리지 시스템의 스냅샷을 나타내는 오브젝트입니다
클래스는 드라이버와 매개변수를 정합니다

| 볼륨 API | 스냅샷 API | 범위 |
|---|---|---|
| StorageClass | VolumeSnapshotClass | 클러스터 |
| PVC | VolumeSnapshot | 네임스페이스 |
| PV | VolumeSnapshotContent | 클러스터 |

스냅샷 API는 `snapshot.storage.k8s.io/v1` CRD입니다
API 서버가 이 리소스를 받아들이는 것과 실제 스냅샷을 만드는 것은 다른 단계입니다

동적 스냅샷에서는 다음 주체가 일을 나눕니다

1. 공통 snapshot-controller가 VolumeSnapshot 요청을 보고 VolumeSnapshotContent 생성·바인딩을 조정합니다
2. 드라이버와 함께 배치한 csi-snapshotter sidecar가 자기 드라이버의 Content를 보고 `CreateSnapshot` 등을 요청합니다
3. 드라이버의 결과가 Content와 Snapshot 상태에 반영됩니다

기존 스냅샷을 Content로 등록하는 정적 경로도 있습니다
`deletionPolicy: Delete`와 `Retain`은 Snapshot 삭제 뒤 스토리지 스냅샷·Content를 지울지 남길지를 구분합니다
실제 삭제 완료에는 controller·sidecar 처리와 보호 finalizer 등이 관여합니다

### CRD와 controller 설치는 드라이버의 RPC 지원과 별개입니다

Kubernetes 저장소의 `cluster/addons/volumesnapshots/`에는 CRD와 controller 배포 예시가 있습니다
현재 고정본의 예시 이미지는 `snapshot-controller:v8.6.0`이며 별도로 확인한 external-snapshotter 릴리스는 v8.7.0입니다
저장소에 매니페스트가 있다는 사실이 모든 클러스터의 자동 설치나 같은 버전 설치를 보장하지 않습니다

공통 CRD·snapshot-controller와 드라이버별 sidecar를 준비해야 하며, 드라이버에도 스냅샷 capability가 필요합니다
`readyToUse`가 false인 이유도 controller 부재, 진행 중인 작업, CSI 오류 등으로 나눠 확인해야 합니다
스냅샷 기능의 존재가 애플리케이션 일관성을 자동으로 보장하지는 않습니다

CRD의 `api-approved.kubernetes.io`도 설치 시의 검증 경계입니다
신규 CRD가 `k8s.io`·`kubernetes.io` 또는 그 하위 그룹이면 승인 URL이나 `unapproved`로 시작하는 사유가 필요합니다
누락 시 Required 오류가 나지만 서버가 링크를 열어 승인 여부를 심사하지는 않습니다
기존 CRD 갱신에서는 승인 상태가 바뀌지 않은 경우의 호환 예외도 있습니다

### 복원은 새 PVC를 채우는 요청입니다

같은 네임스페이스의 스냅샷을 소스로 지정하는 PVC 명세 조각은 다음과 같습니다

```yaml
spec:
  dataSource:
    apiGroup: snapshot.storage.k8s.io
    kind: VolumeSnapshot
    name: source-snapshot
```

기존 볼륨을 제자리에서 되감는 요청이 아닙니다
external-provisioner가 스냅샷을 소스로 하는 CreateVolume을 요청해 새 볼륨을 준비합니다
현재 [getSnapshotSource](https://github.com/kubernetes-csi/external-provisioner/blob/72f13ee46fb93c11a72ef91549e70158283c03af/pkg/controller/controller.go)는 바인딩 참조·드라이버 일치·readyToUse·snapshot handle 등을 확인합니다

`dataSource`는 VolumeSnapshot과 PVC를 받을 수 있고, `dataSourceRef`는 더 넓은 non-core 소스도 표현합니다
더 넓은 참조 필드가 있다고 어떤 소스든 자동으로 복원되는 것은 아닙니다
해당 타입을 처리하는 provisioner·populator와 기능 조건이 필요합니다

## 두 임시 볼륨은 정리 경로와 권한이 다릅니다

**generic ephemeral**은 Pod 안의 `ephemeral.volumeClaimTemplate`으로 PVC를 만듭니다
**CSI inline ephemeral**은 Pod의 `csi` 볼륨 소스로 지정하며 PVC 생성 경로를 거치지 않습니다

![generic ephemeral은 Pod 소유 PVC와 일반 볼륨 경로를 거쳐 GC·회수 정책으로 정리하고 CSI inline은 NodePublishVolume·NodeUnpublishVolume으로 준비·정리하는 두 수명 경로|tall](/diagrams/k8s-theory-volume-expansion-snapshots-ephemeral-2.svg)

generic ephemeral에는 일반 PVC의 바인딩·스토리지 쿼터·provisioner·finalizer·회수 정책이 적용됩니다
Pod 삭제로 PVC가 GC 대상이 돼도 즉시 스토리지 데이터까지 사라진다는 뜻은 아닙니다
PV의 회수 정책이 Retain이면 볼륨을 별도로 정리해야 할 수 있습니다

CSI inline은 `NodePublishVolume`에서 준비하고 `NodeUnpublishVolume`에서 드라이버가 정리합니다
CreateVolume·ControllerPublishVolume·NodeStageVolume을 거치는 persistent 경로와 다릅니다
드라이버가 이 사용 방식을 알아야 하며 `CSIDriver.spec.volumeLifecycleModes`에 Ephemeral을 지원한다고 선언해야 합니다
비어 있는 lifecycle 목록의 기본은 Persistent입니다

드라이버가 일시적으로 응답하지 않으면 정리도 실패·재시도할 수 있습니다
‘Pod 수명을 따른다’는 설명을 동일 시각의 자원 회수 완료로 해석하면 안 됩니다

### generic ephemeral의 이름과 소유자는 생성할 때 정해집니다

생성 PVC 이름은 `<Pod 이름>-<볼륨 이름>`입니다
합친 이름이 PVC 이름으로 유효하지 않으면 Pod 검증에서 거절합니다
템플릿 metadata에는 라벨·어노테이션만 허용하며 명세는 생성 PVC에 복사합니다

[ephemeral controller](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/volume/ephemeral/controller.go)는 PVC 생성 요청부터 Pod UID를 ownerReference에 넣습니다
이때 Controller와 BlockOwnerDeletion을 모두 true로 둡니다

같은 이름의 PVC가 이미 있어도 해당 Pod의 소유가 아니면 덮어쓰거나 채택하지 않습니다
네임스페이스·소유 참조를 검사하는 [VolumeIsForPod](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-helpers/storage/ephemeral/ephemeral.go)는 `(pod is not owner)` 오류를 반환합니다
이름 충돌이 해결되지 않으면 필요한 볼륨을 준비하지 못해 Pod 시작이 막힙니다

### PVC를 거치지 않는다고 모든 제한에서 빠지는 것은 아닙니다

CSI inline은 PVC 개수·요청 용량 쿼터를 거치지 않습니다
일반적인 Pod admission·쿼터는 별개이며 CSI inline의 실제 스토리지 사용량을 kubelet의 로컬 ephemeral-storage 제한과 같게 취급할 수도 없습니다

generic ephemeral은 반대로 Pod 생성 권한을 통해 PVC를 간접 생성할 수 있습니다
사용자에게 직접 PVC 생성 권한이 없어도 가능한 경로이므로 직접 생성 RBAC만으로 사용을 제한할 수는 없습니다
네임스페이스 PVC 쿼터는 적용되며 필요하면 Pod admission에서 이 사용 방식을 제한합니다

CSI inline에서는 사용자가 `volumeAttributes`를 드라이버에 직접 전달합니다
관리자만 정해야 할 StorageClass 매개변수를 무제한으로 노출하는 드라이버라면 이 모드에 적합하지 않습니다
이 보안·제약 조건은 [공식 ephemeral volumes 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/storage/ephemeral-volumes.md)에서 별도로 설명합니다

ConfigMap·Secret·projected·emptyDir 같은 Pod 볼륨도 PVC 없이 동작하지만 준비하는 주체와 데이터의 출처가 다릅니다
같은 ‘임시’라는 이름만으로 CSI RPC, PVC 쿼터, 로컬 스토리지 계측을 하나의 경로로 묶지는 않습니다

## VolumeAttributesClass는 크기와 다른 속성을 바꿉니다

**VolumeAttributesClass**는 드라이버별 IOPS·처리량 같은 속성을 표현하는 클러스터 범위 오브젝트입니다
IOPS는 초당 입출력 횟수이며 어떤 매개변수를 받을지는 드라이버가 정합니다

기존 PVC의 `volumeAttributesClassName`을 새 클래스로 바꾸면 이를 지원하는 external-resizer가 `ControllerModifyVolume`을 요청합니다
이때 드라이버의 MODIFY_VOLUME capability가 필요합니다
생성 시 클래스 매개변수를 전달하는 external-provisioner의 역할과 기존 볼륨을 수정하는 resizer의 역할도 나눠야 합니다

클래스의 `driverName`과 `parameters`는 불변입니다
값을 바꾸려면 새 클래스를 만들고 PVC가 그 이름을 참조하도록 합니다
성공적으로 적용된 클래스가 있으면 PVC 참조를 nil이나 빈 문자열로 제거하는 갱신은 거절합니다

진행은 `status.modifyVolumeStatus`와 `currentVolumeAttributesClassName` 등에서 확인합니다
Pending은 클래스 부재 같은 선행 조건 미충족, InProgress는 진행 중, Infeasible은 드라이버가 요청을 유효하지 않다고 거절한 상태를 나타냅니다
현재 resizer는 InvalidArgument를 Infeasible로 분류하며 모든 오류를 이 상태로 기록하지 않습니다

core의 VolumeAttributesClass는 v1.34 GA이고 v1.36부터 true로 잠겨 있습니다
별도 릴리스인 resizer v2.3.0의 같은 이름 gate는 GA·기본 true이지만 코어와 설정 상태를 동일시하면 안 됩니다
API가 활성화됐어도 sidecar의 설정과 드라이버의 실제 기능 지원은 확인해야 합니다

## 확인할 상태를 호출 주체와 연결합니다

| 표시·오류 | 다음에 구분할 대상 |
|---|---|
| 크기 증가가 Forbidden | Bound 상태·현재 StorageClass·allowVolumeExpansion·admission |
| ExternalExpanding 뒤 진행 없음 | 실제 외부 resizer·드라이버의 응답과 PV/PVC 상태 반영 |
| FileSystemResizePending | 필요한 노드 작업·사용 Pod·capability·노드의 오류 |
| ControllerResizeInfeasible 또는 NodeResizeInfeasible | 어느 쪽의 어떤 요청이 복구 불가능으로 분류됐는지, 새 요청의 용량 하한 |
| 스냅샷 resource type이 없음 | API discovery와 CRD 등록 여부 |
| 스냅샷 readyToUse가 false | 공통 controller·드라이버별 sidecar·Content 바인딩·CSI 결과 |
| generic ephemeral PVC가 없거나 소유가 다름 | controller의 생성 오류·쿼터·이름 충돌·Pod UID |
| Pod 삭제 뒤 PVC·스토리지 자원이 남음 | ownerReference·GC·사용 보호·finalizer·회수 정책 또는 드라이버 정리 |

표는 재현한 장애 결과가 아니라 소스와 API가 제공하는 확인 기준입니다
오브젝트가 존재한다는 것, RPC가 성공했다는 것, 애플리케이션이 확장된 공간이나 복원한 데이터를 사용할 수 있다는 것은 서로 다른 상태입니다

## 확인한 근거

- [코어의 CSI Node 확장](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/expander.go), [외부 확장 controller](https://github.com/kubernetes-csi/external-resizer/blob/baa08e6d8773f167dbddce36579f36d84bbe3fde/pkg/controller/expand_and_recover.go), [CSI 의존 spec](https://github.com/container-storage-interface/spec/blob/cd9e7ad1ae0915cabcad179f2b8a660c0cb6eb9f/spec.md#controllerexpandvolume) — capability·두 호출·노드 선행 조건·실패 분류
- [스냅샷 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/storage/volume-snapshots.md), [external-snapshotter v8.7.0](https://github.com/kubernetes-csi/external-snapshotter/tree/9cc6050ab00a0c56d84ba0279e518a00367363e7), [Kubernetes addon](https://github.com/kubernetes/kubernetes/tree/f78e722310e50bcaca9276be22276d9e91d91308/cluster/addons/volumesnapshots) — CRD·공통 controller·sidecar·배포 예시의 구분
- [CSI 노드 준비·정리](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/csi_mounter.go), [ephemeral volumes](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/storage/ephemeral-volumes.md) — 두 임시 볼륨의 수명·소유·보안 경계
- [현재 core gate](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go), [resizer의 modifier](https://github.com/kubernetes-csi/external-resizer/blob/baa08e6d8773f167dbddce36579f36d84bbe3fde/pkg/modifier/csi_modifier.go), [resizer의 gate](https://github.com/kubernetes-csi/external-resizer/blob/baa08e6d8773f167dbddce36579f36d84bbe3fde/pkg/features/features.go) — VolumeAttributesClass의 잠금·외부 설정·RPC 지원 조건
