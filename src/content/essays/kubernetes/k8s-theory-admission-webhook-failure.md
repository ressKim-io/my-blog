---
title: "Admission webhook과 CEL 정책 — 판단 실패는 어떻게 처리할까"
excerpt: "webhook의 정상 거부·호출 실패·적용 제외를 구분하고, VAP·MAP의 입력과 오류 처리, 정책이 자신의 복구를 막는 조건을 살펴봅니다"
category: kubernetes
tags: [Kubernetes, Admission, Webhook, CEL, ValidatingAdmissionPolicy, concept]
series:
  name: "k8s-theory-api"
  order: 5
date: "2026-07-29"
---

[앞선 글](/essays/k8s-theory-admission-order)에서는 저장 전에 값을 바꾸고 검사하는 순서를 살펴봤습니다
이 흐름에 직접 작성한 규칙을 넣으려면, 누가 그 규칙을 실행할지도 정해야 합니다

Admission webhook은 API 서버가 HTTPS로 호출하는 별도 프로그램입니다
클러스터 안의 Service로 연결하든 외부 URL로 연결하든, API 서버는 그 프로그램의 응답을 기다립니다
규칙을 자유롭게 작성할 수 있는 만큼 webhook 프로그램의 지연과 장애도 원래 요청에 영향을 줍니다

VAP(ValidatingAdmissionPolicy)와 MAP(MutatingAdmissionPolicy)는 CEL로 적은 규칙을 API 서버 안에서 평가합니다
CEL은 제공된 입력을 바탕으로 조건이나 변경을 표현하는 언어입니다
별도 admission 서버를 운영할 필요는 줄지만, 사용할 수 있는 입력과 기능의 범위도 달라집니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 클러스터 실측은 포함하지 않으며, 수치가 들어간 상황 예시는 설명을 위한 가정입니다

## AdmissionReview는 원래 HTTP 요청과 다릅니다

API 서버는 심사 정보를 `AdmissionReview`의 `request` 필드에 담고, 이 `AdmissionReview` 객체를 webhook에 POST합니다
원래 요청의 모든 헤더나 자격 증명을 전달하는 구조는 아닙니다
요청자는 이미 인증을 거쳤으며, 그 결과를 `userInfo`로 전달합니다

| v1 request 필드 | 전달하는 정보 |
|---|---|
| `uid` | 이 호출과 응답을 연결하는 값. 대상 객체의 `metadata.uid`와 다름 |
| `kind`·`resource`·`subResource` | webhook이 심사할 종류와 리소스·하위 리소스 |
| `requestKind`·`requestResource`·`requestSubResource` | 동등한 API 버전으로 변환하기 전 원래 요청의 정보 |
| `operation` | `CREATE`·`UPDATE`·`DELETE`·`CONNECT`. HTTP method·RBAC verb와 별개의 분류 |
| `name`·`namespace`·`userInfo` | 요청 대상과 인증된 신원. impersonation 적용 시에는 그 신원 |
| `object`·`oldObject` | 새 객체와 기존 객체. CREATE의 oldObject와 DELETE의 object는 없음 |
| `options`·`dryRun` | operation의 옵션과 저장하지 않는 요청인지 여부 |

응답은 `AdmissionReview.response`에 담으며, 요청과 같은 UID를 돌려줘야 합니다
HTTP 200으로 정상 응답하면서도 `allowed: false`로 정책상 거부할 수 있습니다
**webhook과 통신에 성공한 것과 원래 API 요청을 허용한 것은 다릅니다**

mutating webhook은 고친 객체 전체가 아니라 patch를 반환합니다
v1에서 지원하는 `patchType`은 `JSONPatch`이고, JSON 응답의 `patch` 바이트는 base64로 인코딩합니다
API 서버가 그 호출 시점의 객체에 patch를 적용합니다
validating webhook은 이 방식으로 객체를 변경하지 않습니다

`status`는 거부 이유와 코드를, `warnings`는 클라이언트 경고를 전달합니다
`auditAnnotations`는 감사 이벤트에 정보를 더합니다
경고와 annotation은 허용 응답에도 포함할 수 있으므로 경고를 받았다고 거부된 것은 아닙니다

`admissionReviewVersions`는 webhook이 이해하는 AdmissionReview 버전을 선호 순서로 나열한 필드입니다
API 서버는 자신도 지원하는 첫 버전을 선택합니다
이 버전은 안에 들어 있는 Pod·Deployment의 API 버전과 별개입니다

