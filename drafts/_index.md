# Blog Drafts Index

최종 업데이트: 2026-04-05
소스: `goti-team-controller/docs/dev-logs/` + `docs/adr/`

---

## 상태 범례

- ⬜ 미작성 — 원본 로그만 있음, 블로그 형태로 미가공
- 🟡 작성중 — 블로그 글로 변환 중
- ✅ 발행 — 블로그에 게시 완료

---

## ADR (의사결정) — 10편

| 상태 | 파일 | 블로그 제목 (안) | 시리즈 |
|------|------|-----------------|--------|
| ⬜ | `0001-istio-service-mesh.md` | 왜 Istio를 선택했나 — Service Mesh 도입 결정 | Istio |
| ⬜ | `0002-container-image-update-strategy.md` | 컨테이너 이미지 업데이트 전략 — Renovate vs Image Updater | K8s |
| ⬜ | `0003-metrics-collector-go-sidecar.md` | Spring Boot 모놀리스 옆에 Go 메트릭 수집기를 따로 만든 이유 | Observability |
| ⬜ | `0004-observability-stack-selection.md` | 왜 Grafana LGTM+ 스택을 선택했나 (Mimir/Loki/Tempo/Alloy) | Observability |
| ⬜ | `0005-cloudflare-cdn-migration.md` | CloudFront에서 Cloudflare로 — CDN 전환 삽질기 | Infra |
| ⬜ | `0006-logging-convention.md` | 로깅 컨벤션 — logfmt vs JSON, 무엇을 남길 것인가 | Observability |
| ⬜ | `0007-alloy-to-otel-collector.md` | Alloy에서 OTel Collector로 전환한 이유 | Observability |
| ⬜ | `0008-loki-tempo-stability-tuning.md` | Loki/Tempo 안정성 튜닝 — OOM과의 전쟁 | Observability |
| ⬜ | `0009-finops-opencost-adoption.md` | FinOps — OpenCost 도입 결정 | FinOps |
| ⬜ | `kafka-adoption-decision.md` | Kafka 도입 결정 — Strimzi + KRaft on K8s | Architecture |

---

## 트러블슈팅 — 최고 추천 (5/5)

| 상태 | 파일 | 블로그 제목 (안) | 시리즈 |
|------|------|-----------------|--------|
| ⬜ | `2026-03-23-mimir-ingester-oom-webhook-deadlock.md` | Mimir Ingester OOM인데 스케일업도 안 된다 — webhook 데드락 해부 | Observability |
| ⬜ | `2026-03-20-kind-db-connection-diagnosis-false-negative.md` | DB 연결 안 됨? 아니, 디버깅 도구가 거짓말하고 있었다 (sh vs bash) | Debugging |
| ⬜ | `2026-03-26-metrics-collector-pipeline-e2e-troubleshoot.md` | Istio + NetworkPolicy + AuthorizationPolicy 3중 방어 뚫고 메트릭 개통하기 | K8s |
| ⬜ | `2026-03-26-tempo-spanmetrics-batch-timeout-ingestion-slack.md` | 140만 span이 전부 버려진 이유 — batch timeout 2초의 차이 | Observability |

---

## 트러블슈팅 — 강력 추천 (4/5)

| 상태 | 파일 | 블로그 제목 (안) | 시리즈 |
|------|------|-----------------|--------|
| ⬜ | `2026-03-25-tempo-oom-kafka-buffer-sampling.md` | Tempo OOM 해결기 — Kafka 버퍼 + tail sampling 아키텍처 | Observability |
| ⬜ | `2026-03-22-kubectl-toleration-imagepullbackoff.md` | kubectl로 직접 수정했더니 ImagePullBackOff — GitOps drift의 대가 | K8s |
| ⬜ | `2026-03-23-netpol-kube-api-dnat.md` | NetworkPolicy가 안 먹힌다? kube-proxy DNAT 평가 순서의 함정 | K8s |
| ⬜ | `2026-03-13-loki-otlp-native-migration.md` | Loki 로그 수집을 OTel 네이티브로 전환한 이유와 과정 | Observability |
| ⬜ | `2026-03-15-tempo-scoped-tag-traceql-variable.md` | TraceQL =~ 연산자가 Grafana 변수와 안 되는 이유 | Observability |
| ⬜ | `2026-03-09-monitoring-dashboard-nodata-comprehensive.md` | Grafana 대시보드 No Data 5건을 한 번에 잡은 이야기 | Observability |
| ⬜ | `2026-02-28-otel-sdk-version-conflict.md` | Spring Boot가 OTel SDK를 몰래 다운그레이드한다 | Spring |
| ⬜ | `2026-03-06-otel-label-mismatch.md` | OTel service.name이 Prometheus에서 job이 되는 이유 | Observability |
| ⬜ | `2026-03-25-cloudflare-migration-api-routing-troubleshoot.md` | Cloudflare Workers의 Host 헤더는 바꿀 수 없다 | Infra |
| ⬜ | `2026-03-12-image-updater-multisource.md` | ArgoCD Image Updater가 multi-source를 지원 안 한다고? | K8s |
| ⬜ | `2026-03-09-hikaricp-otel-beanpostprocessor.md` | HikariCP 메트릭이 안 잡히는 이유 — Spring BeanPostProcessor 순서의 비밀 | Spring |

