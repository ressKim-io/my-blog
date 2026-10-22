---
title: "kubelet 접속과 인가 — 같은 logs 요청에서 주체가 바뀝니다"
excerpt: "kubectl logs가 사용자의 pods/log 권한과 API 서버 클라이언트의 nodes/proxy 권한을 거치는 과정을 따라갑니다. kubelet의 인증·인가 위임, 설정 방식별 기본값, TLS 검증과 연결 실패를 구분합니다"
category: "kubernetes"
tags: ["kubernetes", "kubelet", "RBAC", "TLS", "Konnectivity", "concept"]
series:
  name: "k8s-theory-api"
  order: 18
date: "2026-10-23"
---

`kubectl logs`에서 권한 오류가 나왔다고 해서 항상 사용자의 권한이 부족한 것은 아닙니다
API 서버가 kubelet에 접속하는 구간에서는 API 서버의 kubelet 클라이언트가 권한 검사의 대상이 됩니다

[인증](/essays/k8s-theory-authentication)과 [인가](/essays/k8s-theory-authorization)에서는 API 서버가 요청을 받았습니다
이번에는 API 서버가 노드의 kubelet에 요청을 보내고, kubelet이 그 요청자의 신원과 권한을 확인합니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## logs 요청에서 인가 대상이 바뀌는 지점

사용자가 컨테이너 로그를 요청하면 API 서버는 먼저 그 사용자의 `get pods/log` 권한을 검사합니다
API 서버가 로그 내용을 직접 가지고 있지는 않으므로 Pod가 배치된 노드의 kubelet에 접속합니다

![사용자의 pods/log 인가 뒤 API 서버 클라이언트의 nodes/proxy 인가가 이어지는 로그 요청 흐름|tall](/diagrams/k8s-theory-kubelet-access-1.svg)

그림은 kubelet이 `Webhook` 모드로 인가를 위임하는 경우입니다
API 서버는 kubelet에 HTTPS로 `/containerLogs/<namespace>/<pod>/<container>`를 요청합니다
이때 사용하는 것은 원래 사용자의 자격 증명이 아니라 API 서버에 설정된 kubelet 클라이언트 자격 증명입니다

kubelet은 이 신원을 인증한 뒤 요청 경로를 `nodes/proxy` 권한 질문으로 바꿉니다
그리고 `SubjectAccessReview`로 API 서버에 권한 판정을 요청합니다
SubjectAccessReview는 지정한 주체가 특정 동작을 해도 되는지 묻는 API입니다

첫 인가는 사용자의 `pods/log`, 두 번째 인가는 API 서버 클라이언트의 `nodes/proxy`를 대상으로 합니다
따라서 같은 사용자에게 전달된 403이어도 어느 요청자의 어떤 권한이 거절됐는지 나눠 읽어야 합니다

## 접속 주소와 포트는 Node status에서 읽습니다

API 서버는 Node 오브젝트에서 접속 정보를 얻습니다
포트는 `status.daemonEndpoints.kubeletEndpoint.port`를 사용하고, 값이 0 이하일 때만 기본 포트 `10250`으로 돌아갑니다
이 기본 포트를 바꾸는 `--kubelet-port` 플래그는 deprecated 상태입니다

주소는 `status.addresses`에서 고릅니다
`--kubelet-preferred-address-types`는 실제 주소를 지정하는 플래그가 아니라 주소 타입의 우선순위를 정합니다

| 기본 우선순위 | 주소 타입 |
|---|---|
| 1 | `Hostname` |
| 2 | `InternalDNS` |
| 3 | `InternalIP` |
| 4 | `ExternalDNS` |
| 5 | `ExternalIP` |

API 서버는 타입별로 주소 목록을 훑어 처음 일치하는 값을 사용합니다
지정한 타입이 하나도 없으면 다이얼 전에 `no preferred addresses found; known addresses: [...]`로 실패합니다
주소를 고른 뒤 연결에 실패한다고 자동으로 다음 타입의 주소를 재시도하는 선택 알고리즘은 아닙니다

