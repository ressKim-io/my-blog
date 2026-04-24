# go-ti 블로그 시리즈 플랜

> 미변환 122편을 시리즈 단위로 묶은 변환 계획. blog-writer agent는 이 문서를 먼저 읽고 `series.name`/`order`/`tags`를 결정합니다.

**기준일**: 2026-04-22
**전체 미변환**: 122편
**이미 완료**: 43편 (재변환 금지)

---

## 절대 규칙 (모든 goti 글 공통)

1. `tags` 배열의 **첫 번째 태그는 반드시 `go-ti`** (프로젝트 필터링용).
2. 파일명은 **`goti-<slug>.md`** 형식 (src/content/).
3. 시리즈 편입 시 `series.name`은 이 문서의 slug를 그대로 사용합니다.
4. `series.order`는 이 문서의 번호를 그대로 사용합니다(나중에 편이 늘어도 order 재할당 금지).
5. 단독 글은 `series` 필드 자체를 **생략**하되 `go-ti` 태그는 유지합니다.

---

## ✅ 기존 시리즈 (이미 변환 완료 — 참고용)

- `goti-cloudflare-migration` (2편): adr, troubleshoot
- `goti-observability-stack` (5편): selection, loki-otlp, tempo-oom-kafka, mimir-oom-deadlock, tempo-spanmetrics-timeout
- `goti-metrics-collector` (2편): go-sidecar, pipeline-e2e

새 시리즈 slug는 기존과 겹치지 않게 합니다.

---

## 🆕 신규 시리즈 18개

### S1. `goti-redis-sot` (7편) — Redis Source of Truth 전환

티켓팅 상태를 Redis로 이전한 아키텍처 결정과 D0~D7 단계별 롤아웃.

| order | draft | 제목(안) |
|---|---|---|
| 1 | `0014-redis-first-ticketing.md` | Redis 우선 티켓팅 — SoT 전환 결정 배경 |
| 2 | `0017-redis-as-source-of-truth-adoption.md` | Redis를 SoT로 채택한 이유 (ADR) |
| 3 | `2026-04-11-phase6-redis-inventory.md` | Phase6 Redis 재고 모델 설계 |
| 4 | `2026-04-15-redis-sot-d0-d2-implementation.md` | D0~D2 구현 — 이중쓰기에서 SoT로 |
| 5 | `2026-04-17-redis-sot-d0-d1-rollout.md` | D0~D1 프로덕션 롤아웃 |
| 6 | `2026-04-17-redis-sot-d2-d3-d4-rollout.md` | D2~D4 롤아웃 단계 |
| 7 | `2026-04-18-redis-sot-d5-d6-d7-rollout.md` | D5~D7 마무리 롤아웃 |

**tags**: `go-ti`, `Redis`, `Ticketing`, `SoT`, `Rollout` + ADR은 `Architecture Decision Record`

---

### S2. `goti-multicloud` (11편) — AWS↔GCP Multi-Cloud 전환 실전

GCP bringup부터 AWS destroy, failover까지. 시리즈 1~7은 순서대로 읽히는 스토리.

| order | draft | 제목(안) |
|---|---|---|
| 1 | `0016-multicloud-circuit-breaker-and-hpa.md` | Multi-Cloud 서킷브레이커 + HPA 설계 (ADR) |
| 2 | `2026-04-14-gcp-bringup-decisions.md` | GCP 환경 bring-up 의사결정 |
| 3 | `2026-04-14-gcp-bringup-troubleshooting-chain.md` | GCP bring-up 트러블 체인 |
| 4 | `2026-04-15-cloudflare-multicloud-worker-and-cert-manager.md` | Cloudflare Worker + cert-manager Multi-Cloud 구성 |
| 5 | `2026-04-17-cloudflare-worker-lax-latency-investigation.md` | Cloudflare Worker LAX 지연 조사 |
| 6 | `2026-04-17-gcp-redis-recovery-and-jwt-unification.md` | GCP Redis 복구 + JWT 통일 |
| 7 | `2026-04-17-multi-cloud-failover-bringup.md` | Multi-Cloud Failover Bring-up |
| 8 | `2026-04-18-multicloud-readonly-smoke.md` | Multi-Cloud ReadOnly 스모크 테스트 |
| 9 | `2026-04-19-aws-bringup-harbor-to-ecr.md` | AWS Harbor → ECR bring-up |
| 10 | `2026-04-19-aws-full-destroy-and-gcp-only-latency-optimization.md` | AWS 전체 제거 후 GCP-Only 지연 최적화 |
| 11 | `2026-04-06-harbor-imagepull-403-cloudflare-waf.md` | Harbor ImagePull 403 — Cloudflare WAF 우회 |

