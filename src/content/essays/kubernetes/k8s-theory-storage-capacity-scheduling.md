---
title: "용량 기반 스케줄링 — 아직 없는 볼륨의 크기를 무엇과 비교하나"
excerpt: "CSIStorageCapacity의 생성과 갱신, 스케줄러의 Filter·Score를 따라가며 정보 부재·검사 생략·공간 예약의 차이를 살펴봅니다"
category: kubernetes
tags: ["kubernetes", "CSI", "storage", "scheduling", "concept"]
series:
  name: "k8s-theory-storage"
  order: 7
date: "2026-10-23"
---

사용자는 필요한 저장소 크기를 PVC(PersistentVolumeClaim, 영속 볼륨 요청)에 적습니다
조건에 맞는 기존 PV(PersistentVolume, 영속 볼륨 오브젝트)가 없다면 새 볼륨을 만들어야 합니다

그 볼륨을 쓸 노드를 먼저 골랐는데 접근 가능한 저장소에 공간이 부족하면, 볼륨 생성 단계에서 실패할 수 있습니다
스케줄러는 저장소를 직접 측정하는 대신 CSI 드라이버 배포물이 기록한 `CSIStorageCapacity`를 읽어 후보 노드를 판단합니다

> Kubernetes v1.37.1 소스와 공식 문서 고정본을 대조한 개념 설명입니다
> 외부 구현은 external-provisioner v6.4.0을 별도로 확인했습니다. 실제 설치 버전·클러스터 실험·지연 측정 결과는 포함하지 않습니다

## 용량 검사는 새 볼륨을 만들어야 할 때 나옵니다

**VolumeBinding**은 스케줄러에서 Pod의 볼륨과 후보 노드의 조건을 검사하는 플러그인입니다
후보를 거르는 Filter 확장점에서 이미 있는 볼륨을 먼저 확인하고, 아직 만들어야 하는 볼륨의 용량을 살펴봅니다

| PVC의 경로 | 후보 노드에서 확인하는 것 | 새 볼륨의 용량 검사 |
|---|---|---|
| 이미 PV와 바인딩됨 | 해당 PV의 노드 접근 조건 | 적용하지 않음 |
| 미바인딩이며 사용할 기존 PV가 있음 | 요청 조건과 PV의 노드 접근 조건 | 적용하지 않음 |
| 늦은 바인딩에서 동적 생성 필요 | 프로비저닝 가능 여부·위치·용량 | 드라이버 참여 조건에 따라 적용 |

여기서 topology는 저장소에 접근할 수 있는 노드의 조건입니다
`WaitForFirstConsumer`(WFFC)는 그 볼륨을 사용할 Pod의 노드 후보를 고려할 때까지 바인딩·생성을 미루는 방식입니다

용량 기반 스케줄링은 이 WFFC 동적 프로비저닝 경로에 적용됩니다
`Immediate`에서는 Pod와 무관하게 볼륨이 먼저 만들어지며, CSI inline ephemeral volume도 이 용량 검사 대상이 아닙니다

이미 `volume.kubernetes.io/selected-node`가 기록된 WFFC PVC라면 선택된 노드와 일치하는지도 확인합니다
일치하지 않는 후보는 거절하고, 일치하면 동적 생성 후보로 처리하므로 매번 기존 PV 탐색부터 다시 시작하는 것은 아닙니다

동적 생성 경로에서도 용량을 가장 먼저 묻지는 않습니다
StorageClass의 프로비저너가 동적 생성을 지원하는지, `allowedTopologies`가 후보 노드와 맞는지를 먼저 확인합니다

접근할 수 없는 노드에서는 용량이 많아도 볼륨을 사용할 수 없기 때문입니다
다만 용량 오브젝트를 고르는 내부 비교 순서는 StorageClass 이름, 크기, `nodeTopology` 순서입니다. 모든 위치 검사가 모든 크기 검사보다 앞선다는 뜻은 아닙니다. [VolumeBinding의 분기](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/volumebinding/binder.go)

## 용량을 기록하는 주체는 드라이버 배포물입니다

`CSIStorageCapacity`는 한 StorageClass와 토폴로지 구간에 대한 CSI `GetCapacity` 응답을 담는 네임스페이스 오브젝트입니다
현재 사용하는 API는 `storage.k8s.io/v1`입니다
StorageClass는 볼륨을 공급할 드라이버와 생성 조건을 지정합니다

