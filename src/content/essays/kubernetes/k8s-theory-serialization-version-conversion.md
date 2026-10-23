---
title: "직렬화와 버전 변환 — 요청·메모리·저장의 모양이 다른 이유"
excerpt: "API 버전 변환과 JSON·protobuf 직렬화는 서로 다른 일입니다. 내부 버전의 역할, 기본값을 채우는 순서, 응답 형식 협상과 페이징 토큰의 조건을 살펴봅니다"
category: "kubernetes"
tags: ["Kubernetes", "API", "Serialization", "VersionConversion", "CRD", "concept"]
series:
  name: "k8s-theory-api"
  order: 16
date: "2026-08-15"
---

API 서버가 요청을 디코딩한다고 하면 JSON을 Go 구조체로 읽는 과정부터 떠올리기 쉽습니다
그런데 같은 오브젝트도 클라이언트가 보내는 버전, 서버가 메모리에서 다루는 버전, 저장소에 기록하는 버전이 다를 수 있습니다

**버전 변환**은 같은 오브젝트를 다른 API 버전의 표현으로 옮기는 일입니다
**직렬화**는 그 표현을 JSON·protobuf 같은 바이트 형식으로 만드는 일입니다
어느 버전으로 바꿀지와 어떤 형식으로 쓸지는 별도로 정합니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## 요청 버전과 메모리 버전, 저장 버전은 다릅니다

내부 타입을 사용하는 내장 API의 쓰기 요청을 따라가면 먼저 요청 바이트를 외부 버전의 구조체로 읽습니다
그 버전에 맞는 기본값을 채운 뒤, 서버가 메모리에서 다룰 타입으로 변환합니다
저장할 때는 다시 저장 버전으로 바꾸고 저장 형식에 맞춰 인코딩합니다

![요청 바이트를 외부 버전으로 읽고 기본값과 내부 변환을 적용한 뒤 저장 버전으로 기록하는 과정](/diagrams/k8s-theory-serialization-version-conversion-1.svg)

읽기 요청에서는 저장된 바이트를 메모리 버전으로 복원하고, 클라이언트가 받을 API 버전과 응답 형식으로 바꿔 내보냅니다
클라이언트가 JSON 응답을 요청했다고 해서 etcd에 저장된 형식까지 JSON으로 바뀌지는 않습니다

저장 코덱은 인코더와 디코더를 묶은 구성입니다
[`StorageCodecConfig`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/storage/storage_codec.go)에는 `StorageVersion`, `MemoryVersion`, `StorageMediaType`이 각각 들어 있습니다
`NewStorageCodec`은 쓰기에는 저장 버전을, 읽기에는 메모리 버전을 변환 대상으로 사용합니다

메모리 버전의 기본값은 `{그룹, __internal}`입니다
다만 [`SetResourceEncoding`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/storage/resource_encoding_config.go)으로 자원별 설정을 바꿀 수 있으므로 모든 내장 자원이 예외 없이 같은 메모리 버전을 쓴다고 일반화하면 안 됩니다

