---
title: "Deployment와 DaemonSet — 롤아웃의 가용성과 되돌리기 이력"
excerpt: "Deployment가 템플릿별 ReplicaSet을 나누고 가용성을 유지하며 교체하는 과정을 살펴봅니다. 롤백 뒤 revision이 증가하는 이유, DaemonSet의 노드 선택과 히스토리, ReplicaSet 축소의 삭제 순서를 구분합니다"
category: "kubernetes"
tags: ["Kubernetes", "Deployment", "DaemonSet", "ReplicaSet", "Rollout", "concept"]
series:
  name: "k8s-theory-node"
  order: 8
date: "2026-09-12"
---

Deployment의 `spec.template`을 수정하면 컨트롤러는 기존 Pod를 새 템플릿의 Pod로 교체합니다
이때 해야 할 일은 새 Pod를 만드는 것만이 아닙니다
기존 집합과 새 집합을 구분하고, 교체에 필요한 추가 replica 수와 유지할 가용 Pod 수를 따로 계산해야 합니다

DaemonSet도 템플릿을 교체하지만 목표는 전체 replica 수가 아니라 조건에 맞는 노드마다 Pod를 두는 것입니다
두 컨트롤러가 무엇을 세는지부터 나누면 교체 방식과 히스토리 저장 방식이 달라지는 이유를 이해할 수 있습니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 클러스터에서 재현한 실측 기록은 포함하지 않습니다

## Deployment는 템플릿별 ReplicaSet의 목표 수를 조정합니다

ReplicaSet은 자기 selector에 속한 Pod 수가 목표 `replicas`에 맞도록 생성·삭제하는 컨트롤러입니다
Deployment는 이 ReplicaSet을 여러 개 관리하며, 기존 템플릿 집합은 줄이고 새 템플릿 집합은 늘립니다
Pod 수를 맞추는 [ReplicaSet의 reconcile](/essays/k8s-theory-reconcile)과 여러 집합의 목표 수를 조정하는 역할이 나뉘어 있습니다

![Deployment가 공통 selector 아래 템플릿 해시가 다른 ReplicaSet을 관리하고 각각 기존 Pod와 새 Pod 집합의 수를 유지하는 관계](/diagrams/k8s-theory-workload-rollout-revisions-1.svg)

Deployment의 selector는 기존 Pod와 새 Pod를 모두 포함합니다
컨트롤러는 여기에 `pod-template-hash` 라벨 조건을 더해 ReplicaSet별 집합을 나눕니다
이 라벨은 ReplicaSet의 selector와 Pod template의 라벨 양쪽에 들어갑니다

[`ComputeHash`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/controller_utils.go)는 Pod template 전체에 FNV-32a 해시를 적용하고 `collisionCount`가 있으면 함께 섞습니다
해시 라벨은 사용자가 집합 구분을 위해 임의로 정하는 값이 아닙니다

[`getNewReplicaSet`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/deployment/sync.go)은 같은 이름이 이미 있어 생성이 실패하면 기존 ReplicaSet의 controller 소유 UID와 템플릿을 함께 확인합니다
둘 다 일치하면 이미 만든 자기 ReplicaSet으로 보고 사용합니다
그렇지 않으면 `status.collisionCount`를 올리고 다음 sync에서 다시 계산합니다

### selector 불변 검증과 소유권은 별개입니다

`apps/v1` Deployment의 `spec.selector`는 생성 뒤 바꿀 수 없습니다
이 제약은 해시 라벨이 만드는 것이 아니라 API 서버의 [`ValidateDeploymentUpdate`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/apps/validation/validation.go)가 적용합니다

컨트롤러가 ReplicaSet을 채택하거나 놓아줄 때는 selector뿐 아니라 `ownerReferences`의 controller 참조도 확인합니다
다른 controller의 자식은 selector가 맞는다는 이유만으로 가져오지 않습니다
Deployment와 ReplicaSet 사이의 소유 관계가 바뀌는 일도 ReplicaSet과 Pod 사이의 소유 관계를 즉시 없애는 것과는 다릅니다

