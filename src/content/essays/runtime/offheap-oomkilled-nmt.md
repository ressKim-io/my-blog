---
title: "GC 로그는 깨끗한데 파드가 죽습니다 — 힙 밖 OOMKilled의 물리"
excerpt: "힙 사용률 1%, Full GC 0건, GC 로그는 티 하나 없이 깨끗합니다. 그런데 파드가 exit 137로 죽습니다. 같은 프로그램에 플래그를 하나 바꾸면 같은 코드가 OutOfMemoryError를 던지며 스택 트레이스를 남기고 죽죠. 그 플래그 하나가 커널의 죽음과 런타임의 죽음을 가릅니다. 다이렉트 버퍼·Metaspace·glibc arena·cgo를 컨테이너 안에서 하나씩 죽여 가며 확인했고, MALLOC_ARENA_MAX에 대한 통념 하나가 실측에서 뒤집혔습니다"
category: runtime
tags:
  - java
  - go
  - rust
  - kubernetes
  - troubleshooting
  - memory
series:
  name: "kernel-runtime-tradeoffs"
  order: 20
date: "2026-07-15"
---

> **시리즈 "커널과 런타임으로 톺아보는 Rust · Go · Java"의 20편**
> [7편](/essays/java-jit-inversion-conditions) `:118`에서 "off-heap OOMKilled의 정밀 해부는 5부에서 다룹니다"라고 약속했습니다. 그 청구서를 받는 자리입니다
> [19편](/essays/gc-headroom-bin-packing-density)에서 이미 예고를 하나 봤습니다. **NMT가 커밋했다고 보고한 양과 커널이 실제로 청구한 양이 어긋났죠**
> 그 어긋남이 파드를 죽입니다. 이번 편은 그 장면을 컨테이너 안에서 직접 재현합니다

상황은 늘 이렇게 시작합니다

> GC 로그는 깨끗합니다. Full GC도 없고 힙 사용량은 한도의 절반입니다. `-Xmx`도 넉넉히 줬습니다
> 그런데 파드가 `exit 137`로 죽습니다. 재시작해도 몇 시간 뒤 또 죽습니다

## 커널의 죽음과 런타임의 죽음은 다른 사건입니다

"메모리가 부족해서 죽었다"에는 **완전히 다른 두 사건**이 섞여 있습니다. 이걸 가르지 못하면 진단이 시작되지 않습니다

![Two deaths: one leaves a stack trace, one leaves nothing](/diagrams/offheap-oomkilled-nmt-1.svg)

그림 왼쪽이 **런타임의 죽음**입니다

힙(`-Xmx`)이 꽉 차서 GC를 아무리 돌려도 공간을 못 만들면, JVM이 스스로 `java.lang.OutOfMemoryError`를 **던집니다**

이건 자바 예외입니다. 스택 트레이스가 남고, 직전 GC 로그엔 연속된 Full GC가 찍힙니다. **로그에 흔적이 남습니다**

그림 오른쪽이 **커널의 죽음**입니다

프로세스 전체(힙과 힙 밖 전부)의 물리 페이지 합이 cgroup `memory.max`를 넘으면, [18편](/essays/container-memory-accounting-cgroup)에서 본 대로 OOM killer가 **`SIGKILL`** 을 보냅니다

**SIGKILL은 잡을 수도, 무시할 수도 없습니다.** 셧다운 훅도, `OutOfMemoryError`도, 스택 트레이스도 없습니다. 종료 코드 `137`만 남고 **GC 로그는 마지막까지 깨끗합니다**

"GC 로그는 깨끗한데 파드가 죽는다"는 정확히 두 번째 사건입니다. 힙은 건강하니 GC는 제 할 일을 다 하고 있고(그래서 로그가 깨끗하고), 정작 한도를 넘긴 범인은 **힙 밖**에 있습니다

## 같은 프로그램, 플래그 하나

말로 하면 추상적이니 두 죽음을 나란히 만들어 보겠습니다

힙은 건드리지 않고 **힙 밖만** 부풀리는 프로그램입니다. 다이렉트 버퍼를 8MiB씩 계속 잡습니다

