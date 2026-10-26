---
title: "페이지 캐시·회수·OOM — working set이 limit 아래여도 느려지고 종료되는 이유"
excerpt: "페이지 종류와 회수 비용에서 시작해 memcg의 보호·한도·계층을 살펴봅니다. working set과 hugepage 보정, OOM 후보 선택·사건 카운터·PSI가 각각 어디까지 설명하는지도 구분합니다"
category: "kubernetes"
tags: ["Kubernetes", "Linux", "Memory", "cgroup", "OOM", "PSI", "concept"]
series:
  name: "k8s-theory-kernel"
  order: 4
date: "2026-11-15"
---

working set은 사용량을 가공한 관측값입니다
회수할 수 없는 메모리의 양이나 할당 성공을 직접 보장하는 값은 아닙니다

그래프가 limit 아래에 있어도 회수와 재읽기로 작업이 기다리거나, 다른 범위의 한도와 OOM 때문에 프로세스가 종료될 수 있습니다
사용량에 이어 무엇을 회수할 수 있는지, 어느 작업이 기다렸는지, 누가 종료를 결정했는지를 나눠 봐야 합니다

> **근거**: Linux v6.18.58 `2926d88bb7fc4608fd942453d929c39e4e5ec006`의 공식 문서·소스를 대조했습니다
> Kubernetes는 v1.37.1 `f78e722310e50bcaca9276be22276d9e91d91308`입니다
> 공식 문서 저장본은 `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`입니다
> 실제 노드에서 메모리를 고갈시키거나 파일·지연·OOM을 관측한 실측 기록은 포함하지 않습니다

## working set과 available은 회계 모델입니다

`inactive_file`은 파일 기반 메모리 중 커널의 회수용 inactive file 목록(LRU)에 속한 양입니다

확인한 cAdvisor/lib v0.60.5의 cgroup v2 계산은 다음과 같습니다
`inactive_file` 항목이 있을 때 사용량에서 빼며 결과가 음수가 되지 않게 합니다

```text
working set = max(usage - inactive_file, 0)
```

![usage에서 inactive_file을 계산상 제외해 working set을 표시하지만 제외한 캐시는 여전히 메모리를 사용 중이라는 회계 관계|tall](/diagrams/k8s-theory-page-cache-reclaim-oom-3.svg)

여기서 제외된 캐시도 회수와 재접근에 비용이 듭니다
working set이 limit 아래라는 사실만으로 할당이 즉시 성공하거나 OOM이 없을 것이라고 보장할 수는 없습니다

kubelet이 사용하는 Linux `memory.available`도 working set 기반 신호와 연결됩니다
확인한 통계 경로는 한도가 알려졌을 때 limit에서 working set을 뺀 available을 만들고 이를 Summary로 전달합니다
일반 시스템 도구의 available 추정과 같은 식이라고 가정하면 안 됩니다

## 캐시를 회수할 수 있어도 비용은 남습니다

**page cache**는 파일 데이터를 메모리에 보관해 다음 읽기의 저장소 접근을 줄이는 공간입니다
메모리를 관리하는 기본 단위인 page에 무엇이 들어 있는지에 따라 회수 조건도 달라집니다

| 메모리 종류 | 회수할 때 필요한 조건과 비용 |
|---|---|
| 저장소와 내용이 같은 file-backed page | 버리고 파일에서 다시 읽을 수 있는 후보지만 이후 접근에 재읽기 비용 발생 |
| 수정한 dirty page·writeback 중인 page | 수정 내용을 보존해야 하므로 저장소 반영·진행 중인 I/O 등의 조건 확인 |
| heap·stack 등의 anonymous page | 원본 파일에서 복원할 수 없으므로 swap 사용 가능 여부 등 확인 |
| 커널 사용 메모리 | 회수 가능한 메타데이터 캐시와 사용자가 해제해야 하는 영역 등이 혼재 |

