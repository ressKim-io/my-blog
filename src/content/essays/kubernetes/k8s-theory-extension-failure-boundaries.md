---
title: "Kubernetes 확장을 고를 때 먼저 정할 실패 경계"
excerpt: "내장 API·구성 생성·CEL·정책 엔진·CRD와 controller·aggregation을 필요한 동작으로 비교합니다. 요청 거절과 비동기 수렴, 변환·discovery 장애, API 철거와 상태 공개의 책임을 구분합니다"
category: "kubernetes"
tags: ["Kubernetes", "CRD", "Admission", "Controller", "Platform Engineering", "concept"]
series:
  name: "k8s-theory-extension"
  order: 6
date: "2026-11-07"
---

요구사항을 구현할 수 있는지만 물으면 controller나 별도 API 서버로 해결할 수 있는 범위는 넓습니다
그런데 구현을 추가하는 순간, 그 프로그램이 멈췄을 때 무엇을 복구할지도 함께 맡게 됩니다

네임스페이스 간 통신 차단과 외부 SaaS의 큐 생성은 모두 플랫폼 기능입니다
전자는 기존 네트워크 정책의 집행이 필요하고, 후자는 시간이 걸리는 생성·재시도·삭제와 결과 공개가 필요합니다
같은 방식으로 구현할 이유가 없습니다

먼저 이미 있는 기능이 요구를 충족하는지 확인하고, 부족한 동작과 운영 책임을 비교해야 합니다
여기서 말하는 단계는 공식 기능 등급이나 상위 호환 관계가 아닙니다
여러 수단을 함께 사용할 수도 있으며 실패 지점이 정확히 하나씩 늘어나는 법칙도 아닙니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서 고정본을 대조했습니다
> controller 예시의 라이브러리 기준은 controller-runtime v0.25.2이며, go.mod의 client-go 의존성은 v0.37.0입니다
> 아래 요구사항은 동작을 비교하기 위한 가정이며, 클러스터에서 실행한 결과는 아닙니다

## 먼저 필요한 동작을 구분합니다

