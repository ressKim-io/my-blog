---
title: "StatefulSet과 볼륨 수명 — PVC를 지우기 전에 주인을 정합니다"
excerpt: "StatefulSet의 PVC 보존 정책과 ownerReferences, 스케일다운·강제 삭제·PV 회수 정책의 경계를 살펴봅니다"
category: kubernetes
tags: ["kubernetes", "statefulset", "persistent-volume", "concept"]
series:
  name: "k8s-theory-storage"
  order: 4
date: "2026-10-25"
---

StatefulSet의 복제본을 3개에서 2개로 줄이면 `web-2` Pod는 삭제 대상이 됩니다
그런데 영속 볼륨 요청인 PVC(PersistentVolumeClaim) `data-web-2`는 기본 설정에서 남습니다
다시 3개로 늘리면 새 `web-2`가 그 PVC를 사용합니다

Pod 교체와 저장소 삭제를 별개로 다루기 때문입니다
StatefulSet 컨트롤러는 PVC에 누구의 수명을 따를지 기록하고, 가비지 컬렉터(GC)가 그 소유 관계에 따라 삭제를 처리합니다

> Kubernetes v1.37.1의 공식 소스와 문서를 대조한 개념 설명입니다
> 아래 이름과 복제본 수는 동작을 설명하는 예시이며 클러스터에서 실행한 결과는 아닙니다

## 같은 서수가 새 Pod를 기존 PVC에 연결합니다

StatefulSet은 복제본마다 서수(ordinal)라는 정수 식별자를 부여합니다
기본 시작값은 0이며, `spec.ordinals.start`를 지정하면 관리 범위는 `start`부터 `start + replicas - 1`까지입니다

StatefulSet 이름이 `web`, 볼륨 요청 템플릿 이름이 `data`라면 이름은 다음과 같이 대응합니다

| 대상 | 이름 규칙 | 서수 2의 예 |
|---|---|---|
| Pod | `<StatefulSet 이름>-<서수>` | `web-2` |
| PVC | `<템플릿 이름>-<StatefulSet 이름>-<서수>` | `data-web-2` |
| Pod DNS | `<Pod 이름>.<governing Service 도메인>` | `web-2.nginx.default.svc.cluster.local` |

Pod가 삭제된 뒤 같은 서수로 다시 만들어져도 이름은 같습니다
그러나 Kubernetes 오브젝트의 고유 식별자인 UID는 달라집니다. 유지되는 것은 복제본의 이름과 저장소 대응이며 이전 Pod 오브젝트 자체가 아닙니다

![교체 전후 Pod는 이름이 같고 UID는 다르지만 보존된 동일 PVC를 참조하는 관계](/diagrams/k8s-theory-statefulset-volume-lifecycle-1.svg)

그림은 교체 전과 후의 관계를 나누어 표시한 것입니다
두 Pod가 동시에 볼륨을 사용한다는 뜻은 아닙니다. PVC가 보존됐을 때 새 Pod가 같은 PVC를 다시 찾는 과정을 보여 줍니다

공식 문서에서 말하는 신원·저장소의 안정성은 Pod를 다시 스케줄해도 이 대응이 유지된다는 의미입니다
Pod나 데이터가 영구히 삭제되지 않는다는 보장은 아닙니다

DNS 이름에는 별도 조건이 있습니다
예시의 `nginx`는 `spec.serviceName`이 가리키는 headless Service이며 사용자가 만들어야 합니다
headless Service는 대표 IP 대신 개별 Pod의 주소를 노출합니다
StatefulSet이 Service까지 생성하지는 않습니다

`serviceName`은 API에서 선택 필드이고, 현재 검증은 값이 있을 때 이름 형식을 검사합니다
따라서 StatefulSet 생성이 허용됐다는 사실만으로 governing Service가 존재하거나 DNS가 준비됐다고 판단할 수 없습니다

Service의 selector와 엔드포인트가 맞아야 하며, Pod별 DNS 레코드는 기본적으로 readiness 조건의 영향도 받습니다
`publishNotReadyAddresses: true`인 Service는 준비되지 않은 주소도 게시할 수 있습니다

