# Batch 19 인계 — 2026-10-24

글 3편·SVG 7장 검수 완료. 콘텐츠 커밋 `6cff167`
작성 기준일은 2026-10-23이며 학습일·배포일이 아니다. 최종 검증일은 2026-10-24다

## 원본·결과 대응

Vault 원본은 읽기 전용이며 검증 전후 SHA-256 일치를 확인했다
원본 루트: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/`

| 좌표 | 정확한 원본 파일명 | 줄 수 | SHA-256 | slug | series / order |
|---|---|---:|---|---|---|
| 5-3 | `Phase 5-3 · controller-runtime 과 reconcile · 큐에 담기는 것은 이름뿐이다.md` | 600 | `8379f5ebdccd8dfe823fd6fc725eb8de19c96c2b5b76005c4cfb1a55f17c3c95` | `k8s-theory-controller-runtime-reconcile` | `k8s-theory-extension` / 3 |
| 5-4 | `Phase 5-4 · 정책 계층 · 판정은 사라지고 변경은 주인이 없다.md` | 675 | `d1fa91d0909dc605fc008fff1e07328fcdce9d9b1f94fa291e3495f852f9c89f` | `k8s-theory-policy-layers` | `k8s-theory-extension` / 4 |
| 5-5 | `Phase 5-5 · Aggregated API server · 경로 하나를 넘기면 목록 전체가 걸린다.md` | 572 | `186e9a18d390643d16c2f5f57b622be0356eec721bf73bdfb7a570c133143295` | `k8s-theory-aggregated-api-server` | `k8s-theory-extension` / 5 |

## 작성자의 근거 대조·편집 기록

작성 단계의 기록이며 이후 정정은 별도 검수·수정 기록을 우선한다

# Batch 19 · 5-5 인계

- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 5-5 · Aggregated API server · 경로 하나를 넘기면 목록 전체가 걸린다.md` · 전문 572줄 확인
- 원본 SHA256: `186e9a18d390643d16c2f5f57b622be0356eec721bf73bdfb7a570c133143295` · 탈고 후 최신 파일과 다시 일치 확인
- 변환: `src/content/essays/kubernetes/k8s-theory-aggregated-api-server.md`
- 등록: essays/kubernetes · `k8s-theory-extension` order 5 · 2026-10-23
- 산출물: 본문 262줄, SVG 2개, 표 4개. 공통 문서·build·commit·push는 실행하지 않음

## 실제 대조한 근거

- Kubernetes v1.37.1 고정 ref `f78e722310e50bcaca9276be22276d9e91d91308`. APIService v1 필드·정렬, AddAPIService route, proxy/transport, remote Available, requestheader, 위임 인가, 기존·집계 discovery, client-go Stale 처리, OpenAPI v2/v3, Namespace 삭제 실제 코드 확인
- APIService/프록시: https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kube-aggregator/pkg/apiserver/handler_proxy.go
- Available/TLS: https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kube-aggregator/pkg/controllers/status/remote/remote_available_controller.go
- 집계 discovery: https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kube-aggregator/pkg/apiserver/handler_discovery.go
- OpenAPI v2/v3: https://github.com/kubernetes/kubernetes/tree/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kube-aggregator/pkg/controllers
- Namespace 삭제: https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/namespace/deletion/namespaced_resources_deleter.go
- 공식 문서 고정 website ref `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`: aggregation 개념/구성, custom resources 비교, resource metrics pipeline. 웹의 현행 aggregation 문서도 열어 확인
- 위임 신뢰 설명: https://kubernetes.io/docs/tasks/extend-kubernetes/configure-aggregation-layer/
- metrics-server 현재 latest release/tag API를 이번 작업에서 직접 조회: `v0.9.0` → `2a7c4b2c7d46552ff47f4aeaa3a735c582587ecd`. 실제 go.mod는 Go 1.26.4, Kubernetes API/apimachinery/apiserver/client-go 등 v0.36.2. 코어 1.37 소스와 구분
- 릴리스 확인: https://api.github.com/repos/kubernetes-sigs/metrics-server/releases/latest
- 저장·계산: https://github.com/kubernetes-sigs/metrics-server/tree/2a7c4b2c7d46552ff47f4aeaa3a735c582587ecd/pkg/storage
- 수집 루프: https://github.com/kubernetes-sigs/metrics-server/blob/2a7c4b2c7d46552ff47f4aeaa3a735c582587ecd/pkg/server/server.go
- 간격 기본값·검증: https://github.com/kubernetes-sigs/metrics-server/blob/2a7c4b2c7d46552ff47f4aeaa3a735c582587ecd/cmd/metrics-server/app/options/options.go
- 배포 인자: https://github.com/kubernetes-sigs/metrics-server/blob/2a7c4b2c7d46552ff47f4aeaa3a735c582587ecd/manifests/base/deployment.yaml
- 역사적 설계 문서 ref `acc25e14ca83dfda4f66d8cb1f1b491f26e78ffe`의 only-most-recent 문장과 현재 구현 구분. 원본의 미확인 메모리 항목은 이미 2026-09-14/10-01에 해소됐으며 현재 소스로 재확인
- URL/ref/로컬 경로/SHA256은 `manifest.json` 35개와 `extra-manifest.json` 9개에 저장. OpenAPI 경로는 GitHub contents API로 실제 목록 확인 후 다운로드했고 `openapi-inventory.json`에 보존

## 정정·조건 보존

