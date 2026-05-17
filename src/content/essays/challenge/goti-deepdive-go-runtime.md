---
title: "Go 런타임 — 정적 컴파일·콜드스타트·GC의 동작 원리"
excerpt: "Go는 JVM 없이 단일 정적 바이너리로 실행되며, 클래스 로딩·JIT warmup 단계가 없어 Pod이 수초 안에 Ready 상태에 도달합니다. 동시 GC는 대부분의 마킹 작업을 애플리케이션과 함께 수행하여 STW pause를 1ms 미만으로 억제합니다"
category: challenge
tags:
  - go-ti
  - golang
  - JVM
  - cold-start
  - garbage-collection
  - static-binary
  - concept
series:
  name: "goti-deepdive-runtime"
  order: 4
date: "2026-04-09"
---

## 한 줄 요약

> Go는 별도의 런타임 VM 없이 OS 위에서 직접 실행되는 정적 바이너리를 만듭니다. 클래스 로딩·JIT 컴파일이 없으므로 Pod 기동 시간이 수초 안에 끝나고, 동시 GC 설계로 STW pause를 1ms 미만으로 억제합니다

---

## 🤔 무엇을 푸는 기술인가

서버리스·컨테이너 환경에서 언어 런타임 선택은 두 가지 축에서 영향을 줍니다

첫째는 **기동 시간**입니다. 스케일아웃 시 새 Pod이 실제 트래픽을 받기까지 걸리는 시간을 결정합니다. 티켓팅처럼 오픈 순간에 트래픽이 폭증하는 도메인에서는 이 시간이 길면 HPA가 반응해도 의미가 없습니다

둘째는 **GC 특성**입니다. 부하 중 가비지 컬렉터가 애플리케이션 스레드를 얼마나, 얼마 동안 멈추는지가 p99 꼬리 지연에 직접 영향을 줍니다

JVM(Java Virtual Machine)은 클래스 로딩·바이트코드 해석·JIT 컴파일을 런타임에 수행합니다. 이 설계는 이식성과 런타임 최적화라는 강점을 주지만, 프로세스 시작 시점에 상당한 초기화 비용을 요구합니다

Go는 이 비용을 컴파일 타임에 미리 처리합니다. 빌드 결과물은 OS가 직접 실행할 수 있는 단일 ELF 바이너리입니다. 별도 VM이 필요 없습니다

---

## 🔧 동작 원리

### 정적 컴파일 — 런타임 VM이 없는 이유

Java 컴파일러(`javac`)는 소스 코드를 **바이트코드(.class)**로 변환합니다. 바이트코드는 JVM이라는 가상 머신이 해석하는 중간 표현입니다. JVM 위에서 실행되기 때문에 OS·아키텍처에 무관하게 동작하는 이식성을 얻지만, JVM 프로세스 자체가 런타임에 클래스를 로딩하고 해석합니다

Go 컴파일러(`go build`)는 소스 코드를 **네이티브 머신 코드**로 직접 컴파일합니다. 결과물은 CPU가 바로 실행할 수 있는 바이너리입니다. Go 런타임(goroutine 스케줄러, GC, 메모리 할당자)도 이 바이너리에 **링크**됩니다. 외부 의존 없이 바이너리 하나가 모든 것을 포함합니다

```bash
# Go 빌드 — 결과물이 단일 ELF 바이너리
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o server ./cmd/server

# 의존하는 공유 라이브러리 없음 (static link)
ldd server
# => not a dynamic executable
```

`CGO_ENABLED=0`으로 빌드하면 C 라이브러리에도 의존하지 않습니다. `FROM scratch`나 `FROM distroless`에 바이너리 하나만 COPY해도 동작하는 이유입니다

### JVM 콜드스타트 — 왜 30~60초가 걸리는가

JVM 프로세스가 시작된 뒤 첫 요청을 처리할 수 있는 상태가 되기까지 세 단계가 있습니다

**1단계 — 클래스 로딩(Class Loading)**

JVM은 클래스를 필요할 때 동적으로 로드합니다. Spring Boot 애플리케이션은 기동 시 수천 개의 클래스를 로드합니다. 각 클래스마다 `.class` 파일을 읽고, 바이트코드 검증(bytecode verification)을 수행하고, 심볼 참조를 해소(resolution)하는 과정이 필요합니다. Spring의 DI 컨테이너 초기화, 빈 등록, AOP 프록시 생성이 모두 이 단계에서 발생합니다

**2단계 — 인터프리트 실행**

처음에는 JVM이 바이트코드를 한 줄씩 해석(interpret)합니다. 이 상태에서는 네이티브 코드보다 10~100배 느립니다

**3단계 — JIT 컴파일(Just-In-Time Compilation)**

