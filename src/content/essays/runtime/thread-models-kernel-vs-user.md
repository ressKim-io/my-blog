---
title: "OS 스레드는 왜 무거울까 — 고루틴 100만 개가 가능한 이유"
excerpt: "스레드 하나의 원가를 task_struct와 스택, 컨텍스트 스위치까지 뜯어보고, C10K의 벽 앞에서 세 언어가 갈라지는 지점을 따라갑니다. Go GMP의 work stealing과 핸드오프, Java 가상 스레드의 mount/unmount, Rust가 그린 스레드를 버린 이유까지 다룹니다"
category: runtime
tags:
  - go
  - java
  - rust
  - goroutine
  - virtual-thread
  - scheduler
series:
  name: "kernel-runtime-tradeoffs-1"
  order: 2
date: "2026-06-27"
---

> **시리즈 "커널과 런타임으로 톺아보는 Rust · Go · Java"의 2편**
> [1편](/essays/syscall-mode-switch-cost)에서 시스템 콜의 왕복 비용을 해부하며, 블로킹을 누가 흡수하느냐가 언어마다 갈린다는 것까지 봤습니다. 이번 편은 그 흡수 장치의 정체입니다
> OS 스레드 하나의 원가에서 출발해 Go의 GMP 스케줄러, Java 가상 스레드, 그리고 Rust가 그린 스레드를 버린 이유까지 내려가 보겠습니다

## 접속 10만 개, 스레드 10만 개?

동시 접속 10만을 받는 서버를 떠올려 보겠습니다. 접속마다 스레드를 하나씩 만들면 어떻게 될까요?

이 단순한 질문이 지난 20년의 서버 아키텍처를 갈라놓았습니다. 그리고 Go, Java, Rust가 서로 다른 답을 내놓게 만들었습니다

답을 비교하려면 먼저 원가표부터 봐야 합니다. 스레드 하나는 정확히 무엇을 얼마나 쓰는 걸까요?

## 커널 스레드의 실체 — 1:1 모델

"스레드"라는 단어는 두 층위에서 쓰여서 혼란을 줍니다. 이 글에서 커널 스레드라고 하면, 커널 스케줄러가 인식하고 CPU에 직접 배정하는 실행 단위를 말합니다

리눅스 커널은 프로세스와 스레드를 구분하지 않습니다. 둘 다 task_struct라는 커널 자료구조 하나로 표현되고, 스케줄러가 CPU 시간을 배분하는 대상이 바로 이것입니다

1:1 모델은 언어의 스레드 1개를 OS 스레드 1개, 그러니까 task_struct 1개에 그대로 매핑합니다. Rust의 `std::thread`, Java의 플랫폼 스레드가 여기 해당합니다

![One-to-one threading model — every app thread is one kernel task with its own bill](/diagrams/thread-models-kernel-vs-user-1.svg)

그림처럼 앱 스레드 셋은 커널 태스크 셋이 됩니다. 커널 스케줄러가 이들을 코어에 시간 조각 단위로 배분합니다

이 배분 알고리즘은 커널 6.6부터 CFS(완전 공정 스케줄러)에서 대기 지연 공정성을 개선한 EEVDF로 바뀌었습니다

이 구조에서 "스레드가 무겁다"는 말은 막연한 인상이 아니라 세 가지 구체적인 청구서입니다

1. **메모리 원가(스택)** — 스레드는 자기만의 호출 스택이 필요합니다. 함수를 부를 때마다 지역 변수와 복귀 주소가 쌓이는 그 공간입니다. 리눅스 pthread 기본 스택은 8MB 예약(실제 상주는 건드린 만큼), Rust `std::thread`는 기본 2MB, Java 플랫폼 스레드는 `-Xss` 기본 수백 KB~1MB. 스레드 수에 비례해 선형으로 쌓입니다
2. **컨텍스트 스위치 비용** — 컨텍스트 스위치는 코어에서 도는 스레드를 A에서 B로 갈아 끼우는 일입니다. 커널 진입(1편의 모드 전환)과 레지스터 저장·복원, 스케줄러 실행까지 직접 비용만 대략 1~2μs. 그 뒤에 캐시·TLB·분기 예측기가 오염되는 간접 비용이 따라오는 것도 1편과 같은 구조입니다
3. **생성·소멸 비용** — 스레드 생성은 `clone()` 시스템 콜에 스택 매핑과 커널 자료구조 할당이 얹힌 작업입니다. 요청마다 새로 만들면 이 비용이 반복되죠. 스레드 풀이 존재하는 이유입니다

