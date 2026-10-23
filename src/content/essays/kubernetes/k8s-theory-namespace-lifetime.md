---
title: "Namespace 수명 — 프로세스가 없어도 남는 참조"
excerpt: "프로세스·namespace 객체·runtime sandbox·Pod 객체의 수명을 구분합니다. 열린 FD와 bind mount, PID 1 종료, 비동기 정리와 CNI/IPAM의 책임을 따라 삭제 완료와 관측 신원의 경계를 살펴봅니다"
category: "kubernetes"
tags: ["kubernetes", "linux", "namespace", "containerd", "cni", "concept"]
series:
  name: "k8s-theory-kernel"
  order: 5
date: "2026-10-24"
---

Pod 삭제를 요청한 뒤 앱과 pause 프로세스는 사라졌는데 namespace나 IP 할당 기록이 남았다고 가정하겠습니다
이를 모두 “컨테이너가 안 지워졌다”로 묶으면 무엇을 누가 정리해야 하는지 구분하기 어렵습니다

[Sandbox와 pause](/essays/k8s-theory-pod-sandbox-pause)에서 pause는 공유 실행 환경의 참조를 유지하는 방법 중 하나였습니다
프로세스가 종료됐다는 사실과 커널 객체가 해제됐다는 사실, runtime이 정리를 끝냈다는 사실은 각각 확인해야 합니다

> **근거**: Linux v6.18.58 LTS `2926d88bb7fc4608fd942453d929c39e4e5ec006` 소스와 Linux man-pages 6.19의 인터페이스 설명을 대조했습니다
> 런타임 예시는 containerd v2.4.2 `b7a25261e029d68978bbf290df0a62fc819b3c51`이며 CNI 규격 1.1.0과 구분해 설명합니다
> 실제 namespace 조작이나 노드의 정리 순서·시간을 측정한 기록은 포함하지 않습니다

## Namespace는 자원을 보는 범위를 나눕니다

Linux namespace는 프로세스가 어떤 자원 집합을 보고 사용하는지 나누는 커널 기제입니다
Network namespace는 네트워크 장치·라우팅·포트 등의 범위를 나눕니다
Mount namespace는 보이는 mount 구성을, PID namespace는 프로세스 ID의 관점을 나눕니다

종류가 다르면 공유 여부와 수명도 따로 봐야 합니다
같은 Pod의 컨테이너가 network namespace를 공유한다고 PID namespace도 항상 공유하는 것은 아닙니다

일반 Pod의 PID 격리는 컨테이너별이며 `shareProcessNamespace: true`이면 Pod 단위 공유를 선택합니다
`hostPID: true`이면 노드의 PID namespace를 사용하므로 pause의 종료가 미치는 범위도 같은 조건으로 설명할 수 없습니다

Kubernetes의 `Namespace`는 다시 다른 대상입니다
API 객체와 정책을 구획하는 Kubernetes Namespace를 만들었다는 사실만으로 커널의 모든 자원·보안 경계가 분리되지는 않습니다

## Task는 여러 namespace를 참조합니다

커널의 `task_struct`는 스케줄링하는 작업을 표현합니다
이 객체의 `nsproxy`는 mount·UTS·IPC·network·cgroup·time namespace 등으로 향하는 참조를 묶습니다

모든 namespace 정보를 단순히 이 구조체의 목록으로만 읽으면 두 예외를 놓칩니다
현재 task의 **활성 PID namespace**는 `task_active_pid_ns()`로 접근합니다
`nsproxy.pid_ns_for_children`은 앞으로 생성할 자식의 대상을 가리킵니다

User namespace도 자격 증명인 credentials의 `user_ns`를 통해 연결됩니다
이는 사용자·그룹 ID와 capability 권한이 어느 범위에 적용되는지를 나누는 namespace입니다

여러 task는 같은 `nsproxy`를 공유할 수 있고 namespace별 객체도 다른 `nsproxy` 사이에서 공유할 수 있습니다
따라서 `nsproxy`의 참조 수를 그 namespace 안의 프로세스 수와 같은 값으로 읽을 수는 없습니다

Task가 종료하면서 `exit_nsproxy_namespaces()`를 호출하면 자신의 `nsproxy` 참조를 내려놓습니다
마지막 `nsproxy` 참조가 사라져 `free_nsproxy()`가 실행돼도, 이 함수는 종류별 `put_*`을 호출해 해당 참조를 반환하는 단계입니다

