---
title: "멀티클라우드 트래픽 라우팅 — 엣지 단일점 제어가 관측성을 만드는 원리"
excerpt: "Active-Passive 멀티클라우드에서 DNS Round Robin·앱 계층·엣지 라우팅 세 방식의 동작 원리와 한계를 비교하고, 라우팅 결정이 단일 지점에 집중되어야 관측과 수정이 가능한 이유를 설명합니다"
category: challenge
tags:
  - go-ti
  - multicloud
  - Cloudflare Workers
  - Active-Passive
  - DNS
  - edge-routing
  - concept
series:
  name: "goti-deepdive-edge"
  order: 6
date: "2026-04-15"
---

## 한 줄 요약

> Active-Passive 멀티클라우드에서 라우팅 결정은 DNS·앱·엣지 중 가장 작은 변경으로 가장 빠르게 관측·수정할 수 있는 지점에 두어야 하며, 그 답은 엣지 단일점입니다

---

## 🤔 무엇을 푸는 기술인가

두 클라우드를 동시에 가동하면 "어떤 요청이 어느 클라우드로 가는가"를 결정해야 합니다 이 결정을 **트래픽 라우팅**이라고 부릅니다

Active-Passive 구조에서 라우팅의 핵심 역할은 두 가지입니다

- **평상시**: 규칙(팀 코드·지역·기능 등)에 따라 두 클라우드에 요청을 분배
- **장애 시**: 한 쪽 클라우드가 죽었을 때 살아있는 클라우드로 자동 전환(failover)

이 두 역할을 얼마나 신뢰할 수 있게, 얼마나 빠르게 관측·수정할 수 있는지가 라우팅 계층 선택의 기준입니다

라우팅 계층의 후보는 크게 세 가지입니다

- **DNS 계층**: 도메인에 여러 A 레코드를 등록해 클라이언트가 무작위로 선택하게 함
- **앱 계층**: 서비스 코드 안에서 "내가 어느 클라우드인지"를 판단하고 요청을 보냄
- **엣지 계층**: 클라이언트와 오리진 사이의 프록시(CDN·Workers)에서 라우팅을 결정함

---

## 🔧 동작 원리

### DNS Round Robin — 캐시가 failover를 가린다

DNS Round Robin은 가장 단순한 분산 방식입니다 DNS 서버가 하나의 도메인에 두 클라우드의 IP를 모두 반환하고, 클라이언트가 그 중 하나를 선택해 접속합니다

```text
go-ti.shop A 203.0.113.10  ← AWS ALB
go-ti.shop A 34.64.0.20    ← GCP Load Balancer
```

DNS 서버는 두 레코드를 순서를 바꿔가며 응답합니다 첫 번째 클라이언트는 AWS IP를, 두 번째 클라이언트는 GCP IP를 받는 식입니다

이 구조에는 **TTL 캐시 문제**가 있습니다 클라이언트(브라우저·OS)는 DNS 응답을 TTL 시간 동안 캐시합니다 AWS 장애가 발생해 DNS에서 AWS 레코드를 제거해도, 이미 AWS IP를 캐시한 클라이언트들은 TTL이 만료될 때까지 AWS로 계속 요청을 보냅니다

문제를 정리하면 다음과 같습니다

| 문제 | 원인 | 영향 |
|---|---|---|
| TTL 캐시 지연 | OS·브라우저가 DNS 응답을 캐시 | 장애 후에도 수십 초~수분간 실패 요청 지속 |
| 캐시 계층 다양성 | ISP resolver·OS·브라우저·앱 각각 독립 캐시 | TTL을 낮춰도 모든 캐시를 제어 불가 |
| 라우팅 관측 불가 | 클라이언트 선택은 서버에서 볼 수 없음 | "지금 몇 %가 AWS로 가는지" 파악 불가 |
| 세밀한 분배 불가 | A 레코드 비율로 라우팅만 가능 | 팀 코드·기능 기반 라우팅 불가 |

