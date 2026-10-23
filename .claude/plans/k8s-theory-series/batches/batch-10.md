# Batch 10 인계 — 2026-10-23

3편 검수 완료, SVG 7장. 콘텐츠 커밋 `2167f11`
이번 요청 누적 12/30편, 전체 시리즈 누적 38편

## 원본·결과 대응

원본 루트: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/`
읽기 전용으로 사용했으며 작업 전후 hash 일치를 검증했다
작성 기준일은 2026-10-23이며 학습일·배포일을 뜻하지 않는다

| 좌표 | 원본 파일 | 줄 수 | SHA-256 | slug | series / order |
|---|---|---:|---|---|---|
| 2-12 | `Phase 2-12 · 장치 자원 · 개수는 어느 것인지를 말하지 못한다.md` | 699 | `32529a02429d5e79bb4062913352d082b7b2617d64a7dcb3a1aedb5fcdc3bd21` | `k8s-theory-device-resource-allocation` | `k8s-theory-node` / 13 |
| 2-13 | `Phase 2-13 · 런타임 격리 · 지정하지 않았다는 말이 필드마다 다르다.md` | 755 | `939448db7d6a4f25f4bbd51bd1783b72fa8b62760115fcce6ec832f98ecb81f0` | `k8s-theory-runtime-isolation` | `k8s-theory-node` / 14 |
| 2-14 | `Phase 2-14 · 자원 회계와 점수 전략 · 세는 쪽도 고르는 쪽도 Pod 밖에 있다.md` | 691 | `4c5f9f81eba429139a66f12975e7f17e53cc08b02cf2ebe68a02d716a99cd3d9` | `k8s-theory-resource-accounting-scoring` | `k8s-theory-node` / 15 |

글 경로는 `src/content/essays/kubernetes/{slug}.md`, SVG는 `public/diagrams/{slug}-{n}.svg`다

## 작성자의 근거 대조·편집 기록

아래는 작성 단계의 기록이다. 이후 보완·정정은 별도 검수와 지적 반영 기록을 우선한다

# Batch 10 · 2-14 작성 인계

- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 2-14 · 자원 회계와 점수 전략 · 세는 쪽도 고르는 쪽도 Pod 밖에 있다.md`
- 최신 저장본 691줄 전문 대조, SHA256 `4c5f9f81eba429139a66f12975e7f17e53cc08b02cf2ebe68a02d716a99cd3d9` 재검증
- 관련 `☸️ progress.md` 2-14 행, `☸️ source-map.md` 현재 사실 기준, `☸️ source-map · Phase 2.md` 2-14 절 및 v1.37 경로·gate 정정 대조
- 출력: `src/content/essays/kubernetes/k8s-theory-resource-accounting-scoring.md` 295줄, SVG 2장, 표 5개
- 등록: `k8s-theory-node` order 15, date `2026-10-23`, tags Kubernetes / Scheduler / RuntimeClass / PodOverhead / ResourceManagement / concept
- 적용: draft-to-post 진입·공동 스킬, writing-voice, plan/source-format, SVG 가이드. 공통 문서·원본·다른 글 수정 없음, commit/build 실행 안 함

## 실제 읽은 근거

Kubernetes v1.37.1 ref `f78e722310e50bcaca9276be22276d9e91d91308`, website ref `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`. 원문 캐시 `manifest.json` 35개와 `manifest-extra.json` 1개 전부 SHA256·경로 일치 확인