노드가 늘고 줄 때마다 API 서버의 주소 목록을 고치는 대신, Node 오브젝트가 접속 정보를 전달하는 구조입니다
kubelet이 보고한 포트와 주소를 실제로 읽는 곳은 [`GetConnectionInfo`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/client/kubelet_client.go)이며, 타입 우선순위는 [`GetPreferredNodeAddress`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/util/node/node.go)에서 적용합니다

### 주소를 보고한 노드와 주소의 소유자는 같다고 보장되지 않습니다

NodeRestriction은 노드가 자기 Node만 수정하도록 제한하고, `configSource`·taint·`ownerReferences`·일부 label 변경도 제한하는 admission 플러그인입니다
하지만 확인한 [`admitNode`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/plugin/pkg/admission/noderestriction/admission.go)는 `status.addresses`가 실제로 그 노드의 주소인지 확인하지 않습니다

주소 검사도 요청 경로별로 구분해야 합니다
`nodes/proxy`의 [`ResourceLocation`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/node/strategy.go)은 이름을 IP로 해석하고, 결과 중 하나라도 global unicast가 아니면 `address not allowed`로 거절합니다
global unicast는 일반적인 유니캐스트 주소 분류이며, 사설 IP가 모두 금지된다는 뜻은 아닙니다

이 검사는 루프백·link-local 등을 제외하지만, 다른 호스트의 일반 유니캐스트 주소까지 노드의 소유 여부로 구분하지는 않습니다
또한 `kubectl logs`의 [`LogLocation`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/pod/strategy.go)은 이 함수를 거치지 않고 접속 URL을 만듭니다
따라서 `nodes/proxy`의 주소 검사를 모든 kubelet 접속에 공통으로 적용되는 방어선으로 설명할 수는 없습니다

## TLS에서는 양쪽이 서로 다른 인증서를 사용합니다

API 서버가 kubelet에 자신을 증명할 때는 `--kubelet-client-certificate`와 `--kubelet-client-key`로 지정한 클라이언트 인증서와 키를 사용합니다
반대로 kubelet은 서빙 인증서를 제시하고, API 서버는 이를 검증할지 결정합니다

| 연결에서 확인하는 것 | 설정 |
|---|---|
| kubelet이 API 서버 클라이언트를 신뢰하는가 | kubelet의 `authentication.x509.clientCAFile` |
| API 서버가 kubelet 서버를 신뢰하는가 | API 서버의 `--kubelet-certificate-authority` |

kubeadm의 kubelet 클라이언트 인증서 CN은 `kube-apiserver-kubelet-client`이며 Organization은 지정하지 않습니다
x509 인증은 CN에서 사용자 이름을 얻고 O에서 그룹을 얻으므로, kubeadm의 권한 바인딩도 이 사용자 이름을 직접 가리킵니다
O가 없다는 것은 인증서에서 추가 그룹을 얻지 않는다는 뜻이며, 인증 뒤 부여되는 공통 그룹까지 없다는 뜻은 아닙니다

클라이언트 인증서를 지정하지 않으면 kubelet의 x509 인증으로 이 신원을 만들 수 없습니다
다른 유효한 인증 수단도 없다면 익명 인증을 허용하는지에 따라 처리 결과가 달라집니다

### HTTPS 연결이라고 서버 신원을 검증하는 것은 아닙니다

API 서버의 kubelet 접속 스킴은 `https`로 고정돼 있습니다
그러나 kubelet용 transport는 CA가 없으면 서빙 인증서 검증을 건너뜁니다
`--kubelet-certificate-authority`로 신뢰할 CA를 제공해야 서버 인증서 검증을 수행합니다

이 동작은 [`transportConfig`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/client/kubelet_client.go)에 있으며, [공식 통신 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/architecture/control-plane-node-communication.md)도 기본 검증 생략과 중간자 공격 위험을 함께 설명합니다
암호화 여부와 상대방의 신원을 확인했는지는 별개의 조건입니다