```java
List<ByteBuffer> keep = new ArrayList<>();
for (int i = 1; i <= 400; i++) {
    // 힙 밖 다이렉트 버퍼 8MiB. 힙에는 참조 하나(수십 바이트)만 남는다
    ByteBuffer b = ByteBuffer.allocateDirect(8 << 20);
    b.put(0, (byte) 1);
    keep.add(b);
    ...
}
```

**`ByteBuffer.allocateDirect()`** 는 자바 힙이 아니라 네이티브 메모리를 잡습니다. Netty·gRPC·카프카 클라이언트가 IO 버퍼로 쓰는 그것입니다. 힙에 남는 건 그 버퍼를 가리키는 참조 하나뿐이죠

컨테이너 1GiB, 힙 512MiB로 띄웁니다

### (A) 기본값 — 런타임이 스스로 잡습니다

```bash
docker run --memory=1g offheap java -Xmx512m -Xms512m -Xlog:gc Leak
```

```text
다이렉트  480 MiB 할당  |  힙 사용   6 / 494 MiB ( 1%)
[1.405s][info][gc] GC(0) Pause Full (System.gc()) 6M->1M(494M) 5.702ms
Exception in thread "main" java.lang.OutOfMemoryError:
    Cannot reserve 8388608 bytes of direct buffer memory
    (allocated: 511705088, limit: 518979584)
	at java.base/java.nio.Bits.reserveMemory(Bits.java:178)
	at java.base/java.nio.DirectByteBuffer.<init>(DirectByteBuffer.java:108)
	at Leak.main(Leak.java:10)

ExitCode=1  OOMKilled=false
```

JVM이 **스스로 막았습니다**

`MaxDirectMemorySize`의 기본값이 `0`인데, 이 `0`은 "무제한"이 아니라 **"상한을 `-Xmx`에 맞춘다"** 는 뜻입니다. 로그의 `limit: 518979584`가 바로 그 값이죠. 다이렉트 버퍼가 힙 크기만큼 차자 `OutOfMemoryError`를 던졌습니다

`Pause Full (System.gc())` 한 줄도 눈여겨보십시오. JVM이 죽기 직전 **일부러 Full GC를 돌렸습니다.** 다이렉트 버퍼는 GC가 참조를 회수해야(Cleaner) 네이티브 메모리가 풀리기 때문에, 마지막으로 한 번 훑어본 겁니다

중요한 건 결과입니다. **exit 1, 스택 트레이스, 원인이 로그에 적혀 있습니다.** 진단 가능한 죽음이죠

### (B) 캡만 컨테이너 한도 위로

이제 딱 하나만 바꿉니다. `-XX:MaxDirectMemorySize=2g`. 컨테이너는 여전히 1GiB입니다

```bash
docker run --memory=1g offheap \
  java -Xmx512m -Xms512m -XX:MaxDirectMemorySize=2g -Xlog:gc Leak
```

```text
다이렉트  800 MiB 할당  |  힙 사용   6 / 494 MiB ( 1%)
다이렉트  880 MiB 할당  |  힙 사용   6 / 494 MiB ( 1%)
다이렉트  960 MiB 할당  |  힙 사용   6 / 494 MiB ( 1%)

ExitCode=137  OOMKilled=true
```

**끝입니다**

예외 없습니다. 스택 트레이스 없습니다. GC 로그에서 Full GC와 `OutOfMemoryError`를 세어 보면 **0건**입니다

그리고 마지막 줄까지 **힙 사용률이 1%** 입니다. 494MiB 중 6MiB를 쓰고 있었죠

![The same leak, two endings — the cap decides who kills you](/diagrams/offheap-oomkilled-nmt-2.svg)

그림에서 두 경우의 메모리 궤적이 똑같이 올라갑니다. 힙(아래 파란 띠)은 양쪽 다 바닥에 붙어 움직이지 않고, 다이렉트 버퍼(회색)만 자랍니다

갈리는 건 **가로선의 위치**입니다

**왼쪽**은 런타임의 캡(`MaxDirectMemorySize` = 495MiB)이 커널의 처형선(1GiB)보다 **아래**에 있습니다. 그래서 런타임이 먼저 걸리고, 예외를 던집니다

**오른쪽**은 캡을 2GiB로 올려 처형선보다 **위**로 보냈습니다. 이제 커널이 먼저 도달합니다

