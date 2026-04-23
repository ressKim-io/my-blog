---
title: "모니터링 스킬 보강 + /review-pr:monitoring 영역별 전문 리뷰 신설"
excerpt: "트러블슈팅 7건·이슈 13개를 분석해 모니터링 도메인 스킬 6개를 확장하고, OTel 정합성/환경 동기화/Grafana 검증 3에이전트 병렬 구조의 모니터링 전문 리뷰 커맨드를 신설했습니다."
category: monitoring
tags:
  - go-ti
  - Meta
  - Monitoring
  - OpenTelemetry
  - Prometheus
  - Grafana
  - Code-Review
  - Skill
series:
  name: "goti-meta"
  order: 4
date: "2026-03-11"
---

## 한 줄 요약

> 모니터링 영역에서 반복된 트러블 13개를 분석한 결과, **스킬 지식 갭**과 **리뷰 구조 한계** 두 가지가 근본 원인이었습니다. 6개 스킬을 보강하고 3에이전트 병렬 구조의 `/review-pr:monitoring` 전문 리뷰를 신설해 자동 라우팅으로 연결했습니다

---

## 🔥 문제: 모니터링 영역에서 같은 실수가 반복됐다

트러블슈팅 로그 7건에 걸쳐 총 13개 이슈가 누적되었습니다
개별 사례로는 서로 다른 버그처럼 보였지만, 묶어서 보니 두 가지 근본 원인이 드러났습니다

1. **스킬 파일의 지식 갭** — OTel → Prometheus 레이블 매핑 스펙, 버전 변경 사항, 환경 간 설정 정합성 가이드가 비어 있었습니다
2. **리뷰 구조의 한계** — `/review-pr`이 범용 종합 리뷰 하나뿐이었고, 모니터링 전문 체크 항목이 없었습니다

### 분석한 트러블슈팅 로그 7건 (이슈 13개)

| # | 로그 | 이슈 | 반영 대상 |
|---|------|------|----------|
| 1 | `otel-sdk-version-conflict` | OTel SDK ↔ Spring Boot BOM 충돌 | `observability-otel.md` Anti-Patterns |
| 2 | `postgres-healthcheck-env-mismatch` | docker-compose 환경변수 불일치 | `docker.md` 헬스체크 섹션 |
| 3 | `cd-ssm-waiter-timeout` | SSM waiter 기본 타임아웃 부족 | `monitoring-troubleshoot.md` CD 대기 패턴 |
| 4 | `grafana-csrf-origin-not-allowed` | 리버스 프록시 뒤 CSRF Origin 에러 | `monitoring-grafana.md` 리버스 프록시 보안 |
| 5 | `network-label-conflict-and-loki-healthcheck` | Docker 네트워크 라벨 충돌 + Loki HEAD 헬스체크 | `docker.md` 네트워크/헬스체크 |
| 6 | `otel-label-mismatch` | `service.namespace` → `job` 매핑 불일치 | `monitoring-metrics.md` 레이블 매핑 스펙 |
| 7 | `monitoring-dashboard-nodata-comprehensive` | 종합 5건 (job 레이블, HikariCP, Apdex, Alloy, GC format) | 다수 스킬에 분산 반영 |

7번 로그의 세부 5건은 다음과 같습니다

| 서브이슈 | 반영 파일 |
|---------|----------|
| Prometheus `job` 레이블이 `namespace/name` 형식 | `monitoring-metrics.md` 매핑 스펙 |
| HikariCP `_milliseconds` suffix | `observability-otel-optimization.md` HikariCP 섹션 |
| Apdex 버킷에 `le="2.0"` 부재 → `le="2.5"`로 수정 | `monitoring-metrics.md` 히스토그램 버킷 |
| Alloy `loki.attribute.labels` 미작동 | `observability-otel-optimization.md` Alloy known issues |
| GC legendFormat OTel vs Micrometer 차이 | `review-pr-monitoring.md` Agent 3 체크 |

---

## 🤔 원인: 모니터링 전용 구조가 없었다

