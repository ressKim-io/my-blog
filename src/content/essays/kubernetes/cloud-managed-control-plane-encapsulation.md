---
title: "관리형 컨트롤 플레인은 무엇을 숨기는가 — APF 응답 헤더와 캡슐화의 물리적 대가"
excerpt: "EKS와 GKE는 system:masters 특권 면제를 CSP 관리 VPC 뒤로 은닉합니다. 관측 가능한 APF 응답 헤더(X-Kubernetes-PF-PriorityLevel-UID), 429 지수 백오프 산식, Watch 초기화 좌석 반환 로직을 통해 캡슐화된 컨트롤 플레인의 작동 기전을 소스코드로 규명합니다."
category: "kubernetes"
tags: ["kubernetes", "eks", "gke", "apf", "control-plane", "troubleshooting"]
series:
  name: "k8s-cloud-optimization"
  order: 1
date: "2026-07-20"
---

> **본 편의 근거 구성**: 쿠버네티스 오픈소스 소스코드 규격 확정(`k8s.io/apiserver` v1.32+ 트리) 및 공식 아키텍처 문헌(AWS EKS/Nitro 백서, GKE Dataplane V2 스펙)을 중심으로 기술합니다  
> **블랙박스 선언**: AWS EKS 및 Google Cloud GKE가 관리형 VPC 내부에서 구동하는 마스터 인스턴스의 동적 선택 알고리즘, 실시간 커널 버전, `CONFIG_HZ`, `sysctl` 파라미터 등은 클라우드 프로바이더(CSP)의 전유물이자 외부에서 관측 불가능한 블랙박스 영역입니다. 본 편은 은닉 영역에 대해 출처 없는 추측성 수치나 가설을 일절 배제하고, 사용자 VPC 경계에서 관측 가능한 프로토콜 규격과 노출 메트릭만을 근거로 물리적 기전을 규명합니다

## 상황: 23편 특권 면제의 회수와 은닉된 마스터

이전 시리즈 23편(`k8s-go-tradeoffs-summary.md`)에서 우리는 쿠버네티스 API 서버(`kube-apiserver`)가 Go 런타임의 동시성 부하를 제어하기 위해 API Priority and Fairness(APF) 큐를 운영하면서도, `system:masters` 그룹과 내부 핵심 컨트롤러에게는 큐잉과 리소스 제한을 완전히 면제(`Type: Exempt`)하는 메커니즘을 소스코드로 확인했습니다

직접 홈스펀(Self-managed) 쿠버네티스 클러스터를 구축하고 운영할 때, 이 특권 면제는 클러스터 관리자가 온전히 통제하고 관측할 수 있는 영역입니다. 마스터 노드에 SSH로 접속해 `htop`이나 `/proc/meminfo`를 조회하여 `kube-apiserver` 프로세스가 소비하는 메모리와 CPU 코어를 직접 잴 수 있으며, 어떤 파드나 컨트롤러가 API 서버에 부하를 주는지 실시간으로 추적할 수 있습니다

하지만 AWS EKS나 Google Cloud GKE 같은 관리형 쿠버네티스 환경으로 넘어오는 순간, 이 모든 물리적 실체는 클라우드 프로바이더(CSP)의 장막 뒤로 캡슐화됩니다. 사용자는 클러스터당 시간당 $0.10(월 약 $73)의 요금을 지불하고 고가용성 컨트롤 플레인을 통째로 임대합니다. 대신 CSP는 API 서버와 `etcd`가 구동되는 노드의 OS, 리눅스 커널, cgroup v2 제한, CPU 스케줄러를 완전히 은닉합니다

마스터 노드에 직접 접근할 수 없는 환경에서 사용자가 컨트롤 플레인의 한계와 병목을 진단할 수 있는 통로(Window)는 오직 **사용자 VPC와 CSP 관리형 VPC가 만나는 프로토콜 경계**뿐입니다. 우리가 API 요청을 보낼 때 반환되는 HTTP 응답 헤더, 429 상태 코드와 `Retry-After` 산식, 그리고 Prometheus로 스크래핑할 수 있는 APF 메트릭이 은닉된 물리 세계를 비추는 유일한 지표가 됩니다

## 구조: EKS와 GKE의 캡슐화 아키텍처 비교

관리형 컨트롤 플레인이 은닉되는 방식은 클라우드 프로바이더의 내부 가상화 및 네트워크 인프라 아키텍처에 따라 분명한 차이를 보입니다