새 webhook 설정에 지원 가능한 AdmissionReview 버전이 하나도 없으면 등록 시 검증에서 거부합니다
이미 저장된 설정이 서버와 맞지 않게 됐다면 호출 시 실패하고 `failurePolicy`를 따릅니다
등록 오류와 호출 오류를 구분해야 합니다

통신 대상은 `clientConfig.service` 또는 `clientConfig.url`로 정하고 `caBundle`로 서버 인증서를 검증합니다
HTTPS로 연결하는 주체는 API 서버이고, 본문의 `userInfo`는 원래 요청자입니다
본문에 사용자 이름이 있다는 사실만으로 신뢰할 수 있는 API 서버의 호출임을 보장하지는 않습니다

근거는 [AdmissionReview v1 타입](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/admission/v1/types.go), [응답 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/webhook/request/admissionreview.go), [등록 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/admissionregistration/validation/validation.go)입니다

## 매칭 범위가 장애의 직접 영향 범위입니다

webhook의 `failurePolicy`는 호출 오류 등으로 판단을 얻지 못했을 때의 처리를 정합니다
기본값은 `Fail`입니다
`Fail`은 판단 오류로 요청을 거부하고, `Ignore`는 해당 오류를 넘겨 뒤의 검사를 진행하게 합니다

API 서버는 원격 호출 전에 `rules`, selector, `matchConditions`로 대상 요청을 고릅니다
정책 적용 대상에서 제외하면 그 webhook의 응답도 기다리지 않습니다

| 필드 | 적용 범위를 정하는 방식 | 주의할 조건 |
|---|---|---|
| `rules` | operation·group·version·resource·scope | `pods`와 `pods/status`는 별개. `*`는 최상위 리소스, `*/*`는 하위 리소스까지 포함 |
| `matchPolicy` | 정확한 일치 또는 동등한 리소스의 버전 변환 | 기본 `Equivalent`. 빠진 operation·하위 리소스까지 추가하지 않음 |
| `namespaceSelector` | 대상 Namespace의 라벨 | Namespace 자체는 그 객체의 라벨로 판정. 그 외 클러스터 범위 객체는 이 selector로 제외할 수 없음 |
| `objectSelector` | 새 객체 또는 기존 객체의 라벨 | 하나라도 매칭되면 대상 |
| `matchConditions` | CEL로 표현한 추가 조건 | `false`와 평가 오류를 구분 |

`objectSelector`는 사용자가 라벨로 참여를 선택하는 정책에 적합합니다
모두에게 강제할 정책을 그 라벨 하나에만 의존시키면, 처음부터 라벨 없이 생성해 검사를 피할 수 있습니다

이미 붙은 라벨을 지우는 UPDATE는 기존 객체도 매칭하므로 그 UPDATE 요청 자체가 검사 대상이 됩니다
하지만 라벨이 사라진 뒤의 요청까지 자동으로 검사하지는 않습니다
Namespace 라벨도 마찬가지로 누가 만들고 바꿀 수 있는지 확인해야 합니다

`Equivalent`는 API 서버가 동등한 것으로 인식하는 리소스에 적용합니다
더 이상 제공하지 않는 API 버전만 규칙에 남겨 놓고 다른 버전까지 계속 검사할 것이라고 가정해서는 안 됩니다

| `matchConditions` 결과 | 처리 |
|---|---|
| 하나라도 실제로 `false`가 나옴 | webhook 제외. 다른 조건의 개별 오류보다 제외가 우선 |
| 모두 `true` | webhook 호출 |
| `false` 없이 평가 오류 | `Fail`이면 거부, `Ignore`이면 webhook 제외 |

CEL의 계산량 한도를 넘어 평가 자체가 중단됐다면, 아직 계산하지 않은 조건이 false일 것이라고 가정할 수 없습니다
서버에 연락하기 전 대상 선택 과정에서도 요청이 실패할 수 있습니다

매칭 근거는 [`ShouldCallHook`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/webhook/generic/webhook.go), [resource 규칙](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/webhook/predicates/rules/rules.go), [객체 selector](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/webhook/predicates/object/matcher.go), [Namespace selector](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/webhook/predicates/namespace/matcher.go), [조건 평가](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/webhook/matchconditions/matcher.go)입니다

## Ignore는 정상적인 거부를 무시하지 않습니다