일반적인 CSI 배포에서는 external-provisioner가 드라이버에 `GetCapacity`를 호출하고 응답을 API 오브젝트에 기록합니다
스케줄러는 API 상태를 유지하는 informer 캐시로 그 정보를 읽습니다. 이 VolumeBinding 경로가 스케줄링 중 드라이버 RPC를 직접 호출하는 것은 아닙니다

![external-provisioner가 CSI 드라이버에 GetCapacity를 호출해 API에 용량을 기록하고 스케줄러가 그 오브젝트를 읽는 흐름|tall](/diagrams/k8s-theory-storage-capacity-scheduling-1.svg)

볼륨 **개수**를 제한하는 [CSINode의 `allocatable.count`](/essays/k8s-theory-volume-attachment-limits)와는 단위도 기록 주체도 다릅니다
그 값은 kubelet이 노드별 `NodeGetInfo` 응답에서 기록하지만, 여기서는 드라이버 배포물이 저장소의 가용 **바이트**를 기록합니다

핵심 필드는 다음 네 개입니다

| 필드 | 의미 | 변경 가능 여부 |
|---|---|---|
| `storageClassName` | 어느 StorageClass의 정보인지 지정 | 불변 |
| `nodeTopology` | 어느 노드가 저장소에 접근할 수 있는지 지정 | 불변 |
| `capacity` | 해당 조건으로 볼륨 생성에 사용할 수 있는 가용 바이트 | 변경 가능 |
| `maximumVolumeSize` | 같은 조건으로 생성할 수 있는 단일 볼륨의 최대 크기 | 변경 가능 |

앞의 두 필드가 조회 조건을, 뒤의 두 필드가 바뀌는 용량 값을 나타냅니다
조회 조건이 달라지면 같은 오브젝트의 좌표를 고치는 대신 새 오브젝트로 표현해야 합니다

이름은 용량이나 위치를 나타내지 않습니다
확인한 external-provisioner는 `csisc-` 접두어로 이름을 생성하지만 API가 그 접두어를 강제하지는 않습니다

같은 조건을 나타내는 오브젝트가 여러 개 있어도 Filter는 적합한 정보를 하나 찾으면 통과합니다
여러 오브젝트의 용량을 더해 하나의 큰 저장소로 취급하거나 이름으로 공간을 예약하는 방식은 아닙니다. [CSIStorageCapacity 타입과 필드 의미](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/storage/v1/types.go)

## 정보가 없는 경우와 검사에 참여하지 않는 경우는 다릅니다

`CSIDriver.spec.storageCapacity: true`는 해당 드라이버가 보고하는 용량을 스케줄링에 반영하도록 선택하는 필드입니다
API 기본값은 `false`이며 현재는 나중에 변경할 수 있습니다

이 선언이 없을 때와 선언한 뒤 정보가 없을 때의 결과가 다릅니다

| 용량 검사를 생략하는 조건 | 현재 처리 |
|---|---|
| PVC의 storage 요청 크기가 없음 | 비교할 요청량이 없어 용량 검사 생략 |
| 프로비저너 이름으로 조회한 CSIDriver가 `NotFound` | 이 검사에 참여하는 선언을 찾지 못해 생략 |
| `CSIDriver.spec.storageCapacity`가 nil 또는 false | 드라이버가 용량 검사에 참여하지 않아 생략 |

CSIDriver 조회의 다른 오류는 실패로 전파합니다
`NotFound` 분기는 그 드라이버가 실제 CSI 구현인지 판별하는 검사가 아니며, 이 용량 검사를 통과시킨다고 다른 Filter나 최종 배치까지 성공하는 것은 아닙니다

반대로 참여를 선언했다면 StorageClass·크기·접근 조건을 만족하는 용량 정보를 찾아야 합니다
적합한 오브젝트가 하나도 없으면 후보 노드를 거절합니다

![VolumeBinding이 용량 검사 적용 여부를 먼저 나누고 적용 시 일치하는 정보가 없으면 노드를 제외하는 흐름|tall](/diagrams/k8s-theory-storage-capacity-scheduling-2.svg)

`storageCapacity: true`로 배포했는데 정보를 아직 올리지 않았다면, 새 동적 볼륨을 기다리는 Pod의 후보가 사라질 수 있습니다
실제 공간이 없을 때와 정보를 아직 보고하지 않았을 때가 같은 용량 부족 사유로 나타날 수 있습니다

