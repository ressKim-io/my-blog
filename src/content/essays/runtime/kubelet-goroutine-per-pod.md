---
title: "파드 하나에 고루틴 하나 — kubelet의 동시성 물량전과 PLEG 1초 폴링의 물리"
excerpt: "kubelet은 노드의 파드마다 상태를 관리하는 고루틴을 1:1로 통째로 배정합니다. 1:1 OS 스레드였다면 VMA와 PTE 세금으로 무너졌을 이 동시성 물량전이 고루틴의 15.8 KB 실효 연속 스택 덕분에 성립하는 물리적 기전과, Evented PLEG가 1초 relist 폴링의 CPU 런큐 락 경합을 해결하는 아키텍처를 해부합니다"
category: runtime
tags:
  - go
  - kubernetes
  - goroutine
  - kubelet
  - pleg
series:
  name: "kernel-runtime-tradeoffs-6"
  order: 2
date: "2026-07-19"
---

> **시리즈 "커널과 런타임으로 톺아보는 Rust · Go · Java"의 26편 — 6부 2편**
> [25편](/essays/k8s-control-plane-self-exemption)에서 쿠버네티스 제어 평면이 cgroup 처형선 밖에서 돌며 런타임 손잡이(`GOGC`, `automaxprocs`)를 외면한 아키텍처를 확인했습니다
> 6부 2편에서는 워커 노드 최전선에서 컨테이너를 관리하고 생명주기를 책임지는 **`kubelet`의 동시성 아키텍처**를 파헤칩니다
> 핵심 질문은 명확합니다. **수백 개의 파드 상태를 감시하고 동기화할 때, `kubelet`은 왜 스레드 풀(Worker Pool)을 짓지 않고 파드 하나당 고루틴을 통째로 1:1 배정하는 동시성 물량전을 택했을까요**

이번 편의 수치와 소스 분석은 쿠버네티스 v1.36.1 (`pkg/kubelet/pod_workers.go`, `pkg/kubelet/pleg/`) 및 kind(colima 안 도커, 리눅스 커널 6.8.0, cgroup v2) 클러스터에서 직접 계측한 결과를 바탕으로 합니다

---

## 스레드 풀을 거부한 1:1 할당 — `podWorkers` 아키텍처

일반적으로 고성능 C++나 Java 시스템에서 수백 개의 네트워킹 소켓이나 프로세스 상태를 병렬로 관리할 때는 이벤트 루프(`Event Loop`)나 고정된 크기의 작업자 스레드 풀(`Worker Thread Pool`) 패턴을 채택합니다
수백 개의 관리 대상마다 독립된 OS 스레드를 띄우면, [2편](/essays/thread-models-kernel-vs-user)에서 확인한 커널 스케줄러의 컨텍스트 스위칭 락 경합과 각 스레드가 점유하는 가상 및 물리 스택 메모리 낭비가 시스템을 짓누르기 때문입니다

하지만 쿠버네티스 노드 에이전트인 `kubelet`은 이 전통적인 지혜와 설계 공식을 정면으로 거부합니다
소스코드 트리 코어의 심장부인 `pkg/kubelet/pod_workers.go`의 `podWorkerLoop` 메서드를 열어 보면, 노드에 파드가 생성되는 그 순간 해당 파드의 고유 ID(`Pod.UID`)를 전담하는 무한 루프 고루틴이 1:1로 스폰되어 파드가 소멸할 때까지 생명주기 전체를 묶어 관리합니다

```go
// pkg/kubelet/pod_workers.go:1231 (K8s v1.36.1 기준)
func (p *podWorkers) podWorkerLoop(parentCtx context.Context, podUID types.UID, podUpdates <-chan struct{}) {
	var lastSyncTime time.Time
	for range podUpdates {
		ctx, update, canStart, canEverStart, ok := p.startPodSync(parentCtx, podUID)
		if !ok || !canStart {
			continue
		}
		// 파드 상태 캐시 조회 및 동기화 루프 분기
		status, err := p.podCache.GetNewerThan(update.Options.Pod.UID, lastSyncTime)
		// ...
		switch {
		case update.WorkType == TerminatedPod:
			err = p.podSyncer.SyncTerminatedPod(ctx, update.Options.Pod, status)
		case update.WorkType == TerminatingPod:
			err = p.podSyncer.SyncTerminatingPod(ctx, update.Options.Pod, status, gracePeriod, podStatusFn)
		default:
			isTerminal, postSync, err = p.podSyncer.SyncPod(ctx, update.Options.UpdateType, update.Options.Pod, update.Options.MirrorPod, status)
		}
		lastSyncTime = p.clock.Now()
	}
}
```

이 과감한 1:1 배정(`Goroutine per Pod`) 아키텍처가 실제 워커 노드 위에서 어느 정도의 메모리와 스레드 리소스를 소비하는지 계측했습니다
kind 클러스터의 워커 노드에 배포되는 파드 수를 0개에서 30개, 50개까지 점진적으로 늘려 가며 `kubelet` 프로세스가 프로메테우스 포맷으로 노출하는 `/metrics` 지표를 수집했습니다

| 파드 수 (노드 배포량) | `go_goroutines` (고루틴 수) | `go_memstats_stack_inuse_bytes` (유저 스택 총합) | 고루틴 1개당 실효 스택 (`stack_inuse / goroutines`) |
|---|---|---|---|
| 파드 0개 (유휴 상태) | 251개 | 3.78 MiB | ≈ 15.4 KB |
| 파드 30개 배포 | 382개 | 6.01 MiB | ≈ 16.1 KB |
| 파드 50개 배포 | 471개 | 7.44 MiB | ≈ 15.8 KB |

실측치 표는 `kubelet`이 고루틴을 대하는 태도와 그 물리적 결실을 명확하게 증명합니다

- 파드가 1개 추가될 때마다 `kubelet` 내부 고루틴(`go_goroutines`)은 **평균 4~4.5개가 비례해서 증가**(`382 - 251 = 131 / 30 ≈ 4.36개`, `471 - 251 = 220 / 50 = 4.4개`)합니다
- 고루틴 1개당 평균 실효 연속 스택 풋프린트는 **약 15.8 KB**(`7.44 MiB ÷ 471`)에 안착합니다. [12편](/essays/go-allocator-mcache-contiguous-stack)에서 해부한 최소 출발점인 2 KB(`_StackMin`)에서 시작해, 컨테이너 런타임 인터페이스(CRI) gRPC 호출 프레임과 내부 구조체 포인터들이 스택에 적재되며 수축과 확장을 거친 실효 무게입니다

![podWorkers 고루틴 1:1 배정 구조 대 스레드 풀 패턴](/diagrams/kubelet-goroutine-per-pod-1.svg)

`kubelet`이 파드마다 고루틴을 통째로 내어주는 동시성 물량전을 고집할 수 있는 근본적인 동력이 바로 이 **15.8 KB라는 가벼운 물리 원가**입니다
만약 파드 상태 변화를 하나의 작업자 스레드 풀에서 공유 큐(`Shared Queue`)를 통해 처리했다면, 특정 파드의 무거운 컨테이너 이미지 다운로드(`docker pull`)나 NFS/EBS 볼륨 마운트 지연으로 인해 스레드 풀의 작업 슬롯이 꽉 찼을 때, 엉뚱한 다른 파드들의 헬스체크와 상태 동기화까지 일제히 멈춰 서는 스태베이션(`Starvation`) 재난에 시달렸을 것입니다

