---
title: "Zero Trust 보안, Istio mTLS로 구현하기"
excerpt: "경계 보안의 한계와 Zero Trust 개념, Istio가 mTLS를 자동으로 처리하는 방법, PeerAuthentication 모드별 차이"
category: "kubernetes"
tags:
  - istio
  - mtls
  - zero-trust
  - security
  - peerauthentication
  - kubernetes
series:
  name: "istio-security"
  order: 1
date: "2025-12-09"
---

## 🎯 시작하며

istio-intro 시리즈에서 Istio가 mTLS를 자동으로 처리한다고 했습니다. 그런데 왜 mTLS가 필요한 걸까요?

이번 시리즈에서는 **Zero Trust 보안**이 뭔지, Istio가 어떻게 구현하는지 파헤쳐보겠습니다.

---

## 🏰 전통적인 보안: 경계 보안

예전 보안 모델은 **성(Castle)과 해자(Moat)** 방식이었습니다.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    경계 보안 (Perimeter Security)                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   외부 (위험)                           내부 (신뢰)                 │
│   ════════════                          ════════════                │
│                                                                     │
│   ┌─────────┐                    ┌─────────────────────────────┐    │
│   │ Hacker  │ ──── ❌ ────┐      │      내부 네트워크           │    │
│   └─────────┘              │      │                             │    │
│                            │      │  Service A ◄──► Service B   │    │
│   ┌─────────┐              │      │      │                      │    │
│   │  User   │ ──────────┐  │      │      ▼                      │    │
│   └─────────┘            │  │      │  Service C ◄──► Database   │    │
│                          ▼  ▼      │                             │    │
│                     ┌──────────┐   │   "내부니까 다 믿어"        │    │
│                     │ Firewall │───┤                             │    │
│                     │   VPN    │   │   평문 통신 OK              │    │
│                     └──────────┘   │   인증 생략 OK              │    │
│                                    └─────────────────────────────┘    │
│                                                                     │
│   문제: 내부에 침입하면 다 뚫림!                                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 경계 보안의 문제점

**1. 내부 위협에 취약**
- 악의적인 내부자
- 감염된 내부 시스템
- 한 번 뚫리면 전체 노출

**2. 클라우드/컨테이너 환경에서 무의미**
```
┌─────────────────────────────────────────────────────────────────────┐
│                 클라우드 환경의 현실                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   "경계가 어디야?"                                                  │
│                                                                     │
│   • Pod는 동적으로 생성/삭제됨                                      │
│   • IP는 계속 바뀜                                                  │
│   • 같은 노드에 다른 테넌트 Pod가 있음                              │
│   • 멀티 클라우드, 하이브리드 환경                                  │
│                                                                     │
│   결론: 네트워크 경계로 신뢰를 판단할 수 없음                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔐 Zero Trust: "절대 믿지 마, 항상 검증해"

Zero Trust는 **"아무도 믿지 않는다"**는 보안 모델입니다.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Zero Trust                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   핵심 원칙:                                                        │
│   ══════════                                                        │
│                                                                     │
│   1. Never Trust, Always Verify                                     │
│      → 내부든 외부든 모든 요청을 검증                               │
│                                                                     │
│   2. Assume Breach                                                  │
│      → 이미 침입당했다고 가정하고 설계                              │
│                                                                     │
│   3. Verify Explicitly                                              │
│      → 모든 접근에 대해 인증/인가 수행                              │
│                                                                     │
│   4. Least Privilege Access                                         │
│      → 최소한의 권한만 부여                                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Zero Trust 적용 시

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Zero Trust 환경                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Service A ──────────────────────────► Service B                   │
│                                                                     │
│   매 요청마다:                                                      │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │ 1. 너 누구야? (인증 - Authentication)                      │   │
│   │    → mTLS 인증서로 신원 확인                                │   │
│   │                                                             │   │
│   │ 2. 이거 할 수 있어? (인가 - Authorization)                  │   │
│   │    → AuthorizationPolicy로 권한 확인                        │   │
│   │                                                             │   │
│   │ 3. 통신 내용 보호 (암호화)                                  │   │
│   │    → TLS로 암호화                                           │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│   내부 통신도 예외 없음!                                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔒 mTLS가 Zero Trust의 핵심인 이유

### TLS vs mTLS 다시 보기

```
┌─────────────────────────────────────────────────────────────────────┐
│                      TLS vs mTLS                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   TLS (일반 HTTPS)                                                  │
│   ════════════════                                                  │
│                                                                     │
│   Client ────────────────────────────► Server                       │
│          "서버 인증서 보여줘"           "여기"                       │
│          "OK, 암호화 통신하자"          "OK"                        │
│                                                                     │
│   • 서버만 인증서 제공                                              │
│   • 클라이언트는 익명                                               │
│   • 웹 브라우저 ↔ 웹서버에 적합                                     │
│                                                                     │
│   ─────────────────────────────────────────────────────────────     │
│                                                                     │
│   mTLS (Mutual TLS, 상호 인증)                                      │
│   ════════════════════════════                                      │
│                                                                     │
│   Client ◄───────────────────────────► Server                       │
│          "서버 인증서 보여줘"           "여기, 너도 보여줘"         │
│          "내 인증서 여기"               "검증 완료"                 │
│          "너도 검증 완료"               "암호화 통신하자"           │
│                                                                     │
│   • 양쪽 모두 인증서 제공                                           │
│   • 서로의 신원 확인                                                │
│   • 서비스 간 통신에 적합                                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### mTLS가 제공하는 것

