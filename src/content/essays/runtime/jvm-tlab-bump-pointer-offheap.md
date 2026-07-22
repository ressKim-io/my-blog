---
title: "자바는 왜 객체를 헤프게 만들어도 빠를까 — TLAB의 덧셈 한 번과 힙 밖의 청구서"
excerpt: "Rust는 malloc의 bin을 뒤졌고 Go는 span의 비트맵을 짚었습니다. JVM은 한 걸음 더 나아가 할당을 포인터 한 번 미는 것으로 줄여 버립니다. 그게 어떻게 가능한지(moving GC의 선물), 무엇을 대가로 치르는지(객체마다 붙는 12바이트 헤더), 그리고 -Xmx로는 왜 OOMKilled를 막지 못하는지까지. 수치는 전부 JDK 25에서 직접 확인했습니다"
category: runtime
tags:
  - java
  - go
  - rust
  - jvm
  - gc
  - memory
series:
  name: "kernel-runtime-tradeoffs-3"
  order: 4
date: "2026-07-06"
---

> **시리즈 "커널과 런타임으로 깊이 파헤치는 Rust · Go · Java"의 13편**
> [11편](/essays/ptmalloc-rust-malloc-delegation)의 Rust는 malloc의 bin에서 맞는 조각을 찾아 왔고, [12편](/essays/go-allocator-mcache-contiguous-stack)의 Go는 span의 빈 슬롯을 비트맵으로 짚었습니다
> JVM은 여기서 한 걸음 더 나아갑니다. 할당을 **포인터를 한 번 미는 것**으로 줄여 버립니다
> 이번 편은 그게 어떻게 가능하고 무엇을 대가로 치르는지를 봅니다. 그리고 [9편](/essays/java-jit-inversion-conditions)에서 "힙은 60%인데 OOMKilled"라 불렀던 그 현상의 물리적 토대를 끝까지 파냅니다

> 이 글의 수치는 **JDK 25에서 직접 확인한 값**입니다. `-XX:+PrintFlagsFinal`로 읽은 기본값과 `-Xlog:gc+tlab`로 뽑은 실제 로그를 그대로 씁니다

## 자바 객체가 태어나는 땅

자바 객체는 **GC 힙** 안에서 태어납니다

이 힙은 "대부분의 객체는 금방 죽는다"는 경험칙, 곧 **generational hypothesis(세대 가설, 대부분의 객체는 생성 직후 곧바로 죽고 오직 소수의 객체만 오래 살아남는다는 경험적 관찰)** 에 맞춰 세대별로 나뉘어 있습니다

![The generational heap, and the slice of Eden each thread gets](/diagrams/jvm-tlab-bump-pointer-offheap-1.svg)

그림 왼쪽 보라색 구역이 **Young**, 곧 젊은 세대입니다. 갓 만든 객체가 사는 곳입니다

그 안의 초록 구역이 **Eden**입니다. 새 객체는 거의 다 여기서 태어납니다

Eden 옆의 좁은 칸 둘이 **Survivor**(S0·S1)입니다. Eden에서 살아남은 객체가 잠시 머무는 곳입니다

오른쪽 회색이 **Old**, 늙은 세대입니다. Young에서 여러 번 살아남은 객체가 **promotion(승격, Young 세대에서 Minor GC를 여러 번 거치며 살아남은 장수 객체가 Old 세대로 이동하는 과정)** 되어 옵니다

동작의 핵심은 이것입니다. Eden이 꽉 차면 **Minor GC**가 돌아, 아직 살아 있는 객체만 Survivor나 Old로 **복사**하고 **Eden을 통째로 비웁니다**

죽은 객체를 하나하나 회수하는 게 아닙니다. 산 것만 옮기고 나머지는 그냥 버립니다

이 "통째로 비운다"가 뒤에 나올 모든 이야기의 열쇠입니다

### TLAB — 스레드마다 떼어 준 Eden 한 조각

Eden은 모든 스레드가 공유하는 땅입니다

수백 개 스레드가 동시에 "여기서 객체 하나 만들게" 하며 Eden의 같은 위치를 다투면, 할당마다 동기화가 필요해 병목이 됩니다

락을 잡거나, 최소한 **CAS**(compare-and-swap, 값이 예상과 같을 때만 바꿔 넣는 원자적 명령)로 경합을 처리해야 하기 때문입니다

그래서 HotSpot은 **각 스레드에게 Eden의 한 조각을 미리 떼어 줍니다**

그림 Eden 안의 작은 칸들이 그것입니다. 이 스레드 전용 조각이 **TLAB(Thread-Local Allocation Buffer, 멀티스레드 환경에서 락 경합 없이 객체를 빠르게 생성하기 위해 각 스레드마다 Eden 영역의 한 구획을 독립적으로 할당해 주는 개별 버퍼)** 입니다

TLAB가 자기 스레드만의 것이라, 그 안에서의 할당은 **누구와도 동기화할 필요가 없습니다**

[12편](/essays/go-allocator-mcache-contiguous-stack)의 mcache가 `P`마다 하나라 락이 없었던 것과 정확히 같은 논리입니다. 이름만 다릅니다

Eden 오른쪽 끝 점선 칸은 **공용 영역**입니다. TLAB에 넣기 곤란한 큰 객체가 여기로 가는데, 뒤에서 다룹니다

참고로 JDK 25의 기본 GC인 **G1**은 힙을 균일한 **region**들로 잘라 Eden·Survivor·Old 역할을 동적으로 배정합니다. 다만 "새 객체는 Eden 역할 region에, 할당은 포인터를 밀어서"라는 큰 그림은 같습니다

## bump-the-pointer — 할당이 덧셈 한 번으로

TLAB는 그냥 연속된 빈 공간입니다

"다음에 쓸 위치"를 가리키는 포인터(`top`)와 끝(`end`)만 있으면 됩니다

![Bump the pointer: allocation is one addition](/diagrams/jvm-tlab-bump-pointer-offheap-2.svg)

