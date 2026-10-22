---
title: "CRI와 OCI — 실행 요청과 bundle 설정의 경계를 구분합니다"
excerpt: "kubelet의 CRI 요청이 containerd·shim·runc로 이어지는 책임을 나눠 봅니다. sandbox와 create/start, OCI bundle과 자원 갱신, 이미지 정책·자격증명·backoff·GC가 각각 판단하는 범위를 확인합니다"
category: "kubernetes"
tags: ["Kubernetes", "CRI", "OCI", "containerd", "runc", "concept"]
series:
  name: "k8s-theory-node"
  order: 12
date: "2026-10-23"
---

kubelet은 컨테이너를 만들기 위해 runc를 직접 실행하지 않습니다
CRI를 구현한 런타임 서비스에 요청하고, 그 구현이 이미지와 파일시스템, 실행 설정을 준비합니다
Linux에서 containerd와 runc를 쓰는 경우에는 그 뒤에 shim을 거치는 실행 경계도 있습니다

이 경로에서 CRI는 요청 API를, OCI runtime specification은 컨테이너 설정과 표준 동작을 정합니다
같은 create라는 이름이 등장해도 각 계약에서 처리하는 대상과 시점은 다릅니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서, OCI Runtime Specification v1.3.0을 바탕으로 설명합니다
> Kubernetes ref: `f78e722310e50bcaca9276be22276d9e91d91308`, 공식 문서 저장본: `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 구현 예시는 containerd v2.4.2와 runc v1.5.2의 확인한 소스를 기준으로 합니다
> 실제 노드에 설치된 런타임이나 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## kubelet은 CRI 클라이언트이고 runc는 OCI 실행기입니다

**CRI(Container Runtime Interface)**는 kubelet과 컨테이너 런타임 사이의 gRPC 계약입니다
**OCI Runtime Specification**은 실행기가 준비된 설정으로 컨테이너 환경을 만들고 프로그램을 실행할 때 따라야 할 규격입니다

![kubelet의 CRI 요청이 containerd의 이미지·bundle 준비와 shim 호출을 거쳐 runc의 OCI 실행으로 이어지는 구현 예시|tall](/diagrams/k8s-theory-cri-oci-boundary-1.svg)

여기서 runtime이라는 단어는 문서에 따라 가리키는 범위가 다릅니다
Kubernetes에서 말하는 CRI 런타임과 OCI 용어집의 runtime을 구분해야 합니다

| 이 경로의 주체 | 맡는 책임 |
|---|---|
| kubelet | CRI 요청을 만들고 결과·상태를 읽음 |
| containerd의 CRI 구현 | 이미지·snapshot·OCI spec과 컨테이너 메타데이터 준비 |
| containerd-shim-runc-v2 | containerd의 실행 요청을 받고 runc를 호출하며 프로세스 수명을 관리 |
| runc | OCI 설정에 맞는 컨테이너 환경을 만들고 프로그램을 시작하는 실행기 |

[OCI 용어집](https://github.com/opencontainers/runtime-spec/blob/92249139eea7161e13745abd4cb6d0ea02a3227a/glossary.md)은 실행기를 호출하는 외부 프로그램을 **runtime caller**라고 부릅니다
containerd·CRI-O·Podman은 직접 호출자의 예이고 Kubernetes는 간접 호출자의 예입니다
이 구분은 구현 내부의 shim 같은 위임 단계가 없다는 뜻은 아닙니다

[containerd의 Runtime v2 문서](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/docs/runtime-v2.md)는 daemon, shim, runtime engine의 역할을 나눕니다
shim 하나가 반드시 컨테이너 하나만 관리해야 하는 것도 아닙니다
이 구조는 containerd+runc의 예이며 모든 CRI 구현이 같은 프로세스 구성을 쓰도록 OCI가 요구하지는 않습니다

## CRI는 실행 관리와 이미지 관리를 별도 서비스로 정의합니다

확인한 [`api.proto`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cri-api/pkg/apis/runtime/v1/api.proto)에는 `RuntimeService`와 `ImageService`가 있습니다

- **RuntimeService** — sandbox·컨테이너 생성과 종료, exec·attach, 상태·통계, 자원 갱신 등의 요청
- **ImageService** — 이미지 조회·pull·삭제·파일시스템 정보 요청

현재 ImageService는 `ListImages`, `StreamImages`, `ImageStatus`, `PullImage`, `RemoveImage`, `ImageFsInfo`를 정의합니다
이미지 조회의 스트리밍 RPC도 추가돼 있으므로 오래된 RPC 개수를 서비스의 고정 속성으로 읽으면 안 됩니다

kubelet의 `containerRuntimeEndpoint`와 `imageServiceEndpoint`는 두 서비스의 위치를 각각 지정합니다
이미지 엔드포인트가 비어 있으면 런타임 엔드포인트를 사용합니다
확인한 kubelet 설정의 런타임 엔드포인트 기본값은 `unix:///run/containerd/containerd.sock`입니다

