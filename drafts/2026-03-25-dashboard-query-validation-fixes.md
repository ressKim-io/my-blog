---
date: 2026-03-25
category: troubleshoot
project: Goti-monitoring, Goti-k8s
tags: [grafana, dashboard, promql, logql, validate, jvm, kafka, redis-exporter, otel]
---

# 대시보드 쿼리 검증 — 40개 대시보드 전수 점검 및 버그 수정

## Context
Kind dev 환경에서 `Goti-k8s/scripts/validate/validate.sh` 전체 검증 실행.
40개 대시보드 674개 쿼리 대상. Mimir/Loki/Tempo API로 실제 쿼리 실행하여 데이터 반환 여부 검증.

## Issue

초기 결과: **351 PASS / 323 FAIL (48% 실패율)**

주요 실패 카테고리:
- traces_spanmetrics 데이터 없음 (38건) — Tempo metricsGenerator OFF
- 인프라 메트릭 (47건) — 일부 컴포넌트 미배포/미설정
- Redis 메트릭 전체 없음 (17건) — exporter 미설치
- LogQL false negative (17건) — 검증 시간 범위 1h 너무 짧음
- Kafka consumer 메트릭 없음 (15건) — 브로커 CrashLoopBackOff
- 구문 오류 (16건) — extract 스크립트 multi-line 파싱 + rate() range 누락
- http_server 특정 필터 (10건) — 해당 트래픽 없음 (정상)
- 커스텀 비즈니스 메트릭 미구현 (7건)

## Action

### 대시보드 JSON 버그 수정 (Goti-monitoring)

1. **jvm-deep-dive.json**: `jvm_cpu_start_time_seconds` → `kube_pod_start_time`
   - OTel Java Agent는 `process_start_time_seconds` 미노출 (Prometheus client library 전용)
   - `kube_pod_start_time{namespace="goti", pod=~"$svc.*"}` — kube-state-metrics 제공
   - `> 0` guard도 제거 (불필요)

2. **kafka-consumer.json**: `rate()` range vector 누락
   - `rate(kafka_server_brokertopicmetrics_messagesinpersec{...})` → `rate(...[$__rate_interval])`
   - PromQL 파싱 에러 → 구문 수정

### Validate 스크립트 개선 (Goti-k8s)

3. **validate-queries.sh**: LogQL 검증 범위 1h → 6h
   - Dev 환경은 트래픽 적어 1시간 내 로그 없을 수 있음
   - Loki에 실제 goti 로그는 정상 수집 중 (24h 기준 5서비스 모두 확인)

4. **extract-queries.sh**: 누락 변수 치환 5종 추가
   - `$project`, `$app`, `$topic`, `$consumer_group`, `$match_id`
   - 미치환 시 literal string으로 남아 매칭 실패

### 인프라 배포 (Goti-k8s)

5. **Redis Exporter** 신규 배포
   - oliver006/redis_exporter:v1.67.0, `REDIS_ADDR=redis://172.20.0.1:6379`
   - Deployment + Service + ServiceMonitor (`release: kube-prometheus-stack-dev`)
   - NetworkPolicy: redis-exporter → 172.20.0.1:6379 egress 허용

6. **Kafka NetworkPolicy** egress 수정 — 별도 트러블슈팅 로그 참조

7. **Tempo metricsGenerator** 활성화 — 별도 트러블슈팅 로그 참조

## Result

**351/323 → 380/294 (+29 PASS, -29 FAIL)**

| 항목 | Before | After | 비고 |
|------|--------|-------|------|
| jvm-deep-dive | 20/1 | 21/0 | 완전 정상 |
| api-red-metrics | 21/1 | 22/0 | 완전 정상 |
| Redis 메트릭 | 0 PASS | +15 PASS | redis_up=1, 정상 수집 |
| Kafka 브로커 | CrashLoopBackOff | 3/3 Running | 정상화 |
| LogQL | 6건 실패 | 전부 PASS | 6h 확대 효과 |

**남은 이슈**:
- traces_spanmetrics 38건 — Tempo metricsGenerator distributor→generator ring 연결 (별도 조사)
- Kafka consumer 메트릭 — consumer group 생성 후 자동 해소
- 커스텀 비즈니스 메트릭 7건 — goti-server 코드 구현 필요
- extract 구문 오류 16건 — multi-line 쿼리 파싱 개선

## Related Files
- `Goti-monitoring/grafana/dashboards/developer/jvm-deep-dive.json`
- `Goti-monitoring/grafana/dashboards/developer/kafka-consumer.json`
- `Goti-monitoring/charts/goti-monitoring/dashboards/developer/` (SSOT 동기화)
- `Goti-monitoring/values-stacks/dev/tempo-values.yaml`
- `Goti-k8s/scripts/validate/validate-queries.sh`
- `Goti-k8s/scripts/validate/extract-queries.sh`
- `Goti-k8s/infrastructure/dev/redis-exporter/` (신규)
- `Goti-k8s/infrastructure/dev/network-policies/kafka-netpol.yaml`
- `Goti-k8s/infrastructure/dev/network-policies/monitoring-netpol.yaml`
- `docs/monitoring/2026-03-24-dashboard-query-validation.md` (갭 분석 문서)
