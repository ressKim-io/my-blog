---
title: "ServiceCIDR와 IPAddress — 주소를 확보한 뒤 Service를 저장합니다"
excerpt: "API 서버가 ClusterIP를 고르고 IPAddress 이름으로 중복 할당을 막는 과정을 따라갑니다. ServiceCIDR의 주소 범위·삭제 보호, bitmap 이행과 repair가 복구하는 경계를 구분합니다"
category: "kubernetes"
tags: ["Kubernetes", "ServiceCIDR", "IPAddress", "ClusterIP", "concept"]
series:
  name: "k8s-theory-network"
  order: 11
date: "2026-10-23"
---

Service 하나가 받는 ClusterIP는 누가 어디서 고르고, 같은 주소를 다른 Service에 주지 못하도록 무엇이 지킬까요?
API 서버의 할당기는 사용할 수 있는 대역에서 주소를 고르고, 그 주소를 이름으로 하는 IPAddress 오브젝트를 만듭니다

노드에서 ClusterIP를 백엔드로 전달하는 규칙을 만들기 전에 주소를 확보하는 과정입니다
ServiceCIDR은 주소를 공급하는 범위를, IPAddress는 확보한 주소와 그 주소를 쓰는 오브젝트의 참조를 API로 드러냅니다

> **근거**: Kubernetes v1.37.1 `f78e722310e50bcaca9276be22276d9e91d91308`과 공식 문서 저장본 `7fde177e22dc98390a6d55d215dd0301b5f6d0bb` 기준입니다
> bitmap 이행 설계는 KEP-1880 `0c8d11e9a13e12d2ef75d2d78af5ac00d8189046`과 현재 실행 분기를 구분해 설명합니다
> 클러스터에서 주소 할당·삭제·복구를 재현한 기록이나 지연 실측은 포함하지 않습니다

## 주소 확보와 Service 저장은 별도의 쓰기입니다

그림은 ClusterIP를 할당받는 Service의 **주소 하나**를 따라갑니다
headless와 ExternalName Service는 이 ClusterIP 할당 경로에서 주소를 받지 않습니다
dual-stack Service라면 할당할 주소마다 IPAddress가 필요합니다

![API 서버가 주소 후보를 고르고 정규형 주소 이름의 IPAddress를 먼저 생성한 뒤 확보한 주소를 가진 Service를 저장하는 순서|tall](/diagrams/k8s-theory-service-cidr-ip-address-1.svg)

할당기를 부르는 곳은 Service 저장소의 `beginCreate`입니다
먼저 주소와 포트를 확보하고, 저장이 성공하면 commit 콜백을, 실패하면 revert 콜백을 실행합니다
`IPAddress`와 Service를 함께 저장하는 하나의 원자적 트랜잭션은 아닙니다

순서를 뒤집어 Service를 먼저 저장하면 주소 확보에 실패한 Service가 남을 수 있습니다
현재 순서는 실패했을 때 Service 없는 IPAddress가 남는 쪽을 택하고, 해제 시도와 뒤의 repair가 이를 정리합니다
주소 중복을 막는 쓰기와 두 오브젝트의 참조를 맞추는 복구는 역할이 다릅니다

현재 호출 경계는 [Service 저장소의 beginCreate](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/service/storage/storage.go)와 [txnAllocClusterIPs](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/service/storage/alloc.go)에 있습니다

## 정규형 주소 이름에 대한 Create가 중복을 판정합니다

IPAddress는 클러스터 범위의 `networking.k8s.io/v1` 리소스입니다
`10.96.0.137`이라는 이름의 IPAddress가 그 주소의 확보 기록입니다
할당기가 만드는 오브젝트는 다음과 같은 형태입니다

```yaml
apiVersion: networking.k8s.io/v1
kind: IPAddress
metadata:
  name: 10.96.0.137
  labels:
    ipaddress.kubernetes.io/ip-family: IPv4
    ipaddress.kubernetes.io/managed-by: ipallocator.k8s.io
spec:
  parentRef:
    resource: services
    namespace: default
    name: web
```