파드마다 고루틴을 독립 할당하면 특정 파드의 컨테이너 생성 작업이 네트워크 I/O나 스토리지 응답 지연으로 수 분간 블로킹되더라도, 노드 내 타 파드의 생명주기 루프는 전혀 방해받지 않습니다
Go 런타임의 M:N 스케줄러([3편](/essays/mn-scheduler-go-java-rust))가 블로킹 syscall이나 네트워크 대기를 감지하는 즉시 유저 공간에서 포인터만 교체하여 OS 스레드(`M`) 실행 슬롯을 다른 파드의 고루틴에게 즉각 넘겨주기 때문입니다

![파드 증가에 따른 고루틴 수 및 15.8KB 실효 스택 실측](/diagrams/kubelet-goroutine-per-pod-2.svg)

### 커널 sys_clone과 런타임 newproc의 어셈블리 및 메모리 생성 대조

여기서 한 단계 깊이 내려가, 파드가 생성되어 고루틴이 스폰될 때(`runtime.newproc`)와 POSIX OS 스레드가 생성될 때(`sys_clone`) 일어나는 커널 및 런타임 내부의 기계어 동작과 메모리 할당 궤적을 바닥까지 대조해 보겠습니다

C++나 전통적인 시스템에서 스레드 하나를 새로 스폰하기 위해 `clone(CLONE_VM | CLONE_FS | CLONE_FILES | CLONE_SIGHAND | CLONE_THREAD, stack)` 시스템 콜을 호출하면 리눅스 커널 모드로 유저 모드 트랩이 발생합니다
커널 모드에 진입한 CPU는 다음 네 단계의 무거운 물리적 세금을 부과합니다

1. **`task_struct` 커널 제어 블록 할당**: 리눅스 슬랩 할당자(`kmalloc`)를 통해 1.7 KB~2 KB 크기의 커널 구조체(`task_struct`)를 할당하고, 부모 프로세스의 자원 테이블을 복제합니다
2. **16 KB 불변 커널 스택(`Kernel Stack`) 예약**: 커널 공간 내부에서 스레드가 시스템 콜 연산을 수행할 때 쓸 스왑 불가능한 고정 16 KB 물리 메모리를 강제로 상주시킵니다
3. **가상 메모리 서술자(`mm_struct`) 트리 갱신**: 신규 스레드의 8 MB 가상 스택 주소 영역을 나타내는 `vm_area_struct`(VMA)를 새로 생성하여 레드-블랙 트리에 매달고, 4단계 페이지 테이블(`PGD->P4D->PUD->PMD->PTE`) 엔트리를 쪼개어 가상 주소 맵을 갱신합니다
4. **CFS 런큐 레드-블랙 트리 삽입과 런큐 스핀락(`runqueue spinlock`) 경합**: 신규 `task_struct`를 커널 실행 대기열에 넣기 위해 대상 CPU의 런큐 스핀락을 잠그고 가상 실행 시간(`vruntime`) 트리에 삽입합니다

반면 `podWorkers`가 `go p.podWorkerLoop(ctx, uid, outCh)`를 선언하여 고루틴 하나를 스폰할 때 호출되는 `runtime.newproc(fn)`은 커널 모드 전환(`syscall`)을 단 한 번도 거치지 않는 유저 공간 상의 순수 메모리 조작에 불과합니다

```go
// src/runtime/proc.go: runtime.newproc 핵심 실행 궤적 (개념도)
func newproc(fn *funcval) {
	gp := getg()
	pc := getcallerpc()
	systemstack(func() {
		newg := newproc1(fn, gp, pc) // _p_.gFree에서 재활용 또는 힙에서 스폰
		_p_ := getg().m.p.ptr()
		runqput(_p_, newg, true)     // 로컬 런큐 head/tail에 lock-free CAS 삽입
		if mainStarted {
			wakep()                  // 유휴 P가 있으면 스핀 스레드 M 깨우기
		}
	})
}
```

Go 런타임의 `newproc1`은 가장 먼저 현재 논리 프로세서 `P`의 로컬 고루틴 풀(`_p_.gFree`)을 조회해 이전에 실행이 끝나 반환된 빈 `g` 구조체(`약 400 바이트`)가 있는지 확인합니다. 재활용할 슬롯이 있다면 커널은 물론 유저 힙 할당조차 없이 0 바이트 추가 원가로 고루틴 제어 블록을 꺼냅니다

만약 로컬 풀이 비어 있어 새로 할당해야 하더라도, 커널 `mmap` 호출 없이 Go 메모리 할당자의 스택 전용 풀(`runtime.stackpool`)이나 `mheap`에서 연속된 2 KB(`_StackMin`) 스팬 조각을 즉시 잘라내어 스택 주소로 배정합니다
이후 신규 고루틴 구조체의 명령어 포인터(`newg.sched.pc`)에 `podWorkerLoop` 함수의 시작 주소를 기록하고, 스택 포인터(`newg.sched.sp`)를 2 KB 프레임 끝점에 맞춘 뒤, `_p_.runq` 원형 큐 배열에 원자적(`atomic`) CAS 연산으로 밀어 넣습니다

OS 스레드 스폰(`pthread_create`)이 가상 주소 매핑과 페이지 테이블 갱신, 커널 런큐 스핀락을 동반하는 수십 마이크로초(`µs`) 단위의 커널 작업이라면, `podWorkers`의 고루틴 스폰(`newproc`)은 400 바이트 제어 구조체와 2 KB 힙 슬라이스를 포인터로 연결하는 1 마이크로초 미만(`~1 µs`)의 초고속 유저 공간 조각 맞추기입니다

### GMP 스케줄링 상태 전이와 `sudog` / `_Gwaiting` 파기 메커니즘

그렇다면 파드 50개를 감시하는 고루틴 수백 개가 루프를 돌 때, 이들이 커널 CPU 사이클을 갉아먹거나 Go 스케줄러의 논리 프로세서(`P`) 런큐에 부하를 주지는 않을까요
이를 이해하려면 `podWorkerLoop` 내부에서 일어나는 **GMP 스케줄러 상태 전이와 `sudog` 대기열을 통한 고루틴 파기(`gopark`) 및 깨우기(`goready`) 정밀 기전**을 소스 수준으로 파고들어야 합니다

```go
// podWorkerLoop 고루틴이 채널에서 메시지를 기다리는 순간의 스케줄러 전이
for range podUpdates { ... }
```

이 `for range podUpdates` 수신 루프는 단순한 대기 코드가 아니라, Go 런타임 스케줄러(`src/runtime/chan.go`의 `chanrecv`)가 개입하는 정교한 상태 제어 문턱입니다

