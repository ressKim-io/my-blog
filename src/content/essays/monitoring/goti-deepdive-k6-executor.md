---
title: "k6 executor — VU 라이프사이클과 워크로드 모델의 동작 원리"
excerpt: "k6 executor가 VU를 어떻게 생성·종료하는지, 그리고 executor 종류별 부하 패턴이 실제로 어떻게 달라지는지 내부 동작 관점에서 설명합니다"
category: monitoring
tags:
  - go-ti
  - k6
  - executor
  - virtual-user
  - load-testing
  - concept
series:
  name: "goti-deepdive-runtime"
  order: 3
date: "2026-04-03"
---

## 한 줄 요약

> k6 executor는 VU의 생성·배치·종료 방식을 결정하는 워크로드 스케줄러입니다 — executor 선택이 "어떤 부하 모양을 만드느냐"를 결정하며, `per-vu-iterations: 1` 원샷 모델은 E2E 사용자 1명을 VU 1개에 정확히 대응시킵니다

---

## 🤔 무엇을 푸는 기술인가

부하테스트 도구가 해결해야 하는 핵심 질문은 두 가지입니다

첫째, **얼마나 많은 동시 사용자를 시뮬레이션할 것인가** — 고정 동시 접속자 수를 유지할 것인지, 램프 업/다운을 할 것인지, 또는 총 요청 횟수를 기준으로 할 것인지

둘째, **한 가상 사용자가 어떻게 반복하는가** — 무한 루프를 돌 것인지, 1회만 실행하고 끝낼 것인지

k6의 **executor**는 이 두 질문에 대한 답을 하나의 선언적 설정으로 정의합니다 `scenarios` 블록에서 executor 종류와 파라미터를 지정하면, k6는 그에 맞게 VU를 생성하고 iteration을 분배하며 테스트를 종료합니다

executor가 없으면 "1명의 사용자가 무한히 반복하는 루프"가 기본값이 됩니다 실제 서비스에서는 사용자가 특정 행동을 1~N회 하고 나가는 패턴이 대부분이므로, executor 선택이 측정의 의미를 결정합니다

---

## 🔧 동작 원리

### VU 라이프사이클

k6의 테스트 실행은 4단계로 나뉩니다

```text
init → setup → iteration(s) → teardown
```

**init 단계**는 각 VU마다 독립적으로 실행됩니다 `import`와 전역 변수 초기화, 파일 로딩 등이 여기서 일어납니다 중요한 점은 init 코드는 HTTP 요청을 보낼 수 없다는 것입니다 — 이 단계는 VU 수만큼 병렬로 실행되는 순수한 자바스크립트 초기화입니다

**setup 단계**는 테스트 전체에서 딱 한 번, 모든 VU 실행 전에 실행됩니다 인증 토큰 일괄 발급, 테스트 데이터 생성 등 공유 사전 작업이 여기 속합니다 `setup()` 함수의 반환값은 모든 VU의 `default` 함수에 `data` 인자로 전달됩니다

**iteration(s) 단계**는 `default` 함수가 실행되는 구간입니다 각 VU는 executor가 배정한 만큼의 iteration을 수행합니다 VU 하나는 이전 iteration이 완료되어야 다음 iteration을 시작합니다 — 병렬 처리가 아닌 직렬 순환입니다

**teardown 단계**는 마지막 VU 실행이 끝난 뒤 한 번 실행됩니다 임시 리소스 정리, 테스트 결과 후처리 등에 활용합니다

이 라이프사이클에서 executor가 제어하는 것은 "얼마나 많은 VU를 동시에 두고, 각 VU에 iteration을 얼마나 배정하는가"입니다

### executor 종류별 동작

k6는 6종의 내장 executor를 제공합니다 실질적으로 자주 쓰이는 것은 4종입니다

**`constant-vus`** — 고정 동시 VU 수를 duration 동안 유지합니다 각 VU는 duration이 끝날 때까지 `default` 함수를 무한 반복합니다 부하 패턴은 평탄한 직사각형 모양입니다