이것은 필드를 설명하는 예시이며 실제 클러스터 조회 출력은 아닙니다
`spec.parentRef`는 필수이고 group·resource·namespace·name으로 사용 대상을 참조합니다
Service의 코어 API 그룹은 빈 문자열이므로 예시에서는 group을 생략했습니다

parentRef는 `ownerReferences`가 아닙니다
이 참조만 보고 Kubernetes GC가 사용자를 따라 IPAddress를 자동 삭제하는 구조는 아닙니다
Service 저장소의 해제 경로와 repair가 참조를 대조합니다
parentRef는 변경할 수 없는 필드이므로 참조를 바로잡는 복구도 삭제·재생성을 사용합니다

IPAddress에는 status 필드도 `/status` 하위 리소스도 없습니다
오브젝트가 존재한다는 사실이 주소 확보 기록이지만, 참조한 Service가 실제로 존재하고 그 주소를 쓰는지까지 자동으로 참이 되지는 않습니다
그래서 별도의 정합성 검사가 필요합니다

### 이름이 같으면 두 생성 요청이 함께 성공하지 못합니다

`Allocator.createIPAddress`는 주소 이름으로 Create를 보내고 `AlreadyExists`를 `ErrAllocated`로 바꿉니다
지정한 주소가 이미 확보돼 있으면 `provided IP is already allocated`로 할당이 실패합니다
다른 API 서버가 거의 동시에 같은 후보를 골랐어도 같은 리소스의 같은 이름으로 두 오브젝트를 만들 수는 없습니다

이 범위에서 주소 이름이 잠금 역할을 대신한다고 설명할 수 있습니다
전체 Service 생성이 원자적이거나 할당기에 동기화가 전혀 없다는 뜻은 아닙니다
배타성을 판정하는 동작이 주소 이름에 대한 API Create라는 뜻입니다

이름은 주소의 정규형이어야 합니다
IPv4의 앞자리 0이나 IPv6의 다른 축약 표기를 별개의 이름으로 허용하면 같은 주소를 서로 다른 키로 확보할 수 있기 때문입니다
검증은 유효한 IP인지 검사하고 문자열도 정규형과 대조하며, 비정규형에는 `must be in canonical form` 오류가 생길 수 있습니다

규약과 검증은 [IPAddress 타입](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/networking/v1/types.go), [이름 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/util/validation/ip.go), [createIPAddress](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/service/ipallocator/ipallocator.go)에 근거합니다

## 동적 할당은 캐시로 후보를 고르고 쓰기로 확정합니다

동적 할당은 범위 안의 무작위 지점에서 시작해 주소를 순회합니다
informer 캐시에서 이미 보이는 IPAddress는 건너뛰고, 없는 후보에 Create를 시도합니다

캐시가 낡아 다른 API 서버가 먼저 확보한 주소를 고르면 Create가 `AlreadyExists`로 충돌을 알려줍니다
이 경우에는 다음 후보를 시도합니다
현재 소스는 Create의 다른 오류까지 모두 충돌로 삼키지 않고 반환합니다

따라서 캐시는 어디를 시도할지 정하는 데 쓰이며, 최종 확보 여부는 API 쓰기가 판정합니다
시작 지점의 무작위 선택은 여러 할당기가 같은 후보부터 찾는 경합을 줄이려는 것이며 충돌이 없다는 보장은 아닙니다

### 동적 할당이 먼저 쓰는 구간은 따로 있습니다

대역 전체 주소 개수인 cidrSize가 16 이하면 구간 offset은 0입니다
그보다 크면 offset은 `min(max(16, cidrSize / 16), 256)`입니다
동적 할당은 높은 주소 구간부터 찾고 그 구간이 가득 차면 낮은 구간으로 내려옵니다