1. **이벤트 부재 시 `sudog` 프록시 노드 할당과 파기 (`goparkunlock`)**: 특정 파드에 아무런 상태 변화나 갱신 명령이 없어 채널(`podUpdates`) 버퍼가 비어 있다면, `chanrecv` 함수는 로컬 `sudog` 풀에서 88 바이트 크기의 대기열 노드 구조체(`sudog`)를 하나 꺼냅니다. 이 구조체의 포인터 필드(`sudog.g = getg()`)를 현재 실행 중인 고루틴 주소에 매핑한 뒤, 채널의 수신 대기 이중 연결 리스트(`c.recvq`) 끝에 엮고 `goparkunlock(&c.lock, waitReasonChanReceive, traceEvGoBlockRecv, 3)`을 호출합니다
2. **`g0` 시스템 스택 전환과 `_Grunning` -> `_Gwaiting` 원자적 전이**: 스케줄러(`runtime.park_m`)는 현재 실행 중인 OS 스레드 `M`의 시스템 스택(`g0`)으로 트랩한 뒤, `podWorkerLoop`를 실행 중이던 고루틴(`g`)의 실행 컨텍스트(`sched.pc`, `sched.sp`)를 구조체 내부에 안전하게 보존합니다. 그리고 `g.atomicstatus`를 실행 중(`_Grunning`)에서 대기(`_Gwaiting`)로 원자적으로 전환합니다
3. **논리 프로세서(`P`) 및 OS 스레드(`M`) 분리**: `_Gwaiting` 상태가 된 고루틴은 논리 프로세서 `P`의 로컬 실행 큐(`runq`) 및 전역 런큐에서 완벽하게 퇴출되며, OS 스레드 `M`(`_g_.m.curg = nil`)과의 연결도 끊어집니다. `podWorkers` 초기화나 코어 수 조정(`GOMAXPROCS`) 단계에서 `src/runtime/proc.go`의 `procresize()`로 정밀하게 크기가 설정된 논리 프로세서 `P` 풀 위에서, 런타임 스케줄러는 즉시 `schedule()`(`src/runtime/proc.go`)을 호출하고 `findrunnable()`(`src/runtime/proc.go`)을 통해 로컬/전역 런큐, 네트워크 폴러, 그리고 타 `P`로부터의 작업 탈취(`Work Stealing`)를 탐색하여 다음 고루틴을 꺼내 실행합니다. 따라서 유휴 상태의 파드 고루틴 수백 개는 호스트 커널 스케줄러(`CFS`) 관점에서 단 1초의 CPU 시간도 소비하지 않는 **순수한 메모리 상의 수면 상태**로 존재합니다
4. **이벤트 도달 시 `runnext` 고속 표적 깨우기 (`goready`)**: 이후 CRI 이벤트나 Sync 요청으로 채널(`podUpdates`)에 신호가 전달(`chansend`)된 순간, 런타임은 채널 수신 리스트(`c.recvq`) 맨 앞의 `sudog` 구조체를 떼어내어 대기하던 고루틴 주소(`sudog.g`)를 확인합니다. 그리고 `runtime.goready(g)`를 호출해 해당 고루틴의 상태를 대기(`_Gwaiting`)에서 실행 가능(`_Grunnable`)으로 되돌리고, 현재 실행 중인 `P`의 로컬 런큐에서 가장 우선순위가 높은 단일 슬롯 고속 캐시인 **`_P_.runnext`** 에 즉시 꽂아 넣습니다

![podWorkerLoop 고루틴 수동 수면 및 깨우기 (gopark / goready) 상태 전이 모식도](/diagrams/kubelet-goroutine-per-pod-3.svg)

고루틴이 OS 스레드를 전혀 점유하지 않고도 밀리초 단위로 수면과 실행을 넘나드는 3단계 상태 전이 흐름을 정리해 보겠습니다

- **수면 진입 (`_Grunning` ➔ `_Gwaiting`)**: 채널이 비어 있으면 스케줄러(`goparkunlock`)는 고루틴의 컨텍스트를 보존한 채 실행 큐에서 완전히 내립니다. 고루틴은 `sudog` 대기열에 엮여 수면하고, 논리 코어(`P`)와 스레드(`M`)는 즉시 분리되어 다른 작업을 처리합니다
- **비동기 깨우기 (`_Gwaiting` ➔ `_Grunnable`)**: CRI 이벤트가 도달해 채널 수신(`chansend`)이 터지면 런타임은 `goready(g)`를 호출합니다. 고루틴은 즉시 실행 가능 상태로 전환되어 현재 논리 코어 `P`의 1-슬롯 고속 캐시인 `_P_.runnext`에 최우선 배치됩니다
- **고속 실행 (`_Grunnable` ➔ `_Grunning`)**: 스케줄러(`findrunnable`)는 전역 큐를 뒤지지 않고 `runnext`에서 즉시 고루틴을 낚아채어 유저 공간 속도(수십 µs)로 실행 루프에 복귀시킵니다

이처럼 `podWorkerLoop` 고루틴은 이벤트가 도달할 때만 유저 공간 고속 슬롯(`runnext`)으로 즉각 깨어나고(`goready`), 평시에는 스케줄러 큐에서 내려와(`gopark`) 15.8 KB의 힙 스택과 88 바이트 `sudog`만 유지하므로 1:1 파드 물량전이 아키텍처적으로 성립합니다

### `proberManager` 고루틴 스폰 구조와 4~4.5개 증가 법칙의 정체

앞서 계측한 표에서 파드가 1개 늘어날 때 고루틴이 1개가 아니라 평균 **4~4.5개씩 비례 증가**하는 이유를 소스코드 바닥 구조와 타이머 스케줄러 기전에서 확인해 보겠습니다
`podWorkers.podWorkerLoop`는 파드 전체의 큰 생명주기(생성, 삭제, 미러 파드 동기화)를 총괄하는 중심 주체일 뿐이며, 파드 내부의 개별 컨테이너가 살아있는지 검사하는 프로빙(`Probing`) 체계는 **`proberManager` (`pkg/kubelet/prober/prober_manager.go`)** 라는 별도의 전담 모듈이 독립된 고루틴 패키지로 분담하기 때문입니다

`kubelet`이 파드 배포 명령을 접수하면, `proberManager`는 파드 명세에 정의된 각 컨테이너의 프로브 설정(`Startup`, `Readiness`, `Liveness`)을 파싱하고 개별 워커 고루틴을 생성합니다

```go
// pkg/kubelet/prober/prober_manager.go:185 (K8s v1.36.1 기준)
func (m *manager) AddPod(ctx context.Context, pod *v1.Pod) {
	m.workerLock.Lock()
	defer m.workerLock.Unlock()

	key := probeKey{podUID: pod.UID}
	for _, c := range append(pod.Spec.Containers, getRestartableInitContainers(pod)...) {
		key.containerName = c.Name
		if c.StartupProbe != nil {
			key.probeType = startup
			...
			w := newWorker(m, startup, pod, c)
			m.workers[key] = w
			go w.run(ctx) // 각 컨테이너 프로브마다 독립 고루틴 스폰
		}
		if c.ReadinessProbe != nil {
			...
			go w.run(ctx)
		}
		if c.LivenessProbe != nil {
			...
			go w.run(ctx)
		}
	}
}
```

소스코드 `go w.run(ctx)`는 1:1 물량전의 범위가 파드 단위에 머무르지 않고 **컨테이너 단위의 프로브 설정마다 독립 고루틴으로 세분화된다는 명확한 증거**입니다

