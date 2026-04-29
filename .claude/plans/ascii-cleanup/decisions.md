# ASCII Cleanup — 그룹별 처리 결정 로그

> Phase 3 평탄화 작업의 글별/블록별 결정 기록. `criteria.md` 평탄화 방법론 적용 결과.

## 표기

- **인라인**: 짧은 화살표 흐름을 한 줄 인라인 코드로 풀어쓰기 (`A → B → C`)
- **표**: 비교 정보를 markdown table로 변환
- **목록**: 단계/원칙을 번호/순서 목록으로 풀어쓰기
- **lang**: 코드블록 언어 명시만 추가 (실제 명령/출력은 보존)
- **keep**: 실로그/실출력으로 판단해 손대지 않음 (분류 보정)

---

## G1 — `cat:kubernetes` (2026-04-28)

8편 / inventory flatten 추천 34블록 → 실제 평탄화 33블록 + keep 1블록.

### `goti-redis-serialization-classcastexception.md`

- L45-49 호출 경로 트리 → **인라인** (`Controller → ServiceImpl → SessionService → RedisCache.get`)

### `goti-kind-db-connection-false-negative.md`

- L112-115 인과 관계 흐름 → **목록** (4단계 번호 목록으로 풀어쓰기)

### `goti-kubectl-toleration-imagepullbackoff.md`

- L135-138 GitOps 원칙 박스 → **목록** (3가지 정책 bullet)

### `goti-ssm-manual-config-troubleshooting.md`

- L77-79 SSM 32바이트 비교 → **표** (값 / 길이 / 결과 3열)
- L92-95 브랜치 영향 비교 → **표** (브랜치 / TokenEncryptor / 영향 3열)

### `pod-service-troubleshooting.md`

- L90-96 Service YAML → **lang** (`yaml`)
- L101-108 kubectl describe 출력 → **lang** (`text` + `$` 프롬프트)
- L234-249 진단 체크리스트 → **목록** (4단계 번호 목록 + 인라인 코드)

### `goti-istio-jwks-mismatch-cdn-jwt-401.md`

- L43-44 테스트 경로 → **인라인** (`K6 → Cloudflare → ALB → Istio Ingress → Pod`)
- L60-62 signup vs queue enter → **표** (요청 / 결과 2열)
- L240-254 AuthorizationPolicy 비교 다이어그램 (14줄) → **목록** (두 케이스 굵은 글씨 + 인라인 흐름 설명, `{/* TODO: Draw.io로 교체 */}` 주석 함께 제거)
- L373-374 SSM→ExternalSecret 파이프라인 → **인라인**
- L468-469 helm template 흐름 → **인라인**

### `goti-istio-retry-duplicate-payment.md`

- L54-57 payment 로그 (3줄, lang=`log`) → **keep** (실제 로그라 인벤토리 분류 보정, 정보 보존)
- L72-73 시간 간격 → **인라인** (`538ms → 717ms → 804ms`)
- L106-107 attempts 의미 → **인라인** (굵은 글씨로 `attempts: 2 = 원본 1 + 재시도 2 = 3회`)
- L393-401 Outbox 패턴 8줄 → **목록** (트랜잭션 내 2단계 + 별도 프로세스 2단계)
- L409-413 SAGA 패턴 → **목록** (4단계 번호 목록)
- L438-443 멱등키 예시 → **lang** (`http` HTTP 요청 + 동작 설명 풀어쓰기)

### `k8s-pod-flow-part1.md` (15블록)

- L21-26 TL;DR 플로우 → **인라인 + 표** (흐름 인라인 + 단계별 시간 표)
- L42-45 kubectl --watch 출력 → **lang** (`bash` + `$` 프롬프트)
- L75-78 kubeconfig 출력 → **lang** (`yaml`)
- L97-102 time kubectl apply → **lang** (`bash` + `$` 프롬프트)
- L111-124 ETCD 저장 내용 → **lang + 풀어쓰기** (Key/Value 분리 + JSON 별도 lang `json`)
- L154-160 Scheduler 노드 상태 → **목록** (bullet + 결정 문장)
- L205-208 docker images 출력 → **lang** (`bash` + `$` 프롬프트)
- L216-226 Pod 생성 시간 측정 1 → **lang** (`bash` + `$` 프롬프트)
- L229-236 Pod 생성 시간 측정 2 → **lang** (`bash` + `$` 프롬프트)
- L262-277 ETCD 업데이트 JSON → **lang** (`json` + 도입 문장 분리)
- L323-328 터미널 1 Pod 상태 → **lang** (`text`)
- L355-360 imagePullPolicy Before → **lang** (`yaml`)
- L385-386 nginx:latest → **인라인** (굵은 글씨 인라인)
- L390-391 nginx:alpine → **인라인** (굵은 글씨 인라인)
- L422-430 kubectl describe events → **lang** (`bash` + `$` 프롬프트)

### G1 통계

| 변환 | 건수 |
|---|---|
| 인라인 | 7 |
| 표 | 5 |
| 목록 | 8 |
| lang 명시 | 13 |
| keep (분류 보정) | 1 |
| **합계** | **34** |

본문 흐름은 손대지 않고 코드블록 형태만 정리. 정보는 모두 보존.

---

## G2 — `series:argocd-troubleshooting` (2026-04-28)

3편 / inventory flatten 추천 6블록 → 실제 평탄화 5블록 + keep 1블록.

### `argocd-bootstrap-circular-dependency.md`

- L153-228 Terraform 75줄 (lang=`hcl`) → **keep** (실제 Terraform 코드라 인벤토리 분류 보정. 화살표 토큰은 한국어 주석 `← ArgoCD보다 먼저!` 때문에 잡힘)
- L385-388 Before 순환 의존성 + L392-395 After 올바른 순서 → **표 (병합)** (영역 / Before / After 3열로 합쳐 비교 명료화)

### `argocd-otel-crashloop-networkpolicy.md`

- L257-264 ArgoCD Server 시작 순서 → **목록** (nested 번호 목록, `NewServer`/`Init` 2단계 + 하위 호출)
- L379-386 argocd-server 시작 순서 → **목록** (nested 번호 목록, ConfigMap informer 차단 지점 강조)

### `argocd-ssa-sync-pitfalls.md`

- L38-45 ArgoCD 리소스 상태 + sync 결과 → **표 (병합)** (리소스 / 변경 감지 / sync 결과 3열로 두 시점 합침)

### G2 통계