그림의 가로 막대가 TLAB 하나입니다. 왼쪽 하늘색이 이미 객체가 들어찬 부분, 오른쪽 점선이 아직 빈 공간입니다

그 경계에 서 있는 것이 `top`입니다

객체 하나를 만드는 일은 가운데 초록 칸이 전부입니다. `top` 자리를 돌려주고, `top`을 객체 크기만큼 오른쪽으로 미는 것

코드로 쓰면 이렇습니다

```java
// TLAB 안에서의 빠른 경로
if (top + size <= end) {   // 이 TLAB에 자리가 있나?
    Object p = top;        // 돌려줄 주소
    top += size;           // 포인터를 민다
    return p;              // 락도, CAS도, 목록 순회도 없음
}
// 자리가 없으면 아래의 느린 경로로
```

11편의 malloc이 bin 연결 리스트를 뒤지고, 12편의 Go가 span 비트맵을 짚던 것과 비교해 보면 됩니다

이건 거의 **덧셈 한 번**입니다

자바가 "객체를 헤프게 만들어도 빠르다"는 평판을 얻은 바탕이 이 **bump-the-pointer(포인터 밀기, TLAB 내에서 다음 사용 가능 메모리 주소를 가리키는 포인터를 새로 생성할 객체의 크기만큼 단번에 더하여 이동시키는 초고속 할당 기법)** 입니다

## 왜 이게 가능한가 — moving GC의 선물

여기서 꼭 던져야 할 질문이 있습니다. malloc과 Go는 왜 이렇게 못 할까요?

답은 **"객체를 옮길 수 있느냐"** 에 있습니다

포인터를 밀기만 하는 할당은 공간을 절대 되돌려 쓰지 않고 앞으로만 나아갑니다. 그러면 금방 바닥이 납니다

이게 지속되려면 누군가 주기적으로 **그 땅을 통째로 비워 포인터를 처음으로 되돌려** 줘야 합니다

![A moving collector empties Eden whole, which is what lets the pointer keep bumping](/diagrams/jvm-tlab-bump-pointer-offheap-3.svg)

그림 왼쪽이 GC 직전의 Eden입니다. 초록 칸이 아직 살아 있는 객체, 붉은 점선 칸이 죽은 객체입니다

가운데 화살표가 Minor GC가 하는 일의 전부입니다. **산 객체만 골라 Survivor로 evacuate(객체 대피 복사, Minor GC 실행 중 Eden과 Survivor 영역에서 살아 있는 객체만을 골라 다음 Survivor 영역이나 Old 영역으로 물리적으로 복사하여 이동시키는 작업)** 합니다

오른쪽이 그 결과입니다. Eden이 **통째로 비었습니다**. 그리고 `top`이 맨 앞으로 돌아갔습니다

여기서 봐야 할 것은 죽은 객체입니다. GC는 죽은 객체를 **찾아가지도, 회수하지도 않습니다**. 그냥 버려두고 Eden을 리셋할 뿐입니다

죽은 객체가 아무리 많아도 비용이 들지 않습니다. 비용은 **산 객체의 수**에만 비례합니다

객체가 물리적으로 이사를 다니니, 그 객체를 가리키던 포인터도 GC가 전부 고쳐 줍니다. 12편에서 본 고루틴 스택의 포인터 재조정과 같은 일을 힙 전체에 하는 셈입니다

반대로 malloc과 Go는 **힙 객체를 옮기지 않습니다(non-moving)**. 한번 준 주소는 그 자리에 고정입니다

그러니 중간에 구멍이 나면 그 구멍을 재활용해야 하고, 그러려면 free list나 비트맵으로 "빈 자리"를 관리할 수밖에 없습니다

정리하면 이렇습니다. **bump-the-pointer는 공짜가 아니라, "GC가 나중에 객체를 옮겨 주겠다"는 약속을 담보로 미리 당겨 쓴 편의입니다**

이 빚의 상환 명세서가 4부입니다

GC가 승격과 복사를 할 때 쓰는 스레드 로컬 버퍼를 **PLAB(Promotion LAB)** 이라 부릅니다. 할당 쪽에 TLAB가 있듯 회수 쪽에 PLAB가 있는 셈입니다

### ZGC는 그 빚마저 백그라운드로 옮겼습니다

위에서 "GC가 애플리케이션을 멈추고 Eden을 통째로 비운다"고 한 것은 G1이나 Parallel 같은 고전적 모델입니다

**Generational ZGC**는 같은 bump-the-pointer를 쓰면서도, 객체 이사를 **애플리케이션을 멈추지 않고 동시에** 해냅니다

포인터에 상태 비트를 새긴 **colored pointer(컬러드 포인터, 64비트 메모리 주소 상위 메타비트에 객체의 마킹 및 재배치 상태 정보를 직접 기록하여 GC가 참조 상태를 즉시 판별하는 ZGC의 핵심 기법)** 와, 객체를 읽고 쓸 때 참조를 고쳐 주는 **load·store barrier(적재·저장 배리어, 프로그램이 힙 메모리의 객체 참조를 읽거나 쓸 때 GC가 개입하여 참조 주소를 최신 위치로 자동 교정하는 런타임 검사 루틴)** 로 이동을 백그라운드에서 처리합니다

JDK 21에 들어와 JDK 23부터 ZGC의 기본 모드가 됐고, JDK 24에서는 비세대 모드가 아예 제거됐습니다. JDK 25에서 `-XX:-ZGenerational`을 주면 VM이 이렇게 답합니다

```text
OpenJDK 64-Bit Server VM warning: Ignoring option ZGenerational; support was removed in 24.0
```

이제 ZGC는 세대별 전용입니다

할당의 편의를 STW(stop-the-world)로 갚던 시대에서, **그 빚마저 백그라운드 스레드의 CPU로 갚는** 시대로 옮겨 온 셈입니다

다만 빚이 사라진 게 아니라 청구서의 모양이 바뀐 것입니다. 그 본론은 4부에서 다룹니다

## TLAB가 가득 차면

