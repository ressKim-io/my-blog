# kubelet과 Pod 수명주기 — 실행 중과 준비 완료는 다릅니다 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-kubelet-pod-lifecycle.md](../../../src/content/essays/kubernetes/k8s-theory-kubelet-pod-lifecycle.md)
- 시리즈: `k8s-theory-node` / 4
- 원문 SHA256: `8f62a9ed025d860f5e27e0cf373587ef442846a11b5a594ff922ec9d0008a57c`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 사용자가 보는 상태를 앞세우고 반복 루프는 뒤에 설명

## 독자와 중심 질문

Running·Ready·재시작·종료가 각각 무엇을 판정하며 어떤 주체가 상태를 바꾸는지 이해합니다

선행 개념: 배치된 Pod와 컨테이너, kubelet의 역할

## 현재 전개

- L24: kubelet은 Pod 구성과 실제 컨테이너 상태를 맞춥니다
- L79: container state, Pod phase, Ready를 나눠 읽습니다
- L119: 세 probe는 실패를 서로 다른 동작으로 연결합니다
- L161: 일반 init은 완료를, sidecar는 시작을 기다립니다
- L193: preStop도 컨테이너의 종료 유예 시간을 사용합니다
- L225: EndpointSlice 전파와 프로세스 종료에는 고정된 선후가 없습니다
- L258: static Pod는 API 서버 외의 구성 소스로 실행합니다
- L275: 증상은 판정 주체와 함께 읽습니다
- L302: 근거를 확인한 문서와 소스

## 원문 근거와 개선점

### L48 Running과 Ready의 답보다 루프 주기가 먼저 나옵니다

> ### 1초 티커와 1분 동기화 설정은 다른 값입니다

도입은 상태의 차이인데 sync 입력·티커·PLEG 주기를 읽은 뒤에야 container state·phase·Ready 비교가 나옵니다

수정 방향: 두 컨테이너 중 하나가 CrashLoopBackOff여도 Running일 수 있는 기존 사례와 Ready 비교를 앞으로 옮깁니다. 루프와 PLEG는 상태를 관찰하는 구현으로 설명합니다

### L225 준비 상태가 트래픽에 미치는 역할을 종료까지 미룹니다

> ## EndpointSlice 전파와 프로세스 종료에는 고정된 선후가 없습니다

readiness 실패 시 컨테이너를 종료하지 않는 이유는 설명하지만 Service 대상 반영은 훨씬 뒤에 나옵니다

수정 방향: readiness 절에서 EndpointSlice가 준비 상태를 받는다는 최소 연결을 먼저 둡니다. 종료 전파의 경합·preStop 상세는 종료 단위에서 유지합니다

## 권장 설명 순서

1. Running인데 준비되지 않은 기존 다중 컨테이너 사례를 제시합니다
2. container state·Pod phase·조건을 구분하고 startup/liveness/readiness의 행동 차이를 연결합니다
3. 일반 init·native sidecar의 시작 순서를 설명합니다
4. kubelet 반복 루프·PLEG·probe 입력으로 앞의 상태가 갱신되는 과정을 풉니다
5. 삭제 관찰→preStop→중지→상태 보고와 EndpointSlice의 독립 전파를 비교합니다
6. static/mirror Pod와 주기·gate 조건을 보충하고 상태별 진단으로 정리합니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

프로세스가 실행 중이라는 사실만으로 요청을 받을 수 있는지는 알 수 없습니다
kubelet은 실행 상태와 준비 판정을 따로 기록하고 readiness 결과를 준비 상태에 반영합니다

## 유지할 내용과 조건

- CrashLoopBackOff는 phase·원인이 아닌 재시도 대기 reason
- probe 종료와 restart policy, sidecar 시작/종료 조건
- preStop은 유예를 사용, EndpointSlice와 종료 순서 비보장, mirror 삭제와 원본 제거 차이

## 편집 후 독자 확인

- Running·ContainersReady·Ready가 다를 수 있는 이유를 설명하는가?
- preStop sleep이 트래픽 전파 완료를 보장하지 않는 이유를 말할 수 있는가?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
