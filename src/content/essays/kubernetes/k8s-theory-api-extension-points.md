---
title: "API 확장 지점 — 타입 등록과 기능 활성은 다른 일입니다"
excerpt: "CRD와 aggregated API server가 나누어 맡는 구현 책임을 살펴봅니다. APIService의 상태 검사, discovery와 kubectl의 버전 선택, API 호환성 정책과 feature gate를 구분합니다"
category: "kubernetes"
tags: ["Kubernetes", "CRD", "APIService", "Discovery", "FeatureGate", "concept"]
series:
  name: "k8s-theory-api"
  order: 14
date: "2026-08-11"
---

내장 API로 표현하기 어려운 요구가 있으면 새 API 타입을 정의할 수 있습니다
그 타입을 kube-apiserver의 일반 구현으로 제공할지, 별도 서버가 처리하게 할지에 따라 직접 맡아야 할 일이 달라집니다

타입을 등록한 뒤에도 확인할 것은 남아 있습니다
클라이언트가 그 타입을 어떻게 찾는지, 어떤 API 버전으로 요청하는지, 필요한 기능이 실제로 켜져 있는지를 각각 봐야 합니다

> **근거**: Kubernetes v1.37.1의 고정 소스와 공식 문서 저장본을 바탕으로 설명합니다
> 소스 ref는 `f78e722310e50bcaca9276be22276d9e91d91308`, 문서 ref는 `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`입니다
> 별도 표시가 없으면 서버의 동작 기준 버전인 emulation version도 v1.37이며, 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## 새 타입의 구현을 어디까지 맡을 것인가

CRD(CustomResourceDefinition)는 새 리소스의 이름과 스키마를 선언하는 오브젝트입니다
등록된 커스텀 리소스의 저장과 API 응답은 kube-apiserver의 일반 구현이 맡습니다

aggregated API server는 별도로 구현하고 운영하는 확장 API 서버입니다
kube-apiserver 안의 aggregation layer가 해당 API 요청을 받아 확장 서버로 전달합니다

![CRD는 일반 저장과 서빙 구현을 사용하고 aggregated API는 별도 서버가 구현을 맡는 관계](/diagrams/k8s-theory-api-extension-points-1.svg)

두 방식은 구현 책임이 다릅니다
CRD를 쓰면 새 API 서버를 만들지 않아도 되지만, kube-apiserver가 제공하는 저장 방식과 기능 범위 안에서 타입을 정의해야 합니다
별도 API 서버를 쓰면 구현을 바꿀 수 있는 대신 서버의 배포·가용성·업데이트도 직접 관리해야 합니다

| 필요한 기능 | CRD로 정의한 커스텀 리소스 | Aggregated API |
|---|---|---|
| 커스텀 저장 백엔드 | 일반 저장 구현 사용 | 시계열 DB 등 별도 구현 가능 |
| 검증·기본값·여러 API 버전 | 스키마와 필요시 webhook으로 지원 | 서버에서 구현 가능 |
| `status`·`scale` subresource | 지원 | 구현 가능 |
| `logs`·`exec` 같은 임의 subresource | 지원하지 않음 | 구현 가능 |
| strategic merge patch | 지원하지 않음 | 구현 가능 |
| 리소스 본문의 Protocol Buffers | 지원하지 않음 | 구현 가능 |
| 리소스 객체 이름 | DNS subdomain 형식 필요 | 서버가 이름 제약을 정함 |

이 비교는 [공식 Custom Resources 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/extend-kubernetes/api-extension/custom-resources.md)의 기능 범위를 따른 것입니다
aggregated API의 “가능”은 등록만 하면 자동으로 갖춰진다는 뜻이 아니라 서버가 그 기능을 구현할 수 있다는 뜻입니다
또한 CRD 본문과 `PartialObjectMetadata`처럼 변환된 응답 형식의 직렬화 지원은 구분해야 합니다

타입에 필드 몇 개를 추가하고 그 상태에 맞춰 작업하는 요구라면 CRD가 출발점이 될 수 있습니다
저장 백엔드나 CRUD 밖의 동작을 바꿔야 할 때 별도 API 서버를 검토할 이유가 생깁니다
CRD를 등록하는 일과 그 상태에 반응하는 controller를 구현하는 일도 별개입니다

## APIService는 어느 요청을 전달하는가

