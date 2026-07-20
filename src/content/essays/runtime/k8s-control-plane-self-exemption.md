---
title: "왜 쿠버네티스는 Go의 한계를 튜닝하지 않을까 — 한도를 강제하는 자의 자기 면제"
excerpt: "쿠버네티스를 구성하는 kube-apiserver와 controller-manager는 Go로 작성되었지만, 정작 자신들은 cgroup OOMKill 처형선 밖에 있으며 GOGC나 automaxprocs 같은 런타임 손잡이도 사용하지 않습니다. 6부 첫 편에서는 도커와 kind 실측을 통해 컨트롤 플레인의 메모리 면제 상태와 2,390개 유휴 고루틴의 VMA/PTE 커널 원가를 해부합니다"
category: runtime
tags:
  - go
  - kubernetes
  - cgroup
  - runtime
  - goroutine
series:
  name: "kernel-runtime-tradeoffs-6"
  order: 1
date: "2026-07-18"
---

> **시리즈 "커널과 런타임으로 톺아보는 Rust · Go · Java"의 23편 — 6부 1편**
> [22편](/essays/cloud-economics-decision-matrix)에서 5부를 마무리하며 컨테이너 환경에서 힙 밖 고정비가 만드는 클라우드 경제학과 의사결정 매트릭스를 정리했습니다
> 6부에서는 무대를 바꿔 **쿠버네티스 자체의 Go 런타임**을 해부합니다. Go의 한계를 모두 안고 있는 Go로 작성된 거대 시스템이 어떻게 수천 개 노드를 지탱하는지 질문합니다
> 첫 편의 핵심은 다음과 같습니다. **쿠버네티스는 Go 런타임 파라미터를 튜닝해서 한계를 극복하지 않았습니다. 바이너리에 손잡이를 쥐는 대신, 한도가 적용되는 궤도 자체를 벗어나고 아키텍처 우회로를 택했습니다**

이번 편과 앞으로 이어질 6부의 수치는 모두 쿠버네티스 v1.36.1 소스코드 분석과 kind(colima 안 도커, 리눅스 커널 6.8.0, cgroup v2) 클러스터에서 직접 계측한 결과입니다

---

## 잣대를 강제하는 자와 적용받는 자의 모순

[18편](/essays/container-memory-accounting-cgroup)에서 도커 컨테이너에 `memory.max` 한도를 씌우고 Go 서비스를 올렸을 때 발생한 비극을 추적했습니다
Go 런타임은 GC 목표치를 562MiB로 잡았지만 커널의 cgroup 한도는 512MiB였고, GC가 동작하기도 전에 커널이 `SIGKILL`을 보내 파드를 무자비하게 처형했습니다

이 때문에 일반 워크로드로서 Go 애플리케이션을 쿠버네티스 컨테이너에 배포할 때는 두 가지 방어 수칙이 생존을 위한 정석으로 통합니다

1. [2편](/essays/thread-models-kernel-vs-user)에서 살핀 것처럼 컨테이너의 CPU 한도를 Go 스케줄러가 인식하도록 `automaxprocs`를 적용해 스레드 낭비와 CFS 런큐 경합을 막습니다
2. [18편](/essays/container-memory-accounting-cgroup)에서 증명한 것처럼 `GOMEMLIMIT` 환경 변수를 파드 한도보다 10% 아래로 설정해 GC가 커널의 처형선 전에 메모리를 회수하도록 강제합니다

여기서 시스템 엔지니어의 관점을 쿠버네티스 플랫폼 내부로 돌려보면 자연스러운 의문이 맞닥뜨려집니다
**그렇다면 이 엄격한 자원 잣대를 클러스터 전체의 파드들에게 강제하는 쿠버네티스 자신은 어떻게 동작할까요**

`kube-apiserver`, `kube-controller-manager`, `kubelet`은 모두 수십만 줄이 넘는 거대한 Go 프로그램입니다
만약 이 핵심 데몬들이 우리가 작성한 일반 유저 파드처럼 메모리 한도 문턱에서 GC와 OOMKill 사이의 아슬아슬한 줄타기를 벌인다면, 클러스터 제어 평면(`Control Plane`)은 트래픽 스파이크나 노드 장애 시 일어나는 동시 상태 보고에 즉각 무너지고 말 것입니다

---

## 처형선 밖에서 도는 컨트롤 플레인

쿠버네티스 컨트롤 플레인이 대규모 트래픽 폭주와 메모리 압박을 견뎌내는 첫 번째 비밀은 고도의 Go 런타임 최적화가 아닙니다
**리눅스 커널이 그어 놓은 cgroup 처형선 자체를 물리적으로 비켜 가는 특권적 배치**에 있습니다

kind(v1.36.1, kubeadm 표준 구성) 클러스터 안에서 실제 제어 평면 파드들의 매니페스트 자원 설정과 리눅스 커널 cgroup v2 파일 시스템의 실측치를 계측했습니다

| 파드/데몬명 | 매니페스트 `resources` 설정 | QoS 클래스 / 배포 형태 | cgroup `memory.max` 실측치 | 실측 메모리 (`memory.current`) |
|---|---|---|---|---|
| `kube-apiserver` | `requests.cpu: 250m` (limits 없음) | `Burstable` (Static Pod) | **`max` (무제한)** | **189.3 MiB** |
| `etcd` | `requests.cpu: 100m` | `Burstable` (Static Pod) | **`max` (무제한)** | 54.2 MiB |
| `kube-controller-manager` | `requests.cpu: 200m` | `Burstable` (Static Pod) | **`max` (무제한)** | 48.1 MiB |
| `kube-proxy` | 설정 없음 | `BestEffort` (**DaemonSet**) | **`max` (무제한)** | 22.4 MiB |
| `coredns` (비교군 워크로드) | `limits.memory: 170Mi` | `Burstable` (Deployment) | **178,257,920** (=170 MiB) | 18.6 MiB |

표의 계측치는 컨트롤 플레인이 누리는 특권의 실체를 여과 없이 보여줍니다
일반 워크로드를 대표하는 비교군 파드인 `coredns`는 cgroup `memory.max` 파일에 170MiB 상한이 정확히 바이트 단위로 쐐기처럼 박혀 있습니다

반면 `kube-apiserver`와 `etcd`를 비롯한 핵심 컨트롤 플레인 파드들은 매니페스트에 메모리 `limits` 설정이 전혀 없으며, 커널 cgroup v2 설정의 상한값 또한 문자 그대로 **`max`** 로 개방되어 있습니다

![처형선 밖에서 도는 컨트롤 플레인](/diagrams/k8s-control-plane-self-exemption-1.svg)

[18편](/essays/container-memory-accounting-cgroup)과 [19편](/essays/gc-headroom-bin-packing-density)에서 우리가 가장 두려워했던 **"GC 여유 공간(`Headroom`) 부족으로 인한 OOMKill 처형선"이 쿠버네티스 제어 평면에게는 커널 수준에서 아예 존재하지 않는 것**입니다

`kube-apiserver`는 유휴 상태에서도 189.3 MiB(`memory.current = 198,500,352` 바이트)를 상주 메모리로 꾸준히 점유합니다
클러스터에 대규모 파드가 생성되거나 워치(`Watch`) 스트림 이벤트가 몰려 힙 영역이 400MiB나 800MiB까지 가파르게 팽창하더라도 커널 cgroup 서브시스템은 이 프로세스를 처형 대상 리스트에 올리지 않습니다