| webhook의 결과 | `Fail` | `Ignore` |
|---|---|---|
| 정상 응답 `allowed: true` | 다음 검사로 진행 | 다음 검사로 진행 |
| 정상 응답 `allowed: false` | 거부 | 거부 |
| 연결·TLS·timeout·응답 검증 등의 호출 오류 | 거부 | 그 호출 실패를 무시하고 다음 검사로 진행 |

`Ignore`로 다음 검사에 넘겨도 저장 성공은 보장되지 않습니다
필수 라벨을 넣는 mutating webhook이 응답하지 못했다고 가정하겠습니다
뒤의 validator가 그 라벨을 요구하면 라벨이 추가되지 않은 객체는 거기서 거부됩니다
사용자가 처음부터 라벨을 넣었다면 같은 최종 검증을 통과할 수도 있습니다

다만 라벨을 넣는 webhook과 최종 validator가 같은 서버에 의존한다면, 그 서버가 장애 상태일 때 검증 단계에서도 다시 응답을 기다립니다
변경과 검증의 역할을 나누는 것만으로 가용성이 개선되지는 않습니다

## 직렬 호출과 병렬 호출의 대기 시간

mutating webhook은 앞에서 바꾼 객체를 다음 webhook에 넘겨야 하므로 차례로 호출합니다
`ValidatingAdmissionWebhook` 플러그인은 변경이 끝난 객체를 대상으로 매칭된 원격 webhook들을 병렬 호출합니다

![mutating webhook은 차례로 변경하고 validating webhook은 병렬로 검사한 뒤 결과를 모으는 구조](/diagrams/k8s-theory-admission-webhook-failure-1.svg)

mutating에서는 앞 호출의 대기 시간에 뒤 호출의 대기 시간이 더해집니다
재호출이 있으면 그 시간도 추가됩니다
validating에서는 보통 가장 늦게 끝나는 호출이 전체 대기 시간을 크게 좌우합니다

확인한 validating dispatcher는 시작한 호출들이 끝날 때까지 기다립니다
하나가 바로 거부해도 다른 느린 호출의 대기 시간이 남을 수 있습니다
여러 webhook의 거부 중 먼저 표시된 오류를 정책의 고정 우선순위로 해석해서도 안 됩니다

`timeoutSeconds`는 webhook 한 번을 기다릴 제한 시간으로, v1 설정의 기본값은 10초이고 범위는 1~30초입니다
원래 API 요청의 제한 시간이 먼저 끝나면 개별 webhook의 시간이 남아 있어도 더 기다리지 못합니다

호출 대상 선택·객체 변환에도 시간이 들고, 앞 호출이 실패해 `Fail`로 끝나면 뒤 호출은 실행하지 않습니다
따라서 timeout 값의 합이 항상 실제 요청 시간인 것은 아닙니다
`context deadline exceeded` 역시 시간 내에 완료하지 못했다는 뜻이지, 서버가 살아 있고 단지 느렸다는 증거는 아닙니다

실행 방식은 [mutating dispatcher](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/webhook/mutating/dispatcher.go)와 [validating dispatcher](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/webhook/validating/dispatcher.go)에서 확인했습니다

## Ignore가 무시할 수 있는 오류의 범위

구현은 호출 실패인 `ErrCallingWebhook`과 정책 거부인 `ErrWebhookRejection`을 구분합니다
응답의 patch를 해석하지 못한 오류는 호출 오류지만, 해석한 JSONPatch를 객체에 적용하다 실패한 것은 내부 오류로 반환합니다
후자는 `Ignore`여도 요청이 실패할 수 있습니다

원래 API 요청의 제한 시간이 끝나거나 admission 플러그인이 준비되지 않은 상황도 개별 webhook의 호출 실패와 다릅니다
`Ignore`를 모든 admission 오류를 없애는 설정으로 읽으면 안 됩니다

판단을 받지 못했는데도 진행하는 방식을 fail-open이라고 합니다
API 서버는 이를 로그·metric·admission audit annotation으로 남길 수 있지만, 실제 감사 로그 저장은 audit 설정에 달려 있습니다
클라이언트가 성공 응답을 받았다고 모든 webhook이 정상 응답한 것은 아닙니다

## 재호출은 처음 제외한 webhook을 모두 찾아주지 않습니다

