---
title: "Server-Side Apply — 필드마다 소유권과 충돌을 기록하는 방식"
excerpt: "같은 값을 Apply하면 공동 소유가 되고, 다른 값을 Apply하면 충돌할 수 있습니다. managedFields의 구조와 Update의 차이, 리스트 병합 단위와 스키마 변경의 영향을 살펴봅니다"
category: "kubernetes"
tags: ["Kubernetes", "Server-Side Apply", "managedFields", "CRD", "concept"]
series:
  name: "k8s-theory-api"
  order: 10
date: "2026-10-22"
---

하나의 Deployment를 여러 도구가 관리할 수 있습니다
HPA는 부하에 맞춰 복제본 수를 조절하고, GitOps 도구는 컨테이너 이미지와 나머지 설정을 관리하는 식입니다
오브젝트 전체에 관리자 하나만 지정하면 이런 분담을 표현하기 어렵습니다

Server-Side Apply, 줄여서 SSA는 **클라이언트가 관리할 필드 집합을 선언하고 서버가 병합과 소유권 충돌을 판단하는 쓰기 방식**입니다
필드 관리를 구분하는 이름을 field manager라고 하며, 이 글에서는 매니저라고 부르겠습니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 클러스터에서 재현한 실측 기록은 포함하지 않으며, A·B 매니저와 값은 설명을 위한 가정입니다

## 같은 필드라도 쓰기 방식에 따라 결과가 다릅니다

A가 `spec.replicas: 3`을 소유하고 있다고 가정하겠습니다
B가 Apply로 같은 값 3을 제출하면 서버 값은 그대로지만, 소유권에는 B가 추가됩니다
B가 다른 값 5를 Apply하면 A의 소유권과 충돌할 수 있습니다

일반 Update로 값을 5로 바꾸면 다릅니다
SSA의 필드 소유권 충돌로 거부하지 않고, 실제 바뀐 필드의 소유권을 B에게 넘깁니다

![A가 소유한 필드에 B가 같은 값 Apply, 다른 값 Apply, 다른 값 Update를 했을 때의 차이](/diagrams/k8s-theory-server-side-apply-1.svg)

그래서 `managedFields`는 마지막 작성자 한 명만 적은 변경 이력이 아닙니다
한 필드를 여러 매니저가 함께 소유할 수도 있습니다
공식 문서에서 필드를 관리한다는 것은 그 값이 다른 주체에 의해 바뀌지 않기를 기대한다는 뜻입니다

공동 소유 상태에서는 이후 A나 B가 Apply로 값을 바꿀 때 상대방의 소유권과 충돌합니다
같은 값이라 통과한 요청이 다음 변경에서는 충돌 조건을 만든 셈입니다

## managedFields는 이름 하나당 한 항목이 아닙니다

서버는 `metadata.managedFields`에 각 매니저의 필드 집합을 기록합니다
같은 `manager` 이름도 `operation`과 `subresource`가 다르면 별도 항목이 됩니다
`Update` 항목은 API 버전에 따라서도 나뉩니다

| 필드 | 기록하는 내용 |
|---|---|
| `manager` | 필드 관리를 구분하는 이름 |
| `operation` | 이 기록을 만든 `Apply` 또는 `Update` |
| `apiVersion` | 필드 집합을 해석할 API 버전 |
| `fieldsType` | 필드 집합의 표현 형식. 현재는 `FieldsV1` |
| `fieldsV1` | 소유한 필드 경로의 집합 |
| `subresource` | `/status` 등 어느 하위 리소스를 거쳐 썼는지 |

Apply의 매니저 식별자에서는 `apiVersion`을 제외합니다
같은 매니저가 적용 버전을 바꿨다는 이유만으로 별도 Apply 매니저가 되지는 않습니다
필드 집합을 어떤 버전으로 해석할지 알려주는 기록 자체는 남습니다

이 구분은 [`BuildManagerIdentifier`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/util/managedfields/internal/managedfields.go)에서 확인할 수 있습니다

### fieldsV1의 경로를 읽는 방법

`fieldsV1`은 공통 경로 아래에 세부 경로를 중첩하는 트라이 구조로 필드 집합을 표현합니다
다음은 Deployment의 소유권 기록 일부를 나타낸 예시입니다

```yaml
managedFields:
- manager: kubectl
  operation: Apply
  apiVersion: apps/v1
  fieldsType: FieldsV1
  fieldsV1:
    f:spec:
      f:replicas: {}
      f:template:
        f:spec:
          f:containers:
            k:{"name":"web"}:
              f:image: {}
```

