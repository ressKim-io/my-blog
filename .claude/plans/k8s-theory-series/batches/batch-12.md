# Batch 12 인계 — 2026-10-23

3편 검수 완료, SVG 6장. 콘텐츠 커밋 `3c62d6a`
이번 요청 누적 18/30편, 전체 시리즈 누적 44편

## 원본·결과 대응

원본 루트: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/`
읽기 전용으로 사용했으며 작업 전후 hash 일치를 검증했다
작성 기준일은 2026-10-23이며 학습일·배포일을 뜻하지 않는다

| 좌표 | 원본 파일 | 줄 수 | SHA-256 | slug | series / order |
|---|---|---:|---|---|---|
| 2-18 | `Phase 2-18 · 임시 컨테이너와 ephemeralcontainers · 더하기만 되는 문은 아무것도 바꾸지 못한다.md` | 669 | `ebf825373d337c7a02e22d23455c30700ef0d1cffef44a9d002215ca607392dc` | `k8s-theory-ephemeral-containers` | `k8s-theory-node` / 19 |
| 3-1 | `Phase 3-1 · CNI spec · 만들지 않고 요구만 한다.md` | 528 | `ec23f14a97e096de019c0982c4a723391ee918c9b9a1a5605502e42cedce28c5` | `k8s-theory-cni-contract` | `k8s-theory-network` / 1 |
| 3-2.1 | `Phase 3-2.1 · sandbox 와 pause (1) · 주소는 컨테이너가 아니라 그 옆에 붙는다.md` | 471 | `2170a207c16d4cba0a77580bccba2f398dbc6b771e7a952a6413389225ed657f` | `k8s-theory-pod-sandbox-pause` | `k8s-theory-network` / 2 |

글 경로는 `src/content/essays/kubernetes/{slug}.md`, SVG는 `public/diagrams/{slug}-{n}.svg`다

## 작성자의 근거 대조·편집 기록

아래는 작성 단계의 기록이다. 이후 보완·정정은 별도 검수와 지적 반영 기록을 우선한다

# Batch 12 · Phase 3-1 작성 인계

- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 3-1 · CNI spec · 만들지 않고 요구만 한다.md`
- 2026-10-23 최신 528줄 전문 읽음. SHA-256 `ec23f14a97e096de019c0982c4a723391ee918c9b9a1a5605502e42cedce28c5`, sources.json과 실제 파일 일치
- 최신 progress 현행 후속 판정 및 3-1 예약 해소, source-map Phase 3의 3-1 본절·v1.37 대조·외부 조합 한계 확인. progress SHA `c3081510322928d79907275e31e02c0f4708ec606644bed7581006645d1d16f5`, source-map Phase 3 SHA `0458c79aa9dd7996a03d7babffc63068c5c3b5a7b16bc6906fc690b920f651bd`
- 글: `src/content/essays/kubernetes/k8s-theory-cni-contract.md`, 256줄. series `k8s-theory-network` / order 1 / date 2026-10-23
- tags: Kubernetes, CNI, containerd, IPAM, Networking, concept
- SVG 2개: 같은 slug의 `-1.svg`는 CRI·런타임·CNI·IPAM·상태 보고, `-2.svg`는 ADD 누적과 DEL 역순의 prevResult 차이. 원본 ASCII 4개를 2개로 통합, 별도 신규 주제 그림 0개. 표 5개
- draft-to-post 진입점/공동 절차·voice·plan/source-format·SVG 기준 적용. CRI/OCI 기존 글과 같은 network 시리즈의 작성된 sandbox/pause 글 도입·호출 경계 참조. 공통 문서·타인 파일 수정, commit/build/push 실행 안 함

## 버전 정합성과 실제 확인 근거

GitHub 공식 latest release API와 tag commit을 먼저 조회하고 containerd 고정 go.mod를 읽었다. 아래 외부 버전은 현재 latest와 containerd v2.4.2의 직접 의존 버전이 일치한다. 실제 노드의 설치 판정은 아니다

| 프로젝트 | 확인 버전 | 고정 ref |
|---|---|---|
| Kubernetes | v1.37.1 | `f78e722310e50bcaca9276be22276d9e91d91308` |
| website | 공식 저장본 | `7fde177e22dc98390a6d55d215dd0301b5f6d0bb` |
| containerd | v2.4.2 | `b7a25261e029d68978bbf290df0a62fc819b3c51` |
| containerd/go-cni | v1.1.14 | `8c8d2ad0f236a8fa1084314d97c5204af8b98d24` |
| containernetworking/cni | v1.3.1 | `3f51e8803ebbdba0ebeed735b42137e4c7302403` |
| containernetworking/plugins | v1.9.1 | `adc3e6b5b581638afbd194cf2e9319ecbb0151a1` |

CNI v1.3.1의 SPEC.md와 version.Current()가 정의하는 실행 규격은 spec 1.1.0이다. go-cni/plugins 자체 go.mod는 CNI v1.3.0을 요구하지만 containerd는 v1.3.1을 직접 선택한다. containerd 쪽 실행 경로를 v1.3.1로 대조한 것과 독립 배치 플러그인 실행 파일의 실제 링크 버전은 다르다. 라이브러리 릴리스 번호·프로토콜 버전·설치 실행 파일 버전을 분리했다. `external-refs.json`과 프로젝트별 release API 응답, containerd/go.mod(SHA `160493ce61c5b7a0639dcc4dc3cba19958384db3dd51d63c5e7b087d67e687cc`) 보존. writer_c에도 동일 ref·규격 조건과 namespace/CNI 호출 순서를 공유했다