여기서 `kubernetes.io/kubelet-serving` signer가 발급한 인증서가 없다는 것과 서빙 인증서 자체가 없다는 것은 구분해야 합니다
kubelet은 제공받은 인증서나 자체 서명 인증서를 사용할 수도 있습니다
자체 서명 인증서로 TLS가 동작하더라도 API 서버가 신뢰하는 CA에 연결된다는 보장은 없습니다

노드의 클라이언트 인증서에는 조건부 자동 승인 경로가 있지만, `kubelet-serving`에는 내장 자동 승인자가 없습니다
`serverTLSBootstrap`도 기본 `false`이므로, 이를 켜지 않으면 해당 CSR이 만들어지지 않을 수 있고 켜더라도 별도 승인 없이는 `Pending`으로 남을 수 있습니다
CSR은 인증서 발급 요청을 담는 API 오브젝트입니다

따라서 노드의 클라이언트 인증서 발급이 끝났다고 kubelet의 CA 서명 서빙 인증서와 API 서버의 신뢰 설정까지 준비된 것은 아닙니다
서빙 인증서 승인자는 요청한 IP·DNS 이름을 그 노드가 사용할 자격이 있는지도 확인해야 합니다
이 비대칭은 [TLS bootstrapping 문서의 서빙 인증서 절](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/access-authn-authz/kubelet-tls-bootstrapping.md)에 설명돼 있습니다

`kubectl logs --insecure-skip-tls-verify-backend`는 해당 로그 요청에 한해 검증을 건너뛰는 transport를 선택합니다
API 서버 전체의 CA 설정을 바꾸는 플래그가 아니라, 호출자가 `PodLogOptions.insecureSkipTLSVerifyBackend`로 전달하는 요청 옵션입니다

## kubelet은 토큰과 권한 판정을 API 서버에 위임합니다

kubelet의 x509 인증은 앞의 `clientCAFile`로 직접 수행합니다
토큰 인증과 인가는 각각 다른 API에 위임할 수 있습니다

| 판정 | 위임 API | kubelet 설정 |
|---|---|---|
| bearer 토큰이 나타내는 신원 | `TokenReview` | `authentication.webhook.enabled` |
| 그 신원이 해당 동작을 할 권한 | `SubjectAccessReview` | `authorization.mode: Webhook` |

TokenReview는 토큰을 보내 인증 결과와 신원을 받는 API입니다
두 API 모두 API 서버의 기존 인증·인가 정책을 재사용하므로 kubelet이 RBAC 정책 오브젝트 전체를 복제할 필요가 없습니다
실제 구성은 [`BuildAuthn`과 `BuildAuthz`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kubelet/app/auth.go)에서 확인할 수 있습니다

### 왕복을 줄이는 캐시는 권한 변경 반영을 늦출 수 있습니다

| 캐시 | 설정 필드 | 기본 보관 시간 |
|---|---|---|
| 토큰 인증 결과 | `authentication.webhook.cacheTTL` | 2분 |
| 허용 인가 결과 | `authorization.webhook.cacheAuthorizedTTL` | 5분 |
| 거절 인가 결과 | `authorization.webhook.cacheUnauthorizedTTL` | 30초 |

허용 결과가 남아 있으면 권한을 회수한 뒤에도 같은 인가 속성의 요청이 통과할 수 있습니다
반대로 거절 결과가 남아 있으면 권한을 새로 부여해도 즉시 통과하지 않을 수 있습니다
기본값 기준 허용 결과는 거절 결과보다 열 배 오래 보관됩니다

이 시간은 권한 변경을 클러스터 전체에 반영하는 보장 시간이 아닙니다
각 kubelet의 결과 캐시와 API 서버 쪽 정책 반영도 구분해야 합니다
API 서버에 되묻는 과정에서 오류가 나면 인가 필터는 500을 반환하지만, 캐시로 답할 수 있는 요청은 새 왕복 없이 처리될 수 있습니다