두 서비스를 같은 프로세스나 소켓에 묶어야 하는 계약은 아닙니다
이미지 저장·전송과 컨테이너 실행 관리의 책임을 나누고 필요하면 다른 엔드포인트에 연결할 수 있습니다

[공식 CRI 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/containers/cri.md)는 v1.26부터 CRI `v1` 지원이 필수라고 설명합니다
런타임이 이를 지원하지 않으면 kubelet이 노드를 등록하지 못합니다
하지만 노드 등록 실패라는 증상만으로 CRI 버전 불일치를 확정할 수는 없으므로 실제 연결 오류도 함께 봐야 합니다

## sandbox를 먼저 준비하고 컨테이너를 생성합니다

sandbox는 Pod의 공유 실행 환경입니다
kubelet은 [`createPodSandbox`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_sandbox.go)에서 CRI `RunPodSandbox`에 설정과 런타임 핸들러 문자열을 별도 값으로 전달합니다
이 핸들러는 Pod가 참조한 RuntimeClass를 해석한 결과입니다

proto는 `RunPodSandbox`가 sandbox를 생성하고 시작하며, 성공 응답 시 sandbox가 ready여야 한다고 규정합니다
컨테이너마다 호출하는 `CreateContainer`와 `StartContainer`는 분리돼 있다는 차이가 있습니다

공유 환경을 먼저 준비하면 애플리케이션 컨테이너 하나의 재시작과 Pod 네트워크 환경의 수명을 분리할 수 있습니다
컨테이너의 `CrashLoopBackOff`와 sandbox 재생성을 같은 사건으로 읽으면 안 됩니다

### 모든 namespace를 새로 만들어 공유하는 것은 아닙니다

kubelet이 보내는 Linux sandbox 설정에는 `CgroupParent`와 namespace 옵션 등이 들어 있습니다
[`NamespacesForPod`와 관련 함수](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/util/util.go)는 Pod 설정에 따라 범위를 고릅니다

| 설정 예 | CRI namespace 범위 |
|---|---|
| 일반 Pod의 network | `POD` |
| `hostNetwork: true` | network는 `NODE` |
| 일반 Pod의 PID | `CONTAINER` |
| `shareProcessNamespace: true` | PID는 `POD` |
| `hostPID: true` | PID는 `NODE` |

Pod의 컨테이너가 network namespace를 공유한다고 해서 PID namespace까지 기본으로 모두 공유하는 것은 아닙니다
namespace를 공유하는 것과 cgroup의 자원 한도를 적용하는 것도 다른 역할입니다
kubelet은 관련 설정을 만들고 CRI 구현은 이를 자기 실행 설정으로 옮깁니다

현재 [`SyncPod`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_manager.go) 주석은 sandbox·컨테이너 변경 계산부터 일반 컨테이너 생성까지 아홉 단계를 적고 있습니다
sandbox 생성 뒤에는 Pod 상태 갱신을 알리는 `OnPodSandboxReady`가 있고, 자원 resize와 ephemeral·init·일반 컨테이너 처리가 이어집니다
이 단계들을 모든 Pod 동기화에서 무조건 새로 실행하는 것은 아니며 필요한 변경에 따라 처리합니다

