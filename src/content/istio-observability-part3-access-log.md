---
title: "Istio Observability Part 3: Envoy Access Log로 문제 진단하기"
excerpt: "Envoy Access Log의 Response Flags를 이해하고 문제를 진단하는 방법"
category: "kubernetes"
tags: ["istio", "observability", "access-log", "envoy", "debugging", "kubernetes"]
series:
  name: "istio-observability"
  order: 3
date: "2024-12-24"
---

## 🎯 시작하며

Part 1에서 메트릭, Part 2에서 트레이싱을 배웠습니다. 이번에는 가장 상세한 정보를 제공하는 **Access Log**를 다룹니다.

![Observability 3 Pillars](/images/istio-observability/observability-pillars.svg)

| 축 | 질문 | 용도 |
|----|------|------|
| Metrics | "얼마나?" | 집계된 수치, 추세 파악, 대시보드 |
| Tracing | "어디를?" | 요청 경로, 병목 지점, 의존성 파악 |
| Logging | "무슨 일이?" (이번 Part) | 개별 이벤트, 상세 원인, 디버깅 |

학습하면서 궁금했던 것들입니다:
- Access Log는 어떤 정보를 담고 있을까?
- Response Flags는 무엇을 의미할까?
- 실제 문제 진단에 어떻게 활용할까?

---

## 💡 Envoy Access Log 이해

### Access Log 활성화

기본적으로 Istio는 Access Log를 비활성화합니다. 활성화가 필요합니다:

```yaml
apiVersion: install.istio.io/v1alpha1
kind: IstioOperator
spec:
  meshConfig:
    accessLogFile: /dev/stdout           # stdout으로 출력
    accessLogEncoding: JSON              # JSON 형식 (또는 TEXT)
```

또는 Telemetry API로:

```yaml
apiVersion: telemetry.istio.io/v1alpha1
kind: Telemetry
metadata:
  name: access-log
  namespace: istio-system
spec:
  accessLogging:
  - providers:
    - name: envoy
```

### 기본 로그 형식 (TEXT)

```
[2024-12-24T10:15:30.123Z] "GET /api/products HTTP/1.1" 200 - via_upstream - "-" 0 1234 45 43 "-" "Mozilla/5.0" "abc-123" "productpage:9080" "10.1.2.3:9080" inbound|9080|| 10.1.2.3:54321 10.1.2.3:9080 10.1.2.4:12345 - default
```

### JSON 형식

```json
{
  "start_time": "2024-12-24T10:15:30.123Z",
  "method": "GET",
  "path": "/api/products",
  "protocol": "HTTP/1.1",
  "response_code": 200,
  "response_flags": "-",
  "bytes_received": 0,
  "bytes_sent": 1234,
  "duration": 45,
  "upstream_service_time": 43,
  "x_forwarded_for": "-",
  "user_agent": "Mozilla/5.0",
  "request_id": "abc-123",
  "authority": "productpage:9080",
  "upstream_host": "10.1.2.3:9080",
  "upstream_cluster": "inbound|9080||",
  "downstream_remote_address": "10.1.2.4:12345",
  "route_name": "default"
}
```

---

## 🚩 Response Flags 완전 정복

Response Flags는 요청 처리 중 발생한 문제를 나타냅니다. 가장 중요한 디버깅 정보입니다.

### 주요 Response Flags

![Response Flags](/images/istio-observability/response-flags.svg)

| 분류 | 플래그 | 설명 |
|------|--------|------|
| 정상 | - | 에러 없음 |
| Upstream | UO | Upstream Overflow (Circuit Breaker) |
| Upstream | UF | Upstream Connection Failure |
| Upstream | UT | Upstream Request Timeout |
| Upstream | URX | Retry Limit Exceeded |
| Upstream | NR | No Route Configured |
| Downstream | DC | Downstream Connection Termination |
| Downstream | DT | Downstream Request Timeout |
| Local | RL | Rate Limited |
| Local | LR | Local Reset |

### 자주 보는 Response Flags 상세

#### UO (Upstream Overflow)

```
┌─────────────────────────────────────────────────────────────────┐
│   UO - Upstream Overflow                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   원인: DestinationRule의 Connection Pool 초과                  │
│                                                                 │
│   요청 ──▶ [Connection Pool 가득!] ──X──▶ 서비스                │
│               │                                                 │
│               └──▶ 503 + UO 반환                                │
│                                                                 │
│   확인할 것:                                                    │
│   1. DestinationRule의 connectionPool 설정                      │
│   2. 서비스의 실제 처리 능력                                    │
│   3. 동시 요청 수                                               │
│                                                                 │
│   해결:                                                         │
│   - connectionPool.http.http2MaxRequests 증가                   │
│   - connectionPool.tcp.maxConnections 증가                      │
│   - 서비스 스케일 아웃                                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### UF (Upstream Connection Failure)

```
┌─────────────────────────────────────────────────────────────────┐
│   UF - Upstream Connection Failure                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   원인: 서비스에 연결할 수 없음                                 │
│                                                                 │
│   요청 ──▶ 연결 시도 ──X──▶ 서비스 (응답 없음)                  │
│               │                                                 │
│               └──▶ 503 + UF 반환                                │
│                                                                 │
│   확인할 것:                                                    │
│   1. 서비스가 실행 중인가?                                      │
│   2. Pod가 Ready 상태인가?                                      │
│   3. Service 포트가 올바른가?                                   │
│   4. NetworkPolicy가 막고 있는가?                               │
│                                                                 │
│   해결:                                                         │
│   - kubectl get pods -l app=<service>                           │
│   - kubectl describe svc <service>                              │
│   - kubectl get networkpolicy                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### NR (No Route)

