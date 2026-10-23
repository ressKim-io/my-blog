---
title: "CSI 구조 — sidecar의 Controller 호출과 kubelet의 Node 호출"
excerpt: "CSI 규격과 Kubernetes 어댑터, 외부 sidecar의 책임을 나눕니다. 두 등록 소켓과 CSINode 기록, CSIDriver의 설정, VolumeAttachment의 의도·결과를 따라가며 capability·inline·migration의 경계도 구분합니다"
category: "kubernetes"
tags: ["Kubernetes", "CSI", "Storage", "Kubelet", "Sidecar", "concept"]
series:
  name: "k8s-theory-storage"
  order: 2
date: "2026-10-23"
---

스토리지 드라이버가 볼륨 생성과 노드의 사용 경로 준비를 모두 구현하더라도, 두 작업을 같은 프로그램이 부르는 것은 아닙니다
Kubernetes에서 클러스터 쪽 호출자는 외부 controller이고 노드 쪽 호출자는 kubelet입니다

[PVC 바인딩과 StorageClass](/essays/k8s-theory-pvc-storageclass-binding)에서 볼륨을 공급하고 PV·PVC를 연결하는 주체를 구분했습니다
이제 그 주체가 실제 드라이버에 요청하는 경계를 살펴봅니다

**CSI(Container Storage Interface)**는 이 호출을 드라이버에 전달하는 RPC 계약입니다
RPC는 다른 프로그램에 작업을 요청하고 응답을 받는 호출이며, CSI는 gRPC로 서비스와 요청·응답을 정의합니다
Kubernetes 오브젝트를 읽는 코드와 실제 스토리지 작업을 하는 드라이버를 그 계약으로 연결합니다

> **근거**: Kubernetes v1.37.1 고정 소스와 공식 CSI 문서를 바탕으로 설명합니다
> Kubernetes ref: `f78e722310e50bcaca9276be22276d9e91d91308`, 공식 문서 저장본: `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 코어의 CSI 의존 commit, 외부 spec v1.13.0과 각 sidecar 릴리스는 구분해 대조했습니다
> 아래 소켓 배치는 Linux의 일반적인 구성입니다. 실제 드라이버 설치·등록·볼륨 준비를 재현한 기록은 포함하지 않습니다

## 두 호출 경로는 서로 다른 일을 시작합니다

동적 프로비저닝에서는 PVC·StorageClass를 본 외부 provisioner가 드라이버에 볼륨 생성을 요청합니다
노드에 배치된 Pod의 볼륨을 준비할 때는 kubelet의 CSI 어댑터가 같은 노드의 드라이버에 요청합니다

![PVC·VolumeAttachment를 보는 클러스터 sidecar의 Controller RPC와 Pod를 준비하는 kubelet의 Node RPC를 나눈 두 호출 경로|tall](/diagrams/k8s-theory-csi-architecture-1.svg)

그림의 왼쪽 sidecar가 오른쪽 kubelet을 순서대로 호출하는 것은 아닙니다
각 주체가 Kubernetes 상태와 자기 역할에 맞춰 드라이버를 부릅니다
attach가 필요한 경우에는 그 사이의 의도와 결과를 VolumeAttachment로 전달합니다

Kubernetes 안에도 **in-tree CSI 플러그인**은 남아 있습니다
이는 벤더의 스토리지 구현 자체가 아니라 외부 CSI 드라이버를 연결하는 코어 어댑터입니다
in-tree 어댑터와 out-of-tree 드라이버를 같은 플러그인 코드로 취급하면 호출 책임이 흐려집니다

### 릴리스와 권한을 함께 나누려는 구조입니다

[초기 CSI 설계 문서](https://github.com/kubernetes/design-proposals-archive/blob/acc25e14ca83dfda4f66d8cb1f1b491f26e78ffe/storage/container-storage-interface.md)는 당시 in-tree 볼륨 구현의 문제를 설명합니다
벤더의 개발이 Kubernetes 릴리스에 묶이고, 코어 커뮤니티가 여러 구현의 테스트·유지보수를 맡으며, 플러그인 버그가 코어 프로세스에 영향을 줄 수 있다는 문제입니다

같은 프로세스의 권한을 플러그인이 그대로 사용한다는 점과 바이너리만 배포하기 어려운 점도 들고 있습니다
외부 드라이버와 공통 sidecar를 나누면 벤더의 스토리지 코드와 Kubernetes API 연결 코드를 별도 이미지·릴리스로 관리할 수 있습니다
그렇다고 노드 드라이버의 호스트 접근 권한까지 자동으로 사라지는 것은 아닙니다

FlexVolume도 실행 파일로 드라이버를 외부화했지만 호스트에 파일과 mount·파일시스템 도구를 준비해야 했습니다
CSI의 서비스·컨테이너 배치는 이런 의존성을 드라이버 배포에 묶는 데 도움이 됩니다
과거 설계 문서의 FlexVolume 공존 설명과 별개로 [현재 Volumes 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/storage/volumes.md)는 FlexVolume을 deprecated로 분류합니다

## 규격의 선언과 코어의 호출 범위를 나눕니다

Kubernetes v1.37.1의 [`go.mod`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/go.mod)는 CSI spec을 `v1.12.1-0.20260720052920-cd9e7ad1ae09`로 고정합니다
이는 외부 spec의 최신 릴리스 v1.13.0과 다른 버전 표기입니다

코어가 vendor한 [`csi_grpc.pb.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/vendor/github.com/container-storage-interface/spec/lib/go/csi/csi_grpc.pb.go)의 서비스 선언은 다음과 같습니다
실험 서비스까지 포함한 선언 수이며 드라이버의 필수 구현 수나 Kubernetes의 활성 기능 수는 아닙니다

