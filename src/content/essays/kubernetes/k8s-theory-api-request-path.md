---
title: "Kubernetes API 서버 요청 경로 전체"
excerpt: "Deployment 생성 요청을 따라 인증·인가, 디코딩, admission, 검증과 저장의 경계를 살펴봅니다. 오류 메시지와 audit 로그, dry-run이 알려주는 범위도 구분합니다"
category: "kubernetes"
tags: ["kubernetes", "kube-apiserver", "admission", "concept"]
series:
  name: "k8s-theory-api"
  order: 1
date: "2026-07-24"
---

Deployment 하나를 만들면 API 서버는 무엇부터 판단할까요?
요청자의 권한을 확인하는 일과 `spec.replicas` 값을 검사하는 일은 같은 단계에서 일어나지 않습니다

`dev`가 `prod` namespace에 Deployment `web`을 생성하는 요청을 보낸다고 가정하겠습니다
`Deployment`는 만들 오브젝트의 종류이고, `deployments`는 URL에서 그 종류를 가리키는 resource 이름입니다
요청 본문에는 `spec.replicas` 같은 필드 값이 담깁니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `8aaeb4e53d1a489570afe94ef5258554de68897a`
> 공식 문서 저장본: `kubernetes/website@1ad9080d7d3ddd79e955b7dd653711c8f2caedb8`
> 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## 생성 요청 하나를 저장까지 따라가기

![Deployment 생성 요청에서 각 처리 주체가 받는 정보와 저장까지의 순서|tall](/diagrams/k8s-theory-api-request-path-1.svg)

그림은 **내장 resource의 일반적인 CREATE 요청 한 건**을 나타냅니다
HTTP 필터 전체를 펼친 그림은 아니며, impersonation 같은 별도 처리는 생략했습니다

먼저 인증이 요청자의 신원을 만들고, 설정된 APF가 처리 자리를 배정합니다
인가는 신원과 요청 동작·대상을 비교합니다
이 구간에서는 요청 본문을 아직 타입 있는 오브젝트로 디코딩하지 않았으므로 `spec.replicas`는 판단에 쓰이지 않습니다

인가를 통과한 뒤 본문을 디코딩하고 기본값을 채웁니다
오브젝트를 바꿀 수 있는 mutating admission, 타입별 검증, 내용을 바꾸지 않는 validating admission을 거쳐 저장을 시도합니다
admission은 이렇게 디코딩된 오브젝트에 서버 정책을 적용하는 단계입니다

### 인증과 인가는 무엇을 볼 수 있나

인증(authentication, authn)은 인증서나 토큰 같은 자격증명을 확인해 사용자 이름·UID·그룹·extra를 만듭니다
UID는 대상을 구별하는 식별자이며, extra는 인증기가 추가로 전달하는 사용자 정보입니다
인증 성공 자체가 Deployment 생성 권한을 주지는 않습니다

인가(authorization, authz)는 그 신원에 요청의 속성을 붙여 허용 여부를 판단합니다
RBAC(Role-Based Access Control)은 역할에 적힌 허용 규칙과 이 속성을 비교하는 인가 방식입니다

| 속성 | 가정한 생성 요청 |
|---|---|
| 요청자·그룹 | `dev`, `team-a` |
| verb | `create` |
| API group·resource | `apps`, `deployments` |
| namespace | `prod` |

여기에는 본문의 `spec.replicas` 값이 없습니다
그래서 RBAC으로 `prod`의 Deployment 생성은 허용할 수 있어도 replicas를 5 이하로 제한할 수는 없습니다
필드 값에 따른 정책은 뒤의 admission에서 판단합니다

### APF는 왜 인증과 인가 사이에 있나

APF(API Priority and Fairness)는 요청을 분류해 우선순위별 처리 자리를 관리하고, 과부하 시 대기시키거나 거부합니다
분류 규칙인 FlowSchema가 요청자의 신원과 요청 속성을 사용하므로 인증 뒤에 실행됩니다
인증된 요청이라도 지금 처리할 여유가 없으면 기다리거나 거부될 수 있습니다