`top + size > end`가 되는 순간 빠른 경로가 막힙니다

이때 JVM의 판단은 **객체 크기**에 따라 갈립니다

![What the JVM does when the object does not fit the current buffer](/diagrams/jvm-tlab-bump-pointer-offheap-4.svg)

그림을 위에서 아래로 읽으면 됩니다. 세 번의 질문에서 오른쪽으로 빠져나가면 그것으로 끝이고, 아래로 내려갈수록 값이 오릅니다

**첫 번째 질문 — 지금 TLAB에 들어가나?** 들어가면 방금 본 bump입니다. 대부분이 여기서 끝납니다

**두 번째 질문 — TLAB를 은퇴시켜도 낭비가 목표치 아래인가?** 그렇다면 현재 TLAB를 **은퇴(retire)** 시키고 Eden에서 새 TLAB를 받아 그 안에 넣습니다

이때 옛 TLAB의 남은 자투리는 버려집니다. 다만 그냥 버려 두면 안 됩니다

GC가 힙을 처음부터 끝까지 선형으로 훑을 수 있어야 하기 때문입니다(heap parsability). 그래서 그 자투리 자리에 **더미 객체(filler)** 를 채워 넣습니다

**세 번째 질문 — G1 region의 절반 미만인가?** 여기까지 내려왔다는 건 새 TLAB를 받기엔 객체가 크다는 뜻입니다. TLAB 하나를 통째로 잡아먹을 크기라 은퇴시켜 봐야 손해입니다

그래도 region의 절반 미만이면 **Eden의 공용 영역에 직접** 할당합니다

여기는 여러 스레드가 공유하니 이때만 CAS가 필요합니다

그리고 마지막, region의 **절반 이상**을 차지하는 객체는 완전히 다른 길로 갑니다

### Humongous — Eden을 아예 건너뛰는 객체

G1 region 크기의 **50% 이상**인 객체를 **Humongous Object(휴몽거스 객체, G1 GC에서 단일 region 크기의 50% 이상을 차지하는 거대 객체로 Eden을 우회하여 Old 세대의 전용 region에 직접 할당되는 객체)** 라 부릅니다

이 객체는 Eden을 거치지 않고 **Old의 Humongous Region에 직접** 할당됩니다

그렇다면 region 크기가 얼마냐가 중요해집니다. 그런데 이 값은 고정이 아니라 **힙 크기에서 파생**됩니다

G1은 region 개수를 대략 2,048개로 맞추려 합니다. 그래서 region 크기는 힙을 2,048로 나눈 값을 2의 거듭제곱으로 맞추되, 1MB와 32MB 사이로 자릅니다

JDK 25에서 직접 확인해 봤습니다

| `-Xmx` | G1 region 크기 | Humongous 임계값 |
| --- | --- | --- |
| 1GB | 1MB | 512KB 이상 |
| 4GB | 2MB | 1MB 이상 |
| 16GB | 8MB | 4MB 이상 |
| 32GB | 16MB | 8MB 이상 |
| 64GB | 32MB | 16MB 이상 |

힙이 4GB인 서비스라면 **1MB짜리 버퍼 하나가 이미 humongous**입니다. 생각보다 낮은 문턱입니다

운영에서 이게 중요한 이유가 둘 있습니다

첫째, humongous 객체는 **이사(evacuation) 대상에서 빠집니다**. 옮겨지지 않으니 그 자리에 그대로 남고, 주변에 파편을 남깁니다

둘째, 할당 직전에 G1이 **IHOP(Initiating Heap Occupancy Percent, G1 GC가 애플리케이션 실행과 동시에 백그라운드에서 Old 세대 마킹 사이클을 시작하도록 트리거하는 힙 점유율 임계값)** (기본값 45)을 넘었는지 검사해 **동시 마킹 사이클을 앞당겨 트리거**합니다

그래서 큰 배열이나 버퍼를 자주 만들면 TLAB를 우회하는 데서 그치지 않습니다. **GC 사이클 자체를 흔들어** G1의 성능을 떨어뜨립니다

### 적응형 TLAB — 스스로 크기를 조절합니다

여기서 낭비(자투리)와 경합(새 TLAB를 받는 빈도)이 맞물립니다

TLAB가 크면 은퇴할 때 버리는 자투리가 커지고, 작으면 새 TLAB를 자주 받아야 해서 Eden 경합이 늘어납니다

HotSpot은 이를 두 손잡이로 조율합니다. JDK 25의 실제 기본값입니다

- **`-XX:TLABWasteTargetPercent`(기본 1)** — TLAB 은퇴로 버려도 좋은 낭비의 목표치입니다
- **`-XX:+ResizeTLAB`(기본 켜짐)** — 각 스레드가 refill 횟수를 세어 TLAB 크기를 스스로 키우거나 줄입니다

목표는 GC 한 주기당 약 **50회 refill**입니다. HotSpot이 `100 ÷ (2 × TLABWasteTargetPercent)`로 계산하는 값입니다

할당을 많이 하는 스레드는 큰 TLAB를, 적게 하는 스레드는 작은 TLAB를 갖게 됩니다. 낭비와 경합이 동시에 눌리는 구조입니다

말로만 하면 와닿지 않으니 실제 로그를 보겠습니다. `-Xlog:gc+tlab=trace`로 뽑은 JDK 25의 출력입니다

```text
TLAB: fill thread: 0x000000010576b340 [id: 3587] desired_size: 512KB
      slow allocs: 0  refill waste: 8192B  refills: 1  waste 0.0%
```

`desired_size: 512KB`가 적응형으로 정해진 이 스레드의 TLAB 크기입니다. 아무도 지정하지 않았고 런타임이 스스로 고른 값입니다

`refill waste: 8192B`가 은퇴 시 버려도 좋은 한도입니다. 512KB를 `TLABRefillWasteFraction`(기본 64)으로 나눈 값이 정확히 8,192바이트입니다

`slow allocs`와 `waste %`가 튜닝의 신호입니다. 느린 경로가 잦거나 낭비율이 높으면 그때 손잡이를 만지면 됩니다

