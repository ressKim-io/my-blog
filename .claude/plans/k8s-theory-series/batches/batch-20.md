# Batch 20 인계 — 2026-10-24

글 3편·SVG 5장 검수 완료. 콘텐츠 커밋 `9e22fbf`
작성 기준일은 2026-10-24이며 학습일·배포일이 아니다. 최종 검증일은 2026-10-24다

## 원본·결과 대응

Vault 원본은 읽기 전용이며 검증 전후 SHA-256 일치를 확인했다
원본 루트: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/`

| 좌표 | 정확한 원본 파일명 | 줄 수 | SHA-256 | slug | series / order |
|---|---|---:|---|---|---|
| 5-6 | `Phase 5-6 · 통합 · 한 칸 올라갈 때마다 죽을 수 있는 것이 하나 는다.md` | 461 | `b246924b8e681fe04439ca11b956759597e40b93e925fd356a1524adc44f0b8d` | `k8s-theory-extension-failure-boundaries` | `k8s-theory-extension` / 6 |
| kernel-1 | `커널 하강 1 · cgroup v2 인터페이스와 CFS quota.md` | 439 | `9ed4b6bd36e3ad4417120894dd3ee727566d3ffdc041ecaebc63bd64208ab99c` | `k8s-theory-cgroup-v2-cpu-quota` | `k8s-theory-kernel` / 1 |
| kernel-2 | `커널 하강 2 · netfilter hook 과 conntrack.md` | 302 | `8b830f68c253046190be707d0ae15ce5455547062a996fd433a9b1914627c38f` | `k8s-theory-netfilter-conntrack` | `k8s-theory-kernel` / 2 |

## 작성자의 근거 대조·편집 기록

작성 단계의 기록이며 이후 정정은 별도 검수·수정 기록을 우선한다

# Batch 20 · 확장 실패 경계 작성 보고

## 산출물과 원본

- 본문: `src/content/essays/kubernetes/k8s-theory-extension-failure-boundaries.md` (267줄)
- SVG: `public/diagrams/k8s-theory-extension-failure-boundaries-1.svg` (1개, 새로 시각화한 접수·비동기 조정 경계)
- 시리즈: `k8s-theory-extension` / 6 / `2026-10-24`
- 원본 정확한 파일명: `Phase 5-6 · 통합 · 한 칸 올라갈 때마다 죽을 수 있는 것이 하나 는다.md`
- 원본 경로: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/Phase 5-6 · 통합 · 한 칸 올라갈 때마다 죽을 수 있는 것이 하나 는다.md`
- 원본 461줄 전문 확인, 최종 SHA-256 재확인: `b246924b8e681fe04439ca11b956759597e40b93e925fd356a1524adc44f0b8d`
- 원본·최신 progress/source-map의 정확한 경로·줄수·해시: `source-final.json`
- progress: 1122줄 / `c3081510322928d79907275e31e02c0f4708ec606644bed7581006645d1d16f5`
- source-map: 123줄 / `36cadfdf517ab7a33708be8e867f8b4d303d762e873ddd3c31564b8c77e704ae`
- Phase 5 source-map: 676줄 / `dc4920b72a458ab4d0b9276840624454fad65060c2803ce6de7306f8ad646e5e`
- 기존 확장 글 1~5의 CR 저장·가지치기, 변환·저장 버전, controller-runtime, 정책·필드 관리, aggregation·Namespace 정리 연결 확인
- 본문·SVG 최종 SHA-256: `content-final.json`

## 실제 근거와 버전

- Kubernetes v1.37.1: 태그 객체 `d2b770f4c94636a992534a8d3156b6b2d8e82ac3`가 가리키는 커밋 `f78e722310e50bcaca9276be22276d9e91d91308`을 `kubernetes-tag.json`으로 재확인
- website 고정 커밋: `7fde177e22dc98390a6d55d215dd0301b5f6d0bb`
- 기존 공식 캐시 23건을 실제 바이트의 SHA-256·고정 ref와 대조해 재사용: `manifest.json`
- 새로 읽은 공식 고정 문서와 CNCF 백서 원문 3건: `manifest-new.json`
- controller-runtime 공식 latest API를 2026-10-24 실제 조회: v0.25.2 (`controller-runtime-release.json`), 고정 커밋 `5d8467b3065818a3b382d8f6941147a801fd1969`
- 해당 go.mod: Go 1.26.0, k8s.io/client-go v0.37.0. 코어 v1.37.1과 라이브러리 버전을 구분하며 코어 패치 버전과 같다고 설명하지 않음
- 라이브러리·Condition·API 관례 캐시 6건의 해시 재검증: `manifest-library.json` (community `e8963b1070ee8bd9edfc7bf965ca7b0eaf991f0b`)
- 정상 webhook 거절과 호출 오류 분기 추가 대조: `manifest-final-extra.json`

핵심 고정 URL과 실제 대조 위치:

