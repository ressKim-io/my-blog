---
title: "Prometheus pull 모델 — /metrics scrape가 동작하는 방식"
excerpt: "Prometheus가 왜 pull(scrape) 방식으로 메트릭을 수집하는지, 타깃 발견부터 exposition format 파싱·TSDB 저장·up 메트릭 헬스 체크까지 내부 흐름을 설명합니다"
category: monitoring
tags:
  - go-ti
  - prometheus
  - scrape
  - exposition-format
  - serviceMonitor
  - exporter
  - concept
series:
  name: "goti-deepdive-observability"
  order: 1
date: "2026-03-27"
---

## 한 줄 요약

> Prometheus는 타깃이 `/metrics` 엔드포인트를 열어두면 서버가 주기적으로 찾아가 데이터를 가져오는 pull(scrape) 모델로 동작합니다 — 앱이 collector에 보내는 push 모델과 정반대 방향입니다

---

## 🤔 무엇을 푸는 기술인가

관측성 파이프라인에서 가장 먼저 결정해야 하는 것은 **누가 먼저 움직이는가**입니다 수집 대상(앱)이 먼저 데이터를 보내는 방식이 push 모델이고, 수집 서버가 먼저 찾아가는 방식이 pull 모델입니다

Prometheus는 pull 모델을 선택했습니다 타깃은 `/metrics` HTTP 엔드포인트 하나만 열어두면 되고, Prometheus 서버가 설정된 주기마다 그 엔드포인트를 호출해 메트릭을 읽어갑니다 이 구조는 두 가지 문제를 해결합니다

첫째, **타깃 상태를 Prometheus가 직접 확인**할 수 있습니다 pull이 성공하면 타깃이 살아있다는 뜻이고, 실패하면 죽었다는 뜻입니다 이 헬스 정보를 `up` 메트릭에 자동으로 기록합니다

둘째, **수집 설정이 중앙집중**됩니다 어떤 타깃을 얼마나 자주 scrape할지를 Prometheus 서버 한 곳에서 관리합니다 타깃 앱은 데이터를 어디로 보낼지 알 필요가 없습니다

다만 pull 모델에는 한계도 있습니다 타깃이 scrape interval보다 짧게 살고 죽는 배치 잡이나, 방화벽 안에서 바깥을 볼 수 없는 앱은 `/metrics`를 열어둬도 수집이 어렵습니다 이런 경우에는 OTLP 같은 push 기반 프로토콜이 적합합니다

---

## 🔧 동작 원리

### pull 모델과 push 모델 비교

![Pull 모델 vs Push 모델 — Prometheus scrape와 OTLP push 비교|tall](/diagrams/goti-deepdive-prometheus-pull-vs-push-1.svg)

위 다이어그램은 두 수집 모델의 방향과 구조적 차이를 보여줍니다

왼쪽 pull 모델에서는 **Prometheus 서버가 능동적 행위자**입니다 앱 A·B가 각자 `/metrics` 엔드포인트를 열어두고, Prometheus가 15~30초 주기로 HTTP GET 요청을 보냅니다 수집된 데이터는 Prometheus 로컬 TSDB에 저장됩니다 하단의 `up` 메트릭은 scrape 성공·실패를 자동으로 기록해 타깃 헬스를 추적합니다

오른쪽 push 모델에서는 **앱이 능동적 행위자**로 역전됩니다 앱 A·B가 OTel SDK로 계측하고, 생성된 메트릭을 OTLP/gRPC로 OTel Collector에 직접 밀어 넣습니다 Collector는 데이터를 변환·집계해 원격 저장소(Mimir 등)로 전달합니다 앱은 `/metrics`를 열지 않아도 되고, Prometheus 서버가 없어도 동작합니다

두 모델의 핵심 차이를 정리하면 다음과 같습니다

| 항목 | Pull (Prometheus scrape) | Push (OTLP) |
|---|---|---|
| 능동적 행위자 | Prometheus 서버 | 앱(SDK) |
| 타깃 노출 | `/metrics` 엔드포인트 필수 | 엔드포인트 불필요 |
| 타깃 헬스 | `up` 메트릭으로 자동 추적 | 별도 헬스 체크 필요 |
| 수명 짧은 프로세스 | scrape interval보다 짧으면 수집 불가 | 종료 시점에 push 가능 |
| 설정 집중 | Prometheus 서버 단일 설정 | 각 앱에 collector 주소 설정 |

이 차이는 운영 방식에 직접 영향을 줍니다 pull 모델에서는 타깃이 추가될 때마다 수집 서버(Prometheus) 설정만 업데이트하면 되고, 앱은 `/metrics`를 열어두는 것 외에 수집 인프라를 신경 쓰지 않아도 됩니다 반면 push 모델에서는 각 앱이 collector 주소를 알아야 하므로 인프라 주소가 바뀌면 앱 설정도 함께 변경해야 합니다 Kubernetes처럼 Pod IP가 수시로 바뀌는 환경에서는 pull + ServiceMonitor 조합이 타깃 관리 부담을 크게 줄여줍니다

