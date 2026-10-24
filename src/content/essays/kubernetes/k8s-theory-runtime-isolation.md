---
title: "런타임 격리 — 생략한 보안 설정은 필드마다 다르게 적용됩니다"
excerpt: "securityContext가 PSA·kubelet·CRI·런타임을 거쳐 적용되는 경계를 살펴봅니다. seccomp와 AppArmor의 기본 처리, privileged와 capability, user namespace의 UID 매핑, 정책 버전과 RuntimeClass의 역할을 구분합니다"
category: "kubernetes"
tags: ["Kubernetes", "SecurityContext", "PodSecurityAdmission", "UserNamespace", "RuntimeClass", "concept"]
series:
  name: "k8s-theory-node"
  order: 14
date: "2026-09-20"
---

Pod의 보안 필드를 생략했다고 모든 제한이 꺼지거나 같은 기본값이 적용되지는 않습니다
seccomp 프로필을 생략하면 kubelet이 명시적인 값을 만들지만, AppArmor 프로필을 생략하면 런타임에 전달하는 값을 비웁니다
capability 목록을 비우는 것과 모든 capability를 제거하는 것도 다른 설정입니다

이 차이를 알아야 API에서 허용한 Pod가 노드에서 생성에 실패하거나, baseline 보안 정책을 통과해도 기대한 제약이 적용되지 않는 이유를 설명할 수 있습니다
Linux의 보안 설정을 중심으로 API의 검사와 실제 실행 경계를 나눠 보겠습니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 실제 클러스터의 보안 설정이나 커널 동작을 재현한 실측 기록은 포함하지 않습니다

## API 허용과 노드에서의 적용은 다른 판단입니다

API validation은 필드 값과 조합이 유효한지 검사합니다
Pod Security Admission, 줄여서 PSA는 namespace의 보안 정책에서 그 선언을 허용하는지 검사합니다
kubelet은 Pod 설정과 이미지 정보를 읽어 CRI 보안 설정을 만들고, 런타임은 노드에서 그 설정을 적용합니다

![API validation과 PSA가 선언의 유효성과 정책을 검사한 뒤 kubelet이 생략 값과 이미지 사용자를 해석하고 런타임이 노드에서 적용하는 경계|tall](/diagrams/k8s-theory-runtime-isolation-1.svg)

seccomp 프로필 파일이 노드에 있는지, 선택한 런타임이 user namespace를 지원하는지 같은 조건은 필드 값과 조합만 검사해서 확정할 수 없습니다
[CRI와 OCI의 경계](/essays/k8s-theory-cri-oci-boundary)에서 본 것처럼, kubelet이 전달할 설정을 조립하는 일과 런타임이 실행 환경을 만드는 일도 나뉘어 있습니다

## securityContext의 위치는 적용 범위와 연결됩니다

Pod 수준은 `spec.securityContext`, 컨테이너 수준은 `spec.containers[].securityContext`에 둡니다
일반 컨테이너뿐 아니라 init·ephemeral container에도 관련 보안 필드가 있으므로 정책을 확인할 때 대상 목록을 함께 봐야 합니다

| 위치 | 주요 필드 | 설정 범위 |
|---|---|---|
| 컨테이너 전용 | `capabilities`·`privileged`·`allowPrivilegeEscalation`·`readOnlyRootFilesystem`·`procMount` | 해당 컨테이너의 프로세스와 파일시스템 제약 |
| Pod 전용 | `fsGroup`·`fsGroupChangePolicy`·`supplementalGroups`·`sysctls`·`seLinuxChangePolicy` | 공유 볼륨·그룹·커널 설정 등 |
| 양쪽 | `runAsUser`·`runAsGroup`·`runAsNonRoot`·`seLinuxOptions`·`seccompProfile`·`appArmorProfile` | 컨테이너 값 우선, 세부 해석 경로는 필드마다 다름 |

`hostNetwork`·`hostPID`·`hostIPC`·`hostUsers`는 securityContext 밖의 Pod spec 필드입니다
이를 읽어 sandbox와 컨테이너의 namespace 옵션을 정합니다

