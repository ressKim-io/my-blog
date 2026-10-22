# Batch 07 인계 — 2026-10-23

3편 검수 완료, SVG 6장. 콘텐츠 커밋 `cc7ff41`
이번 요청 누적 3/30편, 전체 시리즈 누적 29편

## 원본·결과 대응

원본 루트: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/`
읽기 전용으로 사용했으며 작업 전후 hash 일치를 검증했다
작성 기준일은 2026-10-23이며 학습일·배포일을 뜻하지 않는다

| 좌표 | 원본 파일 | 줄 수 | SHA-256 | slug | series / order |
|---|---|---:|---|---|---|
| 2-4 | `Phase 2-4 · kubelet 과 Pod 수명주기 · 노드 위에서 살아 있다는 판정.md` | 659 | `bce8fc11320b26adae17beab7f4648ae8c2e1ed3f970b404f0ac66708876e02f` | `k8s-theory-kubelet-pod-lifecycle` | `k8s-theory-node` / 4 |
| 2-5 | `Phase 2-5 · QoS 와 cgroup · 장부가 되는 숫자와 울타리가 되는 숫자.md` | 708 | `47742b882f35604f1e68c4fe96dffa0aac0e54d10abc0cef3f2f4d2334c897da` | `k8s-theory-qos-cgroups` | `k8s-theory-node` / 5 |
| 2-6 | `Phase 2-6 · eviction 과 OOM · 죽이는 쪽이 셋이다.md` | 545 | `6587bc108a54472f1ecb1f22103b60e9dd65b79aea7eb2e77c3dbdc8afabf295` | `k8s-theory-eviction-oom` | `k8s-theory-node` / 6 |

글 경로는 `src/content/essays/kubernetes/{slug}.md`, SVG는 `public/diagrams/{slug}-{n}.svg`다

## 작성자의 근거 대조·편집 기록

# Batch 07 · Phase 2-6 작성 인계

- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 2-6 · eviction 과 OOM · 죽이는 쪽이 셋이다.md`
- 2026-10-23 최신 저장본 545줄 전문 읽음, SHA-256 `6587bc108a54472f1ecb1f22103b60e9dd65b79aea7eb2e77c3dbdc8afabf295`
- 원본은 읽기 전용으로 보존. progress의 Phase 2 해당 행, source-map 본체 R140·Phase 2의 2-6 및 최신 2-5·2-6 보완, 10-05 편집 인계 관련 기준을 대조함
- 글: `src/content/essays/kubernetes/k8s-theory-eviction-oom.md` 282줄
- series/order/date: `k8s-theory-node` / 6 / 2026-10-23
- tags: Kubernetes, Eviction, OOM, kubelet, cgroup, concept
- SVG 2개: `public/diagrams/k8s-theory-eviction-oom-{1,2}.svg`. #1 세 종료·삭제 경로(원본 흐름 재작성), #2 축출 발동 전 대기와 종료 유예(능동 판단 신규 1개). 표 6개
- 공통 문서·타 담당 파일 수정 없음. commit/build/push 실행 안 함. 독립 검수·통합 검증은 주 담당에게 인계

## 확인한 고정 근거

Kubernetes v1.37.1 `f78e722310e50bcaca9276be22276d9e91d91308`, website `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`의 공식 raw 파일 22개를 실제 내려받아 읽고 `manifest.json`에 URL·SHA-256을 보관했다. 다시 계산한 파일 hash가 22/22 일치한다

- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/eviction/eviction_manager.go — `Admit`, `synchronize`, `evictPod`, local storage limit 축출, 1초 override, cleanup 30초/1초
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/eviction/helpers.go — `rankMemoryPressure`, `exceedMemoryRequests`, `memory`, `memoryUsage`, 통계 누락 우선, 조건 유지·발동 유예 분리
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/eviction/api/types.go — 9개 내부 신호와 기본 memory.available 정의
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/eviction/defaults_linux.go — Linux hard 기본 맵 5개
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/eviction/threshold_notifier_linux.go — cgroup v2 disabled notifier
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_container.go — `toKubeContainerStatus`, `killContainer`, `executePreStopHook`; `kuberuntime_manager.go`의 최소2초 상수도 확인
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/server/stats/summary.go — hugepage capacity 차감과 0 하한
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go — HugepageAwareEviction·KubeletPSI 이력
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/types/pod_update.go — static/mirror/system priority critical 판정
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/podgc/gc_controller.go — 임계값 양수·초과 개수의 종료 Pod 정리
- `cmd/kubelet/app/{options/options.go,server.go}`, `pkg/kubelet/apis/config/v1beta1/defaults.go`, `cm/node_container_manager_linux.go`, `registry/core/pod/storage/eviction.go`도 실제 대조: 플래그·기본값·예약 계산·Eviction 삭제 경로
- https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/scheduling-eviction/node-pressure-eviction.md — 신호·inactive_file·기본값·hard0s·QoS/순위
- 같은 website ref의 API-initiated Eviction, Disruptions, Pod Lifecycle, Reserve Compute Resources 문서 대조
- https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/ — 현재 공식 웹 문서도 열람
- https://docs.kernel.org/admin-guide/cgroup-v2.html — memory.max·memory.oom.group·memory.events 직접 열람

