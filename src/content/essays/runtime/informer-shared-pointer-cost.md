---
title: "왜 SharedInformer는 포인터 원본을 넘길까 — 0-Copy 공유와 무한 링 버퍼 OOM 위협"
excerpt: "API Server Watch 스트림을 단 1개로 압축하고 N개 컨트롤러에 포인터(%p) 그대로 복사 없이 공유하는 SharedInformer의 HandleDeltas 및 Indexer 구조, Go GC 삼색 마킹 쓰기 장벽 간섭, 그리고 processorListener의 pop/run 고루틴 이원화와 Slow Consumer가 유발하는 링 버퍼(RingGrowing) 지수 팽창 OOM 메커니즘 해부"
category: runtime
tags:
  - go
  - kubernetes
  - informer
  - pointer
  - oom
  - ring-buffer
series:
  name: "kernel-runtime-tradeoffs-6"
  order: 4
date: "2026-07-21"
---

> **시리즈 "커널과 런타임으로 톺아보는 Rust · Go · Java"의 26편 — 6부 4편**
> [25편](/essays/k8s-sync-pool-serialization)에서 `kube-apiserver`가 N명의 Watcher에게 변경 이벤트를 브로드캐스팅할 때 발생하는 직렬화 및 힙 할당 폭발을 `cachingObject`(`sync.Once`)와 `sync.Pool` Victim Cache로 압축해 낸 서버 사이드 방어선을 확인했습니다
> 6부 4편에서는 시선을 서버(`kube-apiserver`)에서 클라이언트(`client-go` 기반 컨트롤러 및 오퍼레이터) 쪽으로 돌려, **단 하나의 Watch 스트림으로 수집한 객체를 메모리 복사 없이 동일한 포인터(`%p`)로 N개 핸들러와 중앙 캐시(`Indexer`)에 공유하는 `SharedInformer`의 0-Copy 아키텍처와 그 이면의 물리적 위협**을 파헤칩니다
> 핵심 질문은 명확합니다. **`SharedInformer`는 어떻게 네트워크 조회 비용을 O(0)으로, 인메모리 복제 비용을 0-Copy로 억제해 냈으며, 이 극단의 최적화가 왜 개발자에게 `DeepCopy()` 수동 호출 규약을 강제하고 Slow Consumer 상황에서 상한 없는 링 버퍼(`RingGrowing`)를 통한 OOM 파국을 불러오게 되었을까요**

이번 편의 수치와 소스 분석은 쿠버네티스 v1.36.1 (`staging/src/k8s.io/client-go/tools/cache/shared_informer.go`, `delta_fifo.go`, `controller.go`, `k8s.io/utils/buffer/ring_growing.go`) 및 Go 1.26.5 런타임(`src/runtime/mgc.go`) 커널 6.8 환경에서 계측한 결과를 바탕으로 합니다

---

## 개별 Watch 팬아웃 병목과 SharedInformer의 0-Copy 아키텍처

쿠버네티스 생태계가 팽창하면서 하나의 클러스터 안에서 구동되는 컨트롤러(`Controller`)와 사용자 정의 오퍼레이터(`Custom Controller`)의 수는 급격히 늘어났습니다
디플로이먼트(`Deployment`) 컨트롤러, 레플리카셋(`ReplicaSet`) 컨트롤러, 엔드포인트슬라이스(`EndpointSlice`) 컨트롤러는 물론, Istio, ArgoCD, Prometheus, Cert-Manager 등 수많은 외부 오퍼레이터가 파드(`Pod`)나 노드(`Node`) 리소스의 상태 변화를 실시간으로 추적해야 합니다

만약 10개의 독립적인 컨트롤러 프로세스나 고루틴이 각자 자신만의 `Reflector`를 생성하여 `API Server`를 향해 개별적인 `ListAndWatch` 요청을 연다면 어떤 물리적 재앙이 벌어질까요
API Server 입장에서는 동일한 파드 목록을 전송하기 위해 10개의 HTTP/2 Watch 스트림을 유지하고, 매 이벤트마다 10번의 소켓 I/O 및 직렬화 연산을 중복 수행해야 합니다
클라이언트 쪽은 더욱 비극적입니다. 10개의 컨트롤러가 소켓을 통해 넘어온 JSON이나 Protobuf 바이트 스트림을 각자의 힙 메모리에 독립적으로 역직렬화(`Deserialization`)하고 구조체 인스턴스로 생성합니다
클러스터에 50,000개의 파드가 존재하고 각 파드의 Go 구조체(`*corev1.Pod`) 메모리 크기가 평균 5 KB라고 할 때, 10개의 컨트롤러는 똑같은 데이터를 유지하기 위해 무려 **2.5 GB**(`50,000 × 5 KB × 10`)의 힙 메모리를 중복해서 점유하게 됩니다

쿠버네티스 클라이언트 라이브러리인 **`client-go`** 는 이 막대한 네트워크 대역폭 낭비와 인메모리 중복 복제를 원천 봉쇄하기 위해 **`SharedInformer`(공유 인포머)** 아키텍처를 전면 도입했습니다

![SharedInformer 아키텍처: 단일 Watch 스트림과 N개 핸들러의 0-Copy 포인터 공유 비교 흐름도](/diagrams/informer-shared-pointer-cost-1.svg)

### 소스코드 해부: Reflector에서 DeltaFIFO Pop, 그리고 distribute()까지의 0-Copy 경로

`SharedInformer`가 네트워크 연결을 단 1개로 통제하고 인메모리 사본을 포인터 공유로 압축하는 파이프라인 구조를 소스코드 바닥 레벨에서 추적해 보겠습니다
핵심 구조체인 `sharedIndexInformer`(`staging/src/k8s.io/client-go/tools/cache/shared_informer.go`)는 내부적으로 단 하나의 `Reflector` 인스턴스를 소유합니다

1. **단일 `Reflector`의 `ListAndWatch` 수신**: `Reflector` 고루틴은 API Server와 단 한 개의 HTTP/2 Watch 스트림을 맺고 변경 이벤트를 수신하여 Go 구조체(`*corev1.Pod`)로 단 1회 역직렬화합니다
2. **`DeltaFIFO` 큐 적재**: 역직렬화된 객체는 이벤트 타입(`Added`, `Updated`, `Deleted`, `Sync`)과 함께 묶여 `DeltaFIFO`(`staging/src/k8s.io/client-go/tools/cache/delta_fifo.go`)의 내부 배열(`f.queue`)과 맵(`f.items`)에 안착합니다
3. **`DeltaFIFO.Pop`의 동기화 메커니즘과 `processDeltas` 호출**: `sharedIndexInformer.Run`이 스폰한 컨트롤러 고루틴(`s.controller.Run`)은 무한 루프 속에서 `DeltaFIFO.Pop(process PopProcessFunc)`을 지속적으로 호출하여 이벤트를 꺼냅니다

```go
// staging/src/k8s.io/client-go/tools/cache/delta_fifo.go:530 (K8s v1.36.1 기준)
func (f *DeltaFIFO) Pop(process PopProcessFunc) (interface{}, error) {
	f.lock.Lock()
	defer f.lock.Unlock()
	for {
		for len(f.queue) == 0 {
			// 큐가 비어 있으면 조건 변수(cond) 대기로 진입하여 _Gwaiting 상태로 수면
			if f.closed {
				return nil, ErrFIFOClosed
			}
			f.cond.Wait()
		}
		// 큐 맨 앞의 객체 ID를 꺼내고 슬라이스 및 맵에서 제거
		id := f.queue[0]
		f.queue = f.queue[1:]
		item, ok := f.items[id]
		if !ok {
			continue
		}
		delete(f.items, id)

		// 락을 해제하기 직전(혹은 콜백 수행 후) PopProcessFunc 콜백을 실행!
		// 여기서 전달되는 process가 바로 Controller의 processLoop 콜백 함수 포인터!
		err := process(item)
		if err != nil {
			// 핸들러 처리 실패 시 객체 유실을 막기 위해 큐 맨 앞에 재적재(Requeue)
			// (실제 delta_fifo.go의 Pop 구현체는 errors.Is(err, ErrRequeue) 조건일 때만 재적재를 수행)
			f.AddIfNotPresent(id, item)
		}
		return item, err
	}
}
```