TTL을 0초로 설정하면 캐시 문제가 줄어들지만, 모든 요청마다 DNS 조회가 발생해 지연이 증가합니다 그리고 브라우저와 OS의 최소 TTL 하한값(보통 30~60초) 때문에 TTL=0이 실제로 동작하지 않는 경우가 많습니다

### 앱 계층 라우팅 — 앱이 CSP를 알아야 한다

앱 계층 라우팅은 서비스 코드 안에서 요청을 두 클라우드에 분배하는 방식입니다 예를 들어 API Gateway나 Go 서비스가 헤더나 쿠키 값을 보고 "이 요청은 AWS로, 저 요청은 GCP로"를 결정합니다

```go
// 앱 계층 라우팅 예시
func routeRequest(teamCode string) string {
    if isSamsungTeam(teamCode) {
        return "https://aws-api.go-ti.shop"
    }
    return "https://gcp-api.go-ti.shop"
}
```

이 방식은 라우팅 로직을 서비스 코드에 직접 둡니다 문제는 **CSP 결합(coupling)**입니다

서비스가 "내가 어느 클라우드인지" 또는 "요청을 어느 클라우드로 보낼지"를 알면, 그 서비스는 멀티클라우드 환경에 결합됩니다 클라우드 구성이 바뀔 때마다 코드 수정·빌드·배포가 필요합니다 AWS를 GCP로 교체하거나 새 클라우드를 추가하면 이 판단 로직을 가진 모든 서비스를 수정해야 합니다

추가로 다음 문제가 발생합니다

- **라우팅 로직 분산**: 여러 서비스에 라우팅 코드가 분산되어 전체 라우팅 상태를 파악하기 어려움
- **failover 지연**: 앱 코드가 장애를 감지하고 대안 경로로 전환하는 데 추가 지연 발생
- **테스트 복잡성**: 라우팅 로직이 코드에 있어 단위 테스트에서 클라우드 종속성을 모킹해야 함

### 엣지 계층 라우팅 — 결정을 단일점에 집중

엣지 라우팅은 클라이언트와 오리진 사이의 프록시 계층에서 라우팅을 결정합니다 Cloudflare Workers 같은 엣지 컴퓨팅 플랫폼은 클라이언트 요청을 받아 오리진으로 포워딩하기 전에 JavaScript 코드를 실행할 수 있습니다

```javascript
// Cloudflare Worker — 팀 코드 기반 라우팅
export default {
  async fetch(request, env) {
    const teamCode = request.headers.get("X-Team-Code") ?? "default";
    const cloud = TEAM_ROUTING[teamCode] ?? "gcp";

    const origin = cloud === "aws"
      ? "https://aws-api.go-ti.shop"
      : "https://gcp-api.go-ti.shop";

    const response = await fetch(new Request(origin, request));

    // 라우팅 결정을 응답 헤더에 기록
    const headers = new Headers(response.headers);
    headers.set("x-goti-route-assigned", cloud);
    return new Response(response.body, { ...response, headers });
  }
};
```

엣지 라우팅이 DNS Round Robin·앱 계층과 다른 핵심 차이가 있습니다

**라우팅 결정이 단일 코드베이스에 있습니다** `TEAM_ROUTING` 맵 하나만 수정하면 전체 라우팅 규칙이 바뀝니다 DNS 레코드를 여러 곳에서 편집하거나, 여러 서비스 코드를 수정·배포할 필요가 없습니다

**앱 코드는 CSP를 모릅니다** Go 서비스는 자신이 AWS에 있는지 GCP에 있는지 알 필요가 없습니다 라우팅 결정은 엣지에서 끝나고, 오리진 서비스는 평범한 HTTP 요청을 처리할 뿐입니다

**응답 헤더로 라우팅 결정을 관측할 수 있습니다** `x-goti-route-assigned` 같은 헤더를 응답에 포함하면 개발자 도구나 로그 수집에서 "이 요청이 어느 클라우드로 갔는지"를 즉시 확인할 수 있습니다

![멀티클라우드 트래픽 라우팅 아키텍처 — 엣지 단일점 라우팅 구조](/diagrams/goti-deepdive-multicloud-traffic-routing-1.svg)