대개는 적응형이 알아서 잘합니다. 참고로 TLAB의 최소 크기(`MinTLABSize`)는 **2KB**입니다

비용의 계단을 정리하면 이렇습니다. **거의 항상(TLAB bump) ≫ 가끔(새 TLAB, Eden CAS) ≫ 드물게(Minor GC)**

12편의 Go가 mcache에서 mcentral로, 다시 mheap으로 내려가던 그 구조와 정확히 같은 모양입니다. 이름만 바뀌었을 뿐입니다

## 객체 헤더 — 자바가 객체마다 무는 세금

여기서 자바의 대가 하나가 드러납니다

할당은 싸도, **모든 자바 객체는 헤더를 달고 다닙니다**

![Every Java object carries a header, and compact headers halve it](/diagrams/jvm-tlab-bump-pointer-offheap-5.svg)

그림 위쪽이 표준 레이아웃입니다

보라색 **mark word(마크 워드, 객체의 해시코드와 GC 세대 나이 및 동기화 락 상태 등을 저장하는 자바 객체 헤더의 8바이트 기본 메타데이터 영역)** (8바이트)가 객체의 신분증입니다. `hashCode`, GC가 세는 나이(age), 락 상태가 여기 삽니다

붉은 **klass pointer(클래스 포인터, 객체가 어떤 자바 클래스의 인스턴스인지를 가리키는 런타임 메타데이터 참조 주소)** (압축 시 4바이트)는 이 객체가 어느 클래스인지 가리킵니다

그래서 헤더만 12바이트입니다. 8바이트 정렬 패딩까지 하면 **필드가 하나도 없는 객체도 16바이트**를 차지합니다

`int` 하나짜리 객체도 마찬가지입니다. 12바이트 헤더에 4바이트 필드를 더하면 딱 16바이트가 되기 때문입니다

이 헤더가 왜 중요한가 하면, **Rust 구조체와 Go 객체에는 이런 것이 없기** 때문입니다

Rust 구조체는 필드 그 자체이고, Go의 GC 메타데이터는 객체가 아니라 span 쪽에 있습니다(12편의 scan/noscan)

작은 객체 수억 개를 다루는 워크로드라면, 이 12~16바이트가 힙 크기와 캐시 효율을 통째로 좌우합니다

### 압축 oops의 32GB 벼랑

방금 "압축 시 4바이트"라고 했습니다. 여기서 oops는 ordinary object pointer, 곧 자바의 객체 참조를 가리킵니다

이 **compressed oops(Compressed Ordinary Object Pointers, 64비트 메모리 주소 대신 8바이트 정렬을 가정한 32비트 오프셋을 사용하여 객체 참조 크기를 8바이트에서 4바이트로 줄이는 JVM 힙 최적화 기법)** 에 벼랑이 하나 숨어 있습니다

압축 oops는 참조를 8바이트 정렬 기준의 32비트 오프셋으로 저장합니다. 그래서 최대 **32GB 힙**까지 가리킬 수 있습니다

문제는 그 선을 넘는 순간입니다

![The compressed-oops cliff sits exactly at 32 gigabytes](/diagrams/jvm-tlab-bump-pointer-offheap-6.svg)

그림 위쪽 띠가 기본 설정(8바이트 정렬)입니다. 32GB까지는 초록, 곧 참조가 4바이트입니다

붉은 점선을 넘으면 압축이 꺼집니다. 모든 객체 참조와 klass 포인터가 **4바이트에서 8바이트로 부풀어 오릅니다**

JDK 25에서 직접 확인해 보면 벼랑이 정확히 32GB에 있습니다

| `-Xmx` | 압축 oops |
| --- | --- |
| 31GB | 켜짐 |
| **32GB** | **꺼짐** |
| 33GB | 꺼짐 |

여기서 역설이 생깁니다. 힙을 32GB로 키우면 **담을 수 있는 객체가 오히려 줄어들 수 있습니다**

포인터가 전부 두 배로 부풀어 그만큼 자리를 먹기 때문입니다. 그래서 힙을 40GB로 주느니 30GB로 주는 편이 빠른 경우가 흔합니다

빠져나갈 길이 하나 있습니다. 그림 아래쪽 띠가 그것으로, 객체 정렬을 16바이트로 키우면 압축을 더 멀리 끌고 갈 수 있습니다

역시 실측해 봤습니다. `-XX:ObjectAlignmentInBytes=16`을 주면 33GB에서도, 60GB에서도 압축이 살아 있고 65GB에서야 꺼집니다

벼랑이 32GB에서 **약 64GB로 밀려나는 것입니다**. 다만 정렬이 커진 만큼 객체마다 패딩 낭비가 늘어나니 공짜는 아닙니다

### 헤더를 줄이는 길 — JEP 519, 그리고 534

그림 아래쪽이 **compact object headers(컴팩트 객체 헤더, 12~16바이트에 달하던 객체 헤더를 마크 워드와 클래스 참조의 압축 병합을 통해 단 8바이트로 축소하는 현대 JVM의 메모리 최적화 기능)** 입니다. mark word가 클래스 참조까지 흡수해 헤더가 **8바이트**로 줄어듭니다

96비트가 64비트가 되는 것이고, 객체마다 4바이트씩 돌려받는 셈입니다

효과가 작지 않습니다. SPECjbb2015 벤치마크에서 **힙 22% 감소, CPU 8% 감소, GC 횟수 15% 감소**가 보고됐습니다

이 기능의 이력을 보면, 자바가 어디로 가려는지가 한눈에 보입니다

![Java is on a trajectory to stop paying the object-header tax](/diagrams/jvm-tlab-bump-pointer-offheap-7.svg)

그림의 네 칸이 릴리스 순서입니다. 아래 막대가 **그 시점의 기본 헤더 크기**이고, 오른쪽으로 갈수록 짧아집니다

**JDK 24(JEP 450)** 에서 실험 기능으로 처음 등장했습니다. 플래그 뒤에 숨어 있었으니 기본 헤더는 여전히 12바이트입니다

