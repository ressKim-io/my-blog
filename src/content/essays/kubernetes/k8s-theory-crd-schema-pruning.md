---
title: "CRD 구조 — 스키마가 검사하고 남기는 필드"
excerpt: "CRD와 CR의 관계에서 시작해 structural schema, pruning, defaulting과 CEL 검증을 따라갑니다. status·scale의 쓰기 경계, 리스트·맵의 SSA 관리 단위, 출력·검색 필드의 선언도 구분합니다"
category: "kubernetes"
tags: ["Kubernetes", "CRD", "Schema", "CEL", "Server-Side Apply", "concept"]
series:
  name: "k8s-theory-extension"
  order: 1
date: "2026-10-23"
---

CRD를 등록하면 API 서버가 새 종류의 오브젝트를 받아들일 수 있습니다
그 오브젝트에 실행 개수를 적었다고 실제 자원이 그 수만큼 생기는 것은 아닙니다

**CustomResourceDefinition(CRD)**은 리소스 종류의 정의이고, **CustomResource(CR)**는 그 정의에 따라 만드는 개별 오브젝트입니다
CRD에는 필드 구조와 검증·기본값·노출 범위를 선언합니다
원하는 상태에 맞춰 실제 자원을 조정하는 controller는 별도 구현입니다

> **근거**: Kubernetes v1.37.1 `f78e722310e50bcaca9276be22276d9e91d91308`과 공식 문서 저장본 `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`를 대조했습니다
> 현재 go.mod의 cel-go는 v0.29.2, structured-merge-diff/v6는 v6.4.2입니다
> 클러스터에서 CR 생성·webhook 패치·저장 바이트·에러 응답을 재현한 실측 기록은 포함하지 않습니다

## CRD 정의를 읽는 서버가 CR의 저장도 맡습니다

CRD 자체는 `apiextensions.k8s.io/v1`의 API 오브젝트입니다
CR 요청은 CRD가 정한 group·version·plural과 scope를 사용합니다
namespaced 리소스라면 경로는 `/apis/<group>/<version>/namespaces/<namespace>/<plural>/<name>` 형태입니다

apiextensions의 [crdHandler](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apiserver/customresource_handler.go)는 `<plural>.<group>` 이름으로 CRD를 찾습니다
요청의 scope와 served 버전, CRD 상태 등을 확인하고 CR용 저장소와 처리기를 선택합니다
CR은 생성된 Go 구조체가 아니라 `Unstructured`로 다루며, 스키마가 구조 정보를 제공합니다

CR을 받아 검증하고 저장하는 주체는 API 서버입니다
사용자 controller가 데이터를 대신 etcd에 저장하거나 CRUD 서버를 따로 구현해야 하는 방식은 아닙니다
다만 CRD 생성 요청의 성공과 discovery·서빙 상태가 모든 클라이언트에 반영된 시점은 같지 않을 수 있습니다

## CR 생성 요청은 변경 결과를 검증한 뒤 저장합니다

아래는 인증·인가 같은 공통 경로를 통과한 CR 생성 요청의 필드 처리 흐름입니다
디코딩 단계의 가지치기와 기본값 적용, mutating admission 뒤 검증, 저장 코덱을 구분합니다

![CR 생성 요청이 디코딩·가지치기·기본값, mutating admission, 스키마·CEL 검증, validating admission을 거쳐 저장되는 경로|tall](/diagrams/k8s-theory-crd-schema-pruning-1.svg)

필드 구조와 CEL 규칙은 CRD에 있지만 `fieldValidation`은 요청 옵션입니다
RBAC는 누가 어느 리소스 경로에 접근할지 정하며 admission 정책은 추가 변경·검증을 수행합니다
스키마의 유효성, 요청자의 권한, 외부 정책의 허용 여부를 같은 판정으로 묶으면 안 됩니다

## structural schema는 임의 JSON을 허용할 범위도 선언합니다

