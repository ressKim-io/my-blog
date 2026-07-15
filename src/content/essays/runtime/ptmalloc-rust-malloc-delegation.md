---
title: "free를 했는데 왜 RSS는 그대로일까 — ptmalloc의 서랍장과 Rust의 malloc 위임"
excerpt: "커널은 메모리를 크게, 그리고 게으르게 내어 줍니다. 그 덩어리를 객체 단위로 잘게 쪼개 파는 소매상이 malloc입니다. glibc ptmalloc의 arena·chunk·bin, 락을 건너뛰는 tcache, brk와 mmap을 가르는 M_MMAP_THRESHOLD, 분명히 free했는데 RSS가 내려오지 않는 현상의 물리적 원인까지 — 2부에 심어 둔 'Rust가 brk/mmap을 직접 호출한다'는 복선이 여기서 완전히 닫힙니다"
category: runtime
tags:
  - rust
  - go
  - java
  - malloc
  - glibc
  - memory
series:
  name: "kernel-runtime-tradeoffs-3"
  order: 2
date: "2026-07-04"
---

> **시리즈 "커널과 런타임으로 톺아보는 Rust · Go · Java"의 9편**
> [8편](/essays/kernel-lazy-allocation-page-fault)에서 커널의 계약을 확인했습니다. 커널은 메모리를 크게, 그리고 게으르게 내어 준다는 것
> 문제는 프로그램이 실제로 다루는 객체가 대부분 작다는 것입니다. 문자열 하나, 노드 하나, 버퍼 하나 — 이 작은 것들을 매번 커널에 달라고 할 수는 없습니다
> 그 사이를 메꾸는 계층이 이번 편의 주인공입니다. 그리고 2부부터 끌고 온 복선, "Rust가 `brk`/`mmap`을 직접 호출한다"는 문장이 왜 부정확했는지가 여기서 물리적으로 닫힙니다

## 커널이 도매라면 malloc은 소매입니다

[8편](/essays/kernel-lazy-allocation-page-fault)에서 잰 커널 비용을 먼저 꺼내 놓겠습니다

`brk`나 `mmap` 시스템 콜 한 번이 [1편](/essays/syscall-mode-switch-cost)에서 측정한 대로 약 1,400사이클입니다. 여기에 받아 온 메모리를 처음 만질 때마다 minor 페이지 폴트가 수백에서 수천 사이클씩 따라붙습니다

문제는 서버 프로그램이 작은 객체를 초당 수백만 개씩 만들었다 버린다는 것입니다

웹 서버가 요청 하나를 처리하면서 문자열과 노드와 버퍼를 수천 개 만듭니다. 이걸 전부 커널에 직접 요청한다면, 객체 하나마다 시스템 콜 한 번에 페이지 폴트가 붙습니다

초당 수만 건의 HTTP 요청이 들어오는 순간 CPU는 비즈니스 로직이 아니라 커널을 들락거리는 일에만 매달리게 됩니다

![malloc amortizes one kernel round trip over many small objects](/diagrams/ptmalloc-rust-malloc-delegation-1.svg)

그림 왼쪽이 커널과 직거래하는 경우입니다. 객체(obj) N개가 각자 커널로 내려가고, 아래 붉은 글씨대로 **시스템 콜 N번과 페이지 폴트 N번**을 그대로 다 냅니다

오른쪽이 malloc을 거치는 경우입니다. 객체들은 커널이 아니라 가운데 보라색 상자, 즉 malloc에게 요청합니다

malloc은 커널에서 **큰 덩어리를 한 번만**(1 big chunk) 떼어 옵니다. 그리고 그 덩어리를 잘라 객체들에게 나눠 줍니다. 커널 비용은 아래 초록 글씨대로 딱 한 번만 발생합니다

그림에서 "free list"라고 적힌 부분이 이 계층의 두 번째 무기입니다. 프로그램이 `free`한 조각을 커널에 돌려주지 않고 **재고로 쌓아 두었다가**, 다음 `malloc` 요청에 시스템 콜 없이 되팝니다

정리하면 malloc이 하는 일은 세 가지입니다

- 커널에서 큰 덩어리를 한 번에 떼어 와 **시스템 콜 비용을 여러 할당에 나눠 상각(amortize)** 합니다
- 그 덩어리를 프로그램이 요청한 크기대로 **잘게 잘라** 건네줍니다
- `free`된 조각을 버리지 않고 **재고 목록(free list)에 쌓아** 두었다가 되팝니다

8편이 도매(커널)였다면 이번 편은 소매(malloc)입니다

이 관점만 쥐고 있으면 아래에 나올 복잡한 자료구조들이 전부 "재고를 어떻게 효율적으로 관리할 것인가"라는 한 가지 질문의 변주로 읽힙니다

## malloc이 하는 약속은 두 줄뿐입니다

`malloc(n)`의 계약은 의외로 단순합니다

첫째, **최소 `n`바이트짜리 연속된 메모리 블록**의 시작 주소를 돌려줍니다. 둘째, 그 주소는 일정한 경계에 **정렬(align)** 되어 있습니다

이게 전부입니다. glibc 64비트 환경의 기본 정렬은 **16바이트**입니다(`MALLOC_ALIGNMENT = 2 × sizeof(size_t)`)

여기서 "정렬"을 풀어 두겠습니다

CPU는 8바이트짜리 값을 8의 배수 주소에서 읽을 때 가장 빠릅니다. 어떤 SIMD 명령은 아예 16바이트나 32바이트 정렬을 강제하고, 정렬되지 않은 주소에서 읽으면 느려지거나 예외가 납니다

그래서 할당자는 사용자가 그 안에 무슨 타입을 담든 안전하도록, 넉넉한 경계인 16바이트에 맞춰 주소를 돌려줍니다

반대로 말하면 17바이트만 달라고 해도 할당자는 내부적으로 16의 배수로 반올림합니다. 이 반올림이 뒤에 나올 **내부 단편화**의 씨앗입니다

`free(p)`는 그 블록을 반납합니다. 어디서 가져와 어떻게 재사용할지는 전적으로 할당자의 재량입니다

사용자는 "달라"와 "돌려준다"만 말할 뿐, 그 뒤의 살림살이는 모릅니다. 지금부터 그 살림살이를 엽니다

## ptmalloc의 세 겹 — arena, heap, chunk

glibc가 쓰는 malloc의 이름은 **ptmalloc2**입니다

Doug Lea가 만든 dlmalloc을 Wolfram Gloger가 멀티스레드 환경으로 확장한 물건이고, 구조는 크게 세 겹으로 포개져 있습니다

