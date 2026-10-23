---
title: "노드 관측 세 소스 — 선언·실측·최근 표본을 구분합니다"
excerpt: "kube-state-metrics, cAdvisor와 kubelet 통계, metrics-server가 읽는 원본을 비교합니다. working set과 usage, 지표 엔드포인트와 통계 provider, CPU 계산 구간과 과거 기록의 보존 범위를 구분합니다"
category: "kubernetes"
tags: ["Kubernetes", "Observability", "cAdvisor", "kube-state-metrics", "metrics-server", "concept"]
series:
  name: "k8s-theory-node"
  order: 7
date: "2026-09-10"
---

같은 Pod의 메모리 사용량을 보는데 `kubectl top`과 대시보드의 숫자가 다를 수 있습니다
한쪽은 working set을, 다른 쪽은 페이지 캐시까지 포함한 usage를 표시한다면 서로 다른 값을 비교하고 있는 것입니다

숫자를 비교하기 전에 원본, 지표 정의, 수집 시점을 구분해야 합니다
API에 기록된 선언·상태를 묻는 질문과 노드에서 사용한 자원을 묻는 질문도 같은 소스에서 답을 얻지는 못합니다

> **근거**: Kubernetes v1.37.1 소스·공식 문서, metrics-server v0.9.0, kube-state-metrics v2.20.0 소스를 바탕으로 설명합니다
> Kubernetes ref: `f78e722310e50bcaca9276be22276d9e91d91308`, 공식 문서 저장본: `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
> 각 도구의 고정 ref와 확인한 경로는 말미에 정리했습니다
> 클러스터에서 세 소스의 값을 대조한 실측 기록은 포함하지 않습니다

## 선언·실측·최근 표본은 서로 다른 경로에서 나옵니다

**kube-state-metrics**는 API 오브젝트를 읽어 선언과 보고된 상태를 지표로 만듭니다
**cAdvisor**는 kubelet에 포함된 노드·컨테이너 통계 수집기이며, Linux에서는 cgroup 통계를 읽습니다
**metrics-server**는 kubelet이 노출한 자원 지표를 수집해 최근 값을 Metrics API로 제공합니다

![API 오브젝트를 읽는 kube-state-metrics와 노드 통계를 노출하는 kubelet, 그 자원 지표를 최근 표본으로 보관해 Metrics API로 제공하는 metrics-server의 관계|tall](/diagrams/k8s-theory-node-observability-sources-1.svg)

다만 kubelet의 컨테이너 통계가 항상 cAdvisor에서만 나온다고 단정할 수는 없습니다
런타임이 통계를 반환하는 **CRI(Container Runtime Interface)** 경로와 cAdvisor 경로가 함께 있으며, 엔드포인트와 provider를 구분해야 합니다
provider는 해당 통계를 실제로 가져와 구성하는 구현입니다

세 소스를 비교한다는 것은 독립적인 세 측정기가 같은 값을 재는 상황과 다릅니다
metrics-server는 kubelet의 자원 지표를 다시 수집하므로 원본 경로가 연결돼 있고, 여기에 수집 간격과 캐시 시점이 추가됩니다

## kube-state-metrics는 API에 기록된 필드를 읽습니다

[`kube-state-metrics`의 README](https://github.com/kubernetes/kube-state-metrics/blob/4ffeda2ef866b0fef372849825a803296483b336/README.md)는 API 오브젝트의 원시 데이터를 지표로 노출하는 역할을 설명합니다
노드의 cgroup을 읽어 실제 메모리 사용량을 재는 컴포넌트는 아닙니다

Deployment를 예로 들면 다음 값은 각각 다른 필드를 나타냅니다

| 지표 | 오브젝트에서 읽는 값 |
|---|---|
| `kube_deployment_spec_replicas` | 원하는 replica 수 |
| `kube_deployment_status_replicas_available` | controller가 사용 가능하다고 보고한 replica 수 |
| `kube_deployment_metadata_generation` | 현재 선언의 generation |
| `kube_deployment_status_observed_generation` | controller가 관찰했다고 보고한 generation |

**generation**은 선언이 바뀌었는지 구분하는 오브젝트의 세대 번호입니다
현재 generation보다 observed generation이 낮다면 controller가 아직 그 선언을 관찰한 상태를 보고하지 못한 것입니다
같다고 해서 모든 replica가 준비됐다는 뜻은 아니므로 가용 replica 수는 따로 봐야 합니다

이 지표들도 관찰 지연에서 자유롭지는 않습니다
API watch와 Prometheus 등의 수집 시각이 다르면, API 서버의 최신 값과 잠시 차이가 날 수 있습니다
오브젝트가 삭제된 사실을 반영한 뒤에는 해당 오브젝트의 지표도 더 이상 노출하지 않습니다

## kubelet 엔드포인트 이름과 통계 원본을 나눠 봅니다

kubelet은 용도별로 여러 엔드포인트를 제공합니다

| 엔드포인트 | 제공 범위 |
|---|---|
| `/metrics/cadvisor` | 컨테이너 통계를 넓게 제공. collector는 feature 설정에 따라 달라짐 |
| `/metrics/resource` | autoscaling 등에 쓰는 CPU·메모리 자원 지표 |
| `/metrics/probes` | probe 검사 지표 |
| `/stats/summary` | 노드·Pod 자원 통계의 Summary 표현 |

[`server.go`의 등록 코드](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/server/server.go)에서 `/metrics/cadvisor`는 기본적으로 cAdvisor collector를 사용합니다
현재 Beta·기본 off인 `PodAndContainerStatsFromCRI`를 켜면 컨테이너 지표는 CRI collector로 등록합니다
주소에 `cadvisor`가 있다는 이유만으로 실제 지표 원본까지 확정할 수는 없습니다

`/metrics/resource`는 별도 resource collector가 내부 Summary provider의 CPU·메모리 통계를 읽어 만듭니다
[`StatsProvider`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/stats/provider.go)는 cAdvisor 기반 또는 CRI 기반 컨테이너 통계를 연결하며, CRI 경로도 구성에 따라 cAdvisor 통계를 함께 사용하거나 보완할 수 있습니다

따라서 `/metrics/cadvisor`와 `/metrics/resource`의 값이 언제나 같은 표본에서 왔다고 가정하면 안 됩니다
실제 런타임·provider·수집 시점을 함께 확인해야 합니다
이 글에서 cAdvisor의 계산식을 확인했다는 사실만으로 설치된 런타임도 반드시 같은 계산을 수행한다고 판단하지는 않습니다

### eviction manager가 HTTP 엔드포인트를 호출하는 것은 아닙니다

[`eviction manager`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/eviction/eviction_manager.go)는 내부 `summaryProvider.Get`을 호출해 노드의 여유를 판단합니다
`/stats/summary`는 이 통계 모델을 외부에 노출하는 경로이지, eviction manager가 매번 HTTP로 읽는 대상은 아닙니다

외부 수집기와 kubelet 내부 소비자가 통계 구조를 공유하는 것과, 같은 HTTP 요청 경로를 이용하는 것은 다른 설명입니다
이 구분은 `/stats/summary`로 조회한 시각과 실제 축출 판단 시각의 값이 반드시 같지는 않다는 해석에도 필요합니다

### 같은 지표 이름도 수집 대상과 라벨을 확인합니다

`container_memory_working_set_bytes`는 기본 cAdvisor collector와 resource collector 양쪽에 있습니다
[`resource_metrics.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/metrics/collectors/resource_metrics.go)의 이 지표는 `container`, `pod`, `namespace` 라벨을 쓰며 안정성 등급은 STABLE입니다
cAdvisor collector의 라벨 구성과 지표 범위는 다릅니다

