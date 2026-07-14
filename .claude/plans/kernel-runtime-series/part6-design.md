# 6부 설계 문서 — K8s는 Go의 한계를 어떻게 우회했나

> **이 문서의 지위**: 1~5부의 `drafts/*.md`를 대체합니다.
> 6부부터는 원본 정리가 없고, **K8s 소스와 실측이 원본**입니다.
> draft가 하던 견제(사람이 한 번 읽고 승인) 역할을 이 문서가 대신합니다.
> **사용자 승인 후 23편부터 착수**. 승인 전에는 본문을 쓰지 않습니다.
>
> 작성: 2026-07-14 (설계 세션) · 대상: 23~27편 (6부 5편)

---

## 1. 왜 draft 없이 가는가

6부 주제는 "실제로 도는 Go 프로그램이 어떻게 Go의 한계를 견디는가"입니다.
이건 **1차 자료가 존재하는 유일한 부**입니다 — K8s 소스와 실제 클러스터.
학습 정리를 옮기는 것보다 소스를 직접 읽는 편이 정확합니다.

1~5부에서 draft의 통념이 실측에 무너진 사례가 누적 **8건**이었습니다
(4부 4건 · 5부 4건 — plan.md §6 참조). 6부는 그 위험 자체가 없습니다.

---

## 2. 6부의 논지 — 소스가 먼저 말해 준 것

설계 세션에서 K8s v1.36.1 소스를 직접 확인한 결과, **논지가 뒤집혔습니다.**

당초 22편이 예고한 프레임은 "K8s 엔지니어들이 Go의 한계를 우회한 패턴들"이었습니다.
그런데 소스를 열어 보면 **Go 런타임을 조정하는 코드가 한 줄도 없습니다.**

| 확인 항목 | 결과 | 근거 |
|---|---|---|
| `uber-go/automaxprocs` 의존성 | **0건** | `go.mod`·`go.sum` 전무 |
| `debug.SetGCPercent` 호출 | **0건** | vendor 포함 전 트리 |
| `debug.SetMemoryLimit` 호출 | **0건** | 유일한 문자열은 `vendor/golang.org/x/tools/internal/stdlib/manifest.go:10560`의 stdlib **목록**이지 호출이 아님 |
| 컴포넌트가 하는 유일한 일 | 운영자가 넣은 env를 **로그로 찍기만** 함 | `cmd/kube-apiserver/app/server.go:152` · `cmd/kubelet/app/server.go:547` · `cmd/kube-scheduler/app/server.go:180` · `cmd/kube-controller-manager/app/controllermanager.go:206` · `cmd/kube-proxy/app/server.go:541` |

```go
// cmd/kube-apiserver/app/server.go:152
klog.InfoS("Golang settings", "GOGC", os.Getenv("GOGC"), "GOMAXPROCS", os.Getenv("GOMAXPROCS"), "GOTRACEBACK", os.Getenv("GOTRACEBACK"))
```

**그래서 6부의 논지는 이렇게 확정합니다.**

> K8s는 Go의 한계를 **런타임 튜닝으로 극복하지 않았습니다.**
> 바이너리에 손잡이가 아예 없습니다.
> 대신 **한계가 드러나는 지점 자체를 아키텍처로 비켜 갔습니다** —
> 할당을 줄이고(`sync.Pool`), 같은 일을 두 번 안 하고(직렬화 캐시),
> 요청 자체를 없애고(Informer), 값싼 동시성 단위를 물량으로 씁니다(파드당 고루틴).
> 그리고 그 우회마다 **청구서가 사람에게 넘어갔습니다.**

마지막 문장이 5부까지 세운 **비용 보존 법칙**(12·17·22편)의 6부 판입니다.
12편의 삼각형(단편화 ↔ 이동 비용 ↔ **컴파일러·사람**)에서, K8s는 일관되게 **사람** 쪽을 골랐습니다.

---

## 3. 편 분할 (5편 · order 23~27)

