---
title: "Kubernetes Event는 어디서 묶이고 버려지는가"
excerpt: "client-go의 core v1 기록기와 events.k8s.io/v1 기록기가 관측을 묶는 키, 카운트, 전송 시점을 비교합니다. 큐 드롭과 spam filter, kubelet 전송 제한, 저장 TTL을 구분해 이벤트가 보이지 않는 이유를 설명합니다"
category: "kubernetes"
tags: ["kubernetes", "events", "client-go", "observability", "concept"]
series:
  name: "k8s-theory-api"
  order: 22
date: "2026-08-24"
---

같은 실패가 반복되는데 Event는 하나만 보이거나, 한동안 새 기록이 나타나지 않을 수 있습니다
컴포넌트가 관측한 횟수와 API 서버에 남는 Event 오브젝트 수가 같지 않기 때문입니다
서버에 도착하기 전에 관측을 묶고, 늦춰 보내고, 버리는 경로가 있습니다

여기서는 컴포넌트가 Kubernetes API를 호출할 때 쓰는 라이브러리인 client-go의 두 Event 기록 구현을 비교합니다
하나는 core `v1` Event를 만드는 `tools/record`, 다른 하나는 `events.k8s.io/v1` Event를 만드는 `tools/events`입니다
같은 오브젝트를 어느 API 그룹으로 **조회했는지**와, 컴포넌트가 어느 구현으로 **기록했는지**를 구분해야 합니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## Eventf가 호출돼도 바로 서버에 쓰지는 않는다

`Eventf`는 대상 오브젝트와 종류, 이유, 설명 등을 받아 Event를 기록하는 입구입니다
그 뒤에는 브로드캐스터가 관측을 큐에 넣고 등록된 처리기들에게 전달합니다
이벤트 브로드캐스터는 보내는 쪽 프로세스 안에 있으며, 서버 전송과 로그 출력은 각각의 처리기로 등록할 수 있습니다

![두 client-go Event 기록기의 입구 큐와 처리기 채널, core의 집계·카운트·필터와 events의 시리즈 캐시를 거쳐 같은 서버 저장소에 쓰는 흐름|tall](/diagrams/k8s-theory-event-compression-1.svg)

두 기록기는 같은 키의 관측을 묶지만, core 기록기에는 메시지가 다른 관측을 집계하는 단계와 spam filter가 더 있습니다
events 기록기는 반복 관측의 증가분을 메모리에 모아 전송 횟수를 줄입니다

이 차이는 기록기 구현의 동작입니다
사용자가 Event를 직접 API에 POST했다고 해서 client-go의 같은 집계·필터를 거치는 것은 아닙니다
두 구현의 입구는 [`record.recorderImpl.generateEvent`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/tools/record/event.go)와 [`events.recorderImpl.eventf`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/tools/events/event_recorder.go)에 있습니다

## 같은 관측으로 묶는 키부터 다르다

두 기록기는 아래 필드들이 같은지를 기준으로 반복 관측을 묶습니다

| 기록 경로 | 반복 관측의 키 |
|---|---|
| core `v1` | `source`의 component·host, `involvedObject`의 종류·namespace·이름·fieldPath·UID·API version, `type`, `reason`, `message` |
| `events.k8s.io/v1` | `regarding`, `related`, `type`, `reason`, `action`, `reportingController`, `reportingInstance` |

`source`는 관측을 낸 component와 host이며, `involvedObject`·`regarding`은 대상 오브젝트 참조입니다
`related`는 함께 관련된 오브젝트 참조이고, `type`은 `Normal`·`Warning`, `reason`은 짧은 이유 식별자입니다
`action`은 수행했거나 실패한 동작이고, `reportingController`·`reportingInstance`는 기록을 낸 컨트롤러와 그 인스턴스를 구분합니다

core 키에는 설명 문자열인 `message`가 들어갑니다
events 키에는 그에 대응하는 `note`가 없습니다
다른 키 필드가 같다면 설명 속 숫자가 바뀌어도 events 기록기에서는 같은 시리즈로 묶을 수 있습니다

