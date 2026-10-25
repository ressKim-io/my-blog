---
title: "kubelet과 Pod 수명주기 — 실행 중과 준비 완료는 다릅니다"
excerpt: "kubelet이 Pod 구성과 런타임 상태를 맞추는 과정을 따라갑니다. Pod phase와 Ready 조건, 세 probe의 역할, sidecar 종료 순서, preStop과 EndpointSlice 전파의 경계를 구분합니다"
category: "kubernetes"
tags: ["Kubernetes", "kubelet", "Pod", "Probe", "Sidecar", "concept"]
series:
  name: "k8s-theory-node"
  order: 4
date: "2026-09-05"
---

Pod의 phase가 `Running`이어도 모든 컨테이너가 요청을 받을 준비를 마쳤다는 뜻은 아닙니다
kubelet은 컨테이너의 실행 상태를 관찰하고, Pod의 전체 상태와 요청 준비 상태를 서로 다른 값으로 기록합니다

[앞선 preemption과 PDB 글](/essays/k8s-theory-preemption-pdb)에서는 삭제를 요청하는 주체를 살폈습니다
삭제 요청 뒤 실제 프로세스를 종료하는 작업은 노드의 kubelet이 컨테이너 런타임에 요청합니다
실행·준비·종료를 같은 판정으로 읽으면 어느 단계에서 멈췄는지 놓치기 쉽습니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## kubelet은 Pod 구성과 실제 컨테이너 상태를 맞춥니다

컨트롤러가 API 오브젝트 사이의 관계를 맞춘다면, kubelet은 Pod 오브젝트의 구성과 노드에서 실행되는 컨테이너 상태를 맞춥니다
변화가 오거나 동기화할 시점이 되면 관찰한 상태를 비교하고, 필요한 컨테이너를 시작하거나 중지하고, 상태를 보고합니다

## container state, Pod phase, Ready를 나눠 읽습니다

**container state**는 컨테이너마다 있는 `Waiting`, `Running`, `Terminated` 실행 상태입니다
**Pod phase**는 kubelet이 여러 컨테이너 상태를 종합한 Pod 전체의 값입니다
요청 준비 여부는 phase에 합치지 않고 `Ready` 조건으로 따로 표현합니다

[`getPhase`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kubelet_pods.go)는 `Waiting`도 이전 종료 기록이 있는지에 따라 다르게 셉니다

| 컨테이너의 현재·이전 상태 | phase 계산에 쓰는 분류 |
|---|---|
| `Waiting`, `lastState.terminated` 없음 | 아직 시작하지 못한 대기 컨테이너 |
| `Waiting`, `lastState.terminated` 있음 | 이전 실행이 종료된 컨테이너 |

예를 들어 초기화가 끝난 Pod에서 한 컨테이너가 실행 중이고, 다른 컨테이너가 종료 기록을 남긴 채 `CrashLoopBackOff`로 기다린다면 phase는 `Running`일 수 있습니다
이것은 두 컨테이너가 모두 정상이라는 판정이 아닙니다

`CrashLoopBackOff`는 Pod phase도 종료 원인도 아닙니다
컨테이너의 시작 재시도가 반복돼 다음 시도에 대기 시간을 적용하고 있다는 `Waiting.reason`입니다

### 조건은 준비 과정의 서로 다른 단계를 보여 줍니다

| Pod 조건 | `True`가 나타내는 상태 |
|---|---|
| `PodScheduled` | 노드 배치가 이뤄짐 |
| `PodReadyToStartContainers` | 네트워크가 구성된 Pod sandbox가 존재해 컨테이너 시작을 준비할 수 있음 |
| `Initialized` | 초기화를 마침. 일반 init 완료와 restartable init의 시작 판정 등을 반영 |
| `ContainersReady` | 일반 컨테이너와 restartable init container가 모두 준비됨 |
| `Ready` | `ContainersReady=True`이고 모든 `readinessGates`도 `True` |

**sandbox**는 런타임이 Pod의 네트워크 등 실행 환경을 준비하는 단위입니다
`PodReadyToStartContainers`는 앱의 요청 준비를 뜻하지 않으며, 이 조건은 v1.37에서 GA가 됐습니다