**스킬 쪽**에서는 OTel의 semantic conventions 변경을 추적하는 단일 소스가 없었습니다
`service.namespace` → `job` 매핑이나 Prometheus suffix 규칙처럼 "정답이 있는 스펙"이 스킬에 들어 있지 않으면, 대시보드가 빈 상태(no data)로 올라가도 원인을 찾는 데 긴 시간이 걸립니다

**리뷰 쪽**에서는 모니터링 PR을 범용 `/review-pr`로 봤기 때문에 OTel 정합성, 환경 동기화, Grafana 변수 충돌 같은 도메인 특화 체크가 묻혀 있었습니다

---

## ✅ 해결: Phase 1 스킬 보강 + Phase 2 전문 리뷰 신설

### Phase 1: 스킬 6개 보강

| 파일 | 추가 내용 | 증분 |
|------|----------|-----|
| `monitoring-metrics.md` | OTel → Prometheus 레이블 매핑 스펙, 기본 히스토그램 버킷, recording rule 패턴(`or on() vector(0)`), suffix 규칙 | +90줄 |
| `monitoring-grafana.md` | Cross-datasource 변수 전략(`$service_name` + `$svc`), 리버스 프록시 CSRF 설정, file provisioning `updateIntervalSeconds` | +88줄 |
| `observability-otel.md` | Semantic conventions 변경 추적, resource → Prometheus 매핑 다이어그램, Anti-Patterns 5개 | +56줄 |
| `observability-otel-optimization.md` | Alloy `loki.attribute.labels` known issue + `loki.process` 대안, HikariCP OTel 메트릭 | +74줄 |
| `docker.md` | 포트 바인딩 가이드(127.0.0.1 vs 0.0.0.0), 헬스체크 HEAD vs GET, 네트워크 `external:true` vs `name:+driver:` | +58줄 |
| `monitoring-troubleshoot.md` | 헬스체크 프로토콜 문제, ALB 타겟 헬스 검증, CD 파이프라인 polling 루프 패턴 | +69줄 |

### Phase 2: 리뷰 커맨드 2개

| 파일 | 작업 | 내용 |
|------|------|------|
| `review-pr-monitoring.md` | **신규** | 3에이전트 병렬 — OTel 정합성 / 환경 동기화 / Grafana 검증 |
| `review-pr.md` | 수정 | Auto-Routing — monitoring/k8s/server 패턴 감지 로직 |

3에이전트 병렬 구조로 나눈 이유는 다음과 같습니다

- **Agent 1 OTel 정합성**: SDK 버전, BOM, semantic conventions, Prometheus 매핑 규칙이 한 PR 안에서 일관되는지
- **Agent 2 환경 동기화**: docker-compose ↔ application.yml ↔ Helm values 3곳이 어긋나지 않는지
- **Agent 3 Grafana 검증**: 변수, 쿼리 legendFormat, panel datasource가 최신 레이블 스펙을 따르는지

한 에이전트가 모든 축을 동시에 보려 하면 깊이가 떨어집니다
병렬로 나누면 각 축이 구체 체크 항목을 가진 채 독립적으로 평가를 수행합니다

---

## 📚 배운 점

- **"분산 반영"은 필수 작업입니다.** 종합 트러블 한 건이 5개 서브이슈를 갖는 경우, 각 서브이슈를 올바른 스킬 파일에 따로 꽂아 넣지 않으면 다음 세션에서 참조되지 않습니다
- **"매핑 스펙"은 블로그 수준 문서가 아닌 스킬 본문에 둬야 합니다.** OTel `service.namespace` → Prometheus `job` 같은 정답형 스펙은 일반 원칙이 아니라 **표**로 스킬에 박혀 있어야 에이전트가 컨벤션처럼 따릅니다
- **영역별 리뷰 커맨드는 자동 라우팅과 함께 가야 합니다.** 전문 리뷰를 만들어도 사용자가 매번 `/review-pr:monitoring`을 기억해서 쳐야 한다면 유명무실합니다. `/review-pr`에서 파일 패턴으로 자동 감지해 유도합니다
- **이번 사이클에서 다룬 로그는 "완료"로 표기합니다.** 동일 범위 재분석을 막기 위해 스킬 개선 문서 상단에 "향후 동일 범위 재분석 불필요"를 명시합니다
