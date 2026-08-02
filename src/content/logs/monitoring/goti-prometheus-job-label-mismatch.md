---
title: "정상 서비스에 알림이 울렸다 — job 레이블 스키마 변경이 만든 false positive"
excerpt: "OTel에 service.namespace를 넣자 Prometheus job 레이블이 goti/goti-server 형태로 바뀌었습니다. 서비스는 멀쩡한데 MetricsNotReceived가 critical로 발화하고 recording rule은 전부 No Data가 된 원인을 추적한 기록입니다"
category: monitoring
tags:
  - go-ti
  - Prometheus
  - OpenTelemetry
  - Grafana
  - Alert
  - Troubleshooting
series:
  name: "goti-otel-prometheus"
  order: 3
date: "2026-03-09"
---

## 🎯 한 줄 요약

> OTel에 `service.namespace`를 설정하면 Prometheus `job` 레이블이 `<namespace>/<service.name>` 형태로 바뀝니다. 셀렉터는 옛 이름을 그대로 가리키고 있어 rules와 대시보드가 전부 깨졌고, 서비스는 정상인데 `MetricsNotReceived`가 critical로 발화했습니다

## 📊 Impact

- **영향 범위**: MetricsNotReceived alert false positive + recording rules 전체 No Data
- **소요 시간**: 약 3시간
- **발생일**: 2026-03-09

---

## 🔥 상황

Goti-monitoring 스택(EC2, Docker Compose)에서 `MetricsNotReceived` alert가 계속 울리고 있었습니다

```text
ALERTS{alertname="MetricsNotReceived", job="goti-server", severity="critical"} = 1 (firing)
```

goti-server는 정상이었습니다. 메트릭도 잘 들어오고 있었습니다

그런데 알림은 메트릭이 안 들어온다며 계속 울렸습니다

Recording rules도 비어 있었습니다

- `goti:sli:availability:5m` → `result: []`
- `goti:apdex:score` → `result: []`

전편에서 `service_name`을 `job`으로 바꾸는 매핑을 손본 직후였는데, 또 No Data가 났습니다

여기서 문제의 성격이 갈립니다. 데이터가 없는 게 아니라 **찾지 못하는 것**이라면 원인이 완전히 다릅니다

---

## 🤔 원인

### 가설: job 레이블 값이 달라졌다

Prometheus에서 실제 `job` 레이블 값을 뽑아 봤습니다

```promql
label_values(job)
```

결과에 `goti/goti-server`가 있었습니다. `goti-server`가 아니었습니다

두 쿼리를 나란히 놓고 확인했습니다

```promql
# 데이터 있음 (8개 시리즈)
jvm_memory_used_bytes{job="goti/goti-server"}

# 데이터 없음
jvm_memory_used_bytes{job="goti-server"}
```

### 근본 원인

OTel 설정에 `service.namespace=goti`가 들어 있었습니다

```yaml
# OTel SDK 설정
service.namespace: goti
service.name: goti-server
```

OTel과 Prometheus 호환성 스펙은 이렇게 정합니다

> `service.namespace`가 있으면 `job = <namespace>/<service.name>`

그래서 `job`이 `goti-server`가 아니라 `goti/goti-server`가 됐습니다

전편에서 `service_name`을 `job`으로 바꾸는 것까지는 맞췄는데, `job`의 **값**까지 바뀐다는 것은 놓쳤습니다

흐름을 정리하면 이렇습니다

1. Alert rule은 `absent_over_time(jvm_memory_used_bytes{job="goti-server"}[5m])`을 봅니다
2. 실제 메트릭은 `jvm_memory_used_bytes{job="goti/goti-server"}`로 들어옵니다
3. `job="goti-server"`로는 걸리는 시리즈가 없습니다
4. `absent_over_time()`이 항상 참이 되어 알림이 계속 울립니다

메트릭은 멀쩡히 쌓이는데 셀렉터가 다른 곳을 보고 있으니, 시스템 입장에서는 정말로 없는 것과 구분되지 않습니다

---

## ✅ 해결

### 1. Prometheus Rules 수정

```yaml
# Before
- alert: MetricsNotReceived
  expr: absent_over_time(jvm_memory_used_bytes{job="goti-server"}[5m])

# After
- alert: MetricsNotReceived
  expr: absent_over_time(jvm_memory_used_bytes{job="goti/goti-server"}[5m])
```