JVM은 자주 실행되는 메서드(핫 메서드)를 감지하고 JIT 컴파일러가 네이티브 코드로 컴파일합니다. C2 컴파일러까지 완전히 최적화되려면 메서드당 수천~수만 번의 실행이 필요합니다. 이 구간이 **warmup**입니다. warmup이 완료되기 전까지는 p99 응답 시간이 불안정합니다

Spring Boot + JVM 기준 이 세 단계를 합치면 통상 30~60초가 소요됩니다

### Go 콜드스타트 — 왜 수초 안에 끝나는가

Go 바이너리를 실행하면 OS 로더가 ELF 파일을 메모리에 적재합니다. Go 런타임 초기화(고루틴 스케줄러 설정, GC 초기화, 스택 풀 초기화)는 수십 밀리초 수준이고, 이후 `main()` 함수가 실행됩니다

클래스 로딩이 없습니다. 모든 코드는 이미 컴파일된 머신 코드 형태로 바이너리에 담겨 있습니다. JIT warmup도 없습니다. 바이너리가 적재되는 순간부터 최적화된 코드가 실행됩니다

![Pod 생성→Ready 타임라인 비교 — JVM warmup 구간 vs Go 빠른 시작|tall](/diagrams/goti-deepdive-go-runtime-1.svg)

위 다이어그램은 JVM과 Go의 Pod 생성부터 Ready 상태까지의 타임라인을 비교합니다

JVM 구간(위)을 보면, 이미지 Pull 이후 JVM 프로세스가 시작되지만 클래스 로딩과 JIT warmup 구간 전체(붉은 블록)가 지나야 Ready 마커에 도달합니다. 이 구간에서 HPA가 이미 Pod을 스케줄했어도 트래픽을 수용하지 못합니다. `initialDelaySeconds: 30~60s`로 readinessProbe 자체도 한참 뒤에 시작됩니다

Go 구간(아래)은 이미지 Pull 크기부터 차이가 납니다. distroless 기반 ~40MB 이미지는 Pull도 수 초 안에 끝납니다. 바이너리 실행 직후 Ready 마커에 도달하며, `initialDelaySeconds: 3s`만으로 충분합니다

하단 비교 표는 콜드스타트·이미지 크기·메모리·KEDA 의존성 4개 항목을 수치로 정리했습니다. 메모리 합산 수치(2,300Mi → 384Mi)는 동일한 서비스 수(6개)에서 측정된 실측값입니다

### GC STW pause — JVM과 Go의 근본 차이

**JVM GC의 기본 구조**

JVM의 가비지 컬렉터는 수십 년간 발전해왔습니다. G1GC(Garbage First)는 JDK 9부터 기본 GC로, heap을 고정 크기 Region으로 나누고 가비지가 많은 Region을 우선 수집합니다. Minor GC(Young 영역)는 STW(Stop-The-World)이며, Mixed GC에서도 Stop이 발생합니다. 부하 중 수십~수백ms의 pause가 재현됩니다

ZGC는 이 STW를 줄이기 위해 등장했습니다. 대부분의 GC 작업을 애플리케이션과 동시에 수행하여 STW를 1ms 미만으로 억제합니다. 그러나 ZGC는 heap을 여전히 크게 유지해야 하고(대용량 heap에서 효율적), JVM warmup·메모리 풋프린트 문제는 해소하지 않습니다

**Go 동시 GC의 설계**

Go GC는 처음부터 짧은 pause를 목표로 설계되었습니다. **Tri-color 마킹 알고리즘**을 사용하며, 마킹의 대부분을 애플리케이션 고루틴과 동시에 수행합니다

STW가 발생하는 구간은 단 두 번입니다

| 단계 | 종류 | 동작 | STW 여부 |
|---|---|---|---|
| Mark setup | STW | write barrier 활성화, 루트 포인터 마킹 시작 | **예 (< 1ms)** |
| Concurrent marking | 동시 | heap 객체 마킹 (앱과 동시 실행) | 아니오 |
| Mark termination | STW | write barrier 해제, 미처리 포인터 정리 | **예 (< 1ms)** |
| Concurrent sweep | 동시 | 미참조 객체 메모리 해제 | 아니오 |

**write barrier**는 동시 마킹 중 애플리케이션이 포인터를 수정할 때 GC가 새 참조를 놓치지 않도록 하는 장치입니다. Go의 write barrier는 Tri-color invariant를 유지하면서 마킹을 병렬로 진행하게 해줍니다

**Tri-color 마킹 알고리즘**은 객체를 세 가지 상태로 분류합니다

- **흰색(White)**: 아직 방문하지 않은 객체. GC 완료 후 흰색으로 남아있으면 unreachable → 수집 대상
- **회색(Grey)**: 발견되었지만 참조 필드를 아직 스캔하지 않은 객체
- **검은색(Black)**: 자신과 참조 필드 모두 스캔 완료. 더 이상 흰색을 직접 참조하지 않음

