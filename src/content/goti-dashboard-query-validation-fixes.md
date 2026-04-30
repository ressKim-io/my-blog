---
title: "대시보드 쿼리 검증 — 40개 대시보드 674개 쿼리 전수 점검"
excerpt: "Kind dev 환경에서 Mimir/Loki/Tempo API로 674개 쿼리를 실제 실행해 검증하고, 실패 원인을 카테고리별로 분류해 29건을 수정한 과정을 정리합니다."
category: monitoring
tags:
  - go-ti
  - Observability
  - Grafana
  - Dashboard
  - PromQL
  - LogQL
  - Prometheus
  - troubleshooting
series:
  name: "goti-observability-ops"
  order: 13
date: "2026-03-25"
---

## 한 줄 요약

> Kind dev 환경에서 40개 대시보드 674개 쿼리를 전수 검증한 결과 초기 48% 실패율을 기록했고, 카테고리별 원인 분석으로 29건을 해소해 PASS를 351에서 380으로 끌어올렸습니다.

---

## 🔥 문제: 40개 대시보드 674개 쿼리 중 323건이 실패

### 기존 아키텍처와 검증 기대

Kind 기반 dev 환경에는 Mimir, Loki, Tempo가 모두 배포되어 있습니다.
Grafana 대시보드는 총 40개이며 포함된 쿼리는 674개입니다.
`validate.sh`는 각 쿼리를 Mimir/Loki/Tempo API로 실제 실행해 데이터 반환 여부를 확인하는 스크립트입니다.
이상적으로는 대부분이 PASS해야 하고, 소수의 FAIL이 나더라도 원인이 명확해야 합니다.

### 발견한 문제

전체 검증을 돌린 결과는 기대와 달랐습니다.

```text
351 PASS / 323 FAIL (실패율 48%)
```

실패율이 절반에 가까운 상황이었으므로, 전수 조사로 실패 카테고리를 분류해야 했습니다.

---

## 🤔 원인: 여덟 가지 카테고리로 분류된 실패

실패 323건을 원인별로 분류하면 다음과 같습니다.

| 카테고리 | 건수 | 요약 |
|---|---|---|
| traces_spanmetrics 데이터 없음 | 38 | Tempo metricsGenerator OFF |
| 인프라 메트릭 누락 | 47 | 일부 컴포넌트 미배포/미설정 |
| Redis 메트릭 전체 없음 | 17 | exporter 미설치 |
| LogQL false negative | 17 | 검증 시간 범위 1h가 너무 짧음 |
| Kafka consumer 메트릭 없음 | 15 | 브로커 CrashLoopBackOff |
| 구문 오류 | 16 | extract 스크립트 multi-line 파싱 + rate() range 누락 |
| http_server 특정 필터 | 10 | 해당 트래픽 없음 (정상) |
| 커스텀 비즈니스 메트릭 | 7 | 미구현 |

카테고리 각각의 원인을 살펴보겠습니다.

**traces_spanmetrics 38건**은 Tempo의 metricsGenerator가 꺼져 있어 span metrics가 생성되지 않는 상태였습니다.
metricsGenerator를 켜지 않으면 `traces_spanmetrics_*` 계열 메트릭이 아예 존재하지 않습니다.

**Redis 메트릭 17건**은 Redis Exporter가 설치되어 있지 않아 메트릭 자체가 수집되지 않는 상태였습니다.
대시보드는 존재하지만 데이터 소스가 비어 있었습니다.

**LogQL 17건**은 실제로는 로그가 있는데 검증 범위가 1시간으로 짧아 false negative가 난 경우입니다.
Dev 환경은 트래픽이 적어 1시간 안에 특정 로그가 한 건도 없을 수 있었습니다.

**Kafka consumer 메트릭 15건**은 브로커가 CrashLoopBackOff 상태라 메트릭 자체가 수집되지 않았습니다.