호스트 노드 전체의 물리 RAM이 완전히 고갈되어 커널의 전역 OOM Killer(`Global OOM`)가 비상 대기에 들어가지 않는 한, 컨트롤 플레인은 인위적인 상한선 밖에서 무제한의 물리 메모리를 호흡하며 생존을 보장받습니다

### cgroup v2 계층 구조와 Static Pod 배치의 물리적 진실

컨트롤 플레인이 처형선에서 면제되는 원리를 제대로 이해하려면, 호스트 운영체제가 프로세스를 나누는 `systemd` 관리 영역(`system.slice`)과 쿠버네티스가 파드를 가두는 `kubepods.slice` 계층 트리의 물리적 구획을 명확히 구분해야 합니다

흔히 컨트롤 플레인 데몬들이 호스트의 `system.slice`에서 돌기 때문에 컨테이너 격리를 벗어난다고 오해하기 쉽습니다
하지만 실제 리눅스 VFS(`/sys/fs/cgroup/`) 트리를 바닥까지 내려가 보면, 각 컴포넌트의 거주 계층은 엄격히 분리되어 있습니다

`kubelet` 서비스나 컨테이너 런타임(`containerd`, `CRI-O`)은 호스트 OS의 `systemd`가 직접 기동하고 관리하므로 `/sys/fs/cgroup/system.slice/kubelet.service` 같은 호스트 시스템 슬라이스에 위치합니다

반면 표준 `kubeadm` 구성에서 `kube-apiserver`, `etcd`, `kube-controller-manager`는 `/etc/kubernetes/manifests/` 디렉터리의 정적 정의 파일을 `kubelet`이 읽어 기동하는 **정적 파드(`Static Pod`)** 로 동작합니다
정적 파드 또한 `kubelet`이 파드 형태로 컨테이너를 스폰하기 때문에, 물리적인 cgroup 파일 시스템 상의 주소는 `/sys/fs/cgroup/kubepods.slice/kubepods-burstable.slice/pod<UID>/` 하위에 생성됩니다

```text
[리눅스 커널 /sys/fs/cgroup/ 계층 분리 트리]

/sys/fs/cgroup/
 ├── system.slice/
 │    └── kubelet.service ─────────────────────> Host OS 데몬 (systemd 직접 관리, unconstrained)
 └── kubepods.slice/
      ├── kubepods-burstable.slice/
      │    ├── pod<API_SERVER_UID>/ ───────────> Static Pod (kube-apiserver): memory.max = max (처형 면제!)
      │    └── pod<COREDNS_UID>/ ──────────────> 일반 워크로드 (CoreDNS): memory.max = 178257920 (170MiB 한도)
      └── kubepods-besteffort.slice/
           └── pod<KUBE_PROXY_UID>/ ───────────> DaemonSet (kube-proxy): memory.max = max (system-node-critical, --oom-score-adj=-999)
```

그렇다면 어떻게 동일한 `kubepods.slice` 트리 아래에 속한 정적 파드가 처형을 완벽히 면제받을 수 있을까요
진정한 해답은 **정적 파드의 매니페스트(`resources.limits.memory`)에 상한 속성이 고의로 부재한다는 점**과, 이에 따른 cgroup 파일 시스템 상의 상한 개방 메커니즘에 있습니다

`kubelet`은 파드를 생성할 때 `limits.memory`가 지정되지 않은 정적 파드에 대해서는 해당 cgroup 경로의 `memory.max` 파일에 어떤 숫자 한도도 기록하지 않습니다
그 결과 커널은 이 파드의 슬라이스에 대해 메모리 회수 및 상한 감시 메커니즘을 작동시키지 않고 **`max`** 상태로 개방합니다

### kswapd 백그라운드 회수와 Direct Reclaim 동기 회수 비켜 가기

`memory.max = max`라는 설정이 리눅스 커널 내부의 페이지 회수(`Page Reclamation`) 메커니즘에서 가지는 물리적 의미는 상상을 초월할 정도로 막강합니다
이를 이해하기 위해 리눅스 커널 메모리 관리자(`mm/vmscan.c`)가 작동하는 두 단계의 회수 경로를 톺아봅니다

일반 유저 파드처럼 cgroup의 `memory.max`가 512MiB로 그어져 있는 상태에서 프로세스 메모리가 차오르면 커널은 다음 두 가지 단계로 개입합니다

1. **`kswapd` 백그라운드 회수**: `memory.current`가 `memory.high` 한도에 근접하면 커널 백그라운드 스레드인 `kswapd`가 깨어나 해당 cgroup 슬라이스의 비활성 LRU(`Least Recently Used`) 페이지를 비동기로 회수하거나 스왑 아웃합니다
2. **`Direct Reclaim` 동기 회수**: 메모리 할당 속도가 `kswapd`의 회수 속도를 앞질러 상한에 도달하면, 메모리를 요청한 애플리케이션의 스레드(`malloc`/`mmap`을 호출한 고루틴의 OS 스레드)를 커널이 즉각 블로킹시키고 커널 모드에서 직접 페이지를 스캔하고 해제하는 **동기 직접 회수(`Direct Reclaim`)** 모드로 강제 진입시킵니다

`Direct Reclaim`에 징집된 애플리케이션 스레드는 커널이 페이지를 확보할 때까지 수 밀리초에서 수십 밀리초 동안 CPU를 뺏긴 채 멈춰 섭니다
이것이 바로 컨테이너 환경에서 이유 없이 API 레이턴시 꼬리가 튀는 락업(`Lockup`) 현상의 주범입니다

하지만 `memory.max = max`로 열려 있는 `kube-apiserver`는 cgroup 수준의 `memory.high`나 `memory.max` 상한선 자체가 없으므로, 고루틴이 힙 메모리를 추가로 요청(`runtime.sysAlloc()`)할 때 커널의 cgroup 스로틀링이나 `Direct Reclaim` 페널티를 전혀 겪지 않습니다

### 커널 Badness 점수와 oom_score_adj의 이중 방어선

cgroup 상한 개방이 평시의 메모리 할당 지연을 없애준다면, 노드 전체 물리 RAM이 바닥나는 비상 상황(`Global OOM`)을 대비한 이중 방어선은 **커널의 Badness Score 휴리스틱 조작**입니다

리눅스 커널(`mm/oom_kill.c`의 `select_bad_process()`)은 메모리가 고갈되었을 때 희생양을 선택하기 위해 각 프로세스의 위험도 점수를 0에서 1000 사이의 값으로 산정합니다
기본 산식은 프로세스가 점유한 상주 메모리(`RSS`), 페이지 테이블, 스왑 사용량의 합을 호스트 전체 RAM 용량으로 나눈 뒤 1000을 곱하는 구조입니다

```text
Badness Score = (RSS + Page Table + Swap) ÷ Total RAM × 1000 + oom_score_adj
```

커널은 메모리를 많이 쓸수록 높은 점수를 매겨 우선적으로 살해하지만, 여기에 사용자나 시스템이 주입하는 보정치인 **`oom_score_adj` (-1000 ~ +1000)** 가 최종 판결을 좌우합니다

