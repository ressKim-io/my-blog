# Batch 11 인계 — 2026-10-23

3편 검수 완료, SVG 5장. 콘텐츠 커밋 `31c4495`
이번 요청 누적 15/30편, 전체 시리즈 누적 41편

## 원본·결과 대응

원본 루트: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/`
읽기 전용으로 사용했으며 작업 전후 hash 일치를 검증했다
작성 기준일은 2026-10-23이며 학습일·배포일을 뜻하지 않는다

| 좌표 | 원본 파일 | 줄 수 | SHA-256 | slug | series / order |
|---|---|---:|---|---|---|
| 2-15 | `Phase 2-15 · 노드의 swap · 나눠주는 쪽만 알고 세는 쪽은 모른다.md` | 463 | `28e541dd809707a85961b79edca6540f06c9ddd6f0b979d3eeca244343b1291c` | `k8s-theory-node-swap` | `k8s-theory-node` / 16 |
| 2-16 | `Phase 2-16 · 컨테이너 로그 파일 · 경로를 정한 쪽은 그 파일을 안 쓴다.md` | 569 | `68d7e2d6d395716e4543c1d4a54030531a142af778ff0a3bb983e90f8e3bb3ea` | `k8s-theory-container-log-files` | `k8s-theory-node` / 17 |
| 2-17 | `Phase 2-17 · HPA 와 scale subresource · 같은 칸을 다른 문으로 쓴다.md` | 644 | `9797252104bf73bca8b91bb2ad22ef50c501d30ad65df8318bd7dcfe3d3f9d22` | `k8s-theory-hpa-scale-subresource` | `k8s-theory-node` / 18 |

글 경로는 `src/content/essays/kubernetes/{slug}.md`, SVG는 `public/diagrams/{slug}-{n}.svg`다

## 작성자의 근거 대조·편집 기록

아래는 작성 단계의 기록이다. 이후 보완·정정은 별도 검수와 지적 반영 기록을 우선한다

# Batch 11 · Phase 2-17 작성 인계

- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 2-17 · HPA 와 scale subresource · 같은 칸을 다른 문으로 쓴다.md`
- 최신 저장본 644줄 전문·progress 2-17·source-map Phase2의 해당 절과 v1.37 정정 대조
- SHA256 `9797252104bf73bca8b91bb2ad22ef50c501d30ad65df8318bd7dcfe3d3f9d22` 재검증, 원본 변경 없음
- 출력 `src/content/essays/kubernetes/k8s-theory-hpa-scale-subresource.md` 292줄, 표7개·SVG2장
- series `k8s-theory-node` / order18 / date2026-10-23, tags Kubernetes·HPA·Autoscaling·ServerSideApply·GitOps·concept
- draft-to-post 공동 절차·writing-voice·plan/source-format·SVG 기준 적용, 공통 문서·다른 글 변경 없음

## 실제 확인 근거

Kubernetes v1.37.1 ref `f78e722310e50bcaca9276be22276d9e91d91308`, website ref `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`. `manifest.json`의 공식 고정파일26개 전부 수신·SHA256 일치