> **ARM 각주** — 컨텍스트 스위치 때 저장할 레지스터 수는 아키텍처마다 다릅니다. AArch64는 범용 31개에 SIMD/FP 32개, x86-64는 범용 16개에 벡터 16개(AVX-512면 32개). ARM 쪽 저장 상태가 약간 크지만 총비용에서는 부차적이고, 1:1 모델이 무겁다는 본질은 두 아키텍처가 같습니다

## 1:1의 벽 — C10K

1999년, 동시 접속 1만 개를 어떻게 감당할 것인가라는 질문에 C10K 문제라는 이름이 붙었습니다. 접속마다 스레드 하나를 쓰는 설계는 여기서 두 벽에 부딪힙니다

| 접속 수 | 필요 스택 (스레드당 1MB 가정) | 결과 |
| --- | --- | --- |
| 1,000 | 약 1GB | 빠듯함 |
| 10,000 | 약 10GB | 메모리 폭발 |
| 100,000 | 약 100GB | 불가능 |

첫 번째 벽이 위 표의 메모리입니다. 일을 시작하기도 전에 스택 예약만으로 서버가 주저앉습니다

두 번째 벽은 스케줄링입니다. 실행 가능한 스레드가 코어 수를 크게 넘어서면 커널 스케줄러가 수만 개를 돌아가며 태워야 하고, 컨텍스트 스위치가 폭증합니다

CPU가 일보다 갈아 끼우기에 시간을 쓰는 상태, 이른바 스래싱(thrashing)입니다

그런데 여기에 숨은 모순이 있습니다. 네트워크 서버의 스레드 대부분은 사실 일을 하지 않고 I/O를 기다립니다

소켓 하나 기다리자고 1MB 스택과 커널 스케줄링 슬롯을 통째로 점유하는 셈이죠. 이 낭비를 없애려는 시도가 유저 레벨 스케줄링입니다

## 유저 레벨 스케줄링 — M:N

발상은 한 줄입니다. **동시성의 단위를 커널 스케줄링의 단위에서 분리한다**

값싼 유저 태스크(고루틴, 가상 스레드, async 태스크)를 수십만, 수백만 개 만듭니다. 그리고 이들을 소수의 OS 스레드 위에서 런타임이 직접 스케줄링합니다

태스크가 I/O를 기다리게 되면 OS 스레드를 붙잡는 대신 그 태스크만 재워 둡니다(park). OS 스레드는 곧바로 다른 태스크를 태웁니다

![M-to-N model — a user-level scheduler sits between cheap tasks and few OS threads](/diagrams/thread-models-kernel-vs-user-2.svg)

그림의 핵심은 가운데 낀 층입니다. 유저 레벨 스케줄러가 태스크와 OS 스레드 사이에서 커널 몰래 배차를 담당합니다

커널은 여전히 OS 스레드 몇 개만 알고 있습니다. 수백만 태스크의 존재는 런타임만 압니다

그래서 태스크 전환에는 커널 진입도, 컨텍스트 스위치도 없습니다

같은 M:N이라도 런타임마다 성격이 다릅니다. 두 가지 질문으로 가르면 언어별 차이가 선명해집니다

- **선점형인가, 협력형인가** — 런타임이 오래 도는 태스크를 강제로 뺏을 수 있는지, 아니면 태스크가 스스로 양보(yield, `await`)해야 하는지
- **투명한가, 색칠되는가** — 평범한 블로킹 코드를 그대로 쓰는지, 아니면 `async/await`로 함수를 물들여야 하는지

![Where each runtime sits on two axes — preemption style and code style](/diagrams/thread-models-kernel-vs-user-3.svg)

이 지도 위에서 Go는 선점형이면서 투명하고, Java 가상 스레드는 준선점이면서 투명합니다. Rust의 tokio는 협력형이면서 색칠됩니다

