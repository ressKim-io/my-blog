---
title: "Istio Observability Part 2: 분산 트레이싱으로 요청 흐름 추적하기"
excerpt: "Jaeger를 활용한 분산 트레이싱과 헤더 전파의 중요성"
category: istio
tags: ["istio", "observability", "tracing", "jaeger", "distributed-tracing", "kubernetes", concept]
series:
  name: "istio-observability"
  order: 2
date: "2025-12-19"
---

## 🎯 시작하며

Part 1에서 메트릭으로 "무엇이 일어나는가"를 봤습니다. 하지만 마이크로서비스에서는 **"요청이 어디를 거쳐갔는가"**를 아는 것이 더 중요할 때가 있습니다.

![Why Distributed Tracing](/images/istio-observability/tracing-need.svg)

| 상황 | 설명 |
|------|------|
| 문제 | "결제가 느려요!" - 메트릭만으로는 어디가 느린지 모름 |
| 해결 | 분산 트레이싱으로 각 서비스별 소요 시간 확인 |
| 결과 | Bank API가 2.3초 → 범인 발견! |

학습하면서 궁금했던 것들입니다:
- Trace와 Span은 무엇일까?
- Istio가 자동으로 해주는 것과 내가 해야 하는 것은?
- 헤더 전파는 왜 중요할까?

---

## 💡 분산 트레이싱 개념

### Trace와 Span

![Trace and Span Structure](/images/istio-observability/trace-span-structure.svg)

| 개념 | 설명 |
|------|------|
| Trace | 하나의 요청이 시스템을 통과하는 전체 여정 (고유 Trace ID) |
| Span | 하나의 작업 단위 (Span ID, Parent Span ID, 시작/종료 시간, 태그) |

### 타임라인 뷰

각 Span은 부모 Span 안쪽에 nested로 자리잡습니다. 0~350ms 구간에 4단계 호출이 차례로 시작되는 구조입니다.

| Span | 서비스 | 시작 | 종료 | 비고 |
|---|---|---|---|---|
| A | Frontend | 0ms | 350ms | 루트 |
| B | API Gateway | 50ms | 350ms | A의 자식 |
| C | Payment | 100ms | 350ms | B의 자식 |
| D | Bank API | 150ms | 350ms | C의 자식 (가장 깊은 호출) |

D가 시작될 때 이미 150ms가 지났고, A는 D가 끝날 때까지 기다립니다. 외부 호출인 D 구간이 길어지면 모든 부모 Span의 latency가 함께 늘어나는 구조입니다.

---

## 🔧 Istio 트레이싱 설정

### Jaeger 설치

```bash
# Istio 애드온으로 설치
$ kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.20/samples/addons/jaeger.yaml

# 확인
$ kubectl get pods -n istio-system -l app=jaeger

# 접속
$ kubectl port-forward -n istio-system svc/tracing 16686:80

# 브라우저에서 http://localhost:16686 접속
```

### 샘플링 설정

```yaml
apiVersion: install.istio.io/v1alpha1
kind: IstioOperator
spec:
  meshConfig:
    defaultConfig:
      tracing:
        sampling: 100.0    # 100% 샘플링 (개발환경)
        # sampling: 1.0    # 1% 샘플링 (프로덕션)
```

프로덕션에서 100%는 오버헤드가 크므로 1~10% 정도로 설정합니다.

### Telemetry API로 설정

```yaml
apiVersion: telemetry.istio.io/v1alpha1
kind: Telemetry
metadata:
  name: tracing-config
  namespace: istio-system
spec:
  tracing:
  - providers:
    - name: jaeger
    randomSamplingPercentage: 10.0   # 10% 샘플링
```

---

## ⚠️ 핵심: 헤더 전파 (Header Propagation)

**Istio가 자동으로 하는 것**:
- Span 생성
- Trace ID 생성 (없으면)
- 메트릭/로그 수집

