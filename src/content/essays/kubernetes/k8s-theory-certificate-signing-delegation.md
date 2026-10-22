---
title: "인증서 발급과 사칭: API에 없는 리소스로 권한을 묻는 이유"
excerpt: "CSR 생성·자동 승인·서명의 권한을 구분하고 kubelet의 첫 인증서 발급과 갱신을 따라갑니다. signer별 인가와 요청별 impersonation, v1.37의 ConstrainedImpersonation이 검사하는 범위를 설명합니다"
category: "kubernetes"
tags: ["kubernetes", "certificates", "rbac", "impersonation", "concept"]
series:
  name: "k8s-theory-api"
  order: 17
date: "2026-10-23"
---

인증서를 발급받는 권한과, 다른 신원으로 요청하는 권한은 어떻게 표현할까요?
Kubernetes는 두 경우 모두 리소스 이름과 동사를 사용해 인가를 묻습니다
그중에는 실제 API 오브젝트나 조회 엔드포인트가 없는 이름도 있습니다

[인증](/essays/k8s-theory-authentication)에서는 자격증명이 요청자의 신원으로 바뀌는 과정을 봤습니다
이번에는 인증에 쓸 증거를 발급하는 과정과, 이미 인증한 요청에서 사용할 신원을 바꾸는 과정을 살펴봅니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## 인증서와 impersonation은 신원이 남는 범위가 다르다

인증서를 발급받으면 파일로 남은 인증서를 다음 요청의 자격증명으로 사용할 수 있습니다
impersonation은 자기 자격증명으로 먼저 인증한 뒤, 해당 요청에서 다른 신원을 사용하도록 서버에 요청하는 방식입니다
이 글에서는 이를 사칭이라고 부릅니다

| 경로 | 필요한 처리 | 결과가 적용되는 범위 |
|---|---|---|
| 인증서 발급 | 발급 요청 생성, 승인, CA 개인키로 서명 | 발급된 인증서를 사용하는 이후 연결·요청 |
| impersonation | 원래 호출자 인증, 사칭 권한 검사, 요청 신원 교체 | 사칭 헤더를 보낸 해당 요청 |

CA(Certificate Authority)는 인증서에 서명해 신뢰를 제공하는 인증 기관입니다
발급된 인증서를 신뢰할지는 인증서를 받는 서버의 CA 신뢰 설정에도 달려 있습니다
발급 요청이 승인됐다는 사실만으로 모든 서버에 접속할 수 있게 되는 것은 아닙니다

## CSR은 요청 내용과 요청자 신원을 함께 저장한다

CSR(CertificateSigningRequest)은 인증서 발급 요청을 저장하는 클러스터 범위의 API 오브젝트입니다
요청자가 지정하는 주요 `spec` 필드는 네 가지입니다

| 필드 | 의미 |
|---|---|
| `request` | X.509 CSR을 담은 `CERTIFICATE REQUEST` PEM 블록. JSON·YAML 직렬화에는 base64 인코딩이 한 겹 더 붙음 |
| `signerName` | 요청을 처리할 서명 주체인 signer의 이름 |
| `usages` | 요청하는 키 용도. TLS 클라이언트 인증서에는 보통 `digital signature`, `key encipherment`, `client auth` 사용 |
| `expirationSeconds` | 원하는 유효 기간. 최소 600초이며 실제 발급 기간은 signer 정책에도 달림 |

API 서버는 생성 시 요청 context의 신원으로 `username`·`uid`·`groups`·`extra`를 채웁니다
요청자가 이 필드에 다른 값을 보내도 생성 전략이 지우고 서버가 확인한 신원을 넣습니다
미리 승인한 상태로 생성할 수도 없도록 `status`를 초기화합니다

생성 뒤에는 `spec`이 불변입니다
승인자는 CSR에 기록된 요청자 신원과 인증서 요청 내용을 함께 검토할 수 있습니다
이 처리는 [`CertificateSigningRequestSpec`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/certificates/v1/types.go)과 [`PrepareForCreate`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/certificates/certificates/strategy.go)에서 확인할 수 있습니다