이 항목은 `spec.replicas`와 Pod template의 `name: web` 컨테이너에 있는 `image`를 관리합니다
다른 컨테이너가 있어도 그 필드를 자동으로 소유하지 않습니다

| 접두사 | 경로의 의미 |
|---|---|
| `f:` | 구조체 필드 또는 맵의 키 |
| `k:` | 키 필드 값으로 식별하는 리스트 원소 |
| `v:` | 값 자체로 식별하는 리스트 원소 |
| `i:` | 위치 인덱스로 나타낸 리스트 원소 |

`kubectl get`의 JSON·YAML 출력은 기본적으로 `managedFields`를 숨깁니다
기록을 볼 때는 `--show-managed-fields`를 지정합니다
명령의 예시는 다음과 같으며 실행 결과를 제시한 것은 아닙니다

```bash
kubectl get deployment web -o yaml --show-managed-fields
```

근거는 [`FieldsV1` 정의](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/apis/meta/v1/types.go)와 [출력 플래그 구현](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cli-runtime/pkg/genericclioptions/json_yaml_flags.go)입니다

## 충돌은 남의 소유권과 이번 변경이 겹칠 때 생깁니다

Apply의 충돌 계산에서는 다른 매니저가 소유한 필드와 이번 요청으로 바뀌거나 새로 생긴 필드가 겹치는지 확인합니다

`충돌 필드 = 다른 매니저의 필드 집합 ∩ (Modified ∪ Added)`

값이 같으면 변경 집합에 들어가지 않아 충돌하지 않습니다
대신 이번에 Apply한 필드 집합에 포함돼 공동 소유가 됩니다
단순히 요청 본문에 같은 경로가 있다는 이유만으로 충돌하는 것은 아닙니다

강제 처리를 지정하지 않았고 충돌 집합이 비어 있지 않으면 요청을 거부합니다
이 계산은 병합 라이브러리의 [`Updater.update`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/vendor/sigs.k8s.io/structured-merge-diff/v6/merge/update.go)에 있습니다

[resourceVersion](/essays/k8s-theory-resource-version)의 충돌도 HTTP 409를 반환할 수 있지만 원인은 다릅니다
resourceVersion은 읽은 뒤 오브젝트가 바뀌었는지 검사하고, SSA는 필드별 관리 범위가 겹치는지 검사합니다

SSA 충돌의 판별 재료로 다음과 같은 메시지와 `FieldManagerConflict` cause를 볼 수 있습니다
아래는 소스의 형식에 맞춘 예시이며 클러스터에서 수집한 로그가 아닙니다

```text
Apply failed with 1 conflict: conflict with "hpa" using apps/v1: .spec.replicas
```

응답 `Status` 객체의 `details.causes[].reason`과 필드 경로를 함께 확인해야 합니다
메시지와 cause를 만드는 코드는 [`NewConflictError`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/util/managedfields/internal/conflict.go)에 있습니다

## 충돌을 푸는 선택은 값과 소유권을 함께 바꿉니다

다른 매니저가 관리하는 값을 Apply로 바꾸려다 충돌했다면, 어떤 값을 유지하고 누가 관리할지 정해야 합니다

| 선택 | 요청에서 바꾸는 것 | 결과 |
|---|---|---|
| 내 값으로 변경 | `force=true`, kubectl에서는 `--force-conflicts` 지정 | 충돌한 값을 바꾸고 다른 매니저의 해당 필드 소유권을 제거 |
| 관리 포기 | 내 매니페스트에서 해당 필드 제외 | 다른 매니저가 소유한 값은 유지하고 내 소유권에서 제외 |
| 공동 소유 | 내 값을 현재 서버 값과 같게 맞춰 Apply | 값은 유지하고 소유권을 공유 |

여기서 필드를 빼도 값이 유지된다는 설명은 **다른 매니저가 그 필드를 계속 소유하는 충돌 상황**을 전제로 합니다
내가 유일한 소유자였던 필드를 다음 Apply에서 빼면 삭제되거나 기본값으로 돌아갈 수 있습니다
매니페스트에서 제외하는 행동을 언제나 값 보존으로 해석해서는 안 됩니다

