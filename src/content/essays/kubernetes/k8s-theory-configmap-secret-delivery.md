---
title: "ConfigMap과 Secret 전달 — 환경 변수와 볼륨 파일의 갱신 경계"
excerpt: "kubelet이 설정을 env 문자열과 볼륨 파일로 전달하는 경로를 비교합니다. AtomicWriter와 subPath, 변경 감지와 immutable, Secret의 저장 매체·권한, projected volume과 EnvFiles의 조건을 살펴봅니다"
category: "kubernetes"
tags: ["Kubernetes", "ConfigMap", "Secret", "Volume", "EnvironmentVariables", "concept"]
series:
  name: "k8s-theory-node"
  order: 11
date: "2026-10-23"
---

ConfigMap을 바꿨는데 애플리케이션이 이전 값을 사용한다면 먼저 전달 경로를 확인해야 합니다
환경 변수는 컨테이너 생성 때 문자열로 확정하지만, 일반 볼륨 파일은 실행 중에도 kubelet이 다시 투영할 수 있습니다
같은 오브젝트를 참조해도 새 값을 읽는 시점은 다릅니다

볼륨 역시 파일 하나를 `subPath`로 마운트했는지, 프로세스가 파일을 다시 여는지에 따라 결과가 달라집니다
API 오브젝트 변경부터 컨테이너가 새 내용을 읽기까지의 경계를 나눠 보겠습니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## 환경 변수는 생성 때 복사하고 볼륨은 다시 투영합니다

ConfigMap은 설정을 키와 값으로 보관하는 API 오브젝트입니다
Secret도 키와 값으로 데이터를 전달하지만 비밀 데이터용 타입·권한·볼륨 처리 경로를 갖습니다
kubelet은 Pod가 참조한 오브젝트를 읽어 컨테이너 생성 설정이나 볼륨 파일을 만듭니다

![kubelet이 ConfigMap과 Secret을 읽어 컨테이너 생성 시 env 문자열로 넘기거나 Pod 재처리 때 볼륨 파일로 투영하는 두 경로](/diagrams/k8s-theory-configmap-secret-delivery-1.svg)

| 전달 경로 | 값을 전달하는 방식 | 실행 중 변경 |
|---|---|---|
| `env`·`envFrom` | 생성할 컨테이너의 환경 변수 문자열 조립 | kubelet이 이미 실행 중인 환경 변수를 바꾸지 않음 |
| 일반 volume | 볼륨 디렉터리에 파일로 투영 | 다시 투영한 뒤 프로세스가 새 파일을 읽을 수 있음 |
| volume의 `subPath` | 선택한 파일을 bind mount | 이후 투영의 링크 전환을 따라가지 않음 |

파일이 갱신되었다는 사실과 애플리케이션이 설정을 다시 읽었다는 사실도 다릅니다
프로세스가 내용을 메모리에 캐시하거나 이전 파일을 계속 열어 둔다면, 새 경로가 준비되어도 이전 설정을 계속 사용할 수 있습니다

## envFrom을 펼친 다음 env를 덮어씁니다

`envFrom`은 ConfigMap이나 Secret의 키와 값을 한꺼번에 환경 변수로 가져옵니다
`prefix`가 있으면 변수 이름 앞에 그 문자열을 붙입니다
`env`는 변수 이름을 하나씩 지정하고 직접 값이나 `configMapKeyRef`·`secretKeyRef` 같은 source를 선택합니다

[`makeEnvironmentVariables`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kubelet_pods.go)는 `envFrom`을 먼저 처리하고 이후 `env`를 같은 이름에 덮어씁니다
여러 `envFrom`에서 이름이 겹치면 뒤 source가 앞 source를 덮습니다

예를 들어 source의 값이 `LOG_LEVEL=info`, `PORT=8080`이고 같은 컨테이너의 `env`에 `LOG_LEVEL=debug`를 선언했다는 가정입니다
생성 시 최종 값은 `LOG_LEVEL=debug`, `PORT=8080`입니다
이는 조립 규칙을 설명하는 예시이며 실행 중 갱신을 뜻하지 않습니다

