---
title: "malloc이 성공해도 왜 물리 메모리는 아직 없을까 — 게으른 커널과 페이지 폴트"
excerpt: "malloc(1MB)이 돌아와도 물리 메모리는 한 장도 할당되지 않았습니다. 커널이 한 일은 VMA라는 장부 한 줄 등록뿐이고, 진짜 프레임은 첫 write의 페이지 폴트에서야 붙습니다. 가상 주소와 MMU, 4단계 페이지 테이블 워크, TLB라는 조용한 병목, overcommit과 OOM Killer까지 — 세 언어가 딛고 선 맨 아래층을 해부합니다"
category: runtime
tags:
  - rust
  - go
  - java
  - kernel
  - memory
  - page-fault
series:
  name: "kernel-runtime-tradeoffs"
  order: 8
date: "2026-07-03"
---

> **시리즈 "커널과 런타임으로 톺아보는 Rust · Go · Java"의 8편**
> [7편](/essays/java-jit-inversion-conditions)에서 2부를 닫으며 말했습니다. 기계어가 끊임없이 만지는 대상은 결국 메모리라고요. 3부는 그 메모리가 어디서 오는지를 밑바닥부터 올라가며 해부합니다
> 그리고 2부에 일부러 심어 둔 부정확한 문장 하나를 바로잡으며 시작합니다. "Rust는 런타임이 없으니 `brk`/`mmap`을 직접 호출한다"는 그 뉘앙스입니다
> 이번 편은 맨 아래층, 커널입니다. `malloc(1MB)`이 성공해도 물리 메모리가 아직 없다는 것 — "메모리를 받았다"가 물리적으로 무슨 뜻인지가 이번 편의 질문입니다

## 2부의 오해부터 정정합니다

[4편](/essays/rust-aot-zero-cost-codegen)에서 Rust를 다룰 때 "런타임이 없어 커널과 직거래한다"는 인상을 남겼습니다. 정확히 하겠습니다

Rust 표준 라이브러리의 기본 힙 할당자는 `#[global_allocator]`로 따로 지정하지 않는 한 **`System` 할당자**입니다. 그리고 `System`은 플랫폼의 **libc `malloc`/`free`에 그대로 위임**합니다

즉 `Vec::with_capacity(n)`은 커널을 직접 부르지 않습니다. 호출은 `alloc::alloc` → `System.alloc` → libc `malloc`으로 내려가고, **그 `malloc`이 아래에서** 필요할 때에만 `brk`나 `mmap`을 골라 커널을 부릅니다

Rust에 "런타임이 없다"는 말은 GC와 스케줄러가 없다는 뜻이지, 메모리 관리 계층이 없다는 뜻이 아닙니다. malloc이라는 유저 공간 할당 계층은 Rust에도, C에도 똑같이 깔려 있죠

그래서 3부는 아래에서 위로 쌓아 올립니다

![Part three climbs from the kernel up to the language runtimes](/diagrams/kernel-lazy-allocation-page-fault-1.svg)

그림 맨 아래가 커널입니다. 페이지, 페이지 폴트, overcommit이 사는 층이고 이번 편의 무대입니다

가운데가 유저 공간 할당자입니다. libc의 malloc, Go의 자체 할당자, JVM의 TLAB가 여기 삽니다. [9편](/essays/ptmalloc-rust-malloc-delegation)부터 층별로 엽니다

맨 위가 세 언어입니다. Rust는 libc에 위임하고, Go는 자체 런타임 할당자를 쓰고, JVM은 GC 힙을 얹습니다

위의 세 언어가 무엇을 하든 물리 메모리는 결국 커널이 내어 줍니다. 그 "내어 줌"이 물리적으로 무슨 일인지 먼저 세워 두지 않으면, 위층 할당자들의 설계가 전부 이유 없는 복잡함으로만 보입니다

왜 malloc은 arena를 두고, 왜 Go는 span을 두며, 왜 JVM은 TLAB를 두는지. 답은 전부 이 층에 있습니다

## 가상 주소는 약속입니다

프로세스 안의 코드가 `0x5566_1234_0000` 같은 주소를 읽고 쓸 때, 그 숫자는 **가상 주소(virtual address)** 입니다. 물리 RAM 칩의 실제 번지가 아닙니다

CPU가 메모리 컨트롤러에 실제로 올리는 번지는 **물리 주소(physical address)** 이고, 이 둘은 다릅니다

둘 사이를 **MMU(Memory Management Unit)** 라는 CPU 내장 하드웨어가 메모리 접근이 있을 때마다 변환해 줍니다

![The same virtual address maps to different physical frames per process](/diagrams/kernel-lazy-allocation-page-fault-2.svg)

그림 왼쪽의 두 프로세스를 보면, 둘 다 똑같이 `0x1000`이라는 주소를 씁니다

가운데 MMU가 각자의 변환표로 번역한 결과는 다릅니다. A의 `0x1000`은 물리 프레임 12번에, B의 `0x1000`은 87번에 떨어집니다

왜 이렇게 한 겹을 덧댈까요. 이 한 겹으로 네 가지를 한꺼번에 얻기 때문입니다

