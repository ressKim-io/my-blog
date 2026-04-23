# findings-monitoring (46편)

## Level × Type 분포 (추정)

- **L1/L2**: eks-troubleshooting-monitoring 2편, observability 2편
- **L3 실무통합**: goti-observability-ops (16), goti-observability-stack (5), goti-otel-prometheus (4), goti-spring-otel (2), goti-metrics-collector (2), goti-meta (2), goti-multicloud (2), 독립 (9)

## 월별 분포

- 2025-12: 2 / 2026-01: 2 / 2026-02: 1 / **2026-03: 36 (극도 집중)** / 2026-04: 5

**3월이 전체 46편의 78%**. 재분배 시급도 최고

## 🔴 핵심 관찰 1: goti-observability-ops 16편 시리즈 집중도

16편 중 14편이 2026-03에 몰림. 3월 한 달 매주 3~4편씩 발행된 셈

**병합 후보** (같은 대시보드, 같은 날짜):
| order | date | slug | 상태 |
|-------|------|------|------|
| 10 | 2026-03-23 | goti-error-tracking-dashboard-logql-traceql-fix | Grafana 3건 수정 |
| 11 | 2026-03-23 | goti-error-tracking-dashboard-loki-nodata | 전 패널 No data |

같은 날, 같은 Error Tracking 대시보드. 서로 연속된 문제로 독자 관점에선 1편이 자연스러움

**권장**: 병합 → "Error Tracking 대시보드 — 쿼리 수정 + native OTLP No data 트러블슈팅" (1편으로)

## 🔴 핵심 관찰 2: 짧은 글 2편 (플래그됨)

| slug | len | 코드% |
|------|-----|-------|
| goti-servicemonitor-release-label-missing | - | - |
| goti-tempo-scoped-tag-traceql-variable | - | - |

둘 다 단순 트러블슈팅이라 짧은 게 자연스러움. 유지 OK. 다만 리라이트 시 "대안 검토" 가볍게 추가 가능

## 🔴 핵심 관찰 3: 태그 유사도 높은 페어 (false positive 다수)

candidates.md의 monitoring 중복 의심 7건 중 대부분은 **같은 시리즈 내 개별 트러블슈팅**으로, 실제 중복 아님. 예외 1건만 병합 권장 (위 order 10+11)

## 리라이트 후보

없음. narr/ctx 결여 의심 감지된 B유형 없음

## 2월 이동 후보 (대량)

3월 36편 중 시리즈 시작점·독립 글·ADR성 글 우선:

| 현재 date | slug | 근거 |
|-----------|------|------|
| 2026-03-09 | goti-hikaricp-otel-beanpostprocessor | 시리즈 order=1 |
| 2026-03-13 | goti-alloy-mimir-rules-duplicate-metrics | observability-ops 시리즈 order=1 |
| 2026-03-13 | goti-servicemonitor-release-label-missing | 독립 |
| 2026-03-15 | goti-tempo-scoped-tag-traceql-variable | 독립 |
| 2026-03-17 | goti-servicemap-promql-syntax-error | 독립 |
| 2026-03-25 | goti-decision-redis-exporter-deployment | 독립 ADR |
| 2026-03-27 | goti-metrics-collector-go-sidecar | 시리즈 order=1 |
| 2026-03-27 | goti-observability-stack-selection | 시리즈 order=1, 핵심 ADR |
| 2026-03-28 | goti-logging-convention-adr | 독립 ADR |
| 2026-03-29 | goti-adr-alloy-to-otel-collector | 독립 ADR |
| 2026-03-31 | goti-adr-loki-tempo-stability-tuning | 독립 ADR |
| 2026-03-31 | goti-discord-alerting-architecture | 독립 |

약 12편 2월 이동 가능. observability-ops 시리즈 중후반부는 3월에 남겨 시리즈 연속성 보존

## 결론

- **병합 1건**: error-tracking-dashboard 2편 → 1편 (1편 감소)
- **2월 이동**: 약 12편 (3월 36편 → 약 24편)