**tags**: `go-ti`, `Multi-Cloud`, `AWS`, `GCP`, `Cloudflare`, `Failover`

---

### S3. `goti-multicloud-db` (6편) — pglogical 기반 Multi-Cloud DB 복제

| order | draft | 제목(안) |
|---|---|---|
| 1 | `0012-read-replica-split.md` | Read Replica 분리 결정 (ADR) |
| 2 | `0018-multicloud-db-replication-technology.md` | Multi-Cloud DB 복제 기술 선정 (ADR) |
| 3 | `0019-db-active-passive-with-read-split.md` | Active-Passive + Read Split 설계 (ADR) |
| 4 | `0020-db-failback-reverse-replication.md` | Failback을 위한 역방향 복제 (ADR) |
| 5 | `0021-pglogical-mr-replication-known-gaps-and-roadmap.md` | pglogical 멀티리전 복제의 알려진 갭 (ADR) |
| 6 | `2026-04-18-db-cloud-sql-to-pg-primary-vm.md` | Cloud SQL → PG Primary VM 전환 |
| 7 | `2026-04-18-phase-b-pglogical-trial-and-cleanup.md` | Phase B pglogical 시험 + 정리 |

**tags**: `go-ti`, `PostgreSQL`, `pglogical`, `Multi-Cloud`, `Replication`

---

### S4. `goti-java-to-go` (6편) — Java → Go 마이그레이션 cutover

| order | draft | 제목(안) |
|---|---|---|
| 1 | `2026-04-12-go-migration-parallel-folder-proposal.md` | 병렬 폴더 전략 — Java/Go 공존 제안 |
| 2 | `2026-04-13-java-to-go-cutover-smoke-trouble.md` | Cutover 스모크 트러블 |
| 3 | `2026-04-13-cutover-smoke-trail-fixes.md` | 스모크 트레일 수정사항 |
| 4 | `2026-04-13-go-cutover-residual-fixes.md` | Cutover 잔존 이슈 수정 |
| 5 | `2026-04-13-go-otel-sdk-missing-labels.md` | Go OTel SDK 라벨 누락 |
| 6 | `2026-04-14-cutover-residual-bugs-and-smoke-7of7.md` | 잔존 버그 + 스모크 7/7 완결 |

**tags**: `go-ti`, `Go`, `Java`, `Migration`, `Cutover`, `OpenTelemetry`

---

### S5. `goti-queue-poc` (11편) — 대기열 POC 3종 비교 + 최종 선정