![10.96.0.0/16에서 낮은 주소 256개와 높은 주소 구간을 나누며 동적 할당이 높은 구간을 먼저 사용하고 소진 뒤 낮은 구간으로 돌아오는 관계](/diagrams/k8s-theory-service-cidr-ip-address-2.svg)

낮은 구간은 수동 지정 주소와 자동 할당의 충돌을 줄이기 위한 구간이지 수동 할당 전용 예약 공간이 아닙니다
수동 지정은 유효한 두 구간에서 모두 가능하고, 자동 할당도 높은 구간을 다 쓰면 낮은 구간을 사용합니다

구간을 나눌 때의 전체 주소 개수와 실제 할당 가능한 주소 개수도 다릅니다
IPv4는 network·broadcast 주소를 제외하고, IPv6도 대역의 첫 주소를 제외합니다
그림의 `/16` 경계와 작은 대역의 예외는 [calculateRangeOffset](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/service/ipallocator/bitmap.go) 및 [NewIPAllocator·allocateNextService](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/service/ipallocator/ipallocator.go)에서 확인할 수 있습니다

## ServiceCIDR는 주소를 공급하는 범위와 수명을 드러냅니다

ServiceCIDR도 클러스터 범위의 `networking.k8s.io/v1` 리소스입니다
현재 API 서버는 v1을 기본으로 등록하며 v1beta1은 기본 비활성입니다
`spec.cidrs`에는 한 개 또는 두 개의 CIDR을 두며, 둘이면 IPv4와 IPv6가 하나씩이어야 합니다
IPAddress와 달리 `status.conditions`와 `/status`가 있고 Ready 조건을 사용합니다

기본 ServiceCIDR의 이름은 `kubernetes`입니다
API 서버 안의 기본 대역 컨트롤러가 `--service-cluster-ip-range` 값을 바탕으로 만들며, 이후 별도 ServiceCIDR를 추가해 주소 범위를 늘릴 수 있습니다

계열별 MetaAllocator는 ServiceCIDR를 관찰해 CIDR별 할당기를 구성합니다
동일한 CIDR 문자열을 가진 여러 ServiceCIDR는 같은 할당기를 참조하지만, 서로 겹치기만 하는 다른 CIDR은 별도 항목입니다
그 대역들이 같은 주소를 후보로 골라도 클러스터 범위 IPAddress 이름의 유일성은 공유합니다

할당기 준비 상태에는 Ready와 삭제 진행 여부, informer 동기화가 관여합니다
동적 할당은 사용할 수 있는 대역의 할당기를 순회하며, 특정 ServiceCIDR 이름을 요청해 그 대역을 고르는 인터페이스는 아닙니다
주소를 직접 지정하는 경우에는 그 주소를 포함하며 할당 가능한 대역을 찾습니다

이 경계는 [MetaAllocator](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/service/ipallocator/cidrallocator.go)에 있습니다
ServiceCIDR를 하나 추가했다는 사실만으로 다음 Service가 반드시 새 대역에서 주소를 받는다고 보장할 수 없습니다

### 첫 대역은 유지하고 다른 계열을 추가할 수 있습니다

| spec.cidrs 변경 | 현재 검증 결과 |
|---|---|
| 길이가 같고 기존 값을 바꿈 | 해당 위치가 불변이라 거절 |
| 1개에서 2개로 늘림 | 첫 값을 유지하고 새 값이 다른 계열이면 허용 |
| 2개에서 1개로 줄임 | 거절 |

타입 주석은 아직 cidrs를 단순히 불변이라고 설명하지만, [ValidateServiceCIDRUpdate](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/networking/validation/validation.go)는 single-stack에서 dual-stack으로 늘리는 예외를 허용합니다
주소 범위 오브젝트의 변경 규칙과 Service의 주소 정책을 같다고 읽으면 안 됩니다

클러스터에 해당 주소 계열의 할당기가 구성돼 있어야 Service의 ipFamilies 요청을 처리할 수 있습니다
dual-stack 할당은 계열별 주소를 확보해 Service의 clusterIPs에 반영하며, 기존 Service의 주소를 대역 추가만으로 자동 교체하지 않습니다

