# Deployment와 DaemonSet — 롤아웃의 가용성과 되돌리기 이력 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-workload-rollout-revisions.md](../../../src/content/essays/kubernetes/k8s-theory-workload-rollout-revisions.md)
- 시리즈: `k8s-theory-node` / 8
- 원문 SHA256: `6dada9bde500b39a009f85a22ae459828d2f5b87d72da391f7f37a837ad0c402`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 컨트롤러별 설명을 완결하고 비교 축 통일

## 독자와 중심 질문

Deployment와 DaemonSet이 교체 중 무엇을 세며 과거 템플릿을 어떻게 다시 적용하는지 이해합니다

선행 개념: ReplicaSet·Ready/available, Pod template

## 현재 전개

- L24: Deployment는 템플릿별 ReplicaSet의 목표 수를 조정합니다
- L55: maxSurge와 maxUnavailable은 세는 대상이 다릅니다
- L98: 롤백은 과거 템플릿으로 새 롤아웃을 시작합니다
- L134: Progressing은 이전 상태보다 나아졌는지 확인합니다
- L159: DaemonSet은 노드별로 필요한 Pod를 먼저 정합니다
- L211: DaemonSet의 이력은 ControllerRevision에 저장합니다
- L242: ReplicaSet 축소는 별도 규칙으로 삭제할 Pod를 고릅니다
- L287: 상태와 이력을 함께 봐야 멈춘 지점을 구분할 수 있습니다

## 원문 근거와 개선점

### L43 롤아웃 수 계산 전에 소유 관계 검증으로 샙니다

> ### selector 불변 검증과 소유권은 별개입니다

첫 그림의 템플릿별 집합에서 maxSurge·available 계산으로 바로 이어지면 교체 목적이 선명합니다. selector 불변과 채택·방출은 그 뒤의 보충 조건으로 읽는 편이 낫습니다

수정 방향: replicas 3의 기존 교체 예를 앞당기고 selector 검증은 집합 식별의 상세로 옮깁니다

### L242 DaemonSet 설명 뒤 Deployment의 하위 동작으로 되돌아옵니다

> ## ReplicaSet 축소는 별도 규칙으로 삭제할 Pod를 고릅니다

Deployment→DaemonSet 비교를 끝낸 뒤 ReplicaSet 삭제 정렬·rank를 새로 풉니다. 독자는 어느 컨트롤러의 교체 단계였는지 다시 찾아야 합니다

수정 방향: ReplicaSet 삭제 기준을 Deployment 축소 설명에 붙이거나 독립 심화 절로 분명히 표시합니다. DaemonSet 뒤에는 두 방식의 비교와 진단을 둡니다

## 권장 설명 순서

1. Deployment가 템플릿별 ReplicaSet의 목표 수를 조정한다는 그림을 유지합니다
2. replicas 3 예로 증설→새 Pod available→기존 집합 축소를 따라갑니다
3. 진행 상태·deadline과 PDB 비적용, ReplicaSet의 삭제 선택을 같은 교체 단위에서 설명합니다
4. 옛 ReplicaSet 템플릿으로 새 rollout을 시작하는 undo와 이력 정리를 풉니다
5. DaemonSet의 노드별 목표·교체·ControllerRevision을 같은 비교 축으로 설명합니다
6. 두 워크로드의 수 계산·이력·정지 원인을 정리합니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

Deployment가 줄이는 것은 ReplicaSet의 목표 수입니다
그 요청을 받은 ReplicaSet이 실제로 어떤 Pod를 삭제할지 고르는 과정은 한 단계 더 남아 있습니다

## 유지할 내용과 조건

- 목표 replica 합과 실제 종료 중 Pod 수 차이
- progress deadline은 전체 rollout 고정 타이머·자동 rollback이 아님
- undo 범위·history 정리 조건, DaemonSet 대상 선택과 scheduler 검사 분리

## 편집 후 독자 확인

- replicas 3·기본 surge/unavailable에서 옛 Pod를 언제 줄일 수 있는가?
- undo가 과거 전체 상태 복원이 아니라 새 rollout인 이유를 설명하는가?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