- APIService는 외부 서버만 뜻하지 않음: service=nil은 로컬 위임. 포트 443은 기본값이며 실제 지정 포트를 사용함. APIServiceSpec의 오래된 443 고정 주석을 실행 동작으로 옮기지 않음
- 우선순위는 그룹·버전 discovery 정렬 조건. 모든 클라이언트 이름 해석이나 트래픽 우선순위 보장으로 확장하지 않음
- 인증 성공 후 Authorization 제거, 동명 신원 헤더 재작성. UID는 기본 활성 Beta gate와 실제 UID 존재 조건을 함께 명시. 서버 검증 CA와 requestheader CA, 일반 client CA를 구분하고 CA 재사용 위험은 허용 CN 조건까지 제한
- SAR는 위임 구성의 인가 경로이며 캐시·허용 그룹/경로 예외가 있어 요청마다 호출한다고 쓰지 않음. ConfigMap reader 권한과 auth-delegator 권한 구분
- 현재 probe와 실제 proxy 모두 BuildTransportConfig 사용. 원본의 과거 v1.35 probe TLS 차이를 현행처럼 쓰지 않음. ClusterIP 사전 검사 범위를 명시
- MissingEndpoints는 Ready true/nil endpoint와 같은 Slice의 이름 일치·비어 있지 않은 포트 항목 조건. 포트 이름 일치를 실제 포트 숫자 동일성으로 잘못 설명하지 않음
- 병렬 5회 중 한 번 성공, HTTP client 5초/그 안 대기 select 6초. ResolveEndpoint는 그 select 앞이므로 검사 전체 상한·일반 요청 지연으로 단정하지 않음. 2xx를 검사하며 응답 본문·원사용자 권한 검증이 아님
- 기존 /apis는 Available로 등록을 제거하지 않음. 현행 집계 discovery는 cache/ETag·Current/Stale를 별도 처리. 503 분기는 nil 결과를 반환하므로 언제나 옛 자원 목록을 제공한다고 설명하지 않음
- OpenAPI v2 문서 다운로드·병합과 v3 루트 집계를 구분. v2/v3 루트 다운로드 제한 1분은 상태 검사/집계 discovery 5초와 별도이며 일반 프록시 공통 상한이 아님
- Namespace 삭제는 discovery 오류를 기록하면서 알아낸 자원 삭제 가능. Pod 우선/잔존 시 다른 종류 대기 조건 보존. 오류 반환 시 finalize 미도달. 다른 condition/잔존 finalizer와 구분
- CRD 비교의 추가 subresource를 새 verb로 일반화하지 않음. RequestInfo의 일반 8개·경로 특수 proxy/watch와 bind/escalate 등 추가 인가 검사를 구분
- metrics-server 메트릭 저장은 메모리 last/prev, 조회 때 CPU 누적값 차분/표본 시간 차이 계산, 최근 memory working-set 사용. 표본 유효성과 컨테이너 시작·재시작 조건을 명시. 원본의 ‘최신값 하나/조회 무계산’ 과거 문장은 현행 사실로 옮기지 않음
- metric-resolution 코드 기본 60초, 같은 릴리스 기본 배포 인자 15초, 검증 최소 10초·kubelet timeout <= 간격 90%. 보관 기간·모든 배포의 주기 보장으로 쓰지 않음
- 역사적 25000 metrics/sec 설계 계산은 보편적 etcd 성능 상한이 아니므로 본문에서 재사용하지 않음. static metrics-server 프로젝트 사이트의 오래된 호환표보다 pinned v0.9 README·실제 소스를 우선