| 변환 | 건수 |
|---|---|
| 표 | 2 (각 두 블록 병합) |
| 목록 | 2 |
| keep (분류 보정) | 1 |
| **합계** | **6** (병합으로 실 결과물 4개) |

블록 2개를 표 1개로 병합한 사례 2건 — 비교 정보가 자연스럽게 합쳐지는 경우 가독성을 위해 병합.

---

## G3 — `series:eks-troubleshooting` (2026-04-28)

7편 / inventory flatten 추천 24블록 → 실제 평탄화 23블록 + keep 1블록.

### `eks-troubleshooting-part8-argocd-helm.md` (6블록)

- L47-50, L145-148, L238-240, L454-456 ArgoCD 상태 박스 → **bullet 목록** (4건)
- L182-183 ConfigMap 흐름 → **인라인** (`ConfigMap 변경 → 해시 → rolling update`)
- L353-355 HPA 비용 낭비 흐름 → **인라인 (문장 풀어쓰기)**

### `eks-troubleshooting-part4-external-secrets.md` (4블록)

- L43-46 ESO 동기화 흐름 → **인라인**
- L143-146 gitignore 매칭 미니 박스 → **인라인 (본문 흡수)**
- L284-294 ESO diff (10줄, lang=`diff`) → **keep** (실제 ArgoCD diff 출력, 분류 보정)
- L531-537 ESO 체크리스트 → **체크박스 목록**

### `eks-troubleshooting-part1-dday.md` (4블록)

- L73-76 values 우선순위 박스 → **인라인 (문장 풀어쓰기)**
- L237-240 "나중에 하지" 컨텍스트 박스 → **bullet 목록**
- L287-296 Terraform 체크리스트 → **체크박스 목록**
- L339-343 main vs k8s-deploy-prod 박스 → **bullet + 결론 문장**

### `eks-troubleshooting-part3-istio-ambient-2.md` (3블록)

- L44-53 ALB→NLB Before/After 흐름 (9줄) → **표** (항목/이전/이후 3열)
- L296-300 NLB 비교 (이전 vs 새) → **bullet + 결론 문장**
- L357-360 최종 HTTPS 아키텍처 흐름 → **인라인**

### `eks-troubleshooting-part7-go-service.md` (3블록)

- L65-66 OAuth 결과 패턴 → **인라인** (성공/실패 시퀀스 인라인)
- L93-96 OAuth2 흐름 → **번호 목록** (3단계)
- L146-155 HttpSession Before/After (9줄) → **굵은 글씨 + 문장 풀어쓰기 (2케이스)**

### `eks-troubleshooting-part5-monitoring-1.md` (2블록)

- L424-426 PVC lock 충돌 다이어그램 → **bullet 목록** (기존/새 Pod 2건)
- L497-500 Production 아키텍처 흐름 → **인라인**

### `eks-troubleshooting-part6-monitoring-2.md` (2블록)

- L49-53 스토리지 Before/After → **굵은 글씨 + bullet 하위 목록**
- L111-116 minio-go 버전 의존성 → **bullet 목록** (3단계)

### G3 통계

| 변환 | 건수 |
|---|---|
| 인라인 | 5 |
| 표 | 1 |
| bullet 목록 | 14 (체크박스 2건 포함) |
| 번호 목록 | 3 |
| keep (분류 보정) | 1 |
| **합계** | **24** |

이 그룹은 "문제 N — 상황" 박스 패턴이 많아 bullet 목록 변환이 압도적으로 많았습니다. lang=`diff`로 명시된 실제 ArgoCD diff 1건은 keep으로 분류 보정 (이전 그룹의 lang=`log`/`hcl` keep과 동일 패턴 — lang이 명시된 코드는 화살표 토큰만으로 flatten 추천돼도 사람 판단으로 보존).

---

## G4 — `series:goti-multicloud` (2026-04-29)

7편 / inventory flatten 추천 12블록 → 실제 평탄화 12블록.

### `goti-aws-full-destroy-gcp-latency-optimization.md` (3블록)

- L41-43 Before/After 경로 비교 → **표** (시점/경로 2열)
- L54-58 DNS 검증 결과 → **bullet 목록** (Remote Address/server/curl 측정값 3건)
- L161-165 preflight 응답 → **bullet 목록** (3개 헤더 인라인 코드)

### `goti-harbor-imagepull-403-cloudflare-waf.md` (2블록)

- L176-179 WAF 표현식 (한국어 화살표 주석) → **lang=`text` 명시 + 주석 외부 문장으로 분리** (룰 본문 자체는 정보 가치 있는 코드라 보존, 화살표 주석만 본문 한 줄로 풀어씀)
- L253-254 외부→Cloudflare→ALB→Istio→Pod 단순 흐름 → **인라인**

### `goti-cloudflare-worker-lax-latency-investigation.md` (2블록)

- L89-93 수학적 분해 (계산식) → **bullet 목록** (프론트/백엔드/차이 3행)
- L127-140 LAX 왕복 13줄 경로 분해 → **번호 목록** (5단계 왕복 흐름, 각 구간 ms 포함)

### `goti-gcp-bringup-troubleshooting-chain.md` (2블록)

- L58-61 HTTP 525→404→403 chain → **bullet 목록**
- L114-118 viper 설정 누락 흐름 → **번호 목록** (4단계, panic까지 인과 사슬)

### `goti-multi-cloud-failover-bringup.md` (1블록, 14줄 box-small)

- L66-80 Worker fanout 다이어그램 → **번호 목록** (4단계, fetch URL 인라인 코드 + Grafana 대시보드 결론)

### `goti-gcp-redis-recovery-jwt-unification.md` (1블록)

- L77-82 Terraform 관리 vs 수동 drift 박스 → **표** (시크릿/관리 주체/갱신 여부/비고 4열)

### `goti-multicloud-circuit-breaker-hpa-adr.md` (1블록)

- L37-40 TCP timeout 10s 흐름 → **인라인** (Client→Worker→AWS→GCP 한 문장)

### G4 통계

| 변환 | 건수 |
|---|---|
| 인라인 | 2 |
| 표 | 2 |
| bullet 목록 | 3 |
| 번호 목록 | 4 |
| lang 명시 + 주석 분리 | 1 |
| **합계** | **12** |