1. [확장 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/extend-kubernetes/_index.md): 설정·추가 프로그램의 경계, 적합한 내장 정책 API 우선. [NetworkPolicy 문서](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/concepts/services-networking/network-policies.md): 집행 가능한 네트워크 구현의 전제
2. [CEL 공통 플러그인](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/policy/generic/plugin.go#L302): Dispatch 302~351줄, 네 설정 자원의 API 기반 정책 제외와 staticSource 예외. [설정 오류 처리](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/policy/generic/policy_dispatcher.go#L213): Fail 오류의 직접 거절 213~252줄, 파라미터 미발견 401줄. [VAP dispatcher](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/policy/validating/dispatcher.go#L231): 평가 후 validationActions 분기
3. [외부 validating webhook](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/admission/plugin/webhook/validating/dispatcher.go#L164): Ignore는 ErrCallingWebhook 처리와 연결되며 정상 ErrWebhookRejection을 취소하지 않음
4. [변환 webhook](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apiserver/conversion/webhook_converter.go#L122): 122~142줄 대상 버전 비교, 251~272줄 변환 대상 0개 시 호출 생략, 408줄 이후 metadata 복원. [CR 처리기](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apiserver/customresource_handler.go#L1272): 저장소 디코더·변환기에 스키마 처리 연결. [storedVersions 검증](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/validation/validation.go#L263): 목록·현재 storage·spec.versions의 일관성 검증
5. [Namespace 삭제](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/controller/namespace/deletion/namespaced_resources_deleter.go#L134): deleteAllContent 오류 시 finalize 미진입, 501~602줄 discovery 오류 수집·가능한 삭제·condition·오류 반환. Pod 잔존 시 다른 자원을 미루는 조건 보존
6. [CREATE handler](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apiserver/pkg/endpoints/handlers/create.go#L198): field manager 계산 후 mutating admission. 기존 소유권·atomic 경계·이후 별도 쓰기를 전부 소유자 없음으로 일반화하지 않음
7. [controller-runtime 재시도](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/internal/controller/controller.go#L479): 일반 오류·TerminalError·RequeueAfter 구분. [finalizer 헬퍼](https://github.com/kubernetes-sigs/controller-runtime/blob/5d8467b3065818a3b382d8f6941147a801fd1969/pkg/finalizer/finalizer.go#L58): 정리 실패 시 키 보존, 성공 시 메모리 객체에서 제거, 호출자가 API 저장
8. [원격 API 프록시](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/kube-aggregator/pkg/apiserver/handler_proxy.go#L107), [공식 aggregation 구성](https://github.com/kubernetes/website/blob/7fde177e22dc98390a6d55d215dd0301b5f6d0bb/content/en/docs/tasks/extend-kubernetes/configure-aggregation-layer.md): 로컬 위임과 원격 서버 구분, 등록·연결·신뢰·인가 분리
9. [Condition 타입](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/apis/meta/v1/types.go#L1642), [표준 헬퍼](https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/staging/src/k8s.io/apimachinery/pkg/api/meta/conditions.go#L25): 다섯 필수 필드·선택 observedGeneration, status 변화에 따른 전이 시각 갱신은 헬퍼의 규칙
10. [CNCF 플랫폼 백서](https://tag-app-delivery.cncf.io/whitepapers/platforms/): 현재 원문 실제 열람·HTML 저장. 복잡도 은닉과 사용자의 구성·관측 능력을 함께 설명하며 관리형 구현 위 최소 계층 권고를 연결. 긴 직접 인용 없음

## 원본 대조·정정과 구성 판단

- 원본은 v1.35 당시 근거와 v1.37 보완이 혼재하므로 본문은 확인한 v1.37.1과 현재 라이브러리 기준으로 정리. 확인하지 않은 과거 소스를 근거로 새로 바뀌었다고 쓰지 않음
- 원본의 여섯 선택지는 공식 등급·상위 호환·정확한 실패 증가 법칙이 아님을 보존. 원래 비교 그림은 표로 평탄화하고, 접수와 준비 사이의 시각적 구분만 새 SVG로 작성
- 내장 API도 실제 집행 구성요소의 기존 위험이 있음을 표에 보존. Helm·Kustomize는 렌더링과 지속 집행을 구분
- 요구 넷을 가정으로 명시. 네트워크 패킷과 admission 요청, 이미지 문자열과 서명, 요청 오브젝트 변경과 별도 객체 생성, 큐 요청 저장과 외부 준비를 구분
- MAP은 현재 GA·기본 활성·v1이며 플러그인·API 제공을 별도 확인. CEL은 정해진 입력을 제공하므로 임의 GET/LIST·외부 조회가 자유롭다는 설명을 피함
- VAP의 false·평가 오류·파라미터 부재 설정 오류를 구분. Warn·Audit만으로 비차단을 보장하지 않음
- API 기반 CEL 자기 설정 제외와 manifest 기반 정적 정책의 예외 보존. 엔진 CRD·RBAC·다른 admission까지 포괄하는 복구 보장으로 확대하지 않음
- conversion 호출 여부는 입력/목표 버전과 실제 경로에 따름. served가 하나인 것과 저장본이 하나의 버전인 것은 다름. DELETE도 기존 객체 읽기의 변환 실패 가능성으로 설명
- Namespace discovery 부분 실패 시 가능한 삭제와 완료 보류를 구분. Terminating만으로 확장 서버 사망을 단정하지 않음
- pruning의 보존 예외·읽기/재저장 차이, metadata의 labels/annotations 제한과 spec/status 변환의 구분, storedVersions와 실제 저장본 이행의 분리를 보존
- 정책 삭제는 과거 변경 값의 자동 역변환이 아니며 APIService 삭제도 백엔드 데이터 삭제가 아님
- Condition 제약은 실제 CRD 스키마에 따르며 status는 모든 API의 필수 구조로 일반화하지 않음
- 선택 비교 포함: 원본의 실제 여섯 수단과 선택 이유만 사용. 표 3개, SVG 1개. 섹션별 시각화 필요성을 다시 검토했으며 나머지는 조건 설명·표가 적합
- 원본 LAB·학습 종료 판정·내부 Phase·편집 경위는 본문에서 제외. 미실행 경험이나 측정값을 추가하지 않음

대표 문장:

- 원문: “컨트롤러가 멈춘다 … 조정이 안 돈다. 오브젝트는 남고 세상만 안 따라온다”
- 변환: “controller가 멈추면 CR은 남아 있어도 외부 큐와 Secret이 원하는 상태를 따라오지 못할 수 있습니다”
- 단순 프로세스 중단의 단정을 줄이고 RBAC·감시·외부 오류·status 정체를 별도 확인하도록 연결

## 실제 실행한 검증과 남은 범위

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-extension-failure-boundaries.md`: 최종 exit 0, error 0 · warn 1 (고정 URL·front matter·이미지 참조 등을 포함한 100자 초과 10줄)
- Python ElementTree XML 파싱: 통과. title·desc·role·aria 연결 있음, text 14개, 최소 폰트 24px, semantic 3색, 화살표 경로 각각 분리
- `node -p "require('sharp/package.json').version"`: 설치 0.34.5, pnpm-lock.yaml 고정 0.34.5 확인
- sharp 800px·375px 렌더: 각각 800×1168, 375×548 PNG 생성 (`diagram-1-800.png`, `diagram-1-375.png`)
- 두 최종 PNG를 `view_image`로 실제 열람: 한글 표시·줄바꿈·연결·화살표·모바일 라벨 확인, 잘림/겹침 없음
- 원본 최종 SHA·461줄 재확인, 일본어·내부 학습 메타·단락 끝 마침표·언어 없는 코드블록·로컬 내부 링크·이미지 참조 검사 통과
- 원본 대비 문체·근거·과장·반복 문맥 검토: 격식체, 원본 가정과 조건 보존, 경험·실측 창작 없음
- `git diff --check -- <본문> <SVG>`: exit 0. 새 파일의 XML·참조·본문 형식은 별도 검사
- 전체 lint·build·정적 출력 검증·독립 검수·커밋: 이 작성 에이전트에서는 **실행 안 함**, parent 배치 단계로 인계
- 클러스터·외부 SaaS 장애와 복구 실험: **실행 안 함**. 본문은 공식 소스의 조건별 기전이며 실제 장애 재현 보고가 아님
- 특정 정책 엔진 제품의 생성·삭제 기본값은 이번 통합 글에서 추가 일반화하지 않음. 기존 정책 글로 연결하고 제품별 확인 경계 유지
- 독립 검수 중 전달된 89줄 어순 권장 1건을 반영하고 lint를 재실행: error 0 · warn 1
- 남은 차단 문제 없음. 독립 reviewer의 원본·기술·문체·이미지 검수와 배치 통합 검증이 남음


# Batch 20 · kernel-2 인계

- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/커널 하강 2 · netfilter hook 과 conntrack.md` · 전문 302줄 읽기 및 탈고 후 최신본 재확인
- SHA256: `8b830f68c253046190be707d0ae15ce5455547062a996fd433a9b1914627c38f` · sources.json과 일치
- 변환: `src/content/essays/kubernetes/k8s-theory-netfilter-conntrack.md` · 269줄
- 등록: essays/kubernetes · `k8s-theory-kernel` order 2 · 2026-10-24
- 산출물: 본문·SVG 2개·표 3개. 공통 문서·build·commit·push는 실행 안 함

## 기준·실제 근거

- kernel.org 현행 페이지와 releases.json 직접 조회: mainline 7.3, 최신 longterm 6.18.58(2026-10-21). 원본 Linux6.12를 최신이라고 쓰지 않음. writer_b와 이번 두 커널 글 기준을 최신 LTS6.18.58로 합의
- 릴리스: https://www.kernel.org/ · https://www.kernel.org/releases.json
- LTS 고정 ref `2926d88bb7fc4608fd942453d929c39e4e5ec006`. writer_b가 확보한 annotated tag/object JSON도 읽어 v6.18.58→commit 대응 확인, 이 폴더의 `lts-linux-tag.json`, `lts-linux-tag-object.json`, `lts-linux-ref.txt`에 보존
- Linux 관련 16개 파일을 해당 ref로 직접 확보. URL/ref/SHA256은 `manifest-linux.json`. nf_nat_core/proto, nf_conntrack_core/proto/tcp/udp, hook core·상수·tuple, IP 수신/송신과 고정 sysctl/flowtable 문서의 관련 구현을 실제 읽고 대조
- Hook·priority: https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/include/uapi/linux/netfilter_ipv4.h · https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/net/netfilter/core.c
- NAT hook·OUTPUT 재라우팅: https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/net/netfilter/nf_nat_proto.c
- 최초 바인딩·후속 재사용·역방향: https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/net/netfilter/nf_nat_core.c
- 양방향 키·NEW/ESTABLISHED·netns/zone·초기화·할당 실패: https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/net/netfilter/nf_conntrack_core.c
- TCP/UDP: https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/net/netfilter/nf_conntrack_proto_tcp.c · https://github.com/gregkh/linux/blob/2926d88bb7fc4608fd942453d929c39e4e5ec006/net/netfilter/nf_conntrack_proto_udp.c
- sysctl·flowtable: https://github.com/gregkh/linux/tree/2926d88bb7fc4608fd942453d929c39e4e5ec006/Documentation/networking
- 공식 Netfilter 위키 두 페이지 이번에는 웹 본문 직접 읽기 성공: https://wiki.nftables.org/wiki-nftables/index.php/Netfilter_hooks · https://wiki.nftables.org/wiki-nftables/index.php/Performing_Network_Address_Translation_(NAT)
- Kubernetes1.37.1 ref `f78e722310e50bcaca9276be22276d9e91d91308`의 iptables/proxier.go, conntrack/sysctls.go·cleanup.go, config/v1alpha1/defaults.go 실제 확보·읽기. `manifest.json`의 성공 4개가 해당 파일. 같은 파일의 mainline Linux16개 429 기록은 미사용 이력이며 LTS16개 확보로 해결
- kube-proxy 경로: https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/iptables/proxier.go
- 용량·timeout 적용: https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/conntrack/sysctls.go
- 기본값: https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/apis/config/v1alpha1/defaults.go
- UDP 정리: https://github.com/kubernetes/kubernetes/blob/f78e722310e50bcaca9276be22276d9e91d91308/pkg/proxy/conntrack/cleanup.go

## 정정·중요 조건

- 최신 progress/source-map Phase3의 기존 판정·v1.35/1.37 및 별도6.12 이력을 읽고 원본과 대조. 새 kernel 시리즈의 기존 글은 아직 없어서 같은 theory의 Service/kube-proxy 글을 구조·연결 참고로 읽음
- 다섯 주요 IP hook을 전 패킷 공통 순서나 전체 hook 목록으로 쓰지 않음. 로컬 수신/전달/로컬 생성 분리, INPUT→OUTPUT 직결 아님. 수신 PREROUTING 뒤 라우팅·OUTPUT DNAT 뒤 조건부 재라우팅 보존
- Hook/table/chain 구분, IPv4 수치 priority는 낮은 값부터 실행. conntrack -200이 DNAT -100보다 앞섬. 각 hook에 모든 표 행이 등록되는 것은 아니며 ACCEPT는 뒤 hook 면제 아님
- DNAT은 PREROUTING/OUTPUT, 일반 커널 SNAT은 POSTROUTING/INPUT 등록. kube-proxy masquerade POSTROUTING과 일반 SNAT 범위 구분
- iptables 일반 ClusterIP에서 KUBE-SERVICES→KUBE-SVC→KUBE-SEP의 마지막 DNAT 규칙. nat PREROUTING/OUTPUT 두 진입점, nat POSTROUTING의 표시된 패킷 masquerade. filter NEW 조건은 일부 점프만 해당
- 원본 주소표는 실측이 아닌 추가 SNAT 없는 가정 예시. 한 연결 객체의 original/reply 두 키, NAT에 따른 reply 수정·응답 역변환. netns/zone 일치·공유 해시 저장소를 독립 Pod 메모리 보장으로 과장하지 않음
- NEW는 표에 없는 첫 패킷과 동의어가 아님. 응답을 못 본 기존 original 패킷도 NEW. NAT 초기화 조건과 구분. 후속 패킷은 유지 중 바인딩 선택을 재사용하되 filter/conntrack/주소변환 생략 아님
- v6.18.58에도 자동 max=buckets, 명시 hashsize 초기 max=8×buckets. 문서 요약식과 소스 sizeof·메모리 구간 차이 보존. max/4 버킷·최대 연결 시 평균 등록8은 가정 계산이며 실측·고정 탐색 횟수 아님
- 현행 kube-proxy 설정 이동 반영: sysctls.go. online CPU·fallback, scaled>1048576 cap을 Min 비교보다 먼저 반환, 나머지는 scaled/Min 큰 값, MaxPerCore0 생략. hashsize는 max/4보다 작을 때만 증가, 쓰기 오류 반환
- Linux TCP established5일/TIME_WAIT120초, UDP30/120초와 kube-proxy TCP24h 구분. UDP stream은 응답 관찰·초기2초 이후 활동 등 조건, 패킷 갱신이 있어 고정 수명 아님. timeout 양수 설정 시만 쓰기
- 표 포화 시 새 할당 전 회수 시도·실패 drop, 초기 netns 로그/다른 netns 번호 포함 로그 구분. 기존 기록 경로가 새 할당을 피하더라도 회수·부하 영향이 없어지는 것은 아님
- 원본의 ‘serving endpoint가 없으면 정리 전체 건너뜀’을 현재 소스로 정정: Service IP·Port 정리는 빈 집합도 포함, NodePort 정리만 endpoints.Len()>0 조건. traffic policy/topology/terminating 변경만으로 아직 serving인 흐름을 제거하지 않음. 기존 Service 글이 이미 정확히 구분해 추가 수정 제안 없음
- nftables 기반 공유를 같은 iptables 체인으로 일반화하지 않음. notrack/eBPF/flowtable 우회와 일반 stateful IP 경로 구분, flowtable은 명시 설정·적중 조건이고 모든 nftables 구성 자동 기능 아님

## 검증·문체·한계

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-netfilter-conntrack.md`: exit0, error0/warn2. 긴 줄 경고(메타·alt·출처 중심)와 SVG1 text28개 경고. 실제375px 가독성·겹침을 육안 확인
- SVG2개 XML 파싱 통과. sharp800/375px PNG4장 생성 후 모두 실제 확인: 한글 정상·겹침/잘림 없음. 초기 라우팅 라벨 뒤 배경 처리로 선과 글자 겹침 제거 후 재렌더. 최소21px/viewBox600→375px에서13.125px
- `git diff --check -- <소유 본문·SVG>` exit0. 원본 hash 최신 일치. 격식체·끝 마침표·코드언어·내부 학습메타·근거·반복 문맥 검토 완료
- 섹션별 시각화 재검토: 세 IP 경로·두 NAT 진입 흐름은 SVG, priority/tuple/timeout은 표, 조건·기전은 산문. 원본 ASCII·복귀 판정·LAB을 실험 결과로 옮기지 않음
- 대표 문장: 원본 “그 바인딩이 유지되는 후속 패킷은 NAT 규칙으로 백엔드를 다시 고르지 않는다” → “바인딩이 유지되는 후속 패킷은 같은 규칙으로 백엔드를 매번 다시 고르지 않습니다”
- Decision 섹션 미포함: 구현 기전 설명이며 원본에 없는 개인 선택·대안 서사 추가 안 함
- 핵심 미확인/보류 없음. 실노드 커널/config/sysctl/모드·패킷 경로·카운터·성능·회수 실측은 실행하지 않아 결과로 주장하지 않음. 전체 lint/build/정적 출력·독립 검수·기록·커밋은 parent 단계


# Batch 20 · kernel-1 CPU quota 인계

- 산출물: `src/content/essays/kubernetes/k8s-theory-cgroup-v2-cpu-quota.md` 279줄 · 같은 slug SVG 2개 · 표 4개
- 메타: essays/kubernetes · `k8s-theory-kernel` order 1 · 2026-10-24
- 범위: 본문·소유 SVG·임시 보고서만 편집. 공통 문서·타인 콘텐츠·build·commit·push 작업 없음

## 원본과 적용 기준

- 원본: `/Users/jun/Documents/Obsidian Vault/☸️ k8s-theory/sessions/커널 하강 1 · cgroup v2 인터페이스와 CFS quota.md`
- 439줄 전문 확인 · SHA256 `9ed4b6bd36e3ad4417120894dd3ee727566d3ffdc041ecaebc63bd64208ab99c`
- 같은 Vault의 `☸️ progress.md`: 1122줄 · `c3081510322928d79907275e31e02c0f4708ec606644bed7581006645d1d16f5`
- `☸️ source-map · Phase 2.md`: 2189줄 · `79c08e1759c80a6efc16cde0efd1af227addd3eece6dffd3fd657af6f75c18fe`
- Codex 진입점·연결된 공동 draft-to-post, docs/writing-voice.md, plan/source-format, SVG 가이드 적용
- kernel 시리즈 첫 편으로 승인된 매핑을 따름. 기존 `k8s-theory-qos-cgroups.md`를 구조·CPU/MemoryQoS 연결 기준으로 실제 대조했으며 모순 발견 없음, 타글 수정 없음

## 현재 커널 상태와 고정 근거

- [kernel.org](https://www.kernel.org/), [releases.json](https://www.kernel.org/releases.json), [longterm 목록](https://www.kernel.org/releases.html)을 2026-10-24 실제 확인
- JSON latest_stable/mainline은 7.3, stable 항목은 7.2.12, 최신 longterm은 6.18.58(2026-10-21). 6.18 projected EOL은 Dec 2028이며 예상 날짜임
- 설명 기준은 현재 최신 LTS Linux **v6.18.58**로 선택. 과거 원본의 v6.12를 최신으로 부르지 않음
- [공식 stable 유지관리자 고정 소스](https://github.com/gregkh/linux/tree/2926d88bb7fc4608fd942453d929c39e4e5ec006): tag 객체 `b28ed6cce8167f278fbbae4c8ba25d593fcf1b63`을 peel한 commit `2926d88bb7fc4608fd942453d929c39e4e5ec006`
- 태그·릴리스 원문 캐시: `/tmp/k8s-batch20/quota/{kernel-releases.json,kernel-releases.html,linux-tag.json,linux-tag-object.json,linux-ref.txt}`
- kernel-releases.json SHA256 `a789c77cc75008e2f63e114475bc175f0c6fef04ce5a637df7cc4f3ffc47bf23`; releases.html `ab28da40ccf13e3ca3e2bef74b7c8041022da43923b1c17298409a2948e4edb3`
- writer_c와 parent에 기준·ref·캐시 공유 완료, netfilter 글도 같은 LTS ref 사용

## 실제 읽은 파일과 확인한 기전

모든 원문은 `/tmp/k8s-batch20/quota/<repo>/<path>`에 저장. URL·ref·SHA256은 `manifest-linux.json`, `manifest-kubernetes.json`에 기록했으며 성공 파일 21개를 재해시해 일치 확인

- Linux `Documentation/admin-guide/cgroup-v2.rst`: cpu.max/max.burst/weight/stat, fair/BPF/RT 적용 범위, memory.current/max/high/min/low/oom.group
- Linux `Documentation/scheduler/{sched-bwc.rst,sched-eevdf.rst,sched-design-CFS.rst}`: 공유 quota·5ms slice·hierarchy·잔여 반환/유지·현재 EEVDF 용어. v1용 파일 이름과 v2 인터페이스 구분
- Linux `kernel/sched/fair.c`: `__refill_cfs_bandwidth_runtime`, `__assign_cfs_rq_runtime`, `__account_cfs_rq_runtime`, `throttle_cfs_rq`, `unthrottle_cfs_rq`, `do_sched_cfs_period_timer`, `__return_cfs_rq_runtime`, `record_throttle_clock`·계층 throttle 처리
- Linux `kernel/sched/core.c`: `tg_set_cfs_bandwidth`, `cpu_max_write`, `cpu_extra_stat_show`, `cpu_local_stat_show`. 그룹별 cfs_bandwidth 통계와 local 통계를 혼동하지 않음
- Linux `kernel/cgroup/rstat.c`: `cgroup_base_stat_flush`, `cgroup_base_stat_cputime_show`의 사용 시간 상위 전파. LTS 문서의 CPU 기본 세 항목 목록을 완전한 필드 목록으로 단정하지 않음(구현에는 nice_usec도 있음)
- Linux `init/Kconfig`: CONFIG_CFS_BANDWIDTH→FAIR_GROUP_SCHED와 CPU 그룹 기능 조건
- [Kubernetes v1.37.1](https://github.com/kubernetes/kubernetes/tree/f78e722310e50bcaca9276be22276d9e91d91308): `go.mod`에서 cgroups v0.0.7·cAdvisor/lib v0.60.5·runtime-spec v1.3.0을 먼저 확인
- K8s `pkg/kubelet/cm/{helpers_linux.go,cgroup_manager_linux.go}`: MilliCPUToQuota의 정수식·0 입력·1ms 하한, getCPUWeight 선형 변환·Pod cgroup 설정 주체
- K8s `pkg/kubelet/kuberuntime/kuberuntime_container_linux.go`: getCPULimit·calculateLinuxResources·generateLinuxContainerResources의 Pod limit fallback·exclusive CPU 예외·CRI quota/period·MemoryQoS 조건
- K8s `pkg/kubelet/apis/config/{types.go,v1beta1/defaults.go}`, `pkg/features/kube_features.go`: quota 기본 true/100ms, period GA/on과 잠금 없음, exclusive CPU gate Deprecated/on/잠김, MemoryQoS beta/on·기본 factor nil/정책 None
- K8s `staging/src/k8s.io/cri-api/pkg/apis/runtime/v1/api.proto`: LinuxContainerResources CPU 필드·범용 unified 전달 통로
- K8s `vendor/github.com/opencontainers/cgroups/{fs2/cpu.go,utils.go}`: max 문자열·쓰기 조건·CpuBurst·통계 µs→ns·비선형 weight 식
- K8s `vendor/github.com/google/cadvisor/lib/{container/libcontainer/handler.go,metrics/prometheus.go}`: CFS 데이터 전달·CounterValue 선언·quota와 수집 조건·ns→초

## 반영·정정과 문맥 검토

- 원본의 v1.35 alpha/off period·MemoryQoS 설명을 현재 조건으로 갱신. GA 주석의 예정 잠금을 실제 LockToDefault로 바꾸지 않음
- Pod cgroup의 선형 weight와 벤더 함수의 비선형식을 분리. 코드 계산으로 shares 1024→39/100을 확인했으며 설치된 CRI 런타임 식으로 일반화하지 않음
- 자기 cpu.max=max·컨테이너 limit 생략·파일 미작성·부모 제한을 구분. 기본 Pod limit fallback과 exclusive CPU quota 해제 예외 보존
- cpu.stat 대역폭 비계층성은 과거 최신 문구만 인용하지 않고 현재 LTS의 그룹별 출력·타이머·자기 throttle clock과 대조. 사용 시간의 계층 집계·부모 제한·CPU별 제한 시간 누적을 분리
- 잔여 runtime 1ms 반환/유지와 명시적 burst를 구분. quota 증가는 전역 예산 증가이며 slice 자동 증가나 p99 개선 보장이 아님
- 원본의 20ms/100ms·CPU 시간21ms·평균2.1%는 burst·잔여·부모 제한·경합 없는 가정 모델로 명시, 실제 타임라인·실측으로 바꾸지 않음
- 현재 MemoryQoS는 TieredReservation 조건에서 min/low를 구분하므로 과거의 “low를 쓰지 않는다”를 현행 설명에 확대하지 않음
- 대표 문장: 원본 “사용률의 평균 구간과 quota를 집행하는 기간이 다르기 때문이다” → 변환 “CPU 사용률의 평균 구간과 quota 집행 기간이 다르기 때문입니다”
- 선택지 비교 섹션 미포함: 도구·아키텍처 도입 결정이 없는 기전 설명. 원본 학습 메타·LAB·종료 판정·개인 경험 본문 유입 없음

## 자체 검증과 한계

- `npm run lint:post -- src/content/essays/kubernetes/k8s-theory-cgroup-v2-cpu-quota.md`: exit 0, error 0, warn 1. 경고의 100자 초과 5줄은 참고 URL 목록이며 일반 본문은 분리 검토 완료
- `python3 /tmp/k8s-batch20/quota/checks.py`: 원본 hash·439줄·메타·언어 지정·내부 링크·이미지·문단 끝 마침표·캐시21파일 hash·SVG XML 통과. 결과 `output-checks.json`
- SVG 2개: title/desc/role 포함, 텍스트 각13개, 최소20px/560px→375px에서13.39px. sharp 800/375px 총4PNG 생성 후 모두 실제 육안 확인, 한글 깨짐·잘림·겹침 없음
- 전 섹션 시각화 재검토: 공유 예산 구조와 기간 모델은 SVG, 파일·변환·지표 대응은 표, 기록 주체·설정 조건·메모리 예외는 산문으로 처리
- 미확인: 설치된 노드 커널·배포판 패치·커널 빌드 설정·CPU controller 위임·실제 런타임 버전/드라이버/파일 값·요청 지연/카운터 결과. 커널 실행·부하 실험·실측 없음
- full lint·build·정적 export·별도 reviewer·진행표·커밋은 parent 담당, 본 작업에서 실행 안 함. 핵심 근거의 차단 사유 없음


## 별도 blog-reviewer 검수

# Review: Batch 20 · 3 posts / 5 SVG

- 검수일·작성일: 2026-10-24 KST
- 대상: extension order 6, kernel order 1~2 · 읽기 전용 원본·기술·문체·이미지 검수
- 적용: draft-to-post 공동 절차·docs/writing-voice.md·plan/source-format·SVG 가이드

## P0 / 필수 수정

- 0건 · 미해결 기술 오류·보류 사유 없음

## 확인 필요 / 권장

- 미해결 확인 필요 0건 · 미해결 권장 0건
- 권장 2건 반영·재검토 완료
- `k8s-theory-cgroup-v2-cpu-quota.md:18` — “최신 stable은 7.3” → releases.json의 latest_stable과 kernel.org 표의 stable 행을 혼동할 수 있음 → “현재 mainline은 7.3, 최신 longterm은 6.18.58”로 수정. 실제 [kernel.org](https://www.kernel.org/)의 mainline 7.3 / stable 7.2.12 / longterm 6.18.58을 조회하고 수정 고지·고정 ref 문맥 재확인
- `k8s-theory-extension-failure-boundaries.md:89` — “오브젝트의 존재를 두 조정 루프가 두고 경쟁합니다” → 주어가 ‘존재를 두고’ 사이에 끼어 어순이 어색함 → “두 조정 루프가 오브젝트의 존재를 두고 경쟁합니다”로 수정. 원본의 조건부 생성·삭제 경쟁 의미 보존 확인
- lint의 긴 줄은 메타·alt·긴 기술 식별자·고정 URL 및 조건을 문맥으로 검토해 유지
- netfilter SVG1 text 28개 경고는 800/375px 실제 PNG를 모두 열어 수용. 세 경로가 분리되고 라벨 잘림·겹침·한글 깨짐 없음

## 원본·기술 대조

- 정확한 Vault 원본 전문 461/439/302줄, 실제 SHA-256·줄 수가 sources.json과 모두 일치
- boundaries: 공식 등급이 아닌 수단 비교, 동기 admission과 비동기 수렴·finalizer 저장 책임, VAP 평가/설정 오류, CEL API 자기 설정 제외/static 예외를 실제 구현과 대조
- conversion: 같은 버전 대상 생략·None/Webhook 전략, 옛 저장본과 served의 구분, 일반 DELETE의 기존 객체 Get→디코딩/변환 실패 경계 확인. 추가 고정 core 2파일은 reviewer-extra/manifest.json에 보존
- Namespace discovery 부분 실패에도 가능한 삭제 진행·Pod 우선·오류 잔존 시 finalize 미진입, pruning의 보존 예외·재저장·storedVersions 장부·metadata 범위, APIService 철거와 백엔드 데이터 잔존, Condition/status 권한·관측 범위를 대조
- quota: LTS의 cpu.max/weight/stat 계약과 fair-class·EEVDF 용어, 전역/CPU별 runtime 차감·재보충·계층 제한·자기 그룹 대역폭 통계·잔여 반환과 burst를 함수로 확인
- kubelet 기본값·게이트 실제 등록/잠금·Pod limit fallback·exclusive CPU 예외, Pod cgroup 선형 weight/벤더 비선형식, cgroups µs→ns와 cAdvisor ns→초·Counter/수집 조건, MemoryQoS 입력 조건을 확인
- netfilter: hook/priority/table/chain 구분, 수신·전달·로컬 생성·재라우팅, NAT 초기 선택/후속 변환·original/reply와 NEW 상태 구분, namespace/zone·공유 해시·초기값/회수·timeout 갱신을 대조
- kube-proxy online CPU/cap 우선순위·Min/MaxPerCore0·hashsize/오류 전파와 Service IP/NodePort UDP 정리의 빈 endpoint 차이 확인. flowtable/notrack/별도 데이터 경로 범위 구분
- Linux 기준은 최신 LTS v6.18.58 `2926d88bb7fc4608fd942453d929c39e4e5ec006`, 원본 v6.12 및 현재 mainline 7.3과 구분. Kubernetes v1.37.1 ref f78e7223은 노드 커널 버전이 아님
- 원본 없는 개인 경험·실습·실측·성능 보장·설계 의도 창작 없음. 가정과 현재 구현·실제 설치 조건 및 시리즈 연결을 구분

## 실행 검증

- 먼저 글별 lint:post 후 최종 세 편 함께 재실행: exit 0 · error 0 / warn 4
- 경고: boundaries 긴 줄 10곳(1), quota 긴 줄 5곳(1), netfilter 긴 줄 9곳+SVG text 28개(2)
- 대상 본문/SVG git diff --check: exit 0
- slug 유일성·essays/kubernetes·각 series/order·작성일·시리즈 트랙 일치
- SVG 5개 XML/role/title/desc 검사, sharp로 800/375px PNG 10장 독립 재렌더 후 전부 실제 육안 검사. 렌더 입력과 최종 SVG SHA 동일
- 공식 캐시 성공 76파일 SHA 일치(작성자 74+reviewer 추가 2). 초기 mainline raw 요청 429 실패 16건은 근거 제외, LTS 16파일로 확보·대조됨
- 원본/캐시/PNG 상세: reviewer-evidence-checks.json · reviewer-render/inputs.json
- 최종 저장본 8파일의 flat SHA-256: review-hashes.json
- 전체 lint/build/정적 export·커밋: reviewer 실행 안 함, parent 통합 검증 담당

## 근거 위치·요약

- 각 작성 보고서: boundaries/report.md · quota/report.md · netfilter/report.md. 공식 URL·ref·파일 SHA는 각 manifest*.json에 기록
- 핵심 고정 소스: [Linux LTS](https://github.com/gregkh/linux/tree/2926d88bb7fc4608fd942453d929c39e4e5ec006), [Kubernetes](https://github.com/kubernetes/kubernetes/tree/f78e722310e50bcaca9276be22276d9e91d91308), [controller-runtime](https://github.com/kubernetes-sigs/controller-runtime/tree/5d8467b3065818a3b382d8f6941147a801fd1969)
- 필수 0 · 확인 필요 0 · 권장 2건 수정 완료 / 미해결 0 · 검토 파일 8개 · 레거시 제외 0개
- 이 최종 저장본을 통합 검증에 인계함


### 지적 반영·재검토

- 권장 수정 1건: kernel.org releases.json의 latest_stable 키를 웹 표의 stable 행 명칭과 같게 읽을 수 있는 고지 문장을 수정했다
- root도 https://www.kernel.org/ 실제 표를 조회해 mainline 7.3 / stable 7.2.12 / longterm 6.18.58 구분을 확인했다
- 본문 고지를 ‘현재 mainline은 7.3, 최신 longterm은 6.18.58’로 한정했다. 기준 ref와 기술 설명은 바꾸지 않았다
- reviewer가 수정 저장본을 재검토한 뒤 최종 hash를 확정한다

- 문체 권장 1건: ‘오브젝트의 존재를 두 조정 루프가 두고 경쟁합니다’를 ‘두 조정 루프가 오브젝트의 존재를 두고 경쟁합니다’로 어순만 바꿨다
- 최종 인계 전 작성자가 본인 소유 글에 반영했고, root가 저장본에서 반영을 확인했다. 기술 내용은 유지했다


## 실제 최종 검증

- `npm run lint:post -- <대상 3편>`: exit 0, error 0 / warn 4
- `npm run lint`: exit 0, error 0 / warn 1 (기존 `src/app/layout.tsx:80` custom font 경고)
- `npm run build`: exit 0, TypeScript·정적 생성·postbuild 성공, 664 pages
- 원본 SHA-256·검수한 최종 글/SVG와 빌드 입력 hash 일치
- slug 유일성·시리즈 order 연속성·내부 링크·이미지 실존·SVG XML/접근성 메타 검사 통과
- 실제 `getAllPosts`·`getEssaysList`·`getSearchIndex` 실행: 3편 모두 essays 등록, 목록·검색에 content 없음
- HTML 3개·SVG 5개 export·`/my-blog/diagrams/` 참조·SVG 바이트 일치
- sitemap·llms 반영, RSS는 최신 20편 정책·실제 출력 일치
- `git diff --check` 통과, prebuild의 이번 CLAUDE.md 자동 통계 변경만 복원
- Node `DEP0205 module.register()`·TS 직접 import의 `MODULE_TYPELESS_PACKAGE_JSON` 경고는 범위 밖 설정을 바꾸지 않고 유지
- 새 의존성·클러스터 실습·통합 실험·성능 실측·push·배포·시리즈 카드 등록: 실행 안 함

원시 로그·근거 캐시: `/tmp/k8s-batch20/`
공식 URL/ref와 주요 정정은 위 기록과 글에 보존했다

## 다음 대상

- `커널 하강 3 · mount 와 bind mount.md` → `k8s-theory-mount-bind-mount` (`k8s-theory-kernel` / 3)
- `커널 하강 4 · 페이지 캐시 회수와 OOM.md` → `k8s-theory-page-cache-reclaim-oom` (`k8s-theory-kernel` / 4)
- `커널 하강 5 · namespace 수명.md` → `k8s-theory-namespace-lifetime` (`k8s-theory-kernel` / 5)