## 검증·문체

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-aggregated-api-server.md` 실제 실행: exit 0, error 0, warn 3. 문장 길이 경고 1건(6줄: 메타·alt·출처 위주), SVG text 수 경고 2건(18/20개)
- SVG 2개 XML 파싱 통과. sharp로 각각 800/375px PNG 4장 생성 후 모두 육안 확인: 한글 정상, 겹침·잘림 없음. 최소 폰트 21px/viewBox600으로 375px에서 13.125px. PNG는 이 보고서 폴더 `diagram-N-800.png`, `diagram-N-375.png`
- `git diff --check -- <소유 본문·SVG>` exit 0. 본문 끝 마침표 없음, 코드 블록 없음, 내부 Phase/LAB/종료판정 메타 없음
- 원본의 기전·조건·정정 이력과 대조해 격식체/과장/반복을 검토. 섹션별 시각화 재검토 결과 요청·신뢰 경로와 삭제 오류 전파만 SVG, 등록 필드·헤더·reason·condition은 표로 배치
- 원문 → 대표 변환: “부분적으로 지우는 것과 다 지웠다고 선언하는 것이 다르기 때문이다” → “부분적으로 삭제하는 것과 삭제 완료를 선언하는 것은 다릅니다”
- Decision 섹션 미포함: CRD 기능 비교는 보존하되 원본에 없는 개인 선택 서사를 만들지 않음

## 한계·다음 단계

- 핵심 미확인/보류 없음. 과거 metrics 메모리 미확인 항목은 최신 원본과 현재 구현으로 해소 확인
- 미실행 LAB·운영 경험·성능 측정·설치 결과 창작 없음. 실제 배포 인자·접속 상태·개별 확장 서버 지원은 이론 검증만으로 단정하지 않음
- 전체 lint/build/정적 출력·독립 검수·진행표/커밋 기록은 parent 단계. SVG text 수 경고는 실제 모바일 가독성 확인 결과와 함께 reviewer에게 인계


# Batch 19 · 5-4 정책 계층 인계

- 산출물: `src/content/essays/kubernetes/k8s-theory-policy-layers.md` · SVG 3개 · 표 5개
- 메타: essays/kubernetes · `k8s-theory-extension` order 4 · 2026-10-23
- 작업 범위: 본문·같은 slug SVG·이 임시 보고서만 작성, 공통 문서·타인 글 수정 없음

## 최신 원본

- 경로: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 5-4 · 정책 계층 · 판정은 사라지고 변경은 주인이 없다.md`
- 675줄 전문 확인 · SHA256 `d1fa91d0909dc605fc008fff1e07328fcdce9d9b1f94fa291e3495f852f9c89f`
- progress: 1122줄 · `c3081510322928d79907275e31e02c0f4708ec606644bed7581006645d1d16f5`
- Phase 5 source-map: 676줄 · `dc4920b72a458ab4d0b9276840624454fad65060c2803ce6de7306f8ad646e5e`
- Vault 공통 경로: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/` 아래 `☸️ progress.md`, `☸️ source-map · Phase 5.md`
- 공통 voice·draft-to-post와 연결 공동 절차·decision-tradeoff·시리즈 plan/source-format·SVG 기준 적용, 같은 extension 시리즈 CRD 스키마 글과 기존 SSA 글 대조

## 실제 읽은 고정 근거

캐시 기준 경로는 `/tmp/k8s-batch19/policy/<repo>/<path>`이며 전체 URL·ref·파일 SHA256은 `manifest.json`, `manifest-extra.json`에 기록했습니다
재검증한 성공 파일은 52개입니다. 처음 추정한 `storage_admissionregistration.go`의 404는 `storage_apiserver.go` 실제 경로를 읽어 해결했으며 실패 이력도 보존했습니다

- Kubernetes v1.37.1 `f78e722310e50bcaca9276be22276d9e91d91308` [소스](https://github.com/kubernetes/kubernetes/tree/f78e722310e50bcaca9276be22276d9e91d91308)
  - `go.mod`: cel-go v0.29.2, structured-merge-diff/v6 v6.4.2
  - `pkg/apis/admissionregistration/v1/defaults.go`, `validation/validation.go`, `staging/src/k8s.io/api/admissionregistration/v1/types.go`: 기본값·필수 필드·match·reason·action 검증
  - `pkg/registry/admissionregistration/rest/storage_apiserver.go`, `pkg/kubeapiserver/options/plugins.go`, `staging/src/k8s.io/apiserver/pkg/features/kube_features.go`: v1 API·플러그인 기본 활성·MAP/manifest 게이트
  - `staging/src/k8s.io/apiserver/pkg/admission/plugin/policy/generic/{plugin.go,policy_dispatcher.go}`: API/정적 정책 제외와 params 수집 설정 오류의 직접 Forbidden
  - 같은 경로 `policy/validating/{dispatcher.go,validator.go,policy_decision.go}`: false·실행 오류·validationActions·reasonToCode
  - 같은 경로 `policy/mutating/{dispatcher.go,patch/smd.go}`: mutations의 한 호출 내 순서·재실행·typed Merge·atomic 제한
  - 같은 경로 `webhook/{generic/webhook.go,predicates/rules/rules.go,matchconditions/matcher.go,mutating/dispatcher.go,validating/dispatcher.go}`: 여섯 제외 Kind·정적 분기·조건 false/오류·호출 오류와 명시적 거절
  - `staging/src/k8s.io/apiserver/pkg/endpoints/handlers/{create.go,update.go,patch.go,fieldmanager/admission.go}`: 장부 계산 후 mutation·PATCH 저장 재시도·장부 유효성 복원
  - `staging/src/k8s.io/pod-security-admission/admission/admission.go`: Namespace 정책 변경 시 기존 Pod 경고와 범위
- Kubernetes website `7fde177e22dc98390a6d55d215dd0301b5f6d0bb` [공식 문서 저장본](https://github.com/kubernetes/website/tree/7fde177e22dc98390a6d55d215dd0301b5f6d0bb)
  - `content/en/docs/reference/access-authn-authz/{validating-admission-policy.md,mutating-admission-policy.md,extensible-admission-controllers.md}`, `content/en/docs/concepts/security/pod-security-admission.md`
- Gatekeeper v3.23.1 `2d0b6ad97cf3a8b8436a00a1f4b07b3a56b92ca0` [공식 고정 소스](https://github.com/open-policy-agent/gatekeeper/tree/2d0b6ad97cf3a8b8436a00a1f4b07b3a56b92ca0)
  - `website/docs/{audit.md,sync.md,violations.md}`, `pkg/audit/manager.go`: 60초·20건·audit-from-cache false·syncOnly/SyncSet 합집합·enforcementAction
- Kyverno v1.19.2 `e63308f1e16c05cd009ac4864be6ec25c66b49be` [공식 고정 구현](https://github.com/kyverno/kyverno/tree/e63308f1e16c05cd009ac4864be6ec25c66b49be)
  - `pkg/webhooks/resource/generation/handler.go`: clone source 삭제·synchronize·source≠trigger 경계와 DeleteDownstream 요청
  - `pkg/background/generate/{controller.go,cleanup.go}`: 삭제 요청 분기·추적 라벨·UID·출처 검증·삭제 precondition
- Kyverno website `a10389d0d72e52aa5238a21fcf36ac1db06c7595` [공식 문서 저장본](https://github.com/kyverno/website/tree/a10389d0d72e52aa5238a21fcf36ac1db06c7595)
  - `src/content/docs/docs/policy-types/cluster-policy/{mutate.md,generate.md,external-data-sources.md}`: 비동기/기본 한 시간은 문서 기준·data/clone·foreach·외부 입력·Flux dry-run 설명
- Argo CD v3.5.6 `c2b1e3017e2cec86b122172e861dcd026453ae44` [공식 고정 문서](https://github.com/argoproj/argo-cd/tree/c2b1e3017e2cec86b122172e861dcd026453ae44/docs/user-guide)
  - `diff-strategies.md`, `diffing.md`, `resource_tracking.md`: Stable 표기·SSA dry-run·캐시·신규 제외·mutation 기본 제외/포함 옵션·managedFieldsManagers·추적/prune 범위

## 반영·정정

- v1.35 beta/off MAP 이력은 본문의 현재 조건으로 옮기지 않음: v1.37.1 GA/on·v1, 게이트에 LockToDefault 없음, MAP reinvocationPolicy 필수와 webhook 기본 Never 분리
- VAP false·실행 오류·params 설정 오류 분리, Warn/Audit-only여도 params Deny+Fail 설정 오류는 직접 403 가능, 검증 Deny는 reason 기본 Invalid/422와 다른 HTTP 코드 구분
- admission 새 독립 필드와 기존/atomic 소유 단위 구분, MAP ApplyConfiguration의 Merge를 독립 SSA manager 등록으로 표현하지 않음
- API 기반 CEL 네 종류·webhook 여섯 Kind·manifest 기반 정적 분기와 가상 review 보호 분리, 정책 삭제 보장으로 확대하지 않음
- Argo CD는 현재 v3.5.6 문서의 Stable 표기 사용, ServerSideDiff+IncludeMutationWebhook 조건·신규 비교 제외·추적/prune 조건 보존
- 최신 Kyverno 문서도 clone 원본 삭제 본문/표가 충돌함. 고정 v1.19.2 실제 삭제 경로를 source≠trigger·동기화·추적·UID/출처 검증 조건으로 한정하고 모든 clone 삭제로 일반화하지 않음
- generate.foreach·orphan·ownerReferences 수명 경계 유지, 원본 LAB·과거 SOURCE DIVE·종료 판정은 실제 실행 경험으로 바꾸지 않음

## 검증과 남은 한계

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-policy-layers.md` 실행: exit 0, error 0, warn 1
- 경고는 100자 초과 7줄이며 고정 SHA 근거 1줄·출처 URL 목록 6줄임. 일반 본문의 긴 문장은 분리 검토 완료
- `python3 /tmp/k8s-batch19/policy/checks.py` 실행: 원본 hash/줄수 일치, 캐시 성공 52파일 hash 일치, 메타·코드 언어·이미지·내부 링크·문단 끝 마침표·XML 통과, `output-checks.json` 기록
- SVG 3개 모두 title/desc/role 포함·텍스트 14/12/11개·560px 기준 최소20px → 375px에서13.39px, sharp로 800/375px 총6PNG 생성
- 생성 PNG 6개 모두 실제 육안 확인: 한글 깨짐·잘림·겹침 없음. 전 섹션 시각화 재검토: 위치/소유권 순서/존재 경쟁은 SVG, 비교·선택 기준은 표, 입력·예외는 산문
- 문맥 검토: 격식체·원본의 개념적 판단 보존, 개인 경험·성능 수치·실습 결과 창작 없음, 편집 경위·내부 Phase·LAB 본문 유입 없음
- 대표 문장: 원본 “새로 추가한 독립 필드가 기존 소유 집합에도 없으면 주인 없는 필드로 남을 수 있다” → 변환 “따라서 새로 붙인 독립 필드가 기존 소유 집합에도 없다면 어느 manager도 소유하지 않을 수 있습니다”
- 선택 기준 섹션 포함: 원본의 정책 수단 비교를 유지했으며 실제 도입 결정·미검증 대안·경험을 만들지 않음
- 미확인: 실제 서버 override·설치 제품 버전·네트워크/캐시 지연·운영 환경의 managedFields/응답/GC/prune 결과. Kyverno 한 시간은 문서 근거이며 외부 설치 검증이나 conformance test 실행 없음
- full lint·build·정적 export·별도 reviewer·진행표·커밋은 parent 담당이며 이 작업에서는 실행 안 함. 기술 핵심 근거의 차단 사유 없음