그 namespace로 향하는 다른 참조까지 모두 사라졌다는 뜻은 아닙니다

## 열린 FD와 namespace mount도 수명을 유지합니다

**참조**는 커널 객체를 가리키며 그 수명을 유지하는 관계입니다
Network namespace 안의 마지막 프로세스가 종료돼도 열린 namespace FD나 namespace 자체를 가리키는 mount가 남아 있으면 객체를 유지할 수 있습니다

![Task의 nsproxy 참조 외에 열린 FD와 namespace bind mount가 network namespace를 유지하는 관계|tall](/diagrams/k8s-theory-namespace-lifetime-1.svg)

`/proc/<pid>/ns/*`는 프로세스의 namespace를 참조하는 인터페이스입니다
이 항목을 열어 얻은 파일 디스크립터인 FD는 namespace 객체를 계속 참조할 수 있습니다

해당 namespace 파일을 다른 경로에 bind mount한 경우에도 같은 효과가 있습니다
`nsfs`는 namespace를 파일처럼 다루는 커널 파일시스템입니다
고정 소스의 `nsfs_evict()`는 inode를 정리할 때 종류별 namespace `put`을 호출합니다

관찰 도구가 FD를 열고 runtime은 같은 namespace의 bind mount를 유지한다고 가정하겠습니다
관찰 도구가 FD를 닫아도 runtime의 mount가 남았다면 아직 마지막 참조가 해제된 것은 아닙니다

모든 bind mount가 namespace를 유지하는 것은 아닙니다
앱 디렉터리를 다른 경로에 붙인 mount와 namespace 자체를 가리키는 mount는 대상이 다릅니다

### 다른 namespace와 파일시스템도 참조를 가질 수 있습니다

| 참조 관계의 예 | 유지될 수 있는 대상 |
|---|---|
| 열린 namespace FD·해당 파일의 bind mount | 그 namespace 객체 |
| 자식 PID·user namespace | 계층의 부모 namespace |
| Non-user namespace의 소유 관계 | 소유한 user namespace |
| `pid_for_children`·`time_for_children` | 이후 자식에게 사용할 PID·time namespace |
| 해당 PID namespace를 참조하는 procfs mount | PID namespace |
| 해당 IPC namespace를 참조하는 mqueue mount | IPC namespace |

Procfs는 프로세스 정보를, mqueue 파일시스템은 POSIX 메시지 큐를 노출합니다
이 mount들이 가진 참조도 프로세스 개수만 세면 빠집니다. 표는 수명에 관여하는 모든 참조를 빠짐없이 열거한 목록은 아닙니다

참조를 찾았다고 바로 누수로 판단할 수도 없습니다
관찰 도구나 runtime이 의도한 수명 동안 유지하는 중일 수 있으므로 참조의 주체와 목적, 해제할 조건을 함께 확인해야 합니다

객체가 있다는 사실과 그 안에 자원이 있다는 사실, 정상 프로세스가 그 자원을 계속 사용할 수 있다는 사실도 다릅니다

## FD를 갖는 것과 namespace에 참여할 권한은 다릅니다

Linux의 namespace API는 생성과 기존 대상 참여를 구분합니다
다음은 인터페이스의 역할을 설명한 것으로 실제 실행 절차가 아닙니다

| 인터페이스 | 기본 역할과 구분할 조건 |
|---|---|
| `clone()`의 `CLONE_NEW*` | 자식을 생성하면서 지정한 종류의 namespace를 새로 생성 |
| `unshare()`의 `CLONE_NEW*` | 호출자가 공유하던 실행 문맥을 분리하고 새 namespace를 준비 |
| `setns()` | FD 등이 가리키는 기존 namespace에 종류별 규칙으로 참여 |

Namespace FD가 있다고 `setns()`의 권한 검사를 건너뛰지는 않습니다
확인한 network namespace 참여 경로는 두 user namespace의 `CAP_SYS_ADMIN`을 확인합니다
호출자의 user namespace와 대상 network namespace를 소유한 user namespace입니다

종류에 따라 추가 조건도 다릅니다
예를 들어 user namespace 참여에는 대상 범위의 권한 외에도 멀티스레드·파일시스템 문맥 공유 제약이 있습니다
같은 user namespace에 다시 들어가 권한을 되찾는 것도 허용하지 않습니다

PID namespace에는 아래에서 볼 자식 대상 선택의 의미와 계층 제약이 있습니다
그래서 “FD를 열었으니 현재 프로세스가 그 안으로 이동했다”라고 해석해서는 안 됩니다

