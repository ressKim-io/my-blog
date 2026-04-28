---
title: "Developer 대시보드 실무 고도화 — 어디 API에서 에러가 났는지 찾을 수 있게"
excerpt: "Trace ID 중심 탐색에서 API 엔드포인트 중심 탐색으로. 4개 40패널 대시보드를 6개 90패널로 재설계한 기록입니다."
category: monitoring
tags:
  - go-ti
  - Observability
  - Grafana
  - Dashboard
  - Tempo
  - Loki
  - Prometheus
  - troubleshooting
series:
  name: "goti-observability-ops"
  order: 7
date: "2026-03-15"
---

## 한 줄 요약

> Developer 대시보드 4개가 "어디 API에서 에러가 났는지" 찾기 힘들어 실무 디버깅에 부적합했습니다. API 엔드포인트 중심으로 재설계하고 DB Dependencies, Continuous Profiling 2개를 신설해 6개 90패널 구성으로 고도화했습니다.

---

## 🔥 문제: Trace ID 중심 탐색의 한계

### 기존 대시보드 구성

기존에는 Developer 관점의 대시보드 4개가 운영되고 있었습니다.

- **API RED**: Rate/Error/Duration 기본 메트릭
- **Distributed Tracing**: Tempo 기반 트레이스 탐색
- **Error Analysis**: 에러 로그 분석
- **JVM Deep Dive**: GC, Heap, Thread 등 JVM 내부 상태

총 약 40개 패널로 구성돼 있었고, 기본적인 메트릭은 전부 보였습니다.

### 발견한 문제

알림을 받은 뒤 "어디 API에서 문제인지" 찾는 흐름이 매끄럽지 않았습니다.

Distributed Tracing 대시보드는 Trace ID를 알아야 의미 있는 탐색이 가능했습니다.
하지만 알림 단계에서는 Trace ID가 아니라 "결제 API 에러율이 튀었다" 정도의 정보만 있습니다.
API 엔드포인트(`POST /v1/payments` 같은)에서 출발해 트레이스로 내려가는 경로가 없었습니다.

Error Analysis도 마찬가지였습니다.
전체 에러 건수와 시계열은 보이지만, "어느 엔드포인트에서 얼마나" 에러가 나는지 한눈에 들어오지 않았습니다.
엔드포인트별 에러율을 비교하려면 PromQL을 직접 치거나, 여러 패널을 번갈아 봐야 했습니다.

결국 실무 디버깅 흐름이 대시보드 바깥으로 새는 일이 잦았습니다.

---

## 🤔 원인: 엔드포인트 중심 네비게이션 부재

대시보드가 Trace 중심으로 설계돼 있었습니다.
Tempo의 관점에서 출발하다 보니 "Trace ID가 주어지면 잘 보이는" 구조가 됐습니다.

실무자는 반대 방향으로 움직입니다.

1. 알림이 울립니다. 메시지에는 API 이름만 들어 있습니다.
2. "이 API가 지금 얼마나 아픈지"를 확인합니다.
3. 에러 원인을 좁힙니다(5xx인지 4xx인지, 어떤 클래스에서 나왔는지).
4. 해당 요청의 로그와 트레이스를 연결해 봅니다.
5. 리소스 상태(JVM, DB 커넥션 풀)를 확인합니다.

즉, **API 엔드포인트가 시작점**이어야 하는데 기존 구성은 Trace ID가 시작점이었습니다.

또한 DB/Redis/외부 의존성의 지연과 JVM 프로파일링 정보가 흩어져 있어, "어디가 느린지" 구조적으로 분해하기도 어려웠습니다.

---

## ✅ 해결: 6개 대시보드로 재설계 + 엔드포인트 중심 탐색

### 목표 디버깅 워크플로우

재설계의 기준이 된 흐름은 다음 6단계입니다.

1. **Alert** 수신 후 **API Health Matrix**에서 문제 API를 찾습니다
2. **Error Analysis**에서 원인 후보를 좁힙니다
3. **Logs**에서 실제 예외 메시지를 확인합니다
4. **Trace**에서 해당 요청의 호출 체인을 추적합니다
5. **JVM** 대시보드에서 리소스 상태(GC/메모리)를 확인합니다
6. **Profiling**으로 코드 레벨 병목을 짚어냅니다

1단계부터 Trace ID가 아니라 **API 엔드포인트**가 진입점이 되도록 구조를 바꿨습니다.
각 단계는 이전 단계의 변수를 이어받아 다음 대시보드로 넘어갑니다.

### 1. Error Analysis (가장 큰 개선)

엔드포인트 중심 디버깅의 핵심 허브로 재설계했습니다.

추가한 기능은 다음과 같습니다.

- **API Error Heatmap**: 모든 엔드포인트별 RPS, 5xx, 4xx, 에러율(%), p99를 하나의 테이블에 모았습니다. 에러율에 컬러 매핑을 적용하고, 행을 클릭하면 Tracing/Logs 대시보드로 이동합니다.
- **Error Spike Detection**: 현재 에러율과 1시간 전 에러율을 비교합니다. 2배 이상이면 빨간색으로 강조합니다.
- **에러 핑거프린팅**: Loki에서 `sum by (logger)`로 집계해 어떤 Java 클래스에서 에러가 많이 발생하는지 바로 보이게 했습니다.
- **에러율 추이**: 엔드포인트별 에러율 시계열을 그려 "언제부터 이 API가 실패했는지" 확인하도록 했습니다.

이 대시보드만으로 "어디 API, 어느 클래스, 언제부터"가 한 번에 보입니다.

### 2. API RED Metrics

