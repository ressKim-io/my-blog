---
title: "Kubernetes 인가: 그 신원으로 무엇을 판정할 수 있나"
excerpt: "RBAC이 비교하는 요청 속성과 authorizer 체인의 판단 순서를 설명합니다. RoleBinding의 범위, selector의 한계, bind·escalate와 system:masters, can-i의 진단 범위를 구분합니다"
category: "kubernetes"
tags: ["kubernetes", "authorization", "rbac", "concept"]
series:
  name: "k8s-theory-api"
  order: 3
date: "2026-10-21"
---

[인증](/essays/k8s-theory-authentication)이 자격증명을 `user.Info`로 바꿨다면, 인가는 그 신원으로 어떤 요청을 허용할지 판단합니다
`user.Info`는 인증된 이름·UID·그룹·extra를 담는 사용자 정보입니다
여기에 동작·대상·범위를 붙여 인가를 맡는 구성요소인 authorizer에 전달합니다

이 판단이 오브젝트 본문의 값이나 반환될 목록의 각 항목까지 검사하는 것은 아닙니다
먼저 한 요청이 허용되는 과정을 보고, 어디에서 판단 범위가 달라지는지 살펴보겠습니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `8aaeb4e53d1a489570afe94ef5258554de68897a`
> 공식 문서 저장본: `kubernetes/website@1ad9080d7d3ddd79e955b7dd653711c8f2caedb8`
> 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## Pod 목록 요청은 어떻게 허용되나

`prod` namespace의 ServiceAccount `web`이 Pod 목록을 요청한다고 가정하겠습니다
인증은 `system:serviceaccount:prod:web`이라는 신원을 붙입니다
API 서버는 HTTP 요청에서 다음 속성을 얻습니다

| 요청 속성 | 값 |
|---|---|
| verb | `list` |
| API group | `""`, core API group |
| resource | `pods` |
| namespace | `prod` |
| name | 빈 값. 특정 이름이 없는 목록 요청 |

설정된 authorizer 체인이 이 신원과 속성을 받습니다
이 ServiceAccount에 Binding으로 `prod`의 `list pods` 권한이 주어졌다면 RBAC이 `Allow`를 낼 수 있습니다
앞선 authorizer가 결론을 내리지 않았다면 이 허용으로 인가를 통과합니다

RBAC이 비교한 것은 요청의 속성입니다
어떤 Pod가 결과에 포함될지는 뒤의 목록 처리 경로가 정합니다
그 결과 Pod의 내용을 하나씩 RBAC으로 검사한 것은 아닙니다

## RBAC 규칙은 무엇을 비교하나

RBAC(Role-Based Access Control)은 역할의 허용 규칙과 신원·요청 속성을 비교합니다
한 규칙의 API group·resource·verb·이름 조건은 함께 만족해야 합니다
여러 규칙이나 여러 Binding에서 얻은 허용은 누적됩니다
좁은 RoleBinding을 추가해도 다른 ClusterRoleBinding이 이미 준 넓은 허용을 빼앗지는 못합니다

다음은 완전한 매니페스트가 아니라 ClusterRole 규칙의 구조를 보여 주는 조각입니다

```yaml
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get"]
    resourceNames: ["web-0"]
  - nonResourceURLs: ["/healthz"]
    verbs: ["get"]
```

`apiGroups: [""]`는 모든 group이 아니라 core API group입니다
`nonResourceURLs`는 `/healthz`·`/metrics` 같은 resource가 아닌 경로를 뜻하며, ClusterRole 규칙에만 적을 수 있습니다
요청 속성에는 API version도 있지만 RBAC 규칙에는 version 선택 필드가 없습니다
동일 API group·resource의 특정 version만 제한하는 정책은 RBAC으로 표현되지 않습니다

### HTTP 메서드와 verb는 같지 않다

이름을 지정한 GET은 `get`, collection에 대한 GET은 `list`, watch 요청은 `watch`입니다
PATCH는 `patch`로 인가되므로 `update` 권한만으로 자동 통과하지 않습니다
반면 admission은 PATCH를 적용한 결과를 UPDATE 또는 CREATE operation으로 심사할 수 있습니다
인가 verb와 admission operation은 목적이 다른 분류입니다

하위 resource도 구분합니다
`GET /api/v1/namespaces/prod/pods/web-0`는 `resource=pods`, `name=web-0`입니다
뒤에 `/log`가 붙으면 `subresource=log`가 추가됩니다
그래서 `get pods` 권한만으로 `get pods/log`를 허용하지 않습니다
`deployments/scale`도 별도 하위 resource 권한입니다