GC 시작 시 루트(스택, 전역 변수)에서 참조되는 객체를 회색으로 표시합니다. 이후 회색 객체를 하나씩 꺼내 참조 필드를 스캔하고 검은색으로 전환합니다. 이 과정을 고루틴 백그라운드에서 반복하고, 최종적으로 흰색으로 남은 객체가 unreachable이므로 메모리를 해제합니다

```go
// GOGC 파라미터로 GC 트리거 주기 제어
// 기본값 100 = 라이브 heap 대비 100% 할당 시 GC 트리거
// 낮출수록 GC 빈도 증가 (메모리 절약), 높일수록 throughput 유리
GOGC=100  // 기본값
GOGC=200  // GC 빈도 낮춤, 메모리는 더 씀
GOGC=off  // GC 비활성화 (단기 배치 작업용)
```

Go 1.19부터는 `GOMEMLIMIT`으로 heap 소프트 한도를 지정할 수 있습니다. 컨테이너 메모리 limit 안에서 GC를 조정할 때 유용합니다

![부하 중 GC pause 발생 비교 — JVM G1/ZGC vs Go 동시 GC|tall](/diagrams/goti-deepdive-go-runtime-2.svg)

위 다이어그램은 요청 처리 스레드 관점에서 세 GC의 pause 특성을 비교합니다

맨 위 JVM G1GC 구간에서 붉은 블록이 STW pause를 나타냅니다. 부하 중 50~200ms가 주기적으로 발생하며, 이 구간에서 모든 요청 처리 스레드가 멈춥니다. p99 지연이 이 패턴에 직접 연동됩니다

중간 ZGC 구간에서는 STW 블록이 얇아집니다(1ms 미만). 그러나 주황색 점선 블록이 동시 GC 작업이 CPU를 소비하고 있음을 나타냅니다. 콜드스타트·메모리 문제는 해소되지 않습니다

맨 아래 Go GC 구간에서는 보라색 점선 박스가 동시 마킹 구간입니다. 요청 처리 흐름(녹색 바)이 거의 중단 없이 이어집니다. STW 마커(보라색 얇은 세로 선)는 mark setup·termination 2회뿐이며 1ms 미만입니다. 하단 표는 Go 동시 GC의 세 단계와 STW 발생 여부를 정리합니다

### 메모리 풋프린트 — 정적 바이너리의 구조적 이점

JVM 프로세스는 heap 외에 메타스페이스(클래스 메타데이터), JIT 코드 캐시, JVM 자체 코드 영역을 모두 메모리에 올립니다. Spring Boot 서비스 하나가 최소 512Mi를 요구하는 이유입니다

Go 프로세스는 Go 런타임(수 MB)과 실제 애플리케이션 코드·데이터만 필요합니다. 클래스 메타데이터도, JIT 코드 캐시도 없습니다. 같은 HTTP API 서버라면 Go가 JVM 대비 훨씬 작은 메모리로 동일한 요청을 처리합니다

단, Go는 GC가 없는 언어가 아닙니다. heap을 사용하는 것은 동일하며, 사용 패턴에 따라 메모리가 늘어납니다. 차이는 JVM overhead 없이 순수 애플리케이션 데이터만큼의 메모리를 사용한다는 점입니다

---

## 📐 세부 동작과 옵션

### 이스케이프 분석 — stack vs heap 할당 결정

Go 컴파일러는 **이스케이프 분석(escape analysis)**으로 객체를 스택과 heap 중 어디에 할당할지 결정합니다

```go
func newUser() *User {
    u := User{ID: 1}  // 이 User는 함수 밖으로 탈출(escape) → heap 할당
    return &u
}

func processRequest(id int) {
    result := compute(id)  // result가 함수 안에서만 쓰이면 → stack 할당
    _ = result
}
```

스택에 할당된 객체는 함수 반환 시 자동 해제됩니다. GC 부담이 없습니다. heap 할당이 줄수록 GC 압력이 낮아지고 pause 빈도가 줄어듭니다. `go build -gcflags="-m"` 으로 어떤 변수가 heap으로 이스케이프되는지 확인할 수 있습니다

### GOGC와 GOMEMLIMIT — GC 튜닝 파라미터

| 파라미터 | 설명 | 권장 |
|---|---|---|
| `GOGC=100` (기본) | 라이브 heap 대비 100% 할당 증가 시 GC 트리거 | 대부분의 서버에 적합 |
| `GOGC=200` | GC 빈도 낮춤, 메모리 더 사용 | throughput 중시 배치 작업 |
| `GOMEMLIMIT=500MiB` | heap 소프트 한도 (Go 1.19+) | 컨테이너 메모리 limit 60~80% 수준 설정 |
| `GOGC=off + GOMEMLIMIT` | GOMEMLIMIT 기반 GC 제어 | 컨테이너 환경 권장 패턴 |