그러나 모든 namespace를 Pod 전체가 공유하는 것은 아닙니다
[`PidNamespaceForPod`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/util/util.go)는 기본 PID 모드를 `CONTAINER`로 정합니다
`shareProcessNamespace: true`이면 `POD`, `hostPID: true`이면 `NODE`입니다
네트워크·IPC·사용자 namespace도 각 필드의 조건으로 따로 결정합니다

### 공통 병합과 프로필 선택은 별도 경로입니다

[`DetermineEffectiveSecurityContext`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/securitycontext/util.go)의 공통 병합은 Pod에서 `runAsUser`·`runAsGroup`·`runAsNonRoot`·`seLinuxOptions`·`windowsOptions`를 가져옵니다
컨테이너에도 같은 필드를 지정했다면 그 값을 우선합니다

seccomp과 AppArmor는 이 다섯 필드에 포함되지 않습니다
별도 함수가 다음 순서로 값을 찾습니다

| 설정 | 선택 순서 |
|---|---|
| seccomp | 컨테이너 → Pod → kubelet의 `seccompDefault` |
| AppArmor | 컨테이너 → 기존 annotation → Pod → 런타임 기본 처리 |

AppArmor의 annotation 경로는 static Pod처럼 annotation이 필드로 동기화되지 않은 입력을 처리하기 위해 남아 있습니다
실제 우선순위는 [`apparmor.GetProfile`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/security/apparmor/helpers.go)에 있습니다

## capability·seccomp·AppArmor·SELinux는 제한하는 대상이 다릅니다

capability는 Linux 특권을 동작별 권한으로 나눈 것입니다
`add`·`drop`은 그 목록에서 권한을 더하거나 뺍니다
어떤 syscall을 허용할지 정하는 seccomp과는 다른 기전입니다

seccomp는 프로세스가 커널 기능을 요청하는 시스템 호출을 필터링합니다
AppArmor는 프로그램의 파일·네트워크 등 자원 접근을 프로필로 제한하고, SELinux는 프로세스와 자원의 보안 라벨에 적용한 정책으로 접근을 판단합니다
같은 접근 실패여도 어떤 기전이 거부했는지 구분해야 합니다

이 역할과 지원 조건은 [Linux kernel security constraints 공식 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/security/linux-kernel-security-constraints.md)에 설명되어 있습니다
AppArmor·SELinux는 노드의 커널과 정책 지원을 전제로 하며, YAML에 이름을 적는 것만으로 정책이 배포되지는 않습니다

### 생략할 때 kubelet이 보내는 값

다음 표는 다른 수준에서도 해당 값을 지정하지 않은 일반 경로입니다
노드에 적용된 결과와 CRI에 전달할 값을 구분합니다

| 생략한 필드 | kubelet의 CRI 처리 |
|---|---|
| `privileged` | false |
| `capabilities` | capability 설정을 비워 런타임 기본 집합 사용 |
| `allowPrivilegeEscalation` | `NoNewPrivs`를 켜지 않음 |
| `seccompProfile` | `seccompDefault: false`이면 `Unconfined`, true이면 `RuntimeDefault` |
| `appArmorProfile` | 프로필 값을 비워 런타임 기본 처리에 맡김 |
| `seLinuxOptions` | 명시적 SELinux 옵션을 비움. 노드 정책이 꺼진다는 뜻은 아님 |
| `readOnlyRootFilesystem` | 읽기 전용 rootfs 요청을 켜지 않음 |
| `procMount` | 기본 masked·readonly 경로를 전달 |

[`getSeccompProfile`·`getAppArmorProfile`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/helpers.go)과 [`determineEffectiveSecurityContext`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/security_context.go)가 이 차이를 만듭니다
kubelet의 [기본 `seccompDefault`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/apis/config/v1beta1/defaults.go)는 false입니다
baseline이 명시적인 Unconfined를 금지해도 프로필 생략을 허용한다는 사실을 이 기본값과 함께 봐야 합니다

`allowPrivilegeEscalation: false`일 때만 kubelet이 `no_new_privs`를 요청합니다
생략하면 이 상승 금지 플래그를 요청하지 않습니다
그렇다고 모든 권한 상승이 실제로 가능하다는 뜻은 아니며 다른 권한·커널 조건도 적용됩니다

