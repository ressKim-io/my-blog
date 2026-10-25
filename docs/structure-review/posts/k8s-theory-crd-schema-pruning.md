# CRD 구조 — 스키마가 검사하고 남기는 필드 구조 검토

- 원문: [src/content/essays/kubernetes/k8s-theory-crd-schema-pruning.md](../../../src/content/essays/kubernetes/k8s-theory-crd-schema-pruning.md)
- 시리즈: `k8s-theory-extension` / 1
- 원문 SHA256: `36073e4666f0fa8261c379282b8d22f7166cb2989b844f048a3878cb10b2d936`
- 상태: 구조 검토 완료 / 본문 미수정
- 변경 강도: 큰 단위 재배치

## 독자와 중심 질문

새 CR에 보낸 필드는 어떤 순서로 기본값을 얻고 검증·제거되며, CRD 등록과 controller의 실제 작업은 어떻게 다를까요?

선행 개념: API 요청의 변경·검증·저장 단계와 spec·status의 관례를 전제합니다. CRD와 CR, controller의 역할은 도입에서 정의합니다

## 현재 전개

- L23: CRD 정의를 읽는 서버가 CR의 저장도 맡습니다
- L37: CR 생성 요청은 변경 결과를 검증한 뒤 저장합니다
- L48: structural schema는 임의 JSON을 허용할 범위도 선언합니다
- L98: pruning과 unknown-field 요청 거절은 다른 동작입니다
- L147: 기본값은 요청과 읽기·패치 결과에 적용됩니다
- L160: CEL은 같은 오브젝트 안의 관계를 검사합니다
- L221: status와 scale은 같은 오브젝트에 다른 경로를 붙입니다
- L265: 출력 열·검색 필드·scope에도 선언의 경계가 있습니다
- L291: 응답과 다시 읽은 필드를 함께 확인합니다
- L306: 확인한 근거

## 원문 근거와 개선점

### L48 필드가 겪는 과정보다 스키마 규칙 목록이 먼저 커집니다

> ## structural schema는 임의 JSON을 허용할 범위도 선언합니다

CR 요청 처리 그림으로 전체 경로를 먼저 보여준 점은 좋습니다. 그러나 이후 structural 제약·일곱 확장·SSA 관리 단위를 읽고 나서야 제목의 pruning과 기본값이 구체화됩니다

수정 방향: 원문에 있는 replicas·minReplicas 사례를 중심으로 선언된 필드, 미선언 필드, 빠진 값이 어떻게 처리되는지 먼저 따라갑니다. 스키마 제약 목록과 확장 분류는 그 결과를 가능하게 하는 선언 규칙으로 뒤에 둡니다

### L84 검증·저장과 소유권의 설명 단위를 나눕니다

> ### 리스트·맵의 단위는 SSA의 소유권에도 쓰입니다

필드를 남기거나 검사하는 이야기 중에 atomic·granular·map·set의 소유권으로 넘어갔다가 pruning으로 돌아옵니다. topology가 저장·검증·병합에 쓰인다는 관계를 처음부터 한꺼번에 이해해야 합니다

수정 방향: 기본 필드 처리와 CEL 검증을 마친 다음 구조 확장과 리스트·맵 관리 단위를 묶습니다. /status·/scale·SSA의 경계를 설명할 때 이 단위를 다시 참조하고 세부를 반복하지 않습니다

## 권장 설명 순서

1. CRD는 API 정의, CR은 데이터, controller는 조정 코드라는 역할과 등록 후 서빙 경로를 제시합니다
2. 작은 CR 필드 사례를 요청 디코딩·pruning·defaulting·변경·검증·저장 순서로 따라갑니다
3. fieldValidation의 Ignore·Warn·Strict와 unknown-field 보존 범위, 읽기 결과와 저장 바이트의 차이를 비교합니다
4. 현재 값과 oldSelf를 쓰는 CEL 검증, 비용 제한과 ratcheting의 적용 범위를 설명합니다
5. structural schema의 제약과 확장, 리스트·맵 topology를 앞의 처리에 필요한 선언으로 정리합니다
6. 본체·status·scale의 쓰기 경계와 공유 저장·동시성을 연결하고 출력·검색·scope는 API 사용의 보충 단위로 둡니다
7. 거절된 요청·사라진 필드·되돌아간 값의 관측 차이를 확인하는 기준으로 마칩니다

## 연결 문장 예시

아래는 구성 예시이며 실행 결과나 새로운 경험이 아닙니다

요청이 성공해도 보낸 모든 필드가 그대로 남는 것은 아닙니다
먼저 미선언 필드를 보내거나 값을 생략한 경우를 따라가면, pruning·기본값·검증이 각각 무엇을 바꾸는지 구분할 수 있습니다

## 유지할 내용과 조건

- CRD 생성과 서빙·discovery 반영, controller 실행을 같은 완료 상태로 묶지 않습니다
- pruning의 횟수와 mutating webhook 뒤 처리를 고정된 두 번으로 일반화하지 않습니다
- 읽기 기본값과 저장본 재쓰기, null·부재·default의 차이를 보존합니다
- topology·CEL·ratcheting·subresource·RBAC의 역할과 제한을 유지합니다

## 편집 후 독자 확인

- 스키마 확장 전체 목록을 외우지 않고도 한 필드가 왜 사라지거나 기본값을 얻는지 설명할 수 있나요?
- CRD 등록만으로 replicas 수만큼 자원이 생긴다고 오해하지 않나요?
- status 분리와 resourceVersion 충돌 방지가 서로 다른 문제임을 이해할 수 있나요?

공통 지침: [구조 기준](../principles.md) · [후속 편집](../handoff.md)
