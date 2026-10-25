---
title: "CRD 버저닝 — 저장 목표와 기존 저장본을 나눕니다"
excerpt: "served·storage·storedVersions가 가리키는 대상을 구분합니다. None과 Webhook의 변환 경로, ConversionReview의 검사, 저장 버전 혼재와 실제 재쓰기, 옛 버전 제거 전 필요한 확인을 따라갑니다"
category: "kubernetes"
tags: ["Kubernetes", "CRD", "Conversion", "API", "concept"]
series:
  name: "k8s-theory-extension"
  order: 2
date: "2026-11-02"
---

같은 커스텀 리소스(CR)를 v1alpha1으로 쓰고 v1으로 읽을 수 있어도, 버전마다 별개의 CR을 저장하는 것은 아닙니다
API 서버는 현재 저장 목표로 지정한 버전으로 쓰고, 요청 경로에서 필요한 표현으로 변환합니다

다만 **현재 저장 목표가 하나라는 규칙은 기존 저장본의 버전까지 통일됐다는 뜻이 아닙니다**
저장 버전 설정을 바꿔도 이미 저장된 CR이 전부 다시 써지지는 않으므로, 옛 저장본과 새 저장본이 함께 남을 수 있습니다

> **근거**: Kubernetes v1.37.1 소스 `f78e722310e50bcaca9276be22276d9e91d91308`과 공식 문서 저장본 `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`를 대조했습니다
> 과거 v1.35의 마이그레이터와 현행의 API·게이트·패치 형식을 구분합니다
> 실제 CRD 설치·webhook 장애·etcd 저장 형식·마이그레이션을 재현하거나 측정한 기록은 포함하지 않습니다

## 쓰기 목표와 읽기 표현 사이에 변환이 있습니다

CRD(CustomResourceDefinition)는 CR의 API와 버전별 구조를 선언합니다
다음 그림은 v1alpha1을 서빙하고 현재 storage는 v1이며, Webhook 전략을 사용하는 경우의 예시입니다

![v1alpha1 쓰기를 API 서버가 현재 storage인 v1으로 변환해 저장하고 이후 v1alpha1 조회에서는 해당 저장본을 다시 요청 버전으로 변환하는 흐름|xtall](/diagrams/k8s-theory-crd-version-conversion-1.svg)

쓰기에서는 요청 오브젝트를 현재 저장 버전으로 인코딩합니다
읽기에서는 저장된 표현을 디코딩하고 필요한 요청 버전으로 변환합니다
현재 저장 코덱의 `encoderVersion`과 `decoderVersion`을 따로 설정하는 이유입니다

이 그림을 거친 CR은 v1으로 저장되지만, 쓰기를 거치지 않은 다른 CR까지 함께 바뀌지는 않습니다
읽기·목록·watch에서도 캐시와 변환 단계가 추가될 수 있으므로 이 그림을 모든 내부 호출 횟수로 해석하면 안 됩니다

## served·storage·deprecated는 서로 다른 결정을 합니다

`spec.versions[]`의 세 플래그는 서빙·저장·경고를 각각 정합니다

| 플래그 | 정하는 것 | 다른 플래그와의 관계 |
|---|---|---|
| served | 해당 버전의 API 요청과 discovery 노출 | 여러 버전을 동시에 서빙할 수 있음 |
| storage | 앞으로 저장할 때의 목표 버전 | 정확히 하나만 true |
| deprecated | 해당 버전 응답의 deprecation 경고 | true여도 서빙 자체를 중단하지 않음 |

storage가 없거나 둘 이상이면 CRD 검증이 `must have exactly one version marked as storage version`으로 거절합니다
반면 `served: false`와 `storage: true`는 함께 사용할 수 있습니다
외부에 그 버전의 API 경로를 제공하지 않아도 내부 저장 목표로는 사용할 수 있습니다

served가 false인 버전의 요청은 CRD 핸들러가 다음 핸들러에 넘기며, 일반적으로 없는 API 경로의 404가 됩니다
served를 끄는 것과 저장된 옛 버전의 지원을 `spec.versions`에서 제거하는 것은 다른 변경입니다


클라이언트에 우선 안내할 버전과 내부 저장 목표도 별도로 정합니다

## None은 필드 변환을 대신하지 않습니다

변환 전략은 `None`과 `Webhook`입니다
None 변환기 자체는 apiVersion을 바꾸고 CR의 필드를 다른 구조로 옮기지 않습니다
같은 이름의 필드가 다른 의미·위치로 바뀌어도 알아서 대응시켜 주지 않습니다