## CRI create와 start 사이에는 컨테이너 ID 등록이 있습니다

[`startContainer`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_container.go)는 이미지 준비 뒤 CRI `CreateContainer`, `StartContainer` 순서로 요청합니다
이미지 준비는 정책에 따라 로컬 이미지를 쓰거나 ImageService에 pull을 요청하는 과정입니다

create 직전의 `PreCreateContainer`는 CPU manager의 CPU 집합과 memory manager의 NUMA 노드를 CRI 자원 설정에 넣습니다
`CpusetCpus`, `CpusetMems`는 실제 배정값이 있을 때 채워지며 모든 Pod에서 고정 CPU·NUMA 배정이 생긴다는 의미는 아닙니다

create가 ID를 반환하면 `PreStartContainer`가 CPU·memory·topology manager에 그 ID를 등록합니다
생성 전에는 ID가 없고 실행 시작 전에는 등록을 마쳐야 하므로 두 훅의 시점이 다릅니다
이 훅은 kubelet 내부 자원 관리 훅이며 Pod의 `postStart`나 OCI lifecycle hook과도 구분해야 합니다

![CRI CreateContainer 뒤 ID를 등록하고 CRI StartContainer를 호출하며 containerd 내부 OCI create/start의 실제 대응을 구분한 흐름|tall](/diagrams/k8s-theory-cri-oci-boundary-2.svg)

containerd 구현에서는 같은 create라는 단어에 특히 주의해야 합니다
확인한 [`CreateContainer`](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/server/container_create.go)는 OCI spec·snapshot·메타데이터를 준비하고 containerd 컨테이너를 등록합니다
[`StartContainer`](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/server/container_start.go)는 `container.NewTask`로 실행 task를 만든 뒤 `task.Start`를 호출합니다

이 일반 경로에서 shim의 task 생성은 runc의 OCI create로, task 시작은 OCI start로 이어집니다
따라서 CRI `CreateContainer`가 곧 OCI create를 호출하는 시점이라고 일대일로 대응시키면 실제 구현을 잘못 설명하게 됩니다

## OCI bundle은 실행 설정이며 명령줄 API가 아닙니다

