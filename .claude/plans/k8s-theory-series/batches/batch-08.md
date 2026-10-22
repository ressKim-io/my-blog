# Batch 08 인계 — 2026-10-23

3편 검수 완료, SVG 7장. 콘텐츠 커밋 `4db7801`
이번 요청 누적 6/30편, 전체 시리즈 누적 32편

## 원본·결과 대응

원본 루트: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/`
읽기 전용으로 사용했으며 작업 전후 hash 일치를 검증했다
작성 기준일은 2026-10-23이며 학습일·배포일을 뜻하지 않는다

| 좌표 | 원본 파일 | 줄 수 | SHA-256 | slug | series / order |
|---|---|---:|---|---|---|
| 2-7 | `Phase 2-7 · 관측 세 소스 · 같은 것을 묻는 세 개의 창구.md` | 424 | `017ede4797c15c52d0ba9f6b08cac2d9d4b40efa94e0f40a4b1b2e654ab3c02f` | `k8s-theory-node-observability-sources` | `k8s-theory-node` / 7 |
| 2-8.1 | `Phase 2-8.1 · Deployment 와 DaemonSet (1) · 되돌리기는 앞으로 간다.md` | 706 | `c8935ccaa75fc18f4ade86d4657dbf21e1c08aea7b871628b3976f3a235b3ef4` | `k8s-theory-workload-rollout-revisions` | `k8s-theory-node` / 8 |
| 2-8.2 | `Phase 2-8.2 · Job 과 CronJob (2) · 끝은 상태가 아니라 개수다.md` | 669 | `0d3a179a7fe431994ca4d432bd6de9ca13204815b10b97a947b2d7c1bd518ab2` | `k8s-theory-job-cronjob-completion` | `k8s-theory-node` / 9 |

글 경로는 `src/content/essays/kubernetes/{slug}.md`, SVG는 `public/diagrams/{slug}-{n}.svg`다

## 작성자의 근거 대조·편집 기록

아래는 작성 단계의 기록이다. 이후 보완·정정은 별도 검수와 지적 반영 기록을 우선한다

# Batch 08 · Phase 2-8.2 작성 인계

- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 2-8.2 · Job 과 CronJob (2) · 끝은 상태가 아니라 개수다.md`
- 2026-10-23 최신 저장본 669줄 전문 읽음. SHA-256 `0d3a179a7fe431994ca4d432bd6de9ca13204815b10b97a947b2d7c1bd518ab2`, 배치 sources.json과 실제 파일 일치 확인
- progress의 2-8 해당 행, source-map Phase2의 Job/CronJob 본절·최신 주체/실패 경계 보완 확인
- 글: `src/content/essays/kubernetes/k8s-theory-job-cronjob-completion.md` 298줄
- series/order/date: `k8s-theory-node` / 9 / 2026-10-23
- tags: Kubernetes, Job, CronJob, Controller, concept
- SVG 3개: `public/diagrams/k8s-theory-job-cronjob-completion-{1,2,3}.svg`. #1 중간·최종 판정, #2 completions/parallelism, #3 최근 놓친 회차 선택. 원본 흐름3개를 재구성했으며 독립 신규그림0개. 표5개
- 공통 voice·draft-to-post 진입점/공동절차, series plan/source-format, SVG 기준 적용. 자기 글·자기 SVG만 변경했고 원본·공통문서·타인수정 보존. commit/build/push 실행 안 함

## 실제 읽은 고정 근거

Kubernetes v1.37.1 `f78e722310e50bcaca9276be22276d9e91d91308`, website `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`의 공식 raw16파일을 내려받아 실제 관련 함수·문서를 읽었다. manifest.json에 URL·SHA-256을 보존했으며 이후 16/16 실제 파일 hash 재검사 일치

- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/batch/v1/defaults.go — completions/parallelism 동시생략1, parallelism만 명시하면 completions nil, backoffLimit6/MaxInt32, 대체정책, CronJob Allow/성공3/실패1
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/batch/validation/validation.go — restartPolicy, Indexed 성공규칙, podFailurePolicy·대체정책 조합
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/job/job_controller.go — syncJob·manageJob·pastBackoffLimitOnFailure·pastActiveDeadline·trackJobStatusAndRemoveFinalizers·enactJobFinished·isPodFailed
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/job/backoff_utils.go — 마지막성공후 실패기록과 마지막실패후 남은지연 계산
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/job/pod_failure_policy.go — Ignore/Count/FailIndex/FailJob, 종료된 컨테이너의 nonzero exitCode 매치
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/job/success_policy.go — 순차규칙·첫매치·목록/개수 평가
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/job/indexed_job_utils.go — index 중복집계제외·annotation/label·환경변수 추가 조건
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/cronjob/cronjob_controllerv2.go — syncCronJob·nextScheduleDelta100ms·AddAfter·Forbid/Replace·AlreadyExists·getJobName
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/cronjob/utils.go — mostRecentScheduleTime·nextScheduleTime·시작기한·epoch분 이름·scheduled-timestamp
- https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/ttlafterfinished/ttlafterfinished_controller.go — terminal condition 시각+TTL·재조회·UID전제·foreground삭제
- `staging/src/k8s.io/api/batch/v1/types.go`, `pkg/apis/core/v1/defaults.go`, `pkg/features/kube_features.go`도 API필드·PodSpec default·현재이력 대조에 사용
- https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/workloads/controllers/job.md
- https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/workloads/controllers/cron-jobs.md
- 같은 website ref의 `concepts/workloads/controllers/ttlafterfinished.md`
- 현재 공식웹 https://kubernetes.io/docs/concepts/workloads/controllers/job/ 및 https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/ 도 열람