None 변환기가 필드를 건드리지 않는다고 해서 요청 처리 중에도 값이 모두 보존되는 것은 아닙니다
schema coercing converter를 거치는 경로에서는 변환된 오브젝트의 버전 스키마로 가지치기(pruning)를 합니다
목표 스키마에 없는 필드는 보존 예외가 없다면 제거될 수 있습니다

이 때문에 None으로 서로 다른 스키마를 연결하면 다른 검증을 통과한 요청에서도 응답이나 이후 저장본의 값이 빠질 수 있습니다
변환을 거치는지·같은 GVK(API group·version·kind)의 인코딩으로 변환을 우회하는지에 따라 경로가 다르므로 가지치기가 항상 같은 횟수로 실행된다고 설명하지도 않습니다

Webhook 전략에서는 별도의 서비스가 필드의 의미와 구조를 변환합니다
`spec.conversion.webhook` 설정이 필요하고 `spec.preserveUnknownFields`가 false여야 합니다
구조 스키마·보존 예외·defaulting의 세부는 [CRD 구조와 가지치기](/essays/k8s-theory-crd-schema-pruning)에서 이어집니다

실제 None 변환은 [nop_converter.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apiserver/conversion/nop_converter.go), 목표 버전 스키마 선택은 [schemaCoercingConverter·unstructuredSchemaCoercer](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apiserver/customresource_handler.go)에 있습니다

## storedVersions는 남아 있는 CR의 개수를 기록하지 않습니다

`status.storedVersions`는 저장 버전으로 지정돼 사용됐을 수 있는 버전을 기록합니다
CR을 저장할 때마다 개수를 세어 갱신하는 필드가 아닙니다
현재 코드는 CRD 생성·업데이트에서 storage인 버전이 아직 목록에 없으면 추가합니다

따라서 CR이 하나도 없어도 저장 목표를 바꾸면 목록에 새 버전이 들어갈 수 있습니다
반대로 옛 형식의 CR을 모두 다시 썼다고 CRD의 이 목록을 자동으로 줄여 주지도 않습니다

![storage를 v1alpha1에서 v1으로 바꾼 뒤 CR B만 재쓰면 CR A의 옛 저장본과 혼재하고 전수 재쓰기 확인 뒤에야 storedVersions 장부를 정리하는 두 객체 예시|tall](/diagrams/k8s-theory-crd-version-conversion-2.svg)

API 서버가 검증하는 것은 목록이 비어 있지 않고, 현재 storage 버전을 포함하며, 각 버전이 spec.versions에도 존재하는지입니다
실제 etcd에 어느 형식의 CR이 몇 개 남았는지 조사하지 않습니다

storedVersions에 있는 버전을 spec.versions에서 빼면 업데이트를 거절합니다
그러나 실제 데이터가 남았는데도 status를 성급하게 줄이면 그 검증을 통과한 뒤 옛 저장본의 읽기가 깨질 수 있습니다
`/status`의 장부 수정과 실제 CR 재쓰기를 같은 작업으로 취급하면 안 됩니다

추가 시점은 [CRD strategy](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/registry/customresourcedefinition/strategy.go), 목록의 일관성 검증은 [ValidateCustomResourceDefinitionStoredVersions](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/validation/validation.go)에 있습니다

## 옛 버전 제거에는 실제 재쓰기 확인이 필요합니다

| 이행 단계 | API 서버가 강제하는 것·별도 확인할 것 |
|---|---|
| 새 버전을 served: true, storage: false로 추가 | 새 요청 형식·변환을 준비하고 클라이언트 이행 확인 |
| storage: true를 새 버전으로 이동 | storage는 정확히 하나여야 함, 기존 데이터는 그대로일 수 있음 |
| 기존 CR을 현재 저장 목표로 다시 쓰기 | 설정 변경만으로 실행되지 않음, 실제 이행 완료를 별도로 확인 |
| status.storedVersions에서 옛 버전 제거 | 목록·현재 storage·spec.versions의 일관성을 검증하며 잔존 데이터는 세지 않음 |
| 옛 버전을 spec.versions에서 제거 | storedVersions에 남아 있으면 거절 |

served를 끄는 시점 자체를 서버가 이 다섯 단계에 묶어 강제하지는 않습니다
클라이언트 이행과 실제 저장본 이행은 별도로 확인해야 합니다
서빙을 껐더라도 옛 저장본을 해석하는 데 필요한 버전 선언과 변환 지원까지 곧바로 없애면 안 됩니다

### 재쓰기는 값을 바꾸는 것과 다릅니다