1부 3편 · 2부 4편 · 3부 5편 · 4부 5편 · 5부 5편의 리듬을 따라 **4편 + 소결 1편**입니다.
`date = 2026-06-25 + order` 규칙 유지.

### 23편 (6.1) — 무대: 한도를 강제하는 자의 자기 면제

- **slug(제안)**: `k8s-control-plane-self-exemption`
- **date**: 2026-07-18 · **tags[0]**: `go`
- **논지**: K8s 컨트롤 플레인을 5부의 잣대(cgroup·GC·고루틴)로 계측하면,
  **정작 자기 자신은 5부가 말한 처형선 밖에 있다.** 그리고 런타임 손잡이도 안 쓴다.
  그 두 사실이 6부 전체의 무대다.
- **척추 실측**: 스태틱 파드 매니페스트에 `limits`가 없음 → QoS `Burstable` →
  cgroup `memory.max = max` → **18편의 OOMKill 처형선이 이들에겐 안 그어져 있음**
- **회수**: 18편(GOMEMLIMIT 수동·처형선) · 19편(인두세) · 2편 `:163`(automaxprocs)
- **심기**: 그럼 무엇으로 버티나 → 24~26편 세 우회
- **SVG 예상**: 5

### 24편 (6.2) — 파드 하나에 고루틴 하나

- **slug(제안)**: `kubelet-goroutine-per-pod`
- **date**: 2026-07-19 · **tags[0]**: `go`
- **논지**: kubelet은 동시성을 아끼지 않는다. **파드마다 고루틴을 하나씩 통째로 쓴다**
  (`pkg/kubelet/pod_workers.go:963`). 이건 고루틴이 2KB(10편)라서 성립하는 설계다.
  1:1 스레드 모델(2편)이었다면 같은 코드가 성립하지 않는다.
- **척추 실측**: 파드 수를 늘리며 kubelet `go_goroutines`·`go_memstats_stack_inuse_bytes` 기울기 →
  **고루틴당 실효 스택**을 뽑고, 2편의 OS 스레드 기본 8MB와 대비
- **소스 확정치**: `MaxPods = 110`(`defaults.go:196`) ·
  `genericPlegRelistPeriod = 1s` / `eventedPlegRelistPeriod = 300s`(`kubelet.go:215,219`)
- **회수**: 2편(M:N·1:1 스택 비용) · 10편(2KB 연속 스택)
- **심기**: 값싼 동시성의 대가 = 상태 폴링(PLEG 1초 relist)이 파드 수에 비례 → 25편의 "일을 줄이는 기술"로
- **SVG 예상**: 6

### 25편 (6.3) — N명에게 보내면서 한 번만 직렬화하는 법

- **slug(제안)**: `k8s-sync-pool-serialization`
- **date**: 2026-07-20 · **tags[0]**: `go`
- **논지**: apiserver에서 할당이 폭발하는 자리는 **watch 팬아웃**이다
  (오브젝트 1개 변경 × N개 워처 = N번 직렬화). K8s는 여기에 두 겹의 방어를 깐다 —
  버퍼를 재사용하고(`sync.Pool`), 직렬화 **결과 자체를 캐시한다**(`cachingObject`).
- **척추 실측**:
  1. `sync.Pool` 내부 해부 + **victim cache 실증** — 10편 `:329`가 "GC 시점에 비워질 수 있다"고
     던져 둔 것을 `runtime.GC()` 1회/2회로 물리적으로 회수
  2. **protobuf vs JSON** 디코딩 할당량(`allocs/op`) — CRD가 왜 apiserver CPU를 태우는지의 물리
  3. 워처 N=1 vs N=50에서 apiserver `go_memstats_mallocs_total` 기울기 → **N배가 아님**을 보임
- **소스 확정치**: `AllocatorPool`(`apimachinery/pkg/runtime/allocator.go:35`)의 호출자가
  하필 `apiserver/pkg/endpoints/handlers/watch.go:138,155,253,356`.
  주석이 이 시리즈의 결론을 그대로 적어 놓음 — *"relieving pressure on the garbage collector"*(`:24`),
  *"It exists to make the cost of object serialization cheaper"*(`:42`).
  `cachingObject`는 `serializationsCache` + `sync.Once`로 인코딩당 1회만 직렬화
  (`apiserver/pkg/storage/cacher/caching_object.go:45~80`)