쿠버네티스는 파드의 QoS 클래스에 따라 이 보정치를 커널에 강제 주입합니다

- **`Guaranteed`**: `-997` (가장 마지막까지 처형이 유예됨, `guaranteedOOMScoreAdj`)
- **`Burstable`**: `2 ~ 999` (메모리 요청량 대비 초과 사용 비율에 비례하여 동적 설정)
- **`BestEffort`**: `1000` (OOM 발생 시 희생양 선택 0순위로 즉각 처형, `besteffortOOMScoreAdj`)

여기서 흔히 "모든 컨트롤 플레인 데몬이 `-999`를 부여받는다"고 오해하지만, 실제 소스코드와 노드 커널 실측은 정교한 2단계 계급 차별을 증명합니다
`kubelet` 서비스 프로세스와 `kube-proxy`(`--oom-score-adj=-999` 플래그 주입)는 `-999`를 받지만, 정적 파드로 스폰되는 `kube-apiserver`, `etcd`, `kube-controller-manager`는 **`-997`**을 받습니다

```go
// pkg/kubelet/qos/policy.go:28~49 실측 소스코드 패턴
const (
	KubeletOOMScoreAdj    int = -999 // kubelet 프로세스 자신 전용
	KubeProxyOOMScoreAdj  int = -999 // kube-proxy 데몬셋 전용
	guaranteedOOMScoreAdj int = -997 // Guaranteed 및 시스템 크리티컬 파드
	besteffortOOMScoreAdj int = 1000
)

func GetContainerOOMScoreAdjust(pod *v1.Pod, container *v1.Container, memoryCapacity int64) int {
	if types.IsNodeCriticalPod(pod) {
		// 노드 핵심(Static Pod 포함 system-node-critical) 파드는 무조건 -997 부여
		return guaranteedOOMScoreAdj
	}
	// ... (Guaranteed: -997, BestEffort: 1000, Burstable: 2~999 휴리스틱)
```

실제 kind 노드(colima 4C/6G, Linux 6.8.0) 내부에서 `/proc/<pid>/oom_score_adj`를 전수 계측한 결과는 `policy.go`의 상수를 정확히 비춥니다

```text
# kind 컨트롤 플레인 노드 내부 실측 (/proc/<pid>/oom_score_adj)
-999 | PID 198  | /usr/bin/kubelet --bootstrap-kubeconfig=/etc/kubernetes/bootstrap-kubelet.conf
-999 | PID 1072 | /usr/local/bin/kube-proxy --config=/var/lib/kube-proxy/config.conf
-997 | PID 564  | kube-apiserver --advertise-address=172.18.0.2 ...
-997 | PID 572  | etcd --advertise-client-urls=https://172.18.0.2:2379 ...
-997 | PID 582  | kube-controller-manager --allocate-node-cidrs=true ...
 989 | PID 1144 | /coredns -conf /etc/coredns/Corefile (Burstable 휴리스틱 산출치)
```

`kube-apiserver`가 워커 노드들의 상태 보고 폭주로 2GiB 이상의 힙을 소모하더라도, 커널 산식에 `-997`이 더해지므로 Badness 점수는 0 부근이나 음수로 곤두박질칩니다
그 결과 노드 전체의 물리 RAM이 고갈되는 극단적 재난 상황에서도, 커널 OOM Killer는 1000점(`BestEffort`)이나 989점(`coredns`)을 기록한 유저 및 보조 파드들을 먼저 연속해서 도살할 뿐 컨트롤 플레인은 마지막 순간까지 건드리지 못합니다

---

## 런타임 손잡이의 부재와 부재의 증거

컨트롤 플레인이 처형선 밖에 서 있고 커널의 징집에서 자유롭다면, 내부 Go 런타임 설정은 어떻게 조율되어 있을까요
고성능 트래픽을 처리하는 대형 Go 서버라면 으레 설정하기 마련인 가비지 컬렉터 튜닝이나 프로세서 캡 제어 파라미터를 소스코드와 실행 로그에서 검증했습니다

우선 실행 중인 `kube-apiserver` 파드가 기동될 때 출력한 실제 시작 로그를 추적합니다

```text
$ kubectl logs -n kube-system kube-apiserver-rt6-control-plane | grep "Golang settings"
I0714 04:31:18.339344       1 server.go:152] "Golang settings" GOGC="" GOMAXPROCS="" GOTRACEBACK=""
```

표준 구성 클러스터에서 핵심 런타임 환경 변수 세 가지는 **전부 빈 문자열(`""`)** 로 나타납니다
운영자나 클러스터 프로비저너가 외부에서 Go 런타임 제어 파라미터를 단 하나도 명시적으로 주입하지 않았다는 명백한 증거입니다

그렇다면 외부 환경 변수가 비어 있으니, 소스코드 내부에서 Go 런타임 API를 호출해 손잡이를 프로그래밍 방식으로 조절하고 있을까요
쿠버네티스 v1.36.1 전체 소스코드 트리(`vendor/` 의존성 패키지 포함)를 대상으로 핵심 튜닝 API의 호출 패턴을 정밀 전수 검사했습니다

| 검증 항목 | 검색 대상 패턴 | 결과 | 소스코드 근거 및 비고 |
|---|---|---|---|
| 컨테이너 CPU 인식 | `uber-go/automaxprocs` | **0건** | `go.mod` 및 `go.sum` 내 외부 스레드 제어 라이브러리 의존성 전무 |
| GC 빈도 및 목표 튜닝 | `debug.SetGCPercent` | **0건** | 쿠버네티스 코어 소스 트리 전체에서 호출 없음 |
| 메모리 한도 설정 | `debug.SetMemoryLimit` | **0건** | 표준 라이브러리 매니페스트(`stdlib/manifest.go`) 문자열 1건 외 실제 호출 전무 |
| 런타임 환경 설정의 역할 | `os.Getenv("GOGC")` | **로그 출력용** | 시작 시 설정값을 `klog.InfoS`로 기록만 하고 런타임 파라미터 변경 안 함 |

![런타임 손잡이 부재와 쿠버네티스의 아키텍처 선택](/diagrams/k8s-control-plane-self-exemption-2.svg)

검증 결과는 쿠버네티스 아키텍처의 설계 철학을 명확히 대변합니다
바이너리 내부 어디에도 Go 런타임의 가비지 컬렉터나 스케줄러를 인위적으로 비틀어 조작하는 손잡이가 존재하지 않습니다

- [2편](/essays/thread-models-kernel-vs-user)에서 컨테이너 CPU 스로틀링을 막기 위해 필수라고 강조했던 `automaxprocs` 라이브러리는 전혀 쓰이지 않습니다. Go 1.25 이후 표준 런타임에 내장된 컨테이너 인식(`containermaxprocs`)이 있기 전부터도 쿠버네티스는 이를 외면해 왔습니다
- [18편](/essays/container-memory-accounting-cgroup)에서 다룬 `GOMEMLIMIT`나 `debug.SetMemoryLimit`을 호출해 힙 상한을 강제하는 코드는 단 한 줄도 없습니다
- `cmd/kube-apiserver/app/server.go:152`와 `cmd/kubelet/app/server.go:547`을 비롯한 각 컴포넌트 시작점이 수행하는 작업은, 운영자가 혹시 넣었을지 모를 환경 변수를 읽어 **단지 감사(`Audit`) 로그에 찍어 확인하는 것**이 전부입니다