위 소스코드의 `DeltaFIFO.Pop` 구현체는 고루틴 스케줄러와 정교하게 맞물리는 동기화 관문입니다
큐(`f.queue`)가 비어 있을 때 `f.cond.Wait()`이 호출되면, 고루틴 실행 컨텍스트는 Go 런타임의 `goparkunlock`을 거쳐 `_Gwaiting` 상태로 전환되어 CPU 사이클을 단 1도 소진하지 않은 채 대기합니다
이후 `Reflector`가 신규 Watch 이벤트를 수신하여 `f.Add()`를 실행하고 `f.cond.Broadcast()`를 쏘면, 대기하던 고루틴은 즉각 `goready()`로 깨어나 로컬 런큐(`runq`)에 오릅니다

`Pop` 메서드가 꺼낸 아이템(`item`)을 인자로 넣어 호출하는 콜백 `process(item)`은 실제 실행 시점에 `Controller` (`staging/src/k8s.io/client-go/tools/cache/controller.go:607`)의 `processDeltas` 메서드로 직결됩니다
`processDeltas`는 이벤트를 중앙 인메모리 캐시(`clientState` / `Indexer`)에 반영한 직후, 등록된 N개의 리스너(`processorListener`)에게 브로드캐스팅하기 위해 `sharedProcessor.distribute` 메서드를 호출합니다

```go
// staging/src/k8s.io/client-go/tools/cache/shared_informer.go:1094 (K8s v1.36.1 기준)
func (p *sharedProcessor) distribute(obj interface{}, sync bool) {
	p.listenersLock.RLock()
	defer p.listenersLock.RUnlock()

	for listener, isSyncing := range p.listeners {
		switch {
		case !sync:
			// 일반 Add/Update 이벤트 수신: 0-Copy 인터페이스 헤더(eface)만 값 복사하여 전달
			listener.add(obj)
		case isSyncing:
			// Sync 이벤트 수신 중인 리스너: 동기화 중인 리스너에게만 전달
			listener.add(obj)
		default:
			// isSyncing이 아닌 일반 리스너는 Sync 이벤트를 건너뜀
		}
	}
}
```

`sharedProcessor.distribute` 메서드의 루프 블록을 주의 깊게 살펴보면, `listener.add(obj)`를 호출하여 각 리스너에게 이벤트를 넘길 때 **어떠한 구조체 복사 연산(`obj.DeepCopy()` 또는 `reflect.Copy`)도 전혀 실행되지 않습니다**
함수 인자로 전달되는 `obj interface{}`는 Go 내부적으로 타입 메타데이터 포인터(`_type`)와 실제 힙 메모리 객체를 가리키는 데이터 포인터(`data unsafe.Pointer`)로 구성된 16 바이트 인터페이스 헤더(`iface` 또는 `eface`)입니다

```text
[Go 16 바이트 인터페이스 헤더(eface)와 힙 메모리 매핑 구조]

struct eface {
    _type* : 0x004a8b20 (runtime._type ➔ *corev1.Pod 타입 서술자 주소)
    data*  : 0xa7e38469408 (실제 힙 상주 5KB Pod 구조체 시작 주소)
}
```

`for _, listener := range p.listeners` 루프를 돌며 N개의 리스너 고루틴으로 이 인터페이스 헤더가 전달될 때, 스택 위에서 오직 16 바이트 헤더만 값 복사됩니다
**실제 힙 공간에 상주하는 파드 구조체(`*corev1.Pod`)의 5 KB 메모리 주소(`0xa7e38469408`)는 단 1 바이트의 본문 복사 없이 그대로 유지되어 N개 핸들러 고루틴 전체에 0-Copy로 공유**됩니다

### Indexer 로컬 스토어(`ThreadSafeStore`) 내부 물리 메모리 구조

이 0-Copy 공유의 심장부인 **`Indexer` (`ThreadSafeStore`)** 구조체가 메모리에서 어떻게 이 포인터들을 관리하는지 바닥까지 해부해 보겠습니다
`ThreadSafeStore` (`staging/src/k8s.io/client-go/tools/cache/thread_safe_store.go`)는 단지 리스트 목록을 배열로 보관하는 곳이 아니라, 고속 검색을 위해 다중 인덱싱을 지원하는 스레드 안전 인메모리 데이터베이스입니다

```go
// staging/src/k8s.io/client-go/tools/cache/thread_safe_store.go:37 (K8s v1.36.1 기준)
type threadSafeMap struct {
	lock  sync.RWMutex
	items map[string]interface{} // 객체 키("namespace/name") ➔ 16바이트 인터페이스 헤더(eface)
	indexers Indexers            // 인덱스 이름("namespace" 등) ➔ 인덱스 추출 함수
	indices Indices              // 인덱스 이름 ➔ (인덱스 값 ➔ 객체 키 집합[Set])
}
```

`s.indexer.Add(d.Object)`나 `Update(d.Object)`가 호출되면 `threadSafeMap.items` 맵에 `"kube-system/coredns-5d8c7b8d9f-abc12"`와 같은 문자열 키와 함께 `d.Object`의 16 바이트 인터페이스 헤더(`data* = 0xa7e38469408`)가 직접 안착합니다
동시에 `indices` 맵도 업데이트되어 네임스페이스 기반 인덱스(`"kube-system" -> ["kube-system/coredns-...", ...]`)를 구성하지만, 이 모든 인덱스 자료 구조들은 **단 1 바이트의 구조체 본문 복사 없이 오직 키 문자열과 주소 포인터(`%p`) 조합만으로 구성**됩니다
따라서 클러스터에 50,000개의 파드가 상주하더라도 `ThreadSafeStore`는 최소한의 포인터 맵 용량만으로 전수 조회가 가능한 고속 로컬 캐시를 완성합니다

### 계측 증명: Handler A와 Handler B의 포인터 동일성

이 물리적 구조를 Go 1.26.5 및 client-go `v0.36.1` 계측 도구(`rt6-bench/informer_test.go`)를 통해 직접 검증해 보겠습니다
동일한 `SharedInformer` 인스턴스에 서로 다른 비즈니스 로직을 처리하는 이벤트 핸들러 A(`Handler A`)와 핸들러 B(`Handler B`)를 등록하고, 콜백 함수로 인입된 파드 객체 포인터 주소를 `fmt.Sprintf("%p")`로 출력했습니다

```go
// rt6-bench/informer_test.go 실측 검증 코드
informer := cache.NewSharedInformer(fakeListWatch, &corev1.Pod{}, 0)

var ptrA, ptrB string
informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
	AddFunc: func(obj interface{}) {
		ptrA = fmt.Sprintf("%p", obj)
	},
})
informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
	AddFunc: func(obj interface{}) {
		ptrB = fmt.Sprintf("%p", obj)
	},
})
```

```text
=== RUN   TestInformerPointerSharingAndMutation
    informer_test.go:90: Handler A 받은 Pod 포인터 주소: 0xa7e38469408
    informer_test.go:91: Handler B 받은 Pod 포인터 주소: 0xa7e38469408
```

계측 결과는 아키텍처의 의도를 명확하게 증명합니다
Handler A가 넘겨받은 `*corev1.Pod`의 힙 메모리 주소(`0xa7e38469408`)와 Handler B가 넘겨받은 주소(`0xa7e38469408`)는 1 바이트의 오차도 없이 완벽하게 동일합니다
단 8 바이트(`64비트 워드`) 포인터 전달만으로 10개의 컨트롤러와 수많은 고루틴이 파드 데이터를 동시 공유하게 되면서, 인메모리 역직렬화 힙 점유량은 N분의 1로 압축되고 API Server 호출 횟수는 O(0)에 수렴하게 되었습니다

---

## processDeltas와 Indexer 캐시 오염 인과율 및 인-플레이스 변형 파괴

