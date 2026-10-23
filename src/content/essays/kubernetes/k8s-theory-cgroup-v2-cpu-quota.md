---
title: "cgroup v2 CPU quota — 평균 사용률이 낮아도 실행이 멈추는 이유"
excerpt: "cpu.max의 기간·예산에서 CPU별 runtime과 throttling으로 이어지는 경로를 살펴봅니다. weight·계층 제한·burst·cpu.stat의 집계 범위, kubelet의 설정 전달과 cAdvisor 지표의 단위도 구분합니다"
category: "kubernetes"
tags: ["Kubernetes", "Linux", "cgroup", "CPU", "Throttling", "concept"]
series:
  name: "k8s-theory-kernel"
  order: 1
date: "2026-11-09"
---

CPU limit에 닿은 프로세스는 그 이유만으로 종료되지 않습니다
cgroup에 허용된 실행 시간을 다 쓰면 추가 실행을 제한하고, 예산이 다시 공급되면 이어서 실행합니다

CPU 사용률의 긴 평균이 낮아도 짧은 기간의 예산은 먼저 소진할 수 있습니다
`container_cpu_cfs_throttled_seconds_total`을 읽으려면 CPU의 여유뿐 아니라 그 기간과 예산, 부모 cgroup의 제한도 확인해야 합니다

> **근거**: 2026-10-24 kernel.org에서 현재 mainline은 7.3, 최신 longterm은 6.18.58로 확인했습니다
> 이 글의 커널 기준은 Linux v6.18.58 `2926d88bb7fc4608fd942453d929c39e4e5ec006`입니다
> Kubernetes는 v1.37.1 `f78e722310e50bcaca9276be22276d9e91d91308`을 대조했습니다
> 실제 노드의 파일·throttling·요청 지연을 측정한 기록은 포함하지 않습니다

## kubelet의 계산과 컨테이너 파일 기록을 구분합니다

[QoS와 cgroup](/essays/k8s-theory-qos-cgroups)에서 kubelet의 자원 변환을 살펴봤습니다
CPU request는 배분 가중치로, CPU limit은 quota와 period로 바꿉니다
여기서 **quota**는 기간당 허용할 합산 CPU 시간이고, **period**는 그 예산을 보충하는 기간입니다

컨테이너 경로에서 kubelet은 CRI의 `LinuxContainerResources`에 `cpu_quota`·`cpu_period`·`cpu_shares` 등을 담아 전달합니다
CRI는 kubelet과 컨테이너 런타임 사이의 인터페이스입니다
실제 컨테이너 cgroup 파일의 기록은 런타임과 그 하위 구현·cgroup 드라이버를 따라갑니다

Pod cgroup은 kubelet의 cgroup 관리 경로에서 설정합니다
이 경로와 CRI 런타임의 컨테이너 변환이 같은 라이브러리 버전·계산식을 사용한다고 가정하면 안 됩니다
초기 생성뿐 아니라 자원 갱신에서도 파일 값이 바뀔 수 있습니다

| cgroup v2 파일 | 커널이 적용하는 대상 |
|---|---|
| `cpu.max` | 기간당 합산 CPU 시간 상한 |
| `cpu.weight` | 경합 시 상대적인 CPU 배분 몫 |
| `memory.max` | 메모리 사용량 상한과 회수·OOM 경계 |
| `cpu.stat` | CPU 사용 시간과 대역폭 제한 통계 |

커널은 이 파일을 Kubernetes의 request·limit이라는 이름으로 해석하지 않습니다
전달된 제어 값을 해당 계층과 작업의 스케줄링 정책에 적용합니다

### CFS라는 이름과 현재 fair-class 스케줄러는 구분합니다

공식 문서와 지표에는 **CFS Bandwidth Control**이라는 이름이 남아 있습니다
이는 그룹의 CPU 시간 대역폭을 제한하는 기능의 이름입니다
현재 fair-class의 다음 작업 선택까지 예전 CFS 알고리즘 그대로라는 뜻은 아닙니다

확인한 Linux 문서는 EEVDF로의 전환을 설명합니다
이 글은 작업 선택 알고리즘 대신 fair-class의 대역폭 제한을 다룹니다

`cpu.max`·`cpu.max.burst`와 대역폭 통계는 fair-class 작업을 대상으로 합니다
`cpu.weight`는 fair-class와, 해당 callback을 제공하는 BPF scheduler에서 구현한 범위에 적용됩니다
이를 `SCHED_FIFO`·`SCHED_RR`·`SCHED_DEADLINE` 등 모든 작업의 같은 제한으로 확대할 수는 없습니다

