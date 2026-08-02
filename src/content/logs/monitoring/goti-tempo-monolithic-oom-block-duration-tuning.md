---
title: "Tempo OOM 115회 — monolithic mode의 메모리 경합과 block duration"
excerpt: "메트릭을 복구하고 나니 이번에는 트레이스가 사라져 있었습니다. 단일 프로세스에서 ingester와 compactor, metrics-generator가 메모리를 나눠 쓰는 monolithic 구조의 한계를 확인하고 block duration 축소로 대응한 기록입니다"
category: monitoring
tags:
  - go-ti
  - Tempo
  - OOM
  - Observability
  - Performance-Tuning
  - Troubleshooting
series:
  name: "goti-observability-ops"
  order: 12
date: "2026-03-24"
---

## 한 줄 요약

> Tempo가 2Gi 한계에서 115회 재시작하며 트레이스 조회가 전면 중단됐습니다. monolithic mode에서 ingester·compactor·metrics-generator가 메모리를 공유하는 구조가 원인이었고, `max_block_duration`을 30분에서 5분으로 줄이는 것이 가장 큰 효과를 냈습니다

---

## 🔥 문제: 메트릭을 살리자 이번에는 트레이스가 사라짐

### 증상

Mimir를 복구해 메트릭이 다시 들어오기 시작했는데, Error Tracking 대시보드에서 Grafana가 502 Bad Gateway를 냈습니다. Tempo Pod를 확인하니 115회 재시작 상태였습니다

```text
Last State: Terminated
  Reason: OOMKilled
  Exit Code: 137
  Restart Count: 115
  Limits: memory=2Gi
```

Grafana에서는 연결 자체가 실패하고 있었습니다

```text
Get "http://tempo-dev.monitoring.svc:3200/api/search?...":
dial tcp 10.96.64.214:3200: connect: connection refused
```

---

## 🤔 원인: monolithic mode의 메모리 경합 + 불필요한 기능 활성화

Tempo는 monolithic mode로 운영 중이라 ingester, compactor, querier, metrics-generator가 **단일 프로세스에서 메모리를 공유**합니다. 여기에 세 가지 요인이 겹쳐 있었습니다

- `metricsGenerator: true` — span metrics와 service graph 생성에 200~500MB 소비
- `max_block_duration` 기본값 30분 — ingester가 30분간 트레이스를 인메모리로 유지
- Grafana의 트레이스 검색 부하가 같은 프로세스에 동시 인가

세 요인이 각각은 감당 가능한 크기였지만, 컴포넌트가 분리돼 있지 않아 서로의 피크가 겹치는 순간 2Gi를 넘겼습니다

---

## ✅ 해결

**1. 설정 최적화로 메모리 사용량을 먼저 줄였습니다**

```yaml
# tempo-values.yaml
metricsGenerator:
  enabled: false              # dev 환경에서 비활성화, 200~500MB 절감

ingester:
  max_block_duration: 5m      # 30m → 5m, 메모리 약 50% 절감
  trace_idle_period: 10s
  flush_check_period: 10s
```

**2. 메모리 상향** — 최적화 후에도 OOM이 남아 2Gi에서 3Gi로 올렸습니다

정리 과정에서 만난 `overrides.legacyConfig` 파싱 에러는 [별도 글](/logs/goti-tempo-overrides-legacyconfig-parsing-error/)에 따로 정리했습니다

결과적으로 Tempo가 1/1 Running, 0 restart로 안정화되었고 Error Tracking 대시보드와 트레이스 검색이 정상 동작하게 되었습니다

---

## 외부 조사 결과 요약

| 항목 | 내용 |
|------|------|
| Monolithic 권장 범위 | 일 50GB 미만, 서비스 20개 미만 |
| 가장 효과적인 메모리 절감 | `max_block_duration` 축소 (30m→5m: 약 50%) |
| metrics_generator OFF 효과 | 200~500MB 절감 |
| tail sampling 효과 | 볼륨 60~90% 감소 |
| 트레이스 보관 업계 표준 | 7일 (메트릭 90일, 로그 30일) |
| HA 전환 경로 | monolithic → tempo-distributed + S3/MinIO |
| 데이터 마이그레이션 | 불필요 (동일 스토리지 포맷) |

조사에서 가장 중요한 발견은 **monolithic mode의 한계가 생각보다 낮다**는 점이었습니다. 일 50GB 이상이거나 서비스가 20개를 넘을 예정이라면 처음부터 distributed 구성을 고려해야 합니다

또한 `max_block_duration` 축소가 `metricsGenerator` 비활성화보다 효과가 크다는 수치는 이후 튜닝의 기준이 되었습니다

---

## 📚 교훈

**monolithic은 "작아서 안전한" 구성이 아닙니다.** 컴포넌트가 분리돼 있지 않으면 각 컴포넌트의 메모리 피크가 서로를 밀어냅니다. 부하가 커질수록 어느 컴포넌트가 범인인지 분리조차 어려워집니다

**메모리 상향은 마지막 수단입니다.** 이번에도 상향 전에 체류 시간을 먼저 줄였고, 그것이 효과의 대부분을 차지했습니다. limit을 올려 OOM을 피한 것은 우회이지 해결이 아닙니다

**유입 자체를 줄이는 방법이 남아 있었습니다.** 이 시점에서는 설정 튜닝으로 버텼지만, 근본 대응은 tail sampling과 버퍼 도입이었습니다. 그 작업은 [Tempo OOM 85회 기록](/logs/goti-tempo-oom-kafka-buffer-sampling/)으로 이어집니다

### 관련 파일

- `Goti-monitoring/values-stacks/dev/tempo-values.yaml` — metricsGenerator OFF, ingester 5m flush, memory 3Gi
