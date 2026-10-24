---
title: "controller-runtime과 reconcile — 큐에는 이름이 들어갑니다"
excerpt: "이벤트가 이름 키로 바뀌어 Reconciler에 도달하는 과정을 따라갑니다. 큐의 직렬화·캐시·재시도와 status·finalizer의 책임을 구분합니다"
category: kubernetes
tags: ["kubernetes", "controller-runtime", "reconcile", "operator", "concept"]
series:
  name: "k8s-theory-extension"
  order: 3
date: "2026-11-03"
---

CR에 원하는 상태를 적었다고 자원이 저절로 맞춰지는 것은 아닙니다
변화를 감시하고 조정 함수를 호출하는 구성과, 관찰한 상태에서 무엇을 바꿀지 판단하는 코드가 필요합니다

controller-runtime은 감시·큐·워커와 공유 client를 제공하고 사용자가 작성한 Reconciler를 호출합니다
라이브러리가 호출을 연결해도 실제 상태를 판단하고 변경하는 책임은 조정 코드에 남습니다

> controller-runtime v0.25.2와 그 go.mod가 요구하는 client-go v0.37.0을 기준으로 공식 소스를 대조했습니다
> API·conditions 규칙은 Kubernetes v1.37.1 소스를 별도로 확인했습니다
> 실제 컨트롤러 배포·장애 재현·호출 횟수나 지연 측정은 포함하지 않습니다

## Manager는 공유 자원을, Controller는 큐를 관리합니다

세 구성 요소의 역할부터 나누면 사용자 코드가 들어가는 위치가 보입니다

| 구성 요소 | 맡는 일 |
|---|---|
| Manager | cache·client·leader election·health·metrics·webhook 서버 등 공유 자원 관리 |
| Controller | 감시 source·이벤트 처리·큐·워커 구성과 실행 |
| Reconciler | 관찰한 상태와 원하는 상태를 비교하고 API나 외부 시스템에 필요한 변경 수행 |

Manager의 cache는 같은 GVK(그룹·버전·종류), 표현 방식과 캐시 범위에서 informer를 공유할 수 있습니다
Manager 하나에 Controller를 여러 개 둘 수 있고, Controller 하나가 여러 종류의 오브젝트를 감시할 수도 있습니다

Manager에 conversion webhook을 함께 등록하는 구성도 가능합니다
이 경우 같은 프로세스가 조정과 버전 변환 요청을 함께 처리하므로 프로세스 장애가 두 기능에 영향을 줄 수 있습니다
conversion과 조정은 역할이 다르며 항상 같은 프로세스에 배치해야 하는 것은 아닙니다

## 이벤트에서 함수까지 전달되는 것은 조정할 키입니다

감시 중인 오브젝트의 이벤트는 먼저 predicate를 통과합니다
predicate는 큐에 넣을 이벤트를 거르는 함수이며, 캐시에 저장할 오브젝트의 범위를 정하는 설정과는 다릅니다

이벤트 핸들러는 통과한 이벤트를 조정할 요청으로 바꿉니다
표준 `reconcile.Request`에는 namespace와 name만 있으며 이벤트 종류·오브젝트 본문·UID는 들어 있지 않습니다

![감시 이벤트가 predicate와 핸들러를 거쳐 표준 이름 키로 바뀌고 큐와 워커를 통해 Reconciler에 전달되는 흐름|tall](/diagrams/k8s-theory-controller-runtime-reconcile-1.svg)

그래서 Pod 삭제 이벤트를 받아도 Reconciler에 ‘Pod가 삭제됐다’는 사건 정보가 그대로 전달되지는 않습니다
조정 코드는 읽은 상태에서 그 Pod가 없다는 사실을 판단합니다

이를 **level-based 조정**이라고 합니다
중간 이벤트를 하나씩 재현하는 대신 조정 시점에 관찰한 상태를 원하는 상태에 맞춥니다

큐에 기다리는 동안 상태가 더 바뀔 수 있으므로 이벤트 당시의 내용을 작업 명령처럼 소비하지 않습니다
다만 나중에 다시 읽는다는 사실만으로 조회 결과가 서버의 최신 상태가 되는 것은 아닙니다

