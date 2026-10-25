---
title: "informer — 로컬 사본은 언제부터 믿을 수 있을까요?"
excerpt: "Reflector와 변경 큐, Indexer가 로컬 사본을 유지하는 과정을 살펴봅니다. 초기 동기화와 핸들러 처리 완료, resync와 새 snapshot의 차이를 구분합니다"
category: kubernetes
tags: [Kubernetes, Informer, client-go, Controller, concept]
series:
  name: "k8s-theory-api"
  order: 12
date: "2026-08-09"
---

컨트롤러는 판단할 때마다 API 서버에 같은 목록을 요청하지 않습니다
서버의 상태를 로컬에 복사해 두고, informer가 유지하는 사본을 읽습니다

그런데 빈 캐시를 읽었다고 오브젝트가 없다고 결론 내릴 수는 없습니다
처음 채우는 중일 수도 있고, 서버의 변경이 아직 도착하지 않았을 수도 있습니다
초기 동기화와 이후 전달 지연을 나눠 봐야 하는 이유입니다
컨트롤러는 알림에 담긴 사건만 실행하는 대신, 처리할 차례에 사본의 현재 상태를 다시 판단합니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 객체 이름과 변경 순서는 설명을 위한 가정이며, 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## 서버에서 읽고, 큐를 거쳐, 캐시에 반영합니다

informer에서는 **Reflector**가 서버에서 받은 변경을 **큐**에 넣습니다
큐의 소비자는 변경을 꺼내 처리하고 오브젝트를 **Indexer**에 저장합니다
Indexer는 키 조회와 함께 인덱스를 통한 조회도 제공하는 로컬 캐시입니다
캐시를 갱신한 뒤에는 등록된 이벤트 핸들러에 알립니다
핸들러는 컨트롤러가 다시 판단할 대상을 작업 큐에 넣고, 워커는 그 대상의 현재 상태를 캐시에서 읽습니다

![Reflector가 초기 snapshot과 watch 변경을 큐에 전달하고, 소비자가 Indexer를 갱신한 뒤 핸들러에 알리는 흐름](/diagrams/k8s-theory-informer-1.svg)

처음에는 전체 상태를 담은 snapshot이 필요합니다
v1.37.1의 client-go는 `WatchListClient`가 기본으로 켜져 있어 streaming list를 먼저 사용할 수 있습니다
초기 `ADDED` 이벤트를 임시 저장소에 모으고, 초기 상태의 끝을 알리는 `BOOKMARK`를 받으면 결과를 변경 큐의 `Replace()`에 전달합니다
이후에는 같은 watch 연결을 이어 사용합니다

streaming list가 지원되지 않거나 해당 경로에서 폴백할 오류가 반환되면 일반 LIST로 초기 상태를 받습니다
재시도 가능한 오류는 streaming list 안에서 다시 시도할 수 있으므로, 모든 오류가 즉시 일반 LIST로 바뀌는 것은 아닙니다
두 초기화 경로 모두 `Replace()`를 거치며, 이후 변경은 watch로 받습니다

두 초기화 경로를 선택하는 분기는 [`Reflector.ListAndWatchWithContext`와 `watchList`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/tools/cache/reflector.go)에 있습니다
커서와 `410 Gone` 이후의 번호 선택은 [watch 글](/essays/k8s-theory-watch)에서 다뤘습니다

## 초기 동기화와 핸들러 처리 완료는 다릅니다

컨트롤러는 초기 snapshot이 로컬 캐시에 반영되기 전에 워커를 시작하면 안 됩니다
아직 보이지 않는 자식을 0개로 세고, 이미 존재하는 Pod를 부족한 수만큼 다시 만들 수 있기 때문입니다

ReplicaSet 컨트롤러는 Pod와 ReplicaSet 캐시의 동기화를 모두 기다린 뒤 워커를 시작합니다
여기서 사용하는 `WaitForNamedCacheSyncWithContext`는 `WaitForCacheSync`를 감싸며, 상태를 100ms마다 확인합니다

```text
Waiting for caches to sync
Caches are synced
```

