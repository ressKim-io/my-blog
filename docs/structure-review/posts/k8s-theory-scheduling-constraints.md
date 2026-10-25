# Pod 배치 제약 — 노드를 제외하는 조건과 점수를 높이는 조건 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-scheduling-constraints.md](../../../src/content/essays/kubernetes/k8s-theory-scheduling-constraints.md)
- 시리즈: `k8s-theory-node` / 2
- 원문 SHA256: `cf4060ff490e9d140ef5432494f68cd8e56d876f2d5b7290e8315a4eb55d71ad`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 기본 비교 유지, 계산식과 예외의 순서 조정

## 독자와 중심 질문

노드 배치 조건이 후보 제외·선호·영역별 분산 중 무엇을 결정하는지 이해합니다

선행 개념: Filter와 Score, 노드 label·Pod selector

## 현재 전개

- L24: 필수 조건과 선호 조건은 다른 단계에서 적용합니다
- L49: nodeSelector와 nodeAffinity는 목적지를 제한합니다
- L94: taint는 다른 Pod를 제외하지만 toleration은 목적지를 고르지 않습니다
- L136: pod affinity는 기존 Pod의 위치를 기준으로 합니다
- L186: topology spread는 domain별 Pod 개수 차이를 계산합니다
- L260: Score는 후보를 비교하는 값입니다
- L275: 배치 뒤의 조건 변경은 기존 Pod를 자동으로 옮기지 않습니다
- L297: 실패 메시지는 preemption으로 바꿀 수 있는 조건도 구분합니다

## 원문 근거와 개선점

### L120 배치 조건 비교 중 장애 축출 정책으로 넓어집니다

> ### 기본 300초는 모든 Pod의 공통 유예 시간이 아닙니다

node affinity와 taint를 비교한 뒤 admission의 기본 toleration·DaemonSet까지 읽고 pod affinity로 돌아옵니다. 배치 조건들의 차이를 한 번에 비교하기 어렵습니다

수정 방향: 기본 taint/toleration 관계를 먼저 끝내고 기본 300초는 마지막 배치 후 변화·NoExecute 설명에 붙입니다

### L189 분산 상황을 보기 전에 계산 기호를 배웁니다

> `DoNotSchedule`의 Filter 판정식은 다음과 같습니다

domain별 개수라는 목적을 한 줄 설명한 직후 matchNum·selfMatchNum·minMatchNum이 나옵니다. 어떤 후보에 새 Pod를 더하는지 먼저 보여주면 식의 각 항이 자연스럽습니다

수정 방향: 작은 domain별 개수 가정 예를 먼저 배치하고 계산식을 그 예의 일반화로 설명합니다. minDomains 반례는 기본 계산 뒤에 유지합니다

## 권장 설명 순서

1. 후보 제외와 선호를 나누는 첫 그림을 유지합니다
2. 전용 GPU 노드 예로 nodeSelector/affinity와 taint/toleration의 서로 다른 방향을 연결합니다
3. pod affinity는 상대 Pod와 topology 영역을 기준으로 한다는 그림을 설명합니다
4. domain별 개수에 새 Pod를 더하는 예에서 topology spread 계산식으로 확장합니다
5. minDomains·집계 포함 정책·기본 spread·점수 가중치의 조건을 붙입니다
6. 배치 뒤 변경과 NoExecute·기본 toleration을 구분하고 preemption으로 해결할 조건을 정리합니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

taint를 견딘다는 것은 그 이유로 제외되지 않는다는 뜻입니다
그 Pod가 반드시 그 노드풀로 가게 하려면 목적지를 제한하는 조건도 함께 필요합니다

## 유지할 내용과 조건

- GPU 사례와 topologyKey 그림
- selector/affinity AND·OR 조건, toleration은 권한 제어 아님
- 집계 domain과 실제 후보 차이, minDomains는 domain 생성 기능 아님, 배치 후 자동 재분산 비보장

## 편집 후 독자 확인

- GPU toleration만 넣은 Pod가 일반 노드로 갈 수 있는 이유를 설명하는가?
- spread 집계에는 포함되지만 실제 배치에는 제외되는 노드를 구분하는가?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