## Role과 Binding이 권한 범위를 나누는 방식

Role과 ClusterRole은 허용할 동작을 적습니다
Binding은 그 규칙을 누구에게 어느 범위에서 줄지 연결합니다
ClusterRole을 정의하기만 해서는 아무 신원에도 권한을 주지 않습니다

| 규칙 객체 | namespace X의 RoleBinding으로 연결 | ClusterRoleBinding으로 연결 |
|---|---|---|
| namespace X의 Role | X에서 유효 | 연결 불가 |
| ClusterRole | X 안의 namespaced resource에 적용 | 규칙에 따라 모든 namespace·cluster-scoped resource·non-resource URL에 적용 |

공통 ClusterRole을 `team-a`와 `team-b`의 RoleBinding에서 각각 참조하면 규칙을 복제하지 않고 대상 범위를 나눌 수 있습니다
같은 규칙을 ClusterRoleBinding으로 부여하면 namespace 하나에 묶이지 않는 권한이 됩니다

RoleBinding의 namespace는 **권한을 행사할 대상의 범위**입니다
subject인 ServiceAccount의 namespace와 같아야 하는 것은 아닙니다
`team-a`의 ServiceAccount를 `prod`의 RoleBinding에 적으면 그 신원에 `prod` 안의 권한을 줄 수 있습니다

여러 namespace의 RoleBinding을 받았다고 `/api/v1/pods` 같은 전체 namespace 목록 요청까지 자동 허용되지는 않습니다
이 요청의 namespace 속성은 비어 있습니다
RBAC은 namespace별로 읽을 수 있는 Pod를 합쳐 부분 목록을 만들어 주지 않습니다
cluster-scoped resource와 전체 namespace 목록은 서로 다른 대상이지만, namespace RoleBinding만으로 요청 범위를 허용할 수 없다는 점은 같습니다

## RBAC의 허용 누적과 체인의 첫 결론은 다르다

일반 인가 필터가 호출하는 `Authorize` 경로에서 authorizer 체인은 첫 `Allow` 또는 `Deny`에서 멈춥니다
`NoOpinion`일 때만 다음 authorizer로 넘어갑니다
`NoOpinion`은 이 authorizer가 결론을 내리지 않았다는 뜻입니다

![인가 체인에서 Allow와 Deny는 종료하고 NoOpinion만 다음 authorizer로 넘어가는 흐름](/diagrams/k8s-theory-authorization-1.svg)

RBAC은 맞는 허용 규칙이 있으면 `Allow`, 없으면 `NoOpinion`을 냅니다
확인한 버전의 ABAC도 정책 불일치에서 `NoOpinion`을 반환합니다
ABAC은 속성 기반 정책을 사용하는 별도 authorizer입니다
RBAC에 deny 규칙이 없다는 설명과 체인에 `Deny`라는 결과가 존재한다는 설명은 서로 모순되지 않습니다

예를 들어 `--authorization-mode=Node,RBAC,Webhook`에서 RBAC이 허용하면 뒤의 Webhook은 호출되지 않습니다
Webhook을 앞에 두면 앞선 특권 그룹 검사를 제외한 대상 요청이 Webhook 판단을 먼저 받을 수 있습니다
`matchConditions`로 호출 범위를 좁히거나 캐시에서 결과를 재사용할 수도 있으므로, 순서·매칭·캐시를 함께 봐야 합니다

### Decision과 호출 오류는 별도로 반환된다

`Deny`가 언제나 403이라는 설명은 충분하지 않습니다
authorizer는 Decision과 별도로 오류도 반환하며, 인가 필터는 `Allow`를 먼저 확인한 뒤 오류를 처리합니다

| 일어난 일 | 뒤 authorizer 평가 | 인가 필터 결과 |
|---|---|---|
| RBAC `Allow` | 안 함 | 통과. 뒤 Webhook의 거부는 평가되지 않음 |
| Webhook의 정상 거부 `Deny` | 안 함 | 오류가 없으면 403 |
| Webhook 호출 실패, `failurePolicy: Deny` | 안 함 | `Deny`와 호출 오류가 함께 반환돼 500 |
| 호출 실패, `failurePolicy: NoOpinion`, 뒤 RBAC `Allow` | 함 | 뒤의 허용으로 통과 가능 |
| 호출 오류 뒤 끝까지 `NoOpinion` | 체인 끝까지 | 누적 오류로 500 |
| 오류 없이 모두 `NoOpinion` | 체인 끝까지 | 최종 403 |