`env.value`의 `$(VAR)`도 이 조립 단계에서 펼칩니다
해당 컨테이너에서 앞서 조립한 변수와 Service 환경 변수를 참조합니다
따라서 변수 선언 순서와 참조 시점을 구분해야 합니다

### 없는 오브젝트와 없는 키는 별도로 처리합니다

`optional`은 참조가 없을 때 생성 실패로 볼지 생략할지 정합니다
기본적으로 필수인 참조와 `optional: true`를 나누면 다음과 같습니다

| 없는 대상 | 필수 참조 | optional 참조 |
|---|---|---|
| ConfigMap·Secret 자체 | 환경 변수 조립이나 볼륨 준비 실패 | 해당 참조의 데이터 없이 진행 가능 |
| `env`가 지정한 키 | 컨테이너 설정 생성 실패 | 해당 변수 생략 |
| 볼륨 `items`가 지정한 키 | 볼륨 payload 생성 실패 | 해당 파일 생략 |

`items`를 생략하면 존재하는 전체 키를 파일로 만듭니다
특정 키를 지목하지 않았으므로 지정한 키의 부재 검사는 하지 않습니다

다음은 실제 수집한 로그가 아니라 소스에 정의된 판별 메시지입니다

```text
couldn't find key <key> in ConfigMap <namespace>/<name>
configmap references non-existent config key: <key>
```

첫 메시지는 환경 변수 조립, 둘째는 [`configmap.MakePayload`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/configmap/configmap.go)에서 나옵니다
앞의 실패는 `CreateContainerConfigError`, 볼륨 쪽은 마운트 실패 등의 상태로 확인할 수 있습니다
권한 오류 같은 다른 실패까지 optional이 모두 무시하는 것은 아닙니다

환경 변수 이름은 `=`를 제외한 출력 가능한 ASCII를 허용합니다
v1.34부터 GA·기본 on·잠김인 `RelaxedEnvironmentVariableValidation`과 [`IsRelaxedEnvVarName`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/util/validation/validation.go)의 규칙입니다
ConfigMap에서 허용하는 `key.name`·`KEY_NAME`·`key-name`을 옛 환경 변수 이름 규칙만 보고 제외해서는 안 됩니다

### 설정 오브젝트 변경만으로 롤아웃하지는 않습니다

kubelet의 [`pickFieldsToHash`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/container/helpers.go)는 컨테이너 변경 비교에 `name`과 `image`를 사용합니다
외부 ConfigMap의 데이터를 바꿔도 이 해시는 바뀌지 않으며 그 변경만으로 컨테이너를 다시 만들지 않습니다

새 환경 변수를 전달하려면 컨테이너를 새로 생성해야 합니다
설정 변경을 워크로드 교체로 연결하는 경우에는 Pod template 변경과 [롤아웃의 가용성 제어](/essays/k8s-theory-workload-rollout-revisions)가 필요합니다
ConfigMap 자체는 그 교체 순서를 조정하는 컨트롤러가 아닙니다

## AtomicWriter는 공개할 디렉터리를 링크로 전환합니다

볼륨의 파일은 사용자에게 보이는 경로, `..data` 링크, 실제 내용을 가진 시간별 디렉터리로 연결됩니다
[`AtomicWriter.Write`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/util/atomic_writer.go)는 공개 중인 파일들을 하나씩 덮어쓰는 대신 새 디렉터리에 전체 내용을 준비합니다

![일반 마운트는 app.conf에서 data 링크를 따라 새 디렉터리를 읽지만 subPath는 생성 시점에 해석한 이전 파일에 고정되는 관계](/diagrams/k8s-theory-configmap-secret-delivery-2.svg)

Linux에서 새 내용을 공개하는 흐름은 다음과 같습니다

1. 새 시간별 디렉터리에 전체 파일 내용을 쓰고 권한을 적용합니다
2. 그 디렉터리를 가리키는 임시 심볼릭 링크 `..data_tmp`를 만듭니다
3. `rename(..data_tmp, ..data)`로 공개 대상을 전환합니다
4. 더 이상 필요하지 않은 기존 디렉터리와 경로를 정리합니다

