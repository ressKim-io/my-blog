---
title: "분산 추적의 계측 지점 — 문맥 전파와 기록을 나눠 봅니다"
excerpt: "API 서버와 kubelet이 추적 문맥을 전달하고 span을 선택·내보내는 과정을 살펴봅니다. 필터 메트릭과 느린 요청 로그의 시간 경계, 부모 문맥의 신뢰 조건, 배치 큐의 손실과 TLS 설정 범위도 구분합니다"
category: "kubernetes"
tags: ["Kubernetes", "OpenTelemetry", "Tracing", "kube-apiserver", "kubelet", "concept"]
series:
  name: "k8s-theory-api"
  order: 23
date: "2026-10-23"
---

API 서버 로그에 `Trace[...]`가 나왔다고 OpenTelemetry 추적 내보내기가 켜졌다는 뜻은 아닙니다
한 요청을 처리하는 코드에는 메트릭, 느린 구간 로그, 분산 추적을 위한 계측이 함께 들어 있습니다
각 기록은 남기는 조건과 시간 경계가 다릅니다

span은 이름과 시작·끝 시각을 가진 추적 구간입니다
여러 span을 부모·자식 관계로 연결하면 컴포넌트를 넘나드는 요청의 처리 흐름을 따라갈 수 있습니다
collector는 이렇게 내보낸 span을 받는 수집 서비스입니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> OpenTelemetry SDK는 해당 Kubernetes 소스에 포함된 v1.44.0을 기준으로 확인했습니다
> 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## 요청 하나에서 서로 다른 기록이 남습니다

[API 서버 요청 경로](/essays/k8s-theory-api-request-path)를 지나가는 요청을 계측 관점에서 보겠습니다
인증 이후에는 들어온 추적 문맥을 부모로 사용할지 결정하고, 필터·핸들러·저장 계층이 각자의 처리 구간을 기록합니다

![요청 처리 계측에서 메트릭·느린 로그·표본 span으로 갈리고 span만 배치 내보내기 경로로 가는 흐름|tall](/diagrams/k8s-theory-distributed-tracing-1.svg)

추적 설정이 없어도 필터 지연 메트릭은 기록할 수 있습니다
느린 구간을 로그에 남기는 조건과 collector로 span을 내보내는 조건도 서로 독립적입니다

| 기록 | 단위와 조건 |
|---|---|
| 필터 지연 메트릭 | 측정 완료 지점에 도달하면 필터별 히스토그램에 누적. 추적 설정과 무관 |
| 요청 로그의 `fl_<필터 이름>` | 측정 지연이 100ms를 초과하고 klog verbosity가 3 이상일 때 추가 |
| OpenTelemetry span | 실제 추적기의 표본 추출 결과에 따라 기록·내보내기 대상이 됨 |

메트릭의 이름은 `apiserver_request_filter_duration_seconds`이며 라벨은 `filter`입니다
지연 분포를 집계하는 기록이므로 이 히스토그램에서 요청 하나를 이름이나 audit ID로 찾아낼 수는 없습니다

## 필터 메트릭과 filter span은 끝나는 지점이 다릅니다

[`filterlatency.TrackStarted`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/filterlatency/filterlatency.go)는 span을 열고 필터 측정 시작 시각을 저장합니다
뒤의 `TrackCompleted`는 다음 처리 단계에 들어갈 때 그 시각과의 차이를 메트릭에 기록하고, 조건에 맞으면 `fl_` 로그 필드를 붙입니다

반면 span은 `defer span.End()`로 닫습니다
안쪽 필터와 핸들러가 반환한 뒤에 끝나므로, 이름이 `authorization`인 span의 전체 길이를 인가 함수만의 실행 시간으로 읽으면 안 됩니다

![필터 메트릭은 다음 TrackCompleted 진입까지, OpenTelemetry filter span은 하위 핸들러 반환까지 이어지는 시간 경계](/diagrams/k8s-theory-distributed-tracing-2.svg)

메트릭 기록도 해당 완료 지점에 도달해야 합니다
필터가 요청을 거절하고 안쪽 핸들러를 호출하지 않았다면 그 필터 뒤의 `TrackCompleted`는 실행되지 않습니다
인증 실패처럼 별도의 완료 지점을 둔 경로도 있으므로, 추적 설정과 무관하다는 설명을 모든 요청·모든 필터에 반드시 표본이 남는다는 뜻으로 확대할 수는 없습니다

