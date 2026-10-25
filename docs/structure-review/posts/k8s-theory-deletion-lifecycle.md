# DELETE 이후 객체가 남는 이유 — finalizer와 유예 종료 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-deletion-lifecycle.md](../../../src/content/essays/kubernetes/k8s-theory-deletion-lifecycle.md)
- 시리즈: `k8s-theory-api` / 9
- 원문 SHA256: `21af6f5fb818c1375c5ec527c30908f2ab97c82e9f93af22578535894603adc3`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 두 기본 삭제 경로를 먼저 완결

## 독자와 중심 질문

DELETE 성공 뒤 객체가 남아 있을 때 누가 어떤 조건을 기다리는지 구분합니다

선행 개념: API 객체와 실행 중인 프로세스의 차이, ownerReferences

## 현재 전개

- L23: 삭제를 요청한 뒤에도 객체를 남기는 이유
- L44: 부모 삭제와 자식 처리는 전파 정책으로 연결합니다
- L75: finalizer는 정리 코드를 실행하는 명령이 아닙니다
- L131: Pod의 유예 종료에는 마지막 DELETE가 남아 있습니다
- L184: Namespace 안의 객체를 정리한 뒤 finalizer를 제거합니다
- L263: 삭제 시작도 generation을 바꿀 수 있습니다
- L288: observedGeneration이 같아도 작업은 끝나지 않았을 수 있습니다

## 원문 근거와 개선점

### L44 finalizer 동작을 끝내기 전에 GC 정책으로 넓어집니다

> ## 부모 삭제와 자식 처리는 전파 정책으로 연결합니다

도입의 외부 로드밸런서 사례는 이해하기 좋지만, 정리 담당자가 관찰하고 항목을 제거하는 설명보다 foreground·orphan과 cache 조건이 먼저 나옵니다

수정 방향: 기존 finalizer 절을 외부 자원 사례에 바로 붙여 삭제 표시 → 정리 → 항목 제거를 완성한 뒤 GC를 그 장치의 응용으로 소개합니다

### L288 삭제에서 rollout 완료 판정으로 중심 질문이 달라집니다

> ## observedGeneration이 같아도 작업은 끝나지 않았을 수 있습니다

삭제 시작의 generation 변화는 관련 있지만 observedGeneration·rollout 판정까지 끝에 확장하면 삭제 보류 원인을 정리할 자리를 잃습니다

수정 방향: 삭제 관련 generation 조건만 보충하고 일반 관찰 번호 설명은 reconcile/rollout 글과 연결합니다. 끝은 finalizer·유예 종료·Namespace 조건별 확인으로 돌아옵니다

## 권장 설명 순서

1. Service 외부 자원 사례로 객체를 남길 이유를 제시합니다
2. finalizer의 기록·관찰·정리·제거와 성공 응답의 한계를 한 경로로 설명합니다
3. Pod 유예 종료를 비교 경로로 제시해 kubelet 처리·마지막 DELETE·UID 조건을 연결합니다
4. deletionTimestamp와 grace period가 실제 제거 시각을 보장하지 않는 이유를 정리합니다
5. 소유 관계로 범위를 넓혀 Background·Foreground·Orphan과 blocking 자식을 설명합니다
6. Namespace의 별도 필드·discovery·잔존 객체를 다루고, 현재 남은 조건별로 진단합니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

finalizer는 정리 담당자가 끝났다고 표시할 때까지 객체를 남기는 장치입니다
Pod는 이와 별도로 실행 중인 컨테이너를 종료할 시간도 필요하므로 두 조건을 나눠 확인해야 합니다

## 유지할 내용과 조건

- finalizer 제거가 외부 정리의 증거는 아님, 항목 순서 비보장
- DELETE 200/202의 문서와 구현 차이, foreground의 cache·blockOwnerDeletion 조건
- Namespace 두 finalizer 필드, 강제 제거의 잔존 객체 위험, 유예 종료 예외

## 편집 후 독자 확인

- finalizers가 비어 있는데 Pod가 남을 수 있는 이유를 설명하는가?
- Namespace discovery 오류와 발견한 객체의 finalizer 대기를 구분할 수 있는가?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