원자적으로 바꾸는 것은 `..data` 링크의 대상입니다
프로세스가 파일 두 개를 차례로 여는 사이에 링크가 바뀌면 서로 다른 버전을 읽을 수 있습니다
여러 파일을 읽는 전체 작업의 스냅샷 일관성까지 이 방식이 보장하는 것은 아닙니다

소스는 `..data` 링크를 inotify나 fanotify로 감시해 변경을 알아내는 방법도 설명합니다
이벤트를 받은 뒤 파일을 다시 읽고 애플리케이션 설정을 적용하는 일은 소비자 쪽 동작입니다

### subPath는 그때의 실제 파일을 붙잡습니다

[`doBindSubPath`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/util/subpath/subpath_linux.go)는 bind하기 전에 심볼릭 링크를 해석하고 파일을 안전하게 엽니다
마운트 대상을 링크 변경으로 바꿀 수 없도록 실제 파일 참조를 사용합니다

따라서 `subPath`가 가리키는 대상은 이후 `..data`를 다시 따라가는 경로가 아닙니다
마운트 당시 시간별 디렉터리의 파일입니다
링크 전환과 이전 디렉터리 삭제가 일어나도 bind mount는 이전 파일 참조를 유지합니다

이 예외는 ConfigMap·Secret뿐 아니라 projected volume의 source를 `subPath`로 받는 경우에도 적용됩니다
토큰 파일처럼 갱신이 필요한 데이터에도 같은 경계가 생깁니다

## 파일 반영 시간은 재처리와 변경 전달을 함께 봅니다

ConfigMap·Secret·projected·downwardAPI 플러그인은 다시 투영해야 하는 볼륨입니다
[`processPodVolumes`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/volumemanager/populator/desired_state_of_world_populator.go)는 Pod 볼륨을 처리한 뒤 필요한 볼륨에 재마운트를 표시합니다

kubelet의 기본 `syncFrequency`는 1분입니다
여기에 변경된 오브젝트를 kubelet이 확보하기까지의 전파 시간이 추가됩니다
`configMapAndSecretChangeDetectionStrategy`는 그 확보 방식을 정합니다

| 전략 | 조회 방식 | 추가로 고려할 지연 |
|---|---|---|
| `Watch` 기본 | 참조한 오브젝트를 watch로 갱신 | watch 전파 |
| `Cache` | 조회 결과를 TTL 동안 재사용 | 기본 TTL 1분 |
| `Get` | 필요할 때 API 서버에 직접 조회 | TTL 캐시 대기는 없지만 요청 시간은 필요 |

[공식 ConfigMap 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/configuration/configmap.md)는 Pod 동기화 주기와 캐시 전파 지연을 함께 보도록 설명합니다
이를 장애·요청 실패가 있어도 반드시 지키는 고정 시간 상한으로 읽으면 안 됩니다
기본값은 [kubelet 설정](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/apis/config/v1beta1/defaults.go), TTL은 [ConfigMap manager](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/configmap/configmap_manager.go)에 있습니다

Watch 방식도 참조가 있는 동안 항상 watch를 유지하는 것은 아닙니다
볼륨에서 사용하는 오브젝트는 재처리 때 다시 읽지만, 환경 변수로만 사용하는 오브젝트는 생성 뒤 조회가 반복되지 않아 유휴 상태가 될 수 있습니다
[`NewWatchBasedManager`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/util/manager/watch_based_manager.go)는 유휴 기준을 재처리 주기의 5배로 계산하되 최소 1분을 적용합니다
이 시간이 지난 대상은 검사 시 watch를 멈출 수 있습니다

## immutable은 데이터 변경과 감시 비용을 줄입니다

`immutable: true`인 ConfigMap·Secret은 같은 오브젝트에서 데이터를 수정할 수 없습니다
ConfigMap의 `data`·`binaryData`, Secret의 `data` 변경을 막으며 immutable을 해제하는 요청도 거부합니다
라벨과 annotation 같은 metadata가 모두 잠기는 것은 아닙니다

