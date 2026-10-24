---
title: "Ingress와 Gateway API — 역할에 따라 라우팅 설정 나누기"
excerpt: "Ingress에 함께 있던 구현 선택, TLS 설정, 요청 라우팅을 Gateway API가 어떻게 나누는지 살펴봅니다. parentRefs와 allowedRoutes의 부착 관계, 대상 네임스페이스의 ReferenceGrant, CRD와 실제 구현의 지원 경계를 구분합니다"
category: kubernetes
tags: [kubernetes, ingress, gateway-api, networking, rbac, concept]
series:
  name: "k8s-theory-network"
  order: 6
date: "2026-10-10"
---

Ingress에는 처리할 컨트롤러 선택, 인증서 설정, 요청을 보낼 백엔드가 함께 들어 있습니다
한 오브젝트에 담겨 있어도 이를 결정하는 사람은 인프라 제공자, 클러스터 운영자, 앱 개발자로 나뉠 수 있습니다

Gateway API는 역할별로 편집할 설정을 서로 다른 리소스에 나눠 담습니다
라우팅 기능이 늘어난 것과 함께, 누가 어떤 설정을 편집할 수 있는지도 달라집니다

이 글은 Kubernetes v1.37.1과 별도 프로젝트인 Gateway API v1.6.3을 기준으로 설명합니다
공식 문서·API 타입·CRD를 대조한 이론 정리이며, 특정 컨트롤러를 설치해 동작을 실측한 기록은 아닙니다

## Ingress는 HTTP 요청과 Service를 연결합니다

Ingress는 요청의 호스트와 경로에 따라 백엔드 Service를 정하고 TLS 설정을 담습니다
도메인 하나에서 몇 개의 경로를 나누는 HTTP 라우팅에는 이 모델로 충분할 수 있습니다

실제 트래픽 처리는 Ingress 컨트롤러가 구성한 프록시나 로드 밸런서가 맡습니다
Ingress 오브젝트만 생성해도 처리기가 생기는 것은 아니므로, 컨트롤러의 설치와 처리 대상 선택을 함께 확인해야 합니다

코어 Ingress의 표현 범위는 HTTP·HTTPS입니다
`spec.tls`의 API 주석은 TLS 포트를 443 하나로 한정하며, 임의의 TCP·UDP 포트를 여는 공통 필드를 제공하지 않습니다

TLS Secret을 참조하면 클라이언트와 진입점 사이의 TLS 종료에 사용합니다
이 설정만으로 진입점에서 백엔드까지의 TLS가 구성되지는 않습니다
컨트롤러가 별도 확장으로 지원하는 기능과 코어 Ingress의 공통 모델을 구분해야 합니다