- `prometheus/rules/application.yml`: alert rule 5개, 12곳 수정
- `prometheus/rules/recording.yml`: recording rule 8개, 16곳 수정

### 2. Grafana 대시보드 수정

대시보드 5개의 `service_name` 변수 기본값을 `goti-server`에서 `goti/goti-server`로 바꿨습니다

- `developer/jvm-deep-dive.json`
- `developer/api-red-metrics.json`
- `developer/error-analysis.json`
- `developer/distributed-tracing.json`
- `business/ticketing-overview.json`

### 3. EC2 배포에서 나온 별건

GitHub Actions CI가 S3와 SSM을 거쳐 36초 만에 배포를 마쳤습니다

그런데 반영이 안 됐습니다

CI의 `deploy.sh`는 `docker compose up -d`만 돌립니다. 이미지가 그대로면 컨테이너를 다시 만들지 않습니다

config 파일은 bind mount라 호스트에서 갱신됐지만, Prometheus와 Grafana 프로세스는 새 config을 읽지 않았습니다

게다가 Prometheus에 `--web.enable-lifecycle`이 없어 `curl -X POST /-/reload`로 무중단 reload도 못 했습니다

결국 SSM으로 직접 재시작했습니다

```bash
docker restart goti-prometheus
docker restart goti-grafana
```

재시작 뒤 확인한 내용입니다

- rules 파일에 `job="goti/goti-server"`가 정상 반영됐습니다
- `jvm_memory_used_bytes`가 8개 시리즈로 들어왔습니다
- 남아 있던 알림은 약 15분 뒤 저절로 사라졌습니다

### 회귀 확인

```bash
grep -c 'job="goti-server"' prometheus/rules/*.yml grafana/dashboards/**/*.json
# 전체 0건 — goti/goti-server로 통일 완료
```

---

## 📚 배운 점

### service.namespace 하나가 레이블 스키마를 바꾼다

`service.namespace`를 설정하면 Prometheus `job` 레이블의 형식 자체가 달라집니다

| OTel 설정 | Prometheus job 레이블 |
|-----------|---------------------|
| `service.name=goti-server` (namespace 없음) | `goti-server` |
| `service.namespace=goti` + `service.name=goti-server` | `goti/goti-server` |

이 규칙을 모르면 recording rules와 alert rules, 대시보드가 한꺼번에 깨집니다. 어느 하나가 아니라 셀렉터를 쓰는 모든 곳이 대상입니다

### 거짓 알림은 침묵보다 오래 남는다

메트릭이 안 오는 것보다 나쁜 상황이 있습니다. 정상인데 계속 울리는 알림입니다

한두 번은 확인하지만 반복되면 사람이 먼저 무뎌집니다. 그러다 진짜 장애가 왔을 때 같은 알림을 또 무시하게 됩니다

알림 규칙을 고칠 때 셀렉터가 실제 데이터와 맞는지 확인하는 절차가 필요한 이유입니다

### config만 바꾸면 컨테이너는 모른다

Docker Compose에서 config 파일만 손댔을 때 걸리는 지점이 셋입니다

1. `docker compose up -d`는 이미지가 그대로면 컨테이너를 다시 만들지 않습니다
2. bind mount로 파일은 갱신되지만 프로세스가 알아서 다시 읽지는 않습니다
3. Prometheus에 `--web.enable-lifecycle`이 없으면 API로 reload할 수도 없습니다

후속으로 `--web.enable-lifecycle` 추가와 `deploy.sh` 개선이 필요합니다

### 스펙보다 실제 덤프

이 시리즈 두 번째와 세 번째 글을 쓰면서 느낀 것은, OTel에서 Prometheus로 넘어가는 레이블 매핑을 한 번에 맞히기 어렵다는 점입니다

먼저 `service_name`이 아니라 `job`이라는 걸 알아야 하고(2편), 그다음 `service.namespace` 때문에 `job` 값까지 바뀐다는 걸 알아야 합니다(이 글)

스펙 문서를 꼼꼼히 읽는 것보다 `label_values(job)`을 한 번 찍어 보는 편이 빠르고 확실했습니다