```yaml
scenarios:
  constant_load:
    executor: constant-vus
    vus: 50
    duration: 5m
```

VU 50개가 5분 내내 iteration을 반복합니다 총 iteration 수는 `50 × (5분 동안 VU 처리량)`이며, 처리 속도에 따라 달라집니다

**`ramping-vus`** — 지정한 단계별로 동시 VU 수를 선형 증감시킵니다 램프 업→고부하 유지→램프 다운 패턴을 구현합니다

```yaml
scenarios:
  ramp_load:
    executor: ramping-vus
    stages:
      - duration: 2m
        target: 100   # 0 → 100 VU 선형 증가
      - duration: 5m
        target: 100   # 100 VU 유지
      - duration: 1m
        target: 0     # 100 → 0 VU 선형 감소
```

`constant-vus`와 `ramping-vus`는 시간 기반 executor입니다 — duration이 끝나면 실행 중인 iteration도 강제 종료됩니다 E2E 트랜잭션처럼 완결성이 중요한 시나리오에서는 미완성 iteration이 통계를 오염시킬 수 있습니다

**`per-vu-iterations`** — 각 VU가 정확히 `iterations`번의 `default` 함수를 실행하고 종료합니다 모든 VU가 지정 횟수를 완료하면 테스트가 끝납니다

```yaml
scenarios:
  oneshot:
    executor: per-vu-iterations
    vus: 3000
    iterations: 1
    maxDuration: 10m
```

이 설정에서 3000개의 VU가 각각 1회씩 실행합니다 — 총 3,000번의 iteration이 발생하며, 모든 VU가 iteration을 마치면 테스트가 종료됩니다 `maxDuration`은 안전망 역할로, 지정 시간이 지나면 미완료 VU를 강제 종료합니다

**`shared-iterations`** — 총 iteration 수를 선언하고 VU들이 이 풀을 나눠서 소진합니다

```yaml
scenarios:
  shared:
    executor: shared-iterations
    vus: 50
    iterations: 500
    maxDuration: 5m
```

VU 50개가 총 500 iteration을 경쟁적으로 처리합니다 빠른 VU가 더 많은 iteration을 처리하므로, VU 간 처리 속도 차이가 있을 때 일부 VU에 iteration이 몰릴 수 있습니다 `per-vu-iterations`가 VU당 균등 배분이라면, `shared-iterations`는 처리량 우선 배분입니다

### executor별 VU 타임라인 비교

아래 다이어그램은 `constant-vus`와 `per-vu-iterations: 1`의 VU 동작 차이를 시각화합니다

![executor 종류별 VU 동작 타임라인 비교|tall](/diagrams/goti-deepdive-k6-executor-1.svg)

**`constant-vus`** 구간(왼쪽)에서는 VU 3개가 duration 내내 존재하며 iteration을 반복합니다 각 VU는 이전 iteration이 끝나자마자 다음 iteration을 시작합니다 duration이 끝나면 진행 중인 iteration도 중단됩니다

**`per-vu-iterations: 1`** 구간(오른쪽)에서는 VU 3개가 각 1회 iteration을 수행하고 곧바로 종료합니다 VU마다 시작 시점이 거의 동시이며, 각자의 E2E 흐름을 완결한 뒤 해제됩니다 마지막 VU가 완료되는 시점에 테스트가 끝납니다

이 차이가 의미하는 것은 다음 섹션에서 구체화합니다

### iteration의 의미와 도메인 매핑

k6에서 **iteration**은 `default` 함수의 1회 실행입니다 `default` 함수 안에 여러 HTTP 요청이 있어도 그 전체가 하나의 iteration입니다

iteration의 의미는 executor와 `default` 함수의 설계에 따라 완전히 달라집니다