| 구분 | AWS EKS | Google Cloud GKE (Regional 기준) |
|---|---|---|
| **컨트롤 플레인 위치** | AWS 관리형 VPC (`AWS-managed VPC`) 내 전용 EC2 인스턴스 | Google 내부 Borg 클러스터 위 가상화 인스턴스 |
| **고가용성 배치** | 기본 2개 이상의 가용영역(AZ)에 API 서버 및 `etcd` 분산 배치 | 3개 가용영역(AZ) 고가용성 복제본 배치 (Zonal은 단일 AZ) |
| **VPC 간 네트워크 통신** | 교차 계정 ENI(`Cross-account ENI`) 및 PrivateLink / NLB 경유 | Dataplane V2 기반 가상 네트워크 리다이렉션 및 마스터 페어링 |
| **특권 및 면제 주체** | AWS Managed Controller, `vpc-cni`, `kube-proxy` 등 CSP 에이전트 | Google Internal Controller, `gke-metadata-server` 등 CSP 에이전트 |
| **노출되는 관측 지표** | CloudWatch API 지표 및 `kube-apiserver` Prometheus 엔드포인트 | Cloud Monitoring (`kubernetes.io/master/*`) 및 APF 메트릭 |

EKS의 경우 API 서버와 관리형 `etcd`가 AWS가 소유한 별도의 관리형 VPC 내부에 전용 EC2 인스턴스 형태로 프로비저닝됩니다. 워커 노드가 구동되는 고객 워크로드 VPC는 교차 계정 ENI(Cross-account ENI)를 통해 컨트롤 플레인의 Network Load Balancer(NLB)에 연결됩니다. API 서버 인스턴스의 스케일 업(예: 인스턴스 타입 크기 확장)이나 스케일 아웃은 API 요청 빈도와 `etcd` 저장소 크기에 따라 AWS 내부 컨트롤러가 수행하지만, 해당 오토스케일링 과정과 노드 사양은 사용자에게 일절 공개되지 않습니다

GKE 역시 유사하게 마스터 노드가 Google의 대규모 클러스터 관리 시스템인 Borg 위에서 구동됩니다. Zonal 클러스터는 99.5%, Regional 클러스터는 99.95%의 가용성 SLA를 보장하지만, Borg 내부 컨테이너의 CPU 할당량이나 메모리 제한은 철저한 블랙박스 영역입니다

![관리형 컨트롤 플레인 캡슐화 및 APF 관측 경계](/diagrams/cloud-managed-control-plane-encapsulation-1.svg)

위 다이어그램은 홈스펀 쿠버네티스와 관리형 쿠버네티스의 관측 경계 차이를 시각화합니다. 사용자는 워커 노드(`User Area`)에서 API 요청이나 장기 Watch 스트림을 전송할 때 ENI와 네트워크 로드 밸런서를 거쳐 CSP 관리 영역으로 진입합니다. 이때 우리가 받은 HTTP 응답의 `X-Kubernetes-PF-*` 헤더와 상태 코드는 CSP 내부에 감춰진 `kube-apiserver`가 우리 워크로드를 어떻게 분류하고 대기열에 세웠는지를 가리키는 프로토콜 나침반 역할을 수행합니다

## 규명: APF 필터와 429 지수 백오프의 소스코드 해부

컨트롤 플레인이 CSP의 비공개 인프라에서 돌고 있다 하더라도, HTTP/2 및 gRPC 프로토콜을 통과하는 필터 엔진은 쿠버네티스 오픈소스 트리(`k8s.io/apiserver`)의 규격을 100% 동일하게 실행합니다. API 서버의 Priority and Fairness(APF) 소스코드를 톺아보면, 관리형 쿠버네티스가 사용자에게 무엇을 숨기고 무엇을 응답으로 돌려주는지 명확히 규명할 수 있습니다

### APF 응답 헤더의 의도적 은닉 (`priority-and-fairness.go`)

API 요청이 HTTP 서버에 도달하면 가장 먼저 `priorityAndFairnessHandler.Handle()` 필터가 실행됩니다. 이 필터는 요청을 분류한 뒤 응답 헤더에 APF 분류 결과를 삽입하는데, 여기에는 매우 중요한 보안 및 캡슐화 설계 의도가 담겨 있습니다