기본 procMount는 고정된 masked 경로 12개에 노드에서 존재하는 CPU별 `thermal_throttle` 경로가 더해질 수 있습니다
읽기 전용 경로는 5개입니다
따라서 현행 masked 경로 수를 모든 노드에서 정확히 12개라고 단정해서는 안 됩니다
계산은 [`ConvertToRuntimeMaskedPaths`·`ConvertToRuntimeReadonlyPaths`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/securitycontext/util.go)에 있습니다

capability 목록은 kubelet이 CRI의 추가·제거 목록으로 전달합니다
[CRI Capability 규약](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cri-api/pkg/apis/runtime/v1/api.proto)은 drop을 모든 집합에서 제거하고, 일반 add를 ambient를 제외한 집합에 추가하도록 정합니다
kubelet의 이 변환은 별도 ambient 추가 목록을 채우지 않습니다

## privileged는 여러 제약을 함께 바꾸는 요청입니다

`privileged: true`는 API와 CRI에서는 bool 하나지만 런타임이 적용하는 효과는 여러 가지입니다
[`LinuxContainerSecurityContext` 규약](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cri-api/pkg/apis/runtime/v1/api.proto)은 모든 capability 추가, 민감 경로 마스킹 해제, sysfs·procfs 읽기·쓰기 마운트, 호스트 장치 노출과 device cgroup 제한 해제를 열거합니다
AppArmor·seccomp·SELinux의 제약을 적용하지 않는다는 조건도 포함합니다

따라서 특권 모드에 개별 프로필을 함께 적었다는 이유로 그 제한이 유지된다고 기대해서는 안 됩니다
같은 규약은 privileged에서 capability·SELinux·seccomp·AppArmor 옵션이 효과가 없을 수 있다고 명시합니다

API 검증도 일부 조합을 거부합니다
[`ValidateSecurityContext`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go)는 `privileged: true`와 `allowPrivilegeEscalation: false`의 조합을 거부합니다
추가 capability 문자열 `CAP_SYS_ADMIN`과 false를 검사하는 분기도 있으며, 기존 Pod를 위한 호환 허용 조건이 별도로 있습니다
이 분기의 문자열 비교를 모든 capability 표기의 정규화·검증 보장으로 확대하지 않습니다

`procMount: Unmasked`를 사용하려면 API 검증에서 `hostUsers: false`도 요구합니다
이는 PSA 라벨과 별도의 필드 조합 검사입니다

클러스터 전체의 `--allow-privileged` 설정도 별도입니다
고정 소스의 [`NewServerRunOptions`·플래그 등록](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kube-apiserver/app/options/options.go)에서 기본은 false이며, 허용하지 않으면 `disallowed by cluster policy`로 거부합니다
배포 도구가 실제로 이 값을 어떻게 설정했는지는 노드·API 서버 설정에서 확인해야 합니다

## baseline의 금지와 restricted의 명시 요구를 나눠 봅니다

Pod Security Standards는 privileged·baseline·restricted 수준을 정의하고 PSA가 이를 검사합니다
privileged 수준은 PSA 제약을 적용하지 않는 수준이며, 컨테이너의 `privileged: true`를 자동으로 넣는 설정은 아닙니다
restricted는 baseline의 통제와 추가 조건을 적용합니다

baseline은 hostNetwork·hostPID·hostIPC·특권 컨테이너·hostPath와 0이 아닌 hostPort 등을 제한합니다
추가할 capability는 지정한 13종 안으로 제한하며, AppArmor·SELinux·procMount·seccomp에도 허용값을 정합니다
v1.34 정책부터는 probe와 lifecycle hook의 `host` 필드 제한도 포함합니다

일반 Linux Pod에서 restricted의 주요 추가 조건은 다음과 같습니다

