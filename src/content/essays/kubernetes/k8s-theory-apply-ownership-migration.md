---
title: "SSA 소유권 이행 — 필드를 뺐는데 값이 바뀌는 이유"
excerpt: "replicas를 HPA에 넘길 때 생기는 소유권 공백을 시작으로, prune과 기본값 적용, 반복 Apply의 쓰기 생략, CSA 전환과 managedFields 초기화 조건을 확인합니다"
category: "kubernetes"
tags: ["Kubernetes", "Server-Side Apply", "HPA", "managedFields", "concept"]
series:
  name: "k8s-theory-api"
  order: 11
date: "2026-10-22"
---

Deployment의 `spec.replicas`를 HPA에 맡기려면 사람이 관리하는 매니페스트에서 그 필드를 빼야 할 수 있습니다
그런데 HPA를 생성한 시점과 HPA가 실제로 복제본 수를 써서 소유권을 얻는 시점은 다릅니다

사람만 소유하던 필드를 먼저 빼면, Apply가 그 필드를 제거하고 Deployment 기본값 1을 채울 수 있습니다
충돌 에러 없이도 원하는 복제본 수가 줄어드는 경우입니다

[앞 글](/essays/k8s-theory-server-side-apply)에서는 필드 소유권과 충돌 계산을 살펴봤습니다
이번에는 소유권을 다른 매니저에게 넘기는 동안 값이 어떻게 달라질 수 있는지 확인하겠습니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 클러스터 실측은 포함하지 않으며, 복제본 수와 매니저별 상황은 설명을 위한 가정입니다

## 필드를 생략하는 것은 이번 관리 범위에서 빼는 일입니다

Apply는 이번에 바꿀 값만 나열하는 요청이 아닙니다
**이번 요청 이후에도 내가 관리할 필드 집합**을 선언합니다
지난번에는 관리했지만 이번 설정에는 없는 필드라면 서버가 제거할 수 있습니다
이 제거를 `prune`이라고 합니다

병합기는 다음 조건을 함께 확인합니다

1. 이 매니저가 지난 Apply에서 그 필드를 관리했습니다
2. 이번 Apply에는 그 필드를 넣지 않았습니다
3. 다른 매니저도 그 필드를 소유하지 않습니다

소스의 주석은 세 번째 조건에 다른 applier가 없다고 표현합니다
실제 `addBackOwnedItems`는 Apply 매니저뿐 아니라 Update 매니저가 소유한 필드도 보존합니다
HPA처럼 Update로 값을 쓰는 주체의 소유권도 이 조건에 영향을 줍니다

기록된 이전 API 버전으로 변환할 수 없다는 오류가 나면 `prune`을 건너뛰는 분기도 있습니다
이 동작은 [`Updater.prune`과 `addBackOwnedItems`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/vendor/sigs.k8s.io/structured-merge-diff/v6/merge/update.go)에서 확인했습니다

필드를 제거한 뒤에는 기본값 적용이 이어집니다
기본값이 없다면 필드가 사라지고, 기본값이 있다면 그 값으로 다시 나타날 수 있습니다
Deployment의 `spec.replicas`는 기본값이 1입니다

따라서 매니페스트에서 `replicas` 한 줄을 뺐다고 언제나 1이 되는 것은 아닙니다
그 필드가 실제로 제거되는 조건부터 만족해야 합니다
근거는 [병합 뒤 defaulting](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/util/managedfields/internal/structuredmerge.go)과 [`SetDefaults_Deployment`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/apps/v1/defaults.go)입니다

## HPA를 붙였다는 사실만으로 인계가 끝나지는 않습니다

HPA는 부하 등을 바탕으로 원하는 복제본 수를 계산하는 컨트롤러입니다
원하는 수가 현재 수와 달라 rescale이 필요할 때 대상의 `/scale` 하위 리소스에 Update를 보냅니다
HPA 설정을 저장한 직후에는 아직 이 쓰기가 일어나지 않았을 수 있습니다

사람이 `replicas: 3`을 유일하게 소유하다가 HPA를 붙였다고 가정하겠습니다
HPA가 소유권을 얻기 전에 사람이 필드를 빼고 Apply하면, 다른 소유자가 없는 필드가 제거되고 기본값 1로 돌아갈 수 있습니다

