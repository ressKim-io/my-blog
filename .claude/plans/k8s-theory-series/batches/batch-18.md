# Batch 18 인계 — 2026-10-23

글 3편·SVG 6장 검수 완료. 콘텐츠 커밋 `7b3ab8b`
작성 기준일은 2026-10-23이며 학습일·배포일이 아니다

## 원본·결과 대응

Vault 원본은 읽기 전용이며 검증 전후 SHA-256 일치를 확인했다
원본 루트: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/`

| 좌표 | 정확한 원본 파일명 | 줄 수 | SHA-256 | slug | series / order |
|---|---|---:|---|---|---|
| 4-7 | `Phase 4-7 · 용량 기반 스케줄링 · 모르면 없다고 치지만 안 켜면 묻지 않는다.md` | 501 | `96d1e5a112a6b52fc4da4e286d663051de7b52122868792643f357c516fd7ac2` | `k8s-theory-storage-capacity-scheduling` | `k8s-theory-storage` / 7 |
| 5-1 | `Phase 5-1 · CRD 구조 · 선언한 만큼만 존재한다.md` | 801 | `7db273e6eb615720a366e1da27331f55c116147bc62c8d3a51c0c89c625be0eb` | `k8s-theory-crd-schema-pruning` | `k8s-theory-extension` / 1 |
| 5-2 | `Phase 5-2 · CRD 버저닝과 conversion · 저장은 한 벌뿐이고 나머지는 그때 만든다.md` | 626 | `90c6f4407d8c006a8e44754fd9bd8cfb8c673e1798684b86ced42a36d8953ab6` | `k8s-theory-crd-version-conversion` | `k8s-theory-extension` / 2 |

## 작성자의 근거 대조·편집 기록

작성 단계의 기록이며 이후 정정은 별도 검수·수정 기록을 우선한다

# Batch 18 · 용량 기반 스케줄링 · 작성 인계

- 상태: 담당 본문·SVG·작성자 검증 저장, 독립 검수·배치 통합 검증 전
- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 4-7 · 용량 기반 스케줄링 · 모르면 없다고 치지만 안 켜면 묻지 않는다.md`
- 정확한 파일명: `Phase 4-7 · 용량 기반 스케줄링 · 모르면 없다고 치지만 안 켜면 묻지 않는다.md`
- 원본 전문 501줄 읽음, SHA-256 `96d1e5a112a6b52fc4da4e286d663051de7b52122868792643f357c516fd7ac2`, 저장 후 다시 대조해 일치
- 대상: `src/content/essays/kubernetes/k8s-theory-storage-capacity-scheduling.md`
- 시리즈 `k8s-theory-storage` / order 7 / date `2026-10-23`, tags `kubernetes, CSI, storage, scheduling, concept`
- 편집 범위: 담당 본문·동일 slug SVG 2개·이 임시 폴더. 원본·타인 콘텐츠·공통 docs는 수정하지 않았고 build·commit·push는 실행하지 않음

## 기준과 현재 근거

