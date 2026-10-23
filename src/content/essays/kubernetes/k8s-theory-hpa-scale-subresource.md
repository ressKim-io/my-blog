---
title: "HPA와 scale subresource — replica 계산과 필드 소유권의 경계"
excerpt: "HPA가 지표에서 replica 수를 계산하고 scale 경로로 쓰는 과정을 따라갑니다. 누락 지표·준비 상태·허용 오차·안정화와 변경 정책을 구분하고, GitOps와의 SSA 소유권 충돌이 생기는 위치를 확인합니다"
category: "kubernetes"
tags: ["Kubernetes", "HPA", "Autoscaling", "ServerSideApply", "GitOps", "concept"]
series:
  name: "k8s-theory-node"
  order: 18
date: "2026-10-23"
---

HPA(Horizontal Pod Autoscaler)는 지표를 보고 워크로드의 목표 replica 수를 바꾸는 컨트롤러입니다
Deployment를 대상으로 한다면 그 결과는 Deployment의 `spec.replicas`에 들어갑니다

GitOps 매니페스트도 같은 필드를 쓸 수 있습니다
그러나 HPA가 값을 계산하는 규칙과, 서버가 두 작성자의 필드 소유권을 처리하는 규칙은 다릅니다
계산이 끝난 뒤 `/scale`로 보내는 실제 쓰기까지 따라가야 두 문제를 구분할 수 있습니다