**JDK 25(JEP 519)** 에서 정식 제품 기능으로 승격됐습니다. 다만 **기본값은 아닙니다**. `-XX:+UseCompactObjectHeaders`로 켜야 합니다

실제로 JDK 25에서 확인해 보면 `UseCompactObjectHeaders`가 `false`로 나옵니다. 정식이지만 꺼져 있다는 뜻입니다

**JDK 27(JEP 534)** 이 이걸 **기본값으로** 만드는 후속 제안입니다. 여기서 막대가 8바이트로 줄어듭니다

프로덕션 검증은 이미 상당히 쌓였습니다. Amazon이 수백 개 서비스를 이 설정으로 돌리고 있고(대부분 JDK 21·17 백포트), SAP는 자사 OpenJDK 배포판에서 이미 기본값으로 켜 두었습니다

그리고 마지막 칸, **Project Valhalla의 값 클래스(JEP 401)** 는 성격이 다릅니다

헤더를 8바이트로 줄이는 게 아니라, 아이덴티티가 없는 값 클래스에서 **헤더를 아예 없애고** 값을 배열과 필드에 직접 박아 넣습니다. 그래서 막대가 사라집니다

다만 시점은 조심해서 읽어야 합니다. [8편](/essays/jit-deopt-safepoint-tail-latency)에서 짚었듯 JEP 401은 아직 **프리뷰조차 아닙니다**

메인라인 밖의 조기 접근 빌드에서만 시험할 수 있고, JDK 28 통합을 목표로 작업 중입니다. 그림의 마지막 칸은 확정된 릴리스가 아니라 방향입니다

방향만은 분명합니다. **자바가 객체 헤더라는 세금을 근본적으로 면제받으려는** 궤도이고, 이건 Go와 Rust가 처음부터 구조체를 값으로 다루던 방식에 수렴하려는 시도입니다

## 힙 밖의 지형 — -Xmx가 막지 못하는 것

지금까지는 전부 GC 힙 이야기였습니다

그런데 자바 프로세스가 쓰는 메모리는 힙이 전부가 아닙니다

![-Xmx fences the GC heap; the container counts everything](/diagrams/jvm-tlab-bump-pointer-offheap-8.svg)

그림에 두 개의 테두리가 있습니다. 이 그림의 전부가 그 둘의 차이입니다

안쪽 **보라색 점선**이 `-Xmx`가 감싸는 범위입니다. **GC 힙(Young + Old)뿐입니다**

바깥 **붉은 실선**이 컨테이너의 cgroup이 재는 범위입니다. **그림 전체**입니다

오른쪽 노란 층들이 그 차이에 해당하는 영역입니다. `-Xmx` 바깥에, 네이티브 메모리에 삽니다

JDK 25에서 확인한 각 층의 기본 상한입니다

| 층 | 무엇이 사나 | 기본 상한 |
| --- | --- | --- |
| **Metaspace** | 클래스 메타데이터·바이트코드·MDO | 사실상 무제한 (`MaxMetaspaceSize`가 2^64−1) |
| **Code Cache** | JIT이 만든 기계어 | 240MB (`ReservedCodeCacheSize`) |
| **Direct Memory** | `DirectByteBuffer`·Netty off-heap | 미설정이면 `-Xmx`를 따라감 |
| **Thread Stacks** | 스레드마다 하나 | 보통 512KB~1MB (`-Xss`) |

층별로 짚어 보겠습니다

**Metaspace(메타스페이스, 자바 클래스 메타데이터와 메서드 바이트코드 및 JIT 프로파일 데이터가 저장되는 네이티브 메모리 영역)** 는 클래스의 메타데이터와 [7편](/essays/java-jit-c2-runtime-optimization)에서 만난 **MDO(MethodData)** 가 사는 곳입니다

GC 힙이 아니라 네이티브 메모리이고, 기본 상한이 사실상 없습니다. 클래스로더 누수가 나면 여기서 네이티브 메모리가 조용히 샙니다

**Code Cache(코드 캐시, JIT 컴파일러가 바이트코드를 고속 실행 가능한 기계어로 변환하여 보관하는 네이티브 메모리 영역)** 는 7편에서 본 그 층입니다. JIT이 컴파일한 기계어가 쌓이고, [8편](/essays/jit-deopt-safepoint-tail-latency)에서 본 대로 기본 240MB입니다. 꽉 차면 JIT이 멈추고 인터프리터로 떨어지는 절벽이 생깁니다

**Direct Memory(다이렉트 메모리, GC 힙 외부의 네이티브 주소 공간을 직접 할당받아 입출력 성능을 극대화하는 off-heap 버퍼 영역)** 는 `DirectByteBuffer`나 Netty가 쓰는 off-heap 버퍼입니다. 그런데 이것의 정체가 재미있습니다

내부적으로는 결국 **네이티브 `malloc`을 탑니다**. 11편에서 뜯어본 바로 그 ptmalloc입니다

11편의 마지막 그림에서 Java가 GC 힙을 건너뛰고 libc malloc으로 곧장 가던 그 붉은 점선이 이것입니다. 여기에는 11편에서 본 **arena 폭발**도 그대로 적용됩니다

자바 컨테이너 튜닝에서 `MALLOC_ARENA_MAX`가 단골로 등장하는 이유가 이것입니다. 자바 이야기인 줄 알았는데 glibc 이야기였던 셈입니다

**여기서 10편의 복선이 닫힙니다**

컨테이너의 cgroup은 [10편](/essays/kernel-lazy-allocation-page-fault)에서 본 대로 **모든 층의 RSS 합**을 셉니다. 그런데 `-Xmx`는 그중 GC 힙만 제한합니다

그래서 `-Xmx=2G`로 힙을 묶어도 Metaspace·코드 캐시·다이렉트 메모리가 부풀면 프로세스 RSS가 컨테이너 한도를 넘습니다. 그 순간 **OOMKilled**입니다