커널의 `CONFIG_CFS_BANDWIDTH`는 `CONFIG_FAIR_GROUP_SCHED`에 의존합니다
cgroup 계층의 CPU controller 활성화·위임과 실제 커널 설정도 파일의 사용 가능 범위에 영향을 줍니다

## cpu.max는 기간과 CPU 시간을 함께 지정합니다

`cpu.max`는 `$MAX $PERIOD` 두 값을 마이크로초 단위로 적습니다
기본값은 `max 100000`이며 `max`는 이 그룹 자체의 quota 상한이 없다는 뜻입니다

다음은 파일 형식을 설명하는 값이며 실제 노드에서 읽은 출력은 아닙니다

```text
50000 100000
```

100ms마다 합산 CPU 시간 50ms를 허용하는 값입니다
매 순간 CPU의 절반 속도로만 실행한다거나 특정 CPU의 절반을 전용으로 확보한다는 뜻은 아닙니다
여러 CPU에서 동시에 실행하면 같은 예산을 더 짧은 벽시계 시간 안에 사용할 수 있습니다

kubelet의 `MilliCPUToQuota`는 다음 정수 계산을 사용합니다

```text
quota = (milliCPU × period) / 1000
양수 CPU limit의 최소 quota = 1000µs
기본 period = 100000µs
```

기본 period의 `limits.cpu: 500m`은 위의 `50000 100000`에 대응합니다
아주 작은 양수 limit에는 최소 1ms 보정이 있으므로 단순 비례식만 적용하면 안 됩니다
입력 0은 하한 보정 전에 0을 반환합니다

### limit 생략과 파일 미작성은 다릅니다

기본 kubelet 설정은 `cpuCFSQuota: true`, `cpuCFSQuotaPeriod: 100ms`입니다
quota 적용 경로가 켜져 있으면 limit이 없더라도 period를 CRI에 전달할 수 있습니다

확인한 cgroups v0.0.7 라이브러리는 quota 또는 period가 0이 아니면 `cpu.max`를 씁니다
quota가 양수가 아니면 `max`를 쓰고 period가 0이면 100000을 사용합니다
따라서 상한이 없다는 것과 파일을 쓰지 않았다는 것을 같은 상태로 볼 수 없습니다

`cpuCFSQuota: false`이면 이 kubelet 컨테이너 계산 경로에서 quota·period 설정을 생략합니다
그것만으로 런타임의 다른 설정이나 기존·부모 cgroup의 한도까지 제거된다고 판단할 수는 없습니다

v1.37.1의 `CustomCPUCFSQuotaPeriod`는 v1.36부터 GA·기본 활성입니다
현재 게이트 항목에는 `LockToDefault`가 없으며, 설정한 period가 실제 입력에 반영되는지도 봐야 합니다

또 기본 활성인 `PodLevelResources` 경로에서 컨테이너 CPU limit이 없으면 Pod-level limit을 계산에 사용할 수 있습니다
exclusive CPU가 할당된 컨테이너에는 quota를 해제하는 예외가 있습니다
관련 `DisableCPUQuotaWithExclusiveCPUs` 게이트는 v1.37에서 Deprecated·기본 true·잠김 상태입니다

이 조건들은 커널 quota 원리가 아니라 kubelet이 어떤 값을 전달할지 정하는 조건입니다
컨테이너 spec의 limit 한 칸만 보고 실제 파일을 추정하면 빠뜨릴 수 있습니다

## weight는 경합할 때 나누는 몫입니다

일반적인 `cpu.idle=0` 그룹의 `cpu.weight` 범위는 1~10000이고 기본값은 100입니다
CPU를 사용하려는 자식 그룹 사이에서 상대적인 비율로 배분합니다
경합이 사라지면 다른 제한이 없는 범위에서 CPU를 더 사용할 수 있습니다

`cpu.max`는 다른 CPU가 한가해도 적용되는 시간 상한입니다
weight를 높이는 것과 quota를 높이는 것은 서로 다른 제어입니다
idle 그룹인 `cpu.idle=1`에서는 weight가 0으로 보이는 예외도 있습니다

Kubernetes의 request에서 계산한 shares는 v1 단위이며 범위는 2~262144입니다
v2의 weight로 바꾸는 함수도 경로에 따라 구분해야 합니다

