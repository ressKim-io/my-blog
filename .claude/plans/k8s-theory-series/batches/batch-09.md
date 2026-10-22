# Batch 09 인계 — 2026-10-23

3편 검수 완료, SVG 6장. 콘텐츠 커밋 `fbcd25e`
이번 요청 누적 9/30편, 전체 시리즈 누적 35편

## 원본·결과 대응

원본 루트: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/`
읽기 전용으로 사용했으며 작업 전후 hash 일치를 검증했다
작성 기준일은 2026-10-23이며 학습일·배포일을 뜻하지 않는다

| 좌표 | 원본 파일 | 줄 수 | SHA-256 | slug | series / order |
|---|---|---:|---|---|---|
| 2-9 | `Phase 2-9 · 노드 하트비트와 taint 축출 · 죽었다는 말은 노드가 하지 않는다.md` | 776 | `1092e31542820d997492ba295c76b049c6f601c9e7384de66765877f3dfb4c82` | `k8s-theory-node-heartbeat-taint-eviction` | `k8s-theory-node` / 10 |
| 2-10 | `Phase 2-10 · ConfigMap 과 Secret 전달 경로 · 복사한 값은 늙는다.md` | 603 | `c59bf8c4e9b2218d76d6650b639b7731f522cc0d2d7a97199a06be46f07720ab` | `k8s-theory-configmap-secret-delivery` | `k8s-theory-node` / 11 |
| 2-11 | `Phase 2-11 · CRI 와 OCI 경계 · 두 번째 계약은 API 가 아니라 파일이다.md` | 549 | `a7ff63919ca92b33bb5f324a9330ce4caf21378cb27320cc4aa9f364a73831ad` | `k8s-theory-cri-oci-boundary` | `k8s-theory-node` / 12 |

글 경로는 `src/content/essays/kubernetes/{slug}.md`, SVG는 `public/diagrams/{slug}-{n}.svg`다

## 작성자의 근거 대조·편집 기록

아래는 작성 단계의 기록이다. 이후 보완·정정은 별도 검수와 지적 반영 기록을 우선한다

# Batch 09 · ConfigMap과 Secret 전달 작성 인계

- 글 `src/content/essays/kubernetes/k8s-theory-configmap-secret-delivery.md` (301줄), series `k8s-theory-node` / order 11 / date 2026-10-23
- 원본 `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 2-10 · ConfigMap 과 Secret 전달 경로 · 복사한 값은 늙는다.md` 전문 603줄 읽음
- 원본 SHA-256 `c59bf8c4e9b2218d76d6650b639b7731f522cc0d2d7a97199a06be46f07720ab`
- progress 1122줄/hash `c3081510322928d79907275e31e02c0f4708ec606644bed7581006645d1d16f5`, source-map Phase 2 2189줄/hash `79c08e1759c80a6efc16cde0efd1af227addd3eece6dffd3fd657af6f75c18fe`; 현행 v1.37·EnvFiles Beta/on·실습 미실행 구분 확인
- draft-to-post 진입점·공동 절차·writing-voice·plan·source-format·SVG 가이드 적용. 같은 시리즈 node-observability-sources 글 참조

## 실제 읽은 고정 근거

Kubernetes v1.37.1 tag target `f78e722310e50bcaca9276be22276d9e91d91308`, website `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`. 다운로드 URL/hash는 manifest.json·manifest-extra.json·manifest-volumes.json, 본문은 주장 가까이 불변 링크 인용

- [makeEnvironmentVariables](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kubelet_pods.go): envFrom→env 덮어쓰기, optional의 NotFound·키 분기, 값 확장, FileKeyRef emptyDir 파일 해석
- [pickFieldsToHash](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/container/helpers.go): name·image만 비교, 설정 데이터 변경으로 자동 재시작 아님
- [AtomicWriter](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/util/atomic_writer.go)·[subPath Linux](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/util/subpath/subpath_linux.go): payload 준비·Linux rename·여러 파일 읽기의 보장 범위, EvalSymlinks·안전한 파일 참조·bind 고정
- [ConfigMap plugin](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/configmap/configmap.go)·[Secret plugin](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/secret/secret.go)·[projected](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/projected/projected.go): items·optional·권한·RequiresRemount·직접 ConfigMap/Memory emptyDir 매체 차이
- [watch manager](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/util/manager/watch_based_manager.go): immutable 중지·재시작 방지, 유휴 max(5×sync,1분) 조건
- [kubelet 기본값](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/apis/config/v1beta1/defaults.go)·[ConfigMap manager](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/configmap/configmap_manager.go): Watch·sync 1분·Cache TTL 1분
- [core validation](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go): immutable 범위, Secret type 마스킹 범위, 크기 합계, downwardAPI 목록, FileKeyRef emptyDir 전용 검증
- [gate 등록](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go)·[인증서 API 등록](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/certificates/rest/storage_certificates.go): 인증서 projected 3개 gate GA/on·v1 등록, EnvFiles Beta/on
- [emptyDir](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/emptydir/empty_dir.go)·[swap support](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/util/swap/swap_util.go)·[container manager](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/cm/container_manager_linux.go): 유효 양수 상한 비교·noswap 지원·userns 예외·failSwapOn/경고
- [node authorizer](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/plugin/pkg/auth/authorizer/node/node_authorizer.go): configmaps·secrets 공통 참조 관계 판정. 다른 authorizer의 권한까지 이 경로 하나로 제한한다고 쓰지 않음
- [ConfigMap 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/configuration/configmap.md), [Secret](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/configuration/secret.md), [projected](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/storage/projected-volumes.md), [암호화](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/tasks/administer-cluster/encrypt-data.md), [EnvFiles](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/tasks/inject-data-application/define-environment-variable-via-file.md), [volumes](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/storage/volumes.md) 관련 절 실제 대조

## 정정·보존

1. projected 인증서 관련 gate 3개를 v1.37 GA/on으로 정정. 오래된 v1beta1 runtime-config 예시를 복사하지 않고 v1 API 등록·기능/리소스 활성 조건 구분
2. ConfigMap 크기는 data만 아니라 data+binaryData 값 합계. Secret 검증 오류 마스킹은 일부 type 형식 검사로 한정
3. 직접 ConfigMap 볼륨은 기본 medium emptyDir이므로 모든 환경의 실제 노드 매체를 디스크라고 단정하지 않음. ConfigMap을 projected source로 넣을 때는 Memory 경로임을 명시
4. watch 유휴 시간은 5×sync뿐 아니라 최소 1분 조건을 보존. Get의 TTL 0을 API 요청 시간도 0이라는 의미로 쓰지 않음. 주기+전파를 엄격한 시간 상한으로 쓰지 않음
5. immutable 변경 차단·watch 비용과 읽기 권한을 분리. 같은 이름 재생성으로 기존 Pod의 새 값 반영을 기대하지 않도록 권고 범위 유지
6. EnvFiles는 Beta/on·emptyDir 전용·생성 때 env 조립으로 추가. 공식 파일 형식은 작은따옴표 값, shell 확장 불가. 고정 소스는 optional이어도 파일 파싱 오류를 전파하고 빈 문자열은 키 부재와 같은 분기임을 API 주석과 구분
7. serviceAccountToken 80%/24시간은 지터가 있는 갱신 필요 판정이며 발급 수명·실제 파일 반영 시간과 구분
8. 원본의 LAB·종료 판정·학습 내부 경위 제외. 원본에 없는 실습·로그를 만들지 않음. 환경 변수 값은 가정 예시로 표시

## 검증

- lint:post exit 0, error 0 / warn 1(긴 줄27곳), 고정 URL·표·조건 문맥 검토. 원시 경고 유지
- SVG 2개 XML 파싱·title/desc/role 확인, 명시 font-size 최소15px
- sharp PNG 렌더링 후 2개 육안 검사. 잘못된 문자 표기를 참조로 고친 최종 저장본에서 선/라벨·문자/박스 겹침 없음 확인
- 전 섹션 시각화 판단: 전달 분기·링크/subPath 구조는 SVG, 갱신 전략·optional·권한·fieldRef는 표, AtomicWriter 단계는 번호 목록. 원본 ASCII 없음
- 별도 reviewer·통합 lint/build/export는 주 담당 단계. 공통 docs/commit/build/push 수정·실행하지 않음

## 대표 문장 비교

- 원문: “환경 변수는 kubelet이 컨테이너를 만들 때 문자열로 확정해 런타임에 넘긴다.”
- 변환: “환경 변수는 컨테이너 생성 때 문자열로 확정하지만, 일반 볼륨 파일은 실행 중에도 kubelet이 다시 투영할 수 있습니다”
- 원본의 생성 시점·갱신 차이를 보존하고 앱 재읽기라는 소비자 경계를 이어 설명

## 남은 문제

핵심 주장 보류 없음. 실제 kubelet 설정·노드 매체·swap·권한·갱신 지연·앱 reload는 실측하지 않음. EnvFiles의 optional API 주석과 고정 실행 분기의 차이는 본문에 명시. 다운로드 실패/404 없음


# Batch09 · Phase 2-9 작성 인계

- 정확한 원본: `Phase 2-9 · 노드 하트비트와 taint 축출 · 죽었다는 말은 노드가 하지 않는다.md`
- 경로: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 2-9 · 노드 하트비트와 taint 축출 · 죽었다는 말은 노드가 하지 않는다.md`
- 2026-10-23 전문 776줄 읽음
- SHA-256: `1092e31542820d997492ba295c76b049c6f601c9e7384de66765877f3dfb4c82` — 배치 입력과 동일, 원본 수정 없음
- 출력: `src/content/essays/kubernetes/k8s-theory-node-heartbeat-taint-eviction.md`
- series/order/date: `k8s-theory-node` / `10` / `2026-10-23`
- 최신 progress의 2-9와 학습 상태, source-map 2-9 및 현행 대조 절을 확인. hash는 `source.json`
- 공통 plan·README·commit·build 변경/실행 안 함