```go
// staging/src/k8s.io/apiserver/pkg/server/filters/priority-and-fairness.go
func setResponseHeaders(classification *PriorityAndFairnessClassification, w http.ResponseWriter) {
	if classification == nil {
		return
	}

	// We intentionally set the UID of the flow-schema and priority-level instead of name. This is so that
	// the names that cluster-admins choose for categorization and priority levels are not exposed, also
	// the names might make it obvious to the users that they are rejected due to classification with low priority.
	w.Header().Set(flowcontrol.ResponseHeaderMatchedPriorityLevelConfigurationUID, string(classification.PriorityLevelUID))
	w.Header().Set(flowcontrol.ResponseHeaderMatchedFlowSchemaUID, string(classification.FlowSchemaUID))
}
```

소스코드 주석을 보면 *"우리는 의도적으로 이름(Name) 대신 FlowSchema와 PriorityLevel의 UID를 설정한다. 이는 관리자가 선택한 분류 규칙 이름을 노출하지 않고, 또한 낮은 우선순위로 분류되어 거부되었다는 사실을 사용자에게 지나치게 명백히 드러내지 않기 위함이다"*라고 명시되어 있습니다

즉, 우리가 파드나 `curl` 명령어로 API 요청을 보냈을 때 반환되는 응답 헤더는 오직 다음과 같은 형태를 띱니다

```http
HTTP/2 200 OK
X-Kubernetes-PF-FlowSchema-UID: a1b2c3d4-1111-2222-3333-444455556666
X-Kubernetes-PF-PriorityLevel-UID: e5f6a7b8-9999-0000-1111-222233334444
```

EKS나 GKE의 클러스터 관리 영역에서 CSP가 기본적으로 설정해 둔 `workload-high`, `workload-low`, `service-accounts` 등의 실제 계급 이름은 응답 헤더에서 완전히 제거됩니다. 사용자는 오직 이 UID 값을 클러스터 내의 `FlowSchema` 리소스(`kubectl get flowschemas -o yaml`)와 대조해야만 자신의 요청이 어떤 우선순위 대기열(Queue)에 배정되었는지 추적할 수 있습니다

### 429 Too Many Requests 및 지수 백오프 산출 공식 (`dropped_requests_tracker.go`)

만약 API 서버의 동시성 좌석(Execution Seats)이 모두 소진되고 해당 대기열의 큐까지 가득 차게 되면, APF 필터는 요청을 즉시 거부(`served == false`)하고 HTTP 429 에러를 돌려줍니다

```go
// staging/src/k8s.io/apiserver/pkg/server/filters/priority-and-fairness.go
if !served {
	setResponseHeaders(classification, w)

	epmetrics.RecordDroppedRequest(r, requestInfo, epmetrics.APIServerComponent, isMutatingRequest)
	epmetrics.RecordRequestTermination(r, requestInfo, epmetrics.APIServerComponent, http.StatusTooManyRequests)
	h.droppedRequests.RecordDroppedRequest(classification.PriorityLevelName)

	tooManyRequests(r, w, strconv.Itoa(int(h.droppedRequests.GetRetryAfter(classification.PriorityLevelName))))
}
```

이때 반환되는 `Retry-After` 응답 헤더는 고정된 숫자가 아닙니다. 쿠버네티스는 TCP 혼잡 제어(Congestion Control) 메커니즘을 모방하여 `dropped_requests_tracker.go`에서 동적인 지수 백오프 시간을 계산합니다

```go
// staging/src/k8s.io/apiserver/pkg/util/flowcontrol/dropped_requests_tracker.go
const (
	maxRetryAfter = int64(32)
)

func (s *droppedRequestsStats) updateRetryAfterIfNeededLocked(unixTime int64) {
	retryAfter := s.retryAfter.Load()
	droppedRequests := int64(0)
	// 지난 retryAfter 초 구간([unixTime-retryAfter, unixTime)) 동안의 드롭 횟수 합산
	for i := len(s.history) - 1; i >= 0; i-- {
		if unixTime-s.history[i].unixTime > retryAfter {
			break
		}
		if s.history[i].unixTime < unixTime {
			droppedRequests += s.history[i].requests
		}
	}

	// 1. 드롭된 요청 수가 현재 retryAfter 값의 3배 이상이면 2배로 지수 증가 (최대 32초)
	if unixTime-s.retryAfterUpdateUnix >= retryAfter && droppedRequests >= 3*retryAfter {
		retryAfter *= 2
		if retryAfter >= maxRetryAfter {
			retryAfter = maxRetryAfter
		}
		s.retryAfter.Store(retryAfter)
		s.retryAfterUpdateUnix = unixTime
		return
	}

	// 2. 드롭된 요청 수가 retryAfter 값보다 작아지면 1초씩 선형 감쇠
	if droppedRequests < retryAfter && retryAfter > 1 {
		retryAfter--
		s.retryAfter.Store(retryAfter)
		return
	}
}
```