**structural schema**는 서버가 필드의 구조와 임의 JSON 허용 범위를 알 수 있도록 제한한 스키마입니다
새 `apiextensions.k8s.io/v1` CRD의 `spec.versions[].schema.openAPIV3Schema`에 선언합니다
단순히 OpenAPI 문법을 아무 형태로나 넣을 수 있는 칸은 아닙니다

주요 규칙은 다음과 같습니다

- 루트에 type을 명시할 때는 `object`를 사용합니다
- type은 일반적으로 필요하지만 `x-kubernetes-preserve-unknown-fields: true`인 노드는 루트에서도 생략할 수 있습니다
- IntOrString·embedded-resource 등 추가 선언에는 별도 제약이 있습니다
- `allOf`·`anyOf`·`oneOf`·`not` 안에서 참조한 필드·원소의 구조는 그 밖에도 선언합니다
- 이 결합자 안에는 type·default·description·additionalProperties·nullable을 두지 않습니다. IntOrString의 허용 패턴은 예외입니다
- metadata에 직접 제약을 선언한다면 name·generateName으로 제한됩니다

`$ref`·definitions·patternProperties·readOnly 등의 키와 `uniqueItems: true`, `additionalProperties: false`도 허용하지 않습니다
미선언 필드의 저장을 제한하는 주된 방식은 거절만이 아니라 다음 절의 pruning입니다

### 확장 필드는 허용 범위·관리 단위·검증을 나눕니다

현재 JSONSchemaProps에 있는 일곱 확장은 역할이 다릅니다

| 확장 | 역할 |
|---|---|
| `x-kubernetes-preserve-unknown-fields` | 해당 노드의 미선언 데이터를 보존 |
| `x-kubernetes-int-or-string` | 정수 또는 문자열 허용 |
| `x-kubernetes-embedded-resource` | 내장 오브젝트의 apiVersion·kind·metadata를 암묵적으로 검증 |
| `x-kubernetes-list-type` | 배열의 atomic·set·map 단위 지정 |
| `x-kubernetes-list-map-keys` | map 리스트의 원소 식별 키 지정 |
| `x-kubernetes-map-type` | 오브젝트의 granular·atomic 단위 지정 |
| `x-kubernetes-validations` | CEL 검증 규칙 선언 |

embedded-resource는 오브젝트를 담는 데이터 구조입니다
이 선언만으로 별도의 자식 리소스를 생성하거나 reconcile하는 기능이 생기지는 않습니다
근거는 [JSONSchemaProps의 필드·주석](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1/types_jsonschema.go)과 [구조 스키마 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apiserver/schema/validation.go)입니다

### 리스트·맵의 단위는 SSA의 소유권에도 쓰입니다

배열은 기본적으로 atomic이며 리스트 전체를 한 단위로 취급합니다
set은 중복 없는 값으로 원소를 식별하고, map 리스트는 `x-kubernetes-list-map-keys`의 키 필드로 원소를 식별합니다
map 키는 원소 안의 스칼라 필드이며 required 또는 default로 값이 존재하도록 해야 합니다

오브젝트의 기본 granular는 내부 필드를 나눠 다루고 atomic은 오브젝트 전체를 한 단위로 다룹니다
이 선언은 [Server-Side Apply의 필드 관리](/essays/k8s-theory-server-side-apply)에도 사용됩니다
누가 어느 단위를 소유하는지 정하는 구조이지 RBAC 권한 자체는 아닙니다

set·map 리스트에는 중복 값·중복 키 검사도 붙습니다
기존 스키마의 관리 단위를 바꾸면 이미 기록된 managedFields의 해석과 충돌 범위도 바뀔 수 있습니다
필드 타입이 같다는 이유만으로 topology 변경을 안전한 설명 수정으로 취급하면 안 됩니다

## pruning과 unknown-field 요청 거절은 다른 동작입니다

**가지치기(pruning)**는 스키마에 없는 필드를 제거하는 동작입니다
미선언 `someRandomField: 42`를 보냈을 때 요청이 수락돼도 그 값이 결과에 남지 않을 수 있습니다
요청을 거절할지 알릴지는 `fieldValidation`으로 구분합니다

