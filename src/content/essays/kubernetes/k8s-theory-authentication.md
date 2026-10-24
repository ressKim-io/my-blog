---
title: "Kubernetes 인증: 신원은 어디서 만들어지는가"
excerpt: "Pod의 ServiceAccount token이 발급되어 user.Info가 되기까지 따라갑니다. 파일 갱신과 토큰 재로딩, bound object 검증, TokenReview와 오프라인 JWT 검증의 차이를 설명합니다"
category: "kubernetes"
tags: ["kubernetes", "authentication", "serviceaccount", "concept"]
series:
  name: "k8s-theory-api"
  order: 2
date: "2026-07-25"
---

API 서버는 Pod가 보낸 요청을 누구의 요청으로 판단할까요?
Kubernetes에는 사람 사용자를 저장하는 `User` 오브젝트가 없지만, 인가 단계는 요청자의 이름과 그룹을 입력으로 받습니다
자격증명을 확인하는 인증기가 이 사용자 정보를 만듭니다

[API 서버 요청 경로](/essays/k8s-theory-api-request-path)에서 인증은 인가보다 먼저 실행됐습니다
이번에는 `prod` namespace의 Pod가 Pod 목록을 요청하는 상황을 가정해, 토큰이 만들어지고 인증 결과로 바뀌는 과정을 따라가겠습니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `8aaeb4e53d1a489570afe94ef5258554de68897a`
> 공식 문서 저장본: `kubernetes/website@1ad9080d7d3ddd79e955b7dd653711c8f2caedb8`
> 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## 토큰 파일과 요청의 신원은 서로 다른 주체가 만든다

ServiceAccount는 Pod 안의 프로세스 등이 사용할 수 있는 Kubernetes 신원입니다
Pod는 이 신원을 위한 bearer token을 요청에 실을 수 있습니다
bearer token은 문자열을 가진 쪽이 제시해 사용할 수 있는 자격증명입니다

![ServiceAccount admission부터 kubelet의 TokenRequest, 애플리케이션 요청과 user.Info 생성까지의 담당 주체](/diagrams/k8s-theory-authentication-1.svg)

ServiceAccount admission은 Pod의 volume **명세**를 바꿉니다
JWT를 발급하거나 실행 중인 컨테이너의 파일을 직접 쓰지는 않습니다
JWT(JSON Web Token)는 신원과 유효 조건을 claim으로 담아 서명한 토큰 형식입니다

나중에 kubelet이 Pod에 묶인 토큰을 요청하는 TokenRequest를 보냅니다
kubelet은 API 서버에서 발급받은 토큰을 projected volume을 통해 컨테이너 안의 파일로 제공합니다
이처럼 Pod에 연결된 토큰을 Pod bound token이라고 합니다
애플리케이션이 파일을 읽어 HTTP 요청에 실으면, 서버의 인증기가 이를 검사해 `user.Info`를 만듭니다

`user.Info`는 이름·UID·그룹·extra를 전달하는 인터페이스입니다
사용자를 저장하는 API 오브젝트와는 다릅니다
인증기의 응답에는 검증한 audience도 들어갈 수 있습니다
audience는 토큰을 받을 서비스의 식별자이며, `user.Info`와는 별도로 전달됩니다

## 만들어진 신원은 어떻게 인가에 전달되나

ServiceAccount `prod/web`의 토큰이 인증되면 다음과 같은 정보가 전달됩니다

| 항목 | 값의 예 |
|---|---|
| username | `system:serviceaccount:prod:web` |
| UID | ServiceAccount UID |
| groups | `system:serviceaccounts`, `system:serviceaccounts:prod`, `system:authenticated` |
| extra | Pod·Node·credential ID 등 `authentication.kubernetes.io/...` 정보 |

인증기가 만든 사용자 정보는 요청 context에 들어갑니다
인가는 여기에 verb·resource·namespace 같은 요청 속성을 붙여 판단합니다
팀별로 권한을 나누려면 인증된 그룹 등 인가가 받는 정보에 그 구분이 있어야 합니다

## 파일이 갱신되면 요청의 토큰도 바뀔까

파일을 갱신하는 일과 애플리케이션이 그 파일을 다시 읽는 일은 별개입니다
처음 읽은 문자열을 계속 보내면 kubelet이 새 토큰을 써도 실제 요청에는 옛 토큰이 실립니다

### 자동 주입과 갱신을 맡는 곳

일반 Pod의 자동 token volume 주입은 `automountServiceAccountToken` 설정을 따릅니다
Pod와 ServiceAccount에 모두 설정돼 있으면 Pod 설정이 우선합니다
자동 주입을 꺼도 ServiceAccount 자체나 이미 발급된 토큰의 권한을 폐기하는 것은 아닙니다