`readinessGates`는 Pod의 준비 판정에 추가할 조건 이름을 선언합니다
외부 컴포넌트가 관리하는 해당 조건이 없거나 `True`가 아니면, 컨테이너가 모두 준비돼도 Pod의 `Ready`는 `False`입니다
종료 phase에서는 `ContainersReady`도 별도 규칙으로 `False`가 되므로, 컨테이너별 준비 상태만으로 판단하지는 않습니다

API 타입에 `Unknown` phase가 남아 있어도 Node의 `Ready=Unknown`과 같은 판정은 아닙니다
현재 타입 주석은 `PodUnknown`을 Deprecated로 표시하며, 확인한 kubelet의 `getPhase`는 이 값을 반환하지 않습니다
노드 하트비트를 받지 못했다고 Pod phase가 자동으로 `Unknown`이 되는 것으로 해석하면 안 됩니다

## 세 probe는 실패를 서로 다른 동작으로 연결합니다

**probe**는 kubelet이 컨테이너의 시작·생존·요청 준비를 검사하는 설정입니다
검사를 분리하는 이유는 재시작이 필요한 상태와 잠시 요청을 받기 어려운 상태가 다르기 때문입니다

| 종류 | 성공·실패 판정이 쓰이는 곳 | 실패가 확정됐을 때 |
|---|---|---|
| startup | 컨테이너가 시작을 마쳤는지 | 컨테이너 종료 |
| liveness | 계속 실행할 수 있는지 | 컨테이너 종료 |
| readiness | 지금 요청을 받아도 되는지 | 준비 상태를 `False`로 기록. 컨테이너는 종료하지 않음 |

종료 후 재시작 여부는 재시작 정책이 정합니다
현재 기본 on인 `ContainerRestartRules`에서는 컨테이너별 `restartPolicy`와 `restartPolicyRules`도 Pod의 정책을 재정의할 수 있으므로, Pod의 `restartPolicy`만으로 모든 종료 후 동작을 판단할 수는 없습니다

startup probe를 설정했다면 성공하기 전에는 liveness와 readiness 검사를 실행하지 않습니다
시작이 느린 앱은 시작 성공 판정과 시작 후 검사를 이렇게 구분할 수 있습니다

[`worker.doProbe`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/prober/worker.go)는 각 필드를 다음과 같이 사용합니다

| 필드 | 의미·조건 |
|---|---|
| `initialDelaySeconds` | 컨테이너가 `Running`을 시작한 시각을 기준으로 검사를 늦춤 |
| `periodSeconds` | 기본 검사 간격. 미준비 상태의 readiness는 이 간격 밖에서도 실행될 수 있음 |
| `failureThreshold` | 결과를 실패로 바꾸기 위해 필요한 연속 실패 횟수 |
| `successThreshold` | 실패 뒤 성공으로 바꾸기 위해 필요한 연속 성공 횟수. liveness·startup은 1만 허용 |

한 번의 실패가 곧바로 컨테이너 종료를 뜻하지는 않습니다
liveness 워커는 연속 실패가 임계값에 도달하면 결과를 전달하고, 새 컨테이너 ID를 볼 때까지 검사를 멈춥니다
종료 중인 컨테이너에 검사 실행을 계속 요청해 런타임의 상태 처리를 방해하지 않기 위해서입니다

Pod에 `deletionTimestamp`가 있으면 liveness·startup 워커는 결과를 성공으로 두고 종료합니다
종료 중인 컨테이너에 probe 실패로 추가 종료를 요청하지 않도록 하는 처리이며, readiness에는 이 종료 분기가 없습니다

### 외부 의존성의 실패와 앱 재시작을 바로 연결하지 않습니다

가정해 보면 공용 DB가 잠시 느려져 여러 Pod가 요청을 처리하기 어려울 수 있습니다
이 상태를 liveness 실패로 연결하면 앱 컨테이너들이 종료되고, 재시작 정책에 따라 다시 시작하면서 DB 연결을 다시 요청할 수 있습니다

readiness 실패는 프로세스를 유지하면서 요청 준비 상태를 바꿉니다
Service의 대상 주소와 준비 상태를 담는 EndpointSlice에는 controller가 이 Pod 상태를 반영합니다
`publishNotReadyAddresses=false`인 Service에서는 준비된 endpoint를 고르는 일반 트래픽의 대상에서 제외하는 데 이 값이 쓰입니다
외부 의존성이 불안정하다는 이유와 앱 자체를 재시작해야 한다는 이유를 같은 검사로 합치지 않는 편이 좋습니다