호출 실패에서 `NoOpinion`을 선택하는 것은 다음 authorizer에게 판단 기회를 주는 것이며, 그 요청을 허용한다는 뜻은 아닙니다
뒤 authorizer가 결론을 내면 그 결과가 반환되고, 끝까지 결론이 없으면 누적한 오류가 남습니다
캐시된 판단을 재사용하는 동안에는 원격 정책 변경이나 권한 회수가 곧바로 반영되지 않을 수도 있습니다

이 관계는 [`unionAuthzHandler.Authorize`](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/staging/src/k8s.io/apiserver/pkg/authorization/union/union.go), [`WebhookAuthorizer.Authorize`](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/staging/src/k8s.io/apiserver/plugin/pkg/authorizer/webhook/webhook.go), [`withAuthorization`](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/staging/src/k8s.io/apiserver/pkg/endpoints/filters/authorization.go)에 나뉘어 있습니다

`AuthorizationConfiguration`은 v1.32 stable이며 `--authorization-config`로 지정합니다
이 파일에는 여러 Webhook과 각각의 `matchConditions`·`failurePolicy`를 둘 수 있습니다
`--authorization-mode`나 `--authorization-webhook-*`와 함께 사용하는 방식은 지원하지 않습니다

## 이름과 selector를 붙이면 목록 권한은 어떻게 달라지나

### resourceNames가 제한하는 것은 요청의 이름이다

`resourceNames: ["web-0"]`은 이름이 `web-0`인 요청을 제한합니다
`/pods/web-0`에는 이름이 있지만 보통의 `/pods` 목록 요청에는 이름이 없어 이 규칙과 맞지 않습니다

다만 list·watch에 정확한 `metadata.name=web-0` field selector를 붙이면 API 서버가 이름을 추출하므로 해당 이름의 규칙으로 허용할 수 있습니다
field selector는 객체 필드 값으로 검색 대상을 좁히는 조건입니다
실제로 그 이름을 대상으로 하는 list·watch verb 권한도 있어야 합니다

`deletecollection`과 최상위 resource의 `create`는 이름으로 제한할 수 없습니다
`create`라도 `pods/exec`처럼 URL에 대상 이름이 있는 하위 resource는 이 제한을 그대로 적용하지 않습니다
요청 시점에 어떤 이름을 알 수 있는지가 차이를 만듭니다

### selector는 결과 객체별 접근 제어가 아니다

selector를 authorizer 입력으로 전달할 수 있어도 RBAC에 임의 label 조건이 생기는 것은 아닙니다
selector 전달 기능은 v1.34에 GA가 됐습니다
v1.37.1 소스에서는 예전 `AuthorizeWithSelectors` gate 정의가 제거돼 있습니다
현재 `SubjectAccessReview.resourceAttributes`와 인가 속성에는 selector를 전달하는 경로가 있습니다
SubjectAccessReview는 지정한 신원·동작의 인가 판단을 묻는 API입니다

이를 지원하는 Webhook은 **요청한 검색 범위**를 허용할지 판단할 수 있습니다
허용 뒤에는 목록 처리 경로가 selector에 맞는 객체를 고릅니다
authorizer가 반환 객체를 하나씩 숨기는 구조가 아닙니다

예를 들어 정책이 `team=a` 검색 범위만 허용한다면 selector가 없거나 더 넓은 요청을 거부해야 경계가 됩니다
사용자가 selector 자체를 바꿀 수 있다는 점도 고려해야 합니다
`team=a` label을 소유권의 근거로 사용한다면 누가 그 label을 쓸 수 있는지 별도 쓰기 정책도 필요합니다
정해진 이름 하나의 허용과 “내가 소유한 Pod 전체”의 동적 허용은 같은 기능이 아닙니다

## 규칙을 만들고 위임하는 일도 검사한다

`aggregationRule`이 있는 ClusterRole의 `rules`는 aggregation controller가 계산합니다
selector에 맞는 다른 ClusterRole의 규칙을 모으므로 집계 대상의 `rules`를 직접 수정해도 덮어쓸 수 있습니다
예를 들어 CRD operator가 자기 resource의 읽기 규칙에 집계 label을 붙이면 기본 `view` 역할에 포함되도록 구성할 수 있습니다

