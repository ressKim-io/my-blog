---
title: "resourceVersion — 오래된 상태로 덮어쓰는 일을 막는 번호"
excerpt: "etcd revision이 resourceVersion으로 전달되는 경로와 낙관적 동시성 제어를 살펴보고, API의 번호 검사와 저장소의 CAS 재시도를 구분합니다"
category: kubernetes
tags: [Kubernetes, etcd, resourceVersion, Concurrency, concept]
series:
  name: "k8s-theory-api"
  order: 6
date: "2026-07-31"
---

같은 Deployment를 두 작성자가 읽고 각각 수정하면, 나중에 저장한 내용이 앞의 변경을 덮을 수 있습니다
읽기·수정·쓰기 방식의 클라이언트는 조회 때 받은 `metadata.resourceVersion`을 갱신 요청에도 넣어 그 사이 변경이 있었는지 확인합니다

[Admission](/essays/k8s-theory-admission-order)의 판단을 받는 동안에도 다른 요청은 진행될 수 있습니다
요청 내용이 정책에 맞는지와, 자신이 읽은 상태를 기준으로 지금 덮어써도 되는지는 다른 문제입니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서, etcd v3.7 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 아래 번호는 설명을 위한 가정이며, 클러스터에서 재현한 실측값이 아닙니다

## 두 작성자가 같은 버전을 읽었을 때

A와 B가 모두 resourceVersion `100`인 Deployment를 읽었다고 가정하겠습니다
A가 먼저 변경을 저장했고 번호가 `104`로 바뀌었다면, B가 이전 번호 `100`을 넣어 갱신할 때 서버가 거부합니다

![같은 resourceVersion을 읽은 두 작성자 중 A가 먼저 갱신하고 B의 오래된 PUT이 409로 거부되는 순서](/diagrams/k8s-theory-resource-version-1.svg)

B가 A의 변경을 보존하려면 현재 상태를 다시 읽고 자기 변경을 다시 계산해야 합니다
오래된 본문에 최신 번호만 붙여 재전송하면 앞선 변경을 덮는 문제는 남을 수 있습니다

읽는 동안 오브젝트에 락을 유지하지 않고, 쓰는 시점에 충돌을 확인하는 방식을 **낙관적 동시성 제어**라고 합니다
충돌을 무시하는 것이 아니라, 충돌한 쪽이 현재 상태를 바탕으로 다시 작업하는 방식입니다

클라이언트가 읽는 동안 락을 잡는 설계라면 다른 작성자를 기다리게 하고, 락 소유자가 죽었을 때 회수하는 처리도 필요합니다
번호를 비교하면 읽는 동안 락을 유지하고 회수할 필요는 줄지만, 충돌한 클라이언트는 현재 상태를 읽어 변경을 다시 계산해야 합니다
서버 내부에서 락을 전혀 쓰지 않는다는 뜻은 아닙니다

번호가 같다는 것은 그 버전 검사만 통과했다는 뜻입니다
다른 검증과 저장도 성공해야 갱신이 끝납니다

## etcd revision은 같은 키 공간이 공유합니다

etcd의 revision은 키마다 독립적으로 매기는 번호가 아닙니다
하나의 etcd 키 공간을 바꾸는 원자적 연산마다 증가하며, 한 트랜잭션에서 여러 키를 바꾸면 같은 revision을 받습니다

| revision | 변경된 키의 예 |
|---|---|
| 101 | Pod a |
| 102 | Pod b |
| 103 | Pod a |
| 104 | ConfigMap x |

이 가정에서 Pod a는 101 다음에 103을 받습니다
중간에 다른 키가 바뀌었기 때문에 같은 오브젝트의 번호도 연속하지 않을 수 있습니다
이 설명은 **같은 etcd 키 공간**을 기준으로 합니다
리소스별 저장소를 달리 설정한 경우까지 클러스터 전체에 번호 하나가 있다고 확대하지는 않습니다