드라이버가 참여하지 않은 경우까지 막으면 용량 추적을 사용하지 않는 경로도 멈춥니다
참여했는데 정보가 없는 경우를 통과시키면 정보가 준비되지 않은 상태와 충분한 상태를 구별할 수 없습니다
이 차이는 기능 미참여와 정보 미보고를 구분하는 것으로 해석할 수 있습니다

## Filter는 단일 볼륨 한도를 우선 비교합니다

용량 오브젝트를 찾을 때는 세 조건이 함께 맞아야 합니다

1. `storageClassName`이 PVC의 StorageClass와 같아야 합니다
2. 비교에 사용할 한도가 PVC 요청량 이상이어야 합니다
3. `nodeTopology`가 후보 노드의 라벨과 맞아야 합니다

크기 비교에서는 `maximumVolumeSize`가 있으면 그것을 먼저 사용합니다
없으면 `capacity`를 사용하며 둘 다 없으면 충분하지 않다고 판단합니다

전체 가용량이 커도 단일 볼륨으로 내줄 수 있는 크기는 더 작을 수 있습니다
PVC가 요청하는 것도 볼륨 하나의 크기이므로 단일 볼륨 한도를 먼저 비교합니다

아래는 **이 Filter의 크기 판정**입니다
다른 Filter·점수 단계·실제 생성의 성공을 함께 나타내는 표는 아닙니다

| 보고된 값 | Filter에서 비교하는 값 |
|---|---|
| `maximumVolumeSize` 설정 | 해당 값과 PVC 요청량 비교 |
| `maximumVolumeSize` 미설정, `capacity` 설정 | `capacity`와 PVC 요청량 비교 |
| 두 값 모두 미설정 | 용량 부족으로 판단 |
| `capacity`가 0·미설정이어도 충분한 `maximumVolumeSize`가 있음 | 단일 볼륨 한도 비교는 통과 가능 |

따라서 항상 두 숫자를 동시에 확인해 작은 쪽을 고르는 검사라고 설명하면 안 됩니다
현재 구현의 `volumeLimit`은 우선순위를 정해 한 값을 고릅니다

접근 조건에서도 생략과 빈 값이 다릅니다
`nodeTopology`를 생략한 nil은 어느 노드에서도 접근할 수 없다는 뜻이고, `nodeTopology: {}`는 모든 노드와 일치하는 빈 셀렉터입니다

`nodeHasAccess`는 nil을 먼저 거절합니다
공용 `LabelSelectorAsSelector`도 nil을 `Nothing`, 빈 셀렉터를 `Everything`으로 변환합니다
필드가 비어 보인다는 이유로 두 상태를 같게 처리할 수 없습니다

## v1.37에서는 용량 점수도 기본으로 사용합니다

용량 추적 API는 v1.24에서 stable이 됐습니다
이 기능을 켜는 오래된 `CSIStorageCapacity` 게이트와, 후보 노드에 점수를 주는 `StorageCapacityScoring` 게이트를 구분해야 합니다

확인한 v1.37.1 registry에는 `CSIStorageCapacity` 게이트가 없고, `StorageCapacityScoring`은 beta·기본 활성입니다
현재 기본 설정을 v1.35의 alpha·기본 비활성 조건과 같은 것으로 설명하면 점수 단계를 빠뜨리게 됩니다

Filter는 노드 후보가 조건에 맞는지 거릅니다
PreScore·Score는 남은 후보에서 스토리지 점수를 계산합니다. 기본 점수 곡선은 요청량/용량 비율이 낮을수록 높은 점수를 줍니다

아래의 정적 바인딩은 이번 사이클에서 미바인딩 PVC에 기존 PV를 골라 연결하는 경로입니다
이미 Bound인 모든 PVC를 이 점수에 다시 포함한다는 뜻은 아닙니다

| 현재 Score 경로 | 요청량과 용량의 입력 |
|---|---|
| 해당 후보에 정적 PV 바인딩이 하나라도 있음 | StorageClass별 선택 PV의 요청량·용량을 합산 |
| 정적 바인딩이 없고 동적 생성만 있음 | StorageClass별 PVC 요청량을 합산하고 선택한 용량 정보의 `capacity` 사용 |

정적 바인딩이 섞인 경우 현재 Score는 정적 분기를 우선합니다
이 구현이 그 후보의 정적·동적 용량 점수를 모두 합친다고 해석하면 안 됩니다