그렇다면 프로브 워커 고루틴(`worker.run`)은 설정된 프로브 검사 주기(`periodSeconds`, 기본값 10초)를 맞추기 위해 어떻게 대기할까요
각 프로브 고루틴은 `time.NewTicker(periodSeconds)`를 선언한 뒤 타이머 채널에서 인터럽트를 수신 대기하며 `_Gwaiting` 상태로 진입합니다

Go 런타임 타이머 관리 체계(`src/runtime/time.go`)는 각 논리 프로세서 `P`마다 내장된 **4-ary 타이머 최소 힙(`timers` 필드)** 에 이 프로브 타이머 노드들을 촘촘히 정렬합니다
시스템 모니터링 백그라운드 스레드인 `src/runtime/proc.go`의 `sysmon()`이나 활성화된 스레드 `M`(`schedule()` 호출 시점)이 스케줄링 간격마다 `runtime.checkTimers(pp, now)`를 호출하여 마감 시간이 도래한 타이머를 탐지하는 즉시, 대기 중이던 프로브 워커 고루틴을 `goready()`로 깨워 `Liveness` HTTP/TCP 프로빙을 실행합니다
논리 프로세서 `P`마다 독립된 타이머 힙을 소유하기 때문에, 노드 내 400개가 넘는 프로브 타이머가 돌더라도 전역 락 경합 없이 마이크로초 단위로 정밀하게 인터럽트가 분배됩니다

`kubelet` `/debug/pprof/goroutine?debug=1` 프로파일러로 9개 파드가 배포된 워커 노드의 고루틴 235개를 스택 분해한 실측치와 소스 구조를 종합하여, 파드 1개가 추가될 때 스폰되는 고루틴 패키지의 원가를 분해합니다

1. **`podWorkers.podWorkerLoop` 주 상태 동기화 고루틴**: 파드 전용 알림 채널(`outCh`)을 대기하며 CRI 컨테이너 상태 동기화를 1:1로 담당 (`pprof` 실측: 파드당 **정확히 1개**, 9개 확인)
2. **`prober.(*worker).run` Liveness 프로브 고루틴**: 컨테이너의 생존 검사(HTTP/TCP)를 위해 주기마다 타이머 힙 인터럽트를 기다리며 `worker.run` 수행 (`pprof` 실측: 설정된 컨테이너 프로브마다 **1개씩 스폰**)
3. **`prober.(*worker).run` Readiness / Startup 프로브 고루틴**: 트래픽 유입 및 초기화 완료 여부를 판단하기 위해 별도의 주기로 `worker.run` 수행
4. **상태/볼륨 및 CRI 이벤트 보조 고루틴 (`statusManager` / `volumeManager`)**: 임시 저장소 마운트 관리, cAdvisor 하우스키핑(`housekeepingTick`), 비동기 CRI 콜백(`callback_serializer.run`)을 수행하는 보조 고루틴들 (**1~1.5개**)

이처럼 메인 `podWorkerLoop` 1개에 컨테이너별 프로브 워커 및 보조 동기화 고루틴들이 파드 배포 단위와 기계적으로 묶여 스폰되므로, 실측치에서 파드 30개 추가 시 131개(`≈ 4.36 × 30`), 50개 추가 시 220개(`= 4.4 × 50`)라는 정확하고 불변하는 비례 기울기가 도출되는 것입니다

---

## 만약 1:1 OS 스레드였다면 — VMA와 PTE 세금의 파국

이 동시성 물량전 아키텍처가 얼마나 Go 런타임의 가벼운 스택 구조에 의존하고 있는지 체감하기 위해 극단적인 대조 사고 실험을 진행해 보겠습니다
쿠버네티스 v1.36.1 표준 설정에서 워커 노드 하나가 수용할 수 있는 최대 파드 상한선은 **`MaxPods = 110`** (`pkg/kubelet/apis/config/v1beta1/defaults.go:196`)입니다
여기에 에페메럴 컨테이너, 다중 초기화 컨테이너(`initContainers`), 그리고 앞서 규명한 컨테이너별 Liveness/Readiness/Startup 프로브 고루틴까지 더하면 노드 한 대 안에서 활성화되는 파드 생명주기 관련 동시성 주체는 **약 500개**에 달합니다

만약 쿠버네티스를 Go가 아닌 C++나 전통적인 Java의 1:1 OS 스레드 모델(`pthread`) 기반 언어로 작성하여 500개의 파드 및 프로브 관리 루프를 500개의 독립된 커널 스레드로 띄웠다면 어떠한 물리적 세금을 치러야 했을까요

```text
[500개 동시성 주체 할당 시 물리 메모리 상주 및 가상 주소 공간 비교]

1. Go 고루틴 모델 (실측치 기준)
   - 유저 스택 상주 RAM : 500 × 15.8 KB ≈ 7.9 MiB
   - 커널 task_struct   : 0 (M:N 스케줄링으로 런타임 스레드 몇 개 위에서 다중화)
   - 커널 VMA 및 PTE 세금 : 거의 없음 (힙 영역 내 연속 스택으로 통합 관리)

2. 1:1 OS 스레드 (pthread) 가정 시
   - 가상 주소 예약      : 500 × 8 MB = 4,000 MB (64비트 주소 공간 예약으로, 지연 커밋되어 즉시 물리 RAM을 쓰지는 않음)
   - 커널 불변 스택 RAM   : 500 × 16 KB = 8.0 MiB (task_struct + 커널 고정 스택, 스왑 불가능 상주 메모리)
   - VMA 구조체 세금      : 500개의 개별 vm_area_struct 파편화 생성
   - 4단계 PTE 페이지 테이블: 가상 주소 파편화로 수천 개 페이지 테이블 디렉토리 엔트리 분열
```

이 대조표는 단순한 스택 메모리 바이트 수치 이상의 깊은 OS 커널 아키텍처적 간극을 드러냅니다
64비트 가상 주소 공간에서 4 GB 예약(`mmap`) 자체는 지연 커밋(`Lazy Commit`)되므로 즉시 물리 RAM을 소모하는 치명타는 아닙니다
가장 파괴적인 실제 비용은 물리 RAM 8 MiB라는 눈에 보이는 숫자나 가상 주소 크기가 아니라, 리눅스 커널 메모리 관리자(`mm/mmap.c`)가 500개의 가상 스택 구획을 관리하기 위해 부과하는 **VMA 구조체 파편화와 4단계 페이지 테이블 분열 세금**입니다

### VMA 파편화와 4단계 페이지 테이블(PGD -> P4D -> PUD -> PMD -> PTE) 세금

리눅스 커널은 각 스레드가 생성(`clone` 시스템 콜)될 때 예약하는 8 MB의 스택 가상 주소 구획이 정당한 접근 허용 영역임을 기록하기 위해, 프로세스 가상 메모리 서술자(`mm_struct`) 안의 레드-블랙 트리에 **VMA(`Virtual Memory Area`, `vm_area_struct`)** 500개를 개별 매달아야 합니다

64비트 아키텍처의 4단계 페이지 테이블 변환 체계에서 이 500개의 VMA는 치명적인 페널티를 유발합니다

