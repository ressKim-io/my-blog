---
title: "이름·UID·ownerReferences — 같은 이름이어도 같은 소유자는 아닙니다"
excerpt: "이름과 UID가 구분하는 대상을 살펴보고, ownerReferences의 권한·namespace 제약과 garbage collector의 소유자 판정·감시 범위를 확인합니다"
category: kubernetes
tags: [Kubernetes, UID, ownerReferences, GarbageCollection, concept]
series:
  name: "k8s-theory-api"
  order: 8
date: "2026-08-03"
---

이름이 `web`인 ReplicaSet을 지웠다가 같은 이름으로 다시 만들었다고 가정하겠습니다
이전 ReplicaSet의 Pod가 남아 있다면, 그 Pod는 새 ReplicaSet의 자식이 될까요?

이름이 같다는 것만으로 소유 관계가 이어지지는 않습니다
자식의 `metadata.ownerReferences`에는 소유자의 이름뿐 아니라 UID도 들어 있습니다
garbage collector(GC)는 소유 관계를 따라 불필요해진 객체를 정리하는 컨트롤러이며, 이름으로 찾은 객체의 UID까지 대조합니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 아래 객체와 UID는 설명을 위한 가정이며, 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## 이름은 현재 객체를 찾고 UID는 같은 개체인지 확인합니다

이름은 같은 API group·resource·namespace 안에서 현재 존재하는 객체를 구분합니다
클러스터 범위 리소스라면 namespace 없이 이름이 유일합니다
같은 리소스를 다른 API version으로 요청하더라도 이름의 유일성 범위가 나뉘지는 않습니다

삭제된 이름은 다시 사용할 수 있습니다
그래서 오래 남는 참조에는 같은 이름의 과거 객체와 새 객체를 구분할 값이 필요합니다
서버가 부여하는 `metadata.uid`는 UUID이며, 클러스터 수명 전체에 걸쳐 서로 다른 객체를 구별합니다

![같은 이름의 ReplicaSet을 다시 만들어도 이전 자식의 ownerReference UID는 새 ReplicaSet UID와 일치하지 않는 흐름](/diagrams/k8s-theory-object-identity-ownership-1.svg)

그림에서 이전 Pod의 참조는 UID `aaa`를 가리킵니다
GC가 이름 `web`으로 찾은 ReplicaSet의 UID가 `bbb`라면, 참조하던 소유자는 없는 것으로 분류합니다
새 객체가 존재한다는 사실이 이전 소유자의 존재를 대신하지는 못합니다

이 구분은 [Object Names and IDs](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/overview/working-with-objects/names.md)와 [`ObjectMeta.UID`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/apis/meta/v1/types.go)에 설명돼 있습니다

## 소유 관계는 자식의 ownerReferences에 적습니다

부모가 자식 목록을 저장하는 대신, 자식이 자기 `metadata.ownerReferences`에 소유자를 기록합니다
소유자는 여러 개일 수 있지만 관리 주체를 뜻하는 `controller: true` 참조는 하나만 허용됩니다

| 필드 | 역할 |
|---|---|
| `apiVersion`·`kind`·`name`·`uid` | 소유자의 종류와 이름으로 조회하고 UID까지 일치하는지 확인 |
| `controller` | 이 참조가 관리 컨트롤러를 가리키는지 표시 |
| `blockOwnerDeletion` | foreground 삭제 중 이 자식의 참조가 부모 삭제를 막을 수 있는지 표시 |

foreground 삭제는 부모를 API에 남겨 둔 채 자식 처리를 기다리는 방식입니다
이때 부모의 `foregroundDeletion` finalizer가 삭제 완료를 기다리게 합니다
`blockOwnerDeletion: true`인 자식이라도 GC 캐시에 있어야 부모 삭제를 보류시킬 수 있습니다
background 삭제에는 같은 대기 조건이 적용되지 않으며, 아직 관찰하지 못한 자식까지 기다린다는 보장도 없습니다