- **격리** — 변환표가 프로세스마다 따로라, 그림처럼 같은 주소가 서로 다른 프레임을 가리킵니다. 한 프로세스가 남의 메모리를 건드릴 길이 원천적으로 막힙니다
- **연속성의 환상** — 물리 메모리가 조각나 있어도 가상 주소 공간에서는 연속된 하나로 보이게 매핑할 수 있습니다
- **overcommit과 게으른 할당** — 가상 주소는 값싼 장부 한 줄이라, 물리 프레임 없이 먼저 대량으로 "약속"만 해 둘 수 있습니다. 뒤에서 자세히 봅니다
- **스왑과 파일 매핑** — 어떤 가상 페이지의 실제 내용은 물리 RAM이 아니라 디스크(스왑)나 파일에 두어도 됩니다

## 페이지와 프레임, 그리고 페이지 테이블

이 매핑을 바이트 단위로 관리하면 변환표가 감당할 수 없이 커집니다. 그래서 주소 공간을 고정 크기 블록으로 자릅니다

가상 쪽의 블록을 **페이지(page)**, 물리 쪽의 같은 크기 블록을 **프레임(frame)** 이라 부릅니다. 매핑은 언제나 "페이지 → 프레임" 단위로만 이뤄집니다

크기는 아키텍처마다 다릅니다

- x86-64 기본 페이지: **4KB**(4096바이트)
- Apple Silicon(M 시리즈, ARM64): **16KB**. 리눅스 ARM64도 커널 빌드 옵션으로 4KB/16KB/64KB 중 하나를 고를 수 있습니다. 이 차이는 곧 TLB에서 중요해집니다
- 큰 페이지: **2MB와 1GB**. huge page라 부르며 뒤에서 다룹니다

변환표의 이름이 **페이지 테이블(page table)** 입니다. 프로세스마다 하나씩 있는데, 통째로 두면 너무 큽니다. 48비트 주소를 4KB로 나누면 항목이 2^36개니까요

그래서 계층 트리로 쪼갭니다. 대부분의 주소 공간은 비어 있으므로, 실제로 쓰는 가지만 만들면 표가 훨씬 작아집니다

![A four-level page table walk on x86-64](/diagrams/kernel-lazy-allocation-page-fault-3.svg)

그림 위쪽 띠가 48비트 가상 주소의 해부입니다. 9비트짜리 인덱스 네 개(PML4·PDPT·PD·PT)와 12비트 오프셋으로 쪼개집니다. 12비트가 4096, 곧 페이지 안에서의 위치입니다

아래쪽이 실제 변환 여정입니다. **CR3**라는 레지스터가 최상위 테이블(PML4)의 위치를 가리키고, 주소에서 뽑은 9비트 인덱스로 다음 테이블을 차례로 찾아 내려갑니다

마지막 PT의 항목이 **PTE(Page Table Entry)** 입니다. 물리 프레임 번호(PFN)와 플래그가 들어 있고, 여기에 오프셋을 붙이면 물리 주소가 완성됩니다

그림 왼쪽 아래 붉은 상자가 이 구조의 비용입니다. **한 번의 변환에 메모리 접근이 4번** 듭니다. 5단계 페이징(LA57, 57비트 가상 주소)을 켜면 5번이 되죠

이 그림에서 챙길 하드웨어 사실이 셋 있습니다

첫째, 최상위 테이블의 위치는 x86-64에서 `CR3`, ARM64에서 `TTBR0_EL1`·`TTBR1_EL1` 레지스터가 가리킵니다. ARM64는 유저 주소와 커널 주소를 두 레지스터로 나눠 갖죠. 문맥 교환 때 이 레지스터를 바꾸는 순간 프로세스는 다른 주소 공간으로 갈아탑니다

둘째, PTE에는 플래그가 삽니다. P(present)·R/W·U/S·A(accessed)·D(dirty)·NX(실행 금지) 같은 비트들입니다

셋째가 이번 편의 스위치입니다. **PTE의 P(present) 비트가 0이면, 그 페이지에는 아직 물리 프레임이 붙어 있지 않다는 뜻입니다**

그 주소에 접근하면 페이지 폴트가 납니다. 바로 이 한 비트가 "게으른 할당"의 스위치입니다

ARM64도 모양은 같습니다. 4KB 페이지에 48비트 주소면 L0~L3의 4단계, 각 9비트 인덱스에 12비트 오프셋입니다

Apple의 16KB 페이지는 오프셋이 14비트(16KB=2^14), 각 레벨 인덱스가 11비트(2048개 항목)입니다. 11×3+14=47이라 47비트 주소는 3단계로 덮이고, 48비트를 다 쓰려면 최상위에 항목 2개짜리 부분 레벨이 하나 더 붙습니다

페이지가 크고 워크 한 단계가 더 넓은 주소를 덮는다는 것. 이게 바로 다음 TLB 이야기와 이어집니다

## TLB — 조용한 성능 병목

메모리 접근마다 4번씩 테이블을 타고 내려가면 프로그램이 그만큼 느려집니다

그래서 CPU는 최근 변환 결과("이 가상 페이지 → 저 물리 프레임")를 **TLB(Translation Lookaside Buffer)** 라는 아주 빠른 소형 캐시에 담아 둡니다

![A TLB hit is nearly free; a miss pays the whole page walk](/diagrams/kernel-lazy-allocation-page-fault-4.svg)

그림 가운데 TLB에서 길이 갈립니다

위쪽 초록 경로가 **히트**입니다. 변환이 캐시에 있으니 사실상 1사이클 안에 물리 주소가 나옵니다