공식 자료 40파일을 확보해 본문 기전에 해당하는 심볼·절을 대조했고 `manifest.json` 33개·`manifest-extra.json` 5개·`manifest-nodeipam.json` 2개에 URL/hash를 보존했다. 최종 40/40 hash 일치, 다운로드 404 없음

- https://github.com/containernetworking/cni/blob/3f51e8803ebbdba0ebeed735b42137e4c7302403/SPEC.md — 통신 대상·실행 환경, CNI_*·stdin/결과, ADD/DEL/CHECK/STATUS/VERSION/GC 본절, chain/prevResult, IPAM 전체 설정 위임, namespace·실패 시 DEL·결과 보관 책임
- https://github.com/containernetworking/cni/blob/3f51e8803ebbdba0ebeed735b42137e4c7302403/libcni/api.go — AddNetworkList/cacheAdd·CheckNetworkList·DelNetworkList·GCNetworkList·GetStatusNetworkList, 버전별 동작. `pkg/invoke/{args.go,exec.go,raw_exec.go}`, `pkg/skel/skel.go`, `pkg/version/version.go`도 대조
- https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/go.mod — go-cni/CNI/plugins 실제 핀. 해당 프로젝트 go.mod도 함께 읽음
- https://github.com/containerd/go-cni/blob/8c8d2ad0f236a8fa1084314d97c5204af8b98d24/cni.go — Setup/Remove/Status·공개 인터페이스. `opts.go`는 .conf/.conflist/.json 정렬·개수·파싱 오류 처리, `namespace.go`는 Add/DelNetworkList 연결, `errors.go`는 초기화 오류 문구
- https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/server/sandbox_run.go — netns 준비 뒤 setupPodNetwork·Setup/SetupSerially, 호출 전 실패 정리 defer. `sandbox_stop.go`의 teardownPodNetwork→Remove와 netns 정리 대조
- https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/server/status.go — 기본 네트워크 Status 결과→NetworkReady, reason/message 생성. `docs/cri/config.md`와 `internal/cri/config/config.go`에서 현재 config namespace·bin_dirs/conf_dir/max_conf_num 확인
- https://github.com/containernetworking/plugins/blob/adc3e6b5b581638afbd194cf2e9319ecbb0151a1/plugins/main/bridge/bridge.go — ExecAdd/Del/Status·등록된 콜백과 GC FIXME. `pkg/ipam/ipam.go`, README의 host-local DB·dhcp 데몬 대조
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kubelet.go — updateRuntimeUp의 오류 포장·SyncPod의 hostNetwork 예외, `nodestatus/setters.go`의 ReadyCondition 연결
- `kuberuntime/kuberuntime_sandbox.go`, `kuberuntime_manager.go`, `container/runtime.go`, `metrics/metrics.go`, `errors.go` — RunPodSandbox·주소 수신/파싱·조건·오류 문구·첫 네트워크 Pod INTERNAL 지표. `controller/nodeipam/ipam/range_allocator.go`는 Node podCIDRs 배정·PatchNodeCIDRs 대조
- https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/services-networking/_index.md — 의도적 분리 조건을 포함한 모델과 외부 구현 책임. Network Plugins·Network Policies 공식 저장본도 실제 읽음

## 원본 대비 정정·한정

1. 원본의 spec 1.1.0·plugins 1.6.2·go-cni 1.1.11·containerd main 혼합 대신 현재 확인한 containerd 실제 의존 조합을 사용했다. 어느 릴리스 최초 지원인지는 추가 추정하지 않고 현재 지원 경로로 설명
2. 원본의 main 기반 STATUS 조합 미확인은 현재 고정 조합으로 닫았다. containerd Status→go-cni Status→libcni GetStatusNetworkList를 읽었고 설정 cniVersion<1.1.0이면 STATUS는 호출하지 않음을 명시
3. 고정 SPEC의 Parameters/operations 요약에는 5명령만 적혀 STATUS가 빠지지만 STATUS 본절이 존재한다. 표는 실제 여섯 명령 본절과 libcni/skel 분기를 기준으로 썼다. 규격에 동사가 있는 것과 콜백·자동 호출 지원을 구분
4. SPEC 실행 개요는 실패를 stderr로 적은 반면 STATUS 본절·결과 절 및 skel/RawExec는 stdout 오류 JSON을 사용한다. 본문은 실제 stdout 오류 JSON·종료 코드·stderr 진단 경로를 대조해 설명했다
5. 명령별 환경 변수 필수 여부를 모두 같게 쓰지 않았다. DEL에서 namespace가 없어도 가능한 정리를 수행하고 반복 DEL과 사라진 인터페이스를 받아들이는 조건, 실패 ADD에도 대응 DEL을 요구하는 책임을 보존했다
6. ADD는 직전 결과 누적, DEL 역순·CHECK 순방향에서는 같은 마지막 ADD 결과 전달. libcni는 체인 성공 후 결과 파일 저장, DEL에서 캐시를 못 읽으면 빈 결과로 시도. IPAM은 런타임 체인과 달리 상위 플러그인이 전체 설정/환경으로 호출함
7. spec GC를 자동 회수 보장으로 바꾸지 않았다. libcni에는 GCNetworkList가 있지만 go-cni 공개 인터페이스에는 별도 GC 메서드가 없으며 bridge 등록부는 GC 미구현. STATUS 지원과 GC 자동 실행을 묶지 않음
8. max_conf_num은 플러그인 개수가 아니라 설정 파일 개수다. 파일 이름 순은 loader 규칙이며 잘못된 설정에서 오류를 반환한다. 기본 TOML schema의 io.containerd.cri.v1.runtime.cni와 bin_dirs 복수형 확인
9. network namespace를 런타임이 먼저 준비하고 그 후 플러그인이 구성한다. 실제 containerd의 CNI 호출은 sandbox 실행보다 앞이며 writer_c의 다음 편과 정합성을 확인했다
10. NetworkPolicy 미지원 효과 없음은 보존하되 모든 환경에서 경고·오류가 절대 없다는 단정은 제거했다. hostNetwork는 이 준비 검사 예외일 뿐 전체 시작 성공 보장이 아님
11. 첫 네트워크 Pod 지연을 CNI 미준비의 확정 증상으로 쓰지 않았다. 지표의 image pull/init 제외·INTERNAL 범위와 원인 미확정 조건을 남김. NodeIPAM의 Node 대역과 CNI IPAM의 주소 할당도 구분
12. 원본 CSI 비교는 CNI가 attachment를 다룬다는 작업 범위 설명으로 축약했다. 별도 CSI 동사/API나 미검증 설계 이유를 추가하지 않음. 학습 등급·자가 판정·미실행 LAB·편집 경위·개인 경험은 본문에서 제외