## Network namespace의 마지막 참조 뒤에도 정리 단계가 있습니다

v6.18.58의 `put_net()`은 수명 참조가 마지막이면 `__put_net()`을 호출합니다
이 함수는 호출 자리에서 모든 네트워크 자원을 곧바로 없애는 대신 작업 큐에 `cleanup_net` 처리를 예약합니다

정리 경로는 namespace 목록에서 대상을 제거하고 네트워크별 종료 함수를 실행합니다
RCU의 지연된 참조 사용을 기다리는 단계와 별도의 메모리 수명도 있으므로, 참조 감소 시각을 모든 장치·메모리 해제 완료 시각으로 대신할 수 없습니다

실제 network namespace 정리에서는 이동 가능한 장치를 initial network namespace로 돌려보내고, 정리할 가상 장치를 제거합니다
Initial network namespace는 다른 network namespace를 만들기 전부터 있던 초기 네트워크 문맥입니다

veth는 양 끝이 연결된 가상 장치 쌍입니다
이 정리 경로가 veth의 `dellink`를 호출하면 양쪽 장치의 등록 해제를 처리합니다

이 동작은 namespace가 실제 정리 단계에 들어갔다는 전제에서 읽어야 합니다
Pause가 종료됐다는 사실만으로 곧바로 모든 네트워크 장치가 사라진다고 설명하면 참조와 비동기 정리 단계를 빠뜨립니다

반대로 장치가 없어졌다고 IPAM의 할당 기록까지 반환됐다는 뜻도 아닙니다
IPAM은 주소를 누구에게 할당했는지 관리하며, 인터페이스와 주소 할당 장부는 서로 다른 대상입니다

## Containerd의 netns mount는 pause와 별도로 유지됩니다

확인한 containerd v2.4.2의 Linux 구현은 새 network namespace를 만든 뒤 namespace 파일을 bind mount로 고정합니다
`newNS()`의 소스도 그 안에 스레드가 없어져도 유지하려는 목적을 명시합니다

이 mount가 있으면 pause 프로세스의 참여 참조가 사라져도 namespace가 남을 수 있습니다
`NetNS` 관리 객체는 이 mount의 경로를 보관하며, 항상 열린 namespace FD 하나를 계속 쥐고 있는 객체라고 설명하면 맞지 않습니다

같은 버전의 일반적인 `stopPodSandbox` 경로는 앱 컨테이너를 중지하고 필요한 상태에서 sandbox를 중지한 뒤 네트워크 정리를 진행합니다
이어 CNI 제거를 요청하고 `NetNS.Remove()`로 mount를 떼는 경로가 있습니다

이미 namespace가 없으면 CNI에 넘기는 namespace 경로를 비울 수도 있습니다
네트워크 제거가 실패하면 setup 결과가 있는 경우 오류를 반환하지만, setup 결과 자체가 없으면 설정이 완료되지 않았다고 보고 경고 후 진행하는 분기도 있습니다

`Remove()`는 `MNT_DETACH`를 사용한 unmount와 경로 제거를 수행합니다
이는 해당 mount 경로의 정리이며 다른 열린 참조까지 없다는 증거가 되지는 않습니다

이 순서는 확인한 containerd 경로의 예입니다
모든 CRI runtime이 같은 pause 구현과 mount, 종료 순서를 사용해야 한다는 계약은 아닙니다

### Namespace가 없어도 CNI 정리가 필요할 수 있습니다

CNI 규격 1.1.0의 `DEL`은 일부 자원이나 상태가 없어도 가능한 범위에서 정리를 진행하도록 규정합니다
일반적으로 IPAM은 network namespace가 이미 없어도 할당을 반환할 수 있어야 하며, namespace가 IPAM 관리에 필수인 경우는 예외로 구분합니다

같은 `CNI_CONTAINERID`·`CNI_IFNAME` 쌍의 반복 `DEL`도 수용해야 합니다
인터페이스나 적용한 변경이 이미 없으면 성공으로 처리하도록 합니다

이는 정리의 일부가 먼저 성공한 뒤 같은 요청이 다시 와도 처리할 수 있게 하는 규약입니다
호출이 허용된다는 사실만으로 특정 runtime·plugin 조합에서 실제 반환이나 재시도가 성공했다고 판단할 수는 없습니다