- **회수**: 10편 `:327·:329·:435·:437`(sync.Pool 복선 — **본편이 해부**) ·
  14편 `:283`(Mark Assist: 할당률이 GC 노동) · 5편 `:228`(이스케이프 분석)
- **심기**: 서버가 아무리 아껴도 요청이 오면 일은 생김 → **요청 자체를 없애는** 26편으로
- **SVG 예상**: 7

### 26편 (6.4) — 요청을 없애는 캐시, 사람에게 넘긴 청구서

- **slug(제안)**: `informer-shared-pointer-cost`
- **date**: 2026-07-21 · **tags[0]**: `go`
- **논지**: Informer는 N개 컨트롤러가 apiserver를 폴링하지 않게 만든다.
  **watch 하나 + 로컬 캐시 하나**로 전부를 먹인다. 그리고 그 캐시는
  N개 핸들러에게 **같은 포인터를 그대로** 넘긴다(복사 0). 청구서는 두 장이다 —
  ① "절대 수정하지 마라"는 규약이 **사람**에게 넘어가고
  ② 느린 핸들러 하나가 **상한 없는 링버퍼**로 힙을 부순다.
- **척추 실측**:
  1. **공유 포인터 실증** — 핸들러 두 개가 받은 객체 주소(`%p`)가 동일함을 출력
  2. **무한 링버퍼 재현** — 느린 핸들러를 붙이고 이벤트를 퍼부어 힙 폭증.
     K8s 주석이 자백한 실패 모드를 숫자로
  3. Informer 캐시 메모리 — 오브젝트 N개일 때, 그리고 `TransformFunc`로
     `managedFields`를 떼면 얼마가 주는지
- **소스 확정치**: `distribute(addNotification{newObj: obj})`(`shared_informer.go:965,987`) —
  **`DeepCopy` 0건**. `pendingNotifications`는 *"unbounded ring buffer … a failing/stalled
  listener will have infinite pendingNotifications"*(`shared_informer.go:1223~1224`, 주석 원문).
  `SetTransform`(`:244,:703`)
- **회수**: 19편(인두세 — 컨트롤러마다 캐시를 들면 곱해짐) · 12·17편(삼각형의 **사람** 꼭짓점)
- **심기**: 우회는 전부 청구서를 남겼다 → 27편 소결
- **SVG 예상**: 6

### 27편 (6.5) — 소결: K8s가 Go에게서 산 것과 낸 것

- **slug(제안)**: `k8s-go-tradeoffs-summary`
- **date**: 2026-07-22 · **tags[0]**: `go`
- **논지**: 우회 4종을 한 표로. **새 수치 도입 없음** — 23~26편 실측을
  **"6부가 직접 잰 숫자들"** 표로 모읍니다(17편·22편이 세운 이 시리즈의 관례이자 차별점).
- **구성**: 표 3~4개 + SVG 4개. 우회 ↔ 대가 대응표, 비용 보존 표의 K8s 판,
  "당신 앱은 K8s가 아니다"(컨트롤 플레인은 한도 밖에서 돌지만 당신 파드는 아님 → 5부로 되돌림)
- **SVG 예상**: 4

**SVG 합계 예상: 28개** (1~5부 실적 편당 4~10과 같은 밀도)

---

## 4. 복선 지도

### 4.1 회수 — 발행글에 실재함을 줄 번호로 확인

거짓 복선을 만들지 않으려고 **전부 grep으로 못 박았습니다.**

