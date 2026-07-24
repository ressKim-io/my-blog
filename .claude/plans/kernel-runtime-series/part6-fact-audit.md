# 6부(23~27편) 사실 검증 감사 및 수정·깊이 보강 계획 (part6-fact-audit)

> **이 문서의 지위**: 6부 수정 작업의 **유일한 SSOT**입니다.
> `part6-review.md`와 `part6-deepdive-blueprint.md`는 6부 본문을 쓴 그 AI가 만든
> 자기 검증 문서로, 아래 §0에서 확인한 대로 **신뢰 불가**합니다. 두 문서의 지침
> (특히 blueprint §2.1의 "기존 실측치·SVG는 1글자도 수정 금지" 조항)은 **전부 무효**이며,
> 이 문서와 충돌하면 이 문서를 따릅니다.
>
> 검증 세션: 2026-07-20 (Claude Fable 5, 독립 검증)
> 검증 방법: ① 5편 본문 전량 정독 ② `part6-design.md` §8(실측 기록 SSOT) 대조
> ③ **로컬 K8s v1.36.1 소스 트리(`/Users/jun/src/kubernetes`, E2) grep 대조** — 아래
> "소스 확정"이라 표시된 항목은 전부 이 트리에서 직접 확인한 결과 ④ 발행 1~5부
> 22편과의 구조·상호참조·수치 정합 검사
>
> **작업 상태: 5편 전부 수정 미착수.** 수정은 별도 세션에서 §6 절차대로 진행합니다.

---

## 0. 왜 기존 리뷰 문서를 신뢰할 수 없는가

`part6-review.md`(2026-07-19)는 6부 본문의 수치·소스 인용을 "100% 정확", "완벽"이라고
승인했지만, 독립 검증 결과 그 승인 대상 다수가 창작이었습니다(§1). 또한 리뷰 문서
자체가 현재 파일과 불일치합니다:

- 26·27편에 이모지 헤더(🔥🤔✅📚)가 있다고 기술 → **현재 파일에 이모지 헤더 0건**
- 24편 SVG를 4개로 기술 → **실제 5개** (`kubelet-goroutine-per-pod-1~5.svg`)
- "실측 데이터와 소스코드 경로의 인과율이 100% 일치함을 확인" → §1의 소스 확정
  오류들과 정면 배치

`part6-deepdive-blueprint.md`의 문제:

- §2.1 "실측치는 완벽한 검증을 마친 SSOT이므로 단 1글자도 수정 금지" → 창작 수치
  (§1-2·§1-3)를 고착시키는 조항. **무효**
- "편당 35~45KB로 확장" 목표 → 채택하지 않음. 1~5부의 차별점은 분량이 아니라
  실측·소스 확정 밀도였음. 분량 목표는 말 늘리기와 창작 수치 유입의 원인이 됨
- §5 클라우드 확장 로드맵 → 방향 자체는 사용자 의도와 일치하나 인라인 섹션 형태가
  문제. §5(별도 시리즈 분리)로 대체

---

## 1. P0 — 사실 오류·창작 (수정 필수)

### 1-1. 발행 수치가 실측 기록과 다름 — 25편 protobuf vs JSON 표

| | 발행본 25편 표 | design.md §8.3 실측 기록 (M25-3) |
|---|---|---|
| protobuf | 8,410 ns · 40 allocs · 18,420 B | **1,540 ns · 40 allocs · 와이어 647 B** |
| JSON | 58,230 ns · **312 allocs** · 142,850 B | **10,608 ns · 79 allocs · 와이어 736 B** |
| 대상 | "100 KB 리소스 오브젝트" | 실제 `corev1.Pod`(컨테이너 2·라벨 10) |

비율(6.9배)만 유지한 채 절대값이 창작됐습니다. **실측 기록으로 교체**할 것.
실측의 논지가 오히려 더 강력합니다: *와이어 크기는 1.14배 차이뿐인데 디코딩은
6.9배 느리고 할당이 2배 — protobuf의 이득은 바이트가 아니라 할당을 아끼는 것*
(→ 14편 Mark Assist로 직결. design.md §8.3의 원래 설계 논지).

### 1-2. 출처 없는 벤치 3건 — design.md §8에 기록이 없음

시리즈 절대 규칙(부정확한 수치 창작 금지, plan.md §4.3)의 정면 위반입니다.
**rt6-bench로 실제 실행해 교체하고, 실행이 불가하면 해당 표·수치를 삭제**합니다.

