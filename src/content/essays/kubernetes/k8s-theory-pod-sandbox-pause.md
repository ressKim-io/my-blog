---
title: "Pod sandbox와 pause — 네트워크를 앱 재시작과 분리하는 과정"
excerpt: "Pod sandbox를 준비하고 앱 컨테이너가 네트워크를 공유하는 과정을 따라갑니다. namespace 참조와 pause의 역할, veth·bridge·eBPF의 위치, hostNetwork와 sandbox 재생성·준비 조건을 구분합니다"
category: "kubernetes"
tags: ["Kubernetes", "PodSandbox", "pause", "NetworkNamespace", "CNI", "concept"]
series:
  name: "k8s-theory-network"
  order: 2
date: "2026-10-02"
---

같은 Pod의 컨테이너가 localhost로 통신할 수 있는 이유는 네트워크 환경을 공유하기 때문입니다
앱 컨테이너 하나가 재시작하더라도 sandbox와 그 네트워크가 유지되면 같은 주소를 계속 사용할 수 있습니다

[CNI 계약](/essays/k8s-theory-cni-contract)에서 런타임이 플러그인에 넘기는 network namespace는 앱이 시작되기 전에 준비되어야 합니다
아직 앱 프로세스가 없는데도 그 환경을 유지하는 참조가 필요하며, pause 프로세스는 이를 구현하는 방법 중 하나입니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> Kubernetes ref: `f78e722310e50bcaca9276be22276d9e91d91308`, 공식 문서 저장본: `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> Linux 구현 예시는 containerd v2.4.2의 `b7a25261e029d68978bbf290df0a62fc819b3c51`과 CNI plugins v1.9.1의 `adc3e6b5b581638afbd194cf2e9319ecbb0151a1`로 고정합니다
> 실제 노드의 설치 버전이나 namespace 수명을 실습으로 관측한 기록은 포함하지 않습니다

## CRI는 sandbox를 요구하고 구현은 런타임이 정합니다

Pod sandbox는 Pod 단위의 공유 실행 환경입니다
kubelet은 namespace 옵션과 cgroup 부모 등을 담은 설정을 CRI의 `RunPodSandbox`로 런타임에 전달합니다

CRI는 이 요청이 sandbox를 생성하고 시작하며 성공 응답 시 ready여야 한다고 규정합니다
모든 런타임이 pause 컨테이너나 veth를 사용해야 한다고 규정하지는 않습니다
여기서 설명할 pause와 Linux network namespace는 containerd의 podsandbox 구현 예시입니다

일반적인 비-hostNetwork Pod를 처리하는 확인한 containerd 경로는 다음 순서입니다

![Linux containerd의 일반 Pod 예시에서 kubelet의 RunPodSandbox 요청 뒤 런타임이 netns를 bind mount로 고정하고 CNI 설정과 pause 시작을 거쳐 앱 컨테이너를 시작하는 순서|tall](/diagrams/k8s-theory-pod-sandbox-pause-1.svg)

containerd는 network namespace를 만들고 bind mount로 고정한 뒤 CNI 설정을 수행합니다
이후 sandbox 서비스가 pause 이미지를 사용한 컨테이너를 시작합니다
따라서 CNI를 실행하는 시점에도 namespace 참조는 이미 존재합니다

이 경로는 [`RunPodSandbox`·`setupPodNetwork`](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/server/sandbox_run.go), [`netns.NewNetNS`](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/pkg/netns/netns_linux.go), [podsandbox 시작](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/server/podsandbox/sandbox_run.go)에 있습니다
요청 계약은 [CRI `api.proto`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cri-api/pkg/apis/runtime/v1/api.proto)와 구분해서 읽어야 합니다

## namespace 생성과 참조 유지는 다른 일입니다

network namespace는 네트워크 인터페이스·라우팅 테이블·방화벽 규칙 등을 다른 프로세스 묶음과 분리하는 Linux 커널 단위입니다
그 안의 프로세스뿐 아니라 열린 namespace 파일 디스크립터나 bind mount도 객체의 참조를 유지할 수 있습니다

따라서 마지막 앱 프로세스가 종료됐다는 사실만으로 network namespace도 사라졌다고 판단할 수는 없습니다
다른 참조가 남아 있다면 객체는 계속 존재합니다
containerd의 `newNS`도 프로세스가 없어져도 유지되도록 bind mount를 만든다는 이유를 소스에 명시합니다

이 수명 규칙은 [Linux namespaces 매뉴얼](https://man7.org/linux/man-pages/man7/namespaces.7.html)의 namespace 파일과 lifetime 설명에 근거합니다
Pod 네트워크의 수명을 특정 앱 컨테이너 하나의 프로세스 수명에만 맡기지 않는 이유입니다

### pause는 네트워크를 설정하지 않습니다

Kubernetes의 [`pause.c`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/build/pause/linux/pause.c)는 시그널을 기다리는 작은 프로그램입니다
`pause()` 시스템 콜을 반복하고, 종료 시그널을 처리하며, `SIGCHLD` 핸들러에서 `waitpid`로 종료한 자식 프로세스를 회수합니다

pause 프로세스가 해당 namespace 안에 존재하면 참조도 유지됩니다
하지만 IP를 할당하거나 veth를 만드는 일은 이 프로그램이 하지 않습니다

공유 PID namespace의 init인 PID 1로 동작하는 구성에서는 자신에게 재부모화된 프로세스의 종료를 회수하는 역할도 맡습니다
기본 Pod는 PID namespace를 공유하지 않으므로 pause가 모든 앱 컨테이너의 자식 프로세스를 대신 회수한다고 일반화하면 안 됩니다

pause 이미지도 런타임 설정에서 선택합니다
확인한 containerd는 pinned image의 `sandbox` 값을 우선하고, 없으면 `registry.k8s.io/pause:3.10.2`를 기본값으로 사용합니다
이는 해당 버전의 기본 설정이며 실제 노드가 같은 이미지를 쓴다는 뜻은 아닙니다

관련 근거는 [`getSandboxImageName`](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/server/podsandbox/sandbox_run.go)과 [`DefaultSandboxImage`](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/config/config.go)에 있습니다

## network를 공유해도 PID까지 공유하는 것은 아닙니다

CRI의 namespace 모드는 종류별로 적용합니다
`POD`는 Pod 전체 공유, `CONTAINER`는 컨테이너별 분리, `NODE`는 노드 namespace 사용입니다
`TARGET`은 지정한 다른 컨테이너의 namespace를 따르는 모드입니다

| 종류 | 일반 Pod의 모드 | 다른 설정 |
|---|---|---|
| network | `POD` | `hostNetwork: true`이면 `NODE` |
| IPC | `POD` | `hostIPC: true`이면 `NODE` |
| PID | `CONTAINER` | `shareProcessNamespace: true`이면 `POD`, `hostPID: true`이면 `NODE` |

`POD`는 CRI enum의 0번 값이지만 kubelet은 PID의 기본값을 `CONTAINER`로 명시합니다
모든 namespace를 0번 값으로 해석하거나, sandbox가 있다는 이유만으로 모든 컨테이너의 PID 공간도 같다고 보면 안 됩니다

network를 공유하는 컨테이너들은 같은 루프백과 네트워크 인터페이스를 사용하므로 localhost로 통신할 수 있습니다
같은 주소·프로토콜·포트에 대한 바인딩도 서로 영향을 줍니다
프로세스가 다른 컨테이너에 있다는 사실만으로 포트 충돌을 피할 수는 없습니다

PID namespace 공유는 별도 선택입니다
이를 켜면 앱이 자신을 PID 1로 보는 전제가 달라지고, 다른 컨테이너의 프로세스나 `/proc/$pid/root` 경로를 통해 보이는 범위도 바뀝니다
프로세스를 볼 수 있는 것과 파일 등에 접근할 권한이 있는 것도 구분해야 합니다

모드 선택은 [`NamespacesForPod`와 관련 함수](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/util/util.go), PID 공유의 동작은 [공식 프로세스 namespace 공유 문서](https://kubernetes.io/docs/tasks/configure-pod-container/share-process-namespace/)에서 확인할 수 있습니다

## veth를 쓴다면 노드 쪽 끝의 처리도 봐야 합니다

veth pair는 두 인터페이스가 한 쌍으로 만들어져 한쪽에서 보낸 패킷을 다른 쪽으로 전달하는 가상 장치입니다
veth 기반 CNI 구성에서는 한쪽을 Pod network namespace 안에, 다른 쪽을 노드 쪽에 둡니다
Pod 안의 이름은 흔히 `eth0`이며 CNI의 `CNI_IFNAME`으로 전달합니다

이 장치를 만드는 주체는 해당 플러그인입니다
예를 들어 [CNI bridge 플러그인](https://github.com/containernetworking/plugins/blob/adc3e6b5b581638afbd194cf2e9319ecbb0151a1/plugins/main/bridge/bridge.go)은 veth를 만든 뒤 노드 쪽 끝을 bridge에 연결합니다
`ipvlan`·`macvlan`·`host-device`처럼 veth와 다른 인터페이스 방식을 제공하는 플러그인도 있으므로 모든 Pod가 같은 쌍을 갖는 것은 아닙니다

이 플러그인 소스는 v1.9.1로 고정했으며 [containerd의 go.mod](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/go.mod)가 참조하는 plugins 버전과도 대조했습니다
go.mod에 적힌 라이브러리 의존성이 노드에 설치된 CNI 실행 파일의 버전을 증명하는 것은 아닙니다

![두 veth 기반 구성에서 Pod쪽과 노드쪽 인터페이스 쌍은 유지되고 bridge 전달 또는 Cilium의 노드쪽 TC hook 처리로 갈리는 비교|tall](/diagrams/k8s-theory-pod-sandbox-pause-2.svg)

bridge는 노드 안에서 이더넷 프레임을 전달하는 가상 스위치입니다
일반적인 학습 동작은 수신 프레임의 출발지 MAC 주소를 기억하고 목적지 MAC 주소를 기준으로 전달할 포트를 고릅니다
학습할 주소와 전달 판단에 사용하는 주소가 다릅니다

다른 예로 [Cilium 1.20.3의 veth 기반 설명](https://docs.cilium.io/en/stable/network/ebpf/intro/)은 노드 쪽 veth의 TC ingress hook에 붙은 eBPF 프로그램을 다룹니다
TC는 네트워크 인터페이스의 트래픽 제어 지점이며, 프로그램은 Pod에서 나오는 패킷에 정책을 적용하고 전달을 처리할 수 있습니다

이 비교의 두 예시에서는 veth가 양쪽 모두 남습니다
차이는 노드 쪽 끝을 bridge에 연결하는지, 그 지점의 프로그램과 라우팅으로 전달하는지입니다
이를 모든 eBPF 네트워크 구현이나 모든 Cilium 장치 모드의 고정 구조로 넓히면 안 됩니다

예를 들어 Cilium의 [socket load balancer](https://docs.cilium.io/en/stable/network/kubernetes/kubeproxy-free/#socket-loadbalancer-bypass-in-pod-namespace)는 TCP `connect` 시점에 Service의 대상을 바꿀 수 있으며, 이는 veth 패킷 처리와 다른 위치입니다
eBPF가 무엇을 대신하는지 판단할 때는 기술 이름만 보지 않고 프로그램이 붙는 지점과 처리 시점을 함께 확인해야 합니다

bridge의 전달·학습은 [Linux Ethernet Bridging 문서](https://docs.kernel.org/networking/bridge.html)에 근거합니다

## kubelet은 런타임이 보고한 IP를 읽습니다

kubelet은 sandbox의 IP를 직접 할당하지 않습니다
새 sandbox를 만든 뒤 `PodSandboxStatus`를 조회하고 런타임이 보고한 primary·additional IP를 파싱합니다
앱 컨테이너 시작 경로가 Pod IP에 의존하므로 상태 조회와 주소 확인을 먼저 수행합니다
이를 사용해 Downward API의 `status.podIP`·`status.podIPs` 같은 환경 변수 참조와 컨테이너의 hosts 파일을 구성합니다

Network 정보가 없으면 주소 목록을 보고할 수 없다는 로그를 남깁니다
primary 또는 additional IP가 파싱되지 않으면 해당 값만 빼고 계속하는 것이 아니라 이 함수의 전체 반환을 `nil`로 처리합니다
따라서 파싱 실패와 정보 부재, 비어 있는 IP 문자열을 구분해야 합니다

현재 SyncPod에는 sandbox 생성 뒤 `OnPodSandboxReady`로 상태 갱신을 알리는 단계가 있으며 이미지 pull보다 먼저 호출합니다
필요한 sandbox·네트워크 준비를 먼저 알리고 이후 컨테이너 생성으로 이어가는 흐름입니다

관련 구현은 [`determinePodSandboxIPs`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_sandbox.go)와 [`SyncPod`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_manager.go)에 있습니다

### hostNetwork는 노드의 network namespace를 사용합니다

`hostNetwork: true`이면 kubelet은 CRI에 network 모드 `NODE`를 전달합니다
이 모드에서 Pod status의 IP는 [노드 IP를 상속하는 경로](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kubelet_pods.go)로 채웁니다
CRI의 sandbox network status도 host network 공유 Pod에서는 무시한다고 정의합니다

확인한 containerd 경로는 hostNetwork Pod에 별도 network namespace와 앞 절의 CNI setup을 수행하지 않습니다
이는 이 구현을 확인한 결과이며 namespace 모드 `NODE`라는 API 값만으로 모든 런타임의 내부 호출까지 규정하는 것은 아닙니다

kubelet은 [런타임의 network 준비 오류로 Pod를 막는 검사](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kubelet.go)에서도 hostNetwork를 제외합니다
이 차단 예외와 실제 런타임이 CNI를 호출하는지는 서로 다른 판단입니다

## 앱 재시작과 sandbox 재생성을 구분합니다

앱 컨테이너 하나가 종료돼 다시 시작하는 것만으로 sandbox도 항상 재생성되는 것은 아닙니다
기존 sandbox와 그 네트워크를 유지한다면 앱은 그 환경에 다시 들어갑니다
이 때문에 앱의 CrashLoopBackOff와 Pod IP 변경을 같은 사건으로 볼 수 없습니다

kubelet의 `PodSandboxChanged`는 다음 조건에서 새 sandbox가 필요하다고 판정합니다

| 조건 | 확인하는 상태 |
|---|---|
| sandbox 상태 목록이 비어 있음 | 사용할 sandbox가 없음 |
| ready sandbox가 둘 이상 | 하나로 정리해야 하는 상태 |
| 판정 대상 sandbox가 ready가 아님 | 런타임이 SANDBOX_READY로 보고하지 않음 |
| network namespace 모드 불일치 | sandbox가 보고한 모드와 현재 Pod 명세가 다름 |
| 비-hostNetwork이며 Network가 존재하지만 primary IP가 비어 있음 | 해당 sandbox의 네트워크 상태 보고가 불완전함 |

마지막 검사는 `Network != nil`일 때만 적용합니다
Network 구조체가 없는 경우와 구조체는 있지만 `Ip`가 빈 경우를 같은 조건으로 설명하면 안 됩니다
이 판정은 [고정 소스의 `PodSandboxChanged`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/util/util.go)에 있습니다

기존 sandbox를 바꿔야 하는 경로에서는 관련 컨테이너도 정리하고 새 sandbox를 준비합니다
새 네트워크 설정 뒤 IP가 달라질 수 있지만 IPAM의 할당 결과에 따라 같은 주소를 다시 받을 수도 있습니다
Pod 이름과 UID가 같다는 사실만으로 이전 주소의 유지까지 보장하지는 않습니다

pause 프로세스가 종료된 경우도 namespace의 커널 객체가 즉시 사라지는지와 런타임이 sandbox를 ready로 볼지는 다른 문제입니다
bind mount 등 참조가 남아 있어도 sandbox 상태 판정에 따라 kubelet이 재생성을 진행할 수 있습니다

이 경로에서 기존 환경을 바꿀 때의 Event 문구는 `Pod sandbox changed, it will be killed and re-created.`입니다
다만 Event만으로 다섯 조건 중 어느 것이 원인인지 알 수는 없으므로 sandbox 상태·모드·보고 IP를 함께 확인합니다

## sandbox 준비 조건과 앱 Ready는 다릅니다

`PodReadyToStartContainers`는 sandbox와 네트워크를 준비해 컨테이너를 시작할 수 있는 상태를 나타냅니다
v1.28 alpha·v1.29 beta를 거쳐 현재 v1.37에서는 GA·기본 on이며 gate가 잠겨 있습니다

[`GeneratePodReadyToStartContainersCondition`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/status/generate.go)은 `PodSandboxChanged`가 새 sandbox를 요구하지 않으면 True를 반환합니다
이 계산식은 Network 정보 부재를 앞 절의 빈 IP 조건으로 잡지 않으므로, 그 자체가 유효한 IP의 존재를 별도로 검증하는 식은 아닙니다

또한 컨테이너가 시작할 준비를 했다는 조건이지 앱의 readiness probe 통과를 뜻하지 않습니다
실제 앱 준비 상태는 `ContainersReady`·`Ready` 등 다른 조건으로 확인해야 합니다

공식 정의는 [Pod network readiness](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-network-readiness), 현재 기능 상태는 [gate 등록](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go)에 있습니다

## 실패 지점은 네트워크의 수명과 함께 봅니다

| 증상 | 확인할 경계 |
|---|---|
| `Failed to create pod sandbox: ...` | 런타임의 sandbox 생성 실패 원문, CNI 실패도 포함 가능 |
| `SandboxChanged`가 반복 | ready 수·판정 대상 상태·namespace 모드·보고 IP |
| Pod IP를 보고하지 못함 | Network 정보 부재·빈 IP·primary/additional 파싱 실패 구분 |
| 같은 UID의 Pod IP가 바뀜 | sandbox 교체 여부와 IPAM 재할당 결과 |
| 한 컨테이너의 포트 바인딩 실패 | 같은 network namespace의 주소·프로토콜·포트 경합 |
| `PodReadyToStartContainers=False` | 새 sandbox가 필요한 이유와 런타임 준비 상태 |
| 같은 노드의 Pod 사이 통신 실패 | 실제 플러그인의 장치·bridge 또는 프로그램·라우팅 경로 |

네트워크 주소를 특정 앱 컨테이너에만 연결하면 재시작과 재생성을 구분하기 어렵습니다
sandbox ID와 상태, namespace 참조, 런타임이 보고한 IP를 함께 봐야 어느 환경이 유지되고 바뀌었는지 설명할 수 있습니다

## 참고 자료

- [Kubernetes Pod 네트워킹](https://kubernetes.io/docs/concepts/services-networking/)
- [Linux namespace 참조와 수명](https://man7.org/linux/man-pages/man7/namespaces.7.html)
- [CNI plugins의 인터페이스 구현 목록](https://github.com/containernetworking/plugins/blob/adc3e6b5b581638afbd194cf2e9319ecbb0151a1/README.md)