| 어디서 | 무엇을 | 어디서 갚나 |
|---|---|---|
| **22편 `:226`** | 6부 계약 원문 — `sync.Pool`·Informer 캐시·Kubelet 동시성·컨테이너 인식 `GOMAXPROCS`, 그리고 **"2편·10편에 심어 둔 것들이 거기서 회수됩니다"** | 23~26편 전부 |
| 10편 `:327` `:329` | "`sync.Pool`로 재사용하면 GC 압력이 준다. **다만 GC 시점에 비워질 수 있다**" | **25편이 victim cache로 해부** |
| 10편 `:435` `:437` | 심화Q — `inuse_space` vs `alloc_space`, 32KB 초과 버퍼의 이중 비용 | 25편 |
| 14편 `:283` | 할당을 줄이는 세 기법 중 `sync.Pool` | 25편 |
| 5편 `:228` `:444` | 이스케이프 분석과 할당 억제 | 25편 |
| 5편 `:487` | **"쿠버네티스가 Go로 쓰인 이유의 절반이 이것"**(빠른 빌드·단일 바이너리) | 23편 서두에서 되받음 |
| 2편 `:163` | "Go 1.24 이하를 K8s에 올렸다면 `automaxprocs`가 정석" | 23편 (**그런데 K8s 자신은 안 씀**) |
| 18편 | `GOMEMLIMIT` 수동 → GC 돌기 전에 OOMKill | 23편 (컨트롤 플레인은 그 선 밖) |
| 19편 | 힙 밖 고정비 = 프로세스당 인두세 | 26편 (컨트롤러마다 캐시 → 곱해짐) |
| 20편 | cgo 사각지대 | 23편 (K8s는 순수 Go라 이 함정이 없음) |

### 4.2 새로 꺼내는 개념 — 발행글 0건, 정의부터 써야 함

grep 결과 발행 22편에 **0건**입니다. 자립성 규칙(§4.1)대로 첫 등장 시 정의부터:

- **Informer · Reflector · DeltaFIFO · Indexer** (client-go 캐시 계층)
- **watch cache · `cachingObject`** (apiserver 쪽)
- **protobuf · CBOR 직렬화**, `application/vnd.kubernetes.protobuf`
- **PLEG**(Pod Lifecycle Event Generator) · **podWorkers**
- **CRD가 protobuf를 못 쓴다**는 사실과 그 귀결

---

## 5. 측정 계획 — 착수 전에 환경을 **미리** 세운다

> 5부의 낭비 재발 방지: 19편 집필 도중 "cgroup이 없네"를 발견해 colima를 그 자리에서 깔았습니다.
> 6부는 **집필 전에 환경을 전부 세워 두고 스모크 테스트까지 끝냅니다.**

### 5.1 환경

| ID | 환경 | 상태 |
|---|---|---|
| **E1** | **kind 클러스터 v1.36.1** (colima 안 도커) — `kind create cluster --name rt6 --image kindest/node:v1.36.1@sha256:3489c767…` | 이 세션에서 구축·검증 |
| **E2** | **K8s 소스 v1.36.1** — `/Users/jun/src/kubernetes` (shallow, 359MB) | ✅ 완료 |
| **E3** | **client-go 벤치 모듈** — `/Users/jun/src/rt6-bench` (블로그 레포 밖). `k8s.io/client-go` v0.36.x로 실제 `corev1.Pod` 타입·protobuf 코덱 사용 | 이 세션에서 구축 |
| **E4** | **Go 1.26.5 GOROOT** — `sync.Pool` 내부(`$(go env GOROOT)/src/sync/pool.go`) | ✅ 있음 |

**소스 버전과 클러스터 버전을 v1.36.1로 일치**시킨 게 핵심입니다.
소스에서 읽은 상수가 실제 도는 바이너리의 것이어야 실측이 근거가 됩니다.

### 5.2 편별 측정 항목

**23편**
- `M23-1` 컨트롤 플레인 5개 프로세스의 Go 런타임 상태 — `go_goroutines`,
  `go_memstats_heap_inuse_bytes`, `go_memstats_stack_inuse_bytes`, `go_gc_duration_seconds`,
  `go_memstats_next_gc_bytes`. apiserver는 `kubectl get --raw /metrics`,
  kubelet은 `/api/v1/nodes/{node}/proxy/metrics`
