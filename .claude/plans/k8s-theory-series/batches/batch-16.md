# Batch 16 인계 — 2026-10-23

3편 검수 완료, SVG 6장. 콘텐츠 커밋 `c5f8353`
이번 요청 누적 30/30편, 전체 시리즈 누적 56편

## 원본·결과 대응

원본 루트: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/`
읽기 전용으로 사용했으며 작업 전후 hash 일치를 검증했다
작성 기준일은 2026-10-23이며 학습일·배포일을 뜻하지 않는다

| 좌표 | 원본 파일 | 줄 수 | SHA-256 | slug | series / order |
|---|---|---:|---|---|---|
| 4-1 | `Phase 4-1 · PVC 바인딩과 StorageClass · claimRef 를 먼저 쓰는 쪽이 정한다.md` | 646 | `a8cb550c9f535ed2dcf8e9b335db081f6310b84ffe193f06783b66a713cb5b5f` | `k8s-theory-pvc-storageclass-binding` | `k8s-theory-storage` / 1 |
| 4-2 | `Phase 4-2 · CSI 구조 · 코어는 노드 쪽 절반만 부른다.md` | 577 | `c62a5d840d7390c154d5596078f800d13ba33f5611383490776282d78461bb1f` | `k8s-theory-csi-architecture` | `k8s-theory-storage` / 2 |
| 4-3 | `Phase 4-3 · attach 와 stage 와 publish · 한 번씩이 서로 다른 한 번이다.md` | 542 | `e5afbd42a7ab71738cc9aeea39a4614caec6471afe32055067a307adac25472f` | `k8s-theory-volume-attach-stage-publish` | `k8s-theory-storage` / 3 |

글 경로는 `src/content/essays/kubernetes/{slug}.md`, SVG는 `public/diagrams/{slug}-{n}.svg`다

## 작성자의 근거 대조·편집 기록

아래는 작성 단계의 기록이다. 이후 보완·정정은 별도 검수와 지적 반영 기록을 우선한다

# Batch 16 · PVC 바인딩/StorageClass 인계

- 작성자 단계: 본문·SVG·자체 검증 완료. 독립 검수·전체 lint/build/export·commit은 parent 담당
- 글: `src/content/essays/kubernetes/k8s-theory-pvc-storageclass-binding.md` (301줄)
- series `k8s-theory-storage` / order 1 / date `2026-10-23`
- tags `kubernetes`, `storage`, `pvc`, `pv`, `storageclass`, `scheduling`, `concept`
- SVG 2장, 표 9개. 네 처리 순서와 WFFC 분업을 시각화. 원본 관계에 완료 어노테이션·캐시/API 경계를 보강
- 첫 storage 시리즈 글이므로 기존 같은 시리즈 글 없음 확인. plan 매핑과 기존 API/network 이론 글 형식을 참고. 다른 글·공통 docs·Vault·의존성·commit/push 수정 없음

## 원본·현재 문맥

- 원본 전문 646줄: `Phase 4-1 · PVC 바인딩과 StorageClass · claimRef 를 먼저 쓰는 쪽이 정한다.md`
- 정확한 경로: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 4-1 · PVC 바인딩과 StorageClass · claimRef 를 먼저 쓰는 쪽이 정한다.md`
- 원본 SHA-256 `a8cb550c9f535ed2dcf8e9b335db081f6310b84ffe193f06783b66a713cb5b5f` — 배정 시점과 최종 저장본 동일
- `☸️ progress.md` 1122줄: `c3081510322928d79907275e31e02c0f4708ec606644bed7581006645d1d16f5`
- `☸️ source-map.md` 123줄: `36cadfdf517ab7a33708be8e867f8b4d303d762e873ddd3c31564b8c77e704ae`
- `☸️ source-map · Phase 4.md` 722줄: `f5acf98a6a57ce6f0bbc4d53b8216ef016c61f21ee790f7060f42076e94fb1d6`
- 4-1 근거 목록·소급 클래스·UID와 완료 차이·현재 scheduler cache/API·capacity 조건을 읽음
- draft-to-post 진입점·연결된 공동 절차, writing-voice, plan/source-format, SVG 가이드 적용. LAB TODO·종료 판정·Phase·내부 관리 기록은 본문 제외

## 실제 대조 근거와 정정

Kubernetes v1.37.1 `f78e722310e50bcaca9276be22276d9e91d91308`, website `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`의 대상 파일을 새로 받아 읽었습니다
앞 배치의 실제 tag API 저장본을 다시 읽어 tag target을 확인했습니다. 파일별 URL·SHA는 `manifest.json`·`manifest-extra.json`에 있습니다

