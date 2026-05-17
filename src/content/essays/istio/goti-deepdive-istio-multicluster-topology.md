---
title: "Istio 멀티클러스터 토폴로지 3종 — Control Plane 위치가 결정하는 것들"
excerpt: "Multi-Primary, Primary-Remote, 독립 mesh 세 가지 토폴로지가 각각 어떻게 동작하고, cross-cluster 서비스 디스커버리·blast radius·cross-cloud latency 측면에서 무엇을 트레이드오프하는지 설명합니다"
category: istio
tags:
  - go-ti
  - istio
  - multicluster
  - service-mesh
  - blast-radius
  - concept
series:
  name: "goti-deepdive-istio"
  order: 4
date: "2026-04-15"
---

## 한 줄 요약

> Istio 멀티클러스터 토폴로지의 핵심 결정 변수는 Control Plane을 어디에 몇 개 두느냐이며, 이 선택이 cross-cluster 서비스 디스커버리 방식과 장애 전파 범위(blast radius)를 결정합니다

---

## 🤔 무엇을 푸는 기술인가

단일 Kubernetes 클러스터는 하나의 장애 도메인입니다 클라우드 리전 장애, Control Plane 장애, 네트워크 분할이 발생하면 그 클러스터 안의 서비스 전체가 영향을 받습니다

두 개 이상의 클러스터를 운영할 때 서비스 메시도 두 가지 질문에 답해야 합니다

- **서비스 발견**: 한 클러스터의 서비스가 다른 클러스터의 서비스를 어떻게 찾는가
- **설정 배포**: Istio Control Plane이 어느 위치에서 어떤 범위로 Envoy 프록시에 설정을 내리는가

Istio는 이 두 질문에 대해 세 가지 토폴로지를 제공합니다 토폴로지 선택은 운영 복잡도, 장애 격리 범위, 네트워크 의존성을 동시에 결정합니다

---

## 🔧 동작 원리

### xDS — Control Plane이 프록시와 통신하는 방법

세 토폴로지를 이해하려면 먼저 Istio의 설정 배포 메커니즘인 **xDS 프로토콜**을 알아야 합니다

Istio의 Control Plane인 `istiod`는 xDS(eXtensible Discovery Service) API를 통해 각 Pod의 Envoy 사이드카 프록시에 설정을 전달합니다 xDS는 여러 하위 API의 집합입니다

| API | 역할 | 예시 |
|---|---|---|
| CDS (Cluster Discovery) | 업스트림 클러스터 목록 | `reviews.default.svc.cluster.local` |
| EDS (Endpoint Discovery) | 클러스터의 엔드포인트 IP/포트 | Pod IP 10.0.1.5:8080 |
| LDS (Listener Discovery) | 리스너(인바운드/아웃바운드 포트) | 포트 8080 리스너 정의 |
| RDS (Route Discovery) | HTTP 라우팅 규칙 | `/api/v1/*` → `backend` 클러스터 |

Envoy는 `istiod`에 gRPC long-polling 연결을 유지하고, 설정이 바뀔 때마다 스트리밍으로 갱신을 받습니다 이 연결이 끊기면 Envoy는 마지막으로 받은 설정(캐시)으로 계속 동작하지만, 새 서비스 등록이나 트래픽 정책 변경은 반영되지 않습니다

xDS 연결의 이 특성이 토폴로지별 blast radius 차이를 만드는 핵심입니다

### Multi-Primary — 각 클러스터 독립 Control Plane

Multi-Primary는 각 클러스터가 자체 `istiod`를 보유하는 구성입니다 두 클러스터의 `istiod`는 서로의 서비스 엔드포인트를 공유해 cross-cluster 서비스 디스커버리를 지원합니다

**서비스 발견이 동작하는 방식**을 단계별로 보면 다음과 같습니다

```text
클러스터 A의 Service X → 클러스터 B의 Service Y 호출 시

1. 클러스터 A의 istiod가 클러스터 B의 Kubernetes API에 연결
2. 클러스터 B의 Service Y 엔드포인트를 읽어옴
3. 클러스터 A의 istiod가 Service X의 Envoy에 EDS 갱신 전달
4. Envoy가 클러스터 B의 East-West Gateway를 통해 Service Y로 요청 전달
5. East-West Gateway가 클러스터 B 내부로 트래픽 라우팅
```

**East-West Gateway**가 핵심 인프라입니다 각 클러스터에 East-West Gateway를 배치해야 하며, 이 Gateway가 cross-cluster mTLS 터널을 제공합니다 클러스터 A의 Envoy는 클러스터 B Pod IP에 직접 연결하지 않고, 반드시 East-West Gateway를 경유합니다