Role을 생성할 수 있다는 이유로 임의의 권한을 그 Role에 쓸 수 있다면 스스로 권한을 키울 수 있습니다
이를 막기 위해 Role·ClusterRole을 쓸 때는 그 안의 권한을 이미 갖고 있거나 해당 범위의 `escalate` 권한이 필요합니다
Binding을 쓸 때도 연결할 역할의 권한을 갖고 있거나 해당 역할에 대한 `bind` 권한이 필요합니다

이 승격 검사는 일반 authz 필터가 디코딩 전 본문을 읽는 예외가 아닙니다
Role·Binding API의 저장 구현이 디코딩된 규칙을 검사하는 추가 방어선이며, RBAC authorizer를 사용하지 않는 구성에도 적용됩니다
`bind`·`escalate`가 원래 객체의 create·update 권한을 대신하지도 않습니다

위험 범위는 어떤 역할·이름·범위에 이를 허용했는지에 달려 있습니다
어떤 `bind`나 `escalate` 권한이든 전체 클러스터 관리자와 같다고 단정할 수는 없습니다
앱 팀에 Role과 Binding 관리를 위임할 때도 객체를 쓸 권한과 어떤 권한까지 위임할 수 있는지를 따로 정해야 합니다

## Node authorizer와 system:masters가 다른 이유

### kubelet이 읽을 객체는 배치 관계에 따라 바뀐다

kubelet은 자기 Node에 배치된 Pod가 참조하는 Secret·ConfigMap·PVC 등을 읽어야 합니다
PVC는 스토리지 사용을 요청하는 객체이고 PV는 그 요청에 연결되는 볼륨 객체입니다
Node authorizer는 informer의 객체 변경 통지로 이 관계 그래프를 유지합니다
informer는 API의 변경을 따라가며 객체의 로컬 사본을 관리하는 구성요소입니다

![Node authorizer가 Pod 배치와 참조에서 Node가 접근할 객체의 관계를 얻는 구조](/diagrams/k8s-theory-authorization-2.svg)

이 그래프는 관측한 사본이므로 변화 전파에 지연이 있을 수 있습니다
Node authorizer는 관계에 따른 읽기 외에도 kubelet에 필요한 여러 API 동작을 허용합니다

`NodeRestriction` admission은 `system:node:<nodeName>` kubelet이 수정할 Node·Pod의 **내용**을 제한합니다
쓰기 API 요청의 허용과 그 본문의 검사는 서로 다른 단계입니다
Node authorizer가 일반 사용자 요청에 `NoOpinion`을 내면 뒤의 RBAC 등이 판단할 수 있습니다

### system:masters는 Binding만으로 회수되지 않는다

`system:masters`는 일반 RBAC Binding만으로 설명할 수 없는 특권 그룹입니다
기본 `cluster-admin` ClusterRoleBinding에도 들어 있지만, 확인한 API 서버 소스는 설정된 인가 체인 앞에서 privileged group authorizer로 이 그룹을 허용합니다
RBAC 승격 검사에서도 별도로 통과시킵니다

기본 RBAC 객체의 누락된 규칙·subject는 재시작 때 복구될 수 있습니다
`rbac.authorization.kubernetes.io/autoupdate: "false"`는 그 자동 갱신을 끄는 annotation이지만, 앞의 특권 그룹 허용까지 끄지는 않습니다
기본 Binding만 수정해 이 그룹의 API 접근을 회수할 수 없는 이유입니다

`O=system:masters`인 클라이언트 인증서가 유출되면 개별 인증서 폐기 미지원과 이 특권이 겹칩니다
인증서 만료와 신뢰 CA, API 서버 인증 설정까지 함께 확인해야 합니다
여기서의 특권은 인가에 대한 것이며, 타입 검증을 건너뛰거나 모든 admission 정책을 일괄 면제하는 기능은 아닙니다

## can-i가 yes인데 실제 요청은 왜 막힐까

`kubectl auth can-i` 단건은 `SelfSubjectAccessReview`로 대상 동작의 authorizer 결과를 확인합니다
`--list`는 `SelfSubjectRulesReview`로 규칙을 열거하므로, Webhook처럼 규칙을 열거할 수 없는 authorizer가 있으면 불완전할 수 있습니다
`--as`는 다른 신원으로 요청하는 impersonation이며 별도 권한이 필요합니다

