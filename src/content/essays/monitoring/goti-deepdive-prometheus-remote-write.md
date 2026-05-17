---
title: "Prometheus Remote Write — snappy 압축 protobuf로 메트릭을 push하는 원리"
excerpt: "Prometheus가 기본적으로 pull(scrape) 방식으로 동작하는데도 왜 Remote Write라는 push 경로가 필요한지, 그리고 내부에서 protobuf와 snappy 압축이 어떻게 조합되어 Mimir 같은 원격 저장소에 데이터를 전달하는지 설명합니다"
category: monitoring
tags:
  - go-ti
  - prometheus
  - remote-write
  - mimir
  - protobuf
  - snappy
  - concept
series:
  name: "goti-deepdive-runtime"
  order: 2
date: "2026-04-03"
---

## 한 줄 요약

> Prometheus Remote Write는 pull 모델로는 수집하기 어려운 메트릭을 snappy 압축 protobuf 배치로 push해 Mimir 같은 원격 저장소가 직접 수신하도록 만드는 프로토콜입니다 — 수명 짧은 배치 runner도 측정 종료 시점에 결과를 밀어 넣을 수 있습니다

---

## 🤔 무엇을 푸는 기술인가

Prometheus의 기본 수집 방식은 **pull(scrape)** 입니다 Prometheus 서버가 일정 주기마다 타깃 `GET /metrics` 엔드포인트를 호출해 데이터를 가져오는 구조입니다 이 방식은 타깃이 살아 있는 동안은 잘 동작하지만 두 가지 상황에서 한계가 드러납니다

첫째, **수명이 짧은 프로세스**입니다 scrape interval(기본 15초)보다 짧은 시간에 실행을 마치는 배치 잡이나 부하 테스트 runner는 Prometheus가 폴링하기 전에 이미 종료됩니다 메트릭을 전혀 수집하지 못하거나 실행 시간 중 극히 일부만 포착됩니다

둘째, **원격 장기 저장 분리**입니다 단일 노드 Prometheus는 로컬 TSDB에만 저장하므로 고가용성·수평 확장·장기 보존을 원하면 별도 저장소가 필요합니다 Thanos, Cortex, Grafana Mimir 같은 시스템이 이 역할을 하는데, 데이터를 받으려면 Prometheus가 먼저 **내보내는** 동작이 있어야 합니다

Remote Write 프로토콜은 이 두 문제를 해결합니다 메트릭을 생성하는 쪽이 **직접 push**하므로 scrape 타이밍에 구애받지 않고, 수신 측이 원격 저장소에 영구 보존할 수 있습니다

---

## 🔧 동작 원리

### pull 모델 vs push(Remote Write) 모델

![Pull 모델 vs Remote Write Push 모델 비교|tall](/diagrams/goti-deepdive-prometheus-remote-write-1.svg)

위 다이어그램은 두 모델의 근본적인 방향 차이를 보여줍니다

왼쪽 pull 모델에서는 **Prometheus 서버가 능동적 행위자**입니다 타깃(App A/B/C)이 모두 `/metrics` HTTP 엔드포인트를 열어두어야 하고, Prometheus가 정해진 주기마다 찾아갑니다 수집된 데이터는 Prometheus 로컬 TSDB에 단독으로 저장됩니다 한계 박스에서 확인할 수 있듯, 타깃이 `/metrics`를 노출하지 않거나 수명이 짧으면 수집 자체가 불가능합니다

오른쪽 Remote Write 모델에서는 **타깃이 능동적 행위자**로 역전됩니다 k6 부하 runner처럼 수명이 짧은 프로세스도, Prometheus처럼 지속 실행 중인 서버도 snappy+protobuf로 인코딩한 데이터를 Remote Write 엔드포인트에 POST합니다 수신한 Mimir는 멀티테넌트 분산 저장소로 데이터를 보존합니다

### Remote Write 내부 5단계 흐름

![Remote Write 내부 흐름 — snappy 압축 protobuf push|tall](/diagrams/goti-deepdive-prometheus-remote-write-2.svg)