이 경계는 [`BaseControllerRefManager.ClaimObject`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/controller_ref_manager.go)에 있습니다
라벨로 찾는 범위와 누가 관리하는 자식인지를 구분해야 합니다

## maxSurge와 maxUnavailable은 세는 대상이 다릅니다

`RollingUpdate`에서 `maxSurge`는 ReplicaSet들의 목표 replica 합계를 얼마나 더 늘릴지 정합니다
`maxUnavailable`은 교체하면서 유지하려는 available Pod 수의 하한을 정합니다
available은 Ready 상태를 `minReadySeconds` 이상 유지한 Pod입니다

| 필드 | 계산하는 경계 | 백분율 반올림 | 기본값 |
|---|---|---|---|
| `maxSurge` | 목표 replica 합계의 상한 `replicas + maxSurge` | 올림 | `25%` |
| `maxUnavailable` | 유지하려는 available 수 `replicas - maxUnavailable` | 내림 | `25%` |

기본값에서 `replicas: 3`이면 surge는 `0.75`를 올림한 `1`, unavailable은 내림한 `0`입니다
따라서 목표 replica 합계를 최대 4로 늘릴 수 있고 available은 3개를 유지하려고 합니다
정상적으로 가용한 기존 Pod를 줄이려면 새 Pod가 available이 되어야 합니다

이것은 종료 중인 Pod까지 포함한 실제 Pod 수가 항상 4 이하라는 뜻은 아닙니다
ReplicaSet이 목표 수를 줄여 삭제를 요청해도 종료 유예 중인 Pod는 자원을 계속 사용할 수 있습니다
노드 장애나 애플리케이션 실패까지 막아 available 하한을 보장하는 설정도 아닙니다

[`NewRSNewReplicas`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/deployment/util/deployment_util.go)는 목표 replica 합계로 증설 여유를 계산합니다
[`reconcileOldReplicaSets`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/deployment/rolling.go)는 새 ReplicaSet의 미가용 replica와 기존 집합의 available 수까지 고려해 줄일 수 있는 수를 정합니다

### 증설과 축소는 여러 sync에 걸쳐 진행됩니다

[`rolloutRolling`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/deployment/rolling.go)은 먼저 새 ReplicaSet의 목표 수를 조정합니다
그 수가 바뀌었다면 status를 갱신하고 해당 sync를 끝냅니다
그 단계에서 바뀐 수가 없을 때 기존 ReplicaSet을 줄일 수 있는지 판단합니다

목표 수 변경은 Pod 생성·Ready·available 완료와 같은 사건이 아닙니다
여러 컨트롤러의 처리와 상태 관찰을 거치며 점진적으로 교체합니다

[`ResolveFenceposts`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/deployment/util/deployment_util.go)는 surge를 올림하고 unavailable을 내립니다
두 값을 명시적으로 0으로 설정하는 것은 검증에서 막습니다
백분율을 정수화한 결과가 둘 다 0이라면 진행할 수 있도록 unavailable을 1로 보정합니다

### PDB는 이 삭제 경로를 거부하지 않습니다

Deployment가 기존 ReplicaSet의 `replicas`를 내리면 실제 Pod 삭제는 ReplicaSet 컨트롤러가 합니다
[`RealPodControl.DeletePod`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/controller_utils.go)는 일반 Pod DELETE를 사용하며 `pods/eviction`을 호출하지 않습니다

따라서 [Eviction API의 PDB 예산 검사](/essays/k8s-theory-preemption-pdb)를 거쳐 롤아웃 삭제를 거부하는 구조가 아닙니다
롤아웃이 유지하려는 available 수는 `maxUnavailable`로 조정합니다

## 롤백은 과거 템플릿으로 새 롤아웃을 시작합니다

Deployment의 히스토리는 이전 ReplicaSet에 남습니다
각 ReplicaSet이 이전 `spec.template`을 보관하며, 사용하지 않는 집합의 목표 수를 0으로 둘 수 있습니다
revision은 `deployment.kubernetes.io/revision` annotation으로 관리합니다