왼쪽 위로 갈수록 런타임이 많은 일을 대신 해 주는 대신 런타임 자체가 무거워집니다. 오른쪽 아래로 갈수록 런타임은 얇아지는 대신 개발자가 챙길 것이 늘어나죠

위치가 곧 철학인 셈입니다. 세 위치가 왜 그렇게 정해졌는지 이제 하나씩 뜯어보겠습니다

## Go의 답 — GMP 스케줄러

Go는 M:N 스케줄러를 언어 런타임에 내장했습니다. 개발자는 `go f()` 한 줄로 고루틴을 만들고 블로킹 코드를 그대로 씁니다

이 마법의 정체가 GMP입니다

- **G(Goroutine)** — 고루틴, 실행 단위. 초기 스택 2KB에서 시작해 모자라면 통째로 복사하며 자랍니다
- **M(Machine)** — OS 스레드. 실제로 CPU에서 도는 것
- **P(Processor)** — 논리 프로세서. G를 M에 태울 권리이자 로컬 런큐(대기열)의 소유자. 개수는 `GOMAXPROCS`(기본값은 사용 가능 코어 수)

규칙은 하나입니다. G가 실행되려면 P가 필요하고, P는 M에 붙어야 CPU를 씁니다

그래서 동시에 진짜로 실행 중인 고루틴의 최대 개수가 곧 P의 개수, 즉 GOMAXPROCS입니다

![Go GMP — per-P run queues, work stealing, global queue and the netpoller](/diagrams/thread-models-kernel-vs-user-4.svg)

그림에서 P마다 자기 런큐를 갖고 있다는 점이 중요합니다. 대부분의 스케줄링이 락 없이 자기 런큐 안에서 끝나기 때문에 빠릅니다

로컬에 못 담은 고루틴은 전역 런큐로 넘어가고, P들이 주기적으로 확인합니다. I/O를 기다리는 고루틴은 netpoller에 따로 잠들어 있습니다

### 네 가지 핵심 메커니즘

**work stealing** — 어떤 P의 런큐가 비면 다른 P를 무작위로 골라 런큐의 절반을 훔쳐 옵니다. 이 제한적이고 무작위적인 훔치기가 부하를 코어 전체에 고르게 폅니다

**syscall 핸드오프** — 1편에서 예고한 "런타임이 관문을 감싼다"의 실체입니다. 고루틴이 블로킹 시스템 콜에 들어가면 `entersyscall`이 개입해서, 커널에 붙잡힌 M에게서 P를 떼어내 다른 M에 붙입니다

![Syscall handoff — the P detaches from a blocked M and keeps scheduling on another M](/diagrams/thread-models-kernel-vs-user-5.svg)

그림 왼쪽에서 G1이 시스템 콜로 커널에 들어가면 M0도 함께 묶입니다. 하지만 오른쪽처럼 P가 M0을 버리고 다른 M으로 옮겨 가서, 대기하던 G2와 G3는 아무 일 없다는 듯 계속 돌죠

시스템 콜이 끝난 G1은 `exitsyscall`에서 P를 다시 얻어야 이어서 실행됩니다. 블로킹 하나가 전체를 멈추지 못하게 만드는 장치입니다

**netpoller** — 네트워크 I/O는 아예 다른 길로 갑니다. epoll은 소켓 수천 개를 걸어 두고 준비된 것만 골라 받는 리눅스의 이벤트 통지 장치인데, Go는 네트워크 소켓을 전부 논블로킹으로 바꾸고 epoll(macOS는 kqueue, Windows는 IOCP)로 감시합니다

`conn.Read`로 기다리는 고루틴은 OS 스레드를 점유하지 않고 netpoller에 park됩니다. 수백만 커넥션이 대부분 잠든 채 소수의 스레드를 공유하는 것, Go가 네트워크 서버에 강한 이유입니다

**비동기 선점(Go 1.14+)** — 초기 Go는 함수 호출 경계에서만 선점할 수 있어서 `for {}` 같은 타이트 루프가 스케줄러를 독점했습니다. 1.14부터 런타임이 오래 도는 M에 SIGURG 시그널을 보내고, 시그널 핸들러가 고루틴 상태를 저장한 뒤 강제로 내립니다

그래서 Go의 M:N은 선점형입니다. 위 지도에서 Go가 맨 위에 있는 이유입니다