이 배치는 [`DefaultBuildHandlerChain`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/config.go)에 있습니다
같은 코드 주변에서 나온 메트릭과 span이어도 측정 구간을 먼저 비교해야 지연을 해석할 수 있습니다

### Trace 로그는 OpenTelemetry span과 별도입니다

핸들러와 저장 계층의 공통 [`tracing.Start`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-base/tracing/tracing.go)는 두 추적 경로를 함께 시작합니다
하나는 OpenTelemetry이고, 다른 하나는 `k8s.io/utils/trace`의 내부 추적입니다

| 경로 | 끝날 때 하는 일 |
|---|---|
| OpenTelemetry | span을 끝내고, 표본으로 선택됐으면 배치 처리 경로에 넘김 |
| 내부 `utiltrace` | `LogIfLong`에 넘긴 시간 기준과 로그 설정에 따라 느린 구간을 출력 |

확인한 Create·Get·List·Update·Patch·Delete와 저장 작업은 대체로 500ms를 로그 기준으로 사용합니다
`SerializeObject`는 5초를 사용합니다
이 값은 API 요청을 중단하는 timeout이 아니라 내부 추적을 로그로 남길지 정하는 기준입니다

내부 추적은 루트에서 klog verbosity 2 이상이어야 로그 출력을 시작하며, 설정한 시간 기준 이상인 구간을 골라 기록합니다
중첩된 구간은 각자 즉시 출력하는 대신 상위 추적이 처리할 때 함께 평가됩니다

따라서 `Trace[...] ... (total time: ...)` 로그는 OpenTelemetry 설정 없이도 나올 수 있습니다
괄호 안의 번호도 OpenTelemetry trace ID를 그대로 출력한 것이 아니라 내부 추적 로그가 만든 식별자입니다
실제 출력 조건은 [`Trace.Log`·`LogIfLong`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/vendor/k8s.io/utils/trace/trace.go)에 있습니다

## 문맥을 전달하는 것과 span을 내보내는 것은 다릅니다

`traceparent`는 W3C 추적 문맥 헤더입니다
trace ID, span ID, 표본 선택 표시 등을 담아 다음 호출이 앞의 처리와 관계를 맺게 합니다

Kubernetes의 공통 추적 코드는 이 문맥을 읽고 쓰는 전파기와 실제 span을 기록하는 추적기를 따로 구성합니다
noop TracerProvider는 실제 span을 기록하지 않는 구현이지만, 계측된 HTTP transport의 문맥 전파까지 없애지는 않습니다

[`WithTracing`과 `WrapperFor`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-base/tracing/utils.go)는 noop 추적기를 사용해도 HTTP 문맥 전파를 처리합니다
이렇게 해야 중간 컴포넌트가 span을 내보내지 않는다는 이유만으로 뒤의 계측된 호출에 전달할 문맥까지 사라지지 않습니다

다만 이것은 모든 호출 경로가 자동으로 하나의 trace에 속한다는 뜻은 아닙니다
계측기가 설치된 경로인지, 유효한 문맥이 있는지, 받은 쪽이 이를 부모로 신뢰하는지가 각각 영향을 줍니다

## 내보내기 설정은 API 서버와 kubelet에서 다르게 넣습니다

두 컴포넌트는 공통 `TracingConfiguration`의 `endpoint`와 `samplingRatePerMillion`을 사용합니다
설정을 담는 위치는 다릅니다

| 컴포넌트 | 설정 위치 |
|---|---|
| API 서버 | `--tracing-config-file`로 지정한 전용 설정 파일 |
| kubelet | 기존 `KubeletConfiguration`의 `tracing` 필드 |

API 서버 설정의 구조는 다음과 같습니다
실행한 클러스터의 설정이 아니라 필드 구성을 보여 주는 예시입니다

```yaml
apiVersion: apiserver.config.k8s.io/v1
kind: TracingConfiguration
endpoint: localhost:4317
samplingRatePerMillion: 100
```

kubelet은 같은 두 필드를 기존 설정 안에 넣습니다

```yaml
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
tracing:
  endpoint: localhost:4317
  samplingRatePerMillion: 100
```

kubelet은 이미 버전이 있는 설정 오브젝트를 사용하므로 여기에 필드를 추가합니다
API 서버는 인증·인가·저장 암호화 설정처럼 구조가 필요한 설정을 별도 파일로 받습니다