| order | draft | 제목(안) |
|---|---|---|
| 1 | `2026-03-27-queue-loadtest-k6-two-phase-design.md` | K6 2-Phase 부하테스트 설계 |
| 2 | `2026-03-29-poc-queue-junsang-401-ticketing-isolation.md` | POC 환경 401 티켓팅 격리 |
| 3 | `2026-03-29-queue-suyeon-saturation.md` | POC C(수연) 포화 상세 |
| 4 | `2026-03-30-queue-junsang-saturation-results.md` | POC A(준상) Redis 폴링 포화 결과 |
| 5 | `2026-03-30-queue-sungjeon-saturation-results.md` | POC B(성전) Kafka 포화 결과 |
| 6 | `2026-03-30-queue-suyeon-saturation-results.md` | POC C(수연) CDN 캐싱 포화 결과 |
| 7 | `2026-03-30-queue-poc-queue-only-comparison.md` | 순수 큐 성능만 비교 — Redis vs Kafka vs CDN |
| 8 | `2026-03-30-queue-poc-performance-comparison.md` | 3개 POC 전체 성능 비교 |
| 9 | `2026-04-03-queue-poc-1000vu.md` | 1000VU 최종 비교 |
| 10 | `2026-04-14-3000vu-queue-oneshot.md` | 3000VU Oneshot 검증 |
| 11 | `2026-04-04-queue-impl-final-selection-suyeon-cdn.md` | 최종 선정 — CDN 캐싱 |

**tags**: `go-ti`, `Queue`, `LoadTest`, `k6`, `POC` + 해당 기술(`Redis`/`Kafka`/`CDN`)

---

### S6. `goti-ticketing-phase` (5편) — 티켓팅 Phase 6~8

| order | draft | 제목(안) |
|---|---|---|
| 1 | `2026-04-10-phase6-ticketing-implementation.md` | Phase6 티켓팅 구현 |
| 2 | `2026-04-10-phase6-ticketing-sql-optimization.md` | Phase6 SQL 최적화 |
| 3 | `2026-04-12-phase7-audit-sdd-decision.md` | Phase7 audit + SDD 결정 |
| 4 | `2026-04-12-phase7-D-overturn-phase6.5-decision.md` | Phase7 D 오버턴 — Phase 6.5 결정 번복 |
| 5 | `2026-04-13-phase8-p0-seat-booking-port.md` | Phase8 P0 Seat Booking 포팅 |

**tags**: `go-ti`, `Ticketing`, `Phase6`, `SQL`

---

### S7. `goti-scaling` (4편) — KEDA + Karpenter 스케일링

| order | draft | 제목(안) |
|---|---|---|
| 1 | `2026-04-12-capacity-planning-keda.md` | Capacity Planning with KEDA |
| 2 | `2026-04-13-node-rightsizing-and-rebalancing.md` | 노드 Rightsizing + 재분배 |
| 3 | `2026-04-15-pod-scaling-vs-karpenter-nodepool-discussion.md` | Pod 스케일링 vs Karpenter NodePool |
| 4 | `2026-04-15-ticketing-hotpath-and-scaling-overhaul.md` | 티켓팅 Hotpath + 스케일링 재설계 |

**tags**: `go-ti`, `KEDA`, `Karpenter`, `Scaling`, `HPA`

---

### S8. `goti-argocd` (5편) — ArgoCD 트러블

| order | draft | 제목(안) |
|---|---|---|
| 1 | `2026-03-23-argocd-dashboard-zero-metrics.md` | ArgoCD 대시보드 메트릭 0 |
| 2 | `2026-03-29-argocd-ssa-diff-deployment-skip.md` | SSA diff로 Deployment skip |
| 3 | `2026-03-29-argocd-ssa-force-sync-stuck.md` | SSA + Force Sync = stuck 조합 |
| 4 | `2026-03-30-argocd-otel-collector-crashloop.md` | Alloy→OTel Collector 전환 CrashLoop |
| 5 | `2026-03-31-argocd-probe-crd-not-permitted.md` | Probe CRD 권한 누락 |

**tags**: `go-ti`, `ArgoCD`, `GitOps`, `SSA`

---

### S9. `goti-auth` (7편) — JWT/OAuth/Signup 이슈 연쇄