STABLE은 지표의 호환성에 관한 등급입니다
같은 이름의 다른 collector, 모든 런타임 구현, 서로 다른 수집 시점까지 동일하다고 보장하는 표시는 아닙니다

Prometheus가 두 엔드포인트를 모두 수집하면 같은 이름의 시계열을 두 벌 받을 수 있습니다
수집 target·job·endpoint 등의 구분을 놓친 채 합산하면 같은 컨테이너를 중복 계산할 수 있습니다
지표 이름만 보고 묶기 전에 어느 엔드포인트에서 왔는지부터 확인해야 합니다

## working set은 usage에서 모든 캐시를 뺀 값이 아닙니다

**cgroup**은 프로세스 묶음에 자원 사용량을 집계하고 한도를 적용하는 Linux의 단위입니다
cAdvisor가 읽는 사용량에는 페이지 캐시도 들어 있습니다
working set은 이 전체 사용량과 구분하기 위해 계산하는 값입니다

Kubernetes가 의존하는 cAdvisor/lib v0.60.5의 [`setMemoryStats`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/vendor/github.com/google/cadvisor/lib/container/libcontainer/handler.go)는 다음 관계를 사용합니다

```text
workingSet = max(usage - inactive_file, 0)
```

cgroup v2에서는 `inactive_file`, 계층 통계를 사용하는 cgroup v1에서는 `total_inactive_file` 값을 읽습니다
이 비활성 파일 페이지를 회수 가능한 쪽으로 보고 빼는 것이며, 모든 페이지 캐시를 제외하지는 않습니다
활성 파일 페이지 등은 working set에 남을 수 있습니다