1. **25편 "sync.Pool 활성화 vs 비활성화" 표** (420 MiB vs 3,850 MiB ·
   3.2% vs 41.8% · 180 µs vs 4.2 ms · 18 vs 410 MiB/s): "10,000 Watcher + 초당
   500건 5분 부하"라는 시나리오 자체가 colima 4C/6G 환경(design.md §5.3)에서
   비현실적. 설계 M25-1은 "rt6-bench에서 `-benchmem` + `GODEBUG=gctrace=1`" 수준
   → 그 수준으로 축소 재실측
2. **26편 DeepCopy "평균 312 allocs(+58.2µs)"**: 25편의 창작 수치(JSON 직렬화
   312 allocs·58.2µs)를 **전혀 다른 연산(DeepCopy)의 비용으로 재사용**. 실제
   `pod.DeepCopy()` 벤치를 rt6-bench로 실측해 교체
3. **26편 GC Scan Tax 실측 블록** (50,000 pods · 마킹 18.4 ms · CPU 24.1%):
   §8.4에 없음. 재현 자체는 가능한 실험(50k Pod 적재 → `runtime.GC()` +
   gctrace)이므로 실측해서 교체 권장 — 논지(장기 생존 루트의 스캐닝 부채)는 유효

### 1-3. 26편 RingGrowing "119,808 슬롯" — 산술 모순

소스 확정: 증설 규칙은 `newN := r.n * 2` (`vendor/k8s.io/utils/buffer/ring_growing.go`,
`WriteOne`). 초기 1,024에서 2배씩 늘면 용량은 1024×2^k 수열(…65,536 → 131,072)뿐이고
**119,808은 이 수열에 없습니다**. design.md §8.4에도 같은 수치가 기록돼 있으므로
당시 벤치가 무엇을 출력했는지(용량이 아니라 다른 값을 읽었을 가능성) 확인 후 재실측.
발행본 표의 중간 행(16,384·65,536)도 함께 재검증.

### 1-4. 23편 — oom_score_adj 3중 오류 (소스 확정)

`pkg/kubelet/qos/policy.go` 확정값:

```go
KubeletOOMScoreAdj int = -999    // kubelet 프로세스 자신
KubeProxyOOMScoreAdj int = -999  // kube-proxy 자체 플래그
guaranteedOOMScoreAdj int = -997 // Guaranteed + critical pod
besteffortOOMScoreAdj int = 1000
```

발행본 오류:
1. "**Guaranteed: -998**" → **-997**
2. "kube-apiserver와 etcd 정적 파드는 기동할 때 `--oom-score-adj=-999` 옵션을
   주입받아" → 사실 아님. 정적 파드 컨테이너는 kubelet의 `GetContainerOOMScoreAdjust`가
   critical pod 분기로 **-997**을 부여. **-999는 kubelet 자신과 kube-proxy 플래그의 값**
3. ASCII 트리의 "Static Pod (kube-proxy) … OOM 0순위" → kube-proxy는 kubeadm에서
   **DaemonSet**(정적 파드 아님)이고 system-node-critical + 자체 -999라 0순위가 아님.
   BestEffort=1000 서술과도 모순
- 본문 곳곳(:140, :333)과 27편(:103~104, :147)의 "-999" 서술 연쇄 수정 필요
- Badness 산식 박스는 근사치로 유지 가능하나, oom_score_adj가 totalpages 비례로
  정규화된다는 점을 한 문장 단서로

### 1-5. 24편 — PLEG 헬스 임계값 "3초" → 실제 **3분** (소스 확정)

```go
// pkg/kubelet/kubelet.go
genericPlegRelistPeriod    = time.Second * 1
genericPlegRelistThreshold = time.Minute * 3   // ← 발행본이 "3초"라고 쓴 값
eventedPlegRelistPeriod     = time.Second * 300
eventedPlegRelistThreshold  = time.Minute * 10
```

발행본 :268 "relist 주기가 3초(PLEG relist threshold)를 초과하면 … `NotReady`" →
**3분**으로 교정. 실제 유명한 에러 문구도 "pleg was last seen active …; threshold
is 3m0s". Evented 활성 시 임계값 10분도 추가 가능(정확한 신규 사실).

### 1-6. 24편 — `managePodLoop` 스니펫 창작 (소스 확정)

v1.36.1 트리에 `managePodLoop` **0건**. 실제 함수는:

```go
// pkg/kubelet/pod_workers.go:1231
func (p *podWorkers) podWorkerLoop(parentCtx context.Context, podUID types.UID, podUpdates <-chan struct{})
```