- `M23-2` **자기 면제** — 스태틱 파드 매니페스트의 `resources`(`limits` 부재 확인) →
  `.status.qosClass` → 노드 안에서 그 파드의 cgroup `memory.max` 실제 값
- `M23-3` `GOMAXPROCS` 실제 값 — `kubectl logs kube-apiserver-… | grep "Golang settings"`
- `M23-4` **부재의 증거** — §2 표(소스 grep 결과)

**24편**
- `M24-1` 파드 수(0 → 30 → 50)에 따른 kubelet `go_goroutines` 기울기
- `M24-2` 같은 구간 `go_memstats_stack_inuse_bytes` → **고루틴당 실효 스택**
- `M24-3` 1:1 스레드였다면의 산술 (계산이지 실측 아님을 본문에 명시)
- `M24-4` PLEG relist 1초의 비용 — 파드 수 대비 kubelet `process_cpu_seconds_total` 기울기
- `M24-5` Evented PLEG의 1.36 feature gate 기본값 (소스 확인)
- ⚠️ 리스크: colima 4C/6G에 110파드는 무리 → pause 이미지로 가볍게, 30~50까지만 재고
  **기울기로 외삽하되 외삽임을 명시**

**25편**
- `M25-1` `sync.Pool` 유/무 벤치 (`-benchmem` + `GODEBUG=gctrace=1`) — allocs/op·GC 횟수·assist
- `M25-2` **victim cache 실증** — Put → `runtime.GC()` 1회(생존) → 2회(소멸)
- `M25-3` **protobuf vs JSON** 디코딩 — 실제 `corev1.Pod`, ns/op·B/op·allocs/op
- `M25-4` 워처 N=1 vs N=50에서 apiserver `go_memstats_mallocs_total` 증가분 → 직렬화가 N배가 아님
- `M25-5` CRD(JSON 경로) vs 코어 리소스(protobuf 경로)의 apiserver CPU·할당 대비

**26편**
- `M26-1` Informer 캐시 메모리 — ConfigMap N개(1KB·10KB)일 때 컨트롤러 힙
- `M26-2` `TransformFunc`로 `managedFields` 제거 전/후 캐시 메모리
- `M26-3` **공유 포인터 실증** — 핸들러 2개가 받은 객체의 `%p` 동일
- `M26-4` **무한 링버퍼 재현** — 느린 핸들러 + 이벤트 폭주 → 힙 폭증
- `M26-5` Informer 없이 폴링했다면의 apiserver 부하 대비

**27편** — 새 측정 없음. 23~26 실측을 "6부가 직접 잰 숫자들" 표로.

### 5.3 미리 확인해 둘 리스크

1. **colima 자원** — 현재 4C/6G(5부 설정). kind + 부하 테스트가 버티는지.
   모자라면 `colima stop && colima start --cpu 6 --memory 10`으로 **선제 조정**
2. **kind 노드의 cgroup 중첩** — 노드 자체가 컨테이너라 파드 cgroup 경로가 한 겹 더 들어감.
   `memory.current`를 볼 때 경로를 미리 찾아 둘 것
3. **apiserver에 `GODEBUG=gctrace=1` 주입** — 스태틱 파드 매니페스트에 env를 추가하면
   kubelet이 감지해 재시작. **실제 apiserver의 gctrace**를 뽑을 수 있는지 이 세션에서 검증
4. **protobuf 코덱이 client-go에서 실제로 붙는지** — E3 모듈에서 확인

---

## 6. 7부 = "만료일" 편 (2026-07-14 사용자 확정)

원안(브리핑 §6)의 7부 "결론 — 의사결정 매트릭스"는 **폐기**합니다.
17편("4부가 직접 잰 숫자들" + 비용 보존 표)과 22편(의사결정 매트릭스 + 네 축)이
이미 두 번 했고, 27편이 또 표를 만들면 **매트릭스 3연타**가 되기 때문입니다.

**새 7부: 시리즈가 세운 모든 트레이드오프에 만료일을 붙이는 단편** (order 28, 1편)

