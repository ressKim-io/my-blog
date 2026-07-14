---
title: "왜 Go 파드는 GC가 돌기도 전에 죽을까 — 커널의 회계와 런타임의 회계"
excerpt: "컨테이너에 512MiB를 주고 Go 서비스를 띄웠습니다. 라이브 집합은 300MiB, GC의 다음 수집 목표는 562MiB. 커널이 죽이는 선은 512MiB입니다. GC가 '이제 수집할 때'라고 느끼기 전에 커널이 먼저 SIGKILL을 보냅니다. 이번 편은 그 50MiB의 간극을 도커 컨테이너 안에서 직접 재현하고, 커널이 실제로 무엇을 합산하는지 memory.stat으로 열어 봅니다"
category: runtime
tags:
  - go
  - java
  - rust
  - kubernetes
  - cgroup
  - container
series:
  name: "kernel-runtime-tradeoffs"
  order: 18
date: "2026-07-13"
---

> **시리즈 "커널과 런타임으로 톺아보는 Rust · Go · Java"의 18편 — 5부를 엽니다**
> [17편](/essays/gc-cost-conservation-no-silver-bullet)에서 4부를 닫으며 "이 청구서들이 클러스터로 새어 나가는 지점"을 예고했습니다
> 5부는 같은 이야기를 한 층 위에서 다시 봅니다. 무대가 프로세스에서 **컨테이너와 노드**로 바뀝니다
> 첫 편의 명제는 하나입니다. **파드에 준 메모리 한도와 런타임이 스스로 잡는 힙 크기는 서로 다른 층위의 숫자이고, 이 둘을 잇는 다리를 언어마다 다르게 놨습니다**

이번 편의 수치는 전부 **도커 컨테이너 안에서** 직접 잰 것입니다. 커널 6.8 · cgroup v2 · JDK 25.0.3 · Go 1.26.5

## 한도를 적으면 커널의 무엇이 바뀌나

쿠버네티스 매니페스트에 `limits.memory: 512Mi`라고 적는 일이 리눅스에서 정확히 무엇이 되는지부터 봅니다

### cgroup — 컨테이너를 지탱하는 계량기

**cgroup(control group)** 은 리눅스 커널이 프로세스 무리를 하나로 묶어 자원을 계량하고 제한하는 장치입니다

컨테이너를 한 줄로 정의하면 **네임스페이스(격리) + cgroup(제한)** 입니다. 도커든 쿠버네티스든, 한도를 거는 일은 결국 cgroup 파일에 숫자를 쓰는 일로 귀결됩니다

2026년 현재 리눅스는 **cgroup v2(unified hierarchy)** 가 표준입니다. 512MiB를 건 컨테이너에 들어가 직접 확인해 보겠습니다

```bash
docker run --rm --memory=512m alpine sh -c '
  cat /sys/fs/cgroup/cgroup.controllers
  echo "memory.max     = $(cat /sys/fs/cgroup/memory.max)"
  echo "memory.high    = $(cat /sys/fs/cgroup/memory.high)"
  echo "memory.current = $(cat /sys/fs/cgroup/memory.current)"
'
```

```text
cpuset cpu io memory hugetlb pids rdma misc
memory.max     = 536870912
memory.high    = max
memory.current = 1163264
```

`536870912`는 정확히 512 × 1024²입니다. 매니페스트의 `limits.memory`가 그대로 **`memory.max`** 라는 파일 하나로 내려앉았습니다

세 파일의 역할이 갈립니다

**`memory.max`** 는 하드 한도입니다. 넘으면 죽습니다

**`memory.high`** 는 소프트 한도입니다. 넘으면 커널이 회수 압력을 강하게 걸어 할당을 느리게 만들지만 죽이지는 않습니다. 위 출력에서 `max`, 즉 설정되지 않았죠. 쿠버네티스는 기본적으로 이걸 안 씁니다

**`memory.current`** 는 지금 이 순간 커널이 이 cgroup에 청구한 총량입니다. `kubectl top`이나 `docker stats`에서 보는 숫자의 뿌리입니다

## 커널은 '힙'을 모릅니다. '페이지'를 셉니다

여기가 5부 전체의 주춧돌입니다

개발자가 흔히 하는 착각이 "내 메모리 사용량 = 내 힙"입니다. 커널의 회계는 그렇지 않습니다

커널은 언어의 '힙'이라는 개념 자체를 모릅니다. 커널이 아는 건 **페이지(page, 보통 4KiB)** 뿐이고, 이 프로세스 무리가 만지는 모든 종류의 페이지를 합산합니다

![The kernel charges every kind of page to one bill; the heap is only part of one column](/diagrams/container-memory-accounting-cgroup-1.svg)

그림 가운데의 큰 상자가 커널이 청구하는 총액, 즉 `memory.current`입니다

그 안에 세로 기둥이 여럿 서 있습니다. 왼쪽 첫 기둥 **anon**(익명 페이지)이 우리가 아는 힙과 스택입니다. 언어 런타임의 힙은 **이 기둥의 일부일 뿐**입니다

나머지 기둥이 문제입니다. **file**은 페이지 캐시로, 읽은 파일과 메모리에 올린 공유 라이브러리(`.so`)가 여기 잡힙니다. **kernel**은 슬랩(커널이 자기 자료구조를 담는 할당자)·페이지 테이블·커널 스택입니다. **sock**은 소켓 송수신 버퍼, **shmem**은 공유 메모리와 `/dev/shm` 같은 tmpfs입니다

