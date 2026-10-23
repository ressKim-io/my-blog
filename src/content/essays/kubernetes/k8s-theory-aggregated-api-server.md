---
title: "Aggregated API server — 경로 위임과 장애의 범위"
excerpt: "APIService가 요청 경로를 확장 서버에 맡기는 과정부터 TLS와 신원 전달, discovery 부분 실패가 Namespace 삭제를 막는 조건, metrics-server의 메모리 저장까지 살펴봅니다"
category: "kubernetes"
tags: ["kubernetes", "api-aggregation", "apiservice", "metrics-server", "concept"]
series:
  name: "k8s-theory-extension"
  order: 5
date: "2026-11-07"
---

Kubernetes에 새 API를 추가하는 방법은 CRD만 있는 것이 아닙니다
Aggregated API server는 API 경로의 처리를 별도 서버에 맡기며, 그 서버가 응답과 저장 방식을 구현합니다

클라이언트는 계속 kube-apiserver에 요청합니다
하지만 등록한 경로 뒤에는 네트워크 연결과 별도 서버가 있으므로, 확장 서버의 장애가 API 목록 조회와 Namespace 삭제에도 영향을 줄 수 있습니다

아래 설명은 Kubernetes v1.37.1 소스를 기준으로 합니다
metrics-server는 현재 릴리스 v0.9.0을 따로 확인했으며, 이 릴리스가 의존하는 Kubernetes 라이브러리는 v0.36.2입니다

## APIService는 그룹과 버전의 처리 경로를 등록합니다

`apiregistration.k8s.io/v1`의 `APIService`는 하나의 그룹·버전을 누가 처리할지 등록하는 클러스터 범위 객체입니다
이름은 `<version>.<group>`이며, 원격 서버가 처리하는 일반적인 경로는 `/apis/<group>/<version>`과 그 하위 경로입니다

| 필드 | 정하는 내용 |
|---|---|
| `group`, `version` | 처리할 API 그룹과 버전 |
| `service` | 원격 서버의 Service 참조이며, 없으면 로컬 처리 체인에 위임 |
| `service.port` | 연결할 Service 포트이며 생략 시 443 |
| `caBundle` | 확장 서버의 서버 인증서를 검증할 CA이며, 생략 시 시스템 신뢰 루트 사용 |
| `insecureSkipTLSVerify` | 확장 서버의 TLS 인증서 검증 생략 여부 |
| `groupPriorityMinimum` | Discovery에서 그룹을 정렬할 우선순위 |
| `versionPriority` | 같은 그룹 안에서 버전을 정렬할 우선순위 |

`service`가 없는 등록까지 모두 외부 프록시로 읽으면 안 됩니다
핸들러는 이 경우 다음 로컬 처리기로 요청을 넘깁니다. 코어 API의 `/api` 경로에는 별도 처리가 있습니다

우선순위 값은 클수록 앞섭니다
그룹은 해당 그룹 등록들이 가진 가장 높은 `groupPriorityMinimum`에 따라 배치되며, 값이 같으면 APIService 이름을 비교합니다

그룹 안에서는 `versionPriority`를 먼저 비교합니다
동률이면 Kubernetes 형식의 버전 문자열을 비교해 GA, beta, alpha 등의 순서를 정합니다
정렬 결과는 discovery 선호 버전에 영향을 주지만 모든 클라이언트의 자원 이름 해석을 보장하지는 않습니다

등록만으로 서버가 생기거나 API 구현이 완성되는 것은 아닙니다
별도 서버의 배포, HTTPS 연결, 인증·인가와 discovery 응답을 함께 갖춰야 합니다

## 프록시는 인증 결과를 신뢰할 수 있는 헤더로 전달합니다

![사용자 인증 후 프록시 인증서와 신원 헤더로 확장 서버에 요청을 전달하는 과정|tall](/diagrams/k8s-theory-aggregated-api-server-1.svg)

사용자의 요청은 먼저 kube-apiserver의 인증과 인가를 거칩니다
원격 APIService의 프록시 핸들러는 요청 경로와 쿼리를 유지해 확장 서버로 넘깁니다

이때 kube-apiserver는 `--proxy-client-cert-file`과 `--proxy-client-key-file`의 클라이언트 인증서로 자신을 증명합니다
확장 서버는 이 프록시를 신뢰할 수 있는지 확인한 뒤 전달된 사용자 신원을 읽습니다

