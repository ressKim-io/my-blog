---
title: "DELETE와 삭제 수명 — finalizer와 유예 종료가 기다리는 것"
excerpt: "DELETE 요청 뒤에도 객체가 남는 이유를 finalizer와 유예 종료로 나누고, 전파 정책·Namespace 정리·generation을 통해 삭제가 멈춘 지점을 살펴봅니다"
category: kubernetes
tags: [Kubernetes, Finalizer, Garbage Collection, Namespace, concept]
series:
  name: "k8s-theory-api"
  order: 9
date: "2026-10-22"
---

DELETE 요청이 성공해도 객체가 API에서 바로 사라지는 것은 아닙니다
삭제 전에 정리를 끝내야 하거나, 실행 중인 컨테이너가 종료할 시간을 받아야 한다면 API 서버는 삭제 시작을 기록하고 객체를 남깁니다

그때 무엇을 기다리는지에 따라 확인할 필드와 담당 주체가 달라집니다
`metadata.finalizers`가 남은 경우와, 이 목록이 비었는데도 Pod가 남은 경우를 같은 문제로 보면 삭제가 멈춘 지점을 놓칠 수 있습니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 클러스터에서 재현한 실측 기록은 포함하지 않으며, 상태·번호 예시는 설명을 위한 가정입니다

## 삭제를 요청한 뒤에도 객체를 남기는 이유

클라우드 로드밸런서가 연결된 Service를 예로 들겠습니다
Service 객체는 Kubernetes API에 있지만 로드밸런서는 외부 시스템에 있습니다
Service부터 지우면 정리 담당자가 외부 자원을 추적할 정보를 잃을 수 있습니다

API 서버가 모든 외부 자원의 정리 방법과 완료 상태를 직접 알지는 못합니다
대신 정리 담당자가 **finalizer**라는 이름을 객체에 남기고, 정리 후 그 이름을 제거하도록 삭제를 늦출 수 있게 합니다

Pod의 유예 종료는 다른 이유로 기다립니다
컨테이너가 실행을 마칠 시간을 주고 kubelet이 종료를 처리하도록 합니다
정리 담당자가 이름을 제거할 때까지 기다리는 finalizer와, 종료를 위한 기간을 표현하는 grace period는 별개의 장치입니다

![finalizer 경로는 정리 담당자의 항목 제거를, Pod 유예 종료 경로는 kubelet의 종료 처리와 마지막 DELETE를 거쳐 저장소 삭제로 이어집니다](/diagrams/k8s-theory-deletion-lifecycle-1.svg)

두 경로는 함께 적용될 수 있습니다
유예 기간을 0으로 줄였어도 finalizer가 남으면 삭제가 보류될 수 있고, finalizer가 없어도 종료 처리가 끝나지 않은 Pod는 남을 수 있습니다
그림의 마지막 삭제는 다른 보류 조건과 요청 검증도 통과한 경우입니다

이 분기는 [`Store.Delete`·`updateForGracefulDeletionAndFinalizers`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/registry/generic/registry/store.go)와 [`BeforeDelete`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/registry/rest/delete.go)에 나뉘어 있습니다

## 부모 삭제와 자식 처리는 전파 정책으로 연결합니다

Garbage collector(GC)는 객체의 `ownerReferences`를 따라 소유 관계를 확인하고, 삭제 대상이 된 종속 객체를 정리하는 컨트롤러입니다
여기서는 소유자를 부모, 종속 객체를 자식이라고 부르겠습니다
부모 DELETE의 `propagationPolicy`가 부모와 자식 처리의 순서를 정합니다

| 정책 | 부모 객체 | 자식 처리 | 부모에 붙는 전파용 finalizer |
|---|---|---|---|
| `Background` | 다른 보류 조건이 없으면 먼저 사라짐 | GC가 뒤따라 정리 | 없음 |
| `Foreground` | 삭제 중인 상태로 남음 | 부모 삭제를 막는 자식의 처리가 끝나야 부모를 놓아줌 | `foregroundDeletion` |
| `Orphan` | GC가 소유 참조를 제거하는 동안 남음 | 해당 부모의 owner reference만 제거하고 자식은 남김 | `orphan` |

