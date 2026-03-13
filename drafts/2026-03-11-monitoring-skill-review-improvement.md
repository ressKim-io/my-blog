---
date: 2026-03-11
category: meta
project: goti-team-controller
tags: [skill, review-pr, monitoring, observability, improvement]
---

# 모니터링 스킬 보강 + 영역별 리뷰 커맨드 신설

## Context

트러블슈팅 로그 7건(이슈 13개)을 분석한 결과, 모니터링 영역에서 반복된 문제의 근본 원인 2가지 확인:
1. **스킬 파일의 지식 갭** — OTel→Prometheus 매핑 스펙, 버전 변경사항, 환경 간 설정 정합성 가이드 부재
2. **리뷰 구조의 한계** — `/review-pr`이 범용 종합 리뷰 1개뿐, 모니터링 전문 체크 항목 없음

## 분석한 트러블슈팅 로그 (7건, 이슈 13개)

모든 로그를 분석하여 스킬/리뷰에 반영 완료. **향후 동일 범위 재분석 불필요.**

| # | 로그 파일 | 이슈 | 반영 대상 |
|---|----------|------|----------|
| 1 | `2026-02-28-otel-sdk-version-conflict.md` | OTel SDK ↔ Spring Boot BOM 충돌 | `observability-otel.md` Anti-Patterns |
| 2 | `2026-02-28-postgres-healthcheck-env-mismatch.md` | docker-compose 환경변수 불일치 | `docker.md` healthcheck 섹션 |
| 3 | `2026-03-01-cd-ssm-waiter-timeout.md` | SSM waiter 기본 timeout 부족 | `monitoring-troubleshoot.md` CD 파이프라인 대기 |
| 4 | `2026-03-02-grafana-csrf-origin-not-allowed.md` | Reverse proxy 뒤 CSRF Origin 에러 | `monitoring-grafana.md` Reverse Proxy 보안 |
| 5 | `2026-03-02-network-label-conflict-and-loki-healthcheck.md` | Docker 네트워크 라벨 충돌 + Loki HEAD healthcheck | `docker.md` 네트워크/healthcheck |
| 6 | `2026-03-06-otel-label-mismatch.md` | service.namespace→job 매핑 불일치 | `monitoring-metrics.md` 레이블 매핑 스펙 |
| 7 | `2026-03-09-monitoring-dashboard-nodata-comprehensive.md` | 종합 5건 (job 레이블, HikariCP, Apdex, Alloy, GC format) | 다수 스킬에 분산 반영 |

### 종합 5건 세부 (로그 #7)

| 서브이슈 | 반영 파일 |
|---------|----------|
| Prometheus job 레이블 `namespace/name` 형식 | `monitoring-metrics.md` 매핑 스펙 |
| HikariCP `_milliseconds` suffix | `observability-otel-optimization.md` HikariCP 섹션 |
| Apdex `le="2.0"` 부재 → `le="2.5"` | `monitoring-metrics.md` 히스토그램 버킷 |
| Alloy `loki.attribute.labels` 미작동 | `observability-otel-optimization.md` Alloy known issues |
| GC legendFormat OTel vs Micrometer 차이 | `review-pr-monitoring.md` Agent 3 체크 항목 |

## 수정/생성한 파일 (8개)

### Phase 1: 스킬 보강 (6개 파일 수정)

| 파일 | 추가 내용 | 줄수 |
|------|----------|------|
| `monitoring-metrics.md` | OTel→Prometheus 레이블 매핑 스펙, 기본 히스토그램 버킷, recording rule 패턴(`or on() vector(0)`), suffix 규칙 | +90 |
| `monitoring-grafana.md` | Cross-datasource 변수 전략 (`$service_name` + `$svc`), reverse proxy CSRF 설정, file provisioning `updateIntervalSeconds` | +88 |
| `observability-otel.md` | Semantic conventions 변경 추적, resource→Prometheus 매핑 다이어그램, Anti-Patterns 5개 | +56 |
| `observability-otel-optimization.md` | Alloy `loki.attribute.labels` known issue + `loki.process` 대안, HikariCP OTel 메트릭 | +74 |
| `docker.md` | 포트 바인딩 가이드 (127.0.0.1 vs 0.0.0.0), healthcheck HEAD vs GET, 네트워크 `external:true` vs `name:+driver:` | +58 |
| `monitoring-troubleshoot.md` | Healthcheck 프로토콜 문제, ALB 타겟 헬스 검증, CD 파이프라인 polling 루프 패턴 | +69 |

### Phase 2: 리뷰 커맨드 (2개 파일)

| 파일 | 작업 | 내용 |
|------|------|------|
| `review-pr-monitoring.md` | **신규** | 3에이전트 병렬 모니터링 전문 리뷰 (OTel 정합성 / 환경 동기화 / Grafana 검증) |
| `review-pr.md` | 수정 | 영역 자동 감지(Auto-Routing) 로직 추가 (monitoring/k8s/server 패턴 감지) |

## 아직 미반영 / 향후 작업

| 항목 | 상태 | 비고 |
|------|------|------|
| `/review-pr:k8s` 전문 리뷰 | 미생성 | K8s 트러블슈팅 로그 분석 후 진행 |
| `/review-pr:server` 전문 리뷰 | 미생성 | 서버 트러블슈팅 로그 분석 후 진행 |
| review-gaps.md PR #11~#19 반영 | 완료 | `/review-pr` 학습 체크에 이미 반영 (2026-03-03) |
| `http.route` OTel 미지원 | TODO | Spring Boot OTel 별도 설정 필요 (follow-up) |
| Alloy CI/CD 재시작 | TODO | docker-compose 수정 필요 |

## Related Files
- `docs/review-gaps.md` — Gemini 갭 누적 기록 (PR #11~#19, 12건)
- `docs/dev-logs/2026-03-03-review-pr-gap-learning.md` — 1차 리뷰 개선 기록
- `.claude/commands/review-pr.md` — 범용 리뷰 + 자동 라우팅
- `.claude/commands/review-pr-monitoring.md` — 모니터링 전문 리뷰