‘이름만 들어간다’는 설명은 표준 Request 기준입니다
`TypedReconciler`는 별도의 비교 가능한 요청 타입도 허용하므로 모든 사용자 정의 큐의 값이 namespace/name으로 제한되는 것은 아닙니다. [Request와 Reconciler의 정의](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/reconcile/reconcile.go)

## 같은 키의 동시 실행을 막는 범위는 한 Controller의 큐입니다

현재 기본 큐는 controller-runtime의 우선순위 큐입니다
같은 키가 대기 중 다시 들어오면 요청을 합치고 더 이른 준비 시각과 높은 우선순위를 유지합니다

워커에 넘긴 키는 잠급니다
처리 중 같은 키가 다시 들어와 대기 항목이 생겨도 현재 호출의 `Done`이 잠금을 풀기 전에는 다른 워커에 넘기지 않습니다

`UsePriorityQueue: false`이면 client-go 큐를 사용합니다
이 큐는 같은 보장을 `dirty`와 `processing` 집합으로 만듭니다

- **`dirty`**: 다시 처리할 필요가 있는 키입니다. 이미 dirty인 키의 반복 추가는 합칩니다
- **`processing`**: 현재 워커가 처리 중인 키입니다. 처리 중 다시 추가되면 dirty로 표시하되 즉시 대기열에 넣지 않습니다
- **`Done`**: processing에서 지우고, 여전히 dirty이면 그때 대기열에 다시 넣습니다

![기본 우선순위 큐의 키 잠금과 비우선순위 client-go 큐의 dirty·processing이 처리 중 재추가된 같은 키를 직렬화하는 비교|tall](/diagrams/k8s-theory-controller-runtime-reconcile-2.svg)

따라서 이벤트 개수와 Reconcile 호출 횟수는 일치하지 않습니다
현재 호출 중 반복해서 들어온 같은 키도 대기 요청 하나로 합쳐질 수 있습니다

`MaxConcurrentReconciles`의 기본값은 1입니다
값을 올리면 서로 다른 키를 병렬로 조정할 수 있지만 같은 큐에서 같은 키를 동시에 처리하지 않는 보장은 유지됩니다

