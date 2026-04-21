---
date: 2026-04-08
category: meta
project: goti-team-controller
tags: [rule, skill, agent, command, istio, k8s, terraform, eks, otel, security, review-gaps]
---

# AI 워크플로우 대규모 개선: 89개 트러블슈팅 + 25개 리뷰 갭 분석 → Rules/Skills/Agents 보강

## Context

goti-team-controller의 `.claude/` 리소스(46 agents, 15 rules, 169 skills, 44 commands)를 운영하면서 2개월간 축적된 트러블슈팅 기록과 리뷰 갭을 체계적으로 분석하여 AI 워크플로우를 개선하는 작업을 수행.

분석 범위:
- `docs/dev-logs/` 89개 트러블슈팅 기록 (2026-02-28 ~ 04-08)
- `docs/dev-logs/sessions/` 62개 세션 로그
- `docs/dx/review-gaps.md` 25개 Gemini vs Claude 리뷰 갭
- 11개 feedback 메모리 항목

추가로 **외부 검증**을 수행:
- Istio 1.29, K8s 1.34, ArgoCD v3.3, OTel 2.25+ 기준 규칙 정확성 확인
- 보안 관점 검증 (CIS Benchmark, OWASP, CVE, MITRE ATT&CK)

## Issue

### 반복된 실수 패턴 (규칙 부재로 인한)

| 영역 | 건수 | 대표 사례 |
|------|------|----------|
| Istio | 12+ | FQDN 누락 503, PeerAuth selector 누락, POST retry 결제 중복 |
| 모니터링 | 22 | ServiceMonitor 라벨 누락, remote_write prefix 불일치, PromQL/TraceQL 혼용 |
| K8s 디버깅 | 다수 | CrashLoopBackOff에서 1.5시간 낭비 (OOMKilled를 DB timeout으로 오진) |
| Terraform | 8 | SG inline+separate 충돌로 RDS 접근 차단, /24 서브넷 IP 고갈 |
| EKS | 8 | Bottlerocket max-pods=35 고정, IAM policy 누락 401, Kyverno deadlock |

### 리뷰 갭 (Gemini가 잡고 Claude가 놓친 패턴)