- draft-to-post Codex 진입점과 공동 SKILL, docs/writing-voice, plan/source-format/SVG 가이드 적용. 원본의 내부 Phase·학습 상태·종료 판정·미실행 LAB은 본문에서 제외
- 같은 시리즈 volume-attachment-limits 본문을 읽고 개수/바이트 단위를 연결. csi-architecture의 storageCapacity false·정보 생산 분리, pvc-storageclass-binding의 WFFC/selected-node/PreBind 책임과 대조. 타 글 수정 필요 없음
- 최신 progress 1122줄 `c3081510322928d79907275e31e02c0f4708ec606644bed7581006645d1d16f5`, main source-map 123줄 `36cadfdf517ab7a33708be8e867f8b4d303d762e873ddd3c31564b8c77e704ae`, Phase 4 source-map 722줄 `f5acf98a6a57ce6f0bbc4d53b8216ef016c61f21ee790f7060f42076e94fb1d6`의 현재/역사 구분·4-7 절·현재 추가 판정·진행 행 확인
- Kubernetes **v1.37.1** tag target `f78e722310e50bcaca9276be22276d9e91d91308`; 앞 배치 tag API 증거의 annotated tag/commit 관계를 확인해 `kubernetes-tag.json`에 저장
- website 고정 ref `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
- external-provisioner 현재 releases/latest API를 다시 조회해 **v6.4.0**, tag target **`72f13ee46fb93c11a72ef91549e70158283c03af`** 확인 (`external-ref.json`)
- 외부 go.mod는 CSI spec v1.13.0·sig-storage-lib-external-provisioner/v13 v13.1.0 요구. k8s.io/api/client-go require v0.37.0을 replace v0.36.1로 바꾸므로 require만으로 실제 선택 버전을 설명하지 않음. 코어 go.mod는 CSI `v1.12.1-0.20260720052920-cd9e7ad1ae09`로 별개. 실제 클러스터 설치 버전은 미확인
- 확보한 공식 근거 **24개**의 고정 URL·SHA-256·크기는 `manifest.json`, `manifest-external.json`, `manifest-extra.json`. 이전 공식 캐시 재사용 9개와 라이브러리 1개는 경로/ref·SHA를 비교해 일치한 뒤 사용
- 공식 라이브 Storage Capacity·CSI tracking 문서도 web으로 확인. CSI 개발 문서의 오래된 Alpha 표는 현재 기능 단계 근거로 사용하지 않음

| 대조 대상 | 고정 URL 및 실제 확인 범위 |
|---|---|
| Filter·참여 생략·단일 볼륨 한도·선택 정보 | [binder.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/volumebinding/binder.go): `FindPodVolumes` 283–385, `checkVolumeProvisions` 912–960, `hasEnoughCapacity` 976–1020, `volumeLimit`/`nodeHasAccess` 1022–1049 |
| 점수·상태 저장·선택 노드·바인딩 | [volume_binding.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/volumebinding/volume_binding.go): Filter 418–448, PreScore/Score 453–519, Reserve/PreBind/Unreserve, New의 scorer 생성 641 이후 |
| 점수 평균·0/초과 입력 | [scorer.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/volumebinding/scorer.go): `buildScorerFunction` 32–58 |
| 기능 단계·기본값·기본 플러그인 | [kube_features.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go): StorageCapacityScoring 2195–2198, CSIStorageCapacity gate 선언 없음; [기본 곡선](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/apis/config/v1/defaults.go) 194–210; [기본 플러그인](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/apis/config/v1/default_plugins.go) 34–46 MultiPoint VolumeBinding |
| API·필드·검증·defaulting | [storage types.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/storage/v1/types.go): CSIDriver 365–382, CSIStorageCapacity 751–832; [validation.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/storage/validation/validation.go) 643–674; [defaults.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/storage/v1/defaults.go) storageCapacity false |
| nil/빈 셀렉터 | [meta helpers.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/apis/meta/v1/helpers.go): `LabelSelectorAsSelector` 36–43 |
| 적용 범위·시점·한계 | [Storage Capacity 공식 고정본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/storage/storage-capacity.md): v1.24 stable, WFFC/Immediate/CSI ephemeral, 잠정 선택, 다중 볼륨 개입; [점수 단계 표](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/command-line-tools-reference/feature-gates/StorageCapacityScoring.md) |
| producer 옵션·namespace·owner 설정 | [csi-provisioner.go](https://github.com/kubernetes-csi/external-provisioner/blob/72f13ee46fb93c11a72ef91549e70158283c03af/cmd/csi-provisioner/csi-provisioner.go): 101–104 기본값, 453–545 환경변수·owner·topology·informer·capacity controller, 548 wrapper |
| 실제 GetCapacity·응답 반영·갱신·삭제 | [capacity.go](https://github.com/kubernetes-csi/external-provisioner/blob/72f13ee46fb93c11a72ef91549e70158283c03af/pkg/capacity/capacity.go): Run/pollCapacities, onSCAddOrUpdate, syncCapacity 563–670, deleteCapacity. Capacity는 NewQuantity로 항상 값 채움 |
| topology 생산·owner 순회 | [nodes.go](https://github.com/kubernetes-csi/external-provisioner/blob/72f13ee46fb93c11a72ef91549e70158283c03af/pkg/capacity/topology/nodes.go): driverTopologyKeys 175–184, Node 라벨 265–295; [owner.go](https://github.com/kubernetes-csi/external-provisioner/blob/72f13ee46fb93c11a72ef91549e70158283c03af/pkg/owner/owner.go): controlling owner 순회·UID·Controller 참조 |
| 재선택 오류와 선택 노드 해제 | [외부 controller.go](https://github.com/kubernetes-csi/external-provisioner/blob/72f13ee46fb93c11a72ef91549e70158283c03af/pkg/controller/controller.go): CreateVolume 후 896–909, checkError 2036–2074; [연결 라이브러리 v13.1.0](https://github.com/kubernetes-sigs/sig-storage-lib-external-provisioner/blob/v13.1.0/controller/controller.go): rescheduleProvisioning 1393–1417, provisionVolumeErrorHandling 1600 이후 |

## 정정·보존한 조건

1. v1.35 기본 Filter만 사용 설명을 현재 **StorageCapacityScoring v1.37 Beta/on**으로 갱신. 원본의 과거 버전을 현재 기본 동작처럼 옮기지 않음
2. bound PV 검사, 미바인딩 기존 PV 매칭, WFFC 동적 생성의 범위 보존. 이미 selected-node가 있는 PVC는 기존 PV 탐색 대신 일치 노드의 동적 후보로 분기함을 명시
3. driver 미참여/NotFound/요청량 없음은 이 용량 검사 생략이고 전체 배치 성공이 아님. 다른 조회 오류는 전파. 참여했는데 적합한 정보가 없으면 후보 제외
4. Filter는 maximumVolumeSize 우선, 없으면 capacity, 둘 다 없으면 부족. capacity 미설정·0이어도 충분한 maximumVolumeSize로 **이 Filter**를 통과할 수 있다는 원본 조건을 유지하며 전체 스케줄링 성공으로 확대하지 않음
5. nodeTopology nil은 접근 불가, 빈 셀렉터는 모든 노드 일치. 여러 capacity를 합산하지 않고 첫 적합 정보를 사용
6. 동적 Score는 capacity 입력·클래스별 요청 합산·capacity 중복 합산 금지, 정적 매칭이 있으면 그 분기 우선. 이미 Bound인 모든 PVC를 새 정적 매칭과 섞지 않음
7. 기본 점수 곡선은 낮은 요청/용량 비율 우선이며 클래스 평균. 요청 합계가 용량을 초과해도 Score의 0점 처리와 Filter 거절은 별개. Score도 공간 예약이 아님
8. producer를 원본 검증용 v5.3.0 대신 현재 확인한 **v6.4.0**으로 구분. enable-capacity false/poll 1분/Immediate 정보 생산과 스케줄러 사용 범위 분리. poll 1분은 최대 지연 보장이 아님
9. ownerref-level 기본 1·0/2/-1 의미, NAMESPACE/POD_NAME 조건·GC 정리 범위 설명. owner는 용량 정보의 수명이며 PV/PVC 소유권이 아님
10. PreBind가 PVC 완료를 기다리는 동안 동적 생성이 진행되므로 최종 Pod 바인딩 후 실패라고 단정하지 않음. ResourceExhausted 재선택에는 topology 지원·selected node 조건 필요. 모든 오류가 재선택인 것은 아님
11. 다중 볼륨의 일부 생성 후 실패를 ‘모든 재시도로 절대 해결 불가’로 확대하지 않고 가용량/접근 조건이 변하지 않으면 반복될 수 있다고 설명. 운영자 개입 사례는 공식 문서 범위만 사용
12. 원문의 ‘모르면 부족’ 설계 이유는 별도 설계 근거가 확보되지 않았다는 유보를 보존. 본문은 분기 차이에 대한 해석임을 명시

## 확인 한계: capacity=nil의 동적 Score 경로

런타임 장애로 확인한 사실이 아니므로 **본문에 잠재 장애 단정은 추가하지 않음**. 독립 검수자가 다음 조건부 경로를 다시 검토할 수 있도록 기록함

- 전제: WFFC 동적 생성만 존재, staticBindings 없음, driver capacity opt-in, topology 및 maximumVolumeSize가 요청량에 적합, 해당 오브젝트의 capacity는 nil, StorageCapacityScoring 활성 및 scorer 존재
- `hasEnoughCapacity`: 1007–1011 maximumVolumeSize로 Filter 통과 후 같은 capacity 오브젝트 포인터 반환
- `checkVolumeProvisions`: 952–955 그 포인터를 `DynamicProvision.NodeCapacity`에 저장
- `FindPodVolumes`: 326–333 defer에서 DynamicProvisions를 PodVolumes에 보존
- `Filter`: 446 부근 `state.podVolumesByNode[node.Name] = podVolumes`; PreScore는 기본 scorer/활성 gate 조건에서 Score 진행
- `Score`: 483 정적 바인딩 없음으로 동적 분기, 501–504 NodeCapacity 자체 nil만 건너뛰며 515에서 `provision.NodeCapacity.Capacity.Value()` 호출
- [Quantity.Value/ScaledValue](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/api/resource/quantity.go) 814–836은 nil 수신자 보호 없이 필드를 읽음. 이 소스 범위에는 capacity=nil 방어가 없어 잠재 역참조 위험으로 해석함
- external-provisioner v6.4.0의 확인한 생산 경로는 Capacity를 항상 NewQuantity로 채우므로 그 경로와 다른 생산자/수동 객체를 구분해야 함
- **미확인:** 해당 객체로 실제 스케줄러를 실행한 결과, 실행 중 다른 보호·오류 복구가 미치는 영향. 재현/통합 테스트는 수행하지 않았고 이론 경계·확인 한계로만 남김

## 실제 검증·산출물

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-storage-capacity-scheduling.md`: exit 0, **error 0 / warn 1**, 문장길이 11곳. 일반 장문을 분리한 뒤 남은 근거 URL·내부 링크·긴 필드 이름을 포함하는 줄은 의미 보존을 위해 유지
- `git diff --check`: exit 0
- SVG 2개 XML parse 통과, text node 각각 15개, 최소 폰트 21/23px. 한글 라벨·기술 용어 원어·role/title/desc/aria·독립 arrow path·번호·평탄 경로 확인
- lock 및 설치된 sharp **0.34.5**로 800/375px PNG 네 장 생성 후 **네 장 모두 실제 육안 확인**. 잘림·박스 겹침·화살표 누락 없음
- SVG1은 producer·RPC·API·소비자 관계를 능동 시각화한 신규 그림, SVG2는 원본 Filter 분기 흐름을 변환. 정책/필드/점수 입력/진단은 표 7개, 전 섹션 시각화 필요성 재점검
- 원본 전문·기전·조건·미실행 범위·격식체·마침표·반복·내부 편집 경위 대조. 산출물의 일본어 문자 0개 확인
- 최종 본문/SVG SHA-256은 `content-final.json`, 원본/context의 정확한 경로·해시는 `source-final.json`
- 조사 중 잘못 추정한 `pkg/capacity/owner/owner.go`는 404였으며 실제 import와 고정 공식 트리에서 `pkg/owner/owner.go`를 확인해 해결. 유효 근거 경로로 본문/보고서 저장
- **미실행:** 클러스터 LAB·실측·잠재 nil 경로 재현, 전체 lint·build·export. 별도 reviewer·배치 통합 검증·진행표·커밋은 parent 담당