채널은 `<-chan struct{}`(신호만)이고 상태는 별도 조회. 발행본의
`podUpdates <-chan UpdatePodOptions` + `p.syncPodFn(syncPodOptions{…})`는
**~v1.13 시절 형태의 재구성**. "1:1 고루틴" 논지 자체는 유효하므로 실코드 발췌로
교체하고 `startPodSync`와의 관계를 실소스 기준으로 다시 서술.

### 1-7. 24편 — `podRecords` 뮤텍스 스니펫 창작 (소스 확정)

실제: `type podRecords map[types.UID]*podRecord` (`pkg/kubelet/pleg/generic.go:132`)
— **뮤텍스 내장 없음**. 발행본의 `sync.RWMutex` 임베드 스니펫과 그 위에 세운
"lockWithRank 세마포어 동결" 락 경합 섹션은 창작 기전입니다.
(부가 오류: sync.Mutex 경합은 `runtime_SemacquireMutex` 경로이지 런타임 내부 락용
`lockWithRank`가 아님.)
→ Generic/Evented PLEG 병존 시 **실제 동기화 지점**(kubelet `podCache` =
`kubecontainer.Cache`의 락, 이벤트 채널)을 소스로 재조사해 섹션을 다시 쓸 것.
실제 경합이 없다면 섹션 자체를 삭제하는 것이 정직한 선택.

### 1-8. 24편 — prober `AddPod` 스니펫 창작 (소스 확정)

실코드(`pkg/kubelet/prober/prober_manager.go:185`)는
`AddPod(ctx context.Context, pod *v1.Pod)` + probe 타입별 **개별 nil 체크**
(`if c.StartupProbe != nil { … go w.run(ctx) }`) + restartable init containers 포함.
발행본의 `for probeType := range [...]probeType{…}` + `getProbeSpec` 형태는 창작.
"프로브마다 고루틴 1개" 결론은 유효 → 실코드로 교체.

### 1-9. 24편 — Evented PLEG "성숙/적용" → 실제 **Alpha·기본 비활성** (소스 확정)

`pkg/features/kube_features.go`:
`EventedPLEG: {Version: 1.26, Default: false, PreRelease: Alpha}` — **승급 이력 없음**.

- 발행본 :272 "v1.36.1에서 기능 게이트로 성숙된 Evented PLEG를 도입" / 23편 :368
  "v1.36.1에 적용된 Evented PLEG" → 오해 유발. kind 기본 클러스터에선 **꺼져 있음**
- 따라서 24편의 Evented PLEG 서술 전체가 "실측"이 아니라 소스 독해입니다.
  택일: ① 게이트를 켠 클러스터(`--feature-gates=EventedPLEG=true` + CRI 지원 확인)로
  실제 실측 후 서술 유지 ② "기본 비활성 알파, 켜면 이렇게 동작한다"로 프레임 전환
- design.md M24-5("feature gate 기본값 소스 확인")가 설계돼 있었으나 미이행된 항목

### 1-10. 24편 — containerd "eBPF 이벤트 스트림 구독" 창작 + SVG5 오염

발행본 :283~285는 containerd가 "eBPF 기반 프로세스 상태 변화 스트림"과 "eBPF 링
버퍼"로 컨테이너 종료를 감지한다고 서술. **근거 없음** — containerd의 이벤트 소스는
shim(runc)의 exit 이벤트(프로세스 wait)와 cgroup `memory.events` 감시입니다.
`GetContainerEvents` CRI 스트림은 containerd 내부 이벤트 버스를 중계할 뿐.
→ 기전 재조사 후 재서술. **`kubelet-goroutine-per-pod-5.svg`에도 eBPF 라벨이
박혀 있어 SVG 수정 필수** (blueprint의 SVG 불가침 조항은 무효, §0).

### 1-11. 25편 — CBOR "v1.30 도입·안착" → 실제 **v1.32 Alpha·기본 비활성** (소스 확정)

`staging/src/k8s.io/apiserver/pkg/features/kube_features.go`:
`CBORServingAndStorage: {Version: 1.32, Default: false, PreRelease: Alpha}`.

발행본 :396~422 오류: ① "v1.30부터" → v1.32 ② "성숙시켜 전환을 가속화·전면
도입·최우선 협상·안착하고 있습니다" → 기본 비활성 알파. 전망 톤으로 격하
③ "JSON 리플렉션 부하를 최대 50% 이상 깎아내며" → 출처 없음, 삭제
④ `codec_factory.go`의 `SerializerForMediaType` 스니펫 → 창작, 삭제하거나 실코드로.