위 다이어그램은 메트릭이 생성된 뒤 Mimir 오브젝트 스토리지까지 이동하는 전체 경로와 재시도 큐를 함께 보여줍니다

**1단계 — 메트릭 생성**  
scrape 또는 클라이언트 라이브러리 계측으로 시계열 샘플이 만들어집니다 각 샘플은 `(라벨 셋, 타임스탬프, 값)` 형태의 구조입니다

**2단계 — WAL (Write-Ahead Log) 기록**  
Prometheus는 메트릭을 전송하기 전에 로컬 WAL에 먼저 씁니다 이 단계가 있어서 전송 실패 시 WAL을 재읽어 재시도할 수 있습니다 다이어그램 오른쪽 `재시도 큐` 박스가 이 경로를 점선으로 표시합니다 WAL은 Remote Write의 내구성 보장 핵심 메커니즘입니다

**3단계 — protobuf 직렬화 + snappy 압축**  
WAL의 샘플들은 배치로 묶여 `snappy.WriteRequest` protobuf 메시지로 직렬화됩니다 protobuf는 JSON 대비 파싱 비용이 낮고 바이너리 크기가 작습니다 여기에 snappy 압축을 적용하면 메트릭 특성상 4~6배 압축률을 얻습니다 반복 패턴이 많은 시계열 데이터에서 snappy는 LZ4 계열 알고리즘과 비교해도 압축/해제 속도와 압축률의 균형이 좋습니다

**4단계 — HTTP POST**  
압축된 페이로드를 `Content-Encoding: snappy` 헤더와 함께 원격 저장소의 `/api/v1/push` 엔드포인트로 POST합니다 전송 실패 시(5xx, 네트워크 타임아웃) 재시도 큐에 요청을 보관하고, WAL 기준점으로 돌아가 배치를 재구성해 재전송합니다 재시도 큐의 용량은 `max_shards`와 `capacity` 파라미터로 제어합니다

**5단계 — Mimir 수신 및 분산 저장**  
Mimir는 수신 요청을 **Distributor → Ingester → Compactor → Object Storage** 순으로 처리합니다 Distributor가 라벨 검증과 라우팅을 담당하고, Ingester가 인메모리 청크로 버퍼링합니다 Compactor가 주기적으로 블록을 압축·병합해 S3 같은 오브젝트 스토리지로 이동합니다 이 구조 덕분에 단일 노드 Prometheus TSDB와 달리 수평 확장과 장기 보존이 가능합니다

### 라벨 기반 시계열과 cardinality

Remote Write로 전송되는 각 데이터 포인트는 **라벨 셋 전체가 식별자**입니다

```text
http_requests_total{method="GET", endpoint="/queue/status", runner="runner-0", test="poc-a"} 1432
```

위 예에서 `{method, endpoint, runner, test}` 조합이 하나의 시계열을 정의합니다 라벨 값 종류가 늘수록 시계열 수가 기하급수적으로 증가합니다 이를 **cardinality 폭발**이라 합니다

부하 테스트 맥락에서 흔한 실수는 라벨 값에 동적 ID를 넣는 것입니다

```text
# 위험 — user_id가 동적이면 시계열 수 = VU 수만큼 폭증
k6_http_req_duration{user_id="usr-1042"} 0.234
k6_http_req_duration{user_id="usr-1043"} 0.198
```

3000 VU 테스트라면 이 라벨 하나로 `k6_http_req_duration` 시계열이 3000개 생성됩니다 Mimir에서 active series 한도를 초과하면 새 시계열 수신이 차단됩니다 라벨은 `runner`, `test`, `endpoint` 같이 **낮은 cardinality** 값만 허용해야 합니다

---

## 📐 세부 동작과 옵션

### Remote Write 주요 파라미터

| 파라미터 | 의미 | 권장 범위 |
|---|---|---|
| `max_shards` | 병렬 전송 shard 수 | 200~1000 (VU 수 비례) |
| `min_shards` | 최소 shard 수 (idle 상태 유지) | 1~10 |
| `max_samples_per_send` | 한 배치에 포함할 최대 샘플 수 | 2000~10000 |
| `batch_send_deadline` | 배치가 채워지지 않아도 강제 전송하는 최대 대기 시간 | 5s |
| `min_backoff` | 재시도 첫 대기 시간 | 30ms |
| `max_backoff` | 재시도 최대 대기 시간 (지수 증가 상한) | 5s |

