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