또한 `force`는 SSA의 소유권 충돌을 강제로 처리하는 옵션입니다
권한 검사나 리소스 검증, 다른 저장 오류까지 건너뛰게 하지는 않습니다
CLI의 `--force-conflicts`는 `--server-side`와 함께 사용하도록 [kubectl 구현](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kubectl/pkg/cmd/apply/apply.go)에서 검사합니다

## Update는 같은 값까지 모두 가져가지 않습니다

일반 PUT과 non-apply PATCH도 필드 관리에서 `Update` 경로를 사용합니다
이 경로는 필드 소유권 충돌을 강제로 처리하지만, 요청 본문에 적힌 모든 필드를 새 매니저에게 넘기지는 않습니다
실제로 변경하거나 추가한 필드를 가져오고, 값이 같은 필드는 그것만으로 가져오지 않습니다

[`Updater.Update`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/vendor/sigs.k8s.io/structured-merge-diff/v6/merge/update.go)는 기존 소유 집합에서 제거된 필드를 빼고 `Modified`·`Added`를 더합니다
Apply는 자신이 관리할 필드 집합을 선언하지만 Update는 최종 객체의 값 변화를 기준으로 소유권을 갱신하는 차이입니다

SSA 요청에는 `fieldManager` 쿼리 파라미터가 필수입니다
다른 쓰기에서는 선택이며, 생략하면 서버가 `User-Agent` 헤더에서 이름을 추론할 수 있습니다
Apply 본문에는 `metadata.managedFields`를 넣을 수 없습니다
현재 값과 선언을 바탕으로 서버가 소유권을 계산해야 하기 때문입니다

