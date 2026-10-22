---
title: "컨트롤 플레인 이중화 — etcd·API 서버·컨트롤러의 다른 역할"
excerpt: "같은 노드 장애도 etcd의 quorum, API 서버의 요청 처리, 컨트롤러의 리더 선출에 서로 다른 영향을 줍니다. 캐시 읽기의 조건과 인스턴스별 APF 용량, Lease의 용도를 나눠 살펴봅니다"
category: "kubernetes"
tags: ["Kubernetes", "etcd", "HighAvailability", "LeaderElection", "APF", "concept"]
series:
  name: "k8s-theory-api"
  order: 20
date: "2026-10-23"
---

컨트롤 플레인을 여러 인스턴스로 구성했다고 해서 모든 구성요소가 같은 방식으로 장애를 견디는 것은 아닙니다
etcd는 저장할 내용을 합의하고, API 서버는 요청을 나눠 처리하며, 컨트롤러는 리더 선출로 조정 작업을 맡을 인스턴스를 고릅니다

etcd 멤버와 API 서버를 함께 둔 노드 하나가 멈췄다고 가정하면 이 차이가 드러납니다
저장소에는 과반이 남았는지, 요청은 다른 API 서버로 갈 수 있는지, 조정 작업은 누가 이어받는지를 각각 확인해야 합니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서, etcd v3.6 공식 문서를 바탕으로 설명합니다
> Kubernetes 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## 노드 하나의 장애가 세 역할에 영향을 줍니다

etcd 멤버와 컨트롤 플레인 구성요소를 같은 호스트에 두는 구성을 stacked topology라고 합니다
이 구성에서 호스트 하나가 멈추면 etcd의 투표 멤버와 API 서버 인스턴스를 함께 잃습니다
그 호스트에서 컨트롤러 리더도 실행 중이었다면 리더 교체가 필요합니다

![같은 호스트의 장애를 etcd 과반 유지, API 서버 요청 분배, 컨트롤러 Lease 리더 교체로 나누어 확인하는 흐름](/diagrams/k8s-theory-control-plane-high-availability-1.svg)

API 서버 하나가 살아 있다는 사실만으로 요청 성공을 판단할 수는 없습니다
앞단 로드 밸런서가 그 인스턴스로 요청을 보내야 하고, 저장소를 사용하는 요청이라면 공유 etcd도 필요한 응답을 할 수 있어야 합니다

반대로 컨트롤러 리더가 바뀌는 동안에도 API 서버가 요청을 계속 처리할 수 있습니다
요청 접수와 저장, 저장된 상태를 읽고 실제 상태를 맞추는 반복 조정은 서로 다른 작업입니다

## etcd는 투표 멤버의 과반으로 상태를 확정합니다

etcd는 Raft라는 합의 알고리즘으로 로그를 복제하고 쓰기를 확정합니다
투표 멤버가 `n`개라면 필요한 과반, 즉 quorum은 `floor(n / 2) + 1`입니다
여기서 세는 것은 Kubernetes 노드나 API 서버 수가 아니라 etcd의 투표 멤버 수입니다

| 투표 멤버 | quorum | quorum을 유지하며 잃을 수 있는 멤버 |
|---|---:|---:|
| 1 | 1 | 0 |
| 2 | 2 | 0 |
| 3 | 2 | 1 |
| 4 | 3 | 1 |
| 5 | 3 | 2 |
| 7 | 4 | 3 |
| 9 | 5 | 4 |

3개에서 4개로 늘리면 필요한 표는 2에서 3으로 늘지만 장애 허용 수는 여전히 1개입니다
홀수 구성이 같은 장애 허용 수를 더 적은 멤버로 얻는 이유입니다
네트워크가 두 그룹으로 갈릴 때도 홀수면 정확히 반반으로 나뉘지는 않습니다
여러 그룹으로 단절되는 모든 상황에서 과반이 반드시 남는다는 뜻은 아닙니다