### 내장 signer는 이름과 API 버전을 함께 봐야 한다

`certificates.k8s.io/v1` CSR로 요청할 수 있는 내장 signer는 세 가지입니다

| signer | 인증서 용도 | 내장 자동 승인 |
|---|---|---|
| `kubernetes.io/kube-apiserver-client` | API 서버에 접속하는 클라이언트 | 없음 |
| `kubernetes.io/kube-apiserver-client-kubelet` | kubelet이 API 서버에 접속하는 클라이언트 | 조건을 만족하면 가능 |
| `kubernetes.io/kubelet-serving` | kubelet의 TLS 서버 | 없음 |

`kubernetes.io/legacy-unknown`이라는 네 번째 이름과 서명 컨트롤러 구현도 남아 있습니다
하지만 v1 CSR의 검증은 다음 오류로 이 이름을 거부합니다

```text
the legacy signerName is not allowed via this API version
```

이를 허용하던 `v1beta1` CSR 엔드포인트는 현재 서빙하지 않습니다
서명 구현이 남아 있다는 사실과, 그 이름의 CSR을 현재 API로 생성할 수 있다는 사실을 구분해야 합니다
근거는 [CSR 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/certificates/validation/validation.go), [서명 컨트롤러](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/certificates/signer/signer.go), [API 저장소 등록](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/certificates/rest/storage_certificates.go)입니다

내장 목록 밖의 `signerName`도 지정할 수 있습니다
다만 그 이름을 처리하는 컨트롤러가 없으면 인증서가 발급되지 않습니다
별도 signer는 CA 신뢰 배포, 허용 subject, X.509 확장, 키 용도, 유효 기간, CA 인증서 요청 허용 여부를 정해야 합니다

## CSR 생성, 자동 승인, 서명은 서로 다른 권한이다

새 노드가 처음 클라이언트 인증서를 받는 경로를 따라가면 각 권한의 역할이 드러납니다

![bootstrap token 인증과 CSR 생성, 요청자에 대한 자동 승인 자격 확인, 승인 기록과 서명 뒤 인증서 사용까지의 흐름|tall](/diagrams/k8s-theory-certificate-signing-delegation-1.svg)

CSR 생성 요청은 먼저 실제 `certificatesigningrequests`에 대한 `create` 인가를 통과해야 합니다
기본 `system:node-bootstrapper` ClusterRole에는 이 생성 권한과 `get`·`list`·`watch`가 있습니다
해당 역할이 존재해도 호출자에게 Binding으로 연결돼 있어야 권한을 얻습니다

CSR이 저장된 뒤에는 자동 승인 컨트롤러가 요청을 읽습니다
여기서 묻는 것은 이미 통과한 생성 권한과 다른 질문입니다

### 자동 승인 컨트롤러는 CSR의 요청자 권한을 되묻는다

`csrapproving`은 kubelet 클라이언트 인증서의 요청 형태를 알아보고, SubjectAccessReview로 요청자의 승인 자격을 확인합니다
SubjectAccessReview는 특정 신원에 특정 작업 권한이 있는지 authorizer에 묻는 API입니다
authorizer는 요청 속성과 정책을 받아 허용 여부를 판단하는 구성요소입니다

| 인식 규칙 | CSR에 기록된 요청자에게 묻는 권한 |
|---|---|
| kubelet 클라이언트 인증서 요청 | `certificatesigningrequests/nodeclient`에 `create` |
| 위 조건에 더해 요청자 이름과 CSR의 subject Common Name이 같은 요청 | `certificatesigningrequests/selfnodeclient`에 `create` |

`nodeclient`와 `selfnodeclient`는 자동 승인 자격을 표현하는 합성 subresource 이름입니다
실제로 POST할 수 있는 별도 엔드포인트는 없습니다
컨트롤러가 생성한 SubjectAccessReview에 이 이름을 넣는 것입니다