이 결과는 대상 동작의 admission 판단을 대신하지 않습니다
그렇다고 `yes` 뒤의 403을 곧바로 admission 탓으로 돌릴 수도 없습니다
확인한 요청과 실제 요청의 사용자·namespace·verb·resource·subresource·selector가 같은지부터 비교해야 합니다

| 메시지의 단서 | 해석할 경계 |
|---|---|
| `User "system:anonymous"` | 익명 신원에 대한 인가. 토큰 부재·전달 문제와 권한을 구분 |
| `in the namespace "prod"` | prod 범위. RoleBinding과 ClusterRoleBinding 모두 허용 근거가 될 수 있음 |
| `at the cluster scope` | namespace RoleBinding만으로 허용할 수 없는 범위 |
| `cannot get resource "pods/log"` | 하위 resource 권한 |
| `is attempting to grant RBAC permissions not currently held` | Role·ClusterRole의 승격 검사 |
| Webhook 호출 실패 뒤 500·지연 | 도달한 Webhook, 실패 정책, 뒤 authorizer를 함께 확인 |

같은 인가 속성으로 허용된 create·update가 뒤에서 막혔다면 admission이 후보가 됩니다
본문의 `spec.replicas <= 5` 같은 조건은 그 단계나 타입 검증에서 다루기 때문입니다
반대로 admission도 일반 GET·LIST 응답의 객체별 필터가 아닙니다
요청의 허용, 검색 범위, 쓰기 본문의 정책을 나눠야 필요한 접근 제어를 어디에 둘지 판단할 수 있습니다

## 더 확인할 소스와 문서

- [RBAC의 Allow·NoOpinion: `RBACAuthorizer.Authorize`](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/plugin/pkg/auth/authorizer/rbac/rbac.go), [ABAC의 불일치](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/pkg/auth/authorizer/abac/abac.go)
- [목록의 이름 추출: `RequestInfoFactory.NewRequestInfo`](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/staging/src/k8s.io/apiserver/pkg/endpoints/request/requestinfo.go)
- [namespace·subject 매칭: `DefaultRuleResolver.VisitRulesFor`·`appliesToUser`](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/pkg/registry/rbac/validation/rule.go)
- [Role 저장 시 권한 검사](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/pkg/registry/rbac/role/policybased/storage.go), [RoleBinding 저장 시 bind 검사](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/pkg/registry/rbac/rolebinding/policybased/storage.go), [`EscalationAllowed`·`BindingAuthorized`](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/pkg/registry/rbac/escalation_check.go)
- [ClusterRole 집계 controller](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/pkg/controller/clusterroleaggregation/clusterroleaggregation_controller.go)
- [Node 인가](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/plugin/pkg/auth/authorizer/node/node_authorizer.go), [그래프 이벤트 갱신](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/plugin/pkg/auth/authorizer/node/graph_populator.go), [NodeRestriction](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/plugin/pkg/admission/noderestriction/admission.go)
- [특권 그룹을 앞에 두는 `newForConfig`](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/pkg/kubeapiserver/authorizer/reload.go)
- [can-i 구현](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/staging/src/k8s.io/kubectl/pkg/cmd/auth/cani.go), [SelfSubjectAccessReview의 인가 호출](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/pkg/registry/authorization/selfsubjectaccessreview/rest.go)
- [인가 플래그 검증](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/pkg/kubeapiserver/options/authorization.go), [현재 API 서버 gate 정의](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/staging/src/k8s.io/apiserver/pkg/features/kube_features.go)
- [selector 전달 기능의 GA 이력: v1.35 당시 gate 정의](https://github.com/kubernetes/kubernetes/blob/5671697925fe8d7222c4ab09cb15f28f5f9d0383/staging/src/k8s.io/apiserver/pkg/features/kube_features.go)
- [RBAC 공식 문서 저장본](https://github.com/kubernetes/website/blob/1ad9080d7d3ddd79e955b7dd653711c8f2caedb8/content/en/docs/reference/access-authn-authz/rbac.md), [Authorization](https://github.com/kubernetes/website/blob/1ad9080d7d3ddd79e955b7dd653711c8f2caedb8/content/en/docs/reference/access-authn-authz/authorization.md), [Node Authorization](https://github.com/kubernetes/website/blob/1ad9080d7d3ddd79e955b7dd653711c8f2caedb8/content/en/docs/reference/access-authn-authz/node.md)