**구문 오류 16건**은 두 가지 원인이 섞여 있었습니다.
첫째는 extract 스크립트가 multi-line 쿼리를 제대로 파싱하지 못해 중간이 잘려 문법이 깨진 경우,
둘째는 PromQL에서 `rate()` 함수에 range vector를 지정하지 않아 파싱이 실패한 경우입니다.

**http_server 필터 10건**은 정상적인 실패입니다.
해당 라우트로 들어오는 트래픽이 없을 뿐이었습니다.

**커스텀 비즈니스 메트릭 7건**은 goti-server 코드에서 아직 구현되지 않은 메트릭이었습니다.

---

## ✅ 해결: 대시보드 JSON 수정 + Validate 스크립트 개선 + 인프라 배포

세 축으로 나눠 수정했습니다.

### 1. 대시보드 JSON 버그 수정

**jvm-deep-dive.json의 start_time 메트릭 교체**

기존 쿼리는 `jvm_cpu_start_time_seconds`를 사용하고 있었습니다.
그러나 OTel Java Agent는 이 메트릭을 노출하지 않습니다.
`process_start_time_seconds`도 마찬가지로 Prometheus client library 전용이라 OTel Agent에서는 기대할 수 없습니다.

대안은 kube-state-metrics가 제공하는 `kube_pod_start_time`입니다.

```promql
# Before (OTel Java Agent에서 존재하지 않음)
jvm_cpu_start_time_seconds{...} > 0

# After (kube-state-metrics 기반)
kube_pod_start_time{namespace="goti", pod=~"$svc.*"}
```

불필요한 `> 0` guard도 함께 제거했습니다.
Pod가 존재한다면 `kube_pod_start_time` 값은 항상 양수이므로 guard가 필요 없습니다.

**kafka-consumer.json의 rate() range 복원**

기존 쿼리에서 `rate()`의 range vector가 누락되어 PromQL 파싱 에러가 발생했습니다.

```promql
# Before (range vector 누락 → 파싱 에러)
rate(kafka_server_brokertopicmetrics_messagesinpersec{...})

# After
rate(kafka_server_brokertopicmetrics_messagesinpersec{...}[$__rate_interval])
```

`$__rate_interval`은 Grafana가 대시보드의 step에 맞춰 자동 계산해주는 변수입니다.

### 2. Validate 스크립트 개선

**LogQL 검증 범위 1h → 6h**

Dev 환경은 트래픽이 적습니다.
1시간 범위로는 false negative가 빈번했으므로 6시간으로 확대했습니다.
실제로 Loki에는 goti 로그가 정상 수집되고 있었고, 24시간 기준으로는 5개 서비스 모두 로그가 확인했습니다.

**extract-queries.sh의 누락 변수 치환 5종 추가**

Grafana 대시보드 JSON에는 `$project`, `$app`, `$topic`, `$consumer_group`, `$match_id` 같은 템플릿 변수가 쓰입니다.
검증 전 단계에서 이 변수들이 치환되지 않으면 literal string으로 남아 매칭이 실패합니다.
다섯 변수의 치환 로직을 추가해 변수 미치환으로 인한 실패를 제거했습니다.

### 3. 인프라 배포

**Redis Exporter 신규 배포**

`oliver006/redis_exporter:v1.67.0` 이미지를 사용해 Deployment와 Service, ServiceMonitor를 함께 배포했습니다.
ServiceMonitor에는 `release: kube-prometheus-stack-dev` 라벨을 붙여 Operator가 자동 인식하도록 했습니다.

```yaml
env:
  - name: REDIS_ADDR
    value: "redis://172.20.0.1:6379"
```

NetworkPolicy는 redis-exporter에서 `172.20.0.1:6379`로 나가는 egress를 허용하도록 추가했습니다.

**Kafka NetworkPolicy egress 수정 / Tempo metricsGenerator 활성화**

이 두 항목은 각각 별도 트러블슈팅 로그에서 다룬 내용과 연결됩니다.
Kafka 브로커 CrashLoopBackOff는 NetworkPolicy egress 허용 누락이 원인이었고,
Tempo metricsGenerator는 overrides 설정 활성화로 span metrics 생성이 복원되었습니다.