검증은 [`ValidateConfigMapUpdate`·`ValidateSecretUpdate`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go)에 있습니다
거절 메시지는 ``field is immutable when `immutable` is set``입니다

watch 기반 캐시는 읽은 오브젝트가 immutable이면 reflector를 멈추고 그 캐시 항목에서 다시 시작하지 않습니다
변하지 않는 데이터를 계속 감시하는 연결을 줄이는 효과가 있습니다
하지만 읽기 권한이나 RBAC는 바꾸지 않습니다

그 데이터 자체를 바꾸려면 오브젝트를 삭제한 뒤 다시 만들어야 합니다
삭제해도 이미 전달된 볼륨 파일과 실행 중인 환경 변수가 즉시 사라지지는 않습니다
같은 이름으로 다시 만든 오브젝트를 기존 Pod가 새 데이터로 갱신할 것이라고 기대해서는 안 되며, 공식 문서는 해당 Pod도 다시 만들도록 권고합니다

## Secret의 비밀성은 저장·권한·전달을 나눠 봅니다

Secret의 JSON `data`는 base64로 표현합니다
base64는 인코딩이며 암호화가 아닙니다
저장 시 암호화를 별도로 구성하지 않은 기본 etcd 저장이 암호화되어 있다고 가정해서는 안 됩니다

API 서버의 `--encryption-provider-config`는 어떤 리소스를 어떤 provider로 암호화할지 지정합니다
대상은 Secret에 한정하지 않으며 ConfigMap도 포함할 수 있습니다
이 설정과 적용 절차는 [Encrypting Confidential Data at Rest](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/tasks/administer-cluster/encrypt-data.md)에 있습니다

| 비교 대상 | ConfigMap | Secret |
|---|---|---|
| 데이터 타입 | `data` 문자열·`binaryData` 바이트 | `data` 바이트, JSON에서는 base64 |
| 타입별 검증 | Secret type 필드 없음 | 일부 built-in type의 필수 키·형식 검사 |
| 직접 볼륨 투영 매체 | 기본 medium의 emptyDir | Memory emptyDir의 tmpfs |
| RBAC 리소스 이름 | `configmaps` | `secrets` |

[`ValidateSecret`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go)는 Docker 설정 JSON 등 일부 타입의 형식 오류에 `<secret contents redacted>`를 사용합니다
이것을 모든 오류나 출력에서 모든 Secret 값이 자동으로 가려진다는 의미로 확대하지 않습니다

크기 검증은 Secret의 `data` 값 합계, ConfigMap의 `data`와 `binaryData` 값 합계에 각각 1MiB 상한을 적용합니다
두 리소스 모두 볼륨 파일 기본 mode는 `0644`입니다
Secret이라는 이유만으로 컨테이너 파일의 읽기 권한이 자동으로 더 좁아지지는 않습니다
`defaultMode`·항목별 mode와 `fsGroup` 등의 영향을 구분해야 합니다

Node authorizer는 [`configmaps`와 `secrets` 모두 노드와의 참조 관계를 검사](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/plugin/pkg/auth/authorizer/node/node_authorizer.go)합니다
필요한 오브젝트를 노드에 전달하는 경계도 Secret만의 성질은 아닙니다
API 읽기 권한과 컨테이너 안에서 파일을 읽는 권한은 서로 다른 검사입니다

### tmpfs도 swap 조건을 확인해야 합니다

[`secret.wrappedVolumeSpec`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/secret/secret.go)은 `medium: Memory`인 emptyDir을 감싸 파일을 tmpfs에 둡니다
반면 [`configmap.wrappedVolumeSpec`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/configmap/configmap.go)은 기본 medium을 사용합니다
ConfigMap 플러그인 주석은 tmpfs 메모리를 올바른 cgroup에 회계하는 문제를 이 차이의 이유로 적습니다
기본 medium이 사용하는 실제 노드 파일시스템까지 항상 디스크라고 단정할 수는 없습니다