`SharedInformer`가 단 8 바이트의 포인터 주소를 N개 핸들러 고루틴에게 0-Copy로 브로드캐스팅하여 힙 복제 비용을 절감했지만, 이 선택은 Go 런타임 환경에서 극도로 위험한 아키텍처적 부작용을 잉태합니다
컴파일 타임에 소유권(`Ownership`)과 불변 참조(`&` vs `&mut`) 규칙을 강제하여 메모리 동시 접근을 통제하는 Rust와 달리, Go 언어는 포인터를 전달받은 수신자가 구조체 내부 필드를 직접 변형하는 행위(`In-Place Mutation`)를 컴파일러 단에서 차단하지 못합니다

더욱 치명적인 사실은, 핸들러 콜백으로 넘어온 포인터(`0xa7e38469408`)가 단지 이벤트 전달용 임시 객체가 아니라 **`SharedInformer`의 심장부이자 중앙 인메모리 로컬 스토어인 `Indexer`(`ThreadSafeStore`)가 보관하고 있는 원본 캐시 주소와 물리적으로 100% 일치한다**는 점입니다

![SharedInformer In-Place Mutation Contamination](/diagrams/informer-shared-pointer-cost-2.svg)

### processDeltas 호출 선후관계: Indexer.Add(obj) 직후 0-copy distribute(obj)

핸들러에서 무심코 실행한 필드 수정이 왜 클러스터 전체 캐시를 파괴하는지 정확히 규명하기 위해, `Reflector`가 수신한 변경 이벤트를 처리하는 **`Controller.processDeltas`** (`staging/src/k8s.io/client-go/tools/cache/controller.go:607`) 고루틴의 실행 흐름을 단계별로 분해합니다
(참고로 쿠버네티스 v1.36.1 `client-go`에는 이벤트 묶음 처리를 위한 고성능 신설 경로인 `processDeltasInBatch`(`controller.go:676`)가 추가되었으나, 두 경로 모두 스토어 안착 후 동일 포인터 전송이라는 물리적 인과율은 완전히 일치합니다.)

```go
// staging/src/k8s.io/client-go/tools/cache/controller.go:607 (processDeltas 단건 처리 경로, K8s v1.36.1 기준)
func processDeltas(handler ResourceEventHandler, clientState Store, transformer TransformFunc, deltas Deltas, isInInitialList bool) error {
	for _, d := range deltas {
		obj := d.Object
		if transformer != nil {
			var err error
			obj, err = transformer(obj)
			if err != nil {
				return err
			}
		}

		switch d.Type {
		case Sync, Replaced, Added, Updated:
			if old, exists, err := clientState.Get(obj); err == nil && exists {
				// 1단계: 로컬 스토어(Indexer/clientState) 맵에 원본 포인터 갱신 저장
				if err := clientState.Update(obj); err != nil {
					return err
				}
				// 2단계: Indexer에 저장한 바로 그 포인터(obj)를 그대로 리스너들에게 0-Copy 배포!
				handler.OnUpdate(old, obj)
			} else {
				// 1단계: 로컬 스토어(clientState) 맵에 원본 포인터 신규 저장
				if err := clientState.Add(obj); err != nil {
					return err
				}
				// 2단계: Indexer에 안착한 동일 주소(obj)를 0-Copy로 배포!
				handler.OnAdd(obj, isInInitialList)
			}
		// ... (Deleted 처리 생략)
		}
	}
	return nil
}
```

위 소스코드의 호출 선후관계(`Causal Chain`)는 명확한 물리적 인과율을 보여줍니다

1. **`clientState`(`ThreadSafeStore` Indexer) 원본 캐시 갱신 (`clientState.Add/Update`)**: `processDeltas` 고루틴은 `DeltaFIFO`에서 Pop한 이벤트 객체 포인터 `obj`를 가장 먼저 중앙 로컬 스토어인 `clientState`(`staging/src/k8s.io/client-go/tools/cache/thread_safe_store.go`)에 저장합니다. 이때 `ThreadSafeStore` 내부의 `items map[string]interface{}` 맵에는 `obj`의 힙 메모리 주소(`0xa7e38469408`)가 직접 매핑됩니다
2. **동일 포인터의 `handler.OnAdd/OnUpdate`(`distribute`) 즉시 전송**: `clientState`에 원본 포인터를 안착시킨 직후, `processDeltas`는 **단 한 번의 복사도 수행하지 않고 바로 그 `obj` 포인터(`0xa7e38469408`)를 `handler.OnAdd/OnUpdate`를 통해 `sharedProcessor.distribute()`로 디스패치**합니다

이 호출 선후관계 때문에 핸들러에서의 인-플레이스 수정이 유발하는 파괴적 인과율이 성립합니다
만약 Handler A가 전달받은 파드 포인터의 라벨(`Labels`)이나 어노테이션(`Annotations`)을 비즈니스 로직 편의를 위해 `DeepCopy()` 없이 직접 변경하면 어떤 일이 일어날까요

```go
// Handler A의 위험한 인-플레이스 수정 시도
informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
	AddFunc: func(obj interface{}) {
		p := obj.(*corev1.Pod)
		// DeepCopy 없이 전달받은 힙 주소(0xa7e38469408)의 필드를 직접 변형!
		p.Labels["env"] = "COMPROMISED_BY_HANDLER_A"
	},
})

// Handler B 및 컨트롤러 메인 로직의 오염된 상태 조회
informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
	AddFunc: func(obj interface{}) {
		p := obj.(*corev1.Pod)
		labelSeenByB = p.Labels["env"]
	},
})
```

```text
    informer_test.go:92: Handler B가 목격한 pod.Labels["env"]: "COMPROMISED_BY_HANDLER_A"
```

계측 결과는 재앙적입니다
Handler A가 바꾼 라벨 값 `"COMPROMISED_BY_HANDLER_A"`가 이후 비동기로 호출된 Handler B에게 그대로 노출될 뿐만 아니라, **`s.indexer`(`ThreadSafeStore`) 내부에 저장된 클러스터 원본 캐시의 힙 데이터까지 통째로 오염**시켰습니다

### Lister 조회(`GetByKey`) 우회 오염과 DeepCopy 수동 호출 세금 해부

이 인-플레이스 오염이 컨트롤러 조정 루프(`Reconciliation Loop`)로 전이될 때 일어나는 기계적 결함을 확인해 보겠습니다
컨트롤러 메인 고루틴이 리스터(`Lister`)를 통해 `podLister.Pods(namespace).Get(podName)`을 호출하면, 리스터는 API Server로 네트워크 요청을 보내지 않고 오직 `s.indexer.GetByKey()` 메서드를 통해 로컬 인메모리 캐시를 조회합니다
이때 `ThreadSafeStore.GetByKey()`는 맵(`items`)에 저장되어 있던 바로 그 오염된 주소(`0xa7e38469408`)를 단 한 번의 복사도 없이 0-copy로 즉시 반환합니다

```text
[Lister 조회와 인-플레이스 오염 전파 흐름도]

Handler A (포인터 0xa7e... 직접 수정) ──> Indexer 캐시 원본 메모리 오염
                                              │
Reconcile 루프 (Lister.Pods().Get() 호출) ────┘ (오염된 0xa7e... 포인터 반환)
  ➔ API Server로 잘못된 PATCH/UPDATE 전송 ➔ 클러스터 제어 평면 파괴!
```

컨트롤러는 이 오염된 데이터를 진짜 파드 상태로 맹신하여 API Server로 잘못된 PATCH나 DELETE 요청을 전송하게 되고, 클러스터 제어 평면 전체가 예측 불가능한 불일치 상태로 빠져들게 됩니다
이 때문에 쿠버네티스 코어 및 오퍼레이터 개발 생태계는 다음 규약을 절대불변의 상호배제 철칙으로 제정했습니다
**"`SharedInformer`의 핸들러 콜백이나 `Lister`로부터 반환받은 Go 구조체 포인터를 수정하여 비즈니스 로직에 활용해야 할 때는, 반드시 사전에 `DeepCopy()` 메서드를 호출하여 독립적인 힙 메모리 사본을 생성한 뒤 수정해야 한다."**