`max_shards`는 전송 병렬성을 결정합니다 Mimir의 수신 용량보다 크게 설정하면 수신측 rate limit(429)을 유발합니다 반대로 너무 작으면 WAL이 쌓이고 전송 지연이 발생합니다

### Remote Write 버전 비교

| 버전 | 프로토콜 | 인코딩 | 특징 |
|---|---|---|---|
| v1 (기존) | HTTP/1.1 | protobuf + snappy | 광범위하게 지원 |
| v2 (2024+) | HTTP/1.1 | protobuf + snappy | 메타데이터·히스토그램 네이티브 지원, 중복 라벨 전송 제거 |

v2는 Prometheus 2.53+ 및 최신 Mimir에서 Content-Type 협상으로 자동 선택됩니다 기존 스택과의 호환성을 위해 v1이 여전히 기본 폴백입니다

### k6 Built-in Remote Write

k6는 `--out prometheus-remote-write` 플래그로 별도 Prometheus 서버 없이 직접 메트릭을 push할 수 있습니다

```bash
k6 run \
  --out prometheus-remote-write \
  script.js \
  -e K6_PROMETHEUS_RW_SERVER_URL=http://mimir:9090/api/v1/push \
  -e K6_PROMETHEUS_RW_TREND_STATS=p50,p95,p99
```

이 내장 기능이 수명 짧은 부하 runner에 push 모델이 적합한 이유를 잘 보여줍니다 테스트가 종료되는 시점까지 메트릭을 축적하다가 flush 단계에서 Mimir로 전송합니다 Prometheus scrape가 runner를 발견할 타이밍을 기다릴 필요가 없습니다

---

## 🧩 go-ti에서는

go-ti 부하 테스트 방법론에서 k6 runner는 EC2 인스턴스에서 수분~수십 분 실행 후 종료됩니다 Prometheus가 이 runner를 scrape하려면 service discovery 등록, `/metrics` 엔드포인트 오픈, scrape job 추가 등 운영 비용이 발생합니다 게다가 runner가 종료된 직후 Prometheus가 scrape를 시도하면 타깃이 없어서 데이터를 얻지 못합니다

k6의 내장 `prometheus-remote-write` 출력을 사용해 runner가 직접 Mimir `/api/v1/push`로 메트릭을 전송했습니다 `RUNNER_ID`, `test`, `endpoint` 3개 라벨만 허용해 cardinality를 제어했습니다 각 runner의 `queue_status p95`, `goti_ticket_success_rate` 같은 도메인 메트릭이 Mimir에 시계열로 보존되어 POC A/B/C 비교와 구현 수정 후 재측정이 가능해졌습니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [부하테스트 방법론 ADR — K6 + Mimir Remote Write](/logs/goti-load-testing-methodology-adr)에 정리했습니다

---

## 📚 핵심 정리

- Remote Write는 pull(scrape) 모델의 보완재입니다 — 수명 짧은 프로세스나 `/metrics` 엔드포인트를 열기 어려운 환경에서 측정 주체가 직접 push합니다
- 페이로드는 protobuf로 직렬화한 뒤 snappy로 압축합니다 — 시계열의 반복 패턴 덕분에 4~6배 압축률을 얻어 네트워크 비용을 줄입니다
- WAL이 내구성을 보장합니다 — 전송 실패 시 WAL을 재읽어 배치를 재구성하고 지수 백오프로 재전송합니다
- 라벨 값에 동적 ID를 넣으면 cardinality 폭발이 발생합니다 — `runner`, `test`, `endpoint` 같이 낮은 cardinality 라벨만 사용해야 Mimir active series 한도를 지킬 수 있습니다
- Mimir는 Distributor → Ingester → Compactor → Object Storage 구조로 수신 데이터를 분산 보존합니다 — 단일 노드 Prometheus TSDB와 달리 수평 확장과 장기 보존이 가능합니다
