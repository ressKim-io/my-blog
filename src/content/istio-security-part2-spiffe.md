---
title: "SPIFFE로 이해하는 서비스 신원(Identity)"
excerpt: "IP 기반 신원의 문제점, SPIFFE ID 구조, Istio가 인증서를 발급하고 갱신하는 과정"
category: istio
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

![IP Identity Problem](/images/istio-security/ip-identity-problem.svg)

| 문제 | 설명 |
|------|------|
| **Pod IP 변경** | Pod 재시작 시 새 IP 할당 (10.0.1.5 → 10.0.2.17 → ...) |
| **IP 재사용** | 삭제된 서비스의 IP를 다른 서비스가 재사용 가능 |
| **NAT 환경** | 여러 서비스가 같은 외부 IP로 보일 수 있음 |

**결론**: IP는 신원(Identity)으로 부적합

---

## 🎫 SPIFFE: 서비스 신원의 표준

**SPIFFE** (Secure Production Identity Framework For Everyone)는 서비스 신원의 표준 프레임워크입니다.

### SPIFFE ID 구조

![SPIFFE ID Structure](/images/istio-security/spiffe-id-structure.svg)

SPIFFE ID는 URI 형식으로 구성됩니다. 각 부분이 의미를 가지고 있어서 ID만 봐도 서비스가 어디 소속인지 알 수 있습니다.

**1. Scheme (`spiffe://`)**: 모든 SPIFFE ID는 이것으로 시작합니다. HTTP URL이 `http://`로 시작하는 것처럼, SPIFFE는 `spiffe://`로 시작합니다.

**2. Trust Domain (`cluster.local`)**: 신뢰 경계를 정의합니다. 같은 Trust Domain 내의 서비스들만 서로 신뢰합니다. Kubernetes에서는 보통 `cluster.local`을 사용합니다. 멀티 클러스터 환경에서는 각 클러스터가 다른 Trust Domain을 가질 수 있습니다.

**3. Namespace (`/ns/production`)**: Kubernetes Namespace를 그대로 반영합니다. `production` 네임스페이스의 서비스는 `/ns/production`이 됩니다.

**4. ServiceAccount (`/sa/order-service`)**: 워크로드의 실제 신원입니다. Pod가 어떤 ServiceAccount로 실행되는지에 따라 이 부분이 결정됩니다.

**예시**:
- `spiffe://cluster.local/ns/default/sa/my-service`
- `spiffe://cluster.local/ns/production/sa/payment`

### SPIFFE ID vs IP

![SPIFFE vs IP|xtall](/images/istio-security/spiffe-vs-ip.svg)

| 항목 | IP 기반 | SPIFFE ID |
|------|--------|-----------|
| **지속성** | ❌ Pod 재시작 시 변경 | ✅ 고정 |
| **고유성** | ❌ 재사용 가능 | ✅ 유일 |
| **의미** | ❌ 숫자일 뿐 | ✅ 서비스 정보 포함 |
| **인증** | ❌ 위조 쉬움 | ✅ 인증서 기반 검증 |

---

## 🔏 SVID: SPIFFE 인증서

**SVID** (SPIFFE Verifiable Identity Document)는 SPIFFE ID를 담은 인증서입니다.

![X.509 SVID](/images/istio-security/x509-svid.svg)

| 필드 | 값 | 설명 |
|------|-----|------|
| **Issuer** | istiod (CA) | 인증서 발급자 |
| **Validity** | 24시간 | 짧은 유효기간으로 보안 강화 |
| **SAN (URI)** | `spiffe://cluster.local/ns/default/sa/my-service` | **SPIFFE ID가 여기에!** |
| **Signature** | istiod 서명 | CA가 서명한 검증 가능한 인증서 |

**핵심**: SAN(Subject Alternative Name) 필드에 SPIFFE ID가 포함됨

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

istiod가 워크로드에 인증서를 발급하는 과정입니다. 4단계로 나눠서 살펴봅시다.

### 전체 흐름

![Certificate Issuance Overview](/images/istio-security/cert-issuance-overview.svg)

Pod가 시작되면 istio-proxy가 istiod에게 인증서를 요청하고, istiod가 검증 후 발급합니다. 이 과정이 완전 자동화되어 있어서 개발자가 인증서를 직접 관리할 필요가 없습니다.

### Step 1: Pod 시작

![Step 1: Pod Start](/images/istio-security/cert-issuance-step1.svg)

Pod가 생성되면 Kubernetes가 자동으로 ServiceAccount Token을 마운트합니다. 이 토큰이 "나는 order-service야"라는 신원 증명의 시작점입니다.

핵심은 **istio-proxy(Envoy)**가 Sidecar로 함께 주입된다는 것입니다. 이 프록시가 인증서 요청부터 mTLS 통신까지 모든 것을 처리합니다.

### Step 2: CSR 전송

![Step 2: Send CSR](/images/istio-security/cert-issuance-step2.svg)