| 요청 값 | unknown field를 발견한 경우 |
|---|---|
| Ignore | 별도 경고 없이 진행할 수 있으며 미선언 필드는 가지치기 대상 |
| Warn | Warning 헤더를 알리고 진행할 수 있으며 미선언 필드는 가지치기 대상 |
| Strict | strict decoding 오류로 요청 거절, HTTP 400 |

서버는 이 옵션이 없으면 Warn을 사용합니다
현재 kubectl의 `--validate` 기본값은 strict이며 서버에 Strict를 전달합니다
`--validate=false`와 ignore는 Ignore로 해석합니다

클라이언트 검증과 서버 검증도 별개입니다
kubectl은 서버의 fieldValidation 지원 여부에 따라 클라이언트 검증으로 보완할 수 있으며 모든 aggregated API의 지원 상태까지 같다고 가정하지 않습니다
이 옵션은 스키마 검증 전체를 끄는 스위치가 아닙니다

### 보존 표시는 하위의 모든 필드를 영원히 여는 설정이 아닙니다

임의 JSON을 보존할 노드는 다음처럼 표시할 수 있습니다

```yaml
type: object
properties:
  json:
    x-kubernetes-preserve-unknown-fields: true
```

이 확장 값은 true 또는 미설정만 허용하고 false는 거절합니다
그 아래에서 properties나 additionalProperties로 구조를 다시 선언하면 해당 선언을 따라 정상 가지치기가 재개됩니다
임의 JSON을 보존하는 것과 그 내부를 CEL에서 필드로 참조할 수 있는 것도 다릅니다
스키마가 모르는 보존 데이터는 CEL에서 접근할 수 없습니다

CRD 전체의 옛 `spec.preserveUnknownFields`와 이 노드별 확장은 구분해야 합니다
새 CRD에 전역 값을 true로 설정하는 경로는 거절하며, 기존 legacy CRD를 위한 호환 예외가 별도로 있습니다

### 저장 경로의 가지치기 횟수는 고정되지 않습니다

현재 구현은 요청 디코딩뿐 아니라 저장소에서 읽는 디코딩과 변환 결과에도 스키마 처리를 붙입니다
그러나 저장 인코더는 오브젝트의 GVK가 목표와 같으면 변환 없이 바로 인코딩하는 분기가 있습니다
mutating webhook 뒤에 항상 두 번째 가지치기가 실행된다고 말할 수는 없습니다

조회 결과에서 필드가 사라진 것과 저장 바이트에 처음부터 없었던 것도 다른 판정입니다
이 경계는 [schemaCoercingDecoder·Converter](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apiserver/customresource_handler.go)와 [codec.doEncode](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/runtime/serializer/versioning/versioning.go)에 근거합니다
실제 패치가 같은 버전의 저장 바이트에 남는지는 이 글에서 재현하지 않았습니다

## 기본값은 요청과 읽기·패치 결과에 적용됩니다

defaulting은 별도 사용자 controller가 아니라 API 서버의 스키마 처리입니다
요청에는 요청 버전의 기본값을, 저장소에서 읽을 때는 저장 버전의 기본값을 적용합니다
mutating webhook의 비어 있지 않은 패치 결과에도 defaulter가 호출되며 현재 MAP의 패치 결과도 기본값 처리로 이어집니다

읽는 과정에서 붙은 기본값이 기존 etcd 바이트를 자동으로 다시 쓰지는 않습니다
저장본을 바꾸려면 별도 쓰기가 필요합니다

nullable이 true인 null은 보존하며 default로 바꾸지 않습니다
nullable이 아니거나 false인 null은 제거·defaulting 과정에서 기본값이 있으면 그 값을 받을 수 있습니다
값이 없음, 명시적 null, 기본값 적용을 같은 상태로 다루지 않아야 합니다

## CEL은 같은 오브젝트 안의 관계를 검사합니다

**CEL(Common Expression Language)** 규칙은 `x-kubernetes-validations`에 선언합니다
OpenAPI가 타입·범위를 정한다면 CEL은 같은 오브젝트 안의 필드 관계도 검사할 수 있습니다
이 기능은 v1.29 stable입니다

