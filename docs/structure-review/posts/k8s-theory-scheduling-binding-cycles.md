# 스케줄링과 바인딩 사이클 — 노드 선택과 기록을 나누는 이유 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-scheduling-binding-cycles.md](../../../src/content/essays/kubernetes/k8s-theory-scheduling-binding-cycles.md)
- 시리즈: `k8s-theory-node` / 1
- 원문 SHA256: `6f30ba56ff77bfd7e9e2af100916e500e95312e01afca37a6b2647753edc147b`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 두 사이클의 한 번 실행을 먼저 완결

## 독자와 중심 질문

노드 선택과 API 기록을 나눠도 다음 Pod가 앞선 배치를 고려할 수 있는 이유를 이해합니다

선행 개념: Pod nodeName, scheduler와 API 서버, informer 캐시

## 현재 전개

- L23: 노드를 고른 뒤에도 API 서버의 Pod는 아직 미배치 상태입니다
- L39: PreEnqueue는 노드 검사를 시작하기 전의 관문입니다
- L54: Filter는 가능한 노드를 남기고 Score는 그 안에서 고릅니다
- L106: assume과 Reserve는 서로 다른 상태를 반영합니다
- L126: Permit의 호출과 실제 대기는 다른 구간에 있습니다
- L143: 바인딩은 선택한 노드를 API 서버에 기록합니다
- L183: 실패하면 잠정 상태를 정리하고 다시 시도할지 판단합니다
- L211: 재시도할 Pod를 모두 같은 대기열에 넣지는 않습니다
- L252: Pending의 원인은 PodScheduled 조건에서 나눠 봅니다
- L287: 비동기 바인딩과 별도의 API 호출 기능을 구분합니다
- L308: 기본 Pod 경로와 집합 스케줄링의 경계가 있습니다

## 원문 근거와 개선점

### L79 두 사이클 연결 전에 후보 수 최적화로 빠집니다

> ### 전체 노드를 다 검사하기 전에 후보 탐색을 끝낼 수 있습니다

제목의 핵심은 선택·assume·binding의 시간 관계인데 PreEnqueue·Filter/Score 뒤 후보 비율 계산까지 거쳐야 assume을 만납니다

수정 방향: Filter/Score는 노드를 선택한다는 역할까지만 먼저 설명합니다. assume→비동기 binding→다음 Pod의 계산을 끝낸 뒤 후보 수 최적화를 보충합니다

### L126 중요한 시간 관계를 전체 예와 연결할 필요가 있습니다

> ## Permit의 호출과 실제 대기는 다른 구간에 있습니다

이 절과 시간 그림은 좋은 설명입니다. 다만 앞선 확장점을 각각 암기한 뒤에야 구간 경계가 분명해집니다

수정 방향: Pod A의 바인딩 대기 중 Pod B를 고르는 기존 그림을 앞쪽 기본 사례에 사용하고, 각 확장점을 그 위치에 연결합니다

## 권장 설명 순서

1. Pod A의 노드를 골라도 nodeName은 아직 비어 있다는 기존 질문을 유지합니다
2. 선택→assume→별도 binding, 그 사이 Pod B 선택이라는 전체 시간 관계를 먼저 보여줍니다
3. assume의 노드 캐시와 Reserve의 플러그인 상태를 구분합니다
4. Permit 호출/대기·PreBind·Binding 기록·kubelet 인계를 연결합니다
5. 실패 시 Unreserve/Forget과 이미 성공한 API 쓰기의 차이를 설명합니다
6. PreEnqueue·후보 탐색 최적화·재시도 큐·QueueingHint를 별도 단계로 풉니다
7. 추가 비동기 gate·PodGroup 경계와 Pending 진단을 보충합니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

API 서버의 응답을 기다리는 동안에도 다음 Pod를 고르려면 방금 정한 배치를 먼저 계산에 넣어야 합니다
스케줄러의 assume은 이 시간차를 자기 캐시 안에서 메웁니다

## 유지할 내용과 조건

- scheduling cycle 직렬과 노드별 Filter 병렬의 차이
- assume/Reserve는 분산 잠금이 아님, API 쓰기의 자동 롤백 비보장
- 기본 binding goroutine과 SchedulerAsyncAPICalls 구분, PodGroup 조건

## 편집 후 독자 확인

- Pod A의 Binding 응답 전 Pod B가 자원을 과도하게 계산하지 않도록 무엇을 반영하는가?
- Permit 호출과 실제 대기가 어느 사이클에 있는지 설명하는가?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
