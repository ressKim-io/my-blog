---
title: "Go 동시성 — goroutine·channel·GMP 스케줄러의 동작 원리"
excerpt: "Go가 수천 개의 goroutine을 적은 수의 OS 스레드에 효율적으로 다중화하는 방법, channel이 CSP 모델로 goroutine 간 통신을 안전하게 조율하는 방법, GMP 스케줄러가 컨텍스트 스위칭 비용을 줄이는 방법을 설명합니다"
category: challenge
tags:
  - go-ti
  - golang
  - goroutine
  - channel
  - GMP-scheduler
  - concept
series:
  name: "goti-deepdive-runtime"
  order: 5
date: "2026-04-09"
---

## 한 줄 요약

> Go는 GMP 스케줄러로 수천 개의 goroutine을 소수의 OS 스레드에 다중화합니다 goroutine은 2KB에서 시작하는 스택으로 OS 스레드 대비 500배 이상 밀도를 높이고, channel은 CSP 모델로 공유 메모리 없이 goroutine 간 통신을 조율합니다

---

## 🤔 무엇을 푸는 기술인가

서버가 동시 요청을 처리하는 방식은 두 가지 극단이 있습니다

첫째는 **Thread-per-Request 모델**입니다 요청마다 OS 스레드를 할당합니다 구현이 직관적이지만, OS 스레드 하나의 스택이 기본 1MB 수준이라 수천 개의 동시 요청이 들어오면 수 GB의 메모리가 스택 공간으로 소비됩니다 OS 커널이 스레드를 스케줄링할 때마다 레지스터 저장, 메모리 맵 전환 같은 컨텍스트 스위칭 비용도 축적됩니다

둘째는 **이벤트 루프(Event Loop) 모델**입니다 단일 스레드가 I/O 완료 이벤트를 비동기로 처리합니다 메모리 효율은 좋지만, CPU 병렬성이 코어 수만큼 나오지 않고 콜백 중첩으로 코드가 복잡해집니다

Go는 두 모델의 장점을 취합니다 코드는 동기 스타일로 작성하되, 런타임이 내부적으로 비동기 I/O와 다중화를 수행합니다 이 구조의 핵심이 **GMP 스케줄러**입니다

동시성 제어 측면에서는 전통적인 공유 메모리 + 뮤텍스 패턴 대신 **CSP(Communicating Sequential Processes)** 모델을 채택합니다 채널을 통해 값을 전달함으로써 여러 goroutine이 같은 데이터를 동시에 수정하는 상황 자체를 구조적으로 피합니다

---

## 🔧 동작 원리

### goroutine — 경량 스레드의 실체

goroutine은 Go 런타임이 관리하는 실행 단위입니다 `go` 키워드 하나로 생성하며, 생성 비용이 낮습니다

```go
// goroutine 생성 — 수 마이크로초, 스택 ~2KB
go func() {
    handleRequest(req)
}()
```

OS 스레드와 goroutine의 차이는 **스택 크기**에서 시작합니다

OS 스레드는 생성 시 고정 크기 스택을 미리 할당합니다 Linux 기본값은 8MB이며, 일반적으로 1MB 내외로 설정됩니다 이 크기는 실제 사용량과 무관하게 메모리를 점유합니다

goroutine의 초기 스택은 **2KB(Go 1.4 이전 8KB, 이후 2~4KB)**입니다 단순히 작은 것이 아니라, **동적으로 증가**합니다 함수 호출 깊이가 깊어져 스택이 부족해지면 런타임이 두 배 크기의 새 스택을 할당하고 기존 스택을 복사합니다(스택 복사 방식, Go 1.3+) 실제로 스택을 많이 쓰는 goroutine은 커지고, 단순 I/O 대기 goroutine은 수 KB를 유지합니다

이 특성 덕분에 수천 개의 goroutine을 동시에 유지해도 합산 메모리가 OS 스레드 수백 개보다 훨씬 적습니다

```go
// 10만 goroutine 생성 — 합산 스택 수백 MB 미만
for i := 0; i < 100_000; i++ {
    go func(id int) {
        time.Sleep(time.Second)
    }(i)
}
```

### GMP 스케줄러 — 세 계층의 역할

Go 런타임 스케줄러는 **G(Goroutine) · M(Machine=OS Thread) · P(Processor)** 세 구조체로 동시성을 관리합니다

![GMP 스케줄러 구조 — G가 P 큐에서 M에 매핑되는 구조|tall](/diagrams/goti-deepdive-go-concurrency-1.svg)

