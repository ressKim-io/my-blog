---
title: "Service Mesh가 필요한 이유"
excerpt: "마이크로서비스가 복잡해지면 네트워크도 복잡해진다. Spring Cloud 같은 라이브러리 방식과 Istio 같은 인프라 방식, 뭐가 다를까?"
category: "kubernetes"
tags:
  - istio
  - service-mesh
  - microservices
  - sidecar
  - kubernetes
series:
  name: "istio-intro"
  order: 1
date: "2025-12-06"
---

## 🎯 시작하며

마이크로서비스를 공부하면서 "서비스가 많아지면 어떻게 관리하지?"라는 의문이 들었습니다. 처음엔 Spring Cloud나 Netflix OSS 같은 라이브러리로 해결하는 줄 알았는데, 실무 아키텍처를 보니 Istio라는 게 계속 나왔습니다.

"그냥 라이브러리 쓰면 되는 거 아닌가?" 싶었는데, 알고 보니 접근 방식 자체가 달랐습니다.

---

## 🔥 마이크로서비스의 네트워크 복잡도

### 모놀리식 시절의 단순함

```
┌─────────────────────────────────────────────────────────────┐
│                        단순한 세계                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   [Client] ──── HTTP ──── [Single App] ──── [Database]     │
│                                                             │
│   • 서비스 간 통신? 없음 (함수 호출)                        │
│   • 로드밸런싱? 앞단에 하나                                 │
│   • 인증? 입구에서 한 번                                    │
│   • 디버깅? 스택트레이스 하나                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

모든 게 하나의 애플리케이션 안에 있으니 네트워크 호출도 최소화되고, 디버깅도 쉬웠습니다. 하지만 확장성에 한계가 있습니다.

### 마이크로서비스로 전환하면?

![Microservices Complexity](/images/istio-intro/microservices-complexity.svg)

갑자기 복잡도가 폭발합니다.

**새로 생긴 문제들:**
- 서비스 A가 서비스 B를 호출하려면? → 서비스 디스커버리
- B가 3개 인스턴스면 어디로? → 클라이언트 사이드 로드밸런싱
- B가 죽으면? → 서킷 브레이커, 재시도
- A→B 호출이 느린데 어디서? → 분산 트레이싱
- A→B 호출을 누가 했는지? → 인증/인가
- A→B 트래픽이 도청되면? → mTLS 암호화

**이 모든 걸 각 서비스에 구현해야 합니다.**

---

## 🤔 해결 방법 비교: 라이브러리 vs Service Mesh

![Library vs Mesh](/images/istio-intro/library-vs-mesh.svg)

### 라이브러리 방식 (Spring Cloud 등)

### 장점
- 익숙한 언어로 제어 가능 (Java, Node.js 등)
- 세밀한 커스터마이징

### 단점 (이게 문제)

**1. 언어별로 다 구현해야 함**

| 언어 | 서킷브레이커 | 로드밸런싱 | 트레이싱 |
|------|------------|-----------|---------|
| Java | Resilience4j | Ribbon | Sleuth |
| Go | go-kit? | ??? | ??? |
| Python | pybreaker? | ??? | ??? |

회사에서 Go, Python, Node.js, Java를 다 쓴다면? 각 언어별로 서킷브레이커, 트레이싱, 로드밸런싱을 다 구현해야 합니다. **동일한 동작 보장도 어렵습니다.**

**2. 라이브러리 버전 업그레이드 = 전체 서비스 재배포**

```
서킷브레이커 정책 변경
    ↓
모든 서비스 코드 수정
    ↓
각 서비스 테스트
    ↓
각 서비스 재배포
    ↓