| 기본 전달 헤더 | 담기는 정보 |
|---|---|
| `X-Remote-User` | 인증된 사용자명 |
| `X-Remote-Uid` | 조건을 충족할 때 전달하는 사용자 UID |
| `X-Remote-Group` | 그룹별로 반복되는 값 |
| `X-Remote-Extra-*` | 추가 속성 키별로 반복되는 값 |

프록시의 `SetAuthProxyHeaders`는 기존 사용자·UID·그룹 헤더와 추가 속성 헤더를 지운 뒤 인증 결과로 다시 채웁니다
인증 필터는 인증에 성공한 요청의 `Authorization`도 제거합니다. 이 경로를 원래 토큰을 그대로 확장 서버에 넘기는 방식으로 설명하면 맞지 않습니다

v1.37.1에서 `RemoteRequestHeaderUID`는 기본 활성인 Beta 기능입니다
이 기능이 켜져 있고 사용자 정보에 UID가 있을 때 UID 헤더가 전달됩니다

확장 서버가 확인하는 것은 프록시 인증서의 서명 CA와 허용된 CN입니다
보통 `kube-system/extension-apiserver-authentication` ConfigMap에서 설정을 읽습니다
여기에는 requestheader CA, 허용 CN, 헤더 이름이 담깁니다

여기에는 두 방향의 신뢰가 있습니다
APIService의 `caBundle`은 **kube-apiserver가 확장 서버를 검증**하는 데 쓰입니다
requestheader CA는 **확장 서버가 신원을 전달한 프록시를 검증**하는 데 쓰입니다

일반 클라이언트용 `--client-ca-file`과 프록시 신뢰용 `--requestheader-client-ca-file`도 구분해야 합니다
둘을 같은 CA로 구성하면 보통 사용자 인증서가 헤더 인증 경로에 걸려 CN 검사에서 실패하거나, 허용 CN 조건에 따라 헤더 신원을 주장할 수 있는 위험이 생깁니다

CA가 같다는 사실만으로 모든 인증서에 위조 권한이 생기는 것은 아닙니다
허용 CN을 통과하는지, 허용 목록을 비워 모든 CN을 받는지도 함께 봐야 합니다

### 확장 서버도 원래 사용자의 권한을 확인합니다

프록시 인증서는 요청을 보낸 서버를 증명합니다
그것만으로 헤더에 담긴 사용자가 해당 자원을 조작할 권한까지 얻는 것은 아닙니다

표준 위임 인가 구성에서는 확장 서버가 kube-apiserver에 `SubjectAccessReview`를 요청합니다
이 요청에는 원래 사용자의 신원과 수행하려는 작업이 담깁니다

설정 ConfigMap을 읽는 권한과 인가를 위임하는 권한은 다릅니다
공식 구성 문서는 전자에 `extension-apiserver-authentication-reader` Role을 안내합니다
후자에는 `system:auth-delegator` ClusterRole을 안내합니다

구현에는 허용 그룹·경로 예외와 허용·거절 결과 캐시도 있습니다
따라서 모든 요청마다 새 SAR 호출이 반드시 발생한다고 단정할 수 없습니다

이 동작은 확장 서버가 구현하고 설정해야 합니다
APIService가 등록됐다는 이유만으로 모든 서버가 같은 위임 인증·인가 구성을 제공하는 것은 아닙니다

## Available은 별도 컨트롤러가 검사합니다

원격 APIService의 상태는 가용성 컨트롤러가 갱신합니다
v1.37.1의 일반 ClusterIP Service 경로에서는 Service와 지정 포트, EndpointSlice를 확인한 뒤 discovery 요청을 검사합니다

EndpointSlice 검사에서 Ready는 `true`뿐 아니라 값이 없는 경우도 통과할 수 있습니다
같은 Slice 안에 이 조건을 만족하는 endpoint와 Service 포트 이름에 맞는 포트 항목이 있어야 하며, 그 항목의 실제 포트 값이 비어 있으면 통과하지 못합니다

이 검사를 단순히 “Pod가 하나라도 있으면 정상”으로 줄일 수는 없습니다
지정한 Service 포트가 없거나 포트 이름이 맞지 않는 경우도 실패 원인입니다

