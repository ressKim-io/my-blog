---
title: "k6 — VU 모델과 thresholds로 부하를 만들고 합격을 판정하는 원리"
excerpt: "k6가 JS 시나리오를 goja 엔진으로 실행해 VU 풀을 구동하고, Trend/Rate/Counter 메트릭을 집계한 뒤 thresholds로 자동 합격 판정하는 내부 구조를 설명합니다"
category: monitoring
tags:
  - go-ti
  - k6
  - virtual-user
  - thresholds
  - load-testing
  - concept
series:
  name: "goti-deepdive-runtime"
  order: 1
date: "2026-04-03"
---

## 한 줄 요약

> k6는 JS 시나리오를 Go 내장 goja 엔진으로 실행해 VU 풀을 구동하고, 수집한 메트릭을 thresholds로 자동 판정하는 단일 바이너리 부하 테스트 도구입니다

---

## 🤔 무엇을 푸는 기술인가

부하 테스트 도구가 해결해야 하는 핵심 문제는 두 가지입니다

첫째, **현실에 가까운 사용자 행동을 코드로 표현**하는 것입니다 로그인 → 좌석 조회 → 주문 → 결제처럼 여러 HTTP 요청이 이어지는 E2E 흐름을, 수백~수천 명이 동시에 실행하는 상황을 만들어야 합니다

둘째, **"합격이냐 불합격이냐"를 자동으로 판정**하는 것입니다 p95가 2초 이하인지, 성공률이 95% 이상인지를 사람이 숫자를 보며 판단하면 기준이 흔들립니다 조건을 코드에 선언하고 도구가 exit code로 결과를 돌려줘야 CI 파이프라인에 통합할 수 있습니다

k6는 이 두 문제를 **JavaScript 시나리오 + 선언적 thresholds** 조합으로 해결합니다 시나리오는 개발자가 이미 익숙한 JS로 작성하고, 테스트 판정 기준은 `options.thresholds`에 선언합니다 실행 엔진은 Go로 구현되어 있어 단일 바이너리로 수천 VU를 경량으로 구동합니다

---

## 🔧 동작 원리

### JS 시나리오와 goja 엔진

k6 시나리오는 표준 JavaScript 파일입니다 `export default function` 이 VU마다 반복 실행될 함수이고, `export const options`에 VU 수·duration·thresholds 등을 선언합니다

```javascript
import http from "k6/http";
import { Trend, Rate } from "k6/metrics";

const seatSelectDuration = new Trend("goti_seat_select_ms");
const ticketSuccessRate  = new Rate("goti_ticket_success_rate");

export const options = {
  scenarios: {
    oneshot: {
      executor: "per-vu-iterations",
      vus: 3000,
      iterations: 1,
    },
  },
  thresholds: {
    "goti_seat_select_ms":      ["p(95)<2000"],
    "goti_ticket_success_rate": ["rate>0.95"],
    http_req_failed:            ["rate<0.01"],
  },
};

export default function (data) {
  const res = http.get(`${__ENV.BASE_URL}/seats`);
  seatSelectDuration.add(res.timings.duration);
  ticketSuccessRate.add(res.status === 200);
}
```

k6는 이 파일을 **goja** 엔진으로 해석합니다 goja는 Go로 구현된 ECMAScript 5.1+ 런타임입니다 Node.js가 아니므로 `fs`, `net` 같은 Node.js 내장 모듈은 없지만, k6가 `k6/http`, `k6/metrics`, `k6/sleep` 같은 전용 모듈을 Go 레벨에서 바인딩해 제공합니다

VU 하나당 goja 인스턴스 하나가 생성됩니다 각 VU의 JS 실행 컨텍스트는 서로 완전히 격리되어 있습니다 전역 변수가 VU 간에 공유되지 않으므로, `const seatSelectDuration = new Trend(...)` 같은 커스텀 메트릭 선언은 VU마다 독립적으로 초기화됩니다 다만 메트릭 *수집*은 중앙 집계기로 통합됩니다