- 500개 스레드의 8 MB 가상 스택 주소들은 메모리 맵 상에서 연속되어 있지 않고 넓은 가상 주소 공간 전체에 멀리 파편화되어 흩어집니다
- 이 파편화된 가상 주소들이 실제 물리 페이지 프레임에 안착할 때마다, 커널은 **PGD(`Page Global Directory`) -> P4D -> PUD -> PMD -> PTE(`Page Table Entry`)** 로 이어지는 하위 디렉터리 테이블들을 조각조각 분리해서 새로 할당해야 합니다
- 이로 인해 오직 페이지 테이블 메타데이터를 담기 위한 커널 메모리만 수 MiB 이상 낭비되며, CPU 내장 **TLB(`Translation Lookaside Buffer`)** 슬롯이 수백 개의 파편화된 PTE 엔트리로 뒤덮이며 도달 범위(`TLB Reach`)가 급격히 붕괴합니다

### CFS 런큐 스핀락 경합과 L1/L2 캐시 유실

TLB 미스로 인한 메모리 버스 지연이 정적 세금이라면, 500개의 OS 스레드가 작동할 때 매초 지불해야 하는 동적 세금은 **커널 스케줄러(`CFS`) 런큐 경합과 CPU 캐시 축출**입니다

500개의 Liveness/Readiness 프로브 스레드가 타이머 틱이나 소켓 응답으로 동시에 깨어나 커널 실행 대기열로 진입할 때 일어나는 물리적 상황을 추적합니다

- 리눅스 CFS(`Completely Fair Scheduler`)는 500개의 스레드를 가상 실행 시간(`vruntime`) 순으로 정렬하기 위해 런큐의 레드-블랙 트리를 쉼 없이 재조정합니다
- 이 과정에서 멀티코어 환경의 각 CPU가 런큐 트리를 갱신하기 위해 커널 **런큐 스핀락(`runqueue spinlock`)** 을 맹렬히 경합하며 CPU 사이클을 소모합니다
- 스레드 컨텍스트 스위칭이 일어날 때마다 [1편](/essays/syscall-mode-switch-cost)에서 파헤친 레지스터 복구 비용이 발생하고, CPU 코어의 L1/L2 데이터 및 명령어 캐시 라인이 다음 스레드의 데이터로 강제 축출(`Eviction`)되어 타버립니다

![1:1 OS 스레드 가정 시 CFS 런큐 경합과 VMA/PTE 세금](/diagrams/kubelet-goroutine-per-pod-4.svg)

[2편](/essays/thread-models-kernel-vs-user)에서 예고했던 **"1:1 OS 스레드 모델에서는 동시성 주체가 늘어날수록 커널 메타데이터 비용이 기하급수적으로 폭증한다"** 는 대명제가 `kubelet`의 노드 상한선(`MaxPods = 110`)에서 정확히 증명됩니다
쿠버네티스는 고루틴의 유저 연속 스택과 15.8 KB 초경량 풋프린트를 딛고 섰기에, 커널 VMA/PTE 세금과 CFS 런큐 스핀락 경합을 완벽히 비켜 가는 파드당 고루틴 1:1 동시성 물량전을 짓고 생존할 수 있었습니다

---

## 동시성 물량전의 청구서 — PLEG 1초 폴링과 `Evented PLEG` 커널 최적화

고루틴이 가볍고 1:1 파드 할당이 작업 간 스태베이션을 막아준다 해도, 세상에 공짜 아키텍처는 없습니다
500개의 고루틴이 각자의 주기로 타이머 루프를 돌리고 상태를 감시할 때 쿠버네티스 워커 노드가 직면한 런타임 청구서는 **주기적 전체 폴링(`Polling`)이 유발하는 Unix Domain Socket I/O 부하와 CPU 런큐 경합**이었습니다

### Generic PLEG의 1초 주기 Unix Domain Socket 폴링 폭주

`kubelet`이 파드와 컨테이너의 실제 상태 변화(예: 프로세스 종료, OOMKill, 컨테이너 Crash)를 감지하여 자신의 메모리 캐시를 갱신하는 핵심 엔진은 **PLEG(`Pod Lifecycle Event Generator`)** 입니다
쿠버네티스 탄생 초기부터 유지되어 온 기본 구현체인 `Generic PLEG` (`pkg/kubelet/pleg/generic.go`)는 노드의 모든 파드 및 컨테이너 목록을 통째로 긁어오는 `relist` 주기가 소스코드 상수 **1초(`1 * time.Second`)** 로 단호하게 박혀 있습니다

```go
// pkg/kubelet/kubelet.go:215 (Generic PLEG 기본 relist 주기)
genericPlegRelistPeriod = 1 * time.Second
```

파드가 110개 꽉 차 있는 노드에서 Generic PLEG 고루틴이 1초마다 깨어나 `relist`를 실행할 때 발생하는 하드웨어/OS 부하의 연쇄 고리를 해부합니다

1. **Unix Domain Socket gRPC 호출 및 netpollblock 대기**: PLEG 고루틴은 로컬 Unix Domain Socket(`unix:///run/containerd/containerd.sock`)을 통해 컨테이너 런타임(`containerd` 또는 `CRI-O`)을 향해 `ListPodSandbox`와 `ListContainers` gRPC 요청을 발사합니다. 비블로킹 모드 소켓에서 응답이 즉시 도착하지 않으면 Go 네트워크 폴러(`src/runtime/netpoll.go`)가 소켓 디스크립터를 등록한 뒤 `netpollblock`을 호출하여 PLEG 고루틴을 `gopark`(`_Gwaiting`) 상태로 주차시킵니다
2. **CRI 런타임의 전수 조회와 cgroup 스캔**: `containerd`는 노드 내 110개 파드와 수백 개 컨테이너의 PID 상태, Linux Namespace, 그리고 `/sys/fs/cgroup/kubepods.slice/.../pids.current` 등 cgroup 메트릭을 순회하며 읽어 들여 거대한 Protobuf/JSON 응답 구조체로 직렬화합니다
3. **`epoll_wait` 수확과 소켓 버퍼 역직렬화 세금**: 커널 내부에서 `unix_stream_sendmsg`가 응답 바이트를 전송하면, Go의 백그라운드 스레드(`sysmon`)나 스케줄러(`findrunnable`)가 실행하는 **`src/runtime/netpoll_epoll.go`의 `epoll_wait()`** 가 이벤트를 수확(`netpoll`)하고 주차되었던 PLEG 고루틴을 `goready()`(`netpollready`)로 깨웁니다. `kubelet` 수신 고루틴은 `sk_buff` 소켓 수신 버퍼에서 전달된 스트림을 Go 구조체(`*runtimeapi.ListContainersResponse`)로 역직렬화하기 위해 매초 수십만 개의 임시 객체(`*runtimeapi.Container`, 문자열 슬라이스, 라벨 맵)를 `mcache`와 `mcentral`에 맹렬히 쏟아냅니다
4. **Go GC `markroot` 마킹 폭풍과 CPU 타임 포화**: 매초 쏟아진 뒤 바로 소멸하는 CRI 응답 객체들을 청소하기 위해 Go 가비지 컬렉터가 가동됩니다. 단명 객체라 할지라도 GC 마킹 페이즈 진입 순간 스레드 `M`이 500개 고루틴의 스택 루트(`markroot`)와 힙 포인터를 스캔하며 하이브리드 쓰기 장벽(`gcWriteBarrier`)을 트리거합니다. `kubelet` CPU 지표를 분해하면 실제 컨테이너 제어(`user time`)보다, gRPC 역직렬화/GC 마킹(`user time`)과 소켓 버퍼 락/cgroup 파일 순회 시스템 타임(`sys time`)이 CPU 점유율을 삼켜 버립니다