"지금 어디가 문제인가"를 한눈에 파악하는 진입 화면으로 바꿨습니다.

- **API Health Matrix**: 엔드포인트별 RPS, Error%, p99, p50을 테이블로 정렬합니다. 셀에 컬러 매핑을 걸고, 클릭 시 Error Analysis/Tracing으로 이동합니다.
- **SLO 임계선**: p50/p95/p99 차트에 `vector(0.5)`로 500ms 목표선을 그려, 임계를 넘는지 즉시 보이게 했습니다.
- **Recent Error Logs**: 대시보드를 전환하지 않아도 최근 에러 10줄을 바로 확인할 수 있도록 패널을 붙였습니다.

알림 직후 열어보는 "첫 화면"이 API RED Metrics입니다.

### 3. Distributed Tracing

Trace ID가 아니라 **http_route 필터**로 시작하도록 바꿨습니다.

- **http_route 필터**: API 엔드포인트를 선택하면 해당 엔드포인트의 트레이스가 나옵니다.
- **인라인 트레이스 워터폴**: 화면을 이동하지 않고 대시보드 안에서 span 타임라인을 직접 확인합니다.
- **Service Dependency Graph**: Tempo의 serviceMap 데이터를 기반으로 서비스 간 관계를 시각화합니다. MSA 전환을 대비한 선제적 구성입니다.
- **Correlated Logs**: ERROR/WARN 로그의 traceId를 클릭해 즉시 트레이스로 연결합니다.

Trace ID를 외부에서 복사해 와야 했던 기존 흐름과 반대로, 대시보드 안에서 엔드포인트로 내려가며 Trace ID를 찾아냅니다.

### 4. DB & Dependencies (신규)

API 응답 시간 중 어느 계층이 느린지 구조적으로 분해하기 위해 신설했습니다.

- **Latency Breakdown**: API 응답 시간 중 Server/DB/Redis/External이 각각 차지하는 비율을 그립니다.
- **Slow DB Query 목록**: TraceQL로 느린 쿼리를 즉시 확인합니다.
- **Redis vs DB Latency 비교**: 둘 다 상승하면 전체 인프라 문제, 하나만 상승하면 해당 dependency 문제로 분류합니다.
- **HikariCP Connection Pool**: JVM 대시보드에서 이곳으로 옮겼습니다. 풀 고갈 위험을 게이지로 표시합니다.

"느리다"는 증상을 받았을 때 가장 먼저 여는 대시보드 역할을 합니다.

### 5. Continuous Profiling (신규)

코드 레벨 병목을 확인하기 위해 Pyroscope 기반으로 신설했습니다.

- CPU / Memory / Lock / Wall Clock / Exceptions 5종 Flame Graph를 배치했습니다.
- 각 항목마다 메트릭 추이(timeseries)와 Flame Graph를 쌍으로 묶었습니다.
- Pyroscope datasource를 Grafana에 연동해 데이터를 가져옵니다.

리소스나 외부 의존성이 정상인데도 느릴 때, 마지막 단계로 확인하는 대시보드입니다.

### 6. JVM Deep Dive (최소 변경)

이미 잘 동작하는 대시보드라 큰 개편 없이 두 가지만 추가했습니다.

- **instance 변수**: MSA 전환을 대비해 Pod별 필터링을 가능하게 했습니다.
- **Uptime stat**: 최근 재시작 여부를 빠르게 확인할 수 있도록 stat 패널을 추가했습니다.

### Cross-Dashboard 연결

모든 대시보드 사이를 Grafana data link로 연결했습니다.

테이블 셀이나 시계열의 포인트를 클릭하면, 관련 대시보드로 변수(`http_route`, `http_request_method`, `instance` 등)가 전달되며 이동합니다.
사용자는 변수를 수동으로 다시 입력할 필요가 없습니다.

재현 확인은 실제로 에러를 주입해 알림 → API RED → Error Analysis → Tracing 흐름을 한 사이클 돌려보는 방식으로 검증했습니다.

---

## 수치 비교

| 항목 | 변경 전 | 변경 후 |
|-----|--------|--------|
| 대시보드 수 | 4개 | 6개 (DB Dependencies, Continuous Profiling 신규) |
| 패널 수 | 약 40개 | 약 90개 |
| 변수 수 | 4종 | 10종 (http_route, http_request_method, log_level, span_name 등) |

패널 수가 2배 이상 늘었지만, 각 대시보드가 맡는 역할이 명확해져 "어느 대시보드를 열어야 하는지"는 오히려 단순해졌습니다.
변수가 10종으로 늘어난 덕분에 Cross-Dashboard 이동 시 컨텍스트 전달도 매끄럽습니다.

---

## 📚 배운 점

- **대시보드 설계의 시작점은 실무 디버깅 흐름**입니다. Trace ID가 주어진 상황이 아니라, 알림을 받은 직후 상황을 가정해야 합니다.
- **엔드포인트 중심 테이블**(API Health Matrix, API Error Heatmap)이 디버깅 진입점을 바꿉니다. "PromQL을 치지 않아도 문제 API가 보이는지"를 기준으로 검증합니다.
- **Cross-Dashboard data link**는 선택이 아닌 필수입니다. 변수를 수동으로 재입력하게 두면 실무자는 결국 대시보드를 벗어납니다.
- **Latency Breakdown**(Server/DB/Redis/External)은 "어디가 느린지" 구조적 분해를 가능하게 합니다. 단일 p99 차트로는 답하기 어려운 질문입니다.
- **패널 수보다 역할 분리**가 중요합니다. 90패널이어도 대시보드별 책임이 명확하면 네비게이션은 단순해집니다.