## 근거

Kubernetes v1.37.1 ref `f78e722310e50bcaca9276be22276d9e91d91308`, website ref `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`에서 실제 받은31개 공식 파일을 대조했습니다
URL·SHA-256·크기는 `manifest.json`, 다운로드 오류0입니다
본문에는 독자용 고정 링크를 붙였고 원본 편집 경위는 넣지 않았습니다

| 확인 대상 | 실제 읽은 경로·심볼 | 반영 |
|---|---|---|
| Lease와 Node status | kubelet.go의 nodeLeaseRenewIntervalFraction, defaults.go, lease/controller.go, kubelet_node_status.go | 40초 수명/10초 갱신·10초 계산/5분 무변경 보고 분리, update만 지정하면 report 상속 |
| 보고 최적화·클라이언트 | kubelet_node_status.go의 tryUpdateNodeStatus·nodeConditionsHaveChanged, cmd/kubelet/app/server.go heartbeatClientConfig | LastHeartbeatTime만 변화는 제외, lister 첫조회/API재시도, Lease사본 재사용, QPS-1·짧은 timeout |
| 관찰 시계·판정 | nodelifecycle/node_lifecycle_controller.go :: tryUpdateNodeHealth | 노드 timestamp 차분이 아닌 컨트롤러 probeTimestamp. 기존50초/시작60초/검사5초 구분 |
| 현행 캐시 보호 | 같은 함수·kube_features.go :: NodeControllerLeaseCircuitBreaker | v1.37 Beta 기본on. live Lease GET과 RV대조, 캐시 지연이면 controller-wide 일관성 보호로 중단. GET 오류도 중단 |
| HTTP/2 유예 | nodelifecycle config defaults.go, apimachinery util/net/http.go | 실제 readIdle30초+ping15초=45초. 기본주석의 두 이름 옆 숫자 역전은 따라 쓰지 않음.50초가 relist 기한은 아님 |
| Node조건·taint | nodestatus/setters.go :: ReadyCondition, nodelifecycle doNoExecuteTaintingPass | kubelet False와 controller Unknown 분리, 조건4개/NetworkUnavailable 제외, 두NoExecute 상호교체 |
| zone 정책 | ComputeZoneState·ReducedQPSFunc·handleDisruption, options/nodelifecyclecontroller.go, rate_limited_queue.go | 0.1/0.01·burst1, notReady>=3와비율>=0.55, zone노드50초과조건. 전zone전면장애에서 관리taint제거·추가속도0 |
| admission기본값 | defaulttolerationseconds/admission.go | 기본300, key/effect wildcard도 기존항목취급, 기존toleration 덮어쓰지않음. 실제 Pod값 확인 필요 |
| taint삭제 | tainteviction/taint_eviction.go·timed_workers.go | 매칭toleration 최소/무한/즉시, 메모리타이머재구성, DisruptionTarget patch후 일반DELETE로PDB안거침 |
| DaemonSet예외·실행조건 | daemon/util/daemonset_util.go, 공식 taint 문서, SeparateTaintEvictionController gate | 두장애taint무기한허용. 분리1.29/GA1.34고정. --controllers로해당실행제외한구성은삭제흐름전제밖 |
| 마지막삭제·PodReady | status/status_manager.go :: syncPod/canBeDeleted, controllerutil MarkPodsNotReady | 원격종료phase·로컬종료정리후유예0DELETE, Node변화후PodReady변경과삭제별도 |
| PodGC | podgc/gc_controller.go와 config defaults | 네트리거, threshold12500·40초격리/실제GET, Evicted/생성시간/name정렬, 미종료만Failed/조건patch |
| out-of-service | attachdetach/reconciler, 공식 node-shutdown 문서 | 실제종료외부확인·taint제거책임, Pod정리와볼륨강제분리구분 |
| 예고종료 | nodeshutdown_manager.go·_linux.go, 공식node-shutdown, feature gates | systemd inhibit·즉시status시도·우선순위그룹·볼륨대기. 기본0및별도그룹없을때stub, 기존Succeeded보존, 직접PodDELETE아님 |