또 CNI에서 container는 네트워크 격리 영역을 가리킵니다
일반적인 Kubernetes 구성에서는 sandbox가 그 단위이므로 `CNI_CONTAINERID`를 앱 실행 컨테이너의 ID와 같다고 가정하면 안 됩니다

## PID namespace는 init 종료 뒤 실행을 다시 시작할 수 없습니다

PID namespace의 init은 그 안에서 PID 1을 가진 프로세스입니다
이 프로세스가 종료되면 커널은 해당 namespace의 새 PID 할당을 막습니다
나머지 프로세스에 `SIGKILL`을 보내 종료 처리를 진행합니다

![PID 1 종료 뒤 참조로 객체가 남아 있어도 해당 namespace의 새 프로세스 생성은 ENOMEM으로 실패하는 경로|tall](/diagrams/k8s-theory-namespace-lifetime-2.svg)

미리 열린 FD나 다른 참조가 있다면 PID namespace 객체는 남을 수 있습니다
그러나 그 공간에 새 프로세스를 만들려는 시도는 `ENOMEM`으로 실패합니다

이 경로의 `ENOMEM`을 단순 메모리 부족으로만 읽으면 원인을 놓칩니다
`alloc_pid()`의 소스도 namespace가 새 프로세스 생성을 거절하는 경우에 이 오류를 유지하는 이유를 문서화합니다

PID namespace의 객체 해제에도 작업 큐와 RCU 정리가 사용됩니다
Init 종료, 새 프로세스 생성 차단, 참조 해제와 메모리 해제는 같은 사건이 아닙니다

### PID setns는 호출자 자신을 옮기지 않습니다

PID namespace를 대상으로 한 `setns()`는 앞으로 생성할 자식의 namespace를 바꿉니다
`unshare(CLONE_NEWPID)`도 현재 프로세스의 활성 PID namespace를 옮기는 동작은 아닙니다

현재 활성 PID namespace 또는 그 자손을 대상으로 하는 계층 제약과 권한 검사도 있습니다
커널의 `pidns_install()`은 이를 검사한 뒤 `pid_ns_for_children` 참조를 바꿉니다

따라서 관찰 도구가 PID namespace FD로 `setns()`를 성공했다고 그 도구 자신도 이미 그곳의 프로세스라고 결론 내릴 수 없습니다
임시 컨테이너의 PID 대상 선택 역시 [런타임 지원과 namespace 모드](/essays/k8s-theory-ephemeral-containers)를 함께 확인해야 합니다

기본 PID 격리의 앱 컨테이너와 sandbox network namespace는 서로 다른 수명을 가집니다
공유 PID 구성에서 pause가 PID 1 역할을 맡는 경우에는 그 종료 영향도 달라지므로 설정을 생략한 채 일반화하지 않습니다

## 관찰자의 namespace와 파일시스템의 관점도 구분합니다

같은 프로세스의 PID도 어느 PID namespace에서 보느냐에 따라 다를 수 있습니다
노드에서 본 PID와 컨테이너 안의 PID, runtime container ID와 Pod UID는 서로 다른 식별자입니다

`/proc`도 해당 procfs 인스턴스가 참조하는 PID namespace의 관점을 가집니다
기본 생성 경로는 호출자의 활성 PID namespace를 선택하지만 v6.18.58에는 권한·계층 검사를 거쳐 `pidns=`로 대상을 지정하는 경로도 있습니다

관찰 프로세스가 다른 namespace를 선택했다는 이유로 기존 procfs mount의 관점까지 자동으로 바뀌지는 않습니다
현재 프로세스의 위치와 어떤 `/proc`를 읽는지를 함께 알아야 합니다

`/proc/<pid>/ns/*`의 device·inode 비교는 그 시점에 같은 namespace 객체를 가리키는지 확인하는 근거입니다
이를 재부팅이나 객체 재생성을 넘는 영구적인 서비스 ID로 사용할 수는 없습니다

### Cgroup 경로가 /여도 조상 제한은 남을 수 있습니다

Cgroup namespace는 경로를 보는 관점을 나누며 조상 cgroup의 자원 제한을 제거하지 않습니다
`/proc/<pid>/cgroup`의 경로는 읽는 프로세스의 cgroup namespace root에 대해 상대적으로 표시됩니다

컨테이너 안에서 `/`로 보인다고 호스트 최상위 cgroup이라는 뜻은 아닙니다
보이지 않는 부모의 CPU quota나 메모리 한도는 계속 영향을 줄 수 있습니다

