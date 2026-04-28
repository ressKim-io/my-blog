---
title: "Istio Observability Part 4: Kiali로 Service Mesh 시각화하기"
excerpt: "Kiali를 활용한 서비스 토폴로지 시각화와 Istio 설정 검증"
category: istio
tags: ["istio", "observability", "kiali", "visualization", "service-mesh", "kubernetes", concept]
series:
  name: "istio-observability"
  order: 4
date: "2025-12-21"
---

## 🎯 시작하며

지금까지 메트릭, 트레이싱, 로깅을 배웠습니다. 이제 이 모든 것을 **시각적으로** 보여주는 **Kiali**를 다룹니다.

![Kiali Features](/images/istio-observability/kiali-features.svg)

| 기능 | 설명 |
|------|------|
| Service Graph | 서비스 토폴로지 시각화 |
| Health Status | Healthy/Degraded/Failure 상태 표시 |
| Traffic Flow | 실시간 요청량, 에러율, 응답시간 |
| Config Validation | VirtualService, DestinationRule 오류 감지 |

학습하면서 궁금했던 것들입니다:
- 서비스 간 의존 관계를 어떻게 파악할까?
- Istio 설정 오류를 어떻게 찾을까?
- 트래픽 흐름을 어떻게 모니터링할까?

---

## 🔧 Kiali 설치

### 설치

```bash
# Istio 애드온으로 설치
$ kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.20/samples/addons/kiali.yaml

# 확인
$ kubectl get pods -n istio-system -l app=kiali

# 접속
$ kubectl port-forward -n istio-system svc/kiali 20001:20001

# 브라우저에서 http://localhost:20001 접속
```

### 관련 애드온 함께 설치

Kiali는 Prometheus, Grafana, Jaeger와 연동됩니다:

```bash
# 전체 애드온 설치
$ kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.20/samples/addons/prometheus.yaml
$ kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.20/samples/addons/grafana.yaml
$ kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.20/samples/addons/jaeger.yaml
$ kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.20/samples/addons/kiali.yaml
```

---

## 📊 Graph (서비스 토폴로지)

### 기본 화면

![Kiali Service Graph](/images/istio-observability/kiali-graph.svg)

| 요소 | 설명 |
|------|------|
| Node (서비스) | 서비스 상태 (Healthy/Degraded/Failure) 표시 |
| Edge (연결선) | 요청량, 에러율, 프로토콜 표시 |
| Version | 버전별 트래픽 비율 표시 |

### Display 옵션

| 옵션 | 설명 |
|------|------|
| **App** | app 레이블 기준 그룹화 |
| **Service** | Kubernetes Service 기준 |
| **Workload** | Deployment/Pod 기준 |
| **Versioned App** | app + version 조합 |

### Traffic 표시

```
┌─────────────────────────────────────────────────────────────────┐
│              트래픽 표시 방식                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Edge (연결선) 정보:                                           │
│   ══════════════════                                            │
│                                                                 │
│   productpage ───[100 req/s, 0.1%]───▶ reviews                  │
│                  └───────┬───────┘                              │
│                          │                                      │
│                  요청량, 에러율                                 │
│                                                                 │
│   Node (서비스) 정보:                                           │
│   ══════════════════                                            │
│                                                                 │
│   ┌───────────────────┐                                         │
│   │    reviews        │                                         │
│   │ ● v1: 33%         │  ← 버전별 트래픽 비율                   │
│   │ ● v2: 33%         │                                         │
│   │ ● v3: 33%         │                                         │
│   │                   │                                         │
│   │ P99: 45ms         │  ← 응답시간                             │
│   │ Err: 0.5%         │  ← 에러율                               │
│   └───────────────────┘                                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🏥 Health Status

### 건강 상태 색상

![Kiali Health Status](/images/istio-observability/kiali-health.svg)

| 상태 | 색상 | 조건 |
|------|------|------|
| Healthy | 녹색 | 에러율 < 0.1%, 모든 Pod Ready |
| Degraded | 노란색 | 에러율 0.1% ~ 20%, 일부 Pod Not Ready |
| Failure | 빨간색 | 에러율 > 20%, 모든 Pod Not Ready |
| Unknown | 회색 | 트래픽 없음, 데이터 수집 불가 |

### 상세 Health 정보

```
┌─────────────────────────────────────────────────────────────────┐
│   Service: reviews                                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Health: ⚠ Degraded                                           │
│                                                                 │
│   Request Health:                                               │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  Inbound:  95% success (5% 5xx)                         │   │
│   │  Outbound: 99% success                                  │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│   Workload Health:                                              │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  reviews-v1:  3/3 pods ready  ●                         │   │
│   │  reviews-v2:  2/3 pods ready  ⚠  ← 1개 Not Ready       │   │
│   │  reviews-v3:  3/3 pods ready  ●                         │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│   [View in Grafana]  [View Traces]                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## ✅ Configuration Validation

