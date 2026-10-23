# Batch 17 인계 — 2026-10-23

글 3편·SVG 6장 검수 완료. 콘텐츠 커밋 `87fe769`
작성 기준일은 2026-10-23이며 학습일·배포일이 아니다

## 원본·결과 대응

Vault 원본은 읽기 전용이며 검증 전후 SHA-256 일치를 확인했다
원본 루트: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/`

| 좌표 | 정확한 원본 파일명 | 줄 수 | SHA-256 | slug | series / order |
|---|---|---:|---|---|---|
| 4-4 | `Phase 4-4 · StatefulSet과 볼륨 수명 · 지우는 대신 주인을 바꾼다.md` | 448 | `c3265ed8dc64991f64afe8475c0f378fbfc32604c0a12488cdd69bb93602d85d` | `k8s-theory-statefulset-volume-lifecycle` | `k8s-theory-storage` / 4 |
| 4-5 | `Phase 4-5 · 확장과 스냅샷과 임시 볼륨 · 나중에 하는 일에 새 장치는 없다.md` | 677 | `04b94cd9741b270aecc369ba59c34d7a9cae3cd1a5485f8c0b7795b5b99da305` | `k8s-theory-volume-expansion-snapshots-ephemeral` | `k8s-theory-storage` / 5 |
| 4-6 | `Phase 4-6 · 볼륨 개수 상한 · 드라이버가 말한 숫자를 누가 고치나.md` | 567 | `ffa9b18ae614fc46497a4aeab1e70b57d6352a19f23d4f303a825cfab2d7f58b` | `k8s-theory-volume-attachment-limits` | `k8s-theory-storage` / 6 |

## 작성자의 근거 대조·편집 기록

작성 단계의 기록이며 이후 정정은 별도 검수·수정 기록을 우선한다

# Batch 17 · 4-5 확장·스냅샷·임시 볼륨 인계

- 산출물: `src/content/essays/kubernetes/k8s-theory-volume-expansion-snapshots-ephemeral.md`, `public/diagrams/k8s-theory-volume-expansion-snapshots-ephemeral-{1,2}.svg`
- 메타: `k8s-theory-storage` / order 5 / date `2026-10-23` / essays/kubernetes
- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 4-5 · 확장과 스냅샷과 임시 볼륨 · 나중에 하는 일에 새 장치는 없다.md` 전문 677줄
- 원본 SHA256: `04b94cd9741b270aecc369ba59c34d7a9cae3cd1a5485f8c0b7795b5b99da305`; 작성 전후 실제 해시·줄 수를 sources.json과 확인
- 최신 progress: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/☸️ progress.md`, 1122줄, SHA256 `c3081510322928d79907275e31e02c0f4708ec606644bed7581006645d1d16f5`; Phase 4 상태·종료/보류 기록 확인
- 최신 source-map: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/☸️ source-map · Phase 4.md`, 722줄, SHA256 `f5acf98a6a57ce6f0bbc4d53b8216ef016c61f21ee790f7060f42076e94fb1d6`; 4-5 절·현재 추가 판정/고정 출처 확인
- draft-to-post 진입점·연결된 공동 절차, writing-voice, plan/source-format, SVG 가이드 적용. 기존 storage 4-3의 stage/publish·Block·멱등성·해제 조건을 읽고 4-2 호출 경계와 맞춤

## 실제 확인한 버전·공식 URL

GitHub API로 Kubernetes tag commit·website commit·외부 최신 Releases/tag commit을 이번 실행에 재확인했습니다. `/tmp/k8s-batch17/expansion/refs.json`에 저장했습니다

