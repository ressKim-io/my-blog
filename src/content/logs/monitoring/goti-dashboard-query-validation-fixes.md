---
title: "대시보드 쿼리 674개 중 48%가 실패하고 있었다 — 전수 검증 도구를 만든 이유"
excerpt: "관측 스택이 멀쩡해 보여도 대시보드가 진실을 보여주는 것은 아니었습니다. Mimir·Loki·Tempo API로 모든 쿼리를 실제로 실행해 보는 스크립트를 만들어 674개 중 48%가 실패하고 있음을 확인하고, 원인을 여덟 갈래로 나눠 29건을 해소한 기록입니다"
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

> Kind dev 환경의 대시보드 40개, 쿼리 674개를 전부 실행해 봤더니 절반 가까이가 실패하고 있었습니다. 원인을 여덟 갈래로 나눠 29건을 고쳤고 PASS가 351에서 380으로 올라갔습니다

---

## 🔥 문제: 40개 대시보드 674개 쿼리 중 323건이 실패

### 검증을 시작한 이유

Kind 기반 dev 환경에는 Mimir와 Loki, Tempo가 모두 올라가 있습니다. Grafana 대시보드는 40개, 거기 담긴 쿼리는 674개입니다

`validate.sh`는 각 쿼리를 Mimir·Loki·Tempo API로 실제로 던져 보고 데이터가 돌아오는지 확인하는 스크립트입니다

정상이라면 대부분 PASS가 나오고, 몇 건 실패하더라도 이유가 분명해야 합니다

### 발견한 문제

전체를 돌려 본 결과는 기대와 달랐습니다

```text
351 PASS / 323 FAIL (실패율 48%)
```

절반 가까이가 실패하고 있었습니다. 하나씩 눌러 보는 방식으로는 감당이 안 되는 규모라, 실패를 원인별로 갈라내는 일부터 했습니다

---

## 🤔 원인: 여덟 갈래로 갈린 실패

실패 323건을 원인별로 묶으면 이렇습니다

| 카테고리 | 건수 | 요약 |
|---|---|---|
| traces_spanmetrics 데이터 없음 | 38 | Tempo metricsGenerator OFF |
| 인프라 메트릭 누락 | 47 | 일부 컴포넌트 미배포·미설정 |
| Redis 메트릭 전체 없음 | 17 | exporter 미설치 |
| LogQL false negative | 17 | 검증 시간 범위 1h가 너무 짧음 |
| Kafka consumer 메트릭 없음 | 15 | 브로커 CrashLoopBackOff |
| 구문 오류 | 16 | extract 스크립트 multi-line 파싱 + rate() range 누락 |
| http_server 특정 필터 | 10 | 해당 트래픽 없음 (정상) |
| 커스텀 비즈니스 메트릭 | 7 | 미구현 |

여기서 중요한 것은 건수보다 성격입니다. 여덟 갈래는 크게 세 종류로 갈립니다

메트릭이 애초에 안 들어오는 경우, 들어오는데 쿼리가 못 찾는 경우, 그리고 검증 도구 자체가 틀린 경우입니다. 고치는 방법이 전혀 다릅니다

**traces_spanmetrics 38건**은 Tempo의 metricsGenerator가 꺼져 있어서 span metrics가 만들어지지 않았습니다. 이걸 켜지 않으면 `traces_spanmetrics_*` 계열은 아예 존재하지 않습니다

**Redis 메트릭 17건**은 Redis Exporter를 설치하지 않아 수집 자체가 없었습니다. 대시보드만 있고 그 뒤에 데이터가 없는 상태였습니다

**LogQL 17건**은 로그가 실제로 있는데도 실패로 잡힌 경우입니다. 검증 범위를 1시간으로 잡아 둔 탓인데, dev 환경은 트래픽이 적어 한 시간 안에 특정 로그가 한 건도 없을 수 있습니다

**Kafka consumer 메트릭 15건**은 브로커가 CrashLoopBackOff라 수집이 멈춰 있었습니다

**구문 오류 16건**에는 두 가지가 섞여 있었습니다. extract 스크립트가 여러 줄에 걸친 쿼리를 제대로 못 읽어 중간이 잘린 경우, 그리고 PromQL `rate()`에 range vector를 안 넣어 파싱이 깨진 경우입니다

**http_server 필터 10건**은 고칠 것이 없습니다. 그 라우트로 들어온 트래픽이 없었을 뿐입니다

**커스텀 비즈니스 메트릭 7건**은 goti-server 코드에 아직 없는 메트릭이었습니다

---

## ✅ 해결: 대시보드 JSON 수정 + Validate 스크립트 개선 + 인프라 배포

세 축으로 나눠 고쳤습니다

### 1. 대시보드 JSON 버그 수정

**jvm-deep-dive.json의 start_time 메트릭 교체**

기존 쿼리는 `jvm_cpu_start_time_seconds`를 쓰고 있었는데, OTel Java Agent는 이 메트릭을 내보내지 않습니다

`process_start_time_seconds`도 마찬가지입니다. 이쪽은 Prometheus client library 전용이라 OTel Agent에서는 나올 수 없습니다

대신 kube-state-metrics가 주는 `kube_pod_start_time`을 썼습니다