## 원본 대비 정정·한정

1. **backoff 문서 갱신**: 원본의 문서6분/소스10분 불일치는 현재 website 저장본에서 해결돼 있다. 현재 문서 ten minutes와 소스10분 일치로 설명했다. 오래된1.24가 문서6분의 원인이라는 역사적 추론을 현재 근거로 재사용하지 않음
2. **CronJob100회 차이는 유지**: 현재 문서는100회 초과 생성중단, 현재 고정소스는 경고 후 최근회차 반환이다. 문서와 구현을 구분하고 `TooManyMissedTimes`만으로 생성중단을 확정하지 않음
3. **10초 검사 일반화 교정**: 현재 문서의10초미만 기한경고는 보존하되, 구현은 `nextScheduleTimeDuration`으로 다음시각+100ms를 계산하고 큐 AddAfter한다. 고정10초poll이나 모든회차필연누락으로 단정하지 않음
4. **suspend의 시간**: 재개할 때 startTime을 현재로 reset한다. 원본 개념요약 “재개하면 다시 흐른다”를 중단전 누적시간 보존으로 읽지 않도록 교정함
5. **실패정책 action**: 새 실패판정의 맨앞은 podFailurePolicy의 모든 매치가 아니라 FailJob 규칙이다. Ignore/Count/FailIndex를 구분했고 FailedIndexes reason과 전체index정리 조건도 보존함
6. **카운터 경계**: failed>backoffLimit은 두restartPolicy 공통, OnFailure만 Running/Pending의 일반·init컨테이너 restart합 추가검사. 양수>=,0은>0을 보존. Ignore·삭제중비Succeeded집계·Failed대체정책의 집계차이 때문에 화면Failed수와 같다고 단정하지 않음
7. **완료조건**: completions 유무와 무관하게 기본경로는 active0을 함께 본다. Indexed는 번호별성공, SuccessPolicy는 규칙순서·첫매치·목록내개수. 기존SuccessCriteriaMet를 먼저존중하므로 “항상실패가성공을뒤집음”으로 쓰지 않음
8. **최종조건**: FailureTarget/SuccessCriteriaMet와 Failed/Complete를 나누고 미집계/terminating Pod가 남으면 최종조건을 미룬다. TTL은 최종condition 시각부터이며 Pod삭제완료시각 보장이 아님
9. **재시도시계**: Job컨트롤러의 Pod보충backoff와 kubelet컨테이너재시작backoff를 구분했다. 마지막성공후실패와 마지막실패후경과시간 조건을 보존했고 실측수열로 쓰지 않음
10. **정확히한번 한계**: 최근회차선택과 생성성공 구분, Forbid의 cached active한계, Replace삭제요청/종료완료 구분, 이름충돌/다른회차겹침 구분, AlreadyExists의 소유확인/활성상태복구를 설명함
11. **대체정책의 이유**: podFailurePolicy가 있으면 Failed만 허용한다는 사실과 종료코드가 종료후생긴다는 기전은 확인했지만, 그둘로 설계의도를 입증했다고 쓰지 않음
12. 원본학습판정·LAB TODO·추가편집이력을 본문에서 빼고 독자에게 직접설명했다. 가정그림의 시간/순서를 실측으로 표현하지 않음

## 대표 문장

원문: “`activeDeadlineSeconds`는 `status.startTime`부터 잰 Job의 수명 한도 / suspend 하면 안 잰다. 재개하면 다시 흐른다”

변환: “suspend 상태에서는 이 시간 한도를 검사하지 않습니다 / 재개할 때는 `startTime`을 현재 시각으로 다시 설정하므로, 중단 전까지 쓴 시간을 누적한 채 초시계를 이어 가는 방식이 아닙니다”

이유: 시간한도라는 본래 설명을 보존하면서 `syncJob`의 실제 reset 동작으로 모호한재개표현을 한정함