> **근거**: Kubernetes v1.37.1 소스와 공식 문서를 바탕으로 설명합니다
> 소스 ref: `f78e722310e50bcaca9276be22276d9e91d91308`
> 공식 문서 저장본: `kubernetes/website@7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 계산 예시는 가정이며, 클러스터 실습이나 GitOps 도구의 실제 충돌을 재현한 기록은 포함하지 않습니다

## HPA는 지표를 읽고 목표 개수를 갱신합니다

HPA의 `scaleTargetRef`는 조정할 대상의 `apiVersion`·`kind`·`name`을 가리킵니다
컨트롤러는 RESTMapper로 Kind를 API 리소스에 대응시키고, 대상의 `/scale`을 읽어 현재 목표 replica 수와 Pod selector를 얻습니다

지표는 설정한 종류에 맞는 API에서 가져옵니다
CPU·메모리 같은 Resource 지표는 `metrics.k8s.io`, 사용자 정의 지표는 `custom.metrics.k8s.io`, 외부 지표는 `external.metrics.k8s.io`를 사용합니다
HPA가 kubelet을 직접 스크레이프하는 구조는 아닙니다

CPU·메모리 Metrics API의 대표 구현은 metrics-server입니다
수집과 표본 보관은 [관측 경로 편](/essays/k8s-theory-node-observability-sources)에서 다뤘으며, 여기서는 API에서 받은 지표를 계산에 사용하는 경로를 봅니다

![HPA가 Metrics API의 지표를 계산하고 허용 오차와 안정화·정책을 적용한 뒤 API 서버의 scale을 갱신하며 Deployment 컨트롤러가 ReplicaSet으로 배분하는 흐름|tall](/diagrams/k8s-theory-hpa-scale-subresource-1.svg)

기본 조정 주기는 kube-controller-manager의 `--horizontal-pod-autoscaler-sync-period`가 정하며 기본값은 15초입니다
이 주기는 지표의 측정 간격이나 Pod가 실제로 늘어나는 시간과 같지 않습니다
HPA가 목표를 저장해도 그 수만큼의 Pod가 즉시 Running이 된다는 보장은 없습니다

실제 조회는 [메트릭 클라이언트](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/podautoscaler/metrics/client.go), 대상과 조정 루프는 [`scaleForResourceMappings`·`reconcileAutoscaler`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/podautoscaler/horizontal.go)에 있습니다

## 비율을 개수로 바꾸기 전에 계산 대상을 고릅니다

단순한 계산 관계는 `desiredReplicas = ceil(currentReplicas × 현재 지표값 / 목표 지표값)`입니다
`ceil`은 올림이며, 이 식만 보면 목표를 조금 넘겨도 replica 하나가 더 추천될 수 있습니다

다만 실제 구현은 지표 종류와 대상 Pod 상태에 따라 계산에 넣는 개수를 조정합니다
request 대비 사용률 경로는 누락·미준비 보정이 없는 경우에도 비율에 `readyPodCount`를 곱하므로, 현재 목표 replica 수를 모든 분기에서 그대로 곱하는 것은 아닙니다

CPU request 대비 사용률의 분모는 노드 CPU 총량이나 limit이 아니라 계산 대상의 request입니다
구현은 지표 사용량 합계와 대응하는 request 합계로 현재 사용률을 구하고, 이 사용률을 목표 사용률로 나눕니다
현재 사용률은 정수 백분율로 계산하므로 소수 사용률을 그대로 유지한 단순식과 경계에서 결과가 다를 수 있습니다

컨테이너 수준 request 경로는 일반 컨테이너와 계속 실행되는 restartable init container의 요청을 합산합니다
지원되는 Pod-level request를 사용하는 경로도 있으며, `ContainerResource`로 특정 컨테이너를 선택하면 그 컨테이너의 request를 우선합니다
필요한 request가 없으면 사용률을 계산할 수 없으며, [스케줄러의 Score 전용 가정값](/essays/k8s-theory-resource-accounting-scoring)을 대신 넣지 않습니다

이 조건은 [`calculateRequests`·`GetResourceReplicas`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/podautoscaler/replica_calculator.go)와 [`GetResourceUtilizationRatio`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/podautoscaler/metrics/utilization.go)에 근거합니다

### 허용 오차는 목표 근처의 반응을 줄입니다

허용 오차는 현재값과 목표값의 비율이 1 근처에 있을 때 스케일을 건너뛰는 범위입니다
판정식은 `(1 - scaleDown 허용 오차) ≤ 비율 ≤ (1 + scaleUp 허용 오차)`입니다

클러스터 기본값은 `--horizontal-pod-autoscaler-tolerance`가 정하며 기본은 `0.1`입니다
목표 사용률이 50%라면 비율상 45%~55% 구간이 변경을 건너뛰는 범위에 해당합니다

올림의 영향만 보면 replica가 10개이고 계산에 사용하는 비율이 `1.008`이라는 **가정**에서 `ceil(10 × 1.008)`은 11입니다
허용 오차는 이런 작은 편차에 즉시 반응하는 일을 줄입니다
CPU request 대비 사용률을 대입할 때는 앞 절의 정수 계산부터 적용해야 합니다

HPA별 설정은 `spec.behavior.scaleUp.tolerance`와 `scaleDown.tolerance`로 방향을 나눕니다
`HPAConfigurableTolerance`는 v1.35에서 beta·기본 on이었고, 현재 v1.37에서는 GA·기본 on으로 잠겨 있습니다
이 값을 생략하면 컨트롤러의 기본 허용 오차를 사용하며, 그 전역 기본값을 Kubernetes API로 바꾸는 것은 아닙니다

기본값과 플래그는 [컨트롤러 설정 기본값](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/podautoscaler/config/v1alpha1/defaults.go)과 [플래그 등록](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kube-controller-manager/app/options/hpacontroller.go), 기능 상태는 [gate 정의](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go)에 있습니다

### 누락 지표와 미준비 Pod는 보수적으로 보정합니다

지표가 없는 Pod를 단순히 제외하면 남아 있는 지표만으로 확대·축소 폭이 커질 수 있습니다
계산에 쓸 지표가 남아 있는 경우, HPA는 스케일 방향에 따라 누락값을 가정하고 비율을 다시 구합니다

| 계산 경로와 방향 | 누락된 Pod의 가정값 |
|---|---|
| request 대비 사용률로 축소 | request의 `max(100, 목표 사용률)%`를 사용한다고 가정 |
| request 대비 사용률로 확대 | 사용량 0으로 가정 |
| Pod별 절대 사용량 목표로 축소 | 목표 사용량 자체를 사용한다고 가정 |
| Pod별 절대 사용량 목표로 확대 | 사용량 0으로 가정 |

축소에서는 누락된 사용량을 높은 쪽으로 채워 과도하게 줄이는 일을 막습니다
확대에서는 0으로 채워 높은 평균을 낮추므로 확대 폭을 줄입니다
request의 100%는 노드 자원 총량의 100%도, 현재 목표값의 100%도 아닙니다

미준비 Pod 분류는 지표 누락과 별도입니다
삭제 중이거나 Failed인 Pod는 제외하고, Pending인 Pod는 미준비로 분류합니다
CPU는 Ready 조건과 시작 시각 외에 지표의 Timestamp·Window와 Ready 전환 시각도 확인합니다

CPU 초기화 기간은 기본 5분, initial readiness delay는 기본 30초입니다
5분 동안 CPU 지표를 무조건 전부 버리는 것이 아니라, 해당 기간의 준비 상태와 표본 시점으로 사용할 지표를 고릅니다
확대 계산에서 미준비 Pod를 보정하는 분기는 이들의 사용량을 0으로 둡니다

보정한 비율이 허용 오차 안으로 들어오거나 스케일 방향을 뒤집으면 변경하지 않습니다
보정 후 계산한 개수의 방향을 다시 확인하는 조건도 있습니다
이 값들은 실제 사용량을 측정한 결과가 아니라 불확실한 표본으로 변경 폭을 키우지 않기 위한 계산상의 가정입니다

지표가 전혀 남지 않거나 필요한 request를 구할 수 없으면 계산은 실패합니다
여러 지표를 설정하면 각각의 추천 중 가장 큰 값을 선택하며, 일부 지표가 실패한 상태에서 나머지가 축소를 권하면 축소를 건너뜁니다
반면 유효한 지표가 확대를 권하면 확대할 수 있습니다

보정은 [`groupPods`·`GetResourceReplicas`·`calcPlainMetricReplicas`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/podautoscaler/replica_calculator.go), 여러 지표의 결합은 [`computeReplicasForMetrics`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/podautoscaler/horizontal.go)에 있습니다

## 안정화 창은 과거의 추천값을 기억합니다

허용 오차가 현재 비율의 작은 편차를 다룬다면, 안정화 창은 최근 추천이 바뀐 이력을 사용합니다
보관하는 것은 실제 실행된 replica 수의 이력이 아니라 제한을 적용하기 전의 추천값입니다

기본 scale down 창은 최근 추천의 최댓값을 골라 줄이기를 늦춥니다
예를 들어 창 안에 추천 7과 3이 남아 있다면 7을 선택하므로 낮아진 추천 3에 바로 맞추지 않습니다

기본 scale up 창은 0초입니다
`behavior.scaleUp.stabilizationWindowSeconds`를 0보다 크게 설정하면 그 창의 추천 최솟값을 사용해 확대도 늦출 수 있습니다

| 방향 | 기본 창 | 기본값의 출처 |
|---|---|---|
| scale up | 0초 | HPA API의 behavior 기본값 |
| scale down | 300초 | 컨트롤러의 `--horizontal-pod-autoscaler-downscale-stabilization` |

scale down의 API 기본값은 `nil`입니다
컨트롤러 플래그로 바꾼 값을 API 기본값이 덮어쓰지 않도록 비워 두고, 조정할 때 컨트롤러가 채웁니다
창을 썼다는 이유로 300초 뒤 반드시 정해진 수만큼 줄어드는 것은 아니며 이후 지표·추천·정책을 다시 평가합니다

### behavior 생략과 기본 behavior는 다른 경로입니다

`spec.behavior`가 없으면 컨트롤러는 legacy 경로를 사용합니다
API 기본값 처리도 behavior가 있을 때만 그 내부를 채우므로, 생략한 HPA에 문서의 기본 behavior 정책이 자동으로 저장되는 것은 아닙니다

| 항목 | `behavior == nil` | `behavior != nil`의 기본 정책 |
|---|---|---|
| 안정화 | 컨트롤러의 down 창 | 방향별 창, 기본 up 0초·down은 컨트롤러 값 |
| 증가 상한 | 한 번의 목표 상한 `max(현재 × 2, 4)` | 15초 동안 4개 또는 100% 중 더 큰 변경 허용 |
| 감소 상한 | 별도 속도 제한 없이 min까지 가능 | 15초 동안 100%, min 제한은 계속 적용 |
| 방향별 중지 | 별도 설정 없음 | `selectPolicy: Disabled` |

정책의 기간은 조정 주기와 다릅니다
behavior 경로는 해당 기간에 이미 늘리거나 줄인 개수를 이력에서 반영하므로, 조정 루프가 돌 때마다 정책 한도를 새로 모두 쓰는 것은 아닙니다
`selectPolicy: Max`는 더 큰 변경을 허용하는 정책을, `Min`은 더 작은 변경을 허용하는 정책을 고릅니다

API의 기본 behavior는 [`SetDefaults_HorizontalPodAutoscalerBehavior`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/autoscaling/v2/defaults.go), 실제 안정화와 변경 속도 제한은 [`normalizeDesiredReplicas`·`normalizeDesiredReplicasWithBehaviors`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/podautoscaler/horizontal.go)에 있습니다

### 재시작하면 세부 이력을 잃습니다

`recommendations`·`scaleUpEvents`·`scaleDownEvents`는 컨트롤러 메모리의 맵입니다
오브젝트에 이력을 계속 저장하는 방식이 아니므로 프로세스 재시작이나 리더 교체 때 이전 컨트롤러의 세부 이력은 이어지지 않습니다

다만 첫 조정에서 현재 목표 replica 수를 초기 추천으로 기록합니다
현재 개수가 높은 상태라면 이 값이 기본 down 창 안에서 축소를 막을 수 있습니다
따라서 재시작으로 과거 이력을 잃었다는 사실을 모든 scale down 제동이 즉시 사라진다는 뜻으로 해석하면 안 됩니다

관련 처리는 [`recordInitialRecommendation`과 이력 맵 초기화](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/podautoscaler/horizontal.go)에 있습니다

## scale은 같은 저장 오브젝트를 다른 형태로 보여줍니다

Deployment 본체와 `/scale`은 같은 저장 오브젝트와 etcd 키를 사용합니다
`/scale` GET의 `autoscaling/v1 Scale`은 별도로 저장한 복사본이 아니라 Deployment의 replica 값과 selector를 뽑아 만든 표현입니다
메타데이터의 resourceVersion도 본체에서 가져옵니다

| 요청 경로 | API 리소스 이름 | 다루는 내용 |
|---|---|---|
| Deployment 본체 | `deployments` | Deployment 전체 표현 |
| Deployment의 `/scale` | `deployments/scale` | 목표·상태 replica 수와 selector를 읽고 목표 replica 수 갱신 |

별도 subresource이므로 RBAC 권한을 나눌 수 있습니다
`deployments/scale`의 갱신 권한만으로 이미지나 Deployment selector를 고칠 수는 없습니다
본체 갱신 권한이 있더라도 개별 필드의 변경 가능 여부는 validation을 따릅니다

![GitOps의 Deployment Apply와 HPA의 scale Update가 같은 Deployment의 replicas와 managedFields로 합쳐지고 Deployment 컨트롤러는 ReplicaSet을 갱신하는 관계](/diagrams/k8s-theory-hpa-scale-subresource-2.svg)

Deployment·ReplicaSet·StatefulSet이나 scale을 제공하는 CRD는 본체 모양이 달라도 Scale 표현으로 조정할 수 있습니다
HPA는 대상 Kind마다 전체 오브젝트를 수정하는 대신 이 공통 경로를 사용합니다
Deployment 구현은 [`ScaleREST`·`scaleFromDeployment`·`scaleUpdatedObjectInfo`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/apps/deployment/storage/storage.go)에 있습니다

## HPA의 Update와 GitOps의 Apply는 충돌 방식이 다릅니다

`metadata.managedFields`는 어느 매니저가 어떤 필드를 관리하는지 서버가 기록한 목록입니다
여기서 매니저는 GitOps 도구나 컨트롤러 같은 작성 흐름의 식별자이며, 필드 소유권은 API 요청 권한과 다릅니다

RBAC은 요청을 허용할지 판단합니다
SSA(Server-Side Apply)는 Apply 요청이 다른 매니저가 관리하는 필드의 값을 바꾸려 할 때 소유권 충돌을 판단합니다
필드를 관리한다는 기록이 RBAC 권한을 부여하는 것도, 다른 작성자의 일반 Update를 막는 것도 아닙니다

HPA는 `Scales(ns).Update(...)`를 사용하며 SSA Apply를 보내지 않습니다
실제로 replica 값을 바꾼 Update는 다른 매니저의 SSA 소유권 때문에 거절되지 않으며 필드 관리 기록에도 반영됩니다

서버는 본체의 replica 소유권을 Scale의 managedFields로 변환하고, 처리 후 다시 본체로 합칩니다
이 과정에서 이전 매니저가 잃은 `spec.replicas` 경로를 그 매니저의 필드 집합에서 제거합니다
남은 필드 집합이 비면 해당 managedFields 항목 자체도 없어질 수 있습니다

이는 replica 값을 지우는 처리가 아닙니다
새 값은 저장하면서 누가 그 경로를 관리하는지 기록을 바꾸는 것이며, [`ScaleHandler.ToSubresource`·`ToParent`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/util/managedfields/scalehandler.go)가 이 변환을 담당합니다

### resourceVersion 충돌은 여전히 가능합니다

HPA가 Scale을 읽은 뒤 다른 요청이 저장 오브젝트를 먼저 바꾸면 Update도 `resourceVersion` 불일치로 409 Conflict를 받을 수 있습니다
컨트롤러는 `RetryOnConflict` 안에서 최신 Scale을 다시 읽고 갱신을 재시도합니다
재시도가 소진되거나 다른 오류가 나면 실패를 반환하므로, Update가 항상 성공한다는 뜻은 아닙니다

HPA의 Update는 `fieldManager`를 지정하지 않습니다
서버는 없으면 User-Agent의 첫 `/` 앞 문자열을 매니저 이름으로 사용합니다
표준 `kube-controller-manager` 실행에서는 `kube-controller-manager`가 기록되며, 컨트롤러 이름 `horizontal-pod-autoscaler`를 그대로 기대하면 안 됩니다

이 이름은 호출자의 인증 신원을 대신하는 정보가 아닙니다
이름 생성은 [Update 처리](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/handlers/update.go)·[User-Agent prefix](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/handlers/create.go)·[클라이언트 User-Agent 구성](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/rest/config.go)에 근거합니다

### 소유권 충돌과 번갈아 쓰기를 나눠 봅니다

다음은 GitOps가 SSA를 사용하고, HPA가 다른 목표를 추천한다는 가정입니다
모든 GitOps 도구가 같은 방식으로 동기화한다는 뜻은 아닙니다

| 순서 | 요청 | 값과 소유권의 결과 |
|---|---|---|
| 1 | GitOps Apply로 replicas 3 | 3을 저장하고 GitOps 매니저가 해당 경로 관리 |
| 2 | HPA Update로 replicas 7 | 7로 바꾸고 이전 매니저의 해당 경로 제거 |
| 3 | GitOps가 다시 Apply로 replicas 3 | 소유권 충돌로 실패하며 값은 7 유지 |
| 4 | GitOps가 소유권을 강제로 가져오는 Apply로 3 | 3으로 바꾸고 GitOps가 경로를 다시 관리 |
| 5 | HPA가 다시 Update로 7 | 7로 바꾸고 관리 기록도 다시 변경 |

3에서 충돌을 반환하면 그 요청은 값을 바꾸지 못합니다
4처럼 강제로 되가져오거나 다른 Update가 다시 쓰는 경우에 두 주체가 번갈아 값을 바꿀 수 있습니다
Apply 충돌 하나만으로 replica가 계속 오간다고 단정할 수는 없습니다

`--force-conflicts`는 SSA Apply가 다른 매니저의 필드를 가져오는 옵션입니다
HPA의 일반 Update에 적용해 해결하는 옵션이 아닙니다

HPA가 replica를 맡는 구성이라면 GitOps가 계속 그 값을 쓰는지 확인해야 합니다
다만 기존 매니페스트에서 필드를 제거하는 시점도 중요합니다
기존 매니저가 유일한 소유자일 때 HPA가 인계받기 전에 빼면 Deployment의 기본값 1로 돌아갈 수 있으므로, 소유권 인계를 확인하고 제거해야 합니다

이 차이와 인계 조건은 [공식 SSA 문서의 HPA 인계 절](https://kubernetes.io/docs/reference/using-api/server-side-apply/#transferring-ownership-between-managers)에서 설명합니다

## 롤아웃은 ReplicaSet에 개수를 배분합니다

HPA가 Deployment의 목표 수를 바꾸면 Deployment 컨트롤러는 그 값을 읽고 ReplicaSet들에 나눠 적용합니다
이때 쓰는 대상은 Deployment의 `/scale`이 아니라 ReplicaSet 본체의 `spec.replicas`입니다

ReplicaSet에 `deployment.kubernetes.io/desired-replicas`와 `max-replicas` 어노테이션도 기록합니다
기록한 목표는 현재 Deployment 목표와 비교해 스케일 변경 등을 판단하는 데 사용합니다
HPA의 입력으로 쓰는 별도 목표값은 아닙니다

따라서 HPA와 Deployment 컨트롤러가 같은 Deployment replica 필드를 서로 되돌리는 구조로 보면 안 됩니다
ReplicaSet 갱신은 [`scaleReplicaSet`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/deployment/sync.go), 어노테이션은 [`SetReplicasAnnotations`·`DesiredReplicasAnnotation`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/deployment/util/deployment_util.go)에 있습니다

## CRD는 Scale에 대응시킬 경로를 선언합니다

임의의 Custom Resource에서 replica 수와 selector가 어디 있는지 서버가 알 수는 없습니다
CRD의 `subresources.scale`은 본체의 JSON 경로를 Scale의 각 필드에 대응시킵니다

| CRD 설정 | Scale의 필드 | CR 안의 해당 경로에 값이 없을 때 |
|---|---|---|
| `specReplicasPath` | `spec.replicas` | `/scale` GET 오류 |
| `statusReplicasPath` | `status.replicas` | 0으로 표시 |
| `labelSelectorPath` | `status.selector` | 빈 문자열 |

`labelSelectorPath`는 CRD 설정에서 선택 필드지만 HPA와 함께 쓰려면 필요합니다
가리키는 값도 selector 오브젝트가 아니라 직렬화된 label selector 문자열이어야 합니다
HPA는 Scale의 selector가 비어 있으면 `SelectorRequired` 이벤트와 `ScalingActive=False`의 `InvalidSelector` 사유로 계산을 중단합니다

근거는 [CRD Scale 타입](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1/types.go), [CR의 Scale 변환](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/registry/customresource/etcd.go), [HPA selector 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/podautoscaler/horizontal.go)에 있습니다

## 계산 실패와 쓰기 실패를 구분합니다

| 증상 | 확인할 경계 |
|---|---|
| `AbleToScale=False`, `FailedGetScale` | scaleTargetRef·대상 Kind 매핑·scale 제공 여부·조회 권한 |
| `ScalingActive=False`, `InvalidSelector` | Scale selector가 비었거나 유효하지 않은지 |
| 지표 조회 또는 사용률 계산 오류 | Metrics API 경로·표본·필요한 request 선언 |
| 조금 높은 지표에도 확대하지 않음 | 허용 오차와 누락·미준비 보정 |
| `ScaleDownStabilized` | 안정화 창 안의 더 큰 과거 추천 |
| `ScalingLimited=True` | min/max replica 또는 방향별 변경 정책 |
| HPA Update의 409 Conflict | resourceVersion 경합과 재시도 결과 |
| GitOps SSA Apply의 필드 충돌 | replicas를 관리하는 다른 매니저와 값 차이 |
| replica가 두 값 사이를 오감 | 어떤 주체가 어떤 요청 방식으로 값을 다시 쓰는지 |

지표에서 추천한 수, 정책으로 제한한 수, `/scale`에 저장한 목표, 실제 준비된 Pod 수는 구분해서 봐야 합니다
managedFields는 마지막 쓰기의 관계를 설명하지만, HPA가 왜 그 수를 계산했는지는 지표·보정·허용 오차·추천 이력과 정책에서 확인해야 합니다

## 참고 자료

- [Horizontal Pod Autoscaling 공식 문서](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/)
- [Server-Side Apply 공식 문서](https://kubernetes.io/docs/reference/using-api/server-side-apply/)
- [CRD scale subresource 공식 문서](https://kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definitions/#scale-subresource)