### GOMAXPROCS와 컨테이너

```go
// 고루틴 10만 개 — OS 스레드였다면 스택만 수십 GB
for i := 0; i < 100_000; i++ {
    go func(id int) {
        resp, _ := http.Get(url) // 블로킹처럼 보이지만
        _ = resp                 // netpoller가 park → M 반환
    }(i)
}
```

GOMAXPROCS에는 오래된 함정이 있었습니다. Go 1.24까지 런타임은 컨테이너의 CPU limit을 무시하고 호스트의 전체 코어 수를 봤습니다

예를 들어 64코어 노드에서 `CPU limit=2`인 파드를 돌리면 P가 64개 만들어집니다. 64개 P로 일하려다 cgroup의 CFS 쿼터를 소진하면 스로틀링, 그러니까 남은 주기 동안 실행이 완전히 정지되는 벌칙을 받습니다

이게 꼬리 지연(tail latency) 폭증의 고전적 원인입니다

Go 1.25가 이 문제를 런타임 기본값으로 해결했습니다. cgroup의 CPU 제한(v1 `cpu.cfs_quota_us`, v2 `cpu.max`)을 읽어 GOMAXPROCS를 limit에 맞추고, 약 30초마다 재확인해 동적으로 조정합니다

끄고 싶으면 `GODEBUG=containermaxprocs=0`. 단 CPU limit만 보고 request는 무시한다는 점은 기억해 둘 만합니다

> **DevOps 함의** — Go 1.24 이하를 K8s에 올렸다면 uber의 `automaxprocs` 라이브러리로 수동 보정하는 게 정석이었습니다. 1.25부터는 런타임이 대신 해 줍니다. "왜 2코어 파드가 스로틀되지?"의 답이 여기 있는 경우가 많습니다

## Java의 답 — 플랫폼 스레드에서 가상 스레드로

Java는 이제 두 종류의 스레드를 갖습니다. "Java는 1:1"이라는 오래된 상식이 깨진 지점입니다

플랫폼 스레드는 기존 그대로입니다. `new Thread()`와 스레드 풀의 스레드는 OS 스레드와 1:1이고, 스택 수백 KB~1MB의 무게도 그대로입니다

그래서 전통적인 Java 서버는 스레드 풀 기반 thread-per-request로 수백~수천 동시성이 한계였습니다. 이를 넘으려고 WebFlux 같은 리액티브 스택으로 우회했지만, 콜백과 연산자 체인으로 코드가 뒤틀리는 대가를 치렀습니다

가상 스레드(JDK 21 정식)는 다른 접근입니다. OS 스레드가 아니라, 실행 상태를 힙에 저장하는 초경량 스레드입니다

여기서 Continuation이라는 개념이 등장합니다. 실행을 멈춘 지점의 호출 스택 상태를 힙 객체로 떠 놓은 것이라고 생각하면 됩니다

![Virtual thread lifecycle — mount on a carrier, unmount to the heap on blocking I/O, remount later](/diagrams/thread-models-kernel-vs-user-6.svg)

그림의 순환이 가상 스레드의 전부입니다. 가상 스레드는 캐리어 스레드(플랫폼 스레드, 기본은 코어 수만큼의 work-stealing ForkJoinPool)에 올라타야(mount) 실행됩니다

블로킹 I/O를 만나면 JDK가 계측해 둔 지점에서 Continuation을 힙에 저장하고 캐리어에서 내립니다(unmount). 캐리어는 즉시 해방되어 다른 가상 스레드를 태웁니다

I/O가 끝나면 아무 캐리어에나 다시 올라타 이어서 실행됩니다. 초기 풋프린트가 수백 바이트~KB 수준이라 수백만 개를 만들 수 있습니다

```java
// thread-per-request 스타일이 되살아난다
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (int i = 0; i < 100_000; i++) {
        executor.submit(() -> {
            var body = client.send(req, ofString()); // 블로킹 → 캐리어 unmount
            return body.body();
        });
    }
}
```

개발자 입장에서는 평범한 블로킹 코드를 그대로 씁니다. Go의 철학과 정확히 수렴하는 지점입니다

### pinning과 JEP 491