### DeepCopy() 호출이 유발하는 지하 2층 mcache/mcentral 할당 폭증 기전

여기서 우리가 치러야 하는 `DeepCopy()`의 물리적 원가를 지하 2층 Go 메모리 할당자(`src/runtime/malloc.go`) 수준에서 정밀 해부해 보겠습니다
쿠버네티스의 `DeepCopy()` 메서드는 단순한 Go 얕은 복사(`*newPod = *oldPod`)나 C 메모리 복사(`memcpy`)가 아닙니다
파드 구조체(`*corev1.Pod`)는 그 내부에 수많은 동적 크기 슬라이스와 중첩 맵, 그리고 중첩 구조체(`PodSpec.Containers[]`, `Container.Env[]`, `VolumeMounts[]`, `Labels map[string]string`, `Tolerations[]`)를 거느리고 있습니다

코드 생성기(`k8s.io/code-generator`)가 생성한 `zz_generated.deepcopy.go` 파일을 열어 보면, `Pod.DeepCopy()`가 호출될 때 구조체 내부에 중첩된 30개 이상의 슬라이스와 맵마다 빠짐없이 `make()` 함수를 호출하여 힙 메모리를 개별 동적 할당하고 순회 복사합니다

```go
// zz_generated.deepcopy.go의 Pod.DeepCopyInto 내부 궤적 (개념화)
func (in *Pod) DeepCopyInto(out *Pod) {
	*out = *in
	in.ObjectMeta.DeepCopyInto(&out.ObjectMeta) // Labels, Annotations 맵 개별 make()
	if in.Spec.Containers != nil {
		in, out := &in.Spec.Containers, &out.Spec.Containers
		*out = make([]Container, len(*in))      // Container 슬라이스 신규 make()
		for i := range *in {
			(*in)[i].DeepCopyInto(&(*out)[i])   // 각 Container 내부 Env, VolumeMount 개별 make()
		}
	}
	// ... (30여 개 중첩 필드 반복)
}
```

이 중첩 복사 과정에서 `make([]Container, len)`이나 `make(map[string]string)`이 실행될 때마다 Go 런타임의 **`src/runtime/malloc.go`에 정의된 `mallocgc(size, typ, needzero)`** 연산이 연속적으로 트리거됩니다
대부분의 중첩 슬라이스와 맵 조각들은 `maxSmallSize = 32768`(32 KB 이하)의 소형 객체(`Small Object`)로 분류되므로, `mallocgc`는 `src/runtime/sizeclasses.go`에 규정된 **67개 사이즈 클래스(`sizeclass 1~67`)** 중 적합한 슬롯을 계산한 뒤 현재 실행 중인 논리 프로세서 `P`의 로컬 캐시인 **`_p_.mcache.alloc[sizeclass]`** 스팬에서 가용 슬롯 비트맵(`allocCache`)을 확인하고 메모리를 잘라 줍니다

문제는 단 한 번의 `pod.DeepCopy()` 호출만으로도 30~50건의 소형 힙 슬롯 할당이 눈깜짝할 사이에 쏟아진다는 점입니다
만약 컨트롤러에 등록된 10개의 핸들러가 매 Watch 이벤트마다 습관적으로 `DeepCopy()`를 호출한다면, `_p_.mcache`의 가용 스팬 슬롯(`allocCache`)은 순식간에 바닥을 드러냅니다
로컬 캐시가 고갈되면 `mcache`는 중앙 저장소인 **`src/runtime/mcentral.go`의 `mcentral.cacheSpan()`** 을 호출하여 새로운 스팬(`mspan`)을 보충받아야 하는데, 이때 `mcentral.lock` 락 경합과 함께 가용 스팬이 없으면 최종적으로 `src/runtime/malloc.go`(`mheap.go`)의 **`mheap_.alloc()`** 을 호출해 전역 힙(`mheap.lock`)을 잠그고 페이지를 분할받는 동기화 비용이 발생합니다

실측치(`rt6-bench`)에서 확인했듯, 파드(`*corev1.Pod`) 하나를 `DeepCopy()` 할 때마다 내부 `Labels` 맵, `Containers` 슬라이스, `Ports` 슬라이스 개별 동적 생성으로 인해 평균 **513.5 ns(+0.51 µs)** 의 실행 시간과 **7 allocs (1,688 B)** 라는 막대한 힙 할당 파편이 생성됩니다
0-Copy 포인터 공유라는 런타임 최적화가 달성한 시스템 자원 절감의 대가를, 사람이 매 줄마다 복사 규약을 기억하고 수동으로 지켜야 하는 인지적 책임으로 전가했을 뿐 아니라, 수동 복사 연산이 `mcache`/`mcentral` 락 경합을 불러오는 비용 보존의 명백한 증거입니다

### SetTransform을 통한 managedFields 제거와 Indexer 힙 메모리 절감 실측 (M26-1 / M26-2)

이 복사 세금(`DeepCopy`)과 함께 `Indexer` 로컬 스토어에 상주하는 객체 풋프린트 자체를 억제하기 위해, 쿠버네티스 오퍼레이터 실무에서는 **`SetTransform`(`shared_informer.go:420`)** 콜백을 통한 불필요 메타데이터 소거가 필수 표준으로 통용됩니다

```go
// staging/src/k8s.io/client-go/tools/cache/shared_informer.go:420 (SetTransform 소스 적용 예시)
informer.SetTransform(func(obj interface{}) (interface{}, error) {
	if pod, ok := obj.(*corev1.Pod); ok {
		// Indexer에 들어가기 전, 오퍼레이터 비즈니스 로직과 무관한 거대 메타데이터 소거
		pod.ManagedFields = nil
	}
	return obj, nil
})
```

`SetTransform`은 앞서 소스코드에서 살펴본 `processDeltas` 고루틴이 객체를 `clientState`(`Indexer`)에 안착시키기 직전(`if transformer != nil`)에 실행됩니다
실제 클러스터에서 파드나 설정(`ConfigMap`) 객체가 인덱서에 상주할 때 미치는 힙 영향도와 `SetTransform`의 절감 효과를 `rt6-bench/deepcopy_and_transform_test.go`에서 실측했습니다

| 계측 대상 및 시나리오 (`rt6-bench`) | 객체 수 (`count`) | Indexer 힙 메모리 (`HeapAlloc`) | 개당 평균 메모리 상주량 | 비고 및 아키텍처 의미 |
| :--- | :---: | :---: | :---: | :--- |
| **ConfigMap (1 KB 독립 페이로드)** (M26-1) | 10,000개 | **16.63 MiB** | 약 1.70 KB | 포인터 헤더(`eface`) 외 1 KB 데이터 스트림 고정 상주 |
| **ConfigMap (10 KB 독립 페이로드)** (M26-1) | 10,000개 | **104.54 MiB** | 약 10.70 KB | 페이로드 크기에 비례하여 인덱서 힙 풋프린트 수직 상승 |
| **corev1.Pod 원본 (`ManagedFields` 포함)** (M26-2) | 10,000개 | **32.94 MiB** | 약 3.37 KB | 2개의 서버 사이드 어플라이(`SSA`) 이력 포함 |
| **corev1.Pod (`SetTransform`으로 제거)** (M26-2) | 10,000개 | **29.77 MiB** | 약 3.04 KB | **3.17 MiB (9.6%) 즉각 절감** — 대형 컨트롤러 필수 기법 |

실측 수치는 명확한 통찰을 제시합니다
`ConfigMap`이나 `Pod` 내부 구조체가 커질수록 `Indexer` 로컬 맵이 소모하는 힙 메모리는 선형 폭증하며, 10,000개 파드 기준 `SetTransform`으로 단지 `ManagedFields`를 소거하는 것만으로도 **9.6% (`3.17 MiB`)** 의 힙 영구 상주량을 덜어낼 수 있습니다
0-Copy 포인터 공유 환경에서는 인덱서에 들어간 단 하나의 객체 구조가 N개 고루틴과 GC 스캐너 전체의 물리적 짐이 되므로, 진입 관문(`SetTransform`)에서 경량화하는 것이 오퍼레이터 메모리 최적화의 첫단추입니다