런타임이 "내 힙은 200MB입니다"라고 말해도, 커널이 세는 건 이 기둥 전부입니다

### 그래서 실제로 재 보면

말로만 하면 와닿지 않으니 컨테이너 안에서 `memory.stat`을 열어 보겠습니다. 아무 일도 안 하는 알파인 셸 하나입니다

```bash
docker run --rm --memory=512m alpine \
  grep -E '^(anon|file|kernel|kernel_stack|pagetables|percpu|sock|shmem|slab) ' \
  /sys/fs/cgroup/memory.stat
```

```text
anon 122880
file 0
kernel 1134592
kernel_stack 32768
pagetables 90112
percpu 2232
sock 0
shmem 0
slab 352384
```

`anon`이 122,880바이트, 즉 **120KiB**입니다. 우리가 "메모리 사용량"이라 부르는 그 값이죠

그런데 `kernel`이 1,134,592바이트, **1.08MiB**입니다. 익명 메모리의 **9배**입니다

셸 하나 띄웠을 뿐인데 커널이 이 컨테이너를 위해 쓰는 살림(페이지 테이블 88KiB, 커널 스택 32KiB, 슬랩 344KiB)이 정작 프로그램의 힙보다 훨씬 큽니다

물론 실제 애플리케이션이 뜨면 `anon`이 압도적으로 커집니다. 요점은 비율이 아니라 **이 기둥들이 전부 같은 장부에 오른다**는 사실입니다. "힙은 작은데 RSS가 크다"의 범인을 찾을 때 가장 먼저 열어야 할 파일이 `memory.stat`인 이유입니다

한 가지 완충 장치는 있습니다. `file`(페이지 캐시) 중 **깨끗한(clean) 페이지**, 즉 디스크와 내용이 같아 언제든 다시 읽어 올 수 있는 페이지는 버려도 됩니다. 그래서 한도에 근접하면 커널이 먼저 이걸 회수합니다

반면 `anon`은 함부로 못 버립니다. 스왑이 없으면(컨테이너는 보통 스왑을 끕니다) **회수할 방법이 아예 없고**, 이게 OOM의 직접 원인이 됩니다

## 한도를 넘으면 무슨 일이 벌어지나

`memory.max`를 넘어서는 할당이 일어나면 커널은 정해진 순서를 밟습니다

![Over the limit: reclaim first, then SIGKILL — exit 137](/diagrams/container-memory-accounting-cgroup-2.svg)

그림 위쪽에서 시작합니다. 할당 요청이 들어오고, `memory.current`가 `memory.max`를 넘길 참입니다

**왼쪽 갈래는 직접 회수(direct reclaim)** 입니다. 커널이 깨끗한 페이지 캐시를 버리고 회수 가능한 슬랩을 줄입니다. 여유가 나면 할당은 성공합니다. 다만 이 회수 작업은 **할당을 요청한 스레드가 직접 수행**하므로, 그 지연이 그대로 응답 시간의 꼬리로 새어 나갑니다

**오른쪽 갈래는 OOM kill입니다.** 회수해도 부족하면 cgroup OOM killer가 이 cgroup 안의 프로세스에 **`SIGKILL`(시그널 9)** 을 보냅니다. 종료 코드는 **137**이 되는데, 유닉스 관례상 시그널로 죽은 프로세스의 종료 코드가 `128 + 시그널 번호`이기 때문입니다. 128 + 9 = 137이죠

직접 재현해 보겠습니다. 512MiB 컨테이너에서 1GiB짜리 바이트 배열을 잡습니다

```bash
docker run --memory=512m --name oomtest python:3-alpine \
  python3 -c "x = bytearray(1024*1024*1024); print('할당 성공')"

docker inspect oomtest --format 'ExitCode={{.State.ExitCode}} OOMKilled={{.State.OOMKilled}}'
```

```text
ExitCode=137  OOMKilled=true
```

"할당 성공"은 찍히지 않았습니다. 그리고 파이썬의 `MemoryError`도 나오지 않았습니다

**SIGKILL은 잡을 수도, 무시할 수도 없습니다.** 런타임에게는 예외를 던질 기회조차 주어지지 않습니다. 이 구분이 5부 내내 따라다니고, 3편 뒤에서 "GC 로그는 깨끗한데 파드가 죽는다"의 정체가 됩니다

커널 쪽 증거는 `memory.events`에 남습니다

```bash
docker run --rm --memory=256m python:3-alpine sh -c \
  'python3 -c "x = bytearray(512*1024*1024)"; cat /sys/fs/cgroup/memory.events'
```

```text
Killed
low 0
high 0
max 35
oom 1
oom_kill 1
oom_group_kill 0
```

`max 35`는 한도에 부딪혀 회수를 시도한 횟수, `oom_kill 1`은 실제로 죽인 횟수입니다. OOMKilled 알람을 받았을 때 가장 먼저 확인할 카운터입니다

### 압축 가능한 자원과 그렇지 않은 자원

여기서 쿠버네티스의 대전제 하나가 나옵니다

CPU 한도를 넘으면 커널은 그냥 **스로틀**, 즉 늦춰서 버팁니다. 프로세스는 삽니다. 느려질 뿐이죠

메모리 한도를 넘으면 늦출 방법이 없습니다. 그래서 **죽입니다**