이 그룹은 멀티클라우드 트래픽 경로/장애 사슬 박스가 많아 **번호 목록** 비중이 가장 높았습니다 (4건). 단계별 ms 또는 인과 사슬을 풀어쓰는 데 번호 목록이 가독성을 가장 잘 보존했습니다. WAF 룰은 lang을 명시하면서도 한국어 주석 화살표만 본문 한 줄로 분리하는 하이브리드 패턴 — 전 그룹의 "lang 명시 코드는 keep" 보정 룰을 살짝 변형해 적용했습니다.

---

## G5 — `series:goti-observability-ops` (2026-04-29)

5편 / inventory flatten 추천 9블록 → 실제 평탄화 1블록 + keep 보정 8블록.

**G5 특징**: 관측성 시리즈는 본문 자체가 OTLP/Mimir/Loki/Tempo 같은 파이프라인 다이어그램을 많이 인용합니다. 자동 추천이 `arrow-only`로 분류해도 lang이 `text`/`alloy`/`promql`로 명시된 케이스가 많고, 실제 응답·설정·옵션 비교 다이어그램이라 정보 가치가 높아 보정 룰("lang 명시 + 정보 가치 → keep")로 흡수했습니다.

### `goti-monitoring-e2e-multi-troubleshoot.md` (3블록 모두 keep)

- L44-47 실제 HTTP 응답 (POST + 응답 헤더 + body) → **keep** (lang=`text`, 실제 출력 보존이 자연스러움)
- L117-125 세 가지 에러 케이스(GET/응답코드 시퀀스) → **keep** (lang=`text`, 실 출력)
- L237-246 Alloy `queue_config` 설정 → **keep** (lang=`alloy`, 실제 설정 코드 — 화살표 토큰은 0건이지만 misc로 잡힘)

### `goti-kafka-buffered-otel-pipeline.md` (3블록 모두 keep)

- L32-33 Option A 흐름 (1줄, `App → Alloy → Mimir/Loki/Tempo`) → **keep**
- L56-57 Option A(중복) → **keep**
- L65-69 Option B 들여쓰기 흐름(4줄) → **keep**

이유: Option C(인벤토리에 안 잡힘, tree 토큰)와 함께 **3개 옵션 비교 다이어그램의 일관성**이 본문 핵심. lang=`text` 명시 + 비교 다이어그램 의도. 일부만 인라인으로 풀면 옵션 간 시각 비교가 깨집니다.

### `goti-otel-agent-otlp-protocol-mismatch.md` (1블록 keep)

- L228-237 통신 방향 다이어그램 (Java Agent → Alloy → Mimir/Tempo/Loki + Grafana 쿼리 4줄) → **keep** (lang=`text`, 본문에 "다이어그램을 위에서 아래로 따라가면..."로 명시적 다이어그램 인용)

### `goti-dashboard-enhancement.md` (1블록 flatten)

- L80-86 디버깅 워크플로우 6단계 → **번호 목록** (Alert → Health Matrix → Error Analysis → Logs → Trace → JVM → Profiling 단계별 풀어쓰기)

### `goti-dashboard-query-validation-fixes.md` (1블록 keep)

- L115-120 PromQL Before/After 비교 (5줄) → **keep** (lang=`promql`, 실제 PromQL 코드 + 한국어 주석 화살표만 코멘트로 잔존 — 전형적인 "lang 명시 코드는 keep" 보정 패턴)

### G5 통계

| 변환 | 건수 |
|---|---|
| 번호 목록 | 1 |
| keep (분류 보정) | 8 |
| **합계** | **9** |

이 그룹은 유일하게 **keep 비중이 압도적**(9건 중 8건)이었습니다. lang이 `text`/`alloy`/`promql`로 명시된 실제 코드/출력/비교 다이어그램이 대부분이라, 평탄화하면 정보 손실 또는 시각 비교가 깨지는 케이스. 자동 분류 룰이 `arrow-only`/`misc`로 잡았어도 사람 판단으로 보존했습니다.

---

## G6 — `cat:cicd` (2026-04-29)

3편 / inventory flatten 추천 7블록 → 실제 평탄화 3블록 + keep 보정 4블록.

### `multi-repo-cicd-strategy.md` (5블록 → 2 flatten + 3 keep)

- L53-55 옵션 B 디렉토리 흐름 → **keep** (lang=`text` 추가, 옵션 A/C 비교 일관성)
- L64-67 옵션 C 디렉토리 흐름 → **keep** (lang=`text` 추가, 옵션 비교 일관성)
- L367-374 Before(배포 레포 없이) 박스 → **굵은 글씨 + bullet 목록** (CI 흐름은 한 문장으로, 문제점 3건은 bullet)
- L378-386 After(중앙 배포 레포) 박스 → **굵은 글씨 + bullet 목록** (After 구조 한 문장 + 장점 3건 bullet)
- L400-410 학습 곡선 박스 (Local Docker → Compose+GitOps → K8s+ArgoCD) → **인라인** (한 문장으로 진화 흐름 풀어쓰기)

### `github-actions-multi-platform-optimization.md` (1블록, keep 보정)

- L34-36 빌드 로그 + 한국어 화살표 주석 → **keep** (lang=`text` 추가, 실제 빌드 로그. 화살표 주석은 본문 한 줄로 분리 — G4 WAF 룰과 동일 하이브리드 패턴)

### `goti-renovate-ecr-auth-failure.md` (1블록, keep)

- L26-30 Renovate 파이프라인 흐름 → **keep** (이미 lang=`text` 명시. 단순 흐름 다이어그램 보조 시각으로 보존, 본문에 컴포넌트 설명 이어짐)

### G6 통계

| 변환 | 건수 |
|---|---|
| 인라인 | 1 |
| 굵은 글씨 + bullet 목록 | 2 |
| keep (분류 보정) | 4 |
| **합계** | **7** |

cicd 그룹은 옵션 비교 다이어그램(A/B/C) 일관성이 본문 핵심이라 옵션 B/C 두 블록은 lang 명시 후 keep으로 흡수했습니다. Before/After 박스는 같은 본문에 옵션 비교와 별개로 "운영 효과"를 강조하는 부분이라 풀어쓰는 것이 더 가독성에 좋다고 판단했습니다.

---

## G7 — `series:goti-observability-stack` (2026-04-29)

5편 / inventory flatten 추천 8블록 → 실제 평탄화 7블록 + keep 보정 1블록.

### `goti-loki-otlp-native-migration.md` (3블록)

- L59-60 Spring Boot → Alloy → Loki 단순 흐름 → **인라인**
- L90-91 우회 방안 흐름 (`exporter.loki` + `loki.process`) → **인라인**
- L190-195 Before/After 파이프라인 비교 → **표** (시점/파이프라인 2열)

