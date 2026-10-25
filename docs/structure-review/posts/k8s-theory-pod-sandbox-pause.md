# Pod sandbox와 pause — 네트워크를 앱 재시작과 분리하는 과정 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-pod-sandbox-pause.md](../../../src/content/essays/kubernetes/k8s-theory-pod-sandbox-pause.md)
- 시리즈: `k8s-theory-network` / 2
- 원문 SHA256: `162b4d996da5bfd24944de3c399d7febd1dd0d80c70fc3b461f70b278b4f9cf7`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 부분 재배치

## 독자와 중심 질문

같은 Pod의 앱 컨테이너가 재시작해도 네트워크를 유지할 수 있는 이유와, sandbox 재생성 때 달라지는 것은 무엇일까요?

선행 개념: 컨테이너 재시작과 Pod 재생성의 차이, namespace가 격리된 실행 자원을 묶는 단위라는 정도를 전제합니다

## 현재 전개

- L23: CRI는 sandbox를 요구하고 구현은 런타임이 정합니다
- L43: namespace 생성과 참조 유지는 다른 일입니다
- L72: network를 공유해도 PID까지 공유하는 것은 아닙니다
- L97: veth를 쓴다면 노드 쪽 끝의 처리도 봐야 합니다
- L128: kubelet은 런타임이 보고한 IP를 읽습니다
- L156: 앱 재시작과 sandbox 재생성을 구분합니다
- L186: sandbox 준비 조건과 앱 Ready는 다릅니다
- L199: 실패 지점은 네트워크의 수명과 함께 봅니다
- L214: 참고 자료

## 원문 근거와 개선점

### L97 sandbox의 수명을 설명하는 도중 데이터 경로로 벗어납니다

> ## veth를 쓴다면 노드 쪽 끝의 처리도 봐야 합니다

namespace 참조와 pause의 역할을 설명한 뒤 veth·bridge·eBPF 경로로 이동합니다. 도입의 앱 재시작 질문은 뒤의 sandbox 재생성 절에서야 답을 얻습니다

수정 방향: veth 절을 sandbox 생성·재사용·재생성 설명 다음의 보충 절로 옮깁니다. 핵심 본문에서는 CNI가 attachment를 준비한다는 연결만 남기고 구체적인 전달 경로는 다음 네트워크 글과 연결합니다

### L156 도입에서 약속한 비교를 앞에서 완결합니다

> ## 앱 재시작과 sandbox 재생성을 구분합니다

이 절의 구분이 글을 읽는 가장 큰 이유입니다. 현재는 IP 전달과 hostNetwork 분기를 거친 뒤 등장해 독자가 앞서 본 namespace 참조 지식을 오래 유지해야 합니다

수정 방향: 정상 sandbox 생성 직후에 앱만 재시작하는 경우와 sandbox를 다시 만드는 경우를 나란히 설명합니다. 이후 IP 전달·hostNetwork·Ready 판정을 각각 그 흐름의 조건으로 붙입니다

## 권장 설명 순서

1. 앱 재시작 때 Pod IP를 유지할 수 있다는 관찰에서 sandbox의 필요성을 제시합니다
2. CRI의 sandbox 계약과 해당 Linux 런타임 구현을 구분하고 network namespace 생성·참조 유지 방식을 설명합니다
3. CNI 설정과 pause 시작, 앱 컨테이너 참여까지 정상 생성 순서를 따라갑니다. localhost 공유와 PID namespace의 별도 조건도 여기서 설명합니다
4. 앱만 재시작하는 경우와 sandbox 재생성 조건을 비교해 namespace 수명·pause 프로세스·런타임 Ready가 다른 판단임을 보여줍니다
5. 런타임 IP가 kubelet으로 전달되는 경로와 hostNetwork 분기를 설명합니다
6. veth 사용 시 노드 쪽 전달 경로를 보충하고, sandbox 준비와 앱 readiness를 구분한 진단 순서로 마칩니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

앱 컨테이너는 준비된 network namespace에 참여합니다
따라서 앱 하나의 종료와 sandbox 전체를 다시 만드는 판단을 구분해야 Pod IP가 언제 유지되고 언제 달라질 수 있는지 이해할 수 있습니다

## 유지할 내용과 조건

- pause가 IP나 veth를 설정하지 않으며 namespace를 유지하는 유일한 참조도 아니라는 설명을 보존합니다
- network namespace 공유와 PID namespace 공유, pause의 PID 1 역할을 구분합니다
- containerd·Linux·일반 Pod라는 구현 범위와 hostNetwork 예외를 보존합니다
- CrashLoopBackOff만으로 sandbox 재생성이나 IP 변경을 확정하지 않습니다

## 편집 후 독자 확인

- 앱 프로세스 종료와 namespace 소멸이 왜 같은 사건이 아닌지 설명할 수 있나요?
- pause 종료, sandbox NotReady, 앱 readiness 실패를 구분할 수 있나요?
- veth 절을 읽기 전에 도입의 재시작 질문에 답할 수 있나요?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