| 통제 | 요구하거나 허용하는 값 |
|---|---|
| 권한 상승 방지 | 컨테이너별 `allowPrivilegeEscalation: false` |
| 비 root 실행 선언 | Pod 또는 컨테이너에서 유효한 `runAsNonRoot: true` |
| 실행 UID | 명시한 `runAsUser`가 0이면 거부. 생략은 별도 non-root 검사와 함께 판단 |
| seccomp | Pod 또는 각 컨테이너의 `RuntimeDefault`·`Localhost` |
| capability | `drop: [ALL]`, 다시 add할 수 있는 것은 `NET_BIND_SERVICE` |

이 조건을 읽을 때는 필드를 생략한 경우, 즉 nil일 때의 동작도 함께 봐야 합니다
가령 allowPrivilegeEscalation은 생략해도 false가 되지 않으므로 false 명시가 필요합니다
capability를 생략해도 런타임 기본 집합이 남으므로 ALL 제거가 필요합니다

restricted의 볼륨 허용 목록은 `configMap`, `csi`, `downwardAPI`, `emptyDir`, `ephemeral`, `persistentVolumeClaim`, `projected`, `secret`입니다
전체 필드·운영체제·정책 버전 조건은 [Pod Security Standards](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/security/pod-security-standards.md)에서 확인해야 합니다
위 표가 Windows Pod나 뒤에서 설명할 user namespace 예외까지 같은 방식으로 검사한다는 뜻은 아닙니다

### 정책에는 수준과 버전이 함께 있습니다

namespace 라벨 `pod-security.kubernetes.io/` 아래 `enforce`·`audit`·`warn`은 모드별 수준을 정합니다
`enforce-version`·`audit-version`·`warn-version`은 각 정책 버전을 `latest` 또는 `v1.35` 같은 값으로 선택합니다

latest는 API 서버 업그레이드에 따라 검사하는 정책도 달라질 수 있습니다
이전 버전에 고정하면 이후 추가된 제한뿐 아니라 새 완화도 적용받지 못합니다
따라서 restricted라는 수준만으로 허용 여부를 판단해서는 안 됩니다

[`Admission.EvaluatePod`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/pod-security-admission/admission/admission.go)의 거절 메시지는 `violates PodSecurity` 뒤에 수준과 버전을 표시합니다
Deployment 같은 워크로드 요청의 audit·warn과 실제 Pod 생성에 적용하는 enforce도 구분합니다
Deployment가 저장되어도 그 컨트롤러가 만드는 Pod는 정책에 거부될 수 있습니다

## kubelet은 runAsNonRoot에 따라 이미지 사용자도 검사합니다

PSA는 이미지를 가져와 실행 UID를 확인하지 않습니다
`runAsNonRoot: true`를 요구할 수는 있지만 그 선언만으로 이미지가 비 root로 실행될지 확정할 수 없습니다

[`verifyRunAsNonRoot`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/security_context_others.go)는 유효한 runAsUser가 있으면 그 값을 먼저 검사합니다
0이면 거부하고, 없으면 이미지의 사용자 정보를 확인합니다
이미지 UID가 0이면 거부하며, 숫자가 아닌 사용자 이름만 있으면 non-root 여부를 확인할 수 없다는 오류를 반환합니다

이 오류는 컨테이너 생성 설정 실패로 나타납니다
`CreateContainerConfigError`라는 상태 이름은 [ConfigMap·Secret 참조 실패](/essays/k8s-theory-configmap-secret-delivery)에서도 나오므로 실제 message를 함께 봐야 합니다
API admission에서 거절한 것과 노드에서 이미지 사용자 검사에 실패한 것은 다른 단계입니다

## user namespace는 남은 capability의 유효 범위를 제한합니다

`hostUsers: false`는 Pod 안의 UID·GID를 호스트의 다른 범위로 매핑하도록 요청합니다
컨테이너 안에서 UID 0이어도 호스트에서는 다른 비특권 UID로 나타날 수 있습니다
capability 목록을 줄이는 것과 그 capability가 유효한 namespace 범위를 줄이는 것은 다른 제어입니다

![서로 다른 Pod의 컨테이너 UID 0을 호스트의 겹치지 않는 UID 범위로 매핑하는 예시](/diagrams/k8s-theory-runtime-isolation-2.svg)