메모리는 **압축 불가능한(incompressible) 자원**입니다. 이 비대칭이 5부 전체의 리듬을 정합니다. **CPU 초과는 느려짐, 메모리 초과는 죽음**

매니페스트의 네 필드가 cgroup의 무엇이 되는지 정리하면 이렇습니다

| 쿠버네티스 필드 | 의미 | cgroup v2로 내려가는 곳 | 초과 시 |
|---|---|---|---|
| `requests.memory` | 스케줄링 보증 | (스케줄러 계산용, 직접 강제 아님) | — |
| `limits.memory` | 절대 상한 | `memory.max` | **OOMKilled** |
| `requests.cpu` | CPU 배분 가중치 | `cpu.weight` | (경합 시 비율 배분) |
| `limits.cpu` | CPU 상한 | `cpu.max` | **스로틀** |

이 표가 다음 편(빈패킹)의 출발점입니다. **스케줄러는 `requests`를 보고 노드에 파드를 채우고, 커널은 `limits`를 보고 죽일지 말지를 정합니다.** 두 숫자가 서로 다른 주체를 향하고 있다는 사실이 곧 비용이 됩니다

## 런타임은 컨테이너를 어떻게 (못) 보나

이제 반대쪽입니다. 커널의 회계는 봤으니, 런타임이 그 회계를 아는지를 봅니다

### 뿌리 — 런타임은 원래 기계 전체가 제 것인 줄 알았습니다

JVM도 Go 런타임도 태생은 "물리 서버 한 대 위에서 내가 주인"이라는 세계관입니다

그래서 가용 메모리를 알아낼 땐 `/proc/meminfo`를, CPU 개수를 알아낼 땐 `sched_getaffinity`를 봤습니다. 문제는 이 값들이 **컨테이너 안에서도 여전히 호스트(노드)의 숫자**를 반환한다는 것입니다

노드가 64GiB·32코어면, 512MiB·0.5코어짜리 파드 안의 런타임도 "나 64GiB에 32코어 쓸 수 있네"라고 착각합니다

대가는 둘로 나뉩니다. 메모리 쪽에서는 힙을 노드 크기 기준으로 크게 잡아 한도를 순식간에 넘기고, CPU 쪽에서는 GC 스레드와 스레드풀을 32개씩 만들어 0.5코어 안에서 서로 밀어냅니다

**컨테이너 인식(container awareness)** 이란 결국 이 착각을 고쳐, 런타임이 `/proc/meminfo` 대신 **cgroup 한도**를 읽게 만드는 일입니다

### JVM — CPU도 메모리도 자동으로 읽습니다

핫스팟 JVM은 `-XX:+UseContainerSupport`가 기본값이고, 켜져 있으면 부팅 시 cgroup을 감지해 CPU와 메모리 한도를 둘 다 읽습니다

512MiB·2코어 컨테이너 안에서 감지 로그를 찍어 봤습니다

```bash
docker run --rm --memory=512m --cpus=2 eclipse-temurin:25-jdk \
  java -Xlog:os+container=trace -version
```

```text
[os,container] Detected cgroups v2 unified hierarchy
[os,container] Path to /cpu.max is /sys/fs/cgroup/cpu.max
[os,container] OSContainer::active_processor_count: 2
[os,container] Path to /memory.max is /sys/fs/cgroup/memory.max
[os,container] Memory Limit is: 536870912
```

JVM이 `memory.max`를 직접 읽어 **536870912**를 자기가 아는 물리 메모리로 삼았습니다. 그리고 `cpu.max`에서 실효 코어 2개를 계산했죠

그다음 이 값으로 힙 상한을 정합니다. 같은 컨테이너에서 결과를 보면

```bash
docker run --rm --memory=512m --cpus=2 eclipse-temurin:25-jdk \
  java -XX:+PrintFlagsFinal -version | grep MaxHeapSize
```

```text
size_t MaxHeapSize = 134217728  {product} {ergonomic}
```

134,217,728바이트 = **128MiB**입니다. 한도 512MiB의 정확히 25%죠

`{ergonomic}`이라는 표시가 붙어 있습니다. 사람이 준 값이 아니라 **JVM이 컨테이너를 보고 스스로 계산했다**는 뜻입니다

### 그런데 이 25%가 늘 25%가 아닙니다

여기서 흔히 아는 규칙이 깨집니다

교과서적 설명은 이렇습니다. 힙 상한 = `memory.max` × `MaxRAMPercentage`(기본 25%). 다만 컨테이너가 아주 작으면 `MinRAMPercentage`(기본 50%)로 갈아탄다

기본값 자체는 맞습니다. JDK 25.0.3에서 확인하면 `MaxRAMPercentage=25.0`, `MinRAMPercentage=50.0`, `InitialRAMPercentage=1.5625`입니다

문제는 **"아주 작으면"의 경계**입니다. 컨테이너 크기를 촘촘히 바꿔 가며 힙이 어떻게 잡히는지 재 봤습니다

| 컨테이너 메모리 | 산정된 힙 | 한도 대비 |
|---|---|---|
| 2 GiB | 512 MiB | 25.0% |
| 1 GiB | 256 MiB | 25.0% |
| 700 MiB | 176 MiB | 25.1% |
| 600 MiB | 152 MiB | 25.3% |
| **512 MiB** | **128 MiB** | **25.0%** |
| **500 MiB** | **128 MiB** | 25.6% |
| **400 MiB** | **128 MiB** | 32.0% |
| **300 MiB** | **128 MiB** | **42.6%** |
| **250 MiB** | **128 MiB** | 51.2% |
| 240 MiB | 120 MiB | 50.0% |
| 128 MiB | 64 MiB | 50.0% |