"힙은 60%인데 컨테이너가 죽는다"는 자바의 대표적 미스터리가 바로 이 힙 밖 지형 때문입니다

대응은 이렇습니다. 컨테이너에서는 `-Xmx`를 손으로 고정하기보다 컨테이너 메모리를 인식하는 **`-XX:MaxRAMPercentage`** 로 힙 상한을 자동 계산하게 하되, **힙 밖 몫을 반드시 남겨** 둬야 합니다

기본값을 알아 두면 좋습니다. JDK 25의 `MaxRAMPercentage` 기본값은 **25%** 입니다. 보수적으로 잡혀 있습니다

12편에서 본 Go의 `GOMEMLIMIT` 이야기와 정확히 같은 고민입니다. 컨테이너 한도의 전부를 힙에 주면 안 되고, 힙 밖을 남겨 둬야 한다는 것

언어는 달라도 물리는 똑같습니다

## 스칼라 치환 — 할당을 아예 없애기

가장 싼 할당은 하지 않는 할당입니다

C2 JIT이 이스케이프 분석으로 "이 객체는 이 메서드 밖으로 새지 않는다"를 증명하면, 객체를 **만들지 않고** 그 필드들을 레지스터와 스택 값으로 흩어 버립니다

할당 횟수가 0이 됩니다. [7편](/essays/java-jit-c2-runtime-optimization)에서 본 **스칼라 치환**입니다

그런데 여기서 셋의 성격이 갈립니다

![The same question, answered at a different time](/diagrams/jvm-tlab-bump-pointer-offheap-9.svg)

그림 왼쪽이 Rust와 Go입니다. **컴파일 시점**에 스택이냐 힙이냐를 정합니다

AOT라 늘 같은 답이 나옵니다. **결정적입니다**

오른쪽이 Java입니다. **실행 시점**에 JIT이 판단합니다

그런데 이 판단에는 조건이 붙습니다. JIT이 그 메서드를 자주 실행된다고 판정해 컴파일해야 하고, 인라이닝이 성공해야 하고, 객체가 정말 안 새야 합니다

게다가 표준 C2의 이스케이프 분석은 **전부 아니면 전무(all-or-nothing)** 입니다

객체가 **어느 한 분기에서라도** 새면 치환을 통째로 포기합니다. `if`와 `else`가 서로 다른 객체를 반환해 참조가 합류하거나, 객체가 인라이닝되지 않은 메서드로 넘어가면 그대로 힙에 할당됩니다

그리고 8편에서 본 **역최적화(deopt)** 로 뒤집힐 수도 있습니다

그래서 "치환될 것 같던" 객체가 실제 프로파일에서는 힙에 잡히는 괴리가 생깁니다

GraalVM에는 이보다 영리한 **부분 이스케이프 분석(partial escape analysis)** 이 있어, 객체가 새지 않는 경로에서만 치환하기도 합니다

정리하면 이렇습니다. Java의 "할당 없음"은 강력하지만 **불확실**하고, Go와 Rust의 "스택 할당"은 소박하지만 **예측 가능**합니다

[9편](/essays/java-jit-inversion-conditions)에서 내린 "정점 처리량은 Java, tail과 예측 가능성은 Go·Rust"라는 결론이 여기서도 똑같이 메아리칩니다

## 무엇을 돌릴 수 있나

**이스케이프를 줄여 스칼라 치환이 걸리게 합니다.** 짧게 살고 밖으로 새지 않는 객체는 메서드 안에 가두고, 인라이닝을 방해하지 않게 짭니다

확인은 JITWatch나 `-XX:+PrintEscapeAnalysis`로 합니다. 다만 후자는 fastdebug 빌드에서만 동작합니다

**compact object headers로 헤더 세금을 줄입니다.** 작은 객체가 많은 워크로드라면 JDK 25에서 `-XX:+UseCompactObjectHeaders`로 헤더를 8바이트로 줄일 수 있습니다

어차피 JDK 27에서 기본이 될 예정이니, 미리 켜서 검증해 두면 옮겨 갈 때 치를 비용을 미리 치르는 셈입니다

**TLAB를 관측합니다.** 여기서 draft나 오래된 글을 따라가면 안 되는 지점이 하나 있습니다

옛 자료가 흔히 권하는 `-XX:+PrintTLAB`는 **JDK 25에 존재하지 않습니다**. 실제로 주면 이렇게 거절당합니다

```text
Unrecognized VM option 'PrintTLAB'
Error: Could not create the Java Virtual Machine.
```

지금의 방법은 통합 로깅입니다. **`-Xlog:gc+tlab=trace`** 로 앞서 본 `desired_size`·`refills`·`waste %`를 봅니다. JFR의 TLAB 할당 이벤트도 같은 정보를 줍니다

**NUMA 인식 할당을 검토합니다(`-XX:+UseNUMA`, 기본 꺼짐).** TLAB는 락만 없애는 게 아닙니다

NUMA(Non-Uniform Memory Access, 다중 CPU 소켓 구조에서 각 프로세서가 자신에게 물리적으로 가까운 로컬 메모리 노드에 접근할 때 원격 메모리보다 훨씬 빠르고 지연 시간이 낮아지는 하드웨어 아키텍처) 장비, 곧 CPU마다 물리적으로 가까운 메모리 노드가 따로 있는 장비에서 이 옵션을 켜면, JVM이 스레드가 도는 CPU와 **가까운 노드**에 TLAB와 young 영역을 배치합니다

메모리 접근 지연은 결국 CPU와 메모리 노드 사이의 **물리적 거리**가 좌우합니다. 먼 노드의 메모리를 읽으면 가까운 노드보다 느립니다

NUMA 인식 할당은 그 거리를 할당 시점에 미리 줄여 두는 것입니다. 멀티소켓 서버나 대형 인스턴스에서 효과가 큽니다

JDK 25에서 확인해 보면 기본이 꺼져 있습니다. NUMA 장비라면 켜 보는 것이 값어치를 합니다