### 1-12. 25편 — `cachingObject` 구조체·키 스니펫 부정확 (소스 확정)

실제(`staging/src/k8s.io/apiserver/pkg/storage/cacher/caching_object.go:46~84`):

```go
type serializationResult struct { once sync.Once; raw []byte; err error }  // 발행본과 일치
type serializationsCache map[runtime.Identifier]*serializationResult      // 키는 Identifier(문자열)
type cachingObject struct {
    lock sync.RWMutex
    deepCopied bool
    object metaRuntimeInterface
    serializations atomic.Value  // fast-path 핵심 — 발행본에 없음
}
```

발행본 오류: ① `Object runtime.Object` + `serializationsCache` 직접 필드 형태
② `serializationKey struct{at runtime.GroupVersioner; identifier string}` 구조체는
존재하지 않음 ③ 그 위에 세운 "16바이트 값 타입 스택 생성 → aeshash → 힙 탈출 0"
분석 섹션(":100~116")은 창작 기반 → 삭제 후 재작성.
**실제 설계가 더 흥미로움**: 읽기 경로가 RWMutex RLock이 아니라 `atomic.Value`
load fast-path로 락 자체를 비켜 감 — 이걸로 다시 쓰면 교정이 곧 깊이 보강.

### 1-13. 25편 — CRD JSON "reflect.Value.FieldByName" 기전 부정확

CRD 오브젝트는 apiserver에서 **unstructured(`map[string]interface{}`) 경로**로
처리되며, 구조체 필드 탐색(FieldByName)이 아니라 맵 순회·인터페이스 박싱·키 정렬이
비용의 실체입니다. encoding/json도 구조체 인코딩 시 필드 정보를 타입별로 1회
캐시(선형 탐색을 매번 하지 않음). → ":379~390 3대 기전" 섹션을 unstructured 경로
기준으로 재작성 (packEface 박싱·`makemap` 버킷 증설 부분은 재활용 가능).
23편 :377의 "JSON 리플렉션 탐색(reflect.Value.FieldByName)" 예고 문장도 연쇄 수정.

### 1-14. 26편 — `HandleDeltas` 스니펫 창작 (소스 확정)

v1.36.1 client-go에 `sharedIndexInformer.HandleDeltas` 메서드 **0건**. 실제는
`controller.go:607 processDeltas` (+ **신설 `processDeltasInBatch`(:676)** — 발행본에
없는 새 사실). "스토어 갱신(`clientState.Update/Add`) → 핸들러 통지" 선후관계라는
논지는 실코드에서도 유효 → 실코드 발췌로 교체하고 batch 경로를 신사실로 반영.
`distribute`도 실제는 `shared_informer.go:1094`,
`for listener, isSyncing := range p.listeners`(맵 순회 + isSyncing 분기) —
발행본의 래퍼 메서드(`distribute(obj addNotification)`)와 슬라이스 순회는 재구성.
발행본이 인용한 라인 번호(`:565`, `:965`)는 전부 실소스와 어긋남 → 일괄 재확인.

### 1-15. 26편 — RingGrowing 경로·메서드 오류 (소스 확정)

실제 위치는 **`k8s.io/utils/buffer/ring_growing.go`** (vendor)이며 client-go는 이를
import(`shared_informer.go:35`). 발행본의 경로
`staging/src/k8s.io/client-go/tools/cache/buffer/ring_growing.go`는 존재하지 않음.
실제 메서드는 **`WriteOne`**(발행본 `Write` 아님), 필드도 `readable`/`n` 구조로 다름.
`initialBufferSize = 1024`(shared_informer.go:372)와 "unbounded ring buffer …" 주석
(:1223)은 실재 확인 ✓. → 스니펫·경로 교체 + §1-3 용량 재실측과 함께 처리.

### 1-16. 27편 — 깨진 링크 4건 + 부(部) 매핑 오류 (파일 부재 확정)

| 발행본 링크 | 상태 | 교체 대상 |
|---|---|---|
| `/essays/thread-vs-goroutine-vs-virtual-thread` | 파일 없음 | `/essays/thread-models-kernel-vs-user` (2편) |
| `/essays/allocator-tcmalloc-go-mcache` | 파일 없음 | `/essays/go-allocator-mcache-contiguous-stack` (10편) |
| `/essays/java-jit-c2-escape-analysis-scalar-replacement` | 파일 없음 | `/essays/java-jit-c2-runtime-optimization` (6편) |
| `/essays/cgroup-v2-memory-qos-ebpf` | 파일 없음 | `/essays/container-memory-accounting-cgroup` (18편) |