- 현행 공식 문서: [Pod Overhead](https://kubernetes.io/docs/concepts/scheduling-eviction/pod-overhead/), [Resource Bin Packing](https://kubernetes.io/docs/concepts/scheduling-eviction/resource-bin-packing/), [Scheduler Configuration](https://kubernetes.io/docs/reference/scheduling/config/), [Resource Management](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/), [RuntimeClass](https://kubernetes.io/docs/concepts/containers/runtime-class/)
- [RuntimeClass API](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/node/v1/types.go), [admission](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/plugin/pkg/admission/runtimeclass/admission.go), [변경 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/node/validation/validation.go), [admission 등록 순서·기본값](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubeapiserver/options/plugins.go)
- [PodRequests·PodLimits·AggregateContainerRequests](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-helpers/resource/helpers.go), [QoS](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/v1/helper/qos/qos.go), [eviction용 요청](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/api/v1/resource/helpers.go), [Pod cgroup](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/cm/helpers_linux.go), [sandbox 자원 분리](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_sandbox_linux.go)
- [현행 kubectl describe](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kubectl/pkg/describe/describe.go): describeNodeResource와 getPodsTotalRequestsAndLimits의 옵션을 각각 대조
- [Fit](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/noderesources/fit.go), [resourceAllocationScorer](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/noderesources/resource_allocation.go), [LeastAllocated](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/noderesources/least_allocated.go), [MostAllocated](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/noderesources/most_allocated.go), [RequestedToCapacityRatio](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/noderesources/requested_to_capacity_ratio.go), [BalancedAllocation](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/noderesources/balanced_allocation.go)
- [전략 기본값](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/apis/config/v1/defaults.go), [플러그인 등록](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/apis/config/v1/default_plugins.go), [자원·shape 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/apis/config/validation/validation_pluginargs.go), [점수 결합](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/runtime/framework.go), [gate 기본값](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go)
- [프로파일 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/apis/config/validation/validation.go), [schedulerName 담당 판정·AdmissionCheck](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/eventhandlers.go), [kubelet 자원 거절](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/lifecycle/predicate.go)

## 원본 대조·정정

1. RuntimeClass CREATE-only, 동일 overhead 명시 요청은 통과하고 다른 값은 거절, mutating webhook 뒤 validating 재대조, scheduling은 병합만 하며 validating 재대조 없음 보존. handler만 불변이며 overhead 변경은 기존 Pod로 전파되지 않음
2. 원본 v1.35 kubectl 사본 설명은 현행에 맞게 정정: 공통 helper로 Pod-level도 읽음. Pod별 행은 UseStatusResources=true, 전체 합계는 해당 옵션 없이 계산하므로 resize/status 차이까지 구분
3. 일반 컨테이너+restartable init의 정상 실행 합계와 init 각 단계의 동시 실행 요청을 자원별 max로 비교하는 실제 집계를 설명. Pod-level request는 지원 자원별 대체 후 overhead 추가. DRANodeAllocatableResources alpha/off 및 호출 옵션·status 조건 구분, 모든 DRA claim을 CPU·메모리에 무조건 더한다는 해석 방지
4. requests 무조건/limits 비영0 항에만 overhead 추가, QoS는 overhead 제외, eviction은 선택된 해당 자원 요청이 비영0일 때만 추가, Pod-level 존재 시 컨테이너 합산을 생략하는 분기와 DRA TODO 보존
5. Pod cgroup은 overhead 포함 집계를 입력으로 쓰지만 실제 shares/quota/memory는 QoS·선언 조건에 따라 선택. 특히 BestEffort는 최소 shares이므로 overhead 요청에 비례한 shares가 항상 적용되는 것으로 일반화하지 않음. CRI resources/overhead 분리와 requests==limits 보존
6. Fit Filter 누락0, Fit Score 누락 CPU100m/memory200Mi, 명시0과 키 누락 구분. Pod-level 적용 자원은 대체하고 가정값을 추가로 더하지 않음. Score 기존 NodeInfo.NonZeroRequested와 Filter Requested 구분
7. LeastAllocated 기본 CPU·memory 각1. 자원 weight1~100이며 누락/0은 기본값1로 처리. shape utilization0~100/score0~10·10배 환산·선형 보간, 두 자원 플러그인은 ScoreExtensions=nil이므로 별도 후보별 min-max 정규화 없음
8. BalancedAllocation의 현행 ‘추가 전후 개선’ 설명 보존. useRequested=true이므로 누락 보정 없음, 숫자 요청 전체0이면 Skip이지 QoS 이름 검사 아님, 자원 가중치는1만 허용. 예시 요청 비율과 차이 수기/계산 대조 통과
9. 원본 ‘기본 Score 정확히7개/나머지6개’ 표현 정정: DRA on이면 DynamicResources(weight2) 등 gate별 등록이 추가됨. MostAllocated는 Fit에만 영향, 다른 플러그인·Filter·가중치와 결합
10. 프로파일 이름 중복 금지·QueueSort 플러그인과 args 공유, config 파일의 API RBAC/audit 경계, 미담당 schedulerName은 큐 제외 보존. FailedScheduling 부재만으로 원인 확정하지 않음
11. 요청>노드 전체 allocatable은 UnschedulableAndUnresolvable, 현재 여유 부족과 구분. kubelet 시점의 admission OutOfmemory와 실행 중 커널 OOM 구분. 노트 종료 판정·LAB TODO·편집경위는 본문 제외하고 미실행 경험을 추가하지 않음

## 검증

- 실제 실행 `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-resource-accounting-scoring.md`: error 0 / warn 1. 100자 초과21줄은 주로 정확한 source URL·표·조건 문장이며 문맥 검토 완료
- SVG2장 XML parse·viewBox·title/desc/ARIA·21px 이상 폰트·본문 참조 확인 통과. 각각 text11/16개
- `sharp` 600px·375px 각2장 총4 PNG 렌더 성공. 600/375 육안 검사에서 라벨·수치·화살표·막대·여백 및 잘림/겹침 없음 확인. 임시 PNG는 이 보고서 디렉터리에 보존
- 공식 캐시36/36 SHA256 일치, 본문 고정 소스 링크23개 모두 실제 다운로드 ref/path와 일치. 내부 글 링크·이미지 참조 무결성 통과
- 가정 예시의 LeastAllocated 50/25, MostAllocated50/75, 비율차 A25→12.5%p/B25→37.5%p 산술 대조 통과. 클러스터 실측으로 표현하지 않음
- 형식·원본·말투·조건·반복 문맥 검토 완료. 표를 그대로 문장으로 반복하지 않고 limits 상한 부재·QoS/회계 분리·전략 영향 범위의 이유를 설명
- 전 섹션 시각화 재점검: 요청 처리 흐름과 추가 전후 균형은 SVG, 전략/조건/실패 비교는 표, 입출력 옵션과 정책 관리 이유는 산문으로 판단. 신규 능동 SVG1장(균형 변화), 원본 story 대체1장
- build·전체 lint·정적 export 검증 실행 안 함: 부모 배치 검증 담당. 독립 reviewer 검수는 부모에게 인계

## 대표 문장

원문: “상한이 없던 메모리에 overhead `120Mi`만 상한으로 넣으면, 원래 없던 작은 제한이 생긴다”
변환: “상한이 없던 메모리에 overhead `120Mi`만 limit으로 넣으면 원래 없던 작은 상한이 생깁니다”
원본의 수치와 상한 부재 조건을 유지하고 격식체로 정리했으며, 실습 경험은 보태지 않음

## 남은 문제

핵심 근거 미확인·보류 사유 없음. LAB은 실행하지 않았으며 본문에 이론 근거를 고지. 긴 줄 경고1건은 남음. 별도 검수·배치 lint/build/export와 커밋은 부모 담당


# Batch 10 · Phase 2-12 작성 인계

- 정확한 원본: `Phase 2-12 · 장치 자원 · 개수는 어느 것인지를 말하지 못한다.md`
- 원본 경로: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 2-12 · 장치 자원 · 개수는 어느 것인지를 말하지 못한다.md`
- 2026-10-23에 전문 699줄을 읽었습니다
- SHA-256: `32529a02429d5e79bb4062913352d082b7b2617d64a7dcb3a1aedb5fcdc3bd21` — 배치 입력과 동일합니다
- 출력: `src/content/essays/kubernetes/k8s-theory-device-resource-allocation.md`
- series/order/date: `k8s-theory-node` / `13` / `2026-10-23`
- 최신 progress의 2-12, source-map의 2-12와 v1.37 대조 절을 확인했습니다. hash는 `source.json`에 있습니다
- 원본은 읽기 전용, 공통 plan·README·commit·build는 변경·실행하지 않았습니다

## 확인한 기준과 출처

Kubernetes v1.37.1 ref `f78e722310e50bcaca9276be22276d9e91d91308`, website ref `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`, CDI Specification v1.1.0을 실제로 읽었습니다
Linux NUMA 공식 문서도 웹 도구로 열어 하드웨어 단위와 Kubernetes Node의 차이를 대조했습니다
`manifest.json`은 공식 파일 31개 성공과 잘못 짚은 후보 경로 2개의 404를 기록합니다
별도 binding.go 후보는 실제 `dynamicresources.go` 안에 있던 함수로 대조했습니다
DRA 문서는 고정 website 트리 API에서 현재 분할 경로를 찾아 `_index.md`·`dra-api.md`·`how-dra-works.md`·`dra-features.md`를 읽었습니다
추가 문서 4개·CDI 규격·Topology none 정책의 URL과 hash는 `extra-manifest.json`에 있습니다
핵심 근거 확인 뒤 범위를 더 확장하지 않았고, 실제 클러스터 설치나 드라이버 동작을 주장하지 않았습니다

| 주장 | 실제 대조한 소스·문서 | 반영 |
|---|---|---|
| 확장 이름·정수·overcommit | core helper/helpers.go, validation.go, core/v1/defaults.go | qualified name·native/requests 접두 제외, 정수·limit 필수·동일 request, limits 기본 복사 |
| 장치와 QoS | qos/qos.go의 CPU·memory 집합, 앞선 QoS·eviction 글 | 장치만 요청하면 CPU·memory BestEffort. 축출은 장치/QoS 이름만의 정렬이 아님 |
| 기본 수량 검사 | noderesources/fit.go :: fitsRequest/shouldDelegateResourceToDRA | allocatable-requested, 전체 요청 초과의 Unresolvable, ID 선택은 kubelet |
| device plugin 계약 | deviceplugin/v1beta1/api.proto·constants.go | Registration 서버 방향, DevicePlugin 5 RPC와 옵션, 전체 목록 스트림·장치 ID만의 Allocate 요청·5 주입 채널 |
| 장치 선택·건강 상태 | devicemanager/manager.go :: devicesToAllocate/GetCapacity/UpdateAllocatedResourcesStatus | kubelet ID 선택·사후 admission 부족, healthy만 allocatable·healthy+unhealthy capacity, 기존 Pod 자동 이동 아님 |
| API 건강 상태 | core/v1/types.go ResourceStatus/ResourceHealth, feature gate, device plugin 문서 | ResourceHealthStatus는 v1.36 Beta 기본 on. Pod status에서 ID·건강 상태 보고 가능 |
| NUMA와 Topology | Linux numa.html, topology 정책 4개와 공식 Topology Manager 문서 | 서버 내부 위치 단위·세 hint provider·scope·preferred와 single-NUMA admission 구분 |
| CPU·Memory Static | cpumanager/policy_static.go, memorymanager/policy_static.go·memory_manager.go, 공식 CPU·Memory 문서 | Guaranteed·정수 CPU·공유 풀, reservedMemory와 예약 합계·Windows 분기, Pod-level manager 조건 |
| DRA API | resource/v1/types.go, core/v1/types.go, dra-api.md | 네 v1 kind, driver/pool/device 식별, 최고 generation과 sliceCount 완전성, claim 참조·공유·수명 |
| 스케줄러 할당 | dynamicresources.go :: Filter/Reserve/PreBind/Unreserve/bindClaim | Filter 계산·Reserve 내부 예약·PreBind API 쓰기 분리. reservedFor 256·충돌 재시도와 다른 할당 경합 구분 |
| binding 조건 대기 | PreBind와 how-dra-works.md | 관련 두 gate와 선언 조건이 있으면 외부 준비 상태를 기다리고 실패·timeout 후 다음 시도로 복구 |
| 노드 준비·주입 | dra/v1/api.proto, cm/dra/manager.go, kuberuntime_container.go, CDI spec | NodePrepare/Unprepare, claim별 오류·누락 실패, CDI ID 외 응답 필드 구분, CRI CDIDevices·OCI edits |
| 정수 요청의 DRA 위임 | shouldDelegateResourceToDRA, DeviceClass API | 노드의 해당 scalar allocatable이 양수면 기존 경로 유지. 그 외 DRA 매핑이 있으면 위임 가능 |
| 현행 기능 단계 | kube_features.go DRA·ResourceHealthStatus·PodLevelResourceManagers 항목 | GA/on/잠금 여부, Beta/on 또는 Beta/off를 실제 고정 소스로 판정 |

## 원본 정정·보완

1. ‘장치 선택 결과가 API에 전혀 남지 않는다’는 절대 표현을 제거했습니다. 현행 Pod의 allocatedResourcesStatus에 장치 ID·건강 상태를 보고할 수 있으며, 이것은 DRA의 별도 목록·claim 모델과 다릅니다
2. DRAExtendedResource는 v1.37 GA·기본 on·잠금입니다. v1.35 Alpha off를 현행으로 옮기지 않았고 노드별 양수 allocatable 예외를 명시했습니다
3. DRAAdminAccess·DRAPrioritizedList·장치 taint·분할·소비 용량·binding·health의 현재 단계를 다시 확인했습니다. GA와 LockToDefault를 구분했습니다
4. CPU와 Memory Static의 Pod-level 생략 조건은 현재 PodLevelResourceManagers·PodLevelResources 조합을 따릅니다. managers는 v1.37 Beta 기본 off이며 켰을 때의 별도 조건을 구분했습니다
5. 전용 CPU를 물리 코어 전체 할당으로 일반화하지 않았습니다. hugepages의 overcommit 제약도 GPU 개수와 같은 단위로 설명하지 않았습니다
6. DRA의 ‘확장점 여덟 개가 전부’라는 고정 개수를 쓰지 않았습니다. 현행 구현은 PodGroupPostFilter·Sign 등 부가 인터페이스도 있으며 본문은 원본의 주요 경로를 중심으로 설명했습니다
7. pool 최고 generation뿐 아니라 resourceSliceCount에 따른 목록 완전성도 포함했습니다
8. PreBind에서 claim 쓰기 뒤 binding 조건 대기가 있을 수 있음을 추가했습니다. allocation 기록과 실제 바인딩·노드 준비·시작 성공을 구분했습니다
9. NodePrepareResources 응답 전체와 CDI 주입 채널을 구분했고, CDI 이름이 여러 개이거나 없을 수 있는 계약 및 optional node operations의 준비 생략 예외를 고지했습니다
10. 원본의 LAB·종료 조건·학습 연결을 실측으로 옮기지 않았습니다. PATCH는 형식 예시이며 실제 API 변경을 실행하지 않았습니다

## 시각화·문체

- SVG 3장: 기본 수량·ID 선택 흐름, 세 NUMA hint provider와 Topology Manager, DRA의 내부 예약·API 쓰기·노드 준비 흐름
- API 역할·정책·gate·실패 구분은 표로 정리했고 전 섹션의 능동 시각화 필요성을 재검토했습니다
- 한글 라벨, 기술명 원어, 최소17px, role/title/desc, 평탄 경로 적용
- sharp로 원본800px와 375px 각3장, 총6개 PNG를 실제 렌더링한 뒤 도구로 모두 열었습니다
- 잘림·박스 넘침·라벨과 선의 겹침이 없으며 작은 폭에서도 흐름과 핵심 라벨을 확인했습니다
- writing-voice로 원본 의미·조건·근거·격식체·과장·직역·반복·내부 맥락을 검토했습니다
- 선택지 비교 섹션은 추가하지 않았습니다. 모델의 차이는 원본 설명 범위이며 실제 기술 선정 대안·판단을 창작하지 않았습니다

## 실제 검증

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-device-resource-allocation.md`: **exit0, error0/warn1** (`lint-post.log`). 긴 줄 권장 경고는 링크·표·조건을 검토한 뒤 유지했습니다
- SVG 3장 XML 파싱·최소17px·실존 이미지 참조 확인 통과 (`source.json`)
- sharp 6장 렌더·800px/375px 육안 검사 통과
- 원본 최종 hash는 배치 최초 입력과 동일합니다
- 전체 lint·build·정적 출력은 **작성 담당에서는 실행 안 함**, 배치 담당에게 인계합니다
- 독립 blog-reviewer 검수는 아직 미실행이며 부모의 별도 검수를 기다립니다

## 대표 문장

원문: “장치 개수가 충분하다는 판단과, CPU·메모리·장치를 가까운 위치에서 함께 할당할 수 있다는 판단은 다르다”

변환: “따라서 GPU 두 개가 남았다는 사실과 CPU·메모리·장치를 가까운 위치에 함께 할당할 수 있다는 사실은 다른 조건입니다”

## 남은 문제

핵심 원본·공식 근거 부족에 따른 보류 항목은 없습니다
실제 드라이버·CDI 설정·NUMA 배치·실패 재현은 하지 않았으며 본문 근거 고지와 적용 조건으로 구분했습니다
독립 검수와 배치 통합 검증 전에는 완료 편수에 포함하지 않습니다


# Batch 10 · 런타임 격리 작성 인계

- 글 `src/content/essays/kubernetes/k8s-theory-runtime-isolation.md` 284줄, series `k8s-theory-node` / order 14 / date 2026-10-23
- 원본 `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 2-13 · 런타임 격리 · 지정하지 않았다는 말이 필드마다 다르다.md` 전문 755줄 읽음
- SHA-256 `939448db7d6a4f25f4bbd51bd1783b72fa8b62760115fcce6ec832f98ecb81f0`
- progress 1122줄/hash `c3081510322928d79907275e31e02c0f4708ec606644bed7581006645d1d16f5`, source-map Phase2 2189줄/hash `79c08e1759c80a6efc16cde0efd1af227addd3eece6dffd3fd657af6f75c18fe`; 현행gate·RuntimeClass 문서/소스 차이·실습 미실행 확인
- draft-to-post 진입점·공동절차·writing-voice·plan/source-format·SVG 가이드 적용, 같은 시리즈 CRI/OCI 글 참조

## 실제 읽은 근거

Kubernetes v1.37.1 tag target `f78e722310e50bcaca9276be22276d9e91d91308`, website `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`. 다운로드 URL/hash는 manifest.json·manifest-extra.json, 영구 링크는 본문 가까이 인용

- [공통 securityContext 병합·NoNewPrivileges·기본마스크](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/securitycontext/util.go): Pod의5필드 병합, 컨테이너우선, 기본12mask+동적CPU경로·readonly5
- [CRI 보안조립](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/security_context.go), [프로필 선택](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/helpers.go), [AppArmor 우선순위](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/security/apparmor/helpers.go): seccomp 명시기본·AppArmor nil·SELinux nil·capability목록 전달 구분
- [kubelet 기본값](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/apis/config/v1beta1/defaults.go): seccompDefault=false
- [CRI Capability·LinuxContainerSecurityContext](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cri-api/pkg/apis/runtime/v1/api.proto): drop/add/ambient·privileged8효과와무효가능4필드
- [API validation](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go)·[Pod validation options](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/api/pod/util.go): privileged/allowEscalation·CAP_SYS_ADMIN문자열·호환분기, procMounthostUsers, userns의host/rawblock조건
- [kube-apiserver options](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kube-apiserver/app/options/options.go): allow-privileged 등록·bool기본값과실제배포설정 구분
- [verifyRunAsNonRoot](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/security_context_others.go): explicitUID·이미지0·이름만있는사용자거부
- [NamespacesForPod·PidNamespaceForPod](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/util/util.go): PID기본CONTAINER/POD/NODE와RuntimeHandler입력 구분
- [userns manager](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/userns/userns_manager.go): hostUsers생략/true=NODE, false=핸들러지원확인·매핑할당
- [PSA non-root 버전검사](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/pod-security-admission/policy/check_runAsNonRoot.go), [procMount restricted](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/pod-security-admission/policy/check_procMount_restricted.go), 같은policy의check_runAsUser/check_procMount_baseline/helpers: v1.35hostUsersfalse완화범위
- [PSA admission](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/pod-security-admission/admission/admission.go)·[설정타입](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/pod-security-admission/admission/api/types.go): enforce와워크로드audit/warn·RuntimeClass면제·오류메시지
- [gate등록](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go): UserNamespacesSupport·ProcMountType·SELinuxChangePolicy GA/잠김, SELinuxMount GA/on·미잠김, UserNamespacesHostNetworkSupport Alpha/off
- 공식문서: [Linux보안기전](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/security/linux-kernel-security-constraints.md), [Pod Security Standards](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/security/pod-security-standards.md), [user namespace](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/workloads/pods/user-namespaces.md), [security context](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/tasks/configure-pod-container/security-context.md), [RuntimeClass](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/containers/runtime-class.md) 관련절 실제대조

## 정정·조건 보존

1. 모든 namespace가 Pod sandbox에서 공유된다는 설명을 정정했다. PID 기본은 CONTAINER, shareProcessNamespace=true이면 POD, hostPID=true이면 NODE다
2. masked 경로는 고정 12개와 존재하는 CPU별 thermal_throttle 경로의 합이다. readonly는 5개다
3. UserNamespacesSupport·ProcMountType은 v1.36 GA/on·잠김으로 현행화했다. SELinuxChangePolicy와 SELinuxMount의 GA·잠금 시점과 볼륨 적용 조건을 구분했다
4. 생략의 결과를 CRI 값으로 기술했다. capability 미지정은 전체 제거가 아니고, NoNewPrivs 미요청은 모든 상승을 보장하지 않으며, SELinux nil은 호스트 정책 off가 아니다
5. API의 CAP_SYS_ADMIN 검사는 정확한 문자열 비교와 이전 Pod 호환 분기로 한정했다. SYS_ADMIN 등 모든 표기를 검증한다고 확대하지 않았다
6. baseline/restricted는 일반 Linux 경로를 표로 정리하고 정책 버전·OS·userns 예외를 유지했다. hostPort는 0이 아닌 값이 차단 대상이고, privileged 정책 수준이 특권 컨테이너를 자동 설정하지는 않는다
7. userns raw block·hostNetwork는 신규 허용과 기존 Pod 갱신 호환을 구분했다. 제거된 gate 대신 policy v1.35가 적용하는 완화 범위를 설명했다
8. RuntimeClass의 핸들러 선택과 PSA의 필드 검사를 분리했다. Kata의 VM 경계와 관리자 면제를 구분하고, 문서의 terminal Failed와 kubelet의 이벤트·오류 반환 차이는 미확인 한계로 남겼다
9. 관리 메타·LAB·자가 판정·편집 경위는 제외했고 경험을 만들지 않았다. 원본의 고정 필드 개수 대신 현재 적용 범위를 설명했다

## 검증

- lint:post exit 0, error 0 / warn 1(긴 줄 27곳). 고정 URL·표·조건을 문맥으로 검토했으며 원시 경고를 유지했다
- SVG 2개 XML 파싱 성공, title·desc·role·본문 참조 확인, font-size 최소 20px
- sharp 원본 560px와 모바일 375px PNG 총 4개 육안 검사: 글자 잘림·박스/선 겹침 없음, 모바일 라벨 가독성 확인
- 전 섹션 시각화 재검토: 판단 경계와 UID 매핑은 SVG, 기본값·위치·통제·증상은 표로 구성했다. UID 범위는 실측이 아닌 예시다
- 공통 docs·commit·build·push는 수정/실행하지 않았다. 독립 reviewer와 통합 lint·build·export는 주 담당 단계다

## 대표 문장

- 원문: “seccomp과 AppArmor는 프로필 생략의 전달 방식이 다르다.”
- 변환: “seccomp 프로필을 생략하면 kubelet이 명시적인 값을 만들지만, AppArmor 프로필을 생략하면 런타임에 전달하는 값을 비웁니다”
- 생략 결과와 처리 주체를 유지하고 실제 적용 조건을 본문에서 연결했다

## 남은 문제

핵심 주장 보류는 없다. 설치된 런타임·프로필 로드·커널 지원·실제 보안 거부·RuntimeClass 실패의 최종 phase는 실측하지 않았다. 추가 fetch 목록에 불필요하게 들어간 pkg/kubelet/util/env/env.go는 404였으며 본문 근거로 사용하지 않았다. 핵심 근거 확인 후 추가 조사를 종료했다


## 별도 blog-reviewer 검수

# Review: Batch10 · 3 posts + 7 SVG

## P0 위반 · 필수 수정

최종 저장본 0건

## 확인 필요

0건. 원본·핵심 공식 근거 부족으로 보류할 글 없음

## P1 권장

미해결 0건. 문단 수·표 뒤 해설 수·이미지 수를 별도 할당하지 않고 기전·조건·자립성 기준으로 판단

## P2 참고 · 실제 lint

최초에 `npm run lint:post -- <3개 대상 파일>` 실행. 작성 중이던 accounting의 SVG2개 미존재 오류2건은 최종 SVG 저장 뒤 해소됨. 최종 실제 실행 결과:

```text
k8s-theory-device-resource-allocation.md
  △ [문장길이] 100자 초과 줄 19곳 — 분리 검토
  요약: error 0 · warn 1
k8s-theory-runtime-isolation.md
  △ [문장길이] 100자 초과 줄 27곳 — 분리 검토
  요약: error 0 · warn 1
k8s-theory-resource-accounting-scoring.md
  △ [문장길이] 100자 초과 줄 21곳 — 분리 검토
  요약: error 0 · warn 1
전체: error 0 · warn 3 (파일 3개)
```

긴 줄은 주로 고정 URL·표·필요 조건을 포함. 길이만으로 조건을 잘라낼 추가 사유 없음. lint가 검사하는 형식 항목을 별도 정규식으로 재구현하지 않음

## 원본·문체·등록 대조

- docs/writing-voice.md, draft-to-post 진입점·공동 절차, 시리즈 plan/source-format 기준 적용
- `/tmp/k8s-batch10/sources.json`의 정확한 Vault 원본 3개 전문과 현재 본문 전부 대조. 2-12 699줄, 2-13 755줄, 2-14 691줄. 실제 원본 SHA-256 3/3 일치 재검사
- essays/kubernetes 디렉터리, series k8s-theory-node, order13·14·15 일치. slug 중복 없음
- 격식체·전문 용어 설명·내부 글 연결·이유/조건의 충분성 확인. 원본 없는 GPU 실습·보안 거부·클러스터 측정·개인 경험 창작 없음
- 수치는 고정 기본값 또는 가정 예시로 범위를 표시. 보안 UID 매핑·점수 예시를 실제 관측으로 옮기지 않음
- 원본의 LAB TODO·학습 등급·자가 판정·편집 경위를 독자 본문에 노출하지 않음. 원본의 이전 버전 설명을 바꾼 부분은 현행 근거와 한정 조건 확인

## 실제 기술 검증

Kubernetes v1.37.1 `f78e722310e50bcaca9276be22276d9e91d91308`, website `7fde177e22dc98390a6d55d215dd0301b5f6d0bb` 고정 파일을 실제 열람. 작성자 report만으로 승인하지 않고 핵심 분기·기본값·예외를 원본/현재 글/소스에서 대조

| 글 | 실제 확인 결과 |
|---|---|
| devices | device plugin Registration/DevicePlugin의 서버 방향, 정수·limits 필수·request=limit, 수량 Filter/노드 내부 ID 선택, Allocate의5주입 채널과 Pod/컨테이너 이름 필드 부재를 확인 |
| devices | GetCapacity는 healthy→allocatable, healthy+unhealthy→capacity. UpdateAllocatedResourcesStatus는 ResourceID·Health를 Pod status에 기록. ResourceHealthStatus는 Beta/on. health 보고를 자동 이동이나 DRA claim 생성으로 확대하지 않음 |
| devices | Topology restricted/single-numa-node의 preferred 및 don't-care 힌트 처리, container/pod scope를 확인. CPU Static의 Guaranteed·정수 조건과 Memory Static의 다른 예약 조건, PodLevelResourceManagers Beta/off에 따른 Pod-level 할당·힌트 생략을 구분 |
| devices | DRA claim API 기록은 PreBind, Reserve는 내부 예약. 256명 상한과 RV 충돌 재시도/이미 다른 할당이 된 오류를 분리. NodePrepare의 claim 오류·응답 누락, CDI복수/없음, optional node operations 예외 확인 |
| devices | DRAExtendedResource는 GA/on/잠김. shouldDelegateResourceToDRA는 해당 노드의 scalar allocatable이 양수면 기존 경로 유지, 그 외 DeviceClass 매핑을 확인. 코어 GA와 부속 gate 조건을 구분 |
| isolation | DetermineEffectiveSecurityContext 공통5필드와 컨테이너 우선, seccomp 별도 fallback·AppArmor annotation 우선순위·nil 전달을 확인. NoNewPrivs는 allowPrivilegeEscalation=false일 때만 요청. 빈 capability와 ALL drop을 구분 |
| isolation | procMount는 고정12mask+존재하는 CPU thermal 경로, readonly5. privileged CRI효과와 CAP_SYS_ADMIN 정확 문자열/기존 Pod 호환 validation 범위, --allow-privileged 기본false 및 실제 배포 설정 미확인 한정 확인 |
| isolation | PID 기본CONTAINER, shareProcessNamespace=true→POD, hostPID=true→NODE 확인. userns의 핸들러 지원 검사·65536 매핑, host/raw block 검증과 기존 Pod 갱신 호환 분기 확인 |
| isolation | UserNamespacesSupport/ProcMountType/SELinuxChangePolicy GA·잠김, SELinuxMount v1.37 GA/on·미잠김. PSA v1.35 userns runAsNonRoot/runAsUser 완화와 baseline procMount 완화/restricted 유지 실제 분기 확인. RuntimeClass 면제는 관리자 설정이며 안전성 자동 판정이 아님 |
| accounting | RuntimeClass CREATE-only·overhead 동일 값 허용·최종 validating 재대조·scheduling 병합만 수행 확인. handler만 불변이며 기존 Pod에 overhead 변경을 재복사하지 않음 |
| accounting | 공통 helper의 일반 컨테이너+sidecar·각 init 동시 실행량의 자원별max, Pod-level 자원별 대체, overhead requests/limits 비대칭을 확인. eviction은 선택된 요청이0아닐 때만 overhead추가. CRI resources와 overhead는 별도 |
| accounting | 최종 추가된 ResourceConfigForPod 문장을 다시 읽고 실제 QoS 분기 확인: 입력 집계에 overhead가 들어가도 BestEffort CPUshares는 MinShares. 요청 비례 shares가 항상 적용된다고 일반화하지 않음 |
| accounting | 현재 kubectl describe는 공통 helper이며 Pod별행 UseStatusResources=true, 노드합계는 다른 옵션. Filter 누락0 vs Fit Score 누락100m/200Mi, 명시0과 키누락, Balanced useRequested=true를 구분 |
| accounting | LeastAllocated 기본CPU/메모리각1, weight0 default1 및1~100검증, shape0~10→10배환산·선형보간, ScoreExtensions=nil과 프레임워크의 범위검사/가중합 확인. Balanced 추가 전후 개선도 비교·모든 계산요청0일 때Skip 확인 |
| accounting | DRA/on의 DynamicResources weight2와 기본 플러그인 가중치, 프로파일 이름 중복·QueueSort/args 동일 조건·schedulerName 담당 큐 판정 확인. 가정 예시의50/25·50/75 및25→12.5/37.5%p 산술·SVG 막대 길이 일치 |

핵심 소스:

- [device manager](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/cm/devicemanager/manager.go), [DRA 위임과 수량 Filter](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/noderesources/fit.go), [DRA Reserve/PreBind/bindClaim](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/dynamicresources/dynamicresources.go)
- [보안 병합·마스크](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/securitycontext/util.go), [API 보안 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go), [PSA procMount restricted](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/pod-security-admission/policy/check_procMount_restricted.go)
- [공통 자원 계산](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-helpers/resource/helpers.go), [Pod cgroup 실제 분기](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/cm/helpers_linux.go), [Balanced 실제 개선 점수](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/noderesources/balanced_allocation.go), [kubectl describe](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kubectl/pkg/describe/describe.go)

공식 웹 직접 확인: [NUMA](https://docs.kernel.org/mm/numa.html), [CDI v1.1.0](https://github.com/cncf-tags/container-device-interface/blob/v1.1.0/SPEC.md), [DRA](https://kubernetes.io/docs/concepts/resource-management/dynamic-resource-allocation/), [User Namespaces](https://kubernetes.io/docs/concepts/workloads/pods/user-namespaces/), [Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/), [Security Context](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/), [Pod Overhead](https://kubernetes.io/docs/concepts/scheduling-eviction/pod-overhead/), [Scheduler Configuration](https://kubernetes.io/docs/reference/scheduling/config/), [Resource Bin Packing](https://kubernetes.io/docs/concepts/scheduling-eviction/resource-bin-packing/)

근거 캐시 `/tmp/k8s-batch10/{devices,isolation,accounting}/`의 manifest 기록과 실제 SHA-256 재검사108/108 일치(devices37, isolation35, accounting36). 잘못 짚은 후보404 3건은 근거에 사용하지 않음. 실제 존재하는 소스/분할 문서로 핵심 근거를 확인. 세부 URL은 manifest와 각 report.md에 보존

## SVG 실제 렌더·육안 검사

- 같은 slug SVG7개 XML 파싱 통과. sharp로800px/375px 실제 PNG14개 생성 후 전부 육안 검사
- PNG와 렌더 입력SHA는 `/tmp/k8s-batch10/reviewer-render/`에 보존
- devices3장: 수량/ID선택 주체, 세 provider의 NUMA 힌트 병합, DRA내부예약/API기록/노드준비 경계 의미 확인
- isolation2장: 선언의 유효성·정책·kubelet해석·런타임적용의 구분, 두Pod UID매핑 범위와 가정 고지 확인
- accounting2장: admission→요청합산→Filter→Score 흐름과 균형 변화의 수치/막대 비율 확인
- 한글 라벨 허용 기준 적용. 겹침·잘림·잘못된 방향·빠진 설명 없음. 모바일에서도 핵심 라벨과 흐름 확인. 긴 SVG의 tall 힌트 확인

## 요약

필수 수정0건 · 확인 필요0건 · 미해결 권장0건 · P2 길이 경고3개 글

최종3편+7SVG SHA-256은 `review-hashes.json`의 상대경로→hash 단순 매핑으로 확정. 최종 SVG 해시가 육안검사한14PNG의 입력과 같은지 확인. reviewer는 콘텐츠/공통 문서 수정·build·commit·push 실행 안 함. 전체 lint·build·정적 출력·빌드 입력 동일성은 주담당 통합검증 범위


## 실제 최종 검증

- `npm run lint:post -- <이 배치 3편>`: exit 0, error 0 / warn 3
- `npm run lint`: exit 0, error 0 / warn 1 (기존 `src/app/layout.tsx:80` custom font 경고)
- `npm run build`: exit 0, TypeScript·정적 생성·postbuild 성공, 604 pages
- 원본 SHA-256·검수 후 글/SVG와 빌드 입력 hash 일치
- slug 유일성·시리즈 order 연속성·내부 링크·이미지 실존·SVG XML/접근성 메타 검사 통과
- `getAllPosts`·`getEssaysList`·`getSearchIndex` 실제 실행: 3편 모두 essays로 등록, 목록·검색 객체에 content 없음
- HTML 3개·SVG 7개 실제 export 및 `/my-blog/diagrams/` 참조·SVG 바이트 일치
- sitemap·llms 3편 반영, RSS는 기존 최신 20편 정책과 실제 출력 일치
- `git diff --check` 통과
- prebuild의 이번 CLAUDE.md 자동 통계 변경만 복원, Vault 원본 변경 없음
- build의 Node `DEP0205 module.register()` 및 로컬 TS 직접 import의 `MODULE_TYPELESS_PACKAGE_JSON` 경고는 남아 있으며 애플리케이션 설정을 범위 밖에서 바꾸지 않았다
- 클러스터 실습·통합 테스트·성능 실측·push·배포·시리즈 카드 등록: 실행 안 함

원시 로그·임시 근거 저장본: `/tmp/k8s-batch10/`
영구 재확인 경로는 위 글과 작성 기록의 공식 소스 URL이다

## 다음 대상

- `Phase 2-15 · 노드의 swap · 나눠주는 쪽만 알고 세는 쪽은 모른다.md` → `k8s-theory-node-swap` (`k8s-theory-node` / 16)
- `Phase 2-16 · 컨테이너 로그 파일 · 경로를 정한 쪽은 그 파일을 안 쓴다.md` → `k8s-theory-container-log-files` (`k8s-theory-node` / 17)
- `Phase 2-17 · HPA 와 scale subresource · 같은 칸을 다른 문으로 쓴다.md` → `k8s-theory-hpa-scale-subresource` (`k8s-theory-node` / 18)
