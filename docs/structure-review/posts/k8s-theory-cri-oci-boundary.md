# CRI와 OCI — 실행 요청과 bundle 설정의 경계를 구분합니다 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-cri-oci-boundary.md](../../../src/content/essays/kubernetes/k8s-theory-cri-oci-boundary.md)
- 시리즈: `k8s-theory-node` / 12
- 원문 SHA256: `15a43c343c2135a9984636ae16e18ad230af0f23a4bc56addb0ada2cdc04c585`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 컨테이너 시작 한 건의 흐름을 먼저 완결

## 독자와 중심 질문

kubelet의 실행 요청이 containerd·shim·runc를 거칠 때 각 계약의 책임과 create/start 시점을 구분합니다

선행 개념: Pod sandbox·컨테이너·이미지, kubelet

## 현재 전개

- L24: kubelet은 CRI 클라이언트이고 runc는 OCI 실행기입니다
- L49: CRI는 실행 관리와 이미지 관리를 별도 서비스로 정의합니다
- L70: sandbox를 먼저 준비하고 컨테이너를 생성합니다
- L103: CRI create와 start 사이에는 컨테이너 ID 등록이 있습니다
- L124: OCI bundle은 실행 설정이며 명령줄 API가 아닙니다
- L161: namespace와 cgroup 값도 OCI 설정으로 옮깁니다
- L171: 이미지 관리가 끝나야 실행기에 root 파일시스템을 줄 수 있습니다
- L220: ImagePullBackOff는 실제 pull 실패 뒤의 대기입니다
- L247: 이미지 GC는 시작 임계값과 삭제 목표를 나눕니다
- L271: 확인한 근거

## 원문 근거와 개선점

### L49 실행 사례 전에 RPC 목록과 endpoint 설정이 나옵니다

> ## CRI는 실행 관리와 이미지 관리를 별도 서비스로 정의합니다

역할 그림 뒤 ImageService RPC·기본 소켓을 읽고 sandbox로 넘어갑니다. 기본 시작 순서를 먼저 따라가면 서비스 분리 이유가 더 분명합니다

수정 방향: 서비스 책임은 한 줄로 안내하고 이미지 확보→sandbox→container create/start의 기본 경로를 먼저 풉니다

### L171 bundle의 전제가 OCI 설명 뒤에 나옵니다

> ## 이미지 관리가 끝나야 실행기에 root 파일시스템을 줄 수 있습니다

준비된 rootfs와 bundle을 읽으면서 누가 준비하는지는 역할 표에만 의존합니다. imagePullPolicy·GC까지 함께 붙어 실행 경로가 되돌아갑니다

수정 방향: rootfs 준비 책임을 bundle 설명 직전에 배치하고 pull 정책·자격증명·GC는 시작 실패와 이미지 수명이라는 별도 단위로 묶습니다

## 권장 설명 순서

1. kubelet·CRI 구현·shim·OCI 실행기의 기존 역할 그림을 유지합니다
2. 이미지 준비와 sandbox 생성 뒤 컨테이너 설정을 만드는 기본 흐름을 따라갑니다
3. CRI CreateContainer의 메타데이터/ID와 StartContainer 내부 OCI create/start의 실제 대응을 비교합니다
4. OCI bundle·namespace·cgroup·hook의 범위를 설명합니다
5. 서비스 endpoint와 RuntimeClass·namespace 선택 조건을 보충합니다
6. pull 정책·접근 검증·backoff·이미지 GC를 별도 운영 단위로 연결합니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

두 계약에 create와 start라는 이름이 있어도 같은 시점의 호출은 아닙니다
containerd가 CRI 요청을 내부 task 작업으로 옮기는 지점에서 실제 대응을 확인해야 합니다

## 유지할 내용과 조건

- containerd/runc는 구현 예이며 보편 규격과 구분
- CRI CreateContainer와 OCI create의 일대일 대응 금지
- 실행 중 config.json 수정 한계, pull과 모든 layer 재다운로드 차이, kubelet 훅과 OCI 훅 구분

## 편집 후 독자 확인

- rootfs 준비와 사용자 프로그램 시작을 각각 누가 맡는지 설명하는가?
- CRI StartContainer가 실패했을 때 이미 끝난 단계와 아직 모르는 단계를 나눌 수 있는가?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