| cAdvisor 지표 | 여기서 구분할 범위 |
|---|---|
| `container_memory_usage_bytes` | 캐시를 포함한 전체 사용량 |
| `container_memory_working_set_bytes` | 위 식으로 비활성 파일 페이지를 제외한 값 |
| `container_memory_rss` | Linux cgroup v2 경로에서는 `memory.stat`의 `anon` 값. usage보다 좁은 범위 |

이 식은 실제로 회수하는 데 드는 비용이나 앱이 앞으로 필요로 할 메모리까지 계산하지 않습니다
working set 하나로 cgroup OOM 발생 여부를 확정할 수 없고, usage가 limit에 가깝다는 이유만으로 즉시 OOM이라고 결론낼 수도 없습니다
커널은 회수 가능한 메모리를 회수한 뒤에도 한도 안에서 할당을 수용할 수 없는지 판단합니다

### node-pressure 판단은 노드 범위와 보정도 확인합니다

[Eviction과 OOM](/essays/k8s-theory-eviction-oom)에서 살핀 `memory.available`의 기본 관계는 `capacity - workingSet`입니다
하지만 컨테이너 working set 하나를 노드 용량에서 빼면 된다는 뜻은 아닙니다
eviction manager는 노드 범위의 Summary 통계를 읽고, Pod 간 축출 순위에는 별도의 Pod 사용량을 적용합니다

현재 기본 on인 `HugepageAwareEviction`을 사용하고 노드에 hugepage capacity가 있으면, [`adjustForHugePages`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/server/stats/summary.go)는 노드의 `AvailableBytes`에서 그 capacity를 추가로 빼고 0 아래로 내려가지 않게 합니다
이 조건에서는 단순한 기본 식만으로 실제 축출 입력값을 설명할 수 없습니다
대시보드의 컨테이너 메모리 숫자와 노드 압박 신호를 비교할 때는 범위와 보정을 함께 맞춰야 합니다

## metrics-server는 최근 두 표본으로 자원 사용량을 구성합니다

확인한 metrics-server v0.9.0은 기본적으로 kubelet의 `/metrics/resource`를 읽습니다
Node 어노테이션으로 수집 경로를 바꿀 수도 있으므로, 여기서도 실제 구성을 확인해야 합니다
기본 배포 매니페스트에는 `--metric-resolution=15s`가 지정돼 있습니다