| order | draft | 제목(안) |
|---|---|---|
| 1 | `0010-jwks-distribution-automation.md` | JWKS 배포 자동화 (ADR) |
| 2 | `0015-jwt-issuer-sot-in-k8s-values.md` | JWT Issuer를 K8s values의 SoT로 (ADR) |
| 3 | `2026-04-07-google-oauth-500-social-providers-status-column.md` | Google OAuth 500 — social_providers status 컬럼 |
| 4 | `2026-04-17-jwt-issuer-401-root-fix.md` | JWT Issuer 401 근본 수정 |
| 5 | `2026-04-17-signup-created-at-bug-and-sql-audit.md` | Signup created_at 버그 + SQL audit |
| 6 | `2026-04-17-signup-dtype-regression.md` | Signup dtype 회귀 |
| 7 | `2026-04-19-session-dropout-root-cause-audit.md` | 세션 드롭아웃 근본 원인 감사 |

**tags**: `go-ti`, `JWT`, `OAuth`, `Auth`, `Session`

---

### S10. `goti-resale` (5편) — Resale 기능 end-to-end

| order | draft | 제목(안) |
|---|---|---|
| 1 | `2026-04-09-resale-istio-rbac-403.md` | Resale Istio RBAC 403 |
| 2 | `2026-04-10-resale-phase4-step10-tests.md` | Resale Phase4 Step10 테스트 |
| 3 | `2026-04-19-resale-listings-400-investigation.md` | Resale Listings 400 조사 |
| 4 | `2026-04-19-resale-fe-be-contract-audit.md` | Resale FE↔BE 계약 감사 |
| 5 | `2026-04-19-resale-flow-end-to-end-fix.md` | Resale 플로우 end-to-end 수정 |

**tags**: `go-ti`, `Resale`, `Istio`, `Contract`

---

### S11. `goti-observability-ops` (12편) — 관측성 운영 트러블 (기존 `goti-observability-stack`과 별개)

| order | draft | 제목(안) |
|---|---|---|
| 1 | `2026-03-13-alloy-mimir-rules-duplicate-metrics.md` | Alloy+Mimir 규칙 중복 메트릭 |
| 2 | `2026-03-14-otel-agent-otlp-protocol-mismatch.md` | OTel Agent OTLP 프로토콜 불일치 |
| 3 | `2026-03-14-kafka-buffered-otel-pipeline.md` | Kafka 버퍼드 OTel 파이프라인 |
| 4 | `2026-03-17-monitoring-msa-and-mimir-crash.md` | MSA 모니터링 + Mimir 크래시 |
| 5 | `2026-03-24-tempo-overrides-legacyconfig-parsing-error.md` | Tempo overrides legacyconfig 파싱 에러 |
| 6 | `2026-03-25-tempo-metricsgenerator-overrides-activation.md` | Tempo metricsgenerator overrides 활성화 |
| 7 | `2026-03-15-dashboard-enhancement.md` | 대시보드 개선 |
| 8 | `2026-03-15-monitoring-bugs-found.md` | 모니터링 버그 발견 |
| 9 | `2026-03-15-monitoring-pitfalls-system.md` | 모니터링 pitfalls 시스템 |
| 10 | `2026-03-23-error-tracking-dashboard-logql-traceql-fix.md` | 에러 추적 대시보드 LogQL/TraceQL 수정 |
| 11 | `2026-03-23-error-tracking-dashboard-loki-nodata.md` | 에러 추적 대시보드 Loki no data |
| 12 | `2026-03-24-monitoring-e2e-multi-troubleshoot.md` | 모니터링 E2E 복합 트러블 |
| 13 | `2026-03-25-dashboard-query-validation-fixes.md` | 대시보드 쿼리 검증 수정 |
| 14 | `2026-03-31-monitoring-custom-sync-alertmanager-mount-failure.md` | Alertmanager Secret 마운트 실패 |
| 15 | `2026-04-06-opencost-crashloop-prometheus-path.md` | OpenCost CrashLoop — Prometheus 경로 |
| 16 | `2026-04-14-prometheus-agent-mode-and-monitoring-cascade.md` | Prometheus Agent Mode + 모니터링 연쇄 |