수락된 업데이트가 저장 코덱을 거치면 현재 저장 목표로 인코딩됩니다
spec 값을 바꾸지 않아도 저장 형식을 바꾸는 요청이 될 수 있습니다

다만 직렬화한 바이트가 기존 저장본과 같고 저장 변환 층도 stale하지 않으면 실제 etcd 쓰기를 생략할 수 있습니다
옛 저장 버전의 바이트가 새 버전 인코딩과 달라지는 경우는 이 동일성 조건에 해당하지 않습니다
따라서 성공한 API 응답 수만으로 모든 요청이 실제 etcd 쓰기를 발생시켰다고 계산할 수도 없습니다

## ConversionReview 버전과 CR 버전은 별개입니다

webhook과 API 서버는 `ConversionReview`라는 요청·응답 봉투를 주고받습니다
이 봉투의 버전이 CR의 목표 버전을 정하지는 않습니다

| 버전이 있는 자리 | 무엇의 버전인가 |
|---|---|
| CRD의 apiVersion: apiextensions.k8s.io/v1 | CRD 선언 오브젝트의 API |
| conversionReviewVersions: [v1, v1beta1] | webhook이 이해하고 선호하는 ConversionReview 형식 |
| desiredAPIVersion: example.com/v1 | 이번 호출에서 CR을 변환할 목표 API |

API 서버는 `conversionReviewVersions`를 앞에서부터 확인해 자신이 지원하는 첫 버전을 사용합니다
현재 호출 구현은 v1과 v1beta1을 지원하며, 공통으로 지원하는 버전이 없으면 변환이 실패합니다
새 설정의 목록은 비어 있을 수 없고 서버가 인식하는 버전을 포함하는 검증도 받습니다

### 한 호출에는 변환이 필요한 여러 객체가 들어갈 수 있습니다

요청에는 `uid`, `desiredAPIVersion`, `objects[]`가 들어갑니다
여기서 uid는 CR의 metadata.uid가 아니라 API 서버와 webhook 사이의 이번 왕복을 식별하는 값입니다

목록 변환에서는 이미 목표 apiVersion인 객체를 요청 목록에서 제외합니다
필요한 객체가 없으면 외부 HTTP 호출을 하지 않으며, 여러 객체가 있으면 한 번의 ConversionReview에 담을 수 있습니다
따라서 webhook 요청 개수와 원래 LIST 항목 수가 항상 같지도, CR 하나마다 반드시 HTTP 호출 하나가 발생하지도 않습니다

webhook은 받은 항목을 서로 독립적으로 변환하고 같은 순서로 돌려줘야 합니다
API 서버는 응답을 원래 목록의 해당 위치에 되넣습니다

| 응답 조건 | 현재 검사·처리 |
|---|---|
| Review의 response.uid | 요청 uid를 복사, v1 응답 경로에서 일치 검사 |
| Review의 apiVersion·kind | v1 응답 경로에서 ConversionReview GVK 검사 |
| result.status | Success여야 결과 사용, Failure면 message 등을 오류로 반환 |
| convertedObjects | 보낸 objects와 개수·순서가 같아야 함 |
| 각 CR의 apiVersion·kind | desiredAPIVersion과 원래 kind 확인 |
| 각 CR의 name·namespace·metadata.uid | 원본과 달라지면 변환 실패 |
| 나머지 metadata | 원본으로 복원하되 반환한 labels·annotations만 반영·검증 |

v1beta1 Review 응답은 호환성을 위해 Review GVK와 왕복 uid 검사를 생략합니다
CR 자체의 kind·이름·namespace·metadata.uid 검사까지 생략한다는 뜻은 아닙니다
webhook은 이 호환 분기에 기대지 말고 요청의 Review 버전과 uid를 그대로 맞춰 응답해야 합니다

metadata 내부의 변경 제한과 달리 spec·status 같은 본문은 목표 버전에 맞게 변환할 수 있습니다
이 식별자·형식 검사와 이후의 스키마 가지치기를 구분해야 하며, webhook이 올바른 의미 변환을 했는지까지 서버가 증명해 주지는 않습니다

계약과 버전 선택·검사는 [ConversionReview 타입](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1/types.go)과 [webhook_converter.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apiserver/conversion/webhook_converter.go)에 있습니다

## HTTP 호출 성공과 변환 성공은 다릅니다

정상적인 ConversionReview 응답 계약에서는 변환에 실패했어도 HTTP 200과 `result.status: Failure`로 사유를 전달합니다
이 경우 API 서버는 본문의 result.message를 사용자 오류에 반영합니다
HTTP 500 같은 호출 실패는 그 계약과 별도 오류로 처리합니다