**같은 코드, 같은 힙, 같은 누수. 상한을 어디에 두었느냐가 죽음의 종류를 정합니다**

여기서 이번 편의 실무 전략이 곧장 나옵니다. **힙 밖 영역에 상한을 씌워, 커널이 죽이기 전에 런타임이 죽게 만드십시오.** 그래야 로그에 흔적이 남고 원인이 특정됩니다

## 힙 밖 지형을 실제로 재면

[11편](/essays/jvm-tlab-bump-pointer-offheap)에서 `-Xmx` 밖의 지형도를 그렸습니다. Metaspace·코드 캐시·스레드 스택·다이렉트 메모리가 힙 바깥에 있고, cgroup은 그 전부를 센다고요

이번엔 그 지형을 **숫자로** 열어 봅니다. **NMT(Native Memory Tracking)** 를 켜면 JVM이 힙 밖에서 쓰는 메모리를 범주별로 보여 줍니다

```bash
java -Xmx256m -XX:NativeMemoryTracking=summary \
     -XX:+UnlockDiagnosticVMOptions -XX:+PrintNMTStatistics Idle
```

아무 일도 안 하는 JVM의 출력입니다 (JDK 25.0.3)

| 범주 | committed | reserved |
|---|---|---|
| Java Heap | 256 MiB | 256 MiB |
| **GC** | **53.4 MiB** | 53.4 MiB |
| Shared class space | 13.6 MiB | 16 MiB |
| Code | 7.5 MiB | **244 MiB** |
| Thread | 0.46 MiB | 26 MiB |
| Metaspace | 0.20 MiB | 64 MiB |
| Class | 0.19 MiB | **1.02 GiB** |
| **Total** | **334 MiB** | **1.65 GiB** |

두 열의 차이가 이 표의 전부입니다

### `reserved`와 `committed`, 그리고 커널이 세는 것

**`reserved`(예약)** 는 프로세스가 확보해 둔 **가상 주소 공간**입니다. Class 범주의 1.02GiB, Code 범주의 244MiB가 그것이죠

이건 **물리 메모리를 쓰지 않습니다.** [18편](/essays/container-memory-accounting-cgroup)에서 본 대로, 만지지 않은 페이지에는 물리 프레임이 배정되지 않습니다

**`committed`(커밋)** 는 OS에 "이 범위를 실제로 쓰겠다"고 약속한 부분입니다

그리고 **커널이 `memory.current`에 청구하는 건 실제로 접촉한 페이지**입니다

![Reserved, committed, and what the kernel actually charges](/diagrams/offheap-oomkilled-nmt-3.svg)

그림의 세 겹이 그 관계입니다

**가장 바깥 옅은 테두리**가 reserved(1.65GiB)입니다. 넓지만 비어 있습니다

**가운데 파란 영역**이 committed(334MiB)입니다

**안쪽 붉은 영역**이 실제로 접촉돼 커널이 청구하는 몫입니다

그래서 `ps`에서 VSZ가 몇 GB로 나와도 정상입니다. **예약일 뿐이니까요**

정작 위험한 건 committed가 실제로 채워지며 늘어나는 영역입니다. Metaspace·다이렉트 버퍼·malloc arena가 거기 있습니다

그리고 [19편](/essays/gc-headroom-bin-packing-density)에서 본 어긋남도 여기서 설명됩니다. **NMT는 JVM이 스스로 관리하는 메모리만 셉니다.** C 라이브러리가 잡은 것, 실행 파일의 매핑, 그리고 ZGC의 `memfd` 힙 같은 건 NMT의 시야 밖입니다. 커널의 회계와 런타임의 회계는 **범위가 다릅니다**

### 아무 일도 안 했는데 GC가 53MiB를 씁니다

표에서 힙 다음으로 큰 게 **GC 범주(53.4MiB)** 라는 점도 짚고 갑니다

카드 테이블, 마킹 비트맵, G1의 Remembered Set은 전부 힙 밖 네이티브 메모리입니다. **GC를 돌리는 살림이 힙과 별도로 메모리를 먹습니다**

19편에서 본 "프로세스마다 내는 인두세"의 정체가 대부분 이겁니다

## 범인 목록 — 무엇이 조용히 자라나