`kubectl rollout undo`는 클라이언트가 대상 revision의 ReplicaSet을 읽고 그 템플릿을 현재 Deployment에 patch합니다
[`DeploymentRollbacker.Rollback`·`getDeploymentPatch`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kubectl/pkg/polymorphichelpers/rollback.go)는 `/spec/template`과 `/metadata/annotations`를 교체하는 JSON Patch를 만듭니다

![revision 1의 템플릿 A에서 revision 2의 B로 갱신한 뒤 undo가 A를 현재 템플릿으로 적용하여 revision 3으로 진행하는 예시](/diagrams/k8s-theory-workload-rollout-revisions-2.svg)

서버가 받는 것은 현재 템플릿의 변경이므로 컨트롤러는 이를 새 롤아웃으로 처리합니다
가령 revision 2의 B에서 revision 1의 A로 되돌리면, A를 다시 쓰면서 revision이 3으로 증가할 수 있습니다
이 숫자는 동작을 설명하는 예시이며 실제 수집한 이력이 아닙니다

이전 A의 ReplicaSet이 남아 있다면 그 오브젝트를 다시 활성화하고 revision annotation을 갱신할 수 있습니다
롤백할 때마다 반드시 새 ReplicaSet 오브젝트를 만든다는 뜻은 아닙니다
반대로 현재 템플릿이 이미 대상 revision과 같으면 kubectl은 템플릿 변경을 생략합니다

되돌리는 범위도 Deployment 전체가 아닙니다
선택한 템플릿과 복원 대상 annotation이 바뀌며, 현재 `replicas`나 `strategy`를 그 revision 당시 값으로 복원하지는 않습니다
컨트롤러에 남은 deprecated rollback annotation 경로와 현재 kubectl의 patch 경로도 구분해야 합니다

### 히스토리 한도는 정리 조건까지 함께 봅니다

`revisionHistoryLimit`의 기본값은 10입니다
이를 넘으면 revision이 낮은 이전 ReplicaSet부터 정리를 시도합니다
일반 RollingUpdate 경로에서는 롤아웃 완료 뒤 정리하며, 목표 수와 관측한 수가 모두 0인지·최신 generation을 관측했는지 등의 조건도 확인합니다
일시 중지 상태이고 rollback 요청이 없을 때도 정리를 시도합니다

따라서 한도를 0으로 설정하자마자 모든 옛 ReplicaSet이 즉시 사라지는 것은 아닙니다
정리를 거쳐 이전 템플릿이 지워지면 그 히스토리로 롤백할 수 없습니다
계속 완료되지 않는 롤아웃에서 이력이 한도를 초과해 남는 경우도 있습니다