# Batch 19 · controller-runtime과 reconcile · 작성 인계

- 상태: 담당 본문·SVG·작성자 검증 저장, 독립 검수·배치 통합 검증 전
- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 5-3 · controller-runtime 과 reconcile · 큐에 담기는 것은 이름뿐이다.md`
- 정확한 파일명: `Phase 5-3 · controller-runtime 과 reconcile · 큐에 담기는 것은 이름뿐이다.md`
- 전문 600줄 읽음, 원본 SHA-256 `8379f5ebdccd8dfe823fd6fc725eb8de19c96c2b5b76005c4cfb1a55f17c3c95`. 작성 뒤 최신 원본을 다시 읽어 hash/줄 수 일치 확인
- 대상 `src/content/essays/kubernetes/k8s-theory-controller-runtime-reconcile.md`, series `k8s-theory-extension` / order 3 / date `2026-10-23`
- tags: `kubernetes, controller-runtime, reconcile, operator, concept`
- 편집 범위는 담당 본문·동일 slug SVG 2개·이 임시 폴더. 공통 docs·원본·타인 콘텐츠 수정, build·commit·push 실행 없음

## 원본과 현재 버전 범위

- draft-to-post 진입점·공동 SKILL과 docs/writing-voice, plan/source-format/SVG 기준을 읽고 적용. 같은 시리즈 `k8s-theory-crd-schema-pruning.md`의 CRD/controller 및 status 책임 구분을 참조
- 최신 progress 1122줄 `c3081510322928d79907275e31e02c0f4708ec606644bed7581006645d1d16f5`, main source-map 123줄 `36cadfdf517ab7a33708be8e867f8b4d303d762e873ddd3c31564b8c77e704ae`, Phase 5 source-map 676줄 `dc4920b72a458ab4d0b9276840624454fad65060c2803ce6de7306f8ad646e5e`의 5-3 절·현행 추가 판정·진행 행 확인 (`source-final.json`)
- 원본 고정: **controller-runtime v0.23.1**, tag target `f52bbb8bb1a2275cbe90dec8d6c12d5cacb1a7de`, Go 1.25.0·k8s.io 계열/client-go v0.35.0
- 원본 의존 client-go v0.35.0 tag target `9bcb69436287b966d0c5c195efef00aed921fb1b`. 원본의 코어 staging 경로와 실제 라이브러리 의존 버전을 혼동하지 않도록 독립 저장소에서 확인
- **현재 공식 releases/latest API를 실제 조회:** controller-runtime **v0.25.2**, tag target **`5d8467b3065818a3b382d8f6941147a801fd1969`**, Go 1.26.0·k8s.io 계열/client-go **v0.37.0**, 해당 의존성을 바꾸는 replace 없음
- 현재 의존 client-go v0.37.0 tag target **`28076445520055420e3be4255b4cd27fd19df1f9`**. 실제 go.mod와 태그 응답은 `latest-ref.json`, `latest-client-go-ref.json`, `library-refs.json`
- 본문은 최신 v0.25.2/v0.37.0의 확인 동작으로 정리. 원본의 v0.23.1 구현과 현재 구현의 동일/차이도 실제 파일 diff로 확인해 아래에 기록
- Kubernetes API·conditions·CR status 전략은 별도의 v1.37.1 `f78e722310e50bcaca9276be22276d9e91d91308` 기준. 라이브러리가 v0.37.1을 의존한다고 쓰거나 설치·호환성 시험 결과로 확대하지 않음
- API conventions는 현재 공식 파일의 실제 최신 commit **`e8963b1070ee8bd9edfc7bf965ca7b0eaf991f0b`**으로 확보. 원본의 이동하는 master 링크를 고정 URL로 바꿈
- 원본 비교 근거 23개·최신 근거 22개, 총 **45개**의 URL·SHA-256·크기는 `manifest.json`과 `manifest-latest.json`. 최종 파일 해시 재대조 통과

## 실제 확인한 핵심 근거

| 대조 대상 | 공식 고정 URL·함수/범위 |
|---|---|
| 표준 키·Result·NotFound 어댑터 | [reconcile.go](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/reconcile/reconcile.go): Request, TypedReconciler, Result, TerminalError, objectReconcilerAdapter.Reconcile |
| 기본 큐·worker·timeout·리미터 | [controller.go](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/controller/controller.go): TypedOptions·NewTypedUnmanaged의 MaxConcurrentReconciles 1/CacheSyncTimeout 2분/priority queue 기본/5ms~1000s |
| 키 병합·처리 중 잠금 | [priorityqueue.go](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/controller/priorityqueue/priorityqueue.go): lockedAddWithOpts·handleReadyItems·Forget·Done |
| 비우선순위 큐의 dirty/processing·백오프 | [client-go queue.go](https://github.com/kubernetes/client-go/blob/28076445520055420e3be4255b4cd27fd19df1f9/util/workqueue/queue.go): Typed.Add/Get/Done; [default_rate_limiters.go](https://github.com/kubernetes/client-go/blob/28076445520055420e3be4255b4cd27fd19df1f9/util/workqueue/default_rate_limiters.go): DefaultTypedControllerRateLimiter |
| Result/error 우선순위와 Forget | [internal controller.go](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/internal/controller/controller.go): processNextWorkItem·reconcileHandler switch, terminal 분기에서 Forget 없음 |
| Owns·부모 키·옛/새 소유자 | [builder/controller.go](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/builder/controller.go): Owns/doWatch; [enqueue_owner.go](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/handler/enqueue_owner.go): Update/getOwnerReconcileRequest/getOwnersReferences |
| predicate·우선순위 | [predicate.go](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/predicate/predicate.go): GenerationChangedPredicate와 cache 저장 범위 별개; [eventhandler.go](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/handler/eventhandler.go): initial list/RV 동일의 LowPriority -100; internal/source/event_handler.go: predicate 통과 뒤 handler 호출 |
| 캐시 읽기·직접 쓰기·선택 일관성 | [client.go](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/client/client.go): CacheOptions·shouldBypassCache·Get/List·write/newClient; [consistency.go](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/client/consistency.go): Get/List·writeAndRecordRV·gvkAndRepresentation; [cluster.go](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/cluster/cluster.go): 기본 Cache Reader 연결, 옵션 자동 활성화 없음 |
| finalizer 처리와 사용자 저장 책임 | [finalizer.go](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/finalizer/finalizer.go): Finalize는 객체 변경/Result와 에러를 반환, API 쓰기를 직접 호출하지 않음 |
| Manager·선거 기본값·fencing 한계 | [manager.go](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/manager/manager.go): Manager·Options·setOptionsDefaults·defaultHealthProbeListener; [internal.go](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/manager/internal.go): 15/10/2/30초 기본 상수; [client-go leaderelection.go](https://github.com/kubernetes/client-go/blob/28076445520055420e3be4255b4cd27fd19df1f9/tools/leaderelection/leaderelection.go): 패키지의 fencing 비보장 설명 |
| status·generation·condition | [CR strategy.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/registry/customresource/strategy.go): PrepareForCreate/Update·copyNonMetadata; [meta types.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/apis/meta/v1/types.go): Condition; [conditions.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/api/meta/conditions.go): SetStatusCondition |
| level-based·spec/status·conditions 관례 | [API conventions](https://github.com/kubernetes/community/blob/e8963b1070ee8bd9edfc7bf965ca7b0eaf991f0b/contributors/devel/sig-architecture/api-conventions.md): Spec and Status·Typical Status Properties/Conditions |

## 버전 차이·정정·보존한 조건

1. v0.23.1→v0.25.2에서 **Request/Result 파일·Owns builder/owner 핸들러는 동일**, client-go v0.35.0→v0.37.0의 queue/default_rate_limiters도 byte 동일. 기본 키 병합·한 큐 직렬화·리미터 선택·Result switch/Manager 시간값은 대조한 현재 구현에서도 유지
2. 최신 priority queue는 처리 대기 전달 중 shutdown을 함께 확인하는 경로와 로그용 항목 복사를 보강. 원문의 동시성 설명은 최신 소스로 확인하되 이 변경을 실측 장애 경험으로 추가하지 않음
3. 최신의 **EnableReadYourWritesConsistency**는 원본 v0.23.1의 client 옵션에 없던 기능. 기본 false와 Manager 연결 확인. 원문의 ‘캐시 지연을 라이브러리가 닫아 주지 않는다’를 **기본 설정에 한정**하고 opt-in의 GVK·표현 범위/요청별 제외/다중 namespace 제한을 본문에 추가
4. 선택 일관성은 동일 client가 추적한 writes와 캐시 관찰의 관계이며 전역 최신성·다른 client의 모든 쓰기까지 보장하지 않음. 실험적 옵션 주석과 실제 consistentClient의 Get/List·쓰기 기록 범위를 읽음
5. 표준 Request는 namespace/name만이며 typed custom request까지 이름으로 제한하지 않음. 키 직렬화는 기본 제공 큐의 같은 Controller 안에서만 보장, 다른 Controller/프로세스/외부 쓰기의 전역 잠금이 아님
6. 기본 Owns는 controller:true·group/kind 매칭·이벤트 namespace·cluster scope 예외. UID를 키에 넣지 않으며 RESTMapper에는 참조 버전도 필요. Update는 옛/새 소유자를 모두 큐에 넣음
7. NotFound를 Controller가 자동 무시한다고 일반화하지 않음. ObjectReconciler 어댑터의 IgnoreNotFound와 사용자 Reconciler, 없는 대상/없는 자식의 판단을 구분
8. 일반 error가 RequeueAfter보다 우선. TerminalError는 이 반환의 재추가를 하지 않고 Forget도 하지 않음. 성공·RequeueAfter의 Forget은 대기 요청을 취소하지 않음. 새 이벤트가 예약 시각보다 먼저 깨울 수 있음
9. 기본 우선순위 큐는 per-item 5ms~1000s. 비우선순위 선택의 10QPS/burst100은 **에러·rate-limited 재시도**의 버킷이며 일반 Add/전체 API QPS 제한으로 확대하지 않음
10. predicate는 이벤트 enqueue 필터이지 cache 저장 필터가 아님. generation이 유지된 status Update의 복구 계기를 버릴 수 있지만 다른 이벤트/예약까지 차단하지는 않음. CR `/status` 유무·메타데이터 변화와 generation의 조건 보존
11. spec/status는 관례와 RBAC·subresource 구현을 분리. Condition 필수 5개·observedGeneration 선택, 헬퍼는 status 전이 때 시각 갱신, SSA type별 병합과 일반 Update 배열 덮어쓰기 차이를 보존
12. parent가 요청한 finalizer 경계를 공식 최신 helper로 보완. 명시적 helper 호출·중간 상태 재시도·Result.Updated/StatusUpdated와 API 저장 책임을 설명하며, 원본에 없는 삭제 실험을 만들지 않음
13. leader election 기본 비활성·15/10/2초와 shutdown30초·cache sync2분은 설정 기본값이지 측정한 failover 시간 아님. 최신 의존 client-go도 fencing 비보장. health endpoint 기본 경로와 서버 미기동 조건 보존
14. 원본의 학습 상태·내부 Phase·LAB TODO·종료 판정·개인 실험이 아닌 수치 예시는 제거. 제품 선택의 실제 결정 기록이 없어 선택지 비교 절은 넣지 않음

## 실제 검증과 시각화

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-controller-runtime-reconcile.md`: exit 0, **error 0 / warn 1**, 문장길이 12곳. 일반 설명의 길이를 검토했고 남은 URL·긴 식별자 포함 줄은 의미를 보존해 유지
- `git diff --check`: exit 0
- SVG 2개 Python XML parse 통과, text node 각각 15/14개, 최소 글자 23px. 한글 라벨·기술 용어 원어·role/title/desc/aria·화살표별 독립 path·평탄 경로·번호 확인
- lock 및 설치된 sharp **0.34.5**로 800/375px PNG 네 장 생성 후 **네 장 모두 실제 육안 확인**. 글자 잘림·박스 겹침·화살표 누락 없음
- SVG1은 이벤트→표준 키→Controller 큐/워커→Reconciler→반환 처리 흐름, SVG2는 두 큐의 처리 중 재추가 직렬화 비교. 원본 흐름/큐 그림을 변환했으며 Manager 구조는 표로 평탄화
- 표 5개: 역할·반환값·condition 필드·기본 시간/기동·증상 확인. 캐시/자기 status 쓰기/삭제 경계는 본문의 실제 기전으로 설명해 기존 흐름 그림과 중복하는 그림을 늘리지 않음
- 원본·기술·격식체·근거·조건·반복·내부 맥락·전 섹션 시각화 필요성 재검토. 산출물의 일본어 문자 0개 확인
- 최종 원본/context 해시는 `source-final.json`, 본문/SVG 해시는 `content-final.json`
- **미실행:** 실제 controller 배포·reconcile/queue/leader/finalizer 테스트·일관성 옵션 동작 실험·전체 lint/build/export. 별도 reviewer·배치 통합 검사·진행 기록·커밋은 parent 담당

