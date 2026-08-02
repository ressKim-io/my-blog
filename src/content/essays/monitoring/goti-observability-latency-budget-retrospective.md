---
title: "관측 파이프라인은 컴포넌트가 아니라 지연 예산이다 — OOM 연쇄 3주 복기"
excerpt: "부하 테스트를 시작하면 서비스보다 관측 스택이 먼저 죽었습니다. 완충 장치를 넣어 OOM을 막았더니 그 완충이 만든 지연 때문에 span 140만 건이 조용히 사라졌습니다. 컴포넌트를 하나씩 튜닝하는 방식의 한계를 확인한 3주를 시간순으로 복기합니다"
category: monitoring
tags:
  - go-ti
  - Observability
  - OpenTelemetry
  - Kafka
  - Tempo
  - Loki
  - Mimir
  - Prometheus
  - retrospective
date: "2026-04-25"
---

## 한 줄 요약

> 대규모 티켓팅 플랫폼의 관측 스택을 3주 동안 다섯 번 무너뜨리고 다시 세웠습니다. 매번 원인이 다른 것 같았지만 결국 하나였습니다. 컴포넌트별 한계는 각각 지켰는데 **파이프라인 전체의 지연 예산은 아무도 관리하지 않았다**는 것입니다

---

## 부하를 걸면 서비스보다 관측 스택이 먼저 죽었습니다

티켓 오픈 트래픽을 재현하려고 k6로 부하를 걸기 시작했을 때, 가장 먼저 무너진 것은 애플리케이션이 아니었습니다. Loki와 Tempo, Mimir가 차례로 죽었습니다

문제는 그 다음입니다. 애플리케이션 병목을 찾으려면 트레이스와 로그가 필요한데, 그것을 보여줄 시스템이 먼저 멈춰 있었습니다. 진단 도구를 잃은 상태에서 진단을 해야 하는 상황이 반복됐습니다

관측 대상이 바빠지는 바로 그 순간 관측 시스템도 똑같이 바빠집니다. 애플리케이션 트래픽이 열 배가 되면 트레이스도 열 배가 됩니다. HTTP 서버 앞에 rate limiter를 두는 것은 당연하게 여기면서, 관측 파이프라인에는 아무 보호 장치도 두지 않았다는 사실을 이때 처음 인식했습니다

---

## 1막 — 죽고, 살아나고, 다시 죽는 고리

첫 증상은 단순한 메모리 부족처럼 보였습니다. Tempo가 3Gi 한계에서 OOMKilled로 죽었고, 재시작하면 또 죽었습니다. **재시작 횟수는 85회까지 올라갔습니다**

그런데 패턴이 이상했습니다. 죽어 있는 동안 쌓인 데이터가 재시작 직후 한꺼번에 밀려들어 다시 메모리를 넘기고 있었습니다

```text
OOM → crash → 재시작 → 그동안 쌓인 backlog 폭주 → 또 OOM
```

Mimir 쪽에서도 같은 구조가 나왔습니다. distributor가 512Mi 한계에서 **20시간 동안 168회 재시작**했고, 메모리를 올려 복구하자 그동안 Alloy가 축적한 메트릭이 일괄 push되며 단일 Kafka record가 15MB 제한을 넘겼습니다. 수습하려고 넣은 설정 키가 그 버전에 존재하지 않아 Mimir 전체가 CrashLoop에 빠지기도 했습니다

여기서 얻은 첫 번째 결론은 이것입니다. **백엔드가 살아나는 순간이 가장 위험합니다.** 메모리를 아무리 늘려도 유입 속도를 제어하지 않으면 같은 사고가 규모만 키워 반복됩니다

---

## 2막 — 완충 장치를 넣다

근본 대응으로 두 가지를 적용했습니다

**tail sampling** — 전량 저장을 포기했습니다. 다만 "얼마나 버릴까"가 아니라 "무엇을 반드시 남길까"로 기준을 잡았습니다. 에러 트레이스와 2초 이상 걸린 요청은 100% 보존하고, 나머지 정상 트레이스만 10%로 줄였습니다. Tempo 유입량이 약 90% 감소했습니다

**Kafka 버퍼** — Alloy와 Tempo 사이에 Kafka를 넣었습니다. producer가 아무리 빠르게 보내도 consumer는 자기 속도로 처리합니다. 비즈니스 이벤트용 Strimzi 클러스터가 이미 있어 토픽 추가만으로 구현했고, retention은 1시간으로 짧게 잡아 버퍼 역할만 하도록 범위를 좁혔습니다

여기까지는 성공적이었습니다. OOM이 멈췄습니다

---

## 3막 — 완충 장치가 만든 침묵

며칠 뒤 DB Health 대시보드의 span metrics 패널이 전부 No Data가 됐습니다. Tempo는 정상이었고 로그도 깨끗했습니다. 실패한 컴포넌트가 없었습니다