Background에서 자식이 무조건 모두 삭제되는 것은 아닙니다
다른 유효한 소유자가 남아 있는 자식은 GC가 보존할 수 있습니다
Foreground도 모든 자식을 빠짐없이 기다린다는 보장은 아닙니다
**GC의 cache에 있고, 해당 부모 참조의 `blockOwnerDeletion`이 true인 자식**이 부모 삭제를 막습니다

GC가 해당 리소스를 정상적으로 LIST·WATCH하지 못하거나 부모 삭제와 자식 생성이 겹치면 cache에 자식이 없을 수 있습니다
Background에서는 부모가 먼저 사라질 수 있으므로 `blockOwnerDeletion`으로 부모 삭제를 붙잡을 수도 없습니다

`kubectl delete`의 `--cascade` 기본값은 `background`입니다
일반 저장 경로는 삭제 요청의 명시적 옵션을 먼저 보고, 없으면 기존 전파용 finalizer와 리소스별 기본 정책을 확인합니다
해당 리소스가 GC를 지원하지 않거나 저장소에서 GC를 비활성화했다면 전파용 finalizer를 붙이지 않습니다

Foreground에서는 blocking 자식 하나가 자기 finalizer에 걸려도 부모가 계속 남을 수 있습니다
부모 이름도 점유되므로 같은 이름으로 다시 만들려 하면 `AlreadyExists`가 날 수 있습니다
Background는 부모 이름을 먼저 놓아줄 수 있지만, 그 뒤에도 자식이 남아 있는 구간을 허용합니다