이 범위는 [`OwnerReference`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/apis/meta/v1/types.go)와 [foreground garbage collection 설명](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/architecture/garbage-collection.md#foreground-cascading-deletion)을 기준으로 합니다

### 왜 자식 쪽에 기록할까요?

자식이 소유자를 기록하면 소유 관계를 각 자식에서 독립적으로 바꿀 수 있습니다
반대로 부모가 자식 목록을 가진다고 가정하면, 자식을 만들 때마다 같은 부모를 수정해야 하고 목록도 계속 커집니다
자식 쪽에 참조를 두면 이 쓰기가 여러 객체로 나뉩니다

대신 부모에 속한 자식을 찾으려면 자식들의 `ownerReferences`에서 그 부모를 가리키는 참조를 찾아야 합니다
GC는 메모리에 소유 그래프를 유지하고, 컨트롤러도 부모에 대응하는 자식을 찾을 수 있도록 인덱스를 둡니다
label selector와 소유자 참조도 구분해야 합니다
selector는 label 조건에 맞는 대상을 고르며, `ownerReferences`는 특정 개체와의 소유 관계를 가리킵니다
ReplicaSet 같은 컨트롤러가 둘을 함께 사용하더라도, selector에 맞는 모든 객체가 자동으로 소유 관계를 갖는 것은 아닙니다

label과 annotation은 둘 다 객체에 붙이는 문자열 키·값입니다
label은 selector로 객체 집합을 고르는 데 쓸 수 있지만, annotation은 API의 label selector 대상이 아닙니다
어느 쪽도 이름·UID처럼 객체의 유일성을 보장하거나, `ownerReferences`처럼 소유 관계를 만들지는 않습니다

## 소유자와 자식의 namespace에는 제약이 있습니다

namespace 범위의 자식은 같은 namespace의 소유자 또는 클러스터 범위 소유자를 가리킬 수 있습니다
클러스터 범위의 자식은 클러스터 범위 소유자만 가리킬 수 있습니다

`ownerReferences`에는 namespace 필드가 없습니다
GC는 namespace 범위의 소유자를 자식과 같은 namespace에서 조회하고 UID를 비교합니다
다른 namespace에 실제 소유자가 있더라도 이 조회에서 NotFound가 나오면 소유자가 없는 참조로 분류합니다
이름이 같은 객체를 찾았지만 UID가 다른 경우도 마찬가지입니다

| 상황 | GC의 판단 |
|---|---|
| 소유자 조회가 NotFound | 참조하던 소유자 부재 |
| 이름으로 찾은 객체의 UID가 다름 | 참조하던 소유자 부재 |
| 클러스터 범위 자식이 namespace 범위 소유자를 참조 | 해석할 수 없는 잘못된 관계. 부재를 근거로 한 삭제와 구분 |
| timeout·권한 오류·API 종류를 실제 리소스로 매핑하는 과정의 오류 | 부재로 확정하지 않고 해당 항목을 재시도 |

클러스터 범위 자식의 잘못된 참조는 반복 조회만으로 해결될 오류가 아니므로, 해당 작업을 같은 방식으로 계속 재시도하지 않습니다
그렇다고 GC 전체 워커가 멈추는 것은 아닙니다

GC가 잘못된 namespace 참조를 감지하면 `OwnerRefInvalidNamespace` 경고 Event를 남깁니다
다만 단순한 UID 불일치나 NotFound마다 이 Event가 생기지는 않습니다
Event가 없다는 이유만으로 소유 관계가 유효하다고 판단할 수도 없습니다

이 내용은 [Owners and Dependents의 범위 규칙](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/overview/working-with-objects/owners-dependents.md), [`isDangling`·`attemptToDeleteWorker`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/garbagecollector/garbagecollector.go), [`reportInvalidNamespaceOwnerRef`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/garbagecollector/graph_builder.go)를 대조했습니다

`ownerReferences`에 namespace 필드가 없다는 사실만으로 저장할 때 어떤 소유 관계 검사까지 가능한지 판단할 수는 없습니다
객체 구조의 검증과 admission 정책, GC의 현재 소유자 조회는 서로 다른 단계입니다
저장할 때 참조가 유효했더라도 소유자는 나중에 삭제되거나 같은 이름으로 재생성될 수 있습니다

## 소유자가 여럿이면 각 참조를 분류합니다

GC는 최신 `ownerReferences`를 읽고 각 소유자의 존재와 삭제 상태를 확인합니다

| 분류 | 조건 |
|---|---|
| `solid` | 소유자가 존재하며 자식 삭제를 기다리는 상태가 아님 |
| `dangling` | NotFound 또는 UID 불일치로 소유자 부재가 확인됨 |
| `waitingForDependentsDeletion` | 소유자가 삭제 중이며 `foregroundDeletion` finalizer를 가짐 |

`solid`가 하나라도 있으면 GC는 소유자 부재를 이유로 자식을 삭제하지 않습니다
사용자의 DELETE나 다른 컨트롤러가 시작한 삭제까지 막는다는 뜻은 아닙니다

자식을 보존하더라도 `dangling`과 `waitingForDependentsDeletion` 참조는 patch로 제거합니다
다른 solid 소유자가 있어 자식을 남길 경우, 그 자식 때문에 foreground 삭제 중인 부모까지 계속 남지 않도록 참조를 끊는 것입니다

소유자 참조가 처음부터 없는 객체는 이 판단만으로 삭제하지 않습니다
참조가 있는 객체에서 모든 소유자의 부재가 확인됐거나, 소유자가 자식 삭제를 기다리는 상황을 구분해야 합니다

서로를 소유자로 삼은 객체가 foreground 삭제 중이면 상대를 기다리는 순환이 생길 수 있습니다
GC에는 이 상황을 풀기 위한 감지가 있지만, 소스 주석은 오탐 가능성과 병렬 워커의 경쟁 상황에서 감지가 실패할 가능성을 명시합니다
임의의 소유 순환을 항상 해결한다고 보장하는 기능으로 읽으면 안 됩니다

판정과 참조 제거는 [`classifyReferences`·`attemptToDeleteItem`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/garbagecollector/garbagecollector.go)에 있습니다

## GC는 변경 이벤트로 소유 그래프를 유지합니다

GC는 이름이 아니라 UID를 키로 메모리 그래프를 만듭니다
각 노드는 한 객체이며, 자신을 소유자로 가리키는 자식들을 `dependents`로 관리합니다
GraphBuilder가 리소스별 list/watch 이벤트를 받아 그래프를 갱신하고 삭제·orphan 작업을 큐에 넣습니다
orphan은 부모와의 소유 관계를 끊어 자식을 남기는 처리입니다

![리소스별 list와 watch를 받은 GraphBuilder가 UID 기반 소유 그래프를 갱신하고 삭제 판정 및 orphan 작업 큐로 전달하는 구조](/diagrams/k8s-theory-object-identity-ownership-2.svg)

노드의 `beingDeleted`는 `deletionTimestamp`가 설정됐음을 나타냅니다
`deletingDependents`는 삭제 중인 객체가 `foregroundDeletion` finalizer를 갖고 자식 처리를 기다리는 상태입니다
삭제 큐의 작업을 맡은 워커는 앞에서 본 참조 분류를 수행합니다
orphan 큐의 워커는 자식들의 `ownerReferences`에서 부모 참조를 제거한 뒤 부모의 `orphan` finalizer를 없앱니다
다른 finalizer가 남아 있다면 실제 삭제는 계속 기다립니다

### 이벤트를 못 봤다는 사실은 부재의 증거가 아닙니다

자식 이벤트가 소유자 이벤트보다 먼저 오면 GraphBuilder는 소유자 자리에 `virtual` 노드를 만듭니다
이것은 아직 informer 이벤트로 관찰하지 못한 객체를 위한 자리입니다
informer는 API의 목록과 변경을 받아 로컬 사본을 유지하는 구성요소입니다

소유자 이벤트가 뒤늦게 오면 실제로 관찰한 노드로 바꿉니다
이벤트가 오지 않더라도 API 조회로 존재를 확인하며, NotFound나 UID 불일치가 확인돼야 가상 삭제 이벤트로 그 자리를 정리합니다
조회 오류를 소유자 부재와 같게 처리하지 않습니다

한 번 부재를 확인한 소유자를 매번 다시 조회하지 않도록 `absentOwnerCache`도 사용합니다
캐시에는 조회 대상을 식별하는 API version·kind·name·UID·namespace를 함께 기록합니다
UID만 같고 나머지 참조 정보가 다르면 같은 조회 결과로 취급하지 않으며, 접근 오류를 부재로 저장하지도 않습니다

그래프의 상태와 처리 경로는 [`node` 정의](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/garbagecollector/graph.go), [`addDependentToOwners`·`processGraphChanges`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/garbagecollector/graph_builder.go), [`isDangling`·`attemptToOrphanWorker`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/garbagecollector/garbagecollector.go)를 기준으로 합니다

## DELETE에도 개체를 확인하는 조건을 넣을 수 있습니다

삭제 요청의 `DeleteOptions.Preconditions.uid`에 UID를 지정하면, 서버는 현재 객체의 UID와 비교합니다
kubelet도 Pod 종료를 마친 뒤 API 객체를 최종 삭제할 때 이 조건을 넣습니다
그 사이 같은 이름과 namespace로 새 Pod가 생겼더라도, UID가 다르면 새 Pod를 지우지 않고 `409 Conflict`를 반환합니다

다음은 실측 로그가 아니라 소스에 정의된 UID 불일치 오류의 문구입니다

```text
the UID in the precondition (...) does not match the UID in record (...).
The object might have been deleted and then recreated
```

`DeleteOptions.Preconditions.resourceVersion`도 지정할 수 있습니다
UID로는 같은 이름을 가진 다른 객체인지 구분하고, [resourceVersion](/essays/k8s-theory-resource-version)으로는 같은 객체가 조회 이후 바뀌었는지 확인합니다

근거는 [`BeforeDelete`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/registry/rest/delete.go)와 [kubelet의 `NewUIDPreconditions` 사용](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/status/status_manager.go)입니다

## 참조를 바꿀 권한과 부모 삭제를 막을 권한은 다릅니다

`OwnerReferencesPermissionEnforcement`는 소유자 참조 변경에 추가 권한을 검사하는 validating admission 플러그인입니다
확인한 v1.37.1의 기본 활성 플러그인 목록에는 포함되지 않습니다
실제 서버에서 활성화했다면 다음 검사가 적용됩니다

| 변경 | 검사하는 권한 |
|---|---|
| 기존 객체의 `ownerReferences` 변경 | 자식 객체 자체의 `delete`. CREATE에서는 이 검사를 건너뜀 |
| 새 blocking 참조 추가 또는 `blockOwnerDeletion`을 false·nil에서 true로 변경 | 부모 리소스의 `finalizers` 하위 리소스에 대한 `update` |
| 기존 true 값을 유지 | 새 blocking 참조 검사의 대상은 아님. 참조 목록 자체를 바꾸면 앞의 자식 delete 검사는 별도로 적용 |

두 번째 검사는 부모의 finalizer를 실제로 수정하지 않습니다
부모 삭제를 지연시킬 수 있는 참조를 자식에 넣을 권한이 있는지 판단하는 것입니다
모든 리소스의 finalizers에 대한 포괄적인 update 권한이 있으면 개별 리소스 매핑 전에 허용하는 경로도 있습니다
권한 판정이 Allow가 아니면 `403 Forbidden`으로 거부합니다

확인한 [개념 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/overview/working-with-objects/owners-dependents.md)에는 부모의 delete 권한이라는 설명이 남아 있습니다
여기서는 [admission 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/access-authn-authz/admission-controllers.md#ownerreferencespermissionenforcement)와 실제 [`AttributesRecord` 구현](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/plugin/pkg/admission/gc/gc_admission.go)의 `update`·`finalizers`를 따릅니다
기본 활성 여부는 [`DefaultOffAdmissionPlugins`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubeapiserver/options/plugins.go)에서 확인했습니다

종류에 관한 검증도 있습니다
[`ValidateOwnerReferences`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/api/validation/objectmeta.go)는 `controller: true` 참조가 둘 이상이면 거부하며, core 그룹의 `v1/Event`를 소유자로 지정하는 것도 금지합니다
이는 `Event`라는 이름의 모든 kind를 막는 규칙은 아닙니다
GC가 어떤 리소스를 감시할지는 별도의 기준으로 정합니다

## discovery 실패가 모든 리소스의 감시를 멈추지는 않습니다

discovery는 API 서버가 제공하는 리소스 종류와 지원 동작을 확인하는 과정입니다
GC는 discovery의 preferred resource 중 `delete`·`list`·`watch`를 모두 지원하는 타입을 고른 뒤 무시 목록을 제외합니다
기본 무시 목록에는 core와 `events.k8s.io` 그룹의 Event 리소스가 모두 들어 있습니다

GraphBuilder는 대상 리소스 타입마다 monitor를 두고 list/watch합니다
컨트롤러가 discovery를 다시 확인하는 기본 주기는 30초입니다
조회 시간·오류·monitor 구성·캐시 동기화도 필요하므로, **30초는 새 리소스의 감시 시작을 보장하는 상한이 아닙니다**

일부 API group의 discovery가 실패하면 이미 동기화된 해당 그룹의 informer를 보존합니다
새 리소스 정보를 확인하지 못하는 것과 기존 리소스의 list/watch가 멈추는 것은 다른 문제입니다
별도로 API 서버를 붙이는 aggregated API가 응답하지 않더라도, GC 전체가 멈췄다고 곧바로 단정할 수는 없습니다

동기화 오류 카운터도 discovery 오류마다 반드시 증가하지는 않습니다
기존 informer를 보존한 뒤 리소스 집합에 변화가 없으면 반환하는 경로가 있습니다
리소스 목록이 비었거나, monitor 재구성에 실패했거나, 캐시 동기화가 시간 안에 끝나지 않은 분기에서는 카운터를 증가시킵니다

감시 후보와 부분 실패 처리는 [`GetDeletableResources`·`Sync`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/garbagecollector/garbagecollector.go), 제외 목록은 [`DefaultIgnoredResources`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/garbagecollector/graph_builder.go), 30초 주기는 [controller 실행 코드](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kube-controller-manager/app/core.go)에 있습니다

## label과 annotation은 식별·소유 참조를 대신하지 않습니다

두 메타데이터의 역할뿐 아니라 저장할 수 있는 형식과 크기도 구분해야 합니다

| 항목 | label | annotation |
|---|---|---|
| 키 | 선택적 DNS 접두사와 이름 부분으로 구성된 qualified name | 소문자로 바꾼 문자열을 qualified name 규칙과 대조 |
| 값 | 63자 이하. 빈 문자열 또는 정해진 문자 형식 | 문자열의 문자 형식 제한 없음 |
| 크기 | 키·값의 개별 형식과 길이 제한 | 모든 키·값의 UTF-8 바이트 합계가 262,144 bytes 이하 |
| API label selector | 사용 가능 | 사용 불가 |

qualified name은 선택적인 DNS 접두사와 `/`, 그리고 이름 부분으로 구성됩니다
이름 부분은 63자 이하이며 영숫자로 시작하고 끝나고, 중간에 `-`·`_`·`.`을 사용할 수 있습니다
label 값도 비어 있지 않다면 같은 시작·끝 문자 조건을 따릅니다

annotation 키를 검증하면서 소문자로 바꿔 보는 것은 형식 검사 과정입니다
저장된 키를 바꾸거나, 대소문자를 구별하지 않는 키로 취급한다는 뜻은 아닙니다
값의 문자 형식이 자유로워도 문자열이라는 자료형과 전체 크기 제한, 별도의 admission 정책은 적용됩니다

전체 annotation 크기는 `TotalAnnotationSizeLimitB = 256 * 1024`로 검사합니다
`last-applied-configuration`처럼 매니페스트를 문자열로 담는 annotation도 같은 합계에 포함됩니다
한도를 넘으면 일반 ObjectMeta 검증은 `metadata.annotations`의 `Too long` 오류를 반환하며 API 요청은 `422`로 거부될 수 있습니다

근거는 [Labels and Selectors](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/overview/working-with-objects/labels.md), [Annotations](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/overview/working-with-objects/annotations.md), [`ValidateAnnotations`·`ValidateAnnotationsSize`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/api/validation/objectmeta.go)입니다

## 오류는 관계를 검사한 단계와 함께 읽습니다

| 신호 | 먼저 구분할 조건 |
|---|---|
| DELETE의 `409`와 UID precondition 불일치 | 같은 이름으로 다시 만들어진 다른 개체를 대상으로 했는지 |
| `cannot set an ownerRef on a resource you can't delete` | 플러그인이 활성화됐고, 기존 자식의 참조를 바꿀 delete 권한이 없는지 |
| `cannot set blockOwnerDeletion ... can't set finalizers on` | 부모 finalizers의 update 권한이 허용되지 않았는지 |
| `OwnerRefInvalidNamespace` | 소유자와 자식의 범위·namespace가 맞는지. Event 부재만으로 유효성을 확정하지 않음 |
| 소유 관계 처리가 늦어짐 | 해당 API의 discovery·list/watch·캐시 동기화 상태. GC 전체 장애와 구분 |
| `metadata.annotations: Too long` | 개별 annotation 값이 아니라 전체 키·값 바이트 합계가 제한을 넘었는지 |

이름으로 찾은 객체가 있다는 것, 참조한 UID의 소유자가 있다는 것, 자식의 삭제가 끝났다는 것은 각각 확인해야 할 상태입니다
GC는 현재 객체를 조회하고 소유 그래프를 갱신하면서 이 상태들을 구분합니다
실제로 삭제가 끝나는 시점은 finalizer와 삭제 정책의 조건에도 달려 있습니다