이전 조회 실패를 DNS가 캐시했다면 Pod가 준비된 뒤에도 이름 조회가 잠시 실패할 수 있습니다. [공식 DNS 문서](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/#pod-hostname-and-subdomain-field)

## PVC를 먼저 만들고 Pod를 생성합니다

`volumeClaimTemplates`는 복제본별 PVC를 만드는 템플릿입니다
StatefulSet 컨트롤러의 `CreateStatefulPod`는 필요한 PVC를 먼저 확인·생성하고 Pod 생성 API를 호출한 뒤 보존 정책의 소유 참조를 반영합니다

PV(PersistentVolume)는 실제 영속 볼륨을 나타내는 Kubernetes 오브젝트입니다
이 단계에서 PVC 오브젝트를 만드는 주체는 StatefulSet 컨트롤러입니다
PVC를 PV에 바인딩하거나 실제 저장 장치를 마련하는 작업은 [PV 컨트롤러와 프로비저너](/essays/k8s-theory-pvc-storageclass-binding)의 역할로 이어집니다

`createPersistentVolumeClaims`는 같은 이름의 PVC가 있으면 재사용합니다
기존 PVC의 요청 용량이나 접근 모드를 템플릿에 맞춰 갱신하지는 않습니다. 삭제 중인 PVC라면 다음 오류를 반환합니다

```text
pvc <name> is being deleted
```

기존 StatefulSet의 `volumeClaimTemplates` 자체를 수정하는 것도 현재 API 검증에서 허용하지 않습니다
템플릿 크기를 바꿔 기존 PVC나 앞으로 생성될 PVC에 적용하는 경로로 생각하면 안 됩니다. 이미 만들어진 PVC의 확장은 별도 작업입니다

같은 이름만으로 재사용해도 되는지 추가 검사하는 경우도 있습니다
`whenScaled: Delete`에서 PVC가 이전 `web-2`의 UID를 소유 참조로 갖고 있다면, `PodClaimIsStale`은 새 Pod 생성을 기다리게 합니다

이 PVC는 이전 Pod를 따라 GC가 삭제할 수 있는 대상입니다
새 UID의 Pod가 삭제 예정 PVC를 먼저 재사용하지 않도록 막는 검사이며, `whenScaled: Retain`에서는 이 재사용 차단을 적용하지 않습니다. [PVC 생성·정책 처리 소스](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/statefulset/stateful_pod_control.go)

## 두 보존 정책은 삭제 계기를 나눕니다

`spec.persistentVolumeClaimRetentionPolicy`는 `volumeClaimTemplates`로 생성하는 PVC의 보존 동작을 정합니다

- **`whenScaled`**: 스케일다운으로 관리 범위에서 빠진 Pod의 PVC를 어떻게 처리할지 정합니다
- **`whenDeleted`**: StatefulSet 자체를 삭제할 때 PVC를 어떻게 처리할지 정합니다

두 필드는 각각 `Retain` 또는 `Delete`를 사용하며 기본값은 모두 `Retain`입니다
현재 API의 `SetDefaults_StatefulSet`이 생략한 필드를 채우고, 컨트롤러의 정책 조회 함수도 정책 객체가 없으면 두 값을 `Retain`으로 해석합니다

이 기능은 v1.32에서 stable이 됐습니다
확인한 v1.37.1 구현은 `StatefulSetAutoDeletePVC` 게이트 설정 없이 이 보존 정책을 처리합니다

아래는 스케일다운 때 PVC를 삭제하고 StatefulSet 삭제 때는 보존하는 정책 부분입니다

```yaml
spec:
  persistentVolumeClaimRetentionPolicy:
    whenScaled: Delete
    whenDeleted: Retain
```

노드 장애 등으로 관리 범위 안의 Pod를 교체하는 일은 스케일다운이 아닙니다
`whenScaled: Delete`여도 이 교체를 이유로 기존 PVC를 삭제하지 않습니다
다른 노드에서 볼륨을 다시 사용하는 실제 attach·mount 과정은 별도로 진행됩니다

`Retain`의 기본 동작은 복제본 수를 바꾸거나 워크로드를 지운 일이 곧 데이터 삭제로 이어지지 않게 합니다
다만 다른 사용자가 PVC를 직접 삭제하는 것까지 막는 정책은 아닙니다

## 삭제 정책은 PVC의 소유 참조로 바뀝니다

`ownerReferences`는 종속 오브젝트가 어느 소유 오브젝트에 연결되는지 기록하는 메타데이터입니다
StatefulSet 컨트롤러는 보존 정책에 따라 PVC의 이 참조를 바꾸고, GC가 관계를 읽어 종속 오브젝트를 정리합니다

다음 표는 낡은 UID의 참조나 다른 컨트롤러와의 충돌이 없는 정상 상태에서, 이 보존 정책이 설정하는 컨트롤러 소유 참조입니다
‘없음’은 StatefulSet 또는 해당 Pod를 가리키는 정책 참조가 없다는 의미입니다

| `whenScaled` | `whenDeleted` | 관리 범위 안의 Pod에 대응하는 PVC | 관리 범위 밖의 Pod에 대응하는 PVC |
|---|---|---|---|
| `Retain` | `Retain` | 없음 | 없음 |
| `Retain` | `Delete` | StatefulSet | StatefulSet |
| `Delete` | `Retain` | 없음 | 해당 Pod |
| `Delete` | `Delete` | StatefulSet | 해당 Pod |

관리 범위 밖의 Pod를 구현에서는 `condemned Pod`라고 부릅니다
서수 시작값이 기본 0이라면 복제본을 3개에서 2개로 줄일 때 `web-2`가 여기에 해당합니다. 시작 서수를 바꿔 범위를 벗어난 Pod도 같은 판정 경로에 들어갑니다

두 정책이 모두 `Delete`인 경우를 보면 소유 참조를 바꾸는 이유가 분명해집니다
범위 안에서는 `data-web-2`의 소유자가 StatefulSet이지만, 스케일다운 대상이 되면 소유자를 `web-2` Pod로 바꿉니다

StatefulSet이 계속 존재해도 해당 Pod를 지우면 PVC를 정리할 수 있어야 하기 때문입니다
GC는 삭제 중이 아닌 유효한 소유자가 남아 있으면 종속 오브젝트를 보존할 수 있습니다
두 정책이 `Delete`라고 해서 StatefulSet과 Pod를 동시에 소유자로 남기지는 않습니다

![두 정책이 Delete일 때 StatefulSet 컨트롤러가 PVC 소유자를 Pod로 바꾼 뒤 Pod 삭제를 요청하고 GC와 PVC 보호가 삭제를 처리하는 흐름|tall](/diagrams/k8s-theory-statefulset-volume-lifecycle-2.svg)

`updateStatefulSet`은 삭제 대상 Pod들의 PVC 정책을 먼저 확인·반영하고, 그 뒤 `processCondemned`에서 Pod 삭제를 요청합니다
낡은 UID나 소유권 충돌이 없는 정상 경로에서는 소유 참조를 쓰기 전에 스케일다운 Pod를 삭제하지 않도록 순서를 둡니다

참조를 바꾼 뒤에도 Pod와 PVC가 살아 있고 다시 관리 범위에 들어오면, 컨트롤러가 PVC의 소유 참조를 StatefulSet으로 되돌릴 수 있습니다
이미 삭제된 PVC나 데이터를 복구한다는 뜻은 아닙니다

소유 참조에는 UID가 들어갑니다
동일한 이름의 이전 StatefulSet 또는 Pod를 가리키는 낡은 참조는 현재 오브젝트의 참조로 덮어쓰지 않습니다

다른 컨트롤러가 관리하는 PVC도 임의로 인수하지 않으며 `ConflictingController` 경고가 발생할 수 있습니다

따라서 정책 필드만 읽고 실제 삭제 결과를 단정하기보다 PVC의 참조와 UID, 이벤트를 함께 봐야 합니다. [소유 참조를 계산하는 구현](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/statefulset/stateful_set_utils.go), [스케일다운 처리 순서](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/statefulset/stateful_set_control.go)

## Pod의 종료 순서와 PVC 삭제 조건을 구분합니다

기본 `podManagementPolicy: OrderedReady`에서는 낮은 서수부터 Pod를 생성합니다
앞선 Pod가 `Running`·`Ready`이고, `minReadySeconds`를 지정했다면 그 시간 동안 준비된 상태인 `Available`이어야 다음 진행이 가능합니다
이 때문에 `web-0`이 준비되지 않으면 뒤의 복제본 생성이 멈출 수 있습니다

스케일다운은 높은 서수부터 처리하며 앞선 삭제 대상의 종료를 기다립니다

`Parallel`은 스케일 과정에서 다른 Pod의 준비·종료를 기다리는 제약을 풉니다
복제본의 이름과 신원 대응은 유지합니다

롤링 업데이트에서 동시에 교체할 수 있는 범위에는 `updateStrategy`와 `rollingUpdate.maxUnavailable` 등 별도 설정도 관여합니다

StatefulSet 오브젝트 자체를 삭제할 때에는 `OrderedReady`여도 Pod 종료 순서를 보장하지 않습니다
순서 있는 축소가 필요하다면 `replicas: 0`으로 줄이는 과정과 StatefulSet 삭제를 구분해야 합니다
`whenDeleted: Delete`도 그 자체로 Pod별 종료 순서를 만드는 설정은 아닙니다

PVC에는 별도의 사용 중 삭제 보호가 있습니다
finalizer는 삭제 전 필요한 정리가 끝날 때까지 오브젝트를 남겨 두는 메타데이터입니다
`kubernetes.io/pvc-protection` finalizer는 보호 컨트롤러가 PVC를 사용 중이라고 판단하는 동안 PVC의 최종 삭제를 늦춥니다

이 검사는 노드에서 실제 unmount가 끝났다는 응답을 직접 받는 방식은 아닙니다
확인한 구현은 스케줄된 Pod의 PVC 참조를 informer 캐시에서 찾고, 사용하는 Pod를 찾지 못하면 API 조회도 확인합니다
소유 참조와 이 보호 장치를 kubelet의 볼륨 정리 완료 증명으로 읽으면 안 됩니다

강제 삭제에서는 API 서버가 kubelet의 종료 확인을 기다리지 않고 Pod 오브젝트를 없앨 수 있습니다
컨트롤러가 중단된 사이 스케일다운 Pod를 강제로 삭제하면 PVC 소유 참조가 아직 반영되지 않아 PVC가 남을 수도 있습니다

GC의 foreground·background·orphan 삭제 방식도 종속 오브젝트의 처리에 영향을 줍니다
정상 종료와 정책 반영을 전제로 한 흐름을 강제 삭제나 orphan 삭제에도 그대로 적용할 수는 없습니다. [GC의 삭제 방식](https://kubernetes.io/docs/concepts/architecture/garbage-collection/#cascading-deletion), [강제 Pod 삭제의 범위](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination-forced)

## PVC 다음에는 PV의 회수 정책이 남습니다

StatefulSet의 보존 정책은 PVC가 남을지 결정합니다
PVC가 삭제된 뒤 PV와 실제 저장소를 어떻게 처리할지는 PV의 `persistentVolumeReclaimPolicy`가 정합니다

| 스케일다운 PVC 정책 | PV 회수 정책 | 일반적인 후속 처리 |
|---|---|---|
| `Retain` | `Retain` 또는 `Delete` | PVC가 남아 바인딩을 유지하므로 이 스케일다운만으로 PV 회수를 시작하지 않음 |
| `Delete` | `Retain` | PVC 삭제 후 PV는 `Released`로 남으며 관리자가 정리·재사용 절차를 결정 |
| `Delete` | `Delete` | PVC 삭제 후 해당 볼륨 구현이 PV와 저장소 삭제를 처리 |

`Released`는 이전 PVC가 해제됐다는 상태이며 새 PVC가 바로 가져다 쓰는 `Available`과 다릅니다
기존 `claimRef`와 데이터가 남아 있으므로 같은 이름으로 PVC를 다시 만들어도 이전 바인딩이 자동 복구되지는 않습니다

PV의 사용 중 삭제 보호와 저장소 삭제 완료를 기다리는 finalizer도 별개입니다
예를 들어 CSI 볼륨의 삭제 finalizer는 외부 프로비저너가 담당합니다
StatefulSet 컨트롤러나 GC가 실제 디스크 삭제까지 완료하는 것으로 설명하면 각 구성 요소의 책임이 섞입니다

`Retain`은 데이터 복제나 백업도 아닙니다
정책을 통해 자동 삭제를 피하는 일과 장애 뒤 데이터를 복구할 수 있는 일은 별도로 준비해야 합니다. [PV 회수 정책과 삭제 보호](https://kubernetes.io/docs/concepts/storage/persistent-volumes/#reclaiming)

## Deployment와 비교할 기준은 복제본과 PVC의 대응입니다

Deployment의 Pod 템플릿에 특정 PVC 하나를 적으면 복제본들이 그 PVC 이름을 함께 참조합니다
StatefulSet의 `volumeClaimTemplates`처럼 복제본별 이름을 만들고, 재생성 뒤 같은 서수에 같은 PVC를 다시 대응시키는 기능은 아닙니다

공유 볼륨이 필요한 경우에도 접근 모드와 저장소 지원을 확인해야 합니다
`ReadWriteOnce`는 한 노드의 접근 범위이며 같은 노드의 여러 Pod가 사용할 수 있습니다. 단일 Pod 사용을 제약하는 `ReadWriteOncePod`와 다릅니다

generic ephemeral volume은 Pod별 PVC를 만들 수 있지만 그 PVC는 해당 Pod의 수명을 따릅니다
Pod 교체 전후에 같은 복제본의 영속 저장소를 잇는 StatefulSet과는 목적이 다릅니다

쿼럼 저장소, 리더·팔로워 복제, 샤딩된 저장소처럼 구성원별 데이터와 신원의 대응을 유지해야 한다면 StatefulSet의 이 기능이 필요할 수 있습니다
모든 복제본이 같은 내용을 읽는 캐시라면 같은 요구가 없을 수 있습니다

애플리케이션이 구성원 변경을 스스로 처리하는지도 함께 판단해야 합니다
이름이 바뀐다는 이유만으로 모든 분산 애플리케이션이 실패하는 것은 아닙니다

## PVC가 예상과 다르게 남을 때 확인할 것

| 관찰한 상태 | 확인할 조건 |
|---|---|
| 기본 설정에서 스케일다운 후 PVC가 남음 | `whenScaled: Retain`에 따른 정상 동작인지 확인 |
| `whenScaled: Delete`인데 PVC가 남음 | 현재 서수 범위, PVC 소유 참조의 대상·UID, 컨트롤러 반영 상태와 충돌 이벤트 확인 |
| 강제 Pod 삭제 뒤 PVC가 남음 | 삭제 전에 정책 소유 참조가 기록됐는지 확인 |
| 새 Pod 생성이 지연되며 이전 PVC가 남음 | 이전 Pod UID의 소유 참조, PVC `deletionTimestamp`와 finalizer 확인 |
| 템플릿 변경 요청이 거절됨 | `volumeClaimTemplates` 불변 검증과 개별 PVC 확장 경로 구분 |
| Pod가 있는데 개별 DNS 이름이 풀리지 않음 | governing Service·selector·엔드포인트·readiness·DNS 캐시 확인 |

PVC가 남았다는 결과만으로 정리 실패라고 판단할 수는 없습니다
먼저 어떤 삭제 계기가 발생했는지와 현재 PVC의 소유 관계를 확인한 뒤, PV의 회수 정책까지 이어서 살펴봐야 합니다

## 확인한 근거

- [StatefulSet 공식 문서 고정본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/workloads/controllers/statefulset.md): 신원·순서 보장, PVC 보존 정책과 강제 삭제 경고
- [현재 API 기본값 처리](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/apps/v1/defaults.go): `SetDefaults_StatefulSet`의 두 보존 정책 기본값
- [현재 StatefulSet API 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/apps/validation/validation.go): `serviceName` 검증과 `volumeClaimTemplates` 불변 조건
- [PVC 보호 컨트롤러](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/volume/pvcprotection/pvc_protection_controller.go): `podUsesPVCForDeletion`과 캐시·API 조회
- [PVC 자동 삭제 기능의 공식 단계 표](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/command-line-tools-reference/feature-gates/StatefulSetAutoDeletePVC.md): v1.32 stable