환경변수 등 다른 exporter 설정이 없다면 endpoint의 기본값은 `localhost:4317`입니다
4317은 OTLP gRPC가 사용하는 포트이며, OTLP는 관측 데이터를 전달하는 OpenTelemetry 프로토콜입니다
설정의 endpoint 검증은 스킴 없는 주소와 `dns`·`unix`·`unix-abstract`를 허용합니다
`https://...`를 이 필드에 넣는 방식은 해당 검증을 통과하지 않습니다

### 기능의 안정화와 실제 추적기 설정은 별개입니다

v1.37.1 API 서버에는 `APIServerTracing` 게이트 정의가 없습니다
추적 기능이 제거된 것이 아니라 필터가 기본 체인에 직접 설치되며, 내보내기에는 여전히 설정 파일이 필요합니다

kubelet의 `KubeletTracing` 등록은 남아 있으며 v1.34부터 GA·기본 활성 상태로 잠겨 있습니다
이 경우에도 `tracing` 필드가 없으면 noop 추적기를 사용합니다
기능 단계가 stable이라는 사실만으로 collector로 span을 보내기 시작하는 것은 아닙니다

실제 연결은 API 서버의 [`TracingOptions.ApplyTo`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/options/tracing.go)와 kubelet의 [`newTracerProvider`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kubelet/app/server.go)에서 확인할 수 있습니다

## 표본 수를 생략한 것과 0은 같은 표본기를 고릅니다

`samplingRatePerMillion`은 백만 개당 얼마를 선택할지 정하며 0 이상 1,000,000 이하를 허용합니다
예시의 `100`은 새 루트의 표본 비율을 10,000분의 1로 정한 값입니다
정확히 매 10,000번째 요청만 선택하는 주기 설정은 아닙니다

[`NewProvider`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-base/tracing/utils.go)는 값이 있고 0보다 클 때만 비율 표본기를 만듭니다
생략했거나 0이면 새 루트를 선택하지 않는 `NeverSample`을 사용하고, 이를 `ParentBased`로 감쌉니다

| 유효한 부모 문맥 | 표본 결정 |
|---|---|
| 부모가 sampled | 설정한 루트 비율과 관계없이 선택 |
| 부모가 not sampled | 루트 비율이 1,000,000이어도 선택하지 않음 |
| 부모가 없음 | 자기 비율을 사용. 값이 없거나 0이면 선택하지 않음 |

부모 기반 표본기는 로컬 부모와 원격 부모 모두에서 이 선택 표시를 따릅니다
그러므로 설정을 통째로 주지 않은 상태와, 실제 추적기를 만들되 표본 수만 생략한 상태는 다릅니다
전자는 아무 span도 내보내지 않지만, 후자는 sampled 부모를 받았을 때 자식 span을 내보낼 수 있습니다

## 들어온 traceparent를 부모로 쓸지는 신원으로 정합니다

실제 추적기를 사용하는 API 서버는 요청자의 그룹을 보고 외부 추적 문맥을 신뢰할지 결정합니다
`system:masters` 또는 `system:monitoring`에 속하면 받은 문맥을 부모로 사용할 수 있습니다
그 밖의 요청자는 새 루트를 시작하고, 유효한 원격 문맥은 link로 연결합니다

![특권 그룹의 유효한 원격 문맥은 부모가 되고 일반 요청의 문맥은 새 루트에 링크로 연결되는 표본 결정](/diagrams/k8s-theory-distributed-tracing-3.svg)

부모는 trace의 계보와 표본 결정을 이어받는 관계입니다
link는 다른 span과 관련이 있다는 표시이며, 여기서 사용하는 루트 표본기는 link의 sampled 표시를 따라 선택하지 않습니다

외부 요청자의 sampled 표시를 모두 부모로 신뢰하면 서버의 루트 표본 비율을 우회할 수 있습니다
특권 그룹만 예외로 두는 이유이며, 그룹을 확인해야 하므로 추적 필터는 인증 뒤에 있습니다
이 판정은 [`notSystemPrivilegedGroup`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/filters/traces.go)에 있습니다

### 헤더가 없다고 항상 부모도 없는 것은 아닙니다

인증 구간의 span은 최상위 HTTP 추적 필터보다 바깥에서 먼저 열립니다
특권 그룹 요청에 유효한 `traceparent`가 없으면 이미 열린 인증 span이 로컬 부모로 남을 수 있습니다
그 경우에는 부모 기반 표본기가 인증 span의 선택을 따릅니다