`APIService`는 aggregation layer에 API 그룹·버전을 등록합니다
예를 들어 `v1.myextension.mycompany.io`가 클러스터의 Service를 가리키면 `/apis/myextension.mycompany.io/v1/...` 요청을 그 확장 서버로 전달합니다

일반적인 확장 등록의 단위는 그룹·버전입니다
아무 URL이나 한 줄씩 가로채는 설정은 아닙니다
다만 구현에는 코어 API용 `v1.`이 `/api` 경로를 맡는 특수 분기도 있으므로 모든 `APIService`가 반드시 `/apis/...`만 다룬다고 일반화할 수는 없습니다

이 경로는 [`APIAggregator.AddAPIService`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kube-aggregator/pkg/apiserver/apiserver.go)에 있습니다
`spec.service`가 없는 등록은 로컬 서버로 위임하며, 여기서는 별도 Service를 가리키는 확장 서버를 설명합니다

등록에 성공했다고 백엔드까지 응답하는 것은 아닙니다
availability controller는 Service를 조회하고, ClusterIP Service라면 포트와 EndpointSlice의 사용 가능한 주소를 확인합니다
그 뒤 그룹·버전의 discovery 경로에 GET을 보냅니다

| 검사 결과 | `Available.status` | `reason` |
|---|---|---|
| Service가 없음 | `False` | `ServiceNotFound` |
| Service 조회 오류 | `Unknown` | `ServiceAccessError` |
| ClusterIP Service에 지정 포트가 없음 | `False` | `ServicePortError` |
| EndpointSlice 조회 오류 | `Unknown` | `EndpointsAccessError` |
| EndpointSlice가 없거나 사용 가능한 주소·포트가 없음 | `False` | `EndpointsNotFound` 또는 `MissingEndpoints` |
| discovery GET 시도가 모두 실패 | `False` | `FailedDiscoveryCheck` |
| 검사를 통과 | `True` | `Passed` |

v1.37.1 구현의 GET용 HTTP timeout은 5초이고, GET 결과를 기다리는 별도 제한은 6초입니다
다섯 시도를 병렬로 보내 하나라도 성공하면 통과합니다
이 값이 등록 후 5초 안에 `Available`이 바뀐다는 보장은 아닙니다

TLS 설정도 버전별 구현을 확인해야 합니다
이 버전의 상태 검사와 사용자 요청 프록시는 모두 `BuildTransportConfig`를 호출합니다
`APIService.spec.insecureSkipTLSVerify`와 `caBundle`을 사용하므로, 상태 검사라는 이유만으로 항상 서버 인증서 검증을 생략하지 않습니다

근거는 [상태 검사와 transport 구성](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kube-aggregator/pkg/controllers/status/remote/remote_available_controller.go), [사용자 요청의 프록시 구성](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kube-aggregator/pkg/apiserver/handler_proxy.go)입니다
`Available=True`는 이 검사를 통과했다는 뜻이며 개별 리소스의 모든 동작이 성공한다는 판정은 아닙니다

확장 서버의 장애는 discovery를 사용하는 다른 작업에도 영향을 줄 수 있습니다
[Namespace 삭제](/essays/k8s-theory-deletion-lifecycle)처럼 삭제할 리소스 목록이 필요한 작업에서는 discovery 실패 때문에 정리가 끝나지 않을 수 있습니다

## Discovery는 이름을 찾고 OpenAPI는 구조를 설명합니다

Discovery API는 서버가 제공하는 그룹·버전·리소스와 scope, 지원 동작을 알려줍니다
출발점은 `/api`와 `/apis`입니다
객체 필드의 전체 스키마를 제공하는 OpenAPI 문서와 역할이 다릅니다