다음은 규칙을 단 노드에 minReplicas와 replicas가 선언돼 있다는 전제의 예시입니다

```yaml
x-kubernetes-validations:
  - rule: "self.minReplicas <= self.replicas"
    message: "replicas should be greater than or equal to minReplicas"
```

self는 규칙을 단 스키마 노드의 현재 값입니다
규칙이 다른 CR이나 외부 시스템의 현재 상태를 조회하는 것은 아닙니다
직전 값은 조건에 따라 oldSelf로 참조하며 이 범위를 넘는 검증은 다른 정책·admission 구현이 필요합니다

### oldSelf와 오류 reason에도 조건이 있습니다

oldSelf를 쓰는 **transition rule**은 기본적으로 옛 값과 새 값을 짝지을 수 있을 때 평가합니다
`optionalOldSelf: true`이면 생성이나 새 필드 추가에서도 평가하고, oldSelf를 값이 없을 수 있는 CEL Optional로 제공합니다
규칙에서 oldSelf를 쓰지 않으면서 optionalOldSelf만 설정할 수는 없습니다

배열에서 이전 원소와 새 원소를 대응할 수 있어야 하므로 atomic·set 배열 아래처럼 상관관계를 정할 수 없는 곳의 oldSelf 규칙은 CRD 검증에서 거절합니다
현재 값에 대한 규칙과 이전 값까지 필요한 규칙을 같은 적용 범위로 보면 안 됩니다

`reason`은 FieldValueInvalid·FieldValueForbidden·FieldValueRequired·FieldValueDuplicate 중 실패 원인의 종류를 나타냅니다
공식 문서에는 첫 실패의 reason이 HTTP 코드를 정한다고 적혀 있습니다
그러나 현재 CR 생성·업데이트 검증 경로는 오류를 NewInvalid로 감싸므로 **HTTP 422**를 반환하고 원인은 `details.causes[].reason`에 담습니다
여기서는 [fieldErrorForReason](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apiserver/schema/cel/validation.go)과 [NewInvalid](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/api/errors/errors.go)의 경로를 기준으로 구분했습니다

### 계산 비용은 정의와 실행 시점에 각각 제한합니다

CEL은 API 서버 안에서 실행되므로 표현식의 논리뿐 아니라 계산량도 제한합니다

| 시점 | 제한 대상 | 현재 값 |
|---|---|---:|
| CRD 정의 검증 | 표현식 하나의 추정 비용 | 1000만 |
| CRD 정의 검증 | 스키마 규칙들의 추정 합 | 1억 |
| CR 검증 실행 | 호출 하나의 실행 비용 | 100만 |
| CR 검증 실행 | 오브젝트 검증의 실행 예산 | 1000만 |

maxItems·maxLength·maxProperties 같은 상한은 비용 추정에도 쓰입니다
상한이 없다는 이유만으로 모든 반복식이 거절되는 것은 아니지만, 큰 입력을 가정한 중첩 연산은 추정 한도를 넘을 수 있습니다
이 숫자는 계산량 예산이며 일정한 응답 시간이나 타임아웃을 보장하는 실측값이 아닙니다

스키마·embedded metadata·리스트 불변식 검사 뒤에 CEL이 이어집니다
일부 Required·TypeInvalid 같은 선행 오류는 CEL 평가를 건너뛰게 합니다
이때 `some validation rules were not checked because the object was invalid`가 붙을 수 있으므로 첫 오류를 고친 뒤 다른 규칙의 오류가 드러날 수 있습니다

### ratcheting이 모든 스키마 변경을 안전하게 만들지는 않습니다

**validation ratcheting**은 업데이트에서 바꾸지 않은 부분의 기존 검증 오류를 허용하는 기능입니다
새 규칙에 이미 어긋난 값을 그대로 두고 다른 필드를 수정할 수 있게 하되, 유효하던 값을 새로 잘못 만들도록 허용하지는 않습니다
CRDValidationRatcheting은 v1.33부터 GA·true로 잠겨 있습니다