| `Available`의 reason | 확인한 경계 |
|---|---|
| `ServiceNotFound` | 참조한 Service 없음 |
| `ServicePortError` | ClusterIP Service에 지정 포트 없음 |
| `EndpointsNotFound` | 대응하는 EndpointSlice 목록이 비어 있음 |
| `MissingEndpoints` | Ready 조건과 포트 조건을 만족하는 Slice를 찾지 못함 |
| `ServiceAccessError`, `EndpointsAccessError` | 조회 실패로 상태가 `Unknown` |
| `FailedDiscoveryCheck` | 주소 해석·접속·시간초과·HTTP 응답 등의 discovery 검사 실패 |
| `Passed` | 가용성 검사 통과 |

Discovery 검사는 `/apis/<group>/<version>`에 요청하며, 다섯 작업을 병렬로 실행해 하나만 성공해도 통과합니다
검사 HTTP 클라이언트의 timeout은 5초이고 리다이렉트를 따라가지 않으며, 성공 상태는 200~299입니다

HTTP 요청을 감싼 대기에는 별도로 6초 제한이 있습니다
주소를 구하는 처리는 그 대기 구문 앞에도 있으므로, 이 수치를 전체 검사나 사용자 요청의 보편적인 최대 지연으로 읽으면 안 됩니다

검사는 `system:kube-aggregator` 사용자와 `system:masters` 그룹 헤더를 사용합니다
응답 본문의 API 구현을 모두 검증하거나 일반 사용자의 권한을 시험하는 검사는 아닙니다

v1.37.1에서는 이 검사와 실제 프록시가 같은 `BuildTransportConfig`를 사용합니다
`caBundle`, `insecureSkipTLSVerify`, `<service>.<namespace>.svc` 서버 이름과 프록시 클라이언트 인증서가 두 경로에 반영됩니다

`Available=True`는 최근 상태 검사 결과입니다
그 뒤에 서버가 고장 나거나 개별 자원 요청이 실패할 수 있으며, 인증된 사용자에게 접근 권한이 없을 수도 있습니다

일반 원격 프록시 경로는 `Available`이 참이 아니면 연결 전에 503을 반환합니다
상태가 참이어도 주소 해석이나 프록시 통신이 실패하면 503이 발생할 수 있으므로 같은 상태 코드만으로 원인을 하나로 좁히지 않습니다

## 등록 목록과 실제 자원 목록은 다릅니다

기존 형식의 `GET /apis` 목록은 APIService 등록을 바탕으로 그룹을 구성합니다
이 목록을 만드는 코드는 `Available`이 거짓이라는 이유만으로 등록을 빼지 않습니다

그래서 그룹 이름은 보이는데 해당 그룹·버전의 요청은 503을 반환하는 상태가 가능합니다
등록이 남아 있다는 사실과 그 API를 현재 읽을 수 있다는 사실은 다릅니다

현행 aggregated discovery는 그룹·버전·자원 정보를 모아 응답하는 별도 경로입니다
서비스별 캐시와 ETag를 사용하고, 갱신 결과를 `Current` 또는 `Stale`로 표시합니다

캐시가 새 등록 상태보다 최신이면 재사용하며, 갱신 요청에는 5초 `TimeoutHandler`를 적용합니다
응답 형식에 따라 기존 그룹·버전 discovery로 대체 조회하기도 합니다

실패했다고 항상 이전 자원 목록을 그대로 제공하는 것은 아닙니다
예를 들어 503을 받는 분기는 캐시 결과 대신 `nil`과 오류를 반환하고, 집계 문서에는 자원이 없는 버전과 `Stale`이 들어갈 수 있습니다

client-go는 `Stale` 버전을 실패한 그룹·버전으로 분리합니다
이 때문에 다른 그룹의 결과가 있어도 “전체 목록을 완전히 얻지 못했다”는 오류가 함께 전달될 수 있습니다

### OpenAPI는 다시 별도의 집계 경로입니다

Discovery는 어떤 자원이 있는지를 알려주고, OpenAPI는 API의 스키마 등을 제공합니다
Aggregator는 OpenAPI v2 문서를 내려받아 캐시·병합하고, v3에서는 루트 문서의 경로 정보를 모아 그룹·버전 문서 요청을 연결합니다

v2 다운로드와 v3 루트 다운로드의 제한은 각각 1분입니다
이는 앞의 가용성 검사 5초나 aggregated discovery 갱신 5초와 다른 설정이며, 모든 일반 API 프록시 요청에 적용되는 공통 제한이 아닙니다