## 대표 문장·잔여 사항

- 원문: ‘라이브러리가 호출을 배선해도, 관찰한 상태에서 무엇을 바꿀지 판단하는 일은 남는다’
- 변환: ‘라이브러리가 호출을 연결해도 실제 상태를 판단하고 변경하는 책임은 조정 코드에 남습니다’
- 핵심 근거 부족으로 보류할 부분 없음. 실제 설치 버전·캐시 반영 지연·중복 자식 생성·장애 전환 시각·옵션별 성능은 미확인으로 유지
- 원본의 고정 버전과 현재 공식 버전은 본문에 편집 경위를 넣지 않고, 최신 구현 기준을 근거 고지에 제시하고 이 보고서에서 비교 이력을 보존


## 별도 blog-reviewer 검수

# Review: Batch 19 · 3 posts / 7 SVG

- 검수일: 2026-10-24 KST · 글 작성일: 배치 시작일 2026-10-23 유지
- 범위: extension order 3~5, 원본 전문·기술·문체·이미지 읽기 전용 검수
- 적용: draft-to-post 공동 절차·docs/writing-voice.md·시리즈 plan/source-format·SVG 가이드

## P0 / 필수 수정

- 미해결 0건
- 수정 완료 1건: `src/content/essays/kubernetes/k8s-theory-policy-layers.md:105`의 “failurePolicy에 따라 거절하거나 건너뜁니다” → VAP matchConditions 오류도 항상 직접 거절하는 것으로 일반화 → “failurePolicy에 따른 오류 처리”로 한정하고 VAP Fail 오류의 validationActions 적용을 추가
- 고정 `validating/validator.go:103`의 오류→ActionDeny와 `validating/dispatcher.go:234`의 바인딩 동작 적용을 대조하고, root 수정 저장본 104~107줄 및 바로 아래 표·params 직접 거절 문맥을 재검토함
- 근거: [VAP validator](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/policy/validating/validator.go), [dispatcher](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/policy/validating/dispatcher.go)