## 설정 파일과 기존 명령행의 기본값이 다릅니다

같은 kubelet 바이너리라도 설정 파일 API의 기본값과 기존 명령행 기본값은 네 필드에서 다릅니다
아래는 값을 명시하지 않은 경우의 비교입니다

| 필드 | `--config`로 읽는 설정 API 기본값 | 설정 파일 없이 플래그만 사용하는 기본값 |
|---|---|---|
| `authentication.anonymous.enabled` | `false` | `true` |
| `authentication.webhook.enabled` | `true` | `false` |
| `authorization.mode` | `Webhook` | `AlwaysAllow` |
| `readOnlyPort` | `0`, 서버를 띄우지 않음 | `10255` |

설정 파일 API는 익명 차단과 인가 위임을 기본으로 삼았습니다
반면 기존 명령행과의 호환성을 위해 초기 설정에는 [`applyLegacyDefaults`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kubelet/app/options/options.go)가 이전 기본값을 적용합니다
파일을 읽으면 API 기본값이 적용된 설정으로 바꾸고, 명시한 명령행 플래그를 다시 파싱해 우선 적용합니다

따라서 `--config`를 사용한다는 사실만으로 표 왼쪽 값이 실제 적용됐다고 단정할 수도 없습니다
파일의 명시적 값, 함께 준 플래그, 추가 설정 조각까지 확인해야 합니다

플래그만 사용하고 이 값들을 바꾸지 않았다면 익명 인증과 `AlwaysAllow`가 함께 동작합니다
네트워크로 닿는 클라이언트의 익명 요청이 등록된 kubelet API에 허용될 수 있고, 별도의 읽기 전용 포트도 열립니다
공식 문서에 적힌 익명 허용·`AlwaysAllow` 기본값과 설정 파일 API의 기본값을 섞으면 실제 접근 조건을 잘못 판단할 수 있습니다

## HTTP 경로를 nodes 하위 리소스 권한으로 바꿉니다

kubelet은 요청 경로를 RBAC 리소스 속성으로 바꿔 인가합니다
리소스는 `nodes`, 이름은 자기 Node 이름이며, namespace와 API group은 빈 문자열입니다
`GET`은 `get`, `POST`는 `create` 같은 API 동사로 바꿉니다

| kubelet 경로 | 인가에 사용하는 하위 리소스 |
|---|---|
| `/stats` 계열 | `stats` |
| `/metrics` 계열 | `metrics` |
| `/logs` 계열 | `log` |
| `/checkpoint` 계열 | `checkpoint` |
| `/statusz` 계열 | `statusz` |
| `/flagz` 계열 | `configz` |
| `/exec/`·`/attach/`·`/portForward/`·`/containerLogs/`·`/run/` 등 기본 분기 | `proxy` |
| `/debug/flags/v` | 기본 분기의 `proxy` |

`kubectl logs`가 요구하는 두 번째 권한은 **`nodes/log`가 아니라 `nodes/proxy`**입니다
컨테이너 로그 경로는 `/containerLogs/`이고, `nodes/log`는 노드 자체 로그를 제공하는 `/logs/` 계열에 대응하기 때문입니다

이 이름들은 실제 Node 하위 API가 모두 존재한다는 뜻이 아닙니다
kubelet이 권한 질문을 표현하기 위해 만드는 합성 리소스 속성입니다
이름을 붙였다고 해당 핸들러까지 활성화되는 것도 아닙니다

### 리소스로 바꾸면 노드 이름도 함께 제한할 수 있습니다

RBAC의 `nonResourceURLs`는 `/healthz` 같은 경로를 표현할 수 있지만 특정 노드 이름을 함께 지정할 필드가 없습니다
리소스 규칙과 비리소스 URL 규칙을 한 규칙에 섞을 수도 없습니다