힙 밖에서 `memory.max`를 넘기는 단골들입니다. 공통점은 **GC 로그에 안 남는다**는 것입니다

### Metaspace — 상한이 아예 없습니다

클래스 메타데이터가 사는 곳입니다. 그리고 **기본 상한이 사실상 무제한**입니다

11편에서 확인했듯 `MaxMetaspaceSize`가 `18446744073709551615`, 즉 2⁶⁴−1입니다

그래서 **클래스로더 누수**(동적 클래스 생성, 리로딩, 프록시 남발)가 있으면 Metaspace가 끝없이 자랍니다. 힙은 GC가 계속 청소해 깨끗한데, Metaspace는 상한이 없어 커널 한도까지 밀고 올라갑니다

`-XX:MaxMetaspaceSize`를 **명시적으로 씌우면** 커널이 죽이기 전에 JVM이 `OutOfMemoryError: Metaspace`를 던집니다. 앞의 A/B가 그대로 재현되는 거죠. **진단 가능성이 완전히 달라집니다**

### 코드 캐시 — JIT이 쌓은 기계어

[6편](/essays/java-jit-c2-runtime-optimization)에서 본 그 코드 캐시입니다. 예약이 약 240MB죠

코드가 많은 대형 앱이나 프레임워크 과다로 여기가 차면 committed가 240MB까지 오릅니다. 힙과 무관하니 GC 로그엔 안 남습니다

### 스레드 스택 — 스레드 수 × 스택 크기

스레드마다 네이티브 스택을 가집니다. JDK 25의 `ThreadStackSize` 기본값은 2048KB, 즉 **스레드당 2MiB**입니다

스레드가 수천 개로 폭발하면(스레드풀 오설정, 블로킹 IO에 요청당 스레드, 커넥션 폭주) 이 곱이 그대로 네이티브 메모리입니다

### 다이렉트 버퍼 — 앞에서 죽여 봤습니다

[3편](/essays/runtime-weight-zero-cost-vs-fat)에서 이미 경고했던 함정입니다. "`-XX:MaxDirectMemorySize`를 지정하지 않으면 기본 상한이 대략 `-Xmx`와 같아서, 힙을 3GB로 잡으면 다이렉트 메모리가 최대 3GB를 더 쓸 수 있다"고요

앞의 A/B가 그 예고를 물리적으로 회수한 것입니다

기본 상한이 `-Xmx`와 같다는 게 함정입니다. **힙을 크게 잡으면 다이렉트 한도도 같이 커집니다**

`-Xmx`를 3GiB로 올리면 다이렉트도 3GiB까지 쓸 수 있으니, 둘이 합쳐 6GiB가 됩니다. 컨테이너 한도가 4GiB라면 죽죠

게다가 다이렉트 버퍼는 GC가 참조를 회수해야 풀립니다. **힙에 여유가 많으면 GC가 안 돌아 다이렉트가 안 풀린 채 쌓이는** 역설이 생깁니다

### glibc arena — 여기서 통념 하나가 뒤집혔습니다

[9편](/essays/ptmalloc-rust-malloc-delegation)에서 ptmalloc의 arena를 다뤘습니다. 락 경합을 줄이려 arena를 여러 개 두고, 64비트에서 그 상한이 **코어 수 × 8**이라고요

그리고 이렇게 예고했습니다. **"이 숫자가 뒤에서 컨테이너 RSS 문제로 돌아옵니다"**

돌아왔습니다. 그런데 돌아온 모습이 예상과 달랐습니다

16개 스레드가 각각 64KiB짜리를 256개씩 잡았다가(총 256MiB) **전부 `free()`** 하는 C 프로그램을 만들어, 4코어 컨테이너에서 재 봤습니다

| | 최대 점유 | `free()` 후 | `malloc_trim()` 후 |
|---|---|---|---|
| 기본 (arena 상한 32개) | 258 MiB | **3 MiB** | 3 MiB |
| **`MALLOC_ARENA_MAX=2`** | 258 MiB | **96~113 MiB** | **1 MiB** |

먼저 확인되는 건 9편이 예고한 그 현상입니다. **`free()`를 했는데 RSS가 안 내려옵니다.** `MALLOC_ARENA_MAX=2`인 쪽은 100MiB 가까이 그대로 남아 있죠