[etcd FAQ](https://etcd.io/docs/v3.6/faq/#what-is-maximum-cluster-size)는 7개 이하를 권장합니다
더 큰 구성을 금지하는 하드 한도가 아니라, 복제 대상이 늘 때 쓰기 성능에 드는 비용을 고려한 권장입니다

### learner는 quorum을 바꾸기 전에 데이터를 따라잡게 합니다

투표 멤버로 바로 추가하면 데이터가 아직 없는 새 멤버도 quorum 계산에 들어갑니다
3개에 하나를 더하면 quorum이 3으로 올라가고, 그 상태에서 2 대 2로 단절되면 어느 쪽도 결정을 내릴 수 없습니다
새 멤버의 로그를 채우는 복제 작업도 리더의 네트워크와 처리 자원을 사용합니다

learner는 투표하지 않고 로그를 따라잡는 멤버입니다
따라잡은 뒤 투표 멤버로 승격하기 전까지 quorum에 포함되지 않고 리더 역할도 맡지 않습니다

[etcd v3.6 learner 설계 문서](https://etcd.io/docs/v3.6/learning/design-learner/)의 부록은 serializable 읽기와 member status API를 예외로 허용합니다
따라서 모든 요청을 거절한다고 요약하면 범위가 넓습니다
Kubernetes 저장 경로가 사용하는 linearizable 읽기와 쓰기를 처리하는 멤버로 보아서는 안 됩니다

멤버 추가가 언제나 그대로 승인되는 것도 아닙니다
[etcd의 재구성 검사](https://etcd.io/docs/v3.6/faq/#why-wont-etcd-accept-my-membership-changes)는 quorum 상실을 일으킬 수 있는 변경을 기본적으로 거절합니다

## quorum을 잃었을 때 읽기는 요청 조건에 따라 달라집니다

linearizable 읽기는 읽기 시점에 앞선 쓰기를 반영하는 일관성 보장을 요구합니다
etcd는 이를 위해 리더와 과반을 통한 확인이 필요합니다
serializable 읽기는 멤버의 로컬 상태를 읽을 수 있어 그보다 오래된 값을 돌려줄 수 있습니다

| etcd 요청 | quorum을 사용할 수 없을 때 |
|---|---|
| 쓰기 | 새 쓰기를 정상적으로 확정할 수 없음 |
| linearizable 읽기 | 최신성 확인을 완료할 수 없음 |
| serializable 읽기 | 살아 있는 멤버의 로컬 상태로 응답할 수 있음 |

요청 실패가 클라이언트에 드러나는 시점은 타임아웃과 재시도에도 영향을 받습니다
quorum을 잃는 순간 모든 클라이언트에 같은 오류가 즉시 전달된다는 뜻은 아닙니다

API 서버의 etcd 읽기 경로는 serializable 옵션을 사용해 이 문제를 우회하지 않습니다
예를 들어 [`Kubernetes.Get`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/vendor/go.etcd.io/etcd/client/v3/kubernetes/client.go)은 revision과 limit을 지정하지만 `WithSerializable`은 붙이지 않습니다

그러면 API 서버의 watch cache가 남아 있는 동안에는 읽기가 모두 계속될까요?
**캐시가 있다는 사실과 최신성을 확인할 수 있다는 사실을 구분해야 합니다**

### 최신 LIST도 etcd에서 기준 revision을 먼저 받습니다

[`watchCache.waitAndListConsistent`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/cacher/watch_cache.go)는 `getCurrentRV`로 기준 revision을 받고 캐시가 거기까지 반영되기를 기다립니다
이 호출은 [`store.GetCurrentResourceVersion`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/etcd3/store.go)의 etcd 읽기로 이어집니다

![최신 LIST는 etcd에서 기준 revision을 받고 캐시를 기다리며, progress 응답은 연결된 멤버의 적용 지점을 알리는 별도 정보인 관계](/diagrams/k8s-theory-control-plane-high-availability-2.svg)

따라서 quorum을 사용할 수 없는데도 최신 LIST가 정지된 캐시만으로 계속 성공한다고 설명하면 안 됩니다
반면 `resourceVersion=0`처럼 최신성을 요구하지 않는 요청이나 이미 충족한 revision을 요구하는 캐시 읽기는 캐시 상태와 요청 조건에 따라 응답할 수 있습니다

progress notification은 watch 스트림이 어디까지 진행했는지 알려 줍니다
그 revision은 [etcd 멤버가 적용한 지점](https://github.com/etcd-io/etcd/issues/9855)을 기준으로 하므로, 소수 파티션에 갇힌 멤버의 응답만으로 다수 쪽의 새 쓰기까지 확인할 수는 없습니다
최신 읽기의 기준 revision을 얻는 과정과 그 지점까지 캐시가 따라왔는지 확인하는 과정을 섞지 않아야 합니다

### 리더를 잃은 watch는 계속 유지되지 않습니다

API 서버 저장 계층의 [`store.watchContext`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/etcd3/store.go)는 watch와 progress 요청에 `clientv3.WithRequireLeader`를 붙입니다
이 함수의 주석은 etcd가 리더를 찾지 못한 상태로 election timeout 3회가 지나면 기존 스트림을 취소하며, election timeout의 기본값은 1000ms라고 설명합니다

이 값은 소스에 적힌 서버 동작 설명입니다
네트워크 단절 발생부터 모든 API 응답이 정확히 3초 뒤 바뀐다는 측정값이나 보장은 아닙니다
스트림 종료, 클라이언트 재연결과 캐시 재초기화의 상태를 함께 보아야 합니다

[`Cacher.startCaching`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/cacher/cacher.go)은 초기 상태가 반영되면 ready로 전환하고, 해당 캐싱 실행이 끝나면 오류 상태를 기록합니다
캐시가 not-ready인 동안 요청은 한 가지 방식으로 처리되지 않습니다

| 요청 조건 | v1.37.1의 처리 경로 |
|---|---|
| GET에 `resourceVersion`이 없음 | 캐시 준비 여부와 관계없이 etcd로 위임 |
| GET에 `resourceVersion`이 있고 캐시가 not-ready | etcd로 위임 |
| LIST에 라벨·필드 selector가 없고 `limit > 0` | not-ready 캐시 대신 etcd로 위임 |
| 그 밖의 캐시 대상 LIST와 WATCH | not-ready이면 `429 Too Many Requests`와 `Retry-After` 반환 |

[`CacheDelegator`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/cacher/delegator.go)는 LIST의 일반 위임 조건도 먼저 검사합니다
위 표의 마지막 행은 이미 etcd로 위임된 요청까지 다시 캐시로 돌린다는 뜻이 아닙니다
etcd로 위임됐다는 사실도 quorum 없이 성공한다는 뜻은 아닙니다

## API 서버는 저장소를 공유하고 캐시와 APF 용량은 따로 둡니다

API 서버끼리는 사용자 요청을 처리할 리더 하나를 선출하지 않습니다
각 인스턴스가 요청을 검사하고 공유 etcd를 사용합니다
같은 오브젝트의 조건부 갱신은 저장 단계에서 `resourceVersion` 충돌로 구분합니다

인스턴스를 늘리면 다음 상태도 함께 늘어납니다

| 인스턴스별 상태 | 늘어나는 작업과 남는 경계 |
|---|---|
| 리소스별 watch cache | 각자의 초기 상태 동기화와 watch가 필요함 |
| APF의 실행 자리와 대기열 | 해당 프로세스에 들어온 요청을 기준으로 배정함 |
| APF 기본 오브젝트 관리 | 여러 인스턴스가 공유 오브젝트의 설정을 각각 유지함 |

초기 상태를 받는 방식은 항상 일반 LIST 한 번으로 고정되지 않습니다
v1.37.1 [`WatchListClient`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/features/known_features.go)는 기본 on이며, reflector는 지원 조건에 맞으면 streaming list를 사용하고 필요하면 일반 LIST로 돌아갑니다
어느 경로든 새 인스턴스의 캐시는 자신의 초기 상태를 받아야 합니다

APF는 과부하 상황에서 요청에 실행 자리를 배정하고 대기·거절을 결정하는 계층입니다
[`FeatureOptions.ApplyTo`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/options/feature.go)는 `--max-requests-inflight`와 `--max-mutating-requests-inflight`의 합을 그 프로세스의 용량으로 넘깁니다
`nominalConcurrencyShares`도 이 용량을 나누는 값입니다

동일한 설정의 API 서버를 세 개 두면 프로세스별 용량의 합은 세 배가 됩니다
그렇다고 한 인스턴스가 다른 인스턴스의 빈 자리를 바로 가져다 쓰지는 않습니다
로드 밸런서가 한쪽에 요청을 집중시키면 다른 쪽에 여유가 있어도 해당 인스턴스에서 429가 날 수 있습니다

APF 기본 오브젝트를 관리하는 인스턴스의 버전이 서로 다르면 기대하는 `spec`도 다를 수 있습니다
[APF 공식 문서](https://kubernetes.io/docs/concepts/cluster-administration/flow-control/#maintenance-of-the-mandatory-and-suggested-configuration-objects)는 이때 설정이 반복해서 바뀔 수 있음을 설명합니다
mandatory 구성은 서버가 유지하며, suggested 구성의 `spec` 자동 갱신은 `apf.kubernetes.io/autoupdate-spec`과 generation 조건으로 정합니다
`false` 어노테이션이 모든 기본 오브젝트의 서버 관리를 끈다고 확대하면 안 됩니다

## API 서버 명단을 기록하는 두 장치는 서로 다릅니다

### kubernetes Service의 주소는 etcd TTL 키로 유지합니다

클러스터 안에서 사용하는 `default/kubernetes` Service의 뒤에는 API 서버 주소 목록이 필요합니다
기본 lease endpoint reconciler는 `/masterleases/`를 base key로 사용해 인스턴스별 IP 기록을 갱신하고, 살아 있는 기록으로 Endpoints와 EndpointSlice를 맞춥니다
실제 etcd 키 앞에는 저장소에 설정한 prefix가 붙으므로 이 문자열을 etcd 루트부터의 전체 경로로 취급하면 안 됩니다

[`instance.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controlplane/instance.go)의 기본값은 TTL 15초, 조정 주기 10초입니다
[`storageLeases.UpdateLease`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controlplane/reconcilers/lease.go)는 저장 계층의 TTL을 갱신합니다

여기서 lease는 etcd 키의 만료 장치입니다
`coordination.k8s.io`의 `Lease` API 오브젝트가 아니므로 `kubectl get lease`로 이 키를 볼 수는 없습니다
키 만료와 다음 조정 주기가 따로 있으므로 노드가 멈춘 지 정확히 15초에 Service 주소가 반드시 바뀐다고 계산해서도 안 됩니다

`--apiserver-count`를 사용하는 master-count reconciler는 관리자가 알려 준 인스턴스 수를 사용합니다
TTL 방식은 살아 있는 인스턴스가 자기 키를 갱신하게 하므로 이 수를 사람이 실제 인스턴스 수와 계속 맞출 필요를 줄입니다

### identity Lease는 API 오브젝트로 인스턴스를 기록합니다

`APIServerIdentity`는 각 API 서버가 `kube-system`에 `apiserver-<해시>`라는 `Lease`를 만들게 합니다
이름에 쓰는 ID는 호스트명과 컴포넌트 이름으로 계산하며, 서로 다른 API 서버에 고유한 호스트명이 필요합니다
[`server.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controlplane/apiserver/server.go)의 수명 기본값은 3600초, 갱신 주기는 10초입니다

이 Lease는 API로 볼 수 있는 인스턴스 기록이지만, 현재 요청을 정상 처리할 수 있음을 단독으로 보장하지는 않습니다
만료와 정리에도 시간이 필요하므로 목록의 개수를 즉시 사용 가능한 서버 수로 읽으면 안 됩니다

v1.35에서는 `StorageVersionAPI`와 `UnknownVersionInteroperabilityProxy`가 모두 기본 off여서, 기본 설정의 identity Lease를 주로 관측 지점으로 볼 수 있었습니다
v1.37.1에서는 [`UnknownVersionInteroperabilityProxy`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/features/kube_features.go)가 v1.36부터 Beta·기본 on입니다
[`peerproxy`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/util/peerproxy/peerproxy_handler.go)는 identity Lease informer를 사용해 다른 인스턴스의 discovery 정보를 관리합니다
따라서 현재도 아무 기능이 읽지 않는 기록이라고 설명할 수는 없습니다

API 서버끼리 일부 기능을 위해 상대를 발견하고 요청을 전달하는 것과, 저장 내용을 자체 합의하는 것은 별개입니다
`StorageVersionAPI`는 같은 고정 소스에서 여전히 Alpha·기본 off이며, 별도의 `CoordinatedLeaderElection`은 Beta·기본 off입니다

## 컨트롤러는 Lease를 다투지만 모든 동시 행동을 차단하지는 못합니다

컨트롤러는 요청을 기다리는 대신 관찰한 상태를 근거로 쓰기를 만들어 냅니다
목표 Pod 수가 3인데 두 컨트롤러가 각각 현재 2개를 보고 하나씩 만들면 4개가 될 수 있습니다
workqueue는 한 프로세스 안에서 같은 작업 키의 중복 처리를 제어합니다
[expectations](/essays/k8s-theory-reconcile/)는 컨트롤러가 요청한 생성·삭제가 캐시에 반영되기를 기다리게 합니다
이 두 장치만으로 여러 프로세스의 동시 행동까지 막을 수는 없습니다

기본 리더 선출은 여러 후보가 하나의 `Lease`를 갱신하며 조정 작업을 맡을 인스턴스를 고릅니다
[`leaderelection`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/tools/leaderelection/leaderelection.go)은 다른 노드가 쓴 `renewTime`을 자신의 현재 시각과 직접 빼지 않습니다
관찰한 기록이 바뀌었을 때 자기 로컬 시각을 남기고, 그 시각과 Lease의 지속 시간을 사용합니다

그래서 시계의 절대값 차이에는 견딜 수 있지만 시계가 흐르는 속도의 차이에는 한계가 있습니다
패키지 주석은 `LeaseDuration`과 `RenewDeadline`의 비율이 이 내성에 영향을 준다고 설명합니다

| 설정 | 공용 권장 기본값 | 역할 |
|---|---|---|
| `--leader-elect-lease-duration` | 15초 | 다른 후보가 기존 리더의 기록이 만료됐다고 판단하는 기간 |
| `--leader-elect-renew-deadline` | 10초 | 리더가 갱신을 재시도하다 리더 역할을 포기하는 기간 |
| `--leader-elect-retry-period` | 2초 | 획득·갱신 재시도의 기준 간격 |

값은 [`RecommendedDefaultLeaderElectionConfiguration`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-base/config/v1alpha1/defaults.go)에서 확인할 수 있습니다
실제 재시도에는 지연과 jitter가 있으므로 세 값으로 정확한 장애 전환 완료 시점을 보장할 수는 없습니다

15초와 10초의 차이도 두 리더가 동시에 행동하지 않는다는 보장은 아닙니다
client-go 패키지는 fencing을 보장하지 않는다고 명시합니다
fencing은 이전 리더가 뒤늦게 작업하더라도 저장소나 작업 대상이 그 쓰기를 거절하게 하는 장치입니다

같은 오브젝트의 같은 옛 버전을 조건부 갱신하면 `resourceVersion` 충돌로 한쪽을 거절할 수 있습니다
서로 다른 오브젝트를 만들거나 외부 시스템에 효과를 내는 작업은 하나의 버전 충돌 검사로 묶이지 않습니다
컨트롤러는 자신의 동작 범위에 맞는 멱등성과 재조정을 함께 갖춰야 합니다

## 같은 Lease Kind라도 단독 갱신과 경쟁은 다릅니다

| 용도 | 오브젝트 위치 | 갱신 주체 | 구현 |
|---|---|---|---|
| 노드 하트비트 | `kube-node-lease/<노드명>` | 해당 노드 | 하트비트 컨트롤러 |
| API 서버 identity | `kube-system/apiserver-<해시>` | 해당 인스턴스 | 하트비트 컨트롤러 |
| 리더 선출 | `kube-system/kube-controller-manager` 등 | 여러 후보 | leader election |

앞의 두 경우는 인스턴스마다 자기 오브젝트를 갱신합니다
둘 다 [`component-helpers/apimachinery/lease`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-helpers/apimachinery/lease/controller.go)의 컨트롤러를 사용합니다
이 구현은 다른 주체가 자주 갱신하지 않는다는 가정 아래 최근 사본으로 먼저 UPDATE하고 실패하면 다시 GET하는 최적화를 사용합니다

여러 후보가 하나를 차지하려는 리더 선출은 다른 패키지와 판정 절차를 사용합니다
Kind 이름만 보고 노드 하트비트를 리더 선출로 설명하거나, identity Lease에 투표가 들어 있다고 해석하면 역할이 바뀝니다

## 외부 etcd도 저장소 장애와 API 서버의 연결을 없애지는 않습니다

[kubeadm의 HA 토폴로지 문서](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/ha-topology/)는 stacked 구성과 external etcd 구성을 나눕니다
문서의 권장 최소 구성에서는 전자는 컨트롤 플레인 호스트 3개, 후자는 컨트롤 플레인 3개와 etcd 호스트 3개를 사용합니다
외부 etcd는 한 호스트의 장애로 API 서버와 etcd 멤버를 동시에 잃는 결합을 줄입니다

그러나 API 서버가 etcd의 정상 응답에 의존한다는 관계는 남습니다
[`EtcdOptions.addEtcdHealthEndpoint`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/options/etcd.go)는 etcd 검사를 공통 health check로 등록하고, [`Config.AddHealthChecks`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/server/config.go)는 이 검사를 `/livez`에도 추가합니다

검사는 [`etcd3ProberMonitor.Probe`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/storagebackend/factory/etcd3.go)의 `/<prefix>/health` Get입니다
키가 있느냐보다 etcd가 읽기에 응답할 수 있느냐를 확인하며, 기본 healthcheck timeout은 2초입니다

kubeadm이 만드는 API 서버 정적 Pod의 liveness probe는 `/livez`를 확인합니다
[`LivenessProbe`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kubeadm/app/util/staticpod/utils.go)의 기본 설정은 주기 10초, 연속 실패 임계값 8이며 probe timeout은 15초입니다

공유 etcd의 장애가 길어지면 여러 API 서버에서 liveness 실패와 재시작이 이어질 수 있습니다
`10 × 8`만으로 장애 발생 후 정확히 80초에 재시작한다고 계산할 수는 없습니다
첫 검사 시점, 검사에 걸린 시간, startup probe 통과 여부와 실제 Pod 설정을 함께 확인해야 합니다

## 증상을 보면 먼저 어느 역할의 문제인지 나눕니다

아래는 재현 결과가 아니라 앞의 소스 경로로 구분한 진단 기준입니다

| 증상·오류 | 구분할 가능성 | 확인할 조건 |
|---|---|---|
| 쓰기나 최신 읽기가 실패·지연됨 | etcd quorum·연결·응답 문제 | 투표 멤버의 과반과 etcd 요청 오류 |
| LIST·WATCH에서 `429`와 `Retry-After` | 캐시 not-ready 또는 APF 거절 등 | 캐시 준비 상태와 해당 인스턴스 APF 지표를 구분 |
| 한 API 서버에서만 429 | 인스턴스별 용량·요청 쏠림 | 앞단 분배와 그 프로세스의 실행 자리 |
| `Failed to renew lease`와 리더 교체 | 리더 갱신 실패 | API 지연·연결과 `--leader-elect-*` 설정 |
| Service에 이전 API 서버 IP가 남음 | TTL 만료·조정 대기 또는 조정 실패 | reconciler 종류와 실제 갱신·조정 상태 |
| etcd 장애 중 API 서버가 반복 재시작됨 | `/livez` 검사 의존성 | 실제 probe 경로·타임아웃·실패 횟수 |
| API 서버 증설 때 초기 동기화가 늘어남 | 인스턴스별 캐시 생성 | `apiserver_watch_cache_initializations_total`과 etcd 부하 |

`--etcd-servers`에 여러 주소를 넣는 경우에도 API 서버가 직접 Raft 리더를 고르는 것은 아닙니다
[`newETCD3Client`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/storagebackend/factory/etcd3.go)은 주소 목록을 클라이언트에 넘기고, etcd 클라이언트의 [`resolver`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/vendor/go.etcd.io/etcd/client/v3/internal/resolver/resolver.go)가 `round_robin` 정책을 설정합니다
재시도 사이의 대기는 [`roundRobinQuorumBackoff`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/vendor/go.etcd.io/etcd/client/v3/client.go)에서 endpoint 수에 따라 조절합니다
클라이언트가 어느 멤버에 접속하는가와, 그 요청을 확정할 quorum이 존재하는가는 다른 질문입니다

이 차이는 [APF의 자리 계산](/essays/k8s-theory-api-priority-fairness/)과 [컨트롤러의 재조정](/essays/k8s-theory-reconcile/)을 함께 볼 때도 유지됩니다
인스턴스를 늘리는 설계에서는 요청 분배, 공유 저장소의 합의, 조정 작업의 중복을 각각 확인해야 합니다