기본 대역 컨트롤러도 첫 대역이 같으면 single-stack에서 dual-stack으로 갱신하는 경로가 있습니다
반면 기존 기본 대역과 API 서버 플래그가 다르면 값을 강제로 맞추거나 Ready를 덮지 않고 `KubernetesDefaultServiceCIDRInconsistent` Event를 남깁니다
모든 API 서버의 설정이 자동으로 같은 값이 되는 것은 아닙니다

### Ready를 기록하는 경로도 버전 조건이 있습니다

기본 대역 컨트롤러와 controller-manager의 ServiceCIDR 컨트롤러가 상태를 다룹니다
v1.37.1의 `ServiceCIDRStatusFieldWiping`은 기본 true이며 Deprecated지만 잠겨 있지는 않습니다
활성화된 경우 루트 create에서는 status를 비우고, 루트 update에서는 기존 status를 유지하며 `/status` 경로를 통해 상태를 갱신합니다

v1.35에서는 이 status 정리가 기본으로 적용되지 않았으며 v1.36부터 기본값이 바뀌었습니다
현재 조건은 [feature gate 등록](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go)과 [ServiceCIDR 전략](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/networking/servicecidr/strategy.go)에 있습니다

## 삭제는 고아 주소 검사와 전파 유예를 거칩니다

ServiceCIDR 컨트롤러는 `networking.k8s.io/service-cidr-finalizer`를 붙입니다
삭제 요청 뒤에는 주소가 다른 대역의 보호 없이 남는지 다음 순서로 검사합니다

| 순서 | 검사 | 의미 |
|---|---|---|
| 1 | 삭제 대상의 각 CIDR 전체를 덮는 다른 ServiceCIDR가 있는가 | 모두 덮이면 개별 IPAddress를 훑지 않고 삭제 가능 판정 |
| 2 | 그렇지 않으면 계열·관리자 라벨로 IPAddress를 조회하고 주소별 포함 대역 확인 | 삭제 대상만 그 주소를 덮으면 삭제 차단 |

여기서 대역을 덮는다는 것은 할당 가능한 주소 범위를 뜻합니다
개별 주소 포함 검사에서는 network 주소와 IPv4 broadcast 주소도 제외합니다
대역의 포함 관계는 parentRef나 ownerReferences 관계가 아닙니다

막힌 삭제에는 `Ready=False`, reason `Terminating`이 기록됩니다
공식 작업 문서 예시의 `OrphanIPAddress`와 현재 컨트롤러의 reason이 다르므로, 이 글에서는 고정 소스의 `Terminating`을 사용합니다

메시지는 주소를 제거하거나 새 ServiceCIDR를 만들도록 안내합니다
사용 중인 Service를 삭제해 주소를 반환하는 방법 외에도, 그 주소를 계속 덮는 다른 대역을 마련하면 삭제 보호 조건이 풀릴 수 있습니다

삭제 가능 판정을 받아도 finalizer 해제는 `deletionTimestamp`로부터 10초가 지날 때까지 유예합니다
그 판정 뒤에 다시 10초를 세는 것이 아닙니다
API 서버들의 할당기에 삭제 정보가 전파되기 전에 새 주소가 나오는 경합을 줄이려는 유예이며, 전체 삭제가 정확히 10초에 끝난다는 보장도 아닙니다

근거는 [Controller.sync·canDeleteCIDR](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/servicecidrs/servicecidrs_controller.go)와 [주소 포함 검사](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/api/servicecidr/servicecidr.go)입니다

## bitmap 이중 쓰기는 현재 실행 경로와 구분합니다

이전 할당기는 주소 사용 여부를 하나의 bitmap에 저장했습니다
새 방식은 주소마다 IPAddress를 두므로 사용 중인 주소와 참조를 API로 조회·watch할 수 있습니다
ServiceCIDR도 오브젝트가 되어 범위를 추가하고 삭제 보호를 적용할 수 있습니다

