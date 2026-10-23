---
title: "PVC 바인딩과 StorageClass — PV의 claimRef를 먼저 쓰는 이유"
excerpt: "PVC와 PV를 연결하는 참조·상태 쓰기 순서를 살펴봅니다. 기본 StorageClass의 미지정과 빈 문자열, 정적·동적 프로비저닝, WaitForFirstConsumer의 스케줄러 예약·관측 조건과 회수 정책을 구분합니다"
category: kubernetes
tags: [kubernetes, storage, pvc, pv, storageclass, scheduling, concept]
series:
  name: "k8s-theory-storage"
  order: 1
date: "2026-10-19"
---

PVC를 생성하면 앱이 필요한 저장소를 요청한 것이며, 사용할 볼륨까지 정해진 것은 아닙니다
누가 기존 볼륨을 고르거나 새로 공급하고, 두 오브젝트의 참조를 맞추는지 이어서 봐야 합니다

**PersistentVolumeClaim(PVC)**은 네임스페이스 안에서 필요한 용량과 접근 방식을 요청합니다
**PersistentVolume(PV)**은 볼륨을 표현하는 클러스터 범위 오브젝트입니다
**StorageClass**는 볼륨을 공급할 provisioner, 바인딩 시점, 회수 정책 등을 정합니다

정적 프로비저닝은 관리자가 볼륨과 PV를 미리 준비하고, 동적 프로비저닝은 요청을 보고 볼륨을 공급합니다
두 경우 모두 PV·PVC 바인딩이 필요합니다
바인딩이 완료돼도 노드의 attach·mount 작업까지 끝났다는 뜻은 아닙니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`, website 저장본: `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 외부 공급 경로는 external-provisioner v6.4.0의 별도 구현을 확인했습니다
> 실제 클러스터의 볼륨 생성·바인딩·마운트·삭제를 실행한 기록은 포함하지 않습니다

## 클래스 미지정과 빈 문자열은 다른 요청입니다

PVC에는 `spec.resources.requests.storage`와 하나 이상의 `spec.accessModes`가 필요합니다
`volumeMode`는 기본 `Filesystem`이며, `selector`로 PV 라벨을 고르거나 `volumeName`으로 특정 PV를 지목할 수 있습니다

`storageClassName`의 생략과 빈 문자열은 구분해야 합니다
옛 beta 클래스 어노테이션이 없는 PVC에서의 의미는 다음과 같습니다

| PVC의 `storageClassName` | 의미 |
|---|---|
| 필드 없음 (`nil`) | 클래스 미지정. 기본 클래스를 적용할 수 있음 |
| `""` | 클래스 없는 PV 요청. 기본 클래스 적용 대상에서 제외 |
| `"fast"` | 이름이 fast인 클래스 지정 |

`storageClassName: ""`는 값을 지정하지 않은 상태가 아닙니다
기본 클래스가 있어도 클래스 없는 정적 PV에 연결하려는 의도를 표현합니다

기본 클래스를 채우는 자리는 둘입니다
생성 admission이 채울 수 있고, PV 컨트롤러가 나중에 기본 클래스를 소급 지정하는 경로도 있습니다