## 작성자 검증·남은 문제

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-job-cronjob-completion.md` 실제 실행 error0/warn1. 100자초과26줄은 URL·표조건 등을 포함하며 문맥검토 후 보존. lint-post.log
- SVG3개 XML파싱·sharp PNG렌더·육안검사 통과. 한글라벨·최소15px·title/desc·viewBox·겹침없음 확인. 최종figure3는 diagram-3-final.png로도 별도렌더/육안확인
- 그림text개수경고는 최종본 없음. 긴줄경고만 남음
- 내부링크2개·이미지3개 실존 확인. output-checks.json에 본문·SVG hash/줄수·참조검사 보존
- 전섹션 능동시각화 재검토: 완료단계·성공수/동시수·놓친회차는 그림, 비교연산자·reason·success규칙·동시정책은 표, 근거/한계는 산문. 반복개념요약 섹션은 별도추가하지 않음
- 격식체·문단끝마침표·직역·과장·반복·내부편집맥락·허구경험 없음 원본대조검토
- Decision section 미포함: 실제대안선정 서사가 없는 컨트롤러기전해설
- 실제클러스터실습·전체lint·build·정적export 실행 안 함. 독립reviewer와 주담당통합검증 전이며 완료편수에 아직포함하면 안 됨
- 핵심근거부족에 따른 보류항목 없음. CronJob 문서/소스차이는 위2·3에 명시. 나머지 독립검수·배치검증 대기


# Batch08 · Phase 2-7 작성 보고

- 원본 정확한 파일명: `Phase 2-7 · 관측 세 소스 · 같은 것을 묻는 세 개의 창구.md`
- 원본 경로: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 2-7 · 관측 세 소스 · 같은 것을 묻는 세 개의 창구.md`
- 2026-10-23 전문 424줄을 읽음
- SHA-256: `017ede4797c15c52d0ba9f6b08cac2d9d4b40efa94e0f40a4b1b2e654ab3c02f`. Batch08 입력 목록과 일치
- 출력: `src/content/essays/kubernetes/k8s-theory-node-observability-sources.md`
- series/order/date: `k8s-theory-node` / `7` / `2026-10-23`
- 원본은 읽기 전용. 공통 plan·README·commit·build는 작성 담당에서 변경·실행하지 않음
- 관련 최신 progress의 2-7 학습 범위·관측 보완 상태와 source-map의 2-7·v1.37 대조 절을 확인. hash는 `source.json`

## 기준 버전과 실제 확인 근거