![ptmalloc nests three layers: arena, heap, and chunk](/diagrams/ptmalloc-rust-malloc-delegation-2.svg)

그림의 바깥 보라색 상자가 **arena**입니다. 오른쪽 위에 붙은 `mutex` 배지가 핵심이죠

arena는 "메모리 풀 하나 + 그 풀을 지키는 락 하나"를 묶은 단위입니다

그 안의 노란색 상자가 **heap**, 곧 커널에서 실제로 받아 온 연속된 땅입니다

heap 안의 작은 하늘색 조각들이 **chunk**, 손님에게 파는 최소 단위입니다. 오른쪽 끝 점선 상자(top)는 아직 아무에게도 팔지 않은 미분할 구역입니다

왼쪽과 오른쪽의 차이가 이 그림의 두 번째 메시지입니다. 왼쪽은 프로그램에 처음부터 있는 **main arena**로, heap을 `brk`로 밀어 올리며 키웁니다

오른쪽은 락 경합 때문에 추가로 생기는 **thread arena**입니다. 이쪽은 `brk`를 쓸 수 없어서 `mmap`으로 새 구획을 받습니다

세 겹이 각각 어떤 문제를 푸는지 하나씩 보겠습니다

**arena — 락 경합을 나누는 단위입니다.** 모든 스레드가 단 하나의 arena를 공유하면, 여러 스레드가 동시에 `malloc`을 부를 때 그 락 하나를 두고 줄을 서야 합니다

이 병목을 풀려고 ptmalloc은 스레드가 몰릴 때 새 arena를 만들어 부담을 나눕니다. 스레드는 TLS(스레드 로컬 저장소, 스레드마다 독립된 값을 갖는 변수 영역) 변수 `thread_arena`를 통해 자기 arena에 묶입니다

arena 개수의 상한은 glibc 내부 기본값으로 64비트에서 **코어 수 × 8**, 32비트에서 코어 수 × 2입니다(`M_ARENA_MAX`). 이 숫자가 뒤에서 컨테이너 RSS 문제로 돌아옵니다

**heap — arena가 실제로 딛고 선 땅입니다.** main arena는 프로세스의 program break를 `brk`로 밀어 올리며 자랍니다

thread arena는 `mmap`으로 받은 구획을 필요한 만큼만 `mprotect`로 접근 가능하게 켜 가며 씁니다. 8편에서 본 예약(reserve) → 사용(commit) 패턴 그대로입니다

**chunk — 실제로 손님에게 파는 최소 단위입니다.** `free`되면 크기별 서랍인 **bin**에 꽂혀 다음 손님을 기다립니다

바로 다음 절에서 이 chunk를 바이트 단위로 뜯어봅니다

## chunk 하나를 바이트 단위로 뜯어보기

glibc 64비트 기준으로 chunk의 구조체는 이렇게 생겼습니다

```c
struct malloc_chunk {
  size_t  mchunk_prev_size;  /* 바로 앞 chunk가 free일 때만 그 크기. 앞이 사용 중이면 앞이 빌려 씀 */
  size_t  mchunk_size;       /* 이 chunk의 크기 + 하위 3비트 플래그 */

  /* 아래 네 필드는 이 chunk가 free일 때만 의미가 있고, 사용 중일 땐 페이로드가 이 자리를 씀 */
  struct malloc_chunk* fd;          /* free 이중 연결 리스트: 다음 chunk */
  struct malloc_chunk* bk;          /* free 이중 연결 리스트: 이전 chunk */
  struct malloc_chunk* fd_nextsize; /* large bin 전용: 다음 크기 그룹 */
  struct malloc_chunk* bk_nextsize; /* large bin 전용: 이전 크기 그룹 */
};
```

여기에 절약 기법이 두 개 숨어 있습니다. 둘 다 "쓰지 않는 공간을 재활용한다"는 같은 발상입니다

### 첫째, size 필드의 남는 3비트에 플래그를 얹습니다

chunk 크기는 항상 16의 배수라 하위 4비트가 늘 0입니다. 이 놀고 있는 비트에 메타데이터를 얹습니다

- **`P` (PREV_INUSE, bit 0)** — 바로 앞 chunk가 사용 중인가? 0이면 앞이 free라는 뜻이고, `free` 시 앞 chunk와 병합할지를 이 비트로 판단합니다
- **`M` (IS_MMAPPED, bit 1)** — 이 chunk가 arena 힙이 아니라 독립적인 `mmap`으로 받은 것인가? 뒤에 나올 `M_MMAP_THRESHOLD`와 직접 연결됩니다
- **`A` (NON_MAIN_ARENA, bit 2)** — main arena가 아니라 thread arena 소속인가?

숫자로 보면 분명해집니다. 크기가 32바이트인 chunk는 `0b100000`인데, 앞 chunk가 사용 중이라 `P`가 켜지면 `size` 필드에 실제로 저장되는 값은 `0b100001`, 곧 33입니다

읽을 때는 하위 3비트를 지워 크기를 되찾고, 그 3비트만 따로 떼어 상태를 읽습니다. 크기를 적는 칸 하나에 크기와 상태를 함께 담은 셈입니다

### 둘째, 이웃의 prev_size 칸까지 빌려 씁니다

이게 **경계 태그(boundary tag)** 기법입니다. 말로는 헷갈리니 이웃한 두 chunk를 바이트 단위로 늘어놓고 보겠습니다

![The boundary tag: one 8-byte slot serves two owners](/diagrams/ptmalloc-rust-malloc-delegation-3.svg)

그림은 낮은 주소에서 높은 주소로, chunk A와 그 뒤에 붙은 chunk B를 나란히 늘어놓은 것입니다. 붉은 점선으로 묶인 가운데 8바이트(shared 8B)가 이 그림의 전부입니다

위쪽 줄이 **A가 사용 중일 때**입니다. A의 페이로드가 오른쪽으로 쭉 뻗어 그 8바이트를 그대로 잡아먹고 있습니다

아래쪽 줄이 **A가 free됐을 때**입니다. 같은 8바이트가 이제 `prev_size`, 곧 "앞 chunk A의 크기"를 적는 칸으로 바뀌었습니다. 그리고 A의 몸통에는 free 목록을 잇는 포인터 `fd`와 `bk`가 들어앉았습니다

같은 8바이트가 상황에 따라 주인이 바뀝니다