위 문구는 소스에 정의된 판별용 로그이며 실습에서 수집한 출력은 아닙니다
동기화를 기다리다가 실행 context가 취소되면 성공으로 넘어가지 않습니다

캐시 갱신 이후 등록 핸들러로 알림을 보내는 일은 비동기입니다
**informer의 `HasSynced()`가 true여도 각 핸들러의 초기 이벤트 처리가 끝났다는 뜻은 아닙니다**
핸들러가 만든 별도 상태까지 기다려야 한다면 `AddEventHandler`가 반환한 등록 핸들의 `HasSynced()`도 확인해야 합니다

v1.37.1에는 `HasSyncedChecker()`의 완료 채널을 기다리는 `WaitFor`도 있습니다
기존 `WaitForCacheSync`의 폴링과 다른 대기 방식이며, 어느 대기를 쓰든 캐시 동기화와 개별 핸들러 동기화를 구분해야 합니다
계약과 구현은 [`SharedInformer`·`ResourceEventHandlerRegistration`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/tools/cache/shared_informer.go)에 있습니다

초기 동기화는 시작할 때의 빈 사본 문제를 줄입니다
그 뒤의 모든 읽기가 API 서버의 최신 상태라는 보장까지 주지는 않습니다

## 자식의 이벤트로 부모의 키를 찾습니다

Pod 이벤트가 들어와도 ReplicaSet의 작업 큐에는 대개 부모 ReplicaSet의 키가 들어갑니다
핸들러는 `ownerReferences` 중 `controller: true`인 참조를 읽고 다음 순서로 부모를 찾습니다

1. 참조가 가리키는 Kind가 맞는지 확인합니다
2. 같은 namespace에서 참조의 이름으로 ReplicaSet을 조회합니다
3. 조회한 ReplicaSet의 UID가 참조의 UID와 같은지 확인합니다
4. 일치하면 부모의 `namespace/name` 키를 작업 큐에 넣습니다

이름이 같아도 UID가 다르면 과거 부모의 이벤트로 새 부모를 깨우지 않습니다

소유자가 없는 Pod는 이벤트 종류에 따라 다르게 처리합니다
**고아 Pod의 add**, 또는 라벨·controller 참조가 바뀐 **update**는 selector가 맞는 ReplicaSet들을 깨워 입양을 검토하게 합니다
반면 **고아 Pod의 delete는 무시합니다**
이미 사라진 고아를 입양할 필요가 없기 때문입니다

이 차이는 [`addPod`·`updatePod`·`deletePod`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/replicaset/replica_set.go)에 명시돼 있습니다
고아 Pod의 모든 이벤트가 같은 부모 조회 경로를 타는 것은 아닙니다

소유 관계가 두 단계라면 조회와 UID 검증도 두 번 필요합니다
Deployment 컨트롤러의 [`getDeploymentForPod`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/deployment/deployment_controller.go)는 Pod의 ReplicaSet을 찾고 UID를 검증한 뒤, 그 ReplicaSet의 Deployment를 다시 찾고 UID를 검증합니다

## 변경 알림은 현재 상태를 다시 볼 계기입니다

informer를 사용하는 컨트롤러는 사건 하나의 처리보다 [현재 상태를 원하는 상태에 맞추는 작업](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/architecture/controller.md)을 반복합니다
이를 **level-triggered 조정**이라고 부릅니다
이벤트가 판단에 필요한 모든 정보를 담아야 하는 edge-triggered 방식과 달리, 키가 다시 처리되면 그때의 사본을 읽고 원하는 상태와 비교합니다

다만 사본이 따라잡고 해당 키가 다시 처리된다는 조건이 필요합니다
어떤 오류가 나도 자동으로 수렴한다는 무조건적인 보장은 아닙니다
같은 키가 여러 번 처리돼도 의도한 상태를 더 어긋나게 만들지 않도록 조정 작업을 설계해야 합니다

## Indexer는 자식과 입양 후보를 따로 찾습니다