```
┌─────────────────────────────────────────────────────────────────┐
│   NR - No Route Configured                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   원인: 요청을 어디로 보낼지 모름                               │
│                                                                 │
│   요청 ──▶ VirtualService? ──X──▶ ???                           │
│               │                                                 │
│               └──▶ 404 + NR 반환                                │
│                                                                 │
│   확인할 것:                                                    │
│   1. VirtualService가 있는가?                                   │
│   2. hosts가 올바른가?                                          │
│   3. Service가 존재하는가?                                      │
│                                                                 │
│   해결:                                                         │
│   - istioctl analyze                                            │
│   - kubectl get vs -A                                           │
│   - kubectl get svc                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### URX (Upstream Retry Limit Exceeded)

```
┌─────────────────────────────────────────────────────────────────┐
│   URX - Upstream Retry Limit Exceeded                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   원인: 재시도 횟수 초과                                        │
│                                                                 │
│   요청 ──▶ 1차 시도 ──X                                         │
│        ──▶ 2차 시도 ──X                                         │
│        ──▶ 3차 시도 ──X                                         │
│               │                                                 │
│               └──▶ 503 + URX 반환                               │
│                                                                 │
│   확인할 것:                                                    │
│   1. 서비스가 응답하는가?                                       │
│   2. 간헐적 장애인가?                                           │
│   3. Retry 설정이 적절한가?                                     │
│                                                                 │
│   해결:                                                         │
│   - 서비스 상태 점검                                            │
│   - Retry 횟수 조정                                             │
│   - 근본 원인 해결                                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### DC (Downstream Connection Termination)

```
┌─────────────────────────────────────────────────────────────────┐
│   DC - Downstream Connection Termination                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   원인: 클라이언트가 연결을 끊음                                │
│                                                                 │
│   클라이언트 ──▶ 요청 ──▶ 처리 중...                            │
│       │                                                         │
│       └── (연결 끊음) ──X                                       │
│                                                                 │
│   확인할 것:                                                    │
│   1. 클라이언트 타임아웃 설정                                   │
│   2. 네트워크 불안정                                            │
│   3. 로드밸런서 타임아웃                                        │
│                                                                 │
│   해결:                                                         │
│   - 클라이언트 타임아웃 증가                                    │
│   - 서버 응답 시간 단축                                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ 로그 분석 실전

### 로그 조회

```bash
# 특정 Pod의 Access Log
$ kubectl logs deploy/my-app -c istio-proxy -f | grep "response_flags"

# JSON 파싱 (jq 사용)
$ kubectl logs deploy/my-app -c istio-proxy | jq 'select(.response_code >= 500)'

# 특정 Response Flag 필터
$ kubectl logs deploy/my-app -c istio-proxy | jq 'select(.response_flags == "UO")'
```

### 에러 패턴 분석

```bash
# Response Flag별 카운트
$ kubectl logs deploy/my-app -c istio-proxy | \
    jq -r '.response_flags' | sort | uniq -c | sort -rn

# 예상 출력
# 1234 -
#   45 UO
#   12 UF
#    3 NR

# 상태 코드별 카운트
$ kubectl logs deploy/my-app -c istio-proxy | \
    jq -r '.response_code' | sort | uniq -c | sort -rn
```

### 느린 요청 찾기

```bash
# 응답 시간이 1초 이상인 요청
$ kubectl logs deploy/my-app -c istio-proxy | \
    jq 'select(.duration > 1000)'

# 가장 느린 요청 Top 10
$ kubectl logs deploy/my-app -c istio-proxy | \
    jq -s 'sort_by(-.duration) | .[0:10]'
```

---

## 📊 커스텀 로그 포맷

### 기본 포맷 확장

```yaml
apiVersion: install.istio.io/v1alpha1
kind: IstioOperator
spec:
  meshConfig:
    accessLogFile: /dev/stdout
    accessLogEncoding: JSON
    accessLogFormat: |
      {
        "start_time": "%START_TIME%",
        "method": "%REQ(:METHOD)%",
        "path": "%REQ(X-ENVOY-ORIGINAL-PATH?:PATH)%",
        "protocol": "%PROTOCOL%",
        "response_code": "%RESPONSE_CODE%",
        "response_flags": "%RESPONSE_FLAGS%",
        "bytes_received": "%BYTES_RECEIVED%",
        "bytes_sent": "%BYTES_SENT%",
        "duration": "%DURATION%",
        "upstream_service_time": "%RESP(X-ENVOY-UPSTREAM-SERVICE-TIME)%",
        "x_forwarded_for": "%REQ(X-FORWARDED-FOR)%",
        "user_agent": "%REQ(USER-AGENT)%",
        "request_id": "%REQ(X-REQUEST-ID)%",
        "authority": "%REQ(:AUTHORITY)%",
        "upstream_host": "%UPSTREAM_HOST%",
        "upstream_cluster": "%UPSTREAM_CLUSTER%",
        "route_name": "%ROUTE_NAME%",
        "trace_id": "%REQ(X-B3-TRACEID)%",
        "user_id": "%REQ(X-USER-ID)%"
      }