구현은 `selfnodeclient` 규칙을 먼저 시도하고, 승인되지 않으면 해당하는 `nodeclient` 규칙도 시도할 수 있습니다
따라서 첫 발급과 갱신을 설명하는 두 이름을, 서로 완전히 배타적인 실행 경로로 이해하면 안 됩니다

SubjectAccessReview에는 컨트롤러 자신의 신원 대신 CSR의 `username`·`uid`·`groups`·`extra`가 들어갑니다
요청을 알아봤어도 이 권한을 허용받지 못하면 승인·거절 조건을 쓰지 않고 요청을 남겨 둡니다
이때의 로그 판별 문구는 `subject access review was not approved`입니다
정확한 분기는 [`recognizers`·`sarApprover.handle`·`authorize`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/certificates/approver/sarapprove.go), 기본 역할은 [`ClusterRoles`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/plugin/pkg/auth/authorizer/rbac/bootstrappolicy/policy.go)에서 확인할 수 있습니다

### 승인 판단과 CA 키 사용을 나누는 권한

승인 결과는 CSR의 `/approval` subresource로 기록하고, 발급된 인증서는 `/status`의 `status.certificate`에 기록합니다
이 경로를 갱신할 일반 권한에 더해, admission plugin이 signer별 권한을 따로 검사합니다

| 처리 | 추가로 묻는 signer 권한 | 거부 문구 |
|---|---|---|
| `/approval` 갱신 | `approve` | `user not permitted to approve requests with signerName` |
| `/status`에서 인증서·조건 변경 | `sign` | `user not permitted to sign requests with signerName` |

`/status`의 인증서와 조건이 모두 그대로라면 서명 plugin은 추가 검사를 생략합니다
변경이 있는 경우에는 승인 plugin과 마찬가지로 **갱신 전 CSR의 `signerName`**을 기준으로 검사합니다
승인 요청에 다른 signer 이름을 섞어 검사 대상을 바꾸지 못하게 하려는 처리입니다

승인자는 요청이 정당한지 판단하고, 서명자는 CA 개인키로 인증서를 발급합니다
승인자가 CA 키를 가질 필요는 없으며, 내장 서명 컨트롤러도 승인되지 않은 요청을 서명하지 않습니다
`approve` 권한만 부여했다고 그 주체가 `/status`에 발급 결과를 쓸 수 있는 것은 아닙니다
이 분리는 [승인 plugin](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/plugin/pkg/admission/certificates/approval/admission.go)과 [서명 plugin](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/plugin/pkg/admission/certificates/signing/admission.go)에 구현돼 있습니다

## signers는 필드 조건을 리소스 이름 조건으로 바꾼다

RBAC은 API group·resource·verb·name 등의 속성으로 권한을 표현합니다
일반 RBAC 규칙에는 `spec.signerName` 값에 따라 허용하라는 필드 조건이 없습니다

그래서 승인·서명 코드는 authorizer에 직접 질문할 때 `signers`라는 합성 리소스 이름을 사용합니다
CSR의 `spec.signerName`을 이 질문의 리소스 `name`으로 옮깁니다
다음은 서명 권한 질문을 나타내는 속성이며, 실제 signer 오브젝트의 명세가 아닙니다

```yaml
group: certificates.k8s.io
resource: signers
verb: sign
name: kubernetes.io/kube-apiserver-client
```

`signers`의 REST 저장소는 없으므로 `kubectl get signers`로 조회할 수 없습니다
API 디스커버리에 없는 이름이어도, authorizer가 받는 권한 질문에는 사용할 수 있습니다

이름이 정확히 일치하는 권한으로 허용되지 않으면 `<도메인>/*`를 이름으로 한 번 더 묻습니다
예를 들어 `kubernetes.io/*`에 `sign`을 허용하면 이 helper를 사용하는 해당 도메인의 signer에 권한이 적용됩니다
이 와일드카드는 RBAC이 임의의 `resourceNames` 접두사를 해석하는 기능이 아니라, [`IsAuthorizedForSignerName`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/certauthorization/certauthorization.go)이 질문을 두 번 만드는 동작입니다