인가는 외부 webhook에 판단을 물을 수도 있습니다
APF가 인가 앞에 있으면 그 외부 호출 비용을 치르기 전에 과부하를 제어할 수 있습니다
여기서의 webhook은 API 서버가 외부 HTTP 서비스에 판단을 요청하는 방식입니다

APF 거부에서는 429와 `Retry-After` 헤더가 단서가 됩니다
처리 자리는 사용자마다 고정된 quota가 아니며, APF를 구성하지 않은 경로에서는 동시 요청 수 제한 필터가 사용됩니다
실제 위치는 [`DefaultBuildHandlerChain`](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/staging/src/k8s.io/apiserver/pkg/server/config.go)에서 확인할 수 있습니다
필터를 안쪽부터 감싸므로 소스의 대입 순서와 요청의 실행 순서는 반대입니다

## 본문이 오브젝트가 된 뒤에는 무엇이 달라지나

### 디코딩과 defaulting

API 서버는 요청 본문을 타입 있는 Go 오브젝트로 만들고 스킴에 등록된 기본값을 적용합니다
Deployment의 `strategy`, Pod spec의 `terminationGracePeriodSeconds`, 컨테이너의 `imagePullPolicy` 등이 기본값을 가질 수 있습니다
뒤의 mutating webhook이 받는 것은 사용자가 작성한 YAML 원문이 아니라 AdmissionReview에 담긴 오브젝트입니다
AdmissionReview는 admission 요청·응답을 주고받는 API 형식입니다

모든 기본값을 디코더가 채우는 것은 아닙니다
스킴의 defaulter가 넣는 값과 `ServiceAccount`·`LimitRanger` 같은 mutating admission 플러그인이 넣는 값은 생기는 단계가 다릅니다

### mutating admission과 타입별 검증

mutating admission은 라벨을 추가하거나 사이드카 컨테이너를 넣는 식으로 오브젝트를 바꿀 수 있습니다
뒤의 검증 대상은 이 변경을 거친 오브젝트입니다

그렇다고 오브젝트 변경이 여기서만 일어나는 것은 아닙니다
앞에서는 defaulting이 값을 채웠고, 저장 전략의 `PrepareForCreate`도 필드를 정리할 수 있습니다
저장 전략은 resource별로 생성 준비와 유효성 검사를 맡는 구현입니다

이후 타입별 검증은 만들어진 오브젝트가 값과 메타데이터 규칙을 지키는지 확인합니다
`spec.replicas: -1`은 정수로 디코딩할 수 있지만 Deployment의 허용 범위를 위반하므로 422가 될 수 있습니다
이 검증에서 실패하면 뒤의 validating admission까지 가지 않습니다

### validating admission은 변경이 끝난 결과를 본다

validating admission은 앞의 변경과 검증을 거친 오브젝트에 정책을 적용하며, 요청 오브젝트를 수정하지 않습니다
`ValidatingAdmissionPolicy`는 API 서버 안에서 CEL(Common Expression Language) 표현식으로 정책을 평가합니다
validating webhook은 외부 서버에 판단을 맡깁니다
기본 플러그인 순서에서는 policy가 webhook보다 앞에 있습니다

왜 mutating 뒤에 validating이 있어야 할까요?
모든 컨테이너에 limits가 있어야 한다는 정책을 먼저 통과한 뒤, limits가 없는 사이드카를 추가한다고 가정하면 저장할 모양이 검사한 모양과 달라집니다

mutator도 요청을 거부할 수 있지만, 자기 뒤의 mutator가 만든 결과까지 검사할 수는 없습니다
변경을 마친 결과에 대한 validating 검사가 필요한 이유입니다
타입별 검증도 그 사이에 있으므로 mutator가 유효하지 않은 값을 만들면 외부 validating webhook 호출 전에 멈출 수 있습니다

이 순서는 [`createHandler`](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/staging/src/k8s.io/apiserver/pkg/endpoints/handlers/create.go), [`Store.Create`와 내부 `create`](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/staging/src/k8s.io/apiserver/pkg/registry/generic/registry/store.go), [`BeforeCreate`](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/staging/src/k8s.io/apiserver/pkg/registry/rest/create.go)로 이어집니다
`BeforeCreate`는 `store.go`에 정의된 함수가 아니라 `registry/rest/create.go`의 함수입니다
저장소 계층이 이를 호출한 뒤 validating admission callback을 실행합니다