## 대표 문장

원문: “containerd가 쓰는 go-cni의 Status()는 설정이 로드됐는지를 먼저 보고, 그다음 각 네트워크에 CNI STATUS를 부른다. main 브랜치에서 확인했다. 어느 containerd 릴리스부터 그런지는 확인 못 했다”

변환: “go-cni v1.1.14의 Status는 설정 로드 상태를 먼저 확인한 뒤 libcni의 GetStatusNetworkList를 호출합니다 / 이 함수는 설정의 cniVersion이 1.1.0 미만이면 STATUS 실행 없이 성공을 반환합니다”

이유: 원본의 버전 한계를 현재 실제 의존 조합으로 확인하고, 사양 버전 조건을 빠뜨리지 않도록 한정했다

## 검증·남은 문제

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-cni-contract.md` 최종 실제 실행 exit 0, error 0 / warn 1. 긴 줄 27곳은 고정 URL·조건을 문맥 검토 후 보존. `lint-post.log`
- SVG 2개 XML 파싱·title/desc·한글 라벨·참조 실존 확인. 최소 20px / 560폭, 375폭 명목 최소 13.39px. 원본/모바일 sharp PNG 렌더 후 육안 검사, 잘림·겹침 없음. 체인 그림의 중복 라벨을 덜어 text 19→16개로 정리해 SVG 경고 해소
- 전 섹션 시각화 재검토: 책임 흐름/IPAM 위임은 SVG1, 체인 방향·결과 전달은 SVG2, 버전/입출력/명령/설정/오류는 표, 조건·정리 책임은 산문. 표·본문 중복과 긴 결론을 줄임
- 원본·문체·과장·미확인 단정·경험 창작·끝마침표 문맥 점검. 내부 링크 1개·이미지 2개 대상 확인, 문단 끝 마침표 0. `output-checks.json`에 글·SVG hash와 소스 40파일 hash 점검 결과 기록
- Decision section 미포함: 선택지 검토 경험이 없는 계약·기전 해설
- 핵심 근거 부족 보류 없음. 실제 설치 플러그인 버전·노드 출력·정리 무손실·개별 구현의 GC 자동 실행은 검증하지 않았으며 본문도 보장하지 않음. spec 요약/오류 출력 설명의 불일치는 위와 같이 실제 본절·실행 코드로 판정
- 전체 lint·build·정적 출력·독립 reviewer 실행 안 함. 별도 검수·통합 검증 대기이며 작성 결과를 먼저 완료 편수에 포함하면 안 됨


# Batch12 · 2-18 임시 컨테이너 작성 보고

- 글: `src/content/essays/kubernetes/k8s-theory-ephemeral-containers.md`
- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 2-18 · 임시 컨테이너와 ephemeralcontainers · 더하기만 되는 문은 아무것도 바꾸지 못한다.md`
- 669줄 전문 확인, SHA-256 `ebf825373d337c7a02e22d23455c30700ef0d1cffef44a9d002215ca607392dc`
- `k8s-theory-node` / order 19 / date 2026-10-23, essays/kubernetes
- 최종 본문 292줄, SHA `f3e87288b3a1a18c3c8ed53806b9fbe40b6ef91e969dec8b8ecfb58821eb383b`
- SVG 2개 / 표 6개. 선택지 비교는 KEP의 본체 update 대안·서브리소스 분리를 해당 소절에서 문단으로 포함. 개인 선택·가상 대안은 추가하지 않음
- 스킬 진입점·공동 draft-to-post·decision-tradeoff, voice, plan/source-format, SVG 기준 적용. 같은 시리즈 kubelet-pod-lifecycle 글을 읽고 연결 대조

## 최신 원본 맥락

- progress 1122줄, SHA `c3081510322928d79907275e31e02c0f4708ec606644bed7581006645d1d16f5`
- source-map 123줄, SHA `36cadfdf517ab7a33708be8e867f8b4d303d762e873ddd3c31564b8c77e704ae`
- source-map Phase 2 2189줄, SHA `79c08e1759c80a6efc16cde0efd1af227addd3eece6dffd3fd657af6f75c18fe`
- 기존 v1.35 학습 기록, v1.37 `8aaeb4e...` 정정, 이번 블로그의 v1.37.1 실제 대조를 구분
- source-map의 비동기 API 저장/실행 경계·현행 SyncPod 순서를 반영. 과거 progress의 ‘phase는 안 움직인다’는 문장을 모든 간접 영향 부재로 확대하지 않음
- 정확한 원본/출력/context 해시와 XML 정보는 `source.json`, 실제 수집 URL·hash는 `manifest.json`·`manifest-extra.json`