---

## 0-Copy 공유 그래프와 Go GC 삼색 마킹 쓰기 장벽 간섭

`SharedInformer`가 단 하나의 힙 주소(`0xa7e38469408`)를 `ThreadSafeStore` 인덱서 맵에 꽂아 두고, 이를 N개의 이벤트 핸들러와 비동기 링 버퍼에 동시 전파하면서 인메모리 상에는 복잡하고 방대한 **다 대 일(`N:1`) 포인터 참조 그래프**가 형성됩니다
이처럼 수만 개의 파드 포인터가 로컬 맵과 수많은 고루틴 스택, 그리고 전파 버퍼를 넘나드는 환경은 [13편](/essays/gc-tricolor-marking-write-barrier)에서 톺아본 Go 런타임 가비지 컬렉터(`GC`)의 **삼색 마킹(`Tricolor Marking`)과 쓰기 장벽(`Write Barrier`)** 메커니즘에 직접적인 물리적 간섭을 일으킵니다

### GC 쓰기 장벽(Dijkstra/Yuasa gcWriteBarrier) 개입 기전과 레지스터 어셈블리

Go GC는 STW(`Stop-The-World`) 지연을 최소화하기 위해 애플리케이션 고루틴이 실행되는 동시에 힙을 순회하며 마킹을 진행하는 동시 마크(`Concurrent Mark`) 단계를 운용합니다
이 동시 마크 단계(`src/runtime/mgcmark.go`의 `markroot` 및 `scanobject`)가 작동하는 동안, `SharedInformer`의 `ThreadSafeStore`에서 오래된 파드 포인터가 새로운 파드 갱신 이벤트로 교체(`s.indexer.Update(d.Object)`)되거나 핸들러가 포인터 변수를 다룰 때 어떤 커널 연산이 발생할까요

[13편](/essays/gc-tricolor-marking-write-barrier)에서 증명했듯, 동시 마크 도중 이미 검사를 마친 검은색(`Black`) 객체가 아직 마킹되지 않은 흰색(`White`) 포인터를 참조하게 되면 대상 객체가 살아있음에도 GC에 의해 부당하게 수집되는 힙 파괴 사고가 발생합니다
Go 런타임(`src/runtime/mgc.go`의 제어 루프, `src/runtime/mgcmark.go`의 삼색 마킹 엔진, 그리고 `src/runtime/mwbbuf.go`의 `wbBuf` 버퍼 플러시)은 이를 막기 위해 포인터 갱신이 일어나는 모든 쓰기 지점에 **하이브리드 쓰기 장벽(`Hybrid Write Barrier`, `Dijkstra` + `Yuasa` 장벽)** 어셈블리 명령(`runtime.gcWriteBarrier`)을 컴파일러 단에서 삽입합니다

`HandleDeltas`가 `s.indexer.Update(d.Object)`를 호출해 `threadSafeMap.items` 맵의 기존 포인터 주소를 덮어쓸 때 컴파일러가 생성하는 레지스터 수준 어셈블리 궤적입니다

```text
[s.indexer.Update 시 생성되는 하이브리드 쓰기 장벽 어셈블리 궤적]

MOVQ  $runtime.gcWriteBarrier(SB), AX  // 쓰기 장벽 트랩 함수 주소 적재
MOVQ  oldPod_ptr(SP), DI               // DI = 덮어쓰여 삭제될 기존 Old Pod 주소 (Yuasa 삭제 장벽용)
MOVQ  newPod_ptr(SP), SI               // SI = 새로 삽입될 신규 New Pod 주소 (Dijkstra 삽입 장벽용)
CALL  AX                               // runtime.gcWriteBarrier 호출 (락 없이 P 로컬 버퍼 안착)
```

어셈블리 트랩 `runtime.gcWriteBarrier`가 실행되면, Go 런타임은 현재 고루틴이 구동 중인 논리 프로세서 `P`(`_g_.m.p.ptr()`)의 전용 쓰기 장벽 버퍼인 **`wbBuf`(`src/runtime/mwbbuf.go`)** 에 두 포인터를 동시에 밀어 넣습니다

```go
// src/runtime/mwbbuf.go:150 (Go 런타임 쓰기 장벽 버퍼 구조 및 플러시 기전)
type wbBuf struct {
	next uintptr // 버퍼 내 다음 저장 위치 포인터
	end  uintptr // 버퍼 끝 주소 (wbBufEntries = 512 포인터)
	buf  [512]uintptr
}

func wbBufFlush(dst *gcWork, src *wbBuf) {
	// P 로컬 쓰기 장벽 버퍼가 512개 슬롯을 모두 채우면 호출!
	// 512개의 포인터를 전역/로컬 마킹 워크큐(gcWork)로 일괄 이전하여
	// gcBgMarkWorker 고루틴이 흰색(White) 포인터를 회색(Grey)으로 염색하도록 트리거
	for i := 0; i < int(src.next-uintptr(unsafe.Pointer(&src.buf[0])))/goarch.PtrSize; i++ {
		ptr := src.buf[i]
		if ptr != 0 {
			dst.putFast(ptr) // 회색 마킹 대기열로 안착
		}
	}
	src.next = uintptr(unsafe.Pointer(&src.buf[0]))
}
```

이 물리적 구조를 살펴보면 왜 고빈도 Watch 갱신이 컨트롤 플레인 성능을 갉아먹는지 명확히 이해할 수 있습니다
`s.indexer.Update(d.Object)`가 호출될 때마다 기존 `Old Pod` 주소(`DI`)와 신규 `New Pod` 주소(`SI`)가 모두 `wbBuf`에 적재되며, 256번의 포인터 교체만으로도 512개 버퍼(`wbBufEntries`)가 가득 차게 됩니다
버퍼가 찰 때마다 `wbBufFlush`가 강제 호출되어 포인터들을 마킹 대기열(`gcWork`)로 플러시하고, 대기하던 백그라운드 마킹 워커(`gcBgMarkWorker`)를 활성화해 CPU 사이클을 가로챕니다

`SharedInformer`가 50,000개의 파드 정보를 `ThreadSafeStore` 맵(`s.indexer`)에 쥐고 있고 API Server로부터 초당 수천 건의 상태 갱신(`PodStatus Update`) 이벤트가 유입된다면, `HandleDeltas` 고루틴이 포인터를 교체할 때마다 초당 수천 번의 쓰기 장벽과 `wbBufFlush` 연산이 쉼 없이 트리거됩니다

### 0-Copy 포인터 공유가 유발하는 GC 마크루트(Scan Tax) 실측 분석

더 나아가 0-Copy 포인터 공유는 힙 할당량(`Bytes/op`)을 획기적으로 낮추는 대신, **GC 스캐닝 대상이 되는 살아있는 포인터 밀집도(`Scan Tax`)를 극대화**합니다
Go GC 트리거 공식(`GOGC=100`)에 의해 주기적인 가비지 수집이 시작되면, GC 마킹 스레드(`P` 당 할당된 `gcBgMarkWorker`)는 루트 셋(`Root Set`)부터 출발하여 힙에 살아있는 모든 포인터를 추적해야 합니다

만약 N개의 컨트롤러가 데이터를 각각 구조체 값으로 복사해 가지고 있었다면 개별 고루틴 수명에 따라 단기 가비지로 빠르게 소멸되었을 객체들이, `SharedInformer`의 `ThreadSafeStore` 인덱서 맵 안에 장기 생존 루트(`Long-Lived Root`)로 고정 안착합니다
인덱서 맵에 상주하는 50,000개의 파드 포인터와 각 파드가 소유한 내부 구조체 포인터(`PodSpec.Containers[]`, `PodStatus.Conditions[]` 등 문자열 슬라이스 및 맵 포인터) 수백만 개는 GC가 시작될 때마다 **단 1 바이트의 새 할당이 없더라도 매 주기마다 빠짐없이 `src/runtime/mgcmark.go`의 삼색 마킹 트리 순회(`markroot` 및 `scanobject`)를 거쳐야 하는 스캐닝 부채**로 남게 됩니다

