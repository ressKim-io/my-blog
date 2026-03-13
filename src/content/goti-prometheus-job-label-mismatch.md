---
title: "Prometheus job 레이블에 namespace가 붙는다고?"
excerpt: "OTel service.namespace 설정으로 job 레이블이 goti/goti-server로 바뀌면서 alert가 false positive로 firing된 트러블슈팅"
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

> OTel에 `service.namespace`를 설정하면 Prometheus `job` 레이블이 `<namespace>/<service.name>` 형태로 바뀐다. 기존 rules와 대시보드가 모두 깨진다.

## 📊 Impact

- **영향 범위**: MetricsNotReceived alert false positive + recording rules 전체 No Data
- **소요 시간**: 약 3시간
- **발생일**: 2026-03-09

---

## 🔥 상황

Goti-monitoring 스택(EC2, Docker Compose)에서 `MetricsNotReceived` alert가 계속 firing되고 있었어요.

```
ALERTS{alertname="MetricsNotReceived", job="goti-server", severity="critical"} = 1 (firing)
```

goti-server는 정상 가동 중이었습니다.
메트릭도 잘 들어오고 있었어요.
그런데 alert는 "메트릭이 안 들어온다"고 계속 울리고 있었습니다.

Recording rules도 마찬가지였어요.

```
goti:sli:availability:5m → result: []
goti:apdex:score → result: []
```

전편에서 `service_name` → `job` 매핑을 수정한 직후였는데, 또 No Data가 발생한 거예요.

---

## 🤔 원인

### 가설: job 레이블 값이 달라졌다

Prometheus에서 실제 `job` 레이블 값을 조회해봤어요.

```promql
label_values(job)
```

결과에 `goti/goti-server`가 있었습니다.
`goti-server`가 아니라요.

확인을 위해 두 가지 쿼리를 비교했어요.

```promql
# 데이터 있음 (8개 시리즈)
jvm_memory_used_bytes{job="goti/goti-server"}

# 데이터 없음
jvm_memory_used_bytes{job="goti-server"}
```

### 근본 원인

OTel 설정에 `service.namespace=goti`가 있었어요.

```yaml
# OTel SDK 설정
service.namespace: goti
service.name: goti-server
```

OTel-Prometheus 호환성 스펙에 따르면:

> `service.namespace`가 존재하면 `job = <namespace>/<service.name>`

그래서 `job` 레이블이 `goti-server`가 아니라 `goti/goti-server`로 매핑된 겁니다.

전편에서 `service_name` → `job` 매핑은 수정했지만, `job`의 **값**이 `goti/goti-server`라는 걸 놓쳤어요.

문제의 흐름을 정리하면 이래요.

1. Alert rule: `absent_over_time(jvm_memory_used_bytes{job="goti-server"}[5m])`
2. 실제 메트릭: `jvm_memory_used_bytes{job="goti/goti-server"}`
3. `job="goti-server"`로는 매칭되는 시리즈가 없음
4. `absent_over_time()` → 항상 absent → alert firing

메트릭이 잘 수집되고 있어도, job 레이블 값이 다르니 "메트릭 없음"으로 판단한 것이다.

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

- `prometheus/rules/application.yml`: 5개 alert rule, 12곳 수정
- `prometheus/rules/recording.yml`: 8개 recording rule, 16곳 수정

### 2. Grafana 대시보드 수정

5개 대시보드의 `service_name` 변수 기본값을 변경했어요.

```
goti-server → goti/goti-server
```

수정한 대시보드:
- `developer/jvm-deep-dive.json`
- `developer/api-red-metrics.json`
- `developer/error-analysis.json`
- `developer/distributed-tracing.json`
- `business/ticketing-overview.json`

### 3. EC2 배포 및 추가 발견

GitHub Actions CI가 S3 → SSM → EC2로 배포를 완료했어요(36초).

그런데 여기서 추가 문제를 발견했습니다.

CI의 `deploy.sh`는 `docker compose up -d`만 수행해요.
이미지가 변경되지 않으면 컨테이너를 재생성하지 않습니다.

config 파일은 bind mount로 호스트에 갱신되었지만, Prometheus와 Grafana 프로세스가 새 config을 읽지 못했어요.

게다가 Prometheus에 `--web.enable-lifecycle` 플래그가 설정되어 있지 않아서, `curl -X POST /-/reload`로 무중단 reload도 불가능했습니다.

결국 SSM으로 수동 재시작했어요.

```bash
$ docker restart goti-prometheus
$ docker restart goti-grafana
```

재시작 후 확인 결과:
- rules 파일에 `job="goti/goti-server"` 정상 반영
- `jvm_memory_used_bytes` → 8개 시리즈 수신 중
- stale alert는 약 15분 후 자연 소멸

### 회귀 확인

```bash
$ grep -c 'job="goti-server"' prometheus/rules/*.yml grafana/dashboards/**/*.json
# 전체 0건 — goti/goti-server로 통일 완료
```

---

## 📚 배운 점

### OTel service.namespace의 영향

`service.namespace`를 설정하면 Prometheus `job` 레이블 형식이 바뀌어요.

| OTel 설정 | Prometheus job 레이블 |
|-----------|---------------------|
| `service.name=goti-server` (namespace 없음) | `goti-server` |
| `service.namespace=goti` + `service.name=goti-server` | `goti/goti-server` |

이 매핑 규칙을 모르면, recording rules, alert rules, 대시보드가 **모두** 깨집니다.

### config 변경 시 컨테이너 재시작 문제

Docker Compose 환경에서 config 파일만 변경했을 때:

1. `docker compose up -d`는 이미지 변경이 없으면 컨테이너를 재생성하지 않음
2. bind mount로 파일은 갱신되지만, 프로세스가 자동으로 다시 읽지 않음
3. Prometheus `--web.enable-lifecycle` 플래그가 없으면 API reload도 불가

**후속 작업으로 `--web.enable-lifecycle` 플래그 추가와 `deploy.sh` 개선이 필요하다.**

### 시리즈 교훈

이 시리즈의 두 번째, 세 번째 글을 통해 느낀 건, OTel → Prometheus 레이블 매핑은 **한 번에 잡기 어렵다**는 거예요.

1. 먼저 `service_name`이 아니라 `job`이라는 걸 알아야 하고 (2편)
2. 그다음 `service.namespace` 때문에 `job` 값이 바뀐다는 것도 알아야 합니다 (이 글)

결국 스펙 문서를 꼼꼼히 읽는 것보다, **실제 메트릭 덤프로 검증**하는 게 가장 확실하다.