Indexer는 오브젝트의 값에서 조회용 키를 만들어 역인덱스를 유지합니다
ReplicaSet 컨트롤러가 Pod informer에 추가하는 `podController` 인덱스가 한 예입니다

| Pod 상태 | 인덱스 키 | 조회하는 대상 |
|---|---|---|
| controller 참조가 있음 | `<namespace>/<Kind>/<Name>/<UID>` | 특정 부모가 소유한 자식 |
| controller 참조가 없음 | `<namespace>` | 같은 namespace의 입양 후보 |

가령 `default` namespace의 ReplicaSet `web`이 UID `aaa`를 가진다고 가정하면, 자식 키는 `default/ReplicaSet/web/aaa`입니다
고아 Pod는 `default`라는 별도 키로 찾습니다

`FilterPodsByOwner`는 자기 자식 키와, 필요할 때 고아 키를 각각 조회합니다
이렇게 찾으면 매번 namespace의 모든 Pod를 가져와 소유자를 검사할 필요가 줄어듭니다
노드 이름으로 Pod를 묶는 `spec.nodeName` 인덱스도 별도로 정의돼 있습니다

이 키의 구성과 조회는 [`PodControllerIndexKey`와 `FilterPodsByOwner`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/controller_utils.go)에 있습니다
이름과 UID를 함께 쓰는 이유는 [같은 이름의 다른 오브젝트를 구분하기 위해서](/essays/k8s-theory-object-identity-ownership)입니다

## 기본 큐와 DeltaFIFO를 구분해야 합니다

v1.37.1의 shared informer는 기본으로 **RealFIFO**를 사용합니다
`InOrderInformers`는 v1.36부터 GA이고 기본값 true로 잠겨 있습니다
소스에 DeltaFIFO를 선택하는 분기가 남아 있다고 해서 현행 기본 큐를 DeltaFIFO로 설명하면 맞지 않습니다

또한 `AtomicFIFO`는 v1.36부터 Beta·기본 true입니다
이 경로의 `Replace()`는 전체 snapshot을 `ReplacedAll`이라는 하나의 변경으로 넘기고, 소비 단계에서 캐시를 교체합니다
`Resync()`도 `SyncAll`로 표현합니다

[`newQueueFIFO`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/tools/cache/controller.go)와 [client-go 기능 기본값](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/features/known_features.go)을 함께 확인해야 실제 처리 경로가 정해집니다
아래의 DeltaFIFO 설명은 기본 RealFIFO와 구분해서 읽어야 합니다

DeltaFIFO는 같은 `namespace/name` 키의 변경을 `Deltas` 목록에 모읍니다
예를 들어 한 키에 `Added`, `Updated`, `Updated`가 차례로 쌓이면 `Pop()`은 마지막 변경 하나가 아니라 목록 전체를 전달합니다
오래된 변경이 앞에 있고 최신 변경이 뒤에 있습니다

반면 RealFIFO는 전달된 변경의 순서를 유지합니다
기본 활성인 배치 처리에서는 함께 처리할 수 있는 변경을 묶을 수도 있습니다
따라서 “키마다 변경 목록이 하나 있다”는 DeltaFIFO의 설명을 모든 informer의 내부 구조로 일반화하면 안 됩니다

자료구조와 소비 방식은 [`DeltaFIFO.Pop`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/tools/cache/delta_fifo.go), [`RealFIFO.Pop`·`PopBatch`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/tools/cache/the_real_fifo.go)에서 확인할 수 있습니다

### 큐가 초기 반영 완료를 판정하는 시점

큐의 초기 동기화 판정도 구현별로 읽어야 합니다
DeltaFIFO는 처음 `Replace()`가 넣은 키 수와 합성 삭제 수를 `initialPopulationCount`에 기록합니다
소비하면서 이 수를 줄이고, `populated && initialPopulationCount == 0`이면 동기화된 것으로 표시합니다
`Replace()` 전에 `Add`·`Update`·`Delete` 등이 먼저 호출된 경우의 별도 계약도 있어, 이 공식을 일반적인 초기 LIST 경로와 구분해야 합니다