**애플리케이션이 해야 하는 것**:
- 들어온 트레이싱 헤더를 나가는 요청에 전파!

![Header Propagation](/images/istio-observability/header-propagation.svg)

| 상황 | 결과 |
|------|------|
| 헤더 전파 안 함 | Trace가 끊김 → 각 서비스가 별도 Trace로 분리 |
| 헤더 전파함 | Trace가 연결됨 → 하나의 Trace로 전체 흐름 추적 가능 |

### 전파해야 할 헤더 목록

```
# B3 형식 (Zipkin)
x-b3-traceid
x-b3-spanid
x-b3-parentspanid
x-b3-sampled
x-b3-flags

# W3C Trace Context
traceparent
tracestate

# Istio/Envoy 추가 헤더
x-request-id
x-ot-span-context

# 권장: 모두 전파
```

### 언어별 헤더 전파 구현

#### Go

```go
func handler(w http.ResponseWriter, r *http.Request) {
    // 전파할 헤더들
    headers := []string{
        "x-request-id",
        "x-b3-traceid",
        "x-b3-spanid",
        "x-b3-parentspanid",
        "x-b3-sampled",
        "x-b3-flags",
        "traceparent",
        "tracestate",
    }

    // 외부 서비스 호출 시 헤더 전파
    client := &http.Client{}
    req, _ := http.NewRequest("GET", "http://backend/api", nil)

    for _, h := range headers {
        if value := r.Header.Get(h); value != "" {
            req.Header.Set(h, value)
        }
    }

    resp, err := client.Do(req)
    // ...
}
```

#### Python (Flask)

```python
from flask import Flask, request
import requests

app = Flask(__name__)

TRACE_HEADERS = [
    'x-request-id',
    'x-b3-traceid',
    'x-b3-spanid',
    'x-b3-parentspanid',
    'x-b3-sampled',
    'x-b3-flags',
    'traceparent',
    'tracestate',
]

@app.route('/api/process')
def process():
    # 헤더 전파
    headers = {h: request.headers.get(h)
               for h in TRACE_HEADERS
               if request.headers.get(h)}

    # 외부 서비스 호출
    response = requests.get('http://backend/api', headers=headers)
    return response.json()
```

#### Java (Spring)

```java
@RestController
public class ApiController {

    private static final List<String> TRACE_HEADERS = Arrays.asList(
        "x-request-id",
        "x-b3-traceid",
        "x-b3-spanid",
        "x-b3-parentspanid",
        "x-b3-sampled",
        "x-b3-flags",
        "traceparent",
        "tracestate"
    );

    @Autowired
    private RestTemplate restTemplate;

    @GetMapping("/api/process")
    public ResponseEntity<String> process(HttpServletRequest request) {
        HttpHeaders headers = new HttpHeaders();

        // 헤더 전파
        TRACE_HEADERS.forEach(h -> {
            String value = request.getHeader(h);
            if (value != null) {
                headers.add(h, value);
            }
        });

        HttpEntity<String> entity = new HttpEntity<>(headers);
        return restTemplate.exchange(
            "http://backend/api",
            HttpMethod.GET,
            entity,
            String.class
        );
    }
}
```

#### Node.js (Express)

```javascript
const express = require('express');
const axios = require('axios');

const app = express();

const TRACE_HEADERS = [
    'x-request-id',
    'x-b3-traceid',
    'x-b3-spanid',
    'x-b3-parentspanid',
    'x-b3-sampled',
    'x-b3-flags',
    'traceparent',
    'tracestate',
];

app.get('/api/process', async (req, res) => {
    // 헤더 전파
    const headers = {};
    TRACE_HEADERS.forEach(h => {
        if (req.headers[h.toLowerCase()]) {
            headers[h] = req.headers[h.toLowerCase()];
        }
    });

    // 외부 서비스 호출
    const response = await axios.get('http://backend/api', { headers });
    res.json(response.data);
});
```