그리고 `malloc_trim(0)`을 호출하자 **1MiB로 즉시 떨어졌습니다.** 누수가 아니었습니다. **할당자가 쥐고 있었을 뿐**입니다

그런데 순서가 뒤집혀 있습니다

**`MALLOC_ARENA_MAX=2`를 켠 쪽이 더 많이 붙들고 있습니다**

이건 흔한 조언과 반대입니다. "JVM 컨테이너의 RSS가 스멀스멀 오르면 `MALLOC_ARENA_MAX=2` 한 줄이면 된다"는 말이 널리 퍼져 있으니까요

![Fewer arenas held more memory, not less](/diagrams/offheap-oomkilled-nmt-4.svg)

이유는 arena가 어디에 사는지에 있습니다

그림 왼쪽이 기본값입니다. 9편에서 봤듯 **thread arena는 `mmap`으로 받은 구획**에 삽니다. 스레드마다 자기 구획을 독점하니, 그 안의 청크가 전부 해제되면 **구획이 통째로 비고** 커널에 반납할 수 있습니다

그림 오른쪽이 `MALLOC_ARENA_MAX=2`입니다. 여덟 스레드가 **한 구획을 나눠 씁니다.** 아래쪽 작은 색 블록들이 서로 다른 스레드의 청크인데, 이렇게 **뒤섞여 있습니다**

전부 해제해도 **통째로 빈 구획이 생기지 않습니다.** 그래서 할당자가 쥔 채 남습니다

**arena 수는 "경합 ↔ 단편화"의 트레이드오프이지, 낮추면 무조건 이기는 손잡이가 아닙니다**

단서를 답니다. 이건 제가 만든 특정 패턴(균일한 64KiB를 한꺼번에 잡았다 한꺼번에 놓는)에서의 결과입니다. 실제 JVM 컨테이너에서 `MALLOC_ARENA_MAX=2`가 효과를 본 사례들은 분명히 존재하고, 그건 할당 패턴이 다르기 때문입니다

요점은 **"만병통치약이 아니다"** 이고, **재 보지 않고 넣지 말라**는 것입니다

### GC 자료구조 — 앞의 53MiB

앞 NMT 표에서 힙 다음으로 컸던 그 범주입니다. GC를 돌리는 살림이 힙 밖에 있습니다

## Go도 같은 병에 걸립니다 — `GOMEMLIMIT`은 cgo를 안 덮습니다

Go의 힙 밖 지형은 JVM보다 좁지만, 없지는 않습니다

그리고 결정적으로 **`GOMEMLIMIT`은 Go 런타임이 관리하는 메모리만 셉니다.** 힙, 고루틴 스택, 런타임 자체 구조까지입니다

**cgo로 부른 C 라이브러리가 `malloc`한 메모리는 그 밖입니다**

Java의 다이렉트 버퍼와 정확히 같은 실험을 Go로 만들었습니다. C 쪽에서 8MiB씩 잡습니다

```go
/*
#include <stdlib.h>
#include <string.h>
static void* grab(size_t n) { void* p = malloc(n); if (p) memset(p, 1, n); return p; }
*/
import "C"

keep = append(keep, C.grab(C.size_t(8<<20))) // C 쪽에서 8MiB malloc
```

컨테이너 1GiB, **`GOMEMLIMIT=700MiB`** 를 제대로 줬습니다

```text
GOMEMLIMIT=700 MiB
C 힙  800 MiB 할당  |  Go 힙  0 MiB · GC 0회
C 힙  880 MiB 할당  |  Go 힙  0 MiB · GC 0회
C 힙  960 MiB 할당  |  Go 힙  0 MiB · GC 0회

ExitCode=137  OOMKilled=true
```

**Go 힙 0 MiB, GC 0회**

`GOMEMLIMIT`은 700MiB인데 프로세스는 960MiB를 쓰다 죽었습니다. Go 런타임은 **아무 일도 일어나지 않았다고 생각합니다.** 자기가 관리하는 메모리는 정말로 0이니까요

`gctrace`를 켜도 깨끗합니다. `runtime.MemStats`도 깨끗합니다. 그리고 exit 137