소스코드 분석을 통해 도출된 물리적 작동 법칙은 명확합니다. API 요청이 처음 거부될 때 `Retry-After`는 기본 1초로 시작합니다. 하지만 1초 동안 드롭된 요청 수가 3개(`3 * retryAfter`)를 넘어서는 순간, API 서버는 다음 드롭 응답의 `Retry-After` 값을 2배(`2s` → `4s` → `8s` → `16s` → `32s`)로 뜁니다. 최대 한계치인 `maxRetryAfter = 32`초에 도달하면 클라이언트는 무려 반분 이상의 긴 대기 시간을 강제당합니다

부하가 해소되어 초당 드롭 수가 기준치 미만으로 떨어져도 즉시 1초로 초기화되지 않고 매초 `1초`씩 선형 감쇠(`retryAfter--`)합니다. 이는 클라이언트들의 동시 재연결(Thundering Herd)로 인해 은닉된 컨트롤 플레인이 다시 마비되는 악순환을 방지하기 위한 강력한 물리적 브레이크입니다

![APF 429 Retry-After AIMD 혼잡 제어 상태 전이도](/diagrams/cloud-managed-control-plane-encapsulation-2.svg)

위 상태 전이도는 `dropped_requests_tracker.go`가 구현한 AIMD(Additive Increase/Multiplicative Decrease) 메커니즘을 보여줍니다. 정상 대기열 상태에서는 1초의 기본 대기 시간을 안내하지만, 과거 구간 내 드롭 횟수가 임계치를 초과하면 지수 백오프로 급발진하여 최대 32초까지 재연결을 지연시킵니다. 이후 부하가 완화될 때는 매초 1초씩 단계적으로 감쇠하여 갑작스러운 트래픽 유입으로부터 컨트롤 플레인을 보호합니다

### Watch 초기화 신호 분리와 좌석 반환 로직 (`apf_controller.go`)

쿠버네티스 API에서 가장 많은 리소스를 소모하는 작업은 대규모 리스트 조회(`List`)와 장기 스트리밍 연결인 `Watch`입니다. 만약 수백 개의 컨트롤러나 Informer가 연결한 장기 `Watch` 요청이 API 서버의 동시성 좌석(Seat)을 계속 차지하고 있다면, 컨트롤 플레인은 몇 초 만에 전체 좌석이 고갈되어 마비될 것입니다

`kube-apiserver`는 이를 방지하기 위해 `Watch` 요청의 **초기화 단계**와 **스트리밍 단계**를 엄격히 분리합니다

```go
// staging/src/k8s.io/apiserver/pkg/util/flowcontrol/apf_controller.go
func (cfgCtlr *configController) startRequest(...) (fs *flowcontrol.FlowSchema, pl *flowcontrol.PriorityLevelConfiguration, isExempt bool, req fq.Request, startWaitingTime time.Time) {
	// ...
	if plState.pl.Spec.Type != flowcontrol.PriorityLevelEnablementExempt {
		// 면제 대상(Exempt)이 아니면 대기열 큐잉 시작 및 좌석 산정
		startWaitingTime = cfgCtlr.clock.Now()
	}
	req, idle := plState.queues.StartRequest(ctx, &workEstimate, hashValue, flowDistinguisher, selectedFlowSchema.Name, rd.RequestInfo, rd.User, queueNoteFn)
	return selectedFlowSchema, plState.pl, plState.pl.Spec.Type == flowcontrol.PriorityLevelEnablementExempt, req, startWaitingTime
}
```

`priority-and-fairness.go`의 `isWatchRequest` 분기 로직을 보면, API 서버는 `Watch` 요청이 들어올 때 먼저 APF 큐에서 좌석을 할당받아 초기화를 시작합니다(`execute()`)

```go
// staging/src/k8s.io/apiserver/pkg/server/filters/priority-and-fairness.go (Watch 분기)
execute := func() {
	noteExecutingDelta(1)
	defer noteExecutingDelta(-1)
	served = true
	setResponseHeaders(classification, w)

	forgetWatch = h.fcIfc.RegisterWatch(r)
	close(shouldStartWatchCh)

	// Watch 초기화가 완료될 때까지만 좌석을 유지하고 대기
	watchInitializationSignal.Wait()
}
```