### `goti-tempo-oom-kafka-buffer-sampling.md` (2블록)

- L78-79 단순 직접 전송 흐름 → **인라인**
- L131-139 Before/After Kafka 버퍼 도입 → **표** (시점/파이프라인 2열, OOMKilled는 굵은 글씨)

### `goti-observability-stack-selection.md` (1블록, keep 보정)

- L255-258 시그널별 파이프라인 정리 (메트릭/로그/트레이스 3행) → **keep** (lang=`text` 추가, 위쪽 표와 보완 시각으로 보존)

### `goti-tempo-spanmetrics-batch-timeout.md` (1블록)

- L73-83 트레이스 파이프라인 단계별 지연 (10줄) → **표** (단계/누적 지연/비고 3열, batch kafka_traces 10초는 굵은 글씨로 병목 표시)

### `goti-mimir-ingester-oom-webhook-deadlock.md` (1블록)

- L93-98 Ingester OOM ↔ webhook 차단 교착 사슬 → **번호 목록** (5단계 사이클, 마지막에 1번으로 돌아가는 구조 명시)

### G7 통계

| 변환 | 건수 |
|---|---|
| 인라인 | 3 |
| 표 | 3 |
| 번호 목록 | 1 |
| keep (분류 보정) | 1 |
| **합계** | **8** |

이 그룹은 **표 변환 비중이 높았습니다(3건)**. Before/After 비교, 파이프라인 단계별 지연 누적이 표 형식으로 가장 가독성이 좋았습니다. 단순 직접 전송 흐름은 인라인으로, 인과 사슬은 번호 목록으로 분기 처리했습니다.

---

## G8 — `series:goti-java-to-go` (2026-04-29)

4편 / inventory flatten 추천 8블록 → 실제 평탄화 6블록 + keep 보정 2블록.

### `goti-cutover-residual-bugs-smoke-7of7.md` (5블록 → 3 flatten + 2 keep)

- L99-101 CI/CD 워크플로우 트리거 매핑 → **표** (워크플로우/트리거/비고 3열)
- L246-248 smoke 호출 체인 (Browser → payments → orders/internal) → **인라인**
- L269-276 smoke 결과 7건 (`✓ schedules 200` 등) → **keep** (lang=`text` 이미 명시, 실제 출력)
- L304-306 인프라 vs 애플리케이션 레포 트리거 차이 → **표** (레포 유형/대상 레포/배포 트리거 3열)
- L340-346 관련 커밋 목록 6건 → **keep** (lang=`text` 이미 명시, 메타데이터)

### `goti-cutover-smoke-trail-fixes.md` (1블록)

- L31-37 배포 이미지 흐름 (prod-13~prod-19) → **표** (이미지/변경 내용/비고 3열, prod-18·19는 굵은 글씨로 "이 글" 표시)

### `goti-go-cutover-residual-fixes.md` (1블록)

- L185-191 배포 순서 (prod-14~prod-17 + 결론 1줄) → **표** (이미지/커밋/변경 3열) + 결론은 본문 한 문장으로 분리

### `goti-go-otel-sdk-missing-labels.md` (1블록)

- L42-44 `pkg/observability/` 빈 디렉토리 박스(2줄) → **인라인** ("디렉토리는 존재했지만 내부가 비어 있었습니다" 한 문장 본문에 흡수)

### G8 통계

| 변환 | 건수 |
|---|---|
| 인라인 | 2 |
| 표 | 4 |
| keep (lang 명시) | 2 |
| **합계** | **8** |

이 그룹은 **표 비중이 절반(4건)**. 이미지 배포 시퀀스(prod-13~prod-19), 커밋-변경 매핑, 트리거 차이가 모두 구조적 매핑이라 표가 적합. 실 smoke 출력과 커밋 목록 2건은 lang=`text` 명시된 메타데이터라 그대로 keep.

---

## G9 — `series:istio-observability` (2026-04-29)

2편 / inventory flatten 추천 3블록 → 실제 평탄화 3블록.

### `istio-observability-part2-tracing.md` (2블록)

- L44-64 Span 타임라인 ASCII 시각화 (20줄, Span A~D nested) → **표 + 본문 보강** (Span/서비스/시작ms/종료ms/비고 5열, 부모-자식 관계 + 외부 호출 latency 누적 설명 추가)
- L440-443 Jaeger 진단 절차 박스 → **번호 목록** (2단계, 한국어 화살표 결론을 본문에 흡수)

### `istio-observability-part4-kiali.md` (1블록)

- L394-403 Kiali 시나리오 3 설정 검증 절차 → **번호 목록** (4단계, ✖/⚠ 분류는 한 줄 인라인으로 통합)

### G9 통계

| 변환 | 건수 |
|---|---|
| 표 + 본문 보강 | 1 |
| 번호 목록 | 2 |
| **합계** | **3** |

타임라인 박스는 표로 풀면서 부모-자식 호출 관계와 latency 누적 메커니즘을 문장으로 보강했습니다. 시각화 가치가 일부 줄어드는 대신 트레이스 구조의 의미가 명시적으로 드러나도록 했습니다 — 디자인 개편 세션에서 다이어그램 컴포넌트로 다시 시각화할 후보. 진단 절차 2건은 모두 번호 목록.

---

## G10 — `series:goti-cloudflare-migration` (2026-04-29)

2편 / inventory flatten 추천 10블록 → 실제 평탄화 10블록 (전부).

### `goti-cloudflare-migration-troubleshoot.md` (7블록)

- L59-62 Custom Error Response 설정 매핑 → **bullet 목록** (403/404 → `/index.html` 2건)
- L70-75 CloudFront Custom Error Response 흐름 (Backend→CloudFront→Client) → **번호 목록** (3단계, "왜 HTML이 오지?" 의문은 파싱 에러 설명으로 보강)
- L98-102 SSL 이중 종단 무한 루프 → **번호 목록** (4단계 사이클)
- L126-128 기대 동작 매핑 (`/api/*` → Workers, `/*` → Pages) → **bullet 목록**
- L146-149 Pages/Workers 분리 해결 절차 → **번호 목록** (3단계)
- L223-224 `dev-api` CNAME 설정 (1줄) → **인라인** (한 문장으로 흡수)
- L323-327 디버깅 4단계 → **번호 목록** (Step별 변수 좁히기)