| 대상 | 버전 / ref | 공식 근거 |
|---|---|---|
| Kubernetes | v1.37.1 / `f78e722310e50bcaca9276be22276d9e91d91308` | [고정 소스](https://github.com/kubernetes/kubernetes/tree/f78e722310e50bcaca9276be22276d9e91d91308) |
| website | `7fde177e22dc98390a6d55d215dd0301b5f6d0bb` | [스토리지 문서](https://github.com/kubernetes/website/tree/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/storage) |
| core CSI 의존성 | `v1.12.1-0.20260720052920-cd9e7ad1ae09` / `cd9e7ad1ae0915cabcad179f2b8a660c0cb6eb9f` | [실제 go.mod](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/go.mod), [규격](https://github.com/container-storage-interface/spec/blob/cd9e7ad1ae0915cabcad179f2b8a660c0cb6eb9f/spec.md) |
| 외부 CSI spec | v1.13.0 / `b516e92e3d6c0d27e6c8ffd0a956e3918b50f619` | [릴리스](https://github.com/container-storage-interface/spec/releases/tag/v1.13.0) |
| external-resizer | v2.3.0 / `baa08e6d8773f167dbddce36579f36d84bbe3fde` | [구현](https://github.com/kubernetes-csi/external-resizer/tree/baa08e6d8773f167dbddce36579f36d84bbe3fde) |
| external-provisioner | v6.4.0 / `72f13ee46fb93c11a72ef91549e70158283c03af` | [구현](https://github.com/kubernetes-csi/external-provisioner/tree/72f13ee46fb93c11a72ef91549e70158283c03af) |
| external-snapshotter | v8.7.0 / `9cc6050ab00a0c56d84ba0279e518a00367363e7` | [구현](https://github.com/kubernetes-csi/external-snapshotter/tree/9cc6050ab00a0c56d84ba0279e518a00367363e7) |

캐시 기준 경로는 `/tmp/k8s-batch17/expansion`입니다. manifest 3개에 각 원격 URL/ref/SHA256을 남겼습니다. 저장 성공 52개 파일의 실제 해시가 일치합니다
초기 경로 추정 `pkg/controller/modify.go` 1건은 404였고 실제 tree로 `pkg/modifier`·`pkg/modifycontroller` 경로를 확인해 해결했습니다. 이 실패 응답은 manifest.json에 보존했으며 핵심 미확인으로 남기지 않았습니다
대형 파일은 해당 주장에 필요한 심볼·문서 절을 읽었으며 전체 파일의 모든 문장을 읽었다고 보고하지 않습니다

실제 읽은 핵심 캐시 파일(위 경로 기준):

- `kubernetes/kubernetes/pkg/apis/core/validation/validation.go`의 ValidatePersistentVolumeClaimUpdate, `plugin/pkg/admission/storage/persistentvolume/resize/admission.go`, `pkg/kubeapiserver/options/plugins.go`: Bound/PVC 불변·호환 예외·현재 SC의 확장 허용·기본 admission
- `kubernetes/kubernetes/pkg/controller/volume/expand/expand_controller.go`, `pkg/volume/csi/expander.go`, `pkg/volume/util/{resize_util.go,operationexecutor/node_expander.go}`: 외부 위임·노드 capability·Block 경로·오류 분류·RWX 추가 노드 확장
- `kubernetes/kubernetes/staging/src/k8s.io/api/{core,storage}/v1/types.go`, `pkg/features/kube_features.go`, `pkg/apis/storage/validation/validation.go`: 확장/속성 status·dataSource/dataSourceRef·ephemeral 타입·현재 gate·VAC 불변
- `kubernetes/kubernetes/pkg/controller/volume/ephemeral/controller.go`, `staging/src/k8s.io/component-helpers/storage/ephemeral/ephemeral.go`, `pkg/volume/csi/csi_mounter.go`: 이름·생성 시 ownerRef·소유 검사·lifecycle·NodeUnpublish 실패 반환
- `kubernetes/kubernetes/cluster/addons/volumesnapshots/crd/*.yaml`, `volume-snapshot-controller/volume-snapshot-controller-deployment.yaml`, `staging/src/k8s.io/apiextensions-apiserver/pkg/{apis/apiextensions/validation/validation.go,apihelpers/helpers.go}`: CRD scope·addon 이미지·승인 어노테이션의 실제 검증
- `kubernetes-csi/external-resizer/{go.mod,README.md,pkg/resizer/csi_resizer.go,pkg/resizer/trivial_resizer.go,pkg/controller/expand_and_recover.go,pkg/controller/resize_status.go,pkg/features/features.go,pkg/csi/client.go,pkg/modifier/csi_modifier.go,pkg/modifycontroller/modify_volume.go}`: 분리된 RPC·node-only·slow retry·외부 gate·MODIFY_VOLUME·VAC 상태
- `kubernetes-csi/external-snapshotter/{go.mod,README.md,pkg/common-controller/snapshot_controller.go,pkg/sidecar-controller/snapshot_controller.go,client/apis/volumesnapshot/v1/types.go}`: 공통 controller의 Content 생성·바인딩과 sidecar의 CSI 호출·상태
- `kubernetes-csi/external-provisioner/{go.mod,README.md,pkg/controller/controller.go}`: snapshot capability 검사, getSnapshotSource의 driver/참조/ReadyToUse/handle 확인, source를 담은 CreateVolume
- `kubernetes/website/content/en/docs/concepts/storage/{persistent-volumes,volume-snapshots,ephemeral-volumes,volume-attributes-classes,volume-pvc-datasource}.md`, `container-storage-interface/{spec-core,spec}/spec.md`: 확장·복원·임시 볼륨 보안·RPC 조건. core/latest의 ControllerExpandVolume·NodeExpandVolume·ControllerModifyVolume 절은 동일하며 spec-contract-checks.json에 절별 SHA 기록

## 원본에서 정정·한정한 내용

- ControllerExpandVolume과 NodeExpandVolume을 항상 둘 다 부르는 순서로 쓰지 않았습니다. `node_expansion_required`, 각 서비스의 EXPAND_VOLUME capability, 현재 sidecar의 trivial resizer 경로를 보존했습니다
- NodeExpand는 NodeStage 이후(지원 시) 또는 NodePublish 이후입니다. Block도 필요한 노드 작업이 있을 수 있으며 NodeExpand를 파일시스템 확장으로만 한정하지 않았습니다. ONLINE/OFFLINE·노드 준비·실제 드라이버/파일시스템 지원을 구분했습니다
- 조건과 allocatedResourceStatuses가 모든 오류에서 일대일로 함께 기록된다고 하지 않았습니다. Infeasible의 API 의미와 resizer의 실제 느린 재시도를 구분해 원본의 “재시도해도 안 된다” 단정을 고쳤습니다
- 요청 감소는 새 요청이 기존 status.capacity를 **초과**해야 합니다. 실제 `<=` 거절과 RecoverVolumeExpansionFailure v1.34 GA·true 잠금을 대조했고, 디스크 축소·즉시 복구 완료로 쓰지 않았습니다. 선언의 “remove in 1.37” 주석은 제거 사실이 아니므로 본문에 제거됐다고 쓰지 않았습니다
- 스냅샷 CRD 생성·등록과 스토리지 스냅샷 생성은 다릅니다. 공통 snapshot-controller의 Content 생성/바인딩, csi-snapshotter의 Create/DeleteSnapshot, provisioner의 복원 CreateVolume을 구분했습니다
- core addon의 snapshot-controller는 **v8.6.0**이며 외부 최신 v8.7.0과 다릅니다. manifests 존재를 자동 설치로 옮기지 않았습니다. api-approved의 형식 검증·기존 승인 상태 호환 예외를 확인했고, 세 CRD가 모두 /814라는 원본 기록은 바로잡았습니다(Content는 /955, 나머지는 /814; 본문에서는 URL 일괄 단정 제거)
- website에 남은 과거 webhook 배포 설명이나 옛 sidecar 호환 표를 현재 설치 필수 조합으로 옮기지 않았습니다. snapshot API가 앱 일관성·복원 지원을 보장한다는 식으로 쓰지 않았습니다
- generic ephemeral의 생성 시 Pod UID ownerRef와 Controller/BlockOwnerDeletion true, `<pod>-<volume>` 이름·기존 소유 검사, GC·보호·Retain에 따른 자원 잔존을 확인했습니다. CSI inline은 PVC 없이 NodePublish/NodeUnpublish를 사용하며 lifecycle Ephemeral 지원이 필요합니다
- PVC 쿼터와 Pod admission/쿼터, kubelet 로컬 ephemeral-storage 계측을 분리했습니다. generic ephemeral의 간접 PVC 생성 권한과 CSI inline의 직접 volumeAttributes 보안 경계는 현행 공식 문서로 설명했습니다
- VAC의 core gate는 v1.36부터 true 잠금입니다(website의 비활성화 가능 산문과 다름). resizer v2.3.0의 동명 gate는 GA·default true이지만 LockToDefault 없음. MODIFY_VOLUME 지원·새 클래스 참조·성공 적용 후 제거 제한·InvalidArgument의 Infeasible 분류를 확인했습니다
- 세 sidecar go.mod의 CSI 의존은 v1.13.0입니다. 코어 의존성과 동일 버전이라고 쓰지 않았고, provisioner의 k8s v0.37.0 require → v0.36.1 replace도 확인해 호환 최소 버전으로 추정하지 않았습니다
- 내부 Phase/종료 판정·미실행 LAB은 본문에서 제거했습니다. 원본의 10Gi→20Gi는 가정 예시로 유지했고 경험·실행 결과·성능 수치를 만들지 않았습니다

대표 문장:
- 원본: “`status.allocatedResourceStatuses` 가 `ControllerResizeInfeasible` 이다 | 되돌릴 수 없는 실패다. 재시도해도 안 된다”
- 변환: “Infeasible은 단순 타임아웃 같은 일시적 오류보다 좁은 분류입니다” / “현재 external-resizer에는 이 상태의 느린 재시도 경로가 있으며 요청 변경도 별도로 처리합니다”

## 자체 검증·한계

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-volume-expansion-snapshots-ephemeral.md` 실제 실행: exit 0, error 0 / warn 1(100자 초과 17줄 검토, 주로 고정 URL·메타·alt). 최종 log는 lint-post.log. 작성 중 SVG 저장 전의 자산 부재 오류 2건은 SVG 작성 후 해소했고 최종 검사에서 오류 0입니다
- 본문 274줄 / 표 4개 / SVG 2개. SVG1은 원본 확장 흐름 변환, SVG2는 임시 볼륨 수명·소유 차이를 능동 시각화. 전 섹션 재검토에서 snapshot API 대응은 표와 실제 호출 주체 순서로 설명하고 중복 그림을 추가하지 않았습니다
- XML 파싱·title/desc/role·이미지 및 내부 링크 실존 확인. SVG text 요소 14/12개, 최소 20px(375px에서 명목 13.39px). sharp로 800/375px PNG 4개 렌더 후 각각 육안 확인: 한글 정상, 잘림·겹침·선/라벨 충돌 없음
- source-checks.json·output-checks.json·checks-run.log에 원본/관련 기록/콘텐츠/SVG/캐시 해시·링크·XML·표 수 기록. 문단 끝 마침표 없음, YAML 언어 표기. 원본 대조·격식체·과장·근거·반복·내부 맥락 문맥 검토 완료
- 선택지 의사결정 절은 원본에 실제 선택 서사가 없어 추가하지 않았습니다. 확인을 기다려야 할 핵심 근거·보류 사유 없음
- 드라이버 설치·실제 API 요청/확장/스냅샷/삭제·앱 일관성·성능·드라이버별 지원 조합은 실행/시험 안 함. alpha/gate 존재만으로 실제 지원을 단정하지 않았습니다
- 별도 reviewer·전체 lint/build·정적 출력·공통 진행표·커밋은 parent 담당이며 작성자 단계에서는 실행 안 함. push·배포·시리즈 카드 등록 없음


# Batch 17 · 4-6 인계

- 결과: `src/content/essays/kubernetes/k8s-theory-volume-attachment-limits.md`, 같은 slug SVG 2개 저장 · 독립 검수 대기
- series/date: `k8s-theory-storage` / order 6 / `2026-10-23`
- 최신 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 4-6 · 볼륨 개수 상한 · 드라이버가 말한 숫자를 누가 고치나.md` 전문 567줄
- 원본 SHA-256: `ffa9b18ae614fc46497a4aeab1e70b57d6352a19f23d4f303a825cfab2d7f58b` · 말미 재계산 일치
- 최신 progress/source-map Phase4·plan/source-format·draft-to-post 연결 절차·writing-voice·SVG 가이드·같은 시리즈 4-3 기존 글 대조

## 실제 읽은 근거

- Kubernetes v1.37.1 `f78e722310e50bcaca9276be22276d9e91d91308`, website `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`: 앞 배치의 검증 ref 재사용, 이번 관련 소스·문서는 고정 URL에서 다시 확보
- [NodeVolumeLimits](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/nodevolumelimits/csi.go): Filter·getVolumeLimits·filterAttachableVolumes·getNodeVolumeAttachmentInfo·checkCSIDriverOnNode·queueing events를 실제 읽음 · [기본 포함](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/apis/config/v1/default_plugins.go)
- [nodeinfomanager](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/nodeinfomanager/nodeinfomanager.go): NodeGetInfo 응답의 양수/0/음수·MaxInt32 변환, 미변경 쓰기 생략·현재 등록/해제 · [v1.35 과거 cleanup](https://github.com/kubernetes/kubernetes/blob/5671697925fe8d7222c4ab09cb15f28f5f9d0383/pkg/volume/csi/nodeinfomanager/nodeinfomanager.go), 같은 ref의 attach_limit.go와 구분
- [API 타입](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/storage/v1/types.go)·[검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/storage/validation/validation.go)·[gate 이력](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go): 포인터/0, 동일 이름 기존 항목의 allocatable 예외, 주기 최소10초, 두 기능 단계·기본값
- [주기 갱신](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/csi_node_updater.go), [고갈 확인](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/csi_plugin.go), [대기 실패](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/volumemanager/volume_manager.go), [SyncPod·rejectPod](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kubelet.go): 실제 조회·순서·실패 반환·PodFailed 처리
- [CSI NodeGetInfo 계약](https://github.com/container-storage-interface/spec/blob/cd9e7ad1ae0915cabcad179f2b8a660c0cb6eb9f/spec.md#nodegetinfo): 코어 go.mod의 의존 commit · core spec/latest1.13.0 캐시 SHA 재검증 후 사용, 두 버전·실제 드라이버 버전을 혼합하지 않음
- [external-attacher v4.13.0 saveAttachError](https://github.com/kubernetes-csi/external-attacher/blob/40d44ae14961a415348180a0e666651e82e44eb7/pkg/controller/csi_handler.go): sidecar 기능 조건과 gRPC 오류 판독 성공 시 숫자 코드를 기록하는 예시, 실제 설치 버전 확인은 아님
- [현재 공식 storage-limits](https://kubernetes.io/docs/concepts/storage/storage-limits/)를 실제 열고 [website 고정본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/storage/storage-limits.md) 전체와 대조 · [KEP-4876 역사 고정본](https://github.com/kubernetes/enhancements/blob/239378198938b817a1a5fbdf05501bd66d304a86/keps/sig-storage/4876-mutable-csinode-allocatable/README.md)의 공유 한도·설계와 실행 코드 구분
- 성공한 고정 근거 19개(이번 다운로드16개·앞 배치 캐시3개) SHA 모두 재검증 · URL/ref/hash는 `manifest.json`, 자체 검증 요약 `verification.json`

## 보존·정정·경계

- MutableCSINodeAllocatableCount는 원본 v1.35 beta/on과 달리 1.36부터 GA·true 고정 · 주기 설정은 여전히 필요, 미설정이면 이 기능의 주기/고갈 갱신 모두 비활성 · 0은 유효 주기 예시가 아니며 API 하한10초
- VolumeLimitScaling은 v1.37 beta/on이지만 preventPodSchedulingIfMissing=true 옵트인 필요 · CSIDriver NotFound·다른 조회 오류·CSINode/항목 누락을 나누고 numeric limit 누락과 설치 검사를 구분 · Cluster Autoscaler의 CSI 정보 포함 조건은 공식 문서 범위로만 설명
- CSI 0→kubelet allocatable 미설정, API count0→명시적 상한0 · 음수 CSI 계약 위반과 실제 kubelet 로그/미설정 저장을 구분 · 미설정을 실제 백엔드 무제한/설치/성공 보장으로 쓰지 않음
- 노드·드라이버별 volume key, 기존 Pod 공유·Pod/VA 중복 제거 보존 · VA-only 키가 새 요구에도 남는 이중 계상·attached=true 비필터·미바인딩 PVC 임시키 과다 계산 가능성이 현행에도 유지됨
- generic ephemeral의 계산 PVC·소유 검증과 직접 CSI inline/migration 조건 구분 · core가 cloud 슬롯을 직접 재거나 driver 간 공통 한도를 합산하는 기능으로 설명하지 않음 · 과거 in-tree 숫자를 현재 모든 CSI/클라우드 한도로 인용하지 않음
- ‘즉시 갱신’은 주기 tick을 기다리지 않는 반응 · 실제로 WaitForAttachAndMount 실패 후 미부착 attachable 볼륨→CSIDriver/주기/VA 조회→숫자8 확인→동기 NodeGetInfo/갱신 시도→PodFailed · 즉각 감지나 지연/성공 보장 아님
- 갱신 실패도 고갈 판정true를 바꾸지 않아 Pod 실패 가능, 같은 Pod 재배치 아님 · 대체 생성은 컨트롤러 정책/단독 Pod 자동 대체 없음 · 일반 attach 재시도와 Pending 재평가는 별도 주체
- v1.35의 옛 키 삭제 코드와 현행 삭제함수 부재·CSINode 읽기를 분리 · 원본의 옛 키 길이 축약 세부는 현행 학습에 불필요해 제외
- 미실행 LAB TODO 8개·종료 판정·내부 학습 메타는 경험으로 변환하지 않음 · 주기10초의 정량 선정 근거 미확인은 본문에 보존, 핵심 검증 차단은 아님

## 실행·문체 검증

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-volume-attachment-limits.md`: exit0 / error0 / warn3 · 결과 `lint-post.txt`
- 경고: 100자 초과15줄(고정 URL 등 문맥 검토), SVG1 text18개/SVG2 text20개(목표16 초과) · 정보와 조건을 위한 라벨이며 최종 800/375px 가독성·여백·겹침을 육안 확인
- SVG2를 병렬처럼 보일 수 있는 분기에서 실제 동기 재조회→Pod 실패 순서로 수정 후 재렌더·육안 재검사 · 최종 SVG2개 XML·a11y title/desc/role, PNG4개 800/375px 모두 통과 · 최소21/600→375px에서13.125px
- 전 섹션 시각화 감사: 선언 전달/실패 반응은 SVG2개, 계약·조건·오류 비교는 표4개, 나머지 산문 · 격식체·마침표·반복·근거·자립성과 원본 조건 대조
- 대표 원문: “상한 재조회나 CSINode 갱신이 실패해도 오류를 로그에 남긴 뒤 자원 고갈 판정은 true 로 반환한다.” → 본문: “재조회나 CSINode 갱신에 실패해도 VerifyExhaustedResource는 오류를 로그에 남긴 뒤 고갈 판정을 true로 반환합니다”
- 핵심 미해결/보류: 없음 · 실제 클러스터·드라이버 보고값·cloud 한도·성능/실패 시간은 미측정이며 본문에 이론 근거 범위를 고지
- 전체 lint·build·정적 출력·커밋: 실행 안 함, parent 배치 검증 담당 · 공통 docs/타 작성자 파일 수정 없음


# Batch 17 · StatefulSet과 볼륨 수명 · 작성 인계

- 상태: 본문·SVG·작성자 검증 저장, 독립 검수와 배치 통합 검증 전
- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 4-4 · StatefulSet과 볼륨 수명 · 지우는 대신 주인을 바꾼다.md`
- 정확한 파일명: `Phase 4-4 · StatefulSet과 볼륨 수명 · 지우는 대신 주인을 바꾼다.md`
- 원본 전문 448줄 읽음, SHA-256 `c3265ed8dc64991f64afe8475c0f378fbfc32604c0a12488cdd69bb93602d85d`; 저장 후 다시 대조해 일치
- 대상: `src/content/essays/kubernetes/k8s-theory-statefulset-volume-lifecycle.md`
- 시리즈 `k8s-theory-storage` / order 4 / date `2026-10-23`, tags `kubernetes, statefulset, persistent-volume, concept`
- 수정 범위: 본문 1개·동일 slug SVG 2개·이 임시 폴더만. common docs·원본·타인 변경·build·commit·push 수정/실행 없음

## 기준과 실제 읽은 근거

- `.agents/skills/draft-to-post/SKILL.md` 및 연결된 `.claude/skills/draft-to-post/SKILL.md`, `docs/writing-voice.md`, plan/source-format/SVG 가이드 적용
- 같은 시리즈 `k8s-theory-pvc-storageclass-binding.md` 구조·책임 구분 참조
- 최신 context: progress 1122줄 `c3081510322928d79907275e31e02c0f4708ec606644bed7581006645d1d16f5`, main source-map 123줄 `36cadfdf517ab7a33708be8e867f8b4d303d762e873ddd3c31564b8c77e704ae`, Phase 4 source-map 722줄 `f5acf98a6a57ce6f0bbc4d53b8216ef016c61f21ee790f7060f42076e94fb1d6`
- 현재 source-map 상단의 v1.37 기준과 역사 v1.35 목록을 구분해 읽음. 4-4 관련 절·현재 추가 판정·progress 행 확인. 정확한 경로/해시는 `source-final.json`
- Kubernetes **v1.37.1** tag가 가리키는 commit `f78e722310e50bcaca9276be22276d9e91d91308`; 이전 API evidence `kubernetes-tag.json`의 annotated tag/commit 관계를 확인하여 복사
- website 고정 ref `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
- 공식 파일 16개 확보, URL·SHA-256·크기·재사용 여부는 `manifest.json`. Batch16에서 재사용한 3개는 manifest의 고정 URL/ref 및 bytes hash를 비교해 일치한 뒤 사용
- 현재 라이브 StatefulSet 공식 페이지도 web 도구로 열고, 고정 원본의 관련 절을 직접 대조

| 주장 | 실제 확인한 고정 근거·범위 |
|---|---|
| Pod/PVC 이름·서수 범위·정책 4조합·UID | [stateful_set_utils.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/statefulset/stateful_set_utils.go): `getStartOrdinal`, `getEndOrdinal`, `getPersistentVolumeClaimName`, `getPersistentVolumeClaimRetentionPolicy`, `hasUnexpectedController`, `isClaimOwnerUpToDate`, `updateClaimOwnerRefForSetAndPod`, `hasStaleOwnerRef`, `addControllerRef` |
| PVC 선생성·기존 요청 비갱신·삭제 중 오류·stale 차단 | [stateful_pod_control.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/statefulset/stateful_pod_control.go): 155–173 `CreateStatefulPod`, 275–329 정책·stale, 381–407 PVC 생성 |
| 정책 반영 후 Pod 삭제·정상 순서 | [stateful_set_control.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/statefulset/stateful_set_control.go): `processReplica`, `processCondemned`, 596–630 ordinal 분류, 695–725 condemned PVC 반영→삭제 |
| Retain/Retain API 기본값 | [defaults.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/apps/v1/defaults.go): 127–135, policy nil 객체 생성 및 각 빈 필드 Retain |
| 템플릿 불변·Service 선택 필드 | [validation.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/apps/validation/validation.go): 180–187 ordinal/serviceName, 245–267 immutable fields; [apps types.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/apps/v1/types.go): 241–249 ServiceName `+optional` |
| 기능 단계·실행 게이트 유무 | [단계 표](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/command-line-tools-reference/feature-gates/StatefulSetAutoDeletePVC.md): stable from 1.32; [feature registry](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go) 및 확보한 StatefulSet controller/defaults에서 `StatefulSetAutoDeletePVC` 검색 결과 없음 |
| 정상/강제 삭제·Service·ordering | [StatefulSet 공식 고정본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/workloads/controllers/statefulset.md): Limitations/Identity/Scaling/Parallel/retention; [Pod Lifecycle](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/workloads/pods/pod-lifecycle.md): Forced Pod termination |
| GC·다른 유효 owner·삭제 전파 | [garbagecollector.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/garbagecollector/garbagecollector.go): 559–653 classifyReferences/solid/waiting/default delete; [GC 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/architecture/garbage-collection.md): foreground/background/orphan |
| PVC finalizer는 unmount 완료 통지가 아님 | [pvc_protection_controller.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/volume/pvcprotection/pvc_protection_controller.go): 281–299 삭제후보·finalizer, 381–469 informer→live list·스케줄된 Pod의 직접 PVC 참조 |
| PV reclaim 책임·Released/claimRef UID·접근 모드 | [pv_controller.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/volume/persistentvolume/pv_controller.go): 653–693 UID/Released/Retain, `reclaimVolume`; [PV 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/storage/persistent-volumes.md): protection/reclaim/finalizer/access modes |
| Pod DNS 전제 | [DNS 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/services-networking/dns-pod-service.md): headless Service/subdomain, readiness와 publishNotReadyAddresses, StatefulSet 문서의 negative caching |

## 정정·보존한 조건

1. 원문의 ‘기본값이 helper에 있다’ 설명에 **현재 API defaulting도 채운다**는 근거 추가. 과거 defaulting을 재대조하지 않았으므로 새 버전에서 바뀐 사실로 표현하지 않음
2. 현재 website retention 절 461–465에도 `StatefulSetAutoDeletePVC`를 켜라는 문구가 남음. 현재 코드 registry/실행 분기와 구분해 본문은 게이트 설정 없이 처리하는 실제 v1.37.1 동작만 설명
3. `isClaimOwnerUpToDate` 위 주석 245–255는 Delete/Delete에 ‘both set and pod’라고 요약하지만 실제 switch 300–309 및 updater 349–356은 **범위 안=StatefulSet, 범위 밖=Pod**. 본문 표·SVG는 실제 분기를 따름
4. 문서의 condensed ‘id greater than replica count’를 그대로 옮기지 않고 `start .. start+replicas-1` 판정으로 보존. start 변경으로 범위 밖이 된 Pod도 condemned 처리
5. 원문의 소유 관계·UID 예외 보존: stale 같은 이름/다른 UID는 `isClaimOwnerUpToDate`가 건드리지 않으며, foreign controller에는 임의 인수 대신 자기 set/Pod 참조 정리 경로가 존재. 표는 충돌 없는 정상 상태의 정책 참조만 의미
6. `PodClaimIsStale`: whenScaled Retain이면 차단 안 함, Delete이면 이전 Pod UID 참조를 가진 PVC 재사용을 기다림. PVC가 존재한다는 사실만으로 새 Pod 생성 허용하지 않음
7. 정상 reconcile의 참조 반영→Pod 삭제 순서를 강제 삭제/컨트롤러 중단/orphan에도 보장하는 것으로 확대하지 않음. GC/PVC 보호는 실제 unmount 완료 증거가 아님
8. Parallel의 스케일 대기 해제와 rolling update 동시성 설정을 분리. StatefulSet 자체 삭제는 OrderedReady여도 Pod 종료 순서 보장 없음
9. PVC 보존과 PV reclaim/finalizer/백업 책임 구분. 외부 sidecar의 CLI·버전별 동작은 새로 추가하지 않음
10. volumeClaimTemplates API 불변·기존 PVC 비갱신·ServiceName 선택 필드와 DNS 전제 보존. 내부 Phase, 학습 종료 판정, 미실행 LAB TODO는 본문에서 제거

## 실제 검증

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-statefulset-volume-lifecycle.md`: exit 0, **error 0 / warn 1** (`lint-post.log`)
- 문장길이 경고 11곳: 고정 근거 URL·내부 글 URL이 포함된 줄. 일반 장문을 분리한 뒤 남은 링크 설명의 의미·근거 보존을 위해 유지
- `git diff --check`: exit 0
- SVG 2개 Python XML parse 통과, text node 각각 10/15개, 최소 글자 23px. role/title/desc/aria, 평탄 경로·번호·원본 관계·화살표별 독립 path 확인
- 기존 lock/install의 sharp **0.34.5**로 800/375px PNG 각 2장 생성. 네 렌더를 실제 육안 확인했고 SVG2 팔레트 정리 후 최종 800/375 두 장 재확인: 글자 잘림·겹침·화살표 누락 없음
- SVG1은 서로 다른 시점의 Pod가 보존된 한 PVC에 대응하는 그림. SVG2는 Delete/Delete 스케일다운의 처리 주체와 PVC→PV 정책 경계를 나타냄
- 원본 전문 대조·격식체·말투·근거·반복·내부 맥락·전 섹션 시각화 판단 재검토. 기술적 관계 2장은 SVG, 이름/정책/결과/진단은 표 4개, 나머지는 산문
- 정확한 최종 본문·SVG SHA-256은 `content-final.json`, 최종 원본·context는 `source-final.json`
- **미실행:** 클러스터 LAB/실측, 전체 lint/build/export. 배치 통합 검사·별도 reviewer·진행표·커밋은 parent 담당

## 대표 문장·선택지·잔여 사항

- 원문: ‘기본 `Retain`에서는 StatefulSet의 삭제 정책 때문에 PVC가 함께 지워지지 않는다’
- 변환: ‘두 필드는 각각 `Retain` 또는 `Delete`를 사용하며 기본값은 모두 `Retain`입니다’ + ‘다만 다른 사용자가 PVC를 직접 삭제하는 것까지 막는 정책은 아닙니다’
- 원문의 Deployment 대체 가능성 질문을 조건 비교 절로 보존. 복제본 신원/PVC 대응 기준과 공유 캐시 반례만 유지했으며 가상의 제품 선택·개인 경험은 추가하지 않음
- 보류/핵심 근거 부족 없음. 실제 스토리지·클러스터 설치 버전·DNS 결과는 확인하지 않았으며 실행 경험으로 서술하지 않음


## 별도 blog-reviewer 검수

# Review: 3 files · Batch 17

- 최종 판정: 필수 수정 0건 / 확인 필요 0건 / 권장 0건
- 검토 범위: 본문 3개, SVG 6개, 정확한 Vault 원본 3개 전문
- 기준: draft-to-post 공동 절차, docs/writing-voice.md, k8s-theory-series plan/source-format, SVG 가이드
- 콘텐츠·SVG·공통 문서 수정 없음. build·commit 실행 안 함(배치 통합 검증은 parent 담당)

## P0 위반 (즉시 수정 필요)

- 없음

## P1 확인 필요·권장

- 없음

## P2 참고·경고 판정

- 최초 개별 검사 및 최종 `npm run lint:post -- <3개 대상>` 실제 실행: exit 0, error 0 / warn 5. 원시 결과: `review-lint.log`
- StatefulSet: warn 1, 100자 초과 11줄. 고정 근거 URL·내부 링크와 조건 설명을 문맥 검토해 수용
- 확장·스냅샷·임시 볼륨: warn 1, 100자 초과 17줄. 메타·alt·근거 링크 및 기술 조건을 문맥 검토해 수용
- 볼륨 한도: warn 3, 100자 초과 15줄 + SVG text 18/20개. 실제 375px에서 한글·영문 식별자·화살표가 읽히고 잘림·겹침이 없어 수용
- SVG 6개를 sharp로 800/375px 각각 재렌더링하고 PNG 12개를 모두 직접 열어 육안 확인. `reviewer-render/inputs.json`의 SVG 해시와 최종 해시 일치
- role/title/desc XML 검사, 경로·메타·slug 유일성·storage order 4/5/6·essays 트랙 일치 확인. 한글 SVG 라벨은 계획 기준에 부합
- 대상 `git diff --check`: exit 0

## 원본·기술·문체 대조

- 원본 448/677/567줄 전문과 실제 SHA-256을 `sources.json`에 대조해 일치. 원본의 조건·질문을 보존했고 미실행 LAB·개인 경험·성능 수치를 실행 사실로 추가하지 않음
- 공식 고정 근거 캐시 87개 파일의 SHA-256 일치. external-resizer의 잘못 추정한 경로 404 1건은 성공 근거에서 제외. 상세 URL/로컬 경로/해시: `reviewer-evidence-checks.json`
- StatefulSet: API defaulting의 Retain 보완은 원본 누락으로 다루며 버전 변경으로 주장하지 않음. live website의 gate 활성화 문구와 현행 registry/controller를 구분
- StatefulSet: Delete/Delete 실제 switch의 범위 안 StatefulSet / 밖 Pod 소유 참조, stale UID·foreign controller·참조 반영 후 Pod 삭제·강제 삭제·PVC 보호·PV 회수의 조건을 대조. 상단 요약 주석의 both 표현을 구현 사실로 옮기지 않음
- 확장: resize admission과 PVC update 예외·요청 감소의 엄격한 status 하한, capability·node-only trivial resizer·stage/publish 이후 NodeExpand·Block·RWX·ONLINE/OFFLINE·Infeasible slow retry를 대조
- 스냅샷: CRD scope·Content 생성/바인딩과 CSI 호출·복원 주체·readyToUse 조건, addon v8.6.0/외부 v8.7.0·approval /955와 /814 차이 확인. 본문은 승인 URL을 일괄 단정하지 않음
- 임시 볼륨·VAC: 생성 시 Pod UID ownerRef·이름 충돌·권한·쿼터·정리 실패와 회수 정책, core GA true 잠금/sidecar gate 구분·MODIFY_VOLUME·InvalidArgument 분류를 대조
- 볼륨 한도: CSI 0/음수와 CSINode nil/0, 기존 Pod·VolumeAttachment·새 요구의 중복 제거 범위 및 VA-only 이중 계상, attached status 비필터링, VolumeLimitScaling 옵트인·Mutable GA 잠금·주기 설정 조건 확인
- 고갈 경로: 대기 실패 뒤 미부착 볼륨·VA 숫자 코드 8 확인 → 동기 NodeGetInfo/CSINode 갱신 시도 → Pod Failed 순서. 갱신 실패에도 고갈 true를 반환하는 경로와 컨트롤러의 대체 Pod 생성을 구분
- 격식체·자연스러움·자립성·과장·반복·기존 storage 글과 연결을 문맥으로 검토. 표·그림 개수나 설명 문단 수 할당 없이 판단

## 직접 확인한 주요 공식 근거

- [StatefulSet 소유 참조 구현](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/statefulset/stateful_set_utils.go), [API 기본값](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/apps/v1/defaults.go), [현재 StatefulSet 문서](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/#persistentvolumeclaim-retention). 캐시: `statefulset/{kubernetes,website}/`
- [PVC 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go), [resizer 생성](https://github.com/kubernetes-csi/external-resizer/blob/baa08e6d8773f167dbddce36579f36d84bbe3fde/pkg/resizer/csi_resizer.go), [확장·복구](https://github.com/kubernetes-csi/external-resizer/blob/baa08e6d8773f167dbddce36579f36d84bbe3fde/pkg/controller/expand_and_recover.go), [현재 VAC 문서](https://kubernetes.io/docs/concepts/storage/volume-attributes-classes/). 캐시: `expansion/{kubernetes,kubernetes-csi,container-storage-interface}/`
- [볼륨 상한 Filter](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/nodevolumelimits/csi.go), [고갈 확인](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/csi_plugin.go), [현재 한도 문서](https://kubernetes.io/docs/concepts/storage/storage-limits/). 캐시: `limits/{kubernetes,external}/`

## 요약

- P0 0건 / P1 확인 필요 0건·권장 0건 / P2 미해결 0건
- 검토 본문 3개·SVG 6개, 레거시 제외 0개. 보류 없음
- 최종 검토 저장본 9개 해시: `review-hashes.json` (상대 경로 → SHA-256 평면 매핑)
- 클러스터 확장·스냅샷·삭제·드라이버 장애 LAB/실측 실행 안 함. 이 검토는 로컬 콘텐츠·공식 근거·이미지 확인이며 통합 build 성공을 의미하지 않음


## 실제 최종 검증

- `npm run lint:post -- <대상 3편>`: exit 0, error 0 / warn 5
- `npm run lint`: exit 0, error 0 / warn 1 (기존 `src/app/layout.tsx:80` custom font 경고)
- `npm run build`: exit 0, TypeScript·정적 생성·postbuild 성공, 646 pages
- 원본 SHA-256·검수한 최종 글/SVG와 빌드 입력 hash 일치
- slug 유일성·시리즈 order 연속성·내부 링크·이미지 실존·SVG XML/접근성 메타 검사 통과
- 실제 `getAllPosts`·`getEssaysList`·`getSearchIndex` 실행: 3편 모두 essays 등록, 목록·검색에 content 없음
- HTML 3개·SVG 6개 export·`/my-blog/diagrams/` 참조·SVG 바이트 일치
- sitemap·llms 반영, RSS는 최신 20편 정책·실제 출력 일치
- `git diff --check` 통과, prebuild의 이번 CLAUDE.md 자동 통계 변경만 복원
- Node `DEP0205 module.register()`·TS 직접 import의 `MODULE_TYPELESS_PACKAGE_JSON` 경고는 범위 밖 설정을 바꾸지 않고 유지
- 새 의존성·클러스터 실습·통합 실험·성능 실측·push·배포·시리즈 카드 등록: 실행 안 함

원시 로그·근거 캐시: `/tmp/k8s-batch17/`
공식 URL/ref와 주요 정정은 위 기록과 글에 보존했다

## 다음 대상

- `Phase 4-7 · 용량 기반 스케줄링 · 모르면 없다고 치지만 안 켜면 묻지 않는다.md` → `k8s-theory-storage-capacity-scheduling` (`k8s-theory-storage` / 7)
- `Phase 5-1 · CRD 구조 · 선언한 만큼만 존재한다.md` → `k8s-theory-crd-schema-pruning` (`k8s-theory-extension` / 1)
- `Phase 5-2 · CRD 버저닝과 conversion · 저장은 한 벌뿐이고 나머지는 그때 만든다.md` → `k8s-theory-crd-version-conversion` (`k8s-theory-extension` / 2)