1. **신원 확인 (Identity)**: "이 요청이 진짜 Service A에서 온 거 맞아?"
2. **암호화 (Encryption)**: 통신 내용 도청 불가
3. **무결성 (Integrity)**: 통신 내용 위변조 불가

---

## ⚙️ Istio에서 mTLS 자동화

Istio를 쓰면 mTLS가 자동으로 적용됩니다. 개발자가 인증서를 관리할 필요가 없습니다.

### 자동화 과정

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Istio mTLS 자동화                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   1. Pod 생성                                                       │
│      ┌───────────────────────────────────────────────────────────┐  │
│      │  kubectl apply -f deployment.yaml                         │  │
│      │      ↓                                                    │  │
│      │  Sidecar (istio-proxy) 자동 주입                          │  │
│      └───────────────────────────────────────────────────────────┘  │
│                                                                     │
│   2. 인증서 발급                                                    │
│      ┌───────────────────────────────────────────────────────────┐  │
│      │  istiod (Citadel)                                         │  │
│      │      ↓                                                    │  │
│      │  SPIFFE ID 기반 인증서 생성                               │  │
│      │  spiffe://cluster.local/ns/default/sa/my-service          │  │
│      │      ↓                                                    │  │
│      │  SDS API로 Envoy에 전달                                   │  │
│      └───────────────────────────────────────────────────────────┘  │
│                                                                     │
│   3. 통신 시                                                        │
│      ┌───────────────────────────────────────────────────────────┐  │
│      │  App A → (평문) → Envoy A                                 │  │
│      │                      ↓                                    │  │
│      │                   mTLS 암호화                             │  │
│      │                      ↓                                    │  │
│      │  Envoy B ← (mTLS) ← 네트워크                              │  │
│      │      ↓                                                    │  │
│      │  (평문) → App B                                           │  │
│      └───────────────────────────────────────────────────────────┘  │
│                                                                     │
│   개발자가 할 일: 없음!                                             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 📋 PeerAuthentication: mTLS 정책 설정

Istio에서 mTLS 정책은 `PeerAuthentication` 리소스로 설정합니다.

### mTLS 모드 3가지

```yaml
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: istio-system  # mesh 전체 적용
spec:
  mtls:
    mode: STRICT  # 또는 PERMISSIVE, DISABLE
```

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PeerAuthentication 모드                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   STRICT (엄격)                                                     │
│   ═════════════                                                     │
│   • mTLS만 허용                                                     │
│   • 평문 요청 거부                                                  │
│   • 프로덕션 권장                                                   │
│                                                                     │
│   Mesh Pod ──(mTLS)──► Mesh Pod     ✅ 허용                        │
│   외부     ──(평문)───► Mesh Pod     ❌ 거부                        │
│                                                                     │
│   ─────────────────────────────────────────────────────────────     │
│                                                                     │
│   PERMISSIVE (허용)                                                 │
│   ═════════════════                                                 │
│   • mTLS와 평문 모두 허용                                           │
│   • 마이그레이션 중에 사용                                          │
│   • 기본값                                                          │
│                                                                     │
│   Mesh Pod ──(mTLS)──► Mesh Pod     ✅ 허용                        │
│   외부     ──(평문)───► Mesh Pod     ✅ 허용                        │
│                                                                     │
│   ─────────────────────────────────────────────────────────────     │
│                                                                     │
│   DISABLE (비활성화)                                                │
│   ══════════════════                                                │
│   • mTLS 비활성화                                                   │
│   • 평문만 사용                                                     │
│   • 보안 취약, 권장 안함                                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 적용 범위