Memory emptyDir은 새 tmpfs를 마운트할 때 지원되면 `noswap` 옵션을 붙입니다
이 옵션이 없다면 tmpfs라는 사실만으로 swap을 통한 디스크 기록을 막는다고 보장할 수 없습니다

swap이 켜진 노드에서 `failSwapOn: true`이면 kubelet은 기동을 거부합니다
`failSwapOn: false`이고 `noswap`을 지원하지 않으면 `PossibleMemoryBackedVolumesOnDisk` 경고를 남기고 진행합니다
kubelet이 사용자 namespace 안에서 실행되는 경우도 `noswap` 미지원 판정에 들어갑니다
조건은 [`generateTmpfsMountOptions`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/emptydir/empty_dir.go), [`IsTmpfsNoswapOptionSupported`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/util/swap/swap_util.go), [`NewContainerManager`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/cm/container_manager_linux.go)에 있습니다

## projected volume은 여러 source를 한 디렉터리에 투영합니다

현행 API의 source는 `secret`, `configMap`, `downwardAPI`, `serviceAccountToken`, `clusterTrustBundle`, `podCertificate`입니다
`defaultMode`는 source별 필드가 아니라 projected volume 전체의 기본 모드입니다
개별 파일이 별도 모드를 갖는 경우와 구분해야 합니다
ConfigMap을 projected의 source로 넣으면 직접 ConfigMap 볼륨과 달리 projected 플러그인의 Memory emptyDir 경로를 사용합니다

v1.37.1의 `ClusterTrustBundle`·`ClusterTrustBundleProjection`·`PodCertificateRequest`는 모두 GA·기본 on입니다
[`feature gate 등록`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go)과 [`certificates.k8s.io/v1` API 등록](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/certificates/rest/storage_certificates.go)을 대조해야 하며 API 활성화와 인증서 발급 준비도 별도 조건입니다
CA 신뢰 배포와 Pod 인증서 발급의 역할은 [인증서 해설](/essays/k8s-theory-certificate-signing-delegation)에서 구분했습니다

`serviceAccountToken`의 기본 요청 유효기간은 1시간이고 최소는 10분입니다
실제 발급 유효기간은 API 서버 정책도 따릅니다
[`requiresRefresh`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/token/token_manager.go)는 요청 수명의 약 80% 경과 또는 24시간 경과 중 먼저 오는 기준으로 갱신 필요를 판정하며 지터도 적용합니다
따라서 특정 초에 반드시 파일이 바뀐다는 보장은 아닙니다

### downwardAPI의 env와 volume 허용 필드는 다릅니다

downwardAPI는 Pod 자신의 정보를 환경 변수나 파일로 전달합니다
두 경로가 허용하는 `fieldRef` 집합은 서로 포함 관계가 아닙니다

| 사용 경로 | Pod 필드 |
|---|---|
| 볼륨 전용 | 전체 `metadata.labels`·`metadata.annotations` 맵 |
| 둘 다 | `metadata.name`·`metadata.namespace`·`metadata.uid`, 개별 label·annotation 키 |
| env 전용 | `spec.nodeName`·`spec.serviceAccountName`, `status.hostIP`·`hostIPs`·`podIP`·`podIPs` |

이 차이는 [`validVolumeDownwardAPIFieldPathExpressions`·`validEnvDownwardAPIFieldPathExpressions`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go)와 개별 키 허용 검증으로 정해집니다
모든 env 전용 필드가 볼륨을 준비할 때 아직 없어서 생긴 차이라고 설명할 수는 없습니다
이미 Pod spec에 있는 nodeName과 serviceAccountName도 env 전용 목록에 있기 때문입니다

### emptyDir과 hostPath도 PVC를 거치지 않습니다

`medium: Memory` emptyDir의 tmpfs 크기는 노드 allocatable을 기본 상한으로 두고, 유효한 Pod 메모리 상한이나 양수 `sizeLimit`이 더 작으면 그 값으로 낮춥니다
Pod 상한을 도출할 수 없는 경우까지 선언한 컨테이너 limit을 무조건 합산해 적용하는 것은 아닙니다
실제 계산은 [`calculateEmptyDirMemorySize`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/emptydir/empty_dir.go)에 있습니다

