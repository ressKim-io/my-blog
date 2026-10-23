# Batch 21 인계 — 2026-10-24

글 3편·SVG 6장 검수 완료. 콘텐츠 커밋 `02805d1`
작성 기준일은 2026-10-24이며 학습일·배포일이 아니다. 최종 검증일은 2026-10-24다

## 원본·결과 대응

Vault 원본은 읽기 전용이며 검증 전후 SHA-256 일치를 확인했다
원본 루트: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/`

| 좌표 | 정확한 원본 파일명 | 줄 수 | SHA-256 | slug | series / order |
|---|---|---:|---|---|---|
| kernel-3 | `커널 하강 3 · mount 와 bind mount.md` | 269 | `0672f34be6ff58fe043dbb6a4c667d23ffefa878933734cfcb6b5afbddd750e0` | `k8s-theory-mount-bind-mount` | `k8s-theory-kernel` / 3 |
| kernel-4 | `커널 하강 4 · 페이지 캐시 회수와 OOM.md` | 398 | `aa70e1f532d72107c3e8da5e25dc8ac6cf47edf6925cab6a71037a9346f50b34` | `k8s-theory-page-cache-reclaim-oom` | `k8s-theory-kernel` / 4 |
| kernel-5 | `커널 하강 5 · namespace 수명.md` | 277 | `77ee2dbed7a1729ec640b8020994a767a9a565865c36d294323f2ca16868c9d7` | `k8s-theory-namespace-lifetime` | `k8s-theory-kernel` / 5 |

## 작성자의 근거 대조·편집 기록

작성 단계의 기록이며 이후 정정은 별도 검수·수정 기록을 우선한다

# Batch 21 · kernel-4 페이지 캐시·회수·OOM 인계

- 산출물: `src/content/essays/kubernetes/k8s-theory-page-cache-reclaim-oom.md` 281줄 · 같은 slug SVG 2개 · 표 4개
- 메타: essays/kubernetes · `k8s-theory-kernel` order 4 · 2026-10-24
- 소유 범위만 편집. 공통 문서·타인 글·build·commit·push 작업 없음

## 원본과 기준

- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/커널 하강 4 · 페이지 캐시 회수와 OOM.md`
- 398줄 전문 확인 · SHA256 `aa70e1f532d72107c3e8da5e25dc8ac6cf47edf6925cab6a71037a9346f50b34`
- 같은 Vault의 `☸️ progress.md`: 1122줄 · `c3081510322928d79907275e31e02c0f4708ec606644bed7581006645d1d16f5`
- `☸️ source-map · Phase 2.md`: 2189줄 · `79c08e1759c80a6efc16cde0efd1af227addd3eece6dffd3fd657af6f75c18fe`
- docs/writing-voice.md · Codex draft-to-post 진입점·연결된 공동 절차 · plan/source-format·SVG 가이드 적용
- 같은 kernel 시리즈 CPU quota 글과 `k8s-theory-eviction-oom.md`, `k8s-theory-qos-cgroups.md`의 관련 본문을 실제 대조. 모순 발견 없음, 타글 수정 없음
- Linux 기준은 앞 배치에서 kernel.org 현재 상태와 태그를 확인한 최신 LTS **v6.18.58** `2926d88bb7fc4608fd942453d929c39e4e5ec006`
- 릴리스·태그 확인 캐시: `/tmp/k8s-batch20/quota/{kernel-releases.json,kernel-releases.html,linux-tag.json,linux-tag-object.json,linux-ref.txt}`. 원본의 6.12를 최신으로 부르지 않음
- Kubernetes 기준은 v1.37.1 `f78e722310e50bcaca9276be22276d9e91d91308`, website `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`

## 실제 읽은 근거

캐시 기준은 `/tmp/k8s-batch21/memory/<repo>/<path>`. `manifest.json`에 URL·ref·SHA256·재사용 여부 기록
성공 원문 27개(기존 캐시 재사용 9개), 오류 0개이며 재사용 전과 자체 검증 때 해시 일치 확인