## 원본 대비 정정·보완

1. v1.37 기본on Lease circuit breaker를 보완했습니다. 과거 watch관찰실패 설명을 현재 보호 없는 무조건 Unknown판정으로 옮기지 않았습니다
2. Node status 보고 jitter는 매주기마다 ±0.5배를 반복하는 것이 아니라 상태변경·재시작 후 다음보고에 한 번 적용하는 현행 구현입니다
3. 시작 단계의 grace60초를 기존노드50초와 분리했습니다. Lease40초는 이 컨트롤러의 만료판정값이 아닙니다
4. 부분장애의50대경계는 다중zone에서 해당zone노드수입니다. 0.1속도는 노드taint추가속도이며 Pod삭제QPS가 아닙니다
5. 모든zone전면장애정책은 이컨트롤러의 두taint에 관한 처리이며 다른NoExecute·삭제경로를 전역중단하는 것으로 쓰지 않았습니다
6. 기본300초admission의 wildcard key/effect예외·매칭에쓰인toleration기준을 보존했습니다
7. kubelet최종DELETE는 API종료phase와 로컬종료정리를 확인하는 현행 조건을 추가했습니다
8. graceful shutdown에서 기존Succeeded를덮지않는예외, 별도priority그룹으로활성화하는조건, 그룹에Pod없으면대기생략을반영했습니다
9.50+300=약350초는 지연을생략한삭제요청관계예시로만남겼습니다. 실제종료·오브젝트삭제완료시간을 실측·보장값으로 만들지 않았습니다
10. 원본의 종료판정·LAB TODO·학습연결·중복용어절은 본문에 결과로 옮기지 않았습니다