---

## 시리즈 구성 (안) — 전체

### Observability 시리즈 (ADR 1 + 트러블슈팅 8 + 신규 2 = 11편)
1. `0004` 왜 Grafana LGTM+ 스택을 선택했나 ← 시리즈 인트로
2. `otel-label-mismatch` OTel → Prometheus 레이블 매핑
3. `otel-sdk-version-conflict` Spring Boot + OTel SDK 버전 충돌
4. `monitoring-dashboard-nodata-comprehensive` No Data 5건 종합
5. `loki-otlp-native-migration` Loki OTLP 네이티브 전환
6. `tempo-scoped-tag-traceql-variable` TraceQL 변수 비호환
7. `mimir-ingester-oom-webhook-deadlock` Mimir webhook 데드락
8. `tempo-oom-kafka-buffer-sampling` Tempo OOM + Kafka 버퍼
9. `tempo-spanmetrics-batch-timeout-ingestion-slack` 배치 타임아웃 유실

10. `argocd-otel-collector-crashloop` Alloy→OTel Collector 전환 CrashLoop
11. `discord-alerting-architecture` Discord 알림 아키텍처 설계

### Go 메트릭 수집기 시리즈 (ADR 1 + 트러블슈팅 1 = 2편)
1. `0003` 왜 Go로 따로 만들었나
2. `metrics-collector-pipeline-e2e-troubleshoot` 3-Layer 방어 개통기

### K8s 트러블슈팅 시리즈 (3 + 신규 2 = 5편)
1. `kubectl-toleration-imagepullbackoff` GitOps drift
2. `netpol-kube-api-dnat` NetworkPolicy DNAT
3. `image-updater-multisource` ArgoCD Image Updater
4. `argocd-ssa-diff-deployment-skip` SSA diff로 Deployment skip
5. `argocd-ssa-force-sync-stuck` Force Sync + SSA stuck

### Infra 시리즈 (ADR 1 + 트러블슈팅 1 = 2편)
1. `0005` CloudFront → Cloudflare 전환 결정
2. `cloudflare-migration-api-routing-troubleshoot` Workers 라우팅 삽질

### Queue POC 시리즈 (신규 7편)
1. `queue-loadtest-k6-two-phase-design` K6 2-Phase 설계
2. `poc-ab-test-dependency-isolation-pattern` POC 의존성 격리 패턴
3. `poc-queue-junsang-401-ticketing-isolation` POC 보안 격리
4. `queue-junsang-saturation-results` POC A 포화 테스트
5. `queue-sungjeon-saturation-results` POC B 포화 테스트
6. `queue-suyeon-saturation-results` POC C 포화 테스트
7. `queue-impl-final-selection-suyeon-cdn` 최종 선정 (CDN)

### EKS 프로덕션 시리즈 (신규 3편)
1. `eks-vpc-cni-ip-exhaustion-max-pods` VPC CNI IP 소진
2. `eks-rolling-update-cascading-failures` Rolling Update 연쇄 장애
3. `gcp-terraform-review` Cross-Cloud Terraform 호환성

### Istio 심화 시리즈 (신규 2편)
1. `payment-istio-retry-duplicate` Retry 중복 결제
2. `istio-jwks-mismatch-cdn-jwt-401` JWKS CDN JWT 401

### 단독 글
- `kind-db-connection-diagnosis-false-negative` 디버깅 방법론
- `hikaricp-otel-beanpostprocessor` Spring 내부 동작

---

## 신규 추가 (2026-03-27 ~ 2026-04-04) — 25편

### 트러블슈팅 — 최고 추천 (5/5)

| 상태 | 파일 | 블로그 제목 (안) | 시리즈 |
|------|------|-----------------|--------|
| ⬜ | `2026-04-03-payment-istio-retry-duplicate.md` | Istio Retry가 결제를 두 번 보냈다 — 멱등성 없는 API의 대가 | Istio |
| ⬜ | `2026-04-01-eks-rolling-update-cascading-failures.md` | EKS max-pods 변경이 연쇄 장애를 일으킨 이유 | EKS |
| ⬜ | `2026-03-27-queue-loadtest-k6-two-phase-design.md` | K6 부하테스트 2-Phase 설계 — 토큰 발급과 티켓팅을 분리한 이유 | Queue |
| ⬜ | `2026-04-04-queue-impl-final-selection-suyeon-cdn.md` | 대기열 3개 POC 비교 끝에 CDN 캐싱을 선택한 이유 | Queue |