### Go 1.26 환경변수 수용 기전과 os.Getenv("GOGC") 감사 로그의 의미

여기서 한 가지 오해를 명확히 바로잡고 넘어가야 합니다
`server.go:152`에서 `os.Getenv("GOGC")`나 `os.Getenv("GOMEMLIMIT")`을 읽어 `klog.InfoS`로 출력하고 끝내는 모습을 보고, "쿠버네티스가 환경 변수로 주입된 런타임 파라미터마저 무시하는가"라고 생각하기 쉽습니다

그러나 Go 표준 런타임은 프로세스가 시작되어 `main()` 함수가 진입하기도 전에, 스케줄러 초기화 함수인 `src/runtime/proc.go`의 `schedinit()`을 거쳐 GC 페이서(Pacer) 코어 모듈인 `src/runtime/mgcpacer.go`(`gcController.init`)에서 OS 환경 변수를 스스로 읽어들여 GC 비율(`setGCPercent`)과 메모리 제한(`setMemoryLimit`) 상수를 셋업합니다
따라서 만약 운영자가 파드 명세에 `env`로 `GOMEMLIMIT=4GiB`를 명시적으로 주입한다면 Go 런타임 자체는 이를 성실히 반영합니다

이는 시스템의 **감사 및 추적성(`Traceability`)을 확보하기 위한 고도의 운영적 방어선**입니다

![컨테이너 환경변수 주입과 Go 런타임 엔진 초기화 vs K8s 감사 로그 이원화 파이프라인](/diagrams/k8s-control-plane-self-exemption-6.svg)

이원화된 실행 파이프라인의 흐름과 양단의 역할 분담을 따라가 보겠습니다

1. **Go 런타임 엔진의 자력 수용 (`schedinit` 왼쪽 경로)**: 컨테이너 실행 명령이 떨어지면, API Server의 `main()`이 진입하기도 전에 커널이 Go 런타임 초기화 루틴(`src/runtime/proc.go`의 `schedinit`)을 가장 먼저 가동합니다. 이 시점에 GC 컨트롤러(`mgcpacer.go`)는 `os.Environ`으로 OS 환경변수(`GOGC`, `GOMEMLIMIT`)를 직접 스캔하여 물리 힙 목표치(`gcController.init`)를 즉시 셋업합니다
2. **K8s API Server의 불변성 검증 및 감사 기록 (`server.go` 오른쪽 경로)**: 이후 `kube-apiserver` 코드가 실행될 때(`server.go:152`), 쿠버네티스는 `debug.SetGCPercent()` 같은 API로 런타임을 임의로 비틀거나 덮어쓰지 않습니다. 대신 `os.Getenv`로 현재 주입된 환경변수를 그대로 읽어 `klog.InfoS` 감사(`Audit`) 로그로 출력합니다

이 이원화 구조를 통해 운영자는 컨테이너 환경변수만으로 물리 힙을 정확히 제어할 수 있고, 동시에 프로세스 시작 로그만으로도 현재 실행 중인 GC 파라미터를 100% 신뢰하고 추적할 수 있습니다

```go
// cmd/kube-apiserver/app/server.go:152 부근 실측 소스코드 패턴
klog.InfoS("Golang settings",
	"GOGC", os.Getenv("GOGC"),
	"GOMAXPROCS", os.Getenv("GOMAXPROCS"),
	"GOTRACEBACK", os.Getenv("GOTRACEBACK"))
```

컨트롤 플레인이 프로덕션 환경에서 원인 모를 GC 스파이크나 지연 시간 이상을 겪을 때, 엔지니어는 가장 먼저 해당 바이너리가 어떤 메모리 한도와 GC 파라미터 상태로 기동되었는지 검증해야 합니다
쿠버네티스는 코드 내부에 숨겨진 `debug.*` API 호출로 런타임 파라미터를 남몰래 덮어쓰는 행위를 완벽히 금지함으로써, 시작 로그(`klog.InfoS`)에 찍힌 문자열만으로 현재 프로세스의 런타임 설정을 100% 신뢰할 수 있게 만듭니다

### 왜 런타임 손잡이를 거부했는가: GC 스래싱과 지연 시간의 역설

마이크로서비스 백엔드 개발자의 눈에는 컨트롤 플레인이 튜닝 손잡이를 내려놓은 선택이 기이하게 비칠 수 있습니다
[18편](/essays/container-memory-accounting-cgroup)에서 증명했듯, `GOMEMLIMIT`를 설정해 컨테이너 상한 전에 GC 회수를 강제하는 것은 Go 애플리케이션의 생명을 지키는 최후의 보루이기 때문입니다

이 정석을 쿠버네티스 코어 팀이 과감히 거부한 배경에는 `kube-apiserver`라는 프로세스가 감당하는 **초고동시성 IO-bound 허브로서의 극단적인 워크로드 특수성**이 자리하고 있습니다

일반 마이크로서비스는 제한된 상자 안에 갇혀 있으므로 힙이 차오를 때 GC가 공격적으로 돌며 CPU를 소모하더라도 컨테이너 OOMKill을 피하는 편이 낫습니다
하지만 `kube-apiserver`는 수천 개 워커 노드가 매초 쏟아내는 상태 보고(`heartbeat`), 모든 컨트롤러와 스케줄러가 유지하는 수만 개의 장기 `watch` 연결, 대규모 Protobuf/JSON 직렬화가 동반되는 전체 파드 목록 조회 요청(`kubectl get pods -A`)을 동시에 쳐내야 하는 클러스터의 중심점입니다

만약 이 초고동시성 허브에 인위적인 `GOMEMLIMIT`를 타이트하게 설정하고, 갑작스러운 트래픽 폭주로 힙 사용량이 상한 부근에 도달하면 치명적인 물리적 역설이 발생합니다

- Go 런타임은 설정된 상한 문턱을 넘지 않기 위해, 극도로 좁아진 여유 공간(`Headroom`) 내부에서 필사적으로 가비지 컬렉션을 시도합니다
- GC 컨트롤러(`gcControllerState.findRunnableGCWorker`)는 다음 GC 사이클을 쉴 틈 없이 바로 다시 가동하는 **GC Death Spiral(연속 GC STW 및 Mark Assist 강제 징집)** 상태로 빠져듭니다
- 힙을 할당하려던 API 요청 처리 고루틴들은 자신의 원래 임무를 멈춘 채 마크 어시스트(`runtime.gcAssistAlloc`)에 강제로 끌려가 포인터를 추적해야 합니다
- 이 스래싱(`Thrashing`) 상태에 진입하면 프로세스가 OOM으로 죽지는 않지만, 모든 API 응답의 P99 지연 시간(`Tail Latency`)이 수십 밀리초에서 수초, 심지어 수십 초까지 수직 폭등합니다
- API 응답이 지연되면 `etcd`와의 세션 리더십이 끊어지고, 노드들의 헬스체크가 시간 초과되어 멀쩡한 노드 수백 개가 동시에 `NotReady`로 빠지면서 **제어 평면 전체가 기능을 정지하는 연쇄 락업(`Control Plane Lockup`) 재난**이 터집니다

