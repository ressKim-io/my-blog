---
title: "watch와 410 Gone — 놓친 변경은 커서만 옮겨 복구할 수 없습니다"
excerpt: "LIST와 watch를 잇는 resourceVersion, watch cache의 이력과 BOOKMARK를 살펴보고, 410 이후에 현재 상태를 다시 받아야 하는 이유를 설명합니다"
category: kubernetes
tags: [Kubernetes, Watch, resourceVersion, etcd, concept]
series:
  name: "k8s-theory-api"
  order: 7
date: "2026-08-02"
---

컨트롤러가 Pod 목록을 한 번 읽었다고 현재 상태를 계속 아는 것은 아닙니다
그 뒤에 생기거나 바뀌거나 삭제된 Pod도 로컬 사본에 반영해야 합니다

watch는 이런 변경을 이어 받는 요청입니다
앞서 살펴본 [resourceVersion](/essays/k8s-theory-resource-version)은 여기서 어느 시점 이후의 변경을 받을지 가리키는 커서로 쓰입니다
그런데 서버가 그 이후의 이력을 이미 버렸다면, 커서만 최신 번호로 옮겨서는 로컬 사본을 바로잡을 수 없습니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 번호와 객체 수가 들어간 상황은 설명을 위한 가정이며, 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## 목록의 번호로 이후 변경을 이어 받습니다

현재 상태를 유지하려는 클라이언트는 먼저 LIST로 한 시점의 목록인 snapshot을 받습니다
그 목록의 `ListMeta.resourceVersion`을 watch에 넘기면 해당 시점 이후의 변경을 받을 수 있습니다

![LIST로 만든 로컬 사본을 watch로 갱신하고 이력이 사라지면 전체 snapshot을 다시 받는 흐름](/diagrams/k8s-theory-watch-1.svg)

LIST와 watch는 같은 리소스 범위와 selector를 사용해야 합니다
selector는 라벨이나 필드 조건으로 관심 대상을 고르는 필터입니다
목록을 받을 때와 변경을 받을 때 대상이 다르면 하나의 상태로 이어 붙일 수 없습니다

예를 들어 LIST의 번호가 `100`이면, 양수 번호 `100`으로 연 일반 watch는 그 뒤의 변경만 보냅니다
이미 있던 Pod 500개가 전혀 바뀌지 않았다면 이 watch에 초기 상태로 나타나지 않습니다
클라이언트가 이미 100 시점의 상태를 갖고 있다고 보기 때문입니다

LIST 처리와 watch 연결 사이에 일어난 변경도 서버에 이력이 남아 있으면 받을 수 있습니다
이력이 없다면 서버는 `410 Gone`으로 그 지점부터 이어 갈 수 없음을 알립니다
별도의 LIST 없이 초기 상태를 watch에서 받는 streaming list는 뒤에서 구분합니다

## watch의 빈 번호와 양수 번호는 의미가 다릅니다

공식 API 문서는 `sendInitialEvents`를 지정하지 않은 watch의 시작점을 다음처럼 구분합니다

| `resourceVersion` | 문서에 정의된 시작점 | 초기 상태 |
|---|---|---|
| 미지정 | 최신의 일관된 시점 | 합성 `ADDED` 이벤트로 전달 |
| `"0"` | 임의 시점 | 합성 `ADDED` 이벤트로 전달 |
| 양수 번호 | 지정한 시점 다음부터 | 전달하지 않음 |

합성 `ADDED`는 그때 객체가 새로 생성됐다는 뜻이 아닙니다
이미 존재하는 객체들을 초기 상태로 전달하기 위해 만든 이벤트입니다

다만 **v1.37.1의 legacy watch에는 문서 설명과 다른 분기가 남아 있습니다**
watch cache가 켜진 경로에서 번호가 비어 있고 `sendInitialEvents`도 미지정이면, 캐시에 요구하는 신선도 번호를 0으로 둡니다
현재 캐시 상태를 합성 `ADDED`로 보내지만 이 분기에서 저장소의 최신 revision을 확인하지는 않습니다

