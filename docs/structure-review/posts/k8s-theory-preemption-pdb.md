# Preemption과 PDB — 희생자 선정과 삭제 허용은 다른 판단입니다 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-preemption-pdb.md](../../../src/content/essays/kubernetes/k8s-theory-preemption-pdb.md)
- 시리즈: `k8s-theory-node` / 3
- 원문 SHA256: `2af803995b5319af53efdb8ba402409dcca61fa8e4ae8fa57fec4246f57bb1ec`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 두 삭제 경로의 차이를 앞세우고 선정 알고리즘은 뒤로

## 독자와 중심 질문

PDB 예산이 없어도 scheduler preemption이 진행될 수 있는 이유를 요청 경로로 설명합니다

선행 개념: Filter/PostFilter·Binding, Pod 삭제와 종료의 차이

## 현재 전개

- L23: 희생자를 골라도 새 Pod가 바로 바인딩되지는 않습니다
- L37: PriorityClass는 생성할 때 Pod의 정수 우선순위가 됩니다
- L64: preemption으로 바뀔 수 있는 노드부터 살펴봅니다
- L86: 희생자를 고르는 동안에는 실제 Pod를 삭제하지 않습니다
- L132: 우선순위가 높아도 다른 Pod를 밀어내지 않을 수 있습니다
- L146: nominatedNodeName은 Binding을 예약하지 않습니다
- L170: 희생자 처리는 일반 DELETE와 메모리 내 취소로 나뉩니다
- L202: PDB의 예산은 disruption controller가 계산합니다
- L228: 예산을 검사해 삭제를 거부하는 곳은 Eviction API입니다
- L272: PDB는 preemption의 집행을 막지 않습니다
- L294: 중단 주체는 조건과 요청 경로를 함께 확인합니다

## 원문 근거와 개선점

### L228 제목의 핵심 구분에 필요한 경로가 후반에 나옵니다

> ## 예산을 검사해 삭제를 거부하는 곳은 Eviction API입니다

도입에서 PDB 고려와 강제의 차이를 말하지만 PriorityClass·후보 탐색·reprieve·nomination을 모두 읽은 뒤 DELETE와 Eviction API의 차이를 구체적으로 확인합니다

수정 방향: 일반 preemption 처리와 Eviction API를 도입 뒤 한 번 비교하고, 이후 선정 알고리즘과 예산 집행을 각각 풀어갑니다

### L75 희생자 선택 원리보다 탐색 최적화가 먼저 나옵니다

> ### 후보 목표 수는 전체 검사 횟수와 다릅니다

PDB를 어떻게 고려하는지 아직 배우기 전에 후보 수 계산과 탐색 종료 조건을 읽습니다

수정 방향: 한 노드 사본에서 낮은 우선순위 Pod를 빼고 되돌리는 예를 먼저 완성합니다. 후보 수·노드 간 순위는 그다음 확장합니다

## 권장 설명 순서

1. 높은 우선순위 Pod의 자리 부족과 PDB를 고려해도 거절이 보장되지 않는 질문을 제시합니다
2. preemption의 일반 DELETE/메모리 취소와 Eviction API의 예산 검사를 먼저 비교합니다
3. PriorityClass와 한 노드의 제거·reprieve 사례로 PDB 위반을 줄이는 선정을 설명합니다
4. 후보 탐색·노드 간 선택·Never·nominatedNodeName의 한계를 풉니다
5. 희생자 처리와 새 Pod 재시도, 실제 자원 해제까지의 시간차를 설명합니다
6. PDB status 계산·Eviction 예외·drain을 연결하고 중단 주체별 조건으로 진단합니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

PDB를 참고해 덜 해로운 희생자를 고르는 것과 예산이 없으면 삭제 요청을 거부하는 것은 다른 단계입니다
이 차이는 최종 요청이 Eviction API를 지나는지에서 드러납니다

## 유지할 내용과 조건

- PDB best-effort와 Eviction 예산 검사 구분
- 사본에서 선정할 때 실제 삭제하지 않음, nomination은 예약 아님
- 미준비·종료 Pod 예외, 메모리 내 preemption·기본 Pod와 PodGroup 범위

## 편집 후 독자 확인

- PDB가 0인데도 preemption되는 상황을 두 요청 경로로 설명하는가?
- 희생자 삭제 요청 성공과 새 Pod Binding 성공을 구분하는가?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