## 원본 대비 정정·한정

1. **문서와 구현의 hard 유예 차이 보존**: 문서 hard `0s`, manager override `1`초, preStop 양수 조건, 이후 runtime 최소2초를 각 단계로 구분했다. source-map의 오래된 “실제로는 2초”를 총 종료 시간 보장으로 옮기지 않음
2. **soft의 두 시간 구분**: 부족 상태 지속 대기와 Pod 선택 후 종료 override는 별도다. 작은 값 수식은 max가 0 이상인 범위로 명시했다. CLI의 음수 설명까지 검증한 것처럼 일반화하지 않음
3. **현재 memory.available 보정**: 원본의 단순 `capacity-workingSet`에 v1.37 Beta/default on HugepageAwareEviction의 node AvailableBytes 보정·0 하한을 추가했다. active file까지 모두 제외하는 캐시 일반화와 “캐시만으로 축출이 안 난다” 실습 가설은 배제함
4. **feature gate 갱신**: 원본의 v1.34 Beta 표를 KubeletPSI v1.36 GA/default true로 갱신했다. 현재 eviction 신호·경로는 PSI 임계값을 쓰지 않는다는 범위를 구분함
5. **critical 보호의 실제 범위**: 현행 `IsCriticalPod`는 static·mirror도 true다. 웹 문서의 static Pod 축출 가능 설명과 구현 범위가 다르므로, 본문은 확인한 고정 소스의 guard를 기준으로 명시함. 이 guard를 모든 OOM 원인 보호로 확대하지 않음
6. **한 주기에 한 Pod의 범위**: node-pressure 임계값 루프만 해당한다. 그보다 앞선 local storage limit 축출은 복수 Pod를 반환할 수 있음을 명시함
7. **순위의 정확한 값**: 통계를 얻은 Pod의 요청 초과 여부→priority→`workingSet-request` 절대량이며 비율이 아님을 명시했다. 통계 자체가 없는 Pod를 먼저 고르는 예외도 보존함
8. **OOM과 삭제 구분**: 커널은 프로세스를 종료하고 런타임이 종료 상태를 보고한다. 그룹 종료 조건을 한정했다. 137만으로 OOM 확정, OOMKilled만으로 자기 memory.max 초과 확정, 오브젝트 부재만으로 API eviction 확정을 하지 않음
9. **DisruptionTarget 범위**: TerminationByKubelet은 node-pressure 전용이 아니며 local storage limit 축출은 조건이 없을 수 있다. Failed+Evicted와 삭제 이력을 함께 확인함
10. **조건 유지·admission 경계**: soft 지속 유예 전에 압박 조건이 보고될 수 있으며 마지막 관찰 후5분 유지와 새 배치 시점 보장은 구분했다. eviction manager admission 허용이 전체 스케줄링·다른 admission 통과를 보장하지 않음을 명시함
11. 종료판정·LAB TODO·학습 등급·내부 연결 글은 본문에 노출하지 않았고, 원본의 미실행 실습을 실행 경험으로 바꾸지 않음

## 대표 문장

원문: “QoS 자체는 정렬 키에 포함되지 않는다”

변환: “`rankMemoryPressure`는 세 비교 함수를 순서대로 적용합니다 / 통계를 얻은 Pod끼리는 앞선 비교에서 순위가 갈리면 뒤의 비교를 하지 않습니다” + “세 번째는 요청에 대한 사용률이나 배수가 아니라 사용량에서 요청량을 뺀 절대량입니다”

이유: 원본의 순서와 판단 근거를 보존하면서 통계 누락 예외와 absolute difference를 독자가 구분하도록 조건을 명시함