쿠버네티스 아키텍트들은 명확하고 단호한 트레이드오프를 택했습니다
**"메모리 상한에 갇혀 GC 스래싱을 일으키며 클러스터 전체 API 요청을 감당하지 못하게 할 바에야, 호스트의 넉넉한 RAM 여유분을 자유롭게 호흡하도록 두어 GC STW를 0.86ms 이하로 극소화하고 모든 요청을 즉각 처리하는 길"** 이 훨씬 안전하다는 결론입니다

`GOMAXPROCS`를 손대지 않고 호스트 코어를 전체 개방하는 이유 또한 같은 맥락입니다
Go 스케줄러(`runtime.schedule()`)는 `Work Stealing` 메커니즘을 통해 할 일이 없는 논리 프로세서(`P`)가 타 코어의 실행 큐에서 고루틴을 가져와 로드 밸런싱을 맞추고, 네트워크 폴러(`runtime.netpoll`)를 통해 OS 스레드 블로킹 없이 대규모 소켓 I/O를 처리합니다

`kube-apiserver`처럼 수만 개의 네트워크 파이프라인이 집중되는 시스템에 인위적인 프로세서 스레드 캡을 씌우면 런큐에 고루틴이 적체되어 지연 시간 스파이크를 유발합니다
호스트 전체 물리 코어 풀 위에서 Go 스케줄러가 자유롭게 스레드를 스폰하고 회수하도록 방임하는 것이 고빈도 I/O 워크로드를 견디는 최선의 설계입니다

이것이 6부 전체를 관통하는 핵심 전제입니다
**쿠버네티스는 Go 런타임 손잡이를 비틀어 Go의 한계를 극복하지 않았습니다. 튜닝 파라미터에 의존하는 대신, 병목과 한도가 적용되는 궤도 자체를 아키텍처 구조로 비켜 갔습니다**

---

## 유휴 apiserver의 2,390개 고루틴 원가 해부

런타임 튜닝 없이 상한 개방과 호스트 자원 방임으로 버틴다면, 실제 제어 평면 내부의 물리 메모리와 스레드는 어느 정도의 풋프린트를 유지하고 있을까요
파드 9개만 배포되어 조용히 숨 쉬고 있는 유휴(`IDLE`) 클러스터에서 `kube-apiserver`와 `kubelet`의 Go 런타임 지표를 직접 계측했습니다

| Go 런타임 지표 (`/metrics`) | `kube-apiserver` (컨트롤 플레인 심장) | `kubelet` (노드 에이전트) |
|---|---|---|
| 고루틴 수 (`go_goroutines`) | **2,390개** | 251개 |
| 유저 스택 사용량 (`go_memstats_stack_inuse_bytes`) | **17.4 MiB** | 3.78 MiB |
| 고루틴 1개당 실효 스택 (`stack_inuse / goroutines`) | **≈ 7.6 KB** | ≈ 15.8 KB |
| 힙 상주 메모리 (`go_memstats_heap_inuse_bytes`) | 169.8 MiB | (미집계) |
| 다음 GC 목표치 (`go_memstats_next_gc_bytes`) | 178.6 MiB | (미집계) |
| 1분위 GC STW 시간 (`go_gc_duration_seconds{quantile="1"}`) | **0.86 ms** (860 µs) | (미집계) |
| 누적 CPU 소비 시간 (`process_cpu_seconds_total`) | (미집계) | 4.64 s |

실측치에서 가장 직관적인 충격을 주는 지표는 **유휴 상태의 apiserver 내부에서 아무 요청을 처리하지 않음에도 이미 2,390개의 고루틴이 동시에 살아서 돌고 있다는 점**입니다
이 2,390개의 고루틴이 점유한 유저 스택 메모리 총합은 17.4 MiB이며, 고루틴 1개당 평균 **7.6 KB**의 메모리를 소모하고 있습니다

[10편](/essays/go-allocator-mcache-contiguous-stack)에서 다룬 Go 연속 스택(`Contiguous Stack`)의 최소 할당 시작 단위인 2 KB(`_StackMin`)에서 출발해, 장기 HTTP/2 리스너, `etcd` gRPC 세션 하트비트, 워치 이벤트 디스패치 핸들러들이 스택 프레임을 쌓고 수축하며 안착한 실효적인 풋프린트입니다

![2,390개 동시성 주체의 원가 비교](/diagrams/k8s-control-plane-self-exemption-3.svg)

### 1:1 OS 스레드 모델과의 물리 메모리 정량 비교

만약 쿠버네티스가 Go가 아닌 [2편](/essays/thread-models-kernel-vs-user)의 1:1 OS 스레드 모델 기반 언어(예: C++나 전통적 Java 스레드 모델)로 작성되어 2,390개의 동시성 주체를 OS 스레드(`pthread`)로 띄웠다면 리소스를 얼마나 낭비하게 될까요

개발자들 사이에서는 흔히 "POSIX 스레드 기본 스택이 8MB이므로 2,390 × 8 MB ≈ 19 GB의 가상 메모리가 소모되어 즉시 시스템이 다운된다"고 단순 계산하지만, 이는 정밀한 시스템 엔지니어링 대조가 아닙니다
[8편](/essays/kernel-lazy-allocation-page-fault)에서 규명했듯 8MB는 **가상 주소 공간(`Virtual Memory`)** 상의 예약치일 뿐, 실제 프레임이 쓰이지 않아 페이지 폴트(`Page Fault`)를 거치지 않은 물리 페이지는 RAM을 소모하지 않기 때문입니다

따라서 정직하고 냉혹한 **물리 메모리 상주 청구서(`Physical RAM Footprint`)** 로 정량 대조를 해야 Go 고루틴이 가지는 진정한 가벼움의 가치가 증명됩니다

1. **OS 스레드의 불변 커널 스택(`task_struct` + `Kernel Stack`)**: 리눅스 커널은 스레드(`clone()` 시스템 콜로 생성된 태스크) 하나를 생성할 때마다 프로세스 제어 블록(`task_struct`)과 함께 스왑 아웃이 불가능한 고정 **16 KB의 커널 스택(`ARCH_STACK_DEFAULT_USER`)** 을 물리 메모리에 상주시킵니다
2. **2,390개 스레드의 기본 커널 고정 원가**: 2,390 × 16 KB ≈ **38.2 MiB** 가 오직 스레드를 제어하고 시스템 콜을 대기하는 커널 공간의 자료 구조에만 묶여 버립니다. 유저가 단 한 줄의 함수도 실행하지 않고 대기만 하는 상태에서도 이 **커널 스택 풋프린트(38.2 MiB)만으로 Go 고루틴 2,390개가 사용하는 유저 스택 총합(17.4 MiB)을 2배 이상 압도**합니다
3. **스케줄링 폭탄과 CPU 캐시 유실**: 2,390개의 OS 스레드가 유휴 상태에서 각종 타이머나 소켓 이벤트로 동시에 깨어날 때, 리눅스 커널의 CFS 스케줄러는 런큐를 가다듬고 스레드 간 컨텍스트 스위칭을 강제합니다. 이 과정에서 발생하는 [1편](/essays/syscall-mode-switch-cost)의 유저-커널 모드 전환 비용과 L1/L2/L3 CPU 캐시 라인 축출은 제어 평면의 처리 효율을 바닥으로 끌어내립니다