- Kubernetes v1.37.1: `f78e722310e50bcaca9276be22276d9e91d91308`
- Kubernetes website: `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
- metrics-server: 공식 최신 release 페이지에서 v0.9.0 확인, 태그 API를 실제 조회해 commit `2a7c4b2c7d46552ff47f4aeaa3a735c582587ecd`로 고정
- kube-state-metrics: 공식 최신 release 페이지에서 v2.20.0 확인, 태그 API를 조회해 commit `4ffeda2ef866b0fef372849825a803296483b336`로 고정
- go.mod·vendor/modules.txt의 cAdvisor/lib v0.60.5를 먼저 확인한 뒤 해당 벤더 메모리 계산 코드를 읽음
- `manifest.json`: 실제 받은 공식 파일35개 URL·hash·크기, 다운로드 오류0
- `extra-manifest.json`: 추가 CRI collector·통계 타입·metrics-server decoder 등5개 URL·hash
- `reused-manifest.json`: Batch07에서 받은 동일 Kubernetes ref의 kubelet.go·feature gate 소스를 다시 읽고 복사한 이력
- 외부 도구 설치·의존성 추가 없음. 저장소의 기존 sharp로 SVG 렌더링

## 주장 대조와 원본 정정

| 쟁점 | 확인한 소스 | 결과·반영 |
|---|---|---|
| 세 소스의 원본 | KSM README/internal/store/deployment.go, kubelet stats provider, metrics-server scraper | API 선언·상태와 노드 사용량, 그 최근 표본을 나눔. 세 독립 측정기로 서술하지 않음 |
| API 세대와 가용성 | KSM deployment.go의 네 family | spec replica/available/generation/observedGeneration의 원본 필드 대조. observedGeneration이 같아도 가용 replica 완료 보장은 아님 |
| cAdvisor endpoints | kubelet/server/server.go | /metrics/cadvisor는 기본 cAdvisor collector이나 PodAndContainerStatsFromCRI를 켜면 CRI collector. 실제 gate는 v1.37 Beta·기본 off임을 확인 |
| resource endpoints | resource_metrics.go·server/stats/summary.go·stats/provider.go·cri_stats_provider.go | resource collector는 내부 Summary provider, container stats는 CRI/cAdvisor 구성이 있어 두 endpoints의 값이 언제나 같은 원본·표본이라는 원본의 단정을 수정 |
| eviction 내부 소비 | eviction_manager.go :: summaryProvider.Get | 원본 ‘eviction manager가 /stats/summary를 읽는다’는 표현을 내부 provider 직접 호출로 정정. HTTP 노출과 내부 소비 분리 |
| 같은 지표 이름 | resource_metrics.go, cAdvisor prometheus.go | container_memory_working_set_bytes 양쪽 존재·resource 라벨3개·STABLE 확인. target와 endpoint 중복 합산 주의 |
| working set | vendor cadvisor/lib container/libcontainer/handler.go :: setMemoryStats | usage에서 inactive_file을 빼고0하한. cgroupv1/v2 키 구분. 모든 cache 제외·실제 회수 가능량·OOM 확정값으로 쓰지 않음 |
| RSS | 같은 함수·prometheus.go | cgroup v2 anon값과 원본 매핑 확인. 전체 usage와 같지 않음 |
| node memory.available | summary.go :: adjustForHugePages, eviction/helpers.go | 기존 eviction 글과 같은 hugepage capacity 차감·0하한 조건 반영. node/container 측정 범위 분리 |
| metrics-server 경로 | scraper/client/resource/client.go, manifests/base/deployment.yaml | 기본 /metrics/resource, Node 어노테이션 경로 override, v0.9.0 기본 배포 --metric-resolution=15s 확인 |
| metrics-server 캐시 | storage/storage.go·pod.go·node.go·types.go | 원본 ‘latest sample’ 단순화를 보완. 실제 last/prev 두 표본으로 CPU 차분/시간 평균, memory는 last working set |
| API 시간 | metrics/types.go, metrics-server storage/types.go·api/pod.go | Timestamp·Window는 표본시각/계산구간. 과거시각 조회조건이 아님. 15s 설정이 Window15s 보장은 아님 |
| HPA·kubectl 소비 | top_pod.go, podautoscaler/metrics/client.go :: NewRESTMetricsClient, 공식 resource pipeline | resource/custom/external 구분, top은 Metrics API. Prometheus 설치가 자동 Metrics API 등록은 아님 |
| 이력 보존 | metrics-server README·storage/api, KSM README | 메모리 표본을 둔 것과 사용자 과거이력 조회저장소는 다름. metrics-server 재시작은 캐시 비움. 미실행 LAB을 결과로 만들지 않음 |
| 로그 보존 | 공식 logging.md, logs/container_log_manager.go | containerLogMaxSize는 회전 크기 기준. 최신 파일만 kubectl logs로 제공되는 범위 보완. 지표 이력과 로그 파일 구분 |

주의: 초기 부모 메시지에서 PodAndContainerStatsFromCRI를 기본 on으로 잘못 읽어 전했으나, 실제 gate 항목을 재확인해 즉시 기본 off로 정정했고 본문·이 보고서는 확인값만 반영함
원본의 metrics-server v0.8.0 근거를 최신 v0.9.0으로 다시 읽었으며, 같은15초 설정은 현행 매니페스트로 새로 확인함
KSM v2.20.0의 client-go 범위나 설치된 도구·런타임 버전을 현재 클러스터의 실측으로 주장하지 않음

## 시각화·탈고 검토

- SVG1장: API→KSM, 노드 통계→kubelet→metrics-server→Metrics API 소비자의 관계
- 단순 계산은 text 식, 엔드포인트·지표·조사 질문은 표로 정리. 전 섹션 능동 시각화 재검토 완료
- 한글 라벨, 기술명 원어, 최소17px, role/title/desc, 평탄 경로. XML파싱 통과
- sharp로 원본800px·모바일375px PNG를 실제 렌더한 뒤 도구로 두 장 모두 직접 열어 검사
- 최종 그림에서 글자 잘림·박스 넘침·선 겹침 없음. 작은 폭에서도 흐름·핵심라벨 식별 가능
- common voice로 기전·조건·불확실성·격식체·마침표·반복·내부 맥락 검토 완료
- 선택지 비교 섹션 미포함: 원본은 관측 소스 역할 비교이며 도구 선정 대안 신호 없음
- LAB TODO·종료판정·학습 트랙 내부 메타는 본문에서 제외하고 원본에 보존

## 실제 검증

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-node-observability-sources.md`: exit0, error0/warn1. 100자 초과 줄은 표·링크·조건 설명을 검토해 유지 (`lint-post.log`)
- XML 파싱1장 통과, 최소17px, 이미지 참조 실존
- sharp 2개 PNG 렌더 통과, 원본·375px 육안검사 통과 (`diagram-1.png`, `diagram-1-375.png`)
- 원본 최종 SHA-256은 Batch08 최초 입력과 동일 (`source.json`)
- 전체 lint·build·정적 export: **작성 담당에서는 실행 안 함**, 배치 담당에게 인계
- 독립 blog-reviewer: 아직 미실행, 부모가 별도 검수 예정

## 대표 문장 비교

원문: “같은 워크로드를 대상으로 해도 원본·지표 정의·수집 시점이 다르면 숫자가 달라질 수 있다”

변환: “숫자를 비교하기 전에 원본, 지표 정의, 수집 시점을 구분해야 합니다”

## 남은 문제

핵심 원본·공식 근거 부족으로 보류할 항목은 없음
실제 설치된 런타임 provider·수집설정·세 소스 값 차이는 재현하지 않았으며, 본문에서 실측 고지와 조건을 유지함
독립 검수와 배치 통합 검증 전에는 완료 편수에 포함하지 않음


# Batch 08 · Deployment와 DaemonSet 작성 인계