## 일반 init은 완료를, sidecar는 시작을 기다립니다

일반 init container와 Kubernetes의 native sidecar는 모두 `initContainers`에 선언할 수 있습니다
이 중 컨테이너의 `restartPolicy: Always`가 설정된 것이 **restartable init container**, 즉 이 방식의 sidecar입니다

다음은 이름과 순서만 보여 주는 매니페스트 발췌이며, 실행할 이미지 등의 필드는 생략했습니다

```yaml
initContainers:
  - name: setup
  - name: helper
    restartPolicy: Always
containers:
  - name: app
```

| 시점 | 순서와 기다리는 조건 |
|---|---|
| 시작 | `setup` 완료 후 `helper`를 시작. `helper.started=True`가 되면 `app`을 시작 |
| 종료 | 일반 앱 컨테이너 종료를 기다린 뒤 sidecar 종료. sidecar가 여러 개면 선언의 역순 |

sidecar는 끝나야 다음 컨테이너를 시작하는 것이 아닙니다
startup probe가 있다면 그 성공으로, 없다면 프로세스가 실행된 상태로 `started`를 판정합니다
sidecar의 readiness probe는 Pod의 준비 판정에도 참여합니다

종료 순서 대기도 남은 유예 시간 안에서 진행됩니다
[`terminationOrdering.waitForTurn`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_termination_order.go)은 유예가 끝나면 기다림을 중단하므로, sidecar가 앱의 종료를 무한히 기다려 준다는 보장은 아닙니다

`SidecarContainers`와 `PodLifecycleSleepAction`은 각각 v1.33·v1.34에 안정화된 기능입니다
현재 확인한 v1.37.1에는 이 두 feature gate 키가 남아 있지 않습니다
과거의 gate 이름을 현재도 켜야 하는 설정처럼 안내하지는 않습니다

## 실행 상태의 변화는 반복 동기화에 반영합니다

![Pod 구성·런타임·probe의 변화를 받아 kubelet이 동기화하고 런타임에 작업을 요청한 뒤 관찰 상태를 보고하는 반복 흐름|tall](/diagrams/k8s-theory-kubelet-pod-lifecycle-1.svg)

[`syncLoopIteration`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kubelet.go)은 여러 채널 중 준비된 이벤트 하나를 선택해 해당 처리를 수행합니다
여러 채널이 동시에 준비돼도 코드에 적힌 순서대로 처리한다는 보장은 없습니다

| 입력 | 처리하는 변화 | 주기·조건 |
|---|---|---|
| config | Pod 구성 추가·수정·삭제 | 구성 소스의 변화 |
| PLEG | 런타임에서 관찰한 컨테이너 상태 변화 | 기본 Generic PLEG의 전체 조회 간격은 1초 |
| sync | 동기화할 시점이 된 Pod | 1초마다 대상을 확인 |
| liveness | 생존 검사 결과 | 실패 결과만 동기화에 연결 |
| readiness | 요청 준비 검사 결과 | 성공·실패 모두 준비 상태에 반영 |
| startup | 시작 검사 결과 | 성공·실패 모두 시작 상태에 반영 |
| container manager | 장치 관련 변화가 영향을 주는 Pod | 해당 업데이트가 올 때 |
| housekeeping | 남은 Pod·볼륨 등의 정리 | 2초 티커. 구성 소스가 준비된 뒤 수행 |

현재 확인한 구현에는 container manager 업데이트까지 여덟 입력 분기가 있습니다
구성 변화, 런타임 관찰, probe 결과, 주기 처리가 서로 다른 경로로 동기화를 요청합니다

### 1초 티커와 1분 동기화 설정은 다른 값입니다

sync 티커가 1초마다 울린다고 모든 Pod를 매초 동기화하지는 않습니다
`getPodsToSync`는 작업 큐에서 시점이 된 Pod와 `ShouldSync`로 선택한 Pod를 찾습니다