반면 리소스 규칙은 `resources: ["nodes/stats"]`로 경로 종류를 정하고 `resourceNames`로 대상 Node를 제한할 수 있습니다
모든 노드에 같은 `/stats/summary` 경로가 있더라도 권한은 노드 이름까지 구분할 수 있습니다
경로를 합성 리소스 속성으로 바꾸면 기존 RBAC 규칙을 그대로 재사용할 수 있는 이유입니다

필드는 [`PolicyRule`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/rbac/v1/types.go)에 정의돼 있고, 규칙의 혼합 금지는 [`ValidatePolicyRule`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/rbac/validation/validation.go)에서 검사합니다

경로별 정확한 분기는 [`GetRequestAttributes`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/server/auth.go)에 있습니다
공식 문서의 표에는 `/runningPods` 표기가 남아 있지만, 확인한 서버 경로 상수는 소문자 `/runningpods/`입니다
실제 요청 경로는 소스의 대소문자를 기준으로 구분했습니다

## 좁은 권한을 추가해도 proxy 권한은 남습니다

`KubeletFineGrainedAuthz`는 일부 경로에 더 좁은 권한 이름을 추가한 기능입니다
v1.35에서는 beta였지만, v1.36에 GA가 됐고 v1.37.1에서는 기본 활성 상태로 잠겨 있습니다
이 버전에서 게이트를 꺼 비교하는 절차로 설명하면 맞지 않습니다

| 경로 계열 | v1.37.1이 확인하는 순서 |
|---|---|
| `/pods`·`/runningpods` | `nodes/pods`, 그다음 `nodes/proxy` |
| `/healthz` | `nodes/healthz`, 그다음 `nodes/proxy` |
| `/configz` | `nodes/configz`, 그다음 `nodes/proxy` |

v1.37.1 소스에는 `/allocatedPods` 계열도 `pods`, `proxy`로 매핑하는 분기가 있습니다
이 경로 자체의 등록 여부는 별도의 `KubeletAllocatedPodsEndpoint` 기능에 달려 있습니다
인가 속성이 있다는 사실과 endpoint가 실제로 열려 있다는 사실은 구분해야 합니다

![좁은 nodes/pods 판정이 허용되지 않으면 nodes/proxy를 검사하고 오류는 즉시 500으로 끝내는 흐름](/diagrams/k8s-theory-kubelet-access-2.svg)

예를 들어 `/pods` 요청은 먼저 `nodes/pods`를 묻습니다
오류 없이 `Deny`나 `NoOpinion`이 나오면 `nodes/proxy`로 다시 묻고, 어느 속성에서든 `Allow`가 나오면 통과합니다
어느 쪽도 허용하지 않으면 403이며, 인가 호출 오류가 나면 즉시 500으로 끝납니다

일반 authorizer 체인과는 반복하는 대상이 다릅니다
일반 체인은 같은 속성에 대해 여러 authorizer를 평가하고 첫 `Allow` 또는 `Deny`에서 멈춥니다
kubelet의 [`InstallAuthFilter`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/server/server.go)는 서로 다른 하위 리소스 속성을 순서대로 평가합니다

이렇게 기존 `nodes/proxy` 권한을 남겨야 예전 클라이언트가 계속 접근할 수 있습니다
기능을 활성화하는 것만으로 기존 역할의 권한이 줄어들지는 않습니다
접근 범위를 좁히려면 역할에 남은 넓은 `nodes/proxy` 권한도 함께 확인해야 합니다

한편 `/stats`·`/metrics`·`/logs`·`/checkpoint`·`/statusz`와 `/flagz`에는 이 `proxy` 폴백이 없습니다
특히 `/flagz`는 `configz` 하나로 묻고, `/debug/flags/v`는 `proxy`로 묻습니다
`ComponentFlagz`는 v1.36부터 beta·기본 활성 상태이며, 경로 설치 조건은 별도로 적용됩니다