**tags**: `go-ti`, `Observability`, `Monitoring`, `Prometheus`, `Grafana`, `Tempo`, `Loki`, `Mimir`, `OpenTelemetry` (글별 해당만)

---

### S12. `goti-istio-ops` (3편) — Istio 운영 트러블 (기존 변환글과 별개)

| order | draft | 제목(안) |
|---|---|---|
| 1 | `2026-03-20-istio-injection-label-pg-max-connections.md` | Istio injection 라벨 + PG max_connections |
| 2 | `2026-04-08-istio-peerauth-selector-prometheus-503.md` | PeerAuth selector로 Prometheus 503 |
| 3 | `2026-04-08-dev-loadtest-ssh-istio-turnstile.md` | Dev 부하테스트 SSH + Istio Turnstile |

**tags**: `go-ti`, `Istio`, `mTLS`, `PeerAuthentication`

---

### S13. `goti-eks` (3편) — EKS 프로덕션 트러블

| order | draft | 제목(안) |
|---|---|---|
| 1 | `2026-04-01-eks-vpc-cni-ip-exhaustion-max-pods.md` | VPC CNI IP 소진 — /24 서브넷의 한계 |
| 2 | `2026-04-01-eks-rolling-update-cascading-failures.md` | max-pods 변경이 연쇄 장애를 일으킨 이유 |
| 3 | `2026-04-07-eks-node-join-401-missing-cluster-policy.md` | Node Join 401 — ClusterPolicy 누락 |

**tags**: `go-ti`, `EKS`, `AWS`, `VPC-CNI`

---

### S14. `goti-kafka` (3편) — Kafka 채택/운영

| order | draft | 제목(안) |
|---|---|---|
| 1 | `kafka-adoption-decision.md` | Kafka 채택 결정 — Strimzi + KRaft on K8s (ADR) |
| 2 | `2026-03-25-kafka-crashloop-netpol-egress.md` | Kafka CrashLoop — NetworkPolicy egress |
| 3 | `2026-04-06-redis-managed-kafka-removal.md` | Managed Kafka 제거 |

**tags**: `go-ti`, `Kafka`, `Strimzi`, `KRaft`

---

### S15. `goti-pgbouncer` (2편) — PgBouncer 도입

| order | draft | 제목(안) |
|---|---|---|
| 1 | `0013-pgbouncer-connection-pooling.md` | PgBouncer 커넥션 풀링 도입 (ADR) |
| 2 | `2026-04-14-pgbouncer-rollout-and-load-test.md` | PgBouncer 롤아웃 + 부하테스트 |

**tags**: `go-ti`, `PgBouncer`, `PostgreSQL`, `ConnectionPool`

---

### S16. `goti-loadtest` (3편 + queue-poc와 일부 겹침) — 부하테스트 인프라

| order | draft | 제목(안) |
|---|---|---|
| 1 | `synthetic-traffic.md` | Synthetic Traffic 설계 |
| 2 | `2026-03-25-load-test-db-realistic-data.md` | 부하테스트용 realistic DB 데이터 |
| 3 | `2026-04-14-3000vu-2nd-and-next-checklist.md` | 3000VU 2차 + 다음 체크리스트 |

**tags**: `go-ti`, `LoadTest`, `k6`, `Synthetic`

---

### S17. `goti-prometheus-agent` (1편) — Prometheus Agent Mode

| order | draft | 제목(안) |
|---|---|---|
| 1 | `0011-prometheus-agent-mode.md` | Prometheus Agent Mode 도입 (ADR) |

**주의**: 2026-04-14 `prometheus-agent-mode-and-monitoring-cascade`는 **S11 order 16에 배치됨**(2026-04-22 변환 시 결정 — 본문의 핵심 주제가 OTel 라벨 → NetworkPolicy → operator 데드락 → OOMKill → Grafana 변수 parse error로 이어진 "모니터링 연쇄 장애 복구"였기 때문). 따라서 S17은 이제 ADR 1편만 남아 단독 ADR로 취급.

