---
title: "정책 계층 — 요청을 막는 판정과 나중에 고치는 변경"
excerpt: "PSA·CEL 정책·webhook·정책 엔진을 실행 위치와 입력, 실패 처리로 비교합니다. VAP의 거절 경로, admission 변경의 managedFields, 기존 자원 검사와 GitOps의 생성·삭제 경계를 구분합니다"
category: "kubernetes"
tags: ["Kubernetes", "Admission", "CEL", "Policy", "Server-Side Apply", "GitOps", "concept"]
series:
  name: "k8s-theory-extension"
  order: 4
date: "2026-10-23"
---

정책이 요청을 거절하면 대상 오브젝트의 새 상태는 저장되지 않습니다
응답과 감사 로그, 요청을 보낸 controller의 Event에는 거절의 흔적이 남을 수 있습니다

정책이 오브젝트를 바꾸면 변경된 값은 저장될 수 있습니다
그렇다고 변경한 정책 이름이 필드 소유자인 **field manager**로 자동 등록되지는 않습니다
기존 필드의 소유권까지 사라진다는 뜻은 아닙니다

정책 수단을 고를 때는 이 차이부터 구분해야 합니다
요청을 막는 검증, 요청 오브젝트의 변경, 이미 저장된 자원을 나중에 검사하거나 고치는 동작은 실행 시점과 실패 영향이 다릅니다

> **근거**: Kubernetes v1.37.1 `f78e722310e50bcaca9276be22276d9e91d91308`과 공식 문서 저장본 `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`를 대조했습니다
> 외부 구현은 Gatekeeper v3.23.1, Kyverno v1.19.2, Argo CD v3.5.6 및 고정한 Kyverno 문서를 기준으로 합니다
> 설치된 정책 엔진의 버전이나 클러스터의 실제 거절 응답·지연·재조정 결과를 측정한 기록은 포함하지 않습니다

## 요청의 동기 경로와 배경 controller를 나눕니다

**Admission**은 인증·인가 이후, API 요청을 받아들일지 판단하거나 요청 오브젝트를 변경하는 처리입니다
요청을 처리하는 동안 실행되므로 외부 호출과 평가 오류가 그 요청에 영향을 줍니다

![동기 admission의 API 서버 내부 정책·외부 webhook과 저장 이후 배경 controller의 별도 쓰기를 비교한 그림|tall](/diagrams/k8s-theory-policy-layers-1.svg)

그림은 실행 위치의 비교입니다
PSA·VAP·MAP·webhook을 그려진 순서대로 모두 호출한다는 뜻은 아닙니다
실제로는 요청 매칭과 변경·검증 단계, 활성화한 admission 설정을 따라 처리합니다

[CRD의 스키마와 CEL](/essays/k8s-theory-crd-schema-pruning)은 해당 CR의 필드 구조·값·변경을 검사합니다
별도의 정책으로 여러 리소스 요청을 골라 검사하거나 변경하려면 아래 수단을 비교할 수 있습니다

| 수단 | 요청 시점의 역할 | 추가로 맡는 운영 책임 |
|---|---|---|
| Pod Security Admission(PSA) | 정해진 Pod 보안 수준을 적용 | Namespace 라벨·정책 버전·면제 범위 관리 |
| ValidatingAdmissionPolicy(VAP) | API 서버 안에서 CEL로 검증 | 정책·바인딩·파라미터와 평가 오류 관리 |
| MutatingAdmissionPolicy(MAP) | API 서버 안에서 CEL로 변경 | 변경식·바인딩·재실행과 필드 관리 경계 확인 |
| admission webhook | 외부 서버에서 검증하거나 변경 | 서버·인증서·연결·타임아웃·실패 처리 |
| 정책 엔진 | webhook에 캐시·CRD·controller 등을 결합 | 제품이 제공하는 검사·변경·생성 기능과 추가 구성요소 운영 |

VAP·MAP은 별도의 정책 서버와 네트워크 왕복을 추가하지 않습니다
그래도 표현식의 비용과 평가 한도, 잘못된 설정에 따른 거절은 남습니다
외부 구현의 캐시와 조회 방식도 다르므로 도구 이름만으로 처리 속도를 비교할 수는 없습니다

### 현재 API와 기본값을 구분합니다

VAP는 v1.30부터 GA이며 `admissionregistration.k8s.io/v1`을 사용합니다
MAP도 v1.36부터 GA·기본 활성이고, 현재 기준 API는 `v1`입니다

