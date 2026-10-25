# Namespace 수명 — 프로세스가 없어도 남는 참조 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-namespace-lifetime.md](../../../src/content/essays/kubernetes/k8s-theory-namespace-lifetime.md)
- 시리즈: `k8s-theory-kernel` / 5
- 원문 SHA256: `f30f053f2a565908ab32f01c8cba56a5a4207df505335c6269ce2915f6de16a2`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 부분 재배치

## 독자와 중심 질문

Pod의 프로세스가 사라져도 namespace와 IP 할당 기록이 남을 수 있는 이유와, 각각의 정리 완료는 무엇으로 확인할까요?

선행 개념: Pod sandbox·CNI DEL·mount의 기본 뜻을 전제합니다. Linux namespace와 Kubernetes Namespace를 먼저 구분합니다

## 현재 전개

- L22: Namespace는 자원을 보는 범위를 나눕니다
- L37: Task는 여러 namespace를 참조합니다
- L57: 열린 FD와 namespace mount도 수명을 유지합니다
- L96: FD를 갖는 것과 namespace에 참여할 권한은 다릅니다
- L118: Network namespace의 마지막 참조 뒤에도 정리 단계가 있습니다
- L138: Containerd의 netns mount는 pause와 별도로 유지됩니다
- L172: PID namespace는 init 종료 뒤 실행을 다시 시작할 수 없습니다
- L203: 관찰자의 namespace와 파일시스템의 관점도 구분합니다
- L242: 삭제 완료는 대상별 근거로 판단합니다
- L260: 확인한 근거

## 원문 근거와 개선점

### L37 남아 있는 참조의 사례보다 커널 내부 구조가 앞섭니다

> ## Task는 여러 namespace를 참조합니다

도입은 앱·pause가 없어도 남는 대상이라는 구체적인 질문입니다. 하지만 task_struct·nsproxy와 PID·user 예외를 읽은 뒤에야 열린 FD·namespace mount가 수명을 유지한다는 답을 얻습니다

수정 방향: namespace 종류를 짧게 구분하고 프로세스·열린 FD·namespace mount의 참조 그림을 먼저 보여줍니다. task_struct·nsproxy는 그 그림의 프로세스 참조를 실제 커널 구조로 풀이하는 보충으로 둡니다

### L96 network namespace 정리의 한 주기 사이에 참여 권한이 끼어 있습니다

> ## FD를 갖는 것과 namespace에 참여할 권한은 다릅니다

참조가 수명을 유지하는 설명 뒤에 clone·unshare·setns 권한을 먼저 읽고 마지막 참조 해제·containerd·CNI 정리로 돌아옵니다. 객체를 유지하는 일과 그 안에 들어가는 일이 다른 질문임을 구조로도 구분할 필요가 있습니다

수정 방향: 남은 참조→마지막 참조 해제→비동기 커널 정리→runtime mount와 CNI 장부라는 network 수명을 먼저 완결합니다. 이후 PID의 실행 가능성·setns 권한·관찰자의 /proc 관점을 비교 단위로 묶습니다

## 권장 설명 순서

1. Pod 프로세스는 없는데 namespace·IP 기록이 남은 가정 사례와 Linux·Kubernetes Namespace의 차이를 제시합니다
2. 프로세스·열린 FD·namespace 자체의 bind mount가 수명을 유지하는 참조 그림을 설명합니다
3. network namespace의 마지막 참조 뒤 비동기 정리와 containerd의 mount 제거·CNI DEL·IPAM 반환을 연결합니다
4. 프로세스 참조를 task_struct·nsproxy로 풀고 다른 namespace·파일시스템 참조는 보충합니다
5. PID init 종료 뒤 객체 존재와 새 실행 가능성이 다른 이유를 설명하고 setns·권한·자식 대상 선택을 구분합니다
6. 관찰자의 /proc·cgroup 관점과 실행 인스턴스 식별을 정리한 뒤 API·runtime·CNI·커널별 완료 근거로 마칩니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

pause가 종료되면 pause가 가진 참조는 줄어들지만 runtime의 namespace mount가 남을 수 있습니다
그 참조까지 정리한 뒤에도 커널 장치 정리와 IPAM의 주소 반환은 다른 대상의 작업이므로 각각 확인해야 합니다

## 유지할 내용과 조건

- 남은 참조를 곧바로 누수로 판단하지 않는 설명을 유지합니다
- 모든 bind mount가 namespace 수명을 유지하는 것은 아니며 namespace 자체의 mount와 앱 경로 mount를 구분합니다
- containerd의 확인한 구현 순서를 모든 CRI runtime의 계약으로 일반화하지 않습니다
- PID namespace의 객체 수명·실행 가능성·권한, cgroup 경로의 관점·조상 제한을 구분합니다

## 편집 후 독자 확인

- nsproxy의 모든 필드를 몰라도 프로세스가 없는 namespace가 남는 이유를 설명할 수 있나요?
- namespace 정리와 IPAM 반환을 같은 완료 사건으로 읽지 않나요?
- 객체가 존재하거나 FD가 있다는 사실만으로 그 namespace에서 실행할 수 있다고 판단하지 않나요?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