디스커버리에 없는 리소스의 권한을 조회할 때도 group·resource·name을 정확히 전달해야 합니다
확인한 kubectl의 `can-i`는 리소스 이름 해석이 실패하면 입력을 그대로 resource에 넣으므로, `signers/...` 한 줄을 signer별 admission 검사와 같은 질문이라고 가정할 수 없습니다
위 속성을 담은 SubjectAccessReview나 SelfSubjectAccessReview로 구분해 물어야 합니다
이 주의점은 [`CanIOptions.resourceFor`·`RunAccessCheck`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kubectl/pkg/cmd/auth/cani.go)에 근거합니다

## 첫 인증서 전에는 bootstrap token으로 인증한다

인증서를 발급받는 API도 인증이 필요합니다
bootstrap token은 kubelet이 첫 클라이언트 인증서를 받기 전 API에 접근하는 초기 자격증명입니다

토큰은 `kube-system` namespace의 `bootstrap-token-<token-id>` Secret에 저장합니다
Secret 타입은 `bootstrap.kubernetes.io/token`이며, 클라이언트는 `<token-id>.<token-secret>`을 bearer token으로 보냅니다
앞부분은 소문자·숫자 6자, 비밀 부분은 소문자·숫자 16자입니다

인증에는 형식 외에도 다음 조건이 필요합니다

- API 서버의 `--enable-bootstrap-token-auth` 활성화
- 토큰 ID·비밀과 Secret의 데이터 일치, 올바른 Secret 타입과 삭제 상태
- `usage-bootstrap-authentication` 값이 문자열 `"true"`
- `expiration`을 지정했다면 유효한 시각이며 아직 만료되지 않음
- `auth-extra-groups`를 지정했다면 허용된 bootstrap 그룹 형식 충족

인증된 사용자 이름은 `system:bootstrap:<token-id>`입니다
그룹은 `system:bootstrappers`와 `auth-extra-groups`에 지정한 그룹으로 구성됩니다
이 신원으로 실제 CSR 생성 인가를 통과하고, 저장된 요청의 자동 승인 자격도 별도로 허용받아야 합니다
토큰 형식은 [bootstrap token 상수](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cluster-bootstrap/token/api/types.go), 인증 조건은 [`AuthenticateToken`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/plugin/pkg/auth/authenticator/token/bootstrap/bootstrap.go)에 정의돼 있습니다

### 토큰 만료와 Secret 정리는 서로 다른 처리다

인증기는 Secret informer의 사본을 읽습니다
informer는 API의 변경을 받아 로컬 객체 사본을 유지하는 구성요소입니다
따라서 Secret 삭제가 인증 판정에 반영되려면 그 삭제를 인증기가 사용하는 사본도 알아야 합니다

반면 `expiration`은 인증기가 현재 시각과 직접 비교합니다
TokenCleaner가 아직 Secret을 삭제하지 않았어도 만료한 토큰은 이 인증 검사에서 거절합니다
만료 Secret의 자동 삭제에는 별도로 `tokencleaner` 컨트롤러가 필요합니다
이 구분은 [bootstrap token 공식 문서 저장본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/access-authn-authz/bootstrap-tokens.md)에서도 설명합니다

초기 자격증명을 토큰으로 관리하면 공유·전달 과정에서 노출됐을 때 Secret 삭제나 만료로 사용을 중단할 수 있습니다
다만 bearer token은 문자열을 가진 쪽이 사용할 수 있고 서버도 비밀을 보관하므로 수명을 짧게 관리해야 합니다

Kubernetes는 X.509 클라이언트 인증서의 개별 폐기를 지원하지 않습니다
이 제한은 [공식 인증 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/access-authn-authz/authentication.md)에도 명시돼 있습니다
인증서 만료 전의 대응에서는 서버의 CA 신뢰 제거와 RBAC 등 인가 변경을 구분해야 합니다
권한을 회수하는 일은 인증서 자체를 무효화하는 일과 다릅니다