Kiali의 가장 유용한 기능 중 하나입니다. Istio 설정 오류를 자동으로 감지합니다.

### 검증 항목

![Kiali Config Validation](/images/istio-observability/kiali-config-validation.svg)

Kiali는 각 리소스 타입별로 다른 검증을 수행합니다.

**VirtualService**: 가장 흔한 실수인 "subset이 DestinationRule에 없음" 오류를 잡아줍니다. Canary 배포 설정할 때 weight 합이 100%가 아니면 경고합니다.

**DestinationRule**: mTLS 설정이 PeerAuthentication과 충돌하는지 확인합니다. STRICT 모드인데 DestinationRule에서 DISABLE하면 경고가 뜹니다.

**Gateway**: Gateway를 만들어놓고 VirtualService에서 참조 안 하면 알려줍니다. TLS 설정 시 Secret이 없어도 감지합니다.

**ServiceEntry**: 외부 서비스 정의가 중복되면 어떤 것이 적용될지 예측하기 어렵습니다. Kiali가 미리 경고해줍니다.

### 검증 결과 확인

```
┌─────────────────────────────────────────────────────────────────┐
│   Istio Config - VirtualService                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Name           Namespace   Validation                         │
│   ────────────   ─────────   ──────────                         │
│   reviews-route  default     ● Valid                            │
│   ratings-route  default     ⚠ 1 Warning                        │
│   details-route  default     ✖ 2 Errors                         │
│                                                                 │
│   ─────────────────────────────────────────────────────────     │
│                                                                 │
│   details-route (Errors):                                       │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │ ✖ KIA1106: Subset not found                             │   │
│   │   Subset "v2" not found in DestinationRule "details"    │   │
│   │                                                         │   │
│   │ ✖ KIA1107: Host not found                               │   │
│   │   Host "details-v2" does not exist                      │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 주요 검증 코드

| 코드 | 설명 |
|------|------|
| `KIA0001` | 중복된 DestinationRule |
| `KIA0002` | 중복된 VirtualService |
| `KIA1101` | VirtualService의 host를 찾을 수 없음 |
| `KIA1105` | Subset을 찾을 수 없음 |
| `KIA1106` | DestinationRule에 subset 없음 |
| `KIA1107` | Gateway에 바인딩된 VS 없음 |

---

## 📈 Traffic Flow 분석

### 실시간 트래픽 보기

```
┌─────────────────────────────────────────────────────────────────┐
│   Graph - Traffic Animation                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   [▶ Play] [Display: Requests] [Time: 5m]                       │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                                                         │   │
│   │   productpage ══●══●══●══●══▶ reviews                   │   │
│   │                     │        │                          │   │
│   │                     │        └──●──●──▶ ratings         │   │
│   │                     │                                   │   │
│   │                     └──●──●──●──▶ details               │   │
│   │                                                         │   │
│   │   ● = 요청 흐름 (애니메이션)                            │   │
│   │   선 굵기 = 요청량                                      │   │
│   │   선 색상 = 에러율 (녹색→빨강)                          │   │
│   │                                                         │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 특정 서비스 상세

```
┌─────────────────────────────────────────────────────────────────┐
│   Service: reviews                                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Overview    Traffic    Inbound    Outbound    Traces          │
│   ═════════════════════════════════════════════════════════     │
│                                                                 │
│   Inbound Traffic:                                              │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  Source         Requests    P50     P99     Success     │   │
│   │  ─────────────  ────────    ────    ────    ───────     │   │
│   │  productpage    150/s       20ms    85ms    99.5%       │   │
│   │  test-client    10/s        25ms    100ms   98.0%       │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│   Outbound Traffic:                                             │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  Destination    Requests    P50     P99     Success     │   │
│   │  ─────────────  ────────    ────    ────    ───────     │   │
│   │  ratings        120/s       10ms    45ms    100%        │   │
│   │  mongodb        150/s       5ms     20ms    100%        │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Workloads & Services

### Workloads 목록

```
┌─────────────────────────────────────────────────────────────────┐
│   Workloads                                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Name           Type         Pods   Labels           Health    │
│   ────────────   ──────────   ────   ──────────────   ──────    │
│   reviews-v1     Deployment   3/3    app=reviews      ●         │
│                                      version=v1                 │
│   reviews-v2     Deployment   2/3    app=reviews      ⚠         │
│                                      version=v2                 │
│   reviews-v3     Deployment   3/3    app=reviews      ●         │
│                                      version=v3                 │
│                                                                 │
│   Sidecar Status:                                               │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  reviews-v1-xxx  ● Sidecar: Injected  Sync: SYNCED      │   │
│   │  reviews-v1-yyy  ● Sidecar: Injected  Sync: SYNCED      │   │
│   │  reviews-v2-xxx  ⚠ Sidecar: Injected  Sync: NOT_SENT   │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Istio Config