- 글: `src/content/essays/kubernetes/k8s-theory-workload-rollout-revisions.md` (301줄)
- series `k8s-theory-node` / order 8 / date 2026-10-23
- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 2-8.1 · Deployment 와 DaemonSet (1) · 되돌리기는 앞으로 간다.md`
- 전문 706줄 읽음, SHA-256 `c8935ccaa75fc18f4ade86d4657dbf21e1c08aea7b871628b3976f3a235b3ef4`
- 최신 progress 1122줄/hash `c3081510322928d79907275e31e02c0f4708ec606644bed7581006645d1d16f5`, source-map Phase 2 2189줄/hash `79c08e1759c80a6efc16cde0efd1af227addd3eece6dffd3fd657af6f75c18fe`; 현행 v1.37 대조와 실습 미실행·원본 학습 판정 구분 확인
- draft-to-post 진입점·공동 절차·writing-voice·plan·source-format·SVG 가이드 적용, 기존 reconcile 글 참조

## 확인한 근거

Kubernetes v1.37.1 tag target `f78e722310e50bcaca9276be22276d9e91d91308`, website `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`. 실제 다운로드 URL·hash는 `manifest.json`, 불변 링크는 본문 주장 가까이 인용했다

- [Deployment sync](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/deployment/sync.go): 템플릿 해시·소유 UID·충돌 처리·기존 RS 재사용·revision·cleanup 조건
- [Deployment rolling](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/deployment/rolling.go)·[util](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/deployment/util/deployment_util.go): 목표 replica와 available 구분, 반올림, unhealthy 정리, 4가지 진행 판정과 lastUpdateTime deadline
- [progress](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/deployment/progress.go): 완료·진행·타임아웃 condition, 완료 후 True와 NewReplicaSetAvailable 구분
- [kubectl rollback](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kubectl/pkg/polymorphichelpers/rollback.go): template·annotation 2개 JSON patch, 같은 템플릿이면 생략, 현재 replicas·strategy 복원 아님
- [ReplicaSet](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/replicaset/replica_set.go)·[controller_utils](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/controller_utils.go): 간접 관련 Pod 집계, 활성 판정, 8단계 정렬·로그 구간·UID 조건, 일반 DELETE로 PDB eviction 예산 검사 우회
- [DaemonSet controller](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/daemon/daemon_controller.go)·[util](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/daemon/util/daemonset_util.go): 후보 조건·자원 미검사·필수 affinity 대체·6+1 toleration·NoExecute 시간 제한 없음
- [DaemonSet update](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/daemon/update.go): 기본 삭제 후 생성, surge, 현재 템플릿과 같은 ControllerRevision 재사용·revision 변경
- [apps 기본값](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/apps/v1/defaults.go)·[validation](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/apps/validation/validation.go): 25%/25%·1/0·10·600, selector 불변과 ControllerRevision data만 불변
- [deletion cost parser](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/helper/helpers.go)·[Pod validation](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go): int32·+10/008 거부·compat 허용·파싱 실패 0
- [Deployment 공식 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/workloads/controllers/deployment.md), [DaemonSet](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/workloads/controllers/daemonset.md), [ReplicaSet](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/workloads/controllers/replicaset.md) 해당 절 대조

## 정정과 편집 판단

1. rank는 Ready Pod만/같은 RS만 세는 것으로 쓰지 않았다. Less의 주석과 달리 실행 코드가 IsPodActive를 세고, 같은 owner의 형제 RS selector로 찾은 Pod까지 포함한다. 본문에 실행 분기와 주석 차이 명시
2. ControllerRevision의 불변 범위는 data. revision과 metadata 갱신까지 금지되는 오브젝트로 쓰지 않았다. constructHistory의 실제 revision 갱신과 대조
3. revisionHistoryLimit=0은 즉시 전부 삭제가 아니다. 완료 후 정리, spec/status replicas 0·관측 generation 등의 조건을 명시. 완료 안 된 경우 한도 초과도 보존
4. maxSurge의 목표 수와 종료 중 포함 실제 수, maxUnavailable의 조정 목표와 장애 상황의 실제 가용성을 구분. 두 필드 계산을 실제 실험 결과로 쓰지 않음
5. undo는 이전 RS 재사용 가능·같은 template 생략·선택된 annotation만 복원으로 한정. replicas·strategy를 과거로 복원한다는 의미 제거
6. DaemonSet은 필수 nodeAffinity를 대체한다. 후보 검사에 nodeSelector도 포함하며 원본의 세 조건 표현을 필드 단위로 명확화. 백분율 unavailable의 올림도 Deployment와 구분
7. 소스의 v1.35 Permit 상세는 이 글에 반복하지 않고 이미 작성한 현행 scheduling 글에 연결. Job 완료 경계는 다음 글에 남김
8. 원본 종료 판정·LAB TODO·학습 관리 문구는 제외. 원본에 없는 경험·수치·실패 사례는 만들지 않았다

## 검증

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-workload-rollout-revisions.md`: exit 0, error 0 / warn 1(긴 줄 24곳). 고정 URL·표·조건 문맥 검토, 경고를 0이라고 보고하지 않음
- SVG 3개: XML 파싱 OK, font-size 최소 15px, role·title·desc와 참조 확인
- sharp PNG 렌더링 후 3개 육안 검사. 첫 SVG의 화살표/라벨 겹침을 수정하고 재렌더링·육안 재확인
- 전 섹션 시각화 재검토: 집합 관계·undo 시간 흐름·DaemonSet 주체 흐름은 SVG, 수치·toleration·실패 판별·삭제 순서는 표로 보존
- 독립 blog-reviewer·통합 lint/build/export는 주 담당 단계. 이 작성자는 공통 docs/commit/build/push를 수정·실행하지 않음