**dirty**는 메모리에서 수정했지만 저장소에는 아직 반영하지 않은 상태입니다
**writeback**은 그 변경을 저장소에 반영하는 처리입니다
모든 dirty page를 해당 할당 작업이 직접 써서 즉시 회수하는 것은 아닙니다
확인한 회수 소스도 writeback 상태·파일시스템 진입 가능 여부·회수 주체에 따라 대기하거나 후보를 남깁니다

깨끗한 캐시를 회수하는 데 성공해도 다음 요청이 같은 데이터를 찾으면 다시 읽어야 합니다
그 과정에서 I/O와 page fault, 즉 접근에 필요한 메모리 상태를 커널이 처리하는 비용이 생길 수 있습니다

따라서 limit을 낮춘 뒤 프로세스가 계속 실행된다고 성능 영향까지 없었다고 판단할 수는 없습니다
OOM 기록이 없다는 사실만으로 다른 종료나 대기도 배제할 수 없습니다

## 커널의 회수와 kubelet의 축출은 별도 경로입니다

**reclaim**은 기존 메모리를 회수해 다른 용도로 다시 쓰는 처리입니다
`kswapd`의 background reclaim은 노드의 여유 페이지가 줄었을 때 비동기로 회수합니다
할당 작업이 직접 회수하는 **direct reclaim**에서는 그 작업이 회수를 기다립니다

![커널의 할당·회수·실패 경로와 kubelet의 별도 관측·축출 정책을 구분한 그림|tall](/diagrams/k8s-theory-page-cache-reclaim-oom-1.svg)

연속된 물리 메모리가 필요한 할당은 총 여유량만으로 설명되지 않습니다
빈 공간이 흩어진 fragmentation이 있으면 페이지를 옮겨 공간을 모으는 **compaction**도 비용에 관여합니다
할당 종류와 허용 재시도에 따라 회수·실패 경로가 달라집니다

또한 **memcg**는 cgroup 단위의 메모리 제어이며 노드 전체의 여유와 별도로 한도가 적용될 수 있습니다
**charge**는 메모리 사용량을 cgroup의 회계에 반영하는 처리입니다
노드에 여유가 있어도 자기 cgroup이나 조상의 한도 때문에 charge가 막힐 수 있습니다

kubelet은 별도의 관측 주기와 정책으로 Pod 축출을 판단합니다
`kswapd`·direct reclaim·kubelet 축출·OOM이 반드시 이 순서로 진행되는 것은 아닙니다

## 메모리를 사용하는 주체와 charge된 cgroup은 다를 수 있습니다

공유 페이지를 여러 cgroup의 프로세스가 읽어도 비용을 소비자 수대로 균등 분할하지는 않습니다
프로세스를 다른 cgroup으로 옮긴다고 기존에 만든 메모리의 charge까지 함께 옮기지도 않습니다

어느 프로세스가 읽었는지와 어느 cgroup의 한도를 소비했는지는 다른 질문입니다
프로세스의 상주 메모리를 나타내는 RSS, 애플리케이션 heap, cgroup 사용량도 같은 범위가 아닙니다

`memory.current`는 해당 cgroup과 자손의 사용량을 포함합니다
부모 값에 자식 값을 다시 더하면 같은 charge를 중복 계산합니다

`memory.stat`의 `file`에는 tmpfs·shared memory도 들어갑니다
`shmem`·`file_mapped` 같은 세부 항목은 서로 독립된 바구니가 아니므로 모두 합쳐 총량을 만들 수 없습니다

### 보호할 양과 막을 양을 구분합니다

| 제어 값 | 의미와 조건 |
|---|---|
| `memory.min` | 실효 보호량 안을 강하게 회수로부터 보호하며 부모 보호량과 과다 예약의 영향을 받음 |
| `memory.low` | 비보호 메모리를 먼저 회수하는 최선 노력 보호이며 심한 압박에서는 보호 영역도 회수 가능 |
| `memory.high` | 초과 시 회수·throttling을 유도하며 high 초과 자체가 OOM killer를 호출하지는 않음 |
| `memory.max` | charge 수용의 강한 한도이며 회수해도 수용할 수 없을 때 memcg OOM으로 이어질 수 있음 |