Kubernetes의 [확장 안내](https://kubernetes.io/docs/concepts/extend-kubernetes/)는 설정 변경과 추가 프로그램·네트워크 서비스를 운영하는 확장을 구분합니다
요구에 맞는 내장 정책 API가 있다면 설정 파일·명령행 인자보다 우선 검토하도록 권합니다

그다음에는 구성 생성, 요청 판정, 별도 자원 생성, 수명 조정 중 무엇이 필요한지 봅니다

| 수단 | 맡을 수 있는 동작 | 함께 맡는 책임 |
|---|---|---|
| 이미 있는 Kubernetes API | 제공된 기능을 선언·설정 | API와 실제 구현 구성요소의 기존 운영 |
| Helm values·Kustomize | API에 보낼 구성을 생성·변형 | 렌더링·배포·구성 이탈 관리 |
| API 서버의 CEL 정책 | 요청 오브젝트를 검증하거나 변경 | 정책·바인딩·선택적 파라미터와 평가 오류 |
| 정책 엔진 | 제품이 지원하는 검증·변경·다른 자원 생성 | 프로세스·캐시·webhook·배경 조정의 가용성 |
| CRD와 controller | 사용자 정의 API에 요청을 저장하고 비동기 조정 | API 호환성·재시도·상태·삭제 처리 |
| Aggregated API server | 별도 저장 방식·계산된 응답·추가 subresource 등 | 서버·인증과 인가·APIService·discovery 운영 |

Helm이나 Kustomize로 정책 파일을 만들 수는 있습니다
하지만 그 파일을 거치지 않는 요청까지 계속 검사하는 주체는 배포된 정책이나 별도 조정 구성요소입니다
구성 생성 도구 자체와 지속적인 강제를 같은 기능으로 보면 빈 경로가 생깁니다

CEL 정책은 API 서버 안에서 실행하므로 별도 정책 서버로 향하는 네트워크 왕복을 추가하지 않습니다
그래도 정책의 매칭·컴파일·평가 비용과 오류는 관리해야 합니다
현재 MAP인 `MutatingAdmissionPolicy`는 v1.36부터 GA·기본 활성입니다
v1.37에서는 `admissionregistration.k8s.io/v1`을 사용합니다
실제 서버에서 해당 API와 admission 플러그인이 제공·활성화돼 있는지도 확인해야 합니다

## 요구사항 네 개를 대입해 봅니다

### 다른 팀의 Pod가 우리 DB에 접속하지 못하게 합니다

이 요구는 [NetworkPolicy](/essays/k8s-theory-network-policy)의 영역입니다
이를 집행하는 네트워크 구현이 있어야 하며, NetworkPolicy 오브젝트 생성만으로 패킷이 차단되지는 않습니다
이 전제는 [공식 네트워크 정책 문서](https://kubernetes.io/docs/concepts/services-networking/network-policies/)에도 명시돼 있습니다

Admission은 API 요청을 검사합니다
이미 실행 중인 Pod 사이의 패킷을 요청마다 검사하는 위치가 아닙니다
통신을 제한하려는 요구에 admission 규칙만 추가하면 집행 지점을 잘못 고른 셈입니다

### 컨테이너 이미지가 사내 레지스트리를 가리켜야 합니다

요청에 담긴 이미지 문자열만으로 판정할 수 있다면 CEL 정책을 검토할 수 있습니다
`object`뿐 아니라 `oldObject`·`params`·`namespaceObject`와 권한 확인용 `authorizer` 등 제공된 입력을 사용합니다

이 입력은 임의의 자원을 GET·LIST하거나 외부 서비스를 자유롭게 호출하는 기능이 아닙니다
필요한 정보가 제공 범위 밖에 있다면 외부 조회나 캐시를 지원하는 다른 구현이 필요한지 따져야 합니다

이미지 문자열 검사는 이미지 내용이나 서명 검증을 대신하지 않습니다
일반·초기화·임시 컨테이너 중 어느 필드와 subresource를 검사할지, 어떤 요청을 매칭할지도 정책의 일부입니다
템플릿에 허용 이미지만 적는 것과 직접 보낸 API 요청까지 거절하는 것은 다릅니다

### Namespace를 만들면 기본 NetworkPolicy도 생겨야 합니다

Namespace와 NetworkPolicy는 서로 다른 API 오브젝트입니다
코어 CEL admission의 변경 기능은 요청 오브젝트를 바꾸며 별도 NetworkPolicy 생성 요청을 대신 보내지는 않습니다

기존 정책 엔진이 필요한 생성·동기화 기능을 제공한다면 그 구현을 사용할 수 있습니다
모든 엔진이 생성 기능을 갖는 것은 아니므로 검증·변경·생성을 제품 이름 하나로 묶으면 안 됩니다

비동기 생성이라면 Namespace 접수와 정책 생성 사이에 간격이 생길 수 있습니다
생성물의 ownerReference, 삭제 후 복원 여부, 원본 정책을 지웠을 때의 정리도 실제 구현과 설정에 달려 있습니다

이 간격을 허용할지와 생성물을 누가 관리할지는 별도 결정입니다
엔진은 정책을 계속 복원하고 GitOps는 계속 삭제하도록 구성하면 두 조정 루프가 오브젝트의 존재를 두고 경쟁합니다
필드 값 충돌과 생성·삭제 충돌은 [정책 계층 글](/essays/k8s-theory-policy-layers)처럼 나눠 봐야 합니다

### 큐를 요청하면 외부 SaaS에 만들고 접속 정보를 Secret에 기록합니다

이 요구에는 접수 후에도 계속할 일이 남습니다
외부 큐 생성이 끝날 때까지 기다리고, 실패를 재시도하며, 삭제할 때 외부 자원도 정리해야 합니다

기존 controller나 엔진이 이 수명을 이미 제공하는지 먼저 확인합니다
직접 구현한다면 CRD에 요청을 저장하고 controller가 조정하는 방식을 검토할 수 있습니다

![외부 큐 요청의 API 접수와 저장 이후 controller 조정, status 기록을 나눈 흐름|tall](/diagrams/k8s-theory-extension-failure-boundaries-1.svg)

그림은 큐 요청을 가정한 접수와 조정의 구분입니다
API 단계에 표시한 검증·변환·외부 호출을 모든 요청이 같은 순서로 거친다는 뜻은 아닙니다
매칭된 admission과 실제로 필요한 변환, 활성화한 설정에 따라 의존성이 달라집니다

**요청 저장의 성공과 외부 큐 준비 완료는 서로 다른 시점입니다**
controller가 멈추면 CR은 남아 있어도 외부 큐와 Secret이 원하는 상태를 따라오지 못할 수 있습니다
상태 갱신 역시 멈출 수 있으므로 과거의 준비 상태를 현재 상태로 단정해서는 안 됩니다

삭제를 보류하는 finalizer만 추가해도 외부 큐가 정리되지는 않습니다
controller가 정리 동작을 구현하고, 성공을 확인한 뒤 finalizer 제거를 API에 저장해야 합니다
외부 작업이 일부 끝난 뒤 재호출돼도 중복 생성·삭제를 안전하게 처리해야 합니다

적은 수의 오래 사는 큐 요청을 저장한다는 조건만으로 별도 API 서버가 필요한 것은 아닙니다
CRD는 Kubernetes API 서버의 저장 경로를 제공합니다
다른 저장소·계산된 응답·별도 API 동작이 필요한지는 [aggregation의 경계](/essays/k8s-theory-aggregated-api-server)에서 따로 판단합니다

## 장애가 요청을 막는지, 수렴을 늦추는지 봅니다

외부 서버가 하나 있다는 사실보다 중요한 것은 그 서버를 언제 호출하느냐입니다
요청 중의 동기 호출과 저장 이후의 비동기 조정은 장애가 드러나는 위치가 다릅니다

| 실패한 경계 | 요청이나 상태에 나타날 수 있는 영향 | 함께 확인할 조건 |
|---|---|---|
| CEL 설정·평가 | 매칭된 요청의 경고·감사 기록·거절 | 설정 오류인지 규칙 위반인지, failurePolicy·validationActions |
| Admission webhook | 외부 호출이 필요한 요청의 지연·실패 | 매칭·연결·인증서·타임아웃·failurePolicy |
| Controller | 저장된 요청의 후속 조정·상태 갱신·삭제 정리가 지연 | 프로세스뿐 아니라 감시·RBAC·반복 오류·외부 의존성 |
| Conversion webhook | 변환이 필요한 읽기·쓰기·삭제가 실패 가능 | 변환 전략, 입력과 목표 버전, 남은 옛 저장본 |
| 원격 aggregated API | 해당 그룹·버전의 요청·discovery 실패 | APIService·Service 연결·TLS·확장 서버의 인증과 인가 |

### 정책의 오류를 무조건 허용하거나 거절한다고 단정하지 않습니다

VAP인 `ValidatingAdmissionPolicy`에서 검증식의 false 결과는 바인딩의 `validationActions`를 따릅니다
평가 오류도 `failurePolicy`를 거쳐 거절 평가로 취급되면 `Deny`·`Warn`·`Audit` 동작이 적용됩니다

반면 파라미터를 찾지 못했고 `parameterNotFoundAction: Deny`라면 설정 오류 경로가 됩니다
이때 `failurePolicy: Fail`은 `validationActions`를 거치지 않고 직접 거절할 수 있습니다
따라서 Warn·Audit 바인딩이라는 이유만으로 요청을 절대로 막지 않는다고 보장할 수 없습니다

외부 webhook의 `failurePolicy: Ignore`도 정상적인 거절 응답을 무시하는 설정이 아닙니다
호출·평가 오류를 어떻게 다룰지와 정상적으로 얻은 규칙 위반 결과는 나눠 확인합니다

### Controller를 다시 띄우는 것만으로 조정이 복구되지는 않습니다

[조정 루프](/essays/k8s-theory-controller-runtime-reconcile)는 오류 반환에 따른 재시도와 `RequeueAfter` 예약 등을 제공합니다
그래도 필요한 자원을 읽고 쓰는 권한, 조정 대상으로 다시 들어오는 계기, 외부 작업의 반복 안전성은 구현이 갖춰야 합니다
`TerminalError`처럼 오류 자체로 재시도를 예약하지 않는 경로도 있습니다

프로세스가 실행 중이라는 신호만으로 수렴을 판정할 수 없습니다
반복 오류로 같은 키만 재시도하는지, 캐시가 동기화되는지, 외부 작업과 status 쓰기 중 어디까지 진행했는지를 봐야 합니다

### Conversion 장애는 읽기와 삭제에도 닿을 수 있습니다

`conversion.strategy: Webhook`을 사용해도 모든 요청이 외부 변환 서버를 호출하는 것은 아닙니다
현재 구현은 입력과 목표 apiVersion이 같은 항목을 호출 대상에서 제외하며, `None` 전략에는 외부 변환 호출이 없습니다

반대로 현재 served 버전이 하나여도 옛 버전으로 저장된 CR이 남아 있으면 변환이 필요할 수 있습니다
일반 DELETE 역시 기존 객체를 읽어 UID·삭제 조건·finalizer를 처리하므로, 이 읽기에 필요한 변환이 실패하면 삭제가 막힐 수 있습니다

같은 버전의 항목이 있다는 사실만으로 요청 전체의 성공을 보장할 수도 없습니다
목록의 다른 객체·캐시·admission·저장 인코딩에서 별도 변환이 필요할 수 있습니다
자세한 호출 경계는 [CRD 버전과 변환](/essays/k8s-theory-crd-version-conversion)에서 구분합니다

### 확장 API의 discovery 오류는 다른 정리 작업에도 영향을 줍니다

원격 APIService는 특정 그룹·버전의 경로를 확장 서버로 연결합니다
등록만으로 서버나 데이터 경로가 생기는 것은 아니며, 확장 서버에 대한 TLS 검증과 전달된 사용자 신원의 신뢰·인가를 갖춰야 합니다
가용성만 복구하려고 신뢰 조건을 약하게 바꾸는 것을 같은 해결책으로 볼 수는 없습니다

Namespace 삭제 controller는 정리할 자원 종류를 discovery로 알아냅니다
일부 목록 조회에 실패해도 알아낸 자원의 삭제를 진행할 수 있지만, 오류가 남으면 자신의 Namespace finalizer를 제거하는 완료 단계로 넘어가지 않습니다
Pod가 남아 있으면 다른 자원 삭제를 먼저 미루는 조건도 있습니다

따라서 Namespace가 `Terminating`인 것만으로 확장 서버 중단을 단정하지 않습니다
`NamespaceDeletionDiscoveryFailure`와 내용·finalizer 잔존 condition을 구분합니다
해당 APIService의 상태·연결·인증서·discovery 응답도 확인해야 합니다

## 복구할 설정을 고치는 경로도 의존성을 갖습니다

API로 구성한 CEL 정책은 VAP·VAPBinding·MAP·MAPBinding 네 종류를 해당 API 기반 정책의 평가에서 제외합니다
자기 설정을 수정하지 못하는 순환 의존을 줄이기 위한 처리입니다

이 규칙이 모든 복구 요청을 보장하지는 않습니다
v1.37의 정적 manifest 기반 정책은 이 설정 자원을 평가할 수 있고, RBAC·다른 admission·API 서버와 저장소의 장애도 별도로 남습니다

정책 엔진의 규칙을 담는 CRD에는 같은 제외 규칙을 그대로 적용할 수 없습니다
실제로 등록한 webhook의 리소스 규칙·selector·예외를 확인해야 엔진 설정의 수정·삭제가 가능한지 알 수 있습니다

## 철거 비용은 필드·변경·등록마다 다릅니다

확장을 지우는 것과 확장이 만든 결과를 되돌리는 것은 같은 작업이 아닙니다
서로 다른 세 가지 잔존 상태가 있습니다

| 없애려는 것 | 남을 수 있는 결과 | 되돌리기 전에 확인할 일 |
|---|---|---|
| 공개한 CRD 필드·버전 | 이를 사용하는 클라이언트와 저장된 값 | 스키마·왕복 변환·실제 저장본 이행 |
| 변경 정책·webhook | 이미 오브젝트에 반영된 값 | 어떤 값이 바뀌었는지와 실제 managedFields |
| APIService 등록 | 확장 서버의 데이터·외부 자원 | 그 등록 경로를 제거한 뒤 목록·정리를 수행할 방법 |

### 스키마를 되돌려도 사라진 값이 복원되지는 않습니다

현재 CRD 스키마에서 필드를 제거하면 보존 예외가 없는 값은 읽기·변환 경로에서 가지치기될 수 있습니다
`x-kubernetes-preserve-unknown-fields`로 보존하거나 `additionalProperties`로 허용한 범위는 별도로 봐야 합니다
스키마 변경 자체가 etcd의 기존 객체 전부를 즉시 다시 쓰지는 않습니다
하지만 값이 빠진 결과가 다시 저장됐다면 스키마를 되돌리는 것만으로 그 값을 복원할 수 없습니다

새 버전을 내는 경우에도 변환 webhook이 값을 자동으로 보존하지는 않습니다
목표 스키마의 다른 필드나 annotations 등 적절한 위치로 옮기는 설계가 필요합니다
conversion에서 labels·annotations만 바꿀 수 있다는 제한은 metadata 내부에 대한 것이며 spec·status 변환 전체를 금지하지 않습니다
`None`은 apiVersion을 바꾸며, 이름이나 구조가 달라진 필드를 의미에 맞게 옮기지는 않습니다

저장 버전 이행에는 새 버전 준비, storage 변경, 기존 객체의 재쓰기, `status.storedVersions` 정리, 옛 버전 제거가 필요합니다
`storedVersions`는 옛 형식의 잔존 객체 수를 세는 목록이 아닙니다
API 서버는 목록이 비어 있지 않고 현재 storage를 포함하며 `spec.versions`와 맞는지 검증하지만, 실제 저장본 이행 완료를 대신 조사하지 않습니다

필드를 추가할 때도 required·default·검증과 옛 클라이언트 호환성을 확인해야 합니다
공개한 필드는 소비자가 의존하는 계약이 되므로, 나중에 제거할 때의 데이터·클라이언트 이행까지 생각해야 합니다

### 정책 삭제는 그 정책이 바꾼 값을 회수하지 않습니다

Mutating admission은 일반적으로 정책별 field manager를 자동 등록하지 않습니다
CREATE 경로에서도 요청의 필드 소유권 계산 후 mutating admission이 실행됩니다

새 독립 필드가 기존 소유 집합에도 없다면 소유자가 없을 수 있고, 이미 소유된 필드를 바꾸면 기존 소유권이 남을 수 있습니다
이후 다른 요청이 소유권을 얻을 수도 있으므로 모든 변경 필드를 영구히 주인 없다고 설명해서는 안 됩니다

정책을 지울 때 과거 변경을 자동 역변환하는 장부로 `managedFields`를 사용할 수는 없습니다
배경 controller가 나중에 별도 API 쓰기로 바꾼 경우에는 그 요청의 소유권 계산을 따로 봐야 합니다

### APIService 제거는 확장 서버의 데이터를 삭제하지 않습니다

APIService를 지우면 kube-apiserver의 그 등록 경로로는 자원을 열거할 수 없게 됩니다
확장 서버의 실제 저장 데이터나 외부 자원까지 함께 삭제되는 것은 아닙니다

등록 제거로 discovery 오류가 사라졌다는 관측만으로 내용 정리가 끝났다고 판단해서는 안 됩니다
남은 데이터를 어떤 경로와 권한으로 확인·정리할지까지 철거 절차에 포함해야 합니다

## 내부를 감추더라도 진행 결과는 보여 줍니다

[CNCF 플랫폼 백서](https://tag-app-delivery.cncf.io/whitepapers/platforms/)는 구현의 복잡도를 감싸 사용자의 인지 부담을 줄이면서, 기존 제공자 위에 필요한 최소한의 플랫폼 계층을 만들도록 권합니다
필요한 구성·관측 능력까지 감추라는 뜻은 아닙니다

사용자가 큐를 요청했는데 내부 CR이나 controller 로그를 볼 권한이 없다면, 접수·진행·준비·실패를 알 수 있는 다른 경로가 있어야 합니다
그 경로가 없으면 사용자는 매번 플랫폼 운영자에게 내부 상태를 물어보게 됩니다

API 관례는 spec과 status가 있는 자원에서 사용자의 spec 쓰기·status 읽기와 controller의 status 쓰기를 권한으로 구분할 수 있도록 설명합니다
실제로는 `/status` subresource와 RBAC를 설계해야 하며, 모든 API에 status가 필수라는 뜻은 아닙니다

표준 `metav1.Condition`을 채택하면 `type`·`status`·`lastTransitionTime`·`reason`·`message`가 필수 필드입니다
`reason`은 비어 있으면 안 되고 `message`는 빈 문자열을 허용합니다
선택 필드인 `observedGeneration`은 어느 요청 세대를 관찰한 판정인지 나타냅니다

CRD가 같은 제약을 얻으려면 해당 스키마를 선언해야 합니다
표준 `SetStatusCondition` 헬퍼는 기존 condition의 status가 달라질 때 전이 시각을 갱신합니다
모든 controller가 이 헬퍼를 쓰거나 API 서버가 일괄 적용하는 규칙은 아닙니다

경고 헤더·감사 로그·Event·condition은 서로 도달하는 곳과 보관 방식이 다릅니다
자동으로 처리한 결과를 보여 줄 때에는 사용자가 실제로 읽을 수 있는지와, 그 정보가 현재 요청을 관찰한 결과인지도 함께 확인해야 합니다

## 확인한 근거

- [Kubernetes 확장 안내 고정본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/extend-kubernetes/_index.md), [Custom Resources 비교](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/extend-kubernetes/api-extension/custom-resources.md)
- [CEL 정책의 제외 경로](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/policy/generic/plugin.go), [설정 오류의 직접 거절](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/policy/generic/policy_dispatcher.go), [VAP 평가와 validationActions](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/policy/validating/dispatcher.go)
- [변환 대상·metadata 복원](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apiserver/conversion/webhook_converter.go), [storedVersions 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/validation/validation.go), [Namespace 삭제의 오류 수집과 완료 조건](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/namespace/deletion/namespaced_resources_deleter.go)
- [CREATE의 필드 관리·admission 순서](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/handlers/create.go), [API의 spec·status 관례](https://github.com/kubernetes/community/blob/e8963b1070ee8bd9edfc7bf965ca7b0eaf991f0b/contributors/devel/sig-architecture/api-conventions.md)
- [controller-runtime v0.25.2 go.mod](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/go.mod), [재시도 처리](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/internal/controller/controller.go), [finalizer 헬퍼](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/finalizer/finalizer.go)
- [Condition 필드 계약](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/apis/meta/v1/types.go), [전이 시각 갱신 헬퍼](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/api/meta/conditions.go)