| 서비스 | 선언된 RPC 수 | 역할 |
|---|---:|---|
| Identity | 3 | 드라이버 이름·capability·생존 상태 조회 |
| Controller | 17 | 생성·삭제·attach·확장·스냅샷 등 |
| GroupController | 4 | 볼륨 그룹 스냅샷 관련 작업 |
| SnapshotMetadata | 2 | alpha 서비스의 스냅샷 메타데이터 조회 |
| Node | 10 | 노드의 사용 경로 준비·해제·정보·건강 조회 |

합계는 5서비스·36 RPC입니다
SnapshotMetadata는 고정 [`csi.proto`](https://github.com/container-storage-interface/spec/blob/cd9e7ad1ae0915cabcad179f2b8a660c0cb6eb9f/csi.proto)에서 `alpha_service`로 표시돼 있습니다
다른 서비스에도 실험 메서드가 있으므로 선언이 있다는 이유만으로 모든 기능을 사용한다고 판단하면 안 됩니다

코어의 [`csi_client.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/csi_client.go)는 `NewNodeClient`를 만들고 Node 서비스의 요청을 구현합니다
여기에는 stage·publish·해제·확장·통계·capability·노드 정보와 건강 조회가 포함됩니다
Controller 작업은 이 어댑터가 직접 요청하는 대신 외부 호출자가 Kubernetes 오브젝트를 통해 이어받습니다

## sidecar는 오브젝트와 CSI 호출을 연결합니다

[공식 sidecar 문서](https://github.com/kubernetes-csi/docs/blob/67fe654a3246ad5c5cd212a0f4859706f9970353/book/src/sidecar-containers.md)는 공통 컨테이너 사용을 선택 사항으로 설명합니다
벤더가 같은 오브젝트 규약과 CSI 계약을 따르는 controller를 직접 구현할 수도 있습니다
sidecar 자체가 CSI 서비스 계약인 것은 아닙니다

| 주체 | 주로 연결하는 상태·호출 |
|---|---|
| external-provisioner | PVC·StorageClass와 `CreateVolume`·`DeleteVolume`, PV 기록 |
| external-attacher | VolumeAttachment와 `ControllerPublishVolume`·`ControllerUnpublishVolume` |
| external-resizer | PVC 크기 요청과 `ControllerExpandVolume` |
| external-snapshotter | VolumeSnapshotContent 등 스냅샷 리소스와 `CreateSnapshot` 등 |
| node-driver-registrar | CSI `GetPluginInfo`로 이름 조회 후 kubelet의 등록 프로토콜 제공 |
| livenessprobe | CSI `Probe` 결과를 HTTP health endpoint로 제공 |

앞의 controller sidecar들은 보통 API 상태를 관찰하고 CSI를 호출한 뒤 API에 결과를 반영합니다
registrar와 livenessprobe는 같은 종류의 API watcher가 아닙니다
registrar의 `GetInfo`도 CSI Identity의 `GetPluginInfo`와는 다른 등록 프로토콜 호출입니다

확인한 controller 릴리스는 provisioner v6.4.0, attacher v4.13.0, resizer v2.3.0, snapshotter v8.7.0입니다
등록·생존 확인은 registrar v2.18.0과 livenessprobe v2.20.0을 대조했습니다
각 릴리스의 go.mod는 CSI spec v1.13.0을 직접 또는 간접 의존합니다
이 의존 버전과 개별 드라이버의 capability·Kubernetes 지원 범위·실제 설치 버전은 별도입니다

### 일반 배치에서는 소켓과 권한도 갈립니다

[배포 문서](https://github.com/kubernetes-csi/docs/blob/67fe654a3246ad5c5cd212a0f4859706f9970353/book/src/deploying.md)의 controller 구성은 보통 Deployment나 StatefulSet입니다
sidecar와 드라이버는 `emptyDir`로 UNIX 소켓을 공유하며, controller가 호스트 파일시스템에 직접 접근할 필요는 일반적으로 적습니다
여러 복제본을 실행할 때는 해당 controller의 leader election 설정을 확인해야 합니다

node 구성은 보통 각 노드의 DaemonSet입니다
kubelet이 접속할 소켓과 mount 경로를 hostPath로 공유합니다
컨테이너에서 만든 mount를 호스트에 전달하는 구성에는 `mountPropagation: Bidirectional` 같은 전파 설정이 필요합니다

controller sidecar의 API RBAC과 node 드라이버의 호스트·mount 권한은 서로 다른 요구입니다
같은 Pod로 배치했다는 이유만으로 모든 컨테이너가 같은 호스트 권한을 필요로 하는 것은 아닙니다
실제 권한과 소켓·mount 구성은 드라이버 배포 방식에 맞춰 확인해야 합니다

## 등록용 소켓과 CSI 호출용 소켓은 다른 서버입니다

노드의 일반적인 경로는 다음과 같습니다

| 소켓 | 누가 여는가·용도 |
|---|---|
| `/var/lib/kubelet/plugins_registry/<driver>-reg.sock` | registrar가 열며 kubelet의 등록 `GetInfo` 등을 처리 |
| `/var/lib/kubelet/plugins/<driver>/csi.sock` | 드라이버가 열며 실제 CSI Identity·Node 요청 처리 |

경로는 배포 예시입니다
중요한 것은 kubelet이 등록 소켓에서 받은 **CSI endpoint**로 이후 요청을 보낸다는 관계입니다
컨테이너 내부의 `/csi/csi.sock`과 호스트 경로가 같은 문자열일 필요도 없습니다

![registrar가 CSI GetPluginInfo로 이름을 조회하고 등록 소켓을 연 뒤 kubelet이 GetInfo·NodeGetInfo를 통해 Node와 CSINode를 갱신하는 흐름|tall](/diagrams/k8s-theory-csi-architecture-2.svg)

현재 [registrar의 main](https://github.com/kubernetes-csi/node-driver-registrar/blob/6f4e96f4222783370e4d2f3e3fc733b49c194a5f/cmd/csi-node-driver-registrar/main.go)은 먼저 드라이버 소켓으로 이름을 조회합니다
그 뒤 [nodeRegister](https://github.com/kubernetes-csi/node-driver-registrar/blob/6f4e96f4222783370e4d2f3e3fc733b49c194a5f/cmd/csi-node-driver-registrar/node_register.go)가 등록용 gRPC 서버를 엽니다
kubelet이 디렉터리에서 이 소켓을 발견하고 registrar에 `GetInfo`를 호출합니다

registrar의 `--csi-address`는 컨테이너 안에서 이름 조회에 사용할 CSI 소켓입니다
`--kubelet-registration-path`는 kubelet에 돌려줄 호스트의 **CSI 드라이버 소켓 경로**입니다
두 번째 값을 등록용 `-reg.sock` 경로로 쓰는 것이 아닙니다

kubelet의 등록 처리기는 이름·지원 버전 등을 검증하고 드라이버 endpoint를 기억합니다
이어 실제 CSI 소켓에 `NodeGetInfo`를 호출해 nodeID·노드의 볼륨 상한·접근 가능한 topology를 받습니다
이 결과를 [`InstallCSIDriver`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/nodeinfomanager/nodeinfomanager.go)가 Node와 CSINode에 기록합니다

topology의 **값**은 Node 라벨로, **키**는 CSINode의 `topologyKeys`로 전달됩니다
nodeID와 보고된 상한 정보도 CSINode에 반영됩니다
CSINode를 쓰는 주체는 registrar나 드라이버가 아니라 kubelet입니다

`NodeGetInfo`나 API 반영이 실패하면 등록 처리기는 등록 해제를 시도하고 오류를 반환합니다
정리 중 오류도 발생할 수 있으며 로컬 등록 상태·Node·CSINode의 변경 전체가 하나의 원자적 트랜잭션인 것은 아닙니다
등록 소켓의 존재만으로 CSINode 반영과 모든 볼륨 호출의 성공까지 판단하면 안 됩니다

## Kubernetes 오브젝트는 서로 다른 경계를 기록합니다

### CSIDriver는 코어가 작업 전에 알아야 할 설정입니다

CSIDriver는 클러스터 범위의 드라이버 설정입니다
주요 필드와 현재 [`SetDefaults_CSIDriver`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/storage/v1/defaults.go)의 기본값은 다음과 같습니다

| 필드 | 기본값·역할 |
|---|---|
| `attachRequired` | true, 코어의 attach 의도·확인 단계를 사용할지 결정 |
| `podInfoOnMount` | false, NodePublishVolume의 VolumeContext에 Pod 정보를 넘길지 결정 |
| `storageCapacity` | false, 보고된 용량 정보를 스케줄링에 반영하도록 선택 |
| `volumeLifecycleModes` | `[Persistent]`, 지원할 persistent·CSI inline ephemeral 사용 방식 |

`attachRequired: false`는 Kubernetes가 attach 단계를 생략하도록 하는 설정입니다
CSI Controller capability를 조회해 자동으로 채워지는 값과는 다릅니다
드라이버 동작과 배포 설정이 맞아야 하며 CSIDriver가 없다고 attach 생략으로 처리하지도 않습니다

현재 [`skipAttach`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/csi_plugin.go)는 CSIDriver NotFound이면 attach를 생략하지 않습니다
그 외 조회 오류는 반환합니다
storageCapacity를 켜는 것도 용량 보고 오브젝트를 자동으로 만드는 동작과 구분해야 합니다

### CSINode는 노드 식별자의 대응을 기록합니다

CSINode는 노드 이름으로 존재하고 그 노드에 등록된 드라이버 정보를 담습니다
`spec.drivers[].nodeID`는 스토리지 시스템에서 사용하는 노드 식별자이므로 Kubernetes Node 이름과 다를 수 있습니다

kubelet이 NodeGetInfo로 받은 이 값을 API에 기록하면 다른 노드에서 동작하는 external-attacher도 사용할 수 있습니다
PV의 `spec.csi.volumeHandle`도 같은 역할을 합니다
이는 스토리지 볼륨의 식별자이며 후속 CSI 요청의 `volume_id`로 전달됩니다

두 식별자는 Kubernetes 오브젝트 이름을 스토리지 이름으로 추정하지 않도록 하는 대응 정보입니다
등록 성공과 볼륨 attach 완료가 다른 상태라는 점도 이 구분에서 드러납니다

### VolumeAttachment는 코어의 의도와 외부 작업 결과를 잇습니다

일반적인 persistent CSI attach에서는 코어의 attach/detach controller 경로가 VolumeAttachment를 만듭니다
[`csiAttacher.Attach`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/csi_attacher.go)는 kubelet에서 이 attach 생성 경로를 호출하면 `attaching volumes from the kubelet is not supported` 오류를 반환합니다

`spec`에는 드라이버·노드·볼륨 참조가 들어갑니다
external-attacher는 이 의도를 보고 ControllerPublishVolume 등을 호출합니다
그 결과를 `status.attached`·`attachmentMetadata`·`attachError` 등에 반영합니다
코어가 드라이버 소켓을 원격으로 직접 찾아 호출하는 대신 API 오브젝트가 두 주체 사이를 잇습니다

이름은 현재 `csi-` 뒤에 `sha256(volumeHandle + driverName + nodeName)`의 16진 표현을 붙여 만듭니다
해시 이름에서 노드·볼륨 문자열을 찾아 관계를 추정하기보다 `spec.nodeName`과 `spec.source`를 확인해야 합니다

VolumeAttachment가 없다는 것만으로 external-attacher가 실패했다고 판단할 수는 없습니다
attach 생략 설정이나 볼륨 사용 방식에 따라 이 오브젝트가 필요하지 않을 수 있습니다

## capability와 inline·migration 조건이 호출을 바꿉니다

RPC 구현이 있다는 사실과 실제 호출 조건은 다릅니다
예를 들어 노드가 `STAGE_UNSTAGE_VOLUME` capability를 보고하지 않으면 kubelet은 stage 단계를 생략합니다
attach 생략과 stage 생략은 서로 다른 결정입니다

[`CanAttach`·`CanDeviceMount`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/csi_plugin.go)는 CSI inline ephemeral 볼륨에 persistent attach·device-mount 단계를 적용하지 않습니다
Pod의 `volumes[].csi`로 지정하는 이 방식은 해당 드라이버의 `Ephemeral` lifecycle 지원이 필요합니다
현재 mounter는 CSIDriver가 없는 경우 persistent 사용은 허용할 수 있지만 ephemeral 사용은 허용하지 않습니다

**generic ephemeral**은 이 CSI inline 방식과 다릅니다
Pod를 위해 PVC를 만들고 일반 프로비저닝·바인딩 경로를 사용합니다
[공식 ephemeral volumes 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/storage/ephemeral-volumes.md)가 두 경로를 구분합니다

또 하나의 inline은 **CSI migration**에서 나옵니다
기존 in-tree 볼륨 표현을 CSI spec으로 변환하는 경로에서는 VolumeAttachment의 `source.inlineVolumeSpec`를 사용할 수 있습니다
이는 앞의 CSI inline ephemeral과 같은 뜻이 아닙니다

현재 [`csimigration`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csimigration/plugin_manager.go)은 지원하는 in-tree 표현을 CSI 표현으로 옮깁니다
설정을 자동으로 새 CSI 드라이버 배포로 바꾸거나 드라이버 설치 자체를 대신하는 기능은 아닙니다
실제 CSI 드라이버와 필요한 외부 controller가 준비돼 있어야 합니다

[CNI 계약](/essays/k8s-theory-cni-contract)과 비교할 때도 범위를 구분해야 합니다
CNI의 실행 파일 진입점이 daemon·controller·상태 저장소의 부재를 뜻하지 않듯, CSI의 서비스 계약도 모든 드라이버의 동일한 배치를 강제하지 않습니다
CSI는 볼륨 생성·노드 연결과 노드의 사용 경로 준비를 서로 다른 서비스 호출로 드러낸다는 차이가 있습니다

## 실패 위치는 오브젝트와 호출 주체를 함께 봅니다

다음은 재현한 장애가 아니라 설정·API 상태에 따른 확인 기준입니다

| 상태 | 구분할 책임·근거 |
|---|---|
| PVC가 Pending이고 외부 provisioning을 기다림 | StorageClass의 드라이버 이름·지연 바인딩 조건·provisioner 처리 여부 |
| 생성 요청 뒤 진행이 멈춤 | provisioner와 드라이버의 CreateVolume 결과, PV 반영 상태 |
| PV는 있지만 VolumeAttachment는 없음 | attachRequired·inline 사용 방식·코어의 attach 의도 생성 여부 |
| VolumeAttachment의 attached가 false | 외부 attach 진행·실패·status.attachError, sidecar·드라이버 상태 |
| CSINode에 드라이버 항목이 없음 | registrar의 이름 조회·등록 소켓, kubelet의 NodeGetInfo·API 반영 |
| 등록 후 Node 호출이 실패 | 실제 CSI endpoint 접근, 드라이버 capability와 Node RPC 오류 |
| 컨테이너의 mount가 호스트에 보이지 않음 | 공유 경로·mount propagation·호스트 접근 권한 |
| 여러 controller 복제본에서 중복 처리가 의심됨 | leader election과 재시도·멱등성, 실제 동일 작업의 호출 기록 |

등록·attach·노드 준비는 서로 다른 주체가 남긴 상태입니다
CSINode에 드라이버가 보이는 것, VolumeAttachment가 attached인 것, Pod에서 볼륨을 사용할 수 있는 것을 같은 완료 상태로 묶으면 안 됩니다

## 확인한 근거

- [코어의 CSI 클라이언트](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/csi_client.go), [CSI 등록 처리](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/csi_plugin.go), [Node·CSINode 반영](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/nodeinfomanager/nodeinfomanager.go) — Node RPC·등록·API 기록 경계
- [스토리지 API 타입](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/storage/v1/types.go), [외부 attacher v4.13.0](https://github.com/kubernetes-csi/external-attacher/blob/40d44ae14961a415348180a0e666651e82e44eb7/pkg/controller/csi_handler.go), [provisioner v6.4.0](https://github.com/kubernetes-csi/external-provisioner/blob/72f13ee46fb93c11a72ef91549e70158283c03af/pkg/controller/controller.go) — 오브젝트·CSI 작업의 주체
- [sidecar 역할](https://github.com/kubernetes-csi/docs/blob/67fe654a3246ad5c5cd212a0f4859706f9970353/book/src/sidecar-containers.md), [배포 구조](https://github.com/kubernetes-csi/docs/blob/67fe654a3246ad5c5cd212a0f4859706f9970353/book/src/deploying.md), [registrar v2.18.0](https://github.com/kubernetes-csi/node-driver-registrar/blob/6f4e96f4222783370e4d2f3e3fc733b49c194a5f/README.md) — 선택적 공통 구현과 Linux 소켓·권한의 일반 배치
- [core가 의존하는 CSI spec](https://github.com/container-storage-interface/spec/blob/cd9e7ad1ae0915cabcad179f2b8a660c0cb6eb9f/spec.md), [외부 spec v1.13.0](https://github.com/container-storage-interface/spec/blob/b516e92e3d6c0d27e6c8ffd0a956e3918b50f619/csi.proto) — 별도 버전의 계약이며 선언 수를 활성 기능 수와 구분