전파 정책의 계약은 [Garbage Collection 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/architecture/garbage-collection.md)에 있습니다
구현은 [`shouldOrphanDependents`·`shouldDeleteDependentsInForeground`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/registry/generic/registry/store.go), GC의 [`classifyReferences`·`processDeletingDependentsItem`·`orphanDependents`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/garbagecollector/garbagecollector.go), kubectl 기본값은 [`delete_flags.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kubectl/pkg/cmd/delete/delete_flags.go)에서 확인했습니다

## finalizer는 정리 코드를 실행하는 명령이 아닙니다

`metadata.finalizers`는 삭제 전에 처리할 작업의 이름 목록입니다
API 서버가 이 문자열을 보고 담당 컨트롤러를 등록하거나 정리 함수를 호출하지는 않습니다
보통 해당 이름을 관리하는 컨트롤러가 삭제 시작을 관찰하고, 자신이 맡은 정리를 마친 뒤 항목을 제거합니다

API 서버는 그 항목을 지울 권한을 문자열의 담당자에게만 주지도 않습니다
수정 권한이 있는 다른 주체도 제거할 수 있으므로, **항목이 없어졌다는 사실만으로 외부 정리가 실제로 끝났다고 증명할 수는 없습니다**
컨트롤러가 멈추고 다른 주체도 항목을 제거하지 않으면 객체는 삭제 중인 상태로 남습니다

삭제가 시작되면 기존 항목은 제거할 수 있지만 새 finalizer를 추가할 수는 없습니다
검증에서 사용하는 오류 문구는 다음과 같습니다

```text
no new finalizers can be added if the object is being deleted
```

여러 항목의 처리 순서도 목록 순서대로 보장하지 않습니다
서로 다른 정리 담당자가 함께 쓰는 필드이므로, 앞 항목의 작업이 뒤 항목의 결과를 기다리는 식으로 목록 순서에 의존해서는 안 됩니다
이 규칙은 [`ObjectMeta.Finalizers`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/apis/meta/v1/types.go)와 [`ValidateNoNewFinalizers`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/api/validation/objectmeta.go)에 있습니다

### 사용자 finalizer의 이름과 예약 이름은 구분합니다

사용자 finalizer는 `example.com/cleanup`처럼 도메인 접두사가 있는 이름을 사용합니다
접두사가 없는 `foregroundDeletion`과 `orphan`은 GC가 다루는 예약 이름이며, 두 값을 동시에 넣는 것은 검증에서 막습니다

이름 검증을 볼 때 공통 `ValidateFinalizerName` 하나만 보고 접두사가 필요 없다고 결론 내리면 안 됩니다
Pod·Namespace 등 core 검증 경로는 여기에 `validateKubeFinalizerName`을 더 적용합니다
이 추가 검사는 표준 예약 이름이 아닌데 `/`로 구분한 접두사가 없는 이름을 거부합니다

공식 [Finalizers 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/overview/working-with-objects/finalizers.md)의 이름 요구와 [core의 추가 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go)을 함께 봐야 합니다

내장 보호용 finalizer도 있습니다
`StorageObjectInUseProtection` admission 플러그인이 붙이는 이름과 정리 대상은 다음과 같습니다

| finalizer | 보호하는 객체 |
|---|---|
| `kubernetes.io/pv-protection` | PVC에 바인딩된 PersistentVolume(PV) |
| `kubernetes.io/pvc-protection` | Pod가 사용하는 PersistentVolumeClaim(PVC) |
| `kubernetes.io/vac-protection` | PV·PVC가 사용하는 VolumeAttributesClass(VAC) |

PV는 저장 공간을, PVC는 그 공간의 요청을 표현하며, VAC는 볼륨 속성 변경에 사용하는 API 객체입니다
이 이름을 추가하는 일과 사용 상태를 판단해 제거하는 일은 다른 구성요소가 맡습니다
따라서 DELETE를 접수했다고 보호 조건이 자동으로 끝나지는 않습니다
[플러그인의 추가 경로](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/plugin/pkg/admission/storage/storageobjectinuseprotection/admission.go)와 [finalizer 상수](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/util/finalizer.go)를 대조했습니다

### 성공 응답은 저장소 삭제 완료와 다릅니다

Finalizers 문서는 삭제를 접수하고 객체를 남기는 응답을 `202 Accepted`로 설명합니다
다만 v1.37.1의 일반 DELETE handler는 호환성을 위해 기본 응답을 `200 OK`로 둡니다
즉시 삭제하지 못했고 이전 방식의 `orphanDependents: false` 옵션이 있을 때 202를 선택합니다

따라서 200이면 삭제 완료, 202이면 finalizer 대기라고 나눌 수 없습니다
응답 객체의 삭제 표시와 이후 객체 존재 여부를 함께 확인해야 합니다
이 차이는 [`DeleteResource`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/handlers/delete.go)의 `wasDeleted`·응답 코드 분기에 드러납니다

## Pod의 유예 종료에는 마지막 DELETE가 남아 있습니다

유예 삭제는 먼저 객체를 갱신하고, 이후 저장소에서 지우는 흐름입니다
처음에는 API 서버가 `deletionTimestamp`와 `deletionGracePeriodSeconds`를 기록하며 Pod는 계속 조회될 수 있습니다

노드의 Pod를 관리하는 kubelet은 이 변화를 보고 컨테이너 종료를 처리합니다
일반적으로 컨테이너 런타임에 종료를 요청해 TERM 신호를 보내지만, 이미지의 `STOPSIGNAL`이나 지원되는 stop signal 설정에 따라 신호가 달라질 수 있습니다
kubelet이 종료 처리를 수행할 수 있는 상태에서 유예 시간이 끝났는데도 프로세스가 남으면 강제 종료로 이어집니다

kubelet의 status manager는 종료 완료 조건을 확인한 뒤 다음 두 값을 담아 마지막 DELETE를 보냅니다

| DELETE 옵션 | 목적 |
|---|---|
| `gracePeriodSeconds: 0` | 추가 유예 없이 삭제 요청 |
| `preconditions.uid` | 같은 이름으로 새로 생긴 다른 Pod를 지우지 않도록 대상 수명 확인 |

확인한 구현은 API에서 관찰한 Pod phase가 terminal인지와 Pod 종료 처리가 끝났는지도 검사합니다
여기서 terminal은 `Succeeded` 또는 `Failed`처럼 실행이 끝난 phase를 뜻합니다
단순히 처음 요청한 시각이 지났다는 이유만으로 이 경로가 모두 끝나는 것은 아닙니다

이 DELETE가 성공한 뒤 status manager가 남기는 로그 문구는 다음과 같습니다

```text
Pod fully terminated and removed from etcd
```

이 문구도 별도의 finalizer가 남아 있는지까지 증명하지는 않습니다
코드는 DELETE 요청의 성공을 확인하고 로그를 남기므로, 삭제가 계속 보류된다면 실제 API 객체의 상태를 함께 봐야 합니다
근거는 [`status_manager.go`의 `canBeDeleted`와 마지막 DELETE](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/status/status_manager.go), 종료 신호의 조건은 [Pod Lifecycle](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/workloads/pods/pod-lifecycle.md)입니다

모든 Pod가 이 순서로 기다리는 것은 아닙니다
노드에 배치되지 않았거나 이미 `Succeeded`·`Failed`인 Pod는 [Pod 삭제 strategy](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/pod/strategy.go)가 유예 기간을 0으로 정합니다
이 경우까지 kubelet의 두 번째 DELETE를 기다리는 경로로 묶으면 안 됩니다

### deletionTimestamp는 실제 삭제 시각이 아닙니다

| 삭제 경로 | 기록하는 시각 |
|---|---|
| 유예 삭제를 지원하지 않는 객체를 finalizer 때문에 남김 | 삭제를 표시한 현재 시각 |
| 유예 삭제를 시작함 | 현재 시각에 유예 기간을 더한 예정 시각 |

이미 시작된 유예 기간은 더 짧게 요청할 수 있지만 늘릴 수는 없습니다
기간을 줄이면 예정 시각도 앞당기며, 계산 결과가 과거로 넘어가는 경우를 보정하는 분기도 있습니다
이 필드를 직접 수정하는 일반 Update와 DELETE 옵션으로 유예 시간을 줄이는 경로는 구분해야 합니다

처음의 update는 성공했지만 마지막 저장소 delete만 실패할 수도 있습니다
그 결과 유예 기간이 0인 채 객체가 남았다면, 다음 삭제 처리에서 API 서버가 이를 감지해 즉시 삭제를 다시 시도할 수 있습니다
이는 API 서버가 시각을 감시하는 타이머만으로 모든 객체를 자동 삭제한다는 뜻은 아닙니다

네트워크 단절이나 남은 finalizer 때문에 예정 시각이 지나도 객체가 보일 수 있습니다
`deletionTimestamp`는 삭제가 시작됐다는 상태와 예정 시각을 읽는 필드이지, 저장소에서 실제로 사라진 시각의 기록이 아닙니다
관련 분기는 [`BeforeDelete`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/registry/rest/delete.go)와 [`markAsDeleting`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/registry/generic/registry/store.go)에 있습니다

## Namespace는 안의 내용을 확인한 뒤 자기 finalizer를 제거합니다

Namespace는 일반적인 `metadata.finalizers`와 별도로 `spec.finalizers`도 사용합니다
API 서버는 Namespace를 만들 때 `spec.finalizers`에 `kubernetes`가 없으면 추가합니다
다른 이름도 함께 들어 있을 수 있습니다

| 필드 | 변경 경로 |
|---|---|
| `metadata.finalizers` | 일반 객체 metadata의 finalizer 처리 |
| Namespace의 `spec.finalizers` | 일반 update에서는 보존하며 `/finalize` subresource로 변경 |

전용 API 경로는 다음과 같습니다

```text
PUT /api/v1/namespaces/{name}/finalize
```

namespace controller는 discovery로 네임스페이스 안에서 삭제할 수 있는 리소스 종류를 확인합니다
Discovery는 서버가 제공하는 API group·version·resource와 지원 동작을 알아보는 과정입니다

![Namespace 삭제에서 discovery로 대상을 찾고 Pod를 먼저 삭제한 뒤 나머지 내용을 비우며 오류와 잔존 객체가 없을 때 kubernetes finalizer를 제거하는 흐름](/diagrams/k8s-theory-deletion-lifecycle-2.svg)

v1.37.1 구현은 발견한 삭제 대상에 Pod가 포함돼 있으면 Pod를 먼저 처리합니다
Pod가 남았다고 확인되면 다른 리소스 삭제로 넘어가지 않습니다
이 동작은 현재 소스에서 `OrderedNamespaceDeletion` feature gate 분기 없이 적용됩니다

발견한 내용의 삭제가 끝나고 잔존 내용과 오류가 없으면 `/finalize`로 자신이 관리하는 `kubernetes` finalizer를 제거합니다
다른 `spec.finalizers` 항목은 지우지 않습니다
Namespace는 두 finalizer 필드를 모두 가질 수 있으므로 `kubernetes`가 없어졌다는 것만으로 삭제 완료를 판단할 수는 없습니다

이 경로는 [Namespace strategy](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/namespace/strategy.go), [`deleteAllContent`·`finalizeNamespace`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/namespace/deletion/namespaced_resources_deleter.go), [`ShouldDeleteNamespaceDuringUpdate`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/namespace/storage/storage.go)에서 확인했습니다

### discovery 실패와 남은 객체는 다른 원인입니다

namespace controller는 삭제 과정의 문제를 `status.conditions`에 기록합니다
서버의 전체 대상 목록을 얻지 못한 것과, 이미 찾은 대상이 아직 남은 것을 구분해야 합니다

| condition type | reason | 해석 |
|---|---|---|
| `NamespaceDeletionDiscoveryFailure` | `DiscoveryFailed` | 일부 API group의 discovery 실패 |
| `NamespaceContentRemaining` | `SomeResourcesRemain` | 발견한 리소스의 객체가 아직 남음 |
| `NamespaceFinalizersRemaining` | `SomeFinalizersRemain` | 발견한 객체에 finalizer가 남음 |

응답하지 않는 `APIService`는 discovery 실패의 가능한 원인입니다
APIService는 Kubernetes API 경로를 별도 API 서버에 연결하는 등록 객체입니다
이 경우 실패한 group과 APIService의 `Available` 상태를 살펴봐야 합니다

일부 discovery만 성공해도 namespace controller는 확인한 리소스의 삭제를 계속 시도할 수 있습니다
그러나 discovery 오류가 남은 시도에서는 `kubernetes` finalizer를 제거하지 않습니다
아직 찾지 못한 삭제 대상이 있을 수 있기 때문입니다

한 객체가 남아 있고 그 객체에 finalizer도 있다면 `NamespaceContentRemaining`과 `NamespaceFinalizersRemaining`이 함께 True일 수 있습니다
다만 조건은 처리 경로에 따라 갱신됩니다
Pod가 남아 일찍 반환하는 경로도 있으므로, 조건 한 항목이 없다는 이유만으로 잔존 객체가 없다고 판단해서는 안 됩니다

대표 메시지는 다음과 같습니다

```text
Discovery failed for some groups, N failing: ...
Some resources are remaining: <resource>.<group> has N resource instances
Some content in the namespace has finalizers remaining: <finalizer> in N resource instances
```

조건과 메시지는 [`status_condition_utils.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/namespace/deletion/status_condition_utils.go), 부분 discovery 이후의 처리는 앞의 `deleteAllContent`에서 확인했습니다