> "이 결론은 언제 무너지는가" — Valhalla JEP 401(값 타입이 Java 할당 지형을 바꾸면
> 3·4부의 전제가 흔들림) · Green Tea GC · Leyden AOT 캐시(21편 웜업 명제) ·
> compact object headers JEP 519→534 · 커널 속 Rust.
> 시리즈를 **미래를 향해** 닫습니다.

**27편에 주는 제약**: 6부만 닫고 **7부로 다리를 놓는 톤**.
시리즈 전체를 마무리하려 들지 말 것. 7부 설계는 27편 발행 후 별도 세션에서.

---

## 7. 작업 절차 (5부와 동일 · draft 정독 단계만 삭제)

편당 한 세션:

1. ~~draft 정독~~ → **이 문서의 해당 편 절 + 소스 재확인**
2. **측정 먼저** (§5.2의 `M##` 항목) — 결과를 이 문서에 append
3. 본문 집필 (`src/content/essays/runtime/{slug}.md`)
4. SVG 작성 (글자 최소화 원칙 — plan.md §4.2)
5. **전 섹션 재감사** (그림 없는 섹션 목록화 → 판단)
6. `npm run lint:post -- <파일>` + `npm run build`
7. plan.md §6 표 갱신 + 커밋

**blog-reviewer는 6부 완결 후 배치 1회** (5부와 동일).

---

## 8. 실측 결과 기록 (집필 세션마다 append)

> 측정한 숫자를 여기 쌓습니다. 27편이 이걸 표로 모읍니다.

### 8.1 환경 검증 완료 (2026-07-14 설계 세션)

**E1 kind 클러스터 — 구축·검증 완료**

```bash
kind create cluster --name rt6 \
  --image kindest/node:v1.36.1@sha256:3489c7674813ba5d8b1a9977baea8a6e553784dab7b84759d1014dbd78f7ebd5
```
- 노드: `rt6-control-plane` · Debian 13 · **커널 6.8.0 (arm64)** · containerd 2.3.1 · cgroup v2
- colima 4C/6G로 **충분함**(현 시점). 부하 테스트에서 모자라면 `colima start --cpu 6 --memory 10`
- 세션 재개 시: `colima start` → 클러스터는 살아 있음. 없으면 위 명령으로 재생성
- ⚠️ `kubectl`·`kind`는 `/opt/homebrew/bin` — 스크립트에서 `PATH` 확인

**E3 벤치 모듈 — 구축·검증 완료**
- `/Users/jun/src/rt6-bench` · `k8s.io/client-go@v0.36.1` (클러스터 v1.36.1과 짝)
- protobuf 코덱 라운드트립 정상 확인 → 25편 벤치 가능

**측정 경로 4종 전부 뚫림** — `M23-1`·`M23-2`·`M23-3`·`M24-1` 모두 이 세션에서 실행 성공

### 8.2 23편 척추 — 이미 측정됨

**자기 면제 (M23-2) — 확정**

| 파드 | resources | QoS | cgroup `memory.max` |
|---|---|---|---|
| `kube-apiserver` | `{"requests":{"cpu":"250m"}}` **한도 없음** | Burstable | **`max`** (무제한) |
| `etcd` | requests.cpu 100m | Burstable | `max` |
| `kube-controller-manager` | requests.cpu 200m | Burstable | `max` |
| `kube-proxy` | **없음** | **BestEffort** | `max` |
| `coredns` (평범한 워크로드) | `limits.memory: 170Mi` | Burstable | **178257920** (=170 MiB) |

- apiserver `memory.current` = 198,500,352 (**189.3 MiB**) — 처형선 없이 그만큼 쓰고 있음
- **18편이 그린 OOMKill 처형선이 컨트롤 플레인에겐 커널 수준에서 안 그어져 있음**
- 이건 kind 특유가 아니라 **kubeadm 표준 스태틱 파드 매니페스트**. 다만 관리형(EKS/GKE)은
  다를 수 있으니 본문에서 "kubeadm 기준"이라고 못 박을 것