## 대표 문장·잔여 문제

- 원문: ‘이 용량 검사는 공간을 예약하거나 `CSIStorageCapacity`의 값을 차감하지 않는다’
- 변환: ‘용량 검사는 `CSIStorageCapacity`의 값을 차감하거나 실제 저장소 공간을 예약하지 않습니다’ + Reserve의 캐시 가정·백엔드 예약·PreBind의 시점을 구분
- 선택지 비교 절 미포함: 제품/방식 선택의 실제 결정 기록이 없으며 동작 조건 비교만 보존
- 핵심 근거 부족으로 보류할 부분 없음. 실제 설치 드라이버/sidecar·저장소 가용량·수집 지연은 미확인. 위 nil 경로는 본문 밖 조건부 확인 한계로 인계


# Batch 18 · 5-2 인계

- 결과: `src/content/essays/kubernetes/k8s-theory-crd-version-conversion.md`, 같은 slug SVG2개 저장 · 독립 검수 대기
- series/date: `k8s-theory-extension` / order2 / `2026-10-23`
- 최신 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 5-2 · CRD 버저닝과 conversion · 저장은 한 벌뿐이고 나머지는 그때 만든다.md` 전문626줄
- 원본 SHA-256: `90c6f4407d8c006a8e44754fd9bd8cfb8c673e1798684b86ced42a36d8953ab6` · 말미 재계산 일치
- 최신 progress/source-map Phase5·plan/source-format·draft-to-post 연결 절차·writing-voice·SVG 가이드 확인 · 같은 시리즈 신규5-1 저장본을 읽고 schema·same-GVK encode·pruning 설명 대조

## 실제 읽은 고정 근거

- Kubernetes v1.37.1 `f78e722310e50bcaca9276be22276d9e91d91308`, website `7fde177e22dc98390a6d55d215dd0301b5f6d0bb` · 앞 배치 확인 ref 재사용 후 이번 관련 소스를 고정 URL에서 확보 · 총26파일 SHA 재계산 일치, URL/ref/hash는 `manifest.json`
- [CRD 타입](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1/types.go), [검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/validation/validation.go), [CRD strategy](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/registry/customresourcedefinition/strategy.go): storage 정확히하나·플래그/Review/metadata 계약·CRD 쓰기 때 장부추가·storedVersions 형식/참조 검증
- [webhook_converter](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apiserver/conversion/webhook_converter.go), 같은 디렉터리 converter/nop_converter/metrics: 첫 지원 Review 선택·필요 항목만 배치·결과 개수/목표GV/식별자·metadata 복원·None 분기
- [CR handler](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apiserver/customresource_handler.go), [versioning codec](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/runtime/serializer/versioning/versioning.go), discovery controller·버전비교 helpers: served false와 storage 전용 저장소·인코더/디코더 목표·목표 스키마 pruning·같은 GVK encode 우회·선호순서/경고
- [일반 Store.Delete](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/registry/generic/registry/store.go), CR etcd NewStorage, [CRD finalizer](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/controller/finalizer/crd_finalizer.go): 삭제전 기존 객체 읽기·CR 반환 미설정·storageVersion 저장소의 목록 조회/정리
- [webhook 기본 authentication](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/util/webhook/authentication.go), client.go·webhook.go: 기본 REST config 30초·HTTP 본문 읽기 포함, CRD timeoutSeconds/failurePolicy 부재
- [현행 SVM](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/storageversionmigrator/storageversionmigrator.go), [v1.35 SVM](https://github.com/kubernetes/kubernetes/blob/5671697925fe8d7222c4ab09cb15f28f5f9d0383/pkg/controller/storageversionmigrator/storageversionmigrator.go), API v1 타입·install·REST 등록·feature gates: GA/on·v1 우선/호환 v1beta1·Merge patch/UID 부재·checkpoint/cached RV·Conflict/NotFound/재시도/실패 분기
- [etcd3 GuaranteedUpdate](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/storage/etcd3/store.go): 현재 인코딩 뒤 바이트 동일성과 stale 조건에 따른 실제 쓰기 생략
- [현재 CRD versioning](https://kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definition-versioning/)·[현재 migration](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/storage-version-migration/)도 실제 열고 고정 website 문서와 관련 본절 대조

## 보존·정정·한계

- ‘저장 한 벌’은 현재 쓰기 목표 하나로 한정 · 기존 CR의 저장버전 혼재·MVCC/복제본과 혼동하지 않으며 storage 설정/실제 CR바이트/storedVersions 장부 분리 · SVG2는 명시적 두객체 가정
- storedVersions는 CRD 생성/변경 때 현 storage를 추가하며 CR 전수 개수표가 아님 · status 장부 수정을 실제재쓰기/완료 증거로 설명하지 않음 · spec에서 구버전 제거 전 장부참조 검증과 실제이행 확인 분리
- served=false+storage=true 허용 · deprecated 경고와 서빙 종료/선호버전/저장목표 구분 · 경고 제한은 오류문구 characters와 달리 Go len의256바이트
- None 변환기와 목표스키마 pruning 분리 · same-GVK encode 우회 조건을 유지, 항상2회 가지치기/항상왕복보존 단정제외 · metadata 내부 제한과 spec/status 변환을 구분
- CRD API버전/Review 봉투버전/desired CR API버전 구분 · 첫 지원 Review 버전 선택 · v1beta1은 Review GVK/왕복UID 검사만 호환 생략, CR식별자 검사는 유지 · 이미목표버전 객체는 배치전송 제외
- HTTP200+Failure와 전송오류 구분 · name/namespace/CR UID 변경은 거절, 나머지 metadata는 원복하고 labels/annotations만 반영·검증 · 응답 형식검사가 의미변환 정당성을 증명하지 않음
- 원본의 ‘상위 요청 context 취소가 30초보다 먼저끝낸다’는 일반화는 전달하지 않음: 현재 converter는 context.TODO()로 시작해 HTTP Do에 전달 · 기본HTTP30초·더빠른오류·전체요청시간을 구분, wrapper/실제배포 설정까지보편화하지 않음
- webhook 장애를 모든버전의 모든요청 실패로 확대하지 않음 · 단일변환 생략과 캐시/LIST/쓰기/일반DELETE/CRD정리의 다른 변환 필요 조건 분리
- SVM은 v1.37 GA/defaulttrue이나 LockToDefault 없음, v1 등록/선호와 실제 API/컨트롤러 실행·완료는 별도 · 현행 apiVersion/kind/RV Merge patch와 과거 UID포함Apply/SSA 구분
- migration 문서는 현행에도 상단 Beta/off·본문 기본활성 안내가 혼재 · 원본의 ‘문서가Beta/off’ 설명을 문서전체로 확대하지 않고 정확히 나눔
- CR 정책면제라는 포괄적 문구는 현행 deprecation 문서에서 직접확인하지못해 단정제외 · deprecated/served 선언과 실제저장이행 검증 범위로 서술 · 핵심근거 부족/보류 아님
- 미실행 LAB TODO12개·종료판정·내부학습/편집 메타·SLO/추적상수는 경험/측정으로 옮기지 않음

## 실행 검증

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-crd-version-conversion.md`: exit0/error0/warn2, 최종 출력 `lint-post.txt`
- 긴줄12곳은 고정URL 등 문맥 검토 · SVG1 text19개(목표16 초과)는 입력/저장/응답과 변환조건 표시 목적, 실제800/375px 육안 가독성 확인
- SVG2개 XML·role/title/desc·한글라벨 확인, sharp PNG4개(800/375px) 생성·모두 육안확인 · 겹침/잘림 없음 · 최소21/600→375px에서13.125px, `svg-check.json`
- 전섹션 시각화감사: 쓰기/읽기흐름·혼재/이행은 SVG2개(능동신규1), 계약/절차/실패비교는 표5개, 나머지산문 · 격식체/마침표/근거/정보보존/중복/자립성 원본대조
- 대표 원문(L282): “하나라는 규칙은 앞으로 쓸 모양을 하나로 묶는 것이지 이미 저장된 모양을 묶는 것이 아니다.” → 본문: “현재 저장 목표가 하나라는 규칙은 기존 저장본의 버전까지 통일됐다는 뜻이 아닙니다”
- 핵심 미해결/보류: 없음 · 실제webhook 구현/설치버전·클러스터·etcd바이트·재쓰기·장애시간 미검증 고지 · 전체lint/build/정적출력/커밋은 실행 안 함(parent담당)