가상 스레드의 아킬레스건이 pinning(고정)입니다. 가상 스레드가 unmount되지 못하고 캐리어를 붙잡아 버리는 현상입니다

캐리어가 고정된 만큼 M:N의 이점이 사라지고, 심하면 기아나 데드락까지 갑니다

JDK 21~23에서 가장 큰 pinning 원인은 `synchronized`였습니다. `synchronized`는 객체마다 붙는 모니터 락으로 임계 구역을 지키는 Java의 기본 동기화 장치인데, JVM이 모니터 소유권을 캐리어 스레드 기준으로 추적했습니다

그래서 `synchronized` 블록 안에서 블로킹하면 unmount가 불가능했습니다. 레거시 라이브러리가 `synchronized`투성이라면 가상 스레드의 이점이 무력화됐죠

JDK 24의 JEP 491이 이걸 풀었습니다(JEP은 Java의 공식 기능 개선 제안 문서입니다). 모니터 소유권을 가상 스레드 단위로 추적하도록 JVM을 고쳐서, `synchronized` 안에서 블로킹해도 unmount됩니다

현행 LTS인 JDK 25에는 이 개선이 포함되어 있습니다. 다만 JNI 콜백 안의 블로킹이나 클래스 초기화 중 블로킹 같은 예외적 pinning은 여전히 남습니다

> **DevOps 함의** — 가상 스레드를 도입한다면 `-Djdk.tracePinnedThreads`나 JFR의 `jdk.VirtualThreadPinned` 이벤트로 pinning을 계측해야 합니다. JDK 24 미만이라면 `synchronized` 병목이 그대로 살아 있다는 뜻이라, 업그레이드 또는 `ReentrantLock` 치환을 저울질하게 됩니다

### 컨테이너 인식은 Java가 먼저였습니다

재미있는 반전이 하나 있습니다. JVM은 JDK 10(2018)부터 `UseContainerSupport`로 cgroup의 CPU·메모리 제한을 읽습니다

`Runtime.availableProcessors()`가 CPU limit을 반영하니, ForkJoinPool 캐리어 수와 GC 스레드 수가 컨테이너 제한에 자동으로 맞춰집니다. Go가 1.25(2025)에 얻은 컨테이너 인식을 Java는 7년 먼저 갖고 있던 셈이죠

물론 Java는 이 인식을 힙 크기 계산과 엮으면서 또 다른 함정을 만드는데, 그건 5부에서 다룹니다

## Rust의 답 — 1:1 유지, async는 선택

Rust는 의도적으로 M:N 런타임을 언어에서 뺐습니다

1.0 이전(2014)에는 그린 스레드(libgreen)를 실험했지만, 모든 바이너리에 무거운 런타임을 강제하는 것이 제로코스트 추상화 철학에 어긋나 제거했습니다. 이 철학의 전모는 3편에서 다룹니다

대신 Rust의 동시성은 두 층으로 나뉩니다

**`std::thread`** — 1:1 OS 스레드 그대로입니다. Java 플랫폼 스레드와 같은 무게(기본 스택 2MB)이고, CPU를 실제로 쓰는 병렬 작업에는 이게 정답입니다(rayon 같은 데이터 병렬 라이브러리도 이 위에 있습니다)

**`async`/`.await`** — async 함수는 런타임이 아니라 컴파일러가 상태 기계로 바꿉니다. 상태 기계란 실행을 멈출 수 있는 지점(`.await`)마다의 진행 상태를 열거형처럼 저장해 두는 구조인데, 이렇게 변환된 `Future`는 힙 할당도 런타임도 강제하지 않습니다

다만 이 `Future`를 실제로 굴리는 실행기(executor)는 언어에 없습니다. tokio, async-std, smol 같은 라이브러리에서 골라야 합니다

### tokio — 라이브러리로 구현한 M:N, 단 협력형

```rust
// tokio: async는 협력형 — .await에서만 양보한다
#[tokio::main]
async fn main() {
    let mut tasks = Vec::new();
    for _ in 0..100_000 {
        tasks.push(tokio::spawn(async {
            let resp = reqwest::get(URL).await.unwrap(); // .await에서 양보
            resp.text().await
        }));
    }
}
```