Kubernetes v1.37.1의 MAP 게이트 항목에는 `LockToDefault`가 없습니다
기본 admission 플러그인 목록과 API 등록 소스에서 활성 경로를 확인했지만, 실제 서버의 게이트·플러그인·API 활성화 override는 별도로 확인해야 합니다

| 설정 | 확인한 기본값 또는 필수 조건 |
|---|---|
| VAP·MAP의 `failurePolicy` | 생략하면 `Fail` |
| v1 mutating·validating webhook의 `failurePolicy` | 생략하면 `Fail` |
| 정책 `MatchResources`·webhook의 `matchPolicy` | 생략하면 `Equivalent` |
| webhook의 `timeoutSeconds` | 생략하면 10초 |
| mutating webhook의 `reinvocationPolicy` | 생략하면 `Never` |
| MAP의 `reinvocationPolicy` | 필수 선언이며 `Never` 또는 `IfNeeded` |

MAP의 필수 필드와 mutating webhook의 생략 시 기본값을 같은 규칙으로 읽으면 안 됩니다
API의 존재와 플러그인 활성화, 매칭되는 정책·바인딩의 존재도 각각 다른 조건입니다

## CEL이 볼 수 있는 정보에는 정해진 범위가 있습니다

VAP·MAP은 CEL 표현식에 제공된 입력으로 판단합니다
`object`는 요청 오브젝트이고 `oldObject`는 변경 전 오브젝트입니다
DELETE에는 `object`가, CREATE에는 `oldObject`가 없습니다

`request`는 사용자·동사·리소스 같은 요청 속성을 제공합니다
`namespaceObject`는 대상 Namespace의 관측값이며 cluster-scoped 요청에는 없습니다
`authorizer`로 요청 주체의 권한을 확인하고, `variables`에 다른 입력으로 계산한 값을 둘 수 있습니다

정책이 `paramKind`를 선언하고 바인딩의 `paramRef`가 가리키는 자원은 `params`로 전달합니다
`paramRef`의 이름과 selector는 대안입니다
VAP에서 selector로 여러 파라미터를 고르면 각 파라미터에 대한 검증 결과가 모두 허용되어야 합니다
MAP의 여러 변경을 이 AND 규칙으로 설명할 수는 없습니다

이 입력은 임의의 Kubernetes 자원을 자유롭게 GET하는 API가 아닙니다
다른 자원을 읽어야 한다면 정책 엔진의 캐시나 외부 조회 기능을 따로 살펴봐야 합니다

Gatekeeper는 예를 들어 `Config.syncOnly`로 정한 GVK의 자원을 복제하고 `data.inventory`로 제공합니다
현재 문서는 `SyncSet`으로 선언한 범위와의 합집합도 지원합니다
Kyverno는 ConfigMap·Kubernetes API·외부 서비스 등을 조회하는 입력을 제공합니다

캐시에는 관측 지연이 있고 직접 조회에는 요청 지연과 외부 실패가 붙습니다
다른 자원을 읽고 요청을 허용하는 사이에도 별도 쓰기가 진행될 수 있습니다
추가 조회만으로 그 읽기와 다른 요청의 쓰기가 하나의 원자적 트랜잭션이 되지는 않습니다

## 매칭·평가 오류·규칙 위반을 나눕니다

정책의 `matchConstraints`와 바인딩의 `matchResources`가 요청을 함께 좁힙니다
리소스 규칙, Namespace·오브젝트 selector와 `matchConditions`를 확인해야 실패 영향 범위도 알 수 있습니다
`Equivalent`는 동등한 리소스의 다른 API 버전까지 매칭할 수 있으므로 버전 이름 하나만 보고 제외되었다고 판단하면 안 됩니다

webhook·VAP·MAP의 `matchConditions`는 하나라도 false이면 그 대상을 건너뜁니다
false 없이 평가 오류가 남으면 `failurePolicy`에 따른 오류 처리로 넘어갑니다
VAP는 이때 `Fail` 오류도 바인딩의 `validationActions`를 적용하므로 항상 직접 거절하는 것은 아닙니다
조건에 맞지 않는 것과 조건 평가에 실패한 것은 다른 결과입니다

### VAP의 설정 오류는 경고 전용 바인딩도 거절할 수 있습니다

VAP의 바인딩은 `validationActions`로 `Deny`·`Warn`·`Audit`을 선택합니다
`Deny`와 `Warn`은 함께 지정할 수 없으며 `Audit`은 다른 동작과 결합할 수 있습니다