아래쪽 붉은 경로가 **미스**입니다. 방금 본 4단계 페이지 워크를 돌아야 하고, 수십에서 수백 사이클이 듭니다. 워크 도중 캐시 미스가 겹치면 더 걸리죠. x86과 ARM 모두 이 워크는 하드웨어가 자동으로 합니다

TLB가 한 번에 덮을 수 있는 메모리 범위를 **TLB reach**라 부릅니다. (TLB 엔트리 수) × (페이지 크기)입니다

작업집합이 이 범위를 넘나들면 TLB 미스가 끊이지 않습니다. 대표 수치를 보겠습니다(마이크로아키텍처마다 다르므로 어디까지나 예시입니다)

| CPU | L1 dTLB (4KB 기준) | L2/통합 TLB | TLB reach (L2 기준) |
| --- | --- | --- | --- |
| 인텔 최신 코어 | 약 96 엔트리 | 약 2,048 엔트리 | 2,048 × 4KB ≈ 8MB |
| Apple M1 (Firestorm) | 160 엔트리 | 3,072 엔트리 | 3,072 × 16KB ≈ 48MB |

여기서 16KB 페이지의 이점이 드러납니다. **엔트리 수가 같아도 페이지가 4배 크면 TLB가 덮는 메모리가 4배**입니다

Apple이 16KB를 기본으로 고른 이유 중 하나가 이 넓은 reach와 얕은 페이지 워크입니다. x86에서 같은 효과를 얻는 방법이 뒤에 나올 huge page고요

왜 이게 중요한가 하면, 여기까지가 "주소를 하나 읽는다"의 진짜 비용 구조이기 때문입니다

데이터가 캐시에 멀쩡히 있어도, 그 주소를 물리 주소로 바꾸는 TLB 단계에서 미스가 나면 수백 사이클이 조용히 샙니다

[5편](/essays/go-aot-fast-build-tradeoff)에서 세운 데이터 지역성이라는 축이 사실은 캐시 지역성만이 아니라 **TLB 지역성**이기도 한 이유입니다. 큰 힙을 무작위로 훑는 GC나 해시맵은 TLB를 통째로 갈아엎습니다

### 문맥 교환과 태그 — PCID와 ASID

앞에서 CR3를 바꾸면 주소 공간이 갈린다고 했습니다. 여기엔 함정이 하나 있습니다

같은 가상 주소가 프로세스마다 다른 프레임을 가리키므로, 아무 표시가 없다면 문맥 교환 때마다 **TLB 전체를 비워야(flush)** 합니다

교체 직후 모든 접근이 TLB 미스로 시작하는 '콜드 TLB' 상태가 되는 것이죠

그래서 하드웨어는 각 TLB 엔트리에 주소 공간 식별자를 태그로 붙입니다. x86-64는 **PCID**(Process-Context Identifier, 12비트), ARM64는 **ASID**(Address Space Identifier, 8/16비트)입니다

태그가 있으면 교체할 때 TLB를 비우지 않습니다. 조회할 때 현재 PCID/ASID와 일치하는 엔트리만 히트로 인정하면, 남의 주소 공간 엔트리는 그대로 남겨 둬도 안전하니까요

이 대목이 [1편](/essays/syscall-mode-switch-cost)과 정확히 맞물립니다

KPTI(멜트다운 완화 기법)는 프로세스 교환도 아닌 **매 user↔kernel 전환마다** CR3를 스왑합니다. 유저용과 커널용 페이지 테이블을 분리하려고요

만약 PCID가 없다면 그 스왑이 매번 TLB를 비워서, 시스템 콜 하나하나가 콜드 TLB로 다시 시작할 겁니다

실제로는 유저와 커널에 서로 다른 PCID를 배정해, CR3 스왑이 TLB를 보존하게 만듭니다. 1편에서 말한 'KPTI 세금'의 크기가 PCID 지원 유무에 따라 크게 갈리는 이유가 이것입니다

하나 더 곁들이면, TLB 미스가 나도 매번 4번 접근을 처음부터 다 하지는 않습니다

CPU는 상위 단계 엔트리(PML4·PDPT·PD)를 **페이징 구조 캐시**(paging-structure caches)에 따로 담아, 인접한 주소의 워크를 중간 단계부터 재개합니다. 그래서 '4번 접근'은 최악값이고, 실제 미스 비용은 이 캐시 덕에 짧아집니다

## brk와 mmap — 커널에 장부만 등록하는 시스템 콜

이제 할당 이야기로 들어갑니다. 유저 공간이 커널에 메모리를 요청하는 통로는 사실상 둘입니다

**`brk`/`sbrk`** 는 힙의 끝 경계선(program break)을 위로 밀어 연속된 힙 영역을 넓힙니다. 인자는 새 경계 주소 하나입니다. `brk(0)`은 현재 경계를 돌려주죠

**`mmap`** 은 주소 공간에 새 매핑 구간을 통째로 만듭니다. `MAP_ANONYMOUS`면 0으로 초기화될 익명 메모리, 파일 fd를 주면 그 파일 내용이 매핑됩니다. 인자는 6개입니다

실제 호출을 x86-64와 ARM64 어셈블리로 나란히 보겠습니다

흥미로운 규약 하나를 짚으면, x86-64 시스템 콜에서 네 번째 인자는 `rcx`가 아니라 `r10`을 씁니다. `syscall` 명령이 복귀 주소를 `rcx`에 덮어써 버리기 때문입니다. [1편](/essays/syscall-mode-switch-cost)의 커널 진입 경로와 이어지는 이야기죠