따라서 특권 그룹 요청에 헤더가 없다는 이유만으로 항상 span이 없다고 결론 낼 수 없습니다
인증 span도 설정한 추적기로 시작하므로 그 부모 유무와 루트 표본 비율에 따라 선택 결과가 달라집니다
이는 필터 배치와 표본기 구현을 함께 읽은 결과이며, 별도의 클러스터 재현 결과는 아닙니다

## span 이름은 처리 계층을 보여 줍니다

v1.37.1에서 확인한 대표 계측 지점은 다음과 같습니다
모든 요청이 모든 지점을 거친다거나 전체 span 이름을 열거한 목록은 아닙니다

| 계층 | 대표 span 이름과 조건 |
|---|---|
| HTTP 요청 | `GET /api/v1/namespaces/{:namespace}/pods/{:name}`처럼 요청 정보로 이름 구성 |
| 필터 | `authentication`·`audit`·`authorization`, APF 경로의 `priorityandfairness`, 설정에 따른 `impersonation` 또는 `constrainedimpersonation` |
| 핸들러 | `Create`·`Get`·`List`·`WatchList`·`Update`·`Patch`·`Delete`·`SerializeObject` |
| admission webhook | `Call mutating webhook`·`Call validating webhook` |
| 캐시·저장 | `cacher.Get`·`cacher.GetList`·`Get etcd3`·`Create etcd3`·`GuaranteedUpdate etcd3`·`List(recursive=...) etcd3` |
| KMS 저장 변환 | `TransformFromStorage with envelopeTransformer`·`TransformToStorage with envelopeTransformer` |

API 서버가 요청의 인증·인가를 처리하고 본문을 다룬 뒤 저장하는 흐름이 계측 경계로도 드러납니다
캐시에서 응답하면 etcd 저장 호출을 거치지 않을 수 있고, 읽기 요청이 admission webhook을 호출하는 것도 아닙니다

`Create etcd3`는 API 서버의 저장 구현에서 시작하는 구간입니다
etcd 서버 내부의 Raft 합의나 디스크 기록 단계가 이 이름 하나로 각각 계측된다는 뜻은 아닙니다
[저장 변환 층](/essays/k8s-theory-storage-transformations)의 KMS 구간도 실제 그 변환기를 통과할 때만 나타납니다

HTTP span 이름은 namespace와 오브젝트 이름을 `{:namespace}`·`{:name}`으로 바꿔 이름 종류가 지나치게 늘어나는 것을 막습니다
이를 카디널리티를 제한한다고 표현합니다
이 처리는 span의 이름에 대한 것으로, `http.target` 같은 속성에는 실제 요청 URL이 들어갈 수 있습니다

## kubelet은 HTTP·CRI뿐 아니라 내부 작업도 계측합니다

kubelet의 HTTP 서버에는 추적 필터가 설치되고, CRI 클라이언트에는 gRPC 계측기가 붙습니다
CRI(Container Runtime Interface)는 kubelet이 컨테이너 런타임에 요청하는 API입니다
런타임도 추적을 지원하고 문맥을 이어받으면 kubelet 호출과 런타임 span을 연결할 수 있습니다

현재 CRI 클라이언트의 [`RemoteRuntimeServiceBuilder`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cri-client/pkg/remote_runtime.go)는 추적기를 지정하지 않으면 noop을 사용하되 문맥 전파 계측기는 설치합니다
명시적으로 `WithTracerProvider(nil)`을 주는 것은 다릅니다
이 경우에는 계측기 자체를 설치하지 않아 문맥 전파도 꺼집니다
kubelet의 일반 초기화 경로는 구성한 추적기를 이 builder에 전달합니다

내부에서는 `syncPod`·`syncTerminatingPod`·`syncTerminatedPod`와 이미지·컨테이너 GC에 span이 있습니다
GC는 사용하지 않는 이미지와 컨테이너 등을 정리하는 작업입니다
이 코드는 공통 `tracing.Start` 대신 `tracer.Start`를 직접 호출하므로 공통 함수만 검색하면 계측을 놓칠 수 있습니다

내부 작업이 언제나 앞선 API 요청의 자식으로 이어지는 것은 아닙니다
예를 들어 종료 동기화는 작업 문맥을 새로 구성하는 지점이 있으므로, 계측이 있다는 사실과 하나의 분산 trace로 연결된다는 사실은 나눠 봐야 합니다
CNI·CSI 인터페이스 전체의 추적 구현 여부는 여기서 확인한 범위에 포함하지 않습니다

## collector 내보내기는 별도 배치 루프에서 처리합니다