앞선 webhook이 기존 컨테이너에 limit을 채운 뒤 다른 webhook이 새 sidecar를 넣을 수 있습니다
`reinvocationPolicy: IfNeeded`는 뒤의 변경을 다시 살필 수 있도록 추가 호출을 허용합니다
기본 `Never`와 달리 재호출을 허용하지만, 모든 요청에서 한 번 더 실행하거나 변경이 멈출 때까지 반복한다는 보장은 아닙니다
추가 호출을 줄이기 위해 순서가 바뀔 수도 있습니다

확인한 구현에서는 처음에 selector가 맞지 않아 호출하지 않은 webhook을 두 번째 단계에서 처음 호출하지 않습니다
뒤 webhook이 라벨을 바꿔 조건에 맞게 되더라도, 처음 건너뛴 webhook이 재호출 과정에 새로 참여하지는 않습니다

변경 로직은 같은 객체에 다시 적용해도 불필요한 중복을 만들지 않아야 합니다
“sidecar가 없으면 추가한다”와 “항상 하나 추가한다”는 재호출 결과가 다릅니다
재호출을 꺼도 사용자가 이미 sidecar가 있는 객체를 보낼 수 있으므로 멱등성은 여전히 필요합니다

각 webhook이 멱등적이어도 서로의 변경을 되돌릴 수 있습니다
따라서 각각의 멱등성뿐 아니라 실행 순서와 여러 변경이 함께 안정된 결과에 도달하는지도 살펴야 합니다
필수 조건은 변경이 끝난 뒤 validating 단계에서 확인해야 합니다

[`reinvoker`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/reinvocation.go)는 추가 mutating 단계를 실행하고, 앞서 연결한 mutating dispatcher가 호출 대상을 고릅니다

## 최신 목록을 읽는 것만으로 전체 개수를 제한할 수는 없습니다

객체를 열 개까지만 허용하는 webhook이 현재 아홉 개를 조회했다고 가정하겠습니다
동시에 들어온 두 요청이 모두 아홉 개를 보고 하나씩 허용하면, 둘 다 저장된 뒤에는 열한 개가 됩니다
조회 당시의 목록이 최신이어도 가능한 상황입니다

검사와 저장 사이에 다른 요청이 끼어들 수 있으므로, 캐시를 없애는 것만으로 해결되지는 않습니다
총량·유일성을 엄격히 보장하려면 경쟁 요청을 조정하거나 관련 상태를 원자적으로 확정해야 합니다

## 외부 부작용은 저장 실패와 함께 되돌아가지 않습니다

webhook이 허용 응답과 함께 외부 시스템에 예약을 만들 수 있습니다
그 뒤 다른 validator가 거부하거나 저장이 실패하면 Kubernetes 객체 없이 외부 예약만 남을 수 있습니다
webhook의 외부 작업과 etcd 저장은 하나의 트랜잭션이 아니기 때문입니다

외부 상태를 바꾸는 webhook에는 실제 저장 결과와 나중에 대조해 차이를 맞추는 처리가 필요합니다
이처럼 실제 상태를 계속 맞추는 과정을 reconciliation이라고 합니다

v1 설정의 `sideEffects: None`은 외부 변경을 하지 않는다는 선언입니다
`NoneOnDryRun`은 일반 요청의 부작용은 가능하지만 dry-run에서는 억제한다는 선언입니다
응답 patch로 현재 심사 중인 객체를 바꾸는 것은 여기서 말하는 외부 부작용과 다릅니다

dry-run도 admission을 거칩니다
webhook이 `dryRun: true`를 받고 외부 시스템을 바꾸면 선언을 어긴 것이며, API 서버가 그 쓰기를 강제로 막아주는 것은 아닙니다

## 자신의 복구 요청까지 검사하면 순환이 생깁니다

webhook W가 모든 namespace의 Pod CREATE를 검사하고 `failurePolicy: Fail`을 쓴다고 가정하겠습니다
W 자신도 Pod로 실행되는데 정상 endpoint가 모두 사라졌고, 복구에 새 Pod 생성이 필요하면 문제가 생깁니다

![응답 불가능한 webhook이 자기 복구 Pod의 생성까지 검사하면서 복구를 막는 순환 의존성](/diagrams/k8s-theory-admission-webhook-failure-2.svg)

W를 복구할 Pod를 만들려면 W의 판단을 받아야 하지만 W가 응답하지 못합니다
controller가 재시도해도 같은 의존 관계가 남아 있으면 거부됩니다