conversion webhook 설정에는 admission webhook의 `failurePolicy`와 `timeoutSeconds` 필드가 없습니다
필요한 변환이 실패하면 이를 무시한 채 원래 표현으로 통과시키는 Ignore 경로도 없습니다

일반적인 기본 webhook HTTP 클라이언트 제한은 응답 본문 읽기까지 포함해 30초입니다
CRD에서 timeoutSeconds로 이 값을 조절할 수 없으며, 네트워크 오류나 잘못된 응답은 더 일찍 실패할 수 있습니다
이 숫자를 전체 API 요청의 완료 시각이나 항상 30초를 기다린다는 뜻으로 쓰면 안 됩니다

현재 구현은 [authentication.go의 기본 클라이언트 설정](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/util/webhook/authentication.go)과 [webhook HTTP 제한](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/util/webhook/webhook.go)에 근거합니다

### 장애 범위는 요청이 거치는 변환마다 판단합니다

변환이 필요한 자리는 다른 저장 형식의 조회·LIST·watch 응답, 현재 storage와 다른 버전의 쓰기 등에 있습니다
각 변환에서 입력 apiVersion과 목표 버전을 비교하므로 같은 버전인 항목은 외부 호출 대상에서 빠질 수 있습니다

하지만 그 조건 하나로 ‘webhook이 꺼져도 옛 버전 요청은 항상 된다’고 보장할 수는 없습니다
캐시 준비·목록의 다른 객체·admission·저장 인코딩처럼 같은 요청의 다른 단계에서 별도의 변환이 필요할 수 있습니다

일반 DELETE도 기존 객체를 먼저 읽어 조건·UID·finalizer를 처리합니다
이 디코딩에 변환이 필요하고 실패하면 삭제도 막힐 수 있습니다
삭제 응답에 항상 CR 본문을 반환하기 때문이라는 설명은 맞지 않습니다

CRD의 삭제 finalizer를 처리하는 컨트롤러도 남은 CR을 목록 조회하고 삭제합니다
현재 저장 버전의 저장소를 이용하므로 옛 저장 형식이 남아 있으면 이 조회에서 변환이 필요할 수 있습니다
CRD의 Terminating을 볼 때 conversion 오류와 남은 CR 자체의 finalizer를 함께 구분해야 합니다

이 경로는 [일반 Store.Delete](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/registry/generic/registry/store.go), [CRD 정리 finalizer](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/controller/finalizer/crd_finalizer.go), [저장 버전 저장소 선택](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apiserver/customresource_handler.go)에 있습니다

## 현행 마이그레이터는 Merge patch를 사용합니다

v1.37의 `StorageVersionMigrator` 게이트는 GA·기본 true이며 현재 정의에 LockToDefault는 없습니다
`storagemigration.k8s.io/v1`의 StorageVersionMigration이 등록되고 v1이 선호되며 v1beta1도 등록돼 있습니다
등록·기본 활성과 실제 클러스터의 API 노출·컨트롤러 실행·이행 요청 완료는 구분해야 합니다

이 컨트롤러는 StorageVersionMigration의 대상 리소스를 관찰해 재쓰기를 진행합니다
CRD에서 storage를 바꾼 사실만으로 모든 CR의 마이그레이션이 끝나거나 storedVersions 정리까지 함께 완료됐다는 뜻은 아닙니다

현재 재쓰기 patch에는 apiVersion·kind·metadata.resourceVersion이 들어가며 spec·status·UID는 보내지 않습니다
패치 종류는 MergePatchType입니다
과거 v1.35의 UID까지 담은 Apply patch나 SSA 필드 소유권 이전과 같은 처리로 설명하면 안 됩니다

현재 컨트롤러는 기준 resourceVersion과 캐시 진행을 확인하며, 그 이후 갱신된 객체는 재쓰기 후보에서 제외합니다
patch의 Conflict·NotFound는 이미 갱신·삭제·재생성돼 이행이 불필요해진 경로로 보고 계속합니다
재시도 가능한 오류와 마이그레이션 실패도 구분하므로 작업 요청의 존재만으로 완료를 판단할 수는 없습니다

공식 migration 문서는 상단에 Beta·기본 비활성 표시가 남아 있는 반면 본문에는 기본 활성 안내가 있습니다
이 글의 단계·기본값·patch 설명은 고정 v1.37.1 구현에 맞췄습니다

근거는 [현행 SVM controller](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/storageversionmigrator/storageversionmigrator.go), [API 등록 우선순위](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/storagemigration/install/install.go), [게이트 정의](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go), [etcd 쓰기 생략 조건](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/etcd3/store.go)에 있습니다