기본 RealFIFO는 `Pop` 또는 `PopBatch`의 **처리 콜백이 끝난 뒤** 초기 개수를 줄입니다
따라서 “HasSynced는 어떤 처리도 끝나기 전 단순히 꺼냈다는 뜻”이라고 설명하는 것도 현행 기본 경로에는 맞지 않습니다


### 큐의 변경 종류와 소비자 콜백은 일치하지 않을 수 있습니다

`processDeltas`에서 `Sync`, `Replaced`, `Added`, `Updated`는 같은 갱신 경로를 탑니다
캐시에 키가 있으면 update, 없으면 add로 전달하고, `Deleted`는 별도로 처리합니다
원래 받은 이벤트의 종류만으로 소비자 콜백이 정해지는 것은 아닙니다

## 놓친 삭제는 새 snapshot에서 찾습니다

watch가 끊긴 사이 Pod `c`가 삭제됐고 그 변경 이력도 사라졌다고 가정하겠습니다
로컬 사본에는 `a`, `b`, `c`가 남아 있지만 새 snapshot에는 `a`, `b`만 있습니다
이 차이를 비교하면 로컬 사본에서 `c`를 제거해야 한다는 것을 알 수 있습니다

![새 snapshot은 사라진 c를 발견하지만 로컬 상태만 다시 순회하는 resync는 c의 실제 삭제를 알 수 없는 비교](/diagrams/k8s-theory-informer-2.svg)

DeltaFIFO의 `Replace()`는 아직 큐에 있는 키와 `KnownObjects`의 키를 새 snapshot과 비교합니다
새 목록에 없는 기존 키에는 `DeletedFinalStateUnknown`을 담은 삭제 델타를 만듭니다
기본 AtomicFIFO 경로에서는 [`processReplacedAllInfo`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/tools/cache/controller.go)가 소비 단계에서 차이를 구하고 캐시 전체를 교체한 뒤 삭제·추가·수정 알림을 만듭니다
같은 복구 목적이지만 차이를 계산하는 위치는 다릅니다

`DeletedFinalStateUnknown`은 삭제 시점의 최종 상태를 모른다는 표시이며 tombstone이라고도 부릅니다
그 안의 `Obj`에는 마지막으로 알던 오브젝트가 들어갑니다
조회 오류 등으로 오브젝트를 얻지 못한 경우에는 nil일 수도 있습니다

삭제 핸들러가 `*v1.Pod`만 받는다고 가정하면 이런 알림을 놓칩니다
ReplicaSet의 `deletePod`는 tombstone을 풀고 `Obj`가 Pod인지 다시 확인합니다
타입이 맞지 않으면 다음과 같은 오류를 보고합니다

```text
couldn't get object from tombstone
tombstone contained object that is not a pod
```

마지막으로 알던 값이 삭제 직전의 상태와 같지는 않을 수 있습니다
그 사이 라벨이나 소유 관계가 바뀌었다면 올바른 새 부모를 즉시 깨우지 못할 수 있습니다
ReplicaSet 소스 주석도 낡은 라벨 때문에 새 ReplicaSet이 periodic resync까지 깨어나지 못할 수 있다고 설명합니다

삭제된 오브젝트는 API 서버에서 다시 읽을 수 없습니다
그 객체의 다음 변경을 기다리는 것만으로는 부모가 재처리되지 않으므로, 새 snapshot에서 사라진 키를 찾아 삭제 알림을 만들어야 합니다

## resync는 서버에서 다시 읽는 작업이 아닙니다

resync는 이미 가진 로컬 상태를 다시 처리하게 합니다
API 서버에서 새 snapshot을 받는 재-LIST나 streaming list와 다릅니다

| 작업 | 읽는 곳 | 놓친 삭제를 발견할 수 있는가 |
|---|---|---|
| 새 snapshot과 교체 | API 서버 | 기존 키와 새 목록을 비교해 발견 |
| resync | 현재 로컬 캐시 | 서버에서 사라졌다는 새 정보는 얻지 못함 |