### 트러블슈팅 — 강력 추천 (4/5)

| 상태 | 파일 | 블로그 제목 (안) | 시리즈 |
|------|------|-----------------|--------|
| ⬜ | `2026-04-04-istio-jwks-mismatch-cdn-jwt-401.md` | CDN 경유 JWKS가 JWT 401을 만든 이유 | Istio |
| ⬜ | `2026-04-04-gcp-terraform-review.md` | AWS↔GCP Terraform 크로스 클라우드 버전 호환성 점검 | Infra |
| ⬜ | `2026-04-01-eks-vpc-cni-ip-exhaustion-max-pods.md` | EKS VPC CNI IP 소진 — /24 서브넷의 한계 | EKS |
| ⬜ | `2026-03-29-argocd-ssa-diff-deployment-skip.md` | ArgoCD SSA가 Deployment를 건너뛴 이유 | K8s |
| ⬜ | `2026-03-29-argocd-ssa-force-sync-stuck.md` | ArgoCD Force Sync + SSA = stuck — 절대 쓰면 안 되는 조합 | K8s |
| ⬜ | `2026-03-29-poc-ab-test-dependency-isolation-pattern.md` | POC A/B 테스트를 위한 의존성 서비스 격리 패턴 | Architecture |
| ⬜ | `2026-03-30-argocd-otel-collector-crashloop.md` | Alloy→OTel Collector 전환 중 CrashLoop 해결기 | Observability |
| ⬜ | `2026-03-31-discord-alerting-architecture.md` | Discord 알림 아키텍처 — Alertmanager → webhook 설계 | Observability |

### Queue POC 비교 시리즈 (8편)

| 상태 | 파일 | 블로그 제목 (안) | 시리즈 |
|------|------|-----------------|--------|
| ⬜ | `2026-03-30-queue-junsang-saturation-results.md` | Queue POC A (준상) — Redis 폴링 포화 테스트 | Queue |
| ⬜ | `2026-03-30-queue-sungjeon-saturation-results.md` | Queue POC B (성전) — Kafka 기반 포화 테스트 | Queue |
| ⬜ | `2026-03-30-queue-suyeon-saturation-results.md` | Queue POC C (수연) — CDN 캐싱 포화 테스트 | Queue |
| ⬜ | `2026-03-29-queue-suyeon-saturation.md` | Queue POC C (수연) — 상세 포화 테스트 결과 | Queue |
| ⬜ | `2026-04-03-queue-poc-1000vu.md` | Queue POC 1000VU 최종 비교 테스트 | Queue |
| ⬜ | `2026-03-30-queue-poc-performance-comparison.md` | 3개 POC 전체 성능 비교 메트릭 | Queue |
| ⬜ | `2026-03-30-queue-poc-queue-only-comparison.md` | 순수 큐 성능만 비교 — Redis vs Kafka vs CDN | Queue |
| ⬜ | `2026-03-29-poc-queue-junsang-401-ticketing-isolation.md` | POC 격리 환경에서 401/403 보안 설정 | Queue |

### 운영/버그 (추천도 3/5)

| 상태 | 파일 | 블로그 제목 (안) | 시리즈 |
|------|------|-----------------|--------|
| ⬜ | `2026-03-29-deploy-dev-hotfix-redis-serialization.md` | Redis 직렬화 핫픽스 | Spring |
| ⬜ | `2026-03-31-argocd-probe-crd-not-permitted.md` | ArgoCD Probe CRD 권한 누락 | K8s |
| ⬜ | `2026-03-31-claude-code-config-optimization.md` | Claude Code 설정 최적화 | Meta |
| ⬜ | `2026-03-31-monitoring-custom-sync-alertmanager-mount-failure.md` | Alertmanager Secret 마운트 실패 | Observability |
| ⬜ | `2026-04-01-observer-db-auth-failure-readonly-user.md` | RDS 읽기 전용 유저 인증 실패 | Security |
| ⬜ | `2026-04-01-payment-sungjeon-token-encryptor-32byte.md` | Secret Key 31바이트 버그 | Spring |
| ⬜ | `2026-04-01-redis-classcastexception-linkedhashmap.md` | RedisCache ClassCastException | Spring |

---

## 시리즈 구성 (안) — 업데이트