**JVM의 다이렉트 버퍼와 판박이입니다.** 런타임에 회계를 위임했는데, **런타임이 세지 않는 영역**이 생긴 겁니다

Go에는 하나가 더 있습니다. **OS 반납 정책**입니다. [8편](/essays/kernel-lazy-allocation-page-fault)·[10편](/essays/go-allocator-mcache-contiguous-stack)에서 정리했듯 Go 1.12에서 `MADV_FREE`로 바꿨다가 컨테이너 모니터링과 궁합이 나빠 **1.16부터 다시 `MADV_DONTNEED`가 기본**입니다. 그래서 지금은 RSS가 대체로 정직합니다

## 세 언어 수렴 — 힙 밖 지형의 넓이

![The wider the runtime, the more places to die behind a clean log](/diagrams/offheap-oomkilled-nmt-5.svg)

그림의 세로 점선이 **런타임이 볼 수 있는 경계**입니다. 왼쪽은 런타임의 계기판에 잡히고, 오른쪽은 안 잡힙니다

그런데 **커널은 오른쪽까지 전부 청구합니다.** 오른쪽 띠가 넓을수록 조용히 죽을 자리가 많다는 뜻이죠

| | 힙 밖 지형 | 조용히 죽을 위험 | 왜 |
|---|---|---|---|
| **Rust** | 개념상 "힙 밖"이 자연스러움. 모든 할당이 명시적 | 낮음 | GC도 런타임도 없어 "보이지 않게 자라는" 영역이 원천적으로 적음. malloc 단편화는 있으나 해제 시점이 코드에 드러남 |
| **Go** | 고루틴 스택 + **cgo/C 할당** | 중간 | 순수 Go면 좁지만, **cgo를 쓰는 순간** `GOMEMLIMIT` 밖 영역이 생겨 JVM과 같은 병 |
| **Java** | Metaspace·코드캐시·다이렉트·스레드스택·arena·GC구조 | **높음** | 힙 밖이 넓고 그중 다수가 기본 무제한이거나 큰 예약. NMT 없이는 안 보임 |

세로로 읽으면 이렇습니다. **런타임이 클수록 힙 밖 지형이 넓고, 넓을수록 '깨끗한 로그' 뒤에서 죽을 자리가 많습니다**

Rust는 모든 메모리가 코드에 드러나 있어 숨을 곳이 적습니다

Java는 편의를 위해 런타임이 관리하는 영역이 넓은 만큼, **그 관리 밖으로 새는 경로도 많습니다**

Go는 순수하면 Rust에 가깝고 cgo를 쓰면 Java에 가까워지는, **선택이 위험을 결정하는** 중간 지대입니다

[17편](/essays/gc-cost-conservation-no-silver-bullet)의 "회계의 위치" 축이 컨테이너에서 다시 나타난 것입니다. 회계를 런타임에 위임할수록 편하지만, **런타임이 세지 않는 메모리가 사각지대**가 됩니다

## 그래서 어떻게 하나

### 먼저 재십시오. 추측하지 마십시오

**JVM에서는** `-XX:NativeMemoryTracking=summary`로 띄우고 `jcmd <pid> VM.native_memory summary`로 범주별 committed를 봅니다

어느 범주가 시간에 따라 자라는지가 범인을 지목합니다. `jcmd ... VM.native_memory baseline` 후 `... summary.diff`로 증가분만 추적하면 누수 탐지가 쉽습니다

**Go에서는** `GODEBUG=gctrace=1`로 힙이 정상인지 확인하고, cgroup `memory.current`와의 격차가 크면 **cgo를 의심합니다.** 방금 본 대로 Go 쪽 계기판은 전부 깨끗할 테니까요

### 캡을 씌워, 커널의 죽음을 런타임의 죽음으로 바꾸십시오

이번 편의 A/B가 증명한 전략입니다. **상한 없는 힙 밖 영역에 상한을 줘서, 커널이 죽이기 전에 런타임이 예외를 던지게** 만듭니다

`-XX:MaxMetaspaceSize`로 Metaspace 폭주를 `OutOfMemoryError: Metaspace`로 전환합니다. `-XX:MaxDirectMemorySize`로 다이렉트 버퍼를 명시적으로 캡합니다. 스레드풀 크기와 `-Xss`로 스택 총량을 제어합니다