[User Namespaces 공식 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/workloads/pods/user-namespaces.md)는 `CAP_SYS_MODULE`이 이 Pod에서 효력이 없고, `CAP_SYS_ADMIN`은 Pod의 user namespace 밖에서 효력이 없다고 설명합니다
호스트 커널의 취약점까지 제거하거나 VM 경계를 만드는 기능은 아닙니다

기본 매핑 크기는 Pod당 65536개이며 서로 겹치지 않게 할당합니다
시작 호스트 UID와 할당 범위에는 정렬·subordinate ID 조건이 있고, `idsPerPod`로 Pod당 크기를 지정할 수 있습니다
runAsUser·fsGroup 같은 값은 컨테이너 안의 신원을 가리키며 볼륨 공유를 위한 idmapped mount 조건도 함께 적용합니다

### gate가 안정화되어도 노드 지원과 API 제약은 남습니다

v1.37.1의 `UserNamespacesSupport`와 `ProcMountType`은 v1.36부터 GA·기본 on·잠김입니다
hostUsers를 생략하거나 true로 쓰면 별도 Pod user namespace를 요청하지 않습니다
[`GetOrCreateUserNamespaceMappings`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/userns/userns_manager.go)는 false일 때 선택한 RuntimeClass 핸들러의 user namespace 지원 여부부터 검사합니다

파일시스템의 idmap mount 지원 때문에 공식 문서는 실용적으로 Linux 6.3 이상을 요구합니다
확인한 지원 기준은 containerd 2.0 이상 또는 CRI-O 1.25 이상, 그 아래 runc 1.2 이상 또는 crun 1.9 이상입니다
이것은 설치된 노드의 버전을 확인한 결과가 아니며, 해당 런타임 설정과 볼륨 파일시스템도 지원해야 합니다

일반 생성 경로에서는 hostPID·hostIPC·raw block `volumeDevices`를 함께 사용할 수 없습니다
hostNetwork도 기본적으로 금지하지만 Alpha·기본 off인 `UserNamespacesHostNetworkSupport`를 켠 경로는 예외입니다
이미 그 설정이 있는 Pod의 갱신 호환 조건은 새 Pod 허용 조건과 다릅니다
현행 조건은 [`validateHostUsers`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go)와 [`PodValidationOptions`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/api/pod/util.go)에 있습니다

### PSA 완화는 정책 버전 v1.35부터 적용합니다

`hostUsers: false`이면 v1.35 이상의 정책에서 restricted의 runAsNonRoot·runAsUser 통제를 완화합니다
baseline의 procMount 제한도 완화하지만 restricted의 procMount 제한은 유지합니다

이는 제거된 `UserNamespacesPodSecurityStandards` gate를 켜서 적용하는 기능이 아닙니다
[`runAsNonRoot1_35`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/pod-security-admission/policy/check_runAsNonRoot.go)와 [`procMount restricted 검사`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/pod-security-admission/policy/check_procMount_restricted.go)가 정책 버전과 hostUsers 조건으로 나눕니다
namespace가 이전 enforce-version에 고정되어 있으면 같은 Pod도 그 완화를 받지 못합니다

## SELinux의 프로세스 라벨과 볼륨 적용 방식도 구분합니다

`seLinuxOptions`는 user·role·type·level 값을 CRI로 전달하며, 실제 접근 판단은 노드의 SELinux 정책이 합니다
Pod와 컨테이너의 라벨 선택, 공유 볼륨에 라벨을 적용하는 방식은 같은 필드 하나로 모두 결정하지 않습니다

`seLinuxChangePolicy`는 Pod 수준의 볼륨 적용 정책입니다
현재 [security context 공식 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/tasks/configure-pod-container/security-context.md)는 생략 또는 MountOption과 Recursive를 구분합니다
실제 mount option 적용은 볼륨 종류·드라이버 등의 지원 조건을 따릅니다

[`feature gate 등록`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go)에서 `SELinuxChangePolicy`는 v1.36 GA·잠김, `SELinuxMount`는 v1.37 GA·기본 on이지만 아직 잠기지 않았습니다
GA라는 상태만으로 모든 gate가 같은 시점에 잠겼거나 모든 볼륨에 같은 방식으로 적용된다고 보아서는 안 됩니다