```yaml
# Mesh 전체 (istio-system namespace)
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: istio-system
spec:
  mtls:
    mode: STRICT

---
# 특정 Namespace
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: production
spec:
  mtls:
    mode: STRICT

---
# 특정 Workload
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: my-service-policy
  namespace: production
spec:
  selector:
    matchLabels:
      app: my-service
  mtls:
    mode: PERMISSIVE  # 이 서비스만 예외
```

### 포트별 설정

```yaml
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: my-service-policy
  namespace: production
spec:
  selector:
    matchLabels:
      app: my-service
  mtls:
    mode: STRICT
  portLevelMtls:
    8080:
      mode: PERMISSIVE  # 8080 포트만 평문 허용
```

---

## 🚀 PERMISSIVE → STRICT 마이그레이션

프로덕션에서 mTLS를 적용할 때는 단계적으로 진행합니다.

```
┌─────────────────────────────────────────────────────────────────────┐
│               PERMISSIVE → STRICT 마이그레이션                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Step 1: 현재 상태 확인                                            │
│   ════════════════════════                                          │
│   $ istioctl analyze                                                │
│   $ kubectl get peerauthentication -A                               │
│                                                                     │
│   Step 2: PERMISSIVE로 시작                                         │
│   ═══════════════════════════                                       │
│   • 기존 평문 트래픽도 허용                                         │
│   • Sidecar 없는 서비스와 통신 가능                                 │
│                                                                     │
│   Step 3: 메트릭 모니터링                                           │
│   ═════════════════════════                                         │
│   • mTLS vs 평문 트래픽 비율 확인                                   │
│   • 평문 트래픽이 있다면 해당 서비스 확인                           │
│                                                                     │
│   Kiali에서 mTLS 상태 확인:                                         │
│   🔒 mTLS 활성화됨                                                  │
│   ⚠️ 일부 평문 트래픽 존재                                          │
│                                                                     │
│   Step 4: STRICT 전환                                               │
│   ═══════════════════════                                           │
│   • 모든 서비스에 Sidecar 주입 확인                                 │
│   • STRICT 모드 적용                                                │
│   • 에러 모니터링                                                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 트러블슈팅

```bash
# mTLS 상태 확인
$ istioctl x describe pod my-pod-xxx

# 인증서 확인
$ istioctl proxy-config secret my-pod-xxx -n default

# 평문 요청 테스트 (STRICT면 실패해야 함)
$ kubectl exec -it my-pod -c istio-proxy -- \
    curl http://target-service:8080 -v
```

---

## 📚 배운 점

### 경계 보안의 한계
- 내부 위협에 취약
- 클라우드/컨테이너 환경에서 경계가 모호
- "내부니까 안전"은 틀린 가정

### Zero Trust 원칙
- 아무도 믿지 않음
- 모든 요청을 검증
- 최소 권한 부여

### Istio mTLS
- 서비스 간 상호 인증
- 자동 인증서 발급/갱신
- 개발자 개입 없이 보안 강화

### PeerAuthentication
- STRICT: mTLS만 허용 (프로덕션)
- PERMISSIVE: 평문도 허용 (마이그레이션)
- 범위: Mesh → Namespace → Workload → Port

---

## 🔗 다음 편 예고

Part 2에서는 SPIFFE를 다룹니다:
- SPIFFE ID가 정확히 뭔지
- Istio가 인증서를 어떻게 발급하는지
- ServiceAccount와의 관계

---

## 📖 참고 자료

- [NIST Zero Trust Architecture](https://www.nist.gov/publications/zero-trust-architecture)
- [Istio Security Overview](https://istio.io/latest/docs/concepts/security/)
- [PeerAuthentication 공식 문서](https://istio.io/latest/docs/reference/config/security/peer_authentication/)