무엇보다 치명적인 모순은 변경 사항이 전혀 없는 110개 유휴 파드의 상태를 확인하기 위해 매초 막대한 양의 IPC 통신과 힙 객체 할당을 맹목적으로 반복한다는 점입니다
이 1초 폴링 폭풍으로 인해 `relist` 주기가 상수 임계값인 3분(`genericPlegRelistThreshold = 3 * time.Minute`)을 초과하면 마스터 노드로 `PLEG is not healthy` (`pleg was last seen active...; threshold is 3m0s`) 경보가 발송되고, 노드 전체가 `NotReady` 상태로 강제 퇴출되는 장애가 발생합니다

### Evented PLEG: CRI/cgroup 비동기 이벤트 스트림 푸시 전환

쿠버네티스 엔지니어들은 1초 폴링이 유발하는 노드 CPU 낭비와 힙 할당 폭주를 타개하기 위해 기능 게이트인 **Evented PLEG** (`pkg/kubelet/pleg/evented.go`)를 고안했습니다
다만 Evented PLEG는 v1.26에 도입된 이후 v1.36.1 현재까지도 기본 비활성화된 Alpha 상태(`Default: false`, `PreRelease: featuregate.Alpha`)에 머물러 있으며, 이를 선택적으로 켰을 때(`--feature-gates=EventedPLEG=true`) 작동하는 비동기 우회 파이프라인입니다
Evented PLEG의 핵심 철학은 1초마다 무조건 전체를 긁어오던 무식한 폴링 루프를 버리고, 컨테이너 런타임의 비동기 이벤트 통지 메커니즘을 연동하여 **푸시(`Push`) 기반 비동기 파이프라인**으로 전환하는 것입니다

```go
// pkg/kubelet/kubelet.go:219 (Evented PLEG 활성화 시 정기 relist 안전망 주기 및 임계값)
eventedPlegRelistPeriod    = 300 * time.Second
eventedPlegRelistThreshold = 10 * time.Minute
```

Evented PLEG가 활성화되는 순간, `generic.go`의 1초 주기 `relist` 루프는 소스코드에서 무려 300배 늦춰진 **300초(5분)** 로 후퇴하며 헬스 임계값 또한 10분(`10 * time.Minute`)으로 확장됩니다
그렇다면 300초 동안 주기적인 조회가 멈춘 상황에서, 특정 컨테이너가 1초 만에 OOMKill로 죽거나 비정상 종료되었을 때 이를 어떻게 실각 감지할까요

- 컨테이너 런타임(`containerd` 또는 `CRI-O`)의 shim 프로세스(`runc`)는 컨테이너 프로세스 종료 이벤트(`wait`)와 cgroup v2 이벤트 파일(`/sys/fs/cgroup/kubepods.slice/.../memory.events`)을 감시합니다
- 컨테이너가 소멸하거나 상태가 변하는 물리적 알림이 터진 그 즉시, 감시 데몬은 CRI gRPC 스트림(**`GetContainerEvents`**)을 통해 소켓 폴링 없이 비동기 이벤트 프레임을 `kubelet`으로 즉각 전송(`Push`)합니다
- `kubelet`의 Evented PLEG 수신 채널(`plegCh`)은 이 비동기 푸시 이벤트를 받아 즉각 노드 상태 캐시를 갱신합니다

![Generic PLEG 1초 폴링과 Evented PLEG 비동기 이벤트 스트림 아키텍처](/diagrams/kubelet-goroutine-per-pod-5.svg)

### 채널 이벤트와 스케줄러 상태 전이의 정밀 해상도

여기서 Evented PLEG가 300초 안전망 루프와 비동기 CRI 푸시 이벤트를 어떻게 역할 분담하며, `podWorkerLoop` 고루틴을 유저 공간 속도로 깨우는지 그 내부 동기화 기전을 정밀하게 추적합니다

1. **300초 주기 루프의 역할 변경 — 안전망(`Backup Polling`) 후퇴**: 300초(`eventedPlegRelistPeriod`) 주기의 `relist`는 이제 일상적인 상태 감시자가 아닙니다. CRI 소켓 연결이 일시적으로 끊어지거나 이벤트 스트림 패킷이 유실되는 극단적 엣지 케이스를 방어하기 위해 5분마다 한 번씩 전수 조사를 수행하는 **최후의 백업 폴링(`Backup Polling`) 방어선**으로 물러납니다
2. **비동기 CRI 푸시 도달과 PLEG 채널 수신**: 평상시 컨테이너에 상태 변화가 생기면, CRI가 전송한 비동기 이벤트(`GetContainerEvents`)를 Evented PLEG 루프가 수신하여 중앙 채널(`plegCh`)로 밀어 넣습니다
3. **`syncLoopIteration` 깨우기와 파드 전용 채널(`outCh`) 발송**: 채널(`plegCh`) 수신을 감지한 `kubelet` 메인 이벤트 루프(`kubelet.syncLoopIteration`)는 어떤 파드에서 이벤트가 발생했는지 UID를 판별하고, 앞서 `podWorkers`에서 1:1로 엮어 둔 **해당 파드 고유의 알림 채널(`outCh <-chan struct{}`)로 1바이트 신호를 발송**합니다
4. **정밀 표적 깨우기 (`gopark` -> `goready`)**: 파드 전용 채널에 신호가 도달한 바로 그 순간, 300초 동안 `gopark` 상태로 잠들어 있던 **오직 해당 파드의 `podWorkerLoop` 고루틴 단 1개만 정밀하게 깨어납니다(`goready`)**. 고루틴은 스케줄러의 `_Gwaiting`에서 `_Grunnable`로 전이되어 `P`의 고속 1-슬롯 `runnext`에 오르고, `startPodSync`로 큐의 변경 요청을 확인한 뒤 유저 공간 속도로 즉각 파드 상태를 동기화합니다

노드에 110개의 파드가 배포되어 있어도, 컨테이너 1개가 종료된 순간 나머지 109개 파드의 `podWorkerLoop` 고루틴들은 단 1 바이트의 메모리 갱신이나 1 마이크로초의 스케줄링 런큐 경합도 겪지 않은 채 `_Gwaiting` 수면 상태를 완벽하게 유지합니다

### 비동기 이벤트 고루틴과 300초 폴링 고루틴의 `podRecords` 뮤텍스 경합

Evented PLEG가 1초 폴링의 부하를 300배 깎아냈지만, 300초 주기의 백업 폴링 안전망(`Generic PLEG`)을 완전히 제거하지 못하면서 새로운 내부 동기화 엣지 케이스를 낳았습니다
`kubelet` 내부에서 파드들의 최신 상태를 인메모리 맵으로 보관하는 캐시 스토어인 **`podRecords` (`pkg/kubelet/pleg/generic.go`)** 접근 동기화와 스케줄러 대기열 간섭입니다

```go
// pkg/kubelet/pleg/generic.go:132 (K8s v1.36.1 기준)
type podRecords map[types.UID]*podRecord
```