**단, 캡의 합이 컨테이너 한도보다 작아야 합니다.** (B)에서 봤듯 캡을 한도 위에 두면 아무 의미가 없습니다

### 여백을 남기고 한도를 잡으십시오

컨테이너 `limits.memory`는 **힙 + 힙 밖 전부 + 페이지 캐시 여유**를 담아야 합니다

`-Xmx`(또는 `MaxRAMPercentage`)를 한도의 50~75%에 두고 나머지를 힙 밖 몫으로 남깁니다. **"한도 = `-Xmx`"로 잡으면 이번 편의 모든 범인이 곧장 OOMKilled로 돌아옵니다**

Go도 마찬가지로 `GOMEMLIMIT`을 한도의 90% 근처에 두되, **cgo가 있으면 그만큼 더 빼야** 합니다

## 트레이드오프 소결

한 문장으로 정리하면 이렇습니다

**커널은 힙과 힙 밖을 구분하지 않고 합산하는데, 런타임은 힙만 관리하고 로그에 남깁니다. 그 사각지대가 exit 137입니다**

그래서 진단의 요령은 하나로 모입니다

"메모리로 죽었다"를 보면 먼저 **런타임의 죽음(예외·로그 있음)인지 커널의 죽음(SIGKILL·로그 없음·exit 137)인지**를 가르십시오

후자면 힙을 보지 마십시오. 힙은 멀쩡할 겁니다. **힙 밖을 NMT와 `memory.stat`으로 재십시오**

5부의 세 편이 여기서 합류합니다. 18편이 "커널은 전부 합산한다"는 회계 규칙을, 19편이 "상자 크기를 잘 잡아도"라는 전제를, 20편이 "힙 밖 여백이 없으면 그 안에서 죽는다"는 결말을 맡았습니다

남은 건 시간 축입니다. 이 모든 게 **프로세스가 막 뜨는 순간**엔 어떻게 보이는가

## 더 파고들 질문

1. **죽음의 종류 가르기** — 파드가 `exit 137`로 죽었을 때, 그게 커널 OOM인지 kubelet 축출인지 liveness 실패인지를 `dmesg`의 OOM 리포트, cgroup `memory.events`의 `oom_kill`, kubelet 이벤트 중 무엇으로 구분하겠습니까? 각 신호가 가리키는 원인이 어떻게 다릅니까?

2. **캡의 총합** — `-Xmx` + `MaxMetaspaceSize` + `MaxDirectMemorySize` + (스레드 수 × `-Xss`) + 코드 캐시의 합이 컨테이너 한도를 넘으면, 캡을 씌운 의미가 왜 사라집니까? 실제로 이 합을 계산해 한도와 비교하는 스크립트를 배포 파이프라인에 넣는다면 어떤 값을 어디서 읽겠습니까?

3. **Metaspace 캡 정하기** — 안 씌우면 커널 OOM, 너무 낮게 씌우면 `OutOfMemoryError: Metaspace`로 조기 사망입니다. 클래스 수가 배포마다 늘어나는 앱에서 이 값을 NMT의 Class committed 추이로 어떻게 정하겠습니까?

4. **`MALLOC_ARENA_MAX`를 재 보고 넣기** — 이번 편에서 `MALLOC_ARENA_MAX=2`가 오히려 반납을 막는 경우를 봤습니다. 여러분의 워크로드에서 이 값이 이득인지 손해인지를 어떤 실험으로 판정하겠습니까? 락 경합(처리량)과 RSS를 동시에 보려면 무엇을 계측해야 합니까?

5. **Go cgo 사각지대** — cgo를 쓰는 Go 서비스에서 `GOMEMLIMIT`을 한도의 90%로 뒀는데도 OOMKilled가 납니다. C 쪽 할당을 어떤 도구로 계측하고, `GOMEMLIMIT`을 몇 %로 다시 잡겠습니까? 애초에 cgo를 걷어내는 선택과 비교하면 어떻습니까?

6. **한도 산정 자동화** — "힙 + 힙 밖 + 페이지 캐시 여유"를 담는 `limits.memory`를 감으로 잡는 대신, NMT와 RSS 실측을 부하 테스트에서 뽑아 자동 산정하려면 어떤 파이프라인이 필요합니까? 배포 후 힙 밖 증가를 어떤 알람으로 잡겠습니까?

