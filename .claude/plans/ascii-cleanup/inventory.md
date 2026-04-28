# ASCII Cleanup — Inventory

> 자동 생성: `.claude/plans/ascii-cleanup/scripts/scan.mjs`
> 생성 시각: 2026-04-28T21:51:57.645Z

## 요약

- ASCII 블록 포함 글: **130편**
- 전체 ASCII 블록 수: **336개**
- 전체 ASCII 라인 합계: **3996줄**

## 자동 처리 추천 분포 (decision)

| 결정 | 개수 | 설명 |
|---|---|---|
| `skip` | 122 | 다이어그램 의도 아님 (코드 슈도코드 등) — 무시 |
| `flatten` | 109 | 평탄화 (표/문장으로 변환 또는 삭제) |
| `keep` | 105 | 보존 (디자인 개편 세션에서 재처리) |

## 블록 유형 분포 (kind)

| 유형 | 개수 | 설명 |
|---|---|---|
| `code-arrow` | 122 | 코드 lang 안의 화살표 (슈도코드 가능성) |
| `arrow-only` | 104 | 박스 없는 화살표 시퀀스 |
| `architecture` | 42 | 박스 다수 (아키텍처/스택) |
| `flow-diagram` | 36 | 박스 + 화살표 (흐름도/시퀀스) |
| `tree` | 27 | 디렉토리/의존성 트리 (├ └ │ ─) |
| `box-small` | 3 | 단순 박스 (≤14줄) |
| `misc` | 2 | 기타 |

## 글별 상세 (총 라인 수 내림차순)

| 글 | 카테고리 | 시리즈 | 블록 | 총 라인 | flatten/keep/skip | 주요 유형 |
|---|---|---|---|---|---|---|
| `istio-observability-part4-kiali.md` | istio | istio-observability | 9 | 201 | 0/9/0 | flow-diagram, architecture |
| `istio-observability-part3-access-log.md` | istio | istio-observability | 9 | 162 | 0/9/0 | architecture, tree |
| `goti-redis-serialization-classcastexception.md` | kubernetes | - | 8 | 155 | 0/2/6 | code-arrow, flow-diagram |
| `argocd-otel-crashloop-networkpolicy.md` | argocd | argocd-troubleshooting | 6 | 144 | 0/3/3 | architecture, flow-diagram, code-arrow |
| `istio-traffic-part1-four-resources.md` | istio | istio-traffic | 1 | 138 | 0/0/1 | code-arrow |
| `goti-cloudflare-multicloud-worker-cert-manager.md` | kubernetes | goti-multicloud | 1 | 125 | 0/0/1 | code-arrow |
| `argocd-bootstrap-circular-dependency.md` | argocd | argocd-troubleshooting | 3 | 118 | 1/2/0 | architecture, flow-diagram, arrow-only |
| `argocd-probe-crd-appproject-retry.md` | argocd | argocd-troubleshooting | 3 | 117 | 0/2/1 | flow-diagram, code-arrow |
| `eks-troubleshooting-part2-istio-ambient-1.md` | istio | eks-troubleshooting | 6 | 96 | 0/3/3 | architecture, code-arrow, flow-diagram |
| `istio-traffic-part5-mirroring.md` | istio | istio-traffic | 4 | 91 | 0/3/1 | flow-diagram, architecture, code-arrow |
| `argocd-ssa-sync-pitfalls.md` | argocd | argocd-troubleshooting | 5 | 88 | 0/2/3 | flow-diagram, code-arrow |
| `docker-compose-env-management.md` | challenge | - | 7 | 87 | 3/4/0 | tree, arrow-only, architecture |
| `goti-discord-alerting-architecture.md` | monitoring | - | 8 | 87 | 2/3/3 | code-arrow, architecture, arrow-only, flow-diagram |
| `multi-repo-cicd-strategy.md` | cicd | - | 8 | 72 | 2/6/0 | tree, arrow-only, architecture, flow-diagram |
| `goti-adr-alloy-to-otel-collector.md` | monitoring | - | 3 | 71 | 0/3/0 | architecture, flow-diagram |
| `goti-adr-loki-tempo-stability-tuning.md` | monitoring | - | 4 | 71 | 2/2/0 | flow-diagram, arrow-only |
| `istio-observability-part2-tracing.md` | istio | istio-observability | 3 | 69 | 0/3/0 | flow-diagram, architecture |
| `argocd-app-of-apps-deadlock.md` | argocd | argocd-troubleshooting | 6 | 67 | 0/3/3 | code-arrow, tree |
| `goti-adr-istio-service-mesh.md` | kubernetes | - | 2 | 66 | 0/2/0 | architecture, flow-diagram |
| `goti-otel-agent-otlp-protocol-mismatch.md` | monitoring | goti-observability-ops | 2 | 65 | 1/1/0 | architecture, misc |
| `goti-istio-retry-duplicate-payment.md` | kubernetes | - | 5 | 63 | 1/3/1 | arrow-only, code-arrow, tree, flow-diagram |
| `k8s-pod-flow-part1.md` | kubernetes | - | 10 | 62 | 1/1/8 | code-arrow, tree, arrow-only |
| `istio-observability-part1-metrics.md` | istio | istio-observability | 2 | 58 | 0/2/0 | architecture |
| `goti-gcp-terraform-cross-cloud-review.md` | kubernetes | - | 3 | 53 | 0/2/1 | architecture, code-arrow |
| `istio-traffic-part3-circuit-breaker.md` | istio | istio-traffic | 5 | 50 | 1/1/3 | code-arrow, arrow-only, architecture |
| `eks-troubleshooting-part3-istio-ambient-2.md` | istio | eks-troubleshooting | 3 | 48 | 0/1/2 | code-arrow, flow-diagram |
| `eks-troubleshooting-part7-go-service.md` | kubernetes | eks-troubleshooting | 4 | 47 | 0/2/2 | architecture, code-arrow, tree |
| `eks-troubleshooting-part9-rolling-update-cascading.md` | kubernetes | eks-troubleshooting | 3 | 47 | 0/2/1 | flow-diagram, code-arrow |
| `queue-poc-loadtest-part1-design.md` | kubernetes | queue-poc-loadtest | 6 | 47 | 4/1/1 | arrow-only, code-arrow, flow-diagram |
| `istio-ambient-part6-rate-limiting.md` | istio | istio-ambient | 2 | 44 | 0/1/1 | tree, code-arrow |
| `go-dependency-genproto-conflict.md` | challenge | - | 3 | 41 | 1/1/1 | tree, box-small, code-arrow |
| `goti-istio-jwks-mismatch-cdn-jwt-401.md` | kubernetes | - | 6 | 41 | 0/2/4 | code-arrow, flow-diagram |
| `eks-troubleshooting-part8-argocd-helm.md` | argocd | eks-troubleshooting | 2 | 40 | 0/0/2 | code-arrow |
| `istio-ambient-part5-jwt.md` | istio | istio-ambient | 4 | 39 | 0/0/4 | code-arrow |
| `eks-troubleshooting-part5-monitoring-1.md` | monitoring | eks-troubleshooting | 4 | 38 | 0/1/3 | architecture, code-arrow |
| `eks-security-jwt-rsa-mismatch.md` | istio | eks-security | 2 | 37 | 0/2/0 | flow-diagram, architecture |
| `goti-argocd-otel-collector-crashloop.md` | argocd | goti-argocd | 3 | 35 | 1/0/2 | arrow-only, code-arrow |
| `goti-monitoring-e2e-multi-troubleshoot.md` | monitoring | goti-observability-ops | 5 | 35 | 3/0/2 | arrow-only, code-arrow |
| `goti-ssm-manual-config-troubleshooting.md` | kubernetes | - | 2 | 34 | 0/1/1 | code-arrow, flow-diagram |
| `goti-observability-stack-selection.md` | monitoring | goti-observability-stack | 2 | 33 | 1/1/0 | arrow-only, architecture |
| `eks-troubleshooting-part4-external-secrets.md` | kubernetes | eks-troubleshooting | 4 | 31 | 1/0/3 | code-arrow, arrow-only |
| `goti-resale-phase4-step10-tests.md` | challenge | goti-resale | 2 | 31 | 0/0/2 | code-arrow |
| `eks-troubleshooting-part6-monitoring-2.md` | monitoring | eks-troubleshooting | 3 | 30 | 0/1/2 | code-arrow, flow-diagram |
| `goti-cloudflare-migration-adr.md` | kubernetes | goti-cloudflare-migration | 2 | 30 | 0/1/1 | code-arrow, flow-diagram |
| `istio-traffic-part4-retry-timeout.md` | istio | istio-traffic | 2 | 30 | 0/1/1 | code-arrow, architecture |
| `otel-monitoring-v3.md` | monitoring | observability | 3 | 30 | 1/1/1 | architecture, code-arrow, arrow-only |
| `goti-db-active-passive-with-read-split-adr.md` | kubernetes | goti-multicloud-db | 1 | 28 | 0/1/0 | architecture |
| `goti-synthetic-traffic.md` | monitoring | goti-loadtest | 2 | 27 | 0/2/0 | architecture, tree |
| `goti-cloudflare-migration-troubleshoot.md` | kubernetes | goti-cloudflare-migration | 6 | 26 | 0/1/5 | code-arrow, tree |
| `goti-image-updater-multisource.md` | argocd | goti-argocd-gitops | 4 | 26 | 1/0/3 | code-arrow, arrow-only |
| `istio-ambient-part4-wealist-migration.md` | istio | istio-ambient | 2 | 25 | 0/0/2 | code-arrow |
| `cloudfront-s3-troubleshooting.md` | kubernetes | eks-infra | 4 | 23 | 3/0/1 | arrow-only, code-arrow |
| `istio-traffic-part2-canary-ab.md` | istio | istio-traffic | 1 | 22 | 0/0/1 | code-arrow |
| `goti-argocd-probe-crd-not-permitted.md` | argocd | goti-argocd | 1 | 21 | 0/0/1 | code-arrow |
| `istio-intro-part1-why-service-mesh.md` | istio | istio-intro | 2 | 21 | 2/0/0 | box-small, arrow-only |
| `goti-pgbouncer-connection-pooling-adr.md` | challenge | goti-pgbouncer | 2 | 20 | 1/1/0 | arrow-only, architecture |
| `queue-poc-loadtest-part3-selection.md` | kubernetes | queue-poc-loadtest | 1 | 20 | 0/1/0 | flow-diagram |
| `goti-harbor-imagepull-403-cloudflare-waf.md` | kubernetes | goti-multicloud | 2 | 19 | 0/1/1 | code-arrow, flow-diagram |
| `goti-kind-db-connection-false-negative.md` | kubernetes | - | 3 | 19 | 0/0/3 | code-arrow |
| `challenge2-wealist-migration-part5.md` | challenge | challenge-2-wealist-migration | 2 | 18 | 1/1/0 | tree, arrow-only |
| `goti-db-failback-reverse-replication-adr.md` | kubernetes | goti-multicloud-db | 1 | 17 | 0/1/0 | tree |
| `goti-kafka-adoption-decision-adr.md` | challenge | goti-kafka | 1 | 15 | 0/1/0 | tree |
| `goti-istio-injection-label-pg-max-connections.md` | istio | goti-istio-ops | 2 | 14 | 1/0/1 | arrow-only, code-arrow |
| `goti-queue-loadtest-k6-two-phase-design.md` | challenge | goti-queue-poc | 2 | 14 | 2/0/0 | arrow-only |
| `websocket-token-refresh.md` | kubernetes | eks-security | 2 | 14 | 2/0/0 | arrow-only |
| `challenge1-game-server-part7.md` | challenge | game-server | 3 | 13 | 3/0/0 | arrow-only |
| `goti-cutover-residual-bugs-smoke-7of7.md` | challenge | goti-java-to-go | 2 | 13 | 2/0/0 | arrow-only |
| `goti-postgres-healthcheck-env.md` | cicd | goti-ec2-deploy | 3 | 13 | 1/0/2 | code-arrow, misc |
| `pod-service-troubleshooting.md` | kubernetes | - | 2 | 13 | 1/0/1 | code-arrow, arrow-only |
| `goti-argocd-dashboard-zero-metrics.md` | argocd | goti-argocd | 1 | 12 | 0/0/1 | code-arrow |
| `goti-load-test-db-realistic-data.md` | challenge | goti-loadtest | 3 | 12 | 1/0/2 | code-arrow, arrow-only |
| `goti-read-replica-split-adr.md` | kubernetes | goti-multicloud-db | 1 | 12 | 1/0/0 | box-small |
| `eks-troubleshooting-part1-dday.md` | kubernetes | eks-troubleshooting | 2 | 11 | 0/0/2 | code-arrow |
| `goti-3000vu-2nd-and-next-checklist.md` | challenge | goti-loadtest | 2 | 11 | 0/0/2 | code-arrow |
| `goti-container-image-update-strategy-adr.md` | argocd | - | 1 | 11 | 1/0/0 | arrow-only |
| `goti-eks-node-join-401-cluster-policy.md` | kubernetes | goti-eks | 2 | 11 | 2/0/0 | arrow-only |
| `goti-multicloud-db-replication-technology-adr.md` | kubernetes | goti-multicloud-db | 1 | 11 | 0/1/0 | tree |
| `goti-signup-dtype-regression.md` | challenge | goti-auth | 2 | 11 | 2/0/0 | arrow-only |
| `goti-kafka-buffered-otel-pipeline.md` | monitoring | goti-observability-ops | 4 | 10 | 3/1/0 | arrow-only, tree |
| `goti-phase7-d-overturn-decision.md` | challenge | goti-ticketing-phase | 2 | 10 | 2/0/0 | arrow-only |
| `goti-poc-ab-test-dependency-isolation-pattern.md` | challenge | - | 2 | 10 | 2/0/0 | arrow-only |
| `goti-redis-sot-adoption-adr.md` | challenge | goti-redis-sot | 2 | 10 | 2/0/0 | arrow-only |
| `istio-ambient-part7-migration-to-sidecar.md` | istio | istio-ambient | 2 | 10 | 1/0/1 | arrow-only, code-arrow |
| `goti-istio-peerauth-selector-prometheus-503.md` | istio | goti-istio-ops | 3 | 9 | 2/0/1 | arrow-only, code-arrow |
| `goti-jwks-distribution-automation-adr.md` | istio | goti-auth | 1 | 9 | 1/0/0 | arrow-only |
| `goti-resale-istio-rbac-403.md` | istio | goti-resale | 3 | 9 | 2/0/1 | arrow-only, code-arrow |
| `goti-cloudfront-swagger-403.md` | cicd | goti-cloudfront-alb | 2 | 8 | 2/0/0 | arrow-only |
| `goti-phase6-redis-inventory.md` | challenge | goti-redis-sot | 3 | 8 | 3/0/0 | arrow-only |
| `goti-phase6-ticketing-implementation.md` | challenge | goti-ticketing-phase | 2 | 8 | 2/0/0 | arrow-only |
| `goti-phase6-ticketing-sql-optimization.md` | challenge | goti-ticketing-phase | 1 | 8 | 0/0/1 | code-arrow |
| `goti-resale-flow-end-to-end-fix.md` | challenge | goti-resale | 1 | 8 | 0/0/1 | code-arrow |
| `challenge2-wealist-migration-part3.md` | challenge | challenge-2-wealist-migration | 2 | 7 | 1/1/0 | tree, arrow-only |
| `goti-argocd-ssa-diff-deployment-skip.md` | argocd | goti-argocd | 1 | 7 | 1/0/0 | arrow-only |
| `goti-docker-network-loki-healthcheck.md` | cicd | goti-ec2-deploy | 1 | 7 | 1/0/0 | arrow-only |
| `goti-eks-rolling-update-cascading-failures.md` | kubernetes | goti-eks | 1 | 7 | 1/0/0 | arrow-only |
| `goti-poc-queue-a-401-ticketing-isolation.md` | challenge | goti-queue-poc | 3 | 7 | 3/0/0 | arrow-only |
| `github-actions-multi-platform-optimization.md` | cicd | - | 1 | 6 | 0/1/0 | tree |
| `goti-ecr-secret-dollar-escape.md` | argocd | goti-argocd-gitops | 3 | 6 | 2/0/1 | arrow-only, code-arrow |
| `goti-gcp-redis-recovery-jwt-unification.md` | challenge | goti-multicloud | 1 | 6 | 0/0/1 | code-arrow |
| `goti-metrics-collector-go-sidecar.md` | monitoring | goti-metrics-collector | 1 | 6 | 0/1/0 | flow-diagram |
| `goti-redis-sot-d0-d1-rollout.md` | challenge | goti-redis-sot | 2 | 6 | 2/0/0 | arrow-only |
| `goti-signup-created-at-bug-and-sql-audit.md` | challenge | goti-auth | 2 | 6 | 2/0/0 | arrow-only |
| `challenge1-game-server-part2.md` | challenge | game-server | 1 | 5 | 0/0/1 | code-arrow |
| `goti-dashboard-query-validation-fixes.md` | monitoring | goti-observability-ops | 1 | 5 | 1/0/0 | arrow-only |
| `goti-hikaricp-otel-beanpostprocessor.md` | monitoring | goti-spring-otel | 1 | 5 | 1/0/0 | arrow-only |
| `goti-java-to-go-cutover-smoke-trouble.md` | challenge | goti-java-to-go | 1 | 5 | 0/0/1 | code-arrow |
| `goti-mimir-ingester-oom-webhook-deadlock.md` | monitoring | goti-observability-stack | 1 | 5 | 0/0/1 | code-arrow |
| `goti-monitoring-dashboard-nodata.md` | monitoring | goti-otel-prometheus | 2 | 5 | 2/0/0 | arrow-only |
| `goti-monitoring-pitfalls-system.md` | monitoring | goti-observability-ops | 1 | 5 | 0/0/1 | code-arrow |
| `goti-phase8-p0-seat-booking-port.md` | challenge | goti-ticketing-phase | 1 | 5 | 1/0/0 | arrow-only |
| `goti-tempo-scoped-tag-traceql-variable.md` | monitoring | - | 1 | 5 | 1/0/0 | arrow-only |
| `queue-poc-loadtest-part2-results.md` | kubernetes | queue-poc-loadtest | 1 | 5 | 0/0/1 | code-arrow |
| `goti-dev-monitoring-502.md` | cicd | goti-cloudfront-alb | 2 | 4 | 2/0/0 | arrow-only |
| `goti-metrics-collector-pipeline-e2e.md` | monitoring | goti-metrics-collector | 1 | 4 | 1/0/0 | arrow-only |
| `goti-renovate-ecr-auth-failure.md` | cicd | - | 1 | 4 | 1/0/0 | arrow-only |
| `goti-tempo-oom-kafka-buffer-sampling.md` | monitoring | goti-observability-stack | 1 | 4 | 0/0/1 | code-arrow |
| `goti-tempo-spanmetrics-batch-timeout.md` | monitoring | goti-observability-stack | 1 | 4 | 0/0/1 | code-arrow |
| `challenge2-wealist-migration-part2.md` | challenge | challenge-2-wealist-migration | 1 | 3 | 1/0/0 | arrow-only |
| `goti-grafana-csrf-origin.md` | cicd | goti-ec2-deploy | 1 | 3 | 0/0/1 | code-arrow |
| `goti-node-rightsizing-and-rebalancing.md` | kubernetes | goti-scaling | 1 | 3 | 1/0/0 | arrow-only |
| `goti-pgbouncer-rollout-and-load-test.md` | challenge | goti-pgbouncer | 2 | 3 | 2/0/0 | arrow-only |
| `goti-prometheus-job-label-mismatch.md` | monitoring | goti-otel-prometheus | 2 | 3 | 2/0/0 | arrow-only |
| `goti-redis-sot-d2-d3-d4-rollout.md` | challenge | goti-redis-sot | 2 | 3 | 0/0/2 | code-arrow |
| `goti-resale-fe-be-contract-audit.md` | challenge | goti-resale | 1 | 3 | 0/0/1 | code-arrow |
| `challenge2-wealist-migration-part4.md` | challenge | challenge-2-wealist-migration | 1 | 2 | 1/0/0 | arrow-only |
| `goti-dev-loadtest-ssh-istio-turnstile.md` | istio | goti-istio-ops | 2 | 2 | 2/0/0 | arrow-only |
| `goti-prometheus-agent-mode-adr.md` | monitoring | - | 1 | 2 | 1/0/0 | arrow-only |
| `goti-session-dropout-root-cause-audit.md` | challenge | goti-auth | 1 | 2 | 0/0/1 | code-arrow |
| `goti-3000vu-queue-oneshot.md` | challenge | goti-queue-poc | 1 | 1 | 0/0/1 | code-arrow |
| `goti-virtualservice-fqdn-503.md` | kubernetes | goti-kind-monitoring | 1 | 1 | 1/0/0 | arrow-only |