## 시각화·문체

- SVG2장: 관찰→판정→taint→삭제요청→별도정리 흐름, 현행 실제Lease·캐시RV재확인 분기
- 두 번째 SVG는 원본에 없던 현행보호기전을 설명하기 위해 능동추가했습니다
- 주기·zone정책·toleration·PodGC·종료설정·진단은 표와산문. 전섹션능동시각화 재검토 완료
- 한글라벨·기술원어·최소17px·title/desc·평탄경로. XML2장파싱 통과
- sharp로800px/375px각2장 총4PNG 렌더한 뒤 도구로 모두직접열어확인. 잘림·넘침·라벨/선겹침 없음
- voice기준 격식체·과장·직역·반복·맥락·원본없는경험검토 완료
- 선택지비교섹션 미포함: 원본은설정판정기전이며 기술선정대안신호없음

## 실제검증과 남은범위

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-node-heartbeat-taint-eviction.md`: **exit0, error0 / warn1** (`lint-post.log`). 긴줄권장경고를 검토했고 링크·표·조건을보존했습니다
- SVG XML2장·최소폰트·실존참조 검사 통과 (`source.json`)
- sharp4PNG와 원본/375px육안검사 통과
- 원본hash최종재확인: 최초입력과동일
- 전체lint·build·정적출력: **작성담당에서는 실행 안 함**, 배치담당에인계
- 독립blog-reviewer: 아직미실행, 부모의별도검수대기
- 핵심원본·근거부족에따른보류없음. 실측시간·실제클러스터설정은확인하지않았으며 본문고지와조건으로구분했습니다
- 독립검수·배치통합검증을통과하기전 완료편수로세지않습니다

## 대표문장

원문: “노드의 실제 종료와 관찰 실패를 구분하지 못한다는 한계가 속도 정책에 반영돼 있다”

변환: “노드 전체가 실제로 종료된 것인지, 컨트롤 플레인의 관찰 경로가 끊긴 것인지 이 상태만으로 구분하지 못하기 때문입니다”


# Batch 09 · Phase 2-11 작성 인계

- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 2-11 · CRI 와 OCI 경계 · 두 번째 계약은 API 가 아니라 파일이다.md`
- 2026-10-23 최신 저장본549줄 전문 읽음. SHA-256 `a7ff63919ca92b33bb5f324a9330ce4caf21378cb27320cc4aa9f364a73831ad`, sources.json과 실제 원본 hash/줄수 일치 확인
- progress의 2-11 해당 행·최신 source-map Phase2의 2-11 본절·자원 및 주체 경계 보완 확인. 원본은 읽기 전용
- 글: `src/content/essays/kubernetes/k8s-theory-cri-oci-boundary.md` 277줄
- series/order/date: `k8s-theory-node` / 12 / 2026-10-23
- tags: Kubernetes, CRI, OCI, containerd, runc, concept
- SVG2개: `public/diagrams/k8s-theory-cri-oci-boundary-{1,2}.svg`. #1 CRI·shim·runc 책임 경계(원본 흐름 재작성), #2 CRI/OCI create 대응 차이와 ID 등록(능동 판단 신규1개). 표5개
- voice·draft-to-post 진입점/공동절차·plan/source-format·SVG 기준 적용. 공통 문서·타인 수정 보존, commit/build/push 실행 안 함

## 실제 확인한 버전과 공식 근거

공식 release API와 tag commit을 조회해 아래 버전/ref를 확정했다. 실제 노드에 설치된 버전이라는 뜻이 아니며 최신 배포판으로 일반화하지 않음

| 프로젝트 | 확인 버전 | 고정 ref |
|---|---|---|
| Kubernetes | v1.37.1 | `f78e722310e50bcaca9276be22276d9e91d91308` |
| website | 고정 저장본 | `7fde177e22dc98390a6d55d215dd0301b5f6d0bb` |
| containerd | v2.4.2 | `b7a25261e029d68978bbf290df0a62fc819b3c51` |
| runc | v1.5.2 | `29dd3dc2b13b4123162e5fe132504bb4b15569f1` |
| OCI runtime-spec | v1.3.0 | `92249139eea7161e13745abd4cb6d0ea02a3227a` |

공식 raw42파일을 읽고 manifest.json35개·manifest-extra.json7개에 URL·hash를 보존했다. 이후 실제 파일 SHA-256 42/42 일치 재검사. external-refs.json·release API 응답·containerd-tree.json·namespace util 디렉터리 목록도 보존

- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cri-api/pkg/apis/runtime/v1/api.proto — 두 서비스, 현재 RPC37/6개, RunPodSandbox ready·runtime_handler, namespace와 UpdateContainerResources
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_manager.go — SyncPod9단계·자원 갱신 순서
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_container.go — EnsureImageExists·PreCreate·CreateContainer·PreStart·StartContainer·자원 갱신 RPC
- `kuberuntime_sandbox.go`, `kuberuntime/util/util.go`, `runtimeclass/runtimeclass_manager.go` — handler 해석·별도 전달·HostNetwork/HostPID/ShareProcessNamespace
- `cm/internal_container_lifecycle{,_linux}.go` — 배정값이 있을 때 CpusetCpus/CpusetMems, ID 등록과 현재 nil 반환
- `kubelet.go`, `kubelet_pods.go`, `apis/config/{types.go,v1beta1/defaults.go}`, `images/{image_manager.go,types.go,image_gc_manager.go,pullmanager/image_pull_policies.go}`, `apis/core/v1/defaults.go`, `util/parsers/parsers.go`, `features/kube_features.go` — endpoint·pull policy·Secret 실패 이벤트 조건·backoff·GC·검증 정책
- https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/docs/runtime-v2.md — daemon/shim/engine 책임과 one-to-many 가능
- https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/server/container_create.go — OCI spec/snapshot/메타데이터 준비·NewContainer
- https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/server/container_start.go — NewTask 뒤 task.Start
- https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/core/runtime/v2/bundle.go — bundle/rootfs와 config.json 작성
- https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/cmd/containerd-shim-runc-v2/process/init.go — runtime.Create·runtime.Start
- containerd의 `cmd/containerd-shim-runc-v2/{runc/container.go,task/service.go}`, `vendor/github.com/containerd/go-runc/runc.go`, `internal/cri/server/{images/image_pull.go,podsandbox/sandbox_run.go}`도 실제 대조
- https://github.com/opencontainers/runtime-spec/blob/92249139eea7161e13745abd4cb6d0ea02a3227a/runtime.md — create/start·설정 수정 무효·호출 인터페이스 비규정
- 같은 OCI ref의 bundle.md·config.md·config-linux.md·glossary.md·spec.md — config.json 필수, root.path, namespace path·cgroupsPath/resources, runtime caller
- https://github.com/opencontainers/runc/blob/29dd3dc2b13b4123162e5fe132504bb4b15569f1/README.md — Linux OCI CLI 도구라는 범위
- website 고정 ref의 `concepts/containers/{cri.md,images.md}`·`concepts/architecture/garbage-collection.md`. 현재 공식 CRI 웹도 열람해 architecture/cri→containers/cri 이동 확인

## 원본 대비 정정·한정

1. **현재 CRI RPC**: ImageService는 StreamImages가 추가돼6개, RuntimeService는37개다. 원본의5개/약30개를 현재 고정 수로 반복하지 않고 책임·현재 존재 RPC로 설명했다
2. **현재 SyncPod 단계**: OnPodSandboxReady가 들어가9단계다. 원본8단계 표를 그대로 옮기지 않음. 매 sync마다 전부 생성하는 것처럼 쓰지 않음
3. **CRI/OCI create 비동일성**: containerd의 CRI CreateContainer는 spec·메타데이터 등 준비, CRI StartContainer는 NewTask(OCI create) 뒤 task.Start(OCI start). 같은 동사를1:1시점으로 대응하지 않음. 별도 SVG로 설명
4. **실제 shim 경계**: containerd가 runc를 무조건 직접 호출하는 그림 대신 현재 Runtime v2의 shim API→shim→runc 호출을 확인했다. OCI는 이 API/CLI를 고정하지 않으며 shim1개=컨테이너1개도 필수가 아님
5. **namespace/cgroup 조건**: HostNetwork는NODE, 일반 network는POD, 기본 PID는CONTAINER·shareProcessNamespace는POD·hostPID는NODE. OCI의 path 참여/새 생성/type 생략 상속을 구분하고 모든 namespace를 새로 만들어 공유한다고 쓰지 않음
6. **bundle 한정**: config.json의 위치/이름은 필수지만 rootfs라는 이름을 필수로 쓰지 않는다. root.path의 POSIX 절대/상대 경로 허용과 containerd의 실제 rootfs 준비를 구분함
7. **OCI 이미지 범위**: 원본의 image 단어0회·runc가 이미지를 전혀 모른다는 식의 단정 대신 runtime-spec의 실행 계약과 image-spec의 형식 책임을 구분했다. 이미지 annotation과 pull 책임도 분리함
8. **생성 전/후 훅**: cpuset·NUMA 배정값이 있을 때만 구조체에 반영. 훅 오류 이름과 실제 Linux PreCreate/PreStart 구현의 nil 반환을 구분했다. 내부 훅을 Pod lifecycle/OCI hook과 혼동하지 않음
9. **자원 갱신**: create 후 config.json 수정 무효와 별도 CRI UpdateContainerResources를 구분했다. RPC 수락·지원 조건을 실제 cgroup 파일 측정 성공으로 확대하지 않음
10. **Secret 이벤트 시점 정정**: getPullSecretsForPod는 조회 실패 이름을 반환하고 건너뛴다. FailedToRetrieveImagePullSecret은 같은 sync에서 실제 ErrImagePull도 있을 때만 kubelet이 낸다. 원본의 조회 실패 즉시 이벤트 설명을 현재 조건으로 고침
11. **자격증명 정책**: KubeletEnsureSecretPulledImages는 현재도Beta/default on, NeverVerifyPreloadedImages 기본. 기록 없는 로컬·사전적재 예외를 보존했고, AlwaysVerify도 매번 네트워크 재다운로드와 같다고 쓰지 않음
12. **Never·오류 범위**: 현재 로컬 이미지가 있어도 접근 검증상 사용할 수 없으면 Never 경로가 ErrImageNeverPull을 낼 수 있다. RegistryUnavailable/SignatureValidationFailed의 별도 분류와 실제 실패/BackOff 대기를 구분함
13. **policy default**: digest만 지정한 표와 latest태그+digest 조합을 구분했다. 코드는 tag를 검사한다. Always의 요청과 layer 캐시 재사용도 구분함
14. **GC 조건**: 5분/1분·85/80·최소2분·최대나이0을 대조. 사용 중뿐 아니라 pinned 제외, MinAge는 공간 확보 경로, MaxAge는 별도·재시작 추적 초기화, 목표 확보 보장 아님을 보존함
15. LAB TODO·자가 판정·학습 등급·편집 경위를 독자 본문에 노출하지 않았고 실습·이미지 pull·실제 파일 확인 경험을 창작하지 않음