다른 정상 endpoint가 있거나 기존 Pod의 컨테이너 재시작만으로 회복할 수 있다면 상황이 다릅니다
노드 하나의 장애가 언제나 이 순환을 만드는 것은 아닙니다
일반 GET·LIST·WATCH가 admission webhook의 장애 때문에 직접 차단되거나 기존 Pod가 즉시 종료되는 것도 아닙니다
다만 이후 복구·갱신 요청이 막히면 controller와 시스템 컴포넌트가 다음 작업을 진행하지 못할 수 있습니다

`namespaceSelector`로 복구 Pod를 제외하면 그 Pod가 W의 응답을 기다리지 않게 할 수 있습니다
동시에 그 영역에는 해당 정책이 적용되지 않습니다
W의 Namespace만이 아니라 DNS·인증서·네트워크 등 의존 컴포넌트의 복구 요청도 살펴야 합니다
클러스터 범위 요청은 namespaceSelector만으로 제외할 수 없습니다

## VAP는 규칙과 적용 방식을 나눕니다

VAP는 v1.30부터 stable이며, 여기서는 `admissionregistration.k8s.io/v1`을 기준으로 설명합니다
Policy에 검증식과 범위를 적고, Binding으로 실제 적용 대상·파라미터·위반 처리를 연결합니다
**Policy만 만들고 대응하는 Binding이 없으면 그 규칙은 요청에 적용되지 않습니다**

요청이 Policy의 `matchConstraints`와 Binding의 `matchResources` 양쪽 조건에 맞아야 정책이 적용됩니다
Binding은 범위를 좁힐 수 있지만 Policy가 대상으로 삼지 않은 리소스까지 넓히지는 못합니다
`excludeResourceRules`에 맞으면 포함 규칙에 맞아도 제외합니다

### 파라미터가 여러 개면 각각 평가합니다

Binding의 `paramRef`는 `name` 또는 `selector`로 파라미터 객체를 고릅니다
두 필드를 동시에 지정하지는 않습니다
selector가 두 객체를 고르면 같은 규칙을 파라미터만 바꿔 두 번 평가합니다
매칭된 Binding이 여러 개라면 각각에서 평가합니다

replicas 상한이 3과 5인 두 파라미터를 골랐다고 가정하겠습니다
replicas가 4인 요청은 상한 5에는 맞아도 상한 3에는 어긋납니다
이 Binding의 위반 처리가 `Deny`라면 거부됩니다
한 평가의 통과가 다른 평가의 거부를 취소하지는 않습니다

### CEL은 제공된 입력으로 판단합니다

| 검증식의 입력 | 의미 |
|---|---|
| `object`·`oldObject` | 새 객체와 기존 객체. operation별 null 고려 |
| `request` | 요청자·동작·리소스 등 admission 요청 정보 |
| `params` | Binding이 선택한 파라미터 객체 |
| `namespaceObject` | 대상 Namespace 정보. 클러스터 범위 요청에는 null |
| `authorizer`·`authorizer.requestResource` | 해당 신원의 권한 질의 |
| `variables` | 필요할 때 평가하는 이름 붙인 표현식 |

표는 validation 표현식의 입력입니다
같은 정책이어도 `matchConditions`에서는 `variables`를 쓸 수 없고, `messageExpression`에는 `authorizer`가 제공되지 않습니다
변수는 앞에서 정의한 변수를 참조할 수 있지만 순환 참조는 허용하지 않습니다

CEL이 직접 HTTP 요청을 보내거나 다른 Deployment 전체를 조회하는 것은 아닙니다
`authorizer`도 임의의 객체 본문 조회가 아니라 권한 질의입니다
다만 인가 체인이 외부 webhook까지 진행하면 CEL 평가 중에도 그 외부 응답을 기다릴 수 있습니다
요청 안에서 같은 인가 질의를 캐시해도 첫 질의의 외부 의존성은 남습니다

`check(...)`의 결과에는 인가 결정과 오류 정보가 함께 들어갑니다
`.allowed()`는 Allow인지, `.errored()`는 오류가 있었는지 확인합니다
오류와 비허용 결정이 함께 돌아와도 `.allowed()` 자체는 정상적으로 `false`를 낼 수 있습니다
이를 검증식으로 쓰면 CEL 평가 실패가 아니라 규칙 위반으로 처리될 수 있습니다