## 대표 문장 비교

- 원문: “maxSurge는 롤아웃 중 요청할 replica 수를 제한하고, maxUnavailable은 유지해야 할 available Pod 수를 정한다. 두 필드는 세는 대상이 다르다.”
- 변환: “RollingUpdate에서 maxSurge는 ReplicaSet들의 목표 replica 합계를 얼마나 더 늘릴지 정합니다 / maxUnavailable은 교체하면서 유지하려는 available Pod 수의 하한을 정합니다”
- 원본의 비교 축을 유지하고 종료 중 Pod와 장애의 예외를 바로 연결해 오해를 줄임

## 남은 문제

핵심 주장 보류 항목 없음. 실제 롤아웃·스케줄링·삭제 순서는 재현하지 않았다. ControllerRevision API 문서의 추정 원시 경로 1개가 404여서 인용하지 않고 실제 API 타입·validation·DaemonSet update 소스로 확인했다


## 별도 blog-reviewer 검수

# Review: 3 files + 7 SVG

2026-10-23 / Batch08 / 작성자와 별도 blog-reviewer

## P0 위반 (즉시 수정 필요)

최종 저장본에 남은 필수 수정 없음. 검수 중 기술 조건 누락2건을 발견했고 주 담당 수정 후 해당 문맥과 근거를 재검토함

1. `src/content/essays/kubernetes/k8s-theory-workload-rollout-revisions.md:125` — [근거] “롤아웃 완료 뒤의 정리” → 일반 RollingUpdate는 완료 후 cleanup을 호출하지만 `sync.go::sync`는 paused && getRollbackTo==nil에서 완료 검사를 하지 않고 cleanup을 호출함 → “일반 RollingUpdate 경로에서는 완료 뒤”로 한정하고 일시 중지 예외 추가
   - 반영 확인: 현재 본문은 두 경로를 구분하며, 0replicas·관측 generation 조건과 historyLimit=0의 비즉시성 설명도 보존함
   - 근거: [sync와 cleanupDeployment](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/deployment/sync.go), [rolloutRolling](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/deployment/rolling.go)
2. `src/content/essays/kubernetes/k8s-theory-job-cronjob-completion.md:85` 부근 — [근거] “Never는 그 컨테이너를 다시 시작하지 않는다” → v1.37 기본 on인 ContainerRestartRules에서 일반 컨테이너 정책·규칙은 Pod 정책을 재정의할 수 있음 → 컨테이너별 설정 없는 기본 경로로 한정하고 재정의 가능성 설명 추가
   - 반영 확인: 제목을 Pod 재시작 정책으로 명확화했고 Always 설명과 Never/OnFailure 비교의 적용 범위를 한정함. 이후 backoff 추가검사는 Pod-level OnFailure만 검사한다는 표를 그대로 유지해 소스 조건과 맞음
   - 검수자가 공식 고정파일3개를 추가로 내려받아 Job strategy→validation options→feature gate→컨테이너 정책 평가의 전체 연결을 확인함
   - 근거: [Job strategy](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/registry/batch/job/strategy.go), [GetValidationOptionsFromPodTemplate](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/api/pod/util.go), [ContainerShouldRestart](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/api/v1/pod/util.go)
   - 직접 확보한 원시 소스·URL·SHA-256: `/tmp/k8s-batch08/reviewer-sources/manifest.json`과 그 아래 원래 소스 경로

## 확인 필요

최종 검수에서 핵심 원본·근거 부족으로 남은 항목 없음. 클러스터 실습·실측은 실행하지 않았으며, 세 글은 소스·공식 문서 해설로 고지함

## P1 권장

남은 권장 없음. 개수·문단·SVG 할당을 만들지 않음

## P2 참고

자동 문장 길이 경고는 남음. 관측20줄·rollout24줄·Job27줄이며 고정 URL·표·조건 설명을 포함함

## 실제 자동 lint

검수 시작 전에3편 lint를 먼저 실행한 결과 error0/warn3. 수정 반영 뒤 최종3편을 다시 실행했으며 원시 결과는 다음과 같음

```text
npm run lint:post -- src/content/essays/kubernetes/k8s-theory-node-observability-sources.md src/content/essays/kubernetes/k8s-theory-workload-rollout-revisions.md src/content/essays/kubernetes/k8s-theory-job-cronjob-completion.md

src/content/essays/kubernetes/k8s-theory-node-observability-sources.md
    —  △ [문장길이] 100자 초과 줄 20곳 — 분리 검토
  요약: error 0 · warn 1
src/content/essays/kubernetes/k8s-theory-workload-rollout-revisions.md
    —  △ [문장길이] 100자 초과 줄 24곳 — 분리 검토
  요약: error 0 · warn 1
src/content/essays/kubernetes/k8s-theory-job-cronjob-completion.md
    —  △ [문장길이] 100자 초과 줄 27곳 — 분리 검토
  요약: error 0 · warn 1

전체: error 0 · warn 3 (파일 3개)
exit 0
```

자동 lint가 덮는 검사 항목을 grep으로 재구현하지 않고 원본 의미·기전·조건·자립성·자연스러움·이미지에 집중함