---

## 📊 Jaeger UI 활용

### 기본 화면

![Jaeger UI 검색 화면과 Trace 결과 목록](/diagrams/istio-observability-part2-tracing-1.svg)

**검색 패널 이해하기**

**Service 드롭다운**에서 분석하고 싶은 서비스를 선택합니다. Istio 환경에서는 모든 sidecar가 있는 서비스가 나타납니다. "istio-ingressgateway"를 선택하면 외부에서 들어온 모든 요청을 볼 수 있고, 특정 서비스를 선택하면 그 서비스가 참여한 Trace만 필터링됩니다.

**Operation**은 해당 서비스의 엔드포인트를 의미합니다. "GET /api/users"처럼 HTTP method + path 형태로 표시됩니다. "all"을 선택하면 모든 엔드포인트를 봅니다.

**Lookback**은 검색 시간 범위입니다. 장애가 "30분 전에 발생했다"고 보고받았다면, "Last Hour"로 설정하고 검색합니다. 너무 넓은 범위는 결과가 많아져 분석이 어렵습니다.

**결과 목록**에서 각 줄은 하나의 Trace입니다. "frontend → api → payment"는 요청이 거쳐간 서비스 체인을 보여줍니다. **시간(350ms)**과 **Span 수(3 spans)**는 중요한 지표입니다. 같은 경로인데 시간 차이가 크다면, 느린 Trace를 클릭해서 원인을 파악합니다.

### Trace 상세 화면

![Trace abc123 워터폴 다이어그램](/diagrams/istio-observability-part2-tracing-2.svg)

선택한 Trace의 주요 Tags는 다음과 같습니다.

| Tag | 값 |
|---|---|
| `http.method` | POST |
| `http.url` | /api/order |
| `http.status_code` | 200 |
| `node_id` | sidecar~10.1.2.3~api-gateway-xxx |
| `upstream_cluster` | outbound\|80\|\|payment.default... |

**워터폴 다이어그램 읽기**

Trace 상세 화면의 핵심은 **워터폴 다이어그램**입니다. 가로 막대의 길이가 해당 Span의 소요 시간입니다. 위 예시에서 가장 긴 막대는 bank-api(200ms)입니다. 전체 350ms 중 57%가 여기서 소비된 것입니다.

**들여쓰기**는 호출 관계를 나타냅니다. frontend가 api-gateway를 호출하고, api-gateway가 payment와 inventory를 호출하는 구조가 한눈에 보입니다. 같은 레벨의 들여쓰기(payment와 inventory)는 병렬 호출을 의미합니다.

**시간 분석**: 전체 350ms 중 api-gateway가 300ms를 차지하지만, 그 안에서 payment(250ms)를 호출합니다. "자체 처리 시간"은 300 - 250 = 50ms입니다. 만약 자체 처리 시간이 비정상적으로 길다면, 해당 서비스의 로직이나 DB 쿼리를 점검해야 합니다.

**Tags 섹션**은 각 Span의 메타데이터입니다. http.status_code=200이면 성공, 500이면 에러입니다. upstream_cluster는 Envoy가 요청을 보낸 목적지를 나타냅니다. node_id는 어떤 Pod의 sidecar에서 생성된 Span인지 알려줍니다.

---

## 🛠️ 실전 디버깅

### 느린 요청 찾기

```
1. Jaeger에서 Service 선택
2. Lookback: Last Hour
3. Min Duration: 1s (느린 요청만)
4. Find Traces

결과에서 병목 지점 확인:
- 어떤 Span이 가장 오래 걸리는가?
- 특정 서비스에서 일관되게 느린가?
```

**실제 분석 예시**: "결제가 느려요!"라는 보고를 받았다고 가정합니다.