1. [pv_controller.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/volume/persistentvolume/pv_controller.go): `bind` L1095–1134는 claimRef→PV Bound→PVC volumeName/완료 annotation→PVC Bound 순서. `bindVolumeToClaim`, `bindClaimToVolume`, phase/status 갱신은 dirty 검사로 같은 값 쓰기를 생략. **항상 API 쓰기 네 번이라는 원문을 네 처리 순서로 보정**
2. 같은 파일 `syncVolume`·`unbindVolume` L563–750/L1141–1176: UID 없는 name/namespace 예약은 Available일 수 있음. UID는 특정 PVC 신원이며 전체 완료 아님. 재생성 PVC UID 구분·다른 PV가 이긴 경우 bound-by-controller 유무에 따라 claimRef 전체/UID만 제거를 확인
3. [FindMatchingVolume](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-helpers/storage/volume/pv_helpers.go#L186-L326)·[index.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/volume/persistentvolume/index.go): 일반 후보 조건·reserved 예외·WFFC 지연·node 전달 때 affinity 검사. **PV 컨트롤러는 accessModes 그룹 우선이고 첫 매칭 그룹 안의 최소 용량**이며 전체 재고의 무조건 최소 아님
4. pv_controller `checkVolumeSatisfyClaim`와 `syncUnboundClaim`: volumeName으로 지목한 미예약 PV의 삭제/용량/class/mode/VAC/access 검사, selector/nodeAffinity 제외. 이미 같은 PVC의 claimRef면 그 검사를 재실행하지 않는 별도 분기. scheduler affinity는 별도로 유지
5. 같은 파일 `updateClaimStatus` L785–848: accessModes와 capacity 반영. **capacity는 Bound 진입 때 갱신**, 이미 Bound인 상태를 매번 PV 용량으로 덮지 않음. pre-resize annotation이 있으면 이전 용량을 사용하는 예외 보존. 원본 1Gi→적합 후보 100Gi는 실측이 아닌 가정으로 명시
6. [class helpers](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-helpers/storage/volume/helpers.go#L27-L57)·[default admission](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/plugin/pkg/admission/storage/storageclass/setdefault/admission.go)·[class selector](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/util/storageclass.go): beta annotation 존재 우선, nil/빈 문자열 구분, 여러 기본 클래스의 최신 생성 시각·동률 이름순
7. pv_controller `syncUnboundClaim` L332–392/`assignDefaultStorageClass` L968–994: volumeName 없음·적합 PV 없음 분기에서 소급, 기지정/기본 class 없음 제외. 모든 Bound PVC 즉시 갱신 설명 없음. website storage-classes의 empty value/명시적 빈 문자열 문구는 실제 포인터 조건으로 구분
8. [PVC validation](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go#L2489-L2619): storage 요청/accessModes 필수, RWOP 혼합 금지, quota 목적 불변성·빈 volumeName 최초 설정·SC nil 보완·Bound 요청/VAC 등 별도 예외. **volumeName이 유일한 예외라는 일반화 제거**
9. StorageClass v1 defaults/validation: Immediate·Delete 기본값, class reclaim Delete/Retain, parameters 최대 512. [feature registry](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go) VolumeAttributesClass는 1.34 GA/on, 1.36부터 lock/on 확인
10. [VolumeBinding plugin](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/volumebinding/volume_binding.go): Reserve cache assume/PreBind API/Unreserve cache 해제. 표는 쓰기 관련 주요 5개 확장점으로 한정하고 ‘확장점은 넷’이라는 완전 목록으로 쓰지 않음. 현재 PreScore/Score/PreBindPreFlight도 존재 확인
11. [binder.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/volumebinding/binder.go#L399-L776): PV claimRef/PVC selected-node 쓰기, 성공 API의 rollback 없음, cache 가정과 API 반영 구분
12. **중요 정정**: `BindPodVolumes` L477–503의 1초 poll은 `checkBindings`의 `GetAPIObj` 관측 캐시 검사이며 매초 API GET 아님. `isPVCFullyBound` L773–775는 volumeName+AnnBindCompleted 존재. static 경로는 PV UID/affinity 등도 확인하나 **PVC status.phase Bound를 직접 기다리는 조건 아님**. 네 쓰기의 전체 완료와 scheduler 진행 조건을 분리
13. scheduler config/v1/defaults `BindTimeoutSeconds` 기본 600초. PV controller config default 15초·실제 options의 `pvclaimbinder-sync-period`·base `resync` queue 재투입 확인. 완료 상한으로 확대하지 않음
14. binder `hasEnoughCapacity`: CSIDriver.storageCapacity 옵트인·CSIStorageCapacity 정보. 관측 정보와 실제 CreateVolume 실패를 분리. WFFC nodeName 우회는 website StorageClass 문서와 대조
15. [VolumeRestrictions](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/volumerestrictions/volume_restrictions.go) RWOP conflict는 Unschedulable, VolumeBinding 후보/affinity 실패는 UAU. operation_generator의 mount/map에서도 RWOP 검사 확인. website의 CSI 한정·RWO 같은 노드 여러 Pod·마운트 뒤 쓰기 보호 비보장 조건 보존
16. CSI csi_client `asCSIAccessModeV1` RWX→MULTI_NODE_MULTI_WRITER·csi_mounter의 선택 모드 경로 확인. Block/Mount 타입과 모드는 독립. 앞 배치에서 확보한 공식 CSI spec `25b3f10249abe6033887ed5177e856b9f73b1105`의 VolumeCapability/access_type/access_mode를 재확인. 파일시스템/블록 이름만으로 RWX 가능·불가능 단정 안 함
17. pv_controller `reclaimVolume` Retain 무동작/Delete 비동기/CSI migration 외부 담당, syncVolume의 claim UID·Released 처리. API core enum의 초기 PV Pending과 PVC Lost도 확인해 ‘PV phase는 네 개뿐’으로 쓰지 않음
18. [PV 공식 문서](https://kubernetes.io/docs/concepts/storage/persistent-volumes/#persistentvolume-deletion-protection-finalizer)·코어 source의 PV/PVC 사용 보호와 backend 삭제 finalizer를 구분. Retain Released는 재사용 가능한 Available이 아님. Delete 선언의 즉시 성공 보장 없음

## 외부 provisioner 기준과 재사용 검증

- CSI 작성자가 확보한 최신 external-provisioner **v6.4.0 / `72f13ee46fb93c11a72ef91549e70158283c03af`**를 같은 기준으로 재사용
- `/tmp/k8s-batch16/csi/external-refs.json`의 릴리스 ref 확인. 실제 사용한 4개 파일(go.mod/README/cmd/controller)의 SHA를 해당 manifest와 다시 대조했고 `manifest-external-reused.json`에 저장
- [cmd flags](https://github.com/kubernetes-csi/external-provisioner/blob/72f13ee46fb93c11a72ef91549e70158283c03af/cmd/csi-provisioner/csi-provisioner.go)·[makeVolumeName](https://github.com/kubernetes-csi/external-provisioner/blob/72f13ee46fb93c11a72ef91549e70158283c03af/pkg/controller/controller.go#L483-L499): 기본 prefix pvc/UID 길이 -1. **pvc-UID는 설정 가능한 구현 기본값이며 모든 Kubernetes PV 이름 보장 아님**
- 같은 controller의 CreateVolume 오류 분기 L877–913: topology 지원+selected node+오류 유형으로 ProvisioningReschedule 등 결정. 모든 생성 실패가 재선택 아님
- 실제 go.mod 의존 CSI spec v1.13.0, sig-storage-lib-external-provisioner/v13 v13.1.0. k8s.io/api/client-go require v0.37.0은 replace로 v0.36.1이 선택됨을 확인. 설치 클러스터 지원 버전으로 확대 안 함
- 의존 라이브러리 [v13.1.0 controller](https://github.com/kubernetes-sigs/sig-storage-lib-external-provisioner/blob/v13.1.0/controller/controller.go) 실제 읽음: ProvisioningReschedule→selected-node 제거, `AddFinalizer(true)` 호출과 담당 PV의 Delete/Bound/삭제 전 추가 조건, Retain/Recycle 시 제거. 문서의 ‘CSI 전부’ 표현을 실제 담당/정책/상태 조건으로 한정

## 문맥 검토·실행 결과

- 대표 원문: `그림의 참조와 상태는 별도 쓰기다. claimRef를 먼저 썼다는 사실만으로 네 단계가 모두 끝난 것은 아니다.`
- 변환: `각각 별도 API 쓰기이며, 이미 같은 값이면 해당 쓰기를 생략할 수 있습니다` / `스케줄러의 임시 가정이나 API 쓰기 중간에도 UID가 채워질 수 있어, UID 유무와 전체 완료를 같게 보면 안 됩니다`
- 문체·원본 대조: 공식체, 내부 Phase·편집 이력 제외, 원본의 UID/권한/경합/위치/모드/회수 조건 보존. 1Gi/100Gi는 가정이며 관찰 경험 없음. 실제 대안 선정 경험이 없어 별도 선택지 섹션을 만들지 않고 Immediate/WFFC의 교환을 설명
- SVG 2장 XML/title/desc/role 및 이미지 참조 검사 통과. text 10/14개, min font-size 23px, 한글 라벨·Cocoon light 팔레트
- 기존 sharp 0.34.5로 각 SVG 800px/375px PNG 렌더 exit 0. 네 최종 PNG를 view_image로 육안 확인: 글자·선 겹침/잘림 없음, 쓰기 순서·Reserve/PreBind·외부 공급 분기 판별 가능
- 최종 `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-pvc-storageclass-binding.md`: exit 0, error 0/warn 1 — 긴 줄 16곳(긴 URL/식별자 포함). 자동 lint와 별도 문맥 검토 수행
- `git diff --check -- <소유 글·SVG 2개>` exit 0. 원본/context 최종 hash 재확인. 최종 글/SVG SHA는 `content-final.json`, 원본/context는 `source-final.json`
- 처음 추정한 cmd/.../options/pvcontroller.go 404는 원본 지도에 있는 실제 pkg/controller/volume/persistentvolume/options/options.go로 해소. 브라우저 PV 문서 fetch 실패는 고정 website 원문을 새로 받아 읽어 해소. 실패 응답은 근거로 사용하지 않음

## 인계와 한계

- 보류 사유 없음. 독립 reviewer·전체 lint/build/export는 작성자 단계에서 실행 안 함. 최종 완료 수는 parent의 배치 검증 뒤 반영
- 실제 설치 provisioner·driver·capacity 정보·볼륨 자원·시간·데이터 복구/삭제는 미확인. 원본 실습 계획을 실행 경험으로 바꾸지 않음
- 이번 소유 범위인 4-1만 작성했으며 4-4 이후 글은 시작하지 않음


# Batch 16 · 4-2 CSI 구조 인계

- 산출물: `src/content/essays/kubernetes/k8s-theory-csi-architecture.md` · `public/diagrams/k8s-theory-csi-architecture-{1,2}.svg`
- 메타: `k8s-theory-storage` / order 2 / `2026-10-23` / essays/kubernetes
- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 4-2 · CSI 구조 · 코어는 노드 쪽 절반만 부른다.md` 전문 577줄
- 원본 SHA256: `c62a5d840d7390c154d5596078f800d13ba33f5611383490776282d78461bb1f` (작성 후 재확인, sources.json 일치)
- 최신 progress: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/☸️ progress.md` 1122줄, SHA256 `c3081510322928d79907275e31e02c0f4708ec606644bed7581006645d1d16f5`; 4-2 상태·등급·미확인 이력 대조
- 최신 source-map: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/☸️ source-map · Phase 4.md` 722줄, SHA256 `f5acf98a6a57ce6f0bbc4d53b8216ef016c61f21ee790f7060f42076e94fb1d6`; 4-2 절·현재 추가 판정/고정 출처 대조
- 공통 기준: draft-to-post와 연결된 공동 절차, writing-voice, plan/source-format, SVG 가이드 적용. 같은 storage 시리즈 4-1 도입·바인딩 경계 및 기존 CNI 글을 읽고 내부 링크 연결

## 공식 고정 근거와 로컬 경로

캐시 기준 경로는 `/tmp/k8s-batch16/csi`입니다. `manifest.json` 43개 + `manifest-version.json` 1개 + `manifest-extra.json` 3개에 원격 URL·ref·SHA256을 기록했으며, 47개 저장 파일의 실제 해시가 모두 일치합니다
아래 경로는 캐시 기준 상대 경로입니다. 전체 대형 문서의 전 문장을 읽었다는 뜻은 아니며 해당 주장에 필요한 선언·구현·주석·문서 절을 읽었습니다

| 근거 | ref | 실제 사용한 파일·범위 |
|---|---|---|
| [Kubernetes v1.37.1](https://github.com/kubernetes/kubernetes/tree/f78e722310e50bcaca9276be22276d9e91d91308) | `f78e722310e50bcaca9276be22276d9e91d91308` | `kubernetes/go.mod`; `kubernetes/kubernetes/pkg/volume/csi/{csi_client.go,csi_plugin.go,csi_attacher.go,csi_mounter.go,nodeinfomanager/nodeinfomanager.go}`; 등록·Node RPC·capability·오브젝트 생성·cleanup |
| Kubernetes API/등록 | 위와 같음 | `kubernetes/kubernetes/staging/src/k8s.io/api/storage/v1/types.go`, `pkg/apis/storage/v1/defaults.go`, `pkg/kubelet/pluginmanager/operationexecutor/operation_generator.go`, `pkg/volume/csimigration/plugin_manager.go` |
| [website 저장본](https://github.com/kubernetes/website/tree/7fde177e22dc98390a6d55d215dd0301b5f6d0bb) | `7fde177e22dc98390a6d55d215dd0301b5f6d0bb` | `kubernetes/website/content/en/docs/concepts/storage/{volumes.md,ephemeral-volumes.md}`; FlexVolume deprecated·CSI migration·두 ephemeral 방식 |
| [코어가 실제 의존하는 CSI](https://github.com/container-storage-interface/spec/tree/cd9e7ad1ae0915cabcad179f2b8a660c0cb6eb9f) | `v1.12.1-0.20260720052920-cd9e7ad1ae09`, `cd9e7ad1ae0915cabcad179f2b8a660c0cb6eb9f` | `container-storage-interface/spec-core/{spec.md,csi.proto}`; 규격의 배치 비강제·서비스 선언·alpha 표시 |
| [현재 외부 CSI v1.13.0](https://github.com/container-storage-interface/spec/releases/tag/v1.13.0) | `b516e92e3d6c0d27e6c8ffd0a956e3918b50f619` | `container-storage-interface/spec/{csi.proto,go.mod,lib/go/csi/csi_grpc.pb.go}`; 최신 릴리스와 코어 의존성 구별 |
| [CSI docs](https://github.com/kubernetes-csi/docs/tree/67fe654a3246ad5c5cd212a0f4859706f9970353/book/src) | `67fe654a3246ad5c5cd212a0f4859706f9970353` | `kubernetes-csi/docs/book/src/{sidecar-containers,deploying,external-provisioner,external-attacher,external-resizer,external-snapshotter,node-driver-registrar,livenessprobe}.md` |
| [초기 설계](https://github.com/kubernetes/design-proposals-archive/blob/acc25e14ca83dfda4f66d8cb1f1b491f26e78ffe/storage/container-storage-interface.md) | `acc25e14ca83dfda4f66d8cb1f1b491f26e78ffe` | `kubernetes/design-proposals-archive/storage/container-storage-interface.md`; 당시 in-tree/FlexVolume 제약·호출 분리의 동기 |

각 외부 릴리스는 이번 실행의 GitHub Releases latest 및 tag commit 응답으로 확인했습니다. 응답은 `release-api/`, ref 목록은 `external-refs.json`에 있습니다

| sidecar | 릴리스 · ref | 실제 사용한 캐시 파일 |
|---|---|---|
| [external-provisioner](https://github.com/kubernetes-csi/external-provisioner/tree/72f13ee46fb93c11a72ef91549e70158283c03af) | v6.4.0 · `72f13ee46fb93c11a72ef91549e70158283c03af` | `kubernetes-csi/external-provisioner/{go.mod,README.md,cmd/csi-provisioner/csi-provisioner.go,pkg/controller/controller.go}` |
| [external-attacher](https://github.com/kubernetes-csi/external-attacher/tree/40d44ae14961a415348180a0e666651e82e44eb7) | v4.13.0 · `40d44ae14961a415348180a0e666651e82e44eb7` | `kubernetes-csi/external-attacher/{go.mod,README.md,pkg/controller/csi_handler.go}` |
| [node-driver-registrar](https://github.com/kubernetes-csi/node-driver-registrar/tree/6f4e96f4222783370e4d2f3e3fc733b49c194a5f) | v2.18.0 · `6f4e96f4222783370e4d2f3e3fc733b49c194a5f` | `kubernetes-csi/node-driver-registrar/{go.mod,README.md,cmd/csi-node-driver-registrar/main.go,cmd/csi-node-driver-registrar/node_register.go}` |
| [external-resizer](https://github.com/kubernetes-csi/external-resizer/tree/baa08e6d8773f167dbddce36579f36d84bbe3fde) | v2.3.0 · `baa08e6d8773f167dbddce36579f36d84bbe3fde` | `kubernetes-csi/external-resizer/{go.mod,README.md}` |
| [external-snapshotter](https://github.com/kubernetes-csi/external-snapshotter/tree/9cc6050ab00a0c56d84ba0279e518a00367363e7) | v8.7.0 · `9cc6050ab00a0c56d84ba0279e518a00367363e7` | `kubernetes-csi/external-snapshotter/{go.mod,README.md}` |
| [livenessprobe](https://github.com/kubernetes-csi/livenessprobe/tree/08d74914607a0574a300d311c441eca5cd609687) | v2.20.0 · `08d74914607a0574a300d311c441eca5cd609687` | `kubernetes-csi/livenessprobe/{go.mod,README.md}` |

모든 sidecar의 go.mod에서 CSI v1.13.0 직접/간접 의존을 읽었습니다. Kubernetes 자체 의존성과 설치된 드라이버의 지원 범위는 별도입니다
provisioner의 k8s v0.37.0 require에는 v0.36.1 replace가 있어 require만으로 선택 버전·호환 최소 버전을 단정하지 않았으며 writer_a에게 공유했습니다
registrar의 실제 Identity 조회는 의존 `csi-lib-utils v0.24.0`의 `kubernetes-csi/csi-lib-utils/rpc/common.go`도 대조했습니다. tag 고정 URL·파일 SHA256 `3ab46b354fda470a3f48fb9b8279e6bdb43f2e74fede21e8a206421fd3f01171`은 manifest-extra에 기록했습니다

## 원본에서 정정·한정한 내용

- **현재 서비스/RPC 집계**: 원본의 4서비스·34 RPC 대신 vendor 선언 기준 5서비스·36 RPC로 정정했습니다. Identity 3 + Controller 17 + GroupController 4 + SnapshotMetadata 2 + Node 10이며 SnapshotMetadata는 alpha입니다. 선언 수가 코어의 호출 수·드라이버의 필수 구현 수·활성 기능 수를 뜻하지 않도록 본문에 명시했습니다
- 집계 파일: `kubernetes/kubernetes/vendor/github.com/container-storage-interface/spec/lib/go/csi/csi_grpc.pb.go`와 `container-storage-interface/spec-core/csi.proto`. vendor gRPC 파일 SHA256은 `576d75939c7bbcae008103efb865ed4c34ca07f098f6e7c67fbaa88debacc981`이며 현재 외부 v1.13.0 gRPC 생성 파일도 같은 해시입니다. 원본 v1.9.0 역사 집계와 현재 집계를 섞지 않았습니다
- **registrar 역할**: “등록만”으로 줄이지 않고 실제 CSI Identity.GetPluginInfo 조회 → 별도 등록 서버/GetInfo → kubelet NodeGetInfo → Node·CSINode 반영을 구분했습니다. `--kubelet-registration-path`는 등록 소켓이 아닌 호스트 CSI endpoint입니다
- **등록 실패**: “반쪽 등록을 남기지 않는다”는 원자적 보장을 제거했습니다. 실패 시 unregister를 시도하지만 cleanup 자체 실패·Node/CSINode 부분 반영 가능성을 구분했습니다
- **오브젝트 기본값**: CSIDriver 기본 attachRequired true/podInfoOnMount false/storageCapacity false/lifecycle Persistent를 실제 defaults.go와 확인했습니다. CSIDriver NotFound는 attach 생략이 아니며 그 외 조회 오류도 전파됩니다
- **attach 주체·이름**: 코어 attach/detach 경로의 VolumeAttachment 작성과 외부 attacher의 ControllerPublish·status 기록을 구분했습니다. csiAttacher.Attach의 kubelet 경로 거절과 csi-SHA256 이름 형식을 실제 대조했습니다
- **서로 다른 inline**: CSI inline ephemeral(attach/device-mount 제외, Ephemeral 지원 필요), generic ephemeral(PVC 경로), migration의 source.inlineVolumeSpec을 분리했습니다. stage는 STAGE_UNSTAGE_VOLUME capability 조건이며 attachRequired와 별개입니다
- **현행/역사 구분**: 과거 FlexVolume 공존 설명을 현행 지원 상태로 사용하지 않고 현재 deprecated를 반영했습니다. docs의 과거 플래그·구형 호환 표를 현행 기본값/최소 지원 버전으로 옮기지 않았습니다
- **snapshotter·배치**: VolumeSnapshotContent를 처리하는 sidecar와 별도 snapshot controller를 혼동하지 않았습니다. 공통 sidecar는 선택적 구현이며 Linux의 일반 배치·mount propagation·호스트 권한을 모든 드라이버의 필수 구성으로 단정하지 않았습니다
- 미실행 LAB·원본 종료 판정·내부 Phase·편집 경위를 본문에서 제거했습니다. attach/stage/publish의 깊은 수명·강제 detach는 다음 4-3의 범위로 유지했습니다

대표 문장 대조:
- 원본: “그리고 이 호출이 실패하면 kubelet 은 등록을 되돌린다. 반쪽 등록을 남기지 않는다.”
- 변환: “`NodeGetInfo`나 API 반영이 실패하면 등록 처리기는 등록 해제를 시도하고 오류를 반환합니다” / “정리 중 오류도 발생할 수 있으며 로컬 등록 상태·Node·CSINode의 변경 전체가 하나의 원자적 트랜잭션인 것은 아닙니다”

## 자체 검증·남은 범위

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-csi-architecture.md` 실제 실행: error 0 / warn 1, exit 0. `lint-post.log` 저장. 100자 초과 23줄은 링크·메타·alt·표 위주이며 의미 있는 조건을 자르지 않고 검토했습니다
- 본문 251줄 / 표 5개 / SVG 2개. 문단 끝 마침표·언어 없는 코드 블록 없음. 내부 글 2개와 SVG 2개 경로 존재 확인
- SVG XML·title/desc/role 확인, text 요소 16/15개, 원본 최소 20px(375px에서 명목 13.39px). sharp로 원본·375px PNG 총 4개를 렌더하고 각각 육안 검사: 한글 정상, 잘림·겹침·화살표/라벨 충돌 없음
- SVG1은 원본의 두 호출 경로 구조를 변환했고 SVG2는 두 소켓·등록 단계의 관계를 능동 시각화했습니다. 전 섹션을 다시 보며 호출·등록 외에는 표·산문이 적절하다고 판단했습니다
- 원본 대조·격식체·근거·과장·반복 검토: 경험·감정·성능 수치·실행 결과 창작 없음. 선택지 의사결정 절은 원본에 선택 서사가 없어 추가하지 않음
- `output-checks.json`에 원본/메타/캐시 해시·RPC별 이름/집계·본문/이미지/링크 검사 기록. 핵심 근거 미확인·보류 사유 없음
- 실제 클러스터·드라이버 설치·RPC/등록/볼륨 성공·실패 재현은 실행 안 함. 특정 드라이버와 sidecar의 조합 호환성이나 모든 alpha 기능 지원을 검증한 글이 아닙니다
- 독립 reviewer, 전체 lint·build·정적 출력 및 커밋은 parent 담당으로 **이 작성자 단계에서는 실행 안 함**. 4-4 이후 작성·push·배포·시리즈 카드 등록 없음


# Batch 16 · 4-3 인계

- 결과: `src/content/essays/kubernetes/k8s-theory-volume-attach-stage-publish.md`, 같은 slug SVG 2개 저장 · 독립 검수 대기
- series/date: `k8s-theory-storage` / order 3 / `2026-10-23`
- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 4-3 · attach 와 stage 와 publish · 한 번씩이 서로 다른 한 번이다.md` 전문 542줄
- 원본 SHA-256: `e5afbd42a7ab71738cc9aeea39a4614caec6471afe32055067a307adac25472f` · 작업 말미 재계산 일치
- 최신 progress/source-map·plan/source-format, draft-to-post 연결 절차·writing-voice·SVG 가이드 확인 · 같은 시리즈 CSI 구조 글과 호출·capability·버전 경계 대조

## 고정 근거와 대조

- Kubernetes v1.37.1 `f78e722310e50bcaca9276be22276d9e91d91308`, website `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`: 앞 배치 확인 ref를 재사용하고 이번 30개 고정 파일을 실제 읽고 SHA-256 검증
- [CSI 어댑터](https://github.com/kubernetes/kubernetes/tree/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi): Attach/WaitForAttach, stage capability, requiresRepublish, FS/Block·inline lifecycle 분기
- [kubelet volume manager](https://github.com/kubernetes/kubernetes/tree/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/volumemanager), [operation executor](https://github.com/kubernetes/kubernetes/tree/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/util/operationexecutor), [pending operation](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/util/nestedpendingoperations/nestedpendingoperations.go): 별도 DSW/ASW·uncertain 상태, 해제 참조/복구 준비, 작업 키·겹침·backoff, 2분3초·300ms 상태 확인, 오류 접두어
- [DefaultTimerConfig](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/volume/attachdetach/attach_detach_controller.go), [실제 전달](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kube-controller-manager/app/core.go), [시계](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/volume/attachdetach/cache/actual_state_of_world.go), [reconciler](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/volume/attachdetach/reconciler/reconciler.go), [CLI 기본값](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kube-controller-manager/app/options/attachdetachcontroller.go): 기본 6분, 요청 시계, Ready/disable/taint·상태 갱신·작업 조건을 실제 대조
- [Multi-Attach 사전 검사](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/util/util.go): CSI persistent PV의 빈 accessModes/ROX/RWX 허용 분기와 나머지 차단, 드라이버 거절 가능성 구분
- [현재 feature gate](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go): MutableCSINodeAllocatableCount는 1.36부터 GA·true 고정 · 실패 후 VerifyExhaustedResource의 갱신 주기·ResourceExhausted 조건 유지
- [코어 go.mod](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/go.mod)의 CSI 의존 `v1.12.1-0.20260720052920-cd9e7ad1ae09` / [spec 고정본](https://github.com/container-storage-interface/spec/blob/cd9e7ad1ae0915cabcad179f2b8a660c0cb6eb9f/spec.md), 최신 [v1.13.0](https://github.com/container-storage-interface/spec/blob/b516e92e3d6c0d27e6c8ffd0a956e3918b50f619/spec.md) 구분 · 여섯 attach/stage/publish·역방향 RPC의 protobuf 앞 설명을 비교해 동일 확인, 전체 spec 동일성은 주장하지 않음
- [external-attacher v4.13.0](https://github.com/kubernetes-csi/external-attacher/tree/40d44ae14961a415348180a0e666651e82e44eb7)의 README/go.mod/csi_handler 읽음 · core 의존·최신 spec·sidecar·실제 설치 버전 구분
- [공식 비정상 종료/force-detach 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/cluster-administration/node-shutdown.md): 정상 Node 해제 미완료 상태의 분리·잔존 쓰기 위험, out-of-service 전 실제 종료 확인
- URL/ref/파일별 SHA는 `manifest.json`·`external-used.json`, 검증 요약은 `verification.json`, 그림 XML·글자 크기는 `svg-check.json`에 보존

## 보존·정정

- 최신 원본은 2026-09-12 이미 force-detach 기본 6분을 확인한 이력이 있음 · 과거 미확인 항목을 현재 미해결로 옮기지 않음
- 기본 6분은 노드 고장/Pod DELETE부터의 시간이 아님 · attached이면서 DSW에서 사라진 볼륨-노드 쌍의 SetDetachRequestTime부터 `>` 비교, 다시 필요하면 초기화 · pending/backoff 때문에 이 시계의 기록도 늦어질 수 있음
- MountedByNode=true 우회는 timeout 경로에서 `!isHealthy && expired && !disable`; 건강 판정은 정상 조회 시 Ready=True · `--disable-force-detach-on-timeout` 기본 false · out-of-service taint 키는 별도 우회 · 요청/완료 시각 보장 아님
- 정상 Unpublish→Unstage→ControllerUnpublish와 장애 복구 분리를 구분 · 노드 status 갱신/드라이버·백엔드 처리와 데이터 손상 가능성 보존
- ‘스토리지가 아니라 코어가 막는다’를 코어 사전 검사와 드라이버 거절의 두 범위로 정정 · RWO의 같은 노드 Pod 공유와 RWOP 검사 구분
- 작업 직렬화는 attachable/device-mountable mount의 볼륨 키와 그 외 Pod 키, Pod별 unmount/unmap의 병렬 범위를 나눔 · 여러 RPC·백엔드의 원자적 트랜잭션으로 설명하지 않음
- 오류 접두어는 호스트 작업의 단서이며 RPC 진입 증거로 단정하지 않음 · 원본의 subPath→SetUp 고정 대응과 흔함·비용·실측 주장 제외
- 원본 v1.35 gate 설명을 현행 GA 상태와 구분 · LAB TODO 11개, 종료 판정, 내부 Phase·편집 경위는 실제 경험으로 옮기지 않음

## 실행 검증과 한계

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-volume-attach-stage-publish.md`: exit 0 / error 0 / warn 2
- 경고: 긴 줄 17곳은 고정 URL·참고 자료 등 문맥 검토; SVG1 `<text>` 20개(목표16)로 준비 단위·호출자·두 Pod 분기·예외를 표시하며 375px 가독성 확인
- SVG 2개 XML 파싱·role/title/desc 확인, sharp 600/375px PNG 4개 생성·모두 육안 확인 · 겹침/잘림 없음 · 최소 글자 21px/600 viewBox → 375px에서 13.125px
- 전 섹션 시각화 감사: 준비 범위/정상 해제는 SVG 2개, 조건·오류 비교는 표 5개, 나머지는 산문 · 단락 끝 마침표·격식체·근거·중복·원본 자립성 검토
- 초기 추정 defaults.go 경로 404는 기록 후 실제 `pkg/kubelet/apis/config/v1beta1/defaults.go`로 재확인 · CSI lifecycle 사이트의 web 오류는 pinned spec/소스 대조로 대체
- 원문 대표(L51): “재시도나 재게시 때문에 CSI RPC 호출은 같은 대상에 여러 번 일어날 수 있다.” → 본문: “실패·응답 유실 뒤 재시도하거나 이미 준비된 대상에 다시 요청할 수 있으며, CSI는 호환되는 반복 요청을 처리하는 멱등성을 요구합니다”
- 핵심 미해결/보류: 없음 · 실제 드라이버·설치 capability·실습·장애 시간·물리 분리 완료는 미검증임을 본문에 명시
- build·전체 lint·정적 출력·커밋: 실행 안 함, parent 배치 검증 담당


## 별도 blog-reviewer 검수

# Review: Batch 16 · 3 posts / 6 SVG

## P0 필수 수정

- 0건

## P1 확인 필요·권장

- 확인 필요 0건 / 권장 0건
- volume SVG1의 text 20개 경고는 실제 375px 렌더에서 호출자·두 Pod target·runtime·생략/반복 조건이 구분되고 겹침·잘림이 없어 수정 요구로 올리지 않음

## 원본·문체·연결

- `sources.json`의 정확한 Vault 원본 646·577·542줄 전문과 최종 글을 대조했고 실제 SHA-256·줄 수가 모두 일치함
- draft-to-post·공통 writing-voice·source-format·시리즈 plan·SVG 기준 적용 확인. 원본의 질문·기전·선택 조건·실패 판별을 보존하며 LAB TODO·측정·실행 경험을 만들지 않음
- 과거 CSI 선언 수·바인딩 네 번 쓰기·scheduler API 읽기 표현은 고정 현행 소스에 따라 정정했으며 원본의 v1.35 설명을 현행 동작과 섞지 않음
- 최신 원본은 force-detach 6분을 이미 확인했으므로 과거 미확인 이력을 현행 보류로 옮기지 않은 점 확인
- 반말 문맥·과장·직역·불필요한 반복·내부 편집 좌표 문제 없음. 표·SVG 뒤 설명은 기전·조건을 보완하며 개수만 채우는 재서술을 요구하지 않음
- 세 slug 유일, essays/kubernetes·series `k8s-theory-storage` order 1·2·3이 계획과 일치. 시리즈 트랙 분리 없음
- 세 글의 바인딩 완료/attach·등록/CSI 호출·노드 준비 경계와 기존 CNI 글의 계약/구현 구분이 서로 일치함

## 핵심 기술 재검증

- 공통 Kubernetes v1.37.1 ref `f78e722310e50bcaca9276be22276d9e91d91308`, website ref `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`의 대상 심볼·분기·문서를 실제 대조함
- 바인딩: [bind·unbindVolume·updateClaimStatus](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/volume/persistentvolume/pv_controller.go)의 네 처리 순서, dirty 검사에 따른 쓰기 생략, UID 없는 예약과 전체 완료, status capacity의 Bound 진입/pre-resize 예외 확인
- [PV index](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/volume/persistentvolume/index.go)와 [FindMatchingVolume](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-helpers/storage/volume/pv_helpers.go)의 accessModes 그룹 우선·첫 매칭 그룹 내 최소 용량, 일반/예약/volumeName 지목 조건·WFFC 지연을 분리한 설명이 맞음
- [binder.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/volumebinding/binder.go)의 Reserve assume/PreBind API/Unreserve 캐시 복원, 성공 API rollback 부재, 1초 poll의 `GetAPIObj` 캐시와 `volumeName`+`AnnBindCompleted` 관측 조건 확인. PVC 마지막 status Bound 쓰기를 직접 기다린다는 설명 없음
- 클래스 nil/빈 문자열·beta 어노테이션 우선·소급 지정 분기, 기본 StorageClass 선택, 동적 공급의 설정 가능한 PV 이름·실패 재선택/capacity 조건, RWOP와 회수/삭제 finalizer 범위를 실제 helper·controller·validation·외부 provisioner 근거와 대조함
- CSI: [코어 go.mod](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/go.mod)의 pseudo-version `v1.12.1-0.20260720052920-cd9e7ad1ae09`와 외부 spec v1.13.0·sidecar 릴리스를 분리함. 각 sidecar go.mod의 CSI v1.13.0 직접/간접 의존도 확인
- 실제 vendor [csi_grpc.pb.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/vendor/github.com/container-storage-interface/spec/lib/go/csi/csi_grpc.pb.go)의 FullMethodName 선언을 대조해 Identity 3·Controller 17·GroupController 4·SnapshotMetadata 2·Node 10 = 5서비스/36 RPC 확인. 의존 proto의 SnapshotMetadata alpha 표시와 실제 NodeClient 호출 구현·capability 조건을 구분함
- [registrar](https://github.com/kubernetes-csi/node-driver-registrar/tree/6f4e96f4222783370e4d2f3e3fc733b49c194a5f)·[RegisterPlugin](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/csi_plugin.go)의 CSI GetPluginInfo→별도 등록 소켓 GetInfo→NodeGetInfo→Node/CSINode 기록, 두 CLI 소켓 경로와 실패 시 unregister 시도·부분 실패 가능성 확인
- CSIDriver 기본값/NotFound, CSINode nodeID/topology 키·값, VolumeAttachment spec/status·해시 이름·kubelet Attach 거절과 inline ephemeral/generic ephemeral/migration의 서로 다른 경계가 실제 구현과 일치함
- 볼륨: [csiAttacher](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/csi_attacher.go)·mounter·block·kubelet reconciler·operation executor와 [CSI spec](https://github.com/container-storage-interface/spec/blob/cd9e7ad1ae0915cabcad179f2b8a660c0cb6eb9f/spec.md)의 attach/stage/publish 주체·생략/반복·노드/Pod target 단위, Filesystem/Block 경로와 정상 역방향 해제 순서를 확인
- DSW/ASW·uncertain 상태·복구 준비, mount/map와 Pod별 unmount/unmap의 pending operation 키/병렬 범위, backoff는 실제 소스에 맞으며 여러 CSI 작업을 원자적 트랜잭션으로 설명하지 않음
- IsMultiAttachAllowed의 빈 accessModes/ROX/RWX 사전 통과와 다른 모드의 다른 노드 attachment 차단을 드라이버의 실제 거절과 분리함. kubelet 2분3초/300ms는 상태 대기이며 RPC 주기로 쓰지 않음. MutableCSINodeAllocatableCount의 현행 GA 잠김과 VerifyExhaustedResource의 주기/ResourceExhausted 조건도 확인
- [DefaultTimerConfig](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/volume/attachdetach/attach_detach_controller.go)·ASW SetDetachRequestTime·[reconciler](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/volume/attachdetach/reconciler/reconciler.go)의 6분/DSW 이탈·요청 시계·초과 비교·Ready·disable 플래그·out-of-service·작업/Node status 조건 확인. 장애나 DELETE부터 정확히 6분에 분리 완료를 보장하지 않음
- [현행 비정상 종료 문서](https://kubernetes.io/docs/concepts/cluster-administration/node-shutdown/#storage-force-detach-on-timeout)와 CSI 해제 계약을 대조해 강제 분리와 정상 Node 해제 완료·물리 종료를 구분한 설명 확인

## 실제 검증

- 완료 파일부터 개별 lint 후 최종 세 편 통합 `npm run lint:post -- <세 대상 파일>` exit 0 / error 0 / warn 4. 원시 출력 `review-lint.log`
- 긴 줄 경고는 각각 16·23·17곳이며 URL·표·필수 조건 문맥 검토. 추가 1건은 위 volume SVG1 text 20개 경고로 실제 시각 검수 통과
- SVG 6개 XML·role/title/desc 확인, 기존 sharp로 800px/375px PNG 12개를 새로 렌더하고 모두 육안 확인. 순서·호출자·기능 조건·정상 해제 관계가 본문과 일치하며 겹침/잘림 없음
- 최종 CSI 인계의 내부 글 링크·CSINode 소제목·문장 분리를 저장본에서 재확인. 렌더 입력과 최종 SVG hash 동일
- 원본 3개·유효 근거 캐시 115개 hash 모두 일치(binding 33, CSI 47, volume 35). 최초 404 2건은 근거에서 제외하고 실제 경로로 해소함
- 최초 RPC Client interface 추출은 스트리밍 보조 타입까지 포함해 집계 assertion이 실패했으나 FullMethodName 선언으로 바로잡아 5서비스·36 RPC를 확인함. 대조 결과·개별 URL/hash는 `reviewer-evidence-checks.json`과 각 `manifest*.json`/`external-used.json`
- 최종 글 3개·SVG 6개 총 9개 평면 SHA-256은 `review-hashes.json`, 재렌더 입력/PNG는 `reviewer-render/`
- 전체 lint·build·정적 출력·클러스터/드라이버 실습·commit은 reviewer가 실행하지 않았으며 parent의 통합 검증 대상

## 요약

- 최종 미해결 필수 0건 / 확인 필요 0건 / 권장 0건
- 검토 대상: 글 3개·SVG 6개 / 레거시 제외 0개 / 콘텐츠 수정 없음


## 실제 최종 검증

- `npm run lint:post -- <이 배치 3편>`: exit 0, error 0 / warn 4
- `npm run lint`: exit 0, error 0 / warn 1 (기존 `src/app/layout.tsx:80` custom font 경고)
- `npm run build`: exit 0, TypeScript·정적 생성·postbuild 성공, 640 pages
- 원본 SHA-256·검수 후 글/SVG와 빌드 입력 hash 일치
- slug 유일성·시리즈 order 연속성·내부 링크·이미지 실존·SVG XML/접근성 메타 검사 통과
- `getAllPosts`·`getEssaysList`·`getSearchIndex` 실제 실행: 3편 모두 essays로 등록, 목록·검색 객체에 content 없음
- HTML 3개·SVG 6개 실제 export 및 `/my-blog/diagrams/` 참조·SVG 바이트 일치
- sitemap·llms 3편 반영, RSS는 기존 최신 20편 정책과 실제 출력 일치
- `git diff --check` 통과
- prebuild의 이번 CLAUDE.md 자동 통계 변경만 복원, Vault 원본 변경 없음
- build의 Node `DEP0205 module.register()` 및 로컬 TS 직접 import의 `MODULE_TYPELESS_PACKAGE_JSON` 경고는 남아 있으며 애플리케이션 설정을 범위 밖에서 바꾸지 않았다
- 클러스터 실습·통합 테스트·성능 실측·push·배포·시리즈 카드 등록: 실행 안 함

원시 로그·임시 근거 저장본: `/tmp/k8s-batch16/`
영구 재확인 경로는 위 글과 작성 기록의 공식 소스 URL이다

## 다음 대상

- Phase 4-4 StatefulSet과 볼륨 수명
- Phase 4-5 확장·스냅샷·임시 볼륨
- Phase 4-6 볼륨 개수 상한