- 현행 공식 [HPA](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/), [SSA](https://kubernetes.io/docs/reference/using-api/server-side-apply/), [CRD Scale](https://kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definitions/#scale-subresource)
- [horizontal.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/podautoscaler/horizontal.go): RESTMapper·Scale取得, 여러 지표 최대 추천·오류 시 방향 조건, behavior 분기·추천/이벤트 맵·초기 추천·안정화·정책·Update/RetryOnConflict
- [replica_calculator.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/podautoscaler/replica_calculator.go), [utilization.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/podautoscaler/metrics/utilization.go), [메트릭 클라이언트](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/podautoscaler/metrics/client.go): API별 조회·request 분모·정수 사용률·readyPodCount·Pod-level/컨테이너 선택·누락/미준비 보정
- [컨트롤러 기본값](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/podautoscaler/config/v1alpha1/defaults.go), [플래그](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kube-controller-manager/app/options/hpacontroller.go), [API behavior 기본값](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/autoscaling/v2/defaults.go), [gate](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go)
- [Deployment Scale 저장 경로](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/apps/deployment/storage/storage.go), [ScaleHandler](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/util/managedfields/scalehandler.go), [Update 처리](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/handlers/update.go), [매니저 prefix](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/handlers/create.go), [User-Agent 구성](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/client-go/rest/config.go)
- [ReplicaSet 쓰기](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/deployment/sync.go), [replica 어노테이션](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/deployment/util/deployment_util.go), [CRD 타입](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1/types.go), [CRD Scale 변환](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/registry/customresource/etcd.go)
- metrics-server는 Batch08 v0.9.0 pin `2a7c4b2c7d46552ff47f4aeaa3a735c582587ecd`의 캐시 README를 다시 읽고 기존 manifest hash 일치 확인. `reused-metrics-server.json`에 기록. 설치 버전·실제 클러스터는 추정하지 않음

## 원본 대조·정정

1. HPAConfigurableTolerance는 원본의 v1.35 beta/on에서 현재 v1.37 GA/on·LockToDefault로 정정. 전역 tolerance0.1, sync15초, CPU init5분·initial readiness30초·down 창5분은 실제 기본값/플래그 확인
2. 단순 ceil 공식을 실제 모든 분기의 currentReplicas 곱셈으로 일반화하지 않음. Resource 경로의 readyPodCount, usageTotal/requestTotal 정수 백분율, request 선택과 누락 오류를 구분. 원본 CPU50.4%→1.008 예시는 ‘계산에 쓰는 비율1.008’의 가정으로 바꾸고 실제 CPU 정수화 조건을 명시
3. 누락값은 request 사용률 down=max(100,target)%·up0, 절대 사용량 down=target·up0. 미준비0 보정·CPU Ready/StartTime/표본시각/Window·보정 뒤 방향 역전 억제 보존. 지표 전부없음은 실패, 다중 지표 최대 추천과 부분 오류 시 축소 억제 조건은 실제 controller로 확인
4. 안정화는 실행 개수 이력이 아닌 추천 이력. behavior up 최소/down 최대와 legacy down 최대를 구분. down API 기본nil은 플래그 값 보존 목적, behavior 생략 시 내부 기본정책을 저장하지 않음. 정책 기간별 기존 이벤트를 반영하며 Min/Max는 변경량 기준
5. 추천·scale event 이력은 메모리 맵, 재시작/리더 교체 시 과거 이력 소실. 첫 조정 현재 목표를 초기 추천으로 넣으므로 down 제동이 즉시 없어지는 것으로 표현하지 않음
6. Deployment와 scale은 같은 store·resourceVersion·저장 키. Scale은 조립한 표현이며 Update는 본체 replicas/managedFields로 환산. RBAC 권한과 SSA 소유권, 일반 Update와 Apply 충돌, resourceVersion409 재시도 및 최종 실패 구분
7. HPA Update는 fieldManager 생략. 표준 kube-controller-manager 실행의 UA prefix로 manager가 기록됨을 조건과 함께 명시. manager 이름을 인증 신원으로 설명하지 않음. 필드 집합이 비면 기존 managedFields 항목이 사라질 수 있음
8. GitOps 재Apply 충돌은 값을 바꾸지 못함. 강제Apply/다른Update가 다시 써야 번갈아 쓰기가 가능. 공식 SSA 인계 주의 추가: 유일 소유자가 HPA 인계 전에 replicas를 빼면 default1이 될 수 있으므로 인계 확인 후 제거
9. Deployment controller는 ReplicaSet 본체를 갱신하며 desired/max-replicas 어노테이션을 기록. HPA와 같은 Deployment replicas를 서로 되돌리는 관계로 설명하지 않음
10. CRD 표의 ‘없음’을 CRD 설정 항목 부재와 혼동하지 않도록 ‘CR 안 해당 경로의 값 부재’로 명확히 함. selector는 문자열, 빈 selector는 SelectorRequired 이벤트·ScalingActive=False/InvalidSelector. spec 경로값 부재 GET오류/status부재0 조건 보존
11. 원본 LAB20건·종료판정·학습자 실명·편집경위는 본문 제외. 새 실행 결과나 도구별 실제 동작을 만들지 않음. 독자가 이해할 기전·조건·실패 경계 중심으로 재구성, 선택지 비교 절은 없음

## 검증·문체·이미지

- 실제 `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-hpa-scale-subresource.md`: error0/warn1, 긴 줄20곳은 URL·표·조건 문장으로 문맥 검토
- 원본 hash와644줄 확인, 고정 소스 본문 링크22개 모두 실제 받은 ref/path와 일치, 내부 글 링크·SSA 인계 anchor·이미지 참조 통과
- SVG2장 XML·viewBox·title/desc/ARIA·최소21px 폰트 통과(text11/9개). sharp600/375 각2장 총4PNG 렌더 성공, 전부 육안에서 라벨·화살표·여백·잘림/겹침 없음 확인
- 전 섹션 시각화 판단: HPA 계산/쓰기 흐름과 본체/scale/ReplicaSet 관계는 SVG, 누락 보정·behavior·SSA 시점·CRD·실패 비교는 표, 허용 오차·이력 소실·소유권 이유는 산문. 원본 ASCII 대체2장, 능동 재검토 수행
- 격식체·끝마침표·원본 조건·수치·근거·반복 문맥 검토. 표를 다시 읽는 요약이나 편집경위·경험을 추가하지 않음
- 전체 lint/build/정적 출력 검증·commit 실행 안 함: 부모 배치 담당. 독립 reviewer 검수 인계

## 대표 문장·남은 문제

원문 “안정화 창이 보관하는 것은 과거에 실행된 replica 수가 아니라 계산 당시의 추천값이다” → 변환 “보관하는 것은 실제 실행된 replica 수의 이력이 아니라 제한을 적용하기 전의 추천값입니다”

기전·입력의 구분을 보존해 격식체로 정리했으며 경험은 보태지 않음. 핵심 근거 미확인·보류 사유 없음. 긴 줄 경고1건 남음. 클러스터 LAB은 실행하지 않았고 본문에 이론 근거를 고지


# Batch 11 · Phase 2-16 작성 인계

- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 2-16 · 컨테이너 로그 파일 · 경로를 정한 쪽은 그 파일을 안 쓴다.md`
- 2026-10-23 최신 저장본 569줄 전문 읽음. SHA-256 `68d7e2d6d395716e4543c1d4a54030531a142af778ff0a3bb983e90f8e3bb3ea`, sources.json과 실제 파일 일치
- 최신 progress의 현행 후속 판정과 source-map Phase 2의 2-16 본절·v1.37 gate 정정 확인. progress SHA `c3081510322928d79907275e31e02c0f4708ec606644bed7581006645d1d16f5`, source-map SHA `79c08e1759c80a6efc16cde0efd1af227addd3eece6dffd3fd657af6f75c18fe`
- 글: `src/content/essays/kubernetes/k8s-theory-container-log-files.md`, 266줄, series `k8s-theory-node` / order 17 / date 2026-10-23
- tags: Kubernetes, CRI, kubelet, Logging, containerd, concept
- SVG 2개: 동일 slug의 `-1.svg`(경로 지정·기록·읽기 책임), `-2.svg`(rename·열린 fd·재열기, 능동 판단 신규 1개). 표 5개
- draft-to-post 진입점·공동 절차, writing-voice, plan/source-format, SVG 기준 적용. 공통 문서·타인 파일 수정, commit/build/push 실행 안 함

## 실제 확인한 근거

Kubernetes v1.37.1 ref `f78e722310e50bcaca9276be22276d9e91d91308`, website ref `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`, containerd v2.4.2 ref `b7a25261e029d68978bbf290df0a62fc819b3c51`를 사용했다. containerd는 Batch09의 공식 tag 확인 근거를 재사용하되 해당 코드 파일을 다시 읽고 기존 manifest hash와 대조했다

공식 소스·문서 25파일을 실제로 읽고 `manifest.json` 20개·`manifest-extra.json` 3개·`manifest-reused.json` 2개에 URL/hash를 보존했다. 최종 25/25 파일 hash 일치. 404 없음

- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cri-api/pkg/apis/runtime/v1/api.proto — LogDirectory·상대 LogPath·구조화 바이너리 허용 주석·ReopenContainerLog 오류 계약
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_container.go — MkdirAll·경로 전달·상태 부재 시 restart count 복구·legacy 링크 생성·상태에서 LogPath 읽기·로그 삭제·종료 메시지 fallback
- `kuberuntime/helpers.go`, `legacy.go`, `kuberuntime_logs.go` — 디렉터리 이름·옛 경로 파싱·255바이트 링크 이름 한도·since 변환
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cri-client/pkg/logs/logs.go — CRI/Docker 파서·첫 읽기 레코드 선택·P 개행 제거·timestamp 필터·단일 파일·follow의 디렉터리 감시와 새 파일 열기
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/logs/container_log_manager.go — 실행 중 대상·주기·크기 임계·회전 단계·maxFiles-2·압축·rename·RPC·실패 복구 시도·Clean
- `apis/config/v1beta1/defaults.go`, `apis/config/validation/validation.go` — 10Mi/5/1/10s 기본값, worker>=1·interval>=3s·maxFiles>1·정규화된 절대 ASCII podLogsDir
- `kubelet_pods.go`, `kuberuntime/kuberuntime_gc.go`, `cmd/kubelet/app/options/options.go` — previous ID 선택과 오류 단계·GC 최소 나이/개수/Pod 제거 조건·기본 종료 인스턴스 보존 1개·종료 message의 현재/이전 상태 이동
- `registry/core/pod/strategy.go`, `registry/core/pod/rest/log.go`, `kubelet/server/server.go`, `apis/core/validation/validation.go`, `features/kube_features.go` — nodeName/URL/query/중계·양쪽 SplitStreams gate·All 기본·특정 stream과 tailLines 양립 불가·Alpha/off
- https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/io/logger.go — RFC3339Nano·stream·P/F·길이 분할·개행 없는 EOF도 P
- https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/server/container_log_reopen.go — 실행 중 여부 검증·새 로거 교체. container_start.go의 TTY별 stderr 조건과 container_create.go의 경로 결합도 실제 대조
- https://kubernetes.io/docs/concepts/cluster-administration/logging/ 및 고정 website의 `content/en/docs/concepts/cluster-administration/logging.md` — 현재 공식 웹/저장본의 최신 파일만 조회·기본 보존·스트림 분리 조건을 대조
- https://github.com/kubernetes/design-proposals-archive/blob/main/node/kubelet-cri-logging.md — 과거 CRI 형식·외부 cron 회전 가정. 현행 구현으로 사용하지 않음. 읽은 저장본 hash `c904138f4fec0892f591ef898e626884f8bc3f55734355a09fdb1a7df86c05c1`

## 원본 대비 정정·한정

1. SplitStreams는 v1.37.1도 Alpha/default off다. off를 활성화 불가능으로 쓰지 않고 API 서버·대상 kubelet에서 켜는 조건, stream 값과 tailLines 제한을 명시했다
2. 파서는 파일 맨 첫 줄이 아니라 읽기 시작 레코드로 결정한다. --tail의 seek 이후일 수 있으며 follow 재열기에서도 기존 parse를 유지한다. 소스 상단의 회전 미지원 주석과 실제 재열기 분기가 어긋나므로 구현을 기준으로 썼다
3. P는 뒤에 무조건 F가 온다는 보장이 아니다. containerd는 길이 분할과 개행 없는 EOF의 잔여 출력에도 P를 쓴다. F는 완전한 한 줄 또는 분할 출력의 마지막 조각이다
4. containerLogMaxSize는 주기적 회전 임계값이다. 공식 문서의 40MiB/10MiB 예시를 일반적인 엄격한 최대 크기로 확대하지 않았다. current+rotated 파일 수와 회전 성공 시점을 분리했다
5. 가장 최근 회전본은 즉시 압축하지 않는다. 다음 회전에서 먼저 개수 정리한 뒤 남아 있는 경우에만 압축한다. maxFiles=2에서는 다음 회전에 삭제될 수 있어 무조건 다음에 압축한다고 쓰지 않음
6. --previous는 lastState.terminated.containerID를 선택한 뒤 상태의 LogPath를 읽는다. n-1 산술·회전본 선택이 아니다. 현재 조회도 상태에 따라 실행/종료/이전 종료 인스턴스를 선택하므로 무조건 실행 중 인스턴스라고 쓰지 않았다
7. GC 기본 1개는 영구 보존 보장이 아니다. 최소 나이·개수·Pod 제거 가능 여부와 로그 삭제 오류 가능성을 유지했다. previous 상태 선택 오류와 이후 런타임 ContainerStatus 오류를 구분했다
8. rename만으로 기존 fd가 새 파일을 가리키지 않는다. RPC 실패는 복구 rename 시도이며 원자적 복구 보장으로 쓰지 않았다. follow·수집기 배려도 무손실 보장으로 확대하지 않음
9. FallbackToLogsOnError의 종료·비정상 exit·ContainerCannotRun 제외·메시지 부재 조건·파일 읽기 오류 분기를 보존했다. 마지막 최대 80개 CRI 레코드와 최대 2KiB 로그 꼬리, 이미 보고된 Pod 상태라는 조건을 분리했다
10. 실제 노드 로그 수집·명령 실행 결과·개인 경험·LAB·자가 판정·Vault 내부 편집 경위를 본문에 만들지 않았다. 파일 하나만 읽는 실제 설계 이유는 미확인 상태를 그대로 유지했다

## 대표 문장

원문: “--previous 는 Pod 상태의 lastState.terminated 에서 이전 컨테이너 ID 를 찾고, 그 컨테이너의 LogPath 를 읽는다. 즉 <n-1>.log 다”

변환: “validateContainerLogStatus는 --previous일 때 lastState.terminated.containerID를 고릅니다 / 그 ID의 상태와 LogPath로 읽기를 진행합니다 / 현재 파일명의 숫자에서 1을 빼 경로를 계산하지 않습니다”

이유: 이전 인스턴스 선택이라는 취지를 보존하면서 파일명 산술로 오해할 수 있는 대응을 실제 구현으로 한정했다

## 검증·남은 문제

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-container-log-files.md` 최종 실제 실행 exit 0, error 0 / warn 1. 100자 초과 29줄은 고정 URL·표 조건 등을 문맥 검토 후 보존. `lint-post.log`
- SVG 2개 XML 파싱 통과. 최소 폰트 20px / 560폭이며 375폭 축소의 명목 최소 13.39px. 접근성 title/desc·한글 라벨·이미지 참조 확인
- sharp로 원본 크기와 375px PNG 각각 렌더 후 육안 확인. 첫 렌더의 화살표 선과 라벨 겹침을 배경 마스크로 수정했고, 마지막 회전본 보존 결과도 순서 오해 없이 수정한 뒤 재렌더·모바일 육안 확인했다. 잘림·겹침 없음. `diagram-{1,2}.png`, `diagram-{1,2}-mobile.png`
- 전 섹션 능동 시각화 재검토: 책임 흐름·rename/reopen은 SVG, 필드·기본값·조회 단위·오류는 표, 조건·설계 이유 한계는 산문. 표/본문·마무리 반복을 줄였다
- 원본 전문과 메커니즘·조건·근거 대조, 격식체·문단 끝 마침표·직역·과장·허구 경험 점검. 내부 링크 2개와 이미지 2개 실제 대상 확인, 산문 끝 마침표 0. `output-checks.json`에 결과 파일 hash와 검사 내역 보존
- Decision section 미포함: 대안 선정 경험이 없는 기전 해설
- 핵심 근거 부족 보류 없음. 실제 노드 버전·출력·회전 중 무손실·현재 파일만 읽는 실제 설계 이유는 확인하지 않았으며 본문도 이를 단정하지 않음
- 전체 lint·build·정적 출력 검증·독립 reviewer 실행 안 함. 주 담당자의 별도 검수와 통합 검증 대기이며 현재 작성 결과를 완료 편수에 먼저 포함하면 안 됨


# Batch11 · 2-15 NodeSwap 작성 보고

- 대상: `src/content/essays/kubernetes/k8s-theory-node-swap.md`
- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 2-15 · 노드의 swap · 나눠주는 쪽만 알고 세는 쪽은 모른다.md`
- 원본 463줄 전문 확인, SHA-256 `28e541dd809707a85961b79edca6540f06c9ddd6f0b979d3eeca244343b1291c`
- series `k8s-theory-node` / order `16` / date `2026-10-23`, essays/kubernetes
- 기존 같은 시리즈 `k8s-theory-qos-cgroups.md`를 구조·연결 참고로 확인
- `draft-to-post` 진입점·공동 절차, `docs/writing-voice.md`, plan/source-format, SVG 가이드 적용
- SVG 1개 / 표 4개. 선택지 비교 절 없음: 도구 선정 원본이 아니며 정책·조건 설명으로 구성
- 원본·본문·SVG·progress/source-map의 정확한 해시·줄수는 `source.json`, 수집 URL·해시는 `manifest*.json`

## 최신 원본 맥락

`☸️ progress.md` 1122줄, SHA `c3081510322928d79907275e31e02c0f4708ec606644bed7581006645d1d16f5`
`☸️ source-map.md` 123줄, SHA `36cadfdf517ab7a33708be8e867f8b4d303d762e873ddd3c31564b8c77e704ae`
`☸️ source-map · Phase 2.md` 2189줄, SHA `79c08e1759c80a6efc16cde0efd1af227addd3eece6dffd3fd657af6f75c18fe`

progress의 현재 판정(932행)과 과거 제거 예정 설명(971행)을 구분했습니다
현행 설명은 NodeSwap symbol·등록·실행 분기가 남는다는 현재 판정을 재검증했습니다
Vault의 현재 이론 ref `8aaeb4e...`와 과거 v1.35 학습 기록을 구분하고, 블로그는 이번 배치의 v1.37.1 ref로 실제 대조했습니다

## 실제 확인한 근거

- Kubernetes v1.37.1 `f78e722310e50bcaca9276be22276d9e91d91308`
- 공식 website `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
- [현행 swap 공식 문서](https://kubernetes.io/docs/concepts/cluster-administration/swap-memory-management/), [Linux Node Swap Behaviors](https://kubernetes.io/docs/reference/node/swap-behavior/)를 브라우징하고 해당 고정 website 원문도 수집·대조
- Linux `v6.3`·`v6.4` `mm/shmem.c`, `v6.12` cgroup v2·VM sysctl 문서

| 주장 | 실제 읽은 고정 소스·대조 결과 |
|---|---|
| NodeSwap GA/on/잠김 | [`pkg/features/kube_features.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go), symbol·버전별 등록·kubelet 허용 등록 및 runtime 분기를 확인. `remove in 1.37` 주석이 남지만 실제 제거되지 않음 |
| 기동 허용과 워크로드 정책 분리 | [`defaults.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/apis/config/v1beta1/defaults.go) failSwapOn=true, failCgroupV1=true. [`server.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/cmd/kubelet/app/server.go) LimitedSwap+v1 실패와 미지정 NoSwap 로그. [`NewContainerManager`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/cm/container_manager_linux.go) swap 감지·기동 거부·noswap Warning |
| 여섯 제외 조건·비례식·CRI 전달 | [`kuberuntime_container_linux.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_container_linux.go) GetContainerSwapBehavior·configureContainerSwapResources·ConfigureLimitedSwap·ConfigureNoSwap·configureSwap·calcSwapForBurstablePods. Pod QoS와 컨테이너 raw memory 값 구분, 노드 전체 RAM/전체 swap 입력, 계산 오류→NoSwap, v1 합산 한도 및 controller 부재시 생략 확인 |
| critical의 범위 | [`IsCriticalPod`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/types/pod_update.go) static·mirror·시스템 priority 기준 이상 |
| tmpfs noswap | [`swap_util.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/util/swap/swap_util.go), [`kernel/constants.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/util/kernel/constants.go): kubelet userns 예외, 버전 판독 실패, 6.4 이상, 구버전 mount 시험. emptyDir 옵션 추가·Secret memory emptyDir wrapper 확인 |
| Linux 문서와 구현의 차이 | [`v6.4 shmem`](https://github.com/torvalds/linux/blob/v6.4/mm/shmem.c) noswap parser·비특권 거부 분기가 있고 v6.3 동일 파일에는 noswap 없음. 현행 website 두 문서는 여전히 6.3 표시 |
| swap 전용 배치/축출 회계 없음 | [`NodeResourcesFit`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/scheduler/framework/plugins/noderesources/fit.go) memory request/allocatable, [`eviction/api`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/eviction/api/types.go) swap signal 없음, helpers_others.go의 AvailableBytes, helpers.go memoryUsage의 WorkingSetBytes 확인 |
| 커널 임계 비교의 한계 | [`Linux v6.12 VM sysctl`](https://github.com/torvalds/linux/blob/v6.12/Documentation/admin-guide/sysctl/vm.rst) min_free_kbytes는 zone별 WMARK_MIN 계산 입력. kubelet memory.available과 단순 숫자 비교로 보편적 안전값을 정하지 않음 |
| Node 용량과 관측 통계 | [`setters.go`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/nodestatus/setters.go) nonzero SwapCapacity, [`SwapStats`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kubelet/pkg/apis/stats/v1alpha1/types.go) 사용량/가용량, helper.go cAdvisor 유한 한도, cri_stats_provider.go 런타임 변환·일부 0 보정·Pod 합산, resource_metrics.go node/container/pod 사용량·container limit/필드 조건 확인 |
| 인터페이스 계약 | [`CRI api.proto`](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/cri-api/pkg/apis/runtime/v1/api.proto)의 Unified·memory_swap_limit_in_bytes·SwapUsage, Linux v6.12 cgroup 문서 memory.swap.max와 memory.max 분리 확인 |

## 정정·보존

1. 과거 `remove in 1.37` 예정 설명을 제거 사실로 옮기지 않았습니다. 현재 symbol/등록/분기·GA/on 잠김 유지
2. 원본의 두 스위치, 여섯 제외 조건, critical 세 갈래, 컨테이너 memory request=limit 및 0 조건, Pod-level만으로 양수 swap이 생기지 않는 경계를 보존
3. API 기본값 처리 후의 실제 컨테이너 선언으로 해석하도록 한정하고, 명시적 request 0·limit 양수와 limit-only 기본값 복사를 혼동하지 않도록 표현
4. cgroup v1 NoSwap 코드는 남아 있지만 현행 failCgroupV1=true를 함께 설명. LimitedSwap은 v2에서만 지원하며 controller 부재시 값을 보내지 않는 경계 보존
5. 문서의 tmpfs 6.3 표기보다 kubelet 실제 6.4 상수·Linux parser·백포트 mount 시험을 우선. userns는 kubelet 실행 환경 검사임을 명시
6. min_free_kbytes를 곧바로 단일 swap 시작 임계로 설명하지 않음. Linux zone별 최소 watermark 입력과 kubelet working set 기반 지표의 차이를 보완하고 임계의 보편적 숫자 권고를 만들지 않음
7. 용량만 보고한다는 범위를 Node status로 제한. 현행 Pod swap metric 및 CRI missing→zero 분기를 추가 대조해 지표 부재·0·실측을 구분
8. LAB TODO·종료 조건·내부 노트 좌표·편집 경위는 본문에서 제외, 실험·수치·개인 경험을 만들지 않음

## 실행한 검사

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-node-swap.md` → error 0 / warn 1, 100자 초과 줄 25곳. 긴 기술명·링크와 근거 문장 검토 완료. 원시 결과 `lint-post.log`
- XML `xml.etree.ElementTree.parse` → 통과, title/desc/role 있음, text 16개, 최소 font-size 21px, 한글 라벨
- `sharp` → 800×1280와 375×600 PNG 생성, 두 최종 파일을 `view_image`로 열어 육안 확인. 한글 정상·라벨/상자/화살표 겹침·잘림 없음
- 전 섹션 시각화 재검토 → 기동·정책·검사·계산·전달의 구조는 SVG 1개, 열거·관측·실패 판별은 표로 구성. 중복 ASCII 없음
- 원문 1~6절/근거와 본문을 대조, formal 문체·조건 보존·반복·자립성 확인
- `git diff --check` → 통과
- 전체 lint·build·정적 출력 검증·독립 reviewer·commit은 작성자 범위에서 실행 안 함, 부모 배치 검증으로 인계

## 대표 문장 대조

원본: “기동 허용과 워크로드의 swapBehavior는 별도 설정이다”에 해당하는 §3.1의 “failSwapOn: false는 이 기동 거부를 해제한다. 워크로드 정책을 지정하지 않으면 여전히 기본 NoSwap을 사용하며”

변환: “failSwapOn만 false로 바꾸고 swapBehavior를 생략하면 기본 정책은 NoSwap입니다”

기동 허용이 워크로드 swap 허용과 같지 않다는 조건을 유지하고 격식체로 변환했습니다

## 남은 문제

- 콘텐츠 핵심 근거의 미확인 사항 없음. 실제 클러스터·CRI·커널 swap 파일 동작은 실행하지 않았으며 본문도 실측으로 표현하지 않음
- 공식 문서 tmpfs 6.3 표기는 upstream 문서와 소스의 불일치로 남음. 본문에 명시하고 구현·커널 근거로 한정했으므로 글을 보류할 조건은 아님
- 별도 reviewer와 배치 전체 lint/build/export 검증 후 완료 편수에 포함할지 부모가 확정
- 공유 plan/README·다른 글·기존 SVG·원본 Vault 수정 없음, commit/build 실행 없음


## 별도 blog-reviewer 검수

# Review: Batch11 · 3 posts + 5 SVG

## P0 위반 · 필수 수정

최종 미해결0건. 발견1건은 주담당 수정 후 재검토 통과

- `k8s-theory-node-swap.md:84~87` — [QoS 적용 범위] “컨테이너별 선언을 기준으로 … Guaranteed/BestEffort/나머지 Burstable”, “BestEffort는 memory request도 0이어서 … 0” → 현재 기본 on인 PodLevelResources 경로에서는 Pod 수준 선언을 우선해 QoS를 계산하므로 raw container request와 항상 대응하지 않음 → 현재 기본 ComputePodQOS의 `spec.resources` 우선 분기를 밝히고 컨테이너 기준 설명·BestEffort request0 설명을 해당 경로에만 한정. 수정된 문맥과 뒤의 컨테이너별 swap 비교/비례식 설명 재검토 통과

실제 근거: [ComputePodQOS](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/v1/helper/qos/qos.go#L43), [GetContainerSwapBehavior](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/kuberuntime/kuberuntime_container_linux.go)의 Pod QoS 검사 뒤 raw container memory request/limit 검사. 같은 ref의 Batch10 공식 캐시도 실제 다시 열고 manifest SHA일치 확인

## 확인 필요

0건. 핵심 원본·근거 부족으로 보류할 글 없음

## P1 권장

최종 미해결0건. 발견1건은 주담당 반영 후 재검토 통과

- `k8s-theory-node-swap.md:183` — [근거 자립성] “현재 확인한 공식 문서 두 곳은 … 6.3” → 두 문서를 본문에서 식별하지 않아 말미의 Linux Node Swap Behaviors가 근거인 것으로 혼동할 수 있음 → 실제 두 문서인 Swap memory management와 Linux Kernel Version Requirements의 이름·링크를 해당 문장에 추가. 공식 웹 두 위치의6.3표기를 직접 확인했고 수정 문장 통과

## P2 참고 · 실제 lint

완료된 HPA부터 먼저 lint:post를 실행했고, logs/swap 완료 뒤 각각 검사. 두 지적 수정 후 최종3편을 함께 실제 실행:

```text
k8s-theory-node-swap.md
  △ [문장길이] 100자 초과 줄 27곳 — 분리 검토
  요약: error 0 · warn 1
k8s-theory-container-log-files.md
  △ [문장길이] 100자 초과 줄 29곳 — 분리 검토
  요약: error 0 · warn 1
k8s-theory-hpa-scale-subresource.md
  △ [문장길이] 100자 초과 줄 20곳 — 분리 검토
  요약: error 0 · warn 1
전체: error 0 · warn 3 (파일 3개)
```

긴 줄은 고정 URL·표·필요 조건을 포함. 길이만 맞추려고 조건을 줄일 추가 사유 없음. lint 담당 항목을 별도 정규식으로 재구현하지 않음

## 원본·문체·등록 대조

- docs/writing-voice.md, draft-to-post 진입점·공동 절차, 시리즈 plan/source-format 기준 적용
- `/tmp/k8s-batch11/sources.json`의 정확한 원본3개 전문 읽고 현재 본문 전부 대조: 2-15 463줄, 2-16 569줄, 2-17 644줄. 실제 원본 SHA-256 3/3 일치 재검사
- essays/kubernetes, series k8s-theory-node, order16·17·18 일치. slug 중복 없음
- 격식체·자립적인 용어/조건 설명·시리즈 연결·불필요한 반복·과장을 확인. 원본 없는 swap 실험·로그 수집·GitOps 충돌·개인 경험 창작 없음. 노트 LAB TODO·자가 판정·실명·편집 경위를 본문에 노출하지 않음
- 수식·로그 한 줄·설정·SSA 순서 예시는 가정/형식 예시로 표시. 고정 소스의 오류 이름을 실측 장애 기록으로 표현하지 않음

## 핵심 기술 실제 검증

Kubernetes v1.37.1 `f78e722310e50bcaca9276be22276d9e91d91308`, website `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`의 실제 파일을 열람. 작성자 보고서만으로 승인하지 않고 원본/현재 글/소스의 핵심 분기·숫자·버전·예외 대조

| 글 | 실제 대조와 판단 |
|---|---|
| swap | NodeSwap symbol·등록·runtime 검사 존재, v1.34 GA/on/잠김과 remove in1.37 주석을 구분. failSwapOn=true·failCgroupV1=true, LimitedSwap+v1 기동 거부 확인 |
| swap | 여섯 제외 조건, static/mirror/시스템critical priority, PodQoS와 raw container memory request/limit의 별도 판정 확인. Pod-level만으로 양수 swap이 생긴다고 쓰지 않으며 QoS 설명 범위 수정 완료 |
| swap | 노드 전체 RAM/전체 swap을 사용하는 비례식·정수 변환·입력 오류→NoSwap. v2 Unified memory.swap.max와 v1 memory+swap 합산 필드·일부 swap 가능·memoryLimit0 무시·controller 부재시 생략 확인 |
| swap | kubelet 자신 userns→미지원, 커널 판독 실패→미지원,6.4이상→지원, 구버전 tmpfs mount 시험의 순서 확인. Linux6.3/6.4 shmem 파서 차이와 공식 문서6.3불일치 보존. Warning이 기동 중단을 뜻하지 않음 |
| swap | Node status 비영0용량과 summary/metrics사용량 구분. CRI swap 자체 미보고시 실제0대입 분기·Pod합산을 확인. eviction AvailableBytes/WorkingSetBytes와 swap통계를 구분하고 min_free_kbytes의 zone별WMARK_MIN 의미를 직접 대조 |
| logs | LogDirectory/상대LogPath·디렉터리생성/런타임기록, restart count의 상태 우선/로그이름fallback·회전본 이름 포함, legacy symlink255바이트 확인 |
| logs | 읽기 시작 레코드로 CRI/Docker파서선택, P개행제거·containerd 긴줄/개행없는EOF의P, since외부timestamp 비교를 확인. SplitStreams는Alpha/off, 양쪽gate·특정stream/tailLines 불가·TTYstderr조건 구분 |
| logs | 실행 중 회전큐·크기>=임계·기본10Mi/5/1/10s, maxFiles-2정리→압축→rename→Reopen순서와 실패복구시도 확인. 즉시 압축하지 않은 최신회전본·성공 후개수와 엄격크기/무손실보장 부재를 구분 |
| logs | previous는 LastTerminationState.ContainerID 선택 뒤 status.LogPath하나 조회. 현재조회도 상태별 인스턴스를 선택. 파일명n-1산술/회전본조회와 구분. API서버중계·컨테이너GC·선택오류/RPC오류·종료message fallback조건과80레코드/2KiB 확인 |
| HPA | 지표API별클라이언트, 정수사용률=(usageTotal*100)/requestTotal, 무보정 경로 readyPodCount 곱셈, Pod-level/선택컨테이너request 및 누락오류 확인. 단순currentReplicas수식을 모든분기로 일반화하지 않음 |
| HPA | request누락 down=max(100,target)%/up0, raw누락down=target/up0, CPU미준비·Ready/StartTime/Timestamp/Window·보정뒤반전억제, 여러지표최대추천과부분오류축소억제 실제분기 확인 |
| HPA | tolerance0.1·sync15초·CPU초기5분/30초·down창300초, configurable tolerance v1.37GA/on/잠김 확인. legacy와behavior 안정화·기간별변경정책·메모리이력·초기현재목표추천을 구분 |
| HPA | Deployment ScaleREST가 같은store를GET/Update하며 본체RV로Scale조립. ScaleHandler ToSubresource/ToParent가 이전 replicas필드를제거하고 빈집합항목삭제. 일반Update/SSA/RBAC/fieldManager-UA/409재시도를 구분 |
| HPA | 공식SSA 인계에서 HPA작성 전 유일소유자 replicas제거→Deployment default1 위험 확인. Apply충돌만으로 값이진동한다고쓰지않음. Deployment controller는ReplicaSet본체를갱신. CRD경로값부재/selector문자열/빈selector오류를확인 |

근거 캐시 `/tmp/k8s-batch11/{swap,logs,hpa}/`. manifest 기록과 실제 SHA-256 재검사84/84 일치(swap33, logs25, hpa26). swap의 잘못 짚은 helpers_linux.go 후보404는 사용하지 않고 helpers_others.go로 실제 대조. HPA의 재사용 metrics-server v0.9.0 README SHA도 일치 확인

추가로 다시 열람한 QoS 근거는 `/tmp/k8s-batch10/accounting/kubernetes/pkg/apis/core/v1/helper/qos/qos.go`, 같은 Kubernetes ref이며 기존 manifest와 SHA일치 확인. root는 QoS기본gate와 문서 링크를 별도 재확인하고 fixes.md에 기록

주요 직접 공식 웹 대조: [Swap management](https://kubernetes.io/docs/concepts/cluster-administration/swap-memory-management/), [Swap behaviors](https://kubernetes.io/docs/reference/node/swap-behavior/), [Kernel version requirements](https://kubernetes.io/docs/reference/node/kernel-version-requirements/), [Logging Architecture](https://kubernetes.io/docs/concepts/cluster-administration/logging/), [HPA](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/), [SSA 인계](https://kubernetes.io/docs/reference/using-api/server-side-apply/#transferring-ownership)

외부 구현은 containerd v2.4.2 `b7a25261e029d68978bbf290df0a62fc819b3c51`, Linux v6.3/v6.4 shmem 및 v6.12 cgroup/VM 문서 범위. 실제 노드 설치·동작 측정으로 확대하지 않음

## SVG 실제 렌더·육안 검사

- 같은 slug SVG5개 XML 파싱 통과. sharp800px/375px PNG10개 실제 생성 후 전부 육안 검사
- `/tmp/k8s-batch11/reviewer-render/`에 PNG와 입력SHA 보존
- swap1장: 기동 허용·정책선택·Pod/컨테이너조건·컨테이너별계산·cgroup전달을 구분, QoS수정과충돌없음
- logs2장: 경로지정/기록/읽기/중계 주체, rename뒤열린fd/재열기·회전성공후보존수를 확인. 인스턴스번호가 회전으로증가하는그림이아님
- HPA2장: 계산/안정화/쓰기를 구분, GitOps와scale이같은Deployment에연결되며Deployment controller의쓰기대상은ReplicaSet인관계확인
- 한글라벨허용기준적용. 겹침·잘림·화살표/라벨충돌없음. 모바일핵심라벨·흐름확인, 긴그림tall힌트존재

## 요약

필수 수정0건 · 확인 필요0건 · 미해결 권장0건. 발견한 필수1건·권장1건은 반영 후 문맥 재검토 통과. P2 길이 경고3개 글

최종3편+5SVG SHA-256은 review-hashes.json의 상대경로→hash 단순매핑. 최종SVG와 육안검사한10PNG 입력동일성확인. reviewer는콘텐츠/공통문서수정·build·commit·push실행안함. 전체lint·build·정적출력·최종빌드입력동일성은주담당통합검증범위


### 지적 반영·재검토

- 필수 조건 수정 1건: swap 글의 QoS 분류를 컨테이너 선언만의 결과로 일반화한 문장을 수정했다
- 현재 기본 on인 PodLevelResources와 PodLevelResourcesFixKubeletQOSClass 경로에서 Pod 수준 자원이 설정되면 spec.resources로 우선 계산하는 ComputePodQOS 실제 분기를 확인했다
- 컨테이너별 분류 설명은 Pod 수준 계산 경로를 사용하지 않는 경우로 한정했고, BestEffort request=0 설명도 컨테이너 기준 QoS 범위로 한정했다
- 이어지는 실제 swap 비교·한도 계산은 raw container request/limit을 사용한다는 조건을 보존했다
- 근거 자립성 권장 1건 반영: tmpfs noswap을 6.3으로 적은 공식 문서 두 개를 본문에서 Swap memory management와 Linux Kernel Version Requirements로 이름·링크와 함께 명시했다
- Linux Node Swap Behaviors를 6.3 표기의 근거로 오해하지 않도록 구분했다


## 실제 최종 검증

- `npm run lint:post -- <이 배치 3편>`: exit 0, error 0 / warn 3
- `npm run lint`: exit 0, error 0 / warn 1 (기존 `src/app/layout.tsx:80` custom font 경고)
- `npm run build`: exit 0, TypeScript·정적 생성·postbuild 성공, 610 pages
- 원본 SHA-256·검수 후 글/SVG와 빌드 입력 hash 일치
- slug 유일성·시리즈 order 연속성·내부 링크·이미지 실존·SVG XML/접근성 메타 검사 통과
- `getAllPosts`·`getEssaysList`·`getSearchIndex` 실제 실행: 3편 모두 essays로 등록, 목록·검색 객체에 content 없음
- HTML 3개·SVG 5개 실제 export 및 `/my-blog/diagrams/` 참조·SVG 바이트 일치
- sitemap·llms 3편 반영, RSS는 기존 최신 20편 정책과 실제 출력 일치
- `git diff --check` 통과
- prebuild의 이번 CLAUDE.md 자동 통계 변경만 복원, Vault 원본 변경 없음
- build의 Node `DEP0205 module.register()` 및 로컬 TS 직접 import의 `MODULE_TYPELESS_PACKAGE_JSON` 경고는 남아 있으며 애플리케이션 설정을 범위 밖에서 바꾸지 않았다
- 클러스터 실습·통합 테스트·성능 실측·push·배포·시리즈 카드 등록: 실행 안 함

원시 로그·임시 근거 저장본: `/tmp/k8s-batch11/`
영구 재확인 경로는 위 글과 작성 기록의 공식 소스 URL이다

## 다음 대상

- `Phase 2-18 · 임시 컨테이너와 ephemeralcontainers · 더하기만 되는 문은 아무것도 바꾸지 못한다.md` → `k8s-theory-ephemeral-containers` (`k8s-theory-node` / 19)
- `Phase 3-1 · CNI spec · 만들지 않고 요구만 한다.md` → `k8s-theory-cni-contract` (`k8s-theory-network` / 1)
- `Phase 3-2.1 · sandbox 와 pause (1) · 주소는 컨테이너가 아니라 그 옆에 붙는다.md` → `k8s-theory-pod-sandbox-pause` (`k8s-theory-network` / 2)