## 원본·시리즈·말투

- 앞선 배치에서 읽은 공통 `docs/writing-voice.md`, Codex 진입점·공동 draft-to-post 스킬, 시리즈 `plan.md`·`source-format.md`를 같은 기준으로 적용
- `/tmp/k8s-batch08/sources.json`의 정확한 원본3개 전문을 직접 읽고 대조함: 2-7 424줄, 2-8.1 706줄, 2-8.2 669줄
- 원본 SHA-256을 다시 계산해3/3 최초 기록과 같음을 확인. 원본 파일은 수정하지 않음
- 세 글 모두 `essays/kubernetes`, `k8s-theory-node` order7·8·9, date2026-10-23으로 계획과 일치. 대상 slug별 콘텐츠 파일이 정확히1개이며 같은 시리즈가 logs로 갈라지지 않음
- 원본의 질문·조건·실패 판별과 미확인 설계 이유를 보존함. LAB TODO·등급·학습 판정이 실습 경험으로 바뀐 곳을 발견하지 못함
- replicas3/25%, revision1·2·3, Job6/2, CronJob15시복귀는 원본의 설명 예시이며 실측 결과로 주장하지 않음
- source-map·종료 기준 같은 내부 식별자를 독자용 설명으로 남긴 곳이나 가짜 독백·경험·성능 수치를 추가한 곳을 발견하지 못함
- 표·그림 뒤 설명량은 기전·조건·예외의 충분성으로 검토했고 문단 수 자체를 위반으로 판정하지 않음

## 주요 기술 재검증

Kubernetes v1.37.1 ref `f78e722310e50bcaca9276be22276d9e91d91308`, website `7fde177e22dc98390a6d55d215dd0301b5f6d0bb` 실제 저장본의 관련 함수를 읽음. metrics-server v0.9.0·KSM v2.20.0 공식 release 페이지와 현재 Kubernetes Resource metrics pipeline·Job·CronJob·Pod Lifecycle 문서도 직접 열람함

각 작성자 manifest와 reviewer 추가 manifest를 합쳐 공식 소스83항목 SHA-256을 재계산했으며 불일치0·파일누락0. 항목에는 재사용 기록이 포함됨

| 글 | 재검증한 경계 | 근거 경로 |
|---|---|---|
| 관측 | PodAndContainerStatsFromCRI v1.37 Beta/default off, 기본 cAdvisor와 gate-on CRI collector 구분 | `pkg/features/kube_features.go`, `kubelet/server/server.go` |
| 관측 | /metrics/resource는 내부 Summary provider를 소비하고 eviction도 내부 provider 호출. HTTP endpoint 조회와 구분 | `metrics/collectors/resource_metrics.go`, `server/stats/summary.go`, `stats/provider.go`, `eviction_manager.go` |
| 관측 | workingSet=max(usage-inactive_file,0), cgroupv1/v2 키·rss 범위, hugepage 보정 | go.mod의 cAdvisor/lib0.60.5와 실제 vendor handler, summary.go |
| 관측 | metrics-server 두표본의 CPU평균과 last메모리, 기본15s/실제Window 구분, 경로annotation과 이력조회 한계 | metrics-server0.9.0 `client/resource/client.go`, `storage/{storage,types,pod,node}.go`, README·배포매니페스트 |
| 관측 | KSM의 spec/status/generation, Metrics API의 resource/custom/external소비 구분 | KSM2.20.0 deployment.go, HPA client.go, Metrics API 타입 |
| rollout | selector 불변, 해시충돌시 controllerUID와 template확인, 목표replica/available/종료중Pod 구분 | validation.go, sync.go, rolling.go, deployment_util.go |
| rollout | undo의 template·annotation patch, 옛RS재사용, cleanup의 완료/paused분기 | kubectl rollback.go, deployment sync.go·rolling.go |
| rollout | 진행4조건·lastUpdateTime deadline·완료후True, DS원래후보판정과필수affinity대체·자동toleration | progress.go·util, daemon controller/util |
| rollout | ControllerRevision data만 불변, RS삭제8규칙과 active·형제RS집계·로그시간·UID예외 | appsvalidation, daemonupdate, controller_utils.go, replica_set.go |
| Jobs | 기본성공과active0, index중복제외, failureaction과실패/성공순서·기존SuccessCriteriaMet우선 | job_controller.go, success_policy.go, pod_failure_policy.go |
| Jobs | failed>limit 공통/PodOnFailure restart합추가/0예외, 대체정책별삭제중실패집계·종료중Pod와최종조건 | job_controller.go·validation·defaults |
| Jobs | suspend재개startTime reset, Pod보충backoff10초/10분과kubelet구분, TTL최종condition기준 | job_controller.go·backoff_utils.go·ttlafterfinished |
| CronJob | 최신회차1개·100초과경고뒤반환·기한후보범위·다음시각+100ms재예약 | cronjob utils.go·cronjob_controllerv2.go |
| CronJob | Forbid의cached active와이미존재Job소유확인, Replace삭제요청과종료완료구분, 예정시각annotation | cronjob_controllerv2.go·utils.go |