이행기에는 옛 API 서버가 bitmap만 읽으므로 새 API 서버가 양쪽에 쓰는 호환 경로가 필요했습니다
그 경로에서는 bitmap을 먼저 확보하고 IPAddress를 나중에 만듭니다
IPAddress를 먼저 만들고 bitmap을 나중에 확보하면 그 사이 옛 할당기가 같은 주소를 고를 수 있기 때문입니다

| gate | v1.37.1 실제 등록 | 의미 |
|---|---|---|
| MultiCIDRServiceAllocator | GA·true·LockToDefault | IPAddress 기반 할당기 사용 |
| DisableAllocatorDualWrite | GA·true·LockToDefault | bitmap과의 이중 쓰기 사용 안 함 |

두 gate는 v1.35에서도 이미 true로 잠겨 있었고, 현재 소스에도 등록이 남아 있습니다
주석이나 KEP의 제거 예정 버전만으로 제거가 끝났다고 설명하지 않습니다
현재 [저장소 초기화](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/rest/storage_core.go)는 새 MetaAllocator와 RepairIPAddress를 선택하며 이중 쓰기용 bitmap 할당기는 만들지 않습니다
현재 버전은 IPAddress에서 옛 bitmap 방식으로 돌아가는 전환을 지원하지 않습니다

예전 플래그 검증에는 `maxCIDRBits = 20`이라는 주소 공간 상한이 있습니다
IPv4는 prefix 길이 최소 12, IPv6는 최소 108에 해당하지만 현재 두 gate가 켜진 경로에서는 그 검사를 건너뜁니다
다만 새 IPv6 할당기는 prefix 길이 64 미만을 거절하므로 범위 제약이 전혀 없어졌다는 뜻은 아닙니다

> **과거 수치의 확인 범위**: KEP-1880은 옛 제약을 IPv6 `/112`, bitmap 크기를 약 32k로도 설명합니다
> 현재 남은 플래그 검증의 20 host bits와 같은 숫자가 아니며, 각 역사적 수치가 달라진 이유는 확인하지 못했습니다
> 이 숫자들을 현재 할당 범위나 최대 Service 개수의 근거로 합치지 않습니다