### VU 풀과 goroutine 모델

k6가 경량인 이유는 VU를 **goroutine** 기반으로 구현하기 때문입니다 OS 스레드가 아닌 Go 런타임의 경량 스레드인 goroutine을 사용해 VU당 메모리가 약 5 MB 수준입니다 이에 비해 JVM 기반 도구(JMeter, Gatling)는 스레드 또는 액터 모델로 VU당 메모리 오버헤드가 더 큽니다

VU 풀의 크기와 iteration 배분 방식은 **executor**가 결정합니다 executor 종류·VU 라이프사이클에 대한 상세 내용은 [별도 글](/essays/goti-deepdive-k6-executor)에서 다루며, 이 글은 도구 전반 구조에 집중합니다

### 메트릭 타입 — Trend · Rate · Counter · Gauge

k6는 4종의 메트릭 타입을 제공합니다 내장 메트릭(예: `http_req_duration`)도 이 타입 중 하나로 구현되어 있으며, 커스텀 메트릭도 동일한 API로 정의합니다

**Trend**는 숫자 샘플의 분포를 추적합니다 응답 시간처럼 "p50, p95, p99가 얼마인가"를 보고 싶을 때 씁니다 집계 구간마다 백분위수를 계산합니다

```javascript
import { Trend } from "k6/metrics";
const queueStatusMs = new Trend("queue_status_ms");

// VU 함수 안에서
queueStatusMs.add(res.timings.duration);
```

**Rate**는 Boolean 샘플에서 참(1)의 비율을 추적합니다 성공률처럼 "몇 퍼센트가 통과했는가"를 보고 싶을 때 씁니다

```javascript
import { Rate } from "k6/metrics";
const queuePassRate = new Rate("queue_pass_rate");

// admitted 상태를 수신했으면 true
queuePassRate.add(status === "admitted");
```

**Counter**는 누적 합산값을 추적합니다 총 요청 수, 에러 총 건수처럼 "얼마나 많이 발생했는가"를 보고 싶을 때 씁니다

**Gauge**는 현재 값(최신값)을 추적합니다 활성 VU 수처럼 단일 스냅샷이 의미 있을 때 씁니다

| 타입 | 기본 집계 | 대표 사용처 |
|---|---|---|
| Trend | p50 / p95 / p99 / avg / min / max | 응답 시간, 대기 시간 |
| Rate | 비율(0~1) | 성공률, 에러율 |
| Counter | 누적 합계 | 총 요청 수, 총 바이트 |
| Gauge | 최신값 | 현재 활성 VU 수 |

이 4종 외에 k6 내장 메트릭인 `http_req_duration`, `http_req_failed`, `http_reqs` 등도 동일한 타입 시스템 위에 구현되어 있습니다 `http_req_duration`은 Trend, `http_req_failed`는 Rate, `http_reqs`는 Counter입니다

### thresholds — 선언적 합격 판정

thresholds는 k6의 가장 중요한 기능 중 하나입니다 `options.thresholds`에 조건을 선언하면 k6가 테스트 종료 시 자동으로 합격/불합격을 판정합니다

```javascript
export const options = {
  thresholds: {
    // Trend 타입: p(95) 함수로 백분위수 조건
    "http_req_duration{endpoint:seat_select}": ["p(95)<2000"],

    // Rate 타입: rate 조건
    "goti_ticket_success_rate": ["rate>0.95"],

    // 내장 메트릭: 에러율 1% 미만
    http_req_failed: ["rate<0.01"],

    // 복수 조건: AND 관계
    "queue_status_ms": ["p(50)<500", "p(95)<1500"],
  },
};
```

`{endpoint:seat_select}` 같은 태그 필터를 쓰면 메트릭의 부분 집합에만 조건을 적용할 수 있습니다 같은 `http_req_duration` 메트릭이라도 엔드포인트별로 다른 기준을 적용하는 것이 가능합니다