Tempo 자체 메트릭을 열어보고서야 무슨 일이 벌어졌는지 알았습니다

```text
tempo_metrics_generator_spans_received_total  = 1,406,413
tempo_metrics_generator_spans_discarded_total{reason="outside_metrics_ingestion_slack"} = 1,406,413
tempo_metrics_generator_registry_active_series = 0
```

**140만 건을 받아서 140만 건을 버렸습니다.** 에러도 알림도 없었습니다

원인은 2막에서 넣은 그 완충 장치였습니다. 각 단계의 지연이 합산되고 있었습니다

```text
App에서 span 생성 (타임스탬프 기록)
  → Alloy OTLP receiver
  → tail_sampling (decision_wait 5s)         +5초
  → batch traces (timeout 5s)                +5초
  → Kafka exporter → topic                   +약 1초
  → Kafka consumer (Alloy)
  → batch kafka_traces (timeout 10s)         +10초   ← 병목
  → Tempo OTLP exporter
────────────────────────────────────────────────────
합계 약 21초 + Kafka lag  >  Tempo ingestion slack 30초
```

각 단계는 저마다 합리적인 값이었습니다. tail sampling은 트레이스가 완결될 때까지 기다려야 하고, batch는 전송 효율을 위해 모아야 합니다. 문제는 **이 값들을 합산해서 관리하는 주체가 없었다**는 것입니다

여기에 역설이 하나 더 있었습니다. `batch timeout`은 배치가 `send_batch_size`에 도달하지 못할 때만 적용됩니다. 즉 트래픽이 많으면 배치가 즉시 차서 문제가 없고, **한산할 때 오히려 지연이 최대가 됩니다**. 부하 테스트를 돌리지 않는 평상시에 조용히 데이터가 사라지고 있었던 것입니다

---

## 4막 — 유입 제어를 파이프라인 전체로 확장

같은 시기 OTel Collector가 26회 재시작하는 일도 있었습니다. Loki의 기본 ingestion rate limit이 429로 거부하고, retry 루프가 메모리를 밀어올리고, 죽으면 Kafka에서 다시 소비하는 구조였습니다

```text
HTTP Status Code 429, Message=ingestion rate limit exceeded for user fake
(limit: 4194304 bytes/sec) while attempting to ingest '1212' lines
totaling '1969264' bytes
```

이 시점에서 대응 방식을 바꿨습니다. 컴포넌트 하나를 고치는 대신 **유입 경로 전체에 세 축을 동시에** 걸었습니다

| 축 | 조치 | 의도 |
|---|---|---|
| 소비 속도 제어 | Kafka consumer `max_processing_time` 100ms → 1s, `fetch_max` 명시 | 재시작 시 backlog를 점진적으로 소화 |
| 장애 격리 | exporter `retry_on_failure` + `sending_queue` | 백엔드 장애가 파이프라인 전체를 무너뜨리지 않도록 차단 |
| 백엔드 효율 | 청크·블록 체류 시간 단축, `GOMEMLIMIT`을 limit의 90%로 | 한계 도달 전에 GC가 개입 |

한 축만 고치면 다른 경로로 같은 문제가 반복된다는 것이 이때의 교훈입니다

---

## 5막 — 그리고 완충 장치를 걷어냈습니다

대기열 구현이 CDN 캐싱 방식으로 확정되면서 Kafka는 프로젝트에서 실질적 역할을 잃었습니다. 관측 파이프라인의 버퍼 하나만을 위해 Kafka 클러스터를 유지하는 것은 비용과 복잡도 대비 타당하지 않다고 판단해 걷어냈습니다

버퍼를 넣은 것도, 뺀 것도 같은 기준이었습니다. 완충 장치는 공짜가 아니며 **지연이라는 대가를 지불하고 안정성을 사는 거래**입니다. 그 대가를 감당할 이유가 사라지면 되돌리는 것이 맞습니다

같은 시기 Prometheus도 정리했습니다. Grafana가 이미 Mimir만 조회하고 alert 평가도 ruler가 담당하고 있어 로컬 TSDB는 중복 저장에 지나지 않았습니다. Agent mode로 전환하자 **메모리 실측이 2,770Mi에서 492Mi로 82% 줄었고**, 그 여유로 10분째 Pending이던 pod 5개가 한꺼번에 스케줄됐습니다

---

## 6막 — 대시보드가 진실을 말하는지 측정하다

3막에서 배운 것은 "관측 시스템은 조용히 실패한다"였습니다. 그렇다면 조용한 실패를 찾아내는 방법이 필요했습니다

모든 대시보드 JSON에서 PromQL과 LogQL 표현식을 추출하고, 변수를 치환한 뒤 실제로 쿼리를 실행해 OK · EMPTY · ERROR로 분류하는 스크립트를 만들었습니다. 결과는 예상보다 나빴습니다