100개 서비스면 100번 반복
```

**3. 비즈니스 로직과 인프라 로직이 섞임**

```java
// 비즈니스 로직인가, 인프라 로직인가?
@CircuitBreaker(name = "orderService", fallbackMethod = "fallback")
@Retry(name = "orderService")
@TimeLimiter(name = "orderService")
public Order createOrder(OrderRequest request) {
    // 실제 비즈니스 로직은 여기
    return orderClient.create(request);
}
```

개발자가 비즈니스 로직에 집중하기 어렵습니다.

---

## 💡 Service Mesh 방식의 핵심

네트워크 로직을 애플리케이션에서 분리해서 인프라 레벨로 내리는 방식입니다.

**핵심 아이디어**: 모든 트래픽이 Sidecar Proxy를 거치게 해서, 네트워크 로직을 한 곳에서 처리합니다.

| 구성 요소 | 역할 |
|----------|------|
| **App Container** | 비즈니스 로직만 (순수 HTTP 호출) |
| **Sidecar Proxy** | 서킷브레이커, 로드밸런싱, mTLS, 트레이싱, 인증/인가 |
| **통신 방식** | App은 localhost만 호출, Sidecar가 외부 연결 처리 |

앱은 네트워크를 신경 쓸 필요가 없습니다. 그냥 HTTP 요청을 보내면 Sidecar가 알아서 처리합니다.

---

## ⚖️ 라이브러리 vs Service Mesh 비교

| 항목 | 라이브러리 방식 | Service Mesh |
|------|----------------|--------------|
| **언어 의존성** | 언어별 라이브러리 필요 | 언어 무관 |
| **정책 변경** | 코드 수정 + 재배포 | 설정 변경만 |
| **비즈니스 로직** | 인프라 로직과 혼재 | 완전 분리 |
| **일관성** | 구현마다 다를 수 있음 | 동일한 동작 보장 |
| **리소스** | 앱 메모리 사용 | Sidecar 추가 리소스 |
| **디버깅** | 코드에서 확인 | 프록시 로그/메트릭 |
| **복잡도** | 개발자가 이해 필요 | 플랫폼팀이 관리 |

### 언제 뭘 써야 할까?

**라이브러리 방식이 맞는 경우:**
- 단일 언어 (Java 온리) 환경
- 서비스 개수가 적음 (10개 미만)
- 세밀한 커스터마이징 필요
- 팀이 이미 익숙함

**Service Mesh가 맞는 경우:**
- 폴리글랏 환경 (다양한 언어)
- 서비스 개수가 많음 (수십~수백 개)
- 보안(mTLS) 요구사항
- 플랫폼팀이 인프라 관리

---

## 🚀 Istio가 등장한 이유

Istio는 대표적인 Service Mesh 구현체입니다.

![Istio Architecture](/images/istio-intro/istio-intro-architecture.svg)

| 구성 요소 | 역할 |
|----------|------|
| **Control Plane (istiod)** | 설정 관리, 인증서 발급 (mTLS), 서비스 디스커버리 |
| **Data Plane (Envoy)** | 실제 트래픽 처리, Pod 간 mTLS 자동 암호화 |

### Istio가 제공하는 것

1. **트래픽 관리**: 라우팅, 로드밸런싱, 카나리 배포
2. **보안**: mTLS 자동화, 인증/인가
3. **관측성**: 메트릭, 트레이싱, 로깅 (코드 수정 없이!)

### 2024년 11월, Ambient Mode GA

최근 Istio v1.24에서 **Ambient Mode**가 GA(General Availability)가 되었습니다. Sidecar 없이도 Service Mesh를 사용할 수 있게 되었습니다.

![Sidecar vs Ambient](/images/istio-intro/sidecar-vs-ambient.svg)

| 모드 | 프록시 위치 | 리소스 사용 |
|------|-----------|------------|
| **Sidecar Mode** | Pod당 Envoy 1개 | 높음 (Pod마다 메모리/CPU) |
| **Ambient Mode** | Node당 ztunnel 1개 | 80-90% 절감! |

Ambient Mode에 대해서는 istio-ambient 시리즈에서 자세히 다루겠습니다.

---

## 📚 배운 점

1. **마이크로서비스 = 네트워크 복잡도 증가**
   - 서비스 간 통신 문제를 해결해야 함

2. **라이브러리 방식의 한계**
   - 언어마다 구현 필요
   - 코드와 인프라 로직 혼재
   - 정책 변경 = 전체 재배포

3. **Service Mesh = 네트워크 로직 분리**
   - Sidecar Proxy가 트래픽 처리
   - 언어 무관, 일관된 동작
   - 설정만으로 정책 변경

4. **Istio = Service Mesh 구현체**
   - 트래픽 관리, 보안, 관측성 제공
   - 2024년 Ambient Mode GA로 더 가벼워짐

---

## 🔗 다음 편 예고

Part 2에서는 Istio의 내부 아키텍처를 파헤쳐보겠습니다.
- Control Plane (istiod)이 정확히 뭘 하는지
- Data Plane (Envoy)이 트래픽을 어떻게 가로채는지
- xDS API가 뭔지

---

## 📖 참고 자료

- [Istio Ambient Mode GA 발표](https://istio.io/latest/blog/2024/ambient-reaches-ga/)
- [CNCF: Istio Ambient Mode GA](https://www.cncf.io/blog/2024/11/07/fast-secure-and-simple-istios-ambient-mode-reaches-general-availability-in-v1-24/)
- [Istio 공식 문서](https://istio.io/latest/docs/)
