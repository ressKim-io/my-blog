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