## 저장 성공이 Pod 실행 성공은 아니다

admission 허용은 저장을 진행해도 된다는 판단입니다
같은 이름의 오브젝트가 이미 있으면 일반 CREATE는 409 `AlreadyExists`로 실패할 수 있고, 저장소 오류도 가능합니다

Deployment 저장까지 성공해도 그 요청에서 Pod를 함께 저장한 것은 아닙니다
컨트롤러는 저장된 원하는 상태를 보고 후속 작업을 수행하는 별도 주체입니다

![Deployment 저장 뒤 컨트롤러들이 ReplicaSet과 Pod 생성을 별도 요청으로 수행하는 흐름](/diagrams/k8s-theory-api-request-path-2.svg)

Deployment controller가 ReplicaSet 생성 요청을 보내고, ReplicaSet controller가 Pod 생성 요청을 보냅니다
각 요청은 해당 컨트롤러의 신원과 당시 정책으로 다시 심사받습니다
Deployment·ReplicaSet·Pod 생성은 하나의 트랜잭션이 아닙니다

따라서 Deployment 생성이 성공해도 Pod 생성은 ResourceQuota나 PodSecurity에서 거부될 수 있습니다
처음 받은 성공 응답과 원하는 수의 Pod가 실행된 상태는 구분해야 합니다

## 오류 응답은 어느 경계를 가리키나

상태코드는 후보를 좁히지만 거부 주체를 하나로 정하지는 못합니다
다음 문구는 실행 결과를 옮긴 로그가 아니라 응답을 읽기 위한 대표 형태입니다

| 코드 | 가능한 주체·조건 | 메시지나 응답의 단서 |
|---|---|---|
| 401 | 인증 실패 | `Unauthorized` |
| 429 | APF 과부하 거부 | `Retry-After` |
| 403 | 인가 거부 | `User "dev" cannot create resource "deployments" in API group "apps" in the namespace "prod"` |
| 400 | 디코딩 실패·엄격한 필드 검사 | `strict decoding error: unknown field "spec.replica"` |
| 422 | 타입별 값·메타데이터 검증 | `spec.replicas: Invalid value: -1` |
| 403 등 | admission webhook의 정책 거부 | `admission webhook "vpod.example.svc" denied the request: ...` |
| 422 또는 403 등 | ValidatingAdmissionPolicy 거부 | `ValidatingAdmissionPolicy 'require-labels' with binding 'b1' denied request: ...` |
| 409 | 일반 CREATE의 이름 충돌 등 | `AlreadyExists`. 갱신 충돌·필드 소유권 충돌은 별도 경로 |
| 500 등 | webhook 호출 실패, `failurePolicy: Fail` | `failed calling webhook "...": dial tcp ... connection refused` |
| 404 | 오브젝트 또는 resource 경로 부재 | 요청 URL과 discovery 결과를 함께 확인 |

### 400과 422를 오타와 값 오류로만 나눌 수 없는 이유

`fieldValidation`은 알 수 없는 필드와 중복 필드를 처리하는 방식을 정합니다
`Ignore`는 이 문제를 경고 없이 처리하고, API 서버 기본값인 `Warn`은 경고를 추가한 뒤 계속 처리할 수 있습니다
`Strict`는 400으로 거부합니다

예를 들어 내장 Deployment의 `spec.replica`는 알려진 필드가 아닙니다
`Warn`으로 요청이 성공해도 이 필드가 보존됐다는 뜻은 아닙니다
CRD(CustomResourceDefinition)가 정의한 사용자 resource의 미지 필드는 해당 CRD의 스키마 설정도 확인해야 합니다
클라이언트가 다른 `fieldValidation`을 보낼 수 있으므로 서버 기본값을 모든 요청의 실제 설정으로 볼 수도 없습니다

