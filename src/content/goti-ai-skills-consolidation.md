---
title: "AI 스킬 보강 대규모 회고 — 하루 동안 K8s/모니터링/OTel HikariCP/EC2 CD 4개 영역을 동시에 손본 이유"
excerpt: "2026-03-11 하루에 K8s·모니터링·OTel HikariCP·EC2 CD 4개 영역의 누적 갭 12건 + 트러블 25건 + 세션 로그 8건을 스킬 파일 15개 이상에 반영하고, /review-pr:k8s 와 /review-pr:monitoring 전문 리뷰 커맨드를 3에이전트 병렬 구조로 신설했습니다. 같은 날 묶은 이유는 네 영역이 공통된 '스킬 지식 갭 + 리뷰 구조 한계' 패턴을 공유했기 때문입니다."
category: challenge
tags:
  - go-ti
  - Meta
  - Skill
  - Code-Review
  - Kubernetes
  - Monitoring
  - OpenTelemetry
  - EC2
  - retrospective
series:
  name: "goti-meta"
  order: 2
date: "2026-03-11"
---

## 한 줄 요약

> go-ti 프로젝트의 4개 도메인(K8s, 모니터링, OTel HikariCP, EC2 CD)에서 같은 유형의 실수가 반복되는 것을 발견했습니다. 원인을 분석해보니 공통으로 **(1) 스킬 파일에 프로젝트 패턴이 비어 있음, (2) 범용 리뷰 커맨드 하나로 모든 영역을 처리하는 구조 한계** 두 가지였습니다. 하루 동안 네 영역을 동시에 손봐 스킬 15개 이상 확장, `/review-pr:k8s`와 `/review-pr:monitoring` 전문 리뷰 커맨드 3에이전트 병렬 구조로 신설, `ec2-cd-pipeline.md` 신규 스킬 추가, OTel HikariCP BPP 섹션 6줄→60줄 확장까지 마쳤습니다.

---

## 🔥 문제: 네 영역에서 같은 유형의 반복 실수

각 영역에서 누적된 갭과 트러블을 보면 공통 패턴이 드러났습니다

### K8s 영역 — 리뷰 갭 12건 + 세션 로그 8건

PR #11~#19에서 Gemini가 잡고 Claude가 놓친 리뷰 갭이 `docs/review-gaps.md`에 12건 누적되어 있었습니다. 대표 항목

- RBAC의 `create` verb가 `resourceNames` 제약과 호환되지 않음
- AppProject `kind: "*"` 와일드카드가 최소 권한 원칙 붕괴
- `targetRevision: main`은 GitOps에서 해시 고정이 풀려 위험
- YAML anchor/alias가 오판의 원인
- AWS 계정·리전 종속값이 Helm values에 하드코딩

### 모니터링 영역 — 트러블 7건, 이슈 13건

OTel → Prometheus 매핑 불일치, Docker 환경변수 편차, CSRF Origin, Loki HEAD 헬스체크 등이 7개 트러블 로그에 걸쳐 총 13건 누적돼 있었습니다

| # | 로그 | 이슈 |
|---|------|------|
| 1 | otel-sdk-version-conflict | OTel SDK ↔ Spring Boot BOM 충돌 |
| 2 | postgres-healthcheck-env-mismatch | docker-compose 환경변수 불일치 |
| 3 | cd-ssm-waiter-timeout | SSM waiter 기본 100초 타임아웃 |
| 4 | grafana-csrf-origin-not-allowed | 리버스 프록시 뒤 CSRF Origin 에러 |
| 5 | network-label-conflict-and-loki-healthcheck | Docker 네트워크 라벨 충돌 + Loki HEAD 헬스체크 |
| 6 | otel-label-mismatch | `service.namespace` → `job` 매핑 불일치 |
| 7 | monitoring-dashboard-nodata-comprehensive | 종합 5건 (job 레이블, HikariCP, Apdex, Alloy, GC format) |

### OTel HikariCP 영역 — BPP 섹션 6줄이 전부

HikariCP OTel 메트릭 미수집 트러블을 해결하면서 `BeanPostProcessor` 초기화 순서 패턴 세 가지(`static` 필드 문제, `ObjectProvider`로 지연 조회, `Before` vs `After` 훅)를 확인했지만, 기존 스킬 파일의 BPP 섹션은 6줄에 불과해 다음 세션에서 같은 문제가 나올 때 참조값이 낮았습니다