## 확인 필요 / 권장

- 미해결 확인 필요 0건 · 추가 권장 0건
- long-line 경고는 긴 식별자·조건·근거 URL을 문맥으로 검토. 의미를 지우는 기계적 분리는 요구하지 않음
- aggregation SVG의 text 18/20개 경고는 실제 800/375px 렌더를 확인해 수용. 역할·TLS/위임 경계와 last/prev 시점 구분이 보이고 겹침·잘림·한글 깨짐 없음
- 한글 SVG 라벨은 현행 프로젝트 허용·우선 기준에 맞음

## 원본·기술 대조

- 정확한 Vault 원본 600/675/572줄 전문 대조, 실제 SHA-256·줄 수가 sources.json과 모두 일치
- reconcile: 원본 v0.23.1과 현재 v0.25.2/client-go v0.37.0 구분, 표준 키·기본 우선순위 큐/직렬화·캐시 읽기/직접 쓰기·선택 일관성 기본 off/표현 범위·Result/error/Forget·NotFound 처리 주체·generation/condition·finalizer 저장 책임·선거 기본값과 fencing 한계를 실제 함수와 대조
- policy: 현재 MAP v1/GA/on·LockToDefault 부재·플러그인/API 등록, 기본값과 필수 reinvocationPolicy, params 설정 오류와 평가 결과, reason→HTTP 코드, API/정적 제외, 소유권 계산→mutation→장부 유효성 순서, atomic 제한, PSA·Gatekeeper audit·Kyverno 생성/삭제 조건·Argo CD diff를 대조
- aggregation: APIService 라우팅·인증 헤더 재작성·양방향 TLS/위임 인가, Available probe의 5초/5병렬/6초 범위, discovery stale/실패·OpenAPI 캐시/시간, Namespace 부분 삭제와 finalizer 조건을 대조
- metrics-server v0.9.0의 last/prev 메모리 저장·CPU 차분/최근 memory·코드 기본 60초/배포 15초/최소 10초와 라이브러리 v0.36.2 의존성을 확인. 원본에서 이미 해소된 메모리 보관 의문을 새 보류로 만들지 않음
- 원본 없는 개인 경험·실측·성능 우위·설계 의도를 추가한 서술 없음. 기전·예외·선택 기준 및 시리즈 연결을 확인