파라미터는 주로 informer의 사본에서 읽습니다
v1.37.1의 `CollectParams`에는 **이름으로 조회한 파라미터가 캐시에 없을 때 직접 API 조회로 보완하는 경로**도 있습니다
selector 조회까지 항상 최신 API 조회로 바뀌는 것은 아닙니다
어느 경로든 파라미터·Namespace를 읽는 작업과 심사 대상 객체를 저장하는 작업이 하나의 트랜잭션으로 묶이지는 않습니다
따라서 API 서버 내부에서 평가하는 VAP도 동시 요청의 총량·유일성을 그 평가만으로 보장하지는 않습니다

### 파라미터를 찾지 못한 경우를 구분합니다

| 설정·조회 결과 | 처리 |
|---|---|
| Policy에 `paramKind` 없음 | 파라미터 없이 평가 |
| `paramKind`는 있고 Binding의 `paramRef` 없음 | `params`가 null인 상태로 평가 |
| 조회 결과 0개, `parameterNotFoundAction: Allow` | 이 Binding의 파라미터 검증을 실행하지 않고 통과 |
| 조회 결과 0개, `parameterNotFoundAction: Deny` | 설정 오류로 전달하고 Policy의 `failurePolicy` 적용 |
| 필요한 Kind 또는 캐시가 준비되지 않음 | 정상 false와 구분되는 설정·준비 오류 |

namespace에 속하는 파라미터는 `paramRef.namespace`를 생략하면 대상 요청의 namespace에서 찾습니다
대상 요청이 클러스터 범위라면 기본 namespace가 없으므로 명시해야 합니다
클러스터 범위 파라미터에는 namespace를 지정하지 않습니다

### 정상 위반과 평가 오류는 다른 설정을 거칩니다

Binding의 `validationActions`는 확인된 위반을 처리하는 방법입니다
`Deny`는 거부, `Warn`은 경고, `Audit`은 감사 annotation을 뜻합니다
`[Deny, Audit]`나 `[Warn, Audit]`은 가능하지만 `[Deny, Warn]`은 허용하지 않습니다

| 검증식의 결과 | `failurePolicy: Ignore` | `failurePolicy: Fail` |
|---|---|---|
| 정상 `true` | 통과 | 통과 |
| 정상 `false` | Binding의 actions 적용 | Binding의 actions 적용 |
| 검증식 평가 오류 | 그 오류를 이유로 거부하지 않음 | 평가 실패를 Binding의 actions에 전달 |

상한 3을 읽고 replicas 4와 비교했다면 결과는 정상적인 false입니다
`Ignore`여도 Binding이 `Deny`면 거부합니다
반면 `params`가 null인데 `params.maxReplicas`를 읽으면 평가 오류이므로 실패 정책을 거칩니다

**이 표를 모든 VAP 오류로 넓히면 안 됩니다**
확인한 소스에서는 설정 오류와 개별 audit annotation 평가 오류에 직접 거부 경로가 있습니다
예를 들어 파라미터를 찾지 못했고 `parameterNotFoundAction: Deny`, `failurePolicy: Fail`이면 Binding이 Warn이어도 거부할 수 있습니다

API 필드 설명은 Fail 오류를 actions에 따라 처리한다고 적지만, 이 구현 경로는 actions를 거치지 않습니다
따라서 문서의 일반 설명만으로 v1.37.1의 이 오류 처리를 판단할 수는 없습니다
Warn Binding을 모든 오류에서도 통과하는 설정으로 취급해서는 안 됩니다

문법 오류는 Policy 등록 때 발견할 수 있고, 타입 검사에서 발견한 문제는 `status.typeChecking.expressionWarnings`에 기록됩니다
이 경고가 정책을 자동으로 끄지는 않습니다
wildcard·CRD 타입 검사에도 제약이 있으므로 경고가 없다고 모든 요청에서 평가가 성공하는 것은 아닙니다

VAP의 근거는 [API 타입](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/admissionregistration/v1/types.go), [`CollectParams`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/policy/generic/policy_dispatcher.go), [validator](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/policy/validating/validator.go), [dispatcher](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/policy/validating/dispatcher.go), [CEL 인가 라이브러리](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/cel/library/authz.go)입니다

## MAP의 변경과 필드 소유권도 구분합니다

MAP는 CEL 표현식으로 patch를 만들어 심사 중인 객체에 적용합니다
Policy와 Binding으로 규칙과 적용 범위를 연결하는 구조는 VAP와 같습니다