두 `istiod`가 서로 상대 클러스터의 엔드포인트를 주기적으로 동기화하므로, 하나의 `istiod`가 장애를 일으켜도 반대 클러스터의 `istiod`는 계속 동작합니다 단, East-West Gateway를 통한 cross-cluster 트래픽은 Gateway가 배포된 클러스터의 `istiod` 상태에 영향을 받습니다

Multi-Primary의 추가 인프라 요건은 다음과 같습니다

- 각 클러스터에 `istio-eastwestgateway` 배포
- 두 `istiod` 간 상호 Kubernetes API 접근 권한 (RBAC + ServiceAccount token 공유)
- ClusterMesh 또는 Gateway API 기반 cross-cluster 연결 설정

### Primary-Remote — 단일 Control Plane이 양 클러스터를 관리

Primary-Remote는 `istiod`를 Primary 클러스터에만 배치하고, Remote 클러스터의 Envoy 프록시까지 하나의 `istiod`가 xDS를 제공하는 구성입니다

Remote 클러스터의 Envoy는 Primary 클러스터에 있는 `istiod`의 엔드포인트(보통 LoadBalancer Service IP 또는 Ingress Gateway)로 직접 gRPC 연결을 맺습니다 이 gRPC 연결을 통해 Remote 클러스터의 모든 설정 갱신이 이루어집니다

**cross-cloud latency가 mesh 안정성에 영향을 미치는 구체적 경로**는 아래와 같습니다

```text
Remote 클러스터 Envoy → Primary istiod (cross-cloud gRPC)
                     ↑
            이 경로의 latency 또는 패킷 손실이
            xDS 동기화 지연 또는 연결 끊김을 유발
```

클라우드 내부 네트워크는 RTT가 수 ms 수준이지만, cross-cloud 인터넷 경로는 RTT 50~200ms가 일반적입니다 gRPC long-polling 연결은 네트워크 불안정에 민감하여, 패킷 손실이나 간헐적 끊김이 Envoy의 설정 갱신 중단으로 이어질 수 있습니다

**단일 CP 장애의 의미**도 Multi-Primary와 근본적으로 다릅니다 Primary `istiod`가 장애를 일으키면 다음 상황이 동시에 발생합니다

- Primary 클러스터 Envoy: 새 설정 갱신 불가 (기존 캐시로 동작)
- Remote 클러스터 Envoy: 동일하게 설정 갱신 불가
- 신규 서비스 배포, HPA 스케일, 트래픽 정책 변경: 어느 클러스터에서도 반영 불가

이것이 Primary-Remote의 blast radius가 전체 클러스터로 확산되는 이유입니다

### 독립 mesh — 클러스터별 완전 분리

독립 mesh는 각 클러스터를 완전히 분리된 별도의 서비스 메시로 운영합니다 클러스터 A의 `istiod`는 클러스터 B를 전혀 알지 못하고, 설정 동기화 경로도 존재하지 않습니다

cross-cluster 트래픽이 없다는 의미가 아닙니다 서비스 간 호출은 **메시 외부의 라우팅 계층**(엣지 프록시, CDN Workers, DNS 등)이 담당합니다 Istio mesh 안에서는 "이 요청을 반대 클러스터로 보내라"는 규칙 자체가 없고, 트래픽이 어떤 클러스터에 도달하는지는 메시 바깥에서 결정됩니다

**blast radius 격리가 완전한 이유**는 구조적으로 단순합니다

한 클러스터의 `istiod`가 장애를 일으켜도, 그 `istiod`의 xDS를 구독하는 Envoy는 해당 클러스터의 것뿐입니다 반대 클러스터의 `istiod`는 별도로 존재하고, 자체 클러스터 내 Envoy들에게 독립적으로 설정을 전달합니다 두 Control Plane 사이에 아무런 의존 경로가 없으므로, 장애가 클러스터 경계를 넘어 전파될 채널 자체가 없습니다

![Istio 멀티클러스터 토폴로지 3종 비교|tall](/diagrams/goti-deepdive-istio-multicluster-topology-1.svg)

위 다이어그램은 세 토폴로지의 구조를 나란히 비교합니다 왼쪽 **Multi-Primary**에서는 양쪽 클러스터가 각자 `istiod`를 가지고, 두 CP 사이에 서비스 발견 동기화 연결(보라색 점선)이 존재합니다 중간 **Primary-Remote**에서는 오른쪽 Remote 클러스터에 `istiod`가 없고, Primary `istiod`로부터 xDS 설정이 단방향으로 전달됩니다 오른쪽 **독립 mesh**에서는 두 클러스터가 각자 `istiod`를 보유하되 클러스터 간 연결 자체가 없습니다