비동기 이벤트 파이프라인과 정기 안전망이 공존하는 구조에서 두 개 이상의 독립 고루틴이 `GenericPLEG` / `EventedPLEG` 내부 뮤텍스(`podRecordsLock sync.Mutex` 등)를 통해 `podRecords` 캐시에 동시 접근을 시도합니다

- **비동기 CRI 이벤트 고루틴**: `GetContainerEvents` 스트림으로 수신된 실시간 파드 상태를 캐시(`podRecords`)에 즉각 기록하려 시도합니다
- **300초 정기 백업 폴링 고루틴**: 300초 타이머 틱에 의해 깨어나 노드 내 110개 파드 전체 목록(`ListPodSandbox`)을 받아 캐시와 대조하고 일괄 갱신하려 시도합니다
- 만약 300초 주기의 전수 `relist`가 도달해 110개 파드 레코드를 순회 갱신하며 내부 락을 쥔 채 연산을 수행하는 그 수 밀리초 사이에, 외부에서 실제 컨테이너 종료 이벤트가 터지면 어떻게 될까요
- CRI 비동기 고루틴은 뮤텍스 락을 획득하기 위해 대기하며 Go 런타임의 락 관리자(`runtime.lock_sema.go`의 `lockWithRank`)를 호출합니다. 고루틴은 짧은 능동/수동 스핀을 시도한 뒤 곧바로 세마포어 대기열에 엮이며 `gopark` 상태로 동결됩니다
- 이로 인해 OS 스레드 `M`이 분리되고 컨텍스트 스위칭이 터지면서, 실시간으로 처리되었어야 할 컨테이너 이벤트 디스패치가 정기 안전망의 일괄 갱신 시간만큼 지연되는 락업 지터(`Jitter`)가 발생합니다

쿠버네티스 코어 팀은 이 락 경합을 완화하기 위해 인메모리 캐시 락의 임계 구역을 최소화하고 갱신 입도를 쪼개는 방어를 펼쳤습니다
비동기 이벤트 스트림과 주기적 폴링 안전망이라는 이원화된 아키텍처가 공존할 수밖에 없는 현실에서, 고루틴 간 내부 뮤텍스 경합을 억제해야 하는 런타임 엔지니어링의 치열한 단면입니다

---

### 클라우드 & 인프라 실전 연결 예고: EKS Nitro, GKE eBPF, KVM 가상화 세금

우리가 규명한 고루틴 1:1 물량전과 PLEG 소켓 I/O는 실제 쿠버네티스 워크로드가 안착하는 인프라 계층(AWS, GCP, OpenStack 온프레미스)의 하드웨어 및 커널 가속 기술과 만나면 전혀 다른 병목 양상을 보입니다

- **AWS EKS 고밀도 노드와 Nitro ASIC 오프로딩**: ENI 접두사 위임(`Prefix Delegation`)으로 노드당 250개 파드(`MaxPods=250`)를 안착시킬 때, 1,000개가 넘는 프로브 고루틴과 PLEG 루프가 일으키는 커널 인터럽트(`ksoftirqd`) 폭풍과 Karpenter 자동 프로비저닝 시의 메모리 여유치(`Headroom`) 산정 기전
- **GCP GKE Dataplane V2와 eBPF Zero-Copy 소켓 가속**: Cilium 기반 데이터 플레인에서 `sock_hash` 및 `sk_msg` 맵을 활용해 Kubelet 프로브 루프와 CRI 소켓 통신의 `TCP/IP` 스택 복사를 우회하는 기전
- **OpenStack KVM/QEMU 가상화 이중 세금(`Double Virtualization Tax`)**: 하이퍼바이저 가상 타이머 인터럽트(`apic_timer`) 주입 지연으로 인해 호스트와 게스트 CFS 스케줄러가 2중 경합을 벌이며 PLEG 3분 임계값을 초과하는 실전 장애와 DPDK/SR-IOV 우회 전략

이처럼 클라우드 및 온프레미스 하이퍼바이저 위에서 발생하는 **고밀도 컨테이너 런타임 세금과 하드웨어 가속 실측 해부**는 별도로 분리된 **[쿠버네티스 클라우드 & 인프라 실전 심층 시리즈](/plans/k8s-cloud-series)** 에서 실제 EKS/GKE 및 로컬 KVM 환경의 계측치와 함께 집중적으로 다룹니다

---

## 비용 보존 법칙 — 동시성 물량전이 비켜 간 곳과 넘어간 청구서

`kubelet`의 고루틴 1:1 배정(`Goroutine per Pod`)과 Evented PLEG는 [25편](/essays/k8s-control-plane-self-exemption)에서 소개한 첫 번째 아키텍처 우회로의 실체입니다

[14편](/essays/allocation-convergence-why-gc)과 [19편](/essays/gc-cost-conservation-no-silver-bullet)에서 우리가 거듭 확인했던 **"비용 보존 법칙"** 은 워커 노드 최전선에서 파드를 지키는 노드 에이전트에서도 단 한 치의 예외 없이 작동합니다

이번 편에서 소스코드와 계측치로 검증한 `kubelet` 동시성 설계의 득과 실을 총정리해 보겠습니다

- **비켜 간 물리적 한계 (`Goroutine per Pod` + `GMP` 수면)**: 고정 스레드 풀의 작업 슬롯 부족으로 인한 I/O 스태베이션, OS 스레드의 8 MB 가상 주소 폭발, 500개 `vm_area_struct` VMA 파편화, 4단계 페이지 테이블 PTE/TLB 세금, 그리고 CFS 런큐 스핀락 경합을 **15.8 KB 연속 스택 고루틴 1:1 물량전과 `gopark` 상태 파기 전략**으로 가볍게 비켜 갔습니다
- **지불한 새로운 청구서 (`Evented PLEG` + 락 경합)**: 500개 고루틴이 1초마다 소켓을 흔들 때 터진 CRI 역직렬화 부하와 GC `markroot` 마킹 폭풍을 잡기 위해, **CRI 및 cgroup 커널 비동기 이벤트 스트림(`GetContainerEvents`)** 이라는 고도의 커널 의존적 파이프라인을 구축해야 했습니다. 나아가 CRI 이벤트 유실을 방어하기 위해 남겨둔 300초 백업 폴링 안전망과 실시간 이벤트 고루틴이 인메모리 캐시(`podRecords`)에서 부딪히는 락 경합이라는 내부 부채를 껴안았습니다

이처럼 워커 노드 최전선의 `kubelet`은 고루틴의 가벼움을 무기로 파드 1:1 물량전을 펴고, 커널 비동기 이벤트로 상태 폴링 부하를 제압했습니다
그렇다면 워커 노드 수천 대에서 1초가 멀다 하고 포착되는 수십만 개의 파드 상태 갱신 이벤트(`PodStatus Update`)가 마스터 노드의 심장부인 `kube-apiserver`로 일제히 밀어닥칠 때, 제어 평면은 이 거대한 이벤트 홍수를 어떻게 감당할까요

---

## 더 파고들 질문