## 대표 문장

원문: “pull Secret을 읽지 못했다는 이유만으로 이 경로가 Pod를 종료시키지는 않는다 / kubelet은 해당 Secret을 건너뛰고 FailedToRetrieveImagePullSecret 이벤트를 남긴다”

변환: “현재 getPullSecretsForPod는 읽지 못한 Secret을 건너뛰고 그 이름을 별도로 반환합니다 / FailedToRetrieveImagePullSecret 이벤트는 조회 실패만으로 즉시 기록하지 않습니다 / 같은 sync에서 실제 ErrImagePull 결과가 함께 있었을 때 kubelet이 기록합니다”

이유: 조회 실패와 pull 결과를 분리한 원문의 취지를 보존하면서 현행 소스의 이벤트 발생 조건을 정정함

## 작성자 검증·남은 문제

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-cri-oci-boundary.md` 실제 실행 error0/warn1. 긴줄30곳은 고정URL·표 조건 등을 포함하며 문맥 검토 후 보존. lint-post.log
- SVG2개 XML 파싱·sharp1000px/375px PNG 렌더·최종 모바일 육안검사 통과. 기존800폭 축소에서 글자가 작아600 viewBox·최소21px로 재구성한 뒤 다시 확인했다. 375폭 기준 명목 최소13.1px, 겹침·잘림 없음
- 표준/모바일 PNG는 diagram-{1,2}.png·mobile-{1,2}.png에 보존. 한글 라벨·접근성 title/desc·의미론 색상·모든 본문참조 실존 확인
- 원본 hash·공식42파일 hash·내부링크2개·이미지2개 실제 대상 재검사. output-checks.json에 본문·SVG hash/줄수 및 검사 목록 보존
- 전 섹션 능동 시각화 재검토: 책임 경계와 create 시점은 SVG, 서비스·namespace·default값·오류·GC 조건은 표/목록, 보장 범위와 설계 이유는 산문
- 원문 대비 사실·조건·근거·격식체·끝마침표·직역·과장·반복·허구경험 없음 문맥 검토
- Decision section 미포함: 대안 선정이 아닌 계약·기전 해설
- 실제클러스터실습·전체lint·build·정적export 실행 안 함. 독립reviewer와 주담당통합검증 대기이며 아직 완료편수에 포함하면 안 됨
- 핵심 근거 부족 보류 없음. 노드 설치버전·실제 containerd/runc 호출·실제 cgroup/OCI 파일 측정은 확인하지 않았고 본문도 그 범위를 고지함


## 별도 blog-reviewer 검수

# Review: Batch09 · 3 posts + 6 SVG

## P0 위반 · 필수 수정

최종 저장본 0건

## 확인 필요

0건. 원본·핵심 공식 근거 부족으로 보류할 글 없음

## P1 권장

미해결 0건. 아래 1건은 주담당 수정 후 재검토 통과

- `k8s-theory-node-heartbeat-taint-eviction.md:125` — [적용 범위] “반영을 확인할 때까지 … 노드 처리를 중단” → Lease 캐시의 반영 대기는 해당 노드에만 적용되는 것으로 읽힐 수 있음. 실제 `tryUpdateNodeHealth` 진입부의 `consistencyStore.EnsureReady(types.NamespacedName{})`는 컨트롤러 전체를 검사 → “반영을 확인할 때까지 해당 노드뿐 아니라 이 컨트롤러의 다른 노드 판정도 중단합니다”로 수정 완료. 바로 앞 RV 비교·뒤 GET 실패 문맥과 SVG2의 중단 분기도 충돌 없음

근거: [node_lifecycle_controller.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/nodelifecycle/node_lifecycle_controller.go)의 `tryUpdateNodeHealth`, controller-wide consistency 주석·`EnsureReady`·live Lease RV 비교 경로를 실제 열람

## P2 참고 · 실제 lint

최초 검사와 수정 후 최종 검사 모두 `npm run lint:post -- <3개 대상 파일>` 실행. 최종 원시 결과:

```text
k8s-theory-node-heartbeat-taint-eviction.md
  △ [문장길이] 100자 초과 줄 22곳 — 분리 검토
  요약: error 0 · warn 1
k8s-theory-configmap-secret-delivery.md
  △ [문장길이] 100자 초과 줄 27곳 — 분리 검토
  요약: error 0 · warn 1