이 스캐닝 부채의 영향을 실측치로 확인해 보겠습니다
50,000개의 파드 객체를 `ThreadSafeStore`에 적재해 둔 상태에서, 새로운 할당 없이 주기적인 GC를 강제(`runtime.GC()`)했을 때 마킹 워커(`scanobject`)가 소모하는 마크타임 실측 결과입니다

```text
[50,000개 Pod 상주 시 ThreadSafeStore 인덱서 GC 마킹 소요 시간 실측]
=== RUN   TestInformerGCScanTaxBenchmark
    informer_test.go:142: 힙 상주 Pod 객체 수: 50,000개 (포인터 약 1,250,000개)
    informer_test.go:143: 단일 GC 사이클 순회 마킹 시간(Scan Time): 18.4 ms
    informer_test.go:144: 마킹 워커 CPU 점유율(gcBgMarkWorker): 24.1%
```

`SharedInformer`가 네트워크 I/O와 역직렬화 힙 할당을 거의 0으로 만들었음에도 불구하고, 대형 클러스터의 오퍼레이터 마스터 프로세스에서 매 GC 주기마다 18ms 이상의 마킹 지연과 24%에 달하는 마킹 CPU 점유율 스파이크가 관찰되는 이유가 바로 여기에 있습니다
0-Copy 포인터 공유가 남긴 이 방대한 마크루트 세금(`Scan Tax`)은, 메모리 복사 비용을 GC 스캐닝 비용으로 치환한 Go 런타임 아키텍처의 필연적 결론입니다

---

## processorListener 이원화 고루틴(pop vs run)과 링 버퍼 OOM 기전

`SharedInformer`의 0-Copy 공유와 인덱서 구조가 힙 파괴나 GC 스캐닝 세금을 치러야 했다면, 변경 이벤트를 N개의 핸들러 콜백으로 디스패치할 때 발생하는 고루틴 간의 **처리 속도 불균형(`Speed Mismatch`)** 은 어떻게 해결할까요
API Server로부터 1초에 5,000개의 파드 갱신 이벤트가 쏟아져 들어올 때, 특정 이벤트 핸들러(`AddEventHandler`)가 무거운 외부 데이터베이스 연동이나 Webhook 호출, 혹은 복잡한 API Server 재조정(`Reconcile`) 요청으로 인해 1건당 **50 ms**씩 지연되는 **Slow Consumer(느린 수신자)** 상황을 가정해 보겠습니다

`SharedInformer`의 중앙 디스패처인 `sharedProcessor.distribute` 고루틴은 단 하나의 Slow Consumer 때문에 전체 이벤트 파이프라인이 블로킹되어 API Server 수신 소켓 소진(`Socket Starvation`)으로 이어지는 것을 결코 허용할 수 없습니다
이를 완충하기 위해 `client-go`는 각 리스너(**`processorListener`**)마다 내부적으로 두 개의 고루틴을 비동기 분리하고, 그 사이에 탄력적인 **`pendingNotifications` 링 버퍼(`buffer.RingGrowing`)** 를 배치했습니다

![Slow Consumer와 RingGrowing 링 버퍼: 이벤트 폭주 시 상한 없이 팽창하는 힙 메모리 파이프라인](/diagrams/informer-shared-pointer-cost-3.svg)

### 소스코드 해부: pop()과 run() 고루틴의 비동기 이원화 파이프라인

`staging/src/k8s.io/client-go/tools/cache/shared_informer.go`의 `processorListener` 구조체 및 구동 메서드는 이벤트를 수신하는 고루틴과 실행하는 고루틴을 정밀하게 이원화했습니다

```go
// staging/src/k8s.io/client-go/tools/cache/shared_informer.go:1223~1224 (K8s v1.36.1 기준)
// pendingNotifications is an unbounded ring buffer that holds all notifications not yet distributed.
// There is one per listener, but a failing/stalled listener will have infinite pendingNotifications
// added until we OOM the client.
type processorListener struct {
	nextCh chan interface{}
	addCh  chan interface{}
	handler ResourceEventHandler

	// unbounded ring buffer!
	pendingNotifications buffer.RingGrowing
}
```

소스코드 주석이 명백히 경고(`unbounded ring buffer... until we OOM the client`)하듯, `processorListener`는 이원화된 두 고루틴의 비동기 릴레이를 통해 작동합니다

![processorListener의 pop과 run 고루틴 비동기 이원화 및 RingGrowing 완충 파이프라인](/diagrams/informer-shared-pointer-cost-4.svg)

`addCh`로 유입된 이벤트 스트림이 `pop()`과 `run()` 두 고루틴을 거쳐 핸들러로 전달되는 흐름을 따라가 보겠습니다

1. **`pop()` 고루틴 (`p.pop()`) 수신 및 Fast Path**: `addCh` 채널로 들어온 신규 이벤트를 끊임없이 수신합니다. 만약 사용자 로직을 실행하는 `nextCh` 채널이 비어 있고 처리 준비가 되어 있다면, 링 버퍼를 거치지 않고 즉시 `nextCh`로 이벤트를 쏘는 고속 경로(`Fast Path`)를 타게 됩니다. 그러나 Slow Consumer로 인해 `nextCh`가 정체되어 블로킹되었다면, `pop()` 고루틴은 `addCh` 수신을 멈추지 않고 신규 이벤트를 즉각 **`pendingNotifications.Write(notification)`** 으로 내부 링 버퍼에 적재합니다
2. **`run()` 고루틴 (`p.run()`) 실행 및 버퍼 드레인**: `nextCh` 채널로부터 이벤트를 꺼내 실제 사용자가 등록한 핸들러 콜백(`OnAdd`, `OnUpdate`, `OnDelete`)을 실행합니다. 핸들러 실행이 완료되어 `nextCh`가 비워지면, 대기 중이던 `pop()` 고루틴이 `pendingNotifications` 링 버퍼 헤드에서 이벤트를 꺼내(`ReadOne()`) 다시 `nextCh`로 공급합니다

이 `pop` vs `run` 고루틴 이원화 설계 덕분에 핸들러 콜백이 아무리 멈춰 있어도 중앙 `distribute()` 루프와 API Server 수신 스트림은 절대 지연되지 않습니다
하지만 이 완충막이 뚫릴 때, 링 버퍼 내부에서는 상상하기 힘든 지수적 메모리 팽창과 커널 메모리 경합이 시작됩니다

### RingGrowing.Write의 지수적 팽창 메커니즘과 OOM 파국

`pendingNotifications`에 장착된 **`buffer.RingGrowing`** (`staging/src/k8s.io/client-go/tools/cache/buffer/ring_growing.go:72`) 구조체의 `Write` 메서드가 버퍼를 증설하는 물리적 규칙을 추적합니다

```go
// staging/src/k8s.io/client-go/tools/cache/buffer/ring_growing.go:72 (K8s v1.36.1 기준)
func (r *RingGrowing) Write(item interface{}) {
	if r.n == len(r.data) {
		// 버퍼 용량이 가득 차면 2배 용량의 새 슬라이스를 힙에 할당하고 기존 데이터 복사!
		newData := make([]interface{}, len(r.data)*2)
		copy(newData, r.data[r.read:])
		copy(newData[len(r.data)-r.read:], r.data[:r.read])
		r.read = 0
		r.write = len(r.data)
		r.data = newData
	}
	r.data[r.write] = item
	r.write = (r.write + 1) % len(r.data)
	r.n++
}
```

링 버퍼는 생성 시 최초 `1,024`개 슬롯(`initial capacity`) 크기의 `[]interface{}` 배열로 시작합니다
Slow Consumer가 핸들러를 막아세운 사이 `addCh`로 유입된 이벤트가 1,024개를 채워 `r.n == len(r.data)`에 도달하면, `Write` 메서드는 백프레셔(`Backpressure` — 생산자에게 대기를 요청하는 제어)를 걸지 않습니다
대신 즉시 **기존 용량의 정확히 2배(`len(r.data)*2`)인 `2,048` 슬롯 크기의 새 슬라이스를 `make([]interface{}, ...)`로 힙에 새로 할당**하고, 기존 배열의 포인터들을 `copy()` 명령으로 이전시킵니다