원래 `prev_size`는 앞 chunk가 free일 때 그 크기를 적어 두는 칸입니다. 그런데 앞 chunk(A)가 사용 중이라면 이 칸은 쓸모가 없습니다. 그래서 그 8바이트를 앞 chunk의 페이로드가 가져다 씁니다

덕분에 명목상 헤더는 16바이트(`prev_size` + `size`)지만, 실질적인 오버헤드는 **8바이트**로 줄어듭니다

이 규칙을 알고 나면 크기 계산이 자연스럽게 따라옵니다

`n`바이트를 요청하면 실제 chunk 크기는 `align16(n + 8)`이 되고, 최소 chunk 크기는 **32바이트**입니다(`MINSIZE`, 64비트 기준)

`malloc(17)`을 예로 들면, 17 + 8 = 25를 16의 배수로 올려 **32바이트 chunk**가 잡힙니다. 실제로 안전하게 쓸 수 있는 공간은 24바이트입니다

요청한 17바이트와 실제로 차지한 32바이트의 차이 — 이 자투리가 **내부 단편화**입니다

## free된 chunk는 어디로 가나 — bin이라는 서랍장

`free`된 chunk를 아무렇게나 쌓아 두면, 다음 `malloc`이 맞는 크기를 찾느라 전부 뒤져야 합니다

그래서 ptmalloc은 반납된 chunk를 크기별로 분류해 **bin**이라는 서랍에 꽂아 둡니다

설계 철학은 한 문장으로 요약됩니다. **자주 쓰는 작은 것은 락도 없이 즉시, 큰 것은 정확히 맞춰서, 최후에야 커널로**

![Where malloc looks for a free chunk, from cheapest to most expensive](/diagrams/ptmalloc-rust-malloc-delegation-4.svg)

그림을 위에서 아래로 읽으면 됩니다. `malloc(n)` 요청이 서랍을 차례로 두드리다가, 맞는 chunk를 찾는 즉시 오른쪽 초록 통로(hit · return)로 빠져나갑니다

위쪽 초록 서랍 둘이 가장 싼 경로입니다. 아래로 내려갈수록 값이 오르고, 맨 아래 붉은 상자가 커널입니다

각 서랍을 풀어 보겠습니다

1. **tcache (thread cache)** — 스레드마다 하나씩 갖는 **락 없는** 개인 캐시입니다. 24바이트부터 1,032바이트까지를 16바이트 간격으로 나눈 **64개의 빈**을 두고, 빈 하나에 최대 **7개**의 chunk를 LIFO로 쌓아 둡니다. 락을 잡지 않으므로 대부분의 소형 할당·해제가 여기서 곧장 끝납니다. **glibc 2.26(2017)** 이후 malloc이 빨라진 결정적 이유입니다
2. **fastbin** — tcache가 꽉 찼거나 담지 못하는 작은 chunk를 받습니다(기본 상한 128바이트). 속도를 위해 이웃 chunk와의 **병합을 일부러 미루고** 단일 연결 리스트에 LIFO로 쌓습니다. 빠른 대신 조각을 남기는 전략입니다
3. **unsorted bin** — 방금 free된 chunk가 잠시 대기하는 이중 연결 리스트 한 줄입니다. ptmalloc은 정리를 미뤄 두는 대신, 다음 `malloc`이 이 대기열을 훑고 지나가며 "마침 크기가 맞으면 바로 쓰고, 아니면 small·large bin으로 제자리 정리"를 합니다. 일종의 지연 분류입니다
4. **small bin** — 빈 하나가 **정확히 한 크기**만 담습니다(16바이트 간격, 1KB 미만). 같은 크기 요청이 오면 검색 없이 바로 꺼내 줄 수 있어 빠르고, FIFO로 동작합니다
5. **large bin** — 여기서부터는 빈 하나가 크기의 **범위**를 담습니다. 그래서 그 안에서 요청에 가장 가까운 것을 골라야 하는데(best-fit), 이를 빠르게 하려고 크기순으로 정렬해 두고 `fd_nextsize`·`bk_nextsize`라는 건너뛰기 포인터로 크기 그룹을 넘나듭니다
6. **top chunk** — 위 서랍이 전부 비었으면, arena 맨 끝에 남은 커다란 미분할 덩어리에서 필요한 만큼 잘라 줍니다. arena의 개척되지 않은 벌판인 셈이라 wilderness라고도 부릅니다
7. **커널 요청** — top chunk마저 모자라면, 그제서야 `brk`로 힙을 늘리거나 `mmap`을 부릅니다. 둘 중 무엇을 쓰는지가 바로 다음 이야기입니다

여기서 tcache의 무게를 한 번 더 짚고 싶습니다

소형 객체가 대부분인 워크로드에서는 할당과 해제의 대부분이 1번 서랍에서 끝납니다. 락도, 커널도, 병합 계산도 건드리지 않습니다

malloc이 "느리다"는 옛 인상이 2017년 이후로 상당 부분 낡은 이유가 이것입니다

### 서랍이 두 종류로 생긴 이유

서랍마다 자료구조가 다릅니다. 어떤 것은 한쪽 끝에서만 넣고 빼고, 어떤 것은 중간에서 빼낼 수 있습니다

![Two bin shapes: singly linked for speed, doubly linked for merging](/diagrams/ptmalloc-rust-malloc-delegation-5.svg)

그림 위쪽이 **단일 연결 리스트**입니다. 화살표가 한 방향뿐이라 머리(head)에서만 넣고 뺄 수 있습니다. tcache와 fastbin이 이 모양입니다

아래쪽이 **이중 연결 리스트**입니다. 화살표가 양방향이고, 각 chunk가 앞뒤를 가리키는 `fd`·`bk` 포인터를 들고 있습니다. unsorted·small·large bin이 이 모양입니다

두 모양이 갈리는 이유는 목적이 다르기 때문입니다

tcache와 fastbin의 목적은 "제일 자주, 제일 빠르게"입니다. 머리 하나만 만지면 되니 단일 연결로 충분하고, 포인터가 하나뿐이라 chunk당 메타데이터도 덜 듭니다

반대로 unsorted·small·large bin은 chunk를 **중간에서 빼내야** 합니다. 크기별로 재분류할 때도 그렇고, 이웃과 합칠 때도 그렇습니다

그림 아래 붉은 점선이 그 **병합(coalescing)** 입니다

`free`할 때 ptmalloc은 방금 반납한 chunk의 양옆이 이미 free인지 확인합니다. 앞쪽은 `prev_size`로, 뒤쪽은 그다음 chunk의 `P` 플래그로 판별합니다