굵게 표시한 구간을 보십시오. **250MiB부터 512MiB까지, 컨테이너 크기가 두 배 넘게 차이 나는데 힙은 전부 128MiB로 똑같습니다**

25%도 아니고 50%도 아닙니다. 300MiB 파드의 힙은 한도의 **42.6%** 입니다

![The heap floor flattens the 25% rule between 250 and 512 MiB](/diagrams/container-memory-accounting-cgroup-3.svg)

그림의 가로축이 컨테이너 메모리, 세로축이 산정된 힙입니다

**오른쪽 기울어진 직선**이 우리가 아는 25% 규칙입니다. 컨테이너가 커질수록 힙도 비례해 커지죠

**가운데 평평한 구간**이 방금 발견한 그 구간입니다. 힙이 128MiB에 붙박여 움직이지 않습니다

**왼쪽 기울어진 직선**이 50% 규칙(`MinRAMPercentage`)입니다

평평한 구간의 정체는 **바닥(floor)** 입니다. 핫스팟에는 에르고노믹이 개입하기 전의 기본 `MaxHeapSize`가 있고, 64비트에서 이 값이 대략 **124.8MiB**(96MiB에 워드 크기 보정 1.3배)입니다. 힙 정렬까지 거치면 128MiB가 되죠

JVM의 산정 규칙을 실측 곡선에서 되짚으면 이렇게 읽힙니다. 컨테이너의 50%가 저 바닥보다 작으면 50%를 쓰고, 그렇지 않으면 **25%와 바닥 중 큰 쪽**을 씁니다. 그래서 25%가 바닥보다 작아지는 구간(대략 250~500MiB)에서는 바닥이 이기고, 힙이 128MiB에 고정됩니다

이게 왜 중요한가 하면, **작은 파드일수록 힙이 한도에서 차지하는 비중이 조용히 커지기 때문**입니다

300MiB 파드에 힙 128MiB를 주면 남는 건 172MiB뿐입니다. 그 172MiB로 Metaspace·코드 캐시·스레드 스택·다이렉트 버퍼·페이지 캐시를 전부 감당해야 합니다. 3편 뒤에서 볼 텐데, **아무 일도 안 하는 JVM이 이미 힙 밖으로 60MiB 넘게 씁니다**

그래서 "기본값 25%는 너무 보수적이니 올려라"는 흔한 조언은 **큰 컨테이너에서만 참**입니다. 작은 컨테이너에서는 이미 42%, 51%를 쓰고 있으니까요

바닥을 벗어나고 싶으면 비율을 명시하면 됩니다. 같은 300MiB 컨테이너에서

| `MaxRAMPercentage` | 산정된 힙 |
|---|---|
| 25 (기본) | 128 MiB (42.6%) |
| 50 | 152 MiB (50.6%) |
| 75 | 232 MiB (77.3%) |

비율을 올리면 바닥을 넘어서므로 정상적으로 작동합니다

> **버전 함정 하나** — 커널 6.12에서 일부 컨트롤러가 cgroup v1에서 v2로 옮겨 가면서, 예전 JDK가 컨테이너 메모리 한도를 못 읽고 호스트 값으로 폴백해 OOM이 나는 사례가 보고됐습니다. 이 감지 버그는 **JDK 25에서 수정**됐습니다(OpenJDK 이슈 JDK-8348566). "잘 되던 파드가 커널 올리고 나서 죽더라"의 전형적 배경입니다

CPU도 같은 방식입니다. `UseContainerSupport`는 `cpu.max`를 읽어 실효 코어 수를 계산하고, 이 값이 **GC 병렬 스레드 수**·**JIT 컴파일러 스레드 수**·`ForkJoinPool.commonPool` 병렬도까지 연쇄적으로 정합니다. [15편](/essays/java-g1-region-full-gc-cliff)에서 "GC 스레드 수는 코어 수에서 파생된다"고 했던 그 코어 수가, 컨테이너에선 이 실효 코어 수입니다

### Go — CPU는 배웠고, 메모리는 아직입니다

Go는 최근에야, 그리고 **절반만** 컨테이너를 배웠습니다. 이 비대칭이 이번 편에서 가장 중요한 사실입니다

**CPU 쪽은 배웠습니다.** Go 1.25부터 런타임이 cgroup의 CPU 한도를 자동 인식해 `GOMAXPROCS`를 정합니다. `cpu.max`를 읽어 실효 CPU를 계산하고, 그 값이 머신 코어 수보다 작으면 거기에 맞춥니다. 한도가 바뀌면 주기적으로 다시 읽어 갱신하고요

**메모리 쪽은 아직입니다.** `GOMEMLIMIT`(소프트 메모리 한도, 1.19+)은 cgroup을 자동으로 읽지 않습니다

이건 추측이 아니라 소스에서 확인할 수 있습니다. Go 1.26.5의 런타임을 뒤져 보면

