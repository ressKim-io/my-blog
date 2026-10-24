---
title: "CCM과 클라우드 경계 — 노드 초기화와 외부 자원 정리"
excerpt: "클라우드 메타데이터·경로·로드 밸런서가 Node와 Service에 반영되는 과정을 살펴봅니다. uninitialized taint, Service finalizer, loadBalancerClass의 소유권과 비동기 실패 경계를 구분합니다"
category: kubernetes
tags: [kubernetes, cloud-controller-manager, cloud-provider, networking, loadbalancer, concept]
series:
  name: "k8s-theory-network"
  order: 9
date: "2026-10-16"
---

새 Node가 등록됐다고 클라우드 인스턴스 정보까지 준비된 것은 아닙니다
LoadBalancer Service가 저장됐다고 외부 로드 밸런서의 생성까지 끝난 것도 아닙니다

**cloud-controller-manager(CCM)**는 클라우드의 인스턴스·경로·로드 밸런서를 Kubernetes 오브젝트와 연결합니다
클라우드 API로 정보를 읽거나 자원을 조정하고, 그 결과를 Node와 Service에 반영합니다

CCM은 클러스터 안의 Pod로도 실행할 수 있습니다
클라우드 API를 호출할 자격과 Kubernetes API를 갱신할 권한은 따로 확인해야 합니다
둘 다 갖춰야 작업을 이어갈 수 있습니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref는 `f78e722310e50bcaca9276be22276d9e91d91308`, website 저장본은 `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`입니다
> 실제 cloud provider·클러스터 설치·클라우드 API 호출·로드 밸런서 동작을 실측한 기록은 포함하지 않습니다

## external 모드의 새 Node는 초기화 미완료를 표시합니다

`--cloud-provider=external`로 실행한 kubelet이 **새 Node를 등록하는 경로**에는 초기화 taint가 붙습니다
키는 `node.cloudprovider.kubernetes.io/uninitialized`, effect는 `NoSchedule`입니다
이 taint를 견디는 toleration이 없는 Pod의 새 배치를 제한합니다

이것은 Node의 `Ready` 조건과 다른 판단입니다
노드와 통신할 수 있고 런타임을 사용할 수 있더라도 클라우드 정보가 아직 채워지지 않았다면 초기화 제약이 남을 수 있습니다

![external kubelet의 새 Node 등록부터 CCM 초기화 필드·taint의 단일 Update와 별도 주소 status 기록까지|tall](/diagrams/k8s-theory-cloud-controller-boundary-1.svg)

kubelet이 알 수 있는 정보와 클라우드에서 가져올 정보도 구분합니다
아래는 대표적인 입력이며 kubelet의 전체 라벨 목록은 아닙니다

| Node 정보 | 대표적인 입력·작성 경로 |
|---|---|
| `kubernetes.io/hostname` | kubelet이 사용하는 호스트 이름 |
| `kubernetes.io/os`·`kubernetes.io/arch` | kubelet 바이너리의 OS·아키텍처 |
| `node.kubernetes.io/instance-type` | cloud node controller가 받은 인스턴스 메타데이터 |
| `topology.kubernetes.io/zone`·`topology.kubernetes.io/region` | cloud node controller가 받은 클라우드 위치 정보 |
| `spec.providerID` | 클라우드 인스턴스 식별자. kubelet의 `--provider-id`로 미리 지정하는 경로도 있음 |

라벨이 중요한지에 따라 나누는 것이 아니라 어느 입력을 사용해 누가 채우는지에 따라 나뉩니다
클라우드가 zone·region·instance type을 빈 값으로 반환하면 해당 라벨이 모두 생긴다고 보장할 수도 없습니다