| VAP에서 발생한 일 | 처리 경로 |
|---|---|
| 검증식이 false | 바인딩의 `validationActions`를 적용 |
| 검증식 실행 중 평가 오류 | `Ignore`이면 허용으로 처리, `Fail`이면 거절 평가로 만들어 `validationActions` 적용 |
| 파라미터를 찾지 못하고 `parameterNotFoundAction: Deny` | 설정 오류가 되어 `Ignore`이면 건너뛰고 `Fail`이면 직접 거절 |

마지막 경로는 `validationActions`를 거치지 않습니다
따라서 `Warn`·`Audit`만 넣어도 파라미터 부재와 `failurePolicy: Fail`이 결합하면 요청이 거절될 수 있습니다

`failurePolicy: Ignore`는 규칙이 false인 결과까지 무시하는 설정이 아닙니다
검증식이 정상적으로 false를 반환했고 `Deny`가 적용되면 거절합니다

VAP의 검증 거절도 항상 HTTP 403인 것은 아닙니다
현재 dispatcher는 `reason`을 응답 코드로 바꿉니다
기본 `Invalid`는 422, `Forbidden`은 403입니다
`Unauthorized`는 401, `RequestEntityTooLarge`는 413으로 연결합니다
위 파라미터 수집 설정 오류의 직접 거절은 `NewForbidden` 경로이므로 이 검증 결과의 코드 선택과 구분해야 합니다

외부 webhook도 호출 오류와 서버의 명시적 거절을 구분합니다
`failurePolicy: Ignore`는 호출 실패를 건너뛸 수 있지만 `allowed: false` 응답을 허용으로 바꾸지는 않습니다
webhook의 경고·감사 정보와 거절 분기는 서버가 응답에 구현해야 하며 VAP 바인딩의 동작 목록을 그대로 쓰지 않습니다

### 거절과 기록의 위치도 다릅니다

VAP의 `Audit`은 정책·바인딩·표현식 인덱스 등의 정보를 감사 주석에 남깁니다
키는 `validation.policy.admission.k8s.io/validation_failure`입니다
실제 보관 범위와 기간은 API 서버의 감사 정책·출력 설정에 달려 있습니다
이 주석이 거절된 대상 오브젝트의 새 상태로 저장되는 것은 아닙니다

PSA는 Namespace의 `pod-security.kubernetes.io/<MODE>: <LEVEL>` 라벨로 적용합니다
모드는 `enforce`·`audit`·`warn`, 수준은 `privileged`·`baseline`·`restricted`입니다
`pod-security.kubernetes.io/<MODE>-version`으로 보안 기준 버전을 고를 수 있습니다

PSA의 `audit`·`warn`은 workload template에도 적용하지만 `enforce`는 실제 Pod 요청에 적용합니다
그래서 Deployment 생성은 성공해도 ReplicaSet controller가 보내는 Pod 생성 요청은 거절될 수 있습니다
사용자 요청과 controller의 후속 요청을 나눠 응답·Event를 확인해야 합니다

Gatekeeper의 Constraint는 `enforcementAction`으로 `deny`·`dryrun`·`warn`을 선택하며 기본은 `deny`입니다
여기의 `dryrun`은 정책을 강제하지 않는 모드입니다
Kubernetes 요청의 dry-run 옵션과 같은 설정이 아닙니다

## 정책을 지우는 요청도 적용 범위를 확인해야 합니다

API로 구성된 CEL 정책은 VAP·VAPBinding·MAP·MAPBinding 네 종류의 정책·바인딩을 자기 평가에서 제외합니다
API로 구성된 webhook은 여기에 MutatingWebhookConfiguration·ValidatingWebhookConfiguration을 더해 여섯 Kind를 제외합니다

CEL 정책이 webhook 설정까지 일괄 제외하는 것은 아닙니다
Kubernetes v1.37의 manifest 기반 정적 정책·webhook은 해당 설정 자원을 평가할 수도 있습니다
`ManifestBasedAdmissionControlConfig`는 이 버전에서 beta·기본 활성입니다
가상 auth/authz review 자원을 제외하는 보호 경로는 별도입니다

이 제외 규칙은 API 기반 admission의 순환 의존을 줄이는 장치입니다
RBAC·다른 admission·저장소 실패까지 우회해 삭제할 수 있다는 보장은 아닙니다

정책 엔진의 규칙을 담는 CRD는 이 내장 정책 Kind와 다릅니다
엔진 webhook의 `rules`·selector·예외 설정에 따라 자기 규칙의 수정·삭제까지 막을 수 있으므로 실제 등록 범위를 확인해야 합니다

