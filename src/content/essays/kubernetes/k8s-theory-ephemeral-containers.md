---
title: "임시 컨테이너 — 추가 전용 API와 실행·상태 집계의 경계"
excerpt: "pods/ephemeralcontainers가 허용하는 변경과 kubelet의 시작 판단을 구분합니다. 기존 항목을 수정·삭제할 수 없는 이유, PID namespace 선택, 자원·재시작 제약과 kubectl debug의 권한 경계를 살펴봅니다"
category: "kubernetes"
tags: ["Kubernetes", "EphemeralContainers", "Debugging", "Kubelet", "CRI", "concept"]
series:
  name: "k8s-theory-node"
  order: 19
date: "2026-09-29"
---

애플리케이션 이미지에 shell이나 진단 도구가 없으면 `kubectl exec`만으로 조사하기 어려울 수 있습니다
초기화가 끝나지 않은 Pod 안에서 별도 도구를 실행하고 싶은 경우도 있습니다

임시 컨테이너인 **ephemeral container**는 이런 조사를 위해 기존 Pod에 나중에 추가하는 컨테이너입니다
v1.25에서 stable이 됐으며, 일반 컨테이너처럼 자원 배정이나 재시작을 보장하는 상시 워크로드 용도는 아닙니다

추가 요청을 저장하는 API 서버, 시작할 대상을 계산하는 kubelet, 실제 프로세스를 만드는 런타임을 나누어 살펴보겠습니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> kubectl 동작도 같은 v1.37.1 소스를 확인했습니다
> 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## 임시 컨테이너를 추가하는 서브리소스가 따로 있습니다

임시 컨테이너 명세는 `spec.ephemeralContainers`에 저장합니다
하지만 Pod 생성 시 이 필드를 넣거나, Pod 본체의 일반 수정 요청으로 추가할 수는 없습니다
기존 Pod의 `ephemeralcontainers` 서브리소스로 요청해야 합니다

```text
/api/v1/namespaces/{namespace}/pods/{name}/ephemeralcontainers
```

서브리소스는 같은 Pod의 일부 기능이나 변경 범위를 별도 API 경로로 제공하는 방식입니다
이 경로의 요청·응답 오브젝트는 `Pod`이며, [`EphemeralContainersREST`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/pod/storage/storage.go)는 `get`·`update`·`patch`를 지원합니다
없는 Pod를 생성하는 `create`는 제공하지 않고, update에서도 새 Pod 생성은 허용하지 않습니다

Pod에는 이 경로 외에도 서로 다른 역할을 맡은 서브리소스가 있습니다
[`NewRESTStorage`의 등록](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/rest/storage_core.go)을 변경 대상별로 보면 다음과 같습니다

| 경로 | 변경하거나 제공하는 것 |
|---|---|
| `pods` | 본체 검증에서 허용하는 spec 필드와 metadata 수정 |
| `pods/binding` | 바인더의 노드 배정. metadata·status 갱신도 포함할 수 있음 |
| `pods/eviction` | 정책 검사를 거친 삭제 요청 |
| `pods/resize` | 자원 크기 변경을 위한 별도 경로 |
| `pods/ephemeralcontainers` | 임시 컨테이너 명세 추가 |
| `pods/status` | 관측한 상태 갱신 |
| `log`·`exec`·`attach`·`portforward`·`proxy` | 조회·접속·중계 |

마지막 행의 API 처리가 Pod spec을 갱신하는 것은 아닙니다
그렇다고 `exec`로 실행한 명령이 파일이나 프로세스의 상태까지 바꾸지 못한다는 뜻은 아닙니다
저장 오브젝트에 대한 쓰기와 실행 중인 프로세스의 동작은 구분해야 합니다

### Pod 본체 수정과 별도 경로 중 무엇을 선택했을까요?