istio-proxy가 istiod에게 인증서를 요청합니다. 이때 두 가지를 함께 보냅니다:

1. **ServiceAccount Token**: "나는 order-service야"라는 증명
2. **CSR(Certificate Signing Request)**: "이 공개키로 인증서 만들어줘"

istiod 입장에서는 "정말 order-service 맞아?"를 검증해야 합니다.

### Step 3: 검증 및 발급

![Step 3: Verify and Issue](/images/istio-security/cert-issuance-step3.svg)

istiod는 CA(Certificate Authority) 역할을 합니다. 세 단계를 거칩니다:

1. **SA Token 검증**: Kubernetes API에 토큰이 유효한지 확인
2. **SPIFFE ID 생성**: Namespace와 ServiceAccount로 `spiffe://cluster.local/ns/{ns}/sa/{sa}` 생성
3. **X.509 서명**: SPIFFE ID를 SAN 필드에 넣고 서명

결과물은 24시간 유효한 X.509 인증서입니다.

### Step 4: 인증서 수신

![Step 4: Receive Certificate](/images/istio-security/cert-issuance-step4.svg)

istio-proxy가 인증서를 받으면:

- **메모리에 저장**: 파일 시스템에 쓰지 않아 보안이 강화됩니다
- **mTLS 통신 시작**: 다른 서비스와 암호화 통신이 가능해집니다
- **자동 갱신 예약**: 만료 전(75% 시점)에 자동으로 새 인증서를 요청합니다

개발자가 할 일은 **아무것도 없습니다**. Istio가 전부 처리합니다.

---

## 🔄 인증서 자동 갱신

Istio 인증서는 기본 24시간 유효하고 자동으로 갱신됩니다.

![Certificate Auto-Renewal](/images/istio-security/cert-auto-renewal.svg)

| 설정 | 값 | 설명 |
|------|-----|------|
| **유효 기간** | 24시간 | 짧은 유효기간으로 유출 피해 최소화 |
| **갱신 시점** | 만료 6시간 전 (75%) | 충분한 여유 시간 확보 |
| **갱신 방식** | 무중단 | 새 인증서 받은 후 전환 |

**장점**: 인증서 유출 시 피해 최소화, 개발자 개입 없이 자동 관리

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

![ServiceAccount to SPIFFE Mapping](/images/istio-security/sa-to-spiffe-mapping.svg)

| Kubernetes | SPIFFE ID |
|------------|-----------|
| Namespace: production | `/ns/production` |
| ServiceAccount: order-sa | `/sa/order-sa` |
| Trust Domain: cluster.local | `spiffe://cluster.local` |
| **결과** | `spiffe://cluster.local/ns/production/sa/order-sa` |

**같은 ServiceAccount = 같은 SPIFFE ID**
- order-pod-1, order-pod-2, order-pod-3 (모두 order-sa) → 같은 SPIFFE ID

**다른 ServiceAccount = 다른 SPIFFE ID**
- order-service (order-sa) → `.../sa/order-sa`
- payment-service (pay-sa) → `.../sa/pay-sa`

### ServiceAccount 설계 팁

| 패턴 | 설명 |
|------|------|
| **❌ 안 좋은 예** | 모든 서비스가 default SA 사용 → 모두 같은 SPIFFE ID → 세밀한 권한 제어 불가 |
| **✅ 좋은 예** | 서비스별 전용 SA (order-sa, payment-sa 등) → 서비스별 다른 SPIFFE ID → AuthorizationPolicy로 세밀한 제어 가능 |

---

## 🔍 mTLS 통신 시 SPIFFE ID 활용

실제 mTLS 통신에서 SPIFFE ID가 어떻게 사용되는지 봅시다.

![mTLS SPIFFE Handshake](/images/istio-security/mtls-spiffe-handshake.svg)

Order 서비스가 Payment 서비스를 호출할 때 일어나는 일입니다.

**Step 1-2: Order가 먼저 자신을 증명**

Order가 "나는 order-sa야"라고 인증서를 보냅니다. Payment는 이 인증서를 검증합니다:
- istiod CA 서명이 맞는지 확인
- SPIFFE ID(`spiffe://cluster.local/ns/default/sa/order-sa`)를 추출

**Step 3-4: Payment도 자신을 증명**

Payment도 똑같이 자신의 인증서를 보냅니다. Order가 검증합니다. 이것이 **상호(Mutual)** 인증입니다.

**Step 5: 암호화 통신 시작**

양쪽 모두 상대방을 확인했으므로, TLS 세션이 수립되고 암호화 통신이 시작됩니다.

이제 AuthorizationPolicy에서 SPIFFE ID를 기반으로 접근 제어가 가능합니다:

```yaml
# "order-sa만 payment에 접근 가능"
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
spec:
  selector:
    matchLabels:
      app: payment
  rules:
  - from:
    - source:
        principals: ["cluster.local/ns/default/sa/order-sa"]
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