| 확인한 경로 | shares에서 weight로의 변환 |
|---|---|
| kubelet의 Pod cgroup `getCPUWeight` | `1 + ((shares - 2) × 9999) / 262142` |
| 벤더된 cgroups v0.0.7의 변환 함수 | `ceil(10 ^ ((l² + 125l)/612 - 7/34))`, `l = log2(shares)` |

두 식은 양 끝값을 맞추지만 중간 값이 같지는 않습니다
코드 계산상 shares 1024는 앞의 식에서 39, 뒤의 식에서 100입니다
뒤 함수의 존재만으로 실제 설치된 CRI 런타임도 이 식을 호출한다고 단정할 수는 없습니다

## 전체 예산은 공유하고 실행 시간은 CPU별로 차감합니다

그룹이 쓸 수 있는 미할당 예산은 전역으로 관리합니다
각 CPU의 실행 큐는 작업을 실행할 때 필요한 runtime을 그 예산에서 가져와 사용합니다
CPU마다 quota 전체를 따로 받는 구조는 아닙니다

![그룹의 전역 quota를 CPU별 실행 큐가 필요할 때 나눠 받고 부모 제한도 함께 적용받는 구조|tall](/diagrams/k8s-theory-cgroup-v2-cpu-quota-1.svg)

이렇게 묶어서 전달하면 실행할 때마다 전역 예산을 두고 잠금을 잡는 부담을 줄일 수 있습니다
전달 목표 단위인 **bandwidth slice**의 기본값은 5ms이며 `/proc/sys/kernel/sched_cfs_bandwidth_slice_us`로 조정합니다
실제 전달량은 남은 전역 예산과 로컬 잔여·부채 등의 조건에도 달려 있습니다

확인한 `assign_cfs_rq_runtime`은 전역 예산에서 로컬 runtime으로 몫을 옮깁니다
`__account_cfs_rq_runtime`은 실행 시간을 차감하고, 추가 공급을 받지 못하면 실행 제한 경로로 이어집니다
기간 보충은 `do_sched_cfs_period_timer`가 담당합니다

### 부모 예산이 먼저 끝나도 실행이 멈춥니다

그룹 자신의 quota를 다 쓴 경우뿐 아니라 부모 quota가 소진된 경우에도 실행이 제한됩니다
자식의 quota가 남았거나 `cpu.max`가 `max`여도 부모 한도는 적용됩니다

컨테이너의 파일만 보는 대신 Pod·QoS 등 실제 상위 계층의 제한을 함께 확인해야 합니다
CPU 배치 제약과 다른 작업과의 경합도 quota와 별개로 남습니다

### 로컬 잔여를 무조건 버리는 것은 아닙니다

CPU별 실행 큐에서 실행할 일이 없어지면 로컬 runtime의 일부를 전역 예산으로 반환할 수 있습니다
확인한 구현은 `min_cfs_rq_runtime`인 1ms를 남기는 반환 경로를 갖습니다
잔여는 기간을 넘어 유효할 수 있어 짧은 구간의 quota 초과 실행도 가능하게 합니다

이 보정은 로컬 몫을 불필요하게 만료시켜 throttling을 늘리는 문제를 줄입니다
CPU마다 남은 몇 ms가 항상 갇혀서 낮은 사용률의 throttling을 만든다는 설명으로 바꿀 수는 없습니다

명시적인 `cpu.max.burst`는 별도 설정입니다
기본값은 0이며 사용하지 않은 대역폭을 누적해 쓰는 상한을 0~`$MAX` 범위로 지정합니다
현재 보충 구현은 전역 runtime에 quota를 더하고 quota+burst로 상한을 둡니다

일반적인 Pod CPU limit 계산이 burst 값까지 자동으로 만들지는 않습니다
다만 cgroups 라이브러리에는 `CpuBurst` 기록 경로가 있고 CRI에는 범용 `unified` map이 있으므로, 전달 수단 자체가 없다고 설명해서도 안 됩니다

## 낮은 평균과 throttling은 함께 나타날 수 있습니다

CPU 사용률의 평균 구간과 quota 집행 기간이 다르기 때문입니다
다음은 한 CPU에서 period 100ms·quota 20ms로 CPU 시간 21ms가 필요한 작업을 실행하는 **가정**입니다
burst·기존 로컬 잔여·부모 제한·다른 경합은 없는 단순 모델입니다