서버 시작 과정의 [`storage_factory.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/storage/storage_factory.go)는 verbosity 3에서 두 버전을 함께 기록합니다
다음은 실제 수집한 로그가 아니라 소스에 있는 로그 형식입니다

```text
storing <resource> in <storage version>, reading as <memory version> from <config>
```

## __internal은 클라이언트에게 제공하는 API 버전이 아닙니다

`__internal`은 서버 안에서 사용하는 타입을 등록할 때 쓰는 버전 이름입니다
[`APIVersionInternal`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/runtime/interfaces.go)의 주석도 이 문자열 자체는 규약이며, 상수에 특별한 차단 기능이 있는 것은 아니라고 설명합니다

실제 경계는 타입 등록과 변환, 서빙·저장 설정에 나뉘어 있습니다

| 위치 | 내부 버전 처리 |
|---|---|
| `Scheme.addObservedVersion` | 관측한 외부 버전 목록에 넣지 않음 |
| `Scheme.SetVersionPriority` | 내부 버전을 우선순위에 넣으면 오류 반환 |
| `setTargetKind` | 내부 버전으로 변환한 객체의 GVK를 빈 값으로 설정 |
| 저장 코덱 | 메모리 버전을 그대로 기록하지 않고 지정한 저장 버전으로 변환 |

GVK는 API 그룹·버전·Kind를 묶은 식별자입니다
외부 표현에서는 `apiVersion`과 `kind`로 나타납니다
[`Scheme`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/runtime/scheme.go)은 내부 타입으로 변환할 때 이 외부 식별 정보를 지웁니다

그렇다고 GVK를 지운 객체가 Go에서 어떤 방법으로도 직렬화될 수 없다는 뜻은 아닙니다
지원하는 API 경로가 내부 버전을 제공하지 않고, 정상 응답·저장 경로가 외부 버전으로 바꿔 내보낸다는 뜻입니다
`__internal`을 숨겨진 API endpoint로 취급하면 안 됩니다

외부에 제공하거나 영구 저장하는 표현에는 호환성 책임이 붙습니다
내부 타입의 모양을 그 계약으로 삼지 않으면 내부 구현을 바꾸면서도 외부 버전과 저장 데이터의 호환성은 변환 경로에서 유지할 수 있습니다

## 가운데 타입 하나가 버전 사이의 연결 수를 줄입니다

외부 버전이 4개이고 모든 방향의 변환을 직접 만든다고 가정하면 `4 × 3 = 12`개의 방향이 필요합니다
각 버전을 가운데 타입 하나와 연결하면 버전마다 들어오는 방향과 나가는 방향만 필요하므로 `2 × 4 = 8`개입니다
일반화하면 `n × (n - 1)`과 `2n`의 차이입니다

이처럼 공통 타입을 중심으로 버전들을 연결하는 구조를 hub-and-spoke라고 합니다

![외부 버전 네 개가 공통 내부 타입과 양방향으로 연결되어 변환 방향 여덟 개를 만드는 구조](/diagrams/k8s-theory-serialization-version-conversion-2.svg)

v1.37.1 소스의 `flowcontrol.apiserver.k8s.io`에는 `v1`, `v1beta1`, `v1beta2`, `v1beta3` 패키지가 남아 있습니다
[`FlowSchema` 변환 함수](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/flowcontrol/v1/zz_generated.conversion.go)는 외부 `v1` 타입과 내부 `flowcontrol` 타입을 연결합니다
`resource.k8s.io`에도 `v1`, `v1alpha3`, `v1beta1`, `v1beta2` 패키지가 있습니다

이것은 코드에 남은 패키지 수이며, 모두 현재 API로 제공한다는 뜻은 아닙니다
예를 들어 `flowcontrol.apiserver.k8s.io/v1beta3`은 [v1.32부터 제공되지 않습니다](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/using-api/deprecation-guide.md#v1-32)

내부 타입을 두면 그 타입을 대상으로 작성한 검증도 공유할 수 있습니다
다만 현재 Kubernetes의 모든 검증이 내부 타입에서만 이루어진다는 뜻은 아닙니다
버전이 있는 타입에 검증 코드를 생성하는 방식도 있으며, 이 변화는 내부 타입을 줄이려는 설계의 근거 중 하나입니다

### 내부 타입을 줄이는 작업과 hub를 없애는 일은 다릅니다

[KEP-6164](https://github.com/kubernetes/enhancements/blob/0c8d11e9a13e12d2ef75d2d78af5ac00d8189046/keps/sig-api-machinery/6164-internal-type-elimination/README.md)는 별도의 내부 타입을 유지하는 비용을 줄이려는 제안입니다
요청·저장·watch 경로에서 반복하는 변환과 메모리 할당, 그룹마다 추가 타입·생성 코드를 유지하는 부담을 다룹니다

확인한 KEP는 작업을 두 단계로 나눕니다

1. 내부 타입과 안정된 외부 타입의 메모리 배치를 같게 만들어 변환 비용을 줄입니다
2. 내부 타입을 외부 타입의 Go alias로 바꾸고 `__internal` 등록을 없애, 버전이 있는 타입을 hub로 사용합니다

KEP의 v1.37 목표는 첫 단계입니다
[메타데이터](https://github.com/kubernetes/enhancements/blob/0c8d11e9a13e12d2ef75d2d78af5ac00d8189046/keps/sig-api-machinery/6164-internal-type-elimination/kep.yaml)는 `status: implementable`, `stage: stable`, 목표 버전 v1.37로 기록하지만, 이것만으로 모든 API의 내부 타입 제거가 끝났다고 판단할 수는 없습니다
이 작업에는 런타임 feature gate가 없으며 리소스별 변경이 합쳐질 때 적용됩니다

실제로 확인한 v1.37.1의 [`flowcontrol/types.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/flowcontrol/types.go)에는 내부 `FlowSchema` 구조체가 남아 있습니다
생성된 변환 코드에는 메모리 구조가 같은 일부 타입을 `unsafe.Pointer`로 변환하는 경로도 있습니다
내부 타입이 존재한다는 사실과 변환마다 모든 필드를 새로 할당한다는 주장은 구분해야 합니다