이 범위는 [Ingress 공식 문서](https://kubernetes.io/docs/concepts/services-networking/ingress/)와 [v1.37.1 `IngressSpec`·`IngressTLS`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/networking/v1/types.go#L285-L345)에 정의돼 있습니다

### 어떤 컨트롤러가 처리할지 고르는 경로

`spec.ingressClassName`은 클러스터 범위의 `IngressClass` 이름을 가리킵니다
그 IngressClass의 `spec.controller`가 처리할 컨트롤러를 식별합니다

과거에는 `kubernetes.io/ingress.class` 어노테이션이 널리 쓰였습니다
이 키는 정식 API 필드로 정의되지 않았고 현재 deprecated지만, API 주석은 호환성을 위해 컨트롤러가 여전히 이를 존중해야 한다고 설명합니다
새로 작성할 때는 `ingressClassName`을 우선합니다

기본 클래스는 IngressClass의 `ingressclass.kubernetes.io/is-default-class: "true"` 어노테이션으로 지정합니다
v1.37.1의 `DefaultIngressClass` admission 플러그인은 생성 시 `ingressClassName`과 기존 class 어노테이션이 모두 없으면 기본 클래스를 채웁니다
기본 클래스가 없으면 필드를 그대로 두며, 이후 class 없는 Ingress를 처리할지는 컨트롤러 설정에 달려 있습니다

다중 기본 클래스의 동작은 문서와 고정 소스가 다릅니다
공식 문서는 class 없는 Ingress 생성을 거절한다고 설명하지만, v1.37.1 구현의 `getDefaultClass`는 생성 시각이 가장 최근인 클래스를 고릅니다
생성 시각이 같으면 이름의 오름차순으로 선택합니다

이 설명은 [v1.37.1 admission 구현](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/plugin/pkg/admission/network/defaultingressclass/admission.go#L83-L155)을 읽은 결과입니다
운영 설정에서는 기본 클래스를 하나로 관리하고 `ingressClassName`을 명시해 선택의 모호함을 줄일 수 있습니다

## 어노테이션으로 확장한 기능과 편집 권한

헤더 기반 분기, 가중치 분배, 타임아웃, 경로 재작성처럼 공통 Ingress 필드로 표현하지 못하는 기능은 구현별 어노테이션으로 전달해 왔습니다
공통 API를 변경하지 않고도 컨트롤러가 자기 키를 해석해 기능을 추가할 수 있기 때문입니다

코어 API 서버는 메타데이터의 일반 형식을 검사하지만, 컨트롤러마다 정한 어노테이션 의미까지 검증하지는 않습니다
별도 admission webhook이 이를 검사할 수는 있어도, 코어 Ingress 스키마가 모든 구현의 확장을 이해하는 것은 아닙니다
같은 YAML을 다른 컨트롤러로 옮기면 키를 무시하거나 다르게 해석할 수 있습니다

확장된 설정도 Ingress 한 오브젝트에 모여 있습니다
앱 팀에 경로 편집만 허용하면서 운영자의 TLS 설정은 보호하기가 어렵습니다

RBAC은 리소스와 동사를 기준으로 권한을 줍니다
Ingress의 경로 필드만 수정하고 `spec.tls`는 수정하지 못하게 하는 권한을 RBAC만으로 표현할 수는 없습니다

따라서 Ingress 편집 권한을 주면 그 안의 TLS Secret 참조도 변경할 수 있습니다
이는 Secret 데이터 자체를 읽거나 수정하는 권한과는 별개입니다
필드 수준의 제약이 필요하면 RBAC 외의 검증이 필요합니다

## GatewayClass·Gateway·Route로 역할을 나눕니다

Gateway API의 대표적인 역할 구분은 다음과 같습니다
한 사람이 여러 역할을 맡을 수 있으며, 이 표 자체가 권한을 자동으로 설정하지는 않습니다

| 리소스 | 일반적인 담당자 | 결정하는 내용 |
|---|---|---|
| `GatewayClass` | 인프라 제공자 | 어떤 컨트롤러가 이 종류의 Gateway를 관리하는가 |
| `Gateway` | 클러스터 운영자 | 어떤 listener·포트·프로토콜·TLS 설정으로 요청을 받을 것인가 |
| `HTTPRoute` 등 Route | 앱 개발자 | 어떤 요청을 어떤 백엔드로 보낼 것인가 |

![GatewayClass·Gateway·HTTPRoute의 편집 역할과 참조 관계|tall](/diagrams/k8s-theory-ingress-gateway-api-1.svg)

Gateway는 `spec.gatewayClassName`으로 GatewayClass를 참조합니다
GatewayClass의 `spec.controllerName`은 해당 종류의 Gateway를 관리할 컨트롤러 식별자입니다
GatewayClass는 클러스터 범위이며 Gateway와 Route는 네임스페이스에 속합니다

Gateway의 listener는 요청을 받을 포트, 프로토콜, 호스트명, TLS 설정 등을 정합니다
부착된 HTTPRoute는 호스트·경로·헤더 등의 매칭 규칙을 정하고, `backendRefs`가 Service를 가리키면 그 백엔드로 전달하도록 요청합니다

그림의 참조선은 API 오브젝트 사이의 설정 관계입니다
패킷이 GatewayClass나 HTTPRoute 오브젝트를 순서대로 통과하는 것이 아닙니다
선택된 컨트롤러가 명세를 읽어 실제 프록시·로드 밸런서에 반영합니다

이 역할 분리는 [공식 역할 모델](https://gateway-api.sigs.k8s.io/docs/concepts/roles-and-personas/)과 [보안 모델](https://gateway-api.sigs.k8s.io/docs/concepts/security/)의 설계입니다
앱 팀에 HTTPRoute 편집 권한을 주고 Gateway 편집 권한은 주지 않는 RBAC 구성이 가능해집니다
Route 추가 때마다 운영자가 Gateway 안에 개별 Route 목록을 등록하는 구조도 피할 수 있습니다

### TLS 설정은 연결 구간별로 구분합니다

HTTPS listener의 `tls.certificateRefs`는 클라이언트와 Gateway 사이에서 TLS를 종료할 인증서를 참조합니다
TLS passthrough는 Gateway가 암호화된 세션을 종료하지 않고 전달하는 별도 모드이며, HTTPS listener와 HTTPRoute의 TLS 종료 모델과 구분합니다

Gateway API는 클라이언트에서 Gateway로 오는 구간과 Gateway에서 백엔드로 가는 구간을 독립적으로 설정합니다
전자의 인증서를 적었다고 후자도 암호화되지는 않습니다
후자의 TLS 정책은 `BackendTLSPolicy` 같은 별도 설정과 구현 지원을 확인해야 합니다

구체적인 listener 프로토콜·TLS 모드·Route 조합은 [공식 TLS 가이드](https://gateway-api.sigs.k8s.io/guides/user-guides/tls/)에 정리돼 있습니다
Gateway listener 모델은 Ingress의 `spec.tls`가 가진 443 단일 포트 표현과도 다릅니다

## parentRefs는 부착 요청, allowedRoutes는 수락 범위입니다

Route의 `spec.parentRefs`는 어느 Gateway에 붙고 싶은지 지정합니다
Gateway 쪽은 listener의 `allowedRoutes`로 받아들일 Route의 종류와 네임스페이스 범위를 정합니다

Route가 대상 이름을 적는 것만으로 부착되지는 않습니다
listener의 허용 범위와 Route 종류·프로토콜·호스트 조건 등이 맞아야 합니다
`parentRefs.sectionName`으로 특정 listener를 지정했다면 그 이름도 맞아야 합니다

`allowedRoutes.namespaces.from`의 기본값은 `Same`으로, Gateway와 같은 네임스페이스의 Route만 허용합니다
다른 네임스페이스의 Route를 받으려면 `All` 또는 `Selector`로 범위를 열어야 합니다
`Selector`는 Route 자체의 라벨이 아니라 네임스페이스의 라벨을 선택합니다

![Gateway 부착의 allowedRoutes와 백엔드 교차 참조의 ReferenceGrant 구분|tall](/diagrams/k8s-theory-ingress-gateway-api-2.svg)

운영자가 허용 범위를 한 번 정하면 앱 팀은 그 범위 안에서 자기 Route만 추가·편집할 수 있습니다
Gateway를 매번 편집할 권한을 주지 않으면서도 라우팅 작업을 위임하는 구조입니다

네임스페이스 선택에 사용자 정의 라벨을 사용한다면, 그 라벨을 변경할 권한도 부착 허용 범위에 영향을 줍니다
선택 조건만이 아니라 누가 네임스페이스 라벨을 수정할 수 있는지도 함께 봐야 합니다
기본값과 종류 선택 규칙은 [v1.6.3 `AllowedRoutes`·`RouteNamespaces`](https://github.com/kubernetes-sigs/gateway-api/blob/c0836133e24073fcdcdbb1713aba3cc73a89d0b5/apis/v1/gateway_types.go#L828-L901)에 정의돼 있습니다

## ReferenceGrant는 참조 대상 쪽의 허가입니다

Route가 다른 네임스페이스의 Service를 백엔드로 참조하거나, Gateway가 다른 네임스페이스의 TLS Secret을 참조할 때는 대상 쪽의 허가가 필요합니다
Gateway API의 기본 모델에서 이를 표현하는 리소스가 `ReferenceGrant`입니다

Grant는 **참조 대상과 같은 네임스페이스**에 만듭니다
`from`에는 참조를 허용할 출발 리소스의 API 그룹·종류·네임스페이스를 적고, `to`에는 자기 네임스페이스에서 참조받을 리소스의 그룹·종류를 적습니다
`to.name`으로 대상 이름을 제한할 수도 있습니다

요청자가 자기 네임스페이스에 Grant를 만들어 다른 쪽의 리소스 사용을 허가할 수는 없습니다
자원을 참조하고 싶다는 요청과 그 자원 소유자의 허가를 분리하기 때문입니다

| 교차 네임스페이스 관계 | 허가를 확인할 곳 |
|---|---|
| Route가 Gateway에 부착 | 대상 Gateway listener의 `allowedRoutes` |
| Route가 백엔드 Service를 참조 | Service 네임스페이스의 `ReferenceGrant` |
| Gateway가 TLS Secret을 참조 | Secret 네임스페이스의 `ReferenceGrant` |

Route가 다른 네임스페이스의 Gateway에 붙는 관계에는 `ReferenceGrant`를 사용하지 않습니다
부착과 백엔드·인증서 참조는 서로 다른 허가 경계입니다

Grant는 생성 시 한 번 검사하고 끝나는 허가도 아닙니다
구현은 변경·삭제를 감시해 참조의 유효성을 다시 계산하고, 허가를 잃은 참조의 접근을 회수해야 합니다
스펙은 이 회수에 대한 고정 시간 상한을 보장하지 않습니다

허가가 없을 때는 status나 경고 메시지로 참조가 불허됐다는 사실을 설명해야 합니다
이때 대상 리소스의 존재 여부까지 노출해서는 안 됩니다

[ReferenceGrant 명세](https://gateway-api.sigs.k8s.io/reference/api-types/referencegrant/)에는 다른 수단이 동등한 효과로 교차 참조를 제한하는 경우의 엄격한 예외도 있습니다
구현이 이 예외를 쓰려면 ReferenceGrant를 따르지 않는 사실과 대체 보호 수단을 명확히 문서화해야 합니다
이 조건을 일반적인 Gateway 구현에서 Grant를 생략해도 된다는 뜻으로 확대할 수는 없습니다

## CRD 버전과 컨트롤러 지원을 따로 확인합니다

Gateway API는 Kubernetes 코어에 내장된 Ingress와 달리 별도 프로젝트에서 API 타입과 CRD를 배포합니다
CRD는 API 서버에 새로운 리소스와 그 스키마를 등록하는 정의입니다
따라서 Kubernetes v1.37.1이라는 정보만으로 Gateway API의 설치 버전이나 지원 Route를 알 수 없습니다

2026-10-23에 확인한 최신 정식 릴리스는 [Gateway API v1.6.3](https://github.com/kubernetes-sigs/gateway-api/releases/tag/v1.6.3)입니다
이 릴리스의 Standard CRD는 다음 API 버전을 제공합니다

| 리소스 | `served: true`인 버전 | 저장 버전 |
|---|---|---|
| GatewayClass·Gateway·HTTPRoute | `v1`, `v1beta1` | `v1` |
| GRPCRoute·TCPRoute·TLSRoute·UDPRoute | `v1` | `v1` |
| ReferenceGrant | `v1`, `v1beta1` | `v1beta1` |

표의 기준은 [고정 릴리스의 Standard CRD 디렉터리](https://github.com/kubernetes-sigs/gateway-api/tree/c0836133e24073fcdcdbb1713aba3cc73a89d0b5/config/crd/standard)입니다
같은 릴리스의 overview에는 TCPRoute·UDPRoute를 Experimental로 소개하는 설명이 남아 있어 실제 배포 정의와 구분해야 합니다
ReferenceGrant도 요청에 사용할 수 있는 버전과 실제 저장 버전이 다릅니다

Standard와 Experimental은 리소스·필드의 안정성을 구분하는 채널입니다
Experimental에는 Standard의 내용과 실험적인 리소스·필드가 함께 들어가며, 실험 기능에는 호환성 보장이 없습니다
`apiVersion: gateway.networking.k8s.io/v1`만 보고 그 리소스의 모든 필드가 Standard라고 판단할 수도 없습니다

또한 채널과 구현 지원 수준은 별개입니다
Core는 적합성의 공통 기능, Extended는 표준에 정의됐지만 모든 구현이 지원하지는 않는 기능, Implementation-specific은 구현별 확장입니다
예를 들어 HTTPRoute의 타임아웃은 v1.6.3 API 타입에 있지만 Extended 지원에 해당합니다

CRD 설치는 API 서버가 오브젝트를 받을 수 있게 하는 단계입니다
컨트롤러가 실제로 설치돼 있는지, 그 버전이 어느 Gateway API 릴리스·Route·기능을 지원하는지는 별도로 확인해야 합니다
프로젝트의 [구현 목록](https://gateway-api.sigs.k8s.io/docs/implementations/list/)과 [적합성 기준](https://gateway-api.sigs.k8s.io/docs/concepts/conformance/)에서도 Gateway·Mesh 프로파일, Route 종류, Core·Extended 기능을 나눠 확인합니다

## 생성 성공 뒤에는 부착과 참조 상태를 확인합니다

API 서버가 YAML을 수락했다는 사실만으로 데이터 경로에 반영됐다고 판단할 수는 없습니다
Route의 `status.parents`는 부모와 처리 컨트롤러별 상태를 구분하며, Route 가용성은 Gateway 자체와 listener 상태에도 영향을 받습니다

| 확인할 상황 | 먼저 대조할 설정·상태 |
|---|---|
| Ingress를 만들었지만 처리되지 않음 | 컨트롤러 설치, `ingressClassName`, 기본 클래스, class 없는 Ingress 처리 설정 |
| 어노테이션이 기대와 다르게 동작 | 해당 컨트롤러 버전의 지원 키와 값 의미, 별도 검증 정책 |
| HTTPRoute가 Gateway에 붙지 않음 | `parentRefs`, listener 이름·프로토콜·호스트, `allowedRoutes` |
| listener가 Route를 허용하지 않음 | Route의 `Accepted=False`, reason `NotAllowedByListeners` |
| 다른 네임스페이스의 백엔드 참조가 불허됨 | 대상의 ReferenceGrant, Route의 `ResolvedRefs=False`, reason `RefNotPermitted` |
| 다른 네임스페이스의 TLS Secret 참조가 불허됨 | Secret 쪽 ReferenceGrant, listener의 `ResolvedRefs=False`, reason `RefNotPermitted` |
| Grant를 제거했는데 접근이 계속됨 | 컨트롤러의 변경 감지·설정 반영·접근 회수 상태 |

상태 필드가 비어 있는 것과 `Accepted=False`도 다릅니다
없는 부모를 참조하거나, 컨트롤러가 Route 종류를 지원하지 않거나, 해당 네임스페이스를 볼 권한이 없으면 `Accepted` 자체가 설정되지 않을 수 있습니다
이 경계는 [v1.6.3 `RouteParentStatus`와 상태 조건](https://github.com/kubernetes-sigs/gateway-api/blob/c0836133e24073fcdcdbb1713aba3cc73a89d0b5/apis/v1/shared_types.go#L341-L555)에 명시돼 있습니다

## 단순한 라우팅과 역할 분리의 관리 비용

Ingress API는 GA 상태이며 기능 확장이 동결된 frozen API입니다
이는 deprecated나 제거 예정이라는 뜻이 아니며, [Kubernetes 공식 문서](https://kubernetes.io/docs/concepts/services-networking/ingress/)는 Ingress 제거 계획이 없다고 설명합니다

단순한 HTTP 라우팅을 한 담당자가 관리한다면 Ingress 모델로 요구를 충족할 수 있습니다
Gateway API에서는 class·진입점·Route의 관계를 여러 오브젝트에서 읽어야 하는 관리 부담이 있습니다

운영자와 앱 팀의 책임이 나뉜다면 이 분리가 권한 설계에 도움이 됩니다
앱 팀의 라우팅 편집, 운영자의 listener·인증서 설정, 참조 대상 소유자의 교차 참조 허가를 각 리소스와 정책으로 표현할 수 있기 때문입니다
