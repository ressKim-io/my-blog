# 이름·UID·ownerReferences — 같은 이름이어도 같은 소유자는 아닙니다 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-object-identity-ownership.md](../../../src/content/essays/kubernetes/k8s-theory-object-identity-ownership.md)
- 시리즈: `k8s-theory-api` / 8
- 원문 SHA256: `f45924437218c4eb792e64f4e7cb5de7cba17d159edc3933200271695c78b415`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 도입 유지, 소유 관계 판단과 주변 메타데이터 분리

## 독자와 중심 질문

같은 이름으로 다시 만든 부모와 기존 자식이 왜 같은 소유 관계를 이어 가지 않는지 이해합니다

선행 개념: 객체 이름·namespace, 삭제와 controller의 기초

## 현재 전개

- L24: 이름은 현재 객체를 찾고 UID는 같은 개체인지 확인합니다
- L60: 소유 관계는 자식의 ownerReferences에 적습니다
- L90: 소유자와 자식의 namespace에는 제약이 있습니다
- L120: 참조를 바꿀 권한과 부모 삭제를 막을 권한은 다릅니다
- L146: 소유자가 여럿이면 각 참조를 분류합니다
- L171: GC는 변경 이벤트로 소유 그래프를 유지합니다
- L202: discovery 실패가 모든 리소스의 감시를 멈추지는 않습니다
- L222: label과 annotation은 식별·소유 참조를 대신하지 않습니다
- L249: 오류는 관계를 검사한 단계와 함께 읽습니다

## 원문 근거와 개선점

### L42 주요 소유 사례의 답을 완성하기 전에 별도 사용례가 나옵니다

> ### DELETE에도 개체를 확인하는 조건을 넣을 수 있습니다

UID 필요성 다음에 DELETE precondition을 설명한 뒤 ownerReferences로 돌아갑니다. 도입의 ReplicaSet·Pod 관계를 먼저 끝내면 UID의 추가 쓰임도 쉽게 읽힙니다

수정 방향: ownerReferences의 위치와 최소 예시를 UID 바로 뒤에 놓고 precondition은 같은 UID의 다른 활용으로 후반에 붙입니다

### L222 중요한 구분과 형식 제한이 함께 묶여 있습니다

> ## label과 annotation은 식별·소유 참조를 대신하지 않습니다

selector와 소유의 차이는 앞의 ReplicaSet 이해에 필요하지만 키 문법·256KiB 한도는 GC 판단과 별도 문제입니다

수정 방향: selector 대 ownerReference 비교는 앞쪽으로 이동합니다. label/annotation 문법과 크기는 보충 절로 분리합니다

## 권장 설명 순서

1. 같은 이름의 ReplicaSet을 재생성한 사례를 이름·UID 비교로 풉니다
2. 자식에 ownerReferences를 두는 이유와 selector가 관계를 대신하지 않는 점을 연결합니다
3. 소유자 존재·UID 일치·삭제 중 상태를 따라 단일 소유자의 GC 결정을 설명합니다
4. namespace 제약, 여러 소유자, blockOwnerDeletion으로 판단 조건을 확장합니다
5. watch로 그래프를 유지하고 미관찰을 부재로 단정하지 않는 구현을 설명합니다
6. 참조 변경 권한, DELETE precondition, discovery 실패와 메타데이터 형식은 각 질문별 보충 절에 둡니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

이름이 같은 부모를 찾았더라도 자식이 기록한 UID와 다르면 이전 소유자를 찾은 것이 아닙니다
GC는 이 참조를 다른 유효한 소유자 참조와 함께 살펴 자식의 처리 방향을 정합니다

## 유지할 내용과 조건

- 소유자 여러 개와 controller:true 하나의 차이
- 권한 플러그인 기본 비활성·부모 finalizers update 검사 조건
- 관찰 실패와 부재의 구분, discovery 부분 실패, GC의 순환 해소 비보장

## 편집 후 독자 확인

- label selector가 맞는 객체와 ownerReference로 소유된 객체의 차이를 설명할 수 있는가?
- NotFound·UID 불일치·조회 오류가 왜 서로 다른 판단으로 이어지는가?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