high에서 느려진 작업은 아직 종료되지 않았어도 메모리 정책의 영향을 받고 있습니다
반대로 max 경계에 닿았다고 반드시 프로세스를 종료한 것은 아닙니다
일시적으로 한도를 넘기거나 OOM killer 없이 할당 실패·재시도로 처리하는 경로도 있습니다

![자식 cgroup이 각자의 max 아래에 있어도 부모 한도에서 하위 계층의 회수·OOM이 가능하며 current 합산은 중복되는 구조|tall](/diagrams/k8s-theory-page-cache-reclaim-oom-2.svg)

자식이 자기 max 아래에 있어도 자손의 사용량을 합한 부모가 자기 max에 닿을 수 있습니다
그 부모의 하위 계층이 회수와 OOM 후보의 범위가 될 수 있으므로 컨테이너 자신의 그래프만으로 원인을 확정할 수 없습니다

보호도 조상 설정과 함께 적용됩니다
min을 과도하게 예약하면 보호되지 않은 회수 가능 메모리가 줄어 OOM 위험이 생길 수 있습니다
배치용 request 회계에 여유가 있다는 사실과 실제 회수 보호에 여유가 있다는 사실은 별도로 확인해야 합니다

## PSI는 사용량 대신 진행하지 못한 시간을 봅니다

**Pressure Stall Information(PSI)**은 자원 부족으로 작업이 진행하지 못한 시간을 나타냅니다
`some`은 일부 작업이 막힌 시간이고 `full`은 해당 범위의 모든 non-idle 작업이 동시에 막힌 시간입니다
노드 전체와 cgroup은 대상 작업 집합이 다르며 system-level CPU full은 정의되지 않아 0으로 제공되는 예외가 있습니다

`avg10`·`avg60`·`avg300`은 각각의 시간 창에 대한 정지 비율이며 단위는 %입니다
`total`은 누적 마이크로초입니다
**가정 예시**로 같은 객체의 total이 10초 동안 200000 증가했다면 0.2초를 10초로 나눈 정지 비율은 2%입니다

이는 요청의 2%가 느렸다거나 p99가 200ms였다는 뜻이 아닙니다
다른 자원·범위의 PSI를 더하면 겹친 정지 시간을 중복 계산할 수도 있습니다

`KubeletPSI`는 v1.36부터 GA·기본 활성·잠김 상태입니다
확인한 cAdvisor 변환은 some·full의 total과 평균을 Summary로 옮깁니다
다른 CRI 통계 경로나 collector도 같은 필드를 보존하는지는 배포 버전별 확인이 필요합니다

PSI를 수집한다는 사실이 eviction 임계값으로 사용한다는 뜻도 아닙니다
확인한 kubelet eviction 신호 목록에는 PSI 임계값이 없습니다
요청 지연과 PSI가 같은 시각에 늘었다면 요청 자체의 관측 자료도 함께 봐야 합니다
각 기록이 어느 실행 인스턴스에서 나왔는지 연결해야 원인 후보를 좁힐 수 있습니다

## OOM의 범위와 희생 프로세스를 나눠 봅니다

memcg OOM은 한도를 수용하지 못한 cgroup의 회수·charge 경로에서 발생합니다
확인한 `try_charge_memcg`는 한도를 넘긴 cgroup을 찾고 그 범위에서 회수·재시도·OOM 처리를 진행합니다
전역 OOM은 별도의 페이지 할당 실패 경로이며 노드 전체의 free 값뿐 아니라 허용된 NUMA 노드·cpuset·할당 조건도 영향을 줍니다

일반적인 OOM 후보 점수에는 RSS·swap·페이지 테이블 사용량과 `oom_score_adj` 보정이 들어갑니다
memcg OOM이면 해당 범위의 작업을 조사하고, 전역 경로도 후보의 자격과 설정을 따릅니다
가장 메모리를 많이 쓴 프로세스나 보정값이 가장 큰 프로세스를 항상 먼저 종료하는 단순 순서는 아닙니다

