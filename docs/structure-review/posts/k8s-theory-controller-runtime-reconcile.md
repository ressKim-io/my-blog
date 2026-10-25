# controller-runtime과 reconcile — 큐에는 이름이 들어갑니다 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-controller-runtime-reconcile.md](../../../src/content/essays/kubernetes/k8s-theory-controller-runtime-reconcile.md)
- 시리즈: `k8s-theory-extension` / 3
- 원문 SHA256: `84d04d2d84f289b75d02d3644edb868e1006ae99ed2649ba4d6797350eaf6a11`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 큰 단위 재배치

## 독자와 중심 질문

이벤트가 이름 키로 바뀐 뒤 Reconcile은 무엇을 다시 읽고 어떤 변경·반환을 해야 반복 호출에서도 상태를 맞출 수 있을까요?

선행 개념: informer·reconcile의 기본 목적과 오브젝트 이름·UID의 차이를 전제합니다. Manager·Controller·Reconciler는 역할을 짧게 구분합니다

## 현재 전개

- L22: Manager는 공유 자원을, Controller는 큐를 관리합니다
- L39: 이벤트에서 함수까지 전달되는 것은 조정할 키입니다
- L61: 같은 키의 동시 실행을 막는 범위는 한 Controller의 큐입니다
- L87: Owns는 자식 이벤트를 부모의 요청으로 바꿉니다
- L111: 기본 client는 캐시에서 읽고 API 서버에 씁니다
- L140: 반환값이 다음 조정을 예약합니다
- L187: status 쓰기도 다시 조정할 이벤트가 됩니다
- L210: conditions는 관찰한 판정과 그 기준을 남깁니다
- L240: finalizer의 삭제 조정도 반복에 안전해야 합니다
- L257: leader election은 같은 키의 전역 잠금이 아닙니다
- L280: 조정이 멈췄는지, 반복되는지를 먼저 나눕니다
- L297: 확인한 근거

## 원문 근거와 개선점

### L61 키를 받은 뒤 하는 일을 보기 전에 큐 내부 비교로 들어갑니다

> ## 같은 키의 동시 실행을 막는 범위는 한 Controller의 큐입니다

표준 Request에 이름만 전달된다는 설명은 제목과 잘 맞습니다. 하지만 기본 우선순위 큐와 client-go dirty·processing을 비교하고 Owns 매핑을 읽은 뒤에야 Reconciler의 읽기·쓰기가 나옵니다

수정 방향: 이벤트→키→현재 상태 읽기→필요한 변경→반환이라는 한 번의 조정을 먼저 완결합니다. 큐 병합·직렬화는 왜 이벤트 수와 호출 수가 다르고 반복에도 안전해야 하는지를 설명하는 후반 기전으로 둡니다

### L125 기본 캐시 한계를 이해한 직후 실험 옵션으로 흐름이 끊깁니다

> ### 같은 client의 쓰기 반영을 기다리는 옵션도 있습니다

쓰기 뒤 읽기가 낡을 수 있다는 상황은 조정 설계의 핵심입니다. 이어 실험 옵션의 GVK·표현별 범위와 제한을 상세히 읽어야 반환값과 다음 조정으로 갈 수 있습니다

수정 방향: 기본 캐시 지연과 결정적 자식 이름, 필요한 변경만 수행하는 판단을 먼저 연결합니다. read-your-writes 옵션은 그 문제에 대한 선택적 보충으로 옮기고 기본 동작을 대체하는 필수 설정처럼 보이지 않게 합니다

## 권장 설명 순서

1. Manager·Controller·Reconciler 역할을 짧게 나누고 CR 변화가 표준 이름 키로 들어오는 흐름을 보여줍니다
2. 키로 대상을 읽고 현재 상태를 판단해 필요한 API·외부 변경을 하는 한 번의 조정을 설명합니다
3. 캐시 읽기·서버 쓰기·대상과 자식의 NotFound 차이·중간 상태 재처리를 그 조정 안에 연결합니다
4. Result·error·RequeueAfter와 status·conditions 쓰기가 다음 조정을 만드는 과정을 설명합니다
5. 삭제 조정과 finalizer 저장 책임을 붙여 생성·변경·삭제를 반복 가능한 흐름으로 완결합니다
6. Owns·predicate·큐 병합과 직렬화·백오프를 감시와 실행 기전으로 확장합니다
7. 선택적 읽기 일관성·leader election의 보장 범위와 관측 기준을 정리합니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

큐에서 받은 이름은 실행할 사건의 사본이 아니라 다시 확인할 대상을 가리킵니다
Reconciler는 그 이름으로 관찰한 상태에서 남은 작업을 판단해야 하며, 이전 호출의 쓰기가 아직 캐시에 보이지 않는 경우도 고려해야 합니다

## 유지할 내용과 조건

- 표준 Request와 사용자 정의 TypedReconciler의 범위를 구분합니다
- 같은 키 직렬화는 한 큐의 보장이며 API 최신성·외부 작업 배타성·fencing을 대신하지 않음을 유지합니다
- TerminalError·Forget·RequeueAfter가 다른 이벤트와 대기 요청을 모두 취소하는 의미가 아님을 보존합니다
- status predicate의 복구·삭제 이벤트 영향과 finalizer 헬퍼의 API 저장 책임을 유지합니다

## 편집 후 독자 확인

- 큐 구현을 몰라도 한 번의 Reconcile에서 무엇을 읽고 바꾸고 반환하는지 설명할 수 있나요?
- 이벤트 수와 호출 수가 같지 않아도 조정이 가능한 이유를 이해할 수 있나요?
- 반복 안전성을 매번 같은 쓰기를 되풀이하는 것으로 오해하지 않나요?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