이웃이 비어 있으면 둘을 합쳐 더 큰 free chunk로 되돌립니다. 잘게 쪼개진 구멍이 다시 뭉쳐야 큰 요청을 받아 줄 수 있기 때문입니다

중간에서 chunk를 빼내려면 앞뒤 양쪽을 다 알아야 합니다. 이중 연결이 필요한 이유가 여기 있습니다

## arena를 늘리면 경합이 줄고 RSS가 늡니다

앞에서 ptmalloc이 락 경합을 줄이려고 arena를 코어 수 × 8까지 늘린다고 했습니다. 이 결정에는 청구서가 따라붙습니다

![More arenas buy less lock contention and cost more memory](/diagrams/ptmalloc-rust-malloc-delegation-6.svg)

그림 위쪽 동그라미 넷이 스레드입니다

왼쪽은 arena가 하나뿐인 경우입니다. 네 스레드의 화살표가 전부 가운데 붉은 `lock` 상자 하나로 모입니다. 줄을 서야 하니 경합이 오르지만, 관리 구조는 아래 보라색 상자 하나(top + bins)뿐이라 메모리는 적게 듭니다

오른쪽은 arena를 스레드 수만큼 늘린 경우입니다. 화살표가 곧장 자기 arena로 내려가니 줄 설 일이 없습니다

대신 보라색 상자가 넷으로 늘었습니다. arena마다 top chunk와 bin 배열 같은 관리 구조가 **통째로 복제**되기 때문입니다. 그림 아래 `top + bins × N`이 그 뜻입니다

속도(경합 감소)와 메모리(구조 중복)를 맞바꾸는 저울입니다. 흔히 **arena 폭발**이라 부르는 현상이 오른쪽 극단입니다

tcache는 이 저울 자체를 우회합니다. 스레드 로컬이라 아예 락을 잡지 않으니, 소형 할당이 대부분인 워크로드는 arena 락을 거의 건드리지 않습니다

### 컨테이너에서 이 숫자가 어긋납니다

여기서 실무 함정 하나를 짚겠습니다. glibc가 세는 "코어 수"는 **호스트의 코어 수**입니다

쿠버네티스에서 `cpu: 500m`처럼 CPU 쿼터(cfs quota)를 걸어도 그것은 코어 개수를 줄이는 설정이 아닙니다. cpuset으로 코어를 직접 묶지 않는 한, 컨테이너 안의 glibc는 호스트의 코어를 전부 봅니다

코어 64개짜리 노드에 얹힌 컨테이너라면 arena 상한이 512개까지 열려 있다는 뜻입니다. 쿼터를 아무리 조여도 그렇습니다

[2편](/essays/thread-models-kernel-vs-user)의 이야기와 나란히 놓으면 대비가 선명해집니다

| 계층 | 코어 수를 어디서 세는가 | cgroup CPU 쿼터 |
| --- | --- | --- |
| Go 런타임 (`GOMAXPROCS`, 1.25+) | cgroup 한도를 반영 | 읽음 |
| Rust `available_parallelism` | cgroup 한도를 반영 | 읽음 |
| **glibc malloc (arena 상한)** | **호스트의 온라인 코어 수** | **읽지 않음** |

같은 프로세스 안에서 위층과 아래층이 서로 다른 숫자를 보고 있습니다

런타임은 "나는 코어 0.5개짜리 컨테이너에 산다"고 알고 스레드를 줄이는데, 그 아래 malloc은 "코어가 64개니 arena를 512개까지 열어도 된다"고 판단합니다

컨테이너의 RSS가 설명 없이 부풀 때 `MALLOC_ARENA_MAX`가 단골 처방인 이유가 이 어긋남입니다

### ARM64의 약한 메모리 모델

tcache·fastbin의 연결 리스트, 그리고 jemalloc·mimalloc의 락 없는 free list는 모두 **CAS**에 기대어 여러 스레드가 락 없이 같은 자료구조를 만집니다

CAS(compare-and-swap)는 "이 자리의 값이 내가 본 그 값이면 새 값으로 바꿔라"를 명령 하나로 처리하는 원자적 연산입니다. 락 대신 이걸 써서 경합을 넘깁니다

그런데 그 비용이 아키텍처마다 다릅니다

"약한 메모리 모델"을 정의부터 풀겠습니다. 현대 CPU는 성능을 위해 메모리 읽기·쓰기의 순서를 **프로그램에 적힌 순서와 다르게 재배열**할 수 있습니다

이 재배열을 얼마나 허용하느냐가 아키텍처마다 다릅니다

| 항목 | x86-64 | AArch64 (ARM64) |
| --- | --- | --- |
| 메모리 모델 | 강한 모델 (TSO) | 약한 모델 |
| 읽기·쓰기 재배열 | 거의 없음 | 폭넓게 허용 |
| 순서 보장 | 평범한 적재·저장으로 대체로 충족 | 명시적 배리어가 필요 |
| 대표 명령 | `lock` 접두사 · `mfence` | `ldar`(load-acquire) · `stlr`(store-release) |
| 캐시라인 | 64B | 64B (Apple M 시리즈는 128B) |

x86-64는 **TSO(Total Store Order)**, 곧 강한 모델입니다. 재배열이 거의 없어서 평범한 적재·저장만으로도 대체로 순서가 지켜집니다

AArch64는 **약한 모델**이라 재배열이 훨씬 자유롭습니다. "이 쓰기가 저 쓰기보다 반드시 먼저 보여야 한다"를 보장하려면 **명시적 메모리 배리어**를 프로그래머나 컴파일러가 직접 넣어야 합니다

표의 `ldar`와 `stlr`이 그 역할을 하는 ARM64 명령입니다. 각각 "이 적재보다 뒤 명령이 앞질러 오지 못하게", "이 저장보다 앞 명령이 뒤처지지 못하게" 막습니다

정리하면, 같은 malloc 구현이라도 ARM64에서는 배리어가 더 촘촘히 들어갑니다

여기에 캐시라인 경합(false sharing, 서로 다른 스레드가 같은 캐시라인의 다른 부분을 만져 캐시가 계속 무효화되는 현상)이 겹치면 성능 차이가 드러납니다

Graviton이나 Ampere 같은 ARM 서버에서 malloc 집약 워크로드를 돌릴 때 x86과 스케일링 특성이 갈리는 지점이 바로 여기입니다

## brk냐 mmap이냐 — M_MMAP_THRESHOLD

서랍을 다 뒤지고 top chunk로도 모자라서 결국 커널을 불러야 할 때, malloc은 **요청 chunk의 크기**를 임계값과 비교해 호출 방식을 가릅니다