[`SyncFrequency`의 설정 기본값](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/apis/config/v1beta1/defaults.go)은 1분입니다
이 값은 Pod worker의 `resyncInterval`로 전달됩니다
정상적으로 동기화를 마쳤고 상태 전이가 없으면 이 간격에 jitter, 즉 무작위 지연을 더해 다시 예약합니다

상태 전이, 처리 대기 중인 업데이트, 오류, 다른 이벤트는 별도 경로를 따릅니다
따라서 모든 Pod의 동기화가 정확히 1분마다 이뤄진다는 시간 보장도 아닙니다
`syncLoop` 주석의 기본 10초라는 설명 대신 실제 설정 기본값과 [`completeWork`의 재예약](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/pod_workers.go)을 함께 봐야 합니다

### Generic PLEG는 런타임을 조회해 변화를 찾습니다

**PLEG(Pod Lifecycle Event Generator)**는 런타임에서 관찰한 상태 변화로 Pod 수명주기 이벤트를 만드는 컴포넌트입니다
기본 Generic PLEG는 런타임에 Pod 목록을 요청하고 이전 결과와 비교합니다
변화에 따라 `ContainerStarted`, `ContainerDied`, `ContainerRemoved`, `ContainerChanged` 이벤트를 만듭니다

현재는 전체 조회 외에 특정 Pod의 재조회를 요청하는 경로도 있습니다
`PLEGOnDemandRelist`는 v1.37에서 GA이며 기본 on으로 잠겨 있습니다
이 경로가 추가됐어도 Generic PLEG의 주기 조회와 캐시 갱신 역할은 유지됩니다

[`GenericPLEG.Healthy`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/pleg/generic.go)는 저장된 마지막 전체 relist 시각으로부터 지난 시간을 기본 임계값 3분과 비교합니다
한 번의 조회 수행시간만을 재는 검사는 아닙니다
런타임 조회 실패로 이 시각이 갱신되지 않거나 조회가 오래 걸리면 unhealthy가 될 수 있습니다

이 결과는 kubelet의 런타임 상태 검사에 들어가며, 노드 `Ready` 판정에도 영향을 줍니다
런타임이 이벤트를 먼저 전달하는 `EventedPLEG`는 현재도 Alpha·기본 off입니다
이를 켰을 때의 300초 relist 간격을 기본 Generic PLEG의 1초 간격과 섞으면 안 됩니다

## preStop도 컨테이너의 종료 유예 시간을 사용합니다

Pod의 `terminationGracePeriodSeconds` 기본값은 30초입니다
preStop은 컨테이너 중지 신호보다 먼저 실행하는 훅이며, 훅에 쓴 시간도 종료 유예에서 빠집니다

[`setTerminationGracePeriod`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_container.go)는 다음 우선순위로 유예 값을 선택합니다

| 우선순위 | 값 | 적용 범위 |
|---|---|---|
| 1 | `metadata.deletionGracePeriodSeconds` | 삭제 요청에 따라 API 서버가 기록한 값 |
| 2 | probe의 `terminationGracePeriodSeconds` | liveness·startup 실패로 종료할 때의 전용 값 |
| 3 | `spec.terminationGracePeriodSeconds` | Pod의 기본 종료 유예 |

Pod worker 등의 호출자가 별도 유예 override를 전달하면 `killContainer`는 그 값도 적용합니다
이후 preStop 실행과 sidecar 종료 순서 대기에 쓴 시간을 빼고, CRI `StopContainer`에 남은 시간을 전달합니다
**CRI(Container Runtime Interface)**는 kubelet이 런타임에 컨테이너 작업을 요청하는 인터페이스입니다

예를 들어 기본 유예 30초에서 preStop의 sleep이 15초를 사용했다면, 앱이 종료할 수 있도록 남겨 둔 시간도 그만큼 줄어듭니다
다른 대기가 있으면 남은 시간은 더 줄어듭니다
이는 설정의 관계를 보여 주는 예시이며, 정확한 신호 도착 시각을 측정한 결과는 아닙니다

preStop이 유예를 다 쓰면 kubelet은 훅이 끝나기를 더 기다리지 않고 중지를 요청합니다
현재 구현은 preStop과 순서 대기 후 남은 시간에 **최소 2초**를 적용해 `StopContainer`에 전달합니다
Pod에 선언한 유예 자체를 항상 2초로 바꾼다는 뜻은 아닙니다