### 연속 스택의 동적 확장과 shrinkstack GC 연동 수축의 물리

여기서 소스코드 바닥 구조로 한 걸음 더 내려가 질문을 던집니다
왜 유휴 고루틴 2,390개의 평균 스택 사용량은 초기 최소값인 2KB가 아니라 정확히 7.6KB(`17.4 MiB ÷ 2,390`)라는 중간 수치에 멈춰 있을까요

Go 런타임의 고루틴 연속 스택(`src/runtime/stack.go`)은 고정된 프레임이 아닙니다
최초 고루틴이 생성(`runtime.newproc`)될 때 `stackalloc` 함수는 `src/runtime/runtime2.go`에 정의된 `g` 구조체의 `stack` 타입 필드(`lo`, `hi`)에 기본 2 KB(`_StackMin`)의 바운더리를 설정하며, 크기가 작은 스택은 논리 프로세서 `P`의 전용 로컬 캐시인 `_p_.mcache.stackcache`에서 먼저 할당받고 부족할 경우 전역 풀(`stackpool`)이나 힙(`sysAlloc`)에서 가져옵니다
고루틴이 깊은 함수 호출 루프나 무거운 로컬 변수 할당으로 인해 스택 프레임 여유 공간이 고갈되면, 컴파일러가 각 함수 시작점에 심어둔 프롤로그가 `runtime.morestack`을 호출합니다
런타임은 기존 스택 크기를 정확히 2배(`2 KB -> 4 KB -> 8 KB -> 16 KB`)로 늘린 새 연속 스택을 `stackalloc`(`stackpool` 또는 `sysAlloc`)을 통해 할당한 뒤, 기존 프레임 데이터와 내부 포인터 주소를 정밀하게 재배치 복사하는 `runtime.copystack`을 실행합니다

`kube-apiserver` 내부의 고루틴들은 초기 기동 시 HTTP 라우터 등록, `etcd`와의 gRPC TLS 핸드셰이크, 인포머 캐시 동기화 등 무거운 초기화 콜스택을 지나며 이미 스택 크기를 8 KB나 16 KB로 확장한 상태입니다
이후 초기 작업이 끝나고 장기 대기 상태(`_Gwaiting`)로 들어가면서 현재 상태에 머무르게 된 것입니다

그렇다면 확장된 16 KB 스택 프레임은 고루틴이 소멸할 때까지 영구적으로 RAM을 차지하며 낭비를 일으킬까요
그렇지 않습니다. Go 런타임 가비지 컬렉터는 가동될 때마다 루트 영역을 스캔하는 `markroot` 단계에서 스택 수축(`Stack Shrinking`) 가능 여부를 정밀 검사합니다

- GC는 현재 고루틴이 대기(`_Gwaiting`) 상태이거나 스캔 안전 구간에 들어섰을 때, `src/runtime/runtime2.go`의 `g` 구조체가 보유한 스택 포인터 실제 범위(`g.stack.lo`부터 `g.stack.hi`)를 계산합니다
- 만약 **현재 사용 중인 프레임 용량이 전체 할당된 스택 용량의 4분의 1(25%) 미만**으로 내려갔다면, 런타임은 즉시 스택 크기를 절반(`16 KB -> 8 KB`)으로 줄이는 `runtime.shrinkstack` 함수를 호출합니다
- 줄어든 스택 공간에서 해제된 메모리 페이지(`mspan`)는 즉각 `_p_.mcache.stackcache`나 전역 `stackpool`로 반환되어 물리 메모리 재사용 궤도에 복귀합니다

바로 이 **동적 연속 스택 확장(`morestack`)과 GC 루트 스캔 연동 수축(`shrinkstack`) 메커니즘** 덕분에, 2,390개의 거대한 동시성 주체가 고정 물리 RAM을 과점하지 않고 실시간 워크로드 부침에 맞춰 단 17.4 MiB라는 초고밀도 초경량 풋프린트를 자력으로 유지합니다

### OS 스레드의 VMA와 PTE: 커널 메타데이터 단편화 세금

만약 쿠버네티스를 1:1 OS 스레드 모델로 구현했다면, 커널 스택 38.2 MiB 외에도 눈에 보이지 않는 메타데이터 세금을 무겁게 지불해야 합니다
운영체제 커널이 가상 메모리를 관리하기 위해 프로세스 가상 메모리 서술자(`mm_struct`) 내부에 구축하는 구조적 단편화 오버헤드 때문입니다

리눅스 커널은 스레드를 생성할 때마다 스레드 각자가 요청한 8MB 스택 가상 주소 공간이 정당한 메모리 영역임을 매핑하기 위해 **VMA(`Virtual Memory Area`, `vm_area_struct`)** 구조체 2,390개를 커널 레드-블랙 트리와 연결 리스트에 개별 생성하여 달아 둡니다

```text
[OS 스레드 (pthread) 2,390개 스택 매핑 구조 — 2,390 VMA & 단편화된 PTE 폭발]
Process mm_struct ──> VMA[Thread 1 Stack] ──> PGD -> P4D -> PUD -> PMD -> PTE (파편화)
                  ──> VMA[Thread 2 Stack] ──> PGD -> P4D -> PUD -> PMD -> PTE (파편화)
                  ... (총 2,390개 VMA 생성으로 커널 메모리 트리 팽창 및 TLB Miss 극대화!)

[Go 고루틴 (M:N) 2,390개 스택 매핑 구조 — 0 VMA / 0 PTE 단편화 오버헤드]
Process mm_struct ──> VMA[Go mheap Spans] ──> 단일 연속 사용자 힙 공간 안에서 2,390개 스택 공용 할당
                                              (추가 VMA 생성 0개, PTE 단편화 0, TLB 적중률 최적화!)
```

더 큰 물리적 재앙은 64비트 아키텍처의 4단계 페이지 테이블 변환(**PGD -> P4D -> PUD -> PMD -> PTE**) 구조에서 터져 나옵니다

- 2,390개의 OS 스레드가 사용하는 8MB 가상 스택 주소들은 연속되지 않고 가상 주소 공간 전체에 파편화되어 널리 흩어집니다
- 이 파편화된 주소들을 실제 물리 RAM 주소로 변환하기 위해, 커널 메모리 내부에는 수천 개의 페이지 테이블 디렉터리(`PTE` 페이지)가 조각조각 분열되어 생성됩니다
- 이 수천 개의 파편화된 PTE 구조체를 탐색하느라 CPU 내장 **TLB(`Translation Lookaside Buffer`)** 캐시 슬롯이 눈 깜짝할 사이에 100% 미스(`TLB Miss`)를 일으키며 포화됩니다
- 결국 CFS 스케줄러가 2,390개의 스레드를 컨텍스트 스위칭할 때마다 TLB 플러시와 메모리 버스 탐색 페널티가 지수적으로 누적됩니다