## admission 변경은 자기 이름의 field manager를 만들지 않습니다

MAP은 `ApplyConfiguration`과 `JSONPatch`로 오브젝트를 변경합니다
`ApplyConfiguration`은 구조 병합을 사용하지만 `atomic`으로 표시한 struct·map·array는 변경할 수 없습니다

이름에 Apply가 있어도 별도의 SSA 요청을 보내는 것은 아닙니다
현재 구현은 typed object를 `Merge`하고 결과를 오브젝트로 바꾸며 MAP 이름의 소유권을 등록하지 않습니다

![요청의 field manager 계산 이후 mutating admission과 managedFields 유효성 검사가 진행되는 순서|tall](/diagrams/k8s-theory-policy-layers-2.svg)

CREATE·UPDATE·일반 PATCH에서는 요청에 따른 Update 계열 소유권 계산을, SSA에서는 Apply 계산을 mutating admission보다 먼저 수행합니다
따라서 새로 붙인 독립 필드가 기존 소유 집합에도 없다면 어느 manager도 소유하지 않을 수 있습니다

반대로 이미 소유된 필드를 변경하면 기존 소유권이 남을 수 있습니다
webhook이나 JSONPatch가 atomic 상위 필드 안에 값을 추가했다면 그 상위 단위의 소유권도 함께 봐야 합니다
모든 admission 변경을 주인 없는 필드로 부를 수는 없습니다

mutating admission 뒤에는 `managedFields` 자체가 유효한지 검사하는 wrapper가 있습니다
망가졌으면 admission 이전 장부로 복원하고 경고하지만, 새 필드에 소유자를 붙여주는 처리는 아닙니다

한편 배경 controller가 나중에 별도 API 쓰기를 보내면 일반 요청의 field manager 계산을 거칩니다
관리자 이름은 요청의 `fieldManager` 또는 User-Agent에서 유래할 수 있으므로 실제 `managedFields`를 확인해야 합니다

다른 관리자가 소유한 필드를 SSA로 다른 값으로 바꾸면 충돌할 수 있습니다
같은 값의 공유 소유, force를 통한 소유권 이전, 일반 Update까지 모두 HTTP 409로 묶을 수는 없습니다
세부 소유 단위는 [Server-Side Apply](/essays/k8s-theory-server-side-apply)에서 다룹니다

### 변경 함수는 재실행에도 같은 결과를 만들어야 합니다

MAP과 mutating webhook의 `IfNeeded`는 뒤의 변경에 따라 재호출할 수 있도록 허용합니다
정확히 한 번 더 실행되거나 정책·바인딩·webhook 사이에 원하는 전체 순서가 보장된다는 뜻은 아닙니다
기본값이 `Never`인 webhook도 PATCH 처리의 저장 재시도까지 포함한 모든 경로에서 한 번만 실행된다고 가정할 수 없습니다

같은 입력 상태에 여러 번 적용해도 값이 계속 변하지 않는 **멱등성**을 갖춰야 합니다
요청 오브젝트의 patch가 다른 자원을 원자적으로 만드는 수단도 아닙니다
다른 API 쓰기를 부작용으로 실행한다면 원래 요청과의 저장 원자성, dry-run·재시도·실패를 별도로 다뤄야 합니다

## 기존 위반을 찾는 것과 고치는 것은 다릅니다

보통 admission은 들어온 요청을 평가하며 기존 자원을 주기적으로 다시 검사하지 않습니다
PSA는 Namespace의 enforce 수준·버전을 바꿀 때 기존 Pod를 점검하고 경고할 수 있지만 그 Pod를 삭제하거나 고치지는 않습니다

Gatekeeper audit는 기존 자원을 제약과 비교해 Constraint의 status·로그·메트릭에 위반을 기록합니다
확인한 v3.23.1의 기본 간격은 60초이며 `--audit-interval=0`이면 주기 검사를 끕니다
기본은 API에서 자원을 조회하고 `--audit-from-cache=true`이면 복제한 자원의 범위에 의존합니다
활성 제약·제외 설정과 조회 권한도 검사 대상을 바꿉니다

Constraint status의 개별 위반 목록은 `--constraint-violations-limit`의 기본값인 20건까지입니다
초과 위반도 `totalViolations`에는 포함되므로 목록 길이를 전체 위반 수로 읽으면 안 됩니다
로그·메트릭의 보관과 status 목록의 상한은 별도입니다