25개 갭 중 규칙으로 방지 가능한 13건:
- AppProject `kind: "*"` 와일드카드 (#4)
- RBAC `create` + `resourceNames` 비호환 (#11)
- AuthorizationPolicy 경로 매칭 주의사항 (#19, #20)
- NetworkPolicy egress `0.0.0.0/0` (#24)
- targetRevision: main 위험 (#8)

### 보안 검증에서 발견된 P0 갭 6건

1. AuthorizationPolicy path normalization 미설정 (CVE-2021-39156 우회)
2. NetworkPolicy IMDS 미차단 (169.254.169.254 IAM 탈취)
3. RBAC 위험 verb 미플래그 (escalate/bind/impersonate)
4. Terraform state 보안 규칙 부재
5. OTel PII 유출 방지 설정 부재
6. `forwardOriginalToken` 보안 경고 부재

### 외부 검증에서 수정된 오류 2건

1. ~~AuthPolicy `excludePaths` `/api/*` base path 미매칭~~ → 실제로는 매칭됨. URI template `{*}`/`{**}` 권장으로 수정
2. ~~DestinationRule `maxRetries` deprecated~~ → deprecated 아님. `retryBudget`은 보완 옵션

## Action

### Batch 1: Rules (3 신규 + 2 수정) — 자동 적용, ROI 최고

**신규:**
- `.claude/rules/istio.md` (path-scoped) — VirtualService FQDN, PeerAuth selector, AuthPolicy retry/경로매칭, path normalization, forwardOriginalToken 경고, Native Sidecars 권장
- `.claude/rules/k8s-manifest.md` (path-scoped) — AppProject 와일드카드 금지, IMDS 차단, RBAC 위험 verb, targetRevision, consumer lag 집계
- `.claude/rules/terraform.md` (path-scoped) — SG 충돌 금지, VPC CIDR 계산, IAM policy, prevent_destroy, Bottlerocket max-pods, state 보안

**수정:**
- `.claude/rules/debugging.md` — K8s 디버깅 프로토콜 추가 (CrashLoopBackOff 트리아지, 컨테이너 셸 호환성, 증상 vs 원인 테이블)
- `.claude/rules/monitoring.md` — Prometheus Remote Write prefix 동기화, OTel Java Agent 메모리 768Mi, PII 유출 방지, 절대금지 2건 추가

### Batch 2: Skills (5 신규) — 에이전트 참조 실전 지식

- `.claude/skills/service-mesh/istio-pitfalls.md` — FQDN 실패 시나리오, path normalization 우회 기법, retry+idempotency, JWKS 로테이션, Native Sidecars, forwardOriginalToken 보안
- `.claude/skills/observability/otel-pitfalls.md` — Spring BOM 충돌, 메모리 요구사항, OTLP protocol 변경, HikariCP 초기화, PII 유출 방지
- `.claude/skills/kubernetes/k8s-troubleshoot-trees.md` — CrashLoopBackOff/ImagePullBackOff/Pending/NetworkPolicy/DNS decision tree, IMDS 검증
- `.claude/skills/infrastructure/eks-pitfalls.md` — VPC CNI prefix delegation, Bottlerocket, Kyverno webhook, WARM_IP/PREFIX, IAM, IMDS v2
- `.claude/skills/infrastructure/terraform-pitfalls.md` — SG 충돌 마이그레이션, IP 계산, create_before_destroy, ignore_changes, state 보안, 보안 체크리스트

### Batch 3: Agents (3 수정) + Commands (2 신규)

**에이전트 수정:**
- `k8s-troubleshooter` — CrashLoopBackOff FIRST: reason 확인, Pattern 6-7 추가 (증상vs원인, 셸 호환성), 참조 스킬+보안 체크
- `service-mesh-expert` — istio-pitfalls 스킬 참조, Pattern 6-7 추가 (FQDN, path normalization), Native Sidecars 우선
- `observability-reviewer` — OTel PII 체크, PromQL/TraceQL 혼용 체크, ServiceMonitor release 라벨 체크리스트 추가

**커맨드 신규:**
- `/k8s:troubleshoot` — decision tree 기반 체계적 K8s 진단
- `/review-pr:terraform` — 3관점 병렬 Terraform PR 리뷰 (보안/IAM, 비용/리소스, 안정성/상태)

## Result

### 정량적 변화

| 카테고리 | Before | After | 변화 |
|----------|--------|-------|------|
| Rules | 15 | 18 | +3 (istio, k8s-manifest, terraform) |
| Skills | 221 | 194 | +5 pitfalls -27 미사용 삭제 = **-22** |
| Agents | 46 (수정 0) | 46 (수정 8) | 3 실전패턴 + 5 DX/Platform 참조 |
| Commands | 44 | 46 | +2 (k8s:troubleshoot, review-pr:terraform), 2 스킬참조 추가 |
| 스킬 참조율 | ~20% | ~36% | 에이전트에서 실제 참조하는 스킬 비율 |

### 기대 효과

- **Istio 12건+ 반복 실수 방지**: FQDN, PeerAuth selector, retry 규칙이 path-scoped로 자동 적용
- **리뷰 갭 13건 해소**: review-gaps.md의 #4, #8, #11, #17-20, #21, #24, #25 패턴이 규칙화
- **CrashLoopBackOff 디버깅 시간 단축**: 1.5시간 → reason 우선 확인으로 5분 이내 분류 가능
- **Terraform 사고 예방**: SG 충돌, IP 고갈, IAM 누락 패턴이 규칙/리뷰에서 자동 감지
- **보안 P0 6건 커버**: path normalization, IMDS, RBAC verb, state 보안, OTel PII, token relay

### 검증 방법 (TODO)

1. Istio FQDN 위반 YAML → Claude가 Blocker 플래그하는지
2. CrashLoopBackOff + OOMKilled → k8s-troubleshooter가 reason 먼저 확인하는지
3. Terraform SG 혼용 PR → `/review-pr:terraform`이 감지하는지

## Related Files

### 신규 (8)
- `.claude/rules/istio.md`
- `.claude/rules/k8s-manifest.md`
- `.claude/rules/terraform.md`
- `.claude/skills/service-mesh/istio-pitfalls.md`
- `.claude/skills/observability/otel-pitfalls.md`
- `.claude/skills/kubernetes/k8s-troubleshoot-trees.md`
- `.claude/skills/infrastructure/eks-pitfalls.md`
- `.claude/skills/infrastructure/terraform-pitfalls.md`
- `.claude/commands/k8s/troubleshoot.md`
- `.claude/commands/review-pr-terraform.md`

### 수정 (12)
- `.claude/rules/debugging.md`
- `.claude/rules/monitoring.md`
- `.claude/agents/k8s-troubleshooter.md`
- `.claude/agents/service-mesh-expert.md`
- `.claude/agents/observability-reviewer.md`
- `.claude/agents/tech-lead.md`
- `.claude/agents/platform-engineer.md`
- `.claude/agents/git-workflow.md`
- `.claude/agents/product-engineer.md`
- `.claude/agents/code-reviewer.md`
- `.claude/commands/dx/pr-create.md`
- `.claude/commands/dx/changelog.md`

---

## Phase 2: 스킬 정리 + DX/Platform 연결 (2026-04-09)

### 미사용 스킬 삭제 (-27개)

221개 스킬 중 80%가 에이전트/커맨드에서 참조되지 않는 문제를 발견. 프로젝트와 무관한 27개 삭제.

| 도메인 | 삭제 수 | 사유 |
|--------|---------|------|
| `frontend/` | 7 (전체) | React 사용하나 Next.js/Vue/Angular 스킬만 있었음 |
| `ai/` | 5 (전체) | Agentic AI, RAG, Vector DB — 프로젝트 무관 |
| `platform/` | 11 | ML Serving, WASM Edge, Kratix, MLOps 등 — 프로젝트 무관 |
| `messaging/` | 3 | RabbitMQ, NATS, Redis Streams — Kafka만 관련 |
| `architecture/` | 1 | Agentic AI Architecture — 프로젝트 무관 |

결과: 221개 → **194개** (12% 감소)

### DX/Platform 스킬 → 에이전트/커맨드 연결

DX 23개 + Platform 5개 스킬이 존재했지만 명시적 참조가 없어 활용 안 되던 문제 해결.

| 에이전트/커맨드 | 추가된 스킬 참조 |
|----------------|----------------|
| `tech-lead` | +3 (ai-first-playbook, token-efficiency, docs-as-code) |
| `platform-engineer` | +9 (Platform 전체 + DX 온보딩/메트릭/Makefile/문서자동화) |
| `git-workflow` | +3 (conventional-commits, git-workflow, clean-code) |
| `product-engineer` | +2 (spec-driven-dev, team-topologies) |
| `code-reviewer` | +3 (refactoring-principles, clean-code, secrets-management) |
| `dx/pr-create` | +3 (conventional-commits, git-workflow, spec-driven-dev) |
| `dx/changelog` | +2 (conventional-commits, git-workflow) |

SKIP 7개: dx-onboarding-gitpod(미사용), dx-ai-agents/orchestration(tech-lead 내장), dx-ai-security(security rule 커버), documentation-templates(documentation rule 커버), dx-onboarding-deploy/environment(platform-engineer 간접 커버)

### Phase 2 최종 수치

| 카테고리 | Before | After |
|----------|--------|-------|
| Skills | 221 | 194 (-27) |
| 에이전트 스킬 참조 | 45개 (20%) | ~70개 (36%) |