**힙 밖을 반드시 함께 계측합니다.** `-XX:NativeMemoryTracking=summary`를 켜고 `jcmd <pid> VM.native_memory`로 Metaspace·코드 캐시·다이렉트·스택을 각각 봅니다

컨테이너 한도는 `-Xmx`가 아니라 이 **총합**에 맞춰야 합니다

## 세 언어 수렴 비교 — 할당 삼부작의 결산

11편부터 13편까지를 한 표로 접겠습니다

| 축 | Java (HotSpot) | Rust | Go |
| --- | --- | --- | --- |
| 소형 할당의 빠른 경로 | **TLAB bump-the-pointer** | malloc의 tcache 슬롯 (스레드별) | mcache의 span 슬롯 (`P`별, 비트맵) |
| 그게 가능한 근거 | **Eden을 통째로 비우는 moving GC** | free list 재사용 | 크기 클래스 규격 + `P`별 캐시 |
| 객체마다 붙는 헤더 | 12~16B (compact 8B) | 없음 (구조체 = 필드뿐) | 없음 (메타는 span에) |
| 이스케이프 판정 시점 | 실행(JIT) · **조건부** (deopt 가능) | 컴파일(AOT) · 결정적 | 컴파일(AOT) · 결정적 |
| 안 새는 객체의 처리 | 스칼라 치환으로 아예 제거 | 스택에 둠 | 고루틴 스택에 둠 |
| 회수 | 세대별 **moving** GC | 프로그래머 · `Drop` | **비이동식** GC |

두 가지가 두드러집니다

첫째, **bump-the-pointer가 셋 중 가장 싼 할당**이지만, 그건 Java가 **가장 무거운 GC**를 짊어졌기 때문에 얻은 것입니다

![The cheaper the allocation, the heavier the runtime that pays for it](/diagrams/jvm-tlab-bump-pointer-offheap-10.svg)

그림의 두 선이 정확히 반대로 움직입니다

붉은 선이 **할당 비용**입니다. Rust의 malloc bin에서 Go의 비트맵을 거쳐 Java의 bump로 갈수록 내려갑니다

보라색 선이 **런타임이 짊어지는 회수 부담**입니다. 같은 순서로 올라갑니다

Rust는 회수를 프로그래머에게 맡기고, Go는 비이동식 GC를 돌리고, Java는 객체를 옮기는 세대별 GC를 돌립니다

할당의 싸구려와 GC의 무거움은 **한 거래의 양면**입니다. 하나를 사면 다른 하나를 내야 합니다

이 그림은 정확한 배율을 재는 것이 아니라 방향을 보는 것입니다. 셋 다 빠른 경로 자체는 충분히 빠릅니다

둘째, **이스케이프 처리의 시점이 갈립니다**

Go와 Rust는 컴파일 시점에 결정적으로 정하고, Java는 실행 시점에 조건부로 시도합니다

그래서 Java의 최적화는 천장이 높고, Go와 Rust의 최적화는 바닥이 단단합니다

## 트레이드오프 소결

JVM은 할당을 **덧셈 한 번**까지 깎아 냈습니다

스레드마다 Eden 한 조각(TLAB)을 떼어 줘 경합을 없앴고, moving GC가 Eden을 통째로 비워 주기에 포인터를 앞으로 밀기만 하면 됐습니다

여기까지는 순수한 이득입니다. 그 대가는 세 곳에서 청구됩니다

첫째, **객체마다 12~16바이트의 헤더**입니다. 작은 객체가 많을수록 힙과 캐시를 갉아먹습니다. compact object headers가 이를 8바이트로 줄이고 JDK 27에서 기본이 될 예정이며, Valhalla는 아예 없애려 합니다

둘째, **힙 밖의 지형**입니다. Metaspace·코드 캐시·다이렉트 메모리·스레드 스택이 `-Xmx` 바깥에서 부풀어 OOMKilled를 일으킵니다

셋째, 그리고 가장 근본적으로, bump-the-pointer라는 편의 전체가 **moving GC라는 빚**을 담보로 합니다

한 문장으로 접겠습니다

**Java는 "할당을 세상에서 제일 싸게, 대신 그 편의를 GC와 객체 헤더로 갚는다"를 택했습니다**

[12편](/essays/go-allocator-mcache-contiguous-stack)의 Go와 방향은 같되 더 극단으로 밀어붙였고, [11편](/essays/ptmalloc-rust-malloc-delegation)의 Rust와는 정반대 끝입니다

그 빚의 상환 명세서가 4부입니다

## DevOps 관점에서 더 파고들 질문

1. **컨테이너 한도 산정** — `-Xmx`만 보면 왜 OOMKilled가 발생할까요? `jcmd <pid> VM.native_memory summary`로 Metaspace·코드 캐시·다이렉트·스택을 각각 얼마로 보고, 한도를 총합의 몇 %로 잡아야 안전할까요?
2. **MaxRAMPercentage의 기본값** — JDK 25의 기본값이 25%인데, 이 보수적인 값을 언제 올려야 하고 언제 그대로 둬야 할까요? 고정 `-Xmx`와 `-XX:MaxRAMPercentage` 중 무엇을 어떤 근거로 택해야 할까요?
3. **Humongous 진단** — 힙이 4GB면 region이 2MB라 1MB 버퍼부터 humongous입니다. `-Xlog:gc+heap=debug`로 humongous 할당을 어떻게 관측하고, 큰 버퍼를 잘게 나누거나 재사용해 IHOP 조기 트리거를 어떻게 막을 수 있을까요?
4. **할당률과 TLAB** — Minor GC가 잦다면 Eden이 작거나 할당률이 높다는 뜻일 수 있습니다. 할당률을 어떻게 계측하고(JFR, GC 로그의 Eden 회수량 ÷ 시간), `-Xlog:gc+tlab`의 `slow allocs`·`waste %`와 어떻게 엮어 봐야 할까요?
5. **스칼라 치환의 괴리** — 치환될 거라 기대한 객체가 실제로는 힙에 잡힙니다. `-XX:+PrintInlining`과 JFR로 인라이닝 실패를 어떻게 확인하고, deopt storm이 개입했는지 어떻게 가려낼 수 있을까요?
6. **압축 oops의 벼랑** — 힙을 32GB 이상으로 키워야 한다면, 압축이 꺼져 참조가 두 배가 되는 손실과 `-XX:ObjectAlignmentInBytes=16`으로 벼랑을 64GB까지 미는 이득을 어떻게 저울질해야 할까요? 정렬을 키우면 늘어나는 패딩 낭비는 어떻게 계측해야 할까요?
7. **compact headers 도입** — JDK 27에서 기본이 되기 전에 미리 켜서 검증한다면, 이득(힙·CPU·GC 횟수)을 어떻게 A/B로 측정하고, 켜기 전 호환성(에이전트·`Unsafe`·직렬화)에서 무엇을 확인해야 할까요?