한편 알려진 필드에 `replicas: "three"`를 넣으면 정수로 디코딩할 수 없어 400이 됩니다
이 타입 불일치는 `Ignore`로 허용할 수 없습니다
정수 `-1`은 디코딩 뒤 Deployment의 값 검증에서 422가 됩니다
오브젝트를 만들고 검증하는 어느 지점에서 멈췄는지가 차이입니다

### 403이면 RBAC 문제일까

`cannot <verb> resource`는 인가 거부의 단서이고, `admission webhook ... denied the request`는 webhook이 보낸 정책 거부의 단서입니다
webhook 거부의 상태코드는 응답의 `status`에 따라 달라질 수 있습니다

ValidatingAdmissionPolicy도 `reason`에 따라 코드가 달라집니다
`Invalid`는 422, `Forbidden`은 403에 대응합니다
정책 거부와 webhook 호출 자체의 실패도 다르므로, 코드와 메시지의 출처를 함께 읽어야 합니다

인증·인가가 외부 webhook에 의존할 수도 있습니다
장애 범위는 단계 이름만으로 정할 수 없으며 외부 의존성과 요청 매칭 범위를 함께 봐야 합니다
404 역시 오브젝트 부재와 resource 경로 부재를 구분해야 하며, 증상만으로 discovery 캐시 문제라고 확정할 수 없습니다

## audit 로그는 내부 단계의 시간표가 아니다

audit event는 요청 수신과 응답 등 HTTP 요청 수명의 구간을 기록합니다
일반 요청에서는 보통 `RequestReceived`와 `ResponseComplete`를 볼 수 있습니다
`ResponseStarted`는 일반 audit 경로에서 watch 같은 장기 요청에 생성되며, `Panic`은 별도 stage입니다

정책에서 stage를 생략할 수 있고 인증 실패용 기록 경로도 별도로 존재합니다
확인된 사용자 정보가 없더라도 정책과 backend 설정에 따라 인증 실패를 기록할 수 있습니다

인가 필터는 허용과 거부 모두에 `authorization.k8s.io/decision`을 남깁니다
인가를 통과한 뒤 admission이 거부했다면 `decision=allow`와 최종 거부 응답이 함께 있을 수 있습니다
인가 오류 경로는 `authorization.k8s.io/reason=error`를 남깁니다
이 정보를 보려면 해당 요청에 대한 audit 정책에서 `Metadata` 이상을 기록해야 합니다

audit stage는 authn·authz·admission 각각의 시작과 끝을 나타내지 않습니다
일반 audit event만으로 플러그인별 판단이나 모든 내부 단계의 소요 시간을 복원할 수는 없습니다

## 요청 종류가 달라지면 어디까지 같은가

`kubectl apply` 명령 전체를 CREATE 한 건으로 보면 안 됩니다
옵션과 기존 오브젝트 유무에 따라 다른 요청이 발생할 수 있습니다
GET·LIST·WATCH에도 인증과 인가는 적용되지만, 모두 그림의 admission과 쓰기 저장 단계를 지나는 것은 아닙니다

admission은 주로 CREATE·UPDATE·DELETE·CONNECT를 다룹니다
HTTP PATCH는 변경안을 기존 객체에 적용한 뒤, 생성 또는 수정 결과를 심사할 operation으로 admission에 전달합니다
하위 resource나 확장 API의 저장 구현도 일반 CREATE와 구분해야 합니다

### GVK와 GVR은 어디에서 쓰나

GVK(Group-Version-Kind)는 오브젝트의 타입을 식별합니다
YAML의 `apiVersion: apps/v1`, `kind: Deployment`가 그 예입니다
GVR(Group-Version-Resource)은 요청할 resource를 식별하며 `apps/v1`과 `deployments`가 대응합니다

```text
/apis/apps/v1/namespaces/prod/deployments/web
/api/v1/namespaces/prod/pods
```

첫 URL에는 group `apps`, version `v1`, namespace `prod`, resource `deployments`, 이름 `web`이 있습니다
core API group은 group 이름 없이 두 번째처럼 `/api/v1`로 시작합니다

GVK만으로 모든 하위 resource 경로를 구분할 수는 없습니다
`deployments/status`는 별도 경로이며, `deployments/scale`의 응답 Kind는 `Scale`일 수 있습니다
같은 Pod를 가리켜도 `pods`와 `pods/log`의 RBAC 권한은 별개입니다