## 핵심 요약

- **커널의 죽음과 런타임의 죽음은 다른 사건입니다.** 런타임의 죽음은 `OutOfMemoryError`·스택 트레이스·GC 로그를 남깁니다. 커널의 죽음은 `SIGKILL`이라 **아무것도 남기지 않습니다.** exit 137에 GC 로그는 깨끗합니다
- **같은 코드, 플래그 하나가 죽음의 종류를 정합니다.** `MaxDirectMemorySize`가 컨테이너 한도 아래면 JVM이 예외를 던지고(exit 1), 한도 위로 올리면 커널이 조용히 죽입니다(exit 137, GC 로그 0건). 두 경우 모두 **힙 사용률은 1%** 였습니다
- 그래서 전략은 하나입니다. **상한 없는 힙 밖 영역에 캡을 씌워, 커널이 죽이기 전에 런타임이 죽게 만드십시오.** 단 **캡의 합이 컨테이너 한도보다 작아야** 의미가 있습니다
- **`reserved`는 물리 메모리가 아닙니다.** 유휴 JVM의 reserved 1.65GiB 중 committed는 334MiB뿐입니다. `ps`의 VSZ를 보고 놀랄 필요 없습니다. 위험한 건 committed가 실제로 채워지는 영역입니다
- **NMT와 커널은 범위가 다릅니다.** NMT는 JVM이 관리하는 것만 셉니다. C 라이브러리 할당과 ZGC의 `memfd` 힙은 그 시야 밖이라, 19편에서 본 어긋남이 생깁니다
- 범인들: **Metaspace**(상한이 2⁶⁴−1, 사실상 무제한) · **코드 캐시**(예약 240MB) · **스레드 스택**(개당 2MiB) · **다이렉트 버퍼**(기본 상한이 `-Xmx`와 같음) · **glibc arena** · **GC 자료구조**(유휴에도 53MiB)
- **`MALLOC_ARENA_MAX=2`에 대한 통념이 실측에서 뒤집혔습니다.** 제 워크로드에서는 이걸 켠 쪽이 오히려 96~113MiB를 반납하지 않았습니다(기본은 3MiB). thread arena는 `mmap` 구획을 통째로 반납할 수 있는데, 2개로 묶으면 여러 스레드의 할당이 뒤섞여 그러지 못하기 때문입니다. **arena 수는 경합 ↔ 단편화의 트레이드오프이지 만병통치약이 아닙니다.** `malloc_trim(0)`이 즉시 1MiB로 떨어뜨렸으니 **누수가 아니라 할당자가 쥐고 있던 것**입니다
- **`GOMEMLIMIT`은 cgo를 안 덮습니다.** `GOMEMLIMIT=700MiB`를 준 Go 프로세스가 C 힙 960MiB를 쓰다 exit 137로 죽는 동안, **Go 힙은 0 MiB, GC는 0회**였습니다. Java의 다이렉트 버퍼와 판박이입니다
- **런타임이 클수록 '깨끗한 로그' 뒤에서 죽을 자리가 많습니다.** Rust는 좁고, Java는 넓고, Go는 cgo를 쓰는 순간 Java 쪽으로 건너갑니다

**[다음 편 예고]**

**21편은 콜드 스타트와 웜업의 청구서**입니다

지금까지는 **정상 상태**의 메모리 회계였습니다. 그런데 파드가 **막 뜨는 순간**은 또 다른 세계입니다

JIT은 아직 인터프리터로 굴러 느리고, GC는 아직 힙을 못 잡았고, 클래스 로딩과 코드 캐시와 arena가 한꺼번에 부풀어 오릅니다

웜업 계단을 직접 재 보면 **인터프리터가 정착 코드보다 5.8배 느립니다.** 오토스케일러가 파드를 늘려도 그 용량이 한동안 반값짜리라는 뜻이죠

그리고 그 세금을 없애는 세 처방 — **Leyden의 AOT 캐시**, **GraalVM native-image**, **CRaC** — 을 봅니다. 그중 하나는 JDK 25에 이미 들어와 있어서 **직접 돌려 볼 수 있었습니다**