[filesystem bundle 규격](https://github.com/opencontainers/runtime-spec/blob/92249139eea7161e13745abd4cb6d0ea02a3227a/bundle.md)은 실행에 필요한 설정과 파일시스템을 로컬에서 전달하는 형식을 정의합니다
`config.json`은 bundle의 최상위에 있어야 하는 필수 파일이며 이름도 고정입니다
root 파일시스템은 설정의 `root.path`가 가리키는 디렉터리입니다
`rootfs`라는 디렉터리 이름 자체가 모든 구현의 필수 이름은 아닙니다

Linux의 `root.path`는 절대 경로 또는 bundle 기준 상대 경로일 수 있습니다
확인한 containerd의 [`NewBundle`](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/core/runtime/v2/bundle.go)은 bundle 디렉터리와 `rootfs`를 준비하고 OCI spec을 `config.json`에 씁니다
runc는 이 준비된 bundle을 받아 환경을 만듭니다

[OCI runtime 규격](https://github.com/opencontainers/runtime-spec/blob/92249139eea7161e13745abd4cb6d0ea02a3227a/runtime.md)은 `create`, `start`, `kill`, `delete`, `state` 등의 동작과 입력을 정합니다
create의 입력은 컨테이너 ID와 bundle 경로이고, start는 생성된 컨테이너 ID를 입력으로 받습니다
이 표기는 명령줄 API를 지정하는 것이 아니라고 규격이 명시합니다

runc의 명령줄은 실제 호출 인터페이스의 한 예입니다
OCI가 모든 실행기에 같은 CLI나 gRPC 서비스를 강제하는 것은 아닙니다
containerd의 shim API 역시 CRI나 OCI가 정한 요청 API와 별도입니다

### 환경 생성과 사용자 프로그램 실행도 나뉩니다

OCI create는 `process`를 제외한 설정을 적용하지만 사용자 프로그램을 아직 실행하면 안 됩니다
`process.args`는 start 전까지 적용하지 않고, 다른 process 속성은 create에서 적용할 수 있습니다
create와 start 사이에는 규격에 정의한 lifecycle hook도 실행됩니다

같이 create/start가 나뉘어 있어도 OCI hook과 kubelet의 자원 매니저 등록은 서로 다른 단계입니다
containerd 예시에서 두 계약의 호출 대응이 다른 이유도 함께 구분해야 합니다

### config.json 수정과 실행 중 자원 갱신은 다른 경로입니다

OCI는 create 이후 `config.json`을 고쳐도 이미 생성된 컨테이너에 영향을 주지 않는다고 규정합니다
파일을 수정하는 것으로 실행 중인 프로세스의 cgroup 설정까지 갱신할 수는 없습니다

kubelet의 [`updateContainerResources`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_container.go)는 원하는 자원 설정을 조립해 CRI `UpdateContainerResources`를 호출합니다
그 요청을 받아 실제로 적용하는 것은 런타임의 별도 갱신 경로입니다
지원 조건과 resize 처리 결과를 확인해야 하며, OCI bundle을 다시 읽게 만드는 요청으로 해석하면 안 됩니다

## namespace와 cgroup 값도 OCI 설정으로 옮깁니다

[OCI Linux 설정](https://github.com/opencontainers/runtime-spec/blob/92249139eea7161e13745abd4cb6d0ea02a3227a/config-linux.md)은 namespace마다 기존 경로에 참여할지 새로 만들지 정합니다
해당 type과 `path`가 있으면 기존 namespace에 참여하고, type만 있고 path가 없으면 새로 만듭니다
type 자체가 빠져 있으면 실행기의 해당 namespace를 상속합니다

`linux.cgroupsPath`는 프로세스를 붙일 cgroup 위치를 지정하고, `linux.resources`는 자원 제한 설정을 담습니다
따라서 Pod 설정, CRI의 자원 구조체, OCI의 Linux 설정, 실제 cgroup 파일은 역할이 다른 단계입니다
[QoS와 cgroup 변환](/essays/k8s-theory-qos-cgroups)에서 본 kubelet의 값을 런타임 입력에 담았다는 것과 실제 노드의 파일 값까지 확인했다는 것은 다릅니다

## 이미지 관리가 끝나야 실행기에 root 파일시스템을 줄 수 있습니다

OCI runtime 규격은 준비된 bundle로 컨테이너를 실행하는 계약입니다
레지스트리에서 이미지를 pull하라는 CRI 요청을 runc가 받는 구조가 아닙니다
OCI image specification은 이미지 형식의 별도 규격입니다
runtime 설정에 이미지 관련 annotation이 들어갈 수 있다는 사실도 pull 책임을 실행기로 옮기지는 않습니다

확인한 containerd의 [이미지 pull 구현](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/server/images/image_pull.go)은 pull과 unpack을 처리합니다
이후 snapshot과 root 파일시스템, 실행 설정을 준비해 실행 경로에 전달합니다
이미지 문제를 OCI 실행기의 create 오류와 같은 단계로 묶지 않아야 합니다

### imagePullPolicy의 기본값은 이미지 이름으로 정합니다

[`SetDefaults_Container`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/v1/defaults.go)는 정책이 비어 있으면 이미지 이름의 태그를 확인합니다
태그와 digest가 모두 없으면 파서가 `latest`로 해석합니다

| 이미지 표기 예 | 생략한 정책의 기본값 |
|---|---|
| `nginx` | `Always` |
| `nginx:latest` | `Always` |
| `nginx:1.27` | `IfNotPresent` |
| `nginx@sha256:…` | `IfNotPresent` |

digest만 지정한 마지막 행과 `latest` 태그를 함께 쓴 표기는 구분해야 합니다
이 defaulting 코드는 태그를 검사하므로 digest가 있다는 사실만으로 모든 표기의 기본 정책을 같다고 단정하지 않습니다

`Always`는 컨테이너를 시작할 때 런타임에 pull을 요청한다는 뜻입니다
매번 모든 이미지 layer를 새로 내려받는다는 뜻은 아니며, 런타임은 이미 있는 layer를 재사용할 수 있습니다

### 로컬 이미지도 자격증명 확인 대상일 수 있습니다

`imagePullSecrets`는 Pod가 참조한 Secret을 읽어 pull 자격증명에 사용하는 경로입니다
노드의 credential provider 등 다른 자격증명 경로도 있으므로 Secret 하나를 못 읽었다고 반드시 이미지 pull 전체가 실패하는 것은 아닙니다

현재 [`getPullSecretsForPod`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kubelet_pods.go)는 읽지 못한 Secret을 건너뛰고 그 이름을 별도로 반환합니다
`FailedToRetrieveImagePullSecret` 이벤트는 조회 실패만으로 즉시 기록하지 않습니다
같은 sync에서 실제 `ErrImagePull` 결과가 함께 있었을 때 kubelet이 기록합니다
따라서 이 이벤트가 없다고 Secret을 모두 읽었다고 판단할 수도 없습니다

`KubeletEnsureSecretPulledImages`는 확인한 버전에서도 Beta이며 기본 on입니다
기본 `imagePullCredentialsVerificationPolicy`는 `NeverVerifyPreloadedImages`입니다
kubelet이 pull한 기록이 있는 이미지는 자격증명을 확인하고, kubelet 밖에서 미리 적재돼 관련 기록이 없는 이미지는 기본 정책의 확인 대상에서 제외합니다
게이트를 켠 시점에 kubelet의 pull 기록이 없는 로컬 이미지도 이 예외에 포함될 수 있습니다
`AlwaysVerify`는 사전 적재 이미지도 확인 범위에 넣습니다

자격증명 확인이 매번 레지스트리 재다운로드를 뜻하는 것은 아닙니다
이미 성공한 자격증명 기록으로 로컬 확인을 마칠 수도 있습니다
이 때문에 이벤트의 `already present on machine and can be accessed by the pod` 문구만으로 모든 이미지에 네트워크 검증을 수행했다고 읽으면 안 됩니다

## ImagePullBackOff는 실제 pull 실패 뒤의 대기입니다

[`imageManager.pullImage`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/images/image_manager.go)는 `<Pod UID>_<이미지>`를 키로 backoff를 기록합니다
같은 이미지여도 다른 Pod의 실패 대기 시간을 노드 전체에서 하나로 공유하지 않습니다
기본 시작값은 10초, 상한은 5분입니다

대기가 남으면 pull을 다시 시도하지 않고 `ImagePullBackOff`를 반환합니다
이전의 실제 pull 오류를 message에 덧붙이므로, 현재 대기 reason과 그 대기를 만든 원인을 나눠 읽어야 합니다
이것은 애플리케이션 컨테이너가 반복 종료되는 `CrashLoopBackOff`와도 다릅니다

| 오류·reason | 이 경로에서 뜻하는 것 |
|---|---|
| `ErrImagePull` | 실제 pull 시도가 실패한 일반 오류 |
| `RegistryUnavailable` | CRI가 구분해 보고한 레지스트리 접근 오류 |
| `SignatureValidationFailed` | CRI가 구분해 보고한 서명 검증 오류 |
| `ImagePullBackOff` | 앞선 실패 뒤 아직 재시도 대기 중 |
| `ErrImageNeverPull` | Never 정책에서 로컬 이미지가 없거나 현재 접근 검증을 통과하지 못해 사용할 수 없음 |
| `CreateContainerConfigError` | CreateContainer 호출 전 설정 조립 등의 실패 |
| `PreCreateHookError` | kubelet 내부 생성 전 훅 실패 |
| `CreateContainerError` | CRI CreateContainer 호출 실패 |
| `PreStartHookError` | 생성 후 kubelet 내부 ID 등록 훅 실패 |

`evalCRIPullErr`는 레지스트리·서명 오류를 구분해 전달하고 다른 pull 오류는 `ErrImagePull`로 분류합니다
표는 소스의 오류 분류 분기이며 이 글에서 실행해 수집한 오류 목록은 아닙니다
확인한 Linux의 `PreCreateContainer`와 `PreStartContainer` 구현은 매니저 처리를 마친 뒤 `nil`을 반환하므로, 오류 이름이 있다는 사실만으로 현재 구현에서 그 오류가 실제 발생했다고 판단하지는 않습니다
또한 CRI StartContainer에서 실패한 경우는 이미 CreateContainer를 통과한 것이므로, 원래의 런타임 오류와 이벤트를 확인해야 합니다

## 이미지 GC는 시작 임계값과 삭제 목표를 나눕니다

kubelet의 기본 이미지 GC 확인 주기는 5분이고, 종료한 컨테이너 GC는 1분입니다
이미지 GC는 디스크 사용률이 높은 임계값에 닿으면 낮은 목표까지 내릴 공간을 계산해 삭제를 시도합니다

| 설정 | 기본값 | 역할 |
|---|---:|---|
| `imageGCHighThresholdPercent` | 85 | 디스크 사용률에 따른 정리 시작 |
| `imageGCLowThresholdPercent` | 80 | 확보하려는 여유 공간 계산의 목표 |
| `imageMinimumGCAge` | 2분 | 공간 확보 정리에서 너무 최근 발견한 이미지 제외 |
| `imageMaximumGCAge` | 0 | 사용하지 않은 기간에 따른 정리 비활성 |

[`GarbageCollect`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/images/image_gc_manager.go)는 마지막 사용 시각이 오래된 이미지부터 삭제 후보를 봅니다
사용 중이거나 런타임이 pinned로 표시한 이미지는 제외하므로 목표 공간을 항상 확보할 수 있는 것은 아닙니다
삭제해도 부족하면 `FreeDiskSpaceFailed` 이벤트를 남길 수 있습니다

85%에서 조금만 정리하고 멈추면 다음 pull 뒤 다시 경계에 닿기 쉽습니다
80%라는 별도 목표를 두는 것은 한 번 정리할 때 여유를 확보해 반복 정리를 줄이려는 형태입니다
[node-pressure eviction](/essays/k8s-theory-eviction-oom)의 노드 자원 회수와도 연결되지만, 여기서 우선 정리하는 대상은 이미지입니다

`imageMaximumGCAge`를 설정하면 디스크 사용률과 별개로 오래 사용하지 않은 이미지도 정리할 수 있습니다
이 사용 시각 추적은 kubelet 재시작을 넘어 보존되지 않습니다
따라서 재시작 전부터 사용하지 않은 기간이 그대로 이어진다고 기대해서는 안 됩니다

## 확인한 근거

- [CRI api.proto](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cri-api/pkg/apis/runtime/v1/api.proto), [kubelet runtime manager](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_manager.go), [컨테이너 생성·갱신](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_container.go) — RPC와 호출 순서
- [Linux 생성 전 훅](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/cm/internal_container_lifecycle_linux.go), [ID 등록 훅](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/cm/internal_container_lifecycle.go) — CPU·NUMA 배정값과 manager 등록
- [containerd v2.4.2 Runtime v2 문서](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/docs/runtime-v2.md), [shim의 process 구현](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/cmd/containerd-shim-runc-v2/process/init.go), [runc v1.5.2](https://github.com/opencontainers/runc/blob/29dd3dc2b13b4123162e5fe132504bb4b15569f1/README.md) — 구현별 호출 책임
- [OCI runtime-spec v1.3.0](https://github.com/opencontainers/runtime-spec/tree/92249139eea7161e13745abd4cb6d0ea02a3227a) — 확인 ref `92249139eea7161e13745abd4cb6d0ea02a3227a`, bundle·runtime·glossary·Linux 설정
- [공식 Images 문서 저장본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/containers/images.md)과 [Garbage Collection 문서 저장본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/architecture/garbage-collection.md) — 이미지 정책·접근 확인·정리 범위