### scrape 내부 흐름 — ServiceMonitor부터 TSDB까지

![Prometheus scrape 내부 흐름 — ServiceMonitor부터 up 메트릭까지|tall](/diagrams/goti-deepdive-prometheus-pull-vs-push-2.svg)

위 다이어그램은 Kubernetes 환경에서 ServiceMonitor CRD가 타깃을 발견한 뒤, Prometheus가 `/metrics`를 scrape해 TSDB에 저장하고 `up` 메트릭을 기록하는 전체 경로를 보여줍니다

**1단계 — ServiceMonitor CRD**

Kubernetes 환경에서 타깃 발견은 `ServiceMonitor` CRD가 담당합니다 `selector` 필드로 Service의 라벨을 매칭하고, 어떤 포트·경로를 scrape할지 선언합니다 수동으로 IP 목록을 관리할 필요 없이 라벨 기반으로 타깃이 자동 등록됩니다

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: goti-metrics-collector
spec:
  selector:
    matchLabels:
      app: goti-metrics-collector
  endpoints:
    - port: metrics
      path: /metrics
      interval: 15s
```

**2단계 — Prometheus Operator**

Prometheus Operator는 클러스터 안의 ServiceMonitor를 감시합니다 ServiceMonitor가 생성·변경되면 Operator가 Prometheus scrape config를 자동 갱신합니다 타깃 Pod IP가 바뀌거나 새 인스턴스가 추가돼도 scrape 목록이 실시간으로 업데이트됩니다

**3단계 — HTTP GET /metrics**

Prometheus 서버는 `scrape_interval`(기본 1m, 권장 15~30s)마다 타깃 Pod에 `GET /metrics`를 보냅니다 타임아웃은 `scrape_timeout`으로 설정하며 기본값은 10초입니다

**4단계 — Exposition Format 파싱**

타깃은 HTTP 200 응답에 `text/plain; version=0.0.4` 형식으로 메트릭 텍스트를 반환합니다 이 포맷을 **exposition format**이라 합니다

```text
# HELP goti_seats_remaining_total 현재 잔여 좌석 수
# TYPE goti_seats_remaining_total gauge
goti_seats_remaining_total{section="A"} 142
goti_seats_remaining_total{section="B"} 87
# HELP goti_queue_length_total 대기열 대기 인원
# TYPE goti_queue_length_total gauge
goti_queue_length_total 3820
```

`# HELP` 라인은 메트릭 설명, `# TYPE` 라인은 counter·gauge·histogram·summary 중 하나를 선언합니다 그 아래가 실제 샘플입니다 각 샘플은 `메트릭명{라벨셋} 값` 형태이며, 라벨 조합 하나가 고유한 시계열을 정의합니다

Prometheus 파서는 이 텍스트를 줄 단위로 파싱해 `(라벨 셋, 타임스탬프, float64 값)` 튜플로 변환합니다

**5단계 — TSDB 저장**

파싱된 샘플은 로컬 TSDB(Time Series Database)에 저장됩니다 TSDB는 세 계층으로 구성됩니다

- **Head chunk**: 최근 2시간 데이터를 메모리에 유지합니다 빠른 쿼리를 위해 인메모리 인덱스도 함께 관리합니다
- **WAL(Write-Ahead Log)**: 메모리 데이터가 유실되지 않도록 디스크에 먼저 기록합니다 서버 재시작 시 WAL을 재읽어 Head chunk를 복원합니다
- **Block**: 2시간이 지난 데이터는 불변 블록으로 디스크에 저장합니다 Compactor가 주기적으로 작은 블록들을 병합해 쿼리 효율을 높입니다

**`up` 메트릭 — 타깃 헬스 자동 추적**

scrape가 성공하면 Prometheus는 자동으로 `up{job="...", instance="..."} 1`을 기록합니다 scrape 실패(타임아웃, 연결 거부, HTTP 오류 등)이면 `up=0`을 기록합니다 별도 헬스 체크 설정 없이 `up == 0` 조건 하나로 타깃 다운 알림을 만들 수 있습니다

### Exporter 패턴 — /metrics를 열지 못하는 대상

Prometheus pull 모델의 전제는 타깃이 `/metrics`를 직접 열 수 있다는 것입니다 그런데 MySQL, Redis 같은 서드파티 서비스나 하드웨어 장비는 exposition format을 직접 노출하지 않습니다

이 경우 **exporter**를 사이드카 또는 별도 서비스로 배포합니다 exporter는 대상 시스템의 API·쿼리·SNMP 등을 호출해 상태를 읽고, 그 결과를 exposition format으로 변환해 `/metrics`로 노출합니다 Prometheus는 exporter의 `/metrics`만 scrape하면 됩니다