### EC2 CD 영역 — 트러블 4건 + 도메인 스킬 부재

CI/CD 스킬이 ArgoCD/GitOps 편향이라 GitHub Actions + SSM + ALB + CloudFront 기반 EC2 CD 패턴이 스킬에 없었습니다

| 트러블 | 증상 |
|--------|------|
| cd-ssm-waiter-timeout | `aws ssm wait` 기본 100초 타임아웃 |
| cloudfront-swagger-403 | CloudFront behavior 누락 → S3 폴백 403 |
| jwt-social-verify-time | Docker env 기본값 누락 → Duration 파싱 실패 |
| dev-monitoring-502 | ALB 헬스체크 + Docker 포트 바인딩 불일치 |

---

## 🤔 원인: 공통으로 "범용 지식 ↔ 프로젝트 패턴" 간극

네 영역에서 공통되게 드러난 두 가지 구조적 원인입니다

### 원인 1 — 스킬이 "개념 설명"에서 멈춰 있었음

기존 스킬은 "Helm이란 무엇인가", "OTel이란 무엇인가", "`BeanPostProcessor`는 Spring Bean 초기화 훅이다" 같은 공식 문서 수준의 범용 설명이었습니다. "이 프로젝트에서 Helm을 어떻게 쓰는가", "어떤 실수가 반복됐는가", "어떤 트리플 조건을 한 번에 맞춰야 하는가" 같은 **프로젝트 패턴**이 비어 있었습니다

### 원인 2 — `/review-pr` 범용 리뷰 하나로 모든 영역 처리

영역 특화 체크(Helm values 계층화, AppProject 와일드카드, sync-wave, OTel 정합성, 환경 동기화, Grafana 변수 충돌)가 범용 리뷰 안에서 깊이를 유지하지 못했습니다

---

## ✅ 해결: 4개 영역 스킬 보강 + 2개 전문 리뷰 커맨드 신설

### K8s — 스킬 5개 + /review-pr:k8s 신설

| 파일 | Before → After | 추가 내용 |
|------|---------------|----------|
| `k8s-helm.md` | 189줄 → ~320줄 | Library Chart, YAML anchor, 멀티 환경 values |
| `k8s-security.md` | 362줄 → ~440줄 | RBAC create+resourceNames, AppProject 최소 권한 |
| `gitops-argocd.md` | 347줄 → ~420줄 | `targetRevision` 위험성, Bootstrap sync-wave |
| `gitops-argocd-advanced.md` | 443줄 → ~470줄 | AppProject 와일드카드 검증, ApplicationSet |
| `gitops-argocd-helm.md` | 344줄 → ~460줄 | ESO sync-wave, Sealed Secrets, AWS 종속값 변수화 |

`/review-pr:k8s`는 **3에이전트 병렬 구조**로 신설했습니다. ⎈ Helm Chart/values, 🔒 ArgoCD GitOps/보안, ⚙️ 운영/패턴 일관성을 세 축으로 나눠 각 에이전트가 독립적으로 평가합니다. Gap → 스킬 반영 매핑을 문서 상단에 두어 **회귀 감지 도구**로 활용합니다. 다음 PR에서 같은 항목이 또 놓이면 "스킬에 들어갔는데도 실패했다"는 증거가 되어, 스킬 자체의 표현을 더 강한 경고로 고칠 근거가 됩니다

### 모니터링 — 스킬 6개 + /review-pr:monitoring 신설

| 파일 | 추가 내용 | 증분 |
|------|----------|-----|
| `monitoring-metrics.md` | OTel → Prometheus 레이블 매핑 스펙, 히스토그램 버킷 규칙, recording rule 패턴 | +90줄 |
| `monitoring-grafana.md` | Cross-datasource 변수 전략, 리버스 프록시 CSRF, file provisioning | +88줄 |
| `observability-otel.md` | Semantic conventions 변경 추적, resource → Prometheus 매핑 | +56줄 |
| `observability-otel-optimization.md` | Alloy `loki.attribute.labels` known issue, HikariCP OTel 메트릭 | +74줄 |
| `docker.md` | 포트 바인딩 가이드(127.0.0.1 vs 0.0.0.0), 헬스체크 HEAD vs GET, 네트워크 모드 | +58줄 |
| `monitoring-troubleshoot.md` | 헬스체크 프로토콜, ALB 타겟 헬스, CD polling 루프 | +69줄 |