## 핵심 요약

- 자바 객체는 세대별 힙의 **Eden**에서 태어납니다. Eden이 차면 Minor GC가 **산 객체만 복사**하고 Eden을 통째로 비웁니다. 죽은 객체는 찾아가지도 않으므로, 비용은 산 객체 수에만 비례합니다
- **TLAB**는 각 스레드에게 미리 떼어 준 Eden 한 조각입니다. 자기만의 것이라 동기화가 필요 없습니다. 12편의 mcache가 `P`마다 하나여서 락이 없던 것과 같은 논리입니다
- 할당은 **bump-the-pointer**, 곧 `top`을 객체 크기만큼 미는 것이 전부입니다. 락도 CAS도 목록 순회도 없는, 사실상 덧셈 한 번입니다
- **이게 가능한 이유는 moving GC입니다.** 포인터를 앞으로만 밀려면 누군가 주기적으로 그 땅을 통째로 비워 줘야 합니다. malloc과 Go는 객체를 옮기지 않아 구멍을 재활용해야 하고, 그래서 free list와 비트맵이 필요합니다
- bump-the-pointer는 공짜가 아니라 **"GC가 나중에 옮겨 주겠다"는 약속을 담보로 당겨 쓴 편의**입니다. Generational ZGC는 그 이사를 애플리케이션을 멈추지 않고 하는데, JDK 24에서 비세대 모드가 제거돼 이제 ZGC는 세대별 전용입니다
- TLAB가 차면 크기에 따라 갈립니다. 은퇴 후 새 TLAB(자투리에는 더미 객체를 채움) → Eden 공용 영역 직접 할당(CAS) → **Humongous**(region의 50% 이상, Old로 직행)
- **G1 region 크기는 힙에서 파생됩니다**(힙 ÷ 2048, 1MB~32MB). 힙 4GB면 region 2MB라 **1MB 버퍼가 이미 humongous**입니다. humongous 객체는 이사 대상에서 빠지고 IHOP(기본 45) 검사로 동시 마킹을 앞당겨 트리거합니다
- TLAB 크기는 `ResizeTLAB`가 스스로 조절합니다. 목표는 GC 주기당 약 50회 refill(`100 ÷ (2 × TLABWasteTargetPercent)`)입니다. 관측은 `-Xlog:gc+tlab=trace` — **`-XX:+PrintTLAB`는 JDK 25에 없습니다**
- **모든 자바 객체는 헤더를 답니다.** mark word 8B + klass 4B = 12B이고, 패딩까지 하면 필드 없는 객체도 16B입니다. Rust 구조체와 Go 객체에는 이런 헤더가 없습니다
- **압축 oops의 벼랑은 정확히 32GB입니다.** 넘으면 모든 참조가 4B에서 8B로 부풀어, 힙을 키웠는데 담을 수 있는 객체는 오히려 줄 수 있습니다. `-XX:ObjectAlignmentInBytes=16`이 그 벼랑을 약 64GB로 밉니다
- 헤더를 줄이는 흐름이 진행 중입니다. **JEP 450**(JDK 24 실험) → **JEP 519**(JDK 25 정식, opt-in) → **JEP 534**(JDK 27 기본값). SPECjbb2015에서 힙 22%·CPU 8%·GC 15% 감소가 보고됐고, Valhalla(JEP 401)는 헤더를 아예 없애려 합니다
- **`-Xmx`는 GC 힙만 감쌉니다.** Metaspace(사실상 무제한)·코드 캐시(240MB)·다이렉트 메모리(≈`-Xmx`)·스레드 스택은 그 바깥이고, cgroup은 이 전부의 RSS를 셉니다. 10편의 "힙은 60%인데 OOMKilled"가 여기서 닫힙니다
- 다이렉트 메모리는 결국 **네이티브 malloc**을 탑니다. 11편의 ptmalloc이고, `MALLOC_ARENA_MAX`가 자바 컨테이너 튜닝에 등장하는 이유입니다
- 이스케이프 처리의 **시점**이 셋을 가릅니다. Go·Rust는 컴파일 시점에 결정적으로, Java는 실행 시점에 조건부로(deopt로 뒤집힘). Java의 "할당 없음"은 강력하지만 불확실하고, Go·Rust의 "스택 할당"은 소박하지만 예측 가능합니다
- **할당이 쌀수록 런타임이 짊어지는 회수 부담이 무겁습니다.** 이건 한 거래의 양면입니다. Java는 그 거래를 가장 멀리 밀어붙였습니다

---

**[다음 편 예고]**
이로써 세 언어가 커널의 큰 덩어리를 잘게 나누는 세 가지 방식을 모두 봤습니다. malloc의 arena와 bin, Go의 mcache와 span, 그리고 JVM의 TLAB와 Eden
다음 편은 3부를 닫습니다. 이 셋을 한자리에 모아 수렴 비교하고, 세 절이 계속 미뤄 온 질문 하나에 다리를 놓습니다
**"그래서 왜 GC가 필연이 되는가."** 할당을 싸게 만들수록 회수의 짐이 어떻게 런타임으로 넘어오는지를 정리하며, 4부로 넘어갑니다