## RuntimeClass는 핸들러를 고르고 PSA는 필드를 검사합니다

RuntimeClass의 `handler`는 노드 런타임에 등록된 구현을 선택하는 문자열입니다
`metadata.name`으로 RuntimeClass를 참조하고 kubelet이 handler를 조회해 `RunPodSandbox`의 별도 인자로 넘깁니다
같은 오브젝트의 overhead·scheduling은 자원 계산과 배치 조건에 쓰이며, 격리 구현 자체와 구분합니다

capability·seccomp·user namespace는 일반적으로 같은 노드 커널이 집행합니다
RuntimeClass는 다른 격리 방식을 선택할 수도 있습니다
예를 들어 공식 user namespace 문서는 Kata Containers의 VM 기반 격리를 Linux namespace 기반 런타임과 구분합니다
핸들러 이름만 지정했다고 해당 구현이나 필요한 노드 설정이 자동 설치되는 것은 아닙니다

[Pod Security Standards의 sandbox FAQ](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/security/pod-security-standards.md#what-about-sandboxed-pods)는 gVisor·Kata 같은 런타임을 식별할 수 있어도 sandbox 런타임을 정의하는 공통 API 표준은 없다고 설명합니다
PSA는 handler 내부의 격리 보증을 판정하지 않으므로, 별도 sandbox 런타임이라는 이유만으로 baseline의 privileged 제한을 자동 면제하지 않습니다

PSA 기동 설정의 `exemptions.runtimeClasses`는 특정 RuntimeClass를 검사에서 제외할 수 있습니다
이것은 관리자가 지정한 면제이며 런타임이 안전하다는 표준 판정이 아닙니다
같은 설정에 usernames·namespaces 면제도 있고, 이 기동 설정은 API 오브젝트 목록을 조회하는 것만으로 확인할 수 없습니다

### RuntimeClass 부재와 노드 handler 부재는 실패 단계가 다릅니다

RuntimeClass 오브젝트 자체가 없으면 [RuntimeClass admission](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/plugin/pkg/admission/runtimeclass/admission.go)에서 Forbidden으로 거부될 수 있습니다
오브젝트는 있지만 노드에 해당 handler가 없으면 sandbox 생성 경계에서 실패할 수 있습니다

[RuntimeClass 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/containers/runtime-class.md)는 이 경우 terminal Failed를 설명합니다
반면 확인한 kubelet [`SyncPod`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_manager.go) 경로는 `FailedCreatePodSandBox` 이벤트와 오류 반환까지 보여 줍니다
이 단서만으로 실제 최종 Pod phase를 확정하지 않습니다

## 거절 메시지와 적용 실패 메시지를 나눠 읽습니다

| 증상 | 판단 경계 |
|---|---|
| `violates PodSecurity` | PSA, 메시지의 수준·정책 버전·위반 필드 확인 |
| API의 `Invalid value`와 보안 필드 조합 | API validation, PSA 라벨과 별도 |
| `disallowed by cluster policy` | privileged의 클러스터 허용 설정 |
| `CreateContainerConfigError`와 non-root message | kubelet의 실제 UID·이미지 사용자 확인 |
| userns Pod의 정책 거절 | hostUsers와 enforce-version, restricted의 남은 통제 |
| user namespace 미지원 handler message | 선택한 CRI 런타임의 기능 지원 |
| `MOUNT_ATTR_IDMAP` 관련 실행 오류 | 볼륨 파일시스템·커널·런타임 지원 |
| `FailedCreatePodSandBox` | handler·sandbox 생성의 실제 message, 최종 phase는 별도 확인 |
| 생략한 seccomp이 예상과 다름 | 유효한 Pod·컨테이너 프로필과 kubelet seccompDefault |

권한 목록을 줄이는 일, namespace 범위를 바꾸는 일, syscall·자원 접근을 제한하는 일은 각각 다른 설정입니다
필드 값뿐 아니라 누가 기본값을 해석하고 어느 단계에서 실제 적용하는지 확인해야 제한의 범위를 판단할 수 있습니다