### `goti-cloudflare-migration-adr.md` (3블록)

- L31-33 기존 아키텍처 (CloudFront → S3/Kind PC 분기) → **bullet 목록** (2갈래)
- L69-72 SSL 이중 종단 무한 301 루프 → **번호 목록** (3단계 사이클)
- L276-279 Pages/Workers 우선순위 해결 → **번호 목록** (3단계)

### G10 통계

| 변환 | 건수 |
|---|---|
| 인라인 | 1 |
| bullet 목록 | 3 |
| 번호 목록 | 6 |
| **합계** | **10** |

이 그룹은 **번호 목록 비중이 60%**로 가장 높았습니다. CloudFront/Cloudflare 마이그레이션 전체 서사가 "5가지 문제의 연쇄"이고, 각 문제가 단계별 사이클(SSL 이중 종단, 디버깅 step, 해결 절차 등)이라 번호 목록이 가장 자연스러웠습니다. SSL 이중 종단 흐름이 troubleshoot/adr 두 글에서 반복되는데(L98-102, L69-72) 두 곳 모두 번호 목록으로 일관되게 변환했습니다.

---

## G11~G14 — 묶음 처리 (2026-04-29)

13편 / inventory flatten 추천 23블록 → 실제 평탄화 14블록 + keep 보정 9블록.

### G11 `series:goti-auth` (3편 / 5블록 → 1 flatten + 4 keep)

- `goti-signup-dtype-regression.md` L125-134 dtype 컬럼 제거 diff (lang=`diff`) → **keep**
- `goti-signup-dtype-regression.md` L144-146 검증 로그 (lang=`text`) → **keep**
- `goti-signup-created-at-bug-and-sql-audit.md` L34-38 1차 신호 4건 (lang=`text`) → **keep**
- `goti-signup-created-at-bug-and-sql-audit.md` L44-46 2차 신호 (lang=`text`) → **keep**
- `goti-jwks-distribution-automation-adr.md` L112-121 GitHub Actions 자동화 흐름 → **번호 목록** (5단계, schedule/repository_dispatch 트리거 → SSM pull → PR → ArgoCD sync)

### G12 `cat:challenge` (3편 / 6블록 → 4 flatten + 2 keep)

- `docker-compose-env-management.md` L47-50 환경변수 산발 매핑 → **bullet 목록** (3개 파일 위치)
- `docker-compose-env-management.md` L249-251 Before 시뮬레이션 인용 → **인라인** (한 문장으로 흡수)
- `docker-compose-env-management.md` L256-262 After 안내 3단계 → **번호 목록**
- `goti-poc-ab-test-dependency-isolation-pattern.md` L39-41 API 호출 시퀀스 (lang=`text`) → **keep**
- `goti-poc-ab-test-dependency-isolation-pattern.md` L168-176 [문제]/[해결] 박스 → **굵은 글씨 + 번호 목록** (문제 문장 분리, 해결은 3단계 라우팅)
- `go-dependency-genproto-conflict.md` L72-75 grpc-gateway/v2 의존성 트리 → **keep** (lang=`text` 추가, 위쪽 의존성 트리와 일관성)

### G13 `series:goti-redis-sot` (3편 / 7블록 → 4 flatten + 3 keep)

- `goti-phase6-redis-inventory.md` L30-31 Redis Lock + DB TX 흐름 (1줄) → **인라인**
- `goti-phase6-redis-inventory.md` L83-87 TOCTOU race 시퀀스 (lang=`text`) → **keep** (인터리빙이 의미 핵심)
- `goti-phase6-redis-inventory.md` L98-101 Before/After 아키텍처 → **표** (시점/hot path 흐름/추가 3열)
- `goti-redis-sot-adoption-adr.md` L31-33 API 응답 시간 (lang=`text`) → **keep**
- `goti-redis-sot-adoption-adr.md` L167-175 D0~D7 롤아웃 단계 → **번호 목록** (8단계, 각 단계 백엔드 컴포넌트 굵은 글씨)
- `goti-redis-sot-d0-d1-rollout.md` L174-176 latency_ms 21건 측정 (lang=`text`) → **keep**
- `goti-redis-sot-d0-d1-rollout.md` L187-191 프론트/백엔드 차이 분해 → **bullet 목록** (3행, 차이 934ms 강조)

### G14 `series:goti-ticketing-phase` (3편 / 5블록 → 5 flatten)

- `goti-phase7-d-overturn-decision.md` L44-45 경로 A 1줄 흐름 → **인라인**
- `goti-phase7-d-overturn-decision.md` L61-70 경로 B 9단계 → **번호 목록** (Phase 6 → 6.5 → 7 → Step 4~9)
- `goti-phase6-ticketing-implementation.md` L73-75 Java vs Go 쿼리 비교 → **표** (구현/대상 테이블/쿼리 3열)
- `goti-phase6-ticketing-implementation.md` L187-193 통합 테스트 항목 → **bullet 목록** (Repo별 + E2E 시퀀스)
- `goti-phase8-p0-seat-booking-port.md` L163-168 배포 흐름 → **번호 목록** (5단계)

### G11~G14 통계

| 변환 | 건수 |
|---|---|
| 인라인 | 3 |
| 표 | 3 |
| bullet 목록 | 3 |
| 굵은 글씨 + 번호 목록 | 1 |
| 번호 목록 | 4 |
| keep (lang 명시) | 9 |
| **합계** | **23** |

이 묶음에서는 **keep 비중이 다시 높아졌습니다**(9/23). go-ti 시리즈가 lang=`diff`/`text`로 명시한 실제 diff/로그/측정값을 많이 인용하기 때문입니다. 평탄화 대상은 다단계 흐름(D0~D7 롤아웃, 경로 B 9단계, GitHub Actions 자동화)에 번호 목록이 압도적이었고, Java vs Go 쿼리 비교나 Before/After 아키텍처 같은 구조적 매핑은 표로 변환했습니다.

---

## G15~G24 — 묶음 처리 (2026-04-30)

20편(잔여 시리즈 1~7편 + 카테고리 묶음) / inventory flatten 추천 37블록 → 실제 평탄화 28블록 + keep 보정 9블록.

### G15 `series:istio-intro` (1편 / 2블록)

- `istio-intro-part1-why-service-mesh.md` L30-42 모놀리식 박스(12줄) → **bullet 목록** ("단순한 세계" 박스 → 한 줄 흐름 + 4개 bullet)
- `istio-intro-part1-why-service-mesh.md` L89-98 라이브러리 업그레이드 사이클(9줄) → **번호 목록** (4단계 + 결론 문장)