## 실행 검증

- 먼저 글별 lint:post 실행 후 최종 세 편을 함께 재실행: exit 0, error 0 / warn 5
- 경고: reconcile 긴 줄 12곳(1), policy 긴 줄 7곳(1), aggregation 긴 줄 6곳+SVG text 18/20개(3)
- 대상 콘텐츠/SVG `git diff --check`: exit 0
- slug 유일성·essays/kubernetes·series/order 3/4/5·작성일·시리즈 트랙 일치
- SVG 7개 XML/role/title/desc 확인, sharp로 800/375px PNG 14장 독립 재렌더 후 전부 실제 육안 검사
- 렌더 입력 SHA와 최종 SVG 동일성 확인. 검토한 최종 저장본 10파일의 flat SHA-256은 review-hashes.json
- 공식 캐시 성공 141파일 SHA 재대조. 잘못 추정한 storage_admissionregistration.go 404 1건은 근거에서 제외하고 실제 storage_apiserver.go로 확인
- 상세 원본/캐시/PNG 결과: reviewer-evidence-checks.json, reviewer-render/inputs.json
- 전체 lint/build/정적 export·커밋: reviewer 실행 안 함, parent 통합 검증 단계 담당

## 근거 위치

- reconcile/report.md 및 manifest.json·manifest-latest.json — [현재 controller-runtime](https://github.com/kubernetes-sigs/controller-runtime/tree/5d8467b3065818a3b382d8f6941147a801fd1969), [client-go](https://github.com/kubernetes/client-go/tree/28076445520055420e3be4255b4cd27fd19df1f9)
- policy/report.md 및 manifest.json·manifest-extra.json — Kubernetes f78e7223, Gatekeeper 2d0b6ad9, Kyverno e63308f1/website a10389d0, Argo CD c2b1e301의 실제 저장본
- aggregation/report.md 및 manifest.json·extra-manifest.json — Kubernetes f78e7223/website 7fde177e, [metrics-server v0.9.0](https://github.com/kubernetes-sigs/metrics-server/tree/2a7c4b2c7d46552ff47f4aeaa3a735c582587ecd)

## 요약

- 필수 1건 수정·재검토 완료 / 미해결 필수 0 · 확인 필요 0 · 권장 0
- 검토 파일 10개 · 레거시 제외 0개 · 통합 검증에 인계 가능


### 지적 반영·재검토

- 필수 수정 1건: webhook·VAP·MAP의 matchConditions 평가 오류를 failurePolicy에 따라 모두 직접 거절/생략하는 것처럼 일반화한 문장을 수정했다
- generic 문장은 오류 처리 경로로 한정하고, VAP의 Fail 오류도 바인딩 validationActions를 적용하므로 항상 직접 거절하지는 않는다고 명시했다
- root는 고정 f78e ref의 validating/validator.go:92~120과 dispatcher.go:229~265를 실제 확인했다. match 오류의 ActionDeny와 binding의 Warn/Audit/Deny 적용을 구분했다
- reviewer가 수정 저장본을 재검토한 뒤 최종 hash를 확정한다


## 실제 최종 검증

- `npm run lint:post -- <대상 3편>`: exit 0, error 0 / warn 5
- `npm run lint`: exit 0, error 0 / warn 1 (기존 `src/app/layout.tsx:80` custom font 경고)
- `npm run build`: exit 0, TypeScript·정적 생성·postbuild 성공, 658 pages
- 원본 SHA-256·검수한 최종 글/SVG와 빌드 입력 hash 일치
- slug 유일성·시리즈 order 연속성·내부 링크·이미지 실존·SVG XML/접근성 메타 검사 통과
- 실제 `getAllPosts`·`getEssaysList`·`getSearchIndex` 실행: 3편 모두 essays 등록, 목록·검색에 content 없음
- HTML 3개·SVG 7개 export·`/my-blog/diagrams/` 참조·SVG 바이트 일치
- sitemap·llms 반영, RSS는 최신 20편 정책·실제 출력 일치
- `git diff --check` 통과, prebuild의 이번 CLAUDE.md 자동 통계 변경만 복원
- Node `DEP0205 module.register()`·TS 직접 import의 `MODULE_TYPELESS_PACKAGE_JSON` 경고는 범위 밖 설정을 바꾸지 않고 유지
- 새 의존성·클러스터 실습·통합 실험·성능 실측·push·배포·시리즈 카드 등록: 실행 안 함

원시 로그·근거 캐시: `/tmp/k8s-batch19/`
공식 URL/ref와 주요 정정은 위 기록과 글에 보존했다

## 다음 대상

- `Phase 5-6 · 통합 · 한 칸 올라갈 때마다 죽을 수 있는 것이 하나 는다.md` → `k8s-theory-extension-failure-boundaries` (`k8s-theory-extension` / 6)
- `커널 하강 1 · cgroup v2 인터페이스와 CFS quota.md` → `k8s-theory-cgroup-v2-cpu-quota` (`k8s-theory-kernel` / 1)
- `커널 하강 2 · netfilter hook 과 conntrack.md` → `k8s-theory-netfilter-conntrack` (`k8s-theory-kernel` / 2)