## 갱신 시점과 발급 수명은 서로 다른 설정이다

kubelet의 `rotateCertificates`는 클라이언트 인증서 갱신을 활성화합니다
정상적인 주기 갱신에서는 인증서의 `NotBefore`부터 `NotAfter`까지 수명 중 약 70~90% 지점에 다음 갱신 시각을 분산시킵니다
같은 때 가입한 노드들이 이후에도 한꺼번에 갱신하지 않도록 jitter를 적용하는 것입니다

수명의 80% ± 10%는 갱신 시도 시점에 대한 설명입니다
인증서가 없거나 요청 템플릿과 맞지 않는 경우 등에는 즉시 갱신을 요구하는 분기도 있습니다
구현은 [`nextRotationDeadline`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/util/certificate/certificate_manager.go)에서 확인할 수 있습니다

발급 기간은 signer가 정합니다
내장 서명 컨트롤러의 `--cluster-signing-duration` 기본값은 365일이며, CSR은 `expirationSeconds`로 더 짧은 기간을 요청할 수 있습니다
내장 signer는 상한을 넘는 요청을 상한으로 제한하고, 그 아래의 유효한 요청 기간을 사용합니다

외부 signer까지 모두 같은 정책을 따른다고 보장하지는 않습니다
클라이언트는 발급된 인증서의 `notBefore`·`notAfter`로 실제 유효 기간을 확인해야 합니다
근거는 [기본값](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/certificates/signer/config/v1alpha1/defaults.go), [CLI 플래그](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kube-controller-manager/app/options/csrsigningcontroller.go), [`signer.duration`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/certificates/signer/signer.go)입니다

### kubelet 서빙 인증서는 별도 승인이 필요하다

`serverTLSBootstrap`은 kubelet이 자체 서명 대신 CSR API로 TLS 서버 인증서를 요청하도록 하는 설정입니다
`RotateKubeletServerCertificate` 기능도 활성화돼 있어야 합니다
이때의 signer는 `kubernetes.io/kubelet-serving`입니다

내장 자동 승인 컨트롤러는 이 요청을 승인하지 않습니다
설정만 켜고 승인자를 두지 않으면 서빙 인증서를 얻지 못한 채 CSR이 `Pending`에 머물 수 있습니다
요청 기능과 승인 기능을 각각 마련해야 합니다

클라이언트 인증서는 요청자 이름과 CSR의 subject를 비교할 수 있습니다
그러나 서빙 인증서는 특정 DNS 이름과 IP의 서버가 자신이라고 주장하므로, 승인자가 그 주소가 요청 노드에 속하는지도 확인해야 합니다
노드가 스스로 적은 주소만 다시 근거로 쓰면 그 주장 자체를 독립적으로 검증하지 못합니다

잘못 승인하면 클러스터 CA가 보증하는 다른 서버의 인증서를 발급할 수 있습니다
공식 문서가 서빙 인증서 승인에 요청자 신원·키 용도·DNS/IP 소유 확인을 요구하는 이유입니다
조건은 [`KubeletConfiguration`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kubelet/config/v1beta1/types.go)과 [TLS bootstrapping의 서빙 인증서 승인 절](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/access-authn-authz/kubelet-tls-bootstrapping.md)에 있습니다

## CA 신뢰 배포와 Pod 인증서 발급도 구분해야 한다

`ClusterTrustBundle`은 신뢰할 CA 묶음을 배포하는 API입니다
`ClusterTrustBundleProjection`은 그 신뢰 정보를 projected volume의 파일로 제공하는 기능입니다
`PodCertificateRequest`는 Pod가 사용할 인증서를 발급받는 별도 API입니다

