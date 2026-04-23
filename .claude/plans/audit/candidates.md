# 후보 플래그 (자동 추출)

생성일: 2026-04-23

## 유형 추정 분포

| 유형 | 글 수 | 설명 |
|------|------|------|
| A (단순 트러블슈팅) | 113 | 서사구조 강요 X |
| B (의사결정 서사) | 62 | 3요소 필수 |
| C (학습/정리) | 8 | 독창성·깊이 평가 |
| D (기록/로그) | 13 | 인사이트 유무 |

> 추정은 키워드 기반이므로 Phase 2에서 수동 확정 필요

## 저가치 의심 (1편)

기준: 본문 <2000자 OR (코드비중 ≥60% AND <6000자)

| cat | type | date | slug | len | code% | 플래그 |
|-----|------|------|------|-----|-------|-------|
| kubernetes | A | 2025-12-24 | wsl2-k3s-troubleshooting | 4047 | 64% | 코드과다 |

## 의사결정 서사 결여 의심 (B 유형, 10편)

기준: 유형=B AND 서사 키워드 <10회

| date | slug | narr | ctx | ADR |
|------|------|------|-----|-----|
| 2026-03-31 | goti-adr-loki-tempo-stability-tuning | 4 | 8 |  |
| 2026-04-06 | goti-claude-vs-gemini-k8s-pr-176 | 3 | 0 |  |
| 2026-03-27 | goti-cloudflare-migration-troubleshoot | 7 | 32 | Y |
| 2026-04-17 | goti-jwt-issuer-401-root-fix | 3 | 6 | Y |
| 2026-04-17 | goti-jwt-issuer-sot-adr | 7 | 2 | Y |
| 2026-04-13 | goti-node-rightsizing-and-rebalancing | 7 | 3 | Y |
| 2026-04-19 | goti-opus-4-7-migration | 7 | 3 | Y |
| 2026-04-17 | goti-redis-sot-d2-d3-d4-rollout | 8 | 11 | Y |
| 2025-12-06 | istio-intro-part1-why-service-mesh | 7 | 11 |  |
| 2025-10-26 | multi-repo-cicd-strategy | 8 | 3 |  |

## 프로젝트 맥락 why 결여 의심 (B 유형, 5편)

기준: 유형=B AND 컨텍스트 키워드 <3회

| date | slug | narr | ctx | ADR |
|------|------|------|-----|-----|
| 2026-04-06 | goti-claude-vs-gemini-k8s-pr-176 | 3 | 0 |  |
| 2026-04-17 | goti-jwt-issuer-sot-adr | 7 | 2 | Y |
| 2026-03-30 | goti-queue-poc-performance-comparison | 21 | 2 |  |
| 2026-04-19 | goti-session-dropout-root-cause-audit | 10 | 2 | Y |
| 2026-04-04 | queue-poc-loadtest-part3-selection | 23 | 1 |  |

## 2월 이동 후보 (42편)

기준: 2026-03 OR 04 AND (독립글 OR 시리즈 order=1)

| 현재 date | cat | series | slug |
|-----------|-----|--------|------|
| 2026-03-03 | challenge | goti-meta | goti-review-pr-gap-learning |
| 2026-03-06 | cicd | goti-cloudfront-alb | goti-cloudfront-swagger-403 |
| 2026-03-09 | monitoring | goti-spring-otel | goti-hikaricp-otel-beanpostprocessor |
| 2026-03-11 | argocd | goti-argocd-gitops | goti-ecr-secret-dollar-escape |
| 2026-03-12 | kubernetes | goti-kind-monitoring | goti-kind-monitoring-stack-fixes |
| 2026-03-13 | monitoring | goti-observability-ops | goti-alloy-mimir-rules-duplicate-metrics |
| 2026-03-13 | monitoring | - | goti-servicemonitor-release-label-missing |
| 2026-03-14 | kubernetes | - | goti-adr-istio-service-mesh |
| 2026-03-15 | monitoring | - | goti-tempo-scoped-tag-traceql-variable |
| 2026-03-16 | argocd | - | goti-container-image-update-strategy-adr |
| 2026-03-17 | monitoring | - | goti-servicemap-promql-syntax-error |
| 2026-03-18 | cicd | - | goti-renovate-ecr-auth-failure |
| 2026-03-20 | kubernetes | - | goti-kind-db-connection-false-negative |
| 2026-03-22 | kubernetes | - | goti-kubectl-toleration-imagepullbackoff |
| 2026-03-25 | monitoring | - | goti-decision-redis-exporter-deployment |
| 2026-03-27 | kubernetes | goti-cloudflare-migration | goti-cloudflare-migration-adr |
| 2026-03-27 | monitoring | goti-metrics-collector | goti-metrics-collector-go-sidecar |
| 2026-03-27 | monitoring | goti-observability-stack | goti-observability-stack-selection |
| 2026-03-27 | challenge | goti-queue-poc | goti-queue-loadtest-k6-two-phase-design |
| 2026-03-28 | monitoring | - | goti-logging-convention-adr |
| 2026-03-29 | monitoring | - | goti-adr-alloy-to-otel-collector |
| 2026-03-29 | challenge | - | goti-poc-ab-test-dependency-isolation-pattern |
| 2026-03-29 | kubernetes | queue-poc-loadtest | queue-poc-loadtest-part1-design |
| 2026-03-31 | monitoring | - | goti-adr-loki-tempo-stability-tuning |
| 2026-03-31 | monitoring | - | goti-discord-alerting-architecture |
| 2026-04-01 | kubernetes | - | goti-observer-db-auth-failure-readonly-user |
| 2026-04-01 | kubernetes | - | goti-payment-token-encryptor-32byte |
| 2026-04-01 | kubernetes | - | goti-redis-serialization-classcastexception |
| 2026-04-01 | kubernetes | - | goti-ssm-manual-config-troubleshooting |
| 2026-04-02 | monitoring | - | goti-finops-opencost-adoption-adr |
| 2026-04-03 | kubernetes | - | goti-istio-retry-duplicate-payment |
| 2026-04-04 | kubernetes | - | goti-gcp-terraform-cross-cloud-review |
| 2026-04-04 | kubernetes | - | goti-istio-jwks-mismatch-cdn-jwt-401 |
| 2026-04-12 | kubernetes | goti-scaling | goti-capacity-planning-keda |
| 2026-04-12 | istio | goti-auth | goti-jwks-distribution-automation-adr |
| 2026-04-13 | challenge | - | goti-orphan-stadium-cleanup |
| 2026-04-13 | challenge | - | goti-session-2-additional-findings |
| 2026-04-13 | challenge | - | goti-sql-audit-and-envelope-mismatch |
| 2026-04-14 | kubernetes | goti-multicloud-db | goti-read-replica-split-adr |
| 2026-04-14 | challenge | goti-redis-sot | goti-redis-first-ticketing-adr |
| 2026-04-17 | kubernetes | goti-multicloud | goti-multicloud-circuit-breaker-hpa-adr |
| 2026-04-19 | challenge | - | goti-game-time-utc-json-contract-fix |