```
┌─────────────────────────────────────────────────────────────────┐
│   Istio Config                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Type               Name              Validation                │
│   ────────────────   ────────────────  ──────────                │
│   VirtualService     reviews-route     ● Valid                   │
│   DestinationRule    reviews           ● Valid                   │
│   Gateway            main-gateway      ● Valid                   │
│   ServiceEntry       external-api      ⚠ 1 Warning              │
│   AuthorizationPolicy allow-frontend   ● Valid                   │
│                                                                 │
│   [Create] VirtualService | DestinationRule | ...               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔍 Tracing 연동

Kiali에서 직접 Trace를 볼 수 있습니다:

```
┌─────────────────────────────────────────────────────────────────┐
│   Service: reviews - Traces                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Last 1 hour    [Errors only]    [> 1s]                        │
│                                                                 │
│   Trace ID       Date/Time           Duration   Spans   Status  │
│   ────────────   ────────────────    ────────   ─────   ──────  │
│   abc123...      2024-12-24 10:15    350ms      4       ●       │
│   def456...      2024-12-24 10:14    1.2s       5       ⚠       │
│   ghi789...      2024-12-24 10:12    150ms      3       ●       │
│                                                                 │
│   ─────────────────────────────────────────────────────────     │
│                                                                 │
│   Trace def456... (1.2s)                                        │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │ productpage ████                                   50ms │   │
│   │   └─ reviews ████████████████████████████████    1.1s  │   │
│   │       └─ ratings ████████████████████████        900ms │   │
│   │       └─ mongodb ██                               50ms │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│   [Open in Jaeger]                                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📋 실전 활용 시나리오

### 시나리오 1: 새 버전 배포 모니터링

```
1. Graph에서 버전별 트래픽 확인
   - v1: 90%, v2: 10% 확인

2. v2 Health 상태 확인
   - 에러율, 응답시간 비교

3. 문제 발생 시
   - Traces에서 상세 분석
   - Config에서 설정 검증
```

### 시나리오 2: 장애 원인 분석

```
1. Graph에서 빨간색 노드/엣지 확인

2. 해당 서비스 상세 확인
   - Inbound/Outbound 트래픽
   - 에러율, 응답시간

3. Traces로 상세 분석
   - 어디서 시간이 오래 걸리는가?
   - 어디서 에러가 발생하는가?

4. Logs로 상세 원인 확인
```

### 시나리오 3: 설정 검증

1. **Istio Config 메뉴**로 이동합니다
2. **Validation 상태**를 확인합니다 — ✖ Error는 즉시 수정 대상, ⚠ Warning은 검토 대상입니다
3. 문제 설정을 클릭해 상세 원인을 확인합니다
4. **YAML 에디터**로 수정합니다

---

## 📚 정리

```
┌─────────────────────────────────────────────────────────────────┐
│                   Kiali 활용 체크리스트                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ✅ 일상 모니터링                                              │
│      □ Graph에서 전체 토폴로지 확인                             │
│      □ Health 상태 확인                                         │
│      □ 트래픽 흐름 확인                                         │
│                                                                 │
│   ✅ 설정 관리                                                  │
│      □ Istio Config 검증                                        │
│      □ 오류/경고 해결                                           │
│      □ 새 설정 적용 후 검증                                     │
│                                                                 │
│   ✅ 장애 대응                                                  │
│      □ Graph에서 문제 서비스 파악                               │
│      □ Traces로 상세 분석                                       │
│      □ 관련 설정 확인                                           │
│                                                                 │
│   ✅ 연동                                                       │
│      □ Prometheus 연동 (메트릭)                                 │
│      □ Grafana 연동 (대시보드)                                  │
│      □ Jaeger 연동 (트레이싱)                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🎯 핵심 정리

| 기능 | 설명 | 사용 케이스 |
|------|------|-------------|
| **Graph** | 서비스 토폴로지 | 의존관계 파악, 트래픽 흐름 |
| **Health** | 건강 상태 | 문제 서비스 식별 |
| **Config** | 설정 검증 | Istio 설정 오류 발견 |
| **Traces** | 분산 트레이싱 | 상세 요청 분석 |

---

## 🔗 시리즈 마무리

istio-observability 시리즈를 마쳤습니다!

| Part | 내용 | 상태 |
|------|------|------|
| Part 1 | 메트릭 (Prometheus, Grafana) | ✅ |
| Part 2 | 분산 트레이싱 (Jaeger) | ✅ |
| Part 3 | Access Log | ✅ |
| Part 4 | Kiali 시각화 | ✅ |

다음 시리즈 **istio-ambient**에서는 Sidecar 없는 Service Mesh를 다룹니다:
- Ambient Mode 소개
- L4/L7 분리 아키텍처
- Sidecar vs Ambient 비교
- 실전 마이그레이션

---

## 🔗 참고 자료

- [Kiali Documentation](https://kiali.io/docs/)
- [Kiali Features](https://kiali.io/docs/features/)
- [Istio Observability](https://istio.io/latest/docs/concepts/observability/)