```bash
GOROOT=$(go env GOROOT)
grep -c "memory.max\|memory.limit_in_bytes" -r $GOROOT/src/runtime/
grep -n "func " $GOROOT/src/runtime/cgroup_linux.go
grep -n "containermaxprocs\|cgroupmemlimit" $GOROOT/src/internal/godebugs/table.go
```

```text
0

45:func defaultGOMAXPROCSInit() {
75:func defaultGOMAXPROCSUpdateGODEBUG() {
85:func defaultGOMAXPROCS(ncpu int32) int32 {
109:func adjustCgroupGOMAXPROCS(procs int32, cpu cgroup.CPU) int32 {

31:	{Name: "containermaxprocs", Package: "runtime", Changed: 25, Old: "0"},
```

세 가지가 한꺼번에 확인됩니다

런타임 전체에서 `memory.max`라는 문자열이 **0건**입니다. cgroup 전용 파일인 `cgroup_linux.go`에는 **GOMAXPROCS 함수만** 있습니다. godebug 목록에는 `containermaxprocs`(Go 1.25에서 도입)만 있고 메모리에 해당하는 항목이 없습니다

**Go 런타임은 컨테이너의 메모리 한도를 읽지 않습니다.** 읽는 코드가 아예 없습니다

그래서 `GOMEMLIMIT`을 명시하지 않으면 기본값이 사실상 무제한입니다. 컨테이너 안에서 직접 찍어 보면

```text
GOMEMLIMIT=9223372036854775807  GOGC=100
```

9223372036854775807은 `math.MaxInt64`입니다. 한도 같은 건 없다는 뜻이죠. GC는 오직 `GOGC=100` 규칙, 즉 "힙이 라이브의 2배가 되면 수집"만으로 돕니다

### 그래서 무슨 일이 벌어지나 — 직접 죽여 봤습니다

말로 하면 추상적이니 재현하겠습니다

라이브 집합 300MiB를 계속 붙들고 그 위에서 쓰레기를 만드는 Go 프로그램을, **512MiB 컨테이너**에 넣습니다

```go
live := make([][]byte, 0, 300)
for i := 0; i < 300; i++ {
	b := make([]byte, 1<<20)
	touch(b)               // 페이지를 실제로 만진다
	live = append(live, b) // 300MiB를 계속 붙들고 있는다
}

for round := 1; round <= 30; round++ {
	for i := 0; i < 100; i++ {
		b := make([]byte, 1<<20)
		touch(b) // 즉시 버려질 쓰레기
	}
	runtime.ReadMemStats(&ms)
	fmt.Printf("round %2d  힙 %4d MiB  다음GC목표 %4d MiB  GC %d회\n",
		round, ms.HeapInuse>>20, ms.NextGC>>20, ms.NumGC)
}
```

`GOMEMLIMIT` 없이 돌린 결과입니다

```text
GOMEMLIMIT=9223372036854775807  GOGC=100
라이브 집합 300MiB 확보. 이제 쓰레기를 만든다
round  1  힙  400 MiB  다음GC목표  562 MiB  GC 7회
round  2  힙  500 MiB  다음GC목표  562 MiB  GC 7회

ExitCode=137  OOMKilled=true
```

두 줄 만에 죽었습니다. 그리고 **죽은 이유가 로그에 그대로 적혀 있습니다**

**다음 GC 목표가 562MiB입니다. 컨테이너 한도는 512MiB입니다**

![The GC's next target sits above the kernel's kill line](/diagrams/container-memory-accounting-cgroup-4.svg)

그림의 세로축이 메모리입니다

**아래쪽 파란 띠**가 라이브 집합 300MiB입니다. 실제로 살아 있는 객체죠

**그 위 회색 띠**가 GC가 수집을 시작하기 전까지 허용하는 여유입니다. `GOGC=100`이라 라이브의 2배까지 자라도록 두므로, GC의 다음 목표는 562MiB 언저리에 찍힙니다

**빨간 가로선**이 커널이 죽이는 선, `memory.max` = 512MiB입니다

**GC의 목표선이 커널의 처형선보다 위에 있습니다.** 그래서 힙이 512를 넘는 순간, GC가 "이제 수집할 때"라고 느끼기도 전에 커널이 먼저 `SIGKILL`을 보냅니다

[17편](/essays/gc-cost-conservation-no-silver-bullet)에서 "할당이 싸구려인 대가는 GC로 청구된다"고 했습니다. 컨테이너에서는 그 청구서가 **GC가 아니라 커널의 OOM killer** 앞으로 날아옵니다

### `GOMEMLIMIT` 하나를 넣으면

똑같은 프로그램, 똑같은 512MiB 컨테이너에 `GOMEMLIMIT=450MiB`만 추가합니다

```text
GOMEMLIMIT=471859200  GOGC=100
round  1  힙  400 MiB  다음GC목표  431 MiB  GC 7회
round  2  힙  373 MiB  다음GC목표  431 MiB  GC 8회
...
round 29  힙  318 MiB  다음GC목표  431 MiB  GC 435회
round 30  힙  418 MiB  다음GC목표  431 MiB  GC 435회
살아남았습니다

ExitCode=0  OOMKilled=false
```

살아남았습니다. 다음 GC 목표가 562에서 **431MiB로 눌렸고**, 한도 아래에 머물렀습니다

그런데 공짜가 아닙니다. **GC가 7회에서 435회로 늘었습니다**

`gctrace`로 그 대가를 보면 명확합니다