# Batch 18 · 5-1 CRD 구조 인계

- 산출물: `src/content/essays/kubernetes/k8s-theory-crd-schema-pruning.md`, `public/diagrams/k8s-theory-crd-schema-pruning-{1,2}.svg`
- 메타: `k8s-theory-extension` / order 1 / date `2026-10-23` / essays/kubernetes. 새 extension 시리즈 첫 편이며 plan의 승인된 매핑을 적용했습니다
- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 5-1 · CRD 구조 · 선언한 만큼만 존재한다.md` 전문 801줄
- 원본 SHA256: `7db273e6eb615720a366e1da27331f55c116147bc62c8d3a51c0c89c625be0eb`; sources.json과 작성 후 재대조 일치
- 최신 progress: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/☸️ progress.md`, 1122줄, SHA256 `c3081510322928d79907275e31e02c0f4708ec606644bed7581006645d1d16f5`; Phase 5 완료·미확인 이력 확인
- 최신 source-map: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/☸️ source-map · Phase 5.md`, 676줄, SHA256 `dc4920b72a458ab4d0b9276840624454fad65060c2803ce6de7306f8ad646e5e`; 5-1 절·현행 판정·기존 역사 ref를 구분
- draft-to-post 진입점·연결된 공동 절차, writing-voice, plan/source-format, SVG 가이드 적용. 기존 extension 글은 없으므로 관련 API 시리즈의 server-side-apply 글을 읽고 topology·소유권 설명과 내부 링크를 맞췄습니다

## 현재 공식 근거와 실제 확인 경로

Kubernetes v1.37.1의 tag commit과 website commit을 이번 GitHub API 호출로 확인하고 고정 raw URL을 읽었습니다
캐시 기준 경로는 `/tmp/k8s-batch18/schema`입니다. manifest.json 32개 + manifest-extra.json 3개에 URL/ref/SHA256을 저장했으며 실제 35개 파일 해시 모두 일치, 취득 실패 0건입니다
대형 파일은 아래 주장과 관련된 구현·주석·문서 절을 읽었으며 모든 대형 소스의 모든 문장을 읽었다고 보고하지 않습니다

| 기준 | ref·URL | 실제 사용한 캐시 경로·심볼 |
|---|---|---|
| Kubernetes v1.37.1 | `f78e722310e50bcaca9276be22276d9e91d91308` / [고정 소스](https://github.com/kubernetes/kubernetes/tree/f78e722310e50bcaca9276be22276d9e91d91308) | `kubernetes/kubernetes/go.mod`: cel-go **v0.29.2**, structured-merge-diff/v6 **v6.4.2** |
| website | `7fde177e22dc98390a6d55d215dd0301b5f6d0bb` / [CRD 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definitions.md) | `kubernetes/website/content/en/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definitions.md`: structural·pruning·CEL·ratcheting·defaulting·status/scale·selectors |
| SSA·API·GC 문서 | 위 website ref / [SSA](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/using-api/server-side-apply.md), [API concepts](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/using-api/api-concepts.md), [GC](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/architecture/garbage-collection.md) | 같은 상대 경로 캐시; 소유 단위·fieldValidation·scope 방향 |

다음 소스는 모두 `kubernetes/kubernetes/staging/src/k8s.io/` 아래 경로입니다. 공식 URL은 `https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/`에 아래 상대 경로를 붙여 재확인할 수 있습니다

- `apiextensions-apiserver/pkg/apiserver/customresource_handler.go`: ServeHTTP의 CRD 이름 조회·scope·served·상태 검사, NewStorage 구성, schemaCoercingDecoder/Converter, unstructuredSchemaCoercer.apply, crdConversionRESTOptionsGetter.GetRESTOptions, unstructuredDefaulter.Default
- `apiextensions-apiserver/pkg/apis/apiextensions/v1/{types.go,types_jsonschema.go}`, `pkg/apiserver/schema/validation.go`, `pkg/apis/apiextensions/validation/validation.go`: 선언 위치·일곱 확장·루트 object/type 예외·금지 키·현재 CEL 비용·oldSelf 비상관 경로·CRD 불변/selector 검증
- `apiextensions-apiserver/pkg/apiserver/schema/{pruning/algorithm.go,defaulting/algorithm.go,listtype/validation.go}`, `apimachinery/pkg/runtime/serializer/versioning/versioning.go`: pruning/defaulting 호출 경계, nullable·list 불변식, 같은 GVK의 인코딩 변환 우회
- `apiextensions-apiserver/pkg/registry/customresource/{strategy.go,status_strategy.go,etcd.go}`: 생성·업데이트 필드 보존·generation·Validate/ValidateUpdate의 schema→metadata→list→CEL 순서, 공유 store와 Scale 투영·오류
- `apiextensions-apiserver/pkg/apiserver/{customresource_discovery_controller.go,helpers.go}`, `pkg/apis/apiextensions/helpers.go`, `pkg/registry/customresource/tableconvertor/tableconvertor.go`, `pkg/apiserver/conversion/converter.go`: subresource discovery verbs·기본 Age/Name·selector scope
- `apiextensions-apiserver/pkg/apiserver/schema/cel/validation.go`, `apiserver/pkg/apis/cel/config.go`: optionalOldSelf·fieldErrorForReason·실행 비용, `apiextensions-apiserver/pkg/features/kube_features.go`: gate 상태
- `apiserver/pkg/endpoints/handlers/{create.go,rest.go}`, `apiserver/pkg/registry/generic/registry/store.go`, `apiserver/pkg/registry/rest/{create.go,update.go}`, `apimachinery/pkg/api/errors/errors.go`: mutating→BeforeCreate/Update 검증→validating 순서, fieldValidation 기본 Warn, KeyFunc의 scope, NewInvalid의 HTTP 422와 causes
- `apiserver/pkg/admission/plugin/{webhook/mutating,policy/mutating}/dispatcher.go`: 실제 패치 결과의 defaulter 호출
- `kubectl/pkg/cmd/util/helpers.go`, `cli-runtime/pkg/printers/tableprinter.go`: --validate strict 기본값·false/ignore→Ignore, wide/priority 출력 조건

## 원본 대비 정정·한정

- CRD 정의와 CR을 분리하고 CR은 apiextensions handler와 generic store가 Unstructured로 다룬다는 책임을 설명했습니다. 새 API 선언 자체가 reconcile·자식 리소스 생성 기능은 아닙니다. 버저닝·conversion/migration 심화는 writer_c의 5-2로 남겼습니다
- **structural type 예외**: 현재 validation.go는 루트 `type: object`를 별도로 요구합니다. IntOrString/preserve 노드의 type 예외를 루트에도 무조건 확대하지 않았습니다
- 일곱 확장과 list atomic 기본값·object granular 기본값, map 리스트의 scalar key·required/default 제약을 실제 타입에서 확인했습니다. SSA 관리 단위와 RBAC를 동일시하지 않았고 topology 변경의 기존 managedFields 영향을 보존했습니다
- unknown-field pruning과 요청의 Ignore/Warn/Strict를 분리했습니다. 서버 Warn, kubectl strict, false/ignore 매핑은 실제 구현을 읽었습니다. fieldValidation=Ignore를 OpenAPI·CEL 검증 전체 해제로 설명하지 않았습니다
- local `x-kubernetes-preserve-unknown-fields`는 true/미설정만 허용하며 하위 properties/**additionalProperties**에서 정상 pruning이 재개됩니다. 새 전역 spec.preserveUnknownFields=true 거절과 기존 legacy CRD 호환 예외를 구분했습니다
- 보존된 unknown 데이터는 CEL에서 접근 불가입니다. self를 ‘현재 오브젝트의 모든 임의 JSON을 읽을 수 있음’으로 확대하지 않았습니다
- **pruning 횟수**: codec의 동일 GVK encode 우회를 확인했습니다. mutating 뒤 항상 2차 pruning·조회 결과=원래 저장 바이트라고 쓰지 않았으며 실제 저장 바이트 재현은 미실행으로 고지했습니다
- defaulting은 request 버전·storage 버전 읽기·비어 있지 않은 mutating webhook patch, 현행 MAP patch 뒤 defaulter를 확인했습니다. 읽기 default가 자동으로 저장본에 쓰이지 않으며 nullable null과 nonnullable null을 구분했습니다
- CEL self/oldSelf·Optional·correlatable 경로·규칙 정의 시점과 실행 시점의 네 비용을 확인했습니다. 비용을 실제 시간 상한으로 쓰지 않았고 선행 Required/TypeInvalid 등이 CEL을 건너뛰는 조건을 보존했습니다
- **CEL reason**: 현행 문서의 HTTP code 설명과 실제 CR 경로가 다릅니다. field error는 BeforeCreate/BeforeUpdate→NewInvalid를 거쳐 422, reason은 details.causes[].reason에 남습니다. 일반 admission 거절 코드까지 422라고 확대하지 않았습니다
- **ratcheting**: v1.33 GA·true 잠금을 확인했습니다. required·quantor·metadata 내장 검증·oldSelf·topology 변경을 무조건 허용하는 기능으로 쓰지 않았습니다. 문서는 list-type 변경 예외를 들지만 실제 strategy.ValidateUpdate/statusStrategy는 기존 오브젝트의 set/map 오류와 비교하는 별도 분기가 있으므로 “모든 list 변경은 항상 거절”도 본문에서 단정하지 않았습니다
- status 켠 본체 생성은 status 삭제, 본체 update는 status 되돌림, /status는 옛 객체 복사 후 status 반영·managedFields 보존입니다. reset-field 집합은 임의 최상위 필드 전체를 완벽히 열거한다는 주장으로 확대하지 않았습니다
- 동일 CR/store/RV와 경로별 RBAC·필드 전략을 분리했습니다. 동시성 409가 사라진다는 원인 혼동을 배제했습니다. scale의 spec 값 부재 GET은 실제 500, status 값 부재는 0이며 admission에는 Scale이 전달됩니다
- Name 기본·사용자 열 없을 때 Age 기본·priority/wide, selector의 namespaced 여부·8개/type/metadata 제한을 확인했습니다. CRDObservedGenerationTracking은 **v1.36부터 beta/on**이며 CRD 정의 자신의 추적입니다. CR의 observedGeneration 자동 작성으로 옮기지 않았습니다
- group/plural 항상 불변, scope/kind Established 이후 불변과 기본 저장 prefix의 비고정 조건을 확인했습니다. GC scope 방향은 공식 문서로 대조했습니다
- 원본의 LAB·종료 판정·Phase·학습 메타는 본문에서 제외했습니다. 경험·성능·실행 결과를 만들지 않았고 선택지 의사결정 절은 실제 선택 서사가 없어 추가하지 않았습니다

대표 문장:
- 원본: “루트와 선언한 필드·배열 원소에 type을 둔다. x-kubernetes-int-or-string: true와 x-kubernetes-preserve-unknown-fields: true인 노드는 예외다”
- 변환: “루트는 `type: object`입니다. 일반적으로 선언한 필드와 배열 원소에도 type이 필요하며 IntOrString·unknown-field 보존 노드에는 제한된 예외가 있습니다”

## 자체 검증·미확인 범위

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-crd-schema-pruning.md` 실제 실행 exit 0: error 0 / warn 1(100자 초과 14줄 검토; 고정 링크·meta·alt·조건 설명). 최종 log: lint-post.log
- 본문 308줄 / 표 5개 / SVG 2개. 원본 생성 흐름과 같은 오브젝트의 세 경로를 SVG로 변환했고 type 구멍·CEL scope·defaulting ASCII는 YAML·산문으로 평탄화했습니다. 전 섹션 시각화 재검토 완료
- SVG XML·title/desc/role, text 13/11개, 최소 20px(375px에서 명목 13.39px). sharp로 800/375px PNG 4개를 실제 렌더하고 각각 육안 확인: 한글 정상, 잘림·겹침·화살표/라벨 충돌 없음
- output-checks.json·checks-run.log에 원본/progress/source-map·캐시 35개·본문·SVG SHA256, 내부 링크/자산·코드 언어·마침표·XML·폰트 검사 결과 저장
- 원본 대조·격식체·과장·근거·반복·내부 맥락 검토 완료. 핵심 근거 보류 사유 없음. 표의 반복을 줄이고 문서/소스 차이와 실제 실행 조건을 설명하는 분량을 유지했습니다
- 실제 클러스터의 CRUD·HTTP 응답·webhook/MAP patch·저장 바이트·SSA 소유권 이전·비용 소진 재현은 실행 안 함. 코드 경계의 확인과 실제 결과 측정을 구분합니다
- 별도 reviewer·전체 lint/build·정적 출력·공통 docs·커밋은 parent 담당으로 작성자 단계에서 실행 안 함. push·배포·시리즈 카드 등록 없음