k8s-theory-cri-oci-boundary.md
  △ [문장길이] 100자 초과 줄 30곳 — 분리 검토
  요약: error 0 · warn 1
전체: error 0 · warn 3 (파일 3개)
```

긴 줄은 고정 URL·표의 조건·근거 연결 문맥을 포함. 문맥에서 추가 필수 분리 사유 없음. lint가 검사하는 형식 항목을 별도 정규식으로 재구현하지 않음

## 원본·문체·로컬 등록 대조

- docs/writing-voice.md, draft-to-post 진입점과 공동 절차, 시리즈 plan·source-format 기준 적용
- `/tmp/k8s-batch09/sources.json`의 정확한 원본 3개 전문 읽고 현재 본문 전부 대조: 2-9 776줄, 2-10 603줄, 2-11 549줄. 실제 원본 SHA-256 3/3 일치 재검사
- 디렉터리 essays/kubernetes, series k8s-theory-node, order 10·11·12 일치. 같은 slug가 다른 트랙에 중복하지 않음
- 격식체·질문/독백 맥락·용어 정의·시리즈 연결 확인. 원본 없는 클러스터 실습·실패·감정·실측 경험 창작 없음. 실제 동작을 확인한 코드 경로와 실제 노드 측정을 분리함
- 원본의 학습용 판정·TODO·편집 식별자를 독자에게 노출하지 않음. 원본 사실을 수정한 부분은 현행 근거와 조건을 제시함

## 핵심 기술 검증

Kubernetes ref `f78e722310e50bcaca9276be22276d9e91d91308` 및 website ref `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`의 실제 파일을 열람. 작성자 보고서만으로 승인하지 않고 아래 주요 분기·기본값·예외를 원본/현재 글/고정 소스에서 대조

| 글 | 실제 대조와 판단 |
|---|---|
| heartbeat | Lease40초·기본 갱신 약10초, status report와 update 구분, 최초 보고 지터 후 정기 보고, local 관찰 시각 기준, 기존50초/신규60초 유예를 확인. LeaseCircuitBreaker v1.37 Beta/on, GET 오류·RV 불일치·NotFound 분기와 컨트롤러 전체 중단 범위 일치 |
| heartbeat | taint 부착 속도는 노드 단위이며 Pod 삭제 QPS가 아님. zone의3개·0.55·50노드 조건과 전 zone 중단 예외 확인. toleration300초는 admission 기본 항목이며 유예50초와 합쳐 삭제 완료 보장으로 쓰지 않음 |
| heartbeat | taint eviction 일반 DELETE, kubelet 종료 확인/조건부 podGC 정리, status_manager 삭제 조건을 분리. Shutdown 기본0·그룹 순서 및 볼륨 대기와 단순 Node 비정상 판정을 구분 |
| delivery | envFrom→env 순서·덮어쓰기, 값은 컨테이너 생성 때 해석. EnvFiles Beta/on·emptyDir·init 생성 뒤 읽기, optional은 parse 실패를 무시하지 않으며 빈값/없는 key 분기 확인 |
| delivery | AtomicWriter의 새 디렉터리→..data_tmp→rename과 재open, 열린 FD·subPath bind 참조, 다중파일 여러 open 비원자성 구분. Secret/ConfigMap/projected의 Memory 매체 범위, immutable 데이터와 metadata·watch/cache/Get 차이 확인 |
| delivery | ServiceAccount 토큰 요청 TTL 약80%/24시간에 지터를 적용한 refresh 필요 판정과 실제 파일 갱신을 구분. 인증서 관련 gate의 v1.37 GA/on, Secret mode·크기·인증/권한·tmpfs/swap 조건 대조 |
| runtime | ImageService6 RPC(StreamImages 포함), SyncPod9단계(OnPodSandboxReady 포함), namespace POD/NODE/CONTAINER 설정, 내부 PreCreate 배정값 조건·PreStart ID 등록 확인 |
| runtime | containerd CRI CreateContainer의 spec/snapshot/메타데이터와 StartContainer 내부 NewTask→task.Start, shim의 runc Create→Start 호출을 분리. OCI runtime 규격은 CLI/gRPC를 고정하지 않으며 rootfs라는 이름도 일반 필수 아님 |
| runtime | OCI create의 process.args 적용 유예, create 이후 config.json 수정 무효, 별도 UpdateContainerResources를 구분. FailedToRetrieveImagePullSecret은 같은 sync의 ErrImagePull 동반 조건으로 한정 |
| runtime | KubeletEnsureSecretPulledImages Beta/on·NeverVerifyPreloadedImages 예외, tag 기반 imagePullPolicy default, backoff PodUID+image 키, GC85/80·2분·최대0·pinned/사용 중 제외·사용시각 재시작 초기화 조건을 확인 |

추가 공식 직접 열람: [Nodes](https://kubernetes.io/docs/concepts/architecture/nodes/), [ConfigMap](https://kubernetes.io/docs/concepts/configuration/configmap/), [EnvFiles](https://kubernetes.io/docs/tasks/inject-data-application/define-environment-variable-via-file/), [Node Shutdown](https://kubernetes.io/docs/concepts/cluster-administration/node-shutdown/), [containerd v2.4.2](https://github.com/containerd/containerd/releases/tag/v2.4.2), [runc v1.5.2](https://github.com/opencontainers/runc/releases/tag/v1.5.2), [OCI runtime-spec v1.3.0 runtime](https://github.com/opencontainers/runtime-spec/blob/v1.3.0/runtime.md)

외부 구현 고정 ref: containerd v2.4.2 `b7a25261e029d68978bbf290df0a62fc819b3c51`, runc v1.5.2 `29dd3dc2b13b4123162e5fe132504bb4b15569f1`, OCI runtime-spec v1.3.0 `92249139eea7161e13745abd4cb6d0ea02a3227a`. 실제 설치 버전으로 일반화하지 않음

근거 캐시: `/tmp/k8s-batch09/{heartbeat,delivery,runtime}/`. 각 manifest가 기록한 실제 파일 SHA-256 재검사 109/109 일치(heartbeat31, delivery36, runtime42, 중복 경로의 별도 manifest 기록 포함). 세부 URL은 각 manifest 및 작성자 report.md에 보존

## SVG 실제 렌더·육안 검사

- 같은 slug SVG6개 XML 파싱 통과. sharp로800px와375px에 각각 실제 PNG 생성, 12개 전부 육안 검사
- `/tmp/k8s-batch09/reviewer-render/`에 검토 PNG 보존
- heartbeat: 관찰→유예→Lease 재검사→taint/DELETE/정리의 책임과 시계, RV 분기 의미 확인. 회로 차단의 중단 분기는 본문 설명과 충돌하지 않음
- delivery: 생성 시 env와 재투영 파일의 분리, subPath bind와 ..data 전환·다중 open의 보장 범위를 확인
- runtime: CRI→containerd→shim→runc 책임, CRI Start 내부 OCI create/start 시점 확인. 기술적 일대일 대응 오류 없음
- 한글 라벨 허용 기준 적용. 겹침·잘림·순서 오류 없음. 세로로 긴 runtime SVG의 tall 힌트 확인

## 요약

필수 수정 0건 · 확인 필요 0건 · 미해결 권장 0건(권장1건 반영 후 재검토) · P2 lint 길이 경고3개 글

검토 대상3편+6SVG의 최종 SHA-256은 `review-hashes.json`의 상대경로→hash 단순 매핑으로 확정. 글·SVG·공통 문서 수정과 commit/push/build는 reviewer가 실행하지 않음. 전체 lint·build·정적 출력·최종 빌드 입력 동일성은 주담당 검증 범위


### 지적 반영·재검토

- 자립성 권장 1건 반영: Lease circuit breaker의 consistency 확인이 controller-wide임을 명시했다
- 캐시 지연 반영을 확인할 때까지 해당 노드뿐 아니라 이 컨트롤러의 다른 노드 판정도 중단함을 `tryUpdateNodeHealth`의 실제 EnsureReady 분기로 대조했다


## 실제 최종 검증

- `npm run lint:post -- <이 배치 3편>`: exit 0, error 0 / warn 3
- `npm run lint`: exit 0, error 0 / warn 1 (기존 `src/app/layout.tsx:80` custom font 경고)
- `npm run build`: exit 0, TypeScript·정적 생성·postbuild 성공, 598 pages
- 원본 SHA-256·검수 후 글/SVG와 빌드 입력 hash 일치
- slug 유일성·시리즈 order 연속성·내부 링크·이미지 실존·SVG XML/접근성 메타 검사 통과
- `getAllPosts`·`getEssaysList`·`getSearchIndex` 실제 실행: 3편 모두 essays로 등록, 목록·검색 객체에 content 없음
- HTML 3개·SVG 6개 실제 export 및 `/my-blog/diagrams/` 참조·SVG 바이트 일치
- sitemap·llms 3편 반영, RSS는 기존 최신 20편 정책과 실제 출력 일치
- `git diff --check` 통과
- prebuild의 이번 CLAUDE.md 자동 통계 변경만 복원, Vault 원본 변경 없음
- build의 Node `DEP0205 module.register()` 및 로컬 TS 직접 import의 `MODULE_TYPELESS_PACKAGE_JSON` 경고는 남아 있으며 애플리케이션 설정을 범위 밖에서 바꾸지 않았다
- 클러스터 실습·통합 테스트·성능 실측·push·배포·시리즈 카드 등록: 실행 안 함

원시 로그·임시 근거 저장본: `/tmp/k8s-batch09/`
영구 재확인 경로는 위 글과 작성 기록의 공식 소스 URL이다

## 다음 대상

- `Phase 2-12 · 장치 자원 · 개수는 어느 것인지를 말하지 못한다.md` → `k8s-theory-device-resource-allocation` (`k8s-theory-node` / 13)
- `Phase 2-13 · 런타임 격리 · 지정하지 않았다는 말이 필드마다 다르다.md` → `k8s-theory-runtime-isolation` (`k8s-theory-node` / 14)
- `Phase 2-14 · 자원 회계와 점수 전략 · 세는 쪽도 고르는 쪽도 Pod 밖에 있다.md` → `k8s-theory-resource-accounting-scoring` (`k8s-theory-node` / 15)