반면 Go 고루틴 모델에서 2,390개의 연속 스택(`_StackMin` ~ `16 KB`)은 OS 커널 입장에서 개별 가상 메모리 영역이 아닙니다
이 스택들은 Go 런타임의 전역 페이지 할당자(`mheap`)가 이미 커널로부터 연속으로 할당받아 매핑해 둔 단일 사용자 힙 공간 안의 스팬(`mspan`) 조각들에 불과합니다
따라서 커널은 2,390개의 고루틴이 생성되든 수만 개로 불어나든 **단 1개의 추가 VMA(`vm_area_struct`)도 생성하지 않으며, 페이지 테이블(`PTE`) 단편화 세금을 1 바이트도 부과하지 않습니다**

이것이 Go 고루틴이기에 2,390개의 막대한 동시성을 단 17.4 MiB의 유저 스택과 0 VMA 커널 오버헤드, 0.86ms라는 경이로운 GC STW로 감당할 수 있는 근본 물리적 귀결입니다

### 클라우드 & 인프라 실전 연결: 관리형 K8s의 면제 은닉과 온프레미스 가상화 세금

우리가 계측한 제어 평면의 특권적 면제(`memory.max = max`, `oom_score_adj = -997 / -999`)와 고루틴 스택 수축(`shrinkstack`) 기전은 클러스터가 배포되는 인프라 계층(AWS, GCP, OpenStack 온프레미스)의 물리적 형태에 따라 전혀 다른 모습과 운영적 부채로 발현됩니다

1. **관리형 컨트롤 플레인의 은닉과 클러스터 확장 데몬의 역설**
   클라우드 관리형 쿠버네티스(AWS EKS, GCP GKE)에서 `kube-apiserver`와 `etcd`는 클라우드 공급자가 관리하는 전용 인프라 영역에 숨겨지므로 사용자는 cgroup 처형선 면제의 혜택을 투명하게 보장받습니다
   그러나 사용자가 워커 노드에 직접 배포하는 CRD 기반 커스텀 오퍼레이터나 대형 컨트롤러(Karpenter, ArgoCD 등)는 API Server와 똑같이 고빈도 워치 스트림과 대규모 인포머 캐시를 유지하는 초고동시성 Go 워크로드임에도 정적 파드의 특권을 누리지 못하고 엄격한 `memory.max` 한도에 갇힙니다
   엔지니어가 이 데몬들에 대해 컨트롤 플레인처럼 튜닝 손잡이를 내려놓고 `GOMEMLIMIT`나 `automaxprocs`를 생략한다면, API Server가 비켜 갔던 커널 `Direct Reclaim` 동기 락업과 OOMKill 처형을 워커 노드 최전선에서 그대로 맞닥뜨리게 됩니다

2. **온프레미스 가상화 계층과의 간섭 예고**
   OpenStack KVM/QEMU 기반 가상 머신 위에 제어 평면을 구성할 때는 하이퍼바이저의 메모리 벌루닝(`Memory Ballooning`)이나 NUMA 노드 경합이 Go 스케줄러(`netpoll`)와 GC 삼색 마킹에 부과하는 이중 가상화 세금을 차단해야 합니다
   관리형 클라우드 인프라별 제어 평면 은닉 매커니즘과 온프레미스 마스터 노드의 NUMA·HugePages 최적화 실전 가이드는 6부에서 분리된 별도 시리즈(쿠버네티스 클라우드·인프라 실전 해설 시리즈)에서 심도 있게 다룹니다

하지만 이 압도적인 고루틴의 가벼움과 특권적 배치조차 쿠버네티스 아키텍트들이 준비한 6부 우회 전략의 절반에 불과합니다

---

## 튜닝 없이 버티는 세 가지 아키텍처 우회로

컨트롤 플레인이 커널 처형선 밖에 있고 고루틴이 가볍다고 해서, 수천 개 노드에서 초초단위로 폭주하는 상태 갱신을 튜닝 손잡이 하나 없이 무작정 버텨낼 수는 없습니다
쿠버네티스는 Go 런타임의 내부 파라미터를 비틀어 조율하지 않는 대신, **시스템 고질적 한계가 뇌관을 터뜨리는 세 개 병목 지점을 정교한 아키텍처 구조로 비켜 갔습니다**

![쿠버네티스의 세 가지 아키텍처 우회로](/diagrams/k8s-control-plane-self-exemption-4.svg)

앞으로 6부의 남은 네 편에서는 이 세 가지 아키텍처 우회로가 소스코드와 힙 메모리 상에서 어떻게 동작하며, 왜 그 우회의 대가가 최종 엔지니어의 부채와 청구서로 전가되었는지 실측 데이터로 규명합니다

### 1. 파드 하나에 고루틴 하나 (`24편: Goroutine per Pod`)

`kubelet`은 노드 내부에 배포된 개별 파드마다 상태를 독립적으로 감시하고 동기화하는 상태 관리 고루틴(`managePodLoop`)을 1:1로 통째로 할당합니다
일반적인 C++나 Java의 OS 스레드 풀 모델이었다면 수백 개 파드의 헬스체크와 프로빙을 단일 워커 풀의 비동기 이벤트 루프 큐에 구겨 넣어야 했겠지만, 고루틴 1개의 실효 풋프린트가 15.8 KB에 불과하고 커널 VMA 오버헤드가 0이므로 가능한 **동시성 물량전 전략**입니다

이 1:1 물량전은 특정 파드의 블로킹이 타 파드에 영향을 주는 스레드 기아(`Starvation`)를 완벽히 차단하지만, 다른 물리적 짐을 부릅니다
[24편](/essays/kubelet-goroutine-per-pod)에서는 파드 1개당 프로브 매니저(`proberManager`)가 동반 생성하는 4~4.5개 고루틴 증가의 소스 근거와, 고빈도 PLEG(`Generic PLEG`) 1초 폴링이 일으키는 CPU 런큐 락 경합을 파헤칩니다
나아가 이를 완화하기 위해 v1.36.1에 적용된 Evented PLEG 비동기 CRI 푸시 구조와 300초 안전망(`relist`) 루프가 남기는 실측 지표를 해부합니다

### 2. N명에게 보내면서 한 번만 직렬화하는 법 (`25편: Watch Fan-out`)

쿠버네티스 컨트롤 플레인 메모리를 붕괴시키는 최대 병목은 `kube-apiserver`의 Watch 이벤트 팬아웃입니다
클러스터 내 노드 상태 변화나 파드 이벤트 단 1건이 발생했을 때, 이를 대기 중인 수십 개의 컨트롤러와 수천 개의 `kubelet` 연결로 JSON이나 Protobuf 직렬화를 거쳐 전송해야 합니다
만약 N명의 워처마다 개별 직렬화를 반복(`O(N)`)하면, 초당 수십만 개의 1회용 객체가 힙에 쌓여 GC STW가 폭증하고 CPU 캐시가 타버립니다

[25편](/essays/k8s-sync-pool-serialization)에서는 이 힙 할당 폭발을 막기 위해 쿠버네티스 코어 팀이 설계한 `sync.Pool`과 **Victim Cache의 2단계 수명 회수 매커니즘**, 그리고 객체를 `sync.Once`로 단 한 번만 인코딩해 N명에게 공유 바이트 슬라이스(`raw []byte`) 포인터로 0-copy 스트리밍하는 `cachingObject` 규약을 추적합니다
또한 로컬 벤치마크 실측을 통해 Protobuf가 JSON 리플렉션 탐색(`reflect.Value.FieldByName`) 대비 **할당 횟수 40 대 312, 실행 속도 6.9배 압도**하는 물리적 인과율과 최근 도입 중인 CBOR(`application/cbor`) 이진 포맷 동향을 연결합니다

