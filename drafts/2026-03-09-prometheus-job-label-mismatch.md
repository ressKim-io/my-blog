---
date: 2026-03-09
category: troubleshoot
project: Goti-monitoring
tags: [prometheus, otel, job-label, false-positive, alert, recording-rules, grafana]
---

# Prometheus job 레이블 불일치로 MetricsNotReceived false positive 발생 — goti-server → goti/goti-server

## Context
- Goti-monitoring 스택 (EC2, Docker Compose)
- goti-server가 OTel SDK로 메트릭을 Alloy → Prometheus로 push
- OTel 설정: `service.namespace=goti`, `service.name=goti-server`
- OTel-Prometheus 공식 스펙: `service.namespace`가 있으면 `job = <namespace>/<service.name>`

## Issue
`MetricsNotReceived` alert가 false positive로 firing 상태 지속.
recording rules (`goti:sli:availability:5m`, `goti:apdex:score` 등)도 데이터를 못 찾는 상태.

```
ALERTS{alertname="MetricsNotReceived", job="goti-server", severity="critical"} = 1 (firing)
goti:sli:availability:5m → result: []
```

재현 조건: goti-server가 정상 가동 중임에도 alert가 계속 firing.

## Action

### 1. 가설: job 레이블 불일치 → 결과: 확인됨
- Prometheus `label_values(job)` 조회 → 실제 job 레이블: `goti/goti-server`
- `jvm_memory_used_bytes{job="goti/goti-server"}` → 8개 시리즈 정상 수신 확인
- `jvm_memory_used_bytes{job="goti-server"}` → 데이터 없음
- OTel-Prometheus 스펙 확인: `service.namespace` 존재 시 `job = <namespace>/<service.name>` 매핑 (공식)

### 근본 원인 (Root Cause)
OTel `service.namespace=goti` 설정으로 인해 Prometheus `job` 레이블이 `goti/goti-server`로 매핑되지만,
alert rules, recording rules, Grafana 대시보드 기본값이 모두 `job="goti-server"`를 참조하고 있었음.
→ `absent_over_time(jvm_memory_used_bytes{job="goti-server"...})` → 항상 absent → false positive

### 적용한 수정
- `prometheus/rules/application.yml`: 5개 alert rule의 `job="goti-server"` → `job="goti/goti-server"` (12곳)
- `prometheus/rules/recording.yml`: 8개 recording rule의 job 셀렉터 수정 (16곳)
- Grafana 대시보드 5개: `service_name` 변수 기본값 `goti-server` → `goti/goti-server`
  - `developer/jvm-deep-dive.json`
  - `developer/api-red-metrics.json`
  - `developer/error-analysis.json`
  - `developer/distributed-tracing.json`
  - `business/ticketing-overview.json`
- `docs/spring-boot-integration.md`: 검증 쿼리 예시 수정

## Result

### 배포 및 검증
- GitHub Actions CI (`Deploy Monitoring Stack`) 자동 트리거 → S3 → SSM → EC2 배포 성공 (36s)
- **발견**: CI의 `deploy.sh`는 `docker compose up -d`만 수행 → 이미지 변경 없으면 컨테이너 미재생성
  - config 파일은 bind mount로 호스트에 갱신되었지만, Prometheus/Grafana 프로세스가 새 config을 읽지 못함
- **추가 발견**: Prometheus에 `--web.enable-lifecycle` 플래그 미설정 → `curl -X POST /-/reload` 불가
- 수동 조치: SSM으로 `docker restart goti-prometheus`, `docker restart goti-grafana` 실행
- 재시작 후 확인:
  - 컨테이너 내부 rules 파일: `job="goti/goti-server"` 정상 반영
  - `jvm_memory_used_bytes` → `job="goti/goti-server"`로 8개 시리즈 수신 중
  - stale ALERTS 시계열은 약 15분 후 자연 소멸 예상

### 회귀 테스트
- `grep -c 'job="goti-server"'` → Goti-monitoring 전체에서 0건 확인

### 재발 방지
1. MEMORY.md 업데이트: OTel → Prometheus 매핑 스펙 명확화 (`namespace 있으면 job = <ns>/<name>`)
2. **TODO**: `--web.enable-lifecycle` 플래그 추가 → config-only 변경 시 무중단 reload 가능하도록
3. **TODO**: `deploy.sh`에 Prometheus reload / Grafana provisioning reload 로직 추가 검토

## Related Files
- `Goti-monitoring/prometheus/rules/application.yml`
- `Goti-monitoring/prometheus/rules/recording.yml`
- `Goti-monitoring/grafana/dashboards/developer/jvm-deep-dive.json`
- `Goti-monitoring/grafana/dashboards/developer/api-red-metrics.json`
- `Goti-monitoring/grafana/dashboards/developer/error-analysis.json`
- `Goti-monitoring/grafana/dashboards/developer/distributed-tracing.json`
- `Goti-monitoring/grafana/dashboards/business/ticketing-overview.json`
- `Goti-monitoring/docs/spring-boot-integration.md`
- `Goti-monitoring/scripts/deploy.sh` (수정 없음, 문제 발견)
- `Goti-monitoring/docker/docker-compose.yml` (수정 없음, --web.enable-lifecycle 미설정 발견)