`oom_score_adj=-1000`은 OOM 대상 선정에서 보호되는 값입니다
그 밖의 보정값도 QoS의 종료 순서를 보장하는 표로 읽으면 안 됩니다
자세한 Kubernetes 보정 계산은 [QoS와 cgroup](/essays/k8s-theory-qos-cgroups)에서 다룹니다

`memory.oom.group=1`은 해당 cgroup과 자손을 OOM 처리의 한 작업 단위로 다룹니다
보호된 `oom_score_adj=-1000` 작업은 예외이며, memcg OOM의 범위 밖까지 조상 group 설정만으로 함께 종료하지는 않습니다

kubelet은 cgroup v2이고 `singleProcessOOMKill`이 false인 경로에서 컨테이너의 group 값을 1로 요청합니다
이 설정이 같은 Pod의 형제 컨테이너까지 항상 종료한다는 뜻은 아닙니다

### events의 증가와 컨테이너 종료 이유를 연결합니다

`memory.events`는 기본적으로 자손의 사건을 포함하고 `memory.events.local`은 해당 cgroup의 로컬 사건을 구분합니다
`memory_localevents` legacy mount 옵션이 있으면 events의 집계가 로컬로 바뀔 수 있으므로 범위를 먼저 확인해야 합니다

| 사건 카운터 | 설명하는 것 | 그 값만으로 확정할 수 없는 것 |
|---|---|---|
| `high` | high 경계로 회수·throttling에 들어간 사건 | 프로세스 종료 |
| `max` | max 경계에서 charge 수용이 어려웠던 사건 | 반드시 OOM kill 발생 |
| `oom` | 한도에서 할당 실패에 접근한 OOM 경로 | 종료된 victim 수 |
| `oom_kill` | 해당 cgroup 소속 프로세스가 OOM killer로 종료된 수 | 그 컨테이너 자신의 memcg 한도 초과 |

`oom_kill`은 OOM killer의 종류를 구분하지 않고 종료된 프로세스 수를 합산하므로, 전역 OOM으로 종료된 경우도 따로 확인해야 합니다
누적값은 cgroup 재생성과 관측 누락을 구분한 구간 증가량으로 읽습니다

CRI는 cgroup OOM killer로 종료된 컨테이너에 런타임이 `OOMKilled` 이유를 기록하도록 요구합니다
kubelet의 종료 상태 변환은 런타임의 reason·exit code를 읽습니다
이 상태만으로 어떤 조상 한도가 원인이었는지까지 알아낼 수는 없습니다
종료 코드 137도 다른 SIGKILL에서 나올 수 있으므로 단독으로 OOM을 확정하지 못합니다

커널 OOM이 Pod 오브젝트를 직접 삭제하는 것은 아닙니다
kubelet의 node-pressure eviction은 별도의 관측·정책에 따른 종료이고, API eviction의 PDB 판정 경로와도 다릅니다
자원 부족에 의한 node-pressure eviction은 involuntary disruption이며 PDB를 존중하지 않습니다
공식 문서는 hard threshold의 유예를 0초로 설명하지만, 소스의 override와 실제 종료 시간은 별개입니다
soft의 발동 전 대기와 Pod 선택 후 종료 유예도 구분해야 합니다

세부 시간·상태·정책은 [Eviction과 OOM](/essays/k8s-theory-eviction-oom)에서 비교합니다
원인을 판단할 때는 컨테이너 종료 정보·커널 기록·cgroup 사건·kubelet 축출 기록을 같은 시각과 실행 인스턴스에 연결해야 합니다

## LRU는 다음 접근을 아는 대신 추정합니다

커널은 접근 정보를 이용해 어떤 페이지를 덜 필요로 할지 추정합니다
LRU 계열은 최근 사용 여부를 이 판단에 사용하며, **Multi-Gen LRU(MGLRU)**는 접근 시기가 비슷한 페이지를 generation으로 묶습니다