## 기본값은 요청받은 버전에서 먼저 채웁니다

일반적인 버전 코덱의 순서는 **디코딩, 기본값 적용, 대상 버전 변환**입니다
[`codec.Decode`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/runtime/serializer/versioning/versioning.go)는 디코딩한 객체에 defaulter를 적용한 다음 `Convert` 또는 `ConvertToVersion`을 호출합니다

버전마다 필드와 기본값의 의미가 다를 수 있기 때문입니다
다른 타입으로 변환한 뒤에는 원래 버전에만 있던 필드나 표현을 그대로 다루기 어려울 수 있습니다
기본값을 채우는 일반 함수가 `pkg/apis/core/v1/defaults.go`처럼 버전 패키지에 놓이는 이유입니다

다만 기본값 적용이 언제나 입력의 누락과 명시적인 빈 값을 구별한다는 뜻은 아닙니다
[`SetDefaults_Pod`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/v1/defaults.go)는 `enableServiceLinks`의 포인터가 `nil`인지 확인하지만, `SetDefaults_PodSpec`의 `dnsPolicy`는 문자열이 비었는지 확인합니다
두 값의 구분 가능성은 필드 타입과 디코딩·기본값 로직에 달려 있습니다

일부 기본값을 변환 과정에서 채우는 예외도 있습니다
[`autoscaling/v1`의 HPA 변환](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/autoscaling/v1/conversion.go)은 변환 뒤 Metrics가 비어 있으면 기본 CPU 사용률 메트릭을 구성합니다
일반 코덱의 순서와 개별 변환 함수의 호환성 처리를 나눠 읽어야 합니다

## Accept는 바이트 형식과 응답 타입을 함께 요청합니다

요청 본문의 형식은 `Content-Type`으로 알리고, 받고 싶은 응답 형식은 `Accept`로 요청합니다
여기서 미디어 타입은 바이트 형식이고, 일부 파라미터는 응답 객체의 타입을 지정합니다

```http
Accept: application/json;as=Table;g=meta.k8s.io;v=v1
```

이 헤더는 JSON 형식으로 `meta.k8s.io/v1`의 `Table` 객체를 받고 싶다는 뜻입니다
원래 조회하는 자원의 API 버전은 요청 URL이 정합니다
헤더의 `v=v1`은 이 예시에서 변환해 받을 Table의 버전입니다

| 항목 | 역할 |
|---|---|
| `application/json` | 응답의 직렬화 형식 |
| `as` | 변환해 받을 Kind, 예를 들어 `Table`이나 `PartialObjectMetadata` |
| `g`, `v` | 그 응답 Kind의 그룹과 버전 |
| `stream` | 스트리밍 스키마 요청. 일반 RequestScope는 `watch`를 허용 |
| `sv` | 일반 출력에 사용할 서버 API 그룹 버전. endpoint가 허용하는 값인지 검사 |

파싱은 [`acceptMediaTypeOptions`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/handlers/negotiation/negotiate.go)가 맡습니다
[`targetEncodingForTransform`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/handlers/response.go)은 `meta.k8s.io`의 `v1`·`v1beta1`에 속하는 Table과 PartialObjectMetadata 계열을 별도 응답 타입으로 처리합니다

기본적으로 확인할 형식은 JSON, YAML, Kubernetes protobuf입니다
CBOR는 `application/cbor`를 사용하지만, v1.37.1의 [`CBORServingAndStorage`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/features/kube_features.go)는 여전히 alpha이며 기본값은 꺼짐입니다
설정과 endpoint 지원 여부를 확인하지 않고 항상 받을 수 있는 형식으로 안내하면 안 됩니다

## protobuf 지원은 최종적으로 인코딩할 타입에 달려 있습니다