## 확인한 고정 근거

- Kubernetes·kubectl v1.37.1 `f78e722310e50bcaca9276be22276d9e91d91308`
- website `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
- KEP-277 `kubernetes/enhancements@0c8d11e9a13e12d2ef75d2d78af5ac00d8189046`
- [현행 Ephemeral Containers](https://kubernetes.io/docs/concepts/workloads/pods/ephemeral-containers/)와 [Debug Running Pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/)를 웹에서 확인하고, 해당 고정 website 원문 및 namespace 공유 문서를 실제 읽음

| 주장 | 실제 읽은 소스·결과 |
|---|---|
| 별도 경로·verb·기존 Pod만 갱신 | [`storage_core.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/rest/storage_core.go)의 등록, [`EphemeralContainersREST`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/pod/storage/storage.go)의 Patcher/Get/New/Update, forceAllowCreate=false |
| 요청 범위·metadata·generation | [`strategy.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/pod/strategy.go) dropNonEphemeralContainerUpdates·PrepareForUpdate·GetResetFieldsFilter·updatePodGeneration. [`ResetObjectMetaForStatus`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/apis/meta/v1/helpers.go)의 metadata 복원·managedFields 예외 |
| 추가/수정/삭제·필드·이름 검증 | [`validation.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go) ValidatePodCreate·ValidatePodUpdate·ValidatePodEphemeralContainersUpdate·ValidateEphemeralContainerStateTransition·allowedEphemeralContainerFields·validateEphemeralContainers·validateFieldAllowList. 이름별 기존 항목 semantic equality, 순서 무관, mirror 거부, 9개 금지 공통 필드·subPath/Expr 금지·타입 간 이름 유일성·비임시 target 확인 |
| PID namespace 선택·런타임 경계 | [`getTargetID`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_container.go), [`generateLinuxContainerConfig`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_container_linux.go), [`PidNamespaceForPod`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/util/util.go), [`CRI NamespaceOption`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cri-api/pkg/apis/runtime/v1/api.proto). CONTAINER일 때만 PID TARGET, POD/NODE 유지, IPC는 POD/NODE. 명세 이름과 런타임 상태 ID 조회는 별도 |
| 실행 순서·재시작 | [`kubeGenericRuntimeManager.SyncPod/computePodActions`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_manager.go). **동일 함수의 총 9단계 중 ephemeral 7·init 8·일반 9**. ‘7단계 함수’라는 뜻이 아님. sandbox 재생성 시 조기 반환, 같은 이름 런타임 상태가 없을 때만 시작 목록. [`FindContainerStatusByName`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/container/runtime.go), GC 이름별 보관·기본 최대1개도 확인 |
| 상태·QoS·probe·자원 | [`generateAPIPodStatus`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kubelet_pods.go), [`조건 계산`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/status/generate.go), status_manager.go·prober_manager.go의 일반/init 대상, [`ComputePodQOS`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/v1/helper/qos/qos.go), [`EphemeralContainer API 주석`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/core/v1/types.go)의 실행·자원 보장 부재와 축출 가능성. 직접 집계 제외와 실제 자원 소비를 구분 |
| 별도 권한의 설계 이유 | [`KEP-277 Requiring a Subresource/Updating a Pod`](https://github.com/kubernetes/enhancements/blob/0c8d11e9a13e12d2ef75d2d78af5ac00d8189046/keps/sig-node/277-ephemeral-containers/README.md). 본체 update로 구현 단순화 대안을 검토했지만 독립 RBAC 통제가 필요. 역사 설계를 현행 API 검증 근거와 혼합하지 않음 |
| kubectl 추가와 복사·프로파일 | [`debug.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kubectl/pkg/cmd/debug/debug.go) Run·visitPod·debugByEphemeralContainer·generateDebugContainer·debugByCopy·generatePodCopyWithDebugContainer·Validate·profile flag. 기존 Pod에는 strategic merge PATCH/ephemeralcontainers, copy-to는 새 Pod Create/임시 목록 비움, --target 비호환·share-processes·replace 삭제 경계 |
| 실제 프로파일·정책 재평가 | [`profiles.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kubectl/pkg/cmd/debug/profiles.go): general ephemeral은 SYS_PTRACE, restricted 제한, sysadmin 대상 privileged. [`PSA isSignificantPodUpdate`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/pod-security-admission/admission/admission.go)와 policy/visitor.go의 임시 항목 순회 확인 |

## 정정·보존

1. 원본 v1.35의 총8단계/ephemeral6 대신 v1.37.1 **총9단계/ephemeral7**을 사용. kubelet 전체 메서드와 runtime manager 메서드를 섞지 않음
2. 현행 kubectl flag의 기본 `--profile=general`을 확인. 고정 website 작업 문서의 `legacy` 기본 표기는 차이로 명시했으며 실제 설치된 CLI 버전은 추정하지 않음
3. ‘원래 컨테이너 불변’은 **이 서브리소스 요청에서 기존 명세를 복원한다는 범위**로 한정. 다른 API 변경·실행 프로세스/공유 자원 영향까지 부정하지 않음
4. 요청 성공과 실행 성공, 명세 target 존재와 런타임 ID 존재, PID 공유와 Unix 접근 권한을 각각 구분
5. 재시작 정책 지원을 일반 컨테이너에서 임시 컨테이너로 확대하지 않음. 9개 금지 공통 필드·subPath 예외·Pod status의 별도 종료 전이 검증 보존
6. 상태·QoS 직접 집계 제외를 OOM·축출·sandbox 간접 영향 부재로 단정하지 않음. 자원 그림은 Linux Pod cgroup 범위로 명시
7. kubectl debug의 조회/attach·추가 요청·프로파일·copy-to 새 Pod 생성·replace 삭제 경계를 설명. profile을 RBAC/PSA 승인으로 표현하지 않음
8. LAB·종료 판정·원본 내부 좌표·편집 기록은 본문에서 제외. 실제 실행/실측·가상 경험·결과 출력 없음

## 실행한 검사

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-ephemeral-containers.md` → **error 0 / warn 1**, 긴 줄 25곳 검토. 실제 원시 결과 `lint-post.log`
- SVG 2개 XML parse 통과, role/title/desc 있음, text 15·13개, 최소 font-size 22·21px. 한글 라벨·기술 용어 원어
- `sharp` → 1번 800×1200·375×563, 2번 800×649·375×304 PNG 생성. 모두 `view_image`로 최종 육안 확인, 한글 정상·잘림/겹침 없음
- 전 섹션 시각화 재검토 → 요청·저장·실행 흐름과 상태 집계/자원 소비 구조를 SVG로 표현, 나열·판별은 표. 중복 ASCII 없음
- 원본 전문·핵심 출처·최종 글 대조 및 voice의 조건·근거·반복·자립성 검토
- `git diff --check` 통과
- **전체 lint·build·정적 출력·독립 reviewer·commit 실행 안 함**. 부모가 배치 검증 수행

## 원문 → 변환 대표 문장

원문: “요청 저장과 컨테이너 실행은 서로 다른 단계다”

변환: “API 저장 뒤 kubelet이 명세를 처리하는 시점은 별도입니다”

저장 성공이 즉시 실행을 보장하지 않는 원본의 경계를 formal 문체로 보존했습니다

## 남은 문제

- 핵심 근거 미확인·보류 사항 없음. 클러스터 실제 PID 공유·PSA 거부·상태 전이·자원 압박은 실행하지 않았고 본문에서도 실측으로 표현하지 않음
- upstream debug 문서의 legacy 기본 표기와 v1.37.1 kubectl general 기본의 차이는 남으며, 본문에 버전·경로를 구분해 명시
- 독립 reviewer 및 배치 전체 lint/build/export 통과 전에는 완료 편수 확정 불가
- 공통 plan/README·다른 글·원본 Vault 수정 없음. commit/build 실행 없음


# Batch 12 · 3-2.1 작성 인계

- 원본 `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 3-2.1 · sandbox 와 pause (1) · 주소는 컨테이너가 아니라 그 옆에 붙는다.md`, 최신471줄 전문 대조
- SHA256 `2170a207c16d4cba0a77580bccba2f398dbc6b771e7a952a6413389225ed657f` 재검증, 관련 progress·source-map Phase3의3-2 및v1.37정정 확인
- 출력 `src/content/essays/kubernetes/k8s-theory-pod-sandbox-pause.md` 218줄, SVG2장·표3개
- series `k8s-theory-network` / order2 / date2026-10-23, tags Kubernetes·PodSandbox·pause·NetworkNamespace·CNI·concept
- draft-to-post 진입·공동 절차, writing-voice, plan/source-format, SVG 기준 적용. 기존 CRI/OCI·runtime-isolation 및 새 CNI1편과 조건 대조. 원본·공통 문서·다른 글 수정 없음

## 확인한 버전과 근거

Kubernetes v1.37.1 `f78e722310e50bcaca9276be22276d9e91d91308`, website `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`. `manifest.json`의 공식 고정 소스26개 수신·SHA256 확인

- [CRI api.proto](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cri-api/pkg/apis/runtime/v1/api.proto): RunPodSandbox 성공 ready, NamespaceMode, hostNetwork에서 무시하는 sandbox network status
- [namespace 모드·PodSandboxChanged](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/util/util.go), [조건 생성](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/status/generate.go), [기능 gate](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go)
- [sandbox 요청·IP 파싱](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_sandbox.go), [SyncPod](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_manager.go), [환경변수·hosts·hostNetwork IP](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kubelet_pods.go), [network 준비 차단](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kubelet.go)
- [pause.c](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/build/pause/linux/pause.c): 시그널 대기·종료·SIGCHLD/waitpid
- [containerd RunPodSandbox·CNI setup](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/server/sandbox_run.go), [netns bind mount](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/pkg/netns/netns_linux.go), [pause 실행](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/server/podsandbox/sandbox_run.go), [Linux namespace 설정](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/server/podsandbox/sandbox_run_linux.go), [sandbox 이미지 기본값](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/config/config.go)
- [containerd go.mod](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/go.mod) 실제 확인: containerd v2.4.2에 go-cni v1.1.14 / CNI(libcni) v1.3.1 / plugins v1.9.1. CNI 담당이 실제 SPEC·Current()에서 확인한 규격은1.1.0이며 모듈 릴리스 번호와 구분. 본문은 plugins 소스예시만v1.9.1로 표기. 공동 공식 tag/ref는 `external-refs.json`에 보존
- [plugins bridge](https://github.com/containernetworking/plugins/blob/adc3e6b5b581638afbd194cf2e9319ecbb0151a1/plugins/main/bridge/bridge.go), [plugins README](https://github.com/containernetworking/plugins/blob/adc3e6b5b581638afbd194cf2e9319ecbb0151a1/README.md): veth 생성·bridge 연결과 ipvlan/macvlan/host-device 대안 구현
- 현재 웹으로 실제 읽은 공식 문서: [Pod network readiness](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-network-readiness), [PID 공유](https://kubernetes.io/docs/tasks/configure-pod-container/share-process-namespace/), [Linux namespace lifetime](https://man7.org/linux/man-pages/man7/namespaces.7.html), [Linux bridge](https://docs.kernel.org/networking/bridge.html), [Cilium1.20.3 veth/TC](https://docs.cilium.io/en/stable/network/ebpf/intro/), [Cilium1.20.3 socket LB](https://docs.cilium.io/en/stable/network/kubernetes/kubeproxy-free/#socket-loadbalancer-bypass-in-pod-namespace)

## 원본 대조·정정

1. CRI sandbox 계약과 Linux containerd/podsandbox 구현을 분리. pause·veth·PID공유를 모든 runtime의 필수조건으로 일반화하지 않음
2. 원본의 pause 선행 ASCII를 실제 containerd 순서로 정정: netns 생성/bind mount→CNI Setup/SetupSerially→sandbox 서비스의 pause 시작. 앱 이전 참조 유지자는 프로세스뿐 아니라 mount/FD일 수 있음. pause 종료와 namespace 객체 소멸·런타임 readiness 판정은 별개
3. pause는 네트워크 설정이나 주소 할당을 하지 않으며 SIGCHLD로 자신의 종료 자식을 회수. 공유PID에서 init 역할을 하는 조건과 기본CONTAINER PID를 구분, pause가 모든 앱 자식을 거둔다고 쓰지 않음
4. 이미지 선택은 실제 runtime의 pinned sandbox 우선/기본pause3.10.2로 현행 설명. 원본의 옛 kubelet 제거 플래그·hairpin 역사 각주는 새 근거 없이 현재로 옮기지 않음. 현행 K8s ref의 CHANGELOG/CHANGELOG-1.35.md는404였으며 manifest 실패1건을 보존하고 본문 근거에서 제외
5. network/IPC/PID의 기본모드와 hostNetwork/hostIPC/hostPID/shareProcessNamespace 조건 보존. localhost와 포트 공유, PID공유 시 /proc 가시성과 접근 권한 구분. 같은 포트 번호만으로 무조건 실패한다는 표현을 주소·프로토콜·포트 경합으로 정정
6. veth 기반 bridge와 Cilium TC 예시에서 veth는 양쪽 남음. 다른 인터페이스 방식/장치모드도 존재함을 명시. bridge의 출발지MAC학습·목적지MAC전달 구분. Service TCP connect의 socket LB hook과 veth hook을 구분. bridge에서 NIC로 반드시 직결되는 그림 대신 다음 목적지/노드 네트워크로 표시
7. kubelet은 보고IP 파싱. 원본 ‘잘못된 값 제외’를 정정: primary 또는 additional IP 하나가 잘못돼도 함수 전체nil 반환. Network 부재/빈문자열/파싱오류 구분, 오류 로그가 없다는 이유로 빈IP를 단정하지 않음. IP가 환경변수/hosts 구성에 쓰이는 실제 코드 확인
8. hostNetwork 모드NODE·노드IP상속·CRI network status 무시 보존. containerd의 별도netns/CNI setup 생략은 실제 해당 구현으로 한정하고 kubelet network오류 차단예외와 구분
9. PodSandboxChanged의 다섯 조건과 Network!=nil 빈primaryIP 검사 보존. 재생성 후 IP는 같을 수도 다를 수도 있음. 앱 재시작과 sandbox 재생성 및 SandboxChanged 원인 확정을 구분
10. PodReadyToStartContainers는 v1.37 GA/on·잠김, 생성식은 새sandbox 필요의 부정. 식 자체를 유효IP 검증이나 앱 readiness로 오해하지 않도록 구분. SyncPod의 sandbox-ready callback이 이미지pull보다 앞이라는 현행 경로 반영
11. 원본 LAB8건·종료판정·학습관리/커널하강 인계는 본문 제외. 실습이나 실제장애·설치정보를 만들지 않음. 선택지 비교 절은 없음(구현 기전 비교)

## 검증·시각화

- 실제 `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-pod-sandbox-pause.md`: error0/warn1, 100자초과19줄은 source URL·조건 문장으로 문맥 검토
- 원본471줄/hash 재확인, 공식 고정26파일 SHA256 일치, 본문 고정소스 링크18개 전부 실제 받은 ref/path 일치. 내부 글·이미지 참조 통과
- SVG2장 XML·viewBox·title/desc/ARIA·21px이상 폰트 통과(text12/15개). sharp600/375 각2장 총4PNG렌더 성공, 전부 육안에서 라벨·화살표·잘림/겹침 없음 확인
- 전 섹션 시각화 판단: 생성/참조/CNI/pause/app 순서와 veth기반 두 전달방식은 원본ASCII대체SVG2장. namespace모드·재생성조건·실패구분은 표3개, 참조수명과 계약/구현 차이는 산문으로 설명
- 격식체·마침표·원본조건·근거·반복 문맥 검토 완료. 개념 해설에 개인 경험·감정·내부 편집경위를 보태지 않음
- 전체 lint/build/정적 출력·commit 실행 안 함: 부모 배치 검증 담당. 독립 reviewer 검수 인계

## 대표 문장·남은 문제

원문 “프로세스 외에도 열린 namespace 파일 디스크립터나 bind mount가 참조를 유지할 수 있다” → 변환 “그 안의 프로세스뿐 아니라 열린 namespace 파일 디스크립터나 bind mount도 객체의 참조를 유지할 수 있습니다”

수명 조건을 보존해 격식체로 정리했고 경험은 보태지 않음. 핵심근거 미확인·보류사유 없음. 옛changelog404는 현재주장의 근거로 사용하지 않았으며 이력에 남김. 긴줄경고1건과 미실행LAB은 위와 같음


## 별도 blog-reviewer 검수

# Review: Batch 12 · 글 3개 / SVG 6개

- 적용: `docs/writing-voice.md`, `.agents/skills/draft-to-post/SKILL.md` 및 공동 변환 절차, `.claude/plans/k8s-theory-series/{plan,source-format}.md`
- 원본: `/tmp/k8s-batch12/sources.json`의 정확한 Vault 파일 3개 전문(669·528·471줄) 대조, SHA-256 3/3 일치
- 검토 대상: `src/content/essays/kubernetes/k8s-theory-{ephemeral-containers,cni-contract,pod-sandbox-pause}.md` 및 같은 slug SVG 각 2개
- 콘텐츠·SVG 수정, 공통 문서 수정, commit·build·push 실행 안 함

## P0 위반 / 필수 수정

없음

## P1 확인 필요

없음

## P1 권장

없음

## P2 참고

- 대상 글의 category는 모두 `kubernetes`, 트랙은 `essays`다. plan의 node/order 19와 network/order 1·2, slug가 일치한다. slug 중복 및 두 시리즈의 essays/logs 분리 없음
- lint의 긴 줄 경고는 고정 소스 링크·조건을 포함한 문장 25·27·19곳이다. 전후 문맥을 읽었으며 조건을 잃는 기계적 분리를 요구하지 않았다
- 원본의 학습 판정·내부 Phase ID·미실행 LAB·편집 경위는 본문에서 제외했다. 실습 경험·장애 결과·성능 수치를 새로 만들어 넣은 부분 없음
- 원본의 질문·기전·설계 이유와 실패 판별을 보존했다. 표 뒤 문단이나 SVG 개수를 할당하지 않았다. SVG 한글 라벨은 계획의 허용 범위다

## 실제 검증 결과

가장 먼저 완료된 파일부터 `npm run lint:post -- <대상 파일>`을 실행했다. 세 편의 최종 저장본을 모은 같은 명령도 exit 0이다

```text
k8s-theory-ephemeral-containers.md  error 0 · warn 1 (100자 초과 25곳)
k8s-theory-cni-contract.md         error 0 · warn 1 (100자 초과 27곳)
k8s-theory-pod-sandbox-pause.md    error 0 · warn 1 (100자 초과 19곳)
전체: error 0 · warn 3 (파일 3개)
```

- SVG 6개를 reviewer가 sharp로 800px·375px에 재렌더링했다. PNG 12개 모두 실제 육안 확인: 잘림·겹침·깨진 한글·화살표 충돌 없음
- SVG title/desc와 XML 파싱 확인. 본문의 각 그림 조건과 방향, 원본 ASCII 의미를 비교했다. 렌더링 입력과 최종 SVG 해시 일치
- 근거 manifest의 유효 캐시 95건 SHA-256 일치. 과거 `CHANGELOG/CHANGELOG-1.35.md`의 404 조회 1건은 유효 근거에 포함하지 않았다. 현재 기능 상태는 고정 v1.37.1 등록부와 구현으로 확인했다
- 상세 기계 검증 기록: `/tmp/k8s-batch12/reviewer-evidence-checks.json`; 렌더: `/tmp/k8s-batch12/reviewer-render/`
- 전체 프로젝트 lint·build·정적 출력 검증은 담당 root 단계이며 이 reviewer는 실행하지 않았다

## 기술·원본 대조

- **임시 컨테이너**: 요청의 spec/status·metadata 복원과 managedFields 예외, append-only·이름/대상 검증·아홉 금지 필드·subPath 금지·별도 status 전이를 확인했다. PID는 CONTAINER에서만 TARGET으로 바뀌며 POD/NODE를 유지한다. SyncPod 총 9단계 중 임시 시작은 7번째이고, init 전 판단·sandbox 재생성 조기 반환·이름별 상태 부재 조건을 보존한다. phase/준비 상태의 직접 집계 제외와 간접 자원 소비를 구분한다. kubectl 기본 general과 문서의 legacy 잔존, copy-to 새 Pod 생성·임시 목록 초기화·target 불가·replace 삭제, Pod Security 재평가도 실제 구현과 일치한다
- **CNI 계약**: containerd go.mod의 go-cni 1.1.14·cni 1.3.1·plugins 1.9.1과 spec 1.1.0을 구분했다. SPEC 요약의 STATUS 누락과 본절 존재, stderr 개요와 stdout 오류 JSON/RawExec의 차이를 확인했다. ADD 누적·DEL 역순/같은 마지막 결과·CHECK 순방향, IPAM 전체 설정 위임, 실패 ADD 후 DEL·GC 비대체, 결과 보관을 보존한다. STATUS의 cniVersion<1.1.0 생략, 설정 정렬/개수/오류, NetworkReady→노드 Ready·Pod Event와 hostNetwork 예외, 지연 지표의 한정도 확인했다
- **sandbox/pause**: CRI ready 성공 계약과 containerd podsandbox 예시를 구분한다. netns 생성·bind mount→CNI→pause 시작, namespace 참조 수명, pause 시그널/자식 회수와 공유 PID 조건, pinned image 우선·기본 pause:3.10.2를 확인했다. bridge의 출발지 MAC 학습/목적지 전달, veth·Cilium TC ingress/socket LB 위치와 구현별 예외가 정확하다. primary/additional IP 파싱 실패 시 전체 nil, Network=nil과 빈 IP의 다른 조건, hostNetwork node IP 상속, PodSandboxChanged와 PodReadyToStartContainersCondition GA/on/locked·앱 Ready의 구분을 확인했다

### 실제 확인한 대표 공식 근거

- Kubernetes 고정 ref는 `f78e722310e50bcaca9276be22276d9e91d91308`, website는 `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`이다
- [Pod 전략](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/pod/strategy.go), [검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go), [kubectl debug](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kubectl/pkg/cmd/debug/debug.go), [KEP-277](https://github.com/kubernetes/enhancements/blob/0c8d11e9a13e12d2ef75d2d78af5ac00d8189046/keps/sig-node/277-ephemeral-containers/README.md)
- [CNI SPEC](https://github.com/containernetworking/cni/blob/3f51e8803ebbdba0ebeed735b42137e4c7302403/SPEC.md), [libcni](https://github.com/containernetworking/cni/blob/3f51e8803ebbdba0ebeed735b42137e4c7302403/libcni/api.go), [RawExec](https://github.com/containernetworking/cni/blob/3f51e8803ebbdba0ebeed735b42137e4c7302403/pkg/invoke/raw_exec.go), [go-cni Status](https://github.com/containerd/go-cni/blob/8c8d2ad0f236a8fa1084314d97c5204af8b98d24/cni.go)
- [containerd RunPodSandbox](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/server/sandbox_run.go), [netns](https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/pkg/netns/netns_linux.go), [PodSandboxChanged](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/util/util.go), [IP 파싱](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_sandbox.go)
- 현재 공식 웹 페이지도 직접 대조했다: [Ephemeral Containers](https://kubernetes.io/docs/concepts/workloads/pods/ephemeral-containers/), [Debug Running Pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/), [프로세스 namespace 공유](https://kubernetes.io/docs/tasks/configure-pod-container/share-process-namespace/), [namespace lifetime](https://man7.org/linux/man-pages/man7/namespaces.7.html), [Linux bridge](https://docs.kernel.org/networking/bridge.html), [Cilium TC/veth](https://docs.cilium.io/en/stable/network/ebpf/intro/), [socket LB](https://docs.cilium.io/en/stable/network/kubernetes/kubeproxy-free/#socket-loadbalancer-bypass-in-pod-namespace)
- 실제 고정 소스 캐시는 `/tmp/k8s-batch12/{ephemeral,cni,sandbox}/` 아래 프로젝트별 폴더에 있다. URL·해시는 각 manifest, 확인 결과는 `reviewer-evidence-checks.json`에 보존했다

## 요약

- 최종 미해결 필수 수정 0건 / 확인 필요 0건 / 권장 0건
- 글 3개와 SVG 6개를 독립 검수했다. 형식 lint error 0 / warn 3이며 전체 빌드 완료 판정은 root의 별도 검증 후에만 가능하다
- 검수한 최종 입력 SHA-256은 `/tmp/k8s-batch12/review-hashes.json`의 단순 상대 경로→해시 매핑으로 기록했다


## 실제 최종 검증

- `npm run lint:post -- <이 배치 3편>`: exit 0, error 0 / warn 3
- `npm run lint`: exit 0, error 0 / warn 1 (기존 `src/app/layout.tsx:80` custom font 경고)
- `npm run build`: exit 0, TypeScript·정적 생성·postbuild 성공, 616 pages
- 원본 SHA-256·검수 후 글/SVG와 빌드 입력 hash 일치
- slug 유일성·시리즈 order 연속성·내부 링크·이미지 실존·SVG XML/접근성 메타 검사 통과
- `getAllPosts`·`getEssaysList`·`getSearchIndex` 실제 실행: 3편 모두 essays로 등록, 목록·검색 객체에 content 없음
- HTML 3개·SVG 6개 실제 export 및 `/my-blog/diagrams/` 참조·SVG 바이트 일치
- sitemap·llms 3편 반영, RSS는 기존 최신 20편 정책과 실제 출력 일치
- `git diff --check` 통과
- prebuild의 이번 CLAUDE.md 자동 통계 변경만 복원, Vault 원본 변경 없음
- build의 Node `DEP0205 module.register()` 및 로컬 TS 직접 import의 `MODULE_TYPELESS_PACKAGE_JSON` 경고는 남아 있으며 애플리케이션 설정을 범위 밖에서 바꾸지 않았다
- 클러스터 실습·통합 테스트·성능 실측·push·배포·시리즈 카드 등록: 실행 안 함

원시 로그·임시 근거 저장본: `/tmp/k8s-batch12/`
영구 재확인 경로는 위 글과 작성 기록의 공식 소스 URL이다

## 다음 대상

- `Phase 3-2.2 · overlay 와 native routing (2) · 노드를 넘는 순간 k8s 는 말이 없다.md` → `k8s-theory-overlay-native-routing` (`k8s-theory-network` / 3)
- `Phase 3-3 · Service 와 kube-proxy · 주소가 아니라 규칙이다.md` → `k8s-theory-service-kube-proxy` (`k8s-theory-network` / 4)
- `Phase 3-4 · DNS 와 ndots · 이름 하나에 패킷 여덟 개.md` → `k8s-theory-dns-ndots` (`k8s-theory-network` / 5)