![첫 기간에 20ms 실행 후 80ms 대기하고 둘째 기간에 1ms를 실행하는 단순 모델과 1초 평균 2.1%의 관계|tall](/diagrams/k8s-theory-cgroup-v2-cpu-quota-2.svg)

첫 기간 시작부터 20ms를 실행하면 다음 보충까지 80ms를 기다립니다
둘째 기간에 남은 1ms를 실행하고, 나머지 시간과 뒤의 여덟 기간에는 실행할 일이 없다고 가정합니다
1초에 사용한 CPU 시간은 21ms이므로 한 CPU 기준 평균은 2.1%입니다

평균 2.1%와 첫 기간의 실행 제한은 모순되지 않습니다
여러 CPU에서 병렬로 실행하면 합산 예산을 더 짧은 시간에 소진할 수도 있습니다

같은 period에서 CPU limit을 올리면 그룹 전체의 quota가 늘어납니다
CPU별 slice 크기가 자동으로 커지는 것이 아니라 그 기간에 공급할 전체 실행 시간이 늘어나는 것입니다

그 결과 자기 quota 소진을 완화할 수 있지만 p99나 throttling 비율 개선을 보장하지는 않습니다
부모 제한·경합·CPU 배치·작업량이 남아 있기 때문입니다
설정 변경으로 제한이 풀리는 경로도 있으므로 모든 대기를 반드시 다음 기간까지라고 고정할 수는 없습니다

한 번의 보충 대기는 요청 전체 지연의 상한도 아닙니다
작업이 여러 기간에 걸리면 더 기다릴 수 있고, 그 영향이 긴 평균에는 전혀 없고 p99에만 나타난다고 단정할 수도 없습니다

## cpu.stat에서 사용량과 대역폭 통계를 나눠 읽습니다

`cpu.stat`은 CPU controller의 활성 여부와 무관하게 존재합니다
사용 시간의 기본 필드와 controller가 켜졌을 때 제공하는 fair-class 대역폭 통계를 구분합니다
아래는 이 글에서 사용하는 대표 필드이며 파일의 모든 필드를 나열한 목록은 아닙니다

| 필드 | 의미 |
|---|---|
| `usage_usec`·`user_usec`·`system_usec` | 전체·사용자·커널 모드의 누적 CPU 사용 시간 |
| `nr_periods` | 대역폭 제한을 집행한 기간의 누적 수 |
| `nr_throttled` | throttling이 있었던 기간의 누적 수 |
| `throttled_usec` | 실행 큐의 throttling 시간 누적값 |
| `nr_bursts`·`burst_usec` | burst가 발생한 기간 수와 시간 |

`nr_periods`는 프로그램이 존재한 벽시계 시간을 period로 나눈 값이 아닙니다
기간 타이머가 비활성화되는 경로가 있으며 실행 제한을 집행한 기간을 셉니다

집계 범위도 같지 않습니다
사용 시간은 자손의 증가량이 상위로 전달되지만, 대역폭 다섯 필드는 해당 그룹의 `cfs_bandwidth`에서 출력합니다
부모 제한만으로 자식의 `nr_throttled`가 증가한다고 볼 수 없습니다
컨테이너 카운터가 0이어도 부모의 제한까지 배제할 수는 없습니다

또 `throttled_usec`는 그룹의 CPU별 실행 큐에서 누적한 시간입니다
여러 CPU의 제한 구간이 겹칠 수 있으므로 이를 단일 요청의 대기 시간이나 벽시계 지연과 일대일로 대응시키면 안 됩니다

### 파일에서 cAdvisor 지표로 갈 때 단위가 두 번 바뀝니다

Kubernetes v1.37.1의 go.mod는 cgroups v0.0.7과 cAdvisor/lib v0.60.5를 사용합니다
이 값은 kubelet의 의존성이며 설치된 CRI 런타임의 버전을 뜻하지 않습니다

벤더된 `statCpu`는 `throttled_usec`를 1000배해 나노초의 `ThrottledTime`으로 읽습니다
cAdvisor는 그 값을 전달받아 `time.Second`로 나눠 초 단위 지표로 내보냅니다

| cAdvisor 지표 | 원래 필드 | 읽는 대상 |
|---|---|---|
| `container_cpu_cfs_periods_total` | `nr_periods` | 집행 기간 수 |
| `container_cpu_cfs_throttled_periods_total` | `nr_throttled` | 제한이 있었던 기간 수 |
| `container_cpu_cfs_throttled_seconds_total` | `throttled_usec` | 누적 제한 시간, µs에서 ns를 거쳐 초로 변환 |