Kubernetes protobuf는 객체를 protobuf 바이트로 만들고 Kubernetes의 envelope로 감싸는 형식입니다
[`protobuf` serializer](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/runtime/serializer/protobuf/protobuf.go)는 앞에 `6b 38 73 00`, 즉 `k8s`와 0 바이트를 붙입니다

객체 타입은 protobuf marshal 인터페이스를 구현해야 합니다
지원하는 내장 타입은 생성된 코드가 있지만, CRD로 정의한 사용자 객체 본체는 `Unstructured`로 다뤄지며 그 생성 코드가 없습니다
해당 인터페이스가 없을 때 serializer가 만드는 오류 형식은 다음과 같습니다

```text
object %v does not implement the protobuf marshalling interface and cannot be encoded to a protobuf message
```

이 오류는 `406 NotAcceptable` 상태를 표현합니다
하지만 CR 본체의 protobuf 요청은 보통 이 인코더까지 가지 않습니다
[`customresource_handler.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apiserver/customresource_handler.go)가 원래 객체를 그대로 반환할 때 허용하는 `StandardSerializers`에서 protobuf를 제외하므로, 형식 협상에서 거절합니다

| 응답 객체 | protobuf | v1.37.1의 제한 위치 |
|---|---|---|
| protobuf 생성 코드가 있는 내장 타입 | 가능 | 해당 serializer·endpoint 지원 필요 |
| CRD로 정의한 객체 본체 | 불가 | `StandardSerializers`에서 제외 |
| `Table` | 불가 | 형식 협상에서 JSON·YAML만 허용하며 protobuf 코드도 생성하지 않음 |
| `PartialObjectMetadata` | 가능 | 메타데이터 타입에 protobuf 코드가 있음 |

`PartialObjectMetadata`는 spec·status 없이 메타데이터만 반환하는 타입입니다
같은 CR을 조회해도 최종 응답이 이 타입이면 protobuf로 받을 수 있습니다
CR 본체의 제한을 메타데이터 응답에 그대로 적용하면 안 됩니다

반면 Table은 내장 자원의 조회 결과여도 protobuf로 받을 수 없습니다
[`Table` 타입](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/apis/meta/v1/types.go)은 셀 값이 `interface{}`여서 protobuf 생성 대상에서 빠져 있고, [`AllowsMediaTypeTransform`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/handlers/rest.go)도 Table에 JSON·YAML만 허용합니다

[API Concepts](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/using-api/api-concepts.md#protobuf-encoding-compatibility)는 aggregation 리소스도 protobuf를 사용할 수 없다고 적지만, [Custom Resources 비교표](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/extend-kubernetes/api-extension/custom-resources.md)는 별도 API 서버의 protobuf 지원을 가능으로 분류합니다
이 두 서술을 모든 별도 API 서버에 대한 동일한 지원 계약으로 합칠 수는 없습니다
여기서는 확인한 코어의 CR 본체·응답 타입별 동작으로 범위를 한정하며, 별도 서버는 그 구현과 endpoint의 지원 형식을 확인해야 합니다

## kubectl의 표는 서버가 정의한 열을 그립니다

서버 측 출력은 `Table` 객체의 `columnDefinitions`와 `rows`를 사용합니다
서버는 열의 이름·타입·순서와 우선순위를 정의하고, kubectl은 그 정의에 따라 셀을 표시합니다

v1.37.1의 [Pod 열 정의](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/printers/internalversion/printers.go)에는 9개 열이 있습니다

| 기본 화면 | wide에서 추가로 표시하는 열 |
|---|---|
| Name, Ready, Status, Restarts, Age | IP, Node, Nominated Node, Readiness Gates |

추가 열 4개의 `priority`는 1입니다
[kubectl의 표 출력 코드](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cli-runtime/pkg/printers/tableprinter.go)는 기본 화면에서 `priority`가 0이 아닌 열을 숨기고, `-o wide`일 때는 표시합니다
서버가 정의한 표를 받아 그리는 경로에 대한 설명이며 모든 출력 모드가 Table을 사용한다는 뜻은 아닙니다

CRD에서는 `additionalPrinterColumns`로 같은 정보를 정의합니다
kubectl이 사용자 정의 타입의 구조를 미리 알지 못해도 서버가 만든 열과 셀을 그릴 수 있습니다

## CRD에는 별도의 내부 Go 타입이 없습니다

내장 API의 내부 타입과 달리 CRD 객체에는 서버가 미리 알고 있는 별도의 `__internal` Go 구조체가 없습니다
버전별 구조는 CRD의 스키마와 변환 설정으로 다룹니다

Webhook 전략을 쓰면 `ConversionReview`의 `desiredAPIVersion`이 원하는 결과 버전을 지정합니다
서버가 요청하는 계약은 입력 객체들을 그 버전으로 바꿔 돌려달라는 것이며, 별도의 `__internal` 단계를 요구하지 않습니다
실제 요청 구성은 [`webhook_converter.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apiserver/conversion/webhook_converter.go)에서 확인할 수 있습니다