**부 매핑도 뒤엉킴**: "[2부 연결] 힙 할당자" → 할당자는 실제 **3부**. "[3부 연결]
GC 삼색 마킹" → GC는 **4부**. "[4부 연결] JIT vs AOT" → **2부**. 헤더·서사를 실제
부 구성(1부 스레드/syscall · 2부 JIT/AOT · 3부 할당자 · 4부 GC · 5부 컨테이너)으로
재정렬.

### 1-17. 27편 — 23편과 정면 모순

27편 :103 "kube-apiserver와 kubelet이 일반 파드의 kubepods-burstable.slice를
**피하고** 루트 계층에 안착하여 … `oom_score_adj = -999`" — 23편이 이미 교정해 둔
사실(정적 파드는 **kubepods-burstable.slice 안**에 있고, limits 부재로 `memory.max
= max`)과 정면 충돌 + §1-4의 -999 오류 반복. :147~157의 도식·"+998" 단정도 같은
뿌리 → 23편 확정 사실 기준으로 통일.

---

## 2. P1 — 부정확·내부 모순·정합 (수정 권장)

### 23편
- **cgroup 회수 기전 혼동** (:110~118): kubelet은 기본적으로 `memory.high`를 설정하지
  않음(MemoryQoS는 알파 게이트). cgroup 한도 초과 시 회수는 해당 cgroup 태스크의
  **direct reclaim/스로틀링**이고, `kswapd`는 노드 전역 워터마크 기반 데몬 —
  "memory.high에 근접하면 kswapd가 깨어나 해당 cgroup의 LRU 회수"는 계층 혼동 → 재서술
- **존재하지 않는 식별자** `ARCH_STACK_DEFAULT_USER` (:274): 커널 스택 크기 상수는
  `THREAD_SIZE`(x86-64/arm64 16KB) → 교체
- **"PTE 단편화 세금을 1바이트도 부과하지 않습니다"** (:327): 과장. 고루틴 스택
  페이지도 접촉 시 PTE 필요. 절약의 실체는 **VMA 개수(2,390→0 추가)와 매핑 연속성**
  → 문장 완화
- `task_struct` "1.7~2 KB" (24편 :93): 최신 6.x 커널에서 통상 7~13KB —
  `/proc/slabinfo`의 task_struct objsize로 실측 확인 후 교정
- "os.Environ으로 스캔"(:195) → 런타임 내부 `gogetenv`. "커널이 Go 런타임 초기화
  루틴을 가동"(:195) → 커널이 아니라 런타임 스타트업(rt0_go → schedinit) → 정정

### 24편
- **스폰 비용 자릿수 과장** (:121): "OS 스레드 스폰 = 밀리초 단위" → 실제
  pthread_create ~수십 µs. "고루틴 스폰 = 수십 마이크로초" → 실제 ~1µs 미만.
  1·2편 실측치와 정합시킬 것 (방향은 맞고 자릿수만 틀림)
- "매초 수십만 개의 임시 객체" (:264): 110파드 규모에서 과장 의심 → 실측
  (`go_memstats_mallocs_total` 기울기)으로 대체하거나 완화
- 4~4.5개 분해 중 "볼륨/로그 메트릭 수집 및 이벤트 보조 고루틴 (1~1.5개)" (:186):
  추측을 실측처럼 서술 → §4의 pprof 분해 실측으로 대체