## 블록 단위 상세

### `istio-observability-part4-kiali.md`

- 카테고리: istio / 시리즈: istio-observability
- 블록 9개 / ASCII 201줄

- L86-112 (26줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │              트래픽 표시 방식                          `
- L132-154 (22줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │   Service: reviews                              `
- L179-201 (22줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │   Istio Config - VirtualService                 `
- L221-242 (21줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │   Graph - Traffic Animation                     `
- L247-271 (24줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │   Service: reviews                              `
- L280-301 (21줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │   Workloads                                     `
- L306-321 (15줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │   Istio Config                                  `
- L330-355 (25줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │   Service: reviews - Traces                     `
- L403-428 (25줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │                   Kiali 활용 체크리스트                `

### `istio-observability-part3-access-log.md`

- 카테고리: istio / 시리즈: istio-observability
- 블록 9개 / ASCII 162줄

- L113-134 (21줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │   UO - Upstream Overflow                        `
- L139-161 (22줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │   UF - Upstream Connection Failure              `
- L166-187 (21줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │   NR - No Route Configured                      `
- L192-215 (23줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │   URX - Upstream Retry Limit Exceeded           `
- L220-240 (20줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │   DC - Downstream Connection Termination        `
- L346-360 (14줄, lang=`-`, kind=**tree**, decision=**keep**)
  - 샘플: `1. Response Flags 확인 /    ├── UO → Connection Pool 설정 확인 /    ├── UF → 서비스 상태 확인`
- L365-375 (10줄, lang=`-`, kind=**tree**, decision=**keep**)
  - 샘플: `1. 타임아웃 위치 확인 /    ├── DT → 클라이언트 타임아웃 /    ├── UT → VirtualService timeout`
- L380-389 (9줄, lang=`-`, kind=**tree**, decision=**keep**)
  - 샘플: `1. Response Flags 확인 /    ├── DC → 클라이언트가 끊음 /    ├── UC → 서버가 끊음`
- L409-431 (22줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │                 Access Log 체크리스트                `

### `goti-redis-serialization-classcastexception.md`

- 카테고리: kubernetes / 시리즈: -
- 블록 8개 / ASCII 155줄

- L54-59 (5줄, lang=`java`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `public <T> T get(String key, Class<T> clazz) { /     Object value = redisTemplate.opsForValue().get(key); /     if (valu`
- L98-133 (35줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `{/* TODO: Draw.io로 교체 */} /  / ┌─────────────────────────────────────────────────────────┐`
- L196-207 (11줄, lang=`java`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `public <T> T get(String key, Class<T> clazz) { /     Object value = redisTemplate.opsForValue().get(key); /     if (valu`
- L245-262 (17줄, lang=`java`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `@Configuration / public class RedisConfig { / `
- L267-298 (31줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `{/* TODO: Draw.io로 교체 */} /  / ┌─────────────────────────────────────────────────────────┐`
- L317-337 (20줄, lang=`java`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `@Configuration / public class RedisConfig { / `
- L342-359 (17줄, lang=`java`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `@Configuration / public class RedisConfig { / `
- L411-430 (19줄, lang=`java`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `// 도메인별 Repository에서 직접 직렬화/역직렬화 / @Repository / public class ReservationSessionCacheRepository {`

### `argocd-otel-crashloop-networkpolicy.md`

- 카테고리: argocd / 시리즈: argocd-troubleshooting
- 블록 6개 / ASCII 144줄

- L39-64 (25줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────────┐ / │                    OTel Collector 2-Tier Pip`
- L107-136 (29줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `┌───────────────────────────────────────────────────────────┐ / │                 Retry 증폭 사이클                          `
- L163-176 (13줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# Before: loki-values.yaml / limits_config: /   # ingestion_rate_mb: (미설정, 기본 4)`
- L283-286 (3줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# values-dev.yaml / server: /   resources: {}  # BestEffort QoS → 노드 리소스 부족 시 가장 먼저 evict`
- L334-365 (31줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │                    argocd namespace             `
- L393-436 (43줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# Before: argocd-netpol.yaml / apiVersion: networking.k8s.io/v1 / kind: NetworkPolicy`

### `istio-traffic-part1-four-resources.md`

- 카테고리: istio / 시리즈: istio-traffic
- 블록 1개 / ASCII 138줄

- L502-640 (138줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# 1. Gateway: 외부 진입점 / apiVersion: networking.istio.io/v1 / kind: Gateway`

### `goti-cloudflare-multicloud-worker-cert-manager.md`

- 카테고리: kubernetes / 시리즈: goti-multicloud
- 블록 1개 / ASCII 125줄

- L107-232 (125줄, lang=`js`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `// ============================================================================= / // Goti 멀티클라우드 라우터 (Cloudflare Worker`

### `argocd-bootstrap-circular-dependency.md`

- 카테고리: argocd / 시리즈: argocd-troubleshooting
- 블록 3개 / ASCII 118줄

- L77-99 (22줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────────────┐ / │                         순환 의존성 (Circular`
- L125-146 (21줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `┌────────────────────────────────────────────────────────────────────────┐ / │                       Terraform 설치 (순서 보장`
- L153-228 (75줄, lang=`hcl`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `# terraform/prod/compute/helm-releases.tf /  / # =======================================================================`

### `argocd-probe-crd-appproject-retry.md`

- 카테고리: argocd / 시리즈: argocd-troubleshooting
- 블록 3개 / ASCII 117줄

- L68-104 (36줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │              ArgoCD Sync 권한 검증 흐름               `
- L111-149 (38줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# Before: monitoring-project.yaml / namespaceResourceWhitelist: /   - group: monitoring.coreos.com`
- L201-244 (43줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │              ArgoCD Auto Sync Retry 메커니즘        `

### `eks-troubleshooting-part2-istio-ambient-1.md`

- 카테고리: istio / 시리즈: eks-troubleshooting
- 블록 6개 / ASCII 96줄

- L101-117 (16줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────┐ / │            Sidecar 모드                      │ / ├────────────────────`
- L200-204 (4줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `$ kubectl get pod -n wealist-prod -l app=prometheus -o yaml | grep -A5 labels / labels: /   app: prometheus`
- L211-235 (24줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌────────────────────────────────────────────────────────────┐ / │                    Istio Ambient Mesh                `
- L246-257 (11줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# k8s/helm/charts/wealist-monitoring/templates/prometheus/deployment.yaml /  / # Before`
- L322-331 (9줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# prometheus configmap / scrape_configs: /   - job_name: 'argocd-application-controller'`
- L426-458 (32줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────┐ / │                 Istio Ambient Mesh (wealist-prod)   `

### `istio-traffic-part5-mirroring.md`

- 카테고리: istio / 시리즈: istio-traffic
- 블록 4개 / ASCII 91줄

- L155-174 (19줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │                  Mirror는 Fire-and-Forget        `
- L229-252 (23줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │                   Shadow Testing Dashboard      `
- L380-405 (25줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# ❌ 위험: POST 요청 미러링 / # - 결제 API 미러링 → 이중 결제! / # - 이메일 발송 → 이중 발송!`
- L475-499 (24줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │              Traffic Mirroring 체크리스트            `

### `argocd-ssa-sync-pitfalls.md`

- 카테고리: argocd / 시리즈: argocd-troubleshooting
- 블록 5개 / ASCII 88줄

- L68-86 (18줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────────┐ / │                    ArgoCD Sync Pipeline     `
- L141-155 (14줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# Before: diff와 apply 방식이 다름 / syncOptions: /   - ServerSideApply=true`
- L182-187 (5줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# cascade=false: 하위 리소스(Pod, Deployment 등)는 유지, Application 객체만 삭제 / $ argocd app delete goti-queue-dev --cascade=false `
- L242-280 (38줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │                Force Sync 에러 루프                 `
- L296-309 (13줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# 1. Application JSON 백업 / $ kubectl get application goti-queue-sungjeon-dev -n argocd -o json > app-backup.json / `

### `docker-compose-env-management.md`

- 카테고리: challenge / 시리즈: -
- 블록 7개 / ASCII 87줄

- L25-38 (13줄, lang=`bash`, kind=**tree**, decision=**keep**)
  - 샘플: `project-root/ / ├── user-service/ / │   ├── .env`
- L47-50 (3줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `frontend/.env          ← VITE_API_URL=localhost / docker-compose.yml     ← API_URL=ec2-domain / user-service/.env      ←`
- L79-105 (26줄, lang=`-`, kind=**tree**, decision=**keep**)
  - 샘플: `project-root/ / ├── docker/ / │   ├── compose/`
- L249-251 (2줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `"이거 board-service 바뀐 거 같은데 뭐 바꿔줘야 되나요??" / → 30분 설명, 1시간 디버깅, docker system prune까지 몇 번 반복`
- L256-262 (6줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `"환경 설정 어떻게 하나요?" / → "이것만 하세요" / `
- L275-290 (15줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────┐ / │             Git Repository                   │ / ├──────────────┬───`
- L295-317 (22줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────┐ / │             Git Repository                   │ / ├──────────────┬───`

### `goti-discord-alerting-architecture.md`

- 카테고리: monitoring / 시리즈: -
- 블록 8개 / ASCII 87줄

- L43-55 (12줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# alertmanager.yml (변경 전) / receivers: /   - name: "null"`
- L113-144 (31줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────────────┐ / │                    Discord Alerting Pipe`
- L269-274 (5줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `실제 발생한 순서: / 1. Goti-monitoring PR 머지 → ArgoCD가 Alertmanager config 먼저 sync / 2. Alertmanager가 Secret 마운트 시도 → Secret 없음`
- L305-308 (3줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `1. Terraform apply (SSM 파라미터 생성) / 2. Goti-k8s 배포 (ExternalSecret → Secret 생성) / 3. Goti-monitoring 배포 (Alertmanager con`
- L348-350 (2줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `spec: /   refreshInterval: 1h  # ← 1시간마다 polling`
- L432-454 (22줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `┌──────────────────────────────────────────────────────────────┐ / │                   ArgoCD Resource Conflict         `
- L463-466 (3줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# Goti-monitoring/charts/goti-monitoring/values-prod.yaml (변경 후) / grafanaAdminSecret: /   enabled: false  # ← external-`
- L530-539 (9줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `┌─────────────────┐     ┌─────────────────┐     ┌─────────────────────┐ / │ 1. Terraform    │────▶│ 2. Goti-k8s     │───`

### `multi-repo-cicd-strategy.md`

- 카테고리: cicd / 시리즈: -
- 블록 8개 / ASCII 72줄

- L39-44 (5줄, lang=`-`, kind=**tree**, decision=**keep**)
  - 샘플: `team-project/ / ├── user-service/ / ├── board-service/`
- L53-55 (2줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `user-service/      ← CI에서 EC2에 SSH → docker-compose up / board-service/     ← CI에서 EC2에 SSH → docker-compose up`
- L64-67 (3줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `user-service/      ← CI: 이미지 빌드/푸시만 / board-service/     ← CI: 이미지 빌드/푸시만 / deploy-config/     ← compose/env/nginx 관리, 실`
- L139-147 (8줄, lang=`-`, kind=**tree**, decision=**keep**)
  - 샘플: `deploy-config/ / ├── docker-compose.yml / ├── .env.example`
- L222-241 (19줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌──────────────────────────────────────────────────────────┐ / │                    Git Repositories                    `
- L249-266 (17줄, lang=`-`, kind=**tree**, decision=**keep**)
  - 샘플: `k8s-infra/ / ├── argocd/ / │   └── applications/`
- L337-348 (11줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `┌──────────────────────────────────────────────────────────┐ / │                    GitOps Pattern                      `
- L410-417 (7줄, lang=`-`, kind=**tree**, decision=**keep**)
  - 샘플: `초기: Docker Compose + 중앙 배포 레포 /   └─ 개념 이해하기 쉬움 /   └─ 빠른 피드백`

### `goti-adr-alloy-to-otel-collector.md`

- 카테고리: monitoring / 시리즈: -
- 블록 3개 / ASCII 71줄

- L28-52 (24줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `{/* TODO: Draw.io로 교체 */} /  / ┌──────────────────┐`
- L156-170 (14줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `{/* TODO: Draw.io로 교체 */} /  / ┌──────────────────┐`
- L175-208 (33줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `{/* TODO: Draw.io로 교체 */} /  / ┌──────────────────┐`

### `goti-adr-loki-tempo-stability-tuning.md`

- 카테고리: monitoring / 시리즈: -
- 블록 4개 / ASCII 71줄

- L30-57 (27줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────┐ / │                    OOM 악순환 사이클                      `
- L221-223 (2줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `Before: chunk 2h 체류 x stream 수 + GC 미개입 → ~1Gi 초과 → OOM (limit: 1Gi) / After:  chunk 30m 체류 x stream 수 + GOMEMLIMIT GC →`
- L230-232 (2줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `Before: block 30m 체류 + 무제한 ingestion → ~2Gi 초과 → OOM (limit: 2Gi) / After:  block 5m 체류 + 15MB/s rate limit + GOMEMLIMIT`
- L238-278 (40줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────┐ / │               악순환 차단 — 3가지 축 적용 후                  │`

### `istio-observability-part2-tracing.md`

- 카테고리: istio / 시리즈: istio-observability
- 블록 3개 / ASCII 69줄

- L291-311 (20줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │                     Jaeger UI                   `
- L326-355 (29줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │   Trace abc123                                  `
- L573-593 (20줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │              분산 트레이싱 체크리스트                      `

### `argocd-app-of-apps-deadlock.md`

- 카테고리: argocd / 시리즈: argocd-troubleshooting
- 블록 6개 / ASCII 67줄

- L38-45 (7줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `$ kubectl get app -n argocd -o custom-columns='NAME:.metadata.name,SYNC:.status.sync.status,HEALTH:.status.health.status`
- L120-125 (5줄, lang=`-`, kind=**tree**, decision=**keep**)
  - 샘플: `k8s/argocd/apps/prod/ / ├── root-app.yaml          # 문제! 자기 자신도 감시 대상 / ├── auth-service.yaml`
- L129-136 (7줄, lang=`-`, kind=**tree**, decision=**keep**)
  - 샘플: `k8s/argocd/ / ├── root-apps/              # 새 디렉토리 (별도 관리) / │   ├── prod.yaml           # root app 정의`
- L181-189 (8줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# Secret 수동 생성 / kubectl create secret generic argocd-secret -n argocd \ /   --from-literal=server.secretkey=$(openssl r`
- L245-275 (30줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# k8s/argocd/base/external-secrets/argocd-oauth-secret.yaml / apiVersion: external-secrets.io/v1 / kind: ExternalSecret`
- L308-318 (10줄, lang=`-`, kind=**tree**, decision=**keep**)
  - 샘플: `k8s/argocd/ / ├── root-apps/              # Root Applications (Terraform 또는 kubectl로 직접 apply) / │   ├── prod.yaml`

### `goti-adr-istio-service-mesh.md`

- 카테고리: kubernetes / 시리즈: -
- 블록 2개 / ASCII 66줄

- L197-222 (25줄, lang=`text`, kind=**architecture**, decision=**keep**)
  - 샘플: `Sidecar 모드 워터폴 뷰 (정상): / ┌─ goti-gateway ─────────────────────────────────┐ / │  ┌─ user-service ──────────────┐        `
- L297-338 (41줄, lang=`text`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `                    ┌─────────────────────────────────────────────┐ /                     │              Istio Control P`

### `goti-otel-agent-otlp-protocol-mismatch.md`

- 카테고리: monitoring / 시리즈: goti-observability-ops
- 블록 2개 / ASCII 65줄

- L167-223 (56줄, lang=`text`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────────────┐ / │  goti namespace                         `
- L228-237 (9줄, lang=`text`, kind=**misc**, decision=**flatten**)
  - 샘플: `  Java Agent ──gRPC:4317──►  Alloy  ──remote_write:8080──► Mimir   (메트릭) /   Java Agent ──gRPC:4317──►  Alloy  ──gRPC:43`

### `goti-istio-retry-duplicate-payment.md`

- 카테고리: kubernetes / 시리즈: -
- 블록 5개 / ASCII 63줄

- L54-57 (3줄, lang=`log`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `03:24:56.538 주문 결제 완료 처리 시작 - orderId: 7e50db38... / 03:24:56.717 주문 결제 완료 처리 시작 - orderId: 7e50db38... → WARN: 결제 가능한 주`
- L83-88 (5줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# goti-payment-{suyeon,junsang,sungjeon} VirtualService httpRoutes / retries: /   attempts: 2`
- L122-135 (13줄, lang=`-`, kind=**tree**, decision=**keep**)
  - 샘플: `Client → payment.initPayment() @Transactional /            │ /            ├─ 1. ticketingOrderClient.confirmPayment()`
- L146-182 (36줄, lang=`-`, kind=**tree**, decision=**keep**)
  - 샘플: `Client → Istio Sidecar → payment.initPayment() @Transactional /                             │ /                         `
- L226-232 (6줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `@Transactional 범위: /   ┌──────────────────────────────────────┐ /   │  payment DB 작업     → 롤백 가능 ✅   │`

### `k8s-pod-flow-part1.md`

- 카테고리: kubernetes / 시리즈: -
- 블록 10개 / ASCII 62줄

- L46-49 (3줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `$ kubectl get pods --watch / NAME    READY   STATUS              AGE / nginx   0/1     ContainerCreating   30s  # ← 왜 이렇`
- L79-82 (3줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `clusters: / - cluster: /     server: https://192.168.1.100:6443  # ← API Server 주소`
- L101-106 (5줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# time 명령으로 측정 / $ time kubectl apply -f simple-pod.yaml / `
- L214-217 (3줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `$ docker images nginx / REPOSITORY   TAG      SIZE / nginx        latest   187MB  # ← 약 6초 소요 (내 환경)`
- L225-235 (10줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# 로컬에 이미지 없는 상태로 테스트 / $ docker rmi nginx:latest / `
- L238-245 (7줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# 이미지 있는 상태로 재시도 / $ kubectl delete pod nginx / $ time kubectl apply -f nginx-pod.yaml && \`
- L254-267 (13줄, lang=`-`, kind=**tree**, decision=**keep**)
  - 샘플: `Container Runtime (containerd): / 1. 컨테이너 생성 (0.5초) /    └─ 네임스페이스, Cgroup 설정`
- L334-339 (5줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `NAME    READY   STATUS    AGE / nginx   0/1     Pending   0s / nginx   0/1     Pending   0s      # ← Scheduler 작동 전`
- L366-371 (5줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `spec: /   containers: /   - name: nginx`
- L427-435 (8줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `$ kubectl describe pod my-app /  / # Events:`

### `istio-observability-part1-metrics.md`

- 카테고리: istio / 시리즈: istio-observability
- 블록 2개 / ASCII 58줄

- L281-313 (32줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │                Istio Service Dashboard          `
- L530-556 (26줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │                 Istio 메트릭 체크리스트                 `

### `goti-gcp-terraform-cross-cloud-review.md`

- 카테고리: kubernetes / 시리즈: -
- 블록 3개 / ASCII 53줄

- L402-431 (29줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────┐ / │                     Terraform (IaC)                 `
- L525-532 (7줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# 현재 (AWS 하드코딩) / apiVersion: external-secrets.io/v1beta1 / kind: ExternalSecret`
- L638-655 (17줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌──────────────────────────────────────────────────────────────┐ / │                    해결 구조                           `

### `istio-traffic-part3-circuit-breaker.md`

- 카테고리: istio / 시리즈: istio-traffic
- 블록 5개 / ASCII 50줄

- L168-174 (6줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# Pod가 2개일 때 maxEjectionPercent: 50 / # → 최대 1개만 제외 가능 (50%) / # → 나머지 1개가 문제여도 제외 불가`
- L358-360 (2줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `Kiali UI → Graph → httpbin 서비스 클릭 / → "Traffic" 탭에서 Circuit Breaker 상태 확인`
- L383-388 (5줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# Pod 2개 + maxEjectionPercent: 50 / # → 1개만 제외 가능 / # → 남은 1개가 문제여도 트래픽 계속 감`
- L393-409 (16줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# VirtualService의 retry / http: / - route:`
- L447-468 (21줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │               Circuit Breaker 설정 체크리스트          `

### `eks-troubleshooting-part3-istio-ambient-2.md`

- 카테고리: istio / 시리즈: eks-troubleshooting
- 블록 3개 / ASCII 48줄

- L267-274 (7줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# 현재 Route53이 가리키는 NLB / $ dig api.wealist.co.kr / api.wealist.co.kr.  300  IN  A  52.xxx.xxx.xxx`
- L279-282 (3줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# 현재 NLB 확인 / $ kubectl get svc -n istio-system wealist-gateway-istio -o jsonpath='{.status.loadBalancer.ingress[0].host`
- L446-484 (38줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────┐ / │                        Internet                     `

### `eks-troubleshooting-part7-go-service.md`

- 카테고리: kubernetes / 시리즈: eks-troubleshooting
- 블록 4개 / ASCII 47줄

- L34-54 (20줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────┐ / │                     Go Microservices                `
- L207-209 (2줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `$ go mod graph | grep genproto / gopter → goconvey → gopherjs → cobra → viper → crypt → etcd → grpc-gateway v1 → genprot`
- L212-227 (15줄, lang=`-`, kind=**tree**, decision=**keep**)
  - 샘플: `board-service /   └── gopter (property-based testing) /         └── goconvey`
- L339-349 (10줄, lang=`go`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `// 문제 코드 / func newResource(cfg *Config) (*resource.Resource, error) { /     return resource.Merge(`

### `eks-troubleshooting-part9-rolling-update-cascading.md`

- 카테고리: kubernetes / 시리즈: eks-troubleshooting
- 블록 3개 / ASCII 47줄

- L75-97 (22줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `{/* TODO: Draw.io로 교체 */} /  / ┌─────────────────────────────────────────────────────────┐`
- L272-293 (21줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `{/* TODO: Draw.io로 교체 */} /  / ┌──────────────────────────────────┐`
- L302-306 (4줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# WARM_PREFIX_TARGET 제거 (노드당 ~48 IP → ~3 IP로 감소) / $ kubectl set env daemonset aws-node -n kube-system WARM_PREFIX_TARGE`

### `queue-poc-loadtest-part1-design.md`

- 카테고리: kubernetes / 시리즈: queue-poc-loadtest
- 블록 6개 / ASCII 47줄

- L67-68 (1줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `enterQueue() → waitForAdmission() → enterSeat() → [ticketing] → leaveQueue()`
- L108-121 (13줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `load-tests/ /   helpers/ /     queue-josuyeon.js    # PR #309 대기열 액션`
- L137-138 (1줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `POST /api/v1/queue/junsang/validate → 401 (empty body)`
- L149-158 (9줄, lang=`java`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `@SpringBootApplication(scanBasePackages = { /     "com.goti.queue",      // queue 패키지 /     "com.goti.config",     // We`
- L179-184 (5줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `GET /api/v1/stadium-seats/.../seat-grades → 403 /   {"message": "좌석 조회는 대기열 입장 완료 후에만 가능합니다."} / `
- L194-212 (18줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `{/* TODO: Draw.io로 교체 */} /  / ┌──────────────┐     ┌──────────────────────────────────┐`

### `istio-ambient-part6-rate-limiting.md`

- 카테고리: istio / 시리즈: istio-ambient
- 블록 2개 / ASCII 44줄

- L109-115 (6줄, lang=`-`, kind=**tree**, decision=**keep**)
  - 샘플: `packages/wealist-advanced-go-pkg/ / └── ratelimit/ /     ├── config.go         # 설정`
- L343-381 (38줄, lang=`go`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `package main /  / import (`

### `go-dependency-genproto-conflict.md`

- 카테고리: challenge / 시리즈: -
- 블록 3개 / ASCII 41줄

- L59-68 (9줄, lang=`-`, kind=**tree**, decision=**keep**)
  - 샘플: `gopter v0.2.11 (property-based testing) /   └── goconvey v1.8.1 /       └── gopherjs v1.17.2`
- L72-75 (3줄, lang=`-`, kind=**box-small**, decision=**flatten**)
  - 샘플: `wealist-advanced-go-pkg /   └── grpc-gateway/v2 v2.23.0 /       └── genproto/googleapis/api v0.0.0-20241104 (신버전)`
- L123-152 (29줄, lang=`go`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `// go.mod /  / // Exclude old genproto to avoid ambiguous import errors`

### `goti-istio-jwks-mismatch-cdn-jwt-401.md`

- 카테고리: kubernetes / 시리즈: -
- 블록 6개 / ASCII 41줄

- L112-115 (3줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `spec: /   jwtRules: /     - issuer: goti-user-service  # ← JWT의 iss와 일치`
- L141-145 (4줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# Istio RequestAuthentication에 박힌 JWKS / $ kubectl get ra goti-queue-suyeon-prod-jwt -n goti \ /     -o jsonpath='{.spec`
- L148-152 (4줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# User 서비스가 실제 사용하는 키 / $ kubectl exec goti-user-prod-xxx -c goti-server -- \ /     wget -qO- http://localhost:8080/.wel`
- L189-204 (15줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `┌──────────┐    ┌─────────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────┐ / │   K6     │───▶│ Cloudflare  │`
- L314-324 (10줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `┌──────────┐    plain HTTP     ┌──────────────┐    ┌──────────────┐ / │  istiod  │──────────────────▶│ Envoy        │───`
- L513-518 (5줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `- rule: Read sensitive file untrusted /   condition: > /     open_read and sensitive_files`

### `eks-troubleshooting-part8-argocd-helm.md`

- 카테고리: argocd / 시리즈: eks-troubleshooting
- 블록 2개 / ASCII 40줄

- L254-276 (22줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# Git에 정의된 내용 / apiVersion: apiregistration.k8s.io/v1 / kind: APIService`
- L462-480 (18줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# Git에 정의된 내용 / spec: /   data:`

### `istio-ambient-part5-jwt.md`

- 카테고리: istio / 시리즈: istio-ambient
- 블록 4개 / ASCII 39줄

- L268-275 (7줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# JWT 검증은 L7 기능 → waypoint 필요 / $ istioctl waypoint apply --namespace default / `
- L303-318 (15줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# JWT 없이 요청 → 403 / $ curl -i http://api-gateway/api/users / HTTP/1.1 403 Forbidden`
- L381-395 (14줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# 원인 확인 / $ kubectl logs -n default -l gateway.istio.io/managed | grep -i jwt / `
- L419-422 (3줄, lang=`go`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `// JWT 헤더에 kid 추가 필수! / token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims) / token.Header["kid"] = "wealist-key-`

### `eks-troubleshooting-part5-monitoring-1.md`

- 카테고리: monitoring / 시리즈: eks-troubleshooting
- 블록 4개 / ASCII 38줄

- L34-55 (21줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────┐ / │                    Monitoring Stack                 `
- L220-225 (5줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `$ kubectl get pvc -n wealist-prod / NAME               STATUS    VOLUME   CAPACITY   STORAGECLASS / prometheus-data    P`
- L247-254 (7줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `$ kubectl patch storageclass gp2 -p \ /   '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"t`
- L396-401 (5줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `$ kubectl get pods -n wealist-prod | grep -E "prometheus|loki" / prometheus-68ddd48c9c-vmxdg   0/1   CrashLoopBackOff   `

### `eks-security-jwt-rsa-mismatch.md`

- 카테고리: istio / 시리즈: eks-security
- 블록 2개 / ASCII 37줄

- L117-132 (15줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `┌──────────────────┐     JWT 발급 (Private Key A로 서명) / │  auth-service    │─────────────────────────────────────────┐ / │`
- L155-177 (22줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌───────────────────────┐ / │  AWS Secrets Manager  │ / │  wealist/prod/app/    │`

### `goti-argocd-otel-collector-crashloop.md`

- 카테고리: argocd / 시리즈: goti-argocd
- 블록 3개 / ASCII 35줄

- L125-127 (2줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `NewServer() → ensureSynced() → WaitForCacheSync()  ← 여기서 hang / Init() → Listen() → InitTracer()  ← OTLP는 여기서 초기화 (도달 못 `
- L146-152 (6줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# loki-values.yaml (dev) / limits_config: /   ingestion_rate_mb: 16          # 기본 4 → 16`
- L161-188 (27줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `apiVersion: networking.k8s.io/v1 / kind: NetworkPolicy / metadata:`

### `goti-monitoring-e2e-multi-troubleshoot.md`

- 카테고리: monitoring / 시리즈: goti-observability-ops
- 블록 5개 / ASCII 35줄

- L44-47 (3줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `POST https://dev.go-ti.shop/api/v1/seat-reservations/seats/{seatId} / → 200 OK, Content-Type: text/html / → <!DOCTYPE ht`
- L117-125 (8줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `# 1) game-seats 경로 누락 → Istio 404 / GET /api/v1/game-seats/{gameId}/sections/{sectionId}/seat-statuses → 404 / `
- L160-167 (7줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `rules: /   - to: /       - operation:`
- L237-246 (9줄, lang=`alloy`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `prometheus.remote_write "default" { /   endpoint { /     queue_config {`
- L301-309 (8줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# tempo-values.yaml / metricsGenerator: /   enabled: false              # dev 환경에서 비활성화, 200~500MB 절감`

### `goti-ssm-manual-config-troubleshooting.md`

- 카테고리: kubernetes / 시리즈: -
- 블록 2개 / ASCII 34줄

- L105-115 (10줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# 1. SSM 값 수정 (AWS 콘솔에서 32바이트로 변경) / # goti-prod-2026-queue-token-32ch → goti-prod-2026-queue-token-32chr / `
- L335-359 (24줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `수정 전: / ┌─────────────────┐     user=goti (master)     ┌──────────┐ / │  payment-prod   │──────────────────────────→ │  `

### `goti-observability-stack-selection.md`

- 카테고리: monitoring / 시리즈: goti-observability-stack
- 블록 2개 / ASCII 33줄

- L255-258 (3줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `메트릭:  App → OTel SDK → Alloy scrape → remote_write → Mimir / 로그:    App → OTel SDK → Alloy → Kafka(otlp_logs) → Alloy Ga`
- L281-311 (30줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `                        ┌─────────────────────────────┐ /                         │     Grafana (Dashboard)      │ /    `

### `eks-troubleshooting-part4-external-secrets.md`

- 카테고리: kubernetes / 시리즈: eks-troubleshooting
- 블록 4개 / ASCII 31줄

- L60-65 (5줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# external-secret-shared.yaml / apiVersion: external-secrets.io/v1  # ← 문제! / kind: ExternalSecret`
- L212-215 (3줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `$ kubectl get crd externalsecrets.external-secrets.io -o jsonpath='{.spec.versions}' | jq '.[] | {name, served}' / {"nam`
- L272-282 (10줄, lang=`diff`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `spec: /   data: /     - remoteRef:`
- L429-442 (13줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# ESO pods 상태 / kubectl get pods -n external-secrets / # NAME                                              READY   STATU`

### `goti-resale-phase4-step10-tests.md`

- 카테고리: challenge / 시리즈: goti-resale
- 블록 2개 / ASCII 31줄

- L96-114 (18줄, lang=`go`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `// Before: 조용히 리턴 (CI에서 통과로 보임) / func TestMain(m *testing.M) { /     db, err := setupTestDB()`
- L134-147 (13줄, lang=`go`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `func TestListingOrder_Upsert_OnStatusChange(t *testing.T) { /     // 초기 INSERT /     order := createTestListingOrder(t, `

### `eks-troubleshooting-part6-monitoring-2.md`

- 카테고리: monitoring / 시리즈: eks-troubleshooting
- 블록 3개 / ASCII 30줄

- L119-124 (5줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# k8s/helm/environments/prod.yaml / tempo: /   image:`
- L164-168 (4줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# 기존 설정 (2.x 호환) / limits_config: /   enforce_metric_name: false  # ← 3.x에서 삭제됨!`
- L377-398 (21줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────┐ / │                    Monitoring Stack                 `

### `goti-cloudflare-migration-adr.md`

- 카테고리: kubernetes / 시리즈: goti-cloudflare-migration
- 블록 2개 / ASCII 30줄

- L46-51 (5줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# 기대한 동작 / GET /api/users/999 → 404 {"error": "User not found"} / `
- L168-193 (25줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `                     ┌─ dev.go-ti.shop ──────────────────┐ /                      │                                    │`

### `istio-traffic-part4-retry-timeout.md`

- 카테고리: istio / 시리즈: istio-traffic
- 블록 2개 / ASCII 30줄

- L203-208 (5줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `retries: /   attempts: 3 /   perTryTimeout: 2s`
- L472-497 (25줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────────────────────────────────────────────────────┐ / │              Retry & Timeout 체크리스트              `

### `otel-monitoring-v3.md`

- 카테고리: monitoring / 시리즈: observability
- 블록 3개 / ASCII 30줄

- L36-59 (23줄, lang=`-`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌─────────────────┐      ┌─────────────────────────────────────┐ / │   Go Services   │─────▶│         OTEL Collector    `
- L143-149 (6줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `connectors: /   spanmetrics: /     histogram:`
- L383-384 (1줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `traces pipeline → spanmetrics connector → metrics pipeline → prometheusremotewrite`

### `goti-db-active-passive-with-read-split-adr.md`

- 카테고리: kubernetes / 시리즈: goti-multicloud-db
- 블록 1개 / ASCII 28줄

- L78-106 (28줄, lang=`text`, kind=**architecture**, decision=**keep**)
  - 샘플: `[정상 상태 — GCP primary] /  /   ┌──────────────────────────────────────────────────────────┐`

### `goti-synthetic-traffic.md`

- 카테고리: monitoring / 시리즈: goti-loadtest
- 블록 2개 / ASCII 27줄

- L95-111 (16줄, lang=`text`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌──────────────────────────────────┐ / │  CronJob: synthetic-traffic      │ / │  (*/5 * * * *, 4분 duration)     │`
- L134-145 (11줄, lang=`text`, kind=**tree**, decision=**keep**)
  - 샘플: `load-tests/ / ├── k8s/ / │   └── synthetic-traffic.yaml      # K8s 리소스 전체 (SA + AuthzPolicy + ConfigMap + CronJob)`

### `goti-cloudflare-migration-troubleshoot.md`

- 카테고리: kubernetes / 시리즈: goti-cloudflare-migration
- 블록 6개 / ASCII 26줄

- L122-124 (2줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `POST https://dev.go-ti.shop/api/v1/auth/reissue / → 405 Method Not Allowed`
- L152-154 (2줄, lang=`javascript`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `return new Response('Worker OK'); / // → 200 OK ✅`
- L159-163 (4줄, lang=`javascript`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `fetch('http://resshome.iptime.org/api/...', { /   headers: { 'Host': 'dev.go-ti.shop' } / });`
- L170-174 (4줄, lang=`javascript`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `fetch('http://118.38.182.85/api/...', { /   headers: { 'Host': 'dev.go-ti.shop' } / });`
- L179-181 (2줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `$ curl -H "Host: dev.go-ti.shop" http://resshome.iptime.org:80/api/v1/health / # → 200 JSON ✅`
- L272-284 (12줄, lang=`-`, kind=**tree**, decision=**keep**)
  - 샘플: `브라우저 /   ├─ dev.go-ti.shop (정적 파일) /   │   → Cloudflare Pages (*.pages.dev)`

### `goti-image-updater-multisource.md`

- 카테고리: argocd / 시리즈: goti-argocd-gitops
- 블록 4개 / ASCII 26줄

- L69-79 (10줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# multi-source 구조 / spec: /   sources:   # ← 복수형 (sources)`
- L89-99 (10줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# image-updater가 인식하는 구조 / spec: /   source:    # ← 단수형만 지원`
- L115-118 (3줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# environments/dev/goti-server/values.yaml / image: /   tag: "dev-b08daa9"  # dev-latest → dev-b08daa9`
- L230-233 (3줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `SSM 파라미터: /dev/server/JWT_SECRET /                           ↓ / K8s Secret key: _dev_server_JWT_SECRET`

### `istio-ambient-part4-wealist-migration.md`

- 카테고리: istio / 시리즈: istio-ambient
- 블록 2개 / ASCII 25줄

- L35-48 (13줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# EnvoyFilter 확인 / $ kubectl get envoyfilter -A / No resources found`
- L165-177 (12줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# 모든 Deployment 재시작 / $ kubectl rollout restart deployment -n default / `

### `cloudfront-s3-troubleshooting.md`

- 카테고리: kubernetes / 시리즈: eks-infra
- 블록 4개 / ASCII 23줄

- L43-48 (5줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `Request: /api/svc/storage/storage/folders/contents / Response Headers: /   server: AmazonS3`
- L72-79 (7줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `storage-service가 404 반환 /     ↓ / CloudFront가 403/404 감지`
- L173-177 (4줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# prod.yaml 구조 / storage-service:       # ← 이 키 아래 값은 umbrella chart용 /   config:`
- L355-362 (7줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `클라이언트 요청: /api/svc/storage/storage/folders/contents /                      ↓ / HTTPRoute 리라이트: /api/svc/storage/* → /*`

### `istio-traffic-part2-canary-ab.md`

- 카테고리: istio / 시리즈: istio-traffic
- 블록 1개 / ASCII 22줄

- L562-584 (22줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# 순서: DestinationRule → VirtualService / # VirtualService가 참조하는 subset이 먼저 존재해야 함 / `

### `goti-argocd-probe-crd-not-permitted.md`

- 카테고리: argocd / 시리즈: goti-argocd
- 블록 1개 / ASCII 21줄

- L79-100 (21줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# monitoring-project.yaml / spec: /   namespaceResourceWhitelist:`

### `istio-intro-part1-why-service-mesh.md`

- 카테고리: istio / 시리즈: istio-intro
- 블록 2개 / ASCII 21줄

- L30-42 (12줄, lang=`-`, kind=**box-small**, decision=**flatten**)
  - 샘플: `┌─────────────────────────────────────────────────────────────┐ / │                        단순한 세계                       `
- L89-98 (9줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `서킷브레이커 정책 변경 /     ↓ / 모든 서비스 코드 수정`

### `goti-pgbouncer-connection-pooling-adr.md`

- 카테고리: challenge / 시리즈: goti-pgbouncer
- 블록 2개 / ASCII 20줄

- L37-40 (3줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `6 Go 서비스 × HPA × per-pod pool = 논리적 peak 250+ 연결 / → max_connections 300에 빠르게 도달 / → 이후 연결 요청은 대기 또는 거부`
- L139-156 (17줄, lang=`text`, kind=**architecture**, decision=**keep**)
  - 샘플: `┌──────────┐   ┌──────────┐   ┌──────────┐ / │ ticketing│   │ stadium  │   │  user    │   (Go services) / └─────┬────┘  `

### `queue-poc-loadtest-part3-selection.md`

- 카테고리: kubernetes / 시리즈: queue-poc-loadtest
- 블록 1개 / ASCII 20줄

- L286-306 (20줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `{/* TODO: Draw.io로 교체 */} /  /                     B (ALB 직접)`

### `goti-harbor-imagepull-403-cloudflare-waf.md`

- 카테고리: kubernetes / 시리즈: goti-multicloud
- 블록 2개 / ASCII 19줄

- L226-236 (10줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `$ nslookup harbor.go-ti.shop  # (from EKS pod) / Name:    harbor.go-ti.shop / Address: 43.200.219.176    ← EC2 IP`
- L298-307 (9줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `EKS containerd가 harbor.go-ti.shop 이미지 pull 시도 /   │ /   ├─ [원인 1] Route53 Private Hosted Zone`

### `goti-kind-db-connection-false-negative.md`

- 카테고리: kubernetes / 시리즈: -
- 블록 3개 / ASCII 19줄

- L84-89 (5줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# sh (dash) — 항상 실패 (false negative) / sh -c 'cat < /dev/tcp/172.20.0.1/5432'   → FAIL / `
- L125-131 (6줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# 256Mi/512Mi → 384Mi/768Mi / resources: /   requests:`
- L156-164 (8줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# ❌ sh에서 /dev/tcp 미지원 → false negative / sh -c 'cat < /dev/tcp/HOST/PORT' / `

### `challenge2-wealist-migration-part5.md`

- 카테고리: challenge / 시리즈: challenge-2-wealist-migration
- 블록 2개 / ASCII 18줄

- L346-357 (11줄, lang=`-`, kind=**tree**, decision=**keep**)
  - 샘플: `wealist-chart/ / ├── Chart.yaml           # 차트 메타데이터 / ├── values.yaml          # 기본 설정값`
- L428-435 (7줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `개발 단계: / ConfigMap (평문) → Secret (Base64) → Helm (템플릿화) → Vault (암호화) / `

### `goti-db-failback-reverse-replication-adr.md`

- 카테고리: kubernetes / 시리즈: goti-multicloud-db
- 블록 1개 / ASCII 17줄

- L117-134 (17줄, lang=`text`, kind=**tree**, decision=**keep**)
  - 샘플: `[T3] GCP 복구 (VM 재기동, PostgreSQL 서비스 up) /   │ /   ├─▶ (1) GCP 쪽 subscription (죽어 있는 것) 정리`

### `goti-kafka-adoption-decision-adr.md`

- 카테고리: challenge / 시리즈: goti-kafka
- 블록 1개 / ASCII 15줄

- L176-191 (15줄, lang=`text`, kind=**tree**, decision=**keep**)
  - 샘플: `Strimzi 0.51.0 ── Kafka 4.1.0, 4.2.0 (default) /     │                  │ /     ├─ K8s >=1.30 ✅ (1.34 호환)`

### `goti-istio-injection-label-pg-max-connections.md`

- 카테고리: istio / 시리즈: goti-istio-ops
- 블록 2개 / ASCII 14줄

- L156-163 (7줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `서비스 5개 × replica 2 = 10 Pod / HikariCP maximumPoolSize 기본값 = 10 (Pod당) / → 최대 100 연결`
- L168-175 (7줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# DB 연결 정상 확인 / bash -c 'echo > /dev/tcp/172.20.0.1/5432' / # → 연결 성공`

### `goti-queue-loadtest-k6-two-phase-design.md`

- 카테고리: challenge / 시리즈: goti-queue-poc
- 블록 2개 / ASCII 14줄

- L88-89 (1줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `enterQueue() → waitForAdmission() → enterSeat() → [ticketing] → leaveQueue()`
- L139-152 (13줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `load-tests/ /   helpers/ /     queue-poc-c.js       # PR #309 대기열 액션`

### `websocket-token-refresh.md`

- 카테고리: kubernetes / 시리즈: eks-security
- 블록 2개 / ASCII 14줄

- L34-42 (8줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `🔌 [Chat WS] 연결 시도: wss://wealist.co.kr/api/svc/chat/...?token=eyJ... / ❌ WebSocket connection failed / 🔌 [Chat WS] 연결 `
- L93-99 (6줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `1. 토큰 만료됨 (exp: 30분 전) / 2. WebSocket 연결 끊김 (code: 1006) / 3. 재연결 시도 → localStorage에서 만료된 토큰 읽음`

### `challenge1-game-server-part7.md`

- 카테고리: challenge / 시리즈: game-server
- 블록 3개 / ASCII 13줄

- L72-76 (4줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `http://localhost/lobby  → game-lobby Service / http://localhost/room   → game-room Service / http://localhost/chat   → g`
- L199-206 (7줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `# rewrite-target 없으면 / 요청: http://localhost/lobby / 전달: http://game-lobby/lobby  ← 404 에러`
- L242-244 (2줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `lobby.game.example.com → game-lobby / chat.game.example.com  → game-chat`

### `goti-cutover-residual-bugs-smoke-7of7.md`

- 카테고리: challenge / 시리즈: goti-java-to-go
- 블록 2개 / ASCII 13줄

- L264-271 (7줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `✓ schedules            200 / ✓ signup (TestUser)    200 / ✓ signup returned token`
- L335-341 (6줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `Goti-go  0e318ee — feat(user): port TestUser endpoints / Goti-k8s 0f22245 — enable USER_TEST_USER_ENABLED / Goti-go  2b5`

### `goti-postgres-healthcheck-env.md`

- 카테고리: cicd / 시리즈: goti-ec2-deploy
- 블록 3개 / ASCII 13줄

- L48-54 (6줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# docker-compose.deploy.yml / postgres: /   environment:`
- L109-112 (3줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `$ ./scripts/validate-deploy.sh / [CHECK] Healthcheck 환경변수 정합성... /   postgres: $${POSTGRES_USER} → environment 키 확인 → PA`
- L121-125 (4줄, lang=`-`, kind=**misc**, decision=**flatten**)
  - 샘플: `environment: /   CONTAINER_VAR: ${HOST_VAR} /   ─────────────   ──────────`

### `pod-service-troubleshooting.md`

- 카테고리: kubernetes / 시리즈: -
- 블록 2개 / ASCII 13줄

- L90-96 (6줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# Service 설정 / spec: /   ports:`
- L101-108 (7줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `$ kubectl describe pod frontend-54f549658d-csr6c -n day1-challenge /  / Containers:`

### `goti-argocd-dashboard-zero-metrics.md`

- 카테고리: argocd / 시리즈: goti-argocd
- 블록 1개 / ASCII 12줄

- L37-49 (12줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# ArgoCD metrics Service 없음 / $ kubectl get svc -n argocd | grep metrics / (빈 결과)`

### `goti-load-test-db-realistic-data.md`

- 카테고리: challenge / 시리즈: goti-loadtest
- 블록 3개 / ASCII 12줄

- L113-118 (5줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# KBO 공식 사이트 AJAX 엔드포인트 활용 / # https://www.koreabaseball.com/ws/Schedule.asmx/GetScheduleList / # 2025 정규시즌 720경기 완료 데이터`
- L144-148 (4줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `game_ticketing_statuses: 'CLOSED' 없음 → 'TERMINATED' 사용 / users:                   'ROLE_MEMBER' → 'MEMBER', 'ACTIVE' → '`
- L171-174 (3줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# Docker 이미지 + 빌드 캐시 정리 / $ docker system prune -af --volumes / # → 약 45GB 확보`

### `goti-read-replica-split-adr.md`

- 카테고리: kubernetes / 시리즈: goti-multicloud-db
- 블록 1개 / ASCII 12줄

- L121-133 (12줄, lang=`text`, kind=**box-small**, decision=**flatten**)
  - 샘플: `                                       ┌─────────────────┐ /                                        │  RDS Primary    │ `

### `eks-troubleshooting-part1-dday.md`

- 카테고리: kubernetes / 시리즈: eks-troubleshooting
- 블록 2개 / ASCII 11줄

- L159-164 (5줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# k8s/helm/environments/prod.yaml / shared: /   config:`
- L316-322 (6줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# k8s/argocd/apps/prod/user-service.yaml / spec: /   source:`

### `goti-3000vu-2nd-and-next-checklist.md`

- 카테고리: challenge / 시리즈: goti-loadtest
- 블록 2개 / ASCII 11줄

- L89-94 (5줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# environments/prod/goti-ticketing-v2/values.yaml / - name: TICKETING_DATABASE_MAX_CONNS /   value: "18"        # 10 → 1`
- L101-107 (6줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# 권장: spot 노드 +3 (현재 5 → 8) / aws eks update-nodegroup-config \ /   --cluster-name goti-prod \`

### `goti-container-image-update-strategy-adr.md`

- 카테고리: argocd / 시리즈: -
- 블록 1개 / ASCII 11줄

- L207-218 (11줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `goti-server CI/CD /   → ECR에 dev-{sha} 태그로 이미지 push /   → (기존 흐름, 변경 없음)`

### `goti-eks-node-join-401-cluster-policy.md`

- 카테고리: kubernetes / 시리즈: goti-eks
- 블록 2개 / ASCII 11줄

- L138-144 (6줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `kubelet → STS 토큰 → API 서버 → Authenticator webhook /   → IAM Role 매칭 ✅ /   → username 템플릿 렌더링: {{EC2PrivateDNSName}}`
- L151-156 (5줄, lang=`hcl`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `# auto_mode OFF → Standard 정책 세트 (AmazonEKSClusterPolicy 포함) / eks_standard_iam_role_policies = { ... }  # !auto_mode_en`

### `goti-multicloud-db-replication-technology-adr.md`

- 카테고리: kubernetes / 시리즈: goti-multicloud-db
- 블록 1개 / ASCII 11줄

- L106-117 (11줄, lang=`text`, kind=**tree**, decision=**keep**)
  - 샘플: `[GCP — Primary] /   GCE VM (e2-standard-2, pd-balanced 20GB) /     ├─ PostgreSQL 16`

### `goti-signup-dtype-regression.md`

- 카테고리: challenge / 시리즈: goti-auth
- 블록 2개 / ASCII 11줄

- L125-134 (9줄, lang=`diff`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `- // dtype 컬럼은 Hibernate 기본값 'DTYPE VARCHAR(31)'으로 생성됨 ("MEMBER" 값 필수). / + // UserEntity에 @DiscriminatorColumn 선언 없음 → `
- L144-146 (2줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `06:40:44 POST /api/v1/auth/signup/sms/send → 200 (256ms) / 06:40:58 POST /api/v1/auth/signup          → 200 (30ms)`

### `goti-kafka-buffered-otel-pipeline.md`

- 카테고리: monitoring / 시리즈: goti-observability-ops
- 블록 4개 / ASCII 10줄

- L32-33 (1줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `App → Alloy (OTLP) → Mimir / Loki / Tempo`
- L56-57 (1줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `App → Alloy (OTLP) → Mimir / Loki / Tempo`
- L65-69 (4줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `App → Alloy Agent (otelcol.exporter.kafka) /         → Kafka (otlp_proto) /             → Alloy Gateway (otelcol.receive`
- L77-81 (4줄, lang=`text`, kind=**tree**, decision=**keep**)
  - 샘플: `App → Alloy Agent /         ├─ Metrics → 직접 Mimir (현재 구조 유지) /         ├─ Logs   → Kafka → Alloy Gateway → Loki`

### `goti-phase7-d-overturn-decision.md`

- 카테고리: challenge / 시리즈: goti-ticketing-phase
- 블록 2개 / ASCII 10줄

- L44-45 (1줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `Phase 6 ✅ → Phase 7 D-마감(보여주기용) → 끝`
- L61-70 (9줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `Phase 6 ✅ /   → Phase 6.5 신설 (Go 5서비스 prod 인프라 W1~W7)  ← 진입 차단 갭 해소 /   → Phase 7 재개 (Audit 풀세트 G1~G8)`

### `goti-poc-ab-test-dependency-isolation-pattern.md`

- 카테고리: challenge / 시리즈: -
- 블록 2개 / ASCII 10줄

- L39-41 (2줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `POST /api/v1/queue/poc-a/validate → 200 (대기열 통과) / POST /api/v1/ticketing/reserve    → 403 / 400 (ticketing 차단)`
- L168-176 (8줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `[문제] 공유 ticketing pod에 POC C의 ReservationSession 검증이 내장 /        → POC A 대기열을 통과한 요청이 ticketing에서 403/400 / `

### `goti-redis-sot-adoption-adr.md`

- 카테고리: challenge / 시리즈: goti-redis-sot
- 블록 2개 / ASCII 10줄

- L31-33 (2줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `GET /game-seats/{gameId}/sections/{sectionId}/seat-statuses / → 558~967ms (2026-04-17)`
- L167-175 (8줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `D0 인프라 /  → D1 seat_statuses /  → D2 seat_holds`

### `istio-ambient-part7-migration-to-sidecar.md`

- 카테고리: istio / 시리즈: istio-ambient
- 블록 2개 / ASCII 10줄

- L82-85 (3줄, lang=`hcl`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `resource "helm_release" "istiod" { /   # profile 설정 제거 → 기본값(default) 사용 / }`
- L180-187 (7줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# Sidecar 주입 여부 확인 / kubectl get pods -n wealist-prod -o jsonpath='{range .items[*]}{.metadata.name}: {.spec.containers[`

### `goti-istio-peerauth-selector-prometheus-503.md`

- 카테고리: istio / 시리즈: goti-istio-ops
- 블록 3개 / ASCII 9줄

- L40-43 (3줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `Prometheus targets → health: "down" / scrapeUrl: http://10.1.0.107:9090/metrics / lastError: "server returned HTTP statu`
- L87-91 (4줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `$ kubectl get servicemonitor -n monitoring / # goti-load-observer-prod 존재, release: kube-prometheus-stack-prod 라벨 정상 / `
- L114-116 (2줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `Prometheus targets → health: "down" / lastError: "server returned HTTP status 403 Forbidden"`

### `goti-jwks-distribution-automation-adr.md`

- 카테고리: istio / 시리즈: goti-auth
- 블록 1개 / ASCII 9줄

- L112-121 (9줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `Terraform apply / user-service key rotation /   → SSM /prod/server/JWT_JWKS 업데이트 (Terraform outputs) /   → GitHub Action`

### `goti-resale-istio-rbac-403.md`

- 카테고리: istio / 시리즈: goti-resale
- 블록 3개 / ASCII 9줄

- L36-40 (4줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `프론트 → GET /api/v1/tickets/myinfo → goti-ticketing /                                          ↓ (내부 RestClient 호출) /     `
- L63-64 (1줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `CUSTOM → DENY → ALLOW`
- L95-99 (4줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `excludePaths: /   - "/api/v1/resales/histories" /   - "/api/v1/resales/histories/*"`

### `goti-cloudfront-swagger-403.md`

- 카테고리: cicd / 시리즈: goti-cloudfront-alb
- 블록 2개 / ASCII 8줄

- L60-63 (3줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `/api/*          → ALB (goti-dev-alb) / /monitoring/*   → ALB (goti-dev-alb) / /* (default)    → S3 (프론트엔드)`
- L106-111 (5줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `/api/*          → ALB → goti-server:8080 / /swagger-ui/*   → ALB → goti-server:8080 / /v3/*           → ALB → goti-serve`

### `goti-phase6-redis-inventory.md`

- 카테고리: challenge / 시리즈: goti-redis-sot
- 블록 3개 / ASCII 8줄

- L30-31 (1줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `Redis Lock → DB TX { status + hold + ★inventory★ } → Unlock`
- L83-87 (4줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `Client A: HGET inventory:g1 grade_vip  → 1 / Client B: HGET inventory:g1 grade_vip  → 1 / Client A: HINCRBY inventory:g1`
- L98-101 (3줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `Before: Redis Lock → DB TX { status + hold + ★inventory★ } → Unlock / After:  Redis Lock → DB TX { status + hold } → Unl`

### `goti-phase6-ticketing-implementation.md`

- 카테고리: challenge / 시리즈: goti-ticketing-phase
- 블록 2개 / ASCII 8줄

- L73-75 (2줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `Java: seat_statuses(30만+ row) → IN절 + COUNT + GROUP BY / Go:   game_seat_inventories(900 row) → ANY($1) + SUM + GROUP BY`
- L187-193 (6줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `- GameRepo:       Save / Find + 중복 검사 / - InventoryRepo:  AdjustCounts 원자적 증감 + RemainingSeats 배치 조회 / - SeatHoldRepo:  `

### `goti-phase6-ticketing-sql-optimization.md`

- 카테고리: challenge / 시리즈: goti-ticketing-phase
- 블록 1개 / ASCII 8줄

- L175-183 (8줄, lang=`go`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `// Before: map 비결정적 순회 → deadlock 위험 / for grade, delta := range gradeDeltas { ... } / `

### `goti-resale-flow-end-to-end-fix.md`

- 카테고리: challenge / 시리즈: goti-resale
- 블록 1개 / ASCII 8줄

- L56-64 (8줄, lang=`go`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `// ticket_repo.go — EnrichForTicket / func (r *TicketRepository) EnrichForTicket(...) (*TicketEnrichment, error) { /    `

### `challenge2-wealist-migration-part3.md`

- 카테고리: challenge / 시리즈: challenge-2-wealist-migration
- 블록 2개 / ASCII 7줄

- L263-267 (4줄, lang=`-`, kind=**tree**, decision=**keep**)
  - 샘플: `my-app (namespace) / ├── frontend / ├── backend`
- L272-275 (3줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `postgresql-prod (namespace) ← 여러 앱이 공유 / board-api-prod (namespace) / user-api-prod (namespace)`

### `goti-argocd-ssa-diff-deployment-skip.md`

- 카테고리: argocd / 시리즈: goti-argocd
- 블록 1개 / ASCII 7줄

- L35-42 (7줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `# ArgoCD 리소스 상태 / Deployment    goti-queue-dev          OutOfSync  ← 변경 감지됨 / ExternalSecret goti-queue-dev-secrets OutO`

### `goti-docker-network-loki-healthcheck.md`

- 카테고리: cicd / 시리즈: goti-ec2-deploy
- 블록 1개 / ASCII 7줄

- L157-164 (7줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `[7/8] 서비스 헬스체크... /   ✓ Prometheus OK /   ✓ Grafana OK`

### `goti-eks-rolling-update-cascading-failures.md`

- 카테고리: kubernetes / 시리즈: goti-eks
- 블록 1개 / ASCII 7줄

- L96-103 (7줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `[terraform apply -target=module.config] /   → aws_security_group.this: inline ingress로 규칙 통합 ← Terraform state에 기록 / `

### `goti-poc-queue-a-401-ticketing-isolation.md`

- 카테고리: challenge / 시리즈: goti-queue-poc
- 블록 3개 / ASCII 7줄

- L50-51 (1줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `POST /api/v1/queue/poc-a/validate → 401 (empty body)`
- L69-74 (5줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `GET /api/v1/stadium-seats/.../seat-grades → 403 /   {"code":"CLIENT_ERROR","message":"좌석 조회는 대기열 입장 완료 후에만 가능합니다."} / `
- L161-162 (1줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `POST /api/v1/queue/poc-a/validate → 200 OK (isPassed=true, token 발급)`

### `github-actions-multi-platform-optimization.md`

- 카테고리: cicd / 시리즈: -
- 블록 1개 / ASCII 6줄

- L61-67 (6줄, lang=`-`, kind=**tree**, decision=**keep**)
  - 샘플: `GitHub Actions / ├── amd64 러너 (ubuntu-latest) / │   └── GOARCH=amd64 빌드 → 네이티브 → 빠름 ✅`

### `goti-ecr-secret-dollar-escape.md`

- 카테고리: argocd / 시리즈: goti-argocd-gitops
- 블록 3개 / ASCII 6줄

- L59-60 (1줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `ECR CronJob 실패 → ECR 토큰 갱신 불가 → ImagePullBackOff`
- L68-69 (1줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `ClusterSecretStore InvalidProviderConfig → ESO 전체 불능 → grafana-admin-secret 미생성`
- L100-104 (4줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# 쉘이 해석하는 과정 / "AKIA...X$abc123..." /          ^^^^^^^^`

### `goti-gcp-redis-recovery-jwt-unification.md`

- 카테고리: challenge / 시리즈: goti-multicloud
- 블록 1개 / ASCII 6줄

- L176-182 (6줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# Phase A: AWS SSM에서 키 추출 → /tmp/jwt-migration/ 임시 저장 / # Phase B: Terraform 코드 수정 (6 파일) / # Phase C: state rm tls_priv`

### `goti-metrics-collector-go-sidecar.md`

- 카테고리: monitoring / 시리즈: goti-metrics-collector
- 블록 1개 / ASCII 6줄

- L135-141 (6줄, lang=`-`, kind=**flow-diagram**, decision=**keep**)
  - 샘플: `PostgreSQL ──┐ /              ├── goti-metrics-collector (Go) ──→ :9090/metrics / Redis    ────┘         │`

### `goti-redis-sot-d0-d1-rollout.md`

- 카테고리: challenge / 시리즈: goti-redis-sot
- 블록 2개 / ASCII 6줄

- L174-176 (2줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `latency_ms: 62, 60, 69, 7, 8, 10, 15, 6, 28, 31, 37, 9, 27, 8, 10, 7, 28, 31, 37, 11, 9 / → 평균 20ms, 최대 70ms (첫 3건은 lazy`
- L187-191 (4줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `프론트: 966ms / 백엔드:  32ms (x-envoy-upstream-service-time) /        ────`

### `goti-signup-created-at-bug-and-sql-audit.md`

- 카테고리: challenge / 시리즈: goti-auth
- 블록 2개 / ASCII 6줄

- L34-38 (4줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `02:04:48 POST /sms/send → 200  (SMS 실제 발송) / 02:05:08 POST /signup   → 500  users.created_at NOT NULL 위반 / 02:06:39 POST`
- L44-46 (2줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `02:41:23 POST /signup → 500  social_providers.created_at NOT NULL 위반 / 02:41:33 UTC — CF 504 (Worker failover → AWS 빈 or`

### `challenge1-game-server-part2.md`

- 카테고리: challenge / 시리즈: game-server
- 블록 1개 / ASCII 5줄

- L176-181 (5줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# 민감하지 않은 정보 → ConfigMap / PORT: "8080" / `

### `goti-dashboard-query-validation-fixes.md`

- 카테고리: monitoring / 시리즈: goti-observability-ops
- 블록 1개 / ASCII 5줄

- L115-120 (5줄, lang=`promql`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `# Before (range vector 누락 → 파싱 에러) / rate(kafka_server_brokertopicmetrics_messagesinpersec{...}) / `

### `goti-hikaricp-otel-beanpostprocessor.md`

- 카테고리: monitoring / 시리즈: goti-spring-otel
- 블록 1개 / ASCII 5줄

- L80-85 (5줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `OTel DataSourcePostProcessor (After) /     → HikariDataSource를 OpenTelemetryDataSource로 래핑 /         → 우리 BPP (After)`

### `goti-java-to-go-cutover-smoke-trouble.md`

- 카테고리: challenge / 시리즈: goti-java-to-go
- 블록 1개 / ASCII 5줄

- L65-70 (5줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# Java 시크릿 키명 → Go env 키명 매핑 / GOOGLE_CLIENT       → OAUTH_GOOGLE_CLIENT_ID / GOOGLE_SECRET       → OAUTH_GOOGLE_CLIENT_`

### `goti-mimir-ingester-oom-webhook-deadlock.md`

- 카테고리: monitoring / 시리즈: goti-observability-stack
- 블록 1개 / ASCII 5줄

- L130-135 (5줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# rollout-operator 스케일 다운 + webhook 삭제 후 / sleep 60  # API server 캐시 만료 대기 / `

### `goti-monitoring-dashboard-nodata.md`

- 카테고리: monitoring / 시리즈: goti-otel-prometheus
- 블록 2개 / ASCII 5줄

- L75-78 (3줄, lang=`promql`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `# MSA 전환 후 깨지는 패턴 / sum(rate({5xx}[5m])) by (job) or vector(0) / # → vector(0)에 job 레이블 없음 → or 매칭 실패`
- L166-168 (2줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `Before: otelcol.exporter.loki → loki.write / After:  otelcol.exporter.loki → loki.process → loki.write`

### `goti-monitoring-pitfalls-system.md`

- 카테고리: monitoring / 시리즈: goti-observability-ops
- 블록 1개 / ASCII 5줄

- L181-186 (5줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# 대시보드 수정 후, push 전 (클러스터 불필요) / ./validate.sh --lint-only    # 오프라인 lint + 커버리지 / `

### `goti-phase8-p0-seat-booking-port.md`

- 카테고리: challenge / 시리즈: goti-ticketing-phase
- 블록 1개 / ASCII 5줄

- L163-168 (5줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `main 푸시 /   → cd-prod-aws.yml / cd-prod-gcp.yml 트리거 /   → deploy/prod 푸시 → Harbor 이미지 prod-13 빌드`

### `goti-tempo-scoped-tag-traceql-variable.md`

- 카테고리: monitoring / 시리즈: -
- 블록 1개 / ASCII 5줄

- L40-45 (5줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `# PromQL — Grafana가 변환해줌 ✅ / {__name__=~"val1|val2|val3"} / `

### `queue-poc-loadtest-part2-results.md`

- 카테고리: kubernetes / 시리즈: queue-poc-loadtest
- 블록 1개 / ASCII 5줄

- L76-81 (5줄, lang=`java`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `// Before — GenericJackson2JsonRedisSerializer가 ARGV를 이중 직렬화 / // Lua: HGET key "maxCapacity"  →  실제 전달: "\"maxCapacity\`

### `goti-dev-monitoring-502.md`

- 카테고리: cicd / 시리즈: goti-cloudfront-alb
- 블록 2개 / ASCII 4줄

- L38-40 (2줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `dev.go-ti.shop/monitoring/*  → 502 Bad Gateway / dev.go-ti.shop/api/*         → 502 Bad Gateway`
- L47-49 (2줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `ALB Target Group: goti-dev-grafana-tg → unhealthy (Health checks failed) / ALB Target Group: goti-dev-tg → unhealthy (He`

### `goti-metrics-collector-pipeline-e2e.md`

- 카테고리: monitoring / 시리즈: goti-metrics-collector
- 블록 1개 / ASCII 4줄

- L112-116 (4줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `# /metrics 응답 / goti_match_active_total 0 / goti_guardrail_blacklist_size 0`

### `goti-renovate-ecr-auth-failure.md`

- 카테고리: cicd / 시리즈: -
- 블록 1개 / ASCII 4줄

- L26-30 (4줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `goti-server CD → ECR push /               → Renovate: ECR 태그 조회 /               → Goti-k8s values.yaml 태그 업데이트 PR`

### `goti-tempo-oom-kafka-buffer-sampling.md`

- 카테고리: monitoring / 시리즈: goti-observability-stack
- 블록 1개 / ASCII 4줄

- L94-98 (4줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# tempo-values.yaml / resources: /   limits:`

### `goti-tempo-spanmetrics-batch-timeout.md`

- 카테고리: monitoring / 시리즈: goti-observability-stack
- 블록 1개 / ASCII 4줄

- L109-113 (4줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# alloy-values.yaml / batch "kafka_traces": /   timeout: "2s"  # 10s → 2s`

### `challenge2-wealist-migration-part2.md`

- 카테고리: challenge / 시리즈: challenge-2-wealist-migration
- 블록 1개 / ASCII 3줄

- L108-111 (3줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `postgres-0 → postgres-data-postgres-0 (5Gi) / postgres-1 → postgres-data-postgres-1 (5Gi) / postgres-2 → postgres-data-p`

### `goti-grafana-csrf-origin.md`

- 카테고리: cicd / 시리즈: goti-ec2-deploy
- 블록 1개 / ASCII 3줄

- L136-139 (3줄, lang=`bash`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `# PR #37 merge → Monitoring CD 실행 / $ curl -s -o /dev/null -w "%{http_code}" https://dev.go-ti.shop/monitoring/api/healt`

### `goti-node-rightsizing-and-rebalancing.md`

- 카테고리: kubernetes / 시리즈: goti-scaling
- 블록 1개 / ASCII 3줄

- L58-61 (3줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `"Number of overutilized nodes" totalNumber=7   ← 전 노드 CPU 95~100% / "Number of underutilized nodes" totalNumber=0 / "No `

### `goti-pgbouncer-rollout-and-load-test.md`

- 카테고리: challenge / 시리즈: goti-pgbouncer
- 블록 2개 / ASCII 3줄

- L114-115 (1줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `postgres://goti:-bh||...  → parse error: invalid URL`
- L344-346 (2줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `TICKETING_DATABASE_MAX_CONNS: 18 → 10 / (6 replica × 10 = 60 client 연결)`

### `goti-prometheus-job-label-mismatch.md`

- 카테고리: monitoring / 시리즈: goti-otel-prometheus
- 블록 2개 / ASCII 3줄

- L44-46 (2줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `goti:sli:availability:5m → result: [] / goti:apdex:score → result: []`
- L126-127 (1줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `goti-server → goti/goti-server`

### `goti-redis-sot-d2-d3-d4-rollout.md`

- 카테고리: challenge / 시리즈: goti-redis-sot
- 블록 2개 / ASCII 3줄

- L147-148 (1줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `inventory_sync_interval_ms: 60000  # 5000 → 60000`
- L190-192 (2줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `redis_sot: /   orders: true  # false → true`

### `goti-resale-fe-be-contract-audit.md`

- 카테고리: challenge / 시리즈: goti-resale
- 블록 1개 / ASCII 3줄

- L98-101 (3줄, lang=`go`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `// 백엔드 실제 응답 / response.Success(c, gin.H{"order": order, "listings": listings}) / // → { "order": {...}, "listings": [..`

### `challenge2-wealist-migration-part4.md`

- 카테고리: challenge / 시리즈: challenge-2-wealist-migration
- 블록 1개 / ASCII 2줄

- L170-172 (2줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `wealist.local/       → frontend-service / wealist.local/api/   → board-api-service`

### `goti-dev-loadtest-ssh-istio-turnstile.md`

- 카테고리: istio / 시리즈: goti-istio-ops
- 블록 2개 / ASCII 2줄

- L30-31 (1줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `맥(로컬) → SSH(2232) → Ubuntu 서버 → Kind 클러스터(goti-dev)`
- L56-57 (1줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `맥 localhost:18080 → SSH(2232) → Ubuntu → 172.20.0.2:31080(Kind NodePort) → Istio Gateway → Pod`

### `goti-prometheus-agent-mode-adr.md`

- 카테고리: monitoring / 시리즈: -
- 블록 1개 / ASCII 2줄

- L33-35 (2줄, lang=`text`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `App/Istio → Prometheus (scrape + 로컬 TSDB 2h + remote_write) → Mimir (장기 저장) / Grafana → Mimir query-frontend (datasource`

### `goti-session-dropout-root-cause-audit.md`

- 카테고리: challenge / 시리즈: goti-auth
- 블록 1개 / ASCII 2줄

- L57-59 (2줄, lang=`ts`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `// authStore.ts:180-195  syncAuthSession / // remainingSeconds <= 0 → reissue 시도 없이 즉시 clearAuth('expired')`

### `goti-3000vu-queue-oneshot.md`

- 카테고리: challenge / 시리즈: goti-queue-poc
- 블록 1개 / ASCII 1줄

- L143-144 (1줄, lang=`yaml`, kind=**code-arrow**, decision=**skip**)
  - 샘플: `TICKETING_DATABASE_MAX_CONNS: 10  # 18 → 10`

### `goti-virtualservice-fqdn-503.md`

- 카테고리: kubernetes / 시리즈: goti-kind-monitoring
- 블록 1개 / ASCII 1줄

- L42-43 (1줄, lang=`-`, kind=**arrow-only**, decision=**flatten**)
  - 샘플: `CloudFront → Kind PC:80 → Istio Gateway:31080 → Grafana`
