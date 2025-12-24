---
title: "SPIFFE로 이해하는 서비스 신원(Identity)"
excerpt: "IP 기반 신원의 문제점, SPIFFE ID 구조, Istio가 인증서를 발급하고 갱신하는 과정"
category: "kubernetes"
tags:
  - istio
  - spiffe
  - identity
  - certificate
  - serviceaccount
  - kubernetes
series:
  name: "istio-security"
  order: 2
date: "2025-12-10"
---

## 🎯 이전 글 요약

Part 1에서는 Zero Trust 보안과 mTLS를 정리했습니다.

**핵심 내용:**
- 경계 보안의 한계
- Zero Trust: 모든 요청 검증
- mTLS: 상호 인증 + 암호화
- PeerAuthentication으로 정책 설정

Part 2에서는 **서비스 신원(Identity)**을 파헤쳐보겠습니다. mTLS에서 "너 누구야?"를 어떻게 판단하는지 알아봅니다.

---

## 🤔 IP 기반 신원의 문제점

전통적으로 서비스를 식별할 때 IP 주소를 사용했습니다.

```
┌─────────────────────────────────────────────────────────────────────┐
│                   IP 기반 신원의 문제                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   "10.0.1.5에서 온 요청이니까 Order Service네"                      │
│                                                                     │
│   문제 1: Pod IP는 계속 바뀜                                        │
│   ════════════════════════════                                      │
│   Pod 재시작 → 새 IP 할당                                           │
│   10.0.1.5 → 10.0.2.17 → 10.0.3.8...                                │
│                                                                     │
│   문제 2: 같은 IP를 다른 서비스가 쓸 수 있음                        │
│   ══════════════════════════════════════════                        │
│   t=0: Order Service = 10.0.1.5                                     │
│   t=1: Order Service 삭제                                           │
│   t=2: Payment Service = 10.0.1.5 (재사용!)                         │
│                                                                     │
│   문제 3: NAT 환경에서 IP가 같을 수 있음                            │
│   ════════════════════════════════════════                          │
│   여러 서비스가 같은 외부 IP로 보일 수 있음                         │
│                                                                     │
│   결론: IP는 신원(Identity)으로 부적합                              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🎫 SPIFFE: 서비스 신원의 표준

**SPIFFE** (Secure Production Identity Framework For Everyone)는 서비스 신원의 표준 프레임워크입니다.

### SPIFFE ID 구조

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SPIFFE ID 구조                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   spiffe://cluster.local/ns/production/sa/order-service             │
│   ═══════ ═════════════ ══ ══════════ ══ ═════════════              │
│      │         │         │      │      │       │                    │
│      │         │         │      │      │       └─ ServiceAccount 이름│
│      │         │         │      │      └─ "sa" (ServiceAccount)     │
│      │         │         │      └─ Namespace 이름                   │
│      │         │         └─ "ns" (Namespace)                        │
│      │         └─ Trust Domain (클러스터 식별자)                    │
│      └─ SPIFFE 스킴                                                 │
│                                                                     │
│   예시:                                                             │
│   • spiffe://cluster.local/ns/default/sa/my-service                 │
│   • spiffe://cluster.local/ns/production/sa/payment                 │
│   • spiffe://prod.example.com/ns/api/sa/gateway                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### SPIFFE ID vs IP

```
┌─────────────────────────────────────────────────────────────────────┐
│                     SPIFFE ID vs IP                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   항목              IP 기반              SPIFFE ID                  │
│   ─────────────────────────────────────────────────────────────     │
│   지속성            ❌ Pod 재시작 시 변경   ✅ 고정                  │
│   고유성            ❌ 재사용 가능          ✅ 유일                  │
│   의미              ❌ 숫자일 뿐            ✅ 서비스 정보 포함      │
│   이식성            ❌ 환경에 종속          ✅ 환경 독립적           │
│   인증              ❌ 위조 쉬움            ✅ 인증서 기반 검증      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔏 SVID: SPIFFE 인증서

**SVID** (SPIFFE Verifiable Identity Document)는 SPIFFE ID를 담은 인증서입니다.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         X.509 SVID                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │  X.509 Certificate                                          │   │
│   │  ─────────────────────────────────────────────────────────  │   │
│   │                                                             │   │
│   │  Subject: ...                                               │   │
│   │  Issuer: istiod (CA)                                        │   │
│   │  Not Before: 2025-12-10 00:00:00                            │   │
│   │  Not After: 2025-12-11 00:00:00  ← 24시간 유효              │   │
│   │                                                             │   │
│   │  Subject Alternative Name (SAN):                            │   │
│   │    URI: spiffe://cluster.local/ns/default/sa/my-service     │   │
│   │         ↑                                                   │   │
│   │         SPIFFE ID가 여기에!                                 │   │
│   │                                                             │   │
│   │  Public Key: ...                                            │   │
│   │  Signature: ... (istiod가 서명)                             │   │
│   │                                                             │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│   핵심: SAN 필드에 SPIFFE ID가 포함됨                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 인증서 확인하기