![The mmap threshold decides whether a chunk comes from the heap or gets its own mapping](/diagrams/ptmalloc-rust-malloc-delegation-7.svg)

그림 위쪽 `chunk size`에서 길이 둘로 갈립니다

왼쪽, **임계값보다 작으면** arena 힙에서 해결합니다. main arena면 `brk`로 힙을 밀어 올리고, thread arena면 자기 구획을 넓힙니다. 이렇게 받은 땅은 `free`돼도 커널에 돌아가지 않고 bin에 남아 재사용됩니다

오른쪽, **임계값 이상이면** 이 요청만을 위한 **독립적인 `mmap`** 을 부릅니다. 앞서 본 `M`(IS_MMAPPED) 플래그가 켜지는 chunk가 이것입니다. 이쪽은 `free`되는 순간 `munmap`으로 통째 반납되어 깔끔하게 사라집니다

그림 아래 눈금이 임계값 자체의 움직임입니다. 초기값은 **128KB**인데, 이 값은 고정이 아니라 프로그램의 행동을 보고 **스스로 올라갑니다**

정확한 규칙은 이렇습니다. 현재 임계값보다 크면서 상한(`DEFAULT_MMAP_THRESHOLD_MAX`) 이하인 `mmap` chunk가 `free`될 때마다, 임계값을 그 크기까지 끌어올립니다

상한은 64비트에서 `4 × 1024 × 1024 × sizeof(long)`, 곧 **32MB**입니다. 32비트에서는 512KB입니다

왜 이렇게 나누는지는, 이 설계가 피하려는 두 가지 실패를 보면 분명해집니다

**첫째, 큰 블록을 `brk` 힙에 두면 반환이 막힙니다.** `brk` 힙은 아래에서 위로 쌓아 올린 담과 같아서, 커널에 돌려주려면 담의 꼭대기부터 헐어야 합니다

힙 한가운데의 큰 블록이 free돼도 그 위에 살아 있는 chunk가 하나라도 있으면 커널에 돌려줄 수 없습니다. 그래서 큰 것은 아예 독립 `mmap`으로 따로 떼어 둡니다

**둘째, 반대로 큰 할당이 반복되면 mmap이 오히려 손해입니다.** 200KB짜리를 계속 할당했다 해제하는 프로그램을 생각해 보겠습니다

매번 `mmap`과 `munmap` 시스템 콜이 나가면 그게 다시 커널 왕복 비용입니다. 상각하려고 만든 계층이 상각을 포기하는 셈이죠

그래서 "이 정도 크기는 자주 재사용되는구나" 싶으면 임계값을 그만큼 올려서, 다음부터는 mmap 대신 힙에서 재사용하도록 유도합니다

다만 이 자동 조정은 사용자가 손잡이를 직접 만지는 순간 꺼집니다. `M_MMAP_THRESHOLD`·`M_TRIM_THRESHOLD`·`M_TOP_PAD`·`M_MMAP_MAX` 중 **하나라도** 명시적으로 설정하면 동적 조정이 비활성화됩니다

곁들여 알아 둘 손잡이가 둘 더 있습니다

- **`M_MMAP_MAX`** — 동시에 유지할 수 있는 mmap chunk의 최대 개수로, 기본값은 **65,536**입니다
- **`M_TRIM_THRESHOLD`** — top chunk가 이 크기를 넘으면 `brk`를 내려 커널에 반환하는 기준으로, 기본값은 **128KB**입니다

> **여기서 2부의 복선이 물리적으로 닫힙니다.**
> "Rust가 `brk`/`mmap`을 직접 호출한다"는 서술이 왜 부정확했는지가 이제 완전히 보입니다
> `brk`냐 `mmap`이냐는 **malloc이** 요청 크기와 임계값 상태를 보고 내리는 판단이지, 언어가 정하는 것이 아닙니다
> Rust의 `Vec`은 그저 "이만큼 달라"고 `malloc`을 부를 뿐입니다

## free 했는데 RSS가 안 줄어드는 이유

단편화부터 정리하고 가겠습니다. 두 종류입니다

- **내부 단편화(internal)** — 요청 크기를 16바이트나 크기 클래스 경계로 반올림하면서 생기는 자투리입니다. 앞서 본 `malloc(17)`이 32바이트를 차지하던 그 낭비죠. 개별로는 작아도 객체 수억 개가 쌓이면 무시할 수 없습니다
- **외부 단편화(external)** — free된 구멍의 **총량은 충분한데** 잘게 흩어져 있어서 큰 연속 블록 요청을 받아 주지 못하는 상태입니다. 병합(coalescing)이 이를 늦추지만 완전히 없애지는 못합니다

이제 실무자가 가장 자주 부딪히는 미스터리를 짚겠습니다

**"트래픽이 빠졌는데도 프로세스 RSS가 피크에 고정되어 내려오지 않는다."**

원인은 앞에서 이미 지나갔습니다. glibc의 main arena는 힙의 **꼭대기가 비어 있을 때만** `brk`를 내려 커널에 메모리를 돌려줍니다

![One live chunk in the middle of the heap blocks the whole return](/diagrams/ptmalloc-rust-malloc-delegation-8.svg)

그림은 힙 하나를 낮은 주소에서 높은 주소로 펼친 것입니다. 오른쪽 끝이 현재의 `brk`, 곧 담의 꼭대기입니다

가운데 붉은 상자 하나가 아직 **사용 중인 chunk**입니다. 나머지는 전부 free입니다

그 붉은 상자 오른쪽은 초록 괄호대로 반환할 수 있습니다(trim only here). free chunk들이 top chunk로 병합되고, 담을 그만큼 헐어 커널에 돌려주면 됩니다

문제는 왼쪽입니다. 붉은 상자 왼쪽의 chunk들은 전부 free인데도, 아래 붉은 괄호대로 **묶여 있습니다**(stuck · RSS stays)

그 상자에서 내려오는 세로 점선이 이유입니다. 점선에 적힌 대로 **`brk`가 그 선을 넘어 내려가지 못합니다**(brk cannot pass)

`brk`는 위에서부터만 헐 수 있어서, 살아 있는 chunk 하나를 지나쳐 그 아래로 내려갈 방법이 없기 때문입니다

RSS는 실제로 물리 프레임이 붙어 있는 양이라고 [8편](/essays/kernel-lazy-allocation-page-fault)에서 봤습니다. 반환되지 않은 이 영역은 계속 RSS로 잡힙니다