## 별도 blog-reviewer 검수

# Review: 3 files · Batch 18

- 최종 판정: 미해결 필수 수정 0건 / 확인 필요 0건 / 권장 0건
- 발견한 필수 수정 1건은 root가 반영했고, 수정 저장본의 문맥·소스를 재검토해 해소 확인
- 대상: storage capacity order 7, extension schema order 1·conversion order 2와 SVG 6개
- 기준: draft-to-post 공동 절차·docs/writing-voice.md·plan/source-format·SVG 가이드
- 콘텐츠·SVG·공통 문서 수정 없음. build·commit 실행 안 함(parent의 통합 검증 대상)

## P0 위반 (즉시 수정 필요)

- 미해결 없음
- 수정 완료 — `src/content/essays/kubernetes/k8s-theory-crd-schema-pruning.md:56` [조건]: ‘루트는 type: object입니다’ → type을 명시했을 때의 값 제한을 생략 금지까지 확장함 → ‘루트에 type을 명시할 때 object’, preserve-unknown-fields=true의 루트 생략 예외, 추가 확장의 제약을 분리
- 정의 검증의 NewStructural→ValidateStructural, type 복사와 preserve 예외 및 len(Type)>0 루트 분기를 직접 대조. `fixes.md`의 수정 저장본 재검토 완료. 실제 CRD 생성 재현으로 보고하지 않음
- 근거: [구조 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apiserver/schema/validation.go), [NewStructural](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apiserver/schema/convert.go), [CRD 정의 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/validation/validation.go)