### G16 `series:goti-queue-poc` (2편 / 5블록 → 3 flatten + 2 keep)

- `goti-poc-queue-a-401-ticketing-isolation.md` L50-51 단일 401 응답 → **인라인** (본문에 `POST .../validate → 401(empty body)`)
- `goti-poc-queue-a-401-ticketing-isolation.md` L69-75 403/400 JSON 응답 (lang=-) → **lang=`text` 추가 keep** (실제 응답 출력)
- `goti-poc-queue-a-401-ticketing-isolation.md` L161-162 200 OK 결과 → **인라인**
- `goti-queue-loadtest-k6-two-phase-design.md` L88-89 4단계 인터페이스 → **인라인**
- `goti-queue-loadtest-k6-two-phase-design.md` L139-152 디렉토리 트리(코멘트에만 화살표) → **keep** (lang=`text` 이미 명시, 디렉토리 구조 보존)

### G17 `series:queue-poc-loadtest` (1편 / 4블록 → 2 flatten + 2 keep)

- `queue-poc-loadtest-part1-design.md` L67-68 4단계 인터페이스 → **인라인**
- `queue-poc-loadtest-part1-design.md` L108-121 디렉토리 트리 → **keep** (lang=`text` 추가, 코멘트 화살표만 있음)
- `queue-poc-loadtest-part1-design.md` L137-138 401 응답 → **인라인**
- `queue-poc-loadtest-part1-design.md` L179-184 403/400 응답 → **keep** (lang=`text` 추가, 실제 응답 출력)

### G18 `cat:monitoring` (4편 / 6블록 → 5 flatten + 1 keep)

- `goti-discord-alerting-architecture.md` L269-274 배포 순서 역전 4단계 → **번호 목록**
- `goti-discord-alerting-architecture.md` L305-308 정상 배포 순서 → **번호 목록**
- `goti-adr-loki-tempo-stability-tuning.md` L221-223 Loki Before/After (2줄) → **굵은 글씨 bullet**
- `goti-adr-loki-tempo-stability-tuning.md` L230-232 Tempo Before/After (2줄) → **굵은 글씨 bullet**
- `goti-tempo-scoped-tag-traceql-variable.md` L40-45 PromQL/TraceQL 비교 → **표** (쿼리 언어/예시/변환 3열, pipe는 `\|` 이스케이프)
- `goti-prometheus-agent-mode-adr.md` L33-35 토폴로지 2줄 (lang=`text`) → **keep** (보완 시각화)

### G19 `series:eks-infra` (1편 / 3블록)

- `cloudfront-s3-troubleshooting.md` L43-48 응답 헤더 ASCII 박스(주석 화살표) → **lang=`http` 명시 + 본문 분리** (정보 가치 있는 응답 헤더는 보존, 한국어 주석 화살표만 본문 한 문장으로)
- `cloudfront-s3-troubleshooting.md` L72-79 SPA fallback 사슬 → **번호 목록** (4단계)
- `cloudfront-s3-troubleshooting.md` L355-362 URL Rewrite 4단계 → **번호 목록 + bullet**

### G20 `series:goti-eks` (2편 / 3블록 → 2 flatten + 1 keep)

- `goti-eks-node-join-401-cluster-policy.md` L138-144 인증 실패 사슬 → **번호 목록** (5단계, 403/401 분기 강조)
- `goti-eks-node-join-401-cluster-policy.md` L151-156 Terraform 정책 분기(lang=`hcl`) → **keep** (실 Terraform 코드, 한국어 주석 화살표만 잡혀 보정)
- `goti-eks-rolling-update-cascading-failures.md` L96-103 SG 충돌 흐름 → **번호 목록** (2단계 apply 단계별 풀어쓰기)

### G21 `series:challenge-2-wealist-migration` (4편 / 4블록)

- `challenge2-wealist-migration-part5.md` L428-435 환경변수 진화 + 실무 추천 → **인라인 + bullet 목록**
- `challenge2-wealist-migration-part3.md` L272-275 네임스페이스 분리 박스 → **bullet 목록**
- `challenge2-wealist-migration-part2.md` L108-111 PVC 매핑 → **bullet 목록**
- `challenge2-wealist-migration-part4.md` L170-172 Ingress 경로 매핑 → **bullet 목록**

### G22 `series:goti-istio-ops` (3편 / 5블록 → 3 flatten + 2 keep)

- `goti-istio-peerauth-selector-prometheus-503.md` L40-43 Prometheus targets 출력(lang=`text`) → **keep**
- `goti-istio-peerauth-selector-prometheus-503.md` L114-116 403 출력(lang=`text`) → **keep**
- `goti-dev-loadtest-ssh-istio-turnstile.md` L30-31 SSH 경로(1줄) → **인라인**
- `goti-dev-loadtest-ssh-istio-turnstile.md` L56-57 NodePort 경로(1줄) → **인라인**
- `goti-istio-injection-label-pg-max-connections.md` L156-163 max_connections 산정 → **번호 목록** (4단계 산식)

### G23 `series:eks-security` (1편 / 2블록 → 1 flatten + 1 keep boundary)

- `websocket-token-refresh.md` L34-42 콘솔 로그(8줄) → **lang=`text` 명시 + 본문 보강 keep** (한국어 주석 화살표만 본문 한 문장으로 풀어 흡수)
- `websocket-token-refresh.md` L93-99 문제의 흐름 6단계 → **번호 목록**

### G24 `series:game-server` (1편 / 3블록)

- `challenge1-game-server-part7.md` L72-76 경로→Service 매핑(4건) → **bullet 목록**
- `challenge1-game-server-part7.md` L199-206 rewrite-target Before/After → **표** (설정/요청/전달/결과 4열)
- `challenge1-game-server-part7.md` L242-244 도메인→Service 매핑(2건) → **bullet 목록**

### G15~G24 통계

| 변환 | 건수 |
|---|---|
| 인라인 | 8 |
| bullet 목록 | 6 |
| 번호 목록 | 11 |
| 표 | 3 |
| keep (lang 명시 보정) | 9 |
| **합계** | **37** |