### Q1. 파드 하나에 고루틴이 4~4.5개씩 할당된다면, 노드에 파드 10,000개를 띄우면 고루틴 45,000개가 되는데 여전히 문제없을까요?
고루틴 45,000개의 유저 연속 스택 총합은 약 711 MiB(`45,000 × 15.8 KB`)에 불과하여 현대 64비트 서버의 물리 RAM 용량 관점에서는 전혀 문제가 없습니다. 그러나 진짜 한계는 고루틴 스택 메모리가 아니라 **CRI Unix Domain Socket 통신 한계와 컨테이너 런타임(`containerd`)의 cgroup/이벤트 처리 병목, 그리고 Linux 커널의 PID/Namespace 자원 상한선**에서 발생합니다. 이 때문에 쿠버네티스는 노드당 파드 수(`MaxPods`)를 표준 110개(고밀도 설정 시에도 250개)로 엄격히 제한하고 있습니다

### Q2. `newproc`으로 고루틴을 스폰할 때 `_p_.gFree` 풀에서 빈 구조체를 재활용하면, 스택 메모리에 이전 고루틴의 잔여 데이터가 남아서 보안이나 버그 문제를 일으키지 않나요?
Go 런타임은 `g` 구조체를 재활용할 때 스택 메모리를 통째로 0(`memclrNoHeapPointers`)으로 지우거나 초기화하지는 않습니다. 대신 고루틴 스케줄러가 새 고루틴을 실행할 때 스택 포인터(`sched.sp`)를 정확히 스택 프레임 시작점(기준선)으로 재설정하고, 함수 호출이 일어날 때마다 프레임 크기만큼 덮어쓰며 변수를 당장 필요한 범위 내에서만 적재합니다. 또한 Go 컴파일러는 포인터 탈출 분석(`Escape Analysis`)과 스택 프레임 정화 규칙을 통해 이전 프레임의 유효하지 않은 포인터가 GC 마킹에 노출되거나 유저 코드에 접근되는 것을 차단합니다

### Q3. Evented PLEG가 1초 폴링의 부하를 300배 줄여주는데, 왜 v1.26에 도입된 이후 v1.36.1 현재까지도 여전히 Alpha(기본 비활성) 상태에 머물러 있나요?
Evented PLEG는 커널 cgroup 이벤트와 컨테이너 런타임의 비동기 알림 스트림(`GetContainerEvents`)에 전적으로 의존합니다. 만약 높은 부하 상황에서 CRI 소켓 버퍼가 가득 차거나 노드 하이퍼바이저 지연으로 이벤트 패킷이 단 하나라도 누락(`Dropped Event`)되면, `kubelet`은 해당 파드가 죽거나 재시작된 사실을 백업 폴링 주기인 300초 동안 전혀 알지 못하는 치명적인 상태 불일치를 겪게 됩니다. 모든 컨테이너 런타임과 커널 버전에서 100% 이벤트 전달 보장(`Delivery Guarantee`)을 입증하기가 까다로워 안전망을 중시하는 쿠버네티스 코어 팀이 신중하게 Alpha 상태를 유지하고 있습니다

### Q4. `managePodLoop`가 아니라 `podWorkerLoop`가 실제 함수 이름이라면, 파드 상태 업데이트를 큐잉하고 전달하는 주체는 누구인가요?
`podWorkers` 구조체 내부에는 파드별로 최신 상태 변경 요청을 보관하는 내부 상태 맵과 큐(`podSyncStatuses`)가 존재합니다. PLEG 루프나 API 서버 Sync 이벤트가 도달하면 `UpdatePod` 메서드가 호출되어 변경 사항을 큐에 덮어쓰고, 파드 전용 알림 채널(`outCh <-chan struct{}`)로 1바이트 신호를 보냅니다. 대기 중이던 `podWorkerLoop` 고루틴이 이 신호를 받아 깬 뒤 `startPodSync`를 호출하여 큐에서 최신 업데이트 작업(`WorkType`)을 꺼내 실행합니다

### Q5. 유휴 API 서버(`kube-apiserver`)가 혼자서 고루틴 2,390개를 띄우고 있는 것은 왜 문제 되지 않나요?
API 서버는 클러스터 내 모든 노드의 `kubelet`, 컨트롤러 매니저, 스케줄러 등이 연결한 수천 개의 HTTP/2 및 gRPC 장기 연결(`Watch` 스트림 등)을 동시에 유지해야 합니다. 2,390개의 고루틴 대부분은 네트워크 소켓에서 데이터 도달을 기다리며 `_Gwaiting`(`gopark`) 상태로 잠들어 있습니다. Go의 M:N 스케줄링 덕분에 이 2,390개의 고루틴이 차지하는 스택 메모리는 17.4 MiB에 불과하며, 런타임 OS 스레드는 단 몇 개만 활성화되어 있으므로 CPU 사이클이나 CFS 런큐를 거의 소모하지 않습니다

---

## 핵심 요약

- **1:1 파드 고루틴 물량전 (`podWorkerLoop`)**: `kubelet`은 스레드 풀 대신 파드마다 독립 고루틴을 1:1로 배정하여 특정 파드의 스토리지/I/O 지연이 타 파드의 생명주기 루프를 차단하는 스태베이션을 방지합니다
- **15.8 KB 실효 연속 스택의 물리 원가**: 고루틴은 2 KB 프레임에서 시작해 CRI 호출 프레임이 쌓여도 평균 15.8 KB 스택만 차지하므로, 500개 동시성 주체가 활성화되어도 유저 스택 총합은 약 7.9 MiB에 수렴합니다
- **1:1 OS 스레드였을 때의 가상화·커널 세금**: 스레드 500개를 띄우면 불변 커널 스택(`16 KB`) 상주 외에도 500개 VMA 파편화와 4단계 페이지 테이블(`PTE/TLB`) 분열, CFS 런큐 스핀락 경합이라는 무거운 OS 세금을 치러야 합니다
- **`sudog` 프록시를 통한 수면과 고속 깨우기**: 이벤트 부재 시 고루틴은 `sudog` 대기열에 엮여 `_Gwaiting` 수면 상태(`gopark`)로 진입하고, 이벤트 도달 시 논리 코어 `P`의 1-슬롯 고속 캐시인 `runnext`로 즉각 깨어납니다(`goready`)
- **pprof 실측으로 규명된 4~4.5개 증가 법칙**: 파드 1개 추가 시 메인 `podWorkerLoop` 1개, liveness/readiness/startup 프로브 워커 `worker.run` 1~3개, 그리고 상태/이벤트 보조 고루틴이 동반 스폰되어 정확한 비례 기울기를 형성합니다
- **PLEG 1초 폴링 부하와 Evented PLEG의 300초 비동기 우회**: 기본 `Generic PLEG`는 1초마다 전수 조사를 벌이며 gRPC 역직렬화와 GC 마킹 폭풍을 유발하지만, `Evented PLEG`(Alpha)는 커널 알림(`cgroup/exit`) 기반 비동기 푸시 스트림으로 폴링 주기를 300초로 늦춥니다

---

다음 편([27편: API Server Watch 팬아웃 병목과 `sync.Pool` Victim Cache 직렬화 방어선](/essays/k8s-sync-pool-serialization))에서는 `kube-apiserver`가 N명의 Watcher 연결에게 이벤트를 전파할 때 메모리 복제 비용을 0으로 억제하는 두 번째 아키텍처 우회로, **`sync.Pool` Victim Cache 2단계 수명과 `cachingObject`의 단 1회 0-Copy 직렬화 기전**을 해부합니다