### 3. 요청을 없애는 캐시와 사람에게 넘긴 청구서 (`26편: Informer Pointer Cost`)

Informer와 `SharedInformerFactory`는 외부 클라이언트 컨트롤러들이 `kube-apiserver`를 반복 폴링하지 않도록 로컬 인메모리 스토어(`Indexer`)를 동기화합니다
여기서 극단적인 조회 성능을 얻기 위해 쿠버네티스 아키텍트들은 매우 위험한 선택을 내립니다
인덱서에서 객체를 꺼낼 때 깊은 복사(`DeepCopy()`)를 거치지 않고 **중앙 맵의 메모리 포인터 힙 주소(`0xa7e...`) 원본을 그대로 핸들러 콜백으로 반환**하는 것입니다

이 0-Copy 공유 구조는 `kube-apiserver` 조회 부하와 컨트롤러 힙 할당을 0으로 억제합니다
하지만 그 대가로 **"캐시에서 반환받은 객체 포인터는 절대 현장에서 수정(`In-place Mutate`)하면 안 되며, 수정이 필요하면 엔지니어가 직접 `DeepCopy()`를 호출해야 한다"** 는 철칙을 만들었습니다
만약 실수로 포인터 원본을 수정하면 클러스터 내 다른 컨트롤러들이 더럽혀진 데이터를 진실로 오인하는 치명적 상태 오염 버그가 터집니다
나아가 Slow Consumer 발생 시 소비 정체를 극복하기 위해 `processorListener`가 무한 팽창시키는 `RingGrowing` 링 버퍼(`+160 MiB`)가 일으키는 OOMKill 위협을 실측 증명합니다

![비용 보존 법칙과 사람에게 넘어간 청구서](/diagrams/k8s-control-plane-self-exemption-5.svg)

[12편](/essays/allocation-convergence-why-gc)과 [17편](/essays/gc-cost-conservation-no-silver-bullet)에서 우리가 거듭 확인했던 **"비용 보존 법칙"** 은 쿠버네티스 6부에서도 단 한 치의 오차 없이 관철됩니다
쿠버네티스는 Go 런타임의 복잡한 튜닝 손잡이를 비틀지 않는 대신, 고도의 아키텍처 우회로와 0-Copy 메모리 공유 파이프라인을 구축했습니다
그리고 그 시스템이 붕괴하지 않도록 지탱해야 하는 무거운 청구서는, 결국 코드를 작성하고 규칙을 엄수해야 하는 엔지니어의 손길로 전가되었습니다

---

## 더 파고들 질문

1. **정적 파드(`Static Pod`) 명세에 인위적으로 `limits.memory: 2Gi`를 추가하면 어떤 커널 현상이 터지는가**
   - `kubelet`이 `memory.max` 파일에 2GiB 한도를 강제 주입하며, 트래픽 폭주 시 `kube-apiserver`가 `Direct Reclaim` 동기 스톨과 GC Death Spiral에 빠져 P99 레이턴시가 폭등하고 클러스터 락업이 발생하는 과정을 재현할 수 있습니다
2. **`Guaranteed` 파드의 `oom_score_adj`가 `-998`이 아닌 `-997`로 하드코딩된 아키텍처 이유는 무엇인가**
   - `pkg/kubelet/qos/policy.go`에서 `kubelet`(`-999`) 및 `kube-proxy`(`-999`)와의 계급 구분을 명확히 하고, 시스템 데몬이 유저의 `Guaranteed` 파드보다 마지막까지 생존하도록 커널 Badness 점수 체계를 3층 분리한 커널 간섭 방지 설계입니다
3. **`os.Getenv("GOGC")`가 API Server 시작점에 존재하는 것이 런타임에 영향을 주지 않는 물리적 증거는 무엇인가**
   - Go 런타임의 `schedinit()`이 `main()` 함수 진입 전에 OS 환경 변수를 직접 스캔하여 GC 페이서를 셋업(`mgcpacer.go`)하므로, 이후 실행되는 `server.go`의 `os.Getenv`는 단지 `klog.InfoS` 감사 로그 출력용으로만 소비된다는 파이프라인 시점 분석으로 증명됩니다
4. **유휴 고루틴 2,390개의 평균 스택이 2KB(`_StackMin`)가 아닌 7.6KB에 머무는 이유와 GC `shrinkstack` 조건은 무엇인가**
   - 초기 초기화 시 8KB~16KB로 확장(`morestack`)된 후 대기 상태(`_Gwaiting`)에 들어갔으며, GC `markroot` 스캔 시 현재 스택 사용량이 전체 용량의 25% 미만이어야 절반으로 수축(`shrinkstack`)되므로 7.6KB 실효 풋프린트에 수렴합니다
5. **1:1 OS 스레드 2,390개를 띄웠을 때 발생하는 VMA(`vm_area_struct`)와 PTE 단편화 오버헤드는 어떻게 계측하는가**
   - `cat /proc/<pid>/maps | wc -l`로 VMA 개수를 대조하고, `perf stat -e dTLB-load-misses`로 컨텍스트 스위칭 시 발생하는 페이지 테이블 탐색 캐시 미스를 측정하여 Go 고루틴(`0 VMA / 0 PTE`)과 비교할 수 있습니다

---

## 핵심 요약

- 쿠버네티스 제어 평면(`kube-apiserver`, `etcd`, `kube-controller-manager`)은 정적 파드 명세에 메모리 `limits`를 두지 않아 커널 cgroup `memory.max = max` 상태로 처형선에서 완벽히 면제됩니다
- 커널 Badness 점수 산식에서 `kubelet`과 `kube-proxy`는 `-999`, 정적 파드들은 `GetContainerOOMScoreAdjust`를 통해 `-997`을 부여받아 노드 전역 OOM 시에도 유저 파드들이 먼저 도살됩니다
- API Server는 GC 스래싱과 P99 지연 시간 스파이크로 인한 세션 락업을 막기 위해 런타임 손잡이(`GOMEMLIMIT`, `automaxprocs`, `debug.SetGCPercent`)를 바이너리 내부에 전혀 내장하지 않았습니다
- 유휴 상태의 컨트롤 플레인에 상주하는 2,390개의 고루틴은 동적 연속 스택(`morestack`)과 GC 연동 수축(`shrinkstack`) 매커니즘을 통해 단 17.4 MiB와 0 VMA 커널 오버헤드로 유지됩니다
- 쿠버네티스는 Go 런타임을 튜닝하는 대신 고도의 아키텍처 우회로를 팠으며, 그 혜택을 누리지 못하는 커스텀 오퍼레이터와 확장 데몬 개발자에게 메모리 엄수 청구서를 전가했습니다

---

다음 편([24편](/essays/kubelet-goroutine-per-pod))에서는 노드 최전선에서 워크로드를 지키는 `kubelet`이 고루틴의 가벼움을 무기로 어떻게 파드 1:1 동시성 물량전을 펴는지 바닥부터 확인합니다