이 묶음의 특징은 **번호 목록 비중이 다시 높아진 것(11건)** 입니다. 인증 실패 사슬, SG 충돌 단계, 배포 순서 역전, max_connections 산정처럼 "원인의 단계적 재구성"이 많아 번호 목록이 가장 자연스러웠습니다. lang=`text` 명시된 실제 응답·콘솔 로그·토폴로지 박스 9건은 keep 보정. 누적 145/211 (69%) + keep 36.

---

## G25~G41 — 잔여 17 그룹 묶음 처리 (2026-04-30)

24편 / inventory flatten 추천 30블록 → 실제 평탄화 26블록 + keep 보정 4블록. 작은 그룹(글당 1~3 블록)이라 한 묶음으로 처리.

### G25 `series:goti-multicloud-db` (1편 / 1블록)

- `goti-read-replica-split-adr.md` L121-133 RDS Primary/Replica 박스(12줄) → **표 + 본문 보강** (흐름/출발/도착/인스턴스 4열 + 비동기 복제 한 줄 추가)

### G26 `series:goti-cloudfront-alb` (2편 / 4블록)

- `goti-cloudfront-swagger-403.md` L60-63 behavior 매핑 → **bullet 목록**
- `goti-cloudfront-swagger-403.md` L106-111 최종 behavior 5건 → **표** (경로 패턴/라우팅 대상 2열)
- `goti-dev-monitoring-502.md` L38-40 502 경로 2건 → **인라인 + 굵은 글씨**
- `goti-dev-monitoring-502.md` L47-49 Target Group unhealthy 2건 → **bullet 목록**

### G27 `series:goti-ec2-deploy` (2편 / 2블록 → 1 flatten + 1 keep)

- `goti-postgres-healthcheck-env.md` L121-125 좌변/우변 ASCII 박스 → **lang=`yaml` + 본문 풀어쓰기** (좌/우변 의미는 본문 한 문장으로)
- `goti-docker-network-loki-healthcheck.md` L157-164 헬스체크 로그(8줄) → **lang=`text` + 보강 keep** (한국어 화살표 주석 `← 드디어 통과!`만 제거하고 본문에 한 문장 추가)

### G28 `cat:argocd` (1편 / 1블록)

- `goti-container-image-update-strategy-adr.md` L207-218 Renovate 자동화 흐름(11줄) → **단계별 굵은 글씨 헤더 + 번호 목록** (CI/CD 1단계 + Renovate 5단계)

### G29 `series:goti-argocd` (2편 / 2블록)

- `goti-argocd-otel-collector-crashloop.md` L125-127 OTLP 코드 경로 2갈래 → **번호 목록**
- `goti-argocd-ssa-diff-deployment-skip.md` L35-42 OutOfSync 두 시점 → **표 (병합)** (리소스/ArgoCD 상태/sync 결과 3열)

### G30 `series:goti-otel-prometheus` (2편 / 4블록 → 3 flatten + 1 keep)

- `goti-monitoring-dashboard-nodata.md` L75-78 PromQL 깨지는 패턴(lang=`promql`) → **keep** (실 PromQL 코드 + 주석 화살표 보정)
- `goti-monitoring-dashboard-nodata.md` L166-168 Before/After 파이프라인 → **굵은 글씨 bullet**
- `goti-prometheus-job-label-mismatch.md` L44-46 No Data 2건 → **bullet 목록**
- `goti-prometheus-job-label-mismatch.md` L126-127 변수 기본값 변경 → **인라인**

### G31 `series:goti-pgbouncer` (2편 / 3블록)

- `goti-pgbouncer-rollout-and-load-test.md` L114-115 DSN URL 파싱 실패(1줄) → **인라인** (parse error 인용 한 문장으로)
- `goti-pgbouncer-rollout-and-load-test.md` L344-346 MaxConns 조정 (2줄) → **인라인** (18→10 + 산식)
- `goti-pgbouncer-connection-pooling-adr.md` L37-40 max_connections 도달 사슬 → **번호 목록** (3단계)

### G32 `series:goti-argocd-gitops` (2편 / 3블록)

- `goti-ecr-secret-dollar-escape.md` L59-60 ECR 토큰 사슬 → **인라인**
- `goti-ecr-secret-dollar-escape.md` L68-69 ESO 불능 사슬 → **인라인**
- `goti-image-updater-multisource.md` L230-233 SSM→K8s key 변환 → **인라인**

### G33 `series:goti-resale` (1편 / 2블록)

- `goti-resale-istio-rbac-403.md` L36-40 호출 흐름 다이어그램(4줄) → **번호 목록** (3단계, 마지막 단계 굵은 글씨로 403 차단 강조)
- `goti-resale-istio-rbac-403.md` L63-64 평가 순서(1줄) → **인라인**

### G34 `series:goti-spring-otel` (1편 / 1블록)

- `goti-hikaricp-otel-beanpostprocessor.md` L80-85 BPP 호출 순서(5줄) → **번호 목록** (2단계, instanceof 체크 실패 강조)

### G35 `series:goti-loadtest` (1편 / 1블록)

- `goti-load-test-db-realistic-data.md` L144-148 Enum 값 매핑(4줄) → **표** (테이블/직관적 추측/실제 Enum 3열)

### G36 `series:goti-metrics-collector` (1편 / 1블록)

- `goti-metrics-collector-pipeline-e2e.md` L112-116 비즈니스 메트릭 부재 → **bullet 목록**

### G37 `series:istio-ambient` (1편 / 1블록 → keep)

- `istio-ambient-part7-migration-to-sidecar.md` L82-85 Terraform Before/After "After" 블록(lang=`hcl`) → **keep** (실 Terraform, 주석 화살표만 보정 — G2 패턴)

### G38 `series:goti-scaling` (1편 / 1블록 → keep)

- `goti-node-rightsizing-and-rebalancing.md` L58-61 Descheduler 로그(lang=`text`) → **keep + 본문 보강** (한국어 화살표 주석 `← 전 노드 CPU 95~100%`만 제거하고 본문 한 문장으로 풀어 흡수)

### G39 `series:istio-traffic` (1편 / 1블록)

- `istio-traffic-part3-circuit-breaker.md` L358-360 Kiali 절차(2줄) → **인라인** (굵은 글씨로 단계 강조)

### G40 `series:observability` (1편 / 1블록)

- `otel-monitoring-v3.md` L383-384 spanmetrics connector 흐름(1줄) → **인라인**

### G41 `series:goti-kind-monitoring` (1편 / 1블록)

- `goti-virtualservice-fqdn-503.md` L42-43 트래픽 흐름(1줄) → **인라인**

### G25~G41 통계