Terminating 상태의 Namespace에는 `NamespaceLifecycle` admission 플러그인이 일반적인 새 객체 생성을 막습니다
다음 문구는 내용 삭제 자체의 오류가 아니라 새 CREATE를 거부한 결과입니다

```text
unable to create new content in namespace <ns> because it is being terminated
```

네임스페이스 안의 권한을 조회하는 `localsubjectaccessreviews`는 존재 여부를 통한 정보 노출을 막기 위해 이 검사에서 제외됩니다
이 예외는 [`NamespaceLifecycle.Admit`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/namespace/lifecycle/admission.go)에 있습니다

`spec.finalizers`를 `/finalize`로 강제로 비우면 namespace controller의 내용 확인을 건너뛰게 됩니다
다른 삭제 보류 조건이 없다면 Namespace가 사라질 수 있고, 남은 객체는 정상적인 조회·정리 경로에서 벗어날 수 있습니다
따라서 이 필드를 비우는 일을 내부 리소스를 모두 정리하는 작업과 같게 취급하면 안 됩니다

## 삭제 시작도 generation을 바꿀 수 있습니다

`metadata.generation`은 API 서버가 관리하는 번호입니다
일반 Update에서는 사용자가 넣은 값을 먼저 이전 generation으로 되돌리고, 리소스별 strategy가 증가 여부를 결정합니다
그래서 단순히 spec을 수정한 횟수라고 읽으면 맞지 않는 경우가 있습니다