서버의 discovery API는 제공하는 API group·version·resource를 알려줍니다
클라이언트의 RESTMapper가 discovery 정보를 이용해 GVK와 요청할 resource 경로를 연결합니다
kubectl은 이 정보를 `~/.kube/cache/discovery/`에 캐시할 수 있습니다
CRD 등록 직후 경로를 찾지 못한다면 서버가 제공하는 정보와 클라이언트가 가진 사본을 나눠 확인해야 합니다

### dry-run은 무엇을 보장하나

| 방식 | 요청과 결과 |
|---|---|
| `--dry-run=client` | 변경 요청을 서버에 보내지 않고 오브젝트를 미리 표시. 명령에 따라 discovery·OpenAPI 조회는 가능 |
| `--dry-run=server` | 실제 요청에 `dryRun=All`을 붙여 인증·인가·admission·검증을 거치고 변경은 저장하지 않음 |

server dry-run은 실제 쓰기와 같은 인가 권한을 요구합니다
defaulting과 mutating admission을 거친 결과를 볼 수 있지만, UID·시간·`resourceVersion`·일부 변경 필드의 값까지 실제 저장 결과와 같다고 보장하지는 않습니다
`resourceVersion`은 오브젝트의 버전을 추적하는 메타데이터입니다

ResourceQuota는 dry-run의 quota를 검사하되 사용량을 소비하거나 예약하지 않습니다
남은 quota 안에 드는 dry-run 두 건이 각각 통과해도 이후 실제 생성 두 건이 모두 성공한다는 보장은 없습니다

매칭된 webhook의 `sideEffects`는 `None` 또는 `NoneOnDryRun`이어야 dry-run을 처리할 수 있습니다
`NoneOnDryRun`은 webhook이 dry-run에서 외부 부작용을 억제한다는 선언입니다
API 서버가 외부 서비스의 DB 쓰기를 되돌려 주는 기능이 아니므로, 구현도 그 선언을 지켜야 합니다

## 더 확인할 소스와 문서

본문의 소스 링크 외에 다음 구현에서 오류와 적용 범위를 확인할 수 있습니다
모든 소스 링크는 위의 v1.37.1 commit에 고정했습니다

- [기본 admission 순서: `AllOrderedPlugins`](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/pkg/kubeapiserver/options/plugins.go)
- [인가 허용·거부·오류와 audit annotation: `withAuthorization`](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/staging/src/k8s.io/apiserver/pkg/endpoints/filters/authorization.go)
- [인증 실패 audit: `WithFailedAuthenticationAudit`](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/staging/src/k8s.io/apiserver/pkg/endpoints/filters/authn_audit.go)
- [webhook 거부 상태코드: `ToStatusErr`](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/staging/src/k8s.io/apiserver/pkg/admission/plugin/webhook/errors/statuserror.go)
- [policy의 reason과 코드: `reasonToCode`](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/staging/src/k8s.io/apiserver/pkg/admission/plugin/policy/validating/policy_decision.go)
- [PATCH 결과의 admission: `patcher.applyAdmission`](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/staging/src/k8s.io/apiserver/pkg/endpoints/handlers/patch.go)
- [scale의 응답 Kind: `ScaleREST.GroupVersionKind`](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/pkg/registry/apps/deployment/storage/storage.go)
- [dry-run quota 처리: `quotaEvaluator.checkQuotas`](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/staging/src/k8s.io/apiserver/pkg/admission/plugin/resourcequota/controller.go)
- [API Concepts 공식 문서 저장본](https://github.com/kubernetes/website/blob/1ad9080d7d3ddd79e955b7dd653711c8f2caedb8/content/en/docs/reference/using-api/api-concepts.md), [APF](https://github.com/kubernetes/website/blob/1ad9080d7d3ddd79e955b7dd653711c8f2caedb8/content/en/docs/concepts/cluster-administration/flow-control.md), [Auditing](https://github.com/kubernetes/website/blob/1ad9080d7d3ddd79e955b7dd653711c8f2caedb8/content/en/docs/tasks/debug/debug-cluster/audit.md)