etcd에는 키가 수정된 횟수를 세는 `version`도 있습니다
새 키의 version은 1에서 시작하고, 키를 삭제하면 0이 됩니다
같은 키를 다시 만들어도 이전 version을 이어 쓰지 않습니다
Kubernetes의 resourceVersion이 사용하는 것은 이 키별 version이 아니라 revision입니다

이 구분은 [etcd v3.7 데이터 모델](https://etcd.io/docs/v3.7/learning/data_model/)과 [revision의 API 보장](https://etcd.io/docs/v3.7/learning/api_guarantees/#revision)에 설명돼 있습니다
확인한 Kubernetes [go.mod](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/go.mod)의 etcd 의존성은 v3.7.0입니다
이 버전 확인은 실제 클러스터에 설치된 etcd 버전을 뜻하지 않습니다

## 객체의 번호와 LIST의 번호는 다릅니다

| 필드 위치 | 의미 |
|---|---|
| `ObjectMeta.resourceVersion` | 그 객체가 마지막으로 변경된 버전 |
| `ListMeta.resourceVersion` | 목록이 구성된 버전 |

별도의 예로, LIST 응답 전체의 번호가 `104`이고 안의 Pod a는 `101`, Pod b는 `103`일 수 있습니다
104 시점의 목록에 들어 있다고 모든 객체가 그 시점에 변경된 것은 아닙니다

etcd 저장 경로는 객체를 읽을 때 키의 `ModRevision`을 디코더에 넘깁니다
목록에는 snapshot revision을 넣고, 각 항목에는 각 키의 ModRevision을 넣습니다
객체와 목록의 번호가 다른 이유입니다

API 서버의 [`store.Get`·목록 디코딩](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/etcd3/store.go)과 [`APIObjectVersioner`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/api_object_versioner.go)에서 이 연결을 확인했습니다

## 번호를 생략하면 리소스마다 결과가 다릅니다

모든 Update가 resourceVersion 생략을 같은 방식으로 처리하지는 않습니다
리소스별 갱신 규칙인 update strategy가 resourceVersion을 생략한 무조건 갱신을 허용하는지에 따라 달라집니다

| 일반 Update의 `metadata.resourceVersion` | 무조건 갱신을 허용하는 리소스 | 허용하지 않는 리소스 |
|---|---|---|
| 생략 또는 `"0"` | 현재 번호를 채우고 검증 진행 | `422 Invalid` |
| 현재와 같은 양수 번호 | 버전 검사 통과 | 버전 검사 통과 |
| 현재와 다른 양수 번호 | `409 Conflict` | `409 Conflict` |

확인한 구현에서 Deployment의 일반 Update는 무조건 갱신을 허용합니다
CRD로 정의한 custom resource는 허용하지 않습니다
CRD는 Kubernetes API에 새로운 리소스 종류를 정의하는 기능이며, 여기서 말하는 것은 그 정의로 만든 실제 객체입니다

Deployment에 오래된 본문을 번호 없이 통째로 보내면 다른 작성자의 변경을 덮을 수 있습니다
custom resource에서 번호를 생략하면 `must be specified for an update` 오류가 납니다
양수 번호가 있는데 현재 값과 다르면 두 경우 모두 충돌입니다

이 표는 **갱신 본문의** `metadata.resourceVersion`에 관한 설명입니다
GET·LIST query의 `resourceVersion=0`은 얼마나 최신 상태를 읽을지 정하는 별도의 옵션입니다
둘을 같은 “검사 생략”으로 묶어 해석하면 안 됩니다

분기는 [`Store.Update`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/registry/generic/registry/store.go)에 있습니다
[`deploymentStrategy`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/apps/deployment/strategy.go)와 [`customResourceStrategy`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/registry/customresource/strategy.go)의 `AllowUnconditionalUpdate` 반환값도 대조했습니다

## resourceVersion 검사 뒤에도 etcd의 CAS가 필요한 이유

API 서버가 요청 번호와 현재 번호를 비교한 직후에도 다른 API 서버가 저장할 수 있습니다
그래서 저장소에 실제로 쓸 때도 조건을 확인해야 합니다

CAS(compare-and-swap)는 비교한 상태가 여전히 맞을 때만 갱신하는 처리입니다
Kubernetes의 etcd 저장 경로는 읽은 키의 `ModRevision`을 쓰기 조건으로 전달합니다

![클라이언트의 버전을 검사한 뒤 etcd의 ModRevision 조건으로 저장하고 충돌 시 현재 상태로 갱신 함수를 재실행하는 흐름](/diagrams/k8s-theory-resource-version-2.svg)

1. API의 번호 검사는 클라이언트가 읽은 뒤 생긴 변경을 확인합니다
2. etcd의 조건부 쓰기는 API 서버가 저장할 상태를 읽은 뒤 생긴 변경을 확인합니다
3. etcd 비교가 실패하면 현재 상태를 받아 서버 내부에서 갱신 함수를 다시 실행합니다
4. 다시 실행하는 동안 클라이언트가 보낸 번호가 현재 번호와 다르다고 확인되면 API 계층에서 409를 반환할 수 있습니다

서버 내부 재시도가 클라이언트의 충돌을 없애 주지는 않습니다
현재 상태를 기준으로 사용자의 변경을 어떻게 다시 계산할지는 클라이언트가 처리해야 합니다

저장할 바이트가 기존 값과 같고 저장 형식을 갱신할 필요도 없다면 실제 쓰기를 생략할 수 있습니다
따라서 성공한 Update마다 반드시 새 번호가 생기는 것도 아닙니다
이 조건과 재시도 루프는 [`GuaranteedUpdate`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/etcd3/store.go)에 있습니다

## 번호의 크기를 비교할 수 있는 범위

갱신 충돌 검사는 받은 번호와 현재 번호가 같은지를 봅니다
번호의 크기로 순서를 판단하는 것은 별도의 API 계약입니다

v1.35부터 kube-apiserver가 제공하는 내장 리소스와 CRD 기반 리소스는 **같은 API group·resource 안에서** resourceVersion을 정수 순서로 비교할 수 있습니다
서로 다른 namespace의 Deployment 두 개는 비교할 수 있지만, Pod와 Deployment의 번호를 비교하는 것은 이 계약에 포함되지 않습니다
v1.35 이전에는 같은 값인지만 확인하고 내부 형식이나 숫자 크기에 의미를 부여하지 않는 opaque 문자열로 다뤘습니다
이전의 설명을 현재 비교 규칙과 구분해야 합니다

비교할 값은 첫 자리가 1~9이고 나머지가 0~9인 양의 10진수 문자열이어야 합니다
선행 0이나 부호는 허용하지 않습니다
빈 문자열과 `"0"`은 요청에서 별도 의미가 있으므로 이 비교 대상이 아닙니다

고정된 비트 수 안에 들어간다고 가정하지 않고, 자릿수에 맞춰 크기를 늘릴 수 있는 임의 정밀도 정수로 처리해야 합니다
문자열로 비교한다면 길이가 긴 쪽이 크고, 길이가 같을 때 사전순으로 비교할 수 있습니다
예를 들어 `"123"`은 `"23"`보다 크고, 같은 길이의 `"234"`는 `"123"`보다 큽니다

별도의 aggregated API server가 제공하는 리소스는 번호가 이 10진수 형식인지 확인해야 합니다
해석할 수 없다면 값이 같은지만 비교하고 순서를 가정하지 않습니다
서버에 돌려줄 때는 받은 resourceVersion을 변경하지 않고 그대로 사용합니다

같은 저장소에서 번호가 만들어진다는 구현 설명보다 **API가 보장한 비교 범위**를 따라야 합니다
공식 [API Concepts](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/using-api/api-concepts.md#resource-versions)와 [`CompareResourceVersion`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/util/resourceversion/resourceversion.go)에서 이 조건을 확인했습니다
이 순서 비교 성질은 v1.35부터 Kubernetes 적합성 시험의 요구사항에도 포함됩니다

## 오래된 번호를 언제까지 사용할 수 있을까

etcd는 이전 버전의 값을 이력으로 남깁니다
이 이력은 과거 revision을 조회하거나 watch로 이전 변경을 이어 받을 때 쓰입니다
계속 보관하면 저장 공간이 늘어나므로 compaction으로 오래된 이력을 정리합니다

kube-apiserver의 `--etcd-compaction-interval` 기본값은 `5m0s`입니다
이는 compaction 요청 주기이며, 모든 watch가 언제나 정확히 5분의 이력을 되찾는다는 보장은 아닙니다
설정이 0이면 API 서버가 보내는 주기적 compaction 요청을 끕니다

| 증상 | 구분할 조건 |
|---|---|
| Update의 409 | 요청 번호가 현재 객체와 다름 |
| Update의 422 | 번호가 필요하지만 생략하거나 0을 보냄 |
| 읽기·watch의 410 | 서버가 요청한 과거 버전·이력을 더 이상 제공하지 못함 |
| GET·LIST의 504 | 요청한 번호를 제한 시간 안에 제공하지 못함 |

충돌의 대표 메시지는 다음과 같습니다

```text
the object has been modified; please apply your changes to the latest version and try again
```

미래 번호를 요청했을 때는 다음 메시지와 함께 504가 올 수 있습니다

```text
Too large resource version: N, current: M
```

오래된 번호를 썼다고 모든 읽기가 410으로 끝나지는 않습니다
LIST의 `resourceVersionMatch=NotOlderThan`은 지정 번호보다 새로운 상태로 응답할 수 있습니다
watch에서 미래 번호를 요청한 경우에는 timeout까지 기다릴 수도 있습니다
요청 종류와 읽기 조건을 함께 봐야 합니다

compaction 기본값은 [저장소 설정](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/storagebackend/config.go)과 [kube-apiserver 옵션](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/)을 대조했습니다
410·504의 계약은 위 API Concepts의 응답 조건을 따릅니다

## etcd lease와 Kubernetes Lease는 다릅니다

etcd lease는 키에 만료 시간을 연결합니다
만료되면 연결된 키가 사라집니다
`--event-ttl`의 기본값 `1h0m0s`가 적용되는 Event가 그 사용 사례입니다
이 만료 경로에서는 controller가 객체 삭제 요청을 보내는 대신 etcd lease가 키의 수명을 정합니다

반면 `coordination.k8s.io/v1`의 `Lease`는 leader election 등에 사용하는 API 오브젝트입니다
controller가 이 객체를 직접 갱신하며, etcd lease와 같은 것은 아닙니다
같은 resourceVersion을 읽은 두 후보가 서로 다른 값을 일반 Update로 저장하려 하면 앞서 본 충돌 검사를 거칩니다

Event마다 새 etcd lease를 만들면 lease 관리 부담도 늘어납니다
그래서 만료 시점이 비슷한 키는 lease를 재사용합니다
lease를 재사용할 수 있는 만료 시점의 차이는 기본적으로 TTL의 5%와 60초 중 작은 값입니다
기본 재사용 카운트 한도는 1000입니다
이 카운트는 성공한 객체 수만 세는 것이 아니라 실패한 시도도 포함합니다

정확한 기본값과 재사용 조건은 [`leaseManager.GetLease`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/etcd3/lease_manager.go), Event의 TTL 전달은 [Event 저장 구현](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/event/storage/storage.go)에서 확인했습니다

resourceVersion은 이번 글에서는 오래된 갱신을 막는 비교값이었습니다
watch에서는 이미 본 변경 뒤부터 이어 받기 위한 커서로도 쓰입니다
그때는 번호가 같은지뿐 아니라, 해당 번호 이후의 이력을 서버가 아직 제공할 수 있는지가 문제가 됩니다