projected token에는 만료 시각이 있으므로 kubelet token manager가 새 토큰을 요청합니다
확인한 구현에서는 토큰 수명의 약 80%가 되는 시점과 발급 후 24시간이 되는 시점 중 먼저 오는 쪽을 기준으로 갱신을 요구합니다
여러 토큰이 동시에 갱신되는 것을 줄이기 위해 무작위 시간 차이인 jitter를 두어 기준 시점을 조금 앞당깁니다

갱신에 실패했어도 manager가 가진 토큰이 아직 유효하면 기존 토큰을 반환하고 오류를 기록합니다
TokenRequest 응답의 `status.expirationTimestamp`까지 지났다면 오류를 반환합니다
API 서버 연결이 끊겼다는 이유만으로 기존 토큰이 모두 즉시 무효가 되는 것은 아닙니다

### 만료 응답과 JWT의 exp가 다를 수 있다

확인한 소스에는 projected token 전환을 위한 만료 연장 경로가 남아 있습니다
다음 조건이 함께 맞을 때 적용됩니다

- `--service-account-extend-token-expiration`이 켜져 있음
- 토큰이 Pod에 묶여 있음
- 요청 만료값이 구현 상수인 3,607초와 같음
- 요청 audience가 API 서버 audience 범위에 들어감

이 경로에서는 TokenRequest 응답의 `status.expirationTimestamp`가 kubelet의 갱신 기준으로 남지만, JWT의 `exp`는 더 뒤일 수 있습니다
`kubernetes.io.warnafter` 뒤의 사용은 stale-token audit annotation과 지표를 남깁니다
3,607초는 권장 토큰 수명이 아니라 이 전환 경로를 식별하는 구현 값입니다

요청한 수명, 파일을 바꾸는 시점, JWT가 만료로 거부되는 시점을 같은 것으로 보면 안 되는 이유입니다
조건은 [`TokenREST.Create`](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/pkg/registry/core/serviceaccount/storage/token.go), 갱신 판단은 [`Manager.requiresRefresh`](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/pkg/kubelet/token/token_manager.go)에서 확인할 수 있습니다

### client-go의 BearerTokenFile 경로

client-go는 Kubernetes API용 Go 클라이언트입니다
token source는 요청에 사용할 토큰을 돌려주는 구성요소입니다
transport는 HTTP 요청을 전달하면서 인증 헤더 등을 처리합니다
확인한 버전의 `BearerTokenFile` 경로는 요청 시 캐시된 token source를 조회합니다
파일에서 읽은 값은 1분 동안 캐시하되, 캐시 만료 10초 전부터 다시 읽을 수 있도록 여유를 둡니다
이 주기를 JWT의 `exp`를 파싱해 정하지는 않습니다
이 재읽기는 요청을 처리할 때 일어나며 파일을 항상 감시하는 별도 루프라는 뜻은 아닙니다

이미 `Authorization` 헤더가 있으면 bearer transport는 토큰 삽입을 건너뜁니다
또한 `BearerTokenFile` 설정만으로 401 응답 시 캐시가 즉시 초기화되지는 않습니다
401을 보고 resettable token source를 초기화하는 동작은 별도의 `tokenSourceTransport`에 있습니다

따라서 파일 갱신 여부만으로 요청의 자격증명이 교체됐다고 결론 내릴 수 없습니다
애플리케이션이 어떤 transport와 재로딩 방식을 사용하는지도 확인해야 합니다

## Secret 기반 legacy token은 어디서 갈라지나

Secret 기반 장기 토큰은 보통 `exp`가 없고 audience별 제한을 표현하지 못합니다
Secret을 읽을 권한이 있으면 토큰도 읽을 수 있으며, ServiceAccount·Secret과 연결되지만 Pod UID에는 묶이지 않습니다
projected token은 TokenRequest로 발급하며, 별도 토큰 오브젝트를 저장하지 않습니다