`/review-pr:monitoring`도 3에이전트 병렬 구조로 나눴습니다

- **Agent 1 OTel 정합성** — SDK 버전, BOM, semantic conventions, Prometheus 매핑 규칙이 한 PR 안에서 일관되는지
- **Agent 2 환경 동기화** — docker-compose ↔ application.yml ↔ Helm values 3곳이 어긋나지 않는지
- **Agent 3 Grafana 검증** — 변수, 쿼리 legendFormat, panel datasource가 최신 레이블 스펙을 따르는지

한 에이전트가 모든 축을 동시에 보려 하면 깊이가 떨어집니다. 병렬로 나누면 각 축이 구체 체크 항목을 가진 채 독립적으로 평가를 수행합니다

### OTel HikariCP — BPP 섹션 6줄 → ~60줄

`observability-otel-optimization.md`의 BPP 섹션을 네 블록으로 확장했습니다

1. **증상 식별 — WARN 로그 패턴** (`Bean 'openTelemetry' ... is not eligible for getting processed by all BeanPostProcessors`)
2. **3가지 핵심 문제 원인·해결 테이블** — `static` 필드 주입 / 직접 주입 / `After` 훅 사용
3. **검증된 코드 예제** — `hikariMetricsPostProcessor` Bean 정의 그대로
4. **검증 방법과 Anti-Patterns** — 직접 주입, `After` 사용, `@DependsOn` 순서 강제

```java
@Bean
public static BeanPostProcessor hikariMetricsPostProcessor(
        ObjectProvider<OpenTelemetry> openTelemetryProvider) {
    return new BeanPostProcessor() {
        @Override
        public Object postProcessBeforeInitialization(Object bean, String beanName) {
            if (bean instanceof HikariDataSource ds) {
                OpenTelemetry otel = openTelemetryProvider.getIfAvailable();
                if (otel != null) {
                    HikariTelemetry.create(otel).registerMetrics(ds);
                }
            }
            return bean;
        }
    };
}
```

핵심 포인트는 `static` Bean 메서드로 선언해 BPP를 일찍 등록하고, `ObjectProvider`로 지연 조회해 null-safe 처리하고, `postProcessBeforeInitialization`에서 metric을 등록하는 세 가지입니다

`observability-otel.md`에는 **의존성 + 버전 레퍼런스**를 추가했습니다. 2026-03 기준 OTel Java SDK 1.60.1, Instrumentation BOM 2.25.0을 박아두어 다음 세션에서 버전 호환성을 재확인할 필요가 없습니다

### EC2 CD — docker.md 보강 + ec2-cd-pipeline.md 신규

| 파일 | 작업 | 추가 내용 |
|------|------|---------|
| `docker.md` | 수정 | 환경변수 `${VAR:-default}` 필수 패턴, docker-compose ↔ application.yml ↔ Helm values 3곳 동기화 체크리스트 |
| `ec2-cd-pipeline.md` | **신규** | SSM polling 패턴, CloudFront behavior, ALB 헬스체크, CD 검증 체크리스트 |

**SSM polling 패턴** — `aws ssm wait command-executed`는 기본 20회 × 5초 = 100초에서 타임아웃이고, Spring Boot 기동이 2~3분인 dev 환경에선 무조건 실패합니다. 명시적 polling 루프로 대체했습니다

```bash
# ❌ Bad: waiter 기본 타임아웃 100초
aws ssm wait command-executed \
  --command-id "$CMD_ID" --instance-id "$INSTANCE_ID"

# ✅ Good: polling 루프로 타임아웃 명시
MAX_ATTEMPTS=60   # 5초 × 60 = 5분
for i in $(seq 1 $MAX_ATTEMPTS); do
  STATUS=$(aws ssm get-command-invocation \
    --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
    --query 'Status' --output text)
  case "$STATUS" in
    Success)   exit 0 ;;
    Failed|Cancelled|TimedOut) exit 1 ;;
    *) sleep 5 ;;
  esac
done
exit 1
```