**`constant-vus` + 단건 요청**의 경우, 1 iteration = 1 HTTP 요청이고, VU 수 × 초당 iteration 수 = RPS가 됩니다 단순 throughput 측정에 적합합니다

**`per-vu-iterations: 1` + E2E 플로우**의 경우, 1 iteration = 1 사용자의 전체 E2E 흐름이 됩니다 `default` 함수 안에 대기열 진입 → 인증 → 좌석 조회 → 주문 → 결제까지 단계별 요청을 모두 넣으면, 1 VU = 1 사용자가 처음부터 끝까지 E2E를 완료하는 단위가 됩니다

VU 수 = 동시 사용자 수, iteration = 사용자 1명의 세션 — 이 1:1 대응이 성립하는 유일한 설정이 `per-vu-iterations: 1`입니다

`constant-vus`에서는 VU가 iteration을 반복하므로 "1 VU = 같은 사람이 계속 예매 시도"가 됩니다 실제 사용자 행동과 다릅니다 통계적으로도, 같은 VU가 반복 실행하면 이전 요청의 지연이 다음 iteration 시작 시점에 영향을 주어 독립 샘플이라 보기 어렵습니다

---

## 📐 세부 동작과 옵션

### executor 비교 요약

| executor | VU 동작 | 종료 조건 | 적합한 측정 목적 |
|---|---|---|---|
| `constant-vus` | duration 내 무한 반복 | duration 경과 | 정상 부하 지속 처리량, p95/p99 안정성 |
| `ramping-vus` | 단계별 VU 선형 증감 | 마지막 stage 완료 | 부하 증가 구간에서 임계점 탐색 |
| `per-vu-iterations` | VU당 N회 후 종료 | 모든 VU 완료 | E2E 성공률, N명 동시 사용자 시뮬레이션 |
| `shared-iterations` | VU가 풀을 나눠 소진 | 총 iteration 소진 | 고정 횟수 작업의 총 소요 시간 측정 |

### setup()에서 토큰 일괄 발급하는 이유

`setup()` 함수는 iteration이 시작하기 전에 한 번만 실행됩니다 여기서 VU 수만큼 인증 토큰을 일괄 발급해 배열로 반환하면, 각 VU는 `default(data)` 안에서 `data.tokens[__VU - 1]`로 자신의 토큰을 가져와 씁니다

```javascript
export function setup() {
  const tokens = [];
  for (let i = 0; i < VU_COUNT; i++) {
    const res = http.post(`${BASE_URL}/auth/signup`, JSON.stringify({
      email: `user${i}@test.internal`,
      password: "test1234",
    }));
    tokens.push(res.json("token"));
  }
  return { tokens };
}

export default function (data) {
  const token = data.tokens[__VU - 1];
  // 이후 E2E 시나리오
}
```

이 패턴의 핵심 효과는 **signup 부하와 실제 피크 부하의 분리**입니다 signup이 `default` 함수 안에 있으면, 부하테스트 초반에 signup 요청이 몰려 서버 응답이 느려집니다 이를 실제 피크와 혼동하면 "signup 병목"을 "좌석 조회 병목"으로 잘못 진단할 수 있습니다

`setup()`에서 순차적으로(또는 적당한 sleep을 두어) signup을 처리하면, 실제 시나리오가 시작하는 시점에는 모든 VU가 유효한 토큰을 보유하고 있습니다

### thresholds와 executor의 조합

executor는 iteration을 배분하는 역할이고, **thresholds**는 그 iteration 결과가 허용 범위 안에 있는지 선언적으로 검증합니다

```javascript
export const options = {
  scenarios: {
    oneshot: {
      executor: "per-vu-iterations",
      vus: 3000,
      iterations: 1,
    },
  },
  thresholds: {
    "http_req_duration{endpoint:seat_select}": ["p(95)<2000"],
    "goti_ticket_success_rate": ["rate>0.95"],
    http_req_failed: ["rate<0.01"],
  },
};
```