이행의 동기는 [KEP-1880](https://github.com/kubernetes/enhancements/blob/0c8d11e9a13e12d2ef75d2d78af5ac00d8189046/keps/sig-network/1880-multiple-service-cidrs/README.md), 현재 상한 분기는 [validateClusterIPFlags](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kube-apiserver/app/options/validation.go)에 근거합니다

## repair는 주소 기록을 고치며 Service의 주소를 바꾸지 않습니다

Service 쓰기가 실패하면 앞에서 만든 IPAddress의 해제를 시도합니다
정상적인 Service 삭제 뒤에도 저장소의 afterDelete 경로가 주소를 반환합니다
그러나 현재 IPAddress 해제 구현은 삭제 오류를 로그에 남기고 nil을 반환하는 호환 동작이 있으므로 해제 호출의 종료만으로 실제 삭제까지 증명할 수 없습니다

RepairIPAddress는 Service의 clusterIPs와 IPAddress의 parentRef를 양방향으로 대조합니다

| 방향 | 현재 복구 범위 |
|---|---|
| Service → IPAddress | 주소 기록이 없으면 생성, 잘못된 참조·라벨은 조건을 대조해 삭제·재생성 |
| IPAddress → Service | 할당기 관리 라벨의 주소 기록이 실제 Service와 연결되는지 확인하고 누수·잘못된 참조 정리 |

역방향 누수 정리는 `managed-by: ipallocator.k8s.io`인 오브젝트만 대상으로 합니다
Service가 실제로 쓰는 주소의 기록을 확인하는 순방향 보정과 이 라벨 제한을 구분해야 합니다
다른 관리자의 모든 주소를 무조건 삭제하거나, 어느 경로에서도 절대 건드리지 않는다고 일반화할 수는 없습니다

### 유예 시간은 잘못된 참조의 조건마다 다릅니다

Service가 없을 때는 IPAddress의 생성 시각으로부터 60초를 넘기기 전까지 누수로 지우지 않습니다
주소 기록이 Service보다 먼저 생기는 정상 구간을 보호하기 위해서입니다
ExternalName Service를 주소가 필요한 타입으로 바꾸는 중의 일부 불일치에도 60초 보호가 있습니다

또 IPAddress가 기존 Service보다 나중에 생겼고 생성 뒤 5초 미만이면 별도로 재예약합니다
트랜잭션 되돌리기와 repair가 경합해 불필요한 `IPAddressWrongReference` 경고를 내는 것을 막기 위해서입니다
따라서 모든 잘못된 참조를 발견한 뒤 60초에 삭제하는 규칙이 아닙니다
컨트롤러의 큐 처리와 재시도도 있으므로 이 값은 관측한 전체 복구 시간과 구분합니다

한 주소를 두 Service가 쓰거나 주소가 어느 ServiceCIDR에도 속하지 않는 상황은 Service를 자동 재주소화해 고치지 않습니다
`ClusterIPAlreadyAllocated` 또는 `ClusterIPOutOfRange` Event와 재생성 안내를 남깁니다
repair가 만드는 변경은 IPAddress 쪽이며, 정상적인 기존 ClusterIP를 임의로 교체하는 컨트롤러가 아닙니다

복구 조건과 유예는 [RepairIPAddress.syncService·syncIPAddress](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/service/ipallocator/controller/repairip.go)에 있습니다

## 생성 충돌과 저장 뒤의 불일치는 다른 문제입니다

| 증상 | 구분할 위치 |
|---|---|
| provided IP is already allocated | 주소 이름의 IPAddress Create 충돌, parentRef 확인 |
| range is full | 동적 할당이 시도할 대역·구간의 여유 및 준비 상태 확인 |
| 지정 주소가 범위와 맞지 않음 | 준비된 대역 탐색과 개별 할당기의 유효 주소 검사 구분 |
| allocator not ready | 개별 할당기 준비 상태·IPAddress informer 동기화 |
| ServiceCIDR 삭제가 끝나지 않음 | finalizer, Terminating 조건, 다른 대역이 덮지 않는 주소 |
| Service는 있는데 주소 기록이 없음 | ClusterIPNotAllocated와 순방향 repair |
| 저장된 두 Service가 같은 주소를 사용 | ClusterIPAlreadyAllocated, 자동 재주소화 범위 밖 |
| 기본 대역과 플래그가 다름 | KubernetesDefaultServiceCIDRInconsistent, 기본 대역 컨트롤러의 보정 한계 |

새 생성 요청의 충돌은 주소 이름의 Create가 막습니다
이미 저장된 상태의 불일치는 repair가 발견하지만, Service의 주소까지 모두 바꿔 해결하지는 않습니다
실제 클러스터의 할당 상태·사용 범위·gate 설정·복구 결과는 이 글에서 확인하지 않았습니다

## 참고 자료

- [Service IP 대역 확장](https://kubernetes.io/docs/tasks/network/extend-service-ip-ranges/)과 [현재 IPAddress 할당 추적](https://kubernetes.io/docs/reference/networking/virtual-ips/#ip-address-objects)
- [ClusterIP 정적·동적 구간](https://kubernetes.io/docs/concepts/services-networking/cluster-ip-allocation/)과 [기본 대역 재구성](https://kubernetes.io/docs/tasks/network/reconfigure-default-service-ip-ranges/)
- [기본 ServiceCIDR 컨트롤러](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controlplane/controller/defaultservicecidr/default_servicecidr_controller.go)와 [v1 REST 등록](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/networking/rest/storage_settings.go)