| | `GOMEMLIMIT` 미설정 | `GOMEMLIMIT=450MiB` |
|---|---|---|
| 결과 | **exit 137, OOMKilled** | 살아남음 |
| GC 횟수 | 7회 | **435회** |
| GC가 쓴 CPU | **0%** | **6%** |
| 다음 GC 목표 | 562 MiB (한도 초과) | 431 MiB |

`gctrace` 원문에서 각 줄 앞의 백분율이 GC가 가져간 CPU 비중입니다. 미설정 쪽은 `gc 7 @0.046s 0%`, 설정한 쪽은 `gc 278 @0.292s 6%`였습니다

**메모리를 한도 안에 묶는 값을 CPU 6%로 치렀습니다.** 4부에서 본 "메모리 여유 ↔ GC 빈도" 교환이, 컨테이너에서는 정확히 이렇게 청구됩니다. 비용은 사라지지 않고 옮겨 갔습니다

### 아직 채택되지 않은 자동화

이걸 런타임 기본값으로 만들자는 제안이 논의 중입니다(golang/go 이슈 #75164). `GOMAXPROCS` 방식을 그대로 본떠, `GODEBUG=cgroupmemlimit`으로 켜고 한도의 90%(최소 100MB)를 `GOMEMLIMIT`으로 잡자는 안입니다

2026년 7월 현재 이 제안은 **여전히 열려 있고, 어느 릴리스에도 들어가지 않았습니다.** 그러니 지금은 사람이 넣어야 합니다

### Rust — 이 질문 자체가 없습니다

Rust에는 GC가 없고 런타임도 없으니 "힙을 얼마로 잡을까"라는 질문이 성립하지 않습니다

메모리 수명은 소유권으로 이미 컴파일 타임에 결정돼 있고, 상한 관리는 애플리케이션의 몫입니다. 컨테이너 한도를 넘게 할당하면 Rust 프로세스도 물론 OOM-kill 당합니다. 다만 그건 **런타임이 조절할 손잡이가 없어서**가 아니라, 애초에 그런 손잡이가 있을 자리가 없기 때문입니다. 할당 지점이 코드에 드러나 있으니 사람이 제어합니다

CPU 쪽은 흥미롭게도 표준 라이브러리가 컨테이너를 꽤 인식합니다. [2편](/essays/thread-models-kernel-vs-user)에서 확인했듯 `std::thread::available_parallelism()`은 cgroup v2의 CPU 쿼터를 반영합니다

다만 이건 **정확한 숫자를 알려 주는 함수**일 뿐입니다. 그 숫자를 읽어 스레드풀을 몇 개로 잡을지는 `tokio`·`rayon` 같은 라이브러리와 개발자의 결정입니다. "런타임이 알아서"가 아니라 "라이브러리에게 정확한 숫자를 넘겨줄 준비는 돼 있다"는 쪽이죠

## 만지지 않은 페이지는 메모리가 아닙니다

위 Go 실험을 만들면서 함정 하나에 빠졌는데, 이게 5부를 관통하는 개념이라 짚고 갑니다

처음 쓴 데모는 슬라이스를 할당만 하고 **아무것도 쓰지 않았습니다**

```go
_ = make([]byte, 1<<20) // 할당만 하고 만지지 않음
```

이 프로그램은 힙이 **8300MiB까지 자라는 동안 512MiB 컨테이너에서 멀쩡히 살아 있었습니다.** Go의 `MemStats`는 8300MiB를 보고하는데 커널은 죽이지 않았습니다

이유는 [8편](/essays/kernel-lazy-allocation-page-fault)에서 본 그대로입니다

Go는 `mmap`으로 갓 받아 온 영역이 이미 0으로 채워져 있다는 걸 알기 때문에, 새 span에 대해서는 **memset을 건너뜁니다.** 그리고 제 프로그램이 그 슬라이스에 아무것도 안 썼으니 **페이지가 한 번도 접촉되지 않았습니다**

접촉되지 않은 페이지에는 물리 프레임이 배정되지 않습니다. **커널의 회계에 오르는 건 만진 페이지뿐입니다**

![Reserved address space costs nothing; only touched pages become physical](/diagrams/container-memory-accounting-cgroup-5.svg)

그림 왼쪽이 프로세스가 확보한 **가상 주소 공간**입니다. 넓지만 대부분 비어 있습니다

오른쪽이 **물리 메모리**이고, 두 공간을 잇는 화살표는 **실제로 접촉된 페이지에만** 걸립니다

커널이 `memory.current`에 청구하는 건 오른쪽뿐입니다

그래서 `touch()`를 넣어 페이지를 실제로 만지게 하자 비로소 죽었습니다. 이 구분(**예약 vs 접촉**)이 3편 뒤에서 "가상 메모리는 몇 GB인데 왜 안 죽지?"라는 질문의 답이 됩니다

## 세 언어 수렴 — CPU 인식과 메모리 인식은 다른 문제입니다

같은 질문("컨테이너 한도를 런타임이 아는가")을 세 언어에 던지면 이렇게 갈립니다

![CPU awareness landed everywhere; memory awareness did not](/diagrams/container-memory-accounting-cgroup-6.svg)

| | CPU 한도 인식 | 메모리 한도 인식 | 회계의 층위 |
|---|---|---|---|
| **Rust** | `available_parallelism()`이 cgroup 쿼터 반영(힌트). 스레드풀은 tokio·rayon 몫 | GC가 없어 "힙 크기" 질문 자체가 없음 | 라이브러리·앱 |
| **Go** | `GOMAXPROCS` 자동(1.25+) | `GOMEMLIMIT` **수동** — 1.26에도 cgroup 자동 아님 | 런타임(반쪽) |
| **Java** | `ActiveProcessorCount` 자동 | `MaxRAMPercentage`로 힙 자동 산정 | 런타임(양쪽) |

세로로 읽으면 4부의 삼각형이 클라우드 축에서 다시 보입니다

**Java**는 런타임이 CPU도 메모리도 알아서 맞춥니다. 편하죠. 대신 그 자동값이 워크로드에 안 맞아도 조용히 손해를 봅니다. 방금 본 128MiB 바닥이 그 예입니다. **알아서 해 주니 안 건드리게 되는 것의 대가**입니다

**Go**는 CPU만 배운 과도기에 있습니다. `GOMAXPROCS`는 이제 믿어도 되지만 `GOMEMLIMIT`은 여전히 사람이 넣어야 합니다. 이걸 모르면 "Go는 메모리 가벼운 언어인데 왜 파드가 자꾸 죽지?"에 빠집니다. **가장 흔한 프로덕션 함정**입니다

**Rust**는 인식할 런타임 자체가 없습니다. 대신 메모리 수명이 소유권으로 결정돼 있어 애초에 폭주할 여지가 적고, CPU 병렬도는 라이브러리에 정확한 숫자를 넘겨줄 준비만 돼 있습니다. **손잡이가 없는 게 아니라, 손잡이가 코드 안에 있는 것**입니다

## 그래서 어떻게 설정하나

원칙 하나로 요약됩니다. **커널이 죽이는 선(`limits.memory`)과 런타임의 힙 손잡이는 서로 다른 숫자이고, 그 사이에 여백을 반드시 남겨야 합니다**

**JVM에서는** `-Xmx` 고정과 `MaxRAMPercentage` 비율 중에 고릅니다

`-Xmx512m`처럼 절대값을 못 박으면 컨테이너 한도와 무관하게 힙이 고정되고, `MaxRAMPercentage`를 덮어씁니다. 한도가 고정돼 있고 힙과 네이티브 비율을 손으로 정밀하게 잡고 싶을 때 씁니다

`-XX:MaxRAMPercentage=75.0`처럼 비율로 주면 `limits.memory`가 바뀌어도 자동으로 따라갑니다. 여러 파드에 같은 템플릿을 쓰거나 VPA로 한도가 변하는 환경에 맞습니다

큰 컨테이너라면 기본 25%는 보수적이니 50~75%로 올리되, 나머지를 Metaspace·코드 캐시·스레드 스택·다이렉트 버퍼 몫으로 남깁니다. **작은 컨테이너(250~500MiB)라면 이미 바닥 때문에 40~50%를 쓰고 있다는 걸 기억하고**, 올리기 전에 힙 밖을 먼저 재십시오

**Go에서는** `GOMEMLIMIT`을 명시하는 것에서 출발합니다

권장 패턴은 `GOMEMLIMIT`을 한도의 약 90%로 두고 `GOGC`는 100으로 남기는 것입니다. 그러면 평상시엔 `GOGC` 규칙으로 여유 있게 돌다가, 메모리가 한도 근처로 차오르면 `GOMEMLIMIT`이 GC를 강하게 당겨 잡아 줍니다

`GOGC=off`로 두고 `GOMEMLIMIT`만으로 모는 방식도 있지만 권하지 않습니다. 라이브 집합이 한도에 근접하면 GC가 쉼 없이 돌아 CPU를 태웁니다. 방금 본 6%가 30%, 50%가 되는 길이죠

값을 넣는 방법은 셋입니다. 매니페스트에 직접 박거나, downward API로 `limits.memory`를 환경변수로 받아 계산하거나, `automemlimit` 같은 라이브러리로 부팅 시 cgroup을 읽게 하거나. 한도가 자주 바뀌는 환경이라면 뒤의 둘이 안전합니다

## 트레이드오프 소결

한 문장으로 정리하면 이렇습니다

**커널의 메모리 회계(전부 합산)와 런타임의 힙 회계(일부만 조절)는 층위가 다르고, 이 둘을 잇는 다리를 언어마다 다르게 놨습니다**

Java는 런타임이 다리를 자동으로 놓아 줍니다. 대신 그 자동값이 최적은 아니고, 작은 컨테이너에서는 바닥이라는 함정까지 있습니다

Go는 CPU 다리만 놓고 메모리 다리는 사람에게 맡깁니다. 가장 사고가 나기 쉬운 지점이죠

Rust는 다리라는 개념 없이, 애초에 소유권으로 강을 건너 둡니다

그리고 어느 언어든 공통으로 남는 진실이 하나 있습니다. **힙을 한도에 완벽히 맞춰도, 커널이 세는 건 힙만이 아니므로 여백이 없으면 죽습니다.** 이 여백의 물리를 20편에서 해부합니다

## 더 파고들 질문

1. **`memory.stat`으로 범인 좁히기** — 파드의 `memory.current`는 한도에 붙어 있는데 애플리케이션이 보고하는 힙은 절반뿐입니다. `anon`·`file`·`slab`·`sock` 중 무엇이 부풀었는지 어떻게 좁혀 들어가겠습니까? `file`(페이지 캐시)이 큰 경우와 `anon`이 큰 경우, 대응이 어떻게 달라져야 할까요?

2. **requests와 limits를 같게 둘 것인가** — 메모리 `requests < limits`로 두면 빈패킹은 빽빽해지지만, 노드 메모리가 부족해질 때 어떤 파드가 먼저 죽습니까(QoS class: Guaranteed vs Burstable)? 안정성이 중요한 서비스에서 둘을 같게 두는 이유를 cgroup 관점에서 설명해 보십시오

3. **`GOMEMLIMIT` 주입 자동화** — VPA가 파드의 `limits.memory`를 동적으로 바꾸는 환경에서, `GOMEMLIMIT`을 매니페스트에 상수로 박아 두면 어떤 사고가 납니까? downward API·`automemlimit`·(아직 안 나온) `GODEBUG=cgroupmemlimit` 중 무엇을 택하겠습니까?

4. **CPU 스로틀과 GC의 상호작용** — `limits.cpu`로 스로틀이 걸리는 파드에서 GC 스레드가 CPU 시간을 못 얻으면 무슨 일이 벌어집니까? `GOMAXPROCS`·`ActiveProcessorCount`가 컨테이너 값으로 **줄어드는 것**이 오히려 GC 지연에 유리한 이유는 무엇일까요?

5. **작은 파드의 힙 바닥** — 같은 이미지를 128Mi·300Mi·2Gi 파드에 배포합니다. 이번 편에서 본 128MiB 바닥 때문에 300Mi 파드에서 힙 밖 여백이 얼마나 남습니까? 이 파드에 `MaxRAMPercentage`를 올리는 게 왜 위험할 수 있습니까?

6. **계측 파이프라인** — "OOMKilled가 늘었다"는 알람을 받았을 때, cgroup `memory.events`의 `oom_kill` 카운터, 커널 `dmesg`의 OOM 리포트, 쿠버네티스 이벤트, 런타임 GC 로그를 각각 어떤 순서로 확인해 원인을 "힙 초과 / 네이티브 누수 / 한도 과소설정" 중 하나로 좁히겠습니까?

## 핵심 요약

- 매니페스트의 `limits.memory: 512Mi`는 커널에서 **`memory.max = 536870912`** 이라는 파일 하나가 됩니다. 실측으로 확인했습니다
- **커널은 힙을 모르고 페이지를 셉니다.** `anon`(힙·스택) 말고도 `file`(페이지 캐시)·`kernel`(슬랩·페이지 테이블)·`sock`·`shmem`이 전부 같은 장부에 오릅니다. 아무 일도 안 하는 컨테이너에서도 커널 몫이 익명 메모리의 9배였습니다
- 한도를 넘으면 커널은 먼저 회수를 시도하고, 실패하면 **`SIGKILL`로 즉살**합니다. 종료 코드 **137**(=128+9). SIGKILL은 잡을 수 없으므로 런타임은 예외를 던질 기회조차 없습니다
- **메모리는 압축 불가능한 자원**입니다. CPU 초과는 스로틀(느려짐), 메모리 초과는 죽음. 이 비대칭이 5부의 리듬입니다
- **JVM은 CPU도 메모리도 자동 인식**합니다. 다만 힙 산정에 **128MiB 바닥**이 있어서, **250~512MiB 컨테이너는 크기와 무관하게 힙이 전부 128MiB**입니다. 300MiB 파드의 힙은 25%가 아니라 **42.6%** 입니다
- **Go 런타임은 컨테이너 메모리 한도를 읽는 코드가 아예 없습니다.** 소스 전체에서 `memory.max` 문자열이 0건이고, `GOMEMLIMIT` 기본값은 `math.MaxInt64`입니다. 자동화 제안(#75164)은 아직 채택 전입니다
- 그래서 라이브 300MiB인 Go 서비스를 512MiB 컨테이너에 넣으면 **GC의 다음 목표(562MiB)가 커널의 처형선(512MiB)보다 위**에 놓입니다. GC가 돌기 전에 죽습니다. 실제로 exit 137을 재현했습니다
- `GOMEMLIMIT=450MiB` 한 줄로 살아납니다. 대신 **GC가 7회에서 435회로 늘고 CPU 6%를 가져갑니다.** 비용은 사라지지 않고 메모리에서 CPU로 옮겨 갔습니다
- **만지지 않은 페이지는 물리 메모리가 아닙니다.** 힙이 8300MiB로 보고돼도 페이지를 접촉하지 않았다면 커널은 청구하지 않습니다. 예약과 접촉의 구분이 20편의 열쇠입니다

**[다음 편 예고]**

**19편은 빈패킹의 경제학**입니다

이번 편에서 런타임이 요구하는 메모리 **여유**가 어디서 오는지 봤습니다. Go는 `GOGC`가 만드는 라이브의 2배, JVM은 힙 밖 여백, ZGC는 복사해 넣을 빈 공간

그 여유가 그대로 파드의 `requests`와 `limits`가 되고, 그 숫자가 **노드에 파드가 몇 개 들어가는가**를 정하고, 그게 노드 수를, 노드 수가 청구서를 정합니다

19편에서는 이 여유를 돈으로 환산합니다. 그리고 GC별 힙 밖 고정비를 직접 재는데, 거기서 **ZGC에 대한 흔한 오해 하나가 실측으로 뒤집힙니다**