새 Event API는 동작·대상 같은 의미를 별도 필드로 표현해 설명 문자열에 덜 의존하도록 설계됐습니다
설계 문서는 같은 이벤트로 묶을 필드 조합을 여섯 항목으로 설명하지만, 현재 구현은 `type`도 포함한 일곱 항목을 사용합니다
키의 실제 기준은 [`getEventKey`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/tools/record/events_cache.go)와 [`getKey`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/tools/events/event_broadcaster.go), 설계 배경은 [KEP-383](https://github.com/kubernetes/enhancements/blob/0c8d11e9a13e12d2ef75d2d78af5ac00d8189046/keps/sig-instrumentation/383-new-event-api-ga-graduation/README.md)에서 확인할 수 있습니다

## core 기록기는 집계, 카운트, 필터 순으로 처리한다

`EventCorrelator`는 서버 전송 전에 유사한 관측을 집계하고, 반복 횟수를 센 뒤, spam filter를 적용합니다
서로 다른 관측을 한 요약에 모으는 집계와 같은 키의 횟수를 세는 카운트는 별도 단계입니다

### 서로 다른 메시지가 임계값에 닿으면 집계 Event를 만든다

기본 집계는 `source`, 대상 오브젝트의 종류·namespace·이름·UID·API version, `type`, `reason`, `reportingController`, `reportingInstance`가 같은 관측들을 한 묶음으로 봅니다
그 묶음 안에서 서로 다른 `message`를 셉니다
반복 관측의 전체 키와 달리 집계키에는 대상의 `fieldPath`가 없고, 보고 주체 필드가 들어갑니다

서로 다른 메시지 수가 기본 임계값 10에 닿은 관측은 집계 Event로 바뀝니다
이때 메시지는 다음 접두사로 시작합니다

```text
(combined from similar events):
```

이를 같은 메시지를 열 번 기록하면 집계된다고 해석하면 안 됩니다
동일한 메시지의 반복은 서로 다른 메시지 집합의 크기를 늘리지 않습니다

처음 메시지를 본 뒤 10분이 지나면 집계를 끝내는 방식도 아닙니다
구현은 같은 집계키의 **마지막 관측 이후 600초를 초과했으면** 메시지 집합을 초기화합니다
관측이 계속 이어지면 처음 메시지를 본 지 10분을 넘겼어도 그 집합이 유지될 수 있습니다

집계 Event를 만들었다고 이미 서버에 기록한 개별 Event들을 삭제하지는 않습니다
해당 관측의 전송 형태와 로컬 카운트에 사용할 키를 바꾸는 처리입니다
집계 뒤에는 메시지 집합의 항목 하나를 제거해 크기를 제한하므로, 이후 관측도 매번 그때의 집합과 시간 조건으로 판단합니다

이 값들은 기본값이며 호출자는 `CorrelatorOptions`로 집계·필터 동작을 바꿀 수 있습니다
클러스터 공통 설정 하나가 모든 기록기에 같은 값으로 적용된다는 뜻은 아닙니다
상세 분기는 [`EventAggregatorByReasonFunc`·`EventAggregate`·`populateDefaults`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/tools/record/events_cache.go)에 있습니다

### count를 먼저 올리므로 버린 관측도 다음 쓰기에 포함될 수 있다

집계가 끝나면 카운트 단계가 결과 Event를 로컬 캐시에 기록합니다
일반 Event는 전체 이벤트 키, 집계 Event는 집계키로 세므로 집계 결과도 반복 횟수를 가질 수 있습니다

그다음 spam filter가 이 관측을 서버로 보낼지 결정합니다
필터에서 버리더라도 앞에서 올린 로컬 카운트는 남습니다
캐시가 유지되고 이후 관측이 필터를 통과해 쓰기에 성공하면, 그동안 누적한 숫자를 서버에 반영할 수 있습니다

집계보다 카운트가 먼저라면 집계 전의 각 메시지를 따로 세게 됩니다
필터보다 카운트가 나중이라면 필터를 통과한 관측만 셉니다
현재 순서는 집계 결과를 세면서, 전송을 생략한 관측도 로컬 숫자에 포함하려는 구조입니다
이는 [`EventCorrelate`·`eventObserve`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/tools/record/events_cache.go)의 호출 순서로 확인할 수 있습니다

### spam filter는 이유가 달라도 같은 버킷을 쓴다

spam filter는 토큰 버킷을 사용합니다
버킷에 토큰이 있으면 하나를 사용해 통과시키고, 없으면 그 관측을 기다리지 않고 버리는 방식입니다

| 기본값 | 의미 |
|---|---|
| burst 25 | 토큰이 가득 찬 버킷에서 25건을 연속 허용할 수 있음 |
| 초당 보충률 QPS `1/300` | 300초당 토큰 하나를 보충 |

버킷 키는 `source`의 component·host, 대상의 종류·namespace·이름·UID·API version, `type`으로 구성합니다
`reason`·`message`·대상의 `fieldPath`는 포함하지 않습니다

같은 주체가 같은 Pod에 대해 같은 `type`으로 기록하면 이유가 달라도 버킷을 공유합니다
기존 실패로 토큰이 소진됐다면 다른 이유의 새 경고도 바로 버려질 수 있습니다
토큰을 한꺼번에 소진한 뒤에도 관측이 계속된다면 약 5분마다 토큰 하나가 보충됩니다
다만 화면에 Event가 나타나는 간격까지 정확히 5분으로 보장하는 것은 아닙니다
키와 동작은 [`getSpamKey`·`EventSourceObjectSpamFilter.Filter`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/tools/record/events_cache.go)에 정의돼 있습니다

## events 기록기는 셋째 관측부터 증가분을 메모리에 둔다

events 기록기는 같은 키의 첫 관측을 단발 Event로 전송하려고 합니다
두 번째 관측에서는 `series`를 만들고 `series.count`를 2로 설정해 다시 전송을 시도합니다
세 번째부터는 캐시의 카운트와 마지막 관측 시각만 갱신하고 그 자리에서는 쓰지 않습니다

| 같은 키의 관측 | 로컬 상태 | 그 관측에서의 즉시 전송 |
|---|---|---|
| 첫째 | `series` 없음 | 단발 Event 생성 시도 |
| 둘째 | `series.count: 2` | 시리즈 갱신 시도 |
| 셋째 이후 | `series.count`와 `lastObservedTime` 증가 | 없음 |

이는 한 로컬 시리즈가 이어지는 동안의 처리입니다
종료 처리로 캐시에서 사라진 뒤 다시 나타나거나 프로세스가 재시작하면 새 관측으로 시작할 수 있습니다
구현은 [`recordToSink`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/tools/events/event_broadcaster.go)에 있습니다

### 메모리의 카운트를 서버에 반영하는 두 경로

| 백그라운드 처리 | 기본 주기 | 처리 대상 |
|---|---|---|
| `refreshExistingEventSeries` | 30분 | 캐시에 있는 시리즈의 현재 상태를 서버에 기록 시도 |
| `finishSeries` | 6분 | 마지막 관측이 6분보다 오래된 시리즈를 마지막으로 기록 시도하고 캐시 정리 |

종료 검사는 6분마다 돌면서 마지막 관측 시각을 확인합니다
마지막 관측 후 정확히 6분이 되는 순간에 종료 쓰기가 실행된다는 뜻은 아닙니다
단발 Event도 충분히 오래되면 로컬 캐시에서 제거하지만, 이 처리가 서버 Event를 삭제하지는 않습니다

쓰기 실패는 오류 종류에 따라 재시도하거나 중단합니다
종료 처리에서는 쓰기에 성공했을 때뿐 아니라 **더 이상 재시도가 필요하지 않다는 결과**를 받았을 때도 캐시를 제거합니다
따라서 최종 숫자가 반드시 서버에 남는다고 보장할 수 없습니다
분기는 [`refreshExistingEventSeries`·`finishSeries`·`recordEvent`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/tools/events/event_broadcaster.go)에 있습니다

서버의 `series.count`는 다음 전송 전까지 프로세스 메모리의 숫자보다 작을 수 있습니다
정상적으로 계속 관측되는 시리즈도 주기적 반영은 기본 약 30분 간격입니다
쓰기 지연·실패가 있으면 이를 최대 반영 지연으로 보장할 수 없고, 프로세스가 죽으면 아직 보내지 않은 증가분을 잃습니다

이 구현에는 core 기록기와 같은 메시지 집계 단계나 spam filter가 없습니다
메시지를 키에서 빼고 같은 키의 반복을 시리즈로 묶어 매번 요청하지 않기 때문입니다
다만 관측마다 키가 달라지면 같은 시리즈로 묶을 수 없어 이 방식으로 전송 횟수를 줄이지는 못합니다

## 큐 입구의 대기와 처리기 채널의 드롭은 다른 문제다

두 기록기는 입구 큐와 처리기별 채널을 구분합니다
처리기별 채널은 서버 전송이나 로그 출력처럼 등록된 소비자에게 관측을 전달하는 큐입니다

| 지점 | core 기록기 | events 기록기 |
|---|---|---|
| 입구 큐 크기 | 1,000 | 25 |
| 입구가 가득 참 | 호출자의 `ActionOrDrop`이 관측을 버리고 로그 기록 | 별도 고루틴의 `Action`이 공간을 기다림 |
| 처리기별 채널 크기 | 1,000 | 1,000 |
| 처리기별 채널이 가득 참 | 해당 처리기에 전달하지 않음 | 해당 처리기에 전달하지 않음 |

core 기록기의 입구 드롭에는 다음 로그 문구가 남습니다

```text
Unable to record event: too many queued events, dropped event
```

호출자의 고루틴에서 큐 공간을 기다리면 이벤트 처리 지연이 컨트롤러의 조정 작업까지 막을 수 있습니다
그래서 core 구현의 주석은 과부하 시 이벤트를 버리는 선택을 설명합니다

events 구현은 별도 고루틴에서 큐에 넣으므로 `Eventf` 호출자는 그 큐 공간을 기다리지 않습니다
입구가 작아도 대기하는 고루틴이 쌓일 수 있으며, 작은 큐가 프로세스 전체의 대기 작업량까지 제한하는 것은 아닙니다

두 구현 모두 처리기 채널에는 `DropIfChannelFull` 정책을 사용합니다
한 처리기의 채널이 가득 차면 그 처리기는 관측을 받지 못할 수 있습니다
다른 처리기의 채널에 여유가 있다면 그쪽으로는 전달될 수 있습니다
이 드롭 분기 자체에는 로그나 전용 카운터가 없습니다
근거는 [`NewBroadcaster`·`NewLongQueueBroadcaster`·`ActionOrDrop`·`distribute`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/watch/mux.go)입니다

## kubectl describe의 숫자는 두 기준 중 하나다

core Event 타입은 `count`와 `series`를 모두 갖습니다
events Event 타입에는 `series`와 호환용 `deprecatedCount`가 있습니다
서버는 같은 저장소의 Event를 두 API 표현으로 변환할 수 있습니다

| 항목 | core 기록기의 `count` | events 기록기의 `series.count` |
|---|---|---|
| 세는 단위 | 일반 이벤트 키 또는 집계 결과의 키 | 메시지를 제외한 시리즈 키 |
| 처음 값 | 단발 Event의 `count`는 1 | 둘째 관측에서 2로 시작 |
| 단발일 때 | `count: 1` | `series` 없음 |
| 서버 반영 | 필터 통과 뒤 쓰기 성공 필요 | 첫째·둘째 관측, 주기 갱신·종료 쓰기 성공 필요 |

`kubectl describe`는 `series`가 있으면 그 카운트를 먼저 사용합니다
없고 `count`가 1보다 크면 `count`를 사용해 `(x12 over 5m)` 같은 반복 표시를 만듭니다
같은 화면의 두 Event가 서로 다른 기준으로 센 숫자를 보여줄 수 있습니다

어느 숫자도 클러스터의 전체 사건 수는 아닙니다
기록기에 전달되기 전이나 큐에서 빠진 관측은 세지 못하고, 카운트가 로컬에만 남아 있을 수도 있습니다
화면 처리의 근거는 [`DescribeEvents`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kubectl/pkg/describe/describe.go), 필드 대응은 [Event API 변환](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/events/v1/conversion.go)입니다

### 컴포넌트 이름만으로 모든 Event의 기록기를 확정할 수는 없다

현행 소스에서 확인한 대표 경로는 다음과 같습니다

| 기록 경로 | 사용하는 곳 |
|---|---|
| events 기록기 | [kube-proxy](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kube-proxy/app/server.go), API 서버의 [Service IP](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/service/ipallocator/controller/repair.go)·[포트 할당 복구 컨트롤러](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/service/portallocator/controller/repair.go) |
| events 기록기를 우선하는 adapter | kube-scheduler의 일반 이벤트 기록 |
| core 기록기 | kubelet 기본 기록기, [kube-controller-manager의 공통 이벤트 경로](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kube-controller-manager/app/controllermanager.go)와 Deployment 컨트롤러 |

kube-scheduler의 adapter는 events API 디스커버리가 성공하면 새 기록기를 사용하고, 그렇지 않으면 legacy 기록기로 돌아갑니다
같은 scheduler 안에서도 leader election용 기록기는 명시적으로 legacy 경로를 사용합니다
따라서 컴포넌트 하나가 오직 한 방식으로만 기록한다고 일반화하면 안 됩니다

스케줄 실패와 이미지 pull 실패가 같은 Pod 화면에 함께 나오더라도, 각각의 키와 전송 시점이 다를 수 있습니다
대표 근거는 [scheduler 설정](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kube-scheduler/app/options/options.go), [adapter 구현](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/tools/events/event_broadcaster.go), [kubelet 기록기](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kubelet/app/server.go), [Deployment 기록기](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/deployment/deployment_controller.go)입니다

## 전송을 기다리는 제한과 서버에서 거절하는 제한도 있다

kubelet은 이벤트 전송용 클라이언트를 별도로 만들고 여기에 `eventRecordQPS`와 `eventBurst`를 설정합니다
기본값은 각각 50과 100이며, `eventRecordQPS: 0`은 이 전송 제한을 끕니다
이는 관측을 즉시 버리는 core spam filter와 다른 층입니다

전송 클라이언트의 rate limiter는 토큰을 기다립니다
대기 context가 취소되면 오류로 끝날 수도 있으므로, 기다린다는 사실이 결국 전송에 성공한다는 보장은 아닙니다
설정과 기본값은 [`run`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kubelet/app/server.go)과 [kubelet 기본 설정](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/apis/config/v1beta1/defaults.go), 대기는 [`tryThrottleWithInfo`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/rest/request.go)에 있습니다

서버 쪽 `EventRateLimit` admission plugin은 이미 도착한 Event 생성·수정 요청을 제한합니다
v1.13 alpha로 소개됐고 현행 공식 문서에서도 기본 비활성으로 설명합니다
설정 가능한 버킷은 서버 전체, namespace, 사용자, source와 대상의 조합입니다

한도를 넘으면 관측을 로컬에서 생략하는 대신 서버가 `429 Too Many Requests`로 거절합니다
이 plugin은 dry-run 요청을 제한하지 않는 분기도 있습니다
근거는 [공식 admission 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/access-authn-authz/admission-controllers.md)와 [`EventRateLimit.Validate`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/plugin/pkg/admission/eventratelimit/admission.go)입니다

## Event의 수명은 관측 시각이 아니라 저장 쓰기와 연결된다

`--event-ttl`의 기본값은 1시간입니다
Event 저장소는 이 설정을 TTL로 반환하고, etcd 저장 구현이 실제 쓰기에 lease를 연결합니다
lease는 만료되면 연결된 키를 삭제하는 etcd의 수명 관리 수단입니다

[직렬화와 버전 변환](/essays/k8s-theory-serialization-version-conversion)에서 봤듯 core와 events API는 같은 Event 저장 구현을 사용합니다
따라서 조회 그룹을 바꿔도 별도의 보존 기간을 얻는 것은 아닙니다
TTL 설정은 [API 서버 옵션](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controlplane/apiserver/options/options.go), 저장 구현은 [core Event NewREST](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/event/storage/storage.go)와 [events API 등록](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/events/rest/storage_events.go)에 근거합니다

| 서버 요청 뒤의 결과 | TTL 처리 |
|---|---|
| 생성 또는 내용이 바뀌어 실제 저장 쓰기 | 조건에 맞는 lease 재사용 또는 새 lease 발급 후 연결 |
| 저장 바이트가 같고 변환 상태도 최신인 no-op | 쓰기를 생략하며 lease 처리도 생략 가능 |
| 전송 전 드롭 또는 저장 실패 | 그 관측으로 lease를 갱신하지 못함 |

`no-op`은 요청이 성공해도 저장할 내용이 같아 실제 쓰기를 생략하는 처리입니다
저장 변환이 최신인지 나타내는 `stale` 조건까지 봐야 하므로, 본문이 같다는 이유만으로 모두 no-op이 되는 것은 아닙니다
이 경계는 [저장 경로의 변환 층](/essays/k8s-theory-storage-transformations)에서 다뤘습니다

lease manager는 잔여 수명이 조건에 맞으면 앞서 발급한 lease를 재사용합니다
새 lease에도 재사용 여유 시간을 더하므로, 모든 PATCH 요청이 정확히 새 1시간을 시작한다고 표현할 수 없습니다
근거는 [`GuaranteedUpdate`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/etcd3/store.go)와 [`GetLease`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/etcd3/lease_manager.go)입니다

events 시리즈가 계속 관측되고 주기 갱신의 저장 쓰기가 성공하면 기본 1시간 TTL보다 짧은 30분 주기로 수명을 이어갈 수 있습니다
core 기록기도 필터를 통과한 관측의 저장 쓰기가 성공하면 lease를 다시 연결합니다
관측을 계속했어도 그것이 필터에서 버려지거나 쓰기에 실패했다면 해당 관측은 수명을 늘리지 못합니다

반대로 관측이 한 번 있었다는 이유만으로 Event가 영구히 남지는 않습니다
수명을 이어갈 저장 갱신이 없으면 연결된 lease가 만료될 때 Event가 사라집니다

## Event가 없다는 사실만으로 사건의 부재를 판단하지 않는다

| 보이는 현상 | 구분할 후보 |
|---|---|
| 같은 일이 반복되는데 Event는 하나 | 같은 이벤트 키나 시리즈 키로 묶였을 수 있음 |
| 메시지에 `combined from similar events`가 붙음 | core 기록기의 메시지 집계 |
| 다른 이유의 경고도 한동안 안 보임 | 같은 source·대상·type의 spam 버킷 공유 가능 |
| `series.count`가 기대보다 작음 | 아직 로컬 증가분을 전송하지 않았거나 전송 실패 |
| 재시작 뒤 숫자가 다시 시작함 | 프로세스의 카운트·시리즈 캐시 소실 |
| `too many queued events, dropped event` 로그 | core 기록기의 입구 큐 드롭 |
| Event도 없고 드롭 로그도 없음 | 처리기 채널 드롭 등 무기록 손실 가능. 이 증상만으로 원인 확정 불가 |
| 생성된 지 1시간 넘은 Event가 남아 있음 | 성공한 저장 갱신이 수명을 이어갔을 수 있음 |
| 문제가 계속되는데 Event가 사라짐 | lease를 이어갈 저장 갱신이 없었을 수 있음 |

같은 저장 Event를 다른 API 그룹으로 읽어도 보내는 쪽에서 버린 관측을 복원하지는 못합니다
Event는 관측을 압축하고 일부를 생략하는 기록이므로, 사건 자체의 부재와 기록 경로의 손실을 구분할 때 로그·상태·메트릭을 함께 확인해야 합니다