`Redis` → (INFO 명령) → `redis_exporter` → `/metrics` → `Prometheus`

exporter가 pull 모델의 "어댑터" 역할을 한다고 볼 수 있습니다 go-ti 프로젝트에서도 비즈니스 메트릭 수집을 위해 동일한 패턴을 활용했습니다

---

## 📐 세부 동작과 옵션

### scrape 설정 주요 파라미터

| 파라미터 | 의미 | 기본값 | 권장 |
|---|---|---|---|
| `scrape_interval` | scrape 주기 | 1m | 15s~30s |
| `scrape_timeout` | 단일 scrape 타임아웃 | 10s | interval보다 짧게 |
| `metrics_path` | scrape 경로 | `/metrics` | 변경 가능 |
| `scheme` | HTTP/HTTPS | `http` | TLS 환경은 `https` |
| `honorLabels` | 타깃의 라벨과 Prometheus 라벨 충돌 시 타깃 우선 | false | 연합 환경에서 true |

### ServiceMonitor vs PodMonitor

Kubernetes 환경에서 scrape 타깃 선언 방법이 두 가지입니다

| 리소스 | 매칭 단위 | 적합한 상황 |
|---|---|---|
| `ServiceMonitor` | Kubernetes Service | 안정적인 IP가 필요한 서비스, Deployment 앞에 Service가 있는 경우 |
| `PodMonitor` | Pod 직접 | Service 없이 Pod IP를 직접 scrape, DaemonSet 등 |

### Histogram vs Summary — scrape 시 차이

exposition format에서 `histogram` 타입은 버킷별 카운터를 노출합니다

```text
http_request_duration_seconds_bucket{le="0.1"} 142
http_request_duration_seconds_bucket{le="0.5"} 234
http_request_duration_seconds_bucket{le="+Inf"} 245
http_request_duration_seconds_sum 18.3
http_request_duration_seconds_count 245
```

`le` 라벨이 경계값을 정의하고, 각 버킷은 별도 시계열이 됩니다 scrape 한 번에 버킷 수만큼 샘플이 생깁니다 `summary`는 타깃 측에서 분위수를 미리 계산해 노출하므로 scrape 후 Prometheus에서 집계할 수 없습니다 — 분산 환경에서는 `histogram`이 권장됩니다

---

## 🧩 go-ti에서는

go-ti는 Spring Boot 기반 goti-server의 JVM 메트릭은 OTel Java Agent가 OTLP로 push하고, **비즈니스 메트릭(좌석 잔량·결제 전환율·대기열 크기 등)은 별도 Go 서비스(goti-metrics-collector)가 DB와 Redis를 직접 읽어 `/metrics`로 노출**합니다 Alloy가 ServiceMonitor로 이 `/metrics`를 scrape해 Mimir로 전달합니다

이 선택의 핵심 이유는 부하 테스트 중 goti-server가 가장 바쁜 시점에 메트릭 수집이 서버에 부하를 주지 않아야 한다는 것이었습니다 Go 서비스를 별도 Deployment로 분리하고 전용 커넥션 풀(maxConns=3)을 사용해 서버 커넥션 풀과 완전히 격리했습니다 exporter 패턴 덕분에 메트릭 추가·변경이 goti-server 재배포 없이 goti-metrics-collector 단독 배포로 완결됩니다

> 이 기술을 go-ti에 도입하기까지의 의사결정 과정(검토한 대안과 기각 이유)은
> [비즈니스 메트릭 수집기를 Go 별도 서비스로 분리한 이유](/logs/goti-metrics-collector-go-sidecar)에 정리했습니다

---

## 📚 핵심 정리

- Prometheus pull 모델에서는 서버가 능동적으로 타깃의 `/metrics`를 주기적으로 scrape합니다 — 타깃은 엔드포인트를 열어두기만 하면 됩니다
- Kubernetes 환경에서 ServiceMonitor CRD가 라벨 기반으로 타깃을 발견하고, Prometheus Operator가 scrape config를 자동 갱신합니다
- scrape 성공·실패는 `up` 메트릭(1/0)에 자동 기록됩니다 — 별도 헬스 체크 없이 타깃 다운 알림을 구성할 수 있습니다
- exposition format은 `# HELP`·`# TYPE` 선언과 `메트릭명{라벨셋} 값` 샘플 라인으로 구성된 텍스트 프로토콜입니다 — 라벨 조합 하나가 고유 시계열을 정의합니다
- `/metrics`를 직접 열지 못하는 대상(Redis·MySQL 등)은 exporter가 어댑터 역할을 해 pull 모델에 연결합니다
- 수명이 짧은 프로세스나 방화벽 안쪽 앱에는 pull보다 OTLP push가 적합합니다 — 두 모델은 대립이 아니라 상호 보완 관계입니다