## 작성자 검증

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-eviction-oom.md` 실제 실행, error0 / warn1. 경고는 100자 초과23줄이며 대부분 고정 URL·표 조건을 포함한다. 조건을 삭제해 줄이는 대신 문맥 검토함. 로그 `lint-post.log`
- SVG2개 XML 파싱, sharp 렌더링, view_image 최종 육안검사 완료. 한글 라벨·최소17px·title/desc·viewBox·선과 라벨 겹침 없음 확인. `diagram-1.png`, `diagram-2.png` 보존
- 처음 렌더의 화살표·라벨 겹침을 고친 뒤 다시 렌더해 확인했고, 최종 SVG text 개수 경고 없음
- 내부 링크2개와 이미지2개 실제 대상 실존 확인. `output-checks.json`에 본문·SVG hash·줄수·검사 목록 보존
- 전 섹션 능동 시각화 재검토 완료. 종료/삭제 경로와 두 유예 시간은 SVG, 신호·기본값·순위·admission·판별은 표, 인과·보장 범위는 산문으로 정리
- 원문 대조·격식체·끝 마침표·번역투·과장·반복·설명 없는 내부 식별자·허구 경험 없음 점검
- Decision section 미포함: 대안 선정 서사가 없는 기전 해설
- build·전체 lint·정적 export·실제 클러스터 실습 실행 안 함. 독립 검수 및 배치 통합 검증 전 상태이며 완료 편수에 아직 포함하면 안 됨

## 남은 문제

독립 reviewer 판정과 주 담당의 통합 검증 대기. 핵심 근거 부족으로 보류할 항목은 발견하지 않음. static Pod 공식 문서/현행 guard 차이는 위 정정5에서 범위를 명시했으며 문서 내용을 그대로 구현 사실로 쓰지 않았음


# Batch 07 · Phase 2-4 작성 보고

- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 2-4 · kubelet 과 Pod 수명주기 · 노드 위에서 살아 있다는 판정.md`
- 정확한 파일명: `Phase 2-4 · kubelet 과 Pod 수명주기 · 노드 위에서 살아 있다는 판정.md`
- 읽은 날짜: 2026-10-23, 전문 659줄
- SHA-256: `bce8fc11320b26adae17beab7f4648ae8c2e1ed3f970b404f0ac66708876e02f`
- 출력: `src/content/essays/kubernetes/k8s-theory-kubelet-pod-lifecycle.md`
- series/order: `k8s-theory-node` / `4`, date `2026-10-23`
- 원본은 읽기 전용으로 유지했고, 공동 plan·README·commit·build는 수정·실행하지 않았습니다

## 확인한 근거

현재 기준 Kubernetes v1.37.1 commit `f78e722310e50bcaca9276be22276d9e91d91308`과 website `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`를 사용했습니다
공식 GitHub commit API의 message가 `Release commit for Kubernetes v1.37.1`임을 실제 확인했습니다 (`commit.json`)
실제 내려받은 27개 공식 파일의 URL·SHA-256·크기는 `manifest.json`, 추가 3개 고정 파일은 `extra-manifest.json`에 있습니다
관련 최신 progress의 Phase 2 상태·변경 이력, source-map의 2-4와 v1.37 대조 절을 읽었습니다
이 문서들의 현재 hash도 `source.json`에 보존했습니다

| 핵심 주장 | 직접 대조한 공식 소스·문서 | 판정·반영 |
|---|---|---|
| syncLoop 입력 | `pkg/kubelet/kubelet.go :: syncLoopIteration` | config/PLEG/sync/probe 3/container manager/housekeeping 8입력 확인 |
| 주기 동기화 | `defaults.go :: SetDefaults_KubeletConfiguration`, `kubelet.go :: getPodsToSync`, `pod_workers.go :: completeWork` | 티커 1초와 기본 SyncFrequency 1분·jitter 재예약을 분리 |
| PLEG 관찰 | `pleg/generic.go :: workerLoopIteration/Relist/Healthy/RequestRelist`, `kubelet.go` 상수·health check | 전체 조회 기본 1초, 마지막 relist 기준 3분, on-demand Pod relist도 설명 |
| phase와 Waiting | `kubelet_pods.go :: getPhase`, core/v1 `types.go :: PodUnknown` | LastTerminationState 유무를 기준으로 분류. Running과 Ready 분리. Node Unknown과 혼동 금지 |
| Pod 조건 | `status/generate.go`의 조건 생성 함수 | restartable init의 Ready 참여·readinessGates·sandbox 조건 범위를 확인 |
| probe | `prober/worker.go :: doProbe`, probe 공식 설정 문서 | startup 지연, initialDelay 기준, 임계값, liveness onHold, 삭제 중 liveness/startup 종료 확인 |
| 재시작 정책 | `kube_features.go :: ContainerRestartRules`, getPhase·worker와 Pod Lifecycle | v1.35 이후 기본 on인 컨테이너별 재시작 정책·규칙까지 적용 범위 보완 |
| sidecar | `kuberuntime_termination_order.go`, 공식 Sidecar Containers | started를 기다리는 시작과 역순 종료. 유예 소진 시 대기 중단을 명시 |
| 종료 유예 | `kuberuntime_container.go :: setTerminationGracePeriod/killContainer/executePreStopHook` | deletion/probe/spec 선택 뒤 caller override, preStop·순서대기 차감, 잔여 최소 2초 확인 |
| EndpointSlice | `staging/src/k8s.io/endpointslice/utils.go :: podToEndpoint`, `pkg/proxy/iptables/proxier.go`, 공식 Pod Lifecycle | serving/terminating/ready 계산 및 publishNotReadyAddresses 예외. 삭제와 노드 반영은 병렬·전파 필요 |
| static Pod | 공식 static-pod 문서, `cmd/kubelet/app/options/options.go`, `types/pod_update.go` | staticPodPath·두 CLI 플래그 실제 확인. mirror 삭제가 프로세스 삭제 아님 |
| CrashLoopBackOff | `kubelet.go :: newCrashLoopBackOff`, `defaults.go`, `config/validation/validation.go`, 공식 Pod Lifecycle | 기본10초/300초, 노드상한1~300초, 초기값 보정, Alpha 1초/60초와 노드설정 우선 구분 |