## P1 확인 필요·권장

- 없음

## P2 참고·경고 판정

- 각 파일 검토 시작 때 개별 lint 실행, 수정 후 최종 `npm run lint:post -- <3개 대상>` 실제 실행: exit 0, error 0 / warn 4. 원시 결과: `review-lint.log`
- capacity warn 1(100자 초과 11줄), schema warn 1(13줄), conversion warn 2(12줄 + SVG1 text 19개)
- 장문은 근거 URL·alt·조건 설명의 의미를 문맥 검토해 수용. conversion SVG1의 text 개수는 입력/저장/응답의 조건 표시이며 실제 375px에서 식별자·라벨·화살표가 읽혀 수용
- SVG 6개를 sharp로 800/375px 각각 재렌더하고 PNG 12개 모두 직접 열어 육안 확인. 한글 정상, 잘림·겹침 없음. `reviewer-render/inputs.json`과 최종 SVG 해시 동일
- role/title/desc XML 검사, slug 유일성·디렉터리/category·series/order·essays 트랙 일치 확인. 한글 라벨은 계획 기준에 부합
- 대상 `git diff --check`: exit 0

## 원본·기술·문체 대조

- 정확한 Vault 원본 501/801/626줄 전문과 현재 글 대조. 실제 SHA-256이 sources.json과 일치. 경험·실측·LAB 수행·성능 수치를 새로 만들지 않음
- 작성자 공식 캐시 85개와 검수 추가 고정 소스 2개, 총 87개 파일의 실제 SHA-256 일치. URL/로컬 경로/해시: `reviewer-evidence-checks.json`; 추가 파일: `reviewer-extra/manifest.json`
- capacity: WFFC·기존 PV·selected-node·드라이버 참여와 정보 부재 구분, Filter의 maximumVolumeSize 우선·nil/빈 topology 차이, 정적/동적 Score·capacity 입력·클래스 평균·기본 곡선을 실제 함수와 대조
- producer v6.4.0의 GetCapacity→수치 capacity 생성, 네 CLI 기본값·namespace/owner·재선택 오류 조건 확인. core Filter/Score가 저장소 공간 예약이라는 주장 없음
- capacity=nil의 조건부 Score 경로는 작성 보고서의 미재현 소스 해석으로만 보존. 본문은 Filter 크기 판정과 producer가 수치를 채우는 범위를 구분하며 런타임 장애·전체 배치 성공으로 일반화하지 않음
- schema: CRD/CR/controller 책임, current cel-go v0.29.2·SMD/v6 v6.4.2, pruning/preserve·동일 GVK encode 우회·defaulting 경계 확인
- CEL fieldErrorForReason→BeforeCreate/BeforeUpdate→NewInvalid의 HTTP422·causes, oldSelf Optional·상관관계·네 비용·ratcheting 범위와 gate, status/scale/shared RV·generation·selector/표·scope 조건을 확인
- conversion: 현재 저장 목표·객체별 혼재·storedVersions 장부 추가/검증/전수 이행을 분리. None·목표 스키마 pruning·Review 첫 지원 버전·동일 버전 항목 제외·v1/v1beta1 검사 차이·metadata 복원·HTTP200 Failure 계약 확인
- timeout: converter의 context.TODO()와 기본 HTTP30초를 대조. 상위 요청 취소의 자동 전파·전체 API 완료 시한으로 확대하지 않음
- SVM: 현행 GA/default true·LockToDefault 없음, v1 우선·v1beta1 등록, apiVersion/kind/resourceVersion의 MergePatchType와 과거 UID 포함 ApplyPatchType 구분. Conflict/NotFound·실제 쓰기 생략·완료 확인을 따로 설명
- 공식 migration 문서의 상단 Beta/off와 본문 기본 활성 혼재도 실제 페이지로 확인. 본문은 현행 고정 구현의 범위로 설명
- 격식체·자연스러움·용어 자립성·원본의 유보·과장·반복·기존 글 연결을 문맥 검토. 표 뒤 문단·그림 개수 할당 없이 판단