캐시된 설명이 남아 있어도 실제 자원 요청의 성공까지 보장하지는 않습니다
`Available`, discovery 갱신, OpenAPI 갱신과 실제 자원 요청을 나누어 확인해야 합니다

## Discovery 부분 실패는 Namespace 삭제 완료를 막을 수 있습니다

Namespace 삭제 컨트롤러는 지워야 할 자원 종류를 discovery로 알아냅니다
확장 API를 포함한 전체 목록을 얻지 못하면, 알아낸 자원을 일부 삭제하더라도 모든 내용을 정리했다고 판단할 수 없습니다

![Discovery 오류를 기록하면서 알아낸 자원을 삭제하고 오류가 남으면 Namespace finalize를 보류하는 흐름|tall](/diagrams/k8s-theory-aggregated-api-server-2.svg)

v1.37.1 코드는 discovery 오류를 모으고 상태에 기록하면서 가능한 삭제를 이어 갑니다
다만 알아낸 자원 목록에 Pod가 있다면 먼저 Pod를 삭제하며, Pod가 남아 있으면 다른 종류의 삭제를 미룹니다

발견한 다른 자원을 처리하는 중에도 오류를 모아 함께 반환합니다
호출자는 이 오류를 받으면 자신의 Namespace finalizer를 정리하는 `finalizeNamespace`로 진행하지 않습니다

**부분적으로 삭제하는 것과 삭제 완료를 선언하는 것은 다릅니다**
불완전한 목록만 보고 완료 처리하면 확인하지 못한 타입의 객체가 남을 수 있기 때문입니다

다만 `Terminating`만 보고 확장 API 장애를 원인으로 단정해서는 안 됩니다
Namespace condition을 통해 목록 조회 실패와 실제 내용·finalizer 잔존을 구분합니다

| Namespace condition | 나타내는 문제 |
|---|---|
| `NamespaceDeletionDiscoveryFailure` | 자원 종류 목록 조회 실패 |
| `NamespaceDeletionGroupVersionParsingFailure` | 얻은 그룹·버전 목록 해석 실패 |
| `NamespaceDeletionContentFailure` | 자원을 삭제하는 과정의 실패 |
| `NamespaceContentRemaining` | 삭제할 객체가 남아 있음 |
| `NamespaceFinalizersRemaining` | 남은 객체에 finalizer가 있음 |

이 상태들은 함께 나타날 수도 있습니다
사용자 인가 거절과 확장 서버의 SAR 호출 실패 역시 같은 오류라고 보장되지 않으며, 확장 서버의 401도 ConfigMap 읽기 실패 하나로 설명할 수는 없습니다

## CRD 대신 별도 서버가 필요한 경계

CRD는 Kubernetes API 서버의 저장 경로를 사용합니다
스키마나 conversion webhook을 바꿔도 자원 저장 방식을 메모리 캐시나 다른 데이터베이스로 교체하는 기능은 아닙니다

공식 비교 문서는 다른 저장소 사용, Protobuf와 strategic merge patch 지원을 별도 API 서버의 영역으로 구분합니다
`logs`·`exec` 같은 추가 subresource와 다른 이름 규칙도 포함됩니다
실제로 무엇을 지원하는지는 확장 서버 구현마다 확인해야 합니다

여기서 추가 subresource를 “새로운 verb”로 설명하면 범위가 넓어집니다
kube-apiserver의 일반 자원 요청은 아래 verb로 분류합니다
`create`, `get`, `update`, `patch`, `delete`, `list`, `watch`, `deletecollection`입니다

경로 접두사에는 `proxy`와 `watch`의 특수 처리가 있습니다

새 subresource를 만들면 RBAC에는 `<resource>/<subresource>`가 나타나고 요청은 기존 verb로 분류됩니다
`pods/exec`의 POST가 `create`, GET이 `get`으로 분류되는 방식입니다
이 설명이 `bind`·`escalate` 같은 추가 인가 검사의 verb까지 제한하지는 않습니다

선언적 상태를 저장하고 컨트롤러가 맞춰 가는 API라면 CRD가 제공하는 기능을 활용할 수 있습니다
동기 작업 응답이나 별도 저장·읽기 방식이 필요하다면 확장 서버의 구현과 운영 부담까지 비교해야 합니다