MGLRU는 접근 정보를 갱신하는 aging과 후보 페이지의 회수를 담당하는 eviction을 나눕니다
회수한 페이지에 다시 접근한 **refault** 정보도 판단에 반영합니다
최근 덜 접근한 것으로 분류됐다고 사용자 요청에 영향 없이 버릴 수 있다는 뜻은 아닙니다

현재 소스에는 기존 회수 경로와 MGLRU 조건 분기가 함께 있습니다
`CONFIG_LRU_GEN`·`CONFIG_LRU_GEN_ENABLED`는 빌드 지원과 기본 활성 여부를 정합니다
현재 활성 여부는 `/sys/kernel/mm/lru_gen/enabled`도 확인해야 합니다
커널 버전만으로 배포판의 설정까지 확정할 수는 없습니다

`inactive_file`도 허용할 수 있는 요청 지연을 표시한 값이 아닙니다
파일 상태·동시 접근·writeback·새 할당의 제약에 따라 실제 회수 비용이 달라집니다

### 조사한 양과 회수한 양, 다시 읽은 양을 나눕니다

| `memory.stat` 필드 | 설명하는 대상 |
|---|---|
| `pgscan` | 회수 후보로 조사한 page 수 |
| `pgsteal` | 회수한 page 수 |
| `workingset_refault_file` | 회수했던 file page에 다시 접근한 횟수 |

scan이 많은데 회수가 적다면 조사에 비해 공간을 충분히 얻지 못했다는 가설을 세울 수 있습니다
회수 뒤 refault가 늘었다면 공간을 확보하는 대신 치른 재읽기 비용을 확인할 근거가 됩니다
어느 경우도 그 카운터 하나가 특정 요청의 지연을 직접 측정하지는 않습니다

누적값이므로 같은 실행 인스턴스와 관측 구간의 증가량을 비교해야 합니다
cgroup 재생성·관측 누락·부하 변화가 섞이면 서로 다른 이력을 비교하게 됩니다

## MemoryQoS는 gate 외에 정책과 자원 조건을 봅니다

Kubernetes v1.37.1의 `MemoryQoS`는 beta·기본 활성이고 Linux cgroup v2를 전제로 합니다
하지만 기본 `memoryReservationPolicy`는 `None`, `memoryThrottlingFactor`는 nil입니다
gate만으로 유효한 min·low 보호와 high 제한이 생기지는 않습니다

`memoryReservationPolicy: TieredReservation`을 선택하고 0이 아닌 memory request 등의 조건이 맞으면 보호를 계산합니다
Guaranteed에는 min, Burstable에는 low를 사용하는 경로입니다
기본 정책에서도 min·low를 0으로 초기화할 수 있으므로 `None`을 파일 미작성과 동일시하면 안 됩니다

high에는 별도 factor가 필요합니다
단순한 컨테이너에서 request를 R, limit을 L, factor를 f로 놓으면 정렬 전 후보는 다음과 같습니다

```text
memory.high 후보 = R + f × (L - R)
```

**가정 예시**로 R=512Mi·L=1Gi·f=0.9라면 후보는 972.8Mi입니다
실제 계산은 page 크기 단위로 내림하고, 결과가 0이 아니며 request보다 큰 경우에 설정합니다
limit이 없으면 node allocatable을 사용하는 경로도 있습니다

request=limit인 경우와 Pod-level·DRA 자원 분기는 이 단순 예와 구분해야 합니다
Pod-level memory limit이 있고 컨테이너 limit을 생략한 경우에는 컨테이너 high를 생략하고 Pod cgroup의 high로 제어하는 분기가 있습니다

Pod cgroup 설정은 kubelet의 cgroup 관리 경로를 따르고 컨테이너 설정은 CRI로 런타임에 전달합니다
계산한 값, 전달한 값, 노드에서 실제 효력이 있는 값은 서로 다른 확인 지점입니다
보호는 charge된 page cache에도 영향을 줄 수 있으므로 다른 작업의 회수 여유와 함께 판단해야 합니다

## hugetlb 예약 pool과 THP를 구분합니다