## API 서버와 직접 접속한 클라이언트는 같은 규칙을 받습니다

kubeadm은 API 서버의 kubelet 클라이언트에게 내장 ClusterRole `system:kubelet-api-admin`을 연결합니다
확인한 역할의 기본 규칙은 다음과 같습니다

| 규칙 | 범위 |
|---|---|
| `get`·`list`·`watch` on `nodes` | Node 오브젝트 읽기 |
| `proxy` on `nodes` | 기존 `proxy` 동사 |
| `*` on `nodes/proxy`·`nodes/metrics`·`nodes/stats`·`nodes/log` | 각 하위 리소스 권한 |
| `*` on `nodes/pods`·`nodes/healthz`·`nodes/configz` | 세분화된 권한 |

`stats`·`metrics`·`log`를 따로 적는 이유는 이 경로들이 `proxy`로 폴백하지 않기 때문입니다
이름에 `admin`이 있어도 확인한 역할에는 `nodes/checkpoint`와 `nodes/statusz`가 없습니다
두 경로도 `proxy`로 묻지 않으므로 이 역할만으로 허용되지 않습니다

내장 역할을 정의하는 것과 특정 주체에 연결하는 것은 별개입니다
Kubernetes 기본 바인딩은 없고, kubeadm의 [`AllowAPIServerToAccessKubeletAPI`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kubeadm/app/phases/bootstraptoken/node/tlsbootstrap.go)가 `kube-apiserver-kubelet-client` 사용자에 대한 ClusterRoleBinding을 만듭니다

### metrics-server도 자기 신원으로 판정됩니다

metrics-server는 kubelet에 직접 접속하므로 두 번째 구간의 요청자는 metrics-server의 ServiceAccount입니다
API 서버의 kubelet 클라이언트 신원으로 바뀌는 경유 요청과 다릅니다