Kyverno의 mutate existing은 배경 controller가 기존 자원에 별도 쓰기를 보내는 기능입니다
고정한 공식 문서는 이를 비동기로 설명하고 기본 한 시간마다 다시 조정하며 `BACKGROUND_SCAN_INTERVAL`로 간격을 바꾼다고 적습니다
그 간격은 이 문서 기준이며 실제 설치 설정과 변경 완료 시점은 확인해야 합니다

Gatekeeper audit의 위반 보고와 Kyverno mutate existing의 변경은 다른 동작입니다
어느 쪽도 요청 시점의 거절을 자동으로 대신하지 않으며, 주기와 대기 시간이 즉시 복구를 보장하지도 않습니다

## GitOps와 충돌하는 대상을 나눠 봅니다

정책과 GitOps 사이에 차이가 남아도 원인은 같지 않습니다

| 경쟁 대상 | 확인할 것 |
|---|---|
| admission이 붙인 필드 | 어느 소유 집합에 들어 있는지와 서버 변경을 diff에 포함했는지 |
| 배경 쓰기가 바꾼 필드 | 실제 manager·값·SSA 사용 여부·force와 소유권 충돌 |
| generate가 만든 오브젝트 | 추적·prune 대상인지와 생성 controller의 동기화·삭제 기준 |

Argo CD의 `managedFieldsManagers`는 실제 manager 이름으로 소유 필드의 차이를 제외합니다
새 독립 필드에 소유자가 없다면 이 방식으로 지목할 manager도 없습니다

Argo CD v3.5.6의 Server-Side Diff는 리소스별 SSA dry-run 응답을 라이브 상태와 비교하고 결과를 캐시합니다
새 자원을 처음 만드는 경우에는 이 비교를 하지 않습니다
해당 버전 문서는 이 기능을 Stable로 표시하며 mutating webhook 변경은 기본적으로 제외합니다

그 변경도 포함하려면 Application에서 Server-Side Diff와 함께 다음 비교 옵션을 설정합니다
아래는 전체 Application이 아니라 해당 annotation 부분입니다

```yaml
metadata:
  annotations:
    argocd.argoproj.io/compare-options: ServerSideDiff=true,IncludeMutationWebhook=true
```

이 설정은 비교 방식의 조정입니다
다른 controller의 쓰기 권한이나 현재 필드 소유권을 옮기는 설정은 아닙니다
Kyverno의 공식 문서는 Flux가 dry-run으로 mutating admission을 수용한다고 설명하지만 실제 도구 버전·설정의 diff 경로는 함께 확인해야 합니다

### 생성물은 필드보다 오브젝트의 수명을 두고 경쟁합니다

Kyverno generate는 요청 오브젝트를 바꾸는 대신 다른 오브젝트를 만듭니다
Git에 없다는 이유만으로 GitOps가 클러스터의 모든 자원을 지우는 것은 아닙니다
그 생성물이 도구의 추적 대상이고 prune이 적용될 때 삭제·재생성의 경쟁이 생길 수 있습니다

![GitOps가 prune 대상으로 지운 생성물을 동기화된 generate가 다시 만드는 조건부 순환|tall](/diagrams/k8s-theory-policy-layers-3.svg)

`synchronize: true`이면 생성물의 수정을 되돌리거나 원본 변경을 전파하고, 트리거가 사라졌을 때 생성물을 지우는 경로가 있습니다
`false`는 생성 이후의 지속적인 동기화를 끄는 선택입니다
정책·규칙·clone 원본·트리거의 삭제를 모두 같은 수명 규칙으로 묶어서는 안 됩니다

고정한 공식 문서에서 `data` 방식의 동기화는 정책 삭제 때 기본적으로 생성물을 삭제하며 `orphanDownstreamOnPolicyDelete: true`이면 남깁니다
`clone` 방식의 정책 삭제는 생성물을 남기는 것으로 설명합니다

clone 원본 삭제는 같은 문서의 본문과 표가 서로 다릅니다
확인한 Kyverno v1.19.2 구현에서는 원본과 트리거가 분리되고 동기화가 활성화된 추적 경로에서 원본 삭제를 downstream 삭제 요청으로 연결합니다
배경 처리에서는 추적 라벨·UID·출처 검증 등의 조건을 거쳐 지우므로 모든 clone 원본 삭제에 같은 결과를 단정할 수는 없습니다

또 `generate.foreach`의 대상 명세 변경이 기존 대상에 모두 동기화되는 것은 아닙니다
`ownerReferences`로 수명을 넘기려면 owner의 scope와 GC 조건도 맞아야 합니다
GitOps의 추적 범위, generate의 동기화, GC의 수명을 맞춰 어느 선언이 존재 여부를 관리할지 정해야 합니다