동적 분기의 `capacity`는 같은 StorageClass에 PVC가 여러 개 있어도 중복해서 더하지 않습니다
Filter에서 반환한 `NodeCapacity`가 없는 PVC도 이 동적 용량 점수의 입력에서 제외합니다

Filter가 단일 볼륨 한도인 `maximumVolumeSize`를 먼저 보는 것과 달리 동적 Score는 `capacity`를 사용합니다
확인한 external-provisioner v6.4.0은 용량 응답에서 이 `capacity`를 항상 수치로 채워 오브젝트를 생성·갱신합니다

점수 함수는 클래스별 요청량/용량 비율을 설정된 곡선에 대입하고 클래스 점수의 평균을 냅니다
현재 기본 곡선은 비율 0%에서 최고점, 100%에서 0점입니다

0 용량이거나 합산 요청량이 용량을 초과해도 점수 입력을 100%로 처리합니다
이 Score가 별도의 Filter 거절을 내리는 것은 아닙니다

`StorageCapacityScoring`을 끄더라도 드라이버의 용량 추적 참여 선언까지 꺼지는 것은 아닙니다
`CSIDriver.spec.storageCapacity`에 따른 Filter 적용과 용량 점수 활성은 서로 다른 조건입니다. [현재 Score 분기](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/volumebinding/volume_binding.go), [점수 함수](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/volumebinding/scorer.go)

## 보고 주기와 정리는 external-provisioner 설정에 달려 있습니다

external-provisioner v6.4.0에서 확인한 설정은 다음과 같습니다
Kubernetes 코어의 기본값이나 사용 중인 클러스터의 설치 상태를 뜻하지 않습니다

| 설정 | 확인한 기본값·역할 |
|---|---|
| `--enable-capacity` | false, 용량 오브젝트 생산 활성화 |
| `--capacity-poll-interval` | 1분, 변경된 저장소 용량을 주기적으로 다시 조회 |
| `--capacity-for-immediate-binding` | false, Immediate 클래스 정보도 생산할지 선택 |
| `--capacity-ownerref-level` | 1, 배포 Pod에서 소유 관계를 몇 단계 올라가 용량 오브젝트의 owner로 삼을지 선택 |

`--capacity-for-immediate-binding`을 켜서 정보를 생산해도 스케줄러가 Immediate 볼륨에 이 WFFC 검사를 적용하는 것으로 바뀌지는 않습니다
정보를 생산하는 범위와 스케줄러가 사용하는 범위는 별개입니다

중앙 컨트롤러 방식은 CSINode의 해당 드라이버 `topologyKeys`와 Node 라벨에서 토폴로지 구간을 모읍니다
드라이버가 등록되지 않은 노드는 제외하고, 선언한 키의 Node 라벨이 아직 없다면 다음 상태 반영을 기다립니다

용량 컨트롤러는 StorageClass 파라미터와 토폴로지를 `GetCapacity` 요청에 넣습니다
주기 조회 외에도 StorageClass·토폴로지 변경과 용량 변경 예상 시점에 작업을 큐에 넣으므로, 1분을 정보의 최대 지연 보장으로 볼 수는 없습니다

생성 위치는 `NAMESPACE` 환경변수로 정합니다
owner를 사용하는 기본 설정에서는 `POD_NAME`도 필요합니다
`--capacity-ownerref-level`은 0이면 Pod 자신, 1이면 바로 위의 관리 오브젝트, 2이면 그 위의 관리 오브젝트를 선택합니다

예를 들어 Deployment 아래의 Pod는 보통 ReplicaSet을 거치므로 Deployment를 owner로 삼으려면 두 단계를 올라갑니다
`-1`로 owner 사용을 끌 수도 있지만, 이 경우 드라이버 제거 뒤 남는 용량 오브젝트의 정리 책임을 따로 둬야 합니다

StorageClass나 토폴로지 구간이 없어지면 용량 컨트롤러도 불필요한 오브젝트를 정리합니다
이 소유 참조는 **용량 정보의 수명**을 위한 것이며 [StatefulSet PVC 보존 정책](/essays/k8s-theory-statefulset-volume-lifecycle)이나 실제 볼륨의 소유권을 뜻하지 않습니다