초기화 taint는 [`initialNode`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kubelet_node_status.go#L303-L340)가 새 Node를 만들 때 붙입니다
이미 존재하는 Node를 만나는 재등록 경로는 기본 라벨·attach/detach 어노테이션·확장 자원·hugepage 등을 맞추지만, 이 taint를 다시 붙이지는 않습니다
kubelet 재시작을 클라우드 초기화의 재시작과 같게 볼 수 없는 이유입니다

## 초기화 값과 taint 제거는 같은 Node Update입니다

CCM의 cloud node controller는 메타데이터를 읽고 Node에 적용할 변경 함수를 모읍니다
마지막에 uninitialized taint를 제거하는 함수를 붙인 뒤, 필드 변경과 taint 제거를 **같은 Node Update**로 보냅니다

값을 채우기 전에 taint만 먼저 제거하면, 클라우드 조회가 실패한 Node가 필요한 신원 정보 없이 새 Pod를 받을 수 있습니다
해당 컨트롤러는 초기화 뒤 `providerID`를 계속 다시 채우는 구조가 아니므로 오류를 반환해 재시도할 수 있게 하는 것이 중요합니다

다만 인터페이스와 기존 Node 값에 따른 조건이 있습니다

| 메타데이터 경로 | `providerID`가 비었을 때 |
|---|---|
| `InstancesV2`가 반환한 메타데이터의 ID가 비어 있고 Node의 ID도 없음 | 오류를 반환하며 taint 제거로 진행하지 않음 |
| `InstancesV2` 메타데이터의 ID는 비었지만 Node에 ID가 있음 | 기존 Node ID로 메타데이터를 보완 |
| 이전 `Instances` 경로에서 ID 조회가 `NotImplemented`를 반환 | ID 없이 이름으로 정보를 찾는 호환성 예외 허용 |
| 이전 `Instances` 경로에서 그 밖의 ID 조회 오류 발생 | 오류를 반환해 재시도 |

Node에 이미 `providerID`가 있으면 초기화 변경 목록은 그 값을 덮어쓰지 않습니다
`InstancesV2`가 메타데이터 자체를 `nil`로 반환한 경우에도 이 초기화를 건너뛰므로 taint 제거가 수행되지 않습니다
이처럼 인터페이스와 기존 값에 따라 동작이 달라지므로, 초기화할 때 모든 필드를 반드시 새로 쓰는 것은 아닙니다

주소는 초기화 필드와 별도로 기록합니다
taint를 제거하기 전에 kubelet이 지정한 Node IP를 클라우드 주소 목록에 적용할 수 있는지 검증합니다
이 검증이 실패하면 초기화 Update로 진행하지 않습니다

하지만 `status.addresses` 기록은 초기화 Update가 성공한 **뒤에 별도 patch**로 처리합니다
그 patch가 실패하면 로그에 남으므로, taint 제거와 주소 기록까지 하나의 원자적 쓰기라고 보면 안 됩니다
주소를 정기적으로 다시 동기화하는 경로도 초기화 필드 설정과 구분해야 합니다

이 순서와 예외는 [`syncNode`·`getNodeModifiersFromCloudProvider`·`getInstanceMetadata`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cloud-provider/controllers/node/node_controller.go#L416-L650)를 기준으로 확인했습니다
오류 반환 때 workqueue가 재시도하며, taint 자체가 모든 재시도를 만들어 내는 것은 아닙니다

## CCM에는 서로 다른 네 컨트롤러 경로가 있습니다

확인한 [`cloud-provider/app/core.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cloud-provider/app/core.go)는 네 컨트롤러의 시작 경로를 둡니다
실제 활성화는 설정과 provider의 인터페이스 지원에 달려 있습니다

| 컨트롤러 | 클라우드에서 읽거나 조정하는 것 | Kubernetes에 반영하는 것 |
|---|---|---|
| cloud node | 인스턴스 메타데이터 | 초기화 필드·라벨·주소, uninitialized taint 제거 |
| cloud node lifecycle | 인스턴스 존재·종료 상태 | Node 삭제 또는 shutdown taint |
| route | 노드의 Pod CIDR로 가는 클라우드 경로 | `NetworkUnavailable` 조건 |
| service | 외부 로드 밸런서와 백엔드 노드 | Service의 LB 상태·정리 finalizer |

[공식 CCM 개요](https://kubernetes.io/docs/concepts/architecture/cloud-controller/)는 node·route·service를 중심으로 설명하면서, node와 node lifecycle을 분리하는 구현도 있다고 명시합니다
문서의 기능 분류와 현재 코드의 시작 함수 개수를 그대로 같은 단위로 세면 안 됩니다

관련 기본값도 서로 다른 작업의 주기입니다
cloud node lifecycle의 `--node-monitor-period`는 5초, 경로 조정의 `--route-reconciliation-period`는 10초이며 service controller의 노드 informer 재동기 주기는 100초입니다
이 값은 API 호출·처리가 그 시간 안에 성공한다는 상한이나 클라우드 자원 생성 시간을 뜻하지 않습니다

### 노드의 연락 상태와 인스턴스의 존재는 다른 질문입니다

kube-controller-manager의 node lifecycle controller는 Node 상태 하트비트·Lease 갱신을 보고 연락 상태를 판단합니다
CCM의 cloud node lifecycle controller는 그 상태를 입력으로 사용하며, 같은 미관찰 시간을 다시 계산하지 않습니다

[`MonitorNodes`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cloud-provider/controllers/nodelifecycle/node_lifecycle_controller.go#L147-L229)는 `Ready=True`이면 shutdown taint 제거를 시도하고 클라우드 존재 질의를 건너뜁니다
`Ready=False`·`Unknown`이거나 Ready 조건이 없으면 클라우드의 인스턴스 상태를 확인할 수 있습니다

- 인스턴스가 없다고 오류 없이 확인되면 Kubernetes Node 삭제를 요청합니다
- 인스턴스가 존재하면서 종료 상태라고 확인되면 `node.cloudprovider.kubernetes.io/shutdown:NoSchedule` taint를 붙입니다
- 조회가 실패하면 그 오류를 기록하며, 단순한 조회 실패를 인스턴스 부재로 취급하지 않습니다

따라서 NotReady Node가 남아 있다는 사실만으로 cloud node lifecycle controller의 장애를 확정할 수 없습니다
인스턴스가 실제로 존재하거나, 질의가 실패했거나, 컨트롤러가 활성화되지 않은 경우를 나눠야 합니다

## LoadBalancer Service는 세 시점의 값을 함께 가집니다

Service 요청의 선언, API 서버의 저장 중 할당, 외부 컨트롤러의 비동기 처리를 구분합니다

| 값 | 작성하는 주체 | 시점 |
|---|---|---|
| `spec.type`·`spec.selector`·`spec.ports` | 요청 작성자 | 요청에 선언 |
| `spec.clusterIP`·필요한 `spec.ports[].nodePort` | API 서버의 Service registry | 저장 과정에서 할당·지정값 검증 |
| `status.loadBalancer.ingress` | CCM service controller 또는 해당 구현의 컨트롤러 | 클라우드 처리 뒤 비동기 반영 |

기본 구성에서 LoadBalancer Service에도 ClusterIP와 nodePort가 있습니다
`nodePort`를 CCM이 할당하는 것은 아닙니다
API 서버가 저장 중 필요한 주소·포트를 확보하지 못하면 요청이 실패하지만, 외부 LB 처리자는 그 뒤에 별도로 동작합니다

`allocateLoadBalancerNodePorts`의 기본값은 `true`입니다
`false`로 설정하면 새 nodePort를 자동 할당하지 않으며, 기존 포트가 자동으로 제거되지는 않습니다
Pod IP로 직접 전달하는 LB처럼 nodePort가 필요 없는 구성이 가능한지는 실제 구현의 지원을 확인해야 합니다

이 경계는 [`SetDefaults_Service`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/v1/defaults.go)와 [`shouldAllocateNodePorts`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/service/storage/alloc.go), [Service 공식 문서](https://kubernetes.io/docs/concepts/services-networking/service/#disabling-load-balancer-nodeport-allocation)를 기준으로 확인했습니다

### EXTERNAL-IP의 pending은 API 상태 값이 아닙니다

`kubectl get svc`에 보이는 `<pending>`은 printer가 만든 표시입니다
LoadBalancer Service에서 LB 상태와 `spec.externalIPs`에 표시할 주소가 없으면 이 문자열을 출력합니다
API에 별도의 `pending` 상태 값을 저장하는 것은 아닙니다

이 표시만으로는 생성 중인지, 클라우드 오류로 재시도 중인지, 처리자가 없는지 알 수 없습니다
`loadBalancerClass`로 위임했는데 그 클래스를 지원하는 컨트롤러가 없는 경우도 주소가 비어 있을 수 있습니다

기본 service controller는 시작 시 `EnsuringLoadBalancer`, LB 확보 성공 시 `EnsuredLoadBalancer`, 동기화 실패 시 `SyncLoadBalancerFailed` 이벤트를 남깁니다
성공 이벤트가 있어도 뒤따르는 status 쓰기까지 모두 성공했는지는 별도로 봐야 합니다
이벤트 부재도 보존 기간·기록 실패의 영향을 받으므로 처리자 부재의 증명은 아닙니다

표시의 실제 조건은 [`getServiceExternalIP`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/printers/internalversion/printers.go#L1412-L1441), 처리 경로는 service controller의 이벤트·로그·Service status를 함께 확인합니다

## loadBalancerClass는 신규 LB 처리 주체를 가릅니다

기본 CCM service controller의 [`wantsLoadBalancer`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cloud-provider/controllers/service/controller.go#L862-L866)는 두 조건을 봅니다
Service 타입이 `LoadBalancer`이고 `spec.loadBalancerClass`가 `nil`이어야 신규 할당 대상으로 판단합니다

class 값이 있으면 이를 지원하는 다른 컨트롤러가 신규 LB 처리를 맡습니다
IngressClass나 StorageClass와 달리 이 문자열이 가리키는 별도 class 오브젝트는 없습니다
API가 값을 수락했다고 그 처리자가 설치돼 있다는 뜻은 아닙니다

이 판정과 기존 자원의 정리는 다릅니다
informer는 `wantsLoadBalancer` 외에도 `needsCleanup`·`needsUpdate` 조건으로 Service를 큐에 넣습니다
기존 cleanup finalizer가 남은 Service는 class가 있다는 이유만으로 모든 처리가 배제되지는 않습니다

class 변경 제한도 이전·새 타입을 함께 봐야 합니다

| 요청 | class 검증·정리 경계 |
|---|---|
| LoadBalancer Service 생성 | class 지정 가능, 형식 검증 적용 |
| 기존·새 타입 모두 LoadBalancer | nil에서 값 추가·값 제거를 포함해 class가 달라지면 거절 |
| 다른 타입에서 LoadBalancer로 전환 | class 지정 가능, 형식과 다른 Service 검증은 계속 적용 |
| LoadBalancer에서 다른 타입으로 전환하며 기존 class 유지 | 서버가 불필요해진 기존 class를 제거 |
| 새 타입이 LoadBalancer가 아닌데 class를 남기는 요청 | 검증에서 거절 |

이는 [`validateLoadBalancerClassField`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go#L9647-L9689)와 Service strategy의 `dropTypeDependentFields`를 함께 적용한 경계입니다
타입 전환이 API에서 허용된다는 사실이 외부 LB의 전환 순서나 무중단을 보장하지는 않습니다

## LB 생성 전에 Service에 정리 finalizer를 붙입니다

기본 service controller는 외부 자원을 만들기 전에 `service.kubernetes.io/load-balancer-cleanup` finalizer부터 추가합니다
LB 생성 뒤 Service가 먼저 사라져 정리 대상을 잃는 일을 막기 위한 순서입니다

정상적인 생성·정리 경로는 다음과 같습니다

1. Service에 cleanup finalizer를 붙입니다
2. provider의 `EnsureLoadBalancer`를 호출해 LB를 확보하고 반환된 상태를 Service에 반영합니다
3. 삭제 요청이 들어오거나 LB가 더 이상 필요하지 않으면 해당 LB의 정리를 요청합니다
4. 정리 성공을 확인한 뒤 finalizer를 제거해 Service 삭제가 마무리될 수 있게 합니다

이 작업은 [service controller의 `syncLoadBalancerIfNeeded`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cloud-provider/controllers/service/controller.go#L364-L439)에 있습니다
provider가 다른 컨트롤러의 구현임을 나타내는 `ImplementedElsewhere`를 반환하는 위임 경로도 있으므로 모든 LB가 이 CCM에서 직접 생성된다고 일반화할 수는 없습니다

finalizer가 남고 정상 정리 담당자가 멈추거나 클라우드 삭제가 실패하면 Service 삭제가 완료되지 않을 수 있습니다
정상 경로에서 이 finalizer를 제거하는 담당자와, API 권한상 finalizer를 수정할 수 있는 주체는 별개입니다
CCM만 이 필드를 수정할 수 있다는 권한 보장은 아닙니다

Node 초기화의 taint는 Pod의 **새 배치**를 제한합니다
Service finalizer는 오브젝트의 **삭제 완료**를 제한합니다
외부 작업이 남아 있다는 공통점만으로 두 장치가 막는 동작을 같게 보면 안 됩니다

## NotReady 노드도 LB 후보 목록에 남을 수 있습니다

기본 service controller는 provider에 넘길 노드 목록을 만들 때 `stableNodeSetPredicates`를 사용합니다
삭제 중인 노드, 제외 조건에 걸린 노드, `ToBeDeletedByClusterAutoscaler` taint가 있는 노드를 거르며 **Ready 조건은 이 목록에 없습니다**

`node.kubernetes.io/exclude-from-external-load-balancers` 라벨의 처리도 존재 여부만 보는 것이 아닙니다
확인한 [`nodeIncludedPredicate`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cloud-provider/controllers/service/controller.go#L1001-L1044)는 값을 `strconv.ParseBool`로 읽어 다음과 같이 판정합니다

| 라벨 값 | 이 제외 조건의 결과 |
|---|---|
| 라벨 없음 | 포함 가능 |
| 유효한 boolean `false` | 포함 가능 |
| 유효한 boolean `true` | 제외 |
| boolean으로 해석할 수 없는 값 | 제외 |

여기서 포함 가능하다는 말은 이 조건만 통과한다는 뜻입니다
삭제 여부·오토스케일러 taint 등 나머지 조건도 계속 적용합니다

Node 갱신 때는 제외 조건의 결과나 `providerID`가 바뀌어야 즉시 LB 동기화를 요청합니다
Ready만 바뀌면 이 조건에 해당하지 않습니다
Node 추가·삭제와 주기적 재동기, 다른 Service 변경에 따른 처리까지 없어진 것은 아닙니다

이 동작은 노드 상태가 흔들릴 때마다 LB 후보를 바꿔 연결을 갑자기 끊고 클라우드 API 호출을 늘리는 문제를 줄이기 위해 도입됐습니다
[KEP-3458](https://github.com/kubernetes/enhancements/blob/0c8d11e9a13e12d2ef75d2d78af5ac00d8189046/keps/sig-network/3458-remove-transient-node-predicates-from-service-controller/README.md)의 동기이며 v1.30에 stable이 됐습니다
현재 확인한 후보 선택에는 이를 켜는 feature gate 분기가 없습니다

실제로 정상 동작하지 않는 노드로 트래픽을 계속 보낼지는 클라우드 LB의 health check와 구성에 달려 있습니다
안정 노드 집합만으로 무중단이나 빠른 대상 제외를 보장하지 않습니다
노드를 백엔드로 사용하는 `externalTrafficPolicy: Local` 구성에서는 노드 제외가 그 노드의 Pod에 대한 외부 도달성에도 영향을 줄 수 있습니다

후보·이벤트 판정은 [`shouldSyncUpdatedNode`와 `stableNodeSetPredicates`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cloud-provider/controllers/service/controller.go#L693-L713), provider별 차이는 해당 LB 구현과 함께 확인해야 합니다

## Pod CIDR 할당과 클라우드 경로 생성은 별도 작업입니다

kube-controller-manager의 nodeipam은 노드별 주소 범위를 `Node.spec.podCIDRs`에 기록할 수 있습니다
CCM의 route controller는 이 범위를 읽어 클라우드 경로를 만드는 별도 소비자입니다

![KCM nodeipam의 Pod CIDR 기록과 CCM route controller의 클라우드 경로 조정, NetworkUnavailable 조건과 KCM taint 변환의 분업|tall](/diagrams/k8s-theory-cloud-controller-boundary-2.svg)

`--configure-cloud-routes`가 꺼져 있거나 provider가 `Routes` 인터페이스를 지원하지 않으면 이 route controller를 실행하지 않습니다
활성화할 때도 유효한 클러스터 CIDR 설정 등 생성 조건이 맞아야 합니다
Node에 Pod CIDR이 있다는 사실만으로 클라우드 경로 조정까지 활성화됐다고 판단할 수는 없습니다

이 경로에서 route controller는 자기가 관리하는 경로 작업 결과를 `NetworkUnavailable` 조건에 기록합니다
경로가 준비되면 `False`, 준비되지 않으면 `True`로 반영합니다
kube-controller-manager의 node lifecycle controller는 `True`를 `node.kubernetes.io/network-unavailable:NoSchedule` taint로 옮깁니다

이 taint는 클라우드 초기화의 uninitialized taint나 인스턴스 종료의 shutdown taint와 원인이 다릅니다
Ready가 True여도 별도로 남을 수 있으므로 Node 상태와 taint의 키를 함께 읽어야 합니다

또한 모든 CNI가 Kubernetes의 Pod CIDR이나 CCM 경로를 사용하는 것은 아닙니다
네트워크 구현이 자체 주소 풀과 별도 라우팅을 사용할 수도 있습니다
범위를 기록하는 주체와 실제 주소·경로를 소비하는 주체는 [overlay·native routing 글](/essays/k8s-theory-overlay-native-routing)에서 구분한 관계입니다

소스 기준은 CCM의 [`startRouteController`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cloud-provider/app/core.go#L104-L151)와 [`updateNetworkingCondition`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cloud-provider/controllers/route/route_controller.go#L528-L576)입니다

## 코어에서 분리됐지만 cloud provider 계약은 Go 인터페이스입니다

in-tree cloud provider를 분리한 [KEP-2395](https://github.com/kubernetes/enhancements/blob/0c8d11e9a13e12d2ef75d2d78af5ac00d8189046/keps/sig-cloud-provider/2395-removing-in-tree-cloud-providers/README.md)는 두 동기를 설명합니다
코어 바이너리에서 클라우드 SDK 의존성과 취약점 표면을 줄이고, provider가 Kubernetes 코어와 별도 일정으로 기능·수정 버전을 배포하도록 하는 것입니다
이 분리는 v1.31에 stable이 됐습니다

v1.35 KCM에는 경고를 남기고 `nil`을 반환하는 service·cloud node lifecycle·route 컨트롤러의 등록 자리가 남아 있었습니다
v1.37.1의 KCM에서는 그 생성자들이 제거돼 있습니다
반면 nodeipam은 남아 있으며 cloud provider를 `nil`로 전달하고 `CloudAllocator` 선택은 거부합니다

따라서 클라우드 의존 코드 분리를 Pod CIDR 할당까지 전부 CCM으로 옮겼다는 뜻으로 읽으면 안 됩니다
현재 KCM의 관련 경계는 [`newNodeIpamController`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kube-controller-manager/app/core.go#L80-L152)에 남아 있습니다

다만 외부 연동의 계약이 모두 같은 형태는 아닙니다
[CNI 스펙](https://github.com/containernetworking/cni/blob/3ee5ddf6d892e4ee4205634c436a3c7e45629eb2/SPEC.md)은 실행 파일 호출과 JSON 입출력을, [CSI 스펙](https://github.com/container-storage-interface/spec/blob/25b3f10249abe6033887ed5177e856b9f73b1105/spec.md)은 별도 프로세스와의 gRPC 계약을 정의합니다
cloud provider는 [`k8s.io/cloud-provider`의 Go 인터페이스](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cloud-provider/cloud.go)를 구현해 CCM 바이너리에 연결하는 모델입니다

provider 구현을 별도 배포할 수 있어도 공통 라이브러리의 인터페이스 변경에 맞춰 빌드·호환성을 관리해야 합니다
[cloud-provider README](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cloud-provider/README.md)도 구현이 저장소의 인터페이스 변화에 맞춰 유지돼야 한다고 설명합니다
프로세스 사이의 프로토콜 분리와 같은 바이너리 안의 Go 인터페이스 분리를 구분하는 이유입니다

## 실패한 단계는 상태·taint·담당 컨트롤러를 연결해 찾습니다

| 보이는 상태 | 구분할 경계 | 확인할 근거 |
|---|---|---|
| Ready인데 uninitialized taint가 남음 | 클라우드 초기화가 미완료일 수 있음 | CCM 활성화·메타데이터 조회 오류·providerID·지정 주소 검증 |
| zone·region 라벨이 없음 | 초기화 미완료와 provider의 빈 메타데이터를 구분 | uninitialized taint와 CCM 로그·반환 정보 |
| Ready인데 NetworkUnavailable이 True | 관리되는 클라우드 경로 준비와 연락 상태는 별도 | route controller 활성 조건·클라우드 경로·조건 반영 오류 |
| NotReady Node가 계속 남음 | 인스턴스 존재·조회 실패·컨트롤러 부재를 구분 | cloud node lifecycle 로그와 인스턴스 상태 |
| EXTERNAL-IP가 pending | 표시할 주소가 없으며 원인은 아직 미확정 | class 지원 처리자·이벤트·컨트롤러 로그·Service status |
| SyncLoadBalancerFailed 반복 | LB 처리나 후속 상태 반영이 실패 | 이벤트 메시지와 클라우드·Kubernetes API 오류 |
| cleanup finalizer가 남아 삭제가 끝나지 않음 | 외부 자원 정리가 끝나지 않았거나 반영되지 않음 | 정상 정리 담당자와 클라우드 LB 상태·권한 |
| NotReady 노드가 LB 후보에 남음 | 기본 후보 판정에 Ready가 없음 | LB health check·제외 라벨의 실제 boolean 값 |

클라우드 자격증명이 틀리면 클라우드 조회·생성·삭제가 실패할 수 있습니다
Kubernetes 권한이 부족하면 결과 필드·taint·finalizer·status 쓰기가 실패할 수 있습니다
같은 빈 필드나 남은 제약도 어느 API에서 실패했는지에 따라 확인할 담당자와 근거가 달라집니다