tokio의 멀티스레드 런타임은 워커 스레드 풀(기본은 코어 수) 위에서 async 태스크를 work stealing으로 스케줄링합니다. I/O는 mio라는 라이브러리를 통해 epoll로 처리합니다

구조만 보면 Go의 GMP와 닮았습니다. 하지만 결정적 차이 둘이 있습니다

**함정 1: 색칠(coloring)** — `async fn`은 `async fn` 안에서만 자연스럽게 호출됩니다. 코드베이스가 동기 세계와 비동기 세계로 갈라지는 함수 색칠 문제입니다

**함정 2: 협력형의 대가** — tokio에는 Go의 SIGURG 선점도, Loom의 자동 unmount도 없습니다. 태스크가 `.await` 없이 CPU를 오래 쥐거나 블로킹 호출을 하면, 그 워커 스레드 전체가 멈춥니다

```rust
// async 안의 블로킹 호출 → 워커 스레드가 통째로 멈춤
tokio::spawn(async {
    std::thread::sleep(Duration::from_secs(1)); // .await가 아님 → 스케줄러 정지
    // 블로킹이 꼭 필요하면 tokio::task::spawn_blocking으로 격리해야 한다
});
```

블로킹 흡수를 런타임이 자동으로 해 주지 않으니, 개발자가 `spawn_blocking`으로 직접 격리해야 합니다. 자동화를 포기한 자리에 명시성이 들어온 것이죠

> **컨테이너 각주** — tokio 기본 워커 수는 num_cpus 크레이트가 정합니다. 이 크레이트와 Rust 표준 `available_parallelism`은 cgroup의 CPU quota를 읽도록 개선돼 와서, 최신 버전 기준으로는 Go 1.24 이전 같은 "호스트 코어 수" 함정이 기본값에서 상당 부분 해소됐습니다. 다만 어떤 층(std, num_cpus, 프레임워크)이 워커 수를 정하는지가 버전마다 달라서, 컨테이너에서는 `TOKIO_WORKER_THREADS`나 `worker_threads` 설정으로 명시하는 편이 안전합니다

## 세 언어 수렴 비교

| 항목 | Rust std | Rust tokio | Go | Java 플랫폼 | Java 가상 |
| --- | --- | --- | --- | --- | --- |
| 모델 | 1:1 | M:N (협력) | M:N (선점) | 1:1 | M:N (준선점) |
| 스케줄 주체 | 커널 | tokio 런타임 | Go 런타임 | 커널 | JVM (ForkJoinPool) |
| 태스크 무게 | 스택 ~2MB | 상태 기계(Future) | 스택 2KB, 복사 성장 | 스택 ~0.5~1MB | 힙 Continuation |
| 선점 | OS 타임슬라이스 | 없음 (`.await`) | SIGURG 선점 | OS 타임슬라이스 | 블로킹·마운트 지점 |
| 코드 스타일 | 블로킹 | async 색칠 | 투명 블로킹 | 블로킹 | 투명 블로킹 |
| 블로킹 흡수 | 스레드 낭비 | `spawn_blocking` 수동 | P 핸드오프 | 스레드 낭비 | 캐리어 unmount |
| 컨테이너 인식 | cgroup quota 반영 | num_cpus가 quota 파싱 | 1.25부터 기본 | JDK 10부터 | JDK 10부터 |

표에서 "준선점"이라고 쓴 이유가 있습니다. 가상 스레드는 시간 기반으로 선점되는 게 아니라 블로킹·마운트 지점에서만 양보하니, Go 같은 완전 선점은 아닙니다

표를 가로질러 보이는 수렴이 이번 편의 핵심입니다. Go와 Java 가상 스레드는 "투명한 블로킹 코드 + 런타임이 알아서 흡수"라는 같은 답에 도착했습니다

Rust만 이 자동화를 거절했습니다. 제로코스트 철학을 지키는 대가로 async 색칠과 수동 블로킹 격리라는 명시성을 개발자에게 넘겼죠

결국 1편의 결론과 같은 축입니다. 같은 문제를 두고 런타임이 책임지느냐(Go, Java), 개발자가 책임지느냐(Rust)로 갈립니다

## 트레이드오프 소결