본문의 근거 절·인라인 링크에 독자용 고정 URL을 남겼으며, 내부 편집 경위는 본문에서 제거했습니다

## 원본 정정·보완

1. 원본의 ‘syncLoop 일곱 채널’은 현재 8개와 다릅니다. **추가 확인한 v1.35 고정본 `5671697925fe8d7222c4ab09cb15f28f5f9d0383`에도 containerManager.Updates()가 있어 원본 누락입니다**. 버전 변경으로 서술하지 않았습니다
2. v1.37 GA·LockToDefault인 `PLEGOnDemandRelist`의 특정 Pod 조회 경로를 보완했습니다. EventedPLEG는 Alpha off 유지입니다
3. v1.37 GA인 PodReadyToStartContainers와 restartable init의 Ready 참여를 조건 표에 반영했습니다
4. 원본의 재시작 여부를 ‘Pod restartPolicy만’으로 설명하지 않고 컨테이너별 재시작 정책·규칙을 보완했습니다
5. 종료 유예 선택 우선순위는 보존하되 caller override·순서대기·CRI 잔여 2초 하한을 구분했습니다
6. sidecar 종료 순서는 유예가 남은 범위의 기다림임을 보완했습니다
7. 원본의 SIGTERM 설명은 실제 전달 주체가 runtime이며, image STOPSIGNAL·ContainerStopSignals 설정에 따라 달라질 수 있음을 밝혔습니다
8. SidecarContainers v1.33 GA, PodLifecycleSleepAction·AllowZero v1.34 GA는 위 v1.35 고정 소스에서 직접 재확인했고 현재 gate 키 제거와 구별했습니다
9. 원본 종료조건·LAB TODO·학습 메타는 본문에서 제외했습니다. sleep 15초/유예30초는 설정 관계의 가정 예시로 표시했고 미실행 실습 결과로 바꾸지 않았습니다

## 시각화·문체 검토

- SVG 2장: 입력·Pod worker·runtime·상태 보고 흐름, 종료와 EndpointSlice 전파의 병렬 흐름
- 원본의 phase/state·probe 결과·sidecar 시작/종료·유예 관계는 표와 산문으로 재구성했습니다
- 전 섹션 능동 시각화 재검토를 마쳤으며 표를 다시 설명하거나 개수를 채우기 위한 SVG는 추가하지 않았습니다
- 한글 라벨, 기술 용어 원어, 최소 16px, role/title/desc, 평탄 경로 적용
- sharp로 각 SVG 원본 크기·375px PNG 총4장을 렌더링해 도구로 직접 열었습니다
- 최초 검수에서 화살표와 설명 라벨 겹침을 발견해 라벨 위치·배경을 수정했습니다
- 최종 검사에서 글자 잘림·박스 넘침·선과 라벨 겹침이 없고 375px에서 구조와 핵심 라벨을 확인했습니다
- 공통 writing-voice로 격식체·말투·근거·반복·내부 맥락을 대조했습니다. 경험·측정 결과를 창작하지 않았습니다
- 선택지 비교 섹션은 원본에 기술 선정 신호가 없어 추가하지 않았습니다

