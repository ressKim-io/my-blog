---
title: "Admission 실행 순서 — 누가 값을 바꾸고, 누가 거부하는가"
excerpt: "mutating·validating admission의 실제 호출 순서를 따라가며 기본값 주입, 재호출, Pod Security, quota와 저장 사이의 경계를 살펴봅니다"
category: kubernetes
tags: [Kubernetes, Admission, PodSecurity, ResourceQuota, concept]
series:
  name: "k8s-theory-api"
  order: 4
date: "2026-10-22"
---

[인가](/essays/k8s-theory-authorization)를 통과했다고 요청 본문의 모든 값이 허용된 것은 아닙니다
일반적인 RBAC 규칙은 사용자가 Deployment를 만들 수 있는지 판단하지만, `spec.replicas`의 상한까지 검사하지는 않습니다

Admission은 디코딩된 오브젝트를 저장하기 전에 내용을 바꾸거나 요청을 거부합니다
어떤 값이 최종 검사에 들어가는지 알려면 플러그인의 이름보다 실제 호출 순서를 봐야 합니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## Pod 생성 요청에서 검사하는 순서

일반적인 내장 리소스의 CREATE에서는 API 기본값이 적용된 오브젝트가 mutating admission에 들어갑니다
이 단계의 참여자는 값을 바꾸거나 요청을 거부할 수 있습니다

그다음 저장 전략이 생성에 필요한 값을 정리하고, 타입과 메타데이터를 검증합니다
저장 전략은 리소스마다 생성·갱신의 준비와 검증 방법을 정한 구현입니다
이 준비를 지난 오브젝트에 validating admission을 적용하고, 통과하면 저장소에 씁니다

![일반 CREATE에서 mutating admission, 저장 전략, validating admission, 저장 쓰기가 이어지는 순서](/diagrams/k8s-theory-admission-order-1.svg)

ServiceAccount 플러그인이 Pod에 토큰 volume 명세를 넣었다면, 뒤의 검사는 그 변경까지 포함한 오브젝트를 봅니다
validating까지 통과해도 실제 저장 쓰기는 실패할 수 있습니다

이 흐름을 모든 API 요청에 그대로 적용하면 안 됩니다
일반 GET·LIST·WATCH의 응답 객체를 admission이 하나씩 필터링하지는 않습니다
PATCH는 변경안을 적용한 결과를 대상으로 UPDATE 또는 CREATE admission을 구성하며, DELETE·CONNECT와 하위 리소스는 각 handler의 경로를 따릅니다

처리 순서는 [`createHandler`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/handlers/create.go), [`BeforeCreate`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/registry/rest/create.go), [`Store.create`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/registry/generic/registry/store.go)에서 확인할 수 있습니다

## 플러그인 목록 하나를 두 단계에서 사용합니다

kube-apiserver에는 실행 순서가 정해진 admission 플러그인 목록이 있습니다
mutating 단계에서는 현재 operation을 처리하면서 `MutationInterface`를 구현한 플러그인의 `Admit`를 호출합니다
validating 단계에서는 같은 목록에서 `ValidationInterface`를 구현한 플러그인의 `Validate`를 호출합니다

각 단계는 참여한 플러그인이 오류를 반환하면 멈춥니다
두 인터페이스를 모두 구현한 플러그인은 양쪽에 참여하지만, 목록에 있다는 이유로 무조건 두 번 호출되는 것은 아닙니다

`--enable-admission-plugins`는 어떤 플러그인을 켤지 정합니다
쉼표로 나열한 순서로 실행 순서를 다시 정하는 옵션은 아닙니다

| 플러그인 | 소스에서 확인한 참여 방식 | 주로 판단하거나 바꾸는 내용 |
|---|---|---|
| `NamespaceLifecycle` | `Admit` | namespace 존재·상태와 일부 삭제 제한 |
| `LimitRanger` | `Admit` + `Validate` | 자원 기본값과 최소·최대·비율 제약 |
| `ServiceAccount` | `Admit` + `Validate` | Pod의 ServiceAccount와 토큰 volume 명세 |
| `NodeRestriction` | `Admit` | node 신원이 바꿀 수 있는 대상·내용 |
| `Priority` | `Admit` + `Validate` | Pod priority 계산과 PriorityClass 제약 |
| `DefaultStorageClass` | `Admit` | PVC의 기본 StorageClass |
| `PodSecurity` | `Validate` | Pod Security Standards 충족 여부 |
| `ResourceQuota` | `Validate` | quota 검사와 사용량 갱신 |