현행 [`syncUnboundClaim`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/volume/persistentvolume/pv_controller.go#L332-L392)은 `volumeName`이 없는 미바인딩 PVC에서 맞는 PV를 찾지 못했을 때 소급 지정을 시도합니다
클래스가 아직 지정되지 않았고 기본 클래스가 있어야 채웁니다
이미 Bound인 모든 PVC를 즉시 다시 쓰거나, 지정된 클래스를 최신 기본 클래스로 바꾸는 기능은 아닙니다

호환 헬퍼는 `volume.beta.kubernetes.io/storage-class` 어노테이션을 먼저 확인합니다
이 어노테이션이 있거나 `storageClassName` 포인터가 nil이 아니면 이미 클래스를 지정했다고 판단합니다
명시한 빈 문자열이 소급 지정에서 제외되는 이유도 이 검사입니다

기본 StorageClass가 여러 개라면 생성 요청을 거절하지 않고 가장 최근에 생성한 것을 선택합니다
생성 시각이 같으면 이름 오름차순으로 정합니다
[공식 StorageClass 문서](https://kubernetes.io/docs/concepts/storage/storage-classes/#default-storageclass)는 기본 클래스를 교체하는 중간 상태를 허용하기 위한 선택이라고 설명합니다

문서의 소급 지정 설명에는 empty value라는 느슨한 표현도 있지만, 같은 절은 명시적인 `""`를 갱신하지 않는다고 구분합니다
실제 판단은 [`PersistentVolumeClaimHasClass`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-helpers/storage/volume/helpers.go#L27-L57)와 포인터·호환 어노테이션 조건으로 읽는 편이 정확합니다

## 기존 PV는 접근 방식과 용량을 함께 보고 고릅니다

일반적인 미예약 PV 탐색은 다음 조건을 확인합니다
다른 PVC를 가리키는 `claimRef`가 있으면 그 PVC의 후보로 가져오지 않습니다

| 조건 | 일반 후보의 통과 기준 |
|---|---|
| 용량 | PV 용량이 PVC 요청 이상 |
| 클래스 | 요청한 클래스와 일치 |
| `volumeMode` | 일치. 생략은 Filesystem 기본값 적용 |
| `volumeAttributesClassName` | 일치. nil·빈 값은 빈 이름으로 비교 |
| accessModes | PV의 모드 집합이 PVC 요청을 포함 |
| 라벨 | PVC의 selector와 일치 |
| 상태·삭제 | Available이며 삭제 예정이 아님 |

`VolumeAttributesClass`는 v1.34 GA이며, 확인한 v1.37.1에서는 기본 활성 상태로 고정돼 있습니다
볼륨 속성 클래스도 현재 짝짓기 조건에 포함됩니다

accessModes는 완전 일치가 아니라 포함 관계입니다
PV 컨트롤러는 요청 모드를 포함하는 조합을 모드 수가 적은 순서로 확인하고, **처음 매칭되는 조합 안에서** 요청 이상인 가장 작은 PV를 고릅니다
전체 PV 재고에서 용량만 비교해 무조건 가장 작은 것을 고르는 것은 아닙니다

이 탐색은 [`persistentVolumeOrderedIndex`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/volume/persistentvolume/index.go)와 공통 [`FindMatchingVolume`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-helpers/storage/volume/pv_helpers.go#L186-L326)에 나뉘어 있습니다
스케줄러가 같은 헬퍼에 Node를 전달하는 경로에서는 PV의 `nodeAffinity`와 그 노드의 라벨도 대조합니다

1Gi를 요청한 PVC의 가장 작은 적합 후보가 100Gi PV라고 가정하겠습니다
그 PV에 연결될 수 있습니다
PVC spec의 요청이 100Gi로 바뀌는 것이 아니라, Bound로 진입할 때 status에 연결된 PV의 용량·접근 방식을 보고합니다

이것도 status를 매번 PV 용량으로 덮어쓴다는 뜻은 아닙니다
이미 Bound인 PVC의 용량 불일치는 파일시스템 확장 과정에서 의미가 있을 수 있어 보존하며, pre-resize 용량 어노테이션이 있으면 바인딩 상태 반영에도 그 값을 사용하는 예외가 있습니다

### volumeName 지목과 예약된 PV는 별도 분기입니다

PVC의 `spec.volumeName`으로 PV를 직접 지목하면 일반 후보 탐색을 건너뜁니다
그 PV의 `claimRef`가 비어 있다면 삭제 예정 여부·용량·클래스·volumeMode·속성 클래스·accessModes를 검사합니다

이 바인딩 검사에는 PVC 라벨 selector와 PV nodeAffinity를 넣지 않습니다
이미 같은 PVC를 가리키는 `claimRef`가 있으면 그 검사를 다시 수행하지 않고 바인딩을 완성하는 분기도 있습니다
그러나 Pod 스케줄링에서는 PV nodeAffinity가 별도로 적용됩니다

따라서 특정 PV에 바인딩됐어도 그 볼륨의 위치에서 Pod를 배치할 수 없는 상태는 가능합니다
이 경계는 [`checkVolumeSatisfyClaim`과 지목 분기](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/volume/persistentvolume/pv_controller.go#L260-L480)를 함께 봐야 합니다

## 바인딩은 PV 쪽 참조를 먼저 기록합니다

PV 컨트롤러의 `bind`는 네 처리 순서로 PV와 PVC를 연결합니다
각각 별도 API 쓰기이며, 이미 같은 값이면 해당 쓰기를 생략할 수 있습니다

![PV claimRef·PV Bound·PVC volumeName과 완료 어노테이션·PVC Bound를 별도 쓰기로 반영하는 순서|tall](/diagrams/k8s-theory-pvc-storageclass-binding-1.svg)

| 순서 | 반영할 값 |
|---|---|
| 1 | PV의 `spec.claimRef`에 PVC 이름·네임스페이스·UID |
| 2 | PV의 `status.phase: Bound` |
| 3 | PVC의 `spec.volumeName`과 `pv.kubernetes.io/bind-completed` 어노테이션 |
| 4 | PVC의 `status.phase: Bound`와 관련 status |

PV는 여러 네임스페이스의 PVC가 함께 탐색하는 자원입니다
경쟁이 생기는 PV의 참조를 먼저 기록해야 다른 PVC가 같은 PV를 계속 자유 후보로 보지 않게 됩니다
API 갱신의 충돌과 재처리가 이 경쟁을 조정하며, 두 오브젝트를 한 트랜잭션으로 바꾸는 것은 아닙니다

`claimRef`의 UID는 특정 PVC의 신원을 구분합니다
같은 이름의 PVC를 삭제하고 다시 만들었어도 UID가 다르면 이전 PVC와 같은 대상으로 보지 않습니다

| PV의 `claimRef` | 의미 |
|---|---|
| 없음 | 특정 PVC 참조 없음 |
| 이름·네임스페이스만 있고 UID 없음 | 그 이름의 PVC를 위한 예약 |
| UID까지 있음 | 특정 PVC의 신원 참조. 전체 바인딩 완료나 phase를 이것만으로 확정하지 않음 |

UID 없는 예약 PV도 Available로 표시될 수 있지만 다른 PVC는 가져갈 수 없습니다
스케줄러의 임시 가정이나 API 쓰기 중간에도 UID가 채워질 수 있어, UID 유무와 전체 완료를 같게 보면 안 됩니다

중간 쓰기에서 실패하면 다음 reconcile이 현재 참조·상태를 보고 남은 작업을 이어갑니다
PV 컨트롤러에는 기본 15초의 `--pvclaimbinder-sync-period`로 PV·PVC를 다시 큐에 넣는 경로도 있습니다
이 주기는 완료 시간 상한은 아닙니다

같은 PVC에 다른 PV가 먼저 연결된 경우의 되돌림도 있습니다
`pv.kubernetes.io/bound-by-controller`가 있는 PV는 claimRef를 지우고 Available로 돌립니다
사람이 미리 예약한 PV라면 UID만 지워 이름·네임스페이스 예약을 유지합니다

쓰기·되돌림의 기준은 [`bind`와 `unbindVolume`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/volume/persistentvolume/pv_controller.go#L1095-L1176)입니다
스케줄러의 Unreserve가 이미 성공한 API 쓰기를 모두 되돌려 준다고 해석해서는 안 됩니다

### PVC spec의 불변성과 컨트롤러 쓰기 예외

PVC spec은 쿼터·범위 검사를 우회하지 못하도록 대부분의 변경을 제한합니다
바인딩 컨트롤러가 써야 하는 `volumeName`은 기존 값이 비었을 때 채울 수 있도록 예외를 둡니다

기본 클래스의 nil 값 보완, Bound PVC의 용량 요청과 속성 클래스 변경 등에도 별도 검증 조건이 있습니다
따라서 volumeName이 유일한 예외라거나 바인딩된 PVC의 모든 필드를 자유롭게 고칠 수 있다고 설명하면 부정확합니다
실제 조건은 [`ValidatePersistentVolumeClaimUpdate`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go#L2566-L2619)에 있습니다

## StorageClass는 공급 방식과 시점을 정합니다

| 필드 | 역할·기본값 |
|---|---|
| `provisioner` | 공급을 담당할 구현 이름. 필수 |
| `volumeBindingMode` | Immediate 또는 WaitForFirstConsumer. 기본 Immediate |
| `reclaimPolicy` | 동적으로 만든 PV의 Delete 또는 Retain 정책. 기본 Delete |
| `allowVolumeExpansion` | PVC 확장 허용 여부. 실제 드라이버 지원도 필요 |
| `allowedTopologies` | 공급 가능한 위치 제한 |
| `parameters` | provisioner별 설정. API는 최대 512개 키를 허용 |

외부 프로비저닝에서 코어 PV 컨트롤러가 CSI `CreateVolume`을 직접 호출하지는 않습니다
PVC에 `volume.kubernetes.io/storage-provisioner`로 담당 이름을 알리고 `ExternalProvisioning` 이벤트를 남깁니다
이벤트는 외부 공급을 기다린다는 단서이며, 처리자가 없다는 판정은 아닙니다

external-provisioner는 CSI 드라이버를 호출하고 결과를 PV로 등록하는 외부 구성요소입니다
이 글에서 확인한 [v6.4.0](https://github.com/kubernetes-csi/external-provisioner/tree/72f13ee46fb93c11a72ef91549e70158283c03af)의 기본 생성 이름은 `pvc-<PVC UID>` 형태입니다
다만 `--volume-name-prefix`·`--volume-name-uuid-length`로 형식이 달라질 수 있으므로 Kubernetes의 모든 동적 PV 이름에 대한 보장은 아닙니다

## WaitForFirstConsumer는 노드 선택과 볼륨 위치를 함께 봅니다

Immediate는 소비할 Pod의 배치 전에 볼륨을 선택·공급할 수 있습니다
특정 zone의 볼륨이 먼저 준비되면 이후 Pod는 그 위치 제약 안에서 노드를 찾아야 합니다

WaitForFirstConsumer(WFFC)는 소비할 Pod의 배치를 고려할 때까지 그 결정을 미룹니다
노드 자원·Pod 배치 조건·볼륨 위치가 함께 맞는지 스케줄러가 볼 수 있도록 순서를 정한 것입니다

PV 컨트롤러는 지연 바인딩 모드에서 아직 예약되지 않은 일반 PV를 바로 바인딩하지 않습니다
반면 그 PVC를 위해 이미 예약된 PV는 처리할 수 있습니다
WFFC의 모든 PVC가 반드시 새 볼륨 생성을 기다린다고 해석하면 이 예외를 놓칩니다

![WFFC에서 스케줄러의 캐시 예약과 PreBind API 쓰기, 외부 공급·PV 컨트롤러·스케줄러 관측의 분업|tall](/diagrams/k8s-theory-pvc-storageclass-binding-2.svg)

바인딩 쓰기와 관련된 주요 확장점은 다음과 같습니다
현재 VolumeBinding 플러그인의 모든 확장점 목록을 나열한 표는 아닙니다

| 확장점 | 이 흐름에서의 역할 |
|---|---|
| PreFilter | Pod의 PVC를 바인딩 여부 등으로 분류 |
| Filter | 노드별 PV 후보·nodeAffinity·공급 가능 조건 검사 |
| Reserve | 선택한 PV·PVC를 스케줄러 캐시에 가정 |
| PreBind | PV 예약 또는 PVC selected-node를 API에 쓰고 관측 조건 대기 |
| Unreserve | 가정한 캐시 상태 해제. 성공한 API 쓰기 전체의 rollback은 아님 |

기존 PV를 사용한다면 PreBind가 PV의 claimRef를 기록합니다
동적 생성이 필요하다면 PVC에 `volume.kubernetes.io/selected-node`로 노드 이름을 기록해 그 노드에서 사용할 볼륨 공급을 요청합니다
PV 컨트롤러는 PV·PVC 참조와 바인딩 완료 표시를 이어서 반영합니다

스케줄러는 이 결과를 기다리지만 관측 조건을 정확히 구분해야 합니다
v1.37.1 `BindPodVolumes`는 기본 600초 상한 안에서 1초 간격으로 **API 반영을 관측하는 캐시**를 확인합니다
매초 PV·PVC에 직접 GET 요청을 보내는 구조는 아닙니다

`isPVCFullyBound`의 조건은 `volumeName`이 있고 `pv.kubernetes.io/bind-completed` 어노테이션이 존재하는 것입니다
정적 예약의 claimRef UID·노드 적합성 등도 확인하지만, PVC의 마지막 `status.phase: Bound` 쓰기 자체를 직접 검사하는 것은 아닙니다
PV 컨트롤러의 전체 처리 순서와 스케줄러가 다음 단계로 진행하는 관측 조건은 이렇게 구분됩니다

이 구현은 [`bindAPIUpdate`·`checkBindings`·`isPVCFullyBound`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/volumebinding/binder.go#L515-L776)에 있습니다
완료 조건을 확인한 다음 Pod를 Node에 바인딩하는 단계로 진행합니다

### nodeName 직접 지정과 프로비저닝 실패

동적 WFFC 경로에서 Pod에 `nodeName`을 직접 지정하면 스케줄러를 건너뜁니다
selected-node를 적는 경로가 실행되지 않아 PVC가 Pending으로 남을 수 있습니다
노드 선택을 제한하면서 스케줄러를 거치려면 `kubernetes.io/hostname` 라벨 조건 같은 배치 제약을 사용할 수 있습니다

생성 실패가 모두 다른 노드 재선택으로 이어지는 것도 아닙니다
확인한 external-provisioner는 topology 지원·selected node·오류 유형을 함께 보고 재배치 가능 여부를 판단합니다
재배치 경로에서는 라이브러리가 selected-node를 제거하고, 스케줄러가 그 변화를 보고 다시 시도할 수 있게 합니다

또한 CSI capacity 검사는 `CSIDriver.spec.storageCapacity`로 옵트인한 드라이버의 정보를 사용합니다
스케줄러가 본 용량 정보가 낡을 수 있으므로 Filter 통과가 실제 CreateVolume 성공을 보장하지는 않습니다
Immediate 또는 capacity 미옵트인 경로의 생성 실패도 구분해야 합니다

## 접근 방식의 매칭과 실제 사용 제약은 다릅니다

| accessMode | 의미·주의할 범위 |
|---|---|
| RWO, ReadWriteOnce | 한 노드의 읽기·쓰기. 같은 노드의 여러 Pod가 사용할 수 있음 |
| ROX, ReadOnlyMany | 여러 노드의 읽기 전용 접근을 요청 |
| RWX, ReadWriteMany | 여러 노드의 읽기·쓰기 지원을 요청. 드라이버·저장소 지원 필요 |
| RWOP, ReadWriteOncePod | 한 Pod 사용 제약. 다른 accessMode와 함께 지정 불가 |

accessModes는 PV 매칭 조건이며, 마운트 뒤의 쓰기 보호를 이 필드만으로 강제하지 않습니다
이는 attach 단계의 노드 간 중복 연결 검사와도 다릅니다
RWO에서 Once가 뜻하는 단위는 Pod가 아니라 노드입니다

RWOP는 CSI 볼륨에서 지원하며, 스케줄러와 kubelet의 실제 사용 검사가 있습니다
스케줄러의 `VolumeRestrictions`가 다른 Pod의 사용을 확인한 실패는 `Unschedulable`이며, 점유 Pod가 없어지면 조건이 달라질 수 있습니다
반면 PV 후보 부족·nodeAffinity 불일치 같은 VolumeBinding Filter의 사유는 `UnschedulableAndUnresolvable`로 처리됩니다

RWX를 적었다고 모든 저장소가 다중 노드 쓰기를 지원하게 되지도 않습니다
CSI 경로는 선택한 RWX를 `MULTI_NODE_MULTI_WRITER`로 전달하지만 실제 지원과 동시 접근의 안전성은 드라이버·저장소·애플리케이션이 만족해야 합니다
CSI의 Block/Mount 접근 타입과 접근 모드는 별도이므로 raw block이면 RWX를 표현할 수 없다고 단정할 수도 없습니다

모드 의미는 [Persistent Volumes 공식 문서](https://kubernetes.io/docs/concepts/storage/persistent-volumes/#access-modes), 실제 변환은 [`asCSIAccessModeV1`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/csi_client.go#L518-L546)를 기준으로 확인했습니다

## Released는 다시 쓸 수 있다는 뜻이 아닙니다

PVC가 삭제돼도 PV는 이전 claimRef를 남길 수 있습니다
이전 PVC가 없거나 같은 이름의 PVC가 다른 UID로 교체됐다면 그 관계를 현재 PVC의 바인딩으로 볼 수 없습니다

| 주요 PV 상태 | 의미 |
|---|---|
| Available | 일반 바인딩 후보. 이름 예약이 있다면 그 PVC 외에는 가져갈 수 없음 |
| Bound | PVC와 연결됨 |
| Released | 이전 PVC가 해제됐지만 아직 재사용 가능한 상태는 아님 |
| Failed | 회수 처리 등의 실패 상태 |

API에는 초기 `Pending`도 정의돼 있습니다
PVC의 Pending·Bound·Lost와 PV의 상태를 서로 바꿔 읽어서도 안 됩니다
예를 들어 기존 Bound PVC가 가리키는 PV가 없어지면 PVC에 Lost가 기록되는 경로가 있습니다

Retain 정책이면 PV 컨트롤러는 Released 볼륨을 자동으로 초기화해 재사용시키지 않습니다
기존 claimRef와 Available이 아닌 상태 때문에 새 PVC의 일반 후보가 되지 않습니다
데이터를 정리하고 재사용 여부를 판단하는 일은 별도로 필요합니다

Delete 정책은 담당 구현에 실제 저장소 삭제를 요청하는 경로입니다
정책 선언만으로 즉시 삭제되거나 모든 저장소에서 같은 시간 안에 정리되는 것은 아닙니다
StorageClass가 새 PV에 적용하는 회수 정책은 Delete·Retain이며, PV의 과거 Recycle 정책은 deprecated입니다

삭제 보호 finalizer도 역할을 나눠야 합니다
사용 중인 PVC·PV의 삭제를 유예하는 `kubernetes.io/pvc-protection`·`kubernetes.io/pv-protection`과, 저장소 삭제가 끝나기 전에 PV가 사라지지 않게 하는 finalizer는 다른 장치입니다

확인한 external-provisioner v6.4.0은 삭제 보호 기능을 활성화하며, 담당 CSI PV 중 Delete 정책·Bound·삭제 시작 전 조건에 맞으면 `external-provisioner.volume.kubernetes.io/finalizer`를 추가하는 라이브러리 경로를 사용합니다
in-tree 동적 PV에는 `kubernetes.io/pv-controller` 경로가 있으며, CSI migration 여부에 따라 담당자가 달라집니다
현재 finalizer와 담당 컨트롤러의 삭제 결과를 함께 확인해야 합니다

이 구분은 [공식 PV 삭제 보호 설명](https://kubernetes.io/docs/concepts/storage/persistent-volumes/#persistentvolume-deletion-protection-finalizer)과 PV 컨트롤러의 `syncVolume`·`reclaimVolume`을 기준으로 합니다

## Pending은 어떤 결정이 남았는지 나눠 확인합니다

| 단서 | 확인할 경계 |
|---|---|
| FailedBinding, 적합 PV 없음·클래스 없음 | 용량·클래스·모드·속성 클래스·라벨·상태·기존 claimRef |
| ProvisioningFailed | 클래스 존재, provisioner 선택, 실제 공급 오류 메시지 |
| ExternalProvisioning | 외부 공급 진행·실패·처리자 상태. 이벤트만으로 처리자 부재 확정 불가 |
| WaitForFirstConsumer | 아직 소비 Pod의 배치 결정을 기다리는 정상 상태일 수 있음 |
| WaitForPodScheduled | Pod 배치 사유와 볼륨 사유를 구분. nodeName 우회 여부도 확인 |
| VolumeMismatch | 지목한 미예약 PV의 조건 검사 실패 이유 |
| 기본 클래스가 있는데도 지정되지 않음 | 명시적인 빈 문자열·옛 어노테이션·소급 처리 분기 |
| Released PV가 남아도 새 PVC와 연결되지 않음 | 이전 claimRef·회수 정책·재사용 준비 상태 |
| Pod에 볼륨 용량·nodeAffinity Filter 실패 | 후보·위치·capacity 정보와 실제 공급 상태 |

PVC 이벤트, PV·PVC 참조와 상태, Pod의 스케줄 실패 사유는 서로 다른 단계의 단서입니다
Bound를 마운트 완료로, UID가 있는 claimRef를 전체 쓰기 완료로, Filter 통과를 실제 저장소 생성 성공으로 확대하지 않고 읽어야 합니다