required·논리 결합자·메타데이터 내장 검증, 필드 이름과 topology 변경 등에는 제한이 있습니다
oldSelf를 쓰는 CEL 규칙도 자동 ratcheting 대상으로 보지 않습니다
리스트 불변식에는 이전 오브젝트의 오류와 비교하는 별도 분기도 있으므로 ‘기존 오브젝트는 모든 검사를 면제받는다’는 뜻으로 읽으면 안 됩니다

## status와 scale은 같은 오브젝트에 다른 경로를 붙입니다

**subresource**는 같은 오브젝트를 별도 API 경로로 읽거나 쓰는 인터페이스입니다
CRD에서 status와 scale을 켜면 본체와 함께 세 경로가 같은 CR 저장소를 사용합니다

![본체·status·scale은 쓰기 전략과 RBAC 이름이 다르지만 같은 CR 오브젝트와 저장 키·resourceVersion을 공유하는 구조](/diagrams/k8s-theory-crd-schema-pruning-2.svg)

status subresource가 활성화된 경우의 쓰기 차이는 다음과 같습니다

| 경로 | 요청에서 받아들이는 변경 |
|---|---|
| 본체 | 생성 시 status 제거, 업데이트 시 status를 이전 값으로 되돌림 |
| `/status` | 이전 오브젝트를 보존하고 새 status를 반영, managedFields 처리 보존 |
| `/scale` | autoscaling/v1 Scale로 지정한 replicas 경로를 읽고 갱신 |

현재 [NewStorage](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/registry/customresource/etcd.go)는 본체 store를 공유하고 status의 쓰기 전략을 바꿉니다
`/status`에 label이나 finalizer를 함께 보내도 새 metadata로 반영하지 않습니다
managedFields는 그 status 업데이트에서 이미 처리한 기록을 보존하는 예외입니다

### 필드 경계와 동시성 검사는 서로 다른 보호입니다

서로 다른 경로도 resourceVersion을 공유하므로 동시 업데이트의 409 충돌까지 없어지지는 않습니다
오래된 값을 보내는 충돌을 잡는 것과 최신 버전으로 남의 담당 필드를 바꾸지 못하게 하는 것은 다른 문제입니다
쓰기 전략은 후자를 제한하고 RBAC도 `<plural>/status`·`<plural>/scale` 이름으로 권한을 나눕니다

이 subresource의 discovery 동사는 get·patch·update입니다
`crontabs/status` 업데이트 권한만 줬다고 본체 spec 수정 권한까지 생기는 것은 아닙니다
SSA가 사용하는 reset-field 집합도 본체의 status와 status 경로의 spec을 구분하지만 RBAC 자체를 대신하지는 않습니다

status subresource가 있으면 metadata·status를 제외한 변경이 generation을 올립니다
없으면 status 변경도 이 비교에 포함되므로 generation을 언제나 spec만의 변경 번호로 읽으면 안 됩니다
CRDObservedGenerationTracking은 CRD **정의 자체**의 상태 추적 기능이며, 현재 v1.36부터 beta·기본 활성입니다
이 gate가 사용자 CR의 observedGeneration을 자동으로 채우는 것은 아닙니다

### scale은 표준 타입으로 값을 투영합니다

specReplicasPath와 statusReplicasPath는 각각 `.spec`·`.status` 아래 replicas를 가리키는 필수 경로입니다
labelSelectorPath는 선택 사항이지만 HPA·VPA와 연결하려면 문자열 selector 경로가 필요합니다
HPA가 사용자 CR의 전체 구조를 몰라도 Scale 인터페이스로 연결할 수 있는 이유입니다

현재 구현에서 spec 경로의 값이 없으면 Scale GET은 HTTP 500이고 status 경로의 값이 없으면 0을 사용합니다
단순히 JSONPath를 선언했다고 값이나 해당 워크로드를 조정하는 controller까지 생기는 것은 아닙니다
`/scale`의 admission 객체도 사용자 Kind 대신 Scale로 보이므로 정책 매칭 범위를 별도로 확인해야 합니다