v1.35에서는 MAP가 beta·기본 off였습니다
**v1.36부터 GA·기본 활성이고, 이번에 확인한 v1.37.1에서도 기본 활성입니다**
v1.35에서 필요했던 feature gate·v1beta1 활성화 절차를 v1.37의 필수 조건으로 적용하면 안 됩니다
실제 서버의 플러그인 설정과 Policy·Binding·매칭 조건은 여전히 확인해야 합니다

| `patchType` | 동작과 제약 |
|---|---|
| `ApplyConfiguration` | 스키마에 따라 필드를 병합. 일부 필드만 적어 다른 값이 사라지는 것을 막기 위해 atomic struct·map·array 변경은 거부 |
| `JSONPatch` | 경로와 연산으로 수정. 배열 위치·경로 존재·특수 문자 표기를 정확히 처리해야 함 |

`ApplyConfiguration`은 Server-Side Apply의 병합 방식을 사용하지만 별도의 apply API 요청을 보내지는 않습니다
정책 이름의 field manager를 만들어 소유권을 추적하지도 않습니다
새로 더한 필드와 기존 소유 기록이 있는 필드의 변경은 이후 apply에서 다른 영향을 줄 수 있습니다

한 Policy의 `mutations`는 순서대로 평가하고 적용합니다
이 순서를 여러 Policy·Binding·webhook 전체의 고정 순서로 확대해서는 안 됩니다
MAP의 `reinvocationPolicy`는 반드시 지정하는 필드이며 값은 `Never` 또는 `IfNeeded`입니다
생략하면 Never가 되는 webhook 설정과는 다릅니다

MAP는 CREATE·UPDATE·CONNECT를 대상으로 하며 DELETE는 제외합니다
VAP의 `validationActions`도 없습니다
변경 뒤 필수 조건은 validating 단계에서 확인합니다

`failurePolicy`의 기본값은 `Fail`입니다
`Ignore`를 지정해도 정책 전체가 실행 전 상태로 되돌아가지는 않습니다
첫 mutation으로 라벨을 추가하고 뒤 mutation의 오류를 무시했다면 앞의 라벨이 남을 수 있습니다
객체 변환기 준비 실패 등 일부 내부 오류는 이 실패 정책을 거치지 않고 바로 반환됩니다(`StatusError`)
이런 경우에는 Ignore여도 요청이 실패할 수 있습니다

CEL을 내부에서 실행해도 계산 비용은 듭니다
평가 예산은 수행한 계산량을 제한하는 기준이며, 초 단위의 시간 제한과는 다릅니다
개별 평가가 한도 안에 들어도 Policy·Binding·파라미터 조합이 많아지면 총 계산량이 늘어납니다

근거는 [feature gate 이력](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/features/kube_features.go), [MAP 플러그인](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/policy/mutating/plugin.go), [변경 dispatcher](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/policy/mutating/dispatcher.go), [소유권을 추적하지 않는 병합 구현](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/policy/mutating/patch/smd.go)입니다

[기본 플러그인 순서](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubeapiserver/options/plugins.go)에서는 MAP가 mutating webhook보다 앞에 있습니다
validating에서는 VAP, validating webhook, ResourceQuota 순서로 진행합니다
앞 VAP가 거부하면 뒤 원격 호출을 줄일 수 있지만, 그것을 유일한 설계 이유로 단정하지는 않습니다
ResourceQuota의 사용량 조정·사후 보정은 [앞선 글](/essays/k8s-theory-admission-order)에서 다룬 별도 구현입니다

## Admission 설정의 면제에도 범위가 있습니다

v1.37.1에서 **API로 등록한** webhook과 CEL 정책에는 다음 설정 제외가 있습니다

| 평가 주체 | API 기반 검사에서 제외하는 설정 |
|---|---|
| mutating·validating webhook | 두 WebhookConfiguration, VAP·VAPBinding, MAP·MAPBinding의 여섯 Kind |
| VAP·MAP | VAP·VAPBinding, MAP·MAPBinding의 네 GroupResource |

webhook 쪽은 `admissionregistration.k8s.io`의 Kind를, CEL 정책 쪽은 group과 resource의 쌍을 검사합니다
이 판정에서는 API version을 비교하지 않습니다
VAP는 WebhookConfiguration 변경을 검사할 수 있으므로 한쪽의 면제가 모든 admission의 면제는 아닙니다