[`storage`](https://github.com/kubernetes-sigs/metrics-server/blob/2a7c4b2c7d46552ff47f4aeaa3a735c582587ecd/pkg/storage/storage.go)는 디스크 이력 대신 메모리에 최근·이전 표본을 보관합니다
이 두 표본은 CPU 누적 카운터의 차이를 계산하는 데 필요합니다

| Metrics API 값 | 확인한 계산 방식 |
|---|---|
| CPU 사용량 | 두 표본의 누적 CPU 사용량 차이를 경과 시간으로 나눈 평균 |
| 메모리 사용량 | 마지막 표본의 working set |
| `Timestamp` | 반환한 사용량의 기준 시각 |
| `Window` | CPU 평균 계산 등에 사용한 시간 구간 |

따라서 CPU와 메모리는 같은 방식의 순간값이 아닙니다
CPU는 구간 평균이고 메모리는 표본 시점의 값입니다
수집 간격이 15초라는 설정만으로 모든 반환값의 `Window`가 정확히 15초라고 가정해서도 안 됩니다

캐시에는 비교에 필요한 이전 표본이 있지만, 원하는 과거 시각을 골라 조회하는 API는 없습니다
재시작하면 캐시가 비며, 사용할 수 있는 표본이 다시 준비돼야 합니다
수집 사이의 짧은 메모리 피크도 마지막 표본에 남지 않으면 이 경로로 복원할 수 없습니다

### kubectl top과 resource HPA는 Metrics API를 읽습니다

`kubectl top pod`는 `metrics.k8s.io`의 PodMetrics 목록을 읽습니다
HPA와 VPA도 resource 지표를 사용하는 경로에서 이 API를 이용합니다
이는 HPA가 현재 replica 수를 결정하는 모든 과정을 metrics-server가 수행한다는 뜻은 아닙니다

[`NewRESTMetricsClient`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/podautoscaler/metrics/client.go)는 resource·custom·external 지표용 클라이언트를 구분합니다
metrics-server는 그중 CPU·메모리 resource 지표를 제공합니다
custom·external 지표를 사용하는 HPA는 다른 공급 경로를 사용할 수 있습니다

Prometheus를 설치했다는 사실만으로 `metrics.k8s.io`가 채워지지는 않습니다
반대로 metrics-server가 없다는 이유만으로 모든 HPA가 동작하지 않는다고 결론낼 수도 없습니다
어느 API의 어느 지표를 읽도록 설정했는지 확인해야 합니다

### 최근 표본을 제공하는 역할과 모니터링 이력은 다릅니다

metrics-server의 [README](https://github.com/kubernetes-sigs/metrics-server/blob/2a7c4b2c7d46552ff47f4aeaa3a735c582587ecd/README.md)는 autoscaling 용도로 사용하며 모니터링 시스템의 지표 공급원으로 쓰지 말라고 명시합니다
별도 모니터링이 필요하면 kubelet 지표를 직접 수집하는 경로를 안내합니다

캐시에 표본이 있다는 사실만으로 과거의 피크나 장애 시각의 상태를 보존하지는 않습니다
`PodMetrics`의 `Timestamp`와 `Window`도 반환값의 시각·구간을 나타내는 필드이며, 과거 구간을 지정해 검색하는 조건이 아닙니다

## 로그 파일이 남아 있는 것과 지표 이력이 남는 것도 다릅니다

세 지표 소스는 과거 지표를 조회하는 시계열 저장소가 아닙니다
cAdvisor가 내부 표본을 갖거나 metrics-server가 이전 값을 보관하더라도, 사용자가 임의의 과거 시각을 조회하는 이력 저장소와는 다릅니다

로그는 프로세스가 출력한 바이트를 파일에 기록하는 다른 관측 경로입니다
`pods/log`는 이 출력 기록을 읽으며, 기록이 남아 있는 범위에서 과거 내용을 볼 수 있습니다
그 파일이 남아 있다고 과거 메모리 사용량도 함께 기록돼 있다는 뜻은 아닙니다

kubelet의 `containerLogMaxSize`는 로그 회전의 크기 기준이고 `containerLogMaxFiles`는 보관 파일 수에 영향을 줍니다
또한 [`kubectl logs`에는 최신 로그 파일의 내용만 제공](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/cluster-administration/logging.md)되므로, 노드에 회전 파일이 존재하는 것과 API로 그 파일을 모두 읽을 수 있는 것도 다릅니다

장애 당시 자원 지표를 나중에 비교하려면 그 시점에 수집해 시계열 저장소에 보존했어야 합니다
이벤트 메시지나 Pod status가 종료 원인의 단서를 남기더라도, 당시 사용량 표본까지 보존한 것은 아닙니다

## 숫자가 다르면 정의·범위·시각부터 맞춥니다

다음 표는 관측 결과를 꾸민 사례가 아니라 조사할 소스를 고르는 기준입니다

| 확인하려는 질문 | 먼저 볼 경로 | 주의할 점 |
|---|---|---|
| 몇 개를 원하고 몇 개가 사용 가능한가 | kube-state-metrics의 spec·status 지표 | 선언과 보고 상태를 구분 |
| controller가 새 선언을 따라잡았는가 | generation·observed generation | 세대가 같아도 rollout 완료를 뜻하지는 않음 |
| 지금 컨테이너가 얼마나 사용하는가 | kubelet의 컨테이너 통계 | provider·working set/usage·표본 시각 확인 |
| CPU throttling이 있었는가 | `container_cpu_cfs_throttled_periods_total` 등을 제공하는 통계 경로 | 카운터 증가와 시간 구간 확인 |
| resource HPA가 읽을 최근 값은 무엇인가 | Metrics API | 현재 `kubectl top`이 과거 HPA 판정값을 재현하지는 않음 |
| 어제 장애 시각에 얼마를 사용했는가 | 이미 수집한 시계열 저장소 | 이 세 소스만으로 이력을 복원할 수 없음 |

`kubectl top`과 대시보드가 다르면 먼저 working set과 usage를 섞었는지 확인합니다
그다음 컨테이너·Pod·노드 중 어느 범위를 집계했는지, 같은 지표를 두 엔드포인트에서 중복 수집했는지, 수집 시각과 계산 구간이 같은지 봅니다

Pod 프로세스가 종료됐다고 모든 지표가 즉시 사라진다고 단정하지는 않습니다
API 오브젝트와 캐시에 흔적이 남을 수 있고, cgroup이 제거되는 시점도 프로세스 종료 시각과 다를 수 있습니다
다만 원본 cgroup을 더 이상 읽지 못하는 상태가 되면 그곳에서 새 실측값을 얻을 수는 없습니다

숫자가 다르다는 사실만으로 한쪽을 오류로 판단하기보다, 각 숫자가 답하는 질문을 먼저 맞추는 편이 조사 범위를 줄여 줍니다

## 확인한 소스

- Kubernetes v1.37.1 `f78e722310e50bcaca9276be22276d9e91d91308` — kubelet 엔드포인트 등록, resource collector, Summary provider, CRI·cAdvisor stats provider, Metrics API 타입과 HPA·kubectl 클라이언트
- [Kubernetes go.mod](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/go.mod) — cAdvisor/lib v0.60.5 의존성을 확인한 뒤 해당 벤더 코드의 메모리 계산을 대조
- [metrics-server v0.9.0](https://github.com/kubernetes-sigs/metrics-server/tree/2a7c4b2c7d46552ff47f4aeaa3a735c582587ecd) — `pkg/scraper/client/resource`·`pkg/storage`·기본 배포 매니페스트. ref `2a7c4b2c7d46552ff47f4aeaa3a735c582587ecd`
- [kube-state-metrics v2.20.0](https://github.com/kubernetes/kube-state-metrics/tree/4ffeda2ef866b0fef372849825a803296483b336) — README와 `internal/store/deployment.go`. ref `4ffeda2ef866b0fef372849825a803296483b336`
- [Resource metrics pipeline](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/tasks/debug/debug-cluster/resource-metrics-pipeline.md) — CPU 구간 평균·메모리 working set의 의미와 metrics-server 수집 역할