조건이 하나라도 위반되면 k6는 **exit code 99**를 반환합니다 exit 0은 모든 threshold 통과, exit 99는 위반입니다 CI 파이프라인에서 exit code를 검사하면 부하 테스트 결과를 자동 게이팅할 수 있습니다

`abortOnFail: true` 옵션을 추가하면 threshold 위반이 발생하는 즉시 테스트를 중단합니다 긴 soak 테스트에서 초반에 이미 임계치가 넘어갔다면 나머지 시간을 낭비하지 않을 수 있습니다

```javascript
thresholds: {
  http_req_failed: [{ threshold: "rate<0.01", abortOnFail: true }],
},
```

### k6 전체 실행 흐름

아래 다이어그램은 JS 시나리오에서 thresholds 판정까지의 k6 내부 흐름을 보여줍니다

![k6 내부 구조 — VU 풀에서 thresholds 판정까지|tall](/diagrams/goti-deepdive-k6-load-testing-1.svg)

흐름은 다음 5계층으로 구성됩니다

**JS 시나리오 파일** (`queue-oneshot.js` 등)은 options, scenarios, thresholds, default 함수를 포함합니다 사용자가 작성하는 유일한 진입점입니다

**goja 엔진**은 JS 파일을 Go 런타임 안에서 해석합니다 VU마다 독립된 goja 인스턴스를 생성해 컨텍스트를 격리하고, k6 전용 모듈(`k6/http`, `k6/metrics`)을 바인딩합니다

**VU 풀**은 executor 스케줄러가 제어합니다 executor 설정에 따라 VU를 생성·배치·종료하며, 각 VU는 goroutine 하나에 대응합니다 VU당 메모리는 약 5 MB입니다

**메트릭 집계기**는 모든 VU에서 흘러오는 샘플을 Trend·Rate·Counter·Gauge 타입으로 실시간 집계합니다 1초 인터벌마다 p50/p95/p99 등 집계 결과를 thresholds 판정기와 output 플러그인 양쪽으로 전달합니다

**thresholds 판정기**는 집계 결과를 선언된 조건과 비교합니다 위반이 발생하면 exit code 99를 예약하고, `abortOnFail`이 활성화된 경우 VU 풀 종료를 트리거합니다 **output 플러그인**은 메트릭을 외부 시스템(Prometheus Remote Write, InfluxDB, CSV 등)으로 전송합니다

이 구조에서 중요한 점은 thresholds 판정이 메트릭 수집과 완전히 분리되어 있다는 것입니다 VU가 얼마나 빨리 실행되든, 어떤 executor를 쓰든, 판정 로직은 "집계된 숫자 ≤ 선언된 조건"만을 평가합니다 시나리오 코드와 합격 기준이 같은 파일에 있지만 실행 레이어는 독립됩니다

### 단일 바이너리 구조

k6의 설치는 단일 실행 파일 하나입니다 Go로 크로스 컴파일된 바이너리이므로 JVM, 런타임 설치, 별도 의존성이 필요 없습니다 `--out prometheus-remote-write` 같은 내장 출력 플러그인도 바이너리에 포함되어 있습니다

```bash
# 설치
brew install k6

# 실행 — 별도 서버 불필요
k6 run --out prometheus-remote-write=<mimir-url> scenario.js
```

이 구조 덕분에 EC2 인스턴스에 바이너리 하나만 복사하면 즉시 runner로 쓸 수 있습니다 JMeter처럼 JVM 설치나 설정이 필요 없습니다

---

## 📐 세부 동작과 옵션

### thresholds 표현식 문법

thresholds 값은 문자열 표현식입니다 메트릭 타입에 따라 사용 가능한 집계 함수가 다릅니다

| 타입 | 사용 가능 집계 | 예시 |
|---|---|---|
| Trend | `avg`, `min`, `max`, `med`, `p(N)` | `p(95)<2000`, `avg<500` |
| Rate | `rate` | `rate>0.95`, `rate<0.01` |
| Counter | `count`, `rate` | `count>0` |
| Gauge | `value` | `value<100` |

