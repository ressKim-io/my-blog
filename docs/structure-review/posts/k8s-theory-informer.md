# informer — 로컬 사본은 언제부터 믿을 수 있을까요? 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-informer.md](../../../src/content/essays/kubernetes/k8s-theory-informer.md)
- 시리즈: `k8s-theory-api` / 12
- 원문 SHA256: `d107340dbde6b51f9289b58e34f34127fbf8cd7a71379b9fee3fb8ac1cce003f`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 사용 목적과 기본 순환을 앞세우는 재구성

## 독자와 중심 질문

컨트롤러가 로컬 사본을 언제 읽어도 되는지, 알림을 받아 어떤 상태를 다시 판단하는지 이해합니다

선행 개념: LIST·watch·snapshot 복구, 부모와 자식 객체

## 현재 전개

- L24: 서버에서 읽고, 큐를 거쳐, 캐시에 반영합니다
- L44: 기본 큐와 DeltaFIFO를 구분해야 합니다
- L67: 초기 동기화와 핸들러 처리 완료는 다릅니다
- L102: Indexer는 자식과 입양 후보를 따로 찾습니다
- L122: 자식의 이벤트로 부모의 키를 찾습니다
- L145: 놓친 삭제는 새 snapshot에서 찾습니다
- L178: resync는 서버에서 다시 읽는 작업이 아닙니다
- L207: 변경 알림은 현재 상태를 다시 볼 계기입니다
- L221: informer를 공유해도 핸들러의 비용은 남습니다
- L234: 어느 단계에서 지연됐는지 구분합니다

## 원문 근거와 개선점

### L44 기본 사용 흐름보다 큐 계보가 앞섭니다

> ## 기본 큐와 DeltaFIFO를 구분해야 합니다

Reflector·Indexer를 처음 만난 직후 RealFIFO·AtomicFIFO·DeltaFIFO의 차이로 이동합니다. 왜 동기화를 기다리고 이벤트가 어떤 일을 시작하는지 알기 전에 자료구조를 구분해야 합니다

수정 방향: 초기 사본 준비 → 캐시 읽기 → 알림 → 부모 키 재처리를 먼저 완성하고 큐별 구현 차이는 후반으로 옮깁니다

### L207 전체 글을 읽는 기준이 후반에 나옵니다

> ## 변경 알림은 현재 상태를 다시 볼 계기입니다

이벤트를 명령 기록으로 오해하면 tombstone·resync·부모 키 연결의 목적을 놓칩니다. level-triggered라는 이름보다 현재 상태를 다시 본다는 원리가 먼저 필요합니다

수정 방향: 도입의 캐시 목적에 이 원리를 짧게 붙이고 ReplicaSet 하나를 전체 사례로 유지합니다

## 권장 설명 순서

1. ReplicaSet이 자식 수를 반복 판단하므로 서버 사본과 변경 알림이 필요하다는 목적을 제시합니다
2. Reflector가 초기 snapshot을 받고 Indexer가 채워진 뒤 워커가 읽는 기본 흐름을 설명합니다
3. Pod 변경 → 부모 키 → 캐시에서 현재 상태 재조회로 사용 흐름을 완성합니다
4. 초기 cache sync와 handler sync·이후 최신성의 차이를 구분합니다
5. 놓친 삭제를 새 snapshot에서 찾는 과정과 로컬 resync를 비교합니다
6. Indexer 최적화, RealFIFO/AtomicFIFO와 DeltaFIFO 차이, 느린 handler의 버퍼를 구현 심화로 설명합니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

변경 알림은 그 사건만 그대로 실행하라는 명령이 아닙니다
컨트롤러는 알림에서 처리할 키를 얻고, 차례가 오면 캐시의 현재 상태로 필요한 작업을 다시 계산합니다

## 유지할 내용과 조건

- 현재 기본 RealFIFO·AtomicFIFO와 DeltaFIFO 설명 구분 및 버전 조건
- HasSynced와 handler 완료·최신성은 별개
- tombstone의 낡은 상태·nil 가능성, resync는 재조회가 아님, 공유 범위와 버퍼 비용

## 편집 후 독자 확인

- 캐시가 아직 비어 있는 것과 자식이 실제로 없는 것을 구분하는가?
- snapshot 교체와 resync 중 누락된 삭제를 발견할 수 있는 작업은 무엇인가?
- 두 종류의 큐를 읽기 전에도 informer의 역할을 설명할 수 있는가?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