```asm
; ---- x86-64: mmap(NULL, 1MiB, PROT_READ|WRITE, MAP_PRIVATE|ANON, -1, 0) ----
    xor  rdi, rdi          ; arg0 addr   = NULL (커널이 위치를 고름)
    mov  rsi, 0x100000     ; arg1 len    = 1 MiB
    mov  rdx, 3            ; arg2 prot   = PROT_READ(1)|PROT_WRITE(2)
    mov  r10, 0x22         ; arg3 flags  = MAP_PRIVATE(0x02)|MAP_ANONYMOUS(0x20)
    mov  r8,  -1           ; arg4 fd     = -1
    xor  r9,  r9           ; arg5 offset = 0
    mov  rax, 9            ; __NR_mmap   = 9
    syscall

; ---- x86-64: brk(new_break) ----
    mov  rdi, new_break    ; arg0
    mov  rax, 12           ; __NR_brk    = 12
    syscall
```

```asm
; ---- AArch64(ARM64): 같은 mmap. 인자는 x0~x5, 콜 번호는 x8, 트랩은 svc ----
    mov  x0, xzr           ; addr = NULL
    mov  x1, #0x100000     ; len  = 1 MiB
    mov  x2, #3            ; prot = R|W
    mov  x3, #0x22         ; flags= MAP_PRIVATE|MAP_ANONYMOUS
    mov  x4, #-1           ; fd
    mov  x5, xzr           ; offset
    mov  x8, #222          ; __NR_mmap = 222 (asm-generic 테이블)
    svc  #0

; ---- AArch64: brk ----
    mov  x0, new_break
    mov  x8, #214          ; __NR_brk = 214
    svc  #0
```

참고로 콜 번호는 아키텍처마다 다릅니다

| 호출 | x86-64 | ARM64 (asm-generic) |
| --- | --- | --- |
| `mmap` | 9 | 222 |
| `mprotect` | 10 | 226 |
| `munmap` | 11 | 215 |
| `brk` | 12 | 214 |
| `mremap` | 25 | 216 |
| `madvise` | 28 | 233 |

같은 이름인데 번호가 다르죠. 정적 바이너리를 아키텍처별로 다시 빌드해야 하는 이유가 이 층에도 있습니다

**여기가 이번 편의 핵심입니다.** `brk`나 `mmap`이 성공해도 **물리 프레임은 단 한 장도 할당되지 않습니다**

커널이 한 일은 **VMA 구조체를 하나 등록**한 것뿐입니다

## VMA — 약속과 실현의 분리

**VMA(Virtual Memory Area)** 는 프로세스 주소 공간의 한 연속 구간을 기술하는 커널 구조체(`vm_area_struct`)입니다

"이 가상 주소 `[start, end)` 범위는 유효하고, 권한은 R/W이며, 뒤는 익명 메모리다" 같은 **장부 한 줄**이죠. 프로세스가 가진 VMA들의 목록이 곧 `/proc/PID/maps`에 보이는 그 지도입니다

![mmap only writes a ledger entry; the frame arrives at first write](/diagrams/kernel-lazy-allocation-page-fault-5.svg)

그림 왼쪽이 `mmap(1MB)` 직후의 상태입니다

위쪽 보라색 상자가 장부(VMA)입니다. 1MB 범위가 유효하고 읽기·쓰기가 가능한 익명 메모리라고 적혀 있습니다

아래쪽 점선 상자가 물리 RAM입니다. **프레임 0장.** RSS는 1바이트도 늘지 않았습니다

오른쪽이 첫 write의 순간입니다. `*p = 1` 한 줄이 페이지 폴트를 일으키고, 그제서야 커널이 프레임 한 장을 붙이고 PTE를 채웁니다. RSS가 4KB 늘고, 프로그램은 아무 일 없었다는 듯 재개됩니다

즉 **약속(VMA 등록)과 실현(프레임 할당)이 분리되어 있습니다**

이 분리가 리눅스 메모리 관리의 심장입니다

## 페이지 폴트 — 오류가 아니라 할당의 완성

CPU가 어떤 가상 주소에 접근했는데 그 페이지의 PTE가 없거나(present=0) 권한이 맞지 않으면, MMU가 CPU 예외를 일으킵니다

x86-64에서는 `#PF`(Page Fault, 벡터 14), ARM64에서는 Data/Instruction Abort입니다. 제어가 커널의 페이지 폴트 핸들러(`do_page_fault` → `handle_mm_fault`)로 점프하죠

시스템 콜이 아니라 **하드웨어 트랩**이지만, 커널 코드가 개입한다는 점은 같습니다

핸들러는 폴트가 난 주소가 어느 VMA에 속하는지 봅니다

- **VMA에 속하는 정당한 접근이면** — 커널이 물리 프레임을 붙이고 PTE를 채웁니다. 프로그램은 재개됩니다. 이게 바로 **할당이 완료되는 지점**입니다
- **어느 VMA에도 없는 주소면** — 진짜 잘못된 접근이므로 `SIGSEGV`, 곧 세그폴트입니다

정당한 폴트는 비용에 따라 다시 둘로 나뉩니다

![Minor faults stay in RAM; major faults go to disk](/diagrams/kernel-lazy-allocation-page-fault-6.svg)