![HPA가 replicas를 쓰기 전에 사람이 관리에서 빼는 경우와 HPA가 이미 소유한 경우의 차이](/diagrams/k8s-theory-apply-ownership-migration-1.svg)

반대로 HPA가 이미 값을 바꿔 소유권을 얻었다면, 사람이 관리에서 빠져도 HPA의 값은 남습니다
판단할 것은 HPA 오브젝트의 존재만이 아니라 그 시점의 값과 `managedFields`입니다

### 기존 값을 유지하며 넘기는 두 방법

한 방법은 사람이 `replicas`를 계속 포함한 상태에서 HPA가 값을 바꿀 때까지 기다리는 것입니다
HPA가 소유한 뒤 사람이 이전 값을 Apply하면 필드 충돌이 나타날 수 있습니다
그 충돌에서 HPA의 소유권을 확인한 다음 필드를 빼면, HPA가 관리하는 값은 `prune`되지 않습니다

다만 HPA가 값을 바꿀 필요가 없었다면 충돌 신호가 아직 나오지 않을 수 있습니다
시간이 지났다는 이유만으로 소유권을 넘겼다고 판단할 수는 없습니다

다른 방법은 별도의 임시 매니저로 현재 `replicas` 값만 먼저 Apply하는 것입니다
같은 값을 Apply하므로 기존 매니저와 임시 매니저가 공동 소유합니다
이후 사람이 원래 설정에서 필드를 빼도 임시 소유자가 남아 값을 보존합니다

| 시점 | 값과 소유권의 변화 |
|---|---|
| 임시 매니저가 현재 값을 Apply | 사람과 임시 매니저가 공동 소유 |
| 사람이 원래 설정에서 필드 제외 | 임시 매니저가 계속 소유하므로 값 유지 |
| HPA가 다른 값으로 Update | HPA가 변경 필드의 소유권을 가져옴 |
| 임시 매니저의 필드 집합이 비어짐 | 빈 매니저 항목 제거 |