1:1 모델은 단순하고 예측 가능하며, CPU를 실제로 쓰는 병렬 작업에 최적입니다. 대신 대규모 I/O 동시성에서는 메모리와 컨텍스트 스위치로 무너집니다

M:N 모델은 대규모 I/O 동시성을 값싸게 흡수합니다. 대신 런타임 복잡도와 함께 pinning, 워커 블로킹, GOMAXPROCS 오설정 같은 새로운 실패 양식을 만들죠

그리고 어느 쪽이든 물리 코어 수라는 천장은 같습니다. M:N은 기다리는 태스크를 값싸게 다룰 뿐, 계산하는 태스크를 더 빠르게 만들지는 않습니다

## DevOps 관점에서 더 파고들 질문

1. **스로틀링 진단** — 컨테이너의 `cpu.stat`에서 `nr_throttled`와 `throttled_time`을 보면 CFS 스로틀링 여부가 보입니다. Go 1.24 이하나 워커 수 미설정 서비스가 CPU limit에 걸려 꼬리 지연을 만들고 있지 않나요?
2. **컨텍스트 스위치 계측** — `pidstat -w`로 자발/비자발 스위치를, `perf sched`로 스위치 폭풍을 관측할 수 있습니다. 스레드 풀을 코어 수 대비 과하게 잡으면 비자발 스위치가 치솟는데, 적정 크기는 어떻게 정할까요?
3. **가상 스레드 pinning 탐지** — `-Djdk.tracePinnedThreads`와 JFR `jdk.VirtualThreadPinned`로 pinning을 잡습니다. 대상 JDK가 24 미만이면 업그레이드와 `ReentrantLock` 치환 중 무엇이 쌀까요?
4. **가상 스레드 vs 리액티브** — Loom 이후 WebFlux 같은 리액티브 스택의 존재 이유가 줄었을까요? 백프레셔나 스트리밍 조합 같은 경우엔 여전히 리액티브가 유리할까요?
5. **tokio 블로킹 격리** — async 핸들러 안에서 파일 I/O나 무거운 계산을 `spawn_blocking` 없이 부르면 왜 전체 처리량이 무너질까요? 블로킹 풀 크기는 어떻게 잡아야 할까요?
6. **request vs limit** — Go 1.25는 CPU limit만 보고 request는 무시합니다. request=1, limit=4인 파드에서 GOMAXPROCS는 몇이 되고, 그게 노드 빈패킹(5부)과 어떻게 충돌할까요?

## 핵심 요약

- 리눅스에서 스레드는 task_struct 하나입니다. 스택 예약(수백 KB~8MB), 컨텍스트 스위치(직접 1~2μs + 캐시 오염), 생성 비용이라는 세 가지 청구서가 따라옵니다
- C10K의 본질은 낭비입니다. 네트워크 스레드 대부분은 I/O를 기다릴 뿐인데 스택과 스케줄링 슬롯을 통째로 점유합니다
- M:N은 동시성의 단위를 커널 스케줄링 단위에서 분리합니다. Go는 GMP(work stealing, P 핸드오프, netpoller, SIGURG 선점)로, Java는 가상 스레드(힙 Continuation, mount/unmount, JEP 491)로 이를 구현했습니다
- Rust는 제로코스트 철학 때문에 M:N 런타임을 언어에서 뺐습니다. tokio가 라이브러리로 그 자리를 채우지만 협력형이라, 블로킹 격리는 개발자 몫입니다
- 컨테이너 인식은 Java(JDK 10)가 Go(1.25)보다 7년 빨랐습니다. CPU limit과 GOMAXPROCS·워커 수가 어긋나면 CFS 스로틀링이 꼬리 지연을 만듭니다
- Go와 Java 가상 스레드는 "투명한 블로킹 + 런타임 흡수"로 수렴했고, Rust는 명시성을 택했습니다. 런타임이 책임지느냐 개발자가 책임지느냐, 1편과 같은 축입니다

---

**[다음 편 예고]**
런타임이 개입하는 정도가 언어마다 다르다면, 그 런타임 자체의 무게는 얼마일까요? 3편에서는 Zero-Cost(Rust)와 Fat Runtime(Go·Java)을 다섯 개의 축으로 해부하고, Rust가 그린 스레드를 버린 이유를 완결합니다