런타임은 컨테이너의 주 프로세스에 중지 신호를 전달하고, 제시간에 종료하지 못하면 강제로 종료합니다
Linux의 일반적인 기본 중지 신호는 SIGTERM입니다
이미지의 `STOPSIGNAL`이나 활성화한 `ContainerStopSignals`의 별도 신호 설정이 있으면 실제 신호가 달라질 수 있습니다

이 유예는 API 오브젝트가 삭제되는 시각의 엄격한 상한도 아닙니다
런타임 응답 지연, 상태 보고, API 오브젝트 정리와 실제 컨테이너 중지를 같은 시점으로 볼 수 없습니다

## EndpointSlice 전파와 프로세스 종료에는 고정된 선후가 없습니다

Service는 여러 백엔드 Pod로 요청을 보내는 접점입니다
**EndpointSlice**에는 실제 대상 주소와 준비·종료 조건이 기록됩니다
selector로 Pod를 고르는 Service에서는 EndpointSlice controller가 Pod 상태를 이 목록에 반영합니다

Pod에 `deletionTimestamp`가 기록되면 kubelet과 EndpointSlice controller가 이를 각각 관찰합니다
한쪽은 노드의 컨테이너를 종료하고, 다른 쪽은 트래픽 대상 정보를 갱신합니다

![같은 Pod 삭제 상태를 kubelet과 EndpointSlice controller가 독립적으로 관찰해 프로세스 종료와 트래픽 대상 갱신을 병렬로 진행하는 흐름|tall](/diagrams/k8s-theory-kubelet-pod-lifecycle-2.svg)

[`podToEndpoint`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/endpointslice/utils.go)는 다음 값으로 endpoint 조건을 계산합니다

```go
serving := endpointutil.IsPodReady(pod)
terminating := pod.DeletionTimestamp != nil
ready := service.Spec.PublishNotReadyAddresses || (serving && !terminating)
```

`publishNotReadyAddresses=false`인 Service는 종료 중인 Pod의 `ready`를 `false`로 계산합니다
`publishNotReadyAddresses=true`이면 `ready`가 `true`가 되는 예외가 있으며, 프로세스가 실제로 살아 있는지를 이 식으로 판정하는 것은 아닙니다

kube-proxy를 사용하는 구성에서는 각 노드가 Service와 EndpointSlice 변화를 받아 트래픽 전달 규칙을 갱신해야 합니다
iptables 모드라면 [`OnEndpointSliceUpdate`와 `syncProxyRules`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/iptables/proxier.go)를 거쳐 커널 규칙에 반영합니다
API의 `ready=false` 기록과 각 노드의 반영 사이에는 전파·처리 시간이 있습니다

그래서 변경이 전파되는 동안 이미 종료 신호를 받은 Pod로 요청이 갈 수 있습니다
이는 rolling update 중 502가 생기는 한 원인이 될 수 있지만, 502만으로 이 경합을 확정할 수는 없습니다

preStop의 `sleep`은 중지 신호를 늦춰 EndpointSlice 변경이 전파될 시간을 벌 수 있습니다
하지만 모든 프록시의 갱신이나 기존 연결의 정상 종료를 보장하지는 않습니다
sleep을 늘린 만큼 앱 종료에 남길 유예도 함께 고려해야 합니다

## static Pod는 API 서버 외의 구성 소스로 실행합니다

config 입력에는 API 서버 외에 `file`과 `http` 소스도 있습니다
**static Pod**는 kubelet이 노드의 파일 또는 URL에서 직접 읽은 구성으로 실행하는 Pod입니다
스케줄러의 노드 배치 결정을 거치지 않습니다

파일 소스는 kubelet 설정의 `staticPodPath` 또는 `--pod-manifest-path`로 지정하고, URL 소스는 `--manifest-url`로 지정할 수 있습니다
이 경로는 API 서버에서 Pod 구성을 받을 수 없어도 사용할 수 있어 control plane을 시작하는 데 쓰입니다

API 서버를 사용할 수 있으면 kubelet은 static Pod를 나타내는 **mirror Pod** 오브젝트를 만듭니다
`kubectl get pod`에 보이는 mirror Pod를 삭제해도 노드의 원본 구성은 남습니다
따라서 실제 static Pod가 종료되는 것은 아니며 kubelet은 mirror Pod를 다시 만듭니다
파일 기반 static Pod를 없애려면 해당 노드의 원본 매니페스트 파일을 제거해야 합니다