이 구별은 [CPU quota](/essays/k8s-theory-cgroup-v2-cpu-quota)와 자원 압박을 해석할 때도 필요합니다
관찰자의 경로를 실제 호스트 계층과 연결해야 어떤 부모 제한을 받는지 설명할 수 있습니다

### 실행 신원은 범위와 시각을 함께 연결합니다

프로세스 번호나 Pod IP는 재사용될 수 있습니다
어느 노드의 어느 시각에 그 값이 어떤 runtime 객체와 연결됐는지 보존하지 않으면 재시작 전후의 자료를 섞을 수 있습니다

OpenTelemetry의 `k8s.pod.uid`는 Pod 객체를, `container.id`는 실행 컨테이너를 식별합니다
같은 Pod 안에서도 컨테이너가 다시 시작될 수 있으므로 두 범위가 필요하며, CNI의 sandbox ID와 연결할 때는 runtime 메타데이터가 필요합니다

속성이 정의돼 있다는 사실이 kernel 식별자와의 자동 연관까지 보장하지는 않습니다
수집기의 매핑·캐시 갱신·재시작 처리는 별도로 검증해야 합니다

세부 식별자를 모두 모든 metric label에 추가하자는 뜻도 아닙니다
Label 조합이 늘어나는 카디널리티에는 저장·조회 비용이 있으므로 실행 신원을 보존할 신호와 서비스 단위로 집계할 신호를 나눕니다

## 삭제 완료는 대상별 근거로 판단합니다

Finalizer는 API 객체의 삭제 완료를 보류해 정리 책임자가 작업할 기회를 주는 정책입니다
커널 참조는 namespace 객체의 수명을 유지하는 관계이며 두 기제가 같은 정리를 대신하지는 않습니다

| 정리 대상 | 직접 책임자 | 완료 판단에 필요한 근거 |
|---|---|---|
| API 객체와 외부 자원 요청 | Controller·API 정책 | 삭제 상태·finalizer 처리와 외부 식별자 |
| Sandbox·컨테이너 | CRI runtime·kubelet | 실제 runtime 상태와 종료 처리 |
| 네트워크 attachment·IP | Runtime·CNI plugin·IPAM | attachment 정리와 할당 반환 |
| 커널 namespace | 참조 보유 주체와 커널 | 남은 수명 참조와 종류별 정리 상태 |

이 표는 실행 순서가 아닙니다
API 목록에서 Pod가 안 보이는 것, sandbox가 종료된 것, namespace가 정리된 것과 IP가 반환된 것을 같은 완료 증거로 바꾸지 않기 위한 구분입니다

남은 namespace가 곧 누수라는 뜻도, 존재하는 namespace가 계속 쓸 수 있는 실행 환경이라는 뜻도 아닙니다
종류·참조 주체·실행 가능성·외부 정리 결과를 구분해야 남은 대상과 재시도 책임을 설명할 수 있습니다

## 확인한 근거

- [Linux namespaces 종류·수명](https://man7.org/linux/man-pages/man7/namespaces.7.html), [setns의 종류별 조건](https://man7.org/linux/man-pages/man2/setns.2.html), [PID init·PID 관점](https://man7.org/linux/man-pages/man7/pid_namespaces.7.html)
- [nsproxy 구성](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/include/linux/nsproxy.h), [참조 공유·해제·setns](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/kernel/nsproxy.c), [nsfs 참조](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/fs/nsfs.c)
- [PID 종료·참조·자식 namespace 선택](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/kernel/pid_namespace.c), [PID 할당 거부와 ENOMEM](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/kernel/pid.c)
- [Network namespace 정리](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/net/core/net_namespace.c), [장치 정리](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/net/core/dev.c), [veth 양쪽 제거](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/drivers/net/veth.c)
- [Procfs의 PID namespace 선택](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/fs/proc/root.c), [cgroup 경로의 관점](https://man7.org/linux/man-pages/man7/cgroup_namespaces.7.html)
- [containerd namespace bind mount·해제](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/pkg/netns/netns_linux.go), [sandbox 종료·네트워크 정리](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/server/sandbox_stop.go)
- [고정 CNI 규격의 DEL·수명 계약](https://github.com/containernetworking/cni/blob/3f51e8803ebbdba0ebeed735b42137e4c7302403/SPEC.md), [OpenTelemetry Pod 식별자](https://opentelemetry.io/docs/specs/semconv/resource/k8s/), [실행 컨테이너 식별자](https://opentelemetry.io/docs/specs/semconv/resource/container/)