## Metrics-server는 측정값을 메모리에 둡니다

`metrics.k8s.io`는 metrics-server가 제공하는 aggregated API의 예입니다
클러스터에 metrics-server 또는 대체 adapter를 배포해야 사용할 수 있으며, Kubernetes API 서버가 측정값을 기본 제공하는 것은 아닙니다

v0.9.0의 서버는 백그라운드 수집 루프에서 kubelet 측정값을 모아 `storage.Store`로 저장합니다
Node와 Pod 저장소는 프로세스 메모리의 `last`·`prev` 맵을 사용합니다

API 조회는 저장된 표본으로 사용량을 계산합니다
요청이 들어올 때마다 새 kubelet 수집을 수행하는 구조가 아닙니다

CPU 사용량은 누적 CPU 값의 차이를 표본 시간 차이로 나눠 계산합니다
메모리는 최근 표본의 working set 값을 사용합니다. 유효한 표본이 없거나 컨테이너 시작·재시작 등의 조건을 만족하지 못하면 결과에서 빠질 수 있습니다

따라서 “최신값 하나만 남긴다”거나 “조회에서는 계산하지 않는다”는 설명은 이 구현과 맞지 않습니다
최근·이전 표본의 보관은 CPU 계산을 위한 것이며 장기 시계열 저장 기능을 뜻하지도 않습니다

`--metric-resolution`의 코드 기본값은 60초입니다
같은 릴리스의 기본 Deployment에는 `--metric-resolution=15s`가 있으므로 배포 인자가 기본값을 바꿉니다

옵션 검증은 수집 간격을 최소 10초로 제한하고, kubelet 요청 timeout이 그 간격의 90% 이하인지도 확인합니다
이 값은 측정값의 보관 기간이나 모든 설치 환경의 실제 수집 간격을 뜻하지 않습니다

측정값을 CR로 저장하는 시스템을 만들 수는 있습니다
하지만 그 경우 etcd 쓰기와 watch 등 Kubernetes 저장 경로를 사용하며, 측정값을 메모리에서 읽는 metrics-server의 구현과 비용이 같지는 않습니다

별도 서버는 저장·읽기 방식을 고를 수 있는 대신 배포, 가용성, TLS와 위임 인증·인가를 운영해야 합니다
APIService의 등록은 그 서버를 Kubernetes의 요청·목록 경로에 연결하는 시작점입니다

## 확인한 근거

- [API aggregation 개념](https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/apiserver-aggregation/)과 [aggregation 인증·인가 구성](https://kubernetes.io/docs/tasks/extend-kubernetes/configure-aggregation-layer/)
- [APIService 필드 정의](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kube-aggregator/pkg/apis/apiregistration/v1/types.go), [경로 등록](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kube-aggregator/pkg/apiserver/apiserver.go), [프록시 처리](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kube-aggregator/pkg/apiserver/handler_proxy.go)
- [원격 가용성 검사와 TLS 설정](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kube-aggregator/pkg/controllers/status/remote/remote_available_controller.go), [discovery 집계](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kube-aggregator/pkg/apiserver/handler_discovery.go)
- [OpenAPI v2 집계](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kube-aggregator/pkg/controllers/openapi/aggregator/aggregator.go), [OpenAPI v3 집계](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kube-aggregator/pkg/controllers/openapiv3/aggregator/aggregator.go), [Namespace 삭제](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/namespace/deletion/namespaced_resources_deleter.go)
- [CRD와 별도 API 서버의 비교](https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/custom-resources/), [Resource metrics 파이프라인](https://kubernetes.io/docs/tasks/debug/debug-cluster/resource-metrics-pipeline/)
- [metrics-server v0.9.0 저장소](https://github.com/kubernetes-sigs/metrics-server/tree/2a7c4b2c7d46552ff47f4aeaa3a735c582587ecd/pkg/storage), [옵션 기본값·검증](https://github.com/kubernetes-sigs/metrics-server/blob/2a7c4b2c7d46552ff47f4aeaa3a735c582587ecd/cmd/metrics-server/app/options/options.go), [배포 인자](https://github.com/kubernetes-sigs/metrics-server/blob/2a7c4b2c7d46552ff47f4aeaa3a735c582587ecd/manifests/base/deployment.yaml)