반면 `sendInitialEvents=true`와 `resourceVersionMatch=NotOlderThan`을 지정하고 번호를 비우면, 저장소의 현재 revision까지 캐시가 따라잡도록 기다립니다
빈 번호를 사용하는 두 요청이 같은 신선도 확인 경로를 타는 것은 아닙니다

문서의 [watch 의미론](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/using-api/api-concepts.md#semantics-for-watch)과 구현의 [`getWatchCacheResourceVersion`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/cacher/cacher.go), [`getAllEventsSinceLocked`의 초기 상태 분기](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/cacher/watch_cache.go)를 나눠 확인해야 합니다

## 최근 변경 이력은 API 서버마다 따로 유지합니다

클라이언트마다 etcd에 watch를 직접 열면 연결과 이벤트 처리 부담이 늘어납니다
API 서버는 이를 줄이기 위해 **watch cache**를 둡니다
리소스 타입별로 전체 객체의 메모리 사본과 최근 변경 이력을 유지하고, 저장소에서 받은 변경을 여러 클라이언트에게 나눠 보냅니다

![etcd의 변경을 각 API 서버가 받아 자신의 객체 캐시와 이벤트 이력을 유지하고 여러 클라이언트에게 전달하는 구조](/diagrams/k8s-theory-watch-2.svg)

고가용성 구성의 API 서버 A와 B는 같은 리소스를 보더라도 각자 캐시를 유지합니다
따라서 API 서버 인스턴스가 늘면 해당 리소스의 저장소 watch도 늘어납니다
캐시를 끈 리소스는 이 공유 경로를 쓰지 않고 저장소 watch로 처리합니다

객체 사본과 최근 이벤트 이력은 구분해야 합니다
객체 사본은 현재 상태를 담고, 이벤트 이력은 그 상태에 이르기까지 최근에 어떤 변경이 있었는지 담습니다
최근 이벤트는 정해진 용량 안에서 오래된 항목을 밀어내는 링버퍼에 저장합니다

기본 설정의 이벤트 버퍼는 100개 용량에서 시작하고 필요하면 두 배씩 늘어나며, 상한은 102,400개입니다
이력 기간을 길게 설정하면 상한도 그에 맞춰 커집니다
v1.37.1에서도 `--default-watch-cache-size`는 deprecated이며 버퍼 크기는 자동 조정합니다

이 숫자는 객체 사본의 최대 개수가 아닙니다
가령 Pod가 5만 개라면, 그 리소스 캐시를 유지하는 API 서버 인스턴스마다 Pod 5만 개의 사본을 메모리에 둡니다
etcd의 반복 읽기를 줄이는 대신 API 서버 메모리를 사용하는 구조입니다

기본 용량과 조정 조건은 [`watchCacheHistory`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/cacher/watch_cache_history.go), 플래그 상태는 [etcd 옵션 등록](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/options/etcd.go)에서 확인했습니다

## 75초는 모든 이벤트의 보존을 보장하는 시간이 아닙니다

버퍼 크기를 조정하는 기본 이력 기준은 75초입니다
최근 이벤트가 빠르게 쌓이면 용량을 늘려 이 기간의 이력을 유지하려고 합니다
하지만 상한에서 버퍼가 가득 차면 75초가 지나지 않은 이벤트도 오래된 순서대로 밀려납니다

API 서버가 재시작되거나 캐시가 다시 초기화되어도 이전 이벤트 이력은 사라질 수 있습니다
따라서 “75초 안에 재접속하면 항상 이어 받을 수 있다”는 보장은 아닙니다

이력 기준과 BOOKMARK의 기본 주기는 연결되어 있습니다
BOOKMARK는 관심 객체가 바뀌지 않았더라도 watch가 어느 번호까지 진행됐는지 알려 주는 이벤트입니다

| 값 | 기본 시간 | 역할 |
|---|---|---|
| `defaultBookmarkFrequency` | 60초 | BOOKMARK 전송을 시도하는 기본 주기 |
| `DefaultEventFreshDuration` | 75초 | 이벤트 버퍼 크기를 조정할 때 사용하는 이력 기준 |
| 두 값의 차이 | 15초 | 마지막 BOOKMARK 번호로 재접속할 여유 |

이력 기간이 BOOKMARK 주기보다 짧다면, 다음 BOOKMARK를 받기 전에 이전 커서가 보존 범위를 벗어날 가능성이 커집니다
15초의 차이는 이 상황을 줄이기 위한 여유입니다
전송 지연·재접속 지연·버퍼 상한·캐시 재초기화까지 없애 주지는 않습니다

이 값과 의도는 [`cacher.go`의 기본 상수](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/cacher/cacher.go)에 명시돼 있습니다

## LIST의 신선도와 응답을 만드는 장소는 별개입니다

GET과 LIST의 `resourceVersion`은 어느 시점까지 반영된 데이터를 요구하는지 정합니다
GET은 번호 미지정이면 Most Recent, `"0"`이면 Any, 양수 번호이면 Not Older Than으로 해석합니다
GET에는 `resourceVersionMatch` 파라미터가 없습니다

LIST에서는 `resourceVersionMatch`로 특정 시점의 Exact와 그보다 오래되지 않은 NotOlderThan을 구분합니다
이 파라미터는 v1.19부터 지원되며, LIST에 번호를 넣을 때는 함께 지정하는 것이 권장됩니다

| LIST의 의미 | 요청 형태 | 처리 경로 |
|---|---|---|
| Any | `resourceVersion=0` | 준비된 watch cache에서 응답 가능. 캐시 비활성·일부 미준비 경로에서는 저장소 사용 |
| Most Recent | 번호와 match 모두 미지정 | 저장소 기준의 일관된 읽기. progress 지원 등 조건을 만족하면 캐시에서 목록 구성 |
| Not Older Than | 양수 번호와 `resourceVersionMatch=NotOlderThan` | 캐시가 요구한 번호까지 따라잡은 뒤 응답 가능 |
| Exact | 양수 번호와 `resourceVersionMatch=Exact` | 해당 시점의 snapshot을 사용하고, 캐시에 없으면 저장소로 폴백. 어느 쪽에도 없으면 410 |
| Continuation | `continue=<token>` | 첫 페이지에서 정한 시점을 유지해 다음 페이지 반환 |

번호만 넣고 `resourceVersionMatch`를 생략하면 `limit`이 없는 요청은 Not Older Than, `limit`이 있는 첫 요청은 Exact로 해석합니다
여기서 보장하는 번호는 목록 전체의 `ListMeta.resourceVersion`입니다
목록 속 모든 객체가 그 시점에 수정됐다는 뜻은 아닙니다

`NotOlderThan`을 사용하더라도 `limit`으로 페이지를 나누면 410 처리가 필요합니다
공식 문서는 이 조합에서도 410이 발생하면 더 새 번호나 빈 번호로 다시 읽도록 안내합니다

Any는 이전에 읽은 상태보다 최신이라는 보장도 없습니다
API 서버 인스턴스마다 캐시가 따라잡은 시점이 다를 수 있으므로, 다른 인스턴스에서 더 오래된 상태를 받을 수 있습니다

### 일관된 LIST도 캐시에서 응답할 수 있습니다

API 서버가 저장소의 현재 revision을 얻고 캐시가 그 지점까지 따라잡았다면, 객체 목록 전체는 캐시에서 구성할 수 있습니다
이때 etcd의 **progress notification**으로 저장소 watch가 어디까지 진행했는지 확인합니다
클라이언트에게 보내는 BOOKMARK와 달리 API 서버와 etcd 사이에서 사용하는 신호입니다

이 요청을 항상 보내는 것은 아닙니다
캐시가 신선해지기를 기다리는 요청이 있을 때 100ms 주기로 progress를 요청합니다
저장소가 이 기능을 지원하는지도 확인합니다

`ListFromCacheSnapshot`은 v1.37.1에서도 beta·기본 활성입니다
이 기능 덕분에 Exact와 Continuation LIST도 캐시 snapshot에서 응답할 수 있습니다
필요한 snapshot이 없으면 저장소로 폴백하며, 저장소에서도 그 시점을 읽을 수 없으면 410을 반환합니다

캐시가 요구한 번호까지 제한 시간 안에 따라잡지 못한 일관된 LIST도 기본적으로 저장소로 폴백합니다
다만 v1.37에 추가된 `ConsistentListFromCacheSkipTimeoutFallback`은 alpha·기본 비활성입니다
이를 켜면 이 대기 실패에서 저장소로 폴백하는 대신 `429 Too Many Requests`를 반환합니다

**GET의 빈 번호 요청은 같은 경로가 아닙니다**
v1.37.1 `CacheDelegator.Get`은 번호가 비어 있으면 저장소에 직접 위임합니다
문서가 GET·LIST의 의미를 함께 설명한다고 해서, 두 요청의 실제 응답 경로까지 같다고 해석하면 안 됩니다

근거는 [GET·LIST 위임과 폴백](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/cacher/delegator.go), [LIST 조건 판정](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/cacher/delegator/interface.go), [progress 요청](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/cacher/progress/watch_progress.go), [gate 이력](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/features/kube_features.go)입니다

## 410 이후 번호만 건너뛰면 삭제된 객체가 남을 수 있습니다

클라이언트가 `105` 시점까지 반영했고 서버는 `140`까지 진행했다고 가정하겠습니다
그 사이 Pod a가 삭제됐는데 해당 이력을 잃었다면, 클라이언트의 로컬 사본에는 Pod a가 그대로 남습니다
140부터 watch를 새로 열어도 과거의 삭제 이벤트가 다시 전달되지는 않습니다

수정 이벤트를 놓친 객체는 나중에 다시 바뀔 때 그 상태를 받아 따라잡을 수 있습니다
그러나 이미 삭제된 객체는 이후 변경 이벤트를 만들지 않습니다
따라서 **새 전체 snapshot을 받고 이전 로컬 사본과 비교해야 합니다**
전에 있었지만 새 목록에 없는 키를 제거하면 현재 상태를 바로잡을 수 있습니다

이것은 빠진 과거 이벤트를 모두 복원하는 일과 다릅니다
현재 상태에 다시 맞추는 일입니다

### 410이 발생한 층은 오류 문구로 구분할 수 있습니다

| 오류 문구 | 발생 경로 | 의미 |
|---|---|---|
| `too old resource version: 105 (120)` | API 서버 watch cache | 요청 번호가 재개 가능한 하한보다 낮음. 괄호 안은 `oldest-1` |
| `The resourceVersion for the provided watch is too old.` | etcd watch 오류 변환 | 요청 revision이 compaction으로 제거됨 |

첫 번째 예시에서 120이 가장 오래된 이벤트 번호 자체라는 뜻은 아닙니다
또한 캐시의 정상적인 버퍼 순환이나 재초기화로도 발생하므로, 이 오류만으로 메모리 부족이라고 단정할 수 없습니다

etcd compaction과 API 서버의 이벤트 링버퍼는 서로 다른 이력입니다
etcd가 오래된 revision을 정리해도 API 서버가 이미 받은 이벤트가 즉시 함께 지워지는 것은 아닙니다
따라서 compaction 한 번에 모든 클라이언트가 동시에 410을 받는 것도 아닙니다

오류의 생성 위치는 [`GetIntervalLocked`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/cacher/watch_cache_history.go)와 [`interpretWatchError`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/etcd3/errors.go)입니다

## Reflector는 오류가 난 요청에 따라 다시 읽는 방법을 고릅니다

Reflector는 서버에서 받은 목록과 변경을 클라이언트의 로컬 사본에 반영하는 client-go 구성요소입니다
v1.37.1에서는 `WatchListClient`가 beta·기본 활성입니다
클라이언트가 지원하면 streaming list로 초기 상태를 받을 수 있고, 일반 LIST 뒤에 watch를 여는 경로도 남아 있습니다

| 경로와 조건 | 다음 초기 상태 요청 |
|---|---|
| 일반 LIST 경로의 최초 동기화 | `resourceVersion="0"` |
| 일반 watch에서 410 발생 후 일반 LIST로 복구 | 마지막 관찰 번호를 유지해 LIST 시도 |
| 그 LIST에서 번호 만료 또는 너무 큰 번호 오류 | 번호를 사용할 수 없다고 기록하고 `resourceVersion=""`로 LIST 재시도 |
| streaming list 초기화 중 번호 만료 또는 너무 큰 번호 오류 | 번호를 사용할 수 없다고 기록하고 빈 번호의 streaming list로 재시도 |

일반 watch에서 410을 받았다는 이유만으로 마지막 번호를 즉시 지우지는 않습니다
그 번호 이상으로 신선한 목록은 여전히 받을 수 있기 때문입니다
일반 LIST 경로에서는 해당 번호를 사용한 LIST도 실패할 때 빈 번호로 폴백합니다

streaming list는 `sendInitialEvents=true`, `resourceVersionMatch=NotOlderThan`을 사용합니다
현재 객체들을 합성 `ADDED`로 받고, `allowWatchBookmarks=true`이면 초기 상태의 끝에 완료 BOOKMARK를 받습니다
이 BOOKMARK에는 `k8s.io/initial-events-end: "true"` annotation이 붙습니다
이후에는 같은 스트림으로 변경을 이어 받습니다

서버의 `WatchList`도 v1.37.1 기준 beta·기본 활성입니다
v1.32에서 기본 활성화됐다가 v1.33에서 기본 비활성으로 바뀌었고, v1.34부터 다시 기본 활성화된 이력이 있습니다
client-go 쪽 gate와 서버 쪽 gate는 구분해야 합니다

빈 번호로 전체 상태를 다시 읽더라도 반드시 etcd에서 객체 목록 전체를 가져오는 것은 아닙니다
앞서 설명한 일관된 캐시 읽기가 응답할 수도 있습니다
하지만 전송·직렬화·로컬 사본 교체는 다시 필요하므로, 여러 클라이언트가 함께 초기화하면 그 비용이 겹칠 수 있습니다

복구 분기는 [`Reflector.ListAndWatchWithContext`·`list`·`watchList`·`relistResourceVersion`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/tools/cache/reflector.go), 클라이언트 gate는 [`known_features.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/features/known_features.go)에서 확인했습니다

## BOOKMARK는 변경이 없어도 재개 번호를 앞으로 옮깁니다

`app=web`만 보는 watch에서 해당 라벨의 객체가 한동안 바뀌지 않았다고 가정하겠습니다
같은 리소스의 다른 객체들은 계속 바뀌므로 서버의 이벤트 이력은 밀려나는데, 이 클라이언트가 마지막으로 받은 번호는 오래된 값에 머물 수 있습니다

BOOKMARK는 이때 spec·status 없이 `metadata.resourceVersion`으로 진행 지점을 알립니다
아래는 번호만 보여 주기 위한 예시입니다

```json
{"type":"BOOKMARK","object":{"metadata":{"resourceVersion":"900"}}}
```

실제 전송에는 kind·apiVersion도 포함될 수 있고, streaming list 완료 BOOKMARK에는 앞서 설명한 annotation도 붙습니다
일반 BOOKMARK는 초기 snapshot을 새로 주거나 객체 상태를 바꾸는 이벤트가 아닙니다

여기서 관심을 두는 것은 **같은 리소스 캐시 안의 변경**입니다
다른 리소스의 etcd 쓰기로 전체 revision이 증가하더라도 그 사실만으로 이 리소스의 이벤트 링버퍼가 차는 것은 아닙니다

BOOKMARK를 요청하려면 `allowWatchBookmarks=true`를 지정합니다
다만 [공식 API 계약](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/using-api/api-concepts.md#watch-bookmarks)은 BOOKMARK 수신 자체나 일정한 전송 간격을 보장하지 않습니다
기본 주기가 60초라는 구현값을 클라이언트의 보장으로 사용하면 안 됩니다

BOOKMARK는 이력이 남아 있을 때 이어 받을 가능성을 높여 주지만, 전체 상태를 다시 받아야 하는 상황까지 없애지는 않습니다
마지막 BOOKMARK 번호에서도 410을 처리할 수 있어야 합니다