핵심은 `watchInitializationSignal.Wait()`가 끝나는 순간(`defer noteExecutingDelta(-1)`)입니다. `Watch` 이벤트 스트림이 시작되어 과거 데이터를 모두 내려받고 실시간 이벤트 청취 상태로 전환되면 초기화 신호가 해제되고, 해당 `Watch` 요청이 점유했던 APF 동시성 좌석은 즉시 큐로 반환됩니다

즉, EKS/GKE에서 장시간 맺어져 있는 `Watch` 파이프라인 자체는 APF 좌석을 소모하지 않습니다. 하지만 네트워크 단절이나 API 서버 오토스케일링으로 인해 수천 개의 파드가 **동시에 `Watch` 재연결(Re-watch)**을 시도하면, 순간적으로 수천 개의 초기화 요청이 APF 좌석을 쟁탈하면서 큐잉 타임아웃(`defaultRequestWaitLimit / 4` 또는 최대 1분)과 대량의 429 드롭 폭풍이 발생하게 됩니다

![Watch 초기화와 스트리밍의 동시성 좌석 점유 타임라인](/diagrams/cloud-managed-control-plane-encapsulation-3.svg)

위 타임라인 비교도는 일반 REST API(`List`/`Get`)와 `Watch` 요청의 생애주기별 동시성 좌석(Seat) 소모 기전 차이를 나타냅니다. 일반 API는 응답이 완료될 때까지 좌석을 계속 점유하는 반면, `Watch` 요청은 `watchInitializationSignal.Wait()`가 반환되는 초기화 완료 시점에 즉시 좌석을 큐에 돌려줍니다. 이 정교한 단계 분리 덕분에 수천 개의 Informer가 연결을 유지해도 컨트롤 플레인 좌석이 고갈되지 않으나, 초기화 구간이 집중되는 재연결 폭풍 시에는 대량 드롭 취약점이 발생합니다

## 관측과 실전: 경계 너머의 물리적 신호 진단

소스코드로 밝혀낸 APF 메커니즘을 바탕으로, 우리는 마스터 노드에 들어가지 않고도 클라우드 관리형 컨트롤 플레인의 상태를 진단하고 대처할 수 있습니다

### 노출되는 핵심 메트릭과 물리적 의미 대응

EKS와 GKE는 Prometheus 스크래핑이나 클라우드 모니터링 파이프라인을 통해 `kube-apiserver`의 내부 FlowControl 지표를 외부로 송출합니다. 다음 3대 지표는 캡슐화된 커널 큐의 물리적 변화를 가리키는 바로미터입니다

| 메트릭 명칭 (`apiserver_flowcontrol_*`) | 물리적 상태 및 관측 의미 | 위험 판단 기준 |
|---|---|---|
| `rejected_requests_total` | 특정 Priority Level의 대기열 큐 용량까지 모두 꽉 차서 즉시 429 드롭이 발생한 누적 횟수 | 0보다 크고 가파르게 증가할 경우 해당 우선순위 계급의 좌석 부족 상태 확정 |
| `current_inqueue_requests` | 현재 실행 좌석을 얻지 못하고 APF 큐에 갇혀 대기(`Wait`) 중인 실시간 요청 수 | 지속적으로 양수 값을 유지하면 대기 지연(Latency) 증폭 및 타임아웃 위험 임박 |
| `request_wait_duration_seconds` | 요청이 큐에 들어가 실제 실행 좌석을 할당받기까지 소모한 대기 시간의 히스토그램 | P99 대기 시간이 1초를 초과하기 시작하면 클라이언트 런타임의 컨텍스트 취소 발생 |

### 실전 진단 및 커스텀 APF 튜닝 가이드

만약 클러스터 내에서 특정 오퍼레이터나 대량의 배치 작업이 API 서버를 집중 타격하여 다른 애플리케이션의 정상 쿼리가 지연되는 현상이 포착된다면, 관리형 마스터의 사양 스케일 업을 기다리는 것만으로는 문제를 해결할 수 없습니다. 클러스터 관리자는 `FlowSchema`와 `PriorityLevelConfiguration`을 조정하여 사용자 경계 안에서 트래픽을 통제해야 합니다