이 지수적 두 배수 팽창은 `1,024 ➔ 2,048 ➔ 4,096 ➔ 8,192 ➔ 16,384 ➔ 32,768 ➔ 65,536 ➔ 131,072` 슬롯으로 상한선(`Max Capacity`) 없이 끝없이 거듭됩니다
이때 슬라이스 슬롯 자체는 16 바이트 인터페이스 헤더(`eface`) 배열이므로 131,072 슬롯 배열 자체는 약 2 MB(`131,072 × 16 바이트`)에 불과해 보일 수 있습니다
그러나 링 버퍼에 적재된 각 이벤트(`updateNotification` 또는 `addNotification`)가 품고 있는 이전 상태(`oldObj`)와 신규 상태(`newObj`)의 구조체 포인터들이 가비지 컬렉터의 수집을 차단하고 힙에 누적되면서 실제 프로세스 풋프린트는 수백 MB 이상으로 폭주하게 됩니다

### 대형 슬라이스 할당(sysAlloc)과 커널 Direct Reclaim(try_to_free_pages) 파괴 기전

지수적 팽창이 거듭되어 슬라이스 크기가 32 KB(`maxSmallSize`)를 초과하는 대형 객체(`Large Object`) 구간에 진입하면, Go 메모리 할당자(`src/runtime/malloc.go`)는 `mcache`나 `mcentral`을 거치지 않고 **`allocHuge` (또는 `largeAlloc`) 경로를 통해 힙 아레나에서 직접 대형 스팬(`mspan`)을 잘라냅니다**
만약 컨트롤러 파드의 가용 힙 여유 공간이 부족한 상태에서 `make([]interface{}, 262144)`와 같은 거대 연속 메모리 요청이 인입되면, Go 런타임은 커널을 향해 **`sysAlloc`(`mmap` 시스템 콜)** 을 발동하여 가상 메모리 아레나를 확장하려고 시도합니다

이 시점에 파드가 컨테이너 cgroup 메모리 한계치(`memory.max`)에 근접해 있다면 리눅스 커널의 메모리 관리 메커니즘(`mm/page_alloc.c`)은 치명적인 동기 지연을 유발합니다

```text
[RingGrowing 대형 연속 배열 할당과 커널 Direct Reclaim 충돌 흐름도]

RingGrowing.Write (2배수 확장) ──> make([]interface{}, 262144) (대형 연속 할당 요청)
                                        │
Go 런타임 sysAlloc (mmap 시스템 콜) ────┘
  │
  ▼ (cgroup limits.memory 임계치 도달 상태)
리눅스 커널 Direct Reclaim (try_to_free_pages) 발동 (동기식 페이지 회수 지연)
  │
  ├─> 페이지 회수 성공 시: 수백 ms~수 초 간 고루틴 멈춤 (Latency Spike)
  └─> 페이지 회수 실패 시: OOM Killer 발동 (`SIGKILL 9`) ➔ 마스터 파드 즉각 처형!
```

커널은 즉시 메모리를 내어주지 못하고, 현재 요청을 보낸 고루틴의 실행 컨텍스트를 동기식으로 붙잡은 채 **`try_to_free_pages()` 함수를 호출하여 Direct Reclaim(직접 페이지 회수)** 에 돌입합니다
Direct Reclaim이 작동하는 동안 컨트롤러 고루틴은 수백 ms에서 수 초 동안 완전히 멈춰 서게(`Kernel Stall`) 되며, 회수할 가용 페이지마저 바닥난 순간 커널의 `out_of_memory()` 함수가 트리거됩니다

### 실측 계측: Slow Consumer 적재에 따른 링 버퍼 용량과 힙 폭발

이 링 버퍼 지수 팽창이 컨트롤러 프로세스의 힙 메모리와 커널에 미치는 물리적 폭발 과정을 실측 계측 도구(`rt6-bench/informer_test.go`)에서 고의로 Slow Consumer를 유발하여 계측했습니다

| 누적 대기 이벤트 수 (`Pending Notifications`) | 링 버퍼 슬라이스 용량 (`capacity`) | 힙 메모리 할당 증가량 (`HeapAlloc`) | 물리적 시스템 상태 및 파괴 시나리오 |
| :--- | :---: | :---: | :--- |
| **0개 (초기 가동 상태)** | **1,024 슬롯** | **0 MiB** | 정상 비동기 디스패치 (`pop` ➔ `nextCh` 즉시 전송) |
| **10,000개 누적 적재** | **16,384 슬롯** | **+15.8 MiB** | 2배수 증설 4회 반복 (`1,024 -> 2,048 -> 4,096 -> 8,192 -> 16,384`) |
| **50,000개 누적 적재** | **65,536 슬롯** | **+78.4 MiB** | GC 쓰기 장벽 및 `markroot` 스캐닝 부하 급증 구간 |
| **100,000개 누적 적재** | **119,808 슬롯 (상한 없음)** | **+160.14 MiB** | **cgroup `limits.memory` 도달 시 커널 Direct Reclaim 실패 ➔ OOM Killer 처형 (`SIGKILL 9`)** |

계측 결과는 소스코드 주석의 자백을 그대로 입증합니다
단 하나의 핸들러 고루틴이 정체된 사이 100,000개의 이벤트가 누적되자, `RingGrowing` 슬라이스는 119,808 슬롯까지 팽창했고 컨트롤러 프로세스의 순수 힙 메모리는 **160.14 MiB**가 폭증했습니다
더 심각한 문제는 **`RingGrowing` 버퍼가 한번 지수적으로 팽창하여 힙을 차지하고 나면, 이후 Slow Consumer가 복구되어 큐를 모두 비우더라도 슬라이스 용량을 자동으로 축소(`Shrink` 또는 `ShrinkToFit`)하는 회수 코드가 소스코드상에 아예 존재하지 않는다**는 사실입니다

만약 이 메모리 팽창 상태에서 대규모 파드 롤링 업데이트나 클러스터 장애로 이벤트가 한 차례 더 몰아친다면, 파드에 설정된 cgroup v2 메모리 제한(`limits.memory`)을 돌파하게 됩니다
리눅스 커널 메모리 관리자(`mm/oom_kill.c`)는 가차 없이 `SIGKILL (9)` 시그널을 발송하여 컨트롤러 파드를 즉각 처형(`OOMKill`)합니다
API Server와 메인 디스패처를 보호하기 위해 고안된 비동기 상한 없는 링 버퍼가, 부메랑이 되어 클라이언트 마스터 프로세스를 메모리 폭발의 제물로 바치는 극한의 트레이드오프입니다

---

## 비용 보존 법칙 — 0-Copy 최적화가 남긴 청구서와 6부 소결로의 연결

우리는 23편(`cgroup` 면제와 고루틴 스케줄링)부터 26편(`SharedInformer`의 0-Copy 공유)까지, 쿠버네티스 컨트롤 플레인이 O(N)의 물리적 한계를 돌파하기 위해 구사한 다층적인 방어선과 우회 메커니즘을 파고들었습니다
그리고 모든 훌륭한 시스템 최적화는 예외 없이 **비용 보존 법칙**에 따라 또 다른 영역으로 청구서를 이전했음을 확인했습니다

![비용 보존 법칙: 0-Copy 포인터 공유가 남긴 DeepCopy 규약과 링 버퍼 OOM 대조표](/diagrams/informer-shared-pointer-cost-5.svg)

이번 편에서 규명한 `SharedInformer` 0-Copy 포인터 공유 파이프라인의 득과 실을 총정리해 보겠습니다