명시적 polling 루프는 타임아웃을 자유롭게 조절할 수 있고, 실패 시 원인 상태(`Failed`/`Cancelled`)를 구분해 로그에 남길 수 있습니다

---

## 왜 네 영역을 한 날에 묶었는가

**의식적인 묶음 작업이었습니다.** 각 영역을 따로 개선하면 다음과 같은 문제가 있었습니다

- 영역별로 접근할 때마다 "스킬 편향 점검 → 갭 수집 → 반영" 절차를 매번 재발명
- 서로 다른 영역에서 같은 리뷰 구조(3에이전트 병렬 체계)를 독립적으로 수렴하기 어려움
- 스킬 재편 사이클의 **수확 체감**: 같은 날 4번 반복하면 공통 패턴이 보이지만, 흩어지면 보이지 않음

네 영역을 묶은 결과로 얻은 공통 발견은 다음 네 가지입니다

1. **스킬 업데이트와 리뷰 커맨드 업데이트는 세트다.** 스킬에만 넣으면 에이전트가 늘 참조하지는 않습니다. 리뷰 커맨드의 학습된 체크에 동시에 추가해야 강제 로딩됩니다
2. **전문 리뷰 커맨드는 3에이전트 병렬이 공통적으로 효과적이었다.** 도메인마다 축이 자연스럽게 나뉘는 경우(Helm/보안/운영, OTel/환경/Grafana) 한 에이전트가 모두 동시에 보는 것보다 깊이가 유지됩니다
3. **"매핑 표"는 회귀 감지 도구다.** gap → 스킬 파일 매핑을 문서화해두면, 같은 gap이 재발할 때 "스킬 표현이 충분히 강하지 않았다"는 교훈으로 이어집니다
4. **버전 레퍼런스는 "작성일 기준"으로 명시한다.** 2026-03 기준이라고 박아두면 미래 세션에서 "버전 오래됐을 수 있음"을 자동 인지하고 재검증을 트리거합니다

---

## 📚 배운 점 (공통 교훈)

- **스킬은 "한 번 겪은 트러블"이 올라가는 선반이다.** dev-log로만 남기면 다음 세션에서 같은 실수를 반복합니다
- **스킬 편향을 주기적으로 점검한다.** ArgoCD/GitOps 스킬이 풍성하고 EC2 스킬이 빈 것처럼, 실제 운영 영역과 스킬 분포가 어긋나 있는지 확인합니다
- **"분산 반영"은 필수 작업이다.** 종합 트러블 한 건이 5개 서브이슈를 갖는 경우, 각 서브이슈를 올바른 스킬 파일에 따로 꽂아 넣지 않으면 다음 세션에서 참조되지 않습니다
- **"매핑 스펙"은 블로그 수준 문서가 아닌 스킬 본문에 둔다.** OTel `service.namespace` → Prometheus `job` 같은 정답형 스펙은 일반 원칙이 아니라 **표**로 스킬에 박혀 있어야 에이전트가 컨벤션처럼 따릅니다
- **영역별 리뷰 커맨드는 자동 라우팅과 세트로 간다.** 전문 리뷰를 만들어도 사용자가 매번 `/review-pr:monitoring`을 기억해서 쳐야 한다면 유명무실합니다. `/review-pr`에서 파일 패턴으로 자동 감지해 유도합니다
- **"증상 → 원인 → 해결 → 검증"의 4단 구조가 스킬 가독성을 크게 높인다.** Claude가 같은 증상을 만나면 흐름대로 내려가며 답을 찾을 수 있습니다
- **동작 확인된 코드는 반드시 스킬에 박아둔다.** 일반 지식으로 해결하려 하면 `static`/`Before`/`ObjectProvider` 같은 트리플 조건을 한 번에 맞추지 못합니다
- **이번 사이클에서 다룬 로그는 "완료"로 표기한다.** 동일 범위 재분석을 막기 위해 스킬 개선 문서 상단에 "향후 동일 범위 재분석 불필요"를 명시합니다. 다음 사이클은 새 PR에서 나오는 신규 gap만 다룹니다