```bash
# Pod의 인증서 확인
$ kubectl exec -it my-pod -c istio-proxy -- \
    cat /var/run/secrets/istio/root-cert.pem | openssl x509 -text -noout

# istioctl로 확인
$ istioctl proxy-config secret my-pod-xxx -n default

RESOURCE NAME     TYPE           STATUS     VALID CERT     SERIAL NUMBER     NOT AFTER
default           Cert Chain     ACTIVE     true           xxx               2025-12-11T00:00:00Z
ROOTCA            CA             ACTIVE     true           xxx               2035-12-08T00:00:00Z
```

---

## ⚙️ Istio 인증서 발급 과정

istiod가 워크로드에 인증서를 발급하는 과정입니다.

```
┌─────────────────────────────────────────────────────────────────────┐
│                   인증서 발급 과정                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   1. Pod 시작                                                       │
│      ┌─────────────────────────────────────────────────────────┐    │
│      │  Pod (my-service)                                       │    │
│      │  ┌───────────────┐  ┌───────────────────────────────┐   │    │
│      │  │   App         │  │   istio-proxy (Envoy)         │   │    │
│      │  └───────────────┘  │                               │   │    │
│      │                     │   ServiceAccount Token        │   │    │
│      │                     │   (자동 마운트)                │   │    │
│      │                     └───────────────────────────────┘   │    │
│      └─────────────────────────────────────────────────────────┘    │
│                                    │                                │
│   2. CSR 전송                      ▼                                │
│      ┌─────────────────────────────────────────────────────────┐    │
│      │  istio-proxy → istiod                                   │    │
│      │                                                         │    │
│      │  "나 my-service야, 인증서 주세요"                       │    │
│      │  + ServiceAccount Token (증거)                          │    │
│      │  + CSR (Certificate Signing Request)                    │    │
│      └─────────────────────────────────────────────────────────┘    │
│                                    │                                │
│   3. 검증 및 발급                  ▼                                │
│      ┌─────────────────────────────────────────────────────────┐    │
│      │  istiod                                                 │    │
│      │                                                         │    │
│      │  1) ServiceAccount Token 검증 (K8s API)                 │    │
│      │  2) Namespace, ServiceAccount 확인                      │    │
│      │  3) SPIFFE ID 생성                                      │    │
│      │     → spiffe://cluster.local/ns/default/sa/my-service   │    │
│      │  4) X.509 인증서 서명                                   │    │
│      │  5) SDS API로 Envoy에 전달                              │    │
│      └─────────────────────────────────────────────────────────┘    │
│                                    │                                │
│   4. 인증서 수신                   ▼                                │
│      ┌─────────────────────────────────────────────────────────┐    │
│      │  istio-proxy                                            │    │
│      │                                                         │    │
│      │  • 인증서 메모리에 저장 (파일 X)                        │    │
│      │  • mTLS 통신에 사용                                     │    │
│      │  • 만료 전 자동 갱신                                    │    │
│      └─────────────────────────────────────────────────────────┘    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 인증서 자동 갱신

Istio 인증서는 기본 24시간 유효하고 자동으로 갱신됩니다.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    인증서 자동 갱신                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   시간축 ─────────────────────────────────────────────────────►     │
│                                                                     │
│   T=0h        T=12h       T=18h       T=24h       T=36h             │
│   ├───────────┼───────────┼───────────┼───────────┼────►            │
│   │           │           │           │           │                 │
│   │  인증서   │           │  갱신     │  (만료)   │                 │
│   │  발급     │           │  시도     │           │                 │
│   │           │           │  ↓        │           │                 │
│   │           │           │  새 인증서 ─────────────────►            │
│   │           │           │  발급     │           │                 │
│   │                                                                 │
│   └─────────────────────────────────────────────────────────────    │
│                                                                     │
│   기본 설정:                                                        │
│   • 유효 기간: 24시간                                               │
│   • 갱신 시점: 만료 6시간 전 (75% 지점)                             │
│   • 갱신 방식: 무중단 (새 인증서 받은 후 전환)                      │
│                                                                     │
│   장점:                                                             │
│   • 인증서 유출 시 피해 최소화                                      │
│   • 개발자 개입 없이 자동 관리                                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔗 ServiceAccount와의 관계

Kubernetes ServiceAccount가 SPIFFE ID의 핵심입니다.

```yaml
# Pod 정의
apiVersion: v1
kind: Pod
metadata:
  name: order-service
  namespace: production
spec:
  serviceAccountName: order-sa  # 이게 핵심!
  containers:
  - name: order
    image: order:latest