오래 사는 서버에서는 이런 "박힌 못" 하나 때문에 반환이 막히는 일이 흔합니다. 트래픽이 빠져 free를 다 해도 RSS 그래프가 피크에 붙어 내려오지 않는 물리적 원인이 이것입니다

그리고 cgroup은 VSZ가 아니라 RSS를 셉니다. 8편에서 확인한 이 회계 규칙 때문에, 반환되지 않은 자투리가 컨테이너 메모리 한도를 그대로 잡아먹습니다

## 무엇을 돌릴 수 있나

손잡이는 크게 세 갈래입니다

**arena 수를 묶습니다.** 환경 변수 `MALLOC_ARENA_MAX=2`(또는 1)로 상한을 내리면 RSS는 내려가지만 락 경합은 올라갑니다

앞서 본 컨테이너 함정 때문에, JVM처럼 내부적으로 native malloc을 쓰는 런타임의 컨테이너에서 특히 자주 만지는 손잡이입니다

**반환을 강제합니다.** `malloc_trim()`을 명시적으로 호출하거나 `M_TRIM_THRESHOLD`를 조정해 힙 꼬리를 커널에 돌려줍니다

다만 방금 본 "박힌 못" 제약은 그대로입니다. `malloc_trim()`도 살아 있는 chunk 아래로는 내려가지 못합니다

**할당자 자체를 갈아끼웁니다.** 링크 시점에 바꾸면 malloc의 계약(인터페이스)은 그대로 둔 채 내부 전략만 교체할 수 있습니다

| 할당자 | 핵심 전략 | 강점 | 주로 쓰이는 곳 |
| --- | --- | --- | --- |
| **glibc ptmalloc** | arena + bin + tcache | 어디에나 있음, 소형 할당이 빠름 | 리눅스 기본값 |
| **jemalloc** | 크기 클래스 분류, arena를 코어에 고정, 시간에 따른 점진 반환(decay) | 단편화·tail latency 관리 | FreeBSD, Redis, 예전의 Rust |
| **mimalloc** | 페이지마다 free list, 자기 스레드 반납과 남의 스레드 반납을 분리 | 구현이 작고 빠름, 캐시 지역성 | Microsoft 계열, Rust opt-in |

**jemalloc**의 결정적 차이는 마지막 열이 아니라 가운데의 **decay**입니다

사용하지 않는 페이지를 시간에 따라 서서히 커널에 돌려주는 정책이라(`dirty_decay_ms`·`muzzy_decay_ms`), 방금 본 "반환이 막히는" 문제에 구조적으로 강합니다. Redis가 jemalloc을 기본으로 묶어 배포하는 이유이기도 합니다

**mimalloc**은 페이지마다 free list를 따로 두고, 자기 스레드가 반납한 것과 다른 스레드가 반납한 것을 분리 관리합니다. 경합과 false sharing을 줄이는 설계이고, 구현이 작아 읽기도 좋습니다

여기서 2026년 현재의 사정을 하나 덧붙여야 합니다

jemalloc은 2025년 6월 원저자 Jason Evans가 유지보수를 접고 저장소를 아카이브했습니다. 한동안 "이제 쓰면 안 되는가"라는 논의가 있었습니다

그러다 2026년 3월 **Meta가 저장소를 넘겨받아 아카이브를 풀고 유지보수를 재개**했습니다. 자사 인프라의 핵심이기 때문입니다. 이후 Meta 내부 포크를 반영한 **5.3.1**이 약 4년 만의 릴리스로 나왔습니다

그러니 "jemalloc은 죽었다"는 2025년 여름의 인상은 지금 기준으로 낡았습니다. 다만 선택 근거를 유지보수 주체까지 확인하고 세우는 습관은 남겨 둘 만합니다

**마지막으로, 크기 클래스를 의식해 자료구조를 설계하는 방법도 있습니다.** 요청 크기가 클래스 경계를 살짝 넘으면 다음 클래스로 반올림되어 낭비가 커집니다

구조체를 65바이트로 설계하면 80바이트 클래스로 올라가 15바이트가 매번 버려집니다. 경계에 맞춰 필드를 다듬는 것만으로 내부 단편화가 줄어듭니다

## 세 언어 수렴 비교 — 도매상을 빌릴 것인가, 지을 것인가

8편의 질문이 "커널은 어떻게 주는가"였다면, 이번 편의 질문은 이것입니다

**그 위의 도매 계층(malloc)을 그대로 빌려 쓸 것인가, 아니면 직접 지을 것인가**

| 언어 | malloc(ptmalloc) 계층 | 커널을 부르는 주체 | 비고 |
| --- | --- | --- | --- |
| **C / C++** | 그대로 사용 | `malloc`이 `brk`/`mmap`을 고름 | 교과서적 경로 |
| **Rust** | 그대로 사용 (`System` 할당자) | `malloc`이 `brk`/`mmap`을 고름 | 2부 복선의 완전한 정정 |
| **Go** | 우회 (자체 할당자) | 런타임이 `mmap`을 직접 호출 | 정적 바이너리, [10편](/essays/go-allocator-mcache-contiguous-stack)에서 해부 |
| **Java (JVM)** | 객체는 우회 (GC 힙 · TLAB) | JVM이 `mmap`을 직접 호출 | JNI·Direct 버퍼는 `malloc`, [11편](/essays/jvm-tlab-bump-pointer-offheap)에서 |

![Who borrows the shared wholesaler and who builds their own](/diagrams/ptmalloc-rust-malloc-delegation-9.svg)

그림 맨 위가 네 언어, 가운데가 할당 계층, 맨 아래가 커널입니다

왼쪽 둘(C/C++와 Rust)의 화살표가 **같은 보라색 상자 하나**로 모입니다. 공용 도매상인 libc malloc, 곧 방금까지 뜯어본 ptmalloc입니다

Go와 Java는 각자 자기 상자를 갖고 있습니다. Go는 런타임 할당자를, JVM은 GC 힙과 TLAB를 직접 소유합니다

그리고 세 상자 모두 아래쪽 커널로 내려갑니다. 결국 물리 프레임을 내어 주는 것은 커널뿐이니까요

오른쪽 붉은 점선을 눈여겨볼 필요가 있습니다. Java가 GC 힙을 건너뛰고 libc malloc으로 곧장 가는 우회로이고, 뒤에서 다시 다룹니다

### Rust — 복선의 완전한 회수