설정·생성·owner 처리 근거는 [현재 external-provisioner 명령 옵션](https://github.com/kubernetes-csi/external-provisioner/blob/72f13ee46fb93c11a72ef91549e70158283c03af/cmd/csi-provisioner/csi-provisioner.go)과 [용량 컨트롤러](https://github.com/kubernetes-csi/external-provisioner/blob/72f13ee46fb93c11a72ef91549e70158283c03af/pkg/capacity/capacity.go)입니다

## 후보 노드 선택은 공간 예약이 아닙니다

용량 검사는 `CSIStorageCapacity`의 값을 차감하거나 실제 저장소 공간을 예약하지 않습니다
Reserve 확장점에서 PV·PVC의 선택을 스케줄러 캐시에 가정해 두는 일과 백엔드 공간을 확보하는 일은 다릅니다

WFFC 동적 생성에서는 선택한 노드가 PVC의 `volume.kubernetes.io/selected-node` 힌트로 전달됩니다
PreBind는 이 선택을 API에 반영하고 볼륨 바인딩 완료를 기다립니다. 볼륨 생성이 시작될 때 이미 Pod의 최종 노드 바인딩까지 끝났다고 단정하면 안 됩니다

그 사이 다른 요청이 공간을 사용하거나 조회 정보가 낡았다면 Filter를 통과했어도 생성에 실패할 수 있습니다
external-provisioner v6.4.0은 topology 지원과 선택 노드가 있는지를 확인합니다
이 조건에서 `CreateVolume`의 `ResourceExhausted`를 받으면 `ProvisioningReschedule`로 넘길 수 있습니다

연결된 프로비저닝 라이브러리가 선택 노드 힌트를 해제하면 스케줄러가 다시 후보를 찾습니다
모든 오류가 이 재선택을 뜻하지는 않습니다. 예를 들어 `DeadlineExceeded`는 이전 생성 작업이 진행 중일 가능성을 고려하는 다른 오류 경로입니다

한 Pod에 볼륨이 여러 개일 때는 먼저 만든 볼륨이 용량을 차지한 뒤 다음 볼륨을 만들지 못할 수도 있습니다
Filter는 각 PVC를 저장된 용량과 비교하므로 전체 요청을 한 번에 예약하지 않으며, Score에서 요청량을 합산해도 이 문제가 예약으로 해결되지는 않습니다

가용량이나 접근 조건이 달라지지 않으면 재시도만으로 풀리지 않을 수 있습니다
공식 문서도 용량을 늘리거나 이미 생성된 볼륨을 정리하는 등 운영자의 개입이 필요한 경우로 설명합니다. [공식 용량 추적의 한계](https://kubernetes.io/docs/concepts/storage/storage-capacity/#limitations)

## Pending 사유에서 다음 확인으로 이어갑니다

| 관찰한 상태 | 확인할 대상 |
|---|---|
| `node(s) did not have enough free storage` | 해당 StorageClass의 용량 오브젝트 존재, 선택 한도, 노드 접근 셀렉터 |
| 용량 추적을 켠 뒤 WFFC Pod가 Pending | producer 활성·권한·GetCapacity 오류·정보 게시 여부 |
| `storageCapacity`를 바꿔도 달라지지 않음 | Bound·기존 PV 사용·Immediate·inline ephemeral 여부와 검사 참여 조건 |
| 특정 노드만 용량 사유로 제외됨 | Node 라벨과 `nodeTopology`, 클래스의 `allowedTopologies` |
| Filter 통과 뒤 생성 실패 | 갱신 시차·다른 요청의 경쟁·드라이버 오류와 재선택 조건 |
| 볼륨 일부만 생성되고 계속 대기 | 먼저 만든 볼륨의 위치·소모 용량과 남은 요청을 함께 확인 |

용량 부족 문자열 하나로 실제 저장소가 꽉 찼다고 단정할 수는 없습니다
정보를 보고하기로 했는지, 사용할 정보가 있는지, 그 정보가 어떤 단계에서 쓰였는지를 나눠 확인해야 합니다

## 확인한 근거

- [공식 Storage Capacity 문서 고정본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/storage/storage-capacity.md): WFFC 적용 범위·잠정 노드 선택·다중 볼륨 한계
- [StorageCapacityScoring의 현재 단계](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go): v1.37 beta·기본 활성
- [VolumeBinding의 기본 점수 곡선](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/apis/config/v1/defaults.go): `SetDefaults_VolumeBindingArgs`
- [external-provisioner v6.4.0 고정본](https://github.com/kubernetes-csi/external-provisioner/tree/72f13ee46fb93c11a72ef91549e70158283c03af): 생산 주체·현재 옵션·갱신·재선택 조건