| 리소스 | 일반 Update에서 generation이 증가하는 조건 |
|---|---|
| StatefulSet | `spec` 변경 |
| Deployment | `spec` 또는 `metadata.annotations` 변경 |
| CRD로 정의한 custom resource | `metadata` 밖의 변경. status subresource가 있으면 일반 Update의 status 변경을 먼저 제거 |

Deployment는 annotation을 ReplicaSet에 복사하므로 annotation 변경도 generation에 반영합니다
Custom resource는 status subresource를 켜지 않았다면 `status`도 metadata 밖의 변경입니다
따라서 status를 쓸 때도 generation이 증가할 수 있습니다
여기서 말하는 custom resource는 정의 자체인 CRD 객체와 구분합니다

삭제 시작을 저장할 때도 변화가 있습니다
기존 generation이 양수라면 첫 유예 삭제의 update나 finalizer 때문에 남겨 두는 첫 삭제 표시에서 1 증가할 수 있습니다
즉시 저장소에서 지우는 경로라면 새 번호를 읽을 객체 자체가 남지 않습니다

사용자 값 초기화는 [`BeforeUpdate`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/registry/rest/update.go), 증가 조건은 [StatefulSet](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/apps/statefulset/strategy.go)·[Deployment](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/apps/deployment/strategy.go)·[custom resource](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/registry/customresource/strategy.go)의 `PrepareForUpdate`에 있습니다
삭제 시작의 증가는 앞서 본 `BeforeDelete`와 `markAsDeleting`에서 따로 처리합니다