## 실제 검증

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-kubelet-pod-lifecycle.md`: **exit 0, error 0 / warn 1**. 100자 초과 줄 20곳은 링크·표·기전 설명을 포함한 권장 경고로 검토했으며 사실·조건을 자르지 않았습니다 (`lint-post.log`)
- SVG XML 파싱 2장: 통과. 각 title/desc 존재, 최소폰트16px 이상 (`source.json`)
- sharp PNG 렌더 4장과 육안 검사: 통과 (`diagram-1.png`, `diagram-2.png`, `diagram-1-375.png`, `diagram-2-375.png`)
- 원본 hash 재확인: 최초 기록과 동일
- build·전체 lint·정적 export: **작성 담당에서는 실행 안 함**, 주 담당의 배치 검증 대상으로 인계합니다
- 독립 reviewer 검토: 아직 미실행, 주 담당에 인계합니다

## 원문 → 변환 대표 문장

원문: “preStop을 유예 시간 밖에서 기다리면 종료에 필요한 시간은 `유예 + preStop이 쓰는 시간`이 된다”

변환: “preStop은 컨테이너 중지 신호보다 먼저 실행하는 훅이며, 훅에 쓴 시간도 종료 유예에서 빠집니다”

## 남은 문제

원본·핵심 근거 부족으로 보류할 항목은 없습니다
실제 런타임의 신호 전달·종료 시간·트래픽 중단·502를 실습으로 확인하지 않았으며, 본문에서 이를 근거 등급과 조건으로 구분했습니다
독립 reviewer와 배치 lint·build·정적 출력 검증을 통과하기 전에는 배치 완료로 세지 않습니다


# Batch 07 · QoS와 cgroup 작성 인계

- 대상: `src/content/essays/kubernetes/k8s-theory-qos-cgroups.md`, 326줄
- series: `k8s-theory-node` / order 5 / date 2026-10-23
- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 2-5 · QoS 와 cgroup · 장부가 되는 숫자와 울타리가 되는 숫자.md`
- 원본 전문: 708줄, SHA-256 `47742b882f35604f1e68c4fe96dffa0aac0e54d10abc0cef3f2f4d2334c897da`
- `☸️ progress.md`: 1122줄, SHA-256 `c3081510322928d79907275e31e02c0f4708ec606644bed7581006645d1d16f5`; 현재 사실 기준과 2-5의 이론 종료·실습 미실행 구분 확인
- `☸️ source-map · Phase 2.md`: 2189줄, SHA-256 `79c08e1759c80a6efc16cde0efd1af227addd3eece6dffd3fd657af6f75c18fe`; v1.37 대조 절의 QoS·유효 요청·MemoryQoS·quota gate 정정 확인
- 적용: draft-to-post Codex 진입점과 공동 스킬, writing-voice, plan·source-format, SVG 가이드; 이전 같은 시리즈 scheduling-constraints·preemption-pdb 참조

## 실제 확인한 근거

Kubernetes v1.37.1 tag target `f78e722310e50bcaca9276be22276d9e91d91308`와 website `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`의 파일을 읽었다. 본문에 주장 가까이 불변 URL을 인용했다. 다운로드 URL·SHA-256은 `manifest.json`과 `manifest-extra.json`에 있다