v1.24부터 ServiceAccount마다 Secret 기반 토큰을 자동 생성하지 않으며, 수동 장기 토큰 Secret은 계속 지원됩니다
자동 생성된 미사용 legacy token은 v1.29부터 별도 정리 대상입니다
legacy token을 아무 객체에도 묶이지 않은 영구 토큰이라고 일반화할 수는 없습니다
이 조건은 [ServiceAccount 관리 공식 문서 저장본](https://github.com/kubernetes/website/blob/1ad9080d7d3ddd79e955b7dd653711c8f2caedb8/content/en/docs/reference/access-authn-authz/service-accounts-admin.md)과 [`legacyValidator.Validate`](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/pkg/serviceaccount/legacy.go)에서 확인할 수 있습니다

## Pod bound token은 서명만 맞으면 유효한가

API 서버는 JWT의 서명·issuer·audience·시간 조건과, 토큰이 묶인 객체의 상태를 함께 확인합니다
issuer는 토큰 발급자입니다

여기서 다루는 것은 Pod projected volume에 들어가는 Pod bound token입니다
TokenRequest에는 Secret이나 Node에 직접 묶는 경로도 있으므로 모든 단기 ServiceAccount token을 Pod bound token이라고 부를 수는 없습니다

다음은 claim 관계를 설명하는 예시이며 실제 토큰이나 실행 출력이 아닙니다
issuer와 audience의 실제 값은 클러스터 설정에 달려 있습니다

```yaml
iss: "https://kubernetes.default.svc.cluster.local"
sub: "system:serviceaccount:prod:web"
aud: ["https://kubernetes.default.svc.cluster.local"]
exp: "<만료 Unix 시각>"
iat: "<발급 Unix 시각>"
jti: "<토큰별 식별자>"
kubernetes.io:
  namespace: prod
  serviceaccount: {name: web, uid: "<SA UID>"}
  pod: {name: web-0, uid: "<Pod UID>"}
  node: {name: node3, uid: "<Node UID>"}
```

Pod가 아직 Node에 배치되지 않았다면 `node` claim은 없을 수 있습니다
객체 이름만으로 토큰의 대상을 고정할 수도 없습니다
`web-0`을 지우고 같은 이름으로 다시 만들면 UID가 달라지므로, 옛 Pod UID에 묶인 토큰이 새 Pod의 토큰이 되지는 않습니다

### 객체 상태와 60초의 의미

Pod bound token 인증에서는 ServiceAccount와 Pod의 존재·UID를 확인합니다
객체가 없거나 UID가 다르면 실패합니다
객체가 남아 있어도 `metadata.deletionTimestamp`가 현재 시각에서 기본 허용 오차 60초를 뺀 시각보다 앞서면 실패합니다

이 60초는 validator가 삭제 중인 객체의 토큰을 거부할지 판단할 때 사용하는 허용 오차입니다
모든 삭제에 반드시 60초를 기다린다는 뜻도, 삭제 후 60초 안에 모든 검증자에게 폐기가 반영된다는 보장도 아닙니다
객체가 이미 없어졌다면 조회 실패로 거부될 수 있습니다

Pod bound token의 `node` claim은 별도로 Node를 조회해 검증하지 않습니다
Pod에 묶이지 않고 Node에 직접 묶인 토큰은 Node의 존재·UID·삭제 상태를 검사합니다
Node 정보가 claim에 있다는 사실과 Node가 bound object라는 사실은 다릅니다

| 기능 | 구분하는 동작 | GA 이력 |
|---|---|---|
| `ServiceAccountTokenPodNodeInfo` | Pod bound token에 Node 이름·UID를 싣기 | v1.32 |
| `ServiceAccountTokenNodeBinding` | Node에 직접 토큰 묶기 | v1.33 |
| `ServiceAccountTokenNodeBindingValidation` | Node bound token 인증 시 Node 검증 | v1.32 |

확인한 v1.37.1 소스에서도 세 gate는 기본값 true에 잠긴 `LockToDefault` 상태입니다
토큰에 Node 정보를 넣는 기능과, Node에 토큰을 묶고 그 상태를 검증하는 기능을 구분해야 합니다

### audience가 맞으면 권한도 생길까

audience는 수신 대상에 대한 조건이며 API 동작 권한이 아닙니다
수신자는 발급자를 신뢰하는지와 audience가 자신에게 맞는지를 각각 확인해야 합니다
서비스 A용 토큰을 B가 서명만 보고 받아들이면 A에 제시한 자격증명이 B에서도 재사용됩니다

audience가 여러 개라면 수신자와 맞는 값이 그중 하나여야 합니다
이 검사를 통과해도 Pod 목록을 읽는 등의 동작은 별도 인가가 필요합니다

bound token도 여전히 bearer token입니다
Pod UID와의 결합은 객체 수명을 검증하는 조건이지, 요청이 해당 Pod의 네트워크에서 왔다거나 요청자가 개인 키를 소유한다는 증명이 아닙니다

## 외부 서비스가 토큰을 받으면 무엇이 달라지나

외부 서비스는 API 서버에 TokenReview를 요청하거나, JWT를 직접 검증할 수 있습니다
TokenReview는 제출한 토큰의 인증 결과를 API 서버에 묻는 API입니다

| 검증 경로 | 확인하는 조건 | 객체 수명의 반영과 한계 |
|---|---|---|
| API 서버의 ServiceAccount 인증 | 서명·issuer·audience·시간, ServiceAccount와 bound object | 관측한 객체 사본과 인증 캐시의 영향 |
| 외부 서비스의 TokenReview | 지정한 audience로 API 서버 인증 경로 사용 | API 호출 권한·가용성 필요. 서비스의 결과 캐시도 반영 지연 가능 |
| JWT 오프라인 검증 | 수신자가 서명·issuer·audience·시간을 올바르게 검사 | JWT만으로 현재 객체의 삭제·재생성을 알 수 없음 |

TokenReview의 `spec.token`은 **검사 대상** 토큰입니다
이 API 요청 자체를 보내는 서비스의 자격증명과 구분해야 합니다
자기 audience를 확인하려면 `spec.audiences`를 지정하고 `status.authenticated`와 호환되는 `status.audiences`를 함께 해석해야 합니다
audience를 생략하면 API 서버 audience가 기본으로 사용됩니다

API 서버가 객체 상태를 확인한다는 말도 매 요청마다 etcd 최신 값을 직접 읽는다는 뜻은 아닙니다
API의 변경을 따라가며 로컬 사본을 관리하는 informer와 토큰 인증 캐시, 외부 서비스의 결과 캐시 때문에 폐기 반영이 늦어질 수 있습니다
앞의 60초 조건을 전역적인 폐기 완료 시간으로 해석할 수 없는 이유입니다

## 사람의 이름과 그룹은 어디서 오나

사람 사용자도 요청마다 자격증명을 검사해 신원으로 바꿉니다
인증서의 `CN`은 username, `O`는 groups로 이어질 수 있습니다
OIDC/JWT는 설정된 claim 매핑으로 이름과 그룹을 만듭니다
OIDC(OpenID Connect)는 외부 신원 제공자가 발급한 토큰을 활용하는 인증 방식입니다

인증 결과의 이름과 그룹이 같으면 서로 다른 인증 수단도 같은 RBAC subject로 이어질 수 있습니다
RBAC은 인증서 파일명이나 로그인 도구를 비교하지 않습니다
여러 issuer를 신뢰할 때는 이름·그룹 매핑의 충돌이 권한 혼동으로 이어질 수 있습니다

자격증명 폐기와 권한 회수도 다릅니다
ServiceAccount UID는 토큰의 객체 검증에 쓰이지만, RoleBinding의 ServiceAccount subject는 namespace와 이름으로 매칭됩니다
같은 이름으로 ServiceAccount를 다시 만들면 옛 토큰은 UID 불일치로 거부됩니다
그와 별개로 새 토큰은 남아 있는 Binding의 권한을 얻을 수 있습니다

### 자격증명마다 접근 중단 조건이 다르다

| 수단 | 서버가 확인하는 근거 | 폐기·변경의 경계 |
|---|---|---|
| client certificate | 신뢰 CA, 유효 기간, ClientAuth 용도 등 | v1.37 공식 문서에도 개별 인증서 폐기 미지원. 만료·신뢰 CA·인가 변경을 구분 |
| ServiceAccount token | 서명·issuer·audience·시간과 관련 객체 | 만료 또는 객체 변경. 개별 단기 토큰의 중앙 폐기 목록은 없음 |
| OIDC/JWT | issuer·서명·audience·시간과 claim·user 규칙 | 기존 토큰의 만료와 서버 신뢰·검증 설정 |
| webhook token | 원격 TokenReview 응답 | 인증 서비스의 판단과 캐시 |
| bootstrap token | `kube-system`의 Secret | 해당 Secret의 상태 |
| proxy header | 신뢰된 프록시 인증서와 허용된 헤더 | 프록시 신뢰 설정과 신원 관리 |

프록시 인증은 `X-Remote-User: alice` 문자열만 믿는 방식이 아닙니다
API 서버가 먼저 신뢰된 프록시의 클라이언트 인증서를 확인해야 합니다

OIDC 계정을 정지해도 이미 발급된 JWT의 claim은 바뀌지 않습니다
API 서버는 매 요청마다 IdP의 현재 계정 상태를 조회하는 대신 토큰을 검사합니다
discovery나 서명 키 갱신에 필요한 네트워크 호출은 매 요청의 원격 계정 조회와 구분해야 합니다

`--authentication-config`는 여러 JWT issuer와 CEL 기반 claim 매핑을 지원하며 `--oidc-*`와 함께 사용할 수 없습니다
structured authentication은 v1.34에 GA가 됐습니다
v1.37.1 소스에서는 예전 `StructuredAuthenticationConfiguration` gate 정의가 제거돼 있습니다

## 인증기가 여러 개면 언제 익명이 되나

여러 인증기를 사용할 때는 첫 성공에서 평가를 끝냅니다
API 서버는 인증기의 실행 순서를 보장하지 않으므로 특정 수단의 우선순위에 의존하면 안 됩니다

한 인증기가 자기 자격증명이 아니라고 답하는 것과 검증 오류를 반환하는 것은 다릅니다
아무 인증기도 신원을 만들지 못했고 오류도 없다면 익명 인증 설정에 따라 다음 처리가 달라집니다
허용된 경로에서는 `system:anonymous`, `system:unauthenticated`가 붙고, 꺼져 있거나 허용되지 않은 경로라면 401입니다

확인한 구성에서는 일반 인증기들을 묶은 union 바깥에 익명 인증기가 있습니다
바깥 union은 일반 인증기 쪽에서 오류가 나면 익명 인증으로 넘어가는 fallback을 실행하지 않습니다
유효하지 않은 bearer token은 401이지만, 토큰 없는 요청은 익명 인증이 켜진 경로에서 익명 신원으로 진행할 수 있습니다
그 익명 신원을 인가가 거부하면 403입니다

외부 인증 webhook 장애의 영향도 요청마다 다를 수 있습니다
다른 인증기의 성공이나 캐시된 결과로 처리되는 요청과 원격 호출이 필요한 요청을 구분해야 합니다

| 응답의 단서 | 해석할 경계 |
|---|---|
| 401 `Unauthorized` | 유효하지 않은 토큰, 인증기 오류, 익명 비활성화 등 |
| 403과 `User "system:anonymous"` | 익명 신원은 만들어졌고 인가에서 거부됨 |
| 403과 확인된 사용자 이름 | 인증 뒤의 거부. 인가와 admission은 메시지로 구분 |

`system:anonymous`는 인증 실패의 다른 이름이 아닙니다
토큰이 없었는지, 전송되지 않았는지, 만료된 토큰을 계속 보냈는지에 따라 경로가 다릅니다
이 차이를 구분해야 파일 재로딩 문제와 익명 인증 설정을 혼동하지 않습니다

## 더 확인할 소스와 문서

- [인증 응답의 User·Audiences: `authenticator.Response`](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/staging/src/k8s.io/apiserver/pkg/authentication/authenticator/interfaces.go)
- [Pod 명세 주입: ServiceAccount admission](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/plugin/pkg/admission/serviceaccount/admission.go), [projected volume 파일 작성](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/pkg/volume/projected/projected.go)
- [claim 구성과 객체 검증: `validator.Validate`](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/pkg/serviceaccount/claims.go)
- [client-go 파일 캐시와 별도 401 처리: `token_source.go`](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/staging/src/k8s.io/client-go/transport/token_source.go), [BearerTokenFile transport](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/staging/src/k8s.io/client-go/transport/round_trippers.go)
- [신원 이름·그룹: `ServiceAccountInfo.UserInfo`](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/staging/src/k8s.io/apiserver/pkg/authentication/serviceaccount/util.go)
- [인증 캐시와 익명 fallback: `Config.New`](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/pkg/kubeapiserver/authenticator/config.go), [인증 union](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/staging/src/k8s.io/apiserver/pkg/authentication/request/union/union.go)
- [TokenReview의 token·audience 필드](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/staging/src/k8s.io/api/authentication/v1/types.go), [객체 사본 조회와 fallback](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/pkg/controller/serviceaccount/tokengetter.go)
- [Node token gate 이력](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/pkg/features/kube_features.go), [API 서버의 현재 gate 정의](https://github.com/kubernetes/kubernetes/blob/8aaeb4e53d1a489570afe94ef5258554de68897a/staging/src/k8s.io/apiserver/pkg/features/kube_features.go)
- [structured authentication의 GA 이력: v1.35 당시 gate 정의](https://github.com/kubernetes/kubernetes/blob/5671697925fe8d7222c4ab09cb15f28f5f9d0383/staging/src/k8s.io/apiserver/pkg/features/kube_features.go)
- [Authenticating 공식 문서 저장본](https://github.com/kubernetes/website/blob/1ad9080d7d3ddd79e955b7dd653711c8f2caedb8/content/en/docs/reference/access-authn-authz/authentication.md), [Configure Service Accounts for Pods](https://github.com/kubernetes/website/blob/1ad9080d7d3ddd79e955b7dd653711c8f2caedb8/content/en/docs/tasks/configure-pod-container/configure-service-account.md)