CronJob100회와10초설명은 공식 문서와 확인한 구현의 차이를 구분해 쓴 것이며 원본의 불일치를 무시한 단정으로 옮기지 않음. backoff상한6분/10분의 과거불일치는 현행 문서와 소스가10분으로 일치함을 확인. 초기 작성 메시지의 PodAndContainerStatsFromCRI on 오독은 최종 글에서 off로 바로잡혀 있음

## SVG 실제 렌더·육안 검사

- 최종7 SVG를 reviewer가 기존 sharp로800px·375px에 각각 렌더링함: `/tmp/k8s-batch08/reviewer-render/`의14 PNG
- 14 PNG를 모두 직접 열어 육안 검사함. 글자 잘림·박스 넘침·화살표/라벨 겹침을 발견하지 못함
- 관측1장·rollout3장·Jobs3장의 의미를 본문/소스와 대조. collector/provider 경계, Deployment집합/undo재사용가능성, DS주체분리, Job중간/최종조건, 성공6/활성2가정, CronJob최근회차선택을 올바르게 표현함
- plan에 따라 한글라벨을 위반으로 세지 않음. 그림2·3의 숫자는 가정·개념도로 표시되어 있음

## 요약

- 발견 필수수정2건 모두 주 담당 수정 후 재검토. 최종 남은 필수수정0 / 확인필요0 / 권장0
- post lint error0/warn3, P2참고1건(자동문장길이경고)
- 글3개·SVG7개 검수 / 레거시제외0개
- 최종 저장본10파일 hash는 `/tmp/k8s-batch08/review-hashes.json`의 단순상대경로→SHA-256 매핑
- reviewer는 콘텐츠/공통문서 수정, commit, 전체lint, build, 정적export를 실행하지 않음. 주 담당의 통합검증을 대체하지 않음


### 지적 반영·재검토

- 기술 조건 수정 1건: Deployment history 정리를 모든 경로에서 rollout 완료 뒤로 일반화한 문장을 일반 RollingUpdate 경로로 한정했다
- `sync.go::sync`의 `d.Spec.Paused && getRollbackTo(d)==nil` 분기에서도 정리를 시도함을 고정 소스로 확인하고 추가했다
- ReplicaSet의 0replicas·최신 generation 관측 등 개별 삭제 조건은 보존했다
- 기술 조건 수정 1건 추가: Job의 Never/OnFailure 비교를 컨테이너별 재시작 정책·규칙을 지정하지 않은 기본 경로로 한정했다
- 기본 on인 ContainerRestartRules에서 일반 컨테이너 restartPolicy/restartPolicyRules가 Pod 정책을 재정의할 수 있음을 추가했다
- 제목과 Always 설명도 Pod-level 정책 범위로 명확히 했다. OnFailure 추가 backoff 검사는 실제 Pod-level OnFailure 조건 그대로 보존했다


## 실제 최종 검증

- `npm run lint:post -- <이 배치 3편>`: exit 0, error 0 / warn 3
- `npm run lint`: exit 0, error 0 / warn 1 (기존 `src/app/layout.tsx:80` custom font 경고)
- `npm run build`: exit 0, TypeScript·정적 생성·postbuild 성공, 592 pages
- 원본 SHA-256·검수 후 글/SVG와 빌드 입력 hash 일치
- slug 유일성·시리즈 order 연속성·내부 링크·이미지 실존·SVG XML/접근성 메타 검사 통과
- `getAllPosts`·`getEssaysList`·`getSearchIndex` 실제 실행: 3편 모두 essays로 등록, 목록·검색 객체에 content 없음
- HTML 3개·SVG 7개 실제 export 및 `/my-blog/diagrams/` 참조·SVG 바이트 일치
- sitemap·llms 3편 반영, RSS는 기존 최신 20편 정책과 실제 출력 일치
- `git diff --check` 통과
- prebuild의 이번 CLAUDE.md 자동 통계 변경만 복원, Vault 원본 변경 없음
- build의 Node `DEP0205 module.register()` 및 로컬 TS 직접 import의 `MODULE_TYPELESS_PACKAGE_JSON` 경고는 남아 있으며 애플리케이션 설정을 범위 밖에서 바꾸지 않았다
- 클러스터 실습·통합 테스트·성능 실측·push·배포·시리즈 카드 등록: 실행 안 함

원시 로그·임시 근거 저장본: `/tmp/k8s-batch08/`
영구 재확인 경로는 위 글과 작성 기록의 공식 소스 URL이다

## 다음 대상

- `Phase 2-9 · 노드 하트비트와 taint 축출 · 죽었다는 말은 노드가 하지 않는다.md` → `k8s-theory-node-heartbeat-taint-eviction` (`k8s-theory-node` / 10)
- `Phase 2-10 · ConfigMap 과 Secret 전달 경로 · 복사한 값은 늙는다.md` → `k8s-theory-configmap-secret-delivery` (`k8s-theory-node` / 11)
- `Phase 2-11 · CRI 와 OCI 경계 · 두 번째 계약은 API 가 아니라 파일이다.md` → `k8s-theory-cri-oci-boundary` (`k8s-theory-node` / 12)