## 필요한 기능과 실패 범위로 선택합니다

| 필요한 것 | 선택 기준 | 함께 확인할 조건 |
|---|---|---|
| 정해진 workload 보안 수준 | PSA의 수준·모드·버전 | 실제 Pod의 enforce와 template의 audit·warn, 면제 범위 |
| 정해진 입력으로 요청 검증 | VAP 또는 해당 CRD의 CEL | 적용 리소스, 파라미터, 오류와 위반의 처리 차이 |
| 요청 오브젝트 변경 | MAP 또는 mutating webhook | 표현 가능한 변경, atomic 제한, 멱등성, 소유권과 diff |
| 다른 자원·외부 정보로 검증 | 캐시·조회 기능 또는 직접 구현한 webhook | 신선도·권한·지연·실패와 동시 쓰기 경계 |
| 기존 위반을 계속 찾거나 고치기 | 검사·변경 controller | 보고와 복구의 차이, 검사 범위·주기·별도 쓰기 권한 |
| 다른 자원 생성 | generate 또는 별도 controller | 추적·동기화·삭제·GC와 GitOps의 존재 여부 관리 |

이름이 같은 오류나 OutOfSync라도 먼저 응답한 요청과 쓰기 시점을 확인합니다
검증 위반인지 설정 오류인지, 새 상태를 막은 것인지 나중에 다른 주체가 바꾼 것인지 구분하면 적용 범위와 복구 경로를 좁힐 수 있습니다

## 참고 자료

- [Kubernetes VAP 공식 문서 저장본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/access-authn-authz/validating-admission-policy.md), [MAP 공식 문서 저장본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/access-authn-authz/mutating-admission-policy.md), [PSA 공식 문서 저장본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/security/pod-security-admission.md)
- [Kubernetes v1.37.1 admission v1 API](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/admissionregistration/v1/types.go), [v1 기본값](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/admissionregistration/v1/defaults.go), [VAP dispatcher](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/policy/validating/dispatcher.go), [정책 설정 오류 처리](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/policy/generic/policy_dispatcher.go)
- [MAP의 구조 병합](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/policy/mutating/patch/smd.go), [PATCH의 Apply·admission 처리](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/handlers/patch.go), [managedFields 유효성 검사](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/handlers/fieldmanager/admission.go)
- [Gatekeeper v3.23.1 audit 문서](https://github.com/open-policy-agent/gatekeeper/blob/2d0b6ad97cf3a8b8436a00a1f4b07b3a56b92ca0/website/docs/audit.md), [실제 audit 기본값](https://github.com/open-policy-agent/gatekeeper/blob/2d0b6ad97cf3a8b8436a00a1f4b07b3a56b92ca0/pkg/audit/manager.go), [복제 범위](https://github.com/open-policy-agent/gatekeeper/blob/2d0b6ad97cf3a8b8436a00a1f4b07b3a56b92ca0/website/docs/sync.md)
- [Kyverno mutate 문서 저장본](https://github.com/kyverno/website/blob/a10389d0d72e52aa5238a21fcf36ac1db06c7595/src/content/docs/docs/policy-types/cluster-policy/mutate.md), [generate 문서 저장본](https://github.com/kyverno/website/blob/a10389d0d72e52aa5238a21fcf36ac1db06c7595/src/content/docs/docs/policy-types/cluster-policy/generate.md), [v1.19.2의 generate 요청 처리](https://github.com/kyverno/kyverno/blob/e63308f1e16c05cd009ac4864be6ec25c66b49be/pkg/webhooks/resource/generation/handler.go), [downstream 삭제 조건](https://github.com/kyverno/kyverno/blob/e63308f1e16c05cd009ac4864be6ec25c66b49be/pkg/background/generate/cleanup.go)
- [Argo CD v3.5.6 Server-Side Diff](https://github.com/argoproj/argo-cd/blob/c2b1e3017e2cec86b122172e861dcd026453ae44/docs/user-guide/diff-strategies.md), [manager별 diff 제외](https://github.com/argoproj/argo-cd/blob/c2b1e3017e2cec86b122172e861dcd026453ae44/docs/user-guide/diffing.md), [리소스 추적 조건](https://github.com/argoproj/argo-cd/blob/c2b1e3017e2cec86b122172e861dcd026453ae44/docs/user-guide/resource_tracking.md)