위 아키텍처 다이어그램은 요청이 클라이언트에서 오리진까지 전달되는 경로입니다 사용자 브라우저에서 출발한 요청은 Cloudflare 엣지에서 한 번 처리됩니다 Workers 코드가 팀 코드를 읽고 라우팅 결정을 내린 뒤, AWS ALB 또는 GCP Load Balancer로 포워딩합니다 오리진에서 받은 응답에 라우팅 결정 헤더를 추가해 클라이언트에 반환합니다

이 구조에서 AWS EKS와 GCP GKE는 서로의 존재를 모릅니다 각각 독립된 Istio mesh를 운영하고, 자신에게 도달하는 요청을 처리할 뿐입니다 라우팅 전략이 바뀌어도 오리진 서비스는 재배포 없이 그대로 운영됩니다

### failover — 응답 코드로 라우팅을 전환

엣지 라우팅의 또 다른 강점은 **오리진 응답을 보고 즉시 대안으로 전환**할 수 있다는 점입니다 이것이 Circuit Breaker 패턴과 결합됩니다

```javascript
// 오리진 응답 5xx 시 Circuit Breaker 동작
const isCircuitOpen = await isCircuitOpenForCloud(cloud, env);
if (isCircuitOpen) {
  cloud = cloud === "aws" ? "gcp" : "aws";  // 반대 클라우드로 전환
}
```

DNS Round Robin에서 failover는 TTL 캐시 때문에 즉각 반영이 어렵습니다 앱 계층 라우팅에서 failover는 서비스 코드가 장애를 감지하고 로직을 분기해야 합니다 엣지 라우팅에서 failover는 Worker 코드 한 곳에서 처리되고, 오리진 서비스 코드를 건드리지 않습니다

![DNS Round Robin vs 엣지 라우팅 — failover 관측성 비교](/diagrams/goti-deepdive-multicloud-traffic-routing-2.svg)

위 비교 다이어그램은 장애 발생 시 두 방식의 동작 차이입니다 왼쪽 DNS Round Robin에서 AWS 장애가 발생하면, DNS 레코드에서 AWS IP를 제거해도 클라이언트의 브라우저·OS 캐시가 살아있는 동안 실패 요청이 계속됩니다 오른쪽 엣지 라우팅에서 AWS 장애 시 Worker가 5xx를 감지하고 다음 요청부터 즉시 GCP로 전환합니다 응답 헤더 `x-goti-route-circuit: open/aws`로 장애 전환이 관측됩니다

캐시가 개입하지 않기 때문에 장애 감지에서 대안 라우팅까지 지연이 수 밀리초 수준입니다 DNS 전파 시간이나 앱 재배포 없이, Worker 코드 수정·배포만으로 라우팅 전략을 교체할 수 있습니다

---

## 📐 세부 동작과 옵션

### 세 방식 비교

| 항목 | DNS Round Robin | 앱 계층 라우팅 | 엣지 라우팅 |
|---|---|---|---|
| failover 속도 | TTL 만료 후 (수십 초~분) | 앱 감지·분기 로직 의존 | 다음 요청 즉시 |
| 라우팅 관측성 | 없음 (클라이언트 선택) | 로그 분산 | 응답 헤더로 즉시 확인 |
| 세밀한 분배 규칙 | 비율 기반만 가능 | 코드 복잡도 증가 | Worker 코드 한 곳에서 제어 |
| 앱 CSP 결합 | 없음 | 있음 | 없음 |
| 라우팅 변경 비용 | DNS 편집 (전파 필요) | 코드 수정·빌드·배포 | Worker 배포 (수 초) |
| 장애 도메인 독립성 | 없음 (클라이언트 의존) | 앱과 동일 도메인 | edge (CSP 독립) |

### 응답 헤더 관측 포인트

엣지 라우팅에서 라우팅 결정의 관측은 응답 헤더로 이루어집니다 go-ti ADR-0025에서 정의한 헤더 예시입니다

| 헤더 | 값 예시 | 의미 |
|---|---|---|
| `x-goti-route-assigned` | `aws` / `gcp` | 팀 코드로 배정된 오리진 클라우드 |
| `x-goti-route-circuit` | `open/aws` | 특정 클라우드 Circuit Breaker 열림 상태 |
| `x-goti-route-failover` | `true` | 원래 배정과 다른 클라우드로 전환됨 |