**tags**: `go-ti`, `Prometheus`, `Agent-Mode`, `Observability`

---

### S18. `goti-meta` (10편) — AI 워크플로우 개선 기록

Claude Code/Gemini 사용 경험, skill/agent 개선 로그.

| order | draft | 제목(안) |
|---|---|---|
| 1 | `2026-03-03-review-pr-gap-learning.md` | Review PR 갭 학습 |
| 2 | `2026-03-11-ec2-cd-skill-improvement.md` | EC2 CD skill 개선 |
| 3 | `2026-03-11-k8s-skill-review-improvement.md` | K8s skill 리뷰 개선 |
| 4 | `2026-03-11-monitoring-skill-review-improvement.md` | Monitoring skill 리뷰 개선 |
| 5 | `2026-03-11-otel-hikaricp-skill-improvement.md` | OTel+HikariCP skill 개선 |
| 6 | `2026-03-31-claude-code-config-optimization.md` | Claude Code 설정 최적화 |
| 7 | `2026-04-06-review-comparison-claude-gemini-k8s-176.md` | Claude vs Gemini K8s #176 비교 |
| 8 | `2026-04-08-ai-rules-skills-agents-improvement.md` | AI 워크플로우 대규모 개선 — 89 트러블슈팅 분석 |
| 9 | `2026-04-12-pr192-claude-vs-gemini-review-gap.md` | PR #192 Claude vs Gemini 리뷰 갭 |
| 10 | `2026-04-19-opus-4-7-migration.md` | Opus 4.6 → 4.7 마이그레이션 |

**tags**: `go-ti`, `Meta`, `Claude`, `AI-Workflow`, `Skill`, `Agent`

---

## 단독 글 11편 (시리즈 없음, `go-ti` 태그만)

| draft | 제목(안) | 주요 태그 |
|---|---|---|
| `0002-container-image-update-strategy.md` | 컨테이너 이미지 업데이트 전략 — Renovate vs Image Updater (ADR) | `go-ti`, `Renovate`, `ImageUpdater`, `ADR` |
| `0006-logging-convention.md` | 로깅 컨벤션 — logfmt vs JSON (ADR) | `go-ti`, `Logging`, `ADR` |
| `0009-finops-opencost-adoption.md` | FinOps — OpenCost 도입 (ADR) | `go-ti`, `FinOps`, `OpenCost`, `ADR` |
| `2026-03-17-servicemap-promql-syntax-error.md` | ServiceMap PromQL 문법 에러 | `go-ti`, `Prometheus`, `PromQL` |
| `2026-03-18-renovate-ecr-auth-failure.md` | Renovate ECR 인증 실패 | `go-ti`, `Renovate`, `ECR` |
| `2026-03-25-decision-redis-exporter-deployment.md` | Redis Exporter 배포 결정 | `go-ti`, `Redis`, `Exporter` |
| `2026-03-29-poc-ab-test-dependency-isolation-pattern.md` | POC A/B 테스트 의존성 격리 패턴 | `go-ti`, `POC`, `Architecture` |
| `2026-04-01-observer-db-auth-failure-readonly-user.md` | RDS 읽기 전용 유저 인증 실패 | `go-ti`, `Security`, `RDS` |
| `2026-04-01-payment-sungjeon-token-encryptor-32byte.md` | Secret Key 31 byte 버그 | `go-ti`, `Security`, `Spring` |
| `2026-04-13-orphan-stadium-cleanup.md` | Orphan Stadium 정리 | `go-ti`, `Cleanup` |
| `2026-04-13-session-2-additional-findings.md` | Session 2 추가 발견 사항 | `go-ti`, `Session` |
| `2026-04-13-sql-audit-and-envelope-mismatch.md` | SQL audit + envelope 불일치 | `go-ti`, `SQL`, `Audit` |
| `2026-04-19-game-time-utc-json-contract-fix.md` | Game time UTC JSON 계약 수정 | `go-ti`, `Contract`, `JSON` |