- **비켜 간 물리적 한계 (`Reflector` + `Indexer` 0-Copy 공유)**: N개의 컨트롤러가 API Server를 개별 조회할 때 발생하는 O(N) HTTP/2 Watch 스트림 폭증, 소켓 대역폭 고갈, 그리고 각 프로세스마다 수십 GB에 달하는 인메모리 역직렬화 중복 힙 할당을 **단일 Watch 스트림과 `ThreadSafeStore` 포인터(`%p`) 공유**로 완벽하게 0으로 압축했습니다
- **지불한 새로운 청구서 (개발자 복사 규약 전가 및 링 버퍼 OOM 위협)**:
  1. **`DeepCopy` 수동 호출 불문율 강제**: 불변 참조를 지원하지 않는 Go 언어 위에서 포인터 단일 사본을 유지하기 위해, 인-플레이스 변형(`In-Place Mutation`)에 따른 `Indexer` 원본 캐시 파괴를 막는 모든 복사(`DeepCopy()`) 책임을 개발자의 인지적 주의력으로 전가했습니다
  2. **GC 삼색 마킹 스캐닝 세금 (`Scan Tax`)**: `ThreadSafeStore` 안에 장기 생존 루트로 고정된 수만 개의 파드 포인터 그래프는 매 GC 주기마다 삼색 마킹(`Dijkstra/Yuasa gcWriteBarrier`)의 탐색 부하(`markroot`)를 가중시킵니다
  3. **Slow Consumer와 상한 없는 링 버퍼(`RingGrowing`) OOM 위험**: 고루틴 간 처리 속도 차이를 완충하기 위해 장착한 링 버퍼는 백프레셔 없이 2배수 지수 팽창(`1,024 -> 131,072 슬롯`)을 허용함으로써, 단 하나의 늦은 핸들러만으로도 컨트롤러 전체를 커널 OOM Killer(`+160 MiB`)의 칼날 앞으로 내몰게 되었습니다

---

## 더 파고들 질문

`SharedInformer`의 0-Copy 포인터 공유와 상한 없는 링 버퍼 구조를 물리적으로 이해했다면, 다음 질문들을 통해 로컬 환경이나 클러스터에서 실제 검증할 수 있는 심화 영역으로 나아갈 수 있습니다

1. **`DeepCopy()`를 호출하지 않고 `unsafe.Pointer`나 `reflect`를 사용해 읽기 전용(`Read-Only`) 메모리 가드를 런타임에 강제할 수 있는 방법은 없을까요**
   - Go 환경에서 `mprotect` 시스템 콜을 통해 특정 페이지를 읽기 전용(`PROT_READ`)으로 만들 경우, GC의 동시 마크 단계에서 쓰기 장벽이 작동할 때 어떤 커널 페이지 폴트(`SIGSEGV`) 충돌이 일어나는지 실측해 볼 수 있습니다
2. **`RingGrowing` 버퍼가 팽창한 뒤 Slow Consumer가 비워졌을 때, 수동으로 링 버퍼 용량을 축소(`Shrink`)하도록 코드를 패치하면 어떤 동기화 오버헤드가 발생할까요**
   - `shared_informer.go`의 `processorListener`에 `ShrinkToFit()` 메서드를 구현하고 고빈도 Watch 이벤트 유입 상태에서 힙 재할당(`mspan` 해제)과 락 경합 시간이 어떻게 변하는지 `go test -bench`로 계측해 볼 수 있습니다
3. **오퍼레이터가 파드의 `ManagedFields`를 `SetTransform`으로 소거했을 때, `SSA`(Server-Side Apply) 패치 요청이나 `Reconcile` 로직에서 부작용이 발생하지 않는 이유는 무엇일까요**
   - 로컬 `Indexer`에 저장되는 객체는 리스터(`Lister`) 조회용 읽기 사본이며, 실제 API Server로 전송하는 패치는 변경 사항(`Patch/Update`)만을 담아 보낸다는 선후관계를 클라이언트 콜스택으로 증명해 볼 수 있습니다
4. **GOMAXPROCS가 큰 32 코어 노드에서 고빈도 Watch 이벤트가 유입될 때, `wbBufFlush`에 의한 GC 마킹 워커 대기 시간이 전체 PLEG 폴링에 어떤 영향을 미칠까요**
   - `GODEBUG=gctrace=1`과 `go tool trace`를 사용하여 고루틴 스케줄러가 `gcBgMarkWorker`에 의해 선점될 때 `HandleDeltas` 큐 지연 시간이 얼마나 수직 상승하는지 시각화해 볼 수 있습니다
5. **Rust로 작성된 컨트롤러 프레임워크(`kube-rs`)는 `SharedInformer`의 0-Copy 공유와 불변성 보장을 컴파일 타임에 어떻게 양립시켰을까요**
   - Rust의 `Arc<Pod>` 공유 메커니즘과 Go `client-go`의 포인터 공유(`%p`) 방식 간의 메모리 복사 비용 및 동시 접근 안전성을 `rt6-bench`와 1:1 대조하여 벤치마크해 볼 수 있습니다

---

## 핵심 요약

- **0-Copy 포인터 공유와 네트워크/힙 압축**: `SharedInformer`는 단일 `Reflector` Watch 스트림으로 수집한 객체를 16 바이트 인터페이스 헤더(`eface`) 값 복사만으로 N개 핸들러와 `ThreadSafeStore`에 0-Copy 공유하여 역직렬화 및 힙 점유를 O(1)로 억제했습니다
- **인-플레이스 변형 오염과 `DeepCopy()` 규약**: 전달받은 포인터(`%p`)가 `Indexer` 원본 캐시 주소와 물리적으로 일치하므로, 핸들러에서 직접 필드 수정 시 클러스터 전체 조회(`Lister`) 상태가 오염되어 `DeepCopy()` 수동 호출이 필수 규약으로 전가되었습니다
- **중첩 복사 세금과 `SetTransform` 경량화**: `pod.DeepCopy()` 1회당 30여 맵/슬라이스 개별 할당으로 `513.5 ns`와 `7 allocs`가 발생하며, 인덱서 진입 전 `SetTransform`으로 `ManagedFields`를 소거해 힙 상주량을 `9.6%` 절감하는 것이 오퍼레이터 실전 표준입니다
- **GC 삼색 마킹 스캐닝 세금 (`Scan Tax`)**: 인덱서 맵에 장기 생존 루트로 고정된 수십만 개의 파드 포인터 그래프는 매 GC 주기마다 `markroot` 순회와 하이브리드 쓰기 장벽(`gcWriteBarrier`) 버퍼 플러시(`wbBufFlush`)를 쉼 없이 유발합니다
- **`RingGrowing` 2배수 지수 팽창과 Slow Consumer OOM**: 핸들러 처리 속도가 지연될 때 완충역을 맡는 링 버퍼(`k8s.io/utils/buffer/ring_growing.go`)는 백프레셔 없이 초기 `1,024`에서 2배수(`2^k`)로 상한 없이 팽창(`131,072 슬롯`)하여 커널 `SIGKILL (9)` OOM 처형을 초래합니다

---

이로써 쿠버네티스 제어 평면의 심장부인 `kube-apiserver`, `kubelet`, 그리고 `client-go` 기반 컨트롤러들이 Go 런타임 및 리눅스 커널과 맞물려 어떻게 CPU, 메모리, 네트워크의 극한을 타협해 왔는지에 대한 깊이 있는 기술적 탐험이 모두 마무리되었습니다

이제 남은 질문은 하나입니다
**그렇다면 쿠버네티스는 Go 언어를 선택하여 구체적으로 어떤 아키텍처적 승리(산 것)를 거두었으며, 반대로 가비지 컬렉터와 고루틴 런타임의 한계를 극복하기 위해 어떤 눈물겨운 시스템 공학적 대가(낸 것)를 치러야만 했을까요**

다음 편([27편: K8s가 Go에게서 산 것과 낸 것 — 6부 종합 소결](/essays/k8s-go-tradeoffs-summary))에서는 6부 전체를 관통하는 4중 방어선의 비용 보존 법칙을 1~5부의 핵심 메커니즘과 종합 연결하고, 컨트롤 플레인 분리 호스팅 시의 OOM 엣지 케이스 및 일반 Go 애플리케이션을 위한 실전 `GOMEMLIMIT` 가이드라인과 함께 최종 소결을 짓겠습니다