하단 비교 표에서 핵심 차이를 확인할 수 있습니다 CP 장애의 blast radius가 Primary-Remote에서만 "전체 클러스터"로 확산되며, cross-cloud latency의 영향도 Primary-Remote에서만 "xDS 동기화에 직접 영향"을 미칩니다 독립 mesh는 두 항목 모두 "없음" 또는 "해당 클러스터만"입니다

### cross-cluster 서비스 디스커버리의 구체적 메커니즘

Multi-Primary에서 cross-cluster 서비스 발견이 구현되는 기술적 경로를 더 자세히 보겠습니다

클러스터 A의 `istiod`는 클러스터 B의 Kubernetes API Server에 `RemoteCluster` 설정으로 접근 권한을 얻습니다 이 권한으로 클러스터 B의 `Service`, `Endpoints`, `Pod` 리소스를 watch합니다 클러스터 B에 Service Y의 새 Pod가 뜨면, 클러스터 A의 `istiod`가 이를 감지하고 클러스터 A 내 Envoy들에게 EDS 갱신을 내립니다

Envoy가 cross-cluster Pod IP로 직접 패킷을 보내도 네트워크 경로가 없는 경우가 대부분이므로, 실제 전달은 East-West Gateway를 경유합니다 Envoy는 클러스터 B의 East-West Gateway IP를 향해 요청을 보내고, Gateway가 내부에서 올바른 Pod로 전달합니다 이때 전 구간이 Istio mTLS로 암호화됩니다

독립 mesh에서는 이런 경로 자체가 없습니다 클러스터 A의 서비스가 클러스터 B의 서비스를 호출하려면 외부 DNS 이름(예: `gcp-api.go-ti.shop`)을 통해 진입해야 합니다 이 요청은 Istio mesh 바깥을 나가 엣지 계층을 거쳐 GCP Load Balancer → GKE Ingress → Istio Ingress Gateway 경로로 들어옵니다

---

## 📐 세부 동작과 옵션

### 토폴로지별 트레이드오프 전체 비교

| 항목 | Multi-Primary | Primary-Remote | 독립 mesh |
|---|---|---|---|
| CP 수 | 클러스터 수만큼 | 1개 | 클러스터 수만큼 |
| cross-cluster 서비스 발견 | 있음 (East-West GW) | 있음 (xDS 공유) | 없음 (엣지 계층에서 분배) |
| CP 장애 blast radius | 해당 클러스터만 | **전체 클러스터** | 해당 클러스터만 |
| cross-cloud latency 영향 | 디스커버리 지연에만 | **xDS 동기화에 직접 영향** | 없음 |
| 추가 인프라 | East-West GW 필요 | 없음 | 없음 |
| 운영 복잡도 | 높음 | 중간 | 낮음 |
| 단일 mesh 정책 | 가능 (전 클러스터 통합 정책) | 가능 | 불가 (클러스터별 독립 정책) |
| 적합한 시나리오 | 동일 리전 또는 전용선 연결 클러스터 | 같은 리전 내 보조 클러스터 | cross-cloud, 완전 격리 필요 시 |

### Envoy xDS 캐시와 CP 장애 시 동작

CP 장애가 발생해도 Envoy는 즉시 모든 트래픽을 거부하지 않습니다 마지막으로 받은 xDS 설정이 메모리에 캐시되어 있으므로, 기존에 알고 있던 서비스 엔드포인트로는 계속 트래픽을 전달합니다

다만 다음 상황에서는 CP 없이 처리가 불가능합니다

- 새 서비스가 배포되어 처음 등록될 때
- Pod가 교체되어 엔드포인트 IP가 바뀔 때
- VirtualService, DestinationRule 등 트래픽 정책이 변경될 때
- HPA가 스케일 아웃해 새 Pod가 생겨날 때

장애 시간이 길어질수록 캐시 정보가 실제 클러스터 상태와 벌어집니다 특히 Pod 재시작이 잦은 환경에서는 수 분 이내에 캐시 부정합이 발생할 수 있습니다

### East-West Gateway 심층

Multi-Primary에서 East-West Gateway는 단순한 L4 로드 밸런서가 아닙니다 `AUTO_PASSTHROUGH` 모드로 동작하며, 들어오는 SNI(Server Name Indication)를 보고 어느 Pod로 라우팅할지 결정합니다

```yaml
# East-West Gateway 포트 설정
- port:
    number: 15443
    name: tls
    protocol: TLS
  tls:
    mode: AUTO_PASSTHROUGH  # SNI 기반 라우팅
```

원격 클러스터의 Envoy가 `outbound_.8080_._.reviews.default.svc.cluster.local` 형태의 SNI를 포함해 연결하면, East-West Gateway가 이를 파싱해 적합한 Pod로 전달합니다 TLS를 종료하지 않고 투명하게 통과시키므로(Passthrough), 양 끝단의 Envoy가 mTLS handshake를 직접 수행합니다