표본으로 선택된 span이 끝나면 BatchSpanProcessor가 큐에 넣기를 시도합니다
별도 루프가 이를 모아 exporter를 호출하므로 요청 고루틴이 collector의 응답 완료를 기다리지는 않습니다

확인한 Kubernetes의 [`go.mod`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/go.mod)와 vendor 목록은 OpenTelemetry SDK v1.44.0을 사용합니다
이 버전의 배치 처리 기본값은 다음과 같습니다

| 항목 | 기본값 | 이를 바꾸는 SDK 환경변수 |
|---|---|---|
| 큐 크기 | 2,048 span | `OTEL_BSP_MAX_QUEUE_SIZE` |
| 배치 최대 크기 | 512 span | `OTEL_BSP_MAX_EXPORT_BATCH_SIZE` |
| 배치를 기다리는 시간 | 5초 | `OTEL_BSP_SCHEDULE_DELAY` |
| 배치 처리기가 부여하는 내보내기 제한 | 30초 | `OTEL_BSP_EXPORT_TIMEOUT` |

배치가 512개에 도달하면 5초가 되기 전에도 내보낼 수 있습니다
기본값은 전송 간격을 항상 5초로 고정하거나, collector 도달 시간을 5초로 보장하는 설정이 아닙니다

표의 30초는 배치 처리기 쪽 제한입니다
OTLP gRPC exporter에는 별도로 기본 10초의 전송 제한이 있으며, 실제 내보내기는 상위 문맥과 exporter의 기한 중 먼저 만나는 제한을 따릅니다

| 상황 | 처리 |
|---|---|
| not sampled span | 내보내기 큐에 넣지 않음 |
| 큐가 가득 참 | 큐 공간을 기다리지 않고 span을 버리며 내부 드롭 수 증가 |
| 내보내기 실패 | 배치 처리기는 실패한 배치를 비움. 재시도 가능한 오류의 재시도는 exporter가 담당 |

SDK에는 큐가 찼을 때 기다리는 `WithBlocking` 옵션도 있습니다
Kubernetes의 `NewProvider`는 이 옵션을 넘기지 않으므로 일반 span 종료 경로는 큐가 비기를 기다리지 않습니다
명시적인 `ForceFlush`나 종료 처리는 별도의 대기 경로이며, 평소 요청 처리와 같은 설명을 적용하지 않습니다

이 구조는 collector 장애가 요청마다 직접적인 전송 대기로 이어지는 것을 피합니다
그렇다고 span 생성과 속성 기록, 큐 삽입의 CPU·메모리 비용이 없어지는 것은 아닙니다
관측 데이터가 손실될 수 있다는 설명 역시 API 요청 자체의 성공 여부와는 별개입니다

### 기본 OTLP 연결과 TLS 환경 설정을 구분합니다

Kubernetes의 공통 `NewProvider`는 OTLP gRPC exporter에 `WithInsecure`를 추가합니다
`TracingConfiguration` 자체에는 TLS 인증서 설정 필드가 없으며, 추가 환경 설정이 없는 기본 경로는 TLS를 사용하지 않습니다

다만 포함된 SDK의 설정 처리도 함께 확인해야 합니다
OTel v1.44.0은 exporter 환경변수로 TLS 자격 증명을 구성할 수 있고, gRPC 설정에서는 이 자격 증명을 `Insecure`보다 우선합니다
따라서 실제 연결의 암호화 여부를 판단할 때는 Kubernetes 설정 파일과 exporter 환경변수를 함께 봐야 합니다