## observedGeneration이 같아도 작업은 끝나지 않았을 수 있습니다

컨트롤러가 현재 객체를 어디까지 관찰했다고 보고하는지는 `observedGeneration`으로 확인할 수 있습니다
이 필드는 API 서버가 대신 채우는 것이 아니라 상태를 쓰는 컨트롤러가 기록합니다

| 위치 | 나타내는 관찰 번호 |
|---|---|
| `status.observedGeneration` | 객체 상태에 대해 보고한 generation |
| `status.conditions[x].observedGeneration` | 해당 condition에 대해 보고한 generation |

모든 리소스가 두 필드를 모두 제공하지 않으며, 함께 제공해도 같은 시점에 갱신한다는 보장은 없습니다
예를 들어 현재 generation이 7인데 한 condition의 observedGeneration이 6이라면, 그 condition은 현재 generation을 반영한 판정이 아닙니다

둘 다 7이라고 해서 외부 자원의 준비나 rollout까지 완료됐다는 뜻은 아닙니다
컨트롤러가 새 요구를 확인하고도 아직 작업 중이거나 실패 상태를 보고할 수 있으므로 condition의 상태와 이유도 함께 봐야 합니다
`kubectl rollout status` 역시 관찰 번호만 비교하고 끝내지 않고, 워크로드별 replica 상태와 진행 조건을 더 확인합니다

condition의 번호 의미는 [`metav1.Condition.ObservedGeneration`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/apis/meta/v1/types.go), rollout 판정은 [`rollout_status.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kubectl/pkg/polymorphichelpers/rollout_status.go)에 있습니다