**런타임 손잡이 부재 (M23-3·M23-4) — 확정**
```text
I0714 04:31:18.339344  1 server.go:152] "Golang settings" GOGC="" GOMAXPROCS="" GOTRACEBACK=""
```
기본 클러스터에서 **셋 다 빈 문자열**. 코드에도 손잡이가 없고(§2), 운영자도 안 넣었음

**유휴 컨트롤 플레인의 Go 런타임 (M23-1) — 파드 9개 기준선**

| 지표 | kube-apiserver | kubelet |
|---|---|---|
| `go_goroutines` | **2,390** | 251 |
| `go_memstats_stack_inuse_bytes` | 17.4 MiB | 3.78 MiB |
| 고루틴당 실효 스택 | **≈ 7.6 KB** | ≈ 15.8 KB |
| `go_memstats_heap_inuse_bytes` | 169.8 MiB | — |
| `go_memstats_next_gc_bytes` | 178.6 MiB | — |
| `go_gc_duration_seconds{quantile="1"}` | 0.86 ms | — |
| `process_cpu_seconds_total` | — | 4.64 |

- **유휴 apiserver가 고루틴 2,390개** — 24편의 가장 선명한 숫자
- ⚠️ **24편 서술 가드레일**: "1:1 스레드였다면 2,390 × 8MB = 19GB"는 **과장**.
  pthread 기본 스택 8MB는 **가상**이고 지연 커밋됨(8편). 정직한 대비는 이것:
  ① 스레드마다 커널이 `task_struct` + **커널 스택 16KB(상주·스왑 불가)** → 2,390개면
  **커널 메모리만 ≈ 38 MiB**, 이것만으로 Go의 전체 유저 스택(17.4 MiB)을 넘어섬
  ② 가상 주소공간 19GB는 64비트에선 실질 부담이 아님 — 이 점을 숨기지 말 것
  ③ 진짜 비용은 스케줄러 런큐·문맥 전환(1편)

### 8.3 25편 척추 — 미리보기 측정됨

**protobuf vs JSON 디코딩 (M25-3)** — 실제 `corev1.Pod`(컨테이너 2개·라벨 10개), Go 1.26.5

| 코덱 | ns/op | B/op | **allocs/op** | 와이어 크기 |
|---|---|---|---|---|
| protobuf | 1,540 | 4,800 | **40** | 647 B |
| JSON | 10,608 | 5,248 | **79** | 736 B |

- **핵심**: 와이어 크기는 1.14배 차이뿐인데 **디코딩은 6.9배 느리고 할당 횟수가 2배**.
  protobuf의 이득은 "바이트를 아끼는 것"이 아니라 **할당을 아끼는 것** → 14편(Mark Assist)으로 직결
- 이게 **CRD가 apiserver CPU를 태우는 이유**의 물리 (CRD는 protobuf 미지원 → JSON 경로)

**`sync.Pool` victim cache (M25-2) — draft 없이 소스로 찾아낸 발견**

Go 1.26.5 `$(go env GOROOT)/src/sync/pool.go` 정독 결과, `getSlow`가 victim을 뒤질 때
**현재 P의 id로 인덱싱**합니다(`:175~185`) — `victim[pid].private`.
다른 P의 private 슬롯은 훔치지 않습니다(shared 큐만 훔침).

실측:

| 조건 | GC 1회 후 | GC 2회 후 |
|---|---|---|
| `GOMAXPROCS=1` (P 고정) | **생존** (victim으로 강등) | **소멸** |
| `GOMAXPROCS=8` (기본) | **소멸** — Get이 다른 P에서 돌았음 | 소멸 |

- **10편 `:329`("GC 시점에 비워질 수 있다")를 더 정확하게 만듦.** 진실은 두 겹 —
  ① GC가 비운다(수명 2주기) ② **P가 갈리면 애초에 못 찾는다**
- 그리고 그 P별 private 슬롯은 **10편의 mcache와 똑같은 설계**(무락을 위한 P 샤딩).
  25편에서 이 대응을 명시적으로 그릴 것
- ⚠️ 집필 시 데모는 `GOMAXPROCS=1`로 고정해야 재현됨. 기본값이면 결과가 흔들림