그림 왼쪽이 **minor fault**(소프트 폴트)입니다. 디스크 I/O가 없습니다

커널이 이미 가진 프레임을 붙이면 끝입니다. 처음 만지는 익명 페이지에 새 프레임을 주는 경우, 이미 page cache에 있는 공유 라이브러리 코드를 공유하는 경우가 여기 속합니다. 비용은 대략 수백에서 수천 사이클입니다

오른쪽이 **major fault**(하드 폴트)입니다. 페이지 내용을 **디스크나 스왑에서 읽어와야** 하므로 실제 I/O가 일어납니다

비용은 수 마이크로초(NVMe)에서 수 밀리초(HDD·스왑)까지입니다. minor보다 **1,000배 넘게** 커질 수 있죠

이 메커니즘 전체의 이름이 **demand paging(요구 페이징)** 입니다. 접근할 때 비로소 프레임을 준다는 뜻이죠

그래서 `malloc(1MB)` 직후 그 메모리는 가상으로만 존재합니다. `memset`이나 첫 write로 페이지를 하나씩 만질 때마다 minor fault가 나면서 실제 프레임이 4KB씩 붙고, RSS는 이때 오릅니다

숫자로 정리하면 이렇습니다. `malloc(1MB)` 후 `memset(p, 0, 1MB)`의 진짜 물리 흐름은:

- `malloc`: `mmap` 또는 `brk` **1회** — [1편](/essays/syscall-mode-switch-cost)에서 잰 시스템 콜 왕복 약 1,400사이클. 결과는 VMA 등록, 프레임 0장
- `memset`: 1MB ÷ 4KB = **256개 페이지**를 처음 만짐 → 페이지마다 minor fault 1회, 총 256회 → 커널이 프레임 256장을 붙이고 RSS +1MB

"1MB 할당"의 진짜 비용은 시스템 콜 1회가 아니라 **시스템 콜 1회 + 폴트 256회 + TLB 워밍업**입니다

운영 관점으로 바로 번역하면 이렇습니다. 프로세스가 뜰 때 RSS가 천천히 오르는 이유, "메모리를 미리 잡아 두었다"는 서비스가 첫 요청에서 지연 스파이크를 내는 이유(cold page)가 전부 여기 있습니다

대용량 힙을 `-Xmx`로 예약해도 커널은 그걸 즉시 물리화하지 않습니다. JVM의 `-XX:+AlwaysPreTouch`가 부팅 때 힙 전체를 미리 만져 두는 것은, 바로 이 폴트를 시작 시점에 몰아서 치우기 위해서입니다

### zero page와 calloc

익명 페이지를 쓰기 전에 **읽기부터** 하면 커널은 실제 프레임을 주지 않습니다

대신 시스템 공용 **zero page**(0으로 채워진 단 한 장, `empty_zero_page`)를 읽기 전용으로 공유 매핑해 버립니다

![Reads share one zero page; the first write splits off a private frame](/diagrams/kernel-lazy-allocation-page-fault-7.svg)

그림 왼쪽을 보면, 읽기만 한 페이지 세 장이 전부 **한 장의 zero page**를 가리킵니다. 프레임 소비 0, 전부 읽기 전용입니다

오른쪽이 첫 write의 순간입니다. 쓰인 페이지 하나만 **COW(Copy-On-Write)** 로 분리되어 자기만의 프레임을 받고, 이때 비로소 RSS가 늘어납니다. 안 만진 페이지들은 계속 zero page를 공유하죠

그래서 `calloc(n)`은 `mmap`으로 갓 받아 온 메모리가 이미 0임을 알고 `memset`을 생략할 수 있습니다. `malloc`+`memset`보다 빠를 수 있는 이유, "0으로 초기화가 공짜"인 물리적 근거가 이 zero page입니다

## RSS와 VSZ — cgroup이 실제로 세는 값

여기까지 오면 두 지표의 차이가 명확해집니다

- **VSZ**(가상 크기) — 등록된 VMA의 총합, 즉 '약속'의 크기입니다. `mmap`만 잔뜩 해도 커집니다
- **RSS**(Resident Set Size) — 실제로 물리 프레임이 붙은 양, 즉 '실현'의 크기입니다

컨테이너의 cgroup 메모리 회계는 **RSS(더하기 page cache 등 실제 점유)** 를 셉니다

VSZ가 아무리 커도 그것만으로 죽지 않지만, RSS가 한도를 넘으면 죽습니다. [7편](/essays/java-jit-inversion-conditions)에서 본 "힙은 60%인데 OOMKilled"의 물리적 토대가 바로 이 회계입니다. 정밀 해부는 5부에서 합니다

## overcommit — 물리보다 많이 약속하기

리눅스는 프로세스들이 요청한 가상 메모리의 총합이 (물리 RAM + 스왑)을 **넘어도** `mmap`을 허용합니다

대부분의 프로그램이 약속받은 만큼 다 만지지 않기 때문입니다. `fork` 직후 COW로 공유되는 페이지, 희소 배열, 넉넉히 잡아 둔 버퍼. 다 물리화되지 않을 것을 전제로 커널이 "초과 판매"를 하는 겁니다

동작 모드는 `vm.overcommit_memory`로 고릅니다

| 모드 | 이름 | 동작 |
| --- | --- | --- |
| 0 | heuristic (기본) | 커널이 추정해서 명백히 과한 요청만 거절 |
| 1 | always | 무조건 허용 (연구·특수 워크로드) |
| 2 | never / strict | CommitLimit 안에서만 허용 |