예를 들어 SDK는 `OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE`로 CA 파일을 읽어 TLS 자격 증명을 구성하는 경로를 갖습니다
이 우선순위는 [`envconfig.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/vendor/go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc/internal/otlpconfig/envconfig.go)와 [`NewGRPCConfig`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/vendor/go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc/internal/otlpconfig/options.go)에서 확인했습니다
이 글에서 해당 환경 설정으로 실제 TLS 통신을 재현한 것은 아닙니다

## 기록이 없을 때는 빠진 조건부터 구분합니다

| 단서 | 먼저 구분할 조건 |
|---|---|
| 기능이 안정화됐는데 span이 없음 | API 서버 설정 파일 또는 kubelet의 `tracing` 필드가 없어 noop인지 |
| 실제 추적기를 설정했는데 span이 없음 | 부모 문맥과 sampled 표시, 루트 표본 수의 생략·0 여부 |
| 표본 수를 1,000,000으로 줘도 일부 span이 없음 | not sampled 부모, 계측 범위, 큐·내보내기 손실 |
| 외부에서 시작한 trace가 API 서버에서 새 trace로 바뀜 | 일반 요청자의 문맥을 부모 대신 link로 연결했는지 |
| 설정 없이 `Trace[...]` 로그가 출력됨 | OpenTelemetry와 별도인 내부 추적 로그인지 |
| filter span이 메트릭의 필터 지연보다 김 | span이 하위 처리까지 포함하는 시간 경계 차이 |
| 느린 필터인데 `fl_`가 없음 | 완료 측정 지점 도달 여부, 100ms 초과와 klog V(3) 조건 |
| collector를 사용할 수 없는데 API 요청은 처리됨 | 비동기 내보내기와 요청 처리의 분리. span 손실 여부는 별도 |
| kubelet 내부 작업 span이 없음 | 추적 설정·표본 추출·부모 문맥. 내부 계측 부재로 단정하지 않음 |
| 이름에서 오브젝트를 식별할 수 없음 | HTTP span 이름의 namespace·이름 치환 |
| endpoint에 `https://`를 넣고 설정 검증 실패 | Kubernetes endpoint 필드가 허용하는 gRPC 이름 스킴 |

span과 audit 로그를 연결하는 정보도 있습니다
API 서버 추적 필터는 HTTP span에 `audit-id` 속성을 붙입니다
이때 사용하는 `GetAuditIDTruncated`는 긴 ID를 64자로 제한하므로 원래 ID가 긴 경우에는 이 조건도 고려해야 합니다

audit 로그는 요청의 감사 기록이고, span은 선택된 처리 구간의 관계와 시간을 담습니다
집계 히스토그램, 조건부 요청 로그, 표본 span을 전부 같은 요청별 기록으로 취급하면 빈자리가 생긴 이유를 잘못 해석할 수 있습니다

### 느린 요청을 남기는 정책은 수집 단계까지 이어집니다

앞에서 본 `ParentBased`와 루트 비율은 span을 시작할 때 선택하는 head sampling입니다
Collector의 tail sampling은 도착한 span들을 보고 전체 지연이나 오류 같은 조건으로 trace를 선택할 수 있습니다
두 방식의 차이는 [OpenTelemetry의 sampling 문서](https://opentelemetry.io/docs/concepts/sampling/)에 설명돼 있습니다

하지만 앞단에서 내보내지 않은 span은 뒤의 tail sampler가 복구할 수 없습니다
느린 요청을 남기려면 앞단 표본 정책과 수집 용량을 함께 정해야 하며, 앞단에서 전부 선택하더라도 계측 범위와 전송 손실까지 사라지는 것은 아닙니다
여기서 다룬 것은 Kubernetes 시스템 컴포넌트의 계측이며 애플리케이션 요청 내부의 계측은 별도입니다

## 더 확인할 소스와 문서

- [공통 추적기·표본기·내보내기 구성](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-base/tracing/utils.go), [설정 타입](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-base/tracing/api/v1/types.go), [설정 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-base/tracing/api/v1/config.go)
- [외부 문맥의 부모·link 판정과 HTTP span 이름](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/filters/traces.go), [SDK의 ParentBased 구현](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/vendor/go.opentelemetry.io/otel/sdk/trace/sampling.go)
- [필터 히스토그램의 라벨·기록 함수](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/metrics/metrics.go), [audit ID 길이 제한](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/audit/context.go)
- [Create 핸들러 계측](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/handlers/create.go), [직렬화 계측](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/handlers/responsewriters/writers.go), [webhook 계측](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/webhook/mutating/dispatcher.go)
- [API 서버의 etcd 저장 계측](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/etcd3/store.go), [캐시 계측](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/cacher/cacher.go), [KMS v2 변환 계측](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/value/encrypt/envelope/kmsv2/envelope.go)
- [kubelet Pod 동기화](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kubelet.go), [이미지 GC](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/images/image_gc_manager.go), [컨테이너 GC](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_gc.go), [HTTP 계측 설치](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/server/server.go)
- [배치 큐·드롭·내보내기 구현](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/vendor/go.opentelemetry.io/otel/sdk/trace/batch_span_processor.go), [SDK 환경변수](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/vendor/go.opentelemetry.io/otel/sdk/trace/internal/env/env.go), [gRPC exporter의 재시도 처리](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/vendor/go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc/client.go)
- [kubelet 추적 게이트 이력](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go), [API 서버 게이트 정의](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/features/kube_features.go), [시스템 컴포넌트 추적 공식 문서 저장본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/cluster-administration/system-traces.md)