YAML 형식의 SSA 요청은 HTTP PATCH와 `application/apply-patch+yaml` 미디어 타입을 사용합니다
API 규칙은 [공식 SSA 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/using-api/server-side-apply.md#operations-in-scope-for-field-management-apply-and-update), 본문 제한은 [`structuredMergeManager.Apply`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/util/managedfields/internal/structuredmerge.go)에서 확인했습니다

## 리스트의 소유 단위는 스키마가 정합니다

서버가 리스트 원소별 소유권을 나누려면 같은 원소를 식별할 기준이 필요합니다
원소 구분 기준을 선언하지 않은 CRD 배열은 기본적으로 리스트 전체를 한 단위로 다룹니다

| `x-kubernetes-list-type` | 병합·소유 단위 | 예시 |
|---|---|---|
| `atomic` | 리스트 전체 | 별도 topology를 선언하지 않은 CRD 배열 |
| `set` | 중복 없는 원소의 값 | `metadata.finalizers` |
| `map` | 지정한 키 필드로 식별한 원소 | `spec.containers`의 `name` |

`map` 리스트는 `x-kubernetes-list-map-keys`로 키 필드를 지정합니다
키는 여러 개일 수 있습니다
컨테이너의 `ports`는 `containerPort`와 `protocol`을 함께 사용하므로 포트 번호만으로 원소를 구분하지 않습니다

v1.37.1의 `JSONSchemaProps`는 스칼라뿐 아니라 atomic 객체와 atomic 배열도 set의 원소로 허용한다고 명시합니다
같은 값의 원소가 중복되면 안 된다는 조건은 유지됩니다

객체 필드에는 `x-kubernetes-map-type`을 사용합니다
기본값 `granular`는 내부 필드를 나눠 관리하고, `atomic`은 객체 전체를 한 단위로 취급합니다
리스트의 원소 식별과 객체 내부의 관리 단위를 각각 지정하는 것입니다

근거는 [CRD 스키마 타입](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1/types_jsonschema.go)과 [Pod·Container 타입의 list marker](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/core/v1/types.go)입니다

### CRD의 추론형 변환기는 모든 필드를 atomic으로 묶지 않습니다

서버는 CRD의 스키마로 Apply용 OpenAPI 모델을 만듭니다
모델 생성에 실패하거나 모델이 비어 있으면 `NewDeducedTypeConverter`라는 추론형 변환기를 사용합니다
반면 모델이 있는데 `NewTypeConverter` 생성이 실패하면 그 오류를 반환합니다
모든 변환 오류가 추론형 처리로 넘어가는 것은 아닙니다

추론형 변환기의 주석에는 모든 필드를 atomic으로 병합한다는 설명이 남아 있습니다
하지만 실제 `DeducedParseableType`은 맵 키를 분리하고 리스트를 atomic으로 정의합니다
주석의 표현만으로 맵 전체도 한 소유 단위라고 읽으면 구현과 달라집니다

`apiextensions.k8s.io/v1` CRD에는 구조적 스키마가 필요합니다
따라서 이 대체 경로를 스키마 없는 CRD의 일반적인 사용 방식으로 소개해서도 안 됩니다

근거는 [모델·변환기 생성 분기](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apiserver/customresource_handler.go), [변환기 주석](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/util/managedfields/internal/typeconverter.go), [실제 추론형 스키마](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/vendor/sigs.k8s.io/structured-merge-diff/v6/typed/parser.go)입니다

## 스키마의 관리 단위를 바꾸면 기존 소유권 해석도 바뀝니다

topology는 리스트·맵·구조체를 어느 단위로 병합하고 소유할지 정한 구조입니다
API 버전을 그대로 둔 채 이 구조를 바꾸면 이미 저장된 `managedFields`도 새 구조로 해석해야 합니다

![필드별 관리에서 전체 관리로 바꿀 때와 전체 관리에서 필드별 관리로 바꿀 때의 소유권 차이](/diagrams/k8s-theory-server-side-apply-2.svg)

`map`·`set`·`granular`에서 `atomic`으로 바꾸면 원소나 내부 필드를 소유했던 매니저가 전체를 소유하게 됩니다
그 뒤에는 전에 독립적으로 바꾸던 부분도 다른 매니저와 충돌할 수 있습니다

반대 방향은 충돌이 사라질 수 있어서 더 알아차리기 어렵습니다
전체를 소유했다는 기록만으로는 서버가 내부 필드의 주인을 나눠 복원할 수 없기 때문입니다
예를 들어 atomic 맵을 granular로 바꾸면 매니저가 맵 자체의 소유권은 유지하더라도 내부 키의 소유권은 잃을 수 있습니다
다른 매니저가 그 키를 바꾸거나 지울 때 충돌이 발생하지 않을 수 있습니다

충돌이 없다는 사실만으로 소유권이 의도대로 이어졌다고 판단할 수는 없습니다
공식 문서도 [atomic에서 세분화된 topology로 바꾸는 방향](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/using-api/server-side-apply.md#compatibility-across-topology-changes)을 권장하지 않습니다

## API 버전이 달라도 비교할 수 있지만 조건이 있습니다

`managedFields.apiVersion`이 요청 버전과 다르다고 해서 곧바로 소유권 비교를 포기하지는 않습니다
변환 가능한 버전과 필드라면 같은 필드의 변경을 두고 충돌을 판단할 수 있습니다

병합기는 객체를 변환의 중간 기준인 hub 버전을 거쳐 각 매니저가 기록한 버전으로 옮겨 비교합니다
이 경로는 [`versionConverter.Convert`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/util/managedfields/internal/versionconverter.go)에 있습니다

다만 매니저가 기록한 버전을 더 이상 찾을 수 없다는 오류라면, 병합기는 그 항목을 제거하고 진행합니다
그 밖의 변환 오류는 반환합니다
모든 API 버전 변경에서 기존 소유권이 그대로 보존된다고 보장하는 구조는 아닙니다

소유한 필드를 모두 잃은 매니저 항목도 제거됩니다
다른 매니저에게 필드가 넘어갔거나 자신이 관리에서 뺐을 때, 빈 항목이 계속 남지는 않습니다
이 조건은 [`Updater.update`의 정리 루프](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/vendor/sigs.k8s.io/structured-merge-diff/v6/merge/update.go)에서 확인할 수 있습니다

## client-side apply와 다른 판단 재료가 생깁니다

client-side apply는 `kubectl.kubernetes.io/last-applied-configuration` 어노테이션에 지난 적용 내용을 남깁니다
클라이언트가 지난 설정·현재 서버 값·이번 설정을 비교해 변경안을 계산하는 방식입니다
이 기록은 서버가 유지하는 필드별 매니저 집합과 다릅니다

SSA는 서버가 그 집합을 유지하므로, 다른 매니저가 관리하는 값을 바꾸려는 요청에 충돌을 알릴 수 있습니다
HPA의 복제본 수와 GitOps 도구의 이미지 설정처럼 관리 범위도 필드별로 나눌 수 있습니다

그래도 Update가 값을 바꾸거나 스키마가 소유 단위를 바꾸는 경우까지 충돌 하나로 모두 알 수는 없습니다
현재 값, `managedFields`, 요청의 Apply·Update 구분, 병합 스키마를 함께 읽어야 필드가 왜 바뀌었는지 판단할 수 있습니다