참고한 [metrics-server v0.9.0의 RBAC](https://github.com/kubernetes-sigs/metrics-server/blob/v0.9.0/manifests/base/rbac.yaml)은 메트릭 접근에 `get nodes/metrics`를 부여합니다
이 태그는 근거로 읽은 버전이며 실제 클러스터 설치 버전을 확인한 것은 아닙니다

| 메트릭 경로 | 필요한 kubelet 인가 리소스 |
|---|---|
| `/metrics/resource` | `nodes/metrics` |
| `/metrics/cadvisor` | `nodes/metrics` |
| `/stats/summary` | `nodes/stats` |

`nodes/proxy`만으로 `/stats/summary`에 접근할 수는 없습니다
반대로 `nodes/metrics`를 줬다고 컨테이너 실행 경로까지 허용되는 것도 아닙니다

### 읽기 전용 포트에는 인증·인가 필터가 없습니다

위 메트릭 핸들러는 이름이 `InstallAuthNotRequiredHandlers`인 함수에 등록됩니다
하지만 TLS 서버에서는 그 앞에 인증·인가 필터가 있으므로 함수 이름만 보고 인증이 필요 없다고 해석하면 안 됩니다

`readOnlyPort`가 0보다 크면 별도의 읽기 전용 서버가 동작합니다
이 서버는 `NewServer`에 인증 객체를 전달하지 않고, 인증 객체가 없으면 필터도 설치하지 않습니다
또한 TLS 없이 HTTP로 동작하며 위 세 경로와 `/pods`·`/healthz` 등을 제공합니다

따라서 읽기 전용 포트의 공개 여부는 HTTPS 포트의 RBAC 설정과 별도로 확인해야 합니다
`readOnlyPort: 0`은 이 별도 서버를 띄우지 않는 설정입니다

## Konnectivity는 TCP 연결 경로를 바꿉니다

Konnectivity는 API 서버의 나가는 연결을 터널로 전달하는 프록시입니다
API 서버와 노드가 직접 통신할 수 없는 망에서 접속 경로를 제공하며, 과거 SSH 터널의 대체 수단입니다

`--egress-selector-config-file`은 목적지를 `controlplane`·`etcd`·`cluster`로 나눕니다
kubelet용 transport는 `cluster` dialer를 조회하고, 있으면 그 연결 함수를 사용합니다
해당 목적지의 dialer가 없으면 기존 연결 함수를 유지합니다

바뀌는 것은 TCP 연결 경로입니다
터널을 거쳐도 클라이언트 인증서 검증과 `SubjectAccessReview`의 주체·권한은 그대로입니다
연결 가능 여부를 해결하는 설정이 kubelet 인가 권한까지 만들어 주지는 않습니다

### proxy API의 transport는 목적지 포트에 따라 다릅니다

API 서버에는 kubelet용과 별개의 프록시 transport가 있습니다
이 transport는 서버 인증서 검증을 끄고 클라이언트 인증서를 싣지 않습니다

| API 서버가 중계하는 요청 | 사용하는 transport |
|---|---|
| `nodes/proxy`, 포트 생략 또는 Node가 보고한 kubelet 포트와 일치 | kubelet transport, 설정한 클라이언트 인증서 사용 |
| `nodes/proxy`, 다른 포트 지정 | 별도 프록시 transport, 요청한 스킴·포트 사용 |
| `pods/proxy`·`services/proxy` | 별도 프록시 transport |

따라서 같은 `nodes/proxy` URL 계열에서도 다른 포트를 지목하면 상대가 받는 클라이언트 인증 조건이 달라집니다
`pods/proxy`를 HTTPS로 중계하더라도 이 transport가 대상 인증서를 검증하거나 kubelet 클라이언트 인증서를 전달하는 것은 아닙니다

[`CreateProxyTransport`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controlplane/apiserver/config.go)는 IP 기반 목적지에서 이름 검증을 기대할 수 없다는 이유로 이 설정을 만듭니다
공식 문서의 일반 프록시 통신 설명과 kubelet 기본 포트에 적용되는 별도 transport를 함께 읽어야 합니다

## 실패 응답에서는 주체·경로·연결을 나눠 봅니다

`kubectl logs`는 사용자 인가, Node 접속 정보 조회, 연결과 TLS, kubelet 인증·인가, 실제 로그 핸들러 중 어느 단계에서든 멈출 수 있습니다
다음 문구는 실측 로그가 아니라 소스의 오류 응답과 설정을 바탕으로 정리한 판별 기준입니다

| 단서 | 확인할 경계 |
|---|---|
| 사용자가 `pods/log`를 읽을 수 없다는 403 | API 서버가 판정한 사용자의 권한 |
| `Forbidden (user=..., verb=..., resource=nodes, subresource(s)=[proxy])` | kubelet이 판정한 API 서버 클라이언트의 `nodes/proxy` 권한 |
| 위 `user=`가 `kube-apiserver-kubelet-client` | kubeadm의 kubelet 클라이언트 신원. 원래 사용자 이름과 달라도 정상 |
| `nodes/log`가 있는데 `[proxy]`로 거절 | `/logs/`와 `/containerLogs/`의 경로 차이 |
| `[pods proxy]`가 함께 표시된 403 | `/pods` 계열의 두 속성이 모두 허용되지 않음 |
| 권한 부여 뒤에도 거절 | 이전 거절 캐시, 기본 30초와 API 서버 정책 반영 확인 |
| 권한 회수 뒤에도 통과 | 이전 허용 캐시, 기본 5분과 다른 허용 규칙 확인 |
| kubelet의 `401 Unauthorized` | 신원을 만들지 못함. 클라이언트 인증서·신뢰 CA·익명 인증 설정 확인 |
| `Authorization error (user=..., ...)`와 500 | 캐시로 처리하지 못한 인가 질의의 오류. kubelet에서 API 서버로의 접속·자격 증명 확인 |
| `no preferred addresses found` | Node 주소 타입과 `--kubelet-preferred-address-types`의 불일치 |
| `nodes/proxy`에서 `address not allowed` | proxy 경로의 주소 분류 검사. 모든 logs 요청에 공통 적용되는 검사는 아님 |
| 연결 시간 초과·접속 거절 | DNS·라우팅·방화벽·리스너·dialer를 구분 |
| 인증서 검증 실패 | API 서버의 kubelet CA와 kubelet 서빙 인증서의 신뢰·이름 확인 |
| `/logs/`에서 `logs endpoint is disabled.`와 405 | `enableSystemLogHandler: false` |
| `/containerLogs/`·`/exec/` 등에서 `Debug endpoints are disabled.`와 405 | `enableDebuggingHandlers: false` |
| `nodes/proxy`가 있는데 `/stats/summary`는 403 | `nodes/stats`는 `proxy` 폴백이 없음 |
| `/flagz`와 `/debug/flags/v`의 결과가 다름 | 전자는 `configz`, 후자는 `proxy`로 인가하며 설치 조건도 다름 |
| 인증 없이 메트릭을 읽을 수 있음 | 읽기 전용 HTTP 포트와 접근 경로 확인 |
| 노드 하나에서만 다르게 동작 | 해당 kubelet의 실제 설정·인증서·바인딩·캐시 확인 |

v1.37.1의 `--kubelet-timeout` 기본값은 5초이지만, 확인한 kubelet transport 구성과 로그 스트리밍 경로만으로 이 값을 TCP 다이얼의 5초 상한이라고 단정할 수는 없습니다
실제로 어느 단계의 시간 제한이 작동했는지는 사용 중인 경로와 dialer를 함께 확인해야 합니다

인가를 통과해도 핸들러가 꺼져 있으면 요청은 실패합니다
`enableDebuggingHandlers`를 끄면 `/run/`·`/exec/`·`/attach/`·`/portForward/`·`/containerLogs/`·`/runningpods/`·`/debug/pprof/`·`/logs/`가 비활성 응답을 냅니다
이 설정과 `enableSystemLogHandler`의 기본값은 모두 `true`입니다

반대로 권한을 급히 회수해야 하는 상황이라면 RBAC 수정만으로 충분한지부터 따져야 합니다
어느 kubelet에 어떤 신원으로 접근하는지, 캐시된 허용이 남아 있는지, 읽기 전용 포트 같은 별도 경로가 있는지가 함께 접근 경계를 정합니다

## 더 확인할 소스와 문서

- [주소·포트 선택, TLS transport, cluster dialer](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/client/kubelet_client.go), [주소 우선순위·CLI 기본값](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kube-apiserver/app/options/options.go)
- [경로에서 인가 속성을 만드는 `GetRequestAttributes`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/server/auth.go), [인가 필터·읽기 전용 서버·비활성 핸들러](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/server/server.go)
- [설정 API와 캐시 기본값](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/apis/config/v1beta1/defaults.go), [파일 로딩과 플래그 우선순위](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kubelet/app/server.go)
- [kubelet 세분화 인가의 GA 이력](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go), [ComponentFlagz·ComponentStatusz 이력](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-base/zpages/features/kube_features.go)
- [내장 kubelet API 역할의 실제 규칙](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/plugin/pkg/auth/authorizer/rbac/bootstrappolicy/policy.go), [kubeadm의 kubelet 클라이언트 인증서 정의](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kubeadm/app/phases/certs/certlist.go)
- [노드 proxy 주소 검사·transport 선택](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/node/strategy.go), [Pod proxy와 로그 URL 구성](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/pod/strategy.go), [로그 스트리밍 응답 구성](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/pod/rest/log.go)
- [Kubelet authentication/authorization 문서 저장본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/access-authn-authz/kubelet-authn-authz.md), [Konnectivity 설정 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/tasks/extend-kubernetes/setup-konnectivity.md), [egress selector 조회 구현](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/egressselector/egress_selector.go)
