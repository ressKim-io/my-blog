---
title: "CNI 호출 규약 — 런타임은 Pod 네트워크를 어떻게 준비할까"
excerpt: "런타임이 CNI 플러그인에 전달하는 입력과 돌려받는 결과부터 살펴봅니다. 여러 플러그인의 실행 순서, IPAM에 주소 할당을 맡기는 방식, 실패 뒤 자원을 정리하는 책임, containerd의 설정 탐색과 STATUS 호출 조건을 설명합니다"
category: "kubernetes"
tags: ["Kubernetes", "CNI", "containerd", "IPAM", "Networking", "concept"]
series:
  name: "k8s-theory-network"
  order: 1
date: "2026-10-01"
---

Pod에 노드가 배정됐다고 해서 IP까지 준비된 것은 아닙니다
kubelet은 컨테이너 런타임과 통신하는 인터페이스인 CRI로 Pod sandbox 생성을 요청합니다
sandbox는 Pod 단위의 공유 실행 환경입니다
런타임은 이 환경을 준비하면서 CNI 플러그인에 네트워크 설정을 요청합니다

Kubernetes는 Pod 사이에 어떤 통신이 가능해야 하는지 정합니다
**CNI(Container Network Interface)**는 런타임이 네트워크 플러그인에 무엇을 전달하고 어떤 결과를 받아야 하는지 정한 규약입니다
Kubernetes가 요구하는 통신 조건부터 살펴본 뒤, 런타임과 플러그인이 그 환경을 준비하는 과정을 따라가겠습니다