별도 경로를 둔 이유는 디버그 컨테이너 추가 권한을 일반 Pod 수정 권한과 나누기 위해서입니다
[KEP-277의 설계 이유](https://github.com/kubernetes/enhancements/blob/0c8d11e9a13e12d2ef75d2d78af5ac00d8189046/keps/sig-node/277-ephemeral-containers/README.md#requiring-a-subresource)는 Pod 본체의 일반 update로 구현하는 편이 단순하지만, 관리자가 이 기능의 접근을 별도로 통제해야 한다고 설명합니다

본체의 수정 허용 목록에 넣으면 디버깅을 허용하려고 `pods` 수정 권한을 함께 줘야 합니다
서브리소스로 분리하면 RBAC에서 `pods/ephemeralcontainers`에 대한 `update`나 `patch`를 별도로 판단할 수 있습니다
입력값 검증만으로는 이 권한 분리를 대신할 수 없습니다

`kubectl debug`의 전체 작업은 추가 요청 외에 Pod 조회나 attach 접속을 포함할 수 있습니다
서브리소스의 쓰기 권한을 줬다는 사실만으로 이 모든 동작의 권한이 함께 생기지는 않습니다

## 서버는 새 임시 목록을 선택하고 나머지를 복원합니다

요청에 Pod 전체를 담아도 이 서브리소스가 변경 대상으로 삼는 spec은 `ephemeralContainers`입니다
[`dropNonEphemeralContainerUpdates`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/pod/strategy.go)는 요청의 새 임시 목록을 따로 보관한 뒤, spec과 status를 기존 값으로 되돌리고 임시 목록만 다시 넣습니다

| 요청에 함께 담은 변경 | 이 경로의 처리 |
|---|---|
| `spec.ephemeralContainers` | 새 목록을 검증 |
| 원래 컨테이너 이미지 등 나머지 spec | 기존 값으로 복원 |
| status | 기존 값으로 복원 |
| labels·annotations·finalizers·ownerReferences | 기존 값으로 복원 |
| `metadata.managedFields` | 필드 쓰기 주체를 기록하기 위해 유지 |

레이블 변경을 같이 보냈는데 저장되지 않는 경우는 그 변경을 기존 값으로 복원한 결과입니다
해당 변경을 반영하지 않는 처리와, 임시 컨테이너 입력 자체를 검증해서 거부하는 처리는 다릅니다

원래 컨테이너 명세를 **이 요청으로** 함께 바꿀 수 없다는 뜻이지, Pod의 다른 변경 경로까지 전부 불변이라는 뜻은 아닙니다
또한 임시 컨테이너 안의 명령이 공유한 자원에 미칠 영향까지 차단하는 보장도 아닙니다

`managedFields`는 필드별 쓰기 주체를 기록하는 metadata입니다
이 값은 [`ResetObjectMetaForStatus`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/apis/meta/v1/helpers.go)가 복원하지 않는 예외이며, 필드 관리 필터는 `spec.ephemeralContainers` 접두사만 통과시킵니다

임시 컨테이너 추가도 실제 spec 변경입니다
`PrepareForUpdate`의 `updatePodGeneration`은 새 spec이 기존과 다르면 `metadata.generation`을 1 증가시킵니다
목록 추가가 단순한 접속 세션이 아니라 API에 저장하는 변경이라는 사실을 보여 줍니다

![API 서버가 임시 컨테이너 추가를 검증해 저장하고 kubelet이 별도 동기화에서 시작 대상을 계산한 뒤 런타임에 실행을 요청하는 과정|tall](/diagrams/k8s-theory-ephemeral-containers-1.svg)

## 기존 임시 항목은 이름과 내용이 유지돼야 합니다

새 임시 컨테이너를 추가할 수 있어도, 기존 임시 컨테이너 명세를 수정하거나 제거할 수는 없습니다
[`ValidatePodEphemeralContainersUpdate`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go)는 새 목록을 이름으로 찾을 수 있게 만든 뒤 기존 항목을 하나씩 대조합니다

| 기존 목록 | 새 목록 | 기존 항목 대조 결과 |
|---|---|---|
| `[A, B]` | `[B, A, C]` | A·B의 이름과 내용이 같으면 이 대조는 통과 |
| `[A, B]` | `[A]` | B가 없어 `may not be removed` |
| `[A(image1)]` | `[A(image2)]` | 내용이 달라 `may not be changed` |

목록 순서만 바뀐 것을 항목 수정으로 판단하지 않습니다
patch에서 순서가 보존되지 않을 수 있어 배열 인덱스 대신 이름으로 대조하는 구조입니다
이 대조를 통과해도 새 이름의 중복, 금지 필드 등 나머지 명세 검증까지 통과해야 합니다

추가 전용 제약은 지우고 같은 이름으로 다시 넣는 식의 재시작 우회를 막는 데도 연결됩니다
임시 컨테이너를 상시 작업의 실행 보장에 의존하는 용도로 사용하지 않도록 제한하는 설계입니다

status에는 별도의 제약이 있습니다
`ValidateEphemeralContainerStateTransition`은 이미 `Terminated`인 같은 이름의 상태를 비종료 상태로 되돌리는 갱신을 거부합니다
명세 목록의 제거·변경 검증과 status 전이 검증은 다른 필드를 검사합니다

### static Pod의 mirror 사본에는 추가할 수 없습니다

검증 함수는 기존 Pod에 mirror Pod 어노테이션이 있으면 `static pods do not support ephemeral containers`로 거부합니다
static Pod의 실제 명세는 노드 파일에 있고, API 서버에 보이는 mirror Pod는 그 사본이기 때문입니다

API의 사본을 수정해도 노드 파일이 바뀌지 않습니다
이 경로를 통해 static Pod의 컨테이너 구성을 고치는 방식은 지원하지 않습니다

## 허용 목록에 없는 필드는 사용할 수 없습니다

임시 컨테이너는 일반 `Container`와 공통 필드 구조를 공유하지만 모든 필드를 허용하지는 않습니다
[`allowedEphemeralContainerFields`와 `validateFieldAllowList`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go)는 구조체 필드를 순회하며 허용되지 않은 필드에 zero value가 아닌 값이 있으면 거부합니다

| 금지 필드 | 현행 허용 목록의 상태 |
|---|---|
| `ports` | 명시적으로 false |
| `resources` | 명시적으로 false |
| `livenessProbe`·`readinessProbe`·`startupProbe` | 명시적으로 false |
| `lifecycle` | 명시적으로 false |
| `resizePolicy` | 목록에 없어 금지 |
| `restartPolicy`·`restartPolicyRules` | 목록에 없어 금지 |

이 표는 현행 공통 필드에서 금지하는 아홉 필드를 묶은 것입니다
새 필드가 `Container`에 추가돼도 허용 목록에 넣기 전에는 임시 컨테이너에서 자동으로 사용할 수 없습니다
따라서 일반 컨테이너에서 컨테이너별 재시작 정책을 지원한다는 사실이 임시 컨테이너의 재시작 정책까지 허용한다는 뜻은 아닙니다

`ports`·probe·`lifecycle`은 Pod의 기본 서비스나 수명주기 역할을 맡는 설정입니다
이 기능을 임시 조사 컨테이너에 의존하지 않도록 금지합니다
kubelet의 [`prober manager`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/prober/prober_manager.go)도 일반 컨테이너와 restartable init container에만 probe 워커를 만듭니다

`resources`의 금지는 자원 회계와 연결됩니다
이미 배치된 Pod에 추가하면서 이 컨테이너의 request를 썼다고 새 노드 자원을 배정하거나 Pod의 할당량을 늘리는 동작은 제공하지 않습니다
임시 컨테이너 자체에 request·limit을 선언하는 경로도 허용하지 않습니다

`volumeMounts`는 허용하지만 `subPath`와 `subPathExpr`는 별도로 금지합니다
해당 bind mount가 Pod 종료까지 정리되지 않아 자원을 남길 수 있다는 것이 검증 코드의 이유입니다
기존 Pod의 볼륨을 마운트할 수 있다는 사실과 이 요청으로 새 Pod 볼륨을 추가할 수 있다는 주장은 다릅니다

## targetContainerName은 PID namespace 대상을 선택합니다

PID namespace는 프로세스 번호와 어떤 프로세스를 볼 수 있는지의 범위를 격리합니다
컨테이너마다 PID namespace가 다르면 디버그 컨테이너의 `ps`가 자기 범위의 프로세스만 보여 줄 수 있습니다
`targetContainerName`은 조사할 일반 컨테이너나 init container의 이름을 지정합니다

API 서버는 이 이름이 Pod 명세의 일반·init 컨테이너에 있는지 확인합니다
다른 임시 컨테이너를 대상으로 지정할 수는 없으며, 임시 컨테이너 자신의 이름은 모든 컨테이너 종류에서 유일해야 합니다

API 검증을 통과한 이름이 실행 가능한 대상 ID를 보장하지는 않습니다
kubelet의 [`getTargetID`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_container.go)는 런타임 상태에서 이름을 찾아 컨테이너 ID로 바꿉니다
상태에 없으면 `unable to find target container`로 시작 요청을 진행하지 못합니다

대상 ID를 얻으면 [`generateLinuxContainerConfig`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_container_linux.go)가 PID 모드를 조건부로 바꿉니다

| 기존 PID 모드 | 대상을 지정했을 때 kubelet의 처리 |
|---|---|
| `CONTAINER` | `TARGET`으로 바꾸고 `target_id` 설정 |
| `POD` | Pod의 공유 모드 유지 |
| `NODE` | 노드 PID 모드 유지 |

`shareProcessNamespace: true`인 Pod는 PID 모드가 이미 `POD`입니다
`hostPID: true`이면 `NODE`이며, 그 외에는 기본적으로 `CONTAINER`입니다
현재 선택은 [`PidNamespaceForPod`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/util/util.go)에서 확인할 수 있습니다

API 타입 주석에는 namespace를 넓게 설명하지만, 이 kubelet 경로가 대상 ID에 맞춰 바꾸는 것은 PID namespace입니다
네트워크와 IPC는 Pod 설정의 `POD` 또는 `NODE` 모드를 사용하며, 컨테이너 범위의 IPC를 고르는 Kubernetes API는 없습니다

설정한 `TARGET`을 실제로 구현하는 주체는 컨테이너 런타임입니다
[`CRI NamespaceOption`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cri-api/pkg/apis/runtime/v1/api.proto)과 [공식 디버깅 문서](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/#ephemeral-container)는 런타임이 이를 지원해야 한다고 설명합니다
지원하지 않으면 시작에 실패하거나 분리된 PID namespace로 실행될 수 있습니다

프로세스가 보이는 범위와 그 프로세스에 접근·조작할 권한도 다릅니다
공유한 `/proc` 정보와 파일 접근에는 Unix 권한이 적용됩니다
`--target`을 지정했다는 이유만으로 필요한 권한을 모두 얻는 것은 아닙니다

## kubelet은 init 완료 전에도 시작할 수 있지만 재시작하지 않습니다

API 저장 뒤 kubelet이 명세를 처리하는 시점은 별도입니다
v1.37.1의 `kubeGenericRuntimeManager.SyncPod`는 총 아홉 단계이며, 앞의 sandbox 준비와 자원 갱신 이후 임시 컨테이너를 처리합니다

7. 임시 컨테이너 시작
8. init 컨테이너 시작
9. 일반 컨테이너 시작

[`SyncPod`와 `computePodActions`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_manager.go)는 init이 막힌 Pod에도 조사 수단을 제공하도록 임시 컨테이너의 시작 판단을 초기화 완료 검사보다 앞에 둡니다
다만 Pod 생성 때는 임시 명세를 넣을 수 없어, 정상적인 최초 생성에서 임시 컨테이너가 init보다 먼저 생긴다는 뜻은 아닙니다

sandbox를 새로 만들어야 하는 동기화 회차는 임시 시작 목록을 계산하기 전에 반환할 수 있습니다
앞선 실행 단계의 오류나 이미지·런타임 실패도 가능하므로, 추가 요청의 저장 성공이 그 회차의 실행을 보장하지 않습니다

시작 목록을 만드는 조건은 같은 이름의 런타임 컨테이너 상태가 없는지입니다
상태가 이미 있으면 종료 상태여도 목록에 넣지 않으므로, 일반 컨테이너의 재시작 정책처럼 다시 실행하지 않습니다
아직 한 번도 시작하지 못한 컨테이너의 생성 재시도와, 실행 후 종료한 컨테이너의 재시작을 혼동하지 않아야 합니다

기본 컨테이너 GC 정책은 `(Pod UID, 컨테이너 이름)`별로 종료 컨테이너를 최대 한 개 보관합니다
이 기본 보관 조건에서 종료 상태가 남아 있는 동안에는 재시작 판단의 근거가 됩니다
API의 임시 명세를 지우거나 같은 이름을 바꿔 재사용하는 것은 앞에서 본 추가 전용 검증이 막습니다

## 상태 집계에서 빠져도 Pod 자원을 소비합니다

임시 컨테이너의 실행·종료 상태는 `status.ephemeralContainerStatuses`에 기록합니다
하지만 이 목록은 Pod의 phase나 `Ready`·`ContainersReady`·`Initialized`를 만드는 직접 집계에 넣지 않습니다

[`generateAPIPodStatus`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kubelet_pods.go)는 phase 계산에 일반·init 컨테이너 상태를 전달합니다
[`준비·초기화 조건 계산`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/status/generate.go)도 일반·init 명세를 대상으로 합니다
임시 컨테이너의 종료나 `Ready: False`라는 상태 자체를 일반 워크로드의 준비 실패로 합산하지 않습니다

QoS 역시 임시 컨테이너 자원을 계산하지 않습니다
[`ComputePodQOS`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/v1/helper/qos/qos.go)는 Pod-level 자원이 있으면 그 값을 사용하고, 컨테이너별 계산에서는 일반·init 명세를 읽습니다
임시 컨테이너를 추가해 BestEffort·Burstable 등의 등급을 바꾸는 경로가 아닙니다

![일반·init 컨테이너 상태는 Pod의 phase와 준비 조건에 집계하고 임시 상태는 별도로 기록하지만 두 프로세스가 모두 Pod cgroup의 자원을 소비하는 구조](/diagrams/k8s-theory-ephemeral-containers-2.svg)

집계에서 빠진다는 사실이 영향까지 없애지는 않습니다
Linux에서 임시 컨테이너의 프로세스도 Pod cgroup의 자원 범위 안에서 실행합니다
한도가 설정된 Pod에서는 그 소비가 공유 한도와 메모리 압박에 영향을 줄 수 있습니다

API 타입은 임시 컨테이너의 자원 소비 때문에 Pod가 할당을 넘으면 kubelet이 축출할 수 있다고 설명합니다
실제 결과는 자원 한도·노드 압박·OOM·축출 경로의 조건에 따릅니다
직접 상태 집계에서 제외된다는 설명을 OOM이나 축출, sandbox 영향까지 없다는 보장으로 넓히면 안 됩니다

## kubectl debug의 프로파일은 API 권한을 대신하지 않습니다

`kubectl debug`는 Kubernetes API 자체와 구분해야 하는 클라이언트 기능입니다
[`debugByEphemeralContainer`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kubectl/pkg/cmd/debug/debug.go)는 임시 명세를 추가한 변경분을 만들고, `ephemeralcontainers` 서브리소스로 strategic merge patch를 보냅니다
`--target`은 이 명세의 `targetContainerName`으로 들어갑니다

`--profile`은 디버그 컨테이너에 적용할 `securityContext` 등의 속성을 구성합니다
같은 v1.37.1 kubectl 소스에서 기본값은 `general`입니다
현재 확인한 공식 작업 문서에는 기본 `legacy`라는 설명이 남아 있어, 이 부분은 확인한 kubectl 소스 버전과 구분해야 합니다

예를 들어 [`general` 프로파일](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kubectl/pkg/cmd/debug/profiles.go)은 임시 컨테이너에 `SYS_PTRACE` capability를 추가합니다
`restricted`는 비루트 실행·capability 제거·권한 상승 금지 등을 설정하고, `sysadmin`은 대상 디버그 컨테이너를 privileged로 설정합니다
이 값들이 프로세스 관측 가능성과 권한에 영향을 주어도 API 인가나 admission을 우회하지는 않습니다

Pod Security Admission의 적용 대상이면 임시 컨테이너 추가는 정책 재평가 대상입니다
[`isSignificantPodUpdate`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/pod-security-admission/admission/admission.go)가 새 임시 항목을 찾고, [정책의 컨테이너 순회](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/pod-security-admission/policy/visitor.go)도 임시 컨테이너를 포함합니다
프로파일이 만든 설정도 이 정책을 통과해야 합니다

### copy-to는 기존 Pod에 추가하는 동작과 다릅니다

`--copy-to`를 지정하면 kubectl은 기존 Pod에 임시 항목을 추가하는 대신 새 Pod를 만듭니다
복사본에서는 기존 컨테이너의 이미지나 명령을 바꾸거나 새 일반 컨테이너를 넣을 수 있으며, 생성할 수 있도록 `ephemeralContainers` 목록을 비웁니다

[`debugByCopy`와 `generatePodCopyWithDebugContainer`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kubectl/pkg/cmd/debug/debug.go)는 새 Pod 생성 요청을 사용합니다
복사본의 변경 가능성을 기존 Pod의 임시 항목 수정 권한으로 해석하면 안 됩니다

`--target`은 `--copy-to`와 함께 사용할 수 없고, 복사본의 프로세스 공유에는 `--share-processes`를 사용합니다
또한 복사 옵션에 `--replace`까지 지정하면 원본 Pod를 삭제하는 동작도 포함됩니다
같은 `kubectl debug` 명령이어도 실제 API 요청과 변경 대상을 확인해야 하는 이유입니다

## 거부 지점과 실행 실패를 나누어 확인합니다

| 메시지·현상 | 확인할 주체와 조건 |
|---|---|
| 생성 시 `cannot be set on create` | API 서버가 Pod 생성 명세의 임시 목록을 거부 |
| 본체 수정 시 `pod updates may not change fields other than ...` | `ephemeralcontainers` 서브리소스로 요청했는지 확인 |
| 레이블 변경이 반영되지 않음 | 서브리소스 전략이 기존 metadata로 복원했는지 확인 |
| `may not be removed`·`may not be changed` | 기존 임시 항목의 이름·내용이 유지되는지 확인 |
| `cannot be set for an Ephemeral Container` | 금지된 공통 필드와 subPath 설정 확인 |
| `targetContainerName: Not found` | 일반·init 명세에 대상 이름이 있는지 API 검증 |
| `static pods do not support ephemeral containers` | mirror Pod의 사본을 변경하려는 요청인지 확인 |
| `unable to find target container` | 명세 검증 이후 kubelet이 런타임 상태에서 대상 ID를 찾는 단계 |
| API 성공 후 시작하지 못함 | sandbox·이미지·대상 ID·런타임의 실행 결과 확인 |
| 종료 후 다시 시작하지 않음 | 임시 컨테이너의 의도된 재시작 제약과 런타임 상태 확인 |
| 프로세스가 보이지 않음 | PID 모드·target 지정·런타임 지원·Unix 권한 구분 |
| 프로파일을 바꿨는데 요청이 거부됨 | RBAC 인가와 적용 중인 admission 정책 확인 |

## 확인한 문서와 소스

- [Ephemeral Containers](https://kubernetes.io/docs/concepts/workloads/pods/ephemeral-containers/): 목적·안정화 버전·추가 전용 제약. 금지 필드의 전체 범위는 현행 검증 소스를 대조했습니다
- [Debug Running Pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/)와 [Share Process Namespace](https://kubernetes.io/docs/tasks/configure-pod-container/share-process-namespace/): target·런타임 지원과 프로세스 관측 범위. 프로파일 기본값은 본문의 kubectl 버전 구분을 따릅니다
- [KEP-277](https://github.com/kubernetes/enhancements/blob/0c8d11e9a13e12d2ef75d2d78af5ac00d8189046/keps/sig-node/277-ephemeral-containers/README.md): 서브리소스로 권한을 분리한 설계 이유와 실행·자원 보장의 한계
- [Pod API 타입](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/core/v1/types.go)과 [검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go): 허용 필드·대상 이름·명세 갱신·상태 전이의 계약
- [kubelet 컨테이너 GC](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_gc.go)와 [기본 보관 설정](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kubelet/app/options/options.go): Pod UID·컨테이너 이름별 종료 기록 보관