## 출력 열·검색 필드·scope에도 선언의 경계가 있습니다

kubectl의 기본 표는 서버의 Table 응답을 사용합니다
Name은 기본 제공되고 additionalPrinterColumns가 비어 있으면 Age 열이 추가됩니다
사용자 열을 넣었다면 Age가 필요할 때 직접 선언해야 합니다
일반 출력은 priority가 0인 열을, wide 출력은 추가 우선순위 열도 표시하므로 터미널 폭만의 문제로 설명하면 안 됩니다

field selector는 기본적으로 metadata.name을 지원합니다
namespaced CR에는 metadata.namespace도 있지만 cluster-scoped CR에는 namespace selector가 없습니다
그 외 selectableFields는 버전당 최대 8개이며 배열 표기 없이 string·boolean·integer 필드를 가리켜야 합니다
metadata 경로를 추가 선언할 수는 없고, 이 기능은 v1.32 GA·true로 잠겨 있습니다

### scope는 저장 키와 소유 관계를 바꿉니다

기본 저장 prefix를 가정하면 namespaced CR의 키에는 group·plural·namespace·name이 들어갑니다
cluster-scoped CR에서는 namespace 부분이 빠집니다
`/registry` 같은 prefix 자체가 리소스 API로 고정돼 있다는 뜻은 아닙니다

group과 names.plural은 항상 불변이고 scope와 names.kind는 기존 CRD가 Established=True가 된 뒤 불변입니다
이름만 바꾸는 UI 설정이 아니라 저장·리소스 신원을 바꾸는 값이기 때문입니다

소유 관계에도 방향 제약이 있습니다
cluster-scoped 자식은 cluster-scoped 주인만 참조할 수 있으므로 namespaced CR을 그 자식의 ownerReference로 두는 방식은 맞지 않습니다
이 경우 GC가 수거하지 못할 수 있으며 직접 삭제나 소유 관계 수정까지 불가능하다는 뜻은 아닙니다
자세한 소유 범위는 [오브젝트 신원과 소유](/essays/k8s-theory-object-identity-ownership)에서 다룹니다

## 응답과 다시 읽은 필드를 함께 확인합니다

| 표시·오류 | 구분할 경계 |
|---|---|
| strict decoding error | 요청의 fieldValidation과 현재 스키마의 필드 선언 |
| 성공했지만 필드가 없음 | unknown-field 보존 범위·pruning·읽기와 저장 바이트의 차이 |
| CEL 추정 비용 초과 | CRD 정의 시점의 입력 상한과 규칙 계산량 |
| running out of cost budget | CR 쓰기의 실행 예산·규칙·입력 크기 |
| status나 metadata 변경이 되돌아옴 | 본체와 status 중 어느 경로로 썼는지 |
| Scale GET의 spec replicas field 오류 | 필수 경로 선언뿐 아니라 CR에 실제 값이 있는지 |
| CRD 등록 직후 타입을 못 찾음 | 서빙 상태·discovery 반영·클라이언트 캐시 |

표는 재현한 장애 결과가 아니라 소스가 제공하는 확인 기준입니다
필드가 없어졌다면 보존·가지치기 경계를, 값이 이전 값으로 돌아갔다면 쓰기 경로와 전략을 먼저 구분할 수 있습니다

## 확인한 근거

- [공식 CRD 문서 저장본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definitions.md), [CRD handler·codec](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apiserver/customresource_handler.go) — 구조·가지치기·기본값·동적 처리 경계
- [CR 쓰기 전략](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/registry/customresource/strategy.go), [status 전략](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/registry/customresource/status_strategy.go), [공유 저장소·Scale](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/registry/customresource/etcd.go) — 검증 순서·필드 보존·generation·투영
- [CRD 검증·정적 CEL 비용](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/validation/validation.go), [CEL 실행·reason](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apiserver/schema/cel/validation.go), [실행 예산](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/apis/cel/config.go), [현재 gate](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/features/kube_features.go) — 현행 조건·예외