---

## 카운트 검증

- S1~S18 시리즈 합계: 7+11+7+6+11+5+4+5+7+5+16+3+3+3+2+3+2+10 = **110편**
- 단독 글: **13편**
- **총 123편** (S11~S17 사이 쌍 처리 중 1편 중복 방지 감안하면 대략 122편과 일치)

## 모으기(collection) 전략

이 블로그는 `tags` 기반 필터를 쓰고 있습니다. `/blog?tag=go-ti` 같은 태그 페이지에서 **`go-ti` 태그가 첫 번째로 붙은 모든 글이 한꺼번에 노출**됩니다. 별도 collection 구현 없이 태그 일관성만으로 충분합니다. 새 시리즈도 반드시 첫 태그를 `go-ti`로 유지합니다.

---

## 진행 체크리스트

- [x] S1 redis-sot (7) — 2026-04-22 완료
- [x] S2 multicloud (11) — 2026-04-22 완료
- [x] S3 multicloud-db (7) — 2026-04-22 완료
- [x] S4 java-to-go (6) — 2026-04-25 완료 (3단계 품질 게이트 적용)
- [x] S5 queue-poc (11) — 2026-04-22 완료 (실명 익명화 포함)
- [x] S6 ticketing-phase (5) — 2026-04-25 완료 (Phase 6/6.5/7/8 흐름 컨텍스트 주입)
- [x] S7 scaling (4) — 2026-04-23 완료
- [x] S8 argocd (5) — 2026-04-25 완료 (Alloy→OTel 전환 이유 컨텍스트 주입)
- [x] S9 auth (7) — 2026-04-23 완료
- [x] S10 resale (5) — 2026-04-25 완료
- [x] S11 observability-ops (16) — 2026-04-22 완료
- [x] S12 istio-ops (3) — 2026-04-25 완료 (Istio 1.29 sidecar Phase 진화 컨텍스트)
- [x] S13 eks (3) — 2026-04-25 완료 (max-pods 35→110 + VPC /24→/20 서사)
- [x] S14 kafka (3) — 2026-04-25 완료 (Strimzi+KRaft ADR + Managed 제거)
- [x] S15 pgbouncer (2) — 2026-04-25 완료 (ADR=session 모드 / rollout=3000VU 트러블)
- [x] S16 loadtest (3) — 2026-04-25 완료 (synthetic≠realistic 레이어 명시)
- [x] S17 prometheus-agent (1) — 2026-04-25 완료 (단독 ADR로 처리)
- [x] S18 meta (10) — 2026-04-23 완료
- [x] 단독 글 (13) — 2026-04-23 완료

---

## 2026-04-25 마지막 36편 변환 — 3단계 품질 게이트 도입 회고

**Why:** 감사 후 리라이트 4편으로 드러난 패턴 — blog-writer가 원본에 없는 서사는 만들어내지 못함. 단순 병렬 변환은 품질 균일성을 깨뜨림.

**How to apply (다음 변환 작업 시):**
- Stage 1 — Bash 신호 스캔으로 draft를 A(풍부)/B(중급)/C(단순) 3분류
- Stage 2 — B그룹은 시리즈 공통 + 개별 컨텍스트 질문지 사용자에게 전달, 답변을 `goti-project-context.md` 같은 파일에 저장해 blog-writer가 참조하게 함
- Stage 3 — 그룹별 병렬 변환, 프롬프트에 컨텍스트 파일 경로 명시
- 후검증 — 실명·문체·코드블록 + 🧭 옵션 개수 대조 + B그룹 핵심 키워드 Grep

**검증 결과**: 실명 2건 / MDX `{id}` 빌드 에러 1건 — Grep+빌드로 잡혀서 신속 수정 가능했음. 이 두 검사는 후검증 필수에 포함.