- [SetDefaults_Pod](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/v1/defaults.go)·[PrepareForCreate](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/core/pod/strategy.go): 컨테이너 limits→requests, Pod-level defaulting의 후단 적용
- [ComputePodQOS](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/v1/helper/qos/qos.go): 두 CPU·memory 값의 양수·일치 조건, Pod-level fix 분기
- [CPU·Pod cgroup 계산](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/cm/helpers_linux.go), [getCPUWeight](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/cm/cgroup_manager_linux.go), [자원 집계](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/component-helpers/resource/helpers.go): 0 quota·양수 하한, shares와 v2 weight, init·sidecar·overhead, 컨테이너별 limit 누락의 Pod 상한 영향
- [OOM policy](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/qos/policy.go)·[helpers](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/qos/helpers.go): 유효 요청·DRA 기본 off·잔여 요청 max(0)·sidecar 비교 대상 확인
- [node reservation](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/cm/node_container_manager_linux.go): allocatable 예약과 cgroup 집행 계산의 차이, 집행 설정 조건
- [resize validation](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go)·[공식 resize 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/tasks/configure-pod-container/resize-container-resources.md): QoS 불변, restart policy, Pending reason, InProgress, 메모리 축소의 NotRequired 조건·race 유지
- [MemoryQoS 공식 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/workloads/pods/pod-qos.md)·[runtime resource 생성](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_container_linux.go): gate on과 보호·high 실제 설정 구분
- [gate 등록](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go): v1.37 상태·LockToDefault 구분
- [eviction rankMemoryPressure](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/eviction/helpers.go): QoS 정렬 키 없음, 초과 여부·priority·요청을 초과한 사용량 순서
- [CRI reason 규약](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cri-api/pkg/apis/runtime/v1/api.proto)·[init 실패 판정](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/helpers.go): OOM 종료와 상태 관측 주체
- [Linux cgroup v2 공식 문서](https://docs.kernel.org/admin-guide/cgroup-v2.html): 프로세스 계층, memory.high·max·oom.group 범위. 커널 구현 상세를 새 학습 경험으로 추가하지 않음

## 원본 대비 정정과 보존

1. 원본의 MemoryQoS Alpha/off는 v1.37 Beta/on으로 정정. 기본 memoryThrottlingFactor=nil·memoryReservationPolicy=None이므로 gate만으로 보호·high 제한이 생기지 않음을 구분
2. Pod-level resize는 v1.36 Beta/on. CustomCPUCFSQuotaPeriod는 v1.36 GA/on이고 고정 등록의 LockToDefault는 없음. 주석의 잠금 예정은 실제 잠금으로 쓰지 않음. MemoryManager gate 삭제와 기능 유지를 구분
3. Pod-level QoS fix/defaulting fix와 OOM의 유효 요청·DRA·잔여 요청의 음수 0 보정을 현행 소스 조건으로 보강
4. BestEffort shares 2를 cpu.weight 2라고 쓰지 않음. kubelet Pod 경로에서는 weight 1이며 실제 CRI 런타임 변환과 구분
5. 메모리 축소는 NotRequired일 때의 best effort·race 조건을 추가. InProgress와 최종 실패를 구분
6. 원본 학습 목표·종료 판정·LAB TODO는 본문에서 제외. 실습 결과나 가상 에러 로그를 만들지 않음. CPU 수치는 가정임을 명시
7. 필드별 QoS·OOM·증상은 표, 배치/제어 분기와 제어 계층은 SVG 2개. 전 섹션 시각화 재검토 후 불필요한 추가 그림 없음

## 검증

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-qos-cgroups.md`: exit 0, error 0·warn 1. 긴 줄 23곳은 고정 URL·표·조건 문장으로 확인했으며 경고를 없앴다고 보고하지 않음
- SVG 2개 XML 파싱 성공, 모든 명시 font-size 최소 15px, title·desc·role 확인
- sharp PNG 800px 렌더링 후 2개 육안 검사. 둘째 SVG의 Guaranteed 연결선과 설명 글자 겹침을 수정하고 재렌더링·육안 재확인
- 본문 격식체·마침표·언어 펜스·이미지 참조·원본 경험 창작 여부 문맥 검사 완료
- 별도 blog-reviewer 검수·통합 lint/build/export 검증은 주 담당 단계. 이 보고서는 최종 배치 완료 판정이 아님
- commit/build/push는 이 작성자가 실행하지 않음

## 대표 문장 비교

- 원문: “request도 CPU 상대 가중치로 쓰이므로, 두 값이 노드 밖과 안으로 완전히 분리되는 것은 아니다.”
- 변환: “그렇다고 request가 스케줄러에서만 쓰이는 것은 아닙니다 / kubelet은 CPU request를 경합 시 배분 가중치로 바꾸고, request와 limit의 관계에서 QoS도 계산합니다”
- 판단: 원본의 경계 조건과 주체를 유지하고 비유·중복 설명은 줄임

## 남은 문제

핵심 근거 미확인으로 보류할 항목은 없음. 설치된 CRI 런타임·클러스터 설정·실제 cgroup 파일 값·OOM과 throttling은 실측하지 않았다. 확인 과정에서 `pkg/apis/core/qos/qos.go`는 404였으며 근거에 사용하지 않았다. 실제 확인한 v1 helper와 validation 경로만 본문에 사용했다


## 별도 blog-reviewer 검수

# Review: 3 files + 6 SVG

검토일: 2026-10-23 / Batch 07 / 작성자와 별도 blog-reviewer

## P0 위반 (즉시 수정 필요)

- 없음

## 확인 필요

- 핵심 주장을 검수 대기로 남길 근거 부족은 발견하지 못함
- 클러스터 실습·실측은 실행하지 않았으며, 이 글들의 근거 고지는 소스·문서 기반 해설로 한정함

## P1 권장

- 최종 저장본에 남은 권장 없음
- 검토 중 1건 발견 후 주 담당자가 수정하고 reviewer가 재검토함
  - `src/content/essays/kubernetes/k8s-theory-eviction-oom.md:175` — [맥락] “원본이 제시한 높은 우선순위…” → 독자가 열람할 수 없는 원본을 본문 설명에 끌어옴 → “높은 우선순위…”로 최소 수정
  - 재검토: 이어지는 Burstable의 요청 초과 조건과 priority 비교가 보존됨. 의미·사실 변경 없음

## P2 참고

- 자동 post lint의 문장 길이 경고는 남음: kubelet 20줄, QoS 23줄, eviction 23줄. 고정 URL·표·적용 조건을 포함한 줄이며 자동 경고를 통과로 바꿔 보고하지 않음

## 자동 lint 원시 결과

최초 QoS를 우선 검사하고, 나머지 작성 완료 뒤 2편 검사, 권장 수정 뒤 최종 3편을 재검사함

```text
npm run lint:post -- src/content/essays/kubernetes/k8s-theory-kubelet-pod-lifecycle.md src/content/essays/kubernetes/k8s-theory-qos-cgroups.md src/content/essays/kubernetes/k8s-theory-eviction-oom.md

src/content/essays/kubernetes/k8s-theory-kubelet-pod-lifecycle.md
    —  △ [문장길이] 100자 초과 줄 20곳 — 분리 검토
  요약: error 0 · warn 1
src/content/essays/kubernetes/k8s-theory-qos-cgroups.md
    —  △ [문장길이] 100자 초과 줄 23곳 — 분리 검토
  요약: error 0 · warn 1
src/content/essays/kubernetes/k8s-theory-eviction-oom.md
    —  △ [문장길이] 100자 초과 줄 23곳 — 분리 검토
  요약: error 0 · warn 1

전체: error 0 · warn 3 (파일 3개)
exit 0
```

자동 lint가 덮는 형식 검사를 grep으로 재구현하지 않음. 본문 문맥·원본 대비 의미·기술 기전·적용 조건·SVG 의미와 실제 렌더를 별도로 검토함

## 원본·기준 확인

`docs/writing-voice.md`, `.agents/skills/draft-to-post/SKILL.md`, 연결된 공동 변환 스킬, 시리즈 `plan.md`·`source-format.md`를 읽음. plan의 한글 SVG 라벨 우선 규칙을 적용함

아래 Vault 원본 전문 3개를 읽고 글과 대조했으며, 작업 후 SHA-256이 `sources.json`과 모두 같음

| 좌표 | 전문 줄 수 | 원본 SHA-256 |
|---|---:|---|
| 2-4 | 659 | `bce8fc11320b26adae17beab7f4648ae8c2e1ed3f970b404f0ac66708876e02f` |
| 2-5 | 708 | `47742b882f35604f1e68c4fe96dffa0aac0e54d10abc0cef3f2f4d2334c897da` |
| 2-6 | 545 | `6587bc108a54472f1ecb1f22103b60e9dd65b79aea7eb2e77c3dbdc8afabf295` |

세 글의 `essays/kubernetes`, `k8s-theory-node` order 4·5·6, date 2026-10-23가 plan과 일치함. 같은 시리즈가 logs로 갈라지지 않으며 대상 slug 중복 없음

원본의 질문·기전·실패 판별·유보 조건을 대조함. 학습 등급·종료 판정·LAB TODO를 실제 작업 경험으로 옮긴 곳은 발견하지 못함. 100m/500m, 종료 유예30초/preStop15초, DB 의존성과 QoS 비교 사례는 원본에 있는 설명 사례이며 본문에서도 가정·설정 관계와 실측을 구분함

## 주요 기술 재검증

Kubernetes v1.37.1 `f78e722310e50bcaca9276be22276d9e91d91308`와 website `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`의 실제 공식 소스 저장본을 읽음. 공식 commit API 저장본의 release message도 대조함. 로컬 manifest에 대응하는 공식 소스 79개 항목의 SHA-256을 재계산했고 불일치 없음

현재 [Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/), [Pod QoS](https://kubernetes.io/docs/concepts/workloads/pods/pod-qos/), [Node-pressure Eviction](https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/), [Linux cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html)도 직접 열람해 대조함. 일부 GitHub 고정 파일의 web 열람은 cache miss였으며 해당 항목은 manifest와 일치하는 실제 raw 저장본을 읽어 검증함

| 글 | 실제 대조한 핵심 경로 | 확인 결과 |
|---|---|---|
| kubelet | `kubelet.go::syncLoopIteration`, `pod_workers.go::completeWork`, `pleg/generic.go::Relist/Healthy`, `status/generate.go`, `prober/worker.go` | syncLoop8입력, 기본 SyncFrequency1분과 1초티커의 차이, 마지막 전체 relist 기준3분, probe·Ready·phase의 경계가 일치함 |
| kubelet | `kuberuntime_container.go::killContainer/setTerminationGracePeriod`, `kuberuntime_termination_order.go`, `endpointslice/utils.go::podToEndpoint`, feature gate 목록 | preStop·sidecar 대기 차감 뒤 CRI 잔여최소2초, 병렬 EndpointSlice 전파, publishNotReadyAddresses 예외, PLEGOnDemandRelist GA/on, 관련 gate 상태가 일치함 |
| QoS | `defaults.go::SetDefaults_Pod`, `qos.go::ComputePodQOS`, scheduler resource scorer, `cm/helpers_linux.go`, `cgroup_manager_linux.go` | limit→request 기본값과 Score100m/200Mi 가정값 구분, Pod-level QoS 경로, shares·weight 구분, Pod상한의 limit선언 조건이 일치함 |
| QoS | `qos/policy.go`·`helpers.go`, node allocatable 계산, resize validation, runtime resource 생성 | OOM의 DRA·잔여요청 max(0)·sidecar 최소request 비교, allocatable 예약과 cgroup집행 차이, QoS불변과 메모리축소 race 조건이 일치함 |
| QoS | feature gate 등록과 pod-qos 공식 문서 | MemoryQoS v1.37 Beta/on과 nil throttling·None reservation의 별도 설정, quota gate 실제 등록과 주석의 차이가 일치함 |
| eviction | `eviction_manager.go`, `eviction/helpers.go`, `types/pod_update.go` | node-pressure루프만 한주기1Pod, localstorage복수가능, workingSet-request 절대량과 통계누락 예외, static/mirror critical guard, admission의 별도 QoS조건이 일치함 |
| eviction | `summary.go::adjustForHugePages`, feature gate 목록, `killContainer`, node-pressure 공식 문서 | HugepageAwareEviction Beta/on과0하한, KubeletPSI GA/on, hard문서0초/소스override1초/CRI최소2초를 각기 다른 단계로 구분함 |
| eviction | Linux memory.max·memory.events와 런타임 상태 변환 | OOMKilled/137만으로 발생범위나 삭제원인을 확정하지 않음. DisruptionTarget과 Evicted의 범위도 한정함 |

8입력은 v1.35 고정본에도 존재하는 containerManager 채널의 원본 누락 정정이며 버전 변화라고 승인하지 않음. static Pod의 node-pressure 축출 가능성을 설명하는 웹 문서와 현행 IsCriticalPod guard의 차이는 확인한 고정 구현의 범위로 한정한 본문이 타당함

## SVG·자립성·문체 검토

- 최종 SVG 6개를 reviewer가 sharp로 800px와375px에 각각 다시 렌더링함: `/tmp/k8s-batch07/reviewer-render/`의12 PNG
- 12 PNG를 모두 직접 열어 육안 검사함. 글자 잘림·박스 넘침·화살표와 라벨 겹침을 발견하지 못함
- 구성/관찰→동기화 루프, 종료/EndpointSlice 병렬 흐름, request/limit 소비자, cgroup 부모/자식 제약, 세 종료/삭제 결과, hard/soft 두 대기시간의 의미가 본문·소스와 일치함
- 표·그림 뒤 문단 수나 그림 개수를 할당하지 않음. 앞에서 충분한 요약에는 재설명을 요구하지 않음
- PLEG·sandbox·probe·cgroup·QoS·OOM·working set·DRA·EndpointSlice의 역할과 판별 범위가 본문에 설명됨. 원본에 없는 경험·감정·실패·성능 수치·대안 선택을 만든 곳은 발견하지 못함

## 요약

- 최종 P0: 0건 / 확인 필요: 0건 / 남은 P1 권장: 0건 / P2 참고: 1건
- 발견한 편집 권장1건은 주 담당 수정 후 재검토 완료
- 검토 글3개, SVG6개, 레거시 제외0개
- 최종 검토 저장본9파일의 SHA-256: `/tmp/k8s-batch07/review-hashes.json`
- 전체 lint·build·정적 export 검증·commit은 reviewer가 실행 안 함. 주 담당의 배치 통합 검증을 대체하지 않음


### 지적 반영·재검토

- 독립 reviewer 권장 1건 반영: eviction 글의 “원본이 제시한”을 삭제해 독자가 볼 수 없는 학습 노트 전제를 제거했다
- 높은 우선순위 BestEffort와 낮은 우선순위 Burstable의 비교 조건·기전은 보존했다


## 실제 최종 검증

- `npm run lint:post -- <이 배치 3편>`: exit 0, error 0 / warn 3
- `npm run lint`: exit 0, error 0 / warn 1 (기존 `src/app/layout.tsx:80` custom font 경고)
- `npm run build`: exit 0, TypeScript·정적 생성·postbuild 성공, 586 pages
- 원본 SHA-256·검수 후 글/SVG와 빌드 입력 hash 일치
- slug 유일성·시리즈 order 연속성·내부 링크·이미지 실존·SVG XML/접근성 메타 검사 통과
- `getAllPosts`·`getEssaysList`·`getSearchIndex` 실제 실행: 3편 모두 essays로 등록, 목록·검색 객체에 content 없음
- HTML 3개·SVG 6개 실제 export 및 `/my-blog/diagrams/` 참조·SVG 바이트 일치
- sitemap·llms 3편 반영, RSS는 기존 최신 20편 정책과 실제 출력 일치
- `git diff --check` 통과
- prebuild의 이번 CLAUDE.md 자동 통계 변경만 복원, Vault 원본 변경 없음
- 클러스터 실습·통합 테스트·성능 실측·push·배포·시리즈 카드 등록: 실행 안 함

원시 로그·임시 근거 저장본: `/tmp/k8s-batch07/`
영구 재확인 경로는 위 글과 작성 기록의 공식 소스 URL이다

## 다음 대상

- `Phase 2-7 · 관측 세 소스 · 같은 것을 묻는 세 개의 창구.md` → `k8s-theory-node-observability-sources` (`k8s-theory-node` / 7)
- `Phase 2-8.1 · Deployment 와 DaemonSet (1) · 되돌리기는 앞으로 간다.md` → `k8s-theory-workload-rollout-revisions` (`k8s-theory-node` / 8)
- `Phase 2-8.2 · Job 과 CronJob (2) · 끝은 상태가 아니라 개수다.md` → `k8s-theory-job-cronjob-completion` (`k8s-theory-node` / 9)