위 다이어그램은 GMP 스케줄러의 전체 구조입니다 최상단 글로벌 런큐에서 P 로컬 큐로 G가 내려오고, P 위에서 현재 실행 중인 G가 M(OS 스레드)에 매핑되어 CPU에서 실행됩니다

세 구조체의 역할을 구체적으로 살펴보면 다음과 같습니다

**G (Goroutine)**는 실행할 함수와 스택, 상태(Running · Runnable · Waiting · Dead)를 보관하는 구조체입니다 Go 런타임 힙에 할당되며, OS 스레드와 1:1 대응이 아닙니다 수십만 개가 동시에 존재할 수 있습니다

**M (Machine)**은 실제 OS 스레드를 래핑한 구조체입니다 OS 커널이 M을 CPU에 스케줄링합니다 M은 실행하려면 반드시 P 하나를 보유해야 합니다 P 없이는 G를 실행할 수 없습니다

**P (Processor)**는 로컬 런큐와 스케줄러 상태를 보유하는 논리적 프로세서입니다 P의 개수는 `GOMAXPROCS` 환경변수로 결정되며, 기본값은 CPU 코어 수입니다 P는 로컬 큐에 최대 256개의 G를 보관합니다

세 계층의 관계를 정리합니다 P가 M에 붙고, G가 P 위에서 실행됩니다 M은 P 없이 idle 상태로 대기합니다 G를 새로 생성하면 현재 P의 로컬 큐에 넣습니다 로컬 큐가 가득 차면 절반을 글로벌 런큐로 이동합니다

### 스케줄링 루프 — G가 M을 양보하는 시점

Go 스케줄러는 선점적(preemptive) 방식과 협력적(cooperative) 방식을 혼합합니다

협력적 전환이 발생하는 시점은 다음과 같습니다

- **channel 연산 블록** — send/recv가 준비되지 않은 상태에서 블록될 때
- **syscall 진입** — 파일 I/O, 네트워크 소켓 등 시스템 콜 호출 시
- **`runtime.Gosched()`** — 명시적 양보
- **`time.Sleep()`** — 타이머 대기

선점적 전환(Go 1.14+)은 협력하지 않고 오래 실행되는 goroutine을 신호(SIGURG)로 중단시킵니다 이전에는 CPU-bound 루프가 다른 G를 굶길 수 있었지만, 1.14부터 10ms마다 강제 선점이 가능합니다

syscall 처리 방식이 특히 중요합니다 G가 blocking syscall(예: 파일 read)에 진입하면, 런타임은 해당 M과 G의 결합을 끊고 P를 다른 유휴 M(또는 새로 생성한 M)에 붙입니다 syscall이 완료되면 G는 다시 Runnable 상태로 런큐에 들어갑니다 이 메커니즘으로 P는 항상 busy 상태를 유지하며, blocking syscall 하나가 전체 P를 멈추지 않습니다

```go
// 아래 코드에서 file.Read()가 blocking syscall을 유발해도
// 같은 P에서 다른 goroutine이 계속 실행됨
go func() {
    data, _ := os.ReadFile("/var/log/app.log")
    process(data)
}()

go func() {
    // 이 goroutine은 위 goroutine의 syscall과 무관하게 실행됨
    handleHTTPRequest(w, r)
}()
```

### work-stealing — P 간 부하 균형

로컬 큐가 비어있는 P는 다음 순서로 G를 가져옵니다

1. **글로벌 런큐** — 주기적으로 확인 (과도한 확인 방지를 위해 61번 중 1번 비율)
2. **다른 P의 로컬 큐** — 절반을 빼앗아 옴 (work-stealing)
3. **네트워크 폴러(netpoller)** — I/O 완료로 깨어난 G

work-stealing은 P 간 부하가 불균등해도 모든 M이 쉬지 않고 작업하도록 보장합니다 특정 P에 G가 몰려있어도 빈 P가 자동으로 가져가기 때문에, 애플리케이션 코드에서 직접 부하 분산을 신경 쓸 필요가 없습니다

### channel과 CSP 모델

Go의 동시성 철학은 "메모리를 공유해서 통신하지 말고, 통신해서 메모리를 공유하라(Do not communicate by sharing memory; instead, share memory by communicating)"입니다 이 철학의 구현체가 channel입니다

channel은 goroutine 간 값을 안전하게 전달하는 타입 있는 파이프입니다 내부는 링 버퍼(ring buffer)와 발신·수신 goroutine 대기 큐로 구성됩니다