## 필드를 없애는 변경은 왕복 후의 값을 봐야 합니다

현재 버전의 스키마에서 필드를 빼면 가지치기로 값이 빠질 수 있습니다
그 상태가 다시 저장돼 원래 값이 제거됐다면 스키마를 되돌리는 것만으로 값이 복원되지는 않습니다
읽기 응답에서만 빠지고 아직 다시 저장하지 않았다면 원래 바이트가 남아 있을 가능성은 별도입니다

새 버전과 webhook을 추가하는 경우에도 정보가 자동으로 보존되지는 않습니다
새 버전에 자리가 없는 값을 왕복 후에도 보존하려면 목표 스키마의 별도 필드나 annotations 등에 옮기는 설계가 필요합니다
metadata에서 labels·annotations만 바꿀 수 있다는 제한은 spec·status의 구조 변환을 금지한다는 뜻이 아닙니다

CRD의 deprecated·served는 작성자가 선언합니다
내장 API의 deprecation 일정만 보고 CR의 저장 데이터 이행도 자동으로 수행된다고 볼 수는 없습니다
저장된 형식·클라이언트·왕복 변환의 정보 손실을 각각 확인해야 합니다
필드 추가 역시 required·default·검증 규칙에 따라 기존 자료에 영향을 줄 수 있습니다

## 선호 버전과 저장 버전도 같을 필요가 없습니다

버전을 생략한 클라이언트가 사용하는 discovery의 선호 순서는 단순 사전순이 아닙니다
Kubernetes 형식의 이름은 GA·beta·alpha 순으로 우선하고 그 안에서 버전 숫자를 비교하므로, v1이 v2beta1보다 앞섭니다

Kubernetes 형식이 아닌 이름은 그 뒤에 놓으며, 이 이름들끼리는 사전순으로 정합니다
따라서 foo1이 foo10보다 앞서고, CRD의 선언 순서나 storage 표시가 선호 순서를 대신하지 않습니다

deprecated 경고를 서버가 만들 때도 현재 버전보다 우선순위가 높고, served이며 deprecated가 아닌 후보가 있으면 그중 가장 높은 버전을 추천합니다
후보가 없으면 추천 문구를 붙이지 않습니다

`deprecationWarning`을 직접 지정하려면 deprecated가 true여야 합니다
비어 있지 않은 출력 가능한 UTF-8이어야 하며, 현재 검증의 길이 상한은 256바이트입니다
오류 문구가 characters라고 해도 한글 256자를 뜻하지는 않습니다

근거는 [CRD 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/validation/validation.go), [버전 비교](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/version/helpers.go), [서빙·경고 처리](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apiserver/customresource_handler.go)에 있습니다

## 실패한 위치를 나눠 봅니다

| 표시·증상 | 확인할 경계 |
|---|---|
| conversion webhook for … failed | HTTP 호출·응답 해석·result.status 등 뒤의 원인 |
| returned N objects, expected M | 원래 LIST 전체가 아니라 실제 보낸 objects와 반환 개수 비교 |
| must have the same name·UID·namespace | 반환 CR 식별자 변경, 조용히 무시되는 metadata 변경과 구분 |
| API 응답은 왔는데 값이 빠짐 | 버전별 스키마·가지치기·변환 중 정보 보존 |
| 같은 요청 버전인데 일부 CR만 실패 | 저장 형식 혼재·목록의 변환 대상·자료별 변환 오류 |
| DELETE 실패·CRD Terminating | 삭제 전 읽기 변환, CRD 정리 조회·삭제, 남은 CR finalizer |
| 옛 버전 제거가 거절됨 | storedVersions 장부와 실제 이행 완료를 각각 확인 |

## 확인한 근거

- [공식 CRD versioning 문서](https://kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definition-versioning/)와 [문서 고정본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definition-versioning.md): 다중 서빙·변환·버전 제거의 계약
- [공식 storage migration 문서](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/storage-version-migration/): 버전별 안내와 현행 소스의 단계·기본값을 구분
- [저장 코덱 버전 설정](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apiserver/customresource_handler.go)과 [versioning codec](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/runtime/serializer/versioning/versioning.go): 읽기·쓰기 목표와 같은 GVK 인코딩 우회
- [과거 v1.35 SVM controller](https://github.com/kubernetes/kubernetes/blob/5671697925fe8d7222c4ab09cb15f28f5f9d0383/pkg/controller/storageversionmigrator/storageversionmigrator.go): 현재 Merge patch와 구분한 Apply patch 이력