1. Service: "payment-service" 선택, Min Duration: 2s로 설정
2. 느린 Trace 3-4개를 클릭해서 패턴을 찾습니다
3. 공통점 발견: bank-api Span이 항상 2초 이상
4. Tags 확인: upstream_cluster가 "outbound|443||bank.external.com"
5. 결론: 외부 은행 API 응답이 느림 → 타임아웃 설정이나 캐싱 검토

만약 느린 Trace마다 병목 위치가 다르다면, 특정 Pod의 문제(CPU throttling, GC)이거나 네트워크 이슈일 수 있습니다. node_id 태그로 어떤 Pod인지 확인하세요.

### 에러 추적

```
1. Tags 검색: error=true
2. 또는 Tags: http.status_code=500

에러 Span에서 확인:
- 어디서 에러가 시작됐는가?
- 에러 메시지는?
- 에러 발생 직전 상황은?
```

**에러 Trace 분석 팁**: 에러가 발생한 Span을 찾으면 그 **직전 Span**을 주목하세요. 예를 들어, payment에서 503 에러가 발생했다면, 그 직전의 api-gateway Span에서 재시도 횟수나 타임아웃 설정을 확인합니다. Logs 탭이 있다면 에러 스택트레이스도 볼 수 있습니다.

### 비교 분석

```
1. 느린 Trace와 빠른 Trace 비교
2. 차이점:
   - 추가 호출이 있는가?
   - 특정 서비스가 더 느린가?
   - 재시도가 발생했는가?
```

Jaeger UI에서 두 Trace를 비교하려면, 각각을 새 탭에서 열고 나란히 봅니다. Span 수가 다르다면 재시도나 추가 호출이 있었다는 뜻입니다. 같은 Span인데 시간이 10배 차이 나면, 해당 서비스의 상태를 점검하세요.

### 헤더 전파 실패 디버깅

Trace가 끊어져 보인다면 헤더 전파 문제입니다. 확인 방법:

**증상**: frontend에서 시작한 요청이 api-gateway까지만 보이고, payment Span이 별도 Trace로 분리되어 있습니다. 이러면 전체 흐름 분석이 불가능합니다.

**진단 1: Jaeger에서 확인**

1. 두 Trace의 시간대가 거의 같은지 확인합니다
2. 첫 번째 Trace의 마지막 Span 시간과 두 번째 Trace의 시작 시간이 일치하면 헤더 전파 실패가 확정됩니다

**진단 2: 헤더 확인**
```bash
# 해당 서비스의 로그에서 들어오는 헤더 출력
$ kubectl logs deploy/api-gateway -c istio-proxy | grep x-b3-traceid

# 나가는 요청에 헤더가 있는지 확인
$ kubectl logs deploy/api-gateway -c api-gateway | grep -i "x-b3\|traceparent"
```

**해결 방법**:
1. 해당 서비스 코드에서 헤더 전파 로직이 있는지 확인
2. 특히 비동기 호출, 스레드 풀, 메시지 큐 처리 부분 점검
3. 라이브러리(OpenTelemetry, Jaeger Client) 사용 시 설정 확인

**흔한 실수**:
- HTTP 클라이언트를 새로 생성하면서 헤더 복사를 누락
- async/await 함수에서 컨텍스트를 전달하지 않음
- 메시지 큐(Kafka, RabbitMQ)로 보낼 때 헤더를 메시지 헤더로 변환하지 않음

---

## ⚙️ 고급 설정

### 커스텀 태그 추가

```yaml
apiVersion: telemetry.istio.io/v1alpha1
kind: Telemetry
metadata:
  name: custom-tags
  namespace: default
spec:
  tracing:
  - customTags:
      my_custom_tag:
        header:
          name: x-custom-header
          defaultValue: "unknown"
      user_id:
        header:
          name: x-user-id
```

### 특정 경로 샘플링 조절