```go
// unbuffered channel — 발신자와 수신자가 동시에 준비되어야 전달
ch := make(chan int)

go func() {
    ch <- 42  // 수신자가 없으면 이 goroutine은 블록됨
}()

val := <-ch  // 값을 받을 때까지 블록

// buffered channel — 버퍼가 가득 차기 전까지 발신자 블록 안 됨
buffered := make(chan int, 10)
```

**unbuffered channel**은 두 goroutine이 정확히 같은 시점에 만나는 랑데부 포인트(rendezvous)입니다 발신자가 `ch <- v`를 실행하면 수신자가 나타날 때까지 G는 Waiting 상태가 됩니다 이 전환은 OS 커널을 거치지 않고 런타임 내에서 처리됩니다

**buffered channel**은 크기 n인 링 버퍼를 가집니다 버퍼가 비어있지 않으면 수신자가 즉시 읽을 수 있고, 버퍼가 가득 차지 않으면 발신자가 즉시 쓸 수 있습니다 발신·수신 goroutine의 속도 차이를 흡수하는 완충 역할을 합니다

channel의 내부 구조를 살펴보면, `hchan` 구조체가 다음 필드를 가집니다

```go
// runtime/chan.go (단순화)
type hchan struct {
    qcount   uint          // 버퍼 내 현재 데이터 수
    dataqsiz uint          // 버퍼 크기 (make(chan T, n)의 n)
    buf      unsafe.Pointer // 링 버퍼 포인터
    sendx    uint          // 다음 쓸 인덱스
    recvx    uint          // 다음 읽을 인덱스
    recvq    waitq         // recv 대기 goroutine 큐
    sendq    waitq         // send 대기 goroutine 큐
    lock     mutex         // 채널 접근 뮤텍스
}
```

channel 연산에 뮤텍스가 있지만, 이는 채널 내부 상태를 보호하는 런타임 레벨의 짧은 락입니다 사용자 코드에서 명시적 뮤텍스 없이도 goroutine 간 데이터 전달이 안전한 이유입니다

### select와 다중 channel 처리

`select` 문은 여러 channel 연산을 동시에 대기합니다

```go
select {
case msg := <-requests:
    handleRequest(msg)
case <-ctx.Done():
    return ctx.Err()
case <-ticker.C:
    flushBuffer()
default:
    // 모든 case가 블록 상태이면 즉시 실행
}
```

`select` 내부에서 여러 case가 동시에 준비되면, Go 런타임은 **uniform pseudo-random**으로 하나를 고릅니다 특정 case가 항상 우선되어 다른 case를 굶기지 않도록 설계되어 있습니다

### 컨텍스트 스위칭 비용 비교

![goroutine 다중화 — OS 스레드 대비 밀도 차이|tall](/diagrams/goti-deepdive-go-concurrency-2.svg)

위 다이어그램은 Java의 Thread-per-Request 모델과 Go의 goroutine 다중화 모델을 나란히 비교합니다

왼쪽 Java 영역에서는 요청마다 OS 스레드 하나가 대응됩니다 스레드 하나당 약 1MB 스택이 고정 할당되며, 동시 요청이 수백 개가 되면 스택만으로도 수백 MB가 소비됩니다 스레드 수가 CPU 코어 수를 크게 초과하면 OS 스케줄러가 빈번하게 컨텍스트 스위칭을 수행하며, 이 과정에서 레지스터 저장/복원, TLB 플러시 같은 비용이 발생합니다

오른쪽 Go 영역에서는 수천 개의 goroutine이 CPU 코어 수에 맞춰 생성된 소수의 OS 스레드에 다중화됩니다 goroutine 초기 스택이 2KB이므로 같은 메모리로 500배 이상 많은 동시 실행 단위를 유지할 수 있습니다 goroutine 간 전환은 OS 커널을 거치지 않고 런타임 내에서 레지스터 일부(PC, SP, goroutine 구조체 포인터)만 저장합니다 측정값 기준으로 OS 컨텍스트 스위칭은 수 마이크로초, goroutine 전환은 수십~수백 나노초 수준입니다

하단의 channel 블록 흐름 설명에서 보듯, G1이 channel recv로 블록되면 런타임은 G1을 대기 상태로 전환하고 M이 P 큐에서 G2를 즉시 꺼내 실행합니다 M이 idle 상태에 머무는 시간이 거의 없습니다

---

## 📐 세부 동작과 옵션

### goroutine 누수 — 주의해야 할 패턴

goroutine은 가볍지만 명시적으로 종료해야 합니다 종료 경로가 없으면 goroutine이 누수(leak)됩니다