웹훅 구현이 서빙 버전 하나를 hub로 삼아 나머지 버전을 연결할 수는 있습니다
**별도 내부 타입이 없다는 것과 hub를 쓸 수 없다는 것은 다릅니다**
KEP-6164가 내장 타입의 향후 구조를 설명할 때 CRD를 참고하는 이유도 이 구분에 있습니다

## Event는 두 API 그룹이 같은 저장소를 사용합니다

`Event`는 core `v1`과 `events.k8s.io/v1` 양쪽에 있습니다
한 그룹 안에서 버전을 바꾸는 것과 달리, API 그룹이 다른 두 표현이 같은 데이터에 접근하는 사례입니다

| 표현 | 대표 필드 |
|---|---|
| core/v1 Event | `firstTimestamp`, `count`, `source` |
| events.k8s.io/v1 Event | `eventTime`, `series`, `reportingController` |

[`events` 등록 코드](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/events/rest/storage_events.go)는 core Event의 저장소 구현을 사용하고, [저장소 구성](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubeapiserver/default_storage_factory_builder.go)은 두 그룹의 events를 같은 저장 공간을 사용하는 리소스로 등록합니다
새 그룹의 [Event 타입](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/events/v1/types.go)에는 옛 필드도 `deprecatedFirstTimestamp`, `deprecatedCount` 같은 이름으로 남아 있습니다
새 API 표현을 도입했다고 기존 데이터의 호환성 책임이 사라지는 것은 아닙니다

## continue에는 시점뿐 아니라 읽기 위치도 있습니다

LIST에서 `limit`을 지정하면 응답을 여러 조각으로 나눠 받을 수 있습니다
서버가 반환한 `continue`를 다음 요청에 넣으면 같은 스냅샷의 나머지를 이어 읽습니다

[continue 토큰 구현](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/continue.go)은 base64url로 인코딩한 JSON이며, 세 필드를 담습니다

| 필드 | 의미 |
|---|---|
| `v` | 토큰 형식 버전, `meta.k8s.io/v1` |
| `rv` | 조회할 스냅샷의 resourceVersion |
| `start` | 다음에 읽기 시작할 저장소 키 |

토큰은 클라이언트가 해석하거나 수정할 값이 아닙니다
이 구조는 서버가 페이징 상태를 어떻게 유지하는지 설명하기 위해 살펴본 구현입니다
다음 시작 위치는 마지막 키 뒤에 `\x00`을 붙여 만들며, 시점과 위치를 함께 보존합니다

[watch의 resourceVersion](/essays/k8s-theory-watch)은 그 시점 이후의 변경을 따라가기 위한 커서입니다
페이징은 그 시점에 고정한 목록 안에서 읽을 위치까지 필요합니다

### 토큰에 별도의 만료 시각이 들어 있지는 않습니다

고정한 revision을 저장소가 더 이상 제공하지 못하면 토큰으로 일관된 목록을 이어갈 수 없습니다
etcd 경로에서는 compaction된 revision을 읽으려다 `410 Gone`을 받는 것이 대표적입니다

[저장소의 compaction 주기 기본값](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/storagebackend/config.go)은 5분입니다
이 값은 토큰을 발급한 순간부터 정확히 5분 동안 유효하다는 보장이 아닙니다
실제 보존 revision과 저장소 설정에 따라 이어 읽을 수 있는 범위가 달라집니다