Rust의 기본 전역 할당자는 **`System`**, 곧 플랫폼 libc의 `malloc`/`free`입니다. 리눅스라면 방금까지 뜯어본 glibc ptmalloc이죠

`Box::new`, `Vec`, `String` — 힙을 쓰는 모든 것이 이 경로를 탑니다. 내부적으로는 `alloc::alloc` → `__rust_alloc` → `System.alloc` → `malloc`으로 내려갑니다

역사를 알면 정정이 더 분명해집니다

Rust는 초창기에 **jemalloc을 기본으로 내장**했습니다. 브라우저 엔진 Servo처럼 할당이 잦은 워크로드에서 성능이 좋았기 때문입니다

하지만 jemalloc을 끼고 다니면 실행 파일이 커지고, 일부 아키텍처에서는 지원이 끊겼으며, 유지보수 부담도 있었습니다. 게다가 모든 Rust 프로그램이 할당에 병목이 걸리는 것도 아니었습니다

그래서 **RFC 1183**("swap out jemalloc")에서 시작해 **RFC 1974**(전역 할당자 API)로 이어진 논의 끝에, **Rust 1.32(2019)** 에서 기본을 **시스템 할당자**로 되돌렸습니다

지금은 jemalloc이 필요하면 `#[global_allocator]`로 명시해서 선택합니다(`tikv-jemallocator` 등). 참고로 컴파일러 `rustc` 자신은 빌드 속도 때문에 여전히 내부적으로 jemalloc을 씁니다

```rust
// 기본값 — 아무것도 안 쓰면 System, 즉 libc malloc으로 위임됩니다
let v: Vec<u8> = Vec::with_capacity(1024);

// 바꾸고 싶으면 한 줄로 갈아끼웁니다
use tikv_jemallocator::Jemalloc;

#[global_allocator]
static GLOBAL: Jemalloc = Jemalloc;
```

그래서 2부의 문장은 **이중으로** 부정확했습니다

첫째, Rust는 커널이 아니라 `malloc`을 부릅니다. 둘째, `brk`냐 `mmap`이냐를 고르는 결정은 Rust가 아니라 malloc 구현체가 내립니다

실무적으로 이게 왜 중요한가 하면, **Rust 서비스의 메모리 성격(단편화, tail latency, RSS 반환)이 상당 부분 그 아래 깔린 malloc 구현체에 좌우된다**는 뜻이기 때문입니다

[4편](/essays/rust-aot-zero-cost-codegen)에서 본 "제로코스트 추상화"는 언어 차원의 오버헤드를 없앤 것이지, 힙의 거동까지 언어가 쥐었다는 뜻이 아닙니다

위 코드에서 `#[global_allocator]` 세 줄을 바꾸는 것만으로 서비스의 RSS 곡선이 달라지는 이유가 이것입니다

### Go와 Java — 도매 계층을 직접 짓다

**Go** — libc를 링크하지 않는 정적 바이너리라 malloc 계층을 통째로 우회합니다. 런타임이 직접 `mmap`으로 큰 arena를 받아 자체 할당자로 나눕니다([10편](/essays/go-allocator-mcache-contiguous-stack))

`cgo`로 C 코드를 부를 때에만 그 부분이 libc malloc을 탑니다

**Java(JVM)** — 자바 객체는 GC 힙 안의 **TLAB**에서 나오므로 malloc을 우회합니다([11편](/essays/jvm-tlab-bump-pointer-offheap))

하지만 JVM 자신은 C++로 짜여 있고, **JNI**와 **DirectByteBuffer**, Netty 같은 off-heap 버퍼는 native malloc을 씁니다. 앞 그림의 붉은 점선이 이 경로입니다

그래서 자바 컨테이너에서 `-Xmx`로 힙을 제한해도 막지 못하는 RSS가 존재합니다. [7편](/essays/java-jit-inversion-conditions)에서 "힙은 60%인데 OOMKilled"라고 불렀던 그 현상의 한 축이 바로 여기입니다

그리고 이 native malloc에는 앞서 본 arena 폭발이 그대로 적용됩니다. JVM 컨테이너 튜닝에서 `MALLOC_ARENA_MAX`가 단골로 등장하는 이유가 두 사실이 겹치기 때문입니다

### 수렴점

네 진영 모두 결국 8편의 커널 계약 위에 서 있습니다. `brk`/`mmap`, demand paging, overcommit — 아무도 여기서 벗어나지 못합니다

갈리는 지점은 단 하나입니다. **공용 도매상(malloc)을 함께 쓰느냐(C·C++·Rust), 전용 도매상을 자체 건설하느냐(Go·JVM)**

다음 두 편이 바로 그 "전용 도매상"의 내부 도면입니다

## 트레이드오프 소결

malloc은 커널 왕복 비용을 상각하려고 arena·chunk·bin·tcache라는 정교한 탑을 쌓았습니다

공짜는 아니어서, 그 대가로 세 가지 세금을 냅니다

1. **단편화** — 반올림 자투리(내부)와 흩어진 구멍(외부)
2. **arena 중복** — 멀티스레드 확장을 위해 관리 구조를 복제하며 생기는 메모리 오버헤드
3. **반환 지연** — `brk` 힙의 꼭대기 제약 탓에 free해도 RSS가 바로 내려오지 않는 문제

tcache가 속도를, 동적 mmap 임계값이 깔끔한 반환을, arena 분산이 확장성을 벌어다 줍니다. 그런데 그 각각이 위 세 세금 중 하나로 청구됩니다

Rust가 이 계층을 **위임**한다는 사실의 무게가 여기서 드러납니다

Rust는 언어 차원의 오버헤드를 제로코스트로 없앴지만, 힙 메모리의 실제 성격은 바깥(malloc)에 맡겨 두었습니다

반대로 Go와 JVM은 이 도매 계층을 스스로 소유해 언어 고유의 의미(가비지 컬렉션, 고루틴 스택)와 완전히 통합했습니다. 대신 [3편](/essays/runtime-weight-zero-cost-vs-fat)에서 잰 런타임의 무게를 짊어졌습니다

**"언어가 가볍다"와 "메모리가 예측 가능하다"는 서로 다른 축의 이야기입니다.** 이게 이번 편이 남기는 한 문장입니다

## DevOps 관점에서 더 파고들 질문