```go
// 위험 패턴 — 수신자 없으면 goroutine이 영원히 블록됨
ch := make(chan int)
go func() {
    ch <- computeResult()  // 수신자가 종료되면 이 goroutine은 GC 안 됨
}()
// ch를 닫지 않고 함수 반환

// 안전 패턴 — context로 goroutine 수명을 제어
func worker(ctx context.Context, ch <-chan Job) {
    for {
        select {
        case job := <-ch:
            process(job)
        case <-ctx.Done():
            return  // context 취소 시 goroutine 정상 종료
        }
    }
}
```

`context.Context`를 goroutine에 전달하고, `ctx.Done()` channel을 `select`에 포함하는 패턴이 표준입니다 HTTP 핸들러에서 시작한 goroutine은 요청 context가 취소되면 함께 종료되어야 합니다

### sync 패키지 — channel이 맞지 않는 상황

공유 상태를 여러 goroutine이 읽고 쓸 때는 `sync` 패키지를 사용합니다

| 타입 | 용도 |
|---|---|
| `sync.Mutex` | 임계 구역 보호 (읽기/쓰기 혼용) |
| `sync.RWMutex` | 읽기 다수·쓰기 소수인 경우 읽기 동시 허용 |
| `sync.WaitGroup` | 여러 goroutine이 모두 완료될 때까지 대기 |
| `sync.Once` | 함수를 정확히 한 번만 실행 (초기화 패턴) |
| `sync.Map` | 동시 안전 맵 (특정 패턴에서 map+Mutex보다 빠름) |
| `atomic` 패키지 | 단순 카운터·플래그의 원자적 연산 |

channel은 소유권 이전과 파이프라인에 적합하고, Mutex는 캐시처럼 공유 상태를 여러 goroutine이 직접 접근할 때 적합합니다 "channel인가 Mutex인가"는 소유권 이전 여부로 판단합니다

### GOMAXPROCS — P 개수 조정

```bash
# 기본값: CPU 코어 수
GOMAXPROCS=4 ./server
```

```go
// 또는 런타임에서 변경
runtime.GOMAXPROCS(runtime.NumCPU())
```

컨테이너 환경에서는 `GOMAXPROCS`가 호스트 CPU 수를 읽는 문제가 있었습니다 `uber-go/automaxprocs` 라이브러리가 cgroup CPU limit을 감지하여 자동으로 보정합니다

```go
import _ "go.uber.org/automaxprocs"
// main() 시작 전에 자동으로 GOMAXPROCS를 cgroup 기반으로 조정
```

---

## 🧩 go-ti에서는

go-ti에서 대기열(Queue) 서비스가 goroutine·channel의 직접적인 수혜를 받은 영역입니다 좌석 hold와 순번 처리 같은 경합 제어 로직에서 Java의 Thread-per-Request 모델은 동시 연결이 늘어날수록 스레드 풀 고갈과 메모리 압박이 함께 발생했습니다 Go 전환 후 동일 트래픽에서 goroutine은 OS 스레드 개수를 훨씬 초과하는 수천 개가 동시에 실행되었고, 메모리 합산은 6개 서비스 기준 약 2,300Mi에서 384Mi로 낮아졌습니다

Lua atomic 연산(Redis)과 pgx 커넥션 풀링도 내부적으로 goroutine 기반입니다 동시 DB 요청이 goroutine 단위로 분리되어, 하나의 쿼리가 블록되어도 나머지 goroutine은 계속 실행됩니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [Java/Spring Boot → Go 전환 — 콜드스타트·메모리·GC를 근거로 Go를 선택한 이유](/logs/goti-java-to-go-migration-adr)에 정리했습니다

---

## 📚 핵심 정리

- goroutine의 초기 스택은 2KB이며 동적으로 증가합니다 OS 스레드 1MB 대비 500배 이상의 밀도로 동시 실행 단위를 유지할 수 있습니다
- GMP 스케줄러에서 G는 goroutine, M은 OS 스레드, P는 로컬 런큐를 가진 논리적 프로세서입니다 P 개수는 `GOMAXPROCS`로 결정되며 기본값은 CPU 코어 수입니다
- goroutine 전환은 OS 커널을 거치지 않고 런타임 내에서 레지스터 일부만 저장하여 수십~수백 나노초 수준입니다 OS 컨텍스트 스위칭(수 마이크로초) 대비 10~100배 빠릅니다
- channel은 CSP 모델의 구현체입니다 뮤텍스 없이 goroutine 간 데이터 소유권을 안전하게 이전합니다 unbuffered는 랑데부, buffered는 속도 차이 흡수에 사용합니다
- work-stealing으로 빈 P가 다른 P의 로컬 큐에서 G를 가져와 모든 M이 idle 없이 작업을 처리합니다