모드 2의 한도는 `CommitLimit = swap + RAM × (overcommit_ratio ÷ 100)`이고, `overcommit_ratio` 기본값은 50입니다

![Overcommit sells more promises than reality; the bill is the OOM Killer](/diagrams/kernel-lazy-allocation-page-fault-8.svg)

그림 위쪽 보라색이 약속의 총합(VSZ), 그 아래 노란색이 현실(RAM+스왑)입니다. 약속이 현실보다 큽니다

이 초과 판매의 청구서가 오른쪽 아래, **OOM Killer**입니다

팔아 버린 약속이 실제로 한꺼번에 청구되어 물리 RAM과 스왑이 바닥나면, 커널은 프로세스를 하나 골라 `SIGKILL`로 끝냅니다. 선정 기준은 `oom_score`(대략 RSS에 비례)에 `oom_score_adj`(-1000~+1000 조정값)를 더한 값입니다

그림 왼쪽 아래가 컨테이너 버전입니다. cgroup 메모리 한도 초과는 **cgroup 단위 OOM**을 일으켜 그 컨테이너의 프로세스를 죽입니다. 쿠버네티스가 보고하는 그 **OOMKilled**죠

실무 한계가 하나 더 있습니다. **`vm.max_map_count`**, 곧 프로세스당 VMA 개수 상한입니다

커널 기본값은 65,530입니다. VMA를 잘게 쪼개는 워크로드는 이 한도에 걸려 `mmap`이 `ENOMEM`으로 실패합니다

메모리는 남는데 `mmap`이 안 되는 전형적 장애죠

Elasticsearch가 262,144를 요구하고 여러 배포판이 기본값을 1,048,576으로 올려 둔 이유가 이것입니다

컨테이너 회계를 한 겹 더 보태면, cgroup v2는 두 한도를 구분합니다

- **`memory.max`** — 하드 한도. 회수로도 못 막으면 cgroup OOM으로 죽입니다
- **`memory.high`** — 소프트 한도. 넘으면 강한 회수(reclaim)로 속도를 늦추되 죽이진 않습니다

회수의 성격은 `vm.swappiness`(익명 페이지를 스왑으로 밀지, page cache를 버릴지의 저울)와 zswap/zram(스왑을 압축해 RAM에 얹는 계층)으로 조율됩니다

그래서 같은 'RSS 초과'라도 `memory.high`는 **지연**으로, `memory.max`는 **죽음(OOMKilled)** 으로 나타납니다

## 폴트를 다루는 도구들

커널의 게으름은 기본값일 뿐, 조절 손잡이가 여럿 있습니다

**Huge page (2MB/1GB)** — TLB reach를 키우는 정공법입니다. 두 갈래가 있습니다

- **THP**(Transparent Huge Page) — 커널이 4KB들을 알아서 2MB로 승격·강등합니다. 모드는 `always`/`madvise`/`never`. 투명하고 자동이라는 게 장점이지만, 2MB 연속 프레임을 즉석에서 확보해야 해서 **할당 지연**이 생기고, 2MB 중 일부만 써도 통째로 점유하는 **내부 단편화**, 백그라운드 `khugepaged`의 CPU 사용이 대가입니다. Redis·MongoDB·JVM이 지연 스파이크 때문에 THP를 `madvise`나 `never`로 낮추라고 권고하는 배경이죠
- **HugeTLB** — 부팅이나 런타임에 명시적으로 예약해 두는 huge page 풀입니다. 예측 가능한 대신 미리 떼어 둬야 합니다

**madvise(2)** — 커널에 접근 패턴 힌트를 줍니다. 할당자들이 메모리 반환에 씁니다

- `MADV_DONTNEED` — 프레임을 **즉시 회수**합니다. 다음 접근은 다시 폴트로 시작합니다
- `MADV_FREE` — **지연 회수**입니다. 메모리 압박이 올 때만 회수하고, 그전에 다시 접근하면 프레임을 폴트 없이 재사용합니다
- `MADV_HUGEPAGE`/`MADV_SEQUENTIAL`/`MADV_RANDOM` — 승격·선읽기 힌트입니다

여기서 사실 하나를 정확히 해 두겠습니다. `MADV_FREE`는 jemalloc이 즐겨 쓰고, Go 런타임도 1.12부터 채택했었습니다

그런데 **Go는 1.16에서 기본값을 `MADV_DONTNEED`로 되돌렸습니다.** `MADV_FREE`는 회수가 지연되는 동안 RSS가 줄어든 것으로 보이지 않아서, `top`이나 모니터링 지표가 실제보다 부풀어 보이는 혼란이 컸기 때문입니다

방금 본 "cgroup은 RSS를 센다"와 이어지는 결정입니다. 성능을 조금 내주고 **관측 가능한 RSS**를 택한 것이죠

**Prefaulting** — 폴트를 미리 몰아서 치웁니다. `mmap(..., MAP_POPULATE)`로 매핑 즉시 폴트를 일으키거나, 직접 전체를 한 번 만집니다. 실시간·저지연 서비스가 첫 접근 스파이크를 없애는 방법이고, JVM `AlwaysPreTouch`의 원리입니다

**mlock(2)** — 페이지를 물리 메모리에 고정해(스왑 아웃 금지) major fault를 없앱니다. tail latency에 민감한 서비스가 씁니다