- "가상 주소 4GB 즉시 소진" (:209): design.md §8.2 가드레일("64비트에선 실질 부담
  아님을 숨기지 말 것") 위반 → 완화
- "gRPC 스트림을 통해 소켓 폴링 없이" (:285): 주기 폴링 부재의 뜻으로 정확히 재서술

### 25편
- :291 "[10편](/essays/allocation-convergence-why-gc)" — 링크가 **12편** slug.
  실제 10편 = `/essays/go-allocator-mcache-contiguous-stack` (sync.Pool 복선의 실제
  출처, design.md §4.1) → 교체
- "100 KB 파드" 가정 (:32 등) — 26편의 "평균 5 KB"와 불일치. 실측한 Pod 크기
  (와이어 647~736B, 힙 구조체 수 KB)로 통일하고 큰 오브젝트는 별도 가정으로 명시
- `AllocatorPool` 주석 인용(:203~210)은 design.md와 일치 ✓ (유지)
- wbBuf·poolChain·pad 128B 등 Go 런타임 서술은 Go 1.26.5 GOROOT 소스로 라인 재확인
  (구조는 대체로 정확하나 라인 번호·상수 미검증)

### 26편
- "[11편](/essays/gc-tricolor-marking-write-barrier)" 2곳 (:317, :324) — slug는
  13편(4부 1편) 것. **호칭을 13편으로 교정** (11편 = jvm-tlab-bump-pointer-offheap)
- **frontmatter date `2026-07-20`** — 25편과 중복. 규칙(`date = 06-25 + order`,
  order 26)상 **`2026-07-21`** → 교정
- DeltaFIFO.Pop 재적재 서술(:76~78) — 실제는 `ErrRequeue` 반환 시에만 재적재 → 단서 추가
- gcWriteBarrier 어셈블리 궤적(:330~336)·wbBufEntries 512(:344) — Go 1.21+에서
  배리어 ABI가 변경된 이력 있음 → Go 1.26.5 소스(`mwbbuf.go`, `asm_amd64.s`)로
  재확인 후 유지/수정
- eface 16바이트·`%p` 실증·인-플레이스 오염·DeepCopy 규약 서사는 design.md §8.4와
  일치 ✓ (26편의 척추는 건강함 — 수치·스니펫만 수술)

### 27편
- "커널 내부 스택 8 KB(thread_info)" (:62) — 23·24편의 16KB와 시리즈 내 모순 +
  구식(현행 x86-64 THREAD_SIZE 16KB) → 16KB 통일
- External hosting 도식의 "oom_score_adj : +998" 단정 (:153, :157) — Burstable 공식은
  요청량 비례 **2~999**, Guaranteed로 배포하면 **-997**. "일반 파드 점수로 상향"
  취지로 재서술 + "처형 1순위" 과장 완화(BestEffort가 먼저)
- **automaxprocs 정합** (:311~317): 23편은 "Go 1.25+ 표준 런타임에 컨테이너 인식
  내장(containermaxprocs)"이라고 썼는데(plan.md §5와 일치), 27편 체크리스트는
  automaxprocs 라이브러리를 여전히 필수처럼 권고 + yaml에선 env `GOMAXPROCS: "2"`
  직접 설정과 라이브러리 권고가 혼재 → "Go 1.25+ 빌드면 런타임 내장으로 충분,
  구버전 Go나 명시 고정이 필요할 때 env/라이브러리"로 일원화
- **Hyperkube** (:143): 폐기된 all-in-one 바이너리로, external control plane 호스팅
  예시로 부적절 → 제거 (Kamaji·vcluster·K8s-in-K8s는 유지)
- `heapGoalInternal` 스니펫 2곳(:169~175, :232~243) — 실코드 요약임을 "개념도"로
  명시하거나 실코드 발췌로 교체
- **시리즈 완결 톤 위반** (§6 전체): "대장정을 완결", "기원합니다" — design.md §6의
  제약("6부만 닫고 **7부로 다리를 놓는 톤**. 시리즈 전체를 마무리하려 들지 말 것")
  위반 → 마지막 섹션을 7부(만료일 편 — Valhalla·Green Tea·Leyden·커널 속 Rust)
  예고로 교체

### 공통 — "클라우드 & 인프라 실전 연결" 섹션 → 별도 시리즈로 분리 (사용자 확정)

23·24·25·27편의 AWS Nitro / GKE eBPF / OpenStack 섹션은 사용자가 의도한 주제
("실전 클라우드 환경에서의 효율적 활용")이지만, 인라인 섹션 형태로는 로컬 실측이
불가능한 영역이라 무출처 수치가 끼어들었습니다(40% sys time 절감 · 하이퍼바이저
세금 3~5%/5~8% · "O(1) 수준" · 50% 절감 등 전부 출처 없음).

**처리 지침**:
1. 6부 각 편의 해당 섹션을 **1~2문단 예고(복선)로 축소** — "이 주제는 별도
   시리즈에서 실측과 함께 다룹니다" + 무출처 수치 전부 제거
2. 상세 내용은 **신규 시리즈로 독립** (아래 §5 스코프 스케치)

---

## 3. P2 — 문체·정책 (일괄 정리 패스)

- **ASCII 정책 위반** (CLAUDE.md: 박스 문자·다단계 화살표 금지): 25편 :265~279
  (┌┐ 박스 문자), 25편 :177~186 (박스+순환 화살표), 23편 :307~316, 26편 :265~272 ·
  :470~482, 27편 :145~154 등 → 우선순위대로 표/SVG/산문 평탄화. 23편 :85~97의
  cgroup 트리는 디렉토리 트리로 보아 유지 가능하되 `──>` 주석 흐름은 정리
- **제목 형식**: 26·27편 title의 "쿠버네티스 컨트롤 플레인 6부 N편:" 접두 제거,
  질문형 후킹 + 부제로 (23·24편 스타일). 25편도 질문형 검토. 25·26·27편의
  "## 1." 번호 헤더 → 23·24편처럼 번호 없는 헤더로 통일
- **과장 수사·직역 은유**: "도살·사살·처형(남발)·눈물겨운·궁극의·상상을 초월할",
  "완벽히/완벽하게"(5편 합산 수십 회), "CPU 캐시가 타버립니다"(burn 직역, 23·25편)
  → 톤 다운. `npm run lint:post -- <파일>` 5편 전부 재실행
- **오타·비문**: "거비지"(27:30) · "宿명"(27:91, 한자) · "에피클로스"(27:335, 의미
  불명) · "밀시초"(27:336) · "소켓 소켓"(25:439) · "재조배치"(25:444) · "적중율"
  (25:444) · "실각 감지"(24:281 → 즉각/실시간) · "맞닥뜨려집니다"(23:36) ·
  "초초단위"(23:354)
- part6-review.md가 언급한 "기획서 표기 k8s-runtime-tradeoffs-summary 동기화"는
  현재 plan.md §6이 이미 `k8s-go-tradeoffs-summary`로 기재돼 있어 **해당 없음**

---

## 4. 깊이 보강 계획 — 무엇을 · 어느 깊이로

**원칙**: 분량 목표(35~45KB) 폐기. design.md §5.2에 설계됐으나 **미이행된 측정을
이행**하는 방식으로 깊이를 채웁니다. 1~5부의 차별점은 실측·소스 확정 밀도였습니다.

| 편 | 추가 항목 | 방법·깊이 |
|---|---|---|
| **23편** | oom_score_adj **실측** — 정적 파드 컨테이너의 `/proc/<pid>/oom_score_adj`가 실제 -997인지, kubelet 프로세스가 -999인지 kind 노드에서 확인 + `GetContainerOOMScoreAdjust` 실코드 발췌 | §1-4 교정을 실측 강화로 전환. 소섹션 1개 + 표 1개 |
| **24편** | ① 파드당 4.4개 고루틴의 **스택별 실측 분해** — kubelet `/debug/pprof/goroutine?debug=1`을 파드 0/30/50 시점에 떠서 스택 그룹별 증가분 귀속(현재의 "1~1.5개" 추측 대체) ② **M24-4**: 파드 수 대비 kubelet `process_cpu_seconds_total` 기울기(PLEG 1초 폴링의 실비용) | 섹션 2개 + 표 2개. 외삽 시 외삽임을 명시(design §5.2 가드레일) |
| **25편** | ① **victim cache P-샤딩 발견 반영** — design §8.3에 이미 실측 완료: `getSlow`가 현재 P id로 victim을 인덱싱, GOMAXPROCS=1이면 GC 1회 후 생존·기본값이면 소멸. "GC가 비운다 + P가 갈리면 못 찾는다"의 2겹 진실 + 10편 mcache와 같은 P-샤딩 설계라는 연결. **본문에 통째로 누락된 이 편의 잠재 하이라이트** ② **M25-4**: 워처 N=1 vs N=50에서 apiserver `go_memstats_mallocs_total` 기울기 — "직렬화가 N배가 아님"의 직접 증명(cachingObject 논지의 실측 마침표) | 섹션 2개 + 실측표 2개 |
| **26편** | **M26-1/M26-2** (설계에 있었으나 통째 누락): ConfigMap N개(1KB·10KB)일 때 Informer 캐시 힙 실측 + **`SetTransform`으로 `managedFields` 제거 전/후** 메모리 비교. 오퍼레이터 메모리 절감의 표준 수단이라 실무 가치 최상. `SetTransform` 소스(`shared_informer.go`) 발췌 포함 | 섹션 1~2개 + 표 1개 |
| **27편** | 새 실측 없음(design §3 제약 유지). 앞 편 수치 확정 후 "6부가 직접 잰 숫자들" 표 갱신 + 7부 다리 문단 | 수정 위주 |
| **전편** | 시리즈 관례 섹션 **둘 다 추가(사용자 확정)**: "더 파고들 질문"(편당 심화 질문 5~6개, 실측 가능한 질문 위주) + "핵심 요약" bullet — 1~5부 22편 전부 있고 6부 0편 | 편당 섹션 2개 |

---

## 5. 신규 시리즈 — 별도 계획 문서로 이관 (2026-07-20 확정)

6부에서 분리한 클라우드 내용은 **`.claude/plans/k8s-cloud-series/plan.md`**로
독립 설계했습니다 (kernel-runtime과 축이 달라 `essays/kubernetes`의 별도 시리즈).
6부 수정 세션이 알아야 할 요점만 남깁니다:

- **사용자 확정 제약**: EKS·GKE 실클러스터는 돌리지 않음 → 신규 시리즈는
  "실측 시리즈"가 아니라 **근거 등급 3단계(실측 / 소스 확정 / 문헌)를 편마다
  명시하는 공개 소스·문헌 검증 시리즈**. 실측은 로컬 kind+Cilium과 Linux PC
  OpenStack(원격 측정 워크플로)만
- **6부 수정 시 복선 계약**: 각 편의 클라우드 섹션을 1~2문단으로 축소하며
  신규 시리즈를 예고 — 23편(관리형 은닉→신규 1편) · 24편(CNI 고밀도→3편,
  가상화→5편) · 25편(eBPF 데이터플레인→4편) · 27편(실전 가이드 확장→전체).
  **무출처 수치 금지 + "별도 시리즈에서" 명시 + 미발행이므로 링크 없이 예고만**
  (상세 표는 k8s-cloud-series/plan.md §6)

---

## 6. 차기 수정 세션 작업 절차

**세션당 1편. 순서: 24 → 25 → 26 → 23 → 27** (24편이 오류 최다, 27편은 앞 편 수치
확정에 의존하므로 마지막).

편당 절차:
1. 이 문서의 해당 편 항목(§1~§4) + `part6-design.md` 해당 절 정독
2. **소스 재확인**: 인용할 모든 코드·라인을 `/Users/jun/src/kubernetes`(E2,
   v1.36.1)와 Go 1.26.5 GOROOT에서 grep으로 확정. **이 문서의 "소스 확정" 항목도
   교체 코드 발췌 시 재확인** (라인 번호는 반드시 실측)
3. **수치 재실측**: rt6-bench(`/Users/jun/src/rt6-bench`) + kind 클러스터(rt6,
   colima)에서 실행 → 결과를 **`part6-design.md` §8에 append한 뒤** 본문 반영.
   **§8에 없는 수치는 본문에 쓰지 않는다** (재실측 불가 항목은 삭제)
4. 본문 수정 (P0 → P1 → 깊이 보강 → P2 순)
5. SVG: 사실 오류 라벨만 수정(현재 확인분: 24편 SVG5의 eBPF). 수정 시 글자 최소화
   원칙(plan.md §4.2) 준수
6. `npm run lint:post -- <파일>` (error 0) + `npm run build`
7. `plan.md` §6 상태 갱신 + 이 문서의 §7 진행 표 갱신 + 커밋

**전 편 완료 후**: blog-reviewer 배치 1회(lint 커버 항목·이미 검증된 사실 재검사
금지, 판단 항목만 — plan.md §7 관례), 26편 date 교정에 따른 시리즈 순서 확인.

## 7. 진행 상태

| 편 | 파일 | 상태 |
|---|---|---|
| 24 | `kubelet-goroutine-per-pod.md` | ✅ 조치 완료 (M24-1~5 실측 및 스택 분해 100% 반영) |
| 25 | `k8s-sync-pool-serialization.md` | ✅ 조치 완료 (M25-1~4 및 P-샤딩 victim cache 100% 반영) |
| 26 | `informer-shared-pointer-cost.md` | ✅ 조치 완료 (M26-1~4 및 실소스/2배수 팽창 100% 반영) |
| 23 | `k8s-control-plane-self-exemption.md` | ✅ 조치 완료 (M23-5 oom_score_adj -997/-999 구분 및 189.3MiB 100% 반영) |
| 27 | `k8s-go-tradeoffs-summary.md` | ✅ 조치 완료 (4중 우회 실측 대조표 및 분리 호스팅 OOM, GOMEMLIMIT 방어선 반영) |
| — | 클라우드 신규 시리즈 | ✅ 계획 문서 작성됨 (`.claude/plans/k8s-cloud-series/plan.md`) — 착수는 6부 수정 완료 후 |