| 시점 | 대상 | 결과 |
|---|---|---|
| 1차 (03-25) | 대시보드 40개 · 쿼리 674개 | **실패율 48%** (351 PASS / 323 FAIL) |
| 1차 수정 후 | 동일 | 380 PASS (+29) |
| 2차 (04-25) | 대시보드 37개 · 쿼리 625개 | OK 191 (30.6%) · **EMPTY 411 (65.8%)** · ERROR 23 |
| 2차 수정 후 | 동일 | **OK 216 (+13%)** · MISSING 289 → 218 (−25%) |

패널이 초록불이라고 데이터가 맞다는 뜻도 아니었습니다. 별도 점검에서 시간 단위를 `ms`로 두고 `Milliseconds()`로 int64 절삭을 하는 바람에 **수십 마이크로초 구간이 전부 0 bucket에 압축돼 p95 패널이 거짓값을 표시**하고 있던 것도 찾았습니다

측정 도구를 만든 것보다, **고친 뒤 같은 도구로 다시 측정해 개선을 수치로 확인한 것**이 더 중요한 변화였습니다

---

## 배운 점

**관측 파이프라인은 컴포넌트별로 튜닝하면 안 됩니다.** `decision_wait` 5초, `batch timeout` 10초, `ingestion slack` 30초는 각각 보면 모두 합리적인 값입니다. 합산했을 때 예산을 넘는다는 것은 어느 컴포넌트의 문서에도 적혀 있지 않습니다. end-to-end 지연 예산을 먼저 정하고 각 단계에 배분하는 순서였어야 합니다

**OOM은 메모리 부족이 아니라 유입 제어 부재입니다.** limit을 올려 넘긴 것은 우회이지 해결이 아닙니다. 왜 그만큼의 메모리를 쓰는지 답할 수 있어야 근본 대응입니다

**관측 시스템의 실패는 조용합니다.** 애플리케이션은 죽으면 알림이 울리지만, 관측 시스템이 죽으면 그 알림조차 울리지 않습니다. 140만 건이 사라진 것도, 대시보드 쿼리 절반이 실패하던 것도, p95가 거짓이던 것도 전부 에러 없이 진행됐습니다. **관측 시스템을 관측하는 별도의 장치가 필요합니다**

**완충 장치는 새로운 실패 모드를 만듭니다.** Kafka 버퍼는 OOM을 확실히 막았고, 동시에 21초의 지연을 만들어 다른 곳을 무너뜨렸습니다. 안정성을 위해 도입한 구조가 그 자체로 장애 지점이 될 수 있다는 것을 전제로 설계해야 합니다

---

## 읽는 순서

각 사건의 상세 기록입니다. 시간순으로 배열했습니다

1. [Kafka 버퍼드 OTel 파이프라인 — MSA 전환에 대비한 텔레메트리 버퍼 설계](/logs/goti-kafka-buffered-otel-pipeline/) — 2026-03-14
2. [Mimir distributor OOM 168회 — 복구 직후 backlog 일괄 push가 만든 2차 장애](/logs/goti-mimir-distributor-oom-backlog-push-crashloop/) — 2026-03-24
3. [Tempo OOM 115회 — monolithic mode의 메모리 경합과 block duration](/logs/goti-tempo-monolithic-oom-block-duration-tuning/) — 2026-03-24
4. [Tempo OOM 85회 — Kafka 버퍼와 tail sampling으로 해결하기](/logs/goti-tempo-oom-kafka-buffer-sampling/) — 2026-03-25
5. [대시보드 쿼리 674개 중 48%가 실패하고 있었다](/logs/goti-dashboard-query-validation-fixes/) — 2026-03-25
6. [수신 140만 건, 생성 0건 — 에러 없이 사라진 spanmetrics](/logs/goti-tempo-spanmetrics-batch-timeout/) — 2026-03-26
7. [OOM은 메모리 부족이 아니라 유입 제어 부재였다](/essays/goti-adr-loki-tempo-stability-tuning/) — 2026-03-31
8. [Redis 관리형 유지 + Kafka 완전 제거](/logs/goti-managed-kafka-removal/) — 2026-04-06
9. [Prometheus 메모리 82% 감축 — 관측 스택 6단계 복구](/logs/goti-prometheus-agent-mode-and-monitoring-cascade/) — 2026-04-14
10. [대시보드는 초록불인데 p95가 거짓이었다](/logs/goti-otel-spec-compliance-fixes/) — 2026-04-25

관련해서 같은 시기의 카디널리티 사고도 함께 읽으면 좋습니다. [Mimir ingester OOM 47시간](/logs/goti-mimir-ingester-oom-webhook-deadlock/)은 relabeling 규칙 하나가 빠져 메트릭 수백 개가 통째로 유입된 기록이고, [버전을 올리자 텔레메트리가 조용히 끊겼다](/logs/goti-otel-agent-otlp-protocol-mismatch/)는 WARN 한 줄만 남기고 40분간 아무도 몰랐던 사건입니다