```promql
# Before (OTel Java Agent에서 존재하지 않음)
jvm_cpu_start_time_seconds{...} > 0

# After (kube-state-metrics 기반)
kube_pod_start_time{namespace="goti", pod=~"$svc.*"}
```

`> 0` guard도 같이 뺐습니다. Pod가 있으면 `kube_pod_start_time` 값은 항상 양수라 걸러낼 것이 없습니다

**kafka-consumer.json의 rate() range 복원**

`rate()`에 range vector가 빠져 PromQL 파싱이 깨지고 있었습니다

```promql
# Before (range vector 누락 → 파싱 에러)
rate(kafka_server_brokertopicmetrics_messagesinpersec{...})

# After
rate(kafka_server_brokertopicmetrics_messagesinpersec{...}[$__rate_interval])
```

`$__rate_interval`은 Grafana가 대시보드 step에 맞춰 알아서 계산해 주는 변수입니다

### 2. Validate 스크립트 개선

**LogQL 검증 범위 1h → 6h**

dev 환경은 트래픽이 적습니다. 1시간으로는 로그가 없어서 실패로 잡히는 일이 잦아 6시간으로 늘렸습니다

실제로 Loki에는 goti 로그가 정상적으로 들어오고 있었고, 24시간 범위로 보면 5개 서비스 모두 로그를 확인할 수 있었습니다

**extract-queries.sh의 누락 변수 치환 5종 추가**

Grafana 대시보드 JSON에는 `$project`, `$app`, `$topic`, `$consumer_group`, `$match_id` 같은 템플릿 변수가 들어갑니다

검증 전에 이 변수를 치환하지 않으면 글자 그대로 남아 매칭이 실패합니다. 다섯 개의 치환 로직을 넣어 이 유형을 없앴습니다

### 3. 인프라 배포

**Redis Exporter 신규 배포**

`oliver006/redis_exporter:v1.67.0` 이미지로 Deployment와 Service, ServiceMonitor를 함께 올렸습니다. ServiceMonitor에는 `release: kube-prometheus-stack-dev` 라벨을 붙여 Operator가 알아서 잡도록 했습니다

```yaml
env:
  - name: REDIS_ADDR
    value: "redis://172.20.0.1:6379"
```

NetworkPolicy에는 redis-exporter가 `172.20.0.1:6379`로 나가는 egress를 열어 줬습니다

**Kafka NetworkPolicy egress 수정 / Tempo metricsGenerator 활성화**

이 둘은 각각 다른 트러블슈팅에서 이어진 항목입니다. Kafka 브로커의 CrashLoopBackOff는 NetworkPolicy egress를 열지 않은 것이 원인이었고, Tempo는 overrides에서 metricsGenerator를 켜자 span metrics 생성이 돌아왔습니다

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

jvm-deep-dive와 api-red-metrics는 실패 0건이 됐습니다

눈여겨볼 곳은 Redis입니다. Exporter를 하나 올리자 15건이 한꺼번에 살아났습니다. 대시보드 실패의 상당수가 쿼리 문제가 아니라 인프라 누락이었다는 뜻입니다

LogQL 6건은 아무것도 고치지 않았는데 통과했습니다. 검증 범위를 늘린 것만으로 해결됐으니, 애초에 실패가 아니었던 셈입니다

---

## 남은 이슈

아직 못 푼 항목이 네 종류 남았습니다

- **traces_spanmetrics 38건**: Tempo metricsGenerator에서 distributor와 generator ring 연결이 불안정합니다. 따로 파야 합니다
- **Kafka consumer 메트릭**: consumer group이 실제로 생기면 저절로 해소될 항목입니다
- **커스텀 비즈니스 메트릭 7건**: goti-server 코드에 메트릭을 넣어야 나옵니다
- **extract 구문 오류 16건**: 여러 줄 쿼리를 읽는 로직을 더 단단하게 만들어야 합니다

---

## 📚 배운 점

- **검증 시간 범위는 환경에 맞춰 잡는다**: dev처럼 트래픽이 적으면 1시간이 아니라 6시간 이상을 기본으로 둬야 없는 로그를 실패로 오해하지 않습니다
- **OTel과 Prometheus client library는 메트릭 이름 체계가 다르다**: `process_start_time_seconds`처럼 당연히 있을 것 같은 메트릭도 OTel Agent에는 없습니다. 대시보드를 만들 때는 수집기에 맞는 이름인지 먼저 확인해야 합니다
- **대시보드 검증은 인프라 점검을 겸한다**: Redis Exporter를 안 깔았다는 사실이 대시보드 실패 17건으로 드러났습니다. 674개 쿼리를 훑는 일은 관측 스택이 실제로 살아 있는지 거꾸로 확인하는 과정이기도 했습니다
- **`rate()`에 range vector가 빠지면 조용히 지나간다**: 대시보드는 겉보기에 그려지는데 값이 비거나 에러가 납니다. 사람 눈으로는 잘 안 걸리고 검증 스크립트로만 잡힙니다
- **변수 치환 누락은 검증 도구 자체의 버그다**: extract 단계에서 치환을 빠뜨리면 실제 쿼리가 아니라 글자만 검증하게 됩니다. 검증기가 틀리면 그 결과 전체를 믿을 수 없으니, 템플릿 변수 목록은 주기적으로 다시 봐야 합니다

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