HPA가 값을 바꾸지 않는 동안에는 임시 소유권도 남습니다
임시 매니저의 요청이 HPA와 충돌했다면 이미 HPA가 필드를 소유한 상황인지 확인해야 합니다
이 목적의 인계에서 무조건 force로 HPA의 값을 되찾을 필요는 없습니다
두 방식은 공식 문서의 [소유권 이전 설명](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/using-api/server-side-apply.md#transferring-ownership)에 제시돼 있습니다

## HPA의 Update와 GitOps의 Apply는 다른 충돌을 만납니다

HPA의 `/scale` Update는 SSA 필드 소유권 충돌로 거부되지 않습니다
Deployment의 `ScaleHandler`가 본체의 `spec.replicas` 소유권을 Scale 경로로 변환하고, 처리 결과를 본체에 다시 합칩니다

그렇다고 HPA 쓰기가 항상 성공하는 것은 아닙니다
낡은 `resourceVersion` 때문에 충돌할 수 있으며, HPA는 현재 Scale을 다시 읽고 충돌을 재시도합니다
재시도가 끝내 실패하거나 다른 오류가 나면 `FailedRescale` 이벤트를 기록합니다

| 요청의 예 | 필드 소유권에 미치는 영향 |
|---|---|
| 사람이 Apply로 `replicas: 3` 관리 | 사람의 소유권 기록 |
| HPA가 Update로 7로 변경 | HPA가 변경 필드 소유권을 가져옴 |
| GitOps가 Apply로 다시 3 선언 | HPA의 소유권과 충돌 가능 |
| GitOps가 force Apply로 3 선언 | 충돌을 강제로 처리해 소유권을 가져옴 |
| HPA가 이후 다시 7로 Update | 값과 소유권이 다시 HPA 쪽으로 이동 가능 |

이 가정에서 값이 번갈아 바뀌는 원인은 두 관리 주체가 같은 필드에 서로 다른 값을 쓰기 때문입니다
값의 변화만 보고 그동안 모든 요청이 성공했다고 단정할 수는 없습니다
시점별 값, 매니저의 `operation`, 충돌 응답과 이벤트를 함께 봐야 합니다

Deployment `/scale`에는 전용 소유권 변환기가 있지만 모든 하위 리소스가 같은 조건은 아닙니다
`ScaleHandler.ToParent`도 기존 항목의 API 버전에 대응하는 경로를 모르면 그 항목을 건너뜁니다
하위 리소스의 소유권 추적을 본체와 무조건 같다고 가정하지 않습니다

근거는 [HPA의 rescale·재시도](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/podautoscaler/horizontal.go), [Deployment의 Scale 저장 경로](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/apps/deployment/storage/storage.go), [`ScaleHandler`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/util/managedfields/scalehandler.go)입니다

## 컨트롤러는 계속 관리할 필드를 매번 선언해야 합니다

SSA를 쓰는 컨트롤러는 쓰기 직전에 전체 오브젝트를 다시 읽고 `resourceVersion`을 맞추지 않아도 됩니다
자신이 원하는 필드를 선언해 보낼 수 있습니다
그러나 원하는 상태를 계산하는 데 필요한 조회까지 없어지는 것은 아닙니다

| 읽기·수정·쓰기와 다른 점 | 주의할 조건 |
|---|---|
| 쓰기 전 읽기와 `resourceVersion` 지정이 필수는 아님 | 현재 상태에 의존한 계산까지 자동으로 정확해지는 것은 아님 |
| 관리할 필드 집합을 매번 선언 | 빠뜨린 기존 필드는 `prune` 대상이 될 수 있음 |
| 이전에 Apply하지 않은 필드는 생략만으로 지우지 못함 | 그런 삭제에는 별도 patch·update가 필요 |

공식 문서는 컨트롤러가 **자신이 소유하고 관리하는 오브젝트**에서 충돌을 force하도록 권고합니다
컨트롤러가 사람처럼 충돌을 해석하고 다음 행동을 정하기 어려울 수 있기 때문입니다
모든 오브젝트와 모든 필드의 소유권을 가져오라는 뜻은 아닙니다

그 범위에서는 사람이 바꾼 값도 다음 reconcile에서 돌아갈 수 있습니다
reconcile은 현재 상태를 원하는 상태에 맞추는 컨트롤러의 반복 처리입니다
사람의 수정과 컨트롤러가 계속 선언하는 값이 다르면, 다음 처리가 값을 다시 바꿀 수 있습니다

client-go에는 타입별 `ApplyConfiguration`, 클라이언트의 `Apply`·`ApplyStatus`, 특정 매니저 소유분을 뽑는 `Extract*` 함수가 생성돼 있습니다
Deployment 예시는 [Apply 설정·Extract 구현](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/applyconfigurations/apps/v1/deployment.go)과 [클라이언트 인터페이스](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/kubernetes/typed/apps/v1/deployment.go)에서 확인할 수 있습니다

## 같은 내용을 Apply해도 항상 저장을 생략하지는 않습니다

같은 매니페스트를 다시 보냈다는 사실과 서버의 최종 상태가 같다는 사실은 다릅니다
값이 같아도 새 매니저가 공동 소유자가 됐다면 `managedFields`가 달라집니다
Admission이나 기본값 적용 결과가 바뀌는 경우도 있습니다

반대로 값과 소유권이 그대로인데 `managedFields.time`만 갱신됐다면, 그 시각 때문에 불필요한 저장이 생길 수 있습니다
기본 처리 경로는 시각을 제외한 나머지가 같을 때 이전 시각을 복구합니다

![반복 Apply에서 값과 소유권을 확인하고 시각을 복구한 뒤 동일한 저장 데이터를 생략하는 흐름](/diagrams/k8s-theory-apply-ownership-migration-2.svg)

이 과정을 세 단계로 나눠 볼 수 있습니다

1. structured merge는 현재 값과 병합 결과가 같으면 새 typed object 대신 nil을 반환할 수 있습니다
2. `IgnoreManagedFieldsTimestampsTransformer`는 소유권 집합과 나머지 필드가 같고 시각만 달라졌다면 기존 시각을 복구합니다
3. etcd의 `GuaranteedUpdate`는 직렬화한 데이터가 같고 기존 상태를 그대로 재사용할 수 있으면 쓰기를 생략합니다

마지막 단계는 필요하면 etcd의 현재 상태를 다시 확인합니다
저장 형식을 갱신해야 하는 상태라면 바이트가 같다는 이유만으로 생략하지 않습니다
또한 v1.37.1에는 `KUBE_APISERVER_AVOID_NOOP_SSA_TIMESTAMP_UPDATES=false`로 시각 복구를 끄는 구현 분기가 있으므로, 이 최적화를 모든 서버 설정의 보장으로 볼 수는 없습니다

근거는 [병합 결과 동등성 검사](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/vendor/sigs.k8s.io/structured-merge-diff/v6/merge/update.go), [시각 복구 구현](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/handlers/fieldmanager/equality.go), [저장소의 동일 데이터 검사](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/etcd3/store.go)입니다

## CSA에서 SSA로 바꾸는 처리는 한 곳에만 있지 않습니다

client-side apply, 줄여서 CSA와 SSA는 기본 매니저 이름이 다릅니다

| kubectl 사용 방식 | 기본 매니저 이름 |
|---|---|
| `kubectl apply` | `kubectl-client-side-apply` |
| `kubectl apply --server-side` | `kubectl` |

서버는 `kubectl.kubernetes.io/last-applied-configuration` 어노테이션을 이용해 CSA에서 SSA로 넘어오는 충돌 일부를 처리합니다
이 서버 측 처리는 매니저가 `kubectl`일 때만 적용됩니다

기존 어노테이션이 있고, API 버전이 맞으며, 기록한 값과 현재 값이 일치하는 필드인지 확인합니다
그 범위의 충돌은 이전 CSA 관리분으로 판단해 넘길 수 있습니다
반대로 `kubectl scale` 등으로 다른 값이 된 필드라면 이 범위를 벗어나 충돌이 남을 수 있습니다

여기서 끝나는 것은 아닙니다
v1.37.1 kubectl은 첫 SSA 요청이 성공한 뒤에도 CSA의 `managedFields`를 옮기는 별도 경로를 실행합니다

1. `last-applied-configuration`을 소유한 Update 매니저를 찾습니다
2. 그 Update 매니저가 소유한 필드 집합을 선택한 SSA 매니저로 옮기는 JSON Patch를 만듭니다
3. 이전이 이루어졌다면 원래 SSA 내용을 다시 Apply해 제외한 필드의 제거까지 반영합니다

이 kubectl의 `migrateToSSAIfNecessary`에는 대상 이름이 `kubectl`이어야 한다는 검사가 없습니다
따라서 **다른 `--field-manager`를 쓰면 모든 자동 이전이 꺼진다**고 일반화할 수 없습니다
다른 이름은 서버의 어노테이션 기반 충돌 처리에서 빠지지만, 첫 Apply가 성공했다면 클라이언트의 후속 이전이 적용될 수 있습니다

이전용 patch는 `resourceVersion`도 포함해 그 사이의 변경을 검사합니다
또한 첫 Apply가 성공한 뒤 이전이나 재적용이 실패하면 kubectl은 경고를 출력하는 경로가 있습니다
최초 쓰기 성공만으로 소유권 이전까지 모두 끝났다고 판단하면 이 경고를 놓칩니다

근거는 서버의 [`lastAppliedManager`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/util/managedfields/internal/lastappliedmanager.go), [kubectl의 후속 이전](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kubectl/pkg/cmd/apply/apply.go), [`UpgradeManagedFieldsPatch`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/util/csaupgrade/upgrade.go)입니다

### CSA로 돌아갈 때 필요한 어노테이션은 조건부로 유지됩니다

SSA에서 CSA로 돌아갈 때는 지난 적용 설정을 담은 어노테이션이 필요합니다
서버의 `lastAppliedUpdater`는 매니저가 `kubectl`이고 기존 어노테이션이 비어 있지 않을 때만 내용을 갱신합니다
다른 이름을 쓰거나 어노테이션이 원래 없다면 이 갱신은 하지 않습니다

kubectl에도 기존 어노테이션을 별도 매니저로 보존하는 처리가 있습니다
이 처리 역시 기본 SSA 매니저를 사용할 때 적용되며, 없던 어노테이션을 보존용으로 새로 만들지는 않습니다
SSA를 한 번 실행했다는 이유만으로 CSA 복귀에 필요한 기록이 항상 준비됐다고 보면 안 됩니다

근거는 [`lastAppliedUpdater.Apply`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/util/managedfields/internal/lastappliedupdater.go)와 kubectl의 `saveLastApplyAnnotationIfNecessary`입니다

## managedFields 초기화는 문서와 구현을 구분해야 합니다

Apply 외의 본체 쓰기에서는 `managedFields`를 직접 초기화할 수 있습니다
`[{}]`처럼 빈 항목 하나를 담은 목록은 명시적인 초기화 값입니다
다른 필드도 함께 바꾸면 기존 기록을 초기화한 뒤 그 변경을 다시 처리하므로 새 소유권 항목이 생길 수 있습니다

공식 SSA 문서 저장본에는 빈 목록 `[]`로는 초기화되지 않는다고 적혀 있습니다
하지만 v1.37.1의 `isResetManagedFields`는 **nil이 아닌 빈 목록**과 빈 항목 하나짜리 목록을 모두 초기화로 판정합니다
공식 통합 테스트 `TestClearManagedFieldsWithUpdateEmptyList`도 ConfigMap의 PUT 본문에 `managedFields: []`를 보내 초기화하는 경우를 다룹니다

따라서 이번 버전에서 “빈 목록은 언제나 무시된다”라고 설명하면 구현·테스트와 맞지 않습니다
필드를 생략한 nil과 명시적으로 전달된 빈 목록은 다르며, 클라이언트가 실제로 보낸 본문과 처리 경로를 구분해야 합니다
하위 리소스를 통한 요청에서는 요청 본문의 관리 기록 대신 기존 본체 기록을 쓰는 별도 처리도 있습니다

근거는 [공식 문서의 초기화 설명](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/using-api/server-side-apply.md#clearing-managedfields), [`isResetManagedFields`와 `decodeLiveOrNew`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/util/managedfields/internal/fieldmanager.go), [공식 통합 테스트 소스](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/test/integration/apiserver/apply/apply_test.go)입니다
통합 테스트의 코드를 대조했으며 이 글을 위해 해당 테스트나 클러스터 실험을 실행한 것은 아닙니다

## 응답 코드와 값의 변화를 따로 봅니다

SSA는 HTTP PATCH이므로 기존 객체 변경에는 `patch` 권한이 필요합니다
없는 객체를 생성하려면 `create` 권한도 필요합니다
`update` 권한만 있다고 Apply 요청이 허용되는 것은 아닙니다
이 구분은 [공식 SSA 권한 설명](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/using-api/server-side-apply.md#access-control-and-permissions-rbac-and-permissions)에서 확인했습니다

| 겪을 수 있는 상황 | 구분할 근거 |
|---|---|
| 필드를 뺐더니 값이 기본값으로 돌아감 | 이전 소유자·이번 생략·다른 소유자 유무와 defaulting |
| Apply가 409로 거부됨 | `FieldManagerConflict` cause와 충돌 필드 경로 |
| Update가 409로 거부됨 | resourceVersion 오류 문구와 해당 쓰기 경로 |
| 값이 번갈아 바뀜 | Apply·Update·force 여부, 매니저별 원하는 값과 실패 이벤트 |
| Apply가 403으로 거부됨 | `patch` 권한, 새 객체라면 `create` 권한도 확인 |
| 최초 Apply 뒤 이전 경고가 출력됨 | 본체 쓰기 성공과 소유권 이전·재적용 성공을 구분 |

필드 소유권 충돌의 409와 낡은 resourceVersion의 409는 HTTP 코드만으로 구분되지 않습니다
전자는 `FieldManagerConflict` cause를 만들며, 후자는 현재 버전을 다시 읽어 처리해야 하는 경로입니다
더구나 `prune`과 기본값 적용처럼 오류 응답 없이 값이 바뀌는 경우도 있습니다
인계가 끝났는지는 성공 코드 하나가 아니라 최종 값과 소유권을 함께 확인해야 합니다