`GOMEMLIMIT`은 소프트 한도이므로 limit을 초과해도 즉시 OOM이 나지 않습니다. GC가 더 공격적으로 실행되어 메모리를 반환합니다

### distroless 이미지와 이진 크기

Go 정적 바이너리는 OS 기본 라이브러리 의존이 없습니다. `FROM gcr.io/distroless/static-debian12:nonroot`처럼 shell도 없는 최소 이미지에 바이너리만 복사하면 컨테이너가 완성됩니다

```dockerfile
# 멀티 스테이지 빌드 패턴
FROM golang:1.26 AS builder
WORKDIR /app
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o server ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /app/server /server
ENTRYPOINT ["/server"]
```

shell이 없으면 공격 표면이 줄고, 이미지 내부에서 임의 코드 실행이 불가능합니다. 이미지 크기가 ~40MB 수준이 되면 이미지 Pull 시간도 단축되어 HPA 스케일아웃 실효성을 높입니다

### GraalVM Native Image와의 비교

JVM 생태계에서 콜드스타트를 해결하는 또 다른 경로는 **GraalVM Native Image**입니다. AOT(Ahead-of-Time) 컴파일로 JVM 없이 실행되는 네이티브 바이너리를 만들고, 콜드스타트를 수초 수준으로 줄입니다

| 특성 | Go 정적 바이너리 | GraalVM Native Image |
|---|---|---|
| 빌드 시간 | 수 초~수십 초 | 수 분 (메모리 집약적) |
| 리플렉션·DI 호환 | 기본 언어 특성으로 이슈 없음 | Spring AOT 설정 필요, 일부 불호환 |
| 런타임 JIT 최적화 | 없음 (AOT 컴파일된 코드) | 없음 (AOT) |
| GC | Go 동시 GC (내장) | Serial GC 기본, G1 실험적 지원 |
| 생태계 성숙도 | 성숙 | 진행 중 (Spring Native 3.x) |

GraalVM Native Image는 기존 Java 코드 자산을 그대로 활용하는 경로입니다. 리플렉션·프록시·JPA 같은 Spring 핵심 기능과의 AOT 불호환 이슈가 있고, 빌드 인프라 비용이 높습니다

---

## 🧩 go-ti에서는

go-ti에서 Java/Spring Boot 6개 서비스를 Go로 재작성한 핵심 동기가 바로 위에서 설명한 런타임 특성입니다. Java 프로덕션 환경에서 3000VU 부하 테스트 시 JVM 콜드스타트 30~60초가 HPA 스케일아웃을 무력화했습니다. 오픈 순간 Pod이 추가로 떠도 warmup이 끝나기 전까지 트래픽을 수용하지 못했고, KEDA cron pre-scale로 오픈 시각 전에 강제로 replica를 띄워두는 방식이 필수였습니다

Go 전환 후 콜드스타트는 1~3초로 단축되었습니다. `initialDelaySeconds: 3`으로 readinessProbe 대기를 거의 없애고, HPA cooldownPeriod도 300s → 120s로 줄였습니다. KEDA cron pre-scale 의존도 사라졌습니다. 메모리 합산은 ~2,300Mi에서 ~384Mi로 줄어 동일 노드에서 수용 가능한 replica 수가 늘었습니다. 이미지는 ~280MB(Eclipse Temurin JRE 기반)에서 ~40MB(distroless)로 축소되어 이미지 Pull 시간도 단축되었습니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [Java/Spring Boot → Go 전환 — 콜드스타트·메모리·GC를 근거로 Go를 선택한 이유](/logs/goti-java-to-go-migration-adr)에 정리했습니다

---

## 📚 핵심 정리

- Go는 JVM 없이 OS 위에서 직접 실행되는 정적 바이너리를 만듭니다. 클래스 로딩·JIT warmup 단계가 없어 Pod 기동 시간이 1~3초 수준에서 끝납니다
- JVM 콜드스타트 30~60초의 실체는 클래스 로딩(수천 개) + JIT warmup(핫 메서드가 최적화될 때까지 수만 번 실행 대기) 구간입니다
- Go GC는 Tri-color 마킹을 애플리케이션과 동시에 수행합니다. STW가 발생하는 구간은 mark setup·mark termination 단 두 번, 각 1ms 미만입니다
- Go 메모리 절약은 JVM heap 외 메타스페이스·JIT 코드 캐시 같은 JVM 고유 오버헤드가 없기 때문입니다. 애플리케이션 데이터만큼의 메모리를 사용합니다
- `GOMEMLIMIT`(Go 1.19+)으로 컨테이너 메모리 limit 안에서 GC를 조정할 수 있습니다. `GOGC=off + GOMEMLIMIT` 조합이 컨테이너 환경 권장 패턴입니다