### 결과

```text
Before: 351 PASS / 323 FAIL
After : 380 PASS / 294 FAIL   (+29 PASS, -29 FAIL)
```

| 항목 | Before | After | 비고 |
|---|---|---|---|
| jvm-deep-dive | 20/1 | 21/0 | 완전 정상 |
| api-red-metrics | 21/1 | 22/0 | 완전 정상 |
| Redis 메트릭 | 0 PASS | +15 PASS | `redis_up=1` 정상 수집 |
| Kafka 브로커 | CrashLoopBackOff | 3/3 Running | 정상화 |
| LogQL | 6건 실패 | 전부 PASS | 6h 확대 효과 |

jvm-deep-dive와 api-red-metrics 두 대시보드는 실패 0건으로 완전 정상화되었습니다.
Redis 메트릭은 Exporter 배포만으로 15건이 한꺼번에 복구되었습니다.
Kafka 브로커는 3/3 Running으로 회복되었고, LogQL은 검증 범위 확대로 6건 모두 PASS했습니다.

---

## 남은 이슈

아직 해소하지 못한 항목이 네 종류 남아 있습니다.

- **traces_spanmetrics 38건**: Tempo metricsGenerator에서 distributor와 generator ring 연결이 불안정한 상태입니다. 별도 조사가 필요합니다.
- **Kafka consumer 메트릭**: consumer group이 실제로 생성되면 자동으로 해소될 항목입니다.
- **커스텀 비즈니스 메트릭 7건**: goti-server 코드에서 해당 메트릭을 구현해야 노출됩니다.
- **extract 구문 오류 16건**: multi-line 쿼리 파싱 로직을 더 견고하게 다듬어야 합니다.

---

## 📚 배운 점

- **검증 시간 범위는 환경 특성에 맞춰 잡는다**: Dev처럼 트래픽이 적은 환경에서는 1시간이 아니라 6시간 이상을 기본으로 둬야 false negative가 줄어듭니다.
- **OTel vs Prometheus client library는 메트릭 네임스페이스가 다르다**: `process_start_time_seconds`처럼 당연히 있을 것 같은 메트릭도 OTel Agent에서는 존재하지 않을 수 있습니다. 대시보드를 쓸 때는 수집기에 맞는 메트릭명을 확인해야 합니다.
- **대시보드는 인프라 체크리스트와 같다**: Redis Exporter 미설치처럼 인프라 누락이 대시보드 검증에서 한꺼번에 드러나기도 합니다. 674개 쿼리 검증은 관측성 스택의 건강성을 역으로 비추는 거울 역할을 했습니다.
- **`rate()`에 range vector가 빠지면 침묵의 실패가 난다**: 로컬에서는 대시보드가 겉보기엔 그려지지만 값이 비거나 에러가 나므로, 검증 스크립트로만 잡을 수 있는 유형입니다.
- **변수 치환 누락은 검증 파이프라인 자체의 버그**: extract 단계에서 변수 치환을 빠뜨리면 실제 쿼리가 아닌 literal string을 검증하게 됩니다. 템플릿 변수 목록은 주기적으로 검토해야 합니다.

---

## 관련 파일

- `Goti-monitoring/grafana/dashboards/developer/jvm-deep-dive.json`
- `Goti-monitoring/grafana/dashboards/developer/kafka-consumer.json`
- `Goti-monitoring/charts/goti-monitoring/dashboards/developer/` (SSOT 동기화)
- `Goti-monitoring/values-stacks/dev/tempo-values.yaml`
- `Goti-k8s/scripts/validate/validate-queries.sh`
- `Goti-k8s/scripts/validate/extract-queries.sh`
- `Goti-k8s/infrastructure/dev/redis-exporter/` (신규)
- `Goti-k8s/infrastructure/dev/network-policies/kafka-netpol.yaml`
- `Goti-k8s/infrastructure/dev/network-policies/monitoring-netpol.yaml`