## 중복 의심 페어 (23개)

기준: 같은 카테고리 AND (제목 유사도≥0.4 AND 다른 시리즈) OR 태그 유사도≥0.7

| cat | titleSim | tagSim | A | B |
|-----|----------|--------|---|---|
| istio | 0.4 | 0.33 | istio-ambient-part1-intro | istio-observability-part4-kiali |
| istio | 0.4 | 0.2 | istio-intro-part2-architecture | istio-security-part3-authorization-policy |
| challenge | 0.35 | 1 | goti-queue-poc-c-cdn-saturation-results | goti-queue-poc-c-saturation |
| challenge | 0.27 | 0.71 | goti-queue-poc-a-redis-saturation | goti-queue-poc-b-kafka-saturation |
| challenge | 0.24 | 0.71 | goti-queue-poc-b-kafka-saturation | goti-queue-poc-c-cdn-saturation-results |
| challenge | 0.22 | 0.71 | goti-queue-poc-a-redis-saturation | goti-queue-poc-c-cdn-saturation-results |
| monitoring | 0.19 | 1 | goti-error-tracking-dashboard-logql-traceql-fix | goti-error-tracking-dashboard-loki-nodata |
| challenge | 0.18 | 0.71 | goti-queue-poc-b-kafka-saturation | goti-queue-poc-c-saturation |
| challenge | 0.17 | 0.71 | goti-queue-poc-a-redis-saturation | goti-queue-poc-c-saturation |
| kubernetes | 0.11 | 0.71 | goti-multicloud-db-replication-technology-adr | goti-pglogical-mr-replication-gaps-adr |
| challenge | 0.1 | 0.71 | goti-claude-vs-gemini-k8s-pr-176 | goti-review-pr-gap-learning |
| challenge | 0.1 | 0.71 | goti-signup-created-at-bug-and-sql-audit | goti-signup-dtype-regression |
| monitoring | 0.09 | 0.71 | goti-otel-label-mismatch | goti-prometheus-job-label-mismatch |
| monitoring | 0.07 | 0.71 | goti-tempo-metricsgenerator-overrides-activation | goti-tempo-overrides-legacyconfig-parsing-error |
| monitoring | 0.06 | 0.88 | goti-error-tracking-dashboard-logql-traceql-fix | goti-monitoring-bugs-found |
| monitoring | 0.06 | 0.73 | goti-monitoring-bugs-found | goti-monitoring-pitfalls-system |
| kubernetes | 0.05 | 0.71 | goti-db-failback-reverse-replication-adr | goti-multicloud-db-replication-technology-adr |
| monitoring | 0.05 | 0.88 | goti-error-tracking-dashboard-loki-nodata | goti-monitoring-bugs-found |
| istio | 0.05 | 0.71 | goti-jwt-issuer-401-root-fix | goti-jwt-issuer-sot-adr |
| challenge | 0.05 | 0.71 | goti-queue-loadtest-k6-two-phase-design | goti-queue-poc-1000vu |
| kubernetes | 0 | 0.71 | goti-db-failback-reverse-replication-adr | goti-pglogical-mr-replication-gaps-adr |
| monitoring | 0 | 0.75 | goti-monitoring-dashboard-nodata | goti-otel-label-mismatch |
| istio | 0 | 0.86 | istio-intro-part2-architecture | istio-part2-architecture |