확인한 collector는 이 지표들을 Counter로 선언합니다
앞의 두 지표는 **같은 관측 구간의 증가량**으로 비율을 계산해야 합니다
누적값끼리 나누면 기동 이후의 이력을 섞으며, 집행 기간 증가량이 0이면 비율을 해석할 분모도 없습니다

시간 지표도 관측 구간의 증가량으로 읽되 요청 지연과 구분합니다
CPU 사용량 metric 수집이 켜져 있고 spec의 quota가 0이 아닌 조건에서 내보내므로 지표 부재와 값 0도 같은 상태가 아닙니다

## 메모리는 다음 기간을 기다려도 사용량이 줄지 않습니다

`memory.current`는 해당 cgroup과 자손이 현재 사용하는 메모리 양이고 `memory.max`는 바이트 단위 상한입니다
한도에 닿으면 회수를 시도하며 줄일 수 없을 때 그 cgroup에서 OOM killer가 호출될 수 있습니다
일시적인 초과나 OOM killer를 부르지 않고 실패·재시도하는 할당의 예외도 있습니다

CPU 시간은 다음 기간에 새 예산을 받을 수 있지만 이미 점유한 메모리는 시간이 지났다고 자동 반환되지 않습니다
그렇다고 메모리에는 실행을 늦추는 제어가 없다는 뜻도 아닙니다

`memory.high`를 넘으면 작업을 throttle하고 direct reclaim, 즉 할당 경로의 직접 회수를 유도합니다
high 초과 자체가 OOM killer를 호출하지는 않으며 한도가 넘어갈 수도 있습니다
`memory.min`은 강한 보호, `memory.low`는 최선 노력 보호이고 실효 보호 범위는 조상 설정에도 제한됩니다

현재 `MemoryQoS`는 beta·기본 활성입니다
그러나 기본 `memoryThrottlingFactor`는 nil이고 `memoryReservationPolicy`는 `None`입니다
gate만으로 유효한 high 제한과 min·low 보호가 생기지는 않습니다

`memoryReservationPolicy: TieredReservation`을 선택하고 request 등의 조건이 맞으면 메모리 보호를 설정합니다
Guaranteed에는 min, Burstable에는 low를 설정하는 경로입니다
high도 별도 factor와 자원·Pod-level 조건을 따릅니다

`memory.oom.group=1`은 해당 cgroup과 자손을 OOM 처리의 한 작업 단위로 다룹니다
`oom_score_adj=-1000`인 작업은 예외입니다
컨테이너 cgroup에 설정했다고 같은 Pod의 형제 컨테이너까지 함께 종료하는 것은 아닙니다

CPU 제한의 원인을 좁힐 때는 quota·period와 같은 구간의 카운터 증가량을 먼저 맞춥니다
그다음 실제 상위 cgroup 제한과 CPU 경합을 확인해야 자기 limit을 올리는 변경이 어디까지 영향을 줄지 판단할 수 있습니다

## 참고 자료

- [kernel.org 현재 릴리스 목록](https://www.kernel.org/), [릴리스 JSON](https://www.kernel.org/releases.json), [longterm 상태](https://www.kernel.org/releases.html)
- [Linux v6.18.58 cgroup v2 문서](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/Documentation/admin-guide/cgroup-v2.rst), [CFS Bandwidth Control](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/Documentation/scheduler/sched-bwc.rst), [EEVDF 문서](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/Documentation/scheduler/sched-eevdf.rst)
- [Linux runtime 분배·보충·throttle 구현](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/kernel/sched/fair.c), [cpu.max 설정과 그룹별 대역폭 통계 출력](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/kernel/sched/core.c), [사용 시간의 상위 전파](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/kernel/cgroup/rstat.c)
- [Kubernetes CPU 계산](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/cm/helpers_linux.go), [Pod cgroup 변환](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/cm/cgroup_manager_linux.go), [컨테이너 CRI 자원 계산](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_container_linux.go), [게이트 기준](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go)
- [cgroups v0.0.7의 CPU 파일 쓰기·읽기](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/vendor/github.com/opencontainers/cgroups/fs2/cpu.go), [shares 변환 함수](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/vendor/github.com/opencontainers/cgroups/utils.go), [cAdvisor/lib v0.60.5의 지표 선언·조건·단위](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/vendor/github.com/google/cadvisor/lib/metrics/prometheus.go)