**hugetlb**는 큰 페이지를 별도 pool로 확보해 명시적으로 사용하는 기제입니다
그 pool 안의 미사용 공간도 일반 할당이나 page cache가 곧바로 쓸 수 있는 여유는 아닙니다
pool 총량과, pool 안에서 향후 할당을 약속한 수인 `HugePages_Rsvd`도 다른 값입니다

**Transparent Huge Pages(THP)**는 커널이 큰 페이지 매핑의 생성·분할을 관리하는 다른 경로입니다
hugetlb와 같은 별도 예약 pool을 요구하지 않으므로 THP 사용량을 같은 예약량으로 읽으면 안 됩니다

v1.37.1의 `HugepageAwareEviction`은 beta·기본 활성입니다
`adjustForHugePages`는 Node capacity의 모든 hugepage 크기별 용량을 합해 node `AvailableBytes`에서 빼고 0 아래를 막습니다
working set 자체나 모든 컨테이너 지표의 공통식을 바꾸는 처리가 아닙니다

**계산 예시**로 보정 전 available이 6Gi이고 이 예약 용량이 4Gi라면 보정 결과는 2Gi입니다
애플리케이션이 사용하는 THP 용량을 빼는 계산으로 바꿔 읽어서는 안 됩니다

Linux의 `memory_hugetlb_accounting` mount 옵션은 실제 사용한 hugetlb를 memcg에 charge하는 별도 선택입니다
미사용 pool 전체를 charge하지는 않습니다
예약 용량을 빼는 Summary 구현과 이 회계 옵션이 실제 노드의 통계 경로에서 어떻게 조합되는지도 확인해야 합니다

swap으로 빠진 페이지도 물리 메모리의 resident working set과 같은 바구니에 있지 않습니다
다시 접근할 때 swap-in이 필요하면 상주량이 줄었어도 지연은 늘 수 있습니다
`memory.swap.max`도 `memory.max`와 별도 제약이므로 working set 하락만으로 여유와 성능의 개선을 함께 결론 낼 수는 없습니다

## 사용량·대기·종료를 같은 범위에서 연결합니다

회수 성공과 목표 지연 안의 응답 성공은 다른 결과입니다
메모리 정책을 조정할 때는 charge의 범위·보호량·회수와 재접근 비용을 서비스의 지연 목표와 함께 평가해야 합니다
사용량 그래프나 종료 여부 하나만으로 그 판단을 대신할 수는 없습니다

## 참고 자료

- [Linux v6.18.58 메모리 개념](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/Documentation/admin-guide/mm/concepts.rst), [MGLRU 설계](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/Documentation/mm/multigen_lru.rst), [MGLRU 활성 조건](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/Documentation/admin-guide/mm/multigen_lru.rst)
- [Linux cgroup v2의 메모리 인터페이스·소유권](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/Documentation/admin-guide/cgroup-v2.rst), [PSI](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/Documentation/accounting/psi.rst), [HugeTLB](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/Documentation/admin-guide/mm/hugetlbpage.rst), [THP](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/Documentation/admin-guide/mm/transhuge.rst)
- [Linux의 페이지 회수 구현](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/mm/vmscan.c), [할당 실패와 전역 OOM](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/mm/page_alloc.c), [memcg charge·high·OOM 범위](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/mm/memcontrol.c), [OOM 후보·점수·group 처리](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/mm/oom_kill.c)
- [Kubernetes 컨테이너 메모리 설정](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_container_linux.go), [Pod-level 보호·high](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/cm/helpers_linux.go), [gate 이력](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go)
- [cAdvisor working set 계산](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/vendor/github.com/google/cadvisor/lib/container/libcontainer/handler.go), [Summary 통계·PSI 변환](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/stats/helper.go), [hugepage available 보정](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/server/stats/summary.go), [런타임 종료 상태 변환](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_container.go)
- [Kubernetes node-pressure eviction 문서 저장본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/scheduling-eviction/node-pressure-eviction.md), [중단 분류·PDB의 경계](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/workloads/pods/disruptions.md)