DeltaFIFO의 `Resync()`는 `KnownObjects`의 키 중 이미 변경이 대기 중인 키를 건너뛰고 `Sync` 델타를 넣습니다
AtomicFIFO의 `SyncAll`은 소비 시점의 캐시를 순회해 `OnUpdate(obj, obj)`로 전달합니다
둘 다 API 서버에 새 목록을 요청하는 동작은 아닙니다

shared informer는 old와 new의 `resourceVersion`이 같으면 sync 알림으로 취급합니다
이 알림은 모든 리스너가 아니라 resync가 필요한 리스너에게 분배합니다
핸들러가 같은 번호의 update를 무시할 수도 있으므로, resync 호출과 실제 조정 작업의 수행도 구분해야 합니다

[`Reflector.startResync`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/tools/cache/reflector.go), [`DeltaFIFO.Resync`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/tools/cache/delta_fifo.go), [`sharedIndexInformer.OnUpdate`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/tools/cache/shared_informer.go)가 각 경계를 보여 줍니다

kube-controller-manager의 `--min-resync-period` 기본값은 12시간입니다
이 설정을 사용하는 `ResyncPeriod`는 최소값의 1배 이상 2배 미만에서 무작위 주기를 뽑으므로 기본 범위는 12시간 이상 24시간 미만입니다
여러 컨트롤러의 전체 순회 시점이 겹치지 않도록 분산하는 방식입니다
모든 informer가 이 범위를 쓰는 것은 아닙니다

기본값은 [controller-manager 설정](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/controller-manager/config/v1alpha1/defaults.go), 계산은 [`ResyncPeriod`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kube-controller-manager/app/controllermanager.go)에 있습니다
이미 시작된 informer에 현재 확인 주기보다 짧은 resync를 요청하면 그 확인 주기까지 올려 맞춥니다
주기를 짧게 요청했는데 적용되지 않는 상황은 핸들러 등록 시점과 함께 확인해야 합니다

## informer를 공유해도 핸들러의 비용은 남습니다

같은 shared informer factory에 같은 Go 오브젝트 타입을 요청하면 informer 인스턴스를 재사용합니다
[`InformerFor`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/informers/factory.go)의 맵 키는 GVK 문자열이 아니라 `reflect.TypeOf(obj)`입니다
팩토리가 다르거나 informer를 따로 만들었다면 같은 리소스를 보더라도 연결과 캐시는 별개입니다

하나의 informer에는 핸들러 여러 개를 등록할 수 있습니다
각 리스너에는 1,024개에서 시작해 필요하면 커지는 알림 버퍼가 있습니다
느린 핸들러의 처리 완료를 다른 핸들러가 함께 기다리지 않도록 분리한 구조입니다

그 대신 한 핸들러가 알림을 계속 소화하지 못하면 그 리스너의 버퍼가 자랍니다
[`processorListener`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/tools/cache/shared_informer.go)의 버퍼에는 크기 상한이 없으므로, 캐시 객체 수만으로 informer의 메모리 사용량을 설명할 수 없습니다

## 어느 단계에서 지연됐는지 구분합니다

| 증상 | 먼저 확인할 경계 |
|---|---|
| `Waiting for caches to sync` 뒤로 진행하지 않음 | 초기 LIST 또는 streaming list 오류, 해당 리소스의 list/watch 권한, 실행 context |
| 기동 직후 자식을 과도하게 생성 | 초기 동기화 전에 워커를 시작했는지 |
| tombstone 타입 오류 | 삭제 핸들러가 `DeletedFinalStateUnknown`과 nil·다른 타입을 처리하는지 |
| 새 부모의 조정이 늦음 | 낡은 tombstone, 부모를 깨울 다른 이벤트와 resync 설정 |
| 메모리는 늘지만 캐시 객체 수는 비슷함 | 리스너별 핸들러 처리 지연과 알림 버퍼 |

초기 동기화를 마친 뒤에도 방금 보낸 쓰기가 캐시에 아직 보이지 않을 수 있습니다
그 시간차를 다루는 expectations와 워크큐의 동시성 제어는 [reconcile 글](/essays/k8s-theory-reconcile)에서 이어집니다
