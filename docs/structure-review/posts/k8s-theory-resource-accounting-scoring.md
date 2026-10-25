# 자원 계산과 점수 전략 — Pod 요청을 세고 노드를 고르는 기준 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-resource-accounting-scoring.md](../../../src/content/essays/kubernetes/k8s-theory-resource-accounting-scoring.md)
- 시리즈: `k8s-theory-node` / 15
- 원문 SHA256: `601bd123230b31563daacb57ed4319d5f4ac0edeaec8acde1b6d73459964f915`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 기본 요청 계산에서 예외와 점수 정책으로 확장

## 독자와 중심 질문

Pod의 유효 요청량을 계산하고 같은 후보를 서로 다른 점수 정책으로 평가하는 과정을 이해합니다

선행 개념: request/allocatable, init·sidecar, Filter와 Score

## 현재 전개

- L23: RuntimeClass가 채운 값도 요청에 포함됩니다
- L74: Pod 요청은 실행 시점별로 계산합니다
- L102: overhead는 requests·limits·QoS에서 다르게 쓰입니다
- L144: Filter와 Score는 누락된 요청을 다르게 셉니다
- L167: NodeResourcesFit은 세 가지 전략을 제공합니다
- L215: 균형 점수는 별도 플러그인이 계산합니다
- L247: Pod는 점수 전략 대신 프로파일 이름을 참조합니다
- L265: 실패한 위치와 자원 계산을 함께 확인합니다
- L289: 참고 자료

## 원문 근거와 개선점

### L23 기본 합산보다 추가 overhead의 검증이 먼저입니다

> ## RuntimeClass가 채운 값도 요청에 포함됩니다

도입은 단순 합이 아니라는 질문인데 RuntimeClass YAML·admission 재검증을 긴 첫 단위로 읽습니다. 더할 기본 요청량을 먼저 이해해야 overhead의 위치가 선명합니다

수정 방향: 일반 컨테이너 합→init 단계 최대→계속 실행되는 sidecar→Pod-level 대체→overhead 추가 순서로 기본 계산을 먼저 둡니다

### L247 설정의 주인이 점수 수식 뒤에 나옵니다

> ## Pod는 점수 전략 대신 프로파일 이름을 참조합니다

scoringStrategy·shape·플러그인 가중치를 읽고 나서야 Pod 필드가 아닌 scheduler 설정임을 구체적으로 설명합니다

수정 방향: 점수 전략을 소개할 때 scheduler 프로파일에서 정한다는 위치와 schedulerName 연결을 먼저 붙입니다. 프로파일 제약은 후반에 보충합니다

## 권장 설명 순서

1. 실행 단계가 다른 작은 Pod 예로 유효 request를 계산합니다
2. Pod-level 대체 후 overhead를 더하는 순서를 설명합니다
3. RuntimeClass admission과 requests/limits/QoS/CRI에서 overhead를 다루는 차이를 풉니다
4. Filter와 Score의 누락 요청 보정을 비교합니다
5. 프로파일에서 고르는 세 점수 전략을 기존 A/B 후보 예로 비교합니다
6. BalancedAllocation과 다른 플러그인 합산·shape 범위·표시 helper 옵션을 보충합니다
7. Pending 원인을 계산값과 담당 scheduler 기준으로 정리합니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

먼저 동시에 필요한 요청량을 계산한 다음 sandbox의 overhead를 더합니다
이렇게 얻은 요청으로 후보를 걸러도 남은 노드 중 어디를 선호할지는 별도의 점수 정책이 정합니다

## 유지할 내용과 조건

- CPU·메모리 최대 단계가 다를 수 있음
- overhead의 요청/상한/QoS/CRI 차이와 helper 옵션
- MostAllocated는 비용 절감 보장 아님, 현재 BalancedAllocation의 전후 비교, shape와 최종 점수 범위 차이

## 편집 후 독자 확인

- init과 sidecar를 모두 합산하거나 최대 하나만 고르면 왜 틀리는가?
- MostAllocated를 골라도 최종 노드가 달라질 수 있는 이유를 설명하는가?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