tmpfs 파일에 사용한 메모리는 로컬 ephemeral storage 대신 컨테이너 메모리 사용량으로 다룹니다
따라서 파일을 채우는 작업도 [메모리 cgroup의 한도](/essays/k8s-theory-qos-cgroups)에 영향을 줄 수 있습니다

hostPath는 노드의 실제 경로를 컨테이너에 노출합니다
hostPath 자체의 사용량 상한이나 스케줄러 자원 계산이 있다는 뜻은 아닙니다
Pod Security Admission의 baseline을 집행하는 구성은 [`hostPath` 볼륨 사용을 거부](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/pod-security-admission/policy/check_hostPathVolumes.go)합니다

## EnvFiles도 실행 중 환경 변수를 갱신하지는 않습니다

v1.37.1의 `EnvFiles`는 Beta·기본 on입니다
`env.valueFrom.fileKeyRef`로 같은 Pod의 emptyDir에 있는 파일에서 변수 값을 읽을 수 있습니다
init container가 파일을 쓰고 일반 컨테이너가 그 값을 환경 변수로 소비하는 경로입니다
소비하는 컨테이너에 그 볼륨을 직접 마운트할 필요는 없습니다

```yaml
env:
  - name: LOG_LEVEL
    valueFrom:
      fileKeyRef:
        volumeName: generated-env
        path: app.env
        key: LOG_LEVEL
```

이 조각은 `generated-env`라는 emptyDir을 별도로 선언하고 파일을 준비했다는 전제입니다
[`validateFileKeyRefVolumes`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go)는 참조 볼륨이 존재하고 emptyDir인지 확인합니다
ConfigMap·Secret 볼륨의 파일을 이름만 지정해 직접 읽는 범용 파일 참조 필드는 아닙니다

환경 파일 형식은 일반적인 shell 스크립트 전체가 아닙니다
현재 [공식 EnvFiles 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/tasks/inject-data-application/define-environment-variable-via-file.md)는 `LOG_LEVEL='info'`처럼 작은따옴표로 값을 감싸는 형식을 정의하며 shell 확장이나 큰따옴표 값을 허용하지 않습니다

파일은 컨테이너 생성용 환경 변수를 조립할 때 읽습니다
나중에 파일이 바뀌어도 이미 실행 중인 환경 변수까지 갱신하지는 않습니다
또한 고정 소스의 처리는 파일 파싱 오류를 optional로 무시하지 않으며, 읽은 값이 빈 문자열인 경우에도 키 부재와 같은 분기로 처리합니다
API 주석의 optional 설명과 실제 적용 조건을 구분해서 보아야 합니다

## 갱신되지 않는 증상은 서로 다른 경계에서 발생합니다

| 증상 | 먼저 확인할 경계 |
|---|---|
| 오브젝트를 바꿔도 env가 그대로임 | 컨테이너 생성 때 복사한 값인지 |
| 볼륨 파일이 그대로임 | subPath, 재처리·전파 지연, immutable 여부 |
| 파일은 새 값인데 앱은 이전 값 사용 | 파일 재열기·설정 재적용 여부 |
| `CreateContainerConfigError` | 필수 오브젝트·키·환경 파일 준비, 실제 message |
| `FailedMount` | 볼륨 source·items·접근 오류, 실제 Event |
| 삭제한 오브젝트의 값이 계속 보임 | 이미 전달한 파일·env와 재생성 시 필수 참조 구분 |
| Secret 파일이 예상보다 넓게 읽힘 | defaultMode·항목 mode·fsGroup·프로세스 권한 |
| 갱신 토큰이 오래된 채로 남음 | subPath 고정, 파일 재열기, 토큰 갱신 상태 |

설정이 API 서버에 저장된 시점, kubelet이 확보한 시점, 파일을 투영한 시점, 프로세스가 읽고 적용한 시점은 다릅니다
어느 단계까지 새 값이 도달했는지 확인해야 갱신 지연과 갱신되지 않는 전달 방식을 구분할 수 있습니다