세 기능은 v1.35에서는 beta·기본 off였지만, 이 글의 기준인 v1.37에서는 모두 GA·기본 on입니다
v1.37.1의 API 등록에는 `certificates.k8s.io/v1`의 `clustertrustbundles`와 `podcertificaterequests`도 포함됩니다
실제 제공 여부는 feature gate뿐 아니라 API resource 활성화 설정도 함께 따릅니다
이력과 분기는 [기능 정의](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go)와 [인증서 API 등록](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/certificates/rest/storage_certificates.go)에서 확인했습니다

`signers`에 사용하는 `attest`는 signer와 연결된 **ClusterTrustBundle의 신뢰 정보를 게시할 권한**을 검사하는 동사입니다
`signerName`이 있는 번들에 이 검사가 적용됩니다
신뢰 정보의 내용은 그대로이고 오브젝트 정리(GC, garbage collection)에 필요한 일부 필드만 바뀐 경우에는 검사를 생략하는 분기도 있습니다
PodCertificateRequest의 발급 결과를 변경하는 검사는 `attest`가 아니라 `sign`입니다
각각 [CTB attest plugin](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/plugin/pkg/admission/certificates/ctbattest/admission.go)과 [PCR status 전략](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/certificates/podcertificaterequest/strategy.go)에 구현돼 있습니다

## impersonation은 인증 후, 실제 작업의 인가 전에 적용된다

클라이언트는 자신의 자격증명과 사칭 헤더를 함께 보냅니다
API 서버는 원래 호출자를 인증하고, 그 호출자가 요청한 신원을 사용할 수 있는지 검사합니다
허용한 뒤 요청 context의 사용자 정보를 교체하므로 이후 실제 작업은 바뀐 신원으로 판단합니다

![원래 호출자 인증, 사칭 권한 판정과 신원 교체, 사칭된 신원을 사용하는 APF·실제 작업 인가·admission 순서|tall](/diagrams/k8s-theory-certificate-signing-delegation-2.svg)

| 헤더 | 지정하는 정보 |
|---|---|
| `Impersonate-User` | 사용할 사용자 이름 |
| `Impersonate-Group` | 사용할 그룹. 여러 번 지정 가능 |
| `Impersonate-Uid` | 사용할 UID |
| `Impersonate-Extra-<키>` | 사용자 정보의 extra 항목. 같은 키에 여러 값 가능 |

그룹·UID·extra만 보내고 사용자 이름을 빼면 잘못된 요청입니다
헤더 이름은 [인증 API의 상수](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/authentication/v1/types.go)에 정의돼 있습니다

신원을 바꾸기 전에 사칭 권한을 검사하지 않으면 누구나 다른 사용자의 권한을 쓸 수 있습니다
또 실제 작업을 원래 호출자의 신원으로 먼저 인가하면, 허용에 사용한 신원과 실행에 쓰는 신원이 달라집니다
그래서 사칭은 인증 뒤이면서 실제 작업의 인가 앞에 위치합니다

[APF](/essays/k8s-theory-api-priority-fairness)도 사칭 뒤에 실행됩니다
APF는 요청을 분류하고 우선순위 수준별 동시 처리 용량을 배정하는 단계입니다
사칭 권한 검사 자체는 APF 진입 전에 끝나고, 그 뒤 요청은 사칭된 신원으로 분류돼 해당 수준의 용량을 사용합니다
필터 순서는 [`DefaultBuildHandlerChain`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/config.go)에 있습니다

### 기존 impersonate 권한은 대상 속성별로 나뉜다

기존 `impersonate` 동사를 사용하는 경로는 다음 이름들로 권한을 묻습니다

| 대상 | API group / resource | 이름과 범위 |
|---|---|---|
| 사용자 | core / `users` | 사용자 이름 |
| 그룹 | core / `groups` | 요청한 각 그룹 이름 |
| ServiceAccount | core / `serviceaccounts` | namespace와 ServiceAccount 이름 |
| UID | `authentication.k8s.io` / `uids` | UID 값 |
| extra | `authentication.k8s.io` / `userextras/<키>` | 해당 키의 각 값 |

