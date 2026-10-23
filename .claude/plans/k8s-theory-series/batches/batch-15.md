# Batch 15 인계 — 2026-10-23

3편 검수 완료, SVG 6장. 콘텐츠 커밋 `28a9375`
이번 요청 누적 27/30편, 전체 시리즈 누적 53편

## 원본·결과 대응

원본 루트: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/`
읽기 전용으로 사용했으며 작업 전후 hash 일치를 검증했다
작성 기준일은 2026-10-23이며 학습일·배포일을 뜻하지 않는다

| 좌표 | 원본 파일 | 줄 수 | SHA-256 | slug | series / order |
|---|---|---:|---|---|---|
| 3-8 | `Phase 3-8 · CCM 과 클라우드 경계 · 밖이 채울 칸은 안에서 먼저 잠근다.md` | 676 | `23e04ee96aa5989207f6affc631312e076a1826652800091601996b2990fa9c8` | `k8s-theory-cloud-controller-boundary` | `k8s-theory-network` / 9 |
| 3-9 | `Phase 3-9 · 트래픽 지역성과 dual-stack · 앞자리가 비면 떨어뜨리거나 되돌아간다.md` | 609 | `bac8a51f0610504048812dd70e5a960f308a60083e6c087acb80fdb7a8bfceff` | `k8s-theory-traffic-locality-dual-stack` | `k8s-theory-network` / 10 |
| 3-10 | `Phase 3-10 · ServiceCIDR 와 IPAddress · 이름이 곧 자물쇠다.md` | 595 | `99664b9fe305bc6a4779497215136cd8633a04c948d3141a62f3d8964cf8b8e8` | `k8s-theory-service-cidr-ip-address` | `k8s-theory-network` / 11 |

글 경로는 `src/content/essays/kubernetes/{slug}.md`, SVG는 `public/diagrams/{slug}-{n}.svg`다

## 작성자의 근거 대조·편집 기록

아래는 작성 단계의 기록이다. 이후 보완·정정은 별도 검수와 지적 반영 기록을 우선한다

# Batch 15 · CCM/클라우드 경계 작성 인계

- 상태: 본문·소유 SVG·작성자 검증 완료, 독립 검수와 배치 lint/build/export·commit은 parent 담당
- 본문: `src/content/essays/kubernetes/k8s-theory-cloud-controller-boundary.md` (297줄)
- series `k8s-theory-network` / order 9 / date `2026-10-23`
- tags: `kubernetes`, `cloud-controller-manager`, `cloud-provider`, `networking`, `loadbalancer`, `concept`
- SVG 2장, 표 7개. 초기화 원자성·주소 status 예외와 Pod CIDR/route/KCM taint 분업을 시각화. Service finalizer는 단순한 선형 관계여서 번호 목록으로 설명
- 공통 docs·다른 작성자 파일·Vault·의존성 변경, build/commit/push 실행 없음

## 원본·문맥 기준

- 정확한 원본 파일명: `Phase 3-8 · CCM 과 클라우드 경계 · 밖이 채울 칸은 안에서 먼저 잠근다.md`
- 경로: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 3-8 · CCM 과 클라우드 경계 · 밖이 채울 칸은 안에서 먼저 잠근다.md`
- 원본 전문 676줄을 읽음. 최종 SHA-256 `23e04ee96aa5989207f6affc631312e076a1826652800091601996b2990fa9c8` — 배정 시점과 동일
- `☸️ progress.md` 1122줄: `c3081510322928d79907275e31e02c0f4708ec606644bed7581006645d1d16f5` — 3-8 행·정리 범위 확인
- `☸️ source-map.md` 123줄: `36cadfdf517ab7a33708be8e867f8b4d303d762e873ddd3c31564b8c77e704ae` — 현행 v1.37·과거 v1.35 구분 확인
- `☸️ source-map · Phase 3.md` 1265줄: `0458c79aa9dd7996a03d7babffc63068c5c3b5a7b16bc6906fc690b920f651bd` — 3-8과 현재 정정의 KCM stub 제거·Service cleanup 예외 확인
- `.agents/skills/draft-to-post/SKILL.md`, 연결된 공동 절차·decision-tradeoff, `docs/writing-voice.md`, plan/source-format·SVG 가이드, 기존 network 시리즈 overlay/native routing 글 적용
- 원본 LAB TODO·종료 판정·Phase 좌표·편집 이력은 본문 제외. 실제 cloud provider·클러스터 설치·자격증명·호출·트래픽·지연 관찰은 수행하지 않음

## 실제 확인한 공식 ref와 파일

이번 대상 소스 27개를 고정 ref에서 새로 받았고, 추가 설정·KEP·역사 소스도 실제 읽었습니다
URL·파일별 SHA-256은 `manifest.json`, `manifest-extra.json`, `manifest-options.json`, `manifest-contracts.json`에 있습니다

- Kubernetes v1.37.1: `f78e722310e50bcaca9276be22276d9e91d91308`
- `/git/ref/tags/v1.37.1` → annotated tag object → release commit을 실제 조회해 위 target 재확인 (`kubernetes-tag.json`)
- website: `7fde177e22dc98390a6d55d215dd0301b5f6d0bb` — 관련 문서 3개를 새로 받아 현재 문장 확인
- enhancements: `0c8d11e9a13e12d2ef75d2d78af5ac00d8189046` (`/commits/master` 실제 응답을 저장하고 README/kep.yaml을 이 ref로 고정)
- 역사 v1.35 고정본: `5671697925fe8d7222c4ab09cb15f28f5f9d0383` — 원본의 stub 문맥 확인용, 현재 설명 기준으로 사용하지 않음

### 노드 초기화와 생사