비집계 discovery에서는 루트의 그룹 목록을 읽은 뒤 각 그룹·버전 경로에서 리소스 목록을 더 가져옵니다
타입이 많아질수록 필요한 요청 수도 늘어납니다
[KEP-3352](https://github.com/kubernetes/enhancements/blob/0c8d11e9a13e12d2ef75d2d78af5ac00d8189046/keps/sig-api-machinery/3352-aggregated-discovery/README.md)는 설계 당시 문제를 설명하며 최대 80회 요청 사례를 듭니다
모든 클러스터의 고정 요청 수나 여기서 측정한 값은 아닙니다

집계 discovery는 그룹별 리소스 목록을 묶어 `/api`와 `/apis` 두 endpoint로 제공합니다
각 endpoint를 요청할 때 다음 `Accept` 헤더로 집계 형식을 선택합니다

```http
Accept: application/json;v=v2;g=apidiscovery.k8s.io;as=APIGroupDiscoveryList
```

전체 API 목록이 항상 단 한 번의 HTTP 응답으로 끝난다는 뜻은 아닙니다
코어 API와 나머지 API의 두 endpoint가 있으며, 집계 형식을 지정하지 않으면 기본 응답은 비집계 문서입니다

이 방식은 v1.26 alpha, v1.27 beta를 거쳐 v1.30에서 `v2`로 GA가 됐습니다
확인한 v1.37.1에서는 `AggregatedDiscoveryRemoveBetaType`이 `true`에 잠겨 있어 `v2beta1`을 집계 형식으로 인정하지 않습니다
`v2beta1`만 지정한 요청은 집계 handler로 가지 않고 기존 discovery handler로 넘어갑니다

응답 형식을 해석할 때는 요청한 헤더와 실제 `kind`를 함께 확인해야 합니다
[공식 Discovery 설명](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/overview/kubernetes-api.md), [`IsAggregatedDiscoveryGVK`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/discovery/aggregated/negotiation.go), [handler 선택](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/discovery/aggregated/wrapper.go)이 이 구분의 근거입니다

## api-resources는 모든 버전을 나열하는 명령이 아닙니다

`kubectl api-resources`는 discovery 결과에서 리소스를 골라 표로 보여줍니다
다음은 출력 열의 뜻을 설명하기 위한 예시입니다

| NAME | SHORTNAMES | APIVERSION | NAMESPACED | KIND |
|---|---|---|---|---|
| deployments | deploy | apps/v1 | true | Deployment |

`APIVERSION`과 `NAME`을 합치면 GVR(Group·Version·Resource)이 됩니다
`APIVERSION`과 `KIND`를 합치면 GVK(Group·Version·Kind)가 됩니다
그래서 YAML의 `kind: Deployment`와 RBAC 규칙의 `resources: ["deployments"]`는 다른 이름을 씁니다

내부의 `ServerPreferredResources`는 같은 그룹·리소스의 후보 중 선호 버전에 있는 항목을 우선합니다
그 리소스가 선호 버전에 없으면 다른 버전에서 발견한 항목이 남을 수 있습니다
모든 서빙 버전을 그대로 나열하는 호출도 아니고, 모든 결과가 반드시 그룹의 선호 버전에 속하는 것도 아닙니다

또한 `/`가 들어간 subresource 이름은 이 선택 과정에서 제외됩니다
따라서 `api-resources -o wide`가 `pods/log`까지 모두 열거하는 명령이라고 생각하면 안 됩니다

| 옵션·열 | 의미 |
|---|---|
| 기본 실행 | discovery 캐시를 무효화하고 서버에 다시 요청 |
| `--cached` | 캐시 무효화를 생략하고 캐시된 결과를 사용할 수 있게 함 |
| `-o wide` | `VERBS`·`CATEGORIES` 열 추가 |
| `VERBS` | 해당 리소스의 discovery가 알리는 API 동작 |
| `NAMESPACED` | namespace 범위인지 클러스터 범위인지 표시 |

`VERBS`는 모든 RBAC verb를 열거하지 않습니다
예를 들어 `bind`와 `escalate`는 [권한 부여·승격 검사](/essays/k8s-theory-authorization)에 쓰이며, 일반 리소스 동작 목록과 역할이 다릅니다
namespace 안의 권한은 RoleBinding으로 부여할 수 있지만 클러스터 범위 리소스에 대한 RBAC 권한은 ClusterRoleBinding이 필요합니다

kubectl의 다른 요청이 오래된 discovery 캐시를 사용하는 동안 `api-resources`는 새 목록을 볼 수 있습니다
따라서 새 CRD의 이름을 찾지 못했다면 서버가 타입을 제공하는지와 클라이언트가 어떤 목록을 보고 있는지를 나눠 확인해야 합니다

선택 알고리즘은 [client-go의 discovery 구현](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/discovery/discovery_client.go), 캐시와 출력 열은 [kubectl 구현](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kubectl/pkg/cmd/apiresources/apiresources.go)에서 확인할 수 있습니다

## API 버전이 올라가면 호환성 약속도 달라집니다

`v1alpha1`, `v1beta1`, `v1`은 각각 alpha·beta·GA 안정도에 속하는 API 버전 이름입니다
예를 들어 `v1beta1`이 같은 이름으로 GA가 되는 것이 아니라, `v1` 같은 새 버전을 제공합니다

[Kubernetes API 폐기 정책](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/deprecation-policy.md)은 다음 경계를 정합니다

| 항목 | 정책 |
|---|---|
| API 요소 변경 | 같은 그룹·버전에서 요소를 제거하거나 동작을 크게 바꾸지 않음 |
| 버전 간 왕복 변환 | 같은 릴리스에서 정보가 보존되어야 함. 일부 버전에 REST 리소스 자체가 없는 경우는 예외 |
| 안정도 역행 | GA를 beta로, beta를 alpha로 대체하는 식의 폐기는 허용하지 않음 |
| Alpha 수명 | 사전 폐기 예고 없이 릴리스에서 제거될 수 있음 |
| Beta 수명 | 도입 후 9개월 또는 3개 마이너 릴리스 중 긴 기간 이내에 deprecated. 폐기 예고 뒤에도 같은 기간을 거쳐 서빙 종료 |
| GA 수명 | deprecated 표시는 가능하지만 같은 Kubernetes 메이저 버전 안에서는 제거하지 않음 |

이것은 Kubernetes API의 호환성 정책입니다
새 CRD를 여러 버전으로 등록했다고 임의로 작성한 변환 코드가 자동으로 무손실이 되는 것은 아닙니다

처음부터 모든 API를 GA로 고정하지 않는 이유도 여기에 있습니다
alpha에서 설계를 바꾸고 beta에서 사용 피드백을 받은 뒤, 더 오래 유지해야 할 GA의 약속으로 넘어갑니다
beta의 폐기 시점과 폐기 예고 후 서빙을 유지하는 기간은 서로 다른 구간입니다

deprecated API 호출에는 v1.19부터 세 가지 신호가 제공됩니다
응답의 `Warning` 헤더, audit annotation의 `k8s.io/deprecated: true`, `apiserver_requested_deprecated_apis` 게이지입니다
메트릭의 `removed_release`는 예정된 제거 버전을 담으며, 제거 버전 정보가 없으면 비어 있을 수 있습니다

이는 [폐기 메시지 생성](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/deprecation/deprecation.go)과 [요청 계측](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/metrics/metrics.go)에서 확인할 수 있습니다
API의 서빙을 멈추는 것과 이미 저장한 객체를 지우거나 다른 저장 버전으로 옮기는 것도 구분해야 합니다

## feature gate와 API 서빙 설정은 서로 다른 곳에서 읽습니다

feature gate는 특정 기능의 코드 경로를 켜고 끄는 설정입니다
API 그룹·버전의 서빙 설정은 해당 경로로 요청을 받을지를 정합니다
게이트가 켜졌다는 이유만으로 필요한 API 버전도 열렸다고 판단할 수는 없습니다

![MutatingAdmissionPolicy에서 API 저장소 등록과 플러그인 활성 여부를 각각 결정하는 설정](/diagrams/k8s-theory-api-extension-points-2.svg)

이 구분은 MutatingAdmissionPolicy에서 확인할 수 있습니다
API 저장소를 등록하는 코드는 `ResourceEnabled`를 확인하고, 정책을 실행하는 플러그인은 `MutatingAdmissionPolicy` 게이트를 읽습니다
저장소 등록 조건에 이 게이트 검사는 없습니다

v1.37.1의 MAP 게이트는 v1.36부터 GA·기본 `true`인 사양을 사용하며 `LockToDefault`는 지정되지 않았습니다
안정 API인 `admissionregistration.k8s.io/v1`도 기본 서빙 목록에 들어 있습니다
따라서 과거 v1.35의 beta·기본 off 설명을 현재 기본값처럼 적용하면 안 됩니다

이 버전에서도 플러그인을 끄고 API 서빙은 유지하면 정책 객체는 저장할 수 있지만 그 플러그인의 mutation은 실행되지 않습니다
반대로 특정 그룹·버전의 서빙을 끄면 그 경로로 정책을 생성할 수 없습니다
플러그인이 활성 상태여도 실제 mutation에는 Policy·Binding과 요청의 매칭이 필요하며, 이는 [Admission 순서](/essays/k8s-theory-admission-order)에서 구분했습니다

근거는 [MAP 저장소 등록](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/admissionregistration/rest/storage_apiserver.go), [플러그인의 gate 검사](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/policy/mutating/plugin.go), [버전별 gate 사양](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/features/kube_features.go)입니다
이 사례를 모든 기능에 동일한 두 설정이 있다는 뜻으로 확대하지는 않습니다

### Beta라는 이름만으로 기본값을 알 수는 없습니다

[Feature Gates 문서](https://kubernetes.io/docs/reference/command-line-tools-reference/feature-gates/)는 beta 기능이 대개 기본 활성이고 beta API 그룹은 기본 비활성이라고 설명합니다
다만 개별 gate의 실제 기본값은 `FeatureSpec.Default`, 안정도는 `PreRelease`, 변경 가능 여부는 `LockToDefault`로 따로 정합니다

GA 게이트라도 해당 버전의 사양이 잠겨 있는지 확인해야 합니다
잠긴 기본값과 반대 값을 지정하면 설정 오류이고, GA·Deprecated 게이트를 명시하면 향후 제거에 관한 경고가 나올 수 있습니다
게이트 이름 자체가 제거됐다면 그 이름을 계속 설정하는 것도 오류입니다
버전별 사양의 선택에는 emulation version과 필요한 경우 minimum compatibility version도 관여합니다

이 동작은 [`FeatureSpec`과 설정 검사](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-base/featuregate/feature_gate.go)에 있습니다
모든 기능이 GA까지 가는 것도 아니며, 기본 off의 Deprecated 사양으로 남는 기능도 있습니다

API 서빙 쪽에서는 [`DefaultGenericAPIResourceConfigSource`와 `DefaultAPIResourceConfigSource`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controlplane/instance.go)가 기본 목록을 구성합니다
기본 활성 목록에는 안정 버전을 넣고 alpha·beta는 별도 비활성 목록에 둡니다
추가로 열 그룹·버전은 [`--runtime-config`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/options/api_enablement.go)에서 지정합니다

목록에 이름이 남았다고 해당 버전을 실제로 다시 제공할 수 있는 것은 아닙니다
예를 들어 기본 설정의 비활성 목록에는 flowcontrol의 예전 beta 버전이 남아 있지만, v1.37.1의 [flowcontrol 저장소 등록](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/flowcontrol/rest/storage_flowcontrol.go)은 `v1`만 설치합니다
설정 목록과 현재 서버가 구현한 경로를 함께 봐야 합니다

새 beta API를 기본 비활성으로 바꾼 배경은 [KEP-3136](https://github.com/kubernetes/enhancements/blob/0c8d11e9a13e12d2ef75d2d78af5ac00d8189046/keps/sig-architecture/3136-beta-apis-off-by-default/README.md)에 나옵니다
제안서는 당시 PRR 설문에서 90%가 넘는 클러스터 관리자가 프로덕션의 beta API를 켜 둔다고 답한 점과, 안정 버전으로 옮길 때의 부담을 이유로 듭니다
이 수치는 현재 전체 클러스터의 사용률을 뜻하지 않습니다
제안 자체도 기존 beta API와 그 후속 beta 버전은 예외로 두었으므로, 역사 전체를 “모든 beta API는 항상 off”로 요약하면 맞지 않습니다

## 실패 신호가 가리키는 설정부터 확인합니다

| 겪은 증상 | 먼저 구분할 것 |
|---|---|
| aggregated API가 응답하지 않음 | `APIService`의 `Available` 상태와 `reason`, Service·EndpointSlice·TLS·discovery 검사 |
| 새 CRD 이름을 찾지 못함 | 서버 discovery 목록과 클라이언트 캐시의 차이 |
| 기능은 켰는데 API 경로가 404 | 요청한 그룹·버전의 서빙 여부와 실제 구현 존재 |
| 정책을 저장했는데 mutation이 없음 | 플러그인 활성 여부, Policy·Binding, 매칭 조건 |
| 집계 discovery를 기대했는데 다른 형식이 옴 | `Accept`의 GVK와 실제 응답 형식, 서버의 지원 버전 |

타입을 등록하는 일, 타입을 발견하는 일, 특정 버전으로 요청하는 일, 기능을 실행하는 일은 이어져 있지만 같은 판정은 아닙니다
실패한 요청이 어느 단계까지 갔는지를 구분하면 API 등록 설정을 고쳐야 할지, 클라이언트 목록이나 기능 설정을 확인해야 할지 좁힐 수 있습니다