다른 Controller의 큐나 다른 프로세스까지 막는 전역 잠금은 아닙니다
이 보장을 API 읽기의 최신성이나 외부 시스템 변경의 배타성으로 확대하면 안 됩니다. [기본 큐의 병합·잠금](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/controller/priorityqueue/priorityqueue.go), [client-go의 Add·Get·Done](https://github.com/kubernetes/client-go/blob/28076445520055420e3be4255b4cd27fd19df1f9/util/workqueue/queue.go)

## Owns는 자식 이벤트를 부모의 요청으로 바꿉니다

`Owns()`는 자식 오브젝트의 이벤트에서 `ownerReferences`를 읽고 부모의 키를 큐에 넣습니다
자식 이벤트를 받았다고 그 자식 자체를 Reconcile하는 기능은 아닙니다

기본 동작에는 다음 조건이 붙습니다

- `controller: true`인 소유 참조 하나를 봅니다. 전체 소유 참조를 보려면 `builder.MatchEveryOwner`를 선택합니다
- 소유자 타입은 group과 kind로 비교합니다. UID는 표준 요청에 넣지 않습니다
- namespace는 소유 참조가 아닌 이벤트 오브젝트에서 가져옵니다
- RESTMapper가 부모를 cluster-scoped로 판단하면 namespace를 비웁니다

타입 비교에 버전을 사용하지 않아도 RESTMapper 조회에는 소유 참조의 버전이 들어갑니다
해당 버전을 매핑하지 못하면 요청을 만들지 못합니다

Update 핸들러는 옛 오브젝트와 새 오브젝트의 소유자를 모두 확인합니다
소유권이 바뀐 이벤트라면 이전 부모와 새 부모의 키가 함께 들어갈 수 있습니다

`Watches()`는 감시할 타입과 핸들러를 직접 연결하는 일반적인 형태입니다
임의의 관계로 키를 만들려면 `EnqueueRequestsFromMapFunc`를 사용할 수 있고, Owns는 소유 참조를 사용하는 경우를 묶어 제공합니다

`controller: true`는 주 관리자를 나타내는 API 관계입니다
다른 주체의 쓰기를 막는 잠금은 아니며, 모든 일반 소유자까지 깨워야 하는지는 조정기의 역할에 따라 정해야 합니다. [Owns의 연결](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/builder/controller.go), [부모 요청 생성](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/handler/enqueue_owner.go)

## 기본 client는 캐시에서 읽고 API 서버에 씁니다

Manager가 제공하는 기본 cache-backed client의 구조체 `Get`·`List`는 캐시를 읽습니다
`Create`·`Update`·`Patch`·`Delete` 같은 쓰기는 API 서버로 보냅니다

같은 client를 썼어도 쓰기 성공 직후의 캐시 조회에서 방금 만든 자식이 아직 보이지 않을 수 있습니다
이때 자식을 다시 만들도록 판단하면 중복 생성 요청이 생깁니다

부모 정보로 항상 같은 자식 이름을 만들면 같은 이름의 중복 생성 요청을 검출할 수 있습니다
`generateName`으로 매번 새 이름을 받으면 이름 충돌을 통한 이 방어가 없습니다

읽기가 항상 캐시로 가는 것은 아닙니다
`CacheOptions.DisableFor`로 제외한 타입과 기본 설정의 unstructured 오브젝트는 직접 조회합니다. 캐시를 설정하지 않은 client도 직접 조회합니다

### 같은 client의 쓰기 반영을 기다리는 옵션도 있습니다

v0.25.2에는 `CacheOptions.EnableReadYourWritesConsistency`가 있으며 기본값은 false입니다
이를 켜면 같은 client가 추적한 쓰기를 캐시가 관찰한 뒤 읽기를 진행하도록 기다리는 기능을 사용합니다

범위는 GVK와 typed·unstructured·PartialObjectMetadata 같은 표현 방식으로 나뉩니다
Get은 해당 키의 쓰기를, List는 해당 GVK·표현의 앞선 쓰기들을 기다리는 구조이며 다른 표현으로 한 쓰기까지 하나로 묶지 않습니다

`DisableReadYourWritesConsistency` 요청 옵션으로 개별 읽기·쓰기를 이 기능에서 제외할 수도 있습니다

이 기능은 실험적이며 공식 옵션 주석은 한 리소스에 여러 namespace를 설정한 경우 제대로 동작하지 않는 제한을 명시합니다
따라서 이를 전역 최신성이나 다른 client의 모든 변경까지 보장하는 기능으로 읽으면 안 됩니다

기본 캐시 지연 설명과 이 선택 기능의 적용 조건을 나눠 판단해야 합니다. [client의 캐시 분기·옵션](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/client/client.go), [쓰기 관찰 대기 구현](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/client/consistency.go)

## 반환값이 다음 조정을 예약합니다

Reconciler는 `Result`와 `error`를 반환합니다
Controller가 그 조합을 보고 재시도 여부를 결정합니다

| 반환 | 확인한 Controller의 처리 |
|---|---|
| 일반적인 non-nil error | rate limiter를 거쳐 재추가, RequeueAfter·Requeue는 무시 |
| `TerminalError` | 이 반환에 따른 재추가 없음, 에러 로그·메트릭은 남김 |
| nil error와 양수 `RequeueAfter` | 실패 횟수를 지우고 지정 시간 뒤 재추가 |
| nil error와 `Requeue: true`만 있음 | rate limiter를 거쳐 재추가, deprecated 방식 |
| 빈 결과와 nil error | 실패 횟수를 지움, 이 반환에 따른 재추가 없음 |

에러와 `RequeueAfter`를 함께 반환하면 원하는 시각 예약이 적용되지 않고 경고 로그가 남습니다
에러 재시도와 시간 예약을 동시에 지시하지 않도록 반환 의미를 나눠야 합니다

`Requeue`는 이 확인 버전에서도 deprecated입니다
외부 변화가 일어날 시각이나 폴링 간격을 알고 기다리는 경우에는 `RequeueAfter`로 의도를 표현합니다

`Forget`은 rate limiter의 실패 기록을 지우는 동작입니다
이미 큐에 대기 중인 요청이나 다른 이벤트까지 취소하지는 않습니다. TerminalError 분기에는 이 Forget 호출도 없습니다

### 백오프와 전체 처리 속도는 다릅니다

기본 우선순위 큐의 에러 재시도는 키별 지수 백오프를 사용합니다
시작은 5ms이며 상한은 1000초, 약 16분 40초입니다

우선순위 큐를 끄고 기본 client-go 리미터를 쓰면 키별 지수 백오프와 전체 10 QPS·burst 100 버킷 중 더 긴 지연을 적용합니다
이 버킷은 재시도 속도에 대한 제한이며 일반 이벤트의 Add나 모든 API 요청에 적용되는 전역 처리량 제한은 아닙니다

`RequeueAfter`와 백오프는 다음 요청을 예약하는 기능입니다
그 시각까지 다른 이벤트의 조정을 막는 장벽은 아니므로 새 이벤트가 더 일찍 키를 준비시킬 수 있습니다

기본 핸들러의 우선순위 처리에서는 초기 List의 이벤트와 옛·새 `resourceVersion`이 같은 업데이트를 낮은 우선순위 `-100`으로 다룹니다
이벤트를 버리는 predicate와도 다른 동작입니다. [기본값과 리미터 선택](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/controller/controller.go), [반환값 switch](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/internal/controller/controller.go)

### NotFound의 의미는 어떤 오브젝트를 읽었는지에 달려 있습니다

Controller가 모든 NotFound 에러를 자동으로 무시하는 것은 아닙니다
사용자 Reconciler가 그대로 반환하면 일반 에러 재시도 경로에 들어갑니다

조정 대상이 이미 없어 더 할 일이 없다고 판단했다면 `client.IgnoreNotFound(err)`로 정상 종료할 수 있습니다
ObjectReconciler를 연결하는 `AsReconciler` 어댑터도 대상 조회에서 이 처리를 사용합니다

반면 원하는 자식이 없어서 생성해야 하는 상황이라면 NotFound를 관찰하고 생성 분기로 진행해야 합니다
‘없음’을 모두 성공으로 지우는 것과 필요한 변경을 판단하는 일은 다릅니다

## status 쓰기도 다시 조정할 이벤트가 됩니다

spec은 원하는 상태, status는 관측한 상태를 담는 것이 기본 관례입니다
실제 쓰기 권한은 RBAC와 API의 subresource 구현으로 정합니다

CRD에서 `/status`를 선언한 버전은 주 자원 경로의 생성·수정으로 status를 덮어쓰지 못하게 합니다
`/status`를 선언하지 않았다면 status도 주 자원의 일반 필드로 다룰 수 있습니다

‘spec은 사용자, status는 컨트롤러’라는 설명도 독점 권한을 뜻하지 않습니다
spec은 기본값 처리로 채워지거나 HPA처럼 위임받은 컴포넌트가 변경할 수도 있으므로, 누가 어느 필드를 맡는지 구분해야 합니다

`/status` 쓰기도 같은 오브젝트의 업데이트이며 watch에 실릴 수 있습니다
매 조정마다 달라지는 값을 status에 기록하면 자기 쓰기가 다음 조정을 계속 만드는 순환이 생길 수 있습니다

`GenerationChangedPredicate`는 generation이 그대로인 Update 이벤트를 거릅니다
CR의 `/status` 변경이 generation을 올리지 않는 경우 이 업데이트에 의한 반복 호출을 줄일 수 있습니다

대신 다른 주체가 status를 지웠을 때 그 변경만으로 복구 조정을 예약하지도 못합니다
다른 감시 이벤트나 `RequeueAfter`가 있으면 다시 조정할 수 있으므로 모든 복구 가능성이 사라지는 것은 아닙니다

generation 증가 규칙은 타입과 subresource 구성에 따라 다릅니다
이 predicate를 모든 타입의 ‘spec 변경만 보기’와 같은 의미로 단정하면 안 됩니다. [generation predicate](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/predicate/predicate.go), [CR 주 자원의 status·generation 처리](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/registry/customresource/strategy.go)

## conditions는 관찰한 판정과 그 기준을 남깁니다

`metav1.Condition`은 다른 사용자·컨트롤러가 상태를 읽을 수 있게 하는 표준 형태입니다
모든 API가 이 타입을 쓰는 것은 아니며 CRD의 실제 검증은 해당 스키마가 정합니다

| 필드 | 의미 |
|---|---|
| `type` | 무엇에 대한 판정인지 나타내는 식별 키 |
| `status` | `True`·`False`·`Unknown` |
| `reason` | 기계가 읽는 판정 이유, 빈 값 불가 |
| `message` | 사람이 읽는 설명, 빈 문자열 가능 |
| `lastTransitionTime` | condition의 status가 전이된 시각 |
| `observedGeneration` | 어느 generation을 보고 내린 판정인지, 선택 필드 |

표준 형태에서 observedGeneration을 제외한 다섯 필드는 필수입니다
observedGeneration이 뒤처졌다면 condition의 상태가 현재 spec을 관찰한 결과인지 따로 확인해야 합니다

`SetStatusCondition` 헬퍼는 같은 type의 기존 condition에서 status가 바뀔 때만 전이 시각을 갱신합니다
reason이나 message만 바꾸면 전이 시각은 유지합니다. 새 항목의 시각이 비어 있으면 현재 시각을 채웁니다

이는 헬퍼의 동작이며 API 서버가 모든 condition 쓰기에 같은 갱신 규칙을 강제한다는 뜻은 아닙니다
Ready처럼 True가 정상인 조건도 있고, True가 문제를 나타내는 조건도 있습니다
타입의 의미를 모른 채 True 개수로 전체 건강 상태를 계산할 수는 없습니다

conditions는 배열 형태지만 type을 키로 하는 map처럼 관리합니다
스키마의 `listType: map`·`listMapKey: type`은 SSA에서 항목별 병합을 가능하게 하며, 일반 Update로 배열 전체를 덮는 것까지 막지는 않습니다

따라서 자기 condition type을 찾아 바꾸고 다른 항목은 보존해야 합니다
API 관례는 첫 관찰에 Unknown을 포함한 조건을 게시하고, 알려진 조건의 부재도 Unknown처럼 해석하도록 설명합니다. [Condition 타입](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/apis/meta/v1/types.go), [표준 갱신 헬퍼](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/api/meta/conditions.go)

## finalizer의 삭제 조정도 반복에 안전해야 합니다

finalizer는 오브젝트 삭제 전에 필요한 정리를 마치도록 최종 삭제를 기다리게 하는 메타데이터입니다
오브젝트가 사라진 뒤의 NotFound만으로는 외부 자원 정리에 필요한 정보와 처리 순서를 보장할 수 없습니다

사용자가 호출하는 controller-runtime의 finalizer 헬퍼는 등록된 키를 오브젝트에 추가하고, deletionTimestamp가 있는 동안 정리 함수를 호출합니다
정리가 실패하면 키를 유지하고, 성공하면 키를 제거하도록 오브젝트를 변경합니다

이 헬퍼는 오브젝트의 변경 여부와 에러를 반환할 뿐 API 저장을 대신 완료하지 않습니다
Reconciler가 필요한 메타데이터·status 변경을 저장하고 실패 처리를 이어야 합니다

이미 일부 정리가 끝난 뒤 재호출되거나 저장이 실패할 수도 있습니다
외부 자원 정리와 API 쓰기를 하나의 트랜잭션으로 취급하지 말고 중간 상태에서 다시 조정할 수 있어야 합니다

CR의 메타데이터 변경은 generation 변화와 별개일 수 있습니다
generation predicate를 사용할 때에는 삭제 상태 전환도 필요한 감시·재조정 경로로 전달되는지 함께 검토해야 합니다. [finalizer 헬퍼의 실제 책임](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/finalizer/finalizer.go)

## leader election은 같은 키의 전역 잠금이 아닙니다

Manager의 leader election은 기본적으로 꺼져 있습니다
같은 선거에 참여하도록 활성화한 구성에서 leader가 필요한 Controller들의 실행을 조정합니다

확인한 Manager의 기본 시간과 기동 조건은 다음과 같습니다

| 설정·항목 | 기본값·적용 범위 |
|---|---|
| `LeaseDuration` | 15초, leader election 활성 구성의 리스 기간 |
| `RenewDeadline` | 10초, 리더의 갱신 재시도 기한 |
| `RetryPeriod` | 2초, 선거 재시도 주기 |
| `GracefulShutdownTimeout` | 30초, Manager 종료 유예 |
| `CacheSyncTimeout` | 2분, Controller의 초기 캐시 동기화 대기 |
| `ReconciliationTimeout` | 기본 제한 없음, 조정 호출의 context 시간 제한 |
| health 경로 | `/healthz`·`/readyz`, 바인딩 주소가 빈 값 또는 `"0"`이면 서버 미기동 |

이 시간값은 실제 장애 전환 시간을 측정한 결과가 아닙니다
client-go의 leader election은 fencing, 즉 다른 실행 주체가 작업하지 못하도록 외부 변경까지 강제로 차단하는 보장을 제공하지 않습니다

따라서 여러 프로세스와 외부 시스템의 변경까지 같은 키 직렬화로 해결됐다고 판단할 수 없습니다
같은 선거 설정, 실행할 구성 요소, 외부 작업의 중복 안전성을 나눠 확인해야 합니다. [Manager 기본값](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/manager/manager.go), [client-go 선거의 보장 범위](https://github.com/kubernetes/client-go/blob/28076445520055420e3be4255b4cd27fd19df1f9/tools/leaderelection/leaderelection.go)

## 조정이 멈췄는지, 반복되는지를 먼저 나눕니다

| 관찰한 상태 | 확인할 경계 |
|---|---|
| 자식을 바꿔도 부모 조정이 없음 | Owns의 controller 참조·group/kind·버전 매핑·predicate |
| 소유권 변경 뒤 이전 부모도 조정됨 | 옛·새 오브젝트를 모두 처리하는 owner Update 핸들러 |
| 같은 키가 반복해서 조정됨 | status·메타데이터의 불필요한 쓰기, 다른 감시 이벤트와 예약 |
| 이름이 다른 중복 자식이 생김 | 캐시 관찰 지연과 generateName 사용, 중간 상태의 재사용 여부 |
| RequeueAfter가 의도와 다르게 동작함 | non-nil error 동반 여부, 다른 이벤트로 더 이르게 깨어나는지 확인 |
| 에러 뒤 재시도 간격이 길어짐 | limiter의 실패 기록과 다른 이벤트 유무 |
| status 훼손이 복구되지 않음 | generation predicate로 해당 Update를 제외했는지 확인 |
| 초기 캐시 동기화가 끝나지 않음 | 해당 타입·범위의 list/watch RBAC, 연결·타입 조회 오류 |
| 삭제가 끝나지 않음 | finalizer 정리 실패, 메타데이터 저장 실패, 삭제 조정 계기 |

반복 조정이 안전하다는 것은 같은 요청마다 처음부터 같은 쓰기를 되풀이한다는 의미가 아닙니다
현재 관찰한 중간 상태에서 필요한 변경만 이어가고, 정상적인 대기를 에러 재시도와 구분하는 것이 Reconciler의 책임입니다

## 확인한 근거

- [controller-runtime v0.25.2 go.mod](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/go.mod): Go 1.26·k8s.io 계열 및 client-go v0.37.0 의존성
- [API conventions 고정본](https://github.com/kubernetes/community/blob/e8963b1070ee8bd9edfc7bf965ca7b0eaf991f0b/contributors/devel/sig-architecture/api-conventions.md): level-based 조정·spec/status·conditions 관례
- [Controller의 기본값 구성](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/controller/controller.go): 우선순위 큐·동시 조정 수·동기화 제한·rate limiter
