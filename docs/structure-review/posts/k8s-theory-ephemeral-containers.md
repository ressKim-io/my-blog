# 임시 컨테이너 — 추가 전용 API와 실행·상태 집계의 경계 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-ephemeral-containers.md](../../../src/content/essays/kubernetes/k8s-theory-ephemeral-containers.md)
- 시리즈: `k8s-theory-node` / 19
- 원문 SHA256: `5e5500a95dfe07fe1250dbcd085301d570a192a681325032ebfadbdd2c3026db`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 디버깅 한 번의 동작을 먼저 제시하고 API 내부를 보충

## 독자와 중심 질문

기존 Pod에 진단 컨테이너를 추가했을 때 무엇이 저장되고 실행되며 어떤 상태 집계에서 빠지는지 이해합니다

선행 개념: Pod·exec·PID namespace의 최소 의미, kubelet/runtime

## 현재 전개

- L26: 임시 컨테이너를 추가하는 서브리소스가 따로 있습니다
- L69: 서버는 새 임시 목록을 선택하고 나머지를 복원합니다
- L97: 기존 임시 항목은 이름과 내용이 유지돼야 합니다
- L127: 허용 목록에 없는 필드는 사용할 수 없습니다
- L157: targetContainerName은 PID namespace 대상을 선택합니다
- L193: kubelet은 init 완료 전에도 시작할 수 있지만 재시작하지 않습니다
- L216: 상태 집계에서 빠져도 Pod 자원을 소비합니다
- L239: kubectl debug의 프로파일은 API 권한을 대신하지 않습니다
- L269: 거부 지점과 실행 실패를 나누어 확인합니다
- L286: 확인한 문서와 소스

## 원문 근거와 개선점

### L69 진단 컨테이너 사용 결과보다 필드 복원 구현이 앞섭니다

> ## 서버는 새 임시 목록을 선택하고 나머지를 복원합니다

서브리소스 목록과 spec/status 복원·managedFields를 길게 읽어야 실제 대상 프로세스와 실행을 만납니다

수정 방향: 도구 없는 앱 조사→임시 목록 추가→kubelet 시작→별도 상태 확인을 기본 사례로 먼저 끝냅니다. 다른 필드 복원과 허용 목록은 API 변경 범위의 상세로 둡니다

### L239 사용자 진입점과 API 동작의 관계가 늦습니다

> ## kubectl debug의 프로파일은 API 권한을 대신하지 않습니다

도입의 exec 한계에서 어떤 클라이언트 작업으로 임시 컨테이너를 추가하는지 오래 기다려야 합니다. 후반 copy-to까지 같은 명령의 서로 다른 작업이 드러납니다

수정 방향: 앞쪽에서 기존 Pod 추가와 copy-to의 별도 작업만 간단히 나누고 profile/권한·필드 생성 상세는 뒤에서 설명합니다

## 권장 설명 순서

1. shell 없는 앱을 조사하는 기존 필요와 ephemeral container의 한계를 제시합니다
2. 기존 Pod 추가의 client→subresource→kubelet→runtime→상태 경로를 설명합니다
3. targetContainerName과 PID namespace·접근 권한의 차이를 풉니다
4. 추가 전용·금지 필드·원래 spec 복원·mirror Pod 제한을 API 범위로 묶습니다
5. 재시작하지 않는 실행과 phase/Ready 집계 제외, 실제 자원 소비를 연결합니다
6. kubectl profile·PSA·copy-to를 다른 설정/작업으로 구분하고 실패 단계로 마칩니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

임시 컨테이너를 추가하는 요청이 저장돼도 실행은 kubelet이 별도로 처리합니다
그리고 실행 상태는 별도 목록에 남으므로 Pod의 Ready만으로 진단 컨테이너의 성공을 판단할 수 없습니다

## 유지할 내용과 조건

- 추가 전용과 일반 Pod 수정의 권한 분리
- TARGET은 주로 PID 선택이며 runtime 지원·실제 접근 권한 필요
- 상태 집계 제외가 자원 영향 없음은 아님, 생성 재시도와 종료 후 재시작 차이, copy-to 별도 요청

## 편집 후 독자 확인

- 추가 요청 성공과 진단 프로세스 시작 성공을 구분하는가?
- 임시 컨테이너가 Ready 집계에서 빠져도 앱에 영향을 줄 수 있는 이유를 설명하는가?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