1. **arena 폭발 확인** — 코어 32개짜리 노드의 컨테이너에서 RSS가 예상보다 높습니다. 원인이 glibc arena 폭발(코어 수 × 8)인지 어떻게 확인하나요(`/proc/PID/smaps`의 heap 세그먼트 개수, `MALLOC_ARENA_MAX`를 바꿔 가며 비교)? 그리고 컨테이너의 CPU 쿼터와 glibc가 인식하는 온라인 코어 수는 왜 어긋나나요?
2. **반환 안 되는 RSS** — 트래픽이 줄어도 RSS가 내려오지 않을 때, 원인이 glibc의 top chunk 반환 제약인지 어떻게 검증하나요? `malloc_trim()`과 jemalloc의 `dirty_decay_ms` 중 무엇으로 대응하는 게 맞을까요?
3. **할당자 선택의 증명** — glibc·jemalloc·mimalloc 중 하나를 고를 때 p99 tail latency, 단편화율(RSS ÷ 실사용량), 처리량 중 어디에 가중치를 둬야 하며, 그 판단을 어떤 도구(`jeprof`, `malloc_stats`, `malloc_info`)로 증명하나요?
4. **Rust 할당자 교체의 효과** — `#[global_allocator]`를 jemalloc으로 바꾼 뒤 "좋아졌다"를 어떻게 수치로 보이나요? 할당이 병목이 아닌 서비스라면 왜 차이가 거의 없을 수 있나요?
5. **JVM RSS 분리 계측** — JVM 컨테이너의 OOMKilled를 조사할 때, `-Xmx`로 잡은 자바 힙과 JNI·Direct 버퍼가 쓰는 native malloc RSS를 어떻게 분리해서 계측하나요(NMT: Native Memory Tracking, `pmap`, `jcmd`)? 여기에 `MALLOC_ARENA_MAX`가 왜 끼어드나요?
6. **ARM 서버의 스케일링** — AArch64(Graviton·Ampere)에서 malloc 집약 워크로드의 스케일링이 x86과 다르게 나타난다면, 약한 메모리 모델의 배리어 비용과 캐시라인(64B, Apple은 128B) false sharing 중 무엇을 먼저 의심하고 어떻게 관측하겠습니까?

## 핵심 요약

- malloc은 커널 비용(시스템 콜 약 1,400사이클 + 페이지 폴트)을 객체 하나하나마다 치르지 않으려는 **상각 계층**입니다. 커널에서 크게 받아 잘게 잘라 팔고, free된 조각을 재고로 쌓아 되팝니다
- glibc ptmalloc은 세 겹입니다. **arena**(락 하나가 지키는 풀), **heap**(커널에서 받은 땅), **chunk**(파는 최소 단위). main arena만 `brk`로 자라고, thread arena는 `mmap`으로 땅을 받습니다
- chunk는 남는 공간을 두 번 재활용합니다. `size` 필드의 하위 3비트에 플래그(P·M·A)를 얹고, 앞 chunk가 사용 중일 땐 이웃의 `prev_size` 칸까지 페이로드가 가져다 씁니다(경계 태그). 그래서 실질 헤더는 8바이트입니다
- `malloc(17)`은 32바이트 chunk를 차지합니다(`align16(17 + 8)`, `MINSIZE` 32). 요청과 실제의 차이가 **내부 단편화**입니다
- 탐색 순서는 tcache → fastbin → unsorted → small·large → top chunk → 커널입니다. **tcache는 스레드 로컬이라 락이 없고**, 소형 할당 대부분이 여기서 끝납니다. glibc 2.26 이후 malloc이 빨라진 결정적 이유입니다
- 서랍이 두 종류인 이유는 목적이 달라서입니다. tcache·fastbin은 머리만 만지면 되니 단일 연결, unsorted·small·large는 중간에서 빼내고 이웃과 병합해야 하니 이중 연결입니다
- arena를 늘리면 락 경합은 줄지만 top과 bin이 통째로 복제되어 RSS가 오릅니다(arena 폭발). 상한은 코어 수 × 8인데, **CPU 쿼터를 걸어도 glibc는 호스트의 코어 수를 봅니다** — 런타임은 컨테이너를 인식하는데 할당자는 못 하는 것입니다
- `M_MMAP_THRESHOLD`(초기 128KB)보다 작으면 arena 힙에서, 크면 독립 `mmap`으로 받습니다. 이 임계값은 큰 mmap chunk가 free될 때마다 스스로 올라가고 상한은 64비트에서 32MB입니다
- **free를 해도 RSS가 안 줄어드는 이유**는 `brk` 힙을 꼭대기부터만 헐 수 있기 때문입니다. 힙 한가운데 살아 있는 chunk 하나가 그 아래 전부의 반환을 막습니다. cgroup은 RSS를 세므로 이 자투리가 컨테이너 한도를 그대로 잡아먹습니다
- **"Rust가 `brk`/`mmap`을 직접 호출한다"는 부정확합니다.** 기본 `System` 할당자가 libc `malloc`에 위임하고, `brk`냐 `mmap`이냐는 malloc이 정합니다. Rust는 초기에 jemalloc을 내장했다가 RFC 1183·1974를 거쳐 1.32에서 시스템 할당자로 되돌아왔습니다
- 그래서 Rust 서비스의 메모리 성격은 상당 부분 그 아래 malloc이 쥐고 있습니다. `#[global_allocator]` 한 줄이 곧바로 RSS 곡선을 바꾸는 이유입니다
- jemalloc은 2025년 6월 아카이브됐다가 2026년 3월 Meta가 인수해 유지보수를 재개했고, 약 4년 만에 5.3.1이 나왔습니다. "죽은 프로젝트"라는 인상은 지금 기준으로 낡았습니다
- 갈림길은 하나입니다. 공용 도매상을 빌려 쓰느냐(C·C++·Rust), 전용 도매상을 짓느냐(Go·JVM)

---

**[다음 편 예고]**
지금까지 C와 Rust가 공용 malloc을 어떻게 나눠 쓰는지 봤습니다. 이제 이 계층을 통째로 우회한 진영으로 내려갑니다
다음 편은 **Go의 자체 할당자**를 엽니다. 구글 TCMalloc 계보를 이은 `mcache`(각 P마다 하나, 락 없음) → `mcentral` → `mheap`의 3층 구조, 크기를 표준 규격으로 묶는 size class와 span, 아주 작은 객체들을 한데 뭉치는 tiny allocator, 그리고 고루틴 스택이 자라는 방식(연속 스택·copystack)까지
특히 [5편](/essays/go-aot-fast-build-tradeoff)에서 이스케이프 분석이 "이건 힙으로 보낸다"고 판정했던 그 객체가 실제로 `mcache`의 어느 span에 떨어지는지, 그 착지 지점을 물리적으로 추적하겠습니다