`per-vu-iterations: 1`과 thresholds를 조합하면 "3000명이 1회씩 시도했을 때 E2E 성공률 95% 이상, p95 2초 이하"라는 합격/불합격 기준이 명확해집니다 `constant-vus`였다면 총 요청 수가 환경에 따라 달라져 동일 조건 비교가 어렵습니다

### `__VU`와 `__ITER` 빌트인 변수

k6는 각 VU에 `__VU` (1부터 시작하는 VU 번호)를, 각 iteration에 `__ITER` (VU별 0부터 시작하는 iteration 카운터)를 제공합니다

`per-vu-iterations: 1`에서 `__ITER`는 항상 0입니다 — 각 VU가 1번만 iteration을 수행하기 때문입니다 이 특성을 이용해 `data.tokens[__VU - 1]`로 VU마다 다른 계정을 정확히 배정합니다

분산 실행(여러 PC에서 동시 실행)에서는 `RUNNER_ID` 환경 변수로 계정 풀을 분리합니다 예를 들어 `RUNNER_ID=1`이면 `tokens[VU_COUNT + __VU - 1]`을 사용해 Runner 0과 계정이 겹치지 않도록 합니다

---

## 🧩 go-ti에서는

go-ti 티켓팅 POC에서 k6 executor 선택이 결정적인 역할을 했습니다 대기열 구현체 A/B/C를 공정하게 비교하려면 "3000명이 동시에 1회씩 예매를 시도한다"는 현실적인 시나리오가 필요했습니다

`constant-vus`나 `ramping-vus`를 쓰면 같은 VU가 반복 예매를 시도하는 구조가 되어 "실제 피크에서 몇 명이 성공하는가"를 측정하기 어렵습니다 반면 `per-vu-iterations: 1`을 사용하면 1 VU = 1 사용자 = 1회 E2E로 완전히 대응됩니다 3000 VU 실행이 곧 3000명 동시 피크 재현이고, `goti_ticket_success_rate` threshold가 "3000명 중 몇 퍼센트가 결제까지 완료했는가"를 직접 표현합니다

관측용 시나리오(`multicloud-readonly`)에는 `constant-vus`를 사용했습니다 상태 변경 없이 양쪽 클러스터의 read-only 엔드포인트를 지속적으로 호출해 p95를 비교하는 목적이므로, 지속 부하가 필요했습니다

`setup()`에서 VU 수만큼 인증 토큰을 일괄 발급한 것은 signup 병목과 실제 피크 성능을 명확히 분리하기 위한 설계입니다 이 결정 덕분에 ADR-0023의 Java vs Go 성능 비교에서 "signup 처리 차이"가 아닌 "실제 예매 처리 차이"를 측정할 수 있었습니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [부하테스트 방법론 ADR — K6 원샷 모델 채택](/logs/goti-load-testing-methodology-adr)에 정리했습니다

---

## 📚 핵심 정리

- k6의 테스트 실행은 init → setup → iteration(s) → teardown 4단계이며, executor는 iteration 단계에서 VU를 어떻게 배치하고 종료할지를 결정합니다
- `constant-vus`는 평탄한 지속 부하에, `ramping-vus`는 부하 증가 임계점 탐색에, `per-vu-iterations: 1`은 N명 동시 1회 E2E 시뮬레이션에 각각 적합합니다
- `per-vu-iterations: 1`에서만 "1 VU = 1 사용자 = 1회 세션"이 성립합니다 — 이 1:1 대응이 E2E 성공률 측정을 도메인 언어로 직접 표현하게 만듭니다
- `setup()`에서 토큰을 일괄 발급하면 signup 부하와 실제 피크 부하를 분리할 수 있으며, 이것이 공정한 구현체 비교의 선결 조건입니다
- `__VU`와 `RUNNER_ID`를 조합하면 여러 PC에서 분산 실행 시 계정 풀이 겹치지 않도록 VU별 계정을 정확히 배정할 수 있습니다