> **근거**: Kubernetes v1.37.1과 CNI spec 1.1.0, 공식 문서 및 고정 소스를 바탕으로 설명합니다
> Kubernetes ref: `f78e722310e50bcaca9276be22276d9e91d91308`, 공식 문서 저장본: `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 구현 예시는 containerd v2.4.2가 의존하는 go-cni v1.1.14·CNI 라이브러리 v1.3.1·plugins v1.9.1 기준입니다
> 실제 노드에 설치된 플러그인이나 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## Kubernetes는 통신 조건을 정하고 구현은 외부에 맡깁니다

[공식 네트워크 모델](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/services-networking/_index.md)은 일반 Pod에 클러스터 안에서 유일한 IP를 부여하고, 의도적으로 네트워크를 분리한 경우를 제외하면 다음 통신을 요구합니다

- 같은 노드와 다른 노드의 Pod가 프록시나 주소 변환인 NAT 없이 직접 통신합니다
- 노드의 에이전트가 그 노드의 모든 Pod와 통신합니다

같은 Pod의 컨테이너는 network namespace를 공유해 IP와 포트 공간을 함께 사용합니다
Linux의 network namespace는 인터페이스·주소·포트 같은 네트워크 환경을 구분하는 단위입니다
여기서는 `hostNetwork`를 사용하지 않는 Linux Pod를 기준으로 설명합니다

이 조건은 오버레이나 네이티브 라우팅 중 하나를 강제하지 않습니다
서로 다른 Pod가 보는 주소를 일치시키면서 실제 노드 간 연결과 주소 할당은 구현에 맡깁니다

NetworkPolicy 오브젝트를 저장하는 것과 트래픽을 제한하는 것도 다릅니다
[공식 NetworkPolicy 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/services-networking/network-policies.md)는 이를 구현하는 컨트롤러가 없으면 정책을 만들어도 효과가 없다고 설명합니다
Pod 통신을 구성하는 플러그인이라는 사실만으로 NetworkPolicy 집행까지 지원한다고 판단할 수는 없습니다

## kubelet의 CRI 요청 뒤에서 런타임이 CNI를 호출합니다

[CRI와 OCI의 경계](/essays/k8s-theory-cri-oci-boundary)에서 본 `RunPodSandbox`가 출발점입니다
kubelet은 CRI 런타임에 요청하고, CNI 설정과 실행 파일의 선택은 그 런타임이 맡습니다
[공식 Network Plugins 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/extend-kubernetes/compute-storage-net/network-plugins.md)도 CNI 관리를 런타임의 책임으로 설명합니다

![kubelet의 CRI 요청 뒤 런타임이 namespace를 준비하고 CNI를 실행하며 상위 플러그인이 IPAM에 위임하는 흐름|tall](/diagrams/k8s-theory-cni-contract-1.svg)

[CNI spec](https://github.com/containernetworking/cni/blob/3f51e8803ebbdba0ebeed735b42137e4c7302403/SPEC.md#lifecycle--ordering)은 플러그인을 부르기 전에 런타임이 network namespace를 준비하도록 요구합니다
플러그인은 이미 있는 namespace의 경로를 받아 인터페이스와 주소 등을 구성합니다
namespace의 생성과 그 안에 통신 설정을 넣는 것은 별도 작업입니다

containerd v2.4.2의 [`RunPodSandbox`](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/server/sandbox_run.go)는 일반 Linux 경로에서 namespace를 만든 뒤 `setupPodNetwork`를 호출합니다
CNI 호출 뒤에 sandbox 시작 절차가 이어지므로, 이 시점을 애플리케이션 컨테이너가 시작하는 시점과 혼동하면 안 됩니다

### 규격 버전과 라이브러리 릴리스는 다릅니다

확인한 containerd의 [`go.mod`](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/go.mod)는 다음 버전을 사용합니다

| 구성요소 | 확인 버전 | 이 글에서 맡는 역할 |
|---|---|---|
| containerd | `v2.4.2` | CRI 구현·CNI 호출·sandbox 수명 관리 |
| containerd/go-cni | `v1.1.14` | 설정 로드와 네트워크별 Setup·Remove·Status 연결 |
| containernetworking/cni | `v1.3.1` | libcni의 실행·결과 보관·체인 처리 |
| containernetworking/plugins | `v1.9.1` | bridge·IPAM 등 구체적인 플러그인 구현 예 |

CNI 라이브러리 v1.3.1 안의 `SPEC.md`와 `version.Current()`가 가리키는 규격은 **1.1.0**입니다
설정의 `cniVersion`은 이 실행 규격을 뜻하며 라이브러리 릴리스 번호를 넣는 칸이 아닙니다
런타임의 Go 의존 버전만으로는 노드에 설치된 개별 플러그인 실행 파일의 버전을 알 수 없습니다

## CNI는 환경 변수와 JSON으로 실행 파일을 호출합니다

런타임은 플러그인을 별도 프로세스로 실행하고 종료 결과를 받습니다
플러그인 전체가 데몬 없이 동작하거나 상태를 저장하지 않는다는 뜻은 아닙니다

| 전달 경로 | 내용 |
|---|---|
| 환경 변수 | 명령·attachment 식별자·namespace·인터페이스·실행 파일 탐색 경로 |
| stdin | 네트워크 설정 JSON |
| stdout | ADD·VERSION 등의 결과 JSON, 실패 시 구조화된 오류 JSON |
| 종료 코드 | 성공은 0, 실패는 0이 아닌 값 |
| stderr | 진단 정보, 위임한 플러그인의 stderr도 상위 호출로 전달 가능 |

주요 환경 변수는 `CNI_COMMAND`, `CNI_CONTAINERID`, `CNI_NETNS`, `CNI_IFNAME`입니다
`CNI_ARGS`는 추가 인자를, `CNI_PATH`는 플러그인 실행 파일을 찾을 디렉터리 목록을 전달합니다
모든 명령이 namespace와 컨테이너 ID를 요구하는 것은 아니므로 명령별 입력 조건을 함께 봐야 합니다

**attachment**는 특정 네트워크 설정을 대상에 적용한 연결 단위입니다
`(CNI_CONTAINERID, CNI_IFNAME)` 쌍으로 식별하며, 같은 대상이라도 인터페이스 이름이 다르면 별도 attachment가 될 수 있습니다
containerd의 이 경로는 sandbox ID와 namespace 경로를 go-cni에 전달합니다

플러그인 실행 프로세스 자체는 런타임의 네트워크 환경에서 시작합니다
`CNI_NETNS`가 있다고 해서 프로세스를 처음부터 대상 namespace 안에서 실행하라는 뜻은 아닙니다
플러그인이 대상 환경을 설정하는 데 그 경로를 사용합니다

[`RawExec`](https://github.com/containernetworking/cni/blob/3f51e8803ebbdba0ebeed735b42137e4c7302403/pkg/invoke/raw_exec.go)는 실패 시 stdout에서 오류 JSON을 해석합니다
stdout이 비어 있으면 stderr 등을 사용해 진단 문구를 만듭니다
따라서 stdout에 임의의 디버그 문구를 섞으면 결과나 오류 JSON 파싱을 방해할 수 있습니다

### 각 명령이 묻는 대상도 다릅니다

| 명령 | 대상·의미 | 적용 조건 |
|---|---|---|
| `ADD` | attachment를 구성하거나 기존 인터페이스 설정을 수정 | 성공 결과 JSON 반환 |
| `DEL` | attachment 구성과 예약을 해제 | namespace가 없어도 가능한 정리 수행, 반복 삭제 허용 |
| `CHECK` | 이미 붙인 attachment가 기대 상태인지 확인 | spec 0.4.0부터, `disableCheck`면 호출하지 않음 |
| `VERSION` | 플러그인이 지원하는 규격 버전 조회 | `supportedVersions` 등을 JSON으로 반환 |
| `STATUS` | 새 ADD 요청을 처리할 준비 상태 조회 | spec 1.1.0부터, 특정 attachment 검사가 아님 |
| `GC` | 유효한 attachment 목록 밖의 남은 자원 정리 | spec 1.1.0부터, DEL을 대체할 수 없음 |

명령이 규격에 존재한다는 사실과 런타임이 그 명령을 자동 호출한다는 사실을 구분해야 합니다
플러그인의 지원 버전과 콜백 구현, 사용하는 설정 버전도 함께 확인해야 합니다

## 체인은 결과를 이어 받고 삭제할 때 역순으로 실행합니다

하나의 네트워크 설정에는 여러 플러그인을 목록으로 둘 수 있습니다
`ADD`에서는 목록 순서대로 실행하고 앞 플러그인의 결과를 다음 요청 설정의 `prevResult`에 넣습니다

`prevResult`를 받은 플러그인은 자기 변경을 반영한 결과를 다시 반환해야 합니다
결과 형식에 나타나는 변경이 없다면 받은 결과와 동등한 값을 반환합니다
뒤 단계가 필요로 하는 앞 단계의 정보를 지우지 않도록 하는 규칙입니다

아래는 플러그인 세 개를 둔 설정의 개념 예입니다

![세 플러그인의 ADD는 직전 결과를 누적하고 DEL은 역순으로 같은 마지막 ADD 결과를 받는 개념 예|tall](/diagrams/k8s-theory-cni-contract-2.svg)

런타임은 마지막 ADD 결과를 저장해 두어야 합니다
[`libcni.AddNetworkList`](https://github.com/containernetworking/cni/blob/3f51e8803ebbdba0ebeed735b42137e4c7302403/libcni/api.go)는 체인이 모두 성공하면 결과와 설정 등을 파일에 저장합니다
이 기록은 이후 CHECK·DEL이 기대 상태를 확인하거나 정리할 때 사용합니다

`DEL`은 플러그인 목록을 역순으로 실행합니다
각 플러그인의 `prevResult`는 직전 삭제 결과가 아니라 **마지막 ADD 결과**입니다
CHECK도 같은 마지막 결과를 받지만 실행 순서는 목록 순서입니다

현재 libcni의 `DelNetworkList`는 spec 0.4.0 이상에서 저장된 결과를 가져옵니다
그 결과를 못 읽으면 비어 있는 값으로 삭제를 시도합니다
플러그인도 `prevResult`나 인터페이스가 이미 사라진 경우를 고려해야 합니다

### IPAM은 런타임 체인의 다음 항목과 다릅니다

**IPAM(IP Address Management)**은 인터페이스에 사용할 주소와 경로 등을 할당하는 역할입니다
상위 CNI 플러그인은 `ipam.type`이 지정한 실행 파일에 이 작업을 위임할 수 있습니다
호출 책임은 런타임이 아니라 상위 플러그인에 있습니다

위임받은 플러그인은 `ipam` 블록만 받는 것이 아니라 상위 플러그인이 받은 설정 전체와 환경 변수를 받습니다
IPAM 결과는 `interfaces` 배열과 `ips` 안의 인터페이스 인덱스가 빠진 축약 결과입니다
상위 플러그인이 그 주소·경로를 실제 인터페이스 설정에 사용한 뒤 런타임에 답합니다

plugins v1.9.1의 [`bridge`](https://github.com/containernetworking/plugins/blob/adc3e6b5b581638afbd194cf2e9319ecbb0151a1/plugins/main/bridge/bridge.go)는 주소 구성이 필요한 경로에서 `ipam.ExecAdd`를 호출합니다
[`README`](https://github.com/containernetworking/plugins/blob/adc3e6b5b581638afbd194cf2e9319ecbb0151a1/README.md)의 `host-local`은 할당 IP의 로컬 DB를, `dhcp`는 호스트 데몬을 사용합니다
같은 실행 파일 호출 규약을 따라도 주소를 고르고 보관하는 방식은 달라질 수 있습니다

Kubernetes의 NodeIPAM과도 구분해야 합니다
[`rangeAllocator`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/nodeipam/ipam/range_allocator.go)는 Node의 `spec.podCIDRs`에 대역을 배정합니다
노드 대역 배정과 개별 attachment의 주소 할당은 다른 작업이며 그 대역을 사용하는지는 네트워크 구현에 달립니다

## ADD 실패 뒤에도 삭제 책임은 남습니다

네트워크 구성 중 오류가 나면 체인의 다음 ADD를 멈추고 호출자에게 오류를 반환합니다
그때까지 만든 인터페이스나 예약까지 자동으로 없어진다는 뜻은 아닙니다

spec은 ADD가 실패한 경우에도 런타임이 대응하는 DEL을 실행하도록 요구합니다
단순히 결과 JSON을 못 받았다는 이유로 정리할 자원이 없다고 판단할 수 없습니다
namespace를 마지막에 정리하는 책임도 런타임에 있습니다

containerd의 [`RunPodSandbox`](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/server/sandbox_run.go)는 `setupPodNetwork`를 부르기 **전에** 오류 시 네트워크를 정리할 defer를 등록합니다
호출이 실패해도 자원이 이미 배정됐을 수 있기 때문이라고 주석이 설명합니다
[`teardownPodNetwork`](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/server/sandbox_stop.go)는 go-cni의 Remove를 통해 삭제를 요청합니다

정리 요청도 실패할 수 있으므로, 요청을 보냈다는 사실만으로 모든 자원이 회수됐다고 판단할 수는 없습니다
플러그인은 반복된 DEL과 이미 없는 인터페이스를 받아들여야 하고, namespace가 없어도 주소 예약 등 가능한 정리를 수행해야 합니다

최종 ADD 결과와 IPAM의 주소 예약은 서로 다른 기록입니다
DEL이 누락되거나 정리에 실패하면 한쪽 기록만 남을 수 있습니다
GC는 런타임이 전달한 유효한 attachment 집합을 기준으로 남은 자원을 정리하는 별도 통로이며 DEL의 대체 수단이 아닙니다

[`libcni.GCNetworkList`](https://github.com/containernetworking/cni/blob/3f51e8803ebbdba0ebeed735b42137e4c7302403/libcni/api.go)는 제공되지만, 그것만으로 특정 런타임이 주기적으로 GC를 실행한다고 판단할 수는 없습니다
확인한 go-cni의 공개 CNI 인터페이스에는 별도 GC 메서드가 없고, plugins의 bridge 등록부도 GC 콜백을 구현하지 않은 상태입니다
규격의 GC 설명을 모든 설치 조합의 자동 회수 보장으로 읽으면 안 됩니다

## containerd는 설정 탐색과 준비 상태를 따로 판단합니다

확인한 containerd v2.4.2의 [CRI 설정 문서](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/docs/cri/config.md)는 `io.containerd.cri.v1.runtime`의 `cni` 설정을 사용합니다

| 설정 키 | 기본값 | 뜻 |
|---|---|---|
| `bin_dirs` | `['/opt/cni/bin']` | 실행 파일 탐색 디렉터리 |
| `conf_dir` | `/etc/cni/net.d` | 네트워크 설정 디렉터리 |
| `max_conf_num` | `1` | 로드할 네트워크 설정 파일 수, 0이면 제한 없음 |

go-cni의 [`loadFromConfDir`](https://github.com/containerd/go-cni/blob/8c8d2ad0f236a8fa1084314d97c5204af8b98d24/opts.go)는 `.conf`, `.conflist`, `.json` 파일을 이름 순으로 정렬합니다
앞에서부터 해석하고 설정된 개수만큼 로드합니다
중간에 잘못된 설정을 만나면 오류를 반환하므로 무조건 다음의 정상 파일로 넘어가는 탐색은 아닙니다

기본 설정 파일 하나 안에 체인의 플러그인이 여러 개 들어갈 수 있습니다
`max_conf_num = 1`은 플러그인 한 개만 실행한다는 뜻이 아닙니다
또한 CNI spec이 기본 네트워크를 이름 순 첫 파일로 정한 것이 아니라 이 로더의 선택 규칙입니다

### STATUS가 있어도 설정의 cniVersion을 봐야 합니다

containerd의 [`Status`](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/server/status.go)는 기본 네트워크 플러그인의 `Status()` 결과를 CRI의 `NetworkReady` 조건에 반영합니다
오류면 reason을 `NetworkPluginNotReady`, message를 `Network plugin returns error: …`로 설정합니다

go-cni v1.1.14의 [`Status`](https://github.com/containerd/go-cni/blob/8c8d2ad0f236a8fa1084314d97c5204af8b98d24/cni.go)는 설정 로드 상태를 먼저 확인한 뒤 libcni의 `GetStatusNetworkList`를 호출합니다
이 함수는 설정의 `cniVersion`이 1.1.0 미만이면 STATUS 실행 없이 성공을 반환합니다
현재 라이브러리를 쓴다는 사실만으로 모든 설정에 STATUS가 호출되는 것은 아닙니다

플러그인 STATUS는 새 ADD를 처리할 준비가 됐는지 묻습니다
필요한 외부 데몬을 사용할 수 없거나 주소가 고갈돼 새 연결을 만들 수 없으면 오류를 보고할 수 있습니다
기존 attachment의 설정을 점검하는 CHECK와는 확인 대상이 다릅니다

spec은 STATUS를 정보 제공용으로 정합니다
실패 뒤에도 다른 CNI 요청을 받을 수 있어야 하며 플러그인은 STATUS가 반드시 먼저 호출된다고 가정하면 안 됩니다
그 결과를 받아 신규 Pod 생성을 막을지는 런타임과 kubelet의 별도 처리입니다

## 같은 준비 오류라도 노드 조건과 Pod Event는 다릅니다

kubelet의 [`updateRuntimeUp`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kubelet.go)은 런타임의 NetworkReady를 읽습니다
false이거나 없으면 `container runtime network not ready: …`로 감싸 내부 네트워크 오류 상태에 반영합니다
이 오류는 [`ReadyCondition`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/nodestatus/setters.go)의 노드 Ready 판정에도 들어갑니다

개별 Pod를 동기화하는 `SyncPod`는 이 네트워크 오류가 있고 `hostNetwork`가 아니면 `NetworkNotReady` Event를 남기고 진행을 막습니다
`hostNetwork` Pod는 **이 검사**에서 제외되므로 Pod 네트워크를 준비할 DaemonSet도 그 예외를 사용할 수 있습니다
다른 시작 조건까지 모두 통과한다는 뜻은 아닙니다

| 증상·문구 | 구분할 위치 |
|---|---|
| 노드 Ready 조건에 `NetworkPluginNotReady` | 런타임이 보고한 기본 네트워크의 준비 상태 |
| Pod Event의 `NetworkNotReady`, `network is not ready: …` | kubelet의 Pod별 시작 전 검사 |
| `cni plugin not initialized` | go-cni에 필요한 네트워크 설정이 로드됐는지 확인 |
| 설정 파일 여러 개 중 하나만 적용 | `max_conf_num`과 이름 정렬, 파일 파싱 오류 확인 |
| Pod IP가 상태에 없음 | 런타임의 PodSandboxStatus와 kubelet의 IP 파싱 경로 확인 |
| NetworkPolicy 생성 뒤에도 통신이 그대로임 | 정책을 집행하는 네트워크 구현의 지원·적용 상태 확인 |

위 표는 소스의 조건과 오류 문구를 정리한 것으로 실제 장애 로그가 아닙니다
특히 `cni plugin not initialized`라는 라이브러리 문구와 이를 감싼 런타임·kubelet의 메시지를 하나의 컴포넌트가 만든 문자열로 읽으면 안 됩니다

kubelet의 [`determinePodSandboxIPs`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_sandbox.go)는 런타임이 보고한 IP와 추가 IP를 검사해 사용합니다
네트워크 정보가 없거나 주소를 파싱하지 못하면 로그를 남기고 빈 결과를 반환할 수 있습니다
kubelet이 여기서 새 주소를 할당하는 것은 아닙니다

첫 네트워크 Pod 시작 지연도 CNI 미준비만으로 단정할 수 없습니다
[`kubelet_first_network_pod_start_sli_duration_seconds`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/metrics/metrics.go)는 이미지 pull과 init 실행 시간을 제외한 첫 네트워크 Pod 시작 시간을 다루는 INTERNAL 지표입니다
STATUS 제안을 가리키는 주석은 있지만 지표 하나가 특정 지연 원인을 확정하지는 않습니다

CNI의 ADD·DEL은 대상의 네트워크 연결을 구성하고 해제하는 명령입니다
클러스터 네트워크 전체를 만들고 운영하는 일을 이 명령들만으로 설명할 수는 없습니다
실행 파일 호출이 끝나도 외부 에이전트, 런타임의 결과 파일, IPAM의 예약 상태는 남을 수 있습니다
장애를 조사하거나 자원을 정리할 때도 각각을 관리하는 구성요소를 확인해야 합니다

## 확인한 근거

- [CNI spec 1.1.0 문서](https://github.com/containernetworking/cni/blob/3f51e8803ebbdba0ebeed735b42137e4c7302403/SPEC.md), [libcni 실행·결과 보관](https://github.com/containernetworking/cni/blob/3f51e8803ebbdba0ebeed735b42137e4c7302403/libcni/api.go) — 환경 변수, JSON, 명령, 체인, 위임과 정리 책임
- [containerd v2.4.2 의존 버전](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/go.mod), [CRI 네트워크 생성](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/server/sandbox_run.go), [상태 보고](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/server/status.go) — 실제 구현 예시의 호출 경계
- [go-cni v1.1.14](https://github.com/containerd/go-cni/tree/8c8d2ad0f236a8fa1084314d97c5204af8b98d24), [plugins v1.9.1](https://github.com/containernetworking/plugins/tree/adc3e6b5b581638afbd194cf2e9319ecbb0151a1) — 이 글에서 확인한 고정 ref, 실제 노드 설치 확인과는 별도
- [공식 Kubernetes 네트워크 모델](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/services-networking/_index.md), [Network Plugins](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/extend-kubernetes/compute-storage-net/network-plugins.md) — 통신 요구와 런타임·외부 구현의 책임