**Folios / mTHP** — 커널 5.16부터 들어온 흐름으로, 연속된 페이지들을 하나의 folio로 묶어 페이지당 메타데이터·락 처리를 큰 단위로 상각합니다. 여러 크기의 THP(mTHP)로 4KB와 2MB 사이의 중간 크기도 지원합니다

## 세 언어 수렴 비교 — 누가 커널과 직접 거래하는가

같은 커널(demand paging·TLB·overcommit) 위에서, **커널과 직접 거래하는 주체**가 언어마다 다릅니다. 3.2~3.4의 예고편입니다

| 언어 | 커널을 부르는 주체 | 그 아래 관리자 | 비고 |
| --- | --- | --- | --- |
| Rust | libc `malloc` (System 할당자) → malloc이 `brk`/`mmap` 선택 | ptmalloc·jemalloc ([9편](/essays/ptmalloc-rust-malloc-delegation)) | 2부 복선 정정 |
| Go | Go 런타임이 `mmap` 직접 호출 (arena 대량 예약) | mheap·mcentral·mcache ([10편](/essays/go-allocator-mcache-contiguous-stack)) | libc 안 씀, 정적 바이너리 |
| Java | JVM이 `mmap`으로 힙 예약 (reserve → commit) | GC 힙 + TLAB ([11편](/essays/jvm-tlab-bump-pointer-offheap)) | 2단계 예약·커밋 |

**Rust** — `Vec`·`Box`는 `System` 할당자, 즉 libc `malloc`에 위임합니다

malloc이 요청 크기에 따라 `brk`(작은 것)나 `mmap`(큰 것)을 골라 커널을 부릅니다. Rust 자신은 시스템 콜을 직접 치지 않죠. 이것이 2부에 심은 복선의 1차 정정이고, malloc이 어떤 기준으로 둘을 가르는지(`M_MMAP_THRESHOLD`)는 [9편](/essays/ptmalloc-rust-malloc-delegation)에서 완전히 풀립니다

**Go** — libc를 쓰지 않는 정적 바이너리라, **Go 런타임이 `mmap`을 직접** 호출합니다

커널에서 큰 덩어리(arena, 64비트에서 64MB 단위)를 예약하고 그 안을 자체 할당자로 잘라 씁니다. [5편](/essays/go-aot-fast-build-tradeoff)의 이스케이프 분석이 "힙으로 간다"고 판정한 객체가 최종적으로 착지하는 곳이 이 런타임 할당자(3.3의 mcache)입니다

**Java(HotSpot)** — 시작할 때 `-Xmx`만큼을 `mmap`으로 **예약(reserve)** 하되 처음엔 접근 불가(PROT_NONE)로 두고, GC가 필요한 만큼만 **커밋(commit)** 하며 키웁니다

힙 안에서 각 스레드는 TLAB([11편](/essays/jvm-tlab-bump-pointer-offheap))로 폴트·경합 없이 할당합니다. [6편](/essays/java-jit-c2-runtime-optimization)의 코드 캐시·Metaspace·MDO는 이 힙 바깥의 별도 mmap 영역에 삽니다. 5부 OOMKilled의 무대죠

**수렴점** — 세 언어 모두 결국 커널의 `mmap`/`brk`를 거쳐야만 프레임을 얻고, 셋 다 똑같이 demand paging·TLB·overcommit의 지배를 받습니다

다른 것은 그 위에 자기 할당자를 얼마나 두껍게 얹느냐뿐입니다. Rust는 libc에 얹고, Go와 JVM은 자기 런타임에 얹습니다

## 트레이드오프 소결

커널 메모리의 계약을 한 문장으로 줄이면 이렇습니다

> 약속(VMA)과 실현(프레임)을 분리한 게으름으로 fork/COW, 즉각적인 대용량 예약, overcommit의 높은 활용률을 얻는 대신 — 첫 터치의 폴트 지연, RSS의 예측 불가능성, 청구가 몰릴 때의 OOMKilled 불확실성을 낸다

huge page는 이 트레이드오프의 축소판입니다. 처리량(TLB reach)을 사려고 지연과 단편화 위험을 지불하니까요

그리고 세 언어가 하나같이 이 층 **위에** 자기 할당자를 얹는 이유가 여기서 분명해집니다

시스템 콜(약 1,400사이클)과 페이지 폴트(minor 수백~수천 사이클, major 수 μs~ms)는 객체 하나 만들 때마다 치르기엔 비용이 너무 큽니다

그래서 커널에서 **한 번에 크게 받아** 내부에서 잘게 나눠 쓰며 그 비용을 **상각(amortize)** 해야 합니다. 그 "잘게 나누는 기술"이 바로 3.2~3.4입니다

## DevOps 관점에서 더 파고들 질문