```yaml
apiVersion: telemetry.istio.io/v1alpha1
kind: Telemetry
metadata:
  name: selective-tracing
  namespace: default
spec:
  selector:
    matchLabels:
      app: payment-service
  tracing:
  - randomSamplingPercentage: 100.0   # 결제는 100%
---
apiVersion: telemetry.istio.io/v1alpha1
kind: Telemetry
metadata:
  name: health-no-trace
  namespace: default
spec:
  tracing:
  - disableSpanReporting: true
    match:
      mode: SERVER
  # /health, /metrics는 트레이싱 제외
```

---

## 📈 트레이싱 메트릭

Jaeger 자체도 메트릭을 제공합니다:

```promql
# Span 처리량
sum(rate(jaeger_spans_received_total[5m])) by (svc)

# 샘플링된 Span 수
sum(rate(jaeger_spans_sampled_total[5m]))

# 트레이스 저장 지연
histogram_quantile(0.99,
  sum(rate(jaeger_span_storage_latency_bucket[5m])) by (le)
)
```

---

## ⚠️ 주의사항

### 1. 샘플링 비율

```yaml
# 개발환경: 100% OK
sampling: 100.0

# 프로덕션: 1-10% 권장
sampling: 1.0    # 1%
# 또는
sampling: 10.0   # 10%

# 이유:
# - 네트워크 오버헤드
# - 저장 공간
# - 처리 비용
```

### 2. 헤더 전파 누락

가장 흔한 실수입니다. Trace가 끊기면:
1. 들어오는 요청의 헤더 확인
2. 나가는 요청에 헤더 복사 확인
3. 모든 외부 호출에 적용됐는지 확인

### 3. 비동기 처리

```go
// ❌ 비동기에서 헤더 전파 누락
go func() {
    // 컨텍스트/헤더 없이 호출
    client.Call("http://service/api")
}()

// ✅ 컨텍스트 전달
go func(headers map[string]string) {
    req, _ := http.NewRequest("GET", "http://service/api", nil)
    for k, v := range headers {
        req.Header.Set(k, v)
    }
    client.Do(req)
}(extractHeaders(originalRequest))
```

---

## 📚 정리

### 분산 트레이싱 체크리스트

**인프라 설정**
- [ ] Jaeger 설치
- [ ] 샘플링 비율 설정 (프로덕션 1-10%)
- [ ] 저장 기간 설정

**애플리케이션 (필수)**
- [ ] 트레이싱 헤더 전파 구현
- [ ] 모든 외부 호출에 적용
- [ ] 비동기 호출도 확인

**운영**
- [ ] 느린 요청 모니터링
- [ ] 에러 트레이스 분석
- [ ] 서비스 의존성 파악

---

## 🎯 핵심 정리

| 개념 | 설명 |
|------|------|
| **Trace** | 하나의 요청이 시스템을 통과하는 전체 여정 |
| **Span** | 하나의 작업 단위 (서비스 호출, DB 쿼리 등) |
| **헤더 전파** | 들어온 트레이싱 헤더를 나가는 요청에 복사 (필수!) |
| **샘플링** | 프로덕션에서는 1-10% 권장 |

### Istio가 하는 것 vs 내가 해야 하는 것

| Istio 자동 | 개발자 필수 |
|------------|-------------|
| Span 생성 | 헤더 전파 구현 |
| Trace ID 생성 | 모든 외부 호출에 적용 |
| Jaeger로 전송 | 비동기 호출 처리 |

---

## 🔗 다음 편 예고

Part 3에서는 **Envoy Access Log**를 다룹니다:
- Access Log 포맷
- Response Flags 분석
- 문제 진단 가이드

---

## 🔗 참고 자료

- [Istio Distributed Tracing](https://istio.io/latest/docs/tasks/observability/distributed-tracing/)
- [Jaeger Documentation](https://www.jaegertracing.io/docs/)
- [OpenTelemetry Tracing](https://opentelemetry.io/docs/concepts/signals/traces/)
- [B3 Propagation](https://github.com/openzipkin/b3-propagation)