```

### 주요 포맷 변수

| 변수 | 설명 |
|------|------|
| `%START_TIME%` | 요청 시작 시간 |
| `%DURATION%` | 총 처리 시간 (ms) |
| `%RESPONSE_CODE%` | HTTP 상태 코드 |
| `%RESPONSE_FLAGS%` | Response Flags |
| `%UPSTREAM_HOST%` | 실제 연결된 서버 IP |
| `%UPSTREAM_CLUSTER%` | 연결된 클러스터 이름 |
| `%REQ(헤더)%` | 요청 헤더 값 |
| `%RESP(헤더)%` | 응답 헤더 값 |

---

## 🔍 문제 진단 체크리스트

### 503 에러 진단

```
1. Response Flags 확인
   ├── UO → Connection Pool 설정 확인
   ├── UF → 서비스 상태 확인
   ├── URX → Retry 설정 + 서비스 상태
   └── NR → VirtualService/Service 확인

2. 상세 분석
   $ kubectl logs deploy/<app> -c istio-proxy | jq 'select(.response_code == 503)'

3. 관련 리소스 확인
   $ kubectl get pods -l app=<app>
   $ kubectl get svc <app>
   $ kubectl get vs <app>
   $ kubectl get dr <app>
```

### 504 에러 진단

```
1. 타임아웃 위치 확인
   ├── DT → 클라이언트 타임아웃
   ├── UT → VirtualService timeout
   └── - + 504 → 업스트림 서비스 타임아웃

2. 타임아웃 설정 확인
   $ kubectl get vs <app> -o yaml | grep timeout

3. 서비스 응답 시간 확인
   $ kubectl logs deploy/<app> -c istio-proxy | jq '.duration' | sort -n | tail
```

### 연결 끊김 진단

```
1. Response Flags 확인
   ├── DC → 클라이언트가 끊음
   ├── UC → 서버가 끊음
   └── LR → Envoy가 리셋

2. 원인 분석
   - DC: 클라이언트 타임아웃 확인
   - UC: 서버 측 연결 유지 설정 확인
   - LR: Envoy 설정 확인
```

---

## 📈 로그 모니터링 아키텍처

![Log Collection Architecture](/images/istio-observability/log-collection-arch.svg)

| 구성요소 | 역할 |
|----------|------|
| Envoy Sidecar | Access Log를 stdout으로 출력 |
| Fluentd / Fluent Bit | Node 레벨에서 로그 수집 |
| Elasticsearch / Loki | 로그 저장소 |
| Kibana / Grafana | 로그 시각화 |

---

## 📚 정리

```
┌─────────────────────────────────────────────────────────────────┐
│                 Access Log 체크리스트                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ✅ 설정                                                       │
│      □ Access Log 활성화                                        │
│      □ JSON 형식 권장                                           │
│      □ 필요한 필드 포함                                         │
│                                                                 │
│   ✅ Response Flags 숙지                                        │
│      □ UO: Connection Pool                                      │
│      □ UF: 연결 실패                                            │
│      □ NR: 라우트 없음                                          │
│      □ URX: 재시도 초과                                         │
│      □ DC/UC: 연결 끊김                                         │
│                                                                 │
│   ✅ 모니터링                                                   │
│      □ Response Flags 알림 설정                                 │
│      □ 느린 요청 추적                                           │
│      □ 로그 수집 파이프라인 구축                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🎯 핵심 정리

| Response Flag | 의미 | 확인할 것 |
|---------------|------|----------|
| `-` | 정상 | - |
| `UO` | Circuit Breaker | DestinationRule connectionPool |
| `UF` | 연결 실패 | Pod 상태, Service |
| `NR` | 라우트 없음 | VirtualService, Service |
| `URX` | 재시도 초과 | 서비스 상태, Retry 설정 |
| `DC` | 클라이언트 끊음 | 클라이언트 타임아웃 |

---

## 🔗 다음 편 예고

Part 4에서는 **Kiali**를 다룹니다:
- Service Mesh 시각화
- Service Graph
- 설정 검증

---

## 🔗 참고 자료

- [Istio Access Logging](https://istio.io/latest/docs/tasks/observability/logs/access-log/)
- [Envoy Access Log Format](https://www.envoyproxy.io/docs/envoy/latest/configuration/observability/access_log/usage)
- [Response Flags](https://www.envoyproxy.io/docs/envoy/latest/configuration/observability/access_log/usage#config-access-log-format-response-flags)