`p(N)`은 N번째 백분위수입니다 `p(95)<2000`은 "전체 샘플의 95번째 백분위수가 2000ms 미만"을 의미합니다

### 메트릭 태그와 필터링

k6의 모든 HTTP 요청 메트릭에는 기본 태그(`url`, `status`, `method`, `name`)가 붙습니다 커스텀 태그를 추가할 수도 있습니다

```javascript
http.get(url, { tags: { endpoint: "seat_select" } });
```

thresholds에서 `{태그:값}` 문법으로 태그 필터를 적용하면 엔드포인트별로 다른 기준을 설정할 수 있습니다

```javascript
thresholds: {
  "http_req_duration{endpoint:seat_select}":  ["p(95)<2000"],
  "http_req_duration{endpoint:queue_status}": ["p(95)<1500"],
},
```

### Prometheus Remote Write 출력

`--out prometheus-remote-write` 플래그를 쓰면 k6 메트릭이 실시간으로 Prometheus 호환 엔드포인트로 Push됩니다 Grafana Mimir처럼 Remote Write를 지원하는 시스템이라면 어디든 수신할 수 있습니다

```bash
k6 run \
  --out prometheus-remote-write=http://mimir:9009/api/v1/push \
  -e RUNNER_ID=0 \
  scenario.js
```

Push된 메트릭에는 기본 라벨 외에 `testid`, `runner` 같은 커스텀 라벨을 추가할 수 있습니다 여러 runner가 동시에 실행할 때 `runner=0`, `runner=1`로 분리해 집계하거나 합산할 수 있습니다

---

## 🧩 go-ti에서는

go-ti에서는 티켓팅 POC(대기열 구현체 A/B/C) 공정 비교에 k6를 표준 도구로 채택했습니다 같은 클러스터·같은 시점에서 동일한 조건으로 측정해야 "구현체 간 차이"를 주장할 수 있었기 때문입니다

thresholds는 `queue_pass_rate`, `goti_ticket_success_rate`, `http_req_duration` 등의 조건을 코드로 선언했습니다 threshold 위반 항목은 결과 문서 상단에 `✗` 항목으로 명시해 "숫자를 보며 괜찮다고 느끼는" 주관적 판정을 차단했습니다

메트릭은 Prometheus Remote Write로 Grafana Mimir에 Push해 시계열로 보존했습니다 2주 전 측정치와 최신 구현체를 같은 Grafana 대시보드에서 비교할 수 있었고, runner 4명이 동시에 실행해도 `runner` 라벨로 분리 집계가 가능했습니다

단일 바이너리 구조 덕분에 EC2 c7g.xlarge 인스턴스에 바이너리를 복사하는 것만으로 runner를 추가했습니다 1,500 VU가 안정적으로 동작했습니다 (ADR 0024에서 c7g.xlarge 8GB 기준 VU당 ~5 MB 계산으로 ~1,500 VU 한도 확인)

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [부하테스트 방법론 ADR — K6 원샷 모델 채택](/logs/goti-load-testing-methodology-adr)에 정리했습니다

---

## 📚 핵심 정리

- k6는 JS 시나리오를 Go 내장 goja 엔진으로 해석하고, VU를 goroutine 기반으로 구동해 VU당 ~5 MB의 경량 메모리를 유지합니다
- Trend(백분위수) · Rate(비율) · Counter(누적합) · Gauge(최신값) 4종 메트릭 타입으로 내장·커스텀 메트릭을 통일된 API로 정의합니다
- thresholds는 조건을 코드에 선언하고 exit code 0/99로 자동 합격 판정을 내립니다 — 사람이 숫자를 보며 판단하는 과정을 제거합니다
- `--out prometheus-remote-write`로 메트릭을 외부 시스템에 실시간 Push하면 여러 runner의 결과를 하나의 대시보드에서 라벨 기반으로 통합·비교할 수 있습니다
- executor·시나리오·thresholds가 모두 같은 JS 파일에 선언되어 버전 관리와 리뷰가 용이하고, 단일 바이너리로 별도 런타임 없이 배포됩니다