이 헤더 세 개로 요청 단위 라우팅 결정, 현재 circuit 상태, failover 여부를 브라우저 개발자 도구에서 즉시 확인할 수 있습니다 클라우드 로그 수집 파이프라인 없이도 "지금 어느 클라우드로 가는지" 파악이 가능합니다

### 팀 코드 라우팅 — 규칙 기반 분배

단순 비율 기반 분배 외에 **식별자 기반 라우팅**이 가능한 것이 엣지 라우팅의 강점입니다 팀 코드, 지역 코드, 기능 플래그 등 요청 컨텍스트를 읽어 목적지를 결정합니다

```javascript
const TEAM_ROUTING = {
  "samsung-*": "aws",   // 삼성 계열 → AWS
  "doosan-*":  "gcp",   // 두산 계열 → GCP
  "default":   "gcp",   // 팀 코드 미보유 → GCP (default)
};
```

팀 코드가 없는 요청(경기 조회, 로그인 등 공통 API)은 기본값 클라우드로 보냅니다 기본값이 코드에 명시되어 있으므로, 장애 상황에서 어느 클라우드가 대신 처리하는지도 추론 가능합니다

cost freeze 같은 운영 이벤트에서도 Worker 코드 수정만으로 모든 트래픽을 한 클라우드로 집중시킬 수 있습니다 AWS ASG를 0으로 줄이고, Worker의 `TEAM_ROUTING`을 전부 `gcp`로 교체하면 됩니다

---

## 🧩 go-ti에서는

go-ti는 팀 구성 특성(삼성 계열/두산 계열로 절반씩 분리)과 클라우드 구성(AWS EKS + GCP GKE)이 자연스럽게 1:1 매칭되는 구조였습니다 DNS Round Robin은 브라우저·OS 캐시로 failover 관측이 불가능했고, 앱 계층 라우팅은 Go 서비스 6개가 "내가 어느 CSP인지" 판단 로직을 각자 보유해야 해 CSP 결합도가 높아졌습니다

Cloudflare Workers를 엣지 라우팅으로 채택해 팀 코드 기반 분배와 Circuit Breaker failover를 Worker 한 곳에서 처리했습니다 응답 헤더 `x-goti-route-assigned`/`x-goti-route-circuit`/`x-goti-route-failover` 세 가지로 라우팅 결정의 관측성을 확보했습니다 2026-04-19 AWS cost freeze 이벤트에서 Worker 코드 31줄 수정만으로 GCP only 전환을 완료했고, 이 변경은 오리진 서비스 재배포 없이 이루어졌습니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [Multi-Cloud 상위 아키텍처 ADR — Active-Passive with 팀 코드 라우팅](/logs/goti-multicloud-high-level-architecture-adr)에 정리했습니다

---

## 📚 핵심 정리

- **DNS Round Robin은 캐시 때문에 failover를 즉시 관측할 수 없습니다** 브라우저·OS·ISP resolver의 독립 캐시가 TTL이 끝날 때까지 장애 IP를 유지합니다
- **앱 계층 라우팅은 서비스를 CSP에 결합합니다** 클라우드 구성이 바뀔 때마다 여러 서비스의 코드·빌드·배포가 따라옵니다
- **엣지 라우팅은 결정을 단일 지점에 집중합니다** Worker 코드 한 곳을 수정하면 전체 라우팅 전략이 바뀌고, 오리진 서비스는 재배포 없이 그대로 운영됩니다
- **응답 헤더가 라우팅 결정을 관측 가능하게 합니다** 요청 단위로 어느 클라우드로 갔는지, circuit이 열렸는지, failover가 발생했는지를 헤더에서 즉시 확인할 수 있습니다
- **장애 도메인 독립성이 failover의 전제 조건입니다** 엣지는 어느 CSP에도 속하지 않으므로 GCP·AWS 양쪽 장애와 무관하게 라우팅 결정을 계속 수행합니다