`users`·`groups`·`uids`·`userextras`는 여기서 인가를 위해 사용하는 이름입니다
`serviceaccounts`는 실제 namespaced core 리소스 이름을 재사용합니다
하지만 확인한 사칭 구현은 ServiceAccount 객체를 조회하지 않고, 이름에서 분리한 namespace와 이름으로 인가를 묻습니다
사칭 권한 허용은 그 ServiceAccount 객체의 존재 확인과 다른 질문입니다

기존 경로에서 사용자 하나와 명시한 그룹 둘을 사칭하면 각각의 대상에 대한 인가가 필요합니다
하나라도 허용되지 않으면 이 경로로 사칭할 수 없습니다
ServiceAccount 사칭 권한을 namespace에 한정해 부여해도, 그 신원이 실제로 수행할 작업의 범위까지 같은 namespace로 제한되는 것은 아닙니다

익명이 아닌 사용자를 사칭하면 명시한 그룹이 있더라도 `system:authenticated`를 보충합니다
이미 그 그룹이 있거나 `system:unauthenticated`를 지정한 경우는 제외합니다
ServiceAccount에 그룹을 따로 지정하지 않으면 고정된 ServiceAccount 그룹들도 보충합니다
기존 구현과 현행 호환 경로의 근거는 [`WithImpersonation`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/filters/impersonation/impersonation.go)과 [`legacyImpersonationMode`·`impersonationModeState`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/filters/impersonation/mode.go)입니다

### v1.37 기본 경로는 사칭할 작업도 제한할 수 있다

`ConstrainedImpersonation`은 v1.35 alpha·기본 off로 시작했지만 v1.36부터 beta·기본 on입니다
v1.37의 기본 필터는 기존 `impersonate` 규칙과 호환되는 경로를 유지하면서, 신원과 작업 범위를 함께 제한하는 방식도 지원합니다

일반 사용자의 경우 필요한 권한은 다음 두 종류입니다

- `authentication.k8s.io`의 사용자·그룹 등 대상에 대한 `impersonate:user-info`
- 실제 요청의 리소스와 범위에 대한 `impersonate-on:user-info:<verb>`

예를 들어 Pod 목록 요청에서는 두 번째 동사의 `<verb>`가 `list`가 됩니다
사칭 대상이 그 작업을 할 수 있어도, 호출자에게 해당 범위의 `impersonate-on:user-info:list`가 없으면 이 제한 방식으로는 허용되지 않습니다
두 질문은 원래 호출자에게 하며, 통과한 뒤에도 실제 작업은 사칭된 신원의 일반 인가를 통과해야 합니다

ServiceAccount에는 `serviceaccount`, Node에는 `arbitrary-node`·`associated-node` 모드가 있습니다
이 모드에서는 사용자 이름만 요청하고 나머지 신원 속성은 서버가 정합니다
`associated-node`는 호출자인 ServiceAccount 신원 정보의 Node 연결 관계도 확인합니다

제한 방식이 실패하더라도 기존 `impersonate` 권한 경로로 허용될 수 있습니다
따라서 넓은 기존 권한을 그대로 남겨 둔 채 제한 권한을 추가하는 것만으로 사칭 범위가 좁아지지는 않습니다

공식 문서는 제한 방식을 먼저 시도하고 기존 방식으로 이어진다고 설명합니다
실제 구현은 마지막에 성공한 모드를 먼저 시도할 수 있고, 제한 방식의 성공 결과에는 짧은 캐시도 있습니다
기존 경로의 대상별 검사 수를 모든 v1.37 사칭 요청의 authorizer 호출 수로 일반화할 수 없는 이유입니다
기본값은 [gate 정의](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/features/kube_features.go), 판정은 [`WithConstrainedImpersonation`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/filters/impersonation/constrained_impersonation.go)와 [`constrainedImpersonationModeState.check`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/filters/impersonation/mode.go)에 근거합니다

### 후속 admission에는 어떤 신원이 보이나