이 표는 전체 플러그인이나 기본 활성 목록을 나열한 것이 아닙니다
실제 참여 여부는 서버 설정과 처리하는 operation에도 달려 있습니다

특히 `NamespaceLifecycle`과 `NodeRestriction`은 내용을 검사해 거부하는 기능이지만, 소스에서는 mutating 단계의 `Admit`로 참여합니다
공식 문서의 기능 분류인 `Type: Validating`과 실행 인터페이스를 구분해야 합니다
**mutating과 validating을 나누는 기준은 요청 오브젝트를 바꿀 수 있는지이며, 양쪽 모두 거부할 수 있습니다**

[`chain.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/chain.go)는 인터페이스별 호출을, [`AllOrderedPlugins`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubeapiserver/options/plugins.go)는 실행 순서를 정의합니다

## 기본값을 채운 뒤에도 검사가 남습니다

### ServiceAccount는 토큰 파일이 아니라 명세를 넣습니다

일반 Pod CREATE에서 `serviceAccountName`이 비어 있으면 ServiceAccount admission이 `default`를 채우고 해당 ServiceAccount를 조회합니다
없는 ServiceAccount를 이 과정에서 새로 만드는 것은 아닙니다
Pod의 `imagePullSecrets`가 비어 있으면 ServiceAccount에 지정된 값을 가져올 수도 있습니다

토큰 volume의 자동 주입은 `automountServiceAccountToken`을 따릅니다
Pod에 지정한 값이 우선이고, 없으면 ServiceAccount의 값을 사용합니다
둘 다 지정하지 않았으면 기본적으로 주입합니다

이때 추가하는 것은 projected volume과 mount가 들어 있는 **Pod 명세**입니다
기본 mount 경로를 이미 쓰는 컨테이너를 무조건 덮어쓰지 않으며, mirror Pod에는 별도의 제한이 있습니다
JWT 파일을 만들고 갱신하는 일은 저장·배치 뒤 kubelet이 담당합니다

`automountServiceAccountToken: false`는 자동 주입을 끕니다
ServiceAccount의 권한이나 TokenRequest API 자체를 없애는 설정은 아닙니다
[인증 편](/essays/k8s-theory-authentication)에서 명세 주입과 토큰 발급·갱신을 나누어 설명했습니다

### LimitRanger가 채운 값도 나중에 달라질 수 있습니다

`LimitRanger`는 namespace의 LimitRange를 읽어 비어 있는 requests·limits에 기본값을 넣을 수 있습니다
그런데 뒤의 mutator가 새 컨테이너를 추가하거나 자원 값을 바꿀 수 있습니다
그래서 처음 기본값을 채웠다는 사실만으로 최종 자원 형태를 판단할 수는 없습니다

validating 단계에서는 최소·최대 자원과 limit/request 비율을 검사합니다
최종 requests·limits는 QoS, 즉 Pod의 자원 서비스 등급을 정하는 입력에도 영향을 줍니다
`LimitRanger` 하나가 언제나 특정 QoS를 강제하는 것은 아닙니다

API 타입의 기본값 처리도 값을 채울 수 있습니다
사용자가 쓰지 않은 값이 저장돼 있다는 이유만으로 `LimitRanger`가 넣었다고 단정하면 안 됩니다

`Priority`도 PriorityClass를 바탕으로 Pod의 정수 priority와 관련 정책을 정합니다
존재하지 않는 class를 참조하거나 허용되지 않은 priority를 지정하면 mutating 경로에서 거부될 수 있습니다

### PVC는 미지정과 빈 문자열의 뜻이 다릅니다

`DefaultStorageClass`는 PVC의 `storageClassName`이 미지정됐을 때 기본 class를 선택할 수 있습니다
명시적인 빈 문자열 `""`은 class를 지정하지 않겠다는 뜻이므로 그대로 둡니다

| PVC의 입력과 현재 상태 | admission의 처리 |
|---|---|
| `storageClassName` 미지정, 기본 class 존재 | 기본 class를 채울 수 있음 |
| `storageClassName` 미지정, 기본 class 없음 | 미지정 상태로 통과 가능 |
| `storageClassName: ""` | 빈 문자열 유지 |

나중에 기본 class가 생기면 controller가 미지정 PVC에 값을 채우는 별도 경로도 있습니다
결과에 기본값이 보인다는 사실만으로 admission과 controller 중 누가 바꿨는지 알 수는 없습니다

구현은 [ServiceAccount](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/plugin/pkg/admission/serviceaccount/admission.go), [LimitRanger](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/plugin/pkg/admission/limitranger/admission.go), [Priority](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/plugin/pkg/admission/priority/admission.go), [DefaultStorageClass](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/plugin/pkg/admission/storage/storageclass/setdefault/admission.go)에서 확인했습니다
기본 class의 사후 지정은 [PV controller](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/volume/persistentvolume/pv_controller.go)가 담당합니다

## 값을 바꾸지 않아도 mutating 단계에서 거부할 수 있습니다

`NamespaceLifecycle`은 namespaced 요청의 namespace가 있는지 확인합니다
생성 대상 namespace가 `Terminating`이면 새 내용을 만드는 요청을 거부합니다
기존 객체를 정리하는 경로까지 같은 방식으로 막으면 namespace를 비울 수 있으므로, operation에 따라 판단이 다릅니다

namespace 정보는 변경 이벤트를 받아 로컬 사본을 유지하는 informer에서 읽고 필요하면 실제 API 조회로 보완합니다
조회 실패는 정책 위반에 따른 거부와 다른 오류가 될 수 있습니다

`NodeRestriction`은 node로 식별된 kubelet이 Node·Pod 등에 쓰려는 내용의 범위를 제한합니다
Node authorizer가 쓰기 API를 허용했더라도 요청 본문의 모든 변경을 허용한 것은 아닙니다
인가와 admission을 단순히 읽기 담당·쓰기 담당으로 나눌 수 없는 이유입니다

두 플러그인의 실행 위치는 [`Lifecycle.Admit`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/namespace/lifecycle/admission.go)와 [`Plugin.Admit`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/plugin/pkg/admission/noderestriction/admission.go)로 확인할 수 있습니다

## 뒤에서 바꾼 내용을 앞의 플러그인이 다시 보는 경우

플러그인 목록에서 `PodSecurity`는 `MutatingAdmissionWebhook`보다 앞에 있습니다
그렇다고 PodSecurity가 webhook의 변경 전 오브젝트만 검사하는 것은 아닙니다
Pod CREATE에서는 mutating 단계가 먼저 끝나고 validating 단계에서 PodSecurity를 실행합니다

mutating 단계 안에서도 앞선 판단이 최종 결과를 보장하지는 못합니다
가정으로, 앞의 mutator가 모든 컨테이너에 limit을 채운 뒤 뒤의 webhook이 새 sidecar를 추가했다고 해보겠습니다
앞의 mutator가 처음 본 오브젝트에는 그 sidecar가 없었습니다

![뒤 webhook이 추가한 컨테이너를 조건부 재호출로 다시 살피고 최종 검증하는 흐름](/diagrams/k8s-theory-admission-order-2.svg)

확인한 구현의 `reinvoker`는 재호출 요청이 있으면 mutating 체인을 한 번 더 실행합니다
내장 mutating 플러그인도 다시 평가하고, webhook dispatcher는 재호출 대상인 webhook을 따로 고릅니다

`reinvocationPolicy: IfNeeded`는 뒤의 변경을 다시 볼 기회를 허용합니다
모든 webhook을 정확히 두 번 부르거나, 변경이 없어질 때까지 반복한다는 보장은 아닙니다
기본값 `Never`는 해당 admission 평가 안에서 그 webhook을 다시 부르지 않는다는 뜻입니다

재호출될 수 있는 변경 로직은 같은 입력에 반복 적용해도 불필요하게 결과가 달라지지 않아야 합니다
이 성질이 멱등성입니다
필수 조건은 뒤의 validating 단계에서 다시 확인해야 합니다

저장 전략의 `PrepareForCreate`도 mutating 이후 값을 정리할 수 있습니다
따라서 여기서 최종 내용은 **이 요청의 검증 대상**을 뜻합니다
저장 시 채워지는 resourceVersion이나 이후 UPDATE까지 고정된다는 뜻은 아닙니다

근거는 [`reinvoker.Admit`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/reinvocation.go)와 [mutating dispatcher](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/webhook/mutating/dispatcher.go)입니다

## ResourceQuota의 사용량 반영과 Pod 저장은 별개입니다

ResourceQuota는 변경이 끝난 자원 값을 검사하고, 실제 요청의 quota 사용량 갱신에도 참여합니다
남은 quota가 Pod 한 개분인데 두 생성 요청이 동시에 들어온다고 가정하겠습니다
둘 다 남은 양을 읽고 허용하기만 하면 한도를 넘길 수 있습니다

quota admission은 예상 사용량을 계산하고 ResourceQuota status를 갱신합니다
여러 API 서버가 경쟁하면 이 갱신에서 충돌과 재시도가 생길 수 있습니다
그래서 단순히 목록을 조회해 현재 개수를 세는 것과는 다릅니다

하지만 ResourceQuota status 갱신과 Pod 저장은 하나의 etcd 트랜잭션이 아닙니다
사용량 반영 뒤 다른 검사나 저장이 실패하면 실제 객체와 사용량 기록이 어긋날 수 있습니다
ResourceQuota controller는 실제 사용량을 다시 계산해 그 차이를 보정합니다

quota를 뒤쪽에 배치하면 앞선 검사에서 거부될 요청의 사용량을 먼저 반영하는 일을 줄일 수 있습니다
그래도 저장 실패까지 없앨 수는 없습니다
server dry-run은 quota 적합성을 검사하되 사용량을 갱신하지 않으므로, 성공했다고 quota를 예약한 것도 아닙니다

**validating이 요청 오브젝트를 바꾸지 않는다는 말은 다른 객체의 상태도 전혀 갱신하지 않는다는 뜻이 아닙니다**
이 차이는 [quota evaluator](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/resourcequota/controller.go)와 [ResourceQuota controller](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/resourcequota/resource_quota_controller.go)에서 드러납니다

## Admission이 넣은 필드의 소유자는 자동으로 생기지 않습니다

`managedFields`는 어떤 작성자가 어떤 필드를 관리하는지 기록합니다
일반 CREATE에서는 이 기록을 계산하는 field manager 처리가 mutating admission보다 앞에 있습니다
따라서 admission이 필드를 추가해도 플러그인 이름의 관리자가 자동으로 생기지는 않습니다

이것을 admission이 건드린 모든 필드는 무조건 소유자가 없다는 뜻으로 넓히면 안 됩니다
이미 소유 기록이 있는 필드의 값을 바꿨다고 그 기록까지 자동으로 없어지는 것은 아닙니다

사용자가 보내지 않은 필드를 모두 사용자의 apply 의도로 처리하면, 다음 apply에서 그 필드를 생략했을 때 삭제·충돌의 의미가 달라질 수 있습니다
필드 값과 소유 기록을 구분해야 하는 이유입니다

서버는 admission이 `managedFields` 자체를 잘못 바꾸면 이전 값을 복구하고 경고합니다
이 보호도 새 필드의 소유자를 대신 만드는 기능은 아닙니다
[`managedFieldsValidatingAdmissionController`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/handlers/fieldmanager/admission.go)에서 이 처리를 확인했습니다

## Deployment는 생성됐는데 Pod는 거부될 수 있습니다

PodSecurity Admission, 줄여서 PSA는 Pod Security Standards를 적용하는 내장 플러그인입니다
`enforce`는 위반 요청을 거부하고, `audit`은 감사 이벤트의 annotation에 위반 정보를 더하며, `warn`은 응답 경고를 보냅니다
각 모드는 `privileged`·`baseline`·`restricted` 수준과 정책 버전을 따로 선택할 수 있습니다

예를 들어 enforce는 baseline, audit·warn은 restricted로 정하면 더 강한 규칙의 영향을 거부 없이 먼저 확인할 수 있습니다
`latest`를 쓰는 것과 특정 버전을 고정하는 것은 업그레이드 때 적용할 규칙이 달라질 수 있다는 차이가 있습니다

PSA를 켰다고 모든 namespace에 restricted가 적용되지는 않습니다
namespace label, admission 설정의 기본 정책, username·namespace·RuntimeClass 면제가 범위를 정합니다
면제된 요청은 일반적인 enforce·audit·warn 평가를 건너뜁니다
감사 annotation이 실제 로그로 남는지도 audit 정책과 backend에 달려 있습니다

PSA는 Deployment의 Pod template을 읽을 수 있지만, workload 경로에서는 enforce를 적용하지 않습니다
audit·warn은 적용할 수 있습니다
따라서 Deployment 생성이 성공하고 경고만 받더라도, 나중에 ReplicaSet controller가 보내는 Pod CREATE는 enforce에 의해 거부될 수 있습니다

두 요청의 사용자도 다릅니다
원래 사용자를 username 면제로 지정해도 controller의 Pod 요청이 자동 면제되지는 않습니다
반대로 controller 신원을 면제하면 그 controller를 통해 Pod를 만드는 여러 사용자에게 효과가 확장됩니다

namespace의 정책을 강화해도 기존 Pod 전체에 admission을 다시 실행하지는 않습니다
namespace label 변경 때 기존 Pod의 위반을 살펴 경고할 수 있지만, 해당 Pod를 자동 삭제하는 기능은 아닙니다

[PSA 구현](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/pod-security-admission/admission/admission.go)의 `ValidatePodController`와 `EvaluatePod`에서 workload의 `enforce=false` 경로를 확인할 수 있습니다

## 응답 코드와 메시지를 함께 봅니다

403이라고 모두 RBAC 거부인 것은 아니고, 422라고 모두 admission 이전의 타입 검증 오류인 것도 아닙니다
오류를 만든 주체와 요청 경로를 함께 확인해야 합니다

| 증상 | 구분에 도움이 되는 메시지·조건 | 확인할 경계 |
|---|---|---|
| 403 | `violates PodSecurity` | PSA의 enforce 판단 |
| 403 | `exceeded quota` | ResourceQuota 사용량 검사 |
| 403 | `unable to create new content in namespace` | NamespaceLifecycle의 생성 제한 |
| 404 또는 500 | namespace 실제 조회의 NotFound 또는 다른 오류 | namespace 조회 실패 |
| 422 | `spec.containers[0].image: Required value` 등 | Pod 타입 검증 후보 |
| 422·403 등 | VAP 또는 webhook 거부 메시지 | 해당 admission 정책 |
| Deployment 성공, Pod 없음 | controller의 후속 Pod CREATE 거부 | 별도 요청의 PSA·quota 등 |

Admission은 저장 전에 조건을 만족시키거나 현재 요청을 거부합니다
저장 뒤 controller가 고치는 방식이라면, 수정되기 전 상태를 다른 컴포넌트가 볼 수 있습니다
그 대신 admission에 놓은 판단의 지연과 오류는 현재 API 요청에 직접 영향을 줍니다
[다음 편](/essays/k8s-theory-admission-webhook-failure)에서는 그 판단을 외부 webhook에 맡길 때의 실패 처리를 이어서 살펴봅니다

## 공식 문서

- [Admission Controllers](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/access-authn-authz/admission-controllers.md)
- [Pod Security Admission](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/security/pod-security-admission.md)
- [Resource Quotas](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/policy/resource-quotas.md)
- [Limit Ranges](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/policy/limit-range.md)