첫째, API 서버 응답 헤더(`X-Kubernetes-PF-PriorityLevel-UID`)를 추출하여 현재 거부당하는 요청이 속한 우선순위 계급을 찾습니다. 명령어를 통해 UID에 매핑되는 실제 이름을 확인합니다

```bash
kubectl get prioritylevelconfigurations -o jsonpath='{range .items[*]}{.metadata.uid}{"\t"}{.metadata.name}{"\n"}{end}' | grep "<응답받은_PriorityLevel_UID>"
```

둘째, 기본 제공되는 `workload-low`나 `service-accounts` 계급에서 좌석이 부족하다면, 우리 핵심 워크로드를 위한 격리된 커스텀 우선순위 계급을 신설합니다. 이때 CSP가 시스템 안정을 위해 예약해 둔 `system-high`나 `leader-election`의 시트 할당량을 침범하지 않도록, `nominalConcurrencyShares` 가중치를 정밀하게 산정하여 독립된 대기열(`LimitResponseTypeQueue`)을 부여합니다

## 더 파고들 질문

현재 운영 중이거나 테스트용으로 구동한 EKS, GKE, 또는 로컬 kind 클러스터 셸에서 다음 질문들을 직접 실행하여 프로토콜 경계를 검증해 보시기 바랍니다

1. `kubectl get flowschemas,prioritylevelconfigurations` 명령을 실행했을 때, CSP가 클러스터 생성 시 기본으로 주입해 둔 불변(`system:masters` 매핑) FlowSchema의 정확한 이름과 매칭 규칙은 무엇인가?
2. 임의의 파드에서 `curl -k -v -H "Authorization: Bearer $(cat /var/run/secrets/kubernetes.io/serviceaccount/token)" https://kubernetes.default.svc/api/v1/pods`를 실행했을 때 반환되는 `X-Kubernetes-PF-*` 헤더의 UID 값은 실제 어떤 우선순위 계급을 가리키고 있는가?
3. 대량의 동시 `curl` 요청을 발생시켜 고의로 429 Too Many Requests 에러를 유도했을 때, 반환되는 HTTP 응답 헤더의 `Retry-After` 초 수가 `1s`에서 시작하여 2배씩(`2s`, `4s`, `8s`...) 증가하는 과정을 외부에서 관측할 수 있는가?
4. Prometheus 또는 Cloud Monitoring에서 `apiserver_flowcontrol_current_inqueue_requests` 메트릭을 조회했을 때, 대규모 `Deployment` 롤링 업데이트 시점에 특정 우선순위 계급의 큐 대기열이 얼마나 치솟았다가 빠지는가?
5. `Watch` 요청을 수행하는 외부 Informer 스크립트를 수십 개 동시에 시작했을 때, `apiserver_request_duration_seconds` 중 초기화 대기 시간(`apf_init_latency`)과 실제 처리 시간 사이의 분포 차이가 어떻게 벌어지는가?

## 핵심 요약

- AWS EKS와 Google Cloud GKE는 23편에서 다룬 `kube-apiserver`의 특권 면제(`system:masters`)와 컨트롤 플레인의 호스트 커널, cgroup 자원 제한을 프로바이더 관리 영역(AWS-managed VPC, Borg) 뒤로 캡슐화합니다
- 사용자가 마스터 노드에 직접 접근할 수 없는 환경에서 은닉된 컨트롤 플레인의 상태를 진단할 수 있는 유일한 물리적 창구는 APF 응답 헤더, 429 상태 코드, 노출된 메트릭입니다
- `setResponseHeaders()`는 관리자 설정 노출을 막기 위해 FlowSchema와 PriorityLevel의 이름 대신 오직 UID(`X-Kubernetes-PF-PriorityLevel-UID`)만을 HTTP 응답 헤더에 담아 보냅니다
- 429 거부 시 반환되는 `Retry-After` 헤더는 고정 값이 아니라, 지난 초 단위 구간 동안 드롭된 요청 수가 3배를 넘을 때마다 2배씩 증가(`1s` → `32s` 최대)하고 해소 시 매초 1초씩 선형 감쇠하는 AIMD 혼잡 제어 산식을 따릅니다
- 장기 `Watch` 요청은 초기화 시점(`watchInitializationSignal.Wait()`)까지만 APF 동시성 좌석을 점유하고 스트리밍 시작과 동시에 반환하므로 평시에는 좌석을 낭비하지 않지만, 대량 동시 재연결 시 초기화 좌석 고갈로 인한 429 드롭 폭풍을 유발합니다