- [kubelet Node 등록](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kubelet_node_status.go#L90-L141): 기존 Node는 CMAD/default labels/extended resources/hugepages를 조정하며 초기화 taint를 재추가하는 목록이 아님
- 같은 파일 [initialNode](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kubelet_node_status.go#L303-L340): external 모드의 새 Node에 uninitialized, value true, NoSchedule taint를 추가. 기본 라벨 셋은 대표 목록이며 전부가 아님
- [kubelet flags](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kubelet/app/options/options.go): `cloud-provider`·`node-ip`·`provider-id` 실제 등록/도움말 확인. 오래된 문서의 KCM 플래그 설정을 현행 명령 예제로 옮기지 않음
- [cloud node controller](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cloud-provider/controllers/node/node_controller.go#L416-L650): 초기화 변경 목록 + taint 제거가 같은 Node Update, 사전 node-IP 적용 검증, 오류 반환과 workqueue AddRateLimited 재시도, 주소 status는 성공 뒤 별도 patch
- 같은 파일 `getInstanceMetadata` L580–605: InstancesV2 메타데이터의 ID가 비었을 때 기존 Node ID가 있으면 보완, 둘 다 없으면 오류. 메타데이터 자체가 nil이면 syncNode가 건너뛰므로 taint 제거도 없음
- `getNodeModifiersFromCloudProvider` L500–505: Node ID가 이미 있으면 새 metadata ID로 덮어쓰지 않음. 라벨은 메타데이터가 비어 있지 않을 때 추가하므로 모든 zone/region/type 라벨 보장 아님
- 이전 Instances 경로: provider ID 조회의 NotImplemented만 ID 생략 호환성 예외. 다른 조회 오류는 전파
- `updateNodeAddress` L362–411: 주소 patch 오류는 로그에 남음. 초기화 Update와 주소 patch 전체를 원자적 성공이라고 쓰지 않음
- [CCM app/core.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cloud-provider/app/core.go): 네 시작 경로·인터페이스 지원 조건 확인
- [cloud node lifecycle](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cloud-provider/controllers/nodelifecycle/node_lifecycle_controller.go#L147-L229): Ready True는 shutdown taint 제거 후 존재 질의 생략. False/Unknown/조건 없음은 질의 대상 가능. 오류 없는 부재 응답은 Node Delete, 존재+shutdown은 NoSchedule taint. 조회 오류와 부재를 구분
- [현행 website CCM](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/architecture/cloud-controller.md): **현재 문서는 node/node lifecycle을 분리하는 구현이 있다고 이미 명시**. 원본의 ‘셋 대 넷 문서 불일치’를 현재 문제로 반복하지 않음

### Service·LB·노드 후보

- [Service defaulting](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/v1/defaults.go)·[Service allocation](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/service/storage/alloc.go): LB nodePort 자동 할당 기본 true·저장 중 registry 책임. false는 신규 자동 할당 제어이며 기존 포트 자동 제거 아님 (website Service 문서와도 대조)
- [printer](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/printers/internalversion/printers.go#L1412-L1441): LoadBalancer에서 status LB 주소뿐 아니라 `spec.externalIPs`에도 표시할 값이 없어야 pending 표시. 원본의 ‘status가 비면 pending’을 이 조건으로 보완
- [service controller](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cloud-provider/controllers/service/controller.go): Add wantsLoadBalancer OR needsCleanup; Update needsUpdate OR needsCleanup. class가 있으면 신규 기본 LB 대상이 아니지만 기존 cleanup 경로는 따로 판단
- 같은 파일 `wantsLoadBalancer` L862–866: Type LoadBalancer && Class nil
- [class validation](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go#L9647-L9689)·[Service strategy](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/service/strategy.go): 양쪽 타입 모두 LB일 때 nil↔값 포함 class 동일성, 다른 타입→LB 지정 가능/형식 검사, LB→다른 타입의 기존 class 정리 조건을 분리
- [finalizer/Ensure/status](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cloud-provider/controllers/service/controller.go#L364-L439): finalizer 추가→Ensure LB→status, 정리→finalizer 제거. ImplementedElsewhere 위임 경계, 정상 정리 담당과 RBAC 편집 권한 구분
- EnsuringLoadBalancer/EnsuredLoadBalancer/SyncLoadBalancerFailed 실제 이벤트 위치 확인. Ensured 이벤트가 status patch보다 앞임을 보완
- [stable predicates](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cloud-provider/controllers/service/controller.go#L1001-L1044): 삭제 중/제외 조건/CA 삭제 taint를 검사, Ready predicate는 stable 목록에 없음
- **원본 보정**: nodeIncludedPredicate는 제외 라벨 존재만 검사하지 않음. ParseBool true·parse 오류는 제외, 유효한 false는 이 조건에서 포함 가능. 나머지 predicates는 별도로 적용
- [shouldSyncUpdatedNode](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cloud-provider/controllers/service/controller.go#L693-L713): 라벨 문자열의 모든 변경이 아니라 **제외 판정 결과의 변화**와 providerID 변화. Ready 변화는 여기서 queue를 넣지 않음. 추가/삭제·informer 재동기·다른 Service 이벤트 경로를 부정하지 않음
- [KEP-3458](https://github.com/kubernetes/enhancements/blob/0c8d11e9a13e12d2ef75d2d78af5ac00d8189046/keps/sig-network/3458-remove-transient-node-predicates-from-service-controller/README.md)·kep.yaml: abrupt disconnect·클라우드 API 호출/제한 동기, v1.27 beta/v1.30 stable. 현재 후보 선택은 게이트 분기 없이 stable predicates 사용. health check·무중단·draining은 provider 공통 보장으로 확대하지 않음

### route·분리 경계·기본값

- [startRouteController](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cloud-provider/app/core.go#L104-L151): configure-cloud-routes off 또는 Routes 미지원이면 시작 안 함. 클러스터 CIDR 파싱·dual-stack 조합 등 생성 조건 확인
- [route controller](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cloud-provider/controllers/route/route_controller.go): PodCIDRs·Node addresses 소비, 관리 경로 작업 결과로 NetworkUnavailable 기록
- [KCM node lifecycle](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/nodelifecycle/node_lifecycle_controller.go): NetworkUnavailable True의 network-unavailable taint 매핑. CCM cloud node lifecycle과 처리 주체 구분
- [KCM nodeipam](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kube-controller-manager/app/core.go#L80-L152): nodeipam 유지, cloud nil 전달, CloudAllocator 거절. 역사 v1.35 동일 파일의 newServiceLBControllerDescriptor/newCloudNodeLifecycleControllerDescriptor/newNodeRouteControllerDescriptor stub과 현재 심볼 제거를 구분
- [cloud lifecycle defaults](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cloud-provider/controllers/nodelifecycle/config/v1alpha1/defaults.go)·[실제 옵션 파일](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cloud-provider/options/nodelifecycle.go): monitor 기본 5초/flag 연결. 원본의 예전 shared defaults 경로 대신 현재 별도 defaulting 확인
- shared defaults와 kubecloudshared 옵션의 configure-cloud-routes true/route-reconciliation-period 10초, service controller nodeSyncPeriod 100초 확인. 작업 주기와 성공 시간 상한 구분
- [KEP-2395](https://github.com/kubernetes/enhancements/blob/0c8d11e9a13e12d2ef75d2d78af5ac00d8189046/keps/sig-cloud-provider/2395-removing-in-tree-cloud-providers/README.md)·kep.yaml: 코어 SDK 의존/취약점 표면·독립 릴리스 동기, v1.31 stable. CSI의 다른 동기를 이 KEP에 추가하지 않음
- [cloud-provider cloud.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cloud-provider/cloud.go)·README·go.mod: module k8s.io/cloud-provider, Go 1.26.0, sibling k8s 의존 v0.0.0와 local replacements. 이것을 실제 외부 provider 의존 버전이라고 주장하지 않음. Go 인터페이스와 provider의 같은 바이너리 연결/호환 관리 경계 확인
- CNI SPEC snapshot `3ee5ddf6d892e4ee4205634c436a3c7e45629eb2`의 Execution Protocol: executable·stdin/stdout JSON
- CSI spec snapshot `25b3f10249abe6033887ed5177e856b9f73b1105`: CO와 gRPC endpoint의 RPC 계약. 프로토콜 형태만 비교하고 설치 버전·기능 지원으로 확대하지 않음

## 문체·원본 대조와 실행 검증

- 원문의 외부 API 자격/내부 API 권한, Ready/초기화/경로의 서로 다른 판단, taint/삭제 finalizer, 동기 할당/비동기 status, CNI/CSI와 Go 인터페이스 계약 차이를 보존
- 대표 문장: 원문 `중요한 경계는 클라우드 API에 접근할 자격과 Kubernetes 오브젝트를 갱신할 권한이며, 두 API에서 맡는 작업도 다르다.` → `경계는 클라우드 API를 호출할 자격과 Kubernetes API를 갱신할 권한이며, 둘 다 갖춰야 작업을 이어갈 수 있습니다`
- 별도 의사결정 섹션 미포함: 실제 구현 선정·실패 경험이 없고, 원본의 계약 비교·설계 동기를 기술 본문에 유지
- 본문 전체의 공식체·과장·번역투·반복·주체·조건·내부 맥락을 다시 읽어 점검. 모든 섹션의 표/그림 필요성을 재판단했으며 그림 수 할당 없음
- 최종 `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-cloud-controller-boundary.md`: exit 0, error 0/warn 1 — 100자 초과 줄 25곳(긴 URL·식별자 포함), 형식과 별도로 문맥 대조함
- Python ElementTree XML 파싱, SVG title/desc/role, 본문 이미지 2개·내부 글 링크 실존 검사 통과
- SVG text 수 12/11, 최소 font-size 둘 다 23px, 한글 라벨과 원어 식별자. 원본 ASCII의 초기화·Pod CIDR 경로를 변환하고 주소 status 예외/조건→taint 역할을 보강
- 기존 sharp 0.34.5로 각 SVG를 800px/375px PNG로 렌더 exit 0. 네 최종 PNG를 view_image로 모두 확인
- 첫 렌더에서 중간 단계 화살촉 누락·route 조건 라벨 뒤 선 겹침을 찾아 각 path 분리·라벨 배경으로 수정. 재렌더 후 375px/800px 모두 잘림·겹침 없이 순서·주체를 판별 가능
- `git diff --check -- <소유 글·SVG 2개>` exit 0. 원본/context 최종 SHA 재확인
- 문서 브라우저의 개요 URL fetch 실패는 고정 website 원문으로 대체해 읽음. 잘못 추정한 nodelifecycle/options/options.go 404는 실제 tree에서 options/nodelifecycle.go를 찾아 해결. 실패 응답을 사실 근거로 사용하지 않음
- `source-final.json`, `content-final.json`에 최종 원본/context/글/SVG SHA 저장

## 남은 문제

- 보류 사유 없음. 전체 lint/build/export·독립 검수는 작성자 단계에서 실행 안 함. 최종 통과·완료 편수 반영은 parent의 배치 검증 뒤 결정
- 실제 provider 구현·설치·cloud IAM·Kubernetes RBAC·LB health check·회수/생성 시간은 미실측이며 보장·경험으로 서술하지 않음


# Batch 15 · Phase 3-9 작성 인계

- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 3-9 · 트래픽 지역성과 dual-stack · 앞자리가 비면 떨어뜨리거나 되돌아간다.md`
- 2026-10-23 최신 609줄 전문 읽음. SHA-256 `bac8a51f0610504048812dd70e5a960f308a60083e6c087acb80fdb7a8bfceff`, sources.json과 실제 파일 일치
- 최신 progress의 현행 후속 및 source-map Phase 3의 3-9 본절·외부 자료·v1.37 대조 읽음. progress SHA `c3081510322928d79907275e31e02c0f4708ec606644bed7581006645d1d16f5`, source-map SHA `0458c79aa9dd7996a03d7babffc63068c5c3b5a7b16bc6906fc690b920f651bd`
- 글: `src/content/essays/kubernetes/k8s-theory-traffic-locality-dual-stack.md`, 276줄. plan의 매핑과 동일한 `k8s-theory-network` / order 10 / date 2026-10-23
- tags: Kubernetes, Service, EndpointSlice, TrafficPolicy, DualStack, concept
- SVG 2개: `-1.svg`는 Local 제약과 Cluster+PreferSameNode 예의 독립 후보 판정, `-2.svg`는 VIP·Slice·후보의 주소군별 대응. 원본 주 흐름 ASCII 1개 재구성, 능동 신규 1개. 표 6개, 실행 절차·가상 출력 없음
- draft-to-post 진입점·공동 절차·voice·plan/source-format·SVG 기준 적용. 같은 network 시리즈 Service 글의 후보·NAT·부재 처리를 다시 읽었고 모순 없음. 공통 문서·타인 파일 수정, commit/build/push 실행 안 함

## 실제 대조한 근거

| 대상 | 버전·ref |
|---|---|
| Kubernetes | v1.37.1 · `f78e722310e50bcaca9276be22276d9e91d91308` |
| website | 공식 저장본 · `7fde177e22dc98390a6d55d215dd0301b5f6d0bb` |
| enhancements KEP-563 | 조회 시 master를 고정한 `0c8d11e9a13e12d2ef75d2d78af5ac00d8189046` |

이전 배치의 Kubernetes/website 고정 ref를 확인해 재사용하되 자료는 이번에 다운로드하고 본문에 필요한 절·심볼을 실제 읽었다. 현재 공개 Virtual IPs·dual-stack 문서도 열어 v1.37 표시와 대조했다. 공식 자료 25파일 URL/ref/hash는 `manifest.json`·`manifest-extra.json`, 최종 25/25 hash 일치

최초 추정한 `pkg/proxy/endpoints.go` 1건은 404였다. 공식 `pkg/proxy` 목록을 조회해 실제 `endpointschangetracker.go`를 확인하고 다운로드해 주소군 필터를 대조했다. 실패 경로는 인용하지 않으며 `proxy-inventory.json`에 경로 확인 기록 보존

- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/topology.go — 전문 확인. CategorizeEndpoints의 Cluster/Local 독립 Ready→Serving-Terminating, 전체 usable 판정, topologyModeFromHints의 Ready 전체 완전성·자기 노드/zone 매치, availableForTopology에서 fallback하지 않음
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/iptables/proxier.go — syncProxyRules의 ServicePort 루프·정책별 집합·REJECT/DROP·masqueradeAll·off-cluster ClusterIP·일반 외부 masquerade와 Local의 Pod/host short-circuit, 로컬 후보 Gauge 집계/Set. nftables/proxier.go의 대응 부재 verdict와 지표 Set도 대조
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/metrics/metrics.go — SyncProxyRulesNoLocalEndpointsTotal은 GaugeVec/Alpha, traffic_policy·ip_family 라벨. 패킷 Counter로 설명하지 않음
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/endpointslice/trafficdist/trafficdist.go — 전문 확인. Ready endpoint의 자기 zone·선택적 node 힌트, 불필요 힌트 제거. topologycache/topologycache.go의 SetNodes·getAllocations에서 Auto의 Ready/제외 노드·CPU/zone 전제·overloadThreshold 0.2 계산 대조
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/endpointslice/reconciler.go — 주소군별 reconcile·빈 placeholder, validTrafficDistribution, Auto 우선·trafficDistribution 힌트 생성. controller/endpointslice/endpointslice_controller.go에서 ExternalName·selector 없는 Service 자동 생성 제외와 게이트 옵션 전달 대조
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go — PreferSameTrafficDistribution v1.35 GA true 잠김이 현재도 등록됨. ServiceTrafficDistribution 키 없음. 현재 topology.go의 종료 후보 fallback에는 ProxyTerminatingEndpoints 게이트 분기가 없음
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/core/v1/types.go — 두 TrafficPolicy 필드·출발지에 따른 특수 경로 주석, trafficDistribution 세 상수와 낡은 필드 주석, IPFamilyPolicy·IPFamilies·ClusterIPs 및 Node/Pod의 첫 항목 대응. core/v1/defaults.go에서 두 정책 Cluster 기본값 대조
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/discovery/v1/types.go — addressType·불변·IPv4/IPv6/FQDN 경계, Ready/Serving/Terminating nil 해석, forZones/forNodes. discovery/validation/validation.go의 주소군 필드 불변 검증 대조
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/endpointslice/utils.go — podToEndpoint가 Pod Ready·deletionTimestamp·publishNotReadyAddresses로 조건 생성, getAddressTypesForService의 계열 선택. proxy/endpointslicecache.go의 nil 조건 해석·ServicePort 분류, endpointschangetracker.go의 프록시 주소군과 다른 Slice 제외 대조
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/service/storage/alloc.go — initIPFamilyFields의 신규/갱신 기본값 구분, 일반 VIP RequireDualStack 검사·지원 주소군 확인, headless+selectorless RequireDualStack 기본화 및 일반 allocator 검사 전 복수 family 허용 특수 경로
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go — ValidateServiceClusterIPsRelatedFields, validateUpgradeDowngradeClusterIPs/IPFamilies, headless·ExternalName 예외. Pod IP·host IP의 첫 항목 서버 검증도 대조했으나 본문은 표에서 타입 대응을 제시하고 Service 검증을 중심으로 설명
- https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/reference/networking/virtual-ips.md — Traffic policies/distribution/terminating 절. service-traffic-policy.md·topology-aware-routing.md·dual-stack.md·endpoint-slices.md·dns-pod-service.md의 해당 조건과 계열별 A/AAAA·Slice 수/재사용 대조
- https://github.com/kubernetes/enhancements/blob/0c8d11e9a13e12d2ef75d2d78af5ac00d8189046/keps/sig-network/563-dual-stack/README.md — Service IP allocation·mutability·primary 유지·첫 Service CIDR 계열 유지. 현재 구현 근거와 과거 설계 규칙을 분리

## 원본 대비 보존·정정·한정

1. 노드·ServicePort·IP family 단위의 후보 판정, Cluster/Local 독립 집합, 전체 usable 없음 REJECT와 Local 후보 부재 DROP은 최신 원본의 조건을 보존하고 v1.37.1 iptables·nftables에서 재대조했다. 클라이언트 오류·timeout은 고정하지 않음
2. 원본의 “클러스터 안 ClusterIP 트래픽은 출발지가 원래 안 바뀐다”를 절대 규칙으로 옮기지 않았다. masqueradeAll·off-cluster source·외부 주소를 부르는 Pod/host 특수 경로가 있어, 일반 외부 유입의 출발지 보존과 내부 Local의 경로 제한을 구분했다. 앞단 LB의 기존 SNAT 복원도 보장하지 않음
3. `_total` 지표를 누적 실패 횟수로 설명하지 않았다. GaugeVec이며 두 proxier의 ServicePort 루프에서 로컬 후보 부재 항목을 세고 traffic_policy/ip_family별 현재 값을 Set한다. 패킷·실패 연결 수나 고유 Service 수로 고정하지 않음
4. Ready·Serving·Terminating의 nil 해석과 publishNotReadyAddresses 예외를 보충했다. Cluster Ready가 전역에 없을 때 Serving-Terminating fallback, Local Ready가 로컬에 없을 때 로컬 Serving-Terminating fallback은 독립이다. 원격 Ready가 있어도 로컬 종료 후보가 쓰일 수 있음
5. 공식 draining 문서의 예전 ProxyTerminatingEndpoints 게이트 문구와 현재 코드의 무게이트 분기를 분리했다. LB의 다음 상태 검사 전 로컬 종료 후보 전달이 draining을 돕는 목적은 보존하되 앱/LB 조건 없는 무손실 종료 보장은 하지 않음
6. PreferSameNode→zone→cluster의 모드 결정과 Ready 전체 힌트 완전성을 보존했다. 노드 힌트 불완전만으로 곧바로 cluster fallback한다고 쓰지 않음. 부분 힌트를 배제하는 설계 이유에 대한 원본의 과부하 추론을 검증된 인과로 승격하지 않았다
7. Auto의 CPU 비율·0.2 추정 계산과 trafficDistribution의 실제 zone/node 힌트 생성을 분리했다. Auto 우선 및 Local은 해당 방향에서 선호보다 우선함을 현재 Reconciler/CategorizeEndpoints로 대조했다. topology-aware-routing 문서의 “동일 Service와 Local 동시 사용 불가”라는 넓은 설명보다 현재 virtual-ips와 코드의 방향별 동작으로 한정
8. PreferSameTrafficDistribution GA true 잠김은 보존하고 없어진 ServiceTrafficDistribution 키를 현재 활성화 절차로 쓰지 않았다. PreferClose는 deprecated이지만 유효한 동의어다. 같은 파일의 필드 주석이 아직 한 값만 적는 차이도 보존
9. 일반 VIP의 새 Service 정책 표에만 SingleStack 기본·PreferDualStack fallback·RequireDualStack 실패를 적용했다. VIP 존재는 주소군별 CNI·노드/LB 경로·백엔드 준비의 보장이 아니다. 준비된 두 주소군을 요청한 모든 잘못된 조합이 성공한다고도 쓰지 않음
10. headless+selectorless 신규 생성은 RequireDualStack 기본값이며 single-stack Service 할당 구성에서도 복수 family를 허용하는 현재 특수 경로다. 모든 headless는 VIP primary 변경 검증과 다른 취급을 받는다. 이 예외를 일반 VIP의 primary 불변/RequireDualStack 실패 설명에서 분리했다
11. selector가 있는 관리 경로의 주소군별 Slice·빈 placeholder와 selectorless 외부 관리 책임을 구분했다. Slice 수를 VIP 수와 같게 고정하지 않았고, ipFamilies[0]을 DNS 응답 우선순위·클라이언트의 주소 선택 보장으로 확대하지 않음
12. KEP-563의 headless+selectorless 기본값은 과거 PreferDualStack 서술이지만 현재 문서·alloc.go는 RequireDualStack이므로 현재 구현으로 설명했다. 원본의 단수 ipFamily tombstone 원인 미확인은 추정으로 메우지 않았고 본문에서 그 역사 인과를 단정하지 않음. 관리 메타·자가 판정·LAB·내부 편집 경위·실측/성능 수치 창작 제외

## 대표 문장

원문: “클러스터 안에서 Pod 가 ClusterIP 를 부를 때는 출발지가 원래 안 바뀐다. 그래서 internalTrafficPolicy: Local 은 출발지로 살 것이 없다. 남는 이유는 경로뿐이다”

변환: “일반적인 Pod의 ClusterIP 호출은 외부 유입과 같은 masquerade를 항상 요구하지 않습니다 / 그래서 internalTrafficPolicy: Local의 주된 목적은 출발지 복원보다 노드를 넘는 경로를 피하는 데 있습니다 / iptables의 masqueradeAll 설정이나 클러스터 밖 출발지가 ClusterIP로 들어오는 처리 등은 별도로 남으므로 내부 통신은 절대 SNAT되지 않는다고 일반화하면 안 됩니다”

이유: 원본의 두 Local의 목적 구분을 보존하되 현재 NAT 분기가 허용하는 예외를 누락하지 않았다

## 검증·잔여 문제

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-traffic-locality-dual-stack.md` 실제 실행 exit 0, error 0 / warn 1. 긴 줄 25곳은 대부분 고정 근거 URL과 필요한 조건이며 문맥 검토 후 보존. `lint-post.log`
- SVG 2개 XML 파싱·title/desc·참조 실존 통과. 최소 20px / 560폭으로 375폭 명목 최소 13.39px. sharp 원본/375폭 PNG 4개 렌더 후 모두 육안 검사, 잘림·겹침 없음. text 개수 14/12
- 전 섹션 시각화 재검토: 후보 판정 흐름·주소군 대응은 SVG, 필드/부재/조건/정책/단수 대응/확인 기준은 표, 기전·예외·책임은 산문. 그림·표 뒤 같은 내용을 반복하는 결론과 용어 사전 중복 제거
- 원본·문체·기전·예외·과장·실측 창작 문맥 점검. 내부 링크 1개·이미지 2개 실존, 문단 끝 마침표 0. `output-checks.json`에 글/SVG/source hash·XML·참조·문체 형식 검사 결과
- Decision section 미포함: 실제 도구 선정·대안 검토 경험 없이 정책·주소군 동작을 설명하는 글
- 핵심 근거 부족 보류 없음. 실제 CNI·proxy mode·게이트 설치·주소 할당 결과·DNS/클라이언트 선택·LB draining·지연/비용 실측은 확인하지 않았고 보장하지 않음. 단수 ipFamily만 제거한 역사적 이유와 부분 힌트 배제의 직접 설계 인과는 미확인으로 유지
- 전체 lint·build·정적 출력·별도 reviewer 실행 안 함. 독립 검수와 parent 통합 검증 대기이며 완료 편수 포함은 그 이후 판정


# Batch 15 · 3-10 ServiceCIDR/IPAddress 인계

- 상태: 작성·개별 검증 통과, 별도 reviewer 및 배치 lint·build·정적 출력 검증 대기
- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 3-10 · ServiceCIDR 와 IPAddress · 이름이 곧 자물쇠다.md` 전문 595줄
- 원본 SHA-256: `99664b9fe305bc6a4779497215136cd8633a04c948d3141a62f3d8964cf8b8e8` 작업 전·후 일치
- 출력: `src/content/essays/kubernetes/k8s-theory-service-cidr-ip-address.md`, 같은 slug SVG 2개 / 표 5개
- series `k8s-theory-network` order 11 / date `2026-10-23` / 첫 태그 Kubernetes
- 최신 progress·Phase 3 source-map 및 plan/source-format·draft-to-post 공동 절차·writing-voice·SVG 기준 적용. 공통 파일 수정 없음

## 확인한 공식 근거

- Kubernetes v1.37.1 tag의 annotated tag `d2b770f4c94636a992534a8d3156b6b2d8e82ac3`를 실제 조회해 commit `f78e722310e50bcaca9276be22276d9e91d91308`로 resolve 확인
- website `7fde177e22dc98390a6d55d215dd0301b5f6d0bb` commit 유효 응답 확인, 현행 kubernetes.io v1.37 표시 및 고정 Markdown 대조
- [networking/v1 타입](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/api/networking/v1/types.go)·라벨·[validation](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/networking/validation/validation.go): 두 리소스 cluster scope/v1, IPAddress parentRef·불변·status 부재, ServiceCIDR 1~2 CIDR·계열별 하나·1→2 예외 및 기존 인덱스 보존. v1 기본 등록/v1beta1 기본 off와 IPAddress /status 부재는 instance.go·REST storage에서 확인
- [IP 정규형 검사](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/util/validation/ip.go): strict parse 후 canonical string 대조. 선행 0 IPv4의 실제 오류가 반드시 canonical 메시지라고 쓰지 않음
- [Allocator](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/service/ipallocator/ipallocator.go): Create/AlreadyExists→ErrAllocated, 정적 범위 검사·ready/informer 조건, 동적 무작위 시작·캐시 조회·충돌만 다음 후보·그 외 Create 오류 반환, Release 삭제 오류 로그 후 nil, IPv6 prefix<64 거절
- [calculateRangeOffset](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/service/ipallocator/bitmap.go): 전체 cidrSize<=16이면 0, 그 외 min(max(16,size/16),256). IPv4 network/broadcast·IPv6 첫 주소 제외는 실제 할당기에서 별도 확인
- [MetaAllocator](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/service/ipallocator/cidrallocator.go): 동일 CIDR 문자열별 map·여러 ServiceCIDR 참조, 겹치는 다른 CIDR은 별도 할당기, 계열별 순회·Ready/삭제 상태 반영, 이행기의 bitmap 선행 쓰기
- [Service beginCreate/afterDelete](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/service/storage/storage.go)·[alloc.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/service/storage/alloc.go): IP 확보→Service 저장, commit/revert, headless/ExternalName 미할당, 계열별 할당과 primary 반영·지원 계열 검증. Service/IPAddress를 묶는 원자적 트랜잭션 아님
- [기본 대역 컨트롤러](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controlplane/controller/defaultservicecidr/default_servicecidr_controller.go): --service-cluster-ip-range→kubernetes, single→dual 예외, 불일치 시 상태를 덮지 않는 Event·Ready=False 덮어쓰기 회피
- [ServiceCIDR 삭제 컨트롤러](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/servicecidrs/servicecidrs_controller.go)·[포함 검사](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/api/servicecidr/servicecidr.go): finalizer, 각 CIDR의 전체 대역 포함 검사→계열/관리자 라벨 IPAddress의 고아 검사, Terminating, deletionTimestamp 기준 10초. 개별 주소는 network/IPv4 broadcast 제외
- [repairip.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/service/ipallocator/controller/repairip.go): 양방향 대조·오참조/라벨 보정·managed-by 역방향 제한, Service 부재 60초·ExternalName 전환 일부 60초·기존 Service보다 새 IPAddress의 5초 미만 경합 재예약, Service 자동 재주소화 없음·Event 경계
- [feature gate](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go)·[실제 초기화](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/rest/storage_core.go): MultiCIDRServiceAllocator/DisableAllocatorDualWrite true·GA·잠김 및 실제 등록 잔존, MetaAllocator/RepairIPAddress 선택·이중 쓰기용 bitmap 미생성
- [ServiceCIDR strategy](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/networking/servicecidr/strategy.go): ServiceCIDRStatusFieldWiping 1.36부터 Deprecated true·잠김 아님, 활성 시 root create status 제거/root update 이전 status 유지, /status 별도
- [플래그 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kube-apiserver/app/options/validation.go)·[KEP-1880](https://github.com/kubernetes/enhancements/blob/0c8d11e9a13e12d2ef75d2d78af5ac00d8189046/keps/sig-network/1880-multiple-service-cidrs/README.md): 과거 maxCIDRBits20 검사·현재 bypass와 이행 설계를 구분
- [현행 virtual-ips](https://kubernetes.io/docs/reference/networking/virtual-ips/#ip-address-objects)·[대역 확장](https://kubernetes.io/docs/tasks/network/extend-service-ip-ranges/)·[정적/동적](https://kubernetes.io/docs/concepts/services-networking/cluster-ip-allocation/)·[기본 대역 재구성](https://kubernetes.io/docs/tasks/network/reconfigure-default-service-ip-ranges/): 현재 API·역이행 미지원·조건 대조. 문서의 OrphanIPAddress 예시와 소스 Terminating 차이는 본문에 고지

## 원본 대비 정정·보존

- 이름이 잠금이라는 비유는 같은 리소스 이름에 대한 API Create의 배타성으로 한정. 전체 생성 원자성·로컬 mutex 부재로 확대하지 않음
- IPAddress 존재는 주소 확보 기록이며 parentRef의 실재/정합성 증명은 별도. parentRef와 ownerReferences/GC, 사용자 참조·관리자 라벨을 구분
- ‘겹치는 대역은 할당기 하나’로 읽히던 부분을 동일 CIDR 문자열 공유와 단순 overlap의 별도 allocator로 정확히 구분
- 60초는 모든 오참조의 보편적 삭제 타이머가 아님. 현재 5초 경합 분기·ExternalName 예외와 Service 부재 기준 시각을 보완
- 동적 range full은 다른 대역의 준비 상태·순회도 함께 확인, allocator not ready는 informer 동기화도 포함. 캐시 없음이 최종 미할당 증명은 아님
- cidrs 주석의 불변과 실제 1→2 예외, 기본 대역 single→dual 갱신과 일반 불일치 Event, 10초 전파 유예와 전체 종료 시각을 구분
- v1.35/1.37은 두 gate가 잠겨 이중 쓰기 없음. 남은 코드·제거 예정 주석·KEP 계획을 실제 실행/제거로 바꾸지 않음. 옛 bitmap 레코드가 물리적으로 삭제됐다는 검증은 하지 않아 주장하지 않음
- 미확인 보존: KEP의 IPv6 /112·약 32k와 남은 플래그 검증 20 host bits의 역사적 수치 차이 이유. 현재 IPv6 최소 prefix /64와 별개이며 현재 최대 Service 수로 사용하지 않음
- 대표 문장: 원본 ‘로컬 사본은 어디를 시도할지를 고르는 데만 쓰고, 맞는지는 쓰기가 판정한다’ → ‘따라서 캐시는 어디를 시도할지 정하는 데 쓰이며, 최종 확보 여부는 API 쓰기가 판정합니다’

## 검증·한계

- 원본 전문·조건·기전 및 공통 voice 대조, 내부 Phase/편집 경위 제거. 미실행 LAB 8개·측정·경험 창작 없음
- 전 섹션 시각화 재검토: 확보 순서/주소 구간은 SVG, 삭제 검사/repair 범위 등은 표·산문으로 설명
- SVG 2개 XML·접근성 role/title/desc, sharp 600px/375px 네 렌더 성공. 모두 직접 육안 검사해 겹침/잘림 없음, 375px 최소 글자 13.125px
- 최종 본문 `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-service-cidr-ip-address.md`: 실제 실행 error 0 / warn 1(100자 초과 16곳, URL/표/조건 문맥 검토)
- 성공한 공식 파일 25개 SHA-256과 원본 hash 최종 대조. 파일별 URL/ref/hash는 manifest.json, 버전 API 응답은 kubernetes-tag*.json·website-ref.json, 검증 요약은 verification.json
- 선택지 비교 섹션 미포함: 원본의 이행 설계와 반사실 설명만 유지, 별도 도구/설계 대안 목록을 추가하지 않음
- 핵심 기전 근거의 보류 사유 없음. 실제 클러스터 설정/범위·gate·할당/삭제/repair·지연은 실행 확인하지 않음
- 전체 lint·build·정적 출력·독립 reviewer·커밋은 parent 담당이며 이 보고서의 개별 검사와 구분


## 별도 blog-reviewer 검수

# Review: Batch 15 · 3 posts / 6 SVG

## P0 필수 수정

- 0건

## P1 확인 필요·권장

- 확인 필요 0건 / 권장 0건
- KEP-1880의 역사적 IPv6 `/112`·약 32k와 남은 20 host bits 검증 수치의 차이 이유는 본문에서 미확인으로 구분함. 현재 주소 범위나 Service 최대 수의 근거로 사용하지 않아 보류 대상이 아님

## 원본·문체·연결

- `sources.json`의 정확한 Vault 원본 세 파일 전문 676·609·595줄과 최종 글을 대조. 실제 SHA-256·줄 수 모두 일치
- 공통 writing-voice·draft-to-post·source-format·시리즈 plan·SVG 기준 적용 확인. 질문·설계 이유·실패 판별을 보존하고 LAB TODO·측정·개인 경험을 실행 결과로 만들지 않음
- 원본의 v1.35 설명과 현재 v1.37.1 정정 근거를 분리했으며 문서에 이미 보완된 내용을 현행 오류로 반복하지 않음
- 반말 문맥·과장·직역·불필요한 표 재서술·내부 문서 좌표·설명 없는 단계명 문제 없음. 용어·가정 예시·지원 조건을 문맥에서 설명함
- 세 slug 유일, essays/kubernetes 경로와 `k8s-theory-network` order 9·10·11 일치. 같은 시리즈가 logs로 분리되지 않음
- 기존 Service/kube-proxy 글의 할당/전달·Local 출발지 보존 범위·NodePort 조건, CNI 글의 런타임/플러그인·NodeIPAM 구분과 모순 없음

## 핵심 기술 재검증

- 공통 기준: Kubernetes v1.37.1 `f78e722310e50bcaca9276be22276d9e91d91308`, website `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`. 작성자 보고서 외에 해당 고정 소스·공식 문서를 실제 읽고 대조함
- CCM: [syncNode·getInstanceMetadata](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cloud-provider/controllers/node/node_controller.go)에서 초기화 필드+taint 제거의 단일 Update, 사전 주소 검증·후속 별도 status patch, InstancesV2 nil/빈 providerID의 기존 Node fallback과 이전 Instances의 NotImplemented 예외 확인
- [cloud node lifecycle](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cloud-provider/controllers/nodelifecycle/node_lifecycle_controller.go)의 Ready True 우회, 조건 없음/False/Unknown 질의, 부재/오류/종료 taint를 구분함. [현행 CCM 문서](https://kubernetes.io/docs/concepts/architecture/cloud-controller/)가 node/node lifecycle 분리를 이미 설명함을 확인
- [service controller](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cloud-provider/controllers/service/controller.go)의 class nil 신규 대상과 cleanup 예외, finalizer→Ensure→status, 안정 노드 predicates·ParseBool false/true/오류, 제외 결과/providerID 변경에 따른 재동기 확인. Ready 변화만으로 후보 제외를 보장하지 않음
- class의 LB→LB 불변과 타입 전환 정리는 validation/strategy에 맞음. pending은 status와 externalIPs의 표시 조건이며 외부 처리 완료를 뜻하지 않음
- KCM nodeipam의 cloud nil·CloudAllocator 거절, CCM route의 활성화/Routes 조건과 NetworkUnavailable 기록·KCM taint 분업, CNI/CSI 프로토콜과 cloud provider Go 인터페이스의 차이를 실제 소스·계약에서 확인
- 지역성: [CategorizeEndpoints·topologyModeFromHints](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/topology.go) 전문과 iptables/nftables의 정책 집합·NAT 예외·REJECT/DROP 분기를 대조. Local은 원격 fallback 없이 로컬 Ready→Serving-Terminating, Cluster fallback은 독립적이며 힌트 완전성·node→zone→전체 모드 판정 조건을 보존함
- [metrics.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/metrics/metrics.go)의 `_total` 이름 GaugeVec과 양 proxier의 ServicePort 루프 집계/Set 확인. 패킷·실패 연결 Counter로 설명하지 않음
- trafficdist의 Ready endpoint zone/node 힌트와 Auto CPU 비율 추정·0.2를 분리하고, Auto 우선·Local 대응 방향의 우선성을 조건과 함께 설명함
- [Service 할당](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/service/storage/alloc.go)에서 일반 VIP 정책·RequireDualStack 실패와 headless+selectorless RequireDualStack 기본/단일 할당 구성 예외를 직접 대조. 주소군별 Slice·placeholder·selectorless 관리, primary 검증과 DNS/클라이언트 선택의 경계도 일치함
- ServiceCIDR: [createIPAddress·동적 할당·해제](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/service/ipallocator/ipallocator.go), Service beginCreate/txnAllocClusterIPs의 두 쓰기·revert 대조. 정규형 이름의 Create 유일성과 parentRef 정합성 검사를 구분하며 Create 비충돌 오류도 반환함
- [MetaAllocator](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/service/ipallocator/cidrallocator.go)의 동일 CIDR 문자열 공유·단순 overlap 별도 allocator, 준비·계열별 순회, 현재 두 GA 잠김 gate의 bitmap 이중 쓰기 비활성 분기를 확인
- [삭제 컨트롤러](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/servicecidrs/servicecidrs_controller.go)의 전체 대역 포함→관리 라벨 IPAddress 검사와 deletionTimestamp 기준 10초, [repair](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/service/ipallocator/controller/repairip.go)의 Service 부재 60초·ExternalName 일부 유예·새 주소 5초 경합 조건 확인. Service 자동 재주소화나 고정 종료 시간으로 확대하지 않음
- ServiceCIDR 1→2 갱신 예외·status wiping 조건, 기본 대역 불일치 Event, 옛 maxCIDRBits 검사 bypass·현행 IPv6 최소 prefix /64를 실제 validation/strategy/initialization에서 확인. [현행 확장 작업 문서](https://kubernetes.io/docs/tasks/network/extend-service-ip-ranges/)의 OrphanIPAddress와 소스 Terminating 차이를 본문에서 구분함

## 실제 검증

- 최초 완료 파일부터 개별 lint 후, 최종 3편 `npm run lint:post -- <위 세 파일>` 실제 실행 exit 0 / error 0 / warn 3. 원시 출력 `review-lint.log`
- 경고는 100자 초과 줄 각각 25·25·16곳이며 URL·표·조건 문맥 검토 후 추가 분리 요구 없음
- SVG 6개 XML·role/title/desc 확인. 기존 sharp로 각각 800px·375px PNG를 새로 생성하고 12개 모두 실제 육안 확인: 순서·정책 범위·주소군·주소 경계 일치, 겹침·잘림 없음
- `reviewer-render/inputs.json`의 렌더 입력과 최종 SVG hash 동일. `review-hashes.json`은 최종 글 3개·SVG 6개 총 9개 평면 SHA-256 매핑
- 원본 3개 및 유효 근거 캐시 89개 hash 모두 일치(cloud 39, locality 25, service-cidr 25). 최초 404 2건은 근거에서 제외하고 실제 경로로 해소함. ServiceCIDR manifest의 hash 없는 API 메타 2건은 이 89개에 포함하지 않음
- 파일별 URL/ref/hash는 각 작성 폴더의 `manifest*.json`, 대조 결과는 `reviewer-evidence-checks.json`
- 전체 lint·build·정적 출력·클러스터/클라우드 실습·commit은 reviewer가 실행하지 않았으며 parent의 통합 검증 대상

## 요약

- 최종 미해결 필수 0건 / 확인 필요 0건 / 권장 0건
- 검토 대상: 글 3개·SVG 6개 / 레거시 제외 0개 / 콘텐츠 수정 없음


## 실제 최종 검증

- `npm run lint:post -- <이 배치 3편>`: exit 0, error 0 / warn 3
- `npm run lint`: exit 0, error 0 / warn 1 (기존 `src/app/layout.tsx:80` custom font 경고)
- `npm run build`: exit 0, TypeScript·정적 생성·postbuild 성공, 634 pages
- 원본 SHA-256·검수 후 글/SVG와 빌드 입력 hash 일치
- slug 유일성·시리즈 order 연속성·내부 링크·이미지 실존·SVG XML/접근성 메타 검사 통과
- `getAllPosts`·`getEssaysList`·`getSearchIndex` 실제 실행: 3편 모두 essays로 등록, 목록·검색 객체에 content 없음
- HTML 3개·SVG 6개 실제 export 및 `/my-blog/diagrams/` 참조·SVG 바이트 일치
- sitemap·llms 3편 반영, RSS는 기존 최신 20편 정책과 실제 출력 일치
- `git diff --check` 통과
- prebuild의 이번 CLAUDE.md 자동 통계 변경만 복원, Vault 원본 변경 없음
- build의 Node `DEP0205 module.register()` 및 로컬 TS 직접 import의 `MODULE_TYPELESS_PACKAGE_JSON` 경고는 남아 있으며 애플리케이션 설정을 범위 밖에서 바꾸지 않았다
- 클러스터 실습·통합 테스트·성능 실측·push·배포·시리즈 카드 등록: 실행 안 함

원시 로그·임시 근거 저장본: `/tmp/k8s-batch15/`
영구 재확인 경로는 위 글과 작성 기록의 공식 소스 URL이다

## 다음 대상

- `Phase 4-1 · PVC 바인딩과 StorageClass · claimRef 를 먼저 쓰는 쪽이 정한다.md` → `k8s-theory-pvc-storageclass-binding` (`k8s-theory-storage` / 1)
- `Phase 4-2 · CSI 구조 · 코어는 노드 쪽 절반만 부른다.md` → `k8s-theory-csi-architecture` (`k8s-theory-storage` / 2)
- `Phase 4-3 · attach 와 stage 와 publish · 한 번씩이 서로 다른 한 번이다.md` → `k8s-theory-volume-attach-stage-publish` (`k8s-theory-storage` / 3)