`remainingItemCount`가 없다고 오류인 것도 아닙니다
`PrepareContinueToken`은 뒤에 결과가 더 있고 selector가 비어 있을 때만 남은 수를 넣습니다
selector가 있으면 저장소가 센 객체 수와 실제 응답 대상 수가 다를 수 있고, 마지막 조각이면 남은 수를 따로 넣지 않습니다

### 410 뒤의 새 토큰은 같은 스냅샷을 보장하지 않습니다

[`handleCompactedErrorForPaging`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/etcd3/errors.go)은 이어 읽을 위치로 새 토큰을 만들 수 있으면 410 응답에 함께 넣습니다
새 토큰의 `rv`는 `-1`이며, 최신 revision에서 그 위치 뒤를 계속 읽으라는 뜻입니다
토큰 생성에 실패하면 새 토큰 없이 만료 오류를 반환합니다

| 클라이언트의 선택 | 얻는 결과 | 잃는 것 |
|---|---|---|
| continue 없이 LIST부터 다시 시작 | 새 시점의 일관된 전체 목록 | 이미 받은 조각을 다시 읽어야 함 |
| 410 응답의 새 토큰으로 계속 진행 | 남은 위치를 최신 상태에서 조회 | 첫 조각과 같은 스냅샷이라는 보장 |

새 토큰으로 진행하면 첫 조각을 받은 뒤 생성·수정·삭제된 객체의 변화가 결과에 섞일 수 있습니다
일관된 로컬 사본을 만들 목적이라면 처음부터 다시 읽어야 합니다
놓친 변경을 복구하려는 watch 재연결과, 목록의 남은 위치를 훑는 페이징을 같은 동작으로 취급하면 안 됩니다

## 응답 형식과 저장 형식은 독립적입니다

일반 API 서버 옵션의 저장 형식 기본값은 JSON이지만, [kube-apiserver 옵션](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controlplane/apiserver/options/options.go)은 이를 `application/vnd.kubernetes.protobuf`로 바꿉니다
[`--storage-media-type`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/options/etcd.go)은 이 저장 형식 설정이며 요청의 Accept와 별개입니다

CR 본체의 저장 코덱은 별도로 구성합니다
[`NewCRDRESTOptionsGetter`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/cmd/server/options/options.go)는 기본적으로 JSON을 쓰고, CBORServingAndStorage를 켜면 CBOR 인코더로 바꿉니다
읽는 쪽은 gate가 꺼져 있어도 이미 저장된 CBOR와 JSON을 모두 인식하도록 구성합니다

따라서 기본 설정에서는 내장 자원의 protobuf와 CR 본체의 JSON이 같은 etcd 안에 있을 수 있습니다
이것을 모든 설정에서 내장 자원은 반드시 protobuf, CR은 반드시 JSON이라는 규칙으로 넓히면 안 됩니다

저장된 크기와 응답 바이트 크기도 다를 수 있습니다
[저장소 통계의 `EstimatedAverageObjectSizeBytes`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/interfaces.go)는 저장된 직렬화 값의 크기를 바탕으로 한 평균 추정치입니다
응답 형식을 JSON으로 골랐다는 이유로 이 통계도 JSON 응답 크기로 바뀌는 것은 아닙니다

## 오류를 볼 때 버전과 형식을 나눠 확인합니다

| 증상 | 먼저 확인할 경계 |
|---|---|
| CR 본체를 protobuf로 요청해 406 | CRD의 원본 객체용 serializer 제한 |
| Table을 protobuf로 요청해 406 | Table 변환의 JSON·YAML 제한 |
| 같은 CR이 메타데이터 응답으로는 protobuf 지원 | 최종 응답 Kind가 `PartialObjectMetadata`인지 |
| 새 API 버전의 변환 오류 | 외부 타입과 hub 타입의 변환·등록 여부 |
| 예상한 기본값이 없음 | 요청 버전의 필드와 기본값 함수, 변환 중 호환성 처리 |
| continue를 사용하다 410 | 고정 revision의 가용성과 다시 LIST할 필요 |
| 기본 표에 IP·Node가 없음 | 열의 priority와 wide 출력 여부 |

API 버전은 객체의 표현을 정하고, 직렬화 형식은 그 표현을 바이트로 쓰는 방법을 정합니다
여기에 메모리 버전과 저장 버전을 나눠 보면, JSON으로 요청한 객체가 내부 타입으로 검증되고 다른 형식으로 저장되는 경로를 구분할 수 있습니다