![독립 mesh의 blast radius 격리 구조|tall](/diagrams/goti-deepdive-istio-multicluster-topology-2.svg)

위 다이어그램은 동일한 "istiod 장애" 시나리오에서 독립 mesh와 Primary-Remote의 결과를 대조합니다 왼쪽 **독립 mesh** 시나리오에서 AWS EKS의 `istiod`가 장애를 일으켰습니다 AWS EKS 내 서비스들은 xDS 갱신이 중단되지만, GCP GKE의 `istiod`는 독립적으로 동작하고 GKE 내 서비스들은 정상적으로 트래픽을 처리합니다 두 클러스터 사이에 설정 동기화 경로가 없으므로 장애가 GKE로 전파되지 않습니다

오른쪽 **Primary-Remote** 시나리오에서 Primary `istiod`가 장애를 일으키면 상황이 다릅니다 Primary 클러스터의 xDS 갱신이 중단되는 것은 독립 mesh와 동일하지만, Remote 클러스터도 Primary `istiod`에 의존하고 있으므로 Remote 클러스터의 Envoy들도 설정 갱신을 받을 수 없게 됩니다 단일 CP가 양쪽 클러스터의 상태 변화를 처리하는 구조이기 때문에, 장애 영향이 두 클러스터 전체로 동시에 확산됩니다

---

## 🧩 go-ti에서는

go-ti는 AWS EKS(ap-northeast-2)와 GCP GKE(asia-northeast3)를 동시에 운영했습니다 1주 시연 기간이라는 제약과 서로 다른 CSP라는 환경에서 멀티클러스터 Istio 구성을 평가했습니다

**Multi-Primary**는 East-West Gateway 구성과 클러스터 간 API 접근 권한 설정이 필요했고, 두 CSP 사이의 안정적인 연결을 보장해야 했습니다 1주 시연 범위를 초과하는 인프라 작업으로 판단해 기각했습니다

**Primary-Remote**는 단일 `istiod`가 cross-cloud gRPC로 Remote 클러스터를 관리하는 구조인데, AWS-GCP 사이의 인터넷 경로 latency(50~200ms RTT)가 xDS 동기화 안정성에 직접 영향을 미친다는 점이 문제였습니다 Primary CP 장애 시 양 클러스터 모두 설정 갱신이 중단되는 blast radius 확산도 Active-Passive 구조에서 용납하기 어려운 위험이었습니다

결국 **각 CSP 독립 mesh**를 선택했습니다 AWS EKS와 GCP GKE 각각이 자체 `istiod`를 운영하고, mesh 간 직접 통신은 없습니다 cross-cluster 트래픽 분배는 Cloudflare Workers 엣지 라우팅이 담당합니다 한 클러스터의 `istiod` 장애가 반대 클러스터에 영향을 미치지 않고, 추가 인프라 없이 각 CSP 네이티브 네트워크(ALB, GCP LB)를 그대로 활용할 수 있었습니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [Multi-Cloud 상위 아키텍처 ADR — Active-Passive with 팀 코드 라우팅](/logs/goti-multicloud-high-level-architecture-adr)에 정리했습니다

---

## 📚 핵심 정리

- **Control Plane 위치가 blast radius를 결정합니다** 단일 CP(Primary-Remote)는 장애 시 모든 클러스터의 xDS 동기화가 중단되고, 독립 CP(Multi-Primary·독립 mesh)는 해당 클러스터에만 영향이 멈춥니다
- **cross-cloud latency는 Primary-Remote에서만 mesh 안정성 위협이 됩니다** xDS gRPC 연결이 cross-cloud 인터넷 경로를 사용하는 구성에서 패킷 손실이나 지연이 설정 갱신 중단으로 이어질 수 있습니다
- **독립 mesh는 단순함이 강점입니다** 추가 인프라(East-West GW) 없이 각 클러스터가 자체 완결적으로 동작하고, CP 장애의 blast radius가 클러스터 경계에서 완전히 차단됩니다
- **cross-cluster 서비스 발견이 필요한지 여부가 토폴로지 선택의 1순위 기준입니다** 서비스 A가 서비스 B를 메시 내부에서 직접 호출해야 한다면 Multi-Primary나 Primary-Remote를 고려해야 하고, 엣지 계층에서 트래픽 분배가 가능하다면 독립 mesh가 운영 부담이 가장 낮습니다
- **Envoy xDS 캐시로 인해 CP 장애가 즉각적 서비스 중단을 의미하지는 않습니다** 그러나 신규 서비스 등록, Pod 교체, 트래픽 정책 변경은 CP 없이 반영할 수 없으므로 장애 지속 시간이 길어질수록 캐시 부정합이 심화됩니다