- [Linux LTS 고정 소스](https://github.com/gregkh/linux/tree/2926d88bb7fc4608fd942453d929c39e4e5ec006)
  - `Documentation/admin-guide/mm/concepts.rst`: page cache·anonymous·dirty·background/direct reclaim·compaction·OOM
  - `Documentation/mm/multigen_lru.rst`, `Documentation/admin-guide/mm/multigen_lru.rst`, `mm/Kconfig`: generation·aging/eviction·refault 피드백, 빌드/기본 활성/실행 중 enabled 조건
  - `Documentation/admin-guide/cgroup-v2.rst`: charge 소유권·계층·file/shmem 포함 관계·min/low/high/max·events/local·memory_localevents·hugetlb accounting·oom.group
  - `Documentation/accounting/psi.rst`: some/full·system CPU full 예외·avg10/60/300·total µs와 범위
  - `Documentation/admin-guide/mm/{hugetlbpage.rst,transhuge.rst}`: 별도 hugetlb pool·HugePages_Rsvd와 총량 차이·일반 사용 불가·THP 관리 경로
  - `mm/vmscan.c`: dirty/writeback 대기·보류·회수 주체 조건, MGLRU 분기, kswapd·memcg 회수 경로
  - `mm/page_alloc.c :: __alloc_pages_may_oom`: memcg=NULL인 전역 할당 실패 경로와 고차/재시도 등 OOM 건너뛰기 조건
  - `mm/memcontrol.c :: try_charge_memcg / __mem_cgroup_handle_over_high / mem_cgroup_out_of_memory / mem_cgroup_get_oom_group`: 한도에 걸린 cgroup에서 회수·재시도·OOM, 조상 high 영향, OOM domain 안의 group 선택
  - `mm/oom_kill.c :: oom_badness / select_bad_process / constrained_alloc / out_of_memory / oom_kill_process`: RSS·swap·페이지 테이블+보정, 후보 범위·NUMA/cpuset·예외·group 종료
- [Kubernetes 고정 소스](https://github.com/kubernetes/kubernetes/tree/f78e722310e50bcaca9276be22276d9e91d91308)
  - `go.mod`: cAdvisor/lib v0.60.5·cgroups v0.0.7·runtime-spec v1.3.0 의존성 확인
  - `pkg/features/kube_features.go`: MemoryQoS beta/on·HugepageAwareEviction beta/on·KubeletPSI GA/on/잠김
  - `pkg/kubelet/apis/config/{types.go,v1beta1/defaults.go}`: factor nil·reservation None/TieredReservation 의미
  - `pkg/kubelet/kuberuntime/kuberuntime_container_linux.go`: min/low 0 초기화·보호 조건·high 식/내림/Pod-level 생략/DRA 분기·CRI 전달·oom.group 조건
  - `pkg/kubelet/cm/helpers_linux.go`: Pod 자원 보호·ApplyPodLevelMemoryHigh와 request=limit·limit 없는 경우의 조건
  - `vendor/github.com/google/cadvisor/lib/container/libcontainer/handler.go`: inactive_file 키·working set 하한·누적 사용량에서 차감
  - `pkg/kubelet/stats/helper.go`: working set/available·PSI Summary 변환, some/full의 total·평균 필드 보존
  - `pkg/kubelet/server/stats/summary.go`: adjustForHugePages가 Node capacity의 모든 hugepage 용량을 node AvailableBytes에서 차감·0 하한
  - `pkg/kubelet/eviction/{api/types.go,helpers.go}`: memory.available 신호·관측 경로, PSI 임계값 없음
  - `pkg/kubelet/kuberuntime/kuberuntime_container.go :: toKubeContainerStatus`, `staging/src/k8s.io/cri-api/pkg/apis/runtime/v1/api.proto`: 런타임의 Reason/ExitCode 반영과 cgroup OOMKilled 규약
- [공식 website 저장본](https://github.com/kubernetes/website/tree/7fde177e22dc98390a6d55d215dd0301b5f6d0bb)
  - `content/en/docs/concepts/scheduling-eviction/node-pressure-eviction.md`, `content/en/docs/concepts/workloads/pods/disruptions.md`: node-pressure의 involuntary 분류·PDB 경계·hard 0초와 soft 유예

## 반영·정정과 문맥 검토

- 원본 6.12·v1.37 release branch 설명을 지정 LTS와 v1.37.1 고정 근거에 대조. 원본의 미실측·미확인 경계는 유지하며 LAB·학습 종료 판정·내부 연결 식별자는 본문에 유입하지 않음
- dirty/writeback을 직접 회수가 항상 즉시 저장하는 순서로 만들지 않음. MGLRU는 커널 버전만으로 활성화 단정하지 않고 옵션·runtime enabled와 구분
- 회수·compaction·memcg/global OOM·kubelet 축출에 고정 순서 없음. OOM 점수에 메모리 범위·RSS/swap/페이지 테이블·보정·보호와 설정 예외가 들어가므로 단순 종료 순위로 쓰지 않음
- charge 소유와 소비자, parent/current 포함 관계, 보호 과다와 조상 max·OOM 범위 구분. group 설정을 형제 컨테이너·Pod 전체의 무조건 종료로 확대하지 않음
- MemoryQoS gate와 별도 정책/factor·기본 0 초기화·단순 high 식과 Pod/DRA 조건을 구분. 512Mi/1Gi/0.9→972.8Mi는 원본의 가정 계산으로 유지
- working set을 비회수량·OOM 경계와 등치하지 않음. node hugepage available 보정과 memory_hugetlb_accounting 실제 charge·THP·HugePages_Rsvd를 구분, 실제 mount/통계 조합의 정합성은 미확인으로 유지
- oom과 oom_kill·exit137·runtime reason·kubelet 관측을 구분. PSI의 범위·단위·겹침과 요청 지연/eviction 신호를 분리
- 대표 문장: 원본 “working set은 사용량을 가공한 관측값이고, 할당의 성공 여부는 실제 회수 가능성과 커널의 한도에 달려 있기 때문이다” → 변환 “working set은 사용량을 가공한 관측값입니다 / 회수할 수 없는 메모리의 양이나 할당 성공을 직접 보장하는 값은 아닙니다”
- 선택지 비교 섹션 미포함: 원본은 기전·정책 경계의 이론 설명이며 실제 도입 결정·대안을 창작하지 않음

## 자체 검증·남은 한계

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-page-cache-reclaim-oom.md`: exit 0, error 0, warn 1. 100자 초과 6줄은 참고 URL 목록이며 일반 본문의 긴 문장은 분리 검토 완료
- `python3 /tmp/k8s-batch21/memory/checks.py`: 원본 hash/398줄·메타·코드 언어·이미지·로컬 링크·문단 끝 마침표·원문 27개 SHA256·SVG XML 통과. 결과 `output-checks.json`
- SVG 2개 title/desc/role 포함, 텍스트 12/11개·최소20px/560px→375px에서13.39px. sharp 800/375px 총4PNG 생성, 분기 화살표 수정 후 4개 모두 최종 육안 재확인: 한글 깨짐·잘림·겹침 없음
- 전 섹션 시각화 재검토: 독립적인 커널/축출 경로와 부모/자식 범위는 SVG, 페이지 종류·관측 필드·보호·events는 표, 가정 계산·입력/예외는 산문/언어 지정 코드로 처리
- 미확인: 실제 커널 빌드·MGLRU 활성·cgroup mount/조상 설정·CRI/runtime·collector 지원·hugetlb/THP 구성·실제 OOM/지연/카운터. 노드 메모리 고갈·실험·성능 측정 없음
- full lint·build·정적 export·별도 reviewer·진행표·commit은 parent 담당이며 본 작업에서는 실행 안 함. 핵심 근거의 차단 사유 없음


# Batch 21 · mount와 bind mount 작성 보고

## 원본·산출물

- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/커널 하강 3 · mount 와 bind mount.md`
- 정확한 파일명: `커널 하강 3 · mount 와 bind mount.md` / 269줄 전문 읽기
- 원본 SHA-256 최종 재확인: `0672f34be6ff58fe043dbb6a4c667d23ffefa878933734cfcb6b5afbddd750e0`
- 본문: `src/content/essays/kubernetes/k8s-theory-mount-bind-mount.md`
- 메타: essays/kubernetes, `k8s-theory-kernel` order 3, `2026-10-24`
- SVG: 같은 slug의 `-1.svg`, `-2.svg` / 표 3개. 공통 문서·타인 글·원본 수정 없음
- 기존 kernel order 1 글과 attach·stage·publish 글의 기준·구조·역할 연결 확인. 기존 파일 수정 없음
- 최신 progress 1122줄 `c3081510322928d79907275e31e02c0f4708ec606644bed7581006645d1d16f5`
- 최신 source-map 123줄 `36cadfdf517ab7a33708be8e867f8b4d303d762e873ddd3c31564b8c77e704ae`
- Phase 4 source-map 722줄 `f5acf98a6a57ce6f0bbc4d53b8216ef016c61f21ee790f7060f42076e94fb1d6`
- 정확한 경로·줄수·해시: `source-final.json`, 최종 산출물 해시: `content-final.json`

## 실제 근거와 버전

- 2026-10-24 [kernel.org releases.json](https://www.kernel.org/releases.json) 실제 조회: 최신 longterm 6.18.58. mainline 7.3과 구분
- Linux 태그 `v6.18.58`의 tag 객체 `b28ed6cce8167f278fbbae4c8ba25d593fcf1b63` → commit `2926d88bb7fc4608fd942453d929c39e4e5ec006`을 이전 배치의 공식 API 캐시와 실제 대조 (`linux-tag*.json`)
- 고정 Linux 문서·소스 9개 다운로드, URL/ref/SHA-256: `manifest-linux.json`
- [namespace.c 고정본](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/fs/namespace.c): `setup_mnt` 1171줄, `vfs_create_mount` 1193줄, `clone_mnt` 1262줄, `do_umount` 1891줄, `__do_loopback` 3003줄, `mount_setattr_prepare/commit` 4804/4853줄의 실제 분기 확인
- [mount.h](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/include/linux/mount.h)·[path.h](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/include/linux/path.h)·[fs.h](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/include/linux/fs.h)·[dcache.h](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/include/linux/dcache.h): mount의 root/superblock, path의 mount+dentry, file.f_path, dentry의 parent/name/inode 관계를 확인. 캐시·파일시스템 연산 구현으로 확장하지 않음
- [Shared Subtrees 고정본](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/Documentation/filesystems/sharedsubtree.rst): shared/slave/private/unbindable·복제 방향. `mount_api.rst`의 get-or-create superblock과 mount 생성 분리도 확인
- Linux man-pages는 [공식 배포 목록](https://www.kernel.org/pub/linux/docs/man-pages/)에서 현재 **6.20** 확인. [man-pages-6.20.tar.xz](https://www.kernel.org/pub/linux/docs/man-pages/man-pages-6.20.tar.xz)를 공식 sha256sums.asc와 실제 대조하고 필요한 네 원문만 읽음 (`manifest-manpages.json`)
- `mount(2)`의 비재귀/재귀 bind·unbindable 제외·기존 API의 readonly remount, `mount_setattr(2)`의 AT_RECURSIVE/MOUNT_ATTR_RDONLY, `umount(2)`의 EBUSY/MNT_DETACH·전파, `mount_namespaces(7)`의 목록 복사·shared/slave 조합을 실제 대조
- 원본 man-pages 6.19 GitHub 미러 경로는 404였으며 공식 tarball 6.20으로 대체. 문서 버전 6.20과 커널 LTS 6.18.58을 혼합하지 않음
- Kubernetes `f78e722310e50bcaca9276be22276d9e91d91308` / website `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`: `manifest-kubernetes.json` 9건, `manifest-extra.json` 1건에 URL·ref·파일별 SHA-256. 재사용한 CSI 캐시도 실제 바이트 해시 대조
- [현재 volumes 문서 고정본](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/storage/volumes.md#mount-propagation): 1142~1251줄 전파·None의 runtime 예외·볼륨 타입 권장 범위·recursiveReadOnly 조건
- [API 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/apis/core/validation/validation.go#L1450): Bidirectional의 해당 컨테이너 privileged 조건, Enabled/IfPossible의 readOnly=true 및 mountPropagation 미설정/None 검증
- [기능 gate](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/features/kube_features.go#L2038): RecursiveReadOnlyMounts GA/on/잠김 항목 실제 존재. 제거 예정 주석만으로 제거됐다고 판단하지 않음. 본문은 지원 커널·runtime과 적용 여부를 별도로 설명
- [CSI stage](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/csi_attacher.go#L294): capability 조회, 353줄 미지원 시 RPC 생략, 387줄 NodeStageVolume. [publish](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/volume/csi/csi_mounter.go#L91): Pod UID 기반 target·stage 경로 조건·301줄 NodePublishVolume
- 코어 go.mod의 실제 CSI 의존성은 `v1.12.1-0.20260720052920-cd9e7ad1ae09`이며 [해당 규격 commit](https://github.com/container-storage-interface/spec/blob/cd9e7ad1ae0915cabcad179f2b8a660c0cb6eb9f/spec.md)을 기준으로 stage/publish/정리·멱등성을 확인. 외부 v1.13.0 고정 규격도 캐시 해시 확인하되 코어 의존 버전으로 쓰지 않음
- [CSI 배포 문서 고정본](https://github.com/kubernetes-csi/docs/blob/67fe654a3246ad5c5cd212a0f4859706f9970353/book/src/deploying.md#L58): 별도 드라이버 컨테이너가 만든 mount를 호스트 kubelet이 보려는 경로의 Bidirectional 요구만 사용. 옛 allow-privileged CLI 설명을 현재 설정 근거로 옮기지 않음

## 원본 대조·정정

- mount를 목록 한 줄 추가로만 설명하지 않고 mount 객체·연결 트리·파일시스템 인스턴스를 구분. 원본의 내부/캐시 학습을 금지한 맥락은 본문에서 빼고, 할당된 기본 객체 관계만 네 행으로 설명
- 일반 mount마다 새 filesystem/superblock을 만든다거나 bind가 파일 데이터를 복사한다는 단정을 피함
- 원본의 “읽기 전용이면 remount를 한 번 더”를 **기존 mount(2) API** 조건으로 한정. mount_setattr와 재귀 속성 변경을 별도로 설명하며 CLI 명령 수·syscall 수를 고정하지 않음
- 기본 bind의 비재귀, MS_REC 재귀 bind의 unbindable 제외, 전파 속성을 재귀 변경하는 MS_REC의 다른 맥락을 구분
- readOnly와 하위 submount readonly를 구분. recursiveReadOnly의 Enabled/IfPossible, API 검증과 커널·CRI·OCI 지원 조건을 보존
- 전파는 mount별 관계이며 slave+shared 조합 가능. namespace 복사와 데이터 복사를 구분, None→rslave runtime 예외·Bidirectional 권한 주체 보존
- stage/publish는 경로·순서·멱등성 계약. 한 staging+Pod별 bind 구현의 접근 모드·집계 범위를 명시하며 `1 + Pod 수`를 보편식으로 쓰지 않음
- fd/cwd 참조·EBUSY와 lazy detach를 구분. 경로 목록에서 분리된 것을 실제 filesystem/device/CSI 외부 자원 정리 완료로 쓰지 않음
- 원본 LAB·미실행 rename·전파 실습을 경험으로 만들지 않음. 코드·명령 예시는 추가하지 않았고 mount 명령은 실행하지 않음
- 비교 결정 섹션 없음: 원본은 기술 기전 설명이며 실제 대안 선정 서사가 없음
- 전 섹션 시각화 재검토: before/after mount는 산문, 객체·전파 속성·API 값은 표, 재사용 구조와 방향 비교는 SVG 2개로 정리

대표 문장:

- 원문: “RPC는 실패·불명확한 결과에서 재시도할 수 있으므로 ‘한 번’은 syscall 호출 횟수가 아니다”
- 변환: “RPC가 실패하거나 결과가 불명확하면 같은 요청을 다시 보낼 수 있습니다 / 따라서 stage의 ‘한 번’을 mount syscall 호출 횟수와 같게 읽으면 안 됩니다”

## 실제 검증·남은 범위

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-mount-bind-mount.md`: 최종 exit 0, error 0 · warn 1 (고정 URL·메타·이미지 참조 등의 100자 초과 6곳)
- Python ElementTree: SVG 2개 XML 파싱 통과, title/desc/role/aria 연결 확인, 각 text 14개·최소 폰트 24px
- sharp 0.34.5로 800/375px 렌더: 그림1 800×842·375×395, 그림2 800×684·375×321
- 네 최종 PNG를 view_image로 실제 열어 한글·화살표 방향·조건 라벨·줄바꿈·모바일 가독성 확인, 잘림·겹침 없음
- 원본 최종 hash·269줄, 내부 링크·이미지 참조, 일본어/내부 학습 메타/단락 끝 마침표·코드블록 형식 검사 통과
- 원본·문체 대조: 격식체, 원본 조건·집계 범위·실습 미실행 유지. 성능·측정값·경험 추가 없음
- `git diff --check -- <본문> <SVG1> <SVG2>`: exit 0
- 전체 lint·build·정적 출력·독립 검수·commit: **실행 안 함**, parent의 마지막 배치 검증으로 인계
- 실제 mount·노드·컨테이너·CSI 드라이버 실험: **실행 안 함**. 특정 드라이버의 실제 mount 횟수·flag·전파 경로를 확인했다고 주장하지 않음
- 남은 차단 문제 없음. 독립 reviewer 검수와 전체 배치 검증이 남음. 다음 원본 작성하지 않음


# Batch 21 · kernel-5 인계

- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/커널 하강 5 · namespace 수명.md` · 전문 277줄 읽기
- SHA256: `77ee2dbed7a1729ec640b8020994a767a9a565865c36d294323f2ca16868c9d7` · 탈고 후 최신 원본과 sources.json 일치 확인
- 변환: `src/content/essays/kubernetes/k8s-theory-namespace-lifetime.md` · 268줄
- 등록: essays/kubernetes · `k8s-theory-kernel` order 5 · 2026-10-24
- 산출물: 본문·한글 SVG 2개·표 3개. 공통 문서·build·commit·push 실행 안 함

## 실제 대조한 근거

- Linux v6.18.58 LTS ref `2926d88bb7fc4608fd942453d929c39e4e5ec006`. 앞 배치 kernel.org 릴리스·태그 검증을 재사용하고 이번 관련 23개 파일은 직접 다운로드·핵심 구현 읽기. 현재 mainline과 LTS를 혼동하지 않음
- Task/nsproxy 공유·해제·자식 PIDns·setns: https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/include/linux/nsproxy.h · https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/kernel/nsproxy.c
- Task 종료·fork와 활성 PID: https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/kernel/exit.c · https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/kernel/fork.c
- FD·nsfs 참조: https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/fs/nsfs.c · https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/fs/proc/namespaces.c
- PID init·자식/부모·종류별 정리: https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/kernel/pid_namespace.c · https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/kernel/pid.c
- Network ref·workqueue/RCU: https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/include/net/net_namespace.h · https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/net/core/net_namespace.c
- 장치·veth 정리: https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/net/core/dev.c · https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/drivers/net/veth.c
- procfs PIDns 선택·참조: https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/fs/proc/root.c
- User/IPC/time/cgroup 참조·권한은 user_namespace.c, ipc/mqueue.c, kernel/time/namespace.c, kernel/cgroup/namespace.c·cgroup.c 관련 함수와 대조
- Linux man-pages 6.19 현행 웹 본문 직접 읽기: https://man7.org/linux/man-pages/man7/namespaces.7.html · https://man7.org/linux/man-pages/man2/setns.2.html · https://man7.org/linux/man-pages/man7/pid_namespaces.7.html · https://man7.org/linux/man-pages/man7/network_namespaces.7.html · https://man7.org/linux/man-pages/man7/cgroup_namespaces.7.html
- containerd v2.4.2 `b7a25261e029d68978bbf290df0a62fc819b3c51`의 go.mod·netns·sandbox run/stop·podsandbox stop 실제 확보. go.mod는 go1.26.6, go-cni1.1.14/CNI1.3.1/plugins1.9.1. 노드 설치 버전을 확인한 것은 아님
- netns bind mount/Remove: https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/pkg/netns/netns_linux.go
- CNI·namespace 정리 경계: https://github.com/containerd/containerd/blob/b7a25261e029d68978bbf290df0a62fc819b3c51/internal/cri/server/sandbox_stop.go
- CNI library1.3.1 ref `3f51e8803ebbdba0ebeed735b42137e4c7302403`의 SPEC.md는 규격1.1.0. 모듈·규격 번호 구분: https://github.com/containernetworking/cni/blob/3f51e8803ebbdba0ebeed735b42137e4c7302403/SPEC.md
- OTel 현행 문서 semconv1.44.0의 k8s.pod.uid/container.id 의미 직접 확인: https://opentelemetry.io/docs/specs/semconv/resource/k8s/ · https://opentelemetry.io/docs/specs/semconv/resource/container/ . 개별 속성의 stable 상태를 전체 entity 안정성과 혼동하지 않고 본문에서는 식별 범위만 설명
- 전체 29개 파일 URL/ref/SHA256은 `manifest.json`. K8s1.37.1 f78e722의 PidNamespaceForPod는 Batch12 캐시 실제 읽기와 SHA c64e271d6ab5c663e5dd6ae5cbd81045042be01b1c709d89e26809bf77686029 일치 확인, `reused-kubelet-util.json`에 보존

## 정정·중요 조건

- 최신 progress의 커널5 추가 이력, source-map Phase3의 sandbox·namespace 모드, plan/source-format을 읽음. 같은 series cgroup quota 글과 기존 sandbox/pause·CRI/OCI·임시컨테이너 PID 대상을 대조. 기존 글 수정 제안 없음
- namespace 종류별 참조와 task→nsproxy를 구분. nsproxy 공유로 참조 수와 프로세스 수가 같지 않음. 활성 PIDns는 task_active_pid_ns, nsproxy의 pid_ns_for_children은 향후 자식, userns는 credentials로 연결. 종료의 put_nsproxy/free_nsproxy가 모든 namespace의 즉시 해제는 아님
- 열린 namespace FD·그 파일의 bind mount 외에 PID/user 부모·non-user namespace 소유userns·for_children·procfs/mqueue 참조 보존. 일반 앱 디렉터리 bind mount를 namespace pin으로 세지 않음. 표가 모든 참조를 열거한 것은 아님
- FD 보유와 setns 권한을 구분. Network는 호출자·소유userns 양쪽 CAP_SYS_ADMIN, userns는 멀티스레드/CLONE_FS/재진입 조건, PID는 활성/자손 계층과 향후 자식 선택. 실제 조작하지 않음
- Netns 마지막 수명 참조 뒤 __put_net→workqueue cleanup_net, pernet 종료·RCU·별도 메모리 수명. 장치 반환/삭제는 이 정리 경로 전제이며 pause 종료 즉시 아님. 이동 가능 장치의 init_net 반환과 veth 양 끝 제거를 구분
- containerd NetNS는 mount 경로를 보관함. 영구 열린 FD라고 쓰지 않음. 일반 Stop 경로의 컨테이너/sandbox 중지·CNI 제거·netns mount 제거와, namespace 부재 시 빈 경로, CNIResult nil일 때 teardown 오류 경고 후 진행하는 예외를 보존. MNT_DETACH·경로 제거가 다른 참조 소멸 증거 아님
- CNI DEL의 namespace 부재·반복 요청 수용·이미 없는 변경 성공·IPAM 예외 보존. 계약과 특정 조합의 실제 성공을 구분. CNI_CONTAINERID는 네트워크 격리 단위이고 앱 OTel container.id와 같은 값 보장 없음
- PID1 종료는 새 할당 차단·나머지에 SIGKILL. 미리 열린 FD 등으로 객체가 남아도 새 생성 차단의 ENOMEM은 단순 메모리 부족과 다름. PID 자체 객체 파괴도 workqueue/RCU. 모든 namespace에 PID init 규칙을 일반화하지 않음
- 원본 procfs 설명 보완: 기본 생성은 호출자의 active PIDns를 선택하지만 Linux6.18.58에는 권한·자손 검사를 거친 pidns= 선택이 있음. ‘mount한 프로세스 관점’으로 항상 고정하지 않고 해당 procfs의 참조 대상이라고 설명
- cgroup 경로는 읽는 쪽 root에 상대적이며 /여도 호스트 최상위·조상제약 부재 증거 아님. device/inode·PID·IP는 재생성/재부팅을 넘는 영구 신원 아님. 범위·시각·runtime 매핑과 telemetry cardinality 경계 보존
- API finalizer·runtime 상태·CNI/IPAM·kernel ref는 서로 다른 완료 근거. 책임 표는 실행 순서가 아니며 참조 존재를 누수·실행 가능·정리 완료로 대체하지 않음

## 검증·문체·한계

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-namespace-lifetime.md`: exit0, error0/warn1(긴 줄8곳: 메타·alt·출처 중심)
- SVG2개 XML 파싱 통과. sharp800/375px PNG4장 생성 후 모두 실제 육안 확인: 한글 정상·겹침/잘림 없음. 최소21px/viewBox600→375px에서13.125px
- `git diff --check -- <소유 본문·SVG>` exit0. 원본 hash 최신 일치. 끝 마침표/학습메타 없음. 격식체·원본 의미·과장·근거·반복 문맥 검토와 섹션별 시각화 재검토 완료
- 원문→대표 문장: “namespace가 남아 있다는 사실은 참조가 있다는 증거이지, 그 안에서 계속 작업할 수 있다는 보장이 아니다” → “객체가 있다는 사실과 그 안에 자원이 있다는 사실, 정상 프로세스가 그 자원을 계속 사용할 수 있다는 사실도 다릅니다”
- Decision 섹션 미포함: 개념 해설이며 원본 밖 선택 서사·실습·경험·측정·수치 창작 없음
- 핵심 미확인/보류 없음. 실제 노드의 참조·runtime 정리·IPAM 반환·관측 매핑·시간은 실행하지 않아 확인 결과로 주장하지 않음. 전체 lint/build/정적 출력·독립 검수·기록·커밋은 parent 단계


## 별도 blog-reviewer 검수

# Review: Batch 21 — 3 posts / 6 SVG

검수일: 2026-10-24 KST · 최종 저자 인계와 root 수정 후 저장본 기준

## P0 필수 수정

- 미해결 0건 / 발견 1건, 수정 후 재검토 통과
- `src/content/essays/kubernetes/k8s-theory-page-cache-reclaim-oom.md:244` — 원문 “hard threshold의 종료 유예는 0초” → 공식 문서의 0초 설명을 구현의 실제 종료 시간으로 읽을 수 있으며, 고정 `eviction_manager.go:62,431`은 hard override에 `1`을 사용 → 공식 문서 설명으로 한정하고 override·실제 종료 시간·soft 발동 전 대기와 Pod 선택 후 종료 유예를 구분하도록 제안
- root가 해당 두 문장과 기존 Eviction 글의 시간 설명 링크를 반영했으며 최종 문맥을 재검토함 (`fixes.md`)
- 근거: [고정 eviction_manager.go](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/eviction/eviction_manager.go#L60), 실제 대조 캐시 `reviewer-extra/eviction_manager.go`

## P1 권장·확인 필요

- 미해결 권장 0건 / 확인 필요 0건
- 원본 없는 실습·측정·경험 서술, 보편화된 성능 수치, 문체·용어 자립성·그림 의미의 추가 수정 사항 없음

## 원본·핵심 기술 대조

- Vault 원본 269 / 398 / 277줄을 전문 대조했고 `sources.json`의 최신 SHA-256과 실제 원본이 모두 일치함
- 최신 README·plan의 kernel 3/4/5, `k8s-theory-kernel` order 3/4/5, 작성일 2026-10-24와 일치함. source-map은 README가 가리키는 Vault의 실제 `source-map.md`를 대조함
- Mount: VFS 객체·경로와 bind 대상, 비재귀/재귀 복제와 이후 propagation 구분, shared+slave, Kubernetes rprivate/rslave 경로·privileged·recursive read-only 조건, CSI capability·stage/publish/역순 정리, lazy unmount와 잔존 참조를 확인함
- Memory: reclaim·writeback·compaction/OOM의 조건, MGLRU build/runtime 설정, cgroup 소유·계층·min/low/high/max, MemoryQoS gate와 실제 설정 적용 조건, working set·HugeTLB/THP, memcg/global OOM·사건 지표·PSI와 eviction 경계를 확인함
- Namespace: nsproxy 공유와 active PID/user namespace 예외, FD/nsfs/procfs 등 참조, `pidns=` 권한·대상, PID 1 종료 후 새 fork 제한, workqueue/RCU 정리, veth와 물리 장치, containerd/CNI/IPAM 정리의 조건과 역할을 확인함
- 기준은 Linux LTS 6.18.58 `2926d88b…`, Kubernetes 1.37.1 `f78e7223…`, containerd 2.4.2 `b7a25261…`이며 원본의 과거 버전과 구분함. mount의 man-pages 6.20 원문과 namespace의 man7 6.19 웹 인터페이스 설명도 구분함
- [Linux 고정 mount 구현](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/fs/namespace.c), [cgroup v2](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/Documentation/admin-guide/cgroup-v2.rst), [OOM 구현](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/mm/oom_kill.c), [procfs 구현](https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/fs/proc/root.c)
- [Namespace lifetime](https://man7.org/linux/man-pages/man7/namespaces.7.html), [setns 제약](https://man7.org/linux/man-pages/man2/setns.2.html), [CNI DEL 규약](https://github.com/containernetworking/cni/blob/3f51e8803ebbdba0ebeed735b42137e4c7302403/SPEC.md#del-remove-container-from-network-or-un-apply-modifications), [OpenTelemetry container 신원](https://opentelemetry.io/docs/specs/semconv/resource/container/)
- 세 저자 캐시·추가 검수·재사용 helper 총 81개 근거 manifest 행의 실제 SHA-256 대조 통과. man-pages 6.20 archive와 공식 SHA256SUMS의 해시도 일치함 (`reviewer-evidence-checks.json`)

## P2 검증 참고

- 최초 및 최종 `npm run lint:post -- <세 글>` 실제 실행: error 0 / warn 3, 종료 0 (`reviewer-lint-final.log`)
- 경고는 100자 초과 줄 각각 6 / 6 / 8곳. 링크·코드·조건 설명 문맥을 확인했고 길이만 맞추기 위한 추가 분리는 요구하지 않음
- `git diff --check -- <본문 3개와 SVG 6개>` 종료 0
- category·series·order·date, slug 중복, 시리즈 트랙, 본문 로컬 글 링크 6개 통과 (`reviewer-metadata-checks.json`)
- SVG 6개의 XML·접근성 메타 확인. 검수자가 sharp로 800/375px PNG 총 12개를 별도 렌더하고 모두 직접 열어 확인함
- 실제 렌더에서 글자 잘림·겹침·화살표 의미 충돌·모바일 가독성 문제 없음. 최종 SVG SHA와 검수 렌더 입력 SHA 모두 일치함 (`reviewer-render/inputs.json`)
- 검수자는 콘텐츠·SVG·공통 문서를 수정하지 않음. 통합 lint·build·정적 출력 검증·commit은 검수 역할에서 실행 안 함; root의 후속 통합 검증 대상임

## 요약

- 필수 발견 1건 수정 완료 / 미해결 필수 0건 · 확인 필요 0건 · 권장 0건
- 검토 파일: 본문 3개 + SVG 6개. 보류 없음
- 최종 `review-hashes.json`: 상대 경로 → SHA-256 평면 매핑 9개, 수정 후 저장본 기준


### 지적 반영·재검토

# Batch 21 검수 지적 반영

## 필수 1 · hard eviction의 문서·구현·실제 종료 시간 구분

- 지적 원문: `hard threshold의 종료 유예는 0초이고 soft threshold는 kubelet의 축출 유예 설정을 따릅니다`
- 이유: 공식 문서의 0s를 현행 소스의 정확한 종료 시간으로 단정했으며 기존 Eviction/OOM 글과 충돌
- root가 실제 대조: f78e7223 `pkg/kubelet/eviction/eviction_manager.go`의 `immediateEvictionGracePeriodSeconds = 1`(60~62줄), synchronize의 hard override와 soft max/Pod 유예 분기(429~438줄), 기존 `k8s-theory-eviction-oom.md`의 발동 대기/종료 override/런타임 처리 설명(127~154줄)
- 수정: 공식 문서의 0초 설명과 소스 override·실제 시간을 구분하고 soft의 발동 전 대기와 Pod 선택 후 종료 유예를 분리. 상세 시간·상태·정책은 기존 글로 연결
- 근거: https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/kubelet/eviction/eviction_manager.go
- 다른 본문·SVG와 기존 글은 수정하지 않음. 별도 reviewer 재검토 후 최종 결과 우선


## 실제 최종 검증

- `npm run lint:post -- <대상 3편>`: exit 0, error 0 / warn 3
- `npm run lint`: exit 0, error 0 / warn 1 (기존 `src/app/layout.tsx:80` custom font 경고)
- `npm run build`: exit 0, TypeScript·정적 생성·postbuild 성공, 670 pages
- 원본 SHA-256·검수한 최종 글/SVG와 빌드 입력 hash 일치
- slug 유일성·시리즈 order 연속성·내부 링크·이미지 실존·SVG XML/접근성 메타 검사 통과
- 실제 `getAllPosts`·`getEssaysList`·`getSearchIndex` 실행: 3편 모두 essays 등록, 목록·검색에 content 없음
- HTML 3개·SVG 6개 export·`/my-blog/diagrams/` 참조·SVG 바이트 일치
- sitemap·llms 반영, RSS는 최신 20편 정책·실제 출력 일치
- `git diff --check` 통과, prebuild의 이번 CLAUDE.md 자동 통계 변경만 복원
- Node `DEP0205 module.register()`·TS 직접 import의 `MODULE_TYPELESS_PACKAGE_JSON` 경고는 범위 밖 설정을 바꾸지 않고 유지
- 새 의존성·클러스터 실습·통합 실험·성능 실측·push·배포·시리즈 카드 등록: 실행 안 함

원시 로그·근거 캐시: `/tmp/k8s-batch21/`
공식 URL/ref와 주요 정정은 위 기록과 글에 보존했다

## 다음 대상

- 현재 요청의 마지막 배치다. 원본 목록과 전체 산출물을 최종 점검해 남은 글 여부를 기록한다