1. **지표의 정체** — `top`의 VIRT/RES, `/proc/PID/status`의 VmSize/VmRSS, cgroup v2의 `memory.current`는 각각 무엇을 세나요? 컨테이너가 OOMKilled 될 때 커널이 보는 숫자는 이 중 어느 것이며, 왜 "VSZ가 커도 안 죽고 RSS가 넘으면 죽는" 걸까요?
2. **THP 운영 판단** — THP를 `always`로 두면 Redis·MongoDB·JVM에서 지연·메모리 스파이크가 왜 생기나요? `madvise` 모드는 무엇을 바꾸며, 어떤 워크로드에서 `never`가 답인가요? 라이브에서 `/sys/kernel/mm/transparent_hugepage/enabled`를 어떻게 관측하고 바꾸나요?
3. **major fault 계측** — `vmstat`의 si/so, `/proc/PID/stat`의 majflt, `perf stat -e major-faults`, eBPF(`bpftrace`) 중 무엇을 언제 쓰나요? 스왑을 끈 쿠버네티스 노드에서 major fault가 뜬다면 무엇을 의심해야 하나요?
4. **strict overcommit의 저울** — `vm.overcommit_memory=2`로 바꾸면 무엇을 얻고 무엇을 잃나요? 활용률(빈패킹)과 예측 가능성(OOM Killer 없음) 사이에서, 어떤 서비스에 어느 쪽을 택해야 할까요?
5. **max_map_count 장애** — 기본 65,530에 걸려 `mmap`이 `ENOMEM`으로 실패하는 장애를 어떻게 진단하나요(`/proc/PID/maps` 줄 수를 `wc -l`)? Elasticsearch가 262,144를 요구하는 물리적 이유(mmapfs로 세그먼트를 다수 매핑)는 무엇인가요?
6. **prefault의 손익** — 저지연 서비스에서 `AlwaysPreTouch`/`MAP_POPULATE`/`mlock`으로 폴트를 미리 치우는 것은 언제 이득이고 언제 손해(부팅 지연·메모리 상주 강제)인가요? p99 tail latency와 노드 메모리 밀도(빈패킹)의 상충을 어떻게 조율하나요?

## 핵심 요약

- "Rust가 `brk`/`mmap`을 직접 호출한다"는 부정확합니다. 기본 `System` 할당자는 libc `malloc`에 위임하고, 그 malloc이 아래에서 커널을 부릅니다. Rust에 없는 것은 GC와 스케줄러지 메모리 관리 계층이 아닙니다
- 가상 주소와 물리 주소는 다르고, MMU가 접근마다 변환합니다. 변환표가 프로세스마다 따로라서 격리가 공짜로 따라옵니다
- 페이지 테이블은 4단계 트리입니다. 한 번의 변환에 메모리 접근 4번이 드는 구조라, TLB라는 캐시가 그 비용을 숨깁니다. TLB reach = 엔트리 수 × 페이지 크기 — Apple이 16KB 페이지를 고른 이유이자, x86이 huge page를 쓰는 이유입니다
- 데이터 지역성은 캐시 지역성만이 아니라 TLB 지역성이기도 합니다. 큰 힙을 무작위로 훑으면 데이터가 캐시에 있어도 변환에서 수백 사이클이 샙니다
- PCID/ASID 태그 덕에 문맥 교환과 KPTI의 CR3 스왑이 TLB를 비우지 않습니다. 1편의 'KPTI 세금'이 PCID 유무로 갈리는 이유입니다
- `brk`/`mmap`이 성공해도 물리 프레임은 0장입니다. 커널이 한 일은 VMA라는 장부 한 줄 등록뿐 — 약속과 실현의 분리가 리눅스 메모리 관리의 심장입니다
- 페이지 폴트는 오류가 아니라 할당이 완료되는 정상 경로입니다(demand paging). minor는 RAM 안에서 수백~수천 사이클, major는 디스크 I/O라 1,000배 넘게 커질 수 있습니다
- "1MB 할당"의 진짜 비용은 시스템 콜 1회 + minor fault 256회 + TLB 워밍업입니다. 서비스 첫 요청의 지연 스파이크(cold page)와 JVM `AlwaysPreTouch`의 존재 이유가 여기 있습니다
- VSZ는 약속, RSS는 실현입니다. cgroup은 RSS를 세므로 VSZ가 커도 죽지 않지만 RSS가 한도를 넘으면 OOMKilled입니다
- 리눅스는 물리보다 많이 약속합니다(overcommit). 청구가 몰리면 OOM Killer가 `oom_score`로 희생자를 고릅니다. `vm.max_map_count`(기본 65,530)는 VMA 개수의 숨은 상한입니다
- `MADV_FREE`는 회수를 늦춰 빠르지만 RSS가 즉시 줄지 않아 보입니다. Go가 1.12에 채택했다가 1.16에서 `MADV_DONTNEED`로 되돌린 이유입니다. 성능보다 관측 가능한 RSS를 택한 것이죠
- 세 언어 모두 커널의 게으름 위에 자기 할당자를 얹습니다. 시스템 콜과 폴트는 객체 단위로 치르기엔 비용이 너무 커서, 크게 받아 잘게 나누며 상각하는 것입니다

---

**[다음 편 예고]**
커널은 프레임을 크게, 그리고 게으르게 내어 줍니다. 그 덩어리를 받아 객체 단위로 잘게 나누는 첫 번째 계층이 유저 공간 할당자입니다
다음 편은 Rust가 위임한 그 libc `malloc`의 내부를 엽니다. glibc ptmalloc의 arena·bin·chunk 구조, malloc이 언제 `brk`를 쓰고 언제 `mmap`으로 갈아타는지(`M_MMAP_THRESHOLD`, 기본 128KB의 동적 조정), 단편화가 왜 생기며 jemalloc과 mimalloc이 그것을 어떻게 다르게 푸는지까지
거기서 "Rust가 brk/mmap을 직접 호출한다"는 복선이 완전히 회수됩니다