정리 조건과 일시 중지 경로는 [`cleanupDeployment`와 `sync`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/deployment/sync.go), 롤아웃 완료 뒤의 정리 설명은 [공식 Clean up Policy](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/workloads/controllers/deployment.md#clean-up-policy)에 나와 있습니다

## Progressing은 지난 상태와의 변화를 봅니다

[`DeploymentProgressing`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/deployment/util/deployment_util.go)은 다음 중 하나가 이전 status보다 나아졌는지 확인합니다

- `updatedReplicas` 증가
- 아직 갱신하지 않은 replica 수인 `replicas - updatedReplicas` 감소
- `readyReplicas` 증가
- `availableReplicas` 증가

진행이 있으면 `Progressing` condition의 `lastUpdateTime`을 갱신합니다
`DeploymentTimedOut`은 그 시각에 `progressDeadlineSeconds`를 더해 현재 시각과 비교하며, 기본 데드라인은 600초입니다
전체 롤아웃 시작부터 무조건 600초로 제한하는 타이머가 아닙니다

데드라인보다 짧은 간격으로 진행이 이어지면 전체 시간이 길어도 진행 중일 수 있습니다
진행이 없는 시간이 기한을 넘으면 `Progressing=False`, `reason=ProgressDeadlineExceeded`를 기록합니다
완료한 롤아웃에는 같은 방식으로 데드라인 초과를 판정하지 않습니다

[`syncRolloutStatus`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/deployment/progress.go)는 완료·진행·타임아웃을 나눠 condition을 갱신합니다
`Progressing=True`가 롤아웃이 아직 진행 중이라는 뜻으로만 쓰이는 것도 아닙니다
완료 뒤에는 `reason=NewReplicaSetAvailable`과 함께 True가 남을 수 있습니다

타임아웃을 기록해도 컨트롤러의 reconcile은 계속하며 자동 롤백하지 않습니다
이미지 오류, 자원 부족, 쿼터, probe 실패는 모두 진행을 막을 수 있지만 대응은 다릅니다
진행 판정과 롤백을 선택하는 외부 정책을 구분해야 합니다

## DaemonSet은 노드별로 필요한 Pod를 먼저 정합니다

DaemonSet은 조건에 맞는 노드마다 Pod를 하나씩 두려는 컨트롤러입니다
목표 Pod 수는 사용자가 정한 전체 `replicas` 대신 대상 노드 수와 연결됩니다
갱신 전략에 따라 같은 노드에 옛 Pod와 새 Pod가 잠시 겹칠 수 있습니다

![DaemonSet 컨트롤러가 원래 배치 조건으로 대상 노드를 고르고 노드 이름 affinity로 Pod를 만든 뒤 스케줄러가 자원 적합성을 검사하는 흐름](/diagrams/k8s-theory-workload-rollout-revisions-3.svg)

[`NodeShouldRunDaemonPod`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/daemon/daemon_controller.go)는 `spec.nodeName`, nodeSelector·필수 nodeAffinity, taint·toleration을 평가합니다
이 후보 판정은 CPU·메모리 요청량과 노드의 남은 자원을 검사하지 않습니다

대상 노드를 골랐다면 생성할 Pod의 필수 nodeAffinity를 그 노드 이름 조건으로 대체합니다
[`ReplaceDaemonSetPodNodeNameNodeAffinity`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/daemon/util/daemonset_util.go)의 `Replace`는 기존 필수 조건에 노드 이름을 단순 추가한다는 뜻이 아닙니다
원래 조건은 컨트롤러가 대상을 고를 때 사용했고, 생성 Pod에는 고른 노드의 이름 조건을 넣습니다

다음은 생성 Pod에 들어가는 조건을 설명하는 조각입니다

```yaml
nodeAffinity:
  requiredDuringSchedulingIgnoredDuringExecution:
    nodeSelectorTerms:
      - matchFields:
          - key: metadata.name
            operator: In
            values: [node-3]
```

노드 라벨을 비교하는 `matchExpressions`가 아니라 이름 필드를 비교하는 `matchFields`입니다
이후 스케줄러가 그 노드에서 자원 적합성 등 배치 조건을 검사하고 바인딩합니다
자리가 부족해 배치할 수 없다면 다른 노드로 옮기는 대신 Pending에 남을 수 있습니다
DaemonSet 컨트롤러의 대상 선택은 [스케줄링 검사](/essays/k8s-theory-scheduling-binding-cycles)를 대신하지 않습니다

### 자동 toleration은 일반 Pod와 다른 생존 조건을 만듭니다

[`AddOrUpdateDaemonPodTolerations`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/daemon/util/daemonset_util.go)는 다음 toleration을 자동으로 추가하거나 갱신합니다
아래 키에는 모두 `node.kubernetes.io/` 접두사가 붙습니다

| 키의 뒷부분 | effect | 적용 조건 |
|---|---|---|
| `not-ready`·`unreachable` | `NoExecute` | 항상, `tolerationSeconds` 없음 |
| `disk-pressure`·`memory-pressure`·`pid-pressure` | `NoSchedule` | 항상 |
| `unschedulable` | `NoSchedule` | 항상 |
| `network-unavailable` | `NoSchedule` | `hostNetwork: true` |

앞의 두 NoExecute toleration에는 시간 제한이 없습니다
일반 Pod에 기본 300초 toleration이 들어가는 경우와 달리, 이 두 taint의 시간 경과만으로 DaemonSet Pod를 축출하지 않습니다
이것이 다른 사유로도 삭제되지 않는다는 의미는 아닙니다

`unschedulable` toleration 때문에 cordon한 노드에도 DaemonSet Pod를 배치할 수 있습니다
이런 예외는 네트워크 플러그인처럼 노드가 Ready가 되기 전에 필요한 구성요소를 실행할 때도 의미가 있습니다
전체 자동 목록과 배치 경로는 [DaemonSet 공식 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/workloads/controllers/daemonset.md#how-daemon-pods-are-scheduled)에서 확인할 수 있습니다

## DaemonSet의 이력은 ControllerRevision에 저장합니다

DaemonSet은 노드별 Pod를 직접 관리하므로 템플릿 집합마다 목표 수를 맡는 ReplicaSet이 필요하지 않습니다
이전 템플릿을 저장하는 역할은 `ControllerRevision`이 담당합니다

| 컨트롤러 | 이력을 저장하는 곳 | 별도 역할 |
|---|---|---|
| Deployment | 이전 ReplicaSet의 Pod template | 그 집합의 목표 Pod 수 관리 |
| DaemonSet | ControllerRevision의 `data` | 직렬화된 템플릿 상태 보관 |

[`ControllerRevision`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/apps/v1/types.go)의 불변 대상은 저장한 `data`입니다
[`ValidateControllerRevisionUpdate`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/apps/validation/validation.go)가 이 필드의 변경을 거부합니다
오브젝트의 모든 필드가 수정 불가능한 것은 아닙니다

실제로 DaemonSet의 [`constructHistory`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/daemon/update.go)는 현재 템플릿과 같은 이력이 이미 있으면 그 이력을 사용하고 필요할 때 `revision`을 높입니다
DaemonSet에도 `revisionHistoryLimit`이 있으며 기본값은 10입니다

### 기본 갱신은 노드에서 옛 Pod를 먼저 삭제합니다

DaemonSet의 기본 전략은 `RollingUpdate`이고 `maxSurge: 0`, `maxUnavailable: 1`입니다
surge가 없는 경로는 허용할 미가용 수 안에서 옛 Pod를 먼저 삭제하고, 관리 루프가 새 Pod를 만듭니다
따라서 교체 중 해당 노드에 가용한 DaemonSet Pod가 없는 구간이 생길 수 있습니다

`maxSurge`를 사용하면 한 노드에서 옛 Pod와 새 Pod가 겹칠 수 있습니다
이때 같은 `hostPort`를 확보하거나 hostNetwork에서 같은 주소·포트를 사용하는 워크로드라면 겹침을 수용할 수 있는지 확인해야 합니다
DaemonSet의 백분율 unavailable은 대상 노드 수를 기준으로 올림하므로 Deployment의 내림 계산을 그대로 적용해서도 안 됩니다

`OnDelete`는 템플릿이 바뀌어도 기존 Pod를 자동 교체하지 않습니다
기존 Pod가 삭제된 뒤 필요한 Pod를 새 템플릿으로 만듭니다
기본값은 [`SetDefaults_DaemonSet`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/apps/v1/defaults.go), 갱신 순서는 [`rollingUpdate`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/daemon/update.go)에 있습니다

## ReplicaSet 축소는 별도 규칙으로 삭제할 Pod를 고릅니다

Deployment가 어느 ReplicaSet을 얼마나 줄일지 정해도 구체적으로 어떤 Pod를 지울지는 ReplicaSet이 고릅니다
[`ActivePodsWithRanks.Less`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/controller_utils.go)는 다음 순서로 두 후보를 비교합니다
앞선 규칙에서 차이가 나면 뒤 규칙까지 비교하지 않습니다

| 순서 | 먼저 삭제할 후보 |
|---|---|
| 1 | 노드에 배정되지 않은 Pod |
| 2 | phase가 Pending, Unknown, Running인 순서 |
| 3 | Ready가 아닌 Pod |
| 4 | `pod-deletion-cost`가 낮은 Pod, 기능 활성 시 |
| 5 | 같은 노드에 관련 활성 Pod가 더 많은 Pod |
| 6 | Ready 유지 시간이 짧은 Pod, 시간 비교 조건 적용 |
| 7 | 컨테이너 재시작 횟수가 많은 Pod |
| 8 | 더 최근 생성된 Pod, 시간 비교 조건 적용 |

`controller.kubernetes.io/pod-deletion-cost`는 삭제 선호를 표현하는 int32 annotation입니다
기본값은 0이고 음수도 허용하지만, 값이 낮아도 앞선 노드 배정·phase·Ready 비교를 뒤집지는 못합니다
기능은 기본 on인 `PodDeletionCost` gate를 따르며 삭제 순서를 보장하는 계약은 아닙니다
값을 자주 고치면 Pod update 요청도 늘어나므로 삭제 선호를 지속적으로 재계산해 쓰는 데에는 주의가 필요합니다

API 서버는 잘못된 형식의 값을 `must be a 32bit integer`로 거부합니다
`+10`이나 `008`도 허용하지 않습니다
이전 잘못된 값의 호환을 허용하는 검증 분기가 있으며, 컨트롤러 쪽 파싱이 실패하면 0으로 처리합니다
확인 경로는 [`ValidatePodSpecificAnnotations`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go)와 [`GetDeletionCostFromPodAnnotations`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/helper/helpers.go)입니다

### 노드의 rank는 관련 활성 Pod 수를 셉니다

다섯 번째 규칙의 실행 코드는 Ready Pod 수만 세지 않습니다
[`getPodsRankedByRelatedPodsOnSameNode`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/replicaset/replica_set.go)는 종료되지 않았고 삭제 중이 아닌 활성 Pod 수로 노드별 rank를 만듭니다

관련 Pod도 현재 ReplicaSet 하나에만 한정하지 않습니다
같은 controller를 소유자로 가진 ReplicaSet들을 찾고, 그 selector로 조회한 Pod들을 중복 제거해 사용합니다
Deployment의 새 집합과 옛 집합이 모두 활성이라면 형제 ReplicaSet의 Pod도 이 계산에 들어갈 수 있습니다
`Less`의 Ready·같은 ReplicaSet이라는 주석만으로 실제 집계를 해석해서는 안 됩니다

시간 비교에도 조건이 있습니다
Ready 시각이나 생성 시각이 다르고 유효한 현재 시각이 있으면 경과 시간을 밑이 2인 로그 구간으로 나눕니다
서로 다른 시각이 같은 구간에 들면 UID로 순서를 가릅니다
시각이 같거나 비어 있는 경우까지 항상 UID 비교로 끝난다고 보장하지는 않습니다

이 정렬은 스케줄러의 preemption이나 kubelet의 node-pressure eviction과 다릅니다
노드 압박을 해소하려고 희생자를 고르는 것이 아니라 ReplicaSet의 목표 수를 줄이기 위한 선택입니다

## 상태와 이력을 함께 봐야 멈춘 지점을 구분할 수 있습니다

| 증상 | 먼저 구분할 조건 |
|---|---|
| 새 ReplicaSet 생성 실패 | Deployment의 `ReplicaSetCreateError`, 쿼터·admission 등의 실제 message |
| 새 Pod가 있으나 옛 집합이 줄지 않음 | 새 집합의 available 수, `minReadySeconds`, probe와 자원 조건 |
| `ProgressDeadlineExceeded` | 마지막 진행 이후 경과 시간, 자동 롤백과 reconcile 지속의 차이 |
| `Progressing=True`가 계속 남음 | 진행 중인지 완료 뒤 `NewReplicaSetAvailable`인지 reason 확인 |
| undo 대상 revision을 찾지 못함 | 남은 ReplicaSet 이력, 요청한 revision, 정리 여부 |
| undo 뒤 replica 수가 그대로임 | 템플릿 복원과 Deployment 전체 복원의 차이 |
| DaemonSet Pod가 Pending | 제한된 대상 노드의 자원·스케줄링 실패 조건 |
| DaemonSet affinity가 템플릿과 다름 | 대상 판정 뒤 필수 affinity를 노드 이름으로 대체했는지 |
| cordon한 노드에 DaemonSet Pod가 생김 | 자동 `unschedulable` toleration |

롤아웃의 목표 replica 수, available 수, 템플릿 revision은 각각 다른 사실을 나타냅니다
이 세 값을 분리하면 생성 요청은 진행됐는데 가용성은 늘지 않는 경우와, 이전 템플릿을 적용하며 새 revision으로 진행하는 경우를 구분할 수 있습니다