| 변환 | 건수 |
|---|---|
| 인라인 | 12 |
| bullet 목록 | 5 |
| 번호 목록 | 6 |
| 표 | 3 |
| lang 명시 + 본문 풀어쓰기 | 1 (G27 yaml) |
| keep (lang 명시 보정) | 4 (text 2, hcl 1, promql 1) |
| **합계** | **31** (한 블록은 표 병합으로 두 시점 합쳐 2건 → 30 인벤토리 매칭) |

이 묶음은 **인라인 비중이 가장 높았습니다(12건)**. 글당 1~3 블록의 작은 그룹이 많아 1줄짜리 화살표 흐름·간단한 매핑은 인라인이 가장 자연스러웠습니다. 표 3건(G25 RDS, G29 SSA 병합, G35 Enum)은 모두 구조적 매핑. lang=`text`/`hcl`/`promql` 명시 코드 4건은 keep 보정.

---

## Phase 3 종료 — 누적 통계

| 묶음 | 글 | 평탄화 | keep |
|---|---|---|---|
| G1~G14 (단일/2~3 그룹 묶음) | 78 | 117 | 27 |
| G15~G24 | 20 | 28 | 9 |
| G25~G41 | 24 | 26 | 4 |
| **합계** | **122** | **171** | **40** |

inventory 211 flatten 추천 = **171 평탄화 + 40 keep 보정**으로 모두 처리. 키프 비중이 다소 높았던 이유는 자동 분류 룰이 lang=`text`/`hcl`/`promql`/`log`/`diff`로 명시된 실 출력·코드를 화살표 토큰만으로 `arrow-only`로 잡는 케이스가 많아서입니다. 사람 판단으로 "lang 명시 + 정보 가치 있는 출력 → keep" 보정 룰을 일관 적용했습니다 (Phase 4 후보로 자동화 가능 — `criteria.md` 분류 보정 룰 섹션 참조).

---

## Phase 4 — 마무리 (2026-04-30)

Phase 3 평탄화 작업 완료 후 재발 방지 정책과 정량 검증을 진행했습니다.

### 1. CLAUDE.md 재발 방지 정책 추가

`CLAUDE.md`에 **"ASCII 다이어그램 정책 (재발 방지)"** 섹션을 신설했습니다 (DevOps 블로그 특화 규칙 아래, 마지막 구분선 위).

| 패턴 | 정책 |
|---|---|
| 박스(`┌┐└┘`) + 5줄 이상 | **금지** |
| 박스 + 5줄 이하 | **지양** |
| 디렉토리 트리(`├ └`) | **허용** — 단, ` ```text` 명시 필수 |
| 짧은 인라인 흐름(`A → B → C`) | **허용** — 한 줄짜리만 |
| 다단계 흐름 (3단계 이상) | **금지** — 번호 목록으로 |
| Before/After 비교 박스 | **금지** — markdown 표로 |
| ASCII 디자인 목업 | **허용** — Design Change Rule 적용 |

평탄화 우선순위 5단계(인라인 → 번호 목록 → 표 → 콜아웃 → 다이어그램 컴포넌트)와 자가 점검 절차도 함께 명문화. CLAUDE.md 버전을 1.1 → 1.2로 갱신하면서 기존 "[SHOULD] 아키텍처 다이어그램 포함 권장" 문구를 "[SHOULD] 복잡한 구성은 다이어그램 보조 (ASCII 박스 금지 — 아래 정책 참고)"로 손봤습니다 — 신규 글이 다시 박스로 회귀하지 않도록.

### 2. scan.mjs 재실행 — Before/After 정량 검증

| 항목 | Before (Phase 1 시작) | After (Phase 4 종료) | 차이 |
|---|---|---|---|
| ASCII 블록 포함 글 | 141편 | 106편 | **-35편 (-25%)** |
| 전체 블록 수 | 429 | 265 | **-164 (-38%)** |
| 전체 라인 합계 | 4,425 | 3,707 | **-718 (-16%)** |
| flatten 추천 | 211 | 38 | **-173 (-82%)** |
| keep 추천 | 105 | 105 | 0 |
| skip 추천 | 113 | 122 | +9 |

flatten 추천이 211 → 38로 82% 감소했습니다. 남은 38건은 Phase 3에서 사람 판단으로 keep 보정한 블록 중 자동 분류기가 여전히 `arrow-only`/`misc`로 추천하는 케이스(lang=`text`/`hcl`/`promql` 명시되어 있어도 화살표 토큰이 잡히는 패턴)가 대부분입니다. `criteria.md`의 보정 룰을 `scan.mjs`에 자동화하면 0에 가깝게 줄일 수 있습니다 — 다음 세션 후보.

keep 105는 그대로 유지되어 **디자인 개편 세션의 시각화 입력 자산**이 손상 없이 보존되었음을 확인했습니다.

백업본은 `inventory.before.md/json`로 보존하여 git diff로 Before/After를 언제든 비교 가능합니다.

### 3. 작업 폴더 보존

`.claude/plans/ascii-cleanup/` 전체를 git 추적 그대로 유지(audit 폴더와 동일 패턴):

- `state.md` — Phase 1~4 진행 로그 + Before/After 통계
- `criteria.md` — 결정 룰 + 분류 보정 룰 + 재발 방지 표
- `decisions.md` — G1~G41 그룹별 처리 결정 누적 (이 파일)
- `inventory.md`/`inventory.json` — 현재(After) 인벤토리
- `inventory.before.md`/`inventory.before.json` — Phase 1 시작(Before) 인벤토리
- `groups.md` — 41 그룹 자동 산출
- `scripts/scan.mjs`, `scripts/groups.mjs` — 분류 + 그룹화 자동화

### Phase 1~4 종합

- **141편 / 429블록 / 4,425줄** ASCII 다이어그램을 정량 분석하고 분류 룰을 자동화
- **102편 / 211블록 / 1,017줄** 평탄화 후보를 41 그룹으로 묶어 시리즈 일관성을 유지하며 처리
- **171 평탄화 + 40 keep 보정**으로 211블록 전부 사람 판단을 거쳐 처리, 본문 흐름·정보는 모두 보존
- **CLAUDE.md 정책 신설**로 재발 방지
- **keep 105블록 보존**으로 디자인 개편 세션의 시각화 입력 자산 확보

다음 세션은 **디자인 개편(다크모드 제거 + keep 105 블록 시각화 시스템 결정)**으로 이어집니다.