**파일 기반 정적 정책·webhook을 설정했다면 위 설정도 정적 검사 대상이 될 수 있습니다**
v1.37의 `ManifestBasedAdmissionControlConfig`는 beta·기본 활성이고, `staticSource`가 있으면 위 설정에 정적 hooks를 적용하는 경로가 있습니다
feature gate의 기본값만으로 정적 정책이 배치돼 있다고 가정하지는 않습니다
v1.35의 제외 목록을 v1.37의 모든 정책에 대한 면제로 읽으면 이 차이를 놓칩니다

이와 별도로 TokenReview·SelfSubjectReview와 네 종류의 authorization review는 VAP·MAP 전체 검사에서 제외합니다
webhook도 v1.37에서 기본 활성인 `ExcludeAdmissionWebhookVirtualResources`에 따라 정적·API 기반 검사 모두에서 이 리소스들을 제외합니다
해당 gate를 끈 webhook 경로와는 구분해야 합니다

설정 변경 요청은 여전히 인증·인가·APF·다른 검증과 저장소에 의존합니다
외부 정책 엔진의 정책 CRD도 위 설정 목록에 자동으로 포함되지 않습니다
설정을 지워 복구할 수 있다고 무조건 보장할 수 없는 이유입니다

근거는 [webhook의 제외와 정적 호출 분기](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/webhook/generic/webhook.go), [CEL 정책의 제외 분기](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/policy/generic/plugin.go), [인증·인가 review 제외 목록](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubeapiserver/admission/exclusion/resources.go)입니다

## 거부·판단 실패·적용 제외를 나눠 확인합니다

| 현상 | 구분에 도움이 되는 응답·흔적 |
|---|---|
| 정상 webhook의 거부 | `admission webhook "x" denied the request: ...`. Ignore로 무시하지 않음 |
| webhook 호출 실패와 Fail | `failed calling webhook ...`. 일반적으로 500 |
| VAP 위반과 Deny | `ValidatingAdmissionPolicy 'p' with binding 'b' denied request: ...`. 기본 Invalid는 422 |
| webhook matchConditions 오류와 Fail | 원격 호출 전 거부. 확인한 구현은 403 |
| 호출 실패와 Ignore | 성공할 수도 있으나 fail-open 기록 확인 필요 |
| VAP 위반과 Warn·Audit | 위반은 확인했지만 경고·감사로 처리 |
| rules·selector 불일치 또는 Binding 부재 | 해당 정책을 적용하지 않음 |

webhook endpoint의 HTTP 500은 호출 실패로 처리합니다
HTTP 200 응답 안에 `allowed: false`, `status.code: 500`을 넣은 것은 정상적인 정책 거부입니다
최종 코드가 같아도 Ignore의 적용 여부가 다릅니다
webhook 거부 코드는 응답의 status를 사용하되 400 미만은 400으로 보정합니다
VAP는 기본 422 외에 reason으로 403·401·413도 지정할 수 있습니다

인증 webhook은 TokenReview, 인가 webhook은 SubjectAccessReview로 다른 질문을 합니다
앞선 체인의 판단과 유효한 캐시에 따라 원격 호출을 건너뛸 수도 있고, 새 판단이 필요하면 읽기·쓰기가 함께 영향을 받을 수 있습니다
Admission webhook에는 이들과 같은 일반적인 판단 결과 TTL 캐시 필드가 없습니다
설정·연결 클라이언트의 캐시와 정책 판단의 재사용을 구분해야 합니다

[인증](/essays/k8s-theory-authentication)·[인가](/essays/k8s-theory-authorization) 단계까지 함께 살펴야 어떤 요청이 외부 서비스의 새 판단을 기다리는지 구분할 수 있습니다
호출 실패를 무시한 경우와 처음부터 검사 대상에서 빠진 경우를 나누는 것이 그 출발점입니다

## 공식 문서와 오류 코드 근거

- [Dynamic Admission Control](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/access-authn-authz/extensible-admission-controllers.md)
- [ValidatingAdmissionPolicy](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/access-authn-authz/validating-admission-policy.md)
- [MutatingAdmissionPolicy](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/access-authn-authz/mutating-admission-policy.md)
- [Admission Webhook Good Practices](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/cluster-administration/admission-webhooks-good-practices.md)
- [webhook 거부 응답 변환](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/webhook/errors/statuserror.go) · [VAP reason별 HTTP 코드](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/policy/validating/policy_decision.go)