`kubernetes.io/config.source`는 구성 소스를 나타내고, `kubernetes.io/config.mirror`는 mirror Pod를 구별하는 어노테이션입니다
이는 컨트롤러가 새 Pod를 만드는 일반적인 소유 관계와 다른 실행 경로입니다

## 증상은 판정 주체와 함께 읽습니다

아래는 실제 수집한 장애 결과가 아니라 상태 필드로 조사 범위를 좁히는 기준입니다

| 증상·단서 | 함께 확인할 것 | 해석 범위 |
|---|---|---|
| `Pending`, 노드 없음 | `PodScheduled`와 스케줄러 이벤트 | 배치가 끝나지 않았는지 확인 |
| `Pending`, 노드 있음 | 컨테이너의 `Waiting.reason` | 이미지 받기·컨테이너 생성 등 노드 준비 단계 확인 |
| `Running`, 요청 준비 안 됨 | Pod `Ready`, 컨테이너 `ready` | 실행 상태와 요청 준비를 분리 |
| `ContainersReady=True`, `Ready=False` | `readinessGates`의 조건 | 빠졌거나 `True`가 아닌 추가 조건 확인 |
| Node `Ready=Unknown` | 하트비트와 마지막 Pod 상태 | Pod phase도 `Unknown`일 것이라고 가정하지 않음 |
| `lastState.terminated.reason=OOMKilled`, exit code 137 | 메모리·커널 OOM 관련 기록 | OOM 종료의 단서. 137만으로 원인을 확정하지 않음 |
| 이전 종료 `reason=Error`, liveness 실패 이벤트 | 같은 컨테이너·시각의 기록 | kubelet의 probe 기반 종료 경로인지 대조 |
| 이전 종료 `reason=Completed`, exit code 0 | 재시작 정책과 규칙 | 정상 종료 후 재실행되는 정책인지 확인 |
| `state.waiting.reason=CrashLoopBackOff` | 이전 종료 상태와 이벤트 | 대기 상태만으로 종료 원인은 알 수 없음 |

기본 재시도 대기는 10초에서 시작해 2배씩 늘고 상한은 300초입니다
`KubeletCrashLoopBackOffMax`는 현재 Beta·기본 on이며, kubelet 설정의 `crashLoopBackOff.maxContainerRestartPeriod`로 노드별 상한을 1~300초로 정할 수 있습니다
상한이 기본 시작 간격 10초보다 작으면 시작 간격도 그 상한으로 낮춥니다

Alpha·기본 off인 `ReduceDefaultCrashLoopBackOffDecay`를 켠 경로는 시작 1초·상한 60초를 사용합니다
다만 노드별 상한 설정이 우선하므로, gate 이름 하나만 보고 모든 노드의 실제 간격을 단정하지는 않습니다

종료 중 요청 실패를 조사한다면 preStop뿐 아니라 남은 유예, 앱의 중지 신호 처리, EndpointSlice 전파를 함께 봐야 합니다
쉘을 통해 앱을 시작했다면 PID 1인 쉘이 신호를 앱으로 전달하는지도 관계가 있습니다
Pod가 실행 중이라는 사실, 요청을 받을 수 있다는 사실, 삭제가 요청됐다는 사실은 각각 다른 상태와 경로로 확인합니다

## 근거를 확인한 문서와 소스

- [Pod Lifecycle](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/workloads/pods/pod-lifecycle.md) — phase·조건, 재시도 대기, 종료와 EndpointSlice의 병행
- [Liveness·Readiness·Startup Probe 설정](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes.md) — 검사 필드와 실패 동작
- [Sidecar Containers](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/workloads/pods/sidecar-containers.md) — 시작·준비·종료 순서
- [Static Pod 생성](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/tasks/configure-pod-container/static-pod.md) — 파일·URL 구성과 mirror Pod의 삭제 경계
- [상태 조건 생성](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/status/generate.go) — `GenerateContainersReadyCondition`·`GeneratePodReadyCondition`·`GeneratePodReadyToStartContainersCondition`
- [Feature gate 목록](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go) — 현재 단계·기본값과 과거 gate 키의 제거 여부