사칭 필터는 후속 처리에 넘기기 전에 사칭 헤더를 제거합니다
현행 constrained 구현은 헤더를 읽어 원하는 신원을 만든 직후 제거하고, 권한 검사 뒤 실제 context를 교체합니다
성공한 사칭은 요청 로그와 audit의 사칭 신원 정보에 기록합니다

admission webhook의 `userInfo`에는 바뀐 신원이 전달됩니다
기본 AdmissionReview의 이 필드만으로는 원래 호출자나 사칭 사용 여부를 알 수 없습니다
사칭을 허용한 권한 정책과, 원래 호출자·사칭 신원을 보존하는 audit를 함께 봐야 하는 경계입니다
이 처리는 [`processImpersonationHeaders`·`ServeHTTP`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/filters/impersonation/constrained_impersonation.go)에서 확인할 수 있습니다

### --as도 서버의 실제 사칭 검사부터 통과해야 한다

`kubectl auth can-i --as=someone`은 클라이언트가 다른 사용자의 권한을 대신 계산하는 기능이 아닙니다
`Impersonate-User` 헤더를 붙여 서버에 SelfSubjectAccessReview를 보냅니다
따라서 그 API 요청을 `someone`으로 보낼 사칭 권한부터 필요합니다

제한 사칭만 허용했다면 실제 Pod 요청과 SelfSubjectAccessReview 생성은 서로 다른 작업입니다
Pod 조회의 제한 사칭 권한만으로 `can-i --as`의 review 생성까지 허용된다고 가정하면 안 됩니다
review 요청을 통과한 뒤 답하는 대상도 인가이며, [앞서 본 can-i의 경계](/essays/k8s-theory-authorization)처럼 admission까지 실행해 보는 것은 아닙니다
요청 생성은 [`RunAccessCheck`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kubectl/pkg/cmd/auth/cani.go), 사칭 헤더의 의미는 [공식 문서 저장본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/access-authn-authz/user-impersonation.md)에 설명돼 있습니다

## 멈춘 지점에 따라 확인할 권한도 달라진다

| 증상 | 확인할 지점 |
|---|---|
| bootstrap token으로 인증하지 못함 | 인증기 활성화, Secret 위치·이름·타입, 토큰 데이터, 용도·만료·그룹 조건 |
| 인증됐지만 CSR 생성이 403 | 실제 `certificatesigningrequests`의 `create` 권한 |
| kubelet 클라이언트 CSR이 계속 `Pending` | 요청 인식 조건과 `nodeclient`·`selfnodeclient` SubjectAccessReview 결과 |
| `kubelet-serving` CSR이 `Pending` | 내장 자동 승인이 없으므로 별도 승인자 필요 |
| 승인됐지만 인증서가 없음 | signer 컨트롤러·CA 설정, 요청 검증 결과, `/status` 변경 및 signer `sign` 권한 |
| 승인·서명 API 갱신이 403 | 해당 subresource 일반 갱신 권한과 signer별 `approve`·`sign`을 구분 |
| `legacy-unknown` 요청이 거부됨 | v1 CSR 검증에서 금지한 signer 이름 |
| `signers`를 조회할 수 없음 | 조회 엔드포인트가 없는 합성 인가 이름 |
| `--as` 요청이 403 | 원래 호출자의 사칭 권한, 제한 방식이면 해당 요청의 `impersonate-on` 범위도 확인 |
| 사용자 사칭은 되는데 그룹 사칭은 실패 | 명시한 그룹별 권한과 제한 방식의 그룹 허용 조건 |
| webhook에는 원래 호출자가 안 보임 | 사칭 필터가 context를 바꾸고 헤더를 제거함. 원래 호출자와 사칭 신원은 audit에서 확인 |

CSR이 `Pending`이라는 상태만으로 인가 실패를 확정할 수는 없습니다
인식하지 못하는 요청, 자동 승인이 없는 signer, 요청자의 승인 자격 부족을 구분해야 합니다
마찬가지로 사칭 권한의 허용과 사칭된 신원의 실제 작업 허용도 각각의 판단입니다