## 직접 확인한 주요 공식 근거

- [VolumeBinding Filter·volumeLimit](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/volumebinding/binder.go), [Score](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/volumebinding/volume_binding.go), [producer](https://github.com/kubernetes-csi/external-provisioner/blob/72f13ee46fb93c11a72ef91549e70158283c03af/pkg/capacity/capacity.go). 캐시 `capacity/{kubernetes,external-provisioner}/`
- [CR 검증 전략](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/registry/customresource/strategy.go), [status 전략](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/registry/customresource/status_strategy.go). 캐시 `schema/kubernetes/kubernetes/`
- [webhook converter](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apiserver/conversion/webhook_converter.go), [SVM](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/storageversionmigrator/storageversionmigrator.go), [현재 migration 문서](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/storage-version-migration/). 캐시 `conversion/kubernetes/`

## 요약

- 수정 완료 1건, 미해결 P0 0 / P1 확인 필요 0·권장 0 / P2 0. 보류 없음
- 검토 본문 3개·SVG 6개, 레거시 제외 0개. 최종 파일 9개 평면 해시: `review-hashes.json`
- 실제 클러스터·CR CRUD·webhook 장애·etcd 바이트·마이그레이션·nil 경로 재현은 실행 안 함. 로컬 콘텐츠 검수이며 통합 build 성공을 의미하지 않음


### 지적 반영·재검토

- 필수 수정 1건: CRD 루트의 `type: object` 설명이 type 명시 시 값의 제한을 생략 자체의 금지로 강화한 부분을 수정했다
- 루트에 type을 명시할 때는 object라는 규칙과 `x-kubernetes-preserve-unknown-fields: true`일 때 루트에서도 type을 생략할 수 있다는 예외를 나눴다
- IntOrString·embedded-resource 등의 추가 제약도 별도로 남겼다
- root가 고정 f78e ref의 schema/validation.go:143~184와 정의 validation.go:923~943을 실제 확인했고, reviewer는 NewStructural→ValidateStructural 생성 검증 경로까지 확인했다
- 실제 클러스터 생성 재현은 하지 않았으며 소스 기반 검증 범위다. reviewer가 수정 저장본을 재검토한 뒤 최종 hash를 확정한다


## 실제 최종 검증

- `npm run lint:post -- <대상 3편>`: exit 0, error 0 / warn 4
- `npm run lint`: exit 0, error 0 / warn 1 (기존 `src/app/layout.tsx:80` custom font 경고)
- `npm run build`: exit 0, TypeScript·정적 생성·postbuild 성공, 652 pages
- 원본 SHA-256·검수한 최종 글/SVG와 빌드 입력 hash 일치
- slug 유일성·시리즈 order 연속성·내부 링크·이미지 실존·SVG XML/접근성 메타 검사 통과
- 실제 `getAllPosts`·`getEssaysList`·`getSearchIndex` 실행: 3편 모두 essays 등록, 목록·검색에 content 없음
- HTML 3개·SVG 6개 export·`/my-blog/diagrams/` 참조·SVG 바이트 일치
- sitemap·llms 반영, RSS는 최신 20편 정책·실제 출력 일치
- `git diff --check` 통과, prebuild의 이번 CLAUDE.md 자동 통계 변경만 복원
- Node `DEP0205 module.register()`·TS 직접 import의 `MODULE_TYPELESS_PACKAGE_JSON` 경고는 범위 밖 설정을 바꾸지 않고 유지
- 새 의존성·클러스터 실습·통합 실험·성능 실측·push·배포·시리즈 카드 등록: 실행 안 함

원시 로그·근거 캐시: `/tmp/k8s-batch18/`
공식 URL/ref와 주요 정정은 위 기록과 글에 보존했다

## 다음 대상

- `Phase 5-3 · controller-runtime 과 reconcile · 큐에 담기는 것은 이름뿐이다.md` → `k8s-theory-controller-runtime-reconcile` (`k8s-theory-extension` / 3)
- `Phase 5-4 · 정책 계층 · 판정은 사라지고 변경은 주인이 없다.md` → `k8s-theory-policy-layers` (`k8s-theory-extension` / 4)
- `Phase 5-5 · Aggregated API server · 경로 하나를 넘기면 목록 전체가 걸린다.md` → `k8s-theory-aggregated-api-server` (`k8s-theory-extension` / 5)