```

```
┌─────────────────────────────────────────────────────────────────────┐
│              ServiceAccount → SPIFFE ID 매핑                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Kubernetes                          SPIFFE ID                     │
│   ══════════                          ═════════                     │
│                                                                     │
│   Namespace: production      →   ns/production                      │
│   ServiceAccount: order-sa   →   sa/order-sa                        │
│   Trust Domain: cluster.local →  spiffe://cluster.local             │
│                                                                     │
│   결과:                                                             │
│   spiffe://cluster.local/ns/production/sa/order-sa                  │
│                                                                     │
│   ─────────────────────────────────────────────────────────────     │
│                                                                     │
│   같은 ServiceAccount = 같은 SPIFFE ID                              │
│                                                                     │
│   order-service-pod-1 (order-sa) ──┐                                │
│   order-service-pod-2 (order-sa) ──┼─► 같은 SPIFFE ID               │
│   order-service-pod-3 (order-sa) ──┘                                │
│                                                                     │
│   다른 ServiceAccount = 다른 SPIFFE ID                              │
│                                                                     │
│   order-service (order-sa)   → spiffe://.../sa/order-sa             │
│   payment-service (pay-sa)   → spiffe://.../sa/pay-sa               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### ServiceAccount 설계 팁

```
┌─────────────────────────────────────────────────────────────────────┐
│               ServiceAccount 설계 권장사항                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ❌ 안 좋은 예                                                     │
│   ═════════════                                                     │
│   모든 서비스가 default ServiceAccount 사용                         │
│   → 모두 같은 SPIFFE ID                                             │
│   → 세밀한 권한 제어 불가능                                         │
│                                                                     │
│   ✅ 좋은 예                                                        │
│   ═══════════                                                       │
│   서비스별 전용 ServiceAccount                                      │
│   • order-service → order-sa                                        │
│   • payment-service → payment-sa                                    │
│   • user-service → user-sa                                          │
│   → 서비스별 다른 SPIFFE ID                                         │
│   → AuthorizationPolicy로 세밀한 제어 가능                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔍 mTLS 통신 시 SPIFFE ID 활용

실제 mTLS 통신에서 SPIFFE ID가 어떻게 사용되는지 봅시다.

```
┌─────────────────────────────────────────────────────────────────────┐
│                  mTLS 통신과 SPIFFE ID                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Order Service                        Payment Service              │
│   (order-sa)                           (payment-sa)                 │
│                                                                     │
│   ┌───────────────┐                    ┌───────────────┐            │
│   │  Envoy        │                    │  Envoy        │            │
│   │               │                    │               │            │
│   │  인증서:      │     TLS Handshake  │  인증서:      │            │
│   │  spiffe://    │ ◄───────────────► │  spiffe://    │            │
│   │  .../order-sa │                    │  .../pay-sa   │            │
│   └───────────────┘                    └───────────────┘            │
│                                                                     │
│   Handshake 과정:                                                   │
│   ═══════════════                                                   │
│   1. Order: "내 인증서야" (SPIFFE ID: order-sa)                     │
│   2. Payment: "검증할게... 서명 OK, SPIFFE ID 확인"                 │
│   3. Payment: "내 인증서야" (SPIFFE ID: payment-sa)                 │
│   4. Order: "검증할게... 서명 OK, SPIFFE ID 확인"                   │
│   5. 양쪽 모두 확인 완료, 암호화 통신 시작                          │
│                                                                     │
│   결과:                                                             │
│   • 양쪽 모두 상대방의 신원 확인                                    │
│   • IP가 아닌 SPIFFE ID로 식별                                      │
│   • AuthorizationPolicy에서 SPIFFE ID 기반 제어 가능                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 📚 배운 점

### IP 기반 신원의 한계
- Pod IP는 동적으로 변경됨
- 재사용 가능성
- 신원으로 부적합

### SPIFFE ID
- 표준화된 서비스 신원
- URI 형식: `spiffe://trust-domain/ns/namespace/sa/serviceaccount`
- IP와 무관하게 고정

### SVID (인증서)
- X.509 인증서에 SPIFFE ID 포함
- SAN(Subject Alternative Name) 필드에 저장
- istiod가 서명

### 인증서 발급/갱신
- ServiceAccount Token으로 신원 증명
- istiod가 검증 후 발급
- 24시간 유효, 자동 갱신

### ServiceAccount 설계
- 서비스별 전용 ServiceAccount 권장
- 같은 SA = 같은 SPIFFE ID
- 세밀한 권한 제어의 기반

---

## 🔗 다음 편 예고

Part 3에서는 AuthorizationPolicy를 다룹니다:
- SPIFFE ID 기반 접근 제어
- from, to, when 조건
- ALLOW vs DENY 평가 순서
- 실전 시나리오

---

## 📖 참고 자료

- [SPIFFE 공식 사이트](https://spiffe.io/)
- [SPIFFE ID 스펙](https://github.com/spiffe/spiffe/blob/main/standards/SPIFFE-ID.md)
- [Istio Identity 문서](https://istio.io/latest/docs/concepts/security/#istio-identity)